/* ============================================================
   weapons/appearances/lmg.js — the M249 LMG block model.

   WHY: a 100-round belt-fed gun was drawn with the M4 factory, so the
   block-clearing flex weapon looked identical to the starter rifle.
   The landmarks that make a blocky gun read "LMG": the BOX of ammo
   hanging under the receiver with a brass belt climbing into the top
   feed cover (the #1 tell — no rifle has luggage), a deployed BIPOD
   under a thick barrel, a CARRY handle on top, and a long heavy body.
   It should look like suppressing fire even when it's idle.

   Perf: pure boxes/cyls on the caller's shared material table.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ = window.CBZ || {};
  CBZ.weaponAppearance = CBZ.weaponAppearance || {};

  CBZ.weaponAppearance.lmg = function (ctx) {
    const { THREE, box, cyl, mat } = ctx;
    const g = new THREE.Group();
    // long heavy receiver + raised FEED TRAY COVER on top
    box(g, 0.150, 0.140, 0.52, mat.dark, 0, 0.005, -0.20);
    box(g, 0.165, 0.045, 0.36, mat.steel, 0, 0.10, -0.22);
    // CARRY handle: post + grab bar over the receiver
    box(g, 0.025, 0.060, 0.025, mat.black, 0, 0.155, -0.30);
    box(g, 0.030, 0.025, 0.17, mat.black, 0, 0.195, -0.245);
    // AMMO BOX slung under the receiver (the LMG-maker) + lid seam,
    // with a brass BELT climbing the right side into the feed cover
    box(g, 0.130, 0.20, 0.26, mat.polymer, 0, -0.205, -0.21);
    box(g, 0.135, 0.025, 0.265, mat.dark, 0, -0.10, -0.21);
    box(g, 0.030, 0.16, 0.060, mat.brass, 0.082, -0.005, -0.245, 0, 0, 0.30);
    // thick BARREL + gas tube beneath it + slotted muzzle device
    cyl(g, 0.030, 0.66, mat.black, 0, 0.045, -0.78, Math.PI / 2);
    cyl(g, 0.020, 0.50, mat.dark, 0, -0.015, -0.72, Math.PI / 2);
    cyl(g, 0.038, 0.10, mat.steel, 0, 0.045, -1.14, Math.PI / 2);
    // hooded FRONT sight post + rear sight block on the feed cover
    box(g, 0.020, 0.075, 0.020, mat.black, 0, 0.115, -1.04);
    box(g, 0.055, 0.045, 0.055, mat.black, 0, 0.145, -0.06);
    // Deployed BIPOD.  Build each strut from explicit hinge/end points so the
    // legs physically begin inside the gas-block yoke; Euler-guess cylinders
    // were visibly floating several centimetres below the barrel.
    const yAxis = new THREE.Vector3(0, 1, 0);
    function rod(a, b, r, material) {
      const d = new THREE.Vector3().subVectors(b, a), len = d.length();
      const m = cyl(g, r, len, material, 0, 0, 0);
      m.position.copy(a).add(b).multiplyScalar(0.5);
      m.quaternion.setFromUnitVectors(yAxis, d.normalize());
      return m;
    }
    const hingeL = new THREE.Vector3(-0.042, -0.020, -0.805);
    const hingeR = new THREE.Vector3(0.042, -0.020, -0.805);
    const footL = new THREE.Vector3(-0.165, -0.285, -1.015);
    const footR = new THREE.Vector3(0.165, -0.285, -1.015);
    box(g, 0.125, 0.070, 0.075, mat.steel, 0, -0.020, -0.805); // gas-block yoke
    cyl(g, 0.024, 0.145, mat.black, 0, -0.020, -0.805, 0, 0, Math.PI / 2); // hinge pin
    rod(hingeL, footL, 0.012, mat.steel);
    rod(hingeR, footR, 0.012, mat.steel);
    // rubber feet sit perpendicular to the legs and touch the same ground line
    rod(new THREE.Vector3(-0.195, -0.286, -1.015), new THREE.Vector3(-0.135, -0.286, -1.015), 0.016, mat.black);
    rod(new THREE.Vector3(0.135, -0.286, -1.015), new THREE.Vector3(0.195, -0.286, -1.015), 0.016, mat.black);
    g.userData.bipod = {
      attached: true, functional: true,
      hinges: [hingeL.clone(), hingeR.clone()], feet: [footL.clone(), footR.clone()],
    };
    // heat shield slab over the barrel root
    box(g, 0.110, 0.035, 0.24, mat.dark, 0, 0.085, -0.54);
    // pistol grip + trigger guard
    box(g, 0.090, 0.20, 0.105, mat.polymer, 0, -0.165, 0.005, -0.22);
    box(g, 0.050, 0.020, 0.12, mat.black, 0, -0.10, -0.075);
    // skeleton buttstock: top tube + lower strut + rubber buttpad
    box(g, 0.075, 0.055, 0.30, mat.polymer, 0, 0.035, 0.255);
    box(g, 0.060, 0.045, 0.26, mat.polymer, 0, -0.075, 0.265, 0.12);
    box(g, 0.090, 0.175, 0.040, mat.black, 0, -0.015, 0.415);
    // hand on the grip
    box(g, 0.160, 0.105, 0.14, mat.skin, 0, -0.155, 0.025, -0.12);
    g.userData.muzzle = new THREE.Vector3(0, 0.045, -1.20);
    return g;
  };
})();
