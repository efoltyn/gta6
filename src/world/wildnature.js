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
   ~4-6 draw calls total, not thousands of meshes:
     • conifer   = 1 trunk IM + 1 stacked-cone crown IM
     • broadleaf = 1 trunk IM + 1 squashed-icosahedron crown IM
     • birch     = 1 thin-trunk IM + 1 small round crown IM  (shares broadleaf crown geo)
     • rocks     = 1 icosahedron IM
     • grass     = 1 cross-billboard IM   (capped count)
   Per-instance scale + colour variation via instanceColor on a white-based
   MeshLambertMaterial (one material per mesh — colour never costs a draw
   call). frustumCulled=false on every InstancedMesh (r128's per-object
   bounding-sphere cull throws away instanced meshes whose origin is off
   screen — without this, whole tree fields vanish at the map edge).

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
    const rng = makeRng(0x5C3E77);                    // "scatter"
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
    const conifers = [], broadleaves = [], birches = [], rockList = [], grasses = [];
    const STEP = 26;                                  // grid pitch (jittered)
    const J = STEP * 0.62;                            // jitter amplitude
    const CAP_TREES = 5200;                          // hard caps protect the frame budget
    const CAP_ROCKS = 1400;
    const CAP_GRASS = 3200;

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
        if (conifers.length + broadleaves.length + birches.length >= CAP_TREES) continue;

        const pick = rng();
        const rot = rng() * 6.28;
        const lean = (rng() - 0.5) * 0.06;
        if (pick < 0.6) {
          // CONIFER — taller, narrower; dominant on the high ground
          const h = 7 + rng() * 13;
          conifers.push({ x, z, y, h, tr: 0.55 + rng() * 0.5, rot, lean,
            cR: 0.7 + rng() * 0.5, cH: h * (0.9 + rng() * 0.25) });
        } else if (pick < 0.86) {
          // BROADLEAF — squat, round canopy
          const h = 5 + rng() * 8;
          broadleaves.push({ x, z, y, h, tr: 0.7 + rng() * 0.6, rot, lean,
            cR: h * (0.42 + rng() * 0.16), cH: h * (0.5 + rng() * 0.2),
            cY: h * (0.7 + rng() * 0.1) });
        } else {
          // BIRCH — thin, pale, airy
          const h = 6 + rng() * 7;
          birches.push({ x, z, y, h, tr: 0.6 + rng() * 0.5, rot, lean,
            cR: h * (0.26 + rng() * 0.12), cH: h * (0.34 + rng() * 0.16),
            cY: h * (0.74 + rng() * 0.08) });
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

    return {
      conifers: conifers.length, broadleaves: broadleaves.length,
      birches: birches.length, rocks: rockList.length, grass: grasses.length,
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
