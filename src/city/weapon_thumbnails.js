/* ============================================================
   city/weapon_thumbnails.js — actual procedural gun renders for UI slots.

   One lazy offscreen renderer and one cached data URL per weapon.  Inventory
   and hotbar cells therefore show the exact model already used in the hand,
   without creating a WebGL canvas/render loop per slot.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ, THREE = window.THREE;
  if (!CBZ || !THREE) return;
  const cache = Object.create(null);
  let renderer = null, scene = null, camera = null, holder = null;

  function boot() {
    if (renderer) return true;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true, powerPreference: "low-power" });
      renderer.setPixelRatio(1);
      renderer.setSize(180, 100, false);
      renderer.setClearColor(0x000000, 0);
      if (THREE.sRGBEncoding != null) renderer.outputEncoding = THREE.sRGBEncoding;
      scene = new THREE.Scene();
      camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 50);
      holder = new THREE.Group(); scene.add(holder);
      scene.add(new THREE.HemisphereLight(0xeaf5ff, 0x1a2027, 2.0));
      const key = new THREE.DirectionalLight(0xffffff, 2.6); key.position.set(4, 6, 3); scene.add(key);
      const rim = new THREE.DirectionalLight(0x82c8ff, 1.2); rim.position.set(-4, 2, -5); scene.add(rim);
      return true;
    } catch (e) { renderer = null; return false; }
  }
  function clearHolder() { while (holder && holder.children.length) holder.remove(holder.children[0]); }
  CBZ.weaponThumbnail = function (id) {
    id = String(id || "sidearm").toLowerCase();
    if (cache[id]) return cache[id];
    if (!CBZ.buildActorWeapon || !boot()) return "";
    try {
      clearHolder();
      const model = CBZ.buildActorWeapon(id);
      model.position.set(0, 0, 0); model.rotation.set(0, 0, 0); model.scale.setScalar(1);
      holder.add(model);
      holder.updateMatrixWorld(true);
      let box = new THREE.Box3().setFromObject(holder);
      const center = box.getCenter(new THREE.Vector3());
      holder.position.sub(center); holder.updateMatrixWorld(true);
      box = new THREE.Box3().setFromObject(holder);
      const size = box.getSize(new THREE.Vector3());
      const halfW = Math.max(size.z * 0.59, size.y * 0.92, 0.28);
      const halfH = Math.max(size.y * 0.68, size.z * 0.30, 0.18);
      camera.left = -halfW; camera.right = halfW; camera.top = halfH; camera.bottom = -halfH;
      camera.position.set(Math.max(2.5, size.x * 4 + 2), size.y * 0.16, 0);
      camera.up.set(0, 1, 0); camera.lookAt(0, 0, 0); camera.updateProjectionMatrix();
      renderer.render(scene, camera);
      cache[id] = renderer.domElement.toDataURL("image/png");
      clearHolder(); holder.position.set(0, 0, 0);
      return cache[id];
    } catch (e) {
      clearHolder(); if (holder) holder.position.set(0, 0, 0);
      return "";
    }
  };
  CBZ.weaponThumbnailInvalidate = function (id) { if (id) delete cache[String(id).toLowerCase()]; else for (const k in cache) delete cache[k]; };
})();
