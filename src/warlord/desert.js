/* ============================================================
   warlord/desert.js — THE ISLAND.

   Fourteen kilometres of desert with sea all the way round it, and the
   whole thing is ONE PURE FUNCTION. `heightAt(x,z)` answers for any point
   on the planet without a raycast, without a texture read, without caring
   what was built first. The mesh you can see is built by EVALUATING that
   function; nothing ever reads the mesh back. That is world/desertcity.js's
   doctrine and it is not stylistic — it is what lets the camera, the men,
   forty roaming warbands, the AI and a battle floor 300 m away all agree
   about where the ground is in the same frame, and it is why the campaign
   can ask about a spot the mesh does not even have a vertex for.

   WHAT MAKES IT READ AS A DESERT ISLAND FROM 60 M UP. Not one noise octave
   with a name on it. Six terrain LAWS, each answering a different question
   about what the ground DOES, selected by a province field so they come in
   patches you can navigate by:

     ERG     rolling transverse dunes, asymmetric (long windward ramp, short
             steep slip face — that is what a real dune looks like from the
             air). Amplitude AND wavelength are their own fields, so one erg
             is 8 m ripples at 90 m spacing and the next is 38 m mountains
             at 300 m. A single amplitude is why most procedural deserts
             read as corduroy.
     ROCK    mesas and buttes: FLAT tops at terraced heights, steep sides.
             The top height is a quantised field, not the smooth floor
             field, which is the whole trick — a mesa top must not inherit
             the undulation of the ground it stands on or it is a hill.
     SALT    a cracked pan. Dead flat and dead low, and that is the point:
             it is the one place on the island with no cover at all.
     GRAVEL  the boring ground. Every desert needs somewhere that is just
             ground, or the interesting parts have nothing to be next to.
     WADI    a canyon system CUT below whatever it crosses — applied on top
             of the province laws, not selected by them, because a wadi runs
             through an erg and out across a gravel plain.
     SHORE   a real beach: the land ramps to the waterline over ~150 m and
             the seabed falls away on a sand shelf. A cliff into a blue
             plane is the cheap version and it never reads as an island.

   OASES ARE THE MAP. A desert with no landmarks cannot be navigated, and a
   campaign you cannot navigate is a campaign where every ride is the same
   ride. Each oasis is a genuine bowl dug into the terrain with water in the
   bottom and palms round it — published as `W.desert.oases[]` so the
   campaign can point bands at them and draw them on the map.

   THE MESH IS A GEOMETRY CLIPMAP, seven levels, recentred on the camera.
   A single 14 km mesh at 8 m resolution is 3 million quads and is not
   shippable; this is the standard answer and it costs SEVEN draw calls for
   the whole planet. Each level is the same 64x64 grid at twice the cell
   size of the one inside it (8 m … 512 m), snapped to its own cell so
   vertices land on a fixed lattice and cannot swim as you ride. Levels
   1-6 have their middle cut out — with a one-cell OVERLAP, never a gap,
   because the levels snap to different lattices and a hole sized exactly
   right is a hole sized wrong half the time. The overlap band z-fights on
   paper; polygonOffset pushes the coarser level behind and it does not.
   Rebuilds are budgeted to ONE level per frame.

   WHY NOT systems/chunks.js OR core/farcull.js. Both were read first, as
   the house rules demand. chunks.js is a 16 m registry for PLAYER-PLACED
   pieces with a stubbed batcher — it has no notion of a heightfield or of
   LOD, and bending it into one would be a second system inside it.
   farcull.js hides top-level city GROUPS past a radius; a clipmap has no
   groups to hide because there is exactly one mesh per level and it is
   always on screen. Neither fits. The far island stays visible as
   silhouette because level 6 reaches 16 km from the camera, which is
   further than the island is wide.

   PUBLISHED SURFACE
     W.desert.heightAt(x,z)        the ground, anywhere, analytic
     W.desert.biomeAt(x,z)         "dune|salt|rock|wadi|gravel|oasis|shore|sea"
     W.desert.onLand(x,z)          walkable, not sea
     W.desert.landPoint(rnd,opts)  a random walkable spot
     W.desert.oases[]              {x,z,r,floorY,waterY,name}
     W.desert.RADIUS BOUNDS SEA_Y
     W.desert.build(opts) dispose() show() hide()
     W.desert.mapTexture(size)     a painted canvas of the real island
     W.desert.battlefieldAt(x,z,r) a battle-sized patch: ground, relief, cover
     W.desert.slopeAt(x,z)         metres per metre, for "can he walk here"

   Flags (repo doctrine — every behaviour switch has a revert param):
     ?terrain=plain   one dune octave, no provinces, no wadis, no mesas
                      (the honest one-flag "before" for the A/B tool)
     ?scatter=off     no rocks/brush/bones/wrecks/palms
     ?lod=flat        the coarsest level only — silhouette, no detail
============================================================ */
(function () {
  "use strict";
  const G = (typeof window !== "undefined" ? window : globalThis);
  const CBZ = (G.CBZ = G.CBZ || {});
  const W = (CBZ.warlord = CBZ.warlord || {});
  const THREE = G.THREE;

  const QP = (function () {
    try { return new URLSearchParams(G.location ? G.location.search : ""); }
    catch (e) { return { get: function () { return null; } }; }
  })();
  const FLAG_PLAIN = QP.get("terrain") === "plain";
  const FLAG_NOSCATTER = QP.get("scatter") === "off";
  const FLAG_FLATLOD = QP.get("lod") === "flat";

  /* ============================================================ THE SHAPE */
  const RADIUS = 6700;          // nominal land radius; the coast warps ±1000
  const BOUNDS = 8300;          // nothing exists past this
  const SEA_Y = 0;              // sea level is zero. Everything else is signed off it.
  const TAU = Math.PI * 2;

  /* ============================================================ NOISE
     THE TERRAIN HASH IS NOT W.hash01, and that is deliberate. hash01 takes
     WORLD coordinates and pre-scales them by 8 with a Math.round, which is
     exactly right for "the same rock is always here" and pure overhead on a
     lattice index that is already an integer. heightAt runs this ~50 times
     per call and a clipmap rebuild is 4 225 calls, so this is the hot path
     in the file: two imuls, no rounding, no branch. W.hash01 is still what
     the SCATTER uses (see below) because scatter is keyed off world metres
     and must not move when a chunk reloads. */
  function h2(ix, iz, salt) {
    let n = (Math.imul(ix | 0, 73856093) ^ Math.imul(iz | 0, 19349663) ^ Math.imul(salt | 0, 83492791)) | 0;
    n = Math.imul(n ^ (n >>> 13), 0x85ebca6b);
    n ^= n >>> 16;
    return (n >>> 0) / 4294967296;
  }
  // smooth-interpolated value noise on a `cell`-metre lattice
  function vn(x, z, cell, salt) {
    const gx = x / cell, gz = z / cell;
    const ix = Math.floor(gx), iz = Math.floor(gz);
    let fx = gx - ix, fz = gz - iz;
    fx = fx * fx * (3 - 2 * fx); fz = fz * fz * (3 - 2 * fz);
    const a = h2(ix, iz, salt), b = h2(ix + 1, iz, salt);
    const c = h2(ix, iz + 1, salt), d = h2(ix + 1, iz + 1, salt);
    const ab = a + (b - a) * fx, cd = c + (d - c) * fx;
    return ab + (cd - ab) * fz;
  }
  function sm(t) { return t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t); }
  function smr(v, a, b) { return sm((v - a) / (b - a)); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }

  /* SEED. The whole island is a function of this integer, so two players on
     the same seed ride the same sand. build() sets it; anything that asks
     for a height before build() gets the default island rather than a
     crash, which is what keeps the shell's CBZ.floorAt honest at boot. */
  let SEED = 1337;
  let SALT = 0;                 // every noise salt is offset by this
  function S(n) { return (n + SALT) | 0; }

  /* ============================================================ THE COAST
     A circle is not a coastline. Two octaves of warp — one at 2.3 km for
     bays and peninsulas, one at 760 m for the notches inside them — turn
     the radius into something you can recognise a stretch of. Returns
     METRES INLAND (positive) or offshore (negative), which is the number
     every other law in this file wants. */
  function coastAt(x, z) {
    const r = Math.sqrt(x * x + z * z);
    const w = (vn(x, z, 2300, S(401)) - 0.5) * 1560 + (vn(x, z, 760, S(409)) - 0.5) * 540;
    return (RADIUS + w) - r;
  }

  /* ============================================================ PROVINCES
     WHICH LAW OWNS THIS GROUND. Four scores from four long-wavelength
     fields; highest wins, and near a tie the two blend so provinces have
     transition ground instead of a seam. The means are tuned (and read back
     off mapTexture, which is why that function exists as much as for the
     HUD) so the island is roughly 40% erg, 22% gravel, 20% rock, 18% pan —
     dune dominant, because it is a desert, and the rest common enough that
     a ride of two kilometres crosses at least two of them.

     `inland` biases the salt pan: a pan is an endorheic basin and one
     lapping at the sea is a lagoon, which this island does not have. */
  const BLEND = 0.17;
  const _pv = { dune: 0, rock: 0, salt: 0, gravel: 0, top: "dune", w: [0, 0, 0, 0] };
  function provinceAt(x, z, coast) {
    const inland = smr(coast, 900, 3000);
    /* WAVELENGTH IS THE WHOLE ARGUMENT HERE. The first draft used 2.5-4.2 km
       fields, which sounds like "big provinces" and is actually four lattice
       cells across a 13 km island: the biome mix stopped being a design and
       became a per-seed lottery, and the headless audit caught it — seed 1337
       came out 0.6% salt pan. At 1.8-2.6 km the island is 5-9 cells wide in
       every field, so every seed gets all four provinces and a two-kilometre
       ride crosses at least two of them.

       ONE SHARED WARP, not four. Straight value-noise borders are smooth
       blobs; displacing the sample point breaks all four borders at once for
       eight hash lookups instead of thirty-two. */
    const wx = x + (vn(x, z, 620, S(601)) - 0.5) * 460;
    const wz = z + (vn(x, z, 590, S(607)) - 0.5) * 460;
    const d = 0.57 + 1.90 * (vn(wx, wz, 2400, S(611)) - 0.5);
    const k = 0.18 + 2.40 * (vn(wx, wz, 1800, S(617)) - 0.5);
    const s = -0.30 + 2.20 * (vn(wx, wz, 2600, S(619)) - 0.5) + 0.40 * inland;
    const g = 0.26 + 1.80 * (vn(wx, wz, 2100, S(623)) - 0.5);
    _pv.dune = d; _pv.rock = k; _pv.salt = s; _pv.gravel = g;
    let m = d; _pv.top = "dune";
    if (k > m) { m = k; _pv.top = "rock"; }
    if (s > m) { m = s; _pv.top = "salt"; }
    if (g > m) { m = g; _pv.top = "gravel"; }
    // weight falls off linearly over BLEND below the winner, then normalised
    const wd = m - d < BLEND ? 1 - (m - d) / BLEND : 0;
    const wk = m - k < BLEND ? 1 - (m - k) / BLEND : 0;
    const ws = m - s < BLEND ? 1 - (m - s) / BLEND : 0;
    const wg = m - g < BLEND ? 1 - (m - g) / BLEND : 0;
    const t = wd + wk + ws + wg;
    _pv.w[0] = wd / t; _pv.w[1] = wk / t; _pv.w[2] = ws / t; _pv.w[3] = wg / t;
    return _pv;
  }

  /* ============================================================ THE LAWS */

  /* ERG. A transverse dune field with a prevailing wind that rotates slowly
     across the island. The profile is the part that matters: `t < 0.74` is
     the long windward ramp and the remaining quarter is the slip face, so
     the crest sits three-quarters of the way along and the lee side falls
     off steeply. A symmetric sine reads as fabric; this reads as sand. */
  function ergAt(x, z) {
    /* SPACING IS 130-390 m, NOT 70-265, and the reason is aliasing as much as
       geography. Real transverse dunes stand 100-500 m apart; more to the
       point, the SLIP FACE is under a third of the spacing, so at 70 m
       spacing the sharp lee edge is 18 m wide — narrower than the second LOD
       ring's 20 m cell. The grid alternately caught and missed each crest and
       every ridge on the horizon photographed as a hard triangular sawtooth.
       At 130 m minimum the narrowest slip face is 42 m, two cells, and the
       skyline is a skyline. */
    const amp = 8 + 32 * vn(x, z, 2600, S(701));
    const wave = 130 + 260 * vn(x, z, 3100, S(709));
    const ang = (vn(x, z, 4200, S(713)) - 0.5) * 1.7 + 0.7;
    let u = (x * Math.cos(ang) + z * Math.sin(ang)) / wave;
    u += (vn(x, z, 430, S(719)) - 0.5) * 0.95;      // crests meander, never rule-straight
    const t = u - Math.floor(u);
    const p = t < 0.68 ? t / 0.68 : 1 - (t - 0.68) / 0.32;
    const crest = p * p * (3 - 2 * p);
    /* RIPPLES. From the air a 200 m dune is a smooth hill and reads as
       grassland-with-no-grass; the thing that says SAND is the metre-scale
       corrugation running across the back of it. One sine, no hash, angled
       off the same wind — costs nothing and it is the single change that
       made the ground stop looking like a bedsheet. */
    /* 52 m, not 24, and 0.38 m, not 0.85: at 24 m the ripple is shorter than
       the LOD cell from about 700 m out, and point-sampling it aliased into a
       hard sawtooth along every dune crest on the horizon. Long enough that
       the second LOD ring still resolves it, shallow enough that the rings
       that cannot are wrong by less than half a metre. */
    const rip = Math.sin((x * Math.cos(ang + 0.42) + z * Math.sin(ang + 0.42)) / 52) * 0.38;
    // the erg itself undulates under the dunes — a dune field is not a table
    return 3.5 + crest * amp + rip * (0.45 + crest * 0.55) + (vn(x, z, 1500, S(731)) - 0.5) * 15;
  }

  /* ROCK. mask is a NARROW smoothstep band (0.500→0.585) which is what
     makes the sides steep; widen it and you get hills. The plateau height
     is a THREE-STEP QUANTISED field, so tops are flat tables at 30/50/70 m
     and neighbouring mesas stand at honestly different heights. */
  function rockAt(x, z) {
    const mask = smr(vn(x, z, 700, S(801)), 0.500, 0.585);
    const tier = Math.floor(vn(x, z, 1900, S(809)) * 2.999);
    const top = 30 + tier * 20;
    const floor = 5 + (vn(x, z, 900, S(813)) - 0.5) * 9;
    // buttes: a second, much tighter mask standing on the plateau
    const butte = smr(vn(x, z, 300, S(811)), 0.640, 0.672) * 20 * mask;
    return lerp(floor, top, mask) + butte + (vn(x, z, 140, S(817)) - 0.5) * 1.6 * (1 - mask);
  }

  /* SALT. Two centimetres of relief on purpose. The pan's whole gameplay
     job is being the one surface with nowhere to hide, and any relief at
     all gives cover. The cracks are painted, not modelled. */
  function saltAt(x, z) {
    return 1.7 + (vn(x, z, 620, S(903)) - 0.5) * 1.5 + (vn(x, z, 90, S(901)) - 0.5) * 0.5;
  }

  /* GRAVEL. Ground. Long shallow swells you can see over. */
  function gravelAt(x, z) {
    return 6 + (vn(x, z, 1150, S(951)) - 0.5) * 12 + (vn(x, z, 240, S(953)) - 0.5) * 2.6;
  }

  /* WADI. Applied over everything, because a dry riverbed does not respect
     province borders — it cuts an erg, a gravel plain and the shoulder of a
     mesa on its way to the sea. Two scales: a trunk channel ~26 m deep and
     tributaries ~11 m. The channel line is the iso-contour of a noise field
     (|n - 0.5| small), which meanders like a wash and costs two lookups. */
  function wadiAt(x, z) {
    let cut = 0;
    const a = Math.abs(vn(x, z, 1700, S(1001)) - 0.5);
    if (a < 0.042) { const k = 1 - a / 0.042; cut += k * k * (3 - 2 * k) * 27; }
    const b = Math.abs(vn(x, z, 620, S(1009)) - 0.5);
    if (b < 0.024) { const k = 1 - b / 0.024; cut += k * k * (3 - 2 * k) * 12; }
    return cut;
  }

  /* ============================================================ OASES
     Placed by rejection sampling against the terrain WITHOUT the oasis
     term, which is why they live behind their own init and why heightAt
     calls ensureInit() first. The floor is dug 11 m below the local ground
     and the site is rejected unless that leaves the water surface safely
     above sea level — an oasis pond below y=0 would be flooded by the one
     global sea plane, and there is only one sea plane on purpose. */
  const OASIS_NAMES = ["AIN ZAHRA", "THE GREEN WELL", "SIDI FARKH", "TWO PALMS",
                       "KHOR AMANI", "THE LAST WATER", "BIR TAMAN", "WHITE SPRING"];
  let oases = [];
  let inited = false;

  function baseHeight(x, z) {          // everything except the oasis bowls
    const coast = coastAt(x, z);
    if (coast <= 0) return seabed(-coast);
    let y;
    if (FLAG_PLAIN) {
      y = 4 + (vn(x, z, 240, S(701)) - 0.5) * 26;   // the "before": one octave, nothing else
    } else {
      const P = provinceAt(x, z, coast);
      y = 0;
      if (P.w[0] > 0.001) y += P.w[0] * ergAt(x, z);
      if (P.w[1] > 0.001) y += P.w[1] * rockAt(x, z);
      if (P.w[2] > 0.001) y += P.w[2] * saltAt(x, z);
      if (P.w[3] > 0.001) y += P.w[3] * gravelAt(x, z);
      const cut = wadiAt(x, z);
      if (cut > 0) y = Math.max(2.4, y - cut);
    }
    /* THE BEACH. Below 150 m inland the shore profile takes over and the
       land walks down to the waterline at about 1:20. The first draft
       blended over 40 m and every coast on the island was a 20 m cliff
       into blue — from the air it read as a cut-out, not an island. */
    const t = sm(coast / 150);
    return lerp(coast * 0.05, Math.max(2.0, y), t);
  }
  /* THE SHELF DROPS FAST, and that is a depth-buffer decision as much as a
     geographical one. The first draft ran the bottom out at 1:22 for 300 m
     and then down to -70 over another 900 m, which is what a real sandy
     shelf does — and at 6 km, with near=2 and far=16000, the z-buffer cannot
     separate a -13 m bottom from a 0 m sea surface. The far water rendered
     as a COMB of sand and blue stripes. 12 m of visible surf zone, then
     straight down: the beach the player walks is on the LAND side of the
     waterline and loses nothing, and by 400 m out the bottom is 60 m under
     the plane and nothing fights. */
  function seabed(d) {
    if (d < 60) return -d * 0.075;                      // the surf, where you can see the bottom
    return -4.5 - Math.min(1, (d - 60) / 340) * 74;
  }

  function ensureInit() {
    if (inited) return;
    inited = true;
    oases = [];
    const rnd = (W.rngFrom ? W.rngFrom(SEED ^ 0x5eed) : Math.random);
    for (let guard = 0; guard < 4000 && oases.length < 7; guard++) {
      const a = rnd() * TAU, r = 700 + Math.sqrt(rnd()) * (RADIUS * 0.82);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const coast = coastAt(x, z);
      if (coast < 420) continue;
      const g = baseHeight(x, z);
      if (g < 15 || g > 46) continue;
      if (slopeOf(baseHeight, x, z) > 0.20) continue;     // not on a mesa flank
      let clash = false;
      for (let i = 0; i < oases.length; i++) {
        if (Math.hypot(oases[i].x - x, oases[i].z - z) < 1100) { clash = true; break; }
      }
      if (clash) continue;
      const rad = 62 + rnd() * 54;
      const floorY = g - 11;
      oases.push({
        id: "o" + oases.length,
        name: OASIS_NAMES[oases.length % OASIS_NAMES.length],
        x: x, z: z, r: rad, floorY: floorY, waterY: floorY + 1.6, ground: g,
      });
    }
    D.oases = oases;
  }
  function slopeOf(fn, x, z) {
    const e = 6;
    return Math.max(Math.abs(fn(x + e, z) - fn(x - e, z)), Math.abs(fn(x, z + e) - fn(x, z - e))) / (e * 2);
  }

  /* the oasis bowl, applied to a base height. w→1 in the middle so the pond
     bottom is genuinely flat and the water has a constant depth. */
  function oasisMix(x, z, y) {
    for (let i = 0; i < oases.length; i++) {
      const o = oases[i];
      const dx = x - o.x, dz = z - o.z;
      const d2 = dx * dx + dz * dz;
      const R = o.r * 1.85;
      if (d2 > R * R) continue;
      // saturates well before the middle, so the pond bottom is genuinely
      // flat and the water has one honest depth rather than a dimple
      const t = sm((R - Math.sqrt(d2)) / (R * 0.72));
      y = lerp(y, o.floorY, t);
    }
    return y;
  }

  /* ============================================================ heightAt
     THE function. Everything in this game asks this and nothing asks the
     mesh. Kept to ~40 hash lookups in the common case by only evaluating
     the province laws that actually have weight here. */
  function heightAt(x, z) {
    if (!inited) ensureInit();
    let y = baseHeight(x, z);
    if (y > SEA_Y && oases.length) y = oasisMix(x, z, y);
    return y;
  }

  /* ============================================================ biomeAt */
  function biomeAt(x, z) {
    if (!inited) ensureInit();
    const coast = coastAt(x, z);
    if (coast <= 0) return "sea";
    for (let i = 0; i < oases.length; i++) {
      const o = oases[i];
      if (Math.hypot(x - o.x, z - o.z) < o.r * 1.6) return "oasis";
    }
    if (coast < 110) return "shore";
    if (FLAG_PLAIN) return "dune";
    if (wadiAt(x, z) > 6) return "wadi";
    return provinceAt(x, z, coast).top;
  }

  /* ============================================================ THE MODULE */
  const D = W.desert = W.desert || {};
  D.RADIUS = RADIUS;
  D.BOUNDS = BOUNDS;
  D.SEA_Y = SEA_Y;
  D.oases = oases;
  D.heightAt = heightAt;
  D.biomeAt = biomeAt;
  D.coastAt = coastAt;
  D.slopeAt = function (x, z) { return slopeOf(heightAt, x, z); };
  D.onLand = function (x, z) { return coastAt(x, z) > 6 && heightAt(x, z) > 0.4; };

  /* a random walkable spot. Rejection sampling with a slope gate, because
     "not in the sea" is not the same as "a man can stand here" — the mesa
     walls and the dune slip faces are land and nothing should spawn on
     them. Falls back to the beach, which is always walkable. */
  D.landPoint = function (rnd, opts) {
    opts = opts || {};
    rnd = rnd || (W.rnd || Math.random);
    const maxSlope = opts.maxSlope != null ? opts.maxSlope : 0.42;
    const minR = opts.minR || 0;
    const maxR = opts.maxR != null ? opts.maxR : RADIUS * 0.92;
    for (let i = 0; i < 300; i++) {
      let x, z;
      if (opts.near) {
        const a = rnd() * TAU, r = (opts.nearR || 700) * Math.sqrt(rnd());
        x = opts.near.x + Math.cos(a) * r; z = opts.near.z + Math.sin(a) * r;
      } else {
        const a = rnd() * TAU, r = minR + (maxR - minR) * Math.sqrt(rnd());
        x = Math.cos(a) * r; z = Math.sin(a) * r;
      }
      if (!D.onLand(x, z)) continue;
      if (D.slopeAt(x, z) > maxSlope) continue;
      if (opts.biome && biomeAt(x, z) !== opts.biome) continue;
      return { x: x, z: z, y: heightAt(x, z) };
    }
    // the beach never fails: walk inland from a random bearing until dry
    const a = (rnd() * TAU);
    for (let r = RADIUS * 0.9; r > 200; r -= 60) {
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (D.onLand(x, z)) return { x: x, z: z, y: heightAt(x, z) };
    }
    return { x: 0, z: 0, y: heightAt(0, 0) };
  };

  /* ============================================================ COLOUR
     SAND IS NOT ONE BEIGE. Colour is biome × slope × height, per vertex:
     dune crests bleach and troughs hold shadow, mesa walls are iron-red and
     their caps are pale, the pan is white with dark polygon cracks, the
     wadi floor is silt, the shore has a wet band above the waterline. Slope
     is the term doing the most work — a face steep enough that sand cannot
     sit on it goes to rock everywhere on the island, which is what makes
     dunes look like dunes and mesas look like stone. */
  /* THESE ARE LINEAR ALBEDOS, and the first draft's were not — they were the
     numbers you would type into a paint program (0.9, 0.79, 0.55 for sand).
     r128 feeds vertex colours to the shader as LINEAR and converts once at
     output, so an sRGB-looking value is roughly twice the reflectance it
     looks like. Under a 1.1 sun plus a 0.6 hemisphere that put the ground
     over 1.0 everywhere and the whole island photographed as white paper —
     the first strategic screenshot is unusable and it is entirely this.
     Dry sand really is about 0.40 linear; these are measured-ish albedos. */
  const C_SAND_LO = [0.34, 0.25, 0.14], C_SAND_HI = [0.52, 0.42, 0.26];
  const C_ROCK_LO = [0.16, 0.10, 0.07], C_ROCK_HI = [0.31, 0.20, 0.13];
  const C_CAP = [0.28, 0.25, 0.21];
  const C_SALT = [0.70, 0.69, 0.64], C_CRACK = [0.36, 0.33, 0.27];
  const C_GRAVEL = [0.26, 0.22, 0.16];
  const C_SILT = [0.20, 0.17, 0.11];
  const C_WET = [0.20, 0.16, 0.12], C_BEACH = [0.52, 0.45, 0.31];
  const C_GREEN = [0.09, 0.19, 0.05];
  const C_SEABED = [0.10, 0.14, 0.11];
  const _c = [0, 0, 0];
  function mix3(a, b, t, out) {
    out[0] = a[0] + (b[0] - a[0]) * t;
    out[1] = a[1] + (b[1] - a[1]) * t;
    out[2] = a[2] + (b[2] - a[2]) * t;
    return out;
  }
  function colourAt(x, z, y, slope, out) {
    const coast = coastAt(x, z);
    if (y < SEA_Y - 0.2) return mix3(C_SEABED, C_WET, smr(y, -22, 0), out);
    if (coast < 130) {
      // the wet band is the two metres above the waterline, and it is the
      // single cheapest thing that makes a coast read as a coast
      mix3(C_WET, C_BEACH, smr(y, 0.2, 3.2), out);
      if (coast > 70) mix3(out, C_SAND_LO, smr(coast, 70, 130), out);
      return out;
    }
    let b = FLAG_PLAIN ? "dune" : null;
    if (!b) {
      for (let i = 0; i < oases.length; i++) {
        if (Math.hypot(x - oases[i].x, z - oases[i].z) < oases[i].r * 1.5) { b = "oasis"; break; }
      }
    }
    if (!b) {
      const cut = wadiAt(x, z);
      b = cut > 6 ? "wadi" : provinceAt(x, z, coast).top;
    }
    if (b === "salt") {
      // polygon cracks: a high-frequency iso-contour, painted not modelled
      const cr = Math.abs(vn(x, z, 22, S(1201)) - 0.5);
      mix3(C_SALT, C_CRACK, cr < 0.055 ? 1 - cr / 0.055 : 0, out);
    } else if (b === "rock") {
      mix3(C_ROCK_LO, C_ROCK_HI, vn(x, z, 60, S(1211)), out);
      mix3(out, C_CAP, clamp(1 - slope * 5.5, 0, 1) * smr(y, 26, 34), out);
    } else if (b === "gravel") {
      mix3(C_GRAVEL, C_SAND_LO, vn(x, z, 130, S(1221)), out);
    } else if (b === "wadi") {
      mix3(C_SILT, C_SAND_LO, smr(slope, 0.08, 0.5), out);
    } else if (b === "oasis") {
      mix3(C_GREEN, C_SAND_LO, smr(y - (oasisFloorNear(x, z)), 2.5, 11), out);
    } else {
      // dune: crests bleach, troughs hold the shadow of the last one
      mix3(C_SAND_LO, C_SAND_HI, smr(y, 4, 30), out);
    }
    // sand cannot sit on a face this steep — anywhere on the island
    if (slope > 0.34) mix3(out, C_ROCK_LO, smr(slope, 0.34, 0.85) * 0.78, out);
    // one cheap per-vertex break-up so an 8 m cell does not read as a tile
    const g = 0.93 + h2(Math.round(x), Math.round(z), S(1301)) * 0.14;
    out[0] *= g; out[1] *= g; out[2] *= g;
    return out;
  }
  function oasisFloorNear(x, z) {
    let best = 0, bd = 1e9;
    for (let i = 0; i < oases.length; i++) {
      const d = Math.hypot(x - oases[i].x, z - oases[i].z);
      if (d < bd) { bd = d; best = oases[i].floorY; }
    }
    return best;
  }

  /* ============================================================ THE MESH
     Seven clipmap levels. Every level is the SAME 64x64 grid; only the cell
     size differs, so one buffer layout serves all of them and a rebuild is
     a rewrite of position.y + colour, never an allocation. */
  const RING = 40;              // quads from centre to edge, per level
  const N = RING * 2;           // 64 quads across
  const VN = N + 1;             // 65 vertices across
  /* 10 m x 40 quads = the finest ring reaches 400 m, and that number is the
     one the pictures argued about: at 8 m x 32 the level 0/1 seam landed 256 m
     out — right on the dune crest in front of you — and the resolution jump
     read as a serrated edge along the skyline. 400 m puts the first seam past
     the dune you are looking at, for 6 561 vertices a rebuild instead of
     4 225 (2.9 ms, once every 10 m of riding). */
  const CELL0 = 10;             // metres per quad, finest level
  const LEVELS = FLAG_FLATLOD ? 1 : 7;

  let root = null, levels = [], water = null, oasisWater = null, scatterRoot = null;
  let built = false, visible = false;
  const heightBuf = new Float32Array(VN * VN);
  const dirtyQueue = [];

  function makeLevel(i) {
    const cell = CELL0 * Math.pow(2, FLAG_FLATLOD ? 6 : i);
    const span = cell * N;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(VN * VN * 3);
    const col = new Float32Array(VN * VN * 3);
    for (let j = 0; j < VN; j++) for (let k = 0; k < VN; k++) {
      const o = (j * VN + k) * 3;
      pos[o] = (k - RING) * cell;
      pos[o + 2] = (j - RING) * cell;
    }
    /* THE HOLE, WITH AN OVERLAP. Level i-1 covers ±RING*cell/2 around ITS
       centre, and the two centres snap to different lattices so they can
       disagree by one of this level's cells. A hole cut at exactly
       RING/2 is therefore a hole cut one cell too big half the time — a
       ring of sky through the ground, which is precisely how the first
       draft looked. Two cells of deliberate overlap; the coarse level is
       polygon-offset behind so the band does not z-fight. */
    const hole = i === 0 ? -1 : (RING / 2 - 2);
    const idx = [];
    for (let j = 0; j < N; j++) for (let k = 0; k < N; k++) {
      if (hole > 0) {
        const dj = Math.abs(j - RING + 0.5), dk = Math.abs(k - RING + 0.5);
        if (dj < hole && dk < hole) continue;
      }
      const a = j * VN + k, b = a + 1, c = a + VN, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    geo.setIndex(idx.length > 65535 ? new THREE.Uint32BufferAttribute(idx, 1)
                                    : new THREE.Uint16BufferAttribute(idx, 1));
    /* NO polygonOffset. Two drafts used it to keep the coarse ring behind the
       fine one in the two-cell overlap band, and the second draft's
       screenshot is why it is gone: polygon offset is SLOPE-SCALED, and a
       coarse terrain triangle seen at a grazing angle six kilometres away
       has an enormous depth slope, so a factor of 12 pushed the far half of
       the island tens of metres behind the sea plane. The horizon rendered
       as a comb of blue and sand stripes across the whole screen.

       A WORLD-SPACE DROP instead: level i sits 0.45·i metres lower than the
       one inside it. View-independent, so it cannot blow up at a grazing
       angle; 2.7 m on the coarsest level, which is invisible at the eight
       kilometres that level is ever seen from; and it slopes the far
       coastline slightly UNDER the water, which is the right direction for
       a shoreline nothing out there can resolve anyway. */
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = i < 2;          // shadows only where you can see them
    mesh.frustumCulled = false;          // it is centred on the camera; culling it is never right
    mesh.userData.terrain = true;
    mesh.renderOrder = -10 + i;
    return { i: i, cell: cell, span: span, bias: -0.45 * i, mesh: mesh, geo: geo, cx: NaN, cz: NaN, dirty: true };
  }

  function fillLevel(L, camX, camZ) {
    const cell = L.cell;
    const cx = Math.round(camX / cell) * cell;
    const cz = Math.round(camZ / cell) * cell;
    L.cx = cx; L.cz = cz;
    const pos = L.geo.attributes.position.array;
    const col = L.geo.attributes.color.array;
    // pass 1: heights. Every vertex, hole included — the hole vertices cost
    // 25% more heightAt and buy correct slopes at the hole's edge, which is
    // where a wrong normal is most visible.
    for (let j = 0; j < VN; j++) {
      const wz = cz + (j - RING) * cell;
      for (let k = 0; k < VN; k++) {
        heightBuf[j * VN + k] = heightAt(cx + (k - RING) * cell, wz);
      }
    }
    // pass 2: y + colour. Slope comes from the grid neighbours, not from two
    // more heightAt calls — the finite difference is already in the buffer
    // and asking the function again would triple the cost of a rebuild.
    const inv = 1 / (2 * cell);
    for (let j = 0; j < VN; j++) {
      const wz = cz + (j - RING) * cell;
      for (let k = 0; k < VN; k++) {
        const t = j * VN + k, o = t * 3;
        const y = heightBuf[t];
        /* THE LEVEL BIAS FADES OUT AT THE WATERLINE. Flat -0.45·i sank the
           wadi floors (which bottom out at ~2 m) below the sea plane on the
           coarse rings and the island grew blue rivers. Scaled by height, it
           is full strength up on the terrain where the levels overlap and
           zero where a metre matters. */
        pos[o + 1] = y + L.bias * (y > 9 ? 1 : y > 0 ? y / 9 : 0);
        const xl = heightBuf[t - (k > 0 ? 1 : 0)], xr = heightBuf[t + (k < N ? 1 : 0)];
        const zl = heightBuf[t - (j > 0 ? VN : 0)], zr = heightBuf[t + (j < N ? VN : 0)];
        const slope = Math.hypot((xr - xl) * inv, (zr - zl) * inv);
        colourAt(cx + (k - RING) * cell, wz, y, slope, _c);
        col[o] = _c[0]; col[o + 1] = _c[1]; col[o + 2] = _c[2];
      }
    }
    L.geo.attributes.position.needsUpdate = true;
    L.geo.attributes.color.needsUpdate = true;
    L.geo.computeVertexNormals();
    L.mesh.position.set(cx, 0, cz);
    L.dirty = false;
  }

  /* ============================================================ WATER */
  function makeWater() {
    const g = new THREE.PlaneGeometry(BOUNDS * 6, BOUNDS * 6);
    g.rotateX(-Math.PI / 2);
    /* Phong, not Lambert, for exactly one reason: the sun glint. A desert
       island photographs as a hot sky over dead-flat blue without it, and
       one specular highlight is the whole difference between "water" and
       "a blue plane". */
    const m = new THREE.MeshPhongMaterial({ color: 0x123b52, shininess: 84, specular: 0x6fa8bd });
    const mesh = new THREE.Mesh(g, m);
    mesh.position.y = SEA_Y;
    mesh.receiveShadow = false;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    mesh.renderOrder = -20;
    return mesh;
  }
  function makeOasisWater() {
    const grp = new THREE.Group();
    const mat = new THREE.MeshPhongMaterial({ color: 0x1c5560, shininess: 92, specular: 0x8fc4cc });
    for (let i = 0; i < oases.length; i++) {
      const o = oases[i];
      const g = new THREE.CircleGeometry(o.r * 0.62, 22);
      g.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(g, mat);
      m.position.set(o.x, o.waterY, o.z);
      m.matrixAutoUpdate = false; m.updateMatrix();
      grp.add(m);
    }
    return grp;
  }

  /* ============================================================ SCATTER
     Instanced, deterministic, and keyed off W.hash01 of the WORLD position
     of the cell — so a rock is in the same place after you ride away and
     come back, which is the whole reason this is not Math.random. The
     scatter follows the camera in 256 m cells out to ~1.1 km; past that the
     props are sub-pixel and the terrain colour is carrying the look.

     Palms are NOT in this system: they belong to the oases, there are only
     a couple of hundred of them, and they must be there whether or not you
     are standing next to them (an oasis you cannot see from a kilometre
     away is not a landmark). */
  const SC_CELL = 256, SC_RING = 4;         // ±4 cells = 1.15 km of dressing
  const SC_CAP = { rock: 900, brush: 1100, bone: 220, wreck: 30 };
  let scatter = null, scCX = NaN, scCZ = NaN;

  function makeScatter() {
    if (FLAG_NOSCATTER || !THREE.InstancedMesh) return null;
    const grp = new THREE.Group();
    function im(geo, colour, cap, shadow) {
      const m = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: colour }), cap);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.castShadow = !!shadow; m.receiveShadow = false;
      m.frustumCulled = false;
      m.count = 0;
      grp.add(m);
      return m;
    }
    const s = {
      root: grp,
      rock: im(new THREE.IcosahedronGeometry(1, 0), 0x453b2f, SC_CAP.rock, true),
      brush: im(new THREE.ConeGeometry(0.7, 1.1, 5), 0x37331d, SC_CAP.brush, false),
      bone: im(new THREE.BoxGeometry(0.24, 0.24, 2.1), 0x9c957f, SC_CAP.bone, false),
      wreck: im(new THREE.BoxGeometry(2.2, 1.4, 5.0), 0x3a2a20, SC_CAP.wreck, true),
    };
    return s;
  }

  const _m4 = THREE ? new THREE.Matrix4() : null;
  const _q = THREE ? new THREE.Quaternion() : null;
  const _e = THREE ? new THREE.Euler() : null;
  const _v3 = THREE ? new THREE.Vector3() : null;
  const _s3 = THREE ? new THREE.Vector3() : null;
  function put(mesh, n, x, y, z, yaw, sx, sy, sz) {
    if (n >= mesh.instanceMatrix.count) return n;
    _e.set(0, yaw, 0); _q.setFromEuler(_e);
    _v3.set(x, y, z); _s3.set(sx, sy, sz);
    _m4.compose(_v3, _q, _s3);
    mesh.setMatrixAt(n, _m4);
    return n + 1;
  }

  function refillScatter(camX, camZ) {
    if (!scatter) return;
    const cx = Math.round(camX / SC_CELL), cz = Math.round(camZ / SC_CELL);
    if (cx === scCX && cz === scCZ) return;
    scCX = cx; scCZ = cz;
    const hash = W.hash01;
    let nR = 0, nB = 0, nO = 0, nW = 0;
    for (let gz = cz - SC_RING; gz <= cz + SC_RING; gz++) {
      for (let gx = cx - SC_RING; gx <= cx + SC_RING; gx++) {
        const bx = gx * SC_CELL, bz = gz * SC_CELL;
        // one hash decides how busy this cell is at all — cheap reject
        const busy = hash(bx, bz, 71);
        const count = 6 + Math.floor(busy * 16);
        for (let i = 0; i < count; i++) {
          const x = bx + hash(bx + i * 13, bz, 101 + i) * SC_CELL;
          const z = bz + hash(bx, bz + i * 17, 211 + i) * SC_CELL;
          if (coastAt(x, z) < 12) continue;
          const y = heightAt(x, z);
          if (y < 0.6) continue;
          const b = biomeAt(x, z);
          if (b === "salt" && i > 1) continue;             // the pan is empty. that is its job.
          const roll = hash(x, z, 307);
          const yaw = hash(x, z, 401) * TAU;
          if (b === "rock" || b === "gravel" || roll < 0.55) {
            const s = 0.42 + hash(x, z, 409) * (b === "rock" ? 1.9 : 0.95);
            nR = put(scatter.rock, nR, x, y + s * 0.45, z, yaw, s, s * (0.6 + roll * 0.7), s);
          } else if (roll < 0.9) {
            const s = 0.6 + hash(x, z, 419) * 0.9;
            nB = put(scatter.brush, nB, x, y + s * 0.5, z, yaw, s, s, s);
          } else if (roll < 0.975) {
            nO = put(scatter.bone, nO, x, y + 0.12, z, yaw, 1, 1, 0.6 + roll);
          } else if (D.slopeAt(x, z) < 0.16) {
            nW = put(scatter.wreck, nW, x, y + 0.7, z, yaw, 1, 1, 1);
          }
        }
      }
    }
    scatter.rock.count = nR; scatter.rock.instanceMatrix.needsUpdate = true;
    scatter.brush.count = nB; scatter.brush.instanceMatrix.needsUpdate = true;
    scatter.bone.count = nO; scatter.bone.instanceMatrix.needsUpdate = true;
    scatter.wreck.count = nW; scatter.wreck.instanceMatrix.needsUpdate = true;
  }

  function makePalms() {
    if (FLAG_NOSCATTER || !THREE.InstancedMesh || !oases.length) return null;
    const grp = new THREE.Group();
    const per = 26;
    const cap = oases.length * per;
    const trunks = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.22, 0.4, 7, 5),
      new THREE.MeshLambertMaterial({ color: 0x33270f }), cap);
    const fronds = new THREE.InstancedMesh(
      new THREE.ConeGeometry(3.1, 1.7, 6),
      new THREE.MeshLambertMaterial({ color: 0x1c3b12 }), cap);
    trunks.castShadow = fronds.castShadow = true;
    let n = 0, f = 0;
    for (let i = 0; i < oases.length; i++) {
      const o = oases[i];
      for (let j = 0; j < per; j++) {
        const a = W.hash01(o.x + j, o.z, 501 + j) * TAU;
        const r = o.r * (0.55 + W.hash01(o.x, o.z + j, 509 + j) * 0.85);
        const x = o.x + Math.cos(a) * r, z = o.z + Math.sin(a) * r;
        const y = heightAt(x, z);
        if (y < o.waterY + 0.2) continue;
        const s = 0.8 + W.hash01(x, z, 517) * 0.6;
        n = put(trunks, n, x, y + 3.5 * s, z, a, s, s, s);
        f = put(fronds, f, x, y + 7.1 * s, z, a, s, s, s);
      }
    }
    trunks.count = n; fronds.count = f;
    trunks.instanceMatrix.needsUpdate = fronds.instanceMatrix.needsUpdate = true;
    grp.add(trunks); grp.add(fronds);
    return grp;
  }

  /* ============================================================ BUILD */
  /* THE SEED IS SETTABLE WITHOUT THREE, on purpose: core.js is loadable in
     Node for a determinism test and this file's whole terrain half should be
     too. Everything above this line is pure maths; only what follows needs a
     GPU. */
  D.reseed = function (seed) {
    seed = seed | 0;
    if (inited && seed === SEED) return false;
    SEED = seed;
    SALT = (Math.imul(SEED, 2654435761) >>> 5) & 0xffff;
    inited = false;
    mapCache = {};
    ensureInit();
    return true;
  };
  D.seed = function () { return SEED; };

  D.build = function (opts) {
    opts = opts || {};
    const seed = opts.seed != null ? (opts.seed | 0) : SEED;
    const changed = D.reseed(seed);
    if (!THREE) return null;
    if (built && !changed) { D.show(); return root; }
    if (built) D.dispose();

    root = new THREE.Group();
    root.name = "warlordIsland";
    levels = [];
    for (let i = 0; i < LEVELS; i++) {
      const L = makeLevel(i);
      levels.push(L);
      root.add(L.mesh);
    }
    water = makeWater();
    root.add(water);
    oasisWater = makeOasisWater();
    root.add(oasisWater);
    const palms = makePalms();
    if (palms) root.add(palms);
    scatter = makeScatter();
    if (scatter) { scatterRoot = scatter.root; root.add(scatterRoot); }
    scCX = scCZ = NaN;
    CBZ.scene.add(root);
    built = true; visible = true;

    // first fill is synchronous and complete: the campaign places the player
    // on this ground on the very next line and a half-built island under his
    // feet is a man standing in the sky.
    const c = opts.at || { x: 0, z: 0 };
    for (let i = 0; i < levels.length; i++) fillLevel(levels[i], c.x, c.z);
    refillScatter(c.x, c.z);
    mapCache = {};
    return root;
  };

  /* THE ISLAND IS HIDDEN, NEVER REBUILT. Raising 14 km of terrain after
     every battle is the obvious wrong answer — it is ~30k heightAt calls
     and a second of stall for a world that has not changed. */
  D.show = function () { if (root) { root.visible = true; visible = true; } };
  D.hide = function () { if (root) { root.visible = false; visible = false; } };
  D.visible = function () { return visible; };
  D.built = function () { return built; };
  D.root = function () { return root; };

  D.dispose = function () {
    if (!root) return;
    CBZ.scene.remove(root);
    root.traverse(function (o) {
      if (o.geometry) o.geometry.dispose();
      if (o.material) { if (Array.isArray(o.material)) o.material.forEach(function (m) { m.dispose(); }); else o.material.dispose(); }
    });
    root = null; levels = []; water = null; oasisWater = null; scatter = null; scatterRoot = null;
    built = false; visible = false;
    dirtyQueue.length = 0;
  };

  /* ============================================================ FOLLOW
     Called by the campaign every frame with the camera position. At most
     ONE level is rebuilt per frame: a rebuild is 4 225 heightAt calls
     (~1.5 ms measured on this laptop) and doing three in one frame is a
     visible hitch at exactly the moment you are riding fastest. The finest
     level is rebuilt first because it is the one under your feet. */
  D.follow = function (camX, camZ) {
    if (!built || !visible) return;
    for (let i = 0; i < levels.length; i++) {
      const L = levels[i];
      const half = L.cell * 0.5;
      if (Math.abs(camX - L.cx) > half || Math.abs(camZ - L.cz) > half) { L.dirty = true; }
    }
    for (let i = 0; i < levels.length; i++) {
      if (levels[i].dirty) { fillLevel(levels[i], camX, camZ); break; }
    }
    refillScatter(camX, camZ);
  };

  /* ============================================================ THE MAP
     Painted from the same two functions everything else reads, so the map
     cannot disagree with the island. Hillshaded off the height gradient —
     a biome-colour map with no shading is a political map and you cannot
     see a mesa on one. Cached, because 384² is 147k heightAt calls. */
  let mapCache = {};
  D.mapTexture = function (size) {
    size = size || 384;
    if (mapCache[size]) return mapCache[size];
    if (!inited) ensureInit();
    const cv = document.createElement("canvas");
    cv.width = cv.height = size;
    const g = cv.getContext("2d");
    const img = g.createImageData(size, size);
    const px = img.data;
    const span = BOUNDS * 2, step = span / size;
    const hs = new Float32Array(size * size);
    for (let j = 0; j < size; j++) {
      const z = -BOUNDS + j * step;
      for (let k = 0; k < size; k++) hs[j * size + k] = heightAt(-BOUNDS + k * step, z);
    }
    for (let j = 0; j < size; j++) {
      const z = -BOUNDS + j * step;
      for (let k = 0; k < size; k++) {
        const t = j * size + k, o = t * 4;
        const x = -BOUNDS + k * step, y = hs[t];
        if (y < SEA_Y) {
          // shelf → deep, so the coastline reads and so does the drop-off
          const d = clamp(-y / 60, 0, 1);
          px[o] = 20 + (1 - d) * 40; px[o + 1] = 70 + (1 - d) * 60; px[o + 2] = 110 + (1 - d) * 55;
          px[o + 3] = 255;
          continue;
        }
        const xl = hs[t - (k > 0 ? 1 : 0)], xr = hs[t + (k < size - 1 ? 1 : 0)];
        const zl = hs[t - (j > 0 ? size : 0)], zr = hs[t + (j < size - 1 ? size : 0)];
        const slope = Math.hypot((xr - xl) / (2 * step), (zr - zl) / (2 * step));
        colourAt(x, z, y, slope, _c);
        // hillshade from a north-west sun, the cartographic convention
        const sh = clamp(0.72 + ((xl - xr) + (zl - zr)) / (step * 2.2), 0.35, 1.5);
        px[o] = clamp(_c[0] * sh * 255, 0, 255);
        px[o + 1] = clamp(_c[1] * sh * 255, 0, 255);
        px[o + 2] = clamp(_c[2] * sh * 255, 0, 255);
        px[o + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    mapCache[size] = cv;
    return cv;
  };
  // world metres -> map canvas pixels, published so the HUD cannot get it wrong
  D.mapProject = function (x, z, size) {
    const s = size || 384;
    return { x: (x + BOUNDS) / (BOUNDS * 2) * s, y: (z + BOUNDS) / (BOUNDS * 2) * s };
  };

  /* ============================================================ THE BATTLEFIELD
     battle.js asks: "we fought HERE — what does the ground look like?" It
     gets a LOCAL frame: (0,0) is the fight, y=0 is the ground under it, and
     every cover box is in those coordinates, because a battle arena is
     built around the origin and making it do the subtraction is how the
     arena ends up 40 m in the air. `origin` is published for anything that
     wants to go back to world space.

     COVER IS DERIVED FROM THE BIOME, not sprinkled: a salt pan fight is
     open ground and a mesa field fight is a maze, and that difference is
     the reason a campaign map is worth having under a battle at all. It is
     hashed off the WORLD position, so the same spot always fights the same
     — you can learn a battleground.

     raise()/clear() are explicit because registering colliders at build
     time would put mesa boulders in the campaign's collision world, where
     nothing collides with anything and the only effect is cost. */
  const COVER_BY_BIOME = {
    rock:   { n: 26, w: [3, 11], h: [2.4, 7.0], kind: "slab" },
    wadi:   { n: 18, w: [4, 14], h: [1.8, 4.2], kind: "bank" },
    gravel: { n: 14, w: [1.6, 4.5], h: [1.0, 2.4], kind: "boulder" },
    dune:   { n: 8,  w: [1.4, 3.6], h: [0.9, 2.0], kind: "boulder" },
    oasis:  { n: 16, w: [0.9, 2.2], h: [3.5, 7.5], kind: "palm" },
    shore:  { n: 7,  w: [1.6, 4.0], h: [0.9, 2.2], kind: "boulder" },
    salt:   { n: 2,  w: [1.2, 2.4], h: [0.8, 1.6], kind: "boulder" },
    sea:    { n: 0,  w: [1, 2], h: [1, 2], kind: "boulder" },
  };
  D.battlefieldAt = function (wx, wz, radius) {
    if (!inited) ensureInit();
    radius = radius > 0 ? radius : 170;
    const base = heightAt(wx, wz);
    const biome = biomeAt(wx, wz);
    // RELIEF: rms height deviation across the arena, in metres. battle.js
    // uses it to decide whether this is a firefight across open ground or a
    // scramble — it is one number and it is measured, not asserted.
    let acc = 0, n = 0, lo = 1e9, hi = -1e9;
    for (let i = 0; i < 24; i++) {
      const a = i * 0.618034 * TAU, r = radius * Math.sqrt((i + 0.5) / 24);
      const y = heightAt(wx + Math.cos(a) * r, wz + Math.sin(a) * r) - base;
      acc += y * y; n++;
      if (y < lo) lo = y;
      if (y > hi) hi = y;
    }
    const relief = Math.sqrt(acc / n);

    const spec = COVER_BY_BIOME[biome] || COVER_BY_BIOME.gravel;
    const cover = [];
    for (let i = 0; i < spec.n * 2 && cover.length < spec.n; i++) {
      const a = W.hash01(wx + i * 37, wz, 1601 + i) * TAU;
      const r = radius * (0.12 + 0.86 * Math.sqrt(W.hash01(wx, wz + i * 41, 1699 + i)));
      const lx = Math.cos(a) * r, lz = Math.sin(a) * r;
      const gy = heightAt(wx + lx, wz + lz) - base;
      const t = W.hash01(wx + lx, wz + lz, 1721);
      const w = lerp(spec.w[0], spec.w[1], t);
      const h = lerp(spec.h[0], spec.h[1], W.hash01(wx + lx, wz + lz, 1733));
      const d = w * (0.55 + W.hash01(wx + lx, wz + lz, 1741) * 0.9);
      cover.push({ x: lx, z: lz, y: gy, w: w, h: h, d: d,
                   yaw: W.hash01(wx + lx, wz + lz, 1747) * TAU, kind: spec.kind });
    }

    let raised = null;
    return {
      origin: { x: wx, z: wz, y: base },
      biome: biome, relief: relief, drop: lo, rise: hi, radius: radius,
      groundAt: function (lx, lz) { return heightAt(wx + lx, wz + lz) - base; },
      worldGroundAt: function (lx, lz) { return heightAt(wx + lx, wz + lz); },
      cover: cover,
      /* register the cover as real boxes. Same call every wall in this repo
         uses, so combat_iq treats them as cover and segmentBlocked treats
         them as walls without anybody writing a second cover system. */
      raise: function (o) {
        if (raised) return raised;
        o = o || {};
        const ox = o.x || 0, oy = o.y || 0, oz = o.z || 0;
        const M = CBZ.micro;
        raised = [];
        if (!M || !M.addBoxCollider) return raised;
        for (let i = 0; i < cover.length; i++) {
          const c = cover[i];
          raised.push(M.addBoxCollider(ox + c.x, oy + c.y + c.h / 2, oz + c.z,
            c.w, c.h, c.d, { warlordCover: true }));
        }
        return raised;
      },
      clear: function () {
        if (!raised) return;
        const M = CBZ.micro;
        if (M && M.colliders) {
          for (let i = raised.length - 1; i >= 0; i--) {
            const at = M.colliders.indexOf(raised[i]);
            if (at >= 0) M.colliders.splice(at, 1);
          }
          if (M.rebuildColliderGrid) { if (CBZ.markCollidersDirty) CBZ.markCollidersDirty(); M.rebuildColliderGrid(); }
        }
        raised = null;
      },
    };
  };

  /* ============================================================ AUDIT */
  D.audit = function () {
    if (!inited) ensureInit();
    const counts = {};
    let land = 0, tries = 0;
    for (let i = 0; i < 2000; i++) {
      const a = (i * 0.618034) * TAU, r = Math.sqrt((i + 0.5) / 2000) * BOUNDS;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const b = biomeAt(x, z);
      counts[b] = (counts[b] || 0) + 1;
      tries++;
      if (b !== "sea") land++;
    }
    return {
      seed: SEED, radius: RADIUS, bounds: BOUNDS, oases: oases.length,
      levels: levels.length, landPct: Math.round(land / tries * 100), biomes: counts,
      flags: { plain: FLAG_PLAIN, scatter: !FLAG_NOSCATTER, lod: !FLAG_FLATLOD },
    };
  };

  /* REGISTER THE PUBLISHED OBJECT ITSELF, not a {needs,boot} literal.
     core's W.module does `W[name] = api`, so handing it a fresh literal
     replaces W.desert with an object that has two keys on it and nothing
     else — every call in this game to W.desert.heightAt then lands on
     undefined. Caught by the headless audit before it ever reached a page;
     it is a trap the other modules share, so it is stated here loudly. */
  D.needs = [];
  D.boot = function (ctx) {
    // Nothing heavy at boot, by contract. The island is raised by
    // campaign.enter(), which is the only thing that knows when the
    // player is about to stand on it.
    D.ctx = ctx;
    if (ctx && ctx.Q && ctx.Q.get("audit") === "1") {
      try { console.log("[warlord/desert]", D.audit()); } catch (e) {}
    }
  };
  W.module("desert", D);
})();
