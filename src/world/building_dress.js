/* ============================================================
   world/building_dress.js — WHAT A CITY ROOF IS MADE OF, AND WHAT
   STANDS ON IT.

   2026-09-27 DE-SLOP rewrite. Seen from any window above the third floor
   (the exec office spawn looks straight down on a block of them) every
   low and mid-rise roof in the city was one flat bright slab: a single
   grey colour at full albedo, a grey band of parapet, and nothing on it
   except a thin rail floating 1.5 m in from the edge. The previous
   version of this file was a scatter pass (hashed lattices of HVAC,
   dishes, aerials, window AC) that the owner rightly killed as junk, and
   it sat dead behind DETAIL_WORLD_V1. It is gone. What replaces it:

   1. THE ROOF DECK (CBZ.roofDeckMaterial). A granulated modified-bitumen
      cap sheet: 1 m rolls with torched side laps and staggered end laps and
      mineral granule speckle (world/textures_surface.js "roofing", baked
      once), projected in WORLD METRES so every roof carries the sheet at
      real scale. On top of that, in-shader: repair patches, dirt
      banked against the parapet, ponding stains with tide marks where
      water sits after rain, and a per-building membrane family (grey cap
      sheet, sun-faded light grey, tan granules, a newer dark re-roof). It
      is the roof slab's OWN material (city/buildings.js passes it to the
      slab lbox), so it costs no extra geometry, and it is a Standard
      material so the low sun rakes across the laps like it does on the
      promoted walls around it.

   2. ROOF PLANT, PLACED LIKE A BUILDING SERVICES ENGINEER WOULD. Not a
      lattice. One pass per roof, AFTER elevators.js / roofloot.js /
      the helipad have claimed their ground, so nothing lands on a lift
      headhouse, a stash, a fire-escape bridge, a helipad, a roof billboard
      or the spawn point at the slab centre. Every roof gets what that
      building actually needs:
        · roof drains (cast-iron dome strainers in a lead sump) - every roof
        · plumbing vent stacks through flashing boots, clustered over the
          wet stack - every roof
        · packaged rooftop units (curb, louvred condenser coil, top fan
          with guard, service panels, rain hood, disconnect, a yellow gas
          line on a pipe stand) - sized by roof area, 0 to 3
        · an upblast exhaust fan on a curb (kitchens, toilets) - most
        · domed skylights in a row down the long axis - some low-rises
        · a roof hatch where there is no stair to the roof
        · a timber water tank on a braced steel stand - rare, 3-6 storeys
      All of it is instanced per prototype (the big pieces in 400 m cells,
      frustum- and fog-culled per cell; the small ones one pool each), the big
      pieces carry y-gated colliders pushed into b.colliders (so demolition
      splices them with the building), and a building that collapses takes
      its plant with it (the batchHideGroup / batchShowGroup wrap below,
      the same seam city/localinst.js uses).

   3. The PRISON FACADE PASS (unchanged, bottom of file).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const DK = CBZ.detailKit || null;          // DK.proto: many parts -> one vertex-coloured geometry

  // =====================================================================
  //  1. THE ROOF DECK MATERIAL
  // =====================================================================
  const DECK_TILE = 6.0;                      // metres per "roofing" tile (textures_surface.js)
  let _deck = null;
  CBZ.roofDeckMaterial = function () {
    if (_deck) return _deck;
    const q = CBZ.qualityLevel == null ? 2 : CBZ.qualityLevel;
    let maps = null;
    try { maps = CBZ.surfaceMaps ? CBZ.surfaceMaps("roofing", { repeat: 1, res: q <= 1 ? 256 : 512 }) : null; } catch (e) { maps = null; }
    const m = new THREE.MeshStandardMaterial({
      // with the baked sheet the colour lives in the map; without it (tier 0,
      // textures off) a mid grey membrane, never the old near-white slab
      color: maps ? 0xffffff : 0x6f6c66,
      vertexColors: true,                     // the slab's fake-AO shading (buildings.js shadeGeo)
      roughness: 0.93, metalness: 0.0,
      envMapIntensity: 0.5,
    });
    if (maps) {
      m.map = maps.map;
      m.normalMap = maps.normalMap;
      m.normalScale.set(0.9, 0.9);
      m.roughnessMap = maps.roughnessMap;
    }
    m._shared = true;
    m.onBeforeCompile = function (sh) {
      const v = sh.vertexShader, f = sh.fragmentShader;
      if (v.indexOf("#include <project_vertex>") < 0 || f.indexOf("#include <map_fragment>") < 0
        || f.indexOf("#include <roughnessmap_fragment>") < 0) return;
      sh.vertexShader = v
        .replace("#include <common>",
          "#include <common>\nvarying vec4 rdLH;\nvarying vec4 rdTK;\nvarying float rdUpV;")
        .replace("#include <project_vertex>",
          "#include <project_vertex>\n" +
          "  {\n" +
          "    vec3 rdW = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;\n" +
          "    vec3 rdN = normalize( mat3( modelMatrix ) * normal );\n" +
          "    rdUpV = step( 0.5, rdN.y );\n" +
          // the slab is a scaled unit box: local position x scale = metres
          // from the slab centre, and half the scale is the half-extent
          "    vec2 rdS = vec2( length( modelMatrix[0].xyz ), length( modelMatrix[2].xyz ) );\n" +
          "    rdLH = vec4( position.xz * rdS, 0.5 * rdS );\n" +
          // ONE value per roof (its centre), so the membrane family is a
          // property of the building, not a noise field across it
          "    float rdK = fract( sin( dot( floor( modelMatrix[3].xz * 0.5 ), vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );\n" +
          "    vec3 rdTint = rdK < 0.46 ? vec3( 1.0 )\n" +
          "           : ( rdK < 0.70 ? vec3( 1.20, 1.19, 1.16 )\n" +          // sun-faded light grey cap sheet
          "           : ( rdK < 0.86 ? vec3( 1.13, 1.03, 0.86 )\n" +          // tan granules
          "           :                vec3( 0.74, 0.74, 0.76 ) ) );\n" +     // a newer dark re-roof
          "    rdTK = vec4( rdTint, rdK );\n" +
          "  #ifdef USE_UV\n" +
          "    vec3 rdA = abs( rdN );\n" +
          "    vUv = ( rdA.y > 0.5 ? rdW.xz : ( rdA.x > rdA.z ? rdW.zy : rdW.xy ) ) * " + (1 / DECK_TILE).toFixed(6) + ";\n" +
          "  #endif\n" +
          "  }");
      sh.fragmentShader = f
        .replace("#include <common>",
          "#include <common>\nvarying vec4 rdLH;\nvarying vec4 rdTK;\nvarying float rdUpV;\n" +
          "float rdHash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453123 ); }\n" +
          "float rdNoise( vec2 p ) {\n" +
          "  vec2 i = floor( p ), u = fract( p ); u = u * u * ( 3.0 - 2.0 * u );\n" +
          "  return mix( mix( rdHash( i ), rdHash( i + vec2( 1.0, 0.0 ) ), u.x ),\n" +
          "              mix( rdHash( i + vec2( 0.0, 1.0 ) ), rdHash( i + vec2( 1.0, 1.0 ) ), u.x ), u.y );\n" +
          "}\n" +
          "float rdPond = 0.0;")
        .replace("#include <map_fragment>",
          "#include <map_fragment>\n" +
          "  {\n" +
          "    float rdUp = step( 0.5, rdUpV );\n" +
          "    vec2 rdL = rdLH.xy, rdH = rdLH.zw;\n" +
          "    vec3 rdTint = rdTK.rgb; float rdK = rdTK.w;\n" +
          // local coords + a per-roof offset keep the noise inputs small
          // (a sin-hash on raw world metres bands on mediump GPUs)
          "    vec2 rdP = rdL + vec2( rdK * 71.0, rdK * 37.0 );\n" +
          // DIRT BANKED AGAINST THE PARAPET: wind drops grit where the air
          // stalls, water drains to the edges, so the last 0.8 m is darker
          "    vec2 rdE = rdH - abs( rdL );\n" +
          "    float rdEd = min( rdE.x, rdE.y );\n" +
          "    float rdEdge = mix( 0.66, 1.0, smoothstep( 0.02, 0.85, rdEd ) );\n" +
          "    rdEdge *= mix( 0.82, 1.0, smoothstep( 0.4, 1.9, max( rdE.x, rdE.y ) ) );\n" +   // corners hold the most
          // PONDING: flat roofs are never flat; the low spots hold water,
          // leave a darker silt stain and a crisp tide mark at its rim
          "    float rdN1 = rdNoise( rdP * 0.21 ) * 0.62 + rdNoise( rdP * 0.57 + 11.0 ) * 0.38;\n" +
          "    rdPond = smoothstep( 0.60, 0.74, rdN1 );\n" +
          "    float rdRing = smoothstep( 0.57, 0.60, rdN1 ) - smoothstep( 0.60, 0.635, rdN1 );\n" +
          "    float rdDirt = rdNoise( rdP * 1.7 ) * 0.10 + rdNoise( rdP * 0.09 ) * 0.10;\n" +
          // REPAIR PATCHES: a torched-on square of newer, darker cap sheet
          // with a black bitumen bead, in about one 4.5 m cell in five
          "    vec2 rdC = floor( rdP / 4.5 );\n" +
          "    float rdPatch = 1.0;\n" +
          "    if ( rdHash( rdC + 3.7 ) < 0.22 ) {\n" +
          "      vec2 rdSz = vec2( 0.35 + rdHash( rdC + 2.2 ) * 0.5, 0.25 + rdHash( rdC + 5.9 ) * 0.4 );\n" +
          "      vec2 rdQ = abs( rdP - ( rdC * 4.5 + 0.9 + vec2( rdHash( rdC + 1.3 ), rdHash( rdC + 8.1 ) ) * 2.7 ) );\n" +
          "      float rdM = min( rdSz.x - rdQ.x, rdSz.y - rdQ.y );\n" +
          "      rdPatch = rdM < 0.0 ? 1.0 : ( rdM < 0.016 ? 0.42 : 0.80 );\n" +
          "    }\n" +
          "    vec3 rdMul = rdTint * rdEdge * rdPatch * mix( 1.0, 0.80, rdPond ) * ( 1.0 - rdRing * 0.12 ) * ( 0.92 + rdDirt );\n" +
          "    diffuseColor.rgb *= mix( rdTint, rdMul, rdUp );\n" +
          "    rdPond *= rdUp;\n" +
          "  }")
        .replace("#include <roughnessmap_fragment>",
          "#include <roughnessmap_fragment>\n  roughnessFactor *= mix( 1.0, 0.72, rdPond );");
    };
    m.customProgramCacheKey = function () { return "cbzRoofDeck1" + (maps ? "m" : "p"); };
    if (CBZ.gfxRegisterPbr) { try { CBZ.gfxRegisterPbr(m); } catch (e) { /* env optional */ } }
    _deck = m;
    return m;
  };

  // =====================================================================
  //  2. ROOF PLANT PROTOTYPES (local frame: y = 0 on the membrane, +x long)
  // =====================================================================
  const CAB = 0xc6c3b8, CAB_D = 0xaeaba1, COIL = 0x4f5254, LOUV = 0x9b988f, GRILLE = 0x26292c;
  const GALV = 0x8f9498, FLASH = 0x4a4843, GAS = 0xcfa52a, CONDUIT = 0x7b7f83;
  const ALU = 0xb3b7b9, ALU_D = 0x8e9294, IRON = 0x232426, STEEL = 0x4d5054, STEEL_D = 0x3b3d40;

  function torus(p, r, tube, color, x, y, z, seg) {
    p.add(new THREE.TorusGeometry(r, tube, 3, seg || 16), color, x, y, z, Math.PI / 2, 0, 0);
  }

  // a 5-ton packaged rooftop unit: 2.3 x 1.2 cabinet on a 0.34 m curb
  function rtuProto() {
    const p = DK.proto();
    p.box(2.24, 0.1, 1.16, FLASH, 0, 0.05, 0);                    // membrane turned up the curb
    p.box(2.14, 0.34, 1.06, GALV, 0, 0.17, 0);                    // roof curb
    p.box(2.3, 1.05, 1.2, CAB, 0, 0.865, 0);                      // cabinet
    p.box(2.34, 0.04, 1.24, CAB_D, 0, 1.41, 0);                   // top panel lip
    // CONDENSER SECTION (x 0.2..1.15): coil behind louvres on three sides
    for (const s of [-1, 1]) p.box(0.9, 0.78, 0.012, COIL, 0.67, 0.86, s * 0.606);
    p.box(0.012, 0.78, 1.0, COIL, 1.156, 0.86, 0);
    for (let i = 0; i < 5; i++) {
      const y = 0.54 + i * 0.15;
      for (const s of [-1, 1]) p.box(0.9, 0.022, 0.035, LOUV, 0.67, y, s * 0.62, s * 0.5, 0, 0);
      p.box(0.035, 0.022, 1.0, LOUV, 1.17, y, 0, 0, 0, -0.5);
    }
    // condenser fan in the top panel: shroud, dark grille, hub, finger guard
    p.cyl(0.40, 0.40, 0.1, 14, CAB_D, 0.67, 1.46, 0);
    p.cyl(0.37, 0.37, 0.012, 14, GRILLE, 0.67, 1.514, 0);
    p.cyl(0.07, 0.07, 0.03, 10, 0x3a3d40, 0.67, 1.53, 0);
    for (const a of [Math.PI / 4, -Math.PI / 4]) p.box(0.74, 0.014, 0.022, 0x6d7074, 0.67, 1.53, 0, 0, a, 0);
    torus(p, 0.25, 0.009, 0x6d7074, 0.67, 1.53, 0, 14);
    // SUPPLY/RETURN SECTION (x -1.15..0.2): screwed service panels + handles
    for (const s of [-1, 1]) {
      for (const x of [-0.5, 0.2]) p.box(0.016, 0.92, 0.008, CAB_D, x, 0.86, s * 0.604);
      p.box(0.12, 0.03, 0.02, 0x55585b, -0.85, 0.9, s * 0.61);
    }
    // outside-air intake under a sloped rain hood on the -x end
    p.box(0.012, 0.36, 0.86, COIL, -1.156, 0.98, 0);
    p.box(0.34, 0.03, 0.96, CAB_D, -1.29, 1.2, 0, 0, 0, 0.62);
    for (const s of [-1, 1]) p.box(0.3, 0.3, 0.02, CAB_D, -1.27, 1.03, s * 0.47);
    // fused disconnect on the +z face with its conduit down to the deck
    p.box(0.26, 0.34, 0.12, 0x8a8e91, -0.95, 0.72, 0.66);
    p.cyl(0.022, 0.022, 0.56, 6, CONDUIT, -0.95, 0.3, 0.68);            // down to the deck
    // yellow GAS LINE: out of the -z face, down, along a pipe stand, into a boot
    p.cyl(0.024, 0.024, 0.36, 6, GAS, -0.5, 0.7, -0.78, Math.PI / 2, 0, 0);
    p.cyl(0.024, 0.024, 0.52, 6, GAS, -0.5, 0.45, -0.96);
    p.cyl(0.024, 0.024, 1.12, 6, GAS, -1.06, 0.2, -0.96, 0, 0, Math.PI / 2);
    p.box(0.1, 0.176, 0.2, 0x2b2b2b, -1.2, 0.088, -0.96);           // rubber pipe block
    p.cyl(0.024, 0.024, 0.2, 6, GAS, -1.62, 0.1, -0.96);
    p.cyl(0.05, 0.08, 0.1, 8, FLASH, -1.62, 0.05, -0.96);          // penetration boot
    return p.done();
  }
  // upblast exhaust fan (kitchen / toilet extract) on its own curb
  function fanProto() {
    const p = DK.proto();
    p.box(0.72, 0.08, 0.72, FLASH, 0, 0.04, 0);
    p.box(0.62, 0.3, 0.62, GALV, 0, 0.15, 0);
    p.box(0.7, 0.03, 0.7, ALU_D, 0, 0.315, 0);                      // curb cap
    p.cyl(0.27, 0.31, 0.14, 16, ALU, 0, 0.4, 0);                   // windband
    p.cyl(0.2, 0.2, 0.2, 16, ALU, 0, 0.57, 0);                     // motor housing
    p.cyl(0.46, 0.46, 0.03, 18, ALU_D, 0, 0.66, 0);                // hood rim
    p.cyl(0.12, 0.46, 0.2, 18, ALU, 0, 0.77, 0);                   // spun hood
    p.cyl(0.09, 0.12, 0.05, 12, ALU_D, 0, 0.895, 0);               // cap
    return p.done();
  }
  // one plumbing vent stack through a flashing boot (instanced in clusters)
  function ventProto() {
    const p = DK.proto();
    p.cyl(0.075, 0.14, 0.12, 10, FLASH, 0, 0.06, 0);
    p.cyl(0.055, 0.055, 0.5, 10, IRON, 0, 0.3, 0);
    p.cyl(0.062, 0.062, 0.03, 10, 0x3a3b3d, 0, 0.54, 0);          // hub at the cut end
    return p.done();
  }
  // cast-iron roof drain: lead sump sheet + domed strainer
  function drainProto() {
    const p = DK.proto();
    p.box(0.72, 0.018, 0.72, 0x3b3a37, 0, 0.009, 0);
    p.cyl(0.24, 0.26, 0.02, 14, 0x2a2a29, 0, 0.022, 0);            // clamping ring
    p.cyl(0.05, 0.17, 0.1, 12, 0x1d1e1f, 0, 0.08, 0);              // dome strainer
    for (let i = 0; i < 4; i++) p.box(0.3, 0.012, 0.018, 0x333436, 0, 0.1, 0, 0, i * Math.PI / 4, 0);
    return p.done();
  }
  // curb-mounted domed skylight
  function skylightProto() {
    const p = DK.proto();
    p.box(1.2, 0.08, 1.2, FLASH, 0, 0.04, 0);
    p.box(1.1, 0.3, 1.1, GALV, 0, 0.15, 0);
    p.box(1.18, 0.05, 1.18, 0xd3d6d6, 0, 0.325, 0);                // extruded frame
    const dome = new THREE.SphereGeometry(0.54, 16, 5, 0, Math.PI * 2, 0, Math.PI / 2);
    dome.scale(1, 0.4, 1);
    p.add(dome, 0x9aaeb6, 0, 0.35, 0);
    return p.done();
  }
  // roof access hatch (buildings with no stair to the roof)
  function hatchProto() {
    const p = DK.proto();
    p.box(1.0, 0.08, 1.1, FLASH, 0, 0.04, 0);
    p.box(0.9, 0.36, 1.0, GALV, 0, 0.18, 0);
    p.box(1.0, 0.07, 1.1, 0x7e8387, 0, 0.395, 0);                  // lid
    for (const s of [-1, 1]) p.box(0.12, 0.06, 0.05, STEEL_D, s * 0.3, 0.35, -0.57);   // hinges
    p.box(0.18, 0.04, 0.04, STEEL_D, 0, 0.44, 0.5);                // pull handle
    return p.done();
  }
  // the timber water tank on a braced steel stand
  function tankProto() {
    const p = DK.proto();
    for (const s of [-1, 1]) p.box(3.0, 0.24, 0.22, STEEL, 0, 0.12, s * 0.9);   // dunnage beams on pads
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) p.box(0.16, 2.0, 0.16, STEEL, sx * 0.9, 1.24, sz * 0.9);
    // X-bracing on all four faces
    const L = Math.hypot(1.8, 1.8), ang = Math.atan2(1.8, 1.8);
    for (const s of [-1, 1]) {
      for (const a of [ang, -ang]) {
        p.box(L, 0.035, 0.035, STEEL_D, 0, 1.24, s * 0.9, 0, 0, a);
        p.box(0.035, 0.035, L, STEEL_D, s * 0.9, 1.24, 0, a, 0, 0);
      }
    }
    p.box(2.5, 0.12, 2.5, STEEL_D, 0, 2.3, 0);                     // deck
    // staves: twenty real boards, three tones of weathered cedar
    const R = 1.2, N = 20, SW = 2 * Math.PI * R / N + 0.01;
    const WOOD = [0x7b6650, 0x6e5a46, 0x846d56];
    for (let i = 0; i < N; i++) {
      const a = (i + 0.5) / N * Math.PI * 2;
      p.box(SW, 2.62, 0.07, WOOD[i % 3], Math.cos(a) * R, 3.67, Math.sin(a) * R, 0, -a + Math.PI / 2, 0);
    }
    for (const y of [2.62, 3.2, 3.85, 4.55]) torus(p, R + 0.05, 0.028, 0x3e3a36, 0, y, 0, 24);   // steel hoops, tighter low down
    p.cone(1.34, 0.82, 20, 0x4b4038, 0, 5.39, 0);                  // conical roof
    p.cyl(0.05, 0.08, 0.22, 6, STEEL_D, 0, 5.89, 0);               // vent finial
    // ladder up the leg, then up the barrel to the roof hatch
    for (const s of [-1, 1]) {
      p.box(0.04, 2.12, 0.04, STEEL, 1.08, 1.3, s * 0.2);
      p.box(0.04, 2.72, 0.04, STEEL, 1.3, 3.7, s * 0.2);
    }
    for (let y = 0.5; y < 2.3; y += 0.3) p.box(0.03, 0.03, 0.4, STEEL, 1.08, y, 0);
    for (let y = 2.6; y < 5.0; y += 0.3) p.box(0.03, 0.03, 0.4, STEEL, 1.3, y, 0);
    p.cyl(0.08, 0.08, 2.1, 8, STEEL_D, 0.35, 1.2, -0.35);          // outlet down to the roof
    p.cyl(0.12, 0.16, 0.1, 8, FLASH, 0.35, 0.05, -0.35);
    return p.done();
  }

  // =====================================================================
  //  INSTANCE POOLS. The engine is draw-call bound, so: the big pieces (RTU,
  //  fan, skylight, tank) pool per 400 m cell, so r128 frustum-culls cells and
  //  core/farcull's fog-reach pass drops cells past the fog; the small cheap
  //  ones (vents, drains, hatches: a few hundred verts each) are ONE pool each
  //  for the whole city. About 3 + 4 x (cells in view) draws in total.
  // =====================================================================
  const SECT = 400;
  const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
  const _v = new THREE.Vector3(), _s = new THREE.Vector3(), _zero = new THREE.Matrix4().makeScale(0, 0, 0);
  function Pools(name, geo, cast, citywide) { this.name = name; this.geo = geo; this.cast = cast; this.citywide = !!citywide; this.items = []; }
  Pools.prototype.add = function (x, y, z, ry, sy, grp) {
    this.items.push({ x: x, y: y, z: z, ry: ry || 0, sy: sy || 1, grp: grp });
  };
  Pools.prototype.build = function (root, out, byGroup) {
    if (!this.items.length || !this.geo) return;
    const secs = new Map();
    for (const it of this.items) {
      const k = this.citywide ? "all" : Math.floor(it.x / SECT) + "," + Math.floor(it.z / SECT);
      let a = secs.get(k); if (!a) { a = []; secs.set(k, a); } a.push(it);
    }
    if (!this.geo.boundingSphere) this.geo.computeBoundingSphere();
    const pr = this.geo.boundingSphere ? this.geo.boundingSphere.radius : 4;
    const mat = DK.litMaterial();
    const self = this;
    secs.forEach(function (recs) {
      const g = self.geo.clone();
      let nx = 1e9, xx = -1e9, ny = 1e9, xy = -1e9, nz = 1e9, xz = -1e9;
      for (const r of recs) {
        if (r.x < nx) nx = r.x; if (r.x > xx) xx = r.x;
        if (r.y < ny) ny = r.y; if (r.y > xy) xy = r.y;
        if (r.z < nz) nz = r.z; if (r.z > xz) xz = r.z;
      }
      g.boundingSphere = new THREE.Sphere(new THREE.Vector3((nx + xx) / 2, (ny + xy) / 2, (nz + xz) / 2),
        Math.hypot(xx - nx, xy - ny, xz - nz) / 2 + pr + 1);
      const im = new THREE.InstancedMesh(g, mat, recs.length);
      im.name = "roofplant-" + self.name;
      im.castShadow = !!self.cast; im.receiveShadow = true;
      im.frustumCulled = true;
      im.userData.worldSpacePool = true;      // non-empty userData: batch/localinst leave it alone
      for (let i = 0; i < recs.length; i++) {
        const r = recs[i];
        _e.set(0, r.ry, 0); _q.setFromEuler(_e);
        _v.set(r.x, r.y, r.z); _s.set(1, r.sy, 1);
        _m4.compose(_v, _q, _s);
        im.setMatrixAt(i, _m4);
        if (r.grp) {
          let a = byGroup.get(r.grp); if (!a) { a = []; byGroup.set(r.grp, a); }
          a.push({ im: im, i: i, m: _m4.clone() });
        }
      }
      im.instanceMatrix.needsUpdate = true;
      root.add(im);
      out.push(im);
    });
  };

  // =====================================================================
  //  3. THE ROOF PASS
  // =====================================================================
  let protos = null;
  function getProtos() {
    if (protos) return protos;
    protos = {
      rtu: rtuProto(), fan: fanProto(), vent: ventProto(), drain: drainProto(),
      sky: skylightProto(), hatch: hatchProto(), tank: tankProto(),
    };
    return protos;
  }
  const H = function (x, z, salt) {
    if (CBZ.hash01) return CBZ.hash01(x, z, salt);
    const n = Math.sin(x * 127.1 + z * 311.7 + salt * 0.017) * 43758.5453;
    return n - Math.floor(n);
  };

  let builtFor = null, livePools = [], liveGroups = new Map(), audit = null;

  function dispose() {
    for (const im of livePools) { if (im.parent) im.parent.remove(im); if (im.geometry) im.geometry.dispose(); }
    livePools = []; liveGroups = new Map();
  }

  // what already stands on this roof, as circles + rects in WORLD xz
  function blockers(b, lot, S) {
    const circ = [], rect = [];
    const rcx = b.roofCx != null ? b.roofCx : (S.x0 + S.x1) / 2;
    const rcz = b.roofCz != null ? b.roofCz : (S.z0 + S.z1) / 2;
    circ.push({ x: rcx, z: rcz, r: 2.8 });                              // spawn point / slab centre
    if (b.helipad) circ.push({ x: b.helipad.x, z: b.helipad.z, r: (b.helipad.r || 6) + 1.6 });
    if (b.lift && b.lift.roof) circ.push({ x: b.lift.roof.x, z: b.lift.roof.z, r: 3.4 });
    const sr = b.shaftRects || [];
    for (const r of sr) {
      if (!r || !Number.isFinite(r.x0)) continue;
      rect.push({ x0: b.ox + r.x0 - 1.6, x1: b.ox + r.x1 + 1.6, z0: b.oz + r.z0 - 1.6, z1: b.oz + r.z1 + 1.6 });
    }
    if (b.fireEscape) circ.push({ x: b.ox + (b.fireEscape.side || 1) * (b.w / 2 - 1.3), z: b.fireEscape.z, r: 3.2 });
    if (b.roofCrown) {
      const c = b.roofCrown;
      rect.push({ x0: b.ox + c.x0 - 1.0, x1: b.ox + c.x1 + 1.0, z0: b.oz + c.z0 - 1.0, z1: b.oz + c.z1 + 1.0 });
    }
    const st = CBZ.cityRoofStashes ? CBZ.cityRoofStashes() : null;
    if (st) for (const s of st) if (s && s.b === b) circ.push({ x: s.x, z: s.z, r: 1.7 });
    const ads = CBZ.cityAdBoards || [];
    for (const a of ads) {
      if (!a || a.kind !== "roof") continue;
      if (a.x > S.x0 - 2 && a.x < S.x1 + 2 && a.z > S.z0 - 2 && a.z < S.z1 + 2) circ.push({ x: a.x, z: a.z, r: 4.0 });
    }
    return { circ: circ, rect: rect };
  }

  function buildRoofPlant(A) {
    dispose();
    if (!DK || !DK.proto || !DK.litMaterial) return;
    const P = getProtos();
    const pools = {
      rtu: new Pools("rtu", P.rtu, true), fan: new Pools("fan", P.fan, true),
      vent: new Pools("vent", P.vent, false, true), drain: new Pools("drain", P.drain, false, true),
      sky: new Pools("skylight", P.sky, false), hatch: new Pools("hatch", P.hatch, false, true),
      tank: new Pools("tank", P.tank, true),
    };
    const count = { roofs: 0, rtu: 0, fan: 0, vent: 0, drain: 0, sky: 0, hatch: 0, tank: 0, colliders: 0 };
    const MAX = { rtu: 220, fan: 160, tank: 24, sky: 150, vent: 720, drain: 600, hatch: 200 };
    const sets = [A.lots || []];
    if (A.annex && A.annex.lots) sets.push(A.annex.lots);
    const seen = new Set();
    let collidersAdded = 0;

    for (const set of sets) for (const lot of set) {
      const b = lot && lot.building;
      if (!b || b.park || !b.group || seen.has(b)) continue;
      if (!(b.w > 5 && b.d > 5 && b.h > 2)) continue;
      if (b.roofCrowned) continue;                    // dome / mansard / civic crown owns the roof
      seen.add(b);
      const wt = b.wt != null ? b.wt : 0.4;
      const slabMinX = b.hasStairs ? (-b.w / 2 + wt + (b.stairW || 0)) : (-b.w / 2 + wt);
      const gy = b.group.position ? b.group.position.y : 0;
      const S = {
        x0: b.ox + slabMinX, x1: b.ox + b.w / 2 - wt,
        z0: b.oz - b.d / 2 + wt, z1: b.oz + b.d / 2 - wt,
      };
      const sw = S.x1 - S.x0, sd = S.z1 - S.z0;
      if (sw < 3.5 || sd < 3.5) continue;
      const Y = gy + b.h;                              // the membrane surface (slab top = storeys*FH)
      const bl = blockers(b, lot, S);
      const placed = [];
      const ox = b.ox, oz = b.oz;
      const longX = sw >= sd;
      const derelict = !!(b.boarded || b.abandoned);
      count.roofs++;

      // is a footprint (world centre, half-extents incl. walkway) legal here?
      const EDGE = 1.0;                                 // a fitter walks between plant and parapet
      function fits(x, z, hx, hz, edge) {
        const e = edge == null ? EDGE : edge;
        if (x - hx < S.x0 + e || x + hx > S.x1 - e || z - hz < S.z0 + e || z + hz > S.z1 - e) return false;
        for (const c of bl.circ) {
          const dx = Math.max(Math.abs(x - c.x) - hx, 0), dz = Math.max(Math.abs(z - c.z) - hz, 0);
          if (dx * dx + dz * dz < c.r * c.r) return false;
        }
        for (const r of bl.rect) if (x + hx > r.x0 && x - hx < r.x1 && z + hz > r.z0 && z - hz < r.z1) return false;
        for (const q of placed) if (x + hx > q.x0 && x - hx < q.x1 && z + hz > q.z0 && z - hz < q.z1) return false;
        return true;
      }
      function claim(x, z, hx, hz) { placed.push({ x0: x - hx, x1: x + hx, z0: z - hz, z1: z + hz }); }
      // deterministic candidate walk over the slab (never rng: an order-free
      // position hash, so a roof is dressed the same on every client)
      function spot(salt, hx, hz, edge, tries) {
        const n = tries || 28;
        for (let k = 0; k < n; k++) {
          const u = H(ox + k * 3.1, oz - k * 1.7, salt), v = H(oz + k * 2.3, ox + k * 0.9, salt + 7);
          const x = S.x0 + hx + 1 + u * Math.max(0, sw - 2 * hx - 2);
          const z = S.z0 + hz + 1 + v * Math.max(0, sd - 2 * hz - 2);
          if (fits(x, z, hx, hz, edge)) return { x: x, z: z };
        }
        return null;
      }
      function solid(x, z, hx, hz, y1) {
        if (!CBZ.colliders) return;
        const c = { minX: x - hx, maxX: x + hx, minZ: z - hz, maxZ: z + hz, y0: Y, y1: Y + y1, ref: null, noCam: true, noBreach: true };
        CBZ.colliders.push(c);
        if (Array.isArray(b.colliders)) b.colliders.push(c);
        collidersAdded++;
      }
      const G = b.group;

      // ---- DRAINS: one per ~140 m2, in the field, never under plant ------
      const nDrain = Math.max(1, Math.min(4, Math.round(sw * sd / 140)));
      for (let k = 0; k < nDrain && count.drain < MAX.drain; k++) {
        const d = spot(0x5d10 + k * 13, 0.45, 0.45, 1.6, 20);
        if (!d) continue;
        pools.drain.add(d.x, Y, d.z, 0, 1, G); claim(d.x, d.z, 0.5, 0.5); count.drain++;
      }

      // ---- VENT STACKS: one cluster of 2-3 over the wet stack -------------
      {
        const c = spot(0x5d20, 0.7, 0.45, 0.8, 20);
        if (c && count.vent < MAX.vent) {
          const n = 2 + (H(ox, oz, 0x5d21) < 0.5 ? 1 : 0);
          for (let i = 0; i < n; i++) {
            const t = (i - (n - 1) / 2) * 0.55;
            const vx = longX ? c.x + t : c.x + (i % 2 ? 0.18 : -0.1);
            const vz = longX ? c.z + (i % 2 ? 0.18 : -0.1) : c.z + t;
            pools.vent.add(vx, Y, vz, 0, 0.8 + H(vx, vz, 0x5d22) * 0.6, G); count.vent++;
          }
          claim(c.x, c.z, 0.9, 0.6);
        }
      }
      if (derelict) continue;                          // a dead building keeps its drains and stacks, nothing live

      // ---- ROOF HATCH where no stair reaches the roof ----------------------
      if (!b.hasStairs && sw * sd > 30 && count.hatch < MAX.hatch) {
        const hs = spot(0x5d30, 0.55, 0.6, 1.2, 20);
        if (hs) { pools.hatch.add(hs.x, Y, hs.z, longX ? 0 : Math.PI / 2, 1, G); claim(hs.x, hs.z, 0.9, 1.2); count.hatch++; }
      }

      // ---- PACKAGED ROOFTOP UNITS, sized to the floor area they serve ------
      const area = sw * sd;
      const nRtu = area < 60 ? 0 : area < 170 ? 1 : area < 380 ? 2 : 3;
      const ry = longX ? 0 : Math.PI / 2;
      const hx = longX ? 1.75 : 1.1, hz = longX ? 1.1 : 1.75;       // unit + gas line + a service aisle
      for (let k = 0; k < nRtu && count.rtu < MAX.rtu; k++) {
        const r = spot(0x5d40 + k * 17, hx + 0.6, hz + 0.6, 1.0, 36);
        if (!r) break;
        const flip = H(r.x, r.z, 0x5d41) < 0.5 ? Math.PI : 0;        // which way the condenser end faces
        pools.rtu.add(r.x, Y, r.z, ry + flip, 1, G);
        claim(r.x, r.z, hx + 0.6, hz + 0.6);
        solid(r.x, r.z, longX ? 1.18 : 0.64, longX ? 0.64 : 1.18, 1.6);
        count.rtu++;
      }

      // ---- EXHAUST FAN ------------------------------------------------------
      if (area > 45 && count.fan < MAX.fan && H(ox, oz, 0x5d50) < 0.75) {
        const f = spot(0x5d51, 0.9, 0.9, 1.0, 24);
        if (f) { pools.fan.add(f.x, Y, f.z, 0, 1, G); claim(f.x, f.z, 0.9, 0.9); solid(f.x, f.z, 0.36, 0.36, 0.95); count.fan++; }
      }

      // ---- SKYLIGHTS: a row down the long axis of a low-rise ----------------
      if (b.storeys <= 4 && area > 110 && count.sky < MAX.sky && H(ox, oz, 0x5d60) < 0.4) {
        const n = area > 260 ? 3 : 2, step = 2.4;
        const run = (n - 1) * step;
        const s0 = spot(0x5d61, (longX ? run / 2 : 0) + 1.2, (longX ? 0 : run / 2) + 1.2, 1.2, 24);
        if (s0) {
          for (let i = 0; i < n; i++) {
            const t = -run / 2 + i * step;
            const sx = longX ? s0.x + t : s0.x, sz = longX ? s0.z : s0.z + t;
            pools.sky.add(sx, Y, sz, 0, 1, G); solid(sx, sz, 0.58, 0.58, 0.62); count.sky++;
          }
          claim(s0.x, s0.z, (longX ? run / 2 : 0) + 1.2, (longX ? 0 : run / 2) + 1.2);
        }
      }

      // ---- WATER TANK: rare, the 3-6 storey stock that really carries them --
      if (b.storeys >= 3 && b.storeys <= 6 && area >= 120 && count.tank < MAX.tank && H(ox, oz, 0x5d70) < 0.16) {
        const t = spot(0x5d71, 1.9, 1.9, 1.0, 30);
        if (t) {
          pools.tank.add(t.x, Y, t.z, H(t.x, t.z, 0x5d72) * Math.PI * 0.5, 1, G);
          claim(t.x, t.z, 1.9, 1.9); solid(t.x, t.z, 1.3, 1.3, 5.9); count.tank++;
        }
      }
    }

    const root = A.root || CBZ.scene;
    const byGroup = new Map();
    for (const k in pools) pools[k].build(root, livePools, byGroup);
    liveGroups = byGroup;
    count.colliders = collidersAdded;
    if (collidersAdded && CBZ.markCollidersDirty) CBZ.markCollidersDirty();
    count.pools = livePools.length;
    audit = count;
    if (CBZ.propPurgeCensus) {
      try { CBZ.propPurgeCensus({ roofItems: count.rtu + count.fan + count.tank + count.sky + count.hatch }); } catch (e) { /* census optional */ }
    }
  }

  // a building that collapses (demolition.js / structural.js hide its group
  // through batchHideGroup) takes its roof plant with it, and gets it back on
  // a rebuild. Wrapped once, markers copied forward, chain-safe.
  function wrapHide() {
    const hide = CBZ.batchHideGroup, show = CBZ.batchShowGroup;
    if (typeof hide === "function" && !hide._roofPlantWrapped) {
      const w = function (top) {
        const r = hide.apply(this, arguments);
        const a = liveGroups.get(top);
        if (a) { for (const e of a) { e.im.setMatrixAt(e.i, _zero); e.im.instanceMatrix.needsUpdate = true; } }
        return r;
      };
      for (const k in hide) if (/Wrapped$/.test(k)) w[k] = hide[k];
      w._roofPlantWrapped = true;
      CBZ.batchHideGroup = w;
    }
    if (typeof show === "function" && !show._roofPlantWrapped) {
      const w2 = function (top) {
        const r = show.apply(this, arguments);
        const a = liveGroups.get(top);
        if (a) { for (const e of a) { e.im.setMatrixAt(e.i, e.m); e.im.instanceMatrix.needsUpdate = true; } }
        return r;
      };
      for (const k in show) if (/Wrapped$/.test(k)) w2[k] = show[k];
      w2._roofPlantWrapped = true;
      CBZ.batchShowGroup = w2;
    }
  }

  // AFTER elevators.js (36.6) and roofloot.js (36.7) have claimed their roof
  // ground in the same first city frame; re-dressed when the arena is rebuilt.
  if (CBZ.onUpdate) CBZ.onUpdate(36.8, function () {
    const g = CBZ.game;
    if (!g || g.mode !== "city") return;
    const A = CBZ.city && CBZ.city.arena;
    if (!A || !A.lots || A === builtFor) return;
    builtFor = A;
    wrapHide();
    try { buildRoofPlant(A); } catch (e) { console.error("[roof plant]", e); }
  });
  // what stands on the city's roofs, for the console and the gates
  CBZ.roofPlantAudit = function () { return audit ? Object.assign({}, audit) : null; };

  // =====================================================================
  //  THE PRISON FACADE PASS  (PRISON_DRESS_V2)
  // =====================================================================
  // The city pass above dresses city/buildings.js's lots. The PRISON is a
  // different world — a handful of hand-raised roomShell boxes under
  // CBZ.prisonRoot — and from inside the yard those boxes are 6 m of blank
  // render with a coloured sign band on them. Same disease, same cure, so it
  // lives in the same file: the elevation you stare at while you walk the
  // yard gets the layer a real building has.
  //
  // IT DRESSES ONLY WHAT REGISTERS. CBZ.prisonShells is pushed by the rooms
  // that own themselves (cafeteria, lounge, and the south block's four), so
  // nothing here reaches into a shell another file owns — no cell block, no
  // armory, no guard hut. A room opts in with one line.
  //
  // TIMING: this runs at PARSE, not inside a DK pass. index.html parses the
  // prison at :383-:450 and this file at :1408, so every shell already exists
  // and core/batch.js (:1413, fires on `load`) still merges the result.
  //
  // WIRE: none. world/razorwire.js owns every coil in the compound and crowns
  // the PERIMETER on purpose — a 6 m room roof inside the wire is not a
  // climbing risk, so wiring it would be decoration pretending to be security.
  // What these roofs get instead is the thing they were actually missing: a
  // coping band, so the top of the wall reads as an edge.
  (function prisonFacade() {
    const CFG = CBZ.CONFIG || {};
    if (CFG.PRISON_DRESS_V2 === false) return;
    const shells = CBZ.prisonShells;
    const PD = CBZ.prisonDress;
    if (!shells || !shells.length || !PD || !CBZ.addBox) return;
    const addBox = CBZ.addBox;
    let nWin = 0, nPipe = 0, nBand = 0;

    for (let i = 0; i < shells.length; i++) {
      const s = shells[i];
      if (!s || !s.face) continue;
      const f = s.face;
      const xAxis = (f === "E" || f === "W");
      const sign = (f === "E" || f === "S") ? 1 : -1;          // outward direction
      // the wall's centreline, its OUTER face (walls are 0.5 thick, centred on
      // the rect edge), and the span of the elevation along its own axis
      const edge = f === "E" ? s.x1 : f === "W" ? s.x0 : f === "S" ? s.z1 : s.z0;
      const out = edge + sign * 0.25;
      const a0 = xAxis ? s.z0 : s.x0, a1 = xAxis ? s.z1 : s.x1;
      const span = a1 - a0, mid = (a0 + a1) / 2;
      const h = s.h || 6;
      const tone = s.tone != null ? s.tone : 0x8a929c;
      // is `p` inside this elevation's door gap (plus a reveal either side)?
      const isDoorFace = s.door === f;
      const clearOfDoor = function (p, half) {
        if (!isDoorFace || s.dc == null) return true;
        return Math.abs(p - s.dc) > (s.dw || 3.4) / 2 + half + 0.7;
      };
      const at = function (p, offset, w, hgt, thick, color, opts) {
        // one call places a box on this elevation without the caller ever
        // knowing which axis it is on
        return xAxis
          ? addBox(out + sign * offset, hgt, p, thick, opts.h, w, color, opts)
          : addBox(p, hgt, out + sign * offset, w, opts.h, thick, color, opts);
      };

      // ---- COPING: the drip edge along the top of the elevation -----------
      // One box, and it is the highest-value line in the pass: it is what
      // stops a wall and a sky meeting at a hard unshaded corner.
      at(mid, 0.06, span + 0.5, h - 0.16, 0.22, 0x6f7a86, { h: 0.22, cast: false });
      nBand++;

      // ---- BARRED WINDOWS: a rhythm, not a scatter ------------------------
      // Institutions repeat a bay. Count comes from the span, positions are
      // symmetric about the centre, and any bay that lands on the doorway is
      // simply not built — the rhythm survives the gap, which is exactly how
      // a real elevation handles its entrance.
      if (!s.quiet) {
        const bays = Math.max(2, Math.min(4, Math.floor(span / 5.0)));
        const step = span / (bays + 1);
        const wy = h * 0.6;
        for (let b = 1; b <= bays; b++) {
          const p = a0 + b * step;
          if (!clearOfDoor(p, 0.7)) continue;
          at(p, 0.05, 1.32, wy, 0.14, 0x161a20, { h: 1.14, cast: false });      // reveal
          for (const k of [-1, 1])                                               // bars, proud of the reveal
            at(p + k * 0.28, 0.16, 0.075, wy, 0.075, 0x2a2f38, { h: 1.06, cast: false });
          at(p, 0.1, 1.5, wy - 0.66, 0.2, 0xa8b0b8, { h: 0.1, cast: false });     // sill
          nWin++;
        }
      }

      // ---- DOWNPIPE at the yard-side corner of the elevation --------------
      // Rainwater has to come off a roof somewhere. Placed at the corner
      // furthest from the door so it never lands in a doorway reveal.
      const corner = (isDoorFace && s.dc != null && s.dc > mid) ? a0 + 0.45 : a1 - 0.45;
      const px = xAxis ? out + sign * 0.16 : corner;
      const pz = xAxis ? corner : out + sign * 0.16;
      PD.pipe(px, (h - 0.3) / 2 + 0.15, pz, h - 0.3, "y", 0.075, 0x8b8f8c);
      addBox(px + (xAxis ? sign * 0.06 : 0), 0.24, pz + (xAxis ? 0 : sign * 0.06),
        xAxis ? 0.26 : 0.2, 0.34, xAxis ? 0.2 : 0.26, 0x7c817e, { cast: false });  // shoe
      nPipe++;
    }

    // Census, printed the way the city pass prints its own — an audit nobody
    // has executed is not a measurement (CLAUDE.md), so it is at least
    // countable from the console the first time somebody looks.
    CBZ.prisonFacadeAudit = function () {
      return { shells: shells.length, windows: nWin, downpipes: nPipe, copings: nBand };
    };
  })();
})();
