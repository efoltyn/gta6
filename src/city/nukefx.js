/* ============================================================
   city/nukefx.js — THE NUKE + BIG-BLAST SPECTACLE.

   This file DRAWS. It owns no damage, no ledger, no lethality: every one of
   those already exists and is already tuned (crashfx.js's pooled blast +
   applyBlastDamage, systems/impactbus.js's propagating wave, city/
   structural.js's collapse ledger). It plugs into the ordnance bus by NAME:

       CBZ.impact.fx("nuke", composer)      // src/systems/impactbus.js
       CBZ.detonate(x, y, z, "nuke")        // ...and the row starts working

   The bus owns all scale/damage numbers; this file consumes them and leaves
   crashfx's proven near-field composer intact.

   ------------------------------------------------------------------
   WHAT THE SEQUENCE IS (Glasstone/Dolan beat table, compressed for pacing —
   the timings are the spec's, the techniques are Fallout 4 / Frostbite's).
   Absolute seconds are for the stock nuke row; every one of them is reported
   by CBZ.nukeFxAudit() so the sequence is a set of NUMBERS, not a screenshot:

     0.00       WHITEOUT      full-screen white DOM div (#nukeFlash). The
                              cheapest, highest-impact beat in the game: one
                              composited layer, no fill cost in GL at all.
                              Never dropped, at any quality tier.
     0.00-1.47  WHITE DOME    (NUKE_FX_V2) the beat this file used to skip
                              entirely: a pure white, unlit, un-fogged,
                              OPAQUE hemisphere swelling off the deck, with
                              no detail inside it at all, silhouetting the
                              skyline. Radius is the Taylor-Sedov similarity
                              law R ∝ t^(2/5) — the same exponent G.I. Taylor
                              read Trinity's yield off the published film —
                              normalised so it reaches the 126 m maximum
                              fireball radius at 1.05 s, which is about how
                              long a near-surface fireball sits on the ground
                              before buoyancy lifts it. It then FADES AND
                              RISES over 0.42 s, revealing the graded
                              additive fireball that was behind it all along.
                              The double flash rides it too, and because it
                              is the only OPAQUE layer here, the minimum
                              genuinely gives the skyline back for a few
                              frames.
     0.00-0.55  FIRST MAXIMUM the isothermal ball. BLUE-WHITE, not orange, and
                              deliberately drawn OVERBRIGHT (colour > 1.0, see
                              flashRadiance) so core/renderer.js's tone mapper
                              rolls it off to a hard white core — "brighter
                              than the sun" without a bloom pass.
     0.18-0.30  THE MINIMUM   the DOUBLE FLASH, and the single most recognisable
                              thing a nuclear device does — bhangmeters count
                              warheads by it. The expanding shock front goes
                              OPAQUE and swallows its own fireball, so the light
                              DIPS almost to nothing, then the second thermal
                              pulse burns back through it: brighter, and far
                              longer. ONE curve (PULSE) drives all three layers
                              that must agree about it — the DOM div, the
                              fireball's own radiance, and the sky tint — so the
                              dip can never be present in one and absent in
                              another. The real dip is ~1 ms small / tens of ms
                              large; 120 ms here is a deliberate compression,
                              because a 15 ms dip is one frame and reads as a
                              dropped frame rather than as a nuclear weapon.
     0.06-0.62  SHOCK VEIL    the opaque front that CAUSES the minimum, drawn:
                              a near-white shell expanding at wave speed,
                              rendered ABOVE the fireball (renderOrder 9 vs 8)
                              so it genuinely hides it, then thinning as the
                              second pulse burns through.
     0.90+      CLOUD         six bounded instanced fields reuse the RPG's soft
                              fire/smoke masks for cap, crown, stem and dust.
                              Their centres move in world space, so the cloud
                              has depth and parallax from the street or B-2;
                              no all-enclosing mushroom card owns the default.
     0.62-1.90  CONDENSATION  the same shell, continued: the Wilson cloud, the
                              transient near-white SHELL (never a ball — that is
                              what uCore 0.06 + uRimPow 2.6 buys) thrown by the
                              rarefaction behind the front, then evaporating.
     0.10-3.90  IGNITION      a 126 m low-poly luminous core wrapped in
                              instanced hot billows. The radius is the published
                              50*W^(1/3) maximum-fireball relation at the game's
                              roughly 15 kt scale, cooling blue-white
                              -> white -> yellow -> orange -> deep red along the
                              shared RAMP as it rises and mixes.
     0.08-7.70  PRESSURE      NO drawn ring. The analytic gameplay field still
                              propagates outward, while an irregular filled dust
                              surge, scattered world fires and a brief 3D
                              condensation shell reveal its passage. A pressure
                              front is compressed air, not neon painted on the
                              terrain.
     1.84-10.3  GLASS LADDER  four cityShatter receipts at 0.339 / 0.615 / 1.0 /
                              1.25 x the 3,276 m 1 psi reach, each timed by the
                              same shock-arrival function so panes go out AS THE
                              FRONT PASSES rather than on a second visual clock.
                              Glass is the ~1 psi zone: the widest of the three
                              and the biggest single injury source a city
                              detonation produces, so it must outrange both the
                              flattening and the burning. It used to outrange
                              neither.
     1.00-27.0  RISE + STEM   the fireball climbs and cools; overlapping rough
                              3D lobes draw the stem UP off the deck into it.
                              The rise is FAST THEN
                              DECELERATING and then flat (riseAt) — an
                              compact bulb -> forming tower -> stabilised cloud,
                              rather than revealing the mature cloud at once. ONE curve,
                              read by the fireball, the cap, the stem and the
                              roll, so they cannot disagree about how high the
                              cloud is.
     0.70-25.0  MUSHROOM      six pooled InstancedMeshes form a genuinely 3D
                              hot core, thin rising stem, broad lobed cap and
                              filled ground cloud. Depth-writing surfaces and
                              real parallax carry the silhouette from every view.
     0.60-10.0  CAP GLOW      (NUKE_FX_V2) the cap is INCANDESCENT INSIDE while
                              its surface has already gone to soot — that is
                              the whole reason a mushroom photograph reads as
                              a light source. One additive instanced layer,
                              kept strictly inside the cap's own lobes (seed
                              r <= 0.62) with depthTest on, so the front lobes
                              occlude it and the heat comes out from BETWEEN
                              the lumps. White-hot -> yellow -> deep orange.
     1.50-25.0  COLLAR        (NUKE_FX_V2) the skirt hanging under the cap's
                              rim. This is what makes the cap OVERHANG its
                              stem; without it the head is a disc balanced on
                              a column. Wide and low by construction (1.42
                              lateral vs 0.56 vertical on every lobe).
     2.60-25.0  CROWN         (NUKE_FX_V2) dark cauliflower boiling over the
                              top, placed on the cap's own dome profile
                              sqrt(1-r^2) so it sits ON the head rather than
                              floating above it. Deliberately LATE: a fresh
                              cloud top is still incandescent and there is
                              nothing dark up there to draw. Shares ONE
                              InstancedMesh with the collar — same material,
                              two slices, one draw call for both.
     1.40-14.0  CAP FLATTENS  (NUKE_FX_V2) vertical scale walks 1.00 -> 0.62
                              across the rise. A young head is a rising ball;
                              a stabilised one is an anvil, because the
                              tropopause (~11 km) is an inversion it cannot
                              climb through and everything going up goes
                              sideways instead. Real 20 kt: ~10-12 km top,
                              cap kilometres across, ~5 minutes — a ~23x
                              compression into riseT, and it is named.
     0.75-22.0  BASE SURGE    a red-brown curtain of pulverised ground rolling
                              OUT along the deck from the foot of the stem.
                              Crossroads Baker is the measurement: ~45 m/s
                              outward initially, ~300 m radius by 10 s, ~1 km
                              by a minute, decelerating throughout — which is
                              why the growth is an ease and not a ramp. Under
                              NUKE_FX_V2 every lobe also SPINS about its own
                              tangential axis (slower the further out, as it
                              decelerates) so the curtain rolls instead of
                              sliding, and lobe heights alternate hard so the
                              low ones fall into shadow and go near-black.
                              Those black lobes carry the scale.
     8.00+      ASH FALL      CBZ.fx.particleCloud in fall mode around the
                              lens. Reused, not rebuilt.
     THROUGHOUT THE LIGHT     (NUKE_FX_V2) sun + hemisphere + bounce ride the
                              fireball's own luminosity at onAlways(94.6) —
                              the one slot after core/gfx.js's finalize(),
                              which is the last writer of those values and
                              would otherwise clobber this silently. White at
                              the flash, orange through the burn, ember at the
                              end. No light is ADDED (an added light in r128
                              recompiles every material in the world); only
                              values are written, and daynight+finalize
                              rewrite them next frame, so it is stateless.
     THROUGHOUT ATMOSPHERE    scene.fog.color is lerped white -> orange -> ash
                              for the whole arc. core/sky.js paints its horizon
                              band FROM that colour, so the entire sky turns
                              with it for ONE Color.lerp per frame and zero
                              draw calls — the highest ratio of "reads as a
                              nuclear event" to cost in the file. It is also
                              stateless: core/daynight.js rewrites fog.color
                              every frame anyway, so there is nothing to
                              restore and an abort mid-arc is clean.

   SIZE AND PROPORTION (rewritten 2026-07-28 — NUKE_REAL_SCALE).
   OWNER: "make them REAL TO SIZE, and also make the mushroom cloud LOOK LIKE
   AN ACTUAL MUSHROOM CLOUD."

   The YIELD is inverted out of the bus row (W = (radius*power/50)^3 = 16.0 kt,
   Hiroshima-class). nukeDims publishes the mature, minutes-old reference:

       fireball radius         126 m      50*W^(1/3)
       cap DIAMETER          5,106 m      Glasstone 20 kt cap, W^(1/3)-scaled
       cap THICKNESS         3,992 m
       cap centre altitude   8,004 m      top minus half the cap
       cloud TOP            10,000 m      tropopause-limited, not W^(1/3)
       stem diameter         1,702 m      cap/3 — the reference photograph
       dust base radius      2,016 m      the 2 psi contour

   THE FOUR RATIOS THE PHOTOGRAPH IS ABOUT, before -> after:

       cap WIDER THAN TALL       (never asserted) -> 1.28 : 1
       cap : stem                8.15 : 1         -> 3.00 : 1
       overhang (skirt : stem)   7.98 : 1         -> 2.94 : 1
       cloud top : cap width     2.06 : 1         -> 1.96 : 1

   The cap:stem number is the headline. At 8.15:1 this file was drawing a
   CHIMNEY under a hat — and the gate that was supposed to protect the
   silhouette (`capOverStem >= 6`) was ONE-SIDED, so it could only ever catch
   a stem that was too fat and it passed the chimney every single time. It is
   a two-sided window now (2.5..4.5), which is the only shape of gate that
   can catch both failure modes.

   THE CAP'S LUMPS OBEY A SIZE LAW, and that is what actually makes a
   silhouette read as cauliflower — not a shader. Lobe RADIUS falls with
   distance from the axis (0.34 -> 0.178) while lobe COUNT rises with it
   (the radial seed is area-uniform), so the crown carries a handful of very
   big lumps and the rim a dense fringe of small ones. The vertical station
   rides the cap's own lens profile sqrt(1-r^2), so the head is deep through
   the middle and tapers to the rim — the shape a vortex ring takes.

   THE STEM IS A TWISTED COLUMN, NOT A CYLINDER: the azimuth advances 0.85
   turns over the column height and stemProfile() flares it 1.9x at the foot
   into the dust base and 1.25x at the shoulder into the cap. Every lobe used
   to sit inside 0.36 of the declared radius — a thin core inside a wide
   claim, smooth from every angle.

   A mature 10 km cloud cannot form during this 34-second shot and cannot fit
   the 1 km frustum. formationDims therefore draws the young 454 m-wide,
   roughly 765 m-tall stage that can honestly exist in the sequence, while
   nukeDims remains the mature physics/zone reference. This removes both the
   time mismatch and the need to flatten the visible event onto one sky quad.

   All of it is reported by CBZ.nukeFxAudit() — .yieldKt, .dims, .zones,
   .casualty, .proportions, .impostor — so nothing here can drift back
   without somebody having to change a number they can see.

   WHAT THIS FILE DOES NOT OWN: gameplay blast, thermal and glass zones remain
   the bus's and ledger's. This file renders consequences—cloud, dust, world
   fires and broken windows—without outlining any zone on the ground.

   MUSHROOM CLOUDS, CHEAPLY: six InstancedMeshes place rough, light-reactive 3D
   lobes through a cap/stem/surge field. They write depth and self-occlude, so
   the cloud reads as one turbulent volume instead of stacked transparent
   camera-facing cards. Geometry and materials are baked once at load; nothing
   is fetched (CDN is blocked and must stay that way).

   ------------------------------------------------------------------
   COST DISCIPLINE (fill rate is the enemy — a full-screen additive layer is
   about a frame of opaque geometry on SwiftShader / a phone):
     • ONE photographed cloud sequence at a time. A concurrent detonation adds
       its flash while the shared analytic bus still preserves every physical
       field; GPU spectacle is bounded without evicting gameplay truth.
     • Every mesh is built ONCE at load and PARKED invisible (also gives
       core/fxwarm.js something to compile, so the first nuke of a session
       does not pay a shader-link hitch at the worst possible moment).
       Nothing is allocated per detonation except the ash cloud, and that is
       eight seconds after the bang.
     • Big layers are SEQUENCED, not stacked: the whiteout has faded before
       the cap blooms; the fireball shell is retired before the cloud is big.
     • The coherent cold silhouette is
       a fixed 72 depth-writing lobes; eight additive hot lobes sit inside it.
       Their transforms upload at 12 Hz while opacity and colour remain smooth.
     • Not one new runtime particle pool. Nuclear cloud/dust is six bounded
       InstancedMeshes; the ordinary explosion-puff storm is legacy-opt-in.

   DETERMINISM: runtime-only FX, but it still runs off a local seeded LCG
   (never Math.random) so replay/multiplayer stay bit-identical, matching
   crashfx.js's rule.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE || !CBZ.scene) return;
  const THREE = window.THREE;
  const scene = CBZ.scene;
  if (CBZ.cityNukeFX) return;                       // idempotent family guard

  CBZ.CONFIG = CBZ.CONFIG || {};
  // MASTER REVERT. false => the "nuke" composer degrades to the pooled heavy
  // blast (exactly what the row did before this file existed) and cityBombWalk
  // still works. One line.
  if (CBZ.CONFIG.NUKE_FX_V1 == null) CBZ.CONFIG.NUKE_FX_V1 = true;
  // The fresnel shock/condensation shells — the two biggest fill-rate items in
  // the sequence. false => the volumetric cloud and whiteout still run.
  if (CBZ.CONFIG.NUKE_FX_SHELL == null) CBZ.CONFIG.NUKE_FX_SHELL = true;
  // The late camera-local ash particle cloud. It used 260 extra sprites after
  // eight seconds and could veil the mushroom the player was trying to watch.
  // The coherent cloud carries its own soot; opt this legacy foreground layer
  // back in only for an A/B.
  if (CBZ.CONFIG.NUKE_FX_ASH == null) CBZ.CONFIG.NUKE_FX_ASH = false;
  // THE CLOUD MUST BE VISIBLE FROM ACROSS THE MAP. The cold lobes used to mix
  // toward scene.fog like ordinary geometry, and the city's white haze reaches
  // ~100% inside 5 km — so the biggest spectacle in the game was fog-erased
  // from exactly the distances a fleeing player watches it from (measured
  // 2026-08-02 with tools/visual-presets/nuke-sequence.mjs: at 5 km the t=8 s
  // cap was indistinguishable from sky). A mushroom cloud stands ABOVE the
  // haze layer; it does not dissolve into it. false => the old fogged read.
  if (CBZ.CONFIG.NUKE_FX_FOGPROOF == null) CBZ.CONFIG.NUKE_FX_FOGPROOF = true;
  // Photographically-anchored formation size (see formationDims) instead of
  // the first coherent draft's R*3.6 cap, which measured ~3x smaller than the
  // Trinity/Nagasaki frame record for the same age. false => draft numbers.
  if (CBZ.CONFIG.NUKE_FX_BIG_FORMATION == null) CBZ.CONFIG.NUKE_FX_BIG_FORMATION = true;
  // The cloud OUTLIVES the 34 s sequence: it keeps growing toward the mature
  // researched dimensions (nukeDims) over ~3 minutes, stands as a landmark,
  // thins, and only then fades — instead of vanishing mid-formation at 34 s.
  // false => the sequence ends and hides at STYLE.nuke.dur exactly as before.
  if (CBZ.CONFIG.NUKE_FX_AFTERMATH == null) CBZ.CONFIG.NUKE_FX_AFTERMATH = true;
  // OWNER (2026-08-02): "it looks too much like rocks... when an RPG blows up
  // it actually looks real as fuck, but your shit looks geometric." The RPG's
  // realism is soft-EDGED sprites — nothing in that picture has a polygon
  // silhouette. The lobes were bare lit geometry with hard rims. This injects
  // a fresnel edge-fade into the shared Lambert lobe material so every billow
  // dissolves at its silhouette exactly like a gradient puff, while the core
  // stays dense and depth-writing. false => the hard-rimmed read.
  if (CBZ.CONFIG.NUKE_FX_SOFT_LOBES == null) CBZ.CONFIG.NUKE_FX_SOFT_LOBES = true;
  // THE ATMOSPHERE DRIVE — the single cheapest "this is nuclear" cue there is.
  // Lerps scene.fog.color along the timeline (white-out -> orange -> ash grey);
  // core/sky.js@99 paints its horizon band from scene.fog.color, so the whole
  // SKY follows for free, and core/daynight.js@2 rewrites the colour every
  // frame, so it self-restores with nothing to leak. false => fog untouched.
  if (CBZ.CONFIG.NUKE_FX_SKY == null) CBZ.CONFIG.NUKE_FX_SKY = true;
  // Re-point the bus's "moab" row at the composer below. false => the row
  // keeps whatever fx the bus table gave it (today: "heavy").
  if (CBZ.CONFIG.NUKE_FX_MOAB == null) CBZ.CONFIG.NUKE_FX_MOAB = true;
  // The carpet-bombing stagger (CBZ.cityBombWalk). false => a walk fires its
  // whole stick on the first tick, which is the pre-existing behaviour of
  // every caller that just looped over points itself.
  if (CBZ.CONFIG.BOMB_WALK_V1 == null) CBZ.CONFIG.BOMB_WALK_V1 = true;

  /* ---- the phenomenology flags. Each is ONE beat and ONE revert. ----------
     Every one of these is degrade-safe by construction: turning it off returns
     the layer to the curve it had before, it never removes the layer. */
  // THE DOUBLE FLASH, IN THE WORLD. false => the DOM div still dips (that has
  // always been there) but the FIREBALL and the sky ride a flat envelope, i.e.
  // the pre-existing behaviour where the signature existed only on the overlay.
  if (CBZ.CONFIG.NUKE_FX_PULSE == null) CBZ.CONFIG.NUKE_FX_PULSE = true;
  // THE SHOCK VEIL — the opaque front that swallows the fireball, drawn above
  // it. false => the condensation shell keeps its old 0.28s start and its old
  // "sits behind the fireball" render order.
  if (CBZ.CONFIG.NUKE_FX_VEIL == null) CBZ.CONFIG.NUKE_FX_VEIL = true;
  // THE RISE CURVE — fast, then decelerating, then stable. false => the old
  // smoothstep (slow-start, constant-ish middle), which is what films draw.
  if (CBZ.CONFIG.NUKE_FX_RISE == null) CBZ.CONFIG.NUKE_FX_RISE = true;
  // THE CLOUD ROLL, earlier and decaying. It drives the billboard shear and
  // the 3D cap-lobe circulation; there is deliberately no visible torus mesh.
  if (CBZ.CONFIG.NUKE_FX_ROLL == null) CBZ.CONFIG.NUKE_FX_ROLL = true;
  // THE GLASS LADDER — cityShatter passes walking outward WITH the front, out
  // past the blast reach. false => the old three fixed-clock passes that all
  // landed INSIDE the flattened zone.
  if (CBZ.CONFIG.NUKE_FX_GLASS == null) CBZ.CONFIG.NUKE_FX_GLASS = true;

  /* ============================================================
     NUKE_FX_V2 (2026-07-28) — THE REDRAW. Four beats the file did not have,
     each one a thing test film shows and this sequence did not:

       (a) THE WHITE DOME. The first second of a near-surface burst is a
           featureless, blinding white HEMISPHERE swelling off the deck —
           no detail inside it at all, so bright it silhouettes the skyline
           and washes the horizon to a line. This file drew the light (a DOM
           div) and the fireball (a graded additive shell) and never drew the
           thing itself. It grows on the Taylor-Sedov law, not on a taste
           curve — see WDOME below.
       (b) THE COLLAR AND THE CROWN. A mature cloud OVERHANGS its own stem
           with a skirt, and its top boils over into dark cauliflower as it
           cools. The cap here was a disc of lobes with nothing under its rim
           and nothing dark on top, which is why it read as smoke rather than
           as a cloud with a shape.
       (c) THE CAP GLOWS FROM WITHIN. The reason a mushroom photograph reads
           as a light source is that the cap is still incandescent inside
           while its surface has already gone to soot. One additive layer,
           inside the cap lobes, retired as it cools.
       (d) THE WORLD IS LIT BY IT. scene.fog already turned the sky; nothing
           turned the GROUND. The sun and the hemisphere ambient now ride the
           fireball's own luminosity, so every wall and roof for hundreds of
           metres goes orange and then dark — which is the whole difference
           between a picture of an explosion and being next to one.

     false => every one of those four is skipped and the sequence is the
     pre-2026-07-28 one, beat for beat. */
  if (CBZ.CONFIG.NUKE_FX_V2 == null) CBZ.CONFIG.NUKE_FX_V2 = true;
  function v2() { return CBZ.CONFIG.NUKE_FX_V2 !== false; }

  /* NUKE_REAL_SCALE (2026-07-28) — DIMENSIONAL HONESTY.
     OWNER: "make them REAL TO SIZE."
     nukeDims keeps the mature modelled dimensions and all physical effect
     contours. formationDims is the separate visible 34-second stage; it is
     deliberately younger and stays volumetric inside the camera frustum.
     false => the old framing-scale/legacy cloud path. */
  if (CBZ.CONFIG.NUKE_REAL_SCALE == null) CBZ.CONFIG.NUKE_REAL_SCALE = true;
  function real() { return v2() && CBZ.CONFIG.NUKE_REAL_SCALE !== false; }

  /* THE CLOUD FORMS IN PHASES. The real-size pass used to reveal a complete
     ten-kilometre mature mushroom as soon as the white dome released. That
     was a timing bug, not a style choice: the far-tier quad began at 30% of
     mature size and already contained the final cap, collar, stem and base.
     false is the one-line visual revert. */
  if (CBZ.CONFIG.NUKE_FX_PHASED_CLOUD == null) CBZ.CONFIG.NUKE_FX_PHASED_CLOUD = true;
  function phasedCloud() {
    return real() && CBZ.CONFIG.NUKE_FX_PHASED_CLOUD !== false;
  }

  /* THE POST-FLASH CLOUD HAS ONE OWNER. The coherent path suppresses the five
     legacy detail planes and the ordinary explosion storm, but it now keeps
     the six bounded instanced fields. Each field uses crashfx's exact soft RPG
     fire/smoke masks, so the cloud is many overlapping moving volumes in world
     space rather than one camera-facing mushroom silhouette. false restores
     the old nuclear stack and its geometric far-tier handoff. */
  if (CBZ.CONFIG.NUKE_FX_COHERENT_CLOUD == null) CBZ.CONFIG.NUKE_FX_COHERENT_CLOUD = true;
  function coherentCloud() {
    return phasedCloud() && CBZ.CONFIG.NUKE_FX_COHERENT_CLOUD !== false;
  }

  /* Legacy decorative blasts are deliberately OFF for a nuke. They scheduled
     19 ordinary cityExplosion calls plus shock-front dust after the real
     near-field blast had already fired: ~1,900 individual puff requests on
     the first detonation, against crashfx's 64-object warm pool. The nuke owns
     instanced hot billows and a ground surge already; impactbus owns actual
     structure ignition. Re-enable only for an A/B regression check. */
  if (CBZ.CONFIG.NUKE_FX_LEGACY_PUFFS == null) CBZ.CONFIG.NUKE_FX_LEGACY_PUFFS = false;

  // ---- deterministic seeded LCG (NEVER Math.random — replay/MP sync) --------
  let _rs = 0x51ed77;
  function rng() { _rs = (_rs * 1103515245 + 12345) & 0x7fffffff; return _rs / 0x7fffffff; }

  function q01() { return CBZ.qScale ? Math.max(0, Math.min(1, CBZ.qScale(0, 1))) : 1; }
  function floorAt(x, z) { return CBZ.floorAt ? CBZ.floorAt(x, z) : 0; }
  function camPos() { return CBZ.camera && CBZ.camera.position ? CBZ.camera.position : null; }
  // core/scene.js ships PerspectiveCamera(62, aspect, 0.1, 1000). Read it
  // live rather than typing 1000: a quality tier or a mode is allowed to
  // move it, and every impostor number below is a fraction of it.
  function camFar() {
    const c = CBZ.camera;
    return (c && c.far > 1) ? c.far : 1000;
  }
  // bloomAt()'s ceiling: 0.35 + 0.9 + 0.16. Named once so the cap's true
  // width can be divided by it instead of by a literal nobody can trace.
  const BLOOM_MAX = 0.35 + 0.9 + 0.16;
  function camDist(x, y, z) {
    const c = camPos();
    return c ? Math.hypot(x - c.x, y - c.y, z - c.z) : 0;
  }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function ease(t) { return t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t); }   // smoothstep
  const _fogTint = new THREE.Color();          // scratch — never allocate per frame

  /* ============================================================
     PROCEDURAL TEXTURES — baked once at load, no external assets.
     ============================================================ */
  // A lumpy grayscale billow: alpha carries density, the red channel carries
  // the same density so the shader can brighten the dense core without a
  // second sampler. Overlapping soft blobs + a radial mask kill the quad edge.
  function makeCloudTexture() {
    const c = document.createElement("canvas"); c.width = c.height = 256;
    const ctx = c.getContext("2d");
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < 54; i++) {
      // cluster the blobs into a disc so the silhouette is a billow, not a square
      const a = rng() * 6.2832, rr = Math.sqrt(rng()) * 78;
      const px = 128 + Math.cos(a) * rr, py = 128 + Math.sin(a) * rr * 0.86;
      const br = 20 + rng() * 52;
      const g = ctx.createRadialGradient(px, py, 0, px, py, br);
      const v = 150 + ((rng() * 90) | 0);
      g.addColorStop(0, "rgba(" + v + "," + v + "," + v + "," + (0.36 + rng() * 0.4) + ")");
      g.addColorStop(1, "rgba(" + v + "," + v + "," + v + ",0)");
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(px, py, br, 0, 6.2832); ctx.fill();
    }
    // radial mask: solid through the middle, gone by the quad edge
    ctx.globalCompositeOperation = "destination-in";
    const m = ctx.createRadialGradient(128, 128, 8, 128, 128, 128);
    m.addColorStop(0.0, "rgba(0,0,0,1)");
    m.addColorStop(0.62, "rgba(0,0,0,0.92)");
    m.addColorStop(0.88, "rgba(0,0,0,0.28)");
    m.addColorStop(1.0, "rgba(0,0,0,0)");
    ctx.fillStyle = m; ctx.fillRect(0, 0, 256, 256);
    const t = new THREE.CanvasTexture(c);
    t.needsUpdate = true;
    return t;
  }

  // Tiling two-octave value noise. This is the "second independently-scrolling
  // noise" the research calls for — one sampler, two lookups, no third texture.
  function makeNoiseTexture() {
    const S = 128, c = document.createElement("canvas");
    c.width = c.height = S;
    const ctx = c.getContext("2d"), img = ctx.createImageData(S, S), d = img.data;
    function grid(n) {
      const g = new Float32Array(n * n);
      for (let i = 0; i < g.length; i++) g[i] = rng();
      return g;
    }
    const gA = grid(8), gB = grid(16);
    function samp(g, n, u, v) {                    // bilinear, wrapped => tileable
      const fx = u * n, fy = v * n;
      const x0 = Math.floor(fx) % n, y0 = Math.floor(fy) % n;
      const x1 = (x0 + 1) % n, y1 = (y0 + 1) % n;
      const tx = fx - Math.floor(fx), ty = fy - Math.floor(fy);
      const a = g[y0 * n + x0], b = g[y0 * n + x1], e = g[y1 * n + x0], f = g[y1 * n + x1];
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      return (a + (b - a) * sx) + ((e + (f - e) * sx) - (a + (b - a) * sx)) * sy;
    }
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const u = x / S, v = y / S;
        let n = samp(gA, 8, u, v) * 0.65 + samp(gB, 16, u, v) * 0.35;
        n = clamp(n, 0, 1);
        const o = (y * S + x) * 4, b = (n * 255) | 0;
        d[o] = b; d[o + 1] = b; d[o + 2] = b; d[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.needsUpdate = true;
    return t;
  }

  /* ============================================================
     LEGACY MUSHROOM DENSITY TEXTURE — baked once for the flag-off fallback.

     WHY THIS EXISTS. The honest cloud for this device is 5,106 m across and
     10,000 m tall (see nukeDims). core/scene.js's camera is
     `PerspectiveCamera(62, aspect, 0.1, 1000)` — a ONE KILOMETRE far plane —
     and scene.fog is `Fog(0xb6c4c8, 95, 360)`. So the true cloud is TEN
     TIMES the entire view frustum and twenty-eight times the fog's reach:
     there is no camera setting and no lobe count that renders it as 3D
     geometry. Raising the far plane is not the answer either — 0.1 to 20000
     is a depth-precision disaster across the whole city for one 34-second
     event.

     This was the former default. The coherent path now draws the honest young
     formation stage as soft world-space volumes; this mature sky card remains
     only so the explicit fallback still has a complete implementation.

     THE SIMILAR-TRIANGLES SOLVE (stepImpostor does it every frame):
         d      = |cloudCentre - camera|          the TRUE distance
         D      = 0.86 * camera.far = 860 m       where we actually put it
         size'  = size * D / d
     A quad of size' at D subtends exactly the angle `size` does at d, so a
     player 2 km from ground zero sees a cloud of the correct angular size,
     and one standing AT ground zero looks up at a cap that correctly fills
     the sky. Depth-tested at 860 m, so everything in the world occludes it
     (correct: it is really kilometres further away), and un-fogged, because
     it is behind the fog, not in it.

     WHAT IS IN THE THREE CHANNELS:
        A  one continuous density field — cap, collar, stem and dust base
        R  incandescence  — 1 in the cap core and up the stem's spine
        G  coolness       — 1 at the boiled-over crown and the dust base
     R and G are read by IMP_FS (see uCool). Crucially, turbulence modulates
     density WITHIN the connected field; no circle or sphere defines smoke.
     ============================================================ */
  const IMP_W = 256, IMP_H = 512;

  // Deterministic value noise for the baked density field. Integer hashing
  // avoids Math.random and avoids consuming the replay RNG used by live FX.
  function maskHash(x, y, seed) {
    let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^
            Math.imul(seed | 0, 69069);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  }
  function maskNoise(x, y, seed) {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = maskHash(ix, iy, seed), b = maskHash(ix + 1, iy, seed);
    const c = maskHash(ix, iy + 1, seed), d = maskHash(ix + 1, iy + 1, seed);
    return (a + (b - a) * sx) + ((c + (d - c) * sx) - (a + (b - a) * sx)) * sy;
  }
  function maskFbm(x, y) {
    return maskNoise(x, y, 91) * 0.54 +
           maskNoise(x * 2.07 + 13.1, y * 2.07 - 7.3, 173) * 0.30 +
           maskNoise(x * 4.19 - 5.7, y * 4.19 + 11.9, 251) * 0.16;
  }
  function maskSmooth(a, b, x) {
    const u = clamp((x - a) / Math.max(0.00001, b - a), 0, 1);
    return u * u * (3 - 2 * u);
  }

  function makeMushroomTexture(stage) {
    stage = stage == null ? 2 : clamp(stage | 0, 0, 2);
    const c = document.createElement("canvas");
    c.width = IMP_W; c.height = IMP_H;
    const ctx = c.getContext("2d");

    // The canvas is laid out in the cloud's OWN metres so every station below
    // is the researched number, not a fraction somebody guessed. The quad is
    // later scaled to (capW, top), so these two mappings are exact.
    const D = nukeDims(126);

    /* Three masks describe three DIFFERENT objects rather than scaling the
       finished silhouette. Stage 0 is the compact rising bulb and short dirty
       column that follows the white dome; stage 1 is the forming tower; stage
       2 is the researched mature cloud. They share the mature cloud's metre
       coordinate system, so blending masks is a physical morph and the quad
       never jumps in angular size. */
    const capScale = [0.15, 0.50, 1][stage];
    const capHScale = [0.12, 0.55, 1][stage];
    const capY = [900, 3600, D.capY][stage];
    const capRx = D.capW * 0.5 * capScale;
    const capRy = D.capH * 0.5 * capHScale;
    const stemRx = D.stemW * 0.5 * [0.33, 0.68, 1][stage];
    const baseRx = D.base * 0.5 * [0.28, 0.62, 1][stage];
    const baseH = D.top * [0.025, 0.045, 0.055][stage];
    /* Each phase owns its OWN current physical box and fills the same UV
       rectangle. The runtime scales that rectangle to the live cap width/top.
       Previously all three were painted into the mature 10 km box at y=900,
       y=3600 and y=8004, so a cross-fade literally displayed two heads. */
    // Transparent breathing room is part of the texture contract. The old
    // 2.08-wide box left only four per cent beside the cap; the young stem's
    // foot could reach that edge and ClampToEdgeWrapping repeated its last
    // opaque texel as a rectangular smoke sheet. Runtime uses the matching
    // 1.30/1.12 factors, so the cloud's researched dimensions do not change.
    const shapeW = capRx * 2.60;
    const shapeTop = capY + capRy * 1.12;

    /* One analytic UNION, sampled into pixels. The cap is an asymmetric
       superellipse (wide/flat above, deeper below), the collar is a low shelf
       under it, the stem is one flared connected column, and the base is a
       low ground-hugging mass. Noise perturbs the boundary and density; it
       never creates a freestanding circle. */
    const img = ctx.createImageData(IMP_W, IMP_H);
    const data = img.data;
    const stemBottom = baseH * 0.28;
    for (let iy = 0; iy < IMP_H; iy++) {
      const wy = (1 - (iy + 0.5) / IMP_H) * shapeTop;
      for (let ix = 0; ix < IMP_W; ix++) {
        const wx = ((ix + 0.5) / IMP_W - 0.5) * shapeW;
        const noise = maskFbm(ix / 31, iy / 31);
        const fine = maskFbm(ix / 12 + 4.7, iy / 12 - 2.1);

        const capDy = wy - capY;
        const capYn = capDy >= 0
          ? capDy / Math.max(1, capRy)
          : capDy / Math.max(1, capRy * 0.86);
        const capXn = Math.abs(wx) / Math.max(1, capRx);
        const capField = 1 - Math.pow(capXn, 3.0) - Math.pow(Math.abs(capYn), 2.6);

        // The toroidal overhang is real, but a mathematically level shelf
        // reads as a sprite seam. Low-frequency convection bends its lower
        // edge while keeping it part of the same cap mass.
        const collarWarp =
          (maskNoise(ix / 41, stage * 3.7 + 0.8, 417) - 0.5) * capRy * 0.16 +
          Math.sin((wx / Math.max(1, capRx)) * 4.2 + stage) * capRy * 0.035;
        const collarY = capY - capRy * 0.52 + collarWarp;
        const collarField = 1 -
          Math.pow(Math.abs(wx) / Math.max(1, capRx * 1.02), 4.0) -
          Math.pow(Math.abs(wy - collarY) / Math.max(1, capRy * 0.30), 2.2);

        /* The stem continues well INTO the cap and base, then fades there.
           A hard y-range used to end the stem on one scanline immediately
           below the cap, producing the horizontal shelf visible in phase
           previews. This is a signed intersection of its lateral and axial
           fields instead: one uninterrupted convective column. */
        // Carry the hot column well into the head. Its axial fade is buried
        // across the cap rather than ending at the cap/stem silhouette.
        const stemTop = capY + capRy * 0.30;
        let stemF = clamp((wy - stemBottom) /
          Math.max(1, stemTop - stemBottom), 0, 1);
        // A young column may flare, but it cannot be wider than its own head.
        // The ground surge carries the broad foot separately.
        const width = Math.min(stemRx * stemProfile(stemF), capRx * 0.74);
        const centre = Math.sin(stemF * 5.1 + stage * 0.35) * width * 0.10 +
          (maskNoise(stemF * 6.0, 1.7, 331) - 0.5) * width * 0.16;
        const stemDistance = Math.abs(wx - centre) / Math.max(1, width);
        const lateralField = 1 - stemDistance;
        const axialField = Math.min(
          (wy - stemBottom) / Math.max(1, Math.max(baseH * 0.55, capRy * 0.10)),
          (stemTop - wy) / Math.max(1, Math.max(capRy * 0.85, baseH * 0.35))
        );
        const stemField = Math.min(lateralField, axialField);
        const stemJoin = maskSmooth(-0.06, 0.34, axialField);
        const stemAxial = clamp(lateralField, 0, 1) * stemJoin;

        const baseField = 1 -
          Math.pow(Math.abs(wx) / Math.max(1, baseRx), 2.6) -
          Math.pow(Math.abs(wy - baseH * 0.38) / Math.max(1, baseH * 0.62), 2.2);

        const structure = Math.max(capField, collarField, stemField, baseField);
        // Boundary displacement is strongest at the edge and quiet inside:
        // smoke occupies a mass, then carries roil within that mass.
        const edgeK = 1 - Math.min(1, Math.abs(structure));
        const field = structure + (noise - 0.5) * (0.24 + 0.44 * edgeK);
        let alpha = maskSmooth(-0.16, 0.18, field);
        alpha *= 0.82 + fine * 0.18;
        if (alpha <= 0.002) continue;

        const capMask = maskSmooth(-0.14, 0.30, Math.max(capField, collarField));
        const stemMask = maskSmooth(-0.08, 0.30, stemField);
        const baseMask = maskSmooth(-0.10, 0.28, baseField);
        const capBand = 1 - Math.min(1,
          Math.abs(capDy + capRy * 0.04) / Math.max(1, capRy * 0.58));
        const capCore = (1 - Math.min(1, capXn / 0.86)) * capBand;
        // Heat climbs as a narrow, turbulent spine. Using the full linear
        // stem field painted a pale rectangular column inside an otherwise
        // organic silhouette—the same "geometry pretending to be smoke"
        // problem this path exists to remove.
        const stemHeat = Math.pow(stemAxial, 1.65) *
          (0.58 + noise * 0.50);
        const hot = clamp(Math.max(
          capMask * capCore * (1 - stage * 0.10),
          stemMask * stemHeat * (0.38 + stemF * 0.62)
        ) * (0.84 + fine * 0.20), 0, 1);
        const capCool = capMask * clamp(0.08 +
          0.62 * Math.max(0, capYn) + 0.32 * capXn, 0, 1);
        const stemCool = stemMask * clamp(0.20 + (1 - stemAxial) * 0.52 +
          (1 - stemF) * 0.18, 0, 1);
        const cool = clamp(Math.max(baseMask * 0.94, capCool, stemCool), 0, 1);

        const o = (iy * IMP_W + ix) * 4;
        data[o] = Math.round(hot * 255);
        data[o + 1] = Math.round(cool * 255);
        data[o + 2] = 0;
        data[o + 3] = Math.round(clamp(alpha, 0, 1) * 255);
      }
    }
    ctx.putImageData(img, 0, 0);

    // The removed lobe painter consumed exactly 898 replay-RNG samples per
    // stage before seedVolumes(). Advance by the same amount so the MOAB and
    // the coherent-cloud flag-off path keep their established layouts.
    for (let i = 0; i < 898; i++) rng();

    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.generateMipmaps = false;
    t.minFilter = THREE.LinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.needsUpdate = true;
    return t;
  }

  /* A CONVECTIVE COLUMN IS NOT A CYLINDER. It flares at BOTH ends — hard at
     the foot, where it is being drawn up out of the ground-shock skirt, and
     gently at the shoulder, where it feeds the vortex ring. Measured off the
     owner's reference plate: about 1.9x at the deck, 1.25x at the shoulder,
     and 1.0 through the middle third. f = 0 at the ground, 1 at the cap. */
  function stemProfile(f) {
    f = clamp(f, 0, 1);
    return (1 + 0.90 * Math.pow(1 - f, 2.4)) * (1 + 0.25 * Math.pow(f, 3.0));
  }

  // The 1D LIFETIME LUT: white-hot -> yellow -> orange -> ember -> soot -> ash.
  // Sampled by u = normalized age, which is how a single billboard shader
  // covers "fireball" and "old cloud" without a second material.
  const RAMP = [
    [0.00, "#fffdf2"], [0.06, "#ffeda6"], [0.14, "#ffc25a"], [0.26, "#ff8a2e"],
    [0.40, "#d1512a"], [0.55, "#8a5340"], [0.70, "#6b6157"], [0.85, "#575049"],
    [1.00, "#3d3934"],
  ];
  function makeLutTexture() {
    const c = document.createElement("canvas"); c.width = 64; c.height = 1;
    const ctx = c.getContext("2d"), g = ctx.createLinearGradient(0, 0, 64, 0);
    for (const s of RAMP) g.addColorStop(s[0], s[1]);
    ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 1);
    const t = new THREE.CanvasTexture(c);
    t.generateMipmaps = false;
    t.minFilter = THREE.LinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.needsUpdate = true;
    return t;
  }
  /* THE COLOUR THE RAMP DELIBERATELY DOES NOT HAVE.

     RAMP starts at a warm white because it is shared with the CLOUD billboards,
     and a blue cloud is nonsense. But a fireball does not start at warm white
     either: for the first fraction of a second it is an isothermal ball at tens
     of thousands of kelvin and it reads BLUE-white — far bluer, and far
     brighter, than the sun. That colour belongs to exactly one layer for
     exactly one beat, so it lives here as a single Color the shell lerps
     toward and away from, rather than as a second stop nobody else wants. */
  const BLUE_WHITE = new THREE.Color(0xd6e8ff);
  // CPU twin of the LUT, for the shells (uniform colours, no sampler needed).
  // Parsed to Colors ONCE — a per-frame Color.set("#rrggbb") is a regex parse.
  const RAMP_C = RAMP.map(function (s) { return new THREE.Color(s[1]); });
  function rampColor(out, t) {
    t = clamp(t, 0, 1);
    for (let i = 1; i < RAMP.length; i++) {
      if (t <= RAMP[i][0]) {
        const p = (t - RAMP[i - 1][0]) / (RAMP[i][0] - RAMP[i - 1][0] || 1);
        out.copy(RAMP_C[i - 1]).lerp(RAMP_C[i], p);
        return out;
      }
    }
    return out.copy(RAMP_C[RAMP_C.length - 1]);
  }

  const TEX = {
    cloud: null, noise: null, lut: null,
    mushEarly: null, mushForm: null, mush: null,
    blastFlame: null, blastSmoke: null,
  };

  /* ============================================================
     SHADERS — r128 GLSL ES 1.0, ShaderMaterial (NOT RawShaderMaterial, so
     three still prepends position/normal/uv/modelViewMatrix/projectionMatrix
     AND resolves #include, which is the whole trick below).

     WHY WE USE THE ENGINE'S OWN CHUNKS INSTEAD OF HAND-ROLLING FOG:
     core/renderer.js does two things every other material in this game gets
     for free and a hand-rolled shader silently does NOT:
       1. CustomToneMapping + the film grade (ACES + contrast/sat/gain/lift),
          injected as `toneMapping()` into every non-raw ShaderMaterial when
          renderer.toneMapping is set;
       2. renderer.outputEncoding = sRGBEncoding, injected as
          `linearToOutputTexel()`;
       ...plus it PATCHES ShaderChunk.fog_fragment with height fog and a graded
       fog colour so a fogged pixel lands exactly on core/sky.js's horizon stop.
     A shader that writes gl_FragColor raw skips all three, so the cloud would
     be brighter, more saturated and sitting in FRONT of the haze the city sits
     in — a mushroom reaches far past fog.far (360m), so that is the one layer
     in the game where getting it wrong is most visible. Including the chunks
     costs nothing and can never drift from whatever renderer.js does next.

     r128 fog contract (verified against src/vendor/three.r128.min.js):
       • the varying is `fogDepth` (the `vFogDepth` rename is a LATER release),
       • fog_vertex reads a local named exactly `mvPosition`,
       • WebGLRenderer calls refreshFogUniforms() on ANY material with
         `fog: true` and writes straight into material.uniforms — so the
         uniforms object MUST already carry fogColor/fogNear/fogFar/fogDensity
         or it throws. FOG_U() below is that, built by hand rather than with
         UniformsUtils.merge (which deep-CLONES texture values in r128 and
         would mint a duplicate GPU upload of the mask/noise/LUT per material).
     ============================================================ */
  function FOG_U(extra) {
    return Object.assign({
      fogColor: { value: new THREE.Color(0xb6c4c8) },
      fogNear: { value: 95 }, fogFar: { value: 360 },
      fogDensity: { value: 0.00025 },
    }, extra);
  }
  // Tail for a NORMAL-blended layer: tonemap, encode, then mix toward the fog.
  // Exactly the order three's own meshbasic_frag uses.
  const TAIL_FOG = [
    "  #include <tonemapping_fragment>",
    "  #include <encodings_fragment>",
    "  #include <fog_fragment>",
  ].join("\n");
  // Tail for an ADDITIVE layer. Mixing an additive fragment TOWARD a bright fog
  // colour ADDS haze instead of hiding it (additive has no "behind"), so a
  // distant fireball would get BRIGHTER with range. Fade the ALPHA on the same
  // curve instead — fogNear/fogFar/fogDepth are already in scope from
  // fog_pars_fragment, we just decline to call fog_fragment.
  const TAIL_FOG_ADD = [
    "  #ifdef USE_FOG",
    "    #ifdef FOG_EXP2",
    "      gl_FragColor.a *= 1.0 - 0.85 * clamp(1.0 - exp(-fogDensity * fogDensity * fogDepth * fogDepth), 0.0, 1.0);",
    "    #else",
    "      gl_FragColor.a *= 1.0 - 0.85 * smoothstep(fogNear, fogFar, fogDepth);",
    "    #endif",
    "  #endif",
    "  #include <tonemapping_fragment>",
    "  #include <encodings_fragment>",
  ].join("\n");

  // ---- fresnel-rim shell (fireball + condensation front) -------------------
  const SHELL_VS = [
    "#include <fog_pars_vertex>",
    "varying vec3 vN; varying vec3 vV;",
    "void main() {",
    "  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);",
    "  vN = normalize(normalMatrix * normal);",
    "  vV = normalize(-mvPosition.xyz);",
    "  gl_Position = projectionMatrix * mvPosition;",
    "  #include <fog_vertex>",
    "}",
  ].join("\n");
  function shellFs(additive) {
    return [
      "#include <fog_pars_fragment>",
      "uniform vec3 uRimColor; uniform vec3 uCoreColor;",
      "uniform float uOpacity; uniform float uRimPow; uniform float uCore;",
      "varying vec3 vN; varying vec3 vV;",
      "void main() {",
      "  float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));",
      "  f = pow(clamp(f, 0.0, 1.0), uRimPow);",
      "  vec3 c = mix(uCoreColor, uRimColor, f);",
      "  float a = (uCore + (1.0 - uCore) * f) * uOpacity;",
      "  if (a <= 0.003) discard;",
      "  gl_FragColor = vec4(c, a);",
      additive ? TAIL_FOG_ADD : TAIL_FOG,
      "}",
    ].join("\n");
  }
  function makeShellMat(additive) {
    const m = new THREE.ShaderMaterial({
      uniforms: FOG_U({
        uRimColor: { value: new THREE.Color(0xfff3d0) },
        uCoreColor: { value: new THREE.Color(0xffb054) },
        uOpacity: { value: 0 }, uRimPow: { value: 1.7 }, uCore: { value: 0.35 },
      }),
      vertexShader: SHELL_VS, fragmentShader: shellFs(additive),
      transparent: true, depthWrite: false, depthTest: true,
      fog: true,
      side: THREE.DoubleSide,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    m._shared = true;
    return m;
  }

  // ---- camera-facing cloud billboard --------------------------------------
  const BILL_VS = [
    "#include <fog_pars_vertex>",
    "varying vec2 vUv;",
    "void main() {",
    "  vUv = uv;",
    "  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);",
    "  gl_Position = projectionMatrix * mvPosition;",
    "  #include <fog_vertex>",
    "}",
  ].join("\n");
  /* uCool — THE ONE ADDITION, AND IT DEFAULTS TO A NO-OP.

     The mask's RED channel has always been "how bright is this part"
     (it multiplies the LUT colour, which is what draws the hot core). The
     mask's GREEN channel was unused. It now carries "how COLD is this part",
     and it walks the LUT sample FORWARD along its own white->yellow->orange
     ->ember->soot->ash ramp.

     That one lookup shift is what lets a SINGLE quad carry the whole
     reference photograph: an incandescent white-yellow core (green 0, red 1),
     orange cauliflower lobes around it (green ~0.15, red ~0.5), a dark
     boiled-over crown (green ~0.5, red ~0.1) and a near-black dust base
     (green ~0.9, red ~0.05) — one draw call, one material, no second
     sampler and no second shader.

     uCool = 0 makes lifeShift exactly 0, so the five existing cloud
     billboards compile and render byte-identically. Only the impostor sets
     it. */
  const BILL_FS = [
    "#include <fog_pars_fragment>",
    "uniform sampler2D uMask; uniform sampler2D uNoise; uniform sampler2D uLut;",
    "uniform vec2 uScroll; uniform vec2 uScroll2;",
    "uniform float uLife; uniform float uOpacity; uniform float uErode; uniform float uGlow;",
    "uniform float uCool;",
    "varying vec2 vUv;",
    "void main() {",
    "  vec4 m = texture2D(uMask, vUv);",
    "  float n1 = texture2D(uNoise, vUv * 2.1 + uScroll).r;",
    "  float n2 = texture2D(uNoise, vUv * 0.9 + uScroll2).r;",
    "  float d = m.a * (0.42 + 0.78 * n1) * (0.55 + 0.7 * n2);",
    "  float a = smoothstep(uErode, uErode + 0.30, d) * uOpacity;",
    "  if (a <= 0.004) discard;",
    "  float life = clamp(uLife + uCool * m.g * 0.55, 0.02, 0.98);",
    "  vec3 c = texture2D(uLut, vec2(life, 0.5)).rgb;",
    "  c *= 0.72 + uGlow * m.r * (0.6 + 0.7 * n1);",
    "  gl_FragColor = vec4(c, a);",
    TAIL_FOG,
    "}",
  ].join("\n");

  /* The sky-tier cloud uses the same lighting/noise language, but morphs
     between compact, forming and mature masks. Scaling one finished mushroom
     was the source of the instant three-kilometre cloud at dome handoff. */
  const IMP_FS = [
    "#include <fog_pars_fragment>",
    "uniform sampler2D uMask; uniform sampler2D uMaskB; uniform sampler2D uMaskC;",
    "uniform sampler2D uNoise; uniform sampler2D uLut;",
    "uniform vec2 uScroll; uniform vec2 uScroll2;",
    "uniform float uLife; uniform float uOpacity; uniform float uErode; uniform float uGlow;",
    "uniform float uCool; uniform float uPhase;",
    "varying vec2 vUv;",
    "void main() {",
    "  float p = clamp(uPhase, 0.0, 1.0);",
    "  vec4 a0 = texture2D(uMask, vUv);",
    "  vec4 a1 = texture2D(uMaskB, vUv);",
    "  vec4 a2 = texture2D(uMaskC, vUv);",
    "  vec4 m = p < 0.5",
    "    ? mix(a0, a1, smoothstep(0.0, 0.5, p))",
    "    : mix(a1, a2, smoothstep(0.5, 1.0, p));",
    "  float n1 = texture2D(uNoise, vUv * 2.1 + uScroll).r;",
    "  float n2 = texture2D(uNoise, vUv * 0.9 + uScroll2).r;",
    "  float d = m.a * (0.42 + 0.78 * n1) * (0.55 + 0.7 * n2);",
    "  float alpha = smoothstep(uErode, uErode + 0.30, d) * uOpacity;",
    "  if (alpha <= 0.004) discard;",
    "  float life = clamp(uLife + uCool * m.g * 0.55, 0.02, 0.98);",
    "  vec3 c = texture2D(uLut, vec2(life, 0.5)).rgb;",
    "  float roil = clamp(n1 * 0.62 + n2 * 0.38, 0.0, 1.0);",
    "  c *= 0.58 + 0.78 * roil;",
    "  c *= 1.0 - 0.28 * m.g;",
    "  c *= 0.72 + uGlow * m.r * (0.6 + 0.7 * n1);",
    "  gl_FragColor = vec4(c, alpha);",
    TAIL_FOG,
    "}",
  ].join("\n");

  /* ============================================================
     THE MESH POOL — built ONCE at load, parked invisible, reused by every
     detonation for the life of the session. Nothing here is ever disposed
     (they are session-lifetime shared resources, exactly like crashfx's
     chunkGeo/chunkMat), and every object carries userData so core/batch.js
     can never swallow it into a merged buffer.
     ============================================================ */
  const POOL = {
    shell: null, dome: null, bills: [], wdome: null, imp: null,
    capVol: null, stemVol: null, surgeVol: null, hotVol: null,
    crownVol: null, glowVol: null,
  };
  const MAX_BILLS = 5;
  /* THE CROWN AND THE COLLAR SHARE ONE MESH, and that is the whole reason
     this redraw costs three draw calls and not four. Both are the same
     material — cold, dark, smooth cauliflower — so they are two SLICES
     of one instanced field: [0, CROWN_N) boil over the cap's top, [CROWN_N,
     crown) hang under its rim as the skirt. One buffer, one upload, one
     draw, and a budget cut decimates both together. */
  // A few real 3D lobes establish macro-volume; procedural roughness supplies
  // the small scale. The former 134 giant transparent cards spent fill-rate on
  // repeated flat detail. These 80 depth-writing instances spend geometry once
  // and then let the depth buffer reject hidden cloud surfaces.
  const VOL_MAX = { cap: 18, stem: 10, surge: 20, hot: 10, crown: 14, glow: 8 };
  const CROWN_N = 8;                        // of VOL_MAX.crown; the rest is collar
  const VOL_SEED = { cap: [], stem: [], surge: [], hot: [], crown: [], glow: [] };

  // One deterministic layout, reused by every detonation. The instances move
  // and swell, but never allocate. A 3D lobe cloud remains a mushroom from the
  // B-2's steep camera angle; a camera-facing cap quad becomes a flat disc.
  function seedVolumes() {
    if (VOL_SEED.cap.length) return;
    /* CAP. `r` is drawn AREA-UNIFORM (sqrt of a uniform), which already puts
       more lobes per unit radius out at the rim than at the crown. What was
       missing is the other half of the owner's note — "a real cap's lumps
       are BIG AND FEW near the crown, SMALL AND DENSE at the rim" — so `s2`
       makes lobe RADIUS fall with distance from the axis:

           s2 = (0.34 - 0.20*r^1.4) * jitter

       0.34 at the crown down to 0.178 at r = 0.86: the crown's lumps are
       about twice the rim's, on top of the rim already carrying more of
       them. That distribution, not any shader, is what makes a silhouette
       read as cauliflower rather than as a fuzzy disc.
       `y2` is the vertical station in units of the cap's own half-THICKNESS,
       and it is multiplied at draw time by the LENS profile sqrt(1-r^2), so
       the head is deep through the middle and tapers to the rim — the shape
       a vortex ring actually takes. `s`/`y` are kept verbatim for the
       flag-off path. */
    for (let i = 0; i < VOL_MAX.cap; i++) {
      const a = i ? (i * 2.399963 + rng() * 0.24) : 0; // golden-angle, no spokes
      const rr = i ? Math.sqrt(rng()) * 0.86 : 0;
      VOL_SEED.cap.push({
        a: a, r: rr,
        y: i ? (rng() - 0.42) * 0.48 : 0.08,
        s: i ? 0.16 + rng() * 0.12 : 0.34,
        spin: (rng() - 0.5) * 0.28,
        s2: (0.34 - 0.20 * Math.pow(rr, 1.4)) * (0.82 + rng() * 0.36),
        y2: i ? (rng() * 1.7 - 0.85) : 0.10,
      });
    }
    /* STEM. The old seeds put every lobe within 0.36 of the column radius —
       a thin core inside a wide declared stem, which is why it read as a
       smooth chimney. `r2` fills the column out to its edge and `s2` makes
       the lumps big enough to overlap, and `tw` is the per-lobe twist jitter
       on top of the shared helix (see STEM_TURNS in the stem block). */
    for (let i = 0; i < VOL_MAX.stem; i++) {
      VOL_SEED.stem.push({
        f: (i + 0.45) / VOL_MAX.stem,
        a: i * 2.399963 + rng() * 0.35,
        r: 0.08 + rng() * 0.28,
        s: 0.78 + rng() * 0.42,
        r2: 0.22 + Math.sqrt(rng()) * 0.72,
        s2: 0.34 + rng() * 0.26,
        tw: (rng() - 0.5) * 0.8,
      });
    }
    for (let i = 0; i < VOL_MAX.surge; i++) {
      VOL_SEED.surge.push({
        a: i * 2.399963 + rng() * 0.42,
        r: Math.sqrt((i + 0.6) / VOL_MAX.surge) * (0.82 + rng() * 0.18),
        s: 0.70 + rng() * 0.55,
      });
    }
    for (let i = 0; i < VOL_MAX.hot; i++) {
      const a = i * 2.399963 + rng() * 0.3;
      VOL_SEED.hot.push({
        a: a, r: 0.18 + Math.sqrt(rng()) * 0.72,
        y: (rng() - 0.35) * 0.9,
        s: 0.14 + rng() * 0.12,
      });
    }
    /* CROWN then COLLAR, in ONE seed array (see VOL_MAX's note).
       CROWN: lobes riding the cap's UPPER surface. `r` is the normalised
       distance from the axis and the height is the cap's own dome profile
       sqrt(1 - r^2), so the crown genuinely sits ON the cap instead of
       floating in a plane above it — that curvature is what makes it read as
       boiling over rather than as a hat.
       COLLAR: a ring UNDER the rim, deliberately at 0.70..0.98 of the cap
       radius and BELOW its centre. That is the overhang: a real cloud's cap
       is wider than the top of its stem and the skirt is what says so. */
    for (let i = 0; i < VOL_MAX.crown; i++) {
      if (i < CROWN_N) {
        const r = Math.sqrt((i + 0.35) / CROWN_N) * 0.92;
        VOL_SEED.crown.push({
          crown: true, a: i * 2.399963 + rng() * 0.3, r: r,
          y: Math.sqrt(Math.max(0, 1 - r * r)),
          s: 0.15 + rng() * 0.13, spin: (rng() - 0.5) * 0.22,
        });
      } else {
        const k = (i - CROWN_N + 0.5) / (VOL_MAX.crown - CROWN_N);
        VOL_SEED.crown.push({
          crown: false, a: k * 6.2832 + rng() * 0.5, r: 0.70 + rng() * 0.28,
          y: -(0.30 + rng() * 0.26),
          s: 0.17 + rng() * 0.12, spin: (rng() - 0.5) * 0.16,
        });
      }
    }
    // GLOW: the incandescent core INSIDE the cap. Tight to the axis (r <=
    // 0.62) so the cap's own lobes always cover it — a glow that reaches the
    // silhouette stops being "lit from within" and becomes a second fireball.
    for (let i = 0; i < VOL_MAX.glow; i++) {
      VOL_SEED.glow.push({
        a: i * 2.399963 + rng() * 0.4,
        r: Math.sqrt(rng()) * 0.62,
        y: (rng() - 0.45) * 0.55,
        s: 0.22 + rng() * 0.16,
      });
    }
  }

  function park(mesh, order) {
    mesh.visible = false;
    mesh.frustumCulled = false;
    mesh.renderOrder = order;
    mesh.matrixAutoUpdate = true;
    mesh.userData.nukefx = true;          // batch.js spares anything with userData
    scene.add(mesh);
    return mesh;
  }

  function buildPool() {
    TEX.cloud = makeCloudTexture();
    TEX.noise = makeNoiseTexture();
    TEX.lut = makeLutTexture();
    const blastAssets = CBZ.cityBlastPuffAssets ? CBZ.cityBlastPuffAssets() : null;
    TEX.blastFlame = blastAssets ? blastAssets.flame : TEX.cloud;
    TEX.blastSmoke = blastAssets ? blastAssets.smoke : TEX.cloud;
    TEX.mushEarly = makeMushroomTexture(0);
    TEX.mushForm = makeMushroomTexture(1);
    TEX.mush = makeMushroomTexture(2);

    const sphereGeo = new THREE.IcosahedronGeometry(1, 2);   // 320 tris — a rim needs no more
    sphereGeo._shared = true;
    // Macrostructure must have real parallax and self-occlusion at nuclear
    // scale. Start from a modest icosphere and bake deterministic multi-frequency
    // displacement into its surface; rotation/anisotropic instance scale then
    // keep the shared mesh from reading as repeated balls.
    const billowGeo = new THREE.IcosahedronGeometry(1, 2);
    const bp = billowGeo.attributes.position;
    for (let bi = 0; bi < bp.count; bi++) {
      const bx = bp.getX(bi), by = bp.getY(bi), bz = bp.getZ(bi);
      const rough = 1 + 0.10 * Math.sin(bx * 7.1 + by * 3.7) * Math.sin(bz * 8.3 - by * 4.1)
        + 0.055 * Math.sin((bx + bz) * 13.7 + by * 9.2);
      bp.setXYZ(bi, bx * rough, by * rough, bz * rough);
    }
    bp.needsUpdate = true;
    billowGeo.computeVertexNormals();
    billowGeo._shared = true;
    const quadGeo = new THREE.PlaneGeometry(1, 1);
    quadGeo._shared = true;

    /* RENDER ORDER. The filled ground cloud is first, then the opaque-ish
       volumetric stem/cap, then surface-detail billboards, then the hot volume
       and fireball core, and finally the condensation shell.

       THE VEIL IS ABOVE THE FIREBALL ON PURPOSE (9 vs 8), and that one number
       is what makes the double flash real in the WORLD rather than only on the
       DOM overlay. The fireball is ADDITIVE: nothing can ever hide it by being
       "in front" in depth, because additive has no behind. The only way the
       shock front can swallow its own fireball — which is the entire physical
       cause of the minimum — is to be painted after it. It used to be painted
       before it (7), so the "condensation dome" could only ever ADD light to
       the thing it is supposed to be extinguishing. */
    const shellMat = makeShellMat(true);
    POOL.shell = park(new THREE.Mesh(sphereGeo, shellMat), 8);

    const domeMat = makeShellMat(false);
    domeMat.uniforms.uRimColor.value.set(0xffffff);
    domeMat.uniforms.uCoreColor.value.set(0xdfe8f2);
    domeMat.uniforms.uRimPow.value = 2.6;
    domeMat.uniforms.uCore.value = 0.06;
    POOL.dome = park(new THREE.Mesh(sphereGeo, domeMat), 9);

    seedVolumes();
    function volumeMat(color, emissive, opacity) {
      const m = new THREE.MeshLambertMaterial({
        color: color, emissive: emissive, emissiveIntensity: 1,
        transparent: true, opacity: opacity, depthWrite: true,
        depthTest: true,
        // fog:false under NUKE_FX_FOGPROOF — the cloud stands above the haze
        // layer; scene fog erased it completely past ~5 km (see the flag).
        fog: !CBZ.CONFIG.NUKE_FX_FOGPROOF,
        side: THREE.FrontSide, flatShading: false,
      });
      // NUKE_FX_SOFT_LOBES: alpha falls off toward each lobe's silhouette
      // (view-space fresnel), so the billow reads as participating smoke
      // instead of a lit rock. The 0.16 floor keeps the depth-written rim
      // from punching fully transparent holes in lobes behind it.
      if (CBZ.CONFIG.NUKE_FX_SOFT_LOBES) {
        m.onBeforeCompile = function (shader) {
          shader.vertexShader = shader.vertexShader
            .replace("#include <common>",
              "#include <common>\nvarying vec3 vSoftN;\nvarying vec3 vSoftV;\nvarying vec3 vSoftW;")
            .replace("#include <defaultnormal_vertex>",
              "#include <defaultnormal_vertex>\nvSoftN = transformedNormal;")
            .replace("#include <project_vertex>",
              "#include <project_vertex>\nvSoftV = -mvPosition.xyz;\n" +
              "vSoftW = (modelMatrix * (\n" +
              "#ifdef USE_INSTANCING\n instanceMatrix *\n#endif\n" +
              " vec4(transformed, 1.0))).xyz;");
          shader.fragmentShader = shader.fragmentShader
            .replace("#include <common>",
              "#include <common>\nvarying vec3 vSoftN;\nvarying vec3 vSoftV;\nvarying vec3 vSoftW;")
            .replace("#include <dithering_fragment>",
              // Rim: dissolve at each lobe's silhouette like a gradient puff.
              "float softRim = abs(dot(normalize(vSoftN), normalize(vSoftV)));\n" +
              // Interior: two octaves of world-space value noise. A uniformly
              // lit ball reads as a pebble whatever its edge does; smoke has
              // internal density structure. Frequencies give ~120-500 m
              // billow mottling at nuke scale and animate slowly upward.
              "float softN1 = sin(vSoftW.x * 0.0093 + vSoftW.y * 0.0141) * sin(vSoftW.z * 0.0117 - vSoftW.y * 0.0089);\n" +
              "float softN2 = sin(vSoftW.x * 0.0261 - vSoftW.y * 0.0198) * sin(vSoftW.z * 0.0233 + vSoftW.x * 0.0172);\n" +
              "float softNoise = 0.5 + 0.32 * softN1 + 0.18 * softN2;\n" +
              "gl_FragColor.rgb *= 0.78 + 0.44 * softNoise;\n" +
              "gl_FragColor.a *= (0.22 + 0.78 * smoothstep(0.05, 0.85, softRim)) * (0.66 + 0.50 * softNoise);\n" +
              "#include <dithering_fragment>");
        };
      }
      m._shared = true;
      return m;
    }
    function volumeMesh(name, count, material, order) {
      const mesh = new THREE.InstancedMesh(billowGeo, material, count);
      mesh.name = "nuke-" + name;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      return park(mesh, order);
    }
    POOL.surgeVol = volumeMesh("ground-cloud", VOL_MAX.surge,
      volumeMat(0x746154, 0x1b0d07, 0.82), 4);
    POOL.stemVol = volumeMesh("stem", VOL_MAX.stem,
      volumeMat(0x4b3a31, 0x24110a, 0.90), 5.1);
    POOL.capVol = volumeMesh("cap", VOL_MAX.cap,
      volumeMat(0x5b4030, 0x301208, 0.88), 5.2);
    const hotMat = new THREE.MeshBasicMaterial({
      color: 0xff8a20, transparent: true, opacity: 0,
      depthWrite: false, depthTest: true, fog: !CBZ.CONFIG.NUKE_FX_FOGPROOF,
      side: THREE.FrontSide, blending: THREE.AdditiveBlending,
    });
    hotMat._shared = true;
    POOL.hotVol = volumeMesh("hot-billows", VOL_MAX.hot, hotMat, 7);

    /* ---- THE CROWN + COLLAR: cold, dark, soft cauliflower -----------------
       Soft smoke masks, drawn at renderOrder 5.3 — i.e. immediately
       AFTER the cap (5.2) so a crown lobe sitting on the cap's shoulder wins
       the depth tie, and BEFORE the surface billboards (5) can... no: 5.3 is
       after 5.2 and after 5, which is the order the silhouette needs. There
       is deliberately no emissive floor: the whole point of the crown is
       that it is the part of the cloud that has already gone COLD, and it is
       what the incandescent glow underneath is contrasted against. */
    POOL.crownVol = volumeMesh("cap-crown", VOL_MAX.crown,
      volumeMat(0x3b3129, 0x150803, 0.92), 5.3);
    /* ---- THE CAP GLOW: incandescent, additive, inside the cap ------------
       MeshBasic (never lit — it IS the light), additive so it brightens the
       cap lobes it shines through rather than replacing them, and depthTest
       ON so the cap's own front lobes still occlude it. That combination is
       what reads as "glowing from within" instead of "a hot ball parked in
       front of a cloud". Retired by ~11 s, long before the cloud is. */
    const glowMat = new THREE.MeshBasicMaterial({
      color: 0xffd27a, transparent: true, opacity: 0,
      depthWrite: false, depthTest: true, fog: !CBZ.CONFIG.NUKE_FX_FOGPROOF,
      side: THREE.FrontSide, blending: THREE.AdditiveBlending,
    });
    glowMat._shared = true;
    POOL.glowVol = volumeMesh("cap-glow", VOL_MAX.glow, glowMat, 5.25);

    /* ---- THE WHITE DOME — the first second, and the single biggest thing
       missing from this sequence.

       It is a HEMISPHERE, unlit, un-fogged, opaque white, and it is drawn
       ABOVE everything else in the sequence (renderOrder 11) because for
       that first second there IS nothing else: the reference plate has no
       detail inside the dome at all, only a solid light with a soft halo.

       WHY fog:false. Every other layer here mixes toward scene.fog so it
       sits in the same haze the city does. This one must not: it is the
       BRIGHTEST OBJECT IN THE WORLD, and fogging it would tint a pure white
       light source toward the colour of the air in front of it — which is
       backwards, because at that moment the air in front of it is being lit
       BY it. (The atmosphere drive handles that half.)

       WHY NormalBlending and not additive. Additive has no "behind", so an
       additive dome would let the skyline show straight through the thing
       that is supposed to be silhouetting it. depthWrite is still off, and
       depthTest is on, so buildings IN FRONT correctly occlude it — which is
       exactly the plate: a black skyline against a white dome.

       WHY DoubleSide. The player can be inside its radius. At 126 m and a
       R_PLAYER of 160 m that is a common death, and a single-sided dome
       would vanish at the one moment it should be the whole screen. */
    const hemiGeo = new THREE.SphereGeometry(1, 30, 15, 0, Math.PI * 2, 0, Math.PI * 0.5);
    hemiGeo._shared = true;
    const wdMat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0,
      depthWrite: false, depthTest: true, fog: false,
      side: THREE.DoubleSide, blending: THREE.NormalBlending,
    });
    wdMat._shared = true;
    POOL.wdome = park(new THREE.Mesh(hemiGeo, wdMat), 11);

    for (let i = 0; i < MAX_BILLS; i++) {
      const mat = new THREE.ShaderMaterial({
        uniforms: FOG_U({
          uMask: { value: TEX.cloud }, uNoise: { value: TEX.noise }, uLut: { value: TEX.lut },
          uScroll: { value: new THREE.Vector2(0, 0) },
          uScroll2: { value: new THREE.Vector2(0, 0) },
          uLife: { value: 0.3 }, uOpacity: { value: 0 }, uErode: { value: 0.18 }, uGlow: { value: 0.5 },
          uCool: { value: 0 },              // 0 => byte-identical to before
        }),
        vertexShader: BILL_VS, fragmentShader: BILL_FS,
        transparent: true, depthWrite: false, depthTest: true,
        fog: true,
        side: THREE.DoubleSide, blending: THREE.NormalBlending,
      });
      mat._shared = true;
      POOL.bills.push(park(new THREE.Mesh(quadGeo, mat), 5));
    }

    /* ---- LEGACY FAR-TIER IMPOSTOR. One quad, one baked mushroom, one draw
       call for a ten-kilometre cloud. It is NOT part of the coherent default;
       on the explicit fallback path it is not an extra layer on top of the
       3D cloud — it REPLACES it (they cross-fade on whether the 3D cap still
       fits inside the frustum, see impostorMix), so the peak draw count does
       not move.
         fog:false  it is behind the fog, not in it. This also gives it its
                    own shader permutation, which is exactly why it is minted
                    here at load and parked for core/fxwarm.
         renderOrder 4.5 — UNDER every 3D cloud layer, so during the
                    cross-fade the near geometry always paints over it, and
                    the depth test at 860 m lets real world geometry occlude
                    it while the 3D stem in front of it wins on depth. The
                    depth buffer composites the two tiers for free. */
    const impMat = new THREE.ShaderMaterial({
      uniforms: FOG_U({
        uMask: { value: TEX.mushEarly },
        uMaskB: { value: TEX.mushForm },
        uMaskC: { value: TEX.mush },
        uNoise: { value: TEX.noise }, uLut: { value: TEX.lut },
        uScroll: { value: new THREE.Vector2(0, 0) },
        uScroll2: { value: new THREE.Vector2(0, 0) },
        uLife: { value: 0.12 }, uOpacity: { value: 0 }, uErode: { value: 0.10 },
        uGlow: { value: 1.55 },             // the core must overdrive into white
        uCool: { value: 1 },                // ...and the crown/dust must not
        uPhase: { value: 0 },
      }),
      vertexShader: BILL_VS, fragmentShader: IMP_FS,
      transparent: true, depthWrite: false, depthTest: true,
      fog: false,
      side: THREE.DoubleSide, blending: THREE.NormalBlending,
    });
    impMat._shared = true;
    POOL.imp = park(new THREE.Mesh(quadGeo, impMat), 4.5);
  }

  /* ============================================================
     THE WHITEOUT — the single cheapest, biggest beat there is: one composited
     DOM layer, zero GL fill, never dropped at any quality tier. It REUSES
     city/strategic.js's #nukeFlash element rather than adding a second sheet,
     so the two can never stack, and it is exported as CBZ.cityNukeWhiteout so
     strategic.js (and anything else) can drop its private copy.

     THE DOUBLE FLASH. A nuclear detonation does not flash once — it flashes,
     then the expanding shock front goes OPAQUE and swallows its own fireball
     (the "minimum"), then the fireball burns back through it in a second,
     longer, brighter thermal pulse. It is the single most recognisable thing
     about the event, it is the reason bhangmeters can count warheads, and here
     it costs one extra keyframe on a DOM div — no GL fill at all.

     Driven per-frame off the same onAlways ticker rather than a CSS transition
     because a transition can only interpolate between TWO values; a chain of
     nested rAF handoffs to fake more would be four timers we do not control
     and cannot cancel on a run reset. `keys` are normalised 0..1 of the total
     fade so one table serves any duration. */
  /* THE THERMAL PULSE. ONE table, THREE consumers.

     This curve is not just the DOM div's keyframes: it is the radiance of the
     event, and the div, the fireball's own brightness and the sky tint all read
     it through keyAt()/flashRadiance(). That is deliberate and it is the
     correction that mattered most in this file. Before, the dip lived ONLY on
     the overlay — the 3D fireball ramped up monotonically underneath it — so
     the most recognisable signature a nuclear weapon has was a property of a
     white rectangle rather than of the explosion. If the div dips and the world
     does not, the eye reads a UI glitch.

     Shape, against Glasstone & Dolan fig. 2.39: a first maximum reached in
     under a millisecond, a minimum as the shock front becomes opaque and
     swallows the fireball, then a second maximum that is broader and carries
     ~99% of the thermal energy. Normalised 0..1 of the total fade, so one table
     serves any duration.

     THE COMPRESSION IS DELIBERATE AND IT IS THE ONLY LIBERTY TAKEN. The real
     minimum is ~1 ms for a small device and tens of ms for a large one. At
     2.9 s of fade the honest normalised position of a 30 ms dip is 0.010, which
     is a single frame at 60 Hz and reads as a dropped frame, not as a weapon.
     The dip is held at 0.062..0.105 (about 180-305 ms absolute) so it is
     ~7 frames of genuinely dark before the second pulse — long enough to SEE
     the shock front standing in front of the fireball, which is the whole
     point. Everything else keeps the spec's proportions: the second maximum is
     brighter than the first is at the same age, and its tail is ~4x longer than
     the first pulse's. */
  const FLASH_DOUBLE = [
    [0.000, 1.00],   // FIRST MAXIMUM: instantaneous, total
    [0.028, 0.78],   // the isothermal ball is already being overtaken
    [0.062, 0.09],   // THE MINIMUM — the shock front has gone opaque
    [0.105, 0.12],   // ...and it HOLDS. Films never draw this and it is the beat.
    [0.185, 1.00],   // SECOND MAXIMUM: slower to build, brighter, far longer
    [0.400, 0.82],
    [0.680, 0.40],
    [1.000, 0.00],
  ];
  const FLASH_SINGLE = [[0.0, 1.0], [0.22, 0.45], [1.0, 0.0]];

  // Sample any of the tables above at normalised age u. Shared by stepFlash
  // (the div) and flashRadiance (the world).
  function keyAt(keys, u) {
    u = clamp(u, 0, 1);
    for (let i = 1; i < keys.length; i++) {
      if (u <= keys[i][0]) {
        const a = keys[i - 1], b = keys[i];
        return a[1] + (b[1] - a[1]) * ((u - a[0]) / (b[0] - a[0] || 1));
      }
    }
    return 0;
  }

  /* flashRadiance(t, P) — the pulse as a MULTIPLIER for a world layer.

     Returns exactly 1.0 once the pulse window is over, so any layer can
     multiply it in without also handing this function control of that layer's
     own fade. (A naive `layer *= pulse` would delete the fireball at t=white,
     because the pulse table ends at zero.) The pulse's authority decays
     linearly across the first 72% of the fade; past that the layer's own
     envelope owns it completely. */
  function flashRadiance(t, P) {
    if (!CBZ.CONFIG.NUKE_FX_PULSE || !P.dbl) return 1;
    const w = P.white * 0.72;
    if (t >= w || w <= 0) return 1;
    return 1 - (1 - t / w) * (1 - keyAt(FLASH_DOUBLE, t / P.white)) * 0.90;
  }

  let flashEl = null, flash = null;
  function flashDiv() {
    if (typeof document === "undefined" || !document.body) return null;
    if (flashEl && flashEl.parentNode) return flashEl;
    flashEl = document.getElementById("nukeFlash");
    if (!flashEl) {
      flashEl = document.createElement("div");
      flashEl.id = "nukeFlash";
      // z-index 80: over the HUD, under the pause/menu layers (115+).
      flashEl.style.cssText = "position:fixed;inset:0;background:#fff;opacity:0;pointer-events:none;z-index:80";
      document.body.appendChild(flashEl);
    }
    // city/strategic.js's degrade-path copy bakes a 2.8s transition into the
    // same element's inline style. We drive opacity per frame, so kill it.
    flashEl.style.transition = "none";
    return flashEl;
  }
  // whiteout(fadeSec, peak, double) — `double` opts into the shock-front dip.
  function whiteout(fadeSec, peak, dbl) {
    const el = flashDiv();
    if (!el) return;
    const dur = Math.max(0.12, fadeSec == null ? 2.8 : +fadeSec || 0.12);
    const pk = peak == null ? 1 : clamp(+peak || 0, 0, 1);
    // A weaker flash never interrupts a stronger one already running.
    if (flash && flash.peak > pk && flash.t < flash.dur * 0.5) return;
    flash = { t: 0, dur: dur, peak: pk, keys: dbl ? FLASH_DOUBLE : FLASH_SINGLE };
    try { el.style.opacity = String(pk); } catch (e) {}
  }
  function stepFlash(dt) {
    const f = flash;
    f.t += dt;
    const el = flashDiv();
    const u = clamp(f.t / f.dur, 0, 1);
    const v = keyAt(f.keys, u);
    if (el) { try { el.style.opacity = v <= 0.002 ? "0" : (v * f.peak).toFixed(3); } catch (e) {} }
    if (u >= 1) flash = null;
  }
  function flashClear() {
    flash = null;
    const el = flashEl;
    if (el) { try { el.style.transition = "none"; el.style.opacity = "0"; } catch (e) {} }
  }
  CBZ.cityNukeWhiteout = whiteout;

  /* ============================================================
     STYLE ROWS — the ONLY difference between a nuke and a MOAB. Everything
     dimensional is derived from the ordnance ROW (radius / wave), so the
     spectacle and the damage model can never drift apart.
     ============================================================ */
  /* THE ONE NUMBER EVERYTHING HANGS OFF — and the bug that made this whole
     file draw a bonfire instead of a nuke.

     systems/impactbus.js states the trap explicitly at its `radius` field:
     "the legacy blast API multiplies radius BY power internally (crashfx.js:
     R = radius*power) ... the effective near-field radius of a row is
     radius*power, NOT radius", and the nuke row's own comment reads
     "radius*power = 126m of instantly-vaporised fireball".

     Every dimension below used to be derived from `row.radius` alone — 14 for
     the nuke — which produced a 7 m fireball under a mushroom cloud 20 m tall
     and 18 m wide, while the actual damage zone rolled hundreds of metres out.
     fireR() is the honest number, and it is the ONLY place the conversion
     lives so it cannot drift again. `opts.scale` is already the bus's
     kinetic FX multiplier (cube-root of energy), so multiplying it in here is
     what keeps the spectacle proportional to how hard the thing arrived. */
  function fireR(row, opts) {
    const pw = Math.max(0.1, +row.power || 1);
    const rr = Math.max(1, +row.radius || 14);
    const sc = (opts && opts.scale > 0) ? +opts.scale : 1;
    return Math.max(8, rr * pw * sc);
  }

  /* ============================================================
     THE PHYSICAL MODEL — ONE yield, and every dimension solved from it.

     OWNER: "make them REAL TO SIZE ... the amount of DEATH in the radius
     should also be REAL based on the research — the percentage — and the
     BUILDING DAMAGE."

     THE YIELD IS NOT TYPED, IT IS INVERTED OUT OF THE BUS ROW. The published
     maximum-fireball relation for an air burst is

         R_fireball = 50 * W^(1/3)  metres,  W in kilotons

     and systems/impactbus.js's nuke row already fixes R at radius*power =
     14*9 = 126 m (its own comment says so, and cites the same relation). So

         W = (R / 50)^3 = (126 / 50)^3 = 2.52^3 = 16.0 kt

     — a HIROSHIMA-CLASS device (Little Boy is best-estimated at 15 kt), and
     that is a gift, because Hiroshima is the most thoroughly measured
     nuclear casualty dataset that exists. Every ring below is therefore
     sourced rather than invented, and (16/15)^(1/3) = 1.022 means the
     Hiroshima distances transfer to this device essentially one-to-one.

     BECAUSE IT IS INVERTED, THE SPECTACLE AND THE DAMAGE CAN NEVER DRIFT.
     Change the row's power or radius and the yield, the cloud, the rings and
     the casualty fractions all move together. Nothing here is a constant
     that has to be remembered.
     ============================================================ */
  // W = (R/50)^3, the inverse of the maximum-fireball relation.
  function yieldKt(R) { return Math.pow(Math.max(1, R) / 50, 3); }
  // cube-root scaling factor against the 1 kt references below
  function cubeRt(W) { return Math.pow(Math.max(0.001, W), 1 / 3); }

  /* ---- THE CLOUD, AT TRUE SIZE ------------------------------------------
     Glasstone & Dolan's stabilised-cloud figures for a 20 kt surface burst
     (their cloud-height/yield curves, Fig. 2.16 and the accompanying table):
        cloud TOP        ~10.7 km      cloud BOTTOM (cap base)  ~6.4 km
        cap thickness    ~4.3 km       cap DIAMETER             ~5.5 km
     At 16 kt those come down by (16/20)^(1/3) = 0.928 on the width terms;
     cloud HEIGHT scales far more weakly than W^(1/3) because the tropopause
     (~11 km at mid latitudes) is a hard ceiling — everything going up goes
     sideways instead — so the top is held at 10 km rather than scaled.

     THE STEM IS THE OWNER'S RATIO AND IT IS RIGHT FOR THIS PHASE. He is
     looking at the classic tower shot — the cloud at tens of seconds, not
     the ten-minute stabilised cloud — and at that age the convective column
     is FAT: "roughly as wide as ~1/3 the cap". A stabilised cloud's stem is
     thinner (1/5 to 1/6), and drawing that would be a different photograph.
     This whole sequence is 34 s long, so the tower shot is the correct
     reference and the stem is capDiameter/3.

     THE DUST BASE is the ground-shock skirt: Crossroads Baker's base surge
     (23 kt) reached ~1 km radius by a minute, and a land surface burst's
     skirt tracks the 2 psi contour early on, which for this yield is
     2,016 m (see RINGS). That is what the reference photograph's broad dark
     spreading foot is, and it is wider than the stem by design.           */
  const CLOUD_TOP_M = 10000;     // m — tropopause-limited, not W^(1/3)-scaled
  const CAP_DIA_20KT = 5500;     // m — Glasstone's 20 kt stabilised cap
  const CAP_THICK_20KT = 4300;   // m
  const STEM_OF_CAP = 1 / 3;     // owner's reference photograph
  function nukeDims(R) {
    const W = yieldKt(R);
    const k = Math.pow(W / 20, 1 / 3);          // width terms scale as W^(1/3)
    const capW = CAP_DIA_20KT * k;              // 16 kt -> 5,104 m
    const capH = CAP_THICK_20KT * k;            // 16 kt -> 3,990 m
    const top = CLOUD_TOP_M;                    // tropopause ceiling
    return {
      W: W,
      fireball: R,                              // 126 m
      capW: capW,
      capH: capH,
      // the cap's CENTRE sits half its own thickness below the cloud top
      capY: top - capH * 0.5,                   // 16 kt -> 8,005 m
      top: top,
      stemW: capW * STEM_OF_CAP,                // 16 kt -> 1,701 m
      base: RING_1KT.p2 * cubeRt(W),            // dust base radius = the 2 psi contour
    };
  }

  /* WHAT CAN FORM DURING THIS 34-SECOND SEQUENCE. nukeDims is the researched
     mature cloud (minutes old, kilometres tall) and remains the public physics
     model. Drawing that mature object one second after the dome forced the old
     path to flatten it onto a sky card. This is the visible young cloud: still
     enormous beside the city, inside the 1 km frustum, and in the same 3:1
     cap/stem proportion. It grows toward the mature dimensions after this
     sequence ends; it does not pretend to have reached them already. */
  function formationDims(R) {
    if (!CBZ.CONFIG.NUKE_FX_BIG_FORMATION) {
      // first-draft numbers, kept verbatim as the one-line revert
      const capW0 = R * 3.6;
      const capH0 = capW0 * 0.78;
      const capY0 = R * 5.2;
      return {
        capW: capW0, capH: capH0, capY: capY0,
        top: capY0 + capH0 * 0.5 * CAP_FLAT,
        stemW: capW0 * STEM_OF_CAP,
        base: R * 4.0,
      };
    }
    /* Anchored to the frame record, not taste: Trinity (21 kt) reads ~3.3 km
       to the cloud top at ~25 s in Mack's published sequence, and the
       Nagasaki column is ~3-4 km tall inside the first minute. Scaled by
       W^(1/3) to this file's 16 kt that is a ~3.0 km top at the end of the
       26 s rise window. With R = 126 m:
         capY = R*20.0 -> 2,520 m cap centre; top ~= 3.1 km  (was R*5.2 = 655 m)
         capW = R*11.0 -> 1,386 m, xBLOOM_MAX -> ~1.95 km wide at t=34 s
                                                              (was R*3.6 = 454 m)
       The draft numbers made a 34-second, 16 kt cloud the size of a stadium
       roof — honest YOUTH, dishonest SCALE. The handoff-youth contract in
       tools/test-nukefx-phases.mjs still holds because the rise/bloom curves
       start near zero: at t=1.47 s this cap is ~110 m wide and ~120 m up. */
    const capW = R * 11.0;
    const capH = capW * 0.78;
    const capY = R * 20.0;
    return {
      capW: capW, capH: capH, capY: capY,
      top: capY + capH * 0.5 * CAP_FLAT,
      stemW: capW * STEM_OF_CAP,
      base: R * 4.0,
    };
  }

  /* ---- THE RINGS ---------------------------------------------------------
     TWO LADDERS, because they are two different physics and they must not be
     collapsed into one "blast radius":

     (1) OVERPRESSURE -> BUILDINGS. Glasstone & Dolan's 1 kt surface-burst
         reference radii, scaled by W^(1/3) = 2.520 at 16 kt:

           psi   1 kt      x2.520     what it does to a building
           20    200 m     504 m      total destruction; even reinforced
                                      concrete is gutted to its frame
           10    300 m     756 m      heavy structural failure
            5    440 m   1,109 m      MOST ORDINARY BUILDINGS COLLAPSE
                                      (the classic "destruction radius")
            2    800 m   2,016 m      roofs and walls out, wood frames down,
                                      what is left is burning
            1  1,300 m   3,276 m      windows across the whole district;
                                      the largest injury source there is

     (2) FATALITY -> PEOPLE. The USSBS survey of Hiroshima (15 kt, burst
         580 m) measured killed/injured/safe by distance from the hypocentre.
         Scaled to 16 kt by (16/15)^(1/3) = 1.0217:

           Hiroshima band   here          killed
           0.0-0.5 km       0-511 m       86.0%
           0.5-1.0 km       511-1,022 m   83.0%
           1.0-1.5 km       1,022-1,533   51.0%
           1.5-2.0 km       1,533-2,043   21.6%
           2.0-2.5 km       2,043-2,554    4.9%
           2.5-3.0 km       2,554-3,065    2.4%
           3.0-4.0 km       3,065-4,087    0.3%

     TWO CAVEATS, stated because leaving them out would be the stale-claim
     problem this file keeps catching itself in:
       * those fractions are for a population largely INDOORS in light
         wood-frame construction with no warning. In the open you fare worse
         close in (thermal) and better further out.
       * Hiroshima was an AIRBURST, which spreads blast further than the
         surface burst both of this game's delivery routes produce. The two
         ladders are therefore kept SEPARATE rather than fused: buildings ride
         the surface-burst overpressure radii, people ride the measured
         fatality curve. Fusing them would have meant inventing a number.

     INSIDE THE FIREBALL IT IS 100%, and that is not a survey figure — it is
     that there is nothing left to survey.                                  */
  const RING_1KT = { p20: 200, p10: 300, p5: 440, p2: 800, p1: 1300 };
  const USSBS = [                                 // [outer km at 15 kt, killed]
    [0.5, 0.860], [1.0, 0.830], [1.5, 0.510], [2.0, 0.216],
    [2.5, 0.049], [3.0, 0.024], [4.0, 0.003], [5.0, 0.000],
  ];
  const HIROSHIMA_KT = 15;
  /* CBZ.nukeRings(R) — the whole event as a table. R is the fireball radius
     (fireR of the bus row); everything else is solved. Exported because
     systems/impactbus.js applies the fatality curve and city/strategic.js
     sizes its cop sweep and radiation zone from the same numbers — one
     source, three consumers, no second table anywhere. */
  function nukeRings(R) {
    const W = yieldKt(R);
    const k = cubeRt(W);
    const hk = Math.pow(W / HIROSHIMA_KT, 1 / 3);   // 16 kt -> 1.0217
    return {
      W: +W.toFixed(2),
      fireball: R,
      psi20: RING_1KT.p20 * k, psi10: RING_1KT.p10 * k,
      psi5: RING_1KT.p5 * k, psi2: RING_1KT.p2 * k, psi1: RING_1KT.p1 * k,
      // the measured fatality curve, in metres for THIS yield
      fatal: USSBS.map(function (b) { return [b[0] * 1000 * hk, b[1]]; }),
      // 500 rem prompt-radiation radius. Prompt gamma+neutron attenuates
      // exponentially in air, so it does NOT scale as W^(1/3): the standard
      // figure for a 20 kt burst is ~1.1 km to 500 rem (a ~50% lethal dose
      // without treatment), and it grows only slowly with yield. Held at
      // 1.1 km * (W/20)^0.2 rather than cube-rooted, which would have made
      // it a blast radius wearing a radiation label.
      rad500: 1100 * Math.pow(W / 20, 0.2),
    };
  }
  /* CBZ.nukeLethalAt(r, R) — the researched probability that an unsheltered
     person at range r is KILLED. Linear between the measured bands, 1.0
     inside the fireball, 0 past the last band. This is the ONE function the
     bus's ring sweep asks; it never re-derives a curve of its own. */
  function nukeLethalAt(r, R) {
    const T = nukeRings(R);
    if (r <= T.fireball) return 1;                 // nothing to survey
    const f = T.fatal;
    let prev = T.fireball, prevV = 1;
    for (let i = 0; i < f.length; i++) {
      if (r <= f[i][0]) {
        const u = (r - prev) / Math.max(1, f[i][0] - prev);
        return Math.max(0, prevV + (f[i][1] - prevV) * u);
      }
      prev = f[i][0]; prevV = f[i][1];
    }
    return 0;
  }
  CBZ.nukeYield = function (R) { return yieldKt(R == null ? 126 : R); };
  CBZ.nukeRings = function (R) { return nukeRings(R == null ? 126 : R); };
  CBZ.nukeLethalAt = function (r, R) { return nukeLethalAt(r, R == null ? 126 : R); };
  CBZ.nukeDims = function (R) { return nukeDims(R == null ? 126 : R); };

  /* PROPORTIONS ARE THE TELL. Everything below is a ratio against the fireball
     radius R, so the whole cloud stays in proportion at any yield, and the
     ratios are the ones test film actually shows rather than the ones films
     draw. Two of them were badly wrong and are the reason the cloud read as a
     bonfire's smoke column:

       CLOUD TOP : CAP WIDTH   was 1.75 : 1   now 2.19 : 1  (riseK 4.60 -> 7.20)
       CAP       : STEM WIDTH  was 6.50 : 1   now 9.82 : 1  (stemK 0.40 -> 0.28)

     A real mushroom is a THIN stalk under a WIDE cap, with a total height far
     greater than the cap is across — a 20 kt cloud stabilises around 12 km with
     a cap 5-6 km across. A squat cloud on a fat stalk is the single most common
     way a game gets this wrong, and this file was doing both. CBZ.nukeFxAudit()
     reports both ratios so they cannot drift back.

     `thermK` is the ONE new number: the ratio of the ignition radius to the
     blast radius. It is not picked — thermal radiant exposure at a given range
     scales as Y^0.41 and a given overpressure radius as Y^0.33, so the ratio of
     the two goes as Y^0.08, which at the yield the bus's nuke row is priced for
     lands at ~1.25. A chemical bomb's thermal pulse does not outrange its own
     blast at all, so the MOAB's is 0 and it has no outer thermal zone. */
  const STYLE = {
    nuke: {
      // OSTI/LLNL's peak visual-fireball estimate is Rmax = 50*W^(1/3) m.
      // The row's 126 m effective radius is already the right answer for the
      // game's ~15 kt event; halving it here was the tiny-fireball bug.
      rFrac: 1.00,
      riseK: 7.20,     // compressed stabilisation altitude (126m ball -> ~907m)
      capK: 2.75, stemK: 0.28, surgeK: 3.4,
      thermK: 1.25,    // ignition radius / blast radius (Y^0.08 — see above)
      riseT: 13, dur: 34, white: 2.9, whitePeak: 1, dbl: true,
      bills: 5, dome: true, volume: true, ash: true,
      secondary: 6, shatter: 4, thermal: 9,
      shake: 9, frontLife: 7.5, glow: 0.85,
    },
    moab: {
      // A MOAB throws a tall, dirty smoke column — genuinely taller relative to
      // its head than this file used to draw (riseK 2.60 -> 4.00) — but it is
      // NOT a mushroom, and it is deliberately left squatter and stubbier than
      // the nuke. The audit knows that and asserts it against chemical
      // thresholds rather than nuclear ones.
      // Its row radius is the pressure/damage near field, not a literal ball of
      // flame. Keep the visible chemical fireball to ~42 m at the 120 m row.
      rFrac: 0.35, riseK: 4.00, capK: 1.85, stemK: 0.30, surgeK: 2.6,
      thermK: 0,
      riseT: 5.6, dur: 13, white: 0.8, whitePeak: 0.82, dbl: false,
      bills: 3, dome: false, volume: true, ash: false,
      secondary: 3, shatter: 1, thermal: 0,
      shake: 4.5, frontLife: 3.4, glow: 0.7,
    },
  };

  /* THE GLASS LADDER, as multiples of the BLAST reach (wave.maxR).

     The physical nuke table lives on impactbus's row, beside its pressure
     reach; this file reads it for audit/reporting and keeps only a fallback
     copy for direct FX use without the bus. By
     overpressure: ~5 psi collapses most buildings and IS maxR; ~2 psi takes
     roofs and walls; ~1 psi shatters windows several times further out again.
     For a real 100 kt airburst those land at roughly 1x / 1.5x / 2.6x maxR, and
     the last rung here is deliberately the widest thing this file touches —
     every pane in the district goes, which is the correct read and also a
     BOUNDED one, because buildings.js's cityShatter caps itself at 50 panes per
     call whatever radius you hand it. A bigger radius costs nothing extra; it
     just stops the breakage being concentrated on the block you were standing on. */
  /* RE-DERIVED 2026-07-28 AGAINST THE RESEARCHED CONTOURS. maxR used to be
     900 m — the COLLAPSE radius wearing the name "reach" — so the ladder ran
     out to 2.10x it to get past the flattening. maxR is now the 1 psi
     contour itself (3,276 m), so the same four passes become fractions of
     it and every rung is a named contour instead of a multiple:

         5 psi  1,109 / 3,276 = 0.339   panes go inside the collapse zone
         2 psi  2,016 / 3,276 = 0.615   the gutted band
         1 psi  3,276 / 3,276 = 1.000   THE glass contour, the biggest single
                                        injury source a city detonation makes
         0.5 psi                 1.250   light breakage beyond it

     The old 2.10 against the new maxR would have been 6,880 m — further than
     a 16 kt burst breaks anything, and the sort of stale multiplier this
     file keeps catching. Under NUKE_REAL_SCALE the ladder is these; with the
     flag off it is the old one, because the old one is right for the old
     maxR and wrong for this one. */
  const GLASS_K = [0.42, 0.85, 1.35, 2.10];
  const GLASS_K_REAL = [0.339, 0.615, 1.000, 1.250];
  /* KEYED ON KIND, NOT JUST ON THE FLAG. The real ladder's rungs are NUCLEAR
     overpressure contours; handing them to the MOAB would have quietly
     narrowed its glass reach from 2.10x to 1.25x its own maxR on the
     strength of research about a completely different weapon. A chemical
     bomb keeps its own ladder. */
  function glassLadder(kind) {
    if (kind === "nuke" && real()) {
      if (CBZ.impact && CBZ.impact.row) {
        try {
          const row = CBZ.impact.row("nuke");
          if (row && row.wave && row.wave.glassK && row.wave.glassK.length) return row.wave.glassK;
        } catch (e) {}
      }
      return GLASS_K_REAL;
    }
    return GLASS_K;
  }

  /* ============================================================
     THE RISE — ONE curve, four readers.

     This used to be `ease((t - 0.9) / riseT)` copy-pasted into the fireball,
     billboards and cap roll: three places that all had to agree about how
     high the cloud was and had no structural reason to. It is now one function,
     and fixing the SHAPE was a one-line change instead of three.

     Smoothstep was the wrong shape twice over. It starts slow (a fireball is
     buoyant from the instant it forms — it does not ease in), and it holds a
     near-constant velocity through the middle (the thing films get wrong). A
     real cloud rises FAST and then DECELERATES hard as it entrains cold air and
     loses buoyancy, then stabilises flat at the tropopause and stops. That is
     an exponential approach, not an S-curve:

         rise(u) = (1 - e^(-K u)) / (1 - e^-K)

     with K = 3.4, which puts ~50% of the height in the first 20% of the window
     and leaves the last 10% of the height taking a third of it. The first 10%
     of the window cross-fades in from a smoothstep purely so there is no
     velocity discontinuity at the start of the beat. Monotonic throughout, 0 at
     u=0 and exactly 1 at u=1, so nothing downstream needs clamping. */
  const RISE_K = 3.4;
  const RISE_E = Math.exp(-RISE_K);
  const PHASED_RISE_T = 26;
  const REAL_RISE_KEYS = [
    [0.00, 0.00], [0.08, 0.06], [0.28, 0.30], [0.58, 0.68], [1.00, 1.00],
  ];
  const REAL_BLOOM_KEYS = [
    [0.00, 0.055], [0.06, 0.16], [0.18, 0.38],
    [0.40, 0.82], [0.70, 1.22], [1.00, BLOOM_MAX],
  ];
  function keyedEase(u, keys) {
    u = clamp(u, 0, 1);
    for (let i = 1; i < keys.length; i++) {
      if (u <= keys[i][0]) {
        const a = keys[i - 1], b = keys[i];
        const p = (u - a[0]) / Math.max(0.0001, b[0] - a[0]);
        return a[1] + (b[1] - a[1]) * ease(p);
      }
    }
    return keys[keys.length - 1][1];
  }
  function riseWindow(L) {
    return L.style === STYLE.nuke && phasedCloud() ? PHASED_RISE_T : L.style.riseT;
  }
  function riseAt(t, L) {
    const u = clamp((t - 0.9) / riseWindow(L), 0, 1);
    if (!CBZ.CONFIG.NUKE_FX_RISE) return ease(u);        // revert: the old S-curve
    // The real-size nuke is a photographed sequence, not a mature object being
    // scaled up. It stays compact through the white-dome handoff, becomes a
    // tower over the next several seconds, then spends the long tail spreading.
    if (L.style === STYLE.nuke && phasedCloud()) return keyedEase(u, REAL_RISE_KEYS);
    const d = (1 - Math.exp(-RISE_K * u)) / (1 - RISE_E);
    const w = clamp(u / 0.10, 0, 1);
    return d * w + ease(u) * (1 - w);
  }
  // Absolute world Y of the cap centre for a given rise. Never a multiply on an
  // absolute Y — L.by already carries the terrain height under ground zero.
  function capYAt(rise, L) { return L.by + L.R * 0.6 + (L.riseH - L.R * 0.6) * rise; }
  /* Lateral bloom. The cap keeps widening AFTER the rise stops — that is the
     anvil spreading out along the stable layer, and a cloud that freezes solid
     the instant it reaches altitude is the other half of the "constant rise"
     tell. The second term is that slow post-stabilisation spread. */
  function bloomAt(t, L) {
    const P = L.style;
    if (P === STYLE.nuke && phasedCloud()) {
      const u = clamp((t - 0.55) / PHASED_RISE_T, 0, 1);
      return keyedEase(u, REAL_BLOOM_KEYS);
    }
    const spread = clamp((t - P.riseT) / Math.max(1, P.dur - P.riseT), 0, 1);
    return 0.35 + 0.9 * ease((t - 1.2) / (P.riseT * 0.85)) + 0.16 * spread;
  }
  function cloudPhaseAt(t, L) {
    if (!(L.style === STYLE.nuke && phasedCloud())) return 1;
    // Early bulb -> forming tower by ~8 s -> mature cap during the long rise.
    return clamp(
      0.5 * ease((t - 1.2) / 6.8) +
      0.5 * ease((t - 7.5) / 16.5),
      0, 1
    );
  }

  /* ============================================================
     THE WHITE DOME — geometry, and it is SOLVED, not eased.

     The early fireball is a strong shock, and a strong shock obeys the
     Taylor-Sedov similarity solution: for energy E into ambient density
     rho0,

         R(t) = S * (E / rho0)^(1/5) * t^(2/5),   S ~= 1.03

     The constant does not matter here — the SHAPE does, and the shape is
     the 2/5 = 0.4 power. That is why a nuclear fireball looks the way it
     does in the first frames and why every eased "grow the sphere" curve
     looks wrong: at t^0.4 the ball is already at 31% of its final radius
     after 5% of the window and at 76% after half of it. A smoothstep is at
     1.4% and 50%. G.I. Taylor famously read Trinity's yield off exactly
     this exponent from the published film frames.

     Anchors this is normalised against:
       R_max  = 50 * W^(1/3) m — the published maximum-fireball relation,
                126 m at the ~15 kt this file's nuke row is priced for
                (already the basis of STYLE.nuke.rFrac; see fireR).
       t_max  the fireball is at its maximum radius within a few tenths of a
                second (Glasstone's second thermal maximum for 15 kt is
                0.0417*W^0.44 = 0.136 s), and a NEAR-SURFACE burst then sits
                on the ground as a hemisphere for roughly the first second
                before buoyancy lifts it clear at ~100 m/s.
     WDOME_T = 1.05 s is that "sits on the ground" second, which is the beat
     the reference plate is a photograph of. The dome then hands over: it
     fades across WDOME_OUT while the additive fireball shell (which has been
     growing behind it the whole time, hidden) is revealed rising. Nothing
     is created or destroyed at the handover — the dome is simply the OPAQUE
     reading of the same ball, and the fireball is the graded one. */
  const WDOME_T = 1.05;        // s — dome reaches full radius / starts to lift
  const WDOME_OUT = 0.42;      // s — the fade that reveals the rising fireball
  const WDOME_P = 0.4;         // the Taylor-Sedov exponent. Do not tune this.
  function wdomeRadius(t, L) {
    return L.R * Math.pow(clamp(t / WDOME_T, 0, 1), WDOME_P);
  }

  /* THE CAP FLATTENS. A young cloud head is a rising ball — taller than it
     is wide. A stabilised one is an ANVIL: the tropopause (~11 km at mid
     latitudes) is a temperature inversion, the cloud cannot climb through
     it, and everything that was going up goes sideways instead. A 20 kt
     cloud tops out near 10-12 km with a cap several kilometres across, and
     it gets there in about five minutes — compressed here into riseT, a
     ~23x speed-up which is the same order of compression the double flash
     takes and is named for the same reason.
     bloomAt already widens the cap. This is the other half: the vertical
     scale walks from 1.0 to CAP_FLAT across the rise, so the head genuinely
     changes SHAPE rather than just growing. */
  const CAP_FLAT = 0.62;
  function capFlatAt(t, L) {
    if (!v2()) return 1;
    return 1 - (1 - CAP_FLAT) * ease((t - 1.4) / Math.max(1, riseWindow(L) * 0.9));
  }

  // Billboard ROLES in priority order. At tier 0 only the first survives, and
  // the cap alone still reads as "a mushroom went up over there".
  const ROLES = ["cap", "stem", "surge", "cap2", "collar"];

  /* ============================================================
     THE SEQUENCE — one live object, one state machine, ONE updater.
     No setTimeouts: every scheduled beat is a row in `pending`, popped by t.
     ============================================================ */
  let live = null;

  function beginSequence(x, y, z, styleName, row, opts) {
    // pool never built (no THREE/scene), or built only partway through a
    // throw — either way the composers degrade to the near field.
    if (!POOL.shell || !POOL.capVol || !POOL.crownVol || !POOL.glowVol) return null;
    const P = STYLE[styleName] || STYLE.nuke;
    const q = q01();
    const gy = floorAt(x, z);
    // Chemical blasts keep their compact RPG-language satellites. A nuke has
    // purpose-built instanced billows; replaying ordinary explosions inside it
    // is both visually wrong and the first-detonation allocation storm.
    const legacyPuffs = styleName !== "nuke" ||
      CBZ.CONFIG.NUKE_FX_LEGACY_PUFFS === true;
    // EFFECTIVE near-field radius (see fireR above): 126 m for the nuke row,
    // ~120 m for the MOAB pressure footprint — NOT the row's bare field.
    const radius = fireR(row, opts);
    const R = Math.max(5, radius * P.rFrac);
    const wave = row.wave || null;
    // Nuclear physics never shrinks with the graphics slider. Performance now
    // comes from the field's finite arrival queues and the cloud's depth/LOD,
    // not by making low-tier players survive a smaller weapon.
    const sc = (opts.scale > 0 ? +opts.scale : 1);
    const reachQ = styleName === "nuke" ? 1 : (CBZ.qScale ? CBZ.qScale(0.45, 1) : 1);
    const maxR = (wave && wave.maxR ? wave.maxR : radius * 4) *
                 reachQ * sc;
    const spd = wave && wave.speed ? wave.speed : 150;
    /* BURST HEIGHT. The bus hands the composer the real detonation `y`, and a
       B-2 releasing over a district is the whole reason this file exists — an
       airburst is not a ground burst with the same picture. So the FIREBALL,
       the condensation dome and the cap seat at the burst height while the
       base surge and the walking dust stay on the DECK, which
       is exactly the geometry: the stem is the dust column being drawn UP off
       the ground into a fireball that was never touching it.
       Clamped to 3 fireball radii so a stray y (a bomb still in the bomb bay,
       a debug teleport) cannot put a mushroom cloud in orbit. */
    const burstY = Math.max(gy, Math.min(gy + R * 3, y == null ? gy : (+y || gy)));
    const dist = camDist(x, burstY + R, z);

    const oneCloud = styleName === "nuke" && coherentCloud();
    const nBills = oneCloud ? 0
      : Math.max(1, Math.min(P.bills, Math.round(CBZ.qScale ? CBZ.qScale(1, P.bills) : P.bills)));
    const bills = [];
    for (let i = 0; i < nBills; i++) {
      const mesh = POOL.bills[i];
      if (!mesh) break;
      bills.push({
        mesh: mesh, role: ROLES[i], seed: rng(),
        roll: (rng() - 0.5) * 0.7, sx: (rng() - 0.5) * 0.05, sy: 0.02 + rng() * 0.05,
      });
      mesh.visible = false;
      mesh.material.uniforms.uOpacity.value = 0;
      mesh.material.uniforms.uGlow.value = P.glow;
    }

    live = {
      kind: row.id || styleName, style: P, styleName: styleName,
      detonationId: opts._carBlastId || 0,
      x: x, y: gy, by: burstY, z: z, R: R, maxR: maxR, spd: spd, eff: radius,
      // THE IGNITION RADIUS. Y^0.41 vs Y^0.33 (see STYLE.thermK) — the burn zone
      // is genuinely wider than the flattened zone, and this is the number that
      // says so. Zero for anything chemical. It is never drawn as an outline.
      // THE IGNITION RADIUS. Under NUKE_REAL_SCALE it is the researched
      // firestorm boundary (2,016 m for this yield — Hiroshima's 11.4 km^2
      // burnt area is a 1.9 km radius, and spontaneous ignition of light
      // fuels reaches ~2.0 km at 15 kt). Otherwise it is the old multiple of
      // the reach. It is never drawn as an outline either way.
      burnR: (styleName === "nuke" && real()) ? nukeRings(radius).psi2
           : (P.thermK > 0 ? maxR * P.thermK : 0),
      riseH: R * P.riseK, capW: R * P.capK, stemW: R * P.stemK, surgeW: R * P.surgeK,
      capH: R * P.capK * 0.66, capThick: 0, dims: null, drawDims: null,
      impW: 0, impH: 0, surgeDraw: 0,
      t: 0, r: Math.max(1, row.radius || radius * 0.1), dur: P.dur, q: q,
      // The front still drives damage, dust and condensation, but it is never
      // painted as geometry on the terrain.
      frontLife: Math.min(P.frontLife,
        styleName === "nuke" && CBZ.impact && CBZ.impact.shockArrival
          ? CBZ.impact.shockArrival(maxR, radius) + 1.6
          : maxR / Math.max(1, spd) + 1.6),
      bills: bills, dustAcc: 0, pending: [], ash: null, ashT: 0,
      // Listener sound/pressure is owned by impactbus's same physical field.
      boomAt: -1, frontAt: -1,
      frontHit: false, fogK: 0, mix: 0,
      mode: (CBZ.game && CBZ.game.mode) || null,
      quiet: !!opts.quiet, noDamage: !!opts.noDamage, byPlayer: !!opts.byPlayer,
      legacyPuffs: legacyPuffs, genericPuffEvents: 0,
      coherentCloud: oneCloud,
    };

    /* ---- MATURE PHYSICS, YOUNG VISIBLE CLOUD. nukeDims remains the researched
       minutes-old object used by the zone/audit model. The live 34-second shot
       uses formationDims instead: forcing a 10 km mature cloud into a 1 km
       camera is exactly what created the fake single-card mushroom. */
    if (styleName === "nuke" && real()) {
      const D = nukeDims(R);
      const F = formationDims(R);
      live.dims = D;
      live.drawDims = F;
      live.capW = F.capW / BLOOM_MAX;          // -> F.capW at full bloom
      live.capH = F.capH;
      live.capThick = F.capH / F.capW;
      live.riseH = F.capY;
      live.stemW = F.stemW * 0.5;              // stepVolumes wants a radius
      live.surgeW = F.base;
      live.surgeDraw = F.base;
      live.impW = F.capW;                      // legacy/fallback tier only
      live.impH = F.top;
      if (CBZ.CONFIG.NUKE_FX_AFTERMATH) {
        // The 34 s STYLE window stays the FORMATION sequence (audit beats,
        // early layers, glass ladder all keep their times); the cloud itself
        // then matures toward nukeDims and lingers as a landmark. See
        // matureStep() for the per-frame walk and the thinning law.
        live.matureFrom = P.dur;
        live.dur = 420;
      }
    }

    // ---- shells -----------------------------------------------------------
    // Tier 2+ gets the smooth luminous core and condensation veil. Every tier
    // gets a reduced 3D lobe cloud, so the fallback remains a mushroom instead
    // of becoming the old flat ring.
    const wantShell = CBZ.CONFIG.NUKE_FX_SHELL && q > 0.28;
    live.shell = wantShell ? POOL.shell : null;
    live.dome = wantShell && P.dome && q > 0.45 ? POOL.dome : null;
    if (live.shell) {
      live.shell.position.set(x, burstY + R * 0.55, z);
      live.shell.scale.setScalar(0.01);
      live.shell.material.uniforms.uOpacity.value = 0;
      live.shell.visible = true;
    }
    if (live.dome) {
      live.dome.position.set(x, burstY + R * 0.3, z);
      live.dome.scale.setScalar(0.01);
      live.dome.material.uniforms.uOpacity.value = 0;
      live.dome.visible = false;
    }
    // ---- VOLUMETRIC FIREBALL + MUSHROOM ------------------------------------
    // Four base InstancedMeshes plus nuclear crown/glow. The coherent nuke uses
    // rough depth-writing 3D lobes and suppresses the five redundant legacy
    // detail planes; it never substitutes a camera-facing silhouette card.
    live.volume = !!P.volume;
    if (live.volume) {
      const nuke = styleName === "nuke";
      const count = function (lo, hi) {
        return Math.max(lo, Math.min(hi, Math.round(CBZ.qScale ? CBZ.qScale(lo, hi) : hi)));
      };
      const fullCold = nuke && phasedCloud();
      live.volN = {
        cap: fullCold ? VOL_MAX.cap : count(nuke ? 12 : 8, nuke ? VOL_MAX.cap : 18),
        stem: fullCold ? VOL_MAX.stem : count(nuke ? 8 : 5, nuke ? VOL_MAX.stem : 10),
        surge: fullCold ? VOL_MAX.surge : count(nuke ? 10 : 7, nuke ? VOL_MAX.surge : 15),
        hot: count(nuke ? 8 : 6, nuke ? VOL_MAX.hot : 11),
        crown: 0, glow: 0,
      };
      /* THE CROWN/COLLAR AND THE GLOW ARE NUCLEAR-ONLY, and that is not a
         budget decision — a MOAB's smoke column has no incandescent head and
         no overhanging skirt, so drawing them on it would be a fiction. The
         crown's tier walk DECIMATES both of its slices evenly (the same rule
         the glass ladder uses): a budget cut must cost resolution, never the
         SHAPE, and a collar with no lobes left in it stops the cap
         overhanging at exactly the tier that can least afford a second
         silhouette read. */
      if (nuke && v2()) {
        const cn = fullCold ? VOL_MAX.crown : count(10, VOL_MAX.crown);
        live.volN.crown = cn;
        // The crown keeps its share of whatever budget survived, and BOTH
        // slices are guaranteed at least 3 lobes — a collar decimated to
        // nothing stops the cap overhanging, which is the one silhouette
        // read a low tier can least afford to lose.
        live.crownN = clamp(Math.round(cn * (CROWN_N / VOL_MAX.crown)), 3, cn - 3);
        live.volN.glow = count(6, VOL_MAX.glow);
      }
      POOL.capVol.count = live.volN.cap;
      POOL.stemVol.count = live.volN.stem;
      POOL.surgeVol.count = live.volN.surge;
      POOL.hotVol.count = live.volN.hot;
      POOL.crownVol.count = live.volN.crown;
      POOL.glowVol.count = live.volN.glow;
      const vv = [POOL.surgeVol, POOL.stemVol, POOL.capVol, POOL.hotVol,
                  POOL.crownVol, POOL.glowVol];
      for (let i = 0; i < vv.length; i++) {
        vv[i].position.set(x, gy, z);
        vv[i].visible = true;
      }
      POOL.capVol.material.opacity = 0;
      POOL.stemVol.material.opacity = 0;
      POOL.surgeVol.material.opacity = 0;
      POOL.hotVol.material.opacity = 0;
      POOL.crownVol.material.opacity = 0;
      POOL.glowVol.material.opacity = 0;
      if (!live.volN.crown) POOL.crownVol.visible = false;
      if (!live.volN.glow) POOL.glowVol.visible = false;
    }

    /* ---- THE WHITE DOME. Seated on the DECK, not at the burst height.
       Both routes to a nuclear detonation in this game end at a surface —
       the bomb's own impact point, or the planted device's floor — so the
       near-surface hemisphere IS the case, and it is the case the reference
       plate shows. The seat is nudged up only when a stray burst height
       genuinely lifts the ball off the ground (a debug teleport, or a fuze
       change later), where a hemisphere on the deck would be a lie; the
       0.55 factor keeps its equator at the ball's centre either way.
       Never at tier 0? No: this is the ONE layer that is never dropped. It
       is a single 450-triangle mesh, alive for 1.5 s, and it is the beat. */
    live.wdome = v2() && P.dbl ? POOL.wdome : null;
    if (live.wdome) {
      const lift = Math.max(0, burstY - gy);
      live.wdomeY = gy + Math.min(lift, R * 0.55);
      live.wdome.position.set(x, live.wdomeY, z);
      live.wdome.scale.setScalar(0.01);
      live.wdome.material.opacity = 0;
      live.wdome.visible = true;
    }

    /* ---- SCHEDULED BEATS. cityShatter is the real default. The old ordinary
       cityExplosion satellites remain behind NUKE_FX_LEGACY_PUFFS solely for
       A/B comparison; crashfx's sprite pool expands when exhausted, so they
       were never a safe nuclear-scale particle budget. -------------------- */
    if (legacyPuffs) {
      const nSat = Math.round((CBZ.qScale ? CBZ.qScale(0, P.secondary) : P.secondary));
      for (let i = 0; i < nSat; i++) {
        const a = i * 2.399963 + rng() * 0.55;
        const rr = R * (0.16 + Math.sqrt((i + 0.35) / Math.max(1, nSat)) * 0.68);
        live.pending.push({
          t: 0.22 + i * 0.09,
          x: x + Math.cos(a) * rr, z: z + Math.sin(a) * rr,
          power: 2.4, radius: 13, sat: true,
        });
      }
      const nSat2 = Math.round(nSat * 0.7);
      for (let i = 0; i < nSat2; i++) {
        const a = i * 2.399963 + 0.7 + rng() * 0.45;
        const rr = R * (0.55 + Math.sqrt(rng()) * 0.85);
        live.pending.push({
          t: 0.95 + i * 0.12,
          x: x + Math.cos(a) * rr, z: z + Math.sin(a) * rr,
          power: 1.9, radius: 11, sat: true,
        });
      }
      /* Legacy-only thermal receipts. The real impactbus sweep already lights
         eligible structures; these arbitrary ground samples were ordinary
         explosions on pavement or water, not evidence of those fires. */
      const nTherm = Math.round(CBZ.qScale ? CBZ.qScale(0, P.thermal) : P.thermal);
      for (let i = 0; i < nTherm; i++) {
        const a = i * 2.399963 + 1.9 + rng() * 0.7;
        const inner = Math.min(maxR * 0.70, Math.max(R * 1.25, 1));
        const outer = Math.min(
          Math.max(inner, live.burnR > 0 ? live.burnR : maxR),
          real() ? camFar() : Infinity);
        const rr = Math.sqrt(inner * inner + rng() * (outer * outer - inner * inner));
        live.pending.push({
          t: 0.9 + i * 0.14,
          x: x + Math.cos(a) * rr, z: z + Math.sin(a) * rr,
          power: 1.1, radius: 16, sat: true, smoke: true,
        });
      }
      live.genericPuffEvents = nSat + nSat2 + nTherm;
    }
    /* GLASS IS THE WIDEST OF THE THREE EFFECT ZONES.

       By overpressure: ~5 psi collapses most buildings (the classic destruction
       radius, and what `maxR` is), ~2 psi takes roofs and walls, and ~1 psi
       shatters windows across an area several times larger than any of it —
       flying glass is the single biggest injury source a city detonation
       produces. This ladder used to run 0.9 / 1.65 / 2.4 x the FIREBALL radius,
       i.e. 113 / 208 / 302 m against the old blast reach: every pane it broke
       was inside a zone where the buildings were already coming down. It now
       runs GLASS_K = 0.42 / 0.85 / 1.35 / 2.10 x the BLAST reach, so the last
       two passes land well beyond the demolition footprint.

       And each pass is timed to r/speed — the radius divided by the front's own
       speed — so the panes go out AS THE FRONT REACHES THEM rather than on a
       clock of their own. The outermost pass is past `maxR`, which the damage
       wave never reaches: that is not a mistake, it is the honest picture. The
       wave stops at its gameplay reach; a 1 psi front does not stop there, it
       just stops knocking buildings down.

       The tier walk DECIMATES the ladder evenly rather than truncating it, the
       same rule cityBombWalk uses on a bomb stick and for the same reason: a
       budget cut must cost you resolution, never REACH. Tier 0 keeps exactly one
       pass and the even walk lands it on the 1.35x rung — out past the blast
       rim, where the one pass a phone can afford does the most work — rather
       than on the innermost one a truncation would have left it with.
       Glass is the cheapest "the whole district felt that" cue there is,
       cityShatter skips already-broken panes and caps itself at 50 per call, so
       it must never floor to zero. */
    /* A bus-fired nuke carries its glass receipts in the physical detonation
       field. This visual state machine is intentionally single-cloud, while
       fields may coexist; keeping panes here caused every concurrent nuke but
       the photographed one to lose its window damage. Direct FX/MOAB calls
       retain the legacy visual schedule as their degrade path. */
    const fieldOwnsGlass = styleName === "nuke" && !!opts._carBlastId &&
      CBZ.CONFIG.IMPACT_SHOCKWAVE !== false && !opts.noDamage;
    if (!fieldOwnsGlass) {
      const nShatter = Math.max(1, Math.round((CBZ.qScale ? CBZ.qScale(1, P.shatter) : P.shatter)));
      if (CBZ.CONFIG.NUKE_FX_GLASS) {
        const GK = glassLadder(styleName);
        const step = GK.length / nShatter;
        for (let i = 0; i < nShatter; i++) {
          const k = GK[Math.min(GK.length - 1, Math.max(0, Math.round((i + 0.5) * step - 0.5)))];
          const rr = maxR * k;
          const arrive = styleName === "nuke" && CBZ.impact && CBZ.impact.shockArrival
            ? CBZ.impact.shockArrival(rr, radius) : rr / Math.max(1, spd);
          live.pending.push({ t: Math.max(0.08, arrive), shatter: rr });
        }
      } else {
        for (let i = 0; i < nShatter; i++) {
          live.pending.push({ t: 0.3 + i * 0.55, shatter: radius * (0.9 + i * 0.75) });
        }
      }
    }
    /* ---- t=0 FEEL -----------------------------------------------------------
       Light is the only instantaneous listener cue for a coherent nuke. Sound,
       shake and body pressure arrive together from impactbus. A conventional
       MOAB retains its immediate composer shake/degrade behaviour. */
    if (!live.quiet) {
      whiteout(P.white, P.whitePeak, P.dbl);
      if (styleName !== "nuke") {
        const att = Math.max(0.1, Math.min(1, 1.25 - dist / 420));
        if (CBZ.shake) { try { CBZ.shake(P.shake * att); } catch (e) {} }
      }
      // No audio here. The pressure front itself is the report, and impactbus
      // emits the one layered nuclear cue when that same field reaches the ear.
    }
    return live;
  }

  /* ---- one satellite / world beat --------------------------------------- */
  function firePending(p) {
    if (p.sat && CBZ.cityExplosion) {
      // FX ONLY (noDamage): the bus's propagating wave owns everything past
      // the fireball. Two systems must never both bill the same casualties.
      try {
        CBZ.cityExplosion(p.x, p.z, {
          power: p.power, radius: p.radius, noDamage: true,
          ordnance: live ? live.kind : "nuke", _impact: true,
        });
      } catch (e) {}
      /* Legacy ignition receipts leave something behind. cityCrashSmoke uses
         the shared puff pool, but that pool expands when exhausted. Only the
         legacy irregular thermal
         receipts carry `smoke`; the near-in satellites
         are inside the flattened zone, where the structural ledger's own fires
         are already the thing that is burning. */
      if (p.smoke && CBZ.cityCrashSmoke) {
        try { CBZ.cityCrashSmoke(p.x, floorAt(p.x, p.z) + 1.2, p.z, { count: 4, scale: 2.0 }); } catch (e) {}
      }
      return;
    }
    if (p.shatter != null && CBZ.cityShatter && live) {
      try { CBZ.cityShatter(live.x, live.z, p.shatter); } catch (e) {}
      return;
    }
  }

  /* ---- the shock-front radius: the SAME number the damage ring uses ------- */
  function frontRadius(dt) {
    // Read the live wave off the bus when it is there; the visual then IS the
    // gameplay ring, not a lookalike. Fall back to integrating the row's own
    // speed so a direct CBZ.cityNukeFX() call (no bus) still looks right.
    if (CBZ.impact && CBZ.impact.waveState) {
      try {
        const ws = CBZ.impact.waveState();
        for (let i = 0; i < ws.length; i++) {
          if (ws[i].kind !== live.kind) continue;
          if (live.detonationId && ws[i].detonationId &&
              ws[i].detonationId !== live.detonationId) continue;
          live.r = ws[i].r; return live.r;
        }
      } catch (e) {}
    }
    if (live.styleName === "nuke" && CBZ.impact && CBZ.impact.shockDistance) {
      live.r = Math.min(live.maxR, CBZ.impact.shockDistance(live.t, live.R));
    } else live.r = Math.min(live.maxR, live.r + live.spd * dt);
    return live.r;
  }

  /* ============================================================
     THE LEGACY FAR TIER — one quad, true angular size, and a handoff that is a
     GEOMETRIC FACT rather than a distance somebody picked.

     impostorMix(L) returns 0 (all 3D) .. 1 (all impostor). The rule is:
     fade as the 3D cap's FURTHEST POINT approaches the far plane, i.e.

         dFar = |capCentre - camera| + capRadius

     — the far EDGE, not the centre. Using the centre would let the cap's
     back half get clipped by the frustum mid-fade, which is precisely the
     artefact this is here to prevent: the 3D cap is fully retired before any
     part of it can cross the far plane. The band is 0.55..0.95 of far, so
     the swap always finishes with 5% of the frustum still to spare.

     Early in the sequence the cloud is small and low and this is 0 — you get
     real 3D lobes overhead. Within a few seconds it has climbed past a
     kilometre and this is 1, which is correct: at that point the cloud is
     genuinely a sky object and no amount of geometry would render it.
     ============================================================ */
  function impostorMix(L) {
    if (!L.dims || !POOL.imp) return 0;
    const c = camPos();
    if (!c) return 1;
    const cy = capYAt(riseAt(L.t, L), L);
    const capR = L.capW * bloomAt(L.t, L) * 0.5;
    const dFar = Math.hypot(L.x - c.x, cy - c.y, L.z - c.z) + capR;
    const f = camFar();
    return clamp((dFar - f * 0.55) / (f * 0.40), 0, 1);
  }
  const _impBase = new THREE.Vector3();
  const _impTop = new THREE.Vector3();
  const _impUp = new THREE.Vector3();
  const _impRight = new THREE.Vector3();
  const _impNormal = new THREE.Vector3();
  const _impBasis = new THREE.Matrix4();
  function impostorPointAtDepth(out, x, y, z, D, cam) {
    out.set(x, y, z).applyMatrix4(cam.matrixWorldInverse);
    const depth = -out.z;
    if (!(depth > 0.05) || !isFinite(depth)) return 0;
    out.set(out.x * D / depth, out.y * D / depth, -D).applyMatrix4(cam.matrixWorld);
    return depth;
  }
  function stepImpostor(t, L, mix) {
    const imp = POOL.imp;
    if (!imp) return;
    if (mix <= 0.004 || !L.dims) { imp.visible = false; imp.material.uniforms.uOpacity.value = 0; return; }
    const cam = CBZ.camera;
    if (!cam || !cam.position) { imp.visible = false; return; }
    /* The physical cloud is taller than the frustum. Draw its two projected
       endpoints on one safe camera-depth plane: the apparent shape survives,
       while its bottom remains the detonation instead of following the lens. */
    const rise = riseAt(t, L);
    /* The phased masks are authored in the mature cloud's metre coordinate
       system: an early bulb occupies only the lower/smaller part of that same
       canvas. Therefore the quad stays at the mature physical box while the
       MASK grows through it. The legacy path keeps its old whole-mushroom
       scaling for an exact visual A/B. */
    const grow = 0.30 + 0.70 * rise;
    const capNow = L.capW * bloomAt(t, L);
    /* Coherent phase masks all fill one normalized UV box. Grow that box from
       the live cap and cap-centre curves, so one cloud physically rises and
       expands. The old fixed mature box forced phase textures painted at
       different altitudes to overlap during every morph. */
    const w = L.coherentCloud ? capNow * 1.30
      : L.impW * (phasedCloud() ? 1 : grow);
    const h = L.coherentCloud
      ? Math.max(L.R * 0.55,
          capYAt(rise, L) - L.y +
          capNow * (L.capThick || 0.782) * 0.5 * 1.12)
      : L.impH * (phasedCloud() ? 1 : grow);
    const D = camFar() * 0.86;
    if (cam.updateMatrixWorld) cam.updateMatrixWorld(true);
    const baseDepth = impostorPointAtDepth(_impBase, L.x, L.y, L.z, D, cam);
    const topDepth = impostorPointAtDepth(_impTop, L.x, L.y + h, L.z, D, cam);
    if (!baseDepth || !topDepth) {
      imp.visible = false; imp.material.uniforms.uOpacity.value = 0; return;
    }

    /* Pin BOTH ends of the sky quad. The old centre-ray shortcut moved the
       mesh's X/Z toward the moving aircraft by (1-D/d), so the mushroom could
       stand hundreds of metres away from the dome during the held-C fly-away.
       Projecting ground zero and cloud top independently keeps the one-draw
       impostor inside the far plane without ever surrendering its impact. */
    imp.position.copy(_impBase).add(_impTop).multiplyScalar(0.5);
    const hh = _impUp.subVectors(_impTop, _impBase).length();
    if (!(hh > 0.01)) {
      imp.visible = false; imp.material.uniforms.uOpacity.value = 0; return;
    }
    _impUp.multiplyScalar(1 / hh);
    _impNormal.set(0, 0, 1).transformDirection(cam.matrixWorld);
    _impRight.crossVectors(_impUp, _impNormal);
    if (_impRight.lengthSq() < 0.000001) _impRight.set(1, 0, 0).transformDirection(cam.matrixWorld);
    else _impRight.normalize();
    _impUp.crossVectors(_impNormal, _impRight).normalize();
    _impBasis.makeBasis(_impRight, _impUp, _impNormal);
    imp.quaternion.setFromRotationMatrix(_impBasis);
    imp.scale.set(w * D / Math.max(0.05, (baseDepth + topDepth) * 0.5), hh, 1);
    /* Unlike the yaw-only near billboards, this quad lies in the camera plane.
       Its local Y is the exact projected ground-to-top vector, so banking or
       the held-C camera cannot rotate that vector away from ground zero. */
    const u = imp.material.uniforms;
    // the whole cloud cools along the shared LUT; uCool then spreads the
    // crown and the dust base further along it than the core (see BILL_FS).
    // The cloud stays incandescent through the visibly forming mushroom,
    // while the mask's cool channel can still drive its crown/base to soot.
    u.uLife.value = clamp(0.04 + t / 40, 0, 0.55);
    u.uPhase.value = cloudPhaseAt(t, L);
    u.uScroll.value.set(0.013 * t, -0.021 * t);
    u.uScroll2.value.set(-0.008 * t, 0.011 * t);
    /* THE FADE-IN IS capIn'S OWN CURVE, DELIBERATELY AND EXACTLY.
       stepVolumes draws the 3D cap at `capIn * near` and this draws the far
       tier at `capIn * mix`, and near + mix = 1 by construction — so the two
       tiers always sum to capIn no matter where the handoff sits. Any other
       curve here leaves a HOLE: with an independent 0.9 s start the impostor
       was still at zero through the window where mix had already retired the
       3D cap, and the head simply vanished for a third of a second. Two
       layers cross-fading have to share one envelope or they cannot. */
    const fadeIn = ease((t - 0.55) / 1.15);        // === capIn in stepVolumes
    const fadeOut = 1 - ease((t - (L.dur - 9)) / 9);
    u.uOpacity.value = Math.max(0, mix * fadeIn * Math.max(0, fadeOut));
    imp.visible = u.uOpacity.value > 0.004;
  }

  /* ---- billboard placement -------------------------------------------------
     Every detail plane stays vertical in world space and yaws only. Copying the
     camera's pitch was the aircraft-view bug: from above, the cap tipped flat
     and exposed itself as a disc precisely when the mushroom mattered most. */
  function faceCameraYaw(mesh) {
    const cam = CBZ.camera;
    if (!cam || !cam.position) return;
    mesh.rotation.set(0, Math.atan2(cam.position.x - mesh.position.x,
                                    cam.position.z - mesh.position.z), 0);
  }

  /* ---- DEPTH-WRITING 3D MUSHROOM FIELD ------------------------------------
     Rough, anisotropic lobes establish a real cap/stem/surge volume. Their
     surfaces light, parallax and occlude in world space; no cloud primitive
     rotates to follow the lens. Slow buoyant motion is uploaded at 12 Hz while
     colour/light envelopes remain frame-smooth. */
  const _volDummy = new THREE.Object3D();
  let _volWrite = true;
  const VOL_HOT = new THREE.Color(0xff7a18);
  const VOL_ASH = new THREE.Color(0x332f2c);
  /* THE STEM IS ORANGE-RED, NOT BROWN, and THE BASE SURGE IS RED-BROWN.
     The column under a fresh cap is convecting air off a fireball that is
     still radiating into it, so it is LIT from inside along its whole
     length — that is the single loudest colour in the reference plate and
     the old 0x5e3b2b read as a dust column standing beside an explosion
     rather than rising out of one. The surge is pulverised GROUND thrown
     out along the deck and lit from one side, so its lit face is warm
     red-brown and its shadowed lobes go nearly black; those black lobes are
     what carry the plate's scale, and the old pair (0x806456/0x5a5651) was
     two greys with a hint of tan.

     BOTH PAIRS ARE KEPT AND CHOSEN PER FRAME rather than resolved once at
     load. A colour frozen by a flag read at module scope is a flag that
     cannot be flipped at runtime, and every other revert in this file can
     be — so these are two-element tables indexed by v2(), not a ternary. */
  const VOL_STEM_HOT_V = [new THREE.Color(0x5e3b2b), new THREE.Color(0xa8401c)];
  const VOL_STEM_ASH = new THREE.Color(0x292725);
  const VOL_DUST_HOT_V = [new THREE.Color(0x806456), new THREE.Color(0x8a3f22)];
  const VOL_DUST_ASH_V = [new THREE.Color(0x5a5651), new THREE.Color(0x38251c)];
  const VOL_EMBER = new THREE.Color(0x7a2a0b);
  const VOL_EMBER_OFF = new THREE.Color(0x080604);
  // the crown: cold soot at the top of the cloud, cooling further to ash
  const VOL_CROWN_HOT = new THREE.Color(0x4a3325);
  const VOL_CROWN_ASH = new THREE.Color(0x2a2723);
  const VOL_CROWN_EMBER = new THREE.Color(0x2c0d03);

  function putVolume(mesh, i, x, y, z, sx, sy, sz, ry) {
    if (!_volWrite) return;
    _volDummy.position.set(x, y, z);
    const r = ry || 0;
    _volDummy.rotation.set(r * 0.37, r, r * 0.19);
    _volDummy.scale.set(Math.max(0.01, sx), Math.max(0.01, sy), Math.max(0.01, sz));
    _volDummy.updateMatrix();
    mesh.setMatrixAt(i, _volDummy.matrix);
  }

  function cloudColor(mat, hot, ash, u, ember) {
    mat.color.copy(hot).lerp(ash, clamp(u, 0, 1));
    if (mat.emissive) {
      mat.emissive.copy(ember || VOL_EMBER).lerp(VOL_EMBER_OFF, clamp(u * 1.25, 0, 1));
    }
  }

  function stepVolumes(t, L, mix) {
    if (!L.volume || !L.volN) return;
    _volWrite = L.volNext == null || t + 1e-6 >= L.volNext;
    if (_volWrite) L.volNext = t + 1 / 12;
    // 1 while the legacy far tier owns the picture, 0 while 3D lobes do.
    const mixC = clamp(mix || 0, 0, 1);
    const near = 1 - mixC;
    const rise = riseAt(t, L);
    const capY = capYAt(rise, L) - L.y;
    const bloom = bloomAt(t, L);
    const cloudCool = clamp((t - 0.7) / 11, 0, 1);
    let endFade = Math.max(0, 1 - ease((t - (L.dur - 8)) / 8));
    // Aftermath thinning: a stabilised cloud goes grey and translucent long
    // before it disperses. Starts after the maturation walk, halves the body
    // by the end, and the final 8 s fade above still closes it out.
    if (L.matureFrom) endFade *= 1 - 0.5 * ease((t - 200) / Math.max(60, L.dur - 208));
    const roll = CBZ.CONFIG.NUKE_FX_ROLL
      ? t * (0.11 + 0.22 * Math.exp(-Math.max(0, t - 1) / 8))
      : t * 0.08;

    // CAP — a broad, deep mass of overlapping lobes. The slight vertical
    // circulation is the mushroom's overturn, without exposing a donut mesh.
    // `flat` walks the head from a rising ball to a stabilised anvil (see
    // capFlatAt); it multiplies the vertical SPREAD and the lobes' own
    // height, so the cap gets wider AND squatter instead of merely bigger.
    const cap = POOL.capVol;
    const capIn = ease((t - 0.55) / 1.15);
    const capRadius = L.capW * bloom * 0.5;
    const flat = capFlatAt(t, L);
    /* THE CAP IS A LENS, AND ITS LUMPS OBEY A SIZE LAW.
       `photo` switches the two together, because they are one shape:
         • the vertical station is the seed's y2 scaled by the cap's own
           HALF-THICKNESS (a researched 1,996 m, i.e. 0.78 of the cap radius)
           and by the lens profile sqrt(1-r^2) — deep in the middle, thin at
           the rim, which is what a vortex ring is;
         • the lobe radius is s2, which FALLS with distance from the axis.
       Together those give the reference plate's read: a handful of very big
       lumps boiling over the crown and a dense fringe of small ones round
       the rim. The legacy branch is the old flat disc of same-size blobs. */
    const photo = real();
    // half-THICKNESS as a ratio of the cap RADIUS, so it rides bloom for
    // free: (capH/2)/(capW/2) = capH/capW = 3,992/5,106 = 0.782 at 16 kt.
    const halfH = capRadius * (L.capThick || 0.782);
    for (let i = 0; i < L.volN.cap; i++) {
      const s = VOL_SEED.cap[i];
      const a = s.a + roll * (0.35 + s.r * 0.45) + s.spin * t;
      const rr = capRadius * s.r;
      const lens = Math.sqrt(Math.max(0.04, 1 - s.r * s.r));
      const lobe = capRadius * (photo ? s.s2 : s.s) * (0.45 + 0.55 * capIn);
      const overturn = Math.sin(a * 1.7 + t * 0.55) * capRadius * 0.035;
      const yOff = photo
        ? (halfH * s.y2 * lens + overturn) * flat
        : (capRadius * s.y + overturn) * flat;
      putVolume(cap, i,
        Math.cos(a) * rr,
        capY + yOff,
        Math.sin(a) * rr,
        lobe * (1.08 + s.r * 0.22), lobe * (0.72 + (1 - s.r) * 0.18) * flat, lobe,
        a * 0.35);
    }
    cap.material.opacity = 0.86 * capIn * endFade * near;
    cloudColor(cap.material, VOL_HOT, VOL_ASH, cloudCool);
    cap.visible = cap.material.opacity > 0.004;
    if (_volWrite) cap.instanceMatrix.needsUpdate = true;

    /* ---- THE CAP GLOWS FROM WITHIN --------------------------------------
       This is the layer that makes the reference plate read as a LIGHT
       SOURCE. It lives strictly inside the cap's own lobes (seed r <= 0.62,
       and it is scaled off the same capRadius), it is additive so it
       brightens what it shines through, and depthTest leaves the cap's front
       lobes occluding it — so what you see is heat coming out from between
       the lumps, never a ball in front of a cloud.
       It comes up WITH the cap and dies on the cloud's own cooling curve
       (cloudCool reaches 1 at t = 11.7 s), because that is what stops the
       cloud looking hot forever. */
    const glow = POOL.glowVol;
    if (L.volN.glow) {
      const glowIn = ease((t - 0.60) / 1.0);
      const glowOut = Math.max(0, 1 - ease((t - 2.6) / 7.4));
      for (let i = 0; i < L.volN.glow; i++) {
        const s = VOL_SEED.glow[i];
        const a = s.a + roll * 0.5;
        const rr = capRadius * s.r;
        // 0.70: the glow lobes must stay strictly INSIDE the cap's own
        // envelope. The cap's outermost lobe reaches 0.86R + its own radius;
        // at this size the glow's furthest reach is comfortably under that,
        // so heat bleeds between the lumps instead of breaking the
        // silhouette and becoming a second fireball.
        const lobe = capRadius * s.s * 0.70;
        putVolume(glow, i,
          Math.cos(a) * rr,
          capY + capRadius * s.y * 0.55 * flat,
          Math.sin(a) * rr,
          lobe * 1.15, lobe * flat, lobe, a);
      }
      // white-hot -> yellow -> deep orange, the same walk the fireball took
      // but slower: a cap is a much bigger mass and cools far more slowly.
      glow.material.color.setHex(t < 1.6 ? 0xfff2c8 : t < 4.5 ? 0xffc45a : 0xd96a1e);
      glow.material.opacity = 0.54 * glowIn * glowOut * endFade * near;
      glow.visible = glow.material.opacity > 0.004;
      if (_volWrite) glow.instanceMatrix.needsUpdate = true;
    }

    /* ---- THE COLLAR AND THE CROWN, one mesh, two slices -----------------
       COLLAR first (it arrives earlier): the skirt hanging under the cap's
       rim, which is the thing that makes the cap OVERHANG its stem. Without
       it the head is a disc balanced on a column; with it there is a shape.
       CROWN second: dark cauliflower boiling over the top. It fades in
       LATER than everything else on purpose — the top of a fresh cloud is
       still incandescent and there is nothing dark up there to draw. It is
       the visible fact that the cloud is cooling from the top down. */
    const crown = POOL.crownVol;
    if (L.volN.crown) {
      const collarIn = ease((t - 1.5) / 1.8);
      const crownIn = ease((t - 2.6) / 3.4);
      /* THE SLICE MAP, and it is not `i` — that was a real bug worth naming.
         The seed array is laid out [0, CROWN_N) crown then the rest collar,
         but the INSTANCE array is only volN.crown long and its crown share
         is crownN. At full count those coincide; at any reduced tier they do
         NOT, so reading VOL_SEED.crown[i] would have handed a CROWN seed
         (positive y, riding the cap's dome) to a slot the loop was about to
         place and shape as a COLLAR lobe — a wide flat saucer floating above
         the head instead of a skirt hanging under it, at exactly the quality
         tiers nobody profiles. Each slot therefore maps into its OWN slice,
         evenly decimated, and the map is the identity at full count. */
      const nC = Math.max(1, Math.min(L.volN.crown - 1, L.crownN || CROWN_N));
      const nK = L.volN.crown - nC;
      const COLLAR_N = VOL_MAX.crown - CROWN_N;
      for (let i = 0; i < L.volN.crown; i++) {
        const isCrown = i < nC;
        const si = isCrown
          ? Math.min(CROWN_N - 1, Math.floor(i * CROWN_N / nC))
          : CROWN_N + Math.min(COLLAR_N - 1, Math.floor((i - nC) * COLLAR_N / Math.max(1, nK)));
        const s = VOL_SEED.crown[si];
        const grow = isCrown ? crownIn : collarIn;
        const a = s.a + roll * (isCrown ? 0.42 : 0.24) + s.spin * t;
        const rr = capRadius * s.r * (isCrown ? 1 : 1.04);
        const lobe = capRadius * s.s * (0.5 + 0.5 * grow);
        putVolume(crown, i,
          Math.cos(a) * rr,
          capY + capRadius * s.y * (isCrown ? 0.46 : 0.62) * flat,
          Math.sin(a) * rr,
          // the collar is deliberately WIDE and LOW (a skirt, not a bead)
          lobe * (isCrown ? 1.05 : 1.42), lobe * (isCrown ? 0.94 : 0.56) * flat,
          lobe * (isCrown ? 1.05 : 1.42), a * 0.5);
      }
      crown.material.opacity = 0.88 * Math.max(collarIn, crownIn) * endFade * near;
      cloudColor(crown.material, VOL_CROWN_HOT, VOL_CROWN_ASH, cloudCool, VOL_CROWN_EMBER);
      crown.visible = crown.material.opacity > 0.004;
      if (_volWrite) crown.instanceMatrix.needsUpdate = true;
    }

    // STEM — overlapping vertical billows leave no chair-leg-thin cylinder and
    // no gap under the cap. A mild spiral makes sucked-up debris visibly rise.
    /* THE STEM IS A TWISTED CONVECTIVE COLUMN, NOT A CYLINDER.
       OWNER: "a THICK ROILING ORANGE-BROWN STEM roughly as wide as ~1/3 the
       cap ... visibly a twisted convective column of lumps ... flaring out
       at the bottom into a broad dark dust base."
       Three separate things were wrong and all three are geometry:
         (1) WIDTH. stemK 0.28 against capK 2.75 made the cap 9.8x the stem.
             The reference is 3x, so the stem is now capW/3 = 1,702 m (see
             STEM_OF_CAP) and it is a real column you could fly through.
         (2) LUMPS. Every lobe sat inside 0.36 of the declared radius, so the
             column was a thin core in a wide claim — smooth from any angle.
             `r2` fills it to the edge and `s2` makes the lumps overlap.
         (3) TWIST + FLARE. The azimuth now advances STEM_TURNS over the
             column height (a helix — that is what "twisted" means and it is
             what a buoyant plume in shear actually does), and stemProfile()
             flares it 1.9x at the foot into the dust base and 1.25x at the
             shoulder into the cap.
       THE FRUSTUM CLAMP. At true scale the column runs to the cap base at
       6,008 m, ten times past the far plane, so the drawn 3D column is
       clamped to 0.82 of far and its topmost lobes are TAPERED AWAY rather
       than cut — the impostor carries everything above, and the depth test
       composites the two because the near lobes are genuinely nearer. */
    const stem = POOL.stemVol;
    const stemIn = ease((t - 0.65) / 1.3);
    const STEM_TURNS = 0.85;
    const capBase = capY - (photo ? capRadius * (L.capThick || 0.782) : capRadius * 0.4);
    const hTrue = Math.max(L.R * 0.55, capBase);
    const h = photo ? Math.min(hTrue, camFar() * 0.82) : Math.max(L.R * 0.55, capY);
    const stemR = photo ? L.stemW * (0.55 + rise * 0.45) : L.stemW * (0.72 + rise * 0.88);
    const stemY = Math.max(L.R * 0.10, h / Math.max(5, L.volN.stem * 0.72));
    for (let i = 0; i < L.volN.stem; i++) {
      const s = VOL_SEED.stem[i];
      if (!photo) {
        const a0 = s.a + roll * (0.28 + s.f * 0.35);
        const neck = 0.72 + Math.abs(s.f - 0.55) * 0.55;
        putVolume(stem, i,
          Math.cos(a0) * stemR * s.r, Math.max(stemY * 0.45, h * s.f), Math.sin(a0) * stemR * s.r,
          stemR * s.s * neck, stemY * s.s, stemR * s.s * neck, a0);
        continue;
      }
      // f is the station on the TRUE column, so the flare profile is honest
      // even though only the bottom 0.82*far of it is drawn.
      // STRATIFIED STATIONS. Raw-random s.f clusters — at the low quality
      // tier's 8 lobes a cluster leaves half the column empty (the dotted
      // stem the storyboard caught). Each lobe owns a band of the column
      // with +/-45% jitter inside it, so coverage is guaranteed at any tier
      // and the organic stagger survives.
      const fS = (i + 0.5 + (s.f - 0.5) * 0.9) / Math.max(1, L.volN.stem);
      const fTrue = fS * (h / Math.max(1, hTrue));
      const prof = stemProfile(fTrue);
      const a = s.a + s.tw + roll * (0.28 + fS * 0.35) + fTrue * STEM_TURNS * 6.2832;
      const rr = stemR * prof * s.r2;
      // taper the last 18% of the drawn column to nothing so the frustum
      // clamp is a fade, not a guillotine.
      const taper = 1 - ease((fS - 0.82) / 0.18);
      const lobe = stemR * prof * s.s2 * Math.max(0.02, taper);
      // OVERLAP FLOOR. The aftermath stretches the column toward 8 km while
      // the stem only widens ~1.2x, so fixed-size lobes separate into a
      // dotted line of balls (caught by the nuke-sequence storyboard,
      // 2026-08-02). Each lobe's VERTICAL radius is floored at 0.8x its
      // share of the drawn column, so neighbours overlap at any height —
      // width stays stem-scaled to hold the 3:1 cap/stem proportion.
      const seg = h / Math.max(4, L.volN.stem);
      putVolume(stem, i,
        Math.cos(a) * rr, Math.max(stemY * 0.35, h * fS), Math.sin(a) * rr,
        lobe * 1.06,
        Math.max(lobe * 0.92, seg * 0.8 * Math.max(0.02, taper)),
        lobe * 1.06, a);
    }
    // The near column is deliberately kept ALIVE under the impostor (it only
    // loses 55% of its opacity, not all of it): the reference plate's whole
    // foreground is that thick roiling column, and it is the one part of the
    // cloud that genuinely is inside the frustum.
    stem.material.opacity = 0.84 * stemIn * endFade * (photo ? (1 - mixC * 0.55) : near);
    cloudColor(stem.material, VOL_STEM_HOT_V[v2() ? 1 : 0], VOL_STEM_ASH, cloudCool);
    stem.visible = stem.material.opacity > 0.004;
    if (_volWrite) stem.instanceMatrix.needsUpdate = true;

    // BASE SURGE — a FILLED, irregular dust cloud. It occupies area; it never
    // traces the pressure radius as a line.
    /* THE BASE SURGE, and its one researched number.
       Crossroads Baker (23 kt, 1946) is the canonical measurement: the surge
       rolled outward from the foot of the column at roughly 45 m/s and was
       ~300 m in radius by 10 s, ~1 km by a minute, decelerating the whole
       time. The land-burst equivalent is the ground-shock dust skirt driven
       by the afterwinds — same picture, same law: fast then slowing, which
       is what the ease() below is and why it is not linear.
       WHAT V2 ADDS is the LOBES. Their radius and height alternate hard and
       their soft masks overlap at different depths, so the apron has broken
       density and motion instead of reading as a uniform fog sheet. */
    const surge = POOL.surgeVol;
    const surgeIn = ease((t - 0.75) / 2.0);
    const surgeFade = Math.max(0, 1 - ease((t - Math.min(15, L.dur - 5)) / 7));
    /* L.surgeDraw is the young cloud's visible base. The researched 2,016 m
       contour remains in nukeDims/nukeRings; it is a gameplay boundary, not a
       claim that 34 seconds of dust have already filled that whole radius. */
    const surgeMax = photo ? L.surgeDraw : Math.min(L.maxR * 0.72, L.R * 3.6);
    const surgeR = surgeMax * (0.12 + 0.88 * ease((t - 0.55) / 6.2));
    const deep = v2();
    for (let i = 0; i < L.volN.surge; i++) {
      const s = VOL_SEED.surge[i];
      const a = s.a + Math.sin(t * 0.16 + i) * 0.08;
      const rr = surgeR * s.r;
      const lobe = Math.max(L.R * 0.075, surgeMax * (0.055 + s.s * 0.028));
      // alternating tall/low lobes: the low ones fall into their neighbours'
      // shadow and go black, which is the whole reason this row exists.
      const tall = deep ? (0.72 + ((i & 1) ? 0.62 : 0.02)) : 1;
      // the churn — slower the further out, exactly as the surge decelerates
      const spin = deep ? -t * (0.55 / (0.45 + s.r * 1.6)) : 0;
      putVolume(surge, i,
        Math.cos(a) * rr,
        lobe * (0.24 + 0.10 * Math.sin(i * 1.7)) * tall,
        Math.sin(a) * rr,
        lobe * 1.25, lobe * 0.38 * tall, lobe,
        a + spin);
    }
    surge.material.opacity = (deep ? 0.76 : 0.82) * surgeIn * surgeFade;
    cloudColor(surge.material, VOL_DUST_HOT_V[deep ? 1 : 0], VOL_DUST_ASH_V[deep ? 1 : 0],
      cloudCool * 0.85);
    surge.visible = surge.material.opacity > 0.004;
    if (_volWrite) surge.instanceMatrix.needsUpdate = true;

    // HOT BILLOWS — the RPG's layered, short-lived fireball logic translated
    // into real 3D lobes around the core, so it roils instead of reading as one orb.
    const hot = POOL.hotVol;
    const hotIn = ease(t / 0.16);
    const hotFade = Math.max(0, 1 - ease((t - 2.8) / 3.2));
    const grow = 1 - Math.exp(-t * 5.5);
    const fireR0 = L.R * grow * (1 + rise * 0.30);
    const fireY = (L.by - L.y) + L.R * 0.55 +
      (L.riseH * 0.92 - L.R * 0.55) * rise;
    for (let i = 0; i < L.volN.hot; i++) {
      const s = VOL_SEED.hot[i];
      const a = s.a + t * 0.18;
      const rr = fireR0 * s.r * 0.68;
      const lobe = Math.max(0.01, fireR0 * s.s);
      putVolume(hot, i,
        Math.cos(a) * rr,
        fireY + s.y * fireR0 * 0.42,
        Math.sin(a) * rr,
        lobe * 1.08, lobe * 0.88, lobe,
        a);
    }
    const pulse = flashRadiance(t, L.style);
    hot.material.color.setHex(t < 0.45 ? 0xfff4cf : t < 1.8 ? 0xffa02e : 0xd94312);
    hot.material.opacity = 0.82 * hotIn * hotFade * (0.18 + 0.82 * pulse);
    hot.visible = hot.material.opacity > 0.004;
    if (_volWrite) hot.instanceMatrix.needsUpdate = true;
    _volWrite = true;
  }

  function stepBill(b, t, L) {
    const m = b.mesh, u = m.material.uniforms;
    // riseAt/capYAt/bloomAt — the SHARED curves. These three numbers used to be
    // recomputed with a copy-pasted smoothstep in three separate places (here,
    // the fireball and cap roll), so "how high is the cloud" had three
    // answers that only happened to agree.
    const rise = riseAt(t, L);
    const capY = capYAt(rise, L);
    const bloom = bloomAt(t, L);
    const fadeIn = ease((t - b.t0) / 0.7);
    const fadeOut = 1 - ease((t - (L.dur - 9)) / 9);
    let op = fadeIn * Math.max(0, fadeOut);
    if (t < b.t0) { m.visible = false; return; }

    // two INDEPENDENTLY scrolling noise lookups (the Fallout-4 trick) — driven
    // off sequence time, not per-frame increments, so the roil runs at the
    // same speed whatever the framerate is.
    // THE CAP'S SCROLL IS NOT RANDOM. Its two lookups shear vertically in
    // OPPOSITE directions, which on a vertical detail quad reads as material
    // climbing the middle and falling down the edges — the same overturn the
    // instanced lobes draw in 3D. The two layers agreeing stops the cap
    // looking like a still image with noise crawling on it; every other role
    // keeps its per-detonation random drift.
    const shear = (CBZ.CONFIG.NUKE_FX_ROLL && b.role === "cap") ? 0.055 : 0;
    u.uScroll.value.set(b.seed + b.sx * t, b.seed - (b.sy + shear) * t);
    u.uScroll2.value.set(b.seed * 0.7 - b.sx * 0.42 * t, b.seed * 1.3 + (b.sy + shear * 1.6) * 0.37 * t);

    /* THE DETAIL PLANES MUST TRACK THE FLATTENING HEAD. These quads are
       surface texture painted over the 3D cap, so if the volume squats to
       CAP_FLAT and the quads do not, the roiling detail ends up standing
       proud of the silhouette it is supposed to be ON — a paper oval above
       an anvil, which is the exact failure the `if (L.volume) op *= 0.46`
       line at the bottom of this function exists to prevent. capFlatAt is
       1 when NUKE_FX_V2 is off, so this line is inert on the revert path. */
    const flat = capFlatAt(t, L);

    switch (b.role) {
      case "cap":
        m.position.set(L.x, capY, L.z);
        m.scale.set(L.capW * bloom, L.capW * bloom * 0.66 * flat, 1);
        u.uLife.value = clamp(t / 9, 0, 1);
        u.uErode.value = 0.14;
        op *= 0.95;
        break;
      case "cap2":
        // OFFSET, never a multiply on an absolute world Y — `capY` already
        // includes the ground height, so `capY * 1.05` drifted the second cap
        // further from the first the higher the terrain under ground zero was.
        m.position.set(L.x + L.capW * 0.16, capY + L.capW * 0.05 * flat, L.z - L.capW * 0.1);
        m.scale.set(L.capW * bloom * 0.72, L.capW * bloom * 0.5 * flat, 1);
        u.uLife.value = clamp(t / 8 + 0.05, 0, 1);
        u.uErode.value = 0.22;
        op *= 0.7;
        break;
      case "stem": {
        const h = Math.max(2, capY - L.y);
        m.position.set(L.x, L.y + h * 0.5, L.z);
        m.scale.set(L.stemW * (1 + rise * 0.7), h, 1);
        u.uLife.value = clamp(0.30 + t / 26, 0, 1);
        u.uErode.value = 0.30;
        op *= 0.78;
        break;
      }
      case "collar":
        m.position.set(L.x, capY - L.capW * 0.30 * bloom * flat, L.z);
        m.scale.set(L.capW * bloom * 0.62, L.capW * bloom * 0.26 * flat, 1);
        u.uLife.value = clamp(0.22 + t / 18, 0, 1);
        u.uErode.value = 0.26;
        op *= 0.62;
        break;
      case "surge": {
        // BASE SURGE: the skirt of pulverised ground that rolls OUT along the
        // deck under the stem. Grows with the front, not with the column.
        const g = ease((t - 1.6) / 6);
        const w = L.surgeW * (0.35 + 1.5 * g);
        const h = w * 0.19;      // LOW and wide (~5:1) — a surge that is a
                                 // third as tall as it is wide is a second
                                 // mushroom, and it clipped through the deck.
        m.position.set(L.x, L.y + h * 0.42, L.z);
        m.scale.set(w, h, 1);
        u.uLife.value = clamp(0.42 + t / 24, 0, 1);
        u.uErode.value = 0.34;
        op *= 0.6 * (1 - ease((t - 9) / 9));
        break;
      }
      default:
        // an unknown role would otherwise be drawn at whatever position and
        // scale the previous detonation left on this pooled mesh.
        m.visible = false;
        u.uOpacity.value = 0;
        return;
    }
    // Once a 3D volume owns the silhouette, these planes are surface texture,
    // not the cloud itself. Keeping them subordinate prevents a steep aircraft
    // camera from revealing one enormous paper oval.
    if (L.volume) op *= 0.46;
    /* ...and once the IMPOSTOR owns it, they are nothing at all: the far
       tier already carries its own baked surface detail, so leaving these
       up would paint a second, differently-scaled cloud over it. The stem
       and surge roles keep a share for the same reason the 3D stem does —
       they are the near foreground. */
    if (L.mix > 0) {
      const keep = (b.role === "stem" || b.role === "surge") ? 0.55 : 1;
      op *= Math.max(0, 1 - L.mix * keep);
    }
    u.uOpacity.value = Math.max(0, op);
    m.visible = u.uOpacity.value > 0.004;
    if (m.visible) faceCameraYaw(m);
  }

  /* ---- the whole timeline, one function --------------------------------- */
  function stepSequence(dt) {
    const L = live, P = L.style;
    L.t += dt;
    const t = L.t;

    // a mode flip mid-sequence (menu, survival, prison) must never strand
    // geometry in the world.
    if (L.mode && CBZ.game && CBZ.game.mode !== L.mode) { endSequence(); return; }

    // ---- scheduled world beats ------------------------------------------
    for (let i = L.pending.length - 1; i >= 0; i--) {
      if (t >= L.pending[i].t) {
        const p = L.pending.splice(i, 1)[0];
        try { firePending(p); } catch (e) {}
      }
    }

    // ---- ATMOSPHERE: the cheapest "this is nuclear" cue in the whole file.
    // One Color.lerp per frame on scene.fog.color paints the ENTIRE horizon,
    // because core/sky.js@99 draws its dome's horizon stop from exactly this
    // colour. No geometry, no fill, no draw call. And core/daynight.js@2
    // re-copies its own fog colour every single frame, so this is stateless:
    // there is nothing to restore, nothing to leak, and an abort mid-arc is
    // clean by construction. (systems/weather.js@90 lerps rain-grey on top
    // afterwards, which is the correct precedence — weather still wins.)
    // THE SKY DIPS TOO. flashRadiance is the same curve the div and the fireball
    // run on, so the horizon goes dark with the minimum and floods back with the
    // second pulse instead of holding a flat white through the one beat the
    // event is famous for. Past the pulse window it returns exactly 1 and the
    // three-stage colour walk below is untouched.
    const rad0 = flashRadiance(t, P);
    if (CBZ.CONFIG.NUKE_FX_SKY && scene.fog && scene.fog.color) {
      // white-out -> the fireball's own orange bounce -> ash overcast -> gone
      let k, hex;
      if (t < 0.55)      { hex = 0xfff4e2; k = (0.92 * (1 - t / 0.55) + 0.30) * (0.34 + 0.66 * rad0); }
      else if (t < 3.5)  { hex = 0xff9440; k = 0.62 * (1 - (t - 0.55) / 2.95) + 0.22; }
      else               { hex = 0x8d8478; k = 0.55 * Math.max(0, 1 - (t - 3.5) / (L.dur - 3.5)); }
      _fogTint.setHex(hex);
      L.fogK = k;
      scene.fog.color.lerp(_fogTint, clamp(k, 0, 0.95));
    }

    // ---- the invisible shock front (drives condensation and gameplay) -----
    const r = frontRadius(dt);
    // Legacy A/B only. The nuclear base-surge InstancedMesh is the bounded,
    // coherent dust read; this loop used to mint hundreds of ordinary puff
    // sprites around an otherwise invisible circle.
    if (L.legacyPuffs && t < L.frontLife && r < L.maxR) {
      L.dustAcc += dt;
      const nd = Math.round(CBZ.qScale ? CBZ.qScale(0, 3) : 3);
      if (L.dustAcc > 0.3 && nd > 0 && CBZ.cityDustKick) {
        L.dustAcc = 0;
        for (let i = 0; i < nd; i++) {
          const a = rng() * 6.2832;
          const px = L.x + Math.cos(a) * r, pz = L.z + Math.sin(a) * r;
          try { CBZ.cityDustKick(px, floorAt(px, pz) + 0.6, pz, 1.5 + L.q); } catch (e) {}
        }
      }
    }

    /* ---- (a) THE WHITE DOME. The first 1.5 seconds, and the beat this
       sequence never had. Radius is the Taylor-Sedov t^0.4 law (wdomeRadius,
       which is where the arithmetic is written down); everything else here
       is the handover.

       THE DOUBLE FLASH IS ON IT TOO, and that matters more here than
       anywhere: this is the only OPAQUE layer in the sequence, so when the
       shock front goes dark the dome does not merely dim — it stops hiding
       what is behind it, and the skyline it was silhouetting comes back for
       a few frames before the second pulse buries it again. That is the
       physical reading of the minimum and it is free.

       THE LIFT is the last thing it does: over WDOME_OUT the dome fades and
       rises off its seat, revealing the additive fireball shell that has
       been growing behind it since t=0. Nothing is created at the handover;
       the dome is the opaque reading of the same ball and the shell is the
       graded one, so they cannot disagree about where the fireball is. */
    if (L.wdome) {
      const rad = wdomeRadius(t, L);
      // it lifts as it lets go — the buoyant rise starts at about 1 s, and
      // riseAt's own window opens at 0.9, so this is the seam between them.
      const lift = clamp((t - WDOME_T) / WDOME_OUT, 0, 1);
      L.wdome.position.set(L.x, L.wdomeY + rad * 0.30 * lift, L.z);
      // never a zero scale: t^0.4 is exactly 0 at t=0 and a singular matrix
      // is how a mesh ends up with NaN in its bounds. (frustumCulled is
      // already off via park(), so a 1 cm sphere for one frame costs nothing.)
      const sr = Math.max(0.01, rad);
      L.wdome.scale.set(sr, sr * (0.92 + 0.16 * lift), sr);
      // Opaque through the first second (the plate has NO detail inside it),
      // then out. rad0 is the shared pulse: one curve, and now five readers.
      const op = (1 - ease(lift)) * (0.10 + 0.90 * rad0);
      L.wdome.material.opacity = Math.max(0, op);
      if (lift >= 1 || L.wdome.material.opacity <= 0.004) {
        L.wdome.visible = false; L.wdome = null;
      }
    }

    // ---- FIREBALL: ignite, stall, rise, cool -----------------------------
    const rise = riseAt(t, L);                              // ONE curve, four readers
    if (L.shell) {
      const grow = 1 - Math.exp(-t * 5.5);                 // fast punch, then stall
      const rad = L.R * (grow * (1 + rise * 0.35));
      const y = L.by + L.R * 0.55 + (L.riseH * 0.92 - L.R * 0.55) * rise;
      L.shell.position.set(L.x, y, L.z);
      L.shell.scale.setScalar(Math.max(0.01, rad));
      const u = L.shell.material.uniforms;
      const age = clamp(t / 7, 0, 1);
      rampColor(u.uRimColor.value, age * 0.55);
      rampColor(u.uCoreColor.value, Math.max(0, age * 0.9 - 0.04));
      /* COLOUR EVOLUTION, and the two things the shared RAMP alone cannot say.

         (1) BLUE-WHITE FIRST. The RAMP starts at a warm white because it is
             shared with the cloud billboards, but the isothermal ball is tens of
             thousands of kelvin for the first fraction of a second and reads
             blue-white. One lerp toward BLUE_WHITE, gone by ~0.35 s, after which
             the RAMP owns the whole cooling arc (white -> yellow -> orange ->
             deep red) exactly as before.

         (2) BRIGHTER THAN THE SUN, literally. core/renderer.js runs
             CustomToneMapping over every non-raw ShaderMaterial, so a colour
             ABOVE 1.0 is not clipped — it rolls off. Pushing the core to ~3.4x
             white is therefore how this file draws "far brighter than the sun"
             with no bloom pass, no second material and no extra fill: the tone
             mapper flattens the middle of the ball to hard white and leaves the
             rim graded, which is exactly what a fireball looks like on film.
             The gain rides flashRadiance, so it COLLAPSES at the minimum and
             floods back on the second pulse. That — not the DOM div — is what
             makes the double flash a property of the explosion. */
      const blue = 1 - ease(t / 0.35);
      if (blue > 0.001) {
        u.uRimColor.value.lerp(BLUE_WHITE, blue * 0.8);
        u.uCoreColor.value.lerp(BLUE_WHITE, blue);
      }
      const gain = 1 + 2.4 * rad0 * (1 - ease((t - 0.1) / 1.7));
      u.uCoreColor.value.multiplyScalar(gain);
      u.uRimColor.value.multiplyScalar(1 + (gain - 1) * 0.45);
      /* SEQUENCED, NOT STACKED: the fireball shell is the single most expensive
         layer here (a DoubleSide additive sphere that can fill most of the
         screen from close range), so it is retired at 3.9s — the exact moment
         the toroidal roll below fades in, rather than five seconds after it.
         That one number is the difference between 8 concurrent layers and 7,
         and it is why the roll could be pulled half a second earlier for free.
         The `rad0` factor is the shock front swallowing the ball: the alpha
         goes with the radiance, so at the minimum the ball is not merely hidden
         by the veil, it has actually stopped emitting. */
      u.uOpacity.value = Math.max(0, Math.min(1, t / 0.12) * (1 - ease((t - 2.15) / 1.75)) *
                                     (0.14 + 0.86 * rad0));
      if (u.uOpacity.value <= 0.004 && t > 3.5) { L.shell.visible = false; L.shell = null; }
    }

    /* ---- SHOCK VEIL -> WILSON CLOUD. ONE shell, TWO readings, and the second
       is what the first becomes.

         0.06-0.30  the front goes OPAQUE and swallows the fireball. This is the
                    physical CAUSE of the minimum, and until now the file drew
                    the effect (a dip on a white div) without ever drawing the
                    cause. It is rendered at renderOrder 9, ABOVE the additive
                    fireball, because that is the only way one transparent layer
                    can hide an additive one — see the note in buildPool.
         0.30-0.62  it thins as the second thermal pulse burns back through it.
         0.62-1.90  what is left is the WILSON CONDENSATION CLOUD: the rarefaction
                    behind the front drops the pressure, water condenses, and a
                    transient near-white SHELL stands in the air and then
                    evaporates. It is a shell and never a ball — uCore 0.06 with
                    uRimPow 2.6 is exactly that, and it was already right.

       Both readings are the same expanding sphere at the same wave speed, so
       this costs one retiming and no new layer. NUKE_FX_VEIL false returns the
       old behaviour: start at 0.28, one flat 0.34 alpha, no opaque phase. */
    if (L.dome) {
      const veil = CBZ.CONFIG.NUKE_FX_VEIL && P.dbl;
      const t0 = veil ? 0.06 : 0.28;
      if (t >= t0) {
        const dr = Math.min(r, L.R * (veil ? 1.35 : 1) + (t - t0) * L.spd * 0.85);
        L.dome.visible = true;
        L.dome.position.set(L.x, L.by + dr * 0.16, L.z);
        L.dome.scale.set(dr, dr * 0.72, dr);
        let op;
        if (!veil) {
          op = 0.34 * (1 - ease((t - 0.5) / 1.1));
        } else {
          // ramp to near-opaque across the first pulse's decay, then hand over
          // to the condensation reading on the same curve the fireball uses, so
          // the veil is thickest at exactly the frame the fireball is dimmest.
          const opaque = ease(t / 0.20) * (1 - rad0);
          const wilson = 0.30 * (1 - ease((t - 0.62) / 1.25));
          op = Math.max(0.88 * opaque, wilson);
        }
        L.dome.material.uniforms.uOpacity.value = Math.max(0, op);
        if (t > 1.9) { L.dome.visible = false; L.dome = null; }
      }
    }

    /* The coherent nuclear path is the bounded depth-writing lobe field from
       handoff to fade-out. The baked mushroom remains only as a flag-off
       legacy/fallback tier; making it the default is what exposed the entire
       cloud as one camera-facing picture. */
    const mix = L.coherentCloud ? 0 : (real() ? impostorMix(L) : 0);
    L.mix = mix;
    stepImpostor(t, L, mix);
    /* ---- AFTERMATH MATURATION (NUKE_FX_AFTERMATH) -------------------------
       After the 34 s formation sequence the SAME lobe field keeps growing
       toward the researched mature cloud (nukeDims: 5.1 km cap, centre at
       8 km) over ~3 minutes — a real 16 kt cloud takes 4-6 minutes to
       stabilise, and the drawn one stops pretending to be finished at 34 s.
       This mutates the live targets the volume writers already read
       (capW/riseH/stemW), so stepVolumes costs exactly what it did; the
       12 Hz matrix-write gate in stepVolumes bounds the aftermath's cost. */
    if (L.matureFrom && t > L.matureFrom && L.drawDims && L.dims) {
      const F = L.drawDims, D = L.dims;
      const k = ease(clamp((t - L.matureFrom) / 170, 0, 1));
      L.capW = (F.capW + (D.capW - F.capW) * k) / BLOOM_MAX;
      L.capH = F.capH + (D.capH - F.capH) * k;
      L.capThick = L.capH / Math.max(1, L.capW * BLOOM_MAX);
      L.riseH = F.capY + (D.capY - F.capY) * k;
      L.stemW = (F.stemW + (D.stemW - F.stemW) * k) * 0.5;
    }
    // The 3D volumes carry the actual mushroom silhouette from every angle.
    stepVolumes(t, L, mix);

    // ---- procedural surface detail over the 3D cap/stem/surge -------------
    for (let i = 0; i < L.bills.length; i++) {
      const b = L.bills[i];
      // Stagger secondary texture lobes until the condensation veil has thinned.
      if (b.t0 == null) {
        b.t0 = b.role === "stem" ? 0.8
             : b.role === "cap" ? 0.9
             : b.role === "surge" ? 1.4
             : b.role === "cap2" ? 1.9
             : 2.2;                          // collar
      }
      stepBill(b, t, L);
    }

    // Listener pressure, shake and sound are emitted by the same impact field
    // that advances `r`; the visual sequence never invents a second lens clock.

    // ---- ASH FALL — the only per-sequence allocation, eight seconds late --
    // NOTE the count is NOT qScaled here: systems/fx.js's particleCloud already
    // multiplies `count` by CBZ.qScale(0.4, 1) internally. Scaling it twice (as
    // this used to) meant tier 2 got 0.7*0.7 = HALF the motes it asked for and
    // tier 0 got literally zero.
    if (P.ash && CBZ.CONFIG.NUKE_FX_ASH && !L.ash && t > 8 && CBZ.fx && CBZ.fx.particleCloud) {
      const n = 260;
      if (L.q > 0.3) {                    // tier 2+ only
        try {
          L.ash = CBZ.fx.particleCloud({
            count: n, radius: 62, top: 46, bottom: -2, mode: "fall",
            vMin: 1.6, vMax: 4.2, drift: 1.1, driftZ: 0.5,
            color: 0x9a9082, size: 0.24, opacity: 0.42,
          });
          L.ash.setActive(0.9);
        } catch (e) { L.ash = null; }
      }
    }
    if (L.ash) {
      const c = camPos();
      const fade = t > L.dur - 8 ? Math.max(0, 1 - (t - (L.dur - 8)) / 8) : 1;
      L.ash.setActive(0.9 * fade);
      try { L.ash.update(dt, c ? c.x : L.x, c ? c.y : L.y + 20, c ? c.z : L.z); } catch (e) {}
    }

    if (t >= L.dur) endSequence();
  }

  function endSequence() {
    const L = live;
    live = null;
    // Meshes are session-lifetime pool members: park them, never dispose.
    // Runs even from a half-built sequence (a throw in beginSequence), which
    // is the only way geometry could ever be stranded visible in the world.
    const mm = [
      POOL.shell, POOL.dome, POOL.wdome, POOL.imp,
      POOL.capVol, POOL.stemVol, POOL.surgeVol, POOL.hotVol,
      POOL.crownVol, POOL.glowVol,
    ];
    for (let i = 0; i < mm.length; i++) {
      const m = mm[i];
      if (!m) continue;
      m.visible = false;
      if (m.isInstancedMesh) m.count = 0;
      if (m.material && m.material.uniforms && m.material.uniforms.uOpacity) m.material.uniforms.uOpacity.value = 0;
      if (m.material && m.material.opacity != null) m.material.opacity = 0;
    }
    for (let i = 0; i < POOL.bills.length; i++) {
      POOL.bills[i].visible = false;
      POOL.bills[i].material.uniforms.uOpacity.value = 0;
    }
    // The ash cloud is the one thing we built: it is ours to dispose.
    if (L && L.ash) { try { L.ash.dispose(); } catch (e) {} }
  }
  CBZ.cityNukeFxAbort = endSequence;

  /* ============================================================
     THE NEAR FIELD

     A coherent nuke is now visual-only here: its dome/fireball/cloud are this
     composer's job, while impactbus's analytic detonation field owns people,
     cars, buildings, glass, shake and the pressure report. Calling crashfx's
     RPG/airstrike prefab underneath that path was the hidden second explosion:
     hundreds of puffs, an immediate cannon sound and grenade-style body launch.

     MOABs and an explicit master-revert still reuse that mature conventional
     primitive. Its internal radius*power convention is preserved so the
     fallback nuke remains a 126 m fireball rather than the historical 14 m bug.
     ============================================================ */
  function nearField(x, y, z, row, opts) {
    // The default nuclear composer already draws the flash, dome, fireball and
    // cloud; the analytic field owns every consequence and the eventual sound.
    // Calling the generic airstrike here used to add a hidden RPG damage pass,
    // immediate cannon report, shake/hitstop and vehicle cascade underneath it.
    // Keep that primitive only for MOABs and the explicit master-revert path.
    if ((row.id || "nuke") === "nuke" && CBZ.CONFIG.NUKE_FX_V1 !== false &&
        coherentCloud() && POOL.shell && POOL.capVol) return;
    const fn = CBZ.cityAirstrikeExplosion || CBZ.cityExplosion;
    if (!fn) return;
    try {
      fn(x, z, {
        power: Math.max(0.5, (+row.power || 4) * (opts.scale > 0 ? +opts.scale : 1)),
        radius: Math.max(1, +row.radius || 14),
        y: y,
        byPlayer: !!opts.byPlayer, noDamage: !!opts.noDamage,
        ordnance: row.id || "nuke", _impact: true,
        // The nuclear composer owns the dome, fireball and cloud. Asking the
        // generic airstrike prefab for another ~400 flame/smoke sprites is the
        // obscuring pile and frame spike this path exists to remove; damage,
        // structure damage, sound, shake and hit-stop still run in crashfx.
        noVisual: (row.id || "nuke") === "nuke" && coherentCloud(),
      });
    } catch (e) {}
  }

  /* ============================================================
     THE COMPOSERS — what the bus actually calls.
     `fn(x, y, z, row, opts)`; draws only.
     ============================================================ */
  function compose(styleName) {
    return function (x, y, z, row, opts) {
      opts = opts || {};
      row = row || {};
      if (!CBZ.CONFIG.NUKE_FX_V1) {                 // master revert
        nearField(x, y, z, row, opts);
        return;
      }
      nearField(x, y, z, row, opts);
      if (live) {
        // The photographed cloud pool is one shared GPU spectacle. A second
        // flash does not double its fill cost; impactbus still compiles that
        // detonation's complete people/car/building/glass/audio field after
        // this composer returns, so no physical consequence is discarded.
        if (!opts.quiet) whiteout(STYLE[styleName].white * 0.4, 0.6, false);
        return;
      }
      try { beginSequence(x, y, z, styleName, row, opts); } catch (e) { try { endSequence(); } catch (e2) {} }
    };
  }
  const composeNuke = compose("nuke");
  const composeMoab = compose("moab");

  /* ---- PUBLIC: fire the spectacle without the bus ------------------------ */
  // CBZ.cityNukeFX(x, y, z, opts) — opts {kind:"nuke"|"moab", power, radius,
  // wave, quiet, noDamage, byPlayer, scale}. Used by city/strategic.js's
  // nukeDetonate (which can now drop its private cloud) and by probes.
  CBZ.cityNukeFX = function (x, y, z, opts) {
    opts = opts || {};
    const kind = opts.kind === "moab" ? "moab" : "nuke";
    let row = null;
    if (CBZ.impact && CBZ.impact.row) { try { row = CBZ.impact.row(kind); } catch (e) {} }
    // Defaults MIRROR systems/impactbus.js's rows verbatim (power 9 / radius 14
    // for the nuke, 4.6 / 26 for the MOAB) so a probe that fires this with no bus
    // loaded gets the same 126 m fireball the real row produces. `radius` here
    // is the row field, NOT the effective reach — fireR() does that multiply.
    row = Object.assign(
      { id: kind, power: kind === "moab" ? 4.6 : 9, radius: kind === "moab" ? 26 : 14,
        wave: kind === "moab" ? { speed: 140, maxR: 320 }
          : { model: "nuclear", speed: 343, maxR: 3276 } },
      row || {},
      opts.row || {}
    );
    if (opts.power != null) row.power = opts.power;
    if (opts.radius != null) row.radius = opts.radius;
    if (opts.wave !== undefined) row.wave = opts.wave;
    (kind === "moab" ? composeMoab : composeNuke)(x, y == null ? floorAt(x, z) + 1.2 : y, z, row, opts);
    return live;
  };

  /* ============================================================
     CBZ.cityBombWalk(points, opts) — CARPET BOMBING.

     Research: a bomb walk is a SEQUENCE, not an effect. ONE pooled small-
     explosion prefab fired N times with staggered delays matching release
     interval x ground speed, with dust merging along the line. No mushroom
     stages, no per-bomb bespoke FX.

     points: [{x,z} | {x,y,z}] along the ground track (the B-2's release
             ladder). Decimated, never truncated, so a long stick keeps its
             LENGTH when the budget shrinks.
     opts:   { kind, interval, delay, detonate, by, byPlayer, dirx, dirz,
               scale, onEach }

     TWO MODES, and the DEFAULT IS DRAW-ONLY ON PURPOSE:

       detonate: false (default) — walks the DUST along the line and nothing
         else. This is what city/strategic.js's B-2 bomb run wants: it already
         simulates every falling bomb and detonates it on impact, so a walk
         that also detonated would bill every bomb TWICE (double damage,
         double kills, double wanted level). The dust merge is the one thing
         its run was missing.
       detonate: true — the full prefab walk: one ordnance row fired N times
         on the stagger, each through CBZ.detonate so the structural ledger,
         the kill bus and the crime system all see it exactly once. For any
         caller that has no bomb sim of its own (a scripted mission strike, a
         cutscene, an off-screen bombardment).

     `delay` offsets the whole walk, which is how a caller with a real fall
     time (release altitude -> impact) lines the dust up with its own bombs.
     ============================================================ */
  const walks = [];
  const WALK_MAX = 2, WALK_POINTS = 24;

  CBZ.cityBombWalk = function (points, opts) {
    opts = opts || {};
    if (!points || !points.length) return null;
    const kind = opts.kind || "bomb";
    const interval = clamp(opts.interval == null ? 0.24 : +opts.interval, 0.06, 3);

    // Decimate to the cap. In DRAW-ONLY mode the quality tier thins the dust
    // line too (tier 0 drops ~40% of the puffs); in DETONATE mode it must NOT,
    // because the number of bombs that actually go off is gameplay and has to
    // be identical on every client at every quality setting.
    // NOTE FOR CALLERS: in DETONATE mode decimation past WALK_POINTS drops real
    // ordnance, so a 60-point stick delivers 20 warheads, not 60. That is why
    // city/strategic.js's RUN_MAX is 24 — exactly WALK_POINTS. Read `.points`
    // off the returned handle rather than trusting your own count if you might
    // ever exceed it, or the number you announce to the player will be a lie.
    const willDetonate = opts.detonate === true;
    const budget = willDetonate
      ? WALK_POINTS
      : Math.max(2, Math.round(WALK_POINTS * (CBZ.qScale ? CBZ.qScale(0.55, 1) : 1)));
    const stride = Math.max(1, Math.ceil(points.length / budget));
    const pts = [];
    for (let i = 0; i < points.length; i += stride) {
      const p = points[i];
      if (!p) continue;
      pts.push({ x: +p.x || 0, y: p.y == null ? null : +p.y, z: +p.z || 0 });
    }
    if (!pts.length) return null;

    const walk = {
      pts: pts, i: 0, t: -Math.max(0, +opts.delay || 0), interval: interval, kind: kind,
      detonate: willDetonate,
      by: opts.by || null, byPlayer: !!opts.byPlayer, scale: opts.scale || 1,
      dirx: opts.dirx || 0, dirz: opts.dirz || 0, onEach: opts.onEach || null,
      prev: null, dead: false,
    };
    if (CBZ.CONFIG.BOMB_WALK_V1 === false) {          // revert: no stagger at all
      for (let i = 0; i < pts.length; i++) dropOne(walk, pts[i]);
      return { cancel: function () {}, points: pts.length };
    }
    while (walks.length >= WALK_MAX) walks.shift();   // oldest walk gives way
    walks.push(walk);
    return {
      points: pts.length,
      cancel: function () { walk.dead = true; },
      done: function () { return walk.dead || walk.i >= walk.pts.length; },
    };
  };
  CBZ.cityBombWalkActive = function () { return walks.length; };

  function dropOne(walk, p) {
    const y = p.y == null ? floorAt(p.x, p.z) + 1.2 : p.y;
    // ---- the ordnance itself (opt-in — see the two-modes note above) ------
    if (walk.detonate) {
      if (CBZ.detonate) {
        try {
          CBZ.detonate(p.x, y, p.z, walk.kind, {
            by: walk.by, byPlayer: walk.byPlayer, scale: walk.scale,
            dirx: walk.dirx, dirz: walk.dirz,
          });
        } catch (e) {}
      } else if (CBZ.cityAirstrikeExplosion) {
        // degrade-safe: the bus is optional, the walk is not
        try { CBZ.cityAirstrikeExplosion(p.x, p.z, { power: 2.4, radius: 13, byPlayer: walk.byPlayer }); } catch (e) {}
      }
    }
    // ---- DUST MERGING along the line: the stick reads as ONE rolling wall
    // of dust rather than N unrelated craters. Pooled crashfx kicks only —
    // no pool of ours, and the count rides the quality tier.
    if (CBZ.cityDustKick) {
      try { CBZ.cityDustKick(p.x, y, p.z, walk.detonate ? 1.4 : 2.0); } catch (e) {}
      const prev = walk.prev;
      if (prev) {
        const nMid = Math.round(CBZ.qScale ? CBZ.qScale(0, 2) : 2);
        for (let i = 1; i <= nMid; i++) {
          const f = i / (nMid + 1);
          const mx = prev.x + (p.x - prev.x) * f, mz = prev.z + (p.z - prev.z) * f;
          try { CBZ.cityDustKick(mx, floorAt(mx, mz) + 0.7, mz, 1.6); } catch (e) {}
        }
      }
    }
    walk.prev = p;
    if (walk.onEach) { try { walk.onEach(p.x, y, p.z); } catch (e) {} }
  }

  function stepWalks(dt) {
    for (let w = walks.length - 1; w >= 0; w--) {
      const walk = walks[w];
      if (walk.dead) { walks.splice(w, 1); continue; }
      walk.t += dt;
      // bounded catch-up: a stalled frame drops at most 3 bombs at once rather
      // than dumping the whole stick in one frame.
      let fired = 0;
      while (walk.i < walk.pts.length && walk.t >= walk.i * walk.interval && fired < 3) {
        dropOne(walk, walk.pts[walk.i]);
        walk.i++; fired++;
      }
      if (walk.i >= walk.pts.length) walks.splice(w, 1);
    }
  }

  /* ============================================================
     LAZY WIRING — register with the bus whenever it shows up, whatever the
     script order ends up being (city/nukefx.js may legitimately load before
     systems/impactbus.js). Idempotent, one boolean test per frame.
     ============================================================ */
  let wired = false;
  function wire() {
    if (wired || !CBZ.impact || !CBZ.impact.fx) return;
    wired = true;
    try {
      CBZ.impact.fx("nuke", composeNuke);
      CBZ.impact.fx("moab", composeMoab);
      // The bus's "moab" row still names the generic "heavy" composer. Point
      // it here — but ONLY if nobody has changed it, so when the bus's own
      // table adopts fx:"moab" this becomes a no-op instead of a fight.
      if (CBZ.CONFIG.NUKE_FX_MOAB && CBZ.impact.row && CBZ.impact.define) {
        const row = CBZ.impact.row("moab");
        if (row && row.fx === "heavy") {
          const spec = Object.assign({}, row);
          spec.fx = "moab";
          CBZ.impact.define("moab", spec);
        }
      }
    } catch (e) {}
  }

  // A fresh run must not inherit a mushroom cloud. crashfx.js's
  // cityBlastFxReset is the existing run-reset chokepoint; wrap it the same
  // lazy, marker-copying way structural.js wraps cityGlassReset.
  let resetWrapped = false;
  function wrapReset() {
    if (resetWrapped) return;
    const orig = CBZ.cityBlastFxReset;
    if (typeof orig !== "function") return;
    resetWrapped = true;
    if (orig._nukeFxWrapped) return;
    const wrapped = function () {
      try { endSequence(); flashClear(); walks.length = 0; } catch (e) {}
      return orig.apply(this, arguments);
    };
    for (const k in orig) if (k.endsWith("Wrapped")) wrapped[k] = orig[k];
    wrapped._nukeFxWrapped = true;
    CBZ.cityBlastFxReset = wrapped;
  }

  /* ============================================================
     THE ONE UPDATER. onAlways(9.62) — immediately after crashfx.js's own
     pooled-FX ticker at 9.5 (9.6 is taken by city/vehicles.js), and on the
     ALWAYS chain on purpose: a nuke that kills the player must still finish
     its arc and clean up its geometry while the run is over, instead of
     freezing a 300-metre cloud in the sky and a white sheet over the menu.
     It also has to run AFTER core/daynight.js@2 (which re-copies scene.fog
     .color every frame) and BEFORE core/sky.js@99 (which paints its horizon
     stop FROM scene.fog.color) — that ordering is what makes the atmosphere
     drive above both self-restoring and free.
     Costs three length/null checks when nothing is exploding.
     ============================================================ */
  if (CBZ.onAlways) CBZ.onAlways(9.62, function (dt) {
    wire();
    wrapReset();
    if (!live && !walks.length && !flash) return;
    const d = dt > 0.25 ? 0.25 : dt;     // spike-cap: a stalled frame must not teleport the front
    if (flash) { try { stepFlash(d); } catch (e) { flash = null; } }
    if (live) { try { stepSequence(d); } catch (e) { endSequence(); } }
    if (walks.length) { try { stepWalks(d); } catch (e) { walks.length = 0; } }
  });

  /* ============================================================
     (e) THE FIREBALL LIGHTS THE WORLD — onAlways(94.6).

     scene.fog already turned the SKY (see the atmosphere drive above, which
     core/sky.js paints its horizon band from). Nothing turned the GROUND,
     and that is the difference between a picture of an explosion and being
     next to one: in the reference plate every surface for kilometres is
     orange, and the shadows all point away from the cloud.

     WHY 94.6 AND NOT 9.62 (this is the whole trick, and getting it wrong
     would have made the feature a silent no-op):
       core/loop.js runs EVERY onUpdate, then EVERY onAlways. Inside the
       always chain the order is
           core/daynight.js @2      writes sun/hemi colour + intensity
           city/nukefx.js   @9.62   the sequence (fog drive lives here)
           core/gfx.js      @94.5   lightRig.finalize() — REWRITES sun and
                                    hemi from the keyframes, then applies the
                                    tone-map gain
           core/sky.js      @99     paints the dome from scene.fog.color
     A light write at 9.62 is therefore clobbered 85 orders later by a
     function whose entire job is to be the last writer. core/lights.js's
     own header calls this "the three-writer problem" and names the three;
     this is the fourth, and it takes the one slot that survives.

     IT IS STATELESS, exactly like the fog drive, and for the same reason:
     daynight@2 and finalize@94.5 rewrite all four values every single frame,
     so there is nothing to save, nothing to restore, and an abort mid-arc —
     or a mode flip, or the player dying — leaves nothing behind.

     IT ADDS NO LIGHT. In r128 the shader program cache key depends on the
     COUNT and TYPES of lights in the scene, so introducing a PointLight at
     the fireball would recompile every material in the world in the frame a
     warhead lands. Only values are written here, which costs nothing.

     THE HEMISPHERE IS PUSHED HARDER THAN THE SUN, and that is physics, not
     a dodge: during the thermal pulse the burst overwhelms the sun from a
     direction the shadow cascade is not aimed at, so what you actually see
     is flat blinding light with the shadows WASHED OUT — then, as the
     hemisphere falls back, the sun's shadows return under an orange sky.
     Re-aiming the one shadow-casting light at a moving fireball would force
     a full cascade re-render every frame for a 30 s effect; this reproduces
     the read for free.
     ============================================================ */
  const LIGHT = {
    SUN_K: 2.4,        // peak multiplier added to sun intensity
    HEMI_K: 4.2,       // ...and to the ambient. Higher on purpose — see above.
    SUN_MIX: 0.88,     // how far the sun's colour is pulled to the fire
    HEMI_MIX: 0.94,
    NEAR: 300,         // m — full authority inside this
    FAR: 2400,         // m — floored at FLOOR past this
    FLOOR: 0.22,
  };
  const _lightC = new THREE.Color();
  const FIRE_WHITE = new THREE.Color(0xfff6e4);
  const FIRE_ORANGE = new THREE.Color(0xff7c2a);
  const FIRE_EMBER = new THREE.Color(0xc4491a);
  // luminosity 0..1 of the event AT THE LENS, for a given sequence time.
  // Exported through the audit so the curve is a number, never a screenshot.
  function fireLum(t, L) {
    const P = L.style;
    // the thermal pulse owns the first ~72% of the whiteout window and rides
    // the SAME curve the div, the fireball, the sky and the dome ride.
    const pulse = flashRadiance(t, P);
    const flashK = Math.max(0, 1 - t / Math.max(0.01, P.white * 0.72));
    // ...then the burn: the fireball and the incandescent cap, decaying, and
    // shut cleanly off across the sequence's own last 10 s.
    const tail = 1 - ease((t - (P.dur - 10)) / 10);
    const burn = Math.exp(-Math.max(0, t - 0.6) / 5.2) * Math.max(0, tail);
    return clamp(Math.max(flashK * pulse, burn * 0.72), 0, 1);
  }
  function lightAtten(L) {
    const d = camDist(L.x, L.by + L.R, L.z);
    if (d <= LIGHT.NEAR) return 1;
    const u = clamp((d - LIGHT.NEAR) / (LIGHT.FAR - LIGHT.NEAR), 0, 1);
    return 1 - (1 - LIGHT.FLOOR) * u;
  }
  if (CBZ.onAlways) CBZ.onAlways(94.6, function () {
    if (!live || !v2() || !CBZ.CONFIG.NUKE_FX_SKY) return;
    const L = live;
    const k = fireLum(L.t, L) * lightAtten(L);
    if (k <= 0.004) return;
    // white at the flash, orange through the burn, ember at the end
    if (L.t < 0.45) _lightC.copy(FIRE_WHITE).lerp(FIRE_ORANGE, L.t / 0.45);
    else _lightC.copy(FIRE_ORANGE).lerp(FIRE_EMBER, clamp((L.t - 0.45) / 7, 0, 1));
    const sun = CBZ.sun, hemi = CBZ.hemi, bnc = CBZ.bounce;
    if (sun) {
      sun.intensity *= 1 + LIGHT.SUN_K * k;
      if (sun.color) sun.color.lerp(_lightC, LIGHT.SUN_MIX * k);
    }
    if (hemi) {
      hemi.intensity *= 1 + LIGHT.HEMI_K * k;
      if (hemi.color) hemi.color.lerp(_lightC, LIGHT.HEMI_MIX * k);
      // the GROUND ambient goes too — the deck under everything is lit by
      // this, and a ground colour that stayed green is the tell.
      if (hemi.groundColor) hemi.groundColor.lerp(_lightC, 0.78 * k);
    }
    // the bounce fill carries the colour of what it bounced off, and today
    // what it bounced off is on fire.
    if (bnc && bnc.color) { bnc.color.lerp(_lightC, 0.85 * k); bnc.intensity *= 1 + 1.8 * k; }
  });

  /* ============================================================
     DEV/QA — read the whole spectacle's numbers from a CDP probe with no
     rendering at all (CLAUDE.md's closed loop is math over live state).
     ============================================================ */
  CBZ.nukeFxDebug = function () {
    return {
      wired: wired,
      live: live ? {
        kind: live.kind, t: +live.t.toFixed(2), r: +live.r.toFixed(1),
        maxR: +live.maxR.toFixed(1), eff: +live.eff.toFixed(1),
        gy: +live.y.toFixed(1), burstY: +live.by.toFixed(1),
        R: +live.R.toFixed(1), capW: +live.capW.toFixed(1), riseH: +live.riseH.toFixed(1),
        frontLife: +live.frontLife.toFixed(2), fogK: +live.fogK.toFixed(3),
        burnR: +(live.burnR || 0).toFixed(1),
        rise: +riseAt(live.t, live).toFixed(3),
        capY: +capYAt(riseAt(live.t, live), live).toFixed(1),
        radiance: +flashRadiance(live.t, live.style).toFixed(3),
        bills: live.bills.length,
        pending: live.pending.length, ash: !!live.ash,
        shell: !!live.shell, dome: !!live.dome,
        volume: !!live.volume, volumeCounts: live.volN || null,
        groundRings: 0,
        // NUKE_FX_V2 live state
        wdome: !!live.wdome,
        wdomeR: +wdomeRadius(live.t, live).toFixed(1),
        capFlat: +capFlatAt(live.t, live).toFixed(3),
        lum: +fireLum(live.t, live).toFixed(3),
        lumAtLens: +(fireLum(live.t, live) * lightAtten(live)).toFixed(3),
        crownN: live.crownN || 0,
        // NUKE_REAL_SCALE live state: which tier is drawing, and at what size
        mix: +(live.mix || 0).toFixed(3),
        impostor: !!(POOL.imp && POOL.imp.visible),
        realScale: !!live.dims,
        yieldKt: live.dims ? +live.dims.W.toFixed(2) : null,
        capWNow: +(live.capW * bloomAt(live.t, live)).toFixed(0),
        capYNow: +capYAt(riseAt(live.t, live), live).toFixed(0),
        stemWNow: +(live.stemW * 2).toFixed(0),
        surgeDraw: +(live.surgeDraw || 0).toFixed(0),
        cloudPhase: +cloudPhaseAt(live.t, live).toFixed(3),
        genericPuffEvents: live.genericPuffEvents || 0,
        legacyPuffs: !!live.legacyPuffs,
        coherentCloud: !!live.coherentCloud,
      } : null,
      flash: flash ? { t: +flash.t.toFixed(2), dur: flash.dur, peak: flash.peak, keys: flash.keys.length } : null,
      walks: walks.map(function (w) { return { kind: w.kind, i: w.i, n: w.pts.length }; }),
      pool: { bills: POOL.bills.length, built: !!POOL.shell },
      q: +q01().toFixed(2),
      flags: {
        v1: !!CBZ.CONFIG.NUKE_FX_V1, shell: !!CBZ.CONFIG.NUKE_FX_SHELL,
        ash: !!CBZ.CONFIG.NUKE_FX_ASH, moab: !!CBZ.CONFIG.NUKE_FX_MOAB,
        sky: !!CBZ.CONFIG.NUKE_FX_SKY, walk: !!CBZ.CONFIG.BOMB_WALK_V1,
        pulse: !!CBZ.CONFIG.NUKE_FX_PULSE, veil: !!CBZ.CONFIG.NUKE_FX_VEIL,
        rise: !!CBZ.CONFIG.NUKE_FX_RISE, roll: !!CBZ.CONFIG.NUKE_FX_ROLL,
        glass: !!CBZ.CONFIG.NUKE_FX_GLASS, v2: v2(),
        phasedCloud: phasedCloud(),
        coherentCloud: coherentCloud(),
        legacyPuffs: CBZ.CONFIG.NUKE_FX_LEGACY_PUFFS === true,
      },
    };
  };

  /* CBZ.nukeFxSize(kind, opts) — what the spectacle WOULD be, without firing it.
     The numeric twin of CBZ.impact.priceOf(), and the assertion surface for the
     bug this file shipped with. `nearField` is the row's radius*power (126 m
     nuke, 119.6 m MOAB pressure footprint); `fireball` is the actually drawn
     luminous radius (the same 126 m for the nuke, ~42 m for the chemical
     MOAB). `reach` is the bus's physical wave maxR; graphics quality never
     changes the nuclear consequence radius. */
  CBZ.nukeFxSize = function (kind, opts) {
    opts = opts || {};
    kind = kind === "moab" ? "moab" : "nuke";
    const P = STYLE[kind];
    let row = null;
    if (CBZ.impact && CBZ.impact.row) { try { row = CBZ.impact.row(kind); } catch (e) {} }
    row = row || { power: kind === "moab" ? 4.6 : 9, radius: kind === "moab" ? 26 : 14,
                   wave: kind === "moab" ? { speed: 140, maxR: 320 }
                     : { model: "nuclear", speed: 343, maxR: 3276 } };
    const eff = fireR(row, opts);
    const R = Math.max(5, eff * P.rFrac);
    const sc = (opts.scale > 0 ? +opts.scale : 1);
    const reachQ = kind === "nuke" ? 1 : (CBZ.qScale ? CBZ.qScale(0.45, 1) : 1);
    const reach = (row.wave ? row.wave.maxR : eff * 4) * reachQ * sc;
    /* THE DRAW-CALL BUDGET, published. The four original instanced volumes
       (surge / stem / cap / hot) plus, for the nuclear style under V2, the
       incandescent cap glow and the ONE mesh that carries both the crown and
       the collar: SIX. Plus the white dome, which is one 450-triangle mesh
       alive for 1.5 s and is the only layer in the file that is never
       dropped at any quality tier. The MOAB keeps four — a chemical column
       has no incandescent head and no overhanging skirt, and drawing them on
       it would be a fiction rather than a saving. */
    const v2n = kind === "nuke" && v2();
    const oneCloud = kind === "nuke" && coherentCloud();
    const volumeDraws = P.volume ? (v2n ? 6 : 4) : 0;
    /* THE CLOUD'S OWN DIMENSIONS. Under NUKE_REAL_SCALE these are the
       researched ones (nukeDims), NOT the framing-scale k-multiples — the
       whole point of the flag is that the published size is the physical
       one. capY is the cap CENTRE altitude in both paths. */
    const RD = (kind === "nuke" && real()) ? nukeDims(R) : null;
    const FD = RD ? formationDims(R) : null;
    return {
      kind: kind, nearField: +eff.toFixed(1), fireball: +R.toFixed(1), R: +R.toFixed(1),
      capW: +(RD ? RD.capW : R * P.capK).toFixed(1),
      capY: +(RD ? RD.capY : R * P.riseK).toFixed(1),
      capH: +(RD ? RD.capH : R * P.capK * 0.66).toFixed(1),
      stemW: +(RD ? RD.stemW : R * P.stemK).toFixed(1),
      cloudTop: +(RD ? RD.top : R * P.riseK * 1.16).toFixed(1),
      yieldKt: RD ? +RD.W.toFixed(2) : null,
      realScale: !!RD,
      drawDims: FD ? {
        capW: +FD.capW.toFixed(1), capH: +FD.capH.toFixed(1),
        capY: +FD.capY.toFixed(1), top: +FD.top.toFixed(1),
        stemW: +FD.stemW.toFixed(1), base: +FD.base.toFixed(1),
      } : null,
      // The coherent default has no all-enclosing card. It remains allocated
      // only for the explicit legacy path.
      impostorDraws: RD && !oneCloud ? 1 : 0,
      reach: +reach.toFixed(1),
      burnR: +(RD ? nukeRings(R).psi2 : (P.thermK > 0 ? reach * P.thermK : 0)).toFixed(1),
      bills: oneCloud ? 0
        : Math.max(1, Math.min(P.bills, Math.round(CBZ.qScale ? CBZ.qScale(1, P.bills) : P.bills))),
      shell: !!(CBZ.CONFIG.NUKE_FX_SHELL && q01() > 0.28),
      volumeDraws: volumeDraws,
      whiteDome: v2n && !!P.dbl,
      groundRings: 0,
      addLayers: (CBZ.CONFIG.NUKE_FX_SHELL && q01() > 0.28 ? 1 : 0) + volumeDraws +
                 (v2n && P.dbl ? 1 : 0),
    };
  };

  /* ============================================================
     CBZ.nukeFxAudit(kind, opts) — THE SEQUENCE AS NUMBERS.

     CLAUDE.md's closed loop is math over live game state, never a rendered
     frame, and "does the nuke look right" is exactly the kind of question that
     rots into a screenshot argument. So every claim this file's header makes is
     published here as a number a probe can assert on, WITHOUT firing anything:
     beat timings, three gameplay-zone radii, zero drawn ground rings, the real
     fireball radius and the two mushroom proportions that were wrong.

     THE ASSERTIONS THAT MATTER (all of them are booleans in `ok`, so a probe is
     one `Object.values(...).every(Boolean)`):

       zonesOrdered   flatten < burn < glass. The three effect zones a
                      city detonation creates must come out in that order and
                      never collapse together. This is the one that caught the
                      old glass ladder, which ran ENTIRELY inside the flattened
                      zone.
       noGroundRings  no RingGeometry or other outlined terrain layer survives.
       thermalOutranges  burn > flatten strictly. Y^0.41 vs Y^0.33 — if this
                      ever reads false the divergence has been tuned away and
                      the event has stopped being nuclear.
       dipPresent     the pulse curve genuinely goes below 0.2 between its two
                      maxima. A "double flash" whose minimum is 0.6 is not one.
       secondBrighter the second maximum is >= the first. This is the direction
                      the eye reads and the direction the spec describes.
       tallEnough     cloud top is at least 1.8x the cap width.
       thinStem       the cap is at least 6x the stem's width.

     `beats` is the header's beat table, machine-readable, in seconds. If you
     change a timing in the code, change it here — they are one screen apart on
     purpose. ============================================================ */
  CBZ.nukeFxAudit = function (kind, opts) {
    kind = kind === "moab" ? "moab" : "nuke";
    const P = STYLE[kind];
    const S = CBZ.nukeFxSize(kind, opts);
    const spd = (kind === "moab" ? 140 : 343); // conventional/direct-FX fallback only

    /* THE PULSE, resolved to absolute seconds on this style's fade.
       The minimum is the FIRST LOCAL minimum — the run of decreasing keys from
       the first maximum — never the global one, because the table legitimately
       ends at zero and a global search would happily report the end of the fade
       as the double flash's dip. */
    let dipI = 0;
    while (dipI + 1 < FLASH_DOUBLE.length && FLASH_DOUBLE[dipI + 1][1] <= FLASH_DOUBLE[dipI][1]) dipI++;
    const dipT = FLASH_DOUBLE[dipI][0], dipV = FLASH_DOUBLE[dipI][1];
    let pk2T = dipT, pk2V = dipV;
    for (let i = dipI + 1; i < FLASH_DOUBLE.length; i++) {
      if (FLASH_DOUBLE[i][1] > pk2V) { pk2V = FLASH_DOUBLE[i][1]; pk2T = FLASH_DOUBLE[i][0]; }
    }

    // the mushroom, at full rise and full bloom (bloomAt's ceiling). Under
    // V2 the head has also FLATTENED to CAP_FLAT of its vertical extent by
    // then, and the reported cloud top has to say so or the audit is
    // describing a silhouette the file stopped drawing.
    const bloomMax = BLOOM_MAX;
    const RD = (kind === "nuke" && real()) ? nukeDims(S.fireball) : null;
    const FD = RD ? formationDims(S.fireball) : null;
    const capWide = RD ? RD.capW : S.capW * bloomMax;
    const flatK = (kind === "nuke" && v2()) ? CAP_FLAT : 1;
    const capTall = RD ? RD.capH : capWide * 0.66 * flatK;
    const cloudTop = RD ? RD.top : S.capY + capWide * 0.66 * 0.5 * flatK;
    const capMidY = RD ? RD.capY : S.capY;
    const stemWide = RD ? RD.stemW : S.R * P.stemK * 1.7;   // widened by the rise term
    // THE OVERHANG. The collar seeds sit at 0.70..0.98 of the cap radius and
    // the cap radius is capWide/2, so the skirt's outer edge is this — and
    // it must be comfortably wider than the stem or the cap is not
    // overhanging anything, which is the single most recognisable thing
    // about the silhouette in the reference plate.
    const collarWide = capWide * 0.98;

    const glassK = glassLadder(kind);
    /* THE ZONES ARE NAMED CONTOURS NOW, NOT MULTIPLES OF A FRAMING NUMBER.
       `flatten` used to be S.reach because maxR used to BE the collapse
       radius. maxR is now the 1 psi contour, so reading `flatten = S.reach`
       would have quietly claimed that ordinary buildings collapse out to
       3.3 km — a 3x overstatement that would still have passed every gate,
       because every gate compared it against numbers derived from itself.
       Under NUKE_REAL_SCALE each zone is read off CBZ.nukeRings instead. */
    const T = (kind === "nuke" && real()) ? nukeRings(S.fireball) : null;
    const zones = T ? {
      fireball: S.fireball,                       //   126 m  vaporised
      severe: +T.psi20.toFixed(1),                //   504 m  20 psi, total destruction
      flatten: +T.psi5.toFixed(1),                // 1,109 m   5 psi, buildings collapse
      burn: +T.psi2.toFixed(1),                   // 2,016 m  thermal ignition / firestorm
      glass: +T.psi1.toFixed(1),                  // 3,276 m   1 psi, windows district-wide
      rad500: +T.rad500.toFixed(1),               // 1,052 m  500 rem prompt dose
      reach: S.reach,
    } : {
      // ~5 psi: the classic destruction radius. The bus's wave maxR IS this
      // number; it is intentionally not drawn as a circle.
      flatten: S.reach,
      // ~thermal ignition. Strictly outside `flatten` or the event is not nuclear.
      burn: S.burnR,
      // ~1 psi: windows across a huge area, the biggest single injury source
      // and by construction the widest of the three.
      glass: +(S.reach * glassK[glassK.length - 1]).toFixed(1),
      fireball: S.fireball,
    };

    const beats = {
      whiteout: 0,
      firstMax: 0,
      // -1 for a style that does not flash twice (the MOAB): a chemical bomb
      // has no second thermal maximum, and reporting one would be a fiction.
      minimum: P.dbl ? +(dipT * P.white).toFixed(3) : -1,
      secondMax: P.dbl ? +(pk2T * P.white).toFixed(3) : -1,
      veilIn: P.dbl && CBZ.CONFIG.NUKE_FX_VEIL ? 0.06 : 0.28,
      veilOut: 1.9,
      volumeIn: 0.55,
      stemIn: 0.65, capIn: 0.55, surgeIn: 0.75, cap2In: 1.9, collarIn: 2.2,
      // Thermal radiation arrives effectively with the flash; the mechanical
      // pressure front follows on the distance-dependent arrival curve.
      thermalIgnitionIn: kind === "nuke" ? 0 : 0.9,
      shellOut: 3.9,
      // ---- NUKE_FX_V2 beats. -1 means "this style does not have one".
      whiteDomeIn: S.whiteDome ? 0 : -1,
      whiteDomeFull: S.whiteDome ? WDOME_T : -1,
      whiteDomeOut: S.whiteDome ? +(WDOME_T + WDOME_OUT).toFixed(2) : -1,
      capGlowIn: S.whiteDome ? 0.60 : -1,
      capGlowOut: S.whiteDome ? 10.0 : -1,
      collar3dIn: S.whiteDome ? 1.50 : -1,
      crownIn: S.whiteDome ? 2.60 : -1,
      capFlattenAt: S.whiteDome
        ? +(1.4 + riseWindow({ style: P }) * 0.9).toFixed(2) : -1,
      riseStart: 0.9,
      riseEnd: +(0.9 + riseWindow({ style: P })).toFixed(2),
      glassAt: glassK.map(function (k) {
        const radius = S.reach * k;
        const arrival = kind === "nuke" && CBZ.impact && CBZ.impact.shockArrival
          ? CBZ.impact.shockArrival(radius, S.fireball)
          : radius / spd;
        return +Math.max(kind === "nuke" ? 0.08 : 0.3, arrival).toFixed(2);
      }),
      ashIn: P.ash ? 8 : -1,
      end: P.dur,
    };

    /* THE FOUR RATIOS THE REFERENCE PHOTOGRAPH IS ABOUT, all published so a
       probe can hold them and nobody can drift them back by taste:
         capWideOverTall   the head must be WIDER THAN TALL          > 1
         capOverStem       the owner's ~3:1                    2.5 .. 4.5
         overhang          the skirt must hang out past the column   > 2.5
         topOverCap        overall slenderness of the whole cloud    ~1.8-2.2 */
    const proportions = {
      cloudTop: +cloudTop.toFixed(1),
      capWidth: +capWide.toFixed(1),
      capHeight: +capTall.toFixed(1),
      capAltitude: +capMidY.toFixed(1),
      stemWidth: +stemWide.toFixed(1),
      collarWidth: +collarWide.toFixed(1),
      capWideOverTall: +(capWide / Math.max(1, capTall)).toFixed(2),
      topOverCap: +(cloudTop / capWide).toFixed(2),
      altOverCap: +(capMidY / capWide).toFixed(2),
      capOverStem: +(capWide / stemWide).toFixed(2),
      overhang: +(collarWide / stemWide).toFixed(2),
      capFlatten: flatK,
      burnOverFlatten: +(zones.burn / Math.max(1, zones.flatten)).toFixed(3),
    };

    /* THE WHITE DOME, sampled. The claim in the header is that it grows on
       the Taylor-Sedov t^0.4 law, and a claim in a comment is worth nothing
       — so the curve is published at four stations. The signature of the
       exponent is that it is FAST then slow: 31% of full radius after 5% of
       the window, 76% after half. A smoothstep reads 1.4% and 50%, so these
       four numbers alone tell a probe which curve is actually running. */
    const domeCurve = S.whiteDome
      ? [0.05, 0.25, 0.50, 1.00].map(function (u) {
          return +(Math.pow(u, WDOME_P)).toFixed(3);
        })
      : null;

    /* THE HANDOFF FRAME AS NUMBERS. Before the phased fix this sampled a
       1,273 m cap at 599 m altitude plus a 3,462 m mature impostor at 1.47 s.
       The white dome must reveal a YOUNG cloud: sub-kilometre head, low centre,
       and the early texture—not a completed tower. */
    const handoffT = WDOME_T + WDOME_OUT;
    const curveL = {
      style: P, R: S.R, by: 0, y: 0,
      riseH: FD ? FD.capY : S.capY,
      capW: FD ? FD.capW / BLOOM_MAX : S.capW,
      dims: RD,
    };
    const handoffRise = riseAt(handoffT, curveL);
    const formation = kind === "nuke" ? {
      handoffT: +handoffT.toFixed(2),
      handoffRise: +handoffRise.toFixed(3),
      handoffCapW: +(curveL.capW * bloomAt(handoffT, curveL)).toFixed(0),
      handoffCapY: +capYAt(handoffRise, curveL).toFixed(0),
      handoffPhase: +cloudPhaseAt(handoffT, curveL).toFixed(3),
      riseWindow: +riseWindow(curveL).toFixed(1),
      genericPuffEvents: CBZ.CONFIG.NUKE_FX_LEGACY_PUFFS === true
        ? Math.round((CBZ.qScale ? CBZ.qScale(0, P.secondary) : P.secondary)) +
          Math.round(Math.round((CBZ.qScale ? CBZ.qScale(0, P.secondary) : P.secondary)) * 0.7) +
          Math.round(CBZ.qScale ? CBZ.qScale(0, P.thermal) : P.thermal)
        : 0,
    } : null;

    return {
      // `rings` aliases numeric zones for older probes; it never means drawn
      // geometry. `layers.groundRings` is the visual contract.
      kind: kind, zones: zones, rings: zones, beats: beats, proportions: proportions,
      formation: formation,
      pulse: { min: dipV, secondMax: pk2V, keys: FLASH_DOUBLE.length },
      /* THE WHOLE EVENT AS PHYSICS, so a probe never has to trust a comment.
         `yield` is INVERTED out of the bus row (see the physical-model
         block), `dims` is the cloud at true size, and `casualty` samples the
         measured USSBS curve at the same stations the ring table quotes. */
      yieldKt: T ? T.W : null,
      dims: RD,
      drawDims: FD,
      casualty: T ? [126, 504, 756, 1109, 1533, 2016, 2554, 3276].map(function (r) {
        return { r: r, killed: +nukeLethalAt(r, S.fireball).toFixed(3) };
      }) : null,
      impostor: (kind === "nuke" && real()) ? {
        // Allocated for the explicit legacy fallback; zero draws on the
        // coherent default.
        at: +(camFar() * 0.86).toFixed(1), far: camFar(),
        band: [+(camFar() * 0.55).toFixed(0), +(camFar() * 0.95).toFixed(0)],
        w: S.impostorDraws && FD ? +FD.capW.toFixed(0) : 0,
        h: S.impostorDraws && FD ? +FD.top.toFixed(0) : 0,
        draws: S.impostorDraws,
      } : null,
      dome: S.whiteDome
        ? { r: +S.fireball.toFixed(1), t: WDOME_T, out: WDOME_OUT, p: WDOME_P, curve: domeCurve }
        : null,
      // the world-lighting curve as numbers, sampled across the arc
      light: v2() && CBZ.CONFIG.NUKE_FX_SKY
        ? { sunK: LIGHT.SUN_K, hemiK: LIGHT.HEMI_K, near: LIGHT.NEAR, far: LIGHT.FAR,
            lum: [0, 0.5, 2, 6, 15].map(function (tt) {
              return +fireLum(tt, { style: P }).toFixed(3);
            }) }
        : null,
      layers: {
        bills: S.bills, shell: S.shell,
        dome: !!(S.shell && P.dome && q01() > 0.45),
        volumeDraws: S.volumeDraws,
        coherentCloud: kind === "nuke" && coherentCloud(),
        whiteDome: !!S.whiteDome,
        groundRings: 0,
        genericPuffEvents: formation ? formation.genericPuffEvents : 0,
      },
      ok: {
        zonesOrdered: P.thermK === 0
          ? zones.flatten < zones.glass
          : (zones.flatten < zones.burn && zones.burn < zones.glass),
        // Old key retained for probe compatibility; it asserts zones.
        ringsOrdered: P.thermK === 0
          ? zones.flatten < zones.glass
          : (zones.flatten < zones.burn && zones.burn < zones.glass),
        noGroundRings: S.groundRings === 0,
        noGenericPuffStorm: kind !== "nuke" ||
          !formation || formation.genericPuffEvents === 0,
        domeHandsToYoungCloud: kind !== "nuke" || !phasedCloud() ||
          (formation.handoffCapW < 1000 && formation.handoffCapY < 500 &&
           formation.handoffPhase < 0.10),
        fullNuclearFireball: kind !== "nuke" ||
          (S.fireball === S.nearField && S.R === S.fireball),
        // Compatibility key retained. The coherent contract is six bounded
        // depth-writing lobe fields, no redundant detail planes or mushroom card.
        volumetricCloud: !P.volume ||
          (kind === "nuke" && coherentCloud()
            ? (S.impostorDraws === 0 && S.volumeDraws === 6 && S.bills === 0)
            : S.volumeDraws >= 4),
        coherentPostFlash: kind !== "nuke" || !coherentCloud() ||
          (S.impostorDraws === 0 && S.volumeDraws === 6 && S.bills === 0 &&
           CBZ.CONFIG.NUKE_FX_ASH === false),
        /* ---- NUKE_FX_V2 GATES. Each one pins a claim the header makes.
           They are structurally true when the flag is off, so a revert never
           turns the audit red — it turns the claims off. */
        // the dome grows on the Sedov exponent, not on an ease. A smoothstep
        // is at 0.014 by 5% of the window; t^0.4 is at 0.31.
        domeIsSedov: !S.whiteDome || (domeCurve[0] > 0.25 && domeCurve[2] > 0.70 &&
                                      domeCurve[3] === 1),
        // ...and it reaches the real fireball radius, not some fraction of it
        domeReachesFireball: !S.whiteDome || S.fireball === S.R,
        // (retained key; the real assertion is capOverhangsStem above, which
        // is stated in the reference plate's own units)
        capOverhangs: !S.whiteDome || proportions.overhang > 2.5,
        // the head genuinely CHANGES SHAPE as it stabilises (anvil, not ball)
        capFlattens: !S.whiteDome || (flatK < 0.85 && flatK > 0.3),
        // the crown arrives AFTER the collar, which arrives after the cap:
        // a cloud cools from the top down and the beats have to say so.
        crownIsLate: !S.whiteDome ||
          (beats.crownIn > beats.collar3dIn && beats.collar3dIn > beats.capIn),
        // the incandescent cap dies before the cloud does, or it is a lamp
        glowCoolsFirst: !S.whiteDome || beats.capGlowOut < P.dur,
        // the world-light curve peaks at the flash and reaches zero by the end
        lightPeaksAtFlash: !(v2() && CBZ.CONFIG.NUKE_FX_SKY) ||
          (fireLum(0, { style: P }) >= 0.98 && fireLum(P.dur, { style: P }) <= 0.02),
        thermalOutranges: P.thermK === 0 || zones.burn > zones.flatten,
        dipPresent: !P.dbl || dipV < 0.2,
        secondBrighter: !P.dbl || pk2V >= FLASH_DOUBLE[0][1],
        /* THE TWO PROPORTION GATES, on style-appropriate thresholds. A chemical
           bomb's column is legitimately squatter and stubbier than a mushroom —
           holding the MOAB to the nuke's ratios would be asserting a fiction,
           and quietly exempting it would be worse. So the chemical style is
           gated at 1.5 / 4.5 (it reads 1.86 / 5.12) against its own
           framing-scale geometry, while the nuclear style under
           NUKE_REAL_SCALE is gated on the RESEARCHED ratios: top:cap >= 1.8
           (it reads 1.96) and a two-sided cap:stem window 2.5..4.5 (it reads
           3.00). Neither has slack enough to absorb a careless capK/stemK or
           STEM_OF_CAP edit unnoticed, which is the entire job of a gate. */
        tallEnough: proportions.topOverCap >= (P.thermK > 0 ? 1.8 : 1.5),
        /* THE STEM GATE IS TWO-SIDED NOW, AND THAT IS A STRICTLY BETTER GATE.
           It used to be `capOverStem >= 6` — one-sided, so it could only ever
           catch a stem that was too FAT, and it happily passed the 9.8:1
           chimney this file was actually drawing. The owner's reference plate
           is explicit ("a THICK ROILING ORANGE-BROWN STEM roughly as wide as
           ~1/3 the cap"), and both failure modes are real: past ~4.5:1 the
           column reads as a chimney under a hat, under ~2.5:1 it reads as a
           pillar with a lid. Under NUKE_REAL_SCALE the window is 2.5..4.5
           and the file reads 3.00; the legacy path keeps its old one-sided
           test, because 9.8:1 is what the legacy geometry draws. */
        thinStem: (kind === "nuke" && real())
          ? (proportions.capOverStem >= 2.5 && proportions.capOverStem <= 4.5)
          : proportions.capOverStem >= (P.thermK > 0 ? 6 : 4.5),
        // THE HEAD MUST BE WIDER THAN IT IS TALL. This is the first thing the
        // eye reads in the photograph and nothing was asserting it.
        capWiderThanTall: !(kind === "nuke" && real()) || proportions.capWideOverTall > 1.15,
        // ...and it must HANG OUT past its own column, or it is a ball on a
        // stick. The collar exists to buy exactly this.
        capOverhangsStem: !(kind === "nuke" && real()) || proportions.overhang > 2.5,
        // Legacy clouds use the fast/decelerating curve. The phased real-size
        // nuke instead pins three formation stations: compact, tower, mature.
        riseDecelerates: !CBZ.CONFIG.NUKE_FX_RISE ||
          (kind === "nuke" && phasedCloud()
            ? (riseAt(0.9 + riseWindow({ style: P }) * 0.08, { style: P }) <= 0.08 &&
               riseAt(0.9 + riseWindow({ style: P }) * 0.58, { style: P }) >= 0.65 &&
               riseAt(0.9 + riseWindow({ style: P }), { style: P }) === 1)
            : riseAt(0.9 + P.riseT * 0.25, { style: P }) > 0.5),
      },
    };
  };

  // ---- BUILD AT LOAD (the crashfx prewarm doctrine) ------------------------
  // Six canvas bakes, five shader programs and nine meshes, all minted here
  // rather than in the frame a warhead lands — core/fxwarm.js then compiles
  // the programs during the play-start transition, so the first nuke of a
  // session hits fully warm caches. The eager rng() draws happen in a FIXED
  // order at init, so every client advances the stream identically.
  try { buildPool(); } catch (e) { /* no THREE / no scene: the composers degrade to the near field */ }
  wire();
})();
