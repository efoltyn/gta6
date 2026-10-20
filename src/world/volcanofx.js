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

   OWNER, 2026-10-19: "fix magma" and "the ash... looks like 2D blocks...
   like separate clouds coming out of it". Two rebuilds, each with its
   notes at its site:

     THE MELT   is LIT now (Phong + a crack shader, meltMaterial): black-
                grey basalt plates that take the sun, with emissive Voronoi
                cracks that open with heat, tear wide in the fast core and
                at the front, shear along the banks and close as it cools.
     THE SKY    the column and the umbrella are ONE raymarched volume
                (THE PLUME VOLUME, after city/nukefx.js's mushroom cloud):
                no puff cards, no sprite edges, one draw call.

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

   Flags: VOLCANO_PYRO · VOLCANO_LAHAR ·
   VOLCANO_ASH_LOAD. Ratchet: CBZ.volcanoAudit().
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  CBZ.CONFIG = CBZ.CONFIG || {};

  // Each is a genuine one-line revert of one hazard.
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
  const LIVE = { lava: [], pyro: [], lahar: [], ash: [], vent: [], column: [], fountain: [], umbrella: [], bombs: [] };

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
    // how far ahead the fan looks: a step ahead by default; a viscous flow
    // that must find the valley floor looks further (o.probe)
    const probe = Math.max(step * 1.15, o.probe > 0 ? +o.probe : 0);
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
  /* THE MELT RAMP, and it is a TEMPERATURE ramp now, not a brightness ramp:
       A  the dull red of a cooling toe / a dying seam   rgb(143,23,2)
       B  the open channel while it is moving            rgb(219,64,0)
       C  the incandescent lace and the vent apron       rgb(255,180,66)
     C is as far as this ramp goes on purpose: the white-yellow throat is
     ventGlow's, and a melt that reaches white is the pale-gold slab again. */
  const MELT_A = 0x300701, MELT_B = 0x6a1004, MELT_C = 0xd8480f;

  /* ============ THE MELT IS A CRUST WITH CRACKS IN IT ==================
     OWNER, 2026-10-19: "fix magma". What shipped was an unlit orange ribbon
     with a sine-ridge "lace" multiplied into it: every dark part of the flow
     was UNLIT dark orange, so the crust never caught the sun and the whole
     thing read as one glowing strip with a pattern printed on it.

     The reference (Kilauea fissure 8 channel 2018, Fagradalsfjall 2021,
     Etna and Nyiragongo flow fields) is the other way round:
       - the surface is a LID: black-grey basalt crust, LIT like any rock,
         with a dull sheen where it is fresh;
       - what glows is what shows THROUGH it: bright orange-yellow cracks
         between crust plates, wider and hotter where the flow is fast and
         fresh, closing to thin red seams as it cools;
       - the fast middle of a fed channel stays torn open (incandescent,
         with rafts of crust riding it), the margins weld over;
       - the front and the vent are brightest: freshly broken rock;
       - the crust plates shear past each other along the banks.

     So the melt mesh is a lit MeshPhongMaterial now, and the crack network
     is a real cellular field instead of three sines:
       TEXTURE  512^2 tileable Voronoi, R = distance to the nearest plate
                edge (F2 - F1, 0 on a crack), G = a per-plate random,
                B = a finer second generation of cracks inside the plates.
                Built in slices during the warning, like before.
       SHADER   onBeforeCompile on the Phong program. The vertex colour stops
                being a colour and carries three smooth fields: r = heat
                envelope (vent, front, channel core), g = surface speed
                across the channel, b = how cooled this stretch is. Per
                fragment: crack width opens with heat and closes with
                cooling, the core tears open, plate rims glow beside the
                cracks, and the crust is albedo for the scene's own lights.
                Two crack layers crossfade on a 6 s cycle so the plates SHEAR
                (centre faster than banks) without the texture stretching.
     Opaque, as ever: incandescence is emission, never alpha.
     ===================================================================== */
  const LACE_W = 20, LACE_L = 24;       // metres the texture spans
  let _laceTex = null, _lace = null;
  function ihash(i, j, s) {
    let h = (i * 374761393 + j * 668265263 + s * 1274126177) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  // one jittered feature point per cell of a periodic NX x NY grid
  function vorGrid(NX, NY, salt) {
    const n = NX * NY, fx = new Float32Array(n), fy = new Float32Array(n), id = new Float32Array(n);
    for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
      const k = j * NX + i;
      fx[k] = 0.12 + 0.76 * ihash(i, j, salt);
      fy[k] = 0.12 + 0.76 * ihash(i, j, salt + 1);
      id[k] = ihash(i, j, salt + 2);
    }
    return { NX: NX, NY: NY, fx: fx, fy: fy, id: id };
  }
  function laceBegin() {
    const S = 512;
    // plates ~2.2 m across x ~2.7 m along; the fine cracks ~0.9 m
    _lace = { S: S, D: new Uint8Array(S * S * 4), row: 0, A: vorGrid(9, 9, 7101), B: vorGrid(22, 26, 7301) };
  }
  // F2 - F1 (0 on a cell edge) and the nearest cell's random
  const _vor = { e: 0, id: 0 };
  function voronoi(u, v, G) {
    const NX = G.NX, NY = G.NY;
    const iu = Math.floor(u), iv = Math.floor(v);
    let f1 = 9, f2 = 9, id = 0;
    for (let dj = -1; dj <= 1; dj++) {
      const cj = iv + dj, wj = ((cj % NY) + NY) % NY;
      for (let di = -1; di <= 1; di++) {
        const ci = iu + di, k = wj * NX + (((ci % NX) + NX) % NX);
        const ax = ci + G.fx[k] - u, ay = cj + G.fy[k] - v;
        const d = ax * ax + ay * ay;
        if (d < f1) { f2 = f1; f1 = d; id = G.id[k]; }
        else if (d < f2) f2 = d;
      }
    }
    _vor.e = Math.sqrt(f2) - Math.sqrt(f1); _vor.id = id;
    return _vor;
  }
  function laceRows(n) {
    const L = _lace, S = L.S, D = L.D;
    const end = Math.min(S, L.row + n);
    const TAU = 6.2831853, A = L.A, B = L.B;
    for (let py = L.row; py < end; py++) {
      const y = py / S;
      for (let pxi = 0; pxi < S; pxi++) {
        const x = pxi / S;
        // a periodic warp (integer cycles per tile) so no edge runs straight
        const wx = 0.30 * Math.sin(TAU * (2 * y + x) + 1.3) + 0.16 * Math.sin(TAU * (5 * x - 3 * y) + 0.4);
        const wy = 0.30 * Math.sin(TAU * (2 * x - y) + 2.1) + 0.16 * Math.sin(TAU * (4 * y + 3 * x) + 4.0);
        const a = voronoi(x * A.NX + wx, y * A.NY + wy, A);
        const e1 = a.e, id = a.id;
        const b = voronoi(x * B.NX + wx * 1.7, y * B.NY + wy * 1.7, B);
        const o = (py * S + pxi) * 4;
        D[o] = Math.min(255, (e1 * 2.1 * 255) | 0);
        D[o + 1] = (id * 255) | 0;
        D[o + 2] = Math.min(255, (b.e * 2.1 * 255) | 0);
        D[o + 3] = 255;
      }
    }
    L.row = end;
    return end >= S;
  }

  /* the melt's temperature ramp, LINEAR (r128 Color.setHex does no
     conversion), measured on screen through the shipped tone map:
       A 0x300701 -> rgb(143,23,2)   a dull red seam
       B 0x6a1004 -> rgb(219,64,0)   the open channel
       C 0xd8480f -> rgb(255,180,66) incandescent cracks
       W            yellow-white     freshly broken rock: front and vent only */
  function lin3(hex) { _c1.setHex(hex); return "vec3(" + _c1.r.toFixed(4) + "," + _c1.g.toFixed(4) + "," + _c1.b.toFixed(4) + ")"; }
  const MELT_PARS = [
    "uniform float uCyc;",
    "uniform float uShear;",
    "uniform float uFlick;",
    "vec3 meltRamp(float t) {",
    "  vec3 c = mix(vec3(0.0), " + lin3(MELT_A) + ", smoothstep(0.02, 0.28, t));",
    "  c = mix(c, " + lin3(MELT_B) + ", smoothstep(0.22, 0.55, t));",
    "  c = mix(c, " + lin3(MELT_C) + ", smoothstep(0.5, 0.82, t));",
    "  c = mix(c, vec3(1.25, 0.72, 0.28), smoothstep(0.84, 1.0, t));",
    "  return c;",
    "}",
    // one crack layer: x = how much melt shows, y = plate-rim warmth, z = plate random
    "vec3 meltLayer(vec4 tx, float heat, float cool, float sp) {",
    "  float edge = tx.r, fine = tx.b, rnd = tx.g;",
    "  float w = mix(0.07, 0.5, heat * heat) * (1.0 - 0.7 * cool);",
    "  float crack = 1.0 - smoothstep(w * 0.45, w + 0.05, edge);",
    "  float wf = 0.2 * heat * (1.0 - cool);",
    "  float fc = (1.0 - smoothstep(wf * 0.4, wf + 0.03, fine)) * step(0.01, wf) * 0.65 * smoothstep(0.15, 0.5, edge);",
    // the fast core is torn open, and rafts of crust ride it
    "  float open = smoothstep(0.68, 0.95, heat * (0.55 + 0.45 * sp) + (rnd - 0.5) * 0.45);",
    "  float melt = max(max(crack, fc), open);",
    "  float rim = (1.0 - smoothstep(w, w + 0.24, edge)) * (1.0 - melt);",
    "  return vec3(melt, rim, rnd);",
    "}",
  ].join("\n");
  const MELT_FRAG = [
    "float heatV = clamp(vColor.r, 0.0, 1.0);",
    "float spV = clamp(vColor.g, 0.0, 1.0);",
    "float coolV = clamp(vColor.b, 0.0, 1.0);",
    "float p1 = fract(uCyc), p2 = fract(uCyc + 0.5);",
    "float w1 = 1.0 - abs(2.0 * p1 - 1.0);",
    "float shK = uShear * max(spV - 0.3, 0.0);",
    "vec3 L1 = meltLayer(texture2D(map, vUv - vec2(0.0, shK * p1)), heatV, coolV, spV);",
    "vec3 L2 = meltLayer(texture2D(map, vUv + vec2(0.5, 0.37) - vec2(0.0, shK * p2)), heatV, coolV, spV);",
    "vec3 Lm = mix(L2, L1, w1);",
    "float meltK = Lm.x;",
    // what shows through is as hot as the stretch it is in; plate rims and
    // fresh crust carry a dull red of their own until they cool
    "float tMelt = meltK * smoothstep(0.02, 0.3, heatV) * (0.5 + 0.5 * heatV);",
    "float tPlate = (Lm.y * 0.42 * heatV + heatV * 0.22 * (1.0 - coolV) * (0.5 + 0.5 * Lm.z)) * (1.0 - meltK);",
    "float tGlow = max(tMelt, tPlate);",
    "totalEmissiveRadiance = meltRamp(tGlow) * uFlick;",
    // the crust: dark basalt, a little warmer where fresh, lit by the scene
    "vec3 crustC = mix(vec3(0.060, 0.054, 0.050), vec3(0.105, 0.094, 0.086), Lm.z) * mix(vec3(1.08, 0.94, 0.86), vec3(1.0), coolV);",
    "diffuseColor.rgb = max(crustC * (1.0 - meltK), vec3(0.0));",
  ].join("\n");
  function meltMaterial() {
    const mat = new THREE.MeshPhongMaterial({
      map: laceTex(), vertexColors: true, flatShading: true,
      shininess: 14, specular: 0x14120f,
      side: THREE.DoubleSide, fog: true,
      polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6,
    });
    const uni = { uCyc: { value: 0 }, uShear: { value: 0 }, uFlick: { value: 1 } };
    mat.userData.melt = uni;
    mat.onBeforeCompile = function (sh) {
      sh.uniforms.uCyc = uni.uCyc;
      sh.uniforms.uShear = uni.uShear; sh.uniforms.uFlick = uni.uFlick;
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", "#include <common>\n" + MELT_PARS)
        .replace("#include <map_fragment>", MELT_FRAG)
        .replace("#include <color_fragment>", "")
        // glowing melt has no sheen; the crust keeps its dull one
        .replace("#include <specularmap_fragment>", "float specularStrength = 1.0 - meltK;");
    };
    mat.customProgramCacheKey = function () { return "volcano-melt-2"; };
    return mat;
  }
  function laceTex() {
    if (_laceTex) return _laceTex;
    if (!_lace) laceBegin();
    laceRows(_lace.S);
    const tx = new THREE.DataTexture(_lace.D, _lace.S, _lace.S, THREE.RGBAFormat);
    tx.needsUpdate = true;
    _lace = null;
    // LINEAR encoding on purpose: this is a MULTIPLIER, not a colour, and
    // r128's mapTexelToLinear would gamma-decode it if we said sRGB.
    tx.wrapS = tx.wrapT = THREE.RepeatWrapping;
    tx.minFilter = THREE.LinearMipmapLinearFilter;
    tx.magFilter = THREE.LinearFilter;
    tx.generateMipmaps = true;
    // the flow is nearly always seen at a grazing angle down a cone, which is
    // exactly the case trilinear filtering blurs into mush. r128 clamps this
    // to the device's maximum at upload, so nothing here asks the GPU (the
    // query was a pipeline sync inside the frame the lace finished)
    tx.anisotropy = 4;
    _laceTex = tx;
    return _laceTex;
  }
  /* V.prewarm(ms): spend up to `ms` this frame building what the first lava
     will need. Returns true when there is nothing left to build. */
  V.prewarm = function (ms) {
    // the plume's program links on a hidden throwaway while the mountain only steams
    if (!_plumeWarm) plumeWarm();
    if (_laceTex) return true;
    if (!_lace) laceBegin();
    const t0 = performance.now(), budget = ms > 0 ? +ms : 3;
    while (_lace.row < _lace.S && performance.now() - t0 < budget) laceRows(4);
    if (_lace.row >= _lace.S) laceTex();
    return !!_laceTex;
  };

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
    /* LAVA LEAVES A RIM THROUGH ITS LOWEST NOTCH. The caller hands a
       bearing off the rim; the flow looks a few metres down a +-0.5 rad fan
       and takes the lowest heading, which on the stratovolcano is the head
       of the nearest barranco — so the flow is IN a valley from its first
       station instead of draping a ridge and having to slide off it. */
    let bearing0 = o.bearing;
    if (bearing0 != null) {
      let bestH = 1e9, best = bearing0;
      // +-0.8 rad, 10 m out: wide enough to always reach the head of a
      // barranco (the island's run every ~60 degrees), never a full turn
      for (let k = -8; k <= 8; k++) {
        const a = bearing0 + k * 0.1;
        const hh = groundAt(o.x + Math.cos(a) * 10, o.z + Math.sin(a) * 10) + Math.abs(k) * 0.02;
        if (hh < bestH) { bestH = hh; best = a; }
      }
      bearing0 = best;
    }
    const path = smoothPath(fallLine({
      x: o.x, z: o.z, groundAt: groundAt, bearing: bearing0,
      step: seg, count: Math.ceil(len / seg) + 1, salt: salt,
      /* LAVA FINDS THE VALLEY FLOOR. Looking one station ahead the fan only
         ever saw the radial slope of the cone and the flow came straight
         down whatever ridge it was born on; looking ~6 m ahead it feels the
         barranco walls on either side and settles into the floor, which is
         where every real flow on a stratovolcano ends up. */
      turn: 0.5, wander: 0.04, probe: 6,
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
      /* CONFINED ON THE CONE, SPREADING ON THE PLAIN. The width used to grow
         with distance alone, so a flood-width stem (6-14 m from the caller)
         was already ~9 m wide a third of the way down a 30 m cone: six of
         them skinned the whole mountain. What sets a lava flow's width is the
         GROUND: on a steep flank it is confined to its channel (a few metres,
         sitting in the barranco it found), and only where the slope eases
         does it spread into a broad lobe. So the local grade squeezes it —
         to ~0.3 of the caller's width on the upper cone — and the necking
         wave is damped there too (a channel between levees does not belly). */
      const pa = path.pts[Math.max(0, i - 1)], pb = path.pts[Math.min(N - 1, i + 1)];
      const grade = Math.max(0, pa.y - pb.y) / Math.max(0.5, Math.hypot(pb.x - pa.x, pb.z - pa.z));
      const steep = clamp((grade - 0.12) / 0.55, 0, 1);
      const sq = 1 - 0.7 * steep * steep * (3 - 2 * steep);
      const lobeK = 1 + (lobe - 1) * (1 - 0.6 * steep);
      wProf[i] = (0.62 + 0.6 * Math.pow(u, 0.7)) * sq * lobeK * (0.9 + 0.2 * h01(p.x, p.z, salt + 11));
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
    /* lit crust with emissive cracks (see meltMaterial): the vertex colour
       carries the smooth fields, the map carries the crack network. */
    const chMat = meltMaterial();
    const meltU = chMat.userData.melt;
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
    if (o.light !== false) {
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
    /* LAVA IS VISCOUS, SO ITS FRONT SPEED IS THE SLOPE'S. A Bingham fluid
       moves at a rate set by gravity resolved along the bed against a yield
       strength and a viscosity that both climb as the flow loses heat: it
       pours down the steep upper cone, slows to a crawl on the apron and
       stalls on the flat, while the front thickens. So the nose advances at
       `speed` scaled by the local grade under it (0.5x on the flat to 1.6x
       on the steep cone) and by how far it has run (cooling stiffens it).
       `bornT` records when the front actually reached each station, so the
       crust's age — and its colour — follow the real arrival, not a
       constant-speed guess. */
    const bornT = new Float32Array(N).fill(-1);
    bornT[0] = 0; if (N > 1) bornT[1] = 0;
    let frontV = speed;
    const _v = new THREE.Vector3();
    /* THE SURFACE RUNS FASTER THAN THE FRONT. The nose is braked by the crust
       it is pushing; the melt behind it is not. ~2.4x is the ratio that reads
       as "a river with a lid on it" rather than as a conveyor belt. */
    const skinV = speed * 2.4;
    /* the banks' crust moves at a third of the core's: the shader's two
       crossfaded crack layers carry the difference on a SHEAR_T cycle */
    const BANK_V = 0.35, SHEAR_T = 6;
    meltU.uShear.value = skinV * (1 - BANK_V) * SHEAR_T / LACE_L / 0.7;
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
        /* THE FRONT IS FRESHLY BROKEN ROCK: the last few metres behind the
           nose are torn open as it bulldozes its own crust, so they glow
           hotter than the stretch behind them. */
        const front = clamp(1 - (adv - s) / 5, 0, 1) * hot;
        env = Math.max(env, front * across * 0.95);
        /* NOT A COLOUR ANY MORE: the melt shader (meltMaterial) reads these
           as data — r heat envelope, g surface speed (core fast, banks
           slow: the plates shear), b how cooled this stretch is (cracks
           close and the crust's warm cast goes). A quench drives hot to
           ~0.04 and the cracks shut to black rock by themselves. */
        kCol[off] = clamp(env * grM, 0, 1);
        kCol[off + 1] = 0.3 + 0.7 * (1 - amu * amu);
        kCol[off + 2] = clamp(1 - hot, 0, 1);
        /* THE CRACKS' OWN COORDINATES. uv.x is metres across the flow, uv.y
           metres down it MINUS the metres the lid has advected at the BANK
           speed; the shader adds the faster core on top (the shear). The
           geometry never moves. */
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
      const bornAt = bornT[i] >= 0 ? bornT[i] : age;
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
      const ph = phT * skinV * BANK_V + laceOff;   // METRES the banks' lid has travelled
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
        hot0[i] * (1 - 0.58 * st.cool) * (1 - 0.9 * st.qk), adv, phT * skinV * BANK_V + laceOff, cGY, mGY);
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
      get frontSpeed() { return frontV; },
      get fullLength() { return len; },
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
        if (quenchT < 0) {
          const fi = clamp(Math.floor(adv / seg), 0, N - 2);
          const grade = (path.pts[fi].y - path.pts[fi + 1].y) / seg;
          frontV = speed * clamp(0.55 + 1.5 * grade, 0.5, 1.6) * (1 - 0.4 * adv / len);
          adv = Math.min(len, adv + frontV * dt);
          const fs = Math.min(N - 1, Math.floor(adv / seg) + 1);
          for (let k = 0; k <= fs; k++) if (bornT[k] < 0) bornT[k] = age;
        } else frontV = 0;
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
        meltU.uFlick.value = clamp(fl, 0.75, 1.04);
        meltU.uCyc.value = phT / SHEAR_T;

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
        if (qk >= 1) { settled = true; meltU.uFlick.value = 1; }
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
      /* `pad` (m) widens the test past the drawn margin: the radiant heat
         of a live flow chars and ignites what stands a metre or two off its
         edge, so the eruption asks with a pad for fire and without one for
         what the rock actually covers. */
      hitTest(x, z, pad) {
        // cold rock is terrain, not a hazard — what kills you is what glows
        if (quenchT >= 0) return false;
        const pd = pad > 0 ? +pad : 0;
        const c = pathCoord(path, x, z, adv);
        if (c.s >= -pd && c.s <= adv + pd) {
          const i = clamp(Math.round(c.s / seg), 0, N - 1);
          if (c.perp < halfW * wProf[i] * 0.95 + pd) return true;
        }
        for (let b = 0; b < children.length; b++) if (children[b].hitTest(x, z, pd)) return true;
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
     THE ERUPTION SKY. The column and the umbrella used to live here as
     110-200 camera-facing puff cards each; they are one raymarched volume
     now (THE PLUME VOLUME, below the puff batch). The batch itself stays
     for what really is particles: the fumaroles, the phreatic jets, the
     fountain's clots.
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

  /* ============================================================
     THE PUFF BATCH — every billboard in a cloud, ONE draw call.

     r128 draws every THREE.Sprite as its own call, whatever the material:
     the column was 80-156 calls and the fountain another 56-132, i.e. the
     eruption alone cost more draws than the whole town on an iPad. This is
     the same billboard as a Sprite (a camera-facing quad, rotated in the
     view plane, unlit) drawn as instances of one quad, with the per-puff
     state that used to live on 156 SpriteMaterials — position, size,
     rotation, colour, opacity, mask — in instanced attributes rewritten
     each frame (a few KB), and the instances SORTED back to front on the
     CPU so normal-blended smoke still layers correctly.

     Two things a Sprite could not do, and the reason the column reads as a
     volume now:
       UNDERLIGHT  each puff carries how much of the vent's light reaches it,
                   and the shader paints that onto the puff's LOWER half
                   only, fading up through the mask — the lit underside of a
                   convective column over a glowing crater;
       ATLAS       the three lit puff masks share one texture, so every puff
                   still picks its own lobe pattern inside one call.
     Colours arrive LINEAR (screenHex-authored) and go through the same tone
     map + output encoding as the Sprites did, so nothing about the palette
     moved.
     ============================================================ */
  let _puffAtlas = null;
  function puffAtlas() {
    if (_puffAtlas) return _puffAtlas;
    const S = 128, cv = document.createElement("canvas");
    cv.width = S * 3; cv.height = S;
    const g = cv.getContext("2d");
    for (let k = 0; k < 3; k++) g.drawImage(puffTex(k).image, k * S, 0);
    _puffAtlas = new THREE.CanvasTexture(cv);
    return _puffAtlas;
  }
  const PUFF_VS = [
    "attribute vec3 iPos;",
    "attribute vec4 iSR;",      // size x, size y, rotation, atlas tile
    "attribute vec4 iCol;",     // rgb, opacity
    "attribute float iUnder;",  // vent underlight 0..1
    "varying vec2 vUv;",
    "varying vec4 vCol;",
    "varying float vUnder;",
    "#include <fog_pars_vertex>",
    "void main() {",
    "  vec4 mvPosition = viewMatrix * vec4(iPos, 1.0);",
    "  float c = cos(iSR.z), s = sin(iSR.z);",
    "  vec2 p = position.xy * iSR.xy;",
    "  mvPosition.xy += vec2(c * p.x - s * p.y, s * p.x + c * p.y);",
    "  gl_Position = projectionMatrix * mvPosition;",
    "  vUv = vec2((uv.x + iSR.w) * uTiles, uv.y);",
    "  vCol = iCol;",
    "  vUnder = iUnder;",
    "  #include <fog_vertex>",
    "}",
  ].join("\n");
  const PUFF_FS = [
    "uniform sampler2D map;",
    "uniform vec3 uUnderCol;",
    "varying vec2 vUv;",
    "varying vec4 vCol;",
    "varying float vUnder;",
    "#include <fog_pars_fragment>",
    "void main() {",
    "  vec4 t = texture2D(map, vUv);",
    "  vec3 col = t.rgb * vCol.rgb;",
    // the underside: strongest at the quad's foot, gone by two thirds up
    "  float u = vUnder * (1.0 - smoothstep(0.0, 0.68, vUv.y));",
    "  col = mix(col, uUnderCol * (0.55 + 0.45 * t.r), clamp(u, 0.0, 1.0));",
    // max(): a NaN or negative channel must never reach the blend (Apple GPUs
    // pass NaN through where desktop drivers flush it), and !(a > x) also
    // discards a NaN alpha
    "  gl_FragColor = vec4(max(col, vec3(0.0)), t.a * vCol.a);",
    "  if (!(gl_FragColor.a > 0.004)) discard;",
    "  #include <tonemapping_fragment>",
    "  #include <encodings_fragment>",
    "  #include <fog_fragment>",
    "}",
  ].join("\n");
  /* puffBatch(n, {map, tiles, additive, fog, underCol, renderOrder, parent})
     -> { mesh, set(i, x,y,z, sx,sy, rot, tile, r,g,b,a, under), hide(i),
          commit(), dispose() } */
  function puffBatch(n, o) {
    o = o || {};
    const tiles = o.tiles || 1;
    const quad = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.setIndex(quad.index);
    geo.setAttribute("position", quad.attributes.position);
    geo.setAttribute("uv", quad.attributes.uv);
    const aPos = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
    const aSR = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
    const aCol = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
    const aUn = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
    [aPos, aSR, aCol, aUn].forEach(function (a) { a.setUsage(THREE.DynamicDrawUsage); });
    geo.setAttribute("iPos", aPos); geo.setAttribute("iSR", aSR);
    geo.setAttribute("iCol", aCol); geo.setAttribute("iUnder", aUn);
    geo.instanceCount = 0;
    const mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
        map: { value: null }, uUnderCol: { value: new THREE.Color(o.underCol != null ? o.underCol : 0x000000) },
      }]),
      vertexShader: "#define uTiles " + (1 / tiles).toFixed(6) + "\n" + PUFF_VS,
      fragmentShader: PUFF_FS,
      transparent: true, depthWrite: false, depthTest: true,
      fog: o.fog !== false,
      blending: o.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    mat.uniforms.map.value = o.map;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = o.renderOrder != null ? o.renderOrder : 7;
    (o.parent || CBZ.scene).add(mesh);
    // staging, in caller order; commit() sorts the live ones into the attributes
    const sx = new Float32Array(n * 13), live = new Uint8Array(n);
    const order = [], depth = new Float32Array(n);
    const _cp = new THREE.Vector3(), _cd = new THREE.Vector3();
    const B = {
      mesh: mesh, material: mat, count: n,
      set(i, x, y, z, w, h, rot, tile, r, g, b, a, under) {
        const k = i * 13;
        sx[k] = x; sx[k + 1] = y; sx[k + 2] = z; sx[k + 3] = w; sx[k + 4] = h;
        sx[k + 5] = rot; sx[k + 6] = tile; sx[k + 7] = r; sx[k + 8] = g; sx[k + 9] = b;
        sx[k + 10] = a; sx[k + 11] = under || 0;
        live[i] = a > 0.003 && w > 0.01 ? 1 : 0;
      },
      hide(i) { live[i] = 0; },
      commit() {
        const cam = CBZ.camera;
        order.length = 0;
        if (cam) { cam.getWorldPosition(_cp); cam.getWorldDirection(_cd); }
        for (let i = 0; i < n; i++) {
          if (!live[i]) continue;
          const k = i * 13;
          depth[i] = cam ? (sx[k] - _cp.x) * _cd.x + (sx[k + 1] - _cp.y) * _cd.y + (sx[k + 2] - _cp.z) * _cd.z : 0;
          order.push(i);
        }
        // far first; additive light does not care, but it costs nothing
        if (!o.additive) order.sort(function (p, q) { return depth[q] - depth[p]; });
        const P = aPos.array, S = aSR.array, C = aCol.array, U = aUn.array;
        for (let j = 0; j < order.length; j++) {
          const k = order[j] * 13;
          P[j * 3] = sx[k]; P[j * 3 + 1] = sx[k + 1]; P[j * 3 + 2] = sx[k + 2];
          S[j * 4] = sx[k + 3]; S[j * 4 + 1] = sx[k + 4]; S[j * 4 + 2] = sx[k + 5]; S[j * 4 + 3] = sx[k + 6];
          C[j * 4] = sx[k + 7]; C[j * 4 + 1] = sx[k + 8]; C[j * 4 + 2] = sx[k + 9]; C[j * 4 + 3] = sx[k + 10];
          U[j] = sx[k + 11];
        }
        geo.instanceCount = order.length;
        mesh.visible = order.length > 0;
        aPos.needsUpdate = aSR.needsUpdate = aCol.needsUpdate = aUn.needsUpdate = true;
        return order.length;
      },
      dispose() {
        if (mesh.parent) mesh.parent.remove(mesh);
        geo.dispose(); quad.dispose(); mat.dispose();
      },
    };
    return B;
  }
  V.puffBatch = puffBatch;

  /* ============================================================
     FUMAROLES — the mountain breathing at rest.

     For the first minute of every match the volcano is the island's
     landmark and nothing else, and a dormant stratovolcano is never quite
     still: a thin white wisp leans off a vent on the crater wall and tears
     apart downwind. That one moving thing on the summit is what says
     "this is alive" before anything erupts. Steam, not ash: pale, very
     thin, climbing a dozen metres and gone. One instanced draw for every
     vent. It hands the sky over to the column while one stands (fades out)
     and comes back when the eruption is over.
     ============================================================ */
  V.fumarole = function (o) {
    o = o || {};
    const vents = (o.vents && o.vents.length) ? o.vents : [{ x: +o.x || 0, y: +o.y || 0, z: +o.z || 0 }];
    const PER = qi(7, 11);
    const N = PER * vents.length;
    const B = puffBatch(N, { map: puffAtlas(), tiles: 3, fog: true, parent: o.parent, renderOrder: 6 });
    const C_DAY = new THREE.Color(screenHex(214, 212, 206));
    const C_NIGHT = new THREE.Color(screenHex(62, 64, 70));
    const col = new THREE.Color();
    let seed = ((o.salt | 0) ^ 0x3c6ef372) >>> 0;
    const rnd = function () { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    const LIFE = 7.5;
    const P = [];
    for (let i = 0; i < N; i++) {
      P.push({ v: vents[i % vents.length], life: (i / N) * LIFE, jx: 0, jz: 0, sz: 0.8 + 0.4 * rnd(), rot: (rnd() - 0.5) * 0.5, tile: i % 3, big: (i % vents.length) === 0 ? 1 : 0.7 });
    }
    /* STRENGTH: 1 is the mountain at rest. The UNREST before an eruption is
       the same vents working harder — magma rising under the edifice boils
       the groundwater off faster, so the plumes thicken, climb higher and
       lean less (more heat, more buoyancy). 4 is a summit steaming like a
       kettle in the last seconds before the phreatic blast. */
    let strength = o.strength > 0 ? +o.strength : 1;
    let fade = 1, dead = false;
    const handle = {
      kind: "fumarole", mesh: B.mesh,
      setStrength(k) { strength = clamp(+k || 1, 0.2, 5); return handle; },
      update(dt) {
        if (dead || !(dt > 0)) return handle;
        if (dt > 0.2) dt = 0.2;
        // the eruption column owns the summit while it stands
        const want = (LIVE.column.length && o.yieldToColumn !== false) ? 0 : 1;
        fade += (want - fade) * Math.min(1, dt * 0.8);
        let wx = 0.8, wz = 0.35;
        try {
          const w = CBZ.weatherWind ? CBZ.weatherWind() : null;
          if (w && w.speed > 0.2) { const L = Math.hypot(w.x, w.z) || 1; wx = w.x / L; wz = w.z / L; }
        } catch (e) { /* no weather: a light sea breeze */ }
        const night = clamp(1 - (0.5 + 2.2 * (CBZ.sunHeight != null ? CBZ.sunHeight : 0.5)), 0, 1);
        col.copy(C_DAY).lerp(C_NIGHT, night);
        for (let i = 0; i < N; i++) {
          const p = P[i];
          p.life += dt;
          if (p.life >= LIFE) {
            p.life -= LIFE;
            p.jx = (rnd() - 0.5) * 0.8; p.jz = (rnd() - 0.5) * 0.8;
            p.sz = 0.8 + 0.4 * rnd(); p.rot = (rnd() - 0.5) * 0.5;
          }
          const u = p.life / LIFE;
          // rises fast off the vent, then the breeze takes it over
          const S1 = strength - 1;
          const rise = 11 * p.big * (1 - Math.pow(1 - u, 1.8)) * (1 + 0.9 * S1);
          const lean = 9 * u * u * p.big * (1 + 0.3 * S1);
          const s = (1.1 + 5.5 * u) * p.sz * p.big * (1 + 0.45 * S1);
          const a = fade * Math.min(0.62, 0.26 * (1 + 0.4 * S1)) * Math.min(1, u / 0.12) * Math.pow(1 - u, 1.5);
          B.set(i, p.v.x + p.jx + wx * lean, p.v.y + 0.6 + rise, p.v.z + p.jz + wz * lean,
            s * 1.15, s, p.rot + u * 0.3, p.tile, col.r, col.g, col.b, a, 0);
        }
        B.commit();
        return handle;
      },
      dispose() { if (dead) return; dead = true; B.dispose(); },
    };
    return handle;
  };

  /* ============================================================
     THE PLUME VOLUME — the column and the umbrella are ONE raymarched body.

     OWNER, 2026-10-19: "the ash that comes out of the volcano looks like 2D
     blocks, like rocks almost coming out of it... very 2D, like separate
     clouds coming out of it." He was right, and no tuning of the billboards
     could fix it. A column built from 110-200 camera-facing puff cards is a
     stack of stickers: each card has its own lit lobe pattern baked into a
     texture, so every card reads as its own lump; the cards have hard
     silhouettes against the sky, so the edge of the plume is a row of
     coins; and the light was painted per card, so the column had no
     self-shadow and the umbrella had no belly.

     The reference footage (Pinatubo 12 June 1991, Calbuco 22 April 2015,
     Taal 12 January 2020, Eyjafjallajokull April 2010) agrees on one
     picture:
       - ONE dense, continuous convective body: cauliflower billows that
         overlap and merge, never separate puffs with sky between them;
       - grey to dark grey-brown, the sun side markedly lighter, the
         undersides of every billow and the whole umbrella belly in their
         own shadow;
       - near the vent the jet is darkest (it is still mostly rock), with
         a dirty-white steam fringe at its margin;
       - it rises with rolling internal motion, the head bulging at the
         rising front, then flattens into a dark umbrella that spreads at
         neutral buoyancy and drifts downwind, with fall streaks hanging
         under its downwind half;
       - at night, a black pillar whose foot is lit orange by the crater.

     So both are now drawn the way city/nukefx.js draws the mushroom cloud
     (one box-proxy mesh, one fragment shader marching a density field),
     cut down to what a phone can afford:
       ENVELOPE  analytic: a leaning, entraining column (radius = vent +
                 0.2 m per metre climbed, a bulbous head at the rising
                 front, a billowing foot when it collapses) smooth-unioned
                 with the off-centre umbrella lens, so the head flows into
                 the deck with no seam.
       NOISE     value noise from a 256x256 RGBA texture (two layers in R/G,
                 one fetch per octave, built in a millisecond, WebGL1 safe).
                 Coordinates advect UP the column at the rise speed and OUT
                 with the deck, so the billows roll instead of sliding.
                 Scaled to the local radius, so a burp and the big one are
                 both cauliflower and never noise soup.
       LIGHT     Beer-Lambert accumulation; sun transmittance from two
                 envelope taps toward the sun (no nested march); sky
                 occlusion from one tap overhead; the crater's glow on the
                 foot; plume lightning as a point bloom. Colours are
                 authored in SCREEN bytes (screenHex), so the ash lands
                 neutral grey on the glass. No blue anywhere in the ramp
                 (the 2026 iOS purple-speckle fix was a blue tint coming out),
                 and every output is clamped so a mediump NaN can never
                 reach the blend.
       COST      one draw call for column + umbrella; empty space costs one
                 envelope evaluation and no fetch; step count rides the
                 quality tier; no lights, no per-frame allocation.
     ============================================================ */
  let _plumeNoise = null;
  function plumeNoise() {
    if (_plumeNoise) return _plumeNoise;
    const S = 256, D = new Uint8Array(S * S * 4);
    let seed = 0x2545f491 >>> 0;
    const R = new Uint8Array(S * S);
    for (let i = 0; i < S * S; i++) { seed = (seed * 1664525 + 1013904223) >>> 0; R[i] = seed >>> 24; }
    // G(x,y) = R(x-37, y-17): the next z layer of the same lattice (iq's trick),
    // so one bilinear fetch returns both z layers of a 3D value noise
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const o = (y * S + x) * 4;
      D[o] = R[y * S + x];
      D[o + 1] = R[((y - 17) & 255) * S + ((x - 37) & 255)];
      D[o + 2] = 0; D[o + 3] = 255;
    }
    const tx = new THREE.DataTexture(D, S, S, THREE.RGBAFormat);
    tx.wrapS = tx.wrapT = THREE.RepeatWrapping;
    tx.magFilter = THREE.LinearFilter; tx.minFilter = THREE.LinearFilter;
    tx.generateMipmaps = false;
    tx.needsUpdate = true;
    _plumeNoise = tx;
    return tx;
  }
  const PLUME_VS = [
    "varying vec3 vWorld;",
    "void main() {",
    "  vec4 w = modelMatrix * vec4(position, 1.0);",
    "  vWorld = w.xyz;",
    "  gl_Position = projectionMatrix * viewMatrix * w;",
    "  gl_Position.z = min(gl_Position.z, gl_Position.w * 0.99999);",
    "}",
  ].join("\n");
  const PLUME_FS = [
    "uniform sampler2D uNoise;",
    "uniform mat4 projectionMatrix;",
    "uniform vec3 uBoxMin; uniform vec3 uBoxMax;",
    "uniform vec3 uVent;",
    "uniform vec4 uCol;",    // standing top (m over vent), vent radius, collapse foot, presence
    "uniform vec4 uCol2;",   // wind x, wind z, lean at the top (m), waning base cut (m)
    "uniform vec4 uUmb;",    // deck centre x, z (rel vent), radius, downwind stretch
    "uniform vec4 uUmb2;",   // deck height (rel vent), thickness, presence, fall streaks
    "uniform vec2 uUmbDir;",
    "uniform float uGround; uniform float uTime; uniform float uSteps; uniform float uSigma; uniform float uRise;",
    "uniform vec3 uSunDir;",
    "uniform vec3 uLit; uniform vec3 uShade; uniform vec3 uDeep; uniform vec3 uSteamLit; uniform vec3 uSteamShade;",
    "uniform vec3 uVentCol; uniform float uVentK; uniform float uVentReach; uniform float uDay;",
    "uniform vec4 uFlash; uniform float uFlashR; uniform vec3 uFlashCol;",
    "uniform vec4 uFog; uniform vec3 uFogCol;",
    "varying vec3 vWorld;",
    "",
    "float vnoise(vec3 x) {",
    "  vec3 p = floor(x); vec3 f = x - p;",
    "  f = f * f * (3.0 - 2.0 * f);",
    "  p = mod(p, 256.0);",
    "  vec2 uv = p.xy + vec2(37.0, 17.0) * p.z + f.xy;",
    "  vec2 rg = texture2D(uNoise, (uv + 0.5) / 256.0).yx;",
    "  return mix(rg.x, rg.y, f.z);",
    "}",
    "float smax(float a, float b, float k) { float h = clamp(0.5 + 0.5 * (a - b) / k, 0.0, 1.0); return mix(b, a, h) + k * h * (1.0 - h); }",
    /* gH: the height the column's ENVELOPE reaches. While a deck is up the
       column always reaches the deck (a collapsing column still feeds its
       umbrella, it just thins), so there is never sky between them. gHs is
       the standing height, which only shapes the collapsing foot. */
    "float gH; float gHs;",
    "float colR(float y) {",
    "  float u = clamp(y / gH, 0.0, 1.0);",
    "  float us = clamp(y / gHs, 0.0, 1.0);",
    "  float r = uCol.y * (0.8 + 0.2 * smoothstep(0.0, 0.08, u)) + 0.2 * max(y, 0.0);",
    "  r *= 1.0 + 0.4 * smoothstep(0.62, 1.0, u);",      // the head swells
    "  r *= 1.0 + 1.4 * uCol.z * (1.0 - us);",           // a collapsing foot billows out
    "  return max(r, 0.5);",
    "}",
    "float colEnv(vec3 q) {",
    "  if (uCol.w <= 0.001) return -9.0;",
    "  float H = gH;",
    "  float u = clamp(q.y / H, 0.0, 1.2);",
    "  vec2 c = uCol2.xy * uCol2.z * u * u;",
    "  float r = colR(q.y);",
    "  float d = length(q.xz - c) / r;",
    "  float k = max(q.y - (H - 0.55 * r), 0.0) / (0.75 * r);",   // the rounded crown
    "  float e = 1.0 - length(vec2(d, k));",
    "  e = min(e, (q.y - uCol2.w + 1.5) / 3.0);",                  // rooted in the vent
    "  e -= uCol.z * 0.45 * smoothstep(gHs * 0.8, gH, q.y);",      // collapsing: a thinner neck, still joined
    "  return e - (1.0 - uCol.w) * 1.3;",
    "}",
    "float umbRR(vec3 q) {",
    "  vec2 d = q.xz - uUmb.xy;",
    "  float a = dot(d, uUmbDir), c = d.x * uUmbDir.y - d.y * uUmbDir.x;",
    "  float R = max(uUmb.z, 1.0);",
    "  float ex = mix(R * 0.9, R + uUmb.w, smoothstep(-0.25 * R, 0.25 * R, a));",
    "  float ey = R + 0.22 * uUmb.w;",
    "  return length(vec2(a / ex, c / ey));",
    "}",
    /* big billows on the deck's top AND belly, cheap trig (no fetch: the
       envelope is evaluated four times per sample), drifting with the deck */
    "vec2 umbLump(vec2 p, float th) {",
    "  vec2 s = (p - uUmbDir * uTime * 2.2) / (th * 1.5);",
    "  float a = sin(s.x + 1.6 * sin(s.y * 0.61)) * sin(s.y * 1.13 + 1.3 * sin(s.x * 0.73));",
    "  vec2 s2 = s * 2.37 + vec2(5.1, 2.3);",
    "  float b = sin(s2.x + s2.y * 0.4) * sin(s2.y - s2.x * 0.3);",
    "  return vec2(a, b);",
    "}",
    "float umbEnv(vec3 q) {",
    "  if (uUmb2.z <= 0.001) return -9.0;",
    "  float rr = umbRR(q);",
    "  float th = max(uUmb2.y, 1.0);",
    "  float g = max(1.0 - rr, 0.0);",
    "  vec2 L = umbLump(q.xz - uUmb.xy, th);",
    // top: the overshoot dome over the column, cauliflower lumps everywhere
    "  float top = uUmb2.x + th * (0.42 + 0.3 * g) + th * 0.8 * g * g * g + th * (0.34 * L.x + 0.18 * L.y) * (0.55 + 0.45 * g);",
    // belly: thicker over the column, hanging lobes, never a flat plane
    "  float bot = uUmb2.x - th * (0.36 + 0.34 * g) - th * (0.2 * max(L.y, 0.0) + 0.12 * L.x + 0.1);",
    "  float hh = max((top - bot) * 0.5, 0.5);",
    "  float ev = 1.0 - abs(q.y - (top + bot) * 0.5) / hh;",
    "  return min(ev, (1.04 - rr - 0.07 * L.x) * 3.0) - (1.0 - uUmb2.z) * 1.3;",
    "}",
    "float envAll(vec3 q) { return smax(colEnv(q), umbEnv(q), 0.6); }",
    // the fall streaks hanging under the downwind half of the deck
    "float fallDen(vec3 q) {",
    "  if (uUmb2.w <= 0.001) return 0.0;",
    "  float top = uUmb2.x - uUmb2.y * 0.35;",
    "  if (q.y > top) return 0.0;",
    "  float rr = umbRR(q);",
    "  vec2 d = q.xz - uUmb.xy;",
    "  float dw = smoothstep(-0.1 * uUmb.z, 0.5 * uUmb.z, dot(d, uUmbDir));",
    "  float s = vnoise(vec3(q.x * 0.045, q.y * 0.004 + uTime * 0.06, q.z * 0.045));",
    "  float hgt = clamp((q.y - (uGround - uVent.y)) / max(top - (uGround - uVent.y), 1.0), 0.0, 1.0);",
    "  return uUmb2.w * (1.0 - smoothstep(0.55, 0.95, rr)) * dw * smoothstep(0.45, 0.8, s) * (0.25 + 0.75 * hgt) * smoothstep(0.0, 0.15, hgt);",
    "}",
    "",
    "void main() {",
    "  vec3 ro = cameraPosition;",
    "  vec3 rd = normalize(vWorld - ro);",
    "  vec3 inv = 1.0 / (sign(rd) * max(abs(rd), vec3(1e-5)) + vec3(step(abs(rd), vec3(0.0))) * 1e-5);",
    "  vec3 ta = (uBoxMin - ro) * inv, tb = (uBoxMax - ro) * inv;",
    "  vec3 tmn = min(ta, tb), tmx = max(ta, tb);",
    "  float t0 = max(max(max(tmn.x, tmn.y), tmn.z), 0.0);",
    "  float t1 = min(min(tmx.x, tmx.y), tmx.z);",
    "  if (rd.y < -1e-4) t1 = min(t1, (uGround - ro.y) / rd.y);",
    "  if (!(t1 > t0)) discard;",
    "  float n = max(uSteps, 8.0);",
    "  float baseL = max((t1 - t0) / n, 0.6);",
    "  float jit = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));",
    "  vec3 acc = vec3(0.0); float T = 1.0; float tW = 0.0; float wSum = 0.0;",
    "  gHs = max(uCol.x, 1.0);",
    "  gH = mix(gHs, max(gHs, uUmb2.x), clamp(uUmb2.z * 2.0, 0.0, 1.0));",
    "  float H = gH;",
    "  float th = max(uUmb2.y, 1.0);",
    "  float t = t0;",
    "  bool first = true;",
    "  for (int i = 0; i < PLUME_MAXI; i++) {",
    "    if (t > t1 || T < 0.03) break;",
    "    vec3 q = ro + rd * t - uVent;",
    "    float ec = colEnv(q), eu = umbEnv(q);",
    "    float e = smax(ec, eu, 0.6);",
    "    float fd = fallDen(q);",
    // the local billow scale: the column's own radius here, or the deck's thickness
    "    float wU = smoothstep(-0.25, 0.25, eu - ec);",
    "    float sc = mix(colR(q.y) * 0.85 + 2.0, th * 0.9 + 2.0, wU);",
    "    float stepL = clamp(sc * 0.3, baseL * 0.25, baseL * 2.0);",
    "    if (first) { t += stepL * jit; first = false; continue; }",
    "    if (e < -0.6 && fd <= 0.0) { t += stepL + (-e - 0.6) * sc * 0.7; continue; }",
    // advected coordinates: up the column at the rise speed, out with the deck
    "    vec3 cc = vec3(q.x, q.y - uTime * uRise, q.z) / sc;",
    "    float sw = uTime * 0.05 + q.y / (H * 0.9 + 10.0);",
    "    cc.xz = mat2(cos(sw), -sin(sw), sin(sw), cos(sw)) * cc.xz;",
    "    vec3 cu = vec3(q.x - uUmbDir.x * uTime * 2.2, q.y * 1.15, q.z - uUmbDir.y * uTime * 2.2) / sc;",
    "    vec3 c = mix(cc, cu, wU);",
    "    float n1 = vnoise(c) * 0.64 + vnoise(c * 2.13 + vec3(3.1, 1.7, 5.3)) * 0.36;",
    // the deck is eroded much harder than the column: billows, not a lens
    "    float base = e + (n1 - 0.5) * mix(1.15, 1.6, wU);",
    "    float d = 0.0;",
    "    if (base > 0.0) {",
    "      float n2 = vnoise(c * 4.37 + vec3(1.7, -uTime * 0.25, 0.4));",
    "      d = base - (1.0 - n2) * mix(0.38, 0.62, wU) * (1.0 - clamp(base * 1.6, 0.0, 1.0));",
    "      d = clamp(d * 1.8, 0.0, 1.0);",
    "    }",
    "    float dd = d + fd * 0.22;",
    "    if (dd > 0.003) {",
    "      float a = 1.0 - exp(-dd * uSigma * mix(1.8, 1.25, wU) * stepL / sc);",
    "      float L = sc * 1.1;",
    "      float o1 = envAll(q + uSunDir * L * 0.55);",
    "#if PLUME_TAPS > 1",
    "      float o2 = envAll(q + uSunDir * L * 1.6);",
    "#else",
    "      float o2 = o1 - 0.2;",
    "#endif",
    "      float od = max(o1 + 0.35, 0.0) + max(o2 + 0.35, 0.0) * 1.3 + d * 0.55;",
    "      float Ts = exp(-od * 2.2);",
    "      float up = envAll(q + vec3(0.0, L * 0.9, 0.0));",
    "      float occ = clamp(1.0 - max(up + 0.3, 0.0) * 1.1, 0.18, 1.0);",
    "      float hy = clamp(q.y / H, 0.0, 1.0);",
    // a dirty-white steam fringe round the jet's margin, low on the column
    "      float steam = (1.0 - smoothstep(0.05, 0.3, hy)) * (1.0 - smoothstep(0.0, 0.4, base)) * (1.0 - wU);",
    // and the jet's core is darkest: it is still mostly rock
    "      float deep = (1.0 - smoothstep(0.0, 0.35, hy)) * smoothstep(0.2, 0.7, base) * (1.0 - wU);",
    "      vec3 lit = mix(uLit, uSteamLit, steam * 0.75);",
    "      vec3 sh = mix(mix(uShade, uSteamShade, steam * 0.7), uDeep, deep * 0.7);",
    "      lit = mix(lit, uDeep * 2.2, deep * 0.45);",
    "      lit *= 1.0 - 0.08 * wU;",
    "      vec3 col = mix(sh * (0.55 + 0.45 * occ), lit, clamp(Ts * uDay * (0.6 + 0.4 * occ), 0.0, 1.0));",
    /* the crater's light on the column's FOOT only: the bottom ~12% of the
       column, falling off fast. Ash is not fire; above that it is lit by the sun. */
    "      float vy = max(q.y, 0.0);",
    "      float vk = uVentK * exp(-vy / min(uVentReach, 0.045 * H + 2.0)) * (1.0 - smoothstep(0.05 * H, 0.13 * H, vy));",
    "      col += uVentCol * (vk * (0.35 + 0.65 * (1.0 - Ts)) * (1.0 - wU));",
    "      if (uFlash.w > 0.01) {",
    "        vec3 fp = q + uVent - uFlash.xyz;",
    "        col += uFlashCol * (uFlash.w * exp(-dot(fp, fp) / max(uFlashR * uFlashR, 1.0)));",
    "      }",
    "      float wgt = T * a;",
    "      acc += wgt * col;",
    "      tW += wgt * t; wSum += wgt;",
    "      T *= 1.0 - a;",
    "    }",
    "    t += stepL;",
    "  }",
    "  float alpha = 1.0 - T;",
    "  if (!(alpha > 0.004)) discard;",
    "  float tHit = wSum > 1e-4 ? tW / wSum : t0;",
    "  vec3 cOut = max(acc / alpha, vec3(0.0));",
    "  if (uFog.x > 0.5) cOut = mix(cOut, uFogCol, smoothstep(uFog.y, uFog.z, tHit));",
    "#ifdef HAS_FRAG_DEPTH",
    "  vec4 clip = projectionMatrix * viewMatrix * vec4(ro + rd * tHit, 1.0);",
    "  gl_FragDepthEXT = clamp(clip.z / clip.w * 0.5 + 0.5, 0.0, 0.999999);",
    "#endif",
    "  gl_FragColor = vec4(cOut, 1.0);",
    "  #include <tonemapping_fragment>",
    "  #include <encodings_fragment>",
    "  gl_FragColor = vec4(clamp(gl_FragColor.rgb, 0.0, 1.0) * alpha, alpha);",
    "}",
  ].join("\n");

  /* The shared program: every plume material is built with the same source
     and defines, so r128's program cache links it ONCE — and V.prewarm()
     builds a throwaway one during the unrest so that link happens while
     the mountain is only steaming, not in the frame the column is born. */
  function plumeTier() {
    const steps = Math.round(q(14, 30));
    return { steps: steps, maxi: Math.round(q(40, 72)), taps: q(0, 1) > 0.5 ? 2 : 1 };
  }
  function plumeMaterial() {
    const R = CBZ.renderer;
    const fragDepth = !!(R && R.capabilities && (R.capabilities.isWebGL2 ||
      (R.extensions && R.extensions.has && R.extensions.has("EXT_frag_depth"))));
    const tier = plumeTier();
    const C = function () { return new THREE.Color(0, 0, 0); };
    const U = {
      uNoise: { value: plumeNoise() },
      uBoxMin: { value: new THREE.Vector3() }, uBoxMax: { value: new THREE.Vector3() },
      uVent: { value: new THREE.Vector3() },
      uCol: { value: new THREE.Vector4(1, 5, 0, 0) },
      uCol2: { value: new THREE.Vector4(1, 0, 0, 0) },
      uUmb: { value: new THREE.Vector4(0, 0, 10, 0) },
      uUmb2: { value: new THREE.Vector4(100, 20, 0, 0) },
      uUmbDir: { value: new THREE.Vector2(1, 0) },
      uGround: { value: 0 }, uTime: { value: 0 }, uSteps: { value: tier.steps }, uSigma: { value: 5.0 }, uRise: { value: 8 },
      uSunDir: { value: new THREE.Vector3(0.5, 0.7, 0.3).normalize() },
      uLit: { value: C() }, uShade: { value: C() }, uDeep: { value: C() },
      uSteamLit: { value: C() }, uSteamShade: { value: C() },
      uVentCol: { value: C() }, uVentK: { value: 0 }, uVentReach: { value: 20 }, uDay: { value: 1 },
      uFlash: { value: new THREE.Vector4() }, uFlashR: { value: 20 }, uFlashCol: { value: C() },
      uFog: { value: new THREE.Vector4() }, uFogCol: { value: C() },
    };
    const defs = { PLUME_MAXI: tier.maxi, PLUME_TAPS: tier.taps };
    if (fragDepth) defs.HAS_FRAG_DEPTH = 1;
    const mat = new THREE.ShaderMaterial({
      uniforms: U, vertexShader: PLUME_VS, fragmentShader: PLUME_FS, defines: defs,
      transparent: true, depthWrite: false, depthTest: true,
      side: THREE.BackSide, fog: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    });
    mat.extensions = { fragDepth: fragDepth };
    return mat;
  }
  let _plumeBox = null;
  function plumeBox() { return _plumeBox || (_plumeBox = new THREE.BoxGeometry(1, 1, 1)); }
  let _plumeWarm = null;
  function plumeWarm() {
    if (_plumeWarm || !CBZ.scene) return;
    try {
      const m = new THREE.Mesh(plumeBox(), plumeMaterial());
      m.frustumCulled = false; m.scale.setScalar(0.001); m.position.set(0, -500, 0);
      m.renderOrder = 7;
      let frames = 0;
      /* linked after its first draw; it then just stays hidden. Disposing it
         would drop r128's last reference to the program and the real column
         would link it again in its own birth frame. */
      m.onAfterRender = function () { if (++frames >= 2) m.visible = false; };
      CBZ.scene.add(m);
      _plumeWarm = m;
    } catch (e) { _plumeWarm = {}; }
  }

  const _sun3 = new THREE.Vector3(0.5, 0.7, 0.3);
  function sunDir3() {
    const s = CBZ.sun;
    if (s && s.position) {
      let dx = s.position.x, dy = s.position.y, dz = s.position.z;
      const tg = CBZ.sunTarget;
      if (tg && tg.position) { dx -= tg.position.x; dy -= tg.position.y; dz -= tg.position.z; }
      const L = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (L > 1e-4) _sun3.set(dx / L, Math.max(-0.2, dy / L), dz / L).normalize();
    } else {
      const b = sunBearing();
      _sun3.set(b.x * 0.6, 0.8, b.z * 0.6).normalize();
    }
    return _sun3;
  }
  function nightNow(opts) {
    return (opts && opts.night != null) ? clamp(+opts.night, 0, 1)
      : clamp(1 - (0.5 + 2.2 * (CBZ.sunHeight != null ? CBZ.sunHeight : 0.5)), 0, 1);
  }

  /* plumeVolume(parent): the one body both handles write into. The column
     owns the vent and the clock; the umbrella attaches to the column's
     volume (or makes its own when raised alone). Released by refcount. */
  function plumeVolume(parent) {
    const mat = plumeMaterial();
    const U = mat.uniforms;
    const mesh = new THREE.Mesh(plumeBox(), mat);
    mesh.name = "volcanoPlumeVolume";
    mesh.frustumCulled = false;
    mesh.renderOrder = 7;
    mesh.castShadow = mesh.receiveShadow = false;
    mesh.visible = false;
    parent.add(mesh);
    // screen-authored palette (see screenHex): neutral, faintly warm, never blue
    const P = {
      litD: new THREE.Color(screenHex(148, 139, 127)), shadeD: new THREE.Color(screenHex(50, 45, 41)),
      deepD: new THREE.Color(screenHex(26, 23, 21)),
      steamLitD: new THREE.Color(screenHex(194, 188, 178)), steamShadeD: new THREE.Color(screenHex(96, 92, 87)),
      litN: new THREE.Color(screenHex(30, 28, 27)), shadeN: new THREE.Color(screenHex(13, 12, 12)),
      deepN: new THREE.Color(screenHex(9, 8, 8)),
      steamN: new THREE.Color(screenHex(26, 25, 24)),
    };
    U.uVentCol.value.setHex(screenHex(236, 112, 40));
    U.uFlashCol.value.setHex(screenHex(228, 230, 238));
    const vent = new THREE.Vector3(), _wp = new THREE.Vector3();
    const box = { x0: -1, x1: 1, y0: -1, y1: 1, z0: -1, z1: 1 };
    const vol = {
      mesh: mesh, U: U, refs: 0, t: 0, owner: null, parent: parent,
      ventLocal: new THREE.Vector3(), groundLocal: 0,
      setVent(x, y, z) { vol.ventLocal.set(x, y, z); return vol; },
      light(night, fogless) {
        const k = night;
        U.uLit.value.copy(P.litD).lerp(P.litN, k);
        U.uShade.value.copy(P.shadeD).lerp(P.shadeN, k * 0.92);
        U.uDeep.value.copy(P.deepD).lerp(P.deepN, k);
        U.uSteamLit.value.copy(P.steamLitD).lerp(P.steamN, k);
        U.uSteamShade.value.copy(P.steamShadeD).lerp(P.steamN, k * 0.92);
        U.uDay.value = 1 - k;
        U.uSunDir.value.copy(sunDir3());
        const f = CBZ.scene && CBZ.scene.fog;
        if (!fogless && f && f.isFog) { U.uFog.value.set(1, f.near, f.far, 0); U.uFogCol.value.copy(f.color); }
        else U.uFog.value.x = 0;
      },
      /* the march box, recomputed from the shape uniforms every update:
         column + deck + fall streaks, with room for the noise to bulge */
      sync() {
        const c = U.uCol.value, c2 = U.uCol2.value, um = U.uUmb.value, u2 = U.uUmb2.value;
        let any = false;
        let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, z0 = 1e9, z1 = -1e9;
        if (c.w > 0.001) {
          // the shader's gH: the column reaches the deck while one is up
          const H = Math.max(1, c.x, u2.z > 0.001 ? u2.x : 0);
          const rT = (c.y + 0.2 * H) * 1.4 * (1 + 1.4 * c.z) * 1.6 + 2;
          const lx = c2.x * c2.z, lz = c2.y * c2.z;
          x0 = Math.min(x0, Math.min(0, lx) - rT); x1 = Math.max(x1, Math.max(0, lx) + rT);
          z0 = Math.min(z0, Math.min(0, lz) - rT); z1 = Math.max(z1, Math.max(0, lz) + rT);
          y0 = Math.min(y0, c2.w - 2); y1 = Math.max(y1, H + rT * 0.45 + 2);
          any = true;
        }
        if (u2.z > 0.001) {
          const ext = (um.z + um.w) * 1.15 + u2.y;
          x0 = Math.min(x0, um.x - ext); x1 = Math.max(x1, um.x + ext);
          z0 = Math.min(z0, um.y - ext); z1 = Math.max(z1, um.y + ext);
          const lowY = u2.w > 0.001 ? (vol.groundLocal - vol.ventLocal.y - 1) : (u2.x - u2.y * 1.5);
          y0 = Math.min(y0, lowY); y1 = Math.max(y1, u2.x + u2.y * 2.1);
          any = true;
        }
        mesh.visible = any;
        if (!any) return;
        box.x0 = x0; box.x1 = x1; box.y0 = y0; box.y1 = y1; box.z0 = z0; box.z1 = z1;
        const v = vol.ventLocal;
        mesh.position.set(v.x + (x0 + x1) * 0.5, v.y + (y0 + y1) * 0.5, v.z + (z0 + z1) * 0.5);
        mesh.scale.set(Math.max(0.1, x1 - x0), Math.max(0.1, y1 - y0), Math.max(0.1, z1 - z0));
        // the shader works in WORLD space: the parent may sit anywhere
        _wp.set(0, 0, 0);
        if (parent.matrixWorld) _wp.setFromMatrixPosition(parent.matrixWorld);
        vent.copy(v).add(_wp);
        U.uVent.value.copy(vent);
        U.uGround.value = vol.groundLocal + _wp.y;
        U.uBoxMin.value.set(vent.x + x0, vent.y + y0, vent.z + z0);
        U.uBoxMax.value.set(vent.x + x1, vent.y + y1, vent.z + z1);
      },
      acquire(who) { vol.refs++; if (!vol.owner) vol.owner = who; return vol; },
      release(who) {
        if (vol.owner === who) vol.owner = null;
        if (--vol.refs > 0) { vol.sync(); return; }
        if (mesh.parent) mesh.parent.remove(mesh);
        mat.dispose();
      },
    };
    return vol;
  }
  V.plumeVolume = plumeVolume;

  V.ashColumn = function (o) {
    o = o || {};
    const parent = o.parent || CBZ.scene;
    const x = +o.x || 0, z = +o.z || 0;
    const baseY = o.y != null ? +o.y : 0;
    const height = o.height > 0 ? +o.height : 55;
    const r0 = o.r > 0 ? +o.r : 7;
    /* `fogless`: the column is the eruption's LANDMARK — a 180 m pillar
       whose head sits 250+ m from any camera was being dissolved by the
       eruption's own fog wall (city/nukefx.js made the same call). */
    const fogless = !!o.fogless;
    const vol = plumeVolume(parent);
    vol.setVent(x, baseY, z);
    const U = vol.U;
    /* RISE: the head reaches full height in ~5.5 s (gas-thrust jet slowing
       to neutral buoyancy) and the column grows honestly from an empty vent
       instead of appearing whole. */
    const RISE = 5.5;
    U.uCol.value.set(0.5, r0, 0, 1);
    U.uRise.value = 3 + 0.075 * height;          // the billows' climb, m/s
    U.uVentReach.value = 20 + 1.1 * r0;          // the crater's glow reaches ~2 vent diameters up
    let t = 0, dead = false, done = false;
    /* COLLAPSE. A Plinian column stands only while the jet keeps it
       buoyant: when the mass flux outruns the air it can entrain, the dense
       core falls back on the vent and its foot billows outward over the
       rim — the birth of the density current. hk is the standing fraction:
       it sags to ~0.38 over 1.2 s, holds while the collapse feeds the
       current, and rebuilds over six seconds. */
    let slumpT = -1, hk = 1;
    function ease(u) { u = clamp(u, 0, 1); return u * u * (3 - 2 * u); }
    /* WANING: the vent stops feeding the column. The root lifts off the
       vent and climbs after the last of the ash while the body thins, so
       the pillar detaches and disperses instead of popping. */
    let waning = false, waneT = 0;
    const WANE = 9;
    let flashK = 0;
    const handle = {
      kind: "column", group: vol.mesh, puffCount: 0, volume: vol,
      get topY() { return baseY + height * hk; },   // standing top; the drawn body still reaches the deck
      get standing() { return hk; },
      get collapsing() { return slumpT >= 0; },
      get done() { return done; },
      height: height, baseY: baseY, x: x, z: z, r: r0,
      collapse() { if (slumpT < 0 || slumpT > 3.2) slumpT = 0; return handle; },
      wane() { waning = true; return handle; },
      flash(px, py, pz, k, rad) {
        flashK = Math.max(flashK, k == null ? 1 : +k);
        let wx = 0, wy = 0, wz = 0;
        if (parent.matrixWorld) { const e = parent.matrixWorld.elements; wx = e[12]; wy = e[13]; wz = e[14]; }
        U.uFlash.value.set(px + wx, py + wy, pz + wz, flashK);
        U.uFlashR.value = rad > 0 ? +rad : 20;
        return handle;
      },
      /* opts.night (0 day .. 1 night) is the caller's day clock; absent, the
         sky's own sun height answers. */
      update(dt, wx, wz, opts) {
        if (dead || done) return handle;
        if (!(dt > 0)) return handle;
        if (dt > 0.2) dt = 0.2;
        t += dt;
        vol.t += dt;
        U.uTime.value = vol.t;
        if (slumpT >= 0) {
          slumpT += dt;
          if (slumpT < 1.2) hk = 1 - 0.62 * ease(slumpT / 1.2);
          else if (slumpT < 3.2) hk = 0.38;
          else if (slumpT < 9.2) hk = 0.38 + 0.62 * ease((slumpT - 3.2) / 6);
          else { hk = 1; slumpT = -1; }
        }
        flashK *= Math.exp(-dt * 16);
        if (flashK < 0.01) flashK = 0;
        U.uFlash.value.w = flashK;
        const grow = 1 - Math.pow(1 - Math.min(1, t / RISE), 1.45);
        let pres = 1, cut = 0;
        if (waning) {
          waneT += dt;
          const k = clamp(waneT / WANE, 0, 1);
          pres = 1 - k * k;
          cut = height * hk * ease(k) * 0.85;
          if (k >= 1) { done = true; pres = 0; }
        }
        U.uCol.value.set(Math.max(0.5, height * hk * grow), r0, 1 - hk, pres);
        U.uCol2.value.set(wx || 0, wz || 0, height * 0.27 * hk, cut);
        const night = nightNow(opts);
        U.uVentK.value = waning ? 0 : (0.12 + 0.7 * night);
        vol.light(night, fogless);
        vol.sync();
        return handle;
      },
      dispose() {
        if (dead) return;
        dead = true;
        U.uCol.value.w = 0;
        vol.release(handle);
        const k = LIVE.column.indexOf(handle); if (k >= 0) LIVE.column.splice(k, 1);
      },
    };
    vol.acquire(handle);
    LIVE.column.push(handle);
    return handle;
  };

  /* ============================================================
     THE UMBRELLA CLOUD — where a Plinian column stops climbing.

     A Plinian column climbs until its mixture of hot gas, ash and entrained
     air is no denser than the air around it, overshoots a little, then
     SPREADS SIDEWAYS as a gravity current at that height. That flat, dark,
     ever-widening deck is the eruption's real footprint: the ash that
     buries the downwind town falls OUT OF IT.

       SPREAD   r ~ t^(3/4) (Sparks et al.), from the head's width to rMax.
       WIND     it cannot spread upwind faster than the wind pushes it back,
                so the deck is an off-centre lens stretched downwind.
       LENS     thickest over the vent (the overshoot dome), thin at the rim;
                belly in its own shadow (the volume's sun taps do that).
       CURTAINS once the deck is a few seconds old, fall streaks hang under
                its downwind half.

     Drawn by the column's plume volume (one body, no seam where the head
     meets the deck). coverAt(x, z) is the analytic footprint the caller
     reads to darken the sky — the same lens the shader draws.
     ============================================================ */
  V.umbrella = function (o) {
    o = o || {};
    const parent = o.parent || CBZ.scene;
    const x0 = +o.x || 0, z0 = +o.z || 0;
    const y0 = o.y != null ? +o.y : 120;
    const thick = o.thick > 0 ? +o.thick : 30;
    const r0 = o.r0 > 0 ? +o.r0 : 30;
    const rMax = Math.max(r0 + 1, o.rMax > 0 ? +o.rMax : 150);
    const stretchMax = o.stretch > 0 ? +o.stretch : 80;
    const T = o.spreadSecs > 0 ? +o.spreadSecs : 22;
    const groundY = o.groundY != null ? +o.groundY : 0;
    const fogless = !!o.fogless;
    // ride the column's volume when there is one over this vent
    let col = o.column && o.column.volume ? o.column : null;
    if (!col) {
      for (let i = LIVE.column.length - 1; i >= 0; i--) {
        const c = LIVE.column[i];
        if (c.volume && c.volume.parent === parent && Math.hypot(c.x - x0, c.z - z0) < 30) { col = c; break; }
      }
    }
    const vol = col ? col.volume : plumeVolume(parent);
    if (!col) vol.setVent(x0, y0 - thick, z0);
    const U = vol.U;
    const vy = vol.ventLocal.y;
    let age = 0, feed = 1, fade = 1, cx = x0, cz = z0, R = r0, S = 0, dead = false, done = false;
    let ux = 1, uz = 0, flashK = 0;
    const handle = {
      kind: "umbrella", group: vol.mesh, puffCount: 0, y: y0, thick: thick, volume: vol,
      get radius() { return R; },
      get stretch() { return S; },
      get downwindReach() { return R + S; },
      get centre() { return { x: cx, z: cz }; },
      get age() { return age; },
      get done() { return done; },
      get fade() { return fade; },
      // the column stopped feeding it: the deck drifts off downwind and thins
      starve() { feed = 0; return handle; },
      flash(px, py, pz, k, rad) {
        flashK = Math.max(flashK, k == null ? 1 : +k);
        let wx = 0, wy = 0, wz = 0;
        if (parent.matrixWorld) { const e = parent.matrixWorld.elements; wx = e[12]; wy = e[13]; wz = e[14]; }
        U.uFlash.value.set(px + wx, py + wy, pz + wz, Math.max(U.uFlash.value.w, flashK));
        U.uFlashR.value = Math.max(U.uFlashR.value, rad > 0 ? +rad : 30);
        return handle;
      },
      /* 0..1: how much deck is overhead at (x, z) — the shader's own lens */
      coverAt(x, z) {
        if (dead || fade <= 0) return 0;
        const dx = x - cx, dz = z - cz;
        const a = dx * ux + dz * uz, c = -dx * uz + dz * ux;
        const ex = a > 0 ? R + S : R * 0.9, ey = R + 0.22 * S;
        const qq = (a * a) / (ex * ex) + (c * c) / (ey * ey);
        return fade * clamp((1.12 - qq) / 0.42, 0, 1) * clamp(age / 3, 0, 1);
      },
      update(dt, wx, wz, opts) {
        if (dead || done) return handle;
        if (!(dt > 0)) return handle;
        if (dt > 0.2) dt = 0.2;
        age += dt;
        // the column owns the clock while it stands; alone, the deck keeps it
        if (!vol.owner || vol.owner === handle || (vol.owner.done)) { vol.t += dt; U.uTime.value = vol.t; }
        const wl = Math.hypot(wx || 0, wz || 0);
        if (wl > 1e-3) {
          ux += ((wx / wl) - ux) * Math.min(1, dt * 0.5);
          uz += ((wz / wl) - uz) * Math.min(1, dt * 0.5);
          const ul = Math.hypot(ux, uz) || 1; ux /= ul; uz /= ul;
        }
        if (feed > 0) {
          const k = Math.min(1, age / T);
          R = r0 + (rMax - r0) * Math.pow(k, 0.75);
          S = stretchMax * k;
        } else {
          // starved: the whole deck rides the wind off the island and thins
          const ws = opts && opts.windSpeed > 0 ? +opts.windSpeed : 6;
          cx += ux * ws * dt; cz += uz * ws * dt;
          S += ws * 0.4 * dt;
          fade -= dt / 26;
          if (fade <= 0) { fade = 0; done = true; U.uUmb2.value.z = 0; U.uUmb2.value.w = 0; vol.sync(); return handle; }
        }
        flashK *= Math.exp(-dt * 14);
        if (flashK < 0.01) flashK = 0;
        if (vol.owner === handle || !vol.owner || vol.owner.done) U.uFlash.value.w = flashK;
        const grow = clamp(age / 2.5, 0, 1);
        const fallK = clamp((age - 5) / 6, 0, 1) * fade;
        U.uUmb.value.set(cx - vol.ventLocal.x, cz - vol.ventLocal.z, R, S);
        U.uUmb2.value.set(y0 - vy, thick, fade * grow, (y0 - thick * 0.5 - groundY) > 8 ? fallK * 0.8 : 0);
        U.uUmbDir.value.set(ux, uz);
        vol.groundLocal = groundY;
        if (!col || col.done) vol.light(nightNow(opts), fogless);
        vol.sync();
        return handle;
      },
      dispose() {
        if (dead) return;
        dead = true;
        U.uUmb2.value.z = 0; U.uUmb2.value.w = 0;
        vol.release(handle);
        const k = LIVE.umbrella.indexOf(handle); if (k >= 0) LIVE.umbrella.splice(k, 1);
      },
    };
    vol.acquire(handle);
    LIVE.umbrella.push(handle);
    return handle;
  };

  /* ============================================================
     THE PHREATIC BLAST — the mountain clearing its throat.

     Before fresh magma reaches the surface it flashes the groundwater
     above it to steam, and the summit fails in one violent, cold, DIRTY
     explosion: no incandescence, just shattered old rock and boiling water
     thrown out of the crater. The classic photographs (Ontake 2014, Whakaari
     2019, Taal 2020) all show the same two shapes:

       THE COCK'S TAIL  a crown of black-grey jets fanned out of the crater at
                        30-80 degrees, each one dragging a train of debris,
                        decelerating hard in the air and then hanging there
                        while it condenses whiter at the edges;
       THE BASE SURGE   a low ring of steam and grit that leaves the crater
                        rim sideways and rolls DOWN the cone faster than a
                        car, hugging the ground, thinning as it goes.

     Both are particles with their own little physics (quadratic-ish drag
     on the jets, buoyancy on the steam, a decelerating radial run on the
     surge), all in ONE instanced draw. surgeAt(x, z) is the scalding steam
     band for the caller's damage pass — what is drawn is what burns.
     ============================================================ */
  V.phreatic = function (o) {
    o = o || {};
    const parent = o.parent || CBZ.scene;
    const groundAt = o.groundAt || flatGround;
    const x = +o.x || 0, z = +o.z || 0;
    const y = o.y != null ? +o.y : groundAt(x, z);
    const mag = clamp(o.mag != null ? +o.mag : 0.5, 0, 1);
    const rim = o.r > 0 ? +o.r : 6;
    const coneR = o.coneR > 0 ? +o.coneR : 36;
    const N = qi(84, 156);
    const B = puffBatch(N, { map: puffAtlas(), tiles: 3, fog: true, parent: parent, renderOrder: 7 });
    let seed = ((o.salt | 0) ^ 0x2545f491) >>> 0;
    const rnd = function () { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    const C_DIRT = new THREE.Color(screenHex(40, 37, 34));
    const C_STEAM = new THREE.Color(screenHex(206, 203, 196));
    const C_SURGE = new THREE.Color(screenHex(170, 165, 156));
    const C_NIGHT = new THREE.Color(screenHex(26, 26, 30));
    const K = 5 + Math.round(4 * mag);
    const jets = [];
    for (let j = 0; j < K; j++) {
      const az = (j / K) * 6.2832 + (rnd() - 0.5) * 0.7;
      // one near-vertical jet in the middle, the rest fanned out
      const el = j === 0 ? 1.35 + rnd() * 0.15 : 0.52 + rnd() * 0.75;
      jets.push({ az: az, el: el, v: (24 + 30 * mag) * (0.75 + 0.5 * rnd()) });
    }
    const SURGE_V = 16 + 14 * mag;
    const parts = [];
    for (let i = 0; i < N; i++) {
      const surge = i % 5 >= 3;     // 40%: the base surge ring
      const p = { surge: surge, born: false, tb: 0, x: x, y: y, z: z, vx: 0, vy: 0, vz: 0, r: rim, vr: 0, a: 0,
        s0: 0, steam: rnd(), tile: i % 3, rot: (rnd() - 0.5) * 0.4, life: 0, maxL: 0 };
      if (surge) {
        p.tb = 0.25 + rnd() * 0.8;
        p.a = rnd() * 6.2832;
        p.vr = SURGE_V * (0.6 + 0.5 * rnd());
        p.s0 = 2.5 + 2 * rnd();
        p.maxL = 9 + 4 * rnd();
      } else {
        const J = jets[i % K];
        p.tb = Math.pow(rnd(), 1.6) * 1.1;
        const az = J.az + (rnd() - 0.5) * 0.3, el = J.el + (rnd() - 0.5) * 0.18;
        // the head of each jet leaves fastest; the train behind it slower
        const sp = J.v * (0.35 + 0.65 * rnd());
        p.vx = Math.cos(az) * Math.cos(el) * sp;
        p.vz = Math.sin(az) * Math.cos(el) * sp;
        p.vy = Math.sin(el) * sp;
        p.s0 = 1.6 + 2.2 * rnd();
        p.maxL = 10 + 6 * rnd();
      }
      parts.push(p);
    }
    const col = new THREE.Color();
    let t = 0, dead = false, done = false, surgeR = rim;
    const handle = {
      kind: "phreatic", group: B.mesh, puffCount: N,
      get age() { return t; },
      get done() { return done; },
      get surgeRadius() { return surgeR; },
      /* 0..1: inside the rolling steam band right now. The band is the
         surge's own front +- a few metres, live only while it is still
         dense (first ~5 s); the drawn ring is the hitbox. */
      surgeAt(px, pz) {
        if (dead || t > 5.5) return 0;
        const d = Math.hypot(px - x, pz - z);
        const band = 4 + surgeR * 0.12;
        if (Math.abs(d - surgeR) > band) return 0;
        return clamp(1 - t / 5.5, 0, 1) * (1 - Math.abs(d - surgeR) / band);
      },
      update(dt, opts) {
        if (dead || done) return handle;
        if (!(dt > 0)) return handle;
        if (dt > 0.2) dt = 0.2;
        t += dt;
        const night = (opts && opts.night != null) ? clamp(+opts.night, 0, 1) : 0;
        const ww = opts && opts.windX != null ? opts : null;
        let live = 0, far = rim;
        for (let i = 0; i < N; i++) {
          const p = parts[i];
          if (t < p.tb) { B.hide(i); continue; }
          p.life += dt;
          if (p.life > p.maxL) { B.hide(i); continue; }
          live++;
          const L = p.life;
          if (p.surge) {
            // a density current that runs out of momentum on the apron
            p.vr *= Math.exp(-0.42 * dt);
            p.r = Math.min(coneR * 1.35, p.r + p.vr * dt);
            if (p.r > far && L < 5) far = p.r;
            const px = x + Math.cos(p.a) * p.r, pz = z + Math.sin(p.a) * p.r;
            const s = p.s0 + 2.2 * L * (0.7 + 0.6 * mag);
            const gy = groundAt(px, pz);
            col.copy(C_SURGE);
            if (night > 0) col.lerp(C_NIGHT, night * 0.8);
            const a = 0.72 * clamp(L / 0.25, 0, 1) * clamp((p.maxL - L) / 5, 0, 1);
            B.set(i, px, gy + s * 0.32 + L * 0.5, pz, s * 1.3, s * 0.7, p.rot, p.tile, col.r, col.g, col.b, a, 0);
            continue;
          }
          // jets: hard drag (the debris train decelerates in a second or two),
          // then the cloud hangs and the steam fraction climbs on buoyancy
          const drag = Math.exp(-1.25 * dt);
          p.vx *= drag; p.vz *= drag; p.vy *= drag;
          p.vy += (p.steam > 0.45 ? 2.4 : -3.2) * dt;
          if (ww) { p.vx += (ww.windX || 0) * 1.2 * dt; p.vz += (ww.windZ || 0) * 1.2 * dt; }
          p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
          const gy = groundAt(p.x, p.z);
          if (p.y < gy + 1) { p.y = gy + 1; p.vy = Math.abs(p.vy) * 0.2; }
          const s = p.s0 + 3.4 * L * (0.6 + 0.6 * mag);
          // dark dirty jet, condensing whiter at the edges as it ages
          col.copy(C_DIRT).lerp(C_STEAM, clamp(L / 5, 0, 1) * (0.25 + 0.75 * p.steam));
          if (night > 0) col.lerp(C_NIGHT, night * 0.8);
          const a = 0.8 * clamp(L / 0.12, 0, 1) * clamp((p.maxL - L) / 6, 0, 1);
          B.set(i, p.x, p.y, p.z, s, s * 0.95, p.rot, p.tile, col.r, col.g, col.b, a, 0);
        }
        surgeR = far;
        B.commit();
        if (t > 1.5 && live === 0) done = true;
        return handle;
      },
      dispose() {
        if (dead) return;
        dead = true;
        B.dispose();
      },
    };
    return handle;
  };

  /* ============================================================
     BALLISTIC BOMBS — rocks on real parabolas, with real impacts.

     A volcanic bomb is a lump of rock thrown out of the vent at 50-200 m/s
     that flies a drag-light parabola, and the reason it kills is mass and
     speed, nothing else. So each one here is a body: launched from the
     crater on an elevation and a muzzle speed SOLVED for where ballistics
     puts it, integrated under the game's gravity every frame, and stopped by
     whatever it actually meets first — the cone's own flank on a low shot, a
     roof, a car, the ground. Nothing is placed: if the arc clips the
     mountain on the way down, that is where it lands.

       JUVENILE  fresh magma: incandescent in flight (white-orange cooling to
                 dull red on the way down, unlit = self-luminous), trailing a
                 dark degassing streak, and still glowing in its crater for
                 twenty seconds after it lands.
       LITHIC    the phreatic blast's cold shattered old rock: grey, lit,
                 trailing pale dust.

     AN IMPACT LEAVES A CRATER: a pit with a lighter ejecta rim, draped on
     the ground's own slope, plus a burst of dust. The bomb itself stays,
     half-buried, cooling. The caller hears every landing through onLand
     with the mass, the speed and what was hit, and prices it.

     Draws: hot rocks 1, cold rocks 1, trails+dust 1, craters 1 — however
     many bombs are in the air.
     ============================================================ */
  let _bombGeo = null, _craterGeo = null;
  function bombGeo() {
    if (_bombGeo) return _bombGeo;
    const g = new THREE.IcosahedronGeometry(1, 1);
    const p = g.attributes.position;
    // jitter by POSITION, not index: the polyhedron is non-indexed, so the
    // same corner appears in up to six triangles and must move as one
    for (let i = 0; i < p.count; i++) {
      const vx = p.getX(i), vy = p.getY(i), vz = p.getZ(i);
      const k = 0.78 + 0.4 * h01(Math.round(vx * 97 + vz * 13), Math.round(vy * 89 - vz * 31), 4441);
      p.setXYZ(i, vx * k * 1.08, vy * k * 0.84, vz * k);
    }
    g.computeVertexNormals();
    _bombGeo = g;
    return g;
  }
  function craterGeo() {
    if (_craterGeo) return _craterGeo;
    // a fan: centre, pit ring, ejecta crest, ragged outer edge — opaque
    // vertex colours, its outline lobed so no crater is a coin
    const SEG = 20;
    const pos = [0, -0.06, 0], colA = [];
    const pit = new THREE.Color(0.016, 0.013, 0.011), lip = new THREE.Color(0.075, 0.066, 0.058), out = new THREE.Color(0.05, 0.045, 0.04);
    colA.push(pit.r, pit.g, pit.b);
    const rings = [[0.42, -0.03, pit], [0.72, 0.05, lip], [1.0, 0.0, out]];
    for (let r = 0; r < rings.length; r++) {
      for (let k = 0; k < SEG; k++) {
        const a = (k / SEG) * 6.2832;
        const lob = r === 2 ? 0.78 + 0.44 * h01(k, 7, 5531) : (r === 1 ? 0.92 + 0.16 * h01(k, 3, 5537) : 1);
        const R = rings[r][0] * lob;
        pos.push(Math.cos(a) * R, rings[r][1], Math.sin(a) * R);
        const c = rings[r][2];
        colA.push(c.r, c.g, c.b);
      }
    }
    const idx = [];
    for (let k = 0; k < SEG; k++) idx.push(0, 1 + (k + 1) % SEG, 1 + k);
    for (let r = 0; r < 2; r++) {
      const a0 = 1 + r * SEG, b0 = 1 + (r + 1) * SEG;
      for (let k = 0; k < SEG; k++) {
        const k1 = (k + 1) % SEG;
        idx.push(a0 + k, a0 + k1, b0 + k1, a0 + k, b0 + k1, b0 + k);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(colA, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    _craterGeo = g;
    return g;
  }
  V.bombs = function (o) {
    o = o || {};
    const parent = o.parent || CBZ.scene;
    const groundAt = o.groundAt || flatGround;
    const G = o.gravity > 0 ? +o.gravity : ((CBZ.TUNE && CBZ.TUNE.gravity > 0) ? CBZ.TUNE.gravity : 20);
    const MAX = Math.max(8, o.max | 0 || 48);           // bodies alive (flying + resting)
    const NC = Math.max(4, o.craters | 0 || qi(24, 64));
    const rnd = typeof o.rnd === "function" ? o.rnd : Math.random;
    const geo = bombGeo();
    const hotMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const coldMat = new THREE.MeshPhongMaterial({ color: 0xffffff, flatShading: true, shininess: 0, specular: 0x000000 });
    const hot = new THREE.InstancedMesh(geo, hotMat, MAX);
    const cold = new THREE.InstancedMesh(geo, coldMat, MAX);
    const _c = new THREE.Color(1, 1, 1);
    for (let i = 0; i < MAX; i++) { hot.setColorAt(i, _c); cold.setColorAt(i, _c); }
    hot.count = 0; cold.count = 0;
    hot.frustumCulled = cold.frustumCulled = false;
    cold.castShadow = true;
    hot.renderOrder = 3;
    parent.add(hot); parent.add(cold);
    const crMat = new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const craters = new THREE.InstancedMesh(craterGeo(), crMat, NC);
    craters.count = 0; craters.frustumCulled = false; craters.receiveShadow = true;
    parent.add(craters);
    let crN = 0, crNext = 0;
    const TRAIL = qi(90, 190);
    const TB = puffBatch(TRAIL, { map: puffAtlas(), tiles: 3, fog: true, parent: parent, renderOrder: 7 });
    const trail = [];
    for (let i = 0; i < TRAIL; i++) trail.push({ live: false, x: 0, y: 0, z: 0, vy: 0, age: 0, life: 1, s0: 1, s1: 2, r: 0, g: 0, b: 0, a: 0.4, tile: i % 3 });
    let trailNext = 0;
    function puff(x, y, z, life, s0, s1, c, a, vy) {
      const p = trail[trailNext]; trailNext = (trailNext + 1) % TRAIL;
      p.live = true; p.x = x; p.y = y; p.z = z; p.age = 0; p.life = life; p.s0 = s0; p.s1 = s1;
      p.r = c.r; p.g = c.g; p.b = c.b; p.a = a; p.vy = vy || 0;
    }
    const C_HOT = new THREE.Color(screenHex(255, 236, 190));
    const C_MID = new THREE.Color(screenHex(255, 122, 30));
    const C_OLD = new THREE.Color(screenHex(120, 22, 6));
    const C_ROCK = new THREE.Color(0.055, 0.047, 0.042);   // lit basalt (Phong multiplies)
    const C_LITHIC = new THREE.Color(0.16, 0.15, 0.14);    // old grey andesite
    const C_SMOKE = new THREE.Color(screenHex(54, 50, 47));
    const C_DUST = new THREE.Color(screenHex(118, 108, 96));
    const C_PALE = new THREE.Color(screenHex(160, 156, 148));
    const bodies = [];
    const stats = { thrown: 0, landed: 0, craters: 0, roof: 0, car: 0, ground: 0, maxSpeed: 0, maxRange: 0 };
    const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
    const _up = new THREE.Vector3(0, 1, 0), _n = new THREE.Vector3(), _e = new THREE.Euler();
    function addCrater(x, z, r) {
      const e = 0.6;
      const hx1 = groundAt(x + e, z), hx0 = groundAt(x - e, z), hz1 = groundAt(x, z + e), hz0 = groundAt(x, z - e);
      _n.set(hx0 - hx1, 2 * e, hz0 - hz1).normalize();
      _q.setFromUnitVectors(_up, _n);
      _p.set(x, groundAt(x, z) + 0.04, z);
      _s.set(r, r, r);
      _m.compose(_p, _q, _s);
      craters.setMatrixAt(crNext, _m);
      crNext = (crNext + 1) % NC;
      crN = Math.min(NC, crN + 1);
      craters.count = crN;
      craters.instanceMatrix.needsUpdate = true;
      stats.craters++;
    }
    const handle = {
      kind: "bombs", stats: stats,
      get inFlight() { let n = 0; for (let i = 0; i < bodies.length; i++) if (!bodies[i].landed) n++; return n; },
      /* the predicted landing of every rock in the air — the bot flee field
         and any HUD read this, so a bomb is avoidable by watching it */
      forEachFlying(fn) {
        for (let i = 0; i < bodies.length; i++) { const b = bodies[i]; if (!b.landed) fn(b.tx, b.tz, b.size, b.eta); }
      },
      /* throw one. {x,y,z} the muzzle, {tx,tz} the aim, `elev` the launch
         angle off horizontal (rad), `size` the radius (m), `hot` juvenile or
         lithic. The muzzle speed is SOLVED for the aim under G; the rock then
         flies free and lands wherever it really meets the world. */
      throwTo(b) {
        if (bodies.length >= MAX) {
          // recycle the oldest RESTING rock; never one still in the air
          let k = -1;
          for (let i = 0; i < bodies.length; i++) if (bodies[i].landed) { k = i; break; }
          if (k < 0) return null;
          bodies.splice(k, 1);
        }
        const x0 = +b.x, y0 = +b.y, z0 = +b.z;
        const dx = b.tx - x0, dz = b.tz - z0, D = Math.hypot(dx, dz) || 0.01;
        const ty = groundAt(b.tx, b.tz);
        let el = b.elev != null ? +b.elev : 0.95;
        let den = 2 * Math.cos(el) * Math.cos(el) * (D * Math.tan(el) - (ty - y0));
        while (den <= 0.01 && el < 1.45) { el += 0.08; den = 2 * Math.cos(el) * Math.cos(el) * (D * Math.tan(el) - (ty - y0)); }
        const v = Math.sqrt(Math.max(1, G * D * D / Math.max(0.01, den)));
        const vh = v * Math.cos(el);
        const size = b.size > 0 ? +b.size : 0.6;
        const body = {
          x: x0, y: y0, z: z0, vx: dx / D * vh, vy: v * Math.sin(el), vz: dz / D * vh,
          tx: b.tx, tz: b.tz, eta: D / Math.max(0.1, vh),
          size: size, hot: b.hot !== false, temp: b.hot !== false ? 1 : 0,
          mass: 2600 * 4.19 * size * size * size,
          rx: rnd() * 6, ry: rnd() * 6, rz: rnd() * 6,
          sx: (rnd() - 0.5) * 7, sy: (rnd() - 0.5) * 7, sz: (rnd() - 0.5) * 7,
          trailT: 0, landed: false, rest: 0, v0: v,
        };
        bodies.push(body);
        stats.thrown++;
        stats.maxSpeed = Math.max(stats.maxSpeed, v);
        return body;
      },
      update(dt) {
        if (!(dt > 0)) return handle;
        if (dt > 0.1) dt = 0.1;
        let nh = 0, nc = 0;
        for (let i = bodies.length - 1; i >= 0; i--) {
          const b = bodies[i];
          if (!b.landed) {
            b.vy -= G * dt;
            b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
            b.eta -= dt;
            b.rx += b.sx * dt; b.ry += b.sy * dt; b.rz += b.sz * dt;
            // a big bomb's skin chills in flight but its core does not
            if (b.hot) b.temp = Math.max(0.35, b.temp - dt * 0.09 / Math.max(0.4, b.size));
            b.trailT -= dt;
            if (b.trailT <= 0) {
              b.trailT = 0.05;
              puff(b.x, b.y, b.z, 1.6 + rnd() * 0.8, b.size * 1.1, b.size * 4.5, b.hot ? C_SMOKE : C_PALE, b.hot ? 0.42 : 0.3, 0.6);
            }
            let hit = null, gy = 0;
            if (b.vy < 0 && o.solids) { try { hit = o.solids(b.x, b.y - b.size * 0.5, b.z); } catch (e) { hit = null; } }
            if (hit) gy = hit.y;
            else gy = groundAt(b.x, b.z);
            if (b.y - b.size * 0.4 <= gy) {
              b.landed = true;
              const speed = Math.hypot(b.vx, b.vy, b.vz);
              b.y = gy + b.size * (hit ? 0.5 : 0.25);
              stats.landed++;
              const range = Math.hypot(b.x - (o.ventX || 0), b.z - (o.ventZ || 0));
              stats.maxRange = Math.max(stats.maxRange, range);
              if (hit) { if (hit.kind === "roof") stats.roof++; else if (hit.kind === "car") stats.car++; }
              else {
                stats.ground++;
                // a crater only where a rock hit DIRT hard enough to dig one
                if (speed > 10) addCrater(b.x, b.z, Math.min(4.5, b.size * (1.5 + speed / 30)));
              }
              for (let k = 0; k < 7; k++) {
                const a = rnd() * 6.2832, rr = b.size * (0.6 + rnd() * 1.8);
                puff(b.x + Math.cos(a) * rr, gy + b.size * 0.5, b.z + Math.sin(a) * rr, 2.4 + rnd() * 1.6,
                  b.size * 1.6, b.size * (4 + speed / 12), C_DUST, 0.55, 1.2 + rnd());
              }
              if (o.onLand) {
                try {
                  o.onLand({ x: b.x, y: gy, z: b.z, speed: speed, mass: b.mass, size: b.size, hot: b.hot, hit: hit, range: range });
                } catch (e) { /* a caller's bug must not stop the rocks */ }
              }
            }
          } else {
            b.rest += dt;
            if (b.hot) b.temp = Math.max(0, b.temp - dt / (14 + 18 * b.size));
          }
          // draw: glowing while it is hotter than dull red, rock after
          _e.set(b.rx, b.ry, b.rz); _q.setFromEuler(_e);
          _p.set(b.x, b.y, b.z); _s.setScalar(b.size);
          _m.compose(_p, _q, _s);
          if (b.hot && b.temp > 0.12) {
            const k = 1 - b.temp;
            if (k < 0.45) _c.copy(C_HOT).lerp(C_MID, k / 0.45);
            else _c.copy(C_MID).lerp(C_OLD, (k - 0.45) / 0.55);
            hot.setMatrixAt(nh, _m); hot.setColorAt(nh, _c); nh++;
          } else {
            _c.copy(b.hot ? C_ROCK : C_LITHIC);
            cold.setMatrixAt(nc, _m); cold.setColorAt(nc, _c); nc++;
          }
        }
        hot.count = nh; cold.count = nc;
        hot.instanceMatrix.needsUpdate = cold.instanceMatrix.needsUpdate = true;
        if (hot.instanceColor) hot.instanceColor.needsUpdate = true;
        if (cold.instanceColor) cold.instanceColor.needsUpdate = true;
        hot.visible = nh > 0; cold.visible = nc > 0;
        // the smoke and dust: rise a little, grow, thin
        let any = false;
        for (let i = 0; i < TRAIL; i++) {
          const p = trail[i];
          if (!p.live) { TB.hide(i); continue; }
          p.age += dt;
          if (p.age >= p.life) { p.live = false; TB.hide(i); continue; }
          any = true;
          const u = p.age / p.life;
          p.y += p.vy * dt;
          const s = p.s0 + (p.s1 - p.s0) * Math.sqrt(u);
          TB.set(i, p.x, p.y, p.z, s, s, 0, p.tile, p.r, p.g, p.b, p.a * (1 - u) * clamp(p.age / 0.08, 0, 1), 0);
        }
        TB.commit();
        TB.mesh.visible = any;
        return handle;
      },
      dispose() {
        parent.remove(hot); parent.remove(cold); parent.remove(craters);
        hotMat.dispose(); coldMat.dispose(); crMat.dispose();
        hot.dispose && hot.dispose(); cold.dispose && cold.dispose(); craters.dispose && craters.dispose();
        TB.dispose();
        const k = LIVE.bombs.indexOf(handle); if (k >= 0) LIVE.bombs.splice(k, 1);
      },
    };
    LIVE.bombs.push(handle);
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
    // one additive instanced draw for every clot (was one Sprite call each)
    /* renderOrder 6, UNDER the plume volume (7): the fountain stands inside
       the column's foot, so the ash must hide it, not have it glow through */
    const B = puffBatch(N, { map: glowTex(), tiles: 1, additive: true, fog: false, parent: parent, renderOrder: 6 });
    const _fc = new THREE.Color();
    let seed = (((x * 73856093) | 0) ^ ((z * 19349663) | 0) ^ 0x1d3f77b1) >>> 0;
    const rnd = function () { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    const clots = [];
    /* THE JET AND THE SPATTER. Fissure 8 and Fagradalsfjall both show a
       fire fountain as two things: a dense, low, near-vertical JET of
       incandescent clots standing on the vent (the brightest, most
       continuous thing in the frame) and the individual spatter thrown
       higher and wider out of it, cooling red on the way down. A third of
       the clots are the jet: slower, fatter, tighter to the axis. */
    function launch(P) {
      const a = rnd() * 6.2832, rr = Math.sqrt(rnd()) * mouth * (P.jet ? 0.6 : 1);
      P.x = x + Math.cos(a) * rr; P.y = baseY; P.z = z + Math.sin(a) * rr;
      // tilt off vertical inside the cone, thrown roughly outward from the
      // axis so the fan opens the way a jet does instead of crossing itself
      const tilt = P.jet ? CONE * 0.4 * rnd() : CONE * (0.2 + 0.8 * rnd());
      const az = a + (rnd() - 0.5) * 1.5;
      const sp = V0 * (P.jet ? 0.22 + 0.26 * rnd() : 0.48 + 0.64 * rnd());
      const st = Math.sin(tilt);
      P.vx = Math.cos(az) * st * sp;
      P.vy = Math.cos(tilt) * sp;
      P.vz = Math.sin(az) * st * sp;
      P.age = 0;
      P.gy = null;
      // the clots thrown hardest are the big bombs
      P.sz = P.jet ? 1.2 + 0.9 * rnd() : 0.5 + 1.05 * (0.35 * rnd() + 0.65 * clamp((sp / V0 - 0.48) / 0.64, 0, 1));
      P.tf = Math.max(0.35, 2 * P.vy / G);
    }
    for (let i = 0; i < N; i++) {
      const P = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, age: 0, tf: 1, sz: 1, gy: null, wait: (i / N) * 1.2, jet: i % 3 === 0 };
      launch(P);
      clots.push(P);
    }
    let dead = false, active = 1;
    const handle = {
      kind: "fountain", group: B.mesh, clotCount: N,
      setActive(k) { active = clamp(k == null ? 1 : +k, 0, 1); return handle; },
      update(dt) {
        if (dead) return handle;
        if (!(dt > 0)) return handle;
        if (dt > 0.2) dt = 0.2;
        const live = Math.max(1, Math.round(N * (0.25 + 0.75 * active)));
        for (let i = 0; i < clots.length; i++) {
          const P = clots[i];
          if (i >= live) { B.hide(i); continue; }
          if (P.wait > 0) { P.wait -= dt; B.hide(i); continue; }
          P.age += dt;
          P.vy -= G * dt;
          P.x += P.vx * dt; P.y += P.vy * dt; P.z += P.vz * dt;
          /* THE GROUND IS ONLY ASKED ONCE PER FLIGHT. A height-field probe
             per clot per frame is a hundred lookups a tick for an answer
             that does not move; the sample is taken the moment a falling
             clot passes the vent lip and kept until it lands. */
          if (P.vy < 0 && P.y < baseY) {
            if (P.gy == null) { try { P.gy = +groundAt(P.x, P.z) || 0; } catch (e) { P.gy = baseY - 30; } }
            if (P.y <= P.gy) { launch(P); B.hide(i); continue; }
          }
          const k = clamp(P.age / P.tf, 0, 1);
          // white-yellow -> orange -> dull red, and dimming the whole way
          const col = _fc;
          if (k < 0.42) col.copy(F_HOT).lerp(F_MID, k / 0.42);
          else col.copy(F_MID).lerp(F_OLD, (k - 0.42) / 0.58);
          // the jet stays hot; spatter falling back has lost most of its light
          if (P.jet) col.copy(F_HOT).lerp(F_MID, Math.min(1, k * 1.3));
          const op = (P.jet ? 0.7 : 0.82) * (1 - 0.6 * k) * (P.vy < 0 && !P.jet ? 0.75 : 1) * clamp(P.age / 0.06, 0, 1);
          /* A CLOT IS MOVING. Stretching the card along the flight — most of
             which is vertical — is the whole difference between a bead and a
             tracer, and it costs one scale component. It relaxes to a round
             lump at the apex, where the clot really has stopped. */
          const s = P.sz * (1 + 0.3 * k);
          const stretch = 1 + 0.55 * clamp(Math.abs(P.vy) / V0, 0, 1);
          B.set(i, P.x, P.y, P.z, s / Math.sqrt(stretch), s * stretch, 0, 0, col.r, col.g, col.b, op, 0);
        }
        B.commit();
        return handle;
      },
      dispose() {
        if (dead) return;
        dead = true;
        B.dispose();
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
  /* Authored on SCREEN (screenHex, the linear-hex trap): the old swatch hexes
     0x6a5f51/0x7d7161 for the crown left the renderer as near-white, which is
     the "light coloured smoke" that read flattest of all. A density current
     is pulverised dark rock; even its lit crown is a mid grey-brown. */
  let _PYRO_ASH = null;
  function pyroAsh() {
    if (_PYRO_ASH) return _PYRO_ASH;
    _PYRO_ASH = [
      screenHex(30, 26, 23), screenHex(36, 32, 29),    // 0-1  base, in the cloud's own shadow
      screenHex(62, 56, 50), screenHex(72, 65, 58),    // 2-3  shoulders
      screenHex(104, 96, 86), screenHex(122, 113, 101), // 4-5  crown, catching the light
    ];
    return _PYRO_ASH;
  }
  const PYRO_BODY = 6;              // body materials; the rest are the fringe
  const _puffTex = [];
  /* THE PUFF — AND WHY IT IS LIT.

     OWNER, 2026-09-01: "there's still a 2D-ness of the smoke, especially the
     light coloured smoke, while the RPG explosion is 3D looking." Compared
     side by side (city/crashfx.js), the RPG's smoke differs in exactly two
     ways from what stood here: its mask is built from SEMI-TRANSPARENT lobes
     (alpha 0.45-0.8, so one sprite has density variation inside it), and it
     is dark with fire glowing through it. This mask was solid white lobes at
     alpha 1 — a flat cutout — tinted one colour per sprite. Where the tint
     was dark that read as a silhouette, which is fine; where the tint was
     LIGHT (the sun-lit crown, the pyroclastic cloud) a flat pale disc against
     the sky is the single worst case for a billboard: paper.

     So the light is baked into the texture. Every lobe is shaded as a lump
     lit from above (bright crown, dark underside — a radial gradient whose
     centre sits up and left of the lobe), and the whole puff carries a
     top-to-bottom ramp on top of that. The sprite's colour multiplies it, so
     a pale tint gives a pale lump with a dark belly instead of a pale coin.
     The one rule that comes with it: the sprite must stay near UPRIGHT —
     a rotated lit texture puts the light wherever the rotation says, so the
     column and the current keep their rotation inside a few tenths of a
     radian (see both callers). Lobes are 0.72-0.95 alpha so the mass keeps
     the RPG's internal density variation while still going opaque where
     puffs overlap three deep. */
  function puffTex(k) {
    if (_puffTex[k]) return _puffTex[k];
    const S = 128, cv = document.createElement("canvas");
    cv.width = cv.height = S;
    const g = cv.getContext("2d");
    let seed = (0x2f6e2b1d + k * 0x9e3779b9) >>> 0;
    const rnd = function () { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    // a lump lit from above-left: the gradient's centre is offset toward the
    // light, bright there, falling to a dark rim on the far side
    const lobe = function (lx, ly, r, a0) {
      const rg = g.createRadialGradient(lx - r * 0.34, ly - r * 0.38, r * 0.05, lx, ly, r);
      rg.addColorStop(0, "rgba(255,255,255," + a0 + ")");
      rg.addColorStop(0.42, "rgba(196,196,196," + (a0 * 0.92).toFixed(3) + ")");
      rg.addColorStop(0.78, "rgba(112,112,112," + (a0 * 0.62).toFixed(3) + ")");
      rg.addColorStop(1, "rgba(80,80,80,0)");
      g.fillStyle = rg;
      g.beginPath(); g.arc(lx, ly, r, 0, 6.2832); g.fill();
    };
    // the core is deliberately fat: a puff whose alpha dies at a third of its
    // quad leaves visible gaps between neighbours, and gaps are what made the
    // first pass read as separate balls of cotton instead of one mass
    lobe(S * 0.5, S * 0.54, S * 0.36, 0.95);
    const n = 8 + (k % 3);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * 6.2832 + rnd() * 0.9, d = S * (0.17 + rnd() * 0.12);
      lobe(S * 0.5 + Math.cos(a) * d, S * 0.54 + Math.sin(a) * d, S * (0.15 + rnd() * 0.12), 0.72 + rnd() * 0.23);
    }
    for (let i = 0; i < 11; i++) {
      const a = rnd() * 6.2832, d = S * (0.27 + rnd() * 0.13);
      lobe(S * 0.5 + Math.cos(a) * d, S * 0.54 + Math.sin(a) * d, S * (0.06 + rnd() * 0.08), 0.6 + rnd() * 0.25);
    }
    // the whole puff is in its own shadow underneath: a top-to-bottom ramp
    // over the lobes, so the mass reads as one lit body and not a bag of
    // separately lit marbles
    const img = g.getImageData(0, 0, S, S), d = img.data;
    for (let y = 0; y < S; y++) {
      const ramp = 1.0 - 0.5 * Math.pow(y / (S - 1), 1.4);
      for (let x = 0; x < S; x++) {
        const o = (y * S + x) * 4;
        d[o] *= ramp; d[o + 1] *= ramp; d[o + 2] *= ramp;
      }
    }
    g.putImageData(img, 0, 0);
    _puffTex[k] = new THREE.CanvasTexture(cv);
    return _puffTex[k];
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
    /* THE TELEGRAPHED LANE IS THE FLOW'S LANE. A caller that announced a
       corridor (rockfall down it, the crowd cleared out of it) hands that
       exact polyline in as `path`, so the current cannot take a slightly
       different line off a different salt than the one everyone was shown. */
    const path = (o.path && o.path.pts && o.path.pts.length > 1) ? o.path : fallLine({
      x: o.x, z: o.z, groundAt: groundAt, bearing: o.bearing,
      step: 6, count: Math.ceil(len / 6) + 1, salt: salt, turn: o.channel ? 0.8 : 0.4, wander: 0.1,
    });

    const ash = pyroAsh();
    const FRINGE = [new THREE.Color(0x6d1f02), new THREE.Color(0x9e3806)];
    const _bc = new THREE.Color();
    /* DENSITY IS THE POINT, and it is a balance the first sprite pass got
       wrong in the other direction. Too big and hard-edged reads as boulders;
       too small and too few reads as steam, which is what a first cut at
       roughly half the old size produced — a scatter of separate white puffs
       with sky between them. A density current is OPAQUE. So: sizes back up
       (a sprite's alpha core is only ~60% of its quad, where the old
       icosahedron filled a full diameter of TWICE its scale, which is most of
       why the naive size match came out small), and the count up by half
       again so the mass is five deep everywhere instead of one. */
    /* ONE DRAW FOR THE CLOUD, ONE FOR ITS GLOW. Each puff was a THREE.Sprite
       — 58-136 draw calls for a single current, more than the whole town on
       a phone, every frame it ran. The same billboards now ride puffBatch
       (the column's instanced quad): same texture tiles, same baked tier
       colours, same rocking, same back-to-front order, two calls. The
       incandescent basal fringe keeps its own ADDITIVE batch. */
    const N = qi(58, 136);
    const blobs = [];
    let nFringe = 0;
    for (let i = 0; i < N; i++) {
      // the HEAD carries most of the mass: bias lags toward zero
      const lag = Math.pow(Math.random(), 1.7) * tail;
      const basal = i % 8 === 0 && lag < tail * 0.3;
      // how high in the mass this puff rides — and therefore how much light
      // reaches it. Sampled BEFORE the material is chosen, because that is
      // the whole point: the tier is the lighting.
      const hf = basal ? 0.04 + Math.random() * 0.11 : Math.random();
      const tier = Math.min(2, Math.floor(Math.pow(hf, 0.85) * 3));
      // the material index the sprite build used: it sets the colour, the
      // texture tile and the rocking rate, exactly as the shared mats did
      const mi = basal ? PYRO_BODY + (i % 2) : tier * 2 + (i & 1);
      blobs.push({
        mi: mi, slot: basal ? nFringe++ : -1, lag: lag, basal: basal, hf: hf,
        lat: (Math.random() * 2 - 1) * 1.1,
        ph: Math.random() * 6.28,
        sz: (basal ? 0.17 : 0.15) + Math.pow(Math.random(), 1.4) * (basal ? 0.17 : 0.42),
      });
    }

    const body = puffBatch(N, { map: puffAtlas(), tiles: 3, fog: true, parent: parent, renderOrder: 7 });
    const glow = puffBatch(Math.max(1, nFringe), { map: puffAtlas(), tiles: 3, additive: true, fog: true, parent: parent, renderOrder: 8 });
    let front = 0, t = 0, dead = false;
    const _v = new THREE.Vector3();

    const handle = {
      kind: "pyro", group: body.mesh, path: path, blobCount: N,
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
        /* ROCKING, NOT SPINNING: the mask is lit from above now, so a full
           turn would put the light underneath. Eight materials rocking a
           few tenths of a radian at eight rates keeps the churn. */
        for (let i = 0; i < blobs.length; i++) {
          const B = blobs[i];
          const s = front - B.lag;
          if (s < -4 || s > path.total + 8) { if (B.basal) glow.hide(B.slot); else body.hide(i); continue; }
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
          const px = _v.x + nx * B.lat * spread + Math.sin(t * 1.1 + B.ph) * 2.4;
          const py = gy + height * B.hf * (0.22 + 0.95 * ageK) * churn + sc * 0.42;
          const pz = _v.z + nz * B.lat * spread + Math.cos(t * 1.3 + B.ph) * 2.4;
          const rot = 0.32 * Math.sin(t * (0.35 + B.mi * 0.09) + B.mi * 1.7);
          if (B.basal) {
            const c = FRINGE[B.mi - PYRO_BODY];
            glow.set(B.slot, px, py, pz, sc, sc * 0.72, rot, B.mi - PYRO_BODY, c.r, c.g, c.b, 0.5, 0);
          } else {
            _bc.setHex(ash[B.mi]);
            body.set(i, px, py, pz, sc, sc * 0.92, rot, B.mi % 3, _bc.r, _bc.g, _bc.b, 1, 0);
          }
        }
        body.commit(); glow.commit();
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
        // the atlas is module-shared and outlives every flow; the batches are this flow's own
        body.dispose(); glow.dispose();
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
      emissive: 0x040506, emissiveIntensity: 1,
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
          /* ...but those hexes were authored as SWATCHES, and this pipeline
             reads a vertex colour as LINEAR (the linear-hex trap, top of the
             file): 0x968d81 is a 0.3 linear albedo and photographed as a
             near-white paper sheet lying on the cone. These are the linear
             albedos of wet and drying volcanic mud (0.04-0.13). */
          ramp3(clamp(0.25 + 0.5 * (1 - au) + setK * 0.8, 0, 1), 0x0b0a08, 0x16130f, 0x241f1a, _c3);
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
      emissive: 0x0a0a09, emissiveIntensity: 1,
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
      /* NEUTRAL, NOT BLUE-SHIFTED — the owner's iPad/iPhone report (2026-10-14,
         "purple-ish speckles in the volcano ash"). These stops used to be
         blue-shifted (B > G > R) to cancel the eruption's orange sun. But the
         DRIFTS OUTLIVE THAT SUN: they are a scar that lies for minutes after
         the eruption hands the sky back to white daylight, and a blue-grey
         patch under white light, on green grass, read through a P3 phone
         panel's extra saturation, is a field of lavender flecks. The sun
         under the ash is now DIMMED by the deck (world/eruption.js envAt)
         rather than painted orange over a bright grass, so the pigment can
         simply be what volcanic ash is: grey, a touch warm (R >= G >= B). */
      if (C.roof) {
        // ROOFS KEEP THE OLD RAMP. A roof quad is the load gauge — it has to
        // read as "something is piling up here" from the first centimetre,
        // dark against a pale roof, and it is not standing on a veil.
        _c3.setHex(0x1c1b19).lerp(_c1.setHex(0x34322f), Math.min(1, cov * 1.15));
        _c3.lerp(_c1.setHex(0x232220), deep * 0.7);
      } else {
        /* A DRIFT STARTS AS THE VEIL AND ENDS PALER THAN IT. The bottom stop
           is the ash term's own colour in systems/weather.js, so a patch
           coming into existence at cov 0 is invisible against the ground it
           is standing on — no popping outline, no fleck — and it walks up to
           a pale deposit as it deepens, which is the only thing that makes a
           drift read as raised rather than as a stain. Neutral warm grey,
           like the veil (see the note above the roof ramp). */
        _c3.setHex(0x363431).lerp(_c1.setHex(0x5c5953), cov);
        // ...and back down a stop when it goes deep and damp
        _c3.lerp(_c1.setHex(0x423f3b), deep * 0.5);
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
    for (let i = 0; i < LIVE.pyro.length; i++) pyroBlobs += LIVE.pyro[i].blobCount || 0;
    // the column and the umbrella are one raymarched volume (THE PLUME VOLUME)
    const vols = [];
    LIVE.column.concat(LIVE.umbrella).forEach(function (h) { if (h.volume && vols.indexOf(h.volume) < 0) vols.push(h.volume); });
    let fountainClots = 0;
    for (let i = 0; i < LIVE.fountain.length; i++) fountainClots += LIVE.fountain[i].clotCount || 0;
    let ashPeak = 0, ashCells = 0;
    for (let i = 0; i < LIVE.ash.length; i++) {
      ashPeak = Math.max(ashPeak, LIVE.ash[i].peakDepth);
      ashCells += LIVE.ash[i].cellCount;
    }
    return {
      v2: true,
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
      plumeVolumes: vols.length,
      // the ballistic lava fountain (V.fountain) — clots, not Points
      fountains: LIVE.fountain.length,
      fountainClots: fountainClots,
      builtFountain: census.fountain,
      pyroLive: LIVE.pyro.length, pyroBlobs: pyroBlobs,
      // the Plinian deck and the ballistic field
      umbrellas: LIVE.umbrella.length,
      umbrellaRadius: LIVE.umbrella.length ? Math.round(LIVE.umbrella[0].radius) : 0,
      bombsFlying: LIVE.bombs.reduce(function (n, b) { return n + b.inFlight; }, 0),
      bombsLanded: LIVE.bombs.reduce(function (n, b) { return n + b.stats.landed; }, 0),
      bombCraters: LIVE.bombs.reduce(function (n, b) { return n + b.stats.craters; }, 0),
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
