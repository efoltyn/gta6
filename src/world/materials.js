/* ============================================================
   world/materials.js — material factory, box helper, textures.
   These are the building blocks every world/* module uses.

   WET ROADS (rain tie-in): CBZ.roadMat() hands out a shared, cached
   MeshStandardMaterial (asphalt look, textured with checkerTex — same
   canvas approach ground.js already uses for the Lambert path) that
   this file itself keeps damp-looking while it rains. weather.js is
   the source of truth for rain intensity (CBZ.weather.intensity) but
   loads AFTER this file in index.html, so we never touch it at
   module-load time — only inside the per-frame tick below, feature-
   detected every call. "Wet" here is the cheap, definitely-works
   version the research pass calls for: darken the base colour toward
   wet-asphalt black, drop roughness (shinier/tighter highlight) and
   raise metalness a touch so it picks up whatever envMap exists,
   ALL interpolated (never snapped) so puddles build up over the
   seconds rain intensity rises and dry back out the same way. No
   render-target planar reflection pass — a second scene render per
   frame for every wet road tile is exactly the draw-call regression
   this engine's budget forbids, and MeshStandardMaterial's specular
   response already sells "wet" convincingly at zero extra draw calls.
   Existing MeshLambertMaterial road tiles (ground.js, world.js, etc.)
   are untouched — Lambert has no roughness/metalness to animate, and
   this file must not change what OTHER files already construct.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  // Jail geometry belongs to one mode-owned root. Survival's builder reparents
  // the handful of addBox results it creates into its own arena immediately.
  const scene = CBZ.prisonRoot || CBZ.scene;

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

  // ---- wet asphalt (Technique 3: rain-reactive road material) --------
  // Dry/wet endpoints authored once; every road material this factory
  // hands out lerps its live .color between them and eases roughness/
  // metalness the same way, driven by CBZ.weather.intensity each frame.
  // Kept as plain objects (not THREE.Color instances) so this block has
  // zero cost when THREE.Color isn't needed yet (module-load time, no
  // renderer/weather present).
  const DRY_COL = 0x5b626c;   // matches CBZ.COL.ASPHALT_A's midtone
  const WET_COL = 0x24272c;   // darker, wet-slick asphalt
  const DRY_ROUGH = 0.92, WET_ROUGH = 0.32;   // wetter = shinier (lower roughness)
  const DRY_METAL = 0.02, WET_METAL = 0.12;   // a touch of metalness picks up envMap specular

  const roadMats = [];         // every material this factory ever produced
  let wetK = 0;                // smoothed 0..1 "how wet the road looks" (own damping — weather's own intensity already eases, this just avoids a second snap on top)
  const _dryC = new THREE.Color(DRY_COL), _wetC = new THREE.Color(WET_COL), _roadC = new THREE.Color();

  // color: hex (defaults to the shared asphalt tone) — pass a checkerTex()
  // canvas map via opts.map for the textured look ground.js/world.js use.
  // Standard (not Lambert) ON PURPOSE: it's the only material type in this
  // codebase with roughness/metalness to animate (carfx.js already uses
  // MeshStandardMaterial for exactly this reason) — everything else here
  // stays Lambert so this is an additive option, not a swap of the default.
  function roadMat(opts) {
    opts = opts || {};
    const m = new THREE.MeshStandardMaterial({
      color: opts.color != null ? opts.color : DRY_COL,
      map: opts.map || null,
      roughness: DRY_ROUGH,
      metalness: DRY_METAL,
      envMap: CBZ.ENV || null, // carfx.js may not have built this yet; opportunistic only
    });
    m._roadWet = true;
    m._roadBase = new THREE.Color(opts.color != null ? opts.color : DRY_COL);
    roadMats.push(m);
    return m;
  }

  // Runs late (after weather's own order-90 intensity update) so we react
  // to THIS frame's rain, not last frame's. Cheap: a couple of lerps per
  // live road material, only when any exist (headless/menu builds pay ~0).
  CBZ.onAlways(92, function (dt) {
    if (!roadMats.length) return;
    const rainI = (CBZ.weather && typeof CBZ.weather.intensity === "number") ? CBZ.weather.intensity : 0;
    // ease our own wetness a beat behind rain intensity — puddles form/drain
    // over a couple seconds, they don't snap with every gust of rain.
    const rate = dt ? Math.min(1, dt * 0.6) : 0;
    wetK += (rainI - wetK) * rate;
    if (wetK < 0.002) wetK = 0;
    _roadC.copy(_dryC).lerp(_wetC, wetK);
    const rough = DRY_ROUGH + (WET_ROUGH - DRY_ROUGH) * wetK;
    const metal = DRY_METAL + (WET_METAL - DRY_METAL) * wetK;
    for (let i = 0; i < roadMats.length; i++) {
      const m = roadMats[i];
      // multiply the material's OWN base tint by the shared dry/wet ratio
      // instead of overwriting .color outright, so callers that pass a
      // custom `opts.color` (a different asphalt shade) still darken
      // proportionally rather than all converging on one grey.
      const k = _dryC.r > 0.001 ? (_roadC.r / _dryC.r) : 1;
      m.color.copy(m._roadBase).multiplyScalar(k);
      m.roughness = rough;
      m.metalness = metal;
      if (!m.envMap && CBZ.ENV) { m.envMap = CBZ.ENV; m.needsUpdate = true; } // backfill if carfx's env built later
    }
  });

  CBZ.mat = mat;
  CBZ.cmat = cmat;
  CBZ.boxGeom = boxGeom;
  CBZ.addBox = addBox;
  CBZ.checkerTex = checkerTex;
  CBZ.concreteTex = concreteTex;
  CBZ.roadMat = roadMat;
})();
