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
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const sun = CBZ.sun, hemi = CBZ.hemi, scene = CBZ.scene, dome = CBZ.skyDome;

  const CYCLE = 150;        // seconds for a full day
  let t = 0.18;             // start mid-morning

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

  CBZ.onAlways(2, function (dt) {
    t = (t + dt / CYCLE) % 1;

    // sun arcs across the sky; height drives "how day" it is
    const ang = t * Math.PI * 2;
    CBZ.sunAngle = ang; // core/sky.js places the sun/moon discs from this
    sun.position.set(Math.cos(ang) * 80, Math.sin(ang) * 95, -10);
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
