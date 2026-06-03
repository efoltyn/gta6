/* ============================================================
   systems/spatialgrid.js — CBZ.makeGrid(cell)

   A reusable uniform spatial hash for O(n) neighbour queries instead
   of O(n²). Used by escape-mode actor separation (actorcollide.js) and
   survival-mode bot separation (survivorbot.js) — and ready for AI
   neighbour scans.

   ALLOC-FREE after warm-up: one persistent Map (integer keys, never a
   string), bucket arrays pooled + cleared in place. No per-frame `new`.
   (Per the research: string keys + a fresh Map every frame are a GC
   firehose at thousands of agents.)

   Usage:
     const grid = CBZ.makeGrid(2.4);
     grid.rebuild(items, it => it.pos);        // pos = {x,z}
     const gx = grid.cellIndex(x), gz = grid.cellIndex(z);
     for (ix=gx-1..gx+1) for (iz=gz-1..iz+1) {
       const a = grid.bucket(ix, iz); if (!a) continue;
       for (k=0..a.length) ... a[k] ...
     }
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;

  const OFF = 32768;          // recentre cell coords so the integer key stays positive
  const SPAN = 65536;

  CBZ.makeGrid = function (cell) {
    const inv = 1 / cell;
    const buckets = new Map();   // intKey -> array (pooled, reused)
    const pool = [];             // free array list
    const used = [];             // arrays currently populated (reset next rebuild)

    function cellIndex(v) { return Math.floor(v * inv); }
    function keyOf(gx, gz) { return (gx + OFF) * SPAN + (gz + OFF); }

    return {
      cellIndex: cellIndex,

      // bucket the items by cell. getVec(item) -> {x,z}.
      rebuild: function (items, getVec, limit) {
        for (let i = 0; i < used.length; i++) { used[i].length = 0; pool.push(used[i]); }
        used.length = 0;
        buckets.clear();
        const n = limit == null ? items.length : Math.min(items.length, limit);
        for (let i = 0; i < n; i++) {
          const it = items[i];
          const v = getVec(it);
          const k = keyOf(Math.floor(v.x * inv), Math.floor(v.z * inv));
          let a = buckets.get(k);
          if (!a) { a = pool.pop() || []; buckets.set(k, a); used.push(a); }
          a.push(it);
        }
      },

      // the array of items in cell (gx,gz), or undefined.
      bucket: function (gx, gz) { return buckets.get(keyOf(gx, gz)); },
    };
  };
})();
