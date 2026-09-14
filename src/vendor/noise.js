/*
 * A speed-improved perlin and simplex noise algorithms for 2D.
 *
 * Based on example code by Stefan Gustavson (stegu@itn.liu.se).
 * Optimisations by Peter Eastman (peastman@drizzle.stanford.edu).
 * Better rank ordering method by Stefan Gustavson in 2012.
 *
 * Converted to Javascript by Joseph Gentle.
 *
 * Version 2012-03-09
 *
 * This code was placed in the public domain by its original author,
 * Stefan Gustavson. You may use it as you see fit, but
 * attribution is appreciated.
 *
 * Source: https://github.com/josephg/noisejs  (perlin.js) — public domain.
 * Embedded VERBATIM (with the canonical 256-entry Ken Perlin permutation
 * table) so the no-build game can use it via a plain <script>; it attaches
 * to window.noise.
 */

(function(global){
  var module = global.noise = {};

  function Grad(x, y, z) {
    this.x = x; this.y = y; this.z = z;
  }

  Grad.prototype.dot2 = function(x, y) {
    return this.x*x + this.y*y;
  };

  Grad.prototype.dot3 = function(x, y, z) {
    return this.x*x + this.y*y + this.z*z;
  };

  var grad3 = [new Grad(1,1,0),new Grad(-1,1,0),new Grad(1,-1,0),new Grad(-1,-1,0),
               new Grad(1,0,1),new Grad(-1,0,1),new Grad(1,0,-1),new Grad(-1,0,-1),
               new Grad(0,1,1),new Grad(0,-1,1),new Grad(0,1,-1),new Grad(0,-1,-1)];

  var p = [151,160,137,91,90,15,
  131,13,201,95,96,53,194,233,7,225,140,36,103,30,69,142,8,99,37,240,21,10,23,
  190, 6,148,247,120,234,75,0,26,197,62,94,252,219,203,117,35,11,32,57,177,33,
  88,237,149,56,87,174,20,125,136,171,168, 68,175,74,165,71,134,139,48,27,166,
  77,146,158,231,83,111,229,122,60,211,133,230,220,105,92,41,55,46,245,40,244,
  102,143,54, 65,25,63,161, 1,216,80,73,209,76,132,187,208, 89,18,169,200,196,
  135,130,116,188,159,86,164,100,109,198,173,186, 3,64,52,217,226,250,124,123,
  5,202,38,147,118,126,255,82,85,212,207,206,59,227,47,16,58,17,182,189,28,42,
  223,183,170,213,119,248,152, 2,44,154,163, 70,221,153,101,155,167, 43,172,9,
  129,22,39,253, 19,98,108,110,79,113,224,232,178,185, 112,104,218,246,97,228,
  251,34,242,193,238,210,144,12,191,179,162,241, 81,51,145,235,249,14,239,107,
  49,192,214, 31,181,199,106,157,184, 84,204,176,115,121,50,45,127, 4,150,254,
  138,236,205,93,222,114,67,29,24,72,243,141,128,195,78,66,215,61,156,180];
  // To remove the need for index wrapping, double the permutation table length
  var perm = new Array(512);
  var gradP = new Array(512);

  // This isn't a very good seeding function, but it works ok. It supports 2^16
  // different seed values. Write something better if you need more seeds.
  module.seed = function(seed) {
    if(seed > 0 && seed < 1) {
      // Scale the seed out
      seed *= 65536;
    }

    seed = Math.floor(seed);
    if(seed < 256) {
      seed |= seed << 8;
    }

    for(var i = 0; i < 256; i++) {
      var v;
      if (i & 1) {
        v = p[i] ^ (seed & 255);
      } else {
        v = p[i] ^ ((seed>>8) & 255);
      }

      perm[i] = perm[i + 256] = v;
      gradP[i] = gradP[i + 256] = grad3[v % 12];
    }
  };

  module.seed(0);

  /*
  for(var i=0; i<256; i++) {
    perm[i] = perm[i + 256] = p[i];
    gradP[i] = gradP[i + 256] = grad3[perm[i] % 12];
  }*/

  // Skewing and unskewing factors for 2, 3, and 4 dimensions
  var F2 = 0.5*(Math.sqrt(3)-1);
  var G2 = (3-Math.sqrt(3))/6;

  var F3 = 1/3;
  var G3 = 1/6;

  // 2D simplex noise
  module.simplex2 = function(xin, yin) {
    var n0, n1, n2; // Noise contributions from the three corners
    // Skew the input space to determine which simplex cell we're in
    var s = (xin+yin)*F2; // Hairy factor for 2D
    var i = Math.floor(xin+s);
    var j = Math.floor(yin+s);
    var t = (i+j)*G2;
    var x0 = xin-i+t; // The x,y distances from the cell origin, unskewed.
    var y0 = yin-j+t;
    // For the 2D case, the simplex shape is an equilateral triangle.
    // Determine which simplex we are in.
    var i1, j1; // Offsets for second (middle) corner of simplex in (i,j) coords
    if(x0>y0) { // lower triangle, XY order: (0,0)->(1,0)->(1,1)
      i1=1; j1=0;
    } else {    // upper triangle, YX order: (0,0)->(0,1)->(1,1)
      i1=0; j1=1;
    }
    // A step of (1,0) in (i,j) means a step of (1-c,-c) in (x,y), and
    // a step of (0,1) in (i,j) means a step of (-c,1-c) in (x,y), where
    // c = (3-sqrt(3))/6
    var x1 = x0 - i1 + G2; // Offsets for middle corner in (x,y) unskewed coords
    var y1 = y0 - j1 + G2;
    var x2 = x0 - 1 + 2 * G2; // Offsets for last corner in (x,y) unskewed coords
    var y2 = y0 - 1 + 2 * G2;
    // Work out the hashed gradient indices of the three simplex corners
    i &= 255;
    j &= 255;
    var gi0 = gradP[i+perm[j]];
    var gi1 = gradP[i+i1+perm[j+j1]];
    var gi2 = gradP[i+1+perm[j+1]];
    // Calculate the contribution from the three corners
    var t0 = 0.5 - x0*x0-y0*y0;
    if(t0<0) {
      n0 = 0;
    } else {
      t0 *= t0;
      n0 = t0 * t0 * gi0.dot2(x0, y0);  // (x,y) of grad3 used for 2D gradient
    }
    var t1 = 0.5 - x1*x1-y1*y1;
    if(t1<0) {
      n1 = 0;
    } else {
      t1 *= t1;
      n1 = t1 * t1 * gi1.dot2(x1, y1);
    }
    var t2 = 0.5 - x2*x2-y2*y2;
    if(t2<0) {
      n2 = 0;
    } else {
      t2 *= t2;
      n2 = t2 * t2 * gi2.dot2(x2, y2);
    }
    // Add contributions from each corner to get the final noise value.
    // The result is scaled to return values in the interval [-1,1].
    return 70 * (n0 + n1 + n2);
  };

  // 3D simplex noise
  module.simplex3 = function(xin, yin, zin) {
    var n0, n1, n2, n3; // Noise contributions from the four corners

    // Skew the input space to determine which simplex cell we're in
    var s = (xin+yin+zin)*F3; // Hairy factor for 2D
    var i = Math.floor(xin+s);
    var j = Math.floor(yin+s);
    var k = Math.floor(zin+s);

    var t = (i+j+k)*G3;
    var x0 = xin-i+t; // The x,y distances from the cell origin, unskewed.
    var y0 = yin-j+t;
    var z0 = zin-k+t;

    // For the 3D case, the simplex shape is a slightly irregular tetrahedron.
    // Determine which simplex we are in.
    var i1, j1, k1; // Offsets for second corner of simplex in (i,j,k) coords
    var i2, j2, k2; // Offsets for third corner of simplex in (i,j,k) coords
    if(x0 >= y0) {
      if(y0 >= z0)      { i1=1; j1=0; k1=0; i2=1; j2=1; k2=0; }
      else if(x0 >= z0) { i1=1; j1=0; k1=0; i2=1; j2=0; k2=1; }
      else              { i1=0; j1=0; k1=1; i2=1; j2=0; k2=1; }
    } else {
      if(y0 < z0)      { i1=0; j1=0; k1=1; i2=0; j2=1; k2=1; }
      else if(x0 < z0) { i1=0; j1=1; k1=0; i2=0; j2=1; k2=1; }
      else             { i1=0; j1=1; k1=0; i2=1; j2=1; k2=0; }
    }
    // A step of (1,0,0) in (i,j,k) means a step of (1-c,-c,-c) in (x,y,z),
    // a step of (0,1,0) in (i,j,k) means a step of (-c,1-c,-c) in (x,y,z), and
    // a step of (0,0,1) in (i,j,k) means a step of (-c,-c,1-c) in (x,y,z), where
    // c = 1/6.
    var x1 = x0 - i1 + G3; // Offsets for second corner
    var y1 = y0 - j1 + G3;
    var z1 = z0 - k1 + G3;

    var x2 = x0 - i2 + 2 * G3; // Offsets for third corner
    var y2 = y0 - j2 + 2 * G3;
    var z2 = z0 - k2 + 2 * G3;

    var x3 = x0 - 1 + 3 * G3; // Offsets for fourth corner
    var y3 = y0 - 1 + 3 * G3;
    var z3 = z0 - 1 + 3 * G3;

    // Work out the hashed gradient indices of the four simplex corners
    i &= 255;
    j &= 255;
    k &= 255;
    var gi0 = gradP[i+   perm[j+   perm[k   ]]];
    var gi1 = gradP[i+i1+perm[j+j1+perm[k+k1]]];
    var gi2 = gradP[i+i2+perm[j+j2+perm[k+k2]]];
    var gi3 = gradP[i+ 1+perm[j+ 1+perm[k+ 1]]];

    // Calculate the contribution from the four corners
    var t0 = 0.6 - x0*x0 - y0*y0 - z0*z0;
    if(t0<0) {
      n0 = 0;
    } else {
      t0 *= t0;
      n0 = t0 * t0 * gi0.dot3(x0, y0, z0);  // (x,y) of grad3 used for 2D gradient
    }
    var t1 = 0.6 - x1*x1 - y1*y1 - z1*z1;
    if(t1<0) {
      n1 = 0;
    } else {
      t1 *= t1;
      n1 = t1 * t1 * gi1.dot3(x1, y1, z1);
    }
    var t2 = 0.6 - x2*x2 - y2*y2 - z2*z2;
    if(t2<0) {
      n2 = 0;
    } else {
      t2 *= t2;
      n2 = t2 * t2 * gi2.dot3(x2, y2, z2);
    }
    var t3 = 0.6 - x3*x3 - y3*y3 - z3*z3;
    if(t3<0) {
      n3 = 0;
    } else {
      t3 *= t3;
      n3 = t3 * t3 * gi3.dot3(x3, y3, z3);
    }
    // Add contributions from each corner to get the final noise value.
    // The result is scaled to return values in the interval [-1,1].
    return 32 * (n0 + n1 + n2 + n3);

  };

  // ##### Perlin noise stuff

  function fade(t) {
    return t*t*t*(t*(t*6-15)+10);
  }

  function lerp(a, b, t) {
    return (1-t)*a + t*b;
  }

  // 2D Perlin Noise
  module.perlin2 = function(x, y) {
    // Find unit grid cell containing point
    var X = Math.floor(x), Y = Math.floor(y);
    // Get relative xy coordinates of point within that cell
    x = x - X; y = y - Y;
    // Wrap the integer cells at 255 (smaller integer period can be introduced here)
    X = X & 255; Y = Y & 255;

    // Calculate noise contributions from each of the four corners
    var n00 = gradP[X+perm[Y]].dot2(x, y);
    var n01 = gradP[X+perm[Y+1]].dot2(x, y-1);
    var n10 = gradP[X+1+perm[Y]].dot2(x-1, y);
    var n11 = gradP[X+1+perm[Y+1]].dot2(x-1, y-1);

    // Compute the fade curve value for x
    var u = fade(x);

    // Interpolate the four results
    return lerp(
        lerp(n00, n10, u),
        lerp(n01, n11, u),
       fade(y));
  };

  // 3D Perlin Noise
  module.perlin3 = function(x, y, z) {
    // Find unit grid cell containing point
    var X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z);
    // Get relative xyz coordinates of point within that cell
    x = x - X; y = y - Y; z = z - Z;
    // Wrap the integer cells at 255 (smaller integer period can be introduced here)
    X = X & 255; Y = Y & 255; Z = Z & 255;

    // Calculate noise contributions from each of the eight corners
    var n000 = gradP[X+  perm[Y+  perm[Z  ]]].dot3(x,   y,     z);
    var n001 = gradP[X+  perm[Y+  perm[Z+1]]].dot3(x,   y,   z-1);
    var n010 = gradP[X+  perm[Y+1+perm[Z  ]]].dot3(x,   y-1,   z);
    var n011 = gradP[X+  perm[Y+1+perm[Z+1]]].dot3(x,   y-1, z-1);
    var n100 = gradP[X+1+perm[Y+  perm[Z  ]]].dot3(x-1,   y,   z);
    var n101 = gradP[X+1+perm[Y+  perm[Z+1]]].dot3(x-1,   y, z-1);
    var n110 = gradP[X+1+perm[Y+1+perm[Z  ]]].dot3(x-1, y-1,   z);
    var n111 = gradP[X+1+perm[Y+1+perm[Z+1]]].dot3(x-1, y-1, z-1);

    // Compute the fade curve value for x, y, z
    var u = fade(x);
    var v = fade(y);
    var w = fade(z);

    // Interpolate
    return lerp(
        lerp(
          lerp(n000, n100, u),
          lerp(n001, n101, u), w),
        lerp(
          lerp(n010, n110, u),
          lerp(n011, n111, u), w),
       v);
  };

})(typeof window !== "undefined" ? window : (typeof self !== "undefined" ? self : this));

