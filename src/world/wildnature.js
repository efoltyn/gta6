/* ============================================================
   world/wildnature.js — WILD NATURE SCATTER (the lush backdrop).

   WHY this exists: the playable world is flat (terrainHeight ≈ 0 across
   the city / biomes / islands) but the FAR BACKDROP ring rises into hills
   and mountain foothills (see world/terrain.js). Those hills were bare.
   This module FORESTS them — thousands of stylized low-poly trees, rocks
   and grass tufts blanketing the relief so the horizon reads as a lush,
   forested land instead of an empty grey shell. Pure backdrop: it only
   ever scatters where the ground has RISEN (groundY > 0.5), so it never
   touches anything playable and adds zero gameplay risk.

   DRAW-CALL DISCIPLINE (owner rule #4 — the game is ~1000-NPC draw-call
   bound): EVERYTHING here is THREE.InstancedMesh. Thousands of trees cost
   ~6-7 draw calls total, not thousands of meshes:
     • conifer   = 1 trunk IM + 1 stacked-cone crown IM
     • broadleaf = 1 trunk IM + 1 squashed-icosahedron crown IM
     • birch     = 1 thin-trunk IM + 1 small round crown IM  (shares broadleaf crown geo)
     • snag      = 1 bare-trunk IM (NO crown — a dead/burned tree silhouette,
                   the 4th species; cheaper than the others, not more)
     • rocks     = 1 icosahedron IM
     • grass     = 1 cross-billboard IM   (capped count)
   Per-instance scale + colour variation via instanceColor on a white-based
   MeshLambertMaterial (one material per mesh — colour never costs a draw
   call). frustumCulled=false on every InstancedMesh (r128's per-object
   bounding-sphere cull throws away instanced meshes whose origin is off
   screen — without this, whole tree fields vanish at the map edge).

   SIMPLE DISTANCE LOD: a throttled onUpdate checks ONE distance (camera/
   player to the wild-nature field's centre) and toggles castShadow off
   across every species' InstancedMeshes when nobody is near enough to see
   the shadows resolve (shadow-casting thousands of instanced trees at
   backdrop range is pure wasted shadow-map fill-rate). O(species count)
   per check, not O(instance count) — cheap regardless of how many trees.

   NO per-instance colliders: this is distant visual-only backdrop you can't
   reach (it lives on the un-walkable backdrop hills). Matches biome_forest,
   which only colliders a handful of landmarks, not its thousands of trunks.

   Gated behind CBZ.WILD_NATURE !== false (default ON). Deterministic from a
   local seeded rng (owner rule #5 — same forest every run, never Math.random).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;

  // ---- terrain contract (world/terrain.js builds the relief; loaded before
  //      us at runtime). Tolerant fallbacks so we stay headless / parse-safe
  //      and so a missing terrain just yields a flat decorative belt. --------
  function groundY(x, z) { return (CBZ.terrainHeight ? CBZ.terrainHeight(x, z) : 0); }
  function groundN(x, z) { return (CBZ.terrainNormal ? CBZ.terrainNormal(x, z) : new THREE.Vector3(0, 1, 0)); }

  // ---- a tiny local seeded RNG (mulberry32) — deterministic backdrop -------
  function makeRng(seed) {
    let s = seed >>> 0;
    return function () {
      s |= 0; s = (s + 0x6D2B79F5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // shared white-based materials (tinted per-instance via instanceColor). One
  // material per InstancedMesh keeps every species at a single draw call. They
  // are flagged _shared so a mode swap / dispose pass never frees them.
  function whiteMat(flat) {
    const m = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: false, flatShading: !!flat });
    m._shared = true;
    return m;
  }

  let _built = false;

  // ============================================================
  //  THE BUILDER — fans the whole backdrop forest in one pass.
  //  Exposed as CBZ.buildWildNature() and also registered as a landmass so
  //  world.js's cityWorldGeo runs it automatically (after terrain exists).
  // ============================================================
  CBZ.buildWildNature = function (city) {
    if (CBZ.WILD_NATURE === false) return null;
    if (_built) return null;                          // build exactly once per world
    city = city || (CBZ.city && CBZ.city.arena);
    if (!city || !city.root) return null;
    _built = true;

    const root = city.root;
    const rng = CBZ.seedStream ? CBZ.seedStream("wildnature") : makeRng(0x5C3E77);
    const dummy = new THREE.Object3D();
    const col = new THREE.Color();

    // ---- where does the playable, FLAT world end? Build a generous AABB over
    //      every region (mainland + annex island + all biomes) so we can prove
    //      a scatter point is OUTSIDE the playable footprint. We mostly rely on
    //      groundY>0.5 (only the backdrop relief rises), but a few biomes sit
    //      on a slightly raised floor — the AABB is a belt-and-braces keep-out.
    let pMinX = city.minX, pMaxX = city.maxX, pMinZ = city.minZ, pMaxZ = city.maxZ;
    const regs = city.regions || [];
    for (let i = 0; i < regs.length; i++) {
      const r = regs[i];
      if (r.minX < pMinX) pMinX = r.minX;
      if (r.maxX > pMaxX) pMaxX = r.maxX;
      if (r.minZ < pMinZ) pMinZ = r.minZ;
      if (r.maxZ > pMaxZ) pMaxZ = r.maxZ;
    }
    if (city.annex) {
      const a = city.annex, R = a.radius || 120;
      if (a.cx - R < pMinX) pMinX = a.cx - R;
      if (a.cx + R > pMaxX) pMaxX = a.cx + R;
      if (a.cz - R < pMinZ) pMinZ = a.cz - R;
      if (a.cz + R > pMaxZ) pMaxZ = a.cz + R;
    }
    // small inset so trees may grow right up to (but not inside) the playfield
    const PAD = 14;
    function insidePlayfield(x, z) {
      return x > pMinX - PAD && x < pMaxX + PAD && z > pMinZ - PAD && z < pMaxZ + PAD;
    }

    // overall scatter window: the playfield AABB grown by a wide wilderness
    // ring (this is where the backdrop relief lives).
    const RING = 900;
    const wMinX = pMinX - RING, wMaxX = pMaxX + RING;
    const wMinZ = pMinZ - RING, wMaxZ = pMaxZ + RING;

    const haveTerrain = !!CBZ.terrainHeight;

    // ============================================================
    //  GEOMETRY — unit-sized, base at y=0 so per-instance Y-scale grows
    //  upward (exactly the biome_forest pattern). Low radial segment counts
    //  keep the instanced geo cheap.
    // ============================================================
    // conifer: tapered trunk + a STACK of 3 cones baked into one crown geo
    // (so a layered fir is still a single instanced draw call).
    const trunkConGeo = new THREE.CylinderGeometry(0.16, 0.34, 1, 5);
    trunkConGeo.translate(0, 0.5, 0);
    const coniferCrownGeo = (function () {
      const parts = [];
      // three stacked cones, widest at the bottom — a fir silhouette in unit space
      const layers = [
        { y: 0.00, r: 0.62, h: 0.55 },
        { y: 0.42, r: 0.48, h: 0.48 },
        { y: 0.78, r: 0.30, h: 0.40 },
      ];
      for (const L of layers) {
        const c = new THREE.ConeGeometry(L.r, L.h, 6);
        c.translate(0, L.y + L.h / 2, 0);
        parts.push(c);
      }
      const BGU = THREE.BufferGeometryUtils;
      const merge = BGU && BGU.mergeBufferGeometries && BGU.mergeBufferGeometries.bind(BGU);
      if (merge) { const g = merge(parts, false); if (g) return g; }
      // fallback (BufferGeometryUtils absent): single tall cone
      const f = new THREE.ConeGeometry(0.6, 1.2, 6); f.translate(0, 0.6, 0); return f;
    })();

    // broadleaf: tapered trunk + a squashed icosahedron crown (a soft round
    // canopy). Birch reuses this crown geo (smaller per-instance scale).
    const trunkBroadGeo = new THREE.CylinderGeometry(0.22, 0.40, 1, 5);
    trunkBroadGeo.translate(0, 0.5, 0);
    const broadCrownGeo = new THREE.IcosahedronGeometry(0.6, 0);
    broadCrownGeo.scale(1, 0.82, 1);
    broadCrownGeo.translate(0, 0.55, 0);

    // birch: a thin near-cylindrical trunk (pale), small round crown reuses
    // broadCrownGeo via its own instanced mesh.
    const trunkBirchGeo = new THREE.CylinderGeometry(0.11, 0.16, 1, 5);
    trunkBirchGeo.translate(0, 0.5, 0);

    // SNAG (4th species) — a bare, gnarled dead/burned trunk with a couple of
    // stub branches baked into ONE geo (still a single instanced draw call,
    // no crown mesh at all — genuinely distinct silhouette: gaunt and leafless
    // instead of another conical/round canopy). Adds visual variety to the
    // backdrop without adding cost (it's cheaper than every other species).
    const snagGeo = (function () {
      const trunk = new THREE.CylinderGeometry(0.07, 0.20, 1, 5);
      trunk.translate(0, 0.5, 0);
      const parts = [trunk];
      // two stub branches jutting off at fixed angles (unit space; baked in)
      const stubs = [{ y: 0.55, len: 0.30, tilt: 0.9, rotY: 0.6 }, { y: 0.78, len: 0.22, tilt: -0.8, rotY: 2.6 }];
      for (const s of stubs) {
        const b = new THREE.CylinderGeometry(0.025, 0.05, s.len, 4);
        b.translate(0, s.len / 2, 0);
        b.rotateZ(s.tilt);
        b.rotateY(s.rotY);
        b.translate(0, s.y, 0);
        parts.push(b);
      }
      const merge = THREE.BufferGeometryUtils && THREE.BufferGeometryUtils.mergeBufferGeometries;
      if (merge) { const g = merge(parts, false); if (g) return g; }
      return trunk;   // fallback (BufferGeometryUtils absent): plain bare trunk
    })();

    // rocks: a single low icosahedron, jittered per-instance.
    const rockGeo = new THREE.IcosahedronGeometry(1, 0);

    // grass/shrub tuft: a 3-quad cross-billboard (cheap, reads as a tuft from
    // any angle). Built by hand so it is one small merged geometry; each quad
    // has its base at y=0 (so per-instance Y-scale grows the blade upward).
    const grassGeo = (function () {
      const BGU = THREE.BufferGeometryUtils;
      const merge = BGU && BGU.mergeBufferGeometries && BGU.mergeBufferGeometries.bind(BGU);
      if (merge) {
        const quads = [];
        for (let i = 0; i < 3; i++) {
          const q = new THREE.PlaneGeometry(1, 1);
          q.translate(0, 0.5, 0);                      // base on the ground
          q.rotateY((i / 3) * Math.PI);                // fan three blades into a cross/star
          quads.push(q);
        }
        const g = merge(quads, false);
        if (g) return g;
      }
      // fallback (BufferGeometryUtils absent): a single upright quad
      const f = new THREE.PlaneGeometry(1, 1);
      f.translate(0, 0.5, 0);
      return f;
    })();

    // ============================================================
    //  SCATTER — grid-jitter over the wilderness window. For each candidate:
    //  reject if inside the playfield AABB, reject water (groundY<0.3), reject
    //  flat playable ground (groundY<0.5 — only the backdrop relief qualifies),
    //  reject steep cliffs (normal.y<0.6). Survivors are sorted into species.
    // ============================================================
    const conifers = [], broadleaves = [], birches = [], snags = [], rockList = [], grasses = [];
    const STEP = 26;                                  // grid pitch (jittered)
    const J = STEP * 0.62;                            // jitter amplitude
    // Scatter density rides the quality tier, read ONCE here at build time
    // (the world is generated once; a slider move applies on the next build).
    // qScale may be absent in headless tests → fall back to the old caps.
    const CAP_TREES = (CBZ.qScale ? CBZ.qScale(2600, 7500) : 5200) | 0;
    const CAP_ROCKS = (CBZ.qScale ? CBZ.qScale(700, 2100) : 1400) | 0;
    const CAP_GRASS = (CBZ.qScale ? CBZ.qScale(1600, 4800) : 3200) | 0;

    function classify(x, z) {
      // playable keep-out + the flat-ground / water / cliff rules
      if (insidePlayfield(x, z)) return null;
      const gy = groundY(x, z);
      if (gy < 0.5) return null;                       // flat playfield apron or sea floor
      if (gy < 0.3) return null;                       // water (redundant w/ above, kept explicit)
      const ny = groundN(x, z).y;
      if (ny < 0.6) return null;                       // steep cliff face — nothing roots here
      return { gy, ny };
    }

    for (let gx = wMinX; gx <= wMaxX; gx += STEP) {
      for (let gz = wMinZ; gz <= wMaxZ; gz += STEP) {
        const x = gx + (rng() - 0.5) * J;
        const z = gz + (rng() - 0.5) * J;
        const hit = classify(x, z);
        if (!hit) continue;
        const y = hit.gy;

        // higher / steeper-but-still-rootable ground favours conifers; gentler
        // lower foothills get more broadleaf + birch. Density also rises with
        // height so the peaks read densely forested.
        const r = rng();

        // GRASS / SHRUB tuft (its own scatter density — many, but capped).
        // ELEVATION CLAMP: grass only roots on LOW foothill ground (below the
        // treeline). Above ~14u it would land on bare peak shoulders / the
        // snowline and read as a flat green plane hanging in the air.
        if (y < 14 && rng() < 0.55 && grasses.length < CAP_GRASS) {
          grasses.push({ x, z, y, s: 0.6 + rng() * 1.3, rot: rng() * 6.28 });
        }
        // ROCKS — sparse, more on steeper ground.
        if (rng() < (hit.ny < 0.78 ? 0.10 : 0.045) && rockList.length < CAP_ROCKS) {
          rockList.push({ x, z, y, s: 0.5 + rng() * 2.4, rot: rng() * 6.28, tilt: (rng() - 0.5) * 0.5 });
        }

        // TREES — keep probability rises with elevation (lusher highlands).
        const treeP = 0.34 + Math.min(0.5, (y - 0.5) * 0.012);
        if (r > treeP) continue;
        if (conifers.length + broadleaves.length + birches.length + snags.length >= CAP_TREES) continue;

        const pick = rng();
        const rot = rng() * 6.28;
        const lean = (rng() - 0.5) * 0.06;
        if (pick < 0.56) {
          // CONIFER — taller, narrower; dominant on the high ground
          const h = 7 + rng() * 13;
          conifers.push({ x, z, y, h, tr: 0.55 + rng() * 0.5, rot, lean,
            cR: 0.7 + rng() * 0.5, cH: h * (0.9 + rng() * 0.25) });
        } else if (pick < 0.80) {
          // BROADLEAF — squat, round canopy
          const h = 5 + rng() * 8;
          broadleaves.push({ x, z, y, h, tr: 0.7 + rng() * 0.6, rot, lean,
            cR: h * (0.42 + rng() * 0.16), cH: h * (0.5 + rng() * 0.2),
            cY: h * (0.7 + rng() * 0.1) });
        } else if (pick < 0.93) {
          // BIRCH — thin, pale, airy
          const h = 6 + rng() * 7;
          birches.push({ x, z, y, h, tr: 0.6 + rng() * 0.5, rot, lean,
            cR: h * (0.26 + rng() * 0.12), cH: h * (0.34 + rng() * 0.16),
            cY: h * (0.74 + rng() * 0.08) });
        } else {
          // SNAG — sparse dead/bare trees (4th species), a bit shorter on
          // average so a few gaunt silhouettes punctuate the canopy rather
          // than dominate it.
          const h = 5 + rng() * 9;
          snags.push({ x, z, y, h, tr: 0.5 + rng() * 0.4, rot, lean });
        }
      }
    }

    // ---- TERRAIN-ABSENT FALLBACK: no relief to forest, so plant a modest
    //      decorative tree BELT just outside the playfield on flat ground,
    //      still fully instanced. Keeps the horizon from being naked even
    //      before world/terrain.js exists. -----------------------------------
    if (!haveTerrain && conifers.length + broadleaves.length + birches.length === 0) {
      const cX = (pMinX + pMaxX) / 2, cZ = (pMinZ + pMaxZ) / 2;
      const beltR = Math.max(pMaxX - pMinX, pMaxZ - pMinZ) / 2 + 90;   // just past the edge
      const BELT_N = 1400;
      for (let i = 0; i < BELT_N; i++) {
        const a = rng() * Math.PI * 2;
        const rr = beltR + rng() * 220;                                // a band, not a ring
        const x = cX + Math.cos(a) * rr, z = cZ + Math.sin(a) * rr;
        if (insidePlayfield(x, z)) continue;
        const rot = rng() * 6.28, lean = (rng() - 0.5) * 0.05;
        const pick = rng();
        if (pick < 0.62) {
          const h = 7 + rng() * 11;
          conifers.push({ x, z, y: 0, h, tr: 0.55 + rng() * 0.5, rot, lean,
            cR: 0.7 + rng() * 0.5, cH: h * (0.9 + rng() * 0.25) });
        } else if (pick < 0.88) {
          const h = 5 + rng() * 7;
          broadleaves.push({ x, z, y: 0, h, tr: 0.7 + rng() * 0.6, rot, lean,
            cR: h * (0.42 + rng() * 0.16), cH: h * (0.5 + rng() * 0.2), cY: h * (0.72) });
        } else {
          const h = 6 + rng() * 6;
          birches.push({ x, z, y: 0, h, tr: 0.6 + rng() * 0.4, rot, lean,
            cR: h * (0.26 + rng() * 0.1), cH: h * (0.34 + rng() * 0.14), cY: h * (0.74) });
        }
        if (rng() < 0.5) grasses.push({ x, z, y: 0, s: 0.6 + rng() * 1.2, rot: rng() * 6.28 });
      }
    }

    // ============================================================
    //  BUILD the InstancedMeshes. Helper builds one species (trunk + crown)
    //  with per-instance matrix + instanceColor in a single pass.
    // ============================================================
    const speciesIMs = [];   // every trunk/crown InstancedMesh built below (for the distance LOD pass)
    function buildSpecies(list, trunkGeo, crownGeo, opts) {
      const N = list.length;
      if (!N) return;
      const trunkMat = whiteMat(false);
      const crownMat = whiteMat(false);
      const trunkIM = new THREE.InstancedMesh(trunkGeo, trunkMat, N);
      const crownIM = new THREE.InstancedMesh(crownGeo, crownMat, N);
      trunkIM.castShadow = crownIM.castShadow = true;
      trunkIM.receiveShadow = crownIM.receiveShadow = true;
      trunkIM.frustumCulled = false; crownIM.frustumCulled = false;   // r128 instanced cull bug
      const tCol = new Float32Array(N * 3), cCol = new Float32Array(N * 3);

      for (let i = 0; i < N; i++) {
        const t = list[i];
        // TRUNK — unit cylinder scaled to (radius, height, radius), base on ground
        dummy.position.set(t.x, t.y, t.z);
        dummy.rotation.set(t.lean, t.rot, t.lean * 0.5);
        dummy.scale.set(t.tr, t.h, t.tr);
        dummy.updateMatrix();
        trunkIM.setMatrixAt(i, dummy.matrix);

        // CROWN — sits atop the trunk. opts.crownAtTop controls how the unit
        // crown geo maps onto the tree (conifer crown sits from ~55% up the
        // trunk; broadleaf/birch crowns are a ball centred at cY).
        let cy, cs;
        if (opts.kind === "conifer") {
          cy = t.y + t.h * 0.5;                 // crown starts halfway up
          cs = Math.max(t.cR, 0.4);
          dummy.position.set(t.x, cy, t.z);
          dummy.rotation.set(t.lean, t.rot, t.lean * 0.5);
          dummy.scale.set(cs, t.cH, cs);        // crown geo is unit-height; cH scales the stack
        } else {
          cy = t.y + t.cY;
          dummy.position.set(t.x, cy, t.z);
          dummy.rotation.set(t.lean, t.rot, t.lean * 0.5);
          dummy.scale.set(t.cR, t.cH, t.cR);
        }
        dummy.updateMatrix();
        crownIM.setMatrixAt(i, dummy.matrix);

        // ---- per-instance COLOUR (instanceColor — still one draw call) ----
        opts.tint(col, rng, t);                 // sets `col` for the crown
        cCol[i * 3] = col.r; cCol[i * 3 + 1] = col.g; cCol[i * 3 + 2] = col.b;
        opts.bark(col, rng, t);                 // sets `col` for the trunk
        tCol[i * 3] = col.r; tCol[i * 3 + 1] = col.g; tCol[i * 3 + 2] = col.b;
      }
      trunkIM.instanceColor = new THREE.InstancedBufferAttribute(tCol, 3);
      crownIM.instanceColor = new THREE.InstancedBufferAttribute(cCol, 3);
      trunkIM.instanceMatrix.needsUpdate = true;
      crownIM.instanceMatrix.needsUpdate = true;
      root.add(trunkIM); root.add(crownIM);
      speciesIMs.push(trunkIM, crownIM);
    }

    // CONIFER — dark blue-green needles, brown bark
    buildSpecies(conifers, trunkConGeo, coniferCrownGeo, {
      kind: "conifer",
      tint: function (c, r) { c.setRGB(0.08 + r() * 0.07, 0.26 + r() * 0.16, 0.12 + r() * 0.08); },
      bark: function (c, r) { const s = 0.30 + r() * 0.14; c.setRGB(s, s * 0.66, s * 0.40); },
    });
    // BROADLEAF — brighter leafy green, warm brown bark
    buildSpecies(broadleaves, trunkBroadGeo, broadCrownGeo, {
      kind: "broad",
      tint: function (c, r) { c.setRGB(0.26 + r() * 0.18, 0.44 + r() * 0.18, 0.16 + r() * 0.10); },
      bark: function (c, r) { const s = 0.34 + r() * 0.16; c.setRGB(s, s * 0.62, s * 0.36); },
    });
    // BIRCH — pale yellow-green crown, near-white bark (the airy accent tree)
    buildSpecies(birches, trunkBirchGeo, broadCrownGeo, {
      kind: "broad",
      tint: function (c, r) { c.setRGB(0.42 + r() * 0.16, 0.56 + r() * 0.14, 0.22 + r() * 0.10); },
      bark: function (c, r) { const s = 0.78 + r() * 0.14; c.setRGB(s, s, s * 0.94); },
    });

    // SNAG (4th species) — a single-mesh species (bare trunk + stub branches
    // baked into ONE geo, no separate crown IM needed — cheaper than the
    // other three species, not more). Grey-brown, weathered/burned bark tint.
    const snagIMs = [];
    if (snags.length) {
      const N = snags.length;
      const snagMat = whiteMat(false);
      const snagIM = new THREE.InstancedMesh(snagGeo, snagMat, N);
      snagIM.castShadow = true; snagIM.receiveShadow = true;
      snagIM.frustumCulled = false;
      const sCol = new Float32Array(N * 3);
      for (let i = 0; i < N; i++) {
        const t = snags[i];
        dummy.position.set(t.x, t.y, t.z);
        dummy.rotation.set(t.lean, t.rot, t.lean * 0.5);
        dummy.scale.set(t.tr, t.h, t.tr);
        dummy.updateMatrix();
        snagIM.setMatrixAt(i, dummy.matrix);
        const g = 0.30 + rng() * 0.14;               // grey-brown weathered wood
        col.setRGB(g, g * 0.86, g * 0.72);
        sCol[i * 3] = col.r; sCol[i * 3 + 1] = col.g; sCol[i * 3 + 2] = col.b;
      }
      snagIM.instanceColor = new THREE.InstancedBufferAttribute(sCol, 3);
      snagIM.instanceMatrix.needsUpdate = true;
      root.add(snagIM);
      snagIMs.push(snagIM);
    }

    // ============================================================
    //  ROCKS — one instanced icosahedron, grey/brown per-instance, flatShaded.
    // ============================================================
    if (rockList.length) {
      const rockMat = whiteMat(true);                  // flatShading on for crisp facets
      const NR = rockList.length;
      const rockIM = new THREE.InstancedMesh(rockGeo, rockMat, NR);
      rockIM.castShadow = rockIM.receiveShadow = true;
      rockIM.frustumCulled = false;
      const rCol = new Float32Array(NR * 3);
      for (let i = 0; i < NR; i++) {
        const k = rockList[i];
        dummy.position.set(k.x, k.y + k.s * 0.35, k.z);
        dummy.rotation.set(k.tilt, k.rot, k.tilt * 0.7);
        dummy.scale.set(k.s, k.s * (0.7 + ((k.s * 13) % 1) * 0.4), k.s);
        dummy.updateMatrix();
        rockIM.setMatrixAt(i, dummy.matrix);
        // grey with a hint of warm brown variance
        const g = 0.38 + rng() * 0.22;
        col.setRGB(g, g * (0.93 + rng() * 0.1), g * 0.9);
        rCol[i * 3] = col.r; rCol[i * 3 + 1] = col.g; rCol[i * 3 + 2] = col.b;
      }
      rockIM.instanceColor = new THREE.InstancedBufferAttribute(rCol, 3);
      rockIM.instanceMatrix.needsUpdate = true;
      root.add(rockIM);
    }

    // ============================================================
    //  GRASS / SHRUB TUFTS — one instanced cross-billboard, capped count.
    //  DoubleSide so the cross reads from any camera angle; the tuft sits on
    //  the ground (base at y=0 in geo space) and is scaled small.
    // ============================================================
    if (grasses.length) {
      const grassMat = new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide });
      grassMat._shared = true;
      const NG = grasses.length;
      const grassIM = new THREE.InstancedMesh(grassGeo, grassMat, NG);
      grassIM.castShadow = false;                      // tufts don't need to cast (perf)
      grassIM.receiveShadow = true;
      grassIM.frustumCulled = false;
      const gCol = new Float32Array(NG * 3);
      for (let i = 0; i < NG; i++) {
        const t = grasses[i];
        dummy.position.set(t.x, t.y, t.z);
        dummy.rotation.set(0, t.rot, 0);
        dummy.scale.set(t.s * 1.3, t.s * 1.6, t.s * 1.3);
        dummy.updateMatrix();
        grassIM.setMatrixAt(i, dummy.matrix);
        col.setRGB(0.22 + rng() * 0.16, 0.40 + rng() * 0.18, 0.14 + rng() * 0.08);
        gCol[i * 3] = col.r; gCol[i * 3 + 1] = col.g; gCol[i * 3 + 2] = col.b;
      }
      grassIM.instanceColor = new THREE.InstancedBufferAttribute(gCol, 3);
      grassIM.instanceMatrix.needsUpdate = true;
      root.add(grassIM);
    }

    // ============================================================
    //  SIMPLE DISTANCE LOD — thousands of tree instances render full detail
    //  at every distance today. A throttled onUpdate checks ONE distance
    //  (camera/player to the wilderness field's centre, the playfield AABB
    //  midpoint) and toggles castShadow off across every tree species'
    //  InstancedMeshes once nobody is close enough for the shadows to
    //  resolve into anything visible — backdrop trees on distant hills are
    //  never close to the camera, so this is close to a permanent win, but
    //  it stays a real distance check (not a hardcoded off) so a flycam /
    //  future traversal upgrade still gets shadows up close. Hysteresis band
    //  avoids flicker at the boundary. O(species count), not O(instance
    //  count) — cheap no matter how many trees CAP_TREES allows.
    // ============================================================
    (function distanceLOD() {
      const allTreeIMs = speciesIMs.concat(snagIMs);
      if (!CBZ.onUpdate || !allTreeIMs.length) return;
      const lodCX = (pMinX + pMaxX) / 2, lodCZ = (pMinZ + pMaxZ) / 2;
      const fieldR = Math.max(pMaxX - pMinX, pMaxZ - pMinZ) / 2;
      const LOD_NEAR = fieldR + RING * 0.45, LOD_FAR = fieldR + RING * 0.65;   // hysteresis band
      let detailed = true;
      CBZ.onUpdate(99.2, function () {
        const P = CBZ.player;
        if (!P || !P.pos) return;
        const d = Math.hypot(P.pos.x - lodCX, P.pos.z - lodCZ);
        if (detailed && d > LOD_FAR) {
          detailed = false;
          for (let i = 0; i < allTreeIMs.length; i++) allTreeIMs[i].castShadow = false;
        } else if (!detailed && d < LOD_NEAR) {
          detailed = true;
          for (let i = 0; i < allTreeIMs.length; i++) allTreeIMs[i].castShadow = true;
        }
      });
    })();

    // ============================================================
    //  FLOCKING BIRDS — small ambient bird flocks wheeling above the
    //  wilderness backdrop. Classic boids: each bird steers by summing three
    //  cheap rules against its OWN flock only (separation / alignment /
    //  cohesion) — no scripted path, no spatial grid needed (a flock is only
    //  8-15 birds, so the O(n^2) neighbour scan per flock is a few hundred
    //  ops, not a simulation-heavy system). A handful of flocks total keeps
    //  this squarely "ambient background wildlife", matching biome_forest's
    //  deer-wander in spirit: deterministic (same seeded rng as the rest of
    //  this file, never Math.random), cheap amortized per-frame cost.
    //
    //  RENDER: ONE InstancedMesh for every bird everywhere (bodies) + ONE more
    //  for wings (two wing-plane triangles baked per bird into a single
    //  instance slot via a merged unit geo) — 2 draw calls total no matter
    //  how many flocks, same discipline as the tree species above. The wing
    //  geo is a separate IM (not merged into the body) purely so wings can
    //  flap: a per-instance flap angle is baked into that instance's matrix
    //  every update tick, which the body doesn't need.
    //
    //  A silhouette this small and this far away never needs to look like a
    //  real bird up close — two flat wing triangles + a tiny elongated body
    //  reads correctly at backdrop distance, and it is gated by the SAME
    //  distance LOD centre used for the trees (birds simply stop updating,
    //  matrices frozen, once nobody is near enough to notice).
    // ============================================================
    (function flockingBirds() {
      if (!CBZ.onUpdate || !THREE.InstancedMesh) return;

      const FLOCK_COUNT = 3;                 // "a few flocks"
      const BIRDS_PER_FLOCK_MIN = 8, BIRDS_PER_FLOCK_MAX = 15;
      const fieldCX = (pMinX + pMaxX) / 2, fieldCZ = (pMinZ + pMaxZ) / 2;
      const fieldR = Math.max(pMaxX - pMinX, pMaxZ - pMinZ) / 2;

      // ---- unit bird geo: a tiny flattened body sliver (its own IM) plus a
      //      wing IM (two thin triangular planes fanned from centre, unit
      //      span so per-instance scale sets the wingspan). Both start flat
      //      in the XZ-ish plane so a flap is just a hinge rotation about X. ---
      const bodyGeo = new THREE.ConeGeometry(0.09, 1, 4);
      bodyGeo.rotateX(Math.PI / 2);           // point runs along +Z (forward)
      // wing: a single hand-built flat triangle (3 raw vertices, no THREE.Shape
      // dependency — matches how crashfx/highways/beach build ad-hoc geo in this
      // codebase: a plain BufferGeometry + a position attribute). Hinge edge runs
      // along local X at x=0 so rotation.z is a pure flap hinge; the triangle
      // sweeps back and out to (1, 0, -0.12) / (0.55, 0, 0.05) — a simple swept
      // wing silhouette, unit span so per-instance scale sets the wingspan.
      const wingGeo = (function () {
        const pos = new Float32Array([
          0, 0, 0,
          1, 0, -0.12,
          0.55, 0, 0.05,
        ]);
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
        if (g.computeVertexNormals) g.computeVertexNormals();
        return g;
      })();

      const birdMat = whiteMat(false);
      const wingMat = whiteMat(false);
      const totalCap = FLOCK_COUNT * BIRDS_PER_FLOCK_MAX;
      const bodyIM = new THREE.InstancedMesh(bodyGeo, birdMat, totalCap);
      // two wing instances per bird (left + right), each independently hinged
      const wingIM = new THREE.InstancedMesh(wingGeo, wingMat, totalCap * 2);
      bodyIM.castShadow = false; bodyIM.receiveShadow = false;   // tiny distant silhouettes — no shadow cost
      wingIM.castShadow = false; wingIM.receiveShadow = false;
      bodyIM.frustumCulled = false; wingIM.frustumCulled = false;   // r128 instanced cull bug
      bodyIM.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      wingIM.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      const bCol = new Float32Array(totalCap * 3);
      const wCol = new Float32Array(totalCap * 2 * 3);

      const flocks = [];
      for (let f = 0; f < FLOCK_COUNT; f++) {
        const n = BIRDS_PER_FLOCK_MIN + Math.floor(rng() * (BIRDS_PER_FLOCK_MAX - BIRDS_PER_FLOCK_MIN + 1));
        // flock home: a random point over the wilderness ring, well above
        // the canopy so birds read against open sky, not through tree crowns.
        const a = rng() * Math.PI * 2, rr = rng() * fieldR * 0.9;
        const homeX = fieldCX + Math.cos(a) * rr, homeZ = fieldCZ + Math.sin(a) * rr;
        const homeY = 34 + rng() * 26;
        const wanderR = 60 + rng() * 60;      // how far the flock's centre roams from home
        const col = new THREE.Color();
        col.setRGB(0.10 + rng() * 0.08, 0.09 + rng() * 0.07, 0.09 + rng() * 0.06);   // near-black silhouette, slight variance
        const birds = [];
        for (let i = 0; i < n; i++) {
          const bx = homeX + (rng() - 0.5) * 12, bz = homeZ + (rng() - 0.5) * 12, by = homeY + (rng() - 0.5) * 6;
          const heading = rng() * Math.PI * 2;
          birds.push({
            x: bx, y: by, z: bz,
            vx: Math.cos(heading) * 3, vz: Math.sin(heading) * 3, vy: 0,
            flapPhase: rng() * 6.28, flapSpeed: 7 + rng() * 2.5,
            wingIdxL: -1, wingIdxR: -1, bodyIdx: -1,
          });
        }
        flocks.push({
          birds, homeX, homeZ, homeY, wanderR,
          // slow independent drift so each flock's centre wanders (own rng stream via shared rng call order — fine, deterministic either way)
          driftAngle: rng() * Math.PI * 2, driftT: 4 + rng() * 6,
          col,
        });
      }

      // assign flat instance-index ranges once (birds never change flock)
      let cursor = 0;
      for (let f = 0; f < flocks.length; f++) {
        const fl = flocks[f];
        for (let i = 0; i < fl.birds.length; i++) {
          const b = fl.birds[i];
          b.bodyIdx = cursor;
          b.wingIdxL = cursor * 2;
          b.wingIdxR = cursor * 2 + 1;
          bCol[b.bodyIdx * 3] = fl.col.r; bCol[b.bodyIdx * 3 + 1] = fl.col.g; bCol[b.bodyIdx * 3 + 2] = fl.col.b;
          wCol[b.wingIdxL * 3] = fl.col.r; wCol[b.wingIdxL * 3 + 1] = fl.col.g; wCol[b.wingIdxL * 3 + 2] = fl.col.b;
          wCol[b.wingIdxR * 3] = fl.col.r; wCol[b.wingIdxR * 3 + 1] = fl.col.g; wCol[b.wingIdxR * 3 + 2] = fl.col.b;
          cursor++;
        }
      }
      // park unused instance slots (flock counts vary below the cap) off-map,
      // same trick crowd.js uses for its capacity buffer — a zero-scale matrix
      // at a parked Y keeps them from rendering as stray artifacts at the origin.
      const dummy2 = new THREE.Object3D();
      dummy2.scale.set(0.0001, 0.0001, 0.0001);
      dummy2.position.set(0, -500, 0);
      dummy2.updateMatrix();
      for (let i = cursor; i < totalCap; i++) bodyIM.setMatrixAt(i, dummy2.matrix);
      for (let i = cursor * 2; i < totalCap * 2; i++) wingIM.setMatrixAt(i, dummy2.matrix);

      bodyIM.instanceColor = new THREE.InstancedBufferAttribute(bCol, 3);
      wingIM.instanceColor = new THREE.InstancedBufferAttribute(wCol, 3);
      root.add(bodyIM); root.add(wingIM);

      // ---- BOIDS TUNING (small weights summed per rule, exactly the classic
      //      recipe) — tuned so the emergent motion reads as a loose wheeling
      //      flock, not a rigid formation or a scatter. --------------------
      const NEIGHBOR_R = 14, NEIGHBOR_R2 = NEIGHBOR_R * NEIGHBOR_R;
      const SEPARATE_R = 5, SEPARATE_R2 = SEPARATE_R * SEPARATE_R;
      const W_SEPARATE = 1.4, W_ALIGN = 0.5, W_COHERE = 0.35, W_HOME = 0.6;
      const MAX_SPEED = 6.5, MIN_SPEED = 2.5;

      const wm = new THREE.Object3D();
      let detailed = true;    // shares the tree distanceLOD's near/far read — birds simply stop ticking when far

      // amortized per-flock update: only ONE flock's boids + matrices get
      // recomputed per call, cycling round-robin — with 3 flocks that's still
      // every flock refreshed roughly every 3rd tick, an easy amortized cost
      // ceiling regardless of how many flocks a future tweak adds.
      let nextFlock = 0;

      function updateFlock(fl, dt) {
        const birds = fl.birds;
        const n = birds.length;

        // flock-centre wander: occasionally retarget a point within wanderR
        // of home (deterministic rng-driven heading change, deer-style).
        fl.driftT -= dt;
        if (fl.driftT <= 0) {
          fl.driftAngle += (rng() - 0.5) * 2.4;
          fl.driftT = 3 + rng() * 5;
        }
        const targetX = fl.homeX + Math.cos(fl.driftAngle) * fl.wanderR;
        const targetZ = fl.homeZ + Math.sin(fl.driftAngle) * fl.wanderR;

        // pairwise neighbour scan WITHIN this flock only (n<=15 -> <=105
        // unordered pairs; trivially cheap, no spatial grid needed at this scale).
        for (let i = 0; i < n; i++) {
          const bi = birds[i];
          let sepX = 0, sepY = 0, sepZ = 0;
          let aliX = 0, aliY = 0, aliZ = 0, aliN = 0;
          let cohX = 0, cohY = 0, cohZ = 0, cohN = 0;
          for (let j = 0; j < n; j++) {
            if (j === i) continue;
            const bj = birds[j];
            const dx = bj.x - bi.x, dy = bj.y - bi.y, dz = bj.z - bi.z;
            const d2 = dx * dx + dy * dy + dz * dz;
            if (d2 > NEIGHBOR_R2) continue;
            // ALIGNMENT — steer toward the average heading of nearby flockmates
            aliX += bj.vx; aliY += bj.vy; aliZ += bj.vz; aliN++;
            // COHESION — steer toward the average position of nearby flockmates
            cohX += bj.x; cohY += bj.y; cohZ += bj.z; cohN++;
            // SEPARATION — steer away from flockmates that are too close
            if (d2 < SEPARATE_R2 && d2 > 0.0001) {
              const inv = 1 / d2;             // closer birds push harder
              sepX -= dx * inv; sepY -= dy * inv; sepZ -= dz * inv;
            }
          }
          let ax = 0, ay = 0, az = 0;
          ax += sepX * W_SEPARATE; ay += sepY * W_SEPARATE; az += sepZ * W_SEPARATE;
          if (aliN > 0) {
            ax += (aliX / aliN - bi.vx) * W_ALIGN;
            ay += (aliY / aliN - bi.vy) * W_ALIGN;
            az += (aliZ / aliN - bi.vz) * W_ALIGN;
          }
          if (cohN > 0) {
            ax += (cohX / cohN - bi.x) * W_COHERE;
            ay += (cohY / cohN - bi.y) * W_COHERE;
            az += (cohZ / cohN - bi.z) * W_COHERE;
          }
          // HOME PULL — mild bias back toward the flock's current wander
          // target (and its cruise altitude) so the flock doesn't drift off
          // into the horizon forever; kept small next to the boids terms so
          // it never overrides the emergent flocking motion.
          ax += (targetX - bi.x) * W_HOME * 0.01;
          az += (targetZ - bi.z) * W_HOME * 0.01;
          ay += (fl.homeY - bi.y) * W_HOME * 0.02;

          bi.vx += ax * dt; bi.vy += ay * dt; bi.vz += az * dt;
          const sp = Math.hypot(bi.vx, bi.vy, bi.vz) || 0.0001;
          const clamped = sp > MAX_SPEED ? MAX_SPEED : (sp < MIN_SPEED ? MIN_SPEED : sp);
          const scale = clamped / sp;
          bi.vx *= scale; bi.vy *= scale; bi.vz *= scale;
        }
        for (let i = 0; i < n; i++) {
          const bi = birds[i];
          bi.x += bi.vx * dt; bi.y += bi.vy * dt; bi.z += bi.vz * dt;
          bi.flapPhase += bi.flapSpeed * dt;
        }

        // ---- write matrices for this flock's birds only ----
        for (let i = 0; i < n; i++) {
          const bi = birds[i];
          const heading = Math.atan2(bi.vx, bi.vz);         // yaw so the body nose follows velocity
          const pitch = -Math.atan2(bi.vy, Math.hypot(bi.vx, bi.vz) || 0.0001) * 0.6;

          wm.position.set(bi.x, bi.y, bi.z);
          wm.rotation.set(pitch, heading, 0);
          wm.scale.set(1, 1, 1.6);                           // fixed elongate — body cone stretched along its forward axis
          wm.updateMatrix();
          bodyIM.setMatrixAt(bi.bodyIdx, wm.matrix);

          // WING FLAP — simple sine-wave-driven hinge angle, mirrored L/R.
          const flap = Math.sin(bi.flapPhase) * 0.9;
          wm.rotation.set(pitch, heading, flap);
          wm.scale.set(1.4, 1, 1.4);
          wm.updateMatrix();
          wingIM.setMatrixAt(bi.wingIdxL, wm.matrix);
          wm.rotation.set(pitch, heading, Math.PI - flap);   // mirror across the body for the right wing
          wm.updateMatrix();
          wingIM.setMatrixAt(bi.wingIdxR, wm.matrix);
        }
      }

      CBZ.onUpdate(99.25, function (dt) {
        if (!dt || dt > 0.5) dt = 0.05;        // clamp pauses / first frame (deer-style)

        // reuse the tree distanceLOD's near/far thresholds so birds freeze
        // (matrices simply stop being touched — cheapest possible "off")
        // at the same range shadows already stop resolving at.
        const P = CBZ.player;
        if (P && P.pos) {
          const d = Math.hypot(P.pos.x - fieldCX, P.pos.z - fieldCZ);
          const LOD_FAR = fieldR + RING * 0.65, LOD_NEAR = fieldR + RING * 0.45;
          if (detailed && d > LOD_FAR) detailed = false;
          else if (!detailed && d < LOD_NEAR) detailed = true;
        }
        if (!detailed) return;

        // amortize: advance exactly one flock's full boids+matrix update per
        // tick, round-robin, so total per-frame cost never scales with
        // FLOCK_COUNT — it's always "one flock's worth" regardless of how
        // many flocks exist.
        const fl = flocks[nextFlock];
        nextFlock = (nextFlock + 1) % flocks.length;
        updateFlock(fl, dt * flocks.length);   // scale dt so each flock still integrates at ~real-time cadence despite round-robin throttling

        bodyIM.instanceMatrix.needsUpdate = true;
        wingIM.instanceMatrix.needsUpdate = true;
      });
    })();

    return {
      conifers: conifers.length, broadleaves: broadleaves.length,
      birches: birches.length, snags: snags.length,
      rocks: rockList.length, grass: grasses.length,
      usedTerrain: haveTerrain,
    };
  };

  // ---- AUTO-WIRE: register as a landmass so world.js's cityWorldGeo runs us
  //      automatically, AFTER terrain + islands/biomes exist (high order). The
  //      builder no-ops on a second call (and if terrain is missing it plants
  //      the flat decorative belt instead). -----------------------------------
  if (CBZ.addLandmass) {
    CBZ.addLandmass(function (city) { CBZ.buildWildNature(city); }, 99);
  }
})();
