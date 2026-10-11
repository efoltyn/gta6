/* ============================================================
   src/world/water_pages.js — A PAGE'S OWN SEA, SHADED BY THE ONE WATER.

   WHY THIS FILE EXISTS
   ------------------------------------------------------------
   NPC War (src/battle/) grew two private seas, each a MeshPhong sheet with a
   hand-written onBeforeCompile: the deep "sea plate" under its island venues
   (arenas/yard.js) and OPEN WATER's swell (arenas/sea.js: a CPU-displaced
   620 m grid plus a 26 km far plate with a hole cut for it). Neither had a
   sky in it, foam, a crest that breaks, caustics, or a surface you can look
   up at from below, while the rest of the game's water lived in
   world/water_spec.js.

   The page owns its SWELL — swellAt() is what every body on that page floats
   on, on the battle's own deterministic sim clock — so the geometry stays the
   page's. What it hands over is the MATERIAL:

     CBZ.waterAdoptSea(mesh, { seaY, opaque, clip:[cx, cz, half], depthWrite,
                               renderOrder, horizonFuse, color, name })

   re-shades `mesh` with the one water material in "external" mode (the
   page's displaced vertices and normals are used as given), registers it to
   be driven every frame like every other sea, and returns the material.
   Idempotent. A page that wants the whole sea (displacement included) uses
   CBZ.waterSeaMaterial({ kind: "city" | "arena" }) on
   CBZ.waterBuildSurfaceGeometry() and CBZ.waterWaveHeight() as its swell.

   CONTACT FOAM for a page's fleet: once a page has adopted a sea, any scene
   child carrying userData.freeboard (NPC War's hull_loft boats) is
   registered with CBZ.waterFoamSource, so the water whitens round every hull.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const THREE = window.THREE;
  if (!CBZ || !THREE) return;

  let adoptedAny = false;

  CBZ.waterAdoptSea = function (mesh, o) {
    if (!mesh || !mesh.isMesh || !CBZ.waterSeaMaterial) return null;
    if (mesh.userData && mesh.userData.waterAdopted) return mesh.material;
    o = o || {};
    const old = mesh.material;
    const mat = CBZ.waterSeaMaterial({ kind: "external", name: o.name || "Adopted Sea",
      horizonFuse: o.horizonFuse !== false, depthWrite: o.depthWrite });
    const U = mat.userData.waterUniforms;
    const y = Number.isFinite(+o.seaY) ? +o.seaY : 0;
    U.uSeaY.value = y;
    U.fixedSeaY = true;                 // the page's sea level, not the city's
    U.uCauSeaY = { value: y };          // seabed caustics measure depth from it
    if (o.opaque) U.noClarity = true;   // nothing is drawn under it: no see-through
    if (o.clip) U.uClip.value.set(+o.clip[0] || 0, +o.clip[1] || 0, +o.clip[2] || -1, 1);
    if (o.color != null) U.uSeaColor.value.set(o.color);
    if (o.renderOrder != null) mesh.renderOrder = o.renderOrder;
    mesh.material = mat;
    mesh.userData.waterAdopted = true;
    mesh.userData.waterSurface = true;
    if (CBZ.waterSelfDrive) CBZ.waterSelfDrive(mat);
    if (old && old !== mat && old.dispose) { try { old.dispose(); } catch (e) {} }
    adoptedAny = true;
    return mat;
  };

  // ---- the page's boats foam the water they sit in ---------------------------
  const _box = new THREE.Box3();
  if (CBZ.waterFoamSource) CBZ.waterFoamSource(function (push) {
    const scene = CBZ.scene;
    if (!scene || !adoptedAny) return;
    const kids = scene.children;
    for (let i = 0; i < kids.length; i++) {
      const b = kids[i];
      if (!b || !b.userData || b.userData.freeboard == null || !b.visible) continue;
      let L = b.userData._foamLen;
      if (!(L > 0)) {
        try { _box.setFromObject(b); } catch (e) { continue; }
        const sx = _box.max.x - _box.min.x, sz = _box.max.z - _box.min.z;
        if (!Number.isFinite(sx) || !Number.isFinite(sz)) continue;
        L = b.userData._foamLen = Math.max(2, Math.max(sx, sz));
        b.userData._foamBeam = Math.max(0.8, Math.min(sx, sz));
      }
      const h = b.rotation.y;
      // a hull's long axis is local +Z (forward = (sin h, cos h))
      push(b.position.x, b.position.z, Math.sin(h) * L * 0.40, Math.cos(h) * L * 0.40, b.userData._foamBeam * 0.5, 0.40);
    }
  });
})();
