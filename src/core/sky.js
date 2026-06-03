/* ============================================================
   core/sky.js — gradient sky dome + a few lazy clouds
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const scene = CBZ.scene;

  // vertical gradient baked into a tiny canvas texture
  const c = document.createElement("canvas");
  c.width = 8; c.height = 256;
  const g = c.getContext("2d");
  const grd = g.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0, "#1f63cf");
  grd.addColorStop(0.5, "#5fa0ee");
  grd.addColorStop(1, "#cfe9ff");
  g.fillStyle = grd; g.fillRect(0, 0, 8, 256);

  const tex = new THREE.CanvasTexture(c);
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(400, 24, 16),
    new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false })
  );
  scene.add(dome);
  CBZ.skyDome = dome; // core/daynight.js tints this

  // chunky low-poly clouds drifting overhead (pure decoration)
  const cloudMat = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false });
  const clouds = [];
  function puff(group, x, y, z, s) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(s, s * 0.6, s), cloudMat);
    m.position.set(x, y, z); group.add(m);
  }
  function cloud(x, y, z, scale) {
    const grp = new THREE.Group();
    puff(grp, 0, 0, 0, 9); puff(grp, 6, -1, 1, 6);
    puff(grp, -6, -1, -1, 7); puff(grp, 2, 2, 0, 5);
    grp.position.set(x, y, z); grp.scale.setScalar(scale);
    scene.add(grp); clouds.push(grp);
  }
  cloud(-60, 70, -40, 1.4);
  cloud(50, 80, 30, 1.8);
  cloud(10, 75, 90, 1.2);
  cloud(-30, 85, 70, 1.6);

  // clouds over the far-away SURVIVAL island too (off-screen during the
  // prison game, overhead once you're in the disaster arena)
  if (CBZ.SURV && CBZ.SURV.arena) {
    const a = CBZ.SURV.arena;
    cloud(a.cx - 55, 74, a.cz - 45, 1.6);
    cloud(a.cx + 50, 84, a.cz + 35, 2.0);
    cloud(a.cx + 15, 78, a.cz + 85, 1.3);
    cloud(a.cx - 35, 88, a.cz + 55, 1.7);
    cloud(a.cx + 65, 72, a.cz - 65, 1.5);
  }

  // The sky dome FOLLOWS the camera so the sky surrounds the player no
  // matter where they are — the prison sits at the origin but the disaster
  // arena is ~600 units away, far outside a dome that's pinned to origin
  // (that gap was showing as a black "roof" over the survival world).
  CBZ.onAlways(5, function (dt) {
    const cam = CBZ.camera.position;
    dome.position.set(cam.x, 0, cam.z);
    for (const c2 of clouds) {
      c2.position.x += dt * 0.8;
      if (c2.position.x > 150) c2.position.x = -150;
    }
  });
})();
