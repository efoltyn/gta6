/* ============================================================
   core/daynight.js — a slow day→dusk→night→dawn cycle. Drives the
   sun's angle/intensity/colour, the ambient hemisphere, fog colour,
   and cranks the tower searchlights up after dark (which is exactly
   when the stealth gets tense).
   Publishes the sky clock for core/sky.js: CBZ.sunAngle (where the
   sun/moon discs sit), CBZ.sunHeight (signed sin — sky.js blends its
   palette tables off it) and CBZ.sunTint (the blended sun colour —
   read here, not from CBZ.sun.color, because city/mode.js overwrites
   the light). The dome's COLOUR is no longer tinted here: sky.js
   paints real palette gradients (blue zenith over a burning horizon
   at dusk) straight into the dome canvas, and a whole-dome multiply
   was flattening that into one orange wash. The horizon seam is
   closed in sky.js at order 99, which repaints the dome's horizon
   stop to the FINAL scene.fog.color after every mode override.

   SHADOW RE-CENTERING (texel-snapped): the fixed ortho shadow frustum
   was parked at the world origin, so at city scale most of its shadow
   texels were spent on empty ground far from wherever the player
   actually is — the one place shadow resolution matters. Below we keep
   the day-night cycle's sun angle/colour/timing math untouched and
   ONLY translate the already-computed sun/target positions by the
   player's x/z, snapped to a whole shadow-texel so the translation
   itself can't sub-pixel-shimmer the shadow edges as the player moves
   (the standard CSM "texel snapping" trick, applied to a single map).
   city/mode.js (@94) and modes/survival.js (@93) run LATER in the frame
   and still win for their own arenas — this is just the shared default
   so any mode without its own override (or the player before a mode
   claims the light) also gets a player-following, swim-free shadow.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const sun = CBZ.sun, hemi = CBZ.hemi, scene = CBZ.scene, dome = CBZ.skyDome;

  const CYCLE = 150;        // seconds for a full day
                            // NOTE: city/schedule.js DAY_SECS mirrors this
                            // literal — change them together.
  let t = 0.18;             // start mid-morning
  // the sky clock, exposed for the multiplayer world save (net/netpersist.js):
  // no arg reads the phase 0..1; a number sets it (host restoring a saved day)
  CBZ.dayPhase = function (v) { if (v != null && isFinite(v)) t = (((+v) % 1) + 1) % 1; return t; };
  // the CALENDAR: which day it is. The sun cycle above wraps and forgets;
  // anything that must outlast a day (building rebuild timers, rent, …) counts
  // in dayCount units. Persisted next to dayPhase in the world save, and
  // fractional day-time reads as dayCount + dayPhase (dayTime below).
  let dayN = 0;
  CBZ.dayCount = function (v) { if (v != null && isFinite(v)) dayN = Math.max(0, Math.floor(+v)); return dayN; };
  CBZ.dayTime = function () { return dayN + t; };   // continuous days-elapsed clock

  // palette keyframes across the day (0..1): [fog, sunColor, sunInt, hemiInt].
  // dusk fog is a touch deeper than the old 0xff9e6b pastel — the haze near
  // the streets goes warm, while the actual horizon BURN lives in sky.js.
  const day   = { fog: 0xbfe0ff, sun: 0xfff4e0, si: 1.05, hi: 0.85 };
  const dusk  = { fog: 0xf09a68, sun: 0xff8a3a, si: 0.7,  hi: 0.6 };
  const night = { fog: 0x16243f, sun: 0x6f86c0, si: 0.18, hi: 0.4 };

  const _a = new THREE.Color(), _b = new THREE.Color();
  function mixHex(h1, h2, k, out) { _a.setHex(h1); _b.setHex(h2); return out.copy(_a).lerp(_b, k); }
  // reused scratch colours — this runs every frame, so don't allocate here
  const sunC = new THREE.Color(), fogC = new THREE.Color();

  // last texel-snapped recenter offset actually applied — compared each frame
  // so we only poke renderer.shadowMap.needsUpdate when the light truly moved
  // by a full texel (a sub-texel wobble is invisible; flagging it anyway would
  // just fight core/renderer.js's own tier-based update cadence for nothing).
  let _snapX = 0, _snapZ = 0, _snapWidth = 0;
  const sunTarget = CBZ.sunTarget;

  CBZ.onAlways(2, function (dt) {
    if (t + dt / CYCLE >= 1) dayN++;          // midnight wrap → next calendar day
    t = (t + dt / CYCLE) % 1;

    // sun arcs across the sky; height drives "how day" it is
    const ang = t * Math.PI * 2;
    CBZ.sunAngle = ang; // core/sky.js places the sun/moon discs from this
    sun.position.set(Math.cos(ang) * 80, Math.sin(ang) * 95, -10);
    if (sunTarget) sunTarget.position.set(0, 0, 18);

    // Re-center the frustum on the player (texel-snapped) instead of the
    // world origin — same relative sun offset/angle above, just translated.
    // Guarded: CBZ.player doesn't exist at boot/menu, and modes that run their
    // own override later this frame (city @94, survival @93) simply redo this
    // with their own focus point, so double-applying here is harmless.
    const P = CBZ.player && CBZ.player.pos;
    if (P && sunTarget) {
      const info = CBZ.shadowFrustumInfo ? CBZ.shadowFrustumInfo() : null;
      const texel = (info && info.texel > 0) ? info.texel : 0;
      let ox = P.x, oz = P.z;
      if (texel > 0) { ox = Math.floor(ox / texel) * texel; oz = Math.floor(oz / texel) * texel; }
      sun.position.x += ox; sun.position.z += oz;
      sunTarget.position.x += ox; sunTarget.position.z += oz;
      // Normal movement marks the map dirty and lets renderer.js coalesce it.
      // A teleport or a mode-owned shadow-frustum resize must bypass that cap:
      // otherwise the old shadow projection can remain visible for up to one
      // cadence interval after an abrupt scene change.
      const dx = Math.abs(ox - _snapX), dz = Math.abs(oz - _snapZ);
      const width = info && info.width > 0 ? info.width : 140;
      const widthChanged = _snapWidth > 0 && Math.abs(width - _snapWidth) > 0.001;
      const moved = dx >= (texel || 0.001) || dz >= (texel || 0.001);
      const jumped = Math.max(dx, dz) > Math.max(8, width * 0.1);
      if (CBZ.renderer && (moved || widthChanged)) {
        if (CBZ.requestShadowUpdate) CBZ.requestShadowUpdate(_snapWidth === 0 || widthChanged || jumped);
        else CBZ.renderer.shadowMap.needsUpdate = true;
      }
      _snapX = ox; _snapZ = oz; _snapWidth = width;
    }

    const up = Math.sin(ang);                 // -1 night .. 1 noon
    const dayness = Math.max(0, up);          // 0 at/under horizon
    const duskness = Math.max(0, 1 - Math.abs(up) * 3); // glow near horizon

    // blend night → day, then push toward dusk near the horizon
    let A = night, B = day, k = dayness;
    mixHex(A.sun, B.sun, k, sunC); mixHex(A.fog, B.fog, k, fogC);
    if (duskness > 0) {
      _b.setHex(dusk.sun); sunC.lerp(_b, duskness * 0.7);
      _b.setHex(dusk.fog); fogC.lerp(_b, duskness * 0.6);
    }

    sun.color.copy(sunC);
    // the sky's sun DISC reads this (CBZ.sun.color gets overwritten by the
    // city's constant-light override at @94, so it can't be the source)
    (CBZ.sunTint || (CBZ.sunTint = new THREE.Color())).copy(sunC);
    sun.intensity = night.si + (day.si - night.si) * dayness;
    hemi.intensity = night.hi + (day.hi - night.hi) * dayness;
    if (scene.fog) scene.fog.color.copy(fogC);
    // dome tint stays WHITE here: sky.js paints the real palette (deep-blue
    // zenith over the sunset burn) into the canvas, and a global multiply
    // would double-apply the mood and kill the blue zenith at dusk. We still
    // write it EVERY frame so survival's disaster tint (@93, runs after us)
    // can't go stale when you leave that mode — sky.js divides its horizon
    // stop by whatever tint survives the frame, so the fog seam stays closed.
    if (dome) dome.material.color.setRGB(1, 1, 1);

    // searchlights blaze after dark
    const nightAmt = 1 - dayness;
    CBZ.dayness = dayness;
    CBZ.duskness = duskness;
    CBZ.nightAmount = nightAmt;
    CBZ.sunHeight = up; // signed (-1 deep night .. 1 noon) — sky.js palettes
    for (const sl of CBZ.searchlights) {
      if (sl.spot) sl.spot.intensity = 0.4 + nightAmt * 1.8;
      if (sl.cone) sl.cone.material.opacity = 0.05 + nightAmt * 0.14;
      if (sl.pool) sl.pool.material.opacity = 0.12 + nightAmt * 0.22;
    }
  });
})();
