/* ============================================================
   city/biome_desert.js — THE DESERT (an open archipelago biome).

   WHY THIS PLACE EXISTS (owner's why-first law):
   A city of glass towers needs an EDGE — somewhere the grid runs out
   and the land takes over. The desert is that edge: a vast, empty
   tan basin you cross to GET somewhere (the lone gas station you
   limp to when your car's dry, the motel you hole up in, the mesas
   that hide a body), not a decorated lobby. Every prop here earns
   its place by being a reason to drive out: FUEL + FOOD (gas/diner),
   SHELTER (motel), a relic worth poking at (mining outpost), and the
   HIGHWAY that strings them together back to the speedway island.

   ARCHIPELAGO CONTRACT (worldmap.js):
     CBZ.addLandmass(builder, order)  — builder gets the live `city`.
     CBZ.registerCityRegion(city, reg) — declare the walkable land.
   Footprint: PUBLISHED BY world/layout.js (CBZ.worldFoot("desert")) — the
   authored rect is centre (1120,150), half-extents (440,470), and the world
   dial plus the stage-4 footprint scale are applied there, in the one place
   that holds all three. Do not re-type a half-extent from this file; ask.
   Causeway: a ~14-wide desert highway deck from the desert's west
   edge (~x670, z-300) to the speedway island's east edge (~x670,
   z-330, the circle center 470,-330 r200). Registered as its own
   thin walkable rect so you can drive/walk the land-bridge.

   The terrain, roads, real buildings and authored saguaro field stay. The
   former filler layer — rocks, scrub, tumbleweeds, poles and bones — is
   opt-in; barren terrain between cacti is not a surface to fill with props.

   Local seeded RNG → the same desert every run.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const cmat = CBZ.cmat || CBZ.mat;
  const CFG = (CBZ.CONFIG = CBZ.CONFIG || {});
  if (CFG.DESERT_TERRAIN_V2 == null) CFG.DESERT_TERRAIN_V2 = true;
  // ---- DESERT_ROCK_SCATTER (owner: "the desert region little gray rocks are
  // removed entirely") — DEFAULT FALSE, which is the removal. Two scatters
  // answer to it: the 140-candidate icosahedron boulder field (5) and the 22
  // fractured clusters ringing Dry Gulch (5b). Both were grey (ROCK_GREY
  // 0x8c7d68) basin clutter that read as gravel dropped on sand. THE RED-ROCK
  // MESAS ARE NOT ROCKS IN THIS SENSE and stay: they are the basin's only
  // orientation cues and its only collidered landmarks.
  if (CFG.DESERT_ROCK_SCATTER == null) CFG.DESERT_ROCK_SCATTER = false;
  // Saguaros are landscape identity, not generic prop scatter. Keep the
  // existing authored field by default while the unrelated filler stays off.
  if (CFG.DESERT_CACTI == null) CFG.DESERT_CACTI = true;
  if (CFG.DESERT_PROP_SCATTER == null) CFG.DESERT_PROP_SCATTER = false;
  // ---- DESERT_DUNES_V3 (owner: "the desert region hills are varied in size
  // more, some massive like the dunes im saying") — see desertDuneHeightAt.
  if (CFG.DESERT_DUNES_V3 == null) CFG.DESERT_DUNES_V3 = true;

  // ---- footprint (MASSIVE basin) -------------------------------------------
  // North edge is the causeway tuck to the speedway island and the west edge
  // is open country east of it; the desert sprawls EAST and DEEP to the south.
  // A genuinely vast empty tan basin you drive across, not a lobby.
  //
  // THE RECT IS NOT TYPED HERE ANY MORE. world/layout.js owns the anchor, the
  // world-layout dial AND the stage-4 footprint scale, and publishes the three
  // composed (CBZ.worldFoot). This file was one of two that another file
  // hand-copied a half-extent from (biome_farmland.js re-typed our north shore
  // as `-320 + dz`), so a scale applied here would have gone stale there. The
  // authored literals stay as the degrade-safe fallback — a build without
  // layout.js gets exactly the old rect.
  const _WOFF = (CBZ.worldOff && CBZ.worldOff("desert")) || { dx: 0, dz: 0 };   // world-layout dial
  const _FOOT = (CBZ.worldFoot && CBZ.worldFoot("desert")) ||
    { cx: 1120 + _WOFF.dx, cz: 150 + _WOFF.dz, hx: 440, hz: 470 };
  const CX = _FOOT.cx, CZ = _FOOT.cz, HX = _FOOT.hx, HZ = _FOOT.hz;
  const FSC = (CBZ.worldFootScale && CBZ.worldFootScale("desert")) || 1;        // linear footprint scale
  const MINX = CX - HX, MAXX = CX + HX;   // authored 680 .. 1560
  const MINZ = CZ - HZ, MAXZ = CZ + HZ;   // authored -320 .. 620

  // ---- causeway (land-bridge to the speedway island) -----------------------
  // IT HAS TO LAND ON BOTH SHORES, AND FOR TWO STAGES IT DID NOT. The deck's
  // z was the literal `-300 + speedway.dz` and its west end the literal
  // `speedwayCX + 170`, both measured when the basin's north shore sat at
  // z -320. Stage 3 then slid the desert 300 u SOUTH and nothing told this
  // line: the east end has been ending 280 u short of its own biome, in open
  // country, ever since.
  //
  // So both ends derive from the shapes they dock into. The centreline is the
  // authored z CLAMPED into the basin's own z-span (45 u inside the edge, so
  // the deck's 12 u half-width plus the region pad still sits on land), and the
  // west end is the speedway CIRCLE's east rim AT THAT z — a chord, not a
  // radius, which is what the old +170 was silently assuming.
  const _SPOFF = (CBZ.worldOff && CBZ.worldOff("speedway")) || { dx: 0, dz: 0 };
  const _SPD_CX = 490 + _SPOFF.dx, _SPD_CZ = -350 + _SPOFF.dz, _SPD_R = 210;  // island_speedway CX/CZ/R
  const CW = 14;                          // road width
  // Gated on the STAGE layout.js actually resolved to, never on the flag
  // alone: WORLD_SCALE_V4 rides on top of WORLD_LAYOUT_V2, so reading the raw
  // flag would re-derive this deck in a world that is otherwise stage 2.
  const _CW_DERIVE = (CBZ.WORLD_LAYOUT_STAGE || 1) >= 4;
  // WORLD_SCALE_V5 — the 10x basin. Read the same way (the STAGE, never the
  // raw flag). Four things in this file answer to it and each says so where it
  // stands: this deck's inland corner, the corridor gate, the erg mesh, and
  // the natural-scatter density.
  const _V5 = (CBZ.WORLD_LAYOUT_STAGE || 1) >= 5;
  const CW_Z = _CW_DERIVE
    ? Math.max(MINZ + 45, Math.min(MAXZ - 45, -300 + _SPOFF.dz))
    : (-300 + _SPOFF.dz);                 // causeway centerline z
  const _CW_CHORD = Math.sqrt(Math.max(0, _SPD_R * _SPD_R - (CW_Z - _SPD_CZ) * (CW_Z - _SPD_CZ)));
  const CW_X0 = _CW_DERIVE
    ? (_SPD_CX + _CW_CHORD - 34)          // noses 34u inside the speedway's east rim at THIS z
    : ((490 + _SPOFF.dx) + 170);          // authored: rim-at-the-equator + a guess
  // Inland end of the deck. 6 u is a tuck into the shore and nothing more,
  // which was fine while the basin's spine sat 700 m away. On the 10x basin
  // the spine is 2.3 km south of this dock (see the layout header: the erg
  // grows east and south so its north-west corner can stay put), so the deck
  // TURNS here and runs down to the highway — and a corner needs to be far
  // enough inside the shore that a 24 m deck plus its region pad is on land.
  const CW_X1 = _V5 ? (MINX + 30) : (MINX + 6);

  // NATURAL SCATTER RIDES THE AREA on the 10x basin, and only there. The
  // saguaro field, the brush and the tumbleweeds are fixed candidate counts
  // (90 / 110 / 24) laid over whatever rect this biome happens to have, so
  // their DENSITY has silently fallen with every footprint scale — 109 per
  // km^2 as authored, 42 by stage 4, and 4 per km^2 on a 21 km^2 erg, which
  // is one saguaro every 490 m: not a desert, a beach. Holding the STAGE-4
  // density rather than the authored one is deliberate — it leaves today's
  // world untouched, which is what makes the flag a real one-line revert.
  // Everything here is instanced, so 900 saguaros cost the same draw call as
  // 90, and the counts stay deterministic (build-time constants over the
  // biome's own seeded stream, replayed whole on every rebuild).
  const SCAT = _V5 ? Math.max(1, Math.round((FSC / 1.60) * (FSC / 1.60))) : 1;

  // ---- palette (warm tan basin; one shared material per color) -------------
  const SAND      = 0xcdb486;             // sun-worn ochre, not yellow plastic
  const SAND_DK   = 0xb49a70;             // dune-shadow / riverbed
  const SAND_PALE = 0xdcc99f;             // sun-bleached dune crest
  const RED_ROCK  = 0x946044;             // muted mesa sandstone
  const RED_DK    = 0x684637;             // mesa shadow band
  const ROCK_GREY = 0x8c7d68;             // boulders
  const CACTUS    = 0x4f7a43;             // saguaro green
  const SCRUB     = 0x8a8a4a;             // dry desert brush
  const TUMBLE    = 0x9c8a55;             // tumbleweed
  const ASPHALT   = 0x4a4742;             // faded highway
  const LINE_PALE = 0xc9bf8e;             // sun-faded center line
  const POLE      = 0x6e5436;             // creosote telephone pole
  const BONE      = 0xe9e2cf;             // bleached bone

  // ---- THE TOWN ("Dry Gulch") sub-rect ------------------------------------
  // An Old-West main-street town strung ALONG the desert highway (HWY_Z =
  // CZ-40), east-central so it clears the mesas (west/north) and the played-
  // out mine (far west). The scatter loops below SKIP anything inside this
  // rect so cacti/boulders/bones don't spawn in the streets. If CBZ.buildTown
  // is absent the rect is harmless (scatter just fills it like before) — the
  // town only appears when the foundation generator exists.
  const TOWN_CX = CX + 30, TOWN_CZ = CZ - 40;       // on the highway spine
  const TOWN_HX = 130, TOWN_HZ = 70;                // half-extents
  const TOWN = { minX: TOWN_CX - TOWN_HX, maxX: TOWN_CX + TOWN_HX, minZ: TOWN_CZ - TOWN_HZ, maxZ: TOWN_CZ + TOWN_HZ };
  const HWY_Z = CZ - 40;
  // PUBLISHED, because somebody else has to hit it. biome_farmland.js's Coyle
  // causeway drops south out of the farm county and is supposed to T onto this
  // spine; it used to reach it by the coincidence that "our north shore + 600"
  // landed near it, which stopped being true the moment this basin's HZ grew
  // (the spine sits HZ-40 south of the shore, not 600). One published number,
  // one junction, and the deck follows any future scale.
  CBZ.DESERT_HWY_Z = HWY_Z;
  // The town generator's three 64m blocks + road shoulders occupy this exact
  // stretch. The regional highway stops at its two edges, then Dry Gulch owns
  // the main street itself—no duplicate asphalt/decal planes fighting at y=0.
  const TOWN_SPINE_MIN = TOWN.minX + 10, TOWN_SPINE_MAX = TOWN.maxX - 10;
  // Roadside services belong beside the settlement, not under its lots.
  // Keeping them outside the generated town turns the approach into a clear
  // sequence (gas stop -> town -> motel) rather than a collision of assets.
  const GAS_X = TOWN.minX - 72, GAS_Z = HWY_Z + 22;
  const MOTEL_X = TOWN.maxX + 48, MOTEL_Z = HWY_Z + 26;
  // These are data, not late geometry. Keeping the landmark footprints here
  // lets the placement layer protect their future sites BEFORE cactus/rock
  // scatter runs, instead of hoping the random passes miss them.
  // The offsets ride the footprint scale (their SIZES do not): a mesa is a
  // landmark, so when the basin doubles they have to spread with it or seven
  // buttes cluster in the middle of an empty rectangle. Heights are authored
  // and stay authored — a bigger basin is not a reason for taller rock.
  const MESAS = [
    { x: CX - 220 * FSC, z: CZ - 150 * FSC, w: 70, d: 55, h: 24 },
    { x: CX + 180 * FSC, z: CZ + 120 * FSC, w: 95, d: 70, h: 30 },
    { x: CX + 120 * FSC, z: CZ - 200 * FSC, w: 55, d: 60, h: 20 },
    { x: CX - 140 * FSC, z: CZ + 180 * FSC, w: 60, d: 48, h: 22 },
    { x: CX - 260 * FSC, z: CZ + 340 * FSC, w: 84, d: 66, h: 38 },
    { x: CX + 250 * FSC, z: CZ + 300 * FSC, w: 62, d: 74, h: 28 },
    { x: CX + 40 * FSC, z: CZ + 400 * FSC, w: 100, d: 80, h: 44 },
  ];
  const HAS_TOWN = typeof CBZ.buildTown === "function";
  function inTown(x, z) {
    return HAS_TOWN && x > TOWN.minX - 6 && x < TOWN.maxX + 6 && z > TOWN.minZ - 6 && z < TOWN.maxZ + 6;
  }

  function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
  function smooth01(v) { v = clamp01(v); return v * v * (3 - 2 * v); }
  function terrainNoise(x, z) {
    const N = window.noise;
    if (N && N.rangeVnoise) return N.rangeVnoise(x, z);
    const h = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
    return h - Math.floor(h);
  }
  function flatRectFactor(x, z, cx, cz, hx, hz, feather) {
    const dx = Math.abs(x - cx) - hx, dz = Math.abs(z - cz) - hz;
    const outside = Math.hypot(Math.max(0, dx), Math.max(0, dz));
    if (Math.max(dx, dz) <= 0) return 0;
    return smooth01(outside / Math.max(1, feather));
  }

  // Weathered buttes are part of the heightfield now.  A broad talus skirt
  // connects each cap to the basin; noisy elliptical distance keeps the edge
  // from looking like a perfect cylinder while preserving a readable plateau.
  function desertMesaHeightAt(x, z) {
    let best = 0;
    for (let i = 0; i < MESAS.length; i++) {
      const m = MESAS[i];
      const edgeNoise = (terrainNoise(x * 0.027 + i * 17, z * 0.027 - i * 9) - 0.5) * 0.13;
      const dx = (x - m.x) / (m.w * 0.54), dz = (z - m.z) / (m.d * 0.54);
      const d = Math.hypot(dx, dz) + edgeNoise;
      const cap = 1 - smooth01((d - 0.48) / 0.38);
      const talus = 1 - smooth01((d - 0.76) / 0.62);
      const strata = 0.96 + 0.04 * Math.sin((x + z) * 0.09 + i * 2.1);
      const h = m.h * 1.45 * Math.max(cap, talus * 0.16) * strata;
      if (h > best) best = h;
    }
    return best;
  }

  function desertDuneHeightAt(x, z) {
    // Two slowly-changing wind fields replace the old single global sine. A
    // single direction made the entire 880x940m erg read as corduroy from the
    // air. These domains cross-fade over hundreds of metres, with independent
    // warps, so ridges fork, turn and knit into broad dune families without
    // adding another mesh, material or draw call.
    const warpA = (terrainNoise(x * 0.0036 + 31, z * 0.0036 - 18) - 0.5) * 94;
    const warpB = (terrainNoise(x * 0.0029 - 47, z * 0.0029 + 26) - 0.5) * 118;
    const uA = x * 0.79 + z * 0.61 + warpA;
    const vA = -x * 0.61 + z * 0.79;
    const uB = x * 0.94 - z * 0.34 + warpB;
    const vB = x * 0.34 + z * 0.94;
    const pA = uA * (Math.PI * 2 / 72);
    const pB = uB * (Math.PI * 2 / 104);
    function slipFace(phase, shoulderPhase) {
      // The second harmonic holds a long windward shoulder and a shorter lee
      // fall instead of a symmetrical wave hill.
      return clamp01(0.5 + Math.sin(phase) * 0.42 + Math.sin(phase * 2 + shoulderPhase) * 0.17);
    }
    const ridgeA = slipFace(pA, 0.72);
    const ridgeB = slipFace(pB, 1.18);
    const turn = smooth01(terrainNoise(x * 0.00165 + 7, z * 0.00165 - 13));
    // Long cross-wind scallops break infinite ridgelines into crescent/barchan
    // groups. A low-frequency field leaves calmer interdune basins between
    // those groups, giving roads and settlements visual breathing room.
    const scallopA = 0.5 + 0.5 * Math.sin(vA * (Math.PI * 2 / 255) + warpB * 0.018);
    const scallopB = 0.5 + 0.5 * Math.sin(vB * (Math.PI * 2 / 310) - warpA * 0.014);

    /* ---- DESERT_DUNES_V3 — THE ERG HAS A CHARACTER, NOT AN AMPLITUDE ------
       OWNER: "the desert region hills are varied in size more, some massive
       like the dunes im saying."

       The ridge MECHANICS above are not the problem and are not touched: the
       two crossing wind families, the slip-face harmonic, the barchan
       scallops and the interdune basins all read correctly. What was wrong is
       the ENVELOPE. Every crest in an 880x940 m erg was drawn from
       `(10 + 16*macro) * duneField`, a ~165 m-wavelength field times a ~425 m
       one — so the whole sea ran 7-30 m with no landform larger than a city
       block. Sand does not work that way: an erg is mostly low sheets with a
       few DRAA, and the draa are big because they are OLD, which is to say
       they are long as well as tall.

       Three changes, all to the envelope:

       (1) ERG CHARACTER — two very long fields (~850 m and ~1410 m) sum into
           one macro field; its top band becomes `core`, so two or three
           isolated megadune complexes exist per basin instead of an even
           corduroy. Over a stage-4 basin (1408 x 1504 m) the primary
           wavelength fits ~1.7 times across, which is what makes them
           complexes rather than a pattern.

       (2) A 50 m DUNE NEEDS A 500 m WAVELENGTH, or it is a spike, not a dune.
           The wavelength is NOT scaled pointwise — `uA * 2pi/(72*k)` makes the
           phase gradient depend on grad(k), which at these amplitudes
           dominates the ridge direction and shreds the field. Instead the SAME
           domain (same warp, same wind bearing) is evaluated at a second,
           long wavelength and cross-faded by `core`. Phase-correct everywhere,
           two extra sines, and the megadune inherits the exact ridge geometry
           of the small dunes it grows out of.

       (3) SOME FLATS GO NEARLY BARE. duneField's floor drops 0.52 -> 0.14, so
           interdune sheets really are sheets and the megadunes have something
           to stand out of.

       RENORMALISED, on purpose: the shape changes, the mean does not.
         before  E[amp] = E[(10+16*macro)] x E[duneField] = 26.5 x 0.76 = 20.1
         after   E[amp] = E[erg](13.0) x (1-E[core]) + E[mega](47.5) x E[core]
                        = 13.0 x 0.87 + 47.5 x 0.13 = 17.5
       i.e. ~13% under the old mean while the CEILING goes 31 -> 55 m. A shape
       change that also raised the average would move every downstream sample
       (drivability, the dune camera, the ground-match audit) for a reason
       that has nothing to do with the owner's ask.
       Revert: CBZ.CONFIG.DESERT_DUNES_V3 = false -> the exact field above.  */
    if (CFG.DESERT_DUNES_V3 === false) {
      const duneField0 = 0.52 + 0.48 * smooth01(terrainNoise(x * 0.00235 - 11, z * 0.00235 + 7));
      const macro0 = 0.72 + terrainNoise(x * 0.0061 + 19, z * 0.0061 - 23) * 0.62;
      const groupA0 = 0.12 + 0.88 * Math.pow(smooth01(scallopA), 1.55);
      const groupB0 = 0.12 + 0.88 * Math.pow(smooth01(scallopB), 1.55);
      const hA0 = Math.pow(clamp01(ridgeA), 1.72) * groupA0;
      const hB0 = Math.pow(clamp01(ridgeB), 1.72) * groupB0;
      return (hA0 * (1 - turn) + hB0 * turn) * (10 + 16 * macro0) * duneField0
        + terrainNoise(x * 0.019 + 2, z * 0.019 - 5) * 1.15;
    }
    // (1) erg character: where the sand has piled up for a long time.
    const ergA = terrainNoise(x * 0.00118 + 61, z * 0.00118 - 44);   // ~850u
    const ergB = terrainNoise(x * 0.00071 - 29, z * 0.00071 + 17);   // ~1410u
    const ergMix = ergA * 0.55 + ergB * 0.45;
    const core = smooth01((ergMix - 0.62) / 0.26);                   // 0 sheet .. 1 draa
    // (2) the same wind, read at draa wavelength. 72 -> 620 and 104 -> 880 is
    //     8.6x for a 3.2x height rise, i.e. DELIBERATELY gentler than a
    //     constant slip angle (which would only want ~230 m): mean flank slope
    //     falls from atan(2*17/72) = 25 deg on the small dunes to
    //     atan(2*55/620) = 10 deg on a draa. That is both what a real draa is
    //     — kilometre-scale swells with small dunes riding on them, which is
    //     exactly what the cross-fade produces at partial `core` — and the
    //     only version of a 55 m dune you can drive over instead of into.
    const ridgeAm = slipFace(uA * (Math.PI * 2 / 620), 0.72);
    const ridgeBm = slipFace(uB * (Math.PI * 2 / 880), 1.18);
    const rA = ridgeA + (ridgeAm - ridgeA) * core;
    const rB = ridgeB + (ridgeBm - ridgeB) * core;
    // the barchan scallops lengthen with them, or a 600 m ridge gets chopped
    // into 255 m horns and stops reading as one landform.
    const scallopAm = 0.5 + 0.5 * Math.sin(vA * (Math.PI * 2 / 900) + warpB * 0.018);
    const scallopBm = 0.5 + 0.5 * Math.sin(vB * (Math.PI * 2 / 1100) - warpA * 0.014);
    const sA = scallopA + (scallopAm - scallopA) * core;
    const sB = scallopB + (scallopBm - scallopB) * core;
    // (3) bare sheets between them.
    const duneField = 0.14 + 0.86 * smooth01(terrainNoise(x * 0.00235 - 11, z * 0.00235 + 7));
    const ergAmp = 5 + 14 * duneField;          //  7.0 .. 19.0 m of ordinary erg
    const megaAmp = 40 + 15 * ergA;             // 40.0 .. 55.0 m at a draa crest
    const amp = ergAmp + (megaAmp - ergAmp) * core;
    const groupA = 0.12 + 0.88 * Math.pow(smooth01(sA), 1.55);
    const groupB = 0.12 + 0.88 * Math.pow(smooth01(sB), 1.55);
    const hA = Math.pow(clamp01(rA), 1.72) * groupA;
    const hB = Math.pow(clamp01(rB), 1.72) * groupB;
    const transverse = (hA * (1 - turn) + hB * turn) * amp;
    const rippledFloor = terrainNoise(x * 0.019 + 2, z * 0.019 - 5) * 1.15;
    return transverse + rippledFloor;
  }

  // A 55 m DUNE MAY NOT STAND ON A ROAD. The basin's own benches (in
  // desertHeightAt below) were sized for 30 m crests and only ever covered
  // THIS biome's own highway spine and its four buildings — every road that
  // ARRIVES from somewhere else crossed raw dune field, which was survivable
  // at 30 m and is not at 55.
  //   This is not a second corridor system. It is the same distance grammar
  // CBZ.highwayNetReliefGate already uses (flat inside a band, smoothly back
  // to full relief over a fade), applied to the two hand-placed causeway decks
  // this biome docks with — the two roads that arrive from outside and that
  // the basin's own benches never covered.
  //   FLAT within half-width + 26 m of a centreline, back to full relief over
  //   the next 150 m — nearly four times the road gate's 40 m fade, because
  //   the thing being eased down is nearly four times as tall.
  const CORRIDOR_FLAT = CW / 2 + 26, CORRIDOR_FADE = 150;
  // The Coyle causeway drops out of the farm county and runs 600 m INTO this
  // basin before it meets the desert highway. biome_farmland.js owns that deck
  // but it parses AFTER this file, so its geometry is re-derived here from the
  // published rects both files read (x = the farm county's centreline; the deck
  // ends 600 m inside our north shore) rather than waiting for a record that
  // does not exist yet. Null when the farm county is absent.
  const _FARM = (CBZ.worldFoot && CBZ.worldFoot("farmland")) || null;
  const COYLE_X = _FARM ? _FARM.cx : null;
  // …AND IT ENDS WHERE THE DECK ENDS, WHICH IS NOT "600 m IN". biome_farmland
  // runs that deck to `max(our MINZ + 600, our HWY_Z + 30)` — it aims at the
  // SPINE, not at a fixed depth — so the 600 was only ever right while the two
  // happened to coincide. On the 10x basin the spine is 2.3 km inside the
  // shore and the old literal would have flattened the first 600 m and left
  // the remaining 1.7 km of a real, drivable highway buried under 55 m draa.
  // Same expression as the deck's, so the flat band cannot fall short of it
  // again. Held at the literal below stage 5 (that world's deck overruns by
  // 142 m and the 150 m fade covers it, so nothing there changes).
  const COYLE_Z1 = _V5 ? Math.max(MINZ + 600, HWY_Z + 30) : (MINZ + 600);
  // (c) THE SALTLANDS APPROACH — the leg the deck turns onto at CW_X1 and
  // runs south to the spine. Only exists on the 10x basin; see CW_X1.
  const APPROACH_Z0 = Math.min(CW_Z, HWY_Z), APPROACH_Z1 = Math.max(CW_Z, HWY_Z);
  function bandGate(d) {
    if (d <= CORRIDOR_FLAT) return 0;
    if (d >= CORRIDOR_FLAT + CORRIDOR_FADE) return 1;
    return smooth01((d - CORRIDOR_FLAT) / CORRIDOR_FADE);
  }
  // A DECK IS A SEGMENT, NOT A LINE, and on the 10x basin that stops being a
  // pedantic distinction. Gating on |x - lineX| inside a z window puts a CLIFF
  // at the window's edge — full relief on one side of an invisible line, dead
  // flat on the other, with no road within 150 m of it — and a 40 m draa flank
  // standing on nothing is exactly the kind of thing the corridor gate exists
  // to prevent. Point-to-segment distance rounds the cap instead, so a
  // corridor ENDS where its deck ends. Same grammar CBZ.highwayNetReliefGate
  // uses; stage <= 4 keeps the infinite-line form byte for byte.
  function segDist(x, z, ax, az, bx, bz) {
    const vx = bx - ax, vz = bz - az;
    const L2 = vx * vx + vz * vz;
    let t = L2 > 0 ? ((x - ax) * vx + (z - az) * vz) / L2 : 0;
    t = t < 0 ? 0 : (t > 1 ? 1 : t);
    const px = ax + vx * t - x, pz = az + vz * t - z;
    return Math.sqrt(px * px + pz * pz);
  }
  const CW_XMIN = Math.min(CW_X0, CW_X1), CW_XMAX = Math.max(CW_X0, CW_X1);
  const CORRIDOR_REACH = CORRIDOR_FLAT + CORRIDOR_FADE;   // past this a deck cannot matter
  function corridorGate(x, z) {
    if (CFG.DESERT_DUNES_V3 === false) return 1;
    let g = 1;
    // (a) the Saltlands causeway: horizontal, docking on our west shore.
    //     Unbounded in x, this band was a dead-flat strip running the FULL
    //     width of the erg at the causeway's z — 1.4 km of it hidden against
    //     the shore falloff, and 4.5 km of it not hidden at all.
    if (_V5) {
      if (x > CW_XMIN - CORRIDOR_REACH && x < CW_XMAX + CORRIDOR_REACH &&
          z > CW_Z - CORRIDOR_REACH && z < CW_Z + CORRIDOR_REACH) {
        g = bandGate(segDist(x, z, CW_XMIN, CW_Z, CW_XMAX, CW_Z));
        if (g <= 0) return 0;
      }
    } else if (x > CW_XMIN - CORRIDOR_FADE) {
      g = bandGate(Math.abs(z - CW_Z));
      if (g <= 0) return 0;
    }
    // (b) the Coyle causeway: vertical, dropping in from the north. Its north
    //     end is off our shore (the deck comes from the farm county), so the
    //     segment starts outside the basin where our height field is 0 anyway.
    if (COYLE_X != null && z < COYLE_Z1 + CORRIDOR_REACH) {
      const t = _V5
        ? bandGate(segDist(x, z, COYLE_X, MINZ - 400, COYLE_X, COYLE_Z1))
        : (z < COYLE_Z1 + CORRIDOR_FADE ? bandGate(Math.abs(x - COYLE_X)) : 1);
      if (t <= 0) return 0;
      if (t < g) g = t;
    }
    // (c) the Saltlands approach: the leg the deck turns onto at CW_X1 and
    //     runs south to the spine. It is what makes the basin's only land
    //     entrance reach the only road in it.
    if (_V5 && z > APPROACH_Z0 - CORRIDOR_REACH && z < APPROACH_Z1 + CORRIDOR_REACH) {
      const t = bandGate(segDist(x, z, CW_X1, APPROACH_Z0, CW_X1, APPROACH_Z1));
      if (t <= 0) return 0;
      if (t < g) g = t;
    }
    return g;
  }
  // NOT CONSULTED HERE, AND THE REASON IS LOAD ORDER: CBZ.highwayNetReliefGate
  // is empty until city/highwaynet.js builds at order 91 and this biome bakes
  // its mesh at order 31, so reading it would flatten the PHYSICS oracle under
  // a corridor the DRAWN dune still stands in — precisely the mesh/oracle
  // divergence CBZ.groundMatchAudit() exists to catch. It also is not needed:
  // roadrules.js's clearance law forbids a route from crossing a registered
  // place it is not going to, so a highway cannot legally enter this basin.
  // The two decks above are parse-time constants and therefore identical to
  // the bake and to every later query.

  function desertHeightAt(x, z) {
    if (x < MINX || x > MAXX || z < MINZ || z > MAXZ) return 0;
    let h = Math.max(desertDuneHeightAt(x, z), desertMesaHeightAt(x, z));

    // Roads and settlements sit on broad graded benches, not on hovering
    // planes.  The terrain eases into every bench over tens of metres.
    // The highway bench widens with the dunes: 35 m of easing off a 30 m crest
    // is a 40-degree bank, off a 55 m crest it is a wall.
    h *= smooth01((Math.abs(z - HWY_Z) - 9) / (CFG.DESERT_DUNES_V3 === false ? 35 : 62));
    h *= flatRectFactor(x, z, TOWN_CX, TOWN_CZ, TOWN_HX + 8, TOWN_HZ + 8, CFG.DESERT_DUNES_V3 === false ? 42 : 90);
    h *= flatRectFactor(x, z, GAS_X + 10, GAS_Z, 42, 30, 34);
    h *= flatRectFactor(x, z, MOTEL_X, MOTEL_Z, 36, 26, 38);
    // the played-out mine's bench. NOT scaled by FSC: the mine head, its
    // layout reservation and its MINE label are authored at (CX-230, CZ+60)
    // further down this file, and a pad that moved out from under them is
    // precisely the drift this file's footprint comment warns about.
    h *= flatRectFactor(x, z, CX - 220, CZ + 60, 48, 36, 34);
    h *= corridorGate(x, z);
    const edge = Math.min(x - MINX, MAXX - x, z - MINZ, MAXZ - z);
    h *= smooth01(edge / 34);
    return Math.max(0, h);
  }

  function desertNormalAt(x, z, out) {
    out = out || new THREE.Vector3();
    const e = 2.4;
    const dx = desertHeightAt(x + e, z) - desertHeightAt(x - e, z);
    const dz = desertHeightAt(x, z + e) - desertHeightAt(x, z - e);
    return out.set(-dx / (2 * e), 1, -dz / (2 * e)).normalize();
  }

  // ---- deterministic LCG ---------------------------------------------------
  // seeded from CBZ.WORLD_SEED via the named-stream registry (core/seed.js)
  // — one world-seed knob instead of a per-file magic literal. rng() is
  // re-armed at build entry so a rebuild replays the identical stream.
  let rng = null;
  function armRng() { rng = CBZ.seedStream ? CBZ.seedStream('desert') : (function () { let s = 0x5dec7; return function () { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }; })(); }
  armRng();
  function rr(a, b) { return a + rng() * (b - a); }

  const BGU = THREE.BufferGeometryUtils;

  // ===========================================================================
  //  DUNE SURFACE — a low-frequency, mipmapped canvas texture for the basin
  //  ground. It keeps wind-carved grain without the aerial moire of a
  //  high-frequency fragment shader. ONE material + ONE mesh, same draw-call
  //  budget as the former ground path.
  // ===========================================================================
  function makeDuneRippleMaterial(baseHex) {
    const base = new THREE.Color(baseHex == null ? SAND : baseHex);
    const cv = document.createElement("canvas");
    cv.width = cv.height = 256;
    const ctx = cv.getContext("2d");
    ctx.fillStyle = "#" + base.getHexString();
    ctx.fillRect(0, 0, cv.width, cv.height);
    // Broken, slowly-turning traces read as wind grain at player height but
    // do not become a repeated barcode from the map camera. Each trace is
    // deterministic and finite; the vertex-lit heightfield owns the large
    // dune silhouette.
    for (let row = -10, band = 0; row < 274; row += 12, band++) {
      for (let seg = 0; seg < 4; seg++) {
        const jitter = Math.sin(band * 7.31 + seg * 11.17);
        const x0 = seg * 70 - 18 + jitter * 17;
        const x1 = x0 + 39 + (0.5 + 0.5 * Math.sin(band * 3.71 + seg)) * 30;
        ctx.beginPath();
        for (let x = x0; x <= x1; x += 5) {
          const bend = Math.sin(x * 0.028 + band * 0.83) * 4.5 + Math.sin(x * 0.009 - band * 1.37) * 6;
          const y = row + bend + (x - 128) * Math.sin(band * 0.47) * 0.035;
          if (x === x0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = "rgba(112,80,42,0.10)";
        ctx.lineWidth = 1.8;
        ctx.stroke();
        ctx.translate(0, 1.8);
        ctx.strokeStyle = "rgba(255,245,205,0.08)";
        ctx.lineWidth = 0.7;
        ctx.stroke();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
      }
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    // One unique grain sheet covers the authored basin. Geometry supplies the
    // detail up close, so tiling this canvas only advertised its repetition.
    tex.repeat.set(1, 1);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipMapLinearFilter;
    tex.generateMipmaps = true;
    return new THREE.MeshLambertMaterial({ color: 0xffffff, map: tex, vertexColors: true });
  }

  CBZ.addLandmass(function (city) {
    const root = (city && city.root) || (CBZ.scene);
    if (!root) return;
    armRng();
    const dummy = new THREE.Object3D();
    const layout = CBZ.worldLayout;

    // Reserve every authored corridor and landmark *before* any natural
    // scatter. Previously the desert's cactus/boulder passes ran first and
    // the road, gas station, motel, mine, and mesas were simply dropped on
    // top of whatever had landed there.
    if (layout) {
      if (HAS_TOWN) layout.reserve("desert:dry-gulch", TOWN, { pad: 12 });
      layout.reserve("desert:highway", { minX: MINX, maxX: MAXX, minZ: HWY_Z - 7, maxZ: HWY_Z + 7 }, { pad: 4 });
      layout.reserve("desert:causeway", { minX: Math.min(CW_X0, CW_X1), maxX: Math.max(CW_X0, CW_X1), minZ: CW_Z - 12, maxZ: CW_Z + 12 }, { pad: 3 });
      MESAS.forEach(function (m, i) {
        layout.reserve("desert:mesa:" + i, { minX: m.x - m.w / 2, maxX: m.x + m.w / 2, minZ: m.z - m.d / 2, maxZ: m.z + m.d / 2 }, { pad: 10 });
      });
      layout.reserve("desert:gas-and-diner", { minX: GAS_X - 10, maxX: GAS_X + 36, minZ: HWY_Z + 4, maxZ: HWY_Z + 36 }, { pad: 5 });
      layout.reserve("desert:motel", { minX: MOTEL_X - 26, maxX: MOTEL_X + 26, minZ: MOTEL_Z - 16, maxZ: MOTEL_Z + 16 }, { pad: 6 });
      layout.reserve("desert:mine", { minX: CX - 245, maxX: CX - 185, minZ: CZ + 38, maxZ: CZ + 82 }, { pad: 8 });
    }
    function claimNature(x, z, radius) {
      return !layout || layout.claimNature(x, z, radius, { pad: 0.35 });
    }
    function openNature(x, z, radius) {
      return !layout || layout.canPlaceNature(x, z, radius, { pad: 0.2 });
    }

    // ---- merge helper: many transformed geometries → ONE mesh -------------
    function mergeAdd(geoms, material, opts) {
      opts = opts || {};
      if (!geoms.length) return null;
      if (BGU && BGU.mergeBufferGeometries) {
        const merged = BGU.mergeBufferGeometries(geoms);
        const m = new THREE.Mesh(merged, material);
        m.castShadow = !!opts.cast; m.receiveShadow = opts.receive !== false;
        m.matrixAutoUpdate = false; m.updateMatrix(); root.add(m);
        return m;
      }
      // fallback (no BGU): still ONE mesh per color via individual meshes
      for (const gm of geoms) {
        const m = new THREE.Mesh(gm, material);
        m.castShadow = !!opts.cast; m.receiveShadow = opts.receive !== false;
        m.matrixAutoUpdate = false; m.updateMatrix(); root.add(m);
      }
      return null;
    }
    function plane(x, z, w, d, y) {
      const g = new THREE.PlaneGeometry(w, d);
      g.rotateX(-Math.PI / 2);
      g.translate(x, y == null ? 0.02 : y, z);
      return g;
    }
    // a solid AABB collider (mesas + buildings you must walk around)
    function solid(x, z, w, d, y1) {
      if (!CBZ.colliders) return;
      const gy = CFG.DESERT_TERRAIN_V2 !== false ? desertHeightAt(x, z) : 0;
      CBZ.colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, y0: gy, y1: gy + (y1 == null ? 30 : y1) });
    }

    CBZ.desertRockScatterCount = 0;
    // =====================================================================
    //  0) REGIONS — declare the walkable land FIRST so peds/swim/clamp see
    //     it the instant we start placing things.
    // =====================================================================
    CBZ.registerCityRegion(city, { name: "The Saltlands", subtitle: "Desert Mesa", biome: "desert", kind: "rect", minX: MINX, maxX: MAXX, minZ: MINZ, maxZ: MAXZ, pad: 8 });
    // causeway widened to the 24m highway deck (z-span ±12 about the centreline)
    CBZ.registerCityRegion(city, { name: "Saltlands Causeway", subtitle: "Desert Mesa", kind: "rect", minX: Math.min(CW_X0, CW_X1), maxX: Math.max(CW_X0, CW_X1), minZ: CW_Z - 12, maxZ: CW_Z + 12, pad: 1 });
    // give traffic a road across the causeway (runs along X → not vertical)
    if (city.roads) {
      city.roads.push({ x: (CW_X0 + CW_X1) / 2, z: CW_Z, vertical: false, len: Math.abs(CW_X1 - CW_X0), district: "highway", w: 24, lanesPerDir: 3, laneW: 3.6, median: true, medianW: 1.2 });
    }

    // =====================================================================
    //  1) THE BASIN — one big merged sand plane (warm tan) + a scatter of
    //     darker/paler quad patches so it reads weathered, not a flat slab.
    //     World is flat y=0; this sits a hair above so it z-fights nothing.
    // =====================================================================
    // The main sand plane keeps its own UVs for the low-frequency canvas
    // surface above. Built directly rather than through mergeAdd because it
    // is one mesh and needs its repeatable texture coordinates intact.
    // 176 x 188 was measured against an 880 x 940 m basin — i.e. it is really
    // the statement "a dune vertex every 5 m", which is what resolves a 72 m
    // ridge without stairstepping. Left as literals the stage-4 basin would
    // draw 8 m cells and the erg would go faceted, so the CELL is the constant
    // and the segments follow the footprint.
    //   THE CAP IS A VERTEX BUDGET, not a taste: every vertex here costs FIVE
    // evaluations of the height field (one for y, four for the central-
    // difference normal), so 264 -> 265^2 = 70k verts is ~2.1x the authored
    // plane's 33k and is where this bake stops being cheap. At the stage-4
    // footprint the cap binds and the cells come out 5.3 x 5.7 m, which still
    // puts 13 vertices across the shortest (72 m) ridge. At the authored size
    // the floors bind and the expressions return 176/188 exactly.
    //
    //   WORLD_SCALE_V5 BREAKS BOTH ENDS OF THAT SENTENCE, so the 10x basin
    // takes a different bake — same field, same colours, three changes:
    //
    //   (1) IT IS TILED. One 4453 x 4756 m plane is a single mesh with a 3.3 km
    //       bounding sphere: it is either fully drawn or not drawn, so standing
    //       at the gas station costs every triangle in the erg. 6x6 tiles of
    //       742 x 793 m frustum-cull to the four or nine you can actually see.
    //       36 draw calls buys back ~85% of the triangles at any ground camera.
    //   (2) ONE height eval per vertex, not five. The four extra bought a
    //       2.4 m central-difference normal used ONLY to shade the baked
    //       vertex COLOUR — the LIT normal came from computeVertexNormals,
    //       i.e. from the grid, so the two never agreed anyway. Each tile now
    //       samples a one-cell HALO and central-differences the grid it
    //       already has, and that single normal serves both: colour and
    //       lighting agree by construction, and because the halo is the
    //       neighbouring tile's REAL ground the normals are continuous across
    //       a seam (computeVertexNormals per tile would have drawn 10 lighting
    //       creases across the erg). 440k vertices now cost less to bake than
    //       today's 70k did — measured at 1.15 us per height eval.
    //   (3) THE CELL GIVES A LITTLE: 7.0 m, not 5.3. That is 10 vertices
    //       across the shortest (72 m) ridge instead of 13, on a basin with
    //       ten times the area — 437k verts / 863k tris total. The draa the
    //       owner asked for are 620-880 m landforms and do not notice.
    //
    // Vertices carry ABSOLUTE world coordinates and every tile sits at the
    // origin: a tile's edge column must be bit-identical to its neighbour's or
    // the erg cracks, and `centre + half` vs `centre + width - half` is not.
    // One global formula, one answer. UVs are global for the same reason —
    // the grain sheet is ONE sheet over the basin, not 36 copies of one.
    const ERG_TILES = _V5 ? 6 : 1;
    const GSEG_X = _V5
      ? Math.max(8, Math.round(HX * 2 / ERG_TILES / 7))
      : Math.min(264, Math.max(176, Math.round(HX * 2 / 5)));
    const GSEG_Z = _V5
      ? Math.max(8, Math.round(HZ * 2 / ERG_TILES / 7))
      : Math.min(264, Math.max(188, Math.round(HZ * 2 / 5)));
    const GRID_X = GSEG_X * ERG_TILES, GRID_Z = GSEG_Z * ERG_TILES;   // cells across the whole basin
    const STEP_X = (HX * 2) / GRID_X, STEP_Z = (HZ * 2) / GRID_Z;
    const duneMat = makeDuneRippleMaterial(SAND);
    const ergSun = new THREE.Vector3(-0.55, 0.74, 0.39).normalize();
    const ergC = new THREE.Color(), ergEdgeC = new THREE.Color();
    const ergSand = new THREE.Color(SAND), ergCrest = new THREE.Color(SAND_PALE);
    const ergLee = new THREE.Color(SAND_DK), ergRed = new THREE.Color(RED_ROCK), ergRedDk = new THREE.Color(RED_DK);
    const ergEdge = new THREE.Color(0x9b8b5f);
    const ergN = new THREE.Vector3();
    // The colour of one erg vertex, given its world position, its height and
    // its surface normal. Identical maths in both bakes — only where `n` comes
    // from differs, and that is the whole point of (2) above.
    function ergVertexColor(wx, wz, y, n, out) {
      const mesaY = desertMesaHeightAt(wx, wz);
      const light = Math.max(0, n.dot(ergSun)), slope = 1 - n.y;
      if (mesaY > 2.2) {
        out.copy(ergRed).lerp(ergRedDk, smooth01((slope - 0.08) / 0.5));
        out.multiplyScalar(0.90 + 0.08 * Math.sin(y * 0.42));
      } else {
        out.copy(ergLee).lerp(ergSand, 0.42 + light * 0.44);
        out.lerp(ergCrest, smooth01((n.y - 0.72) / 0.25) * 0.24);
      }
      // The dune sea dies into dry sage over a broad interior band. The
      // continent continues this exact hue through its organic influence,
      // so the allocation rectangle has no visible colour seam from above.
      const edgeDist = Math.min(wx - MINX, MAXX - wx, wz - MINZ, MAXZ - wz);
      ergEdgeC.copy(ergEdge).lerp(out, smooth01(edgeDist / 105));
      out.copy(ergEdgeC);
      return out;
    }
    // ---- the ONE-PLANE bake (stage <= 4 and the flag-off world) -------------
    function buildErgSinglePlane() {
      const geo = CFG.DESERT_TERRAIN_V2 !== false
        ? new THREE.PlaneGeometry(HX * 2, HZ * 2, GSEG_X, GSEG_Z)
        : plane(CX, CZ, HX * 2, HZ * 2, 0.02);
      if (CFG.DESERT_TERRAIN_V2 !== false) {
        geo.rotateX(-Math.PI / 2);
        const pa = geo.attributes.position;
        const colors = new Float32Array(pa.count * 3);
        for (let i = 0; i < pa.count; i++) {
          const wx = CX + pa.getX(i), wz = CZ + pa.getZ(i);
          const y = desertHeightAt(wx, wz);
          pa.setY(i, y);
          desertNormalAt(wx, wz, ergN);
          ergVertexColor(wx, wz, y, ergN, ergC);
          colors[i * 3] = ergC.r; colors[i * 3 + 1] = ergC.g; colors[i * 3 + 2] = ergC.b;
        }
        pa.needsUpdate = true;
        geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
        geo.computeVertexNormals();
        geo.computeBoundingSphere();
      }
      const m = new THREE.Mesh(geo, duneMat);
      // Freeze only after applying the world translation. Updating the matrix at
      // local origin and then mutating position left the renderer/build audit
      // disagreeing about where this 880x940m floor lived, carving a blue-looking
      // dry hole beside Diamond Speedway.
      if (CFG.DESERT_TERRAIN_V2 !== false) m.position.set(CX, 0, CZ);
      return [m];
    }
    // ---- the TILED bake (WORLD_SCALE_V5) ------------------------------------
    function buildErgTiles() {
      const out = [];
      const hw = GSEG_X + 3, hh = GSEG_Z + 3;      // halo grid: one ring outside
      const H = new Float32Array(hw * hh);
      for (let tj = 0; tj < ERG_TILES; tj++) {
        for (let ti = 0; ti < ERG_TILES; ti++) {
          const g0 = ti * GSEG_X, h0 = tj * GSEG_Z;        // this tile's origin in global cells
          // (a) heights over the halo — the ONLY place the field is evaluated
          for (let b = 0; b < hh; b++) {
            const wz = MINZ + (h0 + b - 1) * STEP_Z;
            for (let a = 0; a < hw; a++) {
              H[b * hw + a] = desertHeightAt(MINX + (g0 + a - 1) * STEP_X, wz);
            }
          }
          const geo = new THREE.PlaneGeometry(HX * 2 / ERG_TILES, HZ * 2 / ERG_TILES, GSEG_X, GSEG_Z);
          geo.rotateX(-Math.PI / 2);
          const pa = geo.attributes.position, ua = geo.attributes.uv;
          const colors = new Float32Array(pa.count * 3);
          const normals = geo.attributes.normal;
          for (let row = 0; row <= GSEG_Z; row++) {
            for (let col = 0; col <= GSEG_X; col++) {
              const i = row * (GSEG_X + 1) + col;
              const gi = g0 + col, gj = h0 + row;
              const wx = MINX + gi * STEP_X, wz = MINZ + gj * STEP_Z;
              const hI = (row + 1) * hw + (col + 1);
              const y = H[hI];
              pa.setXYZ(i, wx, y, wz);
              // central difference on the grid we already have (the halo is
              // why the tile's own edge is not a special case)
              ergN.set(-(H[hI + 1] - H[hI - 1]) / (2 * STEP_X), 1,
                       -(H[hI + hw] - H[hI - hw]) / (2 * STEP_Z)).normalize();
              normals.setXYZ(i, ergN.x, ergN.y, ergN.z);
              ua.setXY(i, gi / GRID_X, 1 - gj / GRID_Z);
              ergVertexColor(wx, wz, y, ergN, ergC);
              colors[i * 3] = ergC.r; colors[i * 3 + 1] = ergC.g; colors[i * 3 + 2] = ergC.b;
            }
          }
          pa.needsUpdate = true; ua.needsUpdate = true; normals.needsUpdate = true;
          geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
          geo.computeBoundingSphere();
          out.push(new THREE.Mesh(geo, duneMat));
        }
      }
      return out;
    }
    const ergMeshes = (_V5 && CFG.DESERT_TERRAIN_V2 !== false)
      ? buildErgTiles() : buildErgSinglePlane();
    for (let mi = 0; mi < ergMeshes.length; mi++) {
      const groundMesh = ergMeshes[mi];
      groundMesh.castShadow = false; groundMesh.receiveShadow = true;
      groundMesh.matrixAutoUpdate = false; groundMesh.updateMatrix();
      groundMesh.userData.terrain = true; groundMesh.userData.worldSurface = true;
      groundMesh.userData.realGround = true;
      groundMesh.name = ergMeshes.length > 1
        ? ("saltlands-desert-surface-" + mi) : "saltlands-desert-surface";
      root.add(groundMesh);
    }
    if (CFG.DESERT_TERRAIN_V2 !== false && CBZ.registerCityGroundHeight) {
      CBZ.registerCityGroundHeight(desertHeightAt, { name: "Saltlands dunes and mesas", biome: "desert" });
      CBZ.desertTerrainHeightAt = desertHeightAt;
      CBZ.desertTerrainNormalAt = desertNormalAt;
      // Read-only component probes keep screenshot/physics QA honest: a dune
      // camera can deliberately inspect the erg instead of accidentally
      // selecting a mesa talus and declaring the whole biome good.
      CBZ.desertDuneHeightAt = desertDuneHeightAt;
      CBZ.desertMesaHeightAt = desertMesaHeightAt;
    }
    // wind-streak patches (two tones, two merged meshes — 2 draw calls)
    const patchDk = [], patchPale = [];
    for (let i = 0; i < (CFG.DESERT_TERRAIN_V2 !== false ? 0 : 90); i++) {
      const x = rr(MINX + 20, MAXX - 20), z = rr(MINZ + 20, MAXZ - 20);
      const w = rr(10, 34), d = rr(8, 26);
      const g = new THREE.PlaneGeometry(w, d);
      g.rotateX(-Math.PI / 2); g.rotateY(rng() * Math.PI);
      g.translate(x, 0.03, z);
      (rng() < 0.5 ? patchDk : patchPale).push(g);
    }
    mergeAdd(patchDk, cmat(SAND_DK), { receive: true });
    mergeAdd(patchPale, cmat(SAND_PALE), { receive: true });

    // Feather only OUTSIDE the basin. The old full-size apron was a second
    // rectangular floor underneath the desert, which is why aerial views read
    // as overlapping map tiles instead of a continuous landscape.
    if (CBZ.makeBiomeEdgeRing) {
      CBZ.makeBiomeEdgeRing(root, {
        cx: CX, cz: CZ, hx: HX, hz: HZ, feather: 100, segments: 20,
        feathers: { west: 0 }, owner: "desert",
        // The core stays tucked against the speedway to the west, while the
        // actual erg now sprawls into the expanded eastern/southern country.
        // This is land-cover influence baked into the continent, not a plane.
        // THE SPREAD RIDES THE FOOTPRINT SCALE, and with BIOME_ORGANIC_EDGES
        // on it is no longer only paint: cityBiomeAt reads this field outside
        // the rect, so this is the number that actually makes the Saltlands a
        // desert you cross rather than a tan tile. Left absolute it would have
        // become proportionally SMALLER every time the basin grew.
        spread: { west: 70 * FSC, east: 620 * FSC, north: 170 * FSC, south: 520 * FSC },
        inner: 0x9b8b5f, outer: 0x68744e, featherNorm: 0.23,
        y: 0.005, seed: 0x5dec7,
      });
    }

    // =====================================================================
    //  2) DUNES — low rolling mounds you walk OVER visually (no colliders).
    //     One merged mesh of squashed low-poly spheres (icosa, flat-tan).
    //     A pale crest cap mesh on top for the sun-hit ridge read.
    // =====================================================================
    const duneGeoms = [], crestGeoms = [];
    for (let i = 0; i < (CFG.DESERT_TERRAIN_V2 !== false ? 0 : 180); i++) {   // legacy prop dunes only
      const x = rr(MINX + 14, MAXX - 14), z = rr(MINZ + 14, MAXZ - 14);
      const r = rr(7, 22), h = rr(1.0, 3.0);
      const stretch = rr(0.7, 1.3), turn = rng() * Math.PI;
      // Dunes are terrain, but they are still real geometry with a 1-3m
      // height. Letting one spawn under a road or building made the world
      // look like a pile of independent props. Reserve each accepted dome so
      // neither later dunes nor later props can stack through it.
      const footprint = r * Math.max(1, stretch) + 4;
      if (!openNature(x, z, footprint)) continue;
      const g = new THREE.SphereGeometry(r, 7, 4, 0, Math.PI * 2, 0, Math.PI * 0.5);
      g.scale(1, h / r, stretch);
      g.rotateY(turn);
      g.translate(x, 0.0, z);
      duneGeoms.push(g);
      // a thin pale skullcap riding the crest
      const c = new THREE.SphereGeometry(r * 0.6, 7, 3, 0, Math.PI * 2, 0, Math.PI * 0.5);
      c.scale(1, (h * 0.9) / (r * 0.6), 0.9);
      c.translate(x, h * 0.18, z);
      crestGeoms.push(c);
      // Claim the accepted terrain footprint after geometry generation so
      // later cactus/rock passes cannot be planted halfway inside a mound.
      if (layout) layout.reserveCircle("desert:dune:" + i, x, z, footprint);
    }
    mergeAdd(duneGeoms, cmat(SAND), { receive: true });
    mergeAdd(crestGeoms, cmat(SAND_PALE), { receive: true });

    // =====================================================================
    //  3) DRY RIVERBED — a meandering darker channel of overlapping flat
    //     lobes (cracked-mud read), ONE merged mesh. Cuts NW→SE so the
    //     highway can later cross it for a "bridge over a dead river" beat.
    // =====================================================================
    const riverGeoms = [];
    let rxz = { x: MINX + 60, z: MINZ + 40 };
    for (let i = 0; i < (CFG.DESERT_TERRAIN_V2 !== false ? 0 : 30); i++) {
      const g = new THREE.CircleGeometry(rr(5, 9), 8);
      g.rotateX(-Math.PI / 2);
      g.translate(rxz.x, 0.035, rxz.z);
      riverGeoms.push(g);
      rxz.x += rr(14, 22); rxz.z += rr(2, 16);
      if (rxz.x > MAXX - 40) break;
    }
    mergeAdd(riverGeoms, cmat(SAND_DK), { receive: true });

    if (CFG.DESERT_CACTI !== false) {
    // =====================================================================
    //  4) SAGUARO CACTI — instanced. Trunks (tall thin cylinders) in ONE
    //     InstancedMesh; arms (short cylinders, elbowed) in another. Shared
    //     cmat green. Trunks get a thin collider (you can't walk through a
    //     saguaro). Kept away from the highway corridor + buildings later.
    // =====================================================================
    const cactusSpots = [];
    for (let i = 0; i < 90 * SCAT; i++) {
      const x = rr(MINX + 18, MAXX - 18), z = rr(MINZ + 18, MAXZ - 18);
      const h = rr(2.6, 5.2), arms = (rng() < 0.7 ? 1 : 0) + (rng() < 0.4 ? 1 : 0);   // draw rng FIRST (determinism)
      if (inTown(x, z) || !claimNature(x, z, 1.15)) continue;                           // no saguaros in streets, roads, or future landmarks
      cactusSpots.push({ x, z, h, arms });
    }
    const trunkGeo = new THREE.CylinderGeometry(0.32, 0.4, 1, 7);
    const trunkIM = new THREE.InstancedMesh(trunkGeo, cmat(CACTUS), cactusSpots.length);
    trunkIM.castShadow = true; trunkIM.receiveShadow = true;
    let armCount = 0; cactusSpots.forEach(c => armCount += c.arms);
    const armGeo = new THREE.CylinderGeometry(0.22, 0.24, 1, 6);
    const armIM = new THREE.InstancedMesh(armGeo, cmat(CACTUS), Math.max(1, armCount));
    armIM.castShadow = true;
    // TREES_V2 (config.js): the saguaro base sat at EXACTLY the centre dune
    // sample (the downhill edge floated on dune slopes) and both arms hung on
    // the world ±x axis with a ~0.1 overlap that tilt nearly consumed. V2
    // seats the trunk below the LOWEST footprint sample, hangs each arm on a
    // hash01 radial angle (deterministic variety, ZERO new rng draws — the
    // rr()/rng() sequence below is byte-identical) at a 0.42 offset so the
    // arm root is buried in the trunk, and registers every cactus with
    // world/treeaudit.js. Same 2 InstancedMeshes.
    const TREES2 = !!(CBZ.CONFIG && CBZ.CONFIG.TREES_V2 !== false && CBZ.treeRegisterTree);
    if (TREES2 && CBZ.treeAuditResetSite) CBZ.treeAuditResetSite("desert");
    const ctbb = TREES2 && CBZ.treeGeoBounds ? CBZ.treeGeoBounds(trunkGeo) : null;
    const cabb = TREES2 && CBZ.treeGeoBounds ? CBZ.treeGeoBounds(armGeo) : null;
    let ti = 0, ai = 0;
    cactusSpots.forEach(c => {
      const gy = CFG.DESERT_TERRAIN_V2 !== false ? desertHeightAt(c.x, c.z) : 0;
      const yaw = rng() * Math.PI;                    // drawn HERE like before (stream order)
      let seatRef = gy, parts = null;
      if (TREES2) {
        const oracle = CFG.DESERT_TERRAIN_V2 !== false ? desertHeightAt : function () { return 0; };
        const gu = CBZ.treeGroundUnder(oracle, c.x, c.z, 0.6);
        seatRef = Math.min(gy, gu.min);
        const seatY = seatRef - 0.25, top = gy + c.h;
        dummy.position.set(c.x, (seatY + top) / 2, c.z);
        dummy.scale.set(1, top - seatY, 1); dummy.rotation.set(0, yaw, 0);
      } else {
        dummy.position.set(c.x, gy + c.h / 2, c.z);
        dummy.scale.set(1, c.h, 1); dummy.rotation.set(0, yaw, 0);
      }
      dummy.updateMatrix(); trunkIM.setMatrixAt(ti++, dummy.matrix);
      if (TREES2 && ctbb) {
        parts = [];
        CBZ.treeAabbPush(parts, dummy.matrix, ctbb.min.x, ctbb.min.y, ctbb.min.z, ctbb.max.x, ctbb.max.y, ctbb.max.z);
      }
      for (let a = 0; a < c.arms; a++) {
        const side = a === 0 ? 1 : -1;
        const ay = c.h * rr(0.45, 0.62);
        const len = c.h * rr(0.3, 0.45);
        if (TREES2) {
          // arm hangs at a deterministic radial angle, root buried in the trunk
          const ang = (CBZ.hash01 ? CBZ.hash01(c.x, c.z, 9102 + a) : (side + 1) * 0.25) * Math.PI * 2;
          dummy.position.set(c.x + Math.cos(ang) * 0.42, gy + ay + len / 2, c.z + Math.sin(ang) * 0.42);
          dummy.scale.set(1, len, 1); dummy.rotation.set(0, -ang, 0.15);
        } else {
          // vertical arm offset to the side (low-poly elbow read)
          dummy.position.set(c.x + side * 0.5, gy + ay + len / 2, c.z);
          dummy.scale.set(1, len, 1); dummy.rotation.set(0, 0, side * 0.15);
        }
        dummy.updateMatrix(); armIM.setMatrixAt(ai++, dummy.matrix);
        if (parts && cabb) CBZ.treeAabbPush(parts, dummy.matrix, cabb.min.x, cabb.min.y, cabb.min.z, cabb.max.x, cabb.max.y, cabb.max.z);
      }
      if (parts) CBZ.treeRegisterTree("desert", seatRef, parts);
      solid(c.x, c.z, 0.7, 0.7, c.h);
    });
    trunkIM.instanceMatrix.needsUpdate = true; armIM.instanceMatrix.needsUpdate = true;
    trunkIM.matrixAutoUpdate = false; armIM.matrixAutoUpdate = false;
    root.add(trunkIM); if (armCount) root.add(armIM);
    } // DESERT_CACTI

    if (CFG.DESERT_PROP_SCATTER === true) {
    // =====================================================================
    //  5) BOULDER FIELDS — REMOVED BY OWNER ORDER ("the desert region little
    //     gray rocks are removed entirely"), behind DESERT_ROCK_SCATTER.
    //
    //     THE RNG DRAWS STAY. Every candidate is still drawn and every
    //     accepted one still consumes its five transform draws, because this
    //     is a SHARED seeded stream: deleting the loop would re-deal every
    //     scrub, tumbleweed and bone in the basin for no reason connected to
    //     the owner's ask. The claims stay too, so the rest of the scatter
    //     keeps the spacing it was laid out with. What goes is the geometry
    //     and the colliders — which is what "removed entirely" means to a
    //     player. Flip the flag true and the field returns byte for byte.
    // =====================================================================
    const ROCKS = CFG.DESERT_ROCK_SCATTER === true;
    const boulders = [];
    for (let i = 0; i < 140 * SCAT; i++) {
      const x = rr(MINX + 12, MAXX - 12), z = rr(MINZ + 12, MAXZ - 12);
      const s = rr(0.5, 3.4);                       // draw rng FIRST (determinism)
      if (inTown(x, z) || !claimNature(x, z, Math.max(0.8, s * 0.8))) continue; // no boulders on authored space or each other
      boulders.push({ x, z, s });
    }
    const rockGeo = ROCKS ? new THREE.IcosahedronGeometry(1, 0) : null;
    const rockIM = ROCKS ? new THREE.InstancedMesh(rockGeo, cmat(ROCK_GREY), boulders.length) : null;
    if (rockIM) { rockIM.castShadow = true; rockIM.receiveShadow = true; }
    boulders.forEach((b, i) => {
      dummy.position.set(b.x, (CFG.DESERT_TERRAIN_V2 !== false ? desertHeightAt(b.x, b.z) : 0) + b.s * 0.4, b.z);
      dummy.scale.set(b.s, b.s * rr(0.6, 0.9), b.s * rr(0.8, 1.2));
      dummy.rotation.set(rng() * Math.PI, rng() * Math.PI, rng() * Math.PI);
      if (!rockIM) return;                          // rng consumed, geometry skipped
      dummy.updateMatrix(); rockIM.setMatrixAt(i, dummy.matrix);
      if (b.s > 2.2) solid(b.x, b.z, b.s * 1.4, b.s * 1.4, b.s);
    });
    if (rockIM) {
      rockIM.instanceMatrix.needsUpdate = true; rockIM.matrixAutoUpdate = false;
      root.add(rockIM);
    }
    // published for CBZ.worldScaleAudit(): 0 is the owner's answer.
    CBZ.desertRockScatterCount = ROCKS ? boulders.length : 0;

    // =====================================================================
    //  5b) FRACTURED ROCK CLUSTERS (world/rockscliffs.js) — a handful of
    //      chipped-boulder clusters ringing Dry Gulch's outskirts. WHY a
    //      second rock system's OUTPUT here instead of the icosa boulders
    //      above: the plain-icosa field (5) is deliberately smooth basin
    //      clutter (cheap, thousands of candidates); these few clusters use
    //      the SAME shared scrape geometry the mountain backdrop uses (one
    //      system, not two), just re-skinned smaller/paler for desert rock
    //      vs mountain granite (a palette+scale call, per the task — no new
    //      rock system). Candidates are drawn in a ring just outside the
    //      TOWN rect so they read as "the rock the town got built next to,"
    //      not scattered randomly across the whole basin. Ground here is
    //      flat (y=0 basin, no terrain relief in this biome) so the slope
    //      test always passes — the exclusion still runs (defensive, keeps
    //      the same code path terrain.js uses) but never rejects on this
    //      flat basin; it exists so a future sloped desert edge inherits the
    //      same angle-of-repose safety for free.
    // =====================================================================
    //      REMOVED WITH (5) under DESERT_ROCK_SCATTER — same owner order, and
    //      these are the same grey stone. Skipping the whole block costs this
    //      biome's stream nothing: scatterRocks runs on its OWN seed
    //      (0x5dec7 ^ 0x2222), so the only side effect dropped is the handful
    //      of layout claims it made around Dry Gulch.
    if (CBZ.scatterRocks && ROCKS) {
      function pickTownOutskirt(r) {
        // Ring around the town rect, biased just outside its edge. Unlike the
        // old helper, it also obeys the shared layout so these final rocks
        // cannot cut through the highway, a cactus/boulder claim, or a future
        // landmark that happens to sit on the town's outskirts.
        for (let attempt = 0; attempt < 10; attempt++) {
          const ang = r() * Math.PI * 2;
          const ringR = Math.max(TOWN_HX, TOWN_HZ) + 30 + r() * 60;
          const x = TOWN_CX + Math.cos(ang) * ringR;
          const z = TOWN_CZ + Math.sin(ang) * ringR;
          if (claimNature(x, z, 2.2)) return { x, z };
        }
        return null;
      }
      CBZ.scatterRocks(root, {
        count: 22,
        pick: pickTownOutskirt,
        heightAt: CFG.DESERT_TERRAIN_V2 !== false ? desertHeightAt : function () { return 0; },
        normalAt: CFG.DESERT_TERRAIN_V2 !== false ? desertNormalAt : function (x, z, out) { return out.set(0, 1, 0); },
        repeatAngleDeg: 38,
        minSize: 0.6, maxSize: 1.8,                  // desert-scale clusters — smaller than mountain boulders
        baseRadius: 1, detail: 0,                    // cheaper/lower-poly than the mountain rock (desert reads small anyway)
        variants: 2,
        colorHex: ROCK_GREY,                          // desert rock palette, not mountain granite
        seed: 0x5dec7 ^ 0x2222,
        solidMin: 1.1,                                // the cluster-scale ones only; pebbles stay free
      });
    }

    // =====================================================================
    //  6) DEAD SCRUB + TUMBLEWEEDS — instanced. Scrub = a small dome of
    //     thin crossed quads (one icosa, flat-shaded olive). Tumbleweeds =
    //     pale wireframe-ish spheres. Both ONE InstancedMesh each. No
    //     colliders (you brush right through dry brush).
    // =====================================================================
    const scrubGeo = new THREE.IcosahedronGeometry(0.6, 0);
    const scrubIM = new THREE.InstancedMesh(scrubGeo, cmat(SCRUB), 110 * SCAT);
    for (let i = 0; i < 110 * SCAT; i++) {
      const sx = rr(MINX + 8, MAXX - 8), sz = rr(MINZ + 8, MAXZ - 8);
      const s = rr(0.5, 1.3); const rot = rng() * Math.PI;       // draw rng FIRST
      // Keep the instance count/rng stream stable, but hide any candidate that
      // lands on a shared protected footprint or one of the solid natural
      // claims above. This clears roads and landmark yards as well as town lots.
      dummy.position.set(sx, (inTown(sx, sz) || !openNature(sx, sz, s * 0.7)) ? -50 : (CFG.DESERT_TERRAIN_V2 !== false ? desertHeightAt(sx, sz) : 0) + 0.3, sz);
      dummy.scale.set(s, s * 0.7, s); dummy.rotation.set(0, rot, 0);
      dummy.updateMatrix(); scrubIM.setMatrixAt(i, dummy.matrix);
    }
    scrubIM.instanceMatrix.needsUpdate = true; scrubIM.matrixAutoUpdate = false;
    scrubIM.castShadow = true; root.add(scrubIM);

    const tumbleGeo = new THREE.IcosahedronGeometry(0.7, 1);
    const tumbleIM = new THREE.InstancedMesh(tumbleGeo, cmat(TUMBLE), 24 * SCAT);
    for (let i = 0; i < 24 * SCAT; i++) {
      const tx = rr(MINX + 10, MAXX - 10), tz = rr(MINZ + 10, MAXZ - 10);
      const s = rr(0.6, 1.1); const rx = rng() * Math.PI, ry = rng() * Math.PI, rz = rng() * Math.PI;   // draw rng FIRST
      dummy.position.set(tx, (inTown(tx, tz) || !openNature(tx, tz, s * 0.8)) ? -50 : (CFG.DESERT_TERRAIN_V2 !== false ? desertHeightAt(tx, tz) : 0) + 0.6, tz);
      dummy.scale.set(s, s, s); dummy.rotation.set(rx, ry, rz);
      dummy.updateMatrix(); tumbleIM.setMatrixAt(i, dummy.matrix);
    }
    tumbleIM.instanceMatrix.needsUpdate = true; tumbleIM.matrixAutoUpdate = false;
    root.add(tumbleIM);

    // =====================================================================
    //  7) BLEACHED BONES — instanced thin ribs/skull bits, ONE InstancedMesh.
    //     WHY: the desert KILLS. A sun-bleached ribcage half-buried in sand
    //     is the cheapest honest signal that "things die out here" — sets
    //     the stakes before you've even run dry. Clustered into a couple of
    //     "carcass" sites, not sprinkled evenly.
    // =====================================================================
    const boneGeo = new THREE.CylinderGeometry(0.05, 0.05, 1, 5);
    const boneIM = new THREE.InstancedMesh(boneGeo, cmat(BONE), 30);
    let bi = 0;
    const carcasses = [{ x: rr(MINX + 60, CX), z: rr(MINZ + 40, CZ) }, { x: rr(CX, MAXX - 60), z: rr(CZ, MAXZ - 40) }];
    carcasses.forEach(c => {
      for (let r = 0; r < 7 && bi < 30; r++) {           // a curved row of ribs
        const bx = c.x + r * 0.4 - 1.4, bz = c.z + Math.sin(r) * 0.2;
        dummy.position.set(bx, (CFG.DESERT_TERRAIN_V2 !== false ? desertHeightAt(bx, bz) : 0) + 0.1, bz);
        dummy.scale.set(1, rr(0.8, 1.4), 1);
        dummy.rotation.set(0, 0, 1.1 + Math.sin(r) * 0.15);
        dummy.updateMatrix(); boneIM.setMatrixAt(bi++, dummy.matrix);
      }
      if (bi < 30) {                                       // a long spine bone
        dummy.position.set(c.x - 2.2, (CFG.DESERT_TERRAIN_V2 !== false ? desertHeightAt(c.x - 2.2, c.z) : 0) + 0.1, c.z); dummy.scale.set(1.2, 2.4, 1.2);
        dummy.rotation.set(0, 0, Math.PI / 2); dummy.updateMatrix();
        boneIM.setMatrixAt(bi++, dummy.matrix);
      }
    });
    for (; bi < 30; bi++) {                                // a few lone scattered bones
      const bx = rr(MINX + 20, MAXX - 20), bz = rr(MINZ + 20, MAXZ - 20);
      dummy.position.set(bx, (CFG.DESERT_TERRAIN_V2 !== false ? desertHeightAt(bx, bz) : 0) + 0.08, bz);
      dummy.scale.set(1, rr(0.5, 1.0), 1); dummy.rotation.set(0, rng() * Math.PI, Math.PI / 2);
      dummy.updateMatrix(); boneIM.setMatrixAt(bi, dummy.matrix);
    }
    boneIM.instanceMatrix.needsUpdate = true; boneIM.matrixAutoUpdate = false;
    boneIM.castShadow = true; root.add(boneIM);
    } // DESERT_PROP_SCATTER

    // =====================================================================
    //  8) RED-ROCK MESAS — the only big individually-placed solids. Each =
    //     two low-poly eroded frustums in a muted sandstone tone with a darker
    //     shadow stratum, plus a full-height
    //     collider you WALK AROUND. A handful, spaced as landmarks so the
    //     basin has orientation cues from far off.
    // =====================================================================
    const mesaBase = [], mesaCap = [], mesaBand = [];
    (CFG.DESERT_TERRAIN_V2 !== false ? [] : MESAS).forEach((m, mi) => {
      const bh = m.h * 0.68, ch = m.h - bh;
      const sides = 7 + (mi % 3), yaw = (mi * 2.399963) % Math.PI;
      // Elliptical frustums read as weathered rock from every angle. The old
      // stacked boxes looked like buildings accidentally dropped in the sand.
      const gb = new THREE.CylinderGeometry(0.40, 0.52, bh, sides, 1, false);
      gb.scale(m.w, 1, m.d); gb.rotateY(yaw); gb.translate(m.x, bh / 2, m.z); mesaBase.push(gb);
      const gc = new THREE.CylinderGeometry(0.30, 0.41, ch, Math.max(6, sides - 1), 1, false);
      gc.scale(m.w, 1, m.d); gc.rotateY(yaw + 0.13); gc.translate(m.x, bh + ch / 2, m.z); mesaCap.push(gc);
      const gd = new THREE.CylinderGeometry(0.505, 0.515, bh * 0.14, sides, 1, false);
      gd.scale(m.w, 1, m.d); gd.rotateY(yaw); gd.translate(m.x, bh * 0.30, m.z); mesaBand.push(gd);
      solid(m.x, m.z, m.w * 0.94, m.d * 0.94, m.h);
    });
    mergeAdd(mesaBase, cmat(RED_ROCK), { cast: true, receive: true });
    mergeAdd(mesaCap, cmat(RED_ROCK), { cast: true, receive: true });
    mergeAdd(mesaBand, cmat(RED_DK), { cast: true, receive: true });

    // =====================================================================
    //  9) THE DESERT HIGHWAY — a faded asphalt deck cutting W→E across the
    //     basin (z ≈ CZ-40), ONE merged plane, with a center line built as
    //     instanced dashes (ONE InstancedMesh of thin pale quads). This is
    //     the SPINE the gas station / diner / motel hang off, and where the
    //     cars + telephone poles live. WHY a road in the wild: it's the
    //     only reason any of these outposts exist out here.
    // =====================================================================
    const roadMin = MINX + 4, roadMax = MAXX - 4;
    const highwayGeoms = [];
    function addHighwaySegment(x0, x1) {
      if (x1 - x0 > 0.2) highwayGeoms.push(plane((x0 + x1) / 2, HWY_Z, x1 - x0, 9, 0.05));
    }
    if (HAS_TOWN) {
      addHighwaySegment(roadMin, TOWN_SPINE_MIN);
      addHighwaySegment(TOWN_SPINE_MAX, roadMax);
    } else addHighwaySegment(roadMin, roadMax);
    mergeAdd(highwayGeoms, cmat(ASPHALT), { receive: true });
    // Dashed centre line follows the regional road only; Dry Gulch supplies
    // its own main-street paint over the town-owned segment.
    const dashXs = [];
    // COUNT rides the footprint: 60 dashes over the authored 880 m basin is a
    // dash every 14.3 m, which is the ROAD MARKING, not a budget. Left fixed it
    // would stretch to 23 m on a stage-4 basin and read as ticks. No rng here,
    // so this is free of the seeded stream.
    const nDash = Math.round(60 * FSC);
    for (let i = 0; i < nDash; i++) {
      const x = MINX + 12 + i * ((HX * 2 - 24) / nDash);
      if (HAS_TOWN && x >= TOWN_SPINE_MIN && x <= TOWN_SPINE_MAX) continue;
      dashXs.push(x);
    }
    const dashIM = new THREE.InstancedMesh(new THREE.PlaneGeometry(2.4, 0.3), cmat(LINE_PALE), Math.max(1, dashXs.length));
    for (let i = 0; i < dashXs.length; i++) {
      const x = dashXs[i];
      dummy.position.set(x, 0.07, HWY_Z); dummy.scale.set(1, 1, 1);
      dummy.rotation.set(-Math.PI / 2, 0, 0); dummy.updateMatrix();
      dashIM.setMatrixAt(i, dummy.matrix);
    }
    dashIM.count = dashXs.length;
    dashIM.instanceMatrix.needsUpdate = true; dashIM.matrixAutoUpdate = false;
    root.add(dashIM);

    // ---- CAUSEWAY: a REAL wide highway land-bridge to the speedway -----------
    const cwLen = Math.abs(CW_X1 - CW_X0);
    if (CBZ.buildHighway) {
      // heightAt: grade-follow world/terrain.js relief (0 over this rect's
      // flat playable footprint — a free, safe hook for the backdrop rim).
      // THE APPROACH LEG. On the 10x basin the deck does not stop at the
      // shore: it turns south at CW_X1 and runs to the spine, because the
      // basin grew away from this dock (the layout header explains why it had
      // to) and a 2.3 km walk over open draa is not an entrance. Three points,
      // no fillet — this is a T onto the highway, and buildHighway registers
      // the new leg as a drivable segment for free (HWY-3), deduping the
      // horizontal one this file already pushed in section 0.
      const cwPath = [{ x: CW_X0, z: CW_Z }, { x: CW_X1, z: CW_Z }];
      if (_V5) cwPath.push({ x: CW_X1, z: HWY_Z });
      CBZ.buildHighway(root, {
        path: cwPath,
        width: 24, lanesPerDir: 3, median: true, medianW: 1.2, laneW: 3.6, theme: "asphalt",
        guardrail: false, elevated: false, rng: rng,
        heightAt: CBZ.terrainHeight,
      });
    } else {
      // ---- fallback: bespoke narrow deck (only if buildHighway absent) ----
      mergeAdd([plane((CW_X0 + CW_X1) / 2, CW_Z, cwLen, CW, 0.05)], cmat(ASPHALT), { receive: true });
      const nCw = Math.max(6, (cwLen / 6) | 0);
      const cwDashIM = new THREE.InstancedMesh(new THREE.PlaneGeometry(2.0, 0.28), cmat(LINE_PALE), nCw);
      for (let i = 0; i < nCw; i++) {
        const x = Math.min(CW_X0, CW_X1) + 4 + i * ((cwLen - 8) / nCw);
        dummy.position.set(x, 0.07, CW_Z); dummy.rotation.set(-Math.PI / 2, 0, 0);
        dummy.scale.set(1, 1, 1); dummy.updateMatrix(); cwDashIM.setMatrixAt(i, dummy.matrix);
      }
      cwDashIM.instanceMatrix.needsUpdate = true; cwDashIM.matrixAutoUpdate = false;
      root.add(cwDashIM);
    }

    if (CFG.DESERT_PROP_SCATTER === true) {
    // =====================================================================
    // 10) TELEPHONE POLES — instanced posts + instanced crossarms running
    //     alongside the highway. Poles get thin colliders. WHY: a power line
    //     to nowhere reads as "civilization once reached out here," and
    //     gives the empty road scale + rhythm.
    // =====================================================================
    // Same reasoning as the centre-line dashes: 26 poles over 880 m is a span
    // of ~32 m, which is what gives the empty road its rhythm. Rides the scale.
    const nPole = Math.round(26 * FSC);
    const poleSpots = [];
    for (let i = 0; i < nPole; i++) {
      const x = MINX + 18 + i * ((HX * 2 - 36) / nPole);
      if (HAS_TOWN && x >= TOWN_SPINE_MIN - 8 && x <= TOWN_SPINE_MAX + 8) continue;
      poleSpots.push({ x, z: HWY_Z + 7 });
    }
    const poleGeo = new THREE.CylinderGeometry(0.22, 0.28, 8, 6);
    const poleIM = new THREE.InstancedMesh(poleGeo, cmat(POLE), Math.max(1, poleSpots.length));
    const armIM2 = new THREE.InstancedMesh(new THREE.BoxGeometry(2.2, 0.22, 0.22), cmat(POLE), Math.max(1, poleSpots.length));
    for (let i = 0; i < poleSpots.length; i++) {
      const x = poleSpots[i].x, z = poleSpots[i].z;          // along the road's south shoulder
      dummy.position.set(x, 4, z); dummy.scale.set(1, 1, 1); dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix(); poleIM.setMatrixAt(i, dummy.matrix);
      dummy.position.set(x, 7.0, z); dummy.updateMatrix(); armIM2.setMatrixAt(i, dummy.matrix);
      solid(x, z, 0.6, 0.6, 8);
    }
    poleIM.count = armIM2.count = poleSpots.length;
    poleIM.instanceMatrix.needsUpdate = true; armIM2.instanceMatrix.needsUpdate = true;
    poleIM.matrixAutoUpdate = false; armIM2.matrixAutoUpdate = false;
    poleIM.castShadow = true; root.add(poleIM); root.add(armIM2);
    } // DESERT_PROP_SCATTER

    // =====================================================================
    // 11) LANDMARKS — the WHY anchors. Built with cityMakeBuilding so the
    //     ones that should be enterable are. Each hangs off the highway.
    // =====================================================================
    const mk = CBZ.cityMakeBuilding;
    if (mk) {
      // -- GAS STATION + DINER (the reason to drive out here: FUEL + FOOD) --
      const gx = GAS_X, gz = GAS_Z;
      mk(root, gx, gz, 14, 11, 1, 0xded6c4, "north", { retail: true });            // station store (enterable)
      mk(root, gx + 26, gz + 2, 16, 12, 1, 0xc94f3a, "north", { retail: true });   // chrome diner (enterable)
      if (CFG.DESERT_PROP_SCATTER === true) {
      // pump-canopy: a flat roof on 4 posts (merged) + 2 pump blocks (instanced)
      const canY = 4.2, cgx = gx, cgz = gz - 12;
      mergeAdd([(function () { const g = new THREE.BoxGeometry(16, 0.5, 9); g.translate(cgx, canY, cgz); return g; })()], cmat(0xe7e2d4), { cast: true });
      const postIM = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, canY, 0.5), cmat(0xb8b2a4), 4);
      const pCorners = [[-7, -3.5], [7, -3.5], [-7, 3.5], [7, 3.5]];
      pCorners.forEach((c, i) => { dummy.position.set(cgx + c[0], canY / 2, cgz + c[1]); dummy.scale.set(1, 1, 1); dummy.rotation.set(0, 0, 0); dummy.updateMatrix(); postIM.setMatrixAt(i, dummy.matrix); solid(cgx + c[0], cgz + c[1], 0.6, 0.6, canY); });
      postIM.instanceMatrix.needsUpdate = true; postIM.matrixAutoUpdate = false; postIM.castShadow = true; root.add(postIM);
      const pumpIM = new THREE.InstancedMesh(new THREE.BoxGeometry(0.9, 1.6, 0.6), cmat(0xc0392b), 2);
      [[-3, 0], [3, 0]].forEach((c, i) => { dummy.position.set(cgx + c[0], 0.8, cgz + c[1]); dummy.scale.set(1, 1, 1); dummy.rotation.set(0, 0, 0); dummy.updateMatrix(); pumpIM.setMatrixAt(i, dummy.matrix); solid(cgx + c[0], cgz + c[1], 1.0, 0.8, 1.6); });
      pumpIM.instanceMatrix.needsUpdate = true; pumpIM.matrixAutoUpdate = false; pumpIM.castShadow = true; root.add(pumpIM);
      if (CBZ.makeLabelSprite) { const s = CBZ.makeLabelSprite("GAS"); if (s) { s.position.set(gx, 5.0, gz); s.scale.set(7, 1.8, 1); root.add(s); } }
      if (CBZ.makeLabelSprite) { const s = CBZ.makeLabelSprite("DINER"); if (s) { s.position.set(gx + 26, 5.2, gz + 2); s.scale.set(8, 2.0, 1); root.add(s); } }
      } // DESERT_PROP_SCATTER

      // -- ROADSIDE MOTEL (SHELTER: a place to hole up / lay low) ----------
      const mxr = MOTEL_X, mzr = MOTEL_Z;
      mk(root, mxr, mzr, 40, 12, 1, 0xd8b48a, "north", { retail: true });          // long unit row (enterable office shell)
      if (CFG.DESERT_PROP_SCATTER === true) {
      if (CBZ.makeLabelSprite) { const s = CBZ.makeLabelSprite("MOTEL"); if (s) { s.position.set(mxr, 5.6, mzr); s.scale.set(10, 2.4, 1); root.add(s); } }
      // a tall neon-ish sign pylon out by the road (merged post + board)
      mergeAdd([
        (function () { const g = new THREE.BoxGeometry(0.6, 9, 0.6); g.translate(mxr - 22, 4.5, mzr - 10); return g; })(),
        (function () { const g = new THREE.BoxGeometry(5, 3, 0.4); g.translate(mxr - 22, 9.5, mzr - 10); return g; })(),
      ], cmat(0x9a7b52), { cast: true });
      // SOLID: a 9 m mast standing on open ground at the roadside — the tallest
      // thing at this stop after the water tower, and the only one this file
      // never collided (`mergeAdd` is draw-only here; `solid()` is the ledger).
      // The BOARD at 8-11 m stays open — it is over every roof in the basin.
      solid(mxr - 22, mzr - 10, 0.8, 0.8, 9);
      if (CBZ.makeLabelSprite) { const s = CBZ.makeLabelSprite("VACANCY"); if (s) { s.position.set(mxr - 22, 9.5, mzr - 10.3); s.scale.set(5, 1.6, 1); root.add(s); } }
      } // DESERT_PROP_SCATTER

      // -- ABANDONED MINING OUTPOST (a relic worth poking at) --------------
      // a weathered headframe (merged A-frame timbers) + an ore shed
      // (enterable) + a derelict water tower. WHY: a played-out mine is why
      // ANYONE first cut a road into this basin — the dead source.
      const ox = CX - 230, oz = CZ + 60;
      mk(root, ox + 14, oz, 10, 9, 1, 0x8a7252, "south", { retail: true });        // ore shed (enterable)
      if (CFG.DESERT_PROP_SCATTER === true) {
      const hf = 9;                                                                 // headframe height
      mergeAdd([
        (function () { const g = new THREE.BoxGeometry(0.5, hf, 0.5); g.rotateZ(0.18); g.translate(ox - 2.0, hf / 2, oz); return g; })(),
        (function () { const g = new THREE.BoxGeometry(0.5, hf, 0.5); g.rotateZ(-0.18); g.translate(ox + 2.0, hf / 2, oz); return g; })(),
        (function () { const g = new THREE.BoxGeometry(5.0, 0.4, 0.4); g.translate(ox, hf, oz); return g; })(),
      ], cmat(0x6e5436), { cast: true });
      solid(ox, oz, 5, 1.2, hf);
      if (CBZ.makeLabelSprite) { const s = CBZ.makeLabelSprite("MINE"); if (s) { s.position.set(ox, hf + 1.2, oz); s.scale.set(6, 1.6, 1); root.add(s); } }
      // derelict water tower: tank on legs (merged)
      const tx = ox + 26, tz = oz - 12;
      mergeAdd([
        (function () { const g = new THREE.CylinderGeometry(2.6, 2.6, 3.2, 10); g.translate(tx, 8.6, tz); return g; })(),
        (function () { const g = new THREE.ConeGeometry(2.8, 1.4, 10); g.translate(tx, 10.9, tz); return g; })(),
      ], cmat(0x8c7d68), { cast: true });
      const legIM = new THREE.InstancedMesh(new THREE.BoxGeometry(0.3, 7, 0.3), cmat(0x6e5436), 4);
      [[-1.7, -1.7], [1.7, -1.7], [-1.7, 1.7], [1.7, 1.7]].forEach((c, i) => { dummy.position.set(tx + c[0], 3.5, tz + c[1]); dummy.scale.set(1, 1, 1); dummy.rotation.set(0, 0, 0); dummy.updateMatrix(); legIM.setMatrixAt(i, dummy.matrix); });
      legIM.instanceMatrix.needsUpdate = true; legIM.matrixAutoUpdate = false; legIM.castShadow = true; root.add(legIM);
      solid(tx, tz, 4, 4, 11);
      } // DESERT_PROP_SCATTER
    }

    // =====================================================================
    // 11b) DRY GULCH — a real OLD-WEST main-street TOWN grown from the
    //      reusable CBZ.buildTown generator, strung ALONG the highway spine.
    //      FALLBACK: if the town generator (towngen.js / placement) is absent
    //      this whole block no-ops and the enterable landmarks above stand as
    //      the desert. The cactus field, plus any explicitly enabled filler,
    //      skips the TOWN rect so none of it grows in the streets
    //      (HAS_TOWN gates inTown).
    // =====================================================================
    if (HAS_TOWN) {
      // reserve the existing landmark/road colliders so the generator's
      // placement (when present) never drops a lot on the gas station etc.
      if (CBZ.placement && CBZ.placement.seedFromColliders) { try { CBZ.placement.seedFromColliders(); } catch (e) {} }
      const town = CBZ.buildTown(root, {
        cx: TOWN_CX, cz: TOWN_CZ, cols: 3, rows: 2,
        blockW: 64, blockD: 50, roadW: 12,
        pattern: "mainstreet",
        density: 0.5,                       // LOW density — big frontier gaps
        name: "Dry Gulch", district: "desert",
        rng: rng,
        region: TOWN,
        minFrontage: 16, minLotArea: 240,
        squarePrefab: "well",
        // sun-bleached wood / dust palette
        palette: { ground: 0xcdb98a, sidewalk: 0xc2ad7e, wood: 0xa07c4c, accent: 0x6e5436, stone: 0x9a8d72, road: 0x4a4742, line: LINE_PALE, sign: "#f4e7c2", plaza: 0xd2bd8c, lamp: 0xf3d68a },
        // per-zone weighted prefabs — Old-West retail shells. civic ring gets
        // the Sheriff + Bank (the law + the money), commercial ring the Saloon
        // + General Store + boarding house, edges thin out to plain shacks.
        prefabs: {
          civic: [
            { name: "SHERIFF", storeys: 1, color: 0x8a6b44, w: 6, opts: { retail: true }, lotKind: "shop" },
            { name: "BANK", storeys: 2, color: 0xb7a279, opts: { retail: true }, lotKind: "shop" },
          ],
          commercial: [
            { name: "SALOON", storeys: 2, color: 0x9c6b3e, opts: { retail: true }, lotKind: "shop", w: 3 },
            { name: "GENERAL STORE", storeys: 1, color: 0xae8a55, opts: { retail: true }, lotKind: "shop", w: 3 },
            { name: "BOARDING HOUSE", storeys: 2, color: 0xb59a6a, opts: { retail: true }, lotKind: "shop", w: 2 },
            { name: "ASSAY OFFICE", storeys: 1, color: 0x977148, opts: { retail: true }, lotKind: "shop", w: 1 },
          ],
          residential: [
            { name: "HOMESTEAD", storeys: 1, color: 0xa9895c, opts: { retail: true }, lotKind: "home", w: 2 },
            { name: "SHACK", storeys: 1, color: 0x8f7146, opts: { retail: true }, lotKind: "home", w: 1 },
          ],
          default: [
            { name: "SHACK", storeys: 1, color: 0x8f7146, opts: { retail: true }, lotKind: "home" },
          ],
        },
      });

      // WORK ANCHORS — give town NPCs a reason to be here. A separate jobs
      // agent reads these; feature-detected so the town builds without it.
      if (town && CBZ.registerWorkAnchor) {
        const gen = (town.lots || []).find((l) => l.building && l.building.name === "GENERAL STORE")
                 || (town.lots || []).find((l) => l.kind === "shop");
        if (gen) {
          try {
            CBZ.registerWorkAnchor({
              biome: "desert", kind: "shop", x: gen.cx, z: gen.cz, role: "shopkeeper",
              spots: [{ x: gen.building.door.x, z: gen.building.door.z }],   // behind the counter at the door
              home: { x: gen.cx, z: gen.cz }, cap: 1, occupants: [],
            });
          } catch (e) {}
        }
        const saloon = (town.lots || []).find((l) => l.building && l.building.name === "SALOON");
        if (saloon) {
          try {
            CBZ.registerWorkAnchor({
              biome: "desert", kind: "saloon", x: saloon.cx, z: saloon.cz, role: "barkeep",
              spots: [{ x: saloon.building.door.x, z: saloon.building.door.z }],
              home: { x: saloon.cx, z: saloon.cz }, cap: 1, occupants: [],
            });
          } catch (e) {}
        }
      }
    }

    // =====================================================================
    // 12) POPULATE — SPARSE. A handful of live peds (drifter/biker/
    //     prospector) clustered at the human anchors (gas/diner/motel/mine)
    //     so the empty basin still has a heartbeat where it makes sense.
    //     Lean on the instanced scenery for the SENSE of scale, not bodies.
    // =====================================================================
    if (CBZ.cityMakePed && CBZ.cityPeds) {
      const populationEntries = [];
      const ped = function (x, z, opts) {
        try {
          if (CBZ.npcLife && CBZ.npcLife.definePopulation) {
            populationEntries.push({ profile: "cityResident", placement: { x: x, z: z, rng: rng }, overrides: opts || {} });
            return null;
          }
          const p = CBZ.npcLife
            ? CBZ.npcLife.spawnCity("cityResident", { x: x, z: z, parent: root, rng: rng }, opts || {})
            : CBZ.cityMakePed(x, z, rng, opts || {});
          if (p && !CBZ.npcLife) {
            root.add(p.group);
            if (CBZ.cityPeds.indexOf(p) < 0) CBZ.cityPeds.push(p);
          }
          return p;
        } catch (e) { /* one bad ped never kills the biome */ }
        return null;
      };
      // gas station / diner: a drifter + a mechanic
      ped(GAS_X - 4, HWY_Z + 12, { name: "Drifter", wealth: 0.15 });
      ped(GAS_X + 26, HWY_Z + 16, { name: "Mechanic", job: "construction", wealth: 0.3 });
      // motel: a biker hanging by the sign + a loner
      ped(MOTEL_X - 28, HWY_Z + 16, { name: "Biker", archetype: "mobster", wealth: 0.4, aggr: 0.6 });
      ped(MOTEL_X + 24, HWY_Z + 16, { name: "Loner", wealth: 0.2 });
      // mine: an old prospector poking the relic
      ped(CX - 216, CZ + 58, { name: "Prospector", wealth: 0.25 });
      // one wanderer out in the dunes
      ped(CX + 40, CZ + 100, { name: "Wanderer", wealth: 0.1 });
      if (populationEntries.length && CBZ.npcLife && CBZ.npcLife.definePopulation) {
        CBZ.npcLife.definePopulation("desert-authored", { root: root, entries: populationEntries });
      }
    }

    // a couple of cars out on the highway (one parked at gas, one cruising)
    if (CBZ.cityMakeCar) {
      try { CBZ.cityMakeCar(GAS_X - 4, HWY_Z - 2, 0, false); } catch (e) {}
      try { CBZ.cityMakeCar(CX + 40, HWY_Z, Math.PI, false); } catch (e) {}
    }

  }, 31);
})();
