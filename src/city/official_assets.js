/* ============================================================
   city/official_assets.js — runtime integration for the exact assets from
   the official Three.js loader examples supplied for this world.

   • truck.3mf is normalized only for game scale/orientation, then registered
     as an ordinary persistent city vehicle. E/Y can steal it and the standard
     driving, crash, booster and ownership systems operate on the same record.
   • Blouberg HDR is lighting only; the authored game sky remains the sky.

   The baked IFC "Goldspire Civic Campus" that used to live here — a 64.8 MB
   GLB of a Revit sample building and its landscape trees, parked at
   (-100, 470) — was DELETED on the owner's instruction (2026-08-15), along
   with its pad, plaza link, road record, region, label, proximity streamer
   and the OFFICIAL_IFC_LAZY/OFFICIAL_IFC_RADIUS flags. It is not archived and
   not flagged off: the code and the assets are gone. Nothing else in the
   world referenced it, so removal is confined to this file plus the tools
   and notes that photographed or documented it.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const state = CBZ.officialAssetState = CBZ.officialAssetState || {
    truck: "idle", environment: "idle", errors: [],
  };
  let truckSourcePromise = null;

  function fail(kind, err) {
    state[kind] = "error";
    state.errors.push(kind + ": " + ((err && err.message) || String(err || "unknown error")));
    if (window.console && console.warn) console.warn("Official asset failed:", kind, err);
  }

  function markShared(root) {
    root.traverse(function (o) {
      if (o.geometry) o.geometry._shared = true;
      const mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
      for (const m of mats) m._shared = true;
    });
    return root;
  }

  function loadTruckSource() {
    if (truckSourcePromise) return truckSourcePromise;
    truckSourcePromise = new Promise(function (resolve, reject) {
      if (!THREE.ThreeMFLoader) { reject(new Error("ThreeMFLoader unavailable")); return; }
      state.truck = "loading";
      const loader = new THREE.ThreeMFLoader();
      loader.load("assets/official/3mf/truck.3mf", function (obj) {
        state.truck = "ready"; resolve(markShared(obj));
      }, undefined, reject);
    }).catch(function (e) { fail("truck", e); throw e; });
    return truckSourcePromise;
  }

  // Fit without touching the asset's internal geometry or material assignment.
  function fitObject(obj, target, orientTruck) {
    if (orientTruck) obj.rotation.x = -Math.PI / 2; // official sample's z-up conversion
    obj.updateMatrixWorld(true);
    let box = new THREE.Box3().setFromObject(obj), size = box.getSize(new THREE.Vector3());
    if (orientTruck && size.x > size.z) {
      obj.rotation.y += Math.PI / 2;
      obj.updateMatrixWorld(true);
      box.setFromObject(obj); size = box.getSize(size);
    }
    const ratios = [];
    if (target.x && size.x > 0) ratios.push(target.x / size.x);
    if (target.y && size.y > 0) ratios.push(target.y / size.y);
    if (target.z && size.z > 0) ratios.push(target.z / size.z);
    const scale = Math.min.apply(Math, ratios.length ? ratios : [1]);
    obj.scale.multiplyScalar(scale);
    obj.updateMatrixWorld(true);
    box.setFromObject(obj);
    const center = box.getCenter(new THREE.Vector3());
    obj.position.x -= center.x;
    obj.position.z -= center.z;
    obj.position.y -= box.min.y;
    obj.updateMatrixWorld(true);
    return obj;
  }

  CBZ.spawnOfficialFarmTruck = function (root, x, z, heading) {
    if (!root || root.getObjectByName("official-threejs-farm-truck")) return null;
    const holder = new THREE.Group();
    holder.name = "official-threejs-farm-truck";
    holder.position.set(x, 0.02, z);
    holder.rotation.y = heading || 0;
    holder.userData.officialAsset = "threejs truck.3mf";
    root.add(holder);
    loadTruckSource().then(function (source) {
      if (!holder.parent) return;
      const model = fitObject(source.clone(true), { x: 2.65, y: 2.85, z: 6.15 }, true);
      model.traverse(function (o) {
        if (!o.isMesh) return;
        o.castShadow = true; o.receiveShadow = true;
        o.userData.vehiclePart = true;
      });
      holder.add(model);
      if (CBZ.cityRegisterVehicle) {
        const car = CBZ.cityRegisterVehicle(holder, {
          body: "pickup", style: "van", persist: true, heading: heading || 0,
          model: { name: "CMC Farm Truck", value: 7200, rarity: 0.18, body: "pickup", s: 1.15 },
          dims: { width: 2.65, length: 6.15, height: 2.85, wheelbase: 3.55 },
          color: 0x7a0303,
        });
        if (car) { car.ai = false; car.owned = false; car.stolen = false; car._officialAsset = true; }
      }
    }).catch(function () {
      if (holder.parent && !holder.children.length) holder.parent.remove(holder);
    });
    return holder;
  };

  // Use the supplied HDR as physically based reflection LIGHTING only. Keeping
  // it out of scene.background avoids a second photographic sky/cloud layer.
  // A photograph of a SUNRISE is the wrong reflection at noon and at
  // midnight. core/envsky.js now bakes the live sky dome into the
  // environment every time it repaints, so this HDR is only the fallback for
  // a build with that feature flagged off (?cfg_GFX_SKY_ENV=0).
  let envStarted = false;
  function startEnvironment() {
    if (envStarted || !THREE.RGBELoader || !CBZ.renderer || !CBZ.scene) return;
    if (CBZ.CONFIG && CBZ.CONFIG.GFX_SKY_ENV !== false && CBZ.skyEnvBake) { envStarted = true; state.environment = "live-sky"; return; }
    envStarted = true; state.environment = "loading";
    new THREE.RGBELoader().load("assets/official/sky/blouberg_sunrise_2_1k.hdr", function (tex) {
      try {
        if (CBZ.skyEnvActive) { tex.dispose(); state.environment = "live-sky"; return; }
        const pmrem = new THREE.PMREMGenerator(CBZ.renderer);
        const rt = pmrem.fromEquirectangular(tex);
        CBZ.scene.environment = rt.texture;
        CBZ.cityEnvironmentTarget = rt;
        tex.dispose(); pmrem.dispose();
        state.environment = "ready";
      } catch (e) { fail("environment", e); }
    }, undefined, function (e) { fail("environment", e); });
  }
  if (CBZ.onAlways) CBZ.onAlways(-99, startEnvironment); else setTimeout(startEnvironment, 0);
})();