/* ============================================================
   SHARED RIDGED-MOUNTAIN BUILDER — window.noise.buildRidgedRange()

   WHY this lives here (consolidation, not a new system): world/terrain.js
   (the far backdrop "hero peaks") and city/biome_snow.js (the snow biome's
   ringing range) each hand-rolled an IDENTICAL pipeline — seeded value-noise
   -> ridged-fbm -> per-vertex altitude/slope shading -> a displaced grid
   strip emitted as non-indexed flat-shaded triangles. They had drifted apart
   in small but visible ways (snowline 0.48 vs 0.42, slightly different snow-
   wobble amplitude) for no documented reason. This is now the ONE place that
   math lives; both callers pass their own layout/amplitude/seed config and
   get byte-identical noise + shading behaviour. Desert's box-stack mesas are
   a deliberately different aesthetic and do NOT use this (left alone).

   Pure-function core (hash2/vnoise/ridgedFbm) has zero THREE dependency, so
   it's safe to call from anywhere. buildRidge()/buildRidgedRange() need
   THREE (BufferGeometry/Color/Vector3) and no-op (return null) if absent —
   keeps tools/harness.js (headless) safe even if this file is reordered.

   SHARED SNOWLINE: 0.45 of peak height (the terrain.js 0.48 and biome_snow.js
   0.42 values were unexplained drift around the same intent — "snow starts
   a bit below the summit" — so 0.45 is the single reasoned middle, with the
   same +/-0.25-ish wobble amplitude both callers already used).
============================================================ */
(function (global) {
  "use strict";
  const noise = global.noise || (global.noise = {});

  // -- seeded value-noise (hash + smoothstep-lerp), 2-D, deterministic -----
  function hash2(ix, iz) {
    let h = (ix * 374761393 + iz * 668265263) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h = (h ^ (h >>> 16)) >>> 0;
    return h / 4294967296;                   // 0..1
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
  // -- RIDGED fbm: sharp connected ridgelines (5 octaves) -------------------
  function ridgedFbm(x, z) {
    let sum = 0, freq = 1, amp = 0.5, prev = 1;
    for (let o = 0; o < 5; o++) {
      let n = vnoise(x * freq, z * freq);
      n = 1 - Math.abs(2 * n - 1);            // ridge fold
      n = n * n;                              // sharpen
      sum += n * amp * prev;                  // weight by previous octave
      prev = n;
      freq *= 2;                              // lacunarity
      amp *= 0.5;                             // gain
    }
    return sum;                               // ~0..1-ish
  }
  noise.rangeHash2 = hash2;
  noise.rangeVnoise = vnoise;
  noise.rangeRidgedFbm = ridgedFbm;

  // SHARED snowline fraction (see file header WHY) — exported so callers /
  // tooling can read the single source of truth instead of re-typing it.
  const SNOWLINE_FRAC = 0.45;
  const SNOWLINE_WOBBLE = 0.25;
  noise.RANGE_SNOWLINE_FRAC = SNOWLINE_FRAC;

  function shadeVert(palette, y, peakH, upDot, snowWobble, fogT, out) {
    // ragged snowline ~45% of peak height, wobbled by low-freq noise
    const snowline = peakH * (SNOWLINE_FRAC + (snowWobble - 0.5) * SNOWLINE_WOBBLE);
    const above = y > snowline;
    const steep = upDot < 0.52;              // cliff: snow slides off
    if (!above || steep) {
      const dk = steep ? 0.71 : (1 - Math.min(1, y / Math.max(1, snowline))) * 0.5;
      out.copy(palette.rock).lerp(palette.rockDark, dk);
    } else {
      const lit = Math.min(1, Math.max(0, (upDot - 0.55) / 0.45));
      out.copy(palette.snowShade).lerp(palette.snow, lit);
    }
    if (fogT > 0 && palette.fog) out.lerp(palette.fog, fogT);
    return out;
  }
  noise.rangeShadeVert = shadeVert;

  // -- build ONE ridge strip as a non-indexed displaced grid ----------------
  //    p0->p1 = ridge spine; depthDir = unit vector pointing AWAY from the
  //    playable side (the range body extends that way). Returns
  //    { geo, spine:[{x,z,h}] } (spine = crest sample per column, for
  //    colliders). `cfg` fields:
  //      cols, rows, peakAmp, depthLen, seedOff, noiseScale  (required)
  //      footGuard: 0..1 fraction of rows over which height ramps from 0 at
  //                 the near edge (valley/flat-floor guard) — omit/0 to skip.
  //      fogBase, fogDepth: baked distance-haze lerp (0 = none)
  //      palette: {rock,rockDark,snow,snowShade,fog?} THREE.Color instances
  function buildRidge(THREE, p0, p1, depthDir, cfg) {
    if (!THREE) return null;
    const cols = cfg.cols, rows = cfg.rows;
    const peakAmp = cfg.peakAmp, depthLen = cfg.depthLen;
    const seedOff = cfg.seedOff, noiseScale = cfg.noiseScale;
    const fogBase = cfg.fogBase || 0, fogDepth = cfg.fogDepth || 0;
    const footGuard = cfg.footGuard || 0;          // e.g. 0.18 or 0.28
    const dx = p1.x - p0.x, dz = p1.z - p0.z;
    const gx = [], gz = [], gy = [], gf = [];
    for (let r = 0; r <= rows; r++) {
      const dv = r / rows;                          // 0 at spine edge .. 1 deep
      gx[r] = []; gz[r] = []; gy[r] = []; gf[r] = [];
      for (let c = 0; c <= cols; c++) {
        const t = c / cols;
        const bx = p0.x + dx * t + depthDir.x * (dv * depthLen);
        const bz = p0.z + dz * t + depthDir.z * (dv * depthLen);
        const nx = (bx + seedOff) * noiseScale;
        const nz = (bz - seedOff) * noiseScale;
        let h = ridgedFbm(nx, nz) * peakAmp;
        // low-freq envelope along the ridge: tall peaks + saddles
        const env = 0.45 + 0.55 * vnoise(t * 3.3 + seedOff * 0.01, seedOff * 0.02);
        h *= env;
        // depth TENT: crest near mid-depth, falls off front & back
        const tent = Math.sin(Math.min(1, dv * 1.15) * Math.PI);
        h *= 0.25 + 0.75 * tent;
        if (footGuard > 0) {
          // guard: force y->0 at the near edge (flat floor / taper to ground)
          const guard = Math.min(1, dv / footGuard);
          h *= guard * guard;
        }
        gx[r][c] = bx; gz[r][c] = bz; gy[r][c] = h;
        gf[r][c] = Math.min(1, fogBase + dv * fogDepth);
      }
    }
    // record spine (crest) heights along the ridge for colliders: max height
    // across depth at each column.
    const spine = [];
    for (let c = 0; c <= cols; c++) {
      let mh = 0, mr = 1;
      for (let r = 1; r <= rows; r++) if (gy[r][c] > mh) { mh = gy[r][c]; mr = r; }
      spine.push({ x: gx[mr][c], z: gz[mr][c], h: mh });
    }
    const tris = cols * rows * 2;
    const pos = new Float32Array(tris * 3 * 3);
    const col = new Float32Array(tris * 3 * 3);
    let pi = 0, ci = 0;
    const up = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
    const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), D = new THREE.Vector3();
    const _cu = new THREE.Color();
    const palette = cfg.palette;
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
        shadeVert(palette, vv.y, peakAmp, upDot, wob, fogs[k], _cu);
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
    return { geo: g, spine: spine };
  }
  noise.buildRidgedRange = buildRidge;
})(typeof window !== "undefined" ? window : (typeof self !== "undefined" ? self : this));
