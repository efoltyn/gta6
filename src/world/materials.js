/* ============================================================
   world/materials.js — material factory, box helper, textures.
   These are the building blocks every world/* module uses.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const scene = CBZ.scene;

  // basic lambert material with optional emissive glow. FRESH every call —
  // use this when something will MUTATE the material per-instance (e.g.
  // reactions.js flashes each NPC's head emissive; sharing would bleed).
  function mat(color, opts) {
    opts = opts || {};
    return new THREE.MeshLambertMaterial({
      color,
      emissive: opts.emissive || 0x000000,
      emissiveIntensity: opts.ei != null ? opts.ei : 1,
    });
  }

  // ---- shared caches (the scaling foundation: with hundreds of NPCs we
  //      reuse ~10 geometries + a handful of materials instead of ~16 geoms
  //      + ~12 materials PER character). Anything tagged `_shared` must NEVER
  //      be disposed (see entities/survivorbot.js clear). Only use cmat() for
  //      surfaces nothing mutates per-instance — the head stays mat(). ----
  const matCache = new Map();
  function cmat(color, opts) {
    opts = opts || {};
    const em = opts.emissive || 0, ei = opts.ei != null ? opts.ei : 1;
    const k = color + "|" + em + "|" + ei;
    let m = matCache.get(k);
    if (!m) {
      m = new THREE.MeshLambertMaterial({ color: color, emissive: em, emissiveIntensity: ei });
      m._shared = true;
      matCache.set(k, m);
    }
    return m;
  }

  const geomCache = new Map();
  function boxGeom(w, h, d) {
    const k = w + "," + h + "," + d;
    let g = geomCache.get(k);
    if (!g) { g = new THREE.BoxGeometry(w, h, d); g._shared = true; geomCache.set(k, g); }
    return g;
  }

  // the workhorse: place a box, optionally make it a collider / LOS blocker
  function addBox(x, y, z, w, h, d, color, opts) {
    opts = opts || {};
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color, opts));
    m.position.set(x, y, z);
    m.castShadow = opts.cast !== false;
    m.receiveShadow = opts.receive !== false;
    scene.add(m);
    if (opts.solid) {
      const col = { minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, ref: m };
      // optional vertical span → a height-gated wall (window sill / doorway /
      // upper-floor wall). Actors only collide when their body overlaps [y0,y1];
      // colliders without it stay full-height, so the prison is unaffected.
      if (opts.y0 != null) col.y0 = opts.y0;
      if (opts.y1 != null) col.y1 = opts.y1;
      CBZ.colliders.push(col);
      m.userData.collider = col;
    }
    if (opts.blockLOS) CBZ.losBlockers.push(m);
    return m;
  }

  // 2-tone checker texture (grass / asphalt)
  function checkerTex(a, b, n) {
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    const g = c.getContext("2d");
    const s = 256 / n;
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        g.fillStyle = (i + j) % 2 ? a : b;
        g.fillRect(i * s, j * s, s, s);
      }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.NearestFilter;
    return t;
  }

  // speckled concrete texture for indoor floors / walls
  function concreteTex(base, speck) {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const g = c.getContext("2d");
    g.fillStyle = base; g.fillRect(0, 0, 128, 128);
    g.fillStyle = speck;
    for (let i = 0; i < 220; i++) {
      const x = (i * 53) % 128, y = (i * 97) % 128;     // deterministic specks
      g.globalAlpha = 0.06 + ((i * 7) % 10) / 60;
      g.fillRect(x, y, 2, 2);
    }
    g.globalAlpha = 1;
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  }

  CBZ.mat = mat;
  CBZ.cmat = cmat;
  CBZ.boxGeom = boxGeom;
  CBZ.addBox = addBox;
  CBZ.checkerTex = checkerTex;
  CBZ.concreteTex = concreteTex;
})();
