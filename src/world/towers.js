/* ============================================================
   world/towers.js — the eight guard towers on the old compound's walls.

   WHAT THEY WERE (to 2026-09-04): a 2.2 m box on a 6 m stilt with a 1.1 m
   slab on top, standing on the line of an 11 m wall. Their cabins were
   five metres BELOW the wall's coping — from the exercise yard not one of
   the eight was visible (prison-exterior preset, tower-yard shot: wall,
   sky, nothing). They existed as CBZ.towers fire-origin markers for
   systems/capture.js and as eight mounts for entities/searchlight.js.

   WHAT THEY ARE: world/prisonkit.js's CBZ.guardTower (read its section 5
   for what a real one is and what these were until 2026-09-29), stood on
   the wall line at each post and set back off it into the compound: a
   hollow concrete shaft with a steel door at its foot and a ladder up its
   inside to a hatch in the cab floor, a glazed octagonal cab on a railed
   catwalk cantilevered out over the wall, a hipped roof with the
   searchlight on its finial, a floodlight under the eave aimed into the
   yard. Deck at CBZ.TOWER_DECK (wall + 1.5 m).

   The two flanking the freedom gate stand on the OUTER wire (the south wall
   is the perimeter there): over their rail on the south side is out.
   Every wall tower has an officer on post (entities/towerwatch.js).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.guardTower || !CBZ.WORLD) return;
  const { WORLD } = CBZ;
  const N = WORLD.northYard, S = WORLD.southBlock, EZ = WORLD.exit.z;

  // (x, z) is the post ON the wall line; `inward` is the compound's side of
  // it (a corner: both axes), and the post looks that way
  const OUT = { x: 0, z: 1 };                                  // south of the freedom gate is out
  CBZ.guardTower(N.x0, N.z0, { inward: { x: 1, z: 1 } });      // north yard, NW corner
  CBZ.guardTower(N.x1, N.z0, { inward: { x: -1, z: 1 } });     // NE corner
  CBZ.guardTower(N.x0, N.z1, { inward: { x: 1, z: 1 } });      // the step junction, west
  CBZ.guardTower(N.x1, N.z1, { inward: { x: -1, z: 1 } });     // east
  // the south block's side walls: 14 m south of the lower yard gates (z 84),
  // so the catwalk does not hang over the gate's door set
  const SM = 98;
  CBZ.guardTower(S.x0, SM, { inward: { x: 1, z: 0 } });        // south block, west wall
  CBZ.guardTower(S.x1, SM, { inward: { x: -1, z: 0 } });       // east wall
  CBZ.guardTower(S.x0, EZ, { inward: { x: 1, z: -1 }, perimeter: OUT });  // flanking the freedom gate
  CBZ.guardTower(S.x1, EZ, { inward: { x: -1, z: -1 }, perimeter: OUT });
})();
