/* ============================================================
   warlord/props.js — THE OBJECT LIBRARY. Everything on this island that is
   a THING you can see and is not terrain and is not a person.

   WHY ONE FILE AND NOT TWO. The campaign layer flies over a depot at 400 m
   and the battle layer fights beside the same depot at 4 m. If each layer
   owned its own depot they would drift within a week: the campaign's would
   grow a crane, the battle's would grow cover, and the player would ride to
   a landmark and arrive somewhere else. So there is ONE depot, built once,
   with a near half and a far half, and both layers ask this file for it.

   WHAT IT PUBLISHES

     W.props.outpost(kind, opts)   depot | camp | well | market — the four
                                   kinds outpost.js already declares, as places
     W.props.banner(colour, opts)  one hero flag, cloth that moves
     W.props.bannerField(opts)     sixty of them in three draw calls
     W.props.wreck(kind, opts)     truck | plane | tank | caravan | bones
     W.props.cover(kind, opts)     boulder | slab | bank | palm — every kind a
                                   battlefield can actually ask for
     W.props.coverField(list)      a whole battlefield's cover, batched
     W.props.house(opts)           a mud-brick dwelling — city/villagekit.js's
                                   hut, repainted for this page's colour space
     W.props.stall(opts)           a counter, a shade over it, and the goods
     W.props.bivouac(opts)         YOUR camp: fires, bedrolls, picket, rifles
     W.props.palm/fire/tent/...    the pieces, exposed, because a second copy
                                   of a palm is exactly what this file exists
                                   to stop
     W.props.place(g, x,y,z, yaw)  put it in the world and register its cover
     W.props.lodTick(camPos)       near/far swap, driven off CBZ.onUpdate

   EVERY FACTORY RETURNS A THREE.Group AT THE ORIGIN, +Y up, facing +Z, with
   `userData.colliders` = the boxes that are real cover, in LOCAL metres. The
   caller places it. Nothing here touches W.state, and nothing here adds
   itself to the scene.

   AN OUTPOST ALSO CARRIES `userData.folk` — where the PEOPLE stand, in the
   same local metres. This file does not draw a man and must not: campaign.js
   already owns forty-eight pooled studio.cast rigs and every rule about
   dressing, seating and animating them. See THE FOLK, below.

   ---------------------------------------------------------------------
   WHAT I REUSED, AND WHAT I HAD TO MAKE, AND WHY

   REUSED, straight:
     · CBZ.cmat / CBZ.boxGeom  (world/materials.js, on the page through the
       `look` pack that `people` pulls in) — the shared material and geometry
       caches. Every colour in this file goes through cmat, so a hundred
       sandbags share one material instance.
     · CBZ.batchStaticUnder (core/batch.js, in this page's NEED list) — a
       depot leaves this file as ~13 draw calls instead of ~70 because the
       inert boxes get merged before the group is returned. Measured below.
     · CBZ.studio.model("truck"|"tank"|"cargo"|"heli") — the repo's SHIPPED
       military models. A burnt-out truck is that truck, tilted, sunk and
       charred. Redrawing a truck out of boxes when city/island_military.js
       already ships one would be the single dumbest thing in this file.
     · CBZ.weaponAppearance.<id> — the REAL rifles, for the stacked-arms pile
       in a camp. Three actual AKs leaning together, not three brown boxes.
     · (houses used to be city/villagekit.js's solid huts; they are this
       file's own now, hollow and furnished: see HOUSES below.)

   HAD TO MAKE, and why the existing one did not fit:
     · The outposts, the banners, the tents, the shade cloth, the well head,
       the wrecking/charring, the sandbag walls. Nothing like these exists.
     · The fractured boulder. I went to reuse world/rockscliffs.js's
       CBZ.makeRock and it is DEAD ON r128 — it reads `.index` off an
       IcosahedronGeometry that r128 does not index, bails to a stub path,
       and hands back a normal-less icosahedron that renders black. Proven
       in the browser and written up at scrapeRock() below. Same algorithm,
       plus the vertex weld that makes it run.
     · A palm. world/vegetation.js's kit is temperate (trunk/crown/spire) and
       city/beach.js DOES have a good leaning palm — but it is written inline
       inside cityBuildBeach(), reads that function's local rng and pier
       position, and is not callable. Extracting it means editing beach.js,
       which is not mine to edit. So the palm here copies its TECHNIQUE
       (a trunk, a crown hub sat at the true trunk top, and a ring of
       drooping fronds whose inner ends run THROUGH the hub — beach.js's own
       TREES_V2 bug note is about getting that seat wrong) and none of its
       code. Eleven fronds rather than six, and each is a curved tapered
       strip rather than a flat plank; see frondGeo().
     · Sandbags/crates/barricades. world/crates.js and world/clutter.js draw
       these, but both are LOAD-TIME PASSES that stamp the prison yard at
       fixed coordinates off CBZ.WORLD/CBZ.DIM. They are not factories, they
       are not in any studio pack, and razorwire.js/towers.js would throw at
       load on this page (`CBZ.DIM.YH` of a prison that does not exist here).

   LAZY, and why: the military models are in NO studio pack, so this page
   does not have them. boot() asks the studio for the pack and nothing here
   builds until it is asked. A wreck asked for before the models land is
   EMPTY and fills itself when they arrive, rather than being a box that
   later disagrees with the same wreck built one second later. Shape
   stability beats being on screen a frame earlier; a prop that changes shape
   when a chunk reloads is the exact defect the determinism rule exists to
   stop.

   AND TWO ENGINE BUGS THIS FILE HAD TO ROUTE AROUND, both verified in a
   headless browser and neither of them in a file I own:
     1. CBZ.makeRock (world/rockscliffs.js) is dead on r128 — details at
        scrapeRock() below. Every rock it has ever returned was a smooth,
        normal-less icosahedron that renders black.
     2. games/warlord.html DOUBLE-LIGHTS the scene. CBZ.micro.boot() builds
        a hemi+sun pair unless told `lights:false`, and the page then calls
        micro.lights() again with its own numbers — which ADDS a second
        pair. Measured on the live page: HemisphereLight 0.62 + 0.62 and
        DirectionalLight 1.05 + 1.12, so the whole game is lit at about
        twice the intended level and ACES tone mapping turns that into a
        set of white paper models. The fix is one word in warlord.html's
        micro.boot call (`lights: false`) or moving the light options into
        it. Worth about 1.8x on every lit surface. This file does NOT fix
        it — one file owning another file's sun is a third bug — it counts
        the lights, warns once, and reports them in audit().lights. It is
        the smaller half of why everything photographs white; see the
        palette block for the larger half.

   DETERMINISM: every variation comes off W.rngFrom(seed) or W.hash01. There
   is no Math.random in this file.

   MATERIALS: one Lambert per palette key, each carrying its SURFACE (see
   SURFACES); settle() folds a compound into one draw per surface kind.
   Counted in W.props.audit().

   EVENTS: none. This file answers questions; it does not have opinions.

   FLAGS: ?propkit=old   every factory returns the flat primitive the rest of
                         the game drew before this file existed (desert.js's
                         icosahedron rock, battle.js's rotated cover box, a
                         bare pole for a banner). This is the honest A/B: it
                         is not "props off", it is the game one commit ago.
          ?props=1       the gallery — every prop in a row on a flat pad, so
                         this file is never blocked on another agent's.
          ?wrecks=box    do not lazy-load the military pack; box wrecks.
          ?proprock=box  skip the scrape; plain icosahedron boulders.
============================================================ */
(function () {
  "use strict";
  const G = (typeof window !== "undefined" ? window : globalThis);
  const CBZ = (G.CBZ = G.CBZ || {});
  const W = (CBZ.warlord = CBZ.warlord || {});
  if (!W.state) { console.error("[warlord] props.js loaded without core.js"); return; }
  const THREE = G.THREE;

  const Q = new URLSearchParams(G.location ? G.location.search : "");
  const OLD = Q.get("propkit") === "old";
  const NO_MIL = Q.get("wrecks") === "box";
  const NO_ROCK = Q.get("proprock") === "box";
  const TAU = Math.PI * 2;

  const P = {};                       // the published API; W.module("props", P) at the end

  /* ============================================================ MATERIALS
     ONE TABLE. Everything in this file paints from it, so the whole library
     costs 23 material objects however many depots you build. cmat() is
     world/materials.js's shared cache — the same call world/crates.js and
     city/beach.js make — so if the city is ever on the page beside us we
     share ITS instances too rather than minting near-duplicates.

     The desert palette is deliberately narrow and low-chroma. Everything is
     pulled toward the sand except the three container paints and the
     banners, which are the only things allowed to shout — and they shout
     because that is their JOB, they are how you recognise a place and a
     faction from a kilometre away.

     AND IT IS AUTHORED IN LINEAR, WHICH MEANS MUCH DARKER THAN IT LOOKS.
     This took three passes and two wrong theories, so all of it is written
     down rather than only the answer.

     The renderer runs outputEncoding = sRGBEncoding with ACES tone mapping.
     r128 has ColorManagement off, so a hex you type is stored as a LINEAR
     value and only encoded on the way out: linear 0.48 (0x7a) leaves as 0.72
     on screen (0xb8) before a single light touches it. Multiply by the
     scene's hemi + sun and it is white.

     WRONG THEORY 1 — "shave 35% off". Did it, photographed it, still white.
     WRONG THEORY 2 — "it is the page's double lighting" (which is real, see
     the header, and worth about 1.8x on its own). Removed the duplicate
     pair for one gallery run, photographed it, and the picture barely moved.
     The encoding was always the bigger half, and the gallery now
     photographs the lighting the game actually ships so the pictures are of
     the game rather than of a corrected version of it.

     THE ANSWER, ARRIVED AT WITH A CALCULATOR AND THEN A PHOTOGRAPH: work
     backwards from the pixel. screen = sRGB(ACES(colour x light)). For a
     prop to land at a mid 0.5 on screen it needs ACES output 0.22, which
     needs a lit value of ~0.15, which at this scene's ~2.3 of effective sun
     means a stored colour of ~0.065 — hex 0x11. Every value below is that
     arithmetic, and they look like mud in an editor because linear
     authoring for a bright sun looks like mud in an editor.

     WHICH MAKES desert.js's SAND A PROBLEM WORTH NAMING, not copying. Its
     C_SAND runs 0.34-0.52 linear; through the same chain that arrives at
     0xE8-0xF1, so the island's entire tonal range is four percent of the
     screen's, at the top. An earlier pass here matched those numbers exactly
     "so a boulder is the same brown in both files" and the boulders came out
     white. Matching a white is matching nothing. These are the same colours
     scaled by 0.40 — the same multiplier desert.js's own palette wants — so
     the two stay in step the moment either is corrected. */
  const COL = {
    sand:       0x312716,   // the gallery pad
    sandDark:   0x231a0e,
    canvas:     0x2b261a,   // tent cloth, sun-bleached
    canvasDark: 0x1c180f,
    tarp:       0x13110d,
    wood:       0x120d06,
    woodDark:   0x0a0805,
    metal:      0x131618,
    metalDark:  0x090a0c,
    rust:       0x180c06,
    char:       0x060605,   // what a burnt thing is
    rock:       0x1c1813,
    rockDark:   0x110e0a,
    palmTrunk:  0x141006,
    frond:      0x0b1807,
    bone:       0x302d25,
    rope:       0x1e1810,
    hide:       0x120c06,
    water:      0x07181c,
    boxRed:     0x210d06,
    boxBlue:    0x061016,
    boxGreen:   0x0a120b,
    ember:      0xff7a2a,
    // the houses and the things people actually own. Same linear-and-dark
    // arithmetic as everything above: a hut wall sits a shade warmer and a
    // touch darker than the sand it was dug out of.
    earth:      0x2a2013,   // a packed-earth floor inside
    post:       0x100b05,   // poles, rafters, lintels
    adobe:      0x33241a,
    adobe2:     0x2d2118,
    adobe3:     0x3a2b1d,
    plaster:    0x3f3627,   // a lime-washed front
    mudbrick:   0x2e2117,
    stone:      0x221e18,
    stoneDark:  0x17140f,
    thatch:     0x2a2112,
    thatch2:    0x221a0e,
    corr:       0x15171a,   // galvanised sheet
    corrRust:   0x1c0f07,
    burlap:     0x2a2214,
    clay:       0x2c160b,   // a water jar
    dates:      0x230b03,
    leather:    0x170d06,
    lamp:       0x2a1a08,
    gabion:     0x1f1b15,
    scrub:      0x0b1807,   // grass and reeds round the water: the frond green, as ground
  };
  /* ============================================================ SURFACES
     EVERY MATERIAL IN THIS FILE IS MADE OF SOMETHING.

     What was here: one flat Lambert colour per key, through the engine's
     shared cmat cache. A mud wall, a tent, a crate and a container were each
     a single RGB value from one metre away and from one kilometre away, and
     the owner's word for that whole look was "slop". The prison's brick
     (world/prisonlook.js) is the bar he set: real texture scale, joints,
     weathering, grime at the foot of a wall.

     THE SAME TECHNIQUE, per material KIND: a chained onBeforeCompile that
     writes analytic surface detail into diffuseColor right after the colour
     is resolved. No textures, no UVs (so it runs on every box, every
     instanced tent and on the merged output of settle() alike), no new
     draw calls, no lights. It is a pure albedo patch, which is exactly what
     a per-vertex Lambert can use: the joints, seams and ribs read because
     they are darker, the way a real joint is in shadow.

     COORDINATES ARE OBJECT SPACE, not world. A merged compound's object
     space is the compound's own frame (settle() bakes into it), so a house
     that is quarter-turned inside its compound has its bricks square to its
     walls however the compound is turned on the island. World space would
     have run every course at whatever angle the outpost landed at. The face
     picks its projection by its dominant normal axis; `skH` (object y) is
     height above the compound floor, which is what grime, splash and bleach
     are measured from. Detail fades out with view distance so nothing
     shimmers at campaign range.

     KINDS: adobe (mud plaster, falling away to the mud brick under it),
     mudbrick (a ruin: brick with a few plaster scabs), stone (coursed rubble
     masonry; flagstones on top), plank (sawn boards with seams and butt
     joints), timber (rough poles and beams, grain and checks), canvas
     (panels, seams, stains, a sun-bleached top and a dirty hem), burlap
     (sacks and sandbags, dust on top), metal (steel, rust bloom and
     streaks), corrugated (container and roof sheet ribs, rust runs), rust,
     rock (strata, pitting, sand dust on the up faces), earth (packed floors
     and banks), thatch (lapped courses of straw, greyed by weather), palm
     (leaf-base rings), leather (hide, rope, bone), char, frond (pinnate
     leaflets cut out of the blade; needs the skUv attribute). */
  const SKIN_KIND = {
    adobe: 1, stone: 2, plank: 3, timber: 4, canvas: 5, burlap: 6, metal: 7,
    corrugated: 8, rock: 9, earth: 10, thatch: 11, palm: 12, rust: 13,
    leather: 14, char: 15, frond: 16, mudbrick: 17, gabion: 18,
  };
  const SK_VERT_PARS =
    "varying vec3 skP;\nvarying vec3 skN;\nvarying float skD;\n" +
    "#if SK_KIND == 16\nattribute vec2 skUv;\nvarying vec2 vSkUv;\n#endif\n";
  const SK_VERT_MAIN =
    "{\n" +
    "  vec4 skp4 = vec4( transformed, 1.0 );\n" +
    "  vec3 skn3 = objectNormal;\n" +
    "  #ifdef USE_INSTANCING\n  skp4 = instanceMatrix * skp4;\n  skn3 = mat3( instanceMatrix ) * skn3;\n  #endif\n" +
    "  skP = skp4.xyz;\n  skN = skn3;\n  skD = -mvPosition.z;\n" +
    "  #if SK_KIND == 16\n  vSkUv = skUv;\n  #endif\n" +
    "}\n";
  const SK_FRAG_PARS =
    "varying vec3 skP;\nvarying vec3 skN;\nvarying float skD;\n" +
    "#if SK_KIND == 16\nvarying vec2 vSkUv;\n#endif\n" +
    // a sin-free hash: stable at the tens-of-metres coordinates a compound has
    "float skHash( vec2 p ) { p = mod( p, 289.0 ); vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );\n" +
    "  p3 += dot( p3, p3.yzx + 33.33 ); return fract( ( p3.x + p3.y ) * p3.z ); }\n" +
    "float skNoise( vec2 p ) { vec2 i = floor( p ), f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );\n" +
    "  return mix( mix( skHash( i ), skHash( i + vec2( 1.0, 0.0 ) ), f.x ),\n" +
    "              mix( skHash( i + vec2( 0.0, 1.0 ) ), skHash( i + vec2( 1.0, 1.0 ) ), f.x ), f.y ); }\n" +
    "float skFbm( vec2 p ) { return skNoise( p ) * 0.5 + skNoise( p * 2.03 + 17.0 ) * 0.3 + skNoise( p * 4.11 + 31.0 ) * 0.2; }\n";
  const SK_FRAG_MAIN = [
    "{",
    "  vec3 skn = normalize( skN ); vec3 ska = abs( skn );",
    "  float skUp = step( ska.x, ska.y ) * step( ska.z, ska.y );",
    "  vec2 uv = skUp > 0.5 ? skP.xz : ( ska.x > ska.z ? skP.zy : skP.xy );",
    "  float skH = skP.y;",
    "  float fine = 1.0 - smoothstep( 8.0, 36.0, skD );",
    "  float mid = 1.0 - smoothstep( 25.0, 150.0, skD );",
    "  vec3 c = diffuseColor.rgb;",
    // ---- ADOBE / MUDBRICK: plaster over coursed mud brick
    "  #if SK_KIND == 1 || SK_KIND == 17",
    "  float am1 = skFbm( uv * 0.6 ), am2 = skNoise( uv * 3.1 + 5.0 );",
    "  vec3 plaster = c * ( 0.9 + 0.2 * am1 ) * ( 0.96 + 0.08 * am2 * fine );",
    "  float arow = floor( uv.y / 0.12 );",
    "  float abx = uv.x / 0.38 + 0.5 * mod( arow, 2.0 );",
    "  vec2 abf = vec2( fract( abx ) * 0.38, fract( uv.y / 0.12 ) * 0.12 );",
    "  float abe = min( min( abf.x, 0.38 - abf.x ), min( abf.y, 0.12 - abf.y ) );",
    "  float ajoint = ( 1.0 - smoothstep( 0.006, 0.017, abe ) ) * mid;",
    "  float abid = skHash( vec2( floor( abx ), arow ) );",
    "  vec3 brick = c * vec3( 0.92, 0.8, 0.68 ) * ( 0.76 + 0.36 * abid ) * ( 1.0 - ajoint * 0.55 ) * ( 0.94 + 0.12 * am2 );",
    "  #if SK_KIND == 1",
    "  float aloss = skFbm( uv * vec2( 0.55, 0.8 ) + 11.0 ) + ( 1.0 - smoothstep( 0.0, 0.8, skH ) ) * 0.2 - 0.64;",
    "  #else",
    "  float aloss = skFbm( uv * vec2( 0.55, 0.8 ) + 11.0 ) - 0.28;",
    "  #endif",
    "  aloss = skUp > 0.5 ? -1.0 : aloss;",
    "  float abare = smoothstep( 0.0, 0.025, aloss );",
    "  float alip = smoothstep( -0.05, 0.0, aloss ) * ( 1.0 - abare );",
    "  c = mix( plaster, brick, abare ) * ( 1.0 - alip * 0.32 * mid );",
    "  float afoot = ( 1.0 - skUp ) * ( 1.0 - smoothstep( 0.0, 0.5, skH ) );",
    "  c *= 1.0 - afoot * ( 0.22 + 0.12 * skNoise( uv * vec2( 4.0, 1.0 ) ) );",
    "  c *= 1.0 - ( 1.0 - skUp ) * 0.1 * smoothstep( 0.5, 0.85, skNoise( vec2( uv.x * 2.5, uv.y * 0.22 ) ) );",
    "  #endif",
    // ---- STONE: coursed rubble on the sides, flagstones on top
    "  #if SK_KIND == 2",
    "  if ( skUp > 0.5 ) {",
    "    vec2 sq = uv + vec2( 0.0, mod( floor( uv.x / 0.5 ), 2.0 ) * 0.25 );",
    "    vec2 sf = fract( sq / 0.5 ) * 0.5;",
    "    float se = min( min( sf.x, 0.5 - sf.x ), min( sf.y, 0.5 - sf.y ) );",
    "    c *= ( 0.8 + 0.35 * skHash( floor( sq / 0.5 ) ) ) * ( 1.0 - ( 1.0 - smoothstep( 0.01, 0.03, se ) ) * mid * 0.55 );",
    "  } else {",
    "    float srow = floor( uv.y / 0.24 );",
    "    float sw = 0.34 + 0.3 * skHash( vec2( srow, 3.0 ) );",
    "    float ssx = uv.x / sw + skHash( vec2( srow, 7.0 ) );",
    "    vec2 sf = vec2( fract( ssx ) * sw, fract( uv.y / 0.24 ) * 0.24 );",
    "    float se = min( min( sf.x, sw - sf.x ), min( sf.y, 0.24 - sf.y ) ) + ( skNoise( uv * 9.0 ) - 0.5 ) * 0.02 * fine;",
    "    float sj = ( 1.0 - smoothstep( 0.012, 0.03, se ) ) * mid;",
    "    vec2 sid = vec2( floor( ssx ), srow );",
    "    vec3 stint = mix( vec3( 1.0 ), vec3( 1.08, 0.98, 0.86 ), skHash( sid + 9.0 ) );",
    "    c *= stint * ( 0.78 + 0.36 * skHash( sid ) ) * ( 1.0 - sj * 0.6 ) * ( 0.9 + 0.2 * skNoise( uv * 4.0 ) );",
    "    c *= 1.0 - ( 1.0 - smoothstep( 0.0, 0.4, skH ) ) * 0.15;",
    "  }",
    "  c *= 0.92 + 0.16 * skFbm( uv * 0.8 );",
    "  #endif",
    // ---- PLANK: sawn boards
    "  #if SK_KIND == 3",
    "  float prow = floor( uv.y / 0.15 ), pfy = fract( uv.y / 0.15 ) * 0.15;",
    "  float pseam = ( 1.0 - smoothstep( 0.004, 0.012, min( pfy, 0.15 - pfy ) ) ) * mid;",
    "  float plen = 1.8 + 1.4 * skHash( vec2( prow, 1.0 ) );",
    "  float ppx = uv.x / plen + skHash( vec2( prow, 2.0 ) );",
    "  float pfx = fract( ppx ) * plen;",
    "  float pbutt = ( 1.0 - smoothstep( 0.004, 0.012, min( pfx, plen - pfx ) ) ) * mid;",
    "  float pid = skHash( vec2( floor( ppx ), prow ) );",
    "  float pgr = skNoise( vec2( uv.x * 1.3, uv.y * 38.0 + pid * 10.0 ) ) * 0.6 + skNoise( vec2( uv.x * 5.0, uv.y * 90.0 ) ) * 0.4;",
    "  vec3 pwea = mix( vec3( 1.0 ), vec3( 0.86, 0.88, 0.93 ), smoothstep( 0.4, 0.8, skFbm( uv * 0.7 + pid ) ) );",
    "  c *= pwea * ( 0.8 + 0.34 * pid ) * ( 0.86 + 0.26 * pgr * mid + 0.13 * ( 1.0 - mid ) ) * ( 1.0 - 0.55 * max( pseam, pbutt ) );",
    "  #endif",
    // ---- TIMBER: poles and beams
    "  #if SK_KIND == 4",
    "  float tg1 = skNoise( vec2( uv.x * 26.0, uv.y * 1.4 ) ), tg2 = skNoise( vec2( uv.x * 70.0, uv.y * 3.0 ) );",
    "  float tck = smoothstep( 0.93, 0.99, skNoise( vec2( uv.x * 14.0, uv.y * 0.8 ) ) ) * fine;",
    "  c *= ( 0.84 + 0.22 * tg1 * mid + 0.08 * tg2 * fine ) * ( 1.0 - tck * 0.5 ) * ( 0.9 + 0.2 * skFbm( uv * 0.9 ) );",
    "  #endif",
    // ---- CANVAS: panels, seams, stains, bleach and a dirty hem
    "  #if SK_KIND == 5",
    "  float cfx = fract( uv.x / 0.92 ) * 0.92;",
    "  float cseam = ( 1.0 - smoothstep( 0.008, 0.022, min( cfx, 0.92 - cfx ) ) ) * mid;",
    "  float cfib = skNoise( vec2( uv.x * 60.0, uv.y * 6.0 ) );",
    "  c *= ( 0.86 + 0.24 * skFbm( uv * 0.45 + 3.0 ) ) * ( 1.0 - cseam * 0.28 ) * ( 0.95 + 0.1 * cfib * fine );",
    "  c *= mix( 0.84, 1.08, smoothstep( 0.3, 2.0, skH ) );",
    "  float cdirt = ( 1.0 - smoothstep( 0.0, 0.35, skH ) ) * ( 1.0 - skUp );",
    "  c = mix( c, c * vec3( 0.8, 0.72, 0.62 ), cdirt * 0.6 );",
    "  #endif",
    // ---- BURLAP
    "  #if SK_KIND == 6",
    "  c *= ( 0.84 + 0.26 * skFbm( uv * 1.3 + 2.0 ) ) * ( 0.93 + 0.14 * skNoise( uv * 40.0 ) * fine );",
    "  c = mix( c, c * vec3( 1.25, 1.15, 0.95 ), skUp * 0.5 * smoothstep( 0.3, 0.7, skFbm( uv * 2.0 ) ) );",
    "  #endif",
    // ---- METAL
    "  #if SK_KIND == 7",
    "  c *= 0.85 + 0.3 * skFbm( uv * 1.4 );",
    "  c = mix( c, vec3( 0.085, 0.035, 0.012 ), smoothstep( 0.58, 0.78, skFbm( uv * 2.2 + 13.0 ) ) * 0.75 );",
    "  c = mix( c, vec3( 0.07, 0.03, 0.012 ), smoothstep( 0.55, 0.9, skNoise( vec2( uv.x * 6.0, uv.y * 0.35 ) ) ) * ( 1.0 - skUp ) * 0.35 );",
    "  #endif",
    // ---- CORRUGATED
    "  #if SK_KIND == 8",
    "  float krib = 0.5 + 0.5 * cos( uv.x * 44.88 );",
    "  c *= mix( 0.97, 0.8 + 0.34 * krib, mid ) * ( 0.9 + 0.2 * skFbm( uv * 0.6 ) );",
    "  float krust = smoothstep( 0.55, 0.8, skFbm( uv * 1.7 + 4.0 ) );",
    "  float kstreak = smoothstep( 0.5, 0.9, skNoise( vec2( uv.x * 5.0, uv.y * 0.4 ) ) ) * ( 1.0 - skUp );",
    "  c = mix( c, vec3( 0.075, 0.03, 0.01 ), clamp( krust * 0.7 + kstreak * 0.4, 0.0, 0.85 ) );",
    "  #endif",
    // ---- RUST
    "  #if SK_KIND == 13",
    "  c *= ( 0.7 + 0.5 * skFbm( uv * 2.0 ) ) * ( 1.0 - 0.35 * smoothstep( 0.75, 0.9, skNoise( uv * 14.0 ) ) * fine );",
    "  #endif",
    // ---- ROCK
    "  #if SK_KIND == 9",
    "  float rst = skNoise( vec2( uv.x * 0.5, uv.y * 5.0 + skNoise( uv * 0.7 ) * 3.0 ) );",
    "  float rpit = smoothstep( 0.7, 0.9, skNoise( uv * 11.0 ) ) * fine;",
    "  c *= ( 0.75 + 0.3 * rst ) * ( 0.85 + 0.3 * skFbm( uv * 1.1 ) ) * ( 1.0 - rpit * 0.3 );",
    "  c = mix( c, vec3( 0.19, 0.15, 0.09 ), smoothstep( 0.45, 0.85, skn.y ) * 0.45 );",
    "  c = mix( c, c * vec3( 0.55, 0.6, 0.5 ), smoothstep( 0.72, 0.85, skFbm( uv * 3.0 + 21.0 ) ) * 0.5 );",
    "  #endif",
    // ---- GABION: packed rubble behind a welded wire mesh
    "  #if SK_KIND == 18",
    "  vec2 gcell = floor( uv / 0.16 ); vec2 gf = fract( uv / 0.16 );",
    "  c *= ( 0.6 + 0.55 * skHash( gcell ) ) * ( 0.85 + 0.3 * skNoise( uv * 9.0 ) );",
    "  float gstone = smoothstep( 0.0, 0.18, min( min( gf.x, 1.0 - gf.x ), min( gf.y, 1.0 - gf.y ) ) );",
    "  c *= 0.55 + 0.45 * gstone;",
    "  vec2 gw = abs( fract( uv / 0.1 + 0.5 ) - 0.5 );",
    "  float gwire = ( 1.0 - smoothstep( 0.03, 0.09, min( gw.x, gw.y ) ) ) * fine;",
    "  c = mix( c, vec3( 0.05, 0.05, 0.052 ), gwire * 0.75 );",
    "  #endif",
    // ---- EARTH: packed floors, banks, spoil
    "  #if SK_KIND == 10",
    "  float em = skFbm( uv * 0.5 ) * 0.6 + skFbm( uv * 2.3 ) * 0.4;",
    "  float epeb = smoothstep( 0.8, 0.95, skNoise( uv * 22.0 ) ) * fine;",
    "  c *= ( 0.82 + 0.3 * em ) * ( 1.0 - 0.12 * smoothstep( 0.62, 0.8, skNoise( uv * vec2( 0.3, 2.0 ) ) ) ) * ( 1.0 + epeb * 0.25 );",
    "  #endif",
    // ---- THATCH: lapped courses of straw
    "  #if SK_KIND == 11",
    "  float hlap = smoothstep( 0.0, 0.3, fract( uv.y / 0.22 ) );",
    "  float hstraw = skNoise( vec2( uv.x * 55.0, uv.y * 2.5 ) ) * 0.6 + skNoise( vec2( uv.x * 140.0, uv.y * 5.0 ) ) * 0.4;",
    "  c *= mix( 1.0, 0.7 + 0.36 * hlap, mid ) * ( 0.8 + 0.35 * hstraw * mid + 0.17 * ( 1.0 - mid ) );",
    "  c = mix( c, vec3( dot( c, vec3( 0.333 ) ) ) * vec3( 0.95, 0.96, 1.0 ), smoothstep( 0.35, 0.75, skFbm( uv * 0.6 + 8.0 ) ) * 0.45 );",
    "  #endif",
    // ---- PALM TRUNK: leaf-base rings
    "  #if SK_KIND == 12",
    "  float lr = fract( skH / 0.16 );",
    "  float lscar = smoothstep( 0.0, 0.2, lr ) * ( 1.0 - smoothstep( 0.7, 1.0, lr ) );",
    "  c *= ( 0.68 + 0.36 * lscar * mid + 0.17 * ( 1.0 - mid ) ) * ( 0.85 + 0.3 * skNoise( vec2( uv.x * 20.0, skH * 3.0 ) ) );",
    "  #endif",
    // ---- LEATHER / ROPE / BONE
    "  #if SK_KIND == 14",
    "  c *= ( 0.82 + 0.3 * skFbm( uv * 3.0 ) ) * ( 0.95 + 0.1 * skNoise( uv * 30.0 ) * fine );",
    "  #endif",
    // ---- CHAR: soot, ash, a little surviving rust
    "  #if SK_KIND == 15",
    "  c *= 0.7 + 0.6 * skFbm( uv * 1.5 );",
    "  c = mix( c, vec3( 0.055, 0.052, 0.048 ), smoothstep( 0.6, 0.8, skFbm( uv * 2.4 + 5.0 ) ) * 0.7 );",
    "  c = mix( c, vec3( 0.05, 0.02, 0.008 ), smoothstep( 0.7, 0.85, skFbm( uv * 1.1 + 40.0 ) ) * 0.6 );",
    "  #endif",
    // ---- FROND: pinnate leaflets cut out of the blade
    "  #if SK_KIND == 16",
    "  float fside = abs( vSkUv.x - 0.5 ) * 2.0;",
    "  float fk = vSkUv.y * 34.0 + fside * 1.7;",
    "  if ( fside > 0.14 && fract( fk ) > 0.56 && vSkUv.y > 0.04 ) discard;",
    "  c *= 0.82 + 0.34 * skHash( vec2( floor( fk ), vSkUv.x > 0.5 ? 1.0 : 0.0 ) );",
    "  c = mix( c, vec3( 0.09, 0.07, 0.03 ), smoothstep( 0.72, 1.0, vSkUv.y ) * 0.55 );",
    "  #endif",
    "  diffuseColor.rgb = c;",
    "}",
  ].join("\n");

  /* skin(material, kind) — patch a material in place, once. Chains any
     onBeforeCompile already on it, and keys the program on the kind so two
     kinds never share a compiled shader. Returns the material. Published as
     W.props.skin so desert.js (its oasis palms) and anything else on this
     page can dress its own materials with the same surfaces. */
  function skin(mat, kind) {
    const k = SKIN_KIND[kind];
    if (!mat || !k || (mat.userData && mat.userData.skin)) return mat;
    mat.userData = mat.userData || {};
    mat.userData.skin = kind;
    const prev = mat.onBeforeCompile;
    const prevKey = mat.customProgramCacheKey;
    mat.onBeforeCompile = function (sh, r) {
      if (prev) prev.call(this, sh, r);
      const def = "#define SK_KIND " + k + "\n";
      sh.vertexShader = def + sh.vertexShader
        .replace("#include <common>", "#include <common>\n" + SK_VERT_PARS)
        .replace("#include <project_vertex>", "#include <project_vertex>\n" + SK_VERT_MAIN);
      sh.fragmentShader = def + sh.fragmentShader
        .replace("#include <common>", "#include <common>\n" + SK_FRAG_PARS)
        .replace("#include <color_fragment>", "#include <color_fragment>\n" + SK_FRAG_MAIN);
    };
    mat.customProgramCacheKey = function () {
      return "wlskin" + k + (prevKey ? "|" + prevKey.call(this) : "");
    };
    mat.needsUpdate = true;
    return mat;
  }
  P.skin = skin;

  /* WHICH SURFACE EACH PALETTE KEY IS. A key with no entry stays a plain
     colour on purpose: water, ember, lamp glass and cloth that moves. */
  const KEY_SKIN = {
    sand: "earth", sandDark: "earth", earth: "earth",
    canvas: "canvas", canvasDark: "canvas", tarp: "canvas",
    wood: "plank", woodDark: "timber", post: "timber",
    metal: "metal", metalDark: "metal", rust: "rust", char: "char",
    rock: "rock", rockDark: "rock", palmTrunk: "palm", frond: "frond",
    bone: "leather", rope: "leather", hide: "leather", leather: "leather",
    boxRed: "corrugated", boxBlue: "corrugated", boxGreen: "corrugated",
    corr: "corrugated", corrRust: "corrugated",
    adobe: "adobe", adobe2: "adobe", adobe3: "adobe", plaster: "adobe", mudbrick: "mudbrick",
    stone: "stone", stoneDark: "stone", thatch: "thatch", thatch2: "thatch",
    burlap: "burlap", clay: "earth", gabion: "gabion", scrub: "earth",
  };
  const _mats = {};
  function M(key) {
    let m = _mats[key];
    if (m) return m;
    const c = COL[key];
    if (key === "ember") {
      // a fire has to be visible in daylight, and a Lambert lit by the sun is
      // not. Emissive at full is the cheapest honest answer; no light is
      // added — sixty campfires with real point lights is how a phone dies.
      m = new THREE.MeshLambertMaterial({ color: c, emissive: 0xff5a10 });
    } else if (key === "lamp") {
      /* A LANTERN IS A WARM PANE, NOT A SUN. The market's lamps were
         full-emissive orange boxes that shone at noon; a hurricane lamp by
         day is a smoky glass chimney with a small flame in it. Emissive at a
         third, so it still reads as lit after dark. */
      m = new THREE.MeshLambertMaterial({ color: c, emissive: 0x8a4a12 });
    } else {
      // OWN INSTANCES, not cmat's. cmat hands one material per colour to the
      // whole engine, and skin() writes a shader patch onto the material it
      // is given — so patching a cmat instance would dress anything else on
      // the page that happened to ask for the same hex.
      m = new THREE.MeshLambertMaterial({ color: c });
      skin(m, KEY_SKIN[key]);
    }
    m._shared = true;
    _mats[key] = m;
    return m;
  }
  /* CLOTH IS TWO-SIDED, and so is anything with an open side you can see
     into (a well drum, a thatch cone from inside the hut). Own table, same
     skins. */
  const _twoSide = {};
  function MD(key) {
    let m = _twoSide[key];
    if (m) return m;
    m = new THREE.MeshLambertMaterial({ color: COL[key], side: THREE.DoubleSide });
    skin(m, KEY_SKIN[key]);
    m._shared = true;
    _twoSide[key] = m;
    return m;
  }
  /* WHITE, FOR ANYTHING THAT TINTS PER INSTANCE. r128's InstancedMesh
     multiplies instanceColor INTO the material's diffuse, so an InstancedMesh
     whose material is already canvasDark and whose setColorAt writes
     canvasDark renders canvasDark SQUARED. Anything that calls setColorAt
     takes its base from here and carries the real colour in the instance.
     One white per (kind, side), each with that kind's surface. */
  const _whites = {};
  function MW(twoSided, kind) {
    const k = (kind || "") + (twoSided ? "|2" : "|1");
    let m = _whites[k];
    if (m) return m;
    m = new THREE.MeshLambertMaterial({ color: 0xffffff, side: twoSided ? THREE.DoubleSide : THREE.FrontSide });
    if (kind) skin(m, kind);
    m._shared = true;
    _whites[k] = m;
    return m;
  }
  // smoke/haze wants its own transparent material and must never be batched
  let _smokeMat = null, _puffTex = null;
  /* one soft round puff, alpha falling off like a gaussian, with a little
     lumpy break-up so overlapping puffs do not read as circles */
  function puffTex() {
    if (_puffTex || typeof document === "undefined") return _puffTex;
    const S = 64, c = document.createElement("canvas");
    c.width = c.height = S;
    const g = c.getContext("2d"), img = g.createImageData(S, S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const dx = (x + 0.5) / S * 2 - 1, dy = (y + 0.5) / S * 2 - 1;
      const r = Math.sqrt(dx * dx + dy * dy);
      const lump = 0.85 + 0.15 * Math.sin(dx * 7.1 + Math.sin(dy * 5.3) * 2) * Math.cos(dy * 6.7);
      const a = Math.max(0, Math.exp(-r * r * 3.2) - 0.04) * lump;
      const o = (y * S + x) * 4;
      img.data[o] = img.data[o + 1] = img.data[o + 2] = 255;
      img.data[o + 3] = Math.round(Math.min(1, a) * 255);
    }
    g.putImageData(img, 0, 0);
    _puffTex = new THREE.CanvasTexture(c);
    return _puffTex;
  }
  function smokeMat() {
    if (!_smokeMat) {
      _smokeMat = new THREE.MeshBasicMaterial({
        color: 0x9c9280, transparent: true, opacity: 1, depthWrite: false,
        side: THREE.DoubleSide, vertexColors: true, map: puffTex(),
      });
    }
    return _smokeMat;
  }

  /* ============================================================ GEOMETRY
     boxGeom is materials.js's shared cache. Falling back to a local one
     rather than `new BoxGeometry` per call matters here: a camp is ninety
     boxes and a coverField is four hundred. */
  const _geo = new Map();
  function BG(w, h, d) {
    if (CBZ.boxGeom) return CBZ.boxGeom(w, h, d);
    const k = "b" + w + "," + h + "," + d;
    let g = _geo.get(k);
    if (!g) { g = new THREE.BoxGeometry(w, h, d); g._shared = true; _geo.set(k, g); }
    return g;
  }
  function CG(rt, rb, h, seg) {
    const k = "c" + rt + "," + rb + "," + h + "," + seg;
    let g = _geo.get(k);
    if (!g) { g = new THREE.CylinderGeometry(rt, rb, h, seg || 8); g._shared = true; _geo.set(k, g); }
    return g;
  }
  // place a box. Returns the mesh so a caller can tilt it.
  function box(parent, w, h, d, mat, x, y, z, ry, rx, rz) {
    const m = new THREE.Mesh(BG(w, h, d), mat);
    m.position.set(x || 0, y || 0, z || 0);
    if (ry || rx || rz) m.rotation.set(rx || 0, ry || 0, rz || 0);
    m.castShadow = true; m.receiveShadow = true;
    parent.add(m);
    return m;
  }
  function cyl(parent, rt, rb, h, seg, mat, x, y, z, rx, ry, rz) {
    const m = new THREE.Mesh(CG(rt, rb, h, seg), mat);
    m.position.set(x || 0, y || 0, z || 0);
    if (rx || ry || rz) m.rotation.set(rx || 0, ry || 0, rz || 0);
    m.castShadow = true; m.receiveShadow = true;
    parent.add(m);
    return m;
  }
  /* a round member between two points — a log, a pole, a rafter, a rope.
     p0/p1 are [x,y,z] in the parent's frame. */
  const _ry = new THREE.Vector3(0, 1, 0), _rd = new THREE.Vector3();
  function rod(parent, r0, r1, p0, p1, mat, seg) {
    _rd.set(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
    const len = _rd.length();
    const m = new THREE.Mesh(CG(r1, r0, Math.round(len * 100) / 100, seg || 6), mat);
    m.position.set((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2);
    m.quaternion.setFromUnitVectors(_ry, _rd.normalize());
    m.castShadow = true; m.receiveShadow = true;
    parent.add(m);
    return m;
  }
  let _flameGeo = null, _flameMat = null;
  function flameGeo() {
    if (!_flameGeo) {
      // two crossed quads in ONE geometry: one draw call per fire
      const a = new THREE.PlaneGeometry(0.9, 1.35), b = new THREE.PlaneGeometry(0.9, 1.35);
      a.translate(0, 0.62, 0); b.translate(0, 0.62, 0); b.rotateY(Math.PI / 2);
      const pa = a.toNonIndexed(), pb = b.toNonIndexed();
      _flameGeo = new THREE.BufferGeometry();
      const cat = function (n, k) {
        const A = pa.attributes[n].array, B = pb.attributes[n].array, o = new Float32Array(A.length + B.length);
        o.set(A, 0); o.set(B, A.length);
        _flameGeo.setAttribute(n, new THREE.BufferAttribute(o, k));
      };
      cat("position", 3); cat("normal", 3); cat("uv", 2);
    }
    return _flameGeo;
  }
  function flameMat() {
    if (_flameMat || typeof document === "undefined") return _flameMat;
    const W2 = 64, H2 = 128, c = document.createElement("canvas");
    c.width = W2; c.height = H2;
    const g = c.getContext("2d"), img = g.createImageData(W2, H2);
    for (let y = 0; y < H2; y++) for (let x = 0; x < W2; x++) {
      const u = (x + 0.5) / W2 * 2 - 1, v = 1 - (y + 0.5) / H2;          // v: 0 base, 1 tip
      const lick = 0.14 * Math.sin(v * 9.0 + u * 3.0) * v;
      const half = (0.62 - v * 0.55) * (1 + 0.25 * Math.sin(v * 13 + 1.7));  // the flame narrows upward
      const r2 = Math.abs(u + lick) / Math.max(0.02, half);
      let a = Math.max(0, 1 - r2) * Math.pow(Math.max(0, 1 - v), 0.8);
      a = Math.min(1, a * 1.7);
      const hot = Math.max(0, 1 - r2 * 1.6) * Math.max(0, 1 - v * 1.4);   // the white-yellow core low down
      const o = (y * W2 + x) * 4;
      img.data[o] = 255;
      img.data[o + 1] = Math.round(90 + 150 * hot);
      img.data[o + 2] = Math.round(20 + 120 * hot * hot);
      img.data[o + 3] = Math.round(a * 255);
    }
    g.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(c);
    tex.encoding = THREE.sRGBEncoding;
    _flameMat = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, fog: true,
    });
    return _flameMat;
  }
  // a raw triangle soup -> flat-shaded BufferGeometry. Used for the tent
  // prism and the sagging cloth, which are the two shapes a box cannot be.
  function soup(tris) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(tris), 3));
    g.computeVertexNormals();
    return g;
  }

  /* ============================================================ SHAPES
     The handful of shapes a box cannot be, each built ONCE and shared:
     a sack/sandbag, a crate with its battens, a clay jar, a bucket, a date
     bunch. bake() welds parts (each with its own matrix and an optional
     vertex tint) into one geometry, so a crate is one mesh with darker
     battens rather than thirteen meshes. */
  const _shape = new Map();
  const _bm = new THREE.Matrix4(), _bn = new THREE.Matrix3(), _bv = new THREE.Vector3();
  function bake(parts) {
    let n = 0, tinted = false;
    const gs = parts.map(function (p) {
      const g = p.g.index ? p.g.toNonIndexed() : p.g;
      if (!g.attributes.normal) g.computeVertexNormals();
      n += g.attributes.position.count;
      if (p.c != null) tinted = true;
      return g;
    });
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
    const col = tinted ? new Float32Array(n * 3) : null;
    let o = 0;
    for (let i = 0; i < parts.length; i++) {
      const g = gs[i], p = parts[i];
      if (p.m) _bm.copy(p.m); else _bm.identity();
      _bn.getNormalMatrix(_bm);
      const P2 = g.attributes.position, N2 = g.attributes.normal;
      for (let j = 0; j < P2.count; j++) {
        const q = (o + j) * 3;
        _bv.fromBufferAttribute(P2, j).applyMatrix4(_bm);
        pos[q] = _bv.x; pos[q + 1] = _bv.y; pos[q + 2] = _bv.z;
        _bv.fromBufferAttribute(N2, j).applyMatrix3(_bn).normalize();
        nor[q] = _bv.x; nor[q + 1] = _bv.y; nor[q + 2] = _bv.z;
        if (col) { const k = p.c == null ? 1 : p.c; col[q] = col[q + 1] = col[q + 2] = k; }
      }
      o += P2.count;
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    out.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
    if (col) out.setAttribute("color", new THREE.BufferAttribute(col, 3));
    out.computeBoundingSphere();
    out._shared = true;
    return out;
  }
  function TM(x, y, z, rx, ry, rz, sx, sy, sz) {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx || 0, ry || 0, rz || 0));
    return m.compose(new THREE.Vector3(x || 0, y || 0, z || 0), q,
      new THREE.Vector3(sx == null ? 1 : sx, sy == null ? (sx == null ? 1 : sx) : sy, sz == null ? (sx == null ? 1 : sx) : sz));
  }
  /* A SACK. A superellipsoid: a sphere pushed out toward its bounding box
     (exponent 0.35 in plan, 0.6 in height), then squashed to the sack. A
     sandbag is a fat pillow with round shoulders and a flat bed, which is
     the shape a 60 x 26 x 42 cm BOX was standing in for. */
  function pillowGeo(w, h, d) {
    const key = "pil" + w + "," + h + "," + d;
    let g = _shape.get(key);
    if (g) return g;
    g = new THREE.SphereGeometry(1, 10, 6);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const sx = Math.sign(x) * Math.pow(Math.abs(x), 0.35);
      const sy = Math.sign(y) * Math.pow(Math.abs(y), 0.6);
      const sz = Math.sign(z) * Math.pow(Math.abs(z), 0.35);
      p.setXYZ(i, sx * w / 2, (sy < 0 ? sy * 0.8 : sy) * h / 2, sz * d / 2);
    }
    g.computeVertexNormals();
    g._shared = true;
    _shape.set(key, g);
    return g;
  }
  /* A CRATE: a slightly inset body with its battens proud of it — the four
     vertical corners, a rim top and bottom, and a diagonal brace on the two
     big faces. Battens are tinted darker in the vertex colour so one plank
     material draws both. Unit-ish: w x h x d in metres. */
  function crateGeo(w, h, d) {
    const key = "crate" + w + "," + h + "," + d;
    let g = _shape.get(key);
    if (g) return g;
    const b = 0.07, parts = [];
    parts.push({ g: new THREE.BoxGeometry(w - 0.03, h - 0.03, d - 0.03), m: TM(0, h / 2, 0), c: 1 });
    for (let sx = -1; sx <= 1; sx += 2) for (let sz = -1; sz <= 1; sz += 2) {
      parts.push({ g: new THREE.BoxGeometry(b, h, b), m: TM(sx * (w / 2 - b / 2 + 0.01), h / 2, sz * (d / 2 - b / 2 + 0.01)), c: 0.6 });
    }
    for (let y = 0; y < 2; y++) {
      const yy = y ? h - b / 2 : b / 2;
      parts.push({ g: new THREE.BoxGeometry(w + 0.02, b, b), m: TM(0, yy, d / 2 - b / 2 + 0.01), c: 0.6 });
      parts.push({ g: new THREE.BoxGeometry(w + 0.02, b, b), m: TM(0, yy, -d / 2 + b / 2 - 0.01), c: 0.6 });
      parts.push({ g: new THREE.BoxGeometry(b, b, d + 0.02), m: TM(w / 2 - b / 2 + 0.01, yy, 0), c: 0.6 });
      parts.push({ g: new THREE.BoxGeometry(b, b, d + 0.02), m: TM(-w / 2 + b / 2 - 0.01, yy, 0), c: 0.6 });
    }
    const diag = Math.hypot(w - 2 * b, h - 2 * b), ang = Math.atan2(h - 2 * b, w - 2 * b);
    for (let s = -1; s <= 1; s += 2) {
      parts.push({ g: new THREE.BoxGeometry(diag, b * 0.9, 0.03), m: TM(0, h / 2, s * (d / 2 + 0.005), 0, 0, s * ang), c: 0.66 });
    }
    g = bake(parts);
    _shape.set(key, g);
    return g;
  }
  function lathe(key, prof, seg) {
    let g = _shape.get(key);
    if (g) return g;
    g = new THREE.LatheGeometry(prof.map(function (p) { return new THREE.Vector2(p[0], p[1]); }), seg || 12);
    g.computeVertexNormals();
    g._shared = true;
    _shape.set(key, g);
    return g;
  }
  // a water jar: round belly, narrow neck, a lip
  function jarGeo() {
    return lathe("jar", [[0.001, 0], [0.12, 0.01], [0.21, 0.12], [0.24, 0.26], [0.2, 0.42], [0.1, 0.52],
      [0.075, 0.6], [0.095, 0.63], [0.085, 0.645], [0.06, 0.62]], 12);
  }
  // a wooden well bucket: tapered, open-topped, rim
  function bucketGeo() {
    return lathe("bucket", [[0.001, 0], [0.16, 0], [0.2, 0.34], [0.215, 0.35], [0.2, 0.36], [0.185, 0.35], [0.15, 0.03]], 10);
  }
  // a long bone lying along X: a shaft and a knuckle at each end
  function boneGeo() {
    let g = _shape.get("bone");
    if (g) return g;
    const shaft = new THREE.CylinderGeometry(0.035, 0.04, 0.8, 6);
    const knob = new THREE.SphereGeometry(0.065, 6, 4);
    g = bake([
      { g: shaft, m: TM(0, 0, 0, 0, 0, Math.PI / 2) },
      { g: knob, m: TM(0.42, 0, 0.02, 0, 0, 0, 1, 0.8, 1.3) },
      { g: knob, m: TM(-0.42, 0, -0.01, 0, 0, 0, 1, 0.8, 1.2) },
    ]);
    _shape.set("bone", g);
    return g;
  }
  // a date bunch: fruit clustered on a hanging cone of strands
  function dateGeo() {
    let g = _shape.get("dates");
    if (g) return g;
    const s = new THREE.SphereGeometry(0.05, 4, 3), parts = [];
    for (let i = 0; i < 16; i++) {
      const t = i / 16, a = i * 2.39996;
      const rr = 0.17 * (1 - t * 0.75);
      parts.push({ g: s, m: TM(Math.cos(a) * rr, -t * 0.42, Math.sin(a) * rr, 0, 0, 0, 1, 1.35, 1) });
    }
    g = bake(parts);
    _shape.set("dates", g);
    return g;
  }

  /* ============================================================ DICE
     One stream per prop, seeded by the caller. A depot built at the same
     seed is the same depot on every machine and after every reload — which
     is the whole point, because outpost.js hands out positions from a hash
     and campaign.js will rebuild these when a chunk comes back. */
  function stream(seed) {
    const r = W.rngFrom((seed == null ? 1 : seed | 0) || 1);
    return {
      f: r,
      range: function (a, b) { return a + r() * (b - a); },
      pick: function (arr) { return arr[Math.floor(r() * arr.length) % arr.length]; },
      chance: function (p) { return r() < p; },
    };
  }

  /* ============================================================ LAZY DEPS
     Two engine assets this game genuinely wants and this page does not load:
     the fractured boulder and the military models. Both are pulled here, at
     boot, and both have an explicit "not yet" state so nothing builds a
     provisional shape it would later contradict. */
  /* ---- THE ROCK, AND WHY THIS FILE HAS ITS OWN SCRAPE ----------------
     I went to reuse world/rockscliffs.js's CBZ.makeRock and it does not
     work on r128. Verified in the browser, not guessed:

         new THREE.IcosahedronGeometry(1, 1).index  ->  null

     r128's PolyhedronGeometry emits a NON-indexed BufferGeometry. makeRock
     reads `src.index` to build its vertex adjacency, finds nothing, takes
     the branch its own comment calls a "headless/stub-safe bail", and
     returns `out` carrying ONLY a position attribute — no scrape, and no
     normals. So every caller of makeRock in this repo gets a smooth
     icosahedron, and any Lambert material drawn with it renders BLACK,
     because a Lambert with no normal attribute has nothing to light. That
     is not a warlord bug and I cannot fix it from here: rockscliffs.js is
     not my file. The one-line fix over there is to weld the source before
     reading its index (BufferGeometryUtils.mergeVertices, or the same
     position-key weld this file does below) — worth doing, because the
     "fractured boulder" that file is entirely about has never once run.

     So the scrape lives here, and it is the SAME algorithm rockscliffs.js
     describes — flood-fill a hop-neighbourhood from a seed vertex and
     project those vertices onto a plane through the seed, inward only, so
     each pass carves a flat chipped facet. What it adds is the weld that
     makes adjacency exist at all. ~45 lines against shipping black rocks. */
  function weld(geo) {
    const pos = geo.attributes.position;
    const key = new Map();
    const verts = [];        // Vector3
    const index = [];
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const k = Math.round(x * 1e4) + "," + Math.round(y * 1e4) + "," + Math.round(z * 1e4);
      let at = key.get(k);
      if (at === undefined) { at = verts.length; key.set(k, at); verts.push(new THREE.Vector3(x, y, z)); }
      index.push(at);
    }
    return { verts: verts, index: index };
  }
  function adjacency(index, n) {
    const adj = [];
    for (let i = 0; i < n; i++) adj.push([]);
    const link = function (a, b) { if (adj[a].indexOf(b) < 0) adj[a].push(b); };
    for (let t = 0; t < index.length; t += 3) {
      const a = index[t], b = index[t + 1], c = index[t + 2];
      link(a, b); link(b, a); link(b, c); link(c, b); link(c, a); link(a, c);
    }
    return adj;
  }
  function scrapeRock(radius, seed, detail, tune) {
    const r = W.rngFrom(seed || 1);
    const src = new THREE.IcosahedronGeometry(radius, detail == null ? 1 : detail);
    const w = weld(src);
    const verts = w.verts, index = w.index;
    const adj = adjacency(index, verts.length);
    const SCRAPES = ((tune && tune.scrapes) || 11) + Math.floor(r() * 6);
    const HOPS = ((tune && tune.hops) || 1) + Math.floor(r() * 2);
    const dMin = radius * ((tune && tune.depthMin != null) ? tune.depthMin : 0.05);
    // 0.45, not 0.32. At 0.32 a field of 120 photographed as smooth potatoes
    // with a few flat spots — the facets have to be deep enough to catch a
    // different amount of sun from their neighbours or the shape is lost.
    const dMax = radius * ((tune && tune.depthMax != null) ? tune.depthMax : 0.45);
    const n = new THREE.Vector3(), tmp = new THREE.Vector3();
    for (let s = 0; s < SCRAPES; s++) {
      const seedV = Math.floor(r() * verts.length) % verts.length;
      // flood out HOPS edges from the seed
      let ring = [seedV];
      const got = { };
      got[seedV] = 1;
      for (let h = 0; h < HOPS; h++) {
        const next = [];
        for (let i = 0; i < ring.length; i++) {
          const nb = adj[ring[i]];
          for (let k = 0; k < nb.length; k++) if (!got[nb[k]]) { got[nb[k]] = 1; next.push(nb[k]); }
        }
        ring = next;
      }
      // the cutting plane: through the seed, pulled inward along its own
      // position-as-normal by a random depth. INWARD ONLY — a scrape removes
      // material, it never bulges the rock out.
      n.copy(verts[seedV]).normalize();
      const depth = dMin + r() * (dMax - dMin);
      const planeD = verts[seedV].dot(n) - depth;
      for (const kStr in got) {
        const v = verts[kStr | 0];
        const d = v.dot(n) - planeD;
        if (d > 0) v.addScaledVector(n, -d);
      }
    }
    if (tune && tune.squashY != null) for (let i = 0; i < verts.length; i++) verts[i].y *= tune.squashY;
    // non-indexed write-back: every triangle owns its verts, so
    // computeVertexNormals gives flat facets — the crisp chipped look the
    // whole exercise is for.
    const arr = new Float32Array(index.length * 3);
    for (let t = 0; t < index.length; t++) {
      const v = verts[index[t]];
      arr[t * 3] = v.x; arr[t * 3 + 1] = v.y; arr[t * 3 + 2] = v.z;
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute("position", new THREE.BufferAttribute(arr, 3));
    out.computeVertexNormals();
    src.dispose();
    return out;
  }

  let milState = "idle";              // idle | loading | ready | absent
  const milWaiters = [];
  function wantMil() {
    if (milState !== "idle") return;
    if (NO_MIL || OLD) { milState = "absent"; return; }
    if (CBZ.milModels || (CBZ.studio && CBZ.studio.model && CBZ.studio.models().length)) { milState = "ready"; return; }
    if (!CBZ.studio || !CBZ.studio.need) { milState = "absent"; return; }
    milState = "loading";
    CBZ.studio.need(["military"]).then(function () {
      milState = CBZ.milModels ? "ready" : "absent";
      flushMil();
    }).catch(function (e) {
      console.warn("[warlord/props] military pack absent; wrecks are primitives", e);
      milState = "absent";
      flushMil();
    });
  }
  function flushMil() { while (milWaiters.length) { try { milWaiters.shift()(); } catch (e) {} } }
  function onMil(fn) {
    if (milState === "ready" || milState === "absent") { fn(); return; }
    milWaiters.push(fn);
  }
  /* THE MODEL FACTORIES DO NOT RETURN AN Object3D. Every one of
     CBZ.milModels' builders returns a RECORD — {group, footW, footL, height}
     — because the airbase needs the dimensions to park it. Assuming an
     Object3D came back and writing .position.y on it is a
     "Cannot set properties of undefined" one line later, which is exactly
     what the first run of this file did. Unwrap, and keep the record on
     userData so a caller that wants the real footprint has it. */
  function milModel(name) {
    if (milState !== "ready") return null;
    let rec = null;
    try { rec = CBZ.studio && CBZ.studio.model ? CBZ.studio.model(name) : null; } catch (e) { return null; }
    if (!rec) return null;
    const g = rec.isObject3D ? rec : rec.group;
    if (!g || !g.isObject3D) return null;
    if (!rec.isObject3D) g.userData.milRec = { footW: rec.footW, footL: rec.footL, height: rec.height };
    return g;
  }
  /* AND SEAT IT ON THE SAND BY MEASURING IT. world/airbase.js's own note:
     "parked aircraft sit on their wheels because seat() measures the bounding
     box instead of guessing a gear drop". Same problem here and the same
     answer — these models are authored around whatever origin their author
     found convenient, and a wreck floating 40 cm over its own scorch mark is
     the single most obvious defect this file could ship. */
  function seat(obj, sink) {
    const bb = new THREE.Box3().setFromObject(obj);
    if (!isFinite(bb.min.y)) { obj.position.y = -sink; return 0; }
    obj.position.y -= bb.min.y + sink;
    return bb.max.y - bb.min.y;
  }

  /* ============================================================ BATCHING
     ONE MESH PER MATERIAL PER ROOT, merged here rather than by core/batch.js.

     batch.js V2 bakes each source colour into vertex colours and draws the
     result with ONE shared white Lambert per lighting class. That is a fine
     trade for the city's flat boxes and it would erase every surface in this
     file: the plaster, the brick courses, the canvas seams all live in a
     shader patch ON the material (see SURFACES), and V2 throws the material
     away. So the merge is done here, keyed by material identity: a compound
     costs one draw call per material it uses (~15-25), every merged mesh
     keeps its surface, and the merged geometry lands in the root's OWN frame
     so the surfaces are square to the compound however it is placed.

     THE RULES are batch.js's, kept: it must run while the root is still at
     the origin of its own build (inside the factory, before place()); any
     mesh carrying userData, any transparent one and anything under a
     `userData.dynamic` subtree (banner cloth, flames, smoke) is left alone;
     near and far are settled separately so the LOD can still be toggled.
     InstancedMeshes are already one call each and are left as they are. */
  const _inv = new THREE.Matrix4(), _mm = new THREE.Matrix4(), _nm = new THREE.Matrix3(), _im = new THREE.Matrix4();
  /* A static InstancedMesh with per-instance colour folds into a vertex-
     coloured bucket, so its material needs a vertexColors twin carrying the
     same surface. One twin per material, cached. */
  const _vcTwin = new Map();
  function vcTwin(mat) {
    if (mat.vertexColors) return mat;
    let t = _vcTwin.get(mat);
    if (t) return t;
    t = mat.clone();
    t.vertexColors = true;
    t.userData = {};
    if (mat.userData && mat.userData.skin) skin(t, mat.userData.skin);
    t._shared = true;
    _vcTwin.set(mat, t);
    return t;
  }
  /* ONE WHITE MATERIAL PER SURFACE KIND (and side). Every plain Lambert in
     the compound is folded into the bucket for its kind with its colour
     baked into the vertex colour, so metal and metalDark, the three adobes
     and every canvas are one draw call each while each keeps its surface.
     That is batch.js V2's trick, keyed by surface instead of discarding it. */
  const _kindVC = new Map();
  function kindVC(kind, side) {
    const k = (kind || "-") + "|" + side;
    let m = _kindVC.get(k);
    if (m) return m;
    m = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true, side: side });
    if (kind) skin(m, kind);
    m._shared = true;
    _kindVC.set(k, m);
    return m;
  }
  function foldable(mat) {
    return mat.isMeshLambertMaterial && !mat.map && !(mat.emissive && mat.emissive.getHex() !== 0);
  }
  function settle(root) {
    if (!root || root.userData._settled) return root;
    root.userData._settled = true;
    root.updateMatrixWorld(true);
    _inv.copy(root.matrixWorld).invert();
    const buckets = new Map();
    (function walk(o) {
      const kids = o.children;
      for (let i = 0; i < kids.length; i++) {
        const ch = kids[i];
        if (ch.userData && ch.userData.dynamic) continue;
        if (ch.isMesh && ch.visible && ch.geometry && ch.geometry.attributes.position &&
            ch.material && !Array.isArray(ch.material) && !ch.material.transparent &&
            !(ch.userData && Object.keys(ch.userData).length)) {
          const fold = foldable(ch.material);
          const mat = fold ? kindVC(ch.material.userData && ch.material.userData.skin, ch.material.side)
            : (ch.isInstancedMesh && ch.instanceColor ? vcTwin(ch.material) : ch.material);
          const k = mat.uuid + (ch.castShadow ? "s" : "") + (ch.receiveShadow ? "r" : "");
          let b = buckets.get(k);
          if (!b) { b = { mat: mat, list: [] }; buckets.set(k, b); }
          b.list.push(ch);
        }
        if (ch.children.length) walk(ch);
      }
    })(root);
    const v = new THREE.Vector3();
    buckets.forEach(function (B) {
      const list = B.list, mat = B.mat;
      if (list.length < 2 && !list[0].isInstancedMesh) return;
      let n = 0, wantUv = false;
      const geos = list.map(function (m) {
        let g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry;
        if (!g.attributes.normal) { if (g === m.geometry) g = g.clone(); g.computeVertexNormals(); }
        if (g.attributes.skUv) wantUv = true;
        n += g.attributes.position.count * (m.isInstancedMesh ? m.count : 1);
        return g;
      });
      if (!n) return;
      const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
      const col = mat.vertexColors ? new Float32Array(n * 3).fill(1) : null;
      const suv = wantUv ? new Float32Array(n * 2) : null;
      let o = 0;
      for (let i = 0; i < list.length; i++) {
        const g = geos[i], m = list[i];
        const reps = m.isInstancedMesh ? m.count : 1;
        const Pa = g.attributes.position, Na = g.attributes.normal, Ca = g.attributes.color, Ua = g.attributes.skUv;
        const cnt = Pa.count;
        for (let rep = 0; rep < reps; rep++) {
          _mm.multiplyMatrices(_inv, m.matrixWorld);
          // the source material's own colour rides in the vertex colour
          // when it was folded into a white per-kind material
          let ir = 1, ig = 1, ib = 1;
          if (foldable(m.material)) {
            ir = m.material.color.r; ig = m.material.color.g; ib = m.material.color.b;
          }
          if (m.isInstancedMesh) {
            m.getMatrixAt(rep, _im);
            _mm.multiply(_im);
            if (m.instanceColor) {
              const IC = m.instanceColor;
              ir *= IC.getX(rep); ig *= IC.getY(rep); ib *= IC.getZ(rep);
            }
          }
          _nm.getNormalMatrix(_mm);
          for (let j = 0; j < cnt; j++) {
            const q = (o + j) * 3;
            v.fromBufferAttribute(Pa, j).applyMatrix4(_mm);
            pos[q] = v.x; pos[q + 1] = v.y; pos[q + 2] = v.z;
            v.fromBufferAttribute(Na, j).applyMatrix3(_nm).normalize();
            nor[q] = v.x; nor[q + 1] = v.y; nor[q + 2] = v.z;
            if (col) {
              const cr = Ca && m.material.vertexColors ? Ca.getX(j) : 1, cg = Ca && m.material.vertexColors ? Ca.getY(j) : 1, cb = Ca && m.material.vertexColors ? Ca.getZ(j) : 1;
              col[q] = cr * ir; col[q + 1] = cg * ig; col[q + 2] = cb * ib;
            }
            if (suv && Ua) { suv[(o + j) * 2] = Ua.getX(j); suv[(o + j) * 2 + 1] = Ua.getY(j); }
          }
          o += cnt;
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      geo.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
      if (col) geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
      if (suv) geo.setAttribute("skUv", new THREE.BufferAttribute(suv, 2));
      geo.computeBoundingSphere();
      const merged = new THREE.Mesh(geo, mat);
      merged.castShadow = list[0].castShadow;
      merged.receiveShadow = list[0].receiveShadow;
      for (let i = 0; i < list.length; i++) if (list[i].parent) list[i].parent.remove(list[i]);
      root.add(merged);
    });
    return root;
  }




  /* ============================================================ COLLIDERS
     A collider here is a plain {x,y,z,w,h,d} in the group's LOCAL frame, y
     being the box CENTRE. place() rotates it into the world and registers it
     with CBZ.micro.addBoxCollider, which is the same registry combat_iq's
     cover search reads through CBZ.queryCollidersNear.

     combat_iq's own thresholds (systems/combat_iq.js, COVER_MIN_H 0.85 /
     COVER_MIN_W 0.7 / y0 <= 1.2) decide whether a box is cover at all, so
     anything in this file that is MEANT as cover is at least 1.0 m tall,
     0.8 m across and sits on the ground. A 0.6 m sandbag course looks right
     in a photograph and is invisible to every fighter on the field, which is
     worse than not drawing it. Anything below the bar is tagged solid:true,
     cover:false — it still stops a body, it just does not pretend. */
  // `yaw` (optional) turns the box about its own centre, exactly as a mesh's
  // rotation.y would: w runs along the turned local x, d along local z.
  function col(list, x, y, z, w, h, d, tag, yaw) {
    const c = { x: x, y: y, z: z, w: w, h: h, d: d, tag: tag || "" };
    if (yaw) c.yaw = yaw;
    list.push(c);
    return list;
  }

  /* TURNED PROPS GET TURNED COLLIDERS (2026-09-29). This used to expand a
     rotated box to its own bounding rectangle because micro's registry was
     AABB-only, and the "errs toward more solid" defence did not survive a
     walk around the result: a 6 m sandbag run at 45 degrees was a 4.9 m
     square of solid air, men halted a metre and a half short of cover they
     could see through, and a turned container was walk-through on one
     diagonal corner and an invisible wall on the other. micro now resolves
     oriented boxes exactly (the same record physics.js reads), so each box
     is registered at the prop's yaw plus its own.

     MESH-DERIVED, WHERE A PROP ASKS. `userData.meshCollider` (true for the
     whole group, or one Object3D) says the typed box is only a stand-in for
     an irregular shape; when systems/meshcollider.js is on the page the
     records are cut from that mesh instead. Absent the file, or if it
     produces nothing, the typed boxes stand. */
  P.place = function (group, x, y, z, yaw) {
    if (!group) return null;
    yaw = yaw || 0;
    group.position.set(x || 0, y || 0, z || 0);
    group.rotation.y = yaw;
    group.updateMatrixWorld(true);
    const cs = (group.userData && group.userData.colliders) || [];
    const M2 = CBZ.micro;
    const out = [];
    if (M2 && M2.addBoxCollider) {
      const mc = group.userData && group.userData.meshCollider;
      const MC = CBZ.meshCollider;
      if (mc && MC && MC.fromMesh) {
        try {
          const tag = (cs[0] && cs[0].tag) || "mesh";
          const recs = MC.fromMesh(mc === true ? group : mc, { tag: tag, ref: group }) || [];
          for (let i = 0; i < recs.length; i++) {
            const r = recs[i];
            if (!r) continue;
            r.warlordProp = true; r.propTag = tag;
            out.push(M2.addCollider(r));
          }
        } catch (e) { out.length = 0; }
      }
      const cy = Math.cos(yaw), sy = Math.sin(yaw);
      const fromMesh = out.length > 0;
      for (let i = 0; i < cs.length && !fromMesh; i++) {
        const c = cs[i];
        if (c.cover === false && c.solid === false) continue;
        const wx = x + c.x * cy + c.z * sy;
        const wz = z - c.x * sy + c.z * cy;
        out.push(M2.addBoxCollider(wx, y + c.y, wz, c.w, c.h, c.d,
          { warlordProp: true, propTag: c.tag || "", yaw: yaw + (c.yaw || 0) }));
      }
      // no doorbell: micro files each record in place as it is added, and the
      // bell would throw the whole grid away once per outpost raised
    }
    group.userData.placed = out;
    // matrix freeze last: the group's own transform is final from here.
    try { if (CBZ.freezeStaticUnder) CBZ.freezeStaticUnder(group); } catch (e) {}
    return group;
  };
  P.unplace = function (group) {
    const M2 = CBZ.micro;
    const raised = group && group.userData && group.userData.placed;
    if (!raised || !M2 || !M2.colliders) return;
    for (let i = raised.length - 1; i >= 0; i--) {
      if (M2.removeCollider) { M2.removeCollider(raised[i]); continue; }
      const at = M2.colliders.indexOf(raised[i]);
      if (at >= 0) M2.colliders.splice(at, 1);
    }
    group.userData.placed = null;
    // removeCollider unfiles in place; the old splice path needs the bell
    if (!M2.removeCollider) {
      if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
      if (M2.rebuildColliderGrid) M2.rebuildColliderGrid();
    }
  };

  /* ============================================================ LOD
     These get drawn at 30 m and at 3 km. At 3 km one metre is a third of a
     pixel at this fov, so a depot is a SHAPE and nothing else — and the
     shape had better be the right one, because it is how you navigate a 14
     km island. Each outpost therefore carries two children: `near`, the
     real thing, and `far`, a deliberately over-scaled block silhouette
     (crane + container row, a cluster of triangles, a palm crown and a
     sail). The far version is exaggerated ON PURPOSE — a 2.6 m container is
     a quarter pixel at 3 km and a 9 m one is nearly a pixel, and being
     recognisable beats being to scale at a range where nothing is to scale.

     SWITCH DISTANCE 420 m: measured against desert.js's fog (fogNear 1400)
     — past ~400 m the near version's detail is under a pixel and the two
     read identically, and below it the far version's exaggeration shows. */
  const LOD_SWITCH = 420;
  const lodList = [];
  function lodable(group, near, far, r) {
    group.userData.lod = { near: near, far: far, r: r || LOD_SWITCH };
    far.visible = false;
    lodList.push(group);
    return group;
  }
  P.lodTick = function (camPos) {
    if (!camPos) return 0;
    let swapped = 0;
    for (let i = lodList.length - 1; i >= 0; i--) {
      const g = lodList[i];
      if (!g.parent) { lodList.splice(i, 1); continue; }   // dropped from the scene
      const L = g.userData.lod;
      const dx = g.position.x - camPos.x, dz = g.position.z - camPos.z;
      const farSide = (dx * dx + dz * dz) > L.r * L.r;
      if (L.near.visible === farSide) {
        L.near.visible = !farSide;
        L.far.visible = farSide;
        swapped++;
      }
    }
    return swapped;
  };
  P.forget = function (group) {
    const at = lodList.indexOf(group);
    if (at >= 0) lodList.splice(at, 1);
  };

  /* ============================================================ PIECES
     The vocabulary. Everything below builds out of these, and they are
     published because outpost.js/battle.js/campaign.js wanting "a palm" or
     "a fire" is the exact situation this file exists to answer once. */

  /* A PALM. Technique borrowed from city/beach.js's TREES_V2 note: the crown
     hub sits at the trunk-top read off the trunk's own matrix, and the six
     fronds are pulled INWARD so their inner ends run through the hub. The
     bug that note records — deriving the leaned top with hand trig and a
     wrong sign, so the frond ring floats beside the trunk — is avoided here
     the cheap way: this palm leans by rotating the whole GROUP, so the trunk
     top is trivially (0, h, 0) in group space and there is no trig to get
     wrong. */
  let _frondGeo = null;
  /* A FROND IS A CURVE, NOT A PLANK. The first draft made each frond one
     flat box rotated down by a fixed droop, and nine palms came out as a
     grove of beach parasols — the fronds stuck out dead straight and all at
     the same angle. A real palm frond leaves the crown almost horizontal,
     bends over its own length and hangs at the tip. So it is one strip of
     four quads that narrows AND droops harder as it goes out, built once
     and shared by every palm in the game. Eleven per crown, not seven:
     seven leaves gaps you can see the sky through from underneath. */
  function frondGeo() {
    if (_frondGeo) return _frondGeo;
    /* PINNATE, NOT A PADDLE. The strip carries skUv (u across, 0.5 on the
       spine; v along) and the frond surface cuts leaflets out of it, raked
       toward the tip, so a crown reads as a date palm's feathered leaves
       instead of eleven green paddles. Wider than the solid blade was,
       because the cut takes about half of it away. */
    const SEG = 8, LEN = 3.1;
    const t = [], uvs = [];
    const at = function (u) {
      const x = u * LEN;
      const y = -Math.pow(u, 1.9) * LEN * 0.95;      // the hang
      const w = 0.46 * (1 - Math.pow(u, 1.5)) + 0.05; // the taper
      return { x: x, y: y, w: w };
    };
    for (let i = 0; i < SEG; i++) {
      const u0 = i / SEG, u1 = (i + 1) / SEG;
      const a = at(u0), b = at(u1);
      // a V section: the leaflets rise off the spine, so the frond catches
      // light on two planes instead of reading as a ribbon
      const dip = 0.12;
      const q = [
        [a.x, a.y, -a.w, 0, u0], [b.x, b.y, -b.w, 0, u1], [b.x, b.y - dip, 0, 0.5, u1], [a.x, a.y - dip, 0, 0.5, u0],
        [a.x, a.y - dip, 0, 0.5, u0], [b.x, b.y - dip, 0, 0.5, u1], [b.x, b.y, b.w, 1, u1], [a.x, a.y, a.w, 1, u0],
      ];
      for (let h = 0; h < 2; h++) {
        const o = h * 4;
        const tri = [o, o + 1, o + 2, o, o + 2, o + 3];
        for (let k = 0; k < 6; k++) { const p = q[tri[k]]; t.push(p[0], p[1], p[2]); uvs.push(p[3], p[4]); }
      }
    }
    _frondGeo = soup(t);
    _frondGeo.setAttribute("skUv", new THREE.BufferAttribute(new Float32Array(uvs), 2));
    return _frondGeo;
  }

  /* A PALM. Technique borrowed from city/beach.js's TREES_V2 note: the crown
     hub sits at the trunk top and the fronds are pulled INWARD so their
     inner ends run through it. The bug that note records — deriving the
     leaned top with hand trig and a wrong sign, so the frond ring floats
     beside the trunk — is avoided here the cheap way: this palm leans by
     rotating the whole GROUP, so the trunk top is trivially (0, h, 0) in
     group space and there is no trig left to get wrong. */
  P.palm = function (opts) {
    opts = opts || {};
    const g = new THREE.Group();
    const r = stream(opts.seed);
    const h = opts.h || r.range(6.5, 10.5);
    // TRUNK RADIUS 0.15/0.26, not 0.20/0.34. A date palm's trunk is about
    // 40 cm across; the first pass drew 68 cm and nine of them read as a
    // colonnade rather than a grove.
    // +/- 0.30 rad. A palm grows toward the light and away from the wind and
    // nothing in a grove is plumb; at 0.16 and then 0.20 they photographed as
    // a colonnade of identical vertical posts.
    const lean = opts.lean == null ? r.range(-0.30, 0.30) : opts.lean;
    const yaw = opts.yaw == null ? r.f() * TAU : opts.yaw;
    // the leaf-base rings are in the trunk's SURFACE now (the palm skin): the
    // four dark collars that stood proud of it read as pipe fittings
    cyl(g, 0.12, 0.21, h, 9, M("palmTrunk"), 0, h / 2 - 0.25, 0);
    cyl(g, 0.30, 0.20, 0.5, 9, M("palmTrunk"), 0, h - 0.15, 0);   // the fibrous boss
    const n = 11;
    const fg = frondGeo();
    for (let i = 0; i < n; i++) {
      const a = yaw + i * (TAU / n) + r.range(-0.12, 0.12);
      /* -0.18 to +0.26, not 0.05 to 0.42. Positive lift raises the frond,
         and a whole crown of raised fronds is a fern star seen from above —
         which is what nine of these photographed as. Half the fronds now
         start below horizontal and the geometry's own hang takes them the
         rest of the way down. */
      const lift = r.range(-0.18, 0.26);
      const f = new THREE.Mesh(fg, MD("frond"));
      f.position.set(0, h - 0.1, 0);
      f.rotation.set(0, -a, lift);
      f.scale.setScalar(r.range(0.8, 1.15));
      f.castShadow = true;
      g.add(f);
    }
    /* DATES. This was one 55 cm rust-coloured BOX hung under the crown. A
       date bunch is a fan of fruiting strands hanging off a stalk: each one
       here is a tapered cone of fruit on a thin stalk, two to four of them
       round the trunk, all out of one shared geometry. */
    if (r.chance(0.6)) {
      const nb = 2 + Math.floor(r.f() * 3);
      for (let i = 0; i < nb; i++) {
        const a = yaw + i * (TAU / nb) + r.range(-0.3, 0.3);
        const bx = Math.cos(a) * 0.3, bz = Math.sin(a) * 0.3;
        const st = cyl(g, 0.018, 0.018, 0.55, 4, M("palmTrunk"), bx * 0.7, h - 0.42, bz * 0.7, 0, 0, 0);
        st.rotation.set(Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5);
        const bunch = new THREE.Mesh(dateGeo(), M("dates"));
        bunch.position.set(bx, h - 0.72, bz);
        bunch.rotation.y = r.f() * TAU;
        bunch.castShadow = true;
        g.add(bunch);
      }
    }
    g.rotation.z = lean;
    g.rotation.y = yaw * 0.3;
    g.userData.colliders = [];
    col(g.userData.colliders, 0, h / 2, 0, 0.8, Math.min(h, 3.4), 0.8, "palm");
    return g;
  };

  /* A FIRE. Log tripod, an ember core, and a smoke column — and the smoke is
     the part that matters. A camp you cannot see from a kilometre away is
     not a landmark, and at that range the tents are two pixels and the smoke
     is forty. It is one tapered double-sided quad pair, unlit, sorted behind
     nothing, and it drifts on a sine. */
  P.fire = function (opts) {
    opts = opts || {};
    const g = new THREE.Group();
    const r = stream(opts.seed);
    const rad = opts.r || 0.9;
    /* STONES, NOT BRICKS. The ring was nine identical 46 cm boxes; it is
       eleven fire-blackened field stones out of the scraped rock set,
       squat and bedded into the sand. */
    const ring = new THREE.InstancedMesh(rockGeo(3), M("rockDark"), 11);
    const d = new THREE.Object3D();
    for (let i = 0; i < 11; i++) {
      const a = i / 11 * TAU + r.range(-0.1, 0.1);
      d.position.set(Math.cos(a) * rad, 0.06, Math.sin(a) * rad);
      d.rotation.set(r.range(-0.3, 0.3), r.f() * TAU, r.range(-0.3, 0.3));
      const s = r.range(0.17, 0.26);
      d.scale.set(s * 1.2, s * 0.85, s);
      d.updateMatrix(); ring.setMatrixAt(i, d.matrix);
    }
    ring.castShadow = true; ring.receiveShadow = true;
    g.add(ring);
    // the ash bed inside the ring
    const ash = new THREE.Mesh(dishGeo(rad * 0.88, 0.02, 0.06, 12, 0, 0.12), M("char"));
    ash.receiveShadow = true;
    g.add(ash);
    // LOGS, and they are round: a tepee of five, feet in the ash, tips
    // meeting over the flame. They were 16 cm square beams at odd angles.
    for (let i = 0; i < 5; i++) {
      const a = i / 5 * TAU + r.range(-0.25, 0.25);
      rod(g, 0.07, 0.06, [Math.cos(a) * 0.62, 0.05, Math.sin(a) * 0.62],
        [Math.cos(a + 0.3) * 0.08, 0.62 + r.range(-0.08, 0.08), Math.sin(a + 0.3) * 0.08], M("woodDark"), 6);
    }
    // the live half: embers + smoke, tagged dynamic so settle() leaves it be
    const live = new THREE.Group();
    live.userData.dynamic = true;
    /* THE FLAME IS LIGHT, NOT A SOLID. It was a lit orange cone — a traffic
       cone standing in the fire. Two crossed quads carrying a soft flame
       texture, additive, no depth write: it glows over the logs, lets them
       show through its edges, and flickers on the same scale write. */
    const flame = new THREE.Mesh(flameGeo(), flameMat());
    const coals = new THREE.Mesh(CG(0.2, 0.26, 0.05, 8), M("ember"));
    coals.position.y = 0.05;
    g.add(coals);
    flame.position.y = 0.04;
    live.add(flame);
    if (opts.smoke !== false) {
      const H = opts.smokeH || 11;
      const sm = new THREE.Mesh(smokeCol(H), smokeMat());
      sm.position.y = 0.9;
      sm.castShadow = false; sm.receiveShadow = false;
      live.add(sm);
      live.userData.smoke = sm;
    }
    live.userData.flame = flame;
    live.userData.phase = r.f() * TAU;
    g.add(live);
    g.userData.live = live;
    liveFires.push(live);
    g.userData.colliders = [];
    return g;
  };
  /* A SMOKE COLUMN, and the first one was a disaster: two crossed quads at a
     flat 0.16 opacity, 4.6 m wide at the top, which photographed as a giant
     white light-shaft fanning off the top of the frame — it read as a bug in
     the renderer, not as smoke. Two fixes, both from the picture:

       1. IT FADES OUT. r128 supports vertex ALPHA (a 4-component `color`
          attribute plus material.vertexColors — `vertexAlphas` in the
          program cache; confirmed in the vendored bundle before relying on
          it), so the plume goes to zero alpha at the top in ONE draw call
          instead of needing a stack of quads at stepped opacities.
       2. IT IS A QUARTER THE WIDTH. Real smoke off a cook fire is a thin
          rope that shears downwind, not a cone.

     Still two crossed quads and still unlit, because at the range this is
     FOR — the thing that says "a camp is over there" from a kilometre — the
     silhouette is the whole information content. */
  /* A SMOKE COLUMN, third version. The first two were crossed quads with
     straight edges, and however the alpha was tuned they photographed as a
     pair of white LIGHT SHAFTS fanning off the fire (owner's screenshot,
     2026-09-27 wave). Smoke is a rope of soft puffs that swell, drift
     downwind and thin out. So: eight puffs up a sheared curve, each one two
     crossed quads carrying a soft round texture (puffTex), alpha falling
     with height through the vertex colour. Still ONE draw call per fire. */
  function smokeCol(h) {
    const pos = [], colr = [], uv = [];
    const N = 8, drift = h * 0.34;
    for (let i = 0; i < N; i++) {
      const v = (i + 0.5) / N;
      const cx = drift * v * v + Math.sin(i * 2.3) * 0.25 * v, cy = v * h, cz = Math.cos(i * 1.7) * 0.2 * v;
      const r = 0.55 + v * h * 0.16;
      const al = 0.55 * Math.pow(1 - v, 1.3);
      for (let q = 0; q < 2; q++) {
        const ax = q ? 0 : 1, az = q ? 1 : 0;
        const P = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
        const tri = [0, 1, 2, 0, 2, 3];
        for (let k = 0; k < 6; k++) {
          const p = P[tri[k]];
          pos.push(cx + ax * p[0] * r, cy + p[1] * r, cz + az * p[0] * r);
          uv.push((p[0] + 1) / 2, (p[1] + 1) / 2);
          colr.push(1, 1, 1, al);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pos), 3));
    g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(uv), 2));
    g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(colr), 4));
    return g;
  }

  /* A RIDGE TENT, as one prism geometry rather than five boxes, because a
     camp is nine of them and a prism instances where five boxes do not. */
  let _tentGeo = null;
  function tentGeo() {
    if (_tentGeo) return _tentGeo;
    /* HALF-EXTENTS, and the first draft got them wrong in the way that only
       a photograph shows: w 1.6 / h 1.0 is a 3.2 m wide tent 1 m at the
       ridge, which from a camera 12 m up is a triangle lying FLAT on the
       sand. A real ridge tent is taller than it is half-wide. 1.15 / 1.85 /
       1.75 is a 2.3 m wide, 1.85 m tall, 3.5 m long tent — you can stand up
       in the middle of it, and it has a silhouette from above. */
    const w = 1.15, h = 1.85, l = 1.75;
    const t = [];
    const A = [-w, 0, -l], B = [w, 0, -l], C = [w, 0, l], D = [-w, 0, l];
    const R0 = [0, h, -l], R1 = [0, h, l];
    function tri(p, q, s) { t.push(p[0], p[1], p[2], q[0], q[1], q[2], s[0], s[1], s[2]); }
    tri(A, R0, R1); tri(A, R1, D);         // left slope
    tri(B, C, R1); tri(B, R1, R0);         // right slope
    tri(A, B, R0);                         // back gable
    // the FRONT is open: a triangle with its apex cut away, so the tent has
    // a door you can see into. A closed gable at both ends is a wedge; the
    // gap is what makes nine of these read as tents rather than as bunting.
    const F0 = [-w, 0, l], F1 = [w, 0, l], M0 = [-w * 0.42, h * 0.6, l], M1 = [w * 0.42, h * 0.6, l];
    tri(F0, M0, R1); tri(F0, R1, M1); tri(F0, M1, F1);
    _tentGeo = soup(t);
    return _tentGeo;
  }
  P.tents = function (list, opts) {
    opts = opts || {};
    // DOUBLE-SIDED, because the front gable is open and a single-sided tent
    // is a hole you can see the sand through from the wrong angle.
    const im = new THREE.InstancedMesh(tentGeo(), MW(true, "canvas"), list.length);
    const d = new THREE.Object3D();
    const hasCol = !!im.setColorAt;
    const c = new THREE.Color();
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      d.position.set(t.x, t.y || 0, t.z);
      d.rotation.set(0, t.yaw || 0, 0);
      d.scale.set(t.s || 1, t.sy || t.s || 1, t.s || 1);
      d.updateMatrix(); im.setMatrixAt(i, d.matrix);
      // per-tent bleach: real canvas in a desert is nine shades of the same
      // colour, and one flat tint is the loudest "generated" signal there is
      /* canvasDark, NOT canvas. A tent in a desert reads DARKER than the
         sand around it, because what you see from above is its two shaded
         slopes and its own shadow — a tent tinted the same value as the
         ground is invisible from a campaign camera, which is where this
         object is looked at most. */
      if (hasCol) { const k = 0.82 + (t.tint == null ? 0.3 : t.tint) * 0.34; c.setHex(COL[opts.mat || "canvasDark"]).multiplyScalar(k); im.setColorAt(i, c); }
    }
    im.instanceMatrix.needsUpdate = true;
    if (hasCol && im.instanceColor) im.instanceColor.needsUpdate = true;
    im.castShadow = true; im.receiveShadow = true;
    return im;
  };
  /* WHAT IS INSIDE A TENT. The front gable is open, so every tent in a camp
     is a window onto its floor — and the floor was bare sand. Two men sleep
     in a ridge tent: two bedrolls laid lengthwise either side of the pole
     line, a kit bag at the head of each. One InstancedMesh per shape for
     the whole camp, placed in each tent's own frame. */
  P.tentBeds = function (list) {
    const g = new THREE.Group();
    const rolls = new THREE.InstancedMesh(pillowGeo(0.62, 0.15, 2.0), MW(false, "canvas"), list.length * 2);
    const bags = new THREE.InstancedMesh(pillowGeo(0.5, 0.3, 0.34), MW(false, "burlap"), list.length * 2);
    const d = new THREE.Object3D(), p = new THREE.Object3D(), c = new THREE.Color();
    for (let i = 0; i < list.length; i++) {
      const t = list[i], s = t.s || 1;
      p.position.set(t.x, t.y || 0, t.z); p.rotation.set(0, t.yaw || 0, 0); p.scale.set(1, 1, 1); p.updateMatrix();
      for (let k = 0; k < 2; k++) {
        const side = k ? 1 : -1;
        d.position.set(side * 0.46 * s, 0.1, -0.12 * s); d.rotation.set(0, side * 0.04, 0); d.scale.set(1, 1, 1);
        d.updateMatrix(); d.matrix.premultiply(p.matrix); rolls.setMatrixAt(i * 2 + k, d.matrix);
        c.setHex(k ? COL.canvasDark : COL.hide).multiplyScalar(0.9 + ((i * 7 + k * 3) % 5) * 0.08);
        rolls.setColorAt(i * 2 + k, c);
        d.position.set(side * 0.5 * s, 0.17, -1.35 * s); d.rotation.set(0, 0.3 * side, 0);
        d.updateMatrix(); d.matrix.premultiply(p.matrix); bags.setMatrixAt(i * 2 + k, d.matrix);
        c.setHex(COL.burlap).multiplyScalar(0.85 + ((i + k) % 3) * 0.12);
        bags.setColorAt(i * 2 + k, c);
      }
    }
    rolls.instanceMatrix.needsUpdate = bags.instanceMatrix.needsUpdate = true;
    if (rolls.instanceColor) rolls.instanceColor.needsUpdate = true;
    if (bags.instanceColor) bags.instanceColor.needsUpdate = true;
    rolls.receiveShadow = bags.receiveShadow = true;
    bags.castShadow = true;
    g.add(rolls); g.add(bags);
    return g;
  };

  /* SAGGING CLOTH — a shade sail, a market tarpaulin, a tent fly. Four
     corners and a catenary droop in the middle. A flat quad reads as a
     sheet of plywood; the droop is the entire difference between "cloth"
     and "a plane with a cloth colour on it". */
  function sagGeo(w, d, sag, seg) {
    seg = seg || 4;
    const t = [];
    const at = function (i, j) {
      const u = i / seg, v = j / seg;
      const dip = Math.sin(u * Math.PI) * Math.sin(v * Math.PI) * sag;
      return [(u - 0.5) * w, -dip, (v - 0.5) * d];
    };
    for (let i = 0; i < seg; i++) for (let j = 0; j < seg; j++) {
      const a = at(i, j), b = at(i + 1, j), c = at(i + 1, j + 1), e = at(i, j + 1);
      t.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
      t.push(a[0], a[1], a[2], c[0], c[1], c[2], e[0], e[1], e[2]);
    }
    return soup(t);
  }
  /* A DISH: a circle whose middle is pushed down (or an annulus, when
     `inner` is given). Used for the oasis pool and its grass ring. Two
     radii and two heights beats a flat CircleGeometry for the same cost,
     and it is the difference between water you can see and water you
     cannot. */
  function dishGeo(radius, rimY, midY, seg, inner, jitter) {
    const t = [];
    const ri = inner || 0;
    const j = jitter || 0;
    // per-ANGLE, not per-vertex, so segment i's two corners agree with their
    // neighbours' and the ring stays closed
    const wob = [];
    for (let i = 0; i <= seg; i++) wob.push(1 + (W.hash01(i * 7.3, radius, 991) - 0.5) * 2 * j);
    wob[seg] = wob[0];
    for (let i = 0; i < seg; i++) {
      const a0 = i / seg * TAU, a1 = (i + 1) / seg * TAU;
      const r0 = radius * wob[i], r1 = radius * wob[i + 1];
      const o0 = [Math.cos(a0) * r0, rimY, Math.sin(a0) * r0];
      const o1 = [Math.cos(a1) * r1, rimY, Math.sin(a1) * r1];
      if (ri > 0) {
        const i0 = [Math.cos(a0) * ri * wob[i], midY, Math.sin(a0) * ri * wob[i]];
        const i1 = [Math.cos(a1) * ri * wob[i + 1], midY, Math.sin(a1) * ri * wob[i + 1]];
        t.push(i0[0], i0[1], i0[2], o1[0], o1[1], o1[2], o0[0], o0[1], o0[2]);
        t.push(i0[0], i0[1], i0[2], i1[0], i1[1], i1[2], o1[0], o1[1], o1[2]);
      } else {
        t.push(0, midY, 0, o1[0], o1[1], o1[2], o0[0], o0[1], o0[2]);
      }
    }
    return soup(t);
  }

  P.canopy = function (opts) {
    opts = opts || {};
    const g = new THREE.Group();
    const w = opts.w || 6, d = opts.d || 5, h = opts.h || 2.9;
    // SAG 0.42 OF THE HEIGHT, not 0.22. At 0.22 five canopies photographed as
    // five flat sheets of plywood — the droop is the whole difference between
    // "cloth" and "a plane with a cloth colour on it".
    const cloth = new THREE.Mesh(sagGeo(w, d, opts.sag == null ? h * 0.42 : opts.sag, 4),
      MD(opts.mat || "tarp"));
    cloth.position.y = h;
    cloth.castShadow = true; cloth.receiveShadow = true;
    g.add(cloth);
    for (let i = 0; i < 4; i++) {
      const sx = (i & 1) ? 1 : -1, sz = (i & 2) ? 1 : -1;
      cyl(g, 0.07, 0.09, h, 5, M("post"), sx * w / 2, h / 2, sz * d / 2);
    }
    g.userData.colliders = [];
    return g;
  };

  /* SANDBAGS. One bag geometry, N instances, one draw call — and a REAL
     cover box along the run, because a sandbag wall that combat_iq cannot
     see is decoration and this game's whole fight is about cover. Height is
     1.05 m: over combat_iq's 0.85 m bar with room to spare, and low enough
     that a man behind it is shooting over it rather than hiding from the
     camera. */
  P.sandbags = function (opts) {
    opts = opts || {};
    const len = opts.len || 6;
    const h = opts.h || 1.05;
    const curve = opts.curve || 0;          // metres of bow across the run
    const r = stream(opts.seed);
    const rows = Math.max(2, Math.round(h / 0.26));
    const per = Math.max(2, Math.round(len / 0.62));
    const g = new THREE.Group();
    const im = new THREE.InstancedMesh(pillowGeo(0.6, 0.25, 0.42), MW(false, "burlap"), rows * per + 4);
    const d = new THREE.Object3D();
    const c = new THREE.Color();
    let n = 0;
    for (let y = 0; y < rows; y++) {
      const inset = y * 0.035;              // the wall batters inward as it rises
      const stagger = (y % 2) * 0.31;
      for (let i = 0; i < per; i++) {
        const u = (i + 0.5) / per;
        const x = (u - 0.5) * len + stagger * 0.5;
        if (Math.abs(x) > len / 2) continue;
        const z = Math.sin(u * Math.PI) * curve;
        d.position.set(x, 0.13 + y * 0.245, z);
        d.rotation.set(r.range(-0.05, 0.05), r.range(-0.09, 0.09), r.range(-0.06, 0.06));
        d.scale.set(1 - inset, 1, 1 - inset * 1.6);
        d.updateMatrix(); im.setMatrixAt(n, d.matrix);
        if (im.setColorAt) { c.setHex(COL.burlap).multiplyScalar(0.8 + r.f() * 0.36); im.setColorAt(n, c); }
        n++;
      }
    }
    im.count = n;
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.castShadow = im.receiveShadow = true;
    g.add(im);
    g.userData.colliders = [];
    // one collider per 3 m of run, so a bowed wall is cover from every angle;
    // each is the CHORD of its stretch of the bow, turned to lie along it
    const segs = Math.max(1, Math.round(len / 3));
    for (let i = 0; i < segs; i++) {
      const u0 = i / segs, u1 = (i + 1) / segs;
      const x0 = (u0 - 0.5) * len, z0 = Math.sin(u0 * Math.PI) * curve;
      const x1 = (u1 - 0.5) * len, z1 = Math.sin(u1 * Math.PI) * curve;
      col(g.userData.colliders, (x0 + x1) / 2, h / 2, (z0 + z1) / 2,
        Math.hypot(x1 - x0, z1 - z0) + 0.2, h, 0.9, "sandbag", Math.atan2(-(z1 - z0), x1 - x0));
    }
    return g;
  };

  /* A GABION / HESCO — a wire cage of rubble. Cheaper than sandbags for the
     same cover (one box + one rock instance mesh) and it reads as a modern
     defensive line rather than a WWI one, which is what a desert warlord's
     depot would actually have. */
  P.gabion = function (opts) {
    opts = opts || {};
    const g = new THREE.Group();
    const r = stream(opts.seed);
    const len = opts.len || 4, h = opts.h || 1.35, d0 = opts.d || 1.0;
    box(g, len, h, d0, M("gabion"), 0, h / 2, 0);
    // the mesh cage: four thin frames, so the silhouette has an edge on it
    box(g, len + 0.06, 0.07, d0 + 0.06, M("metalDark"), 0, h - 0.03, 0);
    box(g, len + 0.06, 0.07, d0 + 0.06, M("metalDark"), 0, 0.05, 0);
    const nrk = Math.round(len * 5);
    const im = new THREE.InstancedMesh(rockGeo(0), M("rock"), nrk);
    const dm = new THREE.Object3D();
    for (let i = 0; i < nrk; i++) {
      dm.position.set(r.range(-len / 2 + 0.2, len / 2 - 0.2), h + r.range(-0.05, 0.14), r.range(-d0 / 2, d0 / 2));
      dm.rotation.set(r.f() * TAU, r.f() * TAU, r.f() * TAU);
      dm.scale.setScalar(r.range(0.14, 0.26));
      dm.updateMatrix(); im.setMatrixAt(i, dm.matrix);
    }
    im.instanceMatrix.needsUpdate = true;
    im.castShadow = true;
    g.add(im);
    g.userData.colliders = [];
    col(g.userData.colliders, 0, h / 2, 0, len, h, d0, "gabion");
    return g;
  };

  /* CRATES, STACKED THE WAY A MAN STACKS THEM. What was here scattered n
     cubes over a square at random yaws and random sizes, and put a third of
     them on "tier 1" at y = 1.05 at random x/z — so most of the upper
     crates were hanging in the air over sand with nothing under them, and
     the ground ones were a jumble nobody would leave. The owner walked past
     exactly this ("3 random boxes stacked, dumb").

     Now: a tidy block of stacks on a grid, every crate square to its
     neighbours (a hand's-width of jitter, not a spin), a crate only ever
     sits ON another crate of the same or larger footprint, and three real
     shapes — the general cargo crate, the long low rifle case and the small
     ammunition box — each with its battens and its brace (crateGeo), one
     instanced draw per shape. */
  const CRATE_TYPES = [
    { w: 1.0, h: 0.9, d: 1.0 },     // general cargo
    { w: 1.2, h: 0.5, d: 0.62 },    // the long rifle case
    { w: 0.66, h: 0.5, d: 0.5 },    // an ammunition box
  ];
  let _crateMat = null;
  function crateMat() {
    if (!_crateMat) {
      _crateMat = new THREE.MeshLambertMaterial({ color: COL.wood, vertexColors: true });
      skin(_crateMat, "plank");
      _crateMat._shared = true;
    }
    return _crateMat;
  }
  P.crates = function (opts) {
    opts = opts || {};
    const r = stream(opts.seed);
    const n = Math.max(1, opts.n || 10);
    const spread = opts.spread || 3.2;
    const g = new THREE.Group();
    const cols = Math.max(1, Math.min(4, Math.round(spread / 1.25)));
    const cells = Math.max(1, Math.min(n, Math.ceil(n * 0.55)));
    const pitch = 1.3;
    const rows = Math.ceil(cells / cols);
    const stacks = [];
    for (let i = 0; i < cells; i++) {
      const cx = (i % cols - (cols - 1) / 2) * pitch;
      const cz = (Math.floor(i / cols) - (rows - 1) / 2) * pitch;
      stacks.push({ x: cx, z: cz, h: 0, type: -1, list: [] });
    }
    const placed = [[], [], []];
    for (let i = 0; i < n; i++) {
      let st, type;
      if (i < cells) {
        st = stacks[i];
        type = r.chance(0.55) ? 0 : (r.chance(0.6) ? 1 : 2);
      } else {
        // on top of an existing stack, never above three high, never a
        // bigger footprint on a smaller one
        const open = stacks.filter(function (s) { return s.list.length < 3 && s.h < 2.2; });
        if (!open.length) break;
        st = open[Math.floor(r.f() * open.length) % open.length];
        type = st.type === 0 ? (r.chance(0.5) ? 0 : (r.chance(0.5) ? 1 : 2)) : (st.type === 1 ? (r.chance(0.6) ? 1 : 2) : 2);
      }
      const T = CRATE_TYPES[type];
      const yaw = (st.list.length ? st.list[0].yaw : r.range(-0.05, 0.05)) + r.range(-0.035, 0.035) + (type === 1 && r.chance(0.5) ? Math.PI / 2 : 0);
      const rec = { x: st.x + r.range(-0.04, 0.04), y: st.h, z: st.z + r.range(-0.04, 0.04), yaw: yaw, t: type,
                    tint: 0.82 + r.f() * 0.34 };
      st.list.push(rec);
      if (st.type < 0) st.type = type;
      st.h += T.h;
      placed[type].push(rec);
    }
    const d = new THREE.Object3D(), c = new THREE.Color();
    let top = 0;
    for (let k = 0; k < 3; k++) {
      if (!placed[k].length) continue;
      const T = CRATE_TYPES[k];
      const im = new THREE.InstancedMesh(crateGeo(T.w, T.h, T.d), crateMat(), placed[k].length);
      for (let i = 0; i < placed[k].length; i++) {
        const p = placed[k][i];
        d.position.set(p.x, p.y, p.z); d.rotation.set(0, p.yaw, 0); d.scale.set(1, 1, 1);
        d.updateMatrix(); im.setMatrixAt(i, d.matrix);
        c.setRGB(p.tint, p.tint * 0.98, p.tint * 0.94); im.setColorAt(i, c);
        if (p.y + T.h > top) top = p.y + T.h;
      }
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.castShadow = true; im.receiveShadow = true;
      g.add(im);
    }
    g.userData.colliders = [];
    // a stack at least 0.85 m tall is cover; a lone low box is a solid thing
    // you walk round, not something a fighter pretends to hide behind
    for (let i = 0; i < stacks.length; i++) {
      const s = stacks[i];
      if (!s.list.length) continue;
      const T = CRATE_TYPES[s.type];
      // the BASE crate's own footprint at its own turn (the stack is squared on it)
      const cc = col(g.userData.colliders, s.x, s.h / 2, s.z, T.w, s.h, T.d, "crate", s.list[0].yaw);
      if (s.h < 0.85) cc[cc.length - 1].cover = false;
    }
    g.userData.top = top;
    return g;
  };

  /* DRUMS. A 200 litre drum is 58 cm across and 88 cm tall, and drums are
     stored standing in a tight cluster, rim to rim, with the odd one down
     on its side against them. The old scatter put them at random over a
     square and — the bug that made the lying ones read as garbage — gave a
     lying drum both of its rolling hoops at the SAME point, the middle, so
     it was a can with a belt. The hoops now sit a third of the way along
     the drum's own axis whichever way up it is. */
  P.drums = function (opts) {
    opts = opts || {};
    const r = stream(opts.seed);
    const n = opts.n || 8;
    const g = new THREE.Group();
    const mat = M(opts.mat || "rust");
    const body = new THREE.InstancedMesh(CG(0.29, 0.29, 0.88, 14), mat, n);
    const rib = new THREE.InstancedMesh(CG(0.305, 0.305, 0.04, 14), mat, n * 2);
    const d = new THREE.Object3D(), h = new THREE.Object3D();
    const lie = Math.min(n - 1, Math.floor(n * 0.2));
    const stand = n - lie;
    const perRow = Math.max(2, Math.ceil(Math.sqrt(stand * 1.4)));
    for (let i = 0; i < n; i++) {
      const lying = i >= stand;
      if (!lying) {
        const row = Math.floor(i / perRow), k = i % perRow;
        d.position.set((k - (perRow - 1) / 2) * 0.6 + (row % 2) * 0.3, 0.44, row * 0.53);
        d.rotation.set(0, r.f() * TAU, 0);
      } else {
        const j = i - stand;
        d.position.set(((perRow + 1) / 2) * 0.6 + 0.55, 0.29, j * 0.62 + r.range(-0.05, 0.05));
        d.rotation.set(0, r.range(-0.2, 0.2), Math.PI / 2);
      }
      d.scale.set(1, 1, 1);
      d.updateMatrix(); body.setMatrixAt(i, d.matrix);
      for (let k = 0; k < 2; k++) {
        h.position.set(0, k ? 0.15 : -0.15, 0);
        h.rotation.set(0, 0, 0); h.scale.set(1, 1, 1);
        h.updateMatrix();
        h.matrix.premultiply(d.matrix);
        rib.setMatrixAt(i * 2 + k, h.matrix);
      }
    }
    body.instanceMatrix.needsUpdate = rib.instanceMatrix.needsUpdate = true;
    body.castShadow = rib.castShadow = true;
    body.receiveShadow = true;
    g.add(body); g.add(rib);
    g.userData.colliders = [];
    return g;
  };

  /* SACKS AND BALES — what a market or a caravan actually carries: grain
     sacks slumped against each other and cloth bales roped in bundles. The
     market used to "sell" seven fuel drums painted the colour of leather. */
  let _baleBand = null;
  P.sacks = function (opts) {
    opts = opts || {};
    const r = stream(opts.seed);
    const n = opts.n || 6;
    const g = new THREE.Group();
    const bale = !!opts.bales;
    const geo = bale ? pillowGeo(0.9, 0.55, 0.62) : pillowGeo(0.52, 0.36, 0.78);
    const im = new THREE.InstancedMesh(geo, MW(false, bale ? "canvas" : "burlap"), n);
    if (bale && !_baleBand) { _baleBand = new THREE.TorusGeometry(0.3, 0.014, 3, 14); _baleBand._shared = true; }
    const bands = bale ? new THREE.InstancedMesh(_baleBand, M("rope"), n * 2) : null;
    const d = new THREE.Object3D(), b = new THREE.Object3D(), c = new THREE.Color();
    const base = bale ? [COL.canvasDark, COL.hide, COL.burlap] : [COL.burlap];
    const per = Math.max(2, Math.ceil(n * 0.6));
    for (let i = 0; i < n; i++) {
      const upper = i >= per;
      const k = upper ? i - per + 0.5 : i;
      const pitch = bale ? 0.86 : 0.5;
      d.position.set((k - (per - 1) / 2) * pitch + r.range(-0.03, 0.03), upper ? (bale ? 0.78 : 0.5) : (bale ? 0.26 : 0.16), r.range(-0.05, 0.05));
      d.rotation.set(bale ? 0 : r.range(-0.25, 0.25), r.range(-0.12, 0.12), bale ? 0 : r.range(-0.12, 0.12));
      d.scale.set(1, 1, 1);
      d.updateMatrix(); im.setMatrixAt(i, d.matrix);
      c.setHex(base[i % base.length]).multiplyScalar(0.82 + r.f() * 0.34); im.setColorAt(i, c);
      if (bands) {
        for (let q = 0; q < 2; q++) {
          // a loop round the bale's girth, in its y-z section
          b.position.set(q ? 0.22 : -0.22, 0, 0); b.rotation.set(0, Math.PI / 2, 0); b.scale.set(1.04, 0.93, 1);
          b.updateMatrix(); b.matrix.premultiply(d.matrix); bands.setMatrixAt(i * 2 + q, b.matrix);
        }
      }
    }
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.castShadow = im.receiveShadow = true;
    g.add(im);
    if (bands) { bands.instanceMatrix.needsUpdate = true; g.add(bands); }
    g.userData.colliders = [];
    return g;
  };
  /* A SHIPPING CONTAINER. Six boxes: body, two door leaves, a top rail, a
     bottom rail and a lock bar. The corrugation a real container has is
     eighteen more boxes per unit for a texture you cannot see past 40 m; the
     rails are what actually give the silhouette its edge. */
  P.container = function (opts) {
    opts = opts || {};
    const g = new THREE.Group();
    const L = opts.len || 12.2, H = 2.6, D = 2.44;
    const paint = M(opts.paint || "boxRed");
    box(g, L, H, D, paint, 0, H / 2, 0);
    box(g, L + 0.1, 0.16, D + 0.1, M("metalDark"), 0, H - 0.06, 0);
    box(g, L + 0.1, 0.2, D + 0.1, M("metalDark"), 0, 0.08, 0);
    // doors on the -x end
    box(g, 0.1, H * 0.92, D * 0.47, M("metalDark"), -L / 2 - 0.05, H / 2, D * 0.24);
    box(g, 0.1, H * 0.92, D * 0.47, M("metalDark"), -L / 2 - 0.05, H / 2, -D * 0.24);
    box(g, 0.14, H * 0.9, 0.1, M("metal"), -L / 2 - 0.09, H / 2, 0);
    g.userData.colliders = [];
    col(g.userData.colliders, 0, H / 2, 0, L, H, D, "container");
    return g;
  };

  /* ============================================================ BANNERS
     core.js gives five factions a colour each and this is where that colour
     becomes a thing on the sand. Two versions, and they exist for two
     different problems:

       banner()      ONE flag, its own meshes, its own cloth chain. For the
                     thing beside you: your camp, a depot's mast, a band's
                     standard in a battle you are standing in.
       bannerField() SIXTY flags in three draw calls. For the map: every band
                     on the island flying its colours at once.

     THE CLOTH IS A CHAIN, not a rotated rectangle. Three segments walked
     out from the pole head, each picking up the previous segment's tip and
     adding its own yaw and pitch off a sine — so the flag ripples along its
     fly and the tip whips further than the hoist, which is what a flag
     does. The first draft rotated one quad about the pole and it read as a
     signboard swinging on a hinge.

     WIND IS ONE GLOBAL. Sixty flags on the same island are in the same wind;
     giving each its own direction is both more expensive and wrong. */
  const WIND = { dir: 0.7, gust: 0 };
  P.wind = function (dirRad) { if (dirRad != null) WIND.dir = dirRad; return WIND; };

  const CLOTH_SEG = 3;

  function clothChain(t, phase, fly, drop, out) {
    // returns CLOTH_SEG {x,y,z,yaw,pitch} steps walked out from (0,0,0)
    let px = 0, py = 0, pz = 0;
    const seg = fly / CLOTH_SEG;
    for (let i = 0; i < CLOTH_SEG; i++) {
      const u = (i + 0.5) / CLOTH_SEG;
      const yaw = WIND.dir + Math.sin(t * 2.3 + phase + u * 3.4) * (0.20 + u * 0.55);
      const pitch = -drop * u + Math.sin(t * 3.1 + phase + u * 4.2) * (0.06 + u * 0.30);
      const cx = Math.cos(yaw) * Math.cos(pitch), cy = Math.sin(pitch), cz = Math.sin(yaw) * Math.cos(pitch);
      const o = out[i] || (out[i] = {});
      o.x = px + cx * seg * 0.5; o.y = py + cy * seg * 0.5; o.z = pz + cz * seg * 0.5;
      o.yaw = yaw; o.pitch = pitch;
      px += cx * seg; py += cy * seg; pz += cz * seg;
    }
    return out;
  }

  const liveBanners = [];
  const liveFires = [];
  // one cloth material per faction colour, not one per flag: five factions on
  // the map is five materials however many standards are flying.
  const _clothMats = {};
  /* A BANNER IS THE ONE THING ALLOWED TO SHOUT, AND SHOUTING IS WHY IT GOES
     WHITE. core.js's faction hexes (0xc4593a, 0x4a8f5a, ...) are picked to be
     legible in HTML, where they are sRGB; fed to r128 as LINEAR and then
     multiplied by the sun they clip, and five factions arrive on the sand as
     five shades of cream. Scaled to 0.42 the hue survives tone mapping and a
     legion banner is still gold at four hundred metres — which is the entire
     job of the object. core.js's numbers are not touched; they are correct
     for the HUD that also uses them. */
  const CLOTH_LINEAR = 0.42;
  function clothMatFor(hex) {
    let m = _clothMats[hex];
    if (!m) {
      const c = new THREE.Color(hex).multiplyScalar(CLOTH_LINEAR);
      m = new THREE.MeshLambertMaterial({ color: c, side: THREE.DoubleSide });
      m._shared = true;
      _clothMats[hex] = m;
    }
    return m;
  }

  P.banner = function (colour, opts) {
    opts = opts || {};
    const g = new THREE.Group();
    const h = opts.h || 7.5;
    const fly = opts.fly || h * 0.34;
    const hoist = opts.hoist || fly * 0.62;
    if (OLD) {                       // the revert: a bare pole, no cloth
      cyl(g, 0.06, 0.09, h, 6, M("wood"), 0, h / 2, 0);
      g.userData.colliders = [];
      return g;
    }
    cyl(g, 0.055, 0.09, h, 7, M("post"), 0, h / 2, 0);
    cyl(g, 0.0, 0.055, 0.34, 6, M("metal"), 0, h + 0.17, 0);            // a spear point, not a cube
    cyl(g, 0.07, 0.07, 0.07, 8, M("metal"), 0, h, 0);
    const mat = clothMatFor(colour == null ? 0xc4593a : colour);
    const live = new THREE.Group();
    live.userData.dynamic = true;
    live.position.y = h - hoist * 0.55;
    const segs = [];
    const segGeo = BG(fly / CLOTH_SEG, hoist, 0.03);
    for (let i = 0; i < CLOTH_SEG; i++) {
      const m = new THREE.Mesh(segGeo, mat);
      m.castShadow = true;
      live.add(m);
      segs.push(m);
    }
    g.add(live);
    const rec = { segs: segs, phase: (opts.seed || 0) * 0.7919 % TAU, fly: fly,
                  drop: opts.drop == null ? 0.22 : opts.drop, out: [] };
    live.userData.banner = rec;
    liveBanners.push(rec);
    g.userData.banner = rec;
    g.userData.colliders = [];
    return g;
  };

  /* SIXTY BANNERS IN THREE DRAW CALLS. Pole InstancedMesh, finial
     InstancedMesh, cloth InstancedMesh at CLOTH_SEG instances per banner
     with per-instance colour. The cloth only re-composes for banners inside
     `liveR` of the camera: at 300 m a flag is four pixels and the ripple is
     information nobody receives, so past it the last matrices just stay. */
  P.bannerField = function (opts) {
    opts = opts || {};
    const cap = opts.cap || 64;
    const h = opts.h || 7.0;
    const fly = opts.fly || 2.6, hoist = opts.hoist || 1.7;
    const g = new THREE.Group();
    g.userData.dynamic = true;      // the cloth moves; batch.js must skip it
    const pole = new THREE.InstancedMesh(CG(0.06, 0.1, h, 6), M("post"), cap);
    const finial = new THREE.InstancedMesh(CG(0.0, 0.07, 0.36, 6), M("metal"), cap);
    const clothMat = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });
    const cloth = new THREE.InstancedMesh(BG(fly / CLOTH_SEG, hoist, 0.03), clothMat, cap * CLOTH_SEG);
    pole.castShadow = cloth.castShadow = true;
    /* ALLOCATE instanceColor UP FRONT. THIS IS THE BUG THAT PAINTED SIXTY
       FLAGS BLACK. r128's InstancedMesh.setColorAt lazily creates the
       attribute sized `new Float32Array(this.count * 3)` — using the count
       AT THE MOMENT OF THE FIRST CALL. The field starts empty so that count
       was 0, every colour write went into a zero-length buffer, and the
       whole field rendered at rgb(0,0,0). Nothing throws; you just get a
       row of black flags and no idea why. Sized here, filled white, so the
       first add() writes into a real buffer. */
    cloth.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(cap * CLOTH_SEG * 3).fill(1), 3);
    cloth.count = finial.count = pole.count = 0;
    pole.frustumCulled = finial.frustumCulled = cloth.frustumCulled = false;
    g.add(pole); g.add(finial); g.add(cloth);
    const items = [];
    const d = new THREE.Object3D();
    const c = new THREE.Color();
    const out = [];
    const api = {
      group: g,
      count: function () { return items.length; },
      add: function (x, y, z, colour, scale) {
        if (items.length >= cap) return null;
        /* ?propkit=old — THE HONEST BEFORE for the batching claim. There was
           never an "old bannerField"; what a page would have done without one
           is build a flag per band, as its own group, as its own draw call.
           So that is what the revert does, and the A/B measures exactly the
           thing the brief asks about: sixty banners, sixty draws, against
           sixty banners, three draws. */
        if (OLD) {
          const one = P.banner(colour, { h: h * (scale || 1), seed: items.length + 1 });
          one.position.set(x, y, z);
          one.scale.setScalar(scale || 1);
          g.add(one);
          items.push({ x: x, y: y, z: z, s: scale || 1, phase: 0, solo: one });
          return one;
        }
        const i = items.length;
        const s = scale || 1;
        d.position.set(x, y + h * 0.5 * s, z); d.rotation.set(0, 0, 0); d.scale.set(s, s, s);
        d.updateMatrix(); pole.setMatrixAt(i, d.matrix);
        d.position.set(x, y + h * s + 0.1 * s, z);
        d.updateMatrix(); finial.setMatrixAt(i, d.matrix);
        if (cloth.setColorAt) {
          c.setHex(colour == null ? 0xc4593a : colour).multiplyScalar(CLOTH_LINEAR);
          for (let k = 0; k < CLOTH_SEG; k++) cloth.setColorAt(i * CLOTH_SEG + k, c);
        }
        const rec = { x: x, y: y, z: z, s: s, phase: (i * 1.937) % TAU };
        items.push(rec);
        pole.count = finial.count = items.length;
        cloth.count = items.length * CLOTH_SEG;
        pole.instanceMatrix.needsUpdate = finial.instanceMatrix.needsUpdate = true;
        if (cloth.instanceColor) cloth.instanceColor.needsUpdate = true;
        api.tick(0, null);
        return rec;
      },
      clear: function () {
        items.length = 0;
        pole.count = finial.count = cloth.count = 0;
      },
      tick: function (t, camPos) {
        if (OLD) return;
        const liveR = opts.liveR || 300;
        const r2 = liveR * liveR;
        for (let i = 0; i < items.length; i++) {
          const it = items[i];
          if (camPos) {
            const dx = it.x - camPos.x, dz = it.z - camPos.z;
            if (dx * dx + dz * dz > r2) continue;
          }
          clothChain(t, it.phase, fly * it.s, 0.22, out);
          for (let k = 0; k < CLOTH_SEG; k++) {
            const o = out[k];
            d.position.set(it.x + o.x, it.y + h * it.s - hoist * 0.55 * it.s + o.y, it.z + o.z);
            d.rotation.set(0, -o.yaw, o.pitch);
            d.scale.set(it.s, it.s, it.s);
            d.updateMatrix();
            cloth.setMatrixAt(i * CLOTH_SEG + k, d.matrix);
          }
        }
        cloth.instanceMatrix.needsUpdate = true;
      },
    };
    return api;
  };

  /* ============================================================ ROCKS
     Four scraped variants, built lazily and shared by every boulder,
     gabion and rubble pile in the game. Variant 3 is squashed flat: real
     talus is plate-shaped because it splits along bedding, and a field of
     uniform potatoes at a cliff foot reads wrong. ?proprock=box swaps in a
     plain icosahedron for the A/B. */
  const rockGeos = [];
  function rockGeo(i) {
    i = i % 4;
    if (rockGeos[i]) return rockGeos[i];
    rockGeos[i] = NO_ROCK
      ? new THREE.IcosahedronGeometry(1, 1)
      : scrapeRock(1, 9001 + i * 137, 1, i === 3 ? { squashY: 0.40, scrapes: 11 } : null);
    return rockGeos[i];
  }

  /* ============================================================ COVER
     The things a man hides behind. Every one of these is sized against
     combat_iq's thresholds, not against a photograph.

     `cover(kind)` builds ONE. `coverField(list)` builds a battlefield's
     worth in a handful of draw calls, which is what battle.js should call:
     it hands out ~34 cover boxes today and draws each as its own rotated
     box mesh — 34 draw calls of grey cube. */
  /* NINE KINDS WENT IN AND FOUR CAME OUT, and the deletion is the point.
     `cover(kind)` has exactly one caller that matters — coverField(), which is
     handed desert.js's battlefieldAt().cover — and after the 2026-09-04 pass
     that removed the scattered boxes from every open biome, the only kinds a
     battlefield can now ASK for are "slab" (a rock-country outcrop) and "palm"
     (an oasis tree). "boulder" stays because it is the default fallthrough for
     an un-named kind and it is what coverField instances; "bank" stays as the
     one hand-built terrain-shaped piece a future biome could want.

     sandbag / gabion / barricade / ruin / crate are GONE from this switch.
     They were never reachable: COVER_BY_BIOME never named one, so the only
     thing that ever built them was the gallery row below, photographing five
     pieces of cover no fight in this game could contain. The BUILDERS behind
     three of them are alive and busy — P.sandbags, P.gabion and P.crates are
     what outposts, camps, markets and depots are made of — so what is deleted
     here is the routing, not the geometry — ruin() in particular still draws
     the half-fallen mud-brick wall at the well and in the market, so only its
     cover ROUTE is gone. barricade() had no other caller at all and is deleted
     outright. */
  const COVER_KINDS = ["boulder", "slab", "bank", "palm"];
  P.coverKinds = COVER_KINDS.slice();

  P.cover = function (kind, opts) {
    opts = opts || {};
    const w = opts.w || 2.2, h = opts.h || 1.4, d = opts.d || 2.0;
    if (OLD) {
      // battle.js's own rockMesh, verbatim in spirit: one rotated grey box
      const g = new THREE.Group();
      const m = box(g, w, h, d, M("rock"), 0, h / 2, 0, W.hash01(w, d, 3) * Math.PI);
      m.castShadow = m.receiveShadow = true;
      g.userData.colliders = []; col(g.userData.colliders, 0, h / 2, 0, w, h, d, kind || "cover", m.rotation.y);
      return g;
    }
    const r = stream(opts.seed == null ? Math.round(w * 97 + h * 31 + d * 7) : opts.seed);
    switch (kind) {
      case "palm":      return P.palm({ h: h, seed: opts.seed });
      case "bank":      return bank(w, h, d, r);
      case "slab":      return boulder(w, h, d, r, true);
      default:          return boulder(w, h, d, r, false);
    }
  };

  function boulder(w, h, d, r, slab) {
    const g = new THREE.Group();
    const v = slab ? 3 : Math.floor(r.f() * 3);
    const m = new THREE.Mesh(rockGeo(v), M(r.chance(0.5) ? "rock" : "rockDark"));
    m.scale.set(w / 2, h / (slab ? 0.9 : 2), d / 2);
    m.rotation.set(r.range(-0.18, 0.18), r.f() * TAU, r.range(-0.18, 0.18));
    m.position.y = h * (slab ? 0.34 : 0.42);
    m.castShadow = m.receiveShadow = true;
    g.add(m);
    // spall at the foot: real boulders sit in their own broken-off rubble,
    // and a boulder with a clean line where it meets sand reads as dropped in
    const n = 4 + Math.floor(r.f() * 4);
    const im = new THREE.InstancedMesh(rockGeo(3), M("rockDark"), n);
    const dm = new THREE.Object3D();
    for (let i = 0; i < n; i++) {
      const a = r.f() * TAU, rr = (w + d) * 0.25 * r.range(0.75, 1.3);
      dm.position.set(Math.cos(a) * rr, r.range(0.04, 0.18), Math.sin(a) * rr);
      dm.rotation.set(r.f() * TAU, r.f() * TAU, r.f() * TAU);
      dm.scale.setScalar(r.range(0.12, 0.34) * Math.max(0.6, w * 0.3));
      dm.updateMatrix(); im.setMatrixAt(i, dm.matrix);
    }
    im.instanceMatrix.needsUpdate = true;
    im.castShadow = true;
    g.add(im);
    g.userData.colliders = [];
    // the rock is turned; its box turns with it (a 3 x 2 m boulder at 60
    // degrees used to be solid across the wrong 3 m)
    col(g.userData.colliders, 0, h / 2, 0, w * 0.86, h, d * 0.86, slab ? "slab" : "boulder", m.rotation.y);
    g.userData.meshCollider = m;          // the rock itself, not the spall at its foot
    return g;
  }

  // a wadi bank: a long low wedge of packed sand, cut on one face
  function bank(w, h, d, r) {
    const g = new THREE.Group();
    const t = [];
    const seg = 6;
    for (let i = 0; i < seg; i++) {
      const u0 = i / seg, u1 = (i + 1) / seg;
      const x0 = (u0 - 0.5) * w, x1 = (u1 - 0.5) * w;
      const h0 = h * (0.55 + 0.45 * Math.sin(u0 * Math.PI)) * r.range(0.9, 1.1);
      const h1 = h * (0.55 + 0.45 * Math.sin(u1 * Math.PI)) * r.range(0.9, 1.1);
      const zb = d / 2, zf = -d / 2;
      // cut face (front), slope (back), top
      t.push(x0, 0, zf, x1, 0, zf, x1, h1, zf);
      t.push(x0, 0, zf, x1, h1, zf, x0, h0, zf);
      t.push(x0, h0, zf, x1, h1, zf, x1, 0, zb);
      t.push(x0, h0, zf, x1, 0, zb, x0, 0, zb);
    }
    const m = new THREE.Mesh(soup(t), M("sandDark"));
    m.castShadow = m.receiveShadow = true;
    g.add(m);
    g.userData.colliders = [];
    col(g.userData.colliders, 0, h / 2, -d * 0.25, w, h, d * 0.5, "bank");
    return g;
  }



  // a ruined mud-brick wall — three stumps of different heights with a
  // collapsed gap and rubble. The gap matters: it is a firing port, and it
  // is the reason a ruin plays differently from a rock of the same size.
  /* THE WALL IS MUD BRICK AND IT BROKE LIKE MUD BRICK. It was three
     sand-coloured slabs, each with a paler slab balanced on top as "a broken
     course", and eight sand-coloured boxes lying around. Now each stump is
     the mudbrick surface (courses, joints, a few scabs of plaster left) and
     its top steps down in brick-course heights the way a collapsing wall
     actually sheds, loose bricks in a spill at its foot, half sunk. */
  function ruin(w, h, d, r) {
    const g = new THREE.Group();
    const segs = 3, th = d * 0.5, C = 0.12;
    for (let i = 0; i < segs; i++) {
      const u = (i + 0.5) / segs;
      const sh = Math.max(0.6, h * r.range(0.45, 1.05));
      const sw = (w / segs) * r.range(0.72, 0.98);
      if (i === 1 && r.chance(0.55)) continue;          // the breach
      const cx = (u - 0.5) * w;
      const body = sh - 3 * C;
      box(g, sw, body + 0.3, th, M("mudbrick"), cx, (body - 0.3) / 2, 0).receiveShadow = true;
      // the stepped top: three courses, each shorter, each off to one side
      let lo = cx - sw / 2, hi = cx + sw / 2;
      for (let k = 0; k < 3; k++) {
        const cut = sw * r.range(0.12, 0.3);
        if (r.chance(0.5)) lo += cut; else hi -= cut;
        if (hi - lo < 0.3) break;
        box(g, hi - lo, C, th, M("mudbrick"), (lo + hi) / 2, body + C * k + C / 2, 0);
      }
    }
    // the spill: loose bricks at the foot, on either face, half in the sand
    const n = 22;
    const im = new THREE.InstancedMesh(BG(0.38, 0.11, 0.19), M("mudbrick"), n);
    const dm = new THREE.Object3D();
    for (let i = 0; i < n; i++) {
      const side = r.chance(0.5) ? 1 : -1;
      dm.position.set(r.range(-w / 2, w / 2), r.range(0.0, 0.05), side * (th / 2 + r.range(0.1, 0.9)));
      dm.rotation.set(r.range(-0.4, 0.4), r.f() * TAU, r.range(-0.4, 0.4));
      dm.scale.setScalar(r.range(0.7, 1.1));
      dm.updateMatrix(); im.setMatrixAt(i, dm.matrix);
    }
    im.instanceMatrix.needsUpdate = true;
    im.castShadow = true; im.receiveShadow = true;
    g.add(im);
    g.userData.colliders = [];
    col(g.userData.colliders, -w / 3, h / 2, 0, w / 3, h * 0.8, d * 0.5, "ruin");
    col(g.userData.colliders, w / 3, h / 2, 0, w / 3, h * 0.8, d * 0.5, "ruin");
    return g;
  }

  /* A WHOLE BATTLEFIELD'S COVER IN A HANDFUL OF DRAW CALLS.
     list: [{x,y,z,w,h,d,yaw,kind}] in the caller's local frame — exactly the
     shape desert.js's battlefieldAt().cover already hands out. Boulders and
     slabs, which are the bulk, go into per-variant InstancedMeshes; the
     built kinds (bank, palm) build individually and are then
     merged by core/batch.js. Returns {group, colliders} where colliders is
     already in the same local frame, so battle.js registers them itself
     rather than this file guessing which frame it is in. */
  P.coverField = function (list, opts) {
    opts = opts || {};
    const g = new THREE.Group();
    const colliders = [];
    const rockBuckets = [[], [], [], []];
    const rubble = [];
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      const kind = c.kind || "boulder";
      const seed = Math.round((c.x * 131 + c.z * 977 + i * 17)) | 0;
      if (!OLD && (kind === "boulder" || kind === "slab")) {
        const r = stream(seed);
        const v = kind === "slab" ? 3 : Math.floor(r.f() * 3);
        const rc = { x: c.x, y: (c.y || 0) + c.h / 2, z: c.z, w: c.w * 0.86, h: c.h, d: c.d * 0.86, tag: kind };
        rockBuckets[v].push({ c: c, r: r, slab: kind === "slab", col: rc });
        colliders.push(rc);
        for (let k = 0; k < 4; k++) {
          const a = r.f() * TAU, rr = (c.w + c.d) * 0.25 * r.range(0.8, 1.3);
          rubble.push({ x: c.x + Math.cos(a) * rr, y: (c.y || 0) + 0.1, z: c.z + Math.sin(a) * rr,
                        s: r.range(0.14, 0.4) * Math.max(0.7, c.w * 0.3),
                        rx: r.f() * TAU, ry: r.f() * TAU, rz: r.f() * TAU });
        }
        continue;
      }
      const sub = P.cover(kind, { w: c.w, h: c.h, d: c.d, seed: seed });
      sub.position.set(c.x, c.y || 0, c.z);
      sub.rotation.y = c.yaw || 0;
      g.add(sub);
      const sc = sub.userData.colliders || [];
      const cy = Math.cos(sub.rotation.y), sy = Math.sin(sub.rotation.y);
      for (let k = 0; k < sc.length; k++) {
        const q = sc[k];
        colliders.push({
          x: c.x + q.x * cy + q.z * sy, y: (c.y || 0) + q.y, z: c.z - q.x * sy + q.z * cy,
          w: q.w, h: q.h, d: q.d, tag: q.tag, yaw: sub.rotation.y + (q.yaw || 0),
        });
      }
    }
    const d = new THREE.Object3D();
    for (let v = 0; v < 4; v++) {
      const b = rockBuckets[v];
      if (!b.length) continue;
      const im = new THREE.InstancedMesh(rockGeo(v), M(v & 1 ? "rockDark" : "rock"), b.length);
      for (let i = 0; i < b.length; i++) {
        const c = b[i].c, r = b[i].r, slab = b[i].slab;
        d.position.set(c.x, (c.y || 0) + c.h * (slab ? 0.34 : 0.42), c.z);
        d.rotation.set(r.range(-0.18, 0.18), (c.yaw || 0) + r.f() * TAU, r.range(-0.18, 0.18));
        d.scale.set(c.w / 2, c.h / (slab ? 0.9 : 2), c.d / 2);
        b[i].col.yaw = d.rotation.y;      // the rock's own turn is its collider's
        d.updateMatrix(); im.setMatrixAt(i, d.matrix);
      }
      im.instanceMatrix.needsUpdate = true;
      im.castShadow = im.receiveShadow = true;
      g.add(im);
    }
    if (rubble.length) {
      const im = new THREE.InstancedMesh(rockGeo(3), M("rockDark"), rubble.length);
      for (let i = 0; i < rubble.length; i++) {
        const q = rubble[i];
        d.position.set(q.x, q.y, q.z);
        d.rotation.set(q.rx, q.ry, q.rz);
        d.scale.setScalar(q.s);
        d.updateMatrix(); im.setMatrixAt(i, d.matrix);
      }
      im.instanceMatrix.needsUpdate = true;
      im.castShadow = true;
      g.add(im);
    }
    settle(g);
    g.userData.colliders = colliders;
    return { group: g, colliders: colliders };
  };

  /* ============================================================ WRECKS
     What makes an empty desert read as a place with a history instead of a
     noise function. Five kinds, and four of them are the repo's OWN shipped
     models put through the same three-step wreck: TILT it off level, SINK it
     so the sand has taken the wheels, and CHAR every material it owns.

     CHARRING IS A CLONE, never an in-place write. milModels hands back
     meshes sharing the module's cached materials; darkening those would
     blacken every truck in the engine, including the ones a live mode is
     driving. Measured the cheap way: one shared clone per source material
     per wreck, so a truck wreck adds ~6 materials, not 60. */
  const WRECK_KINDS = ["truck", "plane", "tank", "caravan", "bones"];
  P.wreckKinds = WRECK_KINDS.slice();

  function charify(root, amount) {
    const seen = new Map();
    root.traverse(function (o) {
      if (!o.material || Array.isArray(o.material)) return;
      const src = o.material;
      let m = seen.get(src);
      if (!m) {
        m = src.clone();
        if (m.color) {
          // toward the char colour first, THEN down. Multiplying alone kept
          // the tank's olive hue and just made it a darker olive — it read as
          // a tank in shadow, not a burnt one. Burnt things lose their hue.
          m.color.lerp(new THREE.Color(COL.char), amount);
          m.color.multiplyScalar(1 - amount * 0.5);
        }
        if (m.emissive) m.emissive.setHex(0x000000);
        m._shared = false;
        seen.set(src, m);
      }
      o.material = m;
      o.castShadow = true;
    });
    return seen.size;
  }

  P.wreck = function (kind, opts) {
    opts = opts || {};
    kind = WRECK_KINDS.indexOf(kind) >= 0 ? kind : "truck";
    const g = new THREE.Group();
    const r = stream(opts.seed);
    g.userData.colliders = [];
    g.userData.wreckKind = kind;

    if (kind === "bones") { bonesInto(g, r); settle(g); return g; }
    if (kind === "caravan") { caravanInto(g, r, opts); settle(g); return g; }

    // scorch: a dark disc under everything. Cheap, and it is what says
    // "burned" from above, where the campaign camera actually looks.
    if (!OLD) {
      const R0 = kind === "plane" ? 15 : 7.0;
      /* A SHALLOW DOME, and the first draft had it upside down. It was a
         DISH — rim at +0.02, middle at -0.22 — which is what a burnt-out
         vehicle really scours out, and on the gallery's flat pad the middle
         went UNDER the ground and the scorch mark photographed as a thin
         ring with nothing inside it. Any decal on procedural terrain has to
         bulge UP, never down: +0.06 in the middle to +0.005 at the rim rides
         over a dune instead of sinking into it. */
      const disc = new THREE.Mesh(dishGeo(R0, 0.005, 0.06, 16), M("char"));
      disc.receiveShadow = true;
      g.add(disc);
    }

    const MODEL = { truck: "truck", tank: "tank", plane: "cargo" };
    const sink = { truck: 0.35, tank: 0.85, plane: 0.6 }[kind];
    const tilt = { truck: 0.16, tank: 0.09, plane: 0.22 }[kind];
    const shell = new THREE.Group();
    g.add(shell);

    function fill() {
      let m = OLD ? null : milModel(MODEL[kind]);
      if (m) {
        shell.add(m);
        seat(m, sink);
        // 0.85, not 0.5. At 0.5 the shipped tank photographed as a tank in
        // shadow — still recognisably olive — because the page's over-bright
        // lighting and ACES lift a dark colour a long way back up. A burnt
        // thing has no hue left in it at all.
        charify(m, kind === "tank" ? 0.85 : 0.88);
        breakOff(m, r);
        shell.userData.real = true;
      } else {
        primitiveWreck(shell, kind, r);
        shell.userData.real = false;
      }
      shell.rotation.set(tilt * r.range(-1, 1), r.f() * TAU, tilt * r.range(0.4, 1));
      // debris, always ours: the model does not come pre-broken
      debrisInto(g, r, kind === "plane" ? 20 : 9, kind === "plane" ? 20 : 9);
    }

    /* SOMETHING HAS TO BE MISSING. The first pass tilted the shipped model,
       sank it and charred it, and photographed as a PARKED tank with a dark
       paint job. A wreck is a thing with a piece torn off, so one or two of
       the model's own sub-assemblies get displaced and dropped on the sand
       beside it.

       WHICH ones is measured, not guessed: only children whose bounding
       volume is under a quarter of the whole are eligible, so the pass can
       take a wing, a gear leg, a turret or a hatch and can never take the
       fuselage and leave the wheels floating. If the model is one welded
       mesh nothing happens and the tilt/char/debris still carry it. */
    function breakOff(model, rr) {
      const kids = model.children.slice();
      if (kids.length < 3) return 0;
      const whole = new THREE.Box3().setFromObject(model);
      const wv = Math.max(1e-3, (whole.max.x - whole.min.x) * (whole.max.y - whole.min.y) * (whole.max.z - whole.min.z));
      const cand = [];
      const bb = new THREE.Box3();
      for (let i = 0; i < kids.length; i++) {
        bb.setFromObject(kids[i]);
        if (!isFinite(bb.min.x)) continue;
        const v = (bb.max.x - bb.min.x) * (bb.max.y - bb.min.y) * (bb.max.z - bb.min.z);
        if (v > 0 && v < wv * 0.25) cand.push(kids[i]);
      }
      if (!cand.length) return 0;
      const n = Math.min(cand.length, 1 + Math.floor(rr.f() * 2));
      for (let i = 0; i < n; i++) {
        const k = cand[Math.floor(rr.f() * cand.length) % cand.length];
        const a = rr.f() * TAU, d = rr.range(3.5, 9);
        k.position.x += Math.cos(a) * d;
        k.position.z += Math.sin(a) * d;
        k.position.y = -whole.min.y - 0.2;      // dropped, lying on the sand
        k.rotation.set(rr.range(-0.6, 0.6), rr.f() * TAU, rr.range(1.0, 2.2));
      }
      return n;
    }
    if (OLD || milState === "ready" || milState === "absent") fill();
    else onMil(function () { fill(); settle(shell); });

    // COLLIDERS ARE DECLARED, NOT MEASURED. They are gameplay — the cover a
    // man takes behind a dead truck — and they must be identical whether the
    // real model landed or the primitive did, or the fight changes shape
    // depending on a download.
    const CBOX = {
      truck: [[0, 1.0, 0, 6.4, 2.0, 2.6]],
      tank:  [[0, 1.1, 0, 7.2, 2.2, 3.4]],
      plane: [[0, 1.6, 0, 5.0, 3.2, 22.0], [0, 1.0, -9, 3.0, 2.0, 6.0]],
    }[kind];
    for (let i = 0; i < CBOX.length; i++) {
      const b = CBOX[i];
      col(g.userData.colliders, b[0], b[1], b[2], b[3], b[4], b[5], kind);
    }
    settle(g);
    return g;
  };

  // the fallback body when the military pack is absent. Not a good truck —
  // a deliberately blunt one, so the difference is visible in the A/B and
  // nobody mistakes it for the shipped model.
  function primitiveWreck(shell, kind, r) {
    if (kind === "truck") {
      box(shell, 6.0, 1.5, 2.4, M("char"), 0, 0.95, 0);
      box(shell, 2.0, 1.3, 2.3, M("char"), 2.2, 1.9, 0);
      for (let i = 0; i < 4; i++) {
        cyl(shell, 0.55, 0.55, 0.36, 8, M("char"), (i < 2 ? 1.9 : -1.7), 0.5, (i % 2 ? 1.2 : -1.2), 0, 0, Math.PI / 2);
      }
    } else if (kind === "tank") {
      box(shell, 6.4, 1.1, 3.2, M("char"), 0, 0.9, 0);
      box(shell, 3.0, 0.9, 2.4, M("char"), -0.3, 1.85, 0);
      cyl(shell, 0.13, 0.16, 4.4, 8, M("char"), 1.9, 2.0, 0, 0, 0, Math.PI / 2);
      box(shell, 6.6, 0.7, 0.7, M("char"), 0, 0.5, 1.5);
      box(shell, 6.6, 0.7, 0.7, M("char"), 0, 0.5, -1.5);
    } else {
      box(shell, 4.0, 3.0, 20, M("char"), 0, 2.0, 0);
      box(shell, 22, 0.4, 3.4, M("char"), 0, 3.0, 1.5, 0, 0, r.range(-0.2, 0.2));
      box(shell, 0.4, 4.0, 3.0, M("char"), 0, 4.0, -8.5);
    }
  }

  /* THE WRECK'S OWN SKIN ON THE SAND. What lies round a burnt-out truck or a
     downed plane is torn panel: thin plates of its charred body with ragged
     outlines and a crease where they folded, a few centimetres thick, half
     sunk in the sand. Every plate is its own irregular outline (5-7 torn
     corners), one merged static mesh per wreck (one draw call). It used to be
     one 0.9 x 0.14 x 0.6 box instanced n times: a scatter of charred bricks
     round a vehicle made of sheet metal. */
  function debrisInto(g, r, n, spread) {
    const P = [];
    const d = new THREE.Object3D(), v = new THREE.Vector3();
    const put = function (x, y, z) { v.set(x, y, z).applyMatrix4(d.matrix); P.push(v.x, v.y, v.z); };
    for (let i = 0; i < n; i++) {
      const k = 5 + Math.floor(r.f() * 3);
      const sc = r.range(0.6, 1.5);
      const ax = r.range(0.35, 0.8) * sc, az = r.range(0.2, 0.5) * sc;
      const ring = [];
      for (let j = 0; j < k; j++) {
        const t = (j / k) * TAU + r.range(-0.3, 0.3), rr = r.range(0.55, 1);
        ring.push([Math.cos(t) * ax * rr, Math.sin(t) * az * rr]);
      }
      const th = r.range(0.02, 0.05), crease = r.range(-0.3, 0.3);
      const Y = function (x) { return crease * Math.abs(x); };
      const a = r.f() * TAU, dist = r.range(spread * 0.3, spread);
      d.position.set(Math.cos(a) * dist, 0.02, Math.sin(a) * dist);
      d.rotation.set(r.range(-0.25, 0.25), r.f() * TAU, r.range(-0.25, 0.25));
      d.scale.set(1, 1, 1);
      d.updateMatrix();
      for (let j = 0; j < k; j++) {
        const p0 = ring[j], p1 = ring[(j + 1) % k];
        // top and bottom faces (fans from the plate centre)
        put(0, th / 2, 0); put(p1[0], Y(p1[0]) + th / 2, p1[1]); put(p0[0], Y(p0[0]) + th / 2, p0[1]);
        put(0, -th / 2, 0); put(p0[0], Y(p0[0]) - th / 2, p0[1]); put(p1[0], Y(p1[0]) - th / 2, p1[1]);
        // the torn edge
        put(p0[0], Y(p0[0]) + th / 2, p0[1]); put(p1[0], Y(p1[0]) + th / 2, p1[1]); put(p1[0], Y(p1[0]) - th / 2, p1[1]);
        put(p0[0], Y(p0[0]) + th / 2, p0[1]); put(p1[0], Y(p1[0]) - th / 2, p1[1]); put(p0[0], Y(p0[0]) - th / 2, p0[1]);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, M("char"));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    g.add(mesh);
  }

  /* BONES. Ribs are half-tori — the one shape in this file that is not a box
     or a soup, and the only shape that reads as a ribcage at any distance.
     desert.js's scatter draws a bone as a 0.24×0.24×2.1 box, which is a
     stick; this is what the stick was standing in for. */
  P.bones = function (opts) {
    const g = new THREE.Group();
    bonesInto(g, stream((opts || {}).seed));
    g.userData.colliders = [];
    settle(g);
    return g;
  };
  function bonesInto(g, r) {
    const nrib = 7;
    const spine = r.range(2.6, 4.2);
    for (let i = 0; i < nrib; i++) {
      const u = i / (nrib - 1);
      const rad = 0.85 * (0.55 + Math.sin(u * Math.PI) * 0.65) * r.range(0.9, 1.05);
      const m = new THREE.Mesh(new THREE.TorusGeometry(rad, 0.055, 4, 7, Math.PI * 0.95), M("bone"));
      m.position.set((u - 0.5) * spine, rad * 0.35, 0);
      m.rotation.set(0, Math.PI / 2, r.range(-0.14, 0.14));
      m.castShadow = true;
      g.add(m);
    }
    /* THE SPINE IS VERTEBRAE and the skull is a SKULL. The spine was one
       long bar; the skull was three boxes, two of them standing up off it
       as "ears". A camel's skull is a long narrow cranium running into a
       longer muzzle, eye sockets on the sides, and a lower jaw lying loose
       beside it. */
    for (let i = 0; i < 12; i++) {
      const u = i / 11;
      const v = cyl(g, 0.065, 0.075, 0.13, 6, M("bone"), (u - 0.5) * spine * 1.05, 0.12, r.range(-0.03, 0.03), 0, 0, Math.PI / 2);
      v.rotation.y = r.range(-0.15, 0.15);
    }
    const sk = new THREE.Group();
    const cran = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), M("bone"));
    cran.scale.set(1.4, 0.95, 1.0); cran.position.set(0, 0.18, 0);
    sk.add(cran);
    const muz = new THREE.Mesh(CG(0.09, 0.15, 0.62, 7), M("bone"));
    muz.rotation.z = Math.PI / 2 + 0.12; muz.position.set(0.52, 0.13, 0);
    sk.add(muz);
    for (let s = -1; s <= 1; s += 2) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.065, 6, 4), M("char"));
      eye.position.set(0.14, 0.22, s * 0.17);
      sk.add(eye);
    }
    const jaw = box(sk, 0.78, 0.05, 0.08, M("bone"), 0.45, 0.03, 0.34, r.range(-0.3, 0.3));
    jaw.rotation.z = 0.08;
    sk.position.set(spine * 0.62, 0, r.range(-0.2, 0.2));
    sk.rotation.y = r.range(-0.5, 0.5);
    g.add(sk);
    // scattered long bones: shafts with knuckled ends, half in the sand
    const im = new THREE.InstancedMesh(boneGeo(), M("bone"), 9);
    const d = new THREE.Object3D();
    for (let i = 0; i < 9; i++) {
      const a = r.f() * TAU, rr = r.range(0.8, 3.4);
      d.position.set(Math.cos(a) * rr, 0.03, Math.sin(a) * rr);
      d.rotation.set(0, r.f() * TAU, r.range(-0.1, 0.1));
      d.scale.setScalar(r.range(0.6, 1.5));
      d.updateMatrix(); im.setMatrixAt(i, d.matrix);
    }
    im.instanceMatrix.needsUpdate = true;
    im.castShadow = true;
    g.add(im);
  }

  /* A DEAD CARAVAN. The one wreck with a story in it: a toppled cart, the
     bones of the animals still in the traces, spilled crates, and a strip of
     cloth that never got buried. Nothing in the engine ships this. */
  function caravanInto(g, r, opts) {
    // the cart, on its side
    const cart = new THREE.Group();
    box(cart, 3.2, 0.24, 1.9, M("woodDark"), 0, 0.6, 0);
    box(cart, 3.2, 0.7, 0.14, M("wood"), 0, 0.95, 0.9);
    box(cart, 3.2, 0.7, 0.14, M("wood"), 0, 0.95, -0.9);
    box(cart, 0.14, 0.7, 1.9, M("wood"), -1.6, 0.95, 0);
    for (let s = -1; s <= 1; s += 2) {
      const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.09, 4, 10), M("woodDark"));
      wheel.position.set(0.2, 0.72, s * 1.05);
      wheel.rotation.y = Math.PI / 2;
      wheel.castShadow = true;
      cart.add(wheel);
      for (let k = 0; k < 6; k++) {
        box(cart, 1.36, 0.07, 0.07, M("woodDark"), 0.2, 0.72, s * 1.05, 0, 0, k * Math.PI / 6)
          .rotation.set(0, Math.PI / 2, k * Math.PI / 6);
      }
    }
    // shafts, pointing where the animals were
    box(cart, 2.6, 0.1, 0.1, M("post"), -2.7, 0.7, 0.4);
    box(cart, 2.6, 0.1, 0.1, M("post"), -2.7, 0.7, -0.4);
    cart.rotation.set(r.range(0.9, 1.25), r.range(-0.3, 0.3), 0);
    cart.position.y = 0.35;
    g.add(cart);
    // the animals, in the traces
    for (let i = 0; i < 2; i++) {
      const b = new THREE.Group();
      bonesInto(b, stream(((opts && opts.seed) || 1) * 31 + i * 7));
      b.position.set(-5.4 - i * 0.4, 0, (i ? 1 : -1) * r.range(0.6, 1.2));
      b.rotation.y = r.range(-0.4, 0.4);
      b.scale.setScalar(0.8);
      g.add(b);
    }
    // spilled cargo and a strip of cloth
    const cr = P.crates({ n: 6, spread: 2.0, seed: ((opts && opts.seed) || 1) * 13 });
    cr.position.set(1.8, 0, 1.4);
    g.add(cr);
    const cloth = new THREE.Mesh(sagGeo(2.4, 1.6, 0.3, 3), MD("canvas"));
    cloth.position.set(2.6, 0.22, -1.6);
    cloth.rotation.set(0, r.f() * TAU, 0.06);
    g.add(cloth);
    col(g.userData.colliders, 0, 0.9, 0, 3.2, 1.8, 2.0, "caravan");
  }

  /* ============================================================ CAMP KIT
     Your own army's camp when you rest. This is the only prop set in the
     file the player OWNS, so it is the only one that scales with something:
     `men` decides how many bedrolls and fires there are, because a camp for
     six and a camp for two hundred should not be the same picture. */
  P.bivouac = function (opts) {
    opts = opts || {};
    const men = Math.max(1, opts.men || 8);
    const g = new THREE.Group();
    const r = stream(opts.seed);
    g.userData.colliders = [];
    const near = new THREE.Group(); g.add(near);

    const fires = Math.max(1, Math.min(6, Math.round(Math.sqrt(men) / 1.6)));
    const R = 3.0 + Math.sqrt(men) * 0.9;
    for (let i = 0; i < fires; i++) {
      const a = i / fires * TAU + 0.4;
      const f = P.fire({ seed: (opts.seed || 1) * 17 + i, smokeH: 9 });
      f.position.set(Math.cos(a) * R * 0.55, 0, Math.sin(a) * R * 0.55);
      near.add(f);
      /* BEDROLLS, and the first pass drew them as 2.0 x 0.72 flat slabs all
         at the same radius, which photographed as a wheel of white planks
         radiating off each fire — a diagram of a camp, not a camp. A bedroll
         is a rolled blanket: a low cylinder lying down, with a lump at the
         head where the pack is, at a scattered radius. */
      const per = Math.min(7, Math.ceil(men / fires));
      for (let k = 0; k < per; k++) {
        const b = k / per * TAU + r.range(-0.35, 0.35);
        const rr = 1.9 + r.range(0, 1.1);
        const roll = new THREE.Group();
        /* LAID OUT FOR THE NIGHT, FEET TO THE FIRE. These were rolled
           bundles lying sideways round the fire with square leather plates
           for straps sticking out past the roll. A camp at rest has its
           bedding spread: a groundsheet and blanket, a pack at the head,
           and the head away from the flames. */
        const sheet = new THREE.Mesh(pillowGeo(1.95, 0.08, 0.8), M(k % 2 ? "canvasDark" : "canvas"));
        sheet.position.set(0, 0.04, 0);
        roll.add(sheet);
        const blanket = new THREE.Mesh(pillowGeo(1.15, 0.07, 0.84), M(k % 3 ? "hide" : "burlap"));
        blanket.position.set(-0.36, 0.1, 0.02);
        blanket.rotation.y = r.range(-0.06, 0.06);
        roll.add(blanket);
        const pack = new THREE.Mesh(pillowGeo(0.46, 0.32, 0.4), M("burlap"));
        pack.position.set(1.1, 0.16, 0);
        pack.rotation.y = r.range(-0.3, 0.3);
        roll.add(pack);
        roll.traverse(function (o) { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
        roll.position.set(f.position.x + Math.cos(b) * rr, 0, f.position.z + Math.sin(b) * rr);
        roll.rotation.y = -b + r.range(-0.2, 0.2);
        near.add(roll);
      }
    }
    // STACKED ARMS — the real rifles. Three guns leaning muzzle-up in a
    // tripod is the oldest picture of an army at rest there is, and this
    // repo already ships the rifle.
    const stacks = Math.max(1, Math.round(men / 12));
    for (let s = 0; s < stacks; s++) {
      const a = (s + 0.5) / stacks * TAU;
      const st = P.armStack({ seed: (opts.seed || 1) * 91 + s, id: r.chance(0.5) ? "ak47" : "carbine" });
      st.position.set(Math.cos(a) * R * 0.92, 0, Math.sin(a) * R * 0.92);
      st.rotation.y = r.f() * TAU;
      near.add(st);
    }
    // the picket line: two posts and a rope, for whatever mounts.js parks here
    const pl = new THREE.Group();
    const span = 3.5 + Math.min(9, men * 0.25);
    cyl(pl, 0.09, 0.11, 1.7, 5, M("post"), -span / 2, 0.85, 0);
    cyl(pl, 0.09, 0.11, 1.7, 5, M("post"), span / 2, 0.85, 0);
    const rope = box(pl, span, 0.05, 0.05, M("rope"), 0, 1.5, 0);
    rope.castShadow = false;
    pl.position.set(0, 0, -R * 0.98);
    near.add(pl);
    // the cart your baggage lives in
    const cart = new THREE.Group();
    box(cart, 2.8, 0.18, 1.5, M("woodDark"), 0, 0.78, 0);
    box(cart, 2.8, 0.5, 0.12, M("wood"), 0, 1.05, 0.7);
    box(cart, 2.8, 0.5, 0.12, M("wood"), 0, 1.05, -0.7);
    box(cart, 0.12, 0.5, 1.5, M("wood"), -1.4, 1.05, 0);
    for (let s = -1; s <= 1; s += 2) {
      const wl = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.09, 4, 12), M("woodDark"));
      wl.position.set(0.15, 0.72, s * 0.86); wl.rotation.y = Math.PI / 2; wl.castShadow = true;
      cart.add(wl);
      for (let k = 0; k < 5; k++) {
        const sp = box(cart, 1.34, 0.07, 0.07, M("woodDark"), 0.15, 0.72, s * 0.86);
        sp.rotation.set(0, Math.PI / 2, k * Math.PI / 5);
      }
    }
    // shafts, so it reads as a CART and not a crate on wheels
    box(cart, 2.2, 0.09, 0.09, M("post"), -2.5, 0.62, 0.4);
    box(cart, 2.2, 0.09, 0.09, M("post"), -2.5, 0.62, -0.4);
    // the load: a tarpaulin over it, sagging, not a lid
    const load = new THREE.Mesh(sagGeo(2.6, 1.5, 0.35, 3), MD("canvas"));
    load.position.set(0, 1.35, 0);
    load.castShadow = true;
    cart.add(load);
    cart.position.set(R * 1.05, 0, R * 0.45);
    cart.rotation.y = r.f() * TAU;
    near.add(cart);
    col(g.userData.colliders, cart.position.x, 0.85, cart.position.z, 3.0, 1.7, 2.2, "cart");

    if (opts.banner !== false) {
      // 6 m, not 8.5: in a nine-metre camp an eight-and-a-half-metre mast is
      // the only thing in the photograph.
      const b = P.banner(opts.colour == null ? 0xd9b979 : opts.colour, { h: 6.0, seed: opts.seed || 1 });
      b.position.set(0, 0, R * 0.25);
      g.add(b);
    }
    settle(near);
    return g;
  };

  /* Three real rifles, stacked. Reaches straight into CBZ.weaponAppearance,
     which is the table every appearance file registers into and which THIS
     page already loads for the battle. systems/actorweapons.js keeps its own
     buildActorWeapon() private, so the four-helper ctx those factories take
     (box, cyl, mat, THREE) is rebuilt here — twelve lines against forking a
     rifle, which is the trade the armoury doctrine asks for. */
  let _gunCtx = null;
  function gunCtx() {
    if (_gunCtx) return _gunCtx;
    const gm = {
      dark: M("metalDark"), black: M("char"), bore: M("char"), steel: M("metal"),
      worn: M("metal"), tan: M("wood"), polymer: M("metalDark"), brass: M("rust"),
      redShell: M("boxRed"), skin: M("metalDark"),
    };
    _gunCtx = {
      THREE: THREE, mat: gm,
      box: function (p, sx, sy, sz, m, x, y, z, rx, ry, rz) {
        const o = new THREE.Mesh(BG(sx, sy, sz), m || gm.dark);
        o.position.set(x || 0, y || 0, z || 0); o.rotation.set(rx || 0, ry || 0, rz || 0);
        o.castShadow = true; p.add(o); return o;
      },
      cyl: function (p, rr, len, m, x, y, z, rx, ry, rz) {
        const o = new THREE.Mesh(CG(rr, rr, len, 8), m || gm.dark);
        o.position.set(x || 0, y || 0, z || 0); o.rotation.set(rx || 0, ry || 0, rz || 0);
        o.castShadow = true; p.add(o); return o;
      },
    };
    return _gunCtx;
  }
  P.gun = function (id) {
    const f = CBZ.weaponAppearance && CBZ.weaponAppearance[id];
    if (!f) return null;
    try { return f(gunCtx()); } catch (e) { return null; }
  };
  P.armStack = function (opts) {
    opts = opts || {};
    const g = new THREE.Group();
    const r = stream(opts.seed);
    const id = opts.id || "ak47";
    let made = 0;
    for (let i = 0; i < 3; i++) {
      const m = OLD ? null : P.gun(id);
      const a = i / 3 * TAU + r.range(-0.15, 0.15);
      /* A WRAPPER, NOT A THREE-AXIS EULER. The appearance factories author a
         gun lying along -z with the grip at the origin, so standing it up is
         one +X rotation — but THREE's default XYZ Euler applies Y BEFORE X,
         so writing rotation.set(x, yaw, 0) yaws the gun while it is still
         lying down and the tripod comes out flat on the sand. The wrapper
         carries the yaw, the gun carries the stand-up, and the order is
         unambiguous. Rx(+pi/2) sends -z (the muzzle) to +y and +z (the butt)
         to the ground; the 0.30 short of vertical is the lean that makes
         three of them hold each other up. */
      const wrap = new THREE.Group();
      wrap.rotation.y = a;
      g.add(wrap);
      if (m) {
        m.rotation.x = Math.PI / 2 - 0.30;
        m.position.set(0, 0.40, 0.26);
        wrap.add(m);
        made++;
      } else {
        const b = box(wrap, 0.1, 1.05, 0.1, M("woodDark"), 0, 0.52, 0.26);
        b.rotation.x = -0.30;
      }
    }
    g.userData.realGuns = made;
    g.userData.colliders = [];
    return g;
  };

  /* ============================================================ HOUSES
     THE WARLORD'S OWN HOUSES, hollow and furnished.

     WHAT WAS HERE: city/villagekit.js's three huts, recoloured. Each was ONE
     solid primitive for the walls (a 10-sided cylinder or a 3.3 m box), a
     cone or a slab on top, and a black door-shaped plate stuck on the
     front. villagekit's colliders had a doorway gap, so you could walk in,
     and walking in put you INSIDE a closed box whose walls vanish from the
     inside (single-sided), looking out at the desert through them, standing
     on a bedroll made of four more boxes. From outside they were one flat
     colour each. That is the slop the owner described.

     WHAT IS HERE NOW, three kinds, same ids so every caller keeps working:
       hut_square  a flat-roofed adobe house: 34 cm mud-brick walls under
                   plaster (the adobe surface), a real doorway with a timber
                   lintel and a plank door standing open, barred windows,
                   roof beams (vigas) running through the walls and out, a
                   parapet, and a 2.75 m room inside.
       hut_round   a rondavel: a sixteen-sided mud wall with the door as the
                   missing facet, a lapped thatch cone (two-sided, so it is a
                   ceiling from inside) on rafters you can see.
       shack_lean  a lean-to of galvanised and rusted sheet on a timber
                   frame, patchwork, a cloth hung in the doorway.
     INSIDE, arranged the way people arrange a room, against the walls and
     clear of the door: a packed-earth floor, a rug, a bed (a mud bench with
     a mattress in the adobe house), water jars in a corner, a low table
     with a tray, cushions, a shelf. Everything shares this file's materials
     and settle() folds a house into its compound's per-material draws.

     THE FRAME: door on local -Z, walls on the ground, `rot` quantised to a
     quarter turn (the colliders are axis-aligned boxes, so a house turned
     45 degrees would have its door in a wall). The floor stands on a plinth
     0.1 m proud of y = 0 and the walls run 0.6 m below it, so hamlet() can
     seat the house at the HIGHEST ground under its footprint and bury the
     rest: no sand ever comes up through a floor.

     `lite: true` (the war map) builds the exterior shell only. */
  const HOUSE_KINDS = ["hut_square", "hut_round", "shack_lean"];
  P.houseKinds = HOUSE_KINDS.slice();
  const WALL_KEYS = ["adobe", "adobe2", "adobe3", "plaster"];
  const FLOOR = 0.1, SINK = -0.6;

  /* A KILIM, painted once per palette onto a canvas: a border, bands, and
     a column of stepped diamonds, in dyes that have been walked on. */
  const _rugMats = [];
  function rugMat(i) {
    i = i % 3;
    if (_rugMats[i]) return _rugMats[i];
    if (typeof document === "undefined") return (_rugMats[i] = M("canvasDark"));
    const PAL = [
      ["#7a2418", "#d6b27a", "#2c3a4a", "#5a1812", "#b8863e"],
      ["#2e3c52", "#caa46a", "#8a2c1e", "#1c2432", "#6f7a5a"],
      ["#6b4a22", "#d8c49a", "#7a2a1c", "#3a2a18", "#a86a2a"],
    ][i];
    const Wd = 64, Ht = 128, c = document.createElement("canvas");
    c.width = Wd; c.height = Ht;
    const g = c.getContext("2d");
    g.fillStyle = PAL[0]; g.fillRect(0, 0, Wd, Ht);
    g.fillStyle = PAL[3]; g.fillRect(0, 0, Wd, 6); g.fillRect(0, Ht - 6, Wd, 6); g.fillRect(0, 0, 5, Ht); g.fillRect(Wd - 5, 0, 5, Ht);
    g.fillStyle = PAL[1];
    for (let y = 8; y < Ht - 8; y += 4) { g.fillRect(6, y, 2, 2); g.fillRect(Wd - 8, y + 2, 2, 2); }
    for (let k = 0; k < 4; k++) {
      const cy = 20 + k * 29;
      g.fillStyle = k % 2 ? PAL[2] : PAL[4];
      for (let s = 0; s < 11; s++) {
        const half = (5 - Math.abs(5 - s)) * 2.4 + 2;
        g.fillRect(Wd / 2 - half, cy - 11 + s * 2, half * 2, 2);
      }
      g.fillStyle = PAL[1];
      g.fillRect(Wd / 2 - 2, cy - 2, 4, 4);
      g.fillStyle = PAL[3]; g.fillRect(9, cy + 13, Wd - 18, 2);
    }
    // wear: the middle walked pale, grit in the weave
    const img = g.getImageData(0, 0, Wd, Ht), d = img.data;
    for (let y = 0; y < Ht; y++) for (let x = 0; x < Wd; x++) {
      const o = (y * Wd + x) * 4;
      const cx = (x - Wd / 2) / Wd, cy = (y - Ht / 2) / Ht;
      const wear = Math.max(0, 1 - (cx * cx * 6 + cy * cy * 3)) * 0.18;
      const grit = (W.hash01(x, y, 91 + i) - 0.5) * 0.16 + ((x + y) % 2 ? 0.03 : -0.03);
      for (let ch = 0; ch < 3; ch++) d[o + ch] = Math.max(0, Math.min(255, d[o + ch] * (1 + grit) + (200 - d[o + ch]) * wear));
    }
    g.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(c);
    tex.encoding = THREE.sRGBEncoding;
    tex.anisotropy = 4;
    // the colour is the linear multiplier every other material in this file
    // is authored at (see the palette): a dyed rug under this sun is not neon
    const m = new THREE.MeshLambertMaterial({ map: tex, color: 0x3c3c3c });
    m._shared = true;
    _rugMats[i] = m;
    return m;
  }
  function rug(parent, w, d, x, z, yaw, i) {
    const m = new THREE.Mesh(BG(w, 0.012, d), rugMat(i));
    m.position.set(x, FLOOR + 0.006, z);
    m.rotation.y = yaw || 0;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  }
  function jarsAt(parent, x, z, n, r) {
    for (let i = 0; i < n; i++) {
      const j = new THREE.Mesh(jarGeo(), M("clay"));
      const a = i * 2.2 + r.f();
      j.position.set(x + Math.cos(a) * 0.26 * (i ? 1 : 0), FLOOR, z + Math.sin(a) * 0.26 * (i ? 1 : 0));
      j.scale.setScalar(i ? 0.82 : 1.1);
      j.castShadow = true; j.receiveShadow = true;
      parent.add(j);
    }
  }
  // a low table: top, four legs, a brass tray and a teapot on it
  function lowTable(parent, x, z, yaw) {
    const t = new THREE.Group();
    box(t, 0.9, 0.05, 0.56, M("wood"), 0, 0.33, 0);
    for (let sx = -1; sx <= 1; sx += 2) for (let sz = -1; sz <= 1; sz += 2) box(t, 0.06, 0.31, 0.06, M("woodDark"), sx * 0.38, 0.155, sz * 0.22);
    cyl(t, 0.2, 0.2, 0.015, 14, M("rust"), 0.1, 0.36, 0);
    const pot = new THREE.Mesh(lathe("teapot", [[0.001, 0], [0.07, 0.005], [0.085, 0.06], [0.06, 0.11],
      [0.03, 0.13], [0.035, 0.15], [0.001, 0.16]], 10), M("metal"));
    pot.position.set(0.1, 0.37, 0);
    t.add(pot);
    for (let i = 0; i < 2; i++) cyl(t, 0.03, 0.024, 0.06, 7, M("clay"), -0.2 + i * 0.12, 0.39, 0.08 - i * 0.14);
    t.position.set(x, FLOOR, z);
    t.rotation.y = yaw || 0;
    parent.add(t);
  }
  function cushion(parent, x, z, yaw, key) {
    const c = new THREE.Mesh(pillowGeo(0.55, 0.18, 0.9), M(key || "canvasDark"));
    c.position.set(x, FLOOR + 0.09, z);
    c.rotation.y = yaw || 0;
    c.castShadow = true; c.receiveShadow = true;
    parent.add(c);
  }
  // a made bed: mattress, a folded blanket over the foot, a pillow at the head
  function bedding(parent, x, y, z, yaw, len) {
    const b = new THREE.Group();
    const L = len || 1.9;
    const mat = new THREE.Mesh(pillowGeo(L, 0.14, 0.82), M("canvas"));
    mat.position.set(0, 0.07, 0);
    b.add(mat);
    const bl = new THREE.Mesh(pillowGeo(L * 0.55, 0.07, 0.86), M("hide"));
    bl.position.set(L * 0.2, 0.15, 0);
    b.add(bl);
    const pl = new THREE.Mesh(pillowGeo(0.5, 0.15, 0.36), M("burlap"));
    pl.position.set(-L / 2 + 0.3, 0.19, 0);
    b.add(pl);
    b.traverse(function (o) { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    b.position.set(x, y, z);
    b.rotation.y = yaw || 0;
    parent.add(b);
  }
  /* a wall run with rectangular openings cut out of it, along local X from
     x0 to x1, at depth z0..z1, from y SINK to top. `holes` = [{a, b, lo, hi}]
     in x and y. The run is emitted as the solid pieces around the holes, so
     a window is an opening you can see through and not a painted square.
     Returns the collider pieces (full height where there is no door). */
  function wallRun(parent, mat, x0, x1, z0, z1, top, holes, CS, alongZ) {
    holes = (holes || []).slice().sort(function (p, q) { return p.a - q.a; });
    const th = z1 - z0, zc = (z0 + z1) / 2;
    const put = function (a, b, lo, hi) {
      if (b - a < 0.01 || hi - lo < 0.01) return;
      const cx = (a + b) / 2, cy = (lo + hi) / 2;
      const m = alongZ ? box(parent, th, hi - lo, b - a, mat, zc, cy, cx) : box(parent, b - a, hi - lo, th, mat, cx, cy, zc);
      m.receiveShadow = true;
    };
    let x = x0;
    for (let i = 0; i < holes.length; i++) {
      const h = holes[i];
      put(x, h.a, SINK, top);
      put(h.a, h.b, SINK, h.lo);
      put(h.a, h.b, h.hi, top);
      x = h.b;
    }
    put(x, x1, SINK, top);
    // colliders: a door (an opening down to the floor) is a gap; a window
    // is still wall as far as a body or a bullet's cover search cares
    if (CS) {
      let cx0 = x0;
      for (let i = 0; i < holes.length; i++) {
        const h = holes[i];
        if (h.lo > FLOOR + 0.05) continue;
        if (h.a - cx0 > 0.05) pushWallCol(CS, cx0, h.a, z0, z1, top, alongZ);
        cx0 = h.b;
      }
      if (x1 - cx0 > 0.05) pushWallCol(CS, cx0, x1, z0, z1, top, alongZ);
    }
  }
  function pushWallCol(CS, a, b, z0, z1, top, alongZ) {
    const h = top - FLOOR;
    if (alongZ) col(CS, (z0 + z1) / 2, FLOOR + h / 2, (a + b) / 2, z1 - z0, h, b - a, "house");
    else col(CS, (a + b) / 2, FLOOR + h / 2, (z0 + z1) / 2, b - a, h, z1 - z0, "house");
  }
  function lintel(parent, x0, x1, y, zFace, t, alongZ) {
    const len = x1 - x0 + 0.36, cx = (x0 + x1) / 2;
    if (alongZ) box(parent, t + 0.06, 0.16, len, M("post"), zFace, y + 0.08, cx);
    else box(parent, len, 0.16, t + 0.06, M("post"), cx, y + 0.08, zFace);
  }
  // three wooden bars in a window, so it is a window and not a hole
  function bars(parent, a, b, lo, hi, zc, alongZ) {
    for (let i = 1; i <= 3; i++) {
      const u = a + (b - a) * i / 4;
      const p0 = alongZ ? [zc, lo, u] : [u, lo, zc], p1 = alongZ ? [zc, hi, u] : [u, hi, zc];
      rod(parent, 0.025, 0.025, p0, p1, M("post"), 5);
    }
  }

  function squareHouse(g, CS, r, lite) {
    const W2 = 4.4, D2 = 3.8, t = 0.34, H = 3.0;
    const hx = W2 / 2, hz = D2 / 2;
    const wall = M(WALL_KEYS[Math.floor(r.f() * WALL_KEYS.length) % WALL_KEYS.length]);
    const DOOR = { a: -1.05, b: -0.15, lo: FLOOR, hi: 2.1 };
    const WB = { a: 0.62, b: 1.18, lo: 1.35, hi: 1.9 };      // back window
    const WS = { a: -0.3, b: 0.3, lo: 1.35, hi: 1.9 };       // side window
    const WT = H - 0.24;                                     // walls stop under the roof slab
    wallRun(g, wall, -hx, hx, -hz, -hz + t, WT, [DOOR], CS, false);                 // front, the door
    wallRun(g, wall, -hx, hx, hz - t, hz, WT, [WB], CS, false);                      // back
    wallRun(g, wall, -hz + t, hz - t, hx - t, hx, WT, [WS], CS, true);               // +X side
    wallRun(g, wall, -hz + t, hz - t, -hx, -hx + t, WT, [], CS, true);               // -X side
    lintel(g, DOOR.a, DOOR.b, DOOR.hi, -hz + t / 2, t, false);
    lintel(g, WB.a, WB.b, WB.hi, hz - t / 2, t, false);
    lintel(g, WS.a, WS.b, WS.hi, hx - t / 2, t, true);
    bars(g, WB.a, WB.b, WB.lo, WB.hi, hz - t / 2, false);
    bars(g, WS.a, WS.b, WS.lo, WS.hi, hx - t / 2, true);
    // the roof: vigas through the walls, a mud slab on them, a parapet
    for (let i = 0; i < 5; i++) {
      const z = -hz + 0.45 + i * ((D2 - 0.9) / 4);
      rod(g, 0.09, 0.08, [-hx - 0.32, H - 0.34, z], [hx + 0.32, H - 0.34, z], M("post"), 7);
    }
    box(g, W2, 0.24, D2, wall, 0, H - 0.12, 0);
    const pt = 0.2, ph = 0.34;
    box(g, W2, ph, pt, wall, 0, H + ph / 2, -hz + pt / 2);
    box(g, W2, ph, pt, wall, 0, H + ph / 2, hz - pt / 2);
    box(g, pt, ph, D2 - 2 * pt, wall, -hx + pt / 2, H + ph / 2, 0);
    box(g, pt, ph, D2 - 2 * pt, wall, hx - pt / 2, H + ph / 2, 0);
    box(g, 0.14, 0.12, 0.5, M("post"), hx - 0.8, H + 0.08, hz + 0.18);   // the canale that drains the roof
    // a stone step at the threshold
    box(g, 1.3, 0.3, 0.55, M("stone"), (DOOR.a + DOOR.b) / 2, FLOOR - 0.15, -hz - 0.24);
    if (lite) return { h: H + ph, hx: hx };
    // the door, standing open into the room on its hinge
    const hinge = new THREE.Group();
    hinge.position.set(DOOR.a + 0.02, FLOOR, -hz + t);
    hinge.rotation.y = -1.35;
    box(hinge, 0.88, 1.96, 0.05, M("wood"), 0.44, 0.99, 0.03);
    box(hinge, 0.88, 0.1, 0.07, M("woodDark"), 0.44, 0.35, 0.03);
    box(hinge, 0.88, 0.1, 0.07, M("woodDark"), 0.44, 1.6, 0.03);
    g.add(hinge);
    // INSIDE. Floor, then the furniture against the walls.
    box(g, W2 - 2 * t, FLOOR - SINK, D2 - 2 * t, M("earth"), 0, (FLOOR + SINK) / 2, 0);
    const ix = hx - t, iz = hz - t;
    // a mud sleeping bench along the back wall, the bed made up on it
    box(g, 2.2, 0.42, 0.86, wall, -ix + 1.1, FLOOR + 0.21, iz - 0.43);
    bedding(g, -ix + 1.1, FLOOR + 0.42, iz - 0.43, 0, 1.95);
    rug(g, 1.4, 1.9, 0.62, -0.15, 0, Math.floor(r.f() * 3));
    lowTable(g, 0.62, -0.2, Math.PI / 2);
    cushion(g, ix - 0.3, -0.55, 0, "canvasDark");
    cushion(g, ix - 0.3, 0.55, 0, "hide");
    jarsAt(g, -ix + 0.35, -iz + 0.35, 3, r);
    // a plank shelf on the blank wall, a jar and a pot on it
    box(g, 0.24, 0.05, 1.1, M("wood"), -ix + 0.12, FLOOR + 1.55, 0.25);
    const sj = new THREE.Mesh(jarGeo(), M("clay")); sj.scale.setScalar(0.45); sj.position.set(-ix + 0.12, FLOOR + 1.575, 0.55); g.add(sj);
    cyl(g, 0.07, 0.06, 0.12, 8, M("metal"), -ix + 0.12, FLOOR + 1.635, 0.1);
    return { h: H + ph, hx: hx };
  }

  function roundHouse(g, CS, r, lite) {
    const R = 2.2, t = 0.3, H = 2.45, N = 16, DOOR_I = 12;
    const wall = M(WALL_KEYS[Math.floor(r.f() * 3) % 3]);
    const chord = 2 * R * Math.sin(Math.PI / N) + 0.06;
    for (let i = 0; i < N; i++) {
      const a = i / N * TAU;
      const px = Math.cos(a) * (R - t / 2), pz = Math.sin(a) * (R - t / 2);
      const seg = new THREE.Group();
      seg.position.set(px, 0, pz);
      seg.rotation.y = Math.PI / 2 - a;
      g.add(seg);
      if (i === DOOR_I) {
        box(seg, chord, H - 2.0 - FLOOR, t, wall, 0, (H + 2.0 + FLOOR) / 2, 0);
        box(seg, chord - 0.04, FLOOR - SINK, t, wall, 0, (FLOOR + SINK) / 2, 0);
        box(seg, chord + 0.3, 0.14, t + 0.06, M("post"), 0, 2.0 + FLOOR + 0.07, 0);
      } else {
        box(seg, chord, H - SINK, t, wall, 0, (H + SINK) / 2, 0);
        // the chord at its own turn, not its bounding square: the sixteen
        // fattened squares used to close half the doorway and eat the floor
        col(CS, px, FLOOR + (H - FLOOR) / 2, pz, chord, H - FLOOR, t, "house", seg.rotation.y);
      }
    }
    // the thatch: an open cone, two-sided so it is the ceiling from inside,
    // with a second, steeper cap over the crown and a top-knot
    /* THE CONE SITS ON THE WALL. Its base is dropped so that the thatch
       surface passes through the wall head at radius R, and the 55 cm past
       it is the eave hanging down over the wall, which is how a rondavel
       keeps the rain off its mud. */
    const RH = 2.1, RB = R + 0.55;
    const base = H - RH * (1 - R / RB);
    const roof = new THREE.Mesh(coneGeo(RB, RH, 16), MD("thatch"));
    roof.position.y = base;
    roof.castShadow = roof.receiveShadow = true;
    g.add(roof);
    const crown = base + RH;
    const cap = new THREE.Mesh(coneGeo(0.75, 0.62, 12), MD("thatch2"));
    cap.position.y = base + RH * (1 - 0.75 / RB) - 0.02;
    cap.castShadow = true;
    g.add(cap);
    rod(g, 0.05, 0.03, [0, crown - 0.2, 0], [0, crown + 0.5, 0], M("post"), 5);
    box(g, 1.1, 0.3, 0.5, M("stone"), Math.cos(DOOR_I / N * TAU) * (R + 0.2), FLOOR - 0.15, Math.sin(DOOR_I / N * TAU) * (R + 0.2));
    if (lite) return { h: crown, hx: R };
    // rafters you can see from inside, from the wall plate to the crown
    for (let i = 0; i < 10; i++) {
      const a = (i + 0.5) / 10 * TAU;
      rod(g, 0.045, 0.035, [Math.cos(a) * (R - t - 0.05), H - 0.05, Math.sin(a) * (R - t - 0.05)], [0, crown - 0.16, 0], M("post"), 5);
    }
    const fl = new THREE.Mesh(CG(R - t + 0.02, R - t + 0.02, FLOOR - SINK, 16), M("earth"));
    fl.position.y = (FLOOR + SINK) / 2; fl.receiveShadow = true;
    g.add(fl);
    // the bed along the back curve, a rug before it, the hearth off to the
    // side, jars by the door, a cushion against the wall
    bedding(g, 0, FLOOR, 1.12, 0, 1.8);
    rug(g, 1.6, 0.95, 0, 0.22, 0, Math.floor(r.f() * 3));
    const hearth = new THREE.InstancedMesh(rockGeo(3), M("rockDark"), 8);
    const dd = new THREE.Object3D();
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * TAU;
      dd.position.set(0.85 + Math.cos(a) * 0.32, FLOOR + 0.03, -0.45 + Math.sin(a) * 0.32);
      dd.rotation.set(0, a, 0); dd.scale.set(0.13, 0.09, 0.11);
      dd.updateMatrix(); hearth.setMatrixAt(i, dd.matrix);
    }
    hearth.instanceMatrix.needsUpdate = true;
    g.add(hearth);
    const ash = new THREE.Mesh(dishGeo(0.26, 0.02, 0.03, 10, 0, 0.1), M("char"));
    ash.position.set(0.85, FLOOR, -0.45);
    g.add(ash);
    jarsAt(g, -1.15, -1.1, 2, r);
    cushion(g, -1.45, 0.2, 0.25, "canvasDark");
    return { h: crown, hx: R };
  }

  function shack(g, CS, r, lite) {
    const W2 = 3.6, D2 = 3.2, hx = W2 / 2, hz = D2 / 2;
    const HB = 2.55, HF = 2.15;                   // high at the back, low at the door
    const sheet = function (x, z, w, h, alongZ, y0) {
      const k = r.chance(0.45) ? "corrRust" : "corr";
      const m = alongZ ? box(g, 0.035, h, w, M(k), x, y0 + h / 2, z, 0, 0, r.range(-0.012, 0.012))
                       : box(g, w, h, 0.035, M(k), x, y0 + h / 2, z, 0, r.range(-0.012, 0.012), 0);
      m.receiveShadow = true;
    };
    const topAt = function (z) { return HF + (HB - HF) * ((z + hz) / D2); };
    // corner and door posts
    const posts = [[-hx, -hz], [hx, -hz], [-hx, hz], [hx, hz], [-1.1, -hz], [-0.25, -hz]];
    for (let i = 0; i < posts.length; i++) {
      const p = posts[i];
      box(g, 0.1, topAt(p[1]) - SINK, 0.1, M("post"), p[0], (topAt(p[1]) + SINK) / 2, p[1]);
    }
    // sheets: back and sides full height (sides stepped to the slope), the
    // front either side of the door and a short one over it
    for (let i = 0; i < 4; i++) sheet(-hx + 0.45 + i * 0.9, hz + 0.03, 0.94, HB - SINK, false, SINK);
    for (let s = -1; s <= 1; s += 2) for (let i = 0; i < 4; i++) {
      const z = -hz + 0.4 + i * 0.8;
      sheet(s * (hx + 0.03), z, 0.84, topAt(z + 0.4) - SINK, true, SINK);
    }
    sheet(-1.45, -hz - 0.03, 0.7, HF - SINK, false, SINK);
    sheet(0.4, -hz - 0.03, 1.3, HF - SINK, false, SINK);
    sheet(1.45, -hz - 0.03, 0.72, HF - SINK, false, SINK);
    sheet(-0.675, -hz - 0.03, 0.9, HF - 1.95, false, 1.95);
    box(g, 0.95, 0.1, 0.08, M("post"), -0.675, 1.95, -hz);
    pushWallCol(CS, -hx, -1.12, -hz - 0.05, -hz + 0.05, HF, false);
    pushWallCol(CS, -0.23, hx, -hz - 0.05, -hz + 0.05, HF, false);
    pushWallCol(CS, -hx, hx, hz - 0.05, hz + 0.05, HB, false);
    pushWallCol(CS, -hz, hz, hx - 0.05, hx + 0.05, HB, true);
    pushWallCol(CS, -hz, hz, -hx - 0.05, -hx + 0.05, HB, true);
    // the roof: purlins, then five overlapping sheets down the slope
    const slope = Math.atan2(HB - HF, D2);
    for (let i = 0; i < 3; i++) {
      const z = -hz + i * hz;
      rod(g, 0.05, 0.05, [-hx - 0.2, topAt(z) + 0.02, z], [hx + 0.2, topAt(z) + 0.02, z], M("post"), 5);
    }
    for (let i = 0; i < 5; i++) {
      const x = -hx - 0.15 + 0.4 + i * 0.86;
      const k = i % 2 ? "corr" : "corrRust";
      // box()'s rotation order is (ry, rx, rz): the sheet pitches about X,
      // back edge up
      box(g, 0.92, 0.03, D2 + 0.5, M(k), x, (HB + HF) / 2 + 0.09 + (i % 2) * 0.012, 0, 0, -slope, r.range(-0.01, 0.01));
    }
    // a cloth hung in the doorway, pulled to one side
    const cur = new THREE.Mesh(sagGeo(0.5, 1.75, 0.08, 3), MD("canvasDark"));
    cur.rotation.set(Math.PI / 2, 0, 0);
    cur.position.set(-0.88, 1.05, -hz - 0.05);
    g.add(cur);
    if (lite) return { h: HB, hx: hx };
    box(g, W2 - 0.1, FLOOR - SINK, D2 - 0.1, M("earth"), 0, (FLOOR + SINK) / 2, 0);
    // a cot against the +X wall: a timber frame, canvas slung on it
    const cot = new THREE.Group();
    for (let s = -1; s <= 1; s += 2) box(cot, 0.06, 0.06, 1.95, M("post"), s * 0.36, 0.42, 0);
    for (let sx = -1; sx <= 1; sx += 2) for (let sz = -1; sz <= 1; sz += 2) rod(cot, 0.025, 0.025, [sx * 0.36, 0, sz * 0.9], [sx * 0.36, 0.42, sz * 0.9], M("post"), 5);
    const sling = new THREE.Mesh(sagGeo(0.72, 1.9, 0.06, 3), MD("canvas"));
    sling.position.y = 0.45;
    cot.add(sling);
    const blanket = new THREE.Mesh(pillowGeo(0.74, 0.06, 1.0), M("hide"));
    blanket.position.set(0, 0.44, 0.35);
    cot.add(blanket);
    cot.position.set(hx - 0.55, FLOOR, 0.1);
    g.add(cot);
    // a drum for a table with the tea things on it, an ammo box to sit on
    const dr = new THREE.Mesh(CG(0.29, 0.29, 0.88, 14), M("rust"));
    dr.position.set(-hx + 0.55, FLOOR + 0.44, hz - 0.55);
    g.add(dr);
    cyl(g, 0.2, 0.2, 0.015, 12, M("rust"), -hx + 0.55, FLOOR + 0.89, hz - 0.55);
    const pot = new THREE.Mesh(lathe("teapot", [[0.001, 0], [0.07, 0.005], [0.085, 0.06], [0.06, 0.11],
      [0.03, 0.13], [0.035, 0.15], [0.001, 0.16]], 10), M("metal"));
    pot.position.set(-hx + 0.55, FLOOR + 0.9, hz - 0.55);
    g.add(pot);
    const seat = new THREE.Mesh(crateGeo(0.66, 0.5, 0.5), crateMat());
    seat.position.set(-hx + 1.35, FLOOR, hz - 0.5);
    g.add(seat);
    // jerry cans by the door
    for (let i = 0; i < 2; i++) box(g, 0.17, 0.46, 0.34, M(i ? "metalDark" : "boxGreen"), -hx + 0.25, FLOOR + 0.23, -hz + 0.35 + i * 0.4);
    rug(g, 1.2, 1.7, 0.1, 0.1, 0, Math.floor(r.f() * 3));
    return { h: HB, hx: hx };
  }
  let _cone = new Map();
  function coneGeo(rad, h, seg) {
    const k = rad + "," + h + "," + seg;
    let g = _cone.get(k);
    if (!g) { g = new THREE.ConeGeometry(rad, h, seg, 1, true); g.translate(0, h / 2, 0); g._shared = true; _cone.set(k, g); }
    return g;
  }

  /* A HOUSE. Returns a group at the origin, door on local -Z before `rot`,
     `userData.colliders` in the group's frame (already turned), `userData.h`
     its height. */
  P.house = function (opts) {
    opts = opts || {};
    const r = stream(opts.seed == null ? 3 : opts.seed);
    const g = new THREE.Group();
    g.userData.colliders = [];
    const key = HOUSE_KINDS.indexOf(opts.kind) >= 0 ? opts.kind : HOUSE_KINDS[(r.f() * HOUSE_KINDS.length) | 0];
    const q = ((Math.round((opts.rot || 0) / (Math.PI / 2)) % 4) + 4) % 4;
    const rot = q * Math.PI / 2;
    const inner = new THREE.Group();
    const local = [];
    const build = key === "hut_round" ? roundHouse : (key === "shack_lean" ? shack : squareHouse);
    const dim = build(inner, local, r, !!opts.lite);
    if (opts.scale && opts.scale !== 1) inner.scale.setScalar(opts.scale);
    inner.rotation.y = rot;
    g.add(inner);
    inner.traverse(function (o) { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    const s = opts.scale || 1, cy = Math.cos(rot), sy = Math.sin(rot), odd = q % 2 === 1;
    for (let i = 0; i < local.length; i++) {
      const c = local[i];
      if (c.yaw) {
        // an already-turned wall (the round house's chords): turn it once more
        col(g.userData.colliders, (c.x * cy + c.z * sy) * s, c.y * s, (-c.x * sy + c.z * cy) * s,
          c.w * s, c.h * s, c.d * s, "house", c.yaw + rot);
      } else {
        col(g.userData.colliders, (c.x * cy + c.z * sy) * s, c.y * s, (-c.x * sy + c.z * cy) * s,
          (odd ? c.d : c.w) * s, c.h * s, (odd ? c.w : c.d) * s, "house");
      }
    }
    g.userData.h = dim.h * s;
    g.userData.hx = dim.hx * s;
    g.userData.kind = key;
    return g;
  };

  /* A HAMLET — n houses on an arc, each turned so its door faces the middle
     of the compound, which is what makes three buildings read as a place
     somebody lives rather than three objects. `at` is the arc's centre
     bearing and `spread` how wide it opens. */
  function hamlet(near, far, CS, opts) {
    const r = stream(opts.seed == null ? 5 : opts.seed);
    const n = opts.n || 3;
    const GY = opts.gy || FLAT;
    for (let i = 0; i < n; i++) {
      const a = opts.at + (n === 1 ? 0 : ((i / (n - 1)) - 0.5) * (opts.spread == null ? 1.1 : opts.spread));
      const rr = opts.r * r.range(0.88, 1.12);
      const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
      /* THE DOOR LOOKS INWARD. The hut's doorway is on its local -Z, so the
         facing that puts it toward the compound centre is the bearing back
         to the origin — snapped to the quarter turn villagekit needs. */
      const face = Math.atan2(-x, -z) + Math.PI;
      const h = P.house({ seed: (opts.seed || 5) * 17 + i * 7, rot: face, kind: opts.kind });
      /* SEATED ON THE HIGHEST GROUND UNDER IT. The house has a plinth floor
         and 60 cm of wall below it; set on the lowest (or the middle) of a
         sloping pad, the sand came up through the floor on the high side.
         The door step covers the rise on the low side. */
      let gmax = GY(x, z);
      for (let k = 0; k < 8; k++) {
        const a2 = k / 8 * TAU;
        gmax = Math.max(gmax, GY(x + Math.cos(a2) * 2.3, z + Math.sin(a2) * 2.3));
      }
      const hy = (opts.y == null ? -0.08 : opts.y) + gmax;
      h.position.set(x, hy, z);
      near.add(h);
      pushCols(CS, h, x, hy, z, 0);
      if (far) {
        // at 3 km a 3.3 m hut is a pixel; the far block is deliberately fat,
        // the same trade farCrane() states
        box(far, 6.4, 4.4, 6.4, M("sandDark"), x, 2.2, z);
      }
    }
  }

  /* ============================================================ THE STALL
     "HAVE A GUY WITH A CRATE OR A SMALL STAND SELLING SHIT." This is the
     stand, and every one of the four kinds gets one, because every one of
     the four kinds is a place you walk up to and BUY something — that is
     what outpost.js's whole screen is. A counter, a shade over it, what is
     for sale ON it, and a crate at the end for the man to sit on.

     The counter is 1.05 m: a man's rig is 1.8 m and stands BEHIND it, so the
     bar crosses him at the waist. At the 0.75 m the first pass used he
     looked like he was standing behind a coffee table. */
  P.stall = function (opts) {
    opts = opts || {};
    const g = new THREE.Group();
    const r = stream(opts.seed == null ? 9 : opts.seed);
    const w = opts.w || 5.0, d = opts.d || 3.4;
    const shade = P.canopy({ w: w + 1.2, d: d + 1.4, h: opts.h || 2.85, mat: opts.mat || "tarp" });
    g.add(shade);
    // the counter, along local X, with the trader's side at -Z
    box(g, w, 1.0, 0.7, M("wood"), 0, 0.5, 0.55);
    box(g, w + 0.4, 0.07, 0.95, M("woodDark"), 0, 1.035, 0.55);     // the top board
    for (let s = -1; s <= 1; s += 2) box(g, 0.16, 1.0, 0.8, M("woodDark"), s * (w / 2 - 0.1), 0.5, 0.55);
    /* WHAT IS FOR SALE, ON THE COUNTER. This was five crates scaled to a
       third of their size and dropped on the board (toy blocks), plus a
       loose 80 cm cube standing behind it for no reason. A trader's counter
       has his goods laid out: folded rugs, a row of water jars, a sack, a
       brass tray with a teapot. */
    const ty = 1.07;
    box(g, 0.9, 0.14, 0.62, M("canvasDark"), -w * 0.3, ty + 0.07, 0.55, r.range(-0.1, 0.1));
    box(g, 0.84, 0.1, 0.58, M("hide"), -w * 0.3 + 0.03, ty + 0.19, 0.55, r.range(-0.15, 0.15));
    for (let i = 0; i < 3; i++) {
      const j = new THREE.Mesh(jarGeo(), M("clay"));
      j.position.set(-0.35 + i * 0.42, ty, 0.5 + (i % 2) * 0.12);
      j.scale.setScalar(0.62 + (i % 2) * 0.1);
      j.castShadow = true;
      g.add(j);
    }
    const sack = new THREE.Mesh(pillowGeo(0.46, 0.4, 0.4), M("burlap"));
    sack.position.set(w * 0.3, ty + 0.19, 0.55);
    sack.castShadow = true;
    g.add(sack);
    cyl(g, 0.26, 0.26, 0.02, 14, M("rust"), w * 0.12, ty + 0.01, 0.6);         // a brass tray
    const pot = new THREE.Mesh(lathe("teapot", [[0.001, 0], [0.07, 0.005], [0.085, 0.06], [0.06, 0.11],
      [0.03, 0.13], [0.035, 0.15], [0.001, 0.16]], 10), M("metal"));
    pot.position.set(w * 0.12, ty + 0.02, 0.6);
    g.add(pot);
    /* AND HIS STOCK BEHIND HIM: a proper stack of cases against the back,
       sacks slumped beside it, and the drums he sells out of. */
    const behind = P.crates({ n: 5, spread: 2.4, seed: (opts.seed || 9) * 7 });
    behind.position.set(-w * 0.3, -0.02, -1.4);
    g.add(behind);
    const sk = P.sacks({ n: 4, seed: (opts.seed || 9) * 5 });
    sk.position.set(w * 0.17, -0.02, -0.95);
    sk.rotation.y = 0.1;
    g.add(sk);
    const dr = P.drums({ n: 3, seed: (opts.seed || 9) * 11, mat: opts.drums || "rust" });
    dr.position.set(w * 0.44, -0.02, -1.75);
    g.add(dr);
    // a three-legged stool for the man behind the counter
    const stool = new THREE.Group();
    cyl(stool, 0.2, 0.2, 0.05, 10, M("wood"), 0, 0.46, 0);
    for (let i = 0; i < 3; i++) {
      const a = i / 3 * TAU;
      rod(stool, 0.025, 0.025, [Math.cos(a) * 0.2, 0, Math.sin(a) * 0.2], [Math.cos(a) * 0.13, 0.45, Math.sin(a) * 0.13], M("woodDark"), 5);
    }
    stool.position.set(-w * 0.1, 0, -0.55);
    g.add(stool);
    g.userData.colliders = [];
    col(g.userData.colliders, 0, 0.52, 0.55, w, 1.05, 0.7, "counter");
    return g;
  };

  /* ============================================================ THE FOLK
     WHERE THE PEOPLE STAND. This file does not draw a man and must not: the
     campaign already owns forty-eight pooled CBZ.studio.cast rigs, dresses
     them through W.outfits, seats them with W.sand.plant and walks them on
     CBZ.animChar, and a second way to put a body on this island is exactly
     the drift CONTRACT.md exists to stop.

     What this file DOES own is where the counter is. So each outpost
     publishes `userData.folk` — anchors in LOCAL metres, `{x,z,yaw,role}` —
     and campaign.js turns them into world coordinates and asks its own pool
     for bodies. yaw is the local facing, 0 being +Z, which composes with the
     group's own rotation the way any child does.

     ROLES, and they are not decoration — campaign.js picks a man's tier off
     them, so a trader is not dressed as a levy: `trader` the one you buy
     from, `guard` the ones with rifles, `hand` the labour, `idler` whoever
     is sat about. */
  function folk(list, x, z, yaw, role) {
    list.push({ x: x, z: z, yaw: yaw || 0, role: role || "idler" });
    return list;
  }
  // face the compound centre from wherever you are standing
  function facing(x, z) { return Math.atan2(-x, -z); }

  /* A STALL, TURNED TO FACE THE PLACE IT SITS IN. The counter's customer side
     is the stall's local +Z, so the yaw that points it at the middle of the
     compound is atan2(-x, -z) — and the trader, who stands 1.35 m behind his
     own counter, therefore comes out 1.35 m FURTHER from the centre than the
     stall is, which is exactly where a man behind a counter stands. Derived
     rather than typed, so moving a stall moves its trader with it and the two
     can never drift apart. */
  function standAt(near, CS, F, x, z, opts) {
    opts = opts || {};
    const rr = Math.max(0.001, Math.hypot(x, z));
    const yaw = Math.atan2(-x, -z);
    const y = opts.y == null ? -0.12 : opts.y;
    const st = P.stall(opts);
    const sy2 = y + (opts.gy || FLAT)(x, z);
    st.position.set(x, sy2, z);
    st.rotation.y = yaw;
    near.add(st);
    pushCols(CS, st, x, sy2, z, yaw);
    const k = 1 + 1.35 / rr;
    folk(F, x * k, z * k, yaw, "trader");
    return st;
  }

  /* ============================================================ OUTPOSTS
     THE FOUR PLACES. outpost.js already declares what they DO; this is what
     they LOOK like, and the rule for all four is the same:

       YOU MUST BE ABLE TO NAME IT FROM A KILOMETRE AWAY, BY SHAPE ALONE.

     At the campaign camera's fov, one metre is about a third of a pixel at 3
     km and about half a pixel at 1 km. So each kind gets ONE tall thing
     nobody else has and one wide thing nobody else has:

       DEPOT   a 16 m gantry crane over a row of 12 m containers   (tall+box)
       CAMP    nine triangles and three columns of smoke           (spiky)
       WELL    a ring of palm crowns and a low pale sail           (round+flat)
       MARKET  four wide low canopies, no mast at all              (flat)

     None of them shares a silhouette with any other, which is the whole
     specification. Detail below that is for the 30 m view and gets thrown
     away by the far LOD.

     NO GROUND PAD. The first draft laid a flat hardstand disc under each
     outpost; on desert.js's dunes a 36 m disc floats a metre on one side and
     buries itself on the other. Everything here is sunk 0.2-0.3 m into the
     sand instead and the terrain shows through, which is both cheaper and
     correct on ground that is never flat. */
  /* opts: {seed, colour, lod, lodR, groundAt}. `groundAt(x, z) -> y` is the
     compound's own ground, in local metres — see THE GROUND above. Without
     it everything is built on a flat plane, which is what the gallery wants
     and what a battlefield already is. */
  P.outpost = function (kind, opts) {
    opts = opts || {};
    const build = { depot: buildDepot, camp: buildCamp, well: buildWell, market: buildMarket }[kind];
    return (build || buildDepot)(opts);
  };
  P.depot = function (o) { return buildDepot(o || {}); };
  P.camp = function (o) { return buildCamp(o || {}); };
  P.well = function (o) { return buildWell(o || {}); };
  P.market = function (o) { return buildMarket(o || {}); };

  /* ============================================================ THE GROUND
     A COMPOUND IS NOT ONE RIGID OBJECT AND PRETENDING IT IS IS WHAT MAKES
     THINGS FLOAT.

     The note above says why there is no hardstand: a flat disc on a dune
     floats a metre on one side and buries itself on the other. That is true
     of the disc AND of everything standing on it. campaign.js levels the pad
     before it stands an outpost up, but level is 20 m of ground within a
     couple of metres, not a table — and a 2.6 m hut with 0.6 m of daylight
     under one corner is the single loudest "this is fake" an outpost can
     emit. The first pass photographed exactly that at three of the four
     kinds.

     THE SEAM IS A FUNCTION, NOT A HEIGHTFIELD. This file must not know what
     desert.js is; the caller passes `groundAt(x, z)` — local metres in, a
     local height OUT, relative to the compound's own plane — and everything
     that is its own object is seated on what that function says. It is
     called at BUILD time and not after, and that ordering is load-bearing:
     core/batch.js welds the inert meshes together inside finish(), so a
     house re-seated afterwards would be moving an empty group while its
     geometry stayed baked where it was.

     WHAT DOES *NOT* GET IT, and the rule is the same one a builder uses: a
     thing that is rigid in the world stays rigid. The container row is one
     12 m steel box, the gantry straddles it, a 22 m sandbag run is one wall,
     the oasis bowl is one hollow. Those are sunk into the sand and let the
     terrain cut them, which is what actually happens to them. Huts, tents,
     palms, stalls, drums, fires and crates are separate objects standing on
     the ground and they each get their own answer. */
  const FLAT = function () { return 0; };

  function shellFor(opts) {
    const g = new THREE.Group();
    const near = new THREE.Group();
    const far = new THREE.Group();
    g.add(near); g.add(far);
    g.userData.colliders = [];
    g.userData.folk = [];             // where the people stand — see THE FOLK
    g.userData.near = near; g.userData.far = far;
    return g;
  }
  function finish(g, opts) {
    settle(g.userData.near);
    settle(g.userData.far);
    if (opts.lod !== false) lodable(g, g.userData.near, g.userData.far, opts.lodR);
    else g.userData.far.visible = false;
    return g;
  }

  // ---------------------------------------------------------- ARMS DEPOT
  function buildDepot(opts) {
    const g = shellFor(opts);
    const near = g.userData.near, far = g.userData.far;
    const r = stream(opts.seed == null ? 7 : opts.seed);
    const CS = g.userData.colliders;
    const GY = opts.groundAt || FLAT;
    if (OLD) { oldBlock(near, CS, 14, 3, "metalDark"); return finish(g, opts); }

    /* --- THE CONTAINER YARD. Six of them, and they are laid out as a ROW
       with a stack on the end rather than scattered, because a row of boxes
       all the same size and all the same way up is a SHAPE and a scatter of
       boxes is noise. The first pass put four in a heap inside the crane's
       legs and photographed as one long pale sofa. */
    const paints = ["boxRed", "boxBlue", "boxGreen", "rust", "boxRed", "boxBlue"];
    const lay = [
      { x: 0,    z: -11.0, y: 0,    yaw: 0,           len: 12.2 },
      { x: 0,    z: -8.0,  y: 0,    yaw: 0,           len: 12.2 },
      { x: 0,    z: -5.0,  y: 0,    yaw: 0,           len: 12.2 },
      { x: -0.6, z: -11.0, y: 2.62, yaw: 0,           len: 12.2 },
      { x: 0.4,  z: -8.0,  y: 2.62, yaw: 0,           len: 12.2 },
      { x: 13.0, z: 3.0,   y: 0,    yaw: Math.PI / 2, len: 6.1  },
    ];
    for (let i = 0; i < lay.length; i++) {
      const L = lay[i];
      const c = P.container({ paint: paints[i % paints.length], len: L.len });
      c.position.set(L.x, L.y - 0.22, L.z);
      c.rotation.y = L.yaw + r.range(-0.03, 0.03);
      near.add(c);
      if (L.y === 0) {
        col(CS, L.x, 1.2, L.z, L.len, 2.4, 2.44, "container", c.rotation.y);
      }
    }

    /* --- THE CRANE, and it is the whole silhouette. 14 m to the beam, span
       18 m — it has to STRADDLE the container row, because a gantry standing
       beside its containers reads as a swing set, which is exactly what the
       first pass photographed as. Legs 0.34 m and dark: the first pass drew
       0.42 m legs in bright steel and the frame outweighed the cargo. */
    const crane = new THREE.Group();
    const H = 14, SPAN = 18;
    for (let s = -1; s <= 1; s += 2) {
      for (let t = -1; t <= 1; t += 2) {
        const leg = box(crane, 0.34, H, 0.34, M("metal"), s * SPAN / 2 + t * 0.8, H / 2, t * 3.2);
        leg.rotation.x = -t * 0.055;      // splay, so it reads as a frame not a post
      }
      // the diagonals. Without them a gantry is four sticks and a plank.
      box(crane, 0.24, 7.2, 0.24, M("metalDark"), s * SPAN / 2, 4.2, 0, 0, 0.72, 0);
      box(crane, 0.24, 6.4, 0.24, M("metalDark"), s * SPAN / 2, H - 3.4, 0, 0, -0.72, 0);
      box(crane, 0.3, 0.3, 7.0, M("metalDark"), s * SPAN / 2, H - 0.4, 0);
      col(CS, s * SPAN / 2, 1.2, 0, 2.2, 2.4, 7.2, "crane");
    }
    box(crane, SPAN + 2.4, 0.9, 1.2, M("metal"), 0, H, 0);
    box(crane, SPAN + 2.4, 0.3, 0.3, M("metalDark"), 0, H + 0.62, 0.55);
    box(crane, SPAN + 2.4, 0.3, 0.3, M("metalDark"), 0, H + 0.62, -0.55);
    // trolley + hook on a cable — three boxes, and it is what makes the
    // frame a CRANE rather than a gantry
    const tx = r.range(-5, 5);
    box(crane, 1.7, 0.8, 1.6, M("rust"), tx, H - 0.85, 0);
    box(crane, 0.09, 7.4, 0.09, M("metalDark"), tx, H - 5.1, 0);
    box(crane, 0.9, 0.9, 0.9, M("metalDark"), tx, H - 8.9, 0);
    crane.position.set(0, 0, -8);
    near.add(crane);

    // --- the wall, the crates, the drums, the mast --------------------
    const wall = P.sandbags({ len: 22, h: 1.25, curve: 3.0, seed: (opts.seed || 7) * 3 });
    wall.position.set(0, -0.1, 11.5);
    near.add(wall);
    pushCols(CS, wall, 0, -0.1, 11.5, 0);
    for (let i = 0; i < 2; i++) {
      const gab = P.gabion({ len: 8, h: 1.6, d: 1.2, seed: (opts.seed || 7) * (5 + i) });
      gab.position.set((i ? 1 : -1) * 15, -0.1, 2);
      gab.rotation.y = Math.PI / 2;
      near.add(gab);
      pushCols(CS, gab, (i ? 1 : -1) * 15, -0.1, 2, Math.PI / 2);
    }

    const crates = P.crates({ n: 20, spread: 4.0, seed: (opts.seed || 7) * 11 });
    crates.position.set(-2.5, -0.1 + GY(-2.5, 3.5), 3.5);
    near.add(crates);
    pushCols(CS, crates, -2.5, crates.position.y, 3.5, 0);
    const drums = P.drums({ n: 12, spread: 2.6, seed: (opts.seed || 7) * 13 });
    drums.position.set(8.5, -0.05 + GY(8.5, 6.5), 6.5);
    near.add(drums);

    const shade = P.canopy({ w: 8, d: 6, h: 3.1, mat: "tarp" });
    shade.position.set(7, -0.15 + GY(7, -1), -1);
    near.add(shade);
    const mast = P.banner(opts.colour == null ? 0xb9a13f : opts.colour, { h: 13, seed: opts.seed || 7 });
    mast.position.set(-15, -0.2 + GY(-15, 9), 9);
    g.add(mast);                       // outside near/far: the flag flies at both

    /* THE STALL AND THE PORT HOUSES. A depot is the one kind where the guns
       arriving is the whole story, so its stand sits in the open with the
       crane behind it and its two buildings are the office and the store,
       off to the landward side clear of the container row. */
    const F = g.userData.folk;
    standAt(near, CS, F, -8.5, 8.0, { seed: (opts.seed || 7) * 23, w: 5.4, mat: "tarp", drums: "metalDark", gy: GY });
    hamlet(near, far, CS, { n: 2, at: -0.55, spread: 0.7, r: 16, seed: (opts.seed || 7) * 31, gy: GY });
    // two hands working the row, a man at the crane leg, two on the wall, one
    // sat on the drums. Facings are derived from where each of them stands.
    folk(F, -4.0, -6.5, facing(-4.0, -6.5), "hand");
    folk(F, 3.5, -3.6, facing(3.5, -3.6) + 0.8, "hand");
    folk(F, 0.5, -8.4, facing(0.5, -8.4), "hand");
    folk(F, -3.5, 10.2, facing(-3.5, 10.2) + Math.PI, "guard");
    folk(F, 4.5, 10.4, facing(4.5, 10.4) + Math.PI, "guard");
    folk(F, 8.0, 5.2, facing(8.0, 5.2) - 0.5, "idler");

    // ---- THE FAR SILHOUETTE: crane over a container block ----
    farCrane(far, H * 1.2, SPAN * 1.1);
    for (let i = 0; i < 2; i++) {
      box(far, 14, 3.6, 9, M("metalDark"), 0, 1.8 + i * 3.7, -8 + i * 1.5);
    }
    box(far, 8, 3.4, 3.4, M("metalDark"), 13, 1.7, 3);
    box(far, 24, 2.0, 3.2, M("sandDark"), 0, 1.0, 11.5);   // the wall, as a bar

    return finish(g, opts);
  }
  function farCrane(far, H, SPAN) {
    // deliberately fat: at 3 km a 0.34 m leg is a tenth of a pixel and the
    // crane vanishes, taking the depot's whole identity with it.
    for (let s = -1; s <= 1; s += 2) {
      box(far, 1.2, H, 1.2, M("metal"), s * SPAN / 2, H / 2, -8);
    }
    box(far, SPAN + 3, 1.8, 2.0, M("metal"), 0, H, -8);
  }
  function pushCols(CS, sub, x, y, z, yaw) {
    const sc = sub.userData.colliders || [];
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    for (let i = 0; i < sc.length; i++) {
      const q = sc[i];
      col(CS, x + q.x * cy + q.z * sy, y + q.y, z - q.x * sy + q.z * cy,
        q.w, q.h, q.d, q.tag, yaw + (q.yaw || 0));
      if (q.cover === false) CS[CS.length - 1].cover = false;
    }
  }
  function oldBlock(near, CS, w, h, mat) {
    // the ?propkit=old outpost: what an outpost was before this file — one
    // box. Not a straw man; there was nothing.
    box(near, w, h, w, M(mat), 0, h / 2, 0);
    col(CS, 0, h / 2, 0, w, h, w, "old");
  }

  // ---------------------------------------------------------- RECRUIT CAMP
  function buildCamp(opts) {
    const g = shellFor(opts);
    const near = g.userData.near, far = g.userData.far;
    const r = stream(opts.seed == null ? 13 : opts.seed);
    const CS = g.userData.colliders;
    const GY = opts.groundAt || FLAT;
    if (OLD) { oldBlock(near, CS, 10, 2.5, "canvasDark"); return finish(g, opts); }

    /* FOURTEEN RIDGE TENTS IN TWO ARCS, not one. A single ring of nine at
       13 m came out as a thin scattered necklace with a hole in the middle —
       from above it was a shape with no mass in it. Two staggered arcs give
       the camp a wall of canvas to read against, which is what says "there
       are men here" rather than "somebody pitched a tent". Still a horseshoe
       and still open toward the water, so the player has somewhere to ride
       in to. */
    const list = [];
    for (let ring = 0; ring < 2; ring++) {
      /* SIXTEEN TENTS OVER 155 DEGREES, and the arc is the fix. At 6 and 8
         tents spread over 235 degrees they were 6 m apart on a 2.3 m tent —
         a necklace, not a camp, and from above it read as random scatter.
         Tighter arc, more tents, and the horseshoe's mouth is now narrow
         enough to be a gate you ride in through. */
      const R = 10.0 + ring * 4.0;
      const n = 7 + ring * 2;
      for (let i = 0; i < n; i++) {
        const a = -1.35 + (i / (n - 1)) * 2.7 + (ring ? 0.15 : 0);
        const rr = R * r.range(0.93, 1.07);
        list.push({
          x: Math.cos(a) * rr, z: Math.sin(a) * rr,
          y: -0.1 + GY(Math.cos(a) * rr, Math.sin(a) * rr),
          yaw: a + Math.PI / 2 + r.range(-0.16, 0.16),
          s: r.range(0.95, 1.2), sy: r.range(0.95, 1.15), tint: r.f(),
        });
      }
    }
    near.add(P.tents(list, {}));
    near.add(P.tentBeds(list));
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      col(CS, t.x, 0.9, t.z, 2.6 * t.s, 1.8, 3.8 * t.s, "tent");
    }
    // two big bell tents at the head — the captains'
    for (let s = -1; s <= 1; s += 2) {
      /* A BELL TENT: a short upright wall, the cone sitting ON it with a
         little eave, the pole through the crown, and guy lines out to pegs.
         It was a cone standing on the sand with a solid 55 cm drum pushed
         through its skirt. */
      const bell = new THREE.Group();
      const wallT = new THREE.Mesh(lathe("bellwall", [[3.2, 0.0], [3.18, 0.72]], 18), MD("canvasDark"));
      wallT.castShadow = wallT.receiveShadow = true;
      bell.add(wallT);
      const cone = new THREE.Mesh(coneGeo(3.45, 3.7, 18), MD("canvas"));
      cone.position.y = 0.72 - 3.7 * (1 - 3.18 / 3.45);
      cone.castShadow = cone.receiveShadow = true;
      bell.add(cone);
      cyl(bell, 0.06, 0.07, 4.9, 6, M("post"), 0, 2.45, 0);
      for (let k = 0; k < 8; k++) {
        const a = k / 8 * TAU + 0.2;
        const ey = cone.position.y + 3.7 * (1 - 3.35 / 3.45);
        rod(bell, 0.012, 0.012, [Math.cos(a) * 3.35, ey, Math.sin(a) * 3.35], [Math.cos(a) * 5.0, 0.05, Math.sin(a) * 5.0], M("rope"), 3);
        cyl(bell, 0.025, 0.02, 0.25, 4, M("post"), Math.cos(a) * 5.0, 0.08, Math.sin(a) * 5.0);
      }
      bell.position.set(s * 5.2, -0.2 + GY(s * 5.2, -9.0), -9.0);
      bell.rotation.y = r.f() * TAU;
      near.add(bell);
      col(CS, s * 5.2, 1.6, -9.0, 6.2, 3.2, 6.2, "tent");
    }

    /* THREE FIRES WITH SMOKE, and the smoke is the long-range read. A tent
       is 3.5 m and invisible at a kilometre; a 14 m smoke column is not.
       This is the same trick a real army gave itself away with, which is a
       good sign it works. */
    for (let i = 0; i < 3; i++) {
      const a = -1.3 + i * 1.3;
      const f = P.fire({ seed: (opts.seed || 13) * 7 + i, smokeH: 13 + i * 3 });
      f.position.set(Math.cos(a) * 5.2, -0.05 + GY(Math.cos(a) * 5.2, Math.sin(a) * 5.2), Math.sin(a) * 5.2);
      near.add(f);
    }
    // a cook pot over the middle one
    const pot = new THREE.Group();
    for (let s = -1; s <= 1; s += 2) cyl(pot, 0.06, 0.06, 2.2, 5, M("post"), s * 0.9, 1.1, 0, 0, 0, s * 0.22);
    box(pot, 2.1, 0.07, 0.07, M("post"), 0, 2.15, 0);
    // a round-bellied cauldron on a chain, not a drum on a stick
    const kettle = new THREE.Mesh(lathe("cauldron", [[0.001, 0], [0.2, 0.02], [0.36, 0.14], [0.4, 0.3], [0.36, 0.46], [0.38, 0.5], [0.35, 0.5], [0.33, 0.46]], 12), MD("metalDark"));
    kettle.position.set(0, 0.95, 0);
    kettle.castShadow = true;
    pot.add(kettle);
    rod(pot, 0.012, 0.012, [0, 2.12, 0], [0, 1.82, 0], M("metalDark"), 4);
    const bail = new THREE.Mesh(new THREE.TorusGeometry(0.37, 0.012, 3, 12, Math.PI), M("metalDark"));
    bail.position.set(0, 1.45, 0);
    pot.add(bail);
    pot.position.set(5.2, GY(5.2, 0), 0);
    near.add(pot);

    // the arms: four rifle stacks, which is what says RECRUIT rather than
    // "some people are camping"
    for (let i = 0; i < 4; i++) {
      const a = 0.3 + i * 0.5;
      const st = P.armStack({ seed: (opts.seed || 13) * 29 + i, id: i & 1 ? "ak47" : "carbine" });
      st.position.set(Math.cos(a) * 6.4, -0.05 + GY(Math.cos(a) * 6.4, Math.sin(a) * 6.4), Math.sin(a) * 6.4);
      st.rotation.y = r.f() * TAU;
      near.add(st);
    }
    /* A ROPE CORRAL, and it moved. At radius 6.5 out at z=16 it was a big
       empty octagon in the foreground of every shot with nothing in it —
       it read as an abstract diagram. Small, tucked against the tent line,
       where a picket actually goes. */
    const cor = new THREE.Group();
    const posts = 8, CR = 4.2;
    for (let i = 0; i < posts; i++) {
      const a = i / posts * TAU;
      cyl(cor, 0.07, 0.09, 1.4, 5, M("post"), Math.cos(a) * CR, 0.65, Math.sin(a) * CR);
      const b = box(cor, CR * TAU / posts + 0.3, 0.04, 0.04, M("rope"),
        Math.cos(a + Math.PI / posts) * CR, 1.15, Math.sin(a + Math.PI / posts) * CR);
      b.rotation.y = -(a + Math.PI / posts) + Math.PI / 2;
      b.castShadow = false;
    }
    cor.position.set(11, -0.1 + GY(11, 8), 8);
    near.add(cor);

    const crates = P.crates({ n: 10, spread: 2.4, seed: (opts.seed || 13) * 17 });
    crates.position.set(-8.0, -0.1 + GY(-8.0, -1.5), -1.5);
    near.add(crates);
    // the stack is at (-8, -1.5): its cover was registered three metres off at (-11, -4)
    pushCols(CS, crates, -8.0, crates.position.y, -1.5, 0);
    // a lean-to awning off the bell tents: cloth catches the eye at range
    const awn = P.canopy({ w: 7, d: 4.5, h: 2.6, mat: "canvasDark" });
    awn.position.set(0, -0.15 + GY(0, -12.5), -12.5);
    near.add(awn);

    const mast = P.banner(opts.colour == null ? 0x4a8f5a : opts.colour, { h: 11, seed: opts.seed || 13 });
    mast.position.set(0, -0.2 + GY(0, -5.5), -5.5);
    g.add(mast);

    /* THE MEN, AND THIS IS THE KIND WHOSE STOCK IS PEOPLE. outpost.js's own
       blurb is "men at the water, looking for a warlord", so the camp carries
       the most bodies of the four and they are round the fires and the arm
       stacks rather than lined up: a queue is a menu, a fire with four men at
       it is a place. The houses go in the horseshoe's mouth, on the open
       side, so you ride past somebody's front door to reach the recruiter. */
    const F = g.userData.folk;
    standAt(near, CS, F, -7.0, 6.0, { seed: (opts.seed || 13) * 23, w: 4.6, mat: "canvasDark", drums: "hide", gy: GY });
    hamlet(near, far, CS, { n: 3, at: Math.PI, spread: 1.0, r: 13.5, seed: (opts.seed || 13) * 37, gy: GY });
    folk(F, 1.9, -6.7, facing(1.9, -6.7), "idler");
    folk(F, 7.0, 0.3, facing(7.0, 0.3), "idler");
    folk(F, 1.9, 6.7, facing(1.9, 6.7), "idler");
    folk(F, 7.6, 2.4, facing(7.6, 2.4) + 1.1, "hand");
    folk(F, 5.4, 5.8, facing(5.4, 5.8) - 0.9, "hand");
    folk(F, -3.0, -7.0, facing(-3.0, -7.0) + Math.PI, "guard");
    folk(F, 3.0, -7.2, facing(3.0, -7.2) + Math.PI, "guard");
    folk(F, 9.6, 7.0, facing(9.6, 7.0) + 0.6, "idler");

    // ---- FAR: a cluster of triangles and three smoke columns ---------
    const flist = [];
    for (let ring = 0; ring < 2; ring++) {
      const R = 10.0 + ring * 4.0, n = 7 + ring * 2;
      for (let i = 0; i < n; i++) {
        const a = -1.35 + (i / (n - 1)) * 2.7;
        flist.push({ x: Math.cos(a) * R, z: Math.sin(a) * R, y: 0, yaw: a, s: 2.2, sy: 2.2, tint: 0.5 });
      }
    }
    far.add(P.tents(flist, {}));
    box(far, 7, 7, 7, M("canvasDark"), -5.2, 3.5, -9.0);
    box(far, 7, 7, 7, M("canvasDark"), 5.2, 3.5, -9.0);
    const fsm = new THREE.Group();
    fsm.userData.dynamic = true;       // vertex-alpha smoke: never batch it
    for (let i = 0; i < 3; i++) {
      const a = -1.3 + i * 1.3;
      const sm = new THREE.Mesh(smokeCol(30 + i * 6), smokeMat());
      sm.position.set(Math.cos(a) * 5.2, 1, Math.sin(a) * 5.2);
      fsm.add(sm);
    }
    far.add(fsm);

    return finish(g, opts);
  }

  // ---------------------------------------------------------- WELL / OASIS
  function buildWell(opts) {
    const g = shellFor(opts);
    const near = g.userData.near, far = g.userData.far;
    const r = stream(opts.seed == null ? 23 : opts.seed);
    const CS = g.userData.colliders;
    const GY = opts.groundAt || FLAT;
    if (OLD) { oldBlock(near, CS, 6, 2, "palmTrunk"); return finish(g, opts); }

    /* THE WATER IS FLAT AND ITS BANK IS THE BOWL. Two drafts wrong before
       this one: a flat disc at -0.25 was under the ground and invisible, and
       a dish with its middle at -0.55 was invisible for the same reason —
       anything below the ground plane is below the ground plane, and on
       procedural terrain "sink it" is only ever right for things with sides.
       So the water is a flat sheet slightly PROUD of the sand, and the read
       as "a hollow with water in it" comes from a ring of darker bank
       falling from +0.45 down to the waterline around it. Same trick as a
       scorch mark: decals bulge up. */
    // JITTERED RADII: a perfect annulus of green around a perfect blue disc
    // photographed as a rubber ring on a swimming pool. Water finds a shape.
    const bank = new THREE.Mesh(dishGeo(8.2, 0.45, 0.06, 26, 4.6, 0.09), M("sandDark"));
    bank.position.set(2.5, 0, 3);
    bank.receiveShadow = true;
    near.add(bank);
    const pool = new THREE.Mesh(dishGeo(4.8, 0.1, 0.1, 24, 0, 0.10), M("water"));
    pool.position.set(2.5, 0, 3);
    near.add(pool);
    // the green ring that only grows where the water is — the single loudest
    // "there is water here" signal on a sand-coloured map
    const grass = new THREE.Mesh(dishGeo(11.5, 0.06, 0.5, 26, 8.0, 0.12), M("scrub"));
    grass.position.set(2.5, 0, 3);
    grass.receiveShadow = true;
    near.add(grass);

    // THE PALMS, in a broken ring — a perfect ring reads as planted, and
    // this is meant to read as the reason the well is here
    for (let i = 0; i < 11; i++) {
      /* PUSHED OUT TO 9-14 m AND OFF THE WEST SIDE. At 6-12.5 m two of them
         landed on top of the well head and one stood in the shade sail, so
         the two objects that NAME the place were both behind a trunk. */
      const a = i / 11 * TAU + r.range(-0.26, 0.26);
      const rr = r.range(9.0, 14.0);
      const p = P.palm({ seed: (opts.seed || 23) * 31 + i, h: r.range(6.0, 13.5) });
      const pxx = 2.5 + Math.cos(a) * rr, pzz = 3 + Math.sin(a) * rr;
      p.position.set(pxx, -0.2 + GY(pxx, pzz), pzz);
      near.add(p);
      col(CS, p.position.x, 1.6, p.position.z, 0.8, 3.2, 0.8, "palm");
    }

    /* THE WELL HEAD, at 1.4x the first draft's size and moved clear of the
       shade sail. It was 3 m across and standing under a 9 m sail, so the
       one object that NAMES this place — a ring of palms is an oasis, a ring
       of palms with a winch over a hole is a WELL, which is a thing somebody
       built — was the one object you could not see. */
    const wh = new THREE.Group();
    /* A WELL YOU CAN LOOK DOWN. The head was a stone drum with a SOLID
       disc on top of it (the coping was a capped cylinder, so the well was
       a lid), a box for a bucket and a box for a rope. Now: a coursed-stone
       parapet ring, a coping ring of dressed stone you can see over, the
       shaft going dark below it with water glinting at the bottom, and the
       windlass on two A-frames with a crank, a rope and a real bucket hung
       over the hole. */
    const drum = new THREE.Mesh(lathe("wellwall", [[2.15, -0.3], [2.0, 1.2], [1.72, 1.2], [1.72, -0.2]], 20), MD("stone"));
    drum.castShadow = drum.receiveShadow = true;
    wh.add(drum);
    const coping = new THREE.Mesh(lathe("wellcope", [[1.66, 1.18], [1.66, 1.4], [2.12, 1.4], [2.12, 1.18]], 20), MD("stoneDark"));
    coping.castShadow = coping.receiveShadow = true;
    wh.add(coping);
    // the water stands 65 cm down the shaft: an oasis well is full, and the
    // sand outside is at the head's foot, so anything deeper would show sand
    const deep = new THREE.Mesh(new THREE.CircleGeometry(1.72, 20), M("water"));
    deep.rotation.x = -Math.PI / 2; deep.position.y = 0.55;
    wh.add(deep);
    for (let s = -1; s <= 1; s += 2) {
      // an A-frame each side, feet on the coping, apex under the axle
      rod(wh, 0.1, 0.08, [s * 1.9, 1.4, 0.75], [s * 1.9, 3.95, 0.05], M("woodDark"), 7);
      rod(wh, 0.1, 0.08, [s * 1.9, 1.4, -0.75], [s * 1.9, 3.95, -0.05], M("woodDark"), 7);
      rod(wh, 0.05, 0.05, [s * 1.9, 2.3, 0.54], [s * 1.9, 2.3, -0.54], M("woodDark"), 5);
    }
    rod(wh, 0.2, 0.2, [-1.75, 3.8, 0], [1.75, 3.8, 0], M("woodDark"), 12);   // the windlass drum
    rod(wh, 0.05, 0.05, [-2.2, 3.8, 0], [2.3, 3.8, 0], M("post"), 6);         // its axle
    rod(wh, 0.045, 0.045, [2.3, 3.8, 0], [2.3, 3.28, 0.25], M("post"), 5);   // the crank arm
    rod(wh, 0.04, 0.04, [2.3, 3.28, 0.25], [2.62, 3.28, 0.25], M("post"), 5); // and its grip
    rod(wh, 0.018, 0.018, [0.35, 3.6, 0], [0.35, 2.25, 0], M("rope"), 5);
    const bucket = new THREE.Mesh(bucketGeo(), M("woodDark"));
    bucket.position.set(0.35, 1.88, 0);
    bucket.castShadow = true;
    wh.add(bucket);
    const bail = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.012, 3, 10, Math.PI), M("metalDark"));
    bail.position.set(0.35, 2.23, 0);
    wh.add(bail);
    /* AND THE HEAD MOVED TO THE OPEN SIDE. Twice now it has ended up behind
       a palm trunk or under the shade sail, and it is the one object that
       turns "an oasis" into "a well somebody dug" — if it is not the first
       thing you see the outpost has no name. */
    wh.position.set(9.5, -0.15 + GY(9.5, -4.5), -4.5);
    near.add(wh);
    col(CS, 9.5, 0.8, -4.5, 4.3, 1.6, 4.3, "well");

    // SHADE CLOTH — the wide flat thing. A pale sail 8 m across is the only
    // horizontal in a landscape of verticals, which is why a well reads
    // differently from a camp at range even though both are cloth.
    const sail = P.canopy({ w: 9, d: 7, h: 3.2, sag: 1.5, mat: "canvas" });
    sail.position.set(-9.5, -0.15 + GY(-9.5, 8.0), 8.0);
    near.add(sail);
    /* THE TROUGH IS HOLLOW. It was a solid plank block with a box of
       "water" sitting on top of it. Boards for a floor and four sides,
       and the water standing inside, below the rim. */
    const trough = new THREE.Group();
    box(trough, 3.6, 0.08, 0.9, M("wood"), 0, 0.12, 0);
    for (let s = -1; s <= 1; s += 2) {
      box(trough, 3.6, 0.52, 0.07, M("wood"), 0, 0.3, s * 0.415);
      box(trough, 0.07, 0.52, 0.9, M("wood"), s * 1.765, 0.3, 0);
      box(trough, 0.12, 0.2, 0.12, M("woodDark"), s * 1.4, 0.06, 0);      // the chocks it sits on
    }
    box(trough, 3.46, 0.02, 0.76, M("water"), 0, 0.44, 0);
    trough.position.set(-3.0, -0.15 + GY(-3.0, -8), -8);
    trough.rotation.y = 0.3;
    near.add(trough);
    // a low mud-brick wall, half fallen — somebody lived here
    const rn = ruin(7, 1.5, 0.9, r);
    rn.position.set(7.5, -0.15 + GY(7.5, -7), -7);
    rn.rotation.y = 0.5;
    near.add(rn);
    pushCols(CS, rn, 7.5, rn.position.y, -7, 0.5);

    /* SOMEBODY LIVES AT THE WELL, WHICH IS THE POINT OF A WELL. The half
       fallen wall above already says somebody DID; two standing houses beside
       it say somebody still does, and that is the difference between a
       landmark and a ruin. They sit away from the water on the dry side —
       nobody builds in the bottom of the bowl their own well is in. */
    const F = g.userData.folk;
    standAt(near, CS, F, -9.5, -3.0, { seed: (opts.seed || 23) * 23, w: 4.2, h: 2.7, mat: "canvas", drums: "metalDark", gy: GY });
    hamlet(near, far, CS, { n: 2, at: -2.2, spread: 1.0, r: 14, seed: (opts.seed || 23) * 41, gy: GY });
    folk(F, -8.5, 7.0, facing(-8.5, 7.0) + 0.4, "idler");      // under the sail
    folk(F, 8.2, -4.0, facing(8.2, -4.0) + 0.3, "hand");       // at the winch
    folk(F, -3.5, -6.8, facing(-3.5, -6.8) - 0.6, "hand");     // at the trough
    folk(F, -9.8, -9.6, facing(-9.8, -9.6) + Math.PI, "idler");// on his own step

    // ---- FAR: palm crowns and the sail. No mast: a well has no flag. ----
    /* STAGGER THE CROWNS. Eleven identical blocks at one height around one
       radius over a green disc photographed as a birthday cake at 900 m —
       a shape nothing in a desert has. Varying the height and the radius per
       tree turns it back into a grove. */
    for (let i = 0; i < 11; i++) {
      const a = i / 11 * TAU;
      const rr = 9.0 + W.hash01(i, 1, 771) * 4.5;
      const hh = 8.5 + W.hash01(i, 2, 773) * 4.5;
      box(far, 5.4, 1.7, 5.4, M("scrub"), 2.5 + Math.cos(a) * rr, hh, 3 + Math.sin(a) * rr, a);
      box(far, 1.1, hh, 1.1, M("palmTrunk"), 2.5 + Math.cos(a) * rr, hh / 2, 3 + Math.sin(a) * rr);
    }
    box(far, 11, 1.0, 9, M("canvas"), -9.5, 3.8, 8.0);
    const fp = new THREE.Mesh(new THREE.CircleGeometry(7.0, 12), M("water"));
    fp.rotation.x = -Math.PI / 2; fp.position.set(2.5, 0.15, 3);
    far.add(fp);
    const fgr = new THREE.Mesh(new THREE.CircleGeometry(9.5, 14), M("scrub"));
    fgr.rotation.x = -Math.PI / 2; fgr.position.set(2.5, 0.05, 3);
    far.add(fgr);

    return finish(g, opts);
  }

  // ---------------------------------------------------------- NIGHT MARKET
  function buildMarket(opts) {
    const g = shellFor(opts);
    const near = g.userData.near, far = g.userData.far;
    const r = stream(opts.seed == null ? 41 : opts.seed);
    const CS = g.userData.colliders;
    const GY = opts.groundAt || FLAT;
    if (OLD) { oldBlock(near, CS, 9, 2.5, "tarp"); return finish(g, opts); }

    /* THE MARKET IS THE ONE WITH NO MAST. Four wide low canopies in two
       facing rows with a lane between them: at range it is a flat dark bar
       and nothing else on this island is a flat dark bar. outpost.js's own
       blurb is "lamps, tarpaulin, and a man who does not ask where you got
       it", and a mast is exactly what a man who does not ask does not put up. */
    const stallCols = ["tarp", "canvasDark", "rust", "boxBlue"];
    for (let i = 0; i < 5; i++) {
      const side = i % 2 ? 1 : -1;
      const z = -5.5 + Math.floor(i / 2) * 5.8;
      const c = P.canopy({
        w: r.range(5.5, 7.5), d: r.range(4.5, 5.5), h: r.range(2.7, 3.2),
        mat: stallCols[i % stallCols.length],
      });
      const gz = GY(side * 4.8, z);
      c.position.set(side * 4.8, -0.15 + gz, z + r.range(-0.5, 0.5));
      c.rotation.y = r.range(-0.12, 0.12);
      near.add(c);
      col(CS, side * 4.8, 1.0 + gz, z, 1.2, 2.0, 4.4, "stall");
      // the counter under it, and the goods on it
      box(near, 0.9, 0.9, 4.6, M("wood"), side * 3.4, 0.3 + GY(side * 3.4, z), z);
      /* THE STOCK BESIDE EACH COUNTER, a different trade per stall: grain
         sacks, roped cloth bales, a row of water jars. It was five crates
         scaled to 60 % (toy crates, floating off their own scaled tiers). */
      const trade = i % 3;
      const gx = side * 5.9, gz2 = z + 1.4, gy = -0.12 + GY(gx, gz2);
      if (trade === 2) {
        for (let k = 0; k < 5; k++) {
          const j = new THREE.Mesh(jarGeo(), M("clay"));
          j.position.set(gx + (k % 2) * 0.3 * side, gy + 0.06, gz2 - 0.8 + k * 0.4);
          j.scale.setScalar(0.9 + (k % 3) * 0.12);
          j.castShadow = true;
          near.add(j);
        }
      } else {
        const goods = P.sacks({ n: trade ? 4 : 6, bales: trade === 1, seed: (opts.seed || 41) * (i + 3) });
        goods.position.set(gx, gy, gz2);
        goods.rotation.y = Math.PI / 2;
        near.add(goods);
      }
    }

    /* THE LAMPS. This is the only outpost that is meant to be read at NIGHT,
       so the lamps are emissive rather than lights — sixteen point lights
       across nine outposts is how the frame budget dies, and an emissive
       globe under this repo's fog reads as a lit lamp anyway. */
    for (let i = 0; i < 6; i++) {
      const side = i % 2 ? 1 : -1;
      const z = -7 + Math.floor(i / 2) * 6.4;
      const ly = GY(side * 2.4, z);
      /* A HURRICANE LANTERN ON A BRACKET. What stood here was a 62 cm
         full-emissive orange cube under a 90 cm tin plate: it shone at noon
         like a warning light. Now: a pole, an arm, and hanging off the arm a
         lantern at a real size (a tin base and cap, a glass chimney glowing
         a banked amber), turned to hang over the lane. */
      const px = side * 2.4;
      rod(near, 0.06, 0.05, [px, -0.3 + ly, z], [px, 3.3 + ly, z], M("post"), 6);
      rod(near, 0.035, 0.035, [px, 3.15 + ly, z], [px - side * 0.7, 3.15 + ly, z], M("post"), 5);
      const lx = px - side * 0.62, lt = 2.72 + ly;
      rod(near, 0.006, 0.006, [lx, 3.13 + ly, z], [lx, lt + 0.34, z], M("metalDark"), 3);
      cyl(near, 0.08, 0.09, 0.05, 10, M("metalDark"), lx, lt, z);
      const glass = new THREE.Mesh(lathe("lampglass", [[0.001, 0], [0.065, 0.0], [0.085, 0.09], [0.07, 0.2], [0.045, 0.25], [0.001, 0.25]], 10), M("lamp"));
      glass.position.set(lx, lt + 0.025, z);
      near.add(glass);
      cyl(near, 0.02, 0.085, 0.07, 10, M("metalDark"), lx, lt + 0.3, z);
    }
    const f = P.fire({ seed: (opts.seed || 41) * 3, smokeH: 7 });
    f.position.set(0, -0.05 + GY(0, 8), 8);
    near.add(f);
    const bales = P.sacks({ n: 7, bales: true, seed: (opts.seed || 41) * 19 });
    bales.position.set(0, -0.1 + GY(0, -11), -11);
    near.add(bales);
    const rn = ruin(9, 2.4, 1.1, r);
    rn.position.set(-10, -0.15 + GY(-10, 2), 2);
    rn.rotation.y = Math.PI / 2;
    near.add(rn);
    pushCols(CS, rn, -10, rn.position.y, 2, Math.PI / 2);
    // one banner, small, on a stall — not a mast
    const b = P.banner(opts.colour == null ? 0x8f4fb8 : opts.colour, { h: 4.4, fly: 1.6, seed: opts.seed || 41 });
    b.position.set(-4.8, 2.6, -5.5);
    g.add(b);

    /* THE MARKET DOES NOT GET A STALL ADDED TO IT — it is five of them
       already, and the counter under each canopy was here before this pass.
       What it was missing is anybody standing behind those counters, and a
       far end to the lane. The keepers stand OUTSIDE their own counters at
       x = ±5.2 facing across it, which is what makes the gap between the two
       rows read as a lane you walk down rather than a gap between props.

       And three houses close the -Z end. A night market is held in a place,
       and the place it is held in is the edge of somebody's village — which
       is also the only thing that stops the lane running off into open sand
       at both ends, the way the first pass photographed. */
    const F = g.userData.folk;
    for (let i = 0; i < 4; i++) {
      const side = i % 2 ? 1 : -1;
      const z = -5.5 + Math.floor(i / 2) * 5.8;
      // he faces ACROSS the lane, at his own customers: -x side looks to +x
      folk(F, side * 5.2, z, side > 0 ? -Math.PI / 2 : Math.PI / 2, i === 0 ? "trader" : "hand");
    }
    folk(F, 0.0, -2.0, 0.4, "idler");
    folk(F, 0.6, 4.0, Math.PI - 0.3, "idler");
    folk(F, 1.6, 7.0, facing(1.6, 7.0), "guard");
    hamlet(near, far, CS, { n: 3, at: -Math.PI / 2, spread: 1.3, r: 15, seed: (opts.seed || 41) * 43, gy: GY });

    // ---- FAR: two low dark bars. No verticals. The 2.4 m glowing orange
    // cube that stood in for the cook fire at range is gone: at a kilometre
    // it was a lit box on the horizon, day and night. -------
    for (let s = -1; s <= 1; s += 2) box(far, 7, 3.4, 19, M("tarp"), s * 4.8, 2.6, 0);
    box(far, 20, 0.6, 22, M("sandDark"), 0, 0.3, 0);

    return finish(g, opts);
  }

  /* scatterKit() WAS HERE, and it is gone with its only caller. It published
     this file's rock / bush / bone / wreck geometry so desert.js's world
     scatter drew the same objects the hero props do. desert.js no longer has
     a scatter — the owner asked for the island to be bare, twice — so this
     was an exported function with nothing on the other end of it. The
     geometry itself stays: the props that actually place rocks (boulder
     fields, gabions, rubble at a collapsed wall) still use rockGeo(). */
  let _brush = null, _rib = null, _chassis = null;
  function brushGeo() {
    if (_brush) return _brush;
    // a dead desert bush: six splayed twigs, not a cone. A cone in a desert
    // reads as a Christmas tree and desert.js's scatter is full of them.
    const t = [];
    for (let i = 0; i < 7; i++) {
      const a = i / 7 * TAU, lean = 0.55 + (i % 3) * 0.14;
      const tx = Math.cos(a) * lean, tz = Math.sin(a) * lean;
      const w = 0.05;
      t.push(-w, 0, 0, w, 0, 0, tx, 1, tz);
      t.push(0, 0, -w, 0, 0, w, tx, 1, tz);
    }
    _brush = soup(t);
    return _brush;
  }
  function ribGeo() {
    if (_rib) return _rib;
    _rib = new THREE.TorusGeometry(0.55, 0.05, 3, 6, Math.PI);
    return _rib;
  }
  function chassisGeo() {
    if (_chassis) return _chassis;
    // a burnt chassis rather than a 2.2×1.4×5.0 box: cab, bed, and a gap
    // between them, which is what makes a wreck at 200 m read as a vehicle
    const t = [];
    function bx(cx, cy, cz, sx, sy, sz) {
      const X = [cx - sx / 2, cx + sx / 2], Y = [cy - sy / 2, cy + sy / 2], Z = [cz - sz / 2, cz + sz / 2];
      const q = function (a, b, c, d) { t.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2], a[0], a[1], a[2], c[0], c[1], c[2], d[0], d[1], d[2]); };
      const V = function (i, j, k) { return [X[i], Y[j], Z[k]]; };
      q(V(0, 0, 0), V(1, 0, 0), V(1, 1, 0), V(0, 1, 0));
      q(V(1, 0, 1), V(0, 0, 1), V(0, 1, 1), V(1, 1, 1));
      q(V(0, 0, 1), V(0, 0, 0), V(0, 1, 0), V(0, 1, 1));
      q(V(1, 0, 0), V(1, 0, 1), V(1, 1, 1), V(1, 1, 0));
      q(V(0, 1, 0), V(1, 1, 0), V(1, 1, 1), V(0, 1, 1));
      q(V(0, 0, 1), V(1, 0, 1), V(1, 0, 0), V(0, 0, 0));
    }
    bx(0, 0.5, 1.4, 2.2, 1.0, 2.2);    // cab
    bx(0, 0.35, -1.3, 2.0, 0.5, 3.0);  // flatbed
    bx(0, 0.75, -2.6, 1.9, 1.2, 0.2);  // the one standing panel
    _chassis = soup(t);
    return _chassis;
  }

  /* ============================================================ THE FRAME
     One updater for the whole library: the banner cloth, the fire flicker,
     the smoke drift and the LOD swap. Sixty banners at three segments is 180
     matrix composes; the fires are one scale write each. Registered at order
     46 — after the world moves and before the frame is drawn. */
  let clock = 0;
  function tickAll(dt) {
    clock += dt || 0.016;
    const cam = CBZ.camera;
    const out = [];
    for (let i = liveBanners.length - 1; i >= 0; i--) {
      const b = liveBanners[i];
      if (!b.segs[0].parent) { liveBanners.splice(i, 1); continue; }
      clothChain(clock, b.phase, b.fly, b.drop, out);
      for (let k = 0; k < CLOTH_SEG; k++) {
        const o = out[k];
        b.segs[k].position.set(o.x, o.y, o.z);
        b.segs[k].rotation.set(0, -o.yaw, o.pitch);
      }
    }
    // PRUNE AS WE GO. A campaign that rides past forty camps registers forty
    // fires; without this the list only grows and the frame cost of a torn-down
    // outpost never goes away.
    for (let i = liveFires.length - 1; i >= 0; i--) {
      const f = liveFires[i];
      const fl = f.userData.flame;
      if (!fl || !fl.parent || !f.parent) { liveFires.splice(i, 1); continue; }
      const k = 0.78 + Math.sin(clock * 11 + f.userData.phase) * 0.12 + Math.sin(clock * 27 + f.userData.phase * 3) * 0.09;
      fl.scale.set(k, k * 1.15, k);
      const sm = f.userData.smoke;
      if (sm) sm.rotation.y = Math.sin(clock * 0.23 + f.userData.phase) * 0.5 + WIND.dir;
    }
    if (cam) P.lodTick(cam.position);
  }

  /* ============================================================ MEASURE
     The two claims in this file's brief, as numbers, taken the only way a
     draw-call claim can honestly be taken: render with everything else
     hidden and read the renderer's own counter.

       fieldDraws  the sixty-banner field plus the hundred-and-twenty-rock
                   cover field, together, in draw calls
       coverBoxes  how many registered colliders combat_iq would actually
                   ACCEPT as cover — its own thresholds, applied here
                   (systems/combat_iq.js: height >= 0.85, foot <= 1.2, and at
                   least 0.7 across). A prop that draws beautifully and fails
                   this test is scenery, and the point of this file is that
                   the cover is real. */
  P.measure = function (fields) {
    const R = CBZ.renderer, cam = CBZ.camera, scene = CBZ.scene;
    const out = { fieldDraws: null, coverBoxes: 0, totalDraws: null, tris: null };
    const boxes = (CBZ.micro && CBZ.micro.colliders) || [];
    for (let i = 0; i < boxes.length; i++) {
      const c = boxes[i];
      if (!c || !c.warlordProp) continue;
      const h = (c.y1 == null) ? 99 : c.y1 - (c.y0 || 0);
      if (h < 0.85 || (c.y0 || 0) > 1.2) continue;
      const ew = c.hw != null ? c.hw * 2 : c.maxX - c.minX, ed = c.hd != null ? c.hd * 2 : c.maxZ - c.minZ;
      if (ew < 0.7 && ed < 0.7) continue;
      out.coverBoxes++;
    }
    if (!R || !cam || !scene) return out;
    R.render(scene, cam);
    out.totalDraws = R.info.render.calls;
    out.tris = R.info.render.triangles;
    if (fields && fields.length && galleryRoot) {
      const was = [];
      galleryRoot.traverse(function (o) { if (o !== galleryRoot && o.parent === galleryRoot) was.push([o, o.visible]); });
      for (let i = 0; i < was.length; i++) was[i][0].visible = fields.indexOf(was[i][0]) >= 0;
      /* FRUSTUM CULLING WOULD MAKE THIS NUMBER A LIE. The camera is wherever
         the current tripod put it, and the two fields are eighty metres
         apart — so a shot framed on the depot would report "0 draw calls for
         sixty banners", which is true and useless. Culling off for the
         measurement, restored after: the number then means "what these
         fields cost when you are looking at them", which is the number the
         claim is about. */
      const culled = [];
      for (let i = 0; i < fields.length; i++) {
        fields[i].traverse(function (o) { if (o.isMesh) { culled.push([o, o.frustumCulled]); o.frustumCulled = false; } });
      }
      R.render(scene, cam);
      out.fieldDraws = R.info.render.calls;
      for (let i = 0; i < culled.length; i++) culled[i][0].frustumCulled = culled[i][1];
      for (let i = 0; i < was.length; i++) was[i][0].visible = was[i][1];
      R.render(scene, cam);
    }
    return out;
  };

  /* ============================================================ AUDIT */
  P.audit = function () {
    const info = CBZ.renderer && CBZ.renderer.info;
    return {
      materials: Object.keys(_mats).length,
      geometries: _geo.size,
      rockSource: NO_ROCK ? "icosahedron (?proprock=box)" : "local scrape (rockscliffs.makeRock is dead on r128 — see comment)",
      wreckSource: milState === "ready" ? "studio.model (shipped)" : milState,
      guns: !!(CBZ.weaponAppearance && CBZ.weaponAppearance.ak47),
      banners: liveBanners.length, fires: liveFires.length, lod: lodList.length,
      skins: Object.keys(SKIN_KIND).length,
      shapes: _shape.size,
      draws: info ? info.render.calls : null,
      tris: info ? info.render.triangles : null,
      old: OLD,
      lights: lightReport,
    };
  };

  /* ============================================================ THE GALLERY
     ?props=1 — every prop in this file in a row on a flat pad, with a camera
     tour. It exists so this file can be looked at without desert.js,
     campaign.js or battle.js being finished, and it is what the before/after
     preset photographs. */
  const SHOTS = P.SHOTS = [
    { id: "depot",    label: "ARMS DEPOT",      eye: [-62, 15, 36],  aim: [-90, 4, -3],  fov: 44 },
    { id: "camp",     label: "RECRUIT CAMP",    eye: [-20, 15, 44],  aim: [-20, 3, -4],  fov: 46 },
    { id: "well",     label: "WELL / OASIS",    eye: [52, 14, 34],   aim: [42, 3, 2],    fov: 50 },
    { id: "market",   label: "NIGHT MARKET",    eye: [98, 13, 34],   aim: [98, 2, 0],    fov: 46 },
    { id: "banners",  label: "FACTION BANNERS", eye: [-36, 6, 112],  aim: [-36, 5, 92],  fov: 44 },
    { id: "field",    label: "SIXTY BANNERS",   eye: [86, 22, 128],  aim: [86, 4, 92],   fov: 48 },
    { id: "wrecks",   label: "WRECKAGE",        eye: [0, 34, 236],   aim: [0, 1, 156],   fov: 44 },
    { id: "cover",    label: "BATTLE COVER",    eye: [0, 13, 244],   aim: [0, 1.2, 214], fov: 46 },
    { id: "rockfield", label: "120 ROCKS, BATCHED", eye: [150, 16, 268], aim: [150, 1, 214], fov: 48 },
    { id: "camp2",    label: "YOUR BIVOUAC",    eye: [0, 12, 298],   aim: [0, 1.2, 276], fov: 46 },
    /* THE ONE THAT JUSTIFIES THE FAR LOD. 880 m back and fov 14: the four
       outposts span 188 m and the frame is 341 m wide at that range, so they
       fill just over half of it and a 17 m crane is ~59 px. Worked out
       rather than eyeballed, because at fov 24 the first pass put the whole
       island in a third of the frame and every silhouette was six pixels —
       which proves nothing either way. */
    { id: "range",    label: "SILHOUETTES AT 880 m", eye: [4, 140, 880], aim: [4, 16, -4], fov: 14 },
    { id: "houses",   label: "HOUSES",           eye: [0, 7, 312],    aim: [0, 1.8, 330], fov: 50 },
    { id: "interior", label: "INSIDE A HOUSE",   eye: [-12.7, 1.55, 328.75], aim: [-15.0, 0.7, 331.1], fov: 70 },
  ];

  /* THE PAGE IS DOUBLE-LIT. Counted and reported, NOT fixed, and the
     pictures are why — both attempts are written down.

     THE BUG: CBZ.micro.boot() builds a hemi+sun pair unless told
     `lights: false`; games/warlord.html then calls micro.lights() with its
     own desert numbers, which ADDS a second pair. Measured live:
     HemisphereLight 0.62 + 0.62 and DirectionalLight 1.05 + 1.12. A sunlit
     top face is therefore multiplied by roughly 3.1 before ACES, so any
     colour above about 0.32 linear arrives at the screen as white.

     THE BUG: CBZ.micro.boot() builds a hemi+sun pair unless told
     `lights: false`; games/warlord.html then calls micro.lights() with its
     own desert numbers, which ADDS a second pair. Measured live:
     HemisphereLight 0.62 + 0.62 and DirectionalLight 1.05 + 1.12.

     I DID remove the duplicate pair here for one run, on the theory that it
     was what made every photograph white. It was not — see the palette
     block; sRGB output encoding was always the bigger half — and staging
     the lighting meant the gallery was a picture of a game nobody plays.
     So this counts, warns, names the one-word fix, and changes nothing.
     Two files owning the sun is a third bug anyway. */
  function auditLights() {
    const scene = CBZ.scene;
    if (!scene) return 0;
    const hemis = [], suns = [];
    scene.traverse(function (o) {
      if (o.isHemisphereLight) hemis.push(o);
      else if (o.isDirectionalLight) suns.push(o);
    });
    lightReport = { hemi: hemis.length, sun: suns.length };
    if (hemis.length > 1 || suns.length > 1) {
      console.warn("[warlord/props] games/warlord.html double-lights the scene: " +
        hemis.length + " hemisphere + " + suns.length + " directional. Everything in the " +
        "game is roughly 1.8x brighter than intended. The fix is `lights: false` in the " +
        "page's CBZ.micro.boot() call, or moving its light options into it. NOT fixed " +
        "here — this gallery photographs the lighting the game actually ships.");
    }
    return hemis.length + suns.length;
  }
  let lightReport = null;

  P.gallery = function () {
    const scene = CBZ.scene;
    if (!scene || galleryRoot) return galleryRoot;
    auditLights();
    galleryRoot = new THREE.Group();
    galleryRoot.name = "warlordPropGallery";
    // a pad, big enough that no shot sees its edge
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(1600, 1600), M("sand"));
    pad.rotation.x = -Math.PI / 2;
    pad.receiveShadow = true;
    galleryRoot.add(pad);

    const put = function (g, x, z, yaw) { P.place(g, x, 0, z, yaw || 0); galleryRoot.add(g); return g; };

    put(P.outpost("depot",  { seed: 7,  colour: 0xb9a13f }), -90, 0, 0.35);
    put(P.outpost("camp",   { seed: 13, colour: 0x4a8f5a }), -20, 0, -0.2);
    put(P.outpost("well",   { seed: 23 }), 42, 0, 0.6);
    put(P.outpost("market", { seed: 41, colour: 0x8f4fb8 }), 98, 0, 0.1);

    // the five factions, one hero banner each
    const F = W.FACTIONS || [];
    for (let i = 0; i < F.length; i++) {
      put(P.banner(F[i].colour, { h: 7.5, seed: i + 1 }), -60 + i * 12, 92, 0);
    }
    // and sixty of them, in three draw calls
    const field = P.bannerField({ cap: 64, liveR: 4000 });
    for (let i = 0; i < 60; i++) {
      const fx = 62 + (i % 10) * 5.4, fz = 78 + Math.floor(i / 10) * 5.6;
      field.add(fx, 0, fz, F.length ? F[i % F.length].colour : 0xc4593a, 0.8 + (i % 3) * 0.12);
    }
    galleryRoot.add(field.group);
    galleryField = field;
    P.fields = [field.group];

    // 55 m apart, not 40: the cargo plane is 45 m across the wings and at
    // 40 m spacing it stood in the truck's lap.
    const wk = P.wreckKinds;
    for (let i = 0; i < wk.length; i++) {
      put(P.wreck(wk[i], { seed: 100 + i * 7 }), -110 + i * 55, 156, i * 0.7);
    }
    // and the cover row goes the other way: 9 m, not 20. Nine kinds over 160 m
    // needed a camera so far back that every one of them was forty pixels.
    const ck = P.coverKinds;
    for (let i = 0; i < ck.length; i++) {
      put(P.cover(ck[i], { w: 3.2, h: 1.9, d: 2.4, seed: 200 + i * 11 }), -36 + i * 9, 214, i * 0.4);
    }
    // and one real field: 120 boulders, batched, so the draw count is honest
    const list = [];
    for (let i = 0; i < 120; i++) {
      const a = W.hash01(i, 3, 91) * TAU, rr = 6 + Math.sqrt(W.hash01(i, 5, 97)) * 34;
      list.push({ x: Math.cos(a) * rr, z: Math.sin(a) * rr, y: 0,
                  w: 1.4 + W.hash01(i, 7, 101) * 3.4, h: 1.1 + W.hash01(i, 9, 103) * 2.2,
                  d: 1.3 + W.hash01(i, 11, 107) * 3.0, yaw: W.hash01(i, 13, 109) * TAU,
                  kind: W.hash01(i, 15, 113) < 0.25 ? "slab" : "boulder" });
    }
    const cf = P.coverField(list);
    cf.group.position.set(150, 0, 214);
    galleryRoot.add(cf.group);
    P.fields.push(cf.group);

    put(P.bivouac({ men: 40, seed: 5, colour: 0xd9b979 }), 0, 276, 0);
    // the three houses, settled the way a compound settles them, and one of
    // them with its door toward the camera so the interior shot can walk in
    const hk = P.houseKinds;
    for (let i = 0; i < hk.length; i++) put(settle(P.house({ kind: hk[i], seed: 11 + i, rot: 0 })), -14 + i * 14, 330, 0);

    scene.add(galleryRoot);
    return galleryRoot;
  };
  let galleryRoot = null, galleryField = null;

  P.look = function (id) {
    const cam = CBZ.camera;
    let s = null;
    for (let i = 0; i < SHOTS.length; i++) if (SHOTS[i].id === id) s = SHOTS[i];
    if (!cam || !s) return null;
    cam.position.set(s.eye[0], s.eye[1], s.eye[2]);
    cam.lookAt(s.aim[0], s.aim[1], s.aim[2]);
    if (s.fov) { cam.fov = s.fov; cam.updateProjectionMatrix(); }
    if (galleryField) galleryField.tick(clock, null);
    P.lodTick(cam.position);
    return s;
  };

  /* ============================================================ MODULE
     Registered as the API OBJECT ITSELF, not a fresh {needs, boot} literal —
     core's W.module does `W[name] = api`, and handing it a literal would
     replace W.props with an object holding two keys, which is the trap
     desert.js's own comment shouts about.

     boot() costs a script tag, a studio.need() and one updater. It builds no
     geometry: nine outposts of prop meshes at page load is a second-long
     stall before the title card, and the campaign does not need one until
     you are on the island. */
  P.needs = [];
  P.boot = function (ctx) {
    P.ctx = ctx;
    wantMil();
    if (CBZ.onUpdate) CBZ.onUpdate(46.0, tickAll);
    if (ctx && ctx.Q && ctx.Q.get("audit") === "1") {
      try { console.log("[warlord/props]", P.audit()); } catch (e) {}
    }
    if (!Q.get("props")) return;
    /* THE GALLERY ENTRY. Deferred a beat so every other module has booted and
       the page's own menu is up to be closed; the wait loop is on the LAZY
       deps, not on a number of milliseconds, so the pictures always contain
       the real rock and the real truck rather than whatever had landed when
       a timer fired. */
    const start = Date.now();
    (function waitThenBuild() {
      const ready = milState === "ready" || milState === "absent" || Date.now() - start > 8000;
      if (!ready) { setTimeout(waitThenBuild, 60); return; }
      if (ctx && ctx.closeScreen) ctx.closeScreen();
      const hud = ctx && ctx.hud;
      if (hud) hud.classList.remove("on");
      /* THE PHASE STAYS "menu". Handing it to campaign.js would raise the
         whole 14 km island under the gallery and this entry exists precisely
         so props.js is never blocked on campaign.js existing. The screen is
         closed by hand instead, and micro's own render loop draws CBZ.scene
         whether or not anybody owns a phase. */
      /* A THROW IN HERE USED TO BE A HANG. The readiness flag is what every
         photography tool waits on, so an exception while building the
         gallery presented as "the page never came up" with no error anywhere
         — I lost two headless runs to exactly that. The flag is raised
         either way and the error is published beside it. */
      G.__warlordProps = P;
      try {
        P.gallery();
        P.look(Q.get("shot") || "depot");
        console.log("[warlord/props] gallery", P.audit());
      } catch (e) {
        G.__warlordPropsError = String((e && e.stack) || e);
        console.error("[warlord/props] gallery failed", e);
      }
      G.__warlordPropsReady = true;
    })();
  };
  W.module("props", P);
})();
