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
              crust with a bright connected crack network through it.
              lidField is now a ridge transform: filaments at the field's
              zero-crossings, plates between them.
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
  /* OFF as of 2026-08-16. OWNER: "the ash covering the map is not needed...
     idc if it's realistic". The blanket, the roof quads and the choke it fed
     all hang off this one flag; ?cfg_VOLCANO_ASH_LOAD=1 brings the whole
     ledger back intact. */
  if (CBZ.CONFIG.VOLCANO_ASH_LOAD == null) CBZ.CONFIG.VOLCANO_ASH_LOAD = false;

  const V = {};
  // live census for CBZ.volcanoAudit() — measured, never counted in source
  const census = { lava: 0, pyro: 0, lahar: 0, ash: 0, lights: 0, tris: 0, branches: 0, vent: 0 };
  const LIVE = { lava: [], pyro: [], lahar: [], ash: [], vent: [], column: [] };

  function h01(x, z, salt) { return CBZ.hash01 ? CBZ.hash01(x, z, salt | 0) : 0.5; }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function q(lo, hi) { return CBZ.qScale ? CBZ.qScale(lo, hi) : hi; }
  function qi(lo, hi) { return Math.max(1, Math.round(q(lo, hi))); }
  const _c1 = new THREE.Color(), _c2 = new THREE.Color(), _c3 = new THREE.Color();
  const _c4 = new THREE.Color();

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
  const LAVA_U = [-1, -0.78, -0.55, -0.3, 0, 0.3, 0.55, 0.78, 1];
  /* A THREAD DOES NOT NEED NINE COLUMNS. Once the flows narrowed to match the
     reference photograph, nine columns over two metres of width was a vertex
     every twenty centimetres — detail no camera can resolve, on nine times as
     many flows. Narrow flows take the five-column table; the grid across the
     ribbon only has to carry the channel's meander, and the plates ride along
     the LENGTH, where the resolution still matters. */
  const LAVA_COLS_N = 5;
  const LAVA_U_N = [-1, -0.55, 0, 0.55, 1];
  const MELT_INSET = 0.82;          // the lit crust shows outboard of this
  // lit crust: dark basalt at the levee, scorched red-brown inboard. Not
  // BLACK — a crust photographs as very dark grey-brown, and pure black in
  // a dim orange scene is a hole in the picture.
  const CRUST_A = 0x2a2320, CRUST_B = 0x412c22, CRUST_C = 0x74371a;
  // the unlit lid over the melt, and the melt itself (1150 C to dull red)
  const _LID_D = new THREE.Color(0x241d19), _LID_W = new THREE.Color(0x502513);
  // Authored DEEP on purpose — the same lesson the ash palette already
  // teaches from the other direction: these go through the renderer's output
  // encoding, which lifts a swatch-true orange to pale gold on screen. Deep
  // saturated stops land as the bible photo's vivid orange-red; the throat's
  // white-yellow belongs to ventGlow, not to this ramp.
  const MELT_A = 0x6d1201, MELT_B = 0xc73e03, MELT_C = 0xff9226;

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
  /* One constant ties the field's along-flow scale to the advection phase, so
     "the pattern travels downstream at the surface velocity" stays TRUE
     instead of being two numbers that have to be kept in step by hand. */
  const LID_K = 0.55;
  function lidField(s, u, ph) {
    const a = s * LID_K - ph;
    // the warp: bends filaments, and advects with them so the lace is not
    // a fixed lattice the melt slides beneath
    const w = Math.sin(a * 0.21 + u * 1.6) + 0.55 * Math.sin(a * 0.47 - u * 2.7 + 2.1);
    const f =
      0.55 * Math.sin(a + u * 3.1 + 1.1 * w) +
      0.30 * Math.sin(a * 1.43 - u * 5.2 + 1.7 + 0.7 * w) +
      0.15 * Math.sin(a * 0.71 + u * 8.6 + 4.1);
    /* RIDGE: 1 on the zero-crossing curves, 0 on the plate interiors. The
       3.2 sets filament width against plate size — lower and the lace fattens
       back toward bands, higher and it thins to pinstripes the grid cannot
       hold (stations are ~2.3 m apart; a filament has to survive sampling). */
    return clamp(1 - Math.abs(f) * 3.2, 0, 1);
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
    /* Station spacing is set by the LID, not by the width. LID_K maps metres
       to field phase, so ~5 samples a plate wants seg near 2.3; tying it to
       the flow's width instead put a narrow thread on a 0.8 m grid and paid
       for thirty-five stations to draw two metres of rock. */
    const seg = clamp(width * 0.4, 2.3, 2.9);
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
      const lobe = 1 + 0.24 * Math.sin(i * 0.52 + wPh1) + 0.13 * Math.sin(i * 1.27 + wPh2);
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
        const u = UU[c], k = i * COLS + c;
        const x = p.x + nX[i] * u * hw, z = p.z + nZ[i] * u * hw;
        cGY[k] = Math.max(groundAt(x, z), p.y);
        // the same wandering-channel offset ring() draws with — the centre
        // columns carry the full meander, the banks stay pinned
        const mu = u * MELT_INSET + meander[i] * (1 - Math.abs(u));
        const mx = p.x + nX[i] * mu * hw;
        const mz = p.z + nZ[i] * mu * hw;
        mGY[k] = Math.max(groundAt(mx, mz), p.y);
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
    chGeo.setIndex(new THREE.BufferAttribute(kIdx, 1));
    const chMat = new THREE.MeshBasicMaterial({
      vertexColors: true, side: THREE.DoubleSide, fog: true,
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

    // one ring of COLS vertices, at a given centre / normal / width
    function ring(i, cx, cy0, cz, nx, nz, hw, thick, hot, s, ph, bedC, bedM) {
      const u01 = N > 1 ? clamp(s / Math.max(0.001, (N - 1) * seg), 0, 1) : 0;
      for (let c = 0; c < COLS; c++) {
        const u = UU[c], au = Math.abs(u), k = i * COLS + c, off = k * 3;
        /* FLAT-TOPPED, STEEP-SIDED. A quadratic crown is a half-cylinder, and
           a half-cylinder with a bright middle is a fluorescent tube; an 'a'a
           flow is a broad flat raft riding between two steep levees. The cubic
           keeps the top honest and puts all the fall-off in the last fifth. */
        const crown = 0.25 + 0.75 * (1 - Math.pow(au, 3.2));
        const gr = 0.84 + 0.30 * grain[k];
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
        kPos[off + 1] = (bedM ? bedM[k] : cy0) + 0.05 + thick * (0.25 + 0.75 * (1 - Math.pow(amu, 3.2))) + 0.04;
        /* HOW MUCH MELT IS SHOWING HERE, and it is the whole look:
             across  melt lives inside the levees, and its reach narrows as
                     the levees grow inward downstream
             open    the lid thickens with distance from the vent
             lace    the travelling crack network — the term that MOVES
             flood   the vent apron: the first stretch has no lid at all */
        const across = 1 - Math.pow(amu, 2.6 + 2.1 * u01);
        // gentled with the 2026-08-19 rebalance below: the toe of a fed flow
        // still MOVES, so it stays red — only stopping earns the black
        const open = 0.98 - 0.22 * u01;
        /* THE LACE IS THE LOOK (the owner's reference close-up, 2026-08-15):
           a dark crusted surface with thin CONNECTED filaments of melt
           cracked through it, wrapping irregular black islands. lidField now
           arrives here already ridge-transformed — 1 on the filament, 0 in
           the plate — so no midpoint stretch is applied on top: stretching a
           ridge only fattens it back into the smooth bright bands this
           replaces, which was the whole "glowing road" failure. */
        const lace = lidField(s, u, ph);
        /* THE VENT FLOODS — BUT THE FLOOD IS STILL THREADED. In the wide
           reference photograph the upper flank is one incandescent apron;
           in the close-up even the flooded stretch keeps thin dark stringers
           through it. A flood that simply forces melt=1 painted a solid
           white band down the first quarter of every flow — a laser, which
           is geometry again (the peek shots proved it). So the flood keeps
           a floor of lace modulation: bright apron, dark threads surviving
           inside it. `hot` keeps the handover from popping as a station
           cools. */
        const flood = clamp((0.21 - u01) * 4.5, 0, 1) * (0.5 + 0.5 * hot) * (0.6 + 0.4 * lace);
        /* THE MELT IS THE DEFAULT WHILE THE RIVER RUNS. OWNER, 2026-08-19:
           "isn't it usually red, and it has that red and bright [brilliance]
           ... and then it should turn black. Right now it literally flows
           down black — black stuff doesn't move. Black is when it's in one
           place." He is right, and it re-balances the 2026-08-15 lace: a FED
           channel's surface is mostly incandescent, so the moving flow now
           reads predominantly red-orange with the lace surviving as brighter
           veins through it, and thin dark skin shows only as sparse RAFTS
           where the field runs deepest. The full black crust belongs to lava
           that has STOPPED — which is exactly what the quench paints: hot
           collapses and this same formula lands on dark rock whose last
           ember seams fade in the deepest lace. Moving = red; parked =
           black. */
        let melt = clamp((0.62 + 0.5 * lace) * across * open * (0.35 + 0.75 * hot) - 0.12, 0, 1);
        // the rafts: thin chilled plates riding the bright river — dim while
        // the river is hot (skin, not rock), deepening to black as it stops
        const raft = clamp((0.18 - lace) * 5, 0, 1);
        melt *= 1 - raft * (0.3 + 0.42 * (1 - hot));
        melt = Math.max(melt, flood * across);
        melt = melt * melt * (3 - 2 * melt);   // smoothstep: veins get EDGES
        /* 0.24+0.56, down from 0.32+0.8: with the melt now covering most of
           the river, the old drive parked the whole body at the ramp's gold
           top — the "red and bright" the owner asked for lives a step down,
           with the body on the red-orange stop and only the veins and the
           vent flood reaching the bright end. */
        ramp3(clamp(melt * (0.24 + 0.56 * hot), 0, 1), MELT_A, MELT_B, MELT_C, _c3);
        /* the lid itself is not black — it is dark rock still holding heat,
           warmest right beside a filament (a crack heats its own rim).
           QUADRATIC in hot, and biased harder into the lace: the 2026-08-16
           slow-cooling repair keeps `hot` high for the whole eruption, and a
           lid warmth LINEAR in hot then painted every plate warm gold — the
           dark-crust-vs-bright-lace contrast that IS the bible photo fell
           over. hot*hot keeps the plates dark rock while the filaments and
           their rims stay incandescent for just as long. */
        _c4.copy(_LID_D).lerp(_LID_W, clamp(hot * hot * (0.22 + 0.78 * lace), 0, 1));
        _c4.lerp(_c3, melt);
        kCol[off] = _c4.r * grM; kCol[off + 1] = _c4.g * grM; kCol[off + 2] = _c4.b * grM;
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
      const ph = phT * skinV * LID_K;
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
        const u = UU[c], k = i * COLS + c;
        _noseC[c] = cGY[k]; _noseM[c] = mGY[k];
        cGY[k] = Math.max(groundAt(_v.x + nx * u * hw, _v.z + nz * u * hw), _v.y);
        // the nose's melt bed rides the same wandering channel as ring()
        const mun = u * MELT_INSET + meander[i] * (1 - Math.abs(u));
        mGY[k] = Math.max(groundAt(_v.x + nx * mun * hw, _v.z + nz * mun * hw), _v.y);
      }
      const st = stationThick(i);
      ring(i, _v.x, _v.y, _v.z, nx, nz, hw, st.t * (0.55 + 0.45 * frac),
        hot0[i] * (1 - 0.58 * st.cool) * (1 - 0.9 * st.qk), adv, phT * skinV * LID_K, cGY, mGY);
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
     ASH COLUMN — the pillar over the vent.

     The wide reference photograph's second subject after the lava: a FAT,
     coherent, dark convective column standing kilometres over the crater,
     bulging into a cauliflower head, leaning slightly downwind. The old
     column was a THREE.Points cloud — a few hundred dots that photograph
     as static in front of the sky, not as a thing with a silhouette.

     Same construction as the pyroclastic current, because it is the same
     physics upside down: overlapping camera-facing sprites wearing the
     shared cauliflower alpha, sizes growing with height (a plume expands
     as it entrains air), bending downwind with height squared (drag
     integrates). Dark tiers only — the photograph's pillar is soot against
     sky; the rose light at its base is the separate lit-underside cloud
     the director already owns.

     OWNER, 2026-08-16: "when smoke comes out of the volcano it looks like
     flat bouncing circle ish things — look at the rpg explosion and how it
     has shape." Both halves diagnosed the same build: every puff was a
     PERMANENT FIXTURE parked at its own height and wobbled around that seat
     by three sinusoids — position oscillation, which the eye reads exactly
     as billboards bouncing. The RPG's smoke reads as a volume because every
     puff has a LIFECYCLE: born small, growing as it rises, dying into the
     plume. So the column is now an EMITTER. A puff is born just over the
     vent, climbs the axis while it expands, decelerates into the head,
     spreads sideways there (that crowd IS the cauliflower bulge), and is
     recycled back to the vent inside the one part of the mass dense enough
     to mask it. Nothing oscillates; all motion is travel. The churn comes
     from the shared materials' slow rotation (the pyro current's trick) and
     the whole mass slowly turning about its own axis.

     Materials are OWNED, not the pyro pool's: the pyro drives its shared
     materials' rotation every tick it is alive, and two systems steering
     one uniform is a fight. A column costs its own four materials and
     disposes them.
     ============================================================ */
  V.ashColumn = function (o) {
    o = o || {};
    const parent = o.parent || CBZ.scene;
    const x = +o.x || 0, z = +o.z || 0;
    const baseY = o.y != null ? +o.y : 0;
    const height = o.height > 0 ? +o.height : 55;
    const r0 = o.r > 0 ? +o.r : 7;
    const mats = [];
    // one step below where they should read: the eruption's warm fog and the
    // output encoding both lift these on the way to the screen (same lesson
    // as the melt ramp and the ash palette)
    const COL_TIERS = [0x1a1713, 0x211d17, 0x28231c, 0x2f2921];
    for (let i = 0; i < COL_TIERS.length; i++) {
      mats.push(new THREE.SpriteMaterial({
        map: puffTex(i % 3), color: COL_TIERS[i],
        transparent: true, opacity: 1, depthWrite: false, fog: true,
        blending: THREE.NormalBlending, rotation: i * 1.7,
      }));
    }
    // a few more than the fixture build had: an emitter always has part of
    // its roster in transit, and the deleted 500-mote ash rain pays for it
    const N = qi(18, 30);
    const grp = new THREE.Group();
    grp.frustumCulled = false;
    parent.add(grp);
    /* the lifecycle, in seconds of climb. u = life/RISE: 0 birth at the
       vent, 1 arrival at the head, then a HOLD to 1.35 spreading in the
       cauliflower before the puff recycles. Births are staggered across one
       full cycle so the column is a column, not a pulse — and so it STANDS
       UP over its first seconds for free, led by its own leading puff.
       6 s, not longer: the cycle time IS the birth rate (N puffs per
       1.35 RISE), and the first cut at 7.5 s put nine puffs in the air by
       the time the storyboard photographs the young column — a head on a
       thread of beads, not a pillar. */
    const RISE = 6;
    const puffs = [];
    for (let i = 0; i < N; i++) {
      const m = new THREE.Sprite(mats[0]);
      m.renderOrder = 7;
      m.visible = false;
      grp.add(m);
      puffs.push({
        m: m, tier: 0,
        life: -(i / N) * RISE * 1.35,
        ang: Math.random() * 6.28,          // seat around the axis
        rr: 0.2 + Math.random() * 0.8,      // seat across the column
        ph: Math.random() * 6.28,
        sz: 0.8 + Math.random() * 0.5,
      });
    }
    let t = 0, dead = false;
    const handle = {
      kind: "column", group: grp,
      update(dt, wx, wz) {
        if (dead) return handle;
        t += dt;
        const bx = wx || 0, bz = wz || 0;
        // the slow boil, at zero position cost: the shared materials turn at
        // their own rates, shuffled across the roster (the pyro's trick)
        for (let i = 0; i < mats.length; i++) mats[i].rotation = i * 1.7 + t * (0.05 + i * 0.02);
        for (let i = 0; i < puffs.length; i++) {
          const P = puffs[i];
          P.life += dt;
          if (P.life < 0) { P.m.visible = false; continue; }
          let u = P.life / RISE;
          if (u >= 1.35) {
            // recycled inside the crowded head, the one place dense enough
            // to mask a departure; reseeded so the column never loops
            P.life = 0; u = 0;
            P.ang = Math.random() * 6.28;
            P.rr = 0.2 + Math.random() * 0.8;
            P.ph = Math.random() * 6.28;
          }
          const climb = Math.min(1, u);
          // fast off the vent, decelerating into the head — a plume climbing
          // toward neutral buoyancy — then the head HOLDS and spreads.
          // 0.8: enough curve to crowd the head, not so much that the stem
          // empties (puff density goes as 1/climb-rate)
          const hh = Math.pow(climb, 0.8);
          const hold = Math.max(0, u - 1);
          const rad = r0 * (0.5 + 1.9 * hh) * (1 + hold * 1.3);
          // downwind lean integrates with height — drag works on the WHOLE climb
          const lean = height * 0.3 * hh * hh;
          const drift = P.ang + t * 0.16;     // the whole mass slowly turns
          P.m.position.set(
            x + Math.cos(drift) * rad * P.rr * 0.62 + bx * lean,
            baseY + (hh + hold * 0.12) * height,
            z + Math.sin(drift) * rad * P.rr * 0.62 + bz * lean
          );
          /* BORN SMALL, GROWS AS IT ENTRAINS AIR — the lifecycle is the
             shape. Scale doubles as the fade: a puff pops in tiny inside the
             dense base (behind the fountain and the lit underside cloud) and
             has been swallowed by the head crowd before it recycles. */
          const grow = Math.min(1, u * 5) * (0.68 + 0.32 * climb) * (1 + hold * 0.45);
          const sc = rad * P.sz * 1.5 * grow * (1 + 0.05 * Math.sin(t * 0.8 + P.ph));
          P.m.scale.set(sc, sc * 0.94, 1);
          P.m.visible = sc > 0.05;
          // the tier IS the lighting (see the pyro note): re-seated as the
          // puff climbs out of the column's own shadow into the lit crown
          const tier = Math.min(COL_TIERS.length - 1, (hh * 3.2) | 0);
          if (tier !== P.tier) { P.tier = tier; P.m.material = mats[tier]; }
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

    const cells = [];
    // i*NC+j -> cell index, so depthAt() is O(1) instead of a scan over ~500
    // cells per actor per frame (the ash DOT asks once per actor per tick)
    const grid = new Int32Array(NC * NC).fill(-1);
    for (let i = 0; i < NC; i++) {
      for (let j = 0; j < NC; j++) {
        const x = cx - R + (i + 0.5) * cell;
        const z = cz - R + (j + 0.5) * cell;
        if (Math.hypot(x - cx, z - cz) > R * 1.02) continue;
        grid[i * NC + j] = cells.length;
        /* THE GRID MUST NOT LOOK LIKE A GRID. Axis-aligned same-size quads
           read as a chequerboard the moment they saturate — the ash stops
           being a deposit and becomes a texture atlas. A hashed rotation and
           a +-18% size jitter per cell is the whole fix, and it is free:
           the patches still tile the same area, they just stop agreeing
           about where their edges are. */
        const ang = h01(x, z, salt + 71) * Math.PI * 0.5;
        // wide size spread: patches that are all one size read as leopard
        // print no matter how organic each individual outline is
        const jit = 0.58 + 0.92 * h01(x, z, salt + 89);
        const C = {
          x: x, z: z, y: groundAt(x, z), w: cell, d: cell, depth: 0, roof: false,
          ang: ang, jit: jit,
          // per-cell coverage gain: the drift does not arrive as a straight
          // edge, it mottles, and one hashed multiplier is the whole effect
          gain: 0.55 + 0.95 * h01(x, z, salt + 103),
        };
        /* ---- THE DEPOSIT LIES ON THE GROUND. ------------------------------
           OWNER, 2026-08-13: "ash is the worst, theres random cubes and
           floating flat gray squares all around". Exactly right, and it was
           one line: every quad took ONE height — the ground under its centre —
           for all four of its corners. A horizontal three-metre plate on the
           side of a cone buries one edge and hangs the other a metre in the
           air, and there are five thousand of them. On the flat it still
           floated, because the surface was also being lifted by 0.6 x the
           depth: half a metre of ash put the sheet a third of a metre above
           the grass it was supposed to be sitting on.

           Each corner now stands on the ground under ITSELF. The four ground
           probes are taken once, here, at the quad's full extent — the cell
           never moves, and the only thing that changes with coverage is how
           far out along that fixed diagonal the corner currently sits, which
           is a lerp. So the blanket drapes the mountain for no per-frame cost
           at all. ------------------------------------------------------- */
        const hw0 = cell * 0.78 * jit, ca = Math.cos(ang), sa = Math.sin(ang);
        const ox = [-hw0, hw0, hw0, -hw0], oz = [-hw0, -hw0, hw0, hw0];
        C.cy = new Float32Array(4);
        for (let k = 0; k < 4; k++) {
          C.cy[k] = groundAt(x + ox[k] * ca - oz[k] * sa, z + ox[k] * sa + oz[k] * ca);
        }
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

    function writeCell(n) {
      const C = cells[n];
      const cov = clamp((C.depth / FULL) * (C.roof ? 1 : (C.gain || 1)), 0, 1);
      // quads grow from a point at their cell centre; neighbours overlap at
      // full coverage, which is what welds them into one blanket
      const jit = C.roof ? 1 : (C.jit || 1);
      /* The patch never shrinks to a point, and at full coverage it is WIDER
         than its cell so neighbours weld. The alpha cutout eats ~20% of the
         quad, so the geometry has to overshoot for the deposit to close up. */
      const grow = 0.28 + 0.72 * cov;
      const hw = C.w * 1.05 * grow * jit, hd = C.d * 1.05 * grow * jit;
      /* The deposit stands a FEW CENTIMETRES proud of what it covers — it is
         a layer of dust, not a plinth. The old 0.6 x depth lift was reading
         the ledger's metres as if they were the sheet's own thickness. */
      const lift = (C.roof ? 0.03 : 0.02) + Math.min(0.3, C.depth) * 0.15;
      const v = n * 4 * 3;
      // roofs keep their footprint; ground patches spin on their own hash
      const ca = C.roof ? 1 : Math.cos(C.ang || 0), sa = C.roof ? 0 : Math.sin(C.ang || 0);
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
      _c3.setHex(0x191b1d).lerp(_c1.setHex(0x33363a), Math.min(1, cov * 1.15));
      _c3.lerp(_c1.setHex(0x212325), deep * 0.7);
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
      get peakDepth() { return peak; },
      get cellCount() { return cells.length; },
      /* spec: { rate (m/s at the plume axis), windX, windZ, srcX, srcZ,
                 spread (0..1 how much falls off-axis) } */
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
        if (rate > 0) {
          const wx = spec.windX != null ? +spec.windX : 1;
          const wz = spec.windZ != null ? +spec.windZ : 0;
          const wl = Math.hypot(wx, wz) || 1;
          const ux = wx / wl, uz = wz / wl;
          const sx = spec.srcX != null ? +spec.srcX : cx;
          const sz = spec.srcZ != null ? +spec.srcZ : cz;
          const spread = spec.spread != null ? clamp(+spec.spread, 0, 1) : 0.18;
          for (let n = 0; n < cells.length; n++) {
            const C = cells[n];
            const dx = C.x - sx, dz = C.z - sz;
            const d = Math.hypot(dx, dz) || 0.001;
            // the DOWNWIND WEDGE: a hard cosine lobe on the wind bearing,
            // plus a small isotropic term so the whole island greys over
            const dot = (dx * ux + dz * uz) / d;
            const lobe = dot > 0 ? Math.pow(dot, 2.2) : 0;
            const fall = 1 / (1 + (d / (R * 0.55)) * (d / (R * 0.55)));
            const k = (spread + (1 - spread) * lobe) * fall;
            if (k > 0.001) {
              C.depth += rate * k * step;
              if (C.depth > peak) peak = C.depth;
            }
          }
          dirty = true;
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
      // metres of ash standing on the ground at (x,z)
      depthAt(x, z) {
        const i = Math.floor((x - (cx - R)) / cell);
        const j = Math.floor((z - (cz - R)) / cell);
        if (i < 0 || j < 0 || i >= NC || j >= NC) return 0;
        const n = grid[i * NC + j];
        return n < 0 || n >= groundCells ? 0 : cells[n].depth;
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
