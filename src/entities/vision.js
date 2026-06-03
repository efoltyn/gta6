/* ============================================================
   entities/vision.js — the translucent vision-cone "wedge" mesh
   drawn on the ground in front of each guard.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;

  function visionWedge(radius, half, segs, color) {
    const verts = [];
    for (let i = 0; i < segs; i++) {
      const a0 = -half + (i / segs) * 2 * half;
      const a1 = -half + ((i + 1) / segs) * 2 * half;
      verts.push(
        0, 0, 0,
        Math.sin(a0) * radius, 0, Math.cos(a0) * radius,
        Math.sin(a1) * radius, 0, Math.cos(a1) * radius
      );
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false,
    }));
    m.position.y = 0.07;
    m.renderOrder = 2;
    return m;
  }

  CBZ.visionWedge = visionWedge;
})();
