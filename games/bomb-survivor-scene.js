/* ============================================================
   games/bomb-survivor-scene.js  (BombScene)

   The look of Bomb Survivor's harbour city at war, in one install():

     1. THE SEA. One draw call. A flat camera-following grid shaded per pixel:
        a generated, tileable slope map (mipmapped, so it cannot shimmer from
        640 m up) sampled at four scales, a Fresnel mix between the water body
        and the SAME sky gradient the dome draws (its uniforms are shared by
        reference, so a sky change moves the reflection with it), a low warm
        sun glitter path, building shadows, a shallow tint and a surf line
        computed from an exact box SDF against every land rect, and the
        scene fog so the horizon melts into the haze.
     2. THE SHORE. Every land rect gets a dressed-granite seawall from the
        deck down to y = -3 with a wet band and algae line, a coping lip, and
        either cast-iron bollards and ladders (a quay) or rip-rap (the base,
        the causeways, the field). Edges that meet another rect are cut, so
        the causeway runs straight onto the island instead of through a wall.
        The town's harbour apron (granite setts, kerb flags) rings its pad.
        Every surface here is a SURFACES kind (see below), not a flat colour.
     5. THE FLAK KIT. The 40 mm twin mount, its sandbag pit and its ready
        ammunition, shared by every gun on the page (BombScene.flakKit).
     3. THE GRADE. Late afternoon over a burning city: a low warm sun, a dusty
        horizon, fog matched to it. microboot re-asserts its BOOT light values
        every frame at CBZ.onAlways(9); this file re-asserts OURS at 9.5, so
        the grade holds and anything that multiplies later still composes.
        The sun keeps following the camera (microboot's hook at -100 moves it,
        ours at -99 re-aims it at the low angle), so shadows keep working.
     4. THE SMOKE. One instanced draw, premultiplied alpha, so black smoke and
        additive fire / flash / tracers share a pass. Puffs are fake-lit
        spheres (sun side bright, underside dark) over a noisy generated puff
        texture that turns as it grows. Pooled and capped: nothing allocates
        after install.

   window.BombScene.install(opts) -> { update(dt), fx, sea }
   ============================================================ */
