/* ============================================================
   systems/npcgrid.js - shared rich-NPC neighbourhood index.

   The full social brain asks "who is nearby?" often. A uniform grid keeps
   those local decisions local instead of scanning the whole inmate list for
   every actor. The index is rebuilt once per frame and query output arrays
   are supplied by callers, so hot paths do not allocate garbage.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.makeGrid) return;

  const CELL = 10;
  const grid = CBZ.makeGrid(CELL);
  let ready = false;

  function posOf(n) { return n.group.position; }

  function rebuild() {
    grid.rebuild(CBZ.npcs, posOf);
    ready = true;
  }

  CBZ.queryNpcsNear = function (x, z, radius, out) {
    out = out || [];
    out.length = 0;
    if (!ready) rebuild();
    const span = Math.ceil(radius / CELL);
    const gx = grid.cellIndex(x), gz = grid.cellIndex(z);
    const r2 = radius * radius;
    for (let cx = gx - span; cx <= gx + span; cx++) {
      for (let cz = gz - span; cz <= gz + span; cz++) {
        const bucket = grid.bucket(cx, cz);
        if (!bucket) continue;
        for (let i = 0; i < bucket.length; i++) {
          const n = bucket[i];
          const p = n.group.position;
          const dx = p.x - x, dz = p.z - z;
          if (dx * dx + dz * dz <= r2) out.push(n);
        }
      }
    }
    return out;
  };

  // NPC movement runs at order 22. This index is intentionally rebuilt just
  // before it: queries see last frame's settled positions, which is accurate
  // enough for social steering and avoids rebuilding once per thinker.
  CBZ.onUpdate(21.7, function () {
    if (CBZ.game.mode === "escape") rebuild();
  });
})();
