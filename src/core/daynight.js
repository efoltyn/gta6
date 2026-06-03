/* ============================================================
   core/daynight.js — a slow day→dusk→night→dawn cycle. Drives the
   sun's angle/intensity/colour, the ambient hemisphere, fog colour,
   a tint on the sky dome, and cranks the tower searchlights up after
   dark (which is exactly when the stealth gets tense).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const sun = CBZ.sun, hemi = CBZ.hemi, scene = CBZ.scene, dome = CBZ.skyDome;

  const CYCLE = 150;        // seconds for a full day
  let t = 0.18;             // start mid-morning

  // palette keyframes across the day (0..1): [skyTint, fog, sunColor, sunInt, hemiInt]
  const day   = { sky: 0xffffff, fog: 0xbfe0ff, sun: 0xfff4e0, si: 1.05, hi: 0.85 };
  const dusk  = { sky: 0xff9e6b, fog: 0xff9e6b, sun: 0xff8a3a, si: 0.7,  hi: 0.6 };
  const night = { sky: 0x223a66, fog: 0x16243f, sun: 0x6f86c0, si: 0.18, hi: 0.4 };

  const _a = new THREE.Color(), _b = new THREE.Color();
  function mixHex(h1, h2, k, out) { _a.setHex(h1); _b.setHex(h2); return out.copy(_a).lerp(_b, k); }
  // reused scratch colours — this runs every frame, so don't allocate here
  const sunC = new THREE.Color(), fogC = new THREE.Color(), skyC = new THREE.Color();

  CBZ.onAlways(2, function (dt) {
    t = (t + dt / CYCLE) % 1;

    // sun arcs across the sky; height drives "how day" it is
    const ang = t * Math.PI * 2;
    sun.position.set(Math.cos(ang) * 80, Math.sin(ang) * 95, -10);
    const up = Math.sin(ang);                 // -1 night .. 1 noon
    const dayness = Math.max(0, up);          // 0 at/under horizon
    const duskness = Math.max(0, 1 - Math.abs(up) * 3); // glow near horizon

    // blend night → day, then push toward dusk near the horizon
    let A = night, B = day, k = dayness;
    mixHex(A.sun, B.sun, k, sunC); mixHex(A.fog, B.fog, k, fogC); mixHex(A.sky, B.sky, k, skyC);
    if (duskness > 0) {
      _b.setHex(dusk.sun); sunC.lerp(_b, duskness * 0.7);
      _b.setHex(dusk.fog); fogC.lerp(_b, duskness * 0.6);
      _b.setHex(dusk.sky); skyC.lerp(_b, duskness * 0.6);
    }

    sun.color.copy(sunC);
    sun.intensity = night.si + (day.si - night.si) * dayness;
    hemi.intensity = night.hi + (day.hi - night.hi) * dayness;
    if (scene.fog) scene.fog.color.copy(fogC);
    if (dome) dome.material.color.copy(skyC);

    // searchlights blaze after dark
    const nightAmt = 1 - dayness;
    CBZ.dayness = dayness;
    CBZ.duskness = duskness;
    CBZ.nightAmount = nightAmt;
    for (const sl of CBZ.searchlights) {
      if (sl.spot) sl.spot.intensity = 0.4 + nightAmt * 1.8;
      if (sl.cone) sl.cone.material.opacity = 0.05 + nightAmt * 0.14;
      if (sl.pool) sl.pool.material.opacity = 0.12 + nightAmt * 0.22;
    }
  });
})();
