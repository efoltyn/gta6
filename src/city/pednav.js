/* ============================================================
   city/pednav.js — THE CITY'S SIDE OF CBZ.navGrid.

   OWNER: "why gang city ncs often run into walls instead of ... SIMPLY
   BUMPING AND ADJUSTING OR BEING SMARTER ... my vision with npc war."

   MEASURED, calm street, 683 pedestrians, ten seconds: 56% of all attempted
   movement was a body pressed into geometry, with 37 of them grinding for more
   than 1.5 s of the sample. Not edge cases either — a gang enforcer with his
   goal four metres away and a wall between them, standing in it the whole
   time; two soldiers doing the same; office workers 250 m from a goal three
   blocks away, walking into the same facade for ten seconds.

   city/peds.js is not short of steering. It has context steering, look-ahead
   probes, separation, path following, and a 0.45 s stuck timer. What it did
   NOT have is a route: when the straight line is a building, the stuck timer
   either sidesteps at random or throws the errand away and rolls a new one,
   which is a body with no memory re-deciding twice a second. cityNav.routeTo
   only knows street centrelines, and only the flee and raid callers ask it.

   This file gives the city the same thing the prison got, from the same
   grid — with one difference that matters. THE CITY IS EIGHT KILOMETRES WIDE
   and carries 123,072 colliders; a global 0.4 m grid would be four hundred
   million cells. So the window is 320 m of it, following the player: bigger
   than anything anyone can see (peds stop drawing at 95 m), rebuilt when he
   leaves the middle, and marked across frames so a rebuild is never a hitch.
   Bodies outside the window keep exactly the behaviour they have today.

   Flag: CONFIG.CITY_NAV_V1 (?cfg_CITY_NAV_V1=0). Gate: tools/city-nav-check.mjs.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;

  const HALF = 160;            // window half-extent, metres (320 m square)
  const PLANS_PER_FRAME = 8;   // shared by the whole crowd...
  const PLAN_MS_PER_FRAME = 2.5;   // ...but the millisecond cap is the real one

  // States that MEAN to walk somewhere. A vendor at his stall, a boxer in his
  // ring and a worker at a desk all hold a spot with a goal a few metres off,
  // and standing still is the correct behaviour for them — routing those is
  // how you get a city that fidgets.
  const WALKING = {
    walk: 1, flee: 1, fight: 1, charge: 1, stalk: 1, confront: 1,
    film: 1, loot: 1, wander: 1, chase: 1,
  };

  function on() { return !CBZ.CONFIG || CBZ.CONFIG.CITY_NAV_V1 !== false; }

  function movable(p) {
    return !!(p && p.pos && p.target && !p.dead && !(p.ko > 0) && !p.inCar
      && !p.controlled && !p.vendor && !p.staffPost && !p._parked
      && !p._traversal && !(p.enterT > 0) && !(p.char && p.char.sitting)
      && WALKING[p.state]);
  }

  // the mover's per-body call (city/peds.js move(), just before it takes its
  // heading off `target`)
  function step(ped, dt) {
    const G = CBZ.navGrid;
    if (!G || !on() || !movable(ped)) return false;
    return G.step(ped, ped.pos, ped.target, dt, {
      speed: ped.speed || ped.baseSpeed || 1.6,
      // a fighter's mark and a fleeing body's exit both wobble; hold the route
      slack: ped.state === "fight" || ped.state === "flee" ? 3.5 : 2.5,
      wait: function (a, s) { a.pause = Math.max(a.pause || 0, s); },
    });
  }

  CBZ.pedNav = {
    step: step,
    owns: function (ped) { return !!(CBZ.navGrid && CBZ.navGrid.owns(ped)); },
    on: on,
  };

  // ONE window per frame, centred on the player, and the shared plan budget.
  // Ahead of city/peds.js's own updater (34) so the grid is current when the
  // first body asks it a question.
  CBZ.onUpdate(33.6, function () {
    const G = CBZ.navGrid, g = CBZ.game;
    if (!G) return;
    if (!on() || !g || g.mode !== "city" || g.state !== "playing" || !CBZ.player) { G.idle(); return; }
    const P = CBZ.player.pos;
    // COARSE_OVER: a city errand is routinely two hundred metres away and a
    // 0.4 m search cannot see past forty; anything longer than a block is
    // answered on the window's 1.6 m tier and string-pulled back against the
    // fine one. (The prison never sets this: fine A* reaches its whole world.)
    if (!G.focus(P.x, P.z, HALF, { coarseOver: 34 })) { G.idle(); return; }
    G.frame(PLANS_PER_FRAME, PLAN_MS_PER_FRAME);
  });
})();
