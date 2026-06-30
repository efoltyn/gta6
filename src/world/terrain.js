/* ============================================================
   world/terrain.js — PROCEDURAL BACKDROP TERRAIN.

   The whole playable archipelago (city + 3 islands + 4 biomes +
   every causeway) is a FLAT plane at y=0 by contract — cars, NPCs,
   buildings and spawns all assume it. This file does NOT touch that.
   It paints a DRAMATIC snow-capped mountain range + rolling hills in
   the FAR BACKDROP RING that encircles the map, so the horizon stops
   being flat sea-into-fog and becomes a real landscape you look out
   AT but never walk on.

   HOW IT STAYS SAFE (owner's untested-ship rule):
     CBZ.terrainHeight(x,z) returns EXACTLY 0 over a generous flat
     region (cityFalloff == 0) that encloses every walkable footprint
     plus a ~150u margin. Relief only switches on past that ring. So
     CBZ.floorAt (which world.js routes to terrainHeight) is byte-for-
     byte 0 anywhere a person or vehicle can actually be — physics is
     unchanged, nothing can fall off a hill.

   DRAW CALLS (engine is draw-call bound, ~1000 NPCs):
     • ONE big non-indexed PlaneGeometry mesh carries the entire relief
       field with per-vertex height-band vertex colours (sea→sand→grass
       →rock→snow), flat-shaded for crisp facets = 1 draw call.
     • A handful of hand-placed HERO PEAKS (rock cones + snow caps) are
       merged via BufferGeometryUtils into ONE mesh = 1 draw call.
     Total backdrop cost: 2 draw calls. frustumCulled=false so the ring
     never pops as the camera turns.

   Analytic + allocation-free: terrainHeight/terrainNormal are pure math
   (no per-call allocation) because they're sampled per-vertex at build
   AND potentially per floorAt() query.

   Gated behind CBZ.PROC_TERRAIN (default ON). Set CBZ.PROC_TERRAIN=false
   before world build to disable entirely (terrainHeight then absent →
   world.js falls back to flat 0).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  if (!window.noise) { /* noise.js must load first */ }

  // ----------------------------------------------------------------------
  //  SEED — fixed constant (deterministic world, matching the repo style).
  // ----------------------------------------------------------------------
  const SEED = 1337;
  if (window.noise && window.noise.seed) window.noise.seed(SEED);

  // ----------------------------------------------------------------------
  //  THE FLAT (PLAYABLE) REGION — the union AABB of every walkable
  //  footprint registered in the archipelago, padded by a generous margin.
  //  Computed from:
  //    city mainland ......... ~ x[-176,176]  z[-876,524-]  (centre 0,-700)
  //    commerce annex ........ x[228,469]      z[-820,-580]
  //    speedway island ....... x[270,670]      z[-530,-130]
  //    airport island ........ x[-370,290]     z[-280,40]
  //    military island ....... x[-860,-380]    z[-950,-450]
  //    desert biome .......... x[670,1430]     z[-320,280]
  //    forest biome .......... x[-950,-170]    z[-1680,-1020]
  //    farmland biome ........ x[780,1580]     z[-1280,-480]
  //    snow biome ............ x[-70,770]      z[-1780,-1120]
  //    + every causeway between them.
  //  Union: x[-960,1580]  z[-1790,290].  We KEEP IT FLAT generously —
  //  when unsure, flat wins (owner rule). Margin pushes the relief ring
  //  well clear of anywhere anyone can stand.
  // ----------------------------------------------------------------------
  const FLAT = { minX: -960, maxX: 1580, minZ: -1790, maxZ: 290 };
  const MARGIN = 150;        // dead-flat for this much PAST the union edge
  const RAMP = 460;          // smoothstep distance from flat edge → full relief

  // expose the flat extents for tooling / other agents
  CBZ.TERRAIN_FLAT = FLAT;

  // ----------------------------------------------------------------------
  //  ANALYTIC NOISE FIELD — all pure functions, zero allocation.
  // ----------------------------------------------------------------------
  function s2(x, z) { return window.noise ? window.noise.simplex2(x, z) : 0; }

  // smoothstep(0..1)
  function smooth(e0, e1, x) {
    if (e1 === e0) return x < e0 ? 0 : 1;
    let t = (x - e0) / (e1 - e0);
    if (t < 0) t = 0; else if (t > 1) t = 1;
    return t * t * (3 - 2 * t);
  }

  // signed-ish distance from a point to the FLAT rectangle: 0 inside,
  // grows positive as you move away (Chebyshev/box distance to the rect).
  function distOutsideFlat(x, z) {
    const dx = Math.max(FLAT.minX - x, 0, x - FLAT.maxX);
    const dz = Math.max(FLAT.minZ - z, 0, z - FLAT.maxZ);
    // Euclidean box distance (rounds the corners — no hard square ridge).
    return Math.sqrt(dx * dx + dz * dz);
  }

  // cityFalloff: 0 across the whole playable region (+ margin), smoothly
  // rising to 1 only in the far ring. EXACTLY 0 inside flat → relief can't
  // leak under anyone.
  CBZ.terrainFalloff = function (x, z) {
    const d = distOutsideFlat(x, z);
    if (d <= MARGIN) return 0;
    return smooth(MARGIN, MARGIN + RAMP, d);
  };

  // fractal Brownian motion — rolling hills (4 octaves, analytic).
  const HILL_AMP = 46;       // hill relief amplitude (u)
  const HILL_FREQ = 1 / 620; // base wavelength (~620u features)
  function fbm(x, z) {
    let f = HILL_FREQ, a = 0.5, sum = 0, norm = 0;
    for (let o = 0; o < 4; o++) {
      sum += a * s2(x * f + o * 13.7, z * f - o * 7.3);
      norm += a;
      f *= 2.03; a *= 0.5;
    }
    return (sum / norm) * HILL_AMP;
  }

  // ridged multifractal — sharp mountain crests for the OUTER band only.
  const RIDGE_AMP = 150;       // peak height contribution (u) → ~150u peaks (raised so foothills cap white)
  const RIDGE_FREQ = 1 / 900;  // big mountain wavelength
  function ridged(x, z) {
    let f = RIDGE_FREQ, a = 1.0, sum = 0, norm = 0;
    for (let o = 0; o < 4; o++) {
      let n = s2(x * f - o * 21.1, z * f + o * 17.9);
      n = 1 - Math.abs(n);       // crease → ridge
      n = n * n;                 // sharpen
      sum += a * n;
      norm += a;
      f *= 2.07; a *= 0.5;
    }
    return (sum / norm) * RIDGE_AMP;
  }

  // the OUTER mountain band: ridges only really kick in further out than the
  // hills, so you get rolling foothills first, then a dramatic peak wall.
  function mountainMask(x, z) {
    const d = distOutsideFlat(x, z);
    // foothills start ~at the ramp, big peaks ~RAMP further still.
    return smooth(MARGIN + RAMP * 0.6, MARGIN + RAMP * 2.2, d);
  }

  // ----------------------------------------------------------------------
  //  THE ORACLE — CBZ.terrainHeight(x,z). Returns 0 over the flat region.
  // ----------------------------------------------------------------------
  CBZ.terrainHeight = function (x, z) {
    const fo = CBZ.terrainFalloff(x, z);
    if (fo <= 0) return 0;                 // dead flat — physics-safe
    const hills = fbm(x, z);
    const mtn = ridged(x, z) * mountainMask(x, z);
    return (hills + mtn) * fo;
  };

  // central-difference normal (for slope keep-outs / the nature agent).
  const _EPS = 2.0;
  CBZ.terrainNormal = function (x, z, out) {
    out = out || new THREE.Vector3();
    const hL = CBZ.terrainHeight(x - _EPS, z), hR = CBZ.terrainHeight(x + _EPS, z);
    const hD = CBZ.terrainHeight(x, z - _EPS), hU = CBZ.terrainHeight(x, z + _EPS);
    out.set(hL - hR, 2 * _EPS, hD - hU).normalize();
    return out;
  };

  // ----------------------------------------------------------------------
  //  HEIGHT-BAND COLOUR — pick a vertex colour from elevation.
  // ----------------------------------------------------------------------
  const COL_WATER = new THREE.Color(0x2f6f9e);  // matches the sea plane tone
  const COL_SAND  = new THREE.Color(0xc8b385);
  const COL_GRASS = new THREE.Color(0x4f7d3f);
  const COL_GRASS2= new THREE.Color(0x3c6a33);
  const COL_ROCK  = new THREE.Color(0x6f6a63);
  const COL_ROCKH = new THREE.Color(0x8a8378);
  const COL_SNOW  = new THREE.Color(0xeef3f8);
  const _c = new THREE.Color();
  function bandColor(y, slope, out) {
    // slope (0 flat .. 1 vertical-ish) darkens grass toward rock on steeps.
    if (y < 0.5) { out.copy(COL_WATER); return; }
    if (y < 6)   { out.copy(COL_SAND).lerp(COL_GRASS, smooth(2, 6, y)); return; }
    if (y < 30)  {
      out.copy(COL_GRASS).lerp(COL_GRASS2, smooth(8, 28, y));
      if (slope > 0.45) out.lerp(COL_ROCK, smooth(0.45, 0.8, slope));
      return;
    }
    if (y < 52)  {
      out.copy(COL_ROCK).lerp(COL_ROCKH, smooth(30, 50, y));
      // snow starts creeping onto flatter high ground (snowline lowered)
      if (slope < 0.6) out.lerp(COL_SNOW, smooth(34, 54, y) * (1 - slope));
      return;
    }
    // high peaks: snow, except the steepest faces stay bare rock.
    out.copy(COL_SNOW);
    if (slope > 0.7) out.lerp(COL_ROCKH, smooth(0.7, 1.0, slope));
  }

  // ----------------------------------------------------------------------
  //  BUILD — ONE relief mesh + ONE merged hero-peaks mesh. Called by
  //  world.js at city-build time (guarded). Idempotent.
  // ----------------------------------------------------------------------
  let _built = null;
  CBZ.buildTerrain = function (parent) {
    if (CBZ.PROC_TERRAIN === false) return null;     // gate (default ON)
    if (_built) return _built;
    if (!window.noise) { console.warn("[terrain] window.noise missing — skipped"); return null; }
    window.noise.seed(SEED);

    const root = parent || CBZ.scene;
    if (!root) return null;

    // --- 1) the big relief mesh ---------------------------------------
    const SPAN = 6000, SEG = 280;
    // centre the field over the archipelago (the sea plane sits ~(150,-900)).
    const CX = (FLAT.minX + FLAT.maxX) / 2;   // ~310
    const CZ = (FLAT.minZ + FLAT.maxZ) / 2;   // ~-750

    const geo = new THREE.PlaneGeometry(SPAN, SPAN, SEG, SEG);
    // lay it flat in XZ and recentre.
    geo.rotateX(-Math.PI / 2);
    geo.translate(CX, 0, CZ);

    const pos = geo.attributes.position;
    const vcount = pos.count;
    const colors = new Float32Array(vcount * 3);

    // displace every vertex by terrainHeight, then colour by band.
    for (let i = 0; i < vcount; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const h = CBZ.terrainHeight(x, z);
      pos.setY(i, h);
    }
    pos.needsUpdate = true;

    // flat-shaded crisp facets: drop the index so each tri owns its verts,
    // then recompute per-face normals.
    const flatGeo = geo.toNonIndexed();
    flatGeo.computeVertexNormals();

    // colour per (now de-indexed) vertex from its height + local slope.
    const fp = flatGeo.attributes.position;
    const fn = flatGeo.attributes.normal;
    const fcount = fp.count;
    const fcolors = new Float32Array(fcount * 3);
    for (let i = 0; i < fcount; i++) {
      const y = fp.getY(i);
      // slope from the face normal (1 = flat-up, 0 = vertical) → invert.
      const ny = fn.getY(i);
      const slope = 1 - Math.min(1, Math.max(0, ny));
      bandColor(y, slope, _c);
      fcolors[i * 3] = _c.r; fcolors[i * 3 + 1] = _c.g; fcolors[i * 3 + 2] = _c.b;
    }
    flatGeo.setAttribute("color", new THREE.BufferAttribute(fcolors, 3));
    geo.dispose();   // the indexed source is no longer needed

    const terrMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    const terrain = new THREE.Mesh(flatGeo, terrMat);
    // The relief is coincident with the city ground plane at y=0 across the
    // flat region (both are exactly 0 there). Nudge the WHOLE relief down a
    // hair so the city's textured ground always wins the depth fight; the
    // far ring (where it actually rises) is unaffected at any visible scale.
    terrain.position.y = -0.06;
    terrain.rotation.y = 0;
    terrain.frustumCulled = false;          // never pop as the camera turns
    terrain.receiveShadow = true;
    terrain.castShadow = false;
    terrain.matrixAutoUpdate = false; terrain.updateMatrix();
    terrain.userData.terrain = true;
    root.add(terrain);

    // --- 2) HERO PEAKS — a dramatic snow-capped MOUNTAIN RANGE in the
    //        backdrop ring, merged into ONE mesh. These are pure backdrop,
    //        placed well OUTSIDE the flat region (radius ~1850-2300) so they
    //        tower on the skyline without ever being reachable — NO valleyGuard
    //        and the playable floor (terrainHeight over the flat region) is
    //        untouched. Technique mirrors city/biome_snow.js peaks(): each
    //        ridge spine is a DISPLACED RIDGED-NOISE grid strip emitted as
    //        non-indexed flat-shaded triangles (craggy faceted silhouettes),
    //        VERTEX-COLORED by altitude+slope (rock base → ragged snowline ~50%
    //        → snow, steep faces stay dark rock), with a far-distance fog
    //        desaturation baked into the vertex colors so the peaks recede.
    const BGU = THREE.BufferGeometryUtils;

    // -- seeded value-noise (hash + smoothstep-lerp), 2-D (deterministic) --
    function hash2(ix, iz) {
      let h = (ix * 374761393 + iz * 668265263) | 0;
      h = Math.imul(h ^ (h >>> 13), 1274126177);
      h = (h ^ (h >>> 16)) >>> 0;
      return h / 4294967296;                 // 0..1
    }
    function smoothN(t) { return t * t * (3 - 2 * t); }
    function vnoise(x, z) {
      const ix = Math.floor(x), iz = Math.floor(z);
      const fx = x - ix, fz = z - iz;
      const a = hash2(ix, iz), b = hash2(ix + 1, iz);
      const c = hash2(ix, iz + 1), d = hash2(ix + 1, iz + 1);
      const ux = smoothN(fx), uz = smoothN(fz);
      return (a * (1 - ux) + b * ux) * (1 - uz) + (c * (1 - ux) + d * ux) * uz;
    }
    // -- RIDGED fbm: sharp connected ridgelines (5 octaves) ----------------
    function ridgedN(x, z) {
      let sum = 0, freq = 1, amp = 0.5, prev = 1;
      for (let o = 0; o < 5; o++) {
        let n = vnoise(x * freq, z * freq);
        n = 1 - Math.abs(2 * n - 1);         // ridge fold
        n = n * n;                            // sharpen
        sum += n * amp * prev;
        prev = n;
        freq *= 2; amp *= 0.5;
      }
      return sum;                             // ~0..1-ish
    }

    // -- palette + altitude/slope vertex color (rock / ragged snow / cliff) -
    const cRock   = new THREE.Color(0x6f6a63);
    const cRockDk = new THREE.Color(0x4a463f);
    const cSnow   = new THREE.Color(0xeef3f8);
    const cSnowSh = new THREE.Color(0xd6e0ea);
    const cFog    = new THREE.Color(0x9fb4c4);   // distance haze tint (sky/sea-ish)
    const _cu = new THREE.Color();
    function shadeVert(y, peakH, upDot, snowWobble, fogT, out) {
      // ragged snowline ~48% of peak height, wobbled by low-freq noise
      const snowline = peakH * (0.48 + (snowWobble - 0.5) * 0.24);
      const above = y > snowline;
      const steep = upDot < 0.52;            // cliff: snow slides off
      if (!above || steep) {
        const dk = steep ? 0.72 : (1 - Math.min(1, y / Math.max(1, snowline))) * 0.5;
        out.copy(cRock).lerp(cRockDk, dk);
      } else {
        const lit = Math.min(1, Math.max(0, (upDot - 0.55) / 0.45));
        out.copy(cSnowSh).lerp(cSnow, lit);
      }
      // bake fog/distance desaturation so far peaks recede into the haze
      if (fogT > 0) out.lerp(cFog, fogT);
      return out;
    }

    // -- build ONE ridge strip as a non-indexed displaced grid -------------
    //    p0->p1 = ridge spine on the backdrop ring; depthDir = unit vector
    //    pointing radially AWAY from the field centre (the range body extends
    //    that way). distFog: 0 near .. 1 far (for the baked haze).
    function buildRidge(p0, p1, depthDir, cfg) {
      const cols = cfg.cols, rows = cfg.rows;
      const peakAmp = cfg.peakAmp, depthLen = cfg.depthLen;
      const seedOff = cfg.seedOff, noiseScale = cfg.noiseScale;
      const fogBase = cfg.fogBase || 0, fogDepth = cfg.fogDepth || 0;
      const dx = p1.x - p0.x, dz = p1.z - p0.z;
      const gx = [], gz = [], gy = [], gf = [];
      for (let r = 0; r <= rows; r++) {
        const dv = r / rows;                       // 0 at ring edge .. 1 deep
        gx[r] = []; gz[r] = []; gy[r] = []; gf[r] = [];
        for (let c = 0; c <= cols; c++) {
          const t = c / cols;
          const bx = p0.x + dx * t + depthDir.x * (dv * depthLen);
          const bz = p0.z + dz * t + depthDir.z * (dv * depthLen);
          const nx = (bx + seedOff) * noiseScale;
          const nz = (bz - seedOff) * noiseScale;
          let h = ridgedN(nx, nz) * peakAmp;
          // low-freq envelope along the ridge: tall peaks + saddles
          const env = 0.45 + 0.55 * vnoise(t * 3.3 + seedOff * 0.01, seedOff * 0.02);
          h *= env;
          // depth TENT: crest near mid-depth, falls off front & back
          const tent = Math.sin(Math.min(1, dv * 1.15) * Math.PI);
          h *= 0.25 + 0.75 * tent;
          // taper the front edge to the ground so the range meets the relief
          // field smoothly (NO valleyGuard needed — pure backdrop, far out).
          const foot = Math.min(1, dv / 0.18);
          h *= foot;
          gx[r][c] = bx; gz[r][c] = bz; gy[r][c] = h;
          // farther rows recede more into the haze
          gf[r][c] = Math.min(1, fogBase + dv * fogDepth);
        }
      }
      const tris = cols * rows * 2;
      const pos = new Float32Array(tris * 3 * 3);
      const col = new Float32Array(tris * 3 * 3);
      let pi = 0, ci = 0;
      const up = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
      const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), D = new THREE.Vector3();
      function emitTri(a, b, cc, fa, fb, fc) {
        e1.subVectors(b, a); e2.subVectors(cc, a);
        up.crossVectors(e1, e2);
        let up_y = up.y; if (up_y < 0) up_y = -up_y;
        const len = up.length() || 1;
        const upDot = up_y / len;
        const verts = [a, b, cc], fogs = [fa, fb, fc];
        for (let k = 0; k < 3; k++) {
          const vv = verts[k];
          pos[pi++] = vv.x; pos[pi++] = vv.y; pos[pi++] = vv.z;
          const wob = vnoise(vv.x * 0.02 + seedOff, vv.z * 0.02 - seedOff);
          shadeVert(vv.y, peakAmp, upDot, wob, fogs[k], _cu);
          col[ci++] = _cu.r; col[ci++] = _cu.g; col[ci++] = _cu.b;
        }
      }
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          A.set(gx[r][c], gy[r][c], gz[r][c]);
          B.set(gx[r][c + 1], gy[r][c + 1], gz[r][c + 1]);
          C.set(gx[r + 1][c], gy[r + 1][c], gz[r + 1][c]);
          D.set(gx[r + 1][c + 1], gy[r + 1][c + 1], gz[r + 1][c + 1]);
          emitTri(A, C, B, gf[r][c], gf[r + 1][c], gf[r][c + 1]);
          emitTri(B, C, D, gf[r][c + 1], gf[r + 1][c], gf[r + 1][c + 1]);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      g.setAttribute("color", new THREE.BufferAttribute(col, 3));
      return g;
    }

    // -- RANGE LAYOUT: ridge spines on the backdrop ring (radius ~1850-2300
    //    around the field centre). Each spine is an arc segment; depthDir
    //    points radially outward. A near foreground ring + a taller, farther
    //    (foggier) backdrop ring give layered depth.
    const RING_SEG = 9;            // arc segments around the ring
    const heroGeoms = [];
    function ringSpines(radius, span, cfg, fogBase, fogDepth) {
      for (let i = 0; i < RING_SEG; i++) {
        const a0 = (i / RING_SEG) * Math.PI * 2;
        const a1 = ((i + span) / RING_SEG) * Math.PI * 2;
        const p0 = { x: CX + Math.cos(a0) * radius, z: CZ + Math.sin(a0) * radius };
        const p1 = { x: CX + Math.cos(a1) * radius, z: CZ + Math.sin(a1) * radius };
        // outward radial direction at the segment midpoint
        const am = (a0 + a1) / 2;
        const dir = { x: Math.cos(am), z: Math.sin(am) };
        const c = Object.assign({}, cfg, {
          seedOff: cfg.seedBase + i * 137.1,
          fogBase: fogBase, fogDepth: fogDepth,
        });
        heroGeoms.push(buildRidge(p0, p1, dir, c));
      }
    }
    // near ring — the dominant craggy peaks
    ringSpines(1900, 1.04, {
      cols: 40, rows: 7, depthLen: 280, peakAmp: 360, noiseScale: 0.0055, seedBase: 1000,
    }, 0.04, 0.10);
    // far ring — taller, pushed out, hazier (recedes into the sky)
    ringSpines(2250, 1.04, {
      cols: 38, rows: 5, depthLen: 360, peakAmp: 470, noiseScale: 0.0045, seedBase: 5000,
    }, 0.22, 0.22);

    const heroMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    function addMergedHero(geoms) {
      if (!geoms.length) return;
      let merged = null;
      if (BGU && BGU.mergeBufferGeometries) merged = BGU.mergeBufferGeometries(geoms);
      if (!merged) {
        // manual Float32 concat fallback (position + color)
        let np = 0, nc = 0;
        for (const g of geoms) { np += g.attributes.position.array.length; nc += g.attributes.color.array.length; }
        const P = new Float32Array(np), Cc = new Float32Array(nc);
        let po = 0, co = 0;
        for (const g of geoms) {
          P.set(g.attributes.position.array, po); po += g.attributes.position.array.length;
          Cc.set(g.attributes.color.array, co); co += g.attributes.color.array.length;
        }
        merged = new THREE.BufferGeometry();
        merged.setAttribute("position", new THREE.BufferAttribute(P, 3));
        merged.setAttribute("color", new THREE.BufferAttribute(Cc, 3));
      }
      merged.computeVertexNormals();             // crisp flat facets w/ flatShading
      const m = new THREE.Mesh(merged, heroMat);
      m.frustumCulled = false; m.castShadow = false; m.receiveShadow = true;
      m.matrixAutoUpdate = false; m.updateMatrix();
      m.userData.terrain = true;
      root.add(m);
      for (const g of geoms) g.dispose();
    }
    addMergedHero(heroGeoms);

    _built = terrain;
    return terrain;
  };
})();
