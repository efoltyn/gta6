/* ============================================================
   systems/hurricane.js — CBZ.hurricane, THE CYCLONE FIELD.

   WHAT WAS THERE BEFORE (systems/disasters.js `hurricane` def): one wind
   number for the whole island, slowly veering, with a swirl particle cloud
   glued to the camera and a gust timer. That is a WINDSTORM. A hurricane is
   the only disaster in the roster that lasts long enough to have STRUCTURE —
   outer bands, an eyewall, an EYE, and then the far eyewall with the wind
   reversed — and the water, not the wind, is what does most of the killing.

   THE MODEL — a translating cyclone. One storm CENTER tracks in a straight
   seeded line across the island, and every local condition is a function of
   your distance r from that center:

     wind   v(r) = vmax·(r'/1)³ smooth ramp inside the radius of maximum
            wind (RMW), vmax·(RMW/r)^0.55 outside it (real hurricanes decay
            far more slowly than a tornado's free vortex), and near-CALM
            inside the eye. Direction is tangential (one fixed circulation
            sense) plus a 25° inward spiral outside the RMW, plus half the
            storm's own forward motion — so the side the storm is moving
            toward genuinely blows harder.
     rain   follows local wind, PULSED into spiral bands outside ~2·RMW so
            the approach arrives as squalls with clear slots between them —
            the real outer-band signature — and dies to nothing in the eye.
     sky    the def reads localWeather()/state() and opens the fog + sun
            when the camera is inside the eye. The clearing IS the trap.

   Because the center MOVES, the storm's whole arc falls out of one field
   with no phase scripting: the front eyewall hits, the eye passes over with
   its sudden calm, and the back wall arrives from the OPPOSITE direction —
   reversal is a geometric fact of standing on the other side of the vortex,
   not a state machine.

   THE SURGE is one number on state(): a gaussian of the track progress that
   peaks just after the eye crosses the island center (2.5-4 m by intensity),
   rate-limited so the sea climbs rather than teleports. The def feeds it to
   CBZ.waterSurgeSet — the ONE water lever — so the swimmer, the drowning,
   the floating cars and the corpses all come along for free.

   WHAT THIS FILE OWNS: the field math, the track, the surge curve, the
   eyewall cloud (two counter-rotating open cylinder shells on a canvas
   gradient, following the eye), the wind-advected debris streamers (one
   THREE.Points whose particles ride windAt() — they corkscrew around the
   eye, stream flat in the walls and SETTLE in the calm, which no camera-
   centred swirl cloud can do), and the audit. WHAT IT DOES NOT OWN: damage.
   Deaths, knockdowns, structural scouring and flooding stay in the def,
   priced through the shared helpers (CBZ.body, surv.hurt, the structural
   ledger, floodActors) and drawn from the seeded hazard stream.

   FLAG: HURRICANE_V2 (declared here, default on). Off = the def plays the
   old windstorm verbatim; this file goes inert. Ratchet: CBZ.hurricaneAudit().
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;

  if (CBZ.CONFIG.HURRICANE_V2 == null) CBZ.CONFIG.HURRICANE_V2 = true;

  // ---- storm state (one storm at a time; the director runs one disaster) --
  let S = null;          // live storm or null
  const counts = { debrisStrikes: 0, debrisKills: 0, knockdowns: 0, drownings: 0, gusts: 0 };
  // reversal evidence: wind bearing at the island center, sampled once on each
  // side of the eye's passage. dot < 0 is the back wall blowing the other way.
  const evid = { frontX: 0, frontZ: 0, backX: 0, backZ: 0, haveFront: false, haveBack: false,
    camPeak: 0, camCalmMin: 1e9, camInEye: false, eyePassedCam: false, surgePeak: 0 };

  function resetEvidence() {
    counts.debrisStrikes = counts.debrisKills = counts.knockdowns = counts.drownings = counts.gusts = 0;
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
    else if (r <= S.eyeCalmR) m = S.vmax * 0.03;
    else {
      const u = (r - S.eyeCalmR) / (S.rmw - S.eyeCalmR);
      m = S.vmax * (0.03 + 0.97 * u * u * (3 - 2 * u));    // smoothstep up the wall
    }
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
    if (r < S.eyeR) rain *= Math.max(0, (r - S.eyeCalmR) / Math.max(1, S.eyeR - S.eyeCalmR)) * 0.4;
    _lw.rain = rain;
    _lw.wind = w.speed;
    _lw.windDir.x = w.x; _lw.windDir.z = w.z;
    _lw.fog = r < S.eyeR ? 0.04 : Math.min(0.75, 0.18 + 0.55 * k);
    _lw.fogColor = 0x46505a;
    return _lw;
  }

  // ---- the eyewall cloud -------------------------------------------------
  // Two counter-rotating open cylinder shells on a shared vertical-gradient
  // canvas texture. From outside it is the dark wall the fog was hinting at;
  // from inside the eye it is the thing the sudden blue sky is surrounded by.
  function wallTexture() {
    /* A wall of convective cloud, not a fog gradient: dark ragged COLUMNS of
       differing depth (towering cumulonimbus read as vertical structure),
       lighter shear streaks dragged horizontally across them (the rotation),
       dense to ~60% height then fraying out to nothing at the top. */
    const c = document.createElement("canvas");
    c.width = 512; c.height = 160;
    const g = c.getContext("2d");
    g.clearRect(0, 0, 512, 160);
    // convective TOWERS, not drizzle: wide columns (several metres each on the
    // cylinder) of varying darkness and height, so the wall reads as cloud
    // with structure rather than as a curtain of rain streaks
    let x = 0;
    while (x < 512) {
      const w = 14 + Math.random() * 22;
      const h = 160 * (0.72 + Math.random() * 0.28);
      const v = 22 + (Math.random() * 22) | 0;
      const grad = g.createLinearGradient(0, 160, 0, 160 - h);
      grad.addColorStop(0, `rgba(${v},${v + 6},${v + 14},1)`);
      grad.addColorStop(0.62, `rgba(${v + 8},${v + 14},${v + 22},0.97)`);
      grad.addColorStop(0.86, `rgba(${v + 18},${v + 26},${v + 36},0.85)`);
      // a sunlit rim right below the fray — the inside of a real eyewall is
      // dark cloud with a bright top edge where the eye's light catches it
      grad.addColorStop(0.95, `rgba(${v + 90},${v + 98},${v + 108},0.55)`);
      grad.addColorStop(1, "rgba(150,160,172,0)");
      g.fillStyle = grad;
      g.fillRect(x, 160 - h, w, h);
      x += w;
    }
    // cauliflower lumps along the tower tops + mid-wall billows
    for (let i = 0; i < 140; i++) {
      const bx = Math.random() * 512;
      const by = 160 - (0.45 + Math.random() * 0.5) * 160;
      const br = 6 + Math.random() * 16;
      const v = 26 + (Math.random() * 26) | 0;
      g.fillStyle = `rgba(${v},${v + 7},${v + 16},${0.3 + Math.random() * 0.3})`;
      g.beginPath(); g.arc(bx, by, br, 0, 6.29); g.fill();
    }
    // shear streaks: the rotation, dragged across the towers
    g.globalCompositeOperation = "lighter";
    for (let i = 0; i < 40; i++) {
      const y = 160 - Math.random() * 120;
      const w = 40 + Math.random() * 110;
      g.fillStyle = `rgba(92,104,120,${0.06 + Math.random() * 0.09})`;
      g.fillRect(Math.random() * 512, y, w, 3 + Math.random() * 4);
    }
    g.globalCompositeOperation = "source-over";
    const t = new THREE.CanvasTexture(c);
    t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping;
    t.repeat.set(3, 1);
    return t;
  }
  function buildWall(rmw) {
    const grp = new THREE.Group();
    const tex = wallTexture();
    const mk = (r, h, op, useFog) => {
      const geo = new THREE.CylinderGeometry(r * 1.22, r, h, 40, 1, true);
      const mat = new THREE.MeshBasicMaterial({
        map: tex, transparent: true, opacity: op, depthWrite: false,
        // the INNER face is what the eye's clear air shows you — scene fog
        // would wash it back into the haze it is supposed to stand out of
        side: THREE.DoubleSide, fog: !!useFog,
      });
      const m = new THREE.Mesh(geo, mat);
      m.position.y = h * 0.5 - 2;
      m.renderOrder = 5;
      grp.add(m);
      return m;
    };
    grp._inner = mk(rmw * 1.0, 96, 1.0, false);
    grp._outer = mk(rmw * 1.5, 110, 0.55, true);
    grp._tex = tex;
    CBZ.scene.add(grp);
    return grp;
  }
  function disposeWall(grp) {
    if (!grp) return;
    CBZ.scene.remove(grp);
    grp.traverse(function (o) {
      if (o.geometry) o.geometry.dispose();
      if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); }
    });
  }

  // ---- wind-advected debris ---------------------------------------------
  // ONE Points cloud whose particles ride windAt() at their own position.
  // In the walls they stream flat and fast; around the eye they visibly
  // corkscrew; in the calm they SETTLE. Runtime FX → Math.random by design
  // (see disasters.js's seeding note: nothing here moves a body or a rule).
  const N_DEBRIS = 460;
  function buildDebris() {
    const pos = new Float32Array(N_DEBRIS * 3);
    const h0 = new Float32Array(N_DEBRIS);   // preferred ride height
    const ph = new Float32Array(N_DEBRIS);   // bob phase
    const age = new Float32Array(N_DEBRIS);
    const geo = new THREE.BufferGeometry();
    const attr = new THREE.BufferAttribute(pos, 3);
    if (attr.setUsage) attr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("position", attr);
    const mat = new THREE.PointsMaterial({
      color: 0x8a7a60, size: 0.34, transparent: true, opacity: 0.75,
      depthWrite: false, fog: true,
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false; pts.renderOrder = 6;
    CBZ.scene.add(pts);
    const d = { pts, geo, attr, mat, pos, h0, ph, age };
    for (let i = 0; i < N_DEBRIS; i++) seedDebris(d, i, 0, 0, true);
    return d;
  }
  function seedDebris(d, i, cx, cz, anywhere) {
    const a = Math.random() * Math.PI * 2;
    const r = anywhere ? Math.sqrt(Math.random()) * 80 : 30 + Math.random() * 55;
    const o = i * 3;
    d.pos[o] = cx + Math.cos(a) * r;
    d.pos[o + 2] = cz + Math.sin(a) * r;
    d.h0[i] = 0.7 + Math.random() * 6.5;
    d.ph[i] = Math.random() * 6.28;
    d.age[i] = 2.5 + Math.random() * 4;
    d.pos[o + 1] = (CBZ.floorAt ? CBZ.floorAt(d.pos[o], d.pos[o + 2]) : 0) + d.h0[i];
  }
  function tickDebris(d, dt, camX, camZ) {
    const floorAt = CBZ.floorAt || function () { return 0; };
    for (let i = 0; i < N_DEBRIS; i++) {
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
      if (d.age[i] <= 0 || dx * dx + dz * dz > 130 * 130) seedDebris(d, i, camX, camZ, false);
    }
    d.attr.needsUpdate = true;
  }
  function disposeDebris(d) {
    if (!d) return;
    CBZ.scene.remove(d.pts);
    d.geo.dispose(); d.mat.dispose();
  }

  // ---- lifecycle ---------------------------------------------------------
  CBZ.hurricane = {
    /* begin({cx, cz, R, intensity, duration, bearing, offset})
       bearing/offset come from the def's SEEDED stream — the track is a rule
       (it decides who floods and who stands in the wall), not an effect. */
    begin(o) {
      this.end();
      resetEvidence();
      const R = o.R || 120;
      const inten = Math.min(1.2, o.intensity != null ? o.intensity : 0.4);
      const rmw = 40 + 8 * inten;                     // radius of maximum wind
      const fwdX = Math.cos(o.bearing || 0), fwdZ = Math.sin(o.bearing || 0);
      const span = R * 1.45 + rmw;                    // start/end distance along track
      const off = o.offset || 0;                      // perpendicular track offset
      S = {
        cx: o.cx || 0, cz: o.cz || 0, R,
        rmw, eyeR: rmw * 0.62, eyeCalmR: rmw * 0.4,
        vmax: 30 + 15 * inten,
        fwdX, fwdZ, fwdV: (span * 2) / Math.max(8, o.duration || 30),
        s: -span, span, off, t: 0, inten,
        surge: 0, surgeMax: 2.5 + 1.7 * inten,
        x: 0, z: 0,
      };
      placeCenter();
      S.wall = buildWall(rmw);
      S.debris = buildDebris();
      moveWall();
    },
    end() {
      if (!S) return;
      disposeWall(S.wall);
      disposeDebris(S.debris);
      S = null;
    },
    active() { return !!S; },
    tick(dt, camX, camZ) {
      if (!S) return;
      S.t += dt;
      S.s = Math.min(S.span * 1.05, S.s + S.fwdV * dt);
      placeCenter();
      moveWall(dt);
      // surge: a gaussian of track progress peaking just past the island
      // center, rate-limited so the sea CLIMBS (≤ 1.1 m/s) and drains slower
      const p = S.s / (S.R + S.rmw);
      const want = S.surgeMax * Math.exp(-((p - 0.12) * (p - 0.12)) / (2 * 0.34 * 0.34));
      const rate = want > S.surge ? 1.1 : 0.55;
      S.surge += Math.max(-rate * dt, Math.min(rate * dt, want - S.surge));
      if (S.surge > evid.surgePeak) evid.surgePeak = S.surge;
      // debris rides the live field
      tickDebris(S.debris, dt, camX != null ? camX : S.cx, camZ != null ? camZ : S.cz);
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
    windAt,
    localWeather,
    state() {
      if (!S) return null;
      return {
        eyeX: S.x, eyeZ: S.z, eyeR: S.eyeR, rmw: S.rmw, vmax: S.vmax,
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
      if (r < S.eyeCalmR) return 0.08;
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
  function moveWall(dt) {
    if (!S.wall) return;
    S.wall.position.set(S.x, 0, S.z);
    const d = dt || 1 / 60;
    S.wall._inner.rotation.y -= 0.11 * d;    // the wall visibly rotates
    S.wall._outer.rotation.y += 0.06 * d;    // counter-drift sells the shear
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
     calm, surgePeak is the biggest number the def actually fed the sea. */
  CBZ.hurricaneAudit = function () {
    const dot = evid.haveFront && evid.haveBack
      ? evid.frontX * evid.backX + evid.frontZ * evid.backZ : 1;
    return {
      on: CBZ.CONFIG.HURRICANE_V2 !== false,
      live: !!S,
      phase: phase(),
      eyeX: S ? +S.x.toFixed(1) : 0, eyeZ: S ? +S.z.toFixed(1) : 0,
      eyeR: S ? +S.eyeR.toFixed(1) : 0, rmw: S ? +S.rmw.toFixed(1) : 0,
      vmax: S ? +S.vmax.toFixed(1) : 0,
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
      wallLive: !!(S && S.wall),
    };
  };
})();
