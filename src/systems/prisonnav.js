/* ============================================================
   systems/prisonnav.js — THE PRISON'S SIDE OF CBZ.navGrid.

   This file used to BE the navigator: the grid, the A*, the follower, all of
   it, written for escape mode when that was the only cast walking into walls.
   The city measured worse (56% of attempted movement against geometry, versus
   the prison's 24% at its worst), and the answer to "why do gang city NPCs run
   into walls" turned out to be the same answer, so the machinery moved to
   systems/navgrid.js where both games use one copy of it.

   What is genuinely the PRISON's, and stays here:
     · the window is the whole world — 252 m square, built in one 0.3 ms pass,
       and rebuilt whenever a door splices its wall in or out of CBZ.colliders
       (`watchColliders`), because in here a door is the whole story.
     · the per-frame plan budget for this cast.
   The call site itself is inside entities/npc.js's mover; see navGrid.step.

   Flag: CONFIG.PRISON_NAV_V1. Gate: tools/prison-nav-check.mjs.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;

  const PLANS_PER_FRAME = 2;

  function on() { return !CBZ.CONFIG || CBZ.CONFIG.PRISON_NAV_V1 !== false; }
  function reach() {
    const W = CBZ.WORLD;
    if (!W || W.minX == null) return 0;
    // one window over the whole wing, centred on it
    return Math.max(W.maxX - W.minX, W.maxZ - W.minZ) / 2 + 2;
  }
  function centre() {
    const W = CBZ.WORLD;
    return { x: (W.minX + W.maxX) / 2, z: (W.minZ + W.maxZ) / 2 };
  }

  // ready() is what entities/npc.js's mover asks before handing a body over
  CBZ.prisonNav = {
    ready: function () {
      const G = CBZ.navGrid;
      return !!(G && on() && CBZ.game && CBZ.game.mode === "escape" && G.ready());
    },
    // the mover's per-body call; keeps npc.js free of grid vocabulary
    step: function (n, dt) {
      const G = CBZ.navGrid;
      if (!G || !on()) return false;
      if (!n || !n.group || !n.target || n.dead || (n.ko > 0) || n.escaped || n._crowd) return false;
      if (n._propLie || n._propBed || n._propSeat) return false;
      if (CBZ.propArcActive && CBZ.propArcActive(n)) return false;
      if (n.char && (n.char.sitting || n.char.lying)) return false;
      return G.step(n, n.group.position, n.target, dt, {
        speed: n._spd != null ? n._spd : (n.speed || 1.8),
        wait: function (a, s) { a.pause = Math.max(a.pause || 0, s); },
      });
    },
    owns: function (n) { return !!(CBZ.navGrid && CBZ.navGrid.owns(n)); },
    plan: function (from, to, opts) { return CBZ.navGrid ? CBZ.navGrid.plan(from, to, opts) : null; },
    lineBlocked: function (a, b, c, d, e) { return CBZ.navGrid ? CBZ.navGrid.lineBlocked(a, b, c, d, e) : false; },
    standable: function (x, z) { return CBZ.navGrid ? CBZ.navGrid.standable(x, z) : true; },
    // systems/navigation.js's escapeRoute (the player's map arrows) calls this
    // before planning, to be sure the wing's grid is up
    ensure: function () {
      const G = CBZ.navGrid;
      if (!G || !on() || !CBZ.WORLD) return false;
      const c = centre();
      return G.focus(c.x, c.z, reach(), { watchColliders: true });
    },
  };

  // the frame hook: hold the wing's window open and share the plan budget out
  CBZ.onUpdate(21.75, function () {
    const G = CBZ.navGrid, g = CBZ.game;
    if (!G) return;
    if (!on() || !g || g.mode !== "escape" || g.state !== "playing" || !CBZ.WORLD) { G.idle(); return; }
    const c = centre();
    if (!G.focus(c.x, c.z, reach(), { watchColliders: true })) { G.idle(); return; }
    G.frame(PLANS_PER_FRAME);
  });

  CBZ.prisonNavAudit = function () { return CBZ.navGridAudit ? CBZ.navGridAudit() : {}; };
})();
