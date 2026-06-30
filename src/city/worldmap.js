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

  CBZ._landmassBuilders = CBZ._landmassBuilders || [];

  // island/biome modules register a builder here at load time.
  CBZ.addLandmass = function (fn, order) {
    if (typeof fn !== "function") return;
    CBZ._landmassBuilders.push({ fn, order: order == null ? 50 : order });
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

  // world.js calls this once, after the original expansion island. Runs every
  // registered landmass builder in order; each is independently try/caught so
  // one bad biome can never take down the rest of the world.
  CBZ.cityWorldGeo = function (city) {
    city.regions = city.regions || [];
    CBZ.cityWorkAnchorsReset();        // anchors are rebuilt by the biome builders
    const list = CBZ._landmassBuilders.slice().sort((a, b) => a.order - b.order);
    for (const b of list) { try { b.fn(city); } catch (e) { console.error("[landmass]", e); } }
    if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
  };
})();
