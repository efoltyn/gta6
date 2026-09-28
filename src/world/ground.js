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
  const { addBox } = CBZ;
  // Every flat patch below overlaps another (base under yard, walkway on
  // yard) a centimetre or two apart, which a 0.1..1000 depth range cannot
  // separate past ~50 m: the dark walkway's edges shimmered and stair-stepped
  // through the yard. world/prisonkit.js owns the one layer rule.
  const layer = (m, y) => (CBZ.groundLayer ? CBZ.groundLayer(m, y) : m);
  CBZ.CONFIG = CBZ.CONFIG || {};

  // The checker path (PRISON_GROUND_V2 off) is deleted: git is the undo.
  // world/materials.js's CBZ.prisonGroundTex is the one ground author.
  // (world/prisonwings.js still gates its ground on this flag reading true.)
  CBZ.CONFIG.PRISON_GROUND_V2 = true;
  const GT = CBZ.prisonGroundTex;
  if (!GT) return;

  // huge base ground so the world continues past the exit gate
  let baseMat;
  {
    // The country outside the wall was one flat green sheet. Same mean colour
    // (0x4ea84e), now with slow relief in it. ~26 m tile over the 420x520
    // plane — nobody walks here until the gate opens, so the tile is large.
    // 2026-09-27: the city's #57b257 lawn read as mint under the yard fog; a
    // prison's country is rough, dry pasture. Prison-only tones, passed in.
    const field = GT("field-grass", { a: "#6a7a44", b: "#5b6b3a" });
    field.repeat.set(16, 20);
    baseMat = new THREE.MeshLambertMaterial({ map: field });
  }
  const base = new THREE.Mesh(new THREE.PlaneGeometry(420, 520), layer(baseMat, -0.02));
  base.rotation.x = -Math.PI / 2;
  base.position.set(0, -0.02, 40);
  base.receiveShadow = true;
  scene.add(base);

  // yard grass — worn exercise-yard turf (was: a 4 m checker)
  const grass = GT("yard-grass", { a: "#6f7f45", b: "#5d6c3a", wear: 0.72 });
  // 5 -> a 12 m tile across the 60 m yard. The old 15 put a 4 m draughts
  // square under your feet; a mottle needs a tile bigger than the eye's
  // pattern-finding window, not smaller.
  grass.repeat.set(5, 5);
  const yard = new THREE.Mesh(
    new THREE.PlaneGeometry(60, 60),
    layer(new THREE.MeshLambertMaterial({ map: grass }), 0)
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
  //  again.
  // ============================================================
  const WALK_W = 2.8;
  CBZ.prisonWalkway = { w: WALK_W, fixed: true, legacyW: 9 };

  // central asphalt walkway from the cell door toward the exit
  const asphalt = GT("asphalt", { a: "#4e5257", b: "#474b50", srgb: true });
  // the tile stays SQUARE as the path narrows — the repeat is derived from the
  // width rather than retyped, so a future width change cannot stretch it.
  // A 6.3 m square tile, the same as every other paving patch (prisonkit's
  // ground()); the old 1 x 20 on a 2.8 m path was a 2.8 x 2.8 tile, the
  // bitumen grain repeated twenty times down the path you walk.
  asphalt.repeat.set(WALK_W / 6.3, 56 / 6.3);
  const path = new THREE.Mesh(
    new THREE.PlaneGeometry(WALK_W, 56),
    layer(new THREE.MeshLambertMaterial({ map: asphalt }), 0.02)
  );
  path.rotation.x = -Math.PI / 2;
  path.position.set(0, 0.02, 24);
  path.receiveShadow = true;
  scene.add(path);
  // NO KERB (2026-09-27). The 0.18 x 0.12 pale boxes down both edges read,
  // at a phone's eye height, as two raised white bars running the length of
  // the yard (owner: "lines on ground are dumb"). Bitumen laid into a yard
  // needs no curb; its edge against the turf is the edge.

  // cell-block concrete floor — the tier's own slab.
  // This was the compound's LAST legacy ground map (a 128 px speck canvas
  // tiled every 4 m, blue-grey, no joints), left alone while the wing was
  // rewritten around it. The wing is done; the floor now gets the same
  // institutional verb as every other poured surface in the compound —
  // a 6.3 m panel with real expansion joints, pore speckle and staining —
  // in a neutral, slightly warm concrete instead of the old blue. The tones
  // are the wing's own partition greys (world/cellblock.js C_PART_D 0x767f8a
  // shaded down), so the floor reads as the same pour as the walls standing
  // on it rather than a different material laid under them.
  const ctex = GT("concrete", { a: "#676d75", b: "#5c626a", wear: 0.10, crack: 0 });
  ctex.repeat.set(Math.round(32 / 6.3), Math.round(36 / 6.3));
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
  {
    const YEL = 0xb9a052;     // worn safety yellow, not a fresh tin
    // y = 0.04 (a 0.02 slab, so 0.03..0.05): clear of the yard plane (0) and
    // of the walkway/court pad (0.01). The height southblock.js already paints
    // its own court lines at.
    // FLUSH: 4 mm thick, top at 0.014 (3-4 mm over the yard and the pad).
    // It was a 2 cm box with its top at 5 cm: a curb, not paint.
    const paint = (x, z, w, d, c) => addBox(x, 0.012, z, w, 0.004, d, c, { cast: false });

    // ---- (no basketball pad) ----------------------------------------------
    // The 12.4 x 13.6 m court pad and its lines were laid at (-22.4, 14), i.e.
    // on the mess hall's own footprint (world/cafeteria.js x[-29,-19]
    // z[6,22]): a hoop and a painted key stood INSIDE the dining room. The
    // lower yard (world/southblock.js) and the recreation yard (world/
    // prisongrounds.js) have the prison's real courts. Deleted 2026-09-27.

    // ---- the dead line -----------------------------------------------------
    // The painted limit an inmate may not cross. The WEST wall is the
    // recreation wall (hoop, gym, barrels) and gets the court instead; the
    // east run and the two north returns either side of the cell block are
    // bare, and get the line.
    paint(28.3, 21.5, 0.1, 57, YEL);         // east wall,  z[-7, 50]
    paint(-23, -6.8, 13, 0.1, YEL);          // north return, x[-29.5, -16.5]
    paint(23, -6.8, 13, 0.1, YEL);           // north return, x[16.5, 29.5]
  }
})();
