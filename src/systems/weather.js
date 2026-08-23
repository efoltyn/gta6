/* ============================================================
   systems/weather.js — Dynamic weather.

   Rain that comes and goes: a target intensity drifts over minutes
   so storms build, peak, and fade rather than snapping on/off. The
   rain itself is ONE pooled THREE.Points cloud (drop cap rides the live
   quality tier; buffer sized once at the tier-4 cap, one shared geometry,
   one shared material) that rides along with the
   camera so it always surrounds the player without ever needing more
   particles. Drops fall, drift sideways with the wind, and once they
   sink below the ground (y<0) they're recycled to a fresh spot up high
   around the camera — a cheap rain volume that never runs dry.

   Atmosphere:
   - fog darkens / desaturates a touch while it rains (restored when dry).
   - lightning: occasional bright flashes of CBZ.hemi + a rolling thunder
     tone — but ONLY at night (CBZ.sun.position.y < 0), so daytime stays
     calm and the night storms feel genuinely ominous.

   Everything runs in onAlways so the weather keeps living on the title
   / pause screens too. Per-frame work is a single Float32 write loop
   over the live drops with no allocation in the hot path.

   ------------------------------------------------------------------
   WEATHER IS AN ENGINE PILLAR, NOT A CITY FEATURE (2026-08-02).

   systems/disasters.js used to fork this file four times: the lightning
   storm, the flash flood, the hurricane and the blizzard each built their
   OWN CBZ.fx.particleCloud of rain or snow, and the hurricane additionally
   invented its own wind vector — so the game carried three unrelated wind
   fields (this one, the hurricane's, the tornado's Rankine core) and two
   unrelated rain implementations. A disaster that darkens the sky should
   be DRIVING the weather, not shipping a private copy of it.

       CBZ.weatherDrive({rain, snow, wind, windDir:{x,z}, fog, fogColor,
                         lightning}, holdSecs)

   is the one-line adoption. It OVERRIDES the drifting auto-storm for as
   long as the caller keeps re-asserting it (call it every frame from an
   `active()` and pass a short hold), then releases smoothly back to
   whatever the ambient weather was doing. Everything downstream — the
   pooled rain cloud, the fog darkening, the wet-asphalt material ramp
   (world/materials.js reads CBZ.weather.intensity), the wet-grip penalty
   (city/vehicles.js:2240), the night lightning, the sky's rain term — is
   already keyed off this module and needs no edit at all.

   `CBZ.weatherWind()` is the ONE wind vector. The tornado's Rankine field
   stays local to its own funnel (it is a different physical object) and
   already biases off this one.

   DYNAMIC_WEATHER stays the gate on the AMBIENT drifting storm — the thing
   the owner switched off because camera-centred sprites looked painted on
   the HUD. With it false the module is inert until something drives it,
   which is byte-identical to the old stub for every existing consumer:
   intensity stays 0, so no fog tint, no lightning, no wet asphalt, no
   particles. WEATHER_DRIVE=false additionally refuses the new API, which
   is the one-line revert to private per-disaster rain.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  // Never throw at load: bail unless the engine + THREE + scene/camera exist.
  if (!CBZ || !window.THREE || !CBZ.scene || !CBZ.camera) return;
  const CFG = (CBZ.CONFIG = CBZ.CONFIG || {});
  // The AMBIENT drifting storm. Off by default (owner call, unchanged).
  const AUTO = CFG.DYNAMIC_WEATHER === true;
  // The DRIVEN layer — a disaster (or any future scripted event) asking the
  // real weather for rain/snow/wind/fog. Independent one-line revert.
  if (CFG.WEATHER_DRIVE == null) CFG.WEATHER_DRIVE = true;
  const THREE = window.THREE;

  const scene = CBZ.scene;
  const cam = CBZ.camera;

  // ---- tunables -------------------------------------------------------
  // Drop count rides the LIVE quality tier (pause-menu perf/quality slider).
  // The Points buffer is allocated ONCE at the tier-4 size; each frame only
  // the tier's share of drops is activated via setDrawRange, so a mid-storm
  // slider move costs nothing (no realloc). qScale may be absent in headless
  // tests → fall back to the old 400.
  const MAX_BUF = 800;        // buffer size (tier-4 cap) — allocated once
  function maxDrops() { return (CBZ.qScale ? CBZ.qScale(200, 800) : 400) | 0; }
  const RADIUS = 16;          // horizontal spread around the camera
  const NEAR = 2.6;           // annulus inner edge — nothing seeds on the lens
  const FWD_BIAS = 4;         // cloud centre leads the camera's look direction
  const TOP = 16;             // spawn height above camera
  const BOTTOM = -1.5;        // recycle a touch below ground for a clean exit
  const FALL_MIN = 22, FALL_MAX = 34; // units/sec downward
  // OWN STREAM. This module draws thousands of values (800 seeds × 4 at load,
  // unbounded recycles per frame). It used to bind CBZ.econ.rng — adding
  // draws to a SHARED stream, the exact order-fragility the determinism law
  // bans. Weather is runtime-only FX, so a private stream is correct.
  const rng = CBZ.seedStream ? CBZ.seedStream("weather") : Math.random;

  // ---- intensity state machine ---------------------------------------
  // intensity 0..1 eases toward `target`; target re-rolls every few mins.
  let intensity = 0;            // EFFECTIVE (max of ambient and driven)
  let autoI = 0, autoW = 0;     // the ambient storm's own eased state
  let target = 0;
  let phaseT = 6 + rng() * 8;   // seconds until first weather decision
  let wind = 0;                 // current wind SPEED (units/sec)
  let windTarget = 0;
  // ONE wind bearing for the whole game, as a unit vector. The old pair of
  // booleans (windAxis 0/1) could only blow along a world axis, which is why
  // the hurricane could not use it and grew its own.
  let windX = 1, windZ = 0;
  let windTX = 1, windTZ = 0;

  function rollWeather() {
    // ~45% of the time it's dry-ish; otherwise a drizzle→downpour.
    const r = rng();
    if (r < 0.45) target = 0.0 + rng() * 0.08;          // basically clear
    else if (r < 0.78) target = 0.25 + rng() * 0.3;      // light/moderate rain
    else target = 0.7 + rng() * 0.3;                     // heavy storm
    // weather lasts on the order of minutes
    phaseT = 70 + rng() * 110;
    // new wind direction & strength each phase
    windTarget = rng() * (4 + target * 7);
    const a = rng() * Math.PI * 2;
    windTX = Math.cos(a); windTZ = Math.sin(a);
  }

  /* ---- THE DRIVEN LAYER --------------------------------------------------
     A caller asserts a weather STATE and a hold time. While the hold is live
     the driven values win; once it lapses they release over RELEASE seconds
     so a disaster ending does not snap the sky. Nothing accumulates, so a
     driver that dies mid-event simply stops being re-asserted. */
  const RELEASE = 3.5;          // seconds to bleed a lapsed drive back to ambient
  const drv = { rain: 0, snow: 0, wind: 0, wx: 1, wz: 0, fog: 0, fogColor: -1, lightning: 0, pool: 0, cover: -1 };
  let drvHold = 0;              // seconds of assertion left
  let snowMix = 0;              // 0 = rain look, 1 = snow look (eased)

  CBZ.weatherDrive = function (spec, holdSecs) {
    if (CFG.WEATHER_DRIVE === false || !spec) return false;
    if (Number.isFinite(spec.rain)) drv.rain = Math.max(0, Math.min(1, +spec.rain));
    if (Number.isFinite(spec.snow)) drv.snow = Math.max(0, Math.min(1, +spec.snow));
    // `pool`: metres of STANDING WATER the driver is asserting on the ground.
    // The one-word adoption for a flood — a caller that already darkens the
    // sky through this function floods the streets by adding one field, and
    // the swimmer, the drowning, the buoyancy and the gore medium follow
    // because they all read city/waterfield.js's mask. See groundTick().
    if (Number.isFinite(spec.pool)) drv.pool = Math.max(0, +spec.pool);
    // `cover`: 0..1 snow lying on the ground, asserted rather than accumulated
    // (a blizzard that has to whiten an island in 17 s cannot wait for the
    // ambient snowfall integrator). -1 means "don't override".
    if (Number.isFinite(spec.cover)) drv.cover = Math.max(0, Math.min(1, +spec.cover));
    if (Number.isFinite(spec.wind)) drv.wind = Math.max(0, +spec.wind);
    if (spec.windDir) {
      const m = Math.hypot(+spec.windDir.x || 0, +spec.windDir.z || 0);
      if (m > 1e-4) { drv.wx = (+spec.windDir.x) / m; drv.wz = (+spec.windDir.z) / m; }
    }
    if (Number.isFinite(spec.fog)) drv.fog = Math.max(0, Math.min(1, +spec.fog));
    if (spec.fogColor != null) drv.fogColor = +spec.fogColor;
    if (Number.isFinite(spec.lightning)) drv.lightning = Math.max(0, Math.min(1, +spec.lightning));
    drvHold = Math.max(drvHold, holdSecs > 0 ? +holdSecs : 0.5);
    return true;
  };
  // RELEASE IS NOT A SNAP. Dropping the hold lets the tick below bleed every
  // driven field to zero over RELEASE seconds — a disaster ending has to let
  // the rain thin out and the light come back, because that easing IS the
  // all-clear now that nothing prints one.
  CBZ.weatherRelease = function () { drvHold = 0; };
  // THE one wind vector. Anything that needs "which way is the wind blowing"
  // reads this — never a private bearing.
  const _windOut = { x: 1, z: 0, speed: 0 };
  CBZ.weatherWind = function () {
    _windOut.x = windX; _windOut.z = windZ; _windOut.speed = wind;
    return _windOut;
  };

  // ---- pooled rain cloud ----------------------------------------------
  // single geometry; positions are the only thing we touch per frame.
  const positions = new Float32Array(MAX_BUF * 3);
  const velY = new Float32Array(MAX_BUF);   // per-drop fall speed (variety)
  // camera forward on XZ, cached once per tick for seedDrop's bias — never
  // recomputed per drop. DECLARED BEFORE the seeding loop below: seedDrop is
  // hoisted but a `let` is not, and the load-time seeding pass reads these.
  let fwdX = 0, fwdZ = 0;
  // base ring near the camera; absolute positions are kept in `positions`
  // (we add the cloud to the SCENE, not the camera, and move points in
  //  world space so wind drift reads correctly).
  for (let i = 0; i < MAX_BUF; i++) {
    seedDrop(i, cam.position.x, cam.position.z, true);
  }

  function seedDrop(i, cx, cz, anywhere) {
    const a = rng() * Math.PI * 2;
    // ANNULUS, not a disc. The old full disc seeded drops centimetres from
    // the eye — with sizeAttenuation a 0.16 point at 0.2 m is a huge bright
    // blob glued to screen centre, the exact "white dots stuck to the HUD"
    // that got the ambient storm turned off. Nothing seeds inside NEAR now,
    // and the cloud centre leads the look direction so the budget lands
    // where the player is actually looking instead of half behind the head.
    const r = NEAR + Math.sqrt(rng()) * (RADIUS - NEAR);
    const o = i * 3;
    positions[o]     = cx + fwdX * FWD_BIAS + Math.cos(a) * r;
    // if seeding fresh, scatter through the whole column; if recycling,
    // caller resets y separately. A touch of jitter on recycle keeps the
    // re-spawned drops from forming a flat sheet at exactly TOP.
    positions[o + 1] = anywhere ? (rng() * (TOP + 4)) : (TOP + rng() * 4);
    positions[o + 2] = cz + fwdZ * FWD_BIAS + Math.sin(a) * r;
    velY[i] = FALL_MIN + rng() * (FALL_MAX - FALL_MIN);
  }

  const geo = new THREE.BufferGeometry();
  const attr = new THREE.BufferAttribute(positions, 3);
  attr.setUsage && attr.setUsage(THREE.DynamicDrawUsage); // r128: hint dynamic
  geo.setAttribute("position", attr);
  // start with zero drawn; draw range grows with intensity
  geo.setDrawRange(0, 0);

  const mat = new THREE.PointsMaterial({
    color: 0xbcd2e8,
    size: 0.16,
    transparent: true,
    opacity: 0.0,            // faded in via intensity
    depthWrite: false,       // don't fight the depth buffer / no z-fighting
    fog: true,               // let it disappear into the fog nicely
    sizeAttenuation: true
  });

  const rain = new THREE.Points(geo, mat);
  rain.frustumCulled = false; // it tracks the camera; never cull it
  rain.renderOrder = 5;
  rain.visible = false;
  scene.add(rain);

  // ---- indoor suppression ---------------------------------------------
  // The cloud is camera-centred and "never runs dry", so without a guard it
  // rains INSIDE buildings too. Detect "under a roof" cheaply and hide the
  // cloud while indoors, re-showing it the instant we step back outside.
  // Mirrors src/city/death.js isIndoors(): a building floor/roof slab is
  // registered both as a CBZ.platforms entry (with `top` + footprint) AND as a
  // CBZ.losBlockers mesh, so a footprint test + a short up-ray cover both.
  // The test is THROTTLED to a few times/sec (not per-drop, not per-frame).
  let indoors = false;
  let indoorCD = 0;             // seconds until next indoor re-test
  const _upRay = new THREE.Raycaster();
  const _upOrigin = new THREE.Vector3(), _upDir = new THREE.Vector3(0, 1, 0);

  function testIndoors() {
    // Meaningful wherever the world registers walkable roofs: the open city,
    // and the survival island (world/disaster_arena.js's enterable towers push
    // real CBZ.platforms, which is exactly what disasters.js's own `sheltered`
    // check reads). Anywhere else there is no roof to be under, so weather is
    // always "outdoors" and behaves exactly as before.
    const g = CBZ.game;
    if (!g) return false;
    // The prison is interior architecture that registers NO platforms (the
    // cellblock pushes only colliders), so the geometric test below cannot
    // answer there — and "it rained inside the jail" is the other half of why
    // the ambient storm got turned off. Escape mode reads as indoors, period.
    if (g.mode === "escape") return true;
    if (g.mode !== "city" && g.mode !== "survival") return false;
    // In a car you're effectively outside the building-interior system (cars
    // drive on streets), so don't bother — keeps the rain on the windscreen.
    const P = CBZ.player;
    if (P && P.driving) return false;

    const px = cam.position.x, py = cam.position.y, pz = cam.position.z;

    // 1) overhead floor/roof slab covering us (cheap footprint scan)
    const plats = CBZ.platforms;
    if (plats) {
      const headY = py + 0.3; // camera already sits near head height
      for (let i = 0; i < plats.length; i++) {
        const p = plats[i];
        if (p.top == null) continue;
        if (p.top > headY && p.top < py + 28 &&
            px >= p.minX && px <= p.maxX && pz >= p.minZ && pz <= p.maxZ) return true;
      }
    }
    // 2) backstop: short up-ray hits a roof/ceiling LOS mesh
    const blk = CBZ.losBlockers;
    if (blk && blk.length) {
      _upOrigin.set(px, py + 0.2, pz);
      _upRay.set(_upOrigin, _upDir); _upRay.far = 26;
      if ((CBZ.losRaycast ? CBZ.losRaycast(_upRay, blk) : _upRay.intersectObjects(blk, false)).length) return true;
    }
    return false;
  }

  // ---- fog tinting ----------------------------------------------------
  // daynight.js rewrites scene.fog.color every frame, so we don't fight it
  // by storing a base — instead we darken whatever colour it currently is,
  // proportional to rain intensity, AFTER daynight has run (high order).
  const _fogTmp = new THREE.Color();
  const FOG_DARK = 0x2a3340; // cool storm-grey we lerp toward

  // ---- lightning (Technique 2: storm flashes) --------------------------
  // Full-scene spike = BOTH light objects lights.js exposes: hemi (sky/
  // ground ambient fill) AND sun (the shadow-casting key light) get the
  // same additive bump, so a bolt reads on lit AND shadowed faces alike,
  // not just as a wash over the ambient term. Both are feature-detected —
  // lights.js always makes them in the real build, but this file must
  // never throw if a future headless/menu context is missing one.
  // Composes with daynight.js (order 2) instead of fighting it: daynight
  // rewrites hemi/sun.intensity every frame BEFORE weather ticks (order
  // 90), so "baseline" is re-sampled every frame a flash isn't active —
  // we only ever ADD on top of whatever daynight/city-mode last wrote.
  const hemi = CBZ.hemi || null;
  const sunL = CBZ.sun || null;
  let baseHemi = hemi ? hemi.intensity : 0.4;
  let baseSun = sunL ? sunL.intensity : 1.0;
  let flash = 0;            // current extra intensity from lightning
  let flashT = 0;          // remaining flash time
  let strikeCD = 5;        // cooldown before next possible strike
  let pendingThunder = 0;  // seconds until thunder follows the flash (delay)
  let strobeS = 0, strobeT = 0;  // an externally-requested flash (see CBZ.weatherStrobe)
  let flashBump = 0;       // the additive intensity a flash is contributing RIGHT NOW

  /* ---- OVERCAST: THE CLOUD DECK THE STORM IS FALLING OUT OF -----------
     OWNER, with a photograph of a real strike: "your lightning in the game
     is amazing, the issue is the sky is a nice blue sky with hardly any
     clouds during the lightning storm."

     It was. Rain, wind, wet asphalt, flashes and bolts were all wired — and
     the one thing every one of them implies, a sky with cloud in it, was
     nobody's job. core/sky.js had no weather input at all (its only read of
     this file sat behind a flag that has been false for months), so the dome
     stayed the clear-day gradient plus a cloudless daylight photo, and
     survival's mood tint just multiplied that blue by slate.

     So this is the number the sky was missing: how much cloud deck is
     overhead, 0..1, eased over seconds because weather does not cut. It is
     derived here rather than in the painter because THIS file is the one
     that knows the difference between drizzle, a driven disaster and a dry
     scripted strobe — and because a second system re-deriving "is it
     storming" from rain counts is exactly the fork this file exists to
     prevent. */
  let overcast = 0;
  const OC_EASE = 0.55;    // ~1.8 s time constant: the deck rolls in, never cuts
  /* THE END OF A STORM IS SLOWER THAN ITS START. Clouds are not rain: when a
     drive lapses the rain stops in seconds, but the deck it fell out of hangs
     over the street and BREAKS UP — and with core/sky.js's storm front, a
     slow fall is what lets the back edge visibly sweep the sky instead of
     the whole ceiling evaporating in two seconds. τ≈17 s on the way down, so
     a finished storm's sky clears over half a minute while the wet ground
     and fog release on their own faster curves. WEATHER_SLOW_CLEAR=false
     restores the symmetric ease. */
  const OC_EASE_DOWN = 0.06;

  /* PUBLISHED so a real drawn bolt can light the real scene. See the block in
     tryLightning that consumes it. Deliberately a REQUEST rather than a direct
     write: this file owns the daynight-relative baseline and the decay curve,
     and a caller that wrote hemi.intensity itself would be overwritten by
     daynight.js on the very next frame. */
  CBZ.weatherStrobe = function (strength, secs) {
    if (!(strength > 0)) return;
    strobeS = Math.max(strobeS, Math.min(3, strength));
    strobeT = Math.max(strobeT, Math.min(1, secs > 0 ? secs : 0.1));
  };

  function tryLightning(dt) {
    if (!hemi && !sunL) return;
    // remember the (daynight-driven) baseline so we add on top of it.
    if (flashT <= 0) {
      if (hemi) baseHemi = hemi.intensity;
      if (sunL) baseSun = sunL.intensity;
    }

    strikeCD -= dt;
    // A DRIVEN storm brings its own lightning: `lightning` is the driver
    // saying "this one throws bolts", which is what lets a daytime disaster
    // flash without loosening the ambient night-only rule below.
    const night = !!(CBZ.sun && CBZ.sun.position.y < 0) || drv.lightning > 0.2;
    // STORM gate: night + storm-grade rain (rollWeather's "heavy storm"
    // branch targets 0.7+; 0.6 catches a storm easing in/out too) + a
    // deterministic (LCG, not Math.random) low-frequency roll + cooldown.
    const STORM = drv.lightning > 0.2 ? 0.25 : 0.6;
    if (night && intensity > STORM && strikeCD <= 0) {
      // chance scales with how hard it's pouring
      const p = (intensity - STORM) * 0.7 * dt; // per-frame probability — kept low so strikes stay rare
      if (rng() < p) {
        flash = 0.9 + rng() * 1.3;            // brightness of the bolt
        flashT = 0.10 + rng() * 0.10;         // very brief
        strikeCD = 6 + rng() * 12;            // space strikes out — a storm has a handful, not a strobe
        // thunder arrives after a short, distance-y delay
        pendingThunder = 0.25 + rng() * 1.6;
        // double-flicker on big strikes
        if (rng() < 0.5) flashT += 0.06;
      }
    }

    /* A STRIKE SOMEONE ELSE DREW. systems/lightningfx.js draws real bolts with
       real RETURN STROKES, and what a stroke does to a scene is LIGHT it — not
       tint a rectangle over the lens. That is exactly the hemi+sun bump this
       file already owns for its ambient sky flashes, so the bolt renderer pokes
       THIS, once per stroke, rather than opening a second lighting path that
       could disagree with daynight.js about what the baseline is. Applied here
       — after the baseline capture at the top, before the animation below — so
       a strobe lights the world on the frame it was asked for. Strength and
       duration are max-combined, so overlapping strikes never cancel. */
    if (strobeS > 0) {
      flash = Math.max(flash, strobeS);
      flashT = Math.max(flashT, strobeT);
      strobeS = 0; strobeT = 0;
    }

    // animate the active flash (fast attack, quick decay)
    if (flashT > 0) {
      flashT -= dt;
      // flicker so it reads like a real bolt rather than a fade
      const flick = 0.6 + 0.4 * Math.abs(Math.sin(CBZ.now * 0.05));
      // A STROKE LIGHTS THE CLOUD IT CAME OUT OF, and core/sky.js reads this to
      // flare the whole deck white on the frame the bolt fires — the single
      // most recognisable thing about the reference photograph is that the sky
      // is not dark during a strike, it is the brightest thing in frame.
      // Published as the bump ITSELF rather than a boolean, so the painter
      // rides the exact decay curve the lights are already using instead of
      // inventing a second one that could disagree with it. `Math.max(0,
      // flashT)` zeroes it on the frame the flash expires, so it cannot be
      // left stale if the dark-path early-out closes the tick right after.
      const bump = flash * flick * Math.max(0, flashT) * 6;
      flashBump = bump;
      if (hemi) hemi.intensity = baseHemi + bump;
      if (sunL) sunL.intensity = baseSun + bump * 0.7; // sun bump a touch softer — it's already the brighter light
    }

    // delayed recorded thunder after the visible flash — a sfx cue kept
    // separate from the flash itself (thunder always trails the light).
    if (pendingThunder > 0) {
      pendingThunder -= dt;
      if (pendingThunder <= 0 && CBZ.sfx) CBZ.sfx("thunder");
    }
  }

  /* ============================================================
     WEATHER LEAVES STATE ON THE GROUND (2026-08-03)

     OWNER, verbatim: "rain makes flash flood which is gang city water slowly
     filling the ground" and "blizzard should fill ground with white slowly
     just like how the top of the mountain tip in nat disaster has white".

     Weather used to be a thing that happened in the AIR and stopped existing
     the moment it stopped. Rain fell through the world and landed on nothing;
     a blizzard was a white fog with particles in it. Both are now integrators
     with memory:

       · rain fills CITY/waterfield.js's ground-water field — puddles in the
         low spots first, then kerb-deep, then a street that swims — and drains
         back over minutes when it stops. It never authors a water plane: the
         level is one number handed to CBZ.groundWaterSet, and swimming,
         drowning, buoyancy, boats, corpses and the gore medium all follow
         because they were already asking the water field.
       · snow lies. `cover` is a 0..1 scalar that whitens every large surface
         in the world through ONE shared uniform — the same trick as the
         island's snow-capped peak, except it is a live coverage blend instead
         of a second cone of white geometry, so it can arrive and melt.

     And it costs something. Six inches of moving water takes a person off
     their feet, two feet floats a car, and the water is COLD — the hazard
     tick below prices all three, plus the electrocution a submerged street
     light is, and every death lands in the killfeed with its own cause.

     Flags (each a one-line revert):
       WEATHER_GROUND_WATER  the field itself (declared in waterfield.js)
       CITY_RAIN_POOLS       ambient rain accumulating in the gang city
       WEATHER_SNOW_COVER    snow lying on the ground
       WEATHER_SURFACE_COAT  the shared wet/snow/waterline material blend
       WEATHER_FLOOD_HAZARD  knockdowns, sweeping, hypothermia, electrocution
     ============================================================ */
  if (CFG.WEATHER_GROUND_WATER == null) CFG.WEATHER_GROUND_WATER = true;
  if (CFG.CITY_RAIN_POOLS == null) CFG.CITY_RAIN_POOLS = true;
  if (CFG.WEATHER_SNOW_COVER == null) CFG.WEATHER_SNOW_COVER = true;
  if (CFG.WEATHER_SURFACE_COAT == null) CFG.WEATHER_SURFACE_COAT = true;
  if (CFG.WEATHER_FLOOD_HAZARD == null) CFG.WEATHER_FLOOD_HAZARD = true;

  // ---- the two integrators ---------------------------------------------
  // Numbers chosen so the owner's own storyboard reads: five sim-minutes of
  // hard rain leaves a sheen and gutter puddles (~0.13 m), not a flood; a
  // flood is something a DISASTER asserts, and it drains back over minutes.
  const RAIN_FILL = 0.00042;   // metres/sec of standing water at rain 1.0
  const POOL_DRAIN = 0.00075;  // metres/sec it soaks away when the rain stops
  const POOL_CAP_AMB = 0.55;   // rain alone can never make a two-metre flood
  const POOL_RISE = 1.60;      // metres/sec a driver may raise the level
  const POOL_FALL = 0.35;      // ...and how fast it is allowed to fall back
  const SNOW_FILL = 0.0060;    // coverage/sec at snowfall 1.0 (≈3 min to white)
  const SNOW_MELT = 0.0022;    // ...melting back over roughly seven minutes
  const SNOW_DRIVE = 0.055;    // a driven blizzard whitens on its own timescale
  let pool = 0, poolAmb = 0, poolPeak = 0;
  let cover = 0, coverPeak = 0;
  let wetLook = 0;             // eased "how wet does the world look"

  function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }

  function groundTick(dt) {
    const mode = CBZ.game ? CBZ.game.mode : null;
    // The gang city is the flag'd one: the island always accumulates (that is
    // the mode whose whole subject is weather), the city does it because the
    // owner asked for it and CITY_RAIN_POOLS is the one line that takes it out.
    const ambOk = CFG.WEATHER_GROUND_WATER !== false &&
      (mode === "survival" || CFG.CITY_RAIN_POOLS !== false);
    const rainNow = intensity * (1 - snowMix);
    if (ambOk) {
      poolAmb += (rainNow > 0.05 ? RAIN_FILL * rainNow : -POOL_DRAIN) * dt;
      if (poolAmb < 0) poolAmb = 0;
      if (poolAmb > POOL_CAP_AMB) poolAmb = POOL_CAP_AMB;
    } else poolAmb = 0;
    const want = Math.max(ambOk ? poolAmb : 0, CFG.WEATHER_GROUND_WATER === false ? 0 : drv.pool);
    const step = (want > pool ? POOL_RISE : POOL_FALL) * dt;
    pool += Math.max(-step, Math.min(step, want - pool));
    if (pool < 0.002) pool = 0;
    if (pool > poolPeak) poolPeak = pool;
    if (CBZ.groundWaterSet) CBZ.groundWaterSet(pool);
    if (pool > 0 && mode === "survival") wrapSurvivalWater();

    // ---- snow lying on the ground ----
    if (CFG.WEATHER_SNOW_COVER === false) cover = 0;
    else if (drv.cover >= 0) {
      const d = drv.cover - cover;
      const s = SNOW_DRIVE * dt;
      cover = clamp01(cover + Math.max(-s, Math.min(s, d)));
    } else {
      const snowNow = intensity * snowMix;
      cover = clamp01(cover + (snowNow > 0.05 ? SNOW_FILL * snowNow : -SNOW_MELT) * dt);
    }
    if (cover > coverPeak) coverPeak = cover;

    // ---- the LOOK: wet is rain now, damp is rain lately ----
    const wetWant = Math.max(rainNow, Math.min(1, pool * 3.2));
    wetLook += (wetWant - wetLook) * Math.min(1, dt * 0.5);
    if (wetLook < 0.002) wetLook = 0;
  }
  /* THE ISLAND ASKS A DIFFERENT ORACLE. city/swim.js answers "how deep is it
     here" from CBZ.waterField in the city but from CBZ.survFloodDepthAt on the
     survival island (world/disaster_arena.js owns a real height field there,
     which is better than a synthetic shelf and should stay). That function
     predates ground water by a wave, so without this the rain would fill the
     gang city's streets and leave the island's dry.

     So it is WRAPPED, once, lazily, the way city/killfeed.js wraps the kill
     paths: chain-preserving, degrade-safe, and it can only ever report MORE
     water — a dry point keeps its original (possibly negative) freeboard,
     because the flash-flood def's own threat() reads that sign. */
  let survWrapped = false;
  function wrapSurvivalWater() {
    if (survWrapped || !CBZ.survFloodDepthAt) return;
    survWrapped = true;
    const baseD = CBZ.survFloodDepthAt;
    CBZ.survFloodDepthAt = function (x, z) {
      const d = +baseD(x, z);
      const g = CBZ.groundWaterAt ? CBZ.groundWaterAt(x, z) : 0;
      return g > 0 ? Math.max(g, Number.isFinite(d) ? d : 0) : d;
    };
    /* THE MEAN-LEVEL TWIN GETS THE SAME RAIN. survFloodDepthMeanAt is the same
       water column measured against mean sea level instead of the live crest —
       the reading city/swim.js's bed test and CBZ.survWaterAt take, so that a
       passing swell cannot chatter the swim state (world/disaster_arena.js says
       why). It is a SIBLING of the function above, not a caller of it, so
       without this wrap a flash flood would fill the island's streets for the
       shader and the flood-threat AI and leave them dry for the swimmer — the
       exact split this whole wrap exists to prevent. */
    const baseM = CBZ.survFloodDepthMeanAt;
    if (baseM) CBZ.survFloodDepthMeanAt = function (x, z) {
      const d = +baseM(x, z);
      const g = CBZ.groundWaterAt ? CBZ.groundWaterAt(x, z) : 0;
      return g > 0 ? Math.max(g, Number.isFinite(d) ? d : 0) : d;
    };
    const baseY = CBZ.survSeaHeightAt;
    if (baseY) CBZ.survSeaHeightAt = function (x, z) {
      const y = +baseY(x, z);
      const g = CBZ.groundWaterSurfaceY ? CBZ.groundWaterSurfaceY(x, z) : -Infinity;
      return g > y ? g : y;
    };
  }

  // A new world (or a mode change) must not inherit the last one's puddles.
  CBZ.weatherGroundReset = function () {
    pool = poolAmb = 0; cover = 0; wetLook = 0;
    floodHold = 0; uFlood.value.set(0, 0, 0, 0);
    if (CBZ.groundWaterSet) CBZ.groundWaterSet(0);
    if (CBZ.groundWaterFrontSet) CBZ.groundWaterFrontSet(null);
  };

  /* ---- THE SURFACE COAT ---------------------------------------------------
     ONE shared uniform block, chained onto whatever onBeforeCompile a material
     already had (world/terrain_overhaul.js's terrainDayTint is the template
     this copies). Three effects, all at the FRAGMENT level so nothing is
     re-tessellated and no geometry is touched:

       uCbzWetK    rain darkening on up-facing faces
       uCbzPool    the WATERLINE — everything below the local pond surface is
                   blended to water, which is why the flood visibly climbs the
                   kerb instead of appearing as a flat sheet
       uCbzSnowK   snow lying on up-facing faces — the mountain-cap look,
                   engine-wide and animated

     `vCbzUp` is the world-space upness of the surface, computed once in the
     vertex program: snow and standing water land on horizontal faces and not
     on walls, which is the whole reason this reads as weather instead of a
     colour filter. Cost is a handful of fragment ops on big static surfaces
     and NOTHING at all while every scalar is zero (the branches early-out). */
  const uSnow = { value: 0 }, uWet = { value: 0 };
  const uPool = { value: new THREE.Vector4(0, 0, 0, 0) };   // y, camX, camZ, radius
  const uFront = { value: new THREE.Vector4(1, 0, 0, 0) };  // dx, dz, planeD, on
  const uSky = { value: new THREE.Vector4(0.55, 0.63, 0.72, 0) };  // sky rgb + clock
  /* THE FLASH-FLOOD LOOK (2026-08-23, systems/flashflood.js's seam). Real
     floodwater is not the clear blue sheet the coat paints for rain: it is
     OPAQUE MUD, it stands taller at the crest of a moving front, and it
     visibly streams. One extra uniform carries all of it —
       x  mud       0..1 blend from clear water to opaque brown
       y  crestLift metres the waterline climbs in the band behind the front
       z  band      metres of churned crest band behind the front line
       w  flow      m/s of visible downstream streaming
     — and every shader term it feeds is gated on it being nonzero, so a build
     that never calls CBZ.weatherFloodLook renders pixel-identical to before.
     HOLD-DECAYED like weatherDrive: the caller asserts it every frame, and a
     def that dies mid-event cannot leave the world muddy. */
  const uFlood = { value: new THREE.Vector4(0, 0, 0, 0) };
  const floodTgt = { mud: 0, crest: 0, band: 0, flow: 0 };
  let floodHold = 0;
  CBZ.weatherFloodLook = function (o) {
    if (!o) { floodHold = 0; return; }
    floodTgt.mud = Math.max(0, Math.min(1, +o.mud || 0));
    floodTgt.crest = Math.max(0, +o.crest || 0);
    floodTgt.band = Math.max(0, +o.band || 0);
    floodTgt.flow = Math.max(0, +o.flow || 0);
    floodHold = 1.2;
  };
  /* WHY THE WATER IS NOT JUST A DARK PATCH. Three terms, all free:
     · a FRESNEL sky reflection — water read at a grazing angle is mostly sky,
       which is the single strongest cue that a surface is wet rather than
       painted, and the sky colour is handed in live so it works at night too;
     · a RIPPLE that modulates that reflection, so the sheet moves;
     · FOAM in the first metres behind a flash-flood front, because the leading
       edge of a run-up is whiter than the water behind it (the same asymmetry
       world/water_spec.js's swash is built on). */
  const COAT_FS =
    "float cbzUp = vCbzUp * vCbzUp;\n" +
    "if (uCbzWetK > 0.001) gl_FragColor.rgb *= 1.0 - 0.40 * uCbzWetK * cbzUp;\n" +
    "if (uCbzPool.w > 0.0) {\n" +
    // The camera cell's pond level is only honest NEAR the camera, so the
    // effect fades out with distance — but the fade may only touch the BLEND,
    // never the depth. Fading the depth walks the waterline back down to the
    // ground and draws a curved false shoreline across the middle distance.
    "  float cbzFade = 1.0 - smoothstep(uCbzPool.w * 0.72, uCbzPool.w, length(vCbzWP.xz - uCbzPool.yz));\n" +
    "  float cbzD = uCbzPool.x - vCbzWP.y;\n" +
    "  float cbzFd = 1e9;\n" +
    "  if (uCbzFront.w > 0.5) {\n" +
    "    cbzFd = uCbzFront.z - dot(vCbzWP.xz, uCbzFront.xy);\n" +
    // THE CREST: a flash-flood front stands HIGHER than the water behind it,
    // so in the band behind the line the waterline is lifted — the wet edge
    // visibly bulges up slopes and kerbs at the wall and settles after it.
    // Zero-gated: crestLift is 0 unless flashflood.js is driving the event.
    "    if (uCbzFlood.y > 0.0 && cbzFd > 0.0 && cbzFd < uCbzFlood.z)\n" +
    "      cbzD += uCbzFlood.y * sin(min(1.0, cbzFd / uCbzFlood.z) * 3.14159);\n" +
    "    if (cbzFd < 0.0) cbzD = -1.0;\n" +
    "  }\n" +
    "  if (cbzD > 0.0) {\n" +
    "    float cbzW = smoothstep(0.0, 0.05, cbzD) * cbzUp * cbzFade;\n" +
    "    vec3 cbzV = normalize(cameraPosition - vCbzWP);\n" +
    "    float cbzFres = pow(1.0 - clamp(cbzV.y, 0.0, 1.0), 3.0);\n" +
    // MOVING WATER MOVES. With a live flow the ripple is a set of streaks
    // perpendicular to the travel direction, advected downstream at the
    // front's own speed — two frames a tenth of a second apart differ, which
    // is exactly the cue a still sheet of sine product cannot give.
    "    float cbzRip;\n" +
    "    if (uCbzFlood.w > 0.001) {\n" +
    "      cbzRip = 0.5 + 0.5 * sin(dot(vCbzWP.xz, uCbzFront.xy) * 2.4 - uCbzSky.w * (2.2 + uCbzFlood.w * 1.6)\n" +
    "        + sin(vCbzWP.x * 0.9 + vCbzWP.z * 1.2) * 1.3);\n" +
    "    } else {\n" +
    "      cbzRip = 0.5 + 0.5 * sin(vCbzWP.x * 2.3 + uCbzSky.w * 2.6) * sin(vCbzWP.z * 1.7 - uCbzSky.w * 2.1);\n" +
    "    }\n" +
    "    vec3 cbzDeep = mix(gl_FragColor.rgb * 0.18, vec3(0.026, 0.048, 0.058), min(1.0, cbzD * 1.4));\n" +
    // the sky term is CAPPED well under 1: water read at a grazing angle really
    // is mostly sky, but letting it get there makes a flooded street read as a
    // pale sheet against pale asphalt — the flood has to stay unmistakably
    // DARKER than the road it covered.
    "    vec3 cbzWater = mix(cbzDeep, uCbzSky.rgb, clamp(cbzFres * (0.26 + 0.34 * cbzRip), 0.0, 0.58));\n" +
    // MUD. You cannot see the ground under real floodwater: it is a suspended
    // sediment load, matte and brown, and it goes opaque FAST with depth. The
    // sky reflection is mostly killed with it — mud does not mirror.
    "    if (uCbzFlood.x > 0.001) {\n" +
    "      vec3 cbzMud = vec3(0.215, 0.158, 0.105) * (0.85 + 0.28 * cbzRip);\n" +
    "      cbzWater = mix(cbzWater, cbzMud, uCbzFlood.x * min(1.0, 0.35 + cbzD * 1.1));\n" +
    "    }\n" +
    // the foam band scales with the crest band instead of a fixed 3.5 m, and
    // in a muddy event it is CHURNED — broken up by the moving ripple into
    // streaks of white matter on brown, never a clean white blanket (the
    // first pass painted half the flood pale). Flag off: identical output.
    "    float cbzFoamW = max(3.5, uCbzFlood.z * 0.25);\n" +
    "    if (cbzFd < cbzFoamW) {\n" +
    "      float cbzFoamK = (1.0 - cbzFd / cbzFoamW) * 0.85;\n" +
    "      if (uCbzFlood.x > 0.001) cbzFoamK *= 0.30 + 0.55 * cbzRip;\n" +
    // dirty foam: the boil at a muddy crest is white MATTER on brown water,
    // not clean surf — pure white read as fog/snow in the storyboard
    "      vec3 cbzFoamC = mix(vec3(0.88, 0.92, 0.95), vec3(0.80, 0.76, 0.66), uCbzFlood.x * 0.55);\n" +
    "      cbzWater = mix(cbzWater, cbzFoamC, cbzFoamK);\n" +
    "    }\n" +
    "    gl_FragColor.rgb = mix(gl_FragColor.rgb, cbzWater, cbzW);\n" +
    "  }\n" +
    "}\n" +
    "if (uCbzSnowK > 0.001) gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.93, 0.95, 0.99), clamp(uCbzSnowK * cbzUp, 0.0, 1.0));\n";

  // EVERY COATED MATERIAL IS A SHADER RECOMPILE, and a storm that recompiles a
  // thousand of them on the frame it starts is a freeze. So the sweep is
  // bounded twice: only genuinely LARGE surfaces qualify (the ground plate, the
  // road fields, the merged static batches, big facades — the things weather
  // visibly lands on), and never more than COAT_MAX of them. Everything else
  // still gets the fog/sky it always had.
  // MEASURED, not guessed: at radius 20 the sweep found 355 materials in the
  // gang city and the recompile burst wedged a headless renderer for minutes.
  // At 34 it keeps what weather actually lands on — the ground plate, the road
  // fields, the merged static batches, the big roofs — and drops the individual
  // facades, which are vertical and therefore contribute nothing anyway.
  const COAT_MIN_R = 34;     // metres of bounding radius to be worth coating
  const COAT_MAX = 220;      // hard ceiling on recompiles
  const coatQueue = [];      // materials found but not yet patched
  const coated = [];         // materials carrying the uniforms
  let coatScanned = false;

  function coatMat(mat) {
    if (!mat || mat.isShaderMaterial || mat.isRawShaderMaterial) return false;
    if (mat.transparent || mat.userData && mat.userData._cbzCoat) return false;
    const prev = mat.onBeforeCompile;
    // r128 keys the program cache on onBeforeCompile.toString() — and OUR
    // source is identical for every material, so without a key that carries
    // the PREVIOUS hook, a plain material would silently reuse the compiled
    // program of one that had also been fog-scaled or day-tinted.
    const prevSrc = prev ? String(prev) : "none";
    mat.onBeforeCompile = function (sh) {
      if (prev) prev.call(this, sh);
      let vs = sh.vertexShader;
      if (vs.indexOf("#include <fog_vertex>") < 0) return;   // unknown shader: leave it alone
      let fs = sh.fragmentShader;
      const anchor = fs.indexOf("#include <tonemapping_fragment>") >= 0
        ? "#include <tonemapping_fragment>"
        : (fs.indexOf("#include <fog_fragment>") >= 0 ? "#include <fog_fragment>" : null);
      if (!anchor) return;
      sh.uniforms.uCbzSnowK = uSnow;
      sh.uniforms.uCbzWetK = uWet;
      sh.uniforms.uCbzPool = uPool;
      sh.uniforms.uCbzFront = uFront;
      sh.uniforms.uCbzSky = uSky;
      sh.uniforms.uCbzFlood = uFlood;
      sh.vertexShader = "varying vec3 vCbzWP;\nvarying float vCbzUp;\n" + vs.replace(
        "#include <fog_vertex>",
        "vCbzWP = (modelMatrix * vec4(transformed, 1.0)).xyz;\n" +
        // the raw `normal` ATTRIBUTE, not `objectNormal`: MeshBasicMaterial's
        // vertex program never includes <beginnormal_vertex>, so objectNormal
        // does not exist there — and city/biome_snow.js's whole massif is
        // Basic. The attribute is declared in every non-raw shader prefix.
        "vCbzUp = clamp(normalize(mat3(modelMatrix) * normal).y, 0.0, 1.0);\n" +
        "#include <fog_vertex>");
      sh.fragmentShader = "uniform float uCbzSnowK;\nuniform float uCbzWetK;\n" +
        "uniform vec4 uCbzPool;\nuniform vec4 uCbzFront;\nuniform vec4 uCbzSky;\nuniform vec4 uCbzFlood;\n" +
        "varying vec3 vCbzWP;\nvarying float vCbzUp;\n" + fs.replace(anchor, COAT_FS + anchor);
    };
    mat.customProgramCacheKey = function () { return "cbzCoat|" + prevSrc; };
    mat.needsUpdate = true;
    mat.userData = mat.userData || {};
    mat.userData._cbzCoat = 1;
    coated.push(mat);
    return true;
  }

  // ONE scan of the live scene, the first time weather actually has something
  // to put on the ground. Candidates are BIG static surfaces — the ground
  // plate, the road fields, merged building/prop batches, the island's hills —
  // never a character rig (a person is not a surface snow lies on) and never
  // the sea (it has its own shader and its own idea of white).
  function coatScan() {
    if (coatScanned || CFG.WEATHER_SURFACE_COAT === false) return;
    coatScanned = true;
    if (!scene || !scene.traverse) return;
    const seen = new Set();
    scene.traverse(function (o) {
      // instanced batches carry their transform in instanceMatrix, which the
      // injected modelMatrix maths cannot see — their waterline would be wrong
      if (!o.isMesh || o.isSkinnedMesh || o.isInstancedMesh || !o.material) return;
      if (o === CBZ.citySea) return;
      const ud = o.userData;
      if (ud && (ud.waterSurface || ud.noCoat)) return;
      const g = o.geometry;
      if (!g) return;
      if (!g.attributes || !g.attributes.normal || !g.attributes.position) return;
      if (!g.boundingSphere) { try { g.computeBoundingSphere(); } catch (e) { return; } }
      const bs = g.boundingSphere;
      // `userData.coat` is the author's OPT-IN, and it is the twin of the
      // `noCoat` opt-out three lines up: this is ground, coat it whatever size
      // it is. COAT_MIN_R exists to keep a scan of a whole city off ten
      // thousand small props, and it is exactly right for that — but it has no
      // way to know that the disaster island's outlying hills (bounding radius
      // 16-23 m against a 34 m bar) are TERRAIN. Measured: a blizzard whitened
      // the sea-level plate and the central refuge cone and left three green
      // hills standing in the middle of a white island. A size heuristic
      // cannot answer "is this the ground"; the file that built it can.
      const forced = !!(ud && ud.coat);
      if (!forced && (!bs || !(bs.radius * Math.max(Math.abs(o.scale.x), Math.abs(o.scale.z)) >= COAT_MIN_R))) return;
      const ms = Array.isArray(o.material) ? o.material : [o.material];
      for (let i = 0; i < ms.length; i++) {
        const m = ms[i];
        if (!m || seen.has(m.uuid)) continue;
        seen.add(m.uuid);
        if (m.userData && m.userData._cbzCoat) continue;
        if (coated.length + coatQueue.length >= COAT_MAX) return;
        coatQueue.push(m);
      }
    });
  }

  function coatTick(dt) {
    if (CFG.WEATHER_SURFACE_COAT === false) return;
    // the flood look eases toward its asserted target while held, and bleeds
    // back to clear water when the assertions stop (event ended or def died)
    floodHold -= dt || 0;
    const fv = uFlood.value, fk = Math.min(1, (dt || 0) * 2.5);
    const wantMud = floodHold > 0 ? floodTgt.mud : 0;
    fv.x += (wantMud - fv.x) * fk;
    fv.y += ((floodHold > 0 ? floodTgt.crest : 0) - fv.y) * fk;
    fv.z += ((floodHold > 0 ? floodTgt.band : 0) - fv.z) * fk;
    fv.w += ((floodHold > 0 ? floodTgt.flow : 0) - fv.w) * fk;
    if (fv.x < 0.004 && floodHold <= 0) fv.set(0, 0, 0, 0);
    if (!coatScanned && (wetLook > 0.004 || cover > 0.004 || pool > 0.004)) coatScan();
    // patched a FEW at a time: a material recompiles on needsUpdate, and
    // recompiling four hundred of them on one frame is a visible stall.
    for (let n = 0; n < 3 && coatQueue.length; n++) coatMat(coatQueue.pop());

    uWet.value = wetLook;
    uSnow.value = cover;
    // The pond level is only honest near ONE point, and in the game that
    // point is the camera (it rides the player). A photography harness that
    // parks its own camera somewhere else may nominate the point instead —
    // CBZ.weatherPoolAnchor {x,z} — or the flooded street it is framing
    // renders bone dry. Unset (the shipped game), this line is the camera.
    const cp = CBZ.weatherPoolAnchor || cam.position;
    if (pool > 0.01 && CBZ.groundWaterLevelY) {
      const y = +CBZ.groundWaterLevelY(cp.x, cp.z);
      if (Number.isFinite(y)) uPool.value.set(y, cp.x, cp.z, 380);
      else uPool.value.set(0, 0, 0, 0);
    } else uPool.value.set(0, 0, 0, 0);
    const F = CBZ.groundWaterFront ? CBZ.groundWaterFront() : null;
    if (F) uFront.value.set(F.dx, F.dz, F.x * F.dx + F.z * F.dz + F.s, 1);
    else uFront.value.set(1, 0, 0, 0);
    // the sky the water reflects is whatever the sky IS this minute — the fog
    // colour daynight.js writes every frame, so the flood goes dark at night
    // instead of glowing like a lit pool.
    const fc = scene.fog && scene.fog.color;
    uSky.value.set(fc ? fc.r * 1.05 : 0.55, fc ? fc.g * 1.05 : 0.63, fc ? fc.b * 1.08 : 0.72,
      (CBZ.now || 0) * 0.001);
  }

  /* ---- WHAT THE WATER DOES TO YOU ----------------------------------------
     THE SCIENCE, priced (owner's brief): six inches of fast water knocks a
     person down; two feet floats a vehicle; the killers are drowning,
     blunt trauma in the current, hypothermia, and electrocution from
     submerged utilities. Every one of those is a real state here, and none
     of it is a special case for one disaster — it is what deep moving water
     DOES, in any mode, whether a def asserted the level or the rain did. */
  const KNOCK_D = 0.15;      // six inches
  const KNOCK_V = 2.0;       // ...moving this fast
  const FLOAT_D = 0.60;      // two feet: a car is off its tyres
  const COLD_SECS = 26;      // immersion before the cold starts costing hp
  let shinKnockdowns = 0, carsFloated = 0, electrocutions = 0, coldDeaths = 0;
  const _fl = { x: 0, z: 0, speed: 0 };

  function survOn() { return CBZ.game && CBZ.game.mode === "survival" && CBZ.surv; }
  /* ONE HURT, FOUR ROSTERS. Each kind goes down the bus that owns it — the
     survival mode's own hurt(), the city's player-damage path, the police
     path, the ped path — so the killfeed reads the same cause whichever mode
     the flood happened in and no roster is damaged behind its owner's back. */
  function hurt(a, dmg, cause, kind) {
    if (!a || a.dead) return;
    if (kind === "player") {
      if (survOn() && CBZ.surv.hurt) CBZ.surv.hurt(CBZ.surv.playerActor || a, dmg, { cause: cause });
      else if (CBZ.cityHurtPlayer) CBZ.cityHurtPlayer(dmg, a.pos.x, a.pos.z, cause, false, null, false);
      return;
    }
    if (kind === "bot") { if (CBZ.surv && CBZ.surv.hurt) CBZ.surv.hurt(a, dmg, { cause: cause }); return; }
    if (kind === "cop" && CBZ.cityHurtCop) {
      CBZ.cityHurtCop(a, dmg, { fromX: a.pos.x, fromZ: a.pos.z, cause: cause });
      return;
    }
    // systems/childsafe.js seals `hp` on children behind an accessor that
    // silently swallows decreases, so a raw write here would not throw — it
    // would just be a lie in the audit (damage counted, never applied).
    // Refuse it out loud instead: children are not flood casualties.
    if (a.child) return;
    a.hp = (a.hp == null ? 100 : a.hp) - dmg;
    if (a.hp <= 0 && CBZ.cityKillPed) CBZ.cityKillPed(a, { fromX: a.pos.x, fromZ: a.pos.z, force: 3 }, cause);
  }
  function eachActor(fn) {
    if (survOn()) {
      const b = CBZ.bots || [];
      for (let i = 0; i < b.length; i++) if (!b[i].dead) fn(b[i], "bot");
      const pa = CBZ.surv.playerActor;
      if (pa && !pa.dead) fn(pa, "player");
      return;
    }
    const p = CBZ.cityPeds || [];
    for (let i = 0; i < p.length; i++) if (!p[i].dead && !p[i].inCar) fn(p[i], "ped");
    const c = CBZ.cityCops || [];
    for (let i = 0; i < c.length; i++) if (!c[i].dead) fn(c[i], "cop");
    const me = CBZ.city && CBZ.city.playerActor;
    if (me && !me.dead) fn(me, "player");
  }

  let hazT = 0, arcT = 0, arc = null, lampList = null, lampT = 0;
  function hazardTick(dt) {
    if (CFG.WEATHER_FLOOD_HAZARD === false || pool <= 0.02) {
      if (arc) arc = null;
      return;
    }
    const depthAt = CBZ.groundWaterAt;
    const flowAt = CBZ.groundWaterFlowAt;
    if (!depthAt || !flowAt) return;
    // the crowd is priced a few times a second, the player every frame — he is
    // the one who can feel the difference
    hazT -= dt;
    const crowd = hazT <= 0;
    if (crowd) hazT = 0.2;
    const P = CBZ.player;

    eachActor(function (a, kind) {
      const me = kind === "player";
      if (!a.pos) return;
      if (!me && !crowd) return;
      if (!me && CBZ.body && CBZ.body.busy(a)) return;
      const step = me ? dt : 0.2;
      const d = depthAt(a.pos.x, a.pos.z);
      if (d <= 0.02) { a._fwT = 0; return; }
      const f = flowAt(a.pos.x, a.pos.z, _fl);
      // SIX INCHES OF FAST WATER TAKES YOU OFF YOUR FEET
      if (d >= KNOCK_D && f.speed >= KNOCK_V && CBZ.body) {
        const p = Math.min(0.9, (f.speed - KNOCK_V) * 0.22 + (d - KNOCK_D) * 0.5) * step;
        if (Math.random() < p) {
          // FORCE MATTERS: systems/grapple.js reads >12 as a full launch with a
          // violent ragdoll, and water does not throw people through the air —
          // it takes their feet away. 4.5 + v/2 lands in the stagger/topple
          // band even in a 10 m/s torrent, which is the real injury.
          CBZ.body.hit(a, { dir: { x: f.x / (f.speed || 1), z: f.z / (f.speed || 1) },
            force: 4.5 + f.speed * 0.5, knockdown: 1.0 + Math.random() * 0.6 });
          shinKnockdowns++;
        }
      }
      // and once you are in it, it carries you
      if (d >= 0.25 && f.speed > 0.6) {
        const drag = Math.min(1, (d - 0.2) * 1.6) * f.speed * 0.55;
        if (me) {
          const ph = (P && (P._phys || (P._phys = { kx: 0, kz: 0 }))) || null;
          if (ph) { ph.kx = (ph.kx || 0) + f.x * drag * step; ph.kz = (ph.kz || 0) + f.z * drag * step; }
        } else {
          a.pos.x += f.x * drag * step * 0.5;
          a.pos.z += f.z * drag * step * 0.5;
          if (CBZ.collide) CBZ.collide(a.pos, 0.5);
        }
      }
      // BLUNT TRAUMA: debris in a torrent, not a gentle drift
      if (d >= 0.5 && f.speed >= 4.5 && Math.random() < 0.10 * step) {
        hurt(a, 7 + Math.random() * 9, "swept away by the flash flood", kind);
      }
      // HYPOTHERMIA: immersion has a clock, and it is the flood's quiet killer
      a._fwT = (a._fwT || 0) + (d >= FLOAT_D ? step : -step * 0.5);
      if (a._fwT < 0) a._fwT = 0;
      if (a._fwT > COLD_SECS) {
        const before = me ? null : a.hp;
        hurt(a, (2.2 + (a._fwT - COLD_SECS) * 0.12) * step, "died of hypothermia in the floodwater", kind);
        if (before != null && a.hp != null && a.hp <= 0 && before > 0) coldDeaths++;
      }
    });

    // THE CAR IS THE TRAP. vehicles.js already drowns the engine and tips you
    // out when the water takes it — what it cannot know is that you went under
    // with the cabin, so the air you surface with is the air you had left.
    if (P && P.pos) {
      const dCar = depthAt(P.pos.x, P.pos.z);
      if (P.driving && dCar >= FLOAT_D) {
        P._floodTrap = Math.min(6, (P._floodTrap || 0) + dt);
        if (P.breath != null) P.breath = Math.max(0, P.breath - dt * 6);
      } else if (P._floodTrap) {
        P._floodTrap -= dt * 0.5;
        if (P._floodTrap <= 0) P._floodTrap = 0;
        // still under, and it was the car that put you there
        if (dCar > 1.1 && P.breath != null && P.breath <= 0.2) {
          hurt(CBZ.city && CBZ.city.playerActor || CBZ.surv && CBZ.surv.playerActor || P,
            9 * dt, "drowned trapped in a car", "player");
        }
      }
    }

    // ELECTROCUTION — a submerged street-light base energises the water around
    // it. RARE, and it announces itself: the sparking at the waterline is the
    // tell, and it is the only warning there is.
    if (!survOn()) {
      lampT -= dt;
      if (!lampList || lampT <= 0) {
        lampT = 4;
        lampList = [];
        const A = CBZ.city && CBZ.city.arena;
        const sp = (A && A.streetProps) || [];
        const cp = cam.position;
        for (let i = 0; i < sp.length && lampList.length < 40; i++) {
          const s = sp[i];
          if (!s || s.type !== "lamp") continue;
          if (Math.abs(s.x - cp.x) > 90 || Math.abs(s.z - cp.z) > 90) continue;
          lampList.push(s);
        }
      }
      arcT -= dt;
      if (arc) {
        arc.t -= dt;
        if (arc.t <= 0) arc = null;
        else {
          if (CBZ.bulletImpact && Math.random() < dt * 26) {
            _v3a.set(arc.x + (Math.random() - 0.5) * 0.5, arc.y, arc.z + (Math.random() - 0.5) * 0.5);
            _v3b.set(0, 1, 0);
            try { CBZ.bulletImpact(_v3a, _v3b, { kind: "spark", power: 1.4 }); } catch (e) {}
          }
          eachActor(function (a, kind) {
            if (!a.pos || a._zapped) return;
            if (Math.hypot(a.pos.x - arc.x, a.pos.z - arc.z) > 3.6) return;
            if (depthAt(a.pos.x, a.pos.z) < 0.2) return;
            a._zapped = 1;
            electrocutions++;
            hurt(a, 260, "electrocuted in the floodwater", kind);
          });
        }
      } else if (arcT <= 0 && lampList && lampList.length) {
        arcT = 9 + Math.random() * 14;
        const s = lampList[(Math.random() * lampList.length) | 0];
        if (s && depthAt(s.x, s.z) >= 0.28) {
          const gy = CBZ.floorAt ? CBZ.floorAt(s.x, s.z) : 0;
          arc = { x: s.x, z: s.z, y: gy + depthAt(s.x, s.z), t: 1.6 };
          if (CBZ.sfxAt) CBZ.sfxAt("shoot_pistol", s.x, s.z, { volume: 0.25 });
          eachActor(function (a) { a._zapped = 0; });
        }
      }
    }

    // CARS FLOAT. vehicles.js sinks a car that finds itself over water and
    // world/water_float.js adopts the hull — this only COUNTS it, so the audit
    // can prove the two feet of water did something a flag could not fake.
    const cars = CBZ.cityCars;
    if (cars && crowd) for (let i = 0; i < cars.length; i++) {
      const c = cars[i];
      if (!c || !c.pos || c._gwFloated) continue;
      if (depthAt(c.pos.x, c.pos.z) >= FLOAT_D && (c._flooded || c.dead)) { c._gwFloated = 1; carsFloated++; }
    }
  }
  const _v3a = new THREE.Vector3(), _v3b = new THREE.Vector3();

  // ---- main tick ------------------------------------------------------
  // order 90: late, so we darken fog AFTER daynight (order 2) sets it and
  // adjust hemi AFTER daynight has written its baseline this frame.
  CBZ.onAlways(90, function (dt) {
    if (!dt || dt <= 0) return;

    // WEATHER OUTLIVES ITSELF NOW: puddles have to drain and snow has to melt
    // long after the last drop fell, so the dark path may only close when the
    // GROUND is dry too — otherwise a storm would leave the streets flooded
    // for the rest of the session.
    const groundLive = pool > 0.0005 || cover > 0.0005 || wetLook > 0.0005 ||
      drv.pool > 0.0005 || drv.cover >= 0 || coatQueue.length > 0;
    // DARK-PATH EARLY-OUT: with the ambient storm off and nothing driving,
    // the whole tick is skipped — the throttled indoor test used to scan
    // CBZ.platforms and raycast 5×/sec for a cloud that could never appear.
    // (`strobeS` is in the test because a drawn bolt can strike under a clear
    // sky — a scripted beat, a test harness — and the tick that consumes the
    // request must not be the one thing that got skipped.)
    // (`overcast` joins the test for the same reason the ground did: the deck
    // outlives the last drop by design, and a tick skipped while it is still
    // easing out would freeze a storm sky over a finished storm.)
    if (!AUTO && drvHold <= 0 && intensity === 0 && drv.fog <= 0 &&
        drv.lightning <= 0 && flashT <= 0 && strobeS <= 0 && pendingThunder <= 0 &&
        overcast <= 0.0005 && !groundLive) return;

    // camera forward (XZ) for seedDrop's lead bias — matrix z-basis, once per
    // tick. Looking straight down leaves the previous bearing standing.
    const _me = cam.matrixWorld.elements;
    const _fm = Math.hypot(_me[8], _me[10]);
    if (_fm > 1e-4) { fwdX = -_me[8] / _fm; fwdZ = -_me[10] / _fm; }

    // ---- evolve the AMBIENT storm over minutes ----
    let ambient = 0, ambWind = 0;
    if (AUTO) {
      phaseT -= dt;
      if (phaseT <= 0) rollWeather();
      ambient = (autoI += (target - autoI) * Math.min(1, dt * 0.12));
      ambWind = (autoW += (windTarget - autoW) * Math.min(1, dt * 0.25));
    }

    // ---- the DRIVEN layer wins while it is being asserted ----
    if (drvHold > 0) {
      drvHold -= dt;
    } else {
      // released: bleed every driven field to zero so the sky eases back
      const k = Math.min(1, dt / RELEASE);
      drv.rain -= drv.rain * k; drv.snow -= drv.snow * k;
      drv.wind -= drv.wind * k; drv.fog -= drv.fog * k;
      drv.lightning -= drv.lightning * k;
      // the flood recedes with the storm that made it; the snow it laid down
      // goes back to melting on its own clock rather than snapping away
      drv.pool -= drv.pool * k;
      if (drv.pool < 0.004) drv.pool = 0;
      if (drv.cover >= 0) drv.cover = -1;
      if (drv.rain < 0.004 && drv.snow < 0.004) { drv.rain = drv.snow = 0; drv.fogColor = -1; }
    }
    const drvI = Math.max(drv.rain, drv.snow);
    intensity = Math.max(ambient, drvI);
    // WIND: the driven bearing wins outright while driven (a hurricane's wind
    // IS the weather's wind), otherwise the ambient bearing eases in.
    const tgtWind = drvI > 0 || drv.wind > 0 ? drv.wind : ambWind;
    const bx = drvI > 0 || drv.wind > 0 ? drv.wx : windTX;
    const bz = drvI > 0 || drv.wind > 0 ? drv.wz : windTZ;
    wind += (tgtWind - wind) * Math.min(1, dt * 0.9);
    windX += (bx - windX) * Math.min(1, dt * 1.2);
    windZ += (bz - windZ) * Math.min(1, dt * 1.2);
    const wm = Math.hypot(windX, windZ) || 1; windX /= wm; windZ /= wm;
    if (intensity < 0.002) intensity = 0;

    // snow LOOK: fat slow white flakes instead of thin fast blue-grey streaks.
    // One material, two ends of a lerp — never a second particle system.
    const snowT = drvI > 0 ? (drv.snow / Math.max(1e-4, drvI)) : 0;
    snowMix += (snowT - snowMix) * Math.min(1, dt * 2.2);
    mat.size = 0.16 + snowMix * 0.16;
    mat.color.setRGB(0.737 + snowMix * 0.263, 0.823 + snowMix * 0.177, 0.910 + snowMix * 0.090);

    // ---- indoor check (throttled ~5x/sec, never per-drop) ----
    indoorCD -= dt;
    if (indoorCD <= 0) {
      indoors = testIndoors();
      indoorCD = 0.2;
    }

    // ---- how many drops are live this frame ----
    // (cap read at USE time — the quality slider retunes the rain live)
    const live = Math.round(intensity * maxDrops());
    // suppress the cloud entirely while under a roof — re-shows the instant the
    // next throttled test clears `indoors` after stepping back outside.
    rain.visible = live > 0 && !indoors;
    mat.opacity = Math.min(0.55, 0.18 + intensity * 0.5);

    if (live > 0 && !indoors) {
      const cx = cam.position.x, cz = cam.position.z;
      const driftX = windX * wind;
      const driftZ = windZ * wind;
      // snow falls at about a fifth of rain's terminal speed and wanders
      const fallK = 1 - snowMix * 0.78;
      // recycle ring includes the forward bias — a drop seeded at the led
      // centre's far edge must not be born already outside the ring.
      const r2 = (RADIUS + FWD_BIAS + 3) * (RADIUS + FWD_BIAS + 3);

      for (let i = 0; i < live; i++) {
        const o = i * 3;
        // fall + wind drift
        positions[o + 1] -= velY[i] * fallK * dt;
        positions[o]     += driftX * dt;
        positions[o + 2] += driftZ * dt;

        let recycle = positions[o + 1] < BOTTOM;
        if (!recycle) {
          // if a drop has drifted out of the ring, recycle it too so the
          // cloud stays centred on the player (cheap distance check).
          const dx = positions[o] - cx, dz = positions[o + 2] - cz;
          if (dx * dx + dz * dz > r2) recycle = true;
        }
        if (recycle) {
          seedDrop(i, cx, cz, false); // resets to a fresh column top
        }
      }
      geo.setDrawRange(0, live);
      attr.needsUpdate = true;
    } else {
      geo.setDrawRange(0, 0);
    }

    // ---- the cloud deck overhead (read by core/sky.js) ----
    // Three sources, max-combined, because a sky can be overcast for any of
    // them independently: rain implies the cloud it fell out of; a driver
    // asserting `lightning` IS declaring a storm whatever the rain says; and
    // a driver's own `fog` is its mood dial, which a whiteout uses to bring
    // the ceiling down without raining harder.
    const ocTarget = Math.min(1, Math.max(
      intensity * 1.25 - 0.05,
      drv.lightning * 0.95,
      drv.fog * 0.9));
    const ocEase = (ocTarget < overcast && CFG.WEATHER_SLOW_CLEAR !== false) ? OC_EASE_DOWN : OC_EASE;
    overcast += (ocTarget - overcast) * Math.min(1, dt * ocEase);
    if (overcast < 0.0004) overcast = 0;

    // ---- fog darkening while raining ----
    // A driver may nominate its OWN mood colour (a blizzard's whiteout is not
    // storm-grey) and its own strength, so the same one lerp serves both.
    const fogK = Math.max(intensity * 0.6, drv.fog);
    if (scene.fog && scene.fog.color && fogK > 0.001) {
      _fogTmp.setHex(drv.fogColor >= 0 ? drv.fogColor : FOG_DARK);
      scene.fog.color.lerp(_fogTmp, Math.min(0.85, fogK));
    }

    // ---- lightning (night only, unless a driver explicitly asks for it) ----
    tryLightning(dt);

    // ---- and what the weather LEAVES: water on the ground, snow on it, and
    //      the price of standing in either ----
    groundTick(dt);
    coatTick(dt);
    hazardTick(dt);
  });

  // Leaving a mode must put the ground back. The sea already does this
  // (systems/disasters.js @28.05 zeroes the surge); the puddles are ours.
  let lastMode = null;
  CBZ.onAlways(28.06, function () {
    const m = CBZ.game ? CBZ.game.mode : null;
    if (m === lastMode) return;
    lastMode = m;
    if (CBZ.weatherGroundReset) CBZ.weatherGroundReset();
    if (CBZ.groundWaterForget) CBZ.groundWaterForget();
    // a new mode is a new WORLD: the survival island's ground did not exist
    // when the city was scanned, so the sweep has to be allowed to run again.
    // Already-coated materials are skipped by their own _cbzCoat tag.
    coatScanned = false;
  });

  // ---- new-run / reset hygiene ---------------------------------------
  // If a fresh run starts (elapsed resets), keep current weather but make
  // sure no lightning flash is stuck "on" across the transition.
  let lastElapsed = 0;
  CBZ.onAlways(91, function () {
    const g = CBZ.game;
    if (!g) return;
    if (g.elapsed < lastElapsed - 0.5) {
      // run restarted: clear any in-flight flash so hemi isn't left bright.
      // daynight (order 2) re-asserts hemi.intensity every frame, so simply
      // dropping our additive flash is enough — no need to restore by hand.
      flashT = 0; flash = 0; flashBump = 0; pendingThunder = 0; strikeCD = 4 + rng() * 4;
    }
    lastElapsed = g.elapsed;
  });

  // expose a tiny read-only hook for other systems / debugging
  CBZ.weather = {
    get intensity() { return intensity; },
    get raining() { return intensity > 0.1; },
    get wind() { return wind; },
    get windX() { return windX; },
    get windZ() { return windZ; },
    get snow() { return snowMix; },
    get driven() { return drvHold > 0; },
    // WHAT IS OVERHEAD. `overcast` is how much cloud deck the sky is carrying,
    // 0..1 (core/sky.js paints it); `flash` is the live additive intensity of
    // a lightning stroke, 0 between them.
    get overcast() { return overcast; },
    get flash() { return flashBump; },
    // WHAT THE WEATHER LEFT BEHIND — the two scalars anything downstream
    // needs to know the world is wet or white without asking three files.
    get groundWater() { return pool; },
    get snowCover() { return cover; },
    get wetness() { return wetLook; },
  };

  // Evidence for the ratchet: is the shared weather actually carrying the load
  // a disaster used to fork? `driven` proves the API is being used at all;
  // `auto` says whether the ambient storm is even running on this build.
  CBZ.weatherAudit = function () {
    return {
      auto: AUTO,
      driveOn: CFG.WEATHER_DRIVE !== false,
      driven: drvHold > 0,
      intensity: +intensity.toFixed(3),
      wind: +wind.toFixed(2),
      windDir: [+windX.toFixed(3), +windZ.toFixed(3)],
      snowMix: +snowMix.toFixed(3),
      indoors: indoors,
      /* ---- WEATHER LEAVES STATE ON THE GROUND: the evidence ----
         Every one of these is measured from live state. `privateWaterPlanes`
         is the ratchet that matters: the rain floods the city through the
         shared water field, so the count of meshes anybody built to fake a
         rising flood must stay at ZERO. */
      groundWater: +pool.toFixed(3),
      groundWaterPeak: +poolPeak.toFixed(3),
      snowCover: +cover.toFixed(3),
      snowCoverPeak: +coverPeak.toFixed(3),
      wetness: +wetLook.toFixed(3),
      coatedMaterials: coated.length,
      coatPending: coatQueue.length,
      shinKnockdowns: shinKnockdowns,
      carsFloated: carsFloated,
      electrocutions: electrocutions,
      hypothermiaDeaths: coldDeaths,
      privateWaterPlanes: CBZ.groundWaterAudit ? CBZ.groundWaterAudit().privateWaterPlanes : 0,
      flags: {
        groundWater: CFG.WEATHER_GROUND_WATER !== false,
        cityPools: CFG.CITY_RAIN_POOLS !== false,
        snowCover: CFG.WEATHER_SNOW_COVER !== false,
        coat: CFG.WEATHER_SURFACE_COAT !== false,
        hazard: CFG.WEATHER_FLOOD_HAZARD !== false,
      },
    };
  };
})();
