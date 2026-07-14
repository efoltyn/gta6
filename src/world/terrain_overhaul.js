/* ============================================================
   world/terrain_overhaul.js — SOLID MOUNTAINS. Loads right after
   world/terrain.js and overrides its oracle + builder.

   WHY (owner: "mountains rn are like big shells"): the old backdrop
   drama came from buildRidgedRange SHEETS — single-layer displaced
   grids whose back edge hangs at ~25% peak height in mid-air. From
   the street they were 100% fog-dissolved pale cutouts (city fog.far
   is 430 while the ring sat at radius ~1900-2380 — beyond the GROUND
   camera.far of 1000, so the giants were literally frustum-clipped);
   from a plane they showed their hollow backs. This module:

     • folds ALL mountain mass into the one continuous heightfield —
       a closed-from-every-angle solid surface. No sheets, ever.
     • keeps relief in two open northern ranges with a broad pass between
       them. Relief no longer follows all four sides of the playable AABB —
       that closed perimeter read as a hollow mountain bowl from aircraft.
     • keeps the two signature giants as gaussian×ridged-noise bumps in those
       northern ranges, so each mountain is solid without enclosing the map.
     • fogs terrain on its OWN scale: a tiny onBeforeCompile multiplies
       the r128 `fogDepth` varying by uFogScale (0.33), so mountains
       fog at ~3× distance — solid, gently receding — while still
       tracking the live fog COLOR (night/dusk/weather stay correct).
       scene.fog itself is untouched (sky.js derives the horizon from
       it; the city's fog wall must not move).
     • sinks the field VISUALLY below the sea wherever the oracle is
       flat (the playable interior): the plate/city/biomes own the
       view there, and the world.js animated sea shows through the
       continent's carved coast instead of a fake water-colored plane.
       The PHYSICS ORACLE is untouched by this: CBZ.terrainHeight
       still returns EXACTLY 0 over FLAT+MARGIN — byte-identical to
       the old contract, nothing can fall off a hill.
     • noise is pure position-hash (window.noise.rangeVnoise /
       rangeRidgedFbm — seed-free functions) offset by world-seed
       constants: no noise.seed() ordering races, byte-identical/seed.

   Perf: 4×4 tiles at 76 segs ≈ 185k tris / 16 draws (was 157k/16 +
   ~20 sheet draws now REMOVED) + the same 90-boulder scatter.
   Revert: CBZ.CONFIG.TERRAIN_SOLID = false (sheet terrain returns).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const CFG = (CBZ.CONFIG = CBZ.CONFIG || {});
  if (CFG.TERRAIN_SOLID == null) CFG.TERRAIN_SOLID = true;

  // originals (terrain.js loaded just before this file)
  const orig = {
    height: CBZ.terrainHeight,
    normal: CBZ.terrainNormal,
    build: CBZ.buildTerrain,
  };
  if (!orig.build || !orig.height) return;   // terrain.js absent — nothing to do

  const N = window.noise;
  function vn(x, z) { return N && N.rangeVnoise ? N.rangeVnoise(x, z) : 0.5; }
  function rfbm(x, z) { return N && N.rangeRidgedFbm ? N.rangeRidgedFbm(x, z) : 0.3; }

  // ---- the flat contract (identical constants to terrain.js) ------------
  const FLAT = CBZ.TERRAIN_FLAT || { minX: -960, maxX: 1580, minZ: -1790, maxZ: 760 };
  CBZ.TERRAIN_FLAT = FLAT;
  const MARGIN = 150, RAMP = 460;
  function smooth(e0, e1, x) {
    if (e1 === e0) return x < e0 ? 0 : 1;
    let t = (x - e0) / (e1 - e0);
    if (t < 0) t = 0; else if (t > 1) t = 1;
    return t * t * (3 - 2 * t);
  }
  function distOutsideFlat(x, z) {
    const dx = Math.max(FLAT.minX - x, 0, x - FLAT.maxX);
    const dz = Math.max(FLAT.minZ - z, 0, z - FLAT.maxZ);
    return Math.sqrt(dx * dx + dz * dz);
  }

  // ---- seed-keyed coordinate offsets (pure-hash noise, no seed() calls) --
  const SO1 = ((CBZ.hashN ? CBZ.hashN(7331) % 997 : 137) + 13) * 1.71;
  const SO2 = ((CBZ.hashN ? CBZ.hashN(9227) % 997 : 411) + 7) * 2.33;

  // rolling hills: 4-octave signed fbm on the hash value-noise
  const HILL_AMP = 60, HILL_FREQ = 1 / 620;
  function fbm(x, z) {
    let f = HILL_FREQ, a = 0.5, sum = 0, norm = 0;
    for (let o = 0; o < 4; o++) {
      sum += a * (vn(x * f + SO1 + o * 13.7, z * f - SO1 - o * 7.3) * 2 - 1);
      norm += a; f *= 2.03; a *= 0.5;
    }
    return (sum / norm) * HILL_AMP;
  }
  // ridged crests: the shared ridged-fbm, world-seed offset
  const RIDGE_AMP = 320, RIDGE_FREQ = 1 / 780;
  function ridged(x, z) {
    return rfbm(x * RIDGE_FREQ + SO2, z * RIDGE_FREQ - SO2) * RIDGE_AMP;
  }

  // ---- the two signature giants: gaussian × crag bumps IN the field -----
  // Their layout follows the live playable bounds. Countries are registered
  // after this file loads, so freezing these coordinates at parse time put
  // mountains through later settlements and made the old flat rectangle read
  // like a walled bowl.
  let CX = (FLAT.minX + FLAT.maxX) / 2;
  let CZ = (FLAT.minZ + FLAT.maxZ) / 2;
  let RANGE_WEST_X = CX - 850;
  let RANGE_EAST_X = CX + 1050;
  const HEROES = [
    { name: "Mount Colossus", x: RANGE_WEST_X, z: FLAT.minZ - 720, amp: 650, sig: 260, ns: 0.006 },
    { name: "Mount Everest", x: RANGE_EAST_X, z: FLAT.minZ - 820, amp: 900, sig: 350, ns: 0.0048 },
  ];
  function layoutRanges() {
    CX = (FLAT.minX + FLAT.maxX) / 2;
    CZ = (FLAT.minZ + FLAT.maxZ) / 2;
    const width = FLAT.maxX - FLAT.minX;
    RANGE_WEST_X = CX - Math.min(980, width * 0.2);
    RANGE_EAST_X = CX + Math.min(1180, width * 0.24);
    HEROES[0].x = RANGE_WEST_X; HEROES[0].z = FLAT.minZ - 720;
    HEROES[1].x = RANGE_EAST_X; HEROES[1].z = FLAT.minZ - 820;
    CBZ.MOUNT_COLOSSUS = { name: HEROES[0].name, x: HEROES[0].x, z: HEROES[0].z, height: HEROES[0].amp };
    CBZ.MOUNT_EVEREST = { name: HEROES[1].name, x: HEROES[1].x, z: HEROES[1].z, height: HEROES[1].amp };
  }
  layoutRanges();
  function heroBump(x, z, P) {
    const dx = x - P.x, dz = z - P.z;
    const g = Math.exp(-(dx * dx + dz * dz) / (2 * P.sig * P.sig));
    if (g < 1e-3) return 0;
    const crag = 0.55 + 0.45 * rfbm(x * P.ns + SO1, z * P.ns - SO2);
    return P.amp * g * crag;
  }
  function bell(x, centre, sigma) {
    const q = (x - centre) / sigma;
    return Math.exp(-0.5 * q * q);
  }

  // Only two broken northern ranges get relief. The wide centre pass and the
  // completely open west/east/south sides are intentional: from the air this
  // reads as geography, not as the inside of a rectangular mountain shell.
  function rangeMask(x, z) {
    const north = FLAT.minZ - z;
    if (north <= MARGIN + 20) return 0;
    const depth = smooth(MARGIN + 20, MARGIN + RAMP * 0.9, north) *
      (1 - smooth(1250, 1850, north));
    if (depth <= 0) return 0;
    const lobes = Math.max(
      bell(x, RANGE_WEST_X, 500),
      bell(x, RANGE_EAST_X, 430) * 0.96
    );
    return depth * smooth(0.16, 0.58, lobes);
  }
  CBZ.terrainRangeMask = rangeMask;

  // ---- THE ORACLE — exact flat contract preserved ------------------------
  function solidHeight(x, z) {
    const d = distOutsideFlat(x, z);
    if (d <= MARGIN) return 0;                       // dead flat — physics-safe
    const range = rangeMask(x, z);
    let hero = 0;
    for (let i = 0; i < HEROES.length; i++) hero += heroBump(x, z, HEROES[i]);
    if (range <= 0 && hero <= 0.01) return 0;         // open sea on three sides + the central pass
    const north = Math.max(0, FLAT.minZ - z);
    const outer = 1 - smooth(1450, 1950, north);     // sink the far back of each range into sea
    if (outer <= 0) return 0;                        // physics-flat far out (visual sinks it)
    const hills = Math.max(0, 18 + fbm(x, z) * 0.72) * range;
    const mtn = ridged(x, z) * range;
    return Math.max(0, hills + mtn + hero) * outer;
  }
  CBZ.terrainHeight = function (x, z) {
    if (CBZ.PROC_TERRAIN === false) return 0;
    if (CFG.TERRAIN_SOLID === false) return orig.height(x, z);
    return solidHeight(x, z);
  };
  const _EPS = 2.0;
  CBZ.terrainNormal = function (x, z, out) {
    out = out || new THREE.Vector3();
    const hL = CBZ.terrainHeight(x - _EPS, z), hR = CBZ.terrainHeight(x + _EPS, z);
    const hD = CBZ.terrainHeight(x, z - _EPS), hU = CBZ.terrainHeight(x, z + _EPS);
    out.set(hL - hR, 2 * _EPS, hD - hU).normalize();
    return out;
  };

  // ---- VISUAL height: where the oracle is (near) flat, sink the mesh
  //      under the sea so the plate/city/sea own the view there. Rises
  //      to meet the oracle by h≈40, so mountains match physics exactly.
  function visualHeight(x, z) {
    const h = CBZ.terrainHeight(x, z);
    return h - 1.8 * (1 - smooth(0, 40, h));
  }
  function visualNormal(x, z, out) {
    out = out || new THREE.Vector3();
    const hL = visualHeight(x - _EPS, z), hR = visualHeight(x + _EPS, z);
    const hD = visualHeight(x, z - _EPS), hU = visualHeight(x, z + _EPS);
    out.set(hL - hR, 2 * _EPS, hD - hU).normalize();
    return out;
  }

  // ---- HEIGHT-BAND COLOUR (retuned for the taller solid range) ----------
  // Grounded, lower-saturation rock palette. The former bright green/white
  // height bands looked like painted plastic from the air and the pale peaks
  // disappeared into the sky. These values keep readable geology through fog.
  const COL_DEEP = new THREE.Color(0x183f59);
  const COL_SAND = new THREE.Color(0x92795d);
  const COL_GRASS = new THREE.Color(0x4d6242);
  const COL_GRASS2 = new THREE.Color(0x354637);
  const COL_ROCK = new THREE.Color(0x4b4845);
  const COL_ROCKH = new THREE.Color(0x756f67);
  const COL_SNOW = new THREE.Color(0xd9e0e5);
  function bandColor(y, slope, wob, out) {
    // wob (0..1, low-freq hash) raggeds the band lines so nothing rules a
    // straight contour across the range.
    const j = (wob - 0.5) * 26;                     // ±13u band wobble
    if (y < -0.2) { out.copy(COL_DEEP); return; }
    if (y < 6 + j * 0.2) { out.copy(COL_SAND).lerp(COL_GRASS, smooth(1.5, 6, y)); return; }
    if (y < 95 + j) {
      out.copy(COL_GRASS).lerp(COL_GRASS2, smooth(10, 85, y));
      if (slope > 0.42) out.lerp(COL_ROCK, smooth(0.42, 0.75, slope));
      return;
    }
    if (y < 235 + j * 1.6) {
      out.copy(COL_ROCK).lerp(COL_ROCKH, smooth(95, 220, y));
      // snow creeps onto flat high ground below the hard snowline
      if (slope < 0.55) out.lerp(COL_SNOW, smooth(165 + j, 240 + j, y) * (1 - slope));
      return;
    }
    out.copy(COL_SNOW);
    if (slope > 0.62) out.lerp(COL_ROCKH, smooth(0.62, 0.95, slope));
    // Break the last synthetic horizontal band with subtle stone variation.
    out.multiplyScalar(0.90 + wob * 0.12);
  }

  // ---- the fogDepth scale — terrain reads solid past the city fog wall.
  //      r128: fog_vertex sets `fogDepth = -mvPosition.z` (varying). Shared
  //      helper so the snow biome's massif pads can use the same trick.
  // Mountains still track weather/day colour, but no longer dissolve into a
  // semi-transparent-looking silhouette at normal aircraft distances.
  const FOG_SCALE = 0.16;
  CBZ.terrainFogScale = function (mat, scale) {
    mat.onBeforeCompile = function (sh) {
      sh.uniforms.uFogScale = { value: scale == null ? FOG_SCALE : scale };
      sh.vertexShader = "uniform float uFogScale;\n" + sh.vertexShader
        .replace("#include <fog_vertex>",
          "#include <fog_vertex>\n#ifdef USE_FOG\n\tfogDepth *= uFogScale;\n#endif");
    };
    return mat;
  };

  // ---- BUILD — 4×4 solid relief tiles + boulder scatter. No sheets. -----
  let _built = null;
  CBZ.buildTerrain = function (parent) {
    if (CFG.TERRAIN_SOLID === false) return orig.build(parent);
    if (CBZ.PROC_TERRAIN === false) return null;
    if (_built) return _built;
    const root = parent || CBZ.scene;
    if (!root) return null;
    if (CBZ.syncTerrainFlat) CBZ.syncTerrainFlat(CBZ.city && CBZ.city.arena);
    layoutRanges();

    // Cover the live world plus enough northern sea for both open ranges. The
    // old fixed 6000u field predated the outer countries and clipped their side.
    const liveSpan = Math.max(FLAT.maxX - FLAT.minX, FLAT.maxZ - FLAT.minZ) + 1500;
    const SPAN = Math.max(6000, Math.ceil(liveSpan / 500) * 500);
    const TILES = 4, TSPAN = SPAN / TILES, TSEG = 76;
    const terrMat = CBZ.terrainFogScale(new THREE.MeshLambertMaterial({
      color: 0xffffff, vertexColors: true, flatShading: true, fog: true,
      transparent: false, opacity: 1, depthTest: true, depthWrite: true,
    }));
    const _c = new THREE.Color();
    const terrainTiles = [];
    for (let tj = 0; tj < TILES; tj++) for (let ti = 0; ti < TILES; ti++) {
      const tcx = CX - SPAN / 2 + (ti + 0.5) * TSPAN;
      const tcz = CZ - SPAN / 2 + (tj + 0.5) * TSPAN;
      const geo = new THREE.PlaneGeometry(TSPAN, TSPAN, TSEG, TSEG);
      geo.rotateX(-Math.PI / 2);
      geo.translate(tcx, 0, tcz);
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        pos.setY(i, visualHeight(pos.getX(i), pos.getZ(i)));
      }
      pos.needsUpdate = true;
      // flat-shaded crisp facets: de-index, per-face normals
      const flatGeo = geo.toNonIndexed();
      flatGeo.computeVertexNormals();
      const fp = flatGeo.attributes.position;
      const fn = flatGeo.attributes.normal;
      const fcolors = new Float32Array(fp.count * 3);
      for (let i = 0; i < fp.count; i++) {
        const y = fp.getY(i);
        const slope = 1 - Math.min(1, Math.max(0, fn.getY(i)));
        const wob = vn(fp.getX(i) * 0.012 + SO1, fp.getZ(i) * 0.012 - SO1);
        bandColor(y, slope, wob, _c);
        fcolors[i * 3] = _c.r; fcolors[i * 3 + 1] = _c.g; fcolors[i * 3 + 2] = _c.b;
      }
      flatGeo.setAttribute("color", new THREE.BufferAttribute(fcolors, 3));
      geo.dispose();
      flatGeo.computeBoundingSphere();
      const tile = new THREE.Mesh(flatGeo, terrMat);
      tile.position.y = -0.06;             // city ground always wins the flat depth fight
      tile.receiveShadow = true;
      tile.castShadow = false;
      tile.matrixAutoUpdate = false; tile.updateMatrix();
      tile.userData.terrain = true;        // batch + farcull exempt
      root.add(tile);
      terrainTiles.push(tile);
    }
    const terrain = terrainTiles[0];       // legacy return value (first tile)

    // ---- boulder scatter on the range's shoulders (solid, slope-aware) --
    const heroMeshes = [];
    if (CBZ.scatterRocks) {
      const scat = CBZ.scatterRocks(root, {
        count: 90,
        pick: function (rng) {
          // rejection-sample only the two northern mountain shoulders
          for (let tries = 0; tries < 12; tries++) {
            const x = FLAT.minX - 180 + rng() * ((FLAT.maxX - FLAT.minX) + 360);
            const z = FLAT.minZ - 240 - rng() * 1080;
            if (rangeMask(x, z) < 0.08) continue;
            if (CBZ.terrainHeight(x, z) < 25) continue;
            return { x, z };
          }
          return null;
        },
        heightAt: visualHeight,            // rocks sit on the MESH, exactly
        normalAt: visualNormal,
        repeatAngleDeg: 38,
        minSize: 3, maxSize: 9,
        baseRadius: 1, detail: 1,
        variants: 3,
        colorHex: 0x716b60,
        seed: 4242,
      });
      if (scat && scat.meshes) for (const m of scat.meshes) heroMeshes.push(m);
    }

    // ---- perf/quality tier gate (same policy as before: scatter hides at
    //      tiers 0-1, shadow receive drops with it) ------------------------
    function applyTerrainTier() {
      const q = CBZ.qualityLevel == null ? 4 : CBZ.qualityLevel;
      const showBackdrop = q >= 2;
      for (const m of heroMeshes) m.visible = showBackdrop;
      const recv = q >= 2;
      if (terrMat.userData._recv !== recv) {
        terrMat.userData._recv = recv;
        for (const t of terrainTiles) t.receiveShadow = recv;
        terrMat.needsUpdate = true;
      }
    }
    if (CBZ.onQualityChange) CBZ.onQualityChange(applyTerrainTier);

    _built = terrain;
    return terrain;
  };
})();
