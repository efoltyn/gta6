/* ============================================================
   city/worldmap.js — THE ARCHIPELAGO REGISTRY.

   The mainland (world.js) + the one east commerce island
   (expansion.js) used to be the whole world. This file turns the
   game into an ARCHIPELAGO: it owns a single registry of extra
   walkable landmasses — three purpose-built islands (speedway,
   airport, military) and four open biomes (desert, forest,
   farmland, snowy mountains) — plus the bridges that connect them.

   WHY a registry instead of editing world.js per island: world.js's
   clampToCity, swim.js's waterAt/climbSpot and fullmap's bounds all
   now consult `city.regions`. Each island/biome module just builds
   its geometry and calls CBZ.registerCityRegion(...) — no shared
   file is touched twice, so the whole world fans out cleanly across
   independent modules.

   CONTRACT for an island/biome module:
     CBZ.addLandmass(function (city) {
        ... build meshes onto city.root ...
        CBZ.registerCityRegion(city, { name, biome,
           kind:'circle', cx, cz, r           // or
           kind:'rect',   minX, maxX, minZ, maxZ
        });
        // bridges/causeways are just rect regions too:
        CBZ.registerCityRegion(city, { name:'...-bridge', kind:'rect', ... });
     }, order);          // lower order builds first (default 50)

   world.js calls CBZ.cityWorldGeo(city) once, right after the
   original expansion island, which runs every registered builder.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;

  CBZ._landmassBuilders = CBZ._landmassBuilders || [];

  // island/biome modules register a builder here at load time.
  CBZ.addLandmass = function (fn, order) {
    if (typeof fn !== "function") return;
    CBZ._landmassBuilders.push({ fn, order: order == null ? 50 : order });
  };

  // -----------------------------------------------------------------------
  // VISUAL LAND EDGE — a real ring, not another full rectangular plane.
  // -----------------------------------------------------------------------
  // Each biome used to lay a larger, vertex-coloured *rectangle* under its
  // main floor as an "edge blend". From an aircraft that reads as exactly
  // what it is: a stack of overlapping map sections. This helper emits only
  // the feather outside the playable pad. The inner edge is covered by the
  // biome floor, the outer edge breaks into varied wild ground, and no part
  // of the core is double-rendered or z-fights.
  CBZ.makeBiomeEdgeRing = function (root, opts) {
    if (!root || !opts) return null;
    const cx = +opts.cx || 0, cz = +opts.cz || 0;
    const hx = Math.max(1, +opts.hx || 1), hz = Math.max(1, +opts.hz || 1);
    const feather = Math.max(8, +opts.feather || 72);
    const seg = Math.max(8, (opts.segments == null ? 18 : opts.segments) | 0);
    const y = opts.y == null ? 0 : +opts.y;
    const seed = +opts.seed || 1;
    const inner = new THREE.Color(opts.inner == null ? 0x6d7850 : opts.inner);
    const outer = new THREE.Color(opts.outer == null ? 0x7c7654 : opts.outer);
    const pos = [], col = [];

    function noise(side, t) {
      // Smooth, deterministic low-frequency variation. It breaks the ruler
      // edge without turning the coast into random spikes or consuming RNG.
      const a = Math.sin((t * 2.0 + side * 0.71 + seed * 0.0019) * Math.PI * 2);
      const b = Math.sin((t * 5.0 - side * 0.29 + seed * 0.0047) * Math.PI * 2);
      return a * 0.58 + b * 0.24;
    }
    function vert(x, z, c) {
      pos.push(x, y, z);
      col.push(c.r, c.g, c.b);
    }
    function tint(t, side) {
      const c = new THREE.Color();
      const wobble = (noise(side, t) + 1) * 0.07;
      c.copy(inner).lerp(outer, 0.12 + wobble);
      return c;
    }
    function outerTint(t, side) {
      const c = new THREE.Color();
      const wobble = (noise(side, t) + 1) * 0.06;
      c.copy(inner).lerp(outer, 0.86 + wobble);
      return c;
    }
    function band(x0, z0, x1, z1, ox, oz, side) {
      const innerPts = [], outerPts = [];
      for (let i = 0; i <= seg; i++) {
        const t = i / seg;
        const x = x0 + (x1 - x0) * t;
        const z = z0 + (z1 - z0) * t;
        const n = noise(side, t);
        innerPts.push({ x: x + ox * n * 4, z: z + oz * n * 4, c: tint(t, side) });
        outerPts.push({ x: x + ox * (feather + n * feather * 0.28), z: z + oz * (feather + n * feather * 0.28), c: outerTint(t, side) });
      }
      for (let i = 0; i < seg; i++) {
        const a = innerPts[i], b = innerPts[i + 1], c = outerPts[i + 1], d = outerPts[i];
        vert(a.x, a.z, a.c); vert(b.x, b.z, b.c); vert(c.x, c.z, c.c);
        vert(a.x, a.z, a.c); vert(c.x, c.z, c.c); vert(d.x, d.z, d.c);
      }
      return { first: { inner: innerPts[0], outer: outerPts[0] }, last: { inner: innerPts[seg], outer: outerPts[seg] } };
    }
    const north = band(cx - hx, cz - hz, cx + hx, cz - hz, 0, -1, 0);
    const east = band(cx + hx, cz - hz, cx + hx, cz + hz, 1, 0, 1);
    const south = band(cx + hx, cz + hz, cx - hx, cz + hz, 0, 1, 2);
    const west = band(cx - hx, cz + hz, cx - hx, cz - hz, -1, 0, 3);
    function corner(a, b) {
      // Close the small diagonal corner wedge between the two orthogonal bands.
      vert(a.inner.x, a.inner.z, a.inner.c);
      vert(a.outer.x, a.outer.z, a.outer.c);
      vert(b.outer.x, b.outer.z, b.outer.c);
    }
    corner(north.first, west.last);
    corner(north.last, east.first);
    corner(east.last, south.first);
    corner(south.last, west.first);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    const material = new THREE.MeshLambertMaterial({
      color: 0xffffff, vertexColors: true, side: THREE.DoubleSide, flatShading: true,
    });
    const mesh = new THREE.Mesh(geo, material);
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.matrixAutoUpdate = false;
    mesh.userData.worldSurface = true;
    mesh.updateMatrix();
    root.add(mesh);
    return mesh;
  };

  // normalize + register a walkable region onto the live city descriptor.
  //   kind 'circle': {cx,cz,r}      kind 'rect': {minX,maxX,minZ,maxZ}
  // pad = how far past the visual edge still reads as land (beach/quay).
  CBZ.registerCityRegion = function (city, reg) {
    if (!city) city = CBZ.city && CBZ.city.arena;
    if (!city || !reg) return reg;
    city.regions = city.regions || [];
    if (reg.pad == null) reg.pad = 2;
    if (reg.kind === "circle") {
      reg.minX = reg.cx - reg.r; reg.maxX = reg.cx + reg.r;
      reg.minZ = reg.cz - reg.r; reg.maxZ = reg.cz + reg.r;
    }
    city.regions.push(reg);
    if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
    return reg;
  };

  // point-in-region (r shrinks for an actor's radius so it can't clip the edge)
  CBZ.cityRegionHit = function (reg, x, z, r) {
    r = r || 0;
    if (reg.kind === "circle") return Math.hypot(x - reg.cx, z - reg.cz) <= reg.r + reg.pad - r;
    return x >= reg.minX - reg.pad + r && x <= reg.maxX + reg.pad - r &&
           z >= reg.minZ - reg.pad + r && z <= reg.maxZ + reg.pad - r;
  };

  // nearest point that is ON the region (used by clampToCity + swim climb-out)
  CBZ.cityRegionClamp = function (reg, x, z, r) {
    r = r || 0;
    if (reg.kind === "circle") {
      const dx = x - reg.cx, dz = z - reg.cz, d = Math.hypot(dx, dz) || 1;
      const rad = Math.max(0, reg.r + reg.pad - r);
      if (d <= rad) return { x, z };
      return { x: reg.cx + dx / d * rad, z: reg.cz + dz / d * rad };
    }
    return {
      x: Math.max(reg.minX - reg.pad + r, Math.min(reg.maxX + reg.pad - r, x)),
      z: Math.max(reg.minZ - reg.pad + r, Math.min(reg.maxZ + reg.pad - r, z)),
    };
  };

  // is (x,z) on ANY registered landmass? (mainland/annex handled by callers)
  CBZ.cityAnyRegion = function (city, x, z, r) {
    const regs = city && city.regions; if (!regs) return null;
    for (let i = 0; i < regs.length; i++) if (CBZ.cityRegionHit(regs[i], x, z, r)) return regs[i];
    return null;
  };

  // nearest registered region whose edge is within `rad` of (x,z), else null.
  // SHARED (regionlife.js + crowd.js call this) — pure math, no rng, headless-safe.
  // Returns the region with the smallest squared distance from (x,z) to its edge
  // (0 when the point is inside it). Mirrors cityRegionHit's circle/rect split.
  CBZ.cityNearestRegion = function (city, x, z, rad) {
    const regs = city && city.regions; if (!regs || !regs.length) return null;
    let best = null, bestD = rad * rad;
    for (let i = 0; i < regs.length; i++) {
      const reg = regs[i];
      let d2;
      if (reg.kind === "circle") {
        const cd = Math.hypot(x - reg.cx, z - reg.cz) - reg.r;
        d2 = cd <= 0 ? 0 : cd * cd;
      } else {
        const ex = Math.max(reg.minX - x, 0, x - reg.maxX);
        const ez = Math.max(reg.minZ - z, 0, z - reg.maxZ);
        d2 = ex * ex + ez * ez;
      }
      if (d2 < bestD) { bestD = d2; best = reg; }
    }
    return best;
  };

  // which biome is a point in? (peds/weather/ambient can flavour by terrain)
  CBZ.cityBiomeAt = function (x, z) {
    const A = CBZ.city && CBZ.city.arena; if (!A) return "city";
    const reg = CBZ.cityAnyRegion(A, x, z, 0);
    return reg && reg.biome ? reg.biome : "city";
  };

  // a deterministic scatter helper every biome module can share — returns
  // n {x,z} points inside a region, avoiding a keep-out list (roads/pads).
  CBZ.cityScatterInRegion = function (reg, n, rng, margin) {
    margin = margin || 6;
    const out = [];
    for (let i = 0; i < n; i++) {
      let x, z;
      if (reg.kind === "circle") {
        const a = rng() * Math.PI * 2, rr = Math.sqrt(rng()) * (reg.r - margin);
        x = reg.cx + Math.cos(a) * rr; z = reg.cz + Math.sin(a) * rr;
      } else {
        x = reg.minX + margin + rng() * (reg.maxX - reg.minX - margin * 2);
        z = reg.minZ + margin + rng() * (reg.maxZ - reg.minZ - margin * 2);
      }
      out.push({ x, z });
    }
    return out;
  };

  // ============================================================
  //  BIOME WORK-ANCHORS — where a biome NPC actually WORKS.
  //
  //  WHY: the city has a full utility/schedule job brain (aigoals.js) but a
  //  farmer/rancher/ranger/soldier on a biome has a job LABEL that resolves to
  //  NOTHING — there is no shopLot out in the open valley. A work-anchor is the
  //  biome's answer: a small data record published from the geometry a biome
  //  already built (a field parcel, the barn, the gate, the trailhead, the
  //  slope, the apron) that the SAME schedule/goal/nav routes a worker to. The
  //  farmer grows food in his field, the soldier guards the gate, the ranger
  //  walks the trail — a real WHY, on the same brain the mainland uses.
  //
  //  Pure DATA (no geometry, no THREE) — registered by the biome builders,
  //  reset with the world so a fresh run starts clean. officejobs.js owns the
  //  claim/release (the desk-claim pattern); aigoals.js owns the routing +
  //  the 'fieldwork'/patrol resolver.
  //
  //  Record shape:
  //    { biome, kind, x, z, role,
  //      spots:[{x,z}...],   // 2-3 task points the worker cycles
  //      home:{x,z}|null,    // where the worker sleeps (optional)
  //      cap,                // max simultaneous workers
  //      occupants:[] }      // live peds holding a slot (never serialized)
  // ============================================================
  CBZ.cityWorkAnchors = CBZ.cityWorkAnchors || [];

  CBZ.registerWorkAnchor = function (a) {
    if (!a || typeof a.x !== "number" || typeof a.z !== "number") return null;
    // normalize: a kind is required to route to it; default a single task spot
    // at the anchor itself so a fieldwork goal always has somewhere to stand.
    if (!a.kind) a.kind = "work";
    if (!a.spots || !a.spots.length) a.spots = [{ x: a.x, z: a.z }];
    a.cap = a.cap == null ? 3 : a.cap;
    a.occupants = [];                 // live, never serialized
    a.patrol = !!a.patrol;
    CBZ.cityWorkAnchors.push(a);
    return a;
  };

  // wipe for a fresh city (called from cityWorldGeo below before builders run,
  // so the new run's anchors are the only ones in the list).
  CBZ.cityWorkAnchorsReset = function () {
    if (!CBZ.cityWorkAnchors) { CBZ.cityWorkAnchors = []; return; }
    CBZ.cityWorkAnchors.length = 0;
  };

  // -----------------------------------------------------------------------
  // ARCHIPELAGO DRESSING
  // -----------------------------------------------------------------------
  // The playable regions intentionally stay discrete for physics/navigation,
  // but the visible ocean between them must not be a blank blue test board
  // when viewed from a helicopter or plane. These are non-walkable shoals and
  // tiny islets: deterministic visual geography that is placed only in free
  // water, away from every registered landmass, mainland, annex, and road.
  // They make the world read as an archipelago without silently expanding the
  // simulation/nav area or dropping colliders under aircraft routes.
  CBZ.buildArchipelagoDressing = function (city) {
    if (!city || !city.root || city._archipelagoDressing) return city && city._archipelagoDressing;
    const root = city.root;
    const group = new THREE.Group();
    group.name = "archipelago-dressing";
    group.userData.worldDecor = true;
    root.add(group);
    city._archipelagoDressing = group;

    let state = (CBZ.WORLD_SEED == null ? 0x51a7 : CBZ.WORLD_SEED ^ 0x51a7) >>> 0;
    function rnd() {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 4294967296;
    }
    function blocked(x, z, r) {
      const m = 34 + r;
      if (x >= city.minX - m && x <= city.maxX + m && z >= city.minZ - m && z <= city.maxZ + m) return true;
      const a = city.annex;
      if (a && Math.hypot(x - a.cx, z - a.cz) < a.radius + m) return true;
      const regs = city.regions || [];
      for (let i = 0; i < regs.length; i++) if (CBZ.cityRegionHit(regs[i], x, z, r + 18)) return true;
      const roads = city.roads || [];
      for (let i = 0; i < roads.length; i++) {
        const q = roads[i], hw = 18 + r;
        if (q.vertical) {
          if (Math.abs(x - q.x) < hw && Math.abs(z - q.z) < q.len / 2 + hw) return true;
        } else if (Math.abs(z - q.z) < hw && Math.abs(x - q.x) < q.len / 2 + hw) return true;
      }
      return false;
    }

    const spots = [];
    const minX = -980, maxX = 1620, minZ = -1820, maxZ = 720;
    // A sparse first pass still left kilometre-wide blue voids at aircraft
    // height. More small, well-separated shoals give the sea a readable
    // geography while retaining generous open-water lanes around every route.
    for (let attempt = 0; attempt < 520 && spots.length < 46; attempt++) {
      const r = 9 + rnd() * 25;
      const x = minX + rnd() * (maxX - minX);
      const z = minZ + rnd() * (maxZ - minZ);
      if (blocked(x, z, r)) continue;
      let tooNear = false;
      for (let i = 0; i < spots.length; i++) {
        const p = spots[i], dx = x - p.x, dz = z - p.z;
        if (dx * dx + dz * dz < (r + p.r + 44) * (r + p.r + 44)) { tooNear = true; break; }
      }
      if (!tooNear) spots.push({ x, z, r, green: rnd() < 0.28 });
    }

    const cap = Math.max(1, spots.length); // InstancedMesh requires a positive capacity even on an unusually crowded seed.
    const shoalGeo = new THREE.CircleGeometry(1, 10);
    shoalGeo.rotateX(-Math.PI / 2);
    const shoal = new THREE.InstancedMesh(shoalGeo, new THREE.MeshLambertMaterial({ color: 0xb9a96e }), cap);
    const grass = new THREE.InstancedMesh(shoalGeo, new THREE.MeshLambertMaterial({ color: 0x567746 }), cap);
    const rockGeo = new THREE.DodecahedronGeometry(1, 0);
    const rocks = new THREE.InstancedMesh(rockGeo, new THREE.MeshLambertMaterial({ color: 0x68706e, flatShading: true }), cap * 2);
    const dummy = new THREE.Object3D();
    let ri = 0;
    for (let i = 0; i < spots.length; i++) {
      const p = spots[i];
      dummy.position.set(p.x, -0.052, p.z);
      dummy.rotation.set(0, rnd() * Math.PI, 0);
      dummy.scale.set(p.r * 1.35, 1, p.r * (0.72 + rnd() * 0.32));
      dummy.updateMatrix(); shoal.setMatrixAt(i, dummy.matrix);
      dummy.position.set(p.x, -0.042, p.z);
      const gr = p.green ? 1 : 0;
      dummy.scale.set(p.r * 0.72 * gr, 1, p.r * 0.52 * gr);
      dummy.updateMatrix(); grass.setMatrixAt(i, dummy.matrix);
      for (let j = 0; j < 2; j++) {
        const a = rnd() * Math.PI * 2, d = p.r * (0.22 + rnd() * 0.55), s = 0.6 + rnd() * 1.5;
        dummy.position.set(p.x + Math.cos(a) * d, -0.02 + s * 0.28, p.z + Math.sin(a) * d);
        dummy.rotation.set(rnd() * 0.4, rnd() * Math.PI, rnd() * 0.4);
        dummy.scale.set(s, s * (0.55 + rnd() * 0.45), s);
        dummy.updateMatrix(); rocks.setMatrixAt(ri++, dummy.matrix);
      }
    }
    shoal.count = grass.count = spots.length;
    shoal.instanceMatrix.needsUpdate = true;
    grass.instanceMatrix.needsUpdate = true;
    rocks.count = ri; rocks.instanceMatrix.needsUpdate = true;
    shoal.frustumCulled = grass.frustumCulled = rocks.frustumCulled = false;
    group.add(shoal, grass, rocks);
    return group;
  };

  // world.js calls this once, after the original expansion island. Runs every
  // registered landmass builder in order; each is independently try/caught so
  // one bad biome can never take down the rest of the world.
  CBZ.cityWorldGeo = function (city) {
    city.regions = city.regions || [];
    CBZ.cityWorkAnchorsReset();        // anchors are rebuilt by the biome builders
    // World geometry is assembled by several modules. Start every pass with
    // one shared, idempotent occupancy view seeded from the already-built
    // mainland/annex colliders, so later biomes cannot unknowingly decorate
    // an earlier road, lot, or landmark.
    if (CBZ.placement) {
      CBZ.placement.reset();
      if (CBZ.worldLayout && CBZ.worldLayout.reset) CBZ.worldLayout.reset();
      if (CBZ.placement.seedFromColliders) CBZ.placement.seedFromColliders();
    }
    const list = CBZ._landmassBuilders.slice().sort((a, b) => a.order - b.order);
    for (const b of list) { try { b.fn(city); } catch (e) { console.error("[landmass]", e); } }
    if (CBZ.buildArchipelagoDressing) CBZ.buildArchipelagoDressing(city);
    if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
  };
})();
