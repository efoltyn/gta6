/* ============================================================
   city/wildlife_shark.js — THE SHARK: numbers, depth, and THE FIN.

   WHAT THIS FILE IS NOT: a shark AI loop. games/ocean.js already owns a
   complete shark FSM (patrol/circle/bump/strike/flee) for the dive minigame,
   and CLAUDE.md's ratchet already indicts this repo for "18-25 independent AI
   update loops (only 2 share code)". A third shark brain would make that 19-26
   and would be exactly the disease the BLOCK LAW exists to stop.

   So the stalking behaviour lives in CBZ.predatorHunt (systems/predator.js) —
   the ONE shared "something is hunting you and it commits" driver, which a
   wolf pack, a big cat or a future human stalker ticks the same way. This file
   contributes only the three things that are genuinely the shark's:

     1. THE NUMBERS — sense/circle/orbit radii, speeds, dive depths, the seize.
     2. THE LOCOMOTION SEAM — a `move` callback that swims through
        CBZ.waterField instead of walking on CBZ.floorAt. That callback is the
        whole reason the shared driver is medium-agnostic.
     3. THE SURFACE PROXY — the scythe dorsal, its small wake and the
        shark-SHAPED mass under the water, drawn INDEPENDENTLY of the body's
        LOD. This is "what they look like from above the water" and "how they
        look from a ship next to the ship": docs/SHARK-REFERENCE.md sections 4
        and 5 are its acceptance criteria and tools/visual-presets/
        shark-from-deck.mjs is how it is checked.

   THE FIN IS THE POINT (Jaws' broken shark). The body is crisply visible only
   inside ~18% of the sense radius, and during the rush and the seize. Every
   other second of the encounter the player gets a fin cutting the surface and
   a wake, and nothing else. Withholding the body IS the horror technique, and
   because the proxy is five cheap flat meshes it is also a rendering win.

   SHALLOWS (the estuary law): wildlife.js gives a great white 34u of shoreline
   clearance and a megalodon 88u so their bodies never beach themselves while
   wandering. Taken literally that clearance makes a shark PHYSICALLY UNABLE to
   reach anyone swimming off a beach — it would orbit 34u out forever. The
   clearance is therefore relaxed by hunt state inside the move callback (never
   in aquaticClearance(), which spawn placement and the deterministic world
   build depend on): a committed shark noses into water it has no business
   being in, and swims back out to deep water when it disengages.

   Reverts with CBZ.CONFIG.SHARK_HORROR = false (then wildlife.js's ordinary
   aquatic wander runs, exactly as before this file existed). The surface read
   has its own four switches — SHARK_FIN_V2, SHARK_WAKE_V2, SHARK_SHADOW_V2,
   SHARK_SHADOW_VIEW — each a one-line revert to the look before this pass.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;

  if (CBZ.CONFIG && CBZ.CONFIG.SHARK_HORROR == null) CBZ.CONFIG.SHARK_HORROR = true;
  function ON() { return !(CBZ.CONFIG && CBZ.CONFIG.SHARK_HORROR === false); }
  // SHARK_SHADOW — the dark body-mass gliding under the surface, drawn as a
  // soft ellipse riding the waterline. The sea is OPAQUE (depth-writing, no
  // transparency budget on a 16km disc), so from above the water the body is
  // never actually visible — the fin was the only tell. This is the owner's
  // "you can see a tiny bit of what's inside the water": the classic stylized
  // shadow every top-down water game uses, faded out by real depth so a deep
  // cruiser vanishes and a shallow stalker reads as a looming shape.
  if (CBZ.CONFIG && CBZ.CONFIG.SHARK_SHADOW == null) CBZ.CONFIG.SHARK_SHADOW = true;
  /* ...AND THAT PARAGRAPH IS NOW THE ARGUMENT AGAINST ITSELF (2026-08-25).
     "The sea is OPAQUE, so from above the water the body is never actually
     visible" was a statement about the RENDERER, and the owner's answer was to
     go fix the renderer: "rather than water being slightly opaque and the
     shadow being real then." world/water_spec.js's SEA_TRANSLUCENT does that —
     the sea blends by view angle and a submerged body is veiled by the real
     water column between it and your eye. The moment the actual animal shows
     through, a painted torpedo lying on the waterline is a SECOND shark on top
     of the first one, and the flat-sticker read the owner objected to.
     So the whole silhouette family stands down when the sea can be seen into,
     and comes straight back with ?cfg_SEA_TRANSLUCENT=0. The fin, the tail
     tip, the wake and the spray are untouched: those are real surface reads of
     things genuinely above the water, not stand-ins for a missing feature. */
  function seaClear() { return !!(CBZ.seaTranslucentOn && CBZ.seaTranslucentOn()); }
  function shadowOn() { return !(CBZ.CONFIG && CBZ.CONFIG.SHARK_SHADOW === false) && !seaClear(); }
  const SHADOW_DEPTH = 9;       // m of water that fully swallows the shadow
  const SHADOW_ALPHA = 0.34;    // its darkest (near-surface) opacity
  // ---- the four surface-read switches (see THE SURFACE PROXY below) -------
  // SHARK_FIN_V2      the scythe blade, species-measured, cut by the real
  //                   swell at the animal's real depth.   off -> the old cone.
  // SHARK_WAKE_V2     a small bow + short ripple that only opens up on the
  //                   rush.                               off -> the old big V.
  // SHARK_SHADOW_V2   a shark-SHAPED silhouette plus a separate sun-offset
  //                   shadow.                             off -> one ellipse.
  // SHARK_SHADOW_VIEW how deep you can see depends on where your eye is (a
  //                   boat deck sees in, a swimmer sees a mirror).
  //                                                       off -> fixed depth.
  // SHARK_TAIL_TIP    the upper caudal lobe breaking the surface a body-length
  //                   behind the dorsal on a shallow cruise. THIS IS NOT THE
  //                   DOUBLE-FIN BUG — it is the real two-fin read, and it is
  //                   the tell every fisherman uses to say "that one is right
  //                   at the top". Off -> dorsal only.
  // SHARK_SURFACE_LIFE the fin BANKING into its turns, spray peeling off the
  //                   blade at speed, and the submerged mass swaying as it
  //                   swims.                              off -> all static.
  if (CBZ.CONFIG) {
    if (CBZ.CONFIG.SHARK_FIN_V2 == null) CBZ.CONFIG.SHARK_FIN_V2 = true;
    if (CBZ.CONFIG.SHARK_WAKE_V2 == null) CBZ.CONFIG.SHARK_WAKE_V2 = true;
    if (CBZ.CONFIG.SHARK_SHADOW_V2 == null) CBZ.CONFIG.SHARK_SHADOW_V2 = true;
    if (CBZ.CONFIG.SHARK_SHADOW_VIEW == null) CBZ.CONFIG.SHARK_SHADOW_VIEW = true;
    if (CBZ.CONFIG.SHARK_TAIL_TIP == null) CBZ.CONFIG.SHARK_TAIL_TIP = true;
    if (CBZ.CONFIG.SHARK_SURFACE_LIFE == null) CBZ.CONFIG.SHARK_SURFACE_LIFE = true;
  }

  // ---- tuning ------------------------------------------------------------
  // THE HUNT'S OWN NUMBERS ARE GONE FROM THIS FILE. senseR / chumR / circleR /
  // orbitR / circleT / bumpDmg / rate / reach / cruiseSpeed / rushSpeed and the
  // whole seize block now come from CBZ.predatorKit — see section "THE
  // MIGRATION" in ensure(). What is left below is what the kit genuinely cannot
  // know: how this file DRAWS a shark and how it MOVES one.
  //
  // SENSE_R survives as a single LOD fallback (the fin/body draw radii are read
  // off the live kit and only fall back to this if the kit is absent).
  const SENSE_R = 110;          // u — great-white reference sense radius
  // OWNER: "I want to see scary ass sharks." At 0.18 the BODY only rendered
  // inside 110 * 0.18 = 20 units — so unless a shark was practically on top of
  // you, all you ever got was a fin and an empty sea. The fin is the dread cue,
  // but you have to eventually SEE the animal or the dread never pays off; a
  // horror that never shows the monster is just an empty room. 0.62 puts the
  // body on screen from ~68u, which is far enough to watch one come at you and
  // still short enough that the LOD budget holds.
  const SHOW_F = 0.62;          // fraction of SENSE_R inside which the BODY is visible
  const FIN_F = 1.25;           // fin/wake proxy draws inside senseR * this
  const TURN_RATE = 1.15;       // rad/s — a shark turns with its whole body
  const STUCK_BAIL = 0.9;       // s of blocked movement before it gives up the hunt
  // depth targets, as a MULTIPLE of the species' authored swim depth
  /* HOW DEEP THIS SHARK WANTS TO BE, per hunt state, as a multiple of its own
     authored draft. The HUNTING numbers are under 1 on purpose — a shark that
     has your scent rides high enough for the dorsal to cut the surface, which
     is the whole read — and none of them is touched below.

     MARINE_SIT_DEEPER (owner, 2026-08-25: "orcas and sharks are just slightly
     too high up in the water … this out-of-water bit should go under water and
     dive more naturally") trims only the two RESTING states — the cruise
     nobody is being hunted in, and the post-bail disengage — so an idle sea
     sits its animals lower without ever taking the fin away from the moment it
     is supposed to be there. Declared in city/wildlife_tame.js; one switch
     covers the ridden body, the pod and this. ?cfg_MARINE_SIT_DEEPER=0 reverts. */
  const SITLOW = () => !(CBZ.CONFIG && CBZ.CONFIG.MARINE_SIT_DEEPER === false);
  const DIVE = {
    cruise: 1.55, scent: 0.95, circle: 0.9, bump: 0.85,
    vanish: 9, rush: 1.9, seize: 0.8, disengage: 2.4,
  };
  const DIVE_LOW = { cruise: 1.85, disengage: 2.6 };
  function diveMul(state) {
    if (SITLOW() && DIVE_LOW[state] != null) return DIVE_LOW[state];
    return DIVE[state] != null ? DIVE[state] : (SITLOW() ? DIVE_LOW.cruise : DIVE.cruise);
  }
  // shoreline clearance by hunt state, as a fraction of the spawn clearance.
  // This is the estuary law above, in one table.
  const CLEAR = {
    cruise: 1, disengage: 1, scent: 0.55,
    circle: 0.35, bump: 0.35, vanish: 0.35, rush: 0.18, seize: 0.18,
  };

  function clock() {
    const t = (typeof performance !== "undefined" ? performance.now() : Date.now()) * 0.001;
    return t % 3600;
  }
  function shortest(a) {
    while (a > Math.PI) a -= 6.283185307;
    while (a < -Math.PI) a += 6.283185307;
    return a;
  }
  function surfaceAt(x, z, t) {
    const wf = CBZ.waterField;
    if (wf && wf.surfaceY) { const s = wf.surfaceY(x, z, t); if (isFinite(s)) return s; }
    if (CBZ.citySeaHeightAt) { const s = CBZ.citySeaHeightAt(x, z); if (isFinite(s)) return s; }
    return CBZ.waterSeaY ? CBZ.waterSeaY() : (CBZ.SEA_Y != null ? CBZ.SEA_Y : 0);
  }

  // Can this shark actually get at the target? (predatorHunt's canReach seam.)
  // A shark cannot bite someone standing on a pier, and pretending otherwise
  // would produce the single worst bug this feature could ship.
  function inWater(t) {
    if (!t) return false;
    if (CBZ.player && t === CBZ.player) {
      if (CBZ.citySwimming && CBZ.citySwimming()) return true;
      if (t._swim) return true;
    }
    const p = t.pos || (t.group && t.group.position);
    if (!p) return false;
    if (CBZ.predatorMedium) return CBZ.predatorMedium(p.x, p.y, p.z) === "water";
    if (CBZ.cityWaterAt && !CBZ.cityWaterAt(p.x, p.z)) return false;
    if (CBZ.citySeaHeightAt) return p.y <= CBZ.citySeaHeightAt(p.x, p.z) + 0.5;
    return !!(CBZ.cityWaterAt && CBZ.cityWaterAt(p.x, p.z));
  }

  // ============================================================
  //  THE SURFACE PROXY — WHAT A SHARK LOOKS LIKE FROM ABOVE THE WATER.
  //
  //  docs/SHARK-REFERENCE.md sections 4 (FROM DIRECTLY ABOVE) and 5 (THE FIN
  //  AT THE SURFACE) are the acceptance criteria for everything below, and
  //  the owner's two photographs are the whole brief: a lone dorsal cutting a
  //  calm sea, and a drone shot of a shark in blue water seen from a boat.
  //
  //  Seven thin objects (two of them only when they are earned), in the SAME
  //  parent as the shark group but never inside it, so the body can be hidden
  //  while the surface read carries on:
  //
  //    1. THE FIN     — a scythe BLADE: convex leading edge, rounded apex
  //                     leaning BACK, and a distinctly CONCAVE trailing edge.
  //                     Mottled by a deterministic hash, pale and washed along
  //                     the trailing margin (the translucent read), lit.
  //    2. THE WAKE    — ONE textured quad: a short trailing ripple that only
  //                     becomes the heavy white V on the rush. A cruising
  //                     shark makes almost no wake and the reference says so.
  //    3. THE BOW     — a small crescent of disturbance at the fin's leading
  //                     edge, the thing that says the fin is MOVING.
  //    4. THE BODY    — the pale grey-brown torpedo you see through the water
  //                     from a deck. Shark-SHAPED (torpedo + swept pectorals +
  //                     crescent tail). An ellipse is not a shark.
  //    5. THE TAIL    — the upper caudal lobe, the SECOND thing that cuts the
  //                     surface when a shark is genuinely shallow, a body
  //                     length astern of the dorsal. Real, recognisable, and
  //                     not to be confused with the double-DORSAL bug below.
  //    6. THE SPRAY    — a torn sheet of white off the blade at speed, built
  //                     the first time an animal is fast enough to need one.
  //    7. THE SHADOW  — the darker mass under it, OFFSET away from the sun by
  //                     depth and softer/bigger the deeper it is. The double
  //                     read — pale body plus a separate darker shadow — is
  //                     what actually sells depth in the drone photograph.
  //
  //  NOTHING HERE IS TYPED PER SPECIES. The blade's height, chord, fore-aft
  //  station and COLOUR, and the silhouette's length and beam, are measured
  //  ONCE per species off the authored model (city/wildlife/aquatic.js) and
  //  cached: the tallest child mesh is the dorsal, the mesh under it is the
  //  back. So a hammerhead gets its tall narrow scythe, an orca gets a tall
  //  BLACK blade, a megalodon gets a slab, and a species that does not exist
  //  yet gets the right fin the day it is authored. If aquatic.js publishes a
  //  descriptor it wins over the measurement:
  //
  //      group.userData.sharkFin = {           // or userData.sharkShape.fin
  //        height, base,        // model units: blade above the back, chord
  //        x, backY,            // model units: fore-aft station, back line
  //        color,               // 0xRRGGBB blade colour
  //        thickness,           // fraction of the chord
  //        planLength, planBeam // model units, for the top-down silhouette
  //      }
  //
  //  THE FIN BREAKS THE WATER FOR REAL. Its root sits on the animal's actual
  //  back and the sea is opaque and depth-writing, so how much blade shows is
  //  decided by the body's live depth against the live swell — a shark at 2 m
  //  shows nothing, a shark cruising the surface shows a third of its dorsal,
  //  a shark on the rush shows fin and back. The old proxy raised a fixed cone
  //  out of the water on a fade curve, which is why the handover from the
  //  authored dorsal to the proxy used to jump.
  //
  //  ONE DORSAL, ALWAYS. The proxy draws only while the body group is NOT on
  //  screen (grp.visible === false). The old test mirrored sharkBrain's own
  //  showR expression, which is right during a hunt (the hunt hides the body
  //  past showR) and WRONG everywhere else: wildlife.js's LOD keeps a cruising
  //  shark's body visible to ~360 u, so a shallow cruiser between 68 u and
  //  137 u drew its authored dorsal AND a proxy cone — the owner's "another
  //  fin above the fin", from the other direction. Asking the one question
  //  that matters ("is the real dorsal being drawn?") cannot disagree with
  //  itself the way two mirrored expressions can.
  //
  //  Reverts: SHARK_FIN_V2=false (cone + old fade + old visibility law),
  //  SHARK_WAKE_V2=false (the old oversized V), SHARK_SHADOW_V2=false (the old
  //  single soft ellipse), SHARK_SHADOW_VIEW=false (depth fade stops caring
  //  where the camera is). SHARK_SHADOW=false still removes it all.
  //
  //  COST: 5 meshes and 5 draw calls per SURFACED shark (was 4), plus a sixth
  //  for the tail tip on species that actually have one standing above the
  //  back line, plus a seventh built LAZILY the first time that animal breaks
  //  4 m/s with a blade in the air. All share module-wide geometry, four
  //  128 kB-class canvas textures and one material per species; three small
  //  materials per shark, because their opacity animates with that one
  //  animal's depth and speed. Nothing is allocated per frame.
  //  world/water_wake.js's audit wants this file's wake retired into
  //  CBZ.waterWakeFor: NOT DONE and not a one-liner — the ribbon it would draw
  //  is kind:"boat" only, claims one of 4-6 camera-ranked slots meant for
  //  hulls, and is sized off a beam. A fin needs a one-metre disturbance, not
  //  a foam highway. What this pass DID do is halve the private surface: two
  //  stretched quads and their two carrier groups became one textured quad.
  // ============================================================
  let quadGeo = null, finGeo = null, finGeoV1 = null, shadowGeoV1 = null;
  let wakeMat = null, bowMat = null, finMatV1 = null;
  let silTex = null, wakeTex = null, bowTex = null, sprayTex = null;
  const finMats = new Map();            // species blade colour -> one material
  let BLADE_CONCAVITY = 0;              // measured off the built outline
  let SIL_FILL = 0.785;                 // measured off the silhouette texture

  function fin2() { return !(CBZ.CONFIG && CBZ.CONFIG.SHARK_FIN_V2 === false); }
  function wake2() { return !(CBZ.CONFIG && CBZ.CONFIG.SHARK_WAKE_V2 === false); }
  function shadow2() { return !(CBZ.CONFIG && CBZ.CONFIG.SHARK_SHADOW_V2 === false); }
  function shadowView() { return !(CBZ.CONFIG && CBZ.CONFIG.SHARK_SHADOW_VIEW === false); }
  function tailTip() { return fin2() && !(CBZ.CONFIG && CBZ.CONFIG.SHARK_TAIL_TIP === false); }
  function surfLife() { return fin2() && !(CBZ.CONFIG && CBZ.CONFIG.SHARK_SURFACE_LIFE === false); }

  // Deterministic integer hash — the mottling has to be identical in every
  // build, on every machine, forever (this file's determinism law), so no
  // Math.random may touch anything that becomes geometry.
  function hash1(i) {
    let h = (Math.imul(i | 0, 2654435761)) >>> 0;
    h ^= h >>> 15; h = Math.imul(h, 2246822519) >>> 0; h ^= h >>> 13;
    return (h >>> 0) / 4294967296;
  }
  function qbez(p0, c, p1, t, out) {
    const u = 1 - t;
    out[0] = u * u * p0[0] + 2 * u * t * c[0] + t * t * p1[0];
    out[1] = u * u * p0[1] + 2 * u * t * c[1] + t * t * p1[1];
    return out;
  }

  /* ---- 1. THE BLADE ------------------------------------------------------
     A unit fin: chord 1 along x (+x forward), height 1 up, thin in z. Species
     differences are non-uniform scale on this one geometry — a hammerhead is
     this blade tall and narrow, a megalodon is this blade huge.

     LEADING EDGE convex, sweeping up and BACK. APEX rounded, sitting behind
     the leading root (the "leaning back" of the reference). TRAILING EDGE a
     concave scythe running down to a small free rear tip. Cross-section is a
     lens: one thick spine vertex, zero thickness all round the outline, so it
     is watertight, faceted like skin, and 32 triangles. */
  const B_LEAD = [0.50, 0.00], B_LEADC = [0.30, 0.62];
  const B_APEXF = [-0.06, 1.000], B_APEXB = [-0.17, 0.978];
  const B_TRAILC = [-0.14, 0.30], B_TIP = [-0.50, 0.06];
  function buildBlade() {
    const pts = [], trailFrom = 8, tmp = [0, 0];
    const N = 6;
    for (let i = 0; i <= N; i++) { qbez(B_LEAD, B_LEADC, B_APEXF, i / N, tmp); pts.push([tmp[0], tmp[1]]); }
    pts.push([B_APEXB[0], B_APEXB[1]]);                       // rounded apex shoulder
    for (let i = 1; i <= N; i++) { qbez(B_APEXB, B_TRAILC, B_TIP, i / N, tmp); pts.push([tmp[0], tmp[1]]); }
    const trailTo = pts.length - 1;
    pts.push([-0.20, 0.015], [0.14, 0.006]);                  // the base, along the back

    // CONCAVITY, measured rather than asserted: the deepest excursion of the
    // trailing edge from the straight apex->tip chord, as a fraction of that
    // chord. A cone scores 0. This is what the before/after preset reads.
    const ax = pts[trailFrom - 1][0], ay = pts[trailFrom - 1][1];
    const bx = B_TIP[0], by = B_TIP[1];
    const cl = Math.hypot(bx - ax, by - ay) || 1;
    let dev = 0;
    for (let i = trailFrom; i <= trailTo; i++) {
      const d = Math.abs((bx - ax) * (ay - pts[i][1]) - (ax - pts[i][0]) * (by - ay)) / cl;
      if (d > dev) dev = d;
    }
    BLADE_CONCAVITY = Number((dev / cl).toFixed(4));

    const TH = 0.075;                       // half-thickness at the spine
    const spine = [0.02, 0.36];
    const pos = [], col = [];
    const c = new THREE.Color();
    function tint(i, x, y, onTrail, spineV) {
      // Multipliers on the species' blade colour: dark and heavy at the root,
      // lighter up the blade, and PALE and washed out along the trailing
      // margin, which is where a real dorsal goes thin and lets light through.
      let k = spineV ? 0.70 : 0.76 + 0.36 * y;
      if (onTrail) k *= 1.62;
      k *= 0.93 + 0.15 * hash1(i * 7 + 13);          // mottling, deterministic
      c.setRGB(k, k * (onTrail ? 1.02 : 0.99), k * (onTrail ? 1.05 : 0.96));
      col.push(c.r, c.g, c.b);
    }
    const n = pts.length;
    for (let side = 0; side < 2; side++) {
      const z = side ? -TH : TH;
      for (let i = 0; i < n; i++) {
        const p0 = pts[i], p1 = pts[(i + 1) % n];
        const a = side ? p1 : p0, b = side ? p0 : p1;
        const ia = side ? (i + 1) % n : i, ib = side ? i : (i + 1) % n;
        pos.push(spine[0], spine[1], z); tint(99, spine[0], spine[1], false, true);
        pos.push(a[0], a[1], 0); tint(ia, a[0], a[1], ia >= trailFrom - 1 && ia <= trailTo, false);
        pos.push(b[0], b[1], 0); tint(ib, b[0], b[1], ib >= trailFrom - 1 && ib <= trailTo, false);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }

  /* ---- 2. THE SILHOUETTE TEXTURE ----------------------------------------
     The drone read. A shark from directly above is a narrow torpedo widest at
     the pectoral line, long pectorals swept back ~30 degrees, a tall crescent
     tail with the upper lobe clearly longer, and a dorsal that is a sliver of
     nothing. Drawn once into a canvas — white, alpha carries the shape — so
     both the pale body-through-water and the dark offset shadow are the same
     two triangles with different tints. Soft edges come from stacking the
     same path at decreasing scale, which is a blur a 2013 GPU also has. */
  function drawPlan(ctx, W, H, k) {
    const cx = W * 0.5, cy = H * 0.5, L = W * 0.90 * k, hw = H * 0.44 * k;
    const X = (f) => cx + f * L * 0.5;          // f: +1 nose .. -1 tail tip
    const Y = (f) => cy + f * hw;               // f: -1 .. +1 across
    ctx.beginPath();
    // right flank, nose -> tail
    ctx.moveTo(X(1.00), Y(0));
    ctx.bezierCurveTo(X(0.92), Y(0.10), X(0.72), Y(0.17), X(0.30), Y(0.21));
    ctx.lineTo(X(0.18), Y(0.215));
    // pectoral: long, swept back, pointed
    ctx.lineTo(X(0.12), Y(0.30));
    ctx.quadraticCurveTo(X(0.02), Y(0.86), X(-0.10), Y(1.00));
    ctx.quadraticCurveTo(X(-0.02), Y(0.52), X(0.02), Y(0.26));
    // flank on to the pelvic fin and the peduncle
    ctx.bezierCurveTo(X(-0.16), Y(0.21), X(-0.30), Y(0.17), X(-0.42), Y(0.13));
    ctx.lineTo(X(-0.46), Y(0.30));
    ctx.lineTo(X(-0.54), Y(0.12));
    ctx.lineTo(X(-0.66), Y(0.07));
    // caudal: upper lobe long, lower lobe short, notched between them
    ctx.lineTo(X(-0.74), Y(0.42));
    ctx.quadraticCurveTo(X(-0.90), Y(0.66), X(-1.00), Y(0.70));
    ctx.quadraticCurveTo(X(-0.86), Y(0.30), X(-0.80), Y(0.02));
    // and mirrored back up the left flank
    ctx.quadraticCurveTo(X(-0.86), Y(-0.30), X(-1.00), Y(-0.70));
    ctx.quadraticCurveTo(X(-0.90), Y(-0.66), X(-0.74), Y(-0.42));
    ctx.lineTo(X(-0.66), Y(-0.07));
    ctx.lineTo(X(-0.54), Y(-0.12));
    ctx.lineTo(X(-0.46), Y(-0.30));
    ctx.lineTo(X(-0.42), Y(-0.13));
    ctx.bezierCurveTo(X(-0.30), Y(-0.17), X(-0.16), Y(-0.21), X(0.02), Y(-0.26));
    ctx.quadraticCurveTo(X(-0.02), Y(-0.52), X(-0.10), Y(-1.00));
    ctx.quadraticCurveTo(X(0.02), Y(-0.86), X(0.12), Y(-0.30));
    ctx.lineTo(X(0.18), Y(-0.215));
    ctx.lineTo(X(0.30), Y(-0.21));
    ctx.bezierCurveTo(X(0.72), Y(-0.17), X(0.92), Y(-0.10), X(1.00), Y(0));
    ctx.closePath();
    ctx.fill();
  }
  function makeSilTexture() {
    const c = document.createElement("canvas");
    c.width = 256; c.height = 128;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#ffffff";
    // soft halo first (each ring adds a little alpha), then the solid core
    for (let i = 5; i >= 1; i--) {
      ctx.globalAlpha = 0.13;
      drawPlan(ctx, 256, 128, 1 + i * 0.030);
    }
    ctx.globalAlpha = 1;
    drawPlan(ctx, 256, 128, 1);
    // the dorsal from overhead: a thin sliver, almost nothing (ref sec. 4)
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.ellipse(128 + 256 * 0.03, 64, 256 * 0.055, 2.4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    // HOW SHARK-SHAPED IS IT? The fraction of the quad the silhouette actually
    // covers. A filled ellipse — the shape this replaced — scores pi/4 = 0.785
    // no matter how it is stretched; an animal with a waist, swept pectorals
    // and a notched tail scores far less. Measured, not asserted, because the
    // before/after preset reports it.
    try {
      const px = ctx.getImageData(0, 0, 256, 128).data;
      let on = 0;
      for (let i = 3; i < px.length; i += 4) if (px[i] > 128) on++;
      SIL_FILL = Number((on / (256 * 128)).toFixed(4));
    } catch (e) {}
    return c;
  }

  /* ---- 3. THE WAKE TEXTURE ----------------------------------------------
     "The wake is SMALL — a low bow-disturbance at the leading edge and a short
     trailing ripple. A big white V is wrong for a cruising shark; save the
     heavy wake for the rush." So the V lives in the TEXTURE, feathered and
     already fading out along its length, and the quad it rides is scaled down
     to almost nothing at cruise and only opened up on the rush. u = along the
     body axis (u=1 is the fin), v = across. */
  function makeWakeTexture() {
    const W = 192, H = 96;
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const ctx = c.getContext("2d");
    const apex = [W - 6, H * 0.5];
    for (let arm = -1; arm <= 1; arm += 2) {
      for (let pass = 0; pass < 5; pass++) {
        const spread = 0.30 + pass * 0.055;
        const g = ctx.createLinearGradient(apex[0], 0, 0, 0);
        g.addColorStop(0, "rgba(255,255,255," + (0.42 - pass * 0.07).toFixed(3) + ")");
        g.addColorStop(0.45, "rgba(255,255,255," + (0.22 - pass * 0.04).toFixed(3) + ")");
        g.addColorStop(1, "rgba(255,255,255,0)");
        ctx.strokeStyle = g;
        ctx.lineWidth = 2.4 + pass * 2.6;
        ctx.beginPath();
        ctx.moveTo(apex[0], apex[1]);
        ctx.quadraticCurveTo(W * 0.45, apex[1] + arm * H * spread * 0.55,
                             0, apex[1] + arm * H * spread);
        ctx.stroke();
      }
    }
    // the churn itself: a narrow band right behind the fin, gone within a
    // couple of body lengths
    const g2 = ctx.createLinearGradient(apex[0], 0, W * 0.25, 0);
    g2.addColorStop(0, "rgba(255,255,255,0.34)");
    g2.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g2;
    ctx.fillRect(0, H * 0.42, W, H * 0.16);
    return c;
  }
  function makeBowTexture() {
    const S = 64;
    const c = document.createElement("canvas");
    c.width = S; c.height = S;
    const ctx = c.getContext("2d");
    for (let pass = 0; pass < 4; pass++) {
      ctx.strokeStyle = "rgba(255,255,255," + (0.30 - pass * 0.06).toFixed(3) + ")";
      ctx.lineWidth = 2 + pass * 3;
      ctx.beginPath();
      // a crescent bulging forward (+u), open astern
      ctx.arc(S * 0.30, S * 0.5, S * 0.30, -Math.PI * 0.42, Math.PI * 0.42);
      ctx.stroke();
    }
    return c;
  }
  /* ---- 3b. THE SPRAY ----------------------------------------------------
     A blade travelling at 11 m/s does not slice the water silently — it throws
     a torn sheet of white off its trailing edge. Deterministic blob cluster,
     dense and opaque at the waterline, torn and transparent at the top, which
     is the only thing that makes a sprite read as water rather than as smoke.
     u = along the blade (u=0 astern), v = up (v=1 is the waterline). */
  function makeSprayTexture() {
    const S = 64;
    const c = document.createElement("canvas");
    c.width = S; c.height = S;
    const ctx = c.getContext("2d");
    for (let i = 0; i < 34; i++) {
      const a = hash1(i * 3 + 1), b = hash1(i * 3 + 2), r = hash1(i * 3 + 3);
      const x = S * (0.10 + a * 0.86);
      // higher blobs sit further astern — a plume that leans back as it climbs
      const lift = Math.pow(b, 1.5);
      const y = S * (0.98 - lift * 0.92) + (a - 0.5) * S * 0.10;
      const rad = S * (0.055 + r * 0.10) * (1 - lift * 0.45);
      const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
      const al = (0.34 - lift * 0.26).toFixed(3);
      g.addColorStop(0, "rgba(255,255,255," + al + ")");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill();
    }
    // the solid root of the sheet, right where the blade meets the water
    const g2 = ctx.createLinearGradient(0, S, 0, S * 0.55);
    g2.addColorStop(0, "rgba(255,255,255,0.55)");
    g2.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g2;
    ctx.fillRect(0, S * 0.55, S, S * 0.45);
    return c;
  }
  function canvasTex(c) {
    const t = new THREE.CanvasTexture(c);
    if (THREE.sRGBEncoding != null) t.encoding = THREE.sRGBEncoding;   // r128-safe
    t.needsUpdate = true;
    t._shared = true;
    return t;
  }

  function assets() {
    if (quadGeo) return;
    quadGeo = new THREE.PlaneGeometry(1, 1);
    finGeo = buildBlade();
    finGeoV1 = new THREE.ConeGeometry(0.5, 1.2, 4);        // the pre-V2 dorsal
    shadowGeoV1 = new THREE.CircleGeometry(0.5, 18);       // the pre-V2 ellipse
    silTex = canvasTex(makeSilTexture());
    wakeTex = canvasTex(makeWakeTexture());
    bowTex = canvasTex(makeBowTexture());
    sprayTex = canvasTex(makeSprayTexture());
    wakeMat = new THREE.MeshBasicMaterial({
      map: wakeTex, color: 0xe2edf2, transparent: true, opacity: 0.42,
      depthWrite: false, side: THREE.DoubleSide,
    });
    bowMat = new THREE.MeshBasicMaterial({
      map: bowTex, color: 0xeef6fa, transparent: true, opacity: 0.5,
      depthWrite: false, side: THREE.DoubleSide,
    });
    finMatV1 = new THREE.MeshLambertMaterial({ color: 0x59636b });   // pre-V2 cone
    // EVERY SHARK IN THE WORLD SHARES THESE OBJECTS, so the repo's disposal
    // sweeps must be told to keep their hands off: gore.js's rm(), the rig
    // teardowns and the per-group cleaners all skip anything tagged _shared
    // and dispose everything else. The first sweep that reached one of these
    // would otherwise dispose one shark's fin and blank every other one.
    // (The two SILHOUETTE materials are deliberately per-shark — their opacity
    // animates with that one animal's depth — so only geometry and textures
    // join this pool.)
    quadGeo._shared = finGeo._shared = finGeoV1._shared = shadowGeoV1._shared = true;
    wakeMat._shared = bowMat._shared = finMatV1._shared = true;
  }
  // One blade material per species colour, not per shark: a lit Lambert whose
  // vertex colours carry the mottling and the pale trailing margin.
  function finMatFor(hex) {
    let m = finMats.get(hex);
    if (!m) {
      m = new THREE.MeshLambertMaterial({ color: hex, vertexColors: true });
      m._shared = true;
      finMats.set(hex, m);
    }
    return m;
  }

  /* ---- 4. MEASURING THE AUTHORED ANIMAL ---------------------------------
     Once per SPECIES, off the real model, in model units (the group's own
     scale is divided out and re-applied live, so a half-grown shark gets a
     half-sized fin for free). The tallest child mesh is the dorsal; the back
     is the top of whatever the dorsal stands on — which is the hull for a
     shark and the torso box for an orca, without either being named here. */
  const plans = new Map();
  function speciesPlan(sp, grp) {
    const key = (sp && sp.id) || "shark";
    let p = plans.get(key);
    if (p) return p;
    const declared = (grp.userData && (grp.userData.sharkFin ||
      (grp.userData.sharkShape && grp.userData.sharkShape.fin))) || null;
    grp.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(grp.matrixWorld).invert();
    const m = new THREE.Matrix4(), bb = new THREE.Box3(), all = new THREE.Box3();
    let dorsalTop = -1e9, dorsal = null, hull = null;
    const dorsalBox = new THREE.Box3();
    const parts = [];
    grp.traverse(function (o) {
      if (!o.isMesh || !o.geometry) return;
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      if (!o.geometry.boundingBox) return;
      m.multiplyMatrices(inv, o.matrixWorld);
      bb.copy(o.geometry.boundingBox).applyMatrix4(m);
      all.union(bb);
      parts.push({ o: o, min: bb.min.clone(), max: bb.max.clone() });
      if (o.name === "sharkHull") hull = parts[parts.length - 1];
      if (bb.max.y > dorsalTop) { dorsalTop = bb.max.y; dorsal = parts[parts.length - 1]; dorsalBox.copy(bb); }
    });
    const len = Math.max(0.4, all.max.x - all.min.x);
    const beam = Math.max(0.15, all.max.z - all.min.z);
    const dCx = dorsal ? (dorsalBox.min.x + dorsalBox.max.x) * 0.5 : 0;
    // the back under the dorsal: the tallest part that spans the dorsal's own
    // station, ignoring the dorsal (a tail lobe stands higher than the back
    // and must not be mistaken for it)
    let backY = -1e9;
    for (let i = 0; i < parts.length; i++) {
      const q = parts[i];
      if (q === dorsal) continue;
      if (dCx < q.min.x || dCx > q.max.x) continue;
      if (q.max.y > backY) backY = q.max.y;
    }
    if (hull && hull.max.y > -1e8) backY = hull.max.y;
    if (backY < -1e8) backY = all.min.y + (all.max.y - all.min.y) * 0.55;
    // THE TAIL TIP, measured exactly like the dorsal: the highest thing in the
    // rear quarter of the animal that is not the dorsal. On a shark that is the
    // upper caudal lobe, which stands nearly as tall as the dorsal and breaks
    // the surface a body-length astern of it on a shallow cruise — the real
    // two-fin read, and the reason this is measured and not typed. On a DOLPHIN
    // the flukes are horizontal, so this comes back at (or under) the back line
    // and the tail simply never shows. Nothing here says the word "dolphin".
    const rearX = all.min.x + len * 0.24;
    let tailTop = -1e9, tailCx = all.min.x + len * 0.10, tailChord = len * 0.18;
    for (let i = 0; i < parts.length; i++) {
      const q = parts[i];
      if (q === dorsal || q.min.x > rearX) continue;
      if (q.max.y <= tailTop) continue;
      tailTop = q.max.y;
      tailCx = Math.max(all.min.x, Math.min(rearX, (q.min.x + q.max.x) * 0.5));
      tailChord = Math.max(len * 0.06, Math.min(len * 0.30, q.max.x - q.min.x));
    }
    if (tailTop < -1e8) tailTop = backY;
    // blade colour: whatever the authored dorsal is actually painted, so an
    // orca's proxy is BLACK without this file ever hearing the word "orca"
    let hex = (sp && sp.color) || 0x59636b;
    const mat = dorsal && dorsal.o.material;
    const mm = Array.isArray(mat) ? mat[0] : mat;
    if (mm && mm.color && mm.color.getHex) hex = mm.color.getHex();
    p = {
      finH: Math.max(0.15, dorsalTop - backY),
      finBase: dorsal ? Math.max(0.2, dorsalBox.max.x - dorsalBox.min.x) : 1,
      finX: dCx, backY: backY, color: hex,
      planLen: len, planBeam: beam,
      bodyCx: (all.min.x + all.max.x) * 0.5,
      thick: 0.50,
      tailY: tailTop, tailX: tailCx, tailBase: tailChord,
      tailH: Math.max(0, tailTop - backY),
    };
    if (declared) {
      if (declared.height > 0) p.finH = +declared.height;
      if (declared.base > 0) p.finBase = +declared.base;
      if (Number.isFinite(declared.x)) p.finX = +declared.x;
      if (Number.isFinite(declared.backY)) p.backY = +declared.backY;
      if (Number.isFinite(declared.color)) p.color = +declared.color;
      if (declared.thickness > 0) p.thick = +declared.thickness;
      if (declared.planLength > 0) p.planLen = +declared.planLength;
      if (declared.planBeam > 0) p.planBeam = +declared.planBeam;
      if (declared.tailHeight >= 0) { p.tailH = +declared.tailHeight; p.tailY = p.backY + p.tailH; }
      if (Number.isFinite(declared.tailX)) p.tailX = +declared.tailX;
      p.declared = true;
    }
    plans.set(key, p);
    return p;
  }

  // Where a shadow falls: away from the sun, further the deeper the body.
  // Cached for the whole frame — every shark in the world shares one sun.
  let _sunT = -1, _sunX = 1, _sunZ = 0, _sunLean = 0.35;
  function sunGround(t) {
    if (Math.abs(t - _sunT) < 0.004) return;
    _sunT = t;
    const s = CBZ.sun, tg = CBZ.sunTarget;
    if (!s || !s.position) return;
    const vx = s.position.x - (tg && tg.position ? tg.position.x : 0);
    const vy = s.position.y - (tg && tg.position ? tg.position.y : 0);
    const vz = s.position.z - (tg && tg.position ? tg.position.z : 0);
    const h = Math.hypot(vx, vz);
    if (h < 1e-4) { _sunX = 1; _sunZ = 0; _sunLean = 0; return; }
    _sunX = -vx / h; _sunZ = -vz / h;                  // the shadow runs this way
    _sunLean = Math.max(0, Math.min(1.5, h / Math.max(0.5, Math.abs(vy))));
  }

  function makeProxy(a, s) {
    assets();
    const parent = (a.group && a.group.parent) || CBZ.scene;
    if (!parent) return null;
    const plan = s.plan || (s.plan = speciesPlan(a.species || {}, a.group));
    const root = new THREE.Group();
    root.userData.dynamic = true;                           // batcher/freezer: hands off
    const v2 = fin2();
    const fin = new THREE.Mesh(v2 ? finGeo : finGeoV1,
      v2 ? finMatFor(plan.color) : finMatV1);
    fin.castShadow = false;
    if (!v2) fin.rotation.z = 0.2;                          // the pre-V2 rake
    root.add(fin);

    // THE TAIL TIP — the same blade, smaller, raked hard back, standing a
    // body-length astern. It has no fade of its own: the water either reaches
    // over it or it does not, which is exactly how the real read works.
    if (tailTip() && plan.tailH > 0.02) {
      const tail = new THREE.Mesh(finGeo, finMatFor(plan.color));
      tail.rotation.z = 0.42;                               // the caudal's rake
      tail.castShadow = false;
      tail.visible = false;
      root.add(tail);
      s.tail = tail;
    }

    const wake = new THREE.Mesh(quadGeo, wakeMat);
    wake.rotation.x = -Math.PI / 2;                         // lie flat on the water
    wake.renderOrder = 4;
    wake.castShadow = false;
    root.add(wake);
    const bow = new THREE.Mesh(quadGeo, bowMat);
    bow.rotation.x = -Math.PI / 2;
    bow.renderOrder = 4;
    bow.castShadow = false;
    root.add(bow);

    // The submerged mass, as seen from a deck: the pale body through the water
    // and the darker offset shadow under it. Both lie flat just OVER the
    // waterline — the sea depth-writes, so anything meant to read as "under
    // it" must in fact be drawn just above it.
    if (shadowOn()) {
      const sh2 = shadow2();
      s.shadowMat = new THREE.MeshBasicMaterial({
        color: 0x06131c, map: sh2 ? silTex : null, transparent: true,
        opacity: SHADOW_ALPHA, depthWrite: false,
      });
      const sh = new THREE.Mesh(sh2 ? quadGeo : shadowGeoV1, s.shadowMat);
      sh.rotation.x = -Math.PI / 2;
      sh.position.y = 0.015;
      sh.renderOrder = 2;
      sh.castShadow = false;
      root.add(sh);
      s.shadow = sh;
      if (sh2) {
        // the pale grey-brown torpedo itself — species colour lifted toward
        // the water, because that is what a body under a metre of sea looks
        // like from above. Only the V2 read has it; V1 was one dark ellipse.
        const c = new THREE.Color((a.species && a.species.color) || 0x6b7880);
        c.lerp(new THREE.Color(0xdfe9e6), 0.42);
        s.bodyMat = new THREE.MeshBasicMaterial({
          color: c.getHex(), map: silTex, transparent: true,
          opacity: SHADOW_ALPHA, depthWrite: false,
        });
        const bodySil = new THREE.Mesh(quadGeo, s.bodyMat);
        bodySil.rotation.x = -Math.PI / 2;
        bodySil.position.y = 0.022;
        bodySil.renderOrder = 3;
        bodySil.castShadow = false;
        root.add(bodySil);
        s.bodySil = bodySil;
      }
    }
    parent.add(root);
    s.root = root; s.fin = fin; s.wake = wake; s.bow = bow;
    return root;
  }

  // THE SPRAY is built the first time an animal is actually fast enough to
  // throw one, so a whole ocean of cruising sharks never pays for it. Its
  // material is per-shark because the opacity rides that one animal's speed.
  function ensureSpray(s) {
    if (s.spray || !s.root) return s.spray;
    s.sprayMat = new THREE.MeshBasicMaterial({
      map: sprayTex, color: 0xf4fbff, transparent: true, opacity: 0,
      depthWrite: false, side: THREE.DoubleSide,
    });
    const m = new THREE.Mesh(quadGeo, s.sprayMat);
    m.renderOrder = 6;
    m.castShadow = false;
    s.root.add(m);
    s.spray = m;
    return m;
  }

  // The proxy is driven from the actor's LIVE transform every frame no matter
  // who moved it — that is what keeps it independent of the body's LOD.
  function proxy(a, s, dist, dt) {
    const grp = a.group; if (!grp) return;
    const t = clock();
    const surf = surfaceAt(grp.position.x, grp.position.z, t);
    const dep = surf - grp.position.y;
    if (!s.owned) s.dive = dep;                           // resync while wildlife drives it
    // speed for the wake, from real displacement (no per-frame allocation)
    const dx = s.px == null ? 0 : grp.position.x - s.px;
    const dz = s.pz == null ? 0 : grp.position.z - s.pz;
    s.px = grp.position.x; s.pz = grp.position.z;
    const spd = dt > 0 ? Math.sqrt(dx * dx + dz * dz) / dt : 0;
    s.spd += (spd - s.spd) * Math.min(1, dt * 4);
    // TURN RATE, for the bank. Same trick as the speed: read the transform,
    // never ask the driver, so the fin banks whoever is steering the animal.
    const dh = s.ph == null ? 0 : shortest(a.heading - s.ph);
    s.ph = a.heading;
    s.yaw += ((dt > 0 ? dh / dt : 0) - s.yaw) * Math.min(1, dt * 5);

    if (!s.plan) { try { s.plan = speciesPlan(a.species || {}, grp); } catch (e) { return; } }
    const plan = s.plan;
    const sz = (grp.scale && grp.scale.x) || 1;
    s.sz = sz;
    const hidden = s.state === "vanish" || s.state === "disengage";
    const finR = ((s.opts && s.opts.senseR) || SENSE_R) * FIN_F;
    // HOW MUCH BLADE IS OUT OF THE WATER: the root rides the animal's real
    // back, the tip is one blade higher, and the swell decides the rest.
    const backY = grp.position.y + plan.backY * sz;
    const finH = plan.finH * sz;
    const exposed = backY + finH - surf;
    let want;
    if (fin2()) {
      // ONE DORSAL: draw the stand-in only while the real one is not drawn.
      want = (!a.dead && ON() && !hidden && grp.visible === false &&
              dist < finR && exposed > 0.02) ? 1 : 0;
    } else {
      // the pre-V2 law, kept whole so the A/B compares behaviours and not code
      const shallow = dep < (a.swimDepth || 2) * 1.4;
      const showR = ((s.opts && s.opts.senseR) || SENSE_R) * SHOW_F;
      const crisp = dist < showR || s.state === "rush" || s.state === "seize";
      want = (!a.dead && ON() && shallow && !hidden && !(grp.visible !== false && crisp) &&
              dist < finR) ? 1 : 0;
    }
    // The SUBMERGED MASS has a wider envelope than the fin: any body within
    // reach of the surface shows one, fin up or not — but it honours `hidden`
    // exactly like the fin, because predator.js's vanish beat only works if
    // the thing genuinely disappears. Depth is the fade axis, and HOW FAR YOU
    // CAN SEE INTO WATER DEPENDS ON WHERE YOUR EYE IS: at a swimmer's eye the
    // surface is a mirror, from a boat deck four metres up you are looking
    // through it. SHADOW_DEPTH was tuned at the waterline; this restores the
    // deck view without touching that number.
    let reach = SHADOW_DEPTH * Math.max(1, sz * 0.8);
    if (shadowView()) {
      const cam = CBZ.camera;
      let sinE = 0.05;
      if (cam && cam.position) {
        const cy = cam.position.y - surf;
        const cd = Math.hypot(cam.position.x - grp.position.x, cam.position.z - grp.position.z);
        sinE = Math.max(0, Math.min(1, cy / Math.max(0.5, Math.hypot(cy, cd))));
      }
      reach *= 0.95 + 1.15 * sinE;
    }
    // ...and it fades in at the SHALLOW end too. Without the second ramp a
    // shark rising through 0.3 m popped its whole silhouette on at 97% alpha,
    // which is a flash exactly at the moment the player is looking hardest.
    const shWant = (shadowOn() && !a.dead && ON() && !hidden && dist < finR * 1.15 && dep > 0.25)
      ? Math.max(0, Math.min(1, 1 - dep / reach)) *
        Math.max(0, Math.min(1, (dep - 0.25) / 0.55)) : 0;
    if (!want && s.finK <= 0.02 && !shWant && (s.shK || 0) <= 0.02) {   // fully down
      if (s.root && s.root.visible) s.root.visible = false;
      s.finK = 0; s.shK = 0;
      return;
    }
    if (!s.root && !makeProxy(a, s)) return;
    s.finK += (want - s.finK) * Math.min(1, dt * (want ? 1.8 : 3.2));
    s.shK = (s.shK || 0) + (shWant - (s.shK || 0)) * Math.min(1, dt * 3);
    const k = s.finK;
    s.root.visible = k > 0.02 || s.shK > 0.02;
    if (!s.root.visible) return;
    // The flat pieces sit over the HIGHEST swell they span, not over the swell
    // at the body's own point: a 6 m silhouette on a 0.4 m sea would otherwise
    // spend half its length inside the water it is drawn on and flicker.
    const len = plan.planLen * sz;
    const hx = Math.cos(a.heading) * len * 0.5, hz = Math.sin(a.heading) * len * 0.5;
    const sA = surfaceAt(grp.position.x + hx, grp.position.z + hz, t);
    const sB = surfaceAt(grp.position.x - hx, grp.position.z - hz, t);
    const top = Math.max(surf, sA, sB);
    s.root.position.set(grp.position.x, top + 0.04, grp.position.z);
    s.root.rotation.y = -a.heading;                         // same yaw law as every animal

    if (s.shadow) {
      const sk = s.shK;
      s.shadow.visible = sk > 0.02;
      if (s.shadow.visible) {
        if (shadow2()) {
          // a deeper body reads as a bigger, softer, fainter smudge — the same
          // blur law a real shadow through water obeys — and it slides away
          // from the sun as it sinks, which is the offset in the drone shot.
          sunGround(t);
          const spread = 1 + dep * 0.085;
          const wid = plan.planBeam * sz * 1.14;             // texture margin (span = 0.88 H)
          s.shadow.scale.set(len * 1.10 * spread, wid * spread, 1);
          s.shadow.position.x = plan.bodyCx * sz;
          // the offset is in WORLD ground space; the root carries the heading,
          // so rotate the sun's direction into the root's frame
          const oX = _sunX * _sunLean * dep, oZ = _sunZ * _sunLean * dep;
          const cs = Math.cos(a.heading), sn = Math.sin(a.heading);
          s.shadow.position.x += oX * cs + oZ * sn;
          s.shadow.position.z = -oX * sn + oZ * cs;
          s.shadowMat.opacity = SHADOW_ALPHA * sk * 0.92;
          // IT IS SWIMMING. One sinusoid of yaw on a flat quad and the mass
          // under the water stops being a decal — the whole silhouette sways
          // the way a body does when the tail beats. Faster when it is.
          const sway = surfLife()
            ? (0.035 + 0.030 * Math.min(1, s.spd / 6)) *
              Math.sin(t * (1.5 + Math.min(3.4, s.spd * 0.42)) + s.phase)
            : 0;
          s.shadow.rotation.z = sway * 0.75;
          if (s.bodySil) {
            // the animal itself, seen THROUGH the water: sharper, tighter, and
            // gone sooner with depth than its own shadow
            const bk = Math.max(0, Math.min(1, (sk - 0.30) / 0.70));
            s.bodySil.visible = bk > 0.02;
            s.bodySil.scale.set(len * 1.10, plan.planBeam * sz * 1.14, 1);
            s.bodySil.position.x = plan.bodyCx * sz;
            s.bodySil.rotation.z = sway;
            s.bodyMat.opacity = 0.55 * bk;
          }
        } else {
          const spread = 1 + dep * 0.10;
          s.shadow.scale.set(4.6 * sz * spread, 1.5 * sz * spread, 1);
          s.shadowMat.opacity = SHADOW_ALPHA * sk;
        }
      } else if (s.bodySil) s.bodySil.visible = false;
    }

    s.fin.visible = k > 0.02;
    if (fin2()) {
      // THE BLADE, sitting on the animal's back, cut by the live surface. The
      // sea is opaque and depth-writes, so the submerged part of the blade is
      // hidden per PIXEL — the waterline crosses the fin exactly where the
      // swell crosses it, which is the whole Jaws shot.
      s.fin.position.set(plan.finX * sz, backY - s.root.position.y - finH * (1 - k) * 0.85, 0);
      s.fin.scale.set(plan.finBase * sz, finH, plan.finBase * sz * plan.thick);
      // a fin cutting water rakes a little; deterministic, tied to the clock
      s.fin.rotation.z = 0.03 * Math.sin(t * 1.7 + plan.finX * 3.1);
      // THE BANK. A shark turns by rolling into the turn, and from a deck the
      // dorsal LEANING is how you read the turn a second before the wake shows
      // it. The roll axis is the animal's own forward axis, which is the
      // blade's local x — rolling it on z (the rake) would just lay it down.
      //
      // THE NUMBER IS NOT INVENTED HERE. wildlife_rig.js's animateSwim already
      // banks the authored body (grp.rotation.x = clamp(turnRate * 0.25, 0.45)),
      // so the proxy uses that animal's OWN roll when the rig is awake and
      // otherwise solves the identical curve itself. A blade that leaned by a
      // different law than the body it stands in for would jump at the LOD
      // handover exactly the way its HEIGHT used to.
      if (!surfLife()) s.bank = 0;
      else if (a.swim && a.swim.roll != null && grp.visible !== false) s.bank = a.swim.roll;
      else {
        // animateSwim early-returns on a hidden body, so its roll goes stale
        // in precisely the band where the proxy fin is the only fin there is.
        const wantB = Math.max(-0.45, Math.min(0.45, s.yaw * 0.25));
        s.bank += (wantB - s.bank) * Math.min(1, dt * 3.2);
      }
      s.fin.rotation.x = s.bank;
      s.finExposed = Math.max(0, exposed);
    } else {
      const fh = 1.2 * sz * 1.15;
      s.fin.position.set(0, fh * 0.5 - fh * (1 - k), 0);
      s.fin.scale.set(sz, sz * 1.15, sz * 0.55);
      s.finExposed = Math.max(0, s.fin.position.y + fh * 0.5);
    }

    // THE TAIL TIP — TWO FINS, AND ON PURPOSE. On a genuinely shallow cruise
    // the upper caudal lobe cuts the surface a body-length astern of the
    // dorsal, and everyone who has ever seen a shark from a boat knows that
    // read. THIS IS NOT THE DOUBLE-FIN BUG, which was two DORSALS at the same
    // station, one of them floating in the air: this one stands at the tail, at
    // its own real height, and appears only when the water genuinely does not
    // reach over it. It is also gated on k, so it can never be drawn while the
    // authored body (which has its own caudal) is on screen.
    s.tailExposed = 0;
    if (s.tail) {
      const tx = plan.tailX * sz;
      const tSurf = surfaceAt(grp.position.x + Math.cos(a.heading) * tx,
                              grp.position.z + Math.sin(a.heading) * tx, t);
      const tH = plan.tailH * sz;
      const tExp = (grp.position.y + plan.tailY * sz) - tSurf;
      s.tail.visible = k > 0.02 && tExp > 0.02;
      if (s.tail.visible) {
        s.tailExposed = tExp;
        s.tail.position.set(tx, grp.position.y + plan.tailY * sz - tH - s.root.position.y, 0);
        s.tail.scale.set(plan.tailBase * sz, tH, plan.tailBase * sz * plan.thick * 0.7);
        s.tail.rotation.x = s.bank * 0.7;                 // the tail rolls too
      }
    }

    // SPRAY. A blade doing eleven metres a second tears a sheet of white off
    // its own trailing edge; a cruising one does not. Needs both a real speed
    // AND a real amount of blade out of the water, so a submerged rush is
    // silent and a drifting fin is dry.
    //
    // NOT GATED ON THE PROXY FIN, and that is deliberate: spray is water, not
    // anatomy. The one frame the player most wants it — a rush from ten metres
    // off the rail — is exactly the frame where the AUTHORED dorsal is on
    // screen and the proxy blade is not, so keying it to k would have made it
    // literally impossible to see. It keys off `exposed`, which is the real
    // blade against the real swell whoever is drawing it.
    const sprayK = surfLife()
      ? Math.max(0, Math.min(1, (s.spd - 4.2) / 6.5)) *
        Math.max(0, Math.min(1, s.finExposed / Math.max(0.05, finH * 0.30)))
      : 0;
    if (sprayK > 0.02) {
      const m = ensureSpray(s);
      if (m) {
        m.visible = true;
        const h = Math.max(0.30, s.finExposed * (1.05 + 0.35 * sprayK));
        const w = h * 2.2;
        m.scale.set(w, h, 1);
        const base = surf - s.root.position.y;            // the waterline, local
        m.position.set(plan.finX * sz - w * 0.34, base + h * 0.42, 0);
        // face the camera: the sheet is a sprite, and edge-on it is nothing
        const cam = CBZ.camera;
        m.rotation.y = cam && cam.position
          ? Math.atan2(cam.position.x - s.root.position.x,
                       cam.position.z - s.root.position.z) + a.heading
          : 0;
        s.sprayMat.opacity = 0.70 * sprayK *
          (0.82 + 0.18 * Math.sin(t * 11.3 + s.phase));   // torn, not a decal
      }
    } else if (s.spray) s.spray.visible = false;

    // THE WAKE. Small by law: a cruising fin leaves a ripple you have to look
    // for, and only the rush earns the white V. It also needs a surface to
    // disturb — a shark two metres down leaves nothing at all.
    const rush = s.state === "rush" || s.state === "seize";
    const surfaced = exposed > -0.15 * finH;
    const moving = s.spd > 0.6 && (wake2() ? surfaced : k > 0.02);
    s.wake.visible = moving;
    s.bow.visible = s.wake.visible && wake2();
    if (s.wake.visible) {
      let wl, ww;
      if (wake2()) {
        const boost = rush ? 2.3 : 1;
        wl = (1.15 + Math.min(2.6, s.spd * 0.40)) * sz * boost;
        ww = (0.42 + Math.min(0.75, s.spd * 0.075)) * sz * (rush ? 1.7 : 1);
      } else {
        wl = (2.2 + Math.min(9, s.spd * 0.85)) * sz;        // the pre-V2 V
        ww = (0.35 + Math.min(1.1, s.spd * 0.09)) * sz * 2;
      }
      s.wake.scale.set(wl, ww, 1);
      s.wake.position.x = plan.finX * sz - wl * 0.5;
      if (s.bow.visible) {
        const bw = plan.finBase * sz * (0.9 + Math.min(0.8, s.spd * 0.08));
        s.bow.scale.set(bw, bw * 0.85, 1);
        s.bow.position.x = plan.finX * sz + plan.finBase * sz * 0.45;
      }
    }
  }

  function dropProxy(a) {
    const s = a && a._shark; if (!s || !s.root) return;
    if (s.root.parent) s.root.parent.remove(s.root);
    // the two silhouette materials are per-shark (their opacity animates), so
    // they are ours to dispose — everything else in the proxy is _shared.
    if (s.shadowMat && s.shadowMat.dispose) { try { s.shadowMat.dispose(); } catch (e) {} }
    if (s.bodyMat && s.bodyMat.dispose) { try { s.bodyMat.dispose(); } catch (e) {} }
    if (s.sprayMat && s.sprayMat.dispose) { try { s.sprayMat.dispose(); } catch (e) {} }
    s.root = null; s.fin = null; s.wake = null; s.bow = null; s.finK = 0;
    s.tail = null; s.spray = null; s.sprayMat = null; s.tailExposed = 0;
    s.shadow = null; s.shadowMat = null; s.bodySil = null; s.bodyMat = null; s.shK = 0;
  }

  // ============================================================
  //  PER-ACTOR STATE — built once, never per frame. Everything predatorHunt
  //  needs is in one frozen opts object whose closures capture this actor.
  // ============================================================
  function ensure(a) {
    if (a._shark) return a._shark;
    const sp = a.species || {};
    const meg = sp.id === "megalodon" || (sp.scale || 1) >= 2.2;
    const s = a._shark = {
      meg: meg,
      baseClear: a.waterClearance || 12,
      dive: a.swimDepth || 2.5, diveWant: (a.swimDepth || 2.5) * diveMul("cruise"),
      state: "cruise", owned: false, stuck: 0, bail: 0,
      finK: 0, shK: 0, spd: 0, px: null, pz: null, wedged: 0,
      yaw: 0, ph: null, bank: 0, tailExposed: 0,
      root: null, fin: null, wake: null, bow: null, sz: 1, finExposed: 0,
      tail: null, spray: null, sprayMat: null,
      /* ---- THE BREACH (see §THE BREACH). `air` is the phase: 0 in the water,
         1 climbing under it, 2 out of it. Everything else is the arc. `shed`
         is the caller-owned scratch CBZ.marineBreachShed writes through, so a
         breach allocates nothing per frame. */
      air: 0, airY: 0, airVy: 0, airT: 0, airTotal: 0, airSpin: 1, airApex: 0,
      airVmax: 0, airA: 0, airOut: 0,
      pitchUp: 0, pitchDown: 0, rollPeak: 0, alignErr: 0,
      airPitch: 0, airRoll: 0, airWhy: "", breachCd: 2 + hash1(
        Math.round((a.group ? a.group.position.x * 3.1 + a.group.position.z * 7.7 : 0)) | 0) * 14,
      breachTry: 0, breaches: 0, bx: null, bz: null, hv: 0, exited: false,
      shed: {},
      plan: null, shadow: null, shadowMat: null, bodySil: null, bodyMat: null,
      // one deterministic phase per animal, so a pod does not sway in lockstep
      // and the same world always sways the same way (the determinism law).
      phase: hash1(Math.round((a.group ? a.group.position.x * 13.7 +
        a.group.position.z * 7.3 : 0)) | 0) * 6.283185307,
    };
    // moveInWater writes into a caller-owned scratch object; without one it
    // allocates a fresh result EVERY frame. wildlife.js gives aquatic actors
    // theirs at spawn — this is the belt-and-braces for anything hand-made.
    if (!a._waterMove) a._waterMove = { x: 0, z: 0, heading: 0, blocked: false, shore: -999 };
    /* THE BODY IS THE READ NOW. With SEA_TRANSLUCENT the sea shows the actual
       animal, so the actual animal has to know it is underwater: this swaps
       the group's materials for their veiled twins, which fade every fragment
       toward the water colour by the length of water between it and the eye.
       Cached and shared across the whole ocean (one clone per source
       material), idempotent, and a no-op with the flag off. */
    if (a.group && CBZ.waterVeilApply) { try { CBZ.waterVeilApply(a.group); } catch (e) {} }
    const label = String(sp.name || sp.id || "shark").toLowerCase();

    // ---- THE SEAMS. These are the four things predatorKit CANNOT derive, and
    // three of them are the reason this file exists at all.
    const SEAMS = {
      // THE ONE MOVER. predatorHunt drives it directly, and predator.js also
      // forwards it to creature_combat's approach branch (as its opts.move) so
      // the last few metres of a rush go through waterField + the CLEAR table
      // and depth() too — instead of a second, land-shaped mover writing raw
      // x/z/y and walking the shark onto the beach mid-strike.
      move: function (hunter, want, speed, dt) { return swim(hunter, want, speed, dt); },
      onState: function (ns, os) { onState(a, ns, os); },
      // if the driver strikes without a seize (refused, flag off), damage must
      // still go through the wildlife contact bus, never straight onto .hp
      onHit: function (d) {
        if (CBZ.cityAnimalStrikePlayer) { try { CBZ.cityAnimalStrikePlayer(a, d, "lunge"); } catch (e) {} }
      },
      // NOT COSMETIC, and the kit's own inWaterOnly() is NOT a substitute: it
      // tests predatorMedium(target.pos) alone, and a swimming player whose
      // pos.y reads a hair above the live swell would come back UNREACHABLE.
      // That is the single worst bug this feature could ship (see the header),
      // so the player special-case stays and stays here.
      canReach: function (t) { return inWater(t); },
      seize: {
        // The killfeed string. The kit leaves `cause` undefined and
        // seizeOptsFor then writes "mauled by a Great White Shark" in Title
        // Case; this keeps the lowercase line the feed has always shown.
        cause: "mauled by a " + label,
        // PARITY, deliberately. predatorKit assigns qteMax 1 to the "shake"
        // grab, but predatorSeize's own default — the one every shark in this
        // game has ever been fought with — is 2. Taking the kit's value would
        // silently HALVE the player's break-free windows against sharks, which
        // is a difficulty change dressed up as a refactor. If the two ever want
        // to agree, that is a decision to make on purpose, in the archetype.
        qteMax: 2,
      },
    };

    // ---- THE MIGRATION (CLAUDE.md: "the next debt owed").
    // This file used to hand-write twenty radii, speeds, holds and escape
    // probabilities, and it was the LAST consumer doing so — which is exactly
    // why ARCH.lunge and the shark were free to drift apart. ARCH.lunge was
    // SOLVED against these very numbers, so the kit reproduces all eleven
    // shared fields on the great white to under 1%, and on the megalodon to
    // under 3% on every field but bumpDmg (the archetype says 12, the old
    // hand-typed ladder said 10.8 — an 11% divergence the kit now owns, and
    // owning it in ONE place is the point of the migration).
    //
    // What went away with it: SENSE_R / CHUM_R / CIRCLE_R / ORBIT_R / CIRCLE_T
    // / BUMP_DMG / HOLD_S / ESCAPE_P and every `meg ? x * k : x` ladder. The
    // megalodon is no longer "the same knobs typed harder" — it is bigger, and
    // the power laws do the rest, so a THIRD shark costs nothing.
    s.opts = (CBZ.predatorKit ? CBZ.predatorKit(a, SEAMS) : null) || {
      // DEGRADE PATH ONLY (predator.js absent, or PREDATOR_KIT flagged off).
      // These are the archetype's own values for this species written out, so
      // the flag-off build behaves and cannot silently lose its radii.
      senseR: 110 * Math.sqrt(sp.scale || 1) / Math.sqrt(1.2),
      chumR: 220 * Math.sqrt(sp.scale || 1) / Math.sqrt(1.2),
      circleR: 26 * Math.sqrt(sp.scale || 1) / Math.sqrt(1.2),
      orbitR: 18 * Math.sqrt(sp.scale || 1) / Math.sqrt(1.2),
      circleT: 6.5 * Math.pow((sp.scale || 1) / 1.2, 0.7),
      cruiseSpeed: (sp.spd || 2.5) * 2.4,
      rushSpeed: (sp.spd || 2.5) * 8.7 * Math.pow(sp.scale || 1, -0.13),
      bumpDmg: (sp.bite || 30) * 0.2,
      style: "lunge", medium: "water",
      reach: 2.2 + (sp.scale || 1) * 1.6,
      rate: 1.37 * Math.sqrt(sp.scale || 1),
      dmg: sp.bite || 30,
      canReach: SEAMS.canReach, move: SEAMS.move, onState: SEAMS.onState, onHit: SEAMS.onHit,
      seize: {
        jaw: CBZ.creatureJawPoint ? CBZ.creatureJawPoint(a) : { x: 2, y: 0.7, z: 0 },
        dps: 10 + (sp.bite || 30) * 0.4,
        hold: 2.23 * Math.pow(sp.scale || 1, 0.9),
        escape: Math.max(0.05, Math.min(0.9, 0.41 * Math.pow(sp.scale || 1, -0.9))),
        thrash: 1, medium: "water", style: "shake",
        cause: SEAMS.seize.cause, qteMax: 2,
      },
    };
    return s;
  }

  function onState(a, ns) {
    const s = a._shark; if (!s) return;
    s.state = ns || "cruise";
    const d = a.swimDepth || 2.5;
    s.diveWant = d * diveMul(s.state);
    if (s.state === "vanish") s.diveWant = d * (s.meg ? 22 : 9);
    // the gape shuts whenever it is not committed
    if (CBZ.swimJaw && s.state !== "rush" && s.state !== "seize") {
      try { CBZ.swimJaw(a, 0); } catch (e) {}
    }
  }

  // ============================================================
  //  THE LOCOMOTION SEAM — predatorHunt says WHERE, this says HOW. Everything
  //  medium-specific about a shark lives in these forty lines.
  // ============================================================
  function swim(a, want, speed, dt) {
    const s = ensure(a), grp = a.group;
    if (!grp || !dt) return false;
    s.owned = true;
    /* A BODY THAT HAS LEFT THE WATER IS NOT SWIMMING. Two things below are
       wrong for it and both are wrong in a way that would look like a bug: the
       turn, because a thrown body does not steer (that is exactly why a real
       breaching shark can MISS), and moveInWater's clearance fence, which is a
       fence around water — a leap that cannot cross it stops dead in mid-air
       over a sandbar. So while §THE BREACH owns this animal it carries x/z
       ballistically along the heading it launched on, and y is not touched
       here at all. Both come straight back the frame it lands. */
    if (s.air) {
      /* ...and the charge is SPENT ON THE CLIMB, not carried through it. A
         great white's rush is ~22 m/s; carried into the air unchanged it makes
         a 26 m skip at a 25-degree flight path, which is a fish being thrown
         rather than a fish leaping. The animal is still swimming while it is
         climbing (phase 1, full speed — that is what closes the range), and
         then most of the forward speed becomes height at the surface. */
      const flight = Math.max(0, speed || 0) * (s.air === 2 ? BREACH_CARRY : 1) * dt;
      grp.position.x += Math.cos(a.heading) * flight;
      grp.position.z += Math.sin(a.heading) * flight;
      if (a._waterMove) { a._waterMove.x = grp.position.x; a._waterMove.z = grp.position.z; }
      if (CBZ.faceAnimalHeading) CBZ.faceAnimalHeading(grp, a.heading);
      return true;
    }
    // a shark turns with its whole body — no instant pivots, ever
    const turn = (s.meg ? TURN_RATE * 0.6 : TURN_RATE) * dt;
    let d = shortest((want == null ? a.heading : want) - a.heading);
    if (d > turn) d = turn; else if (d < -turn) d = -turn;
    a.heading += d;

    const t = clock();
    const clr = Math.max(2.5 + ((a.species && a.species.scale) || 1),
                         s.baseClear * (CLEAR[s.state] != null ? CLEAR[s.state] : 1));
    const wf = CBZ.waterField;
    let moved = true;
    if (wf && wf.moveInWater) {
      const nav = wf.moveInWater(grp.position.x, grp.position.z, a.heading,
                                 Math.max(0, speed || 0) * dt, clr, t, a._waterMove);
      if (nav) {
        a.heading = nav.heading;
        grp.position.x = nav.x; grp.position.z = nav.z;
        moved = !nav.blocked;
        // A HUNTING shark never takes wildlife.js's nearestWater recovery: that
        // is a hard position set, i.e. a visible teleport 10u from the player's
        // face. If it genuinely cannot move it abandons the hunt and swims out
        // under its own power instead.
        s.stuck = nav.blocked ? s.stuck + dt : 0;
        if (s.stuck > STUCK_BAIL) {
          s.stuck = 0; s.bail = 6;
          // Tell the shared driver to let go for six seconds. NOTE THE MISSING
          // ELSE: this used to fall back to `a._hunt = null`, which does not
          // disengage a hunt — it DELETES it, taking the menace gauge and the
          // commit count with it. That is the anti-habituation mechanism, and
          // wiping it here would hand the player a brand-new, un-escalated
          // shark every time one clipped a sandbar. If predator.js is not
          // loaded there is no hunt to end, so the correct fallback is nothing
          // at all; s.bail below already keeps this shark off the player.
          if (CBZ.predatorDisengage) { try { CBZ.predatorDisengage(a, 6); } catch (e) {} }
          onState(a, "disengage");
        }
      }
    } else {
      grp.position.x += Math.cos(a.heading) * speed * dt;
      grp.position.z += Math.sin(a.heading) * speed * dt;
    }
    depth(a, s, dt, t);
    if (CBZ.faceAnimalHeading) CBZ.faceAnimalHeading(grp, a.heading);
    return moved;
  }

  // Depth is its own beat: sounding, rising to cut the surface, coming up from
  // below on the rush. Two clamps, and THE ORDER IS THE WHOLE POINT: the
  // submersion clamp (keep the torso under the surface) runs FIRST, the seabed
  // clamp runs LAST, so the bed always wins.
  //
  // It used to be the other way round, which is only invisible in deep water:
  // in ~1.55m of shallows — exactly where the CLEAR table now lets a committed
  // shark hunt — the submersion clamp overrode the bed clamp and pushed a great
  // white ~0.7m INSIDE the sand. When the two cannot both be satisfied (water
  // shallower than the body) the bed wins and the dorsal breaks the surface,
  // which is both correct and the scarier read anyway.
  //
  // THE FLYING SHARK (owner, 2026-08-03: "you see their fin poking out of the
  // water correctly, but then you see the full shark and another fin above the
  // fin, floating"). That bed clamp asked CBZ.floorAt, and CBZ.floorAt IS NOT A
  // SEABED: city/world.js clamps every ground provider through Math.max(0,real),
  // so over the whole ocean it answers exactly 0 — roughly half a metre ABOVE
  // mean sea level. So `lo` was `0 + scale*0.9` EVERYWHERE, and the "never in
  // the bed" clamp fired in 1.9 km of open water, lifting a 1.2-scale great
  // white to y=+1.08 with the live surface at -0.41. Measured, not guessed:
  // 1.5 m of daylight under the body, while proxy() went on drawing its dorsal
  // correctly at surf+0.04 — the second fin, below the flying shark, in the
  // owner's screenshot. The bed now comes from the one place that knows it
  // (city/waterfield.js's bathymetry, via wildlife.js's shared marine law), and
  // that law also caps how far a bed may ever lift a body: a stranded shark
  // shows its back, it does not take off.
  function depth(a, s, dt, t) {
    /* A BODY IN THE AIR IS NOT AT A DEPTH. §THE BREACH owns group.position.y
       for the whole arc. Deferring rather than "lifting the clamp" is the
       honest shape here: the submersion clamp below is precisely the thing
       that made a leap impossible (the first clamp is what kept every shark in
       this game under the waterline forever), and the seabed clamp has nothing
       underneath a body that is over the water. Both come back on landing. */
    if (s.air) return;
    const grp = a.group;
    const surf = surfaceAt(grp.position.x, grp.position.z, t);
    s.dive += (s.diveWant - s.dive) * Math.min(1, dt * (s.meg ? 0.85 : 1.3));
    let y = surf - s.dive;
    const draft = a.swimDepth || 2;
    const sub = draft * 0.92;
    if (y > surf - sub) y = surf - sub;               // 1. keep the torso under
    if (CBZ.cityAquaticBedRestY) {                    // 2. ...but never in the bed
      const lift = CBZ.cityAquaticBedLift
        ? CBZ.cityAquaticBedLift(a.species)
        : ((a.species && a.species.scale) || 1) * 0.9;
      const lo = CBZ.cityAquaticBedRestY(grp.position.x, grp.position.z, draft, lift, t, surf);
      if (y < lo) y = lo;
    }
    grp.position.y += (y - grp.position.y) * Math.min(1, dt * 3.5);
  }

  // ============================================================
  //  §THE BREACH — the one thing in this file that leaves the water.
  //
  //  Until this section existed a shark in this game COULD NOT get out of the
  //  sea, and not by accident: depth() above has two clamps and the first of
  //  them ("keep the torso under") is unconditional, so the ceiling on every
  //  wild shark's y was 0.92 of its own draft under the waterline, forever. A
  //  great white taking a seal at the surface is the single most photographed
  //  thing this animal does and the engine had no way to express it.
  //
  //  THE SHAPE IS THE ORCA'S, THE PHYSICS IS THE PLAYER'S. city/wildlife_orca.js
  //  solved the hard half years of frames ago and its comment says why: the act
  //  must never write group.position.y directly, or depth() reads the raised y
  //  back on the next frame and the animal sinks through its own act. Its
  //  answer is a flag that suspends the clamp for the duration. This takes the
  //  same idea one step further — while `s.air` is set, depth() DEFERS
  //  ENTIRELY and this section is the only owner of y — because a shark's leap
  //  is not a scripted sine like an orca's breach act, it is a real ballistic
  //  arc, and a target-and-ease depth track flattens a ballistic arc into a
  //  bump. The orca is not touched: it keeps its acts, its sine and its clamp
  //  suspension exactly as they are.
  //
  //  The numbers are not a second opinion either: the apex, the launch speed
  //  and the gravity all come from city/wildlife_tame.js's published solve
  //  (CBZ.marineBreachVel / marineBreachG), which is the same one the RIDDEN
  //  shark leaps with. A wild great white and the player's great white jump
  //  identically, because they are the same jump.
  //
  //  IT HAPPENS FOR TWO REASONS, and nothing else:
  //    1. THE STRIKE. A committed rush on prey that is at the top of the water
  //       carries through and out. It is triggered at the range where the climb
  //       and the charge actually MEET (solved, not typed), which is why it
  //       comes out under the seal rather than beside it — and why, like the
  //       real thing, it can miss: a body in the air does not steer.
  //    2. THE SPECTACLE. Rarely, in deep water, for nothing. This is the one
  //       the owner sees from four hundred metres away and turns the boat for.
  //  No flag. A shark that can leave the water is not a feature you switch on.
  // ============================================================
  const BREACH_COOL = 11;        // s an animal waits between its own leaps
  /* HOW RARE IS RARE. One roll every ~26 s per animal and a quarter of them
     take, so a given shark leaps for nothing about once every two minutes it
     spends cruising deep water within sight — and only while it is CRUISING,
     which means never while it is working on you. With three or four sharks in
     the water that is a sea that throws one every half minute or so: often
     enough to be a thing that happens, rare enough that you look up. */
  const IDLE_EVERY = 26;         // s between idle rolls, per animal
  const IDLE_P = 0.26;           // ...and how many of those rolls take
  // How much of the charge survives the waterline as forward speed. The rest
  // became height. Spent by swim()'s airborne branch above and seeded into the
  // measured horizontal speed at the moment of the exit, so the pose and the
  // trajectory can never disagree about it.
  const BREACH_CARRY = 0.45;
  const BREACH_PASS_R = 460;     // u — beyond this the pass costs one hypot
  const TRAIL_R = 230;           // u — beyond this the shed trail is not drawn
  const BREACH_G_DEF = 17.5;     // only if wildlife_tame.js is not in this build
  const BREACH_ROLL_DEF = 0.42;
  const BAUDIT = {
    breaches: 0, strikes: 0, idles: 0, landings: 0, aborted: 0, drops: 0,
    lastWhy: "", lastApex: 0, lastAirT: 0, lastKg: 0, lastSpd: 0,
    lastPitchUp: 0, lastPitchDown: 0, lastRoll: 0, lastAlignErr: 0, lastLen: 0,
  };

  function breachG() {
    if (typeof CBZ.marineBreachG === "function") {
      try { const g = +CBZ.marineBreachG(); if (g > 0) return g; } catch (e) {}
    }
    return BREACH_G_DEF;
  }
  function rollAmt() {
    if (typeof CBZ.marineBreachRoll === "function") {
      try { const r = +CBZ.marineBreachRoll(); if (r > 0) return r; } catch (e) {}
    }
    return BREACH_ROLL_DEF;
  }
  function liveSz(a) {
    if (typeof CBZ.wildlifeScale === "function" && a.species) {
      try { const v = +CBZ.wildlifeScale(a); if (v > 0 && isFinite(v)) return v; } catch (e) {}
    }
    const g = a.group;
    if (g && g.scale && g.scale.x > 0) return g.scale.x;
    return (a.species && a.species.scale) || 1;
  }
  function breachVel(scale) {
    if (typeof CBZ.marineBreachVel === "function") {
      try { const v = +CBZ.marineBreachVel(scale); if (v > 0 && isFinite(v)) return v; } catch (e) {}
    }
    return Math.sqrt(2 * BREACH_G_DEF * (0.9 + scale * 1.9));
  }
  function bodyLenOf(a) {
    if (typeof CBZ.marineBodyLenLive === "function") {
      try { const L = +CBZ.marineBodyLenLive(a); if (L > 0 && isFinite(L)) return L; } catch (e) {}
    }
    return 4 * liveSz(a);
  }
  // What is this animal hunting right now? systems/predator.js parks the live
  // quarry on the hunt scratch it already keeps per actor, and BOTH drivers
  // that can own a shark (this file's player hunt and marine_predation.js's
  // prey hunt) go through it — so this answers for either without either
  // needing to know about the breach.
  function quarryOf(a) {
    const h = a._hunt;
    const q = h && h._fightTarget;
    if (!q || q.dead) return null;
    if (CBZ.player && q === CBZ.player) return CBZ.player.pos || null;
    return q.pos || (q.group && q.group.position) || null;
  }
  // Enough sea to come up out of AND to come back down into. A leap in three
  // feet of water is a stranding, not a breach.
  function deepEnough(a, draft) {
    const g = a.group;
    if (typeof CBZ.cityWaterDepthAt !== "function") return true;
    let col = 0;
    try { col = +CBZ.cityWaterDepthAt(g.position.x, g.position.z) || 0; } catch (e) { col = 0; }
    return col > draft * 1.7 + 1.2;
  }

  /* WHEN A CHARGE BECOMES A LEAP. Every one of these is a condition of the
     photograph: the animal is committed, the prey is at the top of the water,
     the animal is UNDER it, it is pointed at it, and it is at the range where
     the climb and the charge arrive together. That last one is solved rather
     than typed — the climb takes as long as the body's own depth divided by
     its launch speed, and in that time the charge covers whatever it is
     actually doing — which is why one number cannot serve a bull shark and a
     megalodon and why this comes out UNDER the seal instead of beside it. */
  function strikeWants(a, s, surf, draft) {
    if (s.state !== "rush") return false;
    const qp = quarryOf(a);
    if (!qp) return false;
    const g = a.group;
    const dx = qp.x - g.position.x, dz = qp.z - g.position.z;
    const gap = Math.hypot(dx, dz);
    const len = bodyLenOf(a);
    const down = surf - g.position.y;
    if (down < draft * 0.75) return false;               // it is not below anything
    // the prey has to be at the top of the water
    if (qp.y != null) {
      const qs = surfaceAt(qp.x, qp.z, clock());
      if (qs - qp.y > draft * 0.55 + 1.4) return false;
    }
    if (Math.abs(shortest(Math.atan2(dz, dx) - a.heading)) > 0.7) return false;
    const climb = down / Math.max(3, breachVel(liveSz(a)) * 0.7);
    const want = Math.max(len * 0.6, s.hv * climb);
    if (gap > want * 1.55 || gap < want * 0.45) return false;
    return deepEnough(a, draft);
  }

  function beginBreach(a, s, why, surf) {
    const g = a.group;
    const sz = liveSz(a);
    const V = breachVel(sz);
    // HOW IT GETS TO THE SURFACE. Not a teleport and not a constant: the climb
    // is solved so the body arrives at the waterline doing exactly the launch
    // speed, from wherever it happened to be — so what you see from a boat is
    // a dark shape ACCELERATING up out of the blue, which is the half of the
    // strike that happens before anything leaves the water.
    const d0 = Math.max(0.6, Math.min(9, surf - g.position.y));
    const v0 = V * 0.35;
    s.air = 1;
    s.airVy = v0; s.airVmax = V;
    s.airA = (V * V - v0 * v0) / (2 * d0);
    s.airY = g.position.y - surf;
    s.airT = 0; s.airApex = 0; s.exited = false; s.airOut = 0;
    s.airTotal = (2 * V) / breachG();
    // which way it comes over at the top — deterministic, so the same body in
    // the same place always rolls the same way, and arbitrary enough that a
    // sequence of breaches does not read as a machine
    s.airSpin = ((Math.floor(Math.abs(g.position.x) * 7 + Math.abs(g.position.z) * 13) & 1) ? 1 : -1);
    s.airWhy = why;
    s.pitchUp = 0; s.pitchDown = 0; s.rollPeak = 0; s.alignErr = 0;
    s.breachCd = BREACH_COOL;
    s.breaches++;
    s.shed.acc = 0;
    BAUDIT.breaches++;
    if (why === "strike") BAUDIT.strikes++; else BAUDIT.idles++;
    return true;
  }

  // A breach that is interrupted (the animal died, was seized, was rolled by a
  // pod, or simply left the pass radius mid-air) must put the body back in the
  // water rather than leave it hanging over it.
  function endBreach(a, s) {
    if (!s.air) return;
    s.air = 0; s.airOut = 0; s.airPitch = 0; s.airRoll = 0; s.airY = 0; s.airVy = 0;
    const g = a.group;
    if (g) {
      const draft = a.swimDepth || 2;
      const surf = surfaceAt(g.position.x, g.position.z, clock());
      g.position.y = surf - draft * 1.1;
      s.dive = draft * 1.1;
    }
    BAUDIT.aborted++;
  }

  function landBreach(a, s, surf, draft, dist) {
    const g = a.group;
    const fall = Math.abs(s.airVy);
    s.air = 0; s.airOut = 0.3;
    BAUDIT.landings++;
    BAUDIT.lastWhy = s.airWhy;
    BAUDIT.lastApex = +(s.airApex || 0).toFixed(2);
    BAUDIT.lastAirT = +(s.airT || 0).toFixed(2);
    BAUDIT.lastSpd = +fall.toFixed(2);
    BAUDIT.lastPitchUp = +(s.pitchUp || 0).toFixed(3);
    BAUDIT.lastPitchDown = +(s.pitchDown || 0).toFixed(3);
    BAUDIT.lastRoll = +(s.rollPeak || 0).toFixed(3);
    BAUDIT.lastAlignErr = +(s.alignErr || 0).toFixed(4);
    BAUDIT.lastLen = +bodyLenOf(a).toFixed(2);
    /* WHAT THE SEA WAS TOLD — read, not fired. The entry splash belongs to
       the frame the NOSE went through, which wlTick() below has already owned
       (for a long body that is several frames and several metres before this
       origin test trips). All this needs is the size of it, for the shake. */
    const wl = a._wl;
    const nowS = (CBZ.now != null ? CBZ.now : 0) / 1000;
    const kg = (wl && nowS - wl.lastEntryT < 0.6) ? wl.lastEntryKg : 0;
    BAUDIT.lastKg = Math.round(kg);
    // IT PUNCHES UNDER. Landing exactly on the waterline and stopping is the
    // thing that makes a leap look weightless; the plunge target is carried and
    // depth()'s own ease brings it back up, so the recovery is the depth
    // system's, not a second animation.
    s.dive = draft * (0.9 + Math.min(1.6, fall * 0.055));
    g.position.y = surf - Math.max(0.22, draft * 0.22);
    s.airY = 0; s.airVy = 0;
    if (s.airWhy === "strike" && CBZ.swimJaw && s.state !== "seize") {
      try { CBZ.swimJaw(a, 0); } catch (e) {}
    }
    // A LANDING YOU CAN FEEL, if you are near enough to feel it. Falls off with
    // the square of the distance, which is what stops a shark breaching on the
    // horizon from shaking the player's camera.
    if (typeof CBZ.shake === "function" && dist < 110) {
      const near = Math.max(0, 1 - dist / 110);
      const amt = (0.22 + Math.min(0.85, kg * 0.00006) + fall * 0.012) * near * near;
      if (amt > 0.02) { try { CBZ.shake(Math.min(1.6, amt)); } catch (e) {} }
    }
  }

  function breachTick(a, s, dt, dist) {
    const g = a.group;
    const t = clock();
    const surf = surfaceAt(g.position.x, g.position.z, t);
    const draft = a.swimDepth || 2;

    /* HOW FAST IS IT ACTUALLY GOING SIDEWAYS. Read off the transform, never
       asked of a driver — the same trick proxy() uses — so the arc's pitch is
       right whether predatorHunt, marine_predation or wildlife.js's own wander
       is steering the body this frame. */
    const dx = s.bx == null ? 0 : g.position.x - s.bx;
    const dz = s.bz == null ? 0 : g.position.z - s.bz;
    s.bx = g.position.x; s.bz = g.position.z;
    const inst = dt > 0 ? Math.sqrt(dx * dx + dz * dz) / dt : 0;
    s.hv += (Math.min(40, inst) - s.hv) * Math.min(1, dt * 6);

    if (s.breachCd > 0) s.breachCd -= dt;

    if (!s.air) {
      if (s.airOut > 0) {
        // ease the arc's pose out rather than snapping the body flat the frame
        // it touches the water — the entry splash is exactly where a snap shows
        s.airOut -= dt;
        const e = Math.min(1, dt * 7);
        s.airPitch += (0 - s.airPitch) * e;
        s.airRoll += (0 - s.airRoll) * e;
        g.rotation.z = s.airPitch;
        g.rotation.x += s.airRoll;
        a._poseOwn = true;              // see the baton note in wildlife_rig.js
      }
      if (a._seizedBy || a._mpRoll || a.hp <= 0 || s.bail > 0) return;
      if (s.breachCd > 0) return;
      if (strikeWants(a, s, surf, draft)) { beginBreach(a, s, "strike", surf); return; }
      s.breachTry -= dt;
      if (s.breachTry > 0) return;
      s.breachTry = IDLE_EVERY * (0.6 + hash1((Math.round(t * 11) ^ 0x51ee) | 0) * 0.9);
      // ONLY WHILE IT IS CRUISING. A shark that has your scent is doing
      // something; a shark that jumps for fun in the middle of stalking you is
      // a shark that has stopped being frightening.
      if (s.state !== "cruise") return;
      if (hash1((Math.round(g.position.x * 3.1 + g.position.z * 7.7) ^ Math.round(t * 31)) | 0) > IDLE_P) return;
      if (!deepEnough(a, draft)) return;
      beginBreach(a, s, "idle", surf);
      return;
    }

    // ---- the arc ------------------------------------------------------------
    s.airT += dt;
    if (s.air === 1) {
      s.airVy = Math.min(s.airVmax, s.airVy + s.airA * dt);
      s.airY += s.airVy * dt;
      /* THE EXIT IS NOT FIRED FROM AN ORIGIN TEST ANY MORE. This used to be
         a guess at when the head was through — "a beat before the origin
         crosses" — and a guess is exactly what it was: one threshold on
         `airY`, which is the ORIGIN's height, for every body from a 4 m
         hammerhead to a 22 m megalodon. wlTick() below watches the real nose
         against the real surface every frame and fires the crossing when it
         actually happens, at the point where it happens. */
      if (!s.exited && s.airY >= -draft * 0.35) s.exited = true;
      if (s.airY >= 0) {
        s.air = 2; s.airVy = s.airVmax; s.airT = 0;
        // the charge becomes height at the waterline (see swim()'s BREACH_CARRY):
        // seeded here so the very first airborne frame already poses on the real
        // flight path instead of easing into it over the next third of a second
        s.hv *= BREACH_CARRY;
      }
    } else {
      s.airVy -= breachG() * dt;
      s.airY += s.airVy * dt;
    }
    if (s.airY > s.airApex) s.airApex = s.airY;

    // ---- the body speaks ----------------------------------------------------
    // The nose points exactly where the animal is going: nose-up on the climb,
    // level across the top, nose-down into the water. Never animated — derived,
    // which is what `alignErr` below exists to keep honest.
    s.airPitch = Math.max(-1.25, Math.min(1.32, Math.atan2(s.airVy, Math.max(0.8, s.hv))));
    const u = s.air === 2 ? Math.max(0, Math.min(1, s.airT / Math.max(0.25, s.airTotal))) : 0;
    s.airRoll = s.airSpin * rollAmt() * Math.sin(u * 2.67);
    if (s.airPitch > (s.pitchUp || 0)) s.pitchUp = s.airPitch;
    if (s.airPitch < (s.pitchDown || 0)) s.pitchDown = s.airPitch;
    if (Math.abs(s.airRoll) > (s.rollPeak || 0)) s.rollPeak = Math.abs(s.airRoll);
    const err = Math.abs(s.airPitch - Math.atan2(s.airVy, Math.max(0.001, s.hv)));
    if (err > (s.alignErr || 0)) s.alignErr = err;

    g.position.y = surf + s.airY;
    // A BREACH IS THE ONE THING YOU HAVE TO BE ALLOWED TO SEE. The body's LOD
    // hides it outside ~62% of the sense radius and the surface proxy draws a
    // dorsal in its place; a fin cutting the water while the animal it belongs
    // to is four metres above it is the double-fin bug with extra steps. One
    // line settles both: the body draws, and proxy()'s own "only while the real
    // one is not drawn" test folds the stand-in away by itself.
    g.visible = true;
    /* ABSOLUTE on pitch, ADDITIVE on roll (the orca's applyPose law) — plus
       the ownership baton, because "animateSwim assigns this outright" was only
       half the story: it also runs AFTER this pass on a built world, so the
       arc's pitch was being clipped to that function's own +/-0.5 rad every
       frame. wildlife_rig.js carries the measurement. */
    g.rotation.z = s.airPitch;
    g.rotation.x += s.airRoll;
    a._poseOwn = true;

    // ---- and it sheds water all the way down --------------------------------
    if (s.airY > -draft * 0.2 && dist < TRAIL_R && typeof CBZ.marineBreachShed === "function") {
      const o = s.shed;
      o.x = g.position.x; o.y = g.position.y; o.z = g.position.z;
      o.heading = a.heading; o.pitch = s.airPitch;
      o.len = bodyLenOf(a);
      o.vx = Math.cos(a.heading) * s.hv; o.vz = Math.sin(a.heading) * s.hv;
      o.vy = s.airVy; o.dt = dt; o.airT = s.airT; o.airTotal = s.airTotal;
      try { BAUDIT.drops += CBZ.marineBreachShed(o) || 0; } catch (e) {}
    }
    // MOUTH OPEN. A strike that comes out of the water with its jaws shut is a
    // fish jumping; the gape is the whole photograph. Written every frame of
    // the arc so nothing else's zero can stick to it mid-flight.
    if (s.airWhy === "strike" && CBZ.swimJaw) {
      try { CBZ.swimJaw(a, 0.9); } catch (e) {}
    }

    if (s.air === 2 && s.airVy < 0 && s.airY <= -draft * 0.18) {
      landBreach(a, s, surf, draft, dist);
    }
  }

  /* THE PASS. onUpdate(47.22): AFTER wildlife.js's tick (47.1) — which is where
     animateSwim writes rotation.x and rotation.z — and after
     marine_predation.js's own 47.15, so the arc's pose survives both. It is its
     own pass rather than a call inside sharkBrain for the same reason the orca's
     is: sharkBrain does not run at all on the frames marine_predation owns the
     animal, and a body that is halfway through a ballistic arc must be
     integrated on EVERY frame or it hangs in the air.

     DISTANCE-GATED HARD: a shark half a kilometre away costs one species
     compare and one Math.hypot. */
  /* THE WATERLINE TRACKER, wired to a wild body. city/wildlife_tame.js owns
     the crossing model (it is the same physics for a ridden animal and a wild
     one, and two copies would drift within a week); this is the adapter that
     hands it THIS file's pose. The scratch is module-level, so a hundred
     sharks allocate nothing. */
  const _wlScratch = {};
  function wlTick(a, s, dt) {
    if (typeof CBZ.marineWaterline !== "function") return;
    const g = a.group;
    if (!g) return;
    const hv = (s && s.hv) || 0;
    _wlScratch.x = g.position.x; _wlScratch.y = g.position.y; _wlScratch.z = g.position.z;
    _wlScratch.heading = a.heading || 0;
    // the DRAWN pitch, off the transform — never the pitch some driver
    // intended, for the same reason breachTick reads its own speed off the
    // transform: three different files are allowed to steer this animal.
    _wlScratch.pitch = g.rotation.z || 0;
    _wlScratch.len = bodyLenOf(a);
    _wlScratch.vx = Math.cos(a.heading || 0) * hv;
    _wlScratch.vz = Math.sin(a.heading || 0) * hv;
    _wlScratch.vy = (s && s.air) ? s.airVy : 0;
    _wlScratch.dt = dt;
    try { CBZ.marineWaterline(a, _wlScratch); } catch (e) {}
  }

  function breachPass(dt) {
    if (!(dt > 0) || !ON()) return;
    const list = CBZ.cityWildlife;
    if (!list || !list.length) return;
    const P = (CBZ.player && CBZ.player.pos) || null;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (!a || !a.group || a.tamed || a.ridden || a._despawned) continue;
      const sp = a.species;
      if (!sp || !sp.aquatic || (sp.danger || 0) < 0.5) continue;
      // The orca has its own surface acts (city/wildlife_orca.js §5) and its own
      // pose pass. It also carries a _shark state, because that file's wrapper
      // builds one — so this exclusion is load-bearing, not tidiness.
      if (sp.id === "orca") continue;
      const s = a._shark;
      if (!s) continue;                     // state is ensure()'s to build, never this pass's
      if (a.dead) { if (s.air) endBreach(a, s); continue; }
      const d = P ? Math.hypot(a.group.position.x - P.x, a.group.position.z - P.z) : 1e9;
      if (d > BREACH_PASS_R) {
        if (s.air) endBreach(a, s);
        continue;
      }
      breachTick(a, s, dt, d);
      /* AND THE SEA ANSWERS THE BODY. Every frame, for every shark close
         enough for its water to be drawn — not only the ones mid-arc, because
         the tracker's first sight of an animal only LATCHES the signs (it must
         never splash for a body that was already where it is) and a tracker
         switched on at the launch would therefore miss that launch. Same
         reason it runs after breachTick: the pose it reads has to be the one
         that will be drawn. */
      if (d < TRAIL_R) wlTick(a, s, dt);
    }
  }
  if (CBZ.onUpdate) CBZ.onUpdate(47.22, breachPass);

  /* THE ARC, AS NUMBERS — tools/visual-presets/shark-breach.mjs reads this
     instead of reaching into the state, so the report and the behaviour cannot
     drift apart. `alignErr` is the one that has to stay at zero: it is how far
     the body's attitude ever sat from its own velocity vector, and a non-zero
     value means somebody started animating the pose instead of deriving it. */
  CBZ.sharkBreachAudit = function () {
    let air = 0, ready = 0;
    const list = CBZ.cityWildlife || [];
    for (let i = 0; i < list.length; i++) {
      const a = list[i], s = a && a._shark;
      if (!s || !a.species || a.species.id === "orca") continue;
      if (s.air) air++;
      if (!s.air && s.breachCd <= 0) ready++;
    }
    return {
      airborne: air, ready: ready,
      breaches: BAUDIT.breaches, strikes: BAUDIT.strikes, idles: BAUDIT.idles,
      landings: BAUDIT.landings, aborted: BAUDIT.aborted, trailDrops: BAUDIT.drops,
      lastWhy: BAUDIT.lastWhy, lastApex: BAUDIT.lastApex, lastAirT: BAUDIT.lastAirT,
      lastEntryKg: BAUDIT.lastKg, lastEntrySpd: BAUDIT.lastSpd, lastLenM: BAUDIT.lastLen,
      lastPitchUp: BAUDIT.lastPitchUp, lastPitchDown: BAUDIT.lastPitchDown,
      lastRoll: BAUDIT.lastRoll, lastAlignErr: BAUDIT.lastAlignErr,
    };
  };
  /* THE TOOLING SEAM. A preset cannot stand on a beach for four minutes waiting
     for a 30%-per-24-seconds roll to come up, and faking the leap by writing
     `s.air` from outside would photograph a preset's animation rather than this
     file's. So the STARTER is public and everything downstream — the climb, the
     arc, the pose, the two splashes, the shed trail, the landing — is exactly
     what an idle roll or a strike would have run. Returns false if this animal
     genuinely cannot leap from where it is standing, which is itself the
     answer on a build where the behaviour does not exist. */
  CBZ.sharkBreachNow = function (a, why) {
    if (!ON() || !a || !a.group || a.dead || a.tamed || a.ridden) return false;
    const sp = a.species;
    if (!sp || !sp.aquatic || (sp.danger || 0) < 0.5 || sp.id === "orca") return false;
    const s = ensure(a);
    if (s.air) return false;
    const surf = surfaceAt(a.group.position.x, a.group.position.z, clock());
    if (!deepEnough(a, a.swimDepth || 2)) return false;
    return beginBreach(a, s, why === "strike" ? "strike" : "idle", surf);
  };

  // ============================================================
  //  THE ONE ENTRY POINT — ticked by wildlife.js's aquatic branch.
  //  Returns true when the hunt owned this actor's transform.
  // ============================================================
  function sharkBrain(a, dt, P) {
    if (!ON() || !a || a.dead || a.tamed || a.ridden) return false;
    const sp = a.species;
    if (!sp || !sp.aquatic || (sp.danger || 0) < 0.5) return false;
    const s = ensure(a);
    s.owned = false;
    const grp = a.group;
    const dist = P ? Math.hypot(grp.position.x - P.x, grp.position.z - P.z) : 1e9;

    // a bail (stuck in the shallows) or a kill puts it off the player for a
    // while — escalation needs a gap, and a shark camping you is not scary.
    if (s.bail > 0) {
      s.bail -= dt;
      if (a.state === "stalk" || a.state === "charge") a.state = "wander";
      // It swims ITSELF back out to deep water: moveInWater's shore feelers
      // steer inward once the full clearance is back in force. Handing it to
      // wildlife.js here would run its nearestWater recovery — a hard position
      // set, i.e. a teleport the player would watch happen. Only if it is still
      // wedged after a few seconds do we let that recovery have it.
      const ok = swim(a, a.heading, s.opts.cruiseSpeed * 0.9, dt);
      s.wedged = ok ? 0 : (s.wedged || 0) + dt;
      proxy(a, s, dist, dt);
      if (s.wedged > 3.5) { s.wedged = 0; s.owned = false; return false; }
      return true;
    }

    const hunt = CBZ.predatorHunt;
    const player = CBZ.player;
    if (typeof hunt !== "function" || !P || !player || player.dead) {
      // DEGRADE: no shared driver (or nothing to hunt) — wildlife.js's ordinary
      // wander drives the body, and the fin still cuts the surface near shore.
      s.state = "cruise";
      proxy(a, s, dist, dt);
      return false;
    }

    let st = null;
    try { st = hunt(a, player, dt, s.opts); } catch (e) { st = null; }
    if (!st || st === "cruise") {
      if (s.state !== "cruise") onState(a, "cruise");
      proxy(a, s, dist, dt);
      return false;                                   // the caller wanders as usual
    }
    if (st !== s.state) onState(a, st);

    // MARKERS FOR FREE (belt and braces): the driver is supposed to set
    // a.state itself; if it ever stops doing so, the blip must not silently
    // die — markers.js is the only threat UI and nothing here may duplicate it.
    if (st === "rush" || st === "seize") { if (a.state !== "charge") a.state = "charge"; }
    else if (st === "scent" || st === "circle" || st === "bump") { if (a.state !== "stalk") a.state = "stalk"; }

    // MARKERS FOR FREE: systems/markers.js's cityTargetsPlayer() already lights
    // the HUD, minimap and map from a.state === "stalk"/"charge", which
    // predatorHunt sets. The ONE thing it must not do is keep the blip lit
    // while the shark has vanished — losing the marker IS the scare.
    if (st === "vanish" || st === "disengage") a.state = "wander";

    // SHOWING LESS: the body is crisp only inside ~18% of the sense radius, and
    // during the commit. Everywhere else you get the fin and your imagination.
    const showR = (s.opts.senseR || SENSE_R) * SHOW_F;
    grp.visible = (dist < showR) || st === "rush" || st === "seize";

    proxy(a, s, dist, dt);
    // Engaged means OWNED, even in the frames the driver chooses not to move
    // (the seize holds position; a sounding shark coasts). Handing a committed
    // shark back to the wander for one frame is a visible tug-of-war.
    return true;
  }

  // THE RATCHET. This file has been fully on predatorHunt/predatorSeize since
  // the day it shipped and never said so, which meant the audit undercounted
  // its own single working consumer. An audit that hides its wins is as useless
  // as one that hides its debt. The `else` branch is what actually runs today —
  // wildlife_shark.js loads AFTER predator.js, but the buffer makes the count
  // independent of index.html's ordering either way, so this cannot rot.
  if (typeof CBZ.predatorAdopt === 'function') {
    try { CBZ.predatorAdopt('wildlife_shark:hunt'); } catch (e) {}
  } else {
    try { (CBZ._predatorAdopted = CBZ._predatorAdopted || []).push('wildlife_shark:hunt'); } catch (e) {}
  }
  // ..and the OTHER half of the debt, which the id above never covered: this
  // file ticked the shared FSM while still hand-writing the opts bundle the
  // shared table was solved from. `sharkKitAdopted` is what
  // CBZ.wildlifeDefenseAudit reads; it is a live answer rather than a constant
  // so flipping SHARK_KIT off reports the truth instead of a claim.
  // (KIT() did not exist — reading CBZ.sharkKitAdopted threw a ReferenceError
  // straight through wildlifeDefenseAudit(), which is exactly the kind of
  // "live answer" that is worse than a constant. It is a live answer now.)
  function KIT() {
    return typeof CBZ.predatorKit === "function" &&
      !(CBZ.CONFIG && CBZ.CONFIG.PREDATOR_KIT === false);
  }
  Object.defineProperty(CBZ, "sharkKitAdopted", {
    configurable: true,
    get: function () { return KIT(); },
  });

  CBZ.sharkBrain = sharkBrain;
  CBZ.sharkFinDrop = dropProxy;
  // read-only, for tuning probes: what is this shark doing and how deep is it?
  CBZ.sharkState = function (a) {
    const s = a && a._shark;
    return s ? { state: s.state, dive: s.dive, fin: s.finK, spd: s.spd, meg: s.meg } : null;
  };
  /* THE SURFACE READ, for measurement — tools/visual-presets/shark-from-deck.mjs
     asks this instead of reaching into the proxy's internals, so the numbers in
     that report cannot drift away from the thing they describe. Everything is
     metres above the LIVE surface at the animal's own position.

       dorsals   how many separate dorsal fins are cutting the surface. ONE is
                 correct. TWO is the historical bug and the reason this exists.
       finM      how much blade is out of the water (proxy or authored).
       authoredM what the AUTHORED model's dorsal has out of the water at this
                 exact pose — the number the proxy has to agree with, so the
                 handover at the LOD boundary is invisible.
       concavity the trailing edge's deepest excursion from the apex->tip
                 chord, as a fraction of that chord. A cone scores 0. */
  CBZ.sharkSurfaceRead = function (a) {
    const s = a && a._shark, grp = a && a.group;
    if (!s || !grp) return null;
    const t = clock();
    const surf = surfaceAt(grp.position.x, grp.position.z, t);
    let plan = s.plan;
    if (!plan) { try { plan = speciesPlan(a.species || {}, grp); } catch (e) { plan = null; } }
    const sz = (grp.scale && grp.scale.x) || 1;
    const authored = plan ? (grp.position.y + (plan.backY + plan.finH) * sz) - surf : 0;
    const bodyOn = grp.visible !== false;
    const proxyUp = !!(s.root && s.root.visible && s.fin && s.fin.visible && (s.finK || 0) > 0.05);
    const proxyM = proxyUp ? (s.finExposed || 0) : 0;
    const shadowUp = !!(s.shadow && s.shadow.visible);
    return {
      dorsals: (bodyOn && authored > 0.02 ? 1 : 0) + (proxyUp && proxyM > 0.02 ? 1 : 0),
      finM: Math.max(bodyOn && authored > 0 ? authored : 0, proxyM),
      proxyFinM: proxyM,
      authoredM: authored,
      bodyOnScreen: bodyOn,
      depthM: surf - grp.position.y,
      concavity: fin2() ? BLADE_CONCAVITY : 0,
      shadowUp: shadowUp,
      shadowAlpha: shadowUp && s.shadowMat ? s.shadowMat.opacity : 0,
      shadowAreaM2: shadowUp
        ? Number((Math.abs(s.shadow.scale.x * s.shadow.scale.y) *
            (fin2() && shadow2() ? SIL_FILL : Math.PI * 0.25)).toFixed(3)) : 0,
      shadowOffsetM: shadowUp ? Math.hypot(s.shadow.position.x - (plan ? plan.bodyCx * sz : 0),
                                           s.shadow.position.z) : 0,
      bodySilUp: !!(s.bodySil && s.bodySil.visible),
      // the tail tip is NOT a dorsal and is deliberately not counted as one —
      // two dorsals is the bug, dorsal + caudal is the real shallow-cruise read
      tailTipM: Number((s.tailExposed || 0).toFixed(3)),
      finBankRad: Number((s.bank || 0).toFixed(3)),
      sprayAlpha: s.spray && s.spray.visible && s.sprayMat
        ? Number(s.sprayMat.opacity.toFixed(3)) : 0,
      planLenM: plan ? plan.planLen * sz : 0,
      planBeamM: plan ? plan.planBeam * sz : 0,
      wakeLenM: s.wake && s.wake.visible ? s.wake.scale.x : 0,
      shapeFill: fin2() && shadow2() ? SIL_FILL : 0.785,
      meshes: s.root ? s.root.children.length : 0,
    };
  };
})();
