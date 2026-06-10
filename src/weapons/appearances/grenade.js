/* ============================================================
   weapons/appearances/grenade.js — the thrown-GRENADE mesh.

   Grenades are a KEY-THROWN throwable (city/combat.js owns the lob + arc +
   fuse + detonation), NOT a selectable FPS weapon slot, so this file does NOT
   register a CBZ.weaponAppearance. It only exposes a tiny mesh factory the
   combat.js grenade pool calls to build each live grenade prop:
       CBZ.grenadeMesh(THREE) -> THREE.Group   (a small frag grenade)
   Guard-safe: builds nothing on load; pure function, no per-frame work.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ = window.CBZ || {};

  // Build one small frag-grenade prop. `THREE` is passed in so this stays
  // decoupled from load order (combat.js hands us window.THREE).
  CBZ.grenadeMesh = function (THREE) {
    const T = THREE || window.THREE;
    const g = new T.Group();
    const bodyMat = new T.MeshLambertMaterial({ color: 0x33402a });   // OD-green frag body
    const metalMat = new T.MeshLambertMaterial({ color: 0x6a7078 });  // steel spoon/lever
    const pinMat = new T.MeshLambertMaterial({ color: 0xc9a02b });    // brass-ish safety ring

    // egg/ovoid body (a sphere squashed a touch on the vertical)
    const body = new T.Mesh(new T.SphereGeometry(0.12, 12, 10), bodyMat);
    body.scale.set(1, 1.18, 1);
    g.add(body);

    // fuse cap / neck on top
    const cap = new T.Mesh(new T.CylinderGeometry(0.05, 0.06, 0.07, 8), metalMat);
    cap.position.set(0, 0.15, 0);
    g.add(cap);

    // safety lever (spoon) hugging the side
    const spoon = new T.Mesh(new T.BoxGeometry(0.03, 0.16, 0.05), metalMat);
    spoon.position.set(0.1, 0.06, 0);
    g.add(spoon);

    // pull-ring
    const ring = new T.Mesh(new T.TorusGeometry(0.035, 0.012, 6, 10), pinMat);
    ring.position.set(0, 0.2, 0);
    ring.rotation.x = Math.PI / 2;
    g.add(ring);

    return g;
  };
})();
