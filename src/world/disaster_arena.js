/* ============================================================
   world/disaster_arena.js — the SURVIVAL battle-royale map.

   A disaster island built FAR from the prison (z≈600) so both worlds
   can coexist with zero refactor: an escape match never sees it, a
   survival match teleports here. Everything lives in one group
   (arena.root) so escape mode just hides it.

   The island has a tall central MOUNTAIN (the tsunami refuge) plus a
   few hills — modelled as cones AND as a CBZ.floorAt() height field so
   the otherwise-flat (Y-agnostic) physics lets you actually walk up to
   high ground. Around it: a bright low-poly town of ENTERABLE buildings
   — every one has a front door, windows, a switchback stair that climbs
   to each floor and the roof, walkable floor slabs, and a roof you can
   stand on. They register their floors/stairs/roof as CBZ.platforms and
   their walls as height-gated CBZ.colliders, so the new vertical physics
   lets you go inside and up. None of them are safe: the earthquake
   topples each one as a single piece (walls, floors AND roof) — there
   is no safe building, only the right KIND of shelter for each hazard,
   high ground, and luck. (No zones — the disasters are the pressure.)

   CBZ.buildDisasterArena() builds once and returns the arena descriptor.
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
  CBZ.survSeaHeightAt = function (x, z) {
    const mean = arena_meanY();
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
    return arena_meanY() - arena.groundHeightAt(x, z);
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
      const lip = S.h[i] - (sea + swash);          // m above the breathing waterline
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

  const FH = 3.4;     // floor-to-floor height
  const WT = 0.3;     // wall thickness
  const SW = 3.6;     // broad stairwell strip (two easy lanes along the -x interior wall)
  const DOORW = 1.8;  // front doorway width


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
  function shadeHex(hex, f) {
    const r = Math.max(0, Math.min(255, (((hex >> 16) & 255) * f) | 0));
    const g2 = Math.max(0, Math.min(255, (((hex >> 8) & 255) * f) | 0));
    const b = Math.max(0, Math.min(255, ((hex & 255) * f) | 0));
    return (r << 16) | (g2 << 8) | b;
  }

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
     depth precision fixes an exact tie. What fixes it is saying who wins:
     every deco colour bucket gets a polygonOffset rank from the order the
     grammar painted it (cladding first, the trim laid over it later), and the
     shell walls rank 0 under all of it. Ties now resolve the same way every
     frame at every distance, because polygonOffset is in depth units.

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

  // One material per (colour, rank, foot height), shared island-wide. rank 0
  // is the shell; rank >= 1 is facade deco, pulled forward one step per rank.
  const finMats = new Map();
  function finishMat(col, rank, baseY) {
    const key = col + "|" + rank + "|" + Math.round(baseY * 5);
    let m = finMats.get(key);
    if (m) return m;
    m = new THREE.MeshLambertMaterial({ color: col });
    if (rank > 0) {
      m.polygonOffset = true;
      m.polygonOffsetFactor = -1;
      m.polygonOffsetUnits = -(1 + rank);
    }
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
  function glassBoxMat(col, rank) {
    const key = col + "|" + rank;
    let m = glassBoxMats.get(key);
    if (m) return m;
    const c = new THREE.Color(col).lerp(new THREE.Color(0x6d7c89), 0.55);
    m = new THREE.MeshStandardMaterial({ color: c, metalness: 0.9, roughness: 0.16,
      envMap: CBZ.ENV || null, envMapIntensity: 1.1 });
    if (rank > 0) { m.polygonOffset = true; m.polygonOffsetFactor = -1; m.polygonOffsetUnits = -(1 + rank); }
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

    // does the facade cover local point (t, y) on face f? (only boxes that
    // stand proud of the wall face count: a box flush with the wall is paint,
    // and the window cut goes through it)
    function coveredFn(f) {
      const list = [];
      for (const b of o.recs) {
        const nC = f.horiz ? b[2] : b[0], nH = (f.horiz ? b[5] : b[3]) / 2;
        const outer = f.out > 0 ? (nC + nH) - f.halfN : -f.halfN - (nC - nH);
        const inner = f.out > 0 ? (nC - nH) - f.halfN : -f.halfN - (nC + nH);
        if (outer < 0.026 || inner > 0.12) continue;
        const tC = (f.horiz ? b[0] : b[2]) * (f.horiz ? f.tx : f.tz), tH = (f.horiz ? b[3] : b[5]) / 2;
        list.push([tC - tH, tC + tH, b[1] - b[4] / 2, b[1] + b[4] / 2]);
      }
      return function (t, y) {
        for (let i = 0; i < list.length; i++) {
          const q = list[i];
          if (t > q[0] && t < q[1] && y > q[2] && y < q[3]) return true;
        }
        return false;
      };
    }

    const STEP = 0.06, VSTEP = 0.05;
    for (const f of faces) {
      const cov = coveredFn(f);
      const half = f.span / 2 - 0.35;
      for (let k = 0; k < o.storeys; k++) {
        const shop = !o.tower && f.s === 0 && k === 0;
        const b0 = k * o.fh + (shop ? 0.4 : 0.55), b1 = (k + 1) * o.fh - 0.45;
        const yMid = b0 + (b1 - b0) * 0.55;
        const runs = [];
        let start = null;
        for (let t = -half; t <= half + 1e-6; t += STEP) {
          const doorBlock = f.s === 0 && k === 0 && Math.abs(t) < o.doorHalf;
          const open = !doorBlock && !cov(t, yMid);
          if (open && start == null) start = t;
          if ((!open || t + STEP > half + 1e-6) && start != null) {
            const end = open ? t : t - STEP;
            if (end - start >= 0.3) runs.push([start, end]);
            start = null;
          }
        }
        for (const run of runs) {
          const tm = (run[0] + run[1]) / 2;
          let v0 = yMid, v1 = yMid;
          while (v0 - VSTEP >= b0 && !cov(tm, v0 - VSTEP)) v0 -= VSTEP;
          while (v1 + VSTEP <= b1 && !cov(tm, v1 + VSTEP)) v1 += VSTEP;
          if (v1 - v0 < 0.35) continue;
          const u0 = run[0] - STEP / 2, u1 = run[1] + STEP / 2;
          const bare = !cov(tm, v0 - 0.12);
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
          holes.push({ s: f.s, a0: Math.min(ta, tb), a1: Math.max(ta, tb), y0: v0, y1: v1 });
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
      }
    }

    // ---- THE CUT: every opening goes through the cladding and the wall ----
    const SUB = CBZ.FACADE_F && CBZ.FACADE_F.subtractBox;
    if (holes.length && SUB) {
      // (1) deco boxes lying in the wall's plane zone (flush paint, a panel
      //     laid on the wall) lose the part inside the opening
      const vol = holes.map(function (h) {
        const f = faces[h.s], n0 = f.halfN - WT_ - 0.05, n1 = f.halfN + 0.03;
        const lo = f.out > 0 ? n0 : -n1, hi = f.out > 0 ? n1 : -n0;
        return f.horiz
          ? { x0: h.a0, x1: h.a1, z0: lo, z1: hi, y0: h.y0, y1: h.y1 }
          : { x0: lo, x1: hi, z0: h.a0, z1: h.a1, y0: h.y0, y1: h.y1 };
      });
      const kept = [];
      const queue = o.recs.slice();
      for (let qi = 0; qi < queue.length; qi++) {
        const b = queue[qi];
        const bx0 = b[0] - b[3] / 2, bx1 = b[0] + b[3] / 2, by0 = b[1] - b[4] / 2, by1 = b[1] + b[4] / 2, bz0 = b[2] - b[5] / 2, bz1 = b[2] + b[5] / 2;
        let hit = null;
        for (let j = 0; j < vol.length; j++) {
          const c = vol[j];
          if (bx1 > c.x0 + 1e-4 && bx0 < c.x1 - 1e-4 && bz1 > c.z0 + 1e-4 && bz0 < c.z1 - 1e-4 && by1 > c.y0 + 1e-4 && by0 < c.y1 - 1e-4) { hit = c; break; }
        }
        if (!hit) { kept.push(b); continue; }
        const parts = SUB([bx0, bx1, by0, by1, bz0, bz1], hit);
        for (const p of parts) queue.push([(p[0] + p[1]) / 2, (p[2] + p[3]) / 2, (p[4] + p[5]) / 2, p[1] - p[0], p[3] - p[2], p[5] - p[4], b[6]]);
      }
      o.recs.length = 0;
      for (const b of kept) o.recs.push(b);
      // (2) the shell walls themselves
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
    return panes;
  }

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
    const mine = hs.filter(function (h) { return h.a1 > a0 + 0.01 && h.a0 < a1 - 0.01 && h.y1 > y0 + 0.01 && h.y0 < y1 - 0.01; });
    if (!mine.length) return;
    const clampA = function (v) { return Math.max(a0, Math.min(a1, v)); };
    const clampY = function (v) { return Math.max(y0, Math.min(y1, v)); };
    const xs = [a0, a1], ys = [y0, y1];
    for (const h of mine) { xs.push(clampA(h.a0), clampA(h.a1)); ys.push(clampY(h.y0), clampY(h.y1)); }
    const uniq = function (arr) {
      arr.sort(function (p, q) { return p - q; });
      const o2 = [];
      for (const v of arr) if (!o2.length || v - o2[o2.length - 1] > 0.004) o2.push(v);
      return o2;
    };
    const X = uniq(xs), Y = uniq(ys);
    const solidCell = function (i, j) {
      const cx = (X[i] + X[i + 1]) / 2, cy = (Y[j] + Y[j + 1]) / 2;
      for (const h of mine) if (cx > h.a0 && cx < h.a1 && cy > h.y0 && cy < h.y1) return false;
      return true;
    };
    // runs per row, then stack identical runs in consecutive rows
    let open = new Map();          // "i0|i1" -> {i0, i1, j0}
    const rects = [];
    for (let j = 0; j < Y.length - 1; j++) {
      const rowRuns = [];
      for (let i = 0; i < X.length - 1; ) {
        if (!solidCell(i, j)) { i++; continue; }
        let e = i;
        while (e + 1 < X.length - 1 && solidCell(e + 1, j)) e++;
        rowRuns.push(i + "|" + e);
        i = e + 1;
      }
      const next = new Map();
      for (const key of rowRuns) {
        if (open.has(key)) { next.set(key, open.get(key)); open.delete(key); }
        else { const pr = key.split("|"); next.set(key, { i0: +pr[0], i1: +pr[1], j0: j }); }
      }
      open.forEach(function (r) { rects.push([r.i0, r.i1, r.j0, j - 1]); });
      open = next;
    }
    open.forEach(function (r) { rects.push([r.i0, r.i1, r.j0, Y.length - 2]); });
    const geos = [];
    const th = horiz ? wl.bd : wl.bw;
    for (const r of rects) {
      const ra0 = X[r[0]], ra1 = X[r[1] + 1], ry0 = Y[r[2]], ry1 = Y[r[3] + 1];
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
    // colours keep the order they were first painted in (that order is the
    // polygonOffset rank, see THE FINISH)
    const recs = [];
    const colOrder = [];
    const seenCol = new Set();
    const group = o.group, ox = o.ox, oz = o.oz, gy = o.gy;
    const dressed = !!(CBZ.dressFacade && o.style && !(CBZ.CONFIG && CBZ.CONFIG.SURV_FACADES === false));

    function dbox(lx, ly, lz, bw, bh, bd, col) {
      if (!(bw > 0) || !(bh > 0) || !(bd > 0)) return;
      if (!Number.isFinite(lx + ly + lz + bw + bh + bd)) return;
      const key = col >>> 0;
      if (!seenCol.has(key)) { seenCol.add(key); colOrder.push(key); }
      recs.push([lx, ly, lz, bw, bh, bd, key]);
    }
    // the shell's own merge-able pieces (treads, slabs, landings) join the
    // deco merge at rank 0, so they cost one draw call per colour
    if (o.shellMerge) for (const it of o.shellMerge) {
      const g2 = new THREE.BoxGeometry(it[3], it[4], it[5]);
      g2.deleteAttribute("uv");
      g2.translate(it[0], it[1], it[2]);
      it.push(g2);
    }
    function addMesh(geo, col, lx, ly, lz, emissive) {
      const m = new THREE.Mesh(geo, emissive ? mat(col, { emissive: col, ei: 0.8 }) : finishMat(col, 0, gy));
      m.position.set(lx, ly, lz);
      m.castShadow = !emissive; m.receiveShadow = true;
      group.add(m);
      return m;
    }

    const ctx = {
      ox: ox, oz: oz, w: o.w, d: o.d, storeys: o.storeys,
      FH: o.fh, WT: o.wt, rTop: o.rTop, pp: o.pp, doorSide: o.doorSide,
      slabCx: 0, slabCz: 0, slabW: o.w - 2 * o.wt, slabD: o.d - 2 * o.wt,
      garageGround: false, showroom: false, civic: null,
      dress: { style: o.style },
      pal: { wall: o.color, stone: shadeHex(o.color, 1.14), dirt: 0x2a2420, kind: "brick", id: null },
      color: o.color,
      TRIM: shadeHex(o.color, 1.16),
      BASE: shadeHex(o.color, 0.60),
      PIL: shadeHex(o.color, 1.06),
      MULL: 0x39404a,
      hash: function (salt) { return CBZ.hash01 ? CBZ.hash01(ox, oz, salt) : 0.42; },
      dbox: dbox,
      // A facade never needs a collider on this island — the arena's own walls
      // already carry them — so lbox is deliberately the deco path too.
      lbox: function (lx, ly, lz, bw, bh, bd, col) { dbox(lx, ly, lz, bw, bh, bd, col); },
      plat: function (lx0, lx1, lz0, lz1, top, ramp) {
        const p = { minX: ox + lx0, maxX: ox + lx1, minZ: oz + lz0, maxZ: oz + lz1, top: gy + top };
        if (ramp) {
          p.ramp = { z0: oz + ramp.z0, z1: oz + ramp.z1, y0: gy + ramp.y0, y1: gy + ramp.y1 };
        }
        CBZ.platforms.push(p); if (o.plats) o.plats.push(p);
      },
      ball: function (lx, ly, lz, r, col) { addMesh(new THREE.SphereGeometry(r, 10, 7), col, lx, ly, lz); },
      column: function (lx, ly, lz, r, h, col, seg) {
        addMesh(new THREE.CylinderGeometry(r, r, h, seg || 12), col, lx, ly + h / 2, lz);
      },
      cone: function (lx, ly, lz, r, h, col) { addMesh(new THREE.ConeGeometry(r, h, 14), col, lx, ly + h / 2, lz); },
      dome: function (lx, ly, lz, r, col) {
        addMesh(new THREE.SphereGeometry(r, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), col, lx, ly, lz);
      },
      lamp: function (lx, ly, lz, r, col) { addMesh(new THREE.SphereGeometry(r, 8, 6), col, lx, ly, lz, true); },
      disc: function () {},                 // clock faces: civic only, not here
      plaque: function () {}, seal: function () {},
    };

    /* THE LIFT TOP. A tower's lift shaft is handed to the kit BEFORE the
       grammar runs: the kit dry-runs the grammar, finds the top of the crown's
       mass over the shaft, and says which volume the real build must leave
       hollow so the car can get there (city/facade_kit.js, KEEP-CLEAR COLUMNS). */
    let lift = null;
    if (dressed && o.liftShaft && CBZ.facadeLiftTop) {
      try {
        lift = CBZ.facadeLiftTop(ctx, o.liftShaft, { ring: 1.2 });
        ctx.keepClear = lift.keepClear;
      } catch (e) { lift = null; }
    }
    const def = dressed ? CBZ.dressFacade(ctx) : null;
    if (!def) lift = null;

    // ---- the windows, read off what the grammar left open ------------------
    const fh = (CBZ.hash01 ? CBZ.hash01(ox, oz, 0xf4a3) : 0.3);
    const frameCol = o.frameCol != null ? o.frameCol
      : [0xe6e1d6, 0x34312d, 0x6b6f73, 0xe6e1d6, 0x2c3a33][(fh * 5) | 0];
    glazeBuilding({
      group: group, ox: ox, oz: oz, gy: gy, w: o.w, d: o.d, storeys: o.storeys,
      fh: o.fh, wt: o.wt, doorHalf: o.doorHalf || 1.3, list: o.glassList, recs: recs, walls: o.walls,
      tower: !!o.tower, dbox: dbox, frameCol: frameCol,
      sillCol: shadeHex(0xd6cfbf, 0.94 + fh * 0.1),
      sillStain: shadeHex(o.color, 0.72),
    });

    // ---- flush: one mesh per colour, each ranked by when it was painted ----
    // (see THE FINISH: the rank is what settles a tie between two buckets'
    // coplanar faces the same way every frame)
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
    let rank = 0;
    for (const col of colOrder) {
      rank++;
      const geos = byColour.get(col);
      if (geos) flush(geos, isGlassHex(col) ? glassBoxMat(col, rank) : finishMat(col, rank, gy), false);
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
        const m = flush(b.geos, finishMat(b.col, 0, gy), b.los);
        if (m && b.los) CBZ.losBlockers.push(m);
      });
    }
    return { def: def, lift: lift };
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
    const grassMat = skinMat("grass");
    grassMat.name = "survival-grass";
    /* THE TILE WAS A CHECKERBOARD. One 3.2 m repeat of a map with clumps in
       it is a grid you can count from the beach and a chessboard from a boat
       (the mipmaps average each tile to its own blotch). A second read of the
       same map, rotated 37 degrees at 3.2x the size, averaged in, breaks the
       period without a second texture or a second draw. */
    if (grassMat.map) {
      grassMat.onBeforeCompile = function (sh) {
        sh.fragmentShader = sh.fragmentShader.replace("#include <map_fragment>",
          "#ifdef USE_MAP\n" +
          "  vec2 uvB = mat2(0.8, -0.6, 0.6, 0.8) * vUv * 0.3125 + vec2(0.37, 0.11);\n" +
          "  vec4 texelColor = mix(texture2D(map, vUv), texture2D(map, uvB), 0.5);\n" +
          "  texelColor = mapTexelToLinear(texelColor);\n" +
          "  diffuseColor *= texelColor;\n" +
          "#endif");
      };
      grassMat.customProgramCacheKey = function () { return "survival-grass-2tap"; };
    }

    // ---- hills / mountain (the high-ground height field) ----
    const hills = [
      { x: cx, z: cz, r: 36, peak: 30 },          // central refuge mountain (the volcano)
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
    const VOL_RIM = 6.2;                    // crater rim radius (m)
    const VOL_BOWL = 3.6;                   // crater floor, metres below the nominal rim
    const VOL_FLANK = VOL.r - VOL_RIM;      // horizontal run, rim -> base
    const VOL_GULLY = 2.3;                  // barranco depth at its deepest (m)
    const VOL_POW = 1.65;                   // profile concavity
    const VOL_BREACH_D = 2.2;               // how far the breached sector drops
    const _vh = CBZ.hash01 || function (a, b, s) { return ((s * 0.618034) % 1 + 1) % 1; };
    const VOL_P1 = _vh(VOL.x, VOL.z, 0x5601) * 6.2831853;
    const VOL_P2 = _vh(VOL.x, VOL.z, 0x5602) * 6.2831853;
    const VOL_P3 = _vh(VOL.x, VOL.z, 0x5603) * 6.2831853;
    const VOL_P4 = _vh(VOL.x, VOL.z, 0x5608) * 6.2831853;
    // the breach faces the town side the island is usually seen from
    // (-x / +z, away from the sun), wobbled per seed so it is not ruled
    const VOL_BREACH_A = 2.45 + (_vh(VOL.x, VOL.z, 0x5609) - 0.5) * 0.9;
    VOL.rim = VOL_RIM; VOL.bowl = VOL_BOWL; VOL.breach = VOL_BREACH_A;
    function angDiff(a, b) {
      let d = (a - b) % 6.2831853;
      if (d > 3.14159265) d -= 6.2831853; else if (d < -3.14159265) d += 6.2831853;
      return d;
    }
    // the rim's own skyline, in metres about VOL.peak (the notch included)
    function volcanoRimAt(ang) {
      const db = angDiff(ang, VOL_BREACH_A) / 0.34;
      return 0.55 * Math.sin(2 * ang + VOL_P3) + 0.32 * Math.sin(3 * ang + VOL_P4)
        + 0.16 * Math.sin(7 * ang + VOL_P1)
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
      const drift = 0.32 * Math.sin(d * 0.085);
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
      const rill = 0.35 * Math.sin(31 * ang + VOL_P2 * 3 + d * 0.2) * env * t;
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
      if (h > 0 || CBZ.CONFIG.SURV_SEABED === false) return h;
      return seabedAt(x, z);
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
    ocean.position.set(cx, OCEAN_Y, cz);
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
    if (CBZ.onUpdate) CBZ.onUpdate(47.9, function () {
      if (!arena || !CBZ.game || !CBZ.islandModeOn(CBZ.game.mode)) return;
      ocean.position.y = arena_meanY();
      if (dryU) {
        const sg = CBZ.waterSurge ? CBZ.waterSurge() : 0;
        dryU.value.set(cx, cz, dryR, 3 * Math.max(0, Math.min(1, 1 - Math.max(0, sg) / 0.5)));
      }
      const cam = CBZ.camera;
      if (cam) {
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
      const shoreGeo = new THREE.RingGeometry(R - 3, SHORE_R - 1, 96, 20);
      const sp = shoreGeo.attributes.position, sa = sp.array, vn = sp.count;
      const cols = new Float32Array(vn * 3);   // live colour (base × wetness)
      const base = new Float32Array(vn * 3);   // authored colour, never mutated
      const vh = new Float32Array(vn);         // vertex height (the profile)
      const vth = new Float32Array(vn);        // vertex theta (alongshore phase)
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
      const shoreMat = skinMat("sand");
      shoreMat.name = "survival-beach-shore";     // no water/ocean/sea in the name (test contract)
      const shore = new THREE.Mesh(shoreGeo, shoreMat);
      shore.rotation.x = -Math.PI / 2; shore.position.set(cx, 0, cz);
      shore.receiveShadow = true;
      shore.userData.coat = true;                 // it is the ground; blizzards coat it
      shore.userData.dynamic = true;              // never batch-merge a mesh we repaint
      root.add(shore);
      shoreRig = { attr: shoreGeo.getAttribute("color"), base, h: vh, th: vth, wet: new Float32Array(vn), n: vn };
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
    // THE GRASS PLAIN — same flat disc at y 0, now a fine polar grid so the
    // vertex colour can carry the island's patchwork (grassColorAt above),
    // wearing the normalised grass map at GRASS_TILE metres a repeat.
    const islandGeo = new THREE.RingGeometry(0.4, R, 128, 40);
    {
      const p = islandGeo.attributes.position, n = p.count, col = new Float32Array(n * 3), c3 = [0, 0, 0];
      for (let i = 0; i < n; i++) {
        grassColorAt(cx + p.getX(i), cz - p.getY(i), c3);
        col[i * 3] = c3[0]; col[i * 3 + 1] = c3[1]; col[i * 3 + 2] = c3[2];
      }
      islandGeo.setAttribute("color", new THREE.BufferAttribute(col, 3));
      worldUV(islandGeo, GRASS_TILE, cx, cz, function (pp, i, w) { w.x = pp.getX(i); w.z = -pp.getY(i); });
    }
    const island = new THREE.Mesh(islandGeo, grassMat);
    island.rotation.x = -Math.PI / 2; island.position.set(cx, 0, cz);
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
    const glassMat = new THREE.MeshLambertMaterial({ color: 0xbfe9f7, emissive: 0x3f8aa6, emissiveIntensity: 0.55, transparent: true, opacity: 0.5 });
    glassMat._shared = true;
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

    function makeBuilding(ox, oz, w, d, storeys, color, gy, style) {
      const bgroup = new THREE.Group();
      bgroup.position.set(ox, gy, oz);
      root.add(bgroup);

      const cols = [], plats = [], glassList = [], shellMerge = [];
      const ixMin = -w / 2 + WT, ixMax = w / 2 - WT;   // interior x span
      const izMin = -d / 2 + WT, izMax = d / 2 - WT;   // interior z span
      const sx = ixMin + SW / 2;                       // stairwell strip centre (x)

      // local box; opts.solid → height-gated collider, opts.plat → walkable top,
      // opts.los → camera/vision blocker. Coords are local to bgroup; the
      // collider/platform records carry the world-space rectangle.
      // opts.merge → no mesh of its own: it joins the building's merged shell
      // (slabs, treads, parapets: nothing that is a collider's ref or a wall
      // the tsunami tears off)
      function lbox(lx, ly, lz, bw, bh, bd, col, opts) {
        opts = opts || {};
        let m = null;
        if (opts.merge && !opts.solid) {
          shellMerge.push([lx, ly, lz, bw, bh, bd, col, !!opts.los]);
        } else {
          m = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), opts.emissive ? mat(col, { emissive: opts.emissive, ei: 0.5 }) : finishMat(col, 0, gy));
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
         footprint, so no sliver of terrain shows along the wall line either. */
      lbox(0, -0.27, 0, w, 0.7, d, 0x6c7178, { plat: true, merge: true });

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
        } else {
          wall(0, 0, ly, -d / 2 + WT / 2, w, FH, WT);
        }
      }

      // floor slabs (levels 1..storeys; the top one is the ROOF). Each slab
      // covers the interior MINUS the open stairwell strip on the -x side.
      const slabW = ixMax - (ixMin + SW), slabCx = (ixMin + SW + ixMax) / 2, slabD = izMax - izMin, slabCz = (izMin + izMax) / 2;
      for (let L = 1; L <= storeys; L++) {
        const isRoof = L === storeys;
        lbox(slabCx, L * FH - 0.1, slabCz, slabW, 0.2, slabD, isRoof ? 0x9fa6ad : 0xb9bec6, { plat: true, los: true, cast: isRoof, merge: true });
      }
      // a slab over the stairwell strip on the GROUND floor's far side would
      // block the climb, so we leave the strip open all the way up; the roof
      // gets a low parapet on three sides so you don't walk straight off.
      const rTop = storeys * FH;
      lbox(slabCx, rTop + 0.35, d / 2 - WT / 2, slabW, 0.7, WT, 0x8b9097, { los: true, merge: true });   // +z parapet
      lbox(w / 2 - WT / 2, rTop + 0.35, slabCz, WT, 0.7, slabD, 0x8b9097, { los: true, merge: true });    // +x parapet
      lbox(slabCx, rTop + 0.35, -d / 2 + WT / 2, slabW, 0.7, WT, 0x8b9097, { los: true, merge: true });   // -z parapet

      // TWO-LANE switchback stairs. The up-flight and the down-flight must
      // never share an (x,z), or groundAt() (highest surface within step
      // reach) would escalate you onto whichever flight is higher and you
      // could never walk DOWN. So flight k takes the LEFT lane on even
      // storeys and the RIGHT lane on odd ones, reversing its run each time;
      // the only ramps stacked over any point are then two storeys (2·FH)
      // apart — far outside STEP_UP — so support is unambiguous both ways.
      // Each flight's walkable surface is a smooth ramp (you glide, no tread
      // hopping); a flat landing at each level bridges the two lanes.
      const nSteps = 9;
      const LD = 1.1;   // flat landing depth at the top of each flight
      const zA = izMin + 0.3, zB = izMax - 0.3;
      const laneW = SW / 2;
      for (let k = 0; k < storeys; k++) {
        const dir = (k % 2 === 0) ? 1 : -1;
        const startZ = dir > 0 ? zA : zB, endZ = dir > 0 ? zB : zA;
        const rampEndZ = endZ - dir * LD;       // ramp stops where the landing starts…
        const lx0 = (k % 2 === 0) ? ixMin : ixMin + laneW;   // this flight's lane
        const lxc = lx0 + laneW / 2;
        // smooth physics ramp confined to the lane, k·FH (at startZ) → (k+1)·FH
        // (at rampEndZ). It ENDS at the landing's inner edge and meets it at the
        // SAME height, so there's no shelf-edge drop when you step off — that was
        // the descent glitch on short flights.
        const ramp = {
          minX: ox + lx0 + 0.04, maxX: ox + lx0 + laneW - 0.04,
          minZ: oz + Math.min(startZ, rampEndZ), maxZ: oz + Math.max(startZ, rampEndZ),
          top: gy + (k + 1) * FH,
          ramp: { z0: oz + startZ, z1: oz + rampEndZ, y0: gy + k * FH, y1: gy + (k + 1) * FH },
        };
        CBZ.platforms.push(ramp); plats.push(ramp);
        // visible treads riding on the ramp (start → rampEnd)
        const runLen = Math.abs(rampEndZ - startZ), runDepth = runLen / nSteps, rise = FH / nSteps;
        for (let i = 1; i <= nSteps; i++) {
          const vtop = k * FH + (i - 0.5) * rise;
          const cz2 = startZ + dir * (i - 0.5) * runDepth;
          lbox(lxc, vtop - 0.13, cz2, laneW - 0.16, 0.26, runDepth + 0.04, 0xa7adb5, { cast: false, merge: true });
        }
        // flat landing across BOTH lanes, from the ramp's top edge out to endZ,
        // at exactly (k+1)·FH — bridges the two lanes and meets the next flight
        const lzc = (rampEndZ + endZ) / 2;
        lbox(ixMin + SW / 2, (k + 1) * FH - 0.1, lzc, SW, 0.2, LD + 0.2, 0xb4b9c1, { plat: true, los: true, cast: false, merge: true });
      }

      // THE FACADE. Emitted last so it dresses the finished shell, and into
      // this building's own group so the quake still topples it as one piece.
      dressIslandFacade({
        group: bgroup, ox: ox, oz: oz, gy: gy, w: w, d: d, storeys: storeys,
        fh: FH, wt: WT, rTop: rTop, pp: 0.7, doorSide: 0,   // the door is on -z
        color: color, style: style, plats: plats,
        shellMerge: shellMerge, glassList: glassList, doorHalf: DOORW / 2 + 0.35, walls: walls,
      });
      for (const gp of glassList) allGlass.push(gp);

      const b = {
        group: bgroup, ox, oz, gy, x: ox, z: oz, w, d, h: storeys * FH, storeys,
        facadeStyle: style || null,        // so a tool can photograph "the pagoda one"
        color: color,                      // the shell's real wall colour — city/collapse.js
                                           // builds its proxy out of it, so the frame where
                                           // the real building is swapped for the falling one
                                           // is a frame nobody can see
        floorTop: gy + 0.08,               // the walkable ground-floor surface, published
                                           // so a probe can assert nothing grows through it
        colliders: cols, platforms: plats, glass: glassList, fallen: false,
        // THE GROUND-FLOOR PLAN, building-local, for anyone who furnishes it
        // (systems/quake.js's shelter tables): the room inside the walls and
        // the strips that must stay walkable. The stair strip runs the whole
        // depth of the -x side; the door is on -z, and the walk from the door
        // to the foot of the stairs (zA, the -z end of lane one) runs along
        // the front wall, so that whole front band stays clear too.
        interior: {
          kind: "house",
          x0: ixMin, x1: ixMax, z0: izMin, z1: izMax,
          keepOut: [
            { x0: ixMin, x1: ixMin + SW + 0.35, z0: izMin, z1: izMax, why: "stairs" },
            { x0: -DOORW / 2 - 0.7, x1: DOORW / 2 + 0.7, z0: izMin, z1: izMin + 2.4, why: "door" },
            { x0: ixMin, x1: ixMax, z0: izMin, z1: izMin + 1.3, why: "front walk" },
          ],
        },
      };
      fragile.push(b);
      return b;
    }

    if (CBZ.bootStep) CBZ.bootStep("island:towers");
    // ---- SKYSCRAPERS: enterable hollow towers with floor landings and a
    // working ELEVATOR up the central shaft. Walk in the ground-floor door,
    // ride the lift up (it auto-cycles), step off at any floor or the roof
    // (high ground for the tsunami). Still one group so the quake topples the
    // whole thing; its walls/floors register as height-gated colliders +
    // walkable platforms (collapse yanks them all). ----
    function makeTower(ox, oz, w, d, h, color, style) {
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
      function tbox(lx, ly, lz, bw, bh, bd, col, opts) {
        opts = opts || {};
        let m = null;
        if (opts.merge && !opts.solid) {
          shellMerge.push([lx, ly, lz, bw, bh, bd, col, !!opts.los]);
        } else {
          m = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), opts.emissive ? mat(col, { emissive: opts.emissive, ei: opts.ei || 0.4 }) : finishMat(col, 0, gy));
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
      function landing(ly) {
        const zN = -(id + s) / 2, zS = (id + s) / 2, wN = id - s;
        tbox(0, ly, zN, 2 * iw, 0.2, wN, 0xb4b9c1, { plat: true, los: true, cast: false, merge: true });
        tbox(0, ly, zS, 2 * iw, 0.2, wN, 0xb4b9c1, { plat: true, los: true, cast: false, merge: true });
        tbox(-(iw + s) / 2, ly, 0, iw - s, 0.2, 2 * s, 0xb4b9c1, { plat: true, cast: false, merge: true });
        tbox((iw + s) / 2, ly, 0, iw - s, 0.2, 2 * s, 0xb4b9c1, { plat: true, cast: false, merge: true });
      }
      for (let k = 1; k < storeys; k++) landing(k * FH);
      landing(realH);                                   // roof (with the same shaft opening)

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
      // rooftop plant box, only on a roof nobody built a crown on, and clear of
      // the shaft AND of the apron you step out onto
      if (!(lift && (lift.raised || lift.headhouse))) {
        const pz0 = s + 1.4, pz1 = id - 0.2;
        if (pz1 - pz0 > 0.8) {
          const capm = new THREE.Mesh(new THREE.BoxGeometry(iw * 0.7, 1.2, pz1 - pz0), finishMat(0x8b9097, 0, gy));
          capm.position.set(0, realH + 0.7, (pz0 + pz1) / 2); capm.castShadow = true; g.add(capm);
        }
      }
      // the deck, rail and headhouse are shell pieces queued AFTER the facade
      // pass flushed the rest: one more merged mesh per colour for them
      {
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
        }
        const BGU = THREE.BufferGeometryUtils;
        late.forEach(function (bk) {
          const geo = bk.geos.length > 1 && BGU ? BGU.mergeBufferGeometries(bk.geos) : bk.geos[0];
          if (geo !== bk.geos[0]) for (const g2 of bk.geos) g2.dispose();
          const m = new THREE.Mesh(geo, finishMat(bk.col, 0, gy));
          m.castShadow = true; m.receiveShadow = true;
          g.add(m);
          if (bk.los) CBZ.losBlockers.push(m);
        });
      }

      // h stays the SHELL's height (the collapse proxy and the ash roofs are
      // built off h / storeys); the lift's top stop is published beside it
      const b = { group: g, ox, oz, gy, x: ox, z: oz, w, d, h: realH, liftTop: topY, storeys,
        facadeStyle: style || null, color: color,   // see makeBuilding: the collapse proxy is built from it
        colliders: cols, platforms: plats, glass: glassT, fallen: false,
        // THE GROUND-FLOOR PLAN (see makeBuilding): the lift shaft and the
        // apron you board it from, and the walk from the door to it
        interior: {
          kind: "tower",
          x0: -iw, x1: iw, z0: -id, z1: id,
          keepOut: [
            { x0: -s - 1.4, x1: s + 1.4, z0: -s - 1.4, z1: s + 1.4, why: "lift" },
            { x0: -DW / 2 - 0.6, x1: DW / 2 + 0.6, z0: -id, z1: 0, why: "door to lift" },
          ],
        },
      };
      fragile.push(b);

      // ---- the elevator car: a slab that rides the central shaft ----
      const carMesh = new THREE.Mesh(new THREE.BoxGeometry(2 * s - 0.1, 0.2, 2 * s - 0.1), mat(0x3a4150, { emissive: 0x10141c, ei: 0.5 }));
      carMesh.position.set(0, 0.12, 0); carMesh.castShadow = true; g.add(carMesh);
      for (let cz2 = -1; cz2 <= 1; cz2 += 2) for (let cx2 = -1; cx2 <= 1; cx2 += 2) {  // corner posts
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.6, 0.12), mat(0x5a626d));
        post.position.set(cx2 * (s - 0.12), 0.9, cz2 * (s - 0.12)); carMesh.add(post);
      }
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
        carPlat = { minX: ox - s + 0.05, maxX: ox + s - 0.05, minZ: oz - s + 0.05, maxZ: oz + s - 0.05, top: gy + 0.22 };
        CBZ.platforms.push(carPlat); plats.push(carPlat);
      }
      /* THE STOPS: the ground, EVERY floor, the shell roof (unless the crown
         fills it), and the top of the crown. Car mesh y per stop; its deck
         (slabTop 0.1 above) arrives level with each landing's walk surface. */
      const stops = [0.12];
      for (let k = 1; k < storeys; k++) stops.push(k * FH);
      if (!(lift && lift.roofBuried)) stops.push(realH);
      if (topY > realH + 0.3) stops.push(topY);
      rng();                     // was the car's start phase: keeps the island's rng stream (and so its town plan) where it was
      elevators.push({ b, mesh: carMesh, plat: carPlat, rig: carRig, gy, ox, oz, s, stops,
        y: 0.12, v: 0, dir: 1, at: 0, target: -1, dwell: 1.5, idle: 0, slabTop: 0.1 });

      return b;
    }

    if (CBZ.bootStep) CBZ.bootStep("island:streets");
    // ---- STREETS: dark asphalt running in flat, contiguous runs along grid
    // lines, with a dashed centre line. Hills/mountain break the runs so roads
    // never float. roadSegs feeds the car scatter below. ----
    // SURV_ROAD_LAYERS (round 2 of the flicker fix): the polygonOffset pass
    // did NOT hold on real hardware (iPad) — mobile TBDR GPUs map offset
    // factor/units to depth precision differently than SwiftShader, and the
    // arena laid BOTH road directions at the same y (0.05) with the SAME
    // material, so every avenue/cross-street intersection was two coplanar
    // opaque planes z-fighting. The city never flickers because it separates
    // by GEOMETRY, copying its exact proven constants here:
    //   ground 0 → avenues +0.04 → cross-streets +0.045 → paint +0.057.
    // Roads carry NO polygonOffset (pure y-separation, like city asphalt);
    // only the paint dashes keep the city's decal recipe (offset -2/-2 +
    // renderOrder 1 + userData.roadPaint so a batch pass can never strip the
    // offset — the exact guard city/world.js documents). No two planes that
    // can overlap ever share a y. false = the old 0.05/0.07 offset stack.
    const LAYERS = !CBZ.CONFIG || CBZ.CONFIG.SURV_ROAD_LAYERS !== false;
    const ROAD_Y_AVE = LAYERS ? 0.04 : 0.05;     // avenues (run along z)
    const ROAD_Y_CROSS = LAYERS ? 0.045 : 0.05;  // cross-streets (run along x)
    const ROAD_Y_PAD = LAYERS ? 0.05 : 0.05;     // forecourt/apron pads — ABOVE both road
                                                 // levels (owner: gas-station ground flickered
                                                 // where the pad overlapped an avenue at the
                                                 // same 0.04), below the 0.057 dashes
    const PAINT_Y = LAYERS ? 0.057 : 0.07;       // centre-line dashes
    const roadMat = LAYERS ? skinMat("asphalt")
      : skinMat("asphalt", { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    roadMat.name = "survival-asphalt";
    const lineMat = LAYERS
      ? new THREE.MeshLambertMaterial({ color: 0x9a7a1c, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })
      : new THREE.MeshLambertMaterial({ color: 0x9a7a1c, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    const roadSegs = [];
    const ROADW = 7;
    /* THE STREET GRID, declared HERE rather than beside the code that draws
       it, because the buildings have to be placed with it in mind and they go
       down first. It used to be declared after the town loop, which is exactly
       why nothing consulted it: the houses were scattered on flat ground and
       the asphalt was then painted straight through them. */
    const GRID = 40;                 // avenue / cross-street pitch
    const KERB = ROADW / 2 + 1.4;    // corridor half-width plus a verge

    // The nearest grid line to a coordinate, and how far off it we are.
    function nearestLine(v, origin) {
      const k = Math.max(-2, Math.min(2, Math.round((v - origin) / GRID)));
      return { line: origin + k * GRID, off: v - (origin + k * GRID) };
    }
    // Does this footprint sit in a road corridor? Avenues run along z at a
    // fixed x, cross-streets along x at a fixed z, so each axis is tested
    // against its own family of lines.
    function onRoad(x, z, w, d) {
      const a = nearestLine(x, cx), c = nearestLine(z, cz);
      return Math.abs(a.off) < w / 2 + KERB || Math.abs(c.off) < d / 2 + KERB;
    }
    /* Push a footprint OFF the nearer road and stand it on the kerb, facing
       the street. A town whose buildings line its streets reads as a town;
       the same buildings scattered between them read as a sample book, and
       the ones that landed ON the asphalt read as a bug — which is what they
       were. Returns null when the candidate cannot be seated without landing
       in the other family of roads. */
    function faceStreet(x, z, w, d) {
      const a = nearestLine(x, cx), c = nearestLine(z, cz);
      // snap on whichever axis the candidate is already closest to a line
      const snapX = Math.abs(a.off) <= Math.abs(c.off);
      const half = snapX ? w / 2 : d / 2;
      const near = snapX ? a : c;
      const side = near.off >= 0 ? 1 : -1;
      const seat = near.line + side * (KERB + half + 0.6);
      const nx = snapX ? seat : x, nz = snapX ? z : seat;
      return onRoad(nx, nz, w, d) ? null : { x: nx, z: nz };
    }
    /* THE ASPHALT. It was one flat 0x33363d plane per run plus ONE MESH PER
       CENTRE-LINE DASH (a draw call for every 6 m of road). Now every run is
       baked into ONE world-space mesh wearing the normalised asphalt map —
       aggregate, patching, hairline cracks — with vertex-colour wear: a
       dusty, sun-bleached kerb edge, darker tyre tracks down each lane, and
       slow patchwork along the length. All the dashes are ONE mesh too. */
    const roadParts = [], dashParts = [];
    function roadGeo(x, z, w, len, vertical, y) {
      const ax = vertical ? w : len, az = vertical ? len : w;         // world extents
      const nL = Math.max(1, Math.round(len / 3)), nW = 6;
      const g = new THREE.PlaneGeometry(ax, az, vertical ? nW : nL, vertical ? nL : nW);
      g.rotateX(-Math.PI / 2);
      g.translate(x, y, z);
      const p = g.attributes.position, col = new Float32Array(p.count * 3), uv = new Float32Array(p.count * 2);
      for (let i = 0; i < p.count; i++) {
        const wx = p.getX(i), wz = p.getZ(i);
        const across = (vertical ? wx - x : wz - z) / (w / 2);          // -1..1 across the road
        const edge = Math.pow(Math.abs(across), 6);                    // kerb dust
        const track = Math.exp(-Math.pow((Math.abs(across) - 0.5) / 0.14, 2));   // lane tyre lines
        const patch = fbm2(wx, wz, 11, 0x7a01);
        let v = 0.060 * (0.86 + 0.3 * patch) * (1 - 0.16 * track) + 0.05 * edge;
        col[i * 3] = v * 1.02; col[i * 3 + 1] = v; col[i * 3 + 2] = v * 0.97 + 0.004;
        uv[i * 2] = wx / 3; uv[i * 2 + 1] = wz / 3;
      }
      g.setAttribute("color", new THREE.BufferAttribute(col, 3));
      g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
      return g;
    }
    function layRoadLine(fixed, vertical) {
      const step = 4, segs = [];
      let runStart = null;
      for (let t = -R; t <= R + step; t += step) {
        const x = vertical ? fixed : cx + t;
        const z = vertical ? cz + t : fixed;
        const ok = Math.hypot(x - cx, z - cz) < R - 5 && groundHeightAt(x, z) < 0.5;
        if (ok && runStart === null) runStart = t;
        if ((!ok || t > R) && runStart !== null) {
          const runEnd = ok ? t : t - step;
          if (runEnd - runStart >= step * 2) segs.push([runStart, runEnd]);
          runStart = null;
        }
      }
      segs.forEach(([a, bb]) => {
        const midT = (a + bb) / 2, len = bb - a;
        const x = vertical ? fixed : cx + midT, z = vertical ? cz + midT : fixed;
        // avenues and cross-streets on SPLIT y levels (city constants) so the
        // planes overlapping at every intersection can never z-fight
        roadParts.push(roadGeo(x, z, ROADW, len, vertical, vertical ? ROAD_Y_AVE : ROAD_Y_CROSS));
        const dashes = Math.max(1, Math.floor(len / 6));
        for (let i = 0; i < dashes; i++) {
          const tt = a + (i + 0.5) * (len / dashes);
          const lx = vertical ? fixed : cx + tt, lz = vertical ? cz + tt : fixed;
          const dg = new THREE.PlaneGeometry(vertical ? 0.3 : 2.4, vertical ? 2.4 : 0.3);
          dg.rotateX(-Math.PI / 2); dg.translate(lx, PAINT_Y, lz);
          dashParts.push(dg);
        }
        roadSegs.push({ x, z, len, vertical });
      });
    }

    /* ---- CARS: a real car silhouette in ONE draw ---------------------------
       They were a grey box on a grey box on four cylinders — six meshes, six
       draw calls, and it read as exactly that. Now each car is ONE merged
       geometry: a bevelled side-profile body (bumpers, sloped bonnet, boot),
       a glass greenhouse under a painted roof, four tyres with pale hubs,
       head- and tail-lamps — colour baked per vertex, one shared glossy
       material for the whole fleet. Geometry is cached per (shape, paint),
       so the fleet is a handful of buffers. The record the tsunami flings
       (group/x/z/oy/rotY/collider) is unchanged; the collider's ref is the
       body mesh as before. */
    const CAR_COLORS = [0xe24b4b, 0x3c6fd6, 0xf2c43d, 0x4caf6e, 0xe8e8ee, 0x2a2d33, 0xe88a3c];
    const carMat = new THREE.MeshPhongMaterial({ color: 0xffffff, vertexColors: true, shininess: 48, specular: 0x2a2a2a });
    carMat.name = "survival-car";
    const carGeos = new Map();
    const CAR_SHAPES = [
      // side profile (length axis, height) + greenhouse profile
      { body: [[-2.1, 0.34], [2.1, 0.34], [2.13, 0.72], [1.95, 0.93], [0.78, 1.03], [-1.55, 1.05], [-2.06, 0.98], [-2.13, 0.62]],
        cab: [[0.80, 1.0], [0.02, 1.62], [-1.02, 1.62], [-1.58, 1.0]] },                         // saloon
      { body: [[-2.0, 0.36], [2.05, 0.36], [2.08, 0.74], [1.9, 0.95], [0.9, 1.05], [-1.95, 1.07], [-2.05, 0.98], [-2.08, 0.62]],
        cab: [[0.92, 1.02], [0.12, 1.66], [-1.72, 1.68], [-1.96, 1.02]] },                        // hatchback
      { body: [[-2.15, 0.40], [2.15, 0.40], [2.17, 0.82], [2.0, 1.04], [0.95, 1.12], [-2.12, 1.12], [-2.17, 1.04], [-2.19, 0.66]],
        cab: [[0.97, 1.08], [0.35, 1.78], [-0.75, 1.78], [-0.95, 1.08]] },                       // pickup
    ];
    function tintGeo(g, r, gg, b) {
      const n = g.attributes.position.count, c = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { c[i * 3] = r; c[i * 3 + 1] = gg; c[i * 3 + 2] = b; }
      g.setAttribute("color", new THREE.BufferAttribute(c, 3));
      if (!g.attributes.uv) g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(n * 2), 2));
      return g;
    }
    function profileGeo(pts, width, bevel) {
      const sh = new THREE.Shape();
      sh.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) sh.lineTo(pts[i][0], pts[i][1]);
      sh.closePath();
      const g = new THREE.ExtrudeGeometry(sh, { depth: width - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.8, bevelSegments: 2, curveSegments: 4 });
      g.translate(0, 0, -(width - bevel * 2) / 2);
      g.rotateY(Math.PI / 2);                    // profile x -> car length (z)
      return g.index ? g.toNonIndexed() : g;
    }
    function carGeo(shapeIdx, paintHex) {
      const key = shapeIdx + "|" + paintHex;
      if (carGeos.has(key)) return carGeos.get(key);
      const S = CAR_SHAPES[shapeIdx];
      const pc = new THREE.Color(paintHex).multiplyScalar(0.62);
      const parts = [];
      parts.push(tintGeo(profileGeo(S.body, 1.92, 0.1), pc.r, pc.g, pc.b));
      parts.push(tintGeo(profileGeo(S.cab, 1.62, 0.07), 0.035, 0.045, 0.055));
      // painted roof over the greenhouse
      const roofY = S.cab[1][1], rz0 = S.cab[1][0], rz1 = S.cab[2][0];
      const roof = new THREE.BoxGeometry(1.58, 0.07, Math.abs(rz0 - rz1) + 0.1).toNonIndexed();
      roof.translate(0, roofY + 0.02, -(rz0 + rz1) / 2);
      parts.push(tintGeo(roof, pc.r, pc.g, pc.b));
      // tyres + hubs
      const wz = shapeIdx === 2 ? 1.45 : 1.35;
      [[0.86, wz], [-0.86, wz], [0.86, -wz], [-0.86, -wz]].forEach(function (w) {
        const t = new THREE.CylinderGeometry(0.37, 0.37, 0.28, 14).toNonIndexed();
        t.rotateZ(Math.PI / 2); t.translate(w[0], 0.37, w[1]);
        parts.push(tintGeo(t, 0.018, 0.018, 0.02));
        const h = new THREE.CylinderGeometry(0.2, 0.2, 0.3, 10).toNonIndexed();
        h.rotateZ(Math.PI / 2); h.translate(w[0] * 1.005, 0.37, w[1]);
        parts.push(tintGeo(h, 0.35, 0.36, 0.38));
      });
      // lamps: front is -z after the profile rotation
      const fz = -S.body[1][0] - 0.02, rzb = -S.body[0][0] + 0.02, ly = 0.78;
      [[0.62, fz, 0.9, 0.88, 0.75], [-0.62, fz, 0.9, 0.88, 0.75], [0.66, rzb, 0.45, 0.02, 0.02], [-0.66, rzb, 0.45, 0.02, 0.02]].forEach(function (l) {
        const b = new THREE.BoxGeometry(0.42, 0.13, 0.06).toNonIndexed();
        b.translate(l[0], ly, l[1]);
        parts.push(tintGeo(b, l[2], l[3], l[4]));
      });
      // dark bumper/sill band
      const sill = new THREE.BoxGeometry(1.96, 0.16, Math.abs(S.body[1][0] - S.body[0][0]) + 0.1).toNonIndexed();
      sill.translate(0, S.body[0][1] + 0.06, 0);
      parts.push(tintGeo(sill, 0.03, 0.03, 0.032));
      const g = THREE.BufferGeometryUtils.mergeBufferGeometries(parts, false);
      g.computeBoundingSphere();
      parts.forEach(function (p) { p.dispose(); });
      carGeos.set(key, g);
      return g;
    }
    function makeCar(x, z, vertical, color) {
      const gy = groundHeightAt(x, z);
      const g = new THREE.Group();
      g.position.set(x, gy, z); g.rotation.y = vertical ? 0 : Math.PI / 2; root.add(g);
      const shape = (h01g(x, z, 0xca7) * CAR_SHAPES.length) | 0;
      const body = new THREE.Mesh(carGeo(shape, color), carMat);
      if (h01g(x, z, 0xca8) < 0.5) body.rotation.y = Math.PI;   // parked either way round
      body.castShadow = true; body.receiveShadow = true; g.add(body);
      const hw = vertical ? 1.1 : 2.2, hd = vertical ? 2.2 : 1.1;
      const c = { minX: x - hw, maxX: x + hw, minZ: z - hd, maxZ: z + hd, ref: body, noCam: true };
      CBZ.colliders.push(c);
      const car = { group: g, x, z, oy: gy, rotY: g.rotation.y, collider: c, flung: false };
      cars.push(car);
      return g;
    }

    // ---- GAS STATION (GTA-style): a drive-under canopy on pillars, a row of
    // fuel pumps, a price totem, and a small glass-fronted shop. The canopy
    // roof is a height-gated collider so you drive/walk under it freely. ----
    function makeGasStation(ox, oz) {
      const gy = groundHeightAt(ox, oz);
      const pad = new THREE.Mesh(new THREE.PlaneGeometry(20, 16), LAYERS
        ? new THREE.MeshLambertMaterial({ color: 0x41464d })
        : new THREE.MeshLambertMaterial({ color: 0x41464d, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
      // the forecourt apron rides its OWN level above both road planes — it
      // can overlap an avenue, and coplanar overlap is exactly the TBDR
      // z-fight the owner saw (SURV_ROAD_LAYERS)
      pad.rotation.x = -Math.PI / 2; pad.position.set(ox, gy + (LAYERS ? ROAD_Y_PAD : 0.05), oz); pad.receiveShadow = true; root.add(pad);
      if (LAYERS) pad.renderOrder = 1;
      const CH = 5.2;
      [[-6, -3.4], [6, -3.4], [-6, 3.4], [6, 3.4]].forEach(([px, pz]) => box(ox + px, gy + CH / 2, oz + pz, 0.55, CH, 0.55, 0xeef1f4, { solid: true }));
      box(ox, gy + CH + 0.45, oz, 14.5, 0.9, 9.5, 0xfbfcfe, { solid: true, y0: gy + CH, y1: gy + CH + 0.9 });
      box(ox, gy + CH + 0.1, oz - 4.9, 14.6, 0.7, 0.25, 0xe53b3b);   // brand stripe
      box(ox, gy + CH + 0.1, oz + 4.9, 14.6, 0.7, 0.25, 0xe53b3b);
      for (let i = -1; i <= 1; i++) {
        const px = ox + i * 4.0;
        [oz - 1.4, oz + 1.4].forEach((pz) => {
          box(px, gy + 0.75, pz, 0.7, 1.5, 0.5, 0x2a2d33, { solid: true });
          box(px, gy + 1.6, pz, 0.85, 0.55, 0.62, 0xff7a1a);          // pump topper
        });
      }
      box(ox - 9.6, gy + 2.4, oz - 5.6, 0.4, 4.8, 0.4, 0x6a7079, { solid: true });  // price totem
      box(ox - 9.6, gy + 4.6, oz - 5.6, 2.2, 1.6, 0.3, 0xffd451);
      // glass-fronted shop
      const sw = 6, sd = 4.6, sh = 3.4, sxc = ox + 9.6, szc = oz;
      box(sxc, gy + sh / 2, szc + sd / 2, sw, sh, 0.3, 0xe7eaef, { solid: true, y0: gy, y1: gy + sh });
      box(sxc - sw / 2 + 0.15, gy + sh / 2, szc, 0.3, sh, sd, 0xe7eaef, { solid: true, y0: gy, y1: gy + sh });
      box(sxc + sw / 2 - 0.15, gy + sh / 2, szc, 0.3, sh, sd, 0xe7eaef, { solid: true, y0: gy, y1: gy + sh });
      box(sxc, gy + sh + 0.15, szc, sw, 0.3, sd, 0x9aa0a8, { solid: true, y0: gy + sh, y1: gy + sh + 0.3 });
      addGlass(root, sxc - 1.95, gy + sh * 0.55, szc - sd / 2, 1.9, sh * 0.78, 0.06, 0, 0, 0, null);
      addGlass(root, sxc + 1.95, gy + sh * 0.55, szc - sd / 2, 1.9, sh * 0.78, 0.06, 0, 0, 0, null);
      addGlass(root, sxc - sw / 2 + 0.2, gy + sh * 0.55, szc, 0.06, sh * 0.7, sd * 0.7, 0, 0, 0, null);
      addGlass(root, sxc + sw / 2 - 0.2, gy + sh * 0.55, szc, 0.06, sh * 0.7, sd * 0.7, 0, 0, 0, null);
      box(sxc, gy + sh + 0.55, szc - sd / 2 + 0.12, 3, 0.7, 0.2, 0x39c06a);   // STORE sign
    }

    // ---- CAR SHOWROOM (GTA dealership): no normal doors — the whole front is
    // a giant glass showroom with a central roll-up GARAGE-DOOR bay you can
    // drive a car straight into, flanked by full-height display glass, capped
    // by a massive clerestory window and an AUTO SALES sign. Cars on display
    // inside. The glass is shatterable. ----
    function makeShowroom(ox, oz) {
      const gy = groundHeightAt(ox, oz);
      const w = 18, d = 13, SH = 6.0, T = 0.35;
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.4, d - 0.4), new THREE.MeshLambertMaterial({ color: 0xd6dade, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
      floor.rotation.x = -Math.PI / 2; floor.position.set(ox, gy + 0.06, oz); floor.receiveShadow = true; root.add(floor);
      // shell: back + sides + roof (solid, height-gated)
      box(ox, gy + SH / 2, oz + d / 2 - T / 2, w, SH, T, 0x586a86, { solid: true, y0: gy, y1: gy + SH, los: true });
      box(ox - w / 2 + T / 2, gy + SH / 2, oz, T, SH, d, 0x586a86, { solid: true, y0: gy, y1: gy + SH, los: true });
      box(ox + w / 2 - T / 2, gy + SH / 2, oz, T, SH, d, 0x586a86, { solid: true, y0: gy, y1: gy + SH, los: true });
      box(ox, gy + SH + 0.2, oz, w, 0.4, d, 0x46566b, { solid: true, y0: gy + SH, y1: gy + SH + 0.4, los: true });
      addGlass(root, ox - w / 2 + 0.18, gy + SH * 0.52, oz + 1.2, 0.05, SH * 0.7, d * 0.5, 0, 0, 0, null);  // side display glass
      addGlass(root, ox + w / 2 - 0.18, gy + SH * 0.52, oz + 1.2, 0.05, SH * 0.7, d * 0.5, 0, 0, 0, null);
      // FRONT (-z): posts/mullions, header + rolled-up garage door over the bay
      const fz = oz - d / 2 + T / 2, BAYW = 5.2, HEADER = 4.2;
      box(ox - w / 2 + 0.35, gy + SH / 2, fz, 0.7, SH, T, 0x44506b, { solid: true, y0: gy, y1: gy + SH });
      box(ox + w / 2 - 0.35, gy + SH / 2, fz, 0.7, SH, T, 0x44506b, { solid: true, y0: gy, y1: gy + SH });
      box(ox - BAYW / 2, gy + SH / 2, fz, 0.4, SH, T, 0x44506b, { solid: true, y0: gy, y1: gy + SH });
      box(ox + BAYW / 2, gy + SH / 2, fz, 0.4, SH, T, 0x44506b, { solid: true, y0: gy, y1: gy + SH });
      box(ox, gy + HEADER + 0.3, fz, BAYW + 0.4, 0.6, T + 0.06, 0x39414f, { solid: true, y0: gy + HEADER, y1: gy + HEADER + 0.6 });
      box(ox, gy + HEADER - 0.45, fz + 0.05, BAYW - 0.5, 0.9, 0.16, 0x8a93a0);   // rolled-up door
      for (let s = 0; s < 4; s++) box(ox, gy + HEADER - 0.2 - s * 0.2, fz + 0.06, BAYW - 0.55, 0.05, 0.18, 0x6b7480);
      // full-height display glass flanking the bay
      const a = -w / 2 + 0.7, bb = -BAYW / 2 - 0.2, cxL = (a + bb) / 2, wL = bb - a;
      addGlass(root, ox + cxL, gy + SH * 0.52, fz, wL * 0.95, SH * 0.82, 0.06, 0, 0, 0, null);
      addGlass(root, ox - cxL, gy + SH * 0.52, fz, wL * 0.95, SH * 0.82, 0.06, 0, 0, 0, null);
      // MASSIVE clerestory glass above the bay header
      addGlass(root, ox, gy + (HEADER + SH) / 2 + 0.3, fz, BAYW + 0.2, SH - HEADER - 0.7, 0.06, 0, 0, 0, null);
      // display cars (for sale) + the sign
      makeCar(ox - 4.6, oz + 1.6, true, 0xe24b4b);
      makeCar(ox + 4.6, oz + 1.6, true, 0x3c6fd6);
      makeCar(ox, oz + 4.2, false, 0xf2c43d);
      box(ox, gy + SH + 1.1, fz + 0.2, 9.5, 1.5, 0.3, 0x12c258);   // AUTO SALES sign
      box(ox, gy + SH + 1.1, fz + 0.36, 8.6, 1.05, 0.1, 0xeafff2);
    }

    /* ---- WHICH FACADE GOES ON WHICH BUILDING -------------------------------
       The registry is the source of truth, not a list copied into this file:
       a grammar that declares minStoreys is a SKYLINE grammar and belongs on
       the downtown towers, everything else is low-rise and belongs in the
       town. Sorted by id so the island is the same on every boot, and the
       town/tower counts grow to cover the registry, so adding a facade file
       adds a building here rather than quietly going unseen.

       Read from the registry REGARDLESS of SURV_FACADES: the flag turns the
       ornament off, never the town plan. The island is meant to be learnable,
       so flipping a cosmetic flag must not move a building or change a
       tower's height — dressIslandFacade is the only thing the flag gates,
       and it checks the flag itself.                                       */
    const facadeIds = CBZ.facadeList
      ? CBZ.facadeList().map(function (f) { return f.id; }).sort() : [];
    const lowIds = facadeIds.filter(function (id) {
      const def = CBZ.facadeDef && CBZ.facadeDef(id); return def && !def.minStoreys;
    });
    const towerIds = facadeIds.filter(function (id) {
      const def = CBZ.facadeDef && CBZ.facadeDef(id); return def && def.minStoreys > 0;
    });

    // place the town in a loose ring, ONLY on flat ground (off the mountain
    // and hill skirts so terrain never pokes through a floor), no overlaps
    const placed = [];
    let attempts = 0, want = Math.max(18, lowIds.length);
    while (placed.length < want && attempts < 1400) {
      attempts++;
      const a = rng() * Math.PI * 2;
      const dist = 44 + rng() * (R - 60);
      const w = 6.5 + rng() * 4.5, d = 7 + rng() * 4.5;
      // Seat it on the kerb of the nearest street FIRST, then judge the ground
      // under where it will actually stand — testing the terrain at the
      // candidate and moving it afterwards is how a building ends up half in
      // a hillside.
      const seat = faceStreet(cx + Math.cos(a) * dist, cz + Math.sin(a) * dist, w, d);
      if (!seat) continue;
      const x = seat.x, z = seat.z;
      if (Math.hypot(x - cx, z - cz) > R - 34) continue;         // stay off the shore
      const ter = footprintTerrain(x, z, w, d);
      if (ter.max - ter.min > 0.45 || ter.max > 1.8) continue;   // must be flat-ish
      let clash = false;
      for (const p of placed) { if (Math.abs(p.x - x) < (p.w + w) / 2 + 4 && Math.abs(p.z - z) < (p.d + d) / 2 + 4) { clash = true; break; } }
      if (clash) continue;
      const storeys = 1 + ((rng() * 3) | 0);    // 1..3 (roof is the top level)
      const color = PALETTE[(rng() * PALETTE.length) | 0];
      const style = lowIds.length ? lowIds[placed.length % lowIds.length] : null;
      makeBuilding(x, z, w, d, storeys, color, ter.max, style);   // sit on the high point
      placed.push({ x, z, w, d });
    }

    // ---- city grid: streets, then a skyline of really tall towers ----
    // (GRID / KERB / onRoad / faceStreet are declared up by ROADW — the town
    // is placed against this grid long before the asphalt is drawn.)
    for (let k = -2; k <= 2; k++) {
      layRoadLine(cx + k * GRID, true);    // avenues (run along z)
      layRoadLine(cz + k * GRID, false);   // cross-streets (run along x)
    }
    {
      const BGU = THREE.BufferGeometryUtils;
      const roads = new THREE.Mesh(BGU.mergeBufferGeometries(roadParts, false), roadMat);
      roads.name = "survival-roads"; roads.receiveShadow = true; root.add(roads);
      const paint = new THREE.Mesh(BGU.mergeBufferGeometries(dashParts, false), lineMat);
      paint.name = "survival-road-paint";
      if (LAYERS) { paint.renderOrder = 1; paint.userData.roadPaint = true; }
      root.add(paint);
      roadParts.forEach((g) => g.dispose()); dashParts.forEach((g) => g.dispose());
    }

    // a downtown cluster of tall towers, plus a few outliers, on flat ground
    const TOWER_PALETTE = [0x5b6b82, 0x6f7e96, 0x8a98ac, 0x49566b, 0x7a6f8c, 0x5e7d86];
    let tAttempts = 0, tWant = Math.max(9, towerIds.length);
    let towers = 0;
    while (towers < tWant && tAttempts < 900) {
      tAttempts++;
      const a = rng() * Math.PI * 2;
      const dist = 40 + rng() * (R - 56);
      const w = 7 + rng() * 5, d = 7 + rng() * 5;
      const seat = faceStreet(cx + Math.cos(a) * dist, cz + Math.sin(a) * dist, w, d);
      if (!seat) continue;
      const x = seat.x, z = seat.z;
      if (Math.hypot(x - cx, z - cz) > R - 34) continue;
      const ter = footprintTerrain(x, z, w, d);
      if (ter.max - ter.min > 0.45 || ter.max > 1.6) continue;   // flat ground only
      let clash = false;
      for (const p of placed) { if (Math.abs(p.x - x) < (p.w + w) / 2 + 5 && Math.abs(p.z - z) < (p.d + d) / 2 + 5) { clash = true; break; } }
      if (clash) continue;
      /* HEIGHT FOLLOWS THE GRAMMAR. The island's own towers are ~18-38 m
         (5-11 floors), but a bundled tube or a braced tube is a grammar for
         forty storeys and declares minStoreys to say so — put one on a
         six-storey block and you get a smear, not a tower. So a tower wearing
         a skyline facade is built tall enough to carry it (its minStoreys
         plus a few floors), capped at 22 so the island stays quick to load
         and the lift ride stays short. Undressed, the original range. */
      const tStyle = towerIds.length ? towerIds[towers % towerIds.length] : null;
      const tDef = tStyle && CBZ.facadeDef ? CBZ.facadeDef(tStyle) : null;
      const h = tDef
        ? Math.min(22, tDef.minStoreys + 3) * FH
        : 18 + rng() * 20;                // ~18–38m (5–11 floors via the lift)
      makeTower(x, z, w, d, h, TOWER_PALETTE[(rng() * TOWER_PALETTE.length) | 0], tStyle);
      placed.push({ x, z, w, d });
      towers++;
    }

    // ---- landmarks: a couple of gas stations + a car showroom, on flat
    // ground clear of everything else (registered in `placed` so the street
    // cars + trees don't spawn on top of them) ----
    function placeFlat(halfW, halfD) {
      for (let a = 0; a < 90; a++) {
        const ang = rng() * Math.PI * 2, dist = 38 + rng() * (R - 56);
        const seat = faceStreet(cx + Math.cos(ang) * dist, cz + Math.sin(ang) * dist,
          halfW * 2, halfD * 2);
        if (!seat) continue;                       // a filling station in the road
        const x = seat.x, z = seat.z;
        const ter = footprintTerrain(x, z, halfW * 2, halfD * 2);
        if (ter.max - ter.min > 0.4 || ter.max > 1.3) continue;
        let clash = false;
        for (const p of placed) { if (Math.abs(p.x - x) < p.w / 2 + halfW + 5 && Math.abs(p.z - z) < p.d / 2 + halfD + 5) { clash = true; break; } }
        if (clash) continue;
        placed.push({ x, z, w: halfW * 2, d: halfD * 2 });
        return { x, z };
      }
      return null;
    }
    const gs1 = placeFlat(11, 9); if (gs1) makeGasStation(gs1.x, gs1.z);
    const gs2 = placeFlat(11, 9); if (gs2) makeGasStation(gs2.x, gs2.z);
    const dl1 = placeFlat(10, 8); if (dl1) makeShowroom(dl1.x, dl1.z);

    // park cars along the streets (offset to one lane), skipping building spots
    roadSegs.forEach((seg) => {
      const n = 1 + ((rng() * 2) | 0);
      for (let i = 0; i < n; i++) {
        const off = (rng() < 0.5 ? -1 : 1) * (ROADW * 0.24);
        const along = (rng() - 0.5) * seg.len * 0.8;
        const x = seg.x + (seg.vertical ? off : along);
        const z = seg.z + (seg.vertical ? along : off);
        let onBldg = false;
        for (const p of placed) { if (Math.abs(p.x - x) < p.w / 2 + 2 && Math.abs(p.z - z) < p.d / 2 + 2) { onBldg = true; break; } }
        if (onBldg) continue;
        makeCar(x, z, seg.vertical, CAR_COLORS[(rng() * CAR_COLORS.length) | 0]);
      }
    });

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
    function mergeGeos(parts) {
      const BGU = THREE.BufferGeometryUtils;
      const out = BGU && BGU.mergeBufferGeometries ? BGU.mergeBufferGeometries(parts, false) : null;
      return out || parts[0];
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
    /* A COCONUT PALM, in two meshes. The trunk is a leaning curve (slender,
       swelling at the foot, banded by the dark leaf-scar collars a palm trunk
       is read by — vertex colour, not extra meshes); the crown is 11 pinnate
       fronds — a spine that leaves the hub near level and hangs over its
       length, with a leaflet pair at every step — merged into ONE geometry.
       Geometry, not a texture: a frond's read is its comb of leaflets
       against the sky. */
    function palmTrunkGeo(v) {
      return geoOnce("pt" + v, function () {
        const SEG = 7, parts = [];
        const bend = [0.10, 0.16, 0.06][v];
        const at = function (t) { return new THREE.Vector3(bend * Math.pow(t, 1.8), t, 0); };
        const up = new THREE.Vector3(0, 1, 0);
        for (let i = 0; i < SEG; i++) {
          const a = at(i / SEG), b = at((i + 1) / SEG);
          const r0 = 0.20 - 0.07 * (i / SEG) + (i === 0 ? 0.06 : 0), r1 = 0.20 - 0.07 * ((i + 1) / SEG);
          const len = a.distanceTo(b);
          const c = new THREE.CylinderGeometry(r1, r0, len * 1.02, 8, 1, true);
          const uv = c.attributes.uv;
          for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * 1.5, uv.getY(k) * 0.35 + i * 0.35);
          const dir = b.clone().sub(a).normalize();
          c.applyMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(up, dir)));
          c.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
          parts.push(c);
        }
        const g = mergeGeos(parts);
        rampColor(g, 0.62);
        const p = g.attributes.position, col = g.attributes.color;
        for (let i = 0; i < p.count; i++) {
          const band = 0.5 + 0.5 * Math.cos(p.getY(i) * Math.PI * 2 * 9);
          const k = 1 - 0.3 * Math.pow(band, 6);
          col.setXYZ(i, col.getX(i) * k, col.getY(i) * k * 0.98, col.getZ(i) * k * 0.95);
        }
        g.userData.top = at(1);
        g.computeBoundingSphere();
        return g;
      });
    }
    function palmCrownGeo(v) {
      return geoOnce("pc" + v, function () {
        const pos = [], col = [];
        const N = 11, SEG = 17;
        function tri(a, b, c, ca, cb, cc) {
          pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
          col.push(ca, ca, ca * 0.85, cb, cb, cb * 0.85, cc, cc, cc * 0.85);
        }
        for (let f = 0; f < N; f++) {
          const yaw = (f / N) * Math.PI * 2 + (h01t(f, v, 0x9a1) - 0.5) * 0.35;
          const len = 2.6 + h01t(f, v, 0x9a2) * 0.9;
          const lift = -0.2 + h01t(f, v, 0x9a3) * 0.7;              // start pitch, above/below level
          const hang = 1.2 + h01t(f, v, 0x9a4) * 0.7;               // how hard it droops
          const dx = Math.cos(yaw), dz = Math.sin(yaw);
          const sx = -dz, sz = dx;                                   // leaflet side direction
          // the spine: integrate the pitch so it is a real arc, not a chord
          const pts = [new THREE.Vector3(0, 0, 0)];
          const STEPS = 18;
          for (let s = 1; s <= STEPS; s++) {
            const u = (s - 0.5) / STEPS, ang = lift - hang * u * u, dl = len / STEPS;
            const q = pts[s - 1];
            pts.push(new THREE.Vector3(q.x + dx * Math.cos(ang) * dl, q.y + Math.sin(ang) * dl, q.z + dz * Math.cos(ang) * dl));
          }
          const spine = function (u) {
            const f2 = u * STEPS, i0 = Math.min(STEPS - 1, Math.floor(f2));
            return pts[i0].clone().lerp(pts[i0 + 1], f2 - i0);
          };
          for (let i = 0; i < SEG; i++) {
            const u0 = 0.06 + (i / SEG) * 0.94, u1 = 0.06 + ((i + 1) / SEG) * 0.94;
            // a leaflet is a narrow blade: its base spans only the first half
            // of the step, so the comb has gaps between blades
            const a = spine(u0), b = spine(u0 + (u1 - u0) * 0.5);
            const w = 0.8 * Math.sin(Math.PI * Math.min(1, 0.12 + u0 * 0.95)) + 0.12;   // leaflet length
            const shade = 0.6 + 0.4 * u0;
            for (let sgn = -1; sgn <= 1; sgn += 2) {
              const tip = new THREE.Vector3(
                (a.x + b.x) / 2 + sx * sgn * w + dx * w * 0.55,
                (a.y + b.y) / 2 - w * 0.6,
                (a.z + b.z) / 2 + sz * sgn * w + dz * w * 0.55);
              tri(a, b, tip, shade * 0.85, shade * 0.95, shade * 1.1);
            }
          }
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
        g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
        // lighting normals point OUT of the crown, up-biased, so both faces
        // of a leaflet shade as part of the canopy mass, not as a flipped card
        const nrm = new Float32Array(pos.length);
        for (let i = 0; i < pos.length; i += 3) {
          const x = pos[i], y = pos[i + 1] + 0.8, z = pos[i + 2];
          const l = Math.hypot(x, y, z) || 1;
          let nx = x / l * 0.55, ny = y / l * 0.55 + 0.45, nz = z / l * 0.55;
          const m = Math.hypot(nx, ny, nz) || 1;
          nrm[i] = nx / m; nrm[i + 1] = ny / m; nrm[i + 2] = nz / m;
        }
        g.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
        g.computeBoundingSphere();
        return g;
      });
    }
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
    for (let i = 0; i < 70; i++) {
      const a = rng() * Math.PI * 2;
      const dist = 16 + rng() * (R - 18);
      const x = cx + Math.cos(a) * dist, z = cz + Math.sin(a) * dist;
      let onBuilding = false;
      for (const p of placed) { if (Math.abs(p.x - x) < p.w / 2 + 2 && Math.abs(p.z - z) < p.d / 2 + 2) { onBuilding = true; break; } }
      if (onBuilding) continue;
      const gy = groundHeightAt(x, z);
      const th = 2 + rng() * 1.5;
      // the two draws the box crown's width/depth used, still drawn so the
      // stream (and everything placed after the trees) is unchanged. Crown
      // size is NOT a mesh scale any more: wildfire resets foliage.scale to
      // 1 between matches, so size variety lives in the cached geometries.
      rng(); rng();
      // nothing grows on the live cone above its turf line (a tree halfway up
      // bare scoria is the "tree looks dumb" photo); the draws above are
      // already spent, so the stream for everything after is unchanged
      if (Math.hypot(x - VOL.x, z - VOL.z) < VOL.r * 0.82) continue;
      // palms own the coast and a share of the town; broadleaf the rest
      const palm = dist > R - 34 || h01t(x, z, 0x7e9) < 0.3;
      const rec = palm
        ? plantPalm(x, z, gy, th * 1.9 + 1.2)
        : plantBroadleaf(x, z, gy, th);
      flammable.push({ x, z, trunk: rec.trunk, foliage: rec.foliage, trunkCol: rec.trunkCol,
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
          flammable.push({ x, z, trunk: rec.trunk, foliage: rec.foliage, trunkCol: rec.trunkCol,
            leafHex: rec.leafHex, barkHex: rec.barkHex, burning: 0, burnt: false });
        }
      }
    })();

    if (CBZ.bootStep) CBZ.bootStep("island:rocks");
    // a faceted boulder of the box's size: a dodecahedron whose corners are
    // pushed about by a hash of the corner (so shared corners move together
    // and the solid stays closed), flat-shaded by construction
    const rockGeos = {};
    function rockGeo(v, s) {
      const key = v + "|" + s.toFixed(2);
      if (rockGeos[key]) return rockGeos[key];
      const g = new THREE.DodecahedronGeometry(0.62, 0);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        const k = 0.78 + 0.44 * h01g(x * 7 + v * 3, z * 7 + y * 5, 0xb0d);
        p.setXYZ(i, x * k * s, y * k * s, z * k * s);
      }
      g.computeVertexNormals();
      g.computeBoundingSphere();
      rockGeos[key] = g;
      return g;
    }
    // ---- rocks / cover ----
    // Boulders, not silver dice: earthy grey-brown, randomly rotated and
    // squashed so they read as rough rock — and kept OFF the hill/mountain
    // slopes (a perfect cube stuck on a cone looked broken). Flat ground only.
    for (let i = 0; i < 26; i++) {
      const a = rng() * Math.PI * 2, dist = 12 + rng() * (R - 14);
      const x = cx + Math.cos(a) * dist, z = cz + Math.sin(a) * dist;
      const gy = groundHeightAt(x, z);
      if (gy > 0.8) continue;                 // skip hillsides — no floating cubes on the mountain
      const s = 1 + rng() * 2.2;
      const m = box(x, gy + s * 0.4, z, s, s, s, 0x6e675e, { solid: true });
      m.geometry.dispose();
      m.geometry = rockGeo((h01g(x, z, 0xb0c) * 4) | 0, s);
      m.material.color.setRGB(0.105, 0.098, 0.088);
      m.rotation.set((rng() - 0.5) * 0.5, rng() * Math.PI, (rng() - 0.5) * 0.5);
      m.scale.set(0.8 + rng() * 0.4, 0.55 + rng() * 0.35, 0.8 + rng() * 0.4);
      m.position.y = gy + s * m.scale.y * 0.5 - 0.06;   // rest on the ground, slightly embedded
    }

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
      hills, fragile, flammable, cars, elevators, glass: allGlass, groundHeightAt,
      randomPoint(minD, maxD) {
        const a = rng() * Math.PI * 2;
        const d = (minD || 0) + rng() * ((maxD || R * 0.82) - (minD || 0));
        return { x: cx + Math.cos(a) * d, z: cz + Math.sin(a) * d };
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
        if (CBZ.collapse && CBZ.collapse.reset) CBZ.collapse.reset();
        for (const b of fragile) {
          // clear the shared structural ledger (systems/disasters.js) so a new
          // match starts on undamaged towers, not on last match's spalling
          b._dmg = 0; b._lean = 0; b._tsuHit = null;
          if (b.fallen) {
            b.group.visible = true;
            b.group.position.set(b.ox, b.gy, b.oz);
            b.group.rotation.set(0, 0, 0);
            for (const c of b.colliders) if (CBZ.colliders.indexOf(c) === -1) CBZ.colliders.push(c);
            for (const p of b.platforms) if (CBZ.platforms.indexOf(p) === -1) CBZ.platforms.push(p);
            b.fallen = false;
          }
        }
        for (const t of flammable) {
          t.burning = 0; t.burnt = false;
          if (t.foliage && t.foliage.material) t.foliage.material.color.setHex(t.leafHex != null ? t.leafHex : 0x3f9a4f);
          if (t.trunk && t.trunk.material) t.trunk.material.color.setHex(t.barkHex != null ? t.barkHex : 0x6b4a2a);
        }
        // park flung/wrecked cars back where they started
        for (const car of cars) {
          if (car.flung) {
            car.group.position.set(car.x, car.oy, car.z);
            car.group.rotation.set(0, car.rotY, 0);
            if (CBZ.colliders.indexOf(car.collider) === -1) CBZ.colliders.push(car.collider);
            car.flung = false;
          }
          // its windows were shattered off the real pane (disasters.js flingCar)
          if (car._pane) { car._pane.visible = true; car._pane = null; }
        }
        // re-glaze every shattered window for the new match
        for (const gp of allGlass) { if (gp.shattered) { gp.shattered = false; if (gp.show) gp.show(); else gp.mesh.visible = true; } }
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

    /* ---- ELEVATOR DRIVE -------------------------------------------------
       A lift that serves EVERY floor, and the top of the crown. It used to
       auto-cycle ground -> roof -> ground at 4.5 m/s and never stop between,
       so the only floors it served were the two ends (and the top end was
       inside the crown, see THE TOP OF THE BUILDING, REACHED). Now:

         * standing on a landing next to the shaft CALLS it to your floor;
         * standing still on the car sends it on, express, to the far end in
           the direction it is going (up to the top of the crown by default,
           because that is where you go in a tsunami);
         * WALKING on the car while it moves stops it at the next floor it can
           brake for, and it waits while you walk off. No button, no text:
           you step towards the floor you want and the lift lets you out.
         * left alone for a while it goes home to the ground floor, so the
           next person through the door finds it waiting.

       Collapsed towers park their lift. PRIORITY 9.4: a platform must move
       BEFORE the character resolves against it (platforms_moving.js ticks at
       9.5, updatePlayer at 10). */
    const LIFT_V = 5.5, LIFT_A = 3.2;
    function liftRiding(e, P) {
      if (!P || !P.pos) return false;
      if (e.rig && CBZ.movingPlatformRiding) return CBZ.movingPlatformRiding() === e.rig;
      const top = e.gy + e.y + e.slabTop;
      return Math.abs(P.pos.x - e.ox) < e.s && Math.abs(P.pos.z - e.oz) < e.s && Math.abs(P.pos.y - top) < 0.45;
    }
    // the stop whose landing the player is standing on, next to this shaft
    function liftCall(e, P) {
      if (!P || !P.pos || P.dead) return -1;
      const dx = Math.abs(P.pos.x - e.ox), dz = Math.abs(P.pos.z - e.oz);
      if (dx > e.s + 2.2 || dz > e.s + 2.2) return -1;
      if (dx < e.s && dz < e.s) return -1;            // on the car (or in the shaft)
      for (let i = 0; i < e.stops.length; i++) {
        if (Math.abs(P.pos.y - (e.gy + e.stops[i] + e.slabTop)) < 0.5) return i;
      }
      return -1;
    }
    CBZ.onUpdate(9.4, function (dt) {
      if (!CBZ.islandModeOn(CBZ.game.mode)) return;
      if (!(dt > 0)) return;
      dt = Math.min(dt, 0.1);
      const P = CBZ.player;
      for (let i = 0; i < elevators.length; i++) {
        const e = elevators[i];
        if (e.rig) e.rig.setActive(!e.b.fallen);
        if (e.b.fallen) { if (e.mesh.visible) e.mesh.visible = false; continue; }
        const riding = liftRiding(e, P);
        const walking = riding && P.speed > 0.3;
        const S = e.stops, last = S.length - 1;
        if (e.target < 0) {
          // parked at stop e.at
          if (walking) e.dwell = Math.max(e.dwell, 0.8);   // hold it while they step off
          if (e.dwell > 0) { e.dwell -= dt; }
          else if (riding) {
            if (e.at >= last) e.dir = -1; else if (e.at <= 0) e.dir = 1;
            e.target = e.dir > 0 ? last : 0;
            e.idle = 0;
          } else {
            const call = liftCall(e, P);
            if (call >= 0 && call !== e.at) { e.target = call; e.idle = 0; }
            else if (e.at !== 0) { e.idle += dt; if (e.idle > 9) { e.target = 0; e.idle = 0; } }
          }
        }
        if (e.target >= 0) {
          const goal = S[e.target], dir = goal > e.y ? 1 : -1;
          e.dir = dir;
          // walking aboard: stop at the next floor it can still brake for
          if (walking && !e._stopReq) {
            const brake = e.v * e.v / (2 * LIFT_A) + 0.05;
            let best = -1;
            for (let k = 0; k <= last; k++) {
              const ahead = (S[k] - e.y) * dir;
              if (ahead >= brake && (best < 0 || ahead < (S[best] - e.y) * dir)) best = k;
            }
            if (best >= 0 && (S[best] - e.y) * dir < (goal - e.y) * dir) e.target = best;
            e._stopReq = true;
          }
          const g2 = S[e.target], rem = (g2 - e.y) * dir;
          // trapezoid: accelerate, cruise, brake to land exactly on the stop
          const vStop = Math.sqrt(Math.max(0, 2 * LIFT_A * rem));
          e.v = Math.min(LIFT_V, e.v + LIFT_A * dt, vStop);
          let step = e.v * dt;
          if (step >= rem || rem < 0.004) {
            e.y = g2; e.v = 0; e.at = e.target; e.target = -1; e._stopReq = false;
            e.dwell = riding ? 1.4 : 2.2;
          } else e.y += dir * step;
        }
        e.mesh.position.y = e.y;
        // the rig reads carMesh.position.y itself at 9.5; only the legacy
        // fallback record still needs poking
        if (e.plat) e.plat.top = e.gy + e.y + e.slabTop;
      }
    });

    root.visible = false; // hidden until survival mode activates
    return arena;
  };
})();
