/* ============================================================
   src/world/waterfx.js — reflective ocean (THREE.WaterReflect).

   Ports the Slayvin flat-mirror Water addon (src/vendor/WaterReflect.js) onto
   the game's ONE ocean surface — CBZ.citySea, the animated shader plane built
   at the end of city/world.js's buildCity(). A planar-reflection render target
   mirrors the live scene each (half) frame; the water shader distorts that
   reflection with a scrolling procedural normal map and adds a Fresnel mix of
   sky reflection + sun specular. This is the real reflective water the DEAD
   WATER ocean package builds on.

   FLAG: CBZ.CONFIG.WATER_REFLECT (default ON; declared in src/config.js). When
   OFF, this file never creates a reflector and never touches CBZ.citySea, so
   city/world.js's flat animated sea renders EXACTLY as before — one-line
   revert. The flag is also honoured live (flip it at runtime and the water
   swaps on the next frame).

   PERF:
     - 256x256 reflection target (the whole scene re-renders into it).
     - HALF-RATE mirror: onBeforeRender is wrapped to run the (expensive)
       mirror pass only every other frame and reuse the cached target on the
       skipped frame — imperceptible on moving water, ~halves the extra cost.
     - QUALITY GATED: below the Balanced tier (core/quality.js) the reflector
       is hidden and the original flat sea returns; a live tier change flips
       between them via CBZ.onQualityChange.

   The reflector inherits the city root's visibility, so it only renders in
   city mode. The addon hides itself during the mirror pass (no recursion), and
   the HUD is DOM (never in the THREE scene), so neither leaks into reflections.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const THREE = window.THREE;
  if (!THREE || !THREE.WaterReflect) return;

  const CFG = (CBZ.CONFIG = CBZ.CONFIG || {});
  if (CFG.WATER_REFLECT == null) CFG.WATER_REFLECT = true; // defensive default;
  // src/config.js owns the authoritative declaration.

  // Below this quality tier the planar reflection (an extra full scene render)
  // is dropped and the flat sea renders instead. core/quality.js tiers: 0
  // emergency, 1 fast, 2 balanced, 3 high, 4 best.
  const REFLECT_MIN_TIER = 2;

  let reflect = null;   // the THREE.WaterReflect mesh
  let flatSea = null;   // the original city/world.js animated shader sea
  let waterTime = 0;    // runtime-FX clock (per-frame accumulate; not sim time)
  const _sunDir = new THREE.Vector3(0.34, 0.84, 0.42).normalize();

  function qualityOk() {
    const q = CBZ.qualityLevel;
    return q == null || q >= REFLECT_MIN_TIER;
  }

  // Positive signal that `m` is world.js's flat shader sea (and not our own
  // reflector, which carries no uSeaTime uniform).
  function isFlatSea(m) {
    return !!(m && m.material && m.material.uniforms && m.material.uniforms.uSeaTime);
  }

  function teardown() {
    if (!reflect) return;
    if (reflect.parent) reflect.parent.remove(reflect);
    try { if (reflect.renderTarget) reflect.renderTarget.dispose(); } catch (e) {}
    try { if (reflect.material) reflect.material.dispose(); } catch (e) {}
    try { if (reflect.geometry) reflect.geometry.dispose(); } catch (e) {}
    reflect = null;
  }

  function build(flat) {
    const parent = flat.parent;
    if (!parent) return;
    teardown(); // clear any stale reflector (e.g. a rebuilt city root)

    const b = CBZ.SEA_WORLD_BOUNDS;
    const y = CBZ.SEA_Y != null ? CBZ.SEA_Y : -0.48;
    const spanX = b ? (b.maxX - b.minX) : 16000;
    const spanZ = b ? (b.maxZ - b.minZ) : 16000;
    const cx = b ? (b.minX + b.maxX) / 2 : 310;
    const cz = b ? (b.minZ + b.maxZ) / 2 : -750;

    // XY plane rotated flat so its local +Z normal maps to world +Y — the
    // orientation WaterReflect's mirror math assumes (verts local, mesh
    // transform places them; matrixWorld carries the plane normal).
    const geo = new THREE.PlaneGeometry(spanX, spanZ);
    const water = new THREE.WaterReflect(geo, {
      textureWidth: 256,
      textureHeight: 256,
      alpha: 1.0,
      waterColor: 0x0d3b58,      // matches world.js's day sea; re-tinted per frame
      sunColor: 0xfff4e0,
      sunDirection: _sunDir.clone(),
      distortionScale: 4.0,      // gentle: this is a 16km ocean, not a pond
      size: 6.0,                 // ripple frequency of the tiling normal map
      fog: !!(CBZ.scene && CBZ.scene.fog) // melt the horizon into the day/night fog
    });
    water.rotation.x = -Math.PI / 2;
    water.position.set(cx, y, cz);
    water.name = "world-sea-reflect";
    water.frustumCulled = false;              // the horizon is everywhere
    water.receiveShadow = false;
    water.castShadow = false;
    // batch (core/batch.js) + farcull exempt via non-empty userData; also the
    // flags the world-surface audits key on so it reads as the one ocean.
    water.userData.terrain = true;
    water.userData.waterSurface = true;
    water.userData.surfaceOwner = "world-water";
    water.userData.unifiedSurface = true;
    water.userData.waterMode = "reflect-mirror";

    // HALF-RATE mirror: skip the whole-scene mirror render every other frame
    // and reuse the cached target. Wrapping (not editing the addon) keeps the
    // vendor port faithful.
    const mirror = water.onBeforeRender;
    let parity = 0;
    water.onBeforeRender = function (renderer, scene, camera) {
      parity ^= 1;
      if (parity === 0) return;               // reuse last mirror frame
      mirror.call(this, renderer, scene, camera);
    };

    parent.add(water);
    reflect = water;
    flatSea = flat;
    applyMode();
  }

  // Show exactly ONE ocean: the reflector when enabled + quality allows, else
  // the original flat sea. CBZ.citySea always points at whichever is visible
  // (city/playeraircraft.js's airspace clamp and the world-surface audits read
  // it), so the map still sees a single ~16km water surface.
  function applyMode() {
    if (!reflect || !flatSea) return;
    const on = CFG.WATER_REFLECT !== false && qualityOk();
    reflect.visible = on;
    flatSea.visible = !on;
    CBZ.citySea = on ? reflect : flatSea;
  }

  // Lazily wrap the sea once world.js has built it (buildCity runs during the
  // first city entry and caches, so this fires once), then drive the runtime
  // FX uniforms every frame. onUpdate runs only while playing — exactly when
  // the ocean is on screen — in the LATE band, before the frame renders.
  CBZ.onUpdate(CBZ.PRIO ? CBZ.PRIO.LATE : 90, function (dt) {
    const sea = CBZ.citySea;
    // Build only when enabled; if the flag is off we never create a reflector,
    // so the flat sea renders untouched (one-line revert). Rebuild if a prior
    // reflector was orphaned by a city-root rebuild.
    if (CFG.WATER_REFLECT !== false && isFlatSea(sea) && (!reflect || !reflect.parent)) {
      build(sea);
    }
    if (!reflect) return;

    applyMode(); // honours the flag + live quality tier every frame
    if (!reflect.visible) return;

    waterTime += (dt || 0);
    const U = reflect.material.uniforms;
    U.time.value = waterTime;

    // Sun direction TO the sun + its blended tint, from core/daynight.js, so
    // dawn/dusk sunlight rides on the water. The light travels sun -> target;
    // the direction to the sun is target -> sun.
    if (CBZ.sun && CBZ.sunTarget) {
      _sunDir.copy(CBZ.sun.position).sub(CBZ.sunTarget.position);
      if (_sunDir.lengthSq() > 1e-6) { _sunDir.normalize(); U.sunDirection.value.copy(_sunDir); }
    }
    if (CBZ.sunTint) U.sunColor.value.copy(CBZ.sunTint);

    // Deep-water scatter tint follows world.js's own per-frame day/night sea
    // colour (it keeps updating flatSea's material colour even while hidden),
    // so the reflector shifts tone with the cycle for free.
    if (flatSea.material && flatSea.material.color) U.waterColor.value.copy(flatSea.material.color);
  });

  // A live quality-tier change (settings panel / adaptive governor) flips
  // between the reflector and the flat sea.
  if (CBZ.onQualityChange) CBZ.onQualityChange(function () { applyMode(); });
})();
