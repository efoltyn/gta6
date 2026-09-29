/* ============================================================
   city/metro_fabric.js — EVERY BUILDING OF A METRO PLAN, DRAWN.

   WHY THIS FILE EXISTS. city/metroplan.js turns a seed into a real city —
   ~7,700 buildings for a metro (towers with setbacks, midtown slabs,
   walk-up perimeter blocks, rowhouse terraces, 2,500 suburban houses,
   warehouses, tanks, strip malls, a mall, a stadium, a campus, farms) plus
   a union station. The downtown's hand-built kit (city/buildings.js) costs
   dozens of meshes and colliders per building; at 7,700 buildings that is
   a dead browser. So this file draws the whole metro as ONE shared material
   and ONE mesh per 800 m tile, while keeping the "HD rule" (owner,
   2026-09-28: "don't kill the HDness"):

     * THE SILHOUETTE IS REAL GEOMETRY. Tower setback tiers, parapet walls
       with a coping ring, rooftop plant (lift headhouses, AC units, water
       tanks on the walk-ups), stepped crowns and the landmark spire,
       gable / hip / mansard / gambrel / sawtooth roofs WITH eaves (soffit +
       fascia, so the roof doesn't float when you look up at it), dormers,
       rowhouse cornices and stoops, house garages, chimneys and door hoods,
       shop awnings, strip-mall canopies on columns, cylindrical tanks and
       silos with domes, an open stadium bowl with raked stands, a roof
       canopy and light masts, a barrel-vaulted rail hall with glazed
       lunettes.
     * THE SURFACE IS A SHADER. A facade is drawn per pixel from a handful
       of per-vertex numbers (style, floor height, bay width, storey top,
       door bay, flags, glass tint, a building seed) with UVs in real
       units — u in BAYS along the wall, v in METRES above the lot — so a
       window is the right size on any wall: curtain wall with mullions and
       spandrels, deco piers, punched stone/brick windows with sills and
       lintels (arched on the campus), brutalist ribbon windows with rain
       streaks, corrugated sheds with clerestories and dock doors, rowhouse
       bays with a door and transom, clapboard/stucco houses with trim and
       shutters, storefronts with a sign-free fascia (owner's signage law),
       brick coursing / siding / slate / shingles / standing seams that
       fade out with fwidth before they can shimmer, glass that reflects a
       sky tint with a view-angle fresnel, and at NIGHT windows lit by hash
       (warm/cool, brighter at the ceiling, offices emptying as the night
       gets late).
     * THE FAR CITY IS THE CITY. There is no stand-in skyline. Every tile
       has two meshes of the SAME buildings from the SAME writer: the NEAR
       tile (every detail + the colliders) and the FAR tile, an HLOD that
       keeps each building's true footprint, height, setback tiers, roof
       form (gable / hip / mansard / gambrel / sawtooth / dome / spire /
       crown), headhouse and district facade, and drops only what is under
       a pixel past ~1 km (AC boxes, water tanks, awnings, canopies,
       stoops, cornice lips, soffits, parapet returns). Same material, same
       seed, same bay rule: the lit-window pattern is identical on both, so
       the swap is invisible. The far tile is one draw call and keeps no
       CPU copy of its arrays once they are on the GPU.
     * HAZE, NOT A WALL. The material rides the same fog scale as the
       ground the city stands on (metro_ground.js, 0.10: the terrain's
       atmospheric perspective), so a city 2-6 km away fades by distance
       like the land under it instead of vanishing at the street fog's end,
       and the same AIR as that ground (CBZ.aerialHaze: extinction plus a
       blue-grey in-scatter, in linear light), so it recedes into blue-grey
       instead of whitening.
     * COLOURS ARE sRGB, DECODED IN THE SHADER. Palettes are authored as
       display colours; the shader decodes them to linear reflectance at the
       end (see MF_MAIN), which is what keeps pale stone off white and brick
       off orange at every distance.

   PERFORMANCE LAW. No THREE.Geometry, no mergeBufferGeometries: every tile
   is written straight into typed arrays (Float32 position, Int8 normal,
   four packed Uint8/Int16 vec4 attributes, 16-bit index whenever a tile
   fits), one draw call per tile, deterministic (no Math.random — every
   variation is a hash of the building's position).

   ATTRIBUTE LAYOUT (per vertex, 36 bytes):
     position  Float32 x3   metres, relative to the tile mesh's origin
     normal    Int8    x4   normalized (w unused, keeps 4-byte alignment)
     aMfC      Uint8   x4   normalized: wall/roof colour rgb, building seed
     aMfG      Uint8   x4   normalized: glass tint rgb, flag bits
     aMfP      Uint8   x4   raw: mode, floor height*10, bay width*10, door bay
     aMfU      Int16   x4   raw: u*32 (bays, or metres on roofs), v*16
                            (metres above the 0.16 lot), storey top*16, bays

   API
     CBZ.metroFabric.prepare(P, opts)  -> { tiles (each: mesh = near, far = HLOD), material }
     CBZ.metroFabric.buildTile(P, tile)-> { colliders, stats:{ms, vertices, triangles, bytes} }
     CBZ.metroFabric.buildFarTile(P, tile) -> { stats }  (no colliders)
     CBZ.metroFabric.job(P, tile, far) + runJob(job, budgetMs) -> null | result
                                          (the same build, sliced across frames)
     CBZ.metroFabric.disposeTile(P, tile) (the near tile; far tiles are kept)
     CBZ.metroFabric.build(P, opts)    -> { meshes, colliders, stats, tiles }  (prepare + every tile, near + far)
     CBZ.metroFabric.material()
   opts = { root: THREE.Group, tile: 800, name: P.id }
   A tile mesh is invisible until buildTile fills it (and again after
   disposeTile), so an unbuilt placeholder never reaches the renderer.
   The night / late-night / sky-tint uniforms are driven here from
   CBZ.onAlways(95) the first time a material is made — nothing to wire.
   Colliders are returned, never pushed: {minX,maxX,minZ,maxZ,y0,y1,ref}
   (houses via CBZ.orientedCollider), ref = the tile mesh that draws them.
============================================================ */
(function (G) {
  "use strict";
  const W = typeof window !== "undefined" ? window : G;
  const CBZ = W.CBZ || (W.CBZ = {});
  const THREE = W.THREE;
  if (!THREE) return;

  const GY = 0.16;                 // the lot / pad level every building stands on
  const FOG_SCALE = 0.10;          // == metro_ground.js's ground material: one haze for the city and its ground
  const FOOT = GY - 0.3;           // walls run this far below it: no gap on a slope seam

  // ---------------------------------------------------------------------
  //  hashing (position-seeded, same family as metroplan.js)
  // ---------------------------------------------------------------------
  function sq(n, seed) {
    let m = (Math.imul(n | 0, 0xB5297A4D) + (seed | 0)) | 0;
    m ^= m >>> 8; m = (m + 0x68E31DA4) | 0; m ^= m << 8;
    m = Math.imul(m, 0x1B56C4E9); return m ^ (m >>> 8);
  }
  function hq(x, z, salt) {
    return (sq(salt | 0, sq(Math.round(z * 4) | 0, sq(Math.round(x * 4) | 0, 0x5eed))) >>> 0) / 4294967296;
  }
  const now = (typeof performance !== "undefined" && performance.now) ? function () { return performance.now(); } : Date.now;

  // ---------------------------------------------------------------------
  //  MODES and FLAGS (the shader's vocabulary; keep in sync with MF_FRAG)
  // ---------------------------------------------------------------------
  const M_PLAIN = 0, M_DECK = 1, M_SHINGLE = 2, M_METALROOF = 3, M_GLASS = 4, M_DECO = 5, M_STONE = 6,
    M_BRICK = 7, M_CONCRETE = 8, M_METAL = 9, M_ROW = 10, M_HOUSE = 11, M_STRIP = 12, M_STADIUM = 13,
    M_STANDS = 14, M_BARN = 15, M_MANSARD = 16, M_GLASSROOF = 17, M_GRASS = 18, M_LAMP = 19, M_STUCCO = 20;
  const F_SHOP = 1, F_DOOR = 2, F_BLANK = 4, F_OFFICE = 8, F_GARAGE = 16, F_ARCH = 32, F_DOCK = 64, F_SPEC = 128;
  // F_DOCK on M_PLAIN = floodlit at night (tower crowns); F_SPEC on M_PLAIN = awning stripes;
  // F_SPEC on M_ROW = painted clapboard; on M_HOUSE = shutters; on M_BRICK = the clock face;
  // F_SPEC on M_METALROOF = glazed crown band (the rail hall).

  const STYLE = {
    glass: [M_GLASS, 1.5], deco: [M_DECO, 1.8], stone: [M_STONE, 2.6], brick: [M_BRICK, 2.8],
    concrete: [M_CONCRETE, 3.0], metal: [M_METAL, 6.0], row: [M_ROW, 2.3], house: [M_HOUSE, 3.0],
    strip: [M_STRIP, 3.2], stadium: [M_STADIUM, 8.0], barn: [M_BARN, 2.5],
  };
  const DECKS = [0x6f6f6b, 0x86857f, 0x4d4b48, 0x958c80];
  const AWNINGS = [0x2f4f3a, 0x6b1f22, 0x1f2f4f, 0x2e2e30, 0x8a5a2a, 0x3d5a5a];
  const PLANT = [0x8e908d, 0x9b9d99, 0x7c7f7d, 0xa7a49b];

  // ---------------------------------------------------------------------
  //  THE SHARED SHADER CODE
  // ---------------------------------------------------------------------
  const MF_VARY = [
    "varying vec4 vMfC;", "varying vec4 vMfG;", "varying vec4 vMfP;", "varying vec4 vMfU;",
    "varying vec3 vMfN;", "varying vec3 vMfV;",
  ].join("\n");

  const MF_PARS = [
    MF_VARY,
    "uniform float uMfNight;", "uniform float uMfLate;", "uniform vec3 uMfSky;", "uniform vec3 uMfZen;",
    "float mfH( vec3 p ) {",
    "  p = fract( p * vec3( 0.1031, 0.1030, 0.0973 ) );",
    "  p += dot( p, p.yzx + 33.33 );",
    "  return fract( ( p.x + p.y ) * p.z );",
    "}",
    "float mfBit( float f, float b ) { return mod( floor( f / b + 0.001 ), 2.0 ); }",
    "float mfBox( vec2 p, vec2 lo, vec2 hi, vec2 fw ) {",
    "  fw = max( fw, vec2( 1e-4 ) );",
    "  vec2 a = smoothstep( lo - fw, lo + fw, p ) - smoothstep( hi - fw, hi + fw, p );",
    "  return clamp( a.x, 0.0, 1.0 ) * clamp( a.y, 0.0, 1.0 );",
    "}",
    // 1 on a line repeating every `per` (half width hw), anti-aliased with fw, faded
    // to its mean before it can alias
    "float mfLine( float x, float per, float hw, float fw ) {",
    "  float d = abs( fract( x / per + 0.5 ) - 0.5 ) * per;",
    "  float l = 1.0 - smoothstep( hw - fw, hw + fw, d );",
    "  return mix( l, 2.0 * hw / per, smoothstep( 0.25, 0.6, fw / per ) );",
    "}",
    "float mfFade( float fw, float per ) { return 1.0 - smoothstep( 0.2, 0.55, fw / per ); }",
    "vec3 mfPal4( float h, vec3 a, vec3 b, vec3 c, vec3 d ) {",
    "  return h < 0.25 ? a : h < 0.5 ? b : h < 0.75 ? c : d;",
    "}",
  ].join("\n");

  // The facade, per pixel. Writes diffuseColor.rgb and mfEmit.
  const MF_MAIN = [
    "vec3 mfEmit = vec3( 0.0 );",
    "{",
    "  float mode = floor( vMfP.x + 0.5 );",
    "  float fl = floor( vMfG.a * 255.0 + 0.5 );",
    "  float fSHOP = mfBit( fl, 1.0 ), fDOOR = mfBit( fl, 2.0 ), fBLANK = mfBit( fl, 4.0 ), fOFF = mfBit( fl, 8.0 );",
    "  float fGAR = mfBit( fl, 16.0 ), fARCH = mfBit( fl, 32.0 ), fDOCK = mfBit( fl, 64.0 ), fSPEC = mfBit( fl, 128.0 );",
    "  float fh = max( vMfP.y * 0.1, 0.5 ), bw = max( vMfP.z * 0.1, 0.3 ), doorBay = floor( vMfP.w + 0.5 );",
    "  float u = vMfU.x, v = vMfU.y, top = vMfU.z, bays = vMfU.w;",
    "  float seed = floor( vMfC.a * 255.0 + 0.5 );",
    "  vec3 N = normalize( vMfN );",
    "  vec3 Vd = normalize( vMfV );",
    "  float faceId = floor( mod( atan( N.z, N.x ) * 0.63662 + 4.5, 4.0 ) );",
    "  vec3 base = vMfC.rgb * ( 0.93 + 0.14 * mfH( vec3( seed, 3.1, 7.7 ) ) );",
    "  vec3 col = base;",
    "  float fwu = max( fwidth( u ), 1e-4 ), fwv = max( fwidth( v ), 1e-4 );",
    "  float um = u * bw, fwum = fwu * bw;",
    "  float cu = fract( u ), cv = fract( v / fh ), flo = floor( v / fh ), colI = floor( u );",
    "  vec2 fwc = vec2( fwu, fwv / fh );",
    "  float blur = smoothstep( 0.3, 0.8, max( fwc.x, fwc.y ) );",
    "  float storeys = floor( top / fh + 0.02 );",
    "  float inWin = step( 0.0, v ) * step( flo, storeys - 1.0 ) * ( 1.0 - fBLANK );",
    "  float ground = 1.0 - step( 0.5, flo );",
    "  float cellH = mfH( vec3( seed + faceId * 37.0 + mode * 5.0, colI, flo ) );",
    // window state every facade style fills in
    "  float wm = 0.0;",          // vision glass coverage at this pixel
    "  float wAvg = 0.0;",        // the style's mean coverage (far filter)
    "  float lvl = 0.5;",         // 0..1 up the pane (blinds, ceiling light)
    "  float reflK = 0.7;",       // mirror strength of this glass
    "  float glassy = 0.0;",      // opaque-glass area (spandrels): reflects, never lit
    "  float litP = mix( 0.52 - 0.2 * uMfLate, 0.66 - 0.54 * uMfLate, fOFF );",
    "  float litK = 1.0;",
    "  float wall = step( 3.5, mode ) * ( 1.0 - step( 13.5, mode ) ) + step( 14.5, mode ) * ( 1.0 - step( 15.5, mode ) ) + step( 19.5, mode );",
    "  vec3 stoneL = mix( base, vec3( 0.86, 0.83, 0.76 ), 0.55 );",
    "  if ( mode < 0.5 ) {",                                                        // PLAIN
    "    float n = mfH( vec3( floor( u * 2.0 ), floor( v * 2.0 ), seed ) );",
    "    col *= 1.0 + ( n - 0.5 ) * 0.06 * mfFade( max( fwu, fwv ), 0.5 );",
    "    if ( fSPEC > 0.5 ) col = mix( col, vec3( 0.86, 0.83, 0.74 ), step( 0.5, fract( u / 0.7 ) ) * mfFade( fwu, 0.7 ) + 0.5 * ( 1.0 - mfFade( fwu, 0.7 ) ) );",
    "    if ( fDOCK > 0.5 ) mfEmit += base * 0.5 * uMfNight;",
    "  } else if ( mode < 1.5 ) {",                                                 // DECK (flat roof)
    "    float seam = mfLine( u, 1.0, 0.025, fwu );",
    "    vec2 pc = floor( vec2( u, v ) / 3.3 );",
    "    float patchT = mfH( vec3( pc, seed ) );",
    "    col *= 1.0 + ( patchT - 0.5 ) * 0.12 * mfFade( max( fwu, fwv ), 3.3 );",
    "    col *= 1.0 - 0.07 * seam;",
    "    vec2 pp = floor( vec2( u, v ) / 7.0 );",
    "    float pond = step( 0.72, mfH( vec3( pp, seed + 9.0 ) ) );",
    "    vec2 pf = fract( vec2( u, v ) / 7.0 ) - 0.5;",
    "    col *= 1.0 - 0.13 * pond * ( 1.0 - smoothstep( 0.18, 0.34, length( pf ) ) );",
    "  } else if ( mode < 2.5 ) {",                                                 // SHINGLE
    "    float r = floor( v / 0.2 );",
    "    float x = u + mod( r, 2.0 ) * 0.17;",
    "    float fa = mfFade( fwv, 0.2 );",
    "    float s = fract( v / 0.2 );",
    "    col *= mix( 1.0, 0.8 + 0.2 * smoothstep( 0.0, 0.3, s ), fa );",
    "    col *= 1.0 - 0.18 * mfLine( x, 0.34, 0.012, fwu ) * fa;",
    "    col *= 1.0 + ( mfH( vec3( floor( x / 0.34 ), r, seed ) ) - 0.5 ) * 0.2 * fa;",
    "  } else if ( mode < 3.5 ) {",                                                 // METAL ROOF (standing seam)
    "    col *= 1.0 + 0.1 * mfLine( u, 0.5, 0.025, fwu );",
    "    col *= 1.0 - 0.05 * mfLine( u + 0.25, 0.5, 0.06, fwu );",
    "    if ( fSPEC > 0.5 ) {",
    "      float band = mfBox( vec2( 0.5, v ), vec2( 0.0, top * 0.5 - 3.6 ), vec2( 1.0, top * 0.5 + 3.6 ), vec2( 0.01, fwv ) );",
    "      float grid = max( mfLine( u, 2.0, 0.05, fwu ), mfLine( v, 1.2, 0.04, fwv ) );",
    "      wm = band * ( 1.0 - grid ); wAvg = wm; reflK = 0.9; litP = 1.0; litK = 0.35; lvl = 0.8;",
    "    }",
    "  } else if ( mode < 4.5 ) {",                                                 // GLASS curtain wall
    "    float mw = clamp( 0.07 / bw, 0.02, 0.12 );",
    "    float sp = clamp( 0.95 / fh, 0.1, 0.4 );",
    "    float lobby = ground * fSHOP;",
    "    vec2 lo = vec2( mw, mix( sp, 0.02, lobby ) ), hi = vec2( 1.0 - mw, mix( 0.965, 0.9, lobby ) );",
    "    wm = mfBox( vec2( cu, cv ), lo, hi, fwc ) * inWin;",
    "    wAvg = ( hi.x - lo.x ) * ( hi.y - lo.y ) * inWin;",
    "    lvl = ( cv - lo.y ) / ( hi.y - lo.y );",
    "    float gl = mfBox( vec2( cu, cv ), vec2( mw, 0.0 ), vec2( 1.0 - mw, 1.0 ), fwc );",
    "    glassy = mix( gl, 1.0 - 2.0 * mw, blur ) * step( -0.05, v );",
    "    col = mix( base, base * 1.12, 1.0 - gl );",
    "    reflK = 0.95;",
    "    if ( lobby > 0.5 ) litP = 0.9;",
    "  } else if ( mode < 5.5 ) {",                                                 // DECO piers
    "    vec2 lo = vec2( 0.3, 0.14 ), hi = vec2( 0.7, 0.9 );",
    "    wm = mfBox( vec2( cu, cv ), lo, hi, fwc ) * inWin;",
    "    wAvg = 0.4 * 0.76 * inWin;",
    "    lvl = ( cv - lo.y ) / ( hi.y - lo.y );",
    "    float strip = mfBox( vec2( cu, 0.5 ), vec2( 0.3, 0.0 ), vec2( 0.7, 1.0 ), fwc ) * step( 0.0, v ) * step( v, top );",
    "    col = mix( col, base * vec3( 0.42, 0.4, 0.38 ), mix( strip, 0.4, blur ) * ( 1.0 - fBLANK ) );",
    "    col = mix( col, base * 1.1, mfBox( vec2( 0.5, v ), vec2( 0.0, top + 0.05 ), vec2( 1.0, top + 0.5 ), vec2( 0.01, fwv ) ) );",
    "    reflK = 0.75;",
    "  } else if ( mode < 8.5 || ( mode > 9.5 && mode < 11.5 ) || mode > 19.5 ) {",  // PUNCHED: stone 6, brick 7, concrete 8, row 10, house 11, stucco 20
    "    vec2 lo = vec2( 0.29, 0.26 ), hi = vec2( 0.71, 0.84 );",
    "    if ( mode > 6.5 && mode < 7.5 ) { lo = vec2( 0.31, 0.27 ); hi = vec2( 0.69, 0.83 ); }",
    "    if ( mode > 7.5 && mode < 8.5 ) { lo = vec2( 0.07, 0.37 ); hi = vec2( 0.93, 0.83 ); }",
    "    if ( mode > 9.5 && mode < 10.5 ) { lo = vec2( 0.24, 0.24 ); hi = vec2( 0.76, 0.85 ); }",
    "    if ( mode > 10.5 ) { lo = vec2( 0.3, 0.3 ); hi = vec2( 0.7, 0.8 ); }",
    "    vec2 p = vec2( cu, cv );",
    "    wm = mfBox( p, lo, hi, fwc );",
    "    if ( fARCH > 0.5 ) {",
    "      float r = ( hi.x - lo.x ) * bw * 0.5;",
    "      float xm = ( cu - 0.5 * ( lo.x + hi.x ) ) * bw;",
    "      float ym = max( ( cv - hi.y ) * fh + r, 0.0 );",
    "      wm *= 1.0 - smoothstep( r - fwum, r + fwum, length( vec2( xm, ym ) ) );",
    "    }",
    "    wm *= inWin;",
    "    wAvg = ( hi.x - lo.x ) * ( hi.y - lo.y ) * inWin * ( fARCH > 0.5 ? 0.9 : 1.0 );",
    "    lvl = ( cv - lo.y ) / ( hi.y - lo.y );",
    "    float fade = 1.0 - blur;",
    // the reveal: a shadowed rim just inside the opening's frame
    "    float rim = mfBox( p, lo - vec2( 0.025, 0.02 ), hi + vec2( 0.025, 0.02 ), fwc ) * inWin - wm;",
    "    float sill = mfBox( p, vec2( lo.x - 0.035, lo.y - 0.05 ), vec2( hi.x + 0.035, lo.y ), fwc ) * inWin;",
    "    float lint = mfBox( p, vec2( lo.x - 0.02, hi.y ), vec2( hi.x + 0.02, hi.y + 0.055 ), fwc ) * inWin * ( 1.0 - fARCH );",
    // surface texture per style (faded before it can alias)
    "    if ( mode > 5.5 && mode < 6.5 ) {",                                         // ashlar stone
    "      float r = floor( v / 0.6 );",
    "      float j = max( mfLine( v, 0.6, 0.008, fwv ), mfLine( um + mod( r, 2.0 ) * 0.6, 1.2, 0.008, fwum ) );",
    "      col *= 1.0 - 0.12 * j * mfFade( fwv, 0.6 );",
    "      col = mix( col, stoneL * 0.98, mfBox( vec2( 0.5, cv ), vec2( 0.0, 0.0 ), vec2( 1.0, 0.035 ), fwc ) * step( 0.5, flo ) * 0.6 );",
    "    } else if ( ( mode > 6.5 && mode < 7.5 ) || ( mode > 9.5 && mode < 10.5 && fSPEC < 0.5 ) ) {",   // brick
    "      float r = floor( v / 0.077 );",
    "      float fa = mfFade( fwv, 0.077 );",
    "      float x = um + mod( r, 2.0 ) * 0.11;",
    "      float mor = max( mfLine( v, 0.077, 0.006, fwv ), mfLine( x, 0.225, 0.005, fwum ) );",
    "      col *= 1.0 + ( mfH( vec3( floor( x / 0.225 ), r, seed ) ) - 0.5 ) * 0.16 * fa;",
    "      col = mix( col, vec3( 0.62, 0.6, 0.56 ) * 0.9, mor * 0.45 * fa );",
    "    } else if ( mode > 7.5 && mode < 8.5 ) {",                                   // concrete panels + rain streaks
    "      float jt = max( 1.0 - smoothstep( 0.012, 0.012 + fwum * 1.5, min( cu, 1.0 - cu ) * bw ), mfLine( v, fh, 0.012, fwv ) );",
    "      col *= 1.0 - 0.14 * jt * mfFade( fwum, 0.4 );",
    "      float st = mfH( vec3( colI, flo, seed + 3.0 ) );",
    "      float streak = ( 1.0 - smoothstep( 0.0, 0.3, lo.y - cv ) ) * step( cv, lo.y ) * step( abs( cu - 0.2 - 0.6 * st ), 0.08 ) * inWin;",
    "      col *= 1.0 - 0.14 * streak * fade;",
    "      col *= 1.0 + ( mfH( vec3( floor( um / 0.3 ), floor( v / 0.3 ), seed ) ) - 0.5 ) * 0.07 * mfFade( fwv, 0.3 );",
    "    } else if ( ( mode > 9.5 && mode < 10.5 && fSPEC > 0.5 ) || ( mode > 10.5 && mode < 11.5 ) ) {",  // clapboard / siding
    "      float s = fract( v / 0.2 );",
    "      col *= mix( 1.0, 0.86 + 0.14 * smoothstep( 0.0, 0.85, s ), mfFade( fwv, 0.2 ) );",
    "    } else if ( mode > 19.5 ) {",                                                 // stucco
    "      col *= 1.0 + ( mfH( vec3( floor( um / 0.15 ), floor( v / 0.15 ), seed ) ) - 0.5 ) * 0.06 * mfFade( fwv, 0.15 );",
    "    }",
    // trim: houses get painted frames, masonry gets stone sills / lintels
    "    if ( mode > 10.5 ) {",
    "      vec3 trim = vec3( 0.9, 0.89, 0.85 );",
    "      float fr = mfBox( p, lo - vec2( 0.04, 0.035 ), hi + vec2( 0.04, 0.035 ), fwc ) * inWin - wm;",
    "      col = mix( col, trim, clamp( fr, 0.0, 1.0 ) * fade );",
    "      if ( fSPEC > 0.5 ) {",
    "        float sh = ( mfBox( p, vec2( lo.x - 0.13, lo.y ), vec2( lo.x - 0.045, hi.y ), fwc ) + mfBox( p, vec2( hi.x + 0.045, lo.y ), vec2( hi.x + 0.13, hi.y ), fwc ) ) * inWin;",
    "        vec3 shc = mfPal4( mfH( vec3( seed, 5.0, 1.0 ) ), vec3( 0.12, 0.2, 0.14 ), vec3( 0.08, 0.08, 0.09 ), vec3( 0.2, 0.12, 0.09 ), vec3( 0.12, 0.16, 0.24 ) );",
    "        col = mix( col, shc, sh * fade );",
    "      }",
    "      col = mix( col, vec3( 0.55, 0.54, 0.52 ), mfBox( vec2( 0.5, v ), vec2( 0.0, -1.0 ), vec2( 1.0, 0.32 ), vec2( 0.01, fwv ) ) );",
    "    } else {",
    "      col *= 1.0 - 0.35 * clamp( rim, 0.0, 1.0 ) * fade;",
    "      col = mix( col, stoneL, clamp( sill + lint, 0.0, 1.0 ) * fade * ( mode > 7.5 && mode < 8.5 ? 0.0 : 1.0 ) );",
    "      col = mix( col, base * 1.13, mfBox( vec2( 0.5, v ), vec2( 0.0, top + 0.05 ), vec2( 1.0, top + 0.4 ), vec2( 0.01, fwv ) ) );",
    "      col *= mix( 1.0, 0.82, mfBox( vec2( 0.5, v ), vec2( 0.0, -1.0 ), vec2( 1.0, 0.75 ), vec2( 0.01, fwv ) ) * ( 1.0 - fSHOP ) );",
    "    }",
    "    reflK = mode > 10.5 ? 0.55 : 0.65;",
    "  } else if ( mode < 9.5 ) {",                                                  // METAL shed / tank
    "    float cor = 0.5 + 0.5 * sin( um * 33.07 );",
    "    col *= 1.0 - 0.09 * cor * mfFade( fwum, 0.19 ) - 0.045 * ( 1.0 - mfFade( fwum, 0.19 ) );",
    "    if ( fBLANK > 0.5 ) {",
    "      col *= 1.0 - 0.16 * mfLine( v, 1.6, 0.03, fwv );",
    "      col *= 1.0 - 0.1 * mfLine( u, 1.0, 0.02, fwu );",
    "    } else {",
    "      col = mix( col, vec3( 0.5, 0.49, 0.47 ), mfBox( vec2( 0.5, v ), vec2( 0.0, -1.0 ), vec2( 1.0, 1.1 ), vec2( 0.01, fwv ) ) );",
    "      float even = 1.0 - mod( colI, 2.0 );",
    "      if ( top > 5.0 ) {",
    "        vec2 lo = vec2( 0.08, top - 2.4 ), hi = vec2( 0.92, top - 1.3 );",
    "        wm = mfBox( vec2( cu, v ), lo, hi, vec2( fwu, fwv ) ) * even;",
    "        wAvg = 0.84 * 0.5 * 1.1 / fh;",
    "        lvl = ( v - lo.y ) / 1.1; litP = 0.3; reflK = 0.5;",
    "      }",
    "      if ( fDOCK > 0.5 ) {",
    "        float dk = mfBox( vec2( cu, v ), vec2( 0.12, -1.0 ), vec2( 0.88, 4.4 ), vec2( fwu, fwv ) ) * step( abs( mod( colI, 3.0 ) - 1.0 ), 0.1 );",
    "        vec3 dc = vec3( 0.6, 0.61, 0.6 ) * ( 1.0 - 0.12 * mfLine( v, 0.12, 0.012, fwv ) );",
    "        col = mix( col, dc, dk );",
    "        col = mix( col, vec3( 0.95, 0.75, 0.2 ), mfBox( vec2( cu, v ), vec2( 0.1, -1.0 ), vec2( 0.12, 1.0 ), vec2( fwu, fwv ) ) * step( abs( mod( colI, 3.0 ) - 1.0 ), 0.1 ) );",
    "      }",
    "    }",
    "  } else if ( mode < 12.5 ) {",                                                 // STRIP / MALL walls
    "    float fa = mfFade( fwv, 0.2 );",
    "    float r = floor( v / 0.2 );",
    "    float cmu = max( mfLine( v, 0.2, 0.006, fwv ), mfLine( um + mod( r, 2.0 ) * 0.2, 0.4, 0.006, fwum ) );",
    "    col *= 1.0 - 0.12 * cmu * fa;",
    "    col = mix( col, base * 0.85, mfLine( v, fh, 0.08, fwv ) * step( fh * 0.5, v ) );",
    "    if ( fSHOP < 0.5 && fDOOR < 0.5 ) {",
    "      float sd = mfBox( vec2( cu, v ), vec2( 0.34, -1.0 ), vec2( 0.66, 2.2 ), vec2( fwu, fwv ) ) * step( abs( mod( colI, 6.0 ) - 3.0 ), 0.1 );",
    "      col = mix( col, vec3( 0.45, 0.47, 0.48 ), sd );",
    "    }",
    "  } else if ( mode < 13.5 ) {",                                                 // STADIUM outer wall
    "    float rib = 1.0 - smoothstep( 0.45, 0.45 + fwum * 1.5, min( cu, 1.0 - cu ) * bw );",
    "    float op = mfBox( vec2( cu, v ), vec2( 0.0, 5.0 ), vec2( 1.0, 7.4 ), vec2( fwu, fwv ) ) + mfBox( vec2( cu, v ), vec2( 0.0, 15.5 ), vec2( 1.0, 17.9 ), vec2( fwu, fwv ) );",
    "    op *= 1.0 - rib;",
    "    col = mix( col, vec3( 0.1, 0.1, 0.11 ), op );",
    "    col = mix( col, base * 1.12, rib );",
    "    col = mix( col, base * 1.06, mfBox( vec2( 0.5, v ), vec2( 0.0, top - 3.0 ), vec2( 1.0, top + 10.0 ), vec2( 0.01, fwv ) ) );",
    "    mfEmit += vec3( 1.0, 0.9, 0.72 ) * op * 0.55 * uMfNight;",
    "  } else if ( mode < 14.5 ) {",                                                 // STANDS
    "    float fa = mfFade( fwv, 0.85 );",
    "    float rw = fract( v / 0.85 );",
    "    float seat = smoothstep( 0.3, 0.36, rw ) * ( 1.0 - smoothstep( 0.86, 0.92, rw ) );",
    "    float aisle = 1.0 - smoothstep( 0.6, 0.6 + fwu * 1.5, abs( fract( u / 14.0 + 0.5 ) - 0.5 ) * 14.0 );",
    "    float sm = mix( seat, 0.6, 1.0 - fa ) * ( 1.0 - mix( aisle, 0.085, 1.0 - mfFade( fwu, 14.0 ) ) );",
    "    col = mix( vec3( 0.56, 0.56, 0.54 ) * ( 0.85 + 0.15 * rw ), base, sm );",
    "  } else if ( mode < 15.5 ) {",                                                 // BARN boards + doors
    "    float fa = mfFade( fwum, 0.3 );",
    "    col *= 1.0 - 0.16 * mfLine( um, 0.3, 0.012, fwum ) * fa;",
    "    col = mix( col, vec3( 0.55, 0.54, 0.52 ), mfBox( vec2( 0.5, v ), vec2( 0.0, -1.0 ), vec2( 1.0, 0.4 ), vec2( 0.01, fwv ) ) );",
    "    if ( fDOOR > 0.5 ) {",
    "      float fw2 = bays * bw * 0.5;",
    "      vec2 dp = vec2( ( um - fw2 ) / 2.4, v / 2.15 - 1.0 );",
    "      float door = mfBox( dp, vec2( -1.0 ), vec2( 1.0 ), vec2( fwum / 2.4, fwv / 2.15 ) );",
    "      float inner = mfBox( dp, vec2( -0.92 ), vec2( 0.92 ), vec2( fwum / 2.4, fwv / 2.15 ) );",
    "      float xb = max( 1.0 - smoothstep( 0.05, 0.09, abs( dp.x - dp.y ) ), 1.0 - smoothstep( 0.05, 0.09, abs( dp.x + dp.y ) ) ) * inner;",
    "      col = mix( col, vec3( 0.9, 0.88, 0.84 ), clamp( door - inner + xb, 0.0, 1.0 ) );",
    "      float loft = mfBox( vec2( um - fw2, v ), vec2( -1.0, 5.4 ), vec2( 1.0, 7.0 ), vec2( fwum, fwv ) );",
    "      col = mix( col, base * 0.55, loft );",
    "    }",
    "  } else if ( mode < 16.5 ) {",                                                 // MANSARD slate + dormers
    "    float r = floor( v / 0.17 );",
    "    float fa = mfFade( fwv, 0.17 );",
    "    col *= mix( 1.0, 0.82 + 0.18 * smoothstep( 0.0, 0.3, fract( v / 0.17 ) ), fa );",
    "    col *= 1.0 + ( mfH( vec3( floor( ( um + mod( r, 2.0 ) * 0.14 ) / 0.28 ), r, seed ) ) - 0.5 ) * 0.14 * fa;",
    "    if ( fBLANK < 0.5 ) {",
    "      vec2 lo = vec2( 0.3, 0.45 ), hi = vec2( 0.7, 1.85 );",
    "      wm = mfBox( vec2( cu, v ), lo, hi, vec2( fwu, fwv ) );",
    "      float fr = mfBox( vec2( cu, v ), lo - vec2( 0.05, 0.1 ), hi + vec2( 0.05, 0.14 ), vec2( fwu, fwv ) ) - wm;",
    "      col = mix( col, vec3( 0.86, 0.85, 0.8 ), fr );",
    "      wAvg = 0.4 * 1.4 / 2.6; lvl = ( v - lo.y ) / 1.4;",
    "      cellH = mfH( vec3( seed + faceId * 37.0 + 81.0, colI, 99.0 ) );",
    "    }",
    "  } else if ( mode < 17.5 ) {",                                                 // GLASS ROOF / glazed screens
    "    float grid = max( mfLine( u, 1.6, 0.045, fwu ), mfLine( v, 1.25, 0.04, fwv ) );",
    "    wm = 1.0 - grid; wAvg = 0.9; reflK = 0.9; litP = 1.0; litK = 0.3; lvl = 0.8;",
    "    cellH = 0.0;",
    "  } else if ( mode < 18.5 ) {",                                                 // GRASS (pitch)
    "    col *= 0.94 + 0.1 * step( 0.5, fract( u / 12.0 ) ) * mfFade( fwu, 12.0 ) + 0.05 * ( 1.0 - mfFade( fwu, 12.0 ) );",
    "  } else if ( mode < 19.5 ) {",                                                 // LAMP (flood heads)
    "    col = vec3( 0.82, 0.83, 0.84 );",
    "    mfEmit += vec3( 1.0, 0.97, 0.9 ) * ( 0.08 + 3.2 * uMfNight );",
    "  }",
    // ---- storefront on a shop ground floor (masonry, glass lobbies excluded) ----
    "  if ( fSHOP > 0.5 && ground > 0.5 && v > -0.1 && ( ( mode > 4.5 && mode < 8.5 ) || ( mode > 9.5 && mode < 10.5 ) || ( mode > 11.5 && mode < 12.5 ) ) ) {",
    "    float gTop = min( 3.3, fh - 0.75 );",
    "    float sf = mfBox( vec2( cu, v ), vec2( 0.03, 0.35 ), vec2( 0.97, gTop ), vec2( fwu, fwv ) );",
    "    if ( bw > 2.4 ) sf *= 1.0 - ( 1.0 - smoothstep( 0.012, 0.012 + fwu, abs( cu - 0.5 ) ) ) * ( 1.0 - blur );",
    "    float fas = mfBox( vec2( cu, v ), vec2( 0.0, gTop + 0.18 ), vec2( 1.0, min( gTop + 1.7, fh - 0.12 ) ), vec2( fwu, fwv ) );",
    "    float tn = mfH( vec3( floor( u / 2.0 ), seed, 21.0 ) );",
    "    vec3 tc = mfPal4( tn, vec3( 0.13, 0.24, 0.18 ), vec3( 0.32, 0.1, 0.1 ), vec3( 0.12, 0.15, 0.26 ), vec3( 0.1, 0.1, 0.11 ) );",
    "    tc = mix( tc, base * 0.9, step( 0.8, mfH( vec3( tn, 3.0, seed ) ) ) );",
    "    col = mix( col, tc, fas );",
    "    col = mix( col, vec3( 0.3, 0.3, 0.31 ), mfBox( vec2( 0.5, v ), vec2( 0.0, -1.0 ), vec2( 1.0, 0.35 ), vec2( 0.01, fwv ) ) );",
    "    wm = sf; wAvg = 0.9 * ( gTop - 0.35 ) / fh; lvl = ( v - 0.35 ) / ( gTop - 0.35 ); reflK = 0.6;",
    "    litP = 0.85; cellH = mfH( vec3( seed, colI, 44.0 + faceId ) );",
    "  }",
    // ---- the door (houses, rows, lobbies, mall entrances) ----
    "  if ( fDOOR > 0.5 && ground > 0.5 && abs( colI - doorBay ) < 0.1 && mode > 4.5 && mode != 15.0 ) {",
    "    float d0 = mode > 9.5 && mode < 10.5 ? 0.55 : 0.02;",
    "    float dw = min( 1.1 / bw, 0.8 ) * 0.5;",
    "    if ( mode > 11.5 && mode < 12.5 ) {",                                         // a mall entrance: a glazed bay
    "      float ent = mfBox( vec2( cu, v ), vec2( 0.06, 0.02 ), vec2( 0.94, min( top - 0.6, 7.6 ) ), vec2( fwu, fwv ) );",
    "      wm = max( wm, ent ); litP = 1.0; lvl = v / 7.6; cellH = 0.0;",
    "    } else {",
    "      float dr = mfBox( vec2( cu, v ), vec2( 0.5 - dw, d0 ), vec2( 0.5 + dw, d0 + 2.25 ), vec2( fwu, fwv ) );",
    "      float dh = mfH( vec3( seed, 17.0, faceId ) );",
    "      vec3 dc = mfPal4( dh, vec3( 0.14, 0.25, 0.18 ), vec3( 0.35, 0.11, 0.11 ), vec3( 0.11, 0.16, 0.27 ), vec3( 0.42, 0.29, 0.19 ) );",
    "      if ( mode > 10.5 && mode < 11.5 && dh > 0.6 ) dc = vec3( 0.86, 0.85, 0.8 );",
    "      col = mix( col, dc, dr );",
    "      wm *= 1.0 - dr;",
    "      float tr = mfBox( vec2( cu, v ), vec2( 0.5 - dw, d0 + 2.35 ), vec2( 0.5 + dw, d0 + 2.7 ), vec2( fwu, fwv ) ) * step( 9.5, mode ) * step( mode, 10.5 );",
    "      wm = max( wm, tr );",
    "      float sc = mfBox( vec2( cu, v ), vec2( 0.5 + dw + 0.03, d0 + 1.8 ), vec2( 0.5 + dw + 0.03 + 0.16 / bw, d0 + 2.0 ), vec2( fwu, fwv ) );",
    "      mfEmit += vec3( 1.0, 0.78, 0.45 ) * sc * 2.0 * uMfNight;",
    "    }",
    "  }",
    // ---- a garage door: the whole face ----
    "  if ( fGAR > 0.5 ) {",
    "    float gd = mfBox( vec2( cu, v ), vec2( 0.07, 0.0 ), vec2( 0.93, 2.3 ), vec2( fwu, fwv ) );",
    "    vec3 gc = vec3( 0.86, 0.85, 0.82 ) * ( 1.0 - 0.14 * mfLine( v, 0.55, 0.02, fwv ) );",
    "    col = mix( col, gc, gd ); wm = 0.0; wAvg = 0.0;",
    "  }",
    // ---- the clock face (campus tower): no numerals, no text ----
    "  if ( fSPEC > 0.5 && mode > 6.5 && mode < 7.5 ) {",
    "    vec2 cp = vec2( um - bays * bw * 0.5, v - top );",
    "    float d = length( cp );",
    "    float aa = max( fwum, fwv );",
    "    float disc = 1.0 - smoothstep( 2.3 - aa, 2.3 + aa, d );",
    "    float rim = disc - ( 1.0 - smoothstep( 2.05 - aa, 2.05 + aa, d ) );",
    "    vec2 hd = vec2( -0.866, 0.5 ), md = vec2( 0.866, 0.5 );",
    "    float hh = 1.0 - smoothstep( 0.07, 0.07 + aa, length( cp - hd * clamp( dot( cp, hd ), 0.0, 1.2 ) ) );",
    "    float mh = 1.0 - smoothstep( 0.05, 0.05 + aa, length( cp - md * clamp( dot( cp, md ), 0.0, 1.8 ) ) );",
    "    col = mix( col, vec3( 0.9, 0.87, 0.78 ), disc );",
    "    col = mix( col, vec3( 0.08 ), clamp( rim + ( hh + mh ) * disc, 0.0, 1.0 ) );",
    "    mfEmit += vec3( 0.95, 0.88, 0.7 ) * disc * ( 1.0 - clamp( rim + hh + mh, 0.0, 1.0 ) ) * 0.7 * uMfNight;",
    "  }",
    // ---- ground contact grime on every wall ----
    "  col *= mix( 1.0, 0.84 + 0.16 * smoothstep( -0.3, 2.2, v ), wall );",
    // ---- street-canyon occlusion: the lower storeys see less sky (the
    //      buildings across the street hide it), so a facade darkens toward
    //      its foot; from a distance this is what seats a city on its ground
    "  col *= mix( 1.0, 0.9 + 0.1 * smoothstep( 0.0, 14.0, v ), wall );",
    // ---- glass: interior by day, a reflected sky, lit rooms by night ----
    "  float g = mix( wm, wAvg, blur );",
    "  if ( g + glassy > 0.001 ) {",
    "    vec3 gt = vMfG.rgb;",
    "    float bl = step( 0.68, mfH( vec3( cellH * 91.0, seed, 5.0 ) ) ) * step( 1.0 - 0.5 * mfH( vec3( cellH * 13.0, 2.0, seed ) ), lvl );",
    "    vec3 inter = mix( gt * 0.55, vec3( 0.72, 0.69, 0.62 ), bl * 0.8 * ( 1.0 - blur ) );",
    "    float ndv = clamp( dot( N, Vd ), 0.0, 1.0 );",
    "    float fres = 0.05 + 0.95 * pow( 1.0 - ndv, 5.0 );",
    "    vec3 R = reflect( -Vd, N );",
    "    vec3 sky = mix( uMfSky, uMfZen, smoothstep( 0.02, 0.7, R.y ) );",
    "    sky = mix( uMfSky * 0.38, sky, smoothstep( -0.06, 0.03, R.y + ( cellH - 0.5 ) * 0.05 ) );",
    "    float rk = reflK * ( 0.3 + 0.7 * fres ) * ( 0.85 + 0.3 * cellH );",
    "    float gAll = clamp( g + glassy * ( 1.0 - g ), 0.0, 1.0 );",
    "    col = mix( col, mix( inter, gt * 0.9, glassy * ( 1.0 - g ) ) * ( 1.0 - rk ), gAll );",
    "    mfEmit += sky * rk * gAll;",
    "    float litOn = mix( step( cellH, litP ), litP, blur );",
    "    float warm = step( 0.32, mfH( vec3( cellH * 7.0, seed * 0.37, 11.0 ) ) );",
    "    vec3 lc = mix( vec3( 0.62, 0.74, 1.0 ), vec3( 1.0, 0.74, 0.42 ), warm ) * ( 0.55 + 0.6 * mfH( vec3( cellH * 3.3, 1.0, seed ) ) );",
    "    lc *= mix( 0.7 + 0.5 * clamp( lvl, 0.0, 1.0 ), 0.95, blur );",
    "    mfEmit += lc * litOn * g * uMfNight * 1.25 * litK;",
    "  }",
    // ---- THE ALBEDO IS DECODED. Every colour above (the plan's district
    //      palettes, the deck/plant tables, the shader's own trims) is an
    //      sRGB DISPLAY colour, and it used to go to the lights as if it were
    //      linear reflectance: limestone 0xcdbf9f reflected 80%, a gravel roof
    //      52%, brick 0x8a3b26 came out salmon. Through the lights, the graded
    //      ACES and the fog every pale wall and every roof landed at 220-250,
    //      the horizon's own white, and brick at (235,170,130): "they look
    //      all the same and white. And some like orangish". Decoded (the
    //      sRGB curve, polynomial fit) and eased 30% toward grey (the grade
    //      adds +14% saturation and ACES pushes reds to orange), limestone
    //      lands at ~230 in sun / 200 in shade, brick is brick red, tar and
    //      gravel roofs are 50-170, glass reads dark. Near and far are one
    //      material, so the swap still matches.
    "  col = max( col, vec3( 0.0 ) );",
    "  col = col * ( col * ( col * 0.305306011 + 0.682171111 ) + 0.012522878 );",
    "  diffuseColor.rgb = mix( vec3( dot( col, vec3( 0.2126, 0.7152, 0.0722 ) ) ), col, 0.7 );",
    "}",
  ].join("\n");

  // ---------------------------------------------------------------------
  //  MATERIALS
  // ---------------------------------------------------------------------
  const U = {
    uMfNight: { value: 0 }, uMfLate: { value: 0 },
    uMfSky: { value: new THREE.Color(0.62, 0.7, 0.8) }, uMfZen: { value: new THREE.Color(0.36, 0.5, 0.7) },
  };
  let mat = null, hooked = false;
  function injectFrag(sh) {
    Object.assign(sh.uniforms, U);
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\n" + MF_PARS)
      .replace("#include <color_fragment>", "#include <color_fragment>\n" + MF_MAIN)
      .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance += mfEmit;");
  }
  function okShader(sh) {
    return sh.vertexShader.indexOf("#include <project_vertex>") >= 0 && sh.fragmentShader.indexOf("#include <color_fragment>") >= 0 &&
      sh.fragmentShader.indexOf("#include <emissivemap_fragment>") >= 0;
  }
  function material() {
    if (mat) return mat;
    mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    mat.name = "metro-fabric";
    mat.fog = true;
    mat.extensions = { derivatives: true };           // WebGL1: fwidth (r128 reads material.extensions.derivatives)
    mat.userData.metroFabric = true;
    mat.onBeforeCompile = function (sh) {
      if (!okShader(sh)) return;
      injectFrag(sh);
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nattribute vec4 aMfC;\nattribute vec4 aMfG;\nattribute vec4 aMfP;\nattribute vec4 aMfU;\n" + MF_VARY)
        .replace("#include <project_vertex>", [
          "#include <project_vertex>",
          "vMfC = aMfC; vMfG = aMfG; vMfP = aMfP;",
          "vMfU = vec4( aMfU.x / 32.0, aMfU.y / 16.0, aMfU.z / 16.0, aMfU.w );",
          "vec4 mfW = modelMatrix * vec4( transformed, 1.0 );",
          "vMfV = cameraPosition - mfW.xyz;",
          "vMfN = normalize( mat3( modelMatrix ) * objectNormal );",
        ].join("\n"));
    };
    mat.customProgramCacheKey = function () { return "cbzMetroFabric2"; };
    // atmospheric perspective of the land it stands on (see the header):
    // the fog's scale, and with it the air (terrain_overhaul.js aerialHaze)
    // that fills the kilometres the scaled fog never reaches: blue-grey,
    // not white
    if (CBZ.terrainFogScale) CBZ.terrainFogScale(mat, FOG_SCALE);
    hook();
    return mat;
  }
  // per-frame: night, "how late", and the sky the glass reflects (the fog
  // colour IS the horizon every other system matches)
  const _zen = new THREE.Color();
  let lateT = 0;
  function tick(dt) {
    const n = CBZ.nightAmount == null ? 0 : Math.max(0, Math.min(1, CBZ.nightAmount));
    U.uMfNight.value = n;
    dt = +dt || 0.016;
    const hour = typeof CBZ.hourSeconds === "function" ? Math.max(1, CBZ.hourSeconds()) : 60;
    if (n > 0.85) lateT = Math.min(1, lateT + dt / (hour * 5));
    else if (n < 0.3) lateT = Math.max(0, lateT - dt / (hour * 2));
    U.uMfLate.value = lateT;
    const sc = CBZ.scene;
    if (sc && sc.fog && sc.fog.color) {
      U.uMfSky.value.copy(sc.fog.color);
      _zen.copy(sc.fog.color); _zen.r *= 0.62; _zen.g *= 0.76; _zen.b *= 1.02;
      U.uMfZen.value.copy(_zen);
    }
  }
  function hook() {
    if (hooked || typeof CBZ.onAlways !== "function") return;
    hooked = true;
    CBZ.onAlways(95, tick);
  }

  // ---------------------------------------------------------------------
  //  THE WRITER: typed arrays, grown by doubling, sliced once per tile
  // ---------------------------------------------------------------------
  let CAP = 0, ICAP = 0, nv = 0, ni = 0;
  // FAR: the tile being written is the distant HLOD of the same buildings —
  // every mass, roof and setback at its true size, minus the parts under a
  // pixel past ~1 km (AC boxes, awnings, stoops, soffits, parapet returns)
  let FAR = false;
  let POS = null, NRM = null, AC = null, AG = null, AP = null, AU = null, IDX = null;
  function growV(n) {
    let c = Math.max(CAP * 2, 65536); while (c < n) c *= 2;
    const p = new Float32Array(c * 3), nr = new Int8Array(c * 4), ac = new Uint8Array(c * 4), ag = new Uint8Array(c * 4),
      ap = new Uint8Array(c * 4), au = new Int16Array(c * 4);
    if (POS) { p.set(POS); nr.set(NRM); ac.set(AC); ag.set(AG); ap.set(AP); au.set(AU); }
    POS = p; NRM = nr; AC = ac; AG = ag; AP = ap; AU = au; CAP = c;
  }
  function growI(n) {
    let c = Math.max(ICAP * 2, 131072); while (c < n) c *= 2;
    const ix = new Uint32Array(c); if (IDX) ix.set(IDX); IDX = ix; ICAP = c;
  }
  function need(v, i) { if (nv + v > CAP) growV(nv + v); if (ni + i > ICAP) growI(ni + i); }

  // brush: what every vertex written next carries
  let bC0 = 128, bC1 = 128, bC2 = 128, bSeed = 0, bG0 = 60, bG1 = 70, bG2 = 80, bFl = 0;
  let bMode = 0, bFh = 30, bBay = 30, bDoor = 255, bTop = 0, bBays = 0;
  // transform: local (x,z) -> world, then minus the tile origin
  let tX = 0, tZ = 0, tC = 1, tS = 0, oX = 0, oZ = 0;
  function frame(x, z, rot) { tX = x; tZ = z; tC = Math.cos(rot || 0); tS = Math.sin(rot || 0); }
  function i16(x) { x = Math.round(x); return x < -32768 ? -32768 : x > 32767 ? 32767 : x; }
  function n8(x) { return (x * 127 + (x < 0 ? -0.5 : 0.5)) | 0; }

  function vert(lx, ly, lz, nx, ny, nz, u, v) {
    const k = nv++;
    const k3 = k * 3, k4 = k * 4;
    POS[k3] = tX + lx * tC + lz * tS - oX; POS[k3 + 1] = ly; POS[k3 + 2] = tZ - lx * tS + lz * tC - oZ;
    NRM[k4] = n8(nx * tC + nz * tS); NRM[k4 + 1] = n8(ny); NRM[k4 + 2] = n8(-nx * tS + nz * tC); NRM[k4 + 3] = 0;
    AC[k4] = bC0; AC[k4 + 1] = bC1; AC[k4 + 2] = bC2; AC[k4 + 3] = bSeed;
    AG[k4] = bG0; AG[k4 + 1] = bG1; AG[k4 + 2] = bG2; AG[k4 + 3] = bFl;
    AP[k4] = bMode; AP[k4 + 1] = bFh; AP[k4 + 2] = bBay; AP[k4 + 3] = bDoor;
    AU[k4] = i16(u * 32); AU[k4 + 1] = i16(v * 16); AU[k4 + 2] = bTop; AU[k4 + 3] = bBays;
    return k;
  }
  // a planar quad a,b,c,d (in order round the edge) with uv (u0,v0)..(u1,v1);
  // the normal is the geometry's, turned to agree with the hint (hx,hy,hz)
  function quad(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz, hx, hy, hz, u0, v0, u1, v1) {
    const e1x = bx - ax, e1y = by - ay, e1z = bz - az, e2x = dx - ax, e2y = dy - ay, e2z = dz - az;
    let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    let L = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (L < 1e-9) {                       // collapsed on one edge: use the other diagonal
      const fx = cx - ax, fy = cy - ay, fz = cz - az;
      nx = e1y * fz - e1z * fy; ny = e1z * fx - e1x * fz; nz = e1x * fy - e1y * fx;
      L = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (L < 1e-9) return;
    }
    nx /= L; ny /= L; nz /= L;
    const flip = nx * hx + ny * hy + nz * hz < 0;
    if (flip) { nx = -nx; ny = -ny; nz = -nz; }
    need(4, 6);
    const s = vert(ax, ay, az, nx, ny, nz, u0, v0);
    vert(bx, by, bz, nx, ny, nz, u1, v0);
    vert(cx, cy, cz, nx, ny, nz, u1, v1);
    vert(dx, dy, dz, nx, ny, nz, u0, v1);
    if (!flip) { IDX[ni++] = s; IDX[ni++] = s + 1; IDX[ni++] = s + 2; IDX[ni++] = s; IDX[ni++] = s + 2; IDX[ni++] = s + 3; }
    else { IDX[ni++] = s; IDX[ni++] = s + 2; IDX[ni++] = s + 1; IDX[ni++] = s; IDX[ni++] = s + 3; IDX[ni++] = s + 2; }
  }
  function tri(ax, ay, az, bx, by, bz, cx, cy, cz, hx, hy, hz, ua, va, ub, vb, uc, vc) {
    const e1x = bx - ax, e1y = by - ay, e1z = bz - az, e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
    let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    const L = Math.sqrt(nx * nx + ny * ny + nz * nz); if (L < 1e-9) return;
    nx /= L; ny /= L; nz /= L;
    const flip = nx * hx + ny * hy + nz * hz < 0;
    if (flip) { nx = -nx; ny = -ny; nz = -nz; }
    need(3, 3);
    const s = vert(ax, ay, az, nx, ny, nz, ua, va);
    vert(bx, by, bz, nx, ny, nz, ub, vb);
    vert(cx, cy, cz, nx, ny, nz, uc, vc);
    if (!flip) { IDX[ni++] = s; IDX[ni++] = s + 1; IDX[ni++] = s + 2; } else { IDX[ni++] = s; IDX[ni++] = s + 2; IDX[ni++] = s + 1; }
  }
  // index a triangle of already-written vertices, wound to face the hint (world)
  function triIdx(a, b, c, hx, hy, hz) {
    const a3 = a * 3, b3 = b * 3, c3 = c * 3;
    const e1x = POS[b3] - POS[a3], e1y = POS[b3 + 1] - POS[a3 + 1], e1z = POS[b3 + 2] - POS[a3 + 2];
    const e2x = POS[c3] - POS[a3], e2y = POS[c3 + 1] - POS[a3 + 1], e2z = POS[c3 + 2] - POS[a3 + 2];
    const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    need(0, 3);
    if (nx * hx + ny * hy + nz * hz >= 0) { IDX[ni++] = a; IDX[ni++] = b; IDX[ni++] = c; }
    else { IDX[ni++] = a; IDX[ni++] = c; IDX[ni++] = b; }
  }

  // ---------------------------------------------------------------------
  //  BRUSHES
  // ---------------------------------------------------------------------
  function hexC(h) { bC0 = (h >> 16) & 255; bC1 = (h >> 8) & 255; bC2 = h & 255; }
  function hexG(h) { bG0 = (h >> 16) & 255; bG1 = (h >> 8) & 255; bG2 = h & 255; }
  function shade(h, k) {
    const r = Math.min(255, Math.round(((h >> 16) & 255) * k)), g = Math.min(255, Math.round(((h >> 8) & 255) * k)), b = Math.min(255, Math.round((h & 255) * k));
    return (r << 16) | (g << 8) | b;
  }
  function q10(x) { return Math.max(1, Math.min(255, Math.round(x * 10))); }
  // a facade: mode, floor height, bay width; top (storey top, metres); flags set per face
  function facade(hex, glass, mode, fh, bay, top) {
    hexC(hex); hexG(glass == null ? 0x2f3a44 : glass);
    bMode = mode; bFh = q10(fh); bBay = q10(bay); bTop = i16(top * 16); bFl = 0; bDoor = 255; bBays = 1;
  }
  function plain(hex, mode, fl) {
    hexC(hex); bMode = mode || M_PLAIN; bFl = fl || 0; bFh = 30; bBay = 10; bTop = 0; bBays = 0; bDoor = 255;
  }
  // bays on a face of length len for the current brush
  function baysFor(len) { return Math.max(1, Math.round(len / (bBay / 10))); }

  // ---------------------------------------------------------------------
  //  PRIMITIVES (local frame)
  // ---------------------------------------------------------------------
  // face k of a box centred (ox,oz): 0 = +Z front, 1 = +X, 2 = -Z, 3 = -X.
  // L = left corner as seen from outside, (rx,rz) = left-to-right, (nx,nz) = out.
  const FK = [
    { lx: -1, lz: 1, rx: 1, rz: 0, nx: 0, nz: 1 }, { lx: 1, lz: 1, rx: 0, rz: -1, nx: 1, nz: 0 },
    { lx: 1, lz: -1, rx: -1, rz: 0, nx: 0, nz: -1 }, { lx: -1, lz: -1, rx: 0, rz: 1, nx: -1, nz: 0 },
  ];
  function faceLen(k, hw, hd) { return (k & 1) ? 2 * hd : 2 * hw; }
  // four facade walls; perFace(k, len) may set bFl/bDoor and return false to skip a face
  function walls(ox, oz, hw, hd, y0, y1, perFace) {
    const fl0 = bFl, d0 = bDoor;
    for (let k = 0; k < 4; k++) {
      const f = FK[k], len = faceLen(k, hw, hd);
      bFl = fl0; bDoor = d0;
      if (perFace && perFace(k, len) === false) continue;
      const bays = baysFor(len); bBays = bays;
      const ax = ox + f.lx * hw, az = oz + f.lz * hd, bx = ax + f.rx * len, bz = az + f.rz * len;
      quad(ax, y0, az, bx, y0, bz, bx, y1, bz, ax, y1, az, f.nx, 0, f.nz, 0, y0 - GY, bays, y1 - GY);
    }
    bFl = fl0; bDoor = d0;
  }
  function topQuad(ox, oz, hw, hd, y) {
    quad(ox - hw, y, oz - hd, ox + hw, y, oz - hd, ox + hw, y, oz + hd, ox - hw, y, oz + hd, 0, 1, 0, 0, 0, 2 * hw, 2 * hd);
  }
  // a plain box: 4 sides + top (no bottom); u,v in metres
  function box(ox, oz, hw, hd, y0, y1, noTop) {
    for (let k = 0; k < 4; k++) {
      const f = FK[k], len = faceLen(k, hw, hd);
      const ax = ox + f.lx * hw, az = oz + f.lz * hd, bx = ax + f.rx * len, bz = az + f.rz * len;
      quad(ax, y0, az, bx, y0, bz, bx, y1, bz, ax, y1, az, f.nx, 0, f.nz, 0, 0, len, y1 - y0);
    }
    if (!noTop) topQuad(ox, oz, hw, hd, y1);
  }
  // parapet: inner faces + a coping ring; the outer face is the facade (walls run to yTop)
  function parapet(ox, oz, hw, hd, yDeck, yTop, t, wallHex, deckHex) {
    const ih = hw - t, id = hd - t;
    if (FAR || ih < 0.5 || id < 0.5) { plain(deckHex, M_DECK); topQuad(ox, oz, hw, hd, yTop); return; }
    plain(shade(wallHex, 0.86));
    for (let k = 0; k < 4; k++) {
      const f = FK[k], len = faceLen(k, ih, id);
      const ax = ox + f.lx * ih, az = oz + f.lz * id, bx = ax + f.rx * len, bz = az + f.rz * len;
      quad(ax, yDeck, az, bx, yDeck, bz, bx, yTop, bz, ax, yTop, az, -f.nx, 0, -f.nz, 0, 0, len, yTop - yDeck);
    }
    // coping ring (8 verts, all up)
    plain(shade(wallHex, 1.18));
    need(8, 24);
    const s = nv;
    const O = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]], I = [[-ih, -id], [ih, -id], [ih, id], [-ih, id]];
    for (let k = 0; k < 4; k++) vert(ox + O[k][0], yTop, oz + O[k][1], 0, 1, 0, O[k][0] + hw, O[k][1] + hd);
    for (let k = 0; k < 4; k++) vert(ox + I[k][0], yTop, oz + I[k][1], 0, 1, 0, I[k][0] + hw, I[k][1] + hd);
    for (let k = 0; k < 4; k++) {
      const k1 = (k + 1) & 3;
      triIdx(s + k, s + k1, s + 4 + k1, 0, 1, 0); triIdx(s + k, s + 4 + k1, s + 4 + k, 0, 1, 0);
    }
    plain(deckHex, M_DECK);
    topQuad(ox, oz, ih, id, yDeck);
  }
  // a gable roof over a body centred (ox,oz): ridge along local X when alongX
  function gable(ox, oz, hw, hd, yE, pitch, over, alongX, roofHex, trimHex, wallBrushFn) {
    const hl = alongX ? hw : hd, hc = alongX ? hd : hw;
    const rise = hc * pitch, yR = yE + rise, yT = yE - over * pitch, rk = 0.3;
    const P = function (al, ac) { return alongX ? [ox + al, oz + ac] : [ox + ac, oz + al]; };
    const hint = function (al, ac) { return alongX ? [al, ac] : [ac, al]; };
    const slant = Math.hypot(hc + over, rise + over * pitch);
    plain(roofHex, M_SHINGLE);
    for (let s = -1; s <= 1; s += 2) {
      const a = P(-hl - rk, s * (hc + over)), b = P(hl + rk, s * (hc + over)), c = P(hl + rk, 0), d = P(-hl - rk, 0), h = hint(0, s);
      quad(a[0], yT, a[1], b[0], yT, b[1], c[0], yR, c[1], d[0], yR, d[1], h[0], 1, h[1], 0, 0, 2 * (hl + rk), slant);
    }
    // soffits + fascia
    plain(trimHex);
    if (!FAR) for (let s = -1; s <= 1; s += 2) {
      const a = P(-hl - rk, s * hc), b = P(hl + rk, s * hc), c = P(hl + rk, s * (hc + over)), d = P(-hl - rk, s * (hc + over)), h = hint(0, s);
      quad(a[0], yT - 0.18, a[1], b[0], yT - 0.18, b[1], c[0], yT - 0.18, c[1], d[0], yT - 0.18, d[1], 0, -1, 0, 0, 0, 2 * (hl + rk), over);
      quad(d[0], yT - 0.18, d[1], c[0], yT - 0.18, c[1], c[0], yT, c[1], d[0], yT, d[1], h[0], 0, h[1], 0, 0, 2 * (hl + rk), 0.18);
    }
    // gable-end triangles in the wall's own facade
    wallBrushFn();
    for (let s = -1; s <= 1; s += 2) {
      const a = P(s * hl, -hc), b = P(s * hl, hc), c = P(s * hl, 0), h = hint(s, 0);
      const bays = baysFor(2 * hc); bBays = bays;
      // left-to-right from outside: right = (n.z, -n.x)
      const rx = h[1], rz = -h[0];
      const ua = ((a[0] - ox) * rx + (a[1] - oz) * rz + hc) / (2 * hc) * bays, ub = ((b[0] - ox) * rx + (b[1] - oz) * rz + hc) / (2 * hc) * bays;
      tri(a[0], yE, a[1], b[0], yE, b[1], c[0], yR, c[1], h[0], 0, h[1], ua, yE - GY, ub, yE - GY, bays / 2, yR - GY);
    }
    return yR;
  }
  // a hip roof (ridge along the longer side)
  function hip(ox, oz, hw, hd, yE, pitch, over, roofHex, trimHex) {
    const alongX = hw >= hd, hl = alongX ? hw : hd, hc = alongX ? hd : hw;
    const rise = hc * pitch, yR = yE + rise, yT = yE - over * pitch, rh = Math.max(0, hl - hc);
    const P = function (al, ac) { return alongX ? [ox + al, oz + ac] : [ox + ac, oz + al]; };
    const hint = function (al, ac) { return alongX ? [al, ac] : [ac, al]; };
    const eL = hl + over, eC = hc + over, slant = Math.hypot(eC, rise + over * pitch);
    plain(roofHex, M_SHINGLE);
    for (let s = -1; s <= 1; s += 2) {
      const a = P(-eL, s * eC), b = P(eL, s * eC), c = P(rh, 0), d = P(-rh, 0), h = hint(0, s);
      quad(a[0], yT, a[1], b[0], yT, b[1], c[0], yR, c[1], d[0], yR, d[1], h[0], 1, h[1], 0, 0, 2 * eL, slant);
      const e = P(s * eL, -eC), f = P(s * eL, eC), g = P(s * rh, 0), hh = hint(s, 0);
      const sl2 = Math.hypot(eL - rh, rise + over * pitch);
      tri(e[0], yT, e[1], f[0], yT, f[1], g[0], yR, g[1], hh[0], 1, hh[1], 0, 0, 2 * eC, 0, eC, sl2);
    }
    // soffit ring + fascia
    if (FAR) return yR;
    plain(trimHex);
    const ys = yT - 0.18;
    need(8, 24);
    const s0 = nv;
    const O = [P(-eL, -eC), P(eL, -eC), P(eL, eC), P(-eL, eC)], I = [P(-hl, -hc), P(hl, -hc), P(hl, hc), P(-hl, hc)];
    for (let k = 0; k < 4; k++) vert(O[k][0], ys, O[k][1], 0, -1, 0, 0, 0);
    for (let k = 0; k < 4; k++) vert(I[k][0], ys, I[k][1], 0, -1, 0, 0, 0);
    for (let k = 0; k < 4; k++) {
      const k1 = (k + 1) & 3;
      triIdx(s0 + k, s0 + k1, s0 + 4 + k1, 0, -1, 0); triIdx(s0 + k, s0 + 4 + k1, s0 + 4 + k, 0, -1, 0);
    }
    for (let k = 0; k < 4; k++) {
      const a = O[k], b = O[(k + 1) & 3];
      const mx = (a[0] + b[0]) / 2 - ox, mz = (a[1] + b[1]) / 2 - oz;
      quad(a[0], ys, a[1], b[0], ys, b[1], b[0], yT, b[1], a[0], yT, a[1], mx, 0, mz, 0, 0, Math.hypot(b[0] - a[0], b[1] - a[1]), 0.18);
    }
    return yR;
  }
  // a cylinder with smooth normals; u in segments (bays), v metres above the lot
  function cylinder(cx, cz, r, y0, y1, seg) {
    need((seg + 1) * 2, seg * 6);
    const s = nv;
    for (let j = 0; j <= seg; j++) {
      const a = (j / seg) * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a);
      vert(cx + c * r, y0, cz + sn * r, c, 0, sn, j, y0 - GY);
      vert(cx + c * r, y1, cz + sn * r, c, 0, sn, j, y1 - GY);
    }
    for (let j = 0; j < seg; j++) {
      const a = s + j * 2, b = a + 2;
      const am = (j + 0.5) / seg * Math.PI * 2, hx = Math.cos(am), hz = Math.sin(am);
      const wx = hx * tC + hz * tS, wz = -hx * tS + hz * tC;
      triIdx(a, b, b + 1, wx, 0, wz); triIdx(a, b + 1, a + 1, wx, 0, wz);
    }
  }
  function dome(cx, cz, r, y0, hgt, seg) {
    const rings = 3;
    need(seg * rings + 1 + seg, seg * rings * 6);
    const s = nv;
    for (let i = 0; i < rings; i++) {
      const ph = (i / rings) * Math.PI / 2, rr = Math.cos(ph) * r, yy = y0 + Math.sin(ph) * hgt;
      for (let j = 0; j < seg; j++) {
        const a = (j / seg) * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a);
        const nx = c * Math.cos(ph) / r, ny = Math.sin(ph) / hgt, nz = sn * Math.cos(ph) / r, L = Math.hypot(nx, ny, nz);
        vert(cx + c * rr, yy, cz + sn * rr, nx / L, ny / L, nz / L, j * rr * 0.5, i * 2);
      }
    }
    const apex = vert(cx, y0 + hgt, cz, 0, 1, 0, 0, rings * 2);
    for (let i = 0; i < rings; i++) for (let j = 0; j < seg; j++) {
      const j1 = (j + 1) % seg, a = s + i * seg + j, b = s + i * seg + j1;
      const am = (j + 0.5) / seg * Math.PI * 2, hx = Math.cos(am), hz = Math.sin(am);
      const wx = hx * tC + hz * tS, wz = -hx * tS + hz * tC;
      if (i < rings - 1) { const c = a + seg, d = b + seg; triIdx(a, b, d, wx, 0.6, wz); triIdx(a, d, c, wx, 0.6, wz); }
      else triIdx(a, b, apex, wx, 1, wz);
    }
  }
  function pyramid(ox, oz, hb, ht, y0, y1) {   // square frustum (ht = top half-size)
    for (let k = 0; k < 4; k++) {
      const f = FK[k];
      const ax = ox + f.lx * hb, az = oz + f.lz * hb, bx = ax + f.rx * 2 * hb, bz = az + f.rz * 2 * hb;
      const dx = ox + f.lx * ht, dz = oz + f.lz * ht, cx = dx + f.rx * 2 * ht, cz = dz + f.rz * 2 * ht;
      quad(ax, y0, az, bx, y0, bz, cx, y1, cz, dx, y1, dz, f.nx, 0.3, f.nz, 0, 0, 2 * hb, Math.hypot(y1 - y0, hb - ht));
    }
    if (ht > 0.05) topQuad(ox, oz, ht, ht, y1);
  }
  // awning on face k of a box: fabric slope + valance + underside
  function awning(k, ox, oz, hw, hd, y, hex) {
    const f = FK[k], len = faceLen(k, hw, hd) - 1.0;
    if (FAR || len < 2) return;
    const cxw = ox + f.nx * hw, czw = oz + f.nz * hd;       // face centre
    const ax = cxw - f.rx * len / 2, az = czw - f.rz * len / 2, bx = ax + f.rx * len, bz = az + f.rz * len;
    const o = 1.3, dy = 0.45;
    plain(hex, M_PLAIN, hq(ox + k, oz, 811) < 0.4 ? F_SPEC : 0);
    quad(ax, y, az, bx, y, bz, bx + f.nx * o, y - dy, bz + f.nz * o, ax + f.nx * o, y - dy, az + f.nz * o, f.nx, 1, f.nz, 0, 0, len, 1.4);
    quad(ax, y, az, bx, y, bz, bx + f.nx * o, y - dy, bz + f.nz * o, ax + f.nx * o, y - dy, az + f.nz * o, -f.nx * 0.3, -1, -f.nz * 0.3, 0, 0, len, 1.4);
    quad(ax + f.nx * o, y - dy - 0.28, az + f.nz * o, bx + f.nx * o, y - dy - 0.28, bz + f.nz * o, bx + f.nx * o, y - dy, bz + f.nz * o, ax + f.nx * o, y - dy, az + f.nz * o, f.nx, 0, f.nz, 0, 0, len, 0.28);
  }

  // ---------------------------------------------------------------------
  //  ROOFTOP PLANT
  // ---------------------------------------------------------------------
  function plantBox(x, z, hw, hd, y0, h, hex) { plain(hex); box(x, z, hw, hd, y0, y0 + h); }
  function waterTank(x, z, y0) {
    plain(0x2d2d2f); cylinder(x, z, 1.3, y0, y0 + 2.4, 8);
    facade(0x7a5a3e, 0, M_METAL, 3, 1, 0); bFl = F_BLANK; bBay = q10(1.7); cylinder(x, z, 2.1, y0 + 2.4, y0 + 6.0, 8);
    // conical cap
    plain(0x4a3a2c);
    need(9, 24);
    const s = nv;
    for (let j = 0; j < 8; j++) {
      const a = (j / 8) * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a);
      vert(x + c * 2.2, y0 + 6.0, z + sn * 2.2, c * 0.7, 0.7, sn * 0.7, j, 0);
    }
    const ap = vert(x, y0 + 7.1, z, 0, 1, 0, 0, 1);
    for (let j = 0; j < 8; j++) triIdx(s + j, s + ((j + 1) & 7), ap, 0, 1, 0);
  }
  // hash-placed plant on a deck rectangle (local frame)
  function roofPlant(b, ox, oz, hw, hd, y, kind) {
    const sx = b.x, sz = b.z;
    const n = kind === "tower" ? 3 : kind === "office" ? 3 : kind === "apt" ? 2 : kind === "strip" ? 5 : kind === "mall" ? 9 : kind === "ware" ? 3 : 1;
    if (hw < 2.5 || hd < 2.5) return;
    if (kind === "tower" || kind === "office" || kind === "apt") {
      // the lift/stair headhouse
      const hh = kind === "apt" ? 1.6 : Math.min(hw * 0.32, 6), hdd = kind === "apt" ? 1.6 : Math.min(hd * 0.26, 4.5);
      const px = ox + (hq(sx, sz, 901) - 0.5) * (hw - hh - 1) * 1.2, pz = oz + (hq(sx, sz, 902) - 0.5) * (hd - hdd - 1) * 1.2;
      plantBox(px, pz, hh, hdd, y, kind === "apt" ? 2.7 : 4.2, shade(b.wall, 0.9));
      if (FAR) return;
      if (kind === "apt" && hq(sx, sz, 903) < 0.45 && hw > 5 && hd > 5) {
        const tx = ox - Math.sign(px - ox || 1) * (hw * 0.45), tz = oz - Math.sign(pz - oz || 1) * (hd * 0.4);
        waterTank(tx, tz, y);
      }
    }
    if (FAR) return;
    for (let i = 0; i < n; i++) {
      if (hq(sx + i, sz, 910) < 0.3) continue;
      const w = kind === "ware" ? 0.7 : 1.2 + hq(sx, sz + i, 911) * 1.0, d = kind === "ware" ? 0.7 : 0.9 + hq(sx + i, sz + i, 912) * 0.7;
      const h = kind === "ware" ? 1.0 : 1.2 + hq(sx, sz, 913 + i) * 0.8;
      const px = ox + (hq(sx, sz, 920 + i) - 0.5) * Math.max(0, hw - w - 1.2) * 2, pz = oz + (hq(sx, sz, 940 + i) - 0.5) * Math.max(0, hd - d - 1.2) * 2;
      plantBox(px, pz, w, d, y, h, PLANT[(hq(sx, sz, 960 + i) * 4) | 0]);
    }
  }

  // ---------------------------------------------------------------------
  //  BUILDINGS
  // ---------------------------------------------------------------------
  let COLS = null, REF = null;
  function aabb(minX, maxX, minZ, maxZ, y0, y1) { COLS.push({ minX: minX, maxX: maxX, minZ: minZ, maxZ: maxZ, y0: y0, y1: y1, ref: REF }); }
  function oriented(cx, cz, hw, hd, yaw, y0, y1) {
    const c = CBZ.orientedCollider ? CBZ.orientedCollider(cx, cz, hw, hd, yaw, y0, y1) : fallbackOriented(cx, cz, hw, hd, yaw, y0, y1);
    c.ref = REF; COLS.push(c);
  }
  function fallbackOriented(cx, cz, hw, hd, yaw, y0, y1) {
    const ac = Math.abs(Math.cos(yaw)), as = Math.abs(Math.sin(yaw));
    const ex = hw * ac + hd * as, ez = hw * as + hd * ac;
    const c = { minX: cx - ex, maxX: cx + ex, minZ: cz - ez, maxZ: cz + ez, y0: y0, y1: y1 };
    if (as > 1e-4 && ac > 1e-4) { c.cx = cx; c.cz = cz; c.hw = hw; c.hd = hd; c.yaw = yaw; }
    return c;
  }
  function seedOf(b) { return (hq(b.x, b.z, 7) * 255) | 0; }
  function deckOf(b) { return DECKS[(hq(b.x, b.z, 71) * DECKS.length) | 0]; }
  const FACE_K = { n: 0, e: 1, s: 2, w: 3 };
  const FACE_ROT = { n: 0, e: Math.PI / 2, s: Math.PI, w: -Math.PI / 2 };
  function grammarOf(P, b) { const d = P.districts && P.districts[b.dist]; return d && d.look ? d.look.grammar : ""; }

  function tower(P, b, mask) {
    frame(0, 0, 0);
    const sm = STYLE[b.style] || STYLE.glass, mode = sm[0], bay = sm[1], fh = b.fh || 3.9;
    const tiers = b.tiers && b.tiers.length ? b.tiers : [{ w: b.w, d: b.d, y0: 0, y1: b.h, x: b.x, z: b.z }];
    const seed = seedOf(b), deck = deckOf(b);
    let topY = GY + b.h;
    for (let k = 0; k < tiers.length; k++) {
      const t = tiers[k], last = k === tiers.length - 1;
      const y0 = k === 0 ? FOOT : GY + t.y0, y1 = GY + t.y1;
      const par = last ? (mode === M_GLASS ? 2.4 : 1.3) : 1.0;
      facade(b.wall, b.glass, mode, fh, bay, t.y1); bSeed = seed;
      const first = k === 0;
      walls(t.x, t.z, t.w / 2, t.d / 2, y0, y1 + par, function (f) {
        bFl = F_OFFICE | (first && b.shop ? F_SHOP : 0);
        if (first && f === 0 && mode !== M_GLASS) { bFl |= F_DOOR; bDoor = Math.floor(baysFor(t.w) / 2); }
      });
      parapet(t.x, t.z, t.w / 2, t.d / 2, y1, y1 + par - 0.1, 0.35, b.wall, deck);
      aabb(t.x - t.w / 2, t.x + t.w / 2, t.z - t.d / 2, t.z + t.d / 2, first ? 0 : y0, y1 + par);
      if (last) {
        topY = y1 + par;
        if (b.roof === "crown" || b.roof === "spire") {
          // the stepped crown: three shrinking lanterns, floodlit at night
          let w = t.w * 0.8, d = t.d * 0.8, y = y1;
          const steps = b.roof === "spire" ? 2 : 3;
          for (let s = 0; s < steps; s++) {
            const hgt = 4.5 - s * 0.6;
            plain(shade(b.wall, 1.12 + s * 0.04), M_PLAIN, F_DOCK);
            box(t.x, t.z, w / 2, d / 2, y, y + hgt);
            y += hgt; w *= 0.78; d *= 0.78;
          }
          topY = y;
          if (b.roof === "spire") {
            const hb = Math.max(1.2, 0.09 * Math.min(t.w, t.d)), sh = Math.max(28, 0.2 * b.h);
            plain(0xb8bcc0);
            pyramid(t.x, t.z, hb, 0.12, y, y + sh);
            topY = y + sh;
            aabb(t.x - hb, t.x + hb, t.z - hb, t.z + hb, y, topY);
          }
        } else {
          roofPlant(b, t.x, t.z, t.w / 2 - 0.4, t.d / 2 - 0.4, y1, "tower");
        }
      }
    }
    // an entrance canopy over the lobby on the front (+Z) face
    if (FAR) return topY;
    const t0 = tiers[0];
    plain(shade(b.wall, 0.7));
    const cw = Math.min(9, t0.w * 0.4);
    box(t0.x, t0.z + t0.d / 2 + 1.6, cw / 2, 1.6, GY + 4.3, GY + 4.75);
    return topY;
  }

  function slab(P, b, mask) {
    frame(0, 0, 0);
    const sm = STYLE[b.style] || STYLE.stone, mode = sm[0], bay = sm[1], fh = b.fh || 3.2;
    const seed = seedOf(b), deck = deckOf(b), hw = b.w / 2, hd = b.d / 2;
    const y1 = GY + b.h, par = 1.1;
    const office = b.type === "office";
    let doorFace = -1;
    for (let k = 0; k < 4; k++) if (mask & (1 << k)) { doorFace = k; break; }
    facade(b.wall, b.glass, mode, fh, bay, b.h); bSeed = seed;
    walls(b.x, b.z, hw, hd, FOOT, y1 + par, function (k, len) {
      bFl = (office ? F_OFFICE : 0) | (b.shop && (mask & (1 << k)) ? F_SHOP : 0);
      if (k === doorFace && mode !== M_GLASS) { bFl |= F_DOOR; bDoor = Math.floor(baysFor(len) / 2); }
    });
    parapet(b.x, b.z, hw, hd, y1, y1 + par - 0.1, 0.3, b.wall, deck);
    roofPlant(b, b.x, b.z, hw - 0.4, hd - 0.4, y1, office ? "office" : "apt");
    if (b.shop && !office) for (let k = 0; k < 4; k++) if (mask & (1 << k)) awning(k, b.x, b.z, hw, hd, GY + Math.min(3.0, fh - 0.2), AWNINGS[(hq(b.x + k, b.z, 812) * AWNINGS.length) | 0]);
    aabb(b.x - hw, b.x + hw, b.z - hd, b.z + hd, 0, y1 + par);
    return y1 + par;
  }

  function row(P, b) {
    const face = b.face && FACE_K[b.face] != null ? b.face : "s";
    const rot = FACE_ROT[face];
    frame(b.x, b.z, rot);
    const ns = face === "n" || face === "s";
    const Wd = ns ? b.w : b.d, Dp = ns ? b.d : b.w, hw = Wd / 2, hd = Dp / 2;
    const fh = b.fh || 3.1, st = b.st || 2;
    const deckY = GY + st * fh + 0.25, parTop = Math.max(deckY + 0.5, GY + b.h);
    const painted = grammarOf(P, b) === "victorian";
    const seed = seedOf(b), deck = deckOf(b);
    const mansard = b.roof === "mansard";
    facade(b.wall, b.glass, M_ROW, fh, 2.3, st * fh); bSeed = seed;
    const bays = baysFor(Wd);
    const doorBay = hq(b.x, b.z, 331) < 0.5 ? 0 : bays - 1;
    const hasDoor = !b.shop;
    walls(0, 0, hw, hd, FOOT, mansard ? deckY : parTop, function (k) {
      bFl = painted ? F_SPEC : 0;
      if (k === 0) { if (b.shop) bFl |= F_SHOP; else { bFl |= F_DOOR; bDoor = doorBay; } }
      else if (k === 1 || k === 3) bFl |= F_BLANK;
    });
    let top;
    if (mansard) {
      // the mansard storey: slate slopes, dormers front and back
      const y0 = deckY, h = 2.6, ins = 0.95, e = 0.12;
      const ow = hw + e, od = hd + e, iw = ow - ins, id = od - ins;
      hexC(0x4b4d55); bMode = M_MANSARD; bFh = 30; bBay = q10(2.4); bTop = 0; bDoor = 255; bSeed = seed;
      for (let k = 0; k < 4; k++) {
        const f = FK[k], len = faceLen(k, ow, od), ilen = faceLen(k, iw, id);
        bFl = (k === 1 || k === 3) ? F_BLANK : 0;
        const bys = baysFor(len); bBays = bys;
        const ax = f.lx * ow, az = f.lz * od, bx = ax + f.rx * len, bz = az + f.rz * len;
        const dx = f.lx * iw, dz = f.lz * id, cx = dx + f.rx * ilen, cz = dz + f.rz * ilen;
        const inset = (len - ilen) / 2 / len * bys;
        quad(ax, y0, az, bx, y0, bz, cx, y0 + h, cz, dx, y0 + h, dz, f.nx, 0.35, f.nz, 0, 0, bys, Math.hypot(h, ins));
        // uv of the top edge is inset: rewrite the last two vertices' u
        AU[(nv - 2) * 4] = i16((bys - inset) * 32); AU[(nv - 1) * 4] = i16(inset * 32);
        AU[(nv - 3) * 4] = i16(bys * 32);
      }
      plain(0x3f4046, M_DECK);
      topQuad(0, 0, iw, id, y0 + h);
      top = y0 + h;
    } else {
      parapet(0, 0, hw, hd, deckY, parTop, 0.22, b.wall, deck);
      top = parTop;
    }
    if (FAR) { frame(0, 0, 0); aabb(b.x - b.w / 2, b.x + b.w / 2, b.z - b.d / 2, b.z + b.d / 2, 0, top); return top; }
    // cornice along the front
    const cy = mansard ? deckY + 0.1 : parTop;
    plain(painted ? 0xe6e2d8 : shade(b.wall, 0.72));
    quad(-hw, cy - 0.5, hd + 0.38, hw, cy - 0.5, hd + 0.38, hw, cy, hd + 0.38, -hw, cy, hd + 0.38, 0, 0, 1, 0, 0, Wd, 0.5);
    quad(-hw, cy - 0.5, hd, hw, cy - 0.5, hd, hw, cy - 0.5, hd + 0.38, -hw, cy - 0.5, hd + 0.38, 0, -1, 0, 0, 0, Wd, 0.38);
    quad(-hw, cy, hd, hw, cy, hd, hw, cy, hd + 0.38, -hw, cy, hd + 0.38, 0, 1, 0, 0, 0, Wd, 0.38);
    // stoop to the door, or an awning over the corner shop
    if (hasDoor) {
      const dx = -hw + (doorBay + 0.5) * (Wd / bays);
      plain(0x9a958a);
      box(dx, hd + 0.7, 0.8, 0.7, FOOT, GY + 0.55);
    } else {
      awning(0, 0, 0, hw, hd, GY + 2.95, AWNINGS[(hq(b.x, b.z, 813) * AWNINGS.length) | 0]);
    }
    // a chimney stack on the party line
    if (hq(b.x, b.z, 341) < 0.4) {
      plain(shade(b.wall, 0.8));
      const px = (hq(b.x, b.z, 342) < 0.5 ? -1 : 1) * (hw - 0.45), pz = (hq(b.x, b.z, 343) - 0.5) * hd;
      box(px, pz, 0.35, 0.7, top - 0.6, top + 1.2);
    }
    frame(0, 0, 0);
    aabb(b.x - b.w / 2, b.x + b.w / 2, b.z - b.d / 2, b.z + b.d / 2, 0, top);
    return top;
  }

  function house(P, b) {
    const rot = b.rot || 0;
    frame(b.x, b.z, rot);
    const Wd = b.w, Dp = b.d, hd = Dp / 2;
    const st = b.st || 1, fh = 3.0;
    const gr = grammarOf(P, b);
    const mode = gr === "spanish" ? M_STUCCO : M_HOUSE;
    const flX = gr === "spanish" ? F_ARCH : (gr === "victorian" ? F_SPEC : 0);
    const seed = seedOf(b), roofHex = b.roofCol || 0x444040, trim = mode === M_STUCCO ? shade(b.wall, 0.85) : 0xdcd8ce;
    const gW = b.garage && Wd >= 12 ? Math.min(6.2, Wd * 0.42) : 0;
    const gs = hq(b.x, b.z, 581) < 0.5 ? -1 : 1;
    const bx = -gs * gW / 2, bhw = (Wd - gW) / 2;
    const yE = GY + st * fh + 0.3;
    const brush = function () { facade(b.wall, b.glass || 0x2b3238, mode, fh, 3.0, st * fh); bSeed = seed; bFl = flX; };
    brush();
    const bays = baysFor(2 * bhw), doorBay = Math.floor(bays / 2);
    walls(bx, 0, bhw, hd, FOOT, yE, function (k) {
      bFl = flX;
      if (k === 0) { bFl |= F_DOOR; bDoor = doorBay; }
      if (gW > 0 && ((gs > 0 && k === 1) || (gs < 0 && k === 3))) bFl |= F_BLANK;   // the wall the garage leans on
    });
    let ridge;
    const pitch = mode === M_STUCCO ? 0.42 : (b.roof === "hip" ? 0.5 : 0.62);
    if (b.roof === "hip") ridge = hip(bx, 0, bhw, hd, yE, pitch, 0.55, roofHex, trim);
    else ridge = gable(bx, 0, bhw, hd, yE, pitch, 0.5, bhw >= hd, roofHex, trim, brush);
    if (gW > 0) {
      const gx = gs * (Wd / 2 - gW / 2), gy = GY + 2.9;
      facade(b.wall, 0x2b3238, mode, 3.0, gW, 3.0); bSeed = seed;
      walls(gx, 0, gW / 2, hd, FOOT, gy, function (k) {
        if ((gs > 0 && k === 3) || (gs < 0 && k === 1)) return false;
        bFl = k === 0 ? (F_GARAGE | F_BLANK) : F_BLANK;
      });
      hip(gx, 0, gW / 2, hd, gy, 0.4, 0.4, roofHex, trim);
    }
    if (FAR) { frame(0, 0, 0); oriented(b.x, b.z, Wd / 2, Dp / 2, rot, 0, ridge); return ridge; }
    // a door hood over the front door
    const dx = bx - bhw + (doorBay + 0.5) * (2 * bhw / bays);
    plain(roofHex, M_SHINGLE);
    quad(dx - 1.2, GY + 2.75, hd, dx + 1.2, GY + 2.75, hd, dx + 1.2, GY + 2.45, hd + 1.3, dx - 1.2, GY + 2.45, hd + 1.3, 0, 1, 0.2, 0, 0, 2.4, 1.33);
    plain(trim);
    quad(dx - 1.2, GY + 2.6, hd, dx + 1.2, GY + 2.6, hd, dx + 1.2, GY + 2.3, hd + 1.3, dx - 1.2, GY + 2.3, hd + 1.3, 0, -1, 0, 0, 0, 2.4, 1.3);
    quad(dx - 1.2, GY + 2.3, hd + 1.3, dx + 1.2, GY + 2.3, hd + 1.3, dx + 1.2, GY + 2.45, hd + 1.3, dx - 1.2, GY + 2.45, hd + 1.3, 0, 0, 1, 0, 0, 2.4, 0.15);
    // chimney at one end of the body
    if (hq(b.x, b.z, 591) < 0.45) {
      plain(0x7a4a3a);
      const cx = bx + (hq(b.x, b.z, 592) < 0.5 ? -1 : 1) * (bhw - 0.7);
      box(cx, -hd * 0.25, 0.5, 0.5, yE - 1.0, ridge + 0.9);
    }
    frame(0, 0, 0);
    oriented(b.x, b.z, Wd / 2, Dp / 2, rot, 0, ridge);
    return ridge;
  }

  function warehouse(P, b) {
    frame(0, 0, 0);
    const hw = b.w / 2, hd = b.d / 2, hgt = b.h, brick = b.style === "brick";
    const seed = seedOf(b), deck = deckOf(b);
    const fh = brick ? hgt / Math.max(1, Math.round(hgt / 4.4)) : hgt;
    const mode = brick ? M_BRICK : M_METAL, bay = brick ? 3.4 : 6.0;
    const yE = GY + hgt;
    const brush = function () { facade(b.wall, b.glass, mode, fh, bay, hgt); bSeed = seed; };
    brush();
    const saw = b.roof === "saw";
    walls(b.x, b.z, hw, hd, FOOT, saw ? yE : yE + 0.6, function (k) { bFl = k === 0 ? F_DOCK : 0; });
    let top = yE + 0.6;
    if (saw) {
      const n = Math.max(2, Math.round(b.w / 9)), dx = b.w / n, rise = 2.8;
      for (let i = 0; i < n; i++) {
        const x0 = b.x - hw + i * dx, x1 = x0 + dx;
        plain(shade(b.wall, 0.95), M_METALROOF);
        quad(x0, yE, b.z - hd, x0, yE, b.z + hd, x1, yE + rise, b.z + hd, x1, yE + rise, b.z - hd, -0.4, 1, 0, 0, 0, b.d, Math.hypot(dx, rise));
        plain(0x3a4a55, M_GLASSROOF);
        quad(x1, yE, b.z + hd, x1, yE, b.z - hd, x1, yE + rise, b.z - hd, x1, yE + rise, b.z + hd, 1, 0, 0, 0, 0, b.d, rise);
        brush();
        for (let s = -1; s <= 1; s += 2) {
          const bays = baysFor(b.w); bBays = bays;
          const zf = b.z + s * hd;
          // u runs left-to-right from outside: +Z face left is -X, -Z face left is +X
          const ua = s > 0 ? (x0 - (b.x - hw)) / b.w * bays : ((b.x + hw) - x0) / b.w * bays;
          const ub = s > 0 ? (x1 - (b.x - hw)) / b.w * bays : ((b.x + hw) - x1) / b.w * bays;
          tri(x0, yE, zf, x1, yE, zf, x1, yE + rise, zf, 0, 0, s, ua, hgt, ub, hgt, ub, hgt + rise);
        }
      }
      top = yE + rise;
    } else {
      parapet(b.x, b.z, hw, hd, yE, yE + 0.6, 0.25, b.wall, deck);
      roofPlant(b, b.x, b.z, hw - 1, hd - 1, yE, "ware");
    }
    aabb(b.x - hw, b.x + hw, b.z - hd, b.z + hd, 0, top);
    return top;
  }

  function tank(P, b) {
    frame(0, 0, 0);
    const r = Math.min(b.w, b.d) / 2 - (b.type === "tank" ? 0.3 : 0), seg = b.type === "silo" ? 14 : 18;
    const perim = 2 * Math.PI * r;
    facade(b.wall, 0, M_METAL, 3, perim / seg, 0); bFl = F_BLANK; bSeed = seedOf(b); bBays = seg;
    const y1 = GY + b.h;
    cylinder(b.x, b.z, r, FOOT, y1, seg);
    plain(shade(b.wall, 1.06));
    dome(b.x, b.z, r, y1, b.type === "silo" ? r * 0.9 : r * 0.28, seg);
    const top = y1 + (b.type === "silo" ? r * 0.9 : r * 0.28);
    aabb(b.x - r, b.x + r, b.z - r, b.z + r, 0, top);
    return top;
  }

  function strip(P, b) {
    const face = b.face && FACE_ROT[b.face] != null ? b.face : "s";
    const rot = FACE_ROT[face], ns = face === "n" || face === "s";
    frame(b.x, b.z, rot);
    const Wd = ns ? b.w : b.d, Dp = ns ? b.d : b.w, hw = Wd / 2, hd = Dp / 2;
    const seed = seedOf(b), deck = deckOf(b), fh = b.fh || 6, y1 = GY + b.h;
    facade(b.wall, b.glass, M_STRIP, fh, 3.2, b.h); bSeed = seed;
    walls(0, 0, hw, hd, FOOT, y1 + 1.2, function (k) { bFl = k === 0 ? F_SHOP : 0; });
    parapet(0, 0, hw, hd, y1, y1 + 1.1, 0.25, b.wall, deck);
    roofPlant(b, 0, 0, hw - 2, hd - 2, y1, "strip");
    // the canopy on columns along the shop front
    const nc = FAR ? -1 : Math.max(2, Math.round((Wd - 1) / 9));
    if (!FAR) { plain(shade(b.wall, 0.78)); box(0, hd + 1.6, hw - 0.5, 1.6, GY + 3.55, GY + 3.95); plain(shade(b.wall, 0.9)); }
    for (let i = 0; i <= nc; i++) {
      const cx = -hw + 0.7 + i * (Wd - 1.4) / nc;
      box(cx, hd + 2.9, 0.18, 0.18, FOOT, GY + 3.55, true);
    }
    frame(0, 0, 0);
    aabb(b.x - b.w / 2, b.x + b.w / 2, b.z - b.d / 2, b.z + b.d / 2, 0, y1 + 1.2);
    return y1 + 1.2;
  }

  function mall(P, b) {
    frame(0, 0, 0);
    const hw = b.w / 2, hd = b.d / 2, seed = seedOf(b), deck = deckOf(b), fh = b.fh || 6, y1 = GY + b.h;
    const hall = !!b.shop;
    facade(b.wall, b.glass, M_STRIP, fh, hall ? 3.2 : 6.0, b.h); bSeed = seed;
    walls(b.x, b.z, hw, hd, FOOT, y1 + 1.2, function (k, len) {
      bFl = 0;
      if (k === 0 || k === 2) { bFl = (hall ? F_SHOP : 0) | F_DOOR; bDoor = Math.floor(baysFor(len) / 2); }
    });
    parapet(b.x, b.z, hw, hd, y1, y1 + 1.1, 0.3, b.wall, deck);
    roofPlant(b, b.x, b.z, hw - 3, hd - 3, y1, "mall");
    // entrance canopies (both long faces)
    if (!FAR) {
      plain(shade(b.wall, 0.75));
      box(b.x, b.z + hd + 2.2, 7, 2.2, GY + 5.2, GY + 5.7);
      box(b.x, b.z - hd - 2.2, 7, 2.2, GY + 5.2, GY + 5.7);
    }
    let top = y1 + 1.2;
    if (hall) {
      // the skylight down the hall
      const L = hw * 0.8, hwS = 5, rise = 2.6;
      plain(0x3b4852, M_GLASSROOF);
      for (let s = -1; s <= 1; s += 2) {
        quad(b.x - L, y1, b.z + s * hwS, b.x + L, y1, b.z + s * hwS, b.x + L, y1 + rise, b.z, b.x - L, y1 + rise, b.z, 0, 1, s, 0, 0, 2 * L, Math.hypot(hwS, rise));
      }
      plain(shade(b.wall, 0.9));
      for (let s = -1; s <= 1; s += 2) tri(b.x + s * L, y1, b.z - hwS, b.x + s * L, y1, b.z + hwS, b.x + s * L, y1 + rise, b.z, s, 0, 0, 0, 0, 2 * hwS, 0, hwS, rise);
      top = y1 + rise;
    }
    aabb(b.x - hw, b.x + hw, b.z - hd, b.z + hd, 0, top);
    return top;
  }

  function civic(P, b) {
    frame(0, 0, 0);
    const hw = b.w / 2, hd = b.d / 2, seed = seedOf(b), deck = deckOf(b);
    const fh = b.fh || 3.8, y1 = GY + b.h;
    const stone = b.style === "stone";
    const mode = stone ? M_STONE : M_BRICK, bay = b.type === "pavilion" ? 3.6 : 3.2;
    const brush = function () { facade(b.wall, b.glass || 0x33414b, mode, fh, bay, b.h); bSeed = seed; bFl = F_ARCH; };
    brush();
    const longX = hw >= hd;
    const pitched = b.roof === "gable" || b.roof === "hip";
    walls(b.x, b.z, hw, hd, FOOT, pitched ? y1 : y1 + 1.0, function (k, len) {
      bFl = F_ARCH;
      if ((longX && (k === 0 || k === 2)) || (!longX && (k === 1 || k === 3))) { bFl |= F_DOOR; bDoor = Math.floor(baysFor(len) / 2); }
    });
    let top;
    const roofHex = b.roofCol || 0x3c4a44;
    if (pitched) top = gable(b.x, b.z, hw, hd, y1, 0.55, 0.45, longX, roofHex, shade(b.wall, 1.1), brush);
    else { parapet(b.x, b.z, hw, hd, y1, y1 + 0.9, 0.3, b.wall, deck); top = y1 + 1.0; roofPlant(b, b.x, b.z, hw - 1, hd - 1, y1, "office"); }
    aabb(b.x - hw, b.x + hw, b.z - hd, b.z + hd, 0, top);
    return top;
  }

  function clocktower(P, b) {
    frame(0, 0, 0);
    const seed = seedOf(b), hw = b.w / 2, shaftTop = GY + b.h - 9;
    facade(b.wall, 0x2f3a44, M_BRICK, 3.8, hw * 2 / 3, b.h - 9); bSeed = seed; bFl = F_ARCH;
    walls(b.x, b.z, hw, hw, FOOT, shaftTop);
    // the clock stage: one bay a face, a dial centred on each (top = the dial's centre height)
    const sw = hw + 0.6, y0 = shaftTop, y1 = shaftTop + 6.5;
    facade(shade(b.wall, 1.05), 0x2f3a44, M_BRICK, 3.8, sw * 2, y0 + 3.3 - GY); bSeed = seed; bFl = F_SPEC | F_BLANK;
    walls(b.x, b.z, sw, sw, y0, y1);
    plain(shade(b.wall, 1.2));
    box(b.x, b.z, sw + 0.3, sw + 0.3, y1, y1 + 0.5);
    plain(b.roofCol || 0x3c4a44, M_SHINGLE);
    pyramid(b.x, b.z, sw, 0.1, y1 + 0.5, y1 + 16);
    aabb(b.x - sw, b.x + sw, b.z - sw, b.z + sw, 0, y1 + 16);
    return y1 + 16;
  }

  function barn(P, b) {
    frame(0, 0, 0);
    const hw = b.w / 2, hd = b.d / 2, seed = seedOf(b);
    const alongZ = hd >= hw;                   // the ridge runs the long way
    const run = alongZ ? hw : hd, len = alongZ ? hd : hw;
    const yE = GY + 4.4, yR = GY + b.h + 2.2, kx = run * 0.58, ky = yE + (yR - yE) * 0.62;
    const brush = function () { facade(b.wall, 0x2a2a2a, M_BARN, 4.4, 2.5, 4.4); bSeed = seed; };
    brush();
    walls(b.x, b.z, hw, hd, FOOT, yE, function (k) {
      const gableEnd = alongZ ? (k === 0 || k === 2) : (k === 1 || k === 3);
      bFl = gableEnd ? F_DOOR : 0; bDoor = 0;
    });
    const P2 = function (ac, al) { return alongZ ? [b.x + ac, b.z + al] : [b.x + al, b.z + ac]; };
    const H2 = function (ac, al) { return alongZ ? [ac, al] : [al, ac]; };
    const o = 0.35;
    plain(b.roofCol || 0x55565a, M_METALROOF);
    for (let s = -1; s <= 1; s += 2) {
      const a = P2(s * (run + o), -len - o), bb = P2(s * (run + o), len + o), c = P2(s * kx, len + o), d = P2(s * kx, -len - o), h = H2(s, 0);
      quad(a[0], yE - 0.25, a[1], bb[0], yE - 0.25, bb[1], c[0], ky, c[1], d[0], ky, d[1], h[0], 0.5, h[1], 0, 0, 2 * (len + o), Math.hypot(run + o - kx, ky - yE));
      const e = P2(s * kx, -len - o), f = P2(s * kx, len + o), g = P2(0, len + o), hh = P2(0, -len - o);
      quad(e[0], ky, e[1], f[0], ky, f[1], g[0], yR, g[1], hh[0], yR, hh[1], h[0], 2, h[1], 0, 0, 2 * (len + o), Math.hypot(kx, yR - ky));
    }
    // gambrel end walls (fan of three triangles each)
    brush();
    for (let s = -1; s <= 1; s += 2) {
      const n = H2(0, s);
      const pts = [P2(-run, s * len), P2(-kx, s * len), P2(0, s * len), P2(kx, s * len), P2(run, s * len)];
      const ys = [yE, ky, yR, ky, yE];
      const bays = baysFor(2 * run); bBays = bays; bFl = 0;
      const rx = n[1], rz = -n[0];
      const uOf = function (p) { return ((p[0] - b.x) * rx + (p[1] - b.z) * rz + run) / (2 * run) * bays; };
      for (let t = 1; t < 4; t++) {
        tri(pts[0][0], ys[0], pts[0][1], pts[t][0], ys[t], pts[t][1], pts[t + 1][0], ys[t + 1], pts[t + 1][1], n[0], 0, n[1],
          uOf(pts[0]), ys[0] - GY, uOf(pts[t]), ys[t] - GY, uOf(pts[t + 1]), ys[t + 1] - GY);
      }
    }
    aabb(b.x - hw, b.x + hw, b.z - hd, b.z + hd, 0, yR);
    return yR;
  }

  function stadium(P, b) {
    frame(0, 0, 0);
    const rx = b.w / 2, rz = b.d / 2, seg = 72, seed = seedOf(b);
    const yTop = GY + 30;
    const ring = function (s) { return function (j) { const a = (j / seg) * Math.PI * 2; return [b.x + Math.cos(a) * rx * s, b.z + Math.sin(a) * rz * s]; }; };
    const perimAt = function (s) { return Math.PI * (3 * (rx + rz) - Math.sqrt((3 * rx + rz) * (rx + 3 * rz))) * s; };
    // a band between two (scale, y) profile points; mode brush set by caller; hint: out(+1)/in(-1), up weight
    const band = function (sA, yA, sB, yB, out, up, uPer) {
      const A = ring(sA), B = ring(sB);
      const pA = perimAt(sA);
      for (let j = 0; j < seg; j++) {
        const a0 = A(j), a1 = A(j + 1), b0 = B(j), b1 = B(j + 1);
        const am = ((j + 0.5) / seg) * Math.PI * 2, hx = Math.cos(am) / rx, hz = Math.sin(am) / rz, hl = Math.hypot(hx, hz);
        const u0 = j / seg * pA / uPer, u1 = (j + 1) / seg * pA / uPer;
        quad(a0[0], yA, a0[1], a1[0], yA, a1[1], b1[0], yB, b1[1], b0[0], yB, b0[1], out * hx / hl, up, out * hz / hl, u0, 0, u1, Math.hypot(yB - yA, (sB - sA) * 100));
      }
    };
    // outer wall (facade, v = height; overwrite v via a direct vertical band)
    facade(b.wall, 0x2f3a44, M_STADIUM, 30, 8, 30); bSeed = seed;
    const A = ring(1), pA = perimAt(1), bays = Math.round(pA / 8); bBays = Math.min(bays, 32767);
    for (let j = 0; j < seg; j++) {
      const a0 = A(j), a1 = A(j + 1);
      const am = ((j + 0.5) / seg) * Math.PI * 2;
      quad(a0[0], FOOT, a0[1], a1[0], FOOT, a1[1], a1[0], yTop, a1[1], a0[0], yTop, a0[1], Math.cos(am) / rx, 0, Math.sin(am) / rz, j / seg * bays, FOOT - GY, (j + 1) / seg * bays, yTop - GY);
    }
    plain(shade(b.wall, 1.08)); band(1.0, yTop, 0.965, yTop, 1, 1, 1);
    // stands: upper tier, the concourse riser, lower tier, the pitch wall
    const seat = [0x1f4f8a, 0x8a1f24, 0x2a6a3a][(hq(b.x, b.z, 55) * 3) | 0];
    plain(seat, M_STANDS); band(0.965, yTop - 1.5, 0.8, GY + 14, -1, 1.6, 1);
    plain(0x8f8d88); band(0.8, GY + 14, 0.8, GY + 11, -1, 0, 1);
    plain(seat, M_STANDS); band(0.8, GY + 11, 0.63, GY + 1.2, -1, 1.6, 1);
    plain(0x8f8d88); band(0.63, GY + 1.2, 0.63, GY + 0.02, -1, 0, 1);
    // the pitch
    plain(0x3f7a34, M_GRASS);
    {
      const I = ring(0.63), cxx = b.x, czz = b.z;
      need(seg + 1, seg * 3);
      const s0 = nv;
      for (let j = 0; j < seg; j++) { const p = I(j); vert(p[0], GY + 0.05, p[1], 0, 1, 0, p[0] - b.x + 200, p[1] - b.z + 200); }
      const c = vert(cxx, GY + 0.05, czz, 0, 1, 0, 200, 200);
      for (let j = 0; j < seg; j++) triIdx(s0 + j, s0 + (j + 1) % seg, c, 0, 1, 0);
    }
    // the roof canopy over the upper tier (top + underside)
    plain(0xd6d7d4, M_METALROOF); band(0.995, yTop + 0.4, 0.83, yTop + 3.8, 1, 3, 1);
    plain(0x55585c); band(0.995, yTop + 0.2, 0.83, yTop + 3.6, 0, -3, 1);
    // light masts
    for (let q = 0; q < 4; q++) {
      const a = Math.PI / 4 + q * Math.PI / 2, mx = b.x + Math.cos(a) * rx * 1.02, mz = b.z + Math.sin(a) * rz * 1.02;
      plain(0x9a9c9e);
      box(mx, mz, 0.6, 0.6, FOOT, GY + 58);
      const yaw = Math.atan2(b.x - mx, b.z - mz);        // local +Z faces the pitch
      frame(mx, mz, yaw);
      plain(0x6c6e70); box(0, 0.6, 4.2, 0.6, GY + 55, GY + 59.5);
      plain(0, M_LAMP);
      quad(-4.0, GY + 55.3, 1.25, 4.0, GY + 55.3, 1.25, 4.0, GY + 59.2, 1.25, -4.0, GY + 59.2, 1.25, 0, 0, 1, 0, 0, 8, 3.9);
      frame(0, 0, 0);
      aabb(mx - 0.6, mx + 0.6, mz - 0.6, mz + 0.6, 0, GY + 58);
    }
    // colliders: twelve oriented boxes round the bowl (the pitch stays open)
    const n = 12, sMid = 0.815, depth = (1 - 0.63) * Math.min(rx, rz) + 2;
    for (let k = 0; k < n; k++) {
      const a0 = (k / n) * Math.PI * 2, a1 = ((k + 1) / n) * Math.PI * 2;
      const p0 = [b.x + Math.cos(a0) * rx * sMid, b.z + Math.sin(a0) * rz * sMid], p1 = [b.x + Math.cos(a1) * rx * sMid, b.z + Math.sin(a1) * rz * sMid];
      const cx = (p0[0] + p1[0]) / 2, cz = (p0[1] + p1[1]) / 2, len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
      const yaw = Math.atan2(-(p1[1] - p0[1]), p1[0] - p0[0]);  // local +X along the chord (x' = cos, z' = -sin)
      oriented(cx, cz, len / 2 + 2, depth / 2, yaw, 0, yTop);
    }
    return yTop + 3.8;
  }

  function station(P, s) {
    const alongX = s.axis !== "z";
    const L = Math.max(s.w, s.d) / 2, D = Math.min(s.w, s.d) / 2;
    frame(s.x, s.z, alongX ? 0 : Math.PI / 2);
    const seed = (hq(s.x, s.z, 7) * 255) | 0;
    const wallTop = GY + 10, rise = 12, yC = wallTop + rise;
    const hex = 0xb9ab8d;
    // side walls: tall arched windows outside, plain inside, a cap on top
    for (let sd = -1; sd <= 1; sd += 2) {
      const z0 = sd * D;
      facade(hex, 0x3a4650, M_STONE, 10, 9.5, 10); bSeed = seed; bFl = F_ARCH;
      const bays = baysFor(2 * L); bBays = bays;
      const ax = sd > 0 ? -L : L, bx = -ax;
      quad(ax, FOOT, z0, bx, FOOT, z0, bx, wallTop, z0, ax, wallTop, z0, 0, 0, sd, 0, FOOT - GY, bays, wallTop - GY);
      plain(shade(hex, 0.82));
      quad(-L, FOOT, z0 - sd * 0.9, L, FOOT, z0 - sd * 0.9, L, wallTop, z0 - sd * 0.9, -L, wallTop, z0 - sd * 0.9, 0, 0, -sd, 0, 0, 2 * L, 10.3);
      plain(shade(hex, 1.15));
      quad(-L, wallTop, z0, L, wallTop, z0, L, wallTop, z0 - sd * 0.9, -L, wallTop, z0 - sd * 0.9, 0, 1, 0, 0, 0, 2 * L, 0.9);
      // ends of the wall slab
      for (let e = -1; e <= 1; e += 2) quad(e * L, FOOT, z0, e * L, FOOT, z0 - sd * 0.9, e * L, wallTop, z0 - sd * 0.9, e * L, wallTop, z0, e, 0, 0, 0, 0, 0.9, 10.3);
      const wx0 = s.x, wz0 = s.z;
      if (alongX) aabb(wx0 - L, wx0 + L, wz0 + Math.min(z0, z0 - sd * 0.9), wz0 + Math.max(z0, z0 - sd * 0.9), 0, wallTop);
      else aabb(wx0 + Math.min(z0, z0 - sd * 0.9), wx0 + Math.max(z0, z0 - sd * 0.9), wz0 - L, wz0 + L, 0, wallTop);
    }
    // the barrel vault: M segments across; outside standing seam with a glazed crown, inside dark steel
    const M = 14, arc = [];
    for (let i = 0; i <= M; i++) { const t = i / M, a = Math.PI * t; arc.push([-Math.cos(a) * D, wallTop + Math.sin(a) * rise]); }
    let arcLen = 0; const acc = [0];
    for (let i = 0; i < M; i++) { arcLen += Math.hypot(arc[i + 1][0] - arc[i][0], arc[i + 1][1] - arc[i][1]); acc.push(arcLen); }
    const E = L + 1.2;
    for (let i = 0; i < M; i++) {
      const p = arc[i], q = arc[i + 1], mz = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2 - wallTop;
      hexC(0x6d7478); bMode = M_METALROOF; bFl = F_SPEC; bTop = i16(arcLen * 16); bFh = 30; bBay = 10; bBays = 0; bDoor = 255; bSeed = seed;
      quad(-E, p[1], p[0], E, p[1], p[0], E, q[1], q[0], -E, q[1], q[0], 0, my, mz, 0, acc[i], 2 * E, acc[i + 1]);
      plain(0x3c3f42);
      quad(-E, p[1] - 0.25, p[0], E, p[1] - 0.25, p[0], E, q[1] - 0.25, q[0], -E, q[1] - 0.25, q[0], 0, -my, -mz, 0, acc[i], 2 * E, acc[i + 1]);
    }
    // the glazed lunettes at both ends (outside and inside), over a transfer beam
    for (let e = -1; e <= 1; e += 2) {
      const x = e * L;
      plain(0x3a4a55, M_GLASSROOF);
      need((M + 2) * 2, M * 6);
      for (let side = 0; side < 2; side++) {
        const hx = side === 0 ? e : -e;
        const s0 = nv;
        const c = vert(x, wallTop, 0, hx, 0, 0, D + 100, 0);
        for (let i = 0; i <= M; i++) vert(x, arc[i][1], arc[i][0], hx, 0, 0, arc[i][0] + D + 100, arc[i][1] - wallTop);
        const wx = hx * tC, wz = -hx * tS;
        for (let i = 0; i < M; i++) triIdx(c, s0 + 1 + i, s0 + 2 + i, wx, 0, wz);
      }
      plain(shade(hex, 0.9));
      quad(x, GY + 7, -D, x, GY + 7, D, x, wallTop, D, x, wallTop, -D, e, 0, 0, 0, 0, 2 * D, 3);
      quad(x, GY + 7, -D, x, GY + 7, D, x, wallTop, D, x, wallTop, -D, -e, 0, 0, 0, 0, 2 * D, 3);
      quad(x - 0.5, GY + 7, -D, x + 0.5, GY + 7, -D, x + 0.5, GY + 7, D, x - 0.5, GY + 7, D, 0, -1, 0, 0, 0, 1, 2 * D);
    }
    frame(0, 0, 0);
    return yC;
  }

  function emit(P, b, mask) {
    switch (b.type) {
      case "tower": return tower(P, b, mask);
      case "office": case "apt": return b.style === "row" ? row(P, Object.assign({}, b, { face: b.face || "s" })) : slab(P, b, mask);
      case "row": return row(P, b);
      case "house": return house(P, b);
      case "ware": return warehouse(P, b);
      case "tank": case "silo": return tank(P, b);
      case "strip": return strip(P, b);
      case "mall": return mall(P, b);
      case "civic": case "pavilion": return civic(P, b);
      case "clocktower": return clocktower(P, b);
      case "barn": return barn(P, b);
      case "stadium": return stadium(P, b);
      default: return slab(P, b, mask);
    }
  }

  // ---------------------------------------------------------------------
  //  STREET FACES: which walls of a perimeter-block building face a street
  //  (shops, awnings and the lobby door go there, never on the courtyard)
  // ---------------------------------------------------------------------
  function streetMasks(P) {
    const B = P.bldgs, out = new Uint8Array(B.length);
    const CELL = 120, grid = new Map();
    for (const k of P.blocks || []) {
      for (let ix = Math.floor(k.x0 / CELL); ix <= Math.floor(k.x1 / CELL); ix++)
        for (let iz = Math.floor(k.z0 / CELL); iz <= Math.floor(k.z1 / CELL); iz++) {
          const key = ix * 100003 + iz; let l = grid.get(key); if (!l) grid.set(key, l = []); l.push(k);
        }
    }
    for (let i = 0; i < B.length; i++) {
      const b = B[i];
      if (b.face && FACE_K[b.face] != null) { out[i] = 1 << FACE_K[b.face]; continue; }
      if (b.type !== "apt") { out[i] = 15; continue; }
      const l = grid.get(Math.floor(b.x / CELL) * 100003 + Math.floor(b.z / CELL));
      let blk = null;
      if (l) for (const k of l) if (b.x >= k.x0 && b.x <= k.x1 && b.z >= k.z0 && b.z <= k.z1) { blk = k; break; }
      if (!blk) { out[i] = 15; continue; }
      const lim = (blk.sw || 3) + 1.5;
      let m = 0;
      if (blk.z1 - (b.z + b.d / 2) <= lim) m |= 1;    // n
      if (blk.x1 - (b.x + b.w / 2) <= lim) m |= 2;    // e
      if ((b.z - b.d / 2) - blk.z0 <= lim) m |= 4;    // s
      if ((b.x - b.w / 2) - blk.x0 <= lim) m |= 8;    // w
      out[i] = m || 15;
    }
    return out;
  }

  // ---------------------------------------------------------------------
  //  PREPARE: per tile, two empty meshes — the NEAR tile (every detail,
  //  colliders) and the FAR tile (the same buildings merged as their true
  //  massing, no colliders). No building geometry is written here.
  // ---------------------------------------------------------------------
  function roofReach(b) {
    if (b.roof === "spire" && b.type === "tower") return b.h + Math.max(28, 0.2 * b.h) + 12;
    if (b.type === "clocktower") return b.h + 16;
    if (b.type === "stadium") return 64;
    return b.h + 8;
  }
  function noRaycast() {}
  function tileMesh(P, t, name, far) {
    const g = new THREE.BufferGeometry();
    const mesh = new THREE.Mesh(g, material());
    mesh.name = "metro-fabric" + (far ? "-far:" : ":") + name + ":" + t.key;
    mesh.position.set((t.x0 + t.x1) / 2, 0, (t.z0 + t.z1) / 2);
    mesh.updateMatrix();
    mesh.matrixAutoUpdate = false;
    // the far tile is past the shadow camera's reach by construction (it is
    // only drawn where the near tile is not), so it never enters the
    // shadow pass; it still RECEIVES so it shares the near tile's program
    mesh.castShadow = !far; mesh.receiveShadow = true; mesh.frustumCulled = true;
    mesh.userData = { metro: P.id, metroTile: t.key };
    if (far) {
      mesh.userData.metroFar = true;
      // its vertex arrays are freed once on the GPU (below): nothing may
      // raycast it (bullets and LOS hit the near tile's colliders anyway)
      mesh.raycast = noRaycast;
    }
    mesh.visible = false;                       // nothing to draw until a build fills it
    g.boundingSphere = t.sphere.clone();
    return mesh;
  }
  function prepare(P, opts) {
    opts = opts || {};
    const T = opts.tile || 800, name = opts.name || P.id;
    const m = material();
    const masks = streetMasks(P);
    const byKey = new Map();
    const tileOf = function (x, z) {
      const ix = Math.floor(x / T), iz = Math.floor(z / T), key = ix + "," + iz;
      let t = byKey.get(key);
      if (!t) {
        t = { key: key, ix: ix, iz: iz, x0: ix * T, z0: iz * T, x1: (ix + 1) * T, z1: (iz + 1) * T, idx: [], stations: [], built: false, farBuilt: false,
          mesh: null, far: null, bx0: 1e9, bx1: -1e9, bz0: 1e9, bz1: -1e9, by1: 0, masks: masks, tileSize: T };
        byKey.set(key, t);
      }
      return t;
    };
    const B = P.bldgs;
    for (let i = 0; i < B.length; i++) {
      const b = B[i], t = tileOf(b.x, b.z), r = Math.hypot(b.w, b.d) / 2 + 4;
      t.idx.push(i);
      if (b.x - r < t.bx0) t.bx0 = b.x - r; if (b.x + r > t.bx1) t.bx1 = b.x + r;
      if (b.z - r < t.bz0) t.bz0 = b.z - r; if (b.z + r > t.bz1) t.bz1 = b.z + r;
      t.by1 = Math.max(t.by1, GY + roofReach(b));
    }
    for (let i = 0; i < (P.stations || []).length; i++) {
      const s = P.stations[i], t = tileOf(s.x, s.z), r = Math.hypot(s.w, s.d) / 2 + 2;
      t.stations.push(i);
      t.bx0 = Math.min(t.bx0, s.x - r); t.bx1 = Math.max(t.bx1, s.x + r); t.bz0 = Math.min(t.bz0, s.z - r); t.bz1 = Math.max(t.bz1, s.z + r);
      t.by1 = Math.max(t.by1, GY + 24);
    }
    const tiles = Array.from(byKey.values()).sort(function (a, b) { return a.iz - b.iz || a.ix - b.ix; });
    for (const t of tiles) {
      t.sphere = tileSphere(t);
      t.mesh = tileMesh(P, t, name, false);
      t.far = tileMesh(P, t, name, true);
      if (opts.root) { opts.root.add(t.mesh); opts.root.add(t.far); }
    }
    return { tiles: tiles, material: m };
  }
  function tileSphere(t) {
    const cx = (t.x0 + t.x1) / 2, cz = (t.z0 + t.z1) / 2;
    const ex = Math.max(Math.abs(t.bx0 - cx), Math.abs(t.bx1 - cx)), ez = Math.max(Math.abs(t.bz0 - cz), Math.abs(t.bz1 - cz));
    const cy = t.by1 / 2;
    return new THREE.Sphere(new THREE.Vector3(0, cy, 0), Math.sqrt(ex * ex + ez * ez + cy * cy) + 1);
  }

  // ---------------------------------------------------------------------
  //  BUILD ONE TILE — as a JOB that can run in slices across frames.
  //  One job owns the writer at a time (metro.js runs them serially), so a
  //  slice just stops between two buildings and the next slice carries on
  //  where the arrays left off. Synchronous callers (tools, node) run a job
  //  to the end in one go.
  // ---------------------------------------------------------------------
  let JOB = null;
  function job(P, tile, far) {
    if (JOB) runJob(JOB, Infinity);            // a sync caller cut in: finish the one in flight first
    const J = { P: P, tile: tile, far: !!far, k: 0, st: 0, ms: 0, done: false, result: null, marks: null };
    JOB = J;
    nv = 0; ni = 0;
    oX = (tile.x0 + tile.x1) / 2; oZ = (tile.z0 + tile.z1) / 2;
    COLS = []; REF = far ? tile.far : tile.mesh;
    return J;
  }
  // run up to `budget` ms of a job; returns the job's result when it finishes
  function runJob(J, budget) {
    if (J.done) return J.result;
    if (JOB !== J) throw new Error("metro_fabric: job run out of order");
    const t0 = now(), end = t0 + (budget > 0 ? budget : 0);
    const P = J.P, tile = J.tile, B = P.bldgs, masks = tile.masks || streetMasks(P);
    FAR = J.far;
    try {
      while (J.k < tile.idx.length) {
        const i = tile.idx[J.k++];
        const v0 = nv;
        try { emit(P, B[i], masks[i]); } catch (e) { if (typeof console !== "undefined") console.warn("[metro_fabric] building", B[i] && B[i].id, e); }
        frame(0, 0, 0);
        if (J.marks) J.marks.push(i, v0, nv);
        if (now() >= end) break;
      }
      if (J.k >= tile.idx.length) while (J.st < tile.stations.length) { station(P, P.stations[tile.stations[J.st++]]); frame(0, 0, 0); }
    } finally { FAR = false; }
    J.ms += now() - t0;
    if (J.k < tile.idx.length || J.st < tile.stations.length) return null;
    J.done = true;
    J.result = finish(J);
    JOB = null;
    return J.result;
  }
  function freeArray() { this.array = null; }
  function finish(J) {
    const t0 = now(), tile = J.tile, far = J.far;
    const mesh = far ? tile.far : tile.mesh;
    const g = new THREE.BufferGeometry();
    const pos = POS ? POS.slice(0, nv * 3) : new Float32Array(0);
    const attrs = [
      ["position", new THREE.BufferAttribute(pos, 3)],
      ["normal", new THREE.BufferAttribute(nv ? NRM.slice(0, nv * 4) : new Int8Array(0), 4, true)],
      ["aMfC", new THREE.BufferAttribute(nv ? AC.slice(0, nv * 4) : new Uint8Array(0), 4, true)],
      ["aMfG", new THREE.BufferAttribute(nv ? AG.slice(0, nv * 4) : new Uint8Array(0), 4, true)],
      ["aMfP", new THREE.BufferAttribute(nv ? AP.slice(0, nv * 4) : new Uint8Array(0), 4, false)],
      ["aMfU", new THREE.BufferAttribute(nv ? AU.slice(0, nv * 4) : new Int16Array(0), 4, false)],
    ];
    for (const a of attrs) g.setAttribute(a[0], a[1]);
    const index = nv < 65536 ? Uint16Array.from(ni ? IDX.subarray(0, ni) : []) : IDX.slice(0, ni);
    g.setIndex(new THREE.BufferAttribute(index, 1));
    // bounds from what was written
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (let k = 0; k < pos.length; k += 3) {
      const x = pos[k], y = pos[k + 1], z = pos[k + 2];
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z;
    }
    if (nv) {
      g.boundingBox = new THREE.Box3(new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x1, y1, z1));
      const c = new THREE.Vector3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
      g.boundingSphere = new THREE.Sphere(c, Math.hypot(x1 - x0, y1 - y0, z1 - z0) / 2 + 0.5);
    } else if (tile.sphere) g.boundingSphere = tile.sphere.clone();
    // THE FAR TILE KEEPS NO CPU COPY. Once its arrays are on the GPU they
    // are dropped (it is never raycast, never rebuilt in place, never read
    // back), so the whole distant city costs video memory only.
    if (far && FREE_FAR) {
      for (const a of attrs) a[1].onUpload(freeArray);
      g.index.onUpload(freeArray);
    }
    const old = mesh.geometry;
    mesh.geometry = g;
    if (old && old !== g) old.dispose();
    if (far) tile.farBuilt = true; else tile.built = true;
    mesh.visible = false;                         // metro.js decides which of the pair is drawn
    const bytes = nv * (12 + 4 + 4 + 4 + 4 + 8) + index.byteLength;
    const cols = COLS; COLS = null; REF = null;
    const out = { colliders: far ? [] : cols, empty: nv === 0,
      stats: { ms: J.ms + (now() - t0), vertices: nv, triangles: ni / 3, bytes: bytes, buildings: tile.idx.length, far: far } };
    if (J.marks) out.marks = J.marks;
    return out;
  }
  let FREE_FAR = true;
  function buildTile(P, tile) {
    const J = job(P, tile, false);
    const r = runJob(J, Infinity);
    tile.mesh.visible = !r.empty;
    return r;
  }
  function buildFarTile(P, tile, opts) {
    const J = job(P, tile, true);
    if (opts && opts.marks) J.marks = [];
    return runJob(J, Infinity);
  }
  function disposeTile(P, tile) {
    if (!tile || !tile.mesh) return;
    if (JOB && JOB.tile === tile && !JOB.far) { JOB = null; COLS = null; REF = null; }   // dropped mid-build
    const old = tile.mesh.geometry;
    const g = new THREE.BufferGeometry();
    if (tile.sphere) g.boundingSphere = tile.sphere.clone();
    tile.mesh.geometry = g;
    if (old) old.dispose();
    tile.built = false;
    tile.mesh.visible = false;
  }
  // release the writer's scratch (after a burst of tile builds)
  function trim() { if (JOB) return; POS = NRM = AC = AG = AP = AU = IDX = null; CAP = ICAP = 0; }

  // ---------------------------------------------------------------------
  //  BUILD EVERYTHING (node checks, small towns)
  // ---------------------------------------------------------------------
  function build(P, opts) {
    const t0 = now();
    const pr = prepare(P, opts);
    const meshes = [], colliders = [];
    let vertices = 0, triangles = 0, bytes = 0, worst = 0, worstKey = "";
    const far = { vertices: 0, triangles: 0, bytes: 0, worstMs: 0, drawCalls: 0 };
    for (const t of pr.tiles) {
      const r = buildTile(P, t);
      meshes.push(t.mesh);
      for (const c of r.colliders) colliders.push(c);
      vertices += r.stats.vertices; triangles += r.stats.triangles; bytes += r.stats.bytes;
      if (r.stats.ms > worst) { worst = r.stats.ms; worstKey = t.key; }
      if (opts && opts.far === false) continue;
      const f = buildFarTile(P, t, opts);
      if (opts && opts.marks) t.farMarks = f.marks;
      far.vertices += f.stats.vertices; far.triangles += f.stats.triangles; far.bytes += f.stats.bytes;
      far.worstMs = Math.max(far.worstMs, f.stats.ms); if (!f.empty) far.drawCalls++;
    }
    return {
      meshes: meshes, colliders: colliders, tiles: pr.tiles, material: pr.material,
      stats: { buildings: P.bldgs.length, vertices: vertices, triangles: triangles, bytes: bytes, ms: now() - t0, drawCalls: meshes.length,
        worstTileMs: worst, worstTile: worstKey, far: far },
    };
  }

  const API = {
    build: build, prepare: prepare, buildTile: buildTile, buildFarTile: buildFarTile, job: job, runJob: runJob,
    disposeTile: disposeTile, trim: trim, material: material, tick: tick, uniforms: U,
    setFreeFar: function (on) { FREE_FAR = !!on; },
    _glsl: { pars: MF_PARS, main: MF_MAIN },
  };
  CBZ.metroFabric = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : globalThis);
