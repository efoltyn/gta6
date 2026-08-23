/* ============================================================
   systems/blizzard.js — THE BLIZZARD CORE (CBZ.blizzard).

   A blizzard is WIND plus snow, not snowfall. The def in systems/disasters.js
   used to be: flat fog at 60 m, snow particles, and a rule that standing
   still outdoors hurts. That is a snowy day with a tax on idling. What
   actually defines the event, and what this file owns:

     THE WINDCHILL CLOCK   cold + wind strips heat off every unsheltered
                           actor on a clock — moving buys time (about half
                           rate), it does not buy safety. Core cold is a
                           per-actor 0..1 scalar; past ~0.6 hypothermia
                           damage ramps in and the killfeed reads "frozen
                           solid in the blizzard".
     THE WINDBREAK         the survival answer, made physical. A roof is
                           warmth (cold recovers). Standing in the LEE of a
                           building — the upwind ray is blocked within a few
                           metres — cuts exposure ~85%, enough to hold on
                           through the storm but never to warm up. The open
                           is a countdown. threat()/safeDir() steer the bot
                           crowd to the lee faces, so the huddle behind the
                           wall IS the telegraph.
     WHITEOUT IN GUSTS     visibility is not a constant. It breathes with a
                           deterministic gust cycle: ~40 m in the lulls, down
                           to ~12 m in the gusts — a person 8 m away is a
                           shadow, then gone. Navigation loss is this
                           disaster's own kind of danger; no other event in
                           the roster takes your eyes.
     THE WORLD CHANGES SHAPE  snow drifts on the lee side of every standing
                           building — real half-buried ellipsoid mounds that
                           GROW while the storm runs, keyed to the same wind
                           vector the flakes stream along, and that stay
                           after the all-clear, melting over minutes with
                           the ground cover. And the storm BURIES its dead:
                           a corpse in the open grows a white mound over it.

   REUSE, NOT REINVENTION:
     · flakes / fog / wind / ground whitening → CBZ.weatherDrive
       (systems/weather.js) — the ONE weather; `cover` whitens every
       up-facing surface, this file never paints the ground
     · deaths → CBZ.surv.hurt (killfeed cause comes from the def)
     · shelter-from-above → CBZ.platforms, the same records the quake and
       the ash fallout test
     · wind direction → the def draws it from the seeded hazard stream and
       CBZ.weatherWind() republishes it; drifts, flakes and windchill all
       read the same bearing

   DETERMINISM: nothing here draws randomness at all. The wind bearing comes
   in from the def (seeded), the gust cycle is a pure function of storm time,
   and drift placement is derived from building geometry — two clients
   running the same ticks freeze the same people and pile the same drifts.

   Ratchet: CBZ.blizzardAudit().
   Flag: BLIZZARD_V2 (declared HERE, default on). false = the def's legacy
   storm exactly: flat fog, snow, stand-still-and-hurt, no drifts, no clock.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  if (CBZ.blizzard) return;                    // idempotent family guard
  const THREE = window.THREE;

  CBZ.CONFIG = CBZ.CONFIG || {};
  // The rebuilt blizzard: windchill clock, windbreaks, gusting whiteout,
  // lee-side drifts, burial. false = the legacy flat-fog freeze-tax storm.
  if (CBZ.CONFIG.BLIZZARD_V2 == null) CBZ.CONFIG.BLIZZARD_V2 = true;

  const on = () => CBZ.CONFIG.BLIZZARD_V2 !== false;
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

  /* ---- tuning ---- */
  const CHILL_RATE = 0.115;      // cold/sec, full exposure, still, intensity 0
  const MOVE_MULT = 0.55;        // moving buys time, not safety
  const WARM_RATE = 0.30;        // cold/sec recovered under a roof
  const COLD_ONSET = 0.62;       // hypothermia damage starts here
  const HYPO_DPS = 16;           // dps at cold=1, intensity 0
  const WINDBREAK_CUT = 0.85;    // exposure removed by a solid lee
  const DRIFT_MAX_H = 1.7;       // tallest drift crest, metres
  const MOUND_MAX_H = 0.48;      // a buried body's mound
  const MELT_SECS = 240;         // drifts/mounds melt-out after the storm

  /* ---- storm state ---- */
  const S = {
    live: false, t: 0, wx: 1, wz: 0, intensity: 0.2,
    gust: 0, vis: 0, wind: 0,
    exposed: 0, lee: 0, roofed: 0, coldMax: 0, coldSum: 0, actorsN: 0,
  };
  const A = {                    // the ratchet's counters (per match, reset on begin)
    frozen: 0, hypoDamage: 0, buried: 0,
  };
  const drifts = [];             // {mesh, hMax, len, wid, alive}
  const mounds = [];             // {bot, mesh, h}
  let driftK = 0;                // 0..1 growth of every drift, shared
  let snowMat = null;

  function mat() {
    if (!snowMat) {
      snowMat = new THREE.MeshLambertMaterial({ color: 0xeef4fb });
    }
    return snowMat;
  }
  function arena() { return CBZ.surv && CBZ.surv.arena; }
  function ground(x, z) {
    const Ar = arena();
    return Ar ? Ar.groundHeightAt(x, z) : 0;
  }

  /* ---- SHELTER QUERIES -------------------------------------------------- */
  // a roof overhead = warmth (same CBZ.platforms records the quake tests)
  function roofedAt(x, z, y) {
    const plats = CBZ.platforms; if (!plats) return false;
    const head = (y == null ? ground(x, z) : y) + 2.1;
    for (let i = 0; i < plats.length; i++) {
      const p = plats[i];
      if (p.top > head && x >= p.minX && x <= p.maxX && z >= p.minZ && z <= p.maxZ) return true;
    }
    return false;
  }
  // is the upwind ray from (x,z) blocked by a standing structure within a few
  // metres? 0 = fully exposed, 1 = a solid windbreak right at your back.
  const WB_STEPS = [1.2, 2.6, 4.2, 6.4, 9.0];
  function windbreakAt(x, z) {
    const Ar = arena(); if (!Ar) return 0;
    const frag = Ar.fragile || [];
    let best = 0;
    for (let s = 0; s < WB_STEPS.length; s++) {
      const d = WB_STEPS[s];
      const px = x - S.wx * d, pz = z - S.wz * d;
      for (let i = 0; i < frag.length; i++) {
        const b = frag[i];
        if (b.fallen || b.h < 2.6) continue;
        if (px >= b.x - b.w / 2 - 0.6 && px <= b.x + b.w / 2 + 0.6 &&
            pz >= b.z - b.d / 2 - 0.6 && pz <= b.z + b.d / 2 + 0.6) {
          const k = 1 - d / 13;
          if (k > best) best = k;
          break;
        }
      }
      if (best > 0.9) break;
    }
    return clamp01(best);
  }
  // 0..1 how much of the wind reaches an actor at (x,z,y)
  function exposureAt(x, z, y) {
    if (roofedAt(x, z, y)) return 0;
    return clamp01(1 - WINDBREAK_CUT * windbreakAt(x, z));
  }

  /* ---- THE DRIFTS: the world changes shape ------------------------------
     One half-buried ellipsoid per standing building, on its lee face, its
     long axis along the wind. Scaled every tick by the shared driftK, so
     the whole field grows together as the storm runs and melts together
     after. Built lazily at begin() (the wind bearing is not known before). */
  function clearDrifts() {
    for (let i = 0; i < drifts.length; i++) {
      const d = drifts[i];
      if (d.mesh.parent) d.mesh.parent.remove(d.mesh);
      d.mesh.geometry.dispose();
    }
    drifts.length = 0;
    for (let i = 0; i < mounds.length; i++) {
      const m = mounds[i];
      if (m.mesh.parent) m.mesh.parent.remove(m.mesh);
      m.mesh.geometry.dispose();
    }
    mounds.length = 0;
    driftK = 0;
  }
  function buildDrifts() {
    clearDrifts();
    const Ar = arena(); if (!Ar || !Ar.root) return;
    const frag = Ar.fragile || [];
    const rotY = Math.atan2(S.wx, S.wz);       // local +z → wind direction
    for (let i = 0; i < frag.length; i++) {
      const b = frag[i];
      if (b.fallen || b.h < 2.6) continue;
      // half-extent of the footprint along the wind, and across it
      const along = (Math.abs(S.wx) * b.w + Math.abs(S.wz) * b.d) / 2;
      const across = (Math.abs(S.wz) * b.w + Math.abs(S.wx) * b.d) / 2;
      // longer than wide, tapering DOWNWIND — a drift, not a disc
      const len = 3.2 + across * 1.5;
      const wid = Math.min(across * 0.85 + 0.6, 6);
      const hMax = Math.min(DRIFT_MAX_H, 0.55 + across * 0.16);
      const cx = b.x + S.wx * (along + len * 0.42);
      const cz = b.z + S.wz * (along + len * 0.42);
      const gy = ground(cx, cz);
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 9), mat());
      mesh.position.set(cx, gy, cz);
      mesh.rotation.y = rotY;
      mesh.scale.set(wid, 0.001, len * 0.5);   // grows via driftK below
      mesh.castShadow = false; mesh.receiveShadow = true;
      Ar.root.add(mesh);
      drifts.push({ mesh, hMax, alive: true });
    }
  }
  function scaleDrifts() {
    for (let i = 0; i < drifts.length; i++) {
      const d = drifts[i];
      d.mesh.scale.y = Math.max(0.001, d.hMax * driftK);
      d.mesh.visible = driftK > 0.02;
    }
  }

  /* ---- THE BURIAL: the storm covers its dead ---------------------------- */
  let moundScanCd = 0;
  function tickMounds(dt) {
    moundScanCd -= dt;
    if (moundScanCd <= 0) {
      moundScanCd = 0.5;
      const Ar = arena();
      const bots = CBZ.bots || [];
      for (let i = 0; i < bots.length; i++) {
        const b = bots[i];
        if (!b.dead || !b.group || !b.group.parent) continue;
        if ((b.deadT || 0) < 0.8 || b._blzMound) continue;
        if (b.pos.y < -0.4) continue;                       // the sea keeps its own
        const rotY = Math.atan2(S.wx, S.wz);
        const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 7), mat());
        mesh.position.set(b.pos.x, ground(b.pos.x, b.pos.z), b.pos.z);
        mesh.rotation.y = rotY;
        mesh.scale.set(0.85, 0.001, 1.35);                  // body-length, along the wind
        if (Ar && Ar.root) Ar.root.add(mesh);
        b._blzMound = true;
        mounds.push({ bot: b, mesh, h: 0 });
        A.buried++;
      }
    }
    for (let i = mounds.length - 1; i >= 0; i--) {
      const m = mounds[i];
      // the corpse cull removed the body — its mound goes with it
      if (!m.bot.group || !m.bot.group.parent) {
        if (m.mesh.parent) m.mesh.parent.remove(m.mesh);
        m.mesh.geometry.dispose();
        m.bot._blzMound = false;
        mounds.splice(i, 1); continue;
      }
      // the mound grows while snow is still lying, storm live or just past —
      // a body buried in 3-4 sim-seconds, which is a game clock, not a lie
      const lying = S.live || (CBZ.weather && (CBZ.weather.snowCover || 0) > 0.3);
      if (lying) m.h = Math.min(MOUND_MAX_H, m.h + dt * 0.13);
      m.mesh.scale.y = Math.max(0.001, m.h);
    }
  }

  /* ---- THE FROZEN: a cold death leaves a rimed body --------------------- */
  function rime(actor) {
    if (actor.isPlayer || !actor.group) return;
    actor.group.traverse(function (o) {
      if (!o.isMesh || !o.material || Array.isArray(o.material) || !o.material.color) return;
      if (o.userData._blzRimed) return;
      o.userData._blzRimed = true;
      o.material = o.material.clone();
      o.material.color.lerp(new THREE.Color(0xdfe9f2), 0.72);
      if (o.material.emissive) o.material.emissive.setHex(0x0a0e14);
    });
  }

  /* ---- THE WINDCHILL CLOCK ---------------------------------------------- */
  let expIdx = 0;                // staggered exposure refresh (4 Hz-ish/actor)
  function tickCold(dt) {
    const surv = CBZ.surv; if (!surv) return;
    const actors = surv.actors();
    S.actorsN = actors.length;
    let exposed = 0, lee = 0, roofed = 0, coldSum = 0, coldMax = 0;
    for (let i = 0; i < actors.length; i++) {
      const a = actors[i];
      // exposure is a few ray tests against the building list — refresh each
      // actor's cached value every ~15 ticks, staggered, not every frame
      if (a._blzExp == null || ((i + expIdx) % 15) === 0) {
        a._blzExp = exposureAt(a.pos.x, a.pos.z, a.pos.y);
      }
      const E = a._blzExp;
      if (E <= 0.02) roofed++;
      else if (E < 0.5) lee++;
      else exposed++;
      let cold = a._blzCold || 0;
      if (E <= 0.02) {
        cold -= dt * WARM_RATE;                 // a roof is warmth
      } else {
        const moving = (a.speed || 0) > 1.6;
        cold += dt * CHILL_RATE * (0.85 + S.intensity) * E * (moving ? MOVE_MULT : 1);
      }
      cold = clamp01(cold);
      a._blzCold = cold;
      coldSum += cold; if (cold > coldMax) coldMax = cold;
      if (cold > COLD_ONSET) {
        const dmg = HYPO_DPS * (0.85 + S.intensity) * ((cold - COLD_ONSET) / (1 - COLD_ONSET)) * dt;
        A.hypoDamage += dmg;
        const wasBot = !a.isPlayer;
        surv.hurt(a, dmg);
        if (wasBot && a.dead) { A.frozen++; a._blzFrozen = true; rime(a); }
      }
    }
    expIdx = (expIdx + 1) % 15;
    S.exposed = exposed; S.lee = lee; S.roofed = roofed;
    S.coldSum = coldSum; S.coldMax = coldMax;
  }

  /* ---- THE STORM TICK (called by the def's active()) -------------------- */
  // deterministic gust cycle: peaks near t ≈ 3.6, 11.2, 18.7 s
  function gustAt(t) { return 0.5 + 0.5 * Math.sin(0.83 * t - 1.4); }

  function begin(wx, wz, ctx) {
    if (!on()) return;
    const m = Math.hypot(wx, wz) || 1;
    S.wx = wx / m; S.wz = wz / m;
    S.intensity = ctx ? ctx.intensity : 0.2;
    S.t = 0; S.live = false;
    A.frozen = 0; A.hypoDamage = 0; A.buried = 0;
    buildDrifts();
  }

  function storm(dt, ctx) {
    if (!on()) return;
    S.live = true;
    S.t += dt;
    S.intensity = ctx.intensity;
    const gust = gustAt(S.t);
    S.gust = gust;
    const p = Math.min(1, S.t / Math.max(1, ctx.activeSecs));

    // visibility BREATHES: ~40 m lulls, ~12 m whiteout in the gusts. In the
    // worst of it a person 8 m away is a shape, then nothing.
    const gk = gust * (0.8 + 0.4 * ctx.intensity);
    S.vis = 44 - 36 * Math.min(1, gk);
    S.wind = (14 + 8 * ctx.intensity) * (0.65 + 0.55 * gust);

    ctx.env.fog = 0xdbe6f0;
    ctx.env.fogNear = 1.5 + 6 * (1 - gust);
    ctx.env.fogFar = S.vis;
    ctx.env.sunInt = 0.6 - 0.25 * gust;
    ctx.env.sunColor = 0xcfe0ff;
    ctx.env.hemiInt = 1.1; ctx.env.hemiColor = 0xeaf2ff;

    if (CBZ.CONFIG.SURV_SHARED_WEATHER !== false && CBZ.weatherDrive) {
      CBZ.weatherDrive({
        rain: 0, snow: 1, wind: S.wind, windDir: { x: S.wx, z: S.wz },
        fog: 0.7 + 0.25 * gust, fogColor: 0xdbe6f0,
        cover: Math.min(1, (0.3 + 0.7 * p) * (0.75 + 0.25 * ctx.intensity)),
      }, 0.6);
    }

    // the drifts grow with the storm; a late-round blizzard piles them higher
    const target = p * (0.65 + 0.35 * ctx.intensity);
    driftK += (target - driftK) * Math.min(1, dt * 1.4);
    scaleDrifts();
    tickMounds(dt);
    tickCold(dt);
  }

  function end() {
    S.live = false;
    // drifts and mounds stay — the melt ticker below takes them out over
    // minutes, alongside systems/weather.js melting the ground cover
  }

  /* ---- BOT STEERING: the crowd converges on the lee faces --------------- */
  function threat(x, z) {
    if (!on()) return 0.25;
    if (roofedAt(x, z)) return 0.05;
    if (windbreakAt(x, z) > 0.5) return 0.1;   // holding on — stay put
    return 0.5;                                // the open is a countdown
  }
  function safeDir(x, z) {
    if (!on()) return null;
    const Ar = arena(); if (!Ar) return null;
    const frag = Ar.fragile || [];
    let best = null, bd = 1e9;
    for (let i = 0; i < frag.length; i++) {
      const b = frag[i];
      if (b.fallen || b.h < 3) continue;
      const along = (Math.abs(S.wx) * b.w + Math.abs(S.wz) * b.d) / 2;
      const lx = b.x + S.wx * (along + 2.2), lz = b.z + S.wz * (along + 2.2);
      const dx = lx - x, dz = lz - z, d2 = dx * dx + dz * dz;
      if (d2 < bd) { bd = d2; best = { x: dx, z: dz }; }
    }
    if (!best || bd < 2.2 * 2.2 || bd > 90 * 90) return null;
    const m = Math.hypot(best.x, best.z) || 1;
    return { x: best.x / m, z: best.z / m };
  }

  /* ---- MELT + MODE HYGIENE ----------------------------------------------
     After the all-clear the drifts shrink over MELT_SECS; leaving survival
     clears every mesh (they live in the arena root, but the records here
     must not dangle into the next match). */
  CBZ.onUpdate(27.7, function (dt) {
    if (!CBZ.game || CBZ.game.mode !== "survival") {
      if (drifts.length || mounds.length) clearDrifts();
      return;
    }
    if (!on()) return;
    if (!S.live && driftK > 0) {
      driftK = Math.max(0, driftK - dt / MELT_SECS);
      scaleDrifts();
      for (let i = 0; i < mounds.length; i++) {
        mounds[i].h = Math.max(0, mounds[i].h - dt * (MOUND_MAX_H / MELT_SECS));
        mounds[i].mesh.scale.y = Math.max(0.001, mounds[i].h);
      }
      if (driftK <= 0.001) clearDrifts();
    }
    if (!S.live) tickMounds(dt);               // keep culled-corpse mounds tidy
  });
  if (CBZ.bootComplete && CBZ.updaters && CBZ.updaters.sort) {
    CBZ.updaters.sort(function (a, b) { return a.order - b.order; });
  }

  /* ---- THE RATCHET ------------------------------------------------------ */
  CBZ.blizzardAudit = function () {
    let dMax = 0, dLive = 0;
    for (let i = 0; i < drifts.length; i++) {
      const h = drifts[i].mesh.scale.y;
      if (h > 0.02) dLive++;
      if (h > dMax) dMax = h;
    }
    return {
      v2: on(), live: S.live, t: +S.t.toFixed(2),
      gust: +S.gust.toFixed(3), visM: +S.vis.toFixed(1), windMs: +S.wind.toFixed(1),
      snowCover: CBZ.weather ? +(CBZ.weather.snowCover || 0).toFixed(3) : 0,
      drifts: dLive, driftMaxH: +dMax.toFixed(2), driftK: +driftK.toFixed(3),
      mounds: mounds.length, buried: A.buried,
      frozen: A.frozen, hypoDamage: +A.hypoDamage.toFixed(1),
      exposed: S.exposed, inLee: S.lee, roofed: S.roofed,
      coldAvg: S.actorsN ? +(S.coldSum / S.actorsN).toFixed(3) : 0,
      coldMax: +S.coldMax.toFixed(3),
    };
  };

  CBZ.blizzard = {
    begin, storm, end, threat, safeDir,
    windbreakAt, exposureAt, roofedAt,
    drifts: () => drifts, mounds: () => mounds,
    state: () => S,
    audit: () => CBZ.blizzardAudit(),
  };
})();
