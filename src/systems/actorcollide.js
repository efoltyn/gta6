/* ============================================================
   systems/actorcollide.js — runs AFTER movement each frame: stops
   every standing actor (guards + inmates) from walking through walls
   or crates, and pushes overlapping actors (including you) apart so
   nobody phases through anybody. KO'd/dead bodies are skipped so you
   can step over them.

   Separation is an O(n) spatial-hash (CBZ.makeGrid) — the same grid the
   survival bots use — so it scales to hundreds of inmates instead of the
   old O(n²) double loop (~500k checks/frame at 1000 actors). It's not
   full pathfinding, so an NPC may bump a wall its target is behind.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const R = 0.5;
  const CELL = 2.4;            // ~= the largest interaction diameter

  function standing(a) { return !a.dead && !(a.ko > 0) && !a.escaped; }
  function posOf(a) { return a._p ? a.pos : a.group.position; }
  function radOf(a) { return a._p ? a.r : R; }

  // reused every frame — no per-frame allocation
  let grid = null;
  const list = [];
  const playerEntry = { _p: true, pos: null, r: 0 };

  CBZ.onUpdate(25, function (dt) {
    if (CBZ.game.mode !== "escape") return; // survival uses its own grid separation
    if (!grid) grid = CBZ.makeGrid(CELL);

    list.length = 0;
    for (let i = 0; i < CBZ.guards.length; i++) { const g = CBZ.guards[i]; if (standing(g)) list.push(g); }
    for (let i = 0; i < CBZ.npcs.length; i++) { const n = CBZ.npcs[i]; if (standing(n) && !n._crowd) list.push(n); }
    if (!CBZ.player.dead) { playerEntry.pos = CBZ.player.pos; playerEntry.r = CBZ.player.radius; list.push(playerEntry); }

    // Shared human-contact rules block ordinary movement. A prison knockdown
    // requires an explicit combat action, never merely sprinting into someone.
    if (CBZ.humanContact) {
      CBZ.humanContact.resolve(list, dt, {
        mode: "escape",
        clamp(a) { CBZ.collide(posOf(a), radOf(a)); },
      });
      return;
    }

    grid.rebuild(list, posOf);

    // push overlapping actors apart, querying only the 3×3 neighbourhood
    for (let i = 0; i < list.length; i++) {
      const A = list[i], ap = posOf(A), ar = radOf(A);
      const gx = grid.cellIndex(ap.x), gz = grid.cellIndex(ap.z);
      for (let cx = gx - 1; cx <= gx + 1; cx++) for (let cz = gz - 1; cz <= gz + 1; cz++) {
        const a = grid.bucket(cx, cz); if (!a) continue;
        for (let k = 0; k < a.length; k++) {
          const B = a[k];
          if (B === A) continue;
          const bp = posOf(B);
          const dx = bp.x - ap.x, dz = bp.z - ap.z;
          const min = ar + radOf(B);
          const d2 = dx * dx + dz * dz;
          if (d2 < min * min && d2 > 1e-6) {
            const d = Math.sqrt(d2), push = ((min - d) / d) * 0.5;
            // never shove the player; only other actors yield
            if (!A._p) { ap.x -= dx * push; ap.z -= dz * push; }
            if (!B._p) { bp.x += dx * push; bp.z += dz * push; }
          }
        }
      }
    }

    // then clamp everyone back out of walls (including the player)
    for (let i = 0; i < list.length; i++) CBZ.collide(posOf(list[i]), radOf(list[i]));
  });
})();
