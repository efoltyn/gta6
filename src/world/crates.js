/* ============================================================
   world/crates.js — wooden cover crates that break guard line-of-sight
   and create the stealth routes through the yard.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const { addBox, COL } = CBZ;

  function crate(x, z, s) {
    s = s || 2.6;
    addBox(x, s / 2, z, s, s, s, COL.CRATE, { solid: true, blockLOS: true });
    // darker plank banding so it reads as wood, not a flat cube
    addBox(x, s / 2, z, s + 0.06, s * 0.34, s + 0.06, COL.CRATE_D, { cast: false });
    // a little corner bracket detail
    addBox(x, s * 0.92, z, s * 1.02, 0.08, s * 1.02, 0x6e4a22, { cast: false });
  }

  crate(-9, 22);
  crate(8, 28);
  crate(-12, 36);
  crate(11, 17);
  crate(0, 11, 2.2);
})();
