/* ============================================================
   battle/core/flow.js — THE WAY THROUGH, as a pure function. One flow-field
   solver for every tier: physics.js's navSolve (the FULL brains' field) and
   core/tiersim.js (the MID / FAR sims, in the page or in the worker) both
   call this, so there is one implementation and not two.

   A Dial bucket-queue Dijkstra on an 8-connected grid of `cell`-metre cells:
   cost 10 per straight step, 14 per diagonal, seeded at 0 under every enemy,
   blocked cells never entered, NAV_MAXD the horizon (~2.4 km on 4 m cells).
   Page-independent, no DOM, no THREE: it runs in node and in a Web Worker.

   PUBLIC  CBZ.battleFlow = {
     solve(block, w, h, seeds, nSeeds, dist, buckets?) -> seeded count
         block  Uint8Array w*h (1 = wall)     seeds  Int32Array of cell indices
         dist   Uint16Array w*h (written; 65535 = no route)
     step(dist, w, h, ix, iz, steps) -> cell index after descending, or -1
     MAXD }
============================================================ */
(function () {
  "use strict";
  const W = typeof window !== "undefined" ? window : (typeof self !== "undefined" ? self : globalThis);
  const CBZ = W.CBZ || (W.CBZ = {});
  const NBX = [1, -1, 0, 0, 1, 1, -1, -1], NBZ = [0, 0, 1, -1, 1, -1, 1, -1];
  const MAXD = 6000;
  const _bk = [];
  function solve(block, w, h, seeds, nSeeds, dist, buckets) {
    const bk = buckets || _bk;
    dist.fill(65535);
    for (let i = 0; i < MAXD; i++) { if (!bk[i]) bk[i] = []; else bk[i].length = 0; }
    let seeded = 0;
    for (let i = 0; i < nSeeds; i++) {
      const k = seeds[i];
      if (k < 0 || k >= w * h) continue;
      if (dist[k] !== 0) { dist[k] = 0; bk[0].push(k); seeded++; }
    }
    if (!seeded) return 0;
    for (let b = 0; b < MAXD; b++) {
      const q = bk[b];
      if (!q.length) continue;
      for (let qi = 0; qi < q.length; qi++) {
        const k = q[qi];
        if (dist[k] !== b) continue;                   // a cheaper route already claimed it
        const ix = k % w, iz = (k / w) | 0;
        for (let n = 0; n < 8; n++) {
          const nx = ix + NBX[n], nz = iz + NBZ[n];
          if (nx < 0 || nz < 0 || nx >= w || nz >= h) continue;
          const nk = nz * w + nx;
          if (block[nk]) continue;
          const nd = b + (n < 4 ? 10 : 14);
          if (nd < dist[nk] && nd < MAXD) { dist[nk] = nd; bk[nd].push(nk); }
        }
      }
      q.length = 0;
    }
    return seeded;
  }
  // descend up to `steps` cells from (ix, iz); -1 when there is no way down
  function step(dist, w, h, ix, iz, steps) {
    if (ix < 1 || iz < 1 || ix >= w - 1 || iz >= h - 1) return -1;
    if (dist[iz * w + ix] === 65535) return -1;
    let moved = false;
    for (let s = 0; s < steps; s++) {
      let best = dist[iz * w + ix], bx = -1, bz = -1;
      for (let n = 0; n < 8; n++) {
        const nx = ix + NBX[n], nz = iz + NBZ[n];
        if (nx < 1 || nz < 1 || nx >= w - 1 || nz >= h - 1) continue;
        const v = dist[nz * w + nx];
        if (v < best) { best = v; bx = nx; bz = nz; }
      }
      if (bx < 0) break;
      ix = bx; iz = bz; moved = true;
      if (best === 0) break;
    }
    return moved ? iz * w + ix : -1;
  }
  CBZ.battleFlow = { solve: solve, step: step, MAXD: MAXD };
  if (typeof module !== "undefined" && module.exports) module.exports = CBZ.battleFlow;
})();
