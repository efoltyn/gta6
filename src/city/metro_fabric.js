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
    M_STANDS = 14, M_BARN = 15, M_MANSARD = 16, M_GLASSROOF = 17, M_GRASS = 18, M_LAMP = 19, M_STUCCO = 20,
    // M_KIT: a facade-kit box (FACADE CELLS below). Plain masonry noise, and
    // it counts as WALL for the ground grime and street-canyon occlusion
    // (the `wall` term in MF_MAIN takes every mode >= 20), so a pier darkens
    // toward its foot exactly like the painted wall it stands on.
    M_KIT = 21;
  const F_SHOP = 1, F_DOOR = 2, F_BLANK = 4, F_OFFICE = 8, F_GARAGE = 16, F_ARCH = 32, F_DOCK = 64, F_SPEC = 128;
  // F_DOCK on M_PLAIN = floodlit at night (tower crowns); F_SPEC on M_PLAIN = awning stripes;
  // F_SPEC on M_ROW = painted clapboard; on M_HOUSE = shutters; on M_BRICK = the clock face;
  // F_SPEC on M_METALROOF = glazed crown band (the rail hall).

  const STYLE = {
    glass: [M_GLASS, 1.5], deco: [M_DECO, 1.8], stone: [M_STONE, 2.6], brick: [M_BRICK, 2.8],
    concrete: [M_CONCRETE, 3.0], metal: [M_METAL, 6.0], row: [M_ROW, 2.3], house: [M_HOUSE, 3.0],
    strip: [M_STRIP, 3.2], stadium: [M_STADIUM, 8.0], barn: [M_BARN, 2.5],
    stucco: [M_STUCCO, 2.6], panel: [M_CONCRETE, 1.8],
  };
  // a building's bay width: its variant's, or its style's
  function bayOf(b, sm) { return (b.v && b.v.bay) || sm[1]; }
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
    // vMfU.w packs the face's bay count (low 8 bits) and the BUILDING'S
    // VARIANT (high bits, see VARIANTS): 0 is the plain style
    "  float vr = floor( vMfU.w / 256.0 + 0.001 );",
    "  float u = vMfU.x, v = vMfU.y, top = vMfU.z, bays = vMfU.w - vr * 256.0;",
    "  float vW = mod( vr, 4.0 ), vH = mod( floor( vr / 4.0 ), 4.0 ), vVac = mod( floor( vr / 16.0 ), 2.0 );",
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
    "  } else if ( mode > 20.5 ) {",                                                // KIT relief (facade kit boxes, near cells)
    "    float n = mfH( vec3( floor( u * 2.0 ), floor( v * 2.0 ), seed + 7.0 ) );",
    "    col *= 1.0 + ( n - 0.5 ) * 0.06 * mfFade( max( fwu, fwv ), 0.5 );",
    "  } else if ( mode < 8.5 || ( mode > 9.5 && mode < 11.5 ) || mode > 19.5 ) {",  // PUNCHED: stone 6, brick 7, concrete 8, row 10, house 11, stucco 20
    "    vec2 lo = vec2( 0.29, 0.26 ), hi = vec2( 0.71, 0.84 );",
    "    if ( mode > 6.5 && mode < 7.5 ) { lo = vec2( 0.31, 0.27 ); hi = vec2( 0.69, 0.83 ); }",
    "    if ( mode > 7.5 && mode < 8.5 ) { lo = vec2( 0.07, 0.37 ); hi = vec2( 0.93, 0.83 ); }",
    "    if ( mode > 9.5 && mode < 10.5 ) { lo = vec2( 0.24, 0.24 ); hi = vec2( 0.76, 0.85 ); }",
    "    if ( mode > 10.5 ) { lo = vec2( 0.3, 0.3 ); hi = vec2( 0.7, 0.8 ); }",
    // the building's window: narrow / wide / paired, tall / squat / arched
    "    {",
    "      float cx = 0.5 * ( lo.x + hi.x ), hx = 0.5 * ( hi.x - lo.x );",
    "      if ( vW > 0.5 && vW < 1.5 ) hx *= 0.72;",
    "      else if ( vW > 1.5 && vW < 2.5 ) hx = min( hx * 1.32, 0.44 );",
    "      else if ( vW > 2.5 ) hx = min( hx * 1.22, 0.42 );",
    "      lo.x = cx - hx; hi.x = cx + hx;",
    "      if ( vH > 0.5 && vH < 1.5 ) { lo.y = max( 0.12, lo.y - 0.07 ); hi.y = min( 0.9, hi.y + 0.04 ); }",
    "      else if ( vH > 1.5 && vH < 2.5 ) { lo.y += 0.08; hi.y -= 0.05; }",
    "    }",
    "    fARCH = max( fARCH, step( 2.5, vH ) );",
    "    vec2 p = vec2( cu, cv );",
    "    wm = mfBox( p, lo, hi, fwc );",
    // paired: two lights to a bay, a mullion pier between them
    "    if ( vW > 2.5 ) wm *= 1.0 - mfBox( p, vec2( 0.5 * ( lo.x + hi.x ) - 0.035, lo.y - 0.01 ), vec2( 0.5 * ( lo.x + hi.x ) + 0.035, hi.y + 0.01 ), fwc ) * ( 1.0 - blur );",
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
    // VACANT: the openings are boarded (weathered plywood), no glass, no light
    "    float board = 0.0;",
    "    if ( vVac > 0.5 ) { board = mix( wm, wAvg, blur ); wm = 0.0; wAvg = 0.0; }",
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
    "    col = mix( col, vec3( 0.52, 0.44, 0.33 ) * ( 0.8 + 0.25 * mfH( vec3( colI, flo, seed + 5.0 ) ) ), board );",
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
    "    if ( vVac > 0.5 ) { col = mix( col, vec3( 0.5, 0.43, 0.33 ), mix( sf, wAvg, blur ) ); wm = 0.0; wAvg = 0.0; }",
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
    "      if ( vVac > 0.5 ) dc = vec3( 0.5, 0.43, 0.33 );",
    "      col = mix( col, dc, dr );",
    "      wm *= 1.0 - dr;",
    "      float tr = mfBox( vec2( cu, v ), vec2( 0.5 - dw, d0 + 2.35 ), vec2( 0.5 + dw, d0 + 2.7 ), vec2( fwu, fwv ) ) * step( 9.5, mode ) * step( mode, 10.5 );",
    "      wm = max( wm, tr );",
    "      float sc = mfBox( vec2( cu, v ), vec2( 0.5 + dw + 0.03, d0 + 1.8 ), vec2( 0.5 + dw + 0.03 + 0.16 / bw, d0 + 2.0 ), vec2( fwu, fwv ) );",
    "      mfEmit += vec3( 1.0, 0.78, 0.45 ) * sc * 2.0 * uMfNight * ( 1.0 - vVac );",
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
    mat.customProgramCacheKey = function () { return "cbzMetroFabric4"; };
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
  // bVar: the building variant on a facade (0 on everything else); BVAR:
  // the variant of the building being written (facade() picks it up)
  let bVar = 0, BVAR = 0;
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
    AU[k4] = i16(u * 32); AU[k4 + 1] = i16(v * 16); AU[k4 + 2] = bTop; AU[k4 + 3] = (bBays & 255) + 256 * bVar;
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
    bMode = mode; bFh = q10(fh); bBay = q10(bay); bTop = i16(top * 16); bFl = 0; bDoor = 255; bBays = 1; bVar = BVAR;
  }
  function plain(hex, mode, fl) {
    hexC(hex); bMode = mode || M_PLAIN; bFl = fl || 0; bFh = 30; bBay = 10; bTop = 0; bBays = 0; bDoor = 255; bVar = 0;
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
  /* DOOR_MID: the door goes in the MIDDLE of the face, and the face gets an
     odd bay count so there is a middle bay. That is where the facade kit
     (city/facade_kit.js) cuts its doorway and hangs its reveal on every one
     of its grammars, so the painted door and the kit's real opening are the
     same door on a dressed building (FACADE CELLS below). The rule is the
     writer's, so the near tile, the far tile and the kit all agree. */
  const DOOR_MID = 254;
  function oddBays(len) {
    let n = baysFor(len);
    if (!(n & 1)) n += len / (bBay / 10) > n ? 1 : -1;
    return Math.max(1, n);
  }
  function walls(ox, oz, hw, hd, y0, y1, perFace) {
    const fl0 = bFl, d0 = bDoor;
    for (let k = 0; k < 4; k++) {
      const f = FK[k], len = faceLen(k, hw, hd);
      bFl = fl0; bDoor = d0;
      if (perFace && perFace(k, len) === false) continue;
      let bays = baysFor(len);
      if (bDoor === DOOR_MID) { bays = oddBays(len); bDoor = bays >> 1; }
      bBays = bays;
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

  // ---------------------------------------------------------------------
  //  VARIANTS — NO TWO NEIGHBOURS ALIKE.
  //
  //  Owner, on Kingsport: "The facades all look the same. It's stupid. Cool
  //  for a dystopian thing, maybe for a North Korea." The plan gave every
  //  district one look (a style and two to four wall colours) and the shader
  //  one window per style, so a district was one building repeated. Now
  //  every building gets its own VARIANT, once per plan, deterministic
  //  (position hash + plan order, never Math.random), and the near tile, the
  //  far HLOD and the facade kit all draw the same variant (one world):
  //
  //    * MATERIAL within the district's FAMILY (the look's grammar keeps the
  //      district's identity): brick in real tones, limestone / granite /
  //      terracotta / brownstone, precast concrete, stucco, metal panel,
  //      curtain wall with its own mullion and glass colours. `era` (a year,
  //      when the plan gives one) steers it: no curtain wall before 1930, no
  //      brownstone after 1940, and old buildings weather darker.
  //    * WINDOWS: bay width, storey height, and the window itself (narrow,
  //      wide, paired; tall, squat, arched: the shader's variant bits).
  //    * ROOFLINE: slabs get a cornice, a high parapet or a slate mansard
  //      storey; rows a bay window, a cornice in their own trim colour, a
  //      painted or a brick front.
  //    * THE NEIGHBOUR RULE: a building that would come out like the one
  //      before it on the same street (same material, colour, window) is
  //      moved one step along.
  //    * DETROIT (bldg.kind, when the plan gives it): pre-war stone and
  //      terracotta towers, the round glass riverfront cluster, main-street
  //      blocks, wood and brick houses, brick plants with big steel sash,
  //      sawtooth sheds, brick stacks, concrete grain elevators; bldg.vacant
  //      boards up windows and doors.
  //    * UNIFORM: plan.uniform, district.uniform or bldg.uniform = true keeps
  //      the building exactly as the plan wrote it (the planned capital's
  //      identical blocks are identical on purpose).
  // ---------------------------------------------------------------------
  const PAL = {
    brick: [0x8a3b26, 0x7a2e22, 0x6b4535, 0x9c4a2e, 0xb89a6e, 0x5d3a34, 0x7d6a5c, 0xa0523a, 0xbfa06a, 0x93452d, 0x6e3a2a, 0xa36b4c],
    paintedBrick: [0xd9d4c7, 0xc9c2b0, 0x55624f, 0x7b8a8c, 0x8a4a3a],
    stone: [0xcdbf9f, 0xb9ab8d, 0x9d9a94, 0xb99a72, 0xd8c9a8, 0xc8b89a, 0xe3dccd, 0xa8a293, 0xbdb4a2],
    brownstone: [0x6e4a3a, 0x5e4034, 0x7a5646, 0x6a4e40],
    terracotta: [0xd8c9a8, 0xe3dccd, 0xc9a27e, 0xd6b894, 0xcdbf9f],
    concrete: [0x8f8b84, 0xa39e94, 0x77736c, 0xb1aba0, 0x9a948a, 0x858178],
    stucco: [0xd9c9a8, 0xcfb89c, 0xe0d6c2, 0xbfae95, 0xc9b9a3, 0xd4c4b0],
    panel: [0x7d858a, 0x8c9296, 0x5f666b, 0xa8adb0, 0x4a5055, 0x6b6660],
    frame: [0x9aa2a8, 0x3d342b, 0x2b2d30, 0xd0d0cc, 0x6d8a86, 0x5d7f99, 0x8e9ba3, 0x4f5a60],
    glass: [0x3f6a86, 0x3f6f6a, 0x5a4a38, 0x46505a, 0x2a323a, 0x6a7884, 0x355060, 0x40505a],
    paint: [0xb8c7c9, 0xd9c9a3, 0xa9b89a, 0xc9a9a0, 0xe6e1d6, 0x8fa3b0, 0xcfbf8f, 0x9a8a78, 0x6f7f86, 0xd8b8a0, 0x7d8a6a, 0xa05a4a, 0x5f6f5a, 0xe0cfa0],
    trim: [0xe6e2d8, 0xd9d0bc, 0x3a3a3c, 0x5a3a2a, 0x2f4538, 0x8a8478, 0xc9c2b0],
    slate: [0x4b4d55, 0x3f4046, 0x55524c, 0x4a4f4a, 0x5b5048],
  };
  // material families by the district look's grammar: [material, weight]
  const FAMILY = {
    intl: [["glass", 6], ["panel", 1.5], ["stone", 1.5], ["deco", 1]],
    hightech: [["glass", 6.5], ["panel", 2.5], ["concrete", 1]],
    artdeco: [["deco", 4.5], ["stone", 2.5], ["brick", 1.5], ["glass", 1.5], ["panel", 0.5]],
    stone: [["stone", 4], ["deco", 2], ["brick", 2], ["glass", 1.5], ["panel", 0.5]],
    brick: [["brick", 6.5], ["stone", 1.2], ["stucco", 0.8], ["concrete", 1.5]],
    brutalist: [["concrete", 5.5], ["brick", 3], ["panel", 1.5]],
    greekrev: [["stone", 7], ["brick", 3]],
    industrial: [["metal", 6], ["brick", 4]],
  };
  const TOWER_OK = { glass: 1, deco: 1, stone: 1, panel: 1, brick: 1 };
  function pickW(list, h) {
    let t = 0; for (const e of list) t += e[1];
    let x = h * t;
    for (const e of list) { if ((x -= e[1]) < 0) return e[0]; }
    return list[list.length - 1][0];
  }
  function isUniform(P, b) {
    if (P.uniform || b.uniform) return true;
    const d = P.districts && P.districts[b.dist];
    return !!(d && d.uniform);
  }
  // a colour weathered by age (older is darker and a touch warmer)
  function aged(hex, era) {
    if (!(era > 1800)) return hex;
    const a = Math.max(0, Math.min(1, (2026 - era) / 110));
    return shade(hex, 1 - 0.12 * a);
  }
  function eraFilter(mat, era) {
    if (!(era > 1800)) return mat;
    if (era < 1930 && (mat === "glass" || mat === "panel")) return era < 1925 ? "stone" : "deco";
    if (era >= 1955 && (mat === "deco")) return "concrete";
    if (era >= 1965 && mat === "stone") return "panel";
    return mat;
  }
  /* The variant of one building, from its own hash and its district: a
     SHALLOW COPY of the plan's building with the fabric's fields replaced
     (style, wall, glass, fh, bay, roof, and the variant bits `vbits`). The
     plan's own object is never touched. */
  function variantOf(P, b, prev) {
    if (isUniform(P, b)) return null;
    const h = function (salt) { return hq(b.x, b.z, salt); };
    const d = P.districts && P.districts[b.dist];
    const g = d && d.look ? d.look.grammar : "";
    const era = +b.era || 0, kind = b.kind || "";
    const v = { vW: 0, vH: 0 };
    const pick = function (list, salt) { return list[(h(salt) * list.length) | 0]; };
    let mat = null;
    if (b.type === "tower" || b.type === "office" || b.type === "apt") {
      if (b.style === "row") return rowVariant(P, b, g, era, h, pick, prev);
      if (kind === "prewar-tower") mat = h(611) < (era >= 1925 ? 0.7 : 0.35) ? "deco" : (h(612) < 0.2 ? "brick" : "stone");
      else if (kind === "glass-cluster") mat = "glass";
      else if (kind === "factory") mat = era >= 1940 && h(613) < 0.5 ? "concrete" : "brick";
      else if (kind === "elevator-head" || kind === "powerhouse") mat = kind === "powerhouse" ? "brick" : "concrete";
      else mat = pickW(FAMILY[g] || [[b.style === "glass" ? "glass" : b.style === "deco" ? "deco" : b.style === "concrete" ? "concrete" : b.style === "stone" ? "stone" : "brick", 1]], h(601));
      mat = eraFilter(mat, era);
      if (b.type === "tower" && !TOWER_OK[mat]) mat = h(602) < 0.5 ? "stone" : "glass";
      if (b.type === "tower" && mat === "brick" && b.h > 90) mat = "deco";
      // curtain walls are for towers and offices of some size
      if (mat === "glass" && b.type === "apt" && (b.st || 0) < 6) mat = "panel";
      v.mat = mat;
      if (mat === "glass") {
        v.style = "glass"; v.wall = pick(PAL.frame, 603); v.glass = pick(PAL.glass, 604);
        v.bay = [1.5, 1.35, 1.8, 2.1][(h(605) * 4) | 0];
      } else if (mat === "deco") {
        v.style = "deco"; v.wall = aged(h(606) < 0.35 && kind === "prewar-tower" ? pick(PAL.terracotta, 607) : pick(PAL.stone.concat(PAL.terracotta), 607), era);
        v.bay = [1.8, 1.6, 2.2][(h(608) * 3) | 0];
      } else if (mat === "stone") {
        const brown = h(609) < 0.22 && b.type !== "tower" && !(era >= 1940);
        v.style = "stone"; v.wall = aged(brown ? pick(PAL.brownstone, 610) : pick(PAL.stone, 610), era);
        v.bay = [2.6, 2.3, 3.0][(h(614) * 3) | 0];
        v.vW = [0, 0, 1, 3][(h(615) * 4) | 0]; v.vH = [0, 1, 3, 0, 1][(h(616) * 5) | 0];
      } else if (mat === "brick") {
        const painted = h(617) < 0.1;
        v.style = "brick"; v.wall = aged(painted ? pick(PAL.paintedBrick, 618) : pick(PAL.brick, 618), era);
        v.bay = kind === "factory" ? 4.2 : [2.8, 2.5, 3.2, 3.6][(h(619) * 4) | 0];
        v.vW = kind === "factory" ? 2 : [0, 0, 1, 2, 3][(h(620) * 5) | 0];
        v.vH = kind === "factory" ? 1 : [0, 0, 1, 2, 3][(h(621) * 5) | 0];
      } else if (mat === "concrete") {
        v.style = "concrete"; v.wall = aged(pick(PAL.concrete, 622), era);
        v.bay = [3.0, 2.4, 3.6][(h(623) * 3) | 0];
        v.vH = kind === "elevator-head" ? 2 : [0, 1, 2][(h(624) * 3) | 0];
      } else if (mat === "panel") {
        v.style = "panel"; v.wall = pick(PAL.panel, 625); v.glass = pick(PAL.glass, 626);
        v.bay = [1.8, 2.4, 1.5][(h(627) * 3) | 0];
      } else if (mat === "stucco") {
        v.style = "stucco"; v.wall = aged(pick(PAL.stucco, 628), era);
        v.bay = [2.6, 3.0][(h(629) * 2) | 0];
        v.vW = [0, 1][(h(630) * 2) | 0]; v.vH = [0, 3][(h(631) * 2) | 0];
      }
      // storey height: a walk-up is not an office floor
      const baseFh = b.fh || (b.type === "tower" ? 3.9 : 3.2);
      v.fh = b.type === "tower" ? baseFh * (0.95 + 0.1 * h(632)) : baseFh * (0.9 + 0.22 * h(632));
      if (kind === "factory") v.fh = Math.max(v.fh, 4.6);
      // the roofline of a slab
      if (b.type !== "tower") {
        const low = (b.h || 0) <= 32;
        const r = h(633);
        if ((mat === "brick" || mat === "stone") && low && r < 0.2 && !(era >= 1945)) v.roof = "mansard";
        else if ((mat === "brick" || mat === "stone" || mat === "stucco") && r < 0.6) v.cornice = true;
        v.par = mat === "glass" || mat === "panel" ? 0.6 + 0.8 * h(634) : 0.7 + 1.1 * h(634);
      }
      if (kind === "glass-cluster") v.round = true;
      // a pre-war tower may carry a stepped, floodlit crown instead of a flat top
      if (b.type === "tower" && b.roof === "flat" && (mat === "deco" || mat === "stone") && (b.st || 0) >= 18 && h(636) < 0.45) v.roof = "crown";
    } else if (b.type === "row") {
      return rowVariant(P, b, g, era, h, pick, prev);
    } else if (b.type === "house") {
      const brick = kind === "house-brick" || (kind !== "house-wood" && g !== "spanish" && h(640) < 0.25);
      v.houseMode = g === "spanish" && kind !== "house-brick" && kind !== "house-wood" ? "stucco" : brick ? "brick" : "wood";
      v.wall = v.houseMode === "brick" ? aged(pick(PAL.brick, 641), era) : v.houseMode === "stucco" ? pick(PAL.stucco, 641) : pick(PAL.paint, 641);
      v.trim = pick(PAL.trim, 642);
      v.vW = [0, 0, 1, 3][(h(643) * 4) | 0];
    } else if (b.type === "ware") {
      const brick = b.style === "brick" || (kind === "powerhouse") || h(650) < 0.3;
      v.style = brick ? "brick" : "metal";
      v.wall = brick ? aged(pick(PAL.brick, 651), era) : pick(PAL.panel.concat([0x8c9296, 0x9a8f7c, 0x7a8a7e]), 651);
      v.vH = kind === "powerhouse" ? 3 : 0;
    } else if (b.type === "tank" || b.type === "silo") {
      if (kind === "stack") { v.stack = true; v.wall = aged(pick(PAL.brick, 660), era); }
      else if (kind === "elevator" || b.type === "silo") { v.silo = true; v.wall = pick(PAL.concrete, 661); }
      else v.wall = shade(b.wall, 0.92 + 0.16 * h(662));
    } else return null;
    v.vbits = (v.vW & 3) | ((v.vH & 3) << 2) | (b.vacant ? 16 : 0);
    return neighbour(v, prev, h);
  }
  function rowVariant(P, b, g, era, h, pick, prev) {
    const v = { vW: 0, vH: 0 };
    const kind = b.kind || "";
    const paintedP = g === "victorian" ? 0.6 : kind === "mainstreet" ? 0.08 : 0.18;
    const r = h(670);
    if (r < paintedP) { v.painted = true; v.wall = pick(PAL.paint, 671); }
    else if (r < paintedP + (kind === "mainstreet" ? 0.25 : 0.1)) { v.stoneFront = true; v.wall = aged(kind === "mainstreet" ? pick(PAL.stone, 671) : pick(PAL.brownstone, 671), era); }
    else v.wall = aged(pick(PAL.brick, 671), era);
    v.trim = v.painted ? pick([0xe6e2d8, 0xf0ece0, 0x3a3a3c, 0x2f4538, 0x5a3a2a], 672) : pick(PAL.trim, 672);
    v.slate = pick(PAL.slate, 673);
    v.fh = (b.fh || 3.1) * (1 + 0.12 * h(674));       // taller, never shorter than planned
    v.vW = [0, 0, 1, 3][(h(675) * 4) | 0];
    v.vH = [0, 1, 1, 3, 2][(h(676) * 5) | 0];
    v.bayWin = !b.shop && h(677) < 0.35 && (b.st || 2) >= 2;
    v.cornice = 0.25 + 0.3 * h(678);
    v.vbits = (v.vW & 3) | ((v.vH & 3) << 2) | (b.vacant ? 16 : 0);
    return neighbour(v, prev, h);
  }
  // not the same as the building before it on the street
  function neighbour(v, prev, h) {
    if (!prev) return v;
    if (prev.wall === v.wall && prev.vbits === v.vbits && prev.style === v.style && prev.painted === v.painted) {
      v.wall = shade(v.wall, h(690) < 0.5 ? 0.86 : 1.12);
      v.vW = (v.vW + 1) & 3; v.vH = (v.vH + (v.vW === 0 ? 1 : 0)) & 3;
      v.vbits = (v.vbits & 16) | (v.vW & 3) | ((v.vH & 3) << 2);
    }
    return v;
  }
  // every building of the plan, once: the fabric's view of it (shared by
  // the near tile, the far tile and the facade kit)
  function planVariants(P) {
    if (P.__mfVar) return P.__mfVar;
    const B = P.bldgs, out = new Array(B.length);
    let prevV = null, prevB = null;
    for (let i = 0; i < B.length; i++) {
      const b = B[i];
      const near = prevB && prevB.dist === b.dist && prevB.type === b.type && Math.abs(prevB.x - b.x) + Math.abs(prevB.z - b.z) < 70;
      let v = null;
      try { v = variantOf(P, b, near ? prevV : null); } catch (e) { v = null; }
      if (!v) { out[i] = b; prevV = null; prevB = b; continue; }
      const vb = Object.assign({}, b);
      if (v.style) vb.style = v.style;
      if (v.wall != null) vb.wall = v.wall;
      if (v.glass != null) vb.glass = v.glass;
      if (v.fh) { vb.fh = v.fh; if (b.type !== "tower" && !isRow(b)) vb.st = Math.max(1, Math.round(b.h / v.fh)); }
      if (v.roof) vb.roof = v.roof;
      vb.v = v;
      out[i] = vb;
      prevV = v; prevB = b;
    }
    Object.defineProperty(P, "__mfVar", { value: out, enumerable: false, configurable: true });
    return out;
  }
  function vbOf(P, i) { return planVariants(P)[i]; }
  function tower(P, b, mask) {
    if (b.v && b.v.round) return roundTower(P, b);
    frame(0, 0, 0);
    const sm = STYLE[b.style] || STYLE.glass, mode = sm[0], bay = bayOf(b, sm), fh = b.fh || 3.9;
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
        if (first && f === 0 && mode !== M_GLASS) { bFl |= F_DOOR; bDoor = DOOR_MID; }
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

  function slabPar(b) { return b.v && b.v.par ? b.v.par : 1.1; }
  function slab(P, b, mask) {
    frame(0, 0, 0);
    const sm = STYLE[b.style] || STYLE.stone, mode = sm[0], bay = bayOf(b, sm), fh = b.fh || 3.2;
    const seed = seedOf(b), deck = deckOf(b), hw = b.w / 2, hd = b.d / 2;
    const mans = b.roof === "mansard";
    const y1 = GY + b.h, par = mans ? 0.25 : slabPar(b);
    const office = b.type === "office";
    let doorFace = -1;
    for (let k = 0; k < 4; k++) if (mask & (1 << k)) { doorFace = k; break; }
    facade(b.wall, b.glass, mode, fh, bay, b.h); bSeed = seed;
    walls(b.x, b.z, hw, hd, FOOT, y1 + par, function (k, len) {
      bFl = (office ? F_OFFICE : 0) | (b.shop && (mask & (1 << k)) ? F_SHOP : 0);
      if (k === doorFace && mode !== M_GLASS) { bFl |= F_DOOR; bDoor = DOOR_MID; }
    });
    let top = y1 + par;
    if (mans) top = mansardRoof(b.x, b.z, hw, hd, y1 + par, seed, (b.v && b.v.slate) || PAL.slate[(hq(b.x, b.z, 673) * PAL.slate.length) | 0], true);
    else {
      parapet(b.x, b.z, hw, hd, y1, y1 + par - 0.1, 0.3, b.wall, deck);
      roofPlant(b, b.x, b.z, hw - 0.4, hd - 0.4, y1, office ? "office" : "apt");
    }
    if (b.shop && !office) for (let k = 0; k < 4; k++) if (mask & (1 << k)) awning(k, b.x, b.z, hw, hd, GY + Math.min(3.0, fh - 0.2), AWNINGS[(hq(b.x + k, b.z, 812) * AWNINGS.length) | 0]);
    // a projecting cornice (near only: under a pixel from the far tile)
    if (!FAR && b.v && b.v.cornice && !mans) corniceRing(b.x, b.z, hw, hd, y1 + par - 0.1, 0.42, 0.45, shade(b.wall, 1.12));
    aabb(b.x - hw, b.x + hw, b.z - hd, b.z + hd, 0, top);
    return top;
  }
  /* A SLATE MANSARD storey on a flat deck at y0: four raked slopes with
     dormers (M_MANSARD paints them), a flat top. `cx, cz` in the current
     frame. Returns the top. */
  function mansardRoof(cx, cz, hw, hd, y0, seed, slateHex, allDormers) {
    const h = 2.6, ins = 0.95, e = 0.12;
    const ow = hw + e, od = hd + e, iw = Math.max(0.5, ow - ins), id = Math.max(0.5, od - ins);
    hexC(slateHex); bMode = M_MANSARD; bFh = 30; bBay = q10(2.4); bTop = 0; bDoor = 255; bSeed = seed; bVar = 0;
    for (let k = 0; k < 4; k++) {
      const f = FK[k], len = faceLen(k, ow, od), ilen = faceLen(k, iw, id);
      bFl = !allDormers && (k === 1 || k === 3) ? F_BLANK : 0;
      const bys = baysFor(len); bBays = bys;
      const ax = cx + f.lx * ow, az = cz + f.lz * od, bx = ax + f.rx * len, bz = az + f.rz * len;
      const dx = cx + f.lx * iw, dz = cz + f.lz * id, qx = dx + f.rx * ilen, qz = dz + f.rz * ilen;
      const inset = (len - ilen) / 2 / len * bys;
      quad(ax, y0, az, bx, y0, bz, qx, y0 + h, qz, dx, y0 + h, dz, f.nx, 0.35, f.nz, 0, 0, bys, Math.hypot(h, ins));
      AU[(nv - 2) * 4] = i16((bys - inset) * 32); AU[(nv - 1) * 4] = i16(inset * 32);
      AU[(nv - 3) * 4] = i16(bys * 32);
    }
    plain(0x3f4046, M_DECK);
    topQuad(cx, cz, iw, id, y0 + h);
    return y0 + h;
  }
  /* A CORNICE all round a block: a ledge `out` deep, `h` tall, its top at y,
     with an underside (it is seen from the street) and a top. The four runs
     overlap at the corners, so a corner reads solid. */
  function corniceRing(cx, cz, hw, hd, y, h, out, hex) {
    plain(hex);
    for (let k = 0; k < 4; k++) {
      const f = FK[k], len = faceLen(k, hw, hd) + 2 * out;
      const hn = (k & 1) ? hw : hd;                    // centre to this face
      // the face's wall line, left to right from outside, then pushed out
      const ox = cx + f.nx * hn, oz = cz + f.nz * hn;       // face centre on the wall
      const ax = ox - f.rx * len / 2, az = oz - f.rz * len / 2, bx = ox + f.rx * len / 2, bz = oz + f.rz * len / 2;
      const px = f.nx * out, pz = f.nz * out;
      quad(ax + px, y - h, az + pz, bx + px, y - h, bz + pz, bx + px, y, bz + pz, ax + px, y, az + pz, f.nx, 0, f.nz, 0, 0, len, h);
      quad(ax, y - h, az, bx, y - h, bz, bx + px, y - h, bz + pz, ax + px, y - h, az + pz, 0, -1, 0, 0, 0, len, out);
      quad(ax, y, az, bx, y, bz, bx + px, y, bz + pz, ax + px, y, az + pz, 0, 1, 0, 0, 0, len, out);
    }
  }
  /* THE ROUND GLASS TOWERS (the riverfront cluster): each tier a cylinder of
     curtain wall, the same facade shader (u in segments, v in metres), a
     flat roof, a lantern on the tallest. */
  function roundTower(P, b) {
    frame(0, 0, 0);
    const fh = b.fh || 3.9, seed = seedOf(b), deck = deckOf(b);
    const tiers = b.tiers && b.tiers.length ? b.tiers : [{ w: b.w, d: b.d, y0: 0, y1: b.h, x: b.x, z: b.z }];
    let topY = GY + b.h;
    for (let k = 0; k < tiers.length; k++) {
      const t = tiers[k], last = k === tiers.length - 1;
      const r = Math.min(t.w, t.d) / 2, seg = Math.max(16, Math.min(40, Math.round(2 * Math.PI * r / 1.6)));
      const y0 = k === 0 ? FOOT : GY + t.y0, y1 = GY + t.y1, par = last ? 2.0 : 0.8;
      facade(b.wall, b.glass, M_GLASS, fh, 2 * Math.PI * r / seg, t.y1); bSeed = seed; bBays = seg;
      bFl = F_OFFICE | (k === 0 && b.shop ? F_SHOP : 0);
      cylinder(t.x, t.z, r, y0, y1 + par, seg);
      plain(deck, M_DECK);
      dome(t.x, t.z, r, y1 + par, 0.05, seg);
      const c = r * 0.92;
      aabb(t.x - c, t.x + c, t.z - c, t.z + c, k === 0 ? 0 : y0, y1 + par);
      topY = y1 + par;
      if (last && (b.roof === "crown" || b.roof === "spire")) {
        plain(shade(b.wall, 1.2), M_PLAIN, F_DOCK);
        cylinder(t.x, t.z, r * 0.55, topY, topY + 6, seg);
        plain(shade(b.wall, 1.1)); dome(t.x, t.z, r * 0.55, topY + 6, 0.05, seg);
        topY += 6;
        if (b.roof === "spire") {
          const sh = Math.max(24, 0.18 * b.h);
          plain(0xb8bcc0); pyramid(t.x, t.z, Math.max(0.9, r * 0.12), 0.1, topY, topY + sh);
          aabb(t.x - 1, t.x + 1, t.z - 1, t.z + 1, topY, topY + sh);
          topY += sh;
        }
      }
    }
    return topY;
  }

  /* A ROW's street front is its local +Z. face n/e/s/w: an axis-aligned
     terrace facing that way (b.w/b.d are world extents). face "rot": a row
     on a diagonal avenue, the house() convention: frame(b.x, b.z, b.rot),
     b.w the frontage along local x, b.d the depth, oriented collider. */
  function rowFrame(b) {
    const turned = b.face === "rot";
    const face = !turned && b.face && FACE_K[b.face] != null ? b.face : "s";
    const rot = turned ? (b.rot || 0) : FACE_ROT[face];
    const ns = turned || face === "n" || face === "s";
    return { rot: rot, turned: turned, Wd: ns ? b.w : b.d, Dp: ns ? b.d : b.w };
  }
  function rowCollider(b, rf, top) {
    if (rf.turned) oriented(b.x, b.z, rf.Wd / 2, rf.Dp / 2, rf.rot, 0, top);
    else aabb(b.x - b.w / 2, b.x + b.w / 2, b.z - b.d / 2, b.z + b.d / 2, 0, top);
    // the bay window stands 0.75 m out of the front: it is solid too
    if (b.v && b.v.bayWin && rf.bayW > 1.4) {
      const c = Math.cos(rf.rot), s = Math.sin(rf.rot), lx = rf.bayX, lz = rf.Dp / 2 + 0.375;
      oriented(b.x + lx * c + lz * s, b.z - lx * s + lz * c, rf.bayW / 2, 0.375, rf.rot, 0, GY + rf.bayTop);
    }
  }
  function row(P, b) {
    const rf = rowFrame(b), rot = rf.rot;
    frame(b.x, b.z, rot);
    const Wd = rf.Wd, Dp = rf.Dp, hw = Wd / 2, hd = Dp / 2;
    const fh = b.fh || 3.1, st = b.st || 2;
    const deckY = GY + st * fh + 0.25, parTop = Math.max(deckY + 0.5, GY + b.h);
    const painted = b.v ? !!b.v.painted : grammarOf(P, b) === "victorian";
    const seed = seedOf(b), deck = deckOf(b);
    const mansard = b.roof === "mansard";
    facade(b.wall, b.glass, M_ROW, fh, 2.3, st * fh); bSeed = seed;
    // the door is in the middle bay (DOOR_MID): that is where the facade
    // kit cuts it (FACADE CELLS)
    const hasDoor = !b.shop;
    walls(0, 0, hw, hd, FOOT, mansard ? deckY : parTop, function (k) {
      bFl = painted ? F_SPEC : 0;
      if (k === 0) { if (b.shop) bFl |= F_SHOP; else { bFl |= F_DOOR; bDoor = DOOR_MID; } }
      else if (k === 1 || k === 3) bFl |= F_BLANK;
    });
    let top;
    if (mansard) {
      // the mansard storey: slate slopes, dormers front and back
      top = mansardRoof(0, 0, hw, hd, deckY, seed, b.slate || (b.v && b.v.slate) || 0x4b4d55, false);
    } else {
      parapet(0, 0, hw, hd, deckY, parTop, 0.22, b.wall, deck);
      top = parTop;
    }
    // A BAY WINDOW: a two-storey box standing out of the front, its own
    // windows painted on it. Massing, so the far tile has it too.
    const bayW = b.v && b.v.bayWin ? Math.min(2.8, Wd * 0.42) : 0;
    let bayX = 0;
    if (bayW > 1.4) {
      const pj = 0.75, yb = GY + 0.55, yt = GY + Math.min(st, 2) * fh - 0.15;
      bayX = (hq(b.x, b.z, 679) < 0.5 ? -1 : 1) * (hw - bayW / 2 - 0.35);
      facade(b.wall, b.glass, M_ROW, fh, bayW, st * fh); bSeed = seed;
      walls(bayX, hd + pj / 2, bayW / 2, pj / 2, yb, yt, function (k) { bFl = painted ? F_SPEC : 0; if (k === 2) return false; });
      plain(b.v.trim != null ? b.v.trim : shade(b.wall, 0.8));
      topQuad(bayX, hd + pj / 2, bayW / 2, pj / 2, yt);
      quad(bayX - bayW / 2, yb, hd, bayX + bayW / 2, yb, hd, bayX + bayW / 2, yb, hd + pj, bayX - bayW / 2, yb, hd + pj, 0, -1, 0, 0, 0, bayW, pj);
    }
    rf.bayW = bayW; rf.bayX = bayX; rf.bayTop = Math.min(st, 2) * fh;
    if (FAR) { frame(0, 0, 0); rowCollider(b, rf, top); return top; }
    // cornice along the front
    const cy = mansard ? deckY + 0.1 : parTop;
    const cd = b.v && b.v.cornice ? b.v.cornice + 0.1 : 0.38;
    plain(b.v && b.v.trim != null ? b.v.trim : painted ? 0xe6e2d8 : shade(b.wall, 0.72));
    quad(-hw, cy - 0.5, hd + cd, hw, cy - 0.5, hd + cd, hw, cy, hd + cd, -hw, cy, hd + cd, 0, 0, 1, 0, 0, Wd, 0.5);
    quad(-hw, cy - 0.5, hd, hw, cy - 0.5, hd, hw, cy - 0.5, hd + cd, -hw, cy - 0.5, hd + cd, 0, -1, 0, 0, 0, Wd, cd);
    quad(-hw, cy, hd, hw, cy, hd, hw, cy, hd + cd, -hw, cy, hd + cd, 0, 1, 0, 0, 0, Wd, cd);
    // stoop to the door, or an awning over the corner shop
    if (hasDoor) {
      plain(0x9a958a);
      box(0, hd + 0.7, 0.8, 0.7, FOOT, GY + 0.55);
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
    rowCollider(b, rf, top);
    return top;
  }

  function house(P, b) {
    const rot = b.rot || 0;
    frame(b.x, b.z, rot);
    const Wd = b.w, Dp = b.d, hd = Dp / 2;
    const st = b.st || 1, fh = 3.0;
    const gr = grammarOf(P, b);
    const hm = b.v && b.v.houseMode;
    const mode = hm ? (hm === "stucco" ? M_STUCCO : hm === "brick" ? M_BRICK : M_HOUSE) : gr === "spanish" ? M_STUCCO : M_HOUSE;
    const flX = mode === M_STUCCO ? F_ARCH : (mode === M_HOUSE && (gr === "victorian" || (b.v && hq(b.x, b.z, 644) < 0.45)) ? F_SPEC : 0);
    const seed = seedOf(b), roofHex = b.roofCol || 0x444040;
    const trim = b.v && b.v.trim != null && mode !== M_STUCCO ? b.v.trim : mode === M_STUCCO ? shade(b.wall, 0.85) : 0xdcd8ce;
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
    const v = b.v || {};
    // a brick stack, a concrete grain silo, or a steel tank
    facade(b.wall, 0, v.stack ? M_BRICK : v.silo ? M_CONCRETE : M_METAL, 3, perim / seg, 0); bFl = F_BLANK; bSeed = seedOf(b); bBays = seg;
    const y1 = GY + b.h;
    cylinder(b.x, b.z, r, FOOT, y1, seg);
    let top;
    if (v.stack) {
      // the stack's cap: a corbelled band, open at the top
      plain(shade(b.wall, 0.6));
      cylinder(b.x, b.z, r + 0.25, y1 - 1.2, y1, seg);
      dome(b.x, b.z, r + 0.25, y1, 0.02, seg);
      top = y1;
    } else if (v.silo) {
      plain(shade(b.wall, 1.04));
      dome(b.x, b.z, r, y1, r * 0.12, seg);
      top = y1 + r * 0.12;
    } else {
      plain(shade(b.wall, 1.06));
      dome(b.x, b.z, r, y1, b.type === "silo" ? r * 0.9 : r * 0.28, seg);
      top = y1 + (b.type === "silo" ? r * 0.9 : r * 0.28);
    }
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
  //  FACADE CELLS — THE REAL FACADE KIT ON THE STREETS NEAR THE CAMERA.
  //
  //  Owner: "are facades on the massive cities?" They were not: the Gang
  //  City downtown wears city/facade_kit.js (real piers, reveals, sills,
  //  cornices, storefront iron: 3D boxes), and every metro building wore
  //  only the shader above, so a Kingsport street was flatter than
  //  downtown up close. Now the buildings within ~350 m of the camera are
  //  handed to the SAME kit, the same grammars, through a host written here:
  //
  //    * WHICH GRAMMAR. The building's own fabric style picks the family
  //      (what the shader already paints), the district look picks inside
  //      it: glass -> the look's intl/hightech, deco -> artdeco, stone ->
  //      stone, brick -> brick, concrete -> brutalist, rows -> brickhouse or
  //      victorian (the painted rows). Out of a grammar's storey range ->
  //      KIT_FALL, the nearest family member. Houses, warehouses, tanks,
  //      silos, strips, malls, civic halls, barns, the stadium, the station
  //      stay shader-only: the fabric already models them in 3D (gables,
  //      eaves, garages, porches, canopies, domes) and every house grammar
  //      would rebuild the roof and porch the fabric already built.
  //    * THE KIT FITS THE WALL THAT IS THERE. The fabric's bay grid goes in
  //      as ctx.grid (piers, reveals and sills land on the painted
  //      windows), its door is the middle bay (DOOR_MID) where every
  //      grammar cuts its doorway, and a shop's painted storefront keeps
  //      its ground storey (cut out of the kit like buildings.js's
  //      storefront keep-clear) with a real frame built here instead.
  //    * ONE WORLD. The kit's glass boxes are dropped (the shader's glass
  //      reflects and lights at night; a flat dark box over it would not),
  //      and the kit's palette is scaled per channel so its main colour IS
  //      the building's wall colour: the near street averages to the far
  //      HLOD. Everything is written through the fabric's own writer with
  //      mode M_KIT into the fabric material: one colour pipeline (the sRGB
  //      decode + 30% ease to grey in MF_MAIN), the same fog scale and
  //      aerial haze, the same foot grime and canyon occlusion as the wall.
  //    * NO NEW SILHOUETTE. The fabric owns the roofline (the far HLOD has
  //      it): a grammar's crown, roof furniture and anything buried inside
  //      the shell is dropped, nothing stands more than KIT_TOPLIP over the
  //      parapet or KIT_REACH past a wall (the footway), party walls of
  //      rows and perimeter blocks are never dressed (neighbours abut).
  //    * COST. One mesh per 200 m cell, the fabric material, no colliders
  //      (relief is under KIT_REACH and thin; the building colliders are
  //      the fabric's), faces buried in the shell or the ground culled,
  //      built as a sliced job under metro.js's frame budget, dropped when
  //      the camera leaves. CPU arrays freed once on the GPU.
  // ---------------------------------------------------------------------
  const KIT_CELL = 100;           // metres: one mesh
  const KIT_REACH = 1.2;          // nothing past a wall further than this
  const KIT_TOPLIP = 0.6;         // a cornice may lip this far over the parapet top
  const KMAP = [1, 3, 0, 2];      // fabric face FK[k] -> kit side (0 -z, 1 +z, 2 -x, 3 +x)
  /* LEVELS OF DETAIL. A cell is built for the nearest distance the camera
     can be from it at its level (metro.js picks the level from the cell's
     nearest distance; KIT_LOD_R is where each level starts) and for the
     camera's height when it was built (cell.anchor.y, cell.anchor.slack:
     metro.js rebuilds a cell when the camera climbs or drops more). A box
     is at least max(level start, its height gap to the eye - slack) away,
     and it is dropped only if its face is under a pixel there (KIT_PX: 1080p
     at 60 deg, one pixel is ~0.0011 of the distance); relief shallower than
     half that is written as its front face only (its sides are sub-pixel).
     So a chevron 0.11 m tall is kept to ~100 m, a flute to ~90 m, a 0.3 m
     sill to ~270 m: nothing that shows is missing at any level, and a box
     that is kept is the same box, same colour, at every level. */
  const KIT_LOD_R = [0, 40, 110, 180];
  const KIT_PX = 0.0011;          // one pixel, in metres per metre of distance
  const KIT_FALL = { intl: "hightech", hightech: "brutalist", brickhouse: "brick", victorian: "brick", artdeco: "stone", stone: "brick", brutalist: "brick" };
  function isRow(b) { return b.type === "row" || ((b.type === "office" || b.type === "apt") && b.style === "row"); }
  function kitGrammar(P, b) {
    if (typeof CBZ.facadeDef !== "function" || typeof CBZ.dressFacade !== "function") return null;
    if (CBZ.CONFIG && (CBZ.CONFIG.FACADE_KIT === false || CBZ.CONFIG.METRO_FACADES === false)) return null;
    if (!(b.h >= 2.5)) return null;               // no storey to dress (the planner emits a few zero-height lots)
    const g = grammarOf(P, b);
    const st = b.st || Math.max(1, Math.round(b.h / (b.fh || 3.2)));
    let id = null;
    const v = b.v || null;
    if (v && v.round) return null;                 // the round glass towers: shader and silhouette only
    // a UNIFORM plan (the planned capital) wears one grammar, on purpose
    if (isUniform(P, b)) {
      if (!(isRow(b) || b.type === "tower" || b.type === "office" || b.type === "apt")) return null;
      const d0 = CBZ.facadeDef("brutalist");
      return d0 ? "brutalist" : null;
    }
    if (isRow(b)) id = (v ? v.painted : g === "victorian") ? "victorian" : "brickhouse";
    else if (b.type === "tower" || b.type === "office" || b.type === "apt") {
      id = b.style === "glass" ? (g === "hightech" ? "hightech" : "intl")
        : b.style === "deco" ? "artdeco" : b.style === "stone" ? (b.roof === "mansard" ? "victorian" : "stone")
        : b.style === "brick" ? (b.roof === "mansard" ? "victorian" : "brick") : b.style === "stucco" ? "brick"
        : b.style === "concrete" || b.style === "panel" ? "brutalist" : null;
    }
    for (let guard = 0; id && guard < 8; guard++) {
      const d = CBZ.facadeDef(id);
      if (d && st >= d.minStoreys && st <= d.maxStoreys) return id;
      id = KIT_FALL[id] || null;
    }
    return null;
  }
  // the fabric's bays on each kit side, as the walls() pass above lays them
  function kitGrid(bay, w, d, doorK) {
    bBay = q10(bay);
    const g = [0, 0, 0, 0];
    for (let k = 0; k < 4; k++) {
      const len = (k & 1) ? d : w;
      g[KMAP[k]] = k === doorK ? oddBays(len) : baysFor(len);
    }
    return g;
  }
  /* The parts of one building the kit dresses, each a box standing on the
     lot in its own frame: a row, a slab, or one tier of a tower. An upper
     tier is dressed as a building that starts two whole storeys under its
     own base (`shift`, on a painted floor line, so its floors are the
     painted floors) with everything under the base cut away: the grammar's
     portal and plinth land in those two phantom storeys and go with them,
     and the floors below are never generated at all. */
  function kitParts(P, b, mask) {
    const style = kitGrammar(P, b);
    if (!style) return null;
    const parts = [];
    if (isRow(b)) {
      const rf = rowFrame(b), Wd = rf.Wd, Dp = rf.Dp;
      const fh = b.fh || 3.1, st = b.st || 2;
      const mansard = b.roof === "mansard";
      const deckY = st * fh + 0.25, parTop = Math.max(deckY + 0.5, b.h);
      parts.push({ x: b.x, z: b.z, rot: rf.rot, w: Wd, d: Dp, fh: fh, storeys: st, rTop: st * fh,
        pp: mansard ? 0.25 : parTop - st * fh, wallTop: mansard ? deckY : parTop, base: -1,
        doorSide: 1, noDoor: !!b.shop, doorH: 2.85,
        // the street front only: a terrace's back faces the block's yards
        grid: kitGrid(2.3, Wd, Dp, b.shop ? -1 : 0), allow: 2, shops: b.shop ? 2 : 0 });
    } else if (b.type === "tower") {
      const sm = STYLE[b.style] || STYLE.glass, mode = sm[0], fh = b.fh || 3.9;
      const tiers = b.tiers && b.tiers.length ? b.tiers : [{ w: b.w, d: b.d, y0: 0, y1: b.h, x: b.x, z: b.z }];
      for (let k = 0; k < tiers.length; k++) {
        const t = tiers[k], last = k === tiers.length - 1, first = k === 0;
        const par = last ? (mode === M_GLASS ? 2.4 : 1.3) : 1.0;
        const shift = first ? 0 : Math.max(0, (Math.floor(t.y0 / fh + 0.02) - 2) * fh);
        parts.push({ x: t.x, z: t.z, rot: 0, w: t.w, d: t.d, fh: fh, shift: shift, storeys: Math.max(1, Math.floor((t.y1 - shift) / fh + 0.02)), rTop: t.y1,
          pp: par, wallTop: t.y1 + par, base: first ? -1 : t.y0, doorSide: 1, noDoor: !first, doorH: 2.3,
          grid: kitGrid(bayOf(b, sm), t.w, t.d, first && mode !== M_GLASS ? 0 : -1), allow: 15,
          shops: first && b.shop && mode !== M_GLASS ? 15 : 0 });
      }
    } else {
      const sm = STYLE[b.style] || STYLE.stone, mode = sm[0], fh = b.fh || 3.2;
      let doorFace = -1;
      for (let k = 0; k < 4; k++) if (mask & (1 << k)) { doorFace = k; break; }
      let allow = 0, shops = 0;
      for (let k = 0; k < 4; k++) {
        const side = 1 << KMAP[k];
        if (b.type !== "apt" || (mask & (1 << k))) allow |= side;
        if (b.shop && (mask & (1 << k)) && mode !== M_GLASS) shops |= side;
      }
      const par = slabPar(b), mans = b.roof === "mansard";
      parts.push({ x: b.x, z: b.z, rot: 0, w: b.w, d: b.d, fh: fh, storeys: Math.max(1, Math.floor(b.h / fh + 0.02)), rTop: b.h,
        pp: mans ? 0.25 : par, wallTop: b.h + (mans ? 0.25 : par), base: -1, doorSide: doorFace >= 0 ? KMAP[doorFace] : 1, noDoor: doorFace < 0, doorH: 2.3,
        grid: kitGrid(bayOf(b, sm), b.w, b.d, mode !== M_GLASS ? doorFace : -1), allow: allow, shops: shops });
    }
    for (const p of parts) p.style = style;
    return parts;
  }

  // ---- run the grammar against recording emitters -----------------------
  function kitHash(x, z) {
    return typeof CBZ.hash01 === "function" ? function (salt) { return CBZ.hash01(x, z, salt); } : function (salt) { return hq(x, z, salt); };
  }
  function kitRun(pt, b) {
    const boxes = [], rounds = [];
    const sh = pt.shift || 0;                   // grammar y -> metres above the lot
    const bx = function (x, y, z, w, h, d, col) {
      if (!(w > 0) || !(h > 0) || !(d > 0) || !Number.isFinite(x + y + z + w + h + d)) return;
      boxes.push([x - w / 2, x + w / 2, y - h / 2 + sh, y + h / 2 + sh, z - d / 2, z + d / 2, (col >>> 0) & 0xffffff]);
    };
    const rnd = function (kind) {
      return function (x, y, z, r, a, b2) {
        if (!(r > 0) || !Number.isFinite(x + y + z + r)) return;
        // ball/dome/lamp: (x,y,z,r,col); column/cone: (x,y,z,r,h,col)
        const tall = kind === 1 || kind === 2;
        rounds.push({ k: kind, x: x, y: y + sh, z: z, r: r, h: tall ? a : r, col: ((tall ? b2 : a) >>> 0) & 0xffffff });
      };
    };
    const nop = function () {};
    const wall = b.wall;
    const ctx = {
      ox: pt.x, oz: pt.z, w: pt.w, d: pt.d, storeys: pt.storeys, FH: pt.fh, WT: 0.3, rTop: pt.rTop - sh, pp: pt.pp,
      doorSide: pt.doorSide, slabCx: 0, slabCz: 0, slabW: pt.w - 0.6, slabD: pt.d - 0.6,
      garageGround: false, showroom: false, civic: null, dress: { style: pt.style },
      grid: pt.grid, doorW: 1.3, doorH: pt.doorH, noDoor: pt.noDoor,
      pal: { wall: wall, stone: shade(wall, 1.14), dirt: 0x2a2420, kind: pt.style === "brick" || pt.style === "brickhouse" ? "brick" : "ashlar", id: null },
      color: wall, TRIM: shade(wall, 1.16), BASE: shade(wall, 0.6), PIL: shade(wall, 1.06), MULL: 0x39404a,
      hash: kitHash(pt.x, pt.z),
      dbox: bx, lbox: bx, plat: nop, disc: nop, plaque: nop, seal: nop,
      ball: rnd(0), column: rnd(1), cone: rnd(2), dome: rnd(3), lamp: rnd(4),
    };
    CBZ.dressFacade(ctx);
    pt.boxes = boxes; pt.rounds = rounds;
  }

  // ---- what of it is kept -----------------------------------------------
  function lum8(c) { return (((c >> 16) & 255) * 0.299 + ((c >> 8) & 255) * 0.587 + (c & 255) * 0.114) / 255; }
  const KSTAT = { boxes: 0, kept: 0, glass: 0, roof: 0, face: 0, cut: 0, lod: 0 };
  function kitCuts(pt) {
    const hw = pt.w / 2, hd = pt.d / 2, cuts = [];
    if (pt.base > 0) cuts.push({ x0: -1e4, x1: 1e4, z0: -1e4, z1: 1e4, y0: -1e4, y1: pt.base + 0.02 });
    // a shop's ground storey is its painted storefront: the kit leaves it,
    // corner piers 0.7 m each end survive (buildings.js's storefront bay)
    const top = pt.fh - 0.02;
    for (let s = 0; s < 4; s++) {
      if (!(pt.shops & (1 << s))) continue;
      if (s < 2) {
        const z0 = s === 1 ? hd - 0.05 : -hd - 40, z1 = s === 1 ? hd + 40 : -hd + 0.05;
        cuts.push({ x0: -hw + 0.7, x1: hw - 0.7, y0: -1, y1: top, z0: z0, z1: z1 });
      } else {
        const x0 = s === 3 ? hw - 0.05 : -hw - 40, x1 = s === 3 ? hw + 40 : -hw + 0.05;
        cuts.push({ x0: x0, x1: x1, y0: -1, y1: top, z0: -hd + 0.7, z1: hd - 0.7 });
      }
    }
    return cuts;
  }
  function kitKeep(pt, lod) {
    lod = lod | 0;
    const hw = pt.w / 2, hd = pt.d / 2, e = 0.01, allow = pt.allow, yTop = pt.wallTop + KIT_TOPLIP;
    const A = pt.anchor, d0 = KIT_LOD_R[Math.max(0, Math.min(KIT_LOD_R.length - 1, lod))];
    let sizeMin = KIT_PX * d0, flatMin = 0.45 * sizeMin;
    const cuts = kitCuts(pt), sub = CBZ.FACADE_F && CBZ.FACADE_F.subtractBox;
    const out = [];
    let q = pt.boxes;
    KSTAT.boxes += q.length;
    if (cuts.length && sub) {
      for (const c of cuts) {
        const nq = [];
        for (const bx of q) {
          if (bx[1] > c.x0 && bx[0] < c.x1 && bx[5] > c.z0 && bx[4] < c.z1 && bx[3] > c.y0 && bx[2] < c.y1) {
            KSTAT.cut++;
            for (const p of sub(bx, c)) { p.push(bx[6]); nq.push(p); }
          } else nq.push(bx);
        }
        q = nq;
      }
    }
    for (const bx of q) {
      let x0 = bx[0], x1 = bx[1], y0 = bx[2], y1 = bx[3], z0 = bx[4], z1 = bx[5];
      const col = bx[6];
      const ex = x1 - x0, ey = y1 - y0, ez = z1 - z0, thin = Math.min(ex, ey, ez);
      // GLASS: a dark pane or spandrel laid over an opening. The shader's
      // glass is there already (and reflects, and lights up at night)
      if (lum8(col) < 0.175 && thin < 0.3 && ex * ey * ez / thin >= 0.45) { KSTAT.glass++; continue; }
      // inside the footprint in plan: a crown, roof plant, or buried in the
      // shell. The fabric owns the roofline.
      if (x0 >= -hw - e && x1 <= hw + e && z0 >= -hd - e && z1 <= hd + e) { KSTAT.roof++; continue; }
      y1 = Math.min(y1, yTop); y0 = Math.max(y0, -0.3);
      if (y1 - y0 < 0.02) { KSTAT.roof++; continue; }
      // which face it dresses: the one it stands proud of most
      const p0 = -hd - z0, p1 = z1 - hd, p2 = -hw - x0, p3 = x1 - hw;
      let s = 0, pm = p0;
      if (p1 > pm) { s = 1; pm = p1; } if (p2 > pm) { s = 2; pm = p2; } if (p3 > pm) { s = 3; pm = p3; }
      if (!(allow & (1 << s))) { KSTAT.face++; continue; }
      // never through a party wall, never onto the footway
      if (!(allow & 1)) z0 = Math.max(z0, -hd); if (!(allow & 2)) z1 = Math.min(z1, hd);
      if (!(allow & 4)) x0 = Math.max(x0, -hw); if (!(allow & 8)) x1 = Math.min(x1, hw);
      x0 = Math.max(x0, -hw - KIT_REACH); x1 = Math.min(x1, hw + KIT_REACH);
      z0 = Math.max(z0, -hd - KIT_REACH); z1 = Math.min(z1, hd + KIT_REACH);
      if (x1 - x0 < 0.02 || z1 - z0 < 0.02) { KSTAT.face++; continue; }
      // what the face shows (along it x up it) and how deep it stands
      const along = s < 2 ? x1 - x0 : z1 - z0, deep = s < 2 ? z1 - z0 : x1 - x0;
      if (A) {
        const dy = Math.max(y0 - A.y, 0, A.y - y1) - A.slack;
        if (dy > d0) { sizeMin = KIT_PX * dy; flatMin = 0.45 * sizeMin; }
        else { sizeMin = KIT_PX * d0; flatMin = 0.45 * sizeMin; }
      }
      if (Math.min(along, y1 - y0) < sizeMin) { KSTAT.lod++; continue; }
      out.push([x0, x1, y0, y1, z0, z1, col, deep < flatMin ? s : -1]);
    }
    const rs = [];
    for (const r of pt.rounds) {
      const yb = r.k === 0 ? r.y - r.r : r.y, yt = yb + (r.k === 0 ? 2 * r.r : r.h);
      if (yt > yTop + 0.01 || yb < -0.3) { KSTAT.roof++; continue; }
      const p0 = -hd - (r.z - r.r), p1 = r.z + r.r - hd, p2 = -hw - (r.x - r.r), p3 = r.x + r.r - hw;
      let s = 0, pm = p0;
      if (p1 > pm) { s = 1; pm = p1; } if (p2 > pm) { s = 2; pm = p2; } if (p3 > pm) { s = 3; pm = p3; }
      if (pm <= 0.01 || !(allow & (1 << s))) { KSTAT.face++; continue; }
      if (Math.abs(r.x) + r.r > hw + KIT_REACH || Math.abs(r.z) + r.r > hd + KIT_REACH) { KSTAT.face++; continue; }
      if (r.r * 2 < KIT_PX * d0) { KSTAT.lod++; continue; }
      rs.push(r);
    }
    KSTAT.kept += out.length;
    pt.kept = out; pt.keptR = rs;
  }

  /* ONE WORLD, ONE WALL COLOUR. A grammar paints in its own palette (a
     loft's red, a Seagram's bronze); the far HLOD paints this building in
     its district wall colour. So the kit's palette is scaled, per channel,
     until its AREA-WEIGHTED MEAN is the wall colour: the kit replaces a
     piece of painted wall with relief of the same average colour, and the
     near street averages to what the far tile shows. Every colour keeps its
     contrast to the others (stone trim stays paler than brick, iron stays
     dark). A palette too far from the wall for a sane gain (a bronze
     curtain wall on a limestone tower) is re-mapped instead: each colour
     becomes the wall colour at that colour's own lightness relative to the
     mean. Glass is not in it (dropped: the shader's glass shows). */
  function kitGain(parts, wall) {
    let a = 0, mr = 0, mg = 0, mb = 0;
    for (const pt of parts) for (const bx of pt.kept) {
      const ex = bx[1] - bx[0], ey = bx[3] - bx[2], ez = bx[5] - bx[4];
      const ar = Math.max(ex * ey, ey * ez, ex * ez), c = bx[6];
      mr += ((c >> 16) & 255) * ar; mg += ((c >> 8) & 255) * ar; mb += (c & 255) * ar; a += ar;
    }
    const g = [1, 1, 1];
    g.lum = 0;
    if (!(a > 0)) return g;
    const m = [mr / a, mg / a, mb / a];
    let wild = false;
    for (let i = 0; i < 3; i++) {
      const wv = (wall >> (16 - i * 8)) & 255;
      g[i] = (wv + 3) / (m[i] + 3);
      if (g[i] < 0.4 || g[i] > 2.5) wild = true;
    }
    if (wild) g.lum = (m[0] * 0.299 + m[1] * 0.587 + m[2] * 0.114) / 255 || 0.01;
    g.wall = wall;
    return g;
  }
  // what the tools read: per grammar, how far the gain had to go, and the
  // kit's area-weighted mean colour against the wall it stands on
  function kitColourNote(style, parts, g, wall) {
    const C = KSTAT.colour || (KSTAT.colour = {});
    const r = C[style] || (C[style] = { n: 0, gain: [0, 0, 0], remapped: 0, meanDiff: [0, 0, 0], area: 0 });
    r.n++;
    if (g.lum) r.remapped++;
    for (let i = 0; i < 3; i++) r.gain[i] += g.lum ? 1 : g[i];
    let a = 0; const m = [0, 0, 0];
    for (const pt of parts) for (const bx of pt.kept) {
      const ex = bx[1] - bx[0], ey = bx[3] - bx[2], ez = bx[5] - bx[4], ar = Math.max(ex * ey, ey * ez, ex * ez);
      const c = gained(bx[6], g);
      m[0] += ((c >> 16) & 255) * ar; m[1] += ((c >> 8) & 255) * ar; m[2] += (c & 255) * ar; a += ar;
    }
    if (a > 0) for (let i = 0; i < 3; i++) r.meanDiff[i] += m[i] / a - ((wall >> (16 - i * 8)) & 255);
  }
  function gained(c, g) {
    if (g.lum) {
      const k = Math.max(0.25, Math.min(1.8, lum8(c) / g.lum)), w = g.wall;
      const r = Math.min(255, Math.round(((w >> 16) & 255) * k)), gg = Math.min(255, Math.round(((w >> 8) & 255) * k)), b = Math.min(255, Math.round((w & 255) * k));
      return (r << 16) | (gg << 8) | b;
    }
    const r = Math.min(255, Math.round(((c >> 16) & 255) * g[0])), gg = Math.min(255, Math.round(((c >> 8) & 255) * g[1])), b = Math.min(255, Math.round((c & 255) * g[2]));
    return (r << 16) | (gg << 8) | b;
  }

  // ---- write it ----------------------------------------------------------
  // an axis-aligned box in the part's frame, y metres above the lot; a face
  // whose front is inside the shell (or the ground) is never written
  /* BURIED FACES. A facade is relief laid on relief: a flute on a pier, a
     pier on a recessed field, a spandrel between two piers. A face whose
     front is inside another kit box of the same building can never be seen
     (its neighbour's volume is solid), so it is not written. One box must
     cover the whole face; a 2 m spatial hash finds the candidates. */
  const KH = 2;
  let KI = null;                  // the index of the part being written
  function kitIndex(list) {
    const G = new Map(), BIG = [];
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      const ix0 = Math.floor(b[0] / KH), ix1 = Math.floor(b[1] / KH), iy0 = Math.floor(b[2] / KH), iy1 = Math.floor(b[3] / KH);
      const iz0 = Math.floor(b[4] / KH), iz1 = Math.floor(b[5] / KH);
      if ((ix1 - ix0 + 1) * (iy1 - iy0 + 1) * (iz1 - iz0 + 1) > 300) { BIG.push(i); continue; }
      for (let ix = ix0; ix <= ix1; ix++) for (let iy = iy0; iy <= iy1; iy++) for (let iz = iz0; iz <= iz1; iz++) {
        const k = (ix * 73856093) ^ (iy * 19349663) ^ (iz * 83492791);
        let l = G.get(k); if (!l) G.set(k, l = []); l.push(i);
      }
    }
    return { B: list, G: G, BIG: BIG };
  }
  // face of box `self` on axis ax (0 x, 1 y, 2 z) at plane p, facing sg,
  // spanning [a0,a1] x [b0,b1] on the other two axes (in x,y,z order)
  function buried(self, ax, sg, p, a0, a1, b0, b1) {
    if (!KI) return false;
    const KB = KI.B, KBIG = KI.BIG;
    const e = 0.003, q = p + sg * 0.01;
    const px = ax === 0 ? q : (a0 + a1) / 2, py = ax === 1 ? q : ax === 0 ? (a0 + a1) / 2 : (b0 + b1) / 2, pz = ax === 2 ? q : (b0 + b1) / 2;
    const k = (Math.floor(px / KH) * 73856093) ^ (Math.floor(py / KH) * 19349663) ^ (Math.floor(pz / KH) * 83492791);
    const l = KI.G.get(k);
    const test = function (i) {
      if (i === self) return false;
      const B = KB[i];
      const lo = B[ax * 2], hi = B[ax * 2 + 1];
      if (sg > 0 ? (lo > p + e || hi < p + 0.008) : (hi < p - e || lo > p - 0.008)) return false;
      const ua = ax === 0 ? 2 : 0, va = ax === 2 ? 2 : 4;          // the face's two in-plane axes
      return B[ua] <= a0 + e && B[ua + 1] >= a1 - e && B[va] <= b0 + e && B[va + 1] >= b1 - e;
    };
    if (l) for (let j = 0; j < l.length; j++) if (test(l[j])) return true;
    for (let j = 0; j < KBIG.length; j++) if (test(KBIG[j])) return true;
    return false;
  }
  // flat >= 0: relief too shallow to see its sides at this level: only the
  // face on kit side `flat` is written. `self` = its index in the buried
  // index (-1: not indexed)
  function kitBox(pt, x0, x1, y0, y1, z0, z1, flat, self) {
    const Y0 = GY + y0, Y1 = GY + y1;
    const I = self >= 0;
    if (flat >= 0) {
      if (flat === 1) { if (!(I && buried(self, 2, 1, z1, x0, x1, y0, y1))) quad(x0, Y0, z1, x1, Y0, z1, x1, Y1, z1, x0, Y1, z1, 0, 0, 1, x0, y0, x1, y1); }
      else if (flat === 0) { if (!(I && buried(self, 2, -1, z0, x0, x1, y0, y1))) quad(x1, Y0, z0, x0, Y0, z0, x0, Y1, z0, x1, Y1, z0, 0, 0, -1, x1, y0, x0, y1); }
      else if (flat === 3) { if (!(I && buried(self, 0, 1, x1, y0, y1, z0, z1))) quad(x1, Y0, z1, x1, Y0, z0, x1, Y1, z0, x1, Y1, z1, 1, 0, 0, z1, y0, z0, y1); }
      else if (!(I && buried(self, 0, -1, x0, y0, y1, z0, z1))) quad(x0, Y0, z0, x0, Y0, z1, x0, Y1, z1, x0, Y1, z0, -1, 0, 0, z0, y0, z1, y1);
      return;
    }
    const hw = pt.w / 2, hd = pt.d / 2, e = 0.005, yb = pt.base, yt = pt.wallTop;
    const inX = x0 >= -hw - e && x1 <= hw + e, inZ = z0 >= -hd - e && z1 <= hd + e, inY = y0 >= yb - e && y1 <= yt + e;
    if (!(inX && inY && z1 >= -hd - e && z1 < hd - e) && !(I && buried(self, 2, 1, z1, x0, x1, y0, y1)))
      quad(x0, Y0, z1, x1, Y0, z1, x1, Y1, z1, x0, Y1, z1, 0, 0, 1, x0, y0, x1, y1);
    if (!(inX && inY && z0 > -hd + e && z0 <= hd + e) && !(I && buried(self, 2, -1, z0, x0, x1, y0, y1)))
      quad(x1, Y0, z0, x0, Y0, z0, x0, Y1, z0, x1, Y1, z0, 0, 0, -1, x1, y0, x0, y1);
    if (!(inZ && inY && x1 >= -hw - e && x1 < hw - e) && !(I && buried(self, 0, 1, x1, y0, y1, z0, z1)))
      quad(x1, Y0, z1, x1, Y0, z0, x1, Y1, z0, x1, Y1, z1, 1, 0, 0, z1, y0, z0, y1);
    if (!(inZ && inY && x0 > -hw + e && x0 <= hw + e) && !(I && buried(self, 0, -1, x0, y0, y1, z0, z1)))
      quad(x0, Y0, z0, x0, Y0, z1, x0, Y1, z1, x0, Y1, z0, -1, 0, 0, z0, y0, z1, y1);
    if (!(inX && inZ && y1 < yt - e && y1 > yb) && !(I && buried(self, 1, 1, y1, x0, x1, z0, z1)))
      quad(x0, Y1, z0, x1, Y1, z0, x1, Y1, z1, x0, Y1, z1, 0, 1, 0, x0, y1, x1, y1);
    if (!(y0 <= 0.05 || (inX && inZ && y0 > yb + e && y0 <= yt)) && !(I && buried(self, 1, -1, y0, x0, x1, z0, z1)))
      quad(x0, Y0, z1, x1, Y0, z1, x1, Y0, z0, x0, Y0, z0, 0, -1, 0, x0, y0, x1, y0);
  }
  function kitBrush(hex, seed, fh, mode) {
    hexC(hex); bMode = mode || M_KIT; bFl = 0; bFh = q10(fh); bBay = 10; bTop = 0; bBays = 0; bDoor = 255; bSeed = seed; bVar = 0;
  }
  // the storefront a shop's painted ground storey gets in 3D: a stall
  // riser, a post on every painted bay line, the head beam and a ledge
  // over the fascia. Wall colours, so it reads as the building's own frame.
  function kitStorefront(pt, seed, wall) {
    const hw = pt.w / 2, hd = pt.d / 2, fh = pt.fh;
    const gTop = Math.min(3.3, fh - 0.75), fTop = Math.min(gTop + 1.7, fh - 0.12);
    const post = shade(wall, 0.72), trim = shade(wall, 1.1);
    for (let s = 0; s < 4; s++) {
      if (!(pt.shops & (1 << s))) continue;
      const horiz = s < 2, out = (s === 0 || s === 2) ? -1 : 1, half = horiz ? hd : hw, span = horiz ? pt.w : pt.d;
      const n = pt.grid[s] || 1, step = span / n;
      const put = function (t0, t1, y0, y1, p0, p1) {
        const n0 = out > 0 ? half + p0 : -half - p1, n1 = out > 0 ? half + p1 : -half - p0;
        if (horiz) kitBox(pt, t0, t1, y0, y1, n0, n1, -1, -1); else kitBox(pt, n0, n1, y0, y1, t0, t1, -1, -1);
      };
      kitBrush(post, seed, fh);
      put(-span / 2 + 0.7, span / 2 - 0.7, 0, 0.35, 0, 0.1);                   // stall riser
      for (let i = 1; i < n; i++) {
        const t = -span / 2 + i * step;
        if (Math.abs(t) > span / 2 - 0.9) continue;
        put(t - 0.09, t + 0.09, 0.35, gTop, 0, 0.12);                          // mullion post
      }
      put(-span / 2 + 0.7, span / 2 - 0.7, gTop, gTop + 0.18, 0, 0.16);         // head beam
      kitBrush(trim, seed, fh);
      put(-span / 2 + 0.5, span / 2 - 0.5, fTop, fTop + 0.14, 0, 0.3);         // ledge over the fascia
    }
  }
  /* ONE building, as a resumable state: every part run through its
     grammar and kept (one part per step), the palette fitted to the wall,
     then the boxes written a chunk at a time. kitStep returns true when the
     building is done; it stops as soon as `end` passes, so a 40-storey deco
     tower never lands in one frame. Only this job owns the writer while it
     is unfinished (job()/runJob's lock), so the frame, the brush and the
     buried-face index are simply restored on resume. */
  let KIT_ANCHOR = null;
  function kitBegin(P, b, mask, lod) {
    const parts = kitParts(P, b, mask);
    if (!parts) return null;
    const A = KIT_ANCHOR;
    for (const pt of parts) {
      pt.wall = b.wall;
      if (A) pt.anchor = { y: A.y - GY, slack: A.slack };
    }
    return { b: b, parts: parts, lod: lod, seed: seedOf(b), pi: 0, ph: 0, g: null, wi: 0, wb: 0, idx: null };
  }
  const KIT_CHUNK = 48;
  function kitStep(S, end, J) {
    const parts = S.parts;
    // run, then keep, each part: each its own step
    while (S.pi < parts.length) {
      const pt = parts[S.pi];
      if (S.ph === 0) { kitRun(pt, S.b); S.ph = 1; }
      else { kitKeep(pt, S.lod); pt.boxes = pt.rounds = null; S.ph = 0; S.pi++; }
      if (now() >= end) return false;
    }
    if (!S.g) { S.g = kitGain(parts, S.b.wall); kitColourNote(parts[0].style, parts, S.g, S.b.wall); }
    const g = S.g, seed = S.seed;
    while (S.wi < parts.length) {
      const pt = parts[S.wi], K = pt.kept;
      frame(pt.x, pt.z, pt.rot);
      if (!S.idx) {
        S.idx = kitIndex(K);
        if (K.length > KIT_CHUNK && now() >= end) { frame(0, 0, 0); return false; }
      }
      KI = S.idx;
      let last = -1;
      while (S.wb < K.length) {
        const stop = Math.min(K.length, S.wb + KIT_CHUNK);
        for (let i = S.wb; i < stop; i++) {
          const bx = K[i];
          if (bx[6] !== last) { last = bx[6]; kitBrush(gained(last, g), seed, pt.fh); }
          kitBox(pt, bx[0], bx[1], bx[2], bx[3], bx[4], bx[5], bx[7], i);
        }
        S.wb = stop;
        if (nv > KIT_FLUSH_V && J) kitFlush(J);
        if (S.wb < K.length && now() >= end) { KI = null; frame(0, 0, 0); return false; }
      }
      KI = null;
      for (const r of pt.keptR) {
        kitBrush(gained(r.col, g), seed, pt.fh, r.k === 4 ? M_LAMP : M_KIT);
        if (r.k === 1) cylinder(r.x, r.z, r.r, GY + r.y, GY + r.y + r.h, 8);
        else if (r.k === 2) pyramid(r.x, r.z, r.r, 0.02, GY + r.y, GY + r.y + r.h);
        else if (r.k === 3) dome(r.x, r.z, r.r, GY + r.y, r.r, 8);
        else if (r.k === 0) dome(r.x, r.z, r.r, GY + r.y - r.r, r.r * 2, 6);
        else kitBox(pt, r.x - r.r, r.x + r.r, r.y - r.r, r.y + r.r, r.z - r.r, r.z + r.r, -1, -1);
      }
      if (pt.shops) kitStorefront(pt, seed, pt.wall);
      frame(0, 0, 0);
      pt.kept = pt.keptR = null;
      S.wi++; S.wb = 0; S.idx = null;
    }
    return true;
  }
  // the cells of a plan: every dressable building, by its centre
  function kitPrepare(P, masks, root) {
    const byKey = new Map();
    const B = P.bldgs;
    for (let i = 0; i < B.length; i++) {
      const b = B[i];
      if (!kitGrammar(P, vbOf(P, i))) continue;
      const ix = Math.floor(b.x / KIT_CELL), iz = Math.floor(b.z / KIT_CELL), key = ix + "," + iz;
      let c = byKey.get(key);
      if (!c) {
        c = { key: key, ix: ix, iz: iz, x0: ix * KIT_CELL, z0: iz * KIT_CELL, x1: (ix + 1) * KIT_CELL, z1: (iz + 1) * KIT_CELL,
          idx: [], masks: masks, root: root || null, meshes: null, chunks: 0, built: false, kit: true, name: P.id };
        byKey.set(key, c);
      }
      c.idx.push(i);
      // a building on a cell edge overhangs it: the streamer measures the
      // cell's real extent
      const r = Math.hypot(b.w, b.d) / 2 + KIT_REACH;
      c.x0 = Math.min(c.x0, b.x - r); c.x1 = Math.max(c.x1, b.x + r); c.z0 = Math.min(c.z0, b.z - r); c.z1 = Math.max(c.z1, b.z + r);
    }
    return Array.from(byKey.values()).sort(function (a, b) { return a.iz - b.iz || a.ix - b.ix; });
  }
  function kitMesh(cell, k) {
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material());
    mesh.name = "metro-facades:" + cell.name + ":" + cell.key + ":" + k;
    mesh.position.set(((cell.ix + 0.5) * KIT_CELL), 0, ((cell.iz + 0.5) * KIT_CELL));
    mesh.updateMatrix();
    mesh.matrixAutoUpdate = false;
    // relief that casts its own shadow is the point of it (a pier shading
    // the window beside it); metro.js lets only the near cells cast
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = true;
    mesh.raycast = noRaycast;                  // bullets and LOS hit the building colliders
    mesh.userData = { metroFacades: cell.key };
    mesh.visible = false;
    if (cell.root) cell.root.add(mesh);
    return mesh;
  }
  // a cell's meshes: shown / cast shadows (metro.js)
  function showKit(cell, on, shadow) {
    const ms = cell.meshes;
    if (!ms) return;
    for (let k = 0; k < ms.length; k++) {
      const v = on && k < (cell.chunks | 0);
      if (ms[k].visible !== v) ms[k].visible = v;
      if (ms[k].castShadow !== !!shadow) ms[k].castShadow = !!shadow;
    }
  }
  function disposeKit(P, cell) {
    if (!cell) return;
    if (JOB && JOB.tile === cell) { JOB = null; COLS = null; REF = null; KI = null; nv = 0; ni = 0; }
    for (const m of cell.meshes || []) {
      const old = m.geometry;
      m.geometry = new THREE.BufferGeometry();
      if (old) old.dispose();
      m.visible = false;
    }
    cell.built = false; cell.chunks = 0;
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
    // the facade cells (no geometry, no mesh until one streams in)
    let kit = [];
    try { kit = kitPrepare(P, masks, opts.root); } catch (e) { if (typeof console !== "undefined") console.warn("[metro_fabric] facade cells", e); }
    return { tiles: tiles, material: m, kit: kit };
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
  // far: false = the near tile, true = the far HLOD, "kit" = a facade cell
  function job(P, tile, far) {
    if (JOB) runJob(JOB, Infinity);            // a sync caller cut in: finish the one in flight first
    const kit = far === "kit";
    const J = { P: P, tile: tile, far: far === true, kit: kit, lod: kit ? (tile.lod | 0) : 0, anchor: kit ? tile.anchor || null : null,
      chunks: kit ? [] : null, vbase: 0, k: 0, st: 0, ms: 0, done: false, result: null, marks: null };
    JOB = J;
    nv = 0; ni = 0;
    if (kit) { oX = (tile.ix + 0.5) * KIT_CELL; oZ = (tile.iz + 0.5) * KIT_CELL; }
    else { oX = (tile.x0 + tile.x1) / 2; oZ = (tile.z0 + tile.z1) / 2; }
    COLS = []; REF = kit ? null : far ? tile.far : tile.mesh;
    return J;
  }
  // run up to `budget` ms of a job; returns the job's result when it finishes
  function runJob(J, budget) {
    if (J.done) return J.result;
    if (JOB !== J) throw new Error("metro_fabric: job run out of order");
    const t0 = now(), end = t0 + (budget > 0 ? budget : 0);
    const P = J.P, tile = J.tile, B = P.bldgs, masks = tile.masks || streetMasks(P);
    const stations = J.kit ? [] : tile.stations;
    FAR = J.far;
    try {
      if (J.kit) {
        // a facade cell: one building at a time, resumable inside it
        KIT_ANCHOR = J.anchor;
        while (J.kb || J.k < tile.idx.length) {
          if (!J.kb) {
            const i = tile.idx[J.k++];
            try { J.kb = kitBegin(P, vbOf(P, i), masks[i], J.lod); } catch (e) { J.kb = null; if (typeof console !== "undefined") console.warn("[metro_fabric] facade", B[i] && B[i].id, e); }
            if (!J.kb) continue;
            J.kb.i = i; J.kb.v0 = J.vbase + nv;
          }
          let done = true;
          try { done = kitStep(J.kb, end, J); } catch (e) { done = true; KI = null; if (typeof console !== "undefined") console.warn("[metro_fabric] facade", J.kb.b && J.kb.b.id, e); }
          frame(0, 0, 0);
          if (done) { if (J.marks) J.marks.push(J.kb.i, J.kb.v0, J.vbase + nv); J.kb = null; }
          if (nv > KIT_FLUSH_V) kitFlush(J);
          if (now() >= end) break;
        }
        KIT_ANCHOR = null;
      } else while (J.k < tile.idx.length) {
        const i = tile.idx[J.k++];
        const v0 = nv;
        const vb = vbOf(P, i);
        BVAR = vb.v ? vb.v.vbits | 0 : 0;
        try { emit(P, vb, masks[i]); }
        catch (e) { if (typeof console !== "undefined") console.warn("[metro_fabric] building", B[i] && B[i].id, e); }
        BVAR = 0;
        frame(0, 0, 0);
        if (J.marks) J.marks.push(i, v0, nv);
        if (now() >= end) break;
      }
      if (J.k >= tile.idx.length) while (J.st < stations.length) { station(P, P.stations[stations[J.st++]]); frame(0, 0, 0); }
    } finally { FAR = false; }
    J.ms += now() - t0;
    if (J.k < tile.idx.length || J.kb || J.st < stations.length) return null;
    J.done = true;
    J.result = finish(J);
    JOB = null;
    return J.result;
  }
  function freeArray() { this.array = null; }
  // the writer's arrays so far, as a geometry with its own bounds
  function writtenGeometry(sphere, free) {
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
    } else if (sphere) g.boundingSphere = sphere.clone();
    // THE FAR TILE KEEPS NO CPU COPY. Once its arrays are on the GPU they
    // are dropped (it is never raycast, never rebuilt in place, never read
    // back), so the whole distant city costs video memory only.
    // (a facade cell likewise: never raycast, never read back)
    if (free && FREE_FAR) {
      for (const a of attrs) a[1].onUpload(freeArray);
      g.index.onUpload(freeArray);
    }
    const bytes = nv * (12 + 4 + 4 + 4 + 4 + 8) + index.byteLength;
    return { g: g, bytes: bytes, vertices: nv, triangles: ni / 3 };
  }
  /* A FACADE CELL IS WRITTEN IN CHUNKS. Once the writer holds KIT_FLUSH_V
     vertices they become a finished geometry (16-bit index, ~2 MB) and the
     writer starts over, so no single frame copies or uploads a whole dense
     CBD cell. The chunks are handed to the cell's meshes together when the
     cell is done: the old level stays on screen until the new one is whole. */
  const KIT_FLUSH_V = 60000;
  function kitFlush(J) {
    if (!nv) return;
    const w = writtenGeometry(null, true);
    J.chunks.push(w);
    J.vbase += nv;
    nv = 0; ni = 0;
  }
  function finish(J) {
    const t0 = now(), tile = J.tile, far = J.far, kit = J.kit;
    if (kit) return finishKit(J, t0);
    const mesh = far ? tile.far : tile.mesh;
    // (the streamed/phone city drops a NEAR tile's JS copy after upload too:
    // it is never raycast either (its colliders are boxes, COLS), and metro
    // tiles a drive passed held ~50 MB of JS after it, memscope/abtrack)
    const w = writtenGeometry(tile.sphere, far || !!(CBZ.slice && CBZ.slice.stream)), g = w.g;
    const old = mesh.geometry;
    mesh.geometry = g;
    if (old && old !== g) old.dispose();
    if (far) tile.farBuilt = true; else tile.built = true;
    mesh.visible = false;                         // metro.js decides which of the pair is drawn
    const cols = COLS; COLS = null; REF = null;
    const out = { colliders: far ? [] : cols, empty: nv === 0,
      stats: { ms: J.ms + (now() - t0), vertices: nv, triangles: w.triangles, bytes: w.bytes, buildings: tile.idx.length, far: far, kit: false } };
    if (J.marks) out.marks = J.marks;
    return out;
  }
  function finishKit(J, t0) {
    const cell = J.tile;
    kitFlush(J);
    COLS = null; REF = null;
    let vertices = 0, triangles = 0, bytes = 0;
    const meshes = cell.meshes || (cell.meshes = []);
    for (let k = 0; k < J.chunks.length; k++) {
      const w = J.chunks[k];
      const m = meshes[k] || (meshes[k] = kitMesh(cell, k));
      const old = m.geometry;
      m.geometry = w.g;
      if (old && old !== w.g) old.dispose();
      m.visible = false;                          // metro.js shows the cell
      vertices += w.vertices; triangles += w.triangles; bytes += w.bytes;
    }
    // a cell that needs fewer chunks at this level: the rest go empty
    for (let k = J.chunks.length; k < meshes.length; k++) {
      const old = meshes[k].geometry;
      meshes[k].geometry = new THREE.BufferGeometry();
      if (old) old.dispose();
      meshes[k].visible = false;
    }
    cell.chunks = J.chunks.length;
    cell.built = true;
    cell.lodBuilt = J.lod;
    J.chunks = null;
    const out = { colliders: [], empty: triangles === 0,
      stats: { ms: J.ms + (now() - t0), vertices: vertices, triangles: triangles, bytes: bytes, buildings: cell.idx.length, far: false, kit: true, chunks: cell.chunks } };
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
    // facade cells: prepare() returns them as .kit; build one with
    // job(P, cell, "kit") + runJob, drop it with disposeKit
    // the fabric's view of every building of a plan (variants; the plan's own
    // object where the building is drawn as planned)
    variants: planVariants,
    disposeKit: disposeKit, showKit: showKit, kitGrammar: kitGrammar, kitParts: kitParts, kitStats: KSTAT, KIT_CELL: KIT_CELL, KIT_REACH: KIT_REACH, KIT_LOD_R: KIT_LOD_R,
    setFreeFar: function (on) { FREE_FAR = !!on; },
    _glsl: { pars: MF_PARS, main: MF_MAIN },
  };
  CBZ.metroFabric = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : globalThis);
