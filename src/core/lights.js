/* ============================================================
   core/lights.js — THE LIGHT RIG. One key, one sky/ground ambient,
   one bounce fill, and the single API every writer routes through.

   WHAT WAS WRONG: the whole game was lit by exactly two lights — a
   directional sun at 1.05 and a hemisphere at 0.85. Nothing bounced.
   A wall facing away from the sun received only the hemisphere's flat
   ground colour, so every shadow side of every building read as the
   same dead grey slab regardless of what it was standing next to, and
   interiors went to mud. Real daylight has three terms: the sun, the
   sky dome, and the LIGHT THE GROUND THROWS BACK UP. We now ship the
   third one — a cheap, shadow-less "bounce" directional aimed UP and
   roughly opposite the sun, tinted by the ground the player is standing
   on and scaled by how high the sun is. It costs nothing measurable
   (MeshLambertMaterial in r128 is Gouraud — extra directional lights are
   evaluated per VERTEX, not per pixel) and it is what makes the shadow
   side of a building read as "in shade" instead of "unlit".

   THE THREE-WRITER PROBLEM (and how it is resolved):
   core/daynight.js (@2), modes/survival.js (@93) and city/mode.js (@94)
   once wrote CBZ.sun.intensity / CBZ.hemi.intensity / sun.position
   directly, each clobbering the last, each with its own hard-coded literals.
   They now route through this shared owner:

     * CBZ.lightRig.daylight(dayness, duskness, sunColor) is now THE
       function that sets sun + hemi + bounce from the day clock. It is
       idempotent, it owns every literal, and it is what daynight.js
       calls. A mode that wants the same look with a different focus
       point calls it too — see CBZ.lightRig.cityFrame() below, which is
       the exact one-line replacement for city/mode.js's inline block.
     * core/gfx.js runs at order 94.5, AFTER every mode override, and calls
       cityFrame() again before applying the tone-map gain. The final city
       state therefore comes from the same owner as the earlier mode pass.

   SHADOWS: one 2048 PCFSoft ortho cascade, texel-snapped onto the
   player by daynight.js. The frustum HALF-SIZE is now owned here
   (CBZ.lightRig.setShadowFrustum) instead of being poked directly by
   each mode, so core/quality.js can hand it a per-tier value and every
   consumer of CBZ.shadowFrustumInfo() stays consistent.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const scene = CBZ.scene;
  CBZ.CONFIG = CBZ.CONFIG || {};

  // GFX_BOUNCE_LIGHT — the ground-bounce fill described above. Flip false
  // (or ?cfg_GFX_BOUNCE_LIGHT=0) to return to the exact two-light rig; the
  // light object still exists but is held at zero intensity so no shader
  // permutation churns when the flag or the quality tier moves.
  if (CBZ.CONFIG.GFX_BOUNCE_LIGHT == null) CBZ.CONFIG.GFX_BOUNCE_LIGHT = true;
  // GFX_SKY_AMBIENT — drive hemisphere sky/ground COLOURS from the day cycle
  // (instead of the fixed 0xeaf4ff / 0x6f7a55 pair). Off = old constant tint.
  if (CBZ.CONFIG.GFX_SKY_AMBIENT == null) CBZ.CONFIG.GFX_SKY_AMBIENT = true;
  // CITY_STREET_REALISM_V1 — one reversible vertical slice: cars sit on the
  // visible street surface, city night preserves real darkness, and the fixed
  // lamp pool supplies the localized light that replaces that ambient fill.
  // The query-string parser runs before this file, so ?cfg_...=0 retains the
  // former path for same-checkout A/B evidence.
  if (CBZ.CONFIG.CITY_STREET_REALISM_V1 == null) CBZ.CONFIG.CITY_STREET_REALISM_V1 = true;
  // NIGHT_TRUE_DARK — the night is actually dark, everywhere. The night
  // keyframe below (sun 0.20 / hemi 0.34) was tuned for a "blue night" look
  // that stays fully legible with no light source at all, which is a film
  // convention, not a fact: a real night with no fixture nearby is BLACK, and
  // it gets there ~1h20 after sunset (astronomical dusk, sun 18° under), not
  // at midnight. With this on, `nightDepth` (0 at sunset → 1 at -18°) fades
  // the whole rig to a faint moon key + a near-zero sky term, every mode,
  // through the one function they all already call, and gfx.js stops the
  // eye-adaptation lift that used to reopen the lens after dark. Lamps,
  // neon, torches, floods and headlights are what light the night now.
  // ?cfg_NIGHT_TRUE_DARK=0 is the byte-identical old night for A/B evidence
  // (tools/visual-presets/time-of-day-*.mjs photograph exactly that switch).
  if (CBZ.CONFIG.NIGHT_TRUE_DARK == null) CBZ.CONFIG.NIGHT_TRUE_DARK = true;

  /* ---------------- the rig ------------------------------------------- */

  // Sky/ground ambient. The colours below are the DAY keyframe; daynight.js
  // drives them across the cycle when GFX_SKY_AMBIENT is on.
  const hemi = new THREE.HemisphereLight(0xeaf4ff, 0x6f7a55, 0.85);
  scene.add(hemi);

  // key light — the sun. casts the shadows that sell the blocky look.
  const sun = new THREE.DirectionalLight(0xfff4e0, 1.05);
  sun.position.set(48, 90, -10);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048); // retuned live by core/quality.js
  const SC0 = 70;
  sun.shadow.camera.left = -SC0; sun.shadow.camera.right = SC0;
  sun.shadow.camera.top = SC0;  sun.shadow.camera.bottom = -SC0;
  sun.shadow.camera.near = 1;  sun.shadow.camera.far = 260;
  // A tighter frustum (core/quality.js now shrinks it per tier) buys real
  // shadow texels, and a tight frustum lets us trade depth bias for NORMAL
  // bias: offsetting the shadow lookup along the surface normal instead of
  // along depth kills acne without the peter-panning gap that a big depth
  // bias opens under every object's feet. That gap is exactly what made
  // contact shadows read as "floating decal" before.
  sun.shadow.bias = -0.00015;
  if ("normalBias" in sun.shadow) sun.shadow.normalBias = 0.022;
  scene.add(sun);

  const sunTarget = new THREE.Object3D();
  sunTarget.position.set(0, 0, 18);
  scene.add(sunTarget);
  sun.target = sunTarget;

  // GROUND BOUNCE. Aimed from below/behind relative to the sun so it fills
  // exactly the faces the sun cannot reach. Never casts (a shadow-casting
  // fill would double the single most expensive pass in the scene).
  const bounce = new THREE.DirectionalLight(0x8a7f68, 0.0);
  bounce.position.set(-30, -34, 22);
  bounce.castShadow = false;
  const bounceTarget = new THREE.Object3D();
  bounceTarget.position.set(0, 6, 0);
  scene.add(bounceTarget);
  bounce.target = bounceTarget;
  scene.add(bounce);

  CBZ.hemi = hemi;
  CBZ.sun = sun;
  CBZ.sunTarget = sunTarget;
  CBZ.bounce = bounce;
  CBZ.bounceTarget = bounceTarget;

  /* ---------------- authored day keyframes ----------------------------
     Every magic number the old three writers each carried their own copy
     of now lives here, once. `si`/`hi`/`bi` are LOGICAL intensities —
     core/gfx.js scales them for the installed tone map in finalize(). */
  const KEY = {
    day:   { sun: 0xfff4e0, si: 1.18, hi: 0.72, bi: 0.34, sky: 0xdcecff, gnd: 0x8b8a72 },
    dusk:  { sun: 0xff8a3a, si: 0.78, hi: 0.54, bi: 0.30, sky: 0xffcaa0, gnd: 0x6d5a4c },
    night: { sun: 0x6f86c0, si: 0.20, hi: 0.34, bi: 0.10, sky: 0x2c3c62, gnd: 0x161c2c },
    // TRUE DARK (NIGHT_TRUE_DARK): where the rig lands once the sun is 18°
    // under. These are the numbers that put a mid-albedo surface UNDER the
    // night sky's own brightness through the ACES curve at exposure ~0.85 —
    // a silhouette against the sky, nothing more — which is what a street
    // with no lamp looks like at 1 a.m. The moon key keeps a faint cool
    // direction so shapes still separate; the bounce is gone (nothing to bounce).
    dark:  { si: 0.016, hi: 0.014, bi: 0.0 },
  };
  CBZ.lightKeys = KEY;

  /* nightDepth(sunHeight) — 0 while the sun is on or above the horizon, 1
     once it is 18° under (sin = -0.31, astronomical night), smooth between.
     Civil dusk (-6°) lands near 0.15, nautical (-12°) near 0.5: the sky
     still lights the street for a while after sunset, then it does not.
     Published every frame as CBZ.nightDepth by daynight.js; this is the one
     definition, so a mode wanting "is it properly dark yet" reads that. */
  function nightDepth(up) {
    if (!CBZ.CONFIG.NIGHT_TRUE_DARK) return 0;
    const x = -(+up) / 0.31;
    const t = x < 0 ? 0 : x > 1 ? 1 : x;
    return t * t * (3 - 2 * t);
  }

  const _c1 = new THREE.Color(), _c2 = new THREE.Color(), _c3 = new THREE.Color();
  const _sunDir = new THREE.Vector3();

  // Tier knobs, published by core/quality.js through CBZ.gfxTier. Defaults are
  // the "everything on" values so the rig is correct before quality.js parses.
  function tier() { return CBZ.gfxTier || { bounce: 1, shadowHalf: 0, lightGain: 1 }; }

  /* setShadowFrustum(half, far) — the ONLY sanctioned way to resize the ortho
     shadow box. Idempotent (a no-op when nothing changed), updates the
     projection matrix, and forces a shadow refresh so the old projection can
     never linger for a cadence interval after a mode switch. */
  let _half = SC0, _far = 260;
  function setShadowFrustum(half, far) {
    half = Math.max(12, +half || _half);
    far = Math.max(half * 2 + 20, +far || _far);
    if (half === _half && far === _far) return false;
    _half = half; _far = far;
    const cam = sun.shadow.camera;
    cam.left = -half; cam.right = half; cam.top = half; cam.bottom = -half;
    cam.far = far;
    if (cam.updateProjectionMatrix) cam.updateProjectionMatrix();
    if (CBZ.requestShadowUpdate) CBZ.requestShadowUpdate(true);
    else if (CBZ.renderer) CBZ.renderer.shadowMap.needsUpdate = true;
    return true;
  }

  /* daylight(dayness, duskness, sunColorOut)
     Blends night→day→dusk across the authored keyframes above and writes
     sun colour/intensity, hemisphere intensity + sky/ground colours, and the
     bounce fill's colour/intensity. Returns the blended sun colour so the
     caller can publish it (core/sky.js reads CBZ.sunTint, not sun.color,
     because a mode override may have clobbered the light).                */
  function daylight(dayness, duskness, out) {
    const k = dayness < 0 ? 0 : dayness > 1 ? 1 : dayness;
    const d = duskness < 0 ? 0 : duskness > 1 ? 1 : duskness;
    const N = KEY.night, D = KEY.day, K = KEY.dusk;

    // sun colour
    _c1.setHex(N.sun); _c2.setHex(D.sun);
    const sc = out || _c3;
    sc.copy(_c1).lerp(_c2, k);
    if (d > 0) { _c1.setHex(K.sun); sc.lerp(_c1, d * 0.7); }
    sun.color.copy(sc);

    // logical intensities (gfx.finalize() applies the tone-map gain)
    let si = N.si + (D.si - N.si) * k;
    if (d > 0) si += (K.si - si) * (d * 0.45);   // the low sun is dimmer AND warmer
    sun.intensity = si;
    let hi = N.hi + (D.hi - N.hi) * k;
    if (d > 0) hi += (K.hi - hi) * (d * 0.4);
    hemi.intensity = hi;

    // sky/ground ambient colour across the cycle — this is the cheap
    // "sky-tinted GI" term: at dusk the up-facing ambient goes peach and the
    // down-facing goes warm brown, so every roof and every kerb shifts with
    // the sky instead of staying the same two constants all day.
    if (CBZ.CONFIG.GFX_SKY_AMBIENT) {
      _c1.setHex(N.sky); _c2.setHex(D.sky);
      hemi.color.copy(_c1).lerp(_c2, k);
      if (d > 0) { _c1.setHex(K.sky); hemi.color.lerp(_c1, d * 0.6); }
      _c1.setHex(N.gnd); _c2.setHex(D.gnd);
      hemi.groundColor.copy(_c1).lerp(_c2, k);
      if (d > 0) { _c1.setHex(K.gnd); hemi.groundColor.lerp(_c1, d * 0.55); }
    }

    // bounce: the ground throwing the sun back up. Tinted by the hemisphere's
    // ground colour (which IS the local ground) warmed toward the sun colour,
    // because bounced light carries the colour of what it bounced off.
    let bi = N.bi + (D.bi - N.bi) * k;

    // TRUE DARK: past astronomical dusk the sky stops lighting the ground.
    // Applied here, inside the one function every writer routes through, so
    // the city, the prison yard, the gun-game arena and a bare terrain all
    // reach the same black through the same curve. The hemisphere colours
    // are left where the night keyframe put them — at 0.014 they only decide
    // the hue of what little there is.
    const depth = nightDepth(CBZ.sunHeight != null ? CBZ.sunHeight : 0);
    if (depth > 0) {
      const DK = KEY.dark;
      si += (DK.si - si) * depth;
      hi += (DK.hi - hi) * depth;
      bi += (DK.bi - bi) * depth;
      sun.intensity = si;
      hemi.intensity = hi;
    }
    bounce.color.copy(hemi.groundColor).lerp(sc, 0.45);
    bounce.intensity = CBZ.CONFIG.GFX_BOUNCE_LIGHT ? bi * (tier().bounce != null ? tier().bounce : 1) : 0;
    return sc;
  }

  /* aimBounce() — park the bounce light under/behind the sun, pointing back
     up at the geometry. Called from finalize() with the FINAL sun position so
     it tracks whichever writer won this frame. */
  function aimBounce(focusX, focusY, focusZ) {
    if (!CBZ.CONFIG.GFX_BOUNCE_LIGHT) return;
    _sunDir.copy(sun.position).sub(sunTarget.position);
    const len = _sunDir.length() || 1;
    _sunDir.multiplyScalar(1 / len);
    // mirror the sun through the ground plane and swing it round: light
    // arriving from below and roughly opposite the key.
    bounceTarget.position.set(focusX, focusY, focusZ);
    bounce.position.set(
      focusX - _sunDir.x * 60,
      focusY - Math.abs(_sunDir.y) * 45 - 6,
      focusZ - _sunDir.z * 60
    );
  }

  /* aimSun(fx, fy, fz, ox, oy, oz) — put the key light at focus+offset and
     point it at the focus. Used by the mode overrides. */
  function aimSun(fx, fy, fz, ox, oy, oz) {
    sun.position.set(fx + ox, fy + oy, fz + oz);
    sunTarget.position.set(fx, fy, fz);
  }

  /* cityFrame(focus) — the ENTIRE per-frame city light override in one call:
     re-aim the sun onto the player, ride the shared day keyframes, apply the
     city-only night grade, and use the tier-owned shadow frustum.            */
  function cityFrame(focus) {
    if (!focus) return;
    const k = CBZ.dayness != null ? CBZ.dayness : 1;
    const d = CBZ.duskness || 0;
    daylight(k, d, CBZ.sunTint || (CBZ.sunTint = new THREE.Color()));
    if (CBZ.CONFIG.CITY_STREET_REALISM_V1 !== false && !CBZ.CONFIG.NIGHT_TRUE_DARK) {
      // The city-only night grade from before NIGHT_TRUE_DARK. The shared
      // curve in daylight() now takes every mode further than this did, so
      // this branch only survives for the ?cfg_NIGHT_TRUE_DARK=0 baseline.
      // Preserve the noon keyframe exactly. As the sun falls, remove the flat
      // global fill that made midnight asphalt as legible as daytime; street
      // fixtures in props.js now carry that readability locally instead.
      const signedSun = Number(CBZ.sunHeight);
      const deep = Number.isFinite(signedSun)
        ? Math.max(0, Math.min(1, -signedSun))
        : (1 - k) * (1 - k);
      sun.intensity *= 1 - 0.78 * deep;
      hemi.intensity *= 1 - 0.72 * deep;
      bounce.intensity *= 1 - 0.76 * deep;
    }
    aimSun(focus.x, 4, focus.z, 70, 146, -50);
    setShadowFrustum(tier().shadowHalf || 190, (tier().shadowHalf || 190) * 2.6 + 40);
    aimBounce(focus.x, 6, focus.z);
  }

  CBZ.lightRig = {
    sun: sun, hemi: hemi, bounce: bounce, target: sunTarget,
    keys: KEY,
    daylight: daylight,
    nightDepth: nightDepth,
    aimSun: aimSun,
    aimBounce: aimBounce,
    cityFrame: cityFrame,
    setShadowFrustum: setShadowFrustum,
    shadowHalf: function () { return _half; },
  };
})();
