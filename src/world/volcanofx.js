/* ============================================================
   world/volcanofx.js — THE VOLCANO'S SURFACES, keyed on a position
   and a HEIGHT FIELD, so the same four builders serve the survival
   island today and a city-side eruption tomorrow.

   OWNER, 2026-08-03: "lava in current game is dumb and see thru".
   He is right, and the reason is one line: the old streams were
   MeshBasicMaterial + AdditiveBlending + opacity 0.95 boxes. Additive
   blending CANNOT be opaque — it only ever ADDS to whatever is behind
   it, so the grass showed through the lava and the lava showed through
   itself where two boxes crossed. Nothing tuned on that material was
   ever going to look like rock.

   SO THE PHYSICS DECIDES THE MATERIAL. A basaltic flow is a RIVER OF
   ROCK WITH A LID: the surface chills against the air within seconds
   into an opaque black-brown crust, and what you actually see glowing
   is the incandescent interior showing through cracks and through the
   open central channel. That is two meshes, and neither of them is
   transparent:

     CRUST    MeshPhongMaterial (shininess 0 — Lambert's look; r128's
              Lambert cannot flat-shade), vertexColors, flatShading,
              OPAQUE. Dark basalt at the levees, scorched red-brown at
              the margins. It is LIT, so it takes the scene's sun and
              reads as ground, and it THICKENS with age (the levees
              build up and the flow stands proud of the grass).
     MELT     MeshBasicMaterial, vertexColors, OPAQUE. Unlit on
              purpose — an unlit material IS incandescence: it ignores
              the sun, so at night it stays exactly as bright as it was
              at noon, which is what self-luminous rock does. White-
              yellow (1150 C) at the vent, cooling through orange to a
              deep dull red at the toe.

   OWNER AGAIN, 2026-08-13: "the magma has black on it and doesn't flow
   like magma, it just glitches down weirdly and zig zaggy". Three
   separate defects wearing one coat, and all three are answered inside
   V.lavaFlow with their own long note at the point of repair:

     BLACK    the melt was a narrow SECOND MESH — under a quarter of the
              ribbon — so the flow was mostly crust. It is now a FIELD
              over the same footprint, and the field's time term advects
              downstream, which is also what makes it look alive.
     GLITCHES the drawn front was quantised to whole stations and jumped
              a segment at a time. The leading ring is now planted at the
              exact live length.
     ZIG-ZAG  fallLine steers by a seven-way probe re-decided every step
              and saw-tooths on faceted ground; smoothPath() gives the
              momentum back, and each vertex now stands on the ground
              under itself instead of the one under the centreline.

   OWNER, 2026-08-15, sending two photographs — Fuego erupting at night
   and an Etna flow field at close range — "use these as, like, a bible...
   don't make it look geometric". The bible says three things the previous
   build did not do, and each got its own repair at its own site:

     LACE     the close-up is not bright plates on darkness, it is a DARK
              crust with a bright connected crack network through it. It is
              drawn as a TILED TEXTURE on the melt (laceTex): a ridge
              transform of three sines, filaments on the zero-crossings,
              plates between them, sampled per fragment and advected by
              sliding the uvs downstream. It lived in the vertex colours
              until 2026-09-01, where the station grid averaged it away —
              see the long note at laceTex().
     THE FAN  a flow FORKS. lavaFlow({branches:n}) arms fork points that
              spawn narrower child flows when the front reaches them, so
              a run ends in a fan of noses instead of one ruled ribbon.
              The outline is lobed (slow waves, not per-station noise) and
              the incandescent channel meanders between its own banks.
     THE VENT the crater is the brightest thing in the frame: ventGlow()
              is an opaque unlit spatter apron draped over the summit —
              white throat, orange shoulder, dark rim, hash-lobed
              coastline — replacing an additive disc that was see-through
              AND a perfect circle, the two forbidden words at once.

   The only TRANSPARENT thing in a lava flow here is the heat haze
   ABOVE it — additive sprites, never the flow itself — plus one or two
   pooled PointLights so the thing actually illuminates the hillside at
   night (core/lightpin.js budgets and pins the count, so this is safe).

   THE THREE KILL MODES ARE MODELLED AS WHAT THEY PHYSICALLY ARE:

     pyroclastic()  a ground-hugging density current: pulverised rock
                    and 400 C gas rolling DOWN the fall line far faster
                    than anything can run. Boiling, opaque, overlapping
                    billows with an incandescent basal fringe. Inside
                    the lane there is no survival mechanic — evacuation
                    is the mechanic.
     lahar()        wet concrete: a matte, chunky, boulder-carrying mud
                    river that seeks the valley instead of the fall
                    line, moves at river speed, drags what it catches,
                    and HARDENS in place into a permanent scar.
     ashLoad()      accumulation, not weather. A grid of quads whose
                    COVERAGE grows with the ash that has actually
                    landed on that cell — so the blanket creeps
                    downwind, and roofs carry a load a caller can read
                    back and price through the structural ledger.

   ALL FOUR TAKE THE SAME TWO ARGUMENTS and nothing about a game mode:
   `groundAt(x, z)` and `parent` (an Object3D). Hand them the arena's
   groundHeightAt + arena.root, or CBZ.floorAt + CBZ.scene, and they do
   not know or care which world they are in.

   Adoption is one line each (THE BLOCK LAW):
     const f = CBZ.volcanoFx.lavaFlow({ x, z, groundAt, parent, bearing });
     f.update(dt);  f.hitTest(px, pz);  f.dispose();

   Degrade-safe: every entry point returns a handle with the same shape
   (update/dispose/hitTest are always callable), so a caller never has
   to null-check anything but `CBZ.volcanoFx` itself.

   Determinism: shape jitter is CBZ.hash01 off world position, so the
   same vent carves the same channel on every client. Per-frame flicker
   is runtime-only FX and uses Math.random, which the doctrine allows.

   Flags: VOLCANO_V2 (the opaque crust+channel lava; false = the caller
   keeps its legacy visual) · VOLCANO_PYRO · VOLCANO_LAHAR ·
   VOLCANO_ASH_LOAD. Ratchet: CBZ.volcanoAudit().
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  CBZ.CONFIG = CBZ.CONFIG || {};

  // Each is a genuine one-line revert of one hazard.
  if (CBZ.CONFIG.VOLCANO_V2 == null) CBZ.CONFIG.VOLCANO_V2 = true;
  if (CBZ.CONFIG.VOLCANO_PYRO == null) CBZ.CONFIG.VOLCANO_PYRO = true;
  if (CBZ.CONFIG.VOLCANO_LAHAR == null) CBZ.CONFIG.VOLCANO_LAHAR = true;
  /* VOLCANO_V3 (2026-08-23): the eruption gets its SKY back. One flag, three
     repairs, all in the caller (systems/disasters.js) plus the two builder
     options below (`fogless` on the column, `lobe` on the ash fall):
       COLUMN   the eruption column is the most dramatic silhouette in nature
                and ours was 60 m — barely twice the mountain, and the murk's
                linear fog ate its head. V3 stands it ~180 m over a 26 m peak
                and exempts its soot from scene fog (the nukefx precedent:
                the landmark must not dissolve in its own weather).
       ASH      the wedge, not the blanket — see the note below.
       DARK     ash blots the sun: as the deposit builds, the eruption's env
                walks toward darkness-at-noon instead of holding a fixed tint.
     False is the one-line revert to the 2026-08-16 build. */
  if (CBZ.CONFIG.VOLCANO_V3 == null) CBZ.CONFIG.VOLCANO_V3 = true;
  /* ASH IS BACK ON, because what was OFF was never the ledger — it was the
     BLANKET. The 2026-08-16 owner note ("the ash covering the map is not
     needed... the ash covers everything in a dumb way, idc if it's
     realistic") describes exactly what the caller was asking this field to
     do: `spread: 0.16` put a sixth of the axis rate on EVERY cell of the
     island, so the whole map greyed over at once and the deposit read as a
     screen filter, not a place. That is a parameter bug, not a reason to
     delete the one hazard that reaches everyone — and deleting it also
     deleted the roof-load collapses and the whole indoors-saves-you-until-
     the-roof-goes tension, which nobody complained about.
     V3 fixes the parameter: the fall is a DOWNWIND WEDGE (spread ~0.05,
     lobe exponent up), so the upwind half of the island keeps its own
     colour for the whole event and the grey is somewhere you can point at,
     walk out of, and watch roofs fail under. ?cfg_VOLCANO_ASH_LOAD=0 still
     kills the whole ledger on its own; with V3 off the old default-off
     stands, so the 2026-08-16 build is fully recoverable. */
  if (CBZ.CONFIG.VOLCANO_ASH_LOAD == null) CBZ.CONFIG.VOLCANO_ASH_LOAD = CBZ.CONFIG.VOLCANO_V3 !== false;

  const V = {};
  // live census for CBZ.volcanoAudit() — measured, never counted in source
  const census = { lava: 0, pyro: 0, lahar: 0, ash: 0, lights: 0, tris: 0, branches: 0, vent: 0, fountain: 0 };
  const LIVE = { lava: [], pyro: [], lahar: [], ash: [], vent: [], column: [], fountain: [] };

  function h01(x, z, salt) { return CBZ.hash01 ? CBZ.hash01(x, z, salt | 0) : 0.5; }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function q(lo, hi) { return CBZ.qScale ? CBZ.qScale(lo, hi) : hi; }
  function qi(lo, hi) { return Math.max(1, Math.round(q(lo, hi))); }
  const _c1 = new THREE.Color(), _c2 = new THREE.Color(), _c3 = new THREE.Color();

  // hex ramp: three stops, t in 0..1
  function ramp3(t, a, b, c, out) {
    t = clamp(t, 0, 1);
    if (t < 0.5) { _c1.setHex(a); _c2.setHex(b); return out.copy(_c1).lerp(_c2, t * 2); }
    _c1.setHex(b); _c2.setHex(c); return out.copy(_c1).lerp(_c2, (t - 0.5) * 2);
  }

  function flatGround() { return 0; }

  /* ---- ONE SOFT RADIAL TEXTURE for every additive glow in this file.
     Built once, shared by heat haze and by the pyroclastic front's dust,
     so the whole volcano costs exactly one texture upload. ---- */
  /* ---- THE ASH PATCH SHAPE, AS AN ALPHA CUTOUT. -----------------------
     OWNER, 2026-08-13: "floating flat gray squares all around". They floated
     because the quads were horizontal (fixed at the writer), and they were
     SQUARES because a four-vertex quad has four straight edges and nothing
     was hiding them. Below full coverage the patches do not touch, so a light
     dusting rendered as a few thousand rotated tiles lying on the grass.

     A deposit's boundary is eroded, not ruled. This is a white texture whose
     ALPHA is a lumpy blob, cut out with alphaTest — so the patch keeps a hard
     opaque edge (no blending, no sorting, no double-darkening across five
     thousand overlapping quads) but that edge is an irregular coastline
     instead of a straight line. Same geometry, same one draw call; the square
     simply stops being a square.
     -------------------------------------------------------------------- */
  let _ashTex = null;
  function ashTex() {
    if (_ashTex) return _ashTex;
    const S = 64, cv = document.createElement("canvas");
    cv.width = cv.height = S;
    const g = cv.getContext("2d");
    let seed = 0x6151a3d7 >>> 0;
    const rnd = function () { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    const lobe = function (lx, ly, r) {
      const rg = g.createRadialGradient(lx, ly, r * 0.45, lx, ly, r);
      rg.addColorStop(0, "rgba(255,255,255,1)");
      rg.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = rg;
      g.beginPath(); g.arc(lx, ly, r, 0, 6.2832); g.fill();
    };
    lobe(S * 0.5, S * 0.5, S * 0.34);
    for (let i = 0; i < 14; i++) {
      const a = rnd() * 6.2832, d = S * (0.12 + rnd() * 0.24);
      lobe(S * 0.5 + Math.cos(a) * d, S * 0.5 + Math.sin(a) * d, S * (0.09 + rnd() * 0.13));
    }
    _ashTex = new THREE.CanvasTexture(cv);
    return _ashTex;
  }

  let _glowTex = null;
  function glowTex() {
    if (_glowTex) return _glowTex;
    const S = 64, cv = document.createElement("canvas");
    cv.width = cv.height = S;
    const g = cv.getContext("2d");
    const rg = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    rg.addColorStop(0, "rgba(255,255,255,1)");
    rg.addColorStop(0.35, "rgba(255,222,170,0.62)");
    rg.addColorStop(1, "rgba(255,180,110,0)");
    g.fillStyle = rg; g.fillRect(0, 0, S, S);
    _glowTex = new THREE.CanvasTexture(cv);
    return _glowTex;
  }

  /* ============================================================
     THE FALL LINE — the one piece of terrain reasoning the whole
     file shares, and the reason a hazard READS as obeying the
     mountain instead of being drawn on top of it.

     Water, lava, ash-avalanches and mud all go the same way: the
     steepest way down. So this walks the height field, probing a fan
     of headings each step and steering toward the lowest one, with a
     turn rate that is the ONE difference between the hazards:

       lava / pyroclastic   turn 0.45 — momentum-carrying, they run
                            fairly straight down the cone's face
       lahar (channel:true) turn 0.8  — water-like, it hunts the
                            valley and will follow it around a bend

     Returns { pts:[{x,z,y}], seg (m), total (m) } — pts[0] is the vent.
     ============================================================ */
  function fallLine(o) {
    o = o || {};
    const groundAt = o.groundAt || flatGround;
    const step = o.step > 0 ? +o.step : 3;
    const count = Math.max(2, Math.round(o.count || 24));
    const turn = o.channel ? 0.8 : (o.turn != null ? +o.turn : 0.45);
    const wander = o.wander != null ? +o.wander : 0.16;
    const salt = o.salt | 0;
    const probe = step * 1.15;
    let x = +o.x || 0, z = +o.z || 0;
    let b = o.bearing;
    if (b == null) {
      // no bearing given: pick the steepest descent over the full circle
      let bestH = 1e9;
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        const hh = groundAt(x + Math.cos(a) * probe, z + Math.sin(a) * probe);
        if (hh < bestH) { bestH = hh; b = a; }
      }
      if (b == null) b = 0;
    }
    const pts = [{ x: x, z: z, y: groundAt(x, z) }];
    for (let i = 1; i < count; i++) {
      // fan of candidate headings inside +-52 degrees of the current one.
      // THE TIE-BREAK IS LOAD-BEARING: on FLAT ground every probe returns the
      // same height, and a first-wins scan then turns hard to one side every
      // step and spirals the flow into a snail shell. The epsilon penalty on
      // |k| makes "straight on" win any tie, so a flow that reaches the plain
      // simply runs out in the direction it arrived.
      let best = b, bestH = 1e9;
      for (let k = -3; k <= 3; k++) {
        const a = b + (k / 3) * 0.91;
        const hh = groundAt(x + Math.cos(a) * probe, z + Math.sin(a) * probe)
          + Math.abs(k) * 1e-4;
        if (hh < bestH) { bestH = hh; best = a; }
      }
      // steer, then a hash-stable wobble so two flows off the same peak
      // are different rivers and not two copies of one ruler
      let d = best - b;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      b += d * turn + (h01(x, z, salt + i) - 0.5) * wander;
      x += Math.cos(b) * step;
      z += Math.sin(b) * step;
      pts.push({ x: x, z: z, y: groundAt(x, z) });
    }
    return { pts: pts, seg: step, total: step * (count - 1) };
  }
  V.fallLine = fallLine;

  /* ---- SMOOTH THE WALK -------------------------------------------------
     OWNER, 2026-08-13: the magma "doesn't flow like magma, it just glitches
     down weirdly and zig zaggy".

     Half of that is right here. fallLine steers by probing a fan of seven
     headings against the height field and taking the lowest — a decision
     that is QUANTISED to seven directions and re-taken from scratch every
     step. On a faceted low-poly cone the winner alternates between two
     neighbouring probes step after step, and the walk saw-tooths: a
     ruler-straight zig, then a zag, then a zig. Nothing downstream can hide
     it, because the ribbon is built ON these points.

     A fluid has momentum and cannot corner like that, so the walk gets it
     back afterwards: two passes of a [1 2 1] filter on x/z, endpoints
     pinned (the vent must not move), then every point re-seated on the
     ground it now sits over. The line still goes where the mountain sends
     it — it just stops changing its mind twice a metre.

     Arc length shrinks a percent or two under the filter. That is fine and
     deliberately not corrected: pathAt() and pathCoord() BOTH address the
     polyline as `index * seg`, so they stay consistent with each other, and
     a flow whose front is 2% slower than its nominal speed is a flow.
     ---------------------------------------------------------------------- */
  function smoothPath(path, passes, groundAt) {
    const P = path.pts;
    if (!P || P.length < 3) return path;
    for (let k = 0; k < (passes || 1); k++) {
      let px = P[0].x, pz = P[0].z;               // the pre-filter neighbour
      for (let i = 1; i < P.length - 1; i++) {
        const cx = P[i].x, cz = P[i].z;
        P[i].x = cx * 0.5 + (px + P[i + 1].x) * 0.25;
        P[i].z = cz * 0.5 + (pz + P[i + 1].z) * 0.25;
        px = cx; pz = cz;
      }
    }
    for (let i = 0; i < P.length; i++) P[i].y = groundAt(P[i].x, P[i].z);
    return path;
  }
  V.smoothPath = smoothPath;

  // arc-length sample of a fall line at distance s (metres from the vent)
  function pathAt(path, s, out) {
    const P = path.pts, seg = path.seg;
    if (s <= 0) { out.set(P[0].x, P[0].y, P[0].z); return out; }
    const fi = s / seg, i = Math.floor(fi);
    if (i >= P.length - 1) { const p = P[P.length - 1]; out.set(p.x, p.y, p.z); return out; }
    const t = fi - i, a = P[i], b2 = P[i + 1];
    out.set(a.x + (b2.x - a.x) * t, a.y + (b2.y - a.y) * t, a.z + (b2.z - a.z) * t);
    return out;
  }
  V.pathAt = pathAt;

  // signed along/perp coordinates of (x,z) against the polyline, live length only
  function pathCoord(path, x, z, liveLen) {
    const P = path.pts, seg = path.seg;
    const nMax = Math.min(P.length - 1, Math.max(1, Math.ceil((liveLen == null ? 1e9 : liveLen) / seg)));
    let bestPerp = 1e9, bestS = -1;
    for (let i = 0; i < nMax; i++) {
      const a = P[i], b2 = P[i + 1];
      const dx = b2.x - a.x, dz = b2.z - a.z;
      const L2 = dx * dx + dz * dz || 1;
      let t = ((x - a.x) * dx + (z - a.z) * dz) / L2;
      t = clamp(t, 0, 1);
      const px = a.x + dx * t, pz = a.z + dz * t;
      const perp = Math.hypot(x - px, z - pz);
      if (perp < bestPerp) { bestPerp = perp; bestS = (i + t) * seg; }
    }
    return { s: bestS, perp: bestPerp };
  }
  V.pathCoord = pathCoord;

  /* ============================================================
     LAVA FLOW — a molten river under a chilling lid.

     OWNER, 2026-08-13: "the magma has black on it and doesn't flow like
     magma". Both halves were true of the first build and both had one
     cause: the incandescence was GEOMETRY.

     The channel was its own narrow mesh, 16-50% of the flow's HALF width —
     8 to 25% of the ribbon — so seven eighths of every flow was the dark
     basalt crust and the thing read as a black snake with an orange pin
     stripe down it. And because the melt was a shape rather than a state,
     nothing about it could move: the crust could only cool, so a flow that
     had finished growing was a painted rock.

     So the melt stopped being a mesh and became a FIELD. Both meshes now
     share one footprint and one set of columns; what decides whether a
     given square metre is glowing rock or chilled lid is a smooth function
     of (distance down the flow, distance across it, TIME) — and the time
     term advects downstream at the surface velocity. Plates of cooled crust
     ride down the channel, tear open, and let the melt through, which is
     what a basaltic channel actually does and what "flowing" looks like at
     any frame rate. It costs three sines a vertex and no geometry at all.

       CRUST   MeshPhongMaterial (shininess 0, flatShading) — LIT, opaque,
               full width. It is the levees, the thickness, and the only
               part of the flow that answers to the sun.
       MELT    MeshBasicMaterial — UNLIT (= incandescent), opaque, inset to
               0.82 so the lit levees show along both banks. Its vertex
               colours carry the whole story: molten where the lid has torn,
               dark where it has welded, white-yellow at the vent, dull red
               at the toe.
     ============================================================ */
  /* THE GRID HAS TO BE FINE ENOUGH TO HOLD THE PATTERN, and the first cut of
     the lid field was not: at one station every ~5 m the along-flow term
     advanced 2.2 radians a step, so a wave meant to draw crust plates was
     sampled three times a cycle and linear interpolation smeared what was
     left into a gradient. The flow came out a smooth glowing tube — the
     owner's black ribbon swapped for a neon one, with no more structure than
     it had before. Nine columns and a station every ~2.2 m give roughly seven
     samples per plate, which is the point at which the plates exist. */
  const LAVA_COLS = 9;              // columns across a broad flow
  /* THE SECOND COLUMN SITS ON THE LEVEE, not halfway down the skirt. The
     crust's crown now rolls to the ground at |u| = 1 with a levee ridge bumped
     up at 0.87 (see ring()) — and a ridge nothing samples is not drawn, it is
     just a linear ramp between the vertices either side of it. Moving 0.78 to
     0.87 costs nothing and is the difference between a channel with banks and
     a sheet with a bevel. */
  const LAVA_U = [-1, -0.87, -0.55, -0.3, 0, 0.3, 0.55, 0.87, 1];
  /* A THREAD DOES NOT NEED NINE COLUMNS. Once the flows narrowed to match the
     reference photograph, nine columns over two metres of width was a vertex
     every twenty centimetres — detail no camera can resolve, on nine times as
     many flows. Narrow flows take the five-column table; the grid across the
     ribbon only has to carry the channel's meander, and the plates ride along
     the LENGTH, where the resolution still matters. */
  const LAVA_COLS_N = 5;
  const LAVA_U_N = [-1, -0.55, 0, 0.55, 1];
  const MELT_INSET = 0.82;          // the lit crust shows outboard of this
  /* ============ THE PALETTE IS AUTHORED IN *LINEAR* LIGHT ==============
     2026-09-01: the shipped flow photographed as a smooth PALE GOLD PLASTIC
     RAMP — no dark crust anywhere, no lace, ruler-straight banks. Half of
     that was one number nobody had ever computed: WHAT THESE HEXES ACTUALLY
     BECOME ON SCREEN. r128's Color.setHex does no colour conversion, so a
     vertex colour is a LINEAR value; core/renderer.js then runs ACES +
     the RENDER_GRADE_V1 contrast/sat/lift grade at exposure 1.16 and encodes
     to sRGB. That chain LIFTS enormously. Measured, stop by stop:

         authored      on screen            what it read as
         0xff9226  ->  rgb(252,222,141)     pale gold          (was MELT_C)
         0xc73e03  ->  rgb(254,169,0)       bright orange      (was MELT_B)
         0x241d19  ->  rgb(123,105,95)      MID GREY           (was the lid!)
         0x2a2320  ->  rgb(135,119,113)     mid grey           (was CRUST_A)

     A "dark basalt" authored as 0x241d19 arrives as mid grey; every crust
     stop in the file was a light stop wearing a dark hex. So the whole
     palette is re-authored against the measured transform instead of against
     the swatch, and every stop below carries the screen colour it MEASURES
     to. If the tone map or the exposure ever moves, these move with it —
     re-measure, do not eyeball. (Deriving them is ~30 lines: linear -> ACES
     -> the grade in installToneMap() -> sRGB encode.)
     ===================================================================== */
  // LIT crust (Phong, so multiply by irradiance — the eruption sun is
  // 0.5 x 0xd9714a and the hemi 0x9c7461, ~(0.62,0.40,0.30) on an up-face).
  // A: the levee lip, genuine black basalt.  B: the levee body.  C: the
  // scorched inboard rock that only shows at the nose and the melt's banks.
  //   A -> rgb(38,22,22)   B -> rgb(61,36,30)   C -> rgb(126,54,28)  (lit)
  const CRUST_A = 0x0e0a06, CRUST_B = 0x181310, CRUST_C = 0x3e2013;
  // the UNLIT lid over the melt: dark rock (D) warming to ember-heated rock
  // beside a crack (W).   D -> rgb(32,26,25)    W -> rgb(111,47,27)
  const _LID_D = new THREE.Color(0x070503), _LID_W = new THREE.Color(0x200b05);
  /* THE MELT RAMP, and it is a TEMPERATURE ramp now, not a brightness ramp:
       A  the dull red of a cooling toe / a dying seam   rgb(143,23,2)
       B  the open channel while it is moving            rgb(219,64,0)
       C  the incandescent lace and the vent apron       rgb(255,180,66)
     C is as far as this ramp goes on purpose: the white-yellow throat is
     ventGlow's, and a melt that reaches white is the pale-gold slab again. */
  const MELT_A = 0x300701, MELT_B = 0x6a1004, MELT_C = 0xd8480f;

  /* THE LID, as a smooth field that TRAVELS.

     CBZ.hash01 is a hash, not a noise: sampled along a line it is white
     static, so plates cannot be built from it. Three incommensurate sines
     in (along, across) give a smooth, non-repeating field for the price of
     three sin() a vertex — and shifting their common phase is what makes
     the whole pattern slide downstream. `ph` IS the flow.

     OWNER, 2026-08-15, with two reference photographs (Fuego by night, an
     Etna flow field close up): "use these as a bible... don't make it look
     geometric". The photographed close-up settles what the pattern IS, and
     the previous field had it inverted. A flow field is not bright plates
     drifting on darkness — it is a DARK crusted surface with a bright
     anastomosing LACE cracked through it: thin connected filaments of melt
     wrapping irregular black islands. Bands of any kind read as geometry;
     a connected irregular network reads as rock coming apart.

     A ridge transform gets exactly that from the same three sines. The sum
     is a smooth signed field; its ZERO-CROSSINGS are guaranteed-connected
     wandering curves, so `1 - |f|` lights precisely those curves and leaves
     everything away from them as lid. A slow warp term bends the whole
     lattice so no filament runs straight for long — the "zig-zaggy"
     complaint was cured upstream in the walk, and it must not sneak back in
     through the pattern. */

  /* ============ THE LACE IS A TEXTURE, NOT A VERTEX COLOUR ==============
     Everything above computes a beautiful anastomosing network and the
     rasteriser was throwing most of it away. Do the arithmetic: the flows
     these beats photograph are ~17 m long by ~9 m wide, they are drawn on a
     station every ~2.4 m by nine columns, and a filament is 3-4 m across.
     That is barely one vertex per filament, and Gouraud interpolation across
     a 1.1 m x 2.4 m quad is a low-pass filter — measured on the shipped
     numbers, a field that is 15% dark plate at full resolution comes out 2%
     dark once it has been through the vertex grid. The lace could not be
     seen because it was being averaged out before it was drawn.

     Making the grid fine enough is the wrong answer (four times the vertices,
     rewritten at 30 Hz, to draw something that does not move relative to the
     rock). The right one is to stop asking the geometry to carry it: the lace
     goes into ONE tiled texture, sampled per FRAGMENT, and the mesh carries
     only the smooth things — how hot this stretch is, how far across the
     channel this vertex sits. Vertex colours and the map MULTIPLY in r128's
     MeshBasicMaterial, so the texel is authored as a RATIO against MELT_C:
     1.0 on a filament, and walking down through the channel stop to the dark
     lid in the plate interiors. A cooler stretch of flow has a cooler vertex
     colour and the same texel then paints a cooler network — which is what a
     real flow does, and it costs nothing.

     It is also FASTER than what it replaces: ring() no longer evaluates five
     sines a vertex a frame, and pays two uv floats instead.

     TILES IN Y, and it has to: uv.y is (metres down the flow - metres the
     lid has advected) / LACE_L, which runs off both ends. So every along-flow
     frequency here is an integer number of cycles per LACE_L. Across, uv.x is
     0.5 + metres/LACE_W and LACE_W is wide enough (20 m) that the widest
     flood never reaches an edge — a pattern that repeated across the ribbon
     would be a lattice, which is the one thing the bible forbids.
     ===================================================================== */
  const LACE_W = 20, LACE_L = 24;       // metres the texture spans
  let _laceTex = null;
  function laceTex() {
    if (_laceTex) return _laceTex;
    /* 512, not 256: at 256 the texture carries 10.7 px per metre, and a
       player being chased by this thing gets a lot closer than the 20-60 m
       the storyboard frames it at — the crack edges went soft under
       magnification. 21 px/m holds up to about four metres away, and the
       whole thing is built ONCE, lazily, on the first eruption (~30 ms with
       the ramp precomputed below; per-pixel Color.lerp made it three times
       that). */
    const S = 512, cv = document.createElement("canvas");
    cv.width = cv.height = S;
    const g = cv.getContext("2d");
    const img = g.createImageData(S, S);
    const D = img.data;
    // the ramp the texel walks, as ratios against MELT_C (the vertex colour's
    // top stop) — so texel x vColour reproduces the ramp exactly at the vent
    const top = new THREE.Color(MELT_C);
    const stops = [new THREE.Color(_LID_D), new THREE.Color(_LID_W), new THREE.Color(MELT_B), top];
    const KY = 6.2831853 / LACE_L, KX = 6.2831853 / LACE_W;
    /* the ramp as a 256-entry lookup, so the pixel loop is four sines and
       three array reads instead of four sines and a Color allocation dance.
       The two breakpoints are read off the field's own measured distribution
       (p25 = 0.11, p50 = 0.44, p75 = 0.74), so they are AREA FRACTIONS, not
       guesses: ~33% dark plate, ~28% warm rock beside a crack, ~39%
       incandescent — and only the top few per cent reaches MELT_C. */
    const LUT = new Uint8Array(256 * 3);
    for (let q = 0; q < 256; q++) {
      const t = q / 255;
      const seg3 = t < 0.22 ? 0 : (t < 0.55 ? 1 : 2);
      const k3 = seg3 === 0 ? t / 0.22 : (seg3 === 1 ? (t - 0.22) / 0.33 : (t - 0.55) / 0.45);
      _c3.copy(stops[seg3]).lerp(stops[seg3 + 1], clamp(k3, 0, 1));
      LUT[q * 3] = Math.round(255 * clamp(_c3.r / top.r, 0, 1));
      LUT[q * 3 + 1] = Math.round(255 * clamp(_c3.g / top.g, 0, 1));
      LUT[q * 3 + 2] = Math.round(255 * clamp(_c3.b / top.b, 0, 1));
    }
    for (let py = 0; py < S; py++) {
      const sm = (py / S) * LACE_L;              // metres along
      for (let pxi = 0; pxi < S; pxi++) {
        const vm = (pxi / S - 0.5) * LACE_W;     // metres across
        const a = sm * KY, b = vm * KX;
        /* Four sines, along-flow periods 8 / 4.8 / 12 / 3.4 m and across-flow
           8 / 11 / 4.7 / 3.7 m: plates four to seven metres, filaments one to
           two. The first cut ran everything at 3-5 m and photographed as
           STATIC — a plate has to be several times a filament's width or the
           eye reads noise instead of rock. The coefficients are CYCLES PER
           LACE_L, which is what makes the tile seamless in y: measured, the
           two edges agree to 0.00000. */
        /* AND THE WARP IS MOST OF THE WORK. With the phase warp at 1.1 the
           first print of this came out as a LATTICE of near-identical black
           ovals — a leopard skin, which is geometry wearing a texture. A
           three-term warp bending the phase by up to ~2.5 rad, applied to
           three of the four terms, is what turns the grid into a branching
           network with islands of every size, and the fourth high-frequency
           term roughens the filament edges so they are not drawn with a pen. */
        const w = Math.sin(a * 1 + b * 0.9) + 0.62 * Math.sin(a * 2 - b * 1.6 + 2.1)
                + 0.35 * Math.sin(a * 3 + b * 2.9 + 0.6);
        const f =
          0.50 * Math.sin(a * 3 + b * 2.5 + 1.9 * w) +
          0.30 * Math.sin(a * 5 - b * 1.8 + 1.7 + 1.3 * w) +
          0.14 * Math.sin(a * 2 + b * 4.3 + 4.1 + 0.8 * w) +
          0.10 * Math.sin(a * 7 - b * 5.4 + 0.7);
        /* RIDGE: 1 on the zero-crossing curves, 0 deep inside a plate. The
           zero-crossings of a smooth signed field are guaranteed-CONNECTED
           wandering curves, which is the whole reason the lace anastomoses
           instead of speckling. */
        const q = (clamp(1 - Math.abs(f) * 1.6, 0, 1) * 255) | 0;
        const o = (py * S + pxi) * 4, q3 = q * 3;
        D[o] = LUT[q3]; D[o + 1] = LUT[q3 + 1]; D[o + 2] = LUT[q3 + 2]; D[o + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    const tx = new THREE.CanvasTexture(cv);
    // LINEAR encoding on purpose: this is a MULTIPLIER, not a colour, and
    // r128's mapTexelToLinear would gamma-decode it if we said sRGB.
    tx.wrapS = tx.wrapT = THREE.RepeatWrapping;
    tx.minFilter = THREE.LinearMipmapLinearFilter;
    tx.magFilter = THREE.LinearFilter;
    tx.generateMipmaps = true;
    // the flow is nearly always seen at a grazing angle down a cone, which is
    // exactly the case trilinear filtering blurs into mush
    const rn = CBZ.renderer;
    if (rn && rn.capabilities && rn.capabilities.getMaxAnisotropy) {
      tx.anisotropy = Math.min(4, rn.capabilities.getMaxAnisotropy());
    }
    _laceTex = tx;
    return _laceTex;
  }

  V.lavaFlow = function (o) {
    o = o || {};
    const parent = o.parent || CBZ.scene;
    const groundAt = o.groundAt || flatGround;
    const width = o.width > 0 ? +o.width : 5.5;
    const halfW = width * 0.5;
    const narrow = width < 4.2;
    const COLS = narrow ? LAVA_COLS_N : LAVA_COLS;
    const UU = narrow ? LAVA_U_N : LAVA_U;
    const len = o.len > 0 ? +o.len : 40;
    const speed = o.speed > 0 ? +o.speed : 5;
    const salt = o.salt != null ? (o.salt | 0) : 4711;
    /* Station spacing used to be set by the LID — enough samples per plate
       to draw the crack network. The lace is a texture now, sampled per
       fragment, so the grid only has to carry SMOOTH things: the bed under
       each vertex, the width's lobes, and the temperature envelope. 2.3-2.8 m
       is what those want. (Tying it to the flow's width instead, as the very
       first cut did, put a narrow thread on a 0.8 m grid and paid for
       thirty-five stations to draw two metres of rock.) */
    const seg = clamp(width * 0.38, 2.3, 2.8);
    /* A STATION EVERY seg METRES IS A DECISION EVERY seg METRES. Halving the
       wander and the turn rate (against fallLine's 0.45/0.16 defaults) is the
       other half of the anti-zig-zag fix: lava has momentum and a metre of
       lateral wobble per four metres travelled is not momentum, it is noise.
       smoothPath then files off what survives. */
    const path = smoothPath(fallLine({
      x: o.x, z: o.z, groundAt: groundAt, bearing: o.bearing,
      step: seg, count: Math.ceil(len / seg) + 1, salt: salt,
      turn: 0.3, wander: 0.06,
    }), 2, groundAt);
    const N = path.pts.length;

    /* ---- BRANCHING — THE FAN --------------------------------------------
       The reference close-up is not a ribbon: it is an anastomosing FIELD,
       a stem that forks into lobes that fork again, and the fan of noses at
       the bottom is half of what makes it read as fluid finding its own way
       rather than as a drawn stripe. `branches: n` arms up to n fork points
       along the run; when the front actually REACHES one, a narrower child
       flow is born there on a diverging bearing and steered by the same
       mountain. Children are real lavaFlows — they register in the audit,
       their hitTest is this handle's hitTest (what glows kills), and they
       die with their parent. Deterministic: fork stations, sides and angles
       are all h01 off world position, so every client grows the same tree.
       LIVE.lava is capped before a spawn so a pathological cone cannot fork
       itself into a frame drop. ---- */
    const branchN = o.branches > 0 ? Math.min(3, o.branches | 0) : 0;
    const branchPts = [];
    for (let bi = 0; bi < branchN; bi++) {
      const bt = 0.3 + 0.3 * bi + 0.16 * h01(o.x + bi * 13, o.z - bi * 7, salt + 77);
      branchPts.push({ at: Math.min(len * 0.86, len * bt), done: false });
    }
    const children = [];

    // ---- per-station shape, hashed off the station's own world position so
    //      the river's outline is identical on every client ----
    /* THE OUTLINE IS LOBED, NOT NOISY. The old width jitter was an
       independent hash per station — white noise at 2.3 m wavelength, which
       the eye reads as a ragged strip of the SAME average width. The bible
       photograph's flow necks and bellies: tens-of-metres waves where it
       narrows to a thread and then spills into a broad lobe. Two slow sines
       with hash-seeded phases give that; the per-station hash survives only
       as a small grain on top. */
    const wPh1 = h01(o.x, o.z, salt + 51) * 6.28;
    const wPh2 = h01(o.x, o.z, salt + 63) * 6.28;
    /* AND THE CHANNEL WANDERS BETWEEN ITS BANKS. The melt used to sit dead
       centre at every station, which made the bright core a stripe down the
       middle of a strip — geometry again. A real channel is pushed around by
       its own levees, so the inset footprint slides side to side on its own
       slow wave. Applied identically to the bed probe below and to ring(),
       or the meandering channel would float off its own bed. */
    const mPh = h01(o.x, o.z, salt + 71) * 6.28;
    const wProf = new Float32Array(N);     // half-width multiplier
    const hot0 = new Float32Array(N);      // incandescence at birth
    const meander = new Float32Array(N);   // channel offset, in u units
    for (let i = 0; i < N; i++) {
      const p = path.pts[i], u = i / (N - 1);
      // a flow LEAVES the vent narrow and FANS OUT as the ground flattens —
      // and along the way it necks and bellies on the two slow waves
      /* IN METRES, AND TWICE AS DEEP. Keyed on the station INDEX these waves
         changed wavelength every time `seg` moved, and at +-0.37 the outline
         was a straight strip with a wobble on it: the eye reads a margin as
         ruled unless the width actually HALVES somewhere. +-0.51 over a 24 m
         and a 10 m wave necks the flow to about half and spills it to about
         one and a half, which is the bible photograph's belly-and-neck. */
      const sm = i * seg;
      const lobe = 1 + 0.34 * Math.sin(sm * 0.26 + wPh1) + 0.17 * Math.sin(sm * 0.62 + wPh2);
      wProf[i] = (0.5 + 0.72 * Math.pow(u, 0.7)) * lobe * (0.9 + 0.2 * h01(p.x, p.z, salt + 11));
      // temperature falls downstream — this is the whole colour story.
      // Gentled from 0.72: the toe of an ACTIVE flow is still ~1000 C rock
      // arriving from the vent, dull orange rather than near-black.
      hot0[i] = clamp(1.06 - 0.6 * u + (h01(p.x, p.z, salt + 37) - 0.5) * 0.16, 0.1, 1);
      meander[i] = 0.13 * Math.sin(i * 0.44 + mPh) + 0.05 * Math.sin(i * 1.03 + mPh * 2);
    }

    /* ---- THE BED, SOLVED ONCE ------------------------------------------
       The other half of "glitches down weirdly": every vertex across the
       ribbon used to take its height from the ground under the STATION
       CENTRE. On a cone that is wrong by the cross-slope times the half
       width — several metres on the steep upper face — so one bank of the
       flow hung in the air and the other was buried in the hillside, and
       the seam crawled as the flow turned. It looked like tearing because
       it was tearing.

       Each vertex now stands on the ground under ITSELF, floored at the
       channel centre's height so the sheet PONDS across a hollow instead of
       draping into it. The path never moves after construction, so this is
       solved once here and costs nothing per frame — the per-frame writer
       only adds the thickness on top.
       -------------------------------------------------------------------- */
    const cGY = new Float32Array(N * COLS);   // crust bed
    const mGY = new Float32Array(N * COLS);   // melt bed (inset)
    const grain = new Float32Array(N * COLS); // per-vertex rock grain
    const nX = new Float32Array(N), nZ = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const p = path.pts[i];
      const a = path.pts[Math.max(0, i - 1)], b2 = path.pts[Math.min(N - 1, i + 1)];
      let nx = -(b2.z - a.z), nz = (b2.x - a.x);
      const nl = Math.hypot(nx, nz) || 1;
      nX[i] = nx / nl; nZ[i] = nz / nl;
      const hw = halfW * wProf[i];
      for (let c = 0; c < COLS; c++) {
        const u = UU[c], au = Math.abs(u), k = i * COLS + c;
        const x = p.x + nX[i] * u * hw, z = p.z + nZ[i] * u * hw;
        /* THE PONDING FLOOR IS FOR THE CHANNEL, NOT FOR THE LEVEE.
           `max(ground, centreline)` is what makes the sheet POND across a
           hollow instead of draping into it — right in the middle, wrong at
           the margin. Traversing a steep cone obliquely, one bank's ground is
           metres below the centreline, so the outer column was held up at the
           centreline's height and the flow hung off the hillside as a
           floating blade with a black underside (the night close-up caught it
           exactly). The floor now RELAXES to the real ground as |u| -> 1: the
           channel still ponds, and the levee lands on the rock it is running
           over. This is the other half of un-ruling the margin — a rolled-over
           lip that reaches the ground has no cast shadow to draw a line with. */
        const g = groundAt(x, z);
        cGY[k] = g + (Math.max(g, p.y) - g) * (1 - au * au);
        // the same wandering-channel offset ring() draws with — the centre
        // columns carry the full meander, the banks stay pinned
        const mu = u * MELT_INSET + meander[i] * (1 - au), amu = Math.abs(mu);
        const mx = p.x + nX[i] * mu * hw;
        const mz = p.z + nZ[i] * mu * hw;
        const mg = groundAt(mx, mz);
        mGY[k] = mg + (Math.max(mg, p.y) - mg) * (1 - amu * amu * amu);
        grain[k] = h01(x, z, salt + 5);
      }
    }

    // ---- CRUST: opaque, lit, flat-shaded, thickening ----
    const cPos = new Float32Array(N * COLS * 3);
    const cCol = new Float32Array(N * COLS * 3);
    const cIdx = new Uint16Array(Math.max(1, (N - 1) * (COLS - 1) * 6));
    let ii = 0;
    for (let i = 0; i < N - 1; i++) {
      for (let c = 0; c < COLS - 1; c++) {
        const a = i * COLS + c, b2 = a + 1, d = a + COLS, e = d + 1;
        cIdx[ii++] = a; cIdx[ii++] = d; cIdx[ii++] = b2;
        cIdx[ii++] = b2; cIdx[ii++] = d; cIdx[ii++] = e;
      }
    }
    const crustGeo = new THREE.BufferGeometry();
    crustGeo.setAttribute("position", new THREE.BufferAttribute(cPos, 3));
    crustGeo.setAttribute("color", new THREE.BufferAttribute(cCol, 3));
    crustGeo.setIndex(new THREE.BufferAttribute(cIdx, 1));
    /* r128 FACT: MeshLambertMaterial does NOT support flatShading — it warns
       and silently ignores it (flatShading lives on Phong/Standard/Normal).
       A crust that is not faceted is not a crust, so this is Phong with the
       specular term switched off: Lambert's diffuse look, with the flat
       normals that make the levees read as broken rock. */
    const crustMat = new THREE.MeshPhongMaterial({
      vertexColors: true, flatShading: true, shininess: 0, specular: 0x000000,
      side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    });
    const crust = new THREE.Mesh(crustGeo, crustMat);
    crust.frustumCulled = false;
    crust.renderOrder = 2;
    parent.add(crust);

    // ---- MELT: opaque, UNLIT (= incandescent), same grid, inset footprint ----
    const kPos = new Float32Array(N * COLS * 3);
    const kCol = new Float32Array(N * COLS * 3);
    const kUv = new Float32Array(N * COLS * 2);   // where this vertex is in the lace
    const kIdx = new Uint16Array(Math.max(1, (N - 1) * (COLS - 1) * 6));
    ii = 0;
    for (let i = 0; i < N - 1; i++) {
      for (let c = 0; c < COLS - 1; c++) {
        const a = i * COLS + c, b2 = a + 1, d = a + COLS, e = d + 1;
        kIdx[ii++] = a; kIdx[ii++] = d; kIdx[ii++] = b2;
        kIdx[ii++] = b2; kIdx[ii++] = d; kIdx[ii++] = e;
      }
    }
    const chGeo = new THREE.BufferGeometry();
    chGeo.setAttribute("position", new THREE.BufferAttribute(kPos, 3));
    chGeo.setAttribute("color", new THREE.BufferAttribute(kCol, 3));
    chGeo.setAttribute("uv", new THREE.BufferAttribute(kUv, 2));
    chGeo.setIndex(new THREE.BufferAttribute(kIdx, 1));
    /* map x vertexColors, both plain r128 multiplies: the vertex colour is
       the smooth envelope (how hot this stretch of river is, how far across
       the channel this vertex sits) and the map is the lace. Still opaque,
       still unlit — incandescent rock does not answer to the sun. */
    const chMat = new THREE.MeshBasicMaterial({
      vertexColors: true, side: THREE.DoubleSide, fog: true, map: laceTex(),
      polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6,
    });
    const chan = new THREE.Mesh(chGeo, chMat);
    chan.frustumCulled = false;
    chan.renderOrder = 3;
    parent.add(chan);

    /* ---- HEAT HAZE: the ONLY transparent thing here, and it floats ABOVE
       the rock rather than being made of it.

       AND IT HAS TO STAY OUT OF THE WAY. At opacity 0.3, additive, ten deep,
       at 1.6x the flow's own width, this was not a shimmer — it was an opaque
       orange sheet parked over the subject, and a camera brought close enough
       to photograph the magma ended up INSIDE it, which whited out the frame
       completely. Convection over a lava channel is a distortion you notice
       at the edges of things, not a light source: a third of the size and a
       third of the opacity. ---- */
    const hazeN = o.haze === false ? 0 : qi(2, Math.max(2, Math.min(5, Math.round(N * 0.22))));
    const hazeMat = new THREE.SpriteMaterial({
      map: glowTex(), color: 0xff8636, transparent: true, opacity: 0.06,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: true,
    });
    const haze = [];
    for (let i = 0; i < hazeN; i++) {
      const s = new THREE.Sprite(hazeMat);
      s.scale.set(width * 0.6, width * 0.6, 1);
      s.renderOrder = 8;
      s.visible = false;
      parent.add(s);
      haze.push({ sp: s, u: (i + 0.5) / hazeN, ph: Math.random() * 6.28 });
    }

    // ---- POOLED LIGHT: budget-conscious, and the reason a night eruption
    //      paints the hillside instead of floating on it ----
    let light = null;
    if (o.light !== false && CBZ.CONFIG.VOLCANO_V2 !== false) {
      light = new THREE.PointLight(0xff6a1e, 0, Math.max(24, width * 6), 2);
      light.castShadow = false;
      parent.add(light);
      census.lights++;
    }

    let adv = Math.min(seg * 1.05, len);   // metres of flow laid down
    let age = 0, dead = false, lidT = 0, lastSt = -1;
    /* THE QUENCH — what happens when the eruption stops feeding this flow.
       quenchT < 0 is a live river. quench() starts the clock: over ~8 s the
       front stalls, the advection phase winds down (a chilling surface stops
       travelling), the melt dies to near-black rock with the last ember
       seams in the deepest cracks, the haze and the pooled light fade out.
       Fully settled, update() becomes a no-op and the flow just STANDS
       there as dark crusted rock — which is the vulcanology (supply stops,
       THEN it chills black) and the fix for the old endEruption pop, where
       a glowing river vanished from the hillside in a single frame. phT
       replaces `age` in the phase term so the wind-down actually slows the
       lace instead of just dimming it. */
    let quenchT = -1, phT = 0, settled = false;
    const QUENCH_SECS = 8;
    const _v = new THREE.Vector3();
    /* THE SURFACE RUNS FASTER THAN THE FRONT. The nose is braked by the crust
       it is pushing; the melt behind it is not. ~2.4x is the ratio that reads
       as "a river with a lid on it" rather than as a conveyor belt. */
    const skinV = speed * 2.4;
    /* EVERY FLOW WEARS THE SAME TEXTURE, so without this every stem on the
       cone would wear the same crack network in the same place — five copies
       of one photograph. A hashed metre offset down the lace slides each
       flow to its own stretch of the field. Deterministic, like everything
       else about a flow's shape. */
    const laceOff = h01(o.x, o.z, salt + 301) * LACE_L * 7;

    // one ring of COLS vertices, at a given centre / normal / width
    function ring(i, cx, cy0, cz, nx, nz, hw, thick, hot, s, ph, bedC, bedM) {
      const u01 = N > 1 ? clamp(s / Math.max(0.001, (N - 1) * seg), 0, 1) : 0;
      for (let c = 0; c < COLS; c++) {
        const u = UU[c], au = Math.abs(u), k = i * COLS + c, off = k * 3;
        /* FLAT-TOPPED, STEEP-SIDED. A quadratic crown is a half-cylinder, and
           a half-cylinder with a bright middle is a fluorescent tube; an 'a'a
           flow is a broad flat raft riding between two steep levees. The cubic
           keeps the top honest and puts all the fall-off in the last fifth.

           AND THE MARGIN IS NOT A CLIFF. The old crown floored at 0.25, so
           the outermost column stood a fifth of the flow's thickness proud of
           the hillside and the sheet simply STOPPED there: a hard step, drawn
           as a ruled line between lava and grass at every distance. It now
           reaches zero at |u| = 1 — the rock rolls over and lands ON the
           ground it is running across — with a levee RIDGE bumped up at
           |u| ~ 0.86, which is where a real channel piles the rubble it
           shoulders aside. The ridge stands proud of the melt (which tops out
           at 0.75 of thickness at its own inset edge), so the channel is
           something you look INTO instead of a stripe painted on a slab. */
        const bump = Math.max(0, 1 - Math.pow((au - 0.87) * 7, 2));
        const crown = Math.max(0, 1 - Math.pow(au, 3.6)) + 0.50 * bump;
        /* the lip is the coldest, most broken rock on the flow, and darkening
           it is the other half of un-ruling the margin: a levee that fades
           into the hillside has no edge to be straight. */
        const edgeK = 0.5 + 0.5 * (1 - Math.pow(au, 5));
        const gr = (0.84 + 0.30 * grain[k]) * edgeK;
        /* the melt's grain must never exceed 1: a bright stop multiplied past
           its own hex clips channel-by-channel and desaturates toward white —
           this, plus the encoding lift, was most of the "pale gold laser" */
        const grM = 0.8 + 0.2 * grain[k];

        // ---- CRUST: lit, full width, the levees and the thickness ----
        cPos[off] = cx + nx * u * hw;
        cPos[off + 2] = cz + nz * u * hw;
        cPos[off + 1] = (bedC ? bedC[k] : cy0) + 0.05 + thick * crown;
        ramp3(clamp((1 - au) * (0.3 + 0.7 * hot), 0, 1), CRUST_A, CRUST_B, CRUST_C, _c3);
        cCol[off] = _c3.r * gr; cCol[off + 1] = _c3.g * gr; cCol[off + 2] = _c3.b * gr;

        // ---- MELT: unlit, inset, and the field decides what is showing ----
        const mu = u * MELT_INSET + meander[i] * (1 - au), amu = Math.abs(mu);
        kPos[off] = cx + nx * mu * hw;
        kPos[off + 2] = cz + nz * mu * hw;
        // the channel FLOOR is flat — it is a raft of liquid rock lying
        // between two levees, so its cross-section is a shallow dish, not a
        // crown. The crust's ridge above does the standing-proud.
        kPos[off + 1] = (bedM ? bedM[k] : cy0) + 0.05 + thick * (0.45 + 0.55 * (1 - Math.pow(amu, 3.2))) + 0.04;
        /* WHAT THE VERTEX CARRIES NOW IS THE ENVELOPE, and only the
           envelope — every high-frequency thing moved into the lace texture
           above, because the vertex grid provably cannot hold it.

             across  melt lives inside the levees, and its reach narrows as
                     the levees grow inward downstream
             open    the lid thickens with distance from the vent
             flood   the vent apron: the first metres have no lid at all
             hot     the station's own temperature, which is the whole story
                     from white-hot rim to dull-red toe to black scar

           All four are smooth over metres, which is exactly what linear
           interpolation between stations is good at. */
        const across = 1 - Math.pow(amu, 3.4 + 2.1 * u01);
        const open = 0.98 - 0.22 * u01;
        /* THE APRON IS A FIXED NUMBER OF METRES OFF THE RIM, not a fraction
           of the flow's EVENTUAL length. `u01` is s / (full len), and a flow
           creeping at 1.4 m/s has covered ~17 m of its 70 m by the time any
           of these beats photographs it — so "the first 19% of len" was the
           first 13 m of a 17 m flow, and every lava shot in the storyboard
           was a picture of the vent apron with the rest of the look hiding
           behind it. Six metres of flood, measured, is the apron. */
        const flood = clamp((1 - s / 6) * 1.3, 0, 1) * (0.5 + 0.5 * hot);
        /* hot^1.6, not hot: the ramp's top stop is 1150 C rock and the
           eruption keeps `hot` high for its whole run (the 2026-08-16
           slow-cooling repair), so anything linear parked the entire river on
           the bright stop — which is the pale-gold slab, one layer up from
           the palette that was also wrong. The power curve puts the body of a
           fed flow on the red-orange stop and reserves the bright end for the
           apron and the freshest rock. */
        let env = across * open * Math.pow(hot, 1.6);
        env = Math.max(env, flood * across);
        ramp3(clamp(env, 0, 1), MELT_A, MELT_B, MELT_C, _c3);
        /* AND THE RAMP'S BOTTOM STOP IS NOT BLACK — MELT_A is a dull red,
           which is right for a dying seam and wrong for dead rock. A quench
           drives `hot` to ~0.05 and env with it, so this last multiply is
           what actually lands the settled scar on black instead of on maroon.
           (Measured on the shipped build before it existed: rgb(72,24,19).) */
        _c3.multiplyScalar(Math.min(1, env * 4.5));
        kCol[off] = _c3.r * grM; kCol[off + 1] = _c3.g * grM; kCol[off + 2] = _c3.b * grM;
        /* THE LACE'S OWN COORDINATES. uv.x is metres across the flow, uv.y is
           metres down it MINUS the metres the lid has advected — which is the
           whole animation: the crack network travels downstream at the
           surface velocity and the geometry never moves. `ph` arrives here in
           METRES (it used to be radians of the old sine field). */
        const uo = k * 2;
        kUv[uo] = 0.5 + (mu * hw) / LACE_W;
        kUv[uo + 1] = (s - ph) / LACE_L;
      }
    }

    /* HOW FAST DOES LAVA GO BLACK? Slower than this file thought. OWNER,
       2026-08-16: "the magma turns black way too soon... research the magma
       coming out of a volcano and when it becomes black to do it right."
       The vulcanology: basalt erupts at ~1100-1200 C (yellow-orange) and
       stays visibly incandescent all the way down to ~500 C. A STAGNANT skin
       greys over in minutes — but a channel that is still BEING FED keeps
       tearing its own skin open and reads orange for hours; flows only chill
       black after the supply stops. Every flow here is fed for the whole
       eruption, so at /26 the vent stations were "hours old" by second
       twenty of a twenty-second event — that is the premature black. /90
       means an eruption-length lifetime dims a station ~20%, and the floor
       (0.42, was 0.28) keeps even the oldest surface at a dull-red crack
       glow instead of flat black — which is what the seams of a real flow
       margin do for days. */
    function stationThick(i) {
      const bornAt = i * seg / Math.max(0.001, speed);
      const localAge = clamp(age - bornAt, 0, 120);
      // the quench overrides the slow clock: with the supply cut, the whole
      // run chills together over QUENCH_SECS instead of station by station
      const qk = quenchT >= 0 ? Math.min(1, quenchT / QUENCH_SECS) : 0;
      return {
        t: 0.18 + 0.5 * (localAge / (localAge + 6)) + 0.1 * wProf[i],
        cool: clamp(localAge / 90 + qk, 0, 1),
        qk: qk,
      };
    }

    function writeStations(from, to) {
      const ph = phT * skinV + laceOff;   // METRES the lid has travelled
      for (let i = from; i <= to && i < N; i++) {
        const p = path.pts[i], st = stationThick(i);
        // the second quench factor lands the settled flow at ~4% hot: black
        // rock, with the last dull-red seams surviving in the deepest lace
        ring(i, p.x, p.y, p.z, nX[i], nZ[i], halfW * wProf[i], st.t,
          hot0[i] * (1 - 0.58 * st.cool) * (1 - 0.9 * st.qk), i * seg, ph, cGY, mGY);
      }
    }

    /* THE NOSE, AND WHY IT IS ITS OWN FUNCTION.

       The front used to be wherever the last WHOLE station happened to be:
       drawRange was quantised to complete quads, so the tip sat at a
       multiple of `seg` and jumped forward four to six metres at a stroke
       every time `adv` crossed a boundary — then held perfectly still while
       `adv` caught up. That stutter is the "glitches down" in the owner's
       note, and no amount of speed tuning could have fixed it because the
       tip was never actually AT `adv`.

       So the leading ring is written separately, planted at exactly `adv`
       along the path and tapered to a snout. It slides continuously between
       stations and the flow noses forward instead of teleporting. Its bed is
       sampled live — five ground probes for the one ring that moves. */
    const _noseC = new Float32Array(COLS), _noseM = new Float32Array(COLS);
    function writeNose(i) {
      if (i < 1) return;
      pathAt(path, adv, _v);
      const i0 = i - 1;
      const a = path.pts[i0], b2 = path.pts[Math.min(N - 1, i)];
      let nx = -(b2.z - a.z), nz = (b2.x - a.x);
      const nl = Math.hypot(nx, nz) || 1; nx /= nl; nz /= nl;
      const frac = clamp((adv - i0 * seg) / seg, 0, 1);
      // a flow front is a blunt snout, not a point: it bulges as it is fed
      const hw = halfW * wProf[i] * (0.34 + 0.66 * frac);
      for (let c = 0; c < COLS; c++) {
        const u = UU[c], au = Math.abs(u), k = i * COLS + c;
        _noseC[c] = cGY[k]; _noseM[c] = mGY[k];
        // same relaxed ponding floor as the solved-once bed above, or the
        // nose would be the one ring still hanging off the hillside
        const g = groundAt(_v.x + nx * u * hw, _v.z + nz * u * hw);
        cGY[k] = g + (Math.max(g, _v.y) - g) * (1 - au * au);
        // the nose's melt bed rides the same wandering channel as ring()
        const mun = u * MELT_INSET + meander[i] * (1 - au), amun = Math.abs(mun);
        const mg = groundAt(_v.x + nx * mun * hw, _v.z + nz * mun * hw);
        mGY[k] = mg + (Math.max(mg, _v.y) - mg) * (1 - amun * amun * amun);
      }
      const st = stationThick(i);
      ring(i, _v.x, _v.y, _v.z, nx, nz, hw, st.t * (0.55 + 0.45 * frac),
        hot0[i] * (1 - 0.58 * st.cool) * (1 - 0.9 * st.qk), adv, phT * skinV + laceOff, cGY, mGY);
      // put the station's own bed back — the nose borrowed those slots
      for (let c = 0; c < COLS; c++) {
        const k = i * COLS + c;
        cGY[k] = _noseC[c]; mGY[k] = _noseM[c];
      }
    }
    writeStations(0, 1);
    // the crust's normal attribute exists for the shader's sake and never
    // changes after this: FLAT_SHADED derives its own (see update()).
    crustGeo.computeVertexNormals();

    const handle = {
      kind: "lava", group: crust, path: path, mesh: crust, channel: chan,
      get length() { return adv; },
      get tip() {
        pathAt(path, adv, _v);
        return { x: _v.x, y: _v.y, z: _v.z };
      },
      /* A FLOW IS A CURVE, AND THE TIP ALONE DOES NOT SAY WHICH WAY IT RUNS.
         Anything framing or fencing this thing — a camera, a threat overlay,
         a bot's flee vector — has been guessing the axis by drawing a straight
         line from the vent to the tip, and a fall line that has followed the
         mountain around a shoulder is nowhere near that line. `mid` plus `tip`
         is the cheapest honest answer: two points that are both ON the flow. */
      get mid() {
        pathAt(path, adv * 0.5, _v);
        return { x: _v.x, y: _v.y, z: _v.z };
      },
      update(dt) {
        if (dead || settled) return handle;
        age += dt;
        const qk = quenchT >= 0 ? Math.min(1, (quenchT += dt) / QUENCH_SECS) : 0;
        // a chilling surface stops travelling: the phase winds down with the
        // heat instead of the lace sliding under a dead crust forever
        phT += dt * (1 - qk);
        if (quenchT < 0) adv = Math.min(len, adv + speed * dt);
        // the front forks where a fork was armed — see BRANCHING above
        // (a quenched flow is no longer fed, so it arms nothing new)
        if (quenchT >= 0) branchPts.length = 0;
        for (let b = 0; b < branchPts.length; b++) {
          const bp = branchPts[b];
          if (bp.done || adv < bp.at) continue;
          bp.done = true;
          if (LIVE.lava.length >= 26) continue;
          pathAt(path, bp.at, _v);
          const i0 = clamp(Math.floor(bp.at / seg), 0, N - 2);
          const A = path.pts[i0], B2 = path.pts[i0 + 1];
          const side = h01(_v.x, _v.z, salt + 88) < 0.5 ? -1 : 1;
          const a2 = Math.atan2(B2.z - A.z, B2.x - A.x) + side * (0.5 + 0.55 * h01(_v.x, _v.z, salt + 99));
          children.push(V.lavaFlow({
            x: _v.x, z: _v.z, groundAt: groundAt, parent: parent, bearing: a2,
            width: width * 0.62, len: Math.max(11, (len - bp.at) * 0.85),
            speed: speed * 0.9, salt: salt * 3 + 101 + b * 29,
            light: false, haze: false, branches: 0,
          }));
          census.branches++;
        }
        for (let b = 0; b < children.length; b++) children[b].update(dt);
        const st = Math.min(N - 1, Math.floor(adv / seg) + 1);
        /* REWRITE EVERY FRAME, ALWAYS. The old build skipped the rewrite when
           the front had stopped moving, which was correct when the only thing
           a written vertex could express was "cooler than last time". Now the
           lid field is a function of TIME, so a skipped frame is a frozen
           river — the exact failure the owner reported. N is a dozen-odd
           stations; this is a few hundred floats. */
        /* THE RIBBON REWRITES AT 30 Hz; THE NOSE EVERY FRAME. Nine threads
           instead of four tripled the per-frame vertex work, and the lid is a
           colour animation — it does not need 60 Hz. The full pass still runs
           immediately whenever the front reaches a new station, so the ring
           that was the tapered nose gets its full width on the same frame it
           stops being the front. */
        lidT += dt;
        // qk >= 1 forces one FINAL full write past the 30 Hz throttle, so the
        // settled colours actually land before update() stops doing anything
        if (st !== lastSt || lidT >= 0.033 || qk >= 1) {
          lidT = 0; lastSt = st;
          writeStations(0, Math.max(0, st - 1));
        }
        writeNose(st);
        crustGeo.attributes.position.needsUpdate = true;
        crustGeo.attributes.color.needsUpdate = true;
        chGeo.attributes.position.needsUpdate = true;
        chGeo.attributes.color.needsUpdate = true;
        // the uvs ARE the animation: the lace slides downstream through a
        // mesh that never moves relative to the rock
        chGeo.attributes.uv.needsUpdate = true;
        crustGeo.setDrawRange(0, Math.max(0, st) * (COLS - 1) * 6);
        chGeo.setDrawRange(0, Math.max(0, st) * (COLS - 1) * 6);
        /* NO computeVertexNormals(). r128 FACT, checked in the shipped build:
           `normal_fragment_begin` takes the #ifdef FLAT_SHADED branch and
           rebuilds the normal from dFdx/dFdy of the view position — the
           attribute is not even varied to the fragment shader. Recomputing a
           few hundred normals a frame for a flat-shaded material fed exactly
           nothing. It is computed ONCE at build so the attribute exists. */
        // runtime-only flicker (allowed to be non-deterministic): the whole
        // melt breathes as one, which costs one uniform instead of a
        // per-vertex rewrite
        // capped at 1.04: over-driving vertex colours through the output
        // encoding is what bleached the melt toward white in the peek shots
        // a dying surface stops breathing too — the flicker rides (1 - qk)
        const fl = 0.96 + (0.06 * Math.sin(age * 5.3) + Math.random() * 0.04 - 0.04) * (1 - qk);
        chMat.color.setScalar(clamp(fl, 0.75, 1.04));

        for (let i = 0; i < haze.length; i++) {
          const H = haze[i], s = adv * H.u;
          if (s < 0.5 || qk >= 1) { H.sp.visible = false; continue; }
          pathAt(path, s, _v);
          H.sp.visible = true;
          H.sp.position.set(
            _v.x + Math.sin(age * 0.9 + H.ph) * width * 0.3,
            _v.y + 1.4 + 0.7 * Math.sin(age * 1.6 + H.ph),
            _v.z + Math.cos(age * 0.8 + H.ph) * width * 0.3
          );
          // the convection dies with the heat under it
          const sc = width * (0.42 + 0.13 * Math.sin(age * 1.1 + H.ph)) * (1 - qk);
          H.sp.scale.set(Math.max(0.01, sc), Math.max(0.01, sc), 1);
        }
        if (light) {
          pathAt(path, adv * 0.82, _v);
          light.position.set(_v.x, _v.y + 2.2, _v.z);
          light.intensity = (1.5 + 0.35 * Math.sin(age * 4.1)) * (1 - qk);
        }
        // fully chilled: one last frame just wrote the black-rock colours,
        // so the scar can stop paying for updates it no longer shows
        if (qk >= 1) { settled = true; chMat.color.setScalar(1); }
        return handle;
      },
      /* the eruption stopped feeding this flow. It stalls, chills black over
         QUENCH_SECS, and STAYS — the caller keeps it as a scar (the lahar's
         harden() precedent) instead of deleting a glowing river mid-frame.
         Children are branches of the same supply, so they die with it. */
      quench() {
        if (quenchT < 0) {
          quenchT = 0;
          for (let b = 0; b < children.length; b++) children[b].quench();
        }
        return handle;
      },
      get quenched() { return quenchT >= 0; },
      // is (x,z) ON the flow? The lethal corridor IS the drawn ribbon —
      // the same wProf the geometry used, so what kills you is what glows.
      // A branch is part of the flow, so its ribbon kills through this same
      // call and no caller has to know the tree exists.
      hitTest(x, z) {
        // cold rock is terrain, not a hazard — what kills you is what glows
        if (quenchT >= 0) return false;
        const c = pathCoord(path, x, z, adv);
        if (c.s >= 0 && c.s <= adv) {
          const i = clamp(Math.round(c.s / seg), 0, N - 1);
          if (c.perp < halfW * wProf[i] * 0.95) return true;
        }
        for (let b = 0; b < children.length; b++) if (children[b].hitTest(x, z)) return true;
        return false;
      },
      // 0..1 "how much of its run has it made" — for threat maps
      progress() { return adv / len; },
      dispose() {
        if (dead) return;
        dead = true;
        for (let b = 0; b < children.length; b++) children[b].dispose();
        parent.remove(crust); parent.remove(chan);
        crustGeo.dispose(); crustMat.dispose();
        chGeo.dispose(); chMat.dispose();
        for (let i = 0; i < haze.length; i++) parent.remove(haze[i].sp);
        hazeMat.dispose();
        if (light) { parent.remove(light); census.lights--; }
        const k = LIVE.lava.indexOf(handle); if (k >= 0) LIVE.lava.splice(k, 1);
      },
    };
    census.lava++;
    LIVE.lava.push(handle);
    return handle;
  };

  /* ============================================================
     ASH COLUMN — the pillar over the vent, and the fountain under it.

     The wide reference photograph's second subject after the lava: a FAT,
     coherent, dark convective column standing over the crater, bulging into
     a cauliflower head, leaning downwind. It is built from overlapping
     camera-facing sprites wearing a lumpy cauliflower alpha, each with a
     LIFECYCLE — born at the vent, climbing while it expands, decelerating
     into the head, spreading there, recycled inside the crowd dense enough
     to mask it. Nothing oscillates; all motion is travel.

     2026-09-01, THREE MEASURED FAULTS, from photographs of the shipped page:

     1. IT WAS A PENCIL. `axisR = r0 * (0.22 + 0.76*hh + ...)` put the stem
        radius at 0.22*r0 — 2.4 m — under a 72 m mountain, so the column
        photographed as a 5-10 m string of legible round puffs. A convective
        plume does the opposite: it leaves a mouth the size of the VENT and
        ENTRAINS ambient air as it climbs, widening ~0.2 m per metre of
        rise. Radius now starts at r0 and grows with the climb, and every
        puff is sized off the LOCAL radius, so the overlap depth (4-6 cards
        through any ray) holds whether the plume is 20 m or 90 m across.
        Density comes from bigger sprites, not more of them.

     2. IT FLOATED. A puff's opacity ran up over u < 0.085, and 0.085 of
        this rise curve is 13 m — so the column's base hung three storeys
        above the crater with nothing but sparse fountain sparks in the gap.
        Birth is now inside the first ~2 m, where the vent apron and the
        fountain cover the pop.

     3. IT WAS PALE. THE LINEAR-HEX TRAP: a material colour in this r128
        build is LINEAR, and every pixel then walks ACES + the film grade +
        the sRGB encode on its way to the screen (core/renderer.js). The
        edge tier 0x292824 — near-black in a hex picker — leaves that
        pipeline at rgb(196), which is why the night column photographed
        LIGHTER THAN THE NIGHT SKY. Colours here are authored in SCREEN
        bytes and inverted back through the shipped transform (screenHex),
        so "soot" is soot on the glass.

     The light on the soot is baked per puff per frame from three terms: a
     height ramp (dark brown-grey throat, mid-grey body, lighter crown), a
     SUN-SIDE lift taken from the puff's bearing against the real sun
     direction (core/lights.js's sun vs its target), and the VENT UNDERLIGHT
     — the ~28 m of column standing on the crater goes rose-orange from
     below, scaled by night. That last one is the Fuego photograph in one
     line: a black pillar with a burning foot.
     ============================================================ */

  /* ---- SCREEN BYTES -> LINEAR MATERIAL HEX ----------------------------
     Inverts core/renderer.js's output transform (exposure, ACES, the
     lift/gamma/gain grade, sRGB) so a colour can be authored as what it
     should LOOK like. Bisection, memoised, a handful of calls at build. */
  let _gradeRead = false, _TONE = true, _GRADE = true, _EXP = 1.16;
  const GRADE_GAIN = [1.025, 1.005, 0.982], GRADE_LIFT = [0.0015, 0.0032, 0.0072];
  function toScreen(lin, ch) {
    let c = lin;
    if (_TONE) {
      c = c * _EXP / 0.6;
      // three r128's RRTAndODTFit, per channel: the ACES matrices are close
      // enough to identity for the near-neutrals this is used to solve for
      c = (c * (c + 0.0245786) - 0.000090537) / (c * (0.983729 * c + 0.432951) + 0.238081);
      c = clamp(c, 0, 1);
      if (_GRADE) {
        c = Math.pow(Math.max(c / 0.18, 0), 1.075) * 0.18;
        c = c * GRADE_GAIN[ch] + GRADE_LIFT[ch];
      }
      c = clamp(c, 0, 1);
    }
    return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  }
  const _screenCache = {};
  function screenHex(r, g, b) {
    if (!_gradeRead) {
      _gradeRead = true;
      _TONE = CBZ.toneMappingOn !== false;
      _GRADE = CBZ.CONFIG.RENDER_GRADE_V1 !== false;
      // gfx.js rides exposure on the day clock (~0.94 day .. ~1.18 night);
      // solve at the middle — the residual is a few per cent of brightness
      _EXP = (+CBZ.renderExposureBase || 1.16) * 1.05;
    }
    const key = (r << 16) | (g << 8) | b;
    if (_screenCache[key] != null) return _screenCache[key];
    const want = [r / 255, g / 255, b / 255];
    let out = 0;
    for (let ch = 0; ch < 3; ch++) {
      let lo = 0, hi = 1;
      for (let i = 0; i < 24; i++) {
        const mid = (lo + hi) * 0.5;
        if (toScreen(mid, ch) < want[ch]) lo = mid; else hi = mid;
      }
      out = (out << 8) | clamp(Math.round((lo + hi) * 0.5 * 255), 0, 255);
    }
    _screenCache[key] = out;
    return out;
  }
  V.screenHex = screenHex;   // the volcano's one colour authority; tools read it

  /* Where the sun actually is, as a horizontal bearing. core/lights.js
     builds its own direction the same way (sun.position - sunTarget), which
     is the only correct read: daynight.js sets the position and lights.js
     then slides the whole rig onto the camera focus. */
  const _sunXZ = { x: 0.6, z: -0.8 };
  function sunBearing() {
    const s = CBZ.sun;
    if (s && s.position) {
      let dx = s.position.x, dz = s.position.z;
      const tg = CBZ.sunTarget;
      if (tg && tg.position) { dx -= tg.position.x; dz -= tg.position.z; }
      const L = Math.sqrt(dx * dx + dz * dz);
      if (L > 1e-4) { _sunXZ.x = dx / L; _sunXZ.z = dz / L; }
    }
    return _sunXZ;
  }

  V.ashColumn = function (o) {
    o = o || {};
    const parent = o.parent || CBZ.scene;
    const x = +o.x || 0, z = +o.z || 0;
    const baseY = o.y != null ? +o.y : 0;
    const height = o.height > 0 ? +o.height : 55;
    const r0 = o.r > 0 ? +o.r : 7;
    const mats = [];
    /* `fogless`: the column is the eruption's LANDMARK, and a 180 m pillar
       whose head sits 250+ m from any camera on a 240 m island was being
       dissolved by the eruption's own 380 m fog wall — the most dramatic
       silhouette in nature, fading out precisely because it was tall enough
       to matter. Soot against sky owes the air nothing (city/nukefx.js's
       lobes made the same call), so the caller may exempt it. */
    const useFog = o.fogless ? false : true;
    /* EXACTLY THE RPG'S MASK when that shared owner is loaded. The standalone
       disaster slice intentionally omits the city blast module, so the
       volcano's own cauliflower cutout is the SHIPPED look and gets the
       same care. No copy, no second texture upload, no smoke mesh. */
    let blastSmoke = null;
    if (CBZ.cityBlastPuffAssets) {
      try { const A = CBZ.cityBlastPuffAssets(); blastSmoke = A && A.smoke; } catch (e) {}
    }
    // Screen-authored soot. Base is a dirty brown (fresh ash in its own
    // shadow), the body neutral, the crown a shade lighter where it is out
    // in the open; NIGHT is a silhouette and SUN is the lit face of the
    // head; VENT is the crater's own light thrown up onto the column's foot.
    const CH_BASE = screenHex(30, 25, 21);
    const CH_BODY = screenHex(48, 45, 43);
    const CH_CROWN = screenHex(68, 65, 61);
    const C_NIGHT = new THREE.Color(screenHex(12, 12, 15));
    const C_SUN = new THREE.Color(screenHex(172, 164, 149));
    const C_VENT = new THREE.Color(screenHex(214, 96, 38));
    // how far up the crater's own glow reaches — the Fuego photograph's
    // burning foot is roughly two vent diameters of lit column
    const VENT_REACH = 18 + 0.95 * r0;
    const N = qi(80, 156);
    const grp = new THREE.Group();
    grp.frustumCulled = false;
    parent.add(grp);
    /* u = life/RISE: 0 birth at the vent, 1 arrival at the head, then a
       bounded cauliflower hold before recycle. Births fill the whole cycle
       at a constant cadence: the plume grows honestly from an empty vent,
       then reaches a steady state where every lifecycle age is represented
       and no recycle can open a missing-age hole through the middle. */
    const RISE = 5, END = 1.4;
    // A local seeded stream makes the silhouette stable without stealing
    // random calls from bomb, lava and hazard gameplay downstream.
    let seed = (((x * 73856093) | 0) ^ ((z * 19349663) | 0) ^ 0x61a5c3d7) >>> 0;
    const rnd = function () { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    const puffs = [];
    for (let i = 0; i < N; i++) {
      /* Per-puff material state. Shared materials made every billboard
         rotate and fade in lockstep, which is what let the eye resolve a
         repeated card pattern; here rotation, opacity and the baked light
         are all owned, so nothing advances together. */
      const mat = new THREE.SpriteMaterial({
        map: blastSmoke || puffTex(i % 3), color: CH_BODY,
        transparent: true, opacity: 0, depthWrite: false, depthTest: true,
        fog: useFog, blending: THREE.NormalBlending, rotation: rnd() * 6.2832,
      });
      mats.push(mat);
      const m = new THREE.Sprite(mat);
      m.renderOrder = 7;
      m.visible = false;
      grp.add(m);
      const role = i % 10 < 3 ? 0 : (i % 10 < 8 ? 1 : 2);   // core / body / edge
      // sqrt keeps the population area-uniform across the disc instead of
      // piling every puff onto the axis; the edge tier is allowed past 1 so
      // the silhouette has a ragged coastline
      const rr = role === 0 ? 0.44 * Math.sqrt(rnd())
        : (role === 1 ? 0.26 + 0.56 * Math.sqrt(rnd()) : 0.66 + 0.46 * rnd());
      puffs.push({
        m: m, role: role,
        life: -(i / N) * RISE * END,
        ang: rnd() * 6.2832,
        rr: rr,
        ph: rnd() * 6.2832,
        sz: (role === 0 ? 1.06 : (role === 1 ? 0.98 : 0.82)) * (0.78 + 0.44 * rnd()),
        aspect: 0.74 + rnd() * 0.54,
        spin: (rnd() - 0.5) * (role === 2 ? 0.24 : 0.15),
        wind: 0.76 + rnd() * 0.38,
        maxOp: role === 0 ? 0.56 : (role === 1 ? 0.46 : 0.28),
      });
    }
    let t = 0, dead = false;
    const handle = {
      kind: "column", group: grp, puffCount: N,
      usesBlastSmoke: !!blastSmoke,
      /* opts.night (0 day .. 1 night) is the caller's day clock — tickEruption
         already computes it and it is the difference between a black
         silhouette and a grey smudge. Absent, the sky's own sun height
         answers, so a column raised by anything else still knows the hour. */
      update(dt, wx, wz, opts) {
        if (dead) return handle;
        t += dt;
        const bx = wx || 0, bz = wz || 0;
        const night = (opts && opts.night != null) ? clamp(+opts.night, 0, 1)
          : clamp(1 - (0.5 + 2.2 * (CBZ.sunHeight != null ? CBZ.sunHeight : 0.5)), 0, 1);
        const day = 1 - night;
        const sd = sunBearing();
        for (let i = 0; i < puffs.length; i++) {
          const P = puffs[i];
          P.life += dt;
          if (P.life < 0) { P.m.visible = false; continue; }
          let u = P.life / RISE;
          if (u >= END) {
            P.life = 0; u = 0;
            P.ang = rnd() * 6.2832;
            P.ph = rnd() * 6.2832;
            P.wind = 0.76 + rnd() * 0.38;
          }
          const climb = Math.min(1, u);
          // Buoyant ash leaves the throat fast and crowds at neutral
          // buoyancy. That crowd — not one giant disc — is the head.
          const hh = 1 - Math.pow(1 - climb, 1.3);
          const head = clamp((u - 1) / (END - 1), 0, 1);
          /* ENTRAINMENT IS THE SHAPE: a mouth the size of the vent, growing
             ~0.2 m of radius per metre climbed, then a broad turbulent cap. */
          const axisR = (r0 + 0.2 * hh * height) * (1 + 0.85 * head);
          const lean = height * 0.27 * hh * hh * P.wind;
          // A slow helical roll belongs to convection; nothing is added to
          // world position as a sinusoid, so no puff bounces on a fixed seat.
          const drift = P.ang + hh * 0.72 + t * (0.018 + P.spin * 0.08);
          const radial = axisR * P.rr * (1 + head * (P.role === 2 ? 0.34 : 0.12));
          const capLift = head * height * (0.03 + 0.05 * Math.sin(P.ph));
          const py = baseY + hh * height + capLift;
          P.m.position.set(
            x + Math.cos(drift) * radial + bx * lean,
            py,
            z + Math.sin(drift) * radial + bz * lean
          );
          // sized off the LOCAL radius: overlap depth is scale-free, so the
          // burp and the big one are both masses rather than strings
          const sc = axisR * (0.52 + 0.44 * P.sz) * (1 + 0.16 * head);
          P.m.scale.set(sc * P.aspect, sc * (1.12 - (P.aspect - 0.74) * 0.3), 1);
          // BORN AT THE CRATER — full inside ~2 % of the rise (about 2 m),
          // behind the vent apron and the fountain
          const born = clamp(u / 0.016, 0, 1);
          const dying = u < 1.2 ? 1 : clamp((END - u) / (END - 1.2), 0, 1);
          P.m.material.opacity = P.maxOp * born * dying;
          P.m.material.rotation += P.spin * dt;
          // ---- the light on the soot, baked per puff ----
          const col = P.m.material.color;
          ramp3(hh, CH_BASE, CH_BODY, CH_CROWN, col);
          if (night > 0) col.lerp(C_NIGHT, night * 0.88);
          /* THE SUN SIDE. A convecting head is a solid, and the half of it
             facing the sun is markedly lighter — that one cue is most of
             what makes a plume read as a volume in daylight. */
          if (day > 0.02) {
            const sunSide = (Math.cos(drift) * sd.x + Math.sin(drift) * sd.z) * P.rr;
            if (sunSide > 0) col.lerp(C_SUN, sunSide * day * (0.10 + 0.46 * hh));
          }
          /* AND THE VENT LIGHTS THE FOOT. Fuego by night: the pillar is
             black except for the stretch standing on the crater, which is
             rose-orange from below. */
          const dy = py - baseY;
          if (dy < VENT_REACH) {
            const gk = 1 - dy / VENT_REACH;
            col.lerp(C_VENT, gk * gk * (0.2 + 0.68 * night));
          }
          P.m.visible = P.m.material.opacity > 0.012 && sc > 0.05;
        }
        return handle;
      },
      dispose() {
        if (dead) return;
        dead = true;
        for (let i = 0; i < puffs.length; i++) grp.remove(puffs[i].m);
        parent.remove(grp);
        for (let i = 0; i < mats.length; i++) mats[i].dispose();
        const k = LIVE.column.indexOf(handle); if (k >= 0) LIVE.column.splice(k, 1);
      },
    };
    LIVE.column.push(handle);
    return handle;
  };

  /* ============================================================
     THE LAVA FOUNTAIN — clots on arcs, not orange confetti.

     What stood here was `CBZ.fx.particleCloud({mode:"rise"})`: a few
     hundred identical 0.2 m Points drifting upward at a constant speed.
     Photographed, that is glitter — and it was the ONLY thing between the
     crater and the column, so the most violent 20 m of the whole eruption
     read as static.

     A Strombolian fountain is ballistic. Clots of molten rock leave the
     vent at 20-40 m/s in a narrow cone, follow real parabolas, and fall
     back onto the cone; they leave white-yellow, cool through orange to a
     dull red on the way down, and the big ones go highest and last
     longest. So: real gravity (CBZ.TUNE.gravity), a launch cone, one
     additive glow sprite per clot, and recycle on landing — a clot that
     drops below the ground under itself is relaunched from the mouth.

     Cost is one draw call per clot (r128 draws every Sprite on its own,
     whatever the material), so the population rides the quality budget.
     ============================================================ */
  V.fountain = function (o) {
    o = o || {};
    const parent = o.parent || CBZ.scene;
    const x = +o.x || 0, z = +o.z || 0;
    const baseY = o.y != null ? +o.y : 0;
    const groundAt = typeof o.groundAt === "function" ? o.groundAt : flatGround;
    const mag = clamp(o.mag != null ? +o.mag : 0.5, 0, 1);
    const mouth = o.r > 0 ? +o.r : (1.6 + 2.4 * mag);
    const G = (CBZ.TUNE && CBZ.TUNE.gravity > 0) ? CBZ.TUNE.gravity : 20;
    // muzzle speed: a burp throws 18 m/s, the big one 38 — apex 7 m and 33 m
    const V0 = 18 + 20 * mag;
    /* THE CONE HAS TO BE WIDE ENOUGH TO SEE THROUGH. At 10-15 degrees every
       clot lands on top of its neighbour and the additive stack photographs
       as one orange cauliflower on the summit — a fireball, not a fountain.
       Real Strombolian jets fan 20-30 degrees; that is also the angle at
       which the individual parabolas separate on screen. */
    const CONE = (15 + 12 * mag) * Math.PI / 180;
    const N = qi(56, 132);
    // incandescence, authored as screen bytes and inverted (see screenHex)
    const F_HOT = new THREE.Color(screenHex(255, 246, 214));
    const F_MID = new THREE.Color(screenHex(255, 140, 38));
    const F_OLD = new THREE.Color(screenHex(152, 30, 8));
    const grp = new THREE.Group();
    grp.frustumCulled = false;
    parent.add(grp);
    let seed = (((x * 73856093) | 0) ^ ((z * 19349663) | 0) ^ 0x1d3f77b1) >>> 0;
    const rnd = function () { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    const mats = [], clots = [];
    function launch(P) {
      const a = rnd() * 6.2832, rr = Math.sqrt(rnd()) * mouth;
      P.x = x + Math.cos(a) * rr; P.y = baseY; P.z = z + Math.sin(a) * rr;
      // tilt off vertical inside the cone, thrown roughly outward from the
      // axis so the fan opens the way a jet does instead of crossing itself
      const tilt = CONE * (0.2 + 0.8 * rnd());
      const az = a + (rnd() - 0.5) * 1.5;
      const sp = V0 * (0.48 + 0.64 * rnd());
      const st = Math.sin(tilt);
      P.vx = Math.cos(az) * st * sp;
      P.vy = Math.cos(tilt) * sp;
      P.vz = Math.sin(az) * st * sp;
      P.age = 0;
      P.gy = null;
      // the clots thrown hardest are the big bombs
      P.sz = 0.5 + 1.05 * (0.35 * rnd() + 0.65 * clamp((sp / V0 - 0.48) / 0.64, 0, 1));
      P.tf = Math.max(0.35, 2 * P.vy / G);
    }
    for (let i = 0; i < N; i++) {
      const mat = new THREE.SpriteMaterial({
        map: glowTex(), color: 0xffffff, transparent: true, opacity: 0,
        depthWrite: false, depthTest: true, fog: false,
        blending: THREE.AdditiveBlending,
      });
      mats.push(mat);
      const m = new THREE.Sprite(mat);
      m.renderOrder = 8;
      m.visible = false;
      grp.add(m);
      const P = { m: m, mat: mat, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, age: 0, tf: 1, sz: 1, gy: null, wait: (i / N) * 1.2 };
      launch(P);
      clots.push(P);
    }
    let dead = false, active = 1;
    const handle = {
      kind: "fountain", group: grp, clotCount: N,
      setActive(k) { active = clamp(k == null ? 1 : +k, 0, 1); return handle; },
      update(dt) {
        if (dead) return handle;
        if (!(dt > 0)) return handle;
        if (dt > 0.2) dt = 0.2;
        const live = Math.max(1, Math.round(N * (0.25 + 0.75 * active)));
        for (let i = 0; i < clots.length; i++) {
          const P = clots[i];
          if (i >= live) { P.m.visible = false; continue; }
          if (P.wait > 0) { P.wait -= dt; P.m.visible = false; continue; }
          P.age += dt;
          P.vy -= G * dt;
          P.x += P.vx * dt; P.y += P.vy * dt; P.z += P.vz * dt;
          /* THE GROUND IS ONLY ASKED ONCE PER FLIGHT. A height-field probe
             per clot per frame is a hundred lookups a tick for an answer
             that does not move; the sample is taken the moment a falling
             clot passes the vent lip and kept until it lands. */
          if (P.vy < 0 && P.y < baseY) {
            if (P.gy == null) { try { P.gy = +groundAt(P.x, P.z) || 0; } catch (e) { P.gy = baseY - 30; } }
            if (P.y <= P.gy) { launch(P); P.m.visible = false; continue; }
          }
          const k = clamp(P.age / P.tf, 0, 1);
          // white-yellow -> orange -> dull red, and dimming the whole way
          const col = P.mat.color;
          if (k < 0.42) col.copy(F_HOT).lerp(F_MID, k / 0.42);
          else col.copy(F_MID).lerp(F_OLD, (k - 0.42) / 0.58);
          P.mat.opacity = 0.82 * (1 - 0.6 * k) * clamp(P.age / 0.06, 0, 1);
          /* A CLOT IS MOVING. Stretching the card along the flight — most of
             which is vertical — is the whole difference between a bead and a
             tracer, and it costs one scale component. It relaxes to a round
             lump at the apex, where the clot really has stopped. */
          const s = P.sz * (1 + 0.3 * k);
          const stretch = 1 + 0.55 * clamp(Math.abs(P.vy) / V0, 0, 1);
          P.m.position.set(P.x, P.y, P.z);
          P.m.scale.set(s / Math.sqrt(stretch), s * stretch, 1);
          P.m.visible = true;
        }
        return handle;
      },
      dispose() {
        if (dead) return;
        dead = true;
        for (let i = 0; i < clots.length; i++) grp.remove(clots[i].m);
        parent.remove(grp);
        for (let i = 0; i < mats.length; i++) mats[i].dispose();
        const k = LIVE.fountain.indexOf(handle); if (k >= 0) LIVE.fountain.splice(k, 1);
      },
    };
    census.fountain++;
    LIVE.fountain.push(handle);
    return handle;
  };

  /* ============================================================
     VENT GLOW — the white heart of the mountain.

     In the wide reference photograph (Fuego by night, 2026-08-15) the
     crater is the single brightest thing in the frame: a saturated
     white-yellow spatter apron that the lava threads visibly PORE OUT OF,
     draped over the summit and cooling through orange to darkness at its
     rim. The old build put an ADDITIVE DISC there — a translucent glowing
     coin hovering on the peak, which is both of the forbidden words at
     once (see-through, and geometric).

     This is that apron as honest geometry: an opaque, unlit (= incandescent)
     vertex-coloured fan whose rim radius is hash-lobed per sector — a
     spatter field's coastline, not a circle — with every vertex standing on
     the ground under itself so it drapes the cone tip. White core, orange
     shoulder, near-black rim; one small pooled PointLight so the summit
     paints its own glow onto the crater walls at night.

     Same contract as every other builder here: groundAt + parent in,
     update/dispose/hitTest out, LIVE-registered so the audit can count it.
     ============================================================ */
  V.ventGlow = function (o) {
    o = o || {};
    const parent = o.parent || CBZ.scene;
    const groundAt = o.groundAt || flatGround;
    const x = +o.x || 0, z = +o.z || 0;
    const R = o.r > 0 ? +o.r : 7;
    const salt = o.salt != null ? (o.salt | 0) : 4444;
    const SEC = 20, RINGS = [0.34, 0.62, 1.0];
    const VC = 1 + SEC * RINGS.length;
    const pos = new Float32Array(VC * 3);
    const col = new Float32Array(VC * 3);
    // 1150 C at the throat, dark spatter at the rim — the entire ramp of the
    // reference photograph, in four stops
    const CORE = 0xfff4c8, RING_C = [0xffd677, 0xf07f1d, 0x66180a];
    _c1.setHex(CORE);
    pos[0] = x; pos[1] = groundAt(x, z) + 0.24; pos[2] = z;
    col[0] = _c1.r; col[1] = _c1.g; col[2] = _c1.b;
    for (let r = 0; r < RINGS.length; r++) {
      _c1.setHex(RING_C[r]);
      for (let s = 0; s < SEC; s++) {
        const a = (s / SEC) * Math.PI * 2;
        /* THE RIM IS A COASTLINE. One hashed radius per sector, strongest on
           the outermost ring: the apron throws lobes down whichever flank
           the hash says, and two vents never share an outline. */
        const wob = 0.68 + 0.64 * h01(x + Math.cos(a) * 9, z + Math.sin(a) * 9, salt + r * 17);
        const rr = R * RINGS[r] * (r === RINGS.length - 1 ? wob : (0.86 + 0.28 * (wob - 0.68)));
        const px = x + Math.cos(a) * rr, pz = z + Math.sin(a) * rr;
        const off = (1 + r * SEC + s) * 3;
        pos[off] = px;
        pos[off + 1] = groundAt(px, pz) + 0.2 - r * 0.04;   // drape, thin out
        pos[off + 2] = pz;
        const g2 = 0.9 + 0.2 * h01(px, pz, salt + 5);
        col[off] = _c1.r * g2; col[off + 1] = _c1.g * g2; col[off + 2] = _c1.b * g2;
      }
    }
    const idx = new Uint16Array((SEC + (RINGS.length - 1) * SEC * 2) * 3);
    let ii = 0;
    for (let s = 0; s < SEC; s++) {
      idx[ii++] = 0; idx[ii++] = 1 + s; idx[ii++] = 1 + (s + 1) % SEC;
    }
    for (let r = 0; r < RINGS.length - 1; r++) {
      for (let s = 0; s < SEC; s++) {
        const a = 1 + r * SEC + s, b = 1 + r * SEC + (s + 1) % SEC;
        idx[ii++] = a; idx[ii++] = a + SEC; idx[ii++] = b;
        idx[ii++] = b; idx[ii++] = a + SEC; idx[ii++] = b + SEC;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    // unlit and OPAQUE — incandescence is a material state here, never alpha
    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true, side: THREE.DoubleSide, fog: true,
      polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 3;
    parent.add(mesh);
    let light = null;
    if (o.light !== false) {
      light = new THREE.PointLight(0xff8a2a, 1.8, Math.max(30, R * 6), 2);
      light.castShadow = false;
      light.position.set(x, groundAt(x, z) + 3, z);
      parent.add(light);
      census.lights++;
    }
    let t = 0, dead = false;
    const handle = {
      kind: "vent", mesh: mesh,
      update(dt) {
        if (dead) return handle;
        t += dt;
        // the throat breathes — one uniform, same trick as the melt flicker
        const fl = 0.94 + 0.08 * Math.sin(t * 6.2) + Math.random() * 0.04;
        mat.color.setScalar(clamp(fl, 0.8, 1.12));
        if (light) light.intensity = 1.6 + 0.5 * Math.sin(t * 5.1) + Math.random() * 0.2;
        return handle;
      },
      hitTest(px, pz) { return Math.hypot(px - x, pz - z) < R * 0.5; },
      dispose() {
        if (dead) return;
        dead = true;
        parent.remove(mesh); geo.dispose(); mat.dispose();
        if (light) { parent.remove(light); census.lights--; }
        const k = LIVE.vent.indexOf(handle); if (k >= 0) LIVE.vent.splice(k, 1);
      },
    };
    census.vent++;
    LIVE.vent.push(handle);
    return handle;
  };

  /* ============================================================
     PYROCLASTIC DENSITY CURRENT — the signature killer.

     Real numbers: 400+ mph, 400-700 C, and a bulk density high enough
     that it hugs the ground and pours over ridges instead of rising.
     Nobody in its path survives; there is no cover mechanic and no
     mitigation — the survival verb is EVACUATION, which is why the
     path is drawn along the fall line and telegraphed before it moves.

     THE LOOK — and this is the second thing the owner sent back.

     "there's big rocks looking of smoke, smoke doesn't look like big
     bouncing boulders" (2026-08-13). It did, and the previous note in
     this spot explains exactly why while getting the conclusion wrong:
     the fix for "translucent orange rocks" was OPAQUE LIT GEOMETRY, and
     opaque lit geometry is what a boulder is made of. Four things
     compounded, and every one of them says "rock" on its own:

       a low-poly IcosahedronGeometry(1,1) has a FACETED silhouette, and
       an eye that can count the facets has resolved a solid;
       a Lambert surface takes a hard light/dark terminator, which is how
       you read curvature on a stone and not on a gas;
       rotation.x/y advanced every frame, so each one visibly TUMBLED —
       smoke does not have an axis to tumble about;
       and at 0.22-0.84 of a 26 m half-width they were up to twenty
       metres across, which is individually legible at any distance.

     Smoke in a rasteriser is soft-edged camera-facing billboards, and so
     this is: many overlapping Sprites carrying a cauliflower alpha, no
     lighting term, no tumble, sizes down by roughly half and counts up,
     each one growing and lofting as it ages the way an expanding gas
     does. They stay effectively opaque where the cloud is dense because
     the alpha core is solid and they overlap five deep — so this is not
     a return to the see-through look; it is the same solidity built out
     of soft edges instead of hard ones.

     The one hot colour is still a small basal fringe, and it is now
     ADDITIVE rather than emissive geometry, which is honest: that glow
     is incandescent gas under the front — it is light, not matter.
     ============================================================ */
  /* A DENSITY CURRENT IS PULVERISED ROCK: cool grey-brown, not chocolate,
     and DARK. A Sprite is unlit, so these pigments are the final colour with
     no diffuse term to knock them down — and they go through the renderer's
     output encoding on the way to the screen, which lifts a mid grey most of
     the way to white. The first sprite pass used the old lit-material greys
     unchanged and produced cotton wool. These are picked for where they LAND,
     not for where they read in a swatch. */
  /* THREE TIERS, DARK TO LIT, AND THE PUFF PICKS ITS TIER BY HOW HIGH IT SITS.

     OWNER, 2026-08-13: "smoke still looks 2d". It did, and swapping geometry
     for billboards is exactly the trade that causes it: a Sprite is unlit, so
     every puff in the cloud came out the SAME value no matter where it sat in
     the mass, and a shape with no internal light gradient is a sticker. Real
     smoke is legible as a volume for one reason — the top of it is in the
     light and the underside is in its own shadow, and the eye reconstructs the
     form from that ramp alone.

     So the cloud carries its own lighting, baked: the deep base is nearly
     black, the shoulders are mid, the crown catches the eruption. It costs
     nothing at runtime (the tier is fixed per puff at build) and it is the
     single thing that turns a scatter of discs back into a mass. */
  const PYRO_ASH = [
    0x1a1715, 0x211d1a,   // 0-1  base, in the cloud's own shadow
    0x39322b, 0x433b32,   // 2-3  shoulders
    0x6a5f51, 0x7d7161,   // 4-5  crown, catching the light
  ];
  const PYRO_BODY = 6;              // body materials; the rest are the fringe
  const _puffTex = [];
  /* THE PUFF. A single soft radial gradient is a ball, not a cloud — the
     silhouette has to be irregular at more than one scale before the eye
     stops reading a sphere. One core lobe, a ring of mediums and a scatter
     of smalls, all drawn white so the sprite's own colour tints them. */
  function puffTex(k) {
    if (_puffTex[k]) return _puffTex[k];
    const S = 128, cv = document.createElement("canvas");
    cv.width = cv.height = S;
    const g = cv.getContext("2d");
    let seed = (0x2f6e2b1d + k * 0x9e3779b9) >>> 0;
    const rnd = function () { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    const lobe = function (lx, ly, r, a0) {
      const rg = g.createRadialGradient(lx, ly, 0, lx, ly, r);
      rg.addColorStop(0, "rgba(255,255,255," + a0 + ")");
      rg.addColorStop(0.58, "rgba(255,255,255," + (a0 * 0.8).toFixed(3) + ")");
      rg.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = rg;
      g.beginPath(); g.arc(lx, ly, r, 0, 6.2832); g.fill();
    };
    // the core is deliberately fat: a puff whose alpha dies at a third of its
    // quad leaves visible gaps between neighbours, and gaps are what made the
    // first pass read as separate balls of cotton instead of one mass
    lobe(S * 0.5, S * 0.52, S * 0.36, 1);
    const n = 8 + (k % 3);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * 6.2832 + rnd() * 0.9, d = S * (0.17 + rnd() * 0.12);
      lobe(S * 0.5 + Math.cos(a) * d, S * 0.52 + Math.sin(a) * d, S * (0.15 + rnd() * 0.12), 1);
    }
    for (let i = 0; i < 11; i++) {
      const a = rnd() * 6.2832, d = S * (0.27 + rnd() * 0.13);
      lobe(S * 0.5 + Math.cos(a) * d, S * 0.52 + Math.sin(a) * d, S * (0.06 + rnd() * 0.08), 0.8);
    }
    _puffTex[k] = new THREE.CanvasTexture(cv);
    return _puffTex[k];
  }
  let _pyroMats = null;
  function pyroMats() {
    if (_pyroMats) return _pyroMats;
    _pyroMats = [];
    for (let i = 0; i < PYRO_BODY; i++) {
      _pyroMats.push(new THREE.SpriteMaterial({
        map: puffTex(i % 3), color: PYRO_ASH[i],
        transparent: true, opacity: 1, depthWrite: false, fog: true,
        blending: THREE.NormalBlending, rotation: i * 1.03,
      }));
    }
    // the fringe is a GLOW under the front, not a fire in it — additive and
    // dim, or it turns the base of an ash cloud into a burning haystack
    for (let i = 0; i < 2; i++) {
      _pyroMats.push(new THREE.SpriteMaterial({
        map: puffTex(i), color: i ? 0x9e3806 : 0x6d1f02,
        transparent: true, opacity: 0.5, depthWrite: false, fog: true,
        blending: THREE.AdditiveBlending, rotation: i * 2.1,
      }));
    }
    return _pyroMats;
  }

  V.pyroclastic = function (o) {
    o = o || {};
    const parent = o.parent || CBZ.scene;
    const groundAt = o.groundAt || flatGround;
    const width = o.width > 0 ? +o.width : 26;
    const halfW = width * 0.5;
    const height = o.height > 0 ? +o.height : 20;
    const speed = o.speed > 0 ? +o.speed : 44;    // m/s — 6x a sprinting bot
    const len = o.len > 0 ? +o.len : 150;
    const tail = o.tail > 0 ? +o.tail : 62;
    const salt = o.salt != null ? (o.salt | 0) : 8123;
    const path = fallLine({
      x: o.x, z: o.z, groundAt: groundAt, bearing: o.bearing,
      step: 6, count: Math.ceil(len / 6) + 1, salt: salt, turn: 0.4, wander: 0.1,
    });

    const mats = pyroMats();
    /* DENSITY IS THE POINT, and it is a balance the first sprite pass got
       wrong in the other direction. Too big and hard-edged reads as boulders;
       too small and too few reads as steam, which is what a first cut at
       roughly half the old size produced — a scatter of separate white puffs
       with sky between them. A density current is OPAQUE. So: sizes back up
       (a sprite's alpha core is only ~60% of its quad, where the old
       icosahedron filled a full diameter of TWICE its scale, which is most of
       why the naive size match came out small), and the count up by half
       again so the mass is five deep everywhere instead of one. */
    const N = qi(58, 136);
    const grp = new THREE.Group();
    grp.frustumCulled = false;
    parent.add(grp);
    const blobs = [];
    for (let i = 0; i < N; i++) {
      // the HEAD carries most of the mass: bias lags toward zero
      const lag = Math.pow(Math.random(), 1.7) * tail;
      const basal = i % 8 === 0 && lag < tail * 0.3;
      // how high in the mass this puff rides — and therefore how much light
      // reaches it. Sampled BEFORE the material is chosen, because that is
      // the whole point: the tier is the lighting.
      const hf = basal ? 0.04 + Math.random() * 0.11 : Math.random();
      const tier = Math.min(2, Math.floor(Math.pow(hf, 0.85) * 3));
      const m = new THREE.Sprite(basal ? mats[PYRO_BODY + (i % 2)] : mats[tier * 2 + (i & 1)]);
      m.renderOrder = 7;
      grp.add(m);
      blobs.push({
        m: m, lag: lag, basal: basal, hf: hf,
        lat: (Math.random() * 2 - 1) * 1.1,
        ph: Math.random() * 6.28,
        sz: (basal ? 0.17 : 0.15) + Math.pow(Math.random(), 1.4) * (basal ? 0.17 : 0.42),
      });
    }

    let front = 0, t = 0, dead = false;
    const _v = new THREE.Vector3();

    const handle = {
      kind: "pyro", group: grp, path: path,
      get frontS() { return front; },
      get done() { return front > path.total + tail * 0.4; },
      frontPos() { pathAt(path, Math.min(front, path.total), _v); return { x: _v.x, y: _v.y, z: _v.z }; },
      update(dt) {
        if (dead) return handle;
        t += dt;
        front += speed * dt;
        /* THE CHURN LIVES IN THE MATERIALS. A sprite's rotation is a material
           uniform in r128 (checked: `uniform float rotation` in sprite_vert),
           so per-puff spin would cost a material per puff. Eight materials
           turning at eight rates, shuffled across a hundred puffs, is
           indistinguishable and costs eight uniform writes. Assigned, not
           accumulated, so a second live flow cannot double the rate. */
        for (let i = 0; i < mats.length; i++) mats[i].rotation = i * 1.03 + t * (0.05 + i * 0.016);
        for (let i = 0; i < blobs.length; i++) {
          const B = blobs[i];
          const s = front - B.lag;
          if (s < -4 || s > path.total + 8) { B.m.visible = false; continue; }
          B.m.visible = true;
          pathAt(path, clamp(s, 0, path.total), _v);
          // heading normal so the lateral spread follows the channel
          const fi = clamp(Math.floor(s / path.seg), 0, path.pts.length - 2);
          const a = path.pts[fi], b2 = path.pts[fi + 1];
          let nx = -(b2.z - a.z), nz = (b2.x - a.x);
          const nl = Math.hypot(nx, nz) || 1; nx /= nl; nz /= nl;
          // the cloud SPREADS as it runs out and rises behind the head
          const ageK = clamp(B.lag / Math.max(1, tail), 0, 1);
          const spread = halfW * (0.55 + 0.75 * ageK);
          const churn = 1 + 0.3 * Math.sin(t * 1.9 + B.ph);
          const gy = groundAt(_v.x, _v.z);
          // an expanding gas GROWS as it ages — the single cue that most
          // separates a puff of smoke from an object being carried along
          const sc = width * B.sz * (0.62 + 0.7 * ageK) * (0.92 + 0.13 * Math.sin(t * 1.6 + B.ph));
          B.m.position.set(
            _v.x + nx * B.lat * spread + Math.sin(t * 1.1 + B.ph) * 2.4,
            gy + height * B.hf * (0.22 + 0.95 * ageK) * churn + sc * 0.42,
            _v.z + nz * B.lat * spread + Math.cos(t * 1.3 + B.ph) * 2.4
          );
          B.m.scale.set(sc, sc * (B.basal ? 0.72 : 0.92), 1);
        }
        return handle;
      },
      /* WHAT PART OF THE FLOW IS THIS, and the answer has to be measured
         against the DRAWN cloud, because a hazard that kills outside its own
         picture is the "randomly, not even with physics" the owner reported.

           1  the head — 600 C rock at 130 m/s. No survival, no cover, no
              mitigation; evacuation is the mechanic. This part is not
              negotiable and is not what was wrong.
           2  the trailing ash cloud. STILL LETHAL, but it is hot gas rather
              than a wall of rock, and the caller now prices it as damage
              over time instead of as an instant kill: someone clipped by the
              edge as it sweeps past gets the second and a half it takes to
              fall out of it. That is the difference between a hazard and a
              cull, and the tail is 50-odd metres of the lane.
           0  outside. The leading edge sat 3 m AHEAD of the frontmost drawn
              puff, so the first thing the flow did to anyone in the lane was
              kill them before it arrived. */
      contains(x, z) {
        const c = pathCoord(path, x, z, Math.min(front + 6, path.total));
        if (c.s > front + 1 || c.s < front - tail * 0.9) return 0;
        // the lane widens behind the head, same as the geometry — and stays
        // just inside the puffs' own spread so the picture is the hitbox
        const ageK = clamp((front - c.s) / Math.max(1, tail), 0, 1);
        if (c.perp >= halfW * (0.55 + 0.55 * ageK)) return 0;
        return ageK < 0.42 ? 1 : 2;
      },
      // 0..1 threat for the bot flee field / minimap, ahead of the front too
      threatAt(x, z) {
        const c = pathCoord(path, x, z, path.total);
        const lane = c.perp < halfW * 1.35 ? 1 - c.perp / (halfW * 1.35) : 0;
        if (!lane) return 0;
        const ahead = c.s - front;
        if (ahead < -tail) return 0;
        return clamp(lane * (ahead < 0 ? 1 : 1 - ahead / 90), 0, 1);
      },
      dispose() {
        if (dead) return;
        dead = true;
        // the puff materials and their textures are module-shared and outlive
        // every individual flow — remove the sprites, never dispose the mats
        for (let i = 0; i < blobs.length; i++) grp.remove(blobs[i].m);
        parent.remove(grp);
        const k = LIVE.pyro.indexOf(handle); if (k >= 0) LIVE.pyro.splice(k, 1);
      },
    };
    census.pyro++;
    LIVE.pyro.push(handle);
    return handle;
  };

  /* ============================================================
     LAHAR — wet concrete down the valley.

     Ash + meltwater at roughly the density and behaviour of setting
     concrete: it does not splash and it is not translucent, so the
     material is a MATTE Lambert with a chunky flat-shaded surface and
     NO specular story at all. It carries what it has already destroyed
     (boulders and logs riding the surface), it moves at river speed
     rather than avalanche speed, and when it stops it does not drain —
     it SETS, which is why harden() leaves the mesh in the world as a
     permanent grey scar instead of disposing it.
     ============================================================ */
  const LAHAR_COLS = 7;
  const LAHAR_U = [-1, -0.68, -0.32, 0, 0.32, 0.68, 1];

  V.lahar = function (o) {
    o = o || {};
    const parent = o.parent || CBZ.scene;
    const groundAt = o.groundAt || flatGround;
    const width = o.width > 0 ? +o.width : 12;
    const halfW = width * 0.5;
    const len = o.len > 0 ? +o.len : 110;
    const speed = o.speed > 0 ? +o.speed : 11;    // river speed, not avalanche
    const salt = o.salt != null ? (o.salt | 0) : 2609;
    const seg = Math.max(3.5, width * 0.7);
    // channel:true — a lahar hunts the VALLEY, it does not run the fall line
    const path = fallLine({
      x: o.x, z: o.z, groundAt: groundAt, bearing: o.bearing,
      step: seg, count: Math.ceil(len / seg) + 1, salt: salt, channel: true, wander: 0.1,
    });
    const N = path.pts.length;

    const wProf = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const p = path.pts[i];
      wProf[i] = 0.62 + 0.55 * (i / (N - 1)) + 0.3 * h01(p.x, p.z, salt + 3);
    }

    const pos = new Float32Array(N * LAHAR_COLS * 3);
    const col = new Float32Array(N * LAHAR_COLS * 3);
    const idx = new Uint16Array(Math.max(1, (N - 1) * (LAHAR_COLS - 1) * 6));
    let ii = 0;
    for (let i = 0; i < N - 1; i++) {
      for (let c = 0; c < LAHAR_COLS - 1; c++) {
        const a = i * LAHAR_COLS + c, b2 = a + 1, d = a + LAHAR_COLS, e = d + 1;
        idx[ii++] = a; idx[ii++] = d; idx[ii++] = b2;
        idx[ii++] = b2; idx[ii++] = d; idx[ii++] = e;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    // Phong, not Lambert — see the crust material: r128 ignores flatShading
    // on Lambert, and a smooth mud river reads as a tarmac ramp.
    const mat = new THREE.MeshPhongMaterial({
      vertexColors: true, flatShading: true, shininess: 0, specular: 0x000000,
      side: THREE.DoubleSide,
      // same neutral floor the ash deposit uses, and for the same reason: an
      // eruption's sun is 0xff6a3a and mud is not peach
      emissive: 0x14161a, emissiveIntensity: 1,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.receiveShadow = true;
    mesh.renderOrder = 2;
    parent.add(mesh);

    // ---- the freight: boulders and logs riding the surface ----
    const rideN = o.debris === false ? 0 : qi(3, 11);
    const bGeo = new THREE.DodecahedronGeometry(1, 0);
    const lGeo = new THREE.CylinderGeometry(0.34, 0.4, 4.4, 6);
    const bMat = new THREE.MeshPhongMaterial({ color: 0x585047, flatShading: true, shininess: 0, specular: 0x000000 });
    const lMat = new THREE.MeshPhongMaterial({ color: 0x4a3a28, flatShading: true, shininess: 0, specular: 0x000000 });
    const riders = [];
    for (let i = 0; i < rideN; i++) {
      const log = i % 3 === 2;
      const m = new THREE.Mesh(log ? lGeo : bGeo, log ? lMat : bMat);
      const sc = log ? 1 : 0.7 + Math.random() * 1.5;
      m.scale.setScalar(sc);
      m.visible = false;
      parent.add(m);
      riders.push({
        m: m, s: -Math.random() * len * 0.5, lat: (Math.random() * 2 - 1) * 0.7,
        ph: Math.random() * 6.28, spin: (Math.random() - 0.5) * 1.6, log: log,
        v: speed * (0.75 + Math.random() * 0.4),
      });
    }

    let adv = seg, t = 0, dead = false, hardT = -1;
    const _v = new THREE.Vector3();

    function writeStations(to) {
      const setK = hardT >= 0 ? clamp(hardT / 4, 0, 1) : 0;
      for (let i = 0; i <= to && i < N; i++) {
        const p = path.pts[i];
        const hw = halfW * wProf[i];
        const a = path.pts[Math.max(0, i - 1)], b2 = path.pts[Math.min(N - 1, i + 1)];
        let nx = -(b2.z - a.z), nz = (b2.x - a.x);
        const nl = Math.hypot(nx, nz) || 1; nx /= nl; nz /= nl;
        // a travelling chunky wave down the channel — wet concrete heaves,
        // it does not ripple. Frozen once the deposit sets.
        const heave = setK >= 1 ? 0 : Math.sin(t * 2.1 - i * 0.8) * 0.32 * (1 - setK);
        for (let c = 0; c < LAHAR_COLS; c++) {
          const u = LAHAR_U[c], off = (i * LAHAR_COLS + c) * 3;
          const au = Math.abs(u);
          const x = p.x + nx * u * hw, z = p.z + nz * u * hw;
          pos[off] = x; pos[off + 2] = z;
          const lumps = (h01(x, z, salt + 9) - 0.5) * 0.9;
          pos[off + 1] = p.y + 0.08 + (0.75 + 0.7 * (1 - au * au)) + heave * (1 - au) + lumps;
          /* WET CONCRETE, and concrete is MID grey — the first pass was almost
             black and read as a dirt road at any distance. The set deposit is
             paler and dustier still, which is what makes the scar legible
             after the event. */
          const grain = 0.85 + 0.3 * h01(x, z, salt + 17);
          ramp3(clamp(0.25 + 0.5 * (1 - au) + setK * 0.8, 0, 1), 0x453d35, 0x655c4f, 0x968d81, _c3);
          col[off] = _c3.r * grain;
          col[off + 1] = _c3.g * grain;
          col[off + 2] = _c3.b * grain;
        }
      }
    }
    writeStations(1);
    geo.computeVertexNormals();     // once, so the attribute exists

    const handle = {
      kind: "lahar", mesh: mesh, path: path,
      get length() { return adv; },
      get hardened() { return hardT >= 4; },
      update(dt) {
        if (dead) return handle;
        t += dt;
        if (hardT >= 0) hardT += dt;
        else adv = Math.min(len, adv + speed * dt);
        const st = Math.min(N - 1, Math.floor(adv / seg) + 1);
        writeStations(st);
        geo.attributes.position.needsUpdate = true;
        geo.attributes.color.needsUpdate = true;
        geo.setDrawRange(0, Math.max(0, st) * (LAHAR_COLS - 1) * 6);
        // no computeVertexNormals() — flatShading rebuilds the normal from
        // screen-space derivatives in r128 and never reads the attribute.
        // Same finding as the lava crust; see V.lavaFlow's update().
        for (let i = 0; i < riders.length; i++) {
          const R = riders[i];
          if (hardT < 0) {
            R.s += R.v * dt;
            if (R.s > adv - seg) R.s = Math.max(0, R.s - adv * 0.75);
          }
          if (R.s < 0.5 || R.s > adv) { R.m.visible = false; continue; }
          pathAt(path, R.s, _v);
          const fi = clamp(Math.floor(R.s / seg), 0, N - 2);
          const a = path.pts[fi], b2 = path.pts[fi + 1];
          let nx = -(b2.z - a.z), nz = (b2.x - a.x);
          const nl = Math.hypot(nx, nz) || 1; nx /= nl; nz /= nl;
          R.m.visible = true;
          R.m.position.set(
            _v.x + nx * R.lat * halfW * 0.72,
            _v.y + 0.75 + (hardT >= 0 ? 0 : 0.22 * Math.sin(t * 2.6 + R.ph)),
            _v.z + nz * R.lat * halfW * 0.72
          );
          if (hardT < 0) {
            R.m.rotation.x += R.spin * dt;
            R.m.rotation.z += R.spin * 0.7 * dt;
          }
        }
        return handle;
      },
      // in the channel? returns null or {depth, dirx, dirz} — the DRAG the
      // caller applies with CBZ.body.hit, and the crush it prices with hurt
      hitTest(x, z) {
        if (hardT >= 0) return null;
        const c = pathCoord(path, x, z, adv);
        if (c.s < 0 || c.s > adv) return null;
        const i = clamp(Math.round(c.s / seg), 0, N - 1);
        const hw = halfW * wProf[i];
        if (c.perp > hw) return null;
        const a = path.pts[Math.max(0, i - 1)], b2 = path.pts[Math.min(N - 1, i + 1)];
        let dx = b2.x - a.x, dz = b2.z - a.z;
        const dl = Math.hypot(dx, dz) || 1;
        return { depth: (1 - c.perp / hw) * 1.5, dirx: dx / dl, dirz: dz / dl, s: c.s };
      },
      // it SETS. Nothing drains away; the valley keeps the scar.
      harden() { if (hardT < 0) hardT = 0; return handle; },
      dispose() {
        if (dead) return;
        dead = true;
        parent.remove(mesh); geo.dispose(); mat.dispose();
        for (let i = 0; i < riders.length; i++) parent.remove(riders[i].m);
        bGeo.dispose(); lGeo.dispose(); bMat.dispose(); lMat.dispose();
        const k = LIVE.lahar.indexOf(handle); if (k >= 0) LIVE.lahar.splice(k, 1);
      },
    };
    census.lahar++;
    LIVE.lahar.push(handle);
    return handle;
  };

  /* ============================================================
     ASHFALL WITH WEIGHT — accumulation, not weather.

     systems/weather.js already owns falling ash as an atmospheric
     term. What it cannot express is the thing that actually kills:
     ash LANDS, it does not wash off, and half a metre of it on a flat
     roof is several hundred kilograms per square metre. So this is a
     LEDGER with a picture attached — a grid of cells, each holding a
     depth in metres, each drawing a quad whose COVERAGE (not opacity)
     grows with that depth. That way the blanket creeps downwind out of
     nothing, the sheet is genuinely OPAQUE where there is ash, and
     there is no sheet at all where there is not.

     Roof cells are the same array with a caller-supplied y, so
     `roofDepth(id)` hands the disaster the number it prices through
     the structural ledger. This file never touches structural.js.
     ============================================================ */
  V.ashLoad = function (o) {
    o = o || {};
    const parent = o.parent || CBZ.scene;
    const groundAt = o.groundAt || flatGround;
    const cx = +o.cx || 0, cz = +o.cz || 0;
    const R = o.r > 0 ? +o.r : 120;
    /* CELL SIZE IS THE WHOLE LOOK. At 26 cells over a 240 m island each patch
       is 9 m across, and a 9 m quad lying on grass reads as a sheet of paper,
       not as ash — the eye resolves the individual quad. At ~70 cells the
       patches are ~3 m, small enough to read as deposit and numerous enough
       to weld into a continuous blanket where the fall has been heavy. The
       cost is paid by throttling: accumulation and the geometry rewrite share
       one 8 Hz tick, so 5000 cells cost the same per second as 700 did. */
    const NC = Math.max(6, Math.min(96, Math.round(o.cells || qi(40, 76))));
    const cell = (R * 2) / NC;
    const salt = o.salt != null ? (o.salt | 0) : 6151;
    // how much ash makes the ground READ as covered (a few cm)
    const FULL = o.full > 0 ? +o.full : 0.05;
    /* WHERE A DRIFT STARTS. In units of FULL, against the cell's own mottle
       and slope-shed factors, so the threshold picks out the lees and
       hollows the smooth noise field already favours rather than cutting a
       circle out of the wedge. 0.90 -> nothing is drawn until the ground
       under it already reads as blanketed by the veil (the veil saturates at
       exactly depth == FULL), and the span to full drift is another 1.4
       blanket depths on top. */
    const DRIFT_ON = 0.90, DRIFT_SPAN = 1.4;

    /* SMOOTH MOTTLE, NOT PER-CELL DICE. The 2026-08-23 build hashed an
       independent `gain` per cell — which is NOISE AT EXACTLY GRID FREQUENCY,
       the strongest checkerboard signal a grid can emit. OWNER, 2026-08-29:
       "like a CHECKERBOARD of ash ... so fucking dumb it's funny." The mottle
       is now a smooth value-noise FIELD sampled at each cell: neighbours
       agree, blotches span several cells, and the deposit reads as drifts
       and lees instead of a tiled atlas. */
    function vnoise(x, z, wl, s2) {
      const gx = Math.floor(x / wl), gz = Math.floor(z / wl);
      let fx = x / wl - gx, fz = z / wl - gz;
      fx = fx * fx * (3 - 2 * fx); fz = fz * fz * (3 - 2 * fz);
      const a = h01(gx, gz, s2), b = h01(gx + 1, gz, s2);
      const c = h01(gx, gz + 1, s2), d2 = h01(gx + 1, gz + 1, s2);
      return a + (b - a) * fx + (c - a) * fz + (a - b - c + d2) * fx * fz;
    }
    const cells = [];
    // i*NC+j -> cell index, so depthAt() is O(1) instead of a scan over ~500
    // cells per actor per frame (the ash DOT asks once per actor per tick).
    // (The DRAWN patch is jittered off the lattice below; the ledger keeps the
    // lattice for O(1) lookup — half a cell of disagreement between where the
    // grit chokes you and where the patch is painted is under 2 m.)
    const grid = new Int32Array(NC * NC).fill(-1);
    for (let i = 0; i < NC; i++) {
      for (let j = 0; j < NC; j++) {
        const x = cx - R + (i + 0.5) * cell;
        const z = cz - R + (j + 0.5) * cell;
        if (Math.hypot(x - cx, z - cz) > R * 1.02) continue;
        grid[i * NC + j] = cells.length;
        /* THE GRID MUST NOT BE A GRID AT ALL. Hashed rotation and size jitter
           (the old fix) still left every patch CENTRED on its lattice point —
           a periodic array of similar blobs is a checkerboard no matter how
           each blob is dressed. The centres themselves now leave the lattice:
           +-45% of a cell each way, which is enough to destroy the visible
           periodicity while every centre stays inside reach of its own cell's
           ledger entry. */
        const jx = x + (h01(x, z, salt + 61) - 0.5) * cell * 0.9;
        const jz = z + (h01(x, z, salt + 67) - 0.5) * cell * 0.9;
        const ang = h01(x, z, salt + 71) * Math.PI * 0.5;
        // wide size spread: patches that are all one size read as leopard
        // print no matter how organic each individual outline is
        const jit = 0.58 + 0.92 * h01(x, z, salt + 89);
        const n1 = vnoise(jx, jz, cell * 4.8, salt + 103);
        const n2 = vnoise(jx, jz, cell * 1.9, salt + 131);
        const C = {
          x: jx, z: jz, y: 0, w: cell, d: cell, depth: 0, roof: false,
          ang: ang, jit: jit, probed: false, cy: null,
          // peakD: the most ash this cell ever held — the wear pass below
          // reads it to know a patch is ERODING (and should streak downwind)
          // rather than still accumulating. shed: slope factor, set on probe.
          peakD: 0, shed: 1,
          // two octaves of the smooth field: broad drifts + local texture
          gain: 0.42 + 1.15 * (0.62 * n1 + 0.38 * n2),
        };
        cells.push(C);
      }
    }
    const groundCells = cells.length;
    const MAXC = groundCells + Math.max(0, o.roofs || 64);

    const pos = new Float32Array(MAXC * 4 * 3);
    const col = new Float32Array(MAXC * 4 * 3);
    // r128 will happily build a Uint16 index that silently wraps past 65535
    // and draws garbage; at ~4 m cells over a big region that is reachable.
    const idx = MAXC * 4 > 65535 ? new Uint32Array(MAXC * 6) : new Uint16Array(MAXC * 6);
    for (let i = 0; i < MAXC; i++) {
      const v = i * 4, k = i * 6;
      idx[k] = v; idx[k + 1] = v + 2; idx[k + 2] = v + 1;
      idx[k + 3] = v; idx[k + 4] = v + 3; idx[k + 5] = v + 2;
    }
    /* EVERY ASH QUAD'S NORMAL POINTS UP, and it keeps pointing up now that the
       quads themselves drape the terrain. That is deliberate, not leftover: a
       deposit is a thin dust layer whose micro-surface faces the sky whatever
       it is lying on, so lighting it off the slope beneath would make the
       blanket read as painted-on rock. It also means the constant is still a
       constant — written once here, and the update path never calls
       computeVertexNormals() again, which was the single most expensive thing
       in the ash field before. */
    const nrm = new Float32Array(MAXC * 4 * 3);
    for (let i = 1; i < nrm.length; i += 3) nrm[i] = 1;
    // UVs are constant too — the patch shape lives in the alpha cutout, and
    // every quad maps the whole texture once
    const uvs = new Float32Array(MAXC * 4 * 2);
    for (let i = 0; i < MAXC; i++) {
      const u = i * 8;
      uvs[u] = 0; uvs[u + 1] = 0;
      uvs[u + 2] = 1; uvs[u + 3] = 0;
      uvs[u + 4] = 1; uvs[u + 5] = 1;
      uvs[u + 6] = 0; uvs[u + 7] = 1;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    /* OPAQUE. Ash is a solid deposit; the fade-in is coverage, not alpha.
       The small cool emissive is not decoration: an eruption drives the scene
       sun to 0xff6a3a, and a purely diffuse grey under an orange sun comes out
       peach. Volcanic ash is grey in every photograph ever taken of it, so a
       neutral floor under the diffuse term keeps it grey while still letting
       the eruption light it. */
    const mat = new THREE.MeshLambertMaterial({
      vertexColors: true, side: THREE.DoubleSide,
      // ALPHA CUTOUT, NOT BLENDING. alphaTest keeps the deposit genuinely
      // opaque — no transparency sorting over thousands of overlapping quads,
      // no seams where two patches darken each other — while the texture
      // gives every patch an eroded outline instead of four straight edges.
      map: ashTex(), alphaTest: 0.45, transparent: false,
      /* THE NEUTRAL FLOOR HAS TO STAY TINY, and this is why: emissive is
         SELF-LIT. Raised far enough to cancel the eruption's orange cast by
         day, it also ignores the day cycle — so a midnight island came out
         covered in pale grey blobs glowing on black ground. The tint is
         fought with PIGMENT instead (the colours below are blue-shifted so an
         orange sun lands them neutral), and the emissive is back to being
         what it was for: keeping deep shadow off pure black. */
      emissive: 0x090b0e, emissiveIntensity: 1,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.receiveShadow = false;
    mesh.renderOrder = 1;
    parent.add(mesh);

    let dirty = true, wT = 0, peak = 0, dead = false;
    // the last wind the field was given — the erosion pass combs streaks
    // along it (writeCell's angW). Radians, world XZ bearing.
    let windAng = 0;
    /* THE LAST SUPPLY WEDGE. The aftermath has to keep painting the SAME
       downwind sector on the ground long after the plume stopped feeding
       this field (systems/weather.js's ash veil is a driven term and bleeds
       out in 3.5 s if nobody asserts it) — and the only place that knows the
       shape is the tick that was fed it. Null until the first supply. */
    let lastWedge = null;
    /* ---- THE DEPOSIT LIES ON THE GROUND — AND THE PROBES ARE AMORTISED. --
       OWNER, 2026-08-13: "ash is the worst, theres random cubes and floating
       flat gray squares all around". The cure was corner-accurate draping:
       each quad corner stands on the ground under ITSELF, probed once, and
       coverage only lerps along that fixed diagonal — no per-frame cost.

       What moved (2026-08-23): WHEN the probing happens. Five probes for
       each of ~5800 cells inside the constructor was ~29k height-field
       calls in the same tick that also builds the column, five lava flows
       and the vent apron — the measured eruption-start spike. The probes
       now run in budgeted batches inside the first few update ticks; an
       unprobed cell draws nothing (its quad collapses to a point), which
       costs no look because ash takes seconds to land anywhere anyway. The
       depth ledger never waits: accumulation and depthAt() work on unprobed
       cells from tick one. ------------------------------------------------ */
    let probeCursor = 0;
    function probeCell(n) {
      const C = cells[n];
      if (C.roof || C.probed) return;
      C.probed = true;
      C.y = groundAt(C.x, C.z);
      const hw0 = C.w * 0.78 * C.jit, ca = Math.cos(C.ang), sa = Math.sin(C.ang);
      const ox = [-hw0, hw0, hw0, -hw0], oz = [-hw0, -hw0, hw0, hw0];
      C.cy = new Float32Array(4);
      for (let k = 0; k < 4; k++) {
        C.cy[k] = groundAt(C.x + ox[k] * ca - oz[k] * sa, C.z + ox[k] * sa + oz[k] * ca);
      }
      /* STEEP GROUND SHEDS ASH. Real deposits sit in lees and hollows and
         thin out on faces — read the slope off the corners this probe just
         paid for, and let it scale the VISUAL coverage (the damage ledger
         keeps the raw depth: grit in the air chokes you on a slope too). */
      let lo = C.cy[0], hi = C.cy[0];
      for (let k = 1; k < 4; k++) { const v = C.cy[k]; if (v < lo) lo = v; if (v > hi) hi = v; }
      const slope = (hi - lo) / Math.max(0.5, hw0 * 2);
      C.shed = clamp(1 - (slope - 0.18) * 1.3, 0.3, 1);
    }

    function writeCell(n) {
      const C = cells[n];
      if (!C.roof && !C.probed) {
        // not yet seated on the ground: draw nothing (zero-area quad)
        const v0 = n * 4 * 3;
        for (let k = 0; k < 4; k++) {
          pos[v0 + k * 3] = C.x; pos[v0 + k * 3 + 1] = C.y; pos[v0 + k * 3 + 2] = C.z;
        }
        return;
      }
      /* ---- QUADS ARE DRIFTS NOW, NOT THE DEPOSIT ----------------------
         OWNER, 2026-09-01, photographed: "a LEOPARD PRINT — hundreds of
         near-identical grey amoeba blobs on bright green grass". Every fix
         before this one dressed the blobs — jittered centres, smooth mottle,
         wide size spread, wind-combed streaks — and every one of them was
         treating a coverage problem as a shape problem. A quad field CANNOT
         express a veil: at partial coverage it is by construction a scatter
         of separate patches, and a real ashfall's first hour is a continuous
         film that dims and desaturates everything downwind without having a
         shape at all. That film is now the ground's own shader (the ash term
         in systems/weather.js's surface coat, driven off THIS ledger's peak
         through the same wedge maths), and these quads do the one job they
         were always right for: the DRIFTS that stand proud of it where the
         deposit is genuinely deep.

         So a ground cell draws nothing until it holds most of a blanket
         depth, and above that the patch is already near cell-width — it
         goes straight to welding with its neighbours instead of spending
         the interesting range as an isolated fleck. Roofs are untouched:
         their quad IS the roof-load picture the structural ledger prices,
         and it has to appear with the first centimetre. */
      const raw = (C.depth / FULL) * (C.roof ? 1 : (C.gain || 1) * (C.shed || 1));
      const cov = C.roof ? clamp(raw, 0, 1) : clamp((raw - DRIFT_ON) / DRIFT_SPAN, 0, 1);
      /* NO ASH, NO PATCH. The old floor (`grow = 0.28 + ...`) drew a >=1 m
         dark quad on EVERY ground cell from the moment the field was built —
         a permanent lattice of grey flecks over the whole island, upwind
         included, that outlived the eruption. That lattice IS the owner's
         checkerboard-over-the-map. Zero coverage now draws zero. */
      if (cov < 0.02) {
        // roofs included: an unloaded roof wore the same 28%-size dark patch
        const v0 = n * 4 * 3;
        for (let k = 0; k < 4; k++) {
          pos[v0 + k * 3] = C.x; pos[v0 + k * 3 + 1] = C.y; pos[v0 + k * 3 + 2] = C.z;
        }
        return;
      }
      // quads grow from a point at their cell centre; neighbours overlap at
      // full coverage, which is what welds them into one blanket
      const jit = C.roof ? 1 : (C.jit || 1);
      /* At full coverage the patch is WIDER than its cell so neighbours weld.
         The alpha cutout eats ~20% of the quad, so the geometry has to
         overshoot for the deposit to close up. */
      const grow = C.roof ? 0.28 + 0.72 * cov : 0.62 + 0.42 * cov;
      /* THE WIND WORKS THE DEPOSIT INTO STREAKS. A cell that is ERODING
         (depth below the most it ever held) stretches along the wind and
         narrows across it, and its hashed rotation walks over to the wind
         bearing — so a thinning field reads as wind-combed lees and tails,
         not as the same dots politely getting smaller. */
      const wornK = (!C.roof && C.peakD > 0.012)
        ? clamp(1 - C.depth / C.peakD, 0, 1) : 0;
      let angW = C.roof ? 0 : (C.ang || 0);
      if (wornK > 0.01) {
        let dA = windAng - angW;
        dA -= Math.PI * Math.round(dA / Math.PI);   // quads are pi-symmetric
        angW += dA * wornK;
      }
      const hw = C.w * 1.05 * grow * jit * (1 + 0.75 * wornK);
      const hd = C.d * 1.05 * grow * jit * (1 - 0.5 * wornK);
      /* The deposit stands a FEW CENTIMETRES proud of what it covers — it is
         a layer of dust, not a plinth. The old 0.6 x depth lift was reading
         the ledger's metres as if they were the sheet's own thickness. */
      const lift = (C.roof ? 0.03 : 0.02) + Math.min(0.3, C.depth) * 0.15;
      const v = n * 4 * 3;
      // roofs keep their footprint; ground patches spin on their own hash,
      // combed toward the wind as they erode (angW above)
      const ca = C.roof ? 1 : Math.cos(angW), sa = C.roof ? 0 : Math.sin(angW);
      const qx = [-hw, hw, hw, -hw], qz = [-hd, -hd, hd, hd];
      for (let k = 0; k < 4; k++) {
        pos[v + k * 3] = C.x + qx[k] * ca - qz[k] * sa;
        // drape: the corner rides from the cell centre out to its own ground
        // as the patch grows. Roofs are flat, so they keep one height.
        pos[v + k * 3 + 1] = (C.cy ? C.y + (C.cy[k] - C.y) * cov : C.y) + lift;
        pos[v + k * 3 + 2] = C.z + qx[k] * sa + qz[k] * ca;
      }
      /* A THIN DUSTING IS NOT A WHITE PATCH. Coverage alone gave every fleck
         the full deposit colour the moment it existed, so the first minute of
         ashfall looked like confetti on a lawn. A film of ash a millimetre
         thick is mostly the ground you can still see through it, so the colour
         walks from a dark, dirty film up to the pale grey blanket as the
         deposit builds — and then back DOWN as it goes deep and damp. */
      const deep = clamp(C.depth / 0.35, 0, 1);
      const grain = 0.86 + 0.2 * h01(C.x, C.z, salt);
      // cooler and a stop darker than the first pass: an eruption drives the
      // scene sun to 0xff6a3a, and pale warm grey under that comes out pink
      /* AND IT IS DARK — DARKER THAN THE LAST DARKENING. The reference cone
         is BLACK, and the 2026-08-15 report still photographed a pale
         lavender mountain: the previous stops were picked in a swatch, and
         the output encoding plus the eruption's own pooled lights lifted
         them to the "snow-covered volcano" the owner keeps seeing. Fresh
         basaltic fall is near-black scoria; these stops are authored a full
         step below where they should read, the same trick the melt ramp
         learned, so the screen lands on dark rock and the cone the flows
         thread down is finally the photograph's. */
      // blue-shifted on purpose: these are multiplied by a warm sun, and an
      // albedo picked to look grey in a swatch comes out pink on the ground
      if (C.roof) {
        // ROOFS KEEP THE OLD RAMP. A roof quad is the load gauge — it has to
        // read as "something is piling up here" from the first centimetre,
        // dark against a pale roof, and it is not standing on a veil.
        _c3.setHex(0x191b1d).lerp(_c1.setHex(0x33363a), Math.min(1, cov * 1.15));
        _c3.lerp(_c1.setHex(0x212325), deep * 0.7);
      } else {
        /* A DRIFT STARTS AS THE VEIL AND ENDS PALER THAN IT. The bottom stop
           is the ash term's own colour in systems/weather.js, so a patch
           coming into existence at cov 0 is invisible against the ground it
           is standing on — no popping outline, no fleck — and it walks up to
           a pale deposit as it deepens, which is the only thing that makes a
           drift read as raised rather than as a stain. Blue-shifted for the
           same reason every other stop in this file is: the eruption's sun
           is 0xd9714a and a neutral grey under it comes out pink. */
        _c3.setHex(0x33363a).lerp(_c1.setHex(0x585d66), cov);
        // ...and back down a stop when it goes deep and damp
        _c3.lerp(_c1.setHex(0x3d4149), deep * 0.5);
      }
      for (let k = 0; k < 4; k++) {
        col[v + k * 3] = _c3.r * grain;
        col[v + k * 3 + 1] = _c3.g * grain;
        col[v + k * 3 + 2] = _c3.b * grain;
      }
    }
    for (let n = 0; n < cells.length; n++) writeCell(n);
    geo.setDrawRange(0, cells.length * 6);

    const handle = {
      kind: "ash", mesh: mesh, cell: cell,
      // {srcX,srcZ,ux,uz,reach,lobe,spread} of the last fall this field was
      // fed — how the aftermath keeps the ground veil on the right sector
      get wedge() { return lastWedge; },
      get peakDepth() { return peak; },
      get cellCount() { return cells.length; },
      /* spec: { rate (m/s at the plume axis), windX, windZ, srcX, srcZ,
                 spread (0..1 how much falls off-axis),
                 lobe (downwind cosine exponent, default 2.2 — higher = a
                 tighter wedge; the V3 caller raises it so the fall is a
                 sector you can stand outside of, not a map filter),
                 reach (m of downwind carry, default R*0.55 — magnitude),
                 rain (0..1, erosion accelerant when rate is 0) }
         rate <= 0 (or spec omitted) = NO SUPPLY: the field ERODES — see the
         weather-works-on-it branch below. */
      update(dt, spec) {
        if (dead) return handle;
        spec = spec || {};
        /* ONE 8 Hz TICK DOES BOTH JOBS. Accumulation and the geometry rewrite
           are throttled together on the SAME accumulated dt, so the depth
           ledger stays exact (nothing is dropped, it is integrated in bigger
           steps) while ~5000 cells cost what 700 cost at 60 Hz. */
        wT += dt;
        const rate = +spec.rate || 0;
        if (wT < 0.125 && !(rate > 0 && peak === 0)) return handle;
        const step = wT; wT = 0;
        // seat a batch of cells on the ground (see the amortisation note)
        if (probeCursor < groundCells) {
          const lim = Math.min(groundCells, probeCursor + 700);
          for (; probeCursor < lim; probeCursor++) probeCell(probeCursor);
          dirty = true;
        }
        if (rate > 0) {
          const wx = spec.windX != null ? +spec.windX : 1;
          const wz = spec.windZ != null ? +spec.windZ : 0;
          const wl = Math.hypot(wx, wz) || 1;
          const ux = wx / wl, uz = wz / wl;
          windAng = Math.atan2(uz, ux);
          const sx = spec.srcX != null ? +spec.srcX : cx;
          const sz = spec.srcZ != null ? +spec.srcZ : cz;
          const spread = spec.spread != null ? clamp(+spec.spread, 0, 1) : 0.18;
          const lobeP = spec.lobe > 0 ? +spec.lobe : 2.2;
          // how far downwind the fall carries — the caller's magnitude sets
          // it (a burp dusts the cone, the big one reaches the town)
          const reach = spec.reach > 0 ? +spec.reach : R * 0.55;
          lastWedge = lastWedge || {};
          lastWedge.srcX = sx; lastWedge.srcZ = sz;
          lastWedge.ux = ux; lastWedge.uz = uz;
          lastWedge.reach = reach; lastWedge.lobe = lobeP; lastWedge.spread = spread;
          for (let n = 0; n < cells.length; n++) {
            const C = cells[n];
            const dx = C.x - sx, dz = C.z - sz;
            const d = Math.hypot(dx, dz) || 0.001;
            // the DOWNWIND WEDGE: a hard cosine lobe on the wind bearing,
            // plus a small isotropic term for the dusting near the vent
            const dot = (dx * ux + dz * uz) / d;
            const lobe = dot > 0 ? Math.pow(dot, lobeP) : 0;
            const fall = 1 / (1 + (d / reach) * (d / reach));
            const k = (spread + (1 - spread) * lobe) * fall;
            if (k > 0.001) {
              C.depth += rate * k * step;
              if (C.depth > C.peakD) C.peakD = C.depth;
              if (C.depth > peak) peak = C.depth;
            }
          }
          dirty = true;
        } else {
          /* NO SUPPLY -> THE WEATHER WORKS ON IT. OWNER, 2026-08-29: "I'd get
             it being like snow MAYBE for a sec" — a deposit that lies there
             for the rest of the match is wallpaper, not weather. Once the
             plume stops feeding the field, wind strips it and rain washes it:
             a dusting is gone in seconds (the linear term), a deep drift
             wears for a couple of minutes (the proportional term), steep
             ground and roofs clear first, and writeCell above streaks the
             survivors downwind as they thin. The scar tick in
             systems/disasters.js passes {windX, windZ, rain} through here. */
          if (spec.windX != null || spec.windZ != null) {
            const wxE = +spec.windX || 0, wzE = +spec.windZ || 0;
            if (Math.hypot(wxE, wzE) > 0.001) windAng = Math.atan2(wzE, wxE);
          }
          const rainK = spec.rain > 0 ? Math.min(1, +spec.rain) : 0;
          const wear = 1 + 4 * rainK;
          let m = 0, any = false;
          for (let n = 0; n < cells.length; n++) {
            const C = cells[n];
            if (C.depth <= 0) continue;
            const expo = C.roof ? 1.4 : (2 - (C.shed || 1));   // exposed strips faster
            C.depth -= (0.0016 + C.depth * 0.028) * wear * expo * step;
            if (C.depth < 0.0004) C.depth = 0;
            else if (C.depth > m) m = C.depth;
            any = true;
          }
          peak = m;
          if (any) dirty = true;
        }
        if (dirty) {
          dirty = false;
          for (let n = 0; n < cells.length; n++) writeCell(n);
          geo.attributes.position.needsUpdate = true;
          geo.attributes.color.needsUpdate = true;
          geo.setDrawRange(0, cells.length * 6);
        }
        return handle;
      },
      // metres of ash standing on the ground at (x,z). An unprobed cell
      // reports 0 even if the ledger has started filling it: it is not
      // drawn yet, and no picture means no damage (the choke reads this).
      depthAt(x, z) {
        const i = Math.floor((x - (cx - R)) / cell);
        const j = Math.floor((z - (cz - R)) / cell);
        if (i < 0 || j < 0 || i >= NC || j >= NC) return 0;
        const n = grid[i * NC + j];
        if (n < 0 || n >= groundCells) return 0;
        const C = cells[n];
        return C.probed ? C.depth : 0;
      },
      /* A ROOF IS A CELL WITH A CALLER-SUPPLIED CEILING. The disaster hands
         its building rects in once, then reads roofDepth(id) back and prices
         it through the structural ledger — this file never damages anything. */
      addRoof(r) {
        if (!r || cells.length >= MAXC) return -1;
        const id = cells.length;
        cells.push({
          x: +r.x || 0, z: +r.z || 0, y: +r.y || 0,
          w: Math.max(1, +r.w || 4), d: Math.max(1, +r.d || 4),
          depth: 0, roof: true, ref: r.ref || null,
        });
        writeCell(id);
        dirty = true;
        return id;
      },
      roofDepth(id) { const C = cells[id]; return C ? C.depth : 0; },
      roofRef(id) { const C = cells[id]; return C ? C.ref : null; },
      // shed the load (a collapsed roof no longer holds any ash)
      clearCell(id) { const C = cells[id]; if (C) { C.depth = 0; dirty = true; } },
      dispose() {
        if (dead) return;
        dead = true;
        parent.remove(mesh); geo.dispose(); mat.dispose();
        const k = LIVE.ash.indexOf(handle); if (k >= 0) LIVE.ash.splice(k, 1);
      },
    };
    census.ash++;
    LIVE.ash.push(handle);
    return handle;
  };

  /* ============================================================
     CBZ.volcanoAudit() — the ratchet, measured off LIVE objects.

     `lavaTransparent` is the one that matters: it walks every live lava
     mesh's ACTUAL material and counts how many are transparent or
     additively blended. The old streams scored 5; the crust+channel
     build scores 0 by construction, and a future "just make it a bit
     see-through" edit puts the number straight back up where the gate
     can see it.
     ============================================================ */
  CBZ.volcanoAudit = function () {
    let lavaTransparent = 0, lavaMeshes = 0, lavaTris = 0, lavaScars = 0;
    const lavaTips = [], lavaMids = [], lavaScarTips = [], lavaScarMids = [];
    for (let i = 0; i < LIVE.lava.length; i++) {
      const f = LIVE.lava[i];
      // a quenched scar is not a front: cameras and threat maps aiming off
      // lavaTips must frame the rivers that still run, not last event's rock
      // — the scars publish their own pair for anything that wants the rock
      if (f.quenched) { lavaScars++; try { lavaScarTips.push(f.tip); lavaScarMids.push(f.mid); } catch (e) {} }
      else { try { lavaTips.push(f.tip); lavaMids.push(f.mid); } catch (e) {} }
      const ms = [f.mesh, f.channel];
      for (let k = 0; k < ms.length; k++) {
        const m = ms[k]; if (!m || !m.material) continue;
        lavaMeshes++;
        if (m.material.transparent || m.material.blending === THREE.AdditiveBlending) lavaTransparent++;
        const g = m.geometry;
        if (g && g.drawRange) lavaTris += Math.max(0, g.drawRange.count) / 3;
      }
    }
    let pyroBlobs = 0;
    for (let i = 0; i < LIVE.pyro.length; i++) {
      const g = LIVE.pyro[i].group;
      if (g) pyroBlobs += g.children.length;
    }
    let columnPuffs = 0, blastSmokeColumns = 0;
    for (let i = 0; i < LIVE.column.length; i++) {
      const c = LIVE.column[i];
      columnPuffs += c.puffCount || (c.group ? c.group.children.length : 0);
      if (c.usesBlastSmoke) blastSmokeColumns++;
    }
    let fountainClots = 0;
    for (let i = 0; i < LIVE.fountain.length; i++) fountainClots += LIVE.fountain[i].clotCount || 0;
    let ashPeak = 0, ashCells = 0;
    for (let i = 0; i < LIVE.ash.length; i++) {
      ashPeak = Math.max(ashPeak, LIVE.ash[i].peakDepth);
      ashCells += LIVE.ash[i].cellCount;
    }
    return {
      v2: CBZ.CONFIG.VOLCANO_V2 !== false,
      // live rivers only; the kept black flows are lavaScars, so the two
      // numbers stay comparable with builds that deleted flows at the end
      lavaFlows: LIVE.lava.length - lavaScars,
      lavaScars: lavaScars,
      lavaMeshes: lavaMeshes,
      lavaTransparent: lavaTransparent,        // MUST be 0
      lavaOpaque: lavaTransparent === 0,
      lavaTris: Math.round(lavaTris),
      // where the live fronts actually are, AND which way each one runs — so
      // a camera (or a threat map) can aim at the flow instead of guessing a
      // hillside, and can do it without assuming the flow went in a straight
      // line from the vent (it did not; that is what a fall line is for)
      lavaTips: lavaTips,
      lavaMids: lavaMids,
      lavaScarTips: lavaScarTips,
      lavaScarMids: lavaScarMids,
      // the fan: how many live flows are branch children, and the incandescent
      // vent apron count — the two 2026-08-15 reference-photo features as
      // numbers, so the ratchet can see them
      lavaBranches: census.branches,
      ventGlows: LIVE.vent.length,
      ashColumns: LIVE.column.length,
      columnPuffs: columnPuffs,
      blastSmokeColumns: blastSmokeColumns,
      // the ballistic lava fountain (V.fountain) — clots, not Points
      fountains: LIVE.fountain.length,
      fountainClots: fountainClots,
      builtFountain: census.fountain,
      pyroLive: LIVE.pyro.length, pyroBlobs: pyroBlobs,
      laharLive: LIVE.lahar.length,
      ashFields: LIVE.ash.length, ashCells: ashCells,
      ashPeakDepth: +ashPeak.toFixed(3),
      lights: census.lights,
      builtLava: census.lava, builtPyro: census.pyro,
      builtLahar: census.lahar, builtAsh: census.ash, builtVent: census.vent,
    };
  };

  CBZ.volcanoFx = V;
})();
