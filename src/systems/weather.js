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
  const drv = { rain: 0, snow: 0, wind: 0, wx: 1, wz: 0, fog: 0, fogColor: -1, lightning: 0 };
  let drvHold = 0;              // seconds of assertion left
  let snowMix = 0;              // 0 = rain look, 1 = snow look (eased)

  CBZ.weatherDrive = function (spec, holdSecs) {
    if (CFG.WEATHER_DRIVE === false || !spec) return false;
    if (Number.isFinite(spec.rain)) drv.rain = Math.max(0, Math.min(1, +spec.rain));
    if (Number.isFinite(spec.snow)) drv.snow = Math.max(0, Math.min(1, +spec.snow));
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

    // animate the active flash (fast attack, quick decay)
    if (flashT > 0) {
      flashT -= dt;
      // flicker so it reads like a real bolt rather than a fade
      const flick = 0.6 + 0.4 * Math.abs(Math.sin(CBZ.now * 0.05));
      const bump = flash * flick * Math.max(0, flashT) * 6;
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

  // ---- main tick ------------------------------------------------------
  // order 90: late, so we darken fog AFTER daynight (order 2) sets it and
  // adjust hemi AFTER daynight has written its baseline this frame.
  CBZ.onAlways(90, function (dt) {
    if (!dt || dt <= 0) return;

    // DARK-PATH EARLY-OUT: with the ambient storm off and nothing driving,
    // the whole tick is skipped — the throttled indoor test used to scan
    // CBZ.platforms and raycast 5×/sec for a cloud that could never appear.
    if (!AUTO && drvHold <= 0 && intensity === 0 && drv.fog <= 0 &&
        drv.lightning <= 0 && flashT <= 0 && pendingThunder <= 0) return;

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
      flashT = 0; flash = 0; pendingThunder = 0; strikeCD = 4 + rng() * 4;
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
    };
  };
})();
