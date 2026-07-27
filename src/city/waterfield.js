/* ============================================================
   city/waterfield.js — ONE WATER TRUTH FOR RENDERING + GAMEPLAY.

   The rendered continent already owns a signed shoreline function, but the
   player swimmer, boats and aquatic wildlife each used unrelated rectangle /
   radius guesses.  Fish consequently crossed whole islands.  This module
   turns the rendered shoreline into a small navigation field:

     shoreAt(x,z)       +land / -water signed coast distance
     depthAt(x,z)       gameplay bathymetry derived from that distance
     surfaceY(x,z,t)    live surface height — see the note below
     surfaceSlope(...)  dY/dx, dY/dz of that same surface (buoyancy/pitch)
     currentAt(x,z,t)   slow deterministic ocean current
     moveInWater(...)   shore feelers + inward/tangent steering
     nearestWater(...)  closest-valid-point recovery for spawns/births

   surfaceY() USED TO BE a hand-typed CPU copy of world.js's GLSL swell math,
   with a comment asking future editors to keep the coefficients "byte-for-byte
   in sync".  It no longer is: world/water_spec.js owns ONE swell table, GENERATES
   the GLSL from it, and exposes CBZ.waterWaveHeight() as the CPU evaluation of
   the very same table.  The render and the query cannot drift apart any more.

   `isSurfaceWater` excludes bridge decks (cars/people stand on them).
   `isNavigableWater` deliberately does not, so sea life can pass underneath.
   No external runtime is needed and every query is allocation-free except the
   high-level helpers used for spawn/recovery.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;

  const QUAY = 28;
  const MEAN_Y = -0.48;
  let boundArena = null;

  function arena() {
    return boundArena || (CBZ.city && CBZ.city.arena) || null;
  }

  function bindArena(A) {
    if (A) boundArena = A;
    return api;
  }

  function regionHit(r, x, z, margin) {
    margin = margin || 0;
    if (!r) return false;
    const p = (r.pad || 0) + margin;
    if (r.kind === "circle") return Math.hypot(x - r.cx, z - r.cz) <= r.r + p;
    return x >= r.minX - p && x <= r.maxX + p && z >= r.minZ - p && z <= r.maxZ + p;
  }

  function isLink(r) {
    return !!(r && r.name && /bridge|causeway|link/i.test(r.name));
  }

  function overDeck(A, x, z, margin) {
    if (!A) return false;
    const B = A.bridge;
    if (B && x >= B.minX - margin && x <= B.maxX + margin && z >= B.minZ - margin && z <= B.maxZ + margin) return true;
    const regs = A.regions || [];
    for (let i = 0; i < regs.length; i++) if (isLink(regs[i]) && regionHit(regs[i], x, z, margin)) return true;
    return false;
  }

  // Legacy fallback used only before continent.js publishes the real signed
  // shoreline.  It preserves the old gameplay contract during boot.
  function fallbackWater(A, x, z, allowUnderDecks) {
    if (!A || A.minX == null) return false;
    if (x >= A.minX - QUAY && x <= A.maxX + QUAY && z >= A.minZ - QUAY && z <= A.maxZ + QUAY) return false;
    if (!allowUnderDecks && overDeck(A, x, z, 0)) return false;
    const I = A.annex;
    if (I && Math.hypot(x - I.cx, z - I.cz) <= I.radius + 1.5) return false;
    const regs = A.regions || [];
    for (let i = 0; i < regs.length; i++) {
      if (allowUnderDecks && isLink(regs[i])) continue;
      if (regionHit(regs[i], x, z, 0)) return false;
    }
    return true;
  }

  function shoreAt(x, z) {
    const A = arena();
    const terrain = A && A.mapTerrain;
    if (terrain && typeof terrain.shoreAt === "function") {
      try {
        const s = +terrain.shoreAt(x, z);
        if (Number.isFinite(s)) return s;
      } catch (e) {}
    }
    return fallbackWater(A, x, z, true) ? -24 : 24;
  }

  function isNavigableWater(x, z, clearance) {
    clearance = Math.max(0, +clearance || 0);
    return shoreAt(x, z) < -clearance;
  }

  // How far inland a surge pushes the WATERLINE. shoreAt() is a signed
  // horizontal distance to the coast in metres, so converting a vertical
  // surge into it needs a shore gradient — INUNDATE_PER_M is that gradient,
  // and 22:1 is an ordinary run-up ratio for a shallow coast. This is the
  // gameplay twin of water_spec.js's uShoreCut: one moves the rendered edge,
  // this moves the edge that swimming, buoyancy, drowning, boats, sharks and
  // the gore medium all actually ask about. They must move together or the
  // sea will look like it is over the road while the road is still dry.
  const INUNDATE_PER_M = 22;
  function floodReach() {
    const s = CBZ.waterSurge ? CBZ.waterSurge() : 0;
    return s > 0 ? s * INUNDATE_PER_M : 0;
  }
  function isSurfaceWater(x, z, clearance) {
    const A = arena();
    clearance = Math.max(0, +clearance || 0);
    if (overDeck(A, x, z, 0.6)) return false;
    const terrain = A && A.mapTerrain;
    if (terrain && typeof terrain.shoreAt === "function") return shoreAt(x, z) < -clearance + floodReach();
    return fallbackWater(A, x, z, false);
  }
  // Metres of standing water at a point that is only wet BECAUSE of a surge —
  // 0 on ordinary sea, and 0 everywhere when nothing is surging. The one read
  // for "am I in the flood", as opposed to "am I in the sea".
  CBZ.cityFloodDepthAt = function (x, z) {
    const reach = floodReach();
    if (reach <= 0) return 0;
    const A = arena();
    const terrain = A && A.mapTerrain;
    if (!terrain || typeof terrain.shoreAt !== "function") return 0;
    const s = shoreAt(x, z);
    if (s >= reach) return 0;                     // still dry land
    if (s <= 0) return 0;                         // ordinary sea, not flood
    return (reach - s) / INUNDATE_PER_M;          // back to metres of depth
  };

  // Semantic depth in metres.  The deep sea does not need a dense rendered
  // seabed, but wildlife and camera effects do need stable depth lanes.
  function depthAt(x, z) {
    const s = shoreAt(x, z);
    if (s >= 0) return 0;
    return Math.min(62, 1.1 + (-s) * 0.075);
  }

  function clockSeconds() {
    if (CBZ.waterClock) return CBZ.waterClock();
    return ((typeof performance !== "undefined" ? performance.now() : Date.now()) * 0.001) % 3600;
  }

  // THE surface height at (x,z).  Delegates to world/water_spec.js so the CPU
  // answer is literally the same summation the vertex program runs (including
  // its horizon-distance and inland-lake amplitude scaling — a boat therefore
  // sits on the crest you can SEE, not on a phantom one).  The inline fallback
  // below is only reachable if water_spec.js failed to load; it reproduces the
  // three historical swells so a stripped page still floats swimmers.
  function surfaceY(x, z, t) {
    if (CBZ.waterWaveHeight) return CBZ.waterWaveHeight(x, z, t);
    if (!Number.isFinite(t)) t = clockSeconds();
    const y0 = CBZ.SEA_Y != null ? CBZ.SEA_Y : MEAN_Y;
    const p1 = x * 0.052 + z * 0.030 + t * 1.1;
    const p2 = x * -0.020 + z * 0.041 + t * 0.7;
    const p3 = (x + z) * 0.011 - t * 0.4;
    return y0 + Math.sin(p1) * 0.145 + Math.sin(p2) * 0.125 + Math.sin(p3) * 0.085;
  }

  // Surface slope (dY/dx, dY/dz) — the analytic derivative of the same swell
  // sum, i.e. exactly what the vertex program tilts its normal by.  Boat pitch
  // and roll ride on this; it is allocation-free with a reused `out`.
  const _slope = { x: 0, z: 0 };
  function surfaceSlope(x, z, t, out) {
    out = out || {};
    if (CBZ.waterWaveSlope) return CBZ.waterWaveSlope(x, z, t, out);
    if (!Number.isFinite(t)) t = clockSeconds();
    const c1 = Math.cos(x * 0.052 + z * 0.030 + t * 1.1) * 0.145;
    const c2 = Math.cos(x * -0.020 + z * 0.041 + t * 0.7) * 0.125;
    const c3 = Math.cos((x + z) * 0.011 - t * 0.4) * 0.085;
    out.x = c1 * 0.052 + c2 * -0.020 + c3 * 0.011;
    out.z = c1 * 0.030 + c2 * 0.041 + c3 * 0.011;
    return out;
  }

  // Upward unit normal of the live surface — handed straight to anything that
  // wants to sit flat on the water (hulls, floating debris, ripple decals).
  function surfaceNormal(x, z, t, out) {
    const s = surfaceSlope(x, z, t, _slope);
    const inv = 1 / Math.sqrt(s.x * s.x + 1 + s.z * s.z);
    out = out || {};
    out.x = -s.x * inv; out.y = inv; out.z = -s.z * inv;
    return out;
  }

  // 1 well inside a registered inland water body (a lake), 0 on open sea.
  // Lets gameplay ask "is this pond water?" with the same answer the shader
  // uses to paint it green and calm.
  function inlandFactorAt(x, z) {
    return CBZ.waterInlandFactorAt ? CBZ.waterInlandFactorAt(x, z) : 0;
  }

  function shoreGradient(x, z, step, out) {
    step = Math.max(2, +step || 8);
    const gx = shoreAt(x + step, z) - shoreAt(x - step, z);
    const gz = shoreAt(x, z + step) - shoreAt(x, z - step);
    const d = Math.hypot(gx, gz) || 1;
    out = out || {};
    out.x = gx / d; out.z = gz / d;       // points from water toward land
    return out;
  }

  function currentAt(x, z, t, out) {
    if (!Number.isFinite(t)) t = clockSeconds();
    out = out || {};
    // Two broad curl-like bands: readable drift without conveyor-belt motion.
    let vx = 0.18 + Math.sin(z * 0.0061 + t * 0.035) * 0.16 + Math.sin((x + z) * 0.0027 - t * 0.018) * 0.08;
    let vz = Math.cos(x * 0.0054 - t * 0.031) * 0.14 - Math.cos((x - z) * 0.0031 + t * 0.022) * 0.07;
    // Near shore, remove the component that would push actors onto land.
    const s = shoreAt(x, z);
    if (s > -80) {
      const n = shoreGradient(x, z, 7, _grad);
      const towardLand = vx * n.x + vz * n.z;
      if (towardLand > 0) { vx -= n.x * towardLand * 1.15; vz -= n.z * towardLand * 1.15; }
    }
    out.x = vx; out.z = vz;
    return out;
  }

  const _grad = { x: 0, z: 0 }, _cur = { x: 0, z: 0 };

  function nearestWater(x, z, clearance, maxRadius) {
    clearance = Math.max(0, +clearance || 0);
    maxRadius = Math.max(12, +maxRadius || 320);
    if (isNavigableWater(x, z, clearance)) return { x: x, z: z, moved: false };
    // Expanding rings approximate navmesh closest-point projection and are
    // only used for initial spawn/birth/error recovery, never every frame.
    const dirs = 24;
    for (let r = 8; r <= maxRadius; r += Math.max(8, r * 0.22)) {
      let best = null, bestShore = Infinity;
      for (let i = 0; i < dirs; i++) {
        const a = (i / dirs) * Math.PI * 2 + r * 0.0017;
        const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
        const s = shoreAt(px, pz);
        if (s < -clearance && s < bestShore) { bestShore = s; best = { x: px, z: pz, moved: true }; }
      }
      if (best) return best;
    }
    return null;
  }

  function randomWaterPoint(rng, opts) {
    rng = typeof rng === "function" ? rng : Math.random;
    opts = opts || {};
    const cx = +opts.cx || 0, cz = opts.cz == null ? -700 : +opts.cz;
    const r0 = Math.max(0, +opts.r0 || 560), r1 = Math.max(r0 + 1, +opts.r1 || 1500);
    const clearance = Math.max(0, opts.clearance == null ? 18 : +opts.clearance);
    for (let tries = 0; tries < 96; tries++) {
      const a = rng() * Math.PI * 2;
      const r = Math.sqrt(r0 * r0 + rng() * (r1 * r1 - r0 * r0));
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      if (isNavigableWater(x, z, clearance)) return { x: x, z: z };
    }
    const projected = nearestWater(cx + r0, cz, clearance, r1 - r0 + 900);
    if (projected) return projected;

    // The continent expansion can consume an old radial ocean band entirely.
    // Sample the footprint of the ONE sea mesh rather than returning an
    // unchecked legacy coordinate. This mainly matters for huge animals whose
    // required coast clearance cannot fit through the city harbour ring.
    const sb = CBZ.SEA_WORLD_BOUNDS;
    if (sb && [sb.minX, sb.maxX, sb.minZ, sb.maxZ].every(Number.isFinite)) {
      const edge = Math.max(18, clearance + 8);
      const x0 = sb.minX + edge, x1 = sb.maxX - edge;
      const z0 = sb.minZ + edge, z1 = sb.maxZ - edge;
      for (let tries = 0; tries < 192; tries++) {
        const x = x0 + rng() * Math.max(1, x1 - x0);
        const z = z0 + rng() * Math.max(1, z1 - z0);
        if (isNavigableWater(x, z, clearance)) return { x: x, z: z, seaFallback: true };
      }
      // Deterministic exhaustive fallback: choose the deepest valid sample in
      // a 25x25 grid. It consumes no extra RNG and can never resolve to land.
      let best = null, bestShore = Infinity;
      for (let iz = 0; iz <= 24; iz++) for (let ix = 0; ix <= 24; ix++) {
        const x = x0 + (x1 - x0) * ix / 24;
        const z = z0 + (z1 - z0) * iz / 24;
        const s = shoreAt(x, z);
        if (s < -clearance && s < bestShore) {
          bestShore = s; best = { x: x, z: z, seaFallback: true };
        }
      }
      if (best) return best;
    }
    // No validated water means no spawn. Callers explicitly skip it; returning
    // an arbitrary point here was the megalodon-on-land bug.
    return null;
  }

  function angleDelta(a, b) {
    let d = (b - a + Math.PI) % (Math.PI * 2);
    if (d < 0) d += Math.PI * 2;
    return d - Math.PI;
  }

  function moveInWater(x, z, heading, distance, clearance, t, out) {
    distance = Math.max(0, +distance || 0);
    clearance = Math.max(2, +clearance || 8);
    const probe = Math.max(10, Math.min(44, distance * 6 + clearance * 1.4));
    const hx = Math.cos(heading), hz = Math.sin(heading);
    const frontS = shoreAt(x + hx * probe, z + hz * probe);
    const leftA = heading - 0.72, rightA = heading + 0.72;
    const leftS = shoreAt(x + Math.cos(leftA) * probe * 0.82, z + Math.sin(leftA) * probe * 0.82);
    const rightS = shoreAt(x + Math.cos(rightA) * probe * 0.82, z + Math.sin(rightA) * probe * 0.82);
    let desired = heading;

    if (frontS >= -clearance) {
      const n = shoreGradient(x + hx * probe * 0.5, z + hz * probe * 0.5, 7, _grad);
      // Blend inward with the tangent closest to the current direction. This
      // makes animals follow a bay instead of repeatedly headbutting its edge.
      const tx1 = -n.z, tz1 = n.x, tx2 = n.z, tz2 = -n.x;
      const useFirst = tx1 * hx + tz1 * hz >= tx2 * hx + tz2 * hz;
      const tx = useFirst ? tx1 : tx2, tz = useFirst ? tz1 : tz2;
      desired = Math.atan2(-n.z * 0.82 + tz * 0.58, -n.x * 0.82 + tx * 0.58);
    } else if (leftS >= -clearance && rightS < leftS) {
      desired = rightA;
    } else if (rightS >= -clearance && leftS < rightS) {
      desired = leftA;
    } else {
      const here = shoreAt(x, z);
      if (here > -clearance * 3.4) {
        const n = shoreGradient(x, z, 7, _grad);
        const inward = Math.atan2(-n.z, -n.x);
        desired = heading + angleDelta(heading, inward) * 0.18;
      }
    }

    // Turn rate is capped, preventing instant 180-degree pops at shorelines.
    heading += Math.max(-0.34, Math.min(0.34, angleDelta(heading, desired)));
    let nx = x + Math.cos(heading) * distance;
    let nz = z + Math.sin(heading) * distance;
    const cur = currentAt(x, z, t, _cur);
    nx += cur.x * Math.min(0.35, distance * 0.055);
    nz += cur.z * Math.min(0.35, distance * 0.055);
    let blocked = !isNavigableWater(nx, nz, clearance * 0.55);
    if (blocked) { nx = x; nz = z; }
    out = out || {};
    out.x = nx; out.z = nz; out.heading = heading; out.blocked = blocked; out.shore = frontS;
    return out;
  }

  function sample(x, z, t) {
    const s = shoreAt(x, z);
    const c = currentAt(x, z, t, {});
    return {
      water: s < 0,
      surfaceWater: isSurfaceWater(x, z, 0),
      shore: s,
      depth: s < 0 ? Math.min(62, 1.1 + (-s) * 0.075) : 0,
      surfaceY: surfaceY(x, z, t),
      inland: inlandFactorAt(x, z),
      currentX: c.x,
      currentZ: c.z,
    };
  }

  const api = CBZ.waterField = {
    bindArena: bindArena,
    arena: arena,
    shoreAt: shoreAt,
    depthAt: depthAt,
    surfaceY: surfaceY,
    surfaceSlope: surfaceSlope,
    surfaceNormal: surfaceNormal,
    inlandFactorAt: inlandFactorAt,
    currentAt: currentAt,
    shoreGradient: shoreGradient,
    isNavigableWater: isNavigableWater,
    isSurfaceWater: isSurfaceWater,
    nearestWater: nearestWater,
    randomWaterPoint: randomWaterPoint,
    moveInWater: moveInWater,
    sample: sample,
  };

  CBZ.cityWaterAt = function (x, z) { return isSurfaceWater(x, z, 0); };
  CBZ.citySeaHeightAt = surfaceY;
  CBZ.citySeaSlopeAt = surfaceSlope;
  CBZ.citySeaNormalAt = surfaceNormal;
  CBZ.cityWaterDepthAt = depthAt;

  // Bind the live build descriptor before any biome/wildlife builder runs.
  if (CBZ.addLandmass) CBZ.addLandmass(function (city) { bindArena(city); return null; }, -100);
  // ...and re-read the registered inland water bodies AFTER every biome has
  // registered its lakes (order 900 is past every landmass builder), so the
  // lake look/calm damping in water_spec.js knows where the lakes are.
  if (CBZ.addLandmass) CBZ.addLandmass(function (city) {
    if (CBZ.waterSyncInlandBodies) CBZ.waterSyncInlandBodies(city);
    return null;
  }, 900);
})();
