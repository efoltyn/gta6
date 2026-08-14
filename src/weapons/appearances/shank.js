/* ============================================================
   weapons/appearances/shank.js — the improvised prison blade.

   WHY THIS IS NOT city/itemassets.js's `melee` knife. That branch draws a
   KNIFE: a symmetric blade, a moulded handle and a finger guard — a thing
   bought in a shop. A shank is the opposite object. Nobody issued it, nobody
   finished it, and every one of its shapes is an apology for a missing tool:

     · the blade is a STRIP OF SCAVENGED STOCK — bed-frame flat bar, a strap
       hinge, the spine of a mess-hall spoon — ground to a point on a floor.
       So it is flat, it is uneven, its taper is asymmetric (ground harder on
       one side because you grind where you can reach), and only the last
       inch of one edge is bright. The rest is dull, scratched, oxidised;
     · there is NO GUARD. A guard is a machining operation. What stops the
       hand is a fat wad of wrapped cloth, which is also the only thing
       standing between the palm and an unfinished tang;
     · the GRIP IS THE TELL and it is what the eye reads at 2 m: strip torn
       from a bedsheet, wound wet, layer over layer, so it is lumpy, it is
       dirty, and the wraps do not line up. The loose tail is left long —
       you re-wrap it every few days and you never cut it.

   Authored on this file family's convention: long axis on Z with the working
   end at -Z (systems/actorweapons.js's hand-mount transform puts -Z past the
   fingers), grip toward +Z where the fist closes. `userData.muzzle` is the
   POINT — the one place a consumer that thinks in barrels can ask this weapon
   where its business end is, so prisondrops' ground solve, the icon camera and
   the stab's reach all read the same tip instead of three guesses.

   Perf: boxes/cyls on the caller's shared cached-geometry helpers, plus three
   local materials (the wrap and the two steels have no twin in `mat`). Cheap
   enough that every inmate in a wing can carry one.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ = window.CBZ || {};
  CBZ.weaponAppearance = CBZ.weaponAppearance || {};

  // Local to this model, built once, shared by every shank in the world.
  let LOCAL = null;
  function locals(THREE) {
    if (LOCAL) return LOCAL;
    /* These are DARK on purpose, and it was measured rather than chosen. The
       first pass authored the stock at 0x6c757e and the wrap at 0x9a927f —
       correct-sounding "grey steel" and "dirty cloth" — and the storyboard
       plate came back with the whole object dissolving into the yard, because
       a prison yard is white concrete under a noon sun and mid-grey on
       near-white is no silhouette at all. Scavenged bar stock is oxidised
       nearly black anyway; the only bright thing on a shank is the few square
       centimetres somebody has actually ground, which is exactly the contrast
       that makes the object legible at 2 m in a fist. */
    LOCAL = {
      // scavenged stock: dark, oxidised, nothing like a polished blade
      stock: new THREE.MeshLambertMaterial({ color: 0x3b424b }),
      // the ground facet — the only fresh metal on it, and the only bright note
      honed: new THREE.MeshLambertMaterial({ color: 0xc4cfd8 }),
      // bedsheet strip, worn filthy at the palm
      wrap: new THREE.MeshLambertMaterial({ color: 0x6d6555 }),
      wrapDark: new THREE.MeshLambertMaterial({ color: 0x453f34 }),
    };
    Object.keys(LOCAL).forEach((k) => { LOCAL[k]._shared = true; });
    return LOCAL;
  }

  CBZ.weaponAppearance.shank = function (ctx) {
    const { THREE, box, cyl } = ctx;
    const L = locals(THREE);
    const g = new THREE.Group();

    /* ---- BLADE: flat stock, ~0.30 long, WIDE and thin ---------------------
       Two overlapping boxes rather than one: the forward half is narrower and
       sits a hair off-axis, which is what a hand-ground taper actually looks
       like. A single symmetric box reads as a machined blank.

       The width matters more than it looks like it should. Authored thin
       (3 cm wide, 7 mm thick) this read as a NAIL in a fist at 2 m — a spike,
       not an edge — because the only silhouette a narrow bar can offer at that
       distance is its thickness. Flat bar is FLAT: wide enough to show a face,
       thin enough that the face disappears when the wrist rolls. That contrast
       is what says "ground out of something" rather than "bought". */
    box(g, 0.046, 0.0115, 0.165, L.stock, 0, 0.004, -0.098);
    box(g, 0.035, 0.0105, 0.125, L.stock, -0.0025, 0.004, -0.232, 0, 0.020, 0);

    // THE POINT. A 4-sided cone squashed flat gives a chisel-ground tip
    // instead of a spike — you grind a flat bar to a point by taking material
    // off two faces, so the tip is a wedge, not a needle.
    const tipGeo = new THREE.ConeGeometry(0.026, 0.075, 4);
    const tip = new THREE.Mesh(tipGeo, L.stock);
    tip.geometry._shared = true;
    tip.position.set(-0.0042, 0.004, -0.330);
    tip.rotation.set(-Math.PI / 2, 0, Math.PI / 4);
    tip.scale.set(1, 1, 0.30);           // flatten across the blade's thickness
    tip.castShadow = true;
    g.add(tip);

    // The ONE honed edge: a bright strip down the lower flank, running the
    // whole ground length. Freshly cut metal is the brightest thing on the
    // object and there is very little of it — that contrast is the read, and
    // it is also the only cue that tells you which way the edge is facing.
    box(g, 0.008, 0.0125, 0.275, L.honed, -0.0175, 0.0015, -0.170, 0, 0.012, 0);

    /* ---- GRIP: bedsheet strip, wound wet, five uneven passes --------------
       Sizes and angles are authored, not random: a wrap builds up THICKEST
       where the palm sits and tapers at both ends, and each pass lands a
       little crooked. The alternating material is the shadowed underside of
       the previous turn, which is what makes a wrap read as cloth and not as
       a rubber sleeve. */
    box(g, 0.033, 0.029, 0.030, L.wrapDark, 0, 0.004, -0.008, 0, 0, 0.05);
    box(g, 0.040, 0.037, 0.036, L.wrap, 0.0010, 0.004, 0.026, 0, 0.03, -0.06);
    box(g, 0.044, 0.041, 0.038, L.wrapDark, -0.0008, 0.0035, 0.064, 0, -0.02, 0.08);
    box(g, 0.043, 0.040, 0.036, L.wrap, 0.0012, 0.004, 0.100, 0, 0.04, -0.04);
    box(g, 0.036, 0.032, 0.028, L.wrapDark, 0, 0.004, 0.131, 0, 0, 0.07);

    // The loose tail — the end you never cut. Two short flat pieces falling
    // off the butt at a break, so it hangs rather than sticking out straight.
    box(g, 0.021, 0.007, 0.044, L.wrap, 0.002, -0.005, 0.163, 0.22, 0.10, 0);
    box(g, 0.016, 0.006, 0.034, L.wrapDark, 0.004, -0.022, 0.194, 0.55, 0.16, 0);

    // A thumb of bare tang showing where the wrap slipped. Small, but it is
    // the detail that says "this was never finished".
    box(g, 0.024, 0.0105, 0.020, L.stock, 0, 0.004, -0.026);

    // The working end, for every consumer that needs one point: the stab's
    // reach, the ground solve, the icon framing.
    g.userData.muzzle = new THREE.Vector3(0, 0.004, -0.362);
    g.userData.meleeTip = g.userData.muzzle;
    return g;
  };

  // Older prison prose (and every loot table shipped so far) says "Shiv".
  // Same object, same model — the alias keeps a stale name from falling
  // through to the generic fallback gun.
  CBZ.weaponAppearance.shiv = CBZ.weaponAppearance.shank;
})();
