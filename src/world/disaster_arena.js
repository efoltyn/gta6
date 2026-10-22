/* ============================================================
   world/disaster_arena.js — the SURVIVAL island: builder.

   A disaster island built FAR from the prison (z≈600) so both worlds
   can coexist with zero refactor: an escape match never sees it, a
   survival match teleports here. Everything lives in one group
   (arena.root) so escape mode just hides it.

   THE ISLAND IS A PLACE (2026-10-14). It was a 120 m disc with the volcano
   dead centre, a 5 x 5 street lattice painted over it and ~30 buildings
   dropped at random angles, every front door on -z. It is now 240 m (twice
   across, four times the land), laid out by world/island_plan.js as a small
   volcanic harbour town: a coastal plain climbing from the beach, the
   volcano to the north-west with its breach facing the town, a dry ghaut
   from the breach to the beach crossed by bridges, reclaimed quays with a
   breakwater, a lighthouse, marina jetties and moored boats, a downtown
   grid behind the waterfront with a handful of towers and a helipad hotel,
   residential streets west and north, villas on the estates, the Works on
   the east, a ring road, farm fields, beaches. This file BUILDS what the
   plan says; the plan is data (and tools/island-check.mjs audits it in
   node: no lot overlaps, no footprint past its lot line, every car on a
   road, in a bay or on a drive).

   The buildings are ENTERABLE — a front door on the street, windows, a
   switchback stair to every floor and the roof (or a lift in a tower),
   walkable slabs — registered as CBZ.platforms and height-gated
   CBZ.colliders, so you go inside and up. None of them are safe: the quake
   topples each as one piece; there is no safe building, only the right
   KIND of shelter for each hazard, high ground, and luck.

   COST, for a phone: a building's opaque shell draws as ONE mesh (bakeShell),
   every tree as an instance (world/instance_proxy.js), the streets in 7
   draws, the dressing in 8, the harbour in 4. The parked cars are real
   vehicles (world/island_vehicles.js) drawn past 35 m by the vehicle
   system's own pools (city/carinstances.js, far tier city/carlod.js).

   CBZ.buildDisasterArena() builds once and returns the arena descriptor;
   CBZ.island is the same island as data for the disasters (see publish()).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;

  let arena = null;
  // Live roughness of the arena sea, mirrored from whatever a disaster is
  // driving into the shader so the CPU height query matches the displacement.
  const arenaWave = { amp: 0.86, chop: 0.72, foam: 0.34, opacity: 1 };
  let arena_meanY = function () { return -0.8; };
  // SURV_BEACH_V2's live wet-line rig ({attr, base, h, th, wet, n}) + the
  // static shore numbers the before/after tool reads (CBZ.survShoreAudit).
  let shoreRig = null, shoreFacts = null;
  // The kelp field's sway rig ({attr, base, lean, ph, n}) — see the seabed
  // dressing in buildDisasterArena. Only ever touched while the eye is under
  // water, which is the only place kelp is visible from.
  let kelpRig = null;

  // SURV_SEABED — the island's coastal shelf (see groundHeightAt below). ON →
  // the ground falls away past the beach, so the open ocean is real water and
  // city/swim.js's swimmer runs on this island. OFF (or ?cfg_SURV_SEABED=0) →
  // the flat y=0 floor out to infinity, and you walk on the sea.
  if (CBZ.CONFIG.SURV_SEABED == null) CBZ.CONFIG.SURV_SEABED = true;

  // SURV_FACADES — dress the island's town with the facade kit's registered
  // grammars, one per building, so every style can be walked around in the
  // mode that loads in seconds. ON by default: this island is the kit's
  // showroom. ?cfg_SURV_FACADES=0 gives the plain island back.
  if (CBZ.CONFIG.SURV_FACADES == null) CBZ.CONFIG.SURV_FACADES = true;

  /* ---- THE SURVIVAL WATER QUERIES ---------------------------------------
     One surface, three questions, all answered off world/water_spec.js's
     canonical swell table — the same one the shader displaces by. These are
     what let city/swim.js (the real swimmer: sink-unless-you-swim, the 28 s
     breath meter, the drown through the kill bus) work on this island without
     knowing an island exists. Never build a second water height model.       */
  CBZ.survSeaMeanY = function () { return arena_meanY(); };
  CBZ.survSeaWave = function () { return arenaWave; };
  // metres the water at (x,z) still sits below the flood because a tsunami
  // front has not reached it (water_spec.js uDwAhead / waterFrontDropAt)
  function frontDrop(x, z) { return CBZ.waterFrontDropAt ? CBZ.waterFrontDropAt(x, z) : 0; }
  CBZ.survSeaHeightAt = function (x, z) {
    const mean = arena_meanY() - frontDrop(x, z);
    return CBZ.waterDisasterSurfaceY
      ? CBZ.waterDisasterSurfaceY(x, z, mean, arenaWave.amp, arenaWave.chop)
      : mean;
  };
  /* Metres of water standing over the ground at (x,z) — the survival twin of
     CBZ.cityFloodDepthAt. Negative/zero means dry land.

     THE OLD SCOPE NOTE SAID this answered FLOOD water and not open ocean,
     because the arena's walkable floor was a flat 0 everywhere outside the
     four hills — including out to sea — "which is why you have always been
     able to walk off this island onto nothing". That was not a scope, it was
     the bug, and it was measured (survival, seed 90210, 300 m offshore):

         playerPos [300, 0, 600]  grounded true   seaY -0.762
         feetAboveSea 0.762       _swim false     submergence 0  breath 1.0
         ground = 0 at 400 m, 1000 m, 5000 m out.

     The player stood 0.76 m ABOVE the sea, grounded, for as far as the map
     goes, and city/swim.js was never entered — because the swimmer is gated on
     survWaterAt, and survWaterAt is this function. The whole shared-swim wiring
     (SURV_SHARED_SWIM) was live and unreachable: no stroke pose, no buoyancy,
     no breath drain, on an island whose headline event is a tsunami.

     SURV_SEABED (below) gives the arena the missing bathymetry, so this
     function now answers for the open ocean as well and the sentence above
     stops being true. */
  CBZ.survFloodDepthAt = function (x, z) {
    if (!arena) return 0;
    return CBZ.survSeaHeightAt(x, z) - arena.groundHeightAt(x, z);
  };
  /* THE SAME WATER COLUMN, MEASURED AGAINST MEAN SEA LEVEL INSTEAD OF THE LIVE
     CREST — and the swimmer's entry test must use THIS one.

     WHY THERE ARE TWO. The city's bed depth (city/swim.js's cityBedDepthAt) is
     built from waterfield's SHORE DISTANCE, which is a static field: a wave
     rolling past does not change how deep the water is. Here the depth was
     being read off the live wavy surface, so during a tsunami — waveAmp 1.38 /
     chopAmp 1.72 in the flood phase, 1.55 / 2.15 in the sweep — the "depth" at
     a fixed point swung by metres at wave frequency. swim.js enters the swim at
     1.35 m and leaves it at 1.05 m, so everywhere near that band the swimmer
     entered and exited several times a second, and every one of those
     transitions fires a splash, an sfx, a camera shake and a velocity reset.
     The whole town crosses that band twice per event: once as the surge arrives
     and once as it drains from 8.3-14.3 m back to zero.

     So: the SURFACE question stays wavy (that is the crest you can see and ride)
     and the BED question goes flat. One water, two honest readings of it. */
  CBZ.survFloodDepthMeanAt = function (x, z) {
    if (!arena) return 0;
    return arena_meanY() - frontDrop(x, z) - arena.groundHeightAt(x, z);
  };
  // "is this point in the water" — the survival twin of CBZ.cityWaterAt. Reads
  // the MEAN column for the same reason: a swell crest lapping over a kerb does
  // not make the street a swimmable body of water, and letting it flicker here
  // flickers every consumer downstream (the swimmer, the camera, the FX).
  CBZ.survWaterAt = function (x, z) { return CBZ.survFloodDepthMeanAt(x, z) > 0.3; };
  // World Y of the seabed — what a renderer and a camera boom actually want.
  // The survival twin of CBZ.citySeaBedYAt.
  CBZ.survSeaBedYAt = function (x, z) {
    return arena ? arena.groundHeightAt(x, z) : 0;
  };
  // The shore's static facts (band width, dry sand, wade band, live wet line)
  // — what tools/visual-presets/beach-shores.mjs prints as its measurements.
  CBZ.survShoreAudit = function () { return shoreFacts; };

  /* ---- THE WATERLINE MOVES (SURV_BEACH_V2) --------------------------------
     Same law the city beach's swash apron enforces: the dark wet line and the
     sea's edge must be ONE thing. Every vertex of the shore ring below the
     LIVE mean sea (plus a small alongshore swash so the line breathes instead
     of ruling a circle) wets INSTANTLY; dry-out is slow (0.10/s ≈ 10 s), so a
     tsunami drawdown strands a great ring of wet sand and a flood's retreat
     leaves its own high-water mark. ~2k vertices, one colour write per frame,
     survival mode only. 47.95: right after the ocean mesh itself has taken
     this frame's surge at 47.9 — sand and sea read the same number. */
  const WET_DRY_RATE = 0.10;
  let _wetT = 0;
  if (CBZ.onUpdate) CBZ.onUpdate(47.95, function (dt) {
    const S = shoreRig;
    if (!S || !arena || !CBZ.game || !CBZ.islandModeOn(CBZ.game.mode)) return;
    _wetT += dt || 0;
    const t = CBZ.waterClock ? CBZ.waterClock() : _wetT;
    const sea = arena_meanY();
    const dry = Math.min(1, Math.max(0, dt) * WET_DRY_RATE);
    const cols = S.attr.array, base = S.base;
    let dirty = false;
    for (let i = 0; i < S.n; i++) {
      // ±0.3 m of breathing swash, phased along the shore (θ·43 ≈ 21 m waves)
      const swash = 0.19 * Math.sin(t * 0.9 + S.th[i] * 43.0) + 0.11 * Math.sin(t * 0.53 - S.th[i] * 23.0);
      const lip = S.h[i] - (sea - (S.x ? frontDrop(S.x[i], S.z[i]) : 0) + swash);   // m above the breathing waterline
      const target = lip <= 0 ? 1 : (lip >= 0.5 ? 0 : 1 - (lip / 0.5) * (lip / 0.5) * (3 - 2 * (lip / 0.5)));
      let w = S.wet[i];
      if (target > w) w = target;                  // soaks instantly
      else w += (target - w) * dry;                // dries slowly behind the sea
      if (Math.abs(w - S.wet[i]) < 0.004) continue;
      S.wet[i] = w;
      const q = i * 3, dk = 1 - 0.45 * w;          // wet sand: darker, same hue
      cols[q] = base[q] * dk; cols[q + 1] = base[q + 1] * dk; cols[q + 2] = base[q + 2] * dk;
      dirty = true;
    }
    if (dirty) S.attr.needsUpdate = true;
  });

  /* ---- THE KELP MOVES, BUT ONLY WHEN ANYONE CAN SEE IT --------------------
     A static weed field reads as plastic, and a per-frame vertex rewrite of a
     few hundred verts is not the sort of thing this game has spare. Both are
     avoided by the one gate that is actually true: kelp lives 3-13 m down and
     is only ever LOOKED at from under the water, so the sway runs when — and
     only when — world/water_underwater.js says the eye is submerged. On every
     other frame in every other mode this costs one boolean.
     ~650 vertices, no allocation, throttled to 15 Hz. */
  let _kelpT = 0, _kelpNext = 0;
  if (CBZ.onUpdate) CBZ.onUpdate(47.96, function (dt) {
    const K = kelpRig;
    if (!K || !arena || !CBZ.game || !CBZ.islandModeOn(CBZ.game.mode)) return;
    if (!CBZ.cityCameraSubmerged || !CBZ.cityCameraSubmerged()) return;
    _kelpT += dt || 0;
    if (_kelpT < _kelpNext) return;
    _kelpNext = _kelpT + 0.066;
    const a = K.attr.array, b = K.base, ln = K.lean, ph = K.ph, t = _kelpT;
    for (let i = 0; i < K.n; i++) {
      const w = ln[i];
      if (w < 0.02) continue;                 // the holdfast never moves
      const p = ph[i];
      const sx = Math.sin(t * 0.72 + p) * 0.5 + Math.sin(t * 1.63 + p * 2.1) * 0.18;
      const sz = Math.cos(t * 0.61 + p * 1.4) * 0.46;
      const q = i * 3;
      a[q] = b[q] + sx * w;
      a[q + 2] = b[q + 2] + sz * w;
    }
    K.attr.needsUpdate = true;
  });

  // deterministic-ish RNG so the map is the same each match (learnable)
  let _s = 1337;
  function rng() { _s = (_s * 1103515245 + 12345) & 0x7fffffff; return _s / 0x7fffffff; }

  // THE BUILDING'S NUMBERS AND ITS PLAN (world/island_building.js): floor
  // height, wall, the stair strip down the -x wall, the street door; the
  // stairs, landings, slabs, guards and roof every makeBuilding lays
  const IB = CBZ.islandBuilding;
  const FH = IB.FH;       // floor-to-floor height
  const WT = IB.WT;       // wall thickness
  const SW = IB.SW;       // the stair strip (two lanes along the -x interior wall)
  const DOORW = IB.DOORW; // front doorway width


  /* ============================================================
     THE FACADE KIT ON THE ISLAND (city/facade_kit.js + city/facades/*.js)
     ============================================================
     The kit's contract is a ctx of the host's REAL numbers plus a handful of
     emitters — it never touches THREE, the scene graph or the collider arrays
     itself. buildings.js hands it that ctx for a city lot; this hands it the
     same ctx for an island building, so all 31 registered grammars can be
     walked around in the mode that loads in seconds instead of booting the
     whole city.

     Two things this has to get right or it would be a performance trap:

       1. MERGE. A facade emits hundreds to a few thousand boxes. One mesh
          each would be 30 000 draw calls on a 27-building island. So dbox
          collects a BoxGeometry per call, keyed by colour, and the whole
          bucket is merged into ONE mesh per colour at the end — exactly what
          buildings.js's flushDeco does, for exactly the same reason.
       2. THE GROUP. Everything lands in the building's own group, so the
          earthquake still topples a dressed building as a single piece and
          the arena's teardown still frees it.

     Deco is collision-free by construction: colliders and platforms come from
     the arena's own lbox/tbox walls, and a facade may only add a walk surface
     through ctx.plat (a porch deck or a flight of steps), never a wall.
  ============================================================ */
  const shadeHex = IB.shadeHex;

  /* ============================================================
     THE FINISH: what turns the island's boxes into buildings
     ============================================================
     OWNER: "all of the building facades kind of flicker and they're kind of
     weird", and of the same facades, "is that real art?".

     THE FLICKER was z-fighting, measured, not guessed: render one frame, then
     the same frame with only the camera's near plane nudged 0.3% (geometry
     projects to the same pixels, only the depth mapping moves), and 1.2% of
     the street view changed colour, every changed pixel on facade ornament.
     Those are EXACT depth ties: the grammars lay a band and a pier with the
     same projection, a sill on a panel with the same face plane, and each
     colour is its own merged mesh, so which one wins a pixel is decided by
     rounding and changes with every step the camera takes. No amount of
     depth precision fixes an exact tie, and a depth bias (the polygonOffset
     rank per colour this file used to settle them with) only hides it under
     a second layer. What fixes it is that there is no tie: the faces are
     moved apart in GEOMETRY, the box laid last keeps the plane and every
     earlier one steps back 10 mm behind it (city/facade_openings.js
     resolveCoplanar, the same pass every city building runs).

     THE ART had three faults, each one a sentence:
       * the shell was painted from a party palette (sky blue, pink, mint) and
         every grammar that leaves the host wall showing showed THAT, so a
         gothic chapel had canary yellow walls and a brick loft had baby blue
         "windows" that were really the shell's paint behind its openings;
       * the host's glass was BURIED: panes at wall-face minus 10 cm, inside a
         30 cm wall, so no grammar ever had glass behind its openings (they
         were all written against buildings.js's glass band, which the island
         never provided). The towers had the opposite fault, one floating pane
         per face per storey, light cyan, half transparent;
       * every surface was one flat Lambert colour with no age on it.
     So: real wall materials, a real glazing pass (below), and a weathering
     term in the wall shader (streaks, mottle, a darker splash-back at the
     foot of the wall) that costs no draw calls and no textures.

     THE GLAZING PASS reads the facade instead of guessing at it. After the
     grammar has built, the host's glass band (the one the city host has:
     storey floor + 0.55 m to ceiling - 0.45 m) is SAMPLED along each face
     against every box the grammar laid on the wall. Whatever stays uncovered
     is an opening the grammar meant to show glass through, and each opening
     gets exactly one window: a pane of glass set back behind a thin frame,
     mullions if it is wide, a transom if it is tall, and ONE interior state
     (reflecting the sky, curtains drawn, blinds half down, a dark room, a lit
     room) so no two windows in a row read as the same tile. Glass behind
     cladding is never built at all. All the panes of a building are merged
     into three meshes (reflective / room / lit) and a shattered pane is
     collapsed in place, so a 22-storey tower's glazing went from ~80 draw
     calls to 3 while every pane still bursts on its own. */
  const GR_VHEAD = "#include <common>\nvarying vec3 vGrP;\nvarying vec3 vGrN;";
  const GR_VBODY = "#include <project_vertex>\nvGrP = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvGrN = normalize(mat3(modelMatrix) * objectNormal);";
  const GR_FHEAD = "#include <common>\nvarying vec3 vGrP;\nvarying vec3 vGrN;\nuniform float uGrBase;\n" +
    "float grH(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }\n" +
    "float grN(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);\n" +
    "  return mix(mix(grH(i), grH(i + vec2(1.0, 0.0)), f.x), mix(grH(i + vec2(0.0, 1.0)), grH(i + vec2(1.0, 1.0)), f.x), f.y); }";
  // mottle everywhere; on walls, rain streaks running down and the darker
  // splash-back band at the foot where rain and dirt hit it
  const GR_FBODY = "#include <color_fragment>\n{\n" +
    "  vec3 gn = abs(vGrN);\n" +
    "  float gh = vGrP.y - uGrBase;\n" +
    "  vec2 fp = gn.y > 0.6 ? vGrP.xz : (gn.x > gn.z ? vGrP.zy : vGrP.xy);\n" +
    "  float mt = grN(fp * 0.9) * 0.55 + grN(fp * 3.1) * 0.3 + grN(fp * 11.0) * 0.15;\n" +
    "  float gk = 0.85 + 0.25 * mt;\n" +
    "  if (gn.y < 0.6) {\n" +
    "    float st = grN(vec2(fp.x * 1.9, fp.y * 0.11 + mt * 0.5));\n" +
    "    gk *= 1.0 - 0.24 * smoothstep(0.5, 0.95, st);\n" +
    "    gk *= mix(0.56, 1.0, smoothstep(0.05, 1.5, gh + 0.5 * (mt - 0.5)));\n" +
    "  }\n" +
    "  diffuseColor.rgb *= gk;\n" +
    "}";
  function grimeCompile(base) {
    return function (sh) {
      sh.uniforms.uGrBase = base;
      sh.vertexShader = sh.vertexShader.replace("#include <common>", GR_VHEAD).replace("#include <project_vertex>", GR_VBODY);
      sh.fragmentShader = sh.fragmentShader.replace("#include <common>", GR_FHEAD).replace("#include <color_fragment>", GR_FBODY);
    };
  }
  function grimeKey() { return "cbz-island-grime"; }

  // One material per (colour, foot height), shared island-wide. Every face
  // draws at its true depth: coplanar ties are moved apart in geometry
  // (facadeOpenings.resolveCoplanar), never biased in the depth buffer.
  const finMats = new Map();
  function finishMat(col, baseY) {
    const key = col + "|" + Math.round(baseY * 5);
    let m = finMats.get(key);
    if (m) return m;
    m = new THREE.MeshLambertMaterial({ color: col });
    m.onBeforeCompile = grimeCompile({ value: Math.round(baseY * 5) / 5 });
    m.customProgramCacheKey = grimeKey;
    m._shared = true;
    finMats.set(key, m);
    return m;
  }
  /* GLASS YOU CAN SEE THROUGH.
     OWNER: "You can't see out of any of the facades ... you can't really see
     space and see what the hell is going on." In a disaster game the window
     is how you watch the wave or the funnel coming, and every window on the
     island was a painted card: an opaque quad 2 cm proud of a SOLID 30 cm
     wall, with a fake room (dark, lit, curtained) painted on it. There was
     nothing behind the glass, from either side.

     Now the glazing pass cuts a real hole through the shell wall (and through
     any cladding the grammar laid flush over it) for every window it finds,
     and hangs real glass in the reveal: clear, faintly tinted, and a Fresnel
     term so it mirrors the sky at a glancing angle the way glass does and
     goes nearly clear when you look straight through it. From inside you see
     the island; from outside you see the stairs, the tables and the people.
     Curtains and blinds are now real cloth INSIDE the room, drawn part way,
     never over the whole pane. Still merged per building: one glass mesh,
     one cloth mesh, one lit-blind mesh. */
  const GLASS_FRAG_OUT = "gl_FragColor = vec4( outgoingLight, diffuseColor.a );";
  const GLASS_FRAG_NEW =
    "float cbzFr = 1.0 - abs(dot(normalize(vViewPosition), normal));\n" +
    "cbzFr = cbzFr * cbzFr * cbzFr;\n" +
    "gl_FragColor = vec4( outgoingLight, clamp(diffuseColor.a + 0.62 * cbzFr, 0.0, 0.86) );";
  let glassMats = null;
  function islandGlassMats() {
    if (glassMats) return glassMats;
    const glass = new THREE.MeshStandardMaterial({
      color: 0xffffff, vertexColors: true, metalness: 0.15, roughness: 0.05,
      envMap: CBZ.ENV || null, envMapIntensity: 1.25,
      transparent: true, opacity: 0.13, depthWrite: false, side: THREE.DoubleSide,
    });
    glass.onBeforeCompile = function (sh) {
      sh.fragmentShader = sh.fragmentShader.replace(GLASS_FRAG_OUT, GLASS_FRAG_NEW);
    };
    glass.customProgramCacheKey = function () { return "cbz-island-glass-fresnel"; };
    const room = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true, side: THREE.DoubleSide });
    const lit = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true, side: THREE.DoubleSide,
      emissive: 0xffb866, emissiveIntensity: 0.34 });
    glass._shared = room._shared = lit._shared = true;
    glassMats = { glass: glass, room: room, lit: lit };
    envWanting.push(glass); hookEnv();
    return glassMats;
  }
  // The environment map can arrive after the island is built (carfx makes it
  // late on some boots); a mirror-metal pane without it renders black, so
  // every glass material is re-pointed at it the first frame it exists.
  const envWanting = [];
  let envHooked = false;
  function hookEnv() {
    if (envHooked || !CBZ.onUpdate) return;
    envHooked = true;
    let done = false;
    CBZ.onUpdate(48.1, function () {
      if (done || !CBZ.ENV) return;
      done = true;
      for (const m of envWanting) if (m.envMap !== CBZ.ENV) { m.envMap = CBZ.ENV; m.needsUpdate = true; }
    });
  }
  // a grammar's own dark glass box, as glass: its colour becomes the tint
  const glassBoxMats = new Map();
  function glassBoxMat(col) {
    const key = col;
    let m = glassBoxMats.get(key);
    if (m) return m;
    const c = new THREE.Color(col).lerp(new THREE.Color(0x6d7c89), 0.55);
    m = new THREE.MeshStandardMaterial({ color: c, metalness: 0.9, roughness: 0.16,
      envMap: CBZ.ENV || null, envMapIntensity: 1.1 });
    m._shared = true;
    envWanting.push(m); hookEnv();
    glassBoxMats.set(key, m);
    return m;
  }
  // Is this deco colour a grammar's own "glass" box (dark, cool)? Those get
  // the reflective glass material instead of a flat dark Lambert.
  function isGlassHex(c) {
    const r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
    const l = (r * 0.299 + g * 0.587 + b * 0.114) / 255;
    return l < 0.14 && b >= r && b >= g * 0.9;
  }

  /* THE WINDOWS. o: { group, ox, oz, gy, w, d, storeys, fh, wt, doorHalf,
     list, recs (the facade's deco boxes, local [x,y,z,w,h,d,col], CUT in
     place), walls (the shell's wall meshes, see cutWall), dbox (deco
     emitter), frameCol, sillCol, sillStain, tower }. */
  function glazeBuilding(o) {
    const THREE_ = window.THREE;
    const G = islandGlassMats();
    const h01 = function (a, b, s) { return CBZ.hash01 ? CBZ.hash01(o.ox + a, o.oz + b, s) : 0.5; };
    const kinds = { glass: { p: [], n: [], c: [], i: [] }, room: { p: [], n: [], c: [], i: [] }, lit: { p: [], n: [], c: [], i: [] } };
    const panes = [];
    const holes = [];                     // {s, a0, a1, y0, y1}: a is local x (faces 0/1) or z (2/3)
    const WT_ = o.wt || 0.3;
    const GIN = 0.07;                     // glass set back into the reveal
    const FW = 0.055, FP = 0.05;          // frame bar width / projection
    const frames = [];                    // frame boxes, laid AFTER the cut

    function quad(K, off, f, u0, u1, v0, v1, cBot, cTop, rec) {
      const k = kinds[K], base = k.p.length / 3;
      const nx = f.horiz ? 0 : f.out, nz = f.horiz ? f.out : 0;
      const cxx = f.horiz ? 0 : f.out * off, czz = f.horiz ? f.out * off : 0;
      const pts = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
      for (let q = 0; q < 4; q++) {
        const u = pts[q][0], v = pts[q][1];
        k.p.push(cxx + f.tx * u, v, czz + f.tz * u);
        k.n.push(nx, 0, nz);
        const c = v === v0 ? cBot : cTop;
        k.c.push(c[0], c[1], c[2]);
      }
      k.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
      rec.parts.push({ K: K, v: base });
    }
    const lin = function (hex) { return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255]; };
    const mul = function (c, f) { return [c[0] * f, c[1] * f, c[2] * f]; };
    const faces = [
      { s: 0, horiz: true, out: -1, tx: -1, tz: 0, span: o.w, halfN: o.d / 2 },
      { s: 1, horiz: true, out: 1, tx: 1, tz: 0, span: o.w, halfN: o.d / 2 },
      { s: 2, horiz: false, out: -1, tx: 0, tz: 1, span: o.d, halfN: o.w / 2 },
      { s: 3, horiz: false, out: 1, tx: 0, tz: -1, span: o.d, halfN: o.w / 2 },
    ];
    // one window: the glass in the reveal, and at most one piece of cloth
    // hung inside the room (never over the whole pane: a window is for
    // looking through)
    function glass(f, u0, u1, v0, v1, salt, rec, shop) {
      let r = h01(u0 * 3.1 + f.s, v0 * 1.7, salt);
      if (shop) r = r < 0.8 ? 0.1 : 0.95;
      const tint = [[0.8, 0.88, 0.92], [0.74, 0.84, 0.82], [0.86, 0.88, 0.9]][(h01(f.s, v0, salt + 7) * 3) | 0];
      quad("glass", f.halfN - GIN, f, u0, u1, v0, v1, mul(tint, 0.9), tint, rec);
      const inner = f.halfN - WT_ - 0.035;       // the room side of the wall
      const hw = u1 - u0;
      if (r < 0.55) return;                       // clear glass
      if (r < 0.72) {
        // curtains gathered at the sides
        const cloth = lin([0xd8cbb0, 0xb9a88a, 0x8c3b34, 0x5b6a7c, 0xe6e0d2][(h01(f.s, v1, salt + 3) * 5) | 0]);
        const side = Math.min(hw * 0.24, 0.12 + h01(u1, v0, salt + 5) * hw * 0.14);
        quad("room", inner, f, u0 - 0.06, u0 + side, v0 - 0.05, v1 + 0.08, mul(cloth, 0.6), mul(cloth, 0.5), rec);
        quad("room", inner, f, u1 - side, u1 + 0.06, v0 - 0.05, v1 + 0.08, mul(cloth, 0.6), mul(cloth, 0.5), rec);
      } else if (r < 0.88) {
        // a blind part way down
        const vb = v1 - (v1 - v0) * (0.18 + h01(u0, v1, salt + 9) * 0.27);
        const bl = lin([0xe9e4d6, 0xcfc6b0, 0xa9a39a][(h01(u1, v1, salt + 11) * 3) | 0]);
        quad("room", inner, f, u0, u1, vb, v1 + 0.04, mul(bl, 0.62), mul(bl, 0.55), rec);
      } else {
        // somebody left the light on: a lit blind glowing over the top third
        const vb = v1 - (v1 - v0) * (0.28 + h01(u0, v1, salt + 13) * 0.12);
        quad("lit", inner, f, u0, u1, vb, v1 + 0.04, [0.66, 0.54, 0.36], [0.8, 0.7, 0.52], rec);
      }
    }

    /* WHERE THE WINDOWS GO is decided by city/facade_openings.js's ONE scan
       (the same that places every Gang City and town window): where the
       grammar left the wall open, its own painted glass marking the window;
       a storey it clad solid gets windows on a rhythm, cut through the skin
       laid against the wall but never behind a column, porch or eave. The
       scan works in the shell's local axes (t = local x on faces 0/1, z on
       2/3); this file's faces run u = t * tx (or tz). */
    const FOP = CBZ.facadeOpenings;
    const found = FOP ? FOP.scan(o.recs, { w: o.w, d: o.d, storeys: o.storeys, fh: o.fh, doorSide: 0,
      doorHalf: o.doorHalf, tower: !!o.tower, isGlass: o.isGlass || isGlassHex }) : [];
    for (const op of found) {
      const f = faces[op.s];
      const sg = f.horiz ? f.tx : f.tz;
      const ua = op.t0 * sg, ub = op.t1 * sg;
      placeWindow(f, op.k, !o.tower && f.s === 0 && op.k === 0, Math.min(ua, ub), Math.max(ua, ub), op.y0, op.y1, !!op.forced, op.bare !== false, op.reach || 0);
    }
    function placeWindow(f, k, shop, u0, u1, v0, v1, forced, bare, reach) {
          const tm = (u0 + u1) / 2;
          const nMod = Math.max(1, Math.round((u1 - u0) / 1.45));
          const mw = (u1 - u0) / nMod;
          const tall = (v1 - v0) > 1.75;
          const vT = tall ? v1 - Math.min(0.55, (v1 - v0) * 0.26) : v1;
          const nOut = f.out * (f.halfN - GIN);
          const rec = { parts: [], shattered: false, mesh: null,
            x: o.ox + (f.horiz ? tm * f.tx : nOut), y: o.gy + (v0 + v1) / 2,
            z: o.oz + (f.horiz ? nOut : tm * f.tz), span: (u1 - u0) / 2,
            hh: (v1 - v0) / 2, horiz: !!f.horiz, mat: null };
          for (let m = 0; m < nMod; m++) {
            const a = u0 + m * mw, bb = a + mw;
            glass(f, a, bb, v0, vT, 0x51 + m + k * 7, rec, shop);
            if (tall) glass(f, a, bb, vT, v1, 0x91 + m + k * 7, rec, shop);
          }
          panes.push(rec);
          if (o.list) o.list.push(rec);
          // the hole, in the wall's own axis (local x on faces 0/1, z on 2/3)
          const ta = u0 * (f.horiz ? f.tx : f.tz), tb = u1 * (f.horiz ? f.tx : f.tz);
          holes.push({ s: f.s, a0: Math.min(ta, tb), a1: Math.max(ta, tb), y0: v0, y1: v1, forced: !!forced, reach: reach || 0 });
          // ---- the frame, laid through the deco merge after the cut ------
          const fb = function (t, y, len, hh, proj, col) {
            const n = f.halfN + proj / 2;
            if (f.horiz) frames.push([t * f.tx, y, f.out * n, len, hh, proj, col]);
            else frames.push([f.out * n, y, t * f.tz, proj, hh, len, col]);
          };
          const fc = shop ? 0x2a2a2c : o.frameCol;
          fb(tm, v1 - FW / 2, u1 - u0, FW, FP, fc);
          fb(tm, v0 + FW / 2, u1 - u0, FW, FP, fc);
          fb(u0 + FW / 2, (v0 + v1) / 2, FW, v1 - v0, FP, fc);
          fb(u1 - FW / 2, (v0 + v1) / 2, FW, v1 - v0, FP, fc);
          for (let m = 1; m < nMod; m++) fb(u0 + m * mw, (v0 + v1) / 2, FW * 1.2, v1 - v0, FP, fc);
          if (tall) fb(tm, vT, u1 - u0, FW, FP, fc);
          if (shop && bare) {
            fb(tm, v0 / 2, (u1 - u0) + 0.1, v0, 0.07, 0x3b3a38);
          } else if (bare) {
            fb(tm, v0 - 0.045, (u1 - u0) + 0.16, 0.09, 0.13, o.sillCol);
            fb(tm, v0 - 0.12, (u1 - u0) + 0.04, 0.06, 0.035, o.sillStain);
          }
    }

    // ---- THE CUT: every opening goes through the cladding and the wall ----
    // (city/facade_openings.js cutRecs: the grammar's glass box out of the
    // opening through its whole depth, the skin laid against the wall out of
    // it where it lies in the wall's plane, forced openings through every
    // layer laid against the wall)
    if (holes.length && FOP) {
      FOP.cutRecs(o.recs, holes.map(function (h) { return { s: h.s, t0: h.a0, t1: h.a1, y0: h.y0, y1: h.y1, forced: h.forced, reach: h.reach }; }),
        { w: o.w, d: o.d, wt: WT_, isGlass: o.isGlass || isGlassHex });
      if (o.walls) for (const wl of o.walls) cutWall(wl, holes.filter(function (h) { return h.s === wl.face; }));
    }
    for (const fr of frames) o.dbox(fr[0], fr[1], fr[2], fr[3], fr[4], fr[5], fr[6]);

    // ---- merge each kind into one mesh ----------------------------------
    const meshes = {};
    for (const K in kinds) {
      const k = kinds[K];
      if (!k.i.length) continue;
      const g2 = new THREE_.BufferGeometry();
      g2.setAttribute("position", new THREE_.Float32BufferAttribute(k.p, 3));
      g2.setAttribute("normal", new THREE_.Float32BufferAttribute(k.n, 3));
      g2.setAttribute("color", new THREE_.Float32BufferAttribute(k.c, 3));
      g2.setIndex(k.i);
      g2.computeBoundingSphere();
      const m = new THREE_.Mesh(g2, G[K]);
      m.castShadow = false; m.receiveShadow = K === "room";
      if (K === "glass") m.renderOrder = 2;
      m.name = "island-glass-" + K;
      o.group.add(m);
      meshes[K] = { mesh: m, orig: Float32Array.from(k.p) };
    }
    for (const rec of panes) {
      // the pane's own glass material: what its shards are made of
      rec.mat = meshes.glass ? meshes.glass.mesh.material : null;
      rec.hide = function () {
        for (const pt of rec.parts) {
          const mm = meshes[pt.K]; if (!mm) continue;
          const pa = mm.mesh.geometry.attributes.position, arr = pa.array, v = pt.v * 3;
          for (let q = 1; q < 4; q++) { arr[v + q * 3] = arr[v]; arr[v + q * 3 + 1] = arr[v + 1]; arr[v + q * 3 + 2] = arr[v + 2]; }
          pa.needsUpdate = true;
        }
      };
      rec.show = function () {
        for (const pt of rec.parts) {
          const mm = meshes[pt.K]; if (!mm) continue;
          const pa = mm.mesh.geometry.attributes.position, v = pt.v * 3;
          for (let q = 0; q < 12; q++) pa.array[v + q] = mm.orig[v + q];
          pa.needsUpdate = true;
        }
      };
    }
    // the openings themselves, for the interior finish (the plaster skin on
    // the room side is cut by exactly the holes the wall was cut by)
    panes.holes = holes;
    return panes;
  }

  // THE SOLID PART OF A RECTANGLE WITH HOLES IN IT: city/facade_openings.js
  function solidRects(a0, a1, y0, y1, hs) { return CBZ.facadeOpenings.solidRects(a0, a1, y0, y1, hs); }

  /* CUT A WALL. wl: { mesh, face (0:-z 1:+z 2:-x 3:+x), lx, ly, lz, bw, bh,
     bd } — a shell wall box in its building's local frame. Its geometry is
     rebuilt as the wall MINUS the openings (a grid over the hole edges, solid
     cells merged into runs, then runs merged down the rows), so the reveals
     are real faces and the sun comes in through them. The collider is left
     whole on purpose: glass is not a doorway. geometry.parameters is kept as
     the original box's, because the tsunami picks walls to tear off by it. */
  function cutWall(wl, hs) {
    if (!hs.length || !wl.mesh) return;
    const horiz = wl.face < 2;
    const a0 = horiz ? wl.lx - wl.bw / 2 : wl.lz - wl.bd / 2, a1 = horiz ? wl.lx + wl.bw / 2 : wl.lz + wl.bd / 2;
    const y0 = wl.ly - wl.bh / 2, y1 = wl.ly + wl.bh / 2;
    if (!hs.some(function (h) { return h.a1 > a0 + 0.01 && h.a0 < a1 - 0.01 && h.y1 > y0 + 0.01 && h.y0 < y1 - 0.01; })) return;
    const rects = solidRects(a0, a1, y0, y1, hs);
    // the wall as it now stands, for the dressing's no-shared-plane pass
    wl.pieces = rects.map(function (r) {
      return horiz ? [r[0], r[1], r[2], r[3], wl.lz - wl.bd / 2, wl.lz + wl.bd / 2]
                   : [wl.lx - wl.bw / 2, wl.lx + wl.bw / 2, r[2], r[3], r[0], r[1]];
    });
    const geos = [];
    const th = horiz ? wl.bd : wl.bw;
    for (const r of rects) {
      const ra0 = r[0], ra1 = r[1], ry0 = r[2], ry1 = r[3];
      const g2 = horiz ? new THREE.BoxGeometry(ra1 - ra0, ry1 - ry0, th) : new THREE.BoxGeometry(th, ry1 - ry0, ra1 - ra0);
      const ca = (ra0 + ra1) / 2 - (horiz ? wl.lx : wl.lz), cy = (ry0 + ry1) / 2 - wl.ly;
      if (horiz) g2.translate(ca, cy, 0); else g2.translate(0, cy, ca);
      geos.push(g2);
    }
    const BGU = THREE.BufferGeometryUtils;
    if (!geos.length || !BGU || !BGU.mergeBufferGeometries) return;
    const merged = BGU.mergeBufferGeometries(geos, false);
    for (const g2 of geos) g2.dispose();
    if (!merged) return;
    merged.parameters = { width: wl.bw, height: wl.bh, depth: wl.bd };
    wl.mesh.geometry.dispose();
    wl.mesh.geometry = merged;
  }

  // o: { group, ox, oz, gy, w, d, storeys, fh, wt, rTop, pp, doorSide, color,
  //      style, plats, shell (buckets from the shell builder), glass list,
  //      doorHalf, walls (shell wall meshes the glazing cuts windows through),
  //      liftShaft (a tower's shaft rect: see THE LIFT TOP) }
  // Returns { def, lift }: lift is CBZ.facadeLiftTop's answer, or null.
  function dressIslandFacade(o) {
    const THREE = window.THREE;
    const mat = CBZ.mat;
    // every deco box as a RECORD, local [x,y,z,w,h,d,col], so the glazing pass
    // can cut window openings through the cladding before anything is built;
    // the list keeps the order the boxes were laid (the coplanar pass gives
    // a shared plane to the box laid last)
    const recs = [];
    const colOrder = [];
    const seenCol = new Set();
    const group = o.group, ox = o.ox, oz = o.oz, gy = o.gy;
    const dressed = !!(CBZ.dressFacade && o.style && !(CBZ.CONFIG && CBZ.CONFIG.SURV_FACADES === false));

    /* THE LOT LINE. A grammar's entrance is real architecture and it is
       deep (a terrace and a flight of steps 4 m off the wall, a stylobate
       6 m, a tower's granite plaza 16 m: city/facade_kit.js facadeReach).
       A building stands on its own lot (world/island_plan.js), so o.fence —
       the lot in the building's own frame — clips every piece the grammar
       lays: a box is cut at the lot line, a round piece past it is dropped.
       Nothing the facade builds lands on the sidewalk or the neighbour. */
    const F = o.fence || null;
    function fenceClip(x0, x1, z0, z1) {
      if (!F) return [x0, x1, z0, z1];
      if (x0 < F.x0) x0 = F.x0; if (x1 > F.x1) x1 = F.x1;
      if (z0 < F.z0) z0 = F.z0; if (z1 > F.z1) z1 = F.z1;
      return (x1 - x0 < 0.005 || z1 - z0 < 0.005) ? null : [x0, x1, z0, z1];
    }
    function inFence(x0, x1, z0, z1) { return !F || (x0 >= F.x0 - 1e-3 && x1 <= F.x1 + 1e-3 && z0 >= F.z0 - 1e-3 && z1 <= F.z1 + 1e-3); }
    function dbox(lx, ly, lz, bw, bh, bd, col) {
      if (!(bw > 0) || !(bh > 0) || !(bd > 0)) return;
      if (!Number.isFinite(lx + ly + lz + bw + bh + bd)) return;
      if (F) {
        const c = fenceClip(lx - bw / 2, lx + bw / 2, lz - bd / 2, lz + bd / 2);
        if (!c) return;
        lx = (c[0] + c[1]) / 2; bw = c[1] - c[0]; lz = (c[2] + c[3]) / 2; bd = c[3] - c[2];
      }
      const key = col >>> 0;
      if (!seenCol.has(key)) { seenCol.add(key); colOrder.push(key); }
      recs.push([lx, ly, lz, bw, bh, bd, key]);
    }
    // the shell's own merge-able pieces (treads, slabs, landings) join the
    // deco merge, so they cost one draw call per colour
    if (o.shellMerge) for (const it of o.shellMerge) {
      const g2 = new THREE.BoxGeometry(it[3], it[4], it[5]);
      g2.deleteAttribute("uv");
      g2.translate(it[0], it[1], it[2]);
      it.push(g2);
    }
    function addMesh(geo, col, lx, ly, lz, emissive) {
      const m = new THREE.Mesh(geo, emissive ? mat(col, { emissive: col, ei: 0.8 }) : finishMat(col, gy));
      m.position.set(lx, ly, lz);
      m.castShadow = !emissive; m.receiveShadow = true;
      group.add(m);
      return m;
    }

    // the host's numbers (world/island_building.js: the SAME ctx the shell
    // plan probed the crown with before the stairs were laid), plus emitters
    const ctx = Object.assign(IB.facadeCtx(o), {
      dbox: dbox,
      // A facade never needs a collider on this island — the arena's own walls
      // already carry them — so lbox is deliberately the deco path too.
      lbox: function (lx, ly, lz, bw, bh, bd, col) { dbox(lx, ly, lz, bw, bh, bd, col); },
      plat: function (lx0, lx1, lz0, lz1, top, ramp) {
        if (F) { const c = fenceClip(lx0, lx1, lz0, lz1); if (!c) return; lx0 = c[0]; lx1 = c[1]; lz0 = c[2]; lz1 = c[3]; }
        const p = { minX: ox + lx0, maxX: ox + lx1, minZ: oz + lz0, maxZ: oz + lz1, top: gy + top };
        if (ramp) {
          p.ramp = { z0: oz + ramp.z0, z1: oz + ramp.z1, y0: gy + ramp.y0, y1: gy + ramp.y1 };
        }
        CBZ.platforms.push(p); if (o.plats) o.plats.push(p);
      },
      ball: function (lx, ly, lz, r, col) { if (inFence(lx - r, lx + r, lz - r, lz + r)) addMesh(new THREE.SphereGeometry(r, 10, 7), col, lx, ly, lz); },
      column: function (lx, ly, lz, r, h, col, seg) {
        if (inFence(lx - r, lx + r, lz - r, lz + r)) addMesh(new THREE.CylinderGeometry(r, r, h, seg || 12), col, lx, ly + h / 2, lz);
      },
      cone: function (lx, ly, lz, r, h, col) { if (inFence(lx - r, lx + r, lz - r, lz + r)) addMesh(new THREE.ConeGeometry(r, h, 14), col, lx, ly + h / 2, lz); },
      dome: function (lx, ly, lz, r, col) {
        if (inFence(lx - r, lx + r, lz - r, lz + r)) addMesh(new THREE.SphereGeometry(r, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), col, lx, ly, lz);
      },
      lamp: function (lx, ly, lz, r, col) { if (inFence(lx - r, lx + r, lz - r, lz + r)) addMesh(new THREE.SphereGeometry(r, 8, 6), col, lx, ly, lz, true); },
      disc: function () {},                 // clock faces: civic only, not here
      plaque: function () {}, seal: function () {},
    });

    /* THE LIFT TOP. A tower's lift shaft is handed to the kit BEFORE the
       grammar runs: the kit dry-runs the grammar, finds the top of the crown's
       mass over the shaft, and says which volume the real build must leave
       hollow so the car can get there (city/facade_kit.js, KEEP-CLEAR COLUMNS). */
    let lift = null;
    // a roof kept clear (the helipad tower's) is clear for the lift probe too:
    // with no crown over the shaft the lift's top stop is the roof itself
    if (dressed && o.keepClear) ctx.keepClear = o.keepClear.slice();
    if (dressed && o.liftShaft && CBZ.facadeLiftTop) {
      try {
        lift = CBZ.facadeLiftTop(ctx, o.liftShaft, { ring: 1.2 });
        ctx.keepClear = lift.keepClear;
      } catch (e) { lift = null; }
    }
    if (dressed && o.keepClear) ctx.keepClear = (ctx.keepClear || []).concat(o.keepClear);
    const def = dressed ? CBZ.dressFacade(ctx) : null;
    if (!def) lift = null;

    // ---- the windows, read off what the grammar left open ------------------
    const fh = (CBZ.hash01 ? CBZ.hash01(ox, oz, 0xf4a3) : 0.3);
    // the grammar's own frame colour (facade_kit F.windowFrame) when it named one
    const frameCol = o.frameCol != null ? o.frameCol : ctx.__winFrame != null ? ctx.__winFrame
      : [0xe6e1d6, 0x34312d, 0x6b6f73, 0xe6e1d6, 0x2c3a33][(fh * 5) | 0];
    const panes = glazeBuilding({
      group: group, ox: ox, oz: oz, gy: gy, w: o.w, d: o.d, storeys: o.storeys,
      fh: o.fh, wt: o.wt, doorHalf: o.doorHalf || 1.3, list: o.glassList, recs: recs, walls: o.walls,
      tower: !!o.tower, dbox: dbox, frameCol: frameCol,
      // the grammar's declared glass (F.glass), or a dark cool panel
      isGlass: function (c) { return (ctx.__glass && ctx.__glass.has(c >>> 0)) || isGlassHex(c); },
      sillCol: shadeHex(0xd6cfbf, 0.94 + fh * 0.1),
      sillStain: shadeHex(o.color, 0.72),
    });

    // ---- flush: one mesh per colour ----
    const BGU = THREE.BufferGeometryUtils;
    function flush(geos, m2, cast) {
      if (!geos.length) return null;
      const merged = geos.length > 1 && BGU && BGU.mergeBufferGeometries ? BGU.mergeBufferGeometries(geos) : null;
      if (merged) for (const g2 of geos) g2.dispose();
      const list = merged ? [merged] : geos;
      let last = null;
      for (const g2 of list) {
        last = new THREE.Mesh(g2, m2);
        last.castShadow = !!cast; last.receiveShadow = true;
        group.add(last);
      }
      return last;
    }
    /* NO TWO SURFACES IN ONE PLANE (city/facade_openings.js). The island used
       to settle every tie between two colours' coplanar faces with a
       polygonOffset rank per colour: a depth bias, i.e. the flicker hidden
       under a second layer. Now the faces are moved apart instead (the last
       box laid wins; a face lying in a wall's face is lifted out of it), and
       every material draws at its true depth. */
    if (CBZ.facadeOpenings) {
      const fixed = [];
      if (o.walls) for (const wl of o.walls) {
        if (wl.pieces) for (const pc of wl.pieces) fixed.push(pc);
        else fixed.push([wl.lx - wl.bw / 2, wl.lx + wl.bw / 2, wl.ly - wl.bh / 2, wl.ly + wl.bh / 2, wl.lz - wl.bd / 2, wl.lz + wl.bd / 2]);
      }
      CBZ.facadeOpenings.resolveCoplanar(recs, fixed);
    }
    const byColour = new Map();
    for (const r of recs) {
      const g2 = new THREE.BoxGeometry(r[3], r[4], r[5]);
      g2.deleteAttribute("uv");      // the finish shader works in world space; no map ever reads these
      g2.translate(r[0], r[1], r[2]);
      let list = byColour.get(r[6]);
      if (!list) { list = []; byColour.set(r[6], list); }
      list.push(g2);
    }
    recs.length = 0;

    for (const col of colOrder) {
      const geos = byColour.get(col);
      if (geos) flush(geos, isGlassHex(col) ? glassBoxMat(col) : finishMat(col, gy), false);
    }
    if (o.shellMerge && o.shellMerge.length) {
      const byCol = new Map();
      for (const it of o.shellMerge) {
        const k = it[6] + (it[7] ? "|los" : "");
        let b = byCol.get(k);
        if (!b) { b = { col: it[6], los: it[7], geos: [] }; byCol.set(k, b); }
        b.geos.push(it[8]);
      }
      byCol.forEach(function (b) {
        const m = flush(b.geos, finishMat(b.col, gy), b.los);
        if (m && b.los) CBZ.losBlockers.push(m);
      });
    }
    // holes: every window opening cut through the shell (building-local,
    // {s, a0, a1, y0, y1}); crown: every box the grammar stood on the roof
    // ([x0,x1,y0,y1,z0,z1]), so the host keeps its roof plant out of it
    return { def: def, lift: lift, holes: (panes && panes.holes) || [],
      crown: (ctx.crown && ctx.crown.boxes) || [], crownsRoof: !!(def && def.crownsRoof) };
  }

  /* SHELL PIECES QUEUED AFTER THE FACADE FLUSH (a tower's crown deck, a
     house's roof bulkhead): one more merged mesh per colour, same finish. */
  function flushLateShell(group, shellMerge, gy) {
    const late = new Map();
    for (const it of shellMerge) {
      if (it.length !== 8) continue;              // already flushed with the facade
      const k = it[6] + (it[7] ? "|los" : "");
      let bk = late.get(k);
      if (!bk) { bk = { col: it[6], los: it[7], geos: [] }; late.set(k, bk); }
      const g2 = new THREE.BoxGeometry(it[3], it[4], it[5]);
      g2.deleteAttribute("uv");
      g2.translate(it[0], it[1], it[2]);
      bk.geos.push(g2);
      it.push(null);                               // flushed: never twice
    }
    const BGU = THREE.BufferGeometryUtils;
    late.forEach(function (bk) {
      const geo = bk.geos.length > 1 && BGU ? BGU.mergeBufferGeometries(bk.geos) : bk.geos[0];
      if (geo !== bk.geos[0]) for (const g2 of bk.geos) g2.dispose();
      const m = new THREE.Mesh(geo, finishMat(bk.col, gy));
      m.castShadow = true; m.receiveShadow = true;
      group.add(m);
      if (bk.los) CBZ.losBlockers.push(m);
    });
  }

  /* THE BUILD IS ONE SYNCHRONOUS BLOCK, SO IT REPORTS ON ITSELF.

     systems/bootprogress.js draws the loading percentage on a WORKER thread
     precisely so it keeps counting while the main thread is stuck inside a
     build like this one — but every CBZ.bootStep() checkpoint in the repo was
     written for the CITY (city/world.js, city/worldmap.js, city/mode.js). The
     island had none, so pressing PLAY on the disaster game froze behind a bar
     with one segment and no idea how far along it was. On a desktop that is
     three seconds of vagueness. On the phone this build is FOR, it is the
     first thing the player ever sees.

     Six checkpoints at the boundaries that actually cost time. The meter
     weights each one by how long it took last time ON THIS DEVICE, so the
     second launch on the player's phone is accurate about the player's phone
     rather than about the machine this was written on. */
  CBZ.buildDisasterArena = function () {
    if (arena) return arena;
    const S = CBZ.SURV.arena;
    const cx = S.cx, cz = S.cz, R = S.radius;
    _s = 20240531;

    const root = new THREE.Group();
    CBZ.scene.add(root);
    const mat = CBZ.mat;

    /* ---- THE PLAN (world/island_plan.js) --------------------------------
       The island is laid out as a town before a single mesh is made: the
       plain, the ghaut, the harbour, the streets, every lot and what stands
       on it, every parked car, every moored boat. This file builds what the
       plan says. The facade registry is read first because the plan decides
       which grammar each lot wears (by district and storey range). */
    const facadeIds = CBZ.facadeList
      ? CBZ.facadeList().map(function (f) { return f.id; }).sort() : [];
    const facTall = {}, facLow = {};
    for (const id of facadeIds) {
      const def = CBZ.facadeDef && CBZ.facadeDef(id);
      if (!def) continue;
      if (def.minStoreys > 0) facTall[id] = def.minStoreys;
      if (def.maxStoreys && def.maxStoreys !== Infinity) facLow[id] = def.maxStoreys;
    }
    const PLAN = CBZ.islandPlan
      ? CBZ.islandPlan.make({ cx: cx, cz: cz, R: R, facades: facadeIds, tall: facTall, low: facLow })
      : null;

    // pull addBox results into the arena group (keeps world transform; root @ origin)
    function box(x, y, z, w, h, d, color, opts) {
      const m = CBZ.addBox(x, y, z, w, h, d, color, opts);
      root.add(m);
      return m;
    }

    /* ---- THE ISLAND'S SKIN: one shared detail-texture law -------------------
       The ground was flat hexes — 0x53a84e grass, 0xe6d49a sand, 0x33363d
       asphalt — and because this pipeline treats a hex as LINEAR and grades
       it bright, the grass photographed near-white mint and the beach cream.
       Now every ground surface is (a) a VERTEX COLOUR that is the real linear
       albedo of the thing, varied across the island by low-frequency noise
       (lush, olive and sun-dried grass; dry, damp and wet sand), times (b)
       one of world/textures_surface.js's tiling colour maps, NORMALISED to
       average 1.0 (material.color = 1 / the map's mean linear colour), so the
       map adds grain — blades, sand ripples, aggregate — without moving the
       colour the vertex authored. UVs are world metres / tile, so a tile is
       the same size on the grass, the hills and the volcano. With textures
       off (tier 0), surfaceMaps answers null, the colour stays white and the
       vertex colours alone are still the right island. */
    const h01g = CBZ.hash01 || function () { return 0.5; };
    function vnoise(x, z, cell, salt) {
      const gx = x / cell, gz = z / cell, ix = Math.floor(gx), iz = Math.floor(gz);
      const fx = gx - ix, fz = gz - iz, ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
      const a = h01g(ix, iz, salt), b = h01g(ix + 1, iz, salt), c = h01g(ix, iz + 1, salt), d = h01g(ix + 1, iz + 1, salt);
      return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
    }
    function fbm2(x, z, cell, salt) {
      return vnoise(x, z, cell, salt) * 0.6 + vnoise(x, z, cell * 0.43, salt + 7) * 0.28 + vnoise(x, z, cell * 0.17, salt + 13) * 0.12;
    }
    const _mapMean = new Map();
    function mapMean(tex) {
      if (_mapMean.has(tex)) return _mapMean.get(tex);
      let out = [1, 1, 1];
      try {
        const img = tex.image, N = img.width;
        const d = img.getContext("2d").getImageData(0, 0, N, N).data;
        const s2l = function (v) { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
        let r = 0, g = 0, b = 0, n = 0;
        for (let i = 0; i < d.length; i += 4 * 7) { r += s2l(d[i]); g += s2l(d[i + 1]); b += s2l(d[i + 2]); n++; }
        out = [r / n, g / n, b / n];
      } catch (e) { /* headless: no canvas pixels — leave the map un-normalised */ }
      _mapMean.set(tex, out);
      return out;
    }
    // a Lambert that wears `surface`'s colour map, normalised to mean 1
    function skinMat(surface, extra) {
      const m = new THREE.MeshLambertMaterial(Object.assign({ color: 0xffffff, vertexColors: true }, extra || {}));
      const maps = CBZ.surfaceMaps ? CBZ.surfaceMaps(surface, { repeat: 1 }) : null;
      if (maps && maps.map) {
        m.map = maps.map;
        const mean = mapMean(maps.map);
        m.color.setRGB(1 / Math.max(0.02, mean[0]), 1 / Math.max(0.02, mean[1]), 1 / Math.max(0.02, mean[2]));
      }
      return m;
    }
    // world-metre planar UVs for a geometry already in world XZ (+ offset)
    function worldUV(g, tile, ox, oz, toWorld) {
      const p = g.attributes.position, uv = new Float32Array(p.count * 2);
      const w = { x: 0, z: 0 };
      for (let i = 0; i < p.count; i++) {
        toWorld(p, i, w);
        uv[i * 2] = (w.x + ox) / tile; uv[i * 2 + 1] = (w.z + oz) / tile;
      }
      g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    }
    /* THE GRASS, as a linear albedo at a world point. Tropical turf: a deep
       lush green, olive patches, and a few sun-dried straw patches, over a
       fine mottle. Shared by the plain, the hills and the volcano's skirt, so
       the three never disagree at a seam. `edge` 0..1 blends toward the sandy
       fringe where the grass gives out onto the beach. */
    const GR_LUSH = [0.040, 0.085, 0.020], GR_OLIVE = [0.062, 0.085, 0.024], GR_DRY = [0.120, 0.108, 0.045];
    const GR_SANDY = [0.150, 0.125, 0.070];
    function grassColorAt(x, z, out) {
      const olive = fbm2(x, z, 38, 0x6a01);
      const dry = Math.max(0, Math.min(1, (fbm2(x + 71, z - 13, 29, 0x6a02) - 0.58) * 4.2));
      const mott = 0.84 + 0.32 * vnoise(x, z, 2.3, 0x6a03);
      const o = Math.max(0, Math.min(1, (olive - 0.35) * 2.2));
      for (let k = 0; k < 3; k++) {
        let v = GR_LUSH[k] + (GR_OLIVE[k] - GR_LUSH[k]) * o;
        v += (GR_DRY[k] - v) * dry * 0.85;
        out[k] = v * mott;
      }
      const dist = Math.hypot(x - cx, z - cz);
      const e = Math.max(0, Math.min(1, (dist - (R - 7)) / 7));
      if (e > 0) { const s = e * e * (3 - 2 * e); for (let k = 0; k < 3; k++) out[k] += (GR_SANDY[k] * mott - out[k]) * s * 0.85; }
      return out;
    }
    const GRASS_TILE = 3.2;
    /* THE TILE WAS A CHECKERBOARD (one 3.2 m repeat of a clumpy map is a grid
       you can count from a boat). The fix that lived here, a second rotated
       read of the same map, is now the shared ground material
       (world/textures_surface.js CBZ.groundSkin), which the Gang Life
       backcountry wears too: grass / soil / sand / stone detail by what the
       vertex colour is, anti-tiled, normalised to mean 1. The island keeps
       its full map chroma and a half-strength patch mottle over its own. */
    const grassMat = CBZ.groundSkin
      ? CBZ.groundSkin({ name: "survival-grass", tile: { grass: GRASS_TILE }, chroma: 1, mottle: 0.5, far: 300, sandY: [-0.4, -0.05] })
      : skinMat("grass");
    grassMat.name = "survival-grass";

    // ---- hills / mountain (the high-ground height field) ----
    // hills[0] is the volcano; the plan puts it north-west of the town with
    // its breach facing the harbour (the old island stood it dead centre)
    const hills = PLAN
      ? PLAN.hills.map(function (h) { return { x: h.x, z: h.z, r: h.r, peak: h.peak }; })
      : [
        { x: cx, z: cz, r: 36, peak: 30 },
        { x: cx - 52, z: cz - 30, r: 20, peak: 9 },
        { x: cx + 48, z: cz + 40, r: 22, peak: 11 },
        { x: cx + 40, z: cz - 48, r: 16, peak: 7 },
      ];
    /* ---- THE VOLCANO IS THE MOUNTAIN, NOT A CONE WITH LAVA ON IT --------
       hills[0] is the island's refuge AND the thing that erupts. ONE function,
       volcanoHeightAt, is read by BOTH the mesh below and CBZ.floorAt (via
       groundHeightAt), so the walkable field is the drawn surface to the
       millimetre — crater, breach and barrancos included.

       2026-09-27, OWNER: "when a volcano looks dumb". Photographed from the
       town the old field was a smooth brown BELL: peak * t^1.3 is so close to
       a straight cone that the flanks read as one slope, the rim was a perfect
       circle at one height (a pudding lip), and +-1.15 m of sine corrugation
       on a 64-sector grid under Gouraud shading was invisible past 40 m. What
       makes a stratovolcano read from 150 m, in the order the eye takes it:

         THE PROFILE. Concave, and markedly so: peak * t^1.65 — about 58 deg
         just under the rim, 30 deg at mid flank, a long ~10 deg apron into the
         island plate. Mayon, Fuji and Agua are all this curve (the log
         profile of a pile of ejecta that steepens toward its source). The
         summit is 30 m now (was 26): the mountain is the island's landmark
         and it stood shorter than the town's mid-rise towers.

         THE RIM. Not one height. Three slow harmonics give it a skyline
         (+-1 m), and a BREACH — one sector where the crater wall failed —
         drops it ~2.2 m and carries on down the flank as the biggest valley
         on the mountain. That notch is the single strongest "crater" cue in a
         silhouette. The notch floor stays above the crater floor, so the
         crater is still a bowl (and still far above any tsunami surge).

         THE BARRANCOS. Radial valleys are V-shaped and narrow, ridges between
         them broad and rounded. So the corrugation is ASYMMETRIC: the negative
         lobe is raised to a power (deep, tight valleys), the positive lobe is
         flattened (broad interfluves), +-2.3 m at their deepest, born right
         under the rim and fading to nothing at the base — the island plate
         still meets the skirt flush and nothing outside r = 36 moves. A finer
         31st harmonic cuts rills into the steep upper cone. lavaFlow's fall
         line hunts the lowest probe, so the flows now come down IN these.

       Deterministic: the only randomness is CBZ.hash01 off the mountain's
       own fixed centre, so the island stays byte-identical per seed. */
    const VOL = hills[0];
    VOL.volcano = true;
    /* Every crater and gully number below was authored on the r 36 / 30 m
       cone; the cone is r 82 / 62 m on the twice-size island, so they scale
       with it (VK) and the mountain keeps its proportions. */
    const VK = VOL.r / 36;
    const VOL_RIM = 6.2 * VK;               // crater rim radius (m)
    const VOL_BOWL = 3.6 * VK;              // crater floor, metres below the nominal rim
    const VOL_FLANK = VOL.r - VOL_RIM;      // horizontal run, rim -> base
    const VOL_GULLY = 2.3 * VK;             // barranco depth at its deepest (m)
    const VOL_POW = 1.65;                   // profile concavity
    const VOL_BREACH_D = 2.2 * VK;          // how far the breached sector drops
    const _vh = CBZ.hash01 || function (a, b, s) { return ((s * 0.618034) % 1 + 1) % 1; };
    const VOL_P1 = _vh(VOL.x, VOL.z, 0x5601) * 6.2831853;
    const VOL_P2 = _vh(VOL.x, VOL.z, 0x5602) * 6.2831853;
    const VOL_P3 = _vh(VOL.x, VOL.z, 0x5603) * 6.2831853;
    const VOL_P4 = _vh(VOL.x, VOL.z, 0x5608) * 6.2831853;
    // the breach faces the town side the island is usually seen from
    // (-x / +z, away from the sun), wobbled per seed so it is not ruled
    const VOL_BREACH_A = (PLAN ? PLAN.volcano.breachA : 2.45) + (_vh(VOL.x, VOL.z, 0x5609) - 0.5) * 0.3;
    VOL.rim = VOL_RIM; VOL.bowl = VOL_BOWL; VOL.breach = VOL_BREACH_A;
    function angDiff(a, b) {
      let d = (a - b) % 6.2831853;
      if (d > 3.14159265) d -= 6.2831853; else if (d < -3.14159265) d += 6.2831853;
      return d;
    }
    // the rim's own skyline, in metres about VOL.peak (the notch included)
    function volcanoRimAt(ang) {
      const db = angDiff(ang, VOL_BREACH_A) / 0.34;
      return (0.55 * Math.sin(2 * ang + VOL_P3) + 0.32 * Math.sin(3 * ang + VOL_P4)
        + 0.16 * Math.sin(7 * ang + VOL_P1)) * VK
        - VOL_BREACH_D * Math.exp(-db * db);
    }
    // the gully ENVELOPE: nil at the rim and the base, deepest a third down
    function volcanoGully(d) {
      if (d <= VOL_RIM || d >= VOL.r) return 0;
      const u = (d - VOL_RIM) / VOL_FLANK;      // 0 at the rim, 1 at the base
      return Math.sin(3.14159265 * Math.pow(u, 0.62));
    }
    // the SIGNED corrugation, -1 (valley floor) .. ~+0.45 (ridge crown)
    function volcanoLobe(d, ang) {
      const drift = 0.32 * Math.sin(d * 0.085 / VK);
      const c = 0.62 * Math.sin(12 * ang + VOL_P1 + drift)
              + 0.38 * Math.sin(7 * ang + VOL_P2 - drift * 1.7);
      return c < 0 ? -Math.pow(-c, 1.9) : 0.45 * Math.pow(c, 0.75);
    }
    function volcanoHeightAt(d, ang) {
      if (d >= VOL.r) return 0;
      const rimY = VOL.peak + volcanoRimAt(ang);
      if (d <= VOL_RIM) {
        // the crater: flat-ish floor, steep inner wall up to the ragged rim
        const u = d / VOL_RIM;
        const floorY = VOL.peak - VOL_BOWL;
        return floorY + (rimY - floorY) * Math.pow(u, 2.4);
      }
      const t = (VOL.r - d) / VOL_FLANK;        // 1 at the rim, 0 at the base
      const env = volcanoGully(d);
      // fine rills on the steep upper cone only
      const rill = 0.35 * VK * Math.sin(31 * ang + VOL_P2 * 3 + d * 0.2 / VK) * env * t;
      const h = rimY * Math.pow(t, VOL_POW)
        + env * (VOL_GULLY * volcanoLobe(d, ang) + rill);
      return h > 0 ? h : 0;
    }
    /* ---- SURV_SEABED — THE ISLAND GETS A BOTTOM ---------------------------
       This function used to `return h` — 0 everywhere outside the four cones,
       out to infinity — and CBZ.floorAt (modes/survival.js) is wired straight
       to it. Mean sea is -0.8, so the walkable floor sat 0.8 m ABOVE the sea
       and you walked out onto the ocean and kept going. Worse, everything that
       asks "is there water here" is defined off this height, so the answer
       offshore was NO and city/swim.js — un-gated for survival, fully wired,
       measured idle at `sinkRate 0.85, breathSec 28, swimming false` — could
       never once be entered. The island's headline event is a tsunami and the
       island had no water to swim in.

       THE MODEL IS THE CITY'S, NOT A NEW ONE. city/swim.js's cityBedDepthAt
       synthesises the coastal shelf analytically: signed distance to the shore
       times a slope, capped at a depth. There is no submerged geometry in this
       engine and none is wanted here either. The city's shore field comes from
       waterfield.js because a continent's coast is an arbitrary curve; this
       island's coast is a CIRCLE, so its signed shore distance is one
       Math.hypot and the same shelf falls out for free.

       THE SLOPE IS DELIBERATELY GENTLER THAN THE CITY'S. city/swim.js uses
       1.10 m of depth per metre out and says why: its shore field describes a
       vertical harbour seawall as well as a beach, so a wide synthetic shelf
       would let you "stand" in open water beside a quay. This island has no
       seawalls — it is beach the whole way round — so that constraint does not
       apply and honouring it would give a 1.2 m wade band, i.e. a cliff edge
       with sand painted on it. 0.34 (about 1:3, a real fringing-reef profile)
       puts the swim threshold ~4 m past the waterline: you walk in, the water
       climbs you, and then it has you. DEEP caps the column where the
       underwater treatment has long since faded to black anyway.

       `?cfg_SURV_SEABED=0` restores the flat floor — and the walk-on-water. */
    const SHELF_SLOPE = 0.34;          // m of depth per m past the shore band
    /* SURV_BEACH_V2 — THE BEACH BECOMES A SHORE, NOT A STRIPE (2026-08-16).
       The old coast was an 8 m flat sand annulus at y=-0.02 whose outer rim
       simply stopped where the shelf began: a ring with sand painted on it.
       V2 widens the band to 26 m and gives it the one thing a beach IS — a
       PROFILE: the flat grass edge, a low wave-built berm at the top of the
       swash, then a foreshore that walks you down THROUGH the waterline and
       keeps falling until the shelf takes over. groundHeightAt and the drawn
       ring read the SAME function, so the bottom you see is the bottom you
       stand on (the doctrine two comments below already enforces for the
       seabed). Sand below the waterline is real wadable foreshore — the
       water climbs you for ~14 m before city/swim.js takes over — a
       fringing beach, not a cliff edge with sand painted on it.
       ?cfg_SURV_BEACH_V2=0 → the old 8 m stripe and shelf, byte for byte. */
    if (CBZ.CONFIG.SURV_BEACH_V2 == null) CBZ.CONFIG.SURV_BEACH_V2 = true;
    const BEACH2 = CBZ.CONFIG.SURV_BEACH_V2 !== false && CBZ.CONFIG.SURV_SEABED !== false;
    const BEACH_W = BEACH2 ? 26 : 8;   // grass edge → shelf handoff
    const SHORE_R = R + BEACH_W;       // where the shelf takes over from the beach
    const FORE_DROP = BEACH2 ? 1.9 : 0; // depth the foreshore has reached by SHORE_R
    /* ---- THE SHELF WAS A SANDBAR ------------------------------------------
       The old profile was ONE straight 0.34 slope capped at 34 m, which meant
       the whole ring a shark-sim player actually swims in — 20 to 60 m off the
       beach — sat under three to twelve metres of water. world/water_
       underwater.js grades the colour of the medium off exactly that number
       (its `basin` term is smoothstep(2, 40, bedDepth)), so the entire game
       was played at basin ~= 0.05: flat pale turquoise, everywhere, at every
       depth. The grade was not broken; it was being fed a sandbar.

       A real fringing shelf does not fall at a constant rate. It has a gentle
       surf-zone ramp, then a distinct break where the slope steepens, then a
       long uniform fall to the shelf edge. So: the first SHELF_KNEE metres past
       the beach keep the ORIGINAL 0.34 exactly (r <= 150 — the near-shore
       profile the shark's shore-blocking is calibrated against is byte-for-byte
       untouched), the slope then eases up to SHELF_DEEP over SHELF_RAMP metres,
       and holds until DEEP.

       Measured off the function below: 30 m offshore = 9.1 m of water (was
       3.7), 60 m = 22 m (was 9.6), and the outer ring bottoms out at 62 m
       around r 241 instead of 34 m — the same cap the city's own shelf uses,
       so `medium()` sees the same range of water column in both worlds. */
    const DEEP = 62;                   // m — the shelf stops falling here (r ~241)
    const SHELF_KNEE = 4;              // m past SHORE_R the original slope holds (r <= 150)
    const SHELF_RAMP = 9;              // m over which the slope eases to its deep value
    const SHELF_DEEP = 0.66;           // m of depth per m out, past the break
    /* ---- THE FAR COAST: THE SEA ENDS IN SAND, NOT IN A FENCE --------------
       OWNER: "the pen should be land and beach like there is on the island,
       real fucking pen." The sea used to end in an invisible navigator wall
       (water_survival.js) — first at radius+150, then pushed to ~3 km, but
       still a wall: the shark stopped in 62 m of open water for no reason a
       player could see. Now the reason is VISIBLE and PHYSICAL: at FAR_WL the
       bed climbs back out of the abyssal plain through the same foreshore
       profile as the island's own beach (1.9 m over 26 m — the exact surf
       slope every species clearance and the ride's grounding law were tuned
       against), crosses a real waterline, and rises into low dunes. A shark
       that swims out far enough runs aground on sand it can see, exactly as
       it does at the island; a big enough surge floods the far beach and
       opens it, exactly as it does the island's.

       Everything below reads this through the ONE height function, so the
       far coast is simultaneously drawn (the bed mesh), walked (ground
       oracle), and navigated (survFloodDepthMeanAt goes to zero there, which
       is what the island mover's shore law runs on) — no second fence to
       keep in step. */
    const FAR_WL = R + 2400;           // the far coast's waterline radius — THE SIZE OF THE SEA
    const FAR_FORE = 26;               // its foreshore width — the island's own
    const FAR_RISE = 0.66;             // underwater climb toward it, mirror of SHELF_DEEP
    const FAR_TOUCH = FAR_FORE + (DEEP - FORE_DROP) / FAR_RISE;  // ~117 m out: where the climb leaves the plain
    const DUNE_H = 7;                  // dune crest height above mean sea
    const DUNE_W = 150;                // m of dry sand from waterline to crest
    // Height at `e` metres SEAWARD of the far waterline (negative e = up the
    // far beach). Slope is continuous through the waterline (0.073 both
    // sides), so the shore reads as one surface, not a crease.
    function farCoastAt(e) {
      if (e > FAR_FORE) return -Math.min(DEEP, FORE_DROP + (e - FAR_FORE) * FAR_RISE);
      if (e >= 0) return -e * (FORE_DROP / FAR_FORE);
      const b = -e;                    // metres inland of the far waterline
      if (b <= FAR_FORE) return b * (FORE_DROP / FAR_FORE);
      const s = Math.min(1, (b - FAR_FORE) / (DUNE_W - FAR_FORE));
      return FORE_DROP + (DUNE_H - FORE_DROP) * (s * s * (3 - 2 * s));
    }
    // Metres of water over the bed `d` metres past SHORE_R. The ramp is the
    // integral of a smoothstep between the two slopes, so the profile is C1 —
    // no visible crease in the drawn bed where the break happens.
    function shelfDepth(d) {
      const flat = FORE_DROP + d * SHELF_SLOPE;
      const u = d - SHELF_KNEE;
      if (u <= 0) return Math.min(flat, DEEP);
      const s = u / SHELF_RAMP;
      const add = s >= 1 ? SHELF_RAMP * 0.5 + (u - SHELF_RAMP)
        : SHELF_RAMP * (s * s * s - s * s * s * s * 0.5);
      return Math.min(flat + (SHELF_DEEP - SHELF_SLOPE) * add, DEEP);
    }
    // the whole coast as one function of distance-from-centre: 0 on the grass,
    // berm + foreshore across the beach band, then the linear shelf. Every
    // consumer — physics, the drawn shore ring, the drawn seabed ring — reads
    // THIS, which is what keeps drawn and walked from ever being two surfaces.
    function coastHeightAt(dist) {
      // past the abyssal plain the FAR coast owns the height — including
      // every radius beyond it, so the world's edge is land, never water
      const e = FAR_WL - dist;
      if (e < FAR_TOUCH) return farCoastAt(e);
      const d = dist - SHORE_R;
      if (d > 0) return -shelfDepth(d);
      if (!BEACH2) return 0;
      const b = dist - R;              // metres past the grass edge
      if (b <= 0) return 0;
      const t = b / BEACH_W, s = t * t * (3 - 2 * t);
      // the berm: the low ridge waves build at the top of their own swash —
      // a read on every natural beach, not a wall (0.30 peak, gone mid-beach)
      const k = (b - 4.6) / 2.4;
      return 0.30 * Math.exp(-k * k) - FORE_DROP * s;
    }
    function baseSeabedAt(x, z) {
      const dist = Math.hypot(x - cx, z - cz);
      let h = coastHeightAt(dist);
      /* Dune relief on the far coast's DRY sand only — a perfect circle of
         beach reads as a compass rose. Analytic, deterministic, and ZERO at
         and below the waterline band, so every radial water law stays exact
         (survNavRing measures along +X alone and stays honest). Frequencies
         are low on purpose: at r 2400 the bed mesh samples ~118 m arcs, and
         anything faster than these periods would alias into grid moiré. */
      if (h > 0.4 && dist > FAR_WL - FAR_FORE) {
        const a = Math.atan2(z - cz, x - cx);
        const w = Math.sin(a * 5 + 1.7) * 0.55 + Math.sin(a * 13 + 4.2) * 0.30 +
                  Math.sin(a * 29 + 0.6) * 0.15;
        h += w * Math.min(2.4, (h - 0.4) * 0.6);
      }
      return h;
    }
    /* ---- THE ARCHIPELAGO ---------------------------------------------------
       OWNER: "why even make it a pen and not just make there be more islands
       like main island that just spawn past horizon." The verdict on infinite
       vs finite: FINITE — a match is a seeded 10-minute run and every law in
       this sea (the radial nav envelope, the determinism gate, the disaster
       director, the tools) assumes one measurable world; infinity buys a
       session-based mode nothing and costs a streaming rewrite. But the
       FEELING of islands past the horizon is exactly buyable inside a finite
       sea, because island fog is 380 m: islets scattered across 2.3 km of
       open water genuinely emerge from the fog one after another as you swim,
       which IS the fantasy, endlessly cheaper.

       Eleven islets on their OWN rng stream (the island layout stays
       byte-identical), placed by rejection: 520-1980 m out (the first one
       horizon past the fog, the last with its foot well inside the far
       coast's climb), 290 m clear of each other, and 16 degrees clear of the
       +X ray so survNavRing's envelope line never crosses one. Two grow big
       enough for greenery and palms; the rest are sandbar cays. Each wears
       the SAME 1.9 m / 26 m foreshore as every other beach in this sea, so
       the grounding and beaching laws hold on all of them unchanged. */
    const islets = [];
    (function placeIslets() {
      let s3 = 771177;
      const r3 = () => { s3 = (s3 * 1103515245 + 12345) & 0x7fffffff; return s3 / 0x7fffffff; };
      for (let tries = 0; tries < 700 && islets.length < 11; tries++) {
        const ang = r3() * Math.PI * 2;
        // 520 m in — one horizon past the fog (380 m), so the first cay
        // appears just as the island disappears, and there is a next one
        // in reach the whole way out
        const rr = 520 + r3() * 1460;
        const wantBig = islets.filter((i) => i.big).length < 2 && r3() < 0.3;
        const rw = wantBig ? 85 + r3() * 40 : 26 + r3() * 38;
        if (Math.abs(Math.atan2(Math.sin(ang), Math.cos(ang))) < 0.28) continue;
        const x = cx + Math.cos(ang) * rr, z = cz + Math.sin(ang) * rr;
        let ok = true;
        for (const o of islets) if (Math.hypot(o.x - x, o.z - z) < o.rw + rw + 290) { ok = false; break; }
        if (!ok) continue;
        islets.push({ x, z, rw, big: wantBig, peak: wantBig ? 5.5 + r3() * 2 : 1.5 + r3() * 1.1 });
      }
    })();
    // an islet's height at `di` metres from its centre: interior dome down
    // through the standard foreshore, then a 0.6 fall to the abyssal plain
    function isletHeightAt(it, di) {
      const b = it.rw - di;              // + inside its waterline
      if (b < 0) {
        const s = -b;
        return s <= FAR_FORE ? -s * (FORE_DROP / FAR_FORE)
                             : -(FORE_DROP + (s - FAR_FORE) * 0.6);
      }
      const fore = Math.min(FAR_FORE, it.rw * 0.45);
      if (b <= fore) return b * (FORE_DROP / FAR_FORE);
      const t = Math.min(1, (b - fore) / Math.max(1, it.rw - fore));
      const lip = fore * (FORE_DROP / FAR_FORE);
      return lip + (it.peak - lip) * (t * t * (3 - 2 * t));
    }
    function isletFieldAt(x, z) {
      let h = -1e9;
      for (let i = 0; i < islets.length; i++) {
        const it = islets[i];
        const dx = x - it.x, dz = z - it.z, reach = it.rw + 132;
        if (dx > reach || dx < -reach || dz > reach || dz < -reach) continue;
        const v = isletHeightAt(it, Math.hypot(dx, dz));
        if (v > h) h = v;
      }
      return h;
    }
    /* ONE height field, still: physics, the nav depth oracle and the islet
       meshes all read this max. The BIG bed mesh alone draws baseSeabedAt —
       its mid-sea rings run ~50 m and would render a 30 m cay as a four-
       vertex lump, so each islet gets its own fine mesh whose rim tucks
       under the plain (see isletMeshes below). */
    function seabedAt(x, z) {
      const b = baseSeabedAt(x, z);
      const i = isletFieldAt(x, z);
      return i > b ? i : b;
    }
    function groundHeightAt(x, z) {
      let h = 0;
      for (let i = 0; i < hills.length; i++) {
        const hl = hills[i];
        const dx = x - hl.x, dz = z - hl.z;
        const d = Math.hypot(dx, dz);
        if (d >= hl.r) continue;
        // the volcano is a profile with a crater and gullies; the three
        // outlying hills are still plain linear cones
        const hh = hl.volcano ? volcanoHeightAt(d, Math.atan2(dz, dx))
          : hl.peak * (1 - d / hl.r);
        if (hh > h) h = hh;
      }
      /* THE LAND: inside the grass edge, the plan's plain (climbing ~4 m
         inland, the ghaut cut into it, every lot graded to its pad); past
         it the beach, the shelf and the sea floor. Then whatever was MADE
         over it: the quay, the cargo pier, the breakwater. */
      const ddx = x - cx, ddz = z - cz;
      const inside = ddx * ddx + ddz * ddz < R * R;
      if (CBZ.CONFIG.SURV_SEABED === false) {
        if (inside && PLAN) { const l = PLAN.landAt(x, z); if (l > h) h = l; }
      } else {
        const b = inside ? (PLAN ? PLAN.landAt(x, z) : 0) : seabedAt(x, z);
        h = h > 0 ? Math.max(h, b) : b;
      }
      if (PLAN) { const m = PLAN.madeAt(x, z); if (m > h) h = m; }
      return h;
    }

    if (CBZ.bootStep) CBZ.bootStep("island:ground");
    // ---- island ground + ocean ----
    // big ocean plane. Exposed on the descriptor (arena.ocean / arena.oceanY)
    // so the tsunami can pull the whole sea OUT during its warning and surge
    // it back in as the flood — reset() always parks it back at OCEAN_Y.
    const OCEAN_Y = -0.8;
    /* The displaced sheet is 2 km on a side and FOLLOWS THE CAMERA (see the
       47.9 update below) — the sea runs to a real far coast ~2.4 km out
       (FAR_WL / arena.seaR), so a tile parked on the island's centre would
       run out of water long before the sand does. 2048 covers the longest
       fog draw any island weather asks for (volcano dusk, fogFar 2400: the
       rim sits half-fogged over a drawn seabed, not over void). Where the
       far coast rises above the sea, the land simply occludes the sheet —
       the same way the island always has. */
    const OCEAN_SPAN = 2048;
    const sharedWater = !!(CBZ.waterBuildDisasterGeometry && CBZ.makeDisasterWaterMaterial);
    const oceanGeo = sharedWater ? CBZ.waterBuildDisasterGeometry(OCEAN_SPAN)
      : new THREE.PlaneGeometry(OCEAN_SPAN, OCEAN_SPAN);
    const oceanMat = sharedWater ? CBZ.makeDisasterWaterMaterial({
      name: "Survival Ocean Water", color: 0x155878, shallowColor: 0x3195a7,
      amp: 0.86, chop: 0.72, foam: 0.34,
    }) : new THREE.MeshLambertMaterial({ color: 0x2f6f9e });
    const ocean = new THREE.Mesh(oceanGeo, oceanMat);
    if (!sharedWater) ocean.rotation.x = -Math.PI / 2;
    // The shared sea is a camera-centred radial disc (world/water_spec.js
    // re-centres it in the vertex program), so the mesh sits at x = z = 0.
    const oceanRadial = !!(oceanGeo.userData && oceanGeo.userData.waterDisasterGrid && oceanGeo.userData.waterDisasterGrid.radial);
    if (oceanRadial) ocean.position.set(0, OCEAN_Y, 0);
    else ocean.position.set(cx, OCEAN_Y, cz);
    ocean.receiveShadow = false; root.add(ocean);
    ocean.name = "survival-ocean";
    // SEA_TRANSLUCENT: the sea blends now, so it joins the transparent list —
    // pinned first (city/world.js has the same line and the same reason) so it
    // can never be sorted on top of the spray and foam that ride on it.
    ocean.renderOrder = -1;
    ocean.frustumCulled = false;
    ocean.userData.waterSurface = true;
    ocean.userData.surfaceOwner = "survival-water";
    ocean.userData.waterMode = sharedWater ? "shared-disaster-fresnel" : "lambert-fallback";

    /* ---- THE ARENA'S SEA *IS* THE GAME'S SEA (SURV_SHARED_WATER) ----------
       CBZ.waterSurgeSet(m) (world/water_spec.js) is the ONE way water rises in
       this game, and until now the survival island was the one place that did
       not obey it: the tsunami and the flash flood each wrote ocean.position.y
       by hand and then built a SECOND private flood plane on top, so the
       island had two water surfaces and neither of them was the sea.

       Now the ocean plane simply tracks mean sea level plus the live surge,
       every frame, and a disaster's whole job is to move that one number. The
       consequences fall out for free: raising it floods the island (no flood
       sheet to build), CBZ.survSeaHeightAt below answers with the SAME swell
       table the shader displaces by, and city/swim.js can therefore own the
       swimmer here exactly as it does in the city.
       `waveAmp/chopAmp` are mirrored onto the descriptor so the CPU query and
       the GPU displacement can never disagree about how rough the sea is. */
    arenaWave.amp = 0.86; arenaWave.chop = 0.72;
    arena_meanY = function () { return OCEAN_Y + (CBZ.waterSurge ? CBZ.waterSurge() : 0); };
    // 47.9: AFTER the disaster director (28) has set this frame's surge and
    // after swim.js's main pass (45.8) has resolved the swimmer against it,
    // but before the camera (50). Following the surge at 27.85 would have
    // rendered the sea one frame behind the level everything else used — and
    // would have left the mesh a frame high on the tick a tsunami ends.
    /* THE SEA FOLLOWS THE CAMERA. The waves are computed in WORLD space
       (makeDisasterWaterMaterial's vertex stage runs the swell table on
       modelMatrix * position), so translating the mesh never moves a crest —
       but the vertices do slide through the wave field, so the tile snaps to
       its own vertex pitch and the sampling lattice stays put in the world.
       This is what lets a 2 km sheet carry a ~3 km swimmable sea: wherever
       the camera goes, the water under it is real displaced ocean, and the
       rim stays a fog-width away. Reads LAST frame's camera (this runs at
       47.9, the camera moves at 50) — the tile is a kilometre deep on every
       side, so a frame of camera travel is nothing. */
    const oceanGrid = oceanGeo.userData && oceanGeo.userData.waterDisasterGrid;
    const oceanPitch = oceanGrid ? oceanGrid.span / oceanGrid.segments : 16;
    /* THE DRY DISC (water_spec.js uDwDryDisc): the swell under the island
       rose through the plain and the upper beach as flickering stripes. Sink
       the sheet inside the radius where the beach comes down to 0.35 m over
       calm sea, and only while the sea is calm: a flood (surge over half a
       metre) turns it off, because then the water on the island is real. */
    let dryR = R;
    for (let r = R * 0.6; r < R + 60; r += 0.5) { if (groundHeightAt(cx + r, cz) < OCEAN_Y + 0.35) { dryR = r; break; } }
    const dryU = oceanMat.uniforms && oceanMat.uniforms.uDwDryDisc;
    /* THE SHORE FIELD (WATER V3). The island sea had no idea where the land
       was: no surf line, no turquoise over the sand, no caustics in the
       shallows, and the swell striped up the beach until the dry disc was
       invented to sink it. The same four-channel field the city bakes from
       its coastline is baked here from the island's own ground (depth, not
       distance), a slice per frame while the sea is driven, so it never lands
       on the load path. Covers the island and its shelf; past that the sea is
       open water, which is what it is. */
    if (sharedWater && CBZ.waterBakeField && CBZ.waterSetField) {
      CBZ.waterSetField(ocean, CBZ.waterBakeField({
        cx: cx, cz: cz, half: R + 700, size: 512, seaY: OCEAN_Y,
        groundAt: function (x, z) { return groundHeightAt(x, z); },
      }));
    }
    if (CBZ.onUpdate) CBZ.onUpdate(47.9, function () {
      if (!arena || !CBZ.game || !CBZ.islandModeOn(CBZ.game.mode)) return;
      ocean.position.y = arena_meanY();
      if (dryU) {
        const sg = CBZ.waterSurge ? CBZ.waterSurge() : 0;
        dryU.value.set(cx, cz, dryR, 3 * Math.max(0, Math.min(1, 1 - Math.max(0, sg) / 0.5)));
      }
      const cam = CBZ.camera;
      if (cam && !oceanRadial) {
        ocean.position.x = cx + Math.round((cam.position.x - cx) / oceanPitch) * oceanPitch;
        ocean.position.z = cz + Math.round((cam.position.z - cz) / oceanPitch) * oceanPitch;
      }
      if (sharedWater) CBZ.waterDriveDisasterSurface(ocean, arenaWave);
    });

    // the SEABED shelf under the sea: invisible in normal play (the opaque
    // ocean covers it), revealed as a shocking ring of wet sand when the
    // tsunami recedes the ocean below it — the classic dread beat. Its own
    // rng stream so the island layout stays byte-identical.
    let _s2 = 424243;
    const rng2 = () => { _s2 = (_s2 * 1103515245 + 12345) & 0x7fffffff; return _s2 / 0x7fffffff; };
    /* THE BOTTOM YOU SEE IS THE BOTTOM YOU STOP AT. This was a flat disc at a
       fixed y=-1.35 while groundHeightAt now falls to -34 m, so drawn and
       walked would have been two different surfaces 30 m apart — exactly the
       split city/swim.js's note warns about, and the reason the city publishes
       CBZ.citySeaBedYAt for world/terrain_overhaul.js to draw FROM. Same
       discipline here: a ring with real radial subdivision, every vertex
       displaced to the one height field. RingGeometry (not CircleGeometry,
       which has a single ring of rim vertices and nothing to shape).

       CircleGeometry/RingGeometry are authored in XY and rotated -PI/2 about X,
       which maps local (x, y, z) -> world (x, z, -y). So the vertex's LOCAL Z
       is its world height, and its world XZ comes from local (x, -y). */
    /* ---- THE SEA HAD A FLOOR THE COLOUR OF A BEACH TOWEL ------------------
       What was here: RingGeometry(145 → 290) draped on the height field and
       painted ONE flat MeshLambert 0xcdbb8f, plus fourteen separate circle
       meshes for wet patches. Three faults, all visible in the shipped frames:

         1. It stopped at r = 290 under a 1400 m ocean plane, so every surface
            view out to sea showed water with nothing under it.
         2. A single pale-tan albedo under a sun nothing ever dimmed clipped
            toward WHITE at every depth. The owner's frame of a hammerhead over
            it is a teal shark on a sheet of paper.
         3. Fourteen circles = fourteen draw calls for mottling that a vertex
            colour does for free.

       Now: one mesh, out to R + 500, radially graded on a squared ring
       distribution (fine where a swimmer can reach it, coarse at the horizon),
       with the CITY's own bed ramp ported onto vertex colours — sand → silt →
       shelf teal → abyssal sediment BY WATER COLUMN, which is exactly what
       world/terrain_overhaul.js grades the continent's seabed by. The old wet
       patches survive as low-frequency tone blotches in the same attribute.
       Still one draw call, and thirteen fewer than before. */
    const BED_R0 = SHORE_R - 1;        // shares the shore ring's outer rim exactly
    /* The mesh ends 260 m up the far beach — behind the dune crest, so the
       world's visible edge is dry sand you cannot see past, not a rim of
       floating water. The size of the OCEAN itself is FAR_WL above; this is
       just how much of its far shore gets drawn. */
    const BED_R1 = FAR_WL + 260;
    /* RING RADII ARE A LIST, NOT A FORMULA. The old squared distribution was
       right for a bed that only ever got flatter with distance — fine rings
       at the island beach, ~50 m at the horizon. But the far coast puts a
       second beach AT the horizon, and a 26 m foreshore sampled by 50 m
       rings is a shoreline drawn one triangle wide (the drawn waterline
       wandering tens of metres off the walked one — exactly the split the
       header above forbids). So: the squared run covers island beach →
       abyssal plain, then explicit rings pin every breakpoint of the far
       profile — climb start, foreshore, THE WATERLINE ITSELF, beach, dune
       shoulder, crest. */
    const bedRadii = [];
    (function () {
      const powEnd = FAR_WL - FAR_TOUCH - 60;    // where the plain hands over
      const POW_RINGS = 74;
      for (let i = 0; i <= POW_RINGS; i++)
        bedRadii.push(BED_R0 + (powEnd - BED_R0) * Math.pow(i / POW_RINGS, 1.7));
      for (const o of [-117, -84, -55, -34, -26, -18, -10, -4, 0, 5, 12, 20, 26, 42, 66, 96, 132, 180, 260])
        bedRadii.push(FAR_WL + o);
    })();
    const BED_RINGS = bedRadii.length - 1, BED_SECT = 128;
    function bss(e0, e1, x2) { let t = (x2 - e0) / (e1 - e0); t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); }
    (function seaFloor() {
      const flat = CBZ.CONFIG.SURV_SEABED === false;
      const nv = (BED_RINGS + 1) * (BED_SECT + 1);
      const pos = new Float32Array(nv * 3);
      const col = new Float32Array(nv * 3);
      const idx = [];
      // ref values ported from world/terrain_overhaul.js's C3 bed ramp
      // ...but DARKER than the city's, and deliberately. terrain_overhaul's
      // own note records that its tiles are lit ~1.2x harder than the albedo
      // reads and that a cream value therefore clipped to white; the island's
      // rig is harsher still (survival.js writes sun 1.08 AND hemi 0.98, so a
      // flat bed sees ~2.0x before this wave's dimmer and ~1.25x after). A
      // 0.79-luma sand under that is white however good the ramp is.
      const bedSand = new THREE.Color(0x5d5038), bedSilt = new THREE.Color(0x413a2b);
      const bedShelf = new THREE.Color(0x1c303a), bedDeep = new THREE.Color(0x060d15);
      // the far coast's DRY sand, above the waterline: sun-bleached against
      // the submerged ramp, but held under the luma the rig's ~2x lighting
      // would clip (the 0.79-luma lesson above)
      const drySand = new THREE.Color(0x8a7a58);
      const c = new THREE.Color();
      let v = 0;
      for (let i = 0; i <= BED_RINGS; i++) {
        const rr = bedRadii[i];
        for (let j = 0; j <= BED_SECT; j++) {
          const a = (j / BED_SECT) * Math.PI * 2;
          const lx = Math.cos(a) * rr, ly = Math.sin(a) * rr;
          const wx = cx + lx, wz = cz - ly;
          // baseSeabedAt: the far dunes' angular relief must be IN the drawn
          // surface (or drawn and walked split on the far beach) but the
          // islets must NOT be — this grid samples ~50 m mid-sea and would
          // draw them as lumps; they get their own fine meshes below
          const y = flat ? -1.35 : baseSeabedAt(wx, wz);
          pos[v * 3] = lx; pos[v * 3 + 1] = ly; pos[v * 3 + 2] = y;
          // metres of water standing over this vertex — the ONE thing the bed's
          // colour depends on (world/terrain_overhaul.js, refs 3 and 5)
          const column = OCEAN_Y - y;
          c.copy(bedSand).lerp(bedSilt, bss(5, 24, column));
          c.lerp(drySand, bss(0.15, 2.2, -column) * 0.85);   // out of the water → beach
          // a sloping bed should read as a slope: one multiplicative tone
          // fall-off with the column, applied BEFORE the deep lerps so both
          // deep endpoints stay exact
          c.multiplyScalar(1 - bss(1, 20, column) * 0.46);
          c.lerp(bedShelf, bss(10, 30, column));
          c.lerp(bedDeep, bss(20, 50, column));
          // Sand banding + patchiness. Deliberately LOW frequency, from
          // analytic sums rather than a hash: the ring spacing runs 1 m at the
          // beach to 30 m at the horizon, so anything with a period under ~60 m
          // is sampled below Nyquist out there and comes out as a moiré of the
          // grid instead of as sand. (CBZ.hash01 quantises to 0.1 of its input,
          // which at any usable scale here is per-vertex white noise — it looks
          // like static on a 1 m ring and like nothing at all on a 30 m one.)
          // The blotches are what the fourteen deleted "wet patch" circle
          // meshes used to be; the band is a broad sand ripple, faded out past
          // the shelf break where the bed is uniform sediment anyway.
          const blot = (Math.sin(wx * 0.037 + wz * 0.021) * 0.5 + 0.5) * 0.6 +
                       (Math.sin(wx * -0.017 + wz * 0.049 + 1.7) * 0.5 + 0.5) * 0.4;
          const band = 0.05 * Math.sin(rr * 0.11 + a * 3.0) * (1 - bss(14, 34, column));
          const tone = (1 + (blot - 0.5) * 0.26 + band) * (1 - 0.20 * bss(0.66, 0.96, blot));
          col[v * 3] = c.r * tone; col[v * 3 + 1] = c.g * tone; col[v * 3 + 2] = c.b * tone;
          v++;
        }
      }
      const stride = BED_SECT + 1;
      for (let i = 0; i < BED_RINGS; i++) {
        for (let j = 0; j < BED_SECT; j++) {
          const a = i * stride + j, b = a + 1, d = a + stride, e = d + 1;
          idx.push(a, b, d, b, e, d);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      geo.computeBoundingSphere();
      const bedMat = new THREE.MeshLambertMaterial({
        color: 0xffffff, vertexColors: true, side: THREE.DoubleSide,
      });
      bedMat.name = "survival-seabed";   // never water/ocean/sea (test contract)
      const seabed = new THREE.Mesh(geo, bedMat);
      seabed.rotation.x = -Math.PI / 2; seabed.position.set(cx, 0, cz);
      seabed.receiveShadow = true;
      seabed.userData.terrain = true;    // batch.js / farcull.js keep their hands off
      // sunlight caustics on the sand under the shallows (world/water_spec.js)
      if (CBZ.waterCausticsApply) CBZ.waterCausticsApply(seabed);
      root.add(seabed);
    })();

    /* ---- THE ARCHIPELAGO'S MESHES: one fine radial patch per islet, all
       merged into ONE draw call. Built straight in world-space XZ (no
       rotated-ring gymnastics), every vertex on isletHeightAt — the same
       function physics maxes in — with explicit rings pinning the foreshore
       and waterline exactly as the far coast's are. The outermost rim is
       forced 0.6 m UNDER the plain the big bed draws, a terrain skirt that
       hides the seam instead of z-fighting it. Underwater the slopes read
       through the translucent sea as pale shallows — which is how you spot
       a cay from a distance, exactly as it should be. */
    (function isletMeshes() {
      if (CBZ.CONFIG.SURV_SEABED === false || !islets.length) return;
      const pos = [], col = [], idx = [];
      const sandWet = new THREE.Color(0x6a5b40), sandDry = new THREE.Color(0x8a7a58);
      const grass = new THREE.Color(0x4f7a33);
      const shelfC = new THREE.Color(0x1c303a), deepC = new THREE.Color(0x060d15);
      const c = new THREE.Color();
      const SECT = 40;
      for (const it of islets) {
        const ringR = [0, it.rw * 0.35, it.rw * 0.62, it.rw * 0.82];
        for (const o of [-8, -3, 0, 4, 10, 17, 26, 45, 75, 132]) {
          const rr = it.rw + o;
          if (rr > ringR[ringR.length - 1] + 1) ringR.push(rr);  // guard keeps small cays monotonic
        }
        const base0 = pos.length / 3;
        for (let i = 0; i < ringR.length; i++) {
          const rim = i === ringR.length - 1;
          for (let j = 0; j <= SECT; j++) {
            const a = (j / SECT) * Math.PI * 2;
            const wx = it.x + Math.cos(a) * ringR[i], wz = it.z + Math.sin(a) * ringR[i];
            let y = isletHeightAt(it, ringR[i]);
            if (rim) y = Math.min(y, baseSeabedAt(wx, wz) - 0.6);
            pos.push(wx - cx, y, wz - cz);
            const column = OCEAN_Y - y;
            c.copy(sandWet).lerp(sandDry, bss(0.15, 1.6, -column));
            if (it.big) c.lerp(grass, bss(1.6, 3.4, y));
            c.multiplyScalar(1 - bss(1, 20, column) * 0.46);
            c.lerp(shelfC, bss(10, 30, column));
            c.lerp(deepC, bss(20, 50, column));
            col.push(c.r, c.g, c.b);
          }
        }
        for (let i = 0; i < ringR.length - 1; i++) {
          for (let j = 0; j < SECT; j++) {
            const a = base0 + i * (SECT + 1) + j, b = a + 1, d = a + SECT + 1, e = d + 1;
            idx.push(a, b, d, b, e, d);
          }
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pos), 3));
      geo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(col), 3));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      geo.computeBoundingSphere();
      const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true, side: THREE.DoubleSide });
      mat.name = "survival-islets";      // never water/ocean/sea (test contract)
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(cx, 0, cz);
      mesh.receiveShadow = true;
      mesh.userData.terrain = true;
      if (CBZ.waterCausticsApply) CBZ.waterCausticsApply(mesh);
      root.add(mesh);
    })();

    /* ---- DRESSING: THIS IS A SEA FLOOR, NOT A GRADIENT --------------------
       Two draw calls total, both built once, both deterministic (CBZ.hash01 and
       the private rng2 stream, so the island's seeded layout is untouched).

       ROCKS: one InstancedMesh of a flat-shaded icosahedron, squashed and
       rotated per instance, sunk a third of its height into the bed. r128's
       fragment shader only applies vColor under USE_COLOR, so the per-instance
       colour needs BOTH instanceColor and a (white) vertex-colour attribute —
       instanceColor alone compiles and then does nothing.
       KELP: one merged mesh of tapered double-sided ribbons in the 3-13 m band,
       which is exactly the water a shark-sim player swims in. It sways, but
       only while the camera is actually under water — see the tick below. */
    (function seaDressing() {
      if (CBZ.CONFIG.SURV_SEABED === false) return;
      const bedY = (x, z) => groundHeightAt(x, z);

      // ---- rocks ----------------------------------------------------------
      // SIZED BY THE QUALITY KNOB, not by a magic constant (the house rule).
      // The density matters more than it looks: the medium's view distance
      // down here is ~21 m, so a 21 m disc of floor is all a swimmer ever
      // sees at once — about 1,400 m2. The first pass scattered 120 rocks
      // over the whole 210,000 m2 shelf, which is 0.8 rocks in view. One
      // rock is indistinguishable from none.
      const ROCKS = Math.round(CBZ.qScale ? CBZ.qScale(190, 560) : 460);
      const rockGeo = new THREE.IcosahedronGeometry(1, 0);
      const rc = new Float32Array(rockGeo.attributes.position.count * 3).fill(1);
      rockGeo.setAttribute("color", new THREE.BufferAttribute(rc, 3));
      // no flatShading: r128's Lambert is Gouraud and warns about the property.
      // IcosahedronGeometry is non-indexed with per-face normals already, so
      // the facets are there for free.
      const rockMat = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true });
      rockMat.name = "survival-seabed-rock";
      const rocks = new THREE.InstancedMesh(rockGeo, rockMat, ROCKS);
      const m4 = new THREE.Matrix4(), qq = new THREE.Quaternion();
      const ee = new THREE.Euler(), sc = new THREE.Vector3(), pv = new THREE.Vector3();
      // DARK, and much darker than the number looks. The renderer is linear with
      // an ACES curve and an sRGB encode on the way out, and that pair lifts a
      // linear 0.34 to roughly 200/255 on screen — so an albedo that reads
      // "dark grey" in a hex picker photographs as pale concrete. Measured: a
      // 0x565045 boulder came out (197,185,170) against a sand bed it is
      // supposed to be darker than.
      const rockHi = new THREE.Color(0x2b2823), rockLo = new THREE.Color(0x080d12);
      const rcol = new THREE.Color();
      for (let i = 0; i < ROCKS; i++) {
        const a = rng2() * Math.PI * 2;
        // biased inward: most rocks where the player can actually see them
        const t = rng2();
        const rr = SHORE_R + 6 + t * t * 150;
        const x = cx + Math.cos(a) * rr, z = cz + Math.sin(a) * rr;
        const y = bedY(x, z);
        const s = 0.34 + rng2() * rng2() * 1.7;
        sc.set(s * (0.8 + rng2() * 0.6), s * (0.42 + rng2() * 0.45), s * (0.8 + rng2() * 0.6));
        ee.set(rng2() * 3.1, rng2() * 6.28, rng2() * 3.1);
        qq.setFromEuler(ee);
        pv.set(x, y + sc.y * 0.24, z);
        m4.compose(pv, qq, sc);
        rocks.setMatrixAt(i, m4);
        const column = OCEAN_Y - y;
        rcol.copy(rockHi).lerp(rockLo, bss(4, 40, column))
          .multiplyScalar(0.82 + rng2() * 0.34);
        rocks.setColorAt(i, rcol);
      }
      rocks.instanceMatrix.needsUpdate = true;
      if (rocks.instanceColor) rocks.instanceColor.needsUpdate = true;
      rocks.castShadow = false; rocks.receiveShadow = false;
      rocks.userData.terrain = true;
      root.add(rocks);

      // ---- kelp -----------------------------------------------------------
      // A CLUMP, NOT A STRAP. One blade per holdfast came out as a single
      // half-metre rubber band standing in open water; kelp reads as kelp
      // because several narrow blades rise from one point and fan apart. So:
      // CLUMPS holdfasts, BLADES narrow ribbons each, every ribbon SEGS+1 rows
      // of 2 vertices, tapering and bowing. Merged by hand into flat arrays —
      // no BufferGeometryUtils round trip for a shape this regular, and the
      // flat arrays are what the sway below writes into.
      const CLUMPS = Math.round(CBZ.qScale ? CBZ.qScale(60, 165) : 140), BLADES = 3, SEGS = 5;
      const STRANDS = CLUMPS * BLADES;
      const rows = SEGS + 1, vpS = rows * 2;
      const nv = STRANDS * vpS;
      const kp = new Float32Array(nv * 3);
      const kc = new Float32Array(nv * 3);
      const kbase = new Float32Array(nv * 3);
      const klean = new Float32Array(nv);      // 0 at the holdfast, 1 at the tip
      const kph = new Float32Array(nv);        // per-strand phase
      const kidx = [];
      const kelpLit = new THREE.Color(0x25331a), kelpDim = new THREE.Color(0x0e170f);   // same encode note as the rocks
      const kcol = new THREE.Color();
      let kv = 0, placed = 0;
      for (let s = 0; s < CLUMPS * 8 && placed < CLUMPS; s++) {
        const a = rng2() * Math.PI * 2;
        const rr = SHORE_R + 2 + rng2() * 34;
        const hx = cx + Math.cos(a) * rr, hz = cz + Math.sin(a) * rr;
        const hy = bedY(hx, hz);
        const column = OCEAN_Y - hy;
        if (column < 2.2 || column > 16) continue;   // kelp is a shallow-shelf plant
        placed++;
        const phase = rng2() * 6.28;
        for (let bl = 0; bl < BLADES; bl++) {
          // each blade starts a few centimetres off the holdfast and leans its
          // own way, so the clump fans instead of stacking on one line
          const sp = rng2() * 6.28, spr = rng2() * 0.45;
          const x = hx + Math.cos(sp) * spr, z = hz + Math.sin(sp) * spr;
          const y = bedY(x, z);
          // never taller than the water it stands in, or a blade pokes through
          // the surface and reads as a stick floating in the sea
          const H = Math.min(column * 0.86, 2.4 + rng2() * 4.6);
          const w0 = 0.09 + rng2() * 0.10;
          const lean = rng2() * 6.28, leanR = 0.24 + rng2() * 0.42;
          const twist = a + rng2() * 3.1;
          const cs = Math.cos(twist), sn = Math.sin(twist);
          const base0 = kv;
          for (let r2 = 0; r2 < rows; r2++) {
            const f = r2 / SEGS;
            const w = w0 * (1 - f * 0.62);
            const ly = y + H * f;
            // the blade bows away from vertical as it rises
            const bx = Math.cos(lean) * leanR * H * f * f;
            const bz = Math.sin(lean) * leanR * H * f * f;
            for (let e = 0; e < 2; e++) {
              const o = (e ? w : -w);
              const px = x + bx + cs * o, pz = z + bz + sn * o;
              kp[kv * 3] = px; kp[kv * 3 + 1] = ly; kp[kv * 3 + 2] = pz;
              kbase[kv * 3] = px; kbase[kv * 3 + 1] = ly; kbase[kv * 3 + 2] = pz;
              klean[kv] = f * f; kph[kv] = phase + bl * 0.7;
              kcol.copy(kelpDim).lerp(kelpLit, f * 0.55 + 0.25)
                .multiplyScalar(0.7 + rng2() * 0.5);
              kc[kv * 3] = kcol.r; kc[kv * 3 + 1] = kcol.g; kc[kv * 3 + 2] = kcol.b;
              kv++;
            }
          }
          for (let r2 = 0; r2 < SEGS; r2++) {
            const q = base0 + r2 * 2;
            kidx.push(q, q + 1, q + 2, q + 1, q + 3, q + 2);
          }
        }
      }
      if (placed) {
        const kgeo = new THREE.BufferGeometry();
        kgeo.setAttribute("position", new THREE.BufferAttribute(kp.subarray(0, kv * 3), 3));
        kgeo.setAttribute("color", new THREE.BufferAttribute(kc.subarray(0, kv * 3), 3));
        kgeo.setIndex(kidx);
        kgeo.computeVertexNormals();
        kgeo.computeBoundingSphere();
        const kmat = new THREE.MeshLambertMaterial({
          color: 0xffffff, vertexColors: true, side: THREE.DoubleSide,
        });
        kmat.name = "survival-seabed-kelp";
        const kelp = new THREE.Mesh(kgeo, kmat);
        kelp.frustumCulled = true;
        kelp.userData.dynamic = true;      // never batch-merge a mesh we rewrite
        root.add(kelp);
        kelpRig = {
          attr: kgeo.getAttribute("position"), base: kbase, lean: klean, ph: kph, n: kv,
        };
      }
    })();

    // the island disc (grass) with a sandy beach ring. Flag off: the old flat
    // 8 m stripe. Flag on: the ring is DRAPED over coastHeightAt — the berm,
    // the foreshore, the walk into the water — with vertex colours that carry
    // the read (mottled dry sand, a damp band, dark wet sand) and a LIVE
    // waterline: the tick at 47.95 below wets every vertex the sea currently
    // reaches and dries it slowly after, so a tsunami drawdown strands a huge
    // ring of visibly WET sand — the dread beat, on the beach itself.
    if (!BEACH2) {
      const beach = new THREE.Mesh(new THREE.CircleGeometry(SHORE_R, 64),
        new THREE.MeshLambertMaterial({ color: 0xe6d49a }));
      beach.rotation.x = -Math.PI / 2; beach.position.set(cx, -0.02, cz);
      beach.receiveShadow = true; root.add(beach);
    } else (function shoreRing() {
      /* R-3 (tucked 3 m under the grass disc, 3 cm down so the grass wins the
         overlap) out to SHORE_R-1, which is exactly the seabed ring's inner
         rim — SAME 96 theta segments, so the two meshes share their boundary
         vertices and the handoff has no seam and no overlap.
         CircleGeometry/RingGeometry local→world after rotateX(-PI/2):
         (x, y, z) → (x, z, -y), so local z IS world height (mesh sits at y 0)
         and world radius is hypot(local x, local y). */
      const shoreGeo = new THREE.RingGeometry(R - 3, SHORE_R - 1, Math.max(96, Math.round(R * 1.1)), 20);
      const sp = shoreGeo.attributes.position, sa = sp.array, vn = sp.count;
      const cols = new Float32Array(vn * 3);   // live colour (base × wetness)
      const base = new Float32Array(vn * 3);   // authored colour, never mutated
      const vh = new Float32Array(vn);         // vertex height (the profile)
      const vth = new Float32Array(vn);        // vertex theta (alongshore phase)
      const vwx = new Float32Array(vn), vwz = new Float32Array(vn);
      // DRY is the sand's real linear albedo (the normalised sand map adds
      // ripples and grain on top); BED stays the seabed mesh's own tone so
      // the shared outer rim is seamless in colour.
      const DRY = new THREE.Color().setRGB(0.40, 0.325, 0.205), BED = new THREE.Color(0xcdbb8f);
      const c = new THREE.Color();
      for (let i = 0; i < vn; i++) {
        const lx = sa[i * 3], ly = sa[i * 3 + 1];
        const dist = Math.hypot(lx, ly);
        const h = dist <= R ? -0.03 : coastHeightAt(dist);
        sa[i * 3 + 2] = h;
        vh[i] = h; vth[i] = Math.atan2(ly, lx);
        vwx[i] = cx + lx; vwz[i] = cz - ly;     // world XZ (ring authored in XY, rotated -PI/2 about X)
        // dry sand, mottled: per-vertex grain (position hash — no rng draw,
        // the island build stream stays byte-identical) over a broad warm/cool
        // drift, blending into the seabed's own tone at the outer rim so the
        // shared edge is invisible in colour as well as in position.
        const wx = cx + lx, wz = cz - ly;
        const grain = 1 + ((CBZ.hash01 ? CBZ.hash01(wx * 1.7, wz * 1.7, 0xb31c) : 0.5) - 0.5) * 0.11;
        const drift = 1 + 0.05 * Math.sin(vth[i] * 7 + dist * 0.31) + (fbm2(wx, wz, 14, 0xb31d) - 0.5) * 0.22;
        // the damp band: sand the swash reached recently stays darker for a
        // metre above the live waterline (the live tick darkens the rest)
        const damp = 1 - 0.25 * (1 - ss(OCEAN_Y + 0.1, OCEAN_Y + 0.6, h));
        c.copy(DRY).multiplyScalar(damp).lerp(BED, ss(SHORE_R - 5, SHORE_R - 1, dist)).multiplyScalar(grain * drift);
        base[i * 3] = c.r; base[i * 3 + 1] = c.g; base[i * 3 + 2] = c.b;
      }
      function ss(e0, e1, x2) { let t = (x2 - e0) / (e1 - e0); t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); }
      sp.needsUpdate = true;
      shoreGeo.setAttribute("color", new THREE.BufferAttribute(cols, 3));
      shoreGeo.computeVertexNormals();
      shoreGeo.computeBoundingSphere();
      worldUV(shoreGeo, 2.6, cx, cz, function (pp, i, w) { w.x = pp.getX(i); w.z = -pp.getY(i); });
      const shoreMat = CBZ.groundSkin
        ? CBZ.groundSkin({ name: "survival-beach-shore", tile: { sand: 2.6 }, chroma: 1, mottle: 0.5, far: 300, sandY: [1.2, 2.4] })
        : skinMat("sand");
      shoreMat.name = "survival-beach-shore";     // no water/ocean/sea in the name (test contract)
      const shore = new THREE.Mesh(shoreGeo, shoreMat);
      shore.rotation.x = -Math.PI / 2; shore.position.set(cx, 0, cz);
      shore.receiveShadow = true;
      shore.userData.coat = true;                 // it is the ground; blizzards coat it
      shore.userData.dynamic = true;              // never batch-merge a mesh we repaint
      root.add(shore);
      shoreRig = { attr: shoreGeo.getAttribute("color"), base, h: vh, th: vth, x: vwx, z: vwz, wet: new Float32Array(vn), n: vn };
      // start honest: everything the sea covers right now is wet
      for (let i = 0; i < vn; i++) {
        const w = vh[i] < OCEAN_Y + 0.12 ? 1 : 0;
        shoreRig.wet[i] = w;
        const q = i * 3, dk = 1 - 0.45 * w;
        cols[q] = base[q] * dk; cols[q + 1] = base[q + 1] * dk; cols[q + 2] = base[q + 2] * dk;
      }
      shoreRig.attr.needsUpdate = true;
    })();
    // the shore numbers the before/after tool reads — measured off the SAME
    // functions the physics uses, at rest sea level, so they cannot lie
    (function facts() {
      let water = -1, swim = -1;
      for (let b = 0; b <= 80; b += 0.25) {     // no hill reaches past R, so the coast IS the ground here
        const gh = coastHeightAt(R + b);
        if (water < 0 && gh <= OCEAN_Y) water = b;
        if (swim < 0 && OCEAN_Y - gh >= 1.35) { swim = b; break; }
      }
      shoreFacts = {
        beachBandM: +(BEACH_W).toFixed(2),
        drySandM: +(water < 0 ? BEACH_W : water).toFixed(2),
        wadeM: +((swim > 0 && water >= 0) ? swim - water : 0).toFixed(2),
        wetLive: shoreRig ? 1 : 0,
      };
    })();
    /* THE LAND. It was a flat polar disc at y 0; the island now has a plain
       that climbs ~4 m inland, a ghaut cut through it and every lot graded
       to its pad, so the land is a 2.5 m grid draped on the SAME function
       physics stands on (groundHeightAt's land term, the plan's landAt):
       drawn and walked are one surface. Grid vertices outside the grass edge
       are pulled onto it at height 0 (the beach ring tucks under there), so
       the rim is a circle, not a staircase. Grass by grassColorAt; the
       ghaut's bed and banks are bare scree and boulder gravel, graded in by
       how deep the cut is. The hills and the volcano are their own meshes
       standing on it. */
    const islandGeo = (function () {
      const STEP = 2.5, N = Math.ceil(2 * R / STEP);
      const nv = (N + 1) * (N + 1);
      const pos = new Float32Array(nv * 3), col = new Float32Array(nv * 3), inR = new Uint8Array(nv);
      const c3 = [0, 0, 0];
      const BED = [0.085, 0.074, 0.060], STONE = [0.120, 0.112, 0.100];
      for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
        const k = j * (N + 1) + i;
        let x = cx - R + i * STEP, z = cz - R + j * STEP;
        const dx = x - cx, dz = z - cz, d = Math.sqrt(dx * dx + dz * dz);
        let y = 0;
        if (d >= R) { x = cx + dx * R / d; z = cz + dz * R / d; }
        else { inR[k] = 1; y = PLAN ? PLAN.landAt(x, z) : 0; }
        pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z;
        grassColorAt(x, z, c3);
        if (PLAN && d < R) {
          const cut = PLAN.plainBaseAt(x, z) - PLAN.plainAt(x, z);
          if (cut > 0.05) {
            const g = Math.max(0, Math.min(1, cut / 1.4));
            const st = vnoise(x, z, 1.7, 0x6c01), base = st > 0.62 ? STONE : BED;
            const m = 0.85 + 0.3 * vnoise(x, z, 0.9, 0x6c02);
            for (let q = 0; q < 3; q++) c3[q] += (base[q] * m - c3[q]) * g;
          }
        }
        col[k * 3] = c3[0]; col[k * 3 + 1] = c3[1]; col[k * 3 + 2] = c3[2];
      }
      const idx = [];
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
        const a = j * (N + 1) + i, b2 = a + 1, c = a + N + 1, e = c + 1;
        if (!(inR[a] || inR[b2] || inR[c] || inR[e])) continue;
        idx.push(a, c, b2, b2, c, e);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      g.setAttribute("color", new THREE.BufferAttribute(col, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      g.computeBoundingSphere();
      worldUV(g, GRASS_TILE, 0, 0, function (pp, i, w) { w.x = pp.getX(i); w.z = pp.getZ(i); });
      return g;
    })();
    const island = new THREE.Mesh(islandGeo, grassMat);
    island.name = "survival-land";
    island.receiveShadow = true; root.add(island);

    if (CBZ.bootStep) CBZ.bootStep("island:mountains");
    // ---- mountains as cones sitting on the floor ----
    /* EVERY ONE OF THESE IS TERRAIN, SO EVERY ONE OF THEM TAKES SNOW.
       systems/weather.js's coat scan qualifies a surface by BOUNDING RADIUS
       (COAT_MIN_R = 34 m), which is the right instinct in a city full of small
       props and the wrong answer here: the three outlying hills are r 16-22
       with peaks of 7-11, so their bounding spheres come out at 16-23 m and
       every one of them failed the bar. Measured during a blizzard: the island
       plate went white, the central refuge cone (r 36 → 38 m) went white, and
       three green hills sat in the middle of it. `userData.coat` is that file's
       author opt-in — the twin of its `noCoat` opt-out — and it says the one
       thing a size test cannot work out on its own: this is the ground. */
    /* THE THREE OUTLYING HILLS. They were 6-sided ConeGeometry — hexagonal
       party hats, and not even the surface you walked on: groundHeightAt
       says these are ROUND linear cones, peak * (1 - d/r). This mesh is that
       function drawn (48 sectors, 14 rings, a skirt ring buried just under
       the plain), in the plain's own grass so the hill grows out of the
       island, with the crown worn thin to bare soil and rock where the turf
       would really give out. */
    const HILL_ROCK = [0.085, 0.070, 0.050];
    hills.forEach((hl) => {
      if (hl.volcano) return;     // the mountain builds itself, below
      const SEC = 48, RINGS = 14;
      const VC = 1 + (RINGS + 1) * SEC;
      const pos = new Float32Array(VC * 3), col = new Float32Array(VC * 3), c3 = [0, 0, 0];
      function put(o, lx, ly, lz) {
        pos[o] = lx; pos[o + 1] = ly; pos[o + 2] = lz;
        const wx = hl.x + lx, wz = hl.z + lz;
        grassColorAt(wx, wz, c3);
        const u = ly / hl.peak;                           // 0 foot .. 1 crown
        const bare = Math.max(0, Math.min(1, (u - 0.55 + (vnoise(wx, wz, 3.1, 0x6b01) - 0.5) * 0.35) * 2.4));
        for (let k = 0; k < 3; k++) col[o + k] = c3[k] + (HILL_ROCK[k] * (0.8 + 0.4 * vnoise(wx, wz, 1.3, 0x6b02)) - c3[k]) * bare * 0.8;
      }
      put(0, 0, hl.peak, 0);
      for (let k = 1; k <= RINGS + 1; k++) {
        const skirt = k === RINGS + 1;
        const d = skirt ? hl.r + 0.6 : hl.r * (k / RINGS);
        for (let s = 0; s < SEC; s++) {
          const ang = (s / SEC) * Math.PI * 2;
          const y = skirt ? -0.3 : Math.max(0, hl.peak * (1 - d / hl.r));
          put((1 + (k - 1) * SEC + s) * 3, Math.cos(ang) * d, y, Math.sin(ang) * d);
        }
      }
      const idx = [];
      const vi = function (k, s) { return 1 + (k - 1) * SEC + (s % SEC); };
      for (let s = 0; s < SEC; s++) idx.push(0, vi(1, s + 1), vi(1, s));
      for (let k = 1; k <= RINGS; k++) for (let s = 0; s < SEC; s++) {
        const a = vi(k, s), b = vi(k, s + 1), c = vi(k + 1, s + 1), e = vi(k + 1, s);
        idx.push(a, c, e, a, b, c);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      worldUV(geo, GRASS_TILE, hl.x, hl.z, function (pp, i, w) { w.x = pp.getX(i); w.z = pp.getZ(i); });
      const cone = new THREE.Mesh(geo, grassMat);
      cone.position.set(hl.x, 0, hl.z);
      cone.castShadow = true; cone.receiveShadow = true;
      cone.userData.coat = true;
      root.add(cone);
    });

    /* ---- THE VOLCANO MESH — the height field, drawn --------------------
       One polar grid, 128 sectors by 36 rings, and EVERY vertex is placed by
       volcanoHeightAt. There is no second opinion about where the mountain
       is: what you see is the surface you walk on, crater, breach and
       barrancos included. 128 sectors (was 64) because a V-shaped barranco
       is a third of a 30-degree period, and two vertices across a valley is
       a crease, not a valley. Rings pack toward the rim, where the profile
       bends hardest.

       THE SKIN IS PER PIXEL. It was Lambert (lit per VERTEX in r128) with
       the dirt map: a smooth brown gradient that Gouraud shading ironed flat,
       so the gullies and the texture vanished past forty metres and the cone
       read as a bell. Now it is a MeshStandardMaterial whose vertex colour is
       the geology (oxidised red scoria at the rim, black-grey tephra on the
       cone, fresh dark deposits in the valley floors and paler weathered
       ridges, the island's own turf climbing the lower flank up a ragged line)
       and whose fragment shader adds, in world space around the vent:
         - RADIAL STREAKS: ash and scree run straight down a cone, so the
           albedo and the relief are stretched along the fall line (the one
           texture cue that says "this pile came out of that hole");
         - SCORIA GRAIN: two octaves of clinker at 0.2-0.6 m;
         - a RELIEF NORMAL from both, so the streaks catch the sun;
         - hollow occlusion on the valley floors (sky light only);
         - the plain's own grass map where the turf is, so the skirt and the
           island plate are the same lawn.
       Every detail term fades with distance so the far cone does not fizz.
       Colours are LINEAR albedos (see the linear-hex trap): basalt really is
       this dark. The last ring is pushed out past the footprint and DOWN
       below y=0, buried under the island plate so the base has no seam. */
    const VOL_FUMAROLES = [];
    (function buildVolcano() {
      const SEC = 128, CR = 8, FR = 27;
      const RINGS = CR + FR + 1;                 // last one is the buried skirt
      const ringR = new Float32Array(RINGS + 1);
      for (let k = 1; k <= CR; k++) ringR[k] = VOL_RIM * Math.pow(k / CR, 0.8);
      for (let k = 1; k <= FR; k++) ringR[CR + k] = VOL_RIM + VOL_FLANK * Math.pow(k / FR, 1.18);
      ringR[RINGS] = VOL.r + 0.9;

      const VC = 1 + RINGS * SEC;
      const pos = new Float32Array(VC * 3);
      const col = new Float32Array(VC * 3);
      const aux = new Float32Array(VC * 2);      // x turf weight, y hollow

      // linear albedos down the cone: u 0 = rim, 1 = base
      const RAMP = [
        [0.00, [0.050, 0.024, 0.016]],           // oxidised scoria on the lip
        [0.10, [0.034, 0.030, 0.028]],           // black-grey tephra
        [0.40, [0.052, 0.047, 0.041]],
        [0.70, [0.078, 0.066, 0.049]],           // weathered, browning
        [1.00, [0.090, 0.080, 0.050]],
      ];
      const CRATER_C = [0.020, 0.017, 0.015];
      const SULPHUR = [0.200, 0.160, 0.030];
      const h01 = CBZ.hash01 || function () { return 0.5; };
      function cl01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
      function smooth(e0, e1, v) { const t = cl01((v - e0) / (e1 - e0)); return t * t * (3 - 2 * t); }
      const _g3 = [0, 0, 0];

      /* THE FUMAROLES: two steaming vents, one on the inner crater wall and
         one just outside the rim. Their ground wears a sulphur stain, and
         world/volcanofx.js's V.fumarole breathes a wisp off each at rest. */
      for (let k = 0; k < 2; k++) {
        const a = VOL_BREACH_A + 2.2 + k * 1.9 + (h01(VOL.x, VOL.z, 0x560a + k) - 0.5) * 0.6;
        const d = k === 0 ? VOL_RIM * 0.72 : VOL_RIM + 1.6;
        const fx = VOL.x + Math.cos(a) * d, fz = VOL.z + Math.sin(a) * d;
        VOL_FUMAROLES.push({ x: fx, z: fz, y: volcanoHeightAt(d, a), a: a, d: d });
      }
      VOL.fumaroles = VOL_FUMAROLES;

      function paint(d, ang, y, o, ax) {
        const wx = VOL.x + Math.cos(ang) * d, wz = VOL.z + Math.sin(ang) * d;
        let sul = 0;
        for (let f = 0; f < VOL_FUMAROLES.length; f++) {
          const F = VOL_FUMAROLES[f];
          const q = Math.hypot(wx - F.x, wz - F.z) / 2.4;
          sul = Math.max(sul, Math.exp(-q * q) * (0.7 + 0.3 * vnoise(wx, wz, 0.9, 0x560c)));
        }
        ax[0] = 0; ax[1] = 0;
        if (d <= VOL_RIM) {
          // the crater: dark all the way, darkest at the floor
          const f = cl01(d / VOL_RIM);
          for (let k = 0; k < 3; k++) o[k] = CRATER_C[k] + (RAMP[0][1][k] - CRATER_C[k]) * f * f;
          ax[1] = 0.6 * (1 - f);
        } else {
          const u = cl01((d - VOL_RIM) / VOL_FLANK);
          let i = 0;
          while (i < RAMP.length - 2 && u > RAMP[i + 1][0]) i++;
          const f = cl01((u - RAMP[i][0]) / (RAMP[i + 1][0] - RAMP[i][0]));
          const env = volcanoGully(d);
          const lobe = volcanoLobe(d, ang);              // -1 valley .. +0.45 ridge
          const valley = env * Math.max(0, -lobe);
          const ridge = env * Math.max(0, lobe) / 0.45;
          // valleys carry the freshest, darkest deposits; ridges weather pale
          const k2 = (1 - 0.34 * valley + 0.2 * ridge)
            * (1 + (h01(wx, wz, 0x5604) - 0.5) * 0.14 + (vnoise(wx, wz, 4.5, 0x5606) - 0.5) * 0.26);
          for (let k = 0; k < 3; k++) o[k] = (RAMP[i][1][k] + (RAMP[i + 1][1][k] - RAMP[i][1][k]) * f) * Math.max(0.5, k2);
          ax[1] = valley;
          // the turf line: higher up the old ridges, low in the live valleys
          const line = 0.66 - 0.16 * ridge + 0.14 * valley + (fbm2(wx, wz, 9, 0x5607) - 0.5) * 0.26;
          const g = smooth(line, line + 0.13, u);
          if (g > 0) {
            grassColorAt(wx, wz, _g3);
            for (let k = 0; k < 3; k++) o[k] += (_g3[k] - o[k]) * g;
            ax[0] = g;
          }
        }
        if (sul > 0.02) for (let k = 0; k < 3; k++) o[k] += (SULPHUR[k] - o[k]) * sul * (1 - ax[0]);
      }

      const _a = [0, 0, 0], _x = [0, 0];
      pos[1] = volcanoHeightAt(0, 0);
      paint(0, 0, pos[1], _a, _x);
      col[0] = _a[0]; col[1] = _a[1]; col[2] = _a[2]; aux[0] = _x[0]; aux[1] = _x[1];
      for (let k = 1; k <= RINGS; k++) {
        const d = ringR[k], skirt = k === RINGS;
        for (let s = 0; s < SEC; s++) {
          const ang = (s / SEC) * Math.PI * 2;
          const vi0 = 1 + (k - 1) * SEC + s, o = vi0 * 3;
          const y = skirt ? -0.55 : volcanoHeightAt(d, ang);
          pos[o] = Math.cos(ang) * d; pos[o + 1] = y; pos[o + 2] = Math.sin(ang) * d;
          paint(skirt ? VOL.r : d, ang, y, _a, _x);
          col[o] = _a[0]; col[o + 1] = _a[1]; col[o + 2] = _a[2];
          aux[vi0 * 2] = _x[0]; aux[vi0 * 2 + 1] = _x[1];
        }
      }

      const idx = new Uint16Array((SEC + (RINGS - 1) * SEC * 2) * 3);
      let n = 0;
      const vi = function (k, s) { return 1 + (k - 1) * SEC + (s % SEC); };
      for (let s = 0; s < SEC; s++) {           // the fan over the crater floor
        idx[n++] = 0; idx[n++] = vi(1, s + 1); idx[n++] = vi(1, s);
      }
      for (let k = 1; k < RINGS; k++) {
        for (let s = 0; s < SEC; s++) {
          const a = vi(k, s), b = vi(k, s + 1), c = vi(k + 1, s + 1), e = vi(k + 1, s);
          idx[n++] = a; idx[n++] = c; idx[n++] = e;
          idx[n++] = a; idx[n++] = b; idx[n++] = c;
        }
      }

      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
      geo.setAttribute("aVol", new THREE.BufferAttribute(aux, 2));
      geo.setIndex(new THREE.BufferAttribute(idx, 1));
      geo.computeVertexNormals();

      const volMat = new THREE.MeshStandardMaterial({
        color: 0xffffff, vertexColors: true, roughness: 0.94, metalness: 0,
        envMapIntensity: 0.3,
      });
      volMat.name = "survival-volcano";
      const gm = CBZ.surfaceMaps ? CBZ.surfaceMaps("grass", { repeat: 1 }) : null;
      const grassTex = gm && gm.map ? gm.map : null;
      const gMean = grassTex ? mapMean(grassTex) : [1, 1, 1];
      const uGrass = { value: grassTex };
      const uGrassK = { value: new THREE.Vector3(1 / Math.max(0.02, gMean[0]), 1 / Math.max(0.02, gMean[1]), 1 / Math.max(0.02, gMean[2])) };
      const uVolC = { value: new THREE.Vector2(VOL.x, VOL.z) };
      volMat.onBeforeCompile = function (sh) {
        const vs = sh.vertexShader, fs0 = sh.fragmentShader;
        if (vs.indexOf("#include <project_vertex>") < 0 || fs0.indexOf("#include <color_fragment>") < 0 ||
            fs0.indexOf("#include <normal_fragment_maps>") < 0) return;
        sh.uniforms.uVolC = uVolC;
        sh.uniforms.uVolGrass = uGrass;
        sh.uniforms.uVolGrassK = uGrassK;
        sh.vertexShader = vs
          .replace("#include <common>", "#include <common>\nattribute vec2 aVol;\nvarying vec2 vVol;\nvarying vec3 vVolW;\nvarying vec3 vVolN;")
          .replace("#include <project_vertex>", "#include <project_vertex>\n" +
            "vVol = aVol;\nvVolW = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvVolN = normalize(mat3(modelMatrix) * objectNormal);");
        let fs = fs0.replace("#include <common>", "#include <common>\n" +
          "varying vec2 vVol;\nvarying vec3 vVolW;\nvarying vec3 vVolN;\n" +
          "uniform vec2 uVolC;\nuniform sampler2D uVolGrass;\nuniform vec3 uVolGrassK;\n" +
          "float volH(vec2 p){ p = fract(p * vec2(443.897, 441.423)); p += dot(p, p.yx + 19.19); return fract((p.x + p.y) * p.x); }\n" +
          "float volN(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);\n" +
          "  return mix(mix(volH(i), volH(i + vec2(1.0, 0.0)), f.x), mix(volH(i + vec2(0.0, 1.0)), volH(i + vec2(1.0, 1.0)), f.x), f.y); }\n" +
          // relief: radial streaks (long down the fall line, tight across it)
          // plus isotropic clinker grain; `fine` fades the grain with distance
          "float volRelief(vec2 xz, float fine){\n" +
          "  vec2 q = xz - uVolC; float r = length(q); float a = atan(q.y, q.x);\n" +
          "  float st = volN(vec2(a * 26.0, r * 0.16)) * 0.62 + volN(vec2(a * 71.0, r * 0.42)) * 0.38;\n" +
          "  float gr = volN(xz * 1.9) * 0.6 + volN(xz * 5.1 + 7.3) * 0.4;\n" +
          "  return st * 0.75 + gr * 0.45 * fine; }\n" +
          "float volFine = 1.0; float volMid = 1.0; vec2 volG = vec2(0.0);");
        fs = fs.replace("#include <color_fragment>", "#include <color_fragment>\n{\n" +
          "  float dd = length(vViewPosition);\n" +
          "  volFine = 1.0 - smoothstep(25.0, 90.0, dd);\n" +
          "  volMid = 1.0 - smoothstep(120.0, 420.0, dd);\n" +
          "  float veg = clamp(vVol.x, 0.0, 1.0);\n" +
          "  float e = max(0.12, dd * 0.0022);\n" +
          "  float h0 = volRelief(vVolW.xz, volFine);\n" +
          "  volG = vec2(volRelief(vVolW.xz + vec2(e, 0.0), volFine) - h0, volRelief(vVolW.xz + vec2(0.0, e), volFine) - h0) / e;\n" +
          "  float rockMod = mix(1.0, 0.62 + 0.62 * h0, volMid);\n" +
          "  vec3 gT = texture2D(uVolGrass, vVolW.xz / " + GRASS_TILE.toFixed(3) + ").rgb;\n" +
          "  gT = pow(gT, vec3(2.2)) * uVolGrassK;\n" +
          "  vec3 vegMod = " + (grassTex ? "gT" : "vec3(1.0)") + ";\n" +
          "  diffuseColor.rgb *= mix(vec3(rockMod), vegMod, veg);\n" +
          "}");
        fs = fs.replace("#include <normal_fragment_maps>", "#include <normal_fragment_maps>\n{\n" +
          "  float amp = 0.55 * volMid * (1.0 - 0.7 * clamp(vVol.x, 0.0, 1.0));\n" +
          "  vec3 nP = normalize(vVolN + vec3(-volG.x, 0.0, -volG.y) * amp);\n" +
          "  normal = normalize(normal + mat3(viewMatrix) * (nP - vVolN));\n" +
          "}");
        if (fs.indexOf("#include <aomap_fragment>") >= 0) {
          fs = fs.replace("#include <aomap_fragment>", "#include <aomap_fragment>\n" +
            "reflectedLight.indirectDiffuse *= 1.0 - 0.45 * clamp(vVol.y, 0.0, 1.0);");
        }
        sh.fragmentShader = fs;
      };
      volMat.customProgramCacheKey = function () { return "cbzVolcanoSkin1|" + (grassTex ? 1 : 0); };
      if (CBZ.gfxRegisterPbr) CBZ.gfxRegisterPbr(volMat);
      const mtn = new THREE.Mesh(geo, volMat);
      mtn.name = "survival-volcano";
      mtn.position.set(VOL.x, 0, VOL.z);
      mtn.castShadow = true; mtn.receiveShadow = true;
      mtn.userData.coat = true;       // blizzards and ash still lay on the ground
      root.add(mtn);
    })();

    /* AT REST THE MOUNTAIN BREATHES. A faint steam wisp off each fumarole —
       world/volcanofx.js's V.fumarole, one instanced draw — built lazily on
       the first island frame (volcanofx loads after this file) and ticked
       here, so no disaster has to own it. It fades itself out while an
       eruption column is standing and back in after. */
    let volSteam = null;
    CBZ.onUpdate(29.5, function (dt) {
      if (!root.visible || !CBZ.islandModeOn || !CBZ.islandModeOn(CBZ.game.mode)) return;
      if (!volSteam) {
        const VF = CBZ.volcanoFx;
        if (!VF || !VF.fumarole) return;
        volSteam = VF.fumarole({ vents: VOL_FUMAROLES, parent: root, salt: 0x5611 });
      }
      volSteam.update(dt);
    });

    // ============================================================
    // ENTERABLE BUILDINGS
    // Each is one bgroup (positioned at the building, so collapse can
    // pivot/sink the whole thing). Pieces are placed in LOCAL coords; the
    // matching world-space collider/platform records are pushed globally
    // and tracked on the descriptor so collapse can yank them (and reset
    // can restore them). Walls are height-gated colliders; floors, stair
    // treads and the roof are walkable platforms.
    // ============================================================
    const fragile = [];
    const cars = [];
    const elevators = [];   // moving tower lifts (animated each frame)
    // Real wall materials: limestone render, red brick, lime-washed render,
    // grey stone, ochre plaster, sage paint, terracotta, cream. (The old list
    // was sky blue, pink, mint and canary, and every grammar that lets the
    // host wall show wore it.) Still eight, so the rng stream and the town
    // plan are exactly what they were.
    const PALETTE = [0xb3a48e, 0x8a5a4c, 0xd2cabb, 0x8e8a80, 0xb89c7c, 0x7e897d, 0x9e7462, 0xc9bea9];

    // ---- SHATTERABLE GLASS -------------------------------------------------
    // Every window pane is registered here so a quake/blast can burst it: the
    // pane hides and a few glass shards rain down. One shared translucent
    // material (cool tinted reflectiony look) keeps it cheap. allGlass holds
    // {mesh,x,y,z,span,shattered}; a building also keeps its own list so its
    // collapse blows out exactly its windows.
    const allGlass = [];
    /* The loose panes (the showroom's display glass) are the same glass as
       the facades': clear, a faint tint, a Fresnel mirror at a glancing angle.
       They were a half-opaque cyan Lambert with a 0.55 cyan EMISSIVE, so a
       car dealership's windows glowed like a fish tank at midnight. */
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0xdbe8ec, metalness: 0.15, roughness: 0.05,
      envMap: CBZ.ENV || null, envMapIntensity: 1.25,
      transparent: true, opacity: 0.14, depthWrite: false, side: THREE.DoubleSide,
    });
    glassMat.onBeforeCompile = function (sh) {
      sh.fragmentShader = sh.fragmentShader.replace(GLASS_FRAG_OUT, GLASS_FRAG_NEW);
    };
    glassMat.customProgramCacheKey = function () { return "cbz-island-pane-fresnel"; };
    glassMat._shared = true;
    envWanting.push(glassMat); hookEnv();
    // add a glass pane into `group` at LOCAL (lx,ly,lz); (ox,oz,gy) maps it to
    // world space for proximity tests. For root-level structures pass 0,0,0 and
    // give world coords as the local position.
    function addGlass(group, lx, ly, lz, pw, ph, pd, ox, oz, gy, list) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(pw, ph, pd), glassMat);
      m.position.set(lx, ly, lz); m.castShadow = false; m.receiveShadow = false;
      m.renderOrder = 1;
      group.add(m);
      const rec = { mesh: m, x: ox + lx, y: gy + ly, z: oz + lz, span: Math.max(pw, pd) * 0.5, shattered: false };
      allGlass.push(rec); if (list) list.push(rec);
      return m;
    }
    /* A pane bursts into ITS OWN GLASS: the pane solid (the real mesh, or
       for the merged facade glass a pane-thin slab of the facade's glass
       material exactly where the window was) is fractured by CBZ.debris into
       radial shards that fall and settle as glass on the pavement. `full`
       false (the far panes of a mass blow-out) throws glass grit only, so a
       collapsing tower does not fracture sixty windows in one frame. */
    function burstPane(gp, full) {
      if (gp.shattered) return;
      gp.shattered = true;
      const D = CBZ.debris;
      const at = { x: gp.x, y: gp.y, z: gp.z };
      if (gp.mesh && !gp.hide) {
        if (D && full !== false) D.shatter(gp.mesh, { kind: "glass", at, power: 1, maxPieces: 8, owner: "fx" });
        else if (D) D.chips(at.x, at.y, at.z, { kind: "glass", count: 6, power: 0.8, spread: gp.span || 0.5 });
        gp.mesh.visible = false;
        return;
      }
      if (gp.hide) gp.hide(); else if (gp.mesh) gp.mesh.visible = false;
      if (!D) return;
      if (full === false || !gp.mat) { D.chips(at.x, at.y, at.z, { kind: "glass", count: 6, power: 0.8, spread: gp.span || 0.5 }); return; }
      const hs = gp.span || 0.6, hh = gp.hh || 0.7, th = 0.012;
      const box = gp.horiz
        ? { minX: gp.x - hs, maxX: gp.x + hs, minY: gp.y - hh, maxY: gp.y + hh, minZ: gp.z - th, maxZ: gp.z + th }
        : { minX: gp.x - th, maxX: gp.x + th, minY: gp.y - hh, maxY: gp.y + hh, minZ: gp.z - hs, maxZ: gp.z + hs };
      D.shatterBox(box, gp.mat, { kind: "glass", at, power: 1, maxPieces: 8, owner: "fx" });
    }
    // shatter every intact pane within `r` of (x,z) — called by the quake (on
    // collapse) and by every explosion (CBZ.fx.blast). Caps work per call.
    CBZ.shatterGlass = function (x, z, r) {
      const r2 = r * r; let n = 0;
      for (let i = 0; i < allGlass.length; i++) {
        const gp = allGlass[i]; if (gp.shattered) continue;
        const dx = gp.x - x, dz = gp.z - z;
        if (dx * dx + dz * dz <= r2) { burstPane(gp, n < 8); if (++n > 60) break; }
      }
      return n;
    };

    /* ============================================================
       THE INSIDE OF A BUILDING
       ============================================================
       Every room on the island was the outside of a box seen from within:
       a flat grey foundation for a floor (0x6c7178), the same grey slab
       overhead with no ceiling, the inside of each wall wearing the street
       paint, stair treads floating 12 cm apart over an invisible ramp, and
       whatever the quake kit dropped in the middle. None of it read as a
       room anybody lived or worked in.

       Now each building gets a real interior, built once with the shell and
       merged by material into a handful of meshes (one per surface kind,
       never one per piece): oak, ceramic tile, terrazzo or carpet-tile
       floors at their real world scale, painted plaster walls cut round the
       same window holes as the shell, skirting, door linings and window
       stools, painted ceilings with their fixtures (flush domes and pendants
       in houses, 600x1200 troffers in the towers, all emissive, never a
       THREE light), closed stairs with stringers, a soffit and a rail, and
       furniture arranged the way people arrange it (against walls, round a
       focal point, with room to walk). The textures are city/fitout.js's
       canvases (CBZ.fitoutTex), not a second library; the light pools under
       each fixture are baked into the floor's vertex colours.

       Coplanar faces are designed out, not polygon-offset away: the
       structural slab's visual stops 15 mm under the finished floor and
       12 mm over the ceiling board, and the plaster skin stands 6 mm off the
       wall it lines. The walkable records (platforms, ramps, colliders) are
       exactly the numbers they always were. */
    const IN_TEX_SCALE = { wood: 1.6, tile: 1.2, terrazzo: 2.0, carpet: 2.0, plaster: 2.5, ceiling: 2.4, concrete: 3.0 };
    // the same canvas at another size: the showroom's 600 mm polished tiles
    const IN_ALIAS = { tile60: { tex: "tile", scale: 2.4 } };
    const inMats = Object.create(null);
    function inMat(key) {
      let m = inMats[key];
      if (m) return m;
      if (key === "glow") {
        m = new THREE.MeshBasicMaterial({ vertexColors: true });
      } else {
        const tk = IN_ALIAS[key] ? IN_ALIAS[key].tex : key;
        const tex = (key === "flat" || !CBZ.fitoutTex) ? null : CBZ.fitoutTex(tk);
        m = new THREE.MeshLambertMaterial({ vertexColors: true, map: tex || null });
      }
      m.name = "island-interior:" + key;
      m._shared = true;
      inMats[key] = m;
      return m;
    }
    function inScale(key) {
      if (IN_ALIAS[key]) return IN_ALIAS[key].scale;
      const S = CBZ.FITOUT_TEX_SCALE;
      return (S && S[key]) || IN_TEX_SCALE[key] || 2;
    }
    function hexRGB(hex) { return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255]; }

    /* The per-building kit: buckets of quads by material key, in the
       building's LOCAL frame; (wx, wz) is its world origin, for world-scaled
       UVs. Faces are wound from their normal, so a caller never has to. */
    function inKit(wx, wz) {
      const bk = Object.create(null);
      const lights = [];
      function B(key) {
        return bk[key] || (bk[key] = { p: [], n: [], c: [], u: [], i: [], tex: key !== "flat" && key !== "glow" });
      }
      function quad(key, a, b, c, d, n, col, lit) {
        const k = B(key), base = k.p.length / 3, s = k.tex ? inScale(key) : 1;
        const C = typeof col === "number" ? hexRGB(col) : col;
        // wind counter-clockwise seen from the normal side
        const e1x = b[0] - a[0], e1y = b[1] - a[1], e1z = b[2] - a[2];
        const e2x = c[0] - a[0], e2y = c[1] - a[1], e2z = c[2] - a[2];
        const cx = e1y * e2z - e1z * e2y, cy = e1z * e2x - e1x * e2z, cz = e1x * e2y - e1y * e2x;
        const P = (cx * n[0] + cy * n[1] + cz * n[2]) < 0 ? [a, d, c, b] : [a, b, c, d];
        const ax = Math.abs(n[0]), ay = Math.abs(n[1]), az = Math.abs(n[2]);
        for (let q = 0; q < 4; q++) {
          const v = P[q];
          k.p.push(v[0], v[1], v[2]); k.n.push(n[0], n[1], n[2]);
          const f = lit ? lit(v[0], v[1], v[2]) : 1;
          k.c.push(C[0] * f, C[1] * f, C[2] * f);
          if (k.tex) {
            const X = v[0] + wx, Z = v[2] + wz;
            if (ay >= ax && ay >= az) k.u.push(X / s, -Z / s);
            else if (ax >= az) k.u.push(Z / s, v[1] / s);
            else k.u.push(X / s, v[1] / s);
          }
        }
        k.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
      // an axis-aligned box; mask bits +x 1, -x 2, +y 4, -y 8, +z 16, -z 32
      function box(key, cx, cy, cz, w, h, d, col, mask, lit) {
        if (!(w > 0.001 && h > 0.001 && d > 0.001)) return;
        const x0 = cx - w / 2, x1 = cx + w / 2, y0 = cy - h / 2, y1 = cy + h / 2, z0 = cz - d / 2, z1 = cz + d / 2;
        const m = mask == null ? 63 : mask;
        if (m & 1) quad(key, [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], [1, 0, 0], col, lit);
        if (m & 2) quad(key, [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], col, lit);
        if (m & 4) quad(key, [x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [0, 1, 0], col, lit);
        if (m & 8) quad(key, [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0], col, lit);
        if (m & 16) quad(key, [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], col, lit);
        if (m & 32) quad(key, [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0], [0, 0, -1], col, lit);
      }
      // a convex eight-corner solid: v[0..3] one ring, v[4..7] the ring
      // opposite (v[4] over v[0]); flat normals pointing away from its middle
      function hexa(key, v, col) {
        let mx = 0, my = 0, mz = 0;
        for (let i = 0; i < 8; i++) { mx += v[i][0] / 8; my += v[i][1] / 8; mz += v[i][2] / 8; }
        const F = [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]];
        for (let f = 0; f < 6; f++) {
          const q = F[f], a = v[q[0]], b = v[q[1]], c = v[q[2]], d = v[q[3]];
          const e1 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]], e2 = [d[0] - b[0], d[1] - b[1], d[2] - b[2]];
          let n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
          const L = Math.hypot(n[0], n[1], n[2]);
          if (L < 1e-9) continue;
          n = [n[0] / L, n[1] / L, n[2] / L];
          const fx = (a[0] + b[0] + c[0] + d[0]) / 4 - mx, fy = (a[1] + b[1] + c[1] + d[1]) / 4 - my, fz = (a[2] + b[2] + c[2] + d[2]) / 4 - mz;
          if (n[0] * fx + n[1] * fy + n[2] * fz < 0) n = [-n[0], -n[1], -n[2]];
          quad(key, a, b, c, d, n, col);
        }
      }
      // a flat regular polygon (a dome light's diffuser, a fan grille)
      function disc(key, cx, cy, cz, r, seg, down, col) {
        const k = B(key), base = k.p.length / 3, C = hexRGB(col), s = k.tex ? inScale(key) : 1;
        const ny = down ? -1 : 1;
        k.p.push(cx, cy, cz); k.n.push(0, ny, 0); k.c.push(C[0], C[1], C[2]);
        if (k.tex) k.u.push((cx + wx) / s, -(cz + wz) / s);
        for (let i = 0; i < seg; i++) {
          const a = (i / seg) * Math.PI * 2, px = cx + Math.cos(a) * r, pz = cz + Math.sin(a) * r;
          k.p.push(px, cy, pz); k.n.push(0, ny, 0); k.c.push(C[0], C[1], C[2]);
          if (k.tex) k.u.push((px + wx) / s, -(pz + wz) / s);
        }
        for (let i = 0; i < seg; i++) {
          const a = base + 1 + i, b = base + 1 + ((i + 1) % seg);
          if (down) k.i.push(base, a, b); else k.i.push(base, b, a);
        }
      }
      // a horizontal plane subdivided so the baked light can pool on it;
      // cells inside any `holes` rect are left out
      function plane(key, x0, z0, x1, z1, y, col, down, lit, holes, cell) {
        const cs = cell || 1.1;
        const nx = Math.max(1, Math.ceil((x1 - x0) / cs)), nz = Math.max(1, Math.ceil((z1 - z0) / cs));
        const dx = (x1 - x0) / nx, dz = (z1 - z0) / nz;
        const n = down ? [0, -1, 0] : [0, 1, 0];
        for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
          const ax = x0 + i * dx, az = z0 + j * dz, bx = ax + dx, bz = az + dz;
          if (holes && holes.some(function (h) { return bx > h.x0 + 1e-4 && ax < h.x1 - 1e-4 && bz > h.z0 + 1e-4 && az < h.z1 - 1e-4; })) continue;
          quad(key, [ax, y, az], [ax, y, bz], [bx, y, bz], [bx, y, az], n, col, lit);
        }
      }
      // a fixture's pool of light on the floor below it (and a faint halo on
      // the ceiling round it), baked per vertex: no THREE light, no shader
      function light(x, y, z, r, i) { lights.push({ x: x, y: y, z: z, r: r, i: i }); }
      function floorLit(yFloor) {
        const ls = lights.filter(function (l) { return l.y > yFloor && l.y - yFloor < 3.8; });
        if (!ls.length) return null;
        return function (x, y, z) {
          let f = 1;
          for (let q = 0; q < ls.length; q++) {
            const l = ls[q], d = Math.hypot(x - l.x, z - l.z);
            if (d < l.r) { const t = 1 - d / l.r; f += l.i * t * t; }
          }
          return Math.min(1.4, f);
        };
      }
      function ceilLit(yCeil) {
        const ls = lights.filter(function (l) { return Math.abs(l.y - yCeil) < 0.9; });
        if (!ls.length) return null;
        return function (x, y, z) {
          let f = 0.93;                               // a ceiling is the dimmest surface in a room
          for (let q = 0; q < ls.length; q++) {
            const l = ls[q], d = Math.hypot(x - l.x, z - l.z);
            if (d < 1.6) { const t = 1 - d / 1.6; f += 0.22 * l.i * t * t; }
          }
          return Math.min(1.15, f);
        };
      }
      function flush(group, cast) {
        const out = [];
        for (const key in bk) {
          const k = bk[key];
          if (!k.i.length) continue;
          const g2 = new THREE.BufferGeometry();
          g2.setAttribute("position", new THREE.Float32BufferAttribute(k.p, 3));
          g2.setAttribute("normal", new THREE.Float32BufferAttribute(k.n, 3));
          g2.setAttribute("color", new THREE.Float32BufferAttribute(k.c, 3));
          if (k.tex) g2.setAttribute("uv", new THREE.Float32BufferAttribute(k.u, 2));
          g2.setIndex(k.i);
          g2.computeBoundingSphere();
          const m = new THREE.Mesh(g2, inMat(key));
          m.castShadow = !!cast && key === "flat";
          m.receiveShadow = key !== "glow";
          m.name = "island-interior-" + key;
          // a merged interior spans the whole building, so a bounding-box
          // "is it inside?" test cannot tell it from the shell: say so
          m.userData.cbzInterior = true;
          group.add(m);
          out.push(m);
          delete bk[key];
        }
        return out;
      }
      return { quad: quad, box: box, hexa: hexa, disc: disc, plane: plane, light: light,
        floorLit: floorLit, ceilLit: ceilLit, flush: flush, lights: lights };
    }

    /* THE ROOM-SIDE SKIN OF ONE WALL FACE, one storey tall: painted plaster
       cut round the same openings as the wall (holes in building-local
       {s, a0, a1, y0, y1}), a skirting board broken where an opening reaches
       the floor, and each window's reveal lined and sat on a stool. f: { s,
       n (the wall's room-side plane, local), inward (+1/-1 along the normal
       axis), a0, a1 (span along the wall), y0, y1 (floor top .. ceiling),
       skirt: [[a0, a1], ...] runs that get skirting (default the whole span),
       glassN (the glass plane, for the reveal linings; null = no linings) } */
    function skinFace(K, f, holes, paint, trim) {
      const horiz = f.s < 2;                    // faces 0/1 run along x
      const pn = f.n + f.inward * 0.006;        // 6 mm off the wall
      const N = horiz ? [0, 0, f.inward] : [f.inward, 0, 0];
      const P = function (a, y, nn) { return horiz ? [a, y, nn] : [nn, y, a]; };
      const mine = holes.filter(function (h) { return h.s === f.s && h.y1 > f.y0 + 0.01 && h.y0 < f.y1 - 0.01 && h.a1 > f.a0 && h.a0 < f.a1; });
      for (const r of solidRects(f.a0, f.a1, f.y0, f.y1, mine)) {
        K.quad("plaster", P(r[0], r[2], pn), P(r[1], r[2], pn), P(r[1], r[3], pn), P(r[0], r[3], pn), N, paint);
      }
      // skirting: 10 cm tall, 15 mm proud of the skin, stopped at an opening
      // (on the finished floor, which is not always the skin's foot: an upper
      // storey's skin starts down in the slab so the stairwell has no seam)
      const fl = f.floor != null ? f.floor : f.y0;
      const runs = f.skirt || [[f.a0, f.a1]];
      const doors = mine.filter(function (h) { return h.y0 < fl + 0.12; });
      const skN = pn + f.inward * 0.008;
      for (const run of runs) {
        let segs = [[Math.max(f.a0, run[0]), Math.min(f.a1, run[1])]];
        for (const h of doors) {
          const next = [];
          for (const sg of segs) {
            if (h.a1 <= sg[0] || h.a0 >= sg[1]) { next.push(sg); continue; }
            if (h.a0 > sg[0]) next.push([sg[0], h.a0 - 0.07]);
            if (h.a1 < sg[1]) next.push([h.a1 + 0.07, sg[1]]);
          }
          segs = next;
        }
        for (const sg of segs) {
          if (sg[1] - sg[0] < 0.05) continue;
          const cA = (sg[0] + sg[1]) / 2, len = sg[1] - sg[0];
          if (horiz) K.box("flat", cA, fl + 0.05, skN, len, 0.1, 0.016, trim, f.inward > 0 ? 16 | 4 | 1 | 2 : 32 | 4 | 1 | 2);
          else K.box("flat", skN, fl + 0.05, cA, 0.016, 0.1, len, trim, f.inward > 0 ? 1 | 4 | 16 | 32 : 2 | 4 | 16 | 32);
        }
      }
      if (f.glassN == null) return;
      // windows: plaster linings on the reveal's head and jambs (from the room
      // face to just inside the glass) and a painted stool along the bottom
      const gn = f.glassN + f.inward * 0.012;   // just room-side of the glass
      for (const h of mine) {
        if (h.y0 < fl + 0.12) continue;         // a doorway is lined by its own casing
        const ya = Math.max(h.y0, f.y0), yb = Math.min(h.y1, f.y1);
        const nA = Math.min(pn, gn), nB = Math.max(pn, gn), nC = (nA + nB) / 2, nD = nB - nA;
        if (nD < 0.02) continue;
        // jambs face into the opening; head faces down
        if (horiz) {
          K.box("plaster", h.a0 + 0.004, (ya + yb) / 2, nC, 0.008, yb - ya, nD, paint, 1);
          K.box("plaster", h.a1 - 0.004, (ya + yb) / 2, nC, 0.008, yb - ya, nD, paint, 2);
          K.box("plaster", (h.a0 + h.a1) / 2, yb - 0.004, nC, h.a1 - h.a0, 0.008, nD, paint, 8);
          K.box("flat", (h.a0 + h.a1) / 2, ya + 0.012, nC + f.inward * 0.014, h.a1 - h.a0 + 0.1, 0.028, nD + 0.028, trim);
        } else {
          K.box("plaster", nC, (ya + yb) / 2, h.a0 + 0.004, nD, yb - ya, 0.008, paint, 16);
          K.box("plaster", nC, (ya + yb) / 2, h.a1 - 0.004, nD, yb - ya, 0.008, paint, 32);
          K.box("plaster", nC, yb - 0.004, (h.a0 + h.a1) / 2, nD, 0.008, h.a1 - h.a0, paint, 8);
          K.box("flat", nC + f.inward * 0.014, ya + 0.012, (h.a0 + h.a1) / 2, nD + 0.028, 0.028, h.a1 - h.a0 + 0.1, trim);
        }
      }
    }

    /* A DOORWAY'S TRIM: a lining over the reveal (both jambs and the head,
       5 mm clear of the cut faces) and an architrave round it on the room
       side, plus a stone threshold across the wall's thickness. Face 0 (-z)
       only: every island door is on -z. zOut/zIn: the wall's outer and room
       faces; top: the head's height; y0: the finished floor. */
    function doorTrim(K, halfW, zOut, zIn, y0, top, casing, sill) {
      const zc = (zOut + zIn) / 2, zd = zIn - zOut;
      K.box("flat", -halfW + 0.012, (y0 + top) / 2, zc, 0.024, top - y0, zd, casing, 1);
      K.box("flat", halfW - 0.012, (y0 + top) / 2, zc, 0.024, top - y0, zd, casing, 2);
      K.box("flat", 0, top - 0.012, zc, 2 * halfW, 0.024, zd, casing, 8);
      // architrave, room side: 7 cm wide, 2 cm proud
      const za = zIn + 0.016;
      K.box("flat", -halfW - 0.035, (y0 + top + 0.07) / 2, za, 0.07, top + 0.07 - y0, 0.02, casing);
      K.box("flat", halfW + 0.035, (y0 + top + 0.07) / 2, za, 0.07, top + 0.07 - y0, 0.02, casing);
      K.box("flat", 0, top + 0.035, za, 2 * halfW + 0.14, 0.07, 0.02, casing);
      K.box("flat", 0, y0 - 0.006, zc, 2 * halfW, 0.028, zd + 0.04, sill, 4 | 16 | 32);
    }

    /* FURNITURE INTO THE KIT. city/furniture.js draws every piece through a
       host box callback; this one lands the boxes in the building's merged
       "flat" bucket (an emissive box, a lamp shade or a screen, in "glow"),
       with an optional colour remap so a storage rack can be a walnut
       bookcase, and its colliders in the building's own list so the quake
       and the reset handle them like the walls. */
    function furnHost(K, ox, oz, gy, cols, floorY, remap) {
      return function (x, y, z, w, h, d, color, o) {
        const col = remap && remap[color] != null ? remap[color] : color;
        const onFloor = y - h / 2 <= floorY + 0.01;
        if (o && o.emissive != null) K.box("glow", x, y, z, w, h, d, col, onFloor ? 63 & ~8 : 63);
        else K.box("flat", x, y, z, w, h, d, col, onFloor ? 63 & ~8 : 63);
        if (o && o.solid) {
          const c = { minX: ox + x - w / 2, maxX: ox + x + w / 2, minZ: oz + z - d / 2, maxZ: oz + z + d / 2,
            ref: null, y0: gy + (o.y0 != null ? o.y0 : y - h / 2), y1: gy + (o.y1 != null ? o.y1 : y + h / 2) };
          if (o.noStep) c.noStep = true;
          CBZ.colliders.push(c); cols.push(c);
        }
        return true;
      };
    }
    // one CBZ.furnish call with the city's seat registry closed: an island's
    // chairs are not the city's anchors (see systems/quake.js's old note)
    function furnish(name, host, x, y, z, yaw, o) {
      const F = CBZ.furnish;
      if (!F || typeof F[name] !== "function") return null;
      const sSeat = CBZ.propRegisterSeat, sBed = CBZ.propRegisterBed;
      CBZ.propRegisterSeat = null; CBZ.propRegisterBed = null;
      const opts = { box: host, ox: 0, oz: 0, solid: true };
      if (o) for (const k in o) opts[k] = o[k];
      try { return name === "lamp" ? F.lamp(x, y, z, opts) : F[name](x, y, z, yaw || 0, opts); }
      catch (e) { return null; }
      finally { CBZ.propRegisterSeat = sSeat; CBZ.propRegisterBed = sBed; }
    }

    /* A ROOM PLANNER, the size of the problem: a rectangle, the rectangles
       that must stay clear (stairs, door, walks, what is already placed),
       and the edges of the room that are real walls. A piece against a wall
       is slid along it from the preferred end until its footprint AND the
       floor in front of it (where you stand to use it) are clear. */
    function rectHit(r, list) {
      for (let i = 0; i < list.length; i++) {
        const k = list[i];
        if (r.x1 > k.x0 + 1e-4 && r.x0 < k.x1 - 1e-4 && r.z1 > k.z0 + 1e-4 && r.z0 < k.z1 - 1e-4) return true;
      }
      return false;
    }
    // edge: "x0" | "x1" | "z0" | "z1" (the wall the piece's back is on).
    // W along the wall, D deep, front clearance, t (0..1) where along the
    // wall to start looking. Returns {x, z, yaw (facing into the room),
    // rect (the piece), use (piece + front)} or null.
    function againstWall(R, blocks, edge, W, D, front, t, gap) {
      gap = gap == null ? 0.03 : gap;
      const alongX = edge === "z0" || edge === "z1";
      const lo = alongX ? R.x0 + W / 2 : R.z0 + W / 2, hi = alongX ? R.x1 - W / 2 : R.z1 - W / 2;
      if (hi < lo - 1e-6) return null;
      const start = lo + (hi - lo) * (t == null ? 0.5 : t);
      const cands = [start];
      for (let s = 0.15; s <= hi - lo + 0.15; s += 0.15) { cands.push(start + s, start - s); }
      for (const c of cands) {
        if (c < lo - 1e-6 || c > hi + 1e-6) continue;
        let rect, use, x, z, yaw;
        if (edge === "x1") { x = R.x1 - gap - D / 2; z = c; yaw = -Math.PI / 2;
          rect = { x0: R.x1 - gap - D, x1: R.x1, z0: c - W / 2, z1: c + W / 2 };
          use = { x0: rect.x0 - front, x1: R.x1, z0: rect.z0, z1: rect.z1 }; }
        else if (edge === "x0") { x = R.x0 + gap + D / 2; z = c; yaw = Math.PI / 2;
          rect = { x0: R.x0, x1: R.x0 + gap + D, z0: c - W / 2, z1: c + W / 2 };
          use = { x0: R.x0, x1: rect.x1 + front, z0: rect.z0, z1: rect.z1 }; }
        else if (edge === "z1") { z = R.z1 - gap - D / 2; x = c; yaw = Math.PI;
          rect = { x0: c - W / 2, x1: c + W / 2, z0: R.z1 - gap - D, z1: R.z1 };
          use = { x0: rect.x0, x1: rect.x1, z0: rect.z0 - front, z1: R.z1 }; }
        else { z = R.z0 + gap + D / 2; x = c; yaw = 0;
          rect = { x0: c - W / 2, x1: c + W / 2, z0: R.z0, z1: R.z0 + gap + D };
          use = { x0: rect.x0, x1: rect.x1, z0: R.z0, z1: rect.z1 + front }; }
        if (use.x0 < R.x0 - 1e-6 || use.x1 > R.x1 + 1e-6 || use.z0 < R.z0 - 1e-6 || use.z1 > R.z1 + 1e-6) continue;
        if (rectHit(use, blocks)) continue;
        return { x: x, z: z, yaw: yaw, rect: rect, use: use, edge: edge };
      }
      return null;
    }
    // Is the plan-view point (a along the wall of face s) inside a window?
    function windowOn(holes, s, a0, a1, yLo, yHi) {
      return holes.some(function (h) { return h.s === s && h.a1 > a0 && h.a0 < a1 && h.y1 > yLo && h.y0 < yHi; });
    }
    const EDGE_FACE = { x0: 2, x1: 3, z0: 0, z1: 1 };
    // Put a piece against the first wall (in `edges` order) where it fits;
    // a TALL piece never stands in front of a window.
    function placeOnWalls(R, blocks, edges, W, D, front, holes, tallY, t) {
      for (const e of edges) {
        const tries = [t == null ? 0.5 : t, 0.1, 0.9, 0.5];
        for (const tt of tries) {
          const p = againstWall(R, blocks, e, W, D, front, tt);
          if (!p) continue;
          if (tallY) {
            const s = EDGE_FACE[e], alongX = e === "z0" || e === "z1";
            const a0 = alongX ? p.rect.x0 : p.rect.z0, a1 = alongX ? p.rect.x1 : p.rect.z1;
            if (windowOn(holes, s, a0 - 0.05, a1 + 0.05, tallY[0], tallY[1])) {
              // slide on along this wall for a stretch with no window
              let ok = null;
              for (let s2 = 0; s2 <= 1.0001 && !ok; s2 += 0.1) {
                const q = againstWall(R, blocks, e, W, D, front, s2);
                if (!q) continue;
                const b0 = alongX ? q.rect.x0 : q.rect.z0, b1 = alongX ? q.rect.x1 : q.rect.z1;
                if (!windowOn(holes, s, b0 - 0.05, b1 + 0.05, tallY[0], tallY[1])) ok = q;
              }
              if (ok) return ok;
              continue;
            }
          }
          return p;
        }
      }
      return null;
    }

    // sample the terrain across a footprint so we only drop buildings on flat
    // ground (and learn the high point to sit the foundation on)
    function footprintTerrain(ox, oz, w, d) {
      let mx = -1e9, mn = 1e9;
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
        const h = groundHeightAt(ox + i * w * 0.5, oz + j * d * 0.5);
        if (h > mx) mx = h; if (h < mn) mn = h;
      }
      return { max: mx, min: mn };
    }

    // colours, all authored as the linear hexes this pipeline treats them as
    const IN_PAINTS = [0xe4ded2, 0xdad6cc, 0xd2d8cc, 0xe2d6c0, 0xd2d9de, 0xe6dbcf];
    const IN_CEIL = 0xefede6, IN_TRIM = 0xf1eee6, IN_STRUCT = 0x8e8a82;
    const IN_RUGS = [0x7a4a3a, 0x3f5566, 0x8a7d62, 0x5b6b4a, 0x6b3f4f, 0x9a8b74];
    const IN_BOOKS = [0x7b2f2a, 0x2f4a6b, 0x3d5a3a, 0xc9b98f, 0x5b3a5e, 0x2a2a2e, 0xa8672f, 0xd9d2c0];
    const WALNUT = 0x5a3e2a;

    /* A DOME LIGHT: a painted base plate and the diffuser under it, flush on
       the ceiling at (x, yc, z); registers its pool on the floor below. */
    function domeLight(K, x, yc, z, r, i) {
      K.box("flat", x, yc - 0.012, z, 0.3, 0.024, 0.3, IN_TRIM, 63 & ~4);
      K.disc("glow", x, yc - 0.032, z, 0.13, 10, true, 0xf6f0e0);
      K.light(x, yc, z, r || 3.0, i == null ? 0.26 : i);
    }
    // a pendant: cord, a dark shade, the glowing mouth of the shade
    function pendant(K, x, yc, z, drop) {
      const dy = drop || 0.75, sy = yc - dy;
      K.box("flat", x, yc - dy / 2, z, 0.012, dy, 0.012, 0x1c1c1c, 1 | 2 | 16 | 32);
      K.box("flat", x, yc - 0.02, z, 0.12, 0.04, 0.12, 0x2a2a2a, 63 & ~4);
      K.hexa("flat", [[x - 0.24, sy - 0.2, z - 0.24], [x + 0.24, sy - 0.2, z - 0.24], [x + 0.24, sy - 0.2, z + 0.24], [x - 0.24, sy - 0.2, z + 0.24],
        [x - 0.08, sy, z - 0.08], [x + 0.08, sy, z - 0.08], [x + 0.08, sy, z + 0.08], [x - 0.08, sy, z + 0.08]], 0x2d3a34);
      K.disc("glow", x, sy - 0.205, z, 0.2, 10, true, 0xfbe7bf);
      K.light(x, sy, z, 2.6, 0.36);
    }
    // a bookcase's stock: a row of books standing on each board (local to
    // the piece: lat across, up from the floor, fwd out of the front)
    function books(K, x, y, z, yaw, L, D, levels, salt) {
      const s = Math.sin(yaw), c = Math.cos(yaw), swap = (Math.round(yaw / (Math.PI / 2)) & 1) === 1;
      for (let li = 0; li < levels.length; li++) {
        let lat = -L / 2 + 0.09;
        let n = 0;
        while (lat < L / 2 - 0.12 && n < 14) {
          const hh = h01g(x + lat * 7.1, z + li * 3.3, salt + n);
          const bw = 0.028 + hh * 0.04, bh = 0.17 + h01g(x + n, z + lat, salt + 7) * 0.1, bd = Math.min(D - 0.08, 0.2 + hh * 0.06);
          if (h01g(lat * 13.7 + x, li + z, salt + 31) < 0.12) { lat += 0.09; n++; continue; }   // a gap on the shelf
          const col = IN_BOOKS[(h01g(x + lat * 3.1, z - li, salt + 17) * IN_BOOKS.length) | 0];
          const la = lat + bw / 2, fw = -D / 2 + 0.04 + bd / 2;
          const wx = x + la * c + fw * s, wz = z - la * s + fw * c;
          const w = swap ? bd : bw, dd = swap ? bw : bd;
          K.box("flat", wx, y + levels[li] + bh / 2, wz, w, bh, dd, col, 63 & ~8);
          lat += bw + 0.004;
          n++;
        }
      }
    }

    /* THE HOUSE INTERIOR. H: the shell's numbers (see makeBuilding). Draws
       into its own kit, flushes into the building group, and returns the
       sturdy pieces the quake's drop-cover-hold-on can use:
       [{x, y, z, r}] in world space. */
    function houseInterior(H) {
      const ox = H.ox, oz = H.oz, gy = H.gy, w = H.w, d = H.d, storeys = H.storeys;
      const ixMin = H.ixMin, ixMax = H.ixMax, izMin = H.izMin, izMax = H.izMax;
      const PL = H.plan, sEdge = PL.sEdge, laneW = SW / 2, rTop = storeys * FH;
      const hasStair = PL.flights.length > 0, roofUp = PL.roof.access;
      const hh = function (s) { return h01g(ox, oz, s); };
      const K = inKit(ox, oz);
      const cols = H.cols, covers = [];
      const holes = H.holes.slice();
      // the front door is a hole in the skin like any window
      holes.push({ s: 0, a0: -DOORW / 2, a1: DOORW / 2, y0: 0, y1: FH - 0.7 });

      const paint0 = IN_PAINTS[(hh(0x1a01) * IN_PAINTS.length) | 0];
      const paintUp = IN_PAINTS[(hh(0x1a02) * IN_PAINTS.length) | 0];
      const groundKey = hh(0x1a03) < 0.55 ? "wood" : "tile";
      const groundTint = groundKey === "wood"
        ? [0xffffff, 0xdcc6ad, 0xf1e5d6][(hh(0x1a04) * 3) | 0]
        : [0xffffff, 0xe3b596, 0xdcd6c8][(hh(0x1a05) * 3) | 0];
      const upTint = [0xffffff, 0xcdb096, 0xefe1cf][(hh(0x1a06) * 3) | 0];
      // one household's taste: upholstery, bed linen, the wood of the table
      const tone = {
        cloth: [0x6b7d8a, 0x8a5a2b, 0x5d6b4f, 0x9a8f80, 0x7a3b36, 0x4d5563][(hh(0x1a07) * 6) | 0],
        linen: [0xd9d4c8, 0x9fb0c0, 0xc9b79a, 0xb7c2b0][(hh(0x1a08) * 4) | 0],
        wood: [0x6b4a2a, 0x3a2b1e, 0x8a6a48][(hh(0x1a09) * 3) | 0],
        frame: [0x4a4036, 0x2e2620, 0x6f5139][(hh(0x1a0a) * 3) | 0],
      };
      const fyOf = function (L) { return L === 0 ? 0.08 : L * FH; };
      const ceilOf = function (L) { return (L + 1) * FH - 0.2; };
      const landingAt = function (L) { for (const l of H.landings) if (l.L === L) return l; return null; };

      /* ---- FURNITURE FIRST (the fixtures hang over it, the floors pool the
         fixtures' light), room by room ---------------------------------- */
      const fixtures = [];      // {kind, x, z, L}
      // GROUND FLOOR: a living-dining room. The strip down the -x side is the
      // stair, the band along the front wall is the walk from the door to the
      // foot of the stair: both stay clear.
      {
        const fy = fyOf(0);
        const R = { x0: hasStair ? sEdge + 0.35 : ixMin + 0.35, x1: ixMax, z0: izMin + 1.3, z1: izMax };
        const blocks = [{ x0: -DOORW / 2 - 0.7, x1: DOORW / 2 + 0.7, z0: izMin, z1: izMin + 2.4 }];
        const host = furnHost(K, ox, oz, gy, cols, fy, null);
        // the windows of this storey, in plan (for "a table goes by a window")
        const wins = holes.filter(function (h) { return h.y0 > 0.3 && h.y0 < FH && h.s !== 0; }).map(function (h) {
          const a = (h.a0 + h.a1) / 2;
          return h.s === 1 ? [a, izMax] : h.s === 3 ? [ixMax, a] : [ixMin, a];
        });
        // 1. THE TABLE: the biggest one that fits with its chairs pulled out
        //    and a walkway round it, by a window. It is also the island's
        //    lesson in drop-cover-hold-on, so every house gets one it can.
        const TIERS = [{ len: 1.6, deep: 0.9, seats: 4 }, { len: 1.2, deep: 0.8, seats: 2 }, { len: 0.9, deep: 0.7, seats: 0 }];
        let table = null;
        for (const T of TIERS) {
          let best = null;
          for (let yi = 0; yi < 2 && !best; yi++) {
            const hx0 = T.len / 2 + 0.05, hz0 = T.deep / 2 + (T.seats ? 0.42 + 0.28 : 0.05);
            const hx = (yi ? hz0 : hx0) + 0.3, hz = (yi ? hx0 : hz0) + 0.3;
            for (let x = R.x0 + hx; x <= R.x1 - hx + 1e-6; x += 0.1) {
              for (let z = R.z0 + hz; z <= R.z1 - hz + 1e-6; z += 0.1) {
                const r = { x0: x - hx, x1: x + hx, z0: z - hz, z1: z + hz };
                if (rectHit(r, blocks)) continue;
                let dw = 6;
                for (const wv of wins) dw = Math.min(dw, Math.hypot(wv[0] - x, wv[1] - z));
                const score = dw + 0.25 * Math.hypot(x - (R.x0 + R.x1) / 2, z - (R.z0 + R.z1) / 2) + (yi ? 0.05 : 0);
                if (!best || score < best.score) best = { x: x, z: z, yaw: yi ? Math.PI / 2 : 0, rect: r, score: score };
              }
            }
          }
          if (best) { table = { T: T, p: best }; break; }
        }
        if (table) {
          const P = table.p, T = table.T;
          furnish("table", host, P.x, fy, P.z, P.yaw, { seats: T.seats, len: T.len, deep: T.deep, tone: tone });
          blocks.push(P.rect);
          covers.push({ x: ox + P.x, y: gy + fy, z: oz + P.z, r: T.seats ? 1.0 : 0.75 });
          fixtures.push({ kind: "pendant", x: P.x, z: P.z, L: 0 });
        }
        // 2. THE SOFA, back to a wall, facing into the room, with a coffee
        //    table and a rug in front of it and a lamp at its end
        const roomW = R.x1 - R.x0;
        const sofaLen = roomW > 3.4 ? 2.1 : roomW > 2.4 ? 1.7 : 0;
        let sofa = null;
        if (sofaLen) sofa = placeOnWalls(R, blocks, ["z1", "x1"], sofaLen, 0.87, 1.3, holes, null, 0.5);
        if (sofa) {
          furnish("sofa", host, sofa.x, fy, sofa.z, sofa.yaw, { len: sofaLen, tone: tone });
          blocks.push(sofa.use);
          const fx = Math.sin(sofa.yaw), fz = Math.cos(sofa.yaw);
          const cx = sofa.x + fx * 1.05, cz = sofa.z + fz * 1.05;
          const cl = Math.min(1.1, sofaLen * 0.55);
          const rugC = IN_RUGS[(hh(0x1a11) * IN_RUGS.length) | 0];
          const rugA = sofaLen + 0.3, rugB = 1.7;
          const along = Math.abs(fx) < 0.5;       // sofa along x (back on a z wall)
          K.box("flat", sofa.x + fx * 0.95, fy + 0.006, sofa.z + fz * 0.95, along ? rugA : rugB, 0.012, along ? rugB : rugA, rugC, 63 & ~8);
          furnish("coffee", host, cx, fy + 0.012, cz, sofa.yaw, { len: cl, deep: 0.55, tone: tone });
          // floor lamp at the sofa's left end, if there is floor there
          const lx = sofa.x + (along ? -(sofaLen / 2 + 0.3) : 0), lz = sofa.z + (along ? 0 : -(sofaLen / 2 + 0.3));
          const lr = { x0: lx - 0.2, x1: lx + 0.2, z0: lz - 0.2, z1: lz + 0.2 };
          if (lr.x0 >= R.x0 && lr.x1 <= R.x1 && lr.z0 >= R.z0 && lr.z1 <= R.z1 && !rectHit(lr, blocks)) {
            furnish("lamp", host, lx, fy, lz, 0, { h: 1.5, ei: 0.6 });
            K.light(lx, fy + 1.5, lz, 2.0, 0.18);
            blocks.push(lr);
          }
          fixtures.push({ kind: "dome", x: sofa.x + fx * 1.2, z: sofa.z + fz * 1.2, L: 0 });
        }
        // 3. A BOOKCASE on a wall with no window behind it
        const bc = placeOnWalls(R, blocks, ["x1", "z1"], 0.9, 0.36, 0.6, holes, [0.1, 1.95], 0.85);
        if (bc) {
          const yawB = bc.yaw;
          furnish("shelf", furnHost(K, ox, oz, gy, cols, fy, { 0x49505b: WALNUT, 0x8a939c: 0x6f5139 }), bc.x, fy, bc.z, yawB, { len: 0.9, deep: 0.34, h: 1.9 });
          const gap = (1.9 - 0.35) / 4;
          books(K, bc.x, fy, bc.z, yawB, 0.9, 0.34, [0.30, 0.30 + gap + 0.05, 0.30 + 2 * gap + 0.05, 0.30 + 3 * gap + 0.05], 0x5b00 + (hh(0x1a12) * 999 | 0));
          blocks.push(bc.use);
        }
        // the entry: a light inside the door
        fixtures.push({ kind: "dome", x: 0, z: izMin + 1.0, L: 0 });
        if (!sofa && !table) fixtures.push({ kind: "dome", x: (R.x0 + R.x1) / 2, z: (R.z0 + R.z1) / 2, L: 0 });
      }
      // UPPER FLOORS: a bedroom, then a study. The landing and the way off
      // it stay clear.
      for (let L = 1; L < storeys; L++) {
        const fy = fyOf(L);
        const R = { x0: sEdge + 0.12, x1: ixMax, z0: izMin, z1: izMax };
        const lg = landingAt(L);
        const blocks = lg ? [{ x0: sEdge, x1: sEdge + 1.25, z0: lg.z0 - 0.25, z1: lg.z1 + 0.25 }] : [];
        const host = furnHost(K, ox, oz, gy, cols, fy, null);
        const roomW = R.x1 - R.x0, roomD = R.z1 - R.z0;
        let desk = null, bed = null;
        if (L === 1) {
          const wide = roomW >= 3.1 && roomD >= 3.1 ? 1.4 : 0.9;
          const BL = 2.0;
          bed = placeOnWalls(R, blocks, ["z1", "x1", "z0"], wide + 0.14 + (roomW > wide + 1.3 ? 1.0 : 0), BL + 0.13, 0.7, holes, null, 0.5);
          if (bed) {
            const yawBed = bed.yaw + Math.PI;           // yaw points at the pillow = at the wall
            const fx = Math.sin(bed.yaw), fz = Math.cos(bed.yaw);
            const bx = bed.x + fx * 0.06, bz = bed.z + fz * 0.06;
            furnish("bed", host, bx, fy, bz, yawBed, { len: BL, wide: wide, tone: tone });
            blocks.push(bed.use);
            // nightstands either side of the head, each with a small lamp
            const along = Math.abs(fx) < 0.5;
            // nightstand centres 25 cm off the wall the headboard is on
            const toHead = (BL + 0.13) / 2 + 0.03 - 0.25;
            const headX = bed.x - fx * toHead, headZ = bed.z - fz * toHead;
            for (let sd = -1; sd <= 1; sd += 2) {
              const off = wide / 2 + 0.34;
              const nx = headX + (along ? sd * off : 0), nz = headZ + (along ? 0 : sd * off);
              const nr = { x0: nx - 0.23, x1: nx + 0.23, z0: nz - 0.23, z1: nz + 0.23 };
              if (nr.x0 < R.x0 || nr.x1 > R.x1 || nr.z0 < R.z0 || nr.z1 > R.z1) continue;
              K.box("flat", nx, fy + 0.27, nz, 0.44, 0.54, 0.4, WALNUT, 63 & ~8);
              K.box("flat", nx, fy + 0.56, nz, 0.46, 0.03, 0.42, 0x6f5139);
              K.box("flat", nx, fy + 0.6, nz, 0.1, 0.05, 0.1, 0x3a3a3a);
              K.box("flat", nx, fy + 0.72, nz, 0.02, 0.2, 0.02, 0x3a3a3a);
              K.box("glow", nx, fy + 0.86, nz, 0.2, 0.17, 0.2, 0xf3dcae);
              K.light(nx, fy + 0.9, nz, 1.4, 0.14);
            }
            // a runner at the foot of the bed
            const footX = bed.x + fx * (BL / 2 + 0.55), footZ = bed.z + fz * (BL / 2 + 0.55);
            const rugC = IN_RUGS[(hh(0x1a21 + L) * IN_RUGS.length) | 0];
            K.box("flat", footX, fy + 0.006, footZ, along ? wide + 0.5 : 0.8, 0.012, along ? 0.8 : wide + 0.5, rugC, 63 & ~8);
            fixtures.push({ kind: "dome", x: bed.x + fx * 0.6, z: bed.z + fz * 0.6, L: L });
          }
          // a wardrobe on a wall with no window behind it
          const wd = placeOnWalls(R, blocks, ["x1", "z0", "z1"], 1.2, 0.6, 0.8, holes, [fy + 0.1, fy + 2.1], 0.5);
          if (wd) {
            const fx = Math.sin(wd.yaw), fz = Math.cos(wd.yaw), along = Math.abs(fx) < 0.5;
            const carc = [0xe6e0d4, WALNUT, 0xcfc5b4][(hh(0x1a31 + L) * 3) | 0];
            K.box("flat", wd.x, fy + 1.0, wd.z, along ? 1.2 : 0.6, 2.0, along ? 0.6 : 1.2, carc, 63 & ~8);
            // the doors' meeting line and two handles, on the front face
            const fxp = wd.x + fx * 0.302, fzp = wd.z + fz * 0.302;
            K.box("flat", fxp, fy + 1.02, fzp, along ? 0.01 : 0.006, 1.9, along ? 0.006 : 0.01, 0x2b2622);
            for (let sd = -1; sd <= 1; sd += 2) {
              const hx = fxp + fx * 0.012 + (along ? sd * 0.07 : 0), hz = fzp + fz * 0.012 + (along ? 0 : sd * 0.07);
              K.box("flat", hx, fy + 1.05, hz, 0.02, 0.22, 0.02, 0x8d8f91);
            }
            const c = { minX: ox + wd.rect.x0, maxX: ox + wd.rect.x1, minZ: oz + wd.rect.z0, maxZ: oz + wd.rect.z1, ref: null, y0: gy + fy, y1: gy + fy + 2.0 };
            CBZ.colliders.push(c); cols.push(c);
            blocks.push(wd.use);
          }
        }
        // a desk to work at (and to get under), under or beside a window
        desk = placeOnWalls(R, blocks, ["x1", "z1", "z0"], 1.3, 0.62, 0.95, holes, null, 0.5);
        if (desk) {
          furnish("desk", host, desk.x, fy, desk.z, desk.yaw + Math.PI, { len: 1.3, deep: 0.62 });
          blocks.push(desk.use);
          covers.push({ x: ox + desk.x, y: gy + fy, z: oz + desk.z, r: 0.75 });
        }
        if (!bed) {
          // a study: a bookcase and an armchair to read in
          const bc = placeOnWalls(R, blocks, ["z1", "x1", "z0"], 0.9, 0.36, 0.6, holes, [fy + 0.1, fy + 1.95], 0.2);
          if (bc) {
            furnish("shelf", furnHost(K, ox, oz, gy, cols, fy, { 0x49505b: WALNUT, 0x8a939c: 0x6f5139 }), bc.x, fy, bc.z, bc.yaw, { len: 0.9, deep: 0.34, h: 1.9 });
            const gap = (1.9 - 0.35) / 4;
            books(K, bc.x, fy, bc.z, bc.yaw, 0.9, 0.34, [0.30, 0.30 + gap + 0.05, 0.30 + 2 * gap + 0.05, 0.30 + 3 * gap + 0.05], 0x5c00 + L);
            blocks.push(bc.use);
          }
          const ac = placeOnWalls(R, blocks, ["z1", "x1"], 0.95, 0.92, 0.6, holes, null, 0.8);
          if (ac) { furnish("armchair", host, ac.x, fy, ac.z, ac.yaw, { tone: tone }); blocks.push(ac.use); }
        }
        fixtures.push({ kind: "dome", x: (R.x0 + R.x1) / 2, z: (R.z0 + R.z1) / 2, L: L });
      }
      // lay the ceiling fixtures (and their light) before the floors are laid
      const domes = [];
      for (const fx of fixtures) {
        // two domes closer than 1.4 m are one
        if (fx.kind === "dome" && domes.some(function (o) { return o.L === fx.L && Math.hypot(o.x - fx.x, o.z - fx.z) < 1.4; })) continue;
        if (fx.kind === "dome") domes.push(fx);
        const yc = ceilOf(fx.L);
        const x = Math.max(sEdge + 0.3, Math.min(ixMax - 0.3, fx.x)), z = Math.max(izMin + 0.3, Math.min(izMax - 0.3, fx.z));
        if (fx.kind === "pendant") pendant(K, x, yc, z, 1.15);   // shade ~1 m over the table top
        else domeLight(K, x, yc, z);
      }
      // a light under every landing, for the flight below it
      for (const lg of H.landings) domeLight(K, (lg.x0 + lg.x1) / 2, lg.y - 0.2, (lg.z0 + lg.z1) / 2, 2.6, 0.2);

      /* ---- FLOORS AND CEILINGS ----------------------------------------- */
      K.plane(groundKey, ixMin, izMin, ixMax, izMax, 0.08, groundTint, false, K.floorLit(0.08));
      for (let L = 1; L <= storeys; L++) {
        const roof = L === storeys, y = L * FH;
        const lg = landingAt(L);
        // a roof nobody climbs to is closed over the stair strip: one slab
        const closed = roof && !roofUp;
        const x0 = closed ? ixMin : sEdge;
        const key = roof ? "concrete" : "wood", tint = roof ? 0x9a978f : upTint;
        const lit = roof ? null : K.floorLit(y);
        K.plane(key, x0, izMin, ixMax, izMax, y, tint, false, lit);
        if (lg && !closed) K.plane(key, lg.x0, lg.z0, lg.x1, lg.z1, y, tint, false, lit);
        // the ceiling of the storey below, under the slab and the landing
        const yc = y - 0.2, cl = K.ceilLit(yc);
        K.plane("plaster", x0, izMin, ixMax, izMax, yc, IN_CEIL, true, cl);
        if (lg && !closed) K.plane("plaster", lg.x0, lg.z0, lg.x1, lg.z1, yc, IN_CEIL, true, cl);
        // the slab's edge where it meets the stairwell, painted (the 20 cm
        // of concrete you see from the stair), and the landing's inner edge
        if (!closed) {
          const segs = lg ? (lg.z0 <= izMin + 0.01 ? [[lg.z1, izMax]] : [[izMin, lg.z0]]) : [[izMin, izMax]];
          for (const sg of segs) if (sg[1] - sg[0] > 0.02)
            K.quad("plaster", [sEdge - 0.004, yc, sg[0]], [sEdge - 0.004, yc, sg[1]], [sEdge - 0.004, y, sg[1]], [sEdge - 0.004, y, sg[0]], [-1, 0, 0], paintUp);
        }
        if (lg && !closed) {
          const zi = lg.z0 <= izMin + 0.01 ? lg.z1 : lg.z0, sgn = lg.z0 <= izMin + 0.01 ? 1 : -1;
          K.quad("plaster", [lg.x0, yc, zi + sgn * 0.004], [lg.x1, yc, zi + sgn * 0.004], [lg.x1, y, zi + sgn * 0.004], [lg.x0, y, zi + sgn * 0.004], [0, 0, sgn], paintUp);
        }
        if (roof) {
          // the membrane turns up the inside of the parapets
          K.box("concrete", (x0 + ixMax) / 2, y + 0.075, izMax - 0.01, ixMax - x0, 0.15, 0.02, 0x8a877f, 4 | 32);
          K.box("concrete", (x0 + ixMax) / 2, y + 0.075, izMin + 0.01, ixMax - x0, 0.15, 0.02, 0x8a877f, 4 | 16);
          K.box("concrete", ixMax - 0.01, y + 0.075, (izMin + izMax) / 2, 0.02, 0.15, izMax - izMin - 0.04, 0x8a877f, 4 | 2);
          if (closed) K.box("concrete", ixMin + 0.01, y + 0.075, (izMin + izMax) / 2, 0.02, 0.15, izMax - izMin - 0.04, 0x8a877f, 4 | 1);
        }
      }
      // a dog-leg's half landings: floor, ceiling and their two edges
      for (const lg of H.landings) {
        if (lg.L % 1 === 0) continue;
        const y = lg.y, yc = y - 0.2;
        K.plane("wood", lg.x0, lg.z0, lg.x1, lg.z1, y, upTint, false, K.floorLit(y));
        K.plane("plaster", lg.x0, lg.z0, lg.x1, lg.z1, yc, IN_CEIL, true, K.ceilLit(yc));
        const zi = lg.z0 <= izMin + 0.01 ? lg.z1 : lg.z0, sgn = lg.z0 <= izMin + 0.01 ? 1 : -1;
        K.quad("plaster", [lg.x0, yc, zi + sgn * 0.004], [lg.x1, yc, zi + sgn * 0.004], [lg.x1, y, zi + sgn * 0.004], [lg.x0, y, zi + sgn * 0.004], [0, 0, sgn], paintUp);
        K.quad("plaster", [lg.x1 + 0.004, yc, lg.z0], [lg.x1 + 0.004, yc, lg.z1], [lg.x1 + 0.004, y, lg.z1], [lg.x1 + 0.004, y, lg.z0], [1, 0, 0], paintUp);
      }
      /* ---- WALLS: plaster skin, skirting, window reveals, the door ------ */
      const faces = [
        { s: 0, n: -d / 2 + WT, inward: 1, a0: ixMin, a1: ixMax, glassN: -(d / 2 - 0.07) },
        { s: 1, n: d / 2 - WT, inward: -1, a0: ixMin, a1: ixMax, glassN: d / 2 - 0.07 },
        { s: 2, n: -w / 2 + WT, inward: 1, a0: izMin, a1: izMax, glassN: -(w / 2 - 0.07) },
        { s: 3, n: w / 2 - WT, inward: -1, a0: izMin, a1: izMax, glassN: w / 2 - 0.07 },
      ];
      for (let L = 0; L < storeys; L++) {
        const lg = L > 0 ? landingAt(L) : null;
        const y0 = L === 0 ? 0.08 : L * FH - 0.2;
        const y1 = L === storeys - 1 ? rTop : ceilOf(L);
        const paint = L === 0 ? paint0 : paintUp;
        for (const f of faces) {
          let skirt = null;
          if (L > 0) {
            if (f.s === 2) skirt = lg ? [[lg.z0, lg.z1]] : [];
            else if (f.s === 3) skirt = null;
            else {
              skirt = [[sEdge, ixMax]];
              if (lg && ((f.s === 0 && lg.z0 <= izMin + 0.01) || (f.s === 1 && lg.z1 >= izMax - 0.01))) skirt.push([ixMin, sEdge]);
            }
          }
          skinFace(K, { s: f.s, n: f.n, inward: f.inward, a0: f.a0, a1: f.a1, y0: y0, y1: y1, skirt: skirt,
            glassN: f.glassN, floor: L === 0 ? 0.08 : L * FH }, holes, paint, IN_TRIM);
        }
      }
      doorTrim(K, DOORW / 2, -d / 2, -d / 2 + WT, 0.08, FH - 0.7, IN_TRIM, 0x8f8a80);

      /* ---- THE STAIR ------------------------------------------------------
         Each flight is a closed stair: oak treads with a nosing over painted
         risers on a solid body whose underside is the sloped soffit, between
         two stringers, with a rail on every open side. Drawn from the plan's
         flight record (world/island_building.js), over the SAME treads its
         walk surface is: riser i at zb + i·going, tread i's top yb + i·rise,
         the last riser onto the landing at zt. */
      const railAlong = function (F, xr, pitch) {
        // newels at both ends, balusters, a sloped oak handrail 0.9 m over
        // the pitch line
        const zr0 = F.zb + F.dir * 0.15, zr1 = F.zt - F.dir * 0.1;
        const RH = 0.9;
        const hr0 = pitch(zr0) + RH, hr1 = pitch(zr1) + RH;
        K.hexa("flat", [[xr - 0.03, hr0 - 0.05, zr0], [xr + 0.03, hr0 - 0.05, zr0], [xr + 0.03, hr1 - 0.05, zr1], [xr - 0.03, hr1 - 0.05, zr1],
          [xr - 0.03, hr0, zr0], [xr + 0.03, hr0, zr0], [xr + 0.03, hr1, zr1], [xr - 0.03, hr1, zr1]], 0x5c3d26);
        for (const zn of [zr0, zr1]) {
          const yb = pitch(zn) + 0.02, yt = pitch(zn) + RH + 0.08;
          K.box("flat", xr, (yb + yt) / 2, zn, 0.08, yt - yb, 0.08, 0x5c3d26);
        }
        const nb = Math.max(2, Math.floor(Math.abs(zr1 - zr0) / 0.36));
        for (let j = 1; j < nb; j++) {
          const zn = zr0 + (zr1 - zr0) * j / nb;
          const yb = pitch(zn) + 0.04, yt = pitch(zn) + RH - 0.05;
          K.box("flat", xr, (yb + yt) / 2, zn, 0.025, yt - yb, 0.025, IN_TRIM, 1 | 2 | 16 | 32);
        }
      };
      for (const F of H.flights) {
        const dir = F.dir, g = F.going, rise = F.rise, n = F.risers;
        const xa = F.x0 + 0.04, xb = F.x1 - 0.04;
        // the pitch line, through every nosing (riser i's top edge)
        const pitch = function (z) { return F.yb + rise + (z - F.zb) * dir / g * rise; };
        const floorClamp = F.L0 === 0 ? 0.08 : F.yb - 0.2;
        const ySoff = function (z) { return Math.max(floorClamp, pitch(z) - 0.32); };
        for (let i = 1; i < n; i++) {
          const z0 = F.zb + dir * (i - 1) * g, z1 = F.zb + dir * i * g;
          const top = F.yb + i * rise;
          // the body under this tread: flat top, sloped bottom (the soffit)
          const za = Math.min(z0, z1), zb2 = Math.max(z0, z1);
          const ya = ySoff(za), yb = ySoff(zb2), yt = top - 0.035;
          K.hexa("plaster", [[xa, ya, za], [xb, ya, za], [xb, yb, zb2], [xa, yb, zb2],
            [xa, yt, za], [xb, yt, za], [xb, yt, zb2], [xa, yt, zb2]], IN_TRIM);
          // the tread, 35 mm oak, its nosing 25 mm over the riser below
          const zn = z0 - dir * 0.025;
          K.box("wood", (xa + xb) / 2, top - 0.0175, (zn + z1) / 2, xb - xa, 0.035, Math.abs(z1 - zn), upTint);
        }
        // (the last riser is the landing slab's own edge at zt)
        // stringers both sides: a sloped board from the soffit to over the nosings
        const zS = F.zb, zE = F.zt;
        for (let sd = 0; sd < 2; sd++) {
          const x0 = sd ? xb : F.x0 + 0.005, x1 = sd ? F.x1 - 0.005 : xa;
          const b0 = ySoff(zS) - 0.02, b1 = ySoff(zE) - 0.02, t0 = pitch(zS) + 0.07, t1 = pitch(zE) + 0.07;
          K.hexa("flat", [[x0, b0, zS], [x1, b0, zS], [x1, b1, zE], [x0, b1, zE],
            [x0, t0, zS], [x1, t0, zS], [x1, t1, zE], [x0, t1, zE]], IN_TRIM);
        }
        // a rail on every open side (the plan's guards are its colliders)
        for (const xo of F.open || []) railAlong(F, xo === F.x1 ? F.x1 - 0.03 : F.x0 + 0.03, pitch);
      }
      // THE STAIRWELL EDGES: a painted knee wall under an oak cap along each
      // upper floor's slab edge (open only where the landing meets the
      // floor), along a half landing's room side, and across the top
      // landing's edge over the well. The plan's guards; makeBuilding laid
      // their colliders.
      for (const gd of PL.guards) {
        if (gd.kind === "rail") continue;
        const yb = gd.y0, h = gd.y1 - gd.y0 - 0.04;
        const along = gd.z1 - gd.z0 > gd.x1 - gd.x0;
        const cx = (gd.x0 + gd.x1) / 2, cz = (gd.z0 + gd.z1) / 2;
        const lx = gd.x1 - gd.x0, lz = gd.z1 - gd.z0;
        K.box("plaster", cx, yb + h / 2, cz, lx, h, lz, gd.L >= storeys ? 0xd8d4ca : paintUp, 63 & ~8);
        K.box("flat", cx, yb + h + 0.02, cz, along ? 0.14 : lx + 0.02, 0.04, along ? lz + 0.02 : 0.14, 0x5c3d26);
      }

      /* ---- THE ROOF ------------------------------------------------------
         The stair arrives in a BULKHEAD: the building's own walls carried up
         a storey round the stair, roofed, with a doorway onto the roof where
         the top landing is. Only on a roof the plan says is a place (no crown
         in the stairwell or over the roof, a clear apron at the door); every
         other roof is closed over the strip and has no way up. */
      const BH = IB.BH, bx1 = sEdge + IB.BXT;
      const crownIn = function (x0, x1, z0, z1, y0, y1) {
        for (const c of H.crown) if (c[1] > x0 && c[0] < x1 && c[5] > z0 && c[4] < z1 && c[3] > y0 && c[2] < y1) return true;
        return false;
      };
      const late = H.late;             // shell boxes laid after the facade flush
      const wallBox = function (x0, x1, z0, z1, y0, y1, solid) {
        late.push([(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, x1 - x0, y1 - y0, z1 - z0, H.color, true]);
        if (solid) {
          const c = { minX: ox + x0, maxX: ox + x1, minZ: oz + z0, maxZ: oz + z1, ref: null, y0: gy + y0, y1: gy + y1 };
          CBZ.colliders.push(c); cols.push(c);
        }
      };
      const BK = PL.roof.bulkhead;
      if (BK) {
        const yA = BK.y0, yB = BK.y1, DH = BK.doorH;
        const dz0 = PL.roof.door.z0, dz1 = PL.roof.door.z1;
        for (const wl of BK.walls) wallBox(wl.x0, wl.x1, wl.z0, wl.z1, wl.y0, wl.y1, wl.solid);
        // its roof: a slab, and over it the roofing, lapped 4 cm over every
        // edge as a drip; a ceiling under it
        late.push([(-w / 2 + bx1) / 2, yB + 0.0825, 0, bx1 + w / 2, 0.165, d, IN_STRUCT, true]);
        K.box("flat", (-w / 2 + bx1) / 2, yB + 0.195, 0, bx1 + w / 2 + 0.08, 0.06, d + 0.08, 0x8d8a83, 63 & ~8);
        // inside: plaster on the three walls and the door wall's back, a light
        const P2 = 0xd8d4ca;
        K.quad("plaster", [-w / 2 + WT + 0.006, rTop - 0.2, izMin], [-w / 2 + WT + 0.006, rTop - 0.2, izMax], [-w / 2 + WT + 0.006, yB, izMax], [-w / 2 + WT + 0.006, yB, izMin], [1, 0, 0], P2);
        K.quad("plaster", [ixMin, rTop - 0.2, izMin + 0.006], [sEdge, rTop - 0.2, izMin + 0.006], [sEdge, yB, izMin + 0.006], [ixMin, yB, izMin + 0.006], [0, 0, 1], P2);
        K.quad("plaster", [ixMin, rTop - 0.2, izMax - 0.006], [sEdge, rTop - 0.2, izMax - 0.006], [sEdge, yB, izMax - 0.006], [ixMin, yB, izMax - 0.006], [0, 0, -1], P2);
        for (const r of solidRects(izMin, izMax, yA, yB, [{ a0: dz0, a1: dz1, y0: yA - 1, y1: yA + DH }]))
          K.quad("plaster", [sEdge - 0.006, r[2], r[0]], [sEdge - 0.006, r[2], r[1]], [sEdge - 0.006, r[3], r[1]], [sEdge - 0.006, r[3], r[0]], [-1, 0, 0], P2);
        K.plane("plaster", ixMin, izMin, sEdge, izMax, yB - 0.002, IN_CEIL, true, null);
        // the doorway's lining (the 12 cm reveal) and a threshold
        K.box("flat", sEdge + 0.06, yA + DH - 0.01, (dz0 + dz1) / 2, 0.12, 0.02, dz1 - dz0, IN_TRIM, 8);
        K.box("flat", sEdge + 0.06, yA + DH / 2, dz0 + 0.008, 0.12, DH, 0.016, IN_TRIM, 16);
        K.box("flat", sEdge + 0.06, yA + DH / 2, dz1 - 0.008, 0.12, DH, 0.016, IN_TRIM, 32);
        domeLight(K, ixMin + SW / 2, yB - 0.002, (izMin + izMax) / 2, 2.4, 0.2);
      }
      // the roof plant stays off the apron outside the bulkhead door
      const apronX1 = BK ? bx1 + IB.APRON + 0.2 : -Infinity;
      const onApron = function (x0, x1, z0, z1) {
        return BK && x0 < apronX1 && z1 > PL.roof.door.z0 - 0.2 && z0 < PL.roof.door.z1 + 0.2;
      };
      // ROOF PLANT: a condenser on a curb at the back of the roof (the thing
      // a flat roof actually carries), and two vent stacks, clear of the
      // stair, the parapet and any crown the facade stood there
      const hvacAt = function (x, z) {
        const hx = 0.5, hz = 0.5;
        if (x - hx < sEdge + 0.9 || x + hx > ixMax - 0.25 || z - hz < izMin + 0.25 || z + hz > izMax - 0.25) return false;
        if (crownIn(x - hx, x + hx, z - hz, z + hz, rTop, rTop + 1.1) || onApron(x - hx, x + hx, z - hz, z + hz)) return false;
        const y = rTop;
        K.box("flat", x, y + 0.05, z, 1.0, 0.1, 1.0, 0x55585c, 63 & ~8);
        K.box("flat", x, y + 0.46, z, 0.9, 0.72, 0.9, 0xb4b6b3, 63 & ~8);
        for (let j = 0; j < 5; j++) {
          const yy = y + 0.2 + j * 0.11;
          K.box("flat", x, yy, z - 0.452, 0.8, 0.018, 0.006, 0x3a3d40, 32);
          K.box("flat", x, yy, z + 0.452, 0.8, 0.018, 0.006, 0x3a3d40, 16);
          K.box("flat", x - 0.452, yy, z, 0.006, 0.018, 0.8, 0x3a3d40, 2);
          K.box("flat", x + 0.452, yy, z, 0.006, 0.018, 0.8, 0x3a3d40, 1);
        }
        K.disc("flat", x, y + 0.823, z, 0.34, 16, false, 0x2a2c2f);
        K.disc("flat", x, y + 0.826, z, 0.08, 8, false, 0x6d7073);
        const c = { minX: ox + x - hx, maxX: ox + x + hx, minZ: oz + z - hz, maxZ: oz + z + hz, ref: null, y0: gy + y, y1: gy + y + 0.84 };
        CBZ.colliders.push(c); cols.push(c);
        return true;
      };
      if (!H.crownsRoof && !hvacAt(ixMax - 0.95, izMax - 0.95)) hvacAt(ixMax - 0.95, izMin + 0.95);
      if (!H.crownsRoof) for (let j = 0; j < 2; j++) {
        const vx = sEdge + 1.2 + j * 0.9, vz = izMax - 0.35;
        if (vx > ixMax - 1.6 || crownIn(vx - 0.1, vx + 0.1, vz - 0.1, vz + 0.1, rTop, rTop + 0.6) || onApron(vx - 0.1, vx + 0.1, vz - 0.1, vz + 0.1)) continue;
        K.box("flat", vx, rTop + 0.28, vz, 0.11, 0.56, 0.11, 0x5f6164, 63 & ~8);
        K.box("flat", vx, rTop + 0.58, vz, 0.16, 0.04, 0.16, 0x4a4c4f);
        const c = { minX: ox + vx - 0.08, maxX: ox + vx + 0.08, minZ: oz + vz - 0.08, maxZ: oz + vz + 0.08, ref: null, y0: gy + rTop, y1: gy + rTop + 0.6 };
        CBZ.colliders.push(c); cols.push(c);
      }

      K.flush(H.group, false);
      return covers;
    }

    /* ---- A BUILDING THAT FACES ITS STREET ---------------------------------
       makeBuilding lays every record (colliders, walk platforms, stair ramps
       and their AI links, glass panes, cover anchors) in world space as if
       the door were on -z, which it always was. A lot on the far side of a
       street needs its door on +z, -x or +x: the group turns (rotation.y =
       yaw, a quarter turn at a time) and every record the build appended is
       turned with it about the building's origin, so physics, AI and glass
       agree with what is drawn. A quarter turn keeps every AABB an AABB. */
    /* ---- ONE DRAW FOR A BUILDING'S SHELL -----------------------------------
       A house came out of the builder as ~40 meshes: thirteen wall boxes
       (each a collider's ref and a line-of-sight blocker), one merged mesh
       per facade colour (a dozen and more), the roof bulkhead, the door
       leaves. Every piece wears finishMat(colour, foot) — the same grime
       shader, a different colour. So the colour moves into the vertices and
       the whole opaque shell draws as ONE mesh in one white vertex-coloured
       grime material per foot height: the same lit pixel (lambert = light x
       colour x vertex colour either way), a twentieth of the draw calls.
       The originals a collider or the line-of-sight list points at stay in
       the group, hidden (r128's raycaster does not skip invisible meshes, and
       collision reads the rects), so physics, AI sight and collider.ref keep
       working; everything else is disposed. Glass (it shatters pane by
       pane), the interior (its own textures), lamps and anything moving stay
       their own meshes. The building group is untouched as a whole, so a
       quake still topples it as one piece and city/collapse.js still reads
       its solids (the baked shell carries its vertex colours into the
       fall). */
    const bakedMats = new Map();
    function bakedMat(gy) {
      const key = Math.round(gy * 5);
      let m = bakedMats.get(key);
      if (m) return m;
      m = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true });
      m.onBeforeCompile = grimeCompile({ value: key / 5 });
      m.customProgramCacheKey = grimeKey;
      m.name = "island-shell";
      m._shared = true;
      bakedMats.set(key, m);
      return m;
    }
    const _finSet = new Set();
    const _bm = new THREE.Matrix4(), _bn = new THREE.Matrix3(), _bv = new THREE.Vector3();
    let bakeStats = { buildings: 0, meshesIn: 0, meshesOut: 0, hidden: 0 };
    function bakeShell(group, gy) {
      _finSet.clear();
      finMats.forEach(function (m) { _finSet.add(m); });
      group.updateMatrixWorld(true);
      const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
      const keep = new Set();
      for (const c of CBZ.colliders) if (c.ref && c.ref.isMesh) keep.add(c.ref);
      const losSet = new Set(CBZ.losBlockers || []);
      const take = [];
      let total = 0;
      const rooms = group.userData.rooms || (group.userData.rooms = []);
      group.traverse(function (o) {
        if (!o.isMesh) return;
        total++;
        // the interior's own meshes (floors, plaster, furniture, fixtures):
        // nobody sees them from 60 m, so the LOD tick sleeps them out there
        if (o.name && o.name.indexOf("island-interior") === 0) rooms.push(o);
        if (o.isInstancedMesh || !_finSet.has(o.material)) return;
        for (let a = o; a && a !== group; a = a.parent) if (a.userData && a.userData.noBake) return;
        const g = o.geometry;
        if (!g || !g.attributes.position || !g.attributes.normal) return;
        take.push(o);
      });
      if (take.length < 2) return;
      let nv = 0, ni = 0;
      for (const o of take) { const g = o.geometry; nv += g.attributes.position.count; ni += g.index ? g.index.count : g.attributes.position.count; }
      const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), col = new Float32Array(nv * 3);
      const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
      let v = 0, k = 0;
      const ranges = new Map();          // original -> [first index entry, count] in the merged copy
      for (const o of take) {
        const g = o.geometry, P = g.attributes.position, N = g.attributes.normal, c = o.material.color;
        ranges.set(o, [k, g.index ? g.index.count : P.count]);
        _bm.multiplyMatrices(inv, o.matrixWorld);
        _bn.getNormalMatrix(_bm);
        for (let i = 0; i < P.count; i++) {
          _bv.set(P.getX(i), P.getY(i), P.getZ(i)).applyMatrix4(_bm);
          pos[(v + i) * 3] = _bv.x; pos[(v + i) * 3 + 1] = _bv.y; pos[(v + i) * 3 + 2] = _bv.z;
          _bv.set(N.getX(i), N.getY(i), N.getZ(i)).applyMatrix3(_bn).normalize();
          nor[(v + i) * 3] = _bv.x; nor[(v + i) * 3 + 1] = _bv.y; nor[(v + i) * 3 + 2] = _bv.z;
          col[(v + i) * 3] = c.r; col[(v + i) * 3 + 1] = c.g; col[(v + i) * 3 + 2] = c.b;
        }
        if (g.index) { const I = g.index.array; for (let i = 0; i < I.length; i++) idx[k++] = I[i] + v; }
        else for (let i = 0; i < P.count; i++) idx[k++] = v + i;
        v += P.count;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      geo.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
      geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
      geo.setIndex(new THREE.BufferAttribute(idx, 1));
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, bakedMat(gy));
      mesh.name = "island-shell";
      mesh.castShadow = true; mesh.receiveShadow = true;
      group.add(mesh);
      let hidden = 0;
      const hid = group.userData.bakedHidden || (group.userData.bakedHidden = []);
      for (const o of take) {
        if (keep.has(o) || losSet.has(o)) {
          o.visible = false; hidden++; hid.push(o);
          /* ITS TRIANGLES CAN LEAVE THE MERGED COPY. A disaster that takes this
             original away (a wall torn off into the flood, a panel the wind
             fells: systems/debris.js calls this when it hands the part to the
             body sim) folds its range of the merged index to nothing, so the
             building stops drawing a part that is now somewhere else. The
             island's reset puts every cut shell back (shellRestore). */
          const r = ranges.get(o);
          if (r) o.userData.shellCut = function () { shellCut(mesh, r[0], r[1]); };
          // where it belongs, so the reset can put a taken original back
          o.userData.bakedHome = { parent: o.parent, p: o.position.clone(), q: o.quaternion.clone(), s: o.scale.clone() };
          continue;
        }
        if (o.parent) o.parent.remove(o);
        if (o.geometry && !o.geometry._shared) o.geometry.dispose();
      }
      bakeStats.buildings++; bakeStats.meshesIn += total; bakeStats.meshesOut += total - take.length + 1; bakeStats.hidden += hidden;
    }

    const cutShells = new Set();
    function shellCut(mesh, i0, n) {
      const g = mesh.geometry, I = g.index;
      if (!I || !(n > 0)) return;
      if (!mesh.userData.pristineIndex) mesh.userData.pristineIndex = I.array.slice();
      const A = I.array;
      for (let i = i0; i + 2 < i0 + n && i + 2 < A.length; i += 3) { A[i + 1] = A[i]; A[i + 2] = A[i]; }
      I.needsUpdate = true;
      cutShells.add(mesh);
    }
    function shellRestore() {
      cutShells.forEach(function (mesh) {
        const P = mesh.userData.pristineIndex, I = mesh.geometry && mesh.geometry.index;
        if (P && I) { I.array.set(P); I.needsUpdate = true; }
      });
      cutShells.clear();
    }

    function recSnap() {
      const L = CBZ.stairs && CBZ.stairs.links ? CBZ.stairs.links() : null;
      return { c: CBZ.colliders.length, p: CBZ.platforms.length, l: L ? L.length : 0, g: allGlass.length };
    }
    function orientRecords(snap, ox, oz, yaw, extra) {
      const co = Math.round(Math.cos(yaw)), si = Math.round(Math.sin(yaw));
      if (co === 1 && si === 0) return;
      // three.js rotation.y: local (dx, dz) -> (dx cos + dz sin, -dx sin + dz cos)
      const T = function (X, Z, out) { const dx = X - ox, dz = Z - oz; out.x = ox + dx * co + dz * si; out.z = oz - dx * si + dz * co; return out; };
      const D = function (ux, uz, out) { out.x = ux * co + uz * si; out.z = -ux * si + uz * co; return out; };
      const a = { x: 0, z: 0 }, b = { x: 0, z: 0 };
      const box = function (r) {
        T(r.minX, r.minZ, a); T(r.maxX, r.maxZ, b);
        r.minX = Math.min(a.x, b.x); r.maxX = Math.max(a.x, b.x); r.minZ = Math.min(a.z, b.z); r.maxZ = Math.max(a.z, b.z);
      };
      const done = new Set();
      const C = CBZ.colliders;
      for (let i = snap.c; i < C.length; i++) {
        const c = C[i]; if (done.has(c)) continue; done.add(c);
        box(c);
        if (c.cx != null && c.yaw != null) { T(c.cx, c.cz, a); c.cx = a.x; c.cz = a.z; c.yaw += yaw; }
      }
      const P = CBZ.platforms;
      for (let i = snap.p; i < P.length; i++) {
        const p = P[i]; if (done.has(p)) continue; done.add(p);
        const xc = (p.minX + p.maxX) / 2, zc = (p.minZ + p.maxZ) / 2;
        box(p);
        const r = p.ramp;
        if (r && r.dir) {
          T(r.ox, r.oz, a); r.ox = a.x; r.oz = a.z; D(r.dx, r.dz, a); r.dx = a.x; r.dz = a.z;
        } else if (r) {
          // an axis ramp: its two ends on the footprint's centre line
          const p0 = r.axis === "x" ? T(r.x0, zc, { x: 0, z: 0 }) : T(xc, r.z0, { x: 0, z: 0 });
          const p1 = r.axis === "x" ? T(r.x1, zc, { x: 0, z: 0 }) : T(xc, r.z1, { x: 0, z: 0 });
          delete r.axis; delete r.x0; delete r.x1; delete r.z0; delete r.z1;
          if (Math.abs(p1.x - p0.x) > Math.abs(p1.z - p0.z)) { r.axis = "x"; r.x0 = p0.x; r.x1 = p1.x; }
          else { r.z0 = p0.z; r.z1 = p1.z; }
        }
        if (p.obb) { T(p.obb.cx, p.obb.cz, a); p.obb.cx = a.x; p.obb.cz = a.z; D(p.obb.ux, p.obb.uz, a); p.obb.ux = a.x; p.obb.uz = a.z; }
      }
      const L = CBZ.stairs && CBZ.stairs.links ? CBZ.stairs.links() : null;
      if (L) for (let i = snap.l; i < L.length; i++) {
        for (const pt of L[i].path) { if (done.has(pt)) continue; done.add(pt); T(pt.x, pt.z, a); pt.x = a.x; pt.z = a.z; }
      }
      const quarter = si !== 0;
      for (let i = snap.g; i < allGlass.length; i++) {
        const gp = allGlass[i]; if (done.has(gp)) continue; done.add(gp);
        T(gp.x, gp.z, a); gp.x = a.x; gp.z = a.z;
        if (quarter && gp.horiz != null) gp.horiz = !gp.horiz;
      }
      if (extra) for (const pt of extra) { if (done.has(pt)) continue; done.add(pt); T(pt.x, pt.z, a); pt.x = a.x; pt.z = a.z; }
      if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
      if (CBZ.markPlatformsDirty) CBZ.markPlatformsDirty();
    }

    // a world rect (a lot) in a building's own frame (the inverse of its turn)
    function localFence(r, ox, oz, yaw) {
      if (!r) return null;
      const co = Math.round(Math.cos(yaw || 0)), si = Math.round(Math.sin(yaw || 0));
      const L = function (X, Z) { const wx = X - ox, wz = Z - oz; return [wx * co - wz * si, wx * si + wz * co]; };
      const a = L(r.x0, r.z0), b = L(r.x1, r.z1);
      return { x0: Math.min(a[0], b[0]), x1: Math.max(a[0], b[0]), z0: Math.min(a[1], b[1]), z1: Math.max(a[1], b[1]) };
    }

    function makeBuilding(ox, oz, w, d, storeys, color, gy, style, yaw, bo) {
      yaw = yaw || 0; bo = bo || {};
      const snap = recSnap();
      const bgroup = new THREE.Group();
      bgroup.position.set(ox, gy, oz);
      root.add(bgroup);

      const cols = [], plats = [], glassList = [], shellMerge = [];
      const ixMin = -w / 2 + WT, ixMax = w / 2 - WT;   // interior x span
      const izMin = -d / 2 + WT, izMax = d / 2 - WT;   // interior z span

      // local box; opts.solid → height-gated collider, opts.plat → walkable top,
      // opts.los → camera/vision blocker. Coords are local to bgroup; the
      // collider/platform records carry the world-space rectangle.
      // opts.merge → no mesh of its own: it joins the building's merged shell
      // (slabs, treads, parapets: nothing that is a collider's ref or a wall
      // the tsunami tears off)
      // opts.noVis → the record only (collider / platform); the interior
      // pass draws that surface itself, as structure + finish + ceiling
      function lbox(lx, ly, lz, bw, bh, bd, col, opts) {
        opts = opts || {};
        let m = null;
        if (opts.noVis && !opts.solid) {
          // nothing drawn here
        } else if (opts.merge && !opts.solid) {
          shellMerge.push([lx, ly, lz, bw, bh, bd, col, !!opts.los]);
        } else {
          m = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), opts.emissive ? mat(col, { emissive: opts.emissive, ei: 0.5 }) : finishMat(col, gy));
          m.position.set(lx, ly, lz);
          m.castShadow = opts.cast !== false; m.receiveShadow = true;
          bgroup.add(m);
        }
        if (opts.solid) {
          const c = { minX: ox + lx - bw / 2, maxX: ox + lx + bw / 2, minZ: oz + lz - bd / 2, maxZ: oz + lz + bd / 2, ref: m, y0: gy + ly - bh / 2, y1: gy + ly + bh / 2 };
          CBZ.colliders.push(c); cols.push(c);
        }
        if (opts.plat) {
          const p = { minX: ox + lx - bw / 2, maxX: ox + lx + bw / 2, minZ: oz + lz - bd / 2, maxZ: oz + lz + bd / 2, top: gy + ly + bh / 2 };
          CBZ.platforms.push(p); plats.push(p);
        }
        if (opts.los && m) CBZ.losBlockers.push(m);
        return m;
      }

      /* GROUND-FLOOR FOUNDATION: a solid walkable slab at the floor reference
         (gy = the footprint's high point), extending down to bury any gap on
         the low side. This gives a flat indoor ground floor to walk and the
         base the stairs climb from, instead of bumpy terrain poking through.

         Its top used to sit at EXACTLY gy, which is the height the lot was
         levelled to — so on a flat lot the slab and the island's grass were
         coplanar across the whole room and z-fought, and you stood in a room
         with a grass floor. It is lifted 8 cm clear (a step far under physics
         STEP_UP, so you still walk straight in) and squared out to the full
         footprint, so no sliver of terrain shows along the wall line either.
         The record is unchanged; what you SEE is a concrete footing 15 mm
         under the finished floor the interior pass lays on it. */
      lbox(0, -0.27, 0, w, 0.7, d, 0x6c7178, { plat: true, noVis: true });
      shellMerge.push([0, (-0.62 + 0.065) / 2, 0, w, 0.685, d, 0x77736b, false]);

      const wallOpt = { solid: true, los: true };
      // every shell wall is remembered with the face it stands on, so the
      // glazing pass can cut the real window openings through it
      const walls = [];
      function wall(face, lx, ly, lz, bw, bh, bd) {
        const m = lbox(lx, ly, lz, bw, bh, bd, color, wallOpt);
        walls.push({ mesh: m, face: face, lx: lx, ly: ly, lz: lz, bw: bw, bh: bh, bd: bd });
      }
      for (let k = 0; k < storeys; k++) {
        const ly = k * FH + FH / 2;            // wall centre height (local)
        wall(1, 0, ly, d / 2 - WT / 2, w, FH, WT);             // +z back
        wall(2, -w / 2 + WT / 2, ly, 0, WT, FH, d);            // -x left
        wall(3, w / 2 - WT / 2, ly, 0, WT, FH, d);             // +x right
        // front (-z) wall: ground floor has the doorway
        if (k === 0) {
          const side = (w - DOORW) / 2;
          wall(0, -(DOORW / 2 + side / 2), ly, -d / 2 + WT / 2, side, FH, WT);
          wall(0, DOORW / 2 + side / 2, ly, -d / 2 + WT / 2, side, FH, WT);
          // door lintel above the opening (so the facade reads as a doorway)
          lbox(0, FH - 0.35, -d / 2 + WT / 2, DOORW, 0.7, WT, color, { los: true, merge: true });
          // THE DOORS THEMSELVES: a pair of panelled leaves, hooked back open
          // against the jambs inside (the street door of a building people run
          // into when the wave comes; it is never in the way)
          {
            const lw = DOORW / 2 - 0.04, lh = FH - 0.7 - 0.12, lz = -d / 2 + WT + lw / 2 + 0.02;
            for (const sg of [-1, 1]) {
              lbox(sg * (DOORW / 2 - 0.05), 0.06 + lh / 2, lz, 0.05, lh, lw, 0x5a3f2c, { merge: true });
              lbox(sg * (DOORW / 2 - 0.05) - sg * 0.035, 0.06 + lh * 0.72, lz, 0.02, lh * 0.3, lw * 0.7, 0x4a3324, { merge: true });
              lbox(sg * (DOORW / 2 - 0.05) - sg * 0.035, 0.06 + lh * 0.3, lz, 0.02, lh * 0.36, lw * 0.7, 0x4a3324, { merge: true });
            }
          }
        } else {
          wall(0, 0, ly, -d / 2 + WT / 2, w, FH, WT);
        }
      }

      /* THE PLAN (world/island_building.js). The facade's crown is probed
         FIRST (the kit's dry run, the same ctx the dressing gets), because
         it decides whether this roof is a place: a stair goes up only to a
         roof you can stand on. Then every slab, landing, flight, guard,
         parapet and roof collider below is laid from the plan, the plan
         tools/island-stairs-check.mjs audits in node. */
      const rTop = storeys * FH;
      const dressing = !!(style && CBZ.facadeCrownProbe && !(CBZ.CONFIG && CBZ.CONFIG.SURV_FACADES === false));
      let crown0 = [];
      if (dressing) {
        try {
          crown0 = CBZ.facadeCrownProbe(IB.facadeCtx({ ox: ox, oz: oz, w: w, d: d, storeys: storeys, fh: FH, wt: WT,
            rTop: rTop, pp: 0.7, doorSide: 0, color: color, style: style }));
        } catch (e) { crown0 = []; }
      }
      const PL = IB.plan({ w: w, d: d, storeys: storeys, crown: crown0 });
      const sEdge = PL.sEdge;

      // THE SLABS: every upper floor and the roof (the room minus the stair
      // strip; a roof nobody climbs to closes over the strip as well). The
      // walk surface is the platform record; the VISIBLE slab is the
      // structure between the finished floor (15 mm oak or tile, laid by the
      // interior pass) and the ceiling board (12 mm).
      for (const s of PL.slabs) {
        const cx = (s.x0 + s.x1) / 2, cz = (s.z0 + s.z1) / 2, sw = s.x1 - s.x0, sd = s.z1 - s.z0;
        lbox(cx, s.y - 0.1, cz, sw, 0.2, sd, 0xb9bec6, { plat: true, noVis: true });
        shellMerge.push([cx, s.y - 0.1015, cz, sw, 0.173, sd, 0x8e8a82, true]);
      }
      // THE ROOF EDGE: a parapet in the wall's own finish under a stone
      // coping, solid, on every edge the plan says (over the slab; round the
      // strip too where no bulkhead stands there)
      const PPH = IB.PPH;
      const parapet = function (x0, x1, z0, z1) {
        const cxp = (x0 + x1) / 2, czp = (z0 + z1) / 2, pw = x1 - x0, pd = z1 - z0;
        if (pw < 0.05 || pd < 0.05) return;
        shellMerge.push([cxp, rTop + PPH / 2, czp, pw, PPH, pd, color, true]);
        shellMerge.push([cxp, rTop + PPH + 0.03, czp, pw + (pw > pd ? 0 : 0.08), 0.06, pd + (pw > pd ? 0.08 : 0), 0xc9c2b4, false]);
        const c = { minX: ox + x0, maxX: ox + x1, minZ: oz + z0, maxZ: oz + z1, ref: null, y0: gy + rTop, y1: gy + rTop + PPH + 0.06 };
        CBZ.colliders.push(c); cols.push(c);
      };
      for (const p of PL.roof.parapets) parapet(p.x0, p.x1, p.z0, p.z1);

      /* THE STAIR. Each flight is one walk surface (systems/stairs.js): the
         treads themselves (`steps`: over the i-th going the surface is the
         i-th tread, the last going flush with the landing it arrives on), a
         stepped soffit under it (nobody walks into the back of a flight),
         and an AI link, so a survivor can be sent upstairs. The flights
         alternate lanes, so the only flights stacked over a point are two
         storeys apart and groundAt is never ambiguous going down. The flight
         you SEE is drawn by the interior pass from the same record. */
      const laneW = IB.LANE;
      for (const F of PL.flights) {
        const xc = (F.x0 + F.x1) / 2;
        CBZ.stairs.flight({
          bottom: { x: ox + xc, y: gy + F.yb, z: oz + F.zb },
          top: { x: ox + xc, y: gy + F.yt, z: oz + F.zt + F.dir * F.going },
          width: laneW - 0.08, overlap: 0.3, steps: F.risers, underside: true, plats: plats, cols: cols, owner: bgroup,
        });
      }
      // THE LANDINGS: across both lanes at each end the flights meet, at
      // least a lane deep, out to the end wall
      for (const lg of PL.landings) {
        const cx = (lg.x0 + lg.x1) / 2, cz = (lg.z0 + lg.z1) / 2;
        lbox(cx, lg.y - 0.1, cz, lg.x1 - lg.x0, 0.2, lg.z1 - lg.z0, 0xb4b9c1, { plat: true, noVis: true });
        shellMerge.push([cx, lg.y - 0.1015, cz, lg.x1 - lg.x0, 0.173, lg.z1 - lg.z0, 0x8e8a82, true]);
      }
      // THE GUARDS: the stairwell's knee walls, the rails on every flight's
      // open side, the edge of the top landing over the well (all drawn by
      // the interior pass; these are their height-gated colliders)
      for (const g of PL.guards) {
        const c = { minX: ox + g.x0, maxX: ox + g.x1, minZ: oz + g.z0, maxZ: oz + g.z1, ref: null, y0: gy + g.y0, y1: gy + g.y1 };
        CBZ.colliders.push(c); cols.push(c);
      }
      // THE ROOF'S CROWN, SOLID: every piece the grammar stood in head height
      // over a roof the stair reaches (a cupola, a finial, a chimney stack)
      for (const s of PL.roof.solids) {
        const c = { minX: ox + s.x0, maxX: ox + s.x1, minZ: oz + s.z0, maxZ: oz + s.z1, ref: null, y0: gy + s.y0, y1: gy + s.y1 };
        CBZ.colliders.push(c); cols.push(c);
      }

      // THE FACADE. Emitted last so it dresses the finished shell, and into
      // this building's own group so the quake still topples it as one piece.
      const dressed = dressIslandFacade({
        group: bgroup, ox: ox, oz: oz, gy: gy, w: w, d: d, storeys: storeys,
        fh: FH, wt: WT, rTop: rTop, pp: 0.7, doorSide: 0,   // the door is on -z
        color: color, style: style, plats: plats,
        shellMerge: shellMerge, glassList: glassList, doorHalf: DOORW / 2 + 0.35, walls: walls,
        fence: localFence(bo.lot, ox, oz, yaw),
      });
      for (const gp of glassList) allGlass.push(gp);

      // THE INSIDE (see THE INSIDE OF A BUILDING), then the shell pieces it
      // laid on the roof after the facade flushed
      const covers = houseInterior({
        group: bgroup, ox: ox, oz: oz, gy: gy, w: w, d: d, storeys: storeys, color: color,
        ixMin: ixMin, ixMax: ixMax, izMin: izMin, izMax: izMax,
        plan: PL, flights: PL.flights, landings: PL.landings, cols: cols, late: shellMerge,
        holes: dressed.holes, crown: dressed.crown, crownsRoof: dressed.crownsRoof,
      });
      flushLateShell(bgroup, shellMerge, gy);

      /* THE ROOF, as data: the slab you can stand on (everything but the
         stair strip, which carries the bulkhead), when the stair reaches it.
         A roof the facade crowned (a hipped roof, an attic, a dome) has no
         way up: roofAccess false, roof.access null. */
      const rTopL = storeys * FH;
      const roofPt = { x: ox + (sEdge + ixMax) / 2, y: gy + rTopL, z: oz };

      // turn it to face its street (records and all), then draw its static
      // shell in one call (see bakeShell)
      bgroup.rotation.y = yaw;
      orientRecords(snap, ox, oz, yaw, covers.concat([roofPt]));
      const quarter = Math.abs(Math.round(Math.sin(yaw))) === 1;
      const roofHalf = function (lx0, lx1, lz0, lz1) {
        const p0 = { x: 0, z: 0 }, p1 = { x: 0, z: 0 };
        const co = Math.round(Math.cos(yaw)), si = Math.round(Math.sin(yaw));
        p0.x = ox + lx0 * co + lz0 * si; p0.z = oz - lx0 * si + lz0 * co;
        p1.x = ox + lx1 * co + lz1 * si; p1.z = oz - lx1 * si + lz1 * co;
        return { x0: Math.min(p0.x, p1.x), x1: Math.max(p0.x, p1.x), z0: Math.min(p0.z, p1.z), z1: Math.max(p0.z, p1.z) };
      };

      const b = {
        group: bgroup, ox, oz, gy, x: ox, z: oz, w: quarter ? d : w, d: quarter ? w : d, h: storeys * FH, storeys,
        // the building's own frame: lw x ld with the door on its local -z,
        // turned rotY (a quarter turn at a time) to face its street
        lw: w, ld: d, rotY: yaw,
        roofY: gy + rTopL, roofHex: color, roofAccess: PL.roof.access,
        roof: Object.assign(roofHalf(sEdge + 0.1, ixMax, izMin, izMax), { y: gy + rTopL, access: PL.roof.access ? "stairs" : null, x: roofPt.x, z: roofPt.z }),
        stairs: { mode: PL.mode, flights: PL.flights.length, levels: PL.levels, roof: PL.roof.access, why: PL.roof.why },
        helipadCandidate: false, helipad: null,
        facadeStyle: style || null,        // so a tool can photograph "the pagoda one"
        color: color,                      // the shell's real wall colour — city/collapse.js
                                           // builds its proxy out of it, so the frame where
                                           // the real building is swapped for the falling one
                                           // is a frame nobody can see
        floorTop: gy + 0.08,               // the walkable ground-floor surface, published
                                           // so a probe can assert nothing grows through it
        colliders: cols, platforms: plats, glass: glassList, fallen: false,
        // THE GROUND-FLOOR PLAN, building-local: the room inside the walls and
        // the strips that must stay walkable. The stair strip runs the whole
        // depth of the -x side (when the building has a stair at all); the
        // door is on -z, and the walk from the door to the foot of the stairs
        // (the approach landing at the -z end of lane one) runs along the
        // front wall, so that whole front band stays clear too. The
        // interior pass furnished it round these; `covers` are the sturdy
        // tables and desks it put in (WORLD {x, y, z, r}), which
        // systems/quake.js registers for drop-cover-hold-on.
        interior: {
          kind: "house", yaw: yaw,
          x0: ixMin, x1: ixMax, z0: izMin, z1: izMax,
          keepOut: (PL.flights.length ? [{ x0: ixMin, x1: sEdge + 0.35, z0: izMin, z1: izMax, why: "stairs" }] : []).concat([
            { x0: -DOORW / 2 - 0.7, x1: DOORW / 2 + 0.7, z0: izMin, z1: izMin + 2.4, why: "door" },
            { x0: ixMin, x1: ixMax, z0: izMin, z1: izMin + 1.3, why: "front walk" },
          ]),
          covers: covers,
        },
      };
      b._wallMat = finishMat(color, gy);   // what its rubble is made of (disasters.js wallMatOf)
      bakeShell(bgroup, gy);
      fragile.push(b);
      return b;
    }

    if (CBZ.bootStep) CBZ.bootStep("island:towers");
    // ---- SKYSCRAPERS: enterable hollow towers with floor landings and a
    // working ELEVATOR up the central shaft. Walk in the ground-floor door,
    // call the lift, ride it up, stop it at any floor or the roof
    // (high ground for the tsunami). Still one group so the quake topples the
    // whole thing; its walls/floors register as height-gated colliders +
    // walkable platforms (collapse yanks them all). ----
    /* THE TOWER INTERIOR. T: the tower's numbers (see makeTower). An office
       tower: a terrazzo lobby, carpet-tile floors, a 600-grid acoustic
       ceiling with 600x1200 troffers on every storey (from the street at
       night the tower is lit floor by floor, as towers are), plaster on the
       shell and on a real lift SHAFT: the car used to ride an open hole in
       every floor, with nothing between the landing and the drop but air.
       Now the shaft is walled, with a steel-framed opening facing the front
       door on every floor. Furnished at the lobby and the first two floors;
       the floors above are fitted out and empty, to let. */
    function towerInterior(T) {
      const ox = T.ox, oz = T.oz, gy = T.gy, w = T.w, d = T.d, storeys = T.storeys;
      const iw = T.iw, id = T.id, s = T.s, TW = T.TW, realH = storeys * FH, lobbyTop = T.lobbyTop;
      const hh = function (sl) { return h01g(ox, oz, sl); };
      const K = inKit(ox, oz);
      const cols = T.cols, covers = [];
      const holes = T.holes.slice();
      holes.push({ s: 0, a0: -T.DW / 2, a1: T.DW / 2, y0: 0, y1: T.DOORH });
      const paint = [0xe2e0da, 0xd8d9d9, 0xdfdbd1][(hh(0x2a01) * 3) | 0];
      const carpet = [0xffffff, 0xaeb6bf, 0xc4b9a8, 0x9ba49f][(hh(0x2a02) * 4) | 0];
      const fyOf = function (k) { return k === 0 ? lobbyTop : k * FH + 0.1; };
      const ceilOf = function (k) { return (k + 1) * FH - 0.1; };
      const SWT = 0.15;                                // the shaft wall
      const so = s + SWT;                              // the shaft's outer half-size
      const ring = [
        { x0: -iw, x1: iw, z0: -id, z1: -s }, { x0: -iw, x1: iw, z0: s, z1: id },
        { x0: -iw, x1: -s, z0: -s, z1: s }, { x0: s, x1: iw, z0: -s, z1: s },
      ];
      const dw = Math.min(2 * s - 0.5, 1.6), DH = 2.2;  // the lift's door opening
      const R = { x0: -iw, x1: iw, z0: -id, z1: id };
      // what stays clear: a walk round the shaft, the apron in front of its
      // one door (the shaft only opens to -z now), and in the lobby the walk
      // from the street door to it
      const liftZone = { x0: -so - 0.9, x1: so + 0.9, z0: -so - 0.9, z1: so + 0.9 };
      const apron = { x0: -dw / 2 - 0.7, x1: dw / 2 + 0.7, z0: -so - 1.6, z1: -so };
      const doorWalk = { x0: -T.DW / 2 - 0.6, x1: T.DW / 2 + 0.6, z0: -id, z1: 0 };

      /* ---- FURNITURE: the lobby's waiting area, desks on floors 1-2 ---- */
      const tone = { cloth: [0x4d5563, 0x6b7d8a, 0x3f4a44][(hh(0x2a03) * 3) | 0], wood: 0x3a2b1e, frame: 0x2e2620 };
      {
        const fy = fyOf(0);
        const host = furnHost(K, ox, oz, gy, cols, fy, null);
        const blocks = [liftZone, apron, doorWalk];
        // a table to wait at (and to get under)
        /* THE SMALLEST TOWERS STILL GET ONE. On a slim tower the lift zone,
           its apron and the walk from the street door leave only strips, and
           neither of the first two tables fits with a 0.3 m walk round it:
           the lobby had nothing to get under. The last tier is a compact
           solid side table (0.8 x 0.6, a person curls under it the same way)
           that only asks for a 0.12 m gap, and if even that has no floor the
           lift's steel-framed opening is registered as the cover instead (a
           doorframe crouch: better than the open lobby, worse than a table). */
        const TIERS = [{ len: 1.2, deep: 0.8, seats: 2, gap: 0.3 }, { len: 0.9, deep: 0.7, seats: 0, gap: 0.3 },
          { len: 0.8, deep: 0.6, seats: 0, gap: 0.12 }];
        let done = false;
        for (const T2 of TIERS) {
          if (done) break;
          for (let yi = 0; yi < 2 && !done; yi++) {
            const hx0 = T2.len / 2 + 0.05, hz0 = T2.deep / 2 + (T2.seats ? 0.7 : 0.05);
            const hx = (yi ? hz0 : hx0) + T2.gap, hz = (yi ? hx0 : hz0) + T2.gap;
            let best = null;
            for (let x = R.x0 + hx + 0.1; x <= R.x1 - hx - 0.1 + 1e-6; x += 0.2) {
              for (let z = R.z0 + hz + 0.1; z <= R.z1 - hz - 0.1 + 1e-6; z += 0.2) {
                const r = { x0: x - hx, x1: x + hx, z0: z - hz, z1: z + hz };
                if (rectHit(r, blocks)) continue;
                const sc = Math.abs(x) * 0.2 - z * 0.1;      // off to a side, towards the back
                if (!best || sc < best.sc) best = { x: x, z: z, r: r, sc: sc, yaw: yi ? Math.PI / 2 : 0 };
              }
            }
            if (best) {
              furnish("table", host, best.x, fy, best.z, best.yaw, { seats: T2.seats, len: T2.len, deep: T2.deep, tone: tone });
              blocks.push(best.r);
              covers.push({ x: ox + best.x, y: gy + fy, z: oz + best.z, r: T2.seats ? 1.0 : 0.75 });
              done = true;
            }
          }
        }
        if (!done) covers.push({ x: ox, y: gy + fy, z: oz - so - 0.3, r: 0.6, kind: "doorframe" });
        const sofa = placeOnWalls(R, blocks, ["x0", "x1", "z1"], 1.8, 0.87, 0.8, holes, null, 0.5);
        if (sofa) { furnish("sofa", host, sofa.x, fy, sofa.z, sofa.yaw, { len: 1.8, tone: tone }); blocks.push(sofa.use); }
      }
      for (let k = 1; k <= Math.min(2, storeys - 1); k++) {
        const fy = fyOf(k);
        const host = furnHost(K, ox, oz, gy, cols, fy, null);
        const blocks = [liftZone, apron];
        for (let n = 0; n < 3; n++) {
          const dk = placeOnWalls(R, blocks, ["x1", "x0", "z1", "z0"], 1.4, 0.7, 1.0, holes, null, n * 0.35 + 0.15);
          if (!dk) break;
          furnish("desk", host, dk.x, fy, dk.z, dk.yaw + Math.PI, { len: 1.4, deep: 0.7 });
          blocks.push(dk.use);
          covers.push({ x: ox + dk.x, y: gy + fy, z: oz + dk.z, r: 0.75 });
        }
      }

      /* ---- CEILING FIXTURES: troffers on a 2.4 m grid, clear of the shaft */
      const trof = [];
      const nX = Math.max(1, Math.floor((2 * iw - 1.2) / 2.4)), nZ = Math.max(1, Math.floor((2 * id - 1.2) / 2.4));
      for (let i = 0; i <= nX; i++) for (let j = 0; j <= nZ; j++) {
        const x = -nX * 1.2 + i * 2.4, z = -nZ * 1.2 + j * 2.4;
        if (Math.abs(x) > iw - 0.7 || Math.abs(z) > id - 0.5) continue;
        if (Math.abs(x) < so + 0.75 && Math.abs(z) < so + 0.45) continue;
        trof.push([x, z]);
      }
      for (let k = 0; k < storeys; k++) {
        const yc = ceilOf(k);
        for (const t of trof) {
          K.box("flat", t[0], yc - 0.015, t[1], 1.26, 0.03, 0.66, 0xd6d8d6, 63 & ~4);
          K.quad("glow", [t[0] - 0.6, yc - 0.037, t[1] - 0.3], [t[0] + 0.6, yc - 0.037, t[1] - 0.3], [t[0] + 0.6, yc - 0.037, t[1] + 0.3], [t[0] - 0.6, yc - 0.037, t[1] + 0.3], [0, -1, 0], 0xf1f3f0);
          K.light(t[0], yc, t[1], 3.0, 0.16);
        }
      }

      /* ---- FLOORS AND CEILINGS ------------------------------------------ */
      for (let k = 0; k <= storeys; k++) {
        const roof = k === storeys, y = roof ? realH + 0.1 : fyOf(k);
        const key = k === 0 ? "terrazzo" : roof ? "concrete" : "carpet";
        const tint = k === 0 ? 0xffffff : roof ? 0x9a978f : carpet;
        const lit = roof ? null : K.floorLit(y);
        for (const r of ring) K.plane(key, r.x0, r.z0, r.x1, r.z1, y, tint, false, lit, null, 2.4);
        if (k > 0) {
          const yc = k * FH - 0.1, cl = K.ceilLit(yc);
          for (const r of ring) K.plane("ceiling", r.x0, r.z0, r.x1, r.z1, yc, 0xffffff, true, cl, null, 2.4);
        }
      }
      // the lobby's threshold across the doorway (its walk record is makeTower's)
      K.box("flat", 0, lobbyTop - 0.02, -d / 2 + TW / 2, T.DW, 0.04, TW + 0.02, 0x8f8a80, 4 | 16 | 32);

      /* ---- WALLS -------------------------------------------------------- */
      const faces = [
        { s: 0, n: -d / 2 + TW, inward: 1, a0: -iw, a1: iw },
        { s: 1, n: d / 2 - TW, inward: -1, a0: -iw, a1: iw },
        { s: 2, n: -w / 2 + TW, inward: 1, a0: -id, a1: id },
        { s: 3, n: w / 2 - TW, inward: -1, a0: -id, a1: id },
      ];
      for (let k = 0; k < storeys; k++) {
        const y0 = k === 0 ? lobbyTop : k * FH - 0.1, y1 = ceilOf(k);
        for (const f of faces)
          skinFace(K, { s: f.s, n: f.n, inward: f.inward, a0: f.a0, a1: f.a1, y0: y0, y1: y1, floor: fyOf(k), glassN: null }, holes, paint, 0x6e6a64);
      }
      doorTrim(K, T.DW / 2, -d / 2, -d / 2 + TW, lobbyTop, T.DOORH, 0x6e6a64, 0x8f8a80);

      /* ---- THE LIFT SHAFT ----------------------------------------------- */
      const sy0 = lobbyTop, sy1 = realH - 0.1, syc = (sy0 + sy1) / 2, syh = sy1 - sy0;
      const shaftCol = function (x0, x1, z0, z1) {
        const c = { minX: ox + x0, maxX: ox + x1, minZ: oz + z0, maxZ: oz + z1, ref: null, y0: gy + sy0, y1: gy + sy1 };
        CBZ.colliders.push(c); cols.push(c);
      };
      K.box("plaster", s + SWT / 2, syc, 0, SWT, syh, 2 * so, paint, 1 | 2 | 16 | 32);
      K.box("plaster", -s - SWT / 2, syc, 0, SWT, syh, 2 * so, paint, 1 | 2 | 16 | 32);
      K.box("plaster", 0, syc, s + SWT / 2, 2 * s, syh, SWT, paint, 16 | 32);
      shaftCol(s, so, -so, so); shaftCol(-so, -s, -so, so); shaftCol(-s, s, s, so);
      // the front: full-height piers either side of the openings, a head over each
      const px = (s + dw / 2) / 2, pw = s - dw / 2;
      K.box("plaster", -px, syc, -s - SWT / 2, pw, syh, SWT, paint, 1 | 2 | 16 | 32);
      K.box("plaster", px, syc, -s - SWT / 2, pw, syh, SWT, paint, 1 | 2 | 16 | 32);
      shaftCol(-s, -dw / 2, -so, -s); shaftCol(dw / 2, s, -so, -s);
      for (let k = 0; k < storeys; k++) {
        const fy = fyOf(k), top = Math.min(fy + DH, k + 1 < storeys ? fyOf(k + 1) - 0.2 : sy1);
        const hy1 = k + 1 < storeys ? fyOf(k + 1) : sy1;
        K.box("plaster", 0, (top + hy1) / 2, -s - SWT / 2, dw, hy1 - top, SWT, paint, 8 | 16 | 32);
        // a brushed-steel frame and sill round the opening, and the call button
        const zf = -so - 0.012;
        K.box("flat", -dw / 2 - 0.04, (fy + top + 0.06) / 2, zf, 0.08, top + 0.06 - fy, 0.024, 0x9ea3a8, 63 & ~16);
        K.box("flat", dw / 2 + 0.04, (fy + top + 0.06) / 2, zf, 0.08, top + 0.06 - fy, 0.024, 0x9ea3a8, 63 & ~16);
        K.box("flat", 0, top + 0.03, zf, dw + 0.16, 0.06, 0.024, 0x9ea3a8, 63 & ~16);
        K.box("flat", 0, fy + 0.003, -s - SWT / 2, dw, 0.006, SWT + 0.02, 0x8b9095, 4 | 16 | 32);
        K.box("flat", -dw / 2 - 0.26, fy + 1.1, -so - 0.008, 0.08, 0.16, 0.016, 0x7c8186, 63 & ~16);
        K.box("glow", -dw / 2 - 0.26, fy + 1.12, -so - 0.019, 0.03, 0.03, 0.006, 0xf4f1e6, 63 & ~16);
      }

      /* ---- THE ROOF: plant clear of the shaft and of any crown ---------- */
      if (T.plant) {
        const P = T.plant, y = realH + 0.1;
        K.box("flat", P.x, y + 0.05, P.z, P.w + 0.1, 0.1, P.d + 0.1, 0x55585c, 63 & ~8);
        K.box("flat", P.x, y + 0.66, P.z, P.w, 1.12, P.d, 0xb4b6b3, 63 & ~8);
        for (let j = 0; j < 7; j++) {
          const yy = y + 0.25 + j * 0.12;
          K.box("flat", P.x, yy, P.z - P.d / 2 - 0.003, P.w - 0.1, 0.02, 0.006, 0x3a3d40, 32);
          K.box("flat", P.x, yy, P.z + P.d / 2 + 0.003, P.w - 0.1, 0.02, 0.006, 0x3a3d40, 16);
        }
        const nf = Math.max(1, Math.floor(P.w / 1.1));
        for (let i = 0; i < nf; i++) {
          const fx = P.x - P.w / 2 + (i + 0.5) * P.w / nf;
          K.disc("flat", fx, y + 1.223, P.z, Math.min(0.42, P.d * 0.38), 16, false, 0x2a2c2f);
          K.disc("flat", fx, y + 1.226, P.z, 0.09, 8, false, 0x6d7073);
        }
        const c = { minX: ox + P.x - P.w / 2, maxX: ox + P.x + P.w / 2, minZ: oz + P.z - P.d / 2, maxZ: oz + P.z + P.d / 2, ref: null, y0: gy + y, y1: gy + y + 1.22 };
        CBZ.colliders.push(c); cols.push(c);
      }
      K.flush(T.group, false);
      return covers;
    }

    /* THE LIFT CAR. It was a dark slab with four posts: a thing you stood on
       to be carried up an open hole. Now it is a car: a floor with a steel
       sill, brushed-steel walls on three sides in panels, a handrail, a dark
       ceiling with a lit panel in it, open on the side that faces the shaft's
       door openings. Its origin is the old slab's (the deck at +0.1). Kept
       under the headhouse roof: the car stands 2.24 m over its origin, and
       the crown's hollow is 2.6 m over the top stop. */
    function liftCar(s) {
      const g2 = new THREE.Group();
      const K = inKit(0, 0);
      const cs = s - 0.05, CH = 2.2;
      K.box("flat", 0, 0, 0, 2 * cs, 0.2, 2 * cs, 0x3b3f44);
      K.box("flat", 0, 0.103, -cs + 0.06, 2 * cs - 0.1, 0.006, 0.1, 0xa8adb2, 4 | 32);
      for (let sd = -1; sd <= 1; sd += 2) {
        // side walls in three panels, alternating a touch in tone
        for (let p = 0; p < 3; p++) {
          const z0 = -cs + p * (2 * cs / 3), z1 = z0 + 2 * cs / 3;
          K.box("flat", sd * (cs - 0.015), 0.1 + CH / 2, (z0 + z1) / 2, 0.03, CH, 2 * cs / 3 - 0.006, p === 1 ? 0xa5a9ad : 0xaeb2b6);
        }
        K.box("flat", sd * (cs - 0.075), 1.0, 0, 0.04, 0.045, 2 * cs - 0.4, 0xc9ccce);
        for (const bz of [-cs + 0.35, cs - 0.35]) K.box("flat", sd * (cs - 0.05), 1.0, bz, 0.05, 0.03, 0.03, 0xc9ccce);
      }
      for (let p = 0; p < 3; p++) {
        const x0 = -cs + p * (2 * cs / 3), x1 = x0 + 2 * cs / 3;
        K.box("flat", (x0 + x1) / 2, 0.1 + CH / 2, cs - 0.015, 2 * cs / 3 - 0.006, CH, 0.03, p === 1 ? 0xa5a9ad : 0xaeb2b6);
      }
      K.box("flat", 0, 1.0, cs - 0.075, 2 * cs - 0.4, 0.045, 0.04, 0xc9ccce);
      K.box("flat", 0, 0.1 + CH + 0.02, 0, 2 * cs, 0.04, 2 * cs, 0x2e3136);
      K.quad("glow", [-cs + 0.35, 0.1 + CH - 0.002, -cs + 0.35], [cs - 0.35, 0.1 + CH - 0.002, -cs + 0.35],
        [cs - 0.35, 0.1 + CH - 0.002, cs - 0.35], [-cs + 0.35, 0.1 + CH - 0.002, cs - 0.35], [0, -1, 0], 0xeef1f3);
      // the front fascia over the opening
      K.box("flat", 0, 0.1 + CH - 0.06, -cs + 0.015, 2 * cs, 0.12, 0.03, 0x9ea3a8);
      K.flush(g2, false);
      g2.name = "island-lift-car";
      g2.userData.noBake = true;          // it rides the shaft: never baked into the shell
      return g2;
    }

    function makeTower(ox, oz, w, d, h, color, style, lot, to) {
      to = to || {};
      const gy = groundHeightAt(ox, oz);
      const g = new THREE.Group();
      g.position.set(ox, gy, oz);
      root.add(g);

      const cols = [], plats = [], glassT = [], shellMerge = [];
      const TW = 0.4;                                   // wall thickness
      const storeys = Math.max(4, Math.round(h / FH));
      const realH = storeys * FH;
      const DOORH = 3.0, DW = 2.4;                      // ground doorway
      const iw = w / 2 - TW, id = d / 2 - TW;           // interior half-extents
      const s = Math.min(iw, id) * 0.42;                // elevator-shaft half-size (central hole)

      // local box → mesh on the group; world-space collider/platform records.
      // opts.merge → joins the tower's merged shell instead of being a mesh
      // opts.noVis → the record only; the interior pass draws that surface
      function tbox(lx, ly, lz, bw, bh, bd, col, opts) {
        opts = opts || {};
        let m = null;
        if (opts.noVis && !opts.solid) {
          // nothing drawn here
        } else if (opts.merge && !opts.solid) {
          shellMerge.push([lx, ly, lz, bw, bh, bd, col, !!opts.los]);
        } else {
          m = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), opts.emissive ? mat(col, { emissive: opts.emissive, ei: opts.ei || 0.4 }) : finishMat(col, gy));
          m.position.set(lx, ly, lz); m.castShadow = opts.cast !== false; m.receiveShadow = true;
          g.add(m);
        }
        if (opts.solid) {
          const c = { minX: ox + lx - bw / 2, maxX: ox + lx + bw / 2, minZ: oz + lz - bd / 2, maxZ: oz + lz + bd / 2, ref: m, y0: gy + ly - bh / 2, y1: gy + ly + bh / 2 };
          CBZ.colliders.push(c); cols.push(c);
        }
        if (opts.plat) {
          const p = { minX: ox + lx - bw / 2, maxX: ox + lx + bw / 2, minZ: oz + lz - bd / 2, maxZ: oz + lz + bd / 2, top: gy + ly + bh / 2 };
          CBZ.platforms.push(p); plats.push(p);
        }
        if (opts.los && m) CBZ.losBlockers.push(m);
        return m;
      }

      // ---- exterior walls (full-height, height-gated colliders + LOS) ----
      // Each is remembered with its face so the glazing pass cuts the real
      // window openings through it (see GLASS YOU CAN SEE THROUGH).
      const walls = [];
      const wallT = function (face, lx, ly, lz, bw, bh, bd) {
        const m = tbox(lx, ly, lz, bw, bh, bd, color, { solid: true, los: true });
        walls.push({ mesh: m, face: face, lx: lx, ly: ly, lz: lz, bw: bw, bh: bh, bd: bd });
      };
      wallT(1, 0, realH / 2, d / 2 - TW / 2, w, realH, TW);      // back (+z)
      wallT(2, -w / 2 + TW / 2, realH / 2, 0, TW, realH, d);     // left
      wallT(3, w / 2 - TW / 2, realH / 2, 0, TW, realH, d);      // right
      // front (-z) wall: two pillars + a lintel, leaving a ground-floor doorway
      const fz = -d / 2 + TW / 2;
      const pw = (w - DW) / 2;                          // pillar width either side of the door
      wallT(0, -(DW + pw) / 2, realH / 2, fz, pw, realH, TW);
      wallT(0, (DW + pw) / 2, realH / 2, fz, pw, realH, TW);
      wallT(0, 0, (DOORH + realH) / 2, fz, DW, realH - DOORH, TW);   // lintel above the doorway

      // ---- per-floor landings + roof: a slab frame around the central shaft ----
      // (the walk records exactly as before; the visible slab is structure
      // between the carpet over it and the ceiling under it, see
      // towerInterior)
      const ringRects = [
        [0, -(id + s) / 2, 2 * iw, id - s], [0, (id + s) / 2, 2 * iw, id - s],
        [-(iw + s) / 2, 0, iw - s, 2 * s], [(iw + s) / 2, 0, iw - s, 2 * s],
      ];
      function landing(ly) {
        for (const r of ringRects) {
          tbox(r[0], ly, r[1], r[2], 0.2, r[3], 0xb4b9c1, { plat: true, noVis: true });
          shellMerge.push([r[0], ly - 0.0015, r[1], r[2], 0.173, r[3], IN_STRUCT, true]);
        }
      }
      for (let k = 1; k < storeys; k++) landing(k * FH);
      landing(realH);                                   // roof (with the same shaft opening)
      /* THE LOBBY FLOOR. The ground floor of every tower was the island's
         grass: no slab at all, the lobby carpeted in turf, and on a lot that
         rises across the footprint the grass came up through the room. Now a
         slab like a house's foundation, round the shaft, its top clear of the
         highest ground under the footprint, and a sill across the doorway. */
      const terT = footprintTerrain(ox, oz, w, d);
      const lobbyTop = Math.max(0.08, +(terT.max - gy + 0.05).toFixed(3));
      for (const r of ringRects) {
        tbox(r[0], (lobbyTop - 0.6) / 2, r[1], r[2], lobbyTop + 0.6, r[3], 0x77736b, { plat: true, noVis: true });
        shellMerge.push([r[0], (lobbyTop - 0.015 - 0.6) / 2, r[1], r[2], lobbyTop - 0.015 + 0.6, r[3], 0x77736b, false]);
      }
      tbox(0, (lobbyTop - 0.3) / 2, -d / 2 + TW / 2, DW, lobbyTop + 0.3, TW, 0x8f8a80, { plat: true, noVis: true });

      // THE FACADE: the tower grammars (bundled tube, braced tube, setback
      // ziggurat, radiator crown ...) declare minStoreys in the range these
      // island towers actually reach, so they get the skyline half of the kit.
      // The lift shaft goes in with it: the kit keeps the shaft hollow through
      // the crown and says where the top of the crown is (THE LIFT TOP).
      const dressedT = dressIslandFacade({
        group: g, ox: ox, oz: oz, gy: gy, w: w, d: d, storeys: storeys,
        fh: FH, wt: TW, rTop: realH, pp: 0.6, doorSide: 0,
        color: color, style: style, plats: plats,
        shellMerge: shellMerge, glassList: glassT, doorHalf: DW / 2 + 0.35, tower: true,
        walls: walls, liftShaft: { x0: -s, x1: s, z0: -s, z1: s },
        fence: localFence(lot, ox, oz, 0),
        // THE HELIPAD TOWER: no crown at all, so its lift stops at a flat
        // open roof (world/island_vehicles.js stands the pad over it)
        keepClear: to.helipad ? [{ x0: -w / 2 - 1, x1: w / 2 + 1, z0: -d / 2 - 1, z1: d / 2 + 1, y0: realH - 0.3, y1: realH + 120 }] : null,
      });
      const lift = dressedT && dressedT.lift;
      for (const gp of glassT) allGlass.push(gp);

      /* ---- THE TOP OF THE BUILDING, REACHED ------------------------------
         OWNER: "the elevator isn't getting me to the top of the building ...
         because of the facade." It ran to realH, the shell's roof, and every
         skyline grammar but one stands 5-45 m of crown on that roof, most of
         it straight over the shaft: you rode up INTO the crown and stopped
         there. Now the top stop is the top of the crown's mass over the shaft
         (lift.y), the shaft is carved hollow up to it, and there is a real
         deck to step out onto: a slab round the shaft as wide as the crown
         leaves headroom for, with a rail, and a small open headhouse over the
         car when the grammar stands a spire on top of the shaft. */
      const topY = lift && lift.raised ? lift.y : realH;
      if (lift && lift.raised) {
        const D = lift.deck, dt = topY + 0.1;         // deck walk surface (car deck arrives level with it)
        const strips = [
          [D.x0, D.x1, D.z0, -s], [D.x0, D.x1, s, D.z1],
          [D.x0, -s, -s, s], [s, D.x1, -s, s],
        ];
        for (const st of strips) {
          const sw = st[1] - st[0], sd = st[3] - st[2];
          if (sw < 0.05 || sd < 0.05) continue;
          tbox((st[0] + st[1]) / 2, topY, (st[2] + st[3]) / 2, sw, 0.2, sd, 0x9fa6ad, { plat: true, los: true, cast: true, merge: true });
        }
        // the rail round the deck edge: posts, a top rail and a mid rail
        // (merged), and one height-gated collider per side
        const RH = 1.05;
        const railSide = function (ax, x0, x1, z0, z1) {
          const len = ax === "x" ? x1 - x0 : z1 - z0;
          if (len < 0.3) return;
          const cx2 = (x0 + x1) / 2, cz2 = (z0 + z1) / 2;
          const bw = ax === "x" ? len : 0.06, bd = ax === "x" ? 0.06 : len;
          tbox(cx2, dt + RH, cz2, bw, 0.06, bd, 0x3a3f46, { merge: true });
          tbox(cx2, dt + RH * 0.5, cz2, bw * (ax === "x" ? 1 : 0.8), 0.04, bd * (ax === "x" ? 0.8 : 1), 0x3a3f46, { merge: true });
          const n = Math.max(2, Math.round(len / 1.2) + 1);
          for (let i = 0; i < n; i++) {
            const t = i / (n - 1);
            const px = ax === "x" ? x0 + t * len : cx2, pz = ax === "x" ? cz2 : z0 + t * len;
            tbox(px, dt + RH / 2, pz, 0.05, RH, 0.05, 0x3a3f46, { merge: true });
          }
          const c = { minX: ox + cx2 - Math.max(bw, 0.12) / 2, maxX: ox + cx2 + Math.max(bw, 0.12) / 2,
            minZ: oz + cz2 - Math.max(bd, 0.12) / 2, maxZ: oz + cz2 + Math.max(bd, 0.12) / 2,
            ref: null, y0: gy + dt, y1: gy + dt + RH + 0.05 };
          CBZ.colliders.push(c); cols.push(c);
        };
        railSide("x", D.x0, D.x1, D.z0 + 0.03, D.z0 + 0.03);
        railSide("x", D.x0, D.x1, D.z1 - 0.03, D.z1 - 0.03);
        railSide("z", D.x0 + 0.03, D.x0 + 0.03, D.z0, D.z1);
        railSide("z", D.x1 - 0.03, D.x1 - 0.03, D.z0, D.z1);
      }
      if (lift && lift.headhouse) {
        // the headhouse: four posts and a roof over the car's top stop, open
        // on every side so the ride still ends in daylight, with the spire
        // the grammar stood over the shaft standing on its roof
        const hy = topY + lift.head;
        tbox(0, hy - 0.14, 0, 2 * s + 0.3, 0.28, 2 * s + 0.3, 0x8b9097, { los: true, cast: true, merge: true });
        for (let cz2 = -1; cz2 <= 1; cz2 += 2) for (let cx2 = -1; cx2 <= 1; cx2 += 2)
          tbox(cx2 * (s + 0.08), topY + 0.1 + (lift.head - 0.38) / 2, cz2 * (s + 0.08), 0.16, lift.head - 0.38, 0.16, 0x5a626d, { merge: true });
      }
      /* THE ROOF STOP'S EDGE AND CROWN (world/island_building.js towerRoof).
         The walls stopped AT the roof and the grammar's parapet is deco, so a
         roof the lift stops on was a step off into the street. A parapet in
         the shell's finish now stands on the wall line all round, solid, and
         every crown piece in head height over the walk ring is a collider
         (you walk round a crown's mass, not through it). */
      const TR = IB.towerRoof({ w: w, d: d, tw: TW, realH: realH, s: s, crown: (dressedT && dressedT.crown) || [],
        roofStop: !(lift && lift.roofBuried) });
      for (const p of TR.parapets) {
        const pw = p.x1 - p.x0, pd = p.z1 - p.z0, ph = p.y1 - p.y0 - 0.06;
        tbox((p.x0 + p.x1) / 2, p.y0 + ph / 2, (p.z0 + p.z1) / 2, pw, ph, pd, color, { los: true, merge: true });
        tbox((p.x0 + p.x1) / 2, p.y0 + ph + 0.03, (p.z0 + p.z1) / 2, pw + (pw > pd ? 0 : 0.08), 0.06, pd + (pw > pd ? 0.08 : 0), 0xc9c2b4, { merge: true });
        const c = { minX: ox + p.x0, maxX: ox + p.x1, minZ: oz + p.z0, maxZ: oz + p.z1, ref: null, y0: gy + p.y0, y1: gy + p.y1 };
        CBZ.colliders.push(c); cols.push(c);
      }
      for (const sd of TR.solids) {
        const c = { minX: ox + sd.x0, maxX: ox + sd.x1, minZ: oz + sd.z0, maxZ: oz + sd.z1, ref: null, y0: gy + sd.y0, y1: gy + sd.y1 };
        CBZ.colliders.push(c); cols.push(c);
      }
      // rooftop plant, only on a roof nobody built a crown on, and clear of
      // the shaft AND of the apron you step out onto. It was a bare grey box;
      // it is a condenser bank now (towerInterior draws it) and it is solid.
      let plant = null;
      if (!(lift && (lift.raised || lift.headhouse))) {
        const pz0 = s + 1.4, pz1 = id - 0.2;
        if (pz1 - pz0 > 0.8) {
          const P = { x: 0, z: (pz0 + pz1) / 2, w: iw * 0.7, d: Math.min(1.6, pz1 - pz0) };
          const hit = (dressedT.crown || []).some(function (c) {
            return c[1] > P.x - P.w / 2 && c[0] < P.x + P.w / 2 && c[5] > P.z - P.d / 2 && c[4] < P.z + P.d / 2 && c[3] > realH + 0.8 && c[2] < realH + 1.4;
          });
          if (!hit) plant = P;
        }
      }
      // THE INSIDE (see THE TOWER INTERIOR)
      const towerCovers = towerInterior({
        group: g, ox: ox, oz: oz, gy: gy, w: w, d: d, storeys: storeys, iw: iw, id: id, s: s, TW: TW,
        DW: DW, DOORH: DOORH, lobbyTop: lobbyTop, cols: cols, holes: dressedT.holes, plant: plant,
      });
      // the deck, rail and headhouse are shell pieces queued AFTER the facade
      // pass flushed the rest: one more merged mesh per colour for them
      flushLateShell(g, shellMerge, gy);

      // h stays the SHELL's height (the collapse proxy and the ash roofs are
      // built off h / storeys); the lift's top stop is published beside it
      const b = { group: g, ox, oz, gy, x: ox, z: oz, w, d, h: realH, liftTop: topY, storeys,
        lw: w, ld: d, rotY: 0,
        // the roof: the lift's top stop is the way up (its shaft opens in
        // the middle of the slab, so this roof is no helipad)
        roofY: gy + realH, roofHex: color, roofAccess: true,
        roof: { x0: ox - iw, x1: ox + iw, z0: oz - id, z1: oz + id, y: gy + realH, access: "lift", x: ox, z: oz },
        // the flat, crown-free roof a helipad stands on (over the lift's
        // roof stop: the pad deck clears the car)
        helipadCandidate: !!(to.helipad && !(lift && (lift.raised || lift.headhouse))),
        helipad: to.helipad && !(lift && (lift.raised || lift.headhouse)) ? { x: ox, y: gy + realH, z: oz, r: Math.min(iw, id) } : null,
        facadeStyle: style || null, color: color,   // see makeBuilding: the collapse proxy is built from it
        floorTop: gy + lobbyTop,                    // the lobby's walk surface (see THE LOBBY FLOOR)
        colliders: cols, platforms: plats, glass: glassT, fallen: false,
        // THE GROUND-FLOOR PLAN (see makeBuilding): the lift shaft and the
        // apron you board it from, and the walk from the door to it; covers:
        // the tables and desks the interior pass put in (world {x, y, z, r})
        interior: {
          kind: "tower",
          x0: -iw, x1: iw, z0: -id, z1: id,
          keepOut: [
            { x0: -s - 1.4, x1: s + 1.4, z0: -s - 1.4, z1: s + 1.4, why: "lift" },
            { x0: -DW / 2 - 0.6, x1: DW / 2 + 0.6, z0: -id, z1: 0, why: "door to lift" },
          ],
          covers: towerCovers,
        },
      };
      fragile.push(b);

      // ---- the elevator car (see THE LIFT CAR), riding the walled shaft ----
      // Its ground stop sets the deck flush with the lobby floor.
      const stop0 = lobbyTop - 0.1;
      const carMesh = liftCar(s);
      carMesh.position.set(0, stop0, 0); g.add(carMesh);
      // The car's deck is a MOVING PLATFORM (systems/platforms_moving.js): the
      // rig ticks at 9.5, before the player (10), and carries riders properly.
      // `yaw:false`: this is a pure vertical lift. The parent is the FUNCTION
      // form, because carMesh.position is local to the building group.
      let carPlat = null, carRig = null;
      const carSpec = { decks: [{ x: 0, z: 0, w: 2 * s - 0.1, d: 2 * s - 0.1, top: 0.1 }], yaw: false, id: "arena-lift" };
      if (CBZ.movingPlatform) {
        carRig = CBZ.movingPlatform(function (o) {
          o.x = ox; o.y = gy + carMesh.position.y; o.z = oz; o.yaw = 0; return o;
        }, carSpec);
      } else {
        carPlat = { minX: ox - s + 0.05, maxX: ox + s - 0.05, minZ: oz - s + 0.05, maxZ: oz + s - 0.05, top: gy + stop0 + 0.1 };
        CBZ.platforms.push(carPlat); plats.push(carPlat);
      }
      /* THE STOPS: the ground, EVERY floor, the shell roof (unless the crown
         fills it), and the top of the crown. Car mesh y per stop; its deck
         (slabTop 0.1 above) arrives level with each landing's walk surface. */
      const stops = [stop0];
      for (let k = 1; k < storeys; k++) stops.push(k * FH);
      if (!(lift && lift.roofBuried)) stops.push(realH);
      if (topY > realH + 0.3) stops.push(topY);
      rng();                     // was the car's start phase: keeps the island's rng stream (and so its town plan) where it was
      /* THE LANDING DOORS. Every storey's shaft opening (towerInterior's
         steel-framed hole in the front wall, facing the street door) was an
         open drop into the shaft whenever the car was elsewhere, and the
         car had no doors either. Now each opening has two sliding steel
         leafs over one height-gated collider: shut unless the car stands at
         that landing with its doors open. ONE instanced mesh per tower holds
         every leaf (two per storey), so a tower of eleven floors is still
         one draw call; only the landing the car is at ever animates. The
         roof and crown stops have no shaft wall round them and no doors. */
      const SWT = 0.15, so = s + SWT, dw = Math.min(2 * s - 0.5, 1.6), LDH = 2.2;
      const leafTrav = Math.min(dw / 2 - 0.01, Math.max(0.3, s - dw / 2 - 0.02));
      const fyOfK = function (k) { return k === 0 ? lobbyTop : k * FH + 0.1; };
      const leafMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(dw / 2 - 0.006, LDH, 0.04),
        new THREE.MeshLambertMaterial({ color: 0xa8adb2 }), 2 * storeys);
      leafMesh.name = "island-lift-doors";
      leafMesh.castShadow = true; leafMesh.receiveShadow = true;
      leafMesh.frustumCulled = false;   // r128 culls an InstancedMesh by ONE leaf's sphere at the origin
      g.add(leafMesh);
      const doors = { mesh: leafMesh, n: storeys, dw: dw, trav: leafTrav, z: -s - SWT / 2, h: LDH,
        fy: [], open: [], target: [], col: [], solid: [] };
      for (let k = 0; k < stops.length; k++) {
        doors.open.push(0); doors.target.push(0); doors.solid.push(true);
        if (k >= storeys) { doors.fy.push(stops[k] + 0.1); doors.col.push(null); continue; }
        const fy = fyOfK(k);
        doors.fy.push(fy);
        const c = { minX: ox - dw / 2, maxX: ox + dw / 2, minZ: oz - so - 0.02, maxZ: oz - s + 0.02, ref: null,
          y0: gy + fy, y1: gy + fy + LDH, cy0: gy + fy, cy1: gy + fy + LDH };
        CBZ.colliders.push(c); cols.push(c);
        doors.col.push(c);
      }
      // the call button's LIT face: one small glowing chip moved to the
      // landing that pressed it, shown while the lift answers
      const litBtn = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.035, 0.008),
        new THREE.MeshBasicMaterial({ color: 0xffc14a }));
      litBtn.visible = false; litBtn.name = "island-lift-lit";
      g.add(litBtn);
      const e = { b, mesh: carMesh, plat: carPlat, rig: carRig, gy, ox, oz, s, so, dw, stops, storeys,
        y: stop0, v: 0, slabTop: 0.1, doors: doors, litBtn: litBtn, litAt: -1, idle: 0,
        m: CBZ.liftCore ? CBZ.liftCore.create(stops.length, 0) : null };
      for (let k = 0; k < storeys; k++) poseLandingDoors(e, k);
      // THE CAR'S LID, for the camera only (systems/camera.js camColliders):
      // the car is a mesh riding the shaft, so no lens test knew it had a
      // ceiling and the third-person boom flew out over it. Not a physics
      // wall (colliders push sideways; a lid must never shove a jumper out of
      // the car). Ridden with the car below.
      e.camLid = { minX: ox - s, maxX: ox + s, minZ: oz - s, maxZ: oz + s, y0: gy + stop0 + 2.3, y1: gy + stop0 + 2.38, mode: "survival" };
      (CBZ.camColliders || (CBZ.camColliders = [])).push(e.camLid);
      elevators.push(e);

      b._wallMat = finishMat(color, gy);
      bakeShell(g, gy);
      return b;
    }

    if (CBZ.bootStep) CBZ.bootStep("island:streets");
    // ---- STREETS: the plan's streets, laid by the island street kit ------
    /* world/island_plan.js decides where every street runs (a downtown grid
       behind the quay, residential grids west and north, the Works on the
       east, the ring road, the farm road, the quay road) and turns the runs
       into pieces and junctions (world/island_roads.js plan()); finishRoads()
       lays them once the stations have reported their driveways: asphalt,
       junction squares, 0.15 m sidewalks with curbs, ramps and corner
       returns, paint, signs and street lights, in 7 draw calls. Every
       surface follows the ground — and where a street crosses the ghaut the
       ground it is given is the BRIDGE DECK (roadGround: the plain's own
       height across the cut), so the road, its sidewalks and the walkable
       floor span the ravine instead of diving into it. surfaceHeightAt is
       the walkable floor (terrain + sidewalks + decks + station pads); the
       arena descriptor hands THAT to physics as groundHeightAt. Build code
       keeps calling the terrain-only groundHeightAt. */
    const roadSegs = [];          // one per road piece, junction squares excluded
    const ROADW = 7;
    // Driveways and raised slabs other builders report before finishRoads():
    //   roadCuts  {x0,x1,z0,z1} world AABB over a sidewalk: the curb there
    //             becomes a ramped apron (road level up to the 0.15 m top)
    //   raisePads {x0,x1,z0,z1,top} absolute walkable top (station forecourt)
    const roadCuts = [], raisePads = [];
    // Is this footprint (w x d, centred) in a street corridor (carriageway +
    // sidewalks)? Kept for the later dressers (quake.js's utility poles).
    function onRoad(x, z, w, d) {
      if (!PLAN) return false;
      return !!PLAN.inStreet({ x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2 }, 0);
    }
    const roadPlan = PLAN ? PLAN.roads : null;
    let roadNet = null;
    if (roadPlan) for (const p of roadPlan.pieces) {
      const mid = (p.a + p.b) / 2;
      roadSegs.push({ x: p.vertical ? p.fixed : mid, z: p.vertical ? mid : p.fixed, len: p.b - p.a, vertical: p.vertical, piece: p });
    }
    // the ground the street kit lays on: the terrain, or a bridge deck
    function roadGround(x, z) {
      const g = groundHeightAt(x, z);
      if (PLAN && PLAN.bridges.length) {
        const br = PLAN.bridgeAt(x, z);
        if (br && !br.failed) { const b = PLAN.plainBaseAt(x, z); return b > g ? b : g; }
      }
      return g;
    }
    // the walkable floor: terrain, plus the sidewalk top on a sidewalk, the
    // bridge decks, plus any raised pad; exactly groundHeightAt everywhere
    // else. A bridge the flood took (br.failed) is the ravine floor again.
    function surfaceHeightAt(x, z) {
      if (PLAN && PLAN.bridges.length) { const br = PLAN.bridgeAt(x, z); if (br && br.failed) return groundHeightAt(x, z); }
      if (roadNet) return roadNet.surfaceHeightAt(x, z);
      let y = roadGround(x, z);
      for (let i = 0; i < raisePads.length; i++) {
        const p = raisePads[i];
        if (x >= p.x0 && x <= p.x1 && z >= p.z0 && z <= p.z1 && p.top > y) y = p.top;
      }
      return y;
    }
    // lay the streets (after the stations have pushed roadCuts / raisePads)
    function finishRoads() {
      const kit = CBZ.islandRoadKit;
      if (roadNet || !kit || !roadPlan) return;
      roadNet = kit.build({
        THREE: THREE, root: root, cx: cx, cz: cz, R: R, plan: roadPlan,
        ground: roadGround, cuts: roadCuts, pads: raisePads,
        // a bridge draws its own deck (so a span that fails takes it along)
        skip: PLAN && PLAN.bridges.length ? function (x, z) { return !!PLAN.bridgeAt(x, z); } : null,
        quality: CBZ.qualityLevel, renderer: CBZ.renderer, colliders: CBZ.colliders,
        onUpdate: CBZ.onUpdate,
        modeOn: function () { return !!(CBZ.game && CBZ.islandModeOn && CBZ.islandModeOn(CBZ.game.mode)); },
      });
      CBZ.survRoadStats = roadNet.stats;
    }

    /* ---- CARS: SPOTS, NOT PROPS ----------------------------------------------
       The island used to draw ~90 parked cars of its own: one merged
       extruded-profile mesh each on a box collider, drawn through an
       instanced proxy, flung about by the disasters and never driven, with a
       few of them swapped for real cars at match start. Owner: "there's some
       real cars, some fake. Get rid of the fakes." So this builder no longer
       makes a car at all. It says where one is parked, facing which way, in
       which paint: `cars` stays EMPTY here and arena.carSpots holds the spots.
       world/island_vehicles.js stands a real Gang City vehicle (city/
       vehicles.js, the same models, enterable, drivable, and billed by
       disasters through CBZ.vehicleDisaster) on every spot, and its record is
       what arena.cars holds from then on.
       Heading: the spot's `yaw` is the plan's (rotation.y sending a body's
       local -z front along the lane); a vehicle's heading points its +z, so a
       real car faces the plan's way at yaw + PI. */
    const CAR_COLORS = [0xe7e7e3, 0xb9bdc2, 0x17191c, 0x5d6268, 0xe7e7e3, 0x9aa0a6, 0x1d3150, 0x7e1616, 0xb5a585, 0x2a3f34];
    const CAR_LIFT = 0.045;       // the asphalt sits 4 cm proud of the plain
    const carSpots = [];
    function makeCar(x, z, yaw, color, facing) {
      if (typeof yaw === "boolean") {
        // legacy: (vertical, facing) -> a heading
        const flip = facing != null ? facing > 0 : h01g(x, z, 0xca8) < 0.5;
        yaw = (yaw ? 0 : Math.PI / 2) + (flip ? Math.PI : 0);
      }
      const spot = { x: x, z: z, y: surfaceHeightAt(x, z) + CAR_LIFT, heading: yaw + Math.PI, color: color, i: carSpots.length };
      carSpots.push(spot);
      return spot;
    }

    /* ---- GAS STATIONS: world/fuel_station.js builds them (the same builder
       the city annex uses). They used to be a grey pad, four posts under a
       white slab, orange boxes for pumps and a yellow card on a stick.
       placeStations() runs BEFORE the town is scattered: a station needs a
       whole block frontage (24 m along the street, 26 m deep), and once the
       houses are down there is never one free. It picks mid-block frontages
       by a position hash (no rng(): the town's random stream is untouched),
       on flat ground, on a street that is actually laid there, and seats the
       lot's front edge on the back of the sidewalk. The station reports its
       driveways (roadCuts: the sidewalk becomes a ramped apron there) and its
       raised slabs (raisePads: the walkable floor follows the forecourt). */
    function makeGasStation(site) {
      if (!CBZ.buildFuelStation) return null;
      return CBZ.buildFuelStation({
        parent: root, x: site.x, z: site.z, y: site.y, rotY: site.rotY,
        deck: 0.15, walkRise: 0.15, apron: 0,
        onGlass: function (mesh, wx, wy, wz, span) { allGlass.push({ mesh: mesh, x: wx, y: wy, z: wz, span: span, shattered: false }); },
        onCut: function (a) { roadCuts.push(a); },
        onPad: function (a, top) { raisePads.push({ x0: a.x0, x1: a.x1, z0: a.z0, z1: a.z1, top: top }); },
      });
    }
    // the plan picked the stations' lots (a block frontage each, front to the street)
    function placeStations() {
      const sites = [];
      if (PLAN) for (const l of PLAN.stations) {
        const site = { x: l.x, z: l.z, y: l.gy, rotY: l.rotY, lot: l };
        sites.push(site);
        placed.push({ x: l.x, z: l.z, w: l.wx, d: l.wz, lot: l });
      }
      sites.forEach(makeGasStation);
      return sites;
    }

    // ---- CAR SHOWROOM (GTA dealership): no normal doors — the whole front is
    // a giant glass showroom with a central roll-up GARAGE-DOOR bay you can
    // drive a car straight into, flanked by full-height display glass, capped
    // by a massive clerestory window and an AUTO SALES sign. Cars on display
    // inside. The glass is shatterable. ----
    /* THE SHOWROOM, REBUILT FROM THE INSIDE. It was: a grass floor with a
       grey plane laid over it by polygon offset (and no walk record: you
       walked the lawn under it), walls and roof in the old party palette
       (sky blue, one fresh Lambert material per box), the side "display
       glass" buried INSIDE the solid side walls where nobody could ever see
       it, no ceiling, no light, and a blank green board on the roof where a
       sign would be. Now: one merged shell in a real cladding with the grime
       finish, a polished-tile slab you walk on, real side windows cut
       through the walls, a plaster lining, an acoustic ceiling with troffers,
       a dark fascia band, the display cars standing on the tiles, a sales
       desk and a sofa. Same footprint, same bay, same glass registration. */
    function makeShowroom(ox, oz) {
      const gy = groundHeightAt(ox, oz);
      const w = 18, d = 13, SH = 6.0, T = 0.35;
      const ter = footprintTerrain(ox, oz, w, d);
      const fy = Math.max(0.06, +(ter.max - gy + 0.04).toFixed(3));   // finished floor, local
      const grp = new THREE.Group();
      grp.position.set(ox, gy, oz);
      root.add(grp);
      const K = inKit(ox, oz);
      const shell = [];                          // [x,y,z,w,h,d,col] local
      const sbox = function (x, y, z, bw, bh, bd, col) { shell.push([x, y, z, bw, bh, bd, col]); };
      const scol = function (x0, x1, z0, z1, y0, y1) {
        CBZ.colliders.push({ minX: ox + x0, maxX: ox + x1, minZ: oz + z0, maxZ: oz + z1, ref: null, y0: gy + y0, y1: gy + y1 });
      };
      const CLAD = 0xb9bdbf, DARK = 0x30353b;
      // the slab: a walk record and a tiled floor
      CBZ.platforms.push({ minX: ox - w / 2 + T, maxX: ox + w / 2 - T, minZ: oz - d / 2, maxZ: oz + d / 2 - T, top: gy + fy });
      sbox(0, (fy - 0.015 - 0.5) / 2, 0, w, fy - 0.015 + 0.5, d, 0x77736b);
      K.plane("tile60", -w / 2 + T, -d / 2, w / 2 - T, d / 2 - T, fy, 0xe8e7e3, false, null, null, 2.4);
      // back wall, and the side walls with a long window cut through each
      sbox(0, SH / 2, d / 2 - T / 2, w, SH, T, CLAD); scol(-w / 2, w / 2, d / 2 - T, d / 2, 0, SH);
      const win = { a0: 1.2 - d * 0.25, a1: 1.2 + d * 0.25, y0: SH * 0.17, y1: SH * 0.87 };
      const holes = [];
      for (let sd = -1; sd <= 1; sd += 2) {
        const xw = sd * (w / 2 - T / 2);
        // (from behind the front corner post to the back wall: no two shell
        // boxes share a face)
        for (const r of solidRects(-d / 2 + T, d / 2 - T, 0, SH, [win]))
          sbox(xw, (r[2] + r[3]) / 2, (r[0] + r[1]) / 2, T, r[3] - r[2], r[1] - r[0], CLAD);
        scol(xw - T / 2, xw + T / 2, -d / 2, d / 2, 0, SH);
        addGlass(root, ox + xw, gy + (win.y0 + win.y1) / 2, oz + (win.a0 + win.a1) / 2, 0.04, win.y1 - win.y0, win.a1 - win.a0, 0, 0, 0, null);
        holes.push({ s: sd < 0 ? 2 : 3, a0: win.a0, a1: win.a1, y0: win.y0, y1: win.y1 });
        // the frame round it, on the outside
        const xo = sd * (w / 2 + 0.02);
        K.box("flat", xo, win.y1 + 0.03, (win.a0 + win.a1) / 2, 0.05, 0.06, win.a1 - win.a0 + 0.12, DARK);
        K.box("flat", xo, win.y0 - 0.03, (win.a0 + win.a1) / 2, 0.05, 0.06, win.a1 - win.a0 + 0.12, DARK);
        K.box("flat", xo, (win.y0 + win.y1) / 2, win.a0 - 0.03, 0.05, win.y1 - win.y0, 0.06, DARK);
        K.box("flat", xo, (win.y0 + win.y1) / 2, win.a1 + 0.03, 0.05, win.y1 - win.y0, 0.06, DARK);
        K.box("flat", xo, (win.y0 + win.y1) / 2, (win.a0 + win.a1) / 2, 0.04, win.y1 - win.y0, 0.05, DARK);
      }
      // the roof, and the fascia band across the front where the board was
      sbox(0, SH + 0.2, 0, w, 0.4, d, 0x8d8a83); scol(-w / 2, w / 2, -d / 2, d / 2, SH, SH + 0.4);
      sbox(0, SH + 0.25, -d / 2 - 0.03, w + 0.06, 0.62, 0.06, DARK);
      // FRONT (-z): posts/mullions, header + rolled-up garage door over the bay
      const fzl = -d / 2 + T / 2, BAYW = 5.2, HEADER = 4.2;
      const post = function (x, pw) { sbox(x, SH / 2, fzl, pw, SH, T, DARK); scol(x - pw / 2, x + pw / 2, -d / 2, -d / 2 + T, 0, SH); };
      post(-w / 2 + 0.35, 0.7); post(w / 2 - 0.35, 0.7); post(-BAYW / 2, 0.4); post(BAYW / 2, 0.4);
      sbox(0, HEADER + 0.3, fzl, BAYW + 0.4, 0.6, T + 0.06, DARK); scol(-BAYW / 2 - 0.2, BAYW / 2 + 0.2, -d / 2 - 0.03, -d / 2 + T + 0.03, HEADER, HEADER + 0.6);
      K.box("flat", 0, HEADER - 0.45, fzl + 0.05, BAYW - 0.5, 0.9, 0.16, 0x8a8f95);         // the door, rolled up
      for (let s2 = 0; s2 < 4; s2++) K.box("flat", 0, HEADER - 0.2 - s2 * 0.2, fzl + 0.14, BAYW - 0.55, 0.05, 0.02, 0x6b7076, 4 | 8 | 16);
      K.box("flat", 0, fy - 0.008, -d / 2 + T / 2, BAYW - 0.4, 0.028, T + 0.04, 0x8f8a80, 4 | 16 | 32);   // the bay's sill
      // full-height display glass flanking the bay, and the clerestory over it
      const a = -w / 2 + 0.7, bb = -BAYW / 2 - 0.2, cxL = (a + bb) / 2, wL = bb - a;
      addGlass(root, ox + cxL, gy + SH * 0.52, oz + fzl, wL * 0.95, SH * 0.82, 0.06, 0, 0, 0, null);
      addGlass(root, ox - cxL, gy + SH * 0.52, oz + fzl, wL * 0.95, SH * 0.82, 0.06, 0, 0, 0, null);
      addGlass(root, ox, gy + (HEADER + SH) / 2 + 0.3, oz + fzl, BAYW + 0.2, SH - HEADER - 0.7, 0.06, 0, 0, 0, null);
      // inside: plaster on the back and side walls (cut round the windows),
      // an acoustic ceiling with troffers on a 2.4 m grid
      const paint = 0xeeeeea, trim = 0x3a3a3a;
      skinFace(K, { s: 1, n: d / 2 - T, inward: -1, a0: -w / 2 + T, a1: w / 2 - T, y0: fy, y1: SH, floor: fy, glassN: null }, holes, paint, trim);
      skinFace(K, { s: 2, n: -w / 2 + T, inward: 1, a0: -d / 2 + T, a1: d / 2 - T, y0: fy, y1: SH, floor: fy, glassN: -(w / 2 - T / 2) }, holes, paint, trim);
      skinFace(K, { s: 3, n: w / 2 - T, inward: -1, a0: -d / 2 + T, a1: d / 2 - T, y0: fy, y1: SH, floor: fy, glassN: w / 2 - T / 2 }, holes, paint, trim);
      for (let x = -w / 2 + 2.2; x <= w / 2 - 2.1; x += 2.4) for (let z = -d / 2 + 2.1; z <= d / 2 - 1.6; z += 2.4) {
        K.box("flat", x, SH - 0.02, z, 1.26, 0.03, 0.66, 0xd6d8d6, 63 & ~4);
        K.quad("glow", [x - 0.6, SH - 0.042, z - 0.3], [x + 0.6, SH - 0.042, z - 0.3], [x + 0.6, SH - 0.042, z + 0.3], [x - 0.6, SH - 0.042, z + 0.3], [0, -1, 0], 0xf1f3f0);
      }
      K.plane("ceiling", -w / 2 + T, -d / 2 + T, w / 2 - T, d / 2 - T, SH - 0.004, 0xffffff, true, null, null, 2.4);
      // display cars (for sale), standing on the tiles, and the sales desk
      // (real cars on the showroom floor: the spot carries the floor's height)
      const onFloor = function (s) { s.y = gy + fy; s.floor = true; };
      onFloor(makeCar(ox - 4.6, oz + 1.6, true, 0xe24b4b));
      onFloor(makeCar(ox + 4.6, oz + 1.6, true, 0x3c6fd6));
      onFloor(makeCar(ox, oz + 4.2, false, 0xf2c43d));
      const cols = [];
      const host = furnHost(K, ox, oz, gy, cols, fy, null);
      const R = { x0: -w / 2 + T, x1: w / 2 - T, z0: -d / 2 + T, z1: d / 2 - T };
      const blocks = [{ x0: -5.9, x1: -3.3, z0: -0.9, z1: 4.1 }, { x0: 3.3, x1: 5.9, z0: -0.9, z1: 4.1 },
        { x0: -2.5, x1: 2.5, z0: -d / 2, z1: 5.6 }];
      const dk = placeOnWalls(R, blocks, ["z1", "x1"], 1.6, 0.75, 1.3, holes, null, 0.88);
      if (dk) { furnish("desk", host, dk.x, fy, dk.z, dk.yaw + Math.PI, { len: 1.6, deep: 0.75 }); blocks.push(dk.use); }
      const sf = placeOnWalls(R, blocks, ["z1", "x0"], 2.0, 0.87, 0.9, holes, null, 0.1);
      if (sf) furnish("sofa", host, sf.x, fy, sf.z, sf.yaw, { len: 2.0, tone: { cloth: 0x2b2f35 } });
      // flush: the shell per colour in the island finish, the rest in the kit
      const byCol = new Map();
      for (const r of shell) {
        const g2 = new THREE.BoxGeometry(r[3], r[4], r[5]);
        g2.deleteAttribute("uv");
        g2.translate(r[0], r[1], r[2]);
        let l = byCol.get(r[6]); if (!l) { l = []; byCol.set(r[6], l); } l.push(g2);
      }
      const BGU = THREE.BufferGeometryUtils;
      byCol.forEach(function (geos, col) {
        const geo = geos.length > 1 && BGU ? BGU.mergeBufferGeometries(geos) : geos[0];
        if (geo !== geos[0]) for (const g2 of geos) g2.dispose();
        const m = new THREE.Mesh(geo, finishMat(col, gy));
        m.castShadow = true; m.receiveShadow = true;
        grp.add(m);
        if (col === CLAD || col === DARK) CBZ.losBlockers.push(m);
      });
      K.flush(grp, false);
    }

    /* ---- THE TOWN: every lot the plan laid, built --------------------------
       world/island_plan.js decided each lot's footprint, which way its door
       faces (the street it fronts), its storeys (falling off from the harbour
       core), its district and the facade grammar that fits it (towers
       downtown, shops on the main streets, houses on the residential grids,
       villas on the estates, sheds in the Works and on the quay). This loop
       only builds them: makeBuilding turns to face the street, makeTower's
       door is on -z and the plan only gives towers lots on the + side of a
       cross street. Every lot was graded to a pad (the plan's landAt), so a
       building's floor is the ground under it: nothing floats, nothing is
       sunk. The facade flag (SURV_FACADES) dresses or undresses; it never
       moves a building. */
    const placed = [];
    const stationSites = placeStations();   // the stations' forecourts report their driveways first
    const TOWER_PALETTE = [0x5b6b82, 0x6f7e96, 0x8a98ac, 0x49566b, 0x7a6f8c, 0x5e7d86];
    const HOUSE_PALETTE = [0xd8cdb8, 0xc9bea9, 0xb3a48e, 0xe0d6c4, 0x9eb0a2, 0xc8b08c, 0xb7c0c6, 0xd2b49a, 0xa8b89a];
    const VILLA_PALETTE = [0xe4dccb, 0xd8cdb8, 0xcbb89a, 0xe8e2d4, 0xd9c9a8];
    const WORKS_PALETTE = [0x8e8a80, 0x7d7a72, 0x9a948a, 0x6f746f, 0x8a6e5a];
    const KIND_PAL = { house: HOUSE_PALETTE, villa: VILLA_PALETTE, shop: PALETTE, civic: VILLA_PALETTE, hotel: PALETTE,
      works: WORKS_PALETTE, shed: WORKS_PALETTE, market: PALETTE, office: PALETTE, tower: TOWER_PALETTE };
    let dl1 = null, built = 0;
    if (PLAN) for (const l of PLAN.lots) {
      if (l.kind === "station") continue;                 // placeStations built it
      if (l.driveway) roadCuts.push(l.driveway.cut);     // the sidewalk drops to a crossing there
      const pal = KIND_PAL[l.kind] || PALETTE;
      const color = pal[(h01g(l.x, l.z, 0x7a1) * pal.length) | 0];
      let b = null;
      if (l.kind === "showroom") {
        makeShowroom(l.x, l.z);
        dl1 = { x: l.x, z: l.z };
      } else if (l.kind === "tower" || l.kind === "hotel") {
        b = makeTower(l.x, l.z, l.w, l.d, l.storeys * FH, color, l.style, l.lot, { helipad: !!l.helipad });
      } else {
        b = makeBuilding(l.x, l.z, l.w, l.d, l.storeys, color, l.gy, l.style, l.yaw, { helipad: !!l.helipad, lot: l.lot });
      }
      if (b) {
        b.lot = l.lot; b.district = l.district; b.kind = l.kind; b.name = l.name || null; b.planId = l.id;
        b.street = l.street ? l.street.name : null;
        built++;
      }
      placed.push({ x: l.x, z: l.z, w: l.wx, d: l.wz, lot: l.lot, b: b });
      if (CBZ.bootStep && built % 12 === 0) CBZ.bootStep("island:town");
    }
    finishRoads();

    /* THE PARKED CARS, where the plan stood them: against the kerb on the
       residential and industrial streets (facing the way their lane runs,
       traffic keeps right), nose-in in the car-park bays, and on house
       driveways nose to the street. None in a junction mouth, on a
       crossing, a driveway apron or another car. */
    if (PLAN) for (const c of PLAN.cars) {
      makeCar(c.x, c.z, c.yaw, CAR_COLORS[(h01g(c.x, c.z, 0xca9) * CAR_COLORS.length) | 0]);
    }

    if (CBZ.bootStep) CBZ.bootStep("island:trees");
    /* ---- THE ISLAND'S TREES: kit trees, not green cubes on sticks ----------
       Every tree here used to be two addBox cuboids — a 0.5 m square post and
       a 2.6 m green cube — the single most fake thing on screen. They are now
       the vegetation kit's (world/vegetation.js): leaf-card broadleaf crowns
       on a barked, root-flared bole inland, and coconut palms (curved barked
       trunk, a ring of pinnate drooping fronds) along the coast and on the
       islets. Same positions, same rng draws, same record shape.

       THE RECORD CONTRACT (systems/wildfire.js + systems/disasters.js read it):
         trunk / foliage   meshes whose .material each tree OWNS — the fire
                           recolours and emissive-lights them per tree, so they
                           are per-tree CLONES of one kit material (same
                           program, same textures: no new shader, one draw
                           each, exactly the two draws the boxes cost).
         foliage origin    the CROWN'S CENTRE: wildfire scales the crown about
                           it when it chars, and reads position.y as canopy
                           height (disasters.js: top = y + 1.3).
         trunk origin      the trunk's BASE: the tsunami pivots a flung tree
                           about trunk.position, so it topples from its foot.
         trunkCol          the thin solid collider the boxes had.
         leafHex/barkHex   what reset() repaints — no more hard-coded box green.
       Deterministic: shape variety comes from CBZ.hash01 of the position, so
       the build's rng stream is consumed exactly as before. */
    const flammable = [];
    const VKIT = CBZ.vegetationKit;
    const TREES2 = !!(CBZ.CONFIG && CBZ.CONFIG.TREES_V2 !== false && CBZ.treeGroundUnder);
    const h01t = CBZ.hash01 || function () { return 0.5; };
    const treeGeo = {};
    function geoOnce(key, fn) { return treeGeo[key] || (treeGeo[key] = fn()); }
    // white-ish vertex colour ramp (dark foot -> full top): the kit materials
    // run vertexColors, and a geometry without a colour attribute draws BLACK
    function rampColor(g, low) {
      g.computeBoundingBox();
      const p = g.attributes.position, y0 = g.boundingBox.min.y, dy = Math.max(0.001, g.boundingBox.max.y - y0);
      const c = new Float32Array(p.count * 3);
      for (let i = 0; i < p.count; i++) {
        const t = Math.max(0, Math.min(1, (p.getY(i) - y0) / dy));
        const v = low + (1 - low) * Math.sqrt(t);
        c[i * 3] = v; c[i * 3 + 1] = v; c[i * 3 + 2] = v;
      }
      g.setAttribute("color", new THREE.BufferAttribute(c, 3));
      return g;
    }
    // broadleaf bole: unit height (scaled per tree), roots into the soil
    function broadTrunkGeo() {
      return geoOnce("bt", function () {
        const g = CBZ.treeTrunkGeo
          ? CBZ.treeTrunkGeo({ rTop: 0.12, rBase: 0.22, h: 1, seg: 7, roots: 4, spread: 2.3, flare: 1.5, site: "island", uvRepeat: 1.4 })
          : new THREE.CylinderGeometry(0.12, 0.22, 1, 7).translate(0, 0.5, 0);
        return rampColor(g, 0.55);
      });
    }
    // broadleaf crown, origin at its centre: three leaf-card variants
    function broadCrownGeo(v) {
      return geoOnce("bc" + v, function () {
        const spec = [[2.2, 2.9, 5], [2.5, 2.5, 4], [1.9, 3.2, 3]][v];
        let g = CBZ.treeCrownGeo && VKIT
          ? CBZ.treeCrownGeo({ tiers: 2, r: spec[0], h: spec[1], n: spec[2], cards: 12, site: "island", leaf: true, seed: 11 + v * 7 })
          : new THREE.IcosahedronGeometry(spec[0], 1);
        g = g.clone();
        g.computeBoundingBox();
        const bb = g.boundingBox;
        g.translate(0, -(bb.min.y + bb.max.y) / 2, 0);
        if (!g.attributes.color) rampColor(g, 0.6);
        g.computeBoundingSphere();
        return g;
      });
    }
    /* A COCONUT PALM: the vegetation kit's (world/vegetation.js palmTrunk /
       palmCrown, moved there from this file so every coast shares one
       palm): a leaning barked trunk with leaf-scar collars and 11 pinnate
       drooping fronds merged into one geometry. */
    function palmTrunkGeo(v) { return geoOnce("pt" + v, function () { return VKIT.palmTrunk(v); }); }
    function palmCrownGeo(v) { return geoOnce("pc" + v, function () { return VKIT.palmCrown(v); }); }
    // THE SHARED LOOKS. One material per role; each tree clones it (see the
    // record contract above). Tints multiply bright kit textures, so they are
    // authored DARK (linear albedo — this pipeline brightens on the way out).
    const woodBase = VKIT ? VKIT.material("wood") : new THREE.MeshLambertMaterial({ vertexColors: true });
    const leafBase = VKIT ? VKIT.material("foliage") : new THREE.MeshLambertMaterial({ vertexColors: true });
    const frondBase = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true, side: THREE.DoubleSide });
    frondBase.name = "survival-palm-frond";
    const leafDepth = VKIT && VKIT.depthMaterial ? VKIT.depthMaterial("foliage") : null;
    const LEAF_TINTS = [0x2f6a26, 0x3b7a2a, 0x2a5e2a, 0x48802e];
    const FROND_TINTS = [0x1c4410, 0x234c12, 0x2a4c14];
    function ownMat(base, hex) { const m = base.clone(); m.color.setHex(hex); m._shared = false; return m; }
    function trunkCollider(x, z, mesh, half) {
      const c = { minX: x - half, maxX: x + half, minZ: z - half, maxZ: z + half, ref: mesh, noCam: true };
      CBZ.colliders.push(c);
      mesh.userData.collider = c;
      return c;
    }
    function plantBroadleaf(x, z, gy, th) {
      const hv = h01t(x, z, 0x7e1);
      let base = gy;
      if (TREES2) base = Math.min(gy, CBZ.treeGroundUnder(groundHeightAt, x, z, 0.6).min) - 0.25;
      const top = gy + th;
      const barkHex = 0x6e5a48, leafHex = LEAF_TINTS[(hv * LEAF_TINTS.length) | 0];
      const trunk = new THREE.Mesh(broadTrunkGeo(), ownMat(woodBase, barkHex));
      trunk.position.set(x, base, z);
      trunk.scale.set(1.15, top + 0.9 - base, 1.15);            // runs up INTO the crown
      trunk.rotation.y = hv * Math.PI * 2;
      trunk.castShadow = true; trunk.receiveShadow = true;
      root.add(trunk);
      const foliage = new THREE.Mesh(broadCrownGeo((h01t(x, z, 0x7e2) * 3) | 0), ownMat(leafBase, leafHex));
      foliage.position.set(x, top + 1.25, z);
      foliage.rotation.y = h01t(x, z, 0x7e3) * Math.PI * 2;
      foliage.castShadow = true; foliage.receiveShadow = true;
      if (leafDepth) foliage.customDepthMaterial = leafDepth;
      root.add(foliage);
      return { trunk, foliage, trunkCol: trunkCollider(x, z, trunk, 0.25), leafHex, barkHex };
    }
    function plantPalm(x, z, gy, H) {
      const v = (h01t(x, z, 0x7e4) * 3) | 0;
      const yaw = h01t(x, z, 0x7e5) * Math.PI * 2;
      const barkHex = 0x8a7a66, leafHex = FROND_TINTS[(h01t(x, z, 0x7e6) * FROND_TINTS.length) | 0];
      const tg = palmTrunkGeo(v);
      const trunk = new THREE.Mesh(tg, ownMat(woodBase, barkHex));
      const sy = H + 0.3;
      trunk.position.set(x, gy - 0.3, z);
      trunk.scale.set(1, sy, 1);
      trunk.rotation.y = yaw;
      trunk.castShadow = true; trunk.receiveShadow = true;
      root.add(trunk);
      // the hub sits on the trunk's (bent, scaled) top, read off its own curve
      const tp = tg.userData.top, bx = tp.x * sy;
      const foliage = new THREE.Mesh(palmCrownGeo((h01t(x, z, 0x7e7) * 3) | 0), ownMat(frondBase, leafHex));
      foliage.position.set(x + bx * Math.cos(yaw), gy - 0.3 + sy * tp.y - 0.05, z - bx * Math.sin(yaw));
      foliage.rotation.y = h01t(x, z, 0x7e8) * Math.PI * 2;
      foliage.castShadow = true;
      root.add(foliage);
      return { trunk, foliage, trunkCol: trunkCollider(x, z, trunk, 0.22), leafHex, barkHex };
    }
    /* WHERE THE TREES ARE is the plan's: a park of shade trees along both
       banks of the ghaut, street trees on the residential verges and palms
       down the downtown and quay streets, palms along the grass edge where
       the beaches are, bush on the volcano's lower skirt and the hills' feet,
       a few in the countryside, four palms in the square. Nothing on the
       live cone above its turf line, nothing on a lot, a driveway, a car
       park or a street. */
    // every tree DRAWS as an instance (world/instance_proxy.js): ~330 trees
    // were ~660 draw calls; the meshes stay the trees the fire, the wave and
    // the storm act on, and drop out of the instance the moment they do
    const treeProxy = CBZ.instanceProxy ? CBZ.instanceProxy(root, { name: "island-trees",
      modeOn: function () { return !!(CBZ.game && CBZ.islandModeOn && CBZ.islandModeOn(CBZ.game.mode)); } }) : null;
    function proxyTree(rec, palm) {
      if (!treeProxy) return;
      treeProxy.add(rec.trunk, woodBase);
      treeProxy.add(rec.foliage, palm ? frondBase : leafBase);
    }
    if (PLAN) for (const t of PLAN.trees) {
      const x = t.x, z = t.z;
      if (Math.hypot(x - VOL.x, z - VOL.z) < VOL.r * 0.82) continue;
      const gy = groundHeightAt(x, z);
      const hv = h01t(x, z, 0x7ea);
      const palm = t.kind === "palm";
      const rec = palm ? plantPalm(x, z, gy, 6.5 + hv * 4.5) : plantBroadleaf(x, z, gy, 2.2 + hv * 1.6);
      proxyTree(rec, palm);
      flammable.push({ x, z, trunk: rec.trunk, foliage: rec.foliage, trunkCol: rec.trunkCol, palm: palm,
        leafHex: rec.leafHex, barkHex: rec.barkHex, burning: 0, burnt: false });
    }
    // ---- the archipelago's palms, on their OWN rng stream so the main
    // island's layout stays byte-identical. They join `flammable`, so they
    // burn and regrow with everything else.
    (function isletPalms() {
      let s4 = 90911;
      const rng4 = () => { s4 = (s4 * 1103515245 + 12345) & 0x7fffffff; return s4 / 0x7fffffff; };
      for (const it of islets) {
        if (!it.big) continue;
        const n = 3 + ((rng4() * 3) | 0);
        for (let k = 0; k < n; k++) {
          const a = rng4() * Math.PI * 2, d = rng4() * it.rw * 0.55;
          const x = it.x + Math.cos(a) * d, z = it.z + Math.sin(a) * d;
          const gy = groundHeightAt(x, z);
          if (gy < 1.2) continue;                 // stay off the wet sand
          const th = 3.2 + rng4() * 1.6;
          rng4(); rng4();                         // the old crown's two draws
          const rec = plantPalm(x, z, gy, th * 1.6 + 1);
          proxyTree(rec, true);
          flammable.push({ x, z, trunk: rec.trunk, foliage: rec.foliage, trunkCol: rec.trunkCol, palm: true,
            leafHex: rec.leafHex, barkHex: rec.barkHex, burning: 0, burnt: false });
        }
      }
    })();
    if (treeProxy) treeProxy.build();

    if (CBZ.bootStep) CBZ.bootStep("island:rocks");
    // ---- rocks / cover ----
    /* The boulders were 26 separate meshes (26 draws), each a 12-face
       dodecahedron coloured by writing 0.105 linear into the SHARED cmat
       material of 0x6e675e (so anything else in that colour went black too),
       flat-shaded, sitting on the grass like black lumps, and free to land
       against a front door. This loop now only chooses SITES, spending the
       rng stream exactly as before (a, dist, s, three rotation draws, three
       scale draws) so every draw after it is unchanged; world/
       island_dressing.js turns the sites into real rock in ONE draw:
       noise-displaced and facet-cut (the flat broken faces that make a rock
       read as rock), part-buried, sun-bleached on top, lichen on the up
       faces, soil-stained at the foot, in the rock surface map, with a
       fallen piece or two beside the big one. The SITES are where rock is
       on a volcanic island: boulders the floods rolled down the ghaut's bed,
       talus round the hills' feet and the volcano's skirt, and the rocky
       headlands under the hills. Never in a street, on a lot or a forecourt,
       never within 5 m of a building. */
    const rockSites = [];
    function rockSite(x, z, s, salt) {
      if (onRoad(x, z, 3, 3)) return;
      const gy = groundHeightAt(x, z);
      if (surfaceHeightAt(x, z) > gy + 0.02) return;
      if (PLAN && PLAN.padAt(x, z)) return;
      for (const p of placed) { if (Math.abs(p.x - x) < p.w / 2 + 5 && Math.abs(p.z - z) < p.d / 2 + 5) return; }
      for (const q of rockSites) { if (Math.hypot(q.x - x, q.z - z) < (q.s + s) * 1.1) return; }
      const h = function (k) { return h01g(x, z, salt + k); };
      rockSites.push({ x: x, z: z, s: s, kx: 0.8 + h(1) * 0.4, ky: 0.55 + h(2) * 0.35, kz: 0.8 + h(3) * 0.4,
        yaw: h(4) * Math.PI, tilt: (h(5) - 0.5) * 0.5 });
    }
    if (PLAN) {
      const G = PLAN.ghaut;
      for (let i = 0; i + 1 < G.pts.length; i++) {
        const a = G.pts[i], b = G.pts[i + 1], len = Math.hypot(b.x - a.x, b.z - a.z);
        const nx = -(b.z - a.z) / len, nz = (b.x - a.x) / len;
        for (let t = 5; t < len; t += 8) {
          const hh = h01g(a.x + t, a.z, 0x9a1);
          if (hh < 0.35) continue;
          const off = (h01g(a.x, a.z + t, 0x9a2) - 0.5) * G.half * 1.4;
          rockSite(a.x + (b.x - a.x) * t / len + nx * off, a.z + (b.z - a.z) * t / len + nz * off, 0.7 + hh * 1.3, 0x9b0);
        }
      }
      for (const hl of hills) {
        const n = hl.volcano ? 14 : 6;
        for (let k = 0; k < n; k++) {
          const a = h01g(hl.x, k, 0x9a3) * Math.PI * 2, rr = hl.r * (hl.volcano ? 0.88 + 0.16 * h01g(k, hl.z, 0x9a4) : 0.92 + 0.14 * h01g(k, hl.z, 0x9a4));
          const x = hl.x + Math.cos(a) * rr, z = hl.z + Math.sin(a) * rr;
          if (Math.hypot(x - cx, z - cz) > R - 3) continue;
          rockSite(x, z, 1 + h01g(x, z, 0x9a5) * 1.8, 0x9c0);
        }
      }
    }

    /* ---- THE HARBOUR AND THE BRIDGES ---------------------------------------
       What the plan made over the water and across the ghaut, built:
         QUAY        the reclaimed land's deck (it is ground: groundHeightAt
                     answers it, so you walk it and the water stops at its
                     face), a sheet-piled concrete face down into the basin
                     with a granite coping, timber fenders, bollards every 12
                     m and ladders every 30, and the same walls round its
                     ends where it stands proud of the beach
         CARGO PIER  a concrete pier on the quay's line, bollards down its face
         BREAKWATER  a rubble mound: a concrete crest walk on a core, armoured
                     with rough basalt blocks down both slopes, the lighthouse
                     on its head (its lens lights with the dark, like every
                     lamp on the island)
         JETTIES     timber decks on piles for the marina, walk platforms
         BRIDGES     a concrete deck slab under every street that crosses the
                     ghaut (the street kit lays the road and walks ON it), its
                     fascia, a parapet each side (solid) and abutments
       One merged mesh per material (concrete, rock, timber, paint), plus the
       lens. Every piece is placed off the plan's numbers: nothing here is a
       coordinate. */
    const harbourOut = { boats: [], lens: null, points: [], jetties: [], bridges: [] };
    /* THE BRIDGES. Every street that crosses the ghaut does it on a beam
       bridge at the plain's own level: a concrete deck slab 0.8 m deep with
       its fascia, the carriageway and both sidewalks ON it (the street kit
       leaves the span to the bridge: o.skip), a parapet each side (solid),
       an abutment in each bank. Each bridge is ITS OWN group with its origin
       at the deck's centre, so the flood can take one: its record carries
       the group, its colliders and its deck platform (systems/flashflood.js
       fails a bridge by pulling those and setting record.failed, and the
       walkable floor drops to the ravine's there); arena.reset() puts it
       back. */
    function buildBridges() {
      if (!PLAN || !PLAN.bridges.length) return;
      const C = CBZ.islandRoadKit && CBZ.islandRoadKit.C ? CBZ.islandRoadKit.C : { HW: 3.5, WALK: 5.5, CURB: 0.15, LIFT: 0.04 };
      const HW = C.HW, WALK = C.WALK, CURB = C.CURB, LIFT = C.LIFT;
      const concM = skinMat("concrete"); concM.name = "island-bridge-concrete";
      const asphM = skinMat("asphalt"); asphM.name = "island-bridge-asphalt";
      const BGU = THREE.BufferGeometryUtils;
      for (const br of PLAN.bridges) {
        const along = function (t, off) { return br.vertical ? { x: br.at + off, z: t } : { x: t, z: br.at + off }; };
        const mid = along((br.a + br.b) / 2, 0);
        const deckMid = PLAN.plainBaseAt(mid.x, mid.z);
        const grp = new THREE.Group();
        grp.position.set(mid.x, deckMid, mid.z);
        grp.name = "island-bridge";
        root.add(grp);
        const cParts = [], aParts = [];
        const yaw = br.vertical ? 0 : Math.PI / 2;     // local +z runs along the road
        const piece = function (list, t, off, y, w, h, d, rgb) {
          const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
          g.deleteAttribute("uv");
          g.rotateY(yaw);
          const q = along(t, off);
          g.translate(q.x - mid.x, y - deckMid, q.z - mid.z);
          const n = g.attributes.position.count, c = new Float32Array(n * 3);
          for (let i = 0; i < n; i++) { c[i * 3] = rgb[0]; c[i * 3 + 1] = rgb[1]; c[i * 3 + 2] = rgb[2]; }
          g.setAttribute("color", new THREE.BufferAttribute(c, 3));
          list.push(g);
        };
        const FACE = [0.20, 0.195, 0.185], COPE = [0.40, 0.39, 0.37], WALKC = [0.34, 0.33, 0.31], ASPH = [0.055, 0.055, 0.058];
        let dMin = 1e9, dMax = -1e9;
        for (let t = br.a; t < br.b - 1e-6; t += 2) {
          const t1 = Math.min(br.b, t + 2), tm = (t + t1) / 2, len = t1 - t;
          const c0 = along(tm, 0), deck = PLAN.plainBaseAt(c0.x, c0.z);
          dMin = Math.min(dMin, deck); dMax = Math.max(dMax, deck);
          piece(cParts, tm, 0, deck - 0.42, WALK * 2 + 0.4, 0.8, len, FACE);              // the slab
          piece(aParts, tm, 0, deck + LIFT / 2, HW * 2, LIFT, len, ASPH);                   // the carriageway
          for (const s2 of [-1, 1]) {
            piece(cParts, tm, s2 * (HW + WALK) / 2, deck + CURB / 2, WALK - HW, CURB, len, WALKC);   // a sidewalk
            piece(cParts, tm, s2 * (WALK + 0.05), deck + 0.55, 0.3, 0.9, len, COPE);        // the parapet
          }
        }
        for (const te of [br.a, br.b]) {
          const c0 = along(te, 0), deck = PLAN.plainBaseAt(c0.x, c0.z);
          piece(cParts, te, 0, deck - 2.2, WALK * 2 + 0.8, 4.0, 1.2, FACE);               // an abutment
        }
        const mk = function (parts, m2, name) {
          if (!parts.length || !BGU) return null;
          const g = BGU.mergeBufferGeometries(parts, false);
          parts.forEach(function (p) { p.dispose(); });
          const P2 = g.attributes.position, uv = new Float32Array(P2.count * 2);
          for (let i = 0; i < P2.count; i++) { uv[i * 2] = (P2.getX(i) + mid.x) / 2.4; uv[i * 2 + 1] = (P2.getZ(i) + mid.z + P2.getY(i)) / 2.4; }
          g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
          g.computeBoundingSphere();
          const m = new THREE.Mesh(g, m2); m.name = name; m.castShadow = true; m.receiveShadow = true;
          grp.add(m);
          return m;
        };
        mk(cParts, concM, "island-bridge-concrete");
        mk(aParts, asphM, "island-bridge-deck");
        const cols = [];
        for (const s2 of [-1, 1]) {
          const p0 = along(br.a, s2 * (WALK + 0.05)), p1 = along(br.b, s2 * (WALK + 0.05));
          const c = { minX: Math.min(p0.x, p1.x) - 0.16, maxX: Math.max(p0.x, p1.x) + 0.16,
            minZ: Math.min(p0.z, p1.z) - 0.16, maxZ: Math.max(p0.z, p1.z) + 0.16, y0: dMin + 0.05, y1: dMax + 1.0, ref: null };
          CBZ.colliders.push(c); cols.push(c);
        }
        // the deck is walked through the street surface (roadGround); the
        // platform is what a disaster pulls to say "this is no longer here"
        // (it is never higher than the deck you stand on)
        const plat = { minX: br.x0, maxX: br.x1, minZ: br.z0, maxZ: br.z1, top: dMin + LIFT };
        CBZ.platforms.push(plat);
        // the record: the flood's bridge contract (systems/flashflood.js
        // normBridge) and the reset this file owes it
        Object.assign(br, {
          x: mid.x, z: mid.z, minX: br.x0, maxX: br.x1, minZ: br.z0, maxZ: br.z1,
          len: br.b - br.a, width: WALK * 2, ax: br.vertical ? 0 : 1, az: br.vertical ? 1 : 0,
          deckY: deckMid + LIFT, soffitY: deckMid - 0.82, group: grp, colliders: cols, platforms: [plat],
          failed: false, home: null,
        });
        br._home = { x: grp.position.x, y: grp.position.y, z: grp.position.z };
        harbourOut.bridges.push(br);
      }
      if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
      if (CBZ.markPlatformsDirty) CBZ.markPlatformsDirty();
    }
    function resetBridges() {
      for (const br of harbourOut.bridges) {
        const g = br.group, H = br._home;
        if (g && H) { g.position.set(H.x, H.y, H.z); g.rotation.set(0, 0, 0); g.visible = true; }
        for (const c of br.colliders) if (CBZ.colliders.indexOf(c) === -1) CBZ.colliders.push(c);
        for (const p of br.platforms) if (CBZ.platforms.indexOf(p) === -1) CBZ.platforms.push(p);
        br.failed = false; br.home = null; br.state = undefined; br.dmg = 0;
      }
      if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
      if (CBZ.markPlatformsDirty) CBZ.markPlatformsDirty();
    }
    const resetHooks = [];
    /* EVERY TREE'S HOME, so the reset can put back one a disaster carried
       off: the tsunami re-parents an uprooted trunk and crown into the flow
       (systems/disasters.js) and nothing ever brought them back: the next
       match had last match's trees lying in its streets, their stumps gone
       and their colliders pulled. */
    for (const t of flammable) {
      const h = {};
      if (t.trunk) h.trunk = { parent: t.trunk.parent, p: t.trunk.position.clone(), q: t.trunk.quaternion.clone(), s: t.trunk.scale.clone(), vis: t.trunk.visible };
      if (t.foliage) h.foliage = { parent: t.foliage.parent, p: t.foliage.position.clone(), q: t.foliage.quaternion.clone(), s: t.foliage.scale.clone(), vis: t.foliage.visible };
      t._home = h;
    }
    function treeHome(t) {
      const H = t._home; if (!H) return;
      for (const k of ["trunk", "foliage"]) {
        const o = t[k], h = H[k];
        if (!o || !h || !h.parent) continue;
        if (o.parent !== h.parent) {
          const was = o.parent;
          h.parent.add(o);
          if (was && was !== h.parent && was.parent && !was.children.length) was.parent.remove(was);
        }
        o.position.copy(h.p); o.quaternion.copy(h.q); o.scale.copy(h.s); o.visible = h.vis;
      }
      if (t.trunkCol && CBZ.colliders.indexOf(t.trunkCol) < 0) CBZ.colliders.push(t.trunkCol);
      t._tsuUproot = 0;
    }
    (function harbourAndBridges() {
      if (!PLAN) return;
      const BGU = THREE.BufferGeometryUtils;
      if (!BGU || !BGU.mergeBufferGeometries) return;
      const M4 = new THREE.Matrix4(), Q4 = new THREE.Quaternion(), E4 = new THREE.Euler(), V4 = new THREE.Vector3(), S4 = new THREE.Vector3();
      function Acc(tile) { return { parts: [], tile: tile }; }
      function put(A, g, x, y, z, yaw, rgb, sx, sy, sz) {
        g = g.index ? g.toNonIndexed() : g;
        E4.set(0, yaw || 0, 0); Q4.setFromEuler(E4); V4.set(x, y, z); S4.set(sx || 1, sy || 1, sz || 1);
        M4.compose(V4, Q4, S4);
        g.applyMatrix4(M4);
        const n = g.attributes.position.count, c = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) { c[i * 3] = rgb[0]; c[i * 3 + 1] = rgb[1]; c[i * 3 + 2] = rgb[2]; }
        g.setAttribute("color", new THREE.BufferAttribute(c, 3));
        if (g.attributes.uv) g.deleteAttribute("uv");
        A.parts.push(g);
      }
      function box(A, x, y, z, w, h, d, rgb, yaw) { put(A, new THREE.BoxGeometry(w, h, d), x, y, z, yaw, rgb); }
      function cyl(A, x, y0, z, r0, r1, h, seg, rgb) { put(A, new THREE.CylinderGeometry(r1, r0, h, seg || 10), x, y0 + h / 2, z, 0, rgb); }
      // world-planar UVs by each triangle's dominant axis, so a map reads at
      // real scale on every face
      function planarUV(g, tile) {
        const p = g.attributes.position, n = p.count, uv = new Float32Array(n * 2);
        const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
        for (let i = 0; i < n; i += 3) {
          a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, i + 1); c.fromBufferAttribute(p, i + 2);
          e1.subVectors(b, a); e2.subVectors(c, a); e1.cross(e2);
          const ax = Math.abs(e1.x), ay = Math.abs(e1.y), az = Math.abs(e1.z);
          for (let k = 0; k < 3; k++) {
            const q = k === 0 ? a : k === 1 ? b : c;
            let u, v;
            if (ay >= ax && ay >= az) { u = q.x; v = q.z; } else if (ax >= az) { u = q.z; v = q.y; } else { u = q.x; v = q.y; }
            uv[(i + k) * 2] = u / tile; uv[(i + k) * 2 + 1] = v / tile;
          }
        }
        g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
      }
      function flush(A, m2, name, cast) {
        if (!A.parts.length) return null;
        const g = BGU.mergeBufferGeometries(A.parts, false);
        A.parts.forEach(function (p) { p.dispose(); });
        planarUV(g, A.tile);
        g.computeBoundingSphere();
        const mesh = new THREE.Mesh(g, m2);
        mesh.name = name; mesh.castShadow = !!cast; mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false; mesh.updateMatrix();
        root.add(mesh);
        return mesh;
      }
      const conc = Acc(2.4), rock = Acc(2.2), wood = Acc(1.6), paint = Acc(1.2);
      const C_DECK = [0.30, 0.29, 0.27], C_FACE = [0.20, 0.195, 0.185], C_COPE = [0.40, 0.39, 0.37];
      const C_FEND = [0.055, 0.042, 0.03], C_IRON = [0.03, 0.03, 0.034], C_RUST = [0.11, 0.055, 0.03];
      const C_ROCK = [0.075, 0.07, 0.066], C_CORE = [0.10, 0.095, 0.088], C_TIMB = [0.17, 0.12, 0.08];
      const H = PLAN.harbour, Q = H.quay, seaY = OCEAN_Y;
      const FOOT = -7.5;                    // walls and piles run down past the visible water

      // ---- THE QUAY: deck (2 m cells on its own height), face, ends ----
      {
        const nx = Math.ceil((Q.x1 - Q.x0) / 2), nz = Math.ceil((Q.z1 - Q.z0) / 2);
        const pos = [], col = [], idx = [];
        for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
          const x = Q.x0 + (Q.x1 - Q.x0) * i / nx, z = Q.z0 + (Q.z1 - Q.z0) * j / nz;
          pos.push(x, PLAN.quayTop(x, z) + 0.004, z);
          const k = 0.92 + 0.12 * h01g(Math.round(x / 2), Math.round(z / 2), 0xa71);
          col.push(C_DECK[0] * k, C_DECK[1] * k, C_DECK[2] * k);
        }
        for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
          const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, e = c + 1;
          idx.push(a, c, b, b, c, e);
        }
        let g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
        g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
        g.setIndex(idx);
        g.computeVertexNormals();
        g = g.toNonIndexed();
        conc.parts.push(g);
        // the face and the two ends: wall slabs 2 m long down to the foot
        const top = function (x, z) { return PLAN.quayTop(x, z); };
        for (let x = Q.x0; x < Q.x1 - 1e-6; x += 2) {
          const x1 = Math.min(Q.x1, x + 2), mx = (x + x1) / 2, t = top(mx, Q.z1);
          box(conc, mx, (t + FOOT) / 2, Q.z1 + 0.3, x1 - x, t - FOOT, 0.6, C_FACE);
          box(conc, mx, t + 0.11, Q.z1 + 0.15, x1 - x, 0.22, 0.9, C_COPE);
          harbourOut.points.push({ x: mx, z: Q.z1 });
        }
        for (const side of [-1, 1]) {
          const xe = side < 0 ? Q.x0 : Q.x1;
          for (let z = Q.z0; z < Q.z1 - 1e-6; z += 2) {
            const z1 = Math.min(Q.z1, z + 2), mz = (z + z1) / 2;
            const t = top(xe, mz), g0 = groundHeightAt(xe + side * 1.5, mz);
            if (t - g0 < 0.12) continue;                 // flush with the land there
            box(conc, xe + side * 0.3, (t + FOOT) / 2, mz, 0.6, t - FOOT, z1 - z, C_FACE);
            box(conc, xe + side * 0.15, t + 0.11, mz, 0.9, 0.22, z1 - z, C_COPE);
          }
        }
        // fenders, bollards, ladders along the face
        for (let x = Q.x0 + 3; x < Q.x1 - 2; x += 6) {
          const t = top(x, Q.z1);
          box(wood, x, t - 0.9, Q.z1 + 0.68, 0.3, 1.8, 0.16, C_FEND);
        }
        for (let x = Q.x0 + 6; x < Q.x1 - 3; x += 12) {
          const t = top(x, Q.z1 - 0.8);
          cyl(paint, x, t, Q.z1 - 0.7, 0.2, 0.17, 0.55, 10, C_IRON);
          cyl(paint, x, t + 0.55, Q.z1 - 0.7, 0.26, 0.26, 0.07, 10, C_IRON);
          const c = { minX: x - 0.25, maxX: x + 0.25, minZ: Q.z1 - 0.95, maxZ: Q.z1 - 0.45, y0: t, y1: t + 0.62, ref: null, noCam: true };
          CBZ.colliders.push(c);
        }
        for (let x = Q.x0 + 15; x < Q.x1 - 5; x += 30) {
          const t = top(x, Q.z1);
          for (const s2 of [-0.25, 0.25]) box(paint, x + s2, (t + seaY - 1.5) / 2, Q.z1 + 0.66, 0.05, t - seaY + 1.5, 0.05, C_RUST);
          for (let y = seaY - 1.2; y < t; y += 0.3) box(paint, x, y, Q.z1 + 0.66, 0.5, 0.035, 0.035, C_RUST);
        }
      }

      // ---- THE CARGO PIER and THE JETTIES ----
      for (const p of H.piers) {
        if (p.kind === "cargo") {
          box(conc, (p.x0 + p.x1) / 2, (p.deck + FOOT) / 2, (p.z0 + p.z1) / 2 + 0.2, p.x1 - p.x0, p.deck - FOOT, p.z1 - p.z0 - 0.4, C_FACE);
          box(conc, (p.x0 + p.x1) / 2, p.deck + 0.002, (p.z0 + p.z1) / 2, p.x1 - p.x0 - 0.2, 0.01, p.z1 - p.z0, C_DECK);
          for (let z = p.z0 + 4; z < p.z1 - 1; z += 8) for (const xe of [p.x0 + 0.6, p.x1 - 0.6]) {
            cyl(paint, xe, p.deck, z, 0.2, 0.17, 0.55, 10, C_IRON);
            cyl(paint, xe, p.deck + 0.55, z, 0.26, 0.26, 0.07, 10, C_IRON);
            CBZ.colliders.push({ minX: xe - 0.25, maxX: xe + 0.25, minZ: z - 0.25, maxZ: z + 0.25, y0: p.deck, y1: p.deck + 0.62, ref: null, noCam: true });
          }
          harbourOut.points.push({ x: (p.x0 + p.x1) / 2, z: p.z1 });
        } else {
          const D = p.deck, w = p.x1 - p.x0;
          // planks across, two stringers, piles every 3 m
          for (let z = p.z0 + 0.15; z < p.z1; z += 0.3) {
            const k = 0.9 + 0.18 * h01g(p.x0, Math.round(z * 10), 0xa72);
            box(wood, (p.x0 + p.x1) / 2, D - 0.03, z, w, 0.06, 0.27, [C_TIMB[0] * k, C_TIMB[1] * k, C_TIMB[2] * k]);
          }
          for (const xe of [p.x0 + 0.2, p.x1 - 0.2]) box(wood, xe, D - 0.2, (p.z0 + p.z1) / 2, 0.2, 0.28, p.z1 - p.z0, C_FEND);
          for (let z = p.z0 + 1.5; z < p.z1; z += 3) for (const xe of [p.x0 + 0.15, p.x1 - 0.15]) {
            cyl(wood, xe, FOOT, z, 0.16, 0.14, D + 0.45 - FOOT, 8, C_FEND);
            CBZ.colliders.push({ minX: xe - 0.16, maxX: xe + 0.16, minZ: z - 0.16, maxZ: z + 0.16, y0: D, y1: D + 0.45, ref: null, noCam: true });
          }
          const plat = { minX: p.x0, maxX: p.x1, minZ: p.z0 - 0.3, maxZ: p.z1, top: D };
          CBZ.platforms.push(plat);
          harbourOut.jetties.push({ x0: p.x0, x1: p.x1, z0: p.z0, z1: p.z1, deck: D, plat: plat });
          harbourOut.points.push({ x: (p.x0 + p.x1) / 2, z: p.z1 });
        }
      }

      // ---- THE BREAKWATER: core, crest walk, armour, the lighthouse ----
      {
        const crest = H.crest, half = H.half, slope = H.slope;
        const lowY = seaY - 4.5;
        const run = half + (crest - lowY) * slope;
        for (const sg of H.breakwater) {
          const dx = sg.bx - sg.ax, dz = sg.bz - sg.az, L = Math.hypot(dx, dz), ux = dx / L, uz = dz / L;
          const nx = -uz, nz = ux, yaw = Math.atan2(ux, uz);
          // the core as a trapezoid prism (a cross-section swept down the arm)
          const sh = new THREE.Shape();
          sh.moveTo(-run, lowY); sh.lineTo(-half, crest - 0.25); sh.lineTo(half, crest - 0.25); sh.lineTo(run, lowY); sh.closePath();
          const core = new THREE.ExtrudeGeometry(sh, { depth: L + half * 2, bevelEnabled: false });
          core.translate(0, 0, -half);
          put(rock, core, sg.ax, 0, sg.az, yaw, C_CORE);
          // the crest walk: a concrete cap
          box(conc, (sg.ax + sg.bx) / 2, crest - 0.12, (sg.az + sg.bz) / 2, half * 2, 0.24, L + half * 2, C_COPE, yaw);
          // armour: rough blocks down both slopes, staggered
          for (let t = -half; t < L + half; t += 2.6) for (const s2 of [-1, 1]) for (let row = 0; row < 3; row++) {
            const e = half + 0.8 + row * 2.4;
            const y = crest - 0.2 - (e - half) / slope;
            const jit = h01g(Math.round(sg.ax + t), row * 7 + s2, 0xa73);
            const tt = t + (row & 1) * 1.3 + (jit - 0.5) * 0.8;
            const x = sg.ax + ux * tt + nx * s2 * e, z = sg.az + uz * tt + nz * s2 * e;
            const sz = 1.25 + jit * 0.7;
            const g = new THREE.DodecahedronGeometry(1, 0);
            put(rock, g, x, y, z, jit * 6.28, [C_ROCK[0] * (0.85 + jit * 0.3), C_ROCK[1] * (0.85 + jit * 0.3), C_ROCK[2] * (0.85 + jit * 0.3)], sz, sz * 0.62, sz * 0.9);
          }
          for (let t = 0; t <= L; t += 10) harbourOut.points.push({ x: sg.ax + ux * t, z: sg.az + uz * t });
        }
        // the lighthouse on the head
        const lh = H.light, g0 = crest;
        cyl(conc, lh.x, g0 - 0.1, lh.z, 2.2, 2.2, 0.9, 16, C_COPE);
        cyl(paint, lh.x, g0 + 0.8, lh.z, 1.55, 1.25, 8.4, 16, [0.72, 0.71, 0.67]);
        cyl(paint, lh.x, g0 + 4.0, lh.z, 1.42, 1.38, 1.4, 16, [0.42, 0.05, 0.04]);
        cyl(paint, lh.x, g0 + 9.2, lh.z, 1.75, 1.75, 0.18, 16, C_IRON);         // gallery
        for (let k = 0; k < 12; k++) {
          const a = k / 12 * Math.PI * 2;
          box(paint, lh.x + Math.cos(a) * 1.68, g0 + 9.85, lh.z + Math.sin(a) * 1.68, 0.05, 1.1, 0.05, C_IRON);
        }
        cyl(paint, lh.x, g0 + 10.4, lh.z, 1.72, 1.72, 0.06, 16, C_IRON);
        cyl(paint, lh.x, g0 + 11.3, lh.z, 0.9, 0.05, 0.9, 12, [0.42, 0.05, 0.04]);  // the lantern's cap
        CBZ.colliders.push({ minX: lh.x - 1.6, maxX: lh.x + 1.6, minZ: lh.z - 1.6, maxZ: lh.z + 1.6, y0: g0 - 0.1, y1: g0 + 11.5, ref: null });
        const lensMat = new THREE.MeshBasicMaterial({ color: 0x333330 });
        lensMat.name = "island-lighthouse-lens";
        const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.85, 1.1, 12), lensMat);
        lens.position.set(lh.x, g0 + 9.85, lh.z); lens.name = "island-lighthouse-lens";
        root.add(lens);
        harbourOut.lens = lens;
        let lastK = -1;
        if (CBZ.onUpdate) CBZ.onUpdate(48.4, function () {
          if (!CBZ.game || !CBZ.islandModeOn || !CBZ.islandModeOn(CBZ.game.mode)) return;
          const n = CBZ.lightsOnAmount ? CBZ.lightsOnAmount() : (CBZ.nightAmount || 0);
          // a flash every 6 s once it is dark enough to need one
          const t = (CBZ.now || 0) / 1000;
          const flash = n > 0.25 ? Math.max(0, 1 - Math.abs(((t % 6) / 6) - 0.5) * 12) : 0;
          const k = Math.min(1, n * 0.6 + flash);
          if (Math.abs(k - lastK) < 0.01) return;
          lastK = k;
          lensMat.color.setRGB(0.2 + 0.85 * k, 0.2 + 0.78 * k, 0.19 + 0.55 * k);
        });
        harbourOut.points.push({ x: lh.x, z: lh.z });
      }

      // ---- THE BRIDGES over the ghaut: each its own group (see below) ----
      buildBridges();

      const concMat = skinMat("concrete"); concMat.name = "island-harbour-concrete";
      const rockMat = skinMat("rock"); rockMat.name = "island-harbour-rock";
      const woodMat = skinMat("wood"); woodMat.name = "island-harbour-timber";
      const paintMat = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true }); paintMat.name = "island-harbour-paint";
      flush(conc, concMat, "island-harbour-concrete", true);
      flush(rock, rockMat, "island-breakwater", true);
      flush(wood, woodMat, "island-harbour-timber", true);
      flush(paint, paintMat, "island-harbour-ironwork", true);
      if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
      if (CBZ.markPlatformsDirty) CBZ.markPlatformsDirty();

      // ---- THE BOATS, moored at their berths (world/water_hulls.js hulls) ----
      const MH = CBZ.marineHulls;
      if (MH && MH.build) for (const bt of H.berths) {
        let g = null;
        try { g = MH.build(bt.key); } catch (e) { g = null; }
        if (!g) continue;
        const spec = MH.spec ? MH.spec(bt.key) : null;
        const ride = spec && spec.rideAbove != null ? spec.rideAbove : 0.06;
        g.position.set(bt.x, seaY + ride, bt.z);
        g.rotation.set(0, bt.heading, 0);
        g.name = "island-moored-" + bt.key;
        root.add(g);
        harbourOut.boats.push({ group: g, x: bt.x, z: bt.z, yaw: bt.heading, len: bt.loa, beam: bt.beam,
          draft: spec && spec.draft != null ? spec.draft : 0.5, key: bt.key, ride: ride, moored: true });
      }
      // they ride the swell while they are moored and nobody else is moving
      // them (a storm that weathervanes a hull turns it: from then on it is
      // the storm's). Only near the camera; a boat 200 m off does not bob.
      let _bobT = 0;
      if (harbourOut.boats.length && CBZ.onUpdate) CBZ.onUpdate(47.96, function (dt) {
        if (!CBZ.game || !CBZ.islandModeOn || !CBZ.islandModeOn(CBZ.game.mode)) return;
        _bobT += dt || 0;
        const cam = CBZ.camera;
        for (const bt of harbourOut.boats) {
          const g = bt.group;
          if (!bt.moored || Math.abs(g.rotation.y - bt.yaw) > 1e-4 || Math.abs(g.position.x - bt.x) > 0.05 || Math.abs(g.position.z - bt.z) > 0.05) { bt.moored = false; continue; }
          if (cam && Math.abs(cam.position.x - bt.x) + Math.abs(cam.position.z - bt.z) > 260) continue;
          const sy = CBZ.survSeaHeightAt ? CBZ.survSeaHeightAt(bt.x, bt.z) : seaY;
          g.position.y = sy + bt.ride;
          g.rotation.z = Math.sin(_bobT * 1.3 + bt.x) * 0.035 / Math.max(1, bt.beam * 0.5);
          g.rotation.x = Math.sin(_bobT * 0.9 + bt.z) * 0.02 / Math.max(1, (bt.len || 6) * 0.12);
        }
      });
    })();

    // the town between the buildings: yards, the square, the car parks, the
    // hydrants, the farm, the rocks (world/island_dressing.js; result also at
    // CBZ.islandDressing.current). It reads the plan for where each goes.
    const islandDress = CBZ.islandDressing ? CBZ.islandDressing.build({ root: root, cx: cx, cz: cz, R: R, plan: PLAN, ROADW: ROADW, groundHeightAt: groundHeightAt, surfaceHeightAt: surfaceHeightAt, onRoad: onRoad, placed: placed, fragile: fragile, roadSegs: roadSegs, h01: h01g, trees: flammable, rocks: rockSites, cars: cars, makeCar: makeCar, showroom: dl1 ? { x: dl1.x, z: dl1.z, w: 18, d: 13 } : null, stations: stationSites, oceanY: OCEAN_Y }) : null;

    arena = {
      root, center: { x: cx, z: cz }, radius: R,
      ocean, oceanY: OCEAN_Y,
      // the far coast's WATERLINE radius — where the sea visibly ends in
      // sand. water_survival.js reads it for its flood backstop (seaR + 150,
      // buried under the far dunes); the actual wall is the beach itself,
      // via the depth field.
      seaR: FAR_WL,
      // the archipelago: {x, z, rw (waterline radius), peak, big} per islet —
      // published for tools and spawners; physics reads them via the height
      // field, never this list
      islets,
      hills, fragile, flammable, elevators, glass: allGlass, groundHeightAt: surfaceHeightAt,
      // THE CARS ARE REAL VEHICLES: `cars` is filled by world/island_vehicles.js
      // with the city/vehicles.js records it stands on `carSpots` (see makeCar)
      cars, carSpots,
      // the street grid's own test and the town between the buildings
      // (world/island_dressing.js: fences, benches, bales, the pier...), so a
      // later dresser (quake.js's utility poles) never stands in a road or a fence
      onRoad: onRoad, dressing: islandDress,
      // the town's plan (world/island_plan.js) and what was built off it:
      // the harbour's boats, its seawall points, the bridges
      plan: PLAN, boats: harbourOut.boats, harbour: harbourOut,
      /* A point to stand on: dry, open ground of the town or the plain,
         `minD`..`maxD` m from the centre — never inside a building, on the
         volcano's cone or a hill, in the ghaut or in the water. (The old
         island had its volcano at the centre, so callers pass the cone's
         radius as minD to mean "not on the mountain"; with the volcano off
         to the side that is asked of the ground directly.) */
      randomPoint(minD, maxD) {
        const lo = minD || 0, hi = Math.min(maxD || R * 0.82, R - 8);
        let a = 0, d = 0, x = cx, z = cz;
        for (let k = 0; k < 40; k++) {
          a = rng() * Math.PI * 2;
          d = lo + rng() * Math.max(0, hi - lo);
          x = cx + Math.cos(a) * d; z = cz + Math.sin(a) * d;
          if (!PLAN) break;
          if (PLAN.hillAt(x, z) > 0.2 || PLAN.ghautDist(x, z) < PLAN.ghaut.bank) continue;
          let inB = false;
          for (const b of fragile) { if (Math.abs(b.x - x) < b.w / 2 + 1 && Math.abs(b.z - z) < b.d / 2 + 1) { inB = true; break; } }
          if (inB) continue;
          if (CBZ.survWaterAt && CBZ.survWaterAt(x, z)) continue;
          break;
        }
        return { x: x, z: z };
      },
      // nearest high ground above height `above` (for tsunami fleeing)
      highGround(above) {
        let best = hills[0], bd = -1;
        for (const h of hills) if (h.peak > bd) { bd = h.peak; best = h; }
        return best;
      },
      // restore the island between matches: un-collapse buildings (re-show the
      // group, re-register its walls/floors/roof), regrow trees, clear craters.
      reset() {
        // a match can end mid-tsunami — the sea is ONE number, so putting it
        // back is one call, not a mesh to reposition and a sheet to delete
        if (CBZ.waterSurgeSet) CBZ.waterSurgeSet(0);
        arenaWave.amp = 0.86; arenaWave.chop = 0.72; arenaWave.foam = 0.34; arenaWave.opacity = 1;
        arenaWave.sediment = 0;   // a match abandoned mid-sweep must not stay muddy
        ocean.position.y = OCEAN_Y;
        if (CBZ.waterDriveDisasterSurface) CBZ.waterDriveDisasterSurface(ocean, arenaWave);
        if (CBZ.waterEventClear) CBZ.waterEventClear("survival-tsunami");
        /* A MATCH CAN END MID-COLLAPSE. city/collapse.js holds the proxy
           shells, the debris in flight and the wound dressing on every
           damaged building; dropping its jobs here (rather than letting them
           land on an island that is being rebuilt underneath them) is what
           stops the next match starting with a grey slab falling through a
           restored tower. Jobs that had not yet reached their swap never fire
           it, so their building is left standing and solid — which is exactly
           what the loop below is about to guarantee anyway. */
        /* A SINKHOLE STILL OPENING is stopped first: its running sequence
           used to be torn down only on the frame AFTER the reset (when
           groundshaft.js noticed the emptied hole list), and in between it
           undermined a building of the fresh island into pieces. */
        {
          const GK = CBZ.groundShaftKit;
          if (GK) {
            for (let i = GK.seqs.length - 1; i >= 0; i--) { try { GK.seqs[i].dispose(); } catch (e) {} }
            for (let i = GK.live.length - 1; i >= 0; i--) if (GK.live[i].mode === "survival") { try { GK.disposeShaft(GK.live[i]); } catch (e) {} }
          }
        }
        if (CBZ.collapse && CBZ.collapse.reset) CBZ.collapse.reset();
        // a meteor's bowl (systems/craters.js) is permanent WITHIN a match;
        // the next match starts on the island's own ground, not last round's holes
        if (CBZ.craterClear) CBZ.craterClear();
        for (const b of fragile) {
          // clear the shared structural ledger (systems/disasters.js) so a new
          // match starts on undamaged towers, not on last match's spalling
          b._dmg = 0; b._lean = 0; b._tsuHit = null;
          if (b.fallen) {
            b.group.visible = true;
            b.group.position.set(b.ox, b.gy, b.oz);
            b.group.rotation.set(0, b.rotY || 0, 0);     // a house faces its street
            for (const c of b.colliders) if (CBZ.colliders.indexOf(c) === -1) CBZ.colliders.push(c);
            for (const p of b.platforms) if (CBZ.platforms.indexOf(p) === -1) CBZ.platforms.push(p);
            b.fallen = false;
          }
        }
        for (const t of flammable) {
          if (t._tsuUproot) treeHome(t);
          t.burning = 0; t.burnt = false;
          if (t.foliage && t.foliage.material) t.foliage.material.color.setHex(t.leafHex != null ? t.leafHex : 0x3f9a4f);
          if (t.trunk && t.trunk.material) t.trunk.material.color.setHex(t.barkHex != null ? t.barkHex : 0x6b4a2a);
        }
        // (the cars are real vehicles: world/island_vehicles.js puts every one
        // back on its spot for the new match, rebuilding the ones a disaster
        // or a driver left wrecked)
        // re-glaze every shattered window for the new match
        for (const gp of allGlass) { if (gp.shattered) { gp.shattered = false; if (gp.show) gp.show(); else gp.mesh.visible = true; } }
        // a bridge the flood took stands again; then whatever a disaster
        // registered to put back (CBZ.island.onReset)
        resetBridges();
        for (const fn of resetHooks) { try { fn(arena); } catch (e) {} }
        /* NOTHING OF THE LAST MATCH IS LEFT LYING (OR HANGING) IN THIS ONE.
           Every loose piece of every disaster is a body, a frozen piece or a
           bit in systems/debris.js, so one clear takes all of it (collapse.js
           cleared its own owners above). The tsunami's field lets go of the
           objects it took, every original a disaster pulled out of a merged
           building goes home hidden, and every merged shell it was cut out of
           is whole again. */
        if (CBZ.tsuDebrisReset) { try { CBZ.tsuDebrisReset(); } catch (e) {} }
        if (CBZ.debris && CBZ.debris.clear) { try { CBZ.debris.clear(); } catch (e) {} }
        for (const b of fragile) {
          b._tsuTorn = 0;
          const hid = b.group && b.group.userData.bakedHidden;
          if (hid) for (const o of hid) {
            const home = o.userData.bakedHome;
            if (home && o.parent !== home.parent) { home.parent.add(o); o.position.copy(home.p); o.quaternion.copy(home.q); o.scale.copy(home.s); }
            o.visible = false; o.userData.debrisTaken = false;
          }
        }
        shellRestore();
        for (let i = root.children.length - 1; i >= 0; i--) {
          const c = root.children[i];
          if (c.userData && c.userData.transient) {
            root.remove(c);
            if (c.geometry) c.geometry.dispose();
            if (c.material && c.material.dispose) c.material.dispose();
          }
        }
        if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
      },
    };

    /* A WALL TORN OFF A BAKED BUILDING is drawn again. The originals a bake
       hid stay in their building's group as collider / sight records; a
       disaster that takes one (the tsunami tears walls off into the flow:
       Object3D re-parent, world pose kept) takes a mesh nobody can see. Four
       times a second, any hidden original that has left its group shows
       itself. A static island costs one flag check per building. */
    /* THE ROOMS SLEEP FAR AWAY. A building's interior (floors, plaster,
       furniture, fixtures: ~6 draws) is only ever seen through its own
       windows from close by; past 60 m it stops drawing, and it is back the
       moment the camera comes within 50 (the gap stops it flickering at the
       line). Same 4 Hz pass. */
    /* THE ROOF AUDIT (CBZ.debrisAudit's `island` source). A building's
       current roof is where its top is NOW: its roof line moved with its
       group (a quake's settlement), or the top of what still stands of it
       once city/collapse.js has cut it, or its ground once it is down. A
       roof piece is anything loose drawn inside its footprint more than a
       metre over that line with nothing under it: an original a disaster
       took out of the merged shell, or an instance of any instanced pool of
       loose pieces under the island (the old hurricane decking strips and
       flaps were exactly this). Rigid bodies and frozen rubble are counted
       by systems/debris.js itself. */
    const _ra = new THREE.Matrix4(), _rv = new THREE.Vector3();
    function roofNow(b) {
      const C = CBZ.collapse;
      if (C && C.isFractured && C.isFractured(b)) {
        let st = null;
        try { st = C.stats(b); } catch (e) { st = null; }
        const FH = b.h / Math.max(1, b.storeys || 1);
        if (st && st.standingLevels != null) return b.gy + Math.max(0, st.standingLevels - 1) * FH + FH;
      }
      if (b.fallen) return b.gy;
      return (b.roofY != null ? b.roofY : b.gy + b.h) + (b.group ? b.group.position.y - b.gy : 0);
    }
    function roofHoverAt(x, y, z, list, why) {
      for (let i = 0; i < fragile.length; i++) {
        const b = fragile[i];
        if (Math.abs(x - b.x) > b.w / 2 + 1.5 || Math.abs(z - b.z) > b.d / 2 + 1.5) continue;
        const top = roofNow(b);
        if (y < top + 1.0) return 0;
        let fl = -Infinity;
        try { fl = CBZ.floorAt ? CBZ.floorAt(x, z, y + 0.1) : surfaceHeightAt(x, z); } catch (e) {}
        if (fl >= y - 1.0) return 0;              // it lies on something (a platform, a body, a stair)
        if (list.length < 8) list.push({ x: +x.toFixed(1), y: +y.toFixed(1), z: +z.toFixed(1), roof: +top.toFixed(1), what: why });
        return 1;
      }
      return 0;
    }
    (CBZ.debrisAuditSources || (CBZ.debrisAuditSources = {})).island = function () {
      if (!arena || !CBZ.game || !CBZ.islandModeOn || !CBZ.islandModeOn(CBZ.game.mode)) return null;
      const list = [];
      let hover = 0, scanned = 0;
      for (const b of fragile) {
        const hid = b.group && b.group.userData.bakedHidden;
        if (!hid) continue;
        for (const o of hid) {
          const home = o.userData.bakedHome;
          if (!o.visible || !home || o.parent === home.parent) continue;
          o.getWorldPosition(_rv); scanned++;
          hover += roofHoverAt(_rv.x, _rv.y, _rv.z, list, "torn original");
        }
      }
      root.updateMatrixWorld(true);
      root.traverse(function (m) {
        if (!m.isInstancedMesh || !m.visible || !(m.count > 0)) return;
        if (!(m.userData.dynamic || /debris|deck|churn|flap|sheet/i.test(m.name || ""))) return;
        for (let i = 0; i < m.count; i++) {
          m.getMatrixAt(i, _ra);
          const e = _ra.elements;
          if (e[0] * e[0] + e[1] * e[1] + e[2] * e[2] < 1e-8) continue;    // a parked (zero-scale) slot
          _rv.set(e[12], e[13], e[14]).applyMatrix4(m.matrixWorld);
          if (_rv.y < -1000) continue;
          scanned++;
          hover += roofHoverAt(_rv.x, _rv.y, _rv.z, list, m.name || "instance");
        }
      });
      return { roofHover: hover, scanned: scanned, list: list };
    };

    const ROOM_FAR = 60, ROOM_NEAR = 50;
    let _tornT = 0;
    if (CBZ.onUpdate) CBZ.onUpdate(47.97, function (dt) {
      if (!arena || !CBZ.game || !CBZ.islandModeOn(CBZ.game.mode)) return;
      _tornT += dt || 0;
      if (_tornT < 0.25) return;
      _tornT = 0;
      const cam = CBZ.camera;
      for (let i = 0; i < fragile.length; i++) {
        const b = fragile[i];
        const ud = b.group && b.group.userData;
        if (!ud) continue;
        if (b._tsuTorn || b.fallen || b._dmg > 0) {
          const hid = ud.bakedHidden;
          // (and its merged copy is cut: it is drawn where it went, never twice)
          if (hid) for (const o of hid) {
            const home = o.userData.bakedHome;
            if (o.parent !== (home ? home.parent : b.group) && o.visible === false && !o.userData.debrisTaken) {
              o.visible = true;
              if (o.userData.shellCut) { try { o.userData.shellCut(); } catch (e) {} }
            }
          }
        }
        const rooms = ud.rooms;
        if (!rooms || !rooms.length || !cam) continue;
        const dx = cam.position.x - b.x, dz = cam.position.z - b.z, dy = cam.position.y - b.gy;
        const d = Math.sqrt(dx * dx + dz * dz + dy * dy * 0.25) - Math.max(b.w, b.d) / 2;
        const want = ud.roomsOn === false ? d < ROOM_NEAR : d < ROOM_FAR;
        if (want !== (ud.roomsOn !== false)) {
          ud.roomsOn = want;
          for (const o of rooms) o.visible = want;
        }
      }
    });

    /* ---- ELEVATOR DRIVE -------------------------------------------------
       A lift that serves EVERY floor, and the top of the crown, driven by the
       one lift machine (systems/liftcore.js, shared with the city's walk-in
       cabs). It used to have no button and no doors: standing near the shaft
       summoned it, standing on the car sent it express, and walking on the
       car stopped it at the next floor, which read as a lift that ignored
       you and then did things on its own (owner: "fix the elevator button
       opening the elevator"). Now it is a lift:

         * "Call" pinned over the landing's call button ([E], or tap it): the
           button lights, the car comes to your floor and its doors OPEN.
         * in the car, the lift panel (systems/liftpanel.js, the same one the
           city's cabs use): every floor, the roof and the crown as buttons;
           tap one, type its number, or move the highlight and press it. The
           doors close, the car climbs the shaft to that floor and opens.
           Pressed while it runs, a floor it can still brake for re-targets it.
         * the doors hold while you stand in the doorway or in the car; an
           empty car shuts its doors, and after a while goes home to the lobby.

       Collapsed towers park their lift. PRIORITY 9.4: a platform must move
       BEFORE the character resolves against it (platforms_moving.js ticks at
       9.5, updatePlayer at 10). */
    const LIFT_V = 5.5, LIFT_A = 3.2, LEAF_V = 2.4;
    const LiftCore = CBZ.liftCore;
    function deckY(e, i) { return e.gy + e.stops[i] + e.slabTop; }
    // the leaf pair at landing k, posed from its open amount (0 shut .. 1 open)
    function poseLandingDoors(e, k) {
      const D = e.doors;
      if (!D || k >= D.n) return;
      // (a property, not a const: makeTower poses every landing at build
      // time, before this part of the builder has run)
      const M4 = poseLandingDoors.m || (poseLandingDoors.m = new THREE.Matrix4());
      const o = D.open[k], x0 = D.dw / 4;
      for (let sd = 0; sd < 2; sd++) {
        const sg = sd ? 1 : -1;
        M4.makeTranslation(sg * (x0 + D.trav * o), D.fy[k] + D.h / 2, D.z);
        D.mesh.setMatrixAt(2 * k + sd, M4);
      }
      D.mesh.instanceMatrix.needsUpdate = true;
    }
    function inCar(e, P) {
      if (!P || !P.pos) return false;
      const top = e.gy + e.y + e.slabTop;
      return Math.abs(P.pos.x - e.ox) < e.s - 0.05 && Math.abs(P.pos.z - e.oz) < e.s - 0.05 &&
        P.pos.y > top - 0.5 && P.pos.y < top + 1.2;
    }
    function onStop(e, i, P) { const dy = P.pos.y - deckY(e, i); return dy > -0.6 && dy < 1.2; }
    // in the landing's opening, between the car and the landing floor
    function inDoorway(e, i, P) {
      if (!P || !P.pos || !onStop(e, i, P)) return false;
      const dx = P.pos.x - e.ox, dz = P.pos.z - e.oz;
      return Math.abs(dx) < e.dw / 2 + 0.1 && dz > -e.so - 0.5 && dz < -e.s + 0.05;
    }
    // standing at the landing's call panel (in front of the opening), or at a
    // doorless top stop, beside the shaft
    function atLanding(e, i, P) {
      if (!P || !P.pos || !onStop(e, i, P) || inCar(e, P)) return false;
      const dx = P.pos.x - e.ox, dz = P.pos.z - e.oz;
      if (i < e.doors.n) return Math.abs(dx) < e.dw / 2 + 1.4 && dz > -e.so - 2.4 && dz < -e.s + 0.05;
      return Math.abs(dx) < e.so + 2.2 && Math.abs(dz) < e.so + 2.2;
    }
    function nearTower(e, P) { return !!(P && P.pos && Math.abs(P.pos.x - e.ox) < 14 && Math.abs(P.pos.z - e.oz) < 14); }
    function btnAt(e, i) {
      const D = e.doors;
      if (i < D.n) return { x: e.ox - e.dw / 2 - 0.26, y: e.gy + D.fy[i] + 1.12, z: e.oz - e.so - 0.03 };
      return { x: e.ox, y: deckY(e, i) + 1.4, z: e.oz - e.so - 0.1 };
    }
    function setDoor(e, i, open, P) {
      const D = e.doors, t = open ? 1 : 0;
      if (D.target[i] === t) return;
      D.target[i] = t;
      if (i >= D.n) { D.open[i] = t; return; }        // a top stop has no doors
      if (CBZ.sfx && P && nearTower(e, P) && onStop(e, i, P)) CBZ.sfx(open ? "door_open" : "door_close");
    }
    function gate(e, i) {
      const D = e.doors, c = D.col[i];
      if (!c) return;
      const solid = D.open[i] < 0.25;
      if (solid === D.solid[i]) return;
      D.solid[i] = solid;
      if (solid) { c.y0 = c.cy0; c.y1 = c.cy1; } else { c.y0 = 1e9; c.y1 = 1e9 + 1; }
    }
    // riding: can the car still stop at stop k? Ahead of it in its
    // direction of travel and past its braking distance (a car at rest can
    // go either way).
    function canBrakeFor(e, k) {
      const S = e.stops, goal = S[e.m.dest];
      if (k < 0 || k >= S.length) return false;
      if (e.v < 0.05) return Math.abs(S[k] - e.y) > 0.01;
      const dir = goal > e.y ? 1 : -1;
      return (S[k] - e.y) * dir >= e.v * e.v / (2 * LIFT_A) + 0.05;
    }
    // trapezoid: accelerate, cruise, brake to land exactly on the stop
    function driveCar(e, dt) {
      const goal = e.stops[e.m.dest], dir = goal > e.y ? 1 : -1, rem = (goal - e.y) * dir;
      const vStop = Math.sqrt(Math.max(0, 2 * LIFT_A * rem));
      e.v = Math.min(LIFT_V, e.v + LIFT_A * dt, vStop);
      const step = e.v * dt;
      if (step >= rem || rem < 0.004) { e.y = goal; e.v = 0; return true; }
      e.y += dir * step;
      return false;
    }
    function ioFor(e, P) {
      return {
        inside: (i) => e.m.at === i && Math.abs(e.y - e.stops[i]) < 0.01 && inCar(e, P),
        doorway: (i) => inDoorway(e, i, P),
        doorOpen: (i) => e.doors.open[i],
        door: (i, open) => setDoor(e, i, open, P),
        seal: (i) => gate(e, i),
        travel: (m, dt) => driveCar(e, dt),
        reach: (m, j) => canBrakeFor(e, j),
        lit: (on) => { e.litOn = on; },
        sfx: (s) => { if (CBZ.sfx && nearTower(e, P)) CBZ.sfx(s); },
      };
    }

    // ---- the controls: "Call" pinned over the landing's button
    //      (systems/interactions.js prisonPrompt, bound to [E]; on touch the
    //      pill is the tap), and in the car the lift panel
    let callArm = null, carArm = null;
    CBZ.islandLiftCall = function () {
      const a = callArm, P = CBZ.player;
      if (!a || !P || P.dead) return false;
      a.e.litAt = a.i;
      return LiftCore.call(a.e.m, a.i, ioFor(a.e, P));
    };
    // the car's floor button j (the panel's pick; also a scripted ride)
    CBZ.islandLiftGoTo = function (j) {
      const e = carArm, P = CBZ.player;
      if (!e || !P || P.dead) return false;
      e.litAt = -1;
      return LiftCore.go(e.m, j, ioFor(e, P));
    };
    (CBZ._prisonPromptSites || (CBZ._prisonPromptSites = [])).push(
      { id: "island-lift-call", act: "@islandLiftCall", was: "no button: standing near the shaft summoned the car", now: "Call, over the call button" }
    );
    // what the panel prints: G (the lobby), each floor's number, R, and the
    // crown above the roof
    function panelStops(e) {
      if (e.panelStops) return e.panelStops;
      const S = e.stops, out = [];
      for (let k = 0; k < S.length; k++) {
        if (k === 0) out.push({ label: "G", name: "Lobby", num: 0, roof: false });
        else if (k < e.storeys) out.push({ label: String(k), name: "", num: k, roof: false });
        else if (k === e.storeys) out.push({ label: "R", name: "", num: k, roof: true });
        else out.push({ label: "C", name: "Crown", num: k, roof: false });
      }
      return (e.panelStops = out);
    }
    // the floor the moving car is passing, for the panel's display
    function passing(e) {
      const S = e.stops;
      let best = 0;
      for (let k = 1; k < S.length; k++) if (Math.abs(S[k] - e.y) < Math.abs(S[best] - e.y)) best = k;
      return best;
    }
    const pickFloor = (j) => CBZ.islandLiftGoTo(j);
    function carPanel(e, q) {
      const m = e.m, riding = m.st === "ride", L = panelStops(e);
      const spec = e.panelSpec || (e.panelSpec = { stops: L, pick: pickFloor, reach: (j) => canBrakeFor(e, j) });
      spec.at = m.at;
      spec.dest = m.dest;
      spec.riding = riding;
      spec.up = riding && m.dest >= 0 && e.stops[m.dest] > e.y;
      spec.display = riding ? L[passing(e)].label : null;
      spec.at3 = { x: e.ox + e.s - 0.25, y: e.gy + e.y + e.slabTop + 1.3, z: e.oz - e.s + 0.35 };
      CBZ.liftPanel.show("isle:" + q, spec);
    }
    function armControls(P) {
      callArm = null; carArm = null;
      if (!P || !P.pos || P.dead || P._mountedAnimal || CBZ.game.mode !== "survival") return;
      for (let q = 0; q < elevators.length; q++) {
        const e = elevators[q], m = e.m;
        if (!m || e.b.fallen || !inCar(e, P)) continue;
        const atStop = Math.abs(e.y - e.stops[m.at]) < 0.01;
        if (CBZ.liftPanel && (m.st === "ride" || ((m.st === "open" || m.st === "idle" || m.st === "close") && atStop))) {
          carArm = e;
          carPanel(e, q);
        }
        return;
      }
      if (!CBZ.prisonPrompt) return;
      let best = null;
      for (let q = 0; q < elevators.length; q++) {
        const e = elevators[q], m = e.m;
        if (!m || e.b.fallen) continue;
        for (let i = 0; i < e.stops.length; i++) {
          if (!atLanding(e, i, P)) continue;
          if (m.st === "ride" || (m.at === i && (m.st === "open" || (m.st === "close" && m.dest >= 0)))) continue;
          const b2 = btnAt(e, i), d2 = (b2.x - P.pos.x) * (b2.x - P.pos.x) + (b2.z - P.pos.z) * (b2.z - P.pos.z);
          if (!best || d2 < best.d2) best = { e: e, i: i, d2: d2, at: b2 };
        }
      }
      if (best) {
        callArm = best;
        CBZ.prisonPrompt("island-lift-call", "@islandLiftCall", "Call", { at: best.at, key: "e", bind: true, d2: Math.min(best.d2, 0.3) });
      }
    }

    CBZ.onUpdate(9.4, function (dt) {
      if (!CBZ.islandModeOn(CBZ.game.mode)) return;
      if (!(dt > 0)) return;
      dt = Math.min(dt, 0.1);
      const P = CBZ.player;
      if (!LiftCore) return;
      for (let q = 0; q < elevators.length; q++) {
        const e = elevators[q], m = e.m, D = e.doors;
        if (e.rig) e.rig.setActive(!e.b.fallen);
        if (e.b.fallen) { if (e.mesh.visible) e.mesh.visible = false; if (D.mesh.visible) D.mesh.visible = false; e.litBtn.visible = false; continue; }
        LiftCore.step(m, dt, ioFor(e, P));
        // an empty car with its doors shut goes home to the lobby after a while
        if (m.st === "idle" && m.at !== 0 && !inCar(e, P)) {
          e.idle += dt;
          if (e.idle > 9) { e.idle = 0; LiftCore.park(m, 0); }
        } else e.idle = 0;
        // the landing doors: only the ones not at rest move
        for (let k = 0; k < e.stops.length; k++) {
          if (D.open[k] === D.target[k]) continue;
          if (k >= D.n) { D.open[k] = D.target[k]; continue; }
          D.open[k] = D.open[k] < D.target[k] ? Math.min(D.target[k], D.open[k] + LEAF_V * dt) : Math.max(D.target[k], D.open[k] - LEAF_V * dt);
          poseLandingDoors(e, k);
          gate(e, k);
        }
        // the lit call button, on the landing that pressed it
        const showLit = !!e.litOn && e.litAt >= 0 && e.litAt < D.n;
        if (showLit) { const b2 = btnAt(e, e.litAt); e.litBtn.position.set(b2.x - e.ox, b2.y - e.gy, b2.z - 0.012 - e.oz); }
        if (e.litBtn.visible !== showLit) e.litBtn.visible = showLit;
        e.mesh.position.y = e.y;
        if (e.camLid) { e.camLid.y0 = e.gy + e.y + 2.3; e.camLid.y1 = e.gy + e.y + 2.38; }
        // the rig reads carMesh.position.y itself at 9.5; only the legacy
        // fallback record still needs poking
        if (e.plat) e.plat.top = e.gy + e.y + e.slabTop;
      }
      armControls(P);
    });

    root.visible = false; // hidden until survival mode activates
    /* ---- CBZ.island — THE ISLAND, AS DATA FOR THE DISASTERS ----------------
       Every disaster used to carry its own idea of where things were (the
       volcano at the centre, the town in a ring, a 120 m disc). This is the
       one answer, read off the plan and the build, so an effect adapts to
       the island instead of typing in coordinates. Everything is world
       metres; lists are the live records (the same objects arena.fragile,
       arena.cars and arena.flammable hold), never copies.

         bounds        {cx, cz, R, x0, x1, z0, z1, seaR}
         coast         [{x, z}] the grass edge (a circle, 128 points), and
                       coastAt(angle) -> radius; beachR / shelfR the bands
         buildings     [{x, z, w, d (world-axis footprint), h, gy, roofY,
                       roofHex, roofAccess, roof {x0..z1, y, access},
                       helipadCandidate, helipad {x,y,z,r}, storeys, kind,
                       district, name, street, style, rotY, lot, group,
                       fallen, colliders, platforms, glass, interior}]
         helipads      the buildings with a clear marked roof pad
         roads         {pieces:[{vertical, fixed, a, b, x0..z1}], junctions,
                       lanes(): [{x0,z0,x1,z1,dir}] traffic lanes (keep right),
                       bridges, inStreet(rect)}
         harbour       {quay, face, basin, breakwater, piers, jetties,
                       lighthouse, points:[{x,z}], berths}
         boats         [{group, x, z, yaw, len, beam, draft, key, moored}]
         volcano       {x, z, r, peak, rim, bowl, breach (angle), crater y}
         hills         arena.hills (volcano first)
         riverbeds     [{kind:"ghaut", pts, half, bank, depth}] the dry ravine
                       the floods and lahars run down
         lowGround     riverbeds + the quay + the beach band, and
                       lowAt(x, z) -> how far (m) the ground there stands
                       over mean sea (what floods first)
         districts     [{id, name, x0,x1,z0,z1, x, z, half}] (half: the
                       square the storm's power grid wants)
         trees / cars / signs / parking / plaza / fields / carSlots
         groundAt(x, z) the walkable surface; terrainAt(x, z) the land only
         randomPoint(minD, maxD) open dry ground
       Kept working: arena.hills[0] is the volcano, arena.radius, center,
       fragile, cars, flammable, randomPoint, onRoad, groundHeightAt. */
    (function publish() {
      const P = PLAN;
      const coast = [];
      for (let k = 0; k < 128; k++) { const a = k / 128 * Math.PI * 2; coast.push({ x: cx + Math.cos(a) * R, z: cz + Math.sin(a) * R }); }
      const WALK = CBZ.islandRoadKit && CBZ.islandRoadKit.C ? CBZ.islandRoadKit.C.WALK : 5.5;
      const pieces = roadPlan ? roadPlan.pieces.map(function (p) {
        return { vertical: p.vertical, fixed: p.fixed, a: p.a, b: p.b,
          x0: p.vertical ? p.fixed - WALK : p.a, x1: p.vertical ? p.fixed + WALK : p.b,
          z0: p.vertical ? p.a : p.fixed - WALK, z1: p.vertical ? p.b : p.fixed + WALK };
      }) : [];
      let lanesCache = null;
      function lanes() {
        if (lanesCache) return lanesCache;
        lanesCache = [];
        // keep right: on an avenue the +x lane runs toward -z; on a cross
        // street the -z lane runs toward -x (1.75 m off the centre line)
        for (const p of pieces) {
          if (p.vertical) {
            lanesCache.push({ x0: p.fixed + 1.75, z0: p.b, x1: p.fixed + 1.75, z1: p.a, dir: [0, -1] });
            lanesCache.push({ x0: p.fixed - 1.75, z0: p.a, x1: p.fixed - 1.75, z1: p.b, dir: [0, 1] });
          } else {
            lanesCache.push({ x0: p.b, z0: p.fixed - 1.75, x1: p.a, z1: p.fixed - 1.75, dir: [-1, 0] });
            lanesCache.push({ x0: p.a, z0: p.fixed + 1.75, x1: p.b, z1: p.fixed + 1.75, dir: [1, 0] });
          }
        }
        return lanesCache;
      }
      const ghaut = P ? { kind: "ghaut", name: "the Ghaut", pts: P.ghaut.pts.map(function (q) { return { x: q.x, z: q.z }; }),
        half: P.ghaut.half, bank: P.ghaut.bank, depth: P.ghaut.depth, width: P.ghaut.half * 2 + (P.ghaut.bank - P.ghaut.half) } : null;
      const districts = P ? P.districts.map(function (d) {
        return { id: d.id, name: d.name, x0: d.x0, x1: d.x1, z0: Math.max(d.z0, cz - R), z1: Math.min(d.z1, cz + R + 80),
          x: (Math.max(d.x0, cx - R) + Math.min(d.x1, cx + R)) / 2, z: (Math.max(d.z0, cz - R) + Math.min(d.z1, cz + R + 80)) / 2,
          half: Math.max(Math.min(d.x1, cx + R) - Math.max(d.x0, cx - R), Math.min(d.z1, cz + R + 80) - Math.max(d.z0, cz - R)) / 2 };
      }) : [];
      const bz1 = P ? Math.max(cz + R, P.harbour.basin.z1) : cz + R;
      const I = CBZ.island = {
        arena: arena, plan: P,
        cx: cx, cz: cz, center: { x: cx, z: cz }, R: R, radius: R, seaY: OCEAN_Y,
        bounds: { cx: cx, cz: cz, R: R, x0: cx - R, x1: cx + R, z0: cz - R, z1: bz1,
          minX: cx - R - 12, maxX: cx + R + 12, minZ: cz - R - 12, maxZ: bz1 + 12, seaR: FAR_WL },
        coast: coast, beachR: R + BEACH_W * 0.45, shelfR: SHORE_R,
        coastAt: function () { return R; },
        /* what the wind lifts at (x, z), as linear albedo (systems/tornado.js's
           debris cloud takes its colour from it): the sea gives spray, the
           beach sand, a street concrete and asphalt grit, the grass torn turf
           over soil (a field's debris cloud is brown with an olive cast, never
           green). Returns `out`. */
        dustColorAt: function (x, z, out) {
          out = out || [0, 0, 0];
          const set = function (r, g, b) { out[0] = r; out[1] = g; out[2] = b; return out; };
          if (groundHeightAt(x, z) < OCEAN_Y + 0.05) return set(0.30, 0.32, 0.34);
          if (Math.hypot(x - cx, z - cz) > R + 1) return set(0.25, 0.205, 0.125);
          if (onRoad(x, z, 1, 1)) return set(0.075, 0.073, 0.072);
          grassColorAt(x, z, out);
          return set(out[0] * 0.4 + 0.051, out[1] * 0.4 + 0.041, out[2] * 0.4 + 0.030);
        },
        buildings: fragile,
        helipads: fragile.filter(function (b) { return b.helipadCandidate; }),
        roads: { pieces: pieces, junctions: roadPlan ? roadPlan.junctions.map(function (j) { return { x: j.x, z: j.z, n: j.n, N: j.N, S: j.S, E: j.E, W: j.W }; }) : [],
          lanes: lanes, bridges: harbourOut.bridges, segs: roadSegs,
          inStreet: function (r) { return P ? !!P.inStreet(r, 0) : false; }, onRoad: onRoad,
          /* what the street IS at a point, not just whether one is near:
             >= 0 the footway's height over the ground, -1 the carriageway,
             -2 no street (island_roads.js walkAt). onRoad answers for the
             whole corridor, verge and footways included, so a sinkhole rim
             could not tell asphalt from paving from it. */
          walkAt: function (x, z) { return roadNet && roadNet.walkAt ? roadNet.walkAt(x, z) : -2; },
          // asphalt over the plain (island_roads.js LIFT): the drawn road top
          lift: CBZ.islandRoadKit && CBZ.islandRoadKit.C ? CBZ.islandRoadKit.C.LIFT : 0.04 },
        // the turf's own linear albedo at a point (the same field the grass
        // vertex colours are painted from)
        grassColorAt: function (x, z, out) { return grassColorAt(x, z, out || [0, 0, 0]); },
        // the harbour is a LIST of seawall / pier points (what the storm's surf
        // hits hardest: systems/hurricane.js harbour()) carrying the rest of
        // the harbour as named fields
        harbour: P ? Object.assign(harbourOut.points.slice(), { quay: P.harbour.quay, face: P.harbour.face, basin: P.harbour.basin,
          breakwater: P.harbour.breakwater, piers: P.harbour.piers, jetties: harbourOut.jetties, lighthouse: P.harbour.light,
          berths: P.harbour.berths, points: harbourOut.points }) : [],
        boats: harbourOut.boats,
        volcano: { x: VOL.x, z: VOL.z, r: VOL.r, peak: VOL.peak, rim: VOL.rim, bowl: VOL.bowl, breach: VOL.breach,
          craterY: VOL.peak - VOL.bowl },
        hills: hills,
        riverbeds: ghaut ? [ghaut] : [],
        rivers: ghaut ? [ghaut] : [],
        bridges: harbourOut.bridges,
        manholes: roadNet && roadNet.manholes ? roadNet.manholes : [],
        streetLights: roadNet && roadNet.lights ? roadNet.lights.map(function (l) { return { x: l.x, z: l.z }; }) : [],
        // register a function to run when the island is reset between matches
        onReset: function (fn) { if (typeof fn === "function" && resetHooks.indexOf(fn) < 0) resetHooks.push(fn); return fn; },
        lowGround: P ? P.lowGround : [],
        lowAt: function (x, z) { return groundHeightAt(x, z) - OCEAN_Y; },
        districts: districts,
        trees: flammable, cars: cars,
        carSlots: P ? P.cars : [],
        parking: P ? P.parking.map(function (q) { return { rect: q.rect, name: q.name, bays: q.bays, gy: q.gy }; }) : [],
        plaza: P ? P.plaza : null, fields: P ? P.fields : [],
        signs: (islandDress && islandDress.signs) || [],
        // the lamp materials beyond the street kit's (the storm's power grid
        // darkens them by district): the lighthouse lens, the square's lanterns
        powerMaterials: function () {
          const out = [];
          if (harbourOut.lens) out.push(harbourOut.lens.material);
          if (islandDress && islandDress.lensMaterial) out.push(islandDress.lensMaterial);
          return out;
        },
        groundAt: surfaceHeightAt, groundHeightAt: surfaceHeightAt, terrainAt: groundHeightAt,
        glass: allGlass,
        randomPoint: function (a, b) { return arena.randomPoint(a, b); },
        stats: function () {
          // cars: the real vehicles standing (island_vehicles.js), of carSpots spots
          return { radius: R, buildings: fragile.length, cars: cars.length, carSpots: carSpots.length, propCars: 0, trees: flammable.length, boats: harbourOut.boats.length,
            bake: bakeStats, trees_draws: treeProxy ? treeProxy.stats() : null, cars_draws: CBZ.carInstanceAudit ? CBZ.carInstanceAudit() : null };
        },
      };
      arena.island = I;
    })();

    return arena;
  };
})();
