/* ============================================================
   systems/digsite.js — GROUND YOU CAN TAKE AWAY A BUCKET AT A TIME.

   Every hole up to here is AUTHORED: something decides a shaft, a crater, a
   room or a tunnel belongs at a place, and the ground is subtracted to match.
   That covers the sinkhole, the bomb, the bunker and the escape route, and it
   does not cover mining, where the shape is whatever the player digs and there
   is no author to ask.

   WHAT MINECRAFT ACTUALLY SOLVED, AND THE ONE PLACE IT DOES NOT TRANSFER.
   Its answer is that the thing you stand on is the TOP OF A SOLID: a hole is
   not built, it is material removed, and the sides and floor were always there.
   That is exactly the model systems/solidground.js took. Where it does not
   transfer is the surface layer — Minecraft's roads ARE blocks, so lowering the
   ground lowers the road, while Gang City's streets are separate meshes at fixed
   heights and lowering the field under one leaves it hanging in the air. So a
   dig site is declared over BARE GROUND and nowhere else. That is not a
   limitation being worked around, it is the honest edge of the technique, and
   the alternative — baking the whole street layer into the terrain surface — is
   a much larger job that this deliberately does not start.

   A HEIGHTFIELD GIVES SLOPES; SIDE QUADS GIVE A CUT. Minecraft's faces are
   vertical because it is voxels. A plain grid interpolates between neighbours,
   so a lowered cell reads as a DENT, not a hole. Every cell here therefore emits
   its top quad AND a vertical skirt down to each lower neighbour. That single
   decision is the difference between a dented world and a cut one, and it is
   why this is designed in from the first line rather than added later.

   IT RIDES THE GROUND MODEL, IT DOES NOT SIT BESIDE IT. The site is ONE box
   carving whose floorFn reads the grid. So floorAt, ceilAt, the mask, the
   audits and every consumer already work here — a mine shaft dug under a quarry
   is a carving under a carving, which is just subtraction twice.

   Flags:
     DIG_SITES        master
     DIG_CELL         metres per cell
     DIG_MAX_DEPTH    how far below its own grade a site may be dug
   Ratchet: CBZ.digAudit(), tools/dig-check.mjs.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  CBZ.CONFIG = CBZ.CONFIG || {};
  if (CBZ.CONFIG.DIG_SITES == null) CBZ.CONFIG.DIG_SITES = true;
  if (CBZ.CONFIG.DIG_CELL == null) CBZ.CONFIG.DIG_CELL = 1.0;
  if (CBZ.CONFIG.DIG_MAX_DEPTH == null) CBZ.CONFIG.DIG_MAX_DEPTH = 14;

  const sites = [];
  const stats = { built: 0, digs: 0, cells: 0, remesh: 0, remeshMs: 0, worstMs: 0, worstChunkMs: 0, worstDigMs: 0 };
  let soilMat = null;
  function mats() {
    if (soilMat) return;
    soilMat = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true });
    // the dug ground IS the ground here; the mask must never eat it
    if (CBZ.groundMaskExempt) CBZ.groundMaskExempt(soilMat);
  }
  /* Strata by depth, so a cut face reads as earth rather than as a coloured
     step. THE FIRST BAND IS NOT AUTHORED. It is the ground this site replaced,
     sampled once at build time through world/groundshaft.js's published
     groundColorAt — the same function the shaft lip uses, so a dig and a
     sinkhole in the same field agree about what that field looks like. The
     authored 0x6d7a4a it used to be is a decent guess at grass and wrong
     everywhere else: on the island it drew a 34 m cream disc in green grass,
     which reads as damage to the world rather than as a site in it. It stays
     as the fallback for when the sample comes back with no answer. */
  const GRASS_FALLBACK = 0x6d7a4a;
  /* The first earth band starts as soon as a cell has MOVED AT ALL. It used to
     start at 0.06, which on an 11 m site meant anything cut less than 0.66 m
     kept the surface colour — so the top terrace of a pit was turf hanging in
     mid-air over its own cut face. Ground that has been taken away is earth. */
  const BANDS = [[0.004, 0x8a7150], [0.3, 0x7d6a4c], [0.62, 0x6a6053], [0.85, 0x554f47]];
  function bandOf(s, t, out) {
    let c = (s && s.topColor != null) ? s.topColor : GRASS_FALLBACK;
    for (let i = 0; i < BANDS.length; i++) if (t >= BANDS[i][0]) c = BANDS[i][1];
    const k = Math.max(0.35, 1 - t * 0.5);
    out[0] = (((c >> 16) & 255) / 255) * k;
    out[1] = (((c >> 8) & 255) / 255) * k;
    out[2] = ((c & 255) / 255) * k;
  }

  CBZ.buildDigSite = function (x, z, o) {
    o = o || {};
    if (CBZ.CONFIG.DIG_SITES === false || !CBZ.addCarving) return null;
    mats();
    const cell = Math.max(0.5, o.cell || CBZ.CONFIG.DIG_CELL);
    const span = Math.max(8, o.span || 48);
    const n = Math.max(4, Math.round(span / cell));
    const surf = CBZ.groundBaseAt ? CBZ.groundBaseAt(x, z) : 0;
    if (!Number.isFinite(surf)) return null;
    /* THE SAME PLACEMENT LAW AS EVERY OTHER HOLE. A dig site replaces the ground
       across its whole footprint, so it has no more business under a building,
       in water or inside a government complex than a shaft or a crater does —
       and photographed without this it sat straight through a row of houses,
       which is the "undermined tower" fault wearing a different hat. Reusing
       world/groundshaft.js's law rather than writing a second one is also the
       only way the two can never drift apart. */
    if (CBZ.groundShaftCanOpen && !o.force) {
      const can = CBZ.groundShaftCanOpen(x, z, Math.max(8, (Math.max(8, o.span || 48)) / 2));
      if (!can.ok) { stats.refusedLaw = (stats.refusedLaw || 0) + 1; return null; }
    }
    const s = {
      x: x, z: z, cell: cell, n: n, span: n * cell, surf: surf,
      x0: x - (n * cell) / 2, z0: z - (n * cell) / 2,
      maxDepth: o.maxDepth || CBZ.CONFIG.DIG_MAX_DEPTH,
      top: new Float32Array((n + 1) * (n + 1)),      // per-VERTEX height, live
      base0: new Float32Array((n + 1) * (n + 1)),    // ... and as it was found
      chunk: Math.max(4, Math.round(16 / cell)),
      grp: new THREE.Group(), meshes: new Map(), dirty: new Set(),
      mode: CBZ.game ? CBZ.game.mode : null,
    };
    /* SEEDED FROM THE TERRAIN, VERTEX BY VERTEX. Filling the grid with the
       height at the site's CENTRE makes a flat plate, and on any slope that
       plate is metres above or below the real ground — the carving then removes
       a column that was never there and floorAt answers the untouched terrain
       instead of the site. Seeded per vertex, an UNDUG site is byte-equal to
       the ground it replaced, which is the same property that made the M2
       ownership swap safe to land. */
    for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
      const vx = s.x0 + i * cell, vz = s.z0 + j * cell;
      const gy = CBZ.groundBaseAt ? CBZ.groundBaseAt(vx, vz) : surf;
      const v = Number.isFinite(gy) ? gy : surf;
      s.top[j * (n + 1) + i] = v;
      s.base0[j * (n + 1) + i] = v;
    }
    s.grp.userData.digSite = true;
    (CBZ.scene).add(s.grp);

    /* ONE CARVING FOR THE WHOLE SITE. Everything below the original grade is
       removed material whose floor is the grid — so floorAt, ceilAt, the mask
       and every consumer already understand this place. */
    /* Sample BEFORE anything of ours is in the scene, so the raycast can only
       find the ground being replaced. (groundColorAt also skips digSite groups,
       so a later re-sample would still be right — belt and braces.) */
    s.topColor = CBZ.groundColorAt ? CBZ.groundColorAt(x, z, surf) : null;
    s.carve = CBZ.addCarving({
      kind: "cyl", x: x, z: z, r: s.span / 2,
      y0: surf - s.maxDepth - 1, y1: surf + 40, open: true, dry: true,
      owner: "digSite", mode: s.mode,
      floorFn: function (px, pz) { return CBZ.digHeightAt(s, px, pz); },
    });
    /* A DIG SITE GOES ON FLAT GROUND, AND THE REASON IS QUANTISATION.
       A cell is a FLAT top with vertical sides — that is what makes a dig read
       as a cut instead of a dent — so the grid is a staircase approximation of
       whatever it was seeded from, and on a slope it under-reads the true
       ground by about one cell's rise. Measured on an island hillside: 0.67 m,
       which is a step you would feel. Rather than paper over it with
       interpolation (which would put an invisible ramp exactly where the
       picture shows a step), refuse the site — the same instinct as the shaft's
       slope law, and "bare, flat ground" was already the honest edge of this
       technique. */
    let worst = 0;
    for (let j = 0; j <= n; j++) for (let i = 0; i < n; i++) {
      worst = Math.max(worst, Math.abs(s.top[j * (n + 1) + i + 1] - s.top[j * (n + 1) + i]));
    }
    for (let j = 0; j < n; j++) for (let i = 0; i <= n; i++) {
      worst = Math.max(worst, Math.abs(s.top[(j + 1) * (n + 1) + i] - s.top[j * (n + 1) + i]));
    }
    s.worstStep = worst;
    if (worst > (o.maxStep != null ? o.maxStep : 0.25) && !o.force) {
      if (s.carve) CBZ.removeCarving(s.carve);
      if (s.grp.parent) s.grp.parent.remove(s.grp);
      stats.refusedSlope = (stats.refusedSlope || 0) + 1;
      return null;
    }
    sites.push(s);
    stats.built++;
    for (let cz2 = 0; cz2 < Math.ceil(n / s.chunk); cz2++)
      for (let cx2 = 0; cx2 < Math.ceil(n / s.chunk); cx2++) s.dirty.add(cx2 + "," + cz2);
    flush(s);
    return s;
  };

  function idx(s, i, j) { return j * (s.n + 1) + i; }
  CBZ.digHeightAt = function (s, x, z) {
    const fx = (x - s.x0) / s.cell, fz = (z - s.z0) / s.cell;
    if (fx < 0 || fz < 0 || fx > s.n || fz > s.n) return s.surf;
    const i = Math.max(0, Math.min(s.n - 1, Math.floor(fx))), j = Math.max(0, Math.min(s.n - 1, Math.floor(fz)));
    /* THE LOWEST CORNER, NOT AN INTERPOLATION. A cell is a flat top with
       vertical sides, so the height inside it is one value; averaging the
       corners would put an invisible ramp where the picture shows a step, and
       the whole point of the side quads is that those two agree. */
    let m = Infinity;
    for (let dj = 0; dj <= 1; dj++) for (let di = 0; di <= 1; di++) m = Math.min(m, s.top[idx(s, i + di, j + dj)]);
    return m;
  };
  function siteAt(x, z) {
    for (let k = 0; k < sites.length; k++) {
      const s = sites[k];
      if (x >= s.x0 && x <= s.x0 + s.span && z >= s.z0 && z <= s.z0 + s.span) return s;
    }
    return null;
  }
  CBZ.digSiteAt = siteAt;

  /* TAKE MATERIAL AWAY. Radius in metres, depth in metres, clamped to the
     site's floor. Only the chunks touched are re-meshed. */
  CBZ.digAt = function (x, z, r, depth) {
    const s = siteAt(x, z);
    if (!s) return 0;
    r = Math.max(s.cell, r || 1.5);
    depth = Math.max(0.05, depth || 0.6);

    const i0 = Math.max(0, Math.floor((x - r - s.x0) / s.cell)), i1 = Math.min(s.n, Math.ceil((x + r - s.x0) / s.cell));
    const j0 = Math.max(0, Math.floor((z - r - s.z0) / s.cell)), j1 = Math.min(s.n, Math.ceil((z + r - s.z0) / s.cell));
    let moved = 0;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const vx = s.x0 + i * s.cell, vz = s.z0 + j * s.cell;
      const d = Math.hypot(vx - x, vz - z);
      if (d > r) continue;
      const k = idx(s, i, j);
      // a rounded bite: full depth at the centre, feathering to nothing at the rim
      const want = s.top[k] - depth * (1 - (d / r) * (d / r));
      const next = Math.max(s.base0[k] - s.maxDepth, want);
      if (next < s.top[k] - 1e-4) {
        s.top[k] = next; moved++;
        const ci = Math.floor(i / s.chunk), cj = Math.floor(j / s.chunk);
        for (let a = -1; a <= 0; a++) for (let b = -1; b <= 0; b++) s.dirty.add((ci + a) + "," + (cj + b));
        s.dirty.add(ci + "," + cj);
      }
    }
    if (moved) { stats.digs++; stats.cells += moved; flush(s, true); }
    return moved;
  };

  // ---- meshing: a flat top per cell plus a vertical skirt to lower neighbours
  function buildChunk(s, ci, cj) {
    const c0i = ci * s.chunk, c0j = cj * s.chunk;
    const P = [], C = [], I = [];
    const col = [0, 0, 0];
    const H = (i, j) => s.top[idx(s, Math.max(0, Math.min(s.n, i)), Math.max(0, Math.min(s.n, j)))];
    const cellY = (i, j) => Math.min(H(i, j), H(i + 1, j), H(i, j + 1), H(i + 1, j + 1));
    const push = (x, y, z, t) => { bandOf(s, t, col); P.push(x, y, z); C.push(col[0], col[1], col[2]); return P.length / 3 - 1; };
    for (let dj = 0; dj < s.chunk; dj++) for (let di = 0; di < s.chunk; di++) {
      const i = c0i + di, j = c0j + dj;
      if (i >= s.n || j >= s.n) continue;
      // round site: cells outside the inscribed circle are not ours to draw
      const ccx = s.x0 + (i + 0.5) * s.cell, ccz = s.z0 + (j + 0.5) * s.cell;
      if (Math.hypot(ccx - s.x, ccz - s.z) > s.span / 2) continue;
      const y = cellY(i, j);
      const g0 = s.base0[idx(s, i, j)];
      const t = Math.max(0, Math.min(1, (g0 - y) / s.maxDepth));
      const x0 = s.x0 + i * s.cell, z0 = s.z0 + j * s.cell, x1 = x0 + s.cell, z1 = z0 + s.cell;
      const a = push(x0, y, z0, t), b = push(x1, y, z0, t), c = push(x1, y, z1, t), d = push(x0, y, z1, t);
      I.push(a, c, b, a, d, c);
      /* THE SIDE QUADS. Without these a dug cell is a dent: the grid would ramp
         to its neighbour and the hole would have no walls. With them the cut is
         vertical, which is the whole look. */
      const nb = [[1, 0, b, c], [-1, 0, d, a], [0, 1, c, d], [0, -1, a, b]];
      for (let k = 0; k < nb.length; k++) {
        const ny = cellY(i + nb[k][0], j + nb[k][1]);
        if (!(ny < y - 1e-4)) continue;
        const t2 = Math.max(0, Math.min(1, (s.base0[idx(s, i, j)] - ny) / s.maxDepth));
        const p1 = nb[k][2], p2 = nb[k][3];
        const q1 = push(P[p1 * 3], ny, P[p1 * 3 + 2], t2);
        const q2 = push(P[p2 * 3], ny, P[p2 * 3 + 2], t2);
        I.push(p1, q1, p2, p2, q1, q2);
      }
    }
    if (!P.length) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(C, 3));
    geo.setIndex(I);
    geo.computeVertexNormals();
    return new THREE.Mesh(geo, soilMat);
  }
  /* TWO NUMBERS, BECAUSE THEY ANSWER DIFFERENT QUESTIONS. Building the site
     re-meshes every chunk at once and is a load-time cost; a DIG touches one to
     four and happens mid-swing. Reporting only the larger made the initial build
     look like a stutter the player would feel, which it is not. */
  function flush(s, isDig) {
    if (!s.dirty.size) return;
    const t0 = (typeof performance !== "undefined" && performance.now) ? performance.now() : 0;
    s.dirty.forEach(function (key) {
      const parts = key.split(","), ci = +parts[0], cj = +parts[1];
      if (ci < 0 || cj < 0) return;
      const old = s.meshes.get(key);
      if (old) { s.grp.remove(old); if (old.geometry) old.geometry.dispose(); s.meshes.delete(key); }
      const c0 = (typeof performance !== "undefined" && performance.now) ? performance.now() : 0;
      const m = buildChunk(s, ci, cj);
      if (m) { s.grp.add(m); s.meshes.set(key, m); }
      const cms = ((typeof performance !== "undefined" && performance.now) ? performance.now() : 0) - c0;
      if (cms > stats.worstChunkMs) stats.worstChunkMs = cms;
      stats.remesh++;
    });
    s.dirty.clear();
    const ms = ((typeof performance !== "undefined" && performance.now) ? performance.now() : 0) - t0;
    stats.remeshMs += ms;
    if (ms > stats.worstMs) stats.worstMs = ms;
    if (isDig && ms > stats.worstDigMs) stats.worstDigMs = ms;
  }

  CBZ.digAudit = function () {
    let dugCells = 0, deepest = 0;
    for (let k = 0; k < sites.length; k++) {
      const s = sites[k];
      for (let i = 0; i < s.top.length; i++) {
        const d = s.base0[i] - s.top[i];
        if (d > 1e-4) dugCells++;
        if (d > deepest) deepest = d;
      }
    }
    return {
      sites: sites.length, dugVerts: dugCells, deepest: +deepest.toFixed(2),
      digs: stats.digs, cellsMoved: stats.cells, remesh: stats.remesh,
      worstRemeshMs: +stats.worstMs.toFixed(2),
      worstChunkMs: +stats.worstChunkMs.toFixed(2),
      worstDigFlushMs: +stats.worstDigMs.toFixed(2),
      avgRemeshMs: stats.remesh ? +(stats.remeshMs / stats.remesh).toFixed(3) : 0,
      cell: CBZ.CONFIG.DIG_CELL, maxDepth: CBZ.CONFIG.DIG_MAX_DEPTH,
      refusedSlope: stats.refusedSlope || 0,
      refusedLaw: stats.refusedLaw || 0,
      worstSeedStep: sites.length ? +sites[0].worstStep.toFixed(3) : 0,
      enabled: CBZ.CONFIG.DIG_SITES !== false,
    };
  };
  /* THE SITE REPLACES THE GROUND IT SITS ON, so that ground has to stop being
     drawn — otherwise the island's own disc lies over the pit and you get the
     oldest bug in this file's family: a hole you fall into with the surface
     still painted across it. The mask deals in CYLINDERS, so the site is round;
     a square would need either a box slot or a disc that ate 41% more ground
     than it replaces. A quarry is round anyway. */
  if (CBZ.groundMaskProvide) {
    const req = [];
    CBZ.groundMaskProvide(function () {
      req.length = 0;
      for (let i = 0; i < sites.length; i++) {
        const s = sites[i];
        /* A CELL IS DROPPED WHEN ITS CENTRE LEAVES THE CIRCLE, so the drawn
           disc's edge is a staircase strictly inside span/2 in places, while
           the discard was a clean circle AT span/2. The slivers between them
           were ground thrown away with nothing drawn over it — photographed on
           the island as a ring of blue triangles round the site, the ocean
           showing through its own rim. A point at radius p belongs to a cell
           whose centre is at most p + cell*0.707 out, so pulling the discard in
           by one cell's diagonal guarantees we draw over everything we remove. */
        req.push({ x: s.x, z: s.z, r: Math.max(1, s.span / 2 - s.cell * 0.8), y: s.surf, src: s });
      }
      return req;
    });
  }
  CBZ.digSites = sites;
})();
