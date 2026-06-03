/* ============================================================
   world/razorwire.js — coiled razor wire crowning the enlarged
   perimeter. Purely visual — sells "you really don't want to climb".
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const scene = CBZ.scene;
  const YH = CBZ.DIM.YH;
  const W = CBZ.WORLD;
  const N = W.northYard, S = W.southBlock, gap = W.exit.gap;

  const wireMat = new THREE.MeshLambertMaterial({ color: 0xd8dde3, emissive: 0x222831, emissiveIntensity: 0.2 });

  // one coil = a flattened torus laid on its side
  function coil(x, z, axis) {
    const t = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.06, 5, 10), wireMat);
    t.position.set(x, YH + 0.4, z);
    if (axis === "z") t.rotation.y = Math.PI / 2;
    t.rotation.x = Math.PI / 2;
    t.castShadow = false;
    scene.add(t);
  }
  const runZ = (x, z0, z1) => { for (let z = z0; z <= z1; z += 1.5) coil(x, z, "z"); };
  const runX = (z, x0, x1, skipGap) => {
    for (let x = x0; x <= x1; x += 1.5) {
      if (skipGap && x > -gap - 1 && x < gap + 1) continue;
      coil(x, z, "x");
    }
  };

  // north yard side walls
  runZ(N.x0, N.z0 + 2, N.z1);
  runZ(N.x1, N.z0 + 2, N.z1);
  // step shoulders at the junction
  runX(N.z1, N.x0, S.x0); runX(N.z1, S.x1, N.x1);
  // south block side walls
  runZ(S.x0, S.z0, S.z1);
  runZ(S.x1, S.z0, S.z1);
  // far south wall (leave the exit clear)
  runX(S.z1, S.x0 + 1, S.x1 - 1, true);
})();
