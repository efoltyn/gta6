/* ============================================================
   src/world/water_pages.js — A PAGE'S OWN SEA, SHADED BY THE ONE WATER.

   WHY THIS FILE EXISTS
   ------------------------------------------------------------
   games/battle.html (NPC War) grew two private seas, each a MeshPhong sheet
   with a hand-written onBeforeCompile: the deep "sea plate" under its island
   venues, and OPEN WATER's swell (a CPU-displaced 620 m grid plus a 26 km
   far plate with a hole cut for it). Neither had a sky in it, foam, a
   shoreline, a crest that breaks, caustics, or a surface you can look up at
   from below. The rest of the game's water lives in world/water_spec.js and
   all of it was "deliberately not here".

   The page owns its SWELL — swellAt() is what every body on that page floats
   on, and it is a function this file cannot see — so the geometry stays the
   page's. What changes is the MATERIAL: each sheet is re-shaded by the one
   water family (CBZ.waterSeaMaterial, "external" mode: the page's displaced
   vertices and normals are used as given), driven every frame like every
   other sea. Same sky reflection, same Fresnel, same glint, same foam, same
   Snell's window as the city ocean and the shark sim.

   HOW A PAGE IS RECOGNISED, and why that is temporary
   ------------------------------------------------------------
   battle.html is being split into modules by another hand right now and may
   not be edited, so the adoption here keys on the sheets' own signatures
   (the plate's customProgramCacheKey "npcwar-seaplate"; the open-water
   sheets' shader hook naming `vSeaW`). Once the split lands, the page should
   call the seam directly and this matcher retires:

     const mat = CBZ.waterAdoptSea(mesh, { seaY: 0, clip: [cx, cz, half] });

   CBZ.waterAdoptSea is idempotent and works on any mesh whose geometry the
   caller owns. A page that wants the whole sea (displacement included) uses
   CBZ.waterSeaMaterial({ kind: "city" | "arena" }) on
   CBZ.waterBuildSurfaceGeometry() and CBZ.waterWaveHeight() as its swell.

   CONTACT FOAM for the page's fleet: any scene child carrying
   userData.freeboard (battle.html's hull_loft boats) is registered as a hull
   with CBZ.waterFoamSource, so the water whitens round every boat.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const THREE = window.THREE;
  if (!CBZ || !THREE) return;
  const CFG = (CBZ.CONFIG = CBZ.CONFIG || {});
  if (CFG.WATER_ADOPT_PAGES == null) CFG.WATER_ADOPT_PAGES = true;

  // mesh -> shared material (one per distinct sheet role)
  CBZ.waterAdoptSea = function (mesh, o) {
    if (!mesh || !mesh.isMesh || !CBZ.waterSeaMaterial) return null;
    if (mesh.userData && mesh.userData.waterAdopted) return mesh.material;
    o = o || {};
    const old = mesh.material;
    const mat = CBZ.waterSeaMaterial({ kind: "external", name: o.name || "Adopted Sea", horizonFuse: o.horizonFuse !== false,
      depthWrite: o.depthWrite });
    const U = mat.userData.waterUniforms;
    const y = Number.isFinite(+o.seaY) ? +o.seaY : 0;
    U.uSeaY.value = y;
    U.fixedSeaY = true;
    U.uCauSeaY = { value: y };
    if (o.opaque) U.noClarity = true;
    if (o.clip) U.uClip.value.set(+o.clip[0] || 0, +o.clip[1] || 0, +o.clip[2] || -1, 1);
    if (o.color != null) U.uSeaColor.value.set(o.color);
    if (o.renderOrder != null) mesh.renderOrder = o.renderOrder;
    mesh.material = mat;
    mesh.userData.waterAdopted = true;
    mesh.userData.waterSurface = true;
    if (CBZ.waterSelfDrive) CBZ.waterSelfDrive(mat);
    if (old && old !== mat && old.dispose) { try { old.dispose(); } catch (e) {} }
    return mat;
  };

  function geoWidth(m) {
    const p = m.geometry && m.geometry.parameters;
    return p && Number.isFinite(p.width) ? p.width : 0;
  }
  function geoY(m) {
    const g = m.geometry;
    if (!g) return 0;
    if (!g.boundingBox) g.computeBoundingBox();
    const b = g.boundingBox;
    return b ? (b.min.y + b.max.y) * 0.5 + m.position.y : m.position.y;
  }
  function hookSrc(mat) {
    const f = mat && mat.onBeforeCompile;
    return f && f !== THREE.Material.prototype.onBeforeCompile ? String(f) : "";
  }

  // ---- NPC War's two sheets -------------------------------------------------
  function scanBattle() {
    const scene = CBZ.scene;
    if (!scene) return 0;
    let n = 0;
    const kids = scene.children;
    for (let i = 0; i < kids.length; i++) {
      const m = kids[i];
      if (!m || !m.isMesh || !m.material || (m.userData && m.userData.waterAdopted)) continue;
      const mat = m.material;
      if (Array.isArray(mat)) continue;
      const key = typeof mat.customProgramCacheKey === "function" ? mat.customProgramCacheKey() : "";
      if (key === "npcwar-seaplate") {
        // the deep plate under the island venues: flat, opaque (nothing is
        // drawn beneath it), at its own height
        CBZ.waterAdoptSea(m, { name: "NPC War Sea Plate", seaY: geoY(m), opaque: true });
        n++;
        continue;
      }
      if (mat.isMeshPhongMaterial && hookSrc(mat).indexOf("vSeaW") >= 0) {
        // OPEN WATER: the live swell grid and the far plate with a hole in it
        const w = geoWidth(m);
        if (w > 5000) {
          // the hole is the live grid's footprint, centred on this mesh
          let half = 304;
          for (let j = 0; j < kids.length; j++) {
            const g = kids[j];
            if (g && g !== m && g.isMesh && geoWidth(g) > 0 && geoWidth(g) < 5000 &&
                g.material && hookSrc(g.material).indexOf("vSeaW") >= 0) { half = geoWidth(g) / 2 - 6; break; }
          }
          CBZ.waterAdoptSea(m, { name: "NPC War Far Sea", seaY: 0, clip: [m.position.x, m.position.z, half],
            depthWrite: false, renderOrder: 3 });
        } else {
          CBZ.waterAdoptSea(m, { name: "NPC War Sea", seaY: 0, depthWrite: false, renderOrder: 4, horizonFuse: false });
        }
        n++;
      }
    }
    return n;
  }

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
        L = b.userData._foamLen = Math.max(2, Math.max(sx, sz));
        b.userData._foamBeam = Math.max(0.8, Math.min(sx, sz));
      }
      const h = b.rotation.y;
      // hull_loft boats run along local +Z (forward = (sin h, cos h))
      push(b.position.x, b.position.z, Math.sin(h) * L * 0.40, Math.cos(h) * L * 0.40, b.userData._foamBeam * 0.5, 0.40);
    }
  });

  let adoptedAny = false, frame = 0;
  function tick() {
    if (CFG.WATER_ADOPT_PAGES === false || CFG.WATER_V2 === false) return;
    // a page builds its map after load; look a few times a second, cheaply
    if ((++frame % 20) !== 1) return;
    if (scanBattle() > 0) adoptedAny = true;
  }
  if (CBZ.onAlways) CBZ.onAlways(93.55, tick);
  else if (CBZ.onUpdate) CBZ.onUpdate(93.55, tick);
})();
