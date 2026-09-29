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
  };
  CBZ.lightKeys = KEY;

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

  /* ---------------- THE DAY, KEYED ON WHERE THE SUN ACTUALLY IS --------
     daylight() used to blend three keyframes on `dayness` = max(0, sin(sun)),
     which is GEOMETRY, not light, and it had three real faults:
       · the key never left the sun. At night the "sun" kept 0.20 of intensity
         from UNDER the ground (daynight.js put it at sin(ang) * 95 < 0), so in
         the prison it lit only the undersides of things and no moon ever lit
         the yard;
       · there was no twilight. The instant the sun touched the horizon the
         whole rig was on its midnight keyframe: no afterglow, no blue hour;
       · colour temperature was one dusk orange smeared across |sin| < 0.33.
     Now every term is read off the sun's SIGNED height `up` (CBZ.sunHeight):
       · the SUN is the key while it is up. Its light dies over the last two
         degrees (extinction through the long air path) and its colour runs a
         temperature curve: ~1900 K red-orange on the horizon, ~3300 K gold at
         10 degrees, ~5500 K white by 35 degrees;
       · then a TWILIGHT with no key at all: shadowless sky light only, the
         ambient going mauve, then deep blue (the blue hour, sun 4..8 degrees
         down), then night;
       · then the MOON takes the key, from the opposite point of the sky
         (exactly where core/sky.js draws its disc), its strength set by the
         PHASE: an 8-day lunation off CBZ.dayTime, so some nights are moonlit
         and some are genuinely black, which is what a torch is for.
     KEY above stays as the published noon/night reference (nukefx reads it). */
  const SKYKEYS = [
    //  up      hemi   sky       ground
    [-0.40,   0.34, 0x2c3c62, 0x161c2c],   // night (the old KEY.night)
    [-0.17,   0.35, 0x2e4172, 0x171d2d],   // nautical twilight: the dome still faintly blue
    [-0.08,   0.40, 0x4862a4, 0x1c2337],   // THE BLUE HOUR
    [ 0.00,   0.47, 0xc49aa4, 0x4b4044],   // sunset: mauve-peach dome, the burn at the horizon
    [ 0.10,   0.52, 0xffc9a0, 0x6d5a4c],   // golden hour (the old KEY.dusk sky)
    [ 0.30,   0.60, 0xe8eeff, 0x86836c],
    [ 0.60,   0.68, 0xdcecff, 0x8b8a72],
    [ 1.00,   0.72, 0xdcecff, 0x8b8a72],   // noon (the old KEY.day, unchanged)
  ];
  const SUNKEYS = [
    //  up      key    colour (blackbody through the air path)
    [-0.035,  0.00, 0xff4a14],
    [ 0.00,   0.14, 0xff5e1f],   // ~1900 K, the disc on the horizon
    [ 0.06,   0.36, 0xff8a3a],   // ~2500 K (the old dusk key colour)
    [ 0.17,   0.58, 0xffbd78],   // ~3300 K golden hour
    [ 0.35,   0.82, 0xffe4bf],   // ~4600 K
    [ 0.60,   1.04, 0xfff4e0],   // ~5500 K
    [ 1.00,   1.18, 0xfff4e0],   // noon (the old KEY.day, unchanged)
  ];
  const MOON = { color: 0x7d93c8, key: 0.20, from: 0.04, full: 0.30 };
  const LUNATION = 8;           // in-game days, new moon -> new moon
  const TWILIGHT_KEY = -0.035;  // below this the sun no longer lights anything

  function smooth(e0, e1, x) {
    const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  }
  // piecewise-linear lookup in one of the tables above (value + optional colour)
  function keyAt(table, up, col, outC) {
    const n = table.length;
    if (!(up > table[0][0])) { if (outC) outC.setHex(table[0][col]); return table[0][1]; }
    if (up >= table[n - 1][0]) { if (outC) outC.setHex(table[n - 1][col]); return table[n - 1][1]; }
    for (let i = 1; i < n; i++) {
      const b = table[i];
      if (up > b[0]) continue;
      const a = table[i - 1], k = (up - a[0]) / (b[0] - a[0]);
      if (outC) { outC.setHex(a[col]); _c2.setHex(b[col]); outC.lerp(_c2, k); }
      return a[1] + (b[1] - a[1]) * k;
    }
    return table[n - 1][1];
  }
  /* The moon's lit fraction, 0 (new) .. 1 (full). Offset so the first night of
     a fresh session is a bright moon, and the black nights come a few days in,
     once you have had the chance to find a torch. */
  function moonIllum() {
    const d = CBZ.dayTime ? +CBZ.dayTime() : 0;
    if (!Number.isFinite(d)) return 0.8;
    return 0.5 - 0.5 * Math.cos(((d + 2) / LUNATION) * Math.PI * 2);
  }
  function signedUp(dayness) {
    const u = Number(CBZ.sunHeight);
    if (Number.isFinite(u)) return u;
    return dayness > 0 ? dayness : -0.5;
  }
  // THE KEY IS THE MOON once the sun has stopped lighting anything
  function keyIsMoon(up) {
    if (up == null) up = signedUp(CBZ.dayness != null ? CBZ.dayness : 1);
    return up < TWILIGHT_KEY;
  }
  /* keyDir(angle, minUp, out) -> out = (cos, sin) of whichever body is the key
     (the sun, or the moon at the opposite point once twilight is over), its
     sin floored at `minUp` so the single ortho shadow map never renders a
     shadow a hundred metres long. Not normalised: each caller scales x/y into
     its own proportions. The disc core/sky.js draws stays at its true place;
     the floor only matters near the horizon, where the key is fading anyway. */
  function keyDir(ang, minUp, out) {
    const a = keyIsMoon(Math.sin(ang)) ? ang + Math.PI : ang;
    return out.set(Math.cos(a), Math.max(minUp, Math.sin(a)), 0);
  }

  /* daylight(dayness, duskness, sunColorOut)
     Writes sun colour/intensity, hemisphere intensity + sky/ground colours,
     and the bounce fill's colour/intensity for the current sun height.
     Returns the key's colour so the caller can publish it (core/sky.js reads
     CBZ.sunTint, not sun.color, because a mode override may have clobbered
     the light). `duskness` stays in the signature for old callers; the
     elevation tables above already carry the dusk. */
  let _illum = 1;
  function daylight(dayness, duskness, out) {
    const up = signedUp(dayness < 0 ? 0 : dayness > 1 ? 1 : dayness);
    _illum = moonIllum();
    CBZ.moonIllum = _illum;
    const sc = out || _c3;
    let si;
    if (!keyIsMoon(up)) {
      si = keyAt(SUNKEYS, up, 2, sc);
    } else {
      const mk = smooth(MOON.from, MOON.full, -up);
      sc.setHex(MOON.color);
      si = MOON.key * mk * (0.18 + 0.82 * _illum);
    }
    sun.color.copy(sc);
    sun.intensity = si;

    // THE SKY. A moonless sky is darker than a moonlit one, and so is the
    // light it throws: the night end of the table is scaled by the phase.
    let hi = keyAt(SKYKEYS, up, 2, CBZ.CONFIG.GFX_SKY_AMBIENT ? _c1 : null);
    const nightW = smooth(-0.10, -0.30, up);
    hi *= 1 - nightW * 0.38 * (1 - _illum);
    hemi.intensity = hi;
    if (CBZ.CONFIG.GFX_SKY_AMBIENT) {
      hemi.color.copy(_c1);
      keyAt(SKYKEYS, up, 3, hemi.groundColor);
    }

    // bounce: the ground throwing the key back up. Tinted by the hemisphere's
    // ground colour (which IS the local ground) warmed toward the key colour,
    // because bounced light carries the colour of what it bounced off.
    const bi = 0.34 * (si / 1.18);
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
    // GOLDEN HOUR used to be a city-only patch here; daylight() now runs the
    // real colour-temperature curve for every mode, so it is not repeated.
    if (CBZ.CONFIG.CITY_STREET_REALISM_V1 !== false) {
      // Preserve the noon keyframe exactly. As the sun falls, remove the flat
      // global fill that made midnight asphalt as legible as daytime; street
      // fixtures in props.js now carry that readability locally instead.
      const signedSun = Number(CBZ.sunHeight);
      const deep = Number.isFinite(signedSun)
        ? Math.max(0, Math.min(1, -signedSun))
        : (1 - k) * (1 - k);
      sun.intensity *= 1 - 0.78 * deep;
      hemi.intensity *= 1 - 0.60 * deep;   // moonlight: the street stays readable, lamps still own it
      bounce.intensity *= 1 - 0.76 * deep;
    }
    // THE SUN MOVES. This used to be a constant offset (70, 146, -50): the
    // city's key light hung at the same ~60 degree noon angle all day and all
    // night, so golden hour had short noon shadows and midnight was lit from
    // high overhead. Ride the real clock instead (CBZ.sunAngle, daynight.js):
    // east to west with a southern bias, low and raking at the ends of the
    // day, and after sunset the moon (the opposite point) takes the key.
    // Elevation is floored at ~15 degrees so a building's shadow stays inside
    // the tier's shadow box instead of streaking off to the horizon.
    const ang = Number.isFinite(CBZ.sunAngle) ? CBZ.sunAngle : 1.1;
    keyDir(ang, 0.27, _sunDir);                  // sun by day, the moon once twilight is over
    const sx = _sunDir.x, sy = _sunDir.y, sz = -0.42;
    const sl = 170 / Math.hypot(sx, sy, sz);
    aimSun(focus.x, 4, focus.z, sx * sl, sy * sl, sz * sl);
    setShadowFrustum(tier().shadowHalf || 190, (tier().shadowHalf || 190) * 2.6 + 40);
    aimBounce(focus.x, 6, focus.z);
  }

  CBZ.lightRig = {
    sun: sun, hemi: hemi, bounce: bounce, target: sunTarget,
    keys: KEY,
    daylight: daylight,
    keyIsMoon: keyIsMoon,
    keyDir: keyDir,
    moonIllum: function () { return _illum; },
    aimSun: aimSun,
    aimBounce: aimBounce,
    cityFrame: cityFrame,
    setShadowFrustum: setShadowFrustum,
    shadowHalf: function () { return _half; },
  };
})();
