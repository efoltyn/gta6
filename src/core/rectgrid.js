/* ============================================================
   core/rectgrid.js — A GRID INDEX OVER RECTS, for the build's field scans.

   The world build asks "which regions / roads / surfaces touch this point"
   hundreds of thousands of times (the continent plate: 224k vertices, the
   river router: every 80 m cell), and each asker scanned the whole list.
   CBZ.rectGrid files each item under the cells its rect, grown by `pad`,
   touches; list(x, z) returns only that cell's items, IN ASCENDING INDEX
   ORDER, so a first-match or any/min scan over it answers exactly what the
   full scan did (as long as the query's reach is within `pad`: callers fall
   back to the full list past it).

     const G = CBZ.rectGrid(n, i => [minX, maxX, minZ, maxZ] | null, pad, cell?)
     for (const i of G.list(x, z)) ...
   A null rect (unbounded) is in every list.
============================================================ */
(function () {
  "use strict";
  const CBZ = (window.CBZ = window.CBZ || {});
  CBZ.rectGrid = function (n, rectOf, pad, cell) {
    const C = cell || 256, map = new Map(), big = [];
    for (let i = 0; i < n; i++) {
      const r = rectOf(i);
      if (!r || !(r[1] >= r[0]) || !(r[3] >= r[2])) { big.push(i); continue; }
      const x0 = Math.floor((r[0] - pad) / C), x1 = Math.floor((r[1] + pad) / C);
      const z0 = Math.floor((r[2] - pad) / C), z1 = Math.floor((r[3] + pad) / C);
      if ((x1 - x0 + 1) * (z1 - z0 + 1) > 400) { big.push(i); continue; }
      for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) {
        const k = cx * 100003 + cz; let l = map.get(k); if (!l) map.set(k, l = []); l.push(i);
      }
    }
    if (big.length) map.forEach(function (l, k) { const m = l.concat(big); m.sort(function (a, b) { return a - b; }); map.set(k, m); });
    const EMPTY = big.slice();
    return { pad: pad, n: n, list: function (x, z) { return map.get(Math.floor(x / C) * 100003 + Math.floor(z / C)) || EMPTY; } };
  };
})();
