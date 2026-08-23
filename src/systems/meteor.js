/* ============================================================
   systems/meteor.js — THE METEOR EVENT, REBUILT AROUND WHAT ONE IS.

   The roster's meteor shower used to be: additive streaks on RANDOM headings,
   a 2.4 m brown box teleport-dropping from y=40 onto a red disc, an instant
   bang, and a flat dark decal for a "crater". Every one of those is the
   opposite of the real event:

     · A shower has a RADIANT. Every rock in it arrives from one direction in
       the sky, because they are one debris stream the planet is driving
       through. Random headings read as fireworks; one shared heading reads
       as an astronomical event. Az/elevation are rolled once per event and
       every streak, bolide and smoke train obeys them (± a few degrees).

     · Almost all of the energy arrives as an AIRBURST. Chelyabinsk hurt
       ~1,500 people and touched none of them — it blew the windows in from
       30 km up. So most strikes here terminate ABOVE the ground in a flash
       and a pressure front, and only the minority get to the floor.

     · THE SOUND IS LATE. The flash is instant, the bang crawls in at the
       speed of sound — the single most characteristic thing about the whole
       event, and the cheapest to simulate: every bang in this file is
       scheduled at distance/SOUND_SPEED after its flash, and the pressure
       front IS the bang, expanding at that same speed so the ring you see
       sweeping the ground arrives on top of you in the same instant the
       audio does. (SOUND_SPEED is a dramatic 65 m/s, not 340 — the island
       is a few hundred metres across, and at 340 the signature seconds of
       silence would be an imperceptible 0.3 s. Same cheat every film makes,
       in the same direction.)

     · A bolide is BRIGHTER THAN THE SUN. lightBoost() is a 0..1 the owning
       def feeds into the scene's sun/hemi intensities each frame, so a low
       fireball visibly lights the world, and the terminal flash whites it
       out (CBZ.fx.flash) before the world has heard anything.

     · An impact leaves a HOLE and throws EJECTA. Ground strikes dig through
       CBZ.groundCrater — the same carved bowl a bomb leaves, raised lip and
       all, permanent — and hurl incandescent rock outward on real ballistic
       arcs through CBZ.fx.dropDebris. The flat decal is gone.

   DRAW CALLS: three, total, owned by this file. One InstancedMesh of
   stretched additive boxes carries every streak and every bolide trail
   segment; one InstancedMesh of spheres carries every bolide head and every
   burst flash; one InstancedMesh of fog-tinted boxes carries every smoke
   train puff. The old build spent a mesh per streak (up to 14) plus a mesh
   per marker. Nothing here allocates per frame.

   DIVISION OF LABOUR (same split systems/tornado.js established): this file
   owns the SKY — trajectories, light, sound timing, craters, ejecta, fronts.
   The owning def (systems/disasters.js `meteor:`) owns the GAME — which
   points get hit (seeded), what an impact prices (survBlast's kinetic row),
   and what a passing pressure front does to its own actor roster, via the
   `damage` callbacks it hands to begin().

   Flag: CBZ.CONFIG.METEOR_V2 (declared HERE, default on). Off, the def
   never calls this file and plays the legacy shower verbatim.
   Ratchet: CBZ.meteorAudit().
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  if (CBZ.CONFIG.METEOR_V2 == null) CBZ.CONFIG.METEOR_V2 = true;

  // the dramatic speed of sound (see header) — every bang and every front
  const SOUND_SPEED = 65;
  const STREAK_CAP = 40, GLOW_CAP = 24, SMOKE_CAP = 220;

  // private FX rng, seeded from ONE draw of the shared hazard stream at
  // begin() so this file never desynchronises the seeded sequence however
  // much cosmetic jitter it spends (core/seed.js's law: hazard placement
  // comes from the stream; FX jitter must not tax it).
  let rngState = 1;
  function frnd() { rngState = (rngState * 1664525 + 1013904223) >>> 0; return rngState / 4294967296; }

  let ev = null;   // the one live event
  const stats = {
    events: 0, streaksSpawned: 0, airbursts: 0, groundImpacts: 0,
    cratersDug: 0, ejecta: 0, bangsScheduled: 0, bangsHeard: 0,
    flashToBangLast: 0, flashToBangMax: 0, bigBursts: 0,
  };

  function listener() {
    return (CBZ.camera && CBZ.camera.position) || { x: 0, y: 0, z: 0 };
  }

  /* ---- the three instanced pools ---------------------------------------- */
  const dummy = new THREE.Object3D();
  function makePool(geo, mat, cap) {
    const m = new THREE.InstancedMesh(geo, mat, cap);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.frustumCulled = false;
    m.renderOrder = 7;
    // allocate instanceColor up front (r128: set before first render)
    m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
    m.instanceColor.setUsage(THREE.DynamicDrawUsage);
    m.count = 0; m.visible = false;
    return m;
  }
  function poolColor(mesh, i, hex) {
    const c = mesh.instanceColor.array;
    c[i * 3] = ((hex >> 16) & 255) / 255;
    c[i * 3 + 1] = ((hex >> 8) & 255) / 255;
    c[i * 3 + 2] = (hex & 255) / 255;
  }

  /* ============================================================
     CBZ.meteor.begin(opts)
       root       Object3D to parent the pools under (the arena root)
       floor(x,z) ground height query
       rnd()      the SHARED seeded stream — exactly one draw is taken
       cx,cz,R    arena centre + radius
       damage     { impact(x,z,spec), front(x,z,r0,r1,k,big) } — the owning
                  mode's pricing; this file never touches an actor itself
     ============================================================ */
  function begin(opts) {
    if (ev) stop();
    rngState = (Math.floor(opts.rnd() * 4294967296) ^ 0x9e3779b9) >>> 0;
    // THE RADIANT: one direction in the sky for the whole event.
    const az = frnd() * Math.PI * 2;
    const elev = 0.62 + frnd() * 0.35;             // 35°–55° descent
    const material = {
      streak: new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending }),
      glow: new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending }),
      smoke: new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.4, depthWrite: false }),
    };
    ev = {
      opts, az, elev,
      dirx: Math.cos(az), dirz: Math.sin(az),      // horizontal travel direction
      streaks: [], bolides: [], smoke: [], flashes: [], fronts: [], sounds: [],
      lightPulses: [],
      streakCd: 0.1, t: 0,
      pool: {
        streak: makePool(new THREE.BoxGeometry(1, 1, 1), material.streak, STREAK_CAP),
        glow: makePool(new THREE.SphereGeometry(1, 10, 8), material.glow, GLOW_CAP),
        // a dodecahedron reads as a puff; a cube reads as a crate
        smoke: makePool(new THREE.DodecahedronGeometry(0.62, 0), material.smoke, SMOKE_CAP),
      },
      material,
    };
    opts.root.add(ev.pool.streak); opts.root.add(ev.pool.glow); opts.root.add(ev.pool.smoke);
    stats.events++;
    return true;
  }

  // velocity along the radiant at `speed`, with a small per-rock scatter
  function radiantVel(speed, jitter) {
    const j = jitter || 0;
    const a = ev.az + (frnd() - 0.5) * j;
    const el = ev.elev + (frnd() - 0.5) * j * 0.6;
    const ch = Math.cos(el);
    return { x: Math.cos(a) * ch * speed, y: -Math.sin(el) * speed, z: Math.sin(a) * ch * speed };
  }

  /* an ambient streak: enters high, burns out high, harmless — the thing
     that makes you look up, all on the event's one shared heading */
  function spawnStreak() {
    if (ev.streaks.length >= STREAK_CAP - 4) return;
    const o = ev.opts;
    const gx = o.cx + (frnd() - 0.5) * o.R * 1.7;
    const gz = o.cz + (frnd() - 0.5) * o.R * 1.7;
    const v = radiantVel(190 + frnd() * 70, 0.12);
    const life = 0.9 + frnd() * 0.7;
    const y0 = 150 + frnd() * 90;
    // place so the midpoint of the burn sits over (gx,gz)
    ev.streaks.push({
      x: gx - v.x * life * 0.5, y: y0, z: gz - v.z * life * 0.5,
      vx: v.x, vy: v.y, vz: v.z,
      len: 20 + frnd() * 24, w: 0.8 + frnd() * 0.7,
      t: 0, life, color: frnd() < 0.25 ? 0xd9e6ff : 0xfff0d0,
    });
    stats.streaksSpawned++;
  }

  /* ============================================================
     CBZ.meteor.strike — one aimed rock. Arrives at (x, z) — or `alt` metres
     above it when `air` — exactly `eta` seconds from now, entering from the
     radiant. `spec` is carried through to damage.impact untouched.
     ============================================================ */
  function strike(s) {
    if (!ev) return false;
    const o = ev.opts;
    const gy = o.floor(s.x, s.z);
    const ty = s.air ? gy + (s.alt != null ? s.alt : 60) : gy + 0.5;
    const T = s.eta != null ? s.eta : 1.8;
    const speed = s.big ? 150 + frnd() * 30 : 120 + frnd() * 40;
    const v = radiantVel(speed, 0.05);
    ev.bolides.push({
      x: s.x - v.x * T, y: ty - v.y * T, z: s.z - v.z * T,
      vx: v.x, vy: v.y, vz: v.z,
      tx: s.x, ty, tz: s.z, gy,
      t: 0, T, size: s.size || 1, big: !!s.big, air: !!s.air,
      spec: s, trailAcc: 0,
    });
    return true;
  }

  function puff(x, y, z, scale, life, tint) {
    if (ev.smoke.length >= SMOKE_CAP - 2) ev.smoke.shift();
    ev.smoke.push({
      x, y, z, s0: scale, t: 0, life,
      rot: frnd() * 3.14, grow: 0.5 + frnd() * 0.8,
      color: tint || (0x9a9a9a + ((frnd() * 24) | 0) * 0x010101),
      dx: (frnd() - 0.5) * 0.6, dy: 0.4 + frnd() * 0.5, dz: (frnd() - 0.5) * 0.6,
    });
  }

  function scheduleBang(x, y, z, vol, name) {
    const L = listener();
    const d = Math.hypot(x - L.x, y - L.y, z - L.z);
    const delay = d / SOUND_SPEED;
    ev.sounds.push({ t: delay, name: name || "explosion", x, z, vol });
    // a distant roll after the crack — the echo off the sky
    ev.sounds.push({ t: delay + 0.7 + frnd() * 0.5, name: "rumble", x, z, vol: vol * 0.6 });
    stats.bangsScheduled++;
    stats.flashToBangLast = +delay.toFixed(2);
    if (delay > stats.flashToBangMax) stats.flashToBangMax = +delay.toFixed(2);
    return delay;
  }

  /* the terminal AIRBURST: flash now, front and bang later */
  function burst(b) {
    const o = ev.opts;
    const alt = Math.max(4, b.ty - b.gy);
    const big = b.big;
    stats.airbursts++; if (big) stats.bigBursts++;
    ev.lastBurst = { x: +b.tx.toFixed(1), y: +b.ty.toFixed(1), z: +b.tz.toFixed(1), t: ev.t, big };
    if (big) ev.lastBig = ev.lastBurst;
    // the flash: an additive sphere blowing up and fading, plus a real
    // whiteout scaled by how close the listener is — light arrives NOW
    ev.flashes.push({ x: b.tx, y: b.ty, z: b.tz, t: 0, life: big ? 0.7 : 0.45, r0: b.size * 2.5, r1: big ? 34 : 15 });
    const L = listener();
    const d = Math.hypot(b.tx - L.x, b.ty - L.y, b.tz - L.z);
    if (CBZ.fx && CBZ.fx.flash) CBZ.fx.flash(Math.min(big ? 0.95 : 0.55, (big ? 220 : 90) / Math.max(30, d)), 0xfff4e0);
    ev.lightPulses.push({ t: 0, life: big ? 1.4 : 0.7, k: big ? 1 : 0.45 });
    // a lingering smoke ball where the rock ceased to exist
    for (let i = 0; i < (big ? 16 : 7); i++) {
      puff(b.tx + (frnd() - 0.5) * (big ? 10 : 6), b.ty + (frnd() - 0.5) * (big ? 10 : 6), b.tz + (frnd() - 0.5) * (big ? 10 : 6),
        (big ? 5 : 2.6) + frnd() * 3, 10 + frnd() * 10, 0x8a8078);
    }
    // THE WAIT, then the bang: the pressure front leaves now at SOUND_SPEED,
    // reaches the ground below at alt/c, and the annulus it sweeps after
    // that is both the visible ring and the damage — sound, glass, knockdown
    // all riding one wavefront.
    // capped: fx.blast sweeps glass at 0.85·maxR, and an uncapped big front
    // was re-checking every pane on the island per burst
    const maxR = big ? Math.min(200, o.R * 1.8) : 30 + 26 * b.size;
    ev.fronts.push({ x: b.tx, z: b.tz, gy: b.gy, alt, t: 0, r: 0, maxR, k: big ? 1 : 0.5 + 0.2 * b.size, big, ringDrawn: false });
    scheduleBang(b.tx, b.ty, b.tz, big ? 1 : 0.55);
  }

  /* the minority that gets to the floor: price it, dig it, throw it */
  function groundImpact(b) {
    const o = ev.opts;
    stats.groundImpacts++;
    ev.lastImpact = { x: +b.tx.toFixed(1), z: +b.tz.toFixed(1), t: ev.t };
    if (o.damage && o.damage.impact) { try { o.damage.impact(b.tx, b.tz, b.spec); } catch (e) {} }
    // THE HOLE. The same carved bowl a bomb leaves — permanent, raised lip,
    // merged if two rocks land close. craters.js refuses slopes/water/roofs;
    // a refused dig just means this rock hit ground that keeps no scar.
    let shaft = null;
    if (CBZ.groundCrater) {
      shaft = CBZ.groundCrater(b.tx, b.tz, { power: 2.2 + b.size * 1.2, surface: "soil" });
      if (shaft) {
        stats.cratersDug++;
        ev.craters = ev.craters || [];
        ev.craters.push({ x: +shaft.x.toFixed(1), z: +shaft.z.toFixed(1), r: +shaft.r.toFixed(1) });
      }
    }
    // THE EJECTA: rock hurled outward on real arcs from the point of impact,
    // a few of them incandescent and left glowing in the grass.
    const n = 5 + Math.round(b.size * 2);
    for (let i = 0; i < n && CBZ.fx && CBZ.fx.dropDebris; i++) {
      const a = frnd() * Math.PI * 2, dist = 7 + frnd() * (14 + b.size * 8);
      const glow = i < 2 + (b.big ? 2 : 0);
      CBZ.fx.dropDebris({
        x: b.tx + Math.cos(a) * dist, z: b.tz + Math.sin(a) * dist,
        fromX: b.tx, fromZ: b.tz, fromY: b.gy + 1.5,
        size: glow ? 0.7 + frnd() * 0.6 : 0.5 + frnd() * 0.9,
        shape: "rock", glow, color: glow ? 0xff7a26 : 0x4a3a30,
        dmg: 26, linger: glow ? 30 : 7, keep: glow,
      });
      stats.ejecta++;
    }
    // dust column standing over the hole
    for (let i = 0; i < 7; i++) puff(b.tx + (frnd() - 0.5) * 5, b.gy + 2 + i * 2.2, b.tz + (frnd() - 0.5) * 5, 2 + frnd() * 2.5, 6 + frnd() * 6, 0x6b5c4e);
    ev.lightPulses.push({ t: 0, life: 0.5, k: 0.35 });
    if (CBZ.shake) CBZ.shake(0.5 + 0.3 * b.size);
    scheduleBang(b.tx, b.gy, b.tz, 0.8, "explosion");
  }

  /* ---- tick --------------------------------------------------------------- */
  function tick(dt) {
    if (!ev) return;
    const o = ev.opts;
    ev.t += dt;

    // ambient streaks, forever, from the one radiant
    ev.streakCd -= dt;
    if (ev.streakCd <= 0) { ev.streakCd = 0.08 + frnd() * 0.18; spawnStreak(); }

    // streaks fly and die
    for (let i = ev.streaks.length - 1; i >= 0; i--) {
      const s = ev.streaks[i]; s.t += dt;
      s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;
      if (s.t >= s.life) ev.streaks.splice(i, 1);
    }

    // bolides fly; low ones lay smoke and light the world
    for (let i = ev.bolides.length - 1; i >= 0; i--) {
      const b = ev.bolides[i]; b.t += dt;
      b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
      b.trailAcc += Math.hypot(b.vx, b.vy, b.vz) * dt;
      const step = b.big ? 4 : 5.5;
      while (b.trailAcc > step) {
        b.trailAcc -= step;
        puff(b.x + (frnd() - 0.5) * 2, b.y + (frnd() - 0.5) * 2, b.z + (frnd() - 0.5) * 2,
          (b.big ? 3.4 : 1.9) + frnd() * 1.6, (b.big ? 18 : 10) + frnd() * 6, 0xa8a09a);
      }
      if (b.t >= b.T) {
        ev.bolides.splice(i, 1);
        if (b.air) burst(b); else groundImpact(b);
      }
    }

    // burst flashes expand and fade
    for (let i = ev.flashes.length - 1; i >= 0; i--) {
      const f = ev.flashes[i]; f.t += dt;
      if (f.t >= f.life) ev.flashes.splice(i, 1);
    }

    // pressure fronts: r(t) = sqrt((c·t)² − alt²) — the sphere from the burst
    // meeting the ground, exactly when the bang would
    for (let i = ev.fronts.length - 1; i >= 0; i--) {
      const f = ev.fronts[i]; f.t += dt;
      const ct = SOUND_SPEED * f.t;
      const r = ct > f.alt ? Math.sqrt(ct * ct - f.alt * f.alt) : 0;
      if (r > 0) {
        if (!f.ringDrawn) {
          f.ringDrawn = true;
          // the visible ring rides the same clock as the audio
          if (CBZ.fx && CBZ.fx.blast) CBZ.fx.blast(f.x, f.z, {
            maxR: f.maxR, speed: SOUND_SPEED, life: f.maxR / SOUND_SPEED,
            color: 0xffe0b8, shake: f.big ? 1.1 : 0.5, flash: 0,
          });
        }
        const k = f.k * Math.max(0, 1 - r / f.maxR);
        if (o.damage && o.damage.front && r > f.r) {
          try { o.damage.front(f.x, f.z, f.r, r, k, f.big); } catch (e) {}
        }
        f.r = r;
      }
      if (f.r >= f.maxR) ev.fronts.splice(i, 1);
    }

    // smoke drifts on THE wind and swells
    const w = CBZ.weatherWind ? CBZ.weatherWind() : { x: 1, z: 0, speed: 0 };
    const wk = 0.5 + (w.speed || 0) * 0.12;
    for (let i = ev.smoke.length - 1; i >= 0; i--) {
      const p = ev.smoke[i]; p.t += dt;
      p.x += (p.dx + w.x * wk) * dt; p.y += p.dy * dt; p.z += (p.dz + w.z * wk) * dt;
      if (p.t >= p.life) ev.smoke.splice(i, 1);
    }

    // the delayed bangs
    for (let i = ev.sounds.length - 1; i >= 0; i--) {
      const s = ev.sounds[i]; s.t -= dt;
      if (s.t <= 0) {
        ev.sounds.splice(i, 1);
        if (CBZ.sfxAt) CBZ.sfxAt(s.name, s.x, s.z, { volume: Math.min(1, s.vol) });
        stats.bangsHeard++;
      }
    }

    // light pulses decay
    for (let i = ev.lightPulses.length - 1; i >= 0; i--) {
      const p = ev.lightPulses[i]; p.t += dt;
      if (p.t >= p.life) ev.lightPulses.splice(i, 1);
    }

    draw();
  }

  /* one matrix rebuild per pool per tick — the whole render cost */
  function draw() {
    const P = ev.pool;
    // STREAKS + bolide glow-tails share the additive box pool
    let n = 0;
    const put = (x, y, z, vx, vy, vz, len, w, color) => {
      if (n >= STREAK_CAP) return;
      dummy.position.set(x, y, z);
      dummy.lookAt(x + vx, y + vy, z + vz);
      dummy.scale.set(w, w, len);
      dummy.updateMatrix();
      P.streak.setMatrixAt(n, dummy.matrix);
      poolColor(P.streak, n, color);
      n++;
    };
    for (const s of ev.streaks) {
      const fade = 1 - s.t / s.life;
      put(s.x, s.y, s.z, s.vx, s.vy, s.vz, s.len * (0.4 + 0.6 * fade), s.w * (0.3 + 0.7 * fade), s.color);
    }
    for (const b of ev.bolides) {
      // the incandescent tail directly behind the head
      put(b.x - b.vx * 0.06, b.y - b.vy * 0.06, b.z - b.vz * 0.06, b.vx, b.vy, b.vz,
        b.big ? 34 : 18, b.big ? 2.6 : 1.3, 0xffc070);
      put(b.x - b.vx * 0.16, b.y - b.vy * 0.16, b.z - b.vz * 0.16, b.vx, b.vy, b.vz,
        b.big ? 52 : 26, b.big ? 1.4 : 0.7, 0xff8040);
    }
    P.streak.count = n; P.streak.visible = n > 0;
    P.streak.instanceMatrix.needsUpdate = true;
    if (P.streak.instanceColor) P.streak.instanceColor.needsUpdate = true;

    // GLOW: bolide heads + burst flash spheres
    let g = 0;
    const orb = (x, y, z, r, color) => {
      if (g >= GLOW_CAP) return;
      dummy.position.set(x, y, z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(r, r, r);
      dummy.updateMatrix();
      P.glow.setMatrixAt(g, dummy.matrix);
      poolColor(P.glow, g, color);
      g++;
    };
    for (const b of ev.bolides) {
      const r = (b.big ? 3.4 : 1.4) * (0.85 + 0.3 * Math.sin(b.t * 37));   // it FLICKERS
      orb(b.x, b.y, b.z, r * b.size, 0xfff6e6);
      orb(b.x, b.y, b.z, r * b.size * 2.3, 0x553311);   // dim warm halo (additive)
    }
    for (const f of ev.flashes) {
      const u = f.t / f.life;
      orb(f.x, f.y, f.z, f.r0 + (f.r1 - f.r0) * Math.sqrt(u) * (1 - u * 0.3), u < 0.3 ? 0xffffff : 0xffd9a0);
    }
    P.glow.count = g; P.glow.visible = g > 0;
    P.glow.instanceMatrix.needsUpdate = true;
    if (P.glow.instanceColor) P.glow.instanceColor.needsUpdate = true;

    // SMOKE trains
    let m = 0;
    for (const p of ev.smoke) {
      if (m >= SMOKE_CAP) break;
      const u = p.t / p.life;
      const s = p.s0 * (1 + p.grow * u) * (u > 0.75 ? (1 - u) / 0.25 : 1);
      if (s < 0.05) continue;
      dummy.position.set(p.x, p.y, p.z);
      dummy.rotation.set(p.rot, p.rot * 1.7, p.rot * 0.6);
      dummy.scale.set(s, s, s);
      dummy.updateMatrix();
      P.smoke.setMatrixAt(m, dummy.matrix);
      poolColor(P.smoke, m, p.color);
      m++;
    }
    P.smoke.count = m; P.smoke.visible = m > 0;
    P.smoke.instanceMatrix.needsUpdate = true;
    if (P.smoke.instanceColor) P.smoke.instanceColor.needsUpdate = true;
  }

  /* how hard the sky is lighting the world right now, 0..1 — the def feeds
     this into survEnv's sun/hemi so a low bolide casts real light and the
     burst whites the island before it makes a sound */
  function lightBoost() {
    if (!ev) return 0;
    let b = 0;
    for (const p of ev.lightPulses) b = Math.max(b, p.k * (1 - p.t / p.life));
    for (const bo of ev.bolides) {
      const low = Math.max(0, 1 - (bo.y - bo.gy) / 220);
      b = Math.max(b, (bo.big ? 0.55 : 0.2) * low);
    }
    return Math.min(1, b);
  }

  function stop() {
    if (!ev) return;
    const P = ev.pool;
    for (const k of ["streak", "glow", "smoke"]) {
      const mp = P[k];
      if (mp.parent) mp.parent.remove(mp);
      mp.geometry.dispose(); mp.material.dispose();
    }
    ev = null;
  }

  CBZ.meteor = { begin, strike, tick, stop, lightBoost, live: () => !!ev };

  CBZ.meteorAudit = function () {
    const a = {
      on: CBZ.CONFIG.METEOR_V2 !== false, live: !!ev,
      events: stats.events,
      streaksLive: ev ? ev.streaks.length : 0, streaksSpawned: stats.streaksSpawned,
      airbursts: stats.airbursts, bigBursts: stats.bigBursts,
      groundImpacts: stats.groundImpacts, cratersDug: stats.cratersDug,
      ejecta: stats.ejecta,
      bangsScheduled: stats.bangsScheduled, bangsHeard: stats.bangsHeard,
      flashToBangLast: stats.flashToBangLast, flashToBangMax: stats.flashToBangMax,
      lightBoost: +lightBoost().toFixed(3),
      soundSpeed: SOUND_SPEED, drawsOwned: ev ? 3 : 0,
    };
    if (ev) {
      a.radiantAz = +ev.az.toFixed(3); a.radiantElev = +ev.elev.toFixed(3);
      a.streakDirs = ev.streaks.map((s) => ({ x: +s.vx.toFixed(2), z: +s.vz.toFixed(2) }));
      a.bolides = ev.bolides.map((b) => ({ x: +b.x.toFixed(1), y: +b.y.toFixed(1), z: +b.z.toFixed(1), tx: +b.tx.toFixed(1), tz: +b.tz.toFixed(1), big: b.big, air: b.air, eta: +(b.T - b.t).toFixed(2) }));
      a.lastBurst = ev.lastBurst || null;
      a.lastBigBurst = ev.lastBig || null;
      a.lastImpact = ev.lastImpact || null;
      a.craters = ev.craters || [];
      a.smokeLive = ev.smoke.length;
      a.frontsLive = ev.fronts.length;
      a.bangsPending = ev.sounds.length;
    }
    return a;
  };
})();
