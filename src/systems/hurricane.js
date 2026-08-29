/* ============================================================
   systems/hurricane.js — CBZ.hurricane, THE CYCLONE FIELD.

   A hurricane at ground level has NO SILHOUETTE. You don't see it, you feel
   it — a wind room. The first cyclone build got the field right and then
   spoiled it by drawing the eyewall as two 96-110 m textured cylinder
   shells: photographed from inside the eye they read as a curtain-wall
   OFFICE TOWER (vertical mullion columns, hard panels, a stadium rim seen
   from below). That mesh is gone. Nothing in this file draws the storm as
   an object any more.

   THE MODEL — a translating cyclone. One storm CENTER tracks in a straight
   seeded line across the island, and every local condition is a function of
   your distance r from that center:

     wind   v(r): smoothstep up the wall inside the radius of maximum wind
            (RMW), vmax·(RMW/r)^0.55 outside it, near-calm inside the eye —
            times a shared GUST envelope (below), so the whole room breathes.
            Direction is tangential + a 25° inward spiral + half the storm's
            forward motion, so the right-of-track side genuinely blows harder.
     rain   follows local wind, PULSED into spiral bands outside ~2·RMW.
     sky    the def reads localWeather()/state() and, inside the eye, opens
            the sun and stands the murk at the EYEWALL DISTANCE with fog —
            the wall is the distance the rain lets you see, not a mesh. The
            clearing IS the trap: calm, bright, and then the wind comes back
            from the other side.

   Because the center MOVES, the arc falls out of one field with no phase
   scripting: front wall, sudden calm, back wall from the OPPOSITE bearing —
   reversal is a geometric fact of standing on the other side of the vortex.

   THE GUST ENVELOPE: S.gustK multiplies the whole field. The def fires
   gustBurst() on its seeded cadence; the envelope attacks fast and decays
   over ~a second, so drag, debris, rain-lean, camera shake and the audit's
   peak numbers all spike TOGETHER — a gust is an event your body notices,
   not a constant.

   MAGNITUDE — SAFFIR-SIMPSON, rolled per occurrence (no flag; git is the
   undo). The def rolls catF ∈ [1,5] off the seeded hazard stream, biased
   (not replaced) by the round's escalating intensity, and everything is a
   function of it:
     vmax      = 20 + 11·catF   → cat-1 ~31 m/s (lean and walk),
                                  cat-5 ~75 m/s (you cannot stand)
     gust peak ≈ vmax × (1.25 + 0.3·catF/5 + jitter) → cat-5 gusts past 100
     rmw       = 32 + 5.5·catF  (bigger storms are bigger)
     eye       tightens with category, and BELOW CAT 3 THERE IS NO TRUE EYE:
               calmK floors the eye wind at up to ~35% of vmax, so a weak
               storm passes over you as a ragged lull, not a revelation
     surgeMax  = 0.6 + 0.75·catF (cat-1 wets the ramps, cat-5 drowns streets)
     duration  the def's activeSecs = 19 + 3.2·catF (a big storm LASTS)
     scour     the def's structural rate scales with catF (cat-5 takes roofs)

   WHAT THIS FILE OWNS: the field math, the track, the surge curve, the gust
   envelope, the wind-advected debris (TWO Points streams — fine spray/grit
   driving low and fast, and heavier ragged material higher up, per-particle
   tinted so it never reads as a repeated sprite; both seeded UPWIND of the
   camera so material is thrown PAST you, never born in a ring around you),
   and the audit. WHAT IT DOES NOT OWN: damage. Deaths, knockdowns,
   structural scouring and flooding stay in the def, priced through the
   shared helpers and drawn from the seeded hazard stream.

   Ratchet: CBZ.hurricaneAudit().
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;

  // ---- storm state (one storm at a time; the director runs one disaster) --
  let S = null;          // live storm or null
  let lastCat = 0, lastVmax = 0;   // survive end() so the tail beat still reports
  const counts = { debrisStrikes: 0, debrisKills: 0, knockdowns: 0, drownings: 0, gusts: 0, carsFlung: 0 };
  // reversal evidence: wind bearing at the island center, sampled once on each
  // side of the eye's passage. dot < 0 is the back wall blowing the other way.
  const evid = { frontX: 0, frontZ: 0, backX: 0, backZ: 0, haveFront: false, haveBack: false,
    camPeak: 0, camCalmMin: 1e9, camInEye: false, eyePassedCam: false, surgePeak: 0 };

  function resetEvidence() {
    counts.debrisStrikes = counts.debrisKills = counts.knockdowns = counts.drownings = counts.gusts = counts.carsFlung = 0;
    evid.haveFront = evid.haveBack = false; evid.frontX = evid.frontZ = evid.backX = evid.backZ = 0;
    evid.camPeak = 0; evid.camCalmMin = 1e9; evid.camInEye = false; evid.eyePassedCam = false; evid.surgePeak = 0;
  }

  /* ---- the field ---------------------------------------------------------
     windAt(x,z) is THE storm. Everything else — what you feel, what the
     debris rides, which way the rain leans, who gets knocked flat — reads it.
     Pure function of position + storm state, ~25 flops, no allocation. */
  const _w = { x: 1, z: 0, speed: 0 };
  function windAt(x, z) {
    if (!S) { _w.x = 1; _w.z = 0; _w.speed = 0; return _w; }
    const dx = x - S.x, dz = z - S.z;
    const r = Math.hypot(dx, dz) || 0.001;
    let m;
    if (r >= S.rmw) m = S.vmax * Math.pow(S.rmw / r, 0.55);
    else if (r <= S.eyeCalmR) m = S.vmax * S.calmK;
    else {
      const u = (r - S.eyeCalmR) / (S.rmw - S.eyeCalmR);
      m = S.vmax * (S.calmK + (1 - S.calmK) * u * u * (3 - 2 * u));  // smoothstep up the wall
    }
    m *= S.gustK;                              // the room breathes as one
    // tangential circulation + inward spiral outside the wall
    const tx = -dz / r, tz = dx / r;
    const inFrac = r > S.rmw ? 0.42 : 0.42 * Math.max(0, (r - S.eyeCalmR) / (S.rmw - S.eyeCalmR)) * 0.4;
    let vx = tx - dx / r * inFrac, vz = tz - dz / r * inFrac;
    const vm = Math.hypot(vx, vz) || 1;
    vx = vx / vm * m; vz = vz / vm * m;
    // the storm's own translation, felt where the storm's winds are felt:
    // the right-of-track side is genuinely stronger
    const carry = 0.5 * Math.min(1, m / S.vmax);
    vx += S.fwdX * S.fwdV * carry; vz += S.fwdZ * S.fwdV * carry;
    _w.speed = Math.hypot(vx, vz);
    _w.x = _w.speed > 0.001 ? vx / _w.speed : 1;
    _w.z = _w.speed > 0.001 ? vz / _w.speed : 0;
    return _w;
  }

  /* localWeather(x,z): what the sky is DOING where you are standing. The def
     feeds the camera's answer to CBZ.weatherDrive every frame, so walking
     into the eye stops the rain because the rain has stopped THERE. */
  const _lw = { rain: 0, wind: 0, windDir: { x: 1, z: 0 }, fog: 0, fogColor: 0x46505a };
  function localWeather(x, z) {
    const w = windAt(x, z);
    if (!S) { _lw.rain = 0; _lw.wind = 0; _lw.fog = 0; return _lw; }
    const r = Math.hypot(x - S.x, z - S.z);
    const k = Math.min(1, w.speed / S.vmax);
    let rain = Math.min(1, k * 1.25);
    if (r > S.rmw * 1.9) {
      // SPIRAL BANDS: squalls with slots between them, tightening as the wall
      // nears. Phase advances with time so the bands sweep over you.
      const band = 0.5 + 0.5 * Math.sin(r * 0.11 - S.t * 1.1);
      rain *= 0.35 + 0.65 * band;
    }
    // in the eye the rain dies to the eye's QUALITY: a cat-3+ eye goes dry,
    // a ragged low-category lull only eases
    if (r < S.eyeR) {
      const u = Math.max(0, (r - S.eyeCalmR) / Math.max(1, S.eyeR - S.eyeCalmR));
      rain *= S.calmK * 1.6 + u * 0.4;
    }
    _lw.rain = Math.min(1, rain);
    _lw.wind = w.speed;
    _lw.windDir.x = w.x; _lw.windDir.z = w.z;
    _lw.fog = r < S.eyeR ? 0.04 + S.calmK * 0.5 : Math.min(0.75, 0.18 + 0.55 * k);
    _lw.fogColor = 0x46505a;
    return _lw;
  }

  /* ---- wind-advected debris ---------------------------------------------
     TWO Points streams riding windAt() at their own position — in the walls
     they stream flat and fast, around the eye they corkscrew, in the calm
     they SETTLE:
       · grit — fine spray and grit driving horizontally past the lens, low
         and quick, the thing your face notices;
       · rag  — heavier ragged material (shingle, frond, sheet) higher up,
         fewer and bigger, per-particle tinted so no two read as the same
         sprite.
     Seeding is UPWIND-BIASED: a particle is born far upwind of the camera
     and thrown PAST it — not spawned in a ring around it. Runtime FX →
     Math.random by design (nothing here moves a body or a rule). */
  // soft radial sprite so a debris point reads as spray/matter, never as the
  // hard white SQUARE a bare gl point draws
  let dotTex = null;
  function softDot() {
    if (dotTex) return dotTex;
    const c = document.createElement("canvas");
    c.width = c.height = 32;
    const g = c.getContext("2d");
    const grad = g.createRadialGradient(16, 16, 2, 16, 16, 15);
    grad.addColorStop(0, "rgba(255,255,255,0.95)");
    grad.addColorStop(0.55, "rgba(255,255,255,0.5)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad; g.fillRect(0, 0, 32, 32);
    dotTex = new THREE.CanvasTexture(c);
    return dotTex;
  }
  function buildCloud(n, size, opacity, baseColor, tintSpread, hLo, hHi) {
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const h0 = new Float32Array(n);     // preferred ride height
    const ph = new Float32Array(n);     // bob phase
    const age = new Float32Array(n);
    const cr = (baseColor >> 16 & 255) / 255, cg = (baseColor >> 8 & 255) / 255, cb = (baseColor & 255) / 255;
    for (let i = 0; i < n; i++) {
      const t = (Math.random() * 2 - 1) * tintSpread;
      col[i * 3] = Math.min(1, Math.max(0, cr + t));
      col[i * 3 + 1] = Math.min(1, Math.max(0, cg + t * 0.9));
      col[i * 3 + 2] = Math.min(1, Math.max(0, cb + t * 0.75));
    }
    const geo = new THREE.BufferGeometry();
    const attr = new THREE.BufferAttribute(pos, 3);
    if (attr.setUsage) attr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("position", attr);
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    const mat = new THREE.PointsMaterial({
      vertexColors: true, size, transparent: true, opacity,
      map: softDot(), depthWrite: false, fog: true,
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false; pts.renderOrder = 6;
    CBZ.scene.add(pts);
    const d = { pts, geo, attr, mat, pos, h0, ph, age, n, hLo, hHi };
    for (let i = 0; i < n; i++) seedDebris(d, i, 0, 0, true);
    return d;
  }
  function seedDebris(d, i, cx, cz, anywhere) {
    const o = i * 3;
    let x, z;
    if (anywhere) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * 80;
      x = cx + Math.cos(a) * r; z = cz + Math.sin(a) * r;
    } else {
      // born UPWIND of the camera, in a wide cone, so the wind carries it
      // THROUGH the frame; in near-calm fall back to a loose scatter
      const w = windAt(cx, cz);
      const base = w.speed > 3 ? Math.atan2(-w.z, -w.x) : Math.random() * Math.PI * 2;
      const a = base + (Math.random() * 2 - 1) * (w.speed > 3 ? 1.15 : Math.PI);
      const r = 35 + Math.random() * 80;
      x = cx + Math.cos(a) * r; z = cz + Math.sin(a) * r;
    }
    d.pos[o] = x; d.pos[o + 2] = z;
    d.h0[i] = d.hLo + Math.random() * (d.hHi - d.hLo);
    d.ph[i] = Math.random() * 6.28;
    d.age[i] = 2.5 + Math.random() * 4;
    d.pos[o + 1] = (CBZ.floorAt ? CBZ.floorAt(x, z) : 0) + d.h0[i];
  }
  function tickCloud(d, dt, camX, camZ) {
    const floorAt = CBZ.floorAt || function () { return 0; };
    for (let i = 0; i < d.n; i++) {
      const o = i * 3;
      d.age[i] -= dt;
      const w = windAt(d.pos[o], d.pos[o + 2]);
      const ride = Math.min(1, w.speed / 14);
      d.pos[o] += w.x * w.speed * dt * (0.8 + 0.25 * Math.sin(d.ph[i]));
      d.pos[o + 2] += w.z * w.speed * dt * (0.8 + 0.25 * Math.cos(d.ph[i]));
      // ride height follows the wind: strong wind lofts, calm settles it out
      const g = floorAt(d.pos[o], d.pos[o + 2]);
      const want = g + 0.15 + d.h0[i] * ride;
      d.pos[o + 1] += (want + Math.sin(CBZ.now * 0.006 + d.ph[i]) * 0.6 * ride - d.pos[o + 1]) * Math.min(1, dt * 3);
      const dx = d.pos[o] - camX, dz = d.pos[o + 2] - camZ;
      if (d.age[i] <= 0 || dx * dx + dz * dz > 140 * 140) seedDebris(d, i, camX, camZ, false);
    }
    d.attr.needsUpdate = true;
  }
  function disposeCloud(d) {
    if (!d) return;
    CBZ.scene.remove(d.pts);
    d.geo.dispose(); d.mat.dispose();
  }

  // ---- lifecycle ---------------------------------------------------------
  CBZ.hurricane = {
    /* begin({cx, cz, R, catF, duration, bearing, offset})
       catF/bearing/offset come from the def's SEEDED stream — the category
       and the track are rules (they decide who floods, who stands in the
       wall, and whether the roofs survive), not effects. */
    begin(o) {
      this.end();
      resetEvidence();
      const R = o.R || 120;
      const catF = Math.max(1, Math.min(5, o.catF != null ? o.catF : 3));
      const rmw = 32 + 5.5 * catF;                    // radius of maximum wind
      const eyeR = rmw * (0.66 - 0.03 * catF);        // intense storms: tight eye
      const fwdX = Math.cos(o.bearing || 0), fwdZ = Math.sin(o.bearing || 0);
      const span = R * 1.45 + rmw;                    // start/end distance along track
      const off = o.offset || 0;                      // perpendicular track offset
      S = {
        cx: o.cx || 0, cz: o.cz || 0, R,
        catF, rmw, eyeR, eyeCalmR: eyeR * 0.6,
        // BELOW CAT 3 THERE IS NO TRUE EYE: the "calm" floors at up to ~35%
        // of vmax and the rain never fully stops — a ragged lull, not a trap
        calmK: catF >= 3 ? 0.03 : 0.03 + (3 - catF) * 0.16,
        vmax: 20 + 11 * catF,
        fwdX, fwdZ, fwdV: (span * 2) / Math.max(8, o.duration || 30),
        s: -span, span, off, t: 0,
        gustK: 1, gustGoal: 1,
        surge: 0, surgeMax: 0.6 + 0.75 * catF,
        x: 0, z: 0,
      };
      lastCat = catF; lastVmax = S.vmax;
      placeCenter();
      S.grit = buildCloud(520, 0.22, 0.5, 0xaeb8c0, 0.10, 0.3, 2.2);
      S.rag = buildCloud(190, 0.62, 0.85, 0x8a7a60, 0.16, 0.6, 7.0);
    },
    end() {
      if (!S) return;
      disposeCloud(S.grit);
      disposeCloud(S.rag);
      S = null;
    },
    active() { return !!S; },
    tick(dt, camX, camZ) {
      if (!S) return;
      S.t += dt;
      S.s = Math.min(S.span * 1.05, S.s + S.fwdV * dt);
      placeCenter();
      // the gust envelope: fast attack toward the goal, then the goal itself
      // sags back to 1 — a gust is an impulse, not a new constant
      S.gustK += (S.gustGoal - S.gustK) * Math.min(1, dt * 7);
      S.gustGoal += (1 - S.gustGoal) * Math.min(1, dt * 1.1);
      // surge: a gaussian of track progress peaking just past the island
      // center, rate-limited so the sea CLIMBS (≤ 1.1 m/s) and drains slower
      const p = S.s / (S.R + S.rmw);
      const want = S.surgeMax * Math.exp(-((p - 0.12) * (p - 0.12)) / (2 * 0.34 * 0.34));
      const rate = want > S.surge ? 1.1 : 0.55;
      S.surge += Math.max(-rate * dt, Math.min(rate * dt, want - S.surge));
      if (S.surge > evid.surgePeak) evid.surgePeak = S.surge;
      // debris rides the live field
      tickCloud(S.grit, dt, camX != null ? camX : S.cx, camZ != null ? camZ : S.cz);
      tickCloud(S.rag, dt, camX != null ? camX : S.cx, camZ != null ? camZ : S.cz);
      // ---- evidence for the audit ----
      const wc = windAt(S.cx, S.cz);
      if (!evid.haveFront && S.s > -S.rmw * 1.05 && S.s < -S.eyeR) {
        evid.frontX = wc.x; evid.frontZ = wc.z; evid.haveFront = true;
      }
      if (!evid.haveBack && S.s > S.rmw * 0.6) {
        evid.backX = wc.x; evid.backZ = wc.z; evid.haveBack = true;
      }
      if (camX != null) {
        const w = windAt(camX, camZ);
        if (w.speed > evid.camPeak) evid.camPeak = w.speed;
        const rc = Math.hypot(camX - S.x, camZ - S.z);
        const inEye = rc < S.eyeR;
        if (inEye) {
          if (w.speed < evid.camCalmMin) evid.camCalmMin = w.speed;
          // the eye "passed over" the camera if calm arrived AFTER real wind
          if (evid.camPeak > S.vmax * 0.5) evid.eyePassedCam = true;
        }
        evid.camInEye = inEye;
      }
    },
    /* the def fires this on its seeded gust cadence: everything reading the
       field — drag, debris, rain lean, camera shake, the audit's peaks —
       spikes together and then lets go. power ≈ 0.25-0.6 → gusts peak at
       ~1.25-1.6× the sustained wind, category-scaled by the caller. */
    gustBurst(power) {
      if (!S) return;
      S.gustGoal = Math.max(S.gustGoal, 1 + Math.max(0, power || 0.3));
    },
    windAt,
    localWeather,
    state() {
      if (!S) return null;
      return {
        eyeX: S.x, eyeZ: S.z, eyeR: S.eyeR, rmw: S.rmw, vmax: S.vmax,
        catF: S.catF, calmK: S.calmK, gustK: S.gustK,
        fwdX: S.fwdX, fwdZ: S.fwdZ, fwdV: S.fwdV, s: S.s, span: S.span,
        surge: S.surge, surgeMax: S.surgeMax,
        phase: phase(),
      };
    },
    /* threat is HONEST, which is the trap: the eye reports near-calm, the
       crowd stops running and drifts back into the open, and the back wall
       arrives from the other direction. Exactly what kills people in the
       real event, emergent from the bots believing the same sky you do. */
    threat(x, z) {
      if (!S) return 0;
      const w = windAt(x, z);
      const r = Math.hypot(x - S.x, z - S.z);
      if (r < S.eyeCalmR) return 0.08 + S.calmK;
      return Math.max(0.15, Math.min(1, w.speed / (S.vmax * 0.75)));
    },
    // crosswind escape: perpendicular to the TRACK, away from the track line —
    // the real "navigable semicircle" advice, and the only direction that
    // gets you out of the eyewall's path rather than chased along it.
    safeDir(x, z) {
      if (!S) return null;
      // signed side of the track line (through the island center along fwd);
      // -off recenters the line on the storm's actual path
      const side = (x - S.cx) * -S.fwdZ + (z - S.cz) * S.fwdX - S.off;
      const sgn = side >= 0 ? 1 : -1;
      return { x: -S.fwdZ * sgn, z: S.fwdX * sgn };
    },
    count(k, n) { if (counts[k] != null) counts[k] += (n == null ? 1 : n); },
  };

  function placeCenter() {
    // center = island center + s·forward + off·perpendicular
    S.x = S.cx + S.fwdX * S.s + -S.fwdZ * S.off;
    S.z = S.cz + S.fwdZ * S.s + S.fwdX * S.off;
  }
  function phase() {
    if (!S) return "none";
    const dEye = Math.hypot(S.cx - S.x, S.cz - S.z);
    if (dEye < S.eyeR) return "eye";
    if (S.s < -S.R * 0.75) return "approach";
    if (S.s < 0) return "front-wall";
    if (S.s < S.R * 0.85) return "back-wall";
    return "tail";
  }

  /* ---- the ratchet -------------------------------------------------------
     Live-state answers, not claims: windReversed is two sampled bearings
     dotted, eyePassedCam only fires if the camera saw real wind BEFORE the
     calm, surgePeak is the biggest number the def actually fed the sea.
     category/vmax survive end() so the tail beat still reports the storm
     that just left. */
  CBZ.hurricaneAudit = function () {
    const dot = evid.haveFront && evid.haveBack
      ? evid.frontX * evid.backX + evid.frontZ * evid.backZ : 1;
    return {
      on: true,
      live: !!S,
      phase: phase(),
      category: S ? +S.catF.toFixed(2) : lastCat ? +lastCat.toFixed(2) : 0,
      eyeX: S ? +S.x.toFixed(1) : 0, eyeZ: S ? +S.z.toFixed(1) : 0,
      eyeR: S ? +S.eyeR.toFixed(1) : 0, rmw: S ? +S.rmw.toFixed(1) : 0,
      vmax: S ? +S.vmax.toFixed(1) : lastVmax ? +lastVmax.toFixed(1) : 0,
      gustK: S ? +S.gustK.toFixed(2) : 1,
      windAtCam: 0,                                  // def-side callers sample live
      camPeakWind: +evid.camPeak.toFixed(1),
      eyeCalmMin: evid.camCalmMin < 1e8 ? +evid.camCalmMin.toFixed(2) : -1,
      eyePassedCam: evid.eyePassedCam ? 1 : 0,
      camInEye: evid.camInEye ? 1 : 0,
      windReversed: (evid.haveFront && evid.haveBack && dot < -0.2) ? 1 : 0,
      reversalDot: +dot.toFixed(3),
      surgeNow: S ? +S.surge.toFixed(2) : 0,
      surgePeak: +evid.surgePeak.toFixed(2),
      debrisStrikes: counts.debrisStrikes,
      debrisKills: counts.debrisKills,
      knockdowns: counts.knockdowns,
      drownings: counts.drownings,
      gusts: counts.gusts,
      carsFlung: counts.carsFlung,
      wallLive: false,          // the mesh eyewall is gone; kept for old probes
    };
  };
})();
