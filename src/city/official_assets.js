/* ============================================================
   city/official_assets.js — runtime integration for the exact assets from
   the official Three.js loader examples supplied for this world.

   • truck.3mf is normalized only for game scale/orientation, then registered
     as an ordinary persistent city vehicle. E/Y can steal it and the standard
     driving, crash, booster and ownership systems operate on the same record.
   • the baked IFC sample keeps its original merged geometry/materials and is
     placed as Goldspire's adjoining civic campus. It is intentionally not
     wrapped in a giant AABB: bullets raycast the visible mesh, but the player
     never hits another invisible building-sized wall.
   • Blouberg HDR is lighting only; the authored game sky remains the sky.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const state = CBZ.officialAssetState = CBZ.officialAssetState || {
    truck: "idle", ifc: "idle", environment: "idle", errors: [],
  };
  let truckSourcePromise = null;
  let ifcSourcePromise = null;

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

  function loadIfcSource() {
    if (ifcSourcePromise) return ifcSourcePromise;
    ifcSourcePromise = new Promise(function (resolve, reject) {
      if (!THREE.GLTFLoader) { reject(new Error("GLTFLoader unavailable")); return; }
      state.ifc = "loading";
      const loader = new THREE.GLTFLoader();
      loader.load("assets/official/ifc/rac_advanced_sample_project.glb", function (gltf) {
        state.ifc = "ready"; resolve(markShared(gltf.scene));
      }, undefined, reject);
    }).catch(function (e) { fail("ifc", e); throw e; });
    return ifcSourcePromise;
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

  function buildIfcCampus(city) {
    const root = city && city.root;
    if (!root || root.getObjectByName("official-ifc-civic-campus")) return;
    const CX = -100, CZ = 470, W = 260, D = 136;
    const padMat = new THREE.MeshLambertMaterial({ color: 0x8d9298, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(W, D), padMat);
    pad.rotation.x = -Math.PI / 2; pad.position.set(CX, 0.012, CZ);
    pad.receiveShadow = true; pad.userData.terrain = true; pad.userData.worldSurface = true;
    pad.name = "official-ifc-campus-surface"; root.add(pad);

    // The campus touches Goldspire's west edge with a short, open plaza link.
    const link = new THREE.Mesh(new THREE.PlaneGeometry(16, 24), new THREE.MeshLambertMaterial({ color: 0x555a61 }));
    link.rotation.x = -Math.PI / 2; link.position.set(35, 0.026, CZ); link.receiveShadow = true; root.add(link);
    if (city.roads) city.roads.push({ x: 35, z: CZ, vertical: false, len: 16, district: "goldspire", w: 24, lanesPerDir: 1, laneW: 3.6 });
    if (CBZ.registerCityRegion) CBZ.registerCityRegion(city, {
      name: "Goldspire Civic Campus", subtitle: "BIM Civic Complex", biome: "goldspire",
      kind: "rect", minX: CX - W / 2, maxX: CX + W / 2, minZ: CZ - D / 2, maxZ: CZ + D / 2,
      pad: 4, mapLabel: false,
    });

    const holder = new THREE.Group();
    holder.name = "official-ifc-civic-campus";
    holder.position.set(CX, 0.035, CZ);
    holder.userData.officialAsset = "threejs IFC advanced sample";
    root.add(holder);
    loadIfcSource().then(function (source) {
      if (!holder.parent) return;
      const model = fitObject(source.clone(true), { x: 238, y: 18, z: 114 }, false);
      model.traverse(function (o) {
        if (!o.isMesh) return;
        o.castShadow = false; o.receiveShadow = true;
        o.userData.officialIfcSurface = true;
        // Visible triangles, not a fake box, stop bullets/vision.
        if (CBZ.losBlockers && CBZ.losBlockers.indexOf(o) < 0) CBZ.losBlockers.push(o);
      });
      holder.add(model);
      if (CBZ.makeLabelSprite) {
        const label = CBZ.makeLabelSprite("GOLDSPIRE CIVIC CAMPUS", { color: "#eaf3ff" });
        label.scale.set(20, 4.4, 1); label.position.set(0, 15, -48); holder.add(label);
      }
    }).catch(function () {
      if (holder.parent && !holder.children.length) holder.parent.remove(holder);
    });
  }
  if (CBZ.addLandmass) CBZ.addLandmass(buildIfcCampus, 34.6);

  // Use the supplied HDR as physically based reflection LIGHTING only. Keeping
  // it out of scene.background avoids a second photographic sky/cloud layer.
  let envStarted = false;
  function startEnvironment() {
    if (envStarted || !THREE.RGBELoader || !CBZ.renderer || !CBZ.scene) return;
    envStarted = true; state.environment = "loading";
    new THREE.RGBELoader().load("assets/official/sky/blouberg_sunrise_2_1k.hdr", function (tex) {
      try {
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
