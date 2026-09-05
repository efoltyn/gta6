/* ============================================================
   world/towers.js — the eight guard towers on the old compound's walls.

   WHAT THEY WERE (to 2026-09-04): a 2.2 m box on a 6 m stilt with a 1.1 m
   slab on top, standing on the line of an 11 m wall. Their cabins were
   five metres BELOW the wall's coping — from the exercise yard not one of
   the eight was visible (prison-exterior preset, tower-yard shot: wall,
   sky, nothing). They existed as CBZ.towers fire-origin markers for
   systems/capture.js and as eight mounts for entities/searchlight.js.

   WHAT THEY ARE: world/prisonkit.js's CBZ.guardTower, deck at
   CBZ.TOWER_DECK (wall + 1.5 m): a poured-concrete shaft straddling the
   wall, a railed steel deck, a glazed octagonal cabin, a hipped roof with
   the searchlight on its finial, a floodlight under the eave aimed into
   the yard, and a caged rung ladder up the yard face. The CBZ.towers
   records are unchanged in number and position, so capture.js fires from
   exactly where it did.

   The ladder is still a registered z/x-axis ramp in CBZ.platforms;
   systems/physics.js skips platforms in escape mode, so it is honest
   geometry and a record, not a climb — the day that gate lifts, the deck
   is standable with no change here.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.guardTower || !CBZ.WORLD) return;
  const { WORLD } = CBZ;
  const N = WORLD.northYard, S = WORLD.southBlock, EZ = WORLD.exit.z;
  const d = 0.7071;

  // the ladder and the eave light face INTO the compound at each post
  CBZ.guardTower(N.x0, N.z0, { face: { x: d, z: d } });      // north yard, NW corner
  CBZ.guardTower(N.x1, N.z0, { face: { x: -d, z: d } });     // NE corner
  CBZ.guardTower(N.x0, N.z1, { face: { x: d, z: d } });      // the step junction, west
  CBZ.guardTower(N.x1, N.z1, { face: { x: -d, z: d } });     // east
  CBZ.guardTower(S.x0, (S.z0 + S.z1) / 2, { face: { x: 0, z: -1 } });   // south block, mid-west wall
  CBZ.guardTower(S.x1, (S.z0 + S.z1) / 2, { face: { x: 0, z: -1 } });   // mid-east wall
  CBZ.guardTower(S.x0, EZ, { face: { x: d, z: -d } });       // flanking the freedom gate
  CBZ.guardTower(S.x1, EZ, { face: { x: -d, z: -d } });
})();
