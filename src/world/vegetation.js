/* ============================================================
   world/vegetation.js — shared scenery-scale vegetation geometry.

   A tree is not a green marker standing on the ground. Playable biomes use
   this file for the reusable visual grammar — mature wood, irregular crowns,
   detached canopy roof and opaque thicket mass — while each biome keeps its
   own ecology, trails, clearings and deterministic placement.

   The archetypes are authored in METRES, not one-unit toy shapes. That makes
   their intended scale inspectable and prevents every consumer inventing a
   different "tree-sized" multiplier. They remain low-poly closed meshes so
   instanceColor, Lambert light and the existing static batching path work in
   Three r128 without alpha sorting or a new texture dependency.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const CFG = (CBZ.CONFIG = CBZ.CONFIG || {});
  if (CFG.SCENERY_VEGETATION == null) CFG.SCENERY_VEGETATION = true;

  const cache = Object.create(null);
  const mats = Object.create(null);
  const UP = new THREE.Vector3(0, 1, 0);

  function merged(parts, fallback) {
    const fn = THREE.BufferGeometryUtils && THREE.BufferGeometryUtils.mergeBufferGeometries;
    let out = null;
    if (fn) out = fn(parts, false);
    if (!out) out = fallback || parts[0];
    for (let i = 0; i < parts.length; i++) if (parts[i] !== out && parts[i].dispose) parts[i].dispose();
    return out;
  }

  function cylinderBetween(a, b, r0, r1, sides) {
    const av = new THREE.Vector3(a[0], a[1], a[2]);
    const bv = new THREE.Vector3(b[0], b[1], b[2]);
    const dir = bv.clone().sub(av), len = dir.length();
    const g = new THREE.CylinderGeometry(r1, r0, len, sides || 5);
    const q = new THREE.Quaternion().setFromUnitVectors(UP, dir.normalize());
    g.applyMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(q));
    g.translate((a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5, (a[2] + b[2]) * 0.5);
    return g;
  }

  function lobe(x, y, z, sx, sy, sz) {
    const g = new THREE.IcosahedronGeometry(1, 0);
    g.scale(sx, sy, sz); g.translate(x, y, z);
    return g;
  }

  // A baked underside-to-crown ramp gives a mass depth even when thousands of
  // instances share one material. r128 multiplies vertex color by instanceColor.
  function shadeByHeight(g, floor, power) {
    g.computeBoundingBox();
    const p = g.attributes.position, y0 = g.boundingBox.min.y, dy = Math.max(0.001, g.boundingBox.max.y - y0);
    const c = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const t = Math.max(0, Math.min(1, (p.getY(i) - y0) / dy));
      const v = floor + (1 - floor) * Math.pow(t, power || 0.72);
      c[i * 3] = v; c[i * 3 + 1] = v; c[i * 3 + 2] = v;
    }
    g.setAttribute("color", new THREE.BufferAttribute(c, 3));
    g.computeVertexNormals(); g.computeBoundingBox(); g.computeBoundingSphere();
    return g;
  }

  function matureWood() {
    const parts = [];
    // 20m fluted bole. The clear lower two thirds is deliberate: at player
    // height this reads as architecture and depth, not a person-shaped icon.
    const bole = new THREE.CylinderGeometry(0.34, 0.82, 20, 7);
    bole.translate(0, 10, 0); parts.push(bole);
    // Four grounded buttress roots. These are real-metre geometry so the roots
    // stay broad and low when the whole archetype is uniformly scaled.
    const roots = [[2.7, 0.22, 0], [-2.7, 0.22, 0], [0, 0.22, 2.7], [0, 0.22, -2.7]];
    for (let i = 0; i < roots.length; i++) parts.push(cylinderBetween([0, 0.34, 0], roots[i], 0.48, 0.10, 5));
    // Crown-bearing limbs start high and fork asymmetrically. They are visual;
    // collision remains the central timber proxy in biome owners.
    const limbs = [
      [[0, 11.8, 0], [3.9, 16.2, 1.2], 0.34, 0.15],
      [[0, 12.7, 0], [-3.2, 17.1, -1.8], 0.32, 0.14],
      [[0, 14.0, 0], [1.0, 18.8, -3.5], 0.28, 0.12],
      [[0, 14.8, 0], [-1.5, 19.4, 3.0], 0.27, 0.11],
    ];
    for (let i = 0; i < limbs.length; i++) {
      const b = limbs[i]; parts.push(cylinderBetween(b[0], b[1], b[2], b[3], 5));
    }
    const g = shadeByHeight(merged(parts, bole), 0.52, 0.8);
    g.name = "cbz-mature-tree-wood";
    g.userData.vegetationArchetype = "mature-wood";
    return g;
  }

  function matureCrown() {
    const parts = [
      lobe(0.0, 5.2, 0.0, 6.4, 5.2, 6.1),
      lobe(-4.5, 5.4, 0.8, 4.6, 4.2, 4.7),
      lobe(4.4, 5.9, -0.9, 4.9, 4.5, 4.2),
      lobe(-0.8, 8.5, 3.7, 4.8, 4.2, 4.5),
      lobe(1.2, 9.0, -3.6, 4.2, 3.8, 4.6),
    ];
    const g = shadeByHeight(merged(parts, parts[0]), 0.40, 0.62);
    // Seat the lowest lobe on y=0; every caller can place the crown by its base.
    g.computeBoundingBox(); g.translate(0, -g.boundingBox.min.y, 0);
    shadeByHeight(g, 0.40, 0.62);
    g.name = "cbz-mature-tree-crown";
    g.userData.vegetationArchetype = "mature-crown";
    return g;
  }

  function landscapeWood() {
    // The continent carries roughly ten thousand trees across the whole
    // country. Its far/mid storey keeps the same 20m authored scale, but uses
    // a single fluted bole: matureWood's buttresses and fork limbs are close
    // detail that would multiply millions of invisible vertices outside the
    // player's current district.
    const g = new THREE.CylinderGeometry(0.34, 0.76, 20, 6);
    g.translate(0, 10, 0);
    shadeByHeight(g, 0.50, 0.82);
    g.name = "cbz-landscape-tree-wood";
    g.userData.vegetationArchetype = "landscape-wood";
    return g;
  }

  function landscapeCrown() {
    // Three offset masses keep the silhouette asymmetric without paying the
    // five-lobe mature-tree budget at every 46m backcountry cell.
    const parts = [
      lobe(0.0, 5.0, 0.0, 6.3, 5.0, 5.9),
      lobe(-3.9, 6.3, 1.1, 4.2, 4.0, 4.4),
      lobe(3.7, 7.2, -1.2, 4.4, 4.2, 4.0),
    ];
    const g = shadeByHeight(merged(parts, parts[0]), 0.39, 0.64);
    g.computeBoundingBox(); g.translate(0, -g.boundingBox.min.y, 0); shadeByHeight(g, 0.39, 0.64);
    g.name = "cbz-landscape-tree-crown";
    g.userData.vegetationArchetype = "landscape-crown";
    return g;
  }

  function subcanopy() {
    const parts = [
      lobe(0, 2.7, 0, 3.5, 2.7, 3.3),
      lobe(-2.0, 3.6, 0.4, 2.5, 2.4, 2.6),
      lobe(2.1, 3.5, -0.6, 2.7, 2.3, 2.4),
    ];
    const g = shadeByHeight(merged(parts, parts[0]), 0.36, 0.68);
    g.computeBoundingBox(); g.translate(0, -g.boundingBox.min.y, 0); shadeByHeight(g, 0.36, 0.68);
    g.name = "cbz-subcanopy-crown";
    g.userData.vegetationArchetype = "subcanopy";
    return g;
  }

  function canopyPatch() {
    // Detached roof mass: no trunk is implied. Broad, shallow, overlapping
    // shapes close the sky between real trees without manufacturing colliders.
    const parts = [
      lobe(0, 2.2, 0, 5.2, 2.2, 5.0),
      lobe(-3.8, 2.7, 1.5, 3.8, 2.3, 3.7),
      lobe(3.7, 2.8, -1.2, 4.0, 2.4, 3.5),
      lobe(0.7, 3.4, 3.6, 3.7, 2.2, 3.5),
    ];
    const g = shadeByHeight(merged(parts, parts[0]), 0.31, 0.58);
    g.computeBoundingBox(); g.translate(0, -g.boundingBox.min.y, 0); shadeByHeight(g, 0.31, 0.58);
    g.name = "cbz-canopy-roof-patch";
    g.userData.vegetationArchetype = "canopy-patch";
    return g;
  }

  function thicket() {
    // Coarse opaque middle-distance mass. Fewer large faceted lobes survive
    // minification better than hundreds of sub-pixel fern cards.
    const parts = [
      lobe(0, 1.6, 0, 2.5, 1.6, 2.1),
      lobe(-2.0, 1.8, 0.6, 1.8, 1.8, 1.6),
      lobe(2.0, 1.5, -0.5, 1.9, 1.5, 1.8),
      lobe(0.5, 2.5, 1.0, 1.6, 1.8, 1.5),
    ];
    const g = shadeByHeight(merged(parts, parts[0]), 0.28, 0.75);
    g.computeBoundingBox(); g.translate(0, -g.boundingBox.min.y, 0); shadeByHeight(g, 0.28, 0.75);
    g.name = "cbz-forest-thicket";
    g.userData.vegetationArchetype = "thicket";
    return g;
  }

  const builders = {
    "mature-wood": matureWood,
    "mature-crown": matureCrown,
    "landscape-wood": landscapeWood,
    "landscape-crown": landscapeCrown,
    subcanopy: subcanopy,
    "canopy-patch": canopyPatch,
    thicket: thicket,
  };

  function geometry(kind) {
    if (!cache[kind]) {
      const fn = builders[kind];
      if (!fn) throw new Error("unknown vegetation archetype: " + kind);
      cache[kind] = fn();
    }
    return cache[kind];
  }

  function material(kind) {
    const key = /wood$/.test(kind) ? "wood" : (kind === "thicket" ? "thicket" : "foliage");
    if (mats[key]) return mats[key];
    const m = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true, flatShading: true });
    m.name = "CBZ vegetation " + key; m._shared = true;
    mats[key] = m;
    return m;
  }

  // Small shared assembly seam. Ecology owners provide placement and colour;
  // this owns the repetitive InstancedMesh wiring and publishes the layer so
  // browser QA can inspect scale/count without scraping anonymous scene nodes.
  const layers = (CBZ.vegetationLayers = CBZ.vegetationLayers || []);
  function instanceLayer(root, spec, items) {
    spec = spec || {}; items = items || [];
    if (!root || !items.length) return null;
    const kind = spec.kind || "canopy-patch";
    const mesh = new THREE.InstancedMesh(spec.geometry || geometry(kind), spec.material || material(kind), items.length);
    mesh.name = spec.name || ("vegetation-" + kind);
    mesh.castShadow = !!spec.castShadow;
    mesh.receiveShadow = spec.receiveShadow !== false;
    mesh.frustumCulled = spec.frustumCulled === true;
    const dummy = new THREE.Object3D(), color = new THREE.Color();
    const colors = new Float32Array(items.length * 3);
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (spec.transform) spec.transform(dummy, it, i);
      else {
        dummy.position.set(it.x || 0, it.y || 0, it.z || 0);
        dummy.rotation.set(it.rx || 0, it.ry || 0, it.rz || 0);
        dummy.scale.set(it.sx == null ? (it.s == null ? 1 : it.s) : it.sx,
          it.sy == null ? (it.s == null ? 1 : it.s) : it.sy,
          it.sz == null ? (it.s == null ? 1 : it.s) : it.sz);
      }
      dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix);
      if (spec.color) spec.color(color, it, i);
      else if (it.color != null) color.set(it.color);
      else color.set(0xffffff);
      colors[i * 3] = color.r; colors[i * 3 + 1] = color.g; colors[i * 3 + 2] = color.b;
    }
    mesh.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
    mesh.instanceMatrix.needsUpdate = true;
    mesh.userData.vegetationLayer = kind;
    mesh.userData.sceneryScale = true;
    mesh.userData.instanceCount = items.length;
    if (spec.owner) mesh.userData.vegetationOwner = spec.owner;
    root.add(mesh);
    layers.push(mesh);
    return mesh;
  }

  CBZ.vegetationKit = {
    geometry: geometry,
    material: material,
    instanceLayer: instanceLayer,
    nominal: {
      matureWoodHeight: 20,
      matureCrownBase: 13,
      matureCrownHeight: 14,
      matureCrownRadius: 8.9,
      subcanopyHeight: 7,
      canopyPatchRadius: 7.8,
      thicketHeight: 4.3,
    },
  };
  CBZ.vegetationInstanceLayer = instanceLayer;
})();
