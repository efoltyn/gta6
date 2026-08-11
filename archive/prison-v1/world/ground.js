/* ============================================================
   world/ground.js — base terrain, grass yard, concrete cell floor

   PRISON_GROUND_V2 (owner, verbatim: "the checkered ground is dumb").
   Every outdoor surface in the compound was a two-tone checker — the
   universal debug texture — so the yard read as an untextured placeholder
   however good the props standing on it were. This file now dresses the
   same planes, in the same places, at the same sizes, with the shared
   institutional generator CBZ.prisonGroundTex (world/materials.js):
   worn turf, real bitumen, and a poured pad under the basketball hoop
   that has stood on bare grass since props.js drew it.

   THIS IS A MATERIAL CHANGE. Not one geometry dimension, position or
   collider moves; the only additions are a decorative court pad and a
   handful of thin painted line boxes, all `cast:false` and none solid.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const scene = CBZ.prisonRoot || CBZ.scene;
  const { mat, addBox, checkerTex, concreteTex } = CBZ;
  CBZ.CONFIG = CBZ.CONFIG || {};

  // On  -> institutional ground (worn turf / asphalt / painted court).
  // Off -> the exact checker path this file shipped with, byte for byte:
  //        same planes, same positions, same repeats, same materials.
  // Declared HERE rather than in config.js: config.js is a known Edit-race
  // file and this flag has exactly one owner.
  if (CBZ.CONFIG.PRISON_GROUND_V2 == null) CBZ.CONFIG.PRISON_GROUND_V2 = true;
  // Degrade-safe: an older materials.js with no generator falls straight back
  // to the checker, so this file can never break on a partial merge.
  const V2 = !!(CBZ.CONFIG.PRISON_GROUND_V2 && CBZ.prisonGroundTex);

  // huge base ground so the world continues past the exit gate
  let baseMat;
  if (V2) {
    // The country outside the wall was one flat green sheet. Same mean colour
    // (0x4ea84e), now with slow relief in it. ~26 m tile over the 420x520
    // plane — nobody walks here until the gate opens, so the tile is large.
    const field = CBZ.prisonGroundTex("field-grass");
    field.repeat.set(16, 20);
    baseMat = new THREE.MeshLambertMaterial({ map: field });
  } else {
    baseMat = mat(0x4ea84e);
  }
  const base = new THREE.Mesh(new THREE.PlaneGeometry(420, 520), baseMat);
  base.rotation.x = -Math.PI / 2;
  base.position.set(0, -0.02, 40);
  base.receiveShadow = true;
  scene.add(base);

  // yard grass — worn exercise-yard turf (was: a 4 m checker)
  const grass = V2
    ? CBZ.prisonGroundTex("yard-grass")
    : checkerTex(CBZ.COL.GRASS_A, CBZ.COL.GRASS_B, 2);
  // 5 -> a 12 m tile across the 60 m yard. The old 15 put a 4 m draughts
  // square under your feet; a mottle needs a tile bigger than the eye's
  // pattern-finding window, not smaller.
  if (V2) grass.repeat.set(5, 5); else grass.repeat.set(15, 15);
  const yard = new THREE.Mesh(
    new THREE.PlaneGeometry(60, 60),
    new THREE.MeshLambertMaterial({ map: grass })
  );
  yard.rotation.x = -Math.PI / 2;
  yard.position.set(0, 0, 22);
  yard.receiveShadow = true;
  scene.add(yard);

  // ============================================================
  //  THERE IS NO ROAD THROUGH THE JAIL (CBZ.CONFIG.PRISON_ROAD_FIX).
  //
  //  OWNER: "there's a road going through the jail." He is looking at THIS, and
  //  he is right — it is not a city road record, it is the compound's own
  //  paving, and it was built at road dimensions:
  //
  //      NINE METRES WIDE, 132 m long (this 56 m run plus world/southblock.js's
  //      76 m continuation), dark bitumen, with a CONTINUOUS WHITE LINE painted
  //      down each edge at x = ±4.15.
  //
  //  Nine metres is two full traffic lanes. A continuous white edge line on a
  //  9 m bitumen band IS a carriageway — that is what the marking MEANS — so
  //  from the tower, or from the air, the compound reads as bisected by a
  //  highway. Nothing was wrong with the code; the NUMBER was a road's number.
  //
  //  A prison walkway is a supervised FOOTPATH: two men abreast with an escort,
  //  which is 2.8 m, kerbed so the yard cannot spill onto it. So the width goes
  //  to 2.8, the two lane lines become a real KERB (a low concrete edge, the
  //  thing that actually separates a path from a yard), and 6.2 m of asphalt
  //  goes back to being exercise yard. NOT ONE COLLIDER MOVES — the path was
  //  never solid — and the kerb is deliberately not solid either: an escort
  //  walks over it and a man tripping on scenery is the other kind of bug.
  //
  //  The width is PUBLISHED (CBZ.prisonWalkway) because world/southblock.js
  //  draws the other 76 m of the same path and the two must never disagree
  //  again. Flag off restores the 9 m band and both lane lines exactly.
  // ============================================================
  if (CBZ.CONFIG.PRISON_ROAD_FIX == null) CBZ.CONFIG.PRISON_ROAD_FIX = true;
  const ROADFIX = CBZ.CONFIG.PRISON_ROAD_FIX !== false;
  const WALK_W = ROADFIX ? 2.8 : 9;
  CBZ.prisonWalkway = { w: WALK_W, fixed: ROADFIX, legacyW: 9 };

  // central asphalt walkway from the cell door toward the exit
  const asphalt = V2
    ? CBZ.prisonGroundTex("asphalt")
    : checkerTex(CBZ.COL.ASPHALT_A, CBZ.COL.ASPHALT_B, 2);
  // the tile stays SQUARE as the path narrows — the repeat is derived from the
  // width rather than retyped, so a future width change cannot stretch it.
  if (V2) asphalt.repeat.set(1, Math.max(1, Math.round(56 / WALK_W) / 1)); else asphalt.repeat.set(2, 12);
  if (V2 && ROADFIX) asphalt.repeat.set(1, 20);
  const path = new THREE.Mesh(
    new THREE.PlaneGeometry(WALK_W, 56),
    new THREE.MeshLambertMaterial({ map: asphalt })
  );
  path.rotation.x = -Math.PI / 2;
  path.position.set(0, 0.01, 24);
  path.receiveShadow = true;
  scene.add(path);
  // THE KERB — what tells you this is a path and not a lane. 0.12 high, one
  // 56 m box a side, cast:false and NOT solid.
  if (ROADFIX) {
    for (const sx of [-1, 1]) {
      addBox(sx * (WALK_W / 2 + 0.09), 0.06, 24, 0.18, 0.12, 56, 0xa9a294, { cast: false });
    }
  }

  // cell-block concrete floor
  // DELIBERATELY UNTOUCHED. It is not a checker, and world/cellblock.js is
  // being rewritten in this same wave — the floor under it stays exactly what
  // that work expects. (It is still the compound's last legacy ground map, so
  // CBZ.prisonGroundAudit().legacy counts it: that is the debt, honestly.)
  const ctex = concreteTex("#6e7682", "#3b424c");
  ctex.repeat.set(8, 9);
  const cell = new THREE.Mesh(
    new THREE.BoxGeometry(32, 0.1, 36),
    new THREE.MeshLambertMaterial({ map: ctex })
  );
  cell.position.set(0, -0.04, -26);
  cell.receiveShadow = true;
  scene.add(cell);

  // ============================================================
  //  PAINTED GROUND — what an institution actually puts on its ground.
  //  Nothing below is solid and nothing casts: `addBox(..., {cast:false})`
  //  with no `solid`, so CBZ.colliders is untouched, and the meshes carry
  //  empty userData so core/batch.js merges them into the static shell.
  //  Every coordinate is authored against fittings that already exist
  //  (props.js's hoop at -28,14; the 9 m walkway; the yard walls in
  //  config.js's CBZ.WORLD.northYard, x[-30,30] z[-8,52]).
  // ============================================================
  if (V2) {
    const PAINT = 0xe7e2d2;   // the same worn white southblock.js paints with
    const YEL = 0xe2c049;     // and its yellow
    // y = 0.04 (a 0.02 slab, so 0.03..0.05): clear of the yard plane (0) and
    // of the walkway/court pad (0.01). The height southblock.js already paints
    // its own court lines at.
    const paint = (x, z, w, d, c) => addBox(x, 0.04, z, w, 0.02, d, c, { cast: false });

    // ---- the basketball pad ------------------------------------------------
    // props.js stands a 5 m hoop at (-28, 14) on bare grass, with the rim
    // overhanging +x. A yard court is a POURED PAD, so it gets one: 12.4 x 13.6
    // of darker asphalt, tucked 0.9 m off the west wall face (x=-29.5) and
    // ending 11.7 m short of the walkway (x=-4.5). y=0.01 is the SAME lift the
    // walkway already uses over the yard plane — a margin this scene has
    // proven does not z-fight — and the two never overlap in x, so they cannot
    // fight each other either.
    // Same asphalt CANVAS as the walkway (one cached bake, not a second one) —
    // the pad is told apart by a darker material tint, which is also what a
    // court that never gets resurfaced actually looks like next to a swept path.
    const padTex = CBZ.prisonGroundTex("asphalt");
    padTex.repeat.set(1.4, 1.5);
    const pad = new THREE.Mesh(
      new THREE.PlaneGeometry(12.4, 13.6),
      new THREE.MeshLambertMaterial({ map: padTex, color: 0xcfd3d8 })
    );
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(-22.4, 0.01, 14);
    pad.receiveShadow = true;
    scene.add(pad);

    // half-court markings, FIBA proportions squeezed to the pad: the key is
    // 4.9 wide x 5.8 deep and the free-throw circle is r=1.8, which is why
    // those three numbers are not round.
    paint(-28.4, 14, 0.14, 13.0, PAINT);     // baseline, behind the backboard
    paint(-22.4, 7.5, 12.0, 0.14, PAINT);    // sideline, north
    paint(-22.4, 20.5, 12.0, 0.14, PAINT);   // sideline, south
    paint(-16.4, 14, 0.14, 13.0, PAINT);     // half-court line
    paint(-25.5, 11.55, 5.8, 0.12, PAINT);   // key, north edge
    paint(-25.5, 16.45, 5.8, 0.12, PAINT);   // key, south edge
    paint(-22.6, 14, 0.12, 4.9, PAINT);      // free-throw line
    for (let i = 0; i < 7; i++) {            // free-throw arc, dabbed
      const a = (-1 + (i / 6) * 2) * 1.22;   // +-70 deg about +x
      paint(-22.6 + Math.cos(a) * 1.8, 14 + Math.sin(a) * 1.8, 0.22, 0.22, PAINT);
    }

    // ---- walkway edge lines ------------------------------------------------
    // ONLY on the legacy 9 m band. A continuous white line down each side of a
    // nine-metre bitumen strip is the marking that made this read as a road;
    // with PRISON_ROAD_FIX on, the kerb above does the job that paint was
    // failing to do, and no lane markings are drawn inside a prison at all.
    if (!ROADFIX) {
      paint(-4.15, 24, 0.14, 55, PAINT);
      paint(4.15, 24, 0.14, 55, PAINT);
    }

    // ---- the dead line -----------------------------------------------------
    // The painted limit an inmate may not cross. The WEST wall is the
    // recreation wall (hoop, gym, barrels) and gets the court instead; the
    // east run and the two north returns either side of the cell block are
    // bare, and get the line.
    paint(28.3, 21.5, 0.16, 57, YEL);        // east wall,  z[-7, 50]
    paint(-23, -6.8, 13, 0.16, YEL);         // north return, x[-29.5, -16.5]
    paint(23, -6.8, 13, 0.16, YEL);          // north return, x[16.5, 29.5]
  }
})();