(function () {
  "use strict";

  const MAX_RECTS = 8;
  const MAXP = 3072;          // every particle, all kinds, hard cap
  const MAX_PLUMES = 24;
  const MAX_TRAILS = 12;

  // ------------------------------------------------------------ tiny helpers
  function rngFrom(CBZ, name) {
    if (CBZ && CBZ.seedStream) return CBZ.seedStream(name);
    let a = 0x9e3779b9 ^ name.length * 7919;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hexRGB(h, out) {
    out[0] = ((h >> 16) & 255) / 255; out[1] = ((h >> 8) & 255) / 255; out[2] = (h & 255) / 255;
    return out;
  }

  // ------------------------------------------------ generated textures
  /* Sea slope map: a periodic height field built from integer wave numbers,
     so it tiles exactly. Wind-aligned spectrum (energy along +X, falls off
     with |k|^-1.7). Separable sin/cos tables make 256x256 x 40 waves cheap.
     RG = slope (0.5 = flat, scaled so rms slope is about 0.25), B = unused,
     A = normalised height (used for foam breakup and slicks). */
  function makeSeaTexture(THREE, rng) {
    const N = 256, TAU = Math.PI * 2;
    const hx = new Float32Array(N * N), dx = new Float32Array(N * N), dz = new Float32Array(N * N);
    const sx = new Float32Array(N), cx = new Float32Array(N), sy = new Float32Array(N), cy = new Float32Array(N);
    let made = 0, guard = 0;
    while (made < 40 && guard++ < 4000) {
      const kx = Math.round((rng() * 2 - 1) * 22), ky = Math.round((rng() * 2 - 1) * 22);
      const km = Math.sqrt(kx * kx + ky * ky);
      if (km < 1.5) continue;
      const align = Math.abs(kx) / km;                    // wind along X
      if (rng() > 0.25 + 0.75 * align * align) continue;
      const amp = Math.pow(km, -1.7) * (0.6 + 0.4 * rng());
      const ph = rng() * TAU;
      for (let i = 0; i < N; i++) {
        const a = TAU * kx * i / N + ph, b = TAU * ky * i / N;
        sx[i] = Math.sin(a); cx[i] = Math.cos(a); sy[i] = Math.sin(b); cy[i] = Math.cos(b);
      }
      const gx = amp * TAU * kx, gz = amp * TAU * ky;
      for (let y = 0; y < N; y++) {
        const syy = sy[y], cyy = cy[y], row = y * N;
        for (let x = 0; x < N; x++) {
          const s = sx[x] * cyy + cx[x] * syy;             // sin(a+b)
          const c = cx[x] * cyy - sx[x] * syy;             // cos(a+b)
          const k = row + x;
          hx[k] += amp * s; dx[k] += gx * c; dz[k] += gz * c;
        }
      }
      made++;
    }
    let ss = 0, hmin = 1e9, hmax = -1e9;
    for (let k = 0; k < N * N; k++) {
      ss += dx[k] * dx[k] + dz[k] * dz[k];
      if (hx[k] < hmin) hmin = hx[k];
      if (hx[k] > hmax) hmax = hx[k];
    }
    const rms = Math.sqrt(ss / (N * N * 2)) || 1;
    const sc = 0.25 / rms, hr = 1 / Math.max(1e-6, hmax - hmin);
    const data = new Uint8Array(N * N * 4);
    for (let k = 0; k < N * N; k++) {
      const u = Math.max(-1, Math.min(1, dx[k] * sc)), v = Math.max(-1, Math.min(1, dz[k] * sc));
      data[k * 4] = Math.round((u * 0.5 + 0.5) * 255);
      data[k * 4 + 1] = Math.round((v * 0.5 + 0.5) * 255);
      data[k * 4 + 2] = 128;
      data[k * 4 + 3] = Math.round((hx[k] - hmin) * hr * 255);
    }
    const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.needsUpdate = true;
    return t;
  }

  /* Puff texture: R = density (lumpy value-noise fbm under a soft radial
     falloff, exactly zero at the border so rotated UVs clamp to nothing),
     G = a second independent lump pattern used to churn the puff as it ages. */
  function makePuffTexture(THREE, rng) {
    const N = 128, G = 16;
    function lattice() {
      const L = new Float32Array(G * G);
      for (let i = 0; i < L.length; i++) L[i] = rng();
      return L;
    }
    const L1 = lattice(), L2 = lattice();
    function vnoise(L, x, y) {          // periodic value noise, x,y in lattice units
      const xi = Math.floor(x), yi = Math.floor(y);
      const fx = x - xi, fy = y - yi;
      const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
      const x0 = ((xi % G) + G) % G, y0 = ((yi % G) + G) % G;
      const x1 = (x0 + 1) % G, y1 = (y0 + 1) % G;
      const a = L[y0 * G + x0], b = L[y0 * G + x1], c = L[y1 * G + x0], d = L[y1 * G + x1];
      return (a + (b - a) * ux) + ((c + (d - c) * ux) - (a + (b - a) * ux)) * uy;
    }
    function fbm(L, x, y) {
      return vnoise(L, x * 4, y * 4) * 0.5 + vnoise(L, x * 8, y * 8) * 0.28 + vnoise(L, x * 16, y * 16) * 0.14 + vnoise(L, x * 32, y * 32) * 0.08;
    }
    const data = new Uint8Array(N * N * 4);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const u = (x + 0.5) / N, v = (y + 0.5) / N;
      const r = Math.sqrt((u - 0.5) * (u - 0.5) + (v - 0.5) * (v - 0.5)) / 0.5;
      const n1 = fbm(L1, u, v), n2 = fbm(L2, u + 0.37, v + 0.61);
      let fall = 1 - Math.min(1, Math.max(0, (r - 0.25) / 0.72));
      fall = fall * fall * (3 - 2 * fall);
      // lumps push the silhouette out, so the edge is billowy, not a circle
      let d = fall * (0.35 + 1.05 * n1) - (1 - fall) * 0.25;
      d = Math.max(0, Math.min(1, d * 1.15));
      if (x < 2 || y < 2 || x > N - 3 || y > N - 3) d = 0;
      const k = (y * N + x) * 4;
      data[k] = Math.round(d * 255);
      data[k + 1] = Math.round(Math.max(0, Math.min(1, n2 * 1.3 - 0.15)) * 255);
      data[k + 2] = 0;
      data[k + 3] = 255;
    }
    const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.needsUpdate = true;
    return t;
  }

  // ============================================================ SURFACES
  /* What things are MADE of. Same technique as world/prisonlook.js (the brick
     the owner signed off on): analytic, world-space, no UVs, patched into the
     stock MeshStandardMaterial with onBeforeCompile. Unlike prisonlook this
     one also bends the NORMAL (a height field sampled three times per pixel),
     so a joint is a recess the low sun actually rakes across, not a painted
     line. Detail fades with distance so nothing shimmers from 600 m up.

       QUAY   dressed granite ashlar on the seawalls, coping slabs on top,
              rain streaks, a wet band that shines, algae below the tide line
       SETTS  granite setts in running bond on the harbour apron, big kerb
              flags along the coping, oil stains, standing puddles
       ROCK   rip-rap: speckled granite, lichen on the dry tops, wet and green
              where the sea reaches
       PAINT  olive drab on steel, mottled and chipped to bare metal at edges
              (OBJECT space: a gun that slews carries its chips with it)
       IRON   cast-iron bollards and ladders: black paint, the cap polished by
              rope, rust bleeding at the foot
       WOOD   painted plank boxes, grain and board seams                     */
  const K = { QUAY: 1, SETTS: 3, ROCK: 4, PAINT: 5, IRON: 6, WOOD: 7 };
  const SURF_U = {
    bsSeaY: { value: -0.4 },
    bsRect: { value: null },          // apron: centre xz, half extents
  };
  const SURF_VP = "varying vec3 bsW;\nvarying vec3 bsNw;\nvarying vec3 bsL;\nvarying vec3 bsLN;\n";
  const SURF_VM =
    "{\n  vec4 bsP = vec4( transformed, 1.0 );\n" +
    "  #ifdef USE_INSTANCING\n  bsP = instanceMatrix * bsP;\n  #endif\n" +
    "  bsW = ( modelMatrix * bsP ).xyz;\n" +
    "  bsNw = normalize( ( vec4( transformedNormal, 0.0 ) * viewMatrix ).xyz );\n" +
    "  bsL = transformed; bsLN = objectNormal;\n}\n";
  const SURF_FP = [
    "varying vec3 bsW;", "varying vec3 bsNw;", "varying vec3 bsL;", "varying vec3 bsLN;",
    "uniform float bsSeaY;", "uniform vec4 bsRect;",
    "float bsH( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }",
    "float bsN( vec2 p ) { vec2 i = floor( p ), f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );",
    "  return mix( mix( bsH( i ), bsH( i + vec2( 1.0, 0.0 ) ), f.x ), mix( bsH( i + vec2( 0.0, 1.0 ) ), bsH( i + vec2( 1.0, 1.0 ) ), f.x ), f.y ); }",
    "float bsF( vec2 p ) { return bsN( p ) * 0.5 + bsN( p * 2.03 + 3.1 ) * 0.3 + bsN( p * 4.11 + 7.7 ) * 0.2; }",
    // running bond: x = distance to the nearest joint, y = the unit's own hash
    "vec2 bsBond( vec2 uv, vec2 sz, float stag ) {",
    "  float row = floor( uv.y / sz.y );",
    "  float x = uv.x / sz.x + stag * mod( row, 2.0 );",
    "  vec2 f = vec2( fract( x ) * sz.x, fract( uv.y / sz.y ) * sz.y );",
    "  return vec2( min( min( f.x, sz.x - f.x ), min( f.y, sz.y - f.y ) ), bsH( vec2( floor( x ), row ) ) );",
    "}",
    "float bsEdge() { return min( bsRect.z - abs( bsW.x - bsRect.x ), bsRect.w - abs( bsW.z - bsRect.y ) ); }",
    // the height field each kind is carved by (0 = bottom of a joint, 1 = face)
    "float bsHeight( vec2 uv, float up ) {",
    "  #if BS_KIND == 1",
    "  if ( up > 0.5 ) return smoothstep( 0.0, 0.012, bsBond( uv, vec2( 1.25, 0.9 ), 0.0 ).x );",
    "  vec2 b = bsBond( uv, vec2( 1.15, 0.46 ), 0.5 );",
    "  return smoothstep( 0.0, 0.035, b.x ) * ( 0.8 + 0.2 * bsN( uv * 7.0 + b.y * 13.0 ) );",   // rock-faced
    "  #elif BS_KIND == 3",
    "  if ( bsEdge() < 1.4 ) return smoothstep( 0.0, 0.01, bsBond( uv, vec2( 1.0, 0.7 ), 0.5 ).x );",
    "  vec2 b = bsBond( uv, vec2( 0.21, 0.11 ), 0.5 );",
    "  return smoothstep( 0.0, 0.03, b.x ) * ( 0.85 + 0.15 * bsH( vec2( b.y, 1.7 ) ) );",           // domed, uneven
    "  #elif BS_KIND == 4",
    "  return bsN( uv * 5.0 ) * 0.6 + bsN( uv * 15.0 ) * 0.4;",
    "  #else",
    "  return 0.0;",
    "  #endif",
    "}",
  ].join("\n") + "\n";

  const SURF_FM = [
    "{",
    "  vec3 bsN0 = normalize( bsNw );",
    "  #if BS_KIND >= 5",
    "  vec3 bsP = bsL; vec3 bsA = abs( normalize( bsLN ) );",
    "  #else",
    "  vec3 bsP = bsW; vec3 bsA = abs( bsN0 );",
    "  #endif",
    "  float bsUp = step( bsA.x, bsA.y ) * step( bsA.z, bsA.y );",
    "  bool bsXf = bsA.x > bsA.z;",
    "  vec2 uv = bsUp > 0.5 ? bsP.xz : ( bsXf ? bsP.zy : bsP.xy );",
    "  float bsD = length( bsW - cameraPosition );",
    "  float bsFar = 1.0 - smoothstep( 25.0, 140.0, bsD );",     // joints and relief
    "  float bsFine = 1.0 - smoothstep( 6.0, 40.0, bsD );",      // grain
    "  float shade = 1.0; float wet = 0.0; float relief = 0.0;",
    "  float h = bsHeight( uv, bsUp );",
    "  float sy = bsW.y - bsSeaY;",
    // ------------------------------------------------ QUAY
    "  #if BS_KIND == 1",
    "  if ( bsUp > 0.5 ) {",
    "    vec2 b = bsBond( uv, vec2( 1.25, 0.9 ), 0.0 );",
    "    shade *= 1.0 + ( b.y - 0.5 ) * 0.14;",
    "    shade *= mix( 0.93, mix( 0.6, 1.0, h ), bsFar );",
    "    shade *= 1.0 - 0.18 * smoothstep( 0.6, 0.85, bsF( uv * 0.7 ) );",          // lichen / salt blotches
    "    relief = 0.01;",
    "  } else {",
    "    vec2 b = bsBond( uv, vec2( 1.15, 0.46 ), 0.5 );",
    "    shade *= 1.0 + ( b.y - 0.5 ) * 0.2;",
    "    shade *= mix( 0.9, mix( 0.5, 1.0, h ), bsFar );",
    "    shade *= 1.0 - 0.16 * smoothstep( 0.5, 0.9, bsN( vec2( uv.x * 2.2, uv.y * 0.18 ) ) ) * step( 0.6, sy );",   // rain streaks
    "    wet = 1.0 - smoothstep( 0.45, 0.85, sy + ( bsN( vec2( uv.x * 1.3, 0.0 ) ) - 0.5 ) * 0.35 );",
    "    relief = 0.018;",
    "  }",
    "  shade *= mix( 1.0, 0.9 + 0.2 * bsH( floor( uv * 70.0 ) ), bsFine );",          // granite grain
    // ------------------------------------------------ SETTS
    "  #elif BS_KIND == 3",
    "  float e = bsEdge();",
    "  vec2 b = e < 1.4 ? bsBond( uv, vec2( 1.0, 0.7 ), 0.5 ) : bsBond( uv, vec2( 0.21, 0.11 ), 0.5 );",
    "  shade *= 1.0 + ( b.y - 0.5 ) * ( e < 1.4 ? 0.12 : 0.3 );",
    "  diffuseColor.rgb *= mix( vec3( 1.04, 0.97, 0.9 ), vec3( 0.93, 0.97, 1.03 ), bsH( vec2( b.y, 9.1 ) ) );",
    "  shade *= mix( 0.86, mix( 0.42, 1.0, h ), bsFar );",
    "  shade *= 1.0 - 0.3 * smoothstep( 0.58, 0.86, bsF( bsW.xz * 0.07 ) );",        // oil and soot
    "  shade *= 1.0 - 0.12 * ( 1.0 - smoothstep( 0.0, 3.0, e ) );",                  // spray darkens the edge
    "  shade *= mix( 1.0, 0.9 + 0.2 * bsH( floor( uv * 90.0 ) ), bsFine );",
    "  wet = smoothstep( 0.69, 0.73, bsF( bsW.xz * 0.045 + 11.0 ) );",              // standing water
    "  relief = 0.02 * ( 1.0 - wet );",
    // ------------------------------------------------ ROCK
    "  #elif BS_KIND == 4",
    "  shade *= 0.8 + 0.4 * bsF( uv * 1.7 );",
    "  shade *= mix( 1.0, 0.85 + 0.3 * bsH( floor( uv * 40.0 ) ), bsFine );",
    "  float lich = step( 0.45, bsN0.y ) * smoothstep( 0.7, 1.2, sy ) * smoothstep( 0.55, 0.75, bsF( uv * 2.3 + 5.0 ) );",
    "  diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.55, 0.52, 0.36 ), lich * 0.6 );",
    "  wet = 1.0 - smoothstep( 0.35, 0.75, sy );",
    "  diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.07, 0.1, 0.07 ), 1.0 - smoothstep( -0.1, 0.25, sy ) );",
    "  relief = 0.03;",
    // ------------------------------------------------ PAINT
    "  #elif BS_KIND == 5",
    "  shade *= 0.9 + 0.18 * bsF( uv * 2.5 );",
    "  float chip = smoothstep( 0.66, 0.7, bsF( uv * 11.0 + 3.0 ) ) * smoothstep( 0.3, 0.7, bsN( uv * 1.3 ) );",
    "  diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.16, 0.15, 0.14 ), chip );",
    "  float rust = smoothstep( 0.72, 0.8, bsF( uv * 5.0 + 9.0 ) ) * ( 1.0 - chip );",
    "  diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.3, 0.17, 0.09 ), rust * 0.35 );",
    "  roughnessFactor = mix( roughnessFactor, 0.45, chip );",
    // ------------------------------------------------ IRON
    "  #elif BS_KIND == 6",
    "  shade *= 0.85 + 0.3 * bsF( uv * 6.0 );",
    "  float worn = step( 0.6, bsLN.y ) * smoothstep( 0.55, 0.7, bsL.y ) * smoothstep( 0.4, 0.7, bsF( uv * 4.0 ) );",
    "  diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.32, 0.3, 0.28 ), worn );",
    "  roughnessFactor = mix( roughnessFactor, 0.3, worn );",
    "  float foot = ( 1.0 - smoothstep( 0.02, 0.2, bsL.y ) ) * smoothstep( 0.35, 0.65, bsF( uv * 8.0 ) );",
    "  diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.34, 0.16, 0.06 ), foot );",
    // ------------------------------------------------ WOOD
    "  #elif BS_KIND == 7",
    "  float board = floor( bsP.y / 0.105 );",
    "  shade *= 0.82 + 0.3 * bsN( vec2( bsP.x * 1.4 + bsP.z * 1.4, bsP.y * 55.0 + board * 7.0 ) );",
    "  shade *= 1.0 - 0.45 * ( 1.0 - smoothstep( 0.0, 0.006, min( fract( bsP.y / 0.105 ), 1.0 - fract( bsP.y / 0.105 ) ) * 0.105 ) ) * ( 1.0 - bsUp );",
    "  shade *= 1.0 + ( bsH( vec2( board, 2.0 ) ) - 0.5 ) * 0.15;",
    "  #endif",
    "  diffuseColor.rgb *= shade * mix( 1.0, 0.72, wet );",
    "  roughnessFactor = mix( roughnessFactor, 0.12, wet );",
    // bend the normal: finite differences of the height field along the face
    "  #if BS_KIND < 5",
    "  if ( relief > 0.0 && bsFar > 0.0 ) {",
    "    float ep = 0.006;",
    "    float gx = ( bsHeight( uv + vec2( ep, 0.0 ), bsUp ) - h ) / ep;",
    "    float gy = ( bsHeight( uv + vec2( 0.0, ep ), bsUp ) - h ) / ep;",
    "    vec3 T = bsUp > 0.5 ? vec3( 1.0, 0.0, 0.0 ) : ( bsXf ? vec3( 0.0, 0.0, 1.0 ) : vec3( 1.0, 0.0, 0.0 ) );",
    "    vec3 B = bsUp > 0.5 ? vec3( 0.0, 0.0, 1.0 ) : vec3( 0.0, 1.0, 0.0 );",
    "    vec3 Np = normalize( bsN0 - ( gx * T + gy * B ) * relief * bsFar );",
    "    normal = normalize( ( viewMatrix * vec4( Np, 0.0 ) ).xyz );",
    "  }",
    "  #endif",
    "}",
  ].join("\n") + "\n";

  // a MeshStandardMaterial that knows what it is made of
  function surfaceMat(THREE, kind, o) {
    if (!SURF_U.bsRect.value) SURF_U.bsRect.value = new THREE.Vector4(0, 0, 1e6, 1e6);
    const m = new THREE.MeshStandardMaterial(Object.assign({ roughness: 0.85, metalness: 0 }, o || {}));
    m.onBeforeCompile = function (sh) {
      for (const k in SURF_U) sh.uniforms[k] = SURF_U[k];
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\n" + SURF_VP)
        .replace("#include <project_vertex>", "#include <project_vertex>\n" + SURF_VM);
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", "#include <common>\n#define BS_KIND " + kind + "\n" + SURF_FP)
        .replace("#include <normal_fragment_maps>", "#include <normal_fragment_maps>\n" + SURF_FM);
    };
    m.customProgramCacheKey = function () { return "bombsurf-v1-" + kind; };
    return m;
  }

  // position + normal only, non-indexed: every builder here feeds this
  function mergeGeos(THREE, list) {
    let n = 0;
    const parts = list.map(function (g) {
      const u = g.index ? g.toNonIndexed() : g;
      if (!u.attributes.normal) u.computeVertexNormals();
      n += u.attributes.position.count;
      return u;
    });
    const P = new Float32Array(n * 3), N = new Float32Array(n * 3);
    let o = 0;
    for (let i = 0; i < parts.length; i++) {
      P.set(parts[i].attributes.position.array, o);
      N.set(parts[i].attributes.normal.array, o);
      o += parts[i].attributes.position.array.length;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(P, 3));
    g.setAttribute("normal", new THREE.BufferAttribute(N, 3));
    g.computeBoundingSphere();
    return g;
  }

  // ================================================================ THE SEA
  const SEA_VERT = [
    "#include <common>",
    "#include <fog_pars_vertex>",
    "#include <shadowmap_pars_vertex>",
    "varying vec3 vW;",
    "void main() {",
    "  #include <beginnormal_vertex>",
    "  #include <defaultnormal_vertex>",
    "  #include <begin_vertex>",
    "  #include <project_vertex>",
    "  #include <worldpos_vertex>",
    "  #include <shadowmap_vertex>",
    "  #include <fog_vertex>",
    "  vW = (modelMatrix * vec4(position, 1.0)).xyz;",
    "}",
  ].join("\n");

  const SEA_FRAG = [
    "#include <common>",
    "#include <packing>",
    "#include <fog_pars_fragment>",
    "#include <bsdfs>",
    "#include <lights_pars_begin>",
    "#include <shadowmap_pars_fragment>",
    "#include <shadowmask_pars_fragment>",
    "uniform sampler2D uNorm;",
    "uniform float uTime;",
    "uniform vec3 uSkyTop;",
    "uniform vec3 uSkyBot;",
    "uniform float uSkyExp;",
    "uniform vec3 uSunDir;",
    "uniform vec3 uSunCol;",
    "uniform vec3 uDeep;",
    "uniform vec3 uScatter;",
    "uniform vec3 uShallow;",
    "uniform vec3 uFoamCol;",
    "uniform float uWave;",
    "uniform float uFoam;",
    "uniform vec4 uRects[" + MAX_RECTS + "];",
    "uniform float uRectShallow[" + MAX_RECTS + "];",
    "uniform float uRectFoam[" + MAX_RECTS + "];",
    "varying vec3 vW;",
    "vec2 slopeAt(vec2 uv) { return texture2D(uNorm, uv).xy * 2.0 - 1.0; }",
    "void main() {",
    "  vec3 toCam = cameraPosition - vW;",
    "  float dist = length(toCam);",
    "  vec3 V = toCam / max(dist, 0.001);",
    "  vec2 p = vW.xz;",
    "  float t = uTime;",
    // land SDF: nearest rect, and that rect's shallow / foam widths
    "  float sd = 100000.0; float sw = 20.0; float fw = 3.0;",
    "  for (int i = 0; i < " + MAX_RECTS + "; i++) {",
    "    vec4 r = uRects[i];",
    "    vec2 q = abs(p - r.xy) - r.zw;",
    "    float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);",
    "    if (d < sd) { sd = d; sw = uRectShallow[i]; fw = uRectFoam[i]; }",
    "  }",
    "  float off = max(sd, 0.0);",
    // slopes at four scales; two are rotated to break the tile, rotated back
    "  vec2 u2 = vec2(0.8 * p.x - 0.6 * p.y, 0.6 * p.x + 0.8 * p.y);",
    "  vec2 u3 = vec2(0.94 * p.x + 0.34 * p.y, -0.34 * p.x + 0.94 * p.y);",
    "  vec2 sA = slopeAt(p * 0.0062 + vec2(t * 0.0021, t * 0.0007));",           // ~160 m swell
    "  vec2 sB = slopeAt(p * 0.026 + vec2(t * 0.0105, -t * 0.0031));",           // ~38 m
    "  vec2 sC = slopeAt(u2 * 0.083 + vec2(-t * 0.021, t * 0.012));",            // ~12 m chop
    "  vec2 sD = slopeAt(u3 * 0.29 + vec2(t * 0.043, t * 0.029));",              // ~3.5 m ripples
    "  sC = vec2(0.8 * sC.x + 0.6 * sC.y, -0.6 * sC.x + 0.8 * sC.y);",
    "  sD = vec2(0.94 * sD.x - 0.34 * sD.y, 0.34 * sD.x + 0.94 * sD.y);",
    // wind slicks: a very slow, very large modulation of roughness
    "  float slick = texture2D(uNorm, p * 0.0011 + vec2(t * 0.0004, 0.0)).a;",
    "  float rough = mix(0.55, 1.2, smoothstep(0.25, 0.75, slick));",
    // distance fade per octave: the fine ones go first, no shimmer from altitude
    "  float fC = 1.0 - smoothstep(120.0, 900.0, dist);",
    "  float fD = 1.0 - smoothstep(25.0, 260.0, dist);",
    "  float fAll = 1.0 / (1.0 + dist * 0.00035);",
    "  float calm = mix(0.55, 1.0, smoothstep(0.0, 30.0, off));",                 // water flattens in the lee of a wall
    "  vec2 s = (sA * 0.85 + sB * 0.6 + sC * 0.5 * fC + sD * 0.35 * fD) * uWave * rough * fAll * calm;",
    "  vec3 N = normalize(vec3(-s.x, 1.0, -s.y));",
    // light
    "  vec3 L = normalize(uSunDir);",
    "  float shadow = getShadowMask();",
    "  float cosT = clamp(dot(N, V), 0.0, 1.0);",
    "  float F = 0.02 + 0.98 * pow(1.0 - cosT, 5.0);",
    "  vec3 R = reflect(-V, N);",
    "  R.y = abs(R.y);",
    "  vec3 sky = mix(uSkyBot, uSkyTop, pow(R.y, uSkyExp));",
    // water body: deep colour, lifted by light scattered up through wave faces
    "  float sunUp = clamp(L.y, 0.0, 1.0);",
    "  float scat = pow(clamp(dot(N, L) * 0.5 + 0.5, 0.0, 1.0), 3.0);",
    "  vec3 body = uDeep * (0.7 + 0.5 * sunUp) + uScatter * scat * 0.35;",
    "  float shallow = exp(-off / max(sw, 0.5));",
    "  body = mix(body, uShallow, shallow * 0.8);",
    "  body *= mix(0.62, 1.0, shadow);",
    "  vec3 col = mix(body, sky, F * mix(0.85, 1.0, shadow));",
    // sun: tight glitter plus a broad sheen, both shadowed
    "  float rl = max(dot(R, L), 0.0);",
    "  float spec = pow(rl, 900.0) * 7.0 + pow(rl, 90.0) * 0.35 + pow(rl, 12.0) * 0.05;",
    "  col += uSunCol * spec * shadow * mix(0.35, 1.0, fAll);",
    // surf: a white edge at the wall and broken bands washing in
    "  float fwid = fw + dist * 0.004;",
    "  float h1 = texture2D(uNorm, p * 0.045 + vec2(t * 0.006, t * 0.004)).a;",
    "  float h2 = texture2D(uNorm, u2 * 0.12 - vec2(t * 0.01, 0.0)).a;",
    "  float edge = 1.0 - smoothstep(0.0, fwid, off + (h1 - 0.5) * fw);",
    "  float wash = 0.5 + 0.5 * sin(t * 0.9 - off * 0.45 + h1 * 5.0);",
    "  float band = (1.0 - smoothstep(fwid, fwid * 5.0 + 6.0, off)) * smoothstep(0.62, 0.95, wash * 0.55 + h2 * 0.6);",
    "  float foam = clamp(edge * (0.55 + 0.45 * h2) + band * 0.5, 0.0, 1.0) * uFoam;",
    "  vec3 foamC = uFoamCol * (0.55 + 0.45 * max(dot(N, L), 0.0)) * mix(0.6, 1.0, shadow);",
    "  col = mix(col, foamC, foam);",
    "  gl_FragColor = vec4(col, 1.0);",
    "  #include <fog_fragment>",
    "}",
  ].join("\n");

  function buildSea(THREE, ctx) {
    const uni = THREE.UniformsUtils.merge([THREE.UniformsLib.lights, THREE.UniformsLib.fog]);
    const rects = [], shal = [], foamW = [];
    for (let i = 0; i < MAX_RECTS; i++) {
      rects.push(new THREE.Vector4(1e6, 1e6, 0.5, 0.5)); shal.push(1); foamW.push(1);
    }
    // assigned AFTER merge: merge clones, and the sky colours must stay shared
    uni.uNorm = { value: ctx.seaTex };
    uni.uTime = { value: 0 };
    uni.uSkyTop = { value: ctx.skyTop };
    uni.uSkyBot = { value: ctx.skyBot };
    uni.uSkyExp = ctx.skyExp;
    uni.uSunDir = { value: ctx.sunDir };
    uni.uSunCol = { value: new THREE.Color(0xffd9ae) };
    uni.uDeep = { value: new THREE.Color(0x173746) };
    uni.uScatter = { value: new THREE.Color(0x2f7470) };
    uni.uShallow = { value: new THREE.Color(0x3c6c69) };
    uni.uFoamCol = { value: new THREE.Color(0xe9ece9) };
    uni.uWave = { value: 1.0 };
    uni.uFoam = { value: 1.0 };
    uni.uRects = { value: rects };
    uni.uRectShallow = { value: shal };
    uni.uRectFoam = { value: foamW };

    const mat = new THREE.ShaderMaterial({
      uniforms: uni, vertexShader: SEA_VERT, fragmentShader: SEA_FRAG,
      lights: true, fog: true,
      polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 4,  // land wins every depth tie
    });
    mat.toneMapped = false;          // authored in display space, like the sky dome it reflects
    const geo = new THREE.PlaneGeometry(32000, 32000, 16, 16);
    geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = ctx.seaY;
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.frustumCulled = false;
    mesh.name = "bombSea";
    mesh.userData.terrain = true;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();

    function setLands(lands) {
      for (let i = 0; i < MAX_RECTS; i++) {
        const r = lands[i];
        if (!r) { rects[i].set(1e6, 1e6, 0.5, 0.5); continue; }
        rects[i].set((r.minX + r.maxX) / 2, (r.minZ + r.maxZ) / 2, (r.maxX - r.minX) / 2, (r.maxZ - r.minZ) / 2);
        const soft = r.kind === "base" || r.kind === "port" || r.kind === "causeway";
        shal[i] = soft ? 22 : 9;          // rip-rap shelves out; a quay drops straight to depth
        foamW[i] = soft ? 4.5 : 1.8;
      }
    }
    let lastX = 1e9, lastZ = 1e9;
    function follow(cam) {
      if (!cam) return;
      const x = Math.round(cam.position.x / 100) * 100, z = Math.round(cam.position.z / 100) * 100;
      if (x === lastX && z === lastZ) return;
      lastX = x; lastZ = z;
      mesh.position.x = x; mesh.position.z = z;
      mesh.updateMatrix();
    }
    return { mesh: mesh, material: mat, uniforms: uni, setLands: setLands, follow: follow };
  }

  // ============================================================== THE SHORE
  function buildShore(THREE, CBZ, lands, seaY) {
    const rng = rngFrom(CBZ, "bombscene-shore");
    const pos = [], nor = [], col = [], idx = [];
    const rocks = [], bollards = [];
    const EPS = 0.75;

    function quad(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz, nx, ny, nz, cA, cB, cC, cD) {
      const b = pos.length / 3;
      pos.push(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz);
      for (let i = 0; i < 4; i++) nor.push(nx, ny, nz);
      col.push(cA[0], cA[1], cA[2], cB[0], cB[1], cB[2], cC[0], cC[1], cC[2], cD[0], cD[1], cD[2]);
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
    // a vertical face from (xa,za) to (xb,zb), yTop..yBot, always wound to face (nx,nz)
    function vquad(xa, za, xb, zb, yT, yB, nx, nz, cTop, cBot) {
      if ((-(zb - za)) * nx + (xb - xa) * nz < 0) { let t = xa; xa = xb; xb = t; t = za; za = zb; zb = t; }
      quad(xa, yT, za, xa, yB, za, xb, yB, zb, xb, yT, zb, nx, 0, nz, cTop, cBot, cBot, cTop);
    }
    function tint(base, k, out) { out[0] = base[0] * k; out[1] = base[1] * k; out[2] = base[2] * k; return out; }

    const CONC = hexRGB(0x9a958b, []), WET = hexRGB(0x4d4b45, []), ALGAE = hexRGB(0x283430, []);
    const CAP = hexRGB(0xb3ada1, []);

    // the interval [a,b] of an edge minus every span another rect covers on it
    function cutEdge(self, axis, line, a, b) {
      let segs = [[a, b]];
      for (let j = 0; j < lands.length; j++) {
        const o = lands[j];
        if (o === self) continue;
        let lo, hi, onLine;
        if (axis === "x") { onLine = o.minZ - EPS <= line && o.maxZ + EPS >= line; lo = o.minX; hi = o.maxX; }
        else { onLine = o.minX - EPS <= line && o.maxX + EPS >= line; lo = o.minZ; hi = o.maxZ; }
        if (!onLine) continue;
        const next = [];
        for (let k = 0; k < segs.length; k++) {
          const s = segs[k];
          if (hi <= s[0] || lo >= s[1]) { next.push(s); continue; }
          if (lo > s[0]) next.push([s[0], lo]);
          if (hi < s[1]) next.push([hi, s[1]]);
        }
        segs = next;
      }
      return segs.filter(function (s) { return s[1] - s[0] > 0.5; });
    }

    const cT = [], cM = [], cW = [], cB = [], cc = [];
    const ladders = [];
    for (let li = 0; li < lands.length; li++) {
      const r = lands[li];
      const topY = (r.kind === "town" ? 0.03 : 0.05) + 0.02;
      const soft = r.kind !== "town";
      // edges: axis the edge runs along, the fixed coordinate, outward normal
      const edges = [
        { axis: "x", line: r.minZ, a: r.minX, b: r.maxX, nx: 0, nz: -1 },
        { axis: "x", line: r.maxZ, a: r.minX, b: r.maxX, nx: 0, nz: 1 },
        { axis: "z", line: r.minX, a: r.minZ, b: r.maxZ, nx: -1, nz: 0 },
        { axis: "z", line: r.maxX, a: r.minZ, b: r.maxZ, nx: 1, nz: 0 },
      ];
      for (let ei = 0; ei < 4; ei++) {
        const e = edges[ei];
        const segs = cutEdge(r, e.axis, e.line, e.a, e.b);
        for (let si = 0; si < segs.length; si++) {
          const s0 = segs[si][0], s1 = segs[si][1];
          const n = Math.max(1, Math.round((s1 - s0) / 6));
          const step = (s1 - s0) / n;
          // one tone per wall run: block-to-block variation comes from the
          // QUAY surface now, so no more 6 m tinted stripes down the wall
          tint(CONC, 1, cT); tint(CONC, 0.86, cM); tint(WET, 1, cW); tint(ALGAE, 1, cB);
          for (let k = 0; k < n; k++) {
            const u0 = s0 + k * step, u1 = u0 + step;
            let x0, z0, x1, z1;
            if (e.axis === "x") { x0 = u0; x1 = u1; z0 = z1 = e.line; } else { z0 = u0; z1 = u1; x0 = x1 = e.line; }
            const yM = seaY + 0.3, yW = seaY - 0.15;
            vquad(x0, z0, x1, z1, topY, yM, e.nx, e.nz, cT, cM);
            vquad(x0, z0, x1, z1, yM, yW, e.nx, e.nz, cM, cW);
            vquad(x0, z0, x1, z1, yW, -3, e.nx, e.nz, cW, cB);
          }
          // capstone: 0.9 m wide lip standing 0.18 m proud of the deck, 0.25 m past the wall
          const capT = topY + 0.18, capIn = 0.65, capOut = 0.25;
          tint(CAP, 1, cc);
          const cs = tint(CAP, 0.86, []);
          if (e.axis === "x") {
            const zi = e.line - e.nz * capIn, zo = e.line + e.nz * capOut;
            const za = e.nz < 0 ? zo : zi, zb = e.nz < 0 ? zi : zo;      // za < zb
            quad(s0, capT, za, s0, capT, zb, s1, capT, zb, s1, capT, za, 0, 1, 0, cc, cc, cc, cc);
            vquad(s0, zo, s1, zo, capT, topY - 0.05, 0, e.nz, cs, cs);
            vquad(s0, zi, s1, zi, capT, topY - 0.02, 0, -e.nz, cs, cs);
          } else {
            const xi = e.line - e.nx * capIn, xo = e.line + e.nx * capOut;
            const xa = e.nx < 0 ? xo : xi, xb = e.nx < 0 ? xi : xo;
            quad(xa, capT, s0, xa, capT, s1, xb, capT, s1, xb, capT, s0, 0, 1, 0, cc, cc, cc, cc);
            vquad(xo, s0, xo, s1, capT, topY - 0.05, e.nx, 0, cs, cs);
            vquad(xi, s0, xi, s1, capT, topY - 0.02, -e.nx, 0, cs, cs);
          }
          // furniture along the run
          const len = s1 - s0;
          if (soft) {
            const count = Math.floor(len / 2.6);
            for (let k = 0; k < count; k++) {
              const u = s0 + (k + rng()) * (len / count);
              for (let row = 0; row < 2; row++) {
                if (row === 1 && rng() < 0.45) continue;
                const outD = row === 0 ? 0.8 + rng() * 1.2 : 2.2 + rng() * 1.8;
                const x = e.axis === "x" ? u : e.line + e.nx * outD;
                const z = e.axis === "x" ? e.line + e.nz * outD : u;
                const sz = row === 0 ? 0.9 + rng() * 0.8 : 0.6 + rng() * 0.7;
                rocks.push(x, seaY - 0.15 - rng() * 0.35 + (row === 0 ? 0.2 : 0), z, sz, rng());
              }
            }
          } else {
            const count = Math.floor(len / 16);
            for (let k = 0; k < count; k++) {
              const u = s0 + (k + 0.5) * (len / count);
              const x = e.axis === "x" ? u : e.line - e.nx * 0.9;
              const z = e.axis === "x" ? e.line - e.nz * 0.9 : u;
              bollards.push(x, topY, z);
            }
            // iron ladders down the face, clear of the bollards, every ~64 m
            for (let u = s0 + 38; u < s1 - 6; u += 64) {
              ladders.push({ axis: e.axis, line: e.line, u: u, nx: e.nx, nz: e.nz, top: topY - 0.04 });
            }
          }
        }
      }
    }

    const out = [];
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeBoundingSphere();
    const wall = new THREE.Mesh(g, surfaceMat(THREE, K.QUAY, { vertexColors: true, roughness: 0.92 }));
    wall.name = "bombQuay";
    wall.receiveShadow = true;
    wall.matrixAutoUpdate = false;
    wall.updateMatrix();
    out.push(wall);

    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e3 = new THREE.Euler(), v = new THREE.Vector3(), sc = new THREE.Vector3();
    const cl = new THREE.Color();
    const nR = rocks.length / 5;
    if (nR > 0) {
      // three quarried shapes, not one squashed d20: a convex block cut by
      // eight random planes, pulled off an icosphere so it stays watertight
      const VAR = 3, rockMat = surfaceMat(THREE, K.ROCK, { roughness: 0.95 });
      const groups = [];
      for (let vi = 0; vi < VAR; vi++) {
        const base = new THREE.IcosahedronGeometry(1, 1);
        const pa = base.attributes.position;
        const planes = [];
        for (let k = 0; k < 8; k++) {
          const a = rng() * Math.PI * 2, b = Math.acos(rng() * 2 - 1);
          planes.push([Math.sin(b) * Math.cos(a), Math.cos(b), Math.sin(b) * Math.sin(a), 0.72 + rng() * 0.22]);
        }
        const bump = rng() * 10;
        for (let i = 0; i < pa.count; i++) {
          v.set(pa.getX(i), pa.getY(i), pa.getZ(i)).normalize();
          let rr = 1.2;
          for (let k = 0; k < planes.length; k++) {
            const P = planes[k], d = v.x * P[0] + v.y * P[1] + v.z * P[2];
            if (d > 0.05) rr = Math.min(rr, P[3] / d);
          }
          rr *= 1 + 0.05 * Math.sin(v.x * 7 + bump) * Math.sin(v.z * 6 - bump);
          pa.setXYZ(i, v.x * rr, v.y * rr, v.z * rr);
        }
        base.computeVertexNormals();
        const list = [];
        list.geo = base;
        groups.push(list);
      }
      for (let i = 0; i < nR; i++) groups[Math.min(VAR - 1, Math.floor(((rocks[i * 5 + 4] * 13.7) % 1) * VAR))].push(i);
      for (let vi = 0; vi < VAR; vi++) {
        const list = groups[vi];
        if (!list.length) continue;
        const rm = new THREE.InstancedMesh(list.geo, rockMat, list.length);
        for (let j = 0; j < list.length; j++) {
          const i = list[j];
          const s = rocks[i * 5 + 3], rr = rocks[i * 5 + 4];
          e3.set((rr - 0.5) * 0.5, rr * 17.3, (((rr * 3.7) % 1) - 0.5) * 0.5);
          q.setFromEuler(e3);
          v.set(rocks[i * 5], rocks[i * 5 + 1], rocks[i * 5 + 2]);
          sc.set(s * (0.9 + rr * 0.5), s * (0.6 + (1 - rr) * 0.3), s * (1.3 - rr * 0.4));
          m4.compose(v, q, sc);
          rm.setMatrixAt(j, m4);
          const k = 0.4 + ((rr * 7.13) % 1) * 0.18;
          cl.setRGB(k * 1.03, k, k * 0.94);
          rm.setColorAt(j, cl);
        }
        rm.instanceMatrix.needsUpdate = true;
        if (rm.instanceColor) rm.instanceColor.needsUpdate = true;
        rm.receiveShadow = true;
        rm.name = "bombRipRap";
        rm.matrixAutoUpdate = false;
        rm.updateMatrix();
        out.push(rm);
      }
    }
    const ironMat = surfaceMat(THREE, K.IRON, { color: 0x1d1f21, roughness: 0.6, metalness: 0.15 });
    const nB = bollards.length / 3;
    if (nB > 0) {
      // a real mooring bollard: bolted base plate, waisted post, mushroom head
      const prof = [[0.24, 0.05], [0.24, 0.09], [0.17, 0.13], [0.15, 0.4], [0.16, 0.52], [0.23, 0.6], [0.26, 0.66], [0.25, 0.71], [0.18, 0.75], [0.0, 0.76]]
        .map(function (p) { return new THREE.Vector2(p[0], p[1]); });
      const post = new THREE.LatheGeometry(prof, 14);
      const plate = new THREE.BoxGeometry(0.62, 0.05, 0.62); plate.translate(0, 0.025, 0);
      const bolts = [];
      for (let k = 0; k < 4; k++) {
        const bo = new THREE.CylinderGeometry(0.035, 0.035, 0.04, 6);
        bo.translate((k & 1 ? 1 : -1) * 0.24, 0.07, (k & 2 ? 1 : -1) * 0.24);
        bolts.push(bo);
      }
      const bg = mergeGeos(THREE, [post, plate].concat(bolts));
      const bm = new THREE.InstancedMesh(bg, ironMat, nB);
      for (let i = 0; i < nB; i++) {
        m4.makeTranslation(bollards[i * 3], bollards[i * 3 + 1], bollards[i * 3 + 2]);
        bm.setMatrixAt(i, m4);
      }
      bm.instanceMatrix.needsUpdate = true;
      bm.castShadow = true;
      bm.receiveShadow = true;
      bm.name = "bombBollards";
      bm.matrixAutoUpdate = false;
      bm.updateMatrix();
      out.push(bm);
    }
    if (ladders.length) {
      // two flat-bar stringers stood 12 cm off the face, round rungs at 30 cm,
      // from under the coping lip down past low water. One merged mesh.
      const parts = [];
      for (let i = 0; i < ladders.length; i++) {
        const L = ladders[i];
        const yT = L.top, yB = -2.6, hgt = yT - yB, off = 0.12;
        for (let sgn = -1; sgn <= 1; sgn += 2) {
          const rail = new THREE.BoxGeometry(L.axis === "x" ? 0.05 : 0.06, hgt, L.axis === "x" ? 0.06 : 0.05);
          const x = L.axis === "x" ? L.u + sgn * 0.23 : L.line + L.nx * off;
          const z = L.axis === "x" ? L.line + L.nz * off : L.u + sgn * 0.23;
          rail.translate(x, yB + hgt / 2, z);
          parts.push(rail);
        }
        for (let y = yT - 0.2; y > yB + 0.1; y -= 0.3) {
          const rung = new THREE.CylinderGeometry(0.016, 0.016, 0.46, 6);
          rung.rotateZ(Math.PI / 2);
          if (L.axis === "z") rung.rotateY(Math.PI / 2);
          rung.translate(L.axis === "x" ? L.u : L.line + L.nx * off, y, L.axis === "x" ? L.line + L.nz * off : L.u);
          parts.push(rung);
        }
      }
      const lm = new THREE.Mesh(mergeGeos(THREE, parts), ironMat);
      lm.name = "bombLadders";
      lm.castShadow = true; lm.receiveShadow = true;
      lm.matrixAutoUpdate = false; lm.updateMatrix();
      out.push(lm);
    }
    return out;
  }

  /* THE HARBOUR APRON. The strip of quay between the town's own pad and the
     coping: granite setts, a band of big kerb flags along the edge. Built as
     a frame around the town pad (hole = the pad), never under it, so the two
     never fight for the same pixel from altitude. */
  function buildApron(THREE, outer, hole) {
    const y = 0.005;                                   // 2.5 cm under the pad (0.03)
    const rects = [];
    if (!hole) rects.push([outer.minX, outer.maxX, outer.minZ, outer.maxZ]);
    else {
      const ov = 0.05;                                   // tuck just under the pad edge
      rects.push([outer.minX, outer.maxX, outer.minZ, hole.minZ + ov]);
      rects.push([outer.minX, outer.maxX, hole.maxZ - ov, outer.maxZ]);
      rects.push([outer.minX, hole.minX + ov, hole.minZ + ov, hole.maxZ - ov]);
      rects.push([hole.maxX - ov, outer.maxX, hole.minZ + ov, hole.maxZ - ov]);
    }
    const parts = [];
    for (let i = 0; i < rects.length; i++) {
      const R = rects[i];
      if (R[1] - R[0] < 0.1 || R[3] - R[2] < 0.1) continue;
      const pg = new THREE.PlaneGeometry(R[1] - R[0], R[3] - R[2]);
      pg.rotateX(-Math.PI / 2);
      pg.translate((R[0] + R[1]) / 2, y, (R[2] + R[3]) / 2);
      parts.push(pg);
    }
    if (!SURF_U.bsRect.value) SURF_U.bsRect.value = new THREE.Vector4();
    SURF_U.bsRect.value.set((outer.minX + outer.maxX) / 2, (outer.minZ + outer.maxZ) / 2,
      (outer.maxX - outer.minX) / 2, (outer.maxZ - outer.minZ) / 2);
    const m = new THREE.Mesh(mergeGeos(THREE, parts), surfaceMat(THREE, K.SETTS, { color: 0x77736c, roughness: 0.88 }));
    m.name = "bombApron";
    m.receiveShadow = true;
    m.matrixAutoUpdate = false; m.updateMatrix();
    m.userData.terrain = true;
    return m;
  }

  // ============================================================== THE SMOKE
  const FX_VERT = [
    "attribute vec4 aPos;",   // xyz, size (puff radius) or width (streak)
    "attribute vec4 aCol;",   // rgb, alpha
    "attribute vec4 aExt;",   // rotation, heat, seed, mode (0 puff, 1 streak)
    "attribute vec4 aDir;",   // streak direction xyz, length
    "varying vec2 vUv;",
    "varying vec2 vC;",
    "varying vec4 vCol;",
    "varying vec3 vExt;",
    "#include <fog_pars_vertex>",
    "void main() {",
    "  vec4 mvPosition = viewMatrix * vec4(aPos.xyz, 1.0);",
    "  vec2 c = position.xy;",
    "  if (aExt.w > 0.5) {",
    "    vec3 d = (viewMatrix * vec4(aDir.xyz, 0.0)).xyz;",
    "    float l = length(d.xy);",
    "    vec2 ax = l > 0.0001 ? d.xy / l : vec2(1.0, 0.0);",
    "    vec2 nx = vec2(-ax.y, ax.x);",
    "    float w = max(aPos.w, -mvPosition.z * 0.0024);",  // never thinner than ~2 px
    "    mvPosition.xy += ax * (c.x * aDir.w * l) + nx * (c.y * w);",
    "  } else {",
    "    mvPosition.xy += c * aPos.w;",
    "  }",
    "  gl_Position = projectionMatrix * mvPosition;",
    "  float sn = sin(aExt.x); float cs = cos(aExt.x);",
    "  vUv = vec2(c.x * cs - c.y * sn, c.x * sn + c.y * cs) + 0.5;",
    "  vC = c * 2.0;",
    "  vCol = aCol;",
    "  vExt = aExt.yzw;",
    "  #include <fog_vertex>",
    "}",
  ].join("\n");

  const FX_FRAG = [
    "uniform sampler2D uTex;",
    "uniform vec3 uSunV;",
    "uniform vec3 uSunCol;",
    "uniform vec3 uAmb;",
    "varying vec2 vUv;",
    "varying vec2 vC;",
    "varying vec4 vCol;",
    "varying vec3 vExt;",
    "#include <fog_pars_fragment>",
    "void main() {",
    "  vec3 rgb; float a;",
    "  if (vExt.z > 0.5) {",
    "    float across = max(1.0 - abs(vC.y), 0.0);",
    "    float along = clamp(vC.x * 0.5 + 0.5, 0.0, 1.0);",
    "    float d = across * across * (0.2 + 0.8 * along * along);",
    "    rgb = vCol.rgb * d * vCol.a * 2.4 + vec3(d * d * along * vCol.a * 0.8);",
    "    a = 0.0;",
    "  } else {",
    "    vec4 tx = texture2D(uTex, vUv);",
    "    float churn = mix(0.7, 1.25, tx.g);",
    "    float d = clamp(tx.r * mix(1.0, churn, min(vExt.y, 1.0)), 0.0, 1.0);",
    "    a = clamp(d * vCol.a, 0.0, 1.0);",
    "    float r2 = min(dot(vC, vC), 1.0);",
    "    vec3 n = vec3(vC, sqrt(1.0 - r2));",
    "    float lam = max(dot(n, uSunV), 0.0);",
    "    float up = clamp(0.5 + 0.5 * vC.y, 0.0, 1.0);",
    "    vec3 lit = uAmb * (0.45 + 0.55 * up) + uSunCol * lam;",
    "    lit *= 1.0 - 0.4 * tx.r * (1.0 - lam);",                       // thick core self-shadows
    "    vec3 smoke = vCol.rgb * lit;",
    "    float h = clamp(vExt.x, 0.0, 1.0);",
    "    vec3 fire = mix(vec3(0.9, 0.22, 0.03), vec3(1.0, 0.82, 0.45), h * h) * (0.4 + 1.8 * h);",
    "    float core = d * d * (1.0 - 0.5 * r2);",
    "    rgb = smoke * a * (1.0 - h) + fire * h * core * min(vCol.a * 1.6, 1.0);",
    "    a *= 1.0 - 0.85 * h;",
    "  }",
    "  gl_FragColor = vec4(rgb, a);",
    "  #ifdef USE_FOG",
    "    #ifdef FOG_EXP2",
    "      float ff = 1.0 - exp(-fogDensity * fogDensity * fogDepth * fogDepth);",
    "    #else",
    "      float ff = smoothstep(fogNear, fogFar, fogDepth);",
    "    #endif",
    "    gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor * gl_FragColor.a, ff);",
    "  #endif",
    "}",
  ].join("\n");

  function buildFX(THREE, ctx) {
    const rng = rngFrom(ctx.CBZ, "bombscene-fx");
    const R = function () { return rng(); };

    // ---- particle state (structure of arrays) ----
    const F = function () { return new Float32Array(MAXP); };
    const px = F(), py = F(), pz = F(), vx = F(), vy = F(), vz = F();
    const age = F(), life = F(), s0 = F(), s1 = F(), rot = F(), rotV = F();
    const c0r = F(), c0g = F(), c0b = F(), c1r = F(), c1g = F(), c1b = F();
    const a0 = F(), heat0 = F(), heatTau = F(), drag = F(), buoy = F(), mode = F(), seed = F();
    const dxA = F(), dyA = F(), dzA = F(), lenA = F();
    const alive = new Uint8Array(MAXP);
    const freeStack = new Int32Array(MAXP);
    let nFree = MAXP, steal = 0, live = 0;
    for (let i = 0; i < MAXP; i++) freeStack[i] = MAXP - 1 - i;

    function alloc() {
      if (nFree > 0) { const i = freeStack[--nFree]; alive[i] = 1; live++; return i; }
      const i = steal; steal = (steal + 1) % MAXP;      // full: overwrite round-robin
      return i;
    }
    function kill(i) { alive[i] = 0; freeStack[nFree++] = i; live--; }

    const tmp = [0, 0, 0];
    function spawn(x, y, z, o) {
      const i = alloc();
      px[i] = x; py[i] = y; pz[i] = z;
      vx[i] = o.vx || 0; vy[i] = o.vy || 0; vz[i] = o.vz || 0;
      age[i] = 0; life[i] = o.life; s0[i] = o.s0; s1[i] = o.s1;
      rot[i] = R() * 6.2832; rotV[i] = (R() - 0.5) * (o.spin != null ? o.spin : 0.4);
      c0r[i] = o.c0[0]; c0g[i] = o.c0[1]; c0b[i] = o.c0[2];
      c1r[i] = o.c1[0]; c1g[i] = o.c1[1]; c1b[i] = o.c1[2];
      a0[i] = o.a; heat0[i] = o.heat || 0; heatTau[i] = o.heatTau || 0.2;
      drag[i] = o.drag != null ? o.drag : 1; buoy[i] = o.buoy || 0;
      mode[i] = 0; seed[i] = R();
      return i;
    }

    // ---- GPU side ----
    const base = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.setIndex(base.getIndex());
    geo.setAttribute("position", base.getAttribute("position"));
    geo.setAttribute("uv", base.getAttribute("uv"));
    function iattr(name) {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(MAXP * 4), 4);
      a.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute(name, a);
      return a;
    }
    const APos = iattr("aPos"), ACol = iattr("aCol"), AExt = iattr("aExt"), ADir = iattr("aDir");
    const bPos = APos.array, bCol = ACol.array, bExt = AExt.array, bDir = ADir.array;
    geo.instanceCount = 0;

    const uni = THREE.UniformsUtils.merge([THREE.UniformsLib.fog]);
    uni.uTex = { value: ctx.puffTex };
    uni.uSunV = { value: new THREE.Vector3(0, 1, 0) };
    uni.uSunCol = { value: new THREE.Color(0.95, 0.78, 0.58) };
    uni.uAmb = { value: new THREE.Color(0.62, 0.64, 0.68) };
    const mat = new THREE.ShaderMaterial({
      uniforms: uni, vertexShader: FX_VERT, fragmentShader: FX_FRAG,
      fog: true, transparent: true, depthWrite: false, depthTest: true,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    });
    mat.toneMapped = false;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 20;
    mesh.name = "bombSmoke";
    mesh.matrixAutoUpdate = false;

    const wind = { x: 3.4, y: 0, z: -1.6 };           // a light breeze, m/s

    // ---- emitters ----
    const C_BLACK = [0, 0, 0], C_A = [0, 0, 0], C_B = [0, 0, 0];
    function mixc(a, b, t, out) { out[0] = a[0] + (b[0] - a[0]) * t; out[1] = a[1] + (b[1] - a[1]) * t; out[2] = a[2] + (b[2] - a[2]) * t; return out; }
    const GREY_HI = hexRGB(0x5d5953, []), DUST_A = hexRGB(0x8a7a64, []), DUST_B = hexRGB(0x6c665d, []);

    function puff(x, y, z, o) {
      o = o || {};
      const size = o.size != null ? o.size : 12;
      const lf = o.life != null ? o.life : 3.5;
      const rise = o.rise || 0;
      hexRGB(o.color != null ? o.color : 0x1a1a1a, C_A);
      mixc(C_A, GREY_HI, 0.3, C_B);
      if (o.flash !== false) {
        spawn(x, y, z, { life: 0.22, s0: size * 0.22, s1: size * 0.62, c0: C_BLACK, c1: C_BLACK, a: 1, heat: 1, heatTau: 0.09, drag: 4, spin: 2 });
        spawn(x, y, z, { life: 0.12, s0: size * 0.12, s1: size * 0.3, c0: C_BLACK, c1: C_BLACK, a: 1, heat: 1, heatTau: 0.2, drag: 4, spin: 3 });
      }
      const n = 5;
      for (let k = 0; k < n; k++) {
        const ox = (R() - 0.5), oy = (R() - 0.5), oz = (R() - 0.5);
        const r = size * (k === 0 ? 0.05 : 0.24);
        spawn(x + ox * r, y + oy * r, z + oz * r, {
          vx: ox * size * 0.35, vy: oy * size * 0.3 + rise, vz: oz * size * 0.35,
          life: lf * (0.75 + R() * 0.5), s0: size * (0.22 + R() * 0.1), s1: size * (0.75 + R() * 0.4),
          c0: C_A, c1: C_B, a: 0.9 - k * 0.06,
          heat: k < 2 && o.flash !== false ? 0.55 : 0, heatTau: 0.14,
          drag: 1.4, buoy: 0.5 + rise, spin: 0.5,
        });
      }
    }

    function dust(x, y, z, o) {
      o = o || {};
      const size = o.size != null ? o.size : 8;
      const n = 9;
      for (let k = 0; k < n; k++) {
        const ang = R() * 6.2832, sp = 2 + R() * 6;
        mixc(DUST_A, DUST_B, R(), C_A);
        mixc(C_A, GREY_HI, 0.35, C_B);
        spawn(x + Math.cos(ang) * size * 0.2, y + size * (0.15 + R() * 0.2), z + Math.sin(ang) * size * 0.2, {
          vx: Math.cos(ang) * sp, vy: 1.5 + R() * 4, vz: Math.sin(ang) * sp,
          life: 3.5 + R() * 3, s0: size * (0.3 + R() * 0.15), s1: size * (1.1 + R() * 0.8),
          c0: C_A, c1: C_B, a: 0.62, drag: 1.1, buoy: 0.35, spin: 0.3,
        });
      }
    }

    function tracer(x0, y0, z0, x1, y1, z1, o) {
      o = o || {};
      const speed = o.speed != null ? o.speed : 900;
      const ddx = x1 - x0, ddy = y1 - y0, ddz = z1 - z0;
      const total = Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz);
      if (!(total > 0.5)) return;
      hexRGB(o.color != null ? o.color : 0xffd27a, C_A);
      const i = alloc();
      px[i] = x0; py[i] = y0; pz[i] = z0;           // tracers keep their ORIGIN here
      dxA[i] = ddx / total; dyA[i] = ddy / total; dzA[i] = ddz / total;
      lenA[i] = Math.min(o.length != null ? o.length : speed * 0.04, total);
      s0[i] = total; s1[i] = speed;
      age[i] = 0; life[i] = total / speed + 0.04;
      c0r[i] = C_A[0]; c0g[i] = C_A[1]; c0b[i] = C_A[2];
      a0[i] = 1; mode[i] = 1; heat0[i] = 1; rot[i] = 0; rotV[i] = 0;
      buoy[i] = o.width != null ? o.width : 0.35;     // streak width lives in buoy for tracers
    }

    // ---- plumes ----
    const plumes = [];
    for (let i = 0; i < MAX_PLUMES; i++) plumes.push({ on: false, x: 0, y: 0, z: 0, size: 1, life: Infinity, age: 0, fire: true, acc: 0, facc: 0, col: [0, 0, 0], stamp: 0, handle: null });
    let stamp = 0;
    function plume(x, y, z, o) {
      o = o || {};
      let p = null, oldest = null;
      for (let i = 0; i < MAX_PLUMES; i++) {
        if (!plumes[i].on) { p = plumes[i]; break; }
        if (!oldest || plumes[i].stamp < oldest.stamp) oldest = plumes[i];
      }
      if (!p) p = oldest;
      p.on = true; p.x = x; p.y = y; p.z = z;
      p.size = o.size != null ? o.size : 1;
      p.life = o.life != null ? o.life : Infinity;
      p.age = 0; p.acc = R(); p.facc = 0;
      p.fire = o.fire !== false;
      hexRGB(o.color != null ? o.color : 0x2a2826, p.col);
      p.stamp = ++stamp;
      const my = p.stamp;
      p.handle = { stop: function () { if (p.stamp === my) p.on = false; }, get alive() { return p.on && p.stamp === my; } };
      return p.handle;
    }
    const PL_LO = [0, 0, 0], PL_HI = [0, 0, 0];
    function stepPlume(p, dt, budget) {
      p.age += dt;
      if (p.age > p.life) { p.on = false; return; }
      const s = p.size, burning = p.fire && p.age < p.life * 0.75;
      p.acc += dt * 3.2 * budget;
      mixc(p.col, C_BLACK, 0.45, PL_LO);
      mixc(p.col, GREY_HI, 0.75, PL_HI);
      let guard = 0;
      while (p.acc >= 1 && guard++ < 6) {
        p.acc -= 1;
        const j = 2.2 * s;
        spawn(p.x + (R() - 0.5) * j, p.y + 1 + R() * s, p.z + (R() - 0.5) * j, {
          vx: (R() - 0.5) * 1.5, vy: 6 + R() * 3, vz: (R() - 0.5) * 1.5,
          life: 13 + R() * 6, s0: s * (4 + R() * 2), s1: s * (26 + R() * 12),
          c0: PL_LO, c1: PL_HI, a: 0.78, heat: burning ? 0.3 : 0, heatTau: 0.6,
          drag: 0.32, buoy: (8 + R() * 3) * Math.pow(s, 0.25), spin: 0.25,
        });
      }
      if (burning) {
        p.facc += dt * 9 * budget;
        guard = 0;
        while (p.facc >= 1 && guard++ < 6) {
          p.facc -= 1;
          const j = 3 * s;
          spawn(p.x + (R() - 0.5) * j, p.y + 0.5 + R() * s, p.z + (R() - 0.5) * j, {
            vy: 2 + R() * 3, life: 0.45 + R() * 0.5, s0: s * (2.2 + R() * 1.6), s1: s * (4 + R() * 3),
            c0: PL_LO, c1: PL_LO, a: 0.95, heat: 0.85 + R() * 0.15, heatTau: 0.7,
            drag: 1.5, buoy: 4, spin: 1.5,
          });
        }
      }
    }

    // ---- aircraft smoke trails ----
    const trails = [];
    for (let i = 0; i < MAX_TRAILS; i++) trails.push({ on: false, get: null, life: 8, has: false, lx: 0, ly: 0, lz: 0, carry: 0, tacc: 0, stamp: 0 });
    const TR_LO = hexRGB(0x141312, []), TR_HI = hexRGB(0x4a4744, []);
    function smokeTrail(getPos, o) {
      o = o || {};
      let t = null, oldest = null;
      for (let i = 0; i < MAX_TRAILS; i++) {
        if (!trails[i].on) { t = trails[i]; break; }
        if (!oldest || trails[i].stamp < oldest.stamp) oldest = trails[i];
      }
      if (!t) t = oldest;
      t.on = true; t.get = getPos; t.life = o.life != null ? o.life : 8;
      t.size = o.size != null ? o.size : 1;
      t.fire = o.fire !== false;
      t.has = false; t.carry = 0; t.tacc = 0; t.stamp = ++stamp;
      const my = t.stamp;
      return { stop: function () { if (t.stamp === my) { t.on = false; t.get = null; } }, get alive() { return t.on && t.stamp === my; } };
    }
    function trailPuff(t, x, y, z) {
      const s = t.size;
      spawn(x + (R() - 0.5) * s, y + (R() - 0.5) * s, z + (R() - 0.5) * s, {
        vy: 0.5, life: t.life * (0.75 + R() * 0.5), s0: s * (1.6 + R()), s1: s * (9 + R() * 6),
        c0: TR_LO, c1: TR_HI, a: 0.82, heat: t.fire ? 0.75 : 0, heatTau: 0.12,
        drag: 0.9, buoy: 1.4, spin: 0.4,
      });
    }
    function stepTrail(t, dt) {
      let p = null;
      try { p = t.get ? t.get() : null; } catch (e) { p = null; }
      if (!p) { t.on = false; t.get = null; return; }
      if (!t.has) { t.has = true; t.lx = p.x; t.ly = p.y; t.lz = p.z; trailPuff(t, p.x, p.y, p.z); return; }
      const ddx = p.x - t.lx, ddy = p.y - t.ly, ddz = p.z - t.lz;
      const d = Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz);
      if (d > 400) { t.lx = p.x; t.ly = p.y; t.lz = p.z; t.carry = 0; return; }   // teleport: do not smear
      const spacing = 6 * t.size;
      let along = spacing - t.carry, n = 0;
      while (along <= d && n < 24) {
        const k = along / d;
        trailPuff(t, t.lx + ddx * k, t.ly + ddy * k, t.lz + ddz * k);
        along += spacing; n++;
      }
      t.carry = d - (along - spacing);
      if (n === 0) {                     // slow or stopped: still smoke on the clock
        t.tacc += dt * 5;
        if (t.tacc >= 1) { t.tacc -= 1; trailPuff(t, p.x, p.y, p.z); }
      }
      t.lx = p.x; t.ly = p.y; t.lz = p.z;
    }

    // ---- per frame ----
    function update(dt) {
      if (!(dt > 0)) dt = 0;
      if (dt > 0.1) dt = 0.1;
      if (dt > 0) {
        const budget = live > MAXP * 0.85 ? 0.35 : (live > MAXP * 0.65 ? 0.7 : 1);
        for (let i = 0; i < MAX_PLUMES; i++) if (plumes[i].on) stepPlume(plumes[i], dt, budget);
        for (let i = 0; i < MAX_TRAILS; i++) if (trails[i].on) stepTrail(trails[i], dt);
      }
      let k = 0;
      for (let i = 0; i < MAXP; i++) {
        if (!alive[i]) continue;
        age[i] += dt;
        if (age[i] >= life[i]) { kill(i); continue; }
        const o4 = k * 4;
        if (mode[i] > 0.5) {
          const trav = Math.min(age[i] * s1[i], s0[i]);
          const L = Math.min(lenA[i], trav);
          const hd = trav - L * 0.5;
          bPos[o4] = px[i] + dxA[i] * hd; bPos[o4 + 1] = py[i] + dyA[i] * hd; bPos[o4 + 2] = pz[i] + dzA[i] * hd;
          bPos[o4 + 3] = buoy[i];
          const fade = trav >= s0[i] ? 0.4 : 1;
          bCol[o4] = c0r[i]; bCol[o4 + 1] = c0g[i]; bCol[o4 + 2] = c0b[i]; bCol[o4 + 3] = fade;
          bExt[o4] = 0; bExt[o4 + 1] = 1; bExt[o4 + 2] = 0; bExt[o4 + 3] = 1;
          bDir[o4] = dxA[i]; bDir[o4 + 1] = dyA[i]; bDir[o4 + 2] = dzA[i]; bDir[o4 + 3] = L;
          k++;
          continue;
        }
        const kd = Math.min(1, drag[i] * dt);
        const t = age[i] / life[i];
        vx[i] += (wind.x - vx[i]) * kd;
        vy[i] += (buoy[i] * (1 - 0.7 * t) - vy[i]) * kd;
        vz[i] += (wind.z - vz[i]) * kd;
        px[i] += vx[i] * dt; py[i] += vy[i] * dt; pz[i] += vz[i] * dt;
        rot[i] += rotV[i] * dt;
        const g = 1 - t, grow = 1 - g * g * g;
        const fin = Math.min(1, age[i] / (0.05 * life[i] + 0.03));
        const al = a0[i] * fin * g * (0.4 + 0.6 * g);
        bPos[o4] = px[i]; bPos[o4 + 1] = py[i]; bPos[o4 + 2] = pz[i];
        bPos[o4 + 3] = s0[i] + (s1[i] - s0[i]) * grow;
        bCol[o4] = c0r[i] + (c1r[i] - c0r[i]) * t;
        bCol[o4 + 1] = c0g[i] + (c1g[i] - c0g[i]) * t;
        bCol[o4 + 2] = c0b[i] + (c1b[i] - c0b[i]) * t;
        bCol[o4 + 3] = al;
        bExt[o4] = rot[i];
        bExt[o4 + 1] = heat0[i] > 0 ? heat0[i] * Math.exp(-age[i] / heatTau[i]) : 0;
        bExt[o4 + 2] = seed[i] * 0.3 + t;      // churn grows with age
        bExt[o4 + 3] = 0;
        k++;
      }
      geo.instanceCount = k;
      mesh.visible = k > 0;
      if (k > 0) {
        const n = k * 4;
        APos.updateRange.offset = 0; APos.updateRange.count = n; APos.needsUpdate = true;
        ACol.updateRange.offset = 0; ACol.updateRange.count = n; ACol.needsUpdate = true;
        AExt.updateRange.offset = 0; AExt.updateRange.count = n; AExt.needsUpdate = true;
        ADir.updateRange.offset = 0; ADir.updateRange.count = n; ADir.needsUpdate = true;
      }
    }

    function clear() {
      for (let i = 0; i < MAXP; i++) if (alive[i]) kill(i);
      for (let i = 0; i < MAX_PLUMES; i++) plumes[i].on = false;
      for (let i = 0; i < MAX_TRAILS; i++) { trails[i].on = false; trails[i].get = null; }
      geo.instanceCount = 0; mesh.visible = false;
    }
    function audit() {
      let pl = 0, tr = 0;
      for (let i = 0; i < MAX_PLUMES; i++) if (plumes[i].on) pl++;
      for (let i = 0; i < MAX_TRAILS; i++) if (trails[i].on) tr++;
      return { particles: live, max: MAXP, plumes: pl, trails: tr, drawn: geo.instanceCount };
    }

    return {
      api: { puff: puff, plume: plume, dust: dust, tracer: tracer, smokeTrail: smokeTrail, wind: wind, clear: clear, audit: audit, mesh: mesh },
      mesh: mesh, uniforms: uni, update: update,
    };
  }

  // ============================================================ THE FLAK KIT
  /* A 40 mm twin mount in a sandbag pit, built as the thing it is instead of
     a cylinder on a cylinder with a box for a shield and three crates stacked
     at random by the door:
       - a cruciform platform with levelling jacks, a flanged pedestal
       - a turntable carrying two carriage cheeks (the trunnions sit in them),
         hand-wheels, two layers' seats on arms, a reflector sight
       - an armour shield with the barrel slot cut out and swept-back wings
       - breech housing, a four-round clip standing in each feed guide,
         barrels with recoil-spring sleeves and flared flash hiders
       - SANDBAGS: pillow-shaped hessian sacks (60 x 34 x 16 cm, the real
         size), six courses in running bond, battered inward, one entry
       - ready ammunition: two wooden chests square against the pit wall, one
         open with its clips showing, and spent brass on the ground
     One set of geometries and materials shared by every gun (built once).
     Rotating parts use OBJECT-space surfaces so the paint chips turn with
     the mount rather than swimming across it. */
  let FLAK = null;
  function hessianTexture(THREE) {
    const N = 128, c = document.createElement("canvas");
    c.width = c.height = N;
    const x = c.getContext("2d");
    const img = x.createImageData(N, N), d = img.data;
    const rng = rngFrom(null, "bombscene-hessian");
    const blot = [];
    for (let i = 0; i < 7; i++) blot.push([rng() * N, rng() * N, 10 + rng() * 26, 0.12 + rng() * 0.18]);
    for (let y = 0; y < N; y++) for (let i = 0; i < N; i++) {
      // plain weave: warp over weft in a checker of 2 px threads, each thread
      // a little thicker or thinner than its neighbour
      const tx = i >> 1, ty = y >> 1;
      const over = (tx + ty) & 1;
      const across = over ? (i & 1) : (y & 1);
      let v = 0.78 + 0.16 * (over ? 1 : 0.6) - 0.1 * across + (rng() - 0.5) * 0.12;
      v *= 0.92 + 0.08 * Math.sin(tx * 1.7 + ty * 0.3) * Math.sin(ty * 2.3);
      for (let k = 0; k < blot.length; k++) {
        const B = blot[k];
        let dx = Math.abs(i - B[0]), dy = Math.abs(y - B[1]);
        dx = Math.min(dx, N - dx); dy = Math.min(dy, N - dy);
        const r = Math.sqrt(dx * dx + dy * dy) / B[2];
        if (r < 1) v *= 1 - B[3] * (1 - r * r);               // earth and damp
      }
      const o = (y * N + i) * 4;
      d[o] = Math.min(255, 156 * v); d[o + 1] = Math.min(255, 132 * v); d[o + 2] = Math.min(255, 92 * v); d[o + 3] = 255;
    }
    x.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(3, 2);
    t.encoding = THREE.sRGBEncoding;
    t.anisotropy = 4;
    return t;
  }
  function sandbagGeometry(THREE) {
    // a box pushed out to a rounded pillow, ends gathered, the top sagging
    const g = new THREE.BoxGeometry(1, 1, 1, 4, 2, 2);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      let x = p.getX(i) * 2, y = p.getY(i) * 2, z = p.getZ(i) * 2;
      const end = Math.pow(Math.abs(x), 3);
      const round = 1 - 0.35 * (1 - (1 - y * y) * (1 - z * z));
      y *= (1 - 0.5 * end) * (y < 0 ? 0.8 : 1) * round;
      z *= (1 - 0.3 * end) * round;
      x *= 1 - 0.06 * (1 - Math.abs(y));
      p.setXYZ(i, x * 0.3, y * 0.08 + 0.08, z * 0.17);
    }
    g.computeVertexNormals();
    return g;
  }
  function flakKit(THREE) {
    if (FLAK) return FLAK;
    const M = {
      paint: surfaceMat(THREE, K.PAINT, { color: 0x4d553f, roughness: 0.72, metalness: 0.2 }),
      gunmetal: surfaceMat(THREE, K.PAINT, { color: 0x2b2d2b, roughness: 0.5, metalness: 0.35 }),
      wood: surfaceMat(THREE, K.WOOD, { color: 0x5b5a3a, roughness: 0.85 }),
      brass: new THREE.MeshStandardMaterial({ color: 0xa47e3a, roughness: 0.38, metalness: 0.45 }),
      sack: new THREE.MeshLambertMaterial({ color: 0xffffff, map: hessianTexture(THREE) }),
      char: new THREE.MeshLambertMaterial({ color: 0x1b1a18 }),
    };
    const V2 = function (a) { return a.map(function (p) { return new THREE.Vector2(p[0], p[1]); }); };
    const box = function (w, h, d, x, y, z) { const b = new THREE.BoxGeometry(w, h, d); b.translate(x, y, z); return b; };
    const cyl = function (r0, r1, h, seg, open) { return new THREE.CylinderGeometry(r0, r1, h, seg, 1, !!open); };

    // ---- the platform (root, never moves) ----
    const base = [box(4.4, 0.2, 0.32, 0, 0.12, 0), box(0.32, 0.2, 4.4, 0, 0.12, 0)];
    for (let k = 0; k < 4; k++) {
      const a = k * Math.PI / 2, ex = Math.cos(a) * 2.1, ez = Math.sin(a) * 2.1;
      const pad = cyl(0.24, 0.26, 0.05, 12); pad.translate(ex, 0.025, ez); base.push(pad);
      const jack = cyl(0.045, 0.045, 0.22, 8); jack.translate(ex, 0.14, ez); base.push(jack);
      const wheel = new THREE.TorusGeometry(0.1, 0.014, 5, 12); wheel.rotateX(Math.PI / 2); wheel.translate(ex, 0.27, ez); base.push(wheel);
    }
    const pedestal = new THREE.LatheGeometry(V2([[0.62, 0.22], [0.62, 0.3], [0.46, 0.34], [0.4, 0.44], [0.38, 0.9], [0.5, 0.94], [0.52, 1.02], [0.0, 1.02]]), 18);
    const geo = { base: mergeGeos(THREE, base), pedestal: pedestal };

    // ---- the turntable and carriage (yaw) ----
    const table = new THREE.LatheGeometry(V2([[0.0, 0.0], [1.0, 0.0], [1.02, 0.04], [1.0, 0.12], [0.9, 0.14], [0.0, 0.14]]), 28);
    const car = [table];
    const cheek = new THREE.Shape();
    cheek.moveTo(-0.72, 0.1); cheek.lineTo(0.62, 0.1); cheek.lineTo(0.4, 0.62); cheek.lineTo(0.22, 0.92);
    cheek.lineTo(-0.04, 0.95); cheek.lineTo(-0.34, 0.7); cheek.lineTo(-0.72, 0.36); cheek.closePath();
    for (let sgn = -1; sgn <= 1; sgn += 2) {
      const cg = new THREE.ExtrudeGeometry(cheek, { depth: 0.035, bevelEnabled: false });
      cg.rotateY(-Math.PI / 2);                          // shape x -> world z, depth -> world -x
      cg.translate(sgn * 0.44 + 0.0175, 0, 0.1);
      car.push(cg);
      const boss = cyl(0.11, 0.11, 0.1, 14); boss.rotateZ(Math.PI / 2); boss.translate(sgn * 0.49, 0.75, 0.1); car.push(boss);
      const wheel = new THREE.TorusGeometry(0.16, 0.018, 6, 18); wheel.rotateY(Math.PI / 2); wheel.translate(sgn * 0.66, 0.58, -0.22); car.push(wheel);
      const hub = cyl(0.02, 0.02, 0.2, 6); hub.rotateZ(Math.PI / 2); hub.translate(sgn * 0.56, 0.58, -0.22); car.push(hub);
      const knob = cyl(0.018, 0.018, 0.1, 6); knob.rotateZ(Math.PI / 2); knob.translate(sgn * 0.71, 0.72, -0.22); car.push(knob);
      // layer's seat on an arm off the cheek
      const arm = box(0.34, 0.04, 0.05, sgn * 0.62, 0.36, -0.55); car.push(arm);
      const post = cyl(0.025, 0.025, 0.14, 6); post.translate(sgn * 0.78, 0.43, -0.55); car.push(post);
      car.push(box(0.36, 0.045, 0.3, sgn * 0.78, 0.52, -0.58));
      car.push(box(0.34, 0.22, 0.035, sgn * 0.78, 0.66, -0.74));
    }
    // reflector sight on the right cheek
    car.push(box(0.05, 0.3, 0.05, 0.36, 1.05, -0.1));
    const sr = new THREE.TorusGeometry(0.09, 0.012, 5, 16); sr.translate(0.36, 1.25, -0.1); car.push(sr);
    geo.carriage = mergeGeos(THREE, car);

    // shield: a front plate with the barrel slot cut in, two swept wings
    const sh = new THREE.Shape();
    sh.moveTo(-1.05, 0.14); sh.lineTo(1.05, 0.14); sh.lineTo(1.05, 1.18); sh.lineTo(0.42, 1.3);
    sh.lineTo(0.42, 0.6); sh.lineTo(-0.42, 0.6); sh.lineTo(-0.42, 1.3); sh.lineTo(-1.05, 1.18); sh.closePath();
    const plate = new THREE.ExtrudeGeometry(sh, { depth: 0.014, bevelEnabled: false });
    plate.rotateX(-0.1); plate.translate(0, 0, 0.9);
    const shieldParts = [plate];
    for (let sgn = -1; sgn <= 1; sgn += 2) {
      // each wing its own shape (mirroring by scale would turn it inside out)
      const wingS = new THREE.Shape();
      wingS.moveTo(0, 0.14); wingS.lineTo(sgn * 0.55, 0.14); wingS.lineTo(sgn * 0.55, 1.0); wingS.lineTo(0, 1.18); wingS.closePath();
      const w = new THREE.ExtrudeGeometry(wingS, { depth: 0.014, bevelEnabled: false });
      w.rotateY(sgn * 0.62);
      w.translate(sgn * 1.05, 0, 0.9);
      shieldParts.push(w);
      shieldParts.push(box(0.04, 0.08, 0.36, sgn * 0.44, 0.3, 0.72));     // bracket to the cheek
    }
    geo.shield = mergeGeos(THREE, shieldParts);

    // ---- the elevating mass (pitch; pivot at the trunnions, barrels along +Z) ----
    const breech = [box(0.52, 0.4, 0.8, 0, 0, -0.05), box(0.62, 0.08, 0.5, 0, -0.2, -0.05)];
    const trun = cyl(0.07, 0.07, 0.96, 10); trun.rotateZ(Math.PI / 2); breech.push(trun);
    const barrel = [], brass = [];
    for (let sgn = -1; sgn <= 1; sgn += 2) {
      const x = sgn * 0.19;
      // feed guide standing over each breech, a clip of four rounds in it
      breech.push(box(0.035, 0.34, 0.3, x - 0.08, 0.37, -0.25), box(0.035, 0.34, 0.3, x + 0.08, 0.37, -0.25));
      for (let r = 0; r < 4; r++) {
        const rd = cyl(0.021, 0.021, 0.36, 8); rd.translate(x, 0.38, -0.36 + r * 0.075); brass.push(rd);
        const tip = cyl(0.004, 0.021, 0.08, 8); tip.translate(x, 0.6, -0.36 + r * 0.075); brass.push(tip);
      }
      const tube = cyl(0.042, 0.055, 2.85, 12); tube.rotateX(Math.PI / 2); tube.translate(x, 0.02, 1.82); barrel.push(tube);
      const spring = cyl(0.085, 0.085, 0.95, 14); spring.rotateX(Math.PI / 2); spring.translate(x, 0.02, 0.85); barrel.push(spring);
      const collar = cyl(0.07, 0.07, 0.08, 12); collar.rotateX(Math.PI / 2); collar.translate(x, 0.02, 1.36); barrel.push(collar);
      const hider = cyl(0.095, 0.055, 0.34, 12, true); hider.rotateX(Math.PI / 2); hider.translate(x, 0.02, 3.4); barrel.push(hider);
    }
    geo.breech = mergeGeos(THREE, breech);
    geo.barrels = mergeGeos(THREE, barrel);
    geo.clips = mergeGeos(THREE, brass);

    // ---- ready ammunition: two chests, one open ----
    const chest = [];
    function addChest(open) {
      const L = [box(0.74, 0.28, 0.36, 0, 0.14, 0)];
      if (!open) L.push(box(0.78, 0.05, 0.4, 0, 0.305, 0));
      else { const lid = new THREE.BoxGeometry(0.78, 0.4, 0.04); lid.rotateX(0.25); lid.translate(0, 0.49, 0.23); L.push(lid); }   // hinged back against the wall
      for (let sgn = -1; sgn <= 1; sgn += 2) L.push(box(0.03, 0.05, 0.14, sgn * 0.385, 0.2, 0));   // rope beckets
      return L;
    }
    geo.chestShut = mergeGeos(THREE, addChest(false));
    geo.chestOpen = mergeGeos(THREE, addChest(true));
    const inChest = [];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 2; c++) {
      const cl = box(0.3, 0.05, 0.13, -0.17 + c * 0.34, 0.25, -0.1 + r * 0.1);
      inChest.push(cl);
    }
    geo.chestClips = mergeGeos(THREE, inChest);
    const casing = cyl(0.021, 0.021, 0.31, 8); casing.rotateZ(Math.PI / 2); casing.translate(0, 0.021, 0);
    geo.casing = casing;
    geo.bag = sandbagGeometry(THREE);

    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const Y = new THREE.Vector3(0, 1, 0), col = new THREE.Color();
    function mesh(g, m, shadow) {
      const o = new THREE.Mesh(g, m);
      o.castShadow = shadow !== false; o.receiveShadow = true;
      return o;
    }

    function build(x, gy, z, rnd) {
      rnd = rnd || Math.random;
      const root = new THREE.Group();
      root.position.set(x, gy, z);
      // the pit: six courses, 38 bags round, the entry facing +Z
      const R0 = 3.75, COURSES = 6, PER = 38, GAP = 0.34;
      const bags = new THREE.InstancedMesh(geo.bag, M.sack, COURSES * PER);
      let k = 0;
      for (let c = 0; c < COURSES; c++) {
        const R = R0 - c * 0.035;
        for (let i = 0; i < PER; i++) {
          const a = (i + (c & 1 ? 0.5 : 0)) / PER * Math.PI * 2;
          let da = a - Math.PI * 0.5; while (da > Math.PI) da -= Math.PI * 2; while (da < -Math.PI) da += Math.PI * 2;
          if (Math.abs(da) < GAP) continue;
          p.set(Math.cos(a) * R, c * 0.15 - 0.005, Math.sin(a) * R);
          q.setFromAxisAngle(Y, -a + Math.PI / 2 + (rnd() - 0.5) * 0.12);
          s.set(1 + (rnd() - 0.5) * 0.1, 0.92 + rnd() * 0.16, 1 + (rnd() - 0.5) * 0.1);
          m4.compose(p, q, s);
          bags.setMatrixAt(k, m4);
          const t = 0.82 + rnd() * 0.26;
          col.setRGB(t, t * (0.96 + rnd() * 0.06), t * (0.9 + rnd() * 0.1));
          bags.setColorAt(k, col);
          k++;
        }
      }
      bags.count = k; bags.castShadow = true; bags.receiveShadow = true;
      if (bags.instanceColor) bags.instanceColor.needsUpdate = true;
      root.add(bags);

      root.add(mesh(geo.base, M.paint));
      const ped = mesh(geo.pedestal, M.paint); root.add(ped);
      const yaw = new THREE.Group(); yaw.position.y = 1.05; root.add(yaw);
      const carriage = mesh(geo.carriage, M.paint); yaw.add(carriage);
      const shield = mesh(geo.shield, M.paint); yaw.add(shield);
      const pitch = new THREE.Group(); pitch.position.set(0, 0.75, 0.1); yaw.add(pitch);
      const breech = mesh(geo.breech, M.paint); pitch.add(breech);
      pitch.add(mesh(geo.barrels, M.gunmetal));
      pitch.add(mesh(geo.clips, M.brass, false));

      // ready ammunition square against the pit wall, either side of the entry
      const chests = [[geo.chestShut, 0.62], [geo.chestOpen, 0.88], [geo.chestShut, -1.25]];
      for (let i = 0; i < chests.length; i++) {
        const a = Math.PI * 0.5 + chests[i][1];
        const R = R0 - 0.55;
        const ch = mesh(chests[i][0], M.wood);
        ch.position.set(Math.cos(a) * R, 0, Math.sin(a) * R);
        ch.rotation.y = -a + Math.PI / 2;
        root.add(ch);
        if (chests[i][0] === geo.chestOpen) {
          const cl = mesh(geo.chestClips, M.brass, false);
          cl.position.copy(ch.position); cl.rotation.copy(ch.rotation);
          root.add(cl);
        }
      }
      // spent brass, thrown out to the right of the breech and lying there
      const cas = new THREE.InstancedMesh(geo.casing, M.brass, 14);
      for (let i = 0; i < 14; i++) {
        const a = 0.25 + rnd() * 1.05, r = 1.3 + rnd() * 1.4;      // clear of the platform arms
        p.set(Math.cos(a) * r, 0, Math.sin(a) * r);
        q.setFromAxisAngle(Y, rnd() * Math.PI * 2);
        s.set(1, 1, 1);
        m4.compose(p, q, s);
        cas.setMatrixAt(i, m4);
      }
      cas.receiveShadow = true;
      root.add(cas);
      return { root: root, yaw: yaw, pitch: pitch, parts: [ped, carriage, shield, breech] };
    }
    FLAK = { build: build, paint: M.paint, char: M.char, materials: M };
    return FLAK;
  }

  // ============================================================== THE GRADE
  const GRADE = {
    skyTop: 0x4d77a3, skyBot: 0xe2c49e,            // deep blue overhead, dusty warm horizon
    sunColor: 0xffcf9a, sun: 1.3,
    hemiSky: 0xa6b8c9, hemiGround: 0x6b5e4e, hemi: 0.52,
    fogNear: 520, fogFar: 6800,
    elevation: 27, azimuth: -38,                     // degrees; azimuth 0 = +X, positive toward +Z
  };

  function install(opts) {
    if (window.BombScene._handle) return window.BombScene._handle;
    opts = opts || {};
    const THREE = opts.THREE || window.THREE;
    const CBZ = opts.CBZ || window.CBZ;
    const scene = opts.scene || CBZ.scene;
    const camera = opts.camera || CBZ.camera;
    const renderer = opts.renderer || CBZ.renderer;
    const seaY = opts.seaY != null ? opts.seaY : -0.4;
    const lands = (opts.lands || []).filter(function (r) { return r && isFinite(r.minX) && r.maxX > r.minX && r.maxZ > r.minZ; });
    const micro = CBZ && CBZ.micro;
    const G = Object.assign({}, GRADE, opts.grade || {});

    // ---- grade: sky, fog, lights, tone ----
    const dome = micro && micro.skyDome;
    const du = dome && dome.material && dome.material.uniforms;
    const skyTop = du && du.topColor ? du.topColor.value : new THREE.Color();
    const skyBot = du && du.bottomColor ? du.bottomColor.value : new THREE.Color();
    skyTop.setHex(G.skyTop);
    skyBot.setHex(G.skyBot);
    const skyExp = du && du.exponent ? du.exponent : { value: 0.7 };
    const haze = skyBot.clone().lerp(skyTop, 0.14);
    if (scene.fog) {
      scene.fog.color.copy(haze);
      if (scene.fog.near != null) { scene.fog.near = G.fogNear; scene.fog.far = G.fogFar; }
    } else {
      scene.fog = new THREE.Fog(haze.getHex(), G.fogNear, G.fogFar);
    }
    scene.background = haze.clone();
    if (micro && micro.hazeColor) micro.hazeColor.copy(haze);

    if (renderer) {
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      if (opts.exposure != null) renderer.toneMappingExposure = opts.exposure;
    }

    const el = G.elevation * Math.PI / 180, az = G.azimuth * Math.PI / 180;
    const sunDir = new THREE.Vector3(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)).normalize();
    const sun = (micro && micro.sun) || CBZ.sun || null;
    const hemi = (micro && micro.hemiLight) || CBZ.hemi || null;
    const sunC = new THREE.Color(G.sunColor), hSky = new THREE.Color(G.hemiSky), hGnd = new THREE.Color(G.hemiGround);
    const SUN_D = 1300;
    if (sun && sun.shadow && sun.castShadow) {
      sun.shadow.camera.far = SUN_D * 2.4;
      sun.shadow.camera.updateProjectionMatrix();
    }
    function assertLights() {
      if (sun) { sun.intensity = G.sun; sun.color.copy(sunC); }
      if (hemi) { hemi.intensity = G.hemi; hemi.color.copy(hSky); hemi.groundColor.copy(hGnd); }
      if (scene.fog) scene.fog.color.copy(haze);
    }
    assertLights();
    // microboot restores ITS boot values at order 9; ours land right after.
    if (CBZ.onAlways) CBZ.onAlways(9.5, assertLights);
    function aimSun() {
      if (!sun) return;
      const cam = CBZ.camera || camera;
      const cx = cam ? cam.position.x : 0, cz = cam ? cam.position.z : 0;
      sun.position.set(cx + sunDir.x * SUN_D, sunDir.y * SUN_D, cz + sunDir.z * SUN_D);
      sun.target.position.set(cx, 0, cz);
      sun.target.updateMatrixWorld();
    }
    aimSun();
    if (micro && micro.onFrame) micro.onFrame(aimSun, { order: -99, id: "bombscene-sun" });

    // ---- sea ----
    const seaTex = makeSeaTexture(THREE, rngFrom(CBZ, "bombscene-sea"));
    if (renderer && renderer.capabilities) seaTex.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    const sea = buildSea(THREE, { seaTex: seaTex, skyTop: skyTop, skyBot: skyBot, skyExp: skyExp, sunDir: sunDir, seaY: seaY });
    sea.setLands(lands);
    sea.uniforms.uSunCol.value.copy(sunC).lerp(new THREE.Color(0xffffff), 0.3);
    if (opts.replaceSea !== false) scene.add(sea.mesh);

    // ---- shore ----
    SURF_U.bsSeaY.value = seaY;
    const shore = buildShore(THREE, CBZ, lands, seaY);
    for (let i = 0; i < shore.length; i++) scene.add(shore[i]);
    // ---- the harbour apron round the town pad ----
    let apron = null;
    for (let i = 0; i < lands.length; i++) {
      if (lands[i].kind !== "town") continue;
      apron = buildApron(THREE, lands[i], opts.apronHole || null);
      scene.add(apron);
      break;
    }

    // ---- smoke ----
    const puffTex = makePuffTexture(THREE, rngFrom(CBZ, "bombscene-puff"));
    const fx = buildFX(THREE, { CBZ: CBZ, puffTex: puffTex });
    fx.uniforms.uSunCol.value.copy(sunC).multiplyScalar(0.85);
    fx.uniforms.uAmb.value.copy(hSky).lerp(haze, 0.4).multiplyScalar(0.7);
    scene.add(fx.mesh);

    const sunV = new THREE.Vector3();
    let time = 0;
    function update(dt) {
      if (!(dt > 0)) dt = 0;
      if (dt > 0.25) dt = 0.25;
      time += dt;
      sea.uniforms.uTime.value = time % 3600;
      const cam = CBZ.camera || camera;
      sea.follow(cam);
      if (cam) {
        sunV.copy(sunDir).transformDirection(cam.matrixWorldInverse);
        fx.uniforms.uSunV.value.copy(sunV);
      }
      fx.update(dt);
    }

    const handle = {
      update: update,
      fx: fx.api,
      sea: {
        mesh: sea.mesh, material: sea.material, uniforms: sea.uniforms,
        setLands: sea.setLands,
        set wave(v) { sea.uniforms.uWave.value = v; }, get wave() { return sea.uniforms.uWave.value; },
      },
      shore: shore,
      apron: apron,
      sunDir: sunDir,
      grade: G,
    };
    window.BombScene._handle = handle;
    return handle;
  }

  window.BombScene = {
    install: install, _handle: null,
    flakKit: function (THREE) { return flakKit(THREE || window.THREE); },
  };
})();
