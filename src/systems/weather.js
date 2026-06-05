/* ============================================================
   systems/weather.js — Dynamic weather.

   Rain that comes and goes: a target intensity drifts over minutes
   so storms build, peak, and fade rather than snapping on/off. The
   rain itself is ONE pooled THREE.Points cloud (capped at ~400 drops,
   one shared geometry, one shared material) that rides along with the
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
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  // Never throw at load: bail unless the engine + THREE + scene/camera exist.
  if (!CBZ || !window.THREE || !CBZ.scene || !CBZ.camera) return;
  const THREE = window.THREE;

  const scene = CBZ.scene;
  const cam = CBZ.camera;

  // ---- tunables -------------------------------------------------------
  const MAX = 400;            // hard cap on drops (phones!)
  const RADIUS = 16;          // horizontal spread around the camera
  const TOP = 16;             // spawn height above camera
  const BOTTOM = -1.5;        // recycle a touch below ground for a clean exit
  const FALL_MIN = 22, FALL_MAX = 34; // units/sec downward
  const rng = (CBZ.econ && CBZ.econ.rng) ? CBZ.econ.rng : Math.random;

  // ---- intensity state machine ---------------------------------------
  // intensity 0..1 eases toward `target`; target re-rolls every few mins.
  let intensity = 0;
  let target = 0;
  let phaseT = 6 + rng() * 8;   // seconds until first weather decision
  let wind = 0;                 // current sideways drift (units/sec)
  let windTarget = 0;
  let windAxis = 0;             // 0 = drift on X, 1 = drift on Z (varies)

  function rollWeather() {
    // ~45% of the time it's dry-ish; otherwise a drizzle→downpour.
    const r = rng();
    if (r < 0.45) target = 0.0 + rng() * 0.08;          // basically clear
    else if (r < 0.78) target = 0.25 + rng() * 0.3;      // light/moderate rain
    else target = 0.7 + rng() * 0.3;                     // heavy storm
    // weather lasts on the order of minutes
    phaseT = 70 + rng() * 110;
    // new wind direction & strength each phase
    windTarget = (rng() * 2 - 1) * (4 + target * 7);
    windAxis = rng() < 0.5 ? 0 : 1;
  }

  // ---- pooled rain cloud ----------------------------------------------
  // single geometry; positions are the only thing we touch per frame.
  const positions = new Float32Array(MAX * 3);
  const velY = new Float32Array(MAX);   // per-drop fall speed (variety)
  // base ring near the camera; absolute positions are kept in `positions`
  // (we add the cloud to the SCENE, not the camera, and move points in
  //  world space so wind drift reads correctly).
  for (let i = 0; i < MAX; i++) {
    seedDrop(i, cam.position.x, cam.position.z, true);
  }

  function seedDrop(i, cx, cz, anywhere) {
    const a = rng() * Math.PI * 2;
    const r = Math.sqrt(rng()) * RADIUS; // uniform-ish disc
    const o = i * 3;
    positions[o]     = cx + Math.cos(a) * r;
    // if seeding fresh, scatter through the whole column; if recycling,
    // caller resets y separately. A touch of jitter on recycle keeps the
    // re-spawned drops from forming a flat sheet at exactly TOP.
    positions[o + 1] = anywhere ? (rng() * (TOP + 4)) : (TOP + rng() * 4);
    positions[o + 2] = cz + Math.sin(a) * r;
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
    // Only meaningful in the open-city mode (the only place with building
    // interiors/roofs); elsewhere there's no roof to be under, so weather is
    // always "outdoors" and behaves exactly as before.
    const g = CBZ.game;
    if (!g || g.mode !== "city") return false;
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
      if (_upRay.intersectObjects(blk, false).length) return true;
    }
    return false;
  }

  // ---- fog tinting ----------------------------------------------------
  // daynight.js rewrites scene.fog.color every frame, so we don't fight it
  // by storing a base — instead we darken whatever colour it currently is,
  // proportional to rain intensity, AFTER daynight has run (high order).
  const _fogTmp = new THREE.Color();
  const FOG_DARK = 0x2a3340; // cool storm-grey we lerp toward

  // ---- lightning ------------------------------------------------------
  const hemi = CBZ.hemi || null;
  let baseHemi = hemi ? hemi.intensity : 0.4;
  let flash = 0;            // current extra hemi intensity from lightning
  let flashT = 0;          // remaining flash time
  let strikeCD = 5;        // cooldown before next possible strike
  let pendingThunder = 0;  // seconds until thunder follows the flash (delay)

  function tryLightning(dt) {
    if (!hemi) return;
    // remember the (daynight-driven) baseline so we add on top of it.
    if (flashT <= 0) baseHemi = hemi.intensity;

    strikeCD -= dt;
    const night = !!(CBZ.sun && CBZ.sun.position.y < 0);
    // strikes need: night + meaningful rain + cooldown elapsed
    if (night && intensity > 0.45 && strikeCD <= 0) {
      // chance scales with how hard it's pouring
      const p = (intensity - 0.45) * 0.9 * dt; // per-frame probability
      if (rng() < p) {
        flash = 0.9 + rng() * 1.3;            // brightness of the bolt
        flashT = 0.10 + rng() * 0.10;         // very brief
        strikeCD = 2.5 + rng() * 6;           // space strikes out
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
      hemi.intensity = baseHemi + flash * flick * Math.max(0, flashT) * 6;
    }

    // delayed recorded thunder after the visible flash
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

    // ---- evolve the storm over minutes ----
    phaseT -= dt;
    if (phaseT <= 0) rollWeather();
    // ease intensity & wind toward their targets (slow, weather-like)
    intensity += (target - intensity) * Math.min(1, dt * 0.12);
    wind += (windTarget - wind) * Math.min(1, dt * 0.25);
    if (intensity < 0.002) intensity = 0;

    // ---- indoor check (throttled ~5x/sec, never per-drop) ----
    indoorCD -= dt;
    if (indoorCD <= 0) {
      indoors = testIndoors();
      indoorCD = 0.2;
    }

    // ---- how many drops are live this frame ----
    const live = Math.round(intensity * MAX);
    // suppress the cloud entirely while under a roof — re-shows the instant the
    // next throttled test clears `indoors` after stepping back outside.
    rain.visible = live > 0 && !indoors;
    mat.opacity = Math.min(0.55, 0.18 + intensity * 0.5);

    if (live > 0 && !indoors) {
      const cx = cam.position.x, cz = cam.position.z;
      const driftX = windAxis === 0 ? wind : wind * 0.35;
      const driftZ = windAxis === 1 ? wind : wind * 0.35;
      const r2 = (RADIUS + 3) * (RADIUS + 3); // recycle if it drifts too far

      for (let i = 0; i < live; i++) {
        const o = i * 3;
        // fall + wind drift
        positions[o + 1] -= velY[i] * dt;
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
    if (scene.fog && scene.fog.color && intensity > 0) {
      _fogTmp.setHex(FOG_DARK);
      // lerp the live fog colour toward storm-grey, scaled by intensity.
      scene.fog.color.lerp(_fogTmp, Math.min(0.55, intensity * 0.6));
    }

    // ---- lightning (night only) ----
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
    get wind() { return wind; }
  };
})();
