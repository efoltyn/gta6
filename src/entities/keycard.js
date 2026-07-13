/* ============================================================
   entities/keycard.js — the keycard pickup (unlocks the yard door)
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const scene = CBZ.prisonRoot || CBZ.scene;
  const { mat, COL } = CBZ;

  const grp = new THREE.Group();
  grp.userData.dynamic = true;
  const card = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.45, 0.06), mat(COL.KEY, { emissive: COL.KEY_E, ei: 1.3 }));
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.1, 0.07), mat(0x0a3b33));
  stripe.position.y = 0.08;
  grp.add(card, stripe);
  grp.position.set(13.5, 1.4, -11.5); // SE corner, past the indoor guard
  scene.add(grp);

  // glow ring on the floor marking where it sits
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.8, 1.15, 24),
    new THREE.MeshBasicMaterial({ color: COL.KEY, transparent: true, opacity: 0.4, side: THREE.DoubleSide })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(13.5, 0.06, -11.5);
  scene.add(ring);

  CBZ.keycard = { group: grp, ring, collected: false, baseY: 1.4 };
})();
