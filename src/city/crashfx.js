/* ============================================================
   city/crashfx.js - compact car-impact visuals for CITY mode.

   Crashes are infrequent, so a short-lived point burst and a few shared-geo
   body fragments buy a lot of impact without adding steady frame cost.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE || !CBZ.scene) return;
  const THREE = window.THREE;
  const scene = CBZ.scene;
  const bursts = [], rings = [], chunks = [], scorches = [];
  const chunkGeo = new THREE.BoxGeometry(0.28, 0.18, 0.42);
  chunkGeo._shared = true;
  // a couple of debris materials so flying chunks aren't all the same flat grey
  const chunkMat = new THREE.MeshLambertMaterial({ color: 0x3c4148 });
  chunkMat._shared = true;
  const chunkMatHot = new THREE.MeshBasicMaterial({ color: 0x6b3a22 }); // charred / glowing edge
  chunkMatHot._shared = true;

  // y0 (optional) seats the burst at an impact HEIGHT (rocket on a tower face)
  // instead of the default street level.
  function pointBurst(x, z, count, color, size, speed, life, dust, y0) {
    const pos = new Float32Array(count * 3);
    const vel = new Float32Array(count * 3);
    const baseY = y0 != null ? y0 : 0.35;
    for (let i = 0; i < count; i++) {
      const o = i * 3, a = Math.random() * Math.PI * 2;
      const sp = speed * (0.35 + Math.random() * 0.8);
      pos[o] = x + (Math.random() - 0.5) * 0.8;
      pos[o + 1] = baseY + Math.random() * (dust ? 0.5 : 1.0);
      pos[o + 2] = z + (Math.random() - 0.5) * 0.8;
      vel[o] = Math.cos(a) * sp;
      vel[o + 1] = (dust ? 0.9 : 2.5) + Math.random() * (dust ? 1.7 : 4.5);
      vel[o + 2] = Math.sin(a) * sp;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      color, size, transparent: true, opacity: dust ? 0.5 : 0.95,
      depthWrite: false, blending: dust ? THREE.NormalBlending : THREE.AdditiveBlending,
    });
    const mesh = new THREE.Points(geo, mat);
    mesh.renderOrder = 8;
    scene.add(mesh);
    bursts.push({ mesh, geo, mat, pos, vel, t: 0, life, dust: !!dust });
  }

  function ring(x, z, radius, color, opt) {
    opt = opt || {};
    const inner = opt.inner == null ? 0.7 : opt.inner;
    const geo = new THREE.RingGeometry(inner, 1.3, 36);
    const mat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: opt.opacity == null ? 0.72 : opt.opacity,
      depthWrite: false, side: THREE.DoubleSide,
      blending: opt.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, opt.y == null ? 0.08 : opt.y, z);
    mesh.renderOrder = 7;
    scene.add(mesh);
    rings.push({
      mesh, geo, mat, radius, r: opt.r0 == null ? 1 : opt.r0, t: 0,
      life: opt.life == null ? 0.5 : opt.life,
      spd: opt.spd == null ? 2.2 : opt.spd,
      op0: opt.opacity == null ? 0.72 : opt.opacity,
      flat: !!opt.flat, // shockwave hugs the ground and thins as it grows
    });
  }

  // dir (optional {x,z} unit vector) biases the spray DOWNRANGE of the impact so
  // a head-on crash throws panels forward off the hit instead of a flat ring.
  // y0 (optional) spawns the debris at an elevated impact seat; life stretches
  // to cover the fall so chunks reach the street instead of vanishing mid-air.
  function addChunks(x, z, count, force, hot, dir, y0) {
    while (chunks.length > 56) {
      const old = chunks.shift();
      scene.remove(old.mesh);
    }
    const dx = dir ? dir.x : 0, dz = dir ? dir.z : 0, biased = !!dir;
    const baseY = y0 != null ? y0 : 0.4;
    const fall = y0 != null ? Math.sqrt(Math.max(0.5, y0) / 8.8) : 0;   // grav*0.8 fall time to street
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      // mostly charred grey, a few glowing-hot shards on an explosion
      const glow = hot && Math.random() < 0.5;
      const mesh = new THREE.Mesh(chunkGeo, glow ? chunkMatHot : chunkMat);
      mesh.position.set(x, baseY + Math.random() * 0.8, z);
      mesh.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      mesh.scale.setScalar((0.65 + Math.random() * 0.8) * (hot ? 1.1 : 1));
      scene.add(mesh);
      // debris flies fast then arcs down under gravity (slightly damped so it
      // hangs a touch longer like AAA shrapnel), heavier shards thrown lower
      const up = hot ? (3 + Math.random() * 6) : (2 + Math.random() * 4);
      const sp = force * (0.4 + Math.random() * 1.0);
      let vx = Math.cos(a) * sp, vz = Math.sin(a) * sp;
      if (biased) { vx += dx * force * (0.6 + Math.random() * 0.8); vz += dz * force * (0.6 + Math.random() * 0.8); }
      chunks.push({
        mesh, vx, vy: up, vz,
        spin: (Math.random() - 0.5) * 16, t: 0, life: fall + 1.2 + Math.random() * 1.1,
        trail: glow ? 0 : -1, // glowing shards drip a tiny ember trail
      });
    }
  }

  // adopt an already-built mesh (a hood torn off a crashed car) into the shared
  // debris pool: same gravity/bounce/spin/expiry as crash chunks, so a panel
  // that tears free tumbles and settles like every other piece of wreckage.
  // Caller hands it over already posed in WORLD space; the pool only ever
  // scene.remove()s it (no dispose — donated geo/materials stay owned by the
  // car systems that built them).
  CBZ.cityDebrisAdopt = function (mesh, vx, vy, vz) {
    if (!mesh) return;
    while (chunks.length > 56) { const old = chunks.shift(); scene.remove(old.mesh); }
    scene.add(mesh);
    chunks.push({
      mesh, vx: vx || 0, vy: vy == null ? 3 : vy, vz: vz || 0,
      spin: (Math.random() - 0.5) * 9, t: 0, life: 2.6 + Math.random() * 1.2, trail: -1,
    });
  };

  // ---- ground SCORCH decal (a dark radial disc that snaps in + lingers) ----
  // Pooled flat circles laid just above the road; one shared scorch texture.
  let scorchTex = null;
  function makeScorchTexture() {
    const c = document.createElement("canvas"); c.width = c.height = 128;
    const ctx = c.getContext("2d"), r = 64, g = ctx.createRadialGradient(r, r, 0, r, r, r);
    g.addColorStop(0.0, "rgba(20,16,14,0.92)");
    g.addColorStop(0.45, "rgba(28,22,18,0.82)");
    g.addColorStop(0.78, "rgba(34,26,20,0.4)");
    g.addColorStop(1.0, "rgba(0,0,0,0.0)");
    ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
    // mottled soot flecks so it doesn't read as a perfect circle
    ctx.globalCompositeOperation = "destination-out";
    for (let i = 0; i < 90; i++) {
      const a = Math.random() * 6.2832, rr = 18 + Math.random() * 44;
      ctx.beginPath(); ctx.arc(r + Math.cos(a) * rr, r + Math.sin(a) * rr, 2 + Math.random() * 5, 0, 6.2832);
      ctx.fillStyle = "rgba(0,0,0," + (0.2 + Math.random() * 0.5) + ")"; ctx.fill();
    }
    const t = new THREE.Texture(c); t.needsUpdate = true; return t;
  }
  const scorchGeo = new THREE.PlaneGeometry(1, 1); scorchGeo._shared = true;
  function addScorch(x, z, radius, hold) {
    if (!scorchTex) scorchTex = makeScorchTexture();
    while (scorches.length > 12) { const o = scorches.shift(); scene.remove(o.mesh); o.mesh.material.dispose(); }
    const mat = new THREE.MeshBasicMaterial({ map: scorchTex, transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    const mesh = new THREE.Mesh(scorchGeo, mat);
    mesh.rotation.x = -Math.PI / 2; mesh.rotation.z = Math.random() * 6.28;
    mesh.position.set(x, 0.045, z); mesh.scale.setScalar(radius * 2);
    mesh.renderOrder = 1; scene.add(mesh);
    // scorch marks linger as black road stains; airstrikes pass a longer hold
    scorches.push({ mesh, mat, t: 0, hold: (hold || 11) + Math.random() * 5, grow: 0 });
  }

  // ---- GORY FALL/HARD-IMPACT splat — a body hitting the ground at speed ----
  // Reuses the pooled-decal + pointBurst + chunk machinery, then routes through
  // CBZ.gore for the blood burst/gibs. A dark-red blood POOL decal spreads at the
  // impact seat (its own pool, separate from the soot scorch), a low crimson
  // spatter sheets out, and the whole thing gets a heavy shake + bone-crunch +
  // hitstop. Bounded: pools cap and recycle, so a spammed fall can't flood FX.
  const splats = [];
  let splatTex = null;
  function makeSplatTexture() {
    const c = document.createElement("canvas"); c.width = c.height = 128;
    const ctx = c.getContext("2d"), r = 64, g = ctx.createRadialGradient(r, r, 0, r, r, r);
    g.addColorStop(0.0, "rgba(96,8,8,0.95)");
    g.addColorStop(0.4, "rgba(120,12,12,0.9)");
    g.addColorStop(0.72, "rgba(80,6,6,0.5)");
    g.addColorStop(1.0, "rgba(40,0,0,0.0)");
    ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
    // ragged limbs of spatter flicked out past the pool's edge (Tarantino fan)
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * 6.2832, rr = 40 + Math.random() * 24;
      ctx.beginPath(); ctx.arc(r + Math.cos(a) * rr, r + Math.sin(a) * rr, 2 + Math.random() * 6, 0, 6.2832);
      ctx.fillStyle = "rgba(110,6,6," + (0.3 + Math.random() * 0.55) + ")"; ctx.fill();
    }
    // a couple of darker clots near the centre so it doesn't read as a flat disc
    ctx.globalCompositeOperation = "multiply";
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * 6.2832, rr = Math.random() * 30;
      ctx.beginPath(); ctx.arc(r + Math.cos(a) * rr, r + Math.sin(a) * rr, 4 + Math.random() * 9, 0, 6.2832);
      ctx.fillStyle = "rgba(60,0,0,0.6)"; ctx.fill();
    }
    const t = new THREE.Texture(c); t.needsUpdate = true; return t;
  }
  function addBloodPool(x, z, radius) {
    if (!splatTex) splatTex = makeSplatTexture();
    while (splats.length > 10) { const o = splats.shift(); scene.remove(o.mesh); o.mat.dispose(); }
    const mat = new THREE.MeshBasicMaterial({ map: splatTex, transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 });
    const mesh = new THREE.Mesh(scorchGeo, mat);   // reuse the shared 1x1 plane
    mesh.rotation.x = -Math.PI / 2; mesh.rotation.z = Math.random() * 6.28;
    mesh.position.set(x, 0.05, z); mesh.scale.setScalar(0.4);
    mesh.renderOrder = 2; scene.add(mesh);
    splats.push({ mesh, mat, t: 0, r0: 0.4, r1: radius * 2, hold: 16 + Math.random() * 8 });
  }

  // x,y,z = impact point; opts.player flags the player's own splat (more gore),
  // opts.speed scales the violence. Safe to call without THREE gore loaded.
  CBZ.cityImpactSplat = function (x, y, z, opts) {
    opts = opts || {};
    if (!CBZ.game || CBZ.game.mode !== "city") return;
    const player = !!opts.player;
    const speed = opts.speed || 18;
    const power = Math.min(2.4, Math.max(1, speed / 16));   // visual dial, clamped
    // crimson sheet skidding out low across the ground (the splash on impact)
    pointBurst(x, z, Math.round((player ? 40 : 26) * power), 0x8a0a0a, 0.17, 3 + speed * 0.28, 0.6, false);
    pointBurst(x, z, Math.round(14 * power), 0xc01818, 0.12, 5 + speed * 0.3, 0.42, false);
    // a lingering dark-red blood POOL spreading at the impact seat
    addBloodPool(x, z, (player ? 2.4 : 1.7) * power);
    // a few chunky dark gibs tumbling off the splat (reuse the debris pool)
    addChunks(x, z, Math.round((player ? 6 : 4) * power), 2.2 + speed * 0.1, false, opts.dir || null);
    // the layered blood event (spray/mist/gibs/pool/wall) — gibs-lite, the works
    if (CBZ.gore) { try { CBZ.gore(x, y != null ? y : 1.0, z, { dir: opts.dir || null, amount: player ? 1.7 : 1.3, player: player, explosion: false }); } catch (e) {} }
    // bone-crunch + wet impact (layered real foley), heavy shake + hitstop
    if (CBZ.sfx) { CBZ.sfx("ko"); CBZ.sfx("clank"); }
    if (CBZ.shake) CBZ.shake(Math.min(2.0, 0.9 + power * 0.4));
    if (CBZ.doHitstop) CBZ.doHitstop(Math.min(0.22, 0.1 + power * 0.05));
    if (player && CBZ.doSlowmo) CBZ.doSlowmo(0.4);
  };

  // ---- soft additive FIREBALL sprites (the good-looking explosion) ----
  // One shared 64px radial-gradient texture (white core → transparent rim) used
  // by every pooled sprite; additive blending sums overlaps toward white-hot.
  const puffs = [], _ecol = new THREE.Color();
  let puffPool = [], puffTex = null, smokeTex = null;
  function makePuffTexture() {
    const c = document.createElement("canvas"); c.width = c.height = 64;
    const ctx = c.getContext("2d"), r = 32, g = ctx.createRadialGradient(r, r, 0, r, r, r);
    g.addColorStop(0.0, "rgba(255,255,255,1.0)");
    g.addColorStop(0.3, "rgba(255,255,255,0.55)");
    g.addColorStop(0.7, "rgba(255,255,255,0.12)");
    g.addColorStop(1.0, "rgba(255,255,255,0.0)");
    ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
    const t = new THREE.Texture(c); t.needsUpdate = true; return t;
  }
  // Lumpy smoke texture: several overlapping soft blobs so rising smoke reads as
  // billowing cloud rather than a clean dot. Sampled with alpha blending.
  function makeSmokeTexture() {
    const c = document.createElement("canvas"); c.width = c.height = 64;
    const ctx = c.getContext("2d");
    for (let i = 0; i < 7; i++) {
      const px = 16 + Math.random() * 32, py = 16 + Math.random() * 32, rr = 10 + Math.random() * 16;
      const g = ctx.createRadialGradient(px, py, 0, px, py, rr);
      g.addColorStop(0, "rgba(255,255,255," + (0.45 + Math.random() * 0.35) + ")");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(px, py, rr, 0, 6.2832); ctx.fill();
    }
    const t = new THREE.Texture(c); t.needsUpdate = true; return t;
  }
  function getPuff(additive, smoke) {
    if (!puffTex) puffTex = makePuffTexture();
    if (smoke && !smokeTex) smokeTex = makeSmokeTexture();
    let p = puffPool.pop();
    if (!p) {
      const m = new THREE.SpriteMaterial({ map: puffTex, depthWrite: false, depthTest: true, transparent: true, opacity: 0 });
      p = new THREE.Sprite(m); p.renderOrder = 9; scene.add(p);
    }
    const wantMap = smoke ? smokeTex : puffTex;
    if (p.material.map !== wantMap) { p.material.map = wantMap; p.material.needsUpdate = true; } // rebind sampler on swap
    p.material.blending = additive ? THREE.AdditiveBlending : THREE.NormalBlending;
    p.renderOrder = smoke ? 6 : 9; // smoke sits behind flame
    p.visible = true; return p;
  }
  // white → yellow → orange → deep-red → smoke over normalized life t
  const RAMP = [[0, 1, 1, 0.95], [0.15, 1, 0.95, 0.55], [0.35, 1, 0.55, 0.15], [0.6, 0.65, 0.12, 0.05], [1, 0.12, 0.1, 0.1]];
  function rampColor(out, t) {
    for (let i = 1; i < RAMP.length; i++) {
      if (t <= RAMP[i][0]) { const a = RAMP[i - 1], b = RAMP[i], p = (t - a[0]) / (b[0] - a[0]); return out.setRGB(a[1] + (b[1] - a[1]) * p, a[2] + (b[2] - a[2]) * p, a[3] + (b[3] - a[3]) * p); }
    }
    const L = RAMP[RAMP.length - 1]; return out.setRGB(L[1], L[2], L[3]);
  }
  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
  function spawnPuff(x, y, z, o) {
    const p = getPuff(o.additive !== false, o.smoke);
    p.position.set(x, y, z); p.material.rotation = Math.random() * 6.2832;
    p.scale.set(o.base, o.base, 1); p.material.opacity = 0; p.visible = (o.delay || 0) <= 0;
    puffs.push({
      s: p, age: -(o.delay || 0), life: o.life, base: o.base, pop: o.pop,
      x: x, y: y, z: z, vx: o.vx || 0, vy: o.vy || 0, vz: o.vz || 0,
      spin: o.spin || 0, rot: p.material.rotation,
      smoke: !!o.smoke, maxOp: o.maxOp == null ? 1 : o.maxOp,
      // smoke fades from charred-orange to dark grey as it cools
      shade: o.shade == null ? 0.16 : o.shade,
    });
  }
  function updatePuffs(dt) {
    for (let i = puffs.length - 1; i >= 0; i--) {
      const p = puffs[i]; p.age += dt;
      if (p.age < 0) continue;                 // still in its spawn delay
      p.s.visible = true;
      const t = p.age / p.life;
      if (t >= 1) { p.s.visible = false; puffPool.push(p.s); puffs.splice(i, 1); continue; }
      const sc = p.base + (p.pop - p.base) * easeOutCubic(t);
      p.s.scale.set(sc, sc, 1);
      if (p.spin) { p.rot += p.spin * dt; p.s.material.rotation = p.rot; }
      if (p.smoke) {
        // negative gravity: smoke rises, drifts, and slows as it expands/cools
        p.vy += 0.6 * dt; p.vx *= (1 - 0.5 * dt); p.vz *= (1 - 0.5 * dt);
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        p.s.position.set(p.x, p.y, p.z);
        // first instant glows hot from the dying fireball, then darkens to soot
        const heat = Math.max(0, 1 - t * 4);
        const g = p.shade;
        p.s.material.color.setRGB(g + heat * 0.55, g + heat * 0.18, g);
        // smoke fades IN then slowly OUT (lingers): ease in over first 25%
        const fade = t < 0.25 ? t / 0.25 : 1 - (t - 0.25) / 0.75;
        p.s.material.opacity = Math.max(0, fade * p.maxOp);
      } else {
        // flame puffs drift outward a touch and ramp white->yellow->orange->red
        if (p.vx || p.vy || p.vz) { p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; p.s.position.set(p.x, p.y, p.z); }
        p.s.material.opacity = Math.max(0, (t < 0.1 ? t / 0.1 : 1 - (t - 0.1) / 0.9) * p.maxOp);
        rampColor(p.s.material.color, t);
      }
    }
  }

  CBZ.cityCrashFX = function (x, z, opts) {
    opts = opts || {};
    const speed = opts.speed || 8;
    const hard = !!opts.hard, catastrophic = !!opts.catastrophic;
    const dir = opts.dir || null;   // downrange impact direction, for biased debris
    if ((hard || catastrophic) && CBZ.cityEvent) CBZ.cityEvent("crash", { x, z, damage: catastrophic ? 6 : 2, panic: catastrophic ? 7 : 3 }, { silent: true, noWanted: true, throttle: 0.9 });
    // hot orange impact sparks (additive) that shoot out fast and die quick
    pointBurst(x, z, catastrophic ? 58 : (hard ? 38 : 12), 0xff9a38, catastrophic ? 0.19 : 0.13, 2 + speed * 0.2, catastrophic ? 0.7 : 0.48, false);
    // a tight WHITE-hot spark spray at the contact point (metal grinding)
    pointBurst(x, z, catastrophic ? 30 : (hard ? 18 : 6), 0xfff0c0, 0.1, 4 + speed * 0.25, catastrophic ? 0.45 : 0.32, false);
    // kicked-up dust
    pointBurst(x, z, catastrophic ? 34 : (hard ? 22 : 8), 0x8b8175, catastrophic ? 0.44 : 0.3, 1 + speed * 0.07, catastrophic ? 0.9 : 0.62, true);
    // shattered GLASS — pale blue-white shimmering shards (additive twinkle)
    if (hard) pointBurst(x, z, catastrophic ? 30 : 16, 0xcfe6ff, 0.09, 3 + speed * 0.16, catastrophic ? 0.8 : 0.6, false);
    if (hard && CBZ.sfx) CBZ.sfx("glass");
    if (hard) {
      ring(x, z, catastrophic ? 7 : 4.5, catastrophic ? 0xffd08a : 0xffa14f, { opacity: catastrophic ? 0.7 : 0.55, spd: catastrophic ? 3 : 2.4, life: catastrophic ? 0.7 : 0.55 });
      addChunks(x, z, catastrophic ? 10 : 5, 2.5 + speed * 0.12, false, dir);
      addScorch(x, z, catastrophic ? 3 : 1.4, catastrophic ? 9 : 5);   // a scuff/skid stain even on a hard (non-fatal) wall hit
      if (catastrophic) {
        if (CBZ.shake) CBZ.shake(1.6);
        // a clutch of small lingering flames + a thin smoke wisp so a wrecked car
        // looks like it's actually cooking, not just sparking for a frame.
        for (let i = 0; i < 5; i++) {
          const a = Math.random() * 6.2832, rr = Math.random() * 1.1;
          spawnPuff(x + Math.cos(a) * rr, 0.45, z + Math.sin(a) * rr,
            { additive: true, base: 0.4, pop: 1.6 + Math.random() * 0.9, life: 1.1 + Math.random() * 0.9,
              maxOp: 0.85, spin: (Math.random() - 0.5) * 2, vy: 0.5 + Math.random() * 0.7,
              delay: Math.random() * 0.2 });
        }
        for (let i = 0; i < 4; i++) {
          const a = Math.random() * 6.2832, dr = 0.3 + Math.random() * 0.5;
          spawnPuff(x + (Math.random() - 0.5) * 1.2, 0.9 + Math.random() * 0.5, z + (Math.random() - 0.5) * 1.2,
            { additive: false, smoke: true, base: 1.2, pop: 4 + Math.random() * 2,
              life: 2.4 + Math.random() * 1.4, maxOp: 0.34, shade: 0.15, spin: (Math.random() - 0.5),
              vx: Math.cos(a) * dr, vy: 1.0 + Math.random() * 0.6, vz: Math.sin(a) * dr,
              delay: 0.15 + Math.random() * 0.3 });
        }
      }
    }
  };

  // a real EXPLOSION (super-fast car-on-car, grenades later, etc.): fireball +
  // smoke + shockwave + white flash + blast damage to everyone in radius. Reusable.
  CBZ.cityExplosion = function (x, z, opts) {
    opts = opts || {};
    const power = opts.power || 1, R = (opts.radius || 6) * power, byPlayer = !!opts.byPlayer;
    const P = Math.min(2.2, power);            // visual scale is clamped so huge blasts stay cheap
    // opts.y = detonation HEIGHT. A rocket that lands 30u up a tower face must
    // bloom THERE — not pop at the kerb below it (the filmed "dumb" hit). Every
    // ground-level caller passes no y and keeps the exact old seat; elevated
    // blasts skip the ground-coupled layers (rings/scorch/road-wash) and their
    // damage only reaches the street if the blast sphere actually does.
    const cy = opts.y != null ? Math.max(1.0, opts.y) : 1.0;
    const elevated = cy > 3;

    // ---- LAYER 1: FLASH (t=0) — a blinding white-hot core that snaps in and
    // dies in ~0.1s; this is the muzzle of the blast that backlights everything.
    spawnPuff(x, cy + 0.3, z, { additive: true, base: 7 * P, pop: 7.5 * P, life: 0.1, maxOp: 1 });
    spawnPuff(x, cy + 0.3, z, { additive: true, base: 1, pop: 4.5 * P, life: 0.22, maxOp: 1 }); // bright inner pop

    // ---- LAYER 2: FIREBALL — a cluster of soft additive puffs that punch
    // outward and ramp white→yellow→orange→deep-red. Overlap sums toward
    // white-hot in the middle; outer puffs drift out a little for a roiling rim.
    const nFire = Math.round(14 * P);
    for (let i = 0; i < nFire; i++) {
      const a = Math.random() * 6.2832, rr = Math.random() * 0.9 * P, sp = (1.0 + Math.random() * 2.2);
      spawnPuff(x + Math.cos(a) * rr, cy + (Math.random() - 0.15) * P, z + Math.sin(a) * rr,
        { additive: true, base: 0.6, pop: (3.4 + Math.random() * 1.8) * P, life: 0.7 + Math.random() * 0.75,
          maxOp: 1, spin: (Math.random() - 0.5) * 3,
          vx: Math.cos(a) * sp, vy: 0.4 + Math.random() * 1.2, vz: Math.sin(a) * sp });
    }
    // a few low fireballs that hug the ground (blast spreading along the road —
    // meaningless 30u up a facade, so elevated blasts skip the road wash)
    if (!elevated) for (let i = 0; i < Math.round(5 * P); i++) {
      const a = Math.random() * 6.2832, sp = 3 + Math.random() * 4 * P;
      spawnPuff(x, 0.55, z, { additive: true, base: 0.5, pop: (2.2 + Math.random()) * P, life: 0.5 + Math.random() * 0.45,
        maxOp: 0.9, vx: Math.cos(a) * sp, vy: 0.2, vz: Math.sin(a) * sp });
    }
    // lingering FLAMES that keep licking up from the blast seat for a beat
    // after the fireball collapses — sells a "still burning" crater cheaply.
    for (let i = 0; i < Math.round(4 * P); i++) {
      const a = Math.random() * 6.2832, rr = Math.random() * 0.7 * P;
      spawnPuff(x + Math.cos(a) * rr, elevated ? cy - 0.4 : 0.5, z + Math.sin(a) * rr,
        { additive: true, base: 0.4, pop: (1.4 + Math.random() * 0.8) * P, life: 1.0 + Math.random() * 0.8,
          maxOp: 0.85, spin: (Math.random() - 0.5) * 2, vy: 0.6 + Math.random() * 0.7,
          delay: 0.12 + Math.random() * 0.25 });
    }

    // ---- LAYER 3: SMOKE — lumpy dark plume that emerges as the flame cools,
    // RISES (negative gravity), drifts, expands and LINGERS the longest. Two
    // densities: a tall central column + wider low billows for volume.
    const nSmoke = Math.round(6 * P);
    for (let i = 0; i < nSmoke; i++) {
      const a = Math.random() * 6.2832, dr = 0.4 + Math.random() * 0.6;
      spawnPuff(x + (Math.random() - 0.5) * 1.4 * P, cy + 0.3 + Math.random() * 0.6, z + (Math.random() - 0.5) * 1.4 * P,
        { additive: false, smoke: true, base: 1.6, pop: (5.5 + Math.random() * 3) * P,
          life: 2.6 + Math.random() * 1.8, maxOp: 0.42, shade: 0.13 + Math.random() * 0.06,
          spin: (Math.random() - 0.5) * 1.2,
          vx: Math.cos(a) * dr, vy: 1.1 + Math.random() * 0.8, vz: Math.sin(a) * dr,
          delay: 0.08 + Math.random() * 0.18 });
    }
    // low rolling billows that spread outward at the base (ground blasts only)
    if (!elevated) for (let i = 0; i < Math.round(4 * P); i++) {
      const a = Math.random() * 6.2832, sp = 1.4 + Math.random() * 1.6;
      spawnPuff(x, 0.6, z, { additive: false, smoke: true, base: 1.2, pop: (4 + Math.random() * 2) * P,
        life: 2.2 + Math.random() * 1.3, maxOp: 0.3, shade: 0.15, spin: (Math.random() - 0.5),
        vx: Math.cos(a) * sp, vy: 0.4 + Math.random() * 0.5, vz: Math.sin(a) * sp, delay: 0.05 + Math.random() * 0.12 });
    }

    // ---- LAYER 4: SHOCKWAVE — a fast thin bright additive ring on the ground
    // that races out JUST AFTER the flash, plus a slower glowing hot rim.
    // (an elevated blast never touched the road — no ground ring/scorch)
    if (!elevated) {
      ring(x, z, R * 1.15, 0xffe7b0, { additive: true, opacity: 0.85, inner: 1.05, spd: 5.0, life: 0.42, flat: true, y: 0.06, r0: 0.6 });
      ring(x, z, R, 0xffb05a, { additive: true, opacity: 0.6, inner: 0.78, spd: 2.4, life: 0.55, y: 0.1 });
    }

    // ---- LAYER 5: SPARKS + EMBERS + DEBRIS (nearest layer) ----
    pointBurst(x, z, Math.round(28 * P), 0xffe08a, 0.16, 9 + 7 * power, 0.6, false, elevated ? cy : null); // fast bright sparks
    // glowing embers that arc up and rain down, lingering longer than sparks
    const nEmber = Math.round(16 * P);
    for (let i = 0; i < nEmber; i++) {
      const a = Math.random() * 6.2832, sp = 1.5 + Math.random() * 3.5 * P;
      spawnPuff(x + Math.cos(a) * 0.5, cy + Math.random() * 0.8, z + Math.sin(a) * 0.5,
        { additive: true, base: 0.18 + Math.random() * 0.16, pop: 0.1, life: 1.0 + Math.random() * 1.1,
          maxOp: 1, vx: Math.cos(a) * sp, vy: 3 + Math.random() * 4, vz: Math.sin(a) * sp });
    }
    addChunks(x, z, Math.round(10 * P), 6 + 5 * power, true, null, elevated ? cy : null); // chunky glowing debris
    if (!elevated) addScorch(x, z, R * 0.5);                           // lasting ground scorch

    // ---- IMPACT FEEDBACK: sound, shake, slow-mo, screen flash. Shake/stop
    // scale with how close the blast is to the LENS — a rocket at your feet
    // rattles the camera, one landing 120u up a tower only rumbles. ----
    if (CBZ.sfx) CBZ.sfx("explosion");
    let att = 1;
    const cam = CBZ.camera;
    if (cam && cam.position) {
      const cd = Math.hypot(x - cam.position.x, cy - cam.position.y, z - cam.position.z);
      att = Math.max(0.25, Math.min(1, 1.25 - cd / 130));
    }
    if (CBZ.shake) CBZ.shake(3.2 * Math.min(2, power) * att);
    if (CBZ.doSlowmo && att > 0.5) CBZ.doSlowmo(0.34);
    if (CBZ.doHitstop && att > 0.5) CBZ.doHitstop(0.18);
    try { const fl = CBZ.el && CBZ.el.flash; if (fl && att > 0.4) { fl.classList.remove("go"); void fl.offsetWidth; fl.classList.add("go"); } } catch (e) {}
    // blast damage in radius — crowd, peds, cops, and the player (shared path).
    // An elevated blast only reaches the street where its SPHERE does: the
    // ground footprint shrinks with height (and vanishes past the radius).
    if (!opts.noDamage) {
      const drop = elevated ? cy - 1.2 : 0;   // height above a standing chest
      const gR = elevated ? Math.sqrt(Math.max(0, R * R - drop * drop)) : R;
      if (gR > 0.4) applyBlastDamage(x, z, gR, power, byPlayer);
    }
    if (CBZ.cityEvent) CBZ.cityEvent("explosion", { x: x, z: z, panic: 10 * power, damage: 8 * power }, { silent: true, noWanted: true });
  };

  // Shared blast-damage application — the SAME path cityExplosion always used:
  // crowd circle-kill, peds, cops, and the player, scaled by distance/power.
  // Both cityExplosion and cityAirstrikeExplosion route through this so they hurt
  // people identically. (force/fling let an airstrike fling bodies harder.)
  function applyBlastDamage(x, z, R, power, byPlayer, force, fling) {
    force = force == null ? 9 : force; fling = fling == null ? 6 : fling;
    if (CBZ.cityCrowdCircleKill) CBZ.cityCrowdCircleKill(x, z, R, { byCar: true, quiet: true, fromX: x, fromZ: z, noCrime: !byPlayer });
    for (const p of (CBZ.cityPeds || [])) { if (p.dead) continue; const dx = p.pos.x - x, dz = p.pos.z - z; if (dx * dx + dz * dz <= R * R && CBZ.cityKillPed) CBZ.cityKillPed(p, { fromX: x, fromZ: z, force: force, fling: fling, byPlayer: byPlayer }, "explosion"); }
    for (const c of (CBZ.cityCops || [])) { if (c.dead) continue; const dx = c.pos.x - x, dz = c.pos.z - z; if (dx * dx + dz * dz <= R * R && CBZ.cityHurtCop) CBZ.cityHurtCop(c, 9999, { fromX: x, fromZ: z, force: force, fling: fling, byPlayer: byPlayer }); }
    const PL = CBZ.player;
    if (PL && !PL.dead) { const dx = PL.pos.x - x, dz = PL.pos.z - z, d2 = dx * dx + dz * dz; if (d2 < R * R) { const dmg = Math.round(85 * power * (1 - Math.sqrt(d2) / (R + 0.01))); if (dmg > 0 && CBZ.cityHurtPlayer) CBZ.cityHurtPlayer(dmg, x, z, "caught in an explosion", false, null, false); } }
  }

  // ============================================================
  // AIRSTRIKE / MISSILE blast — a BIGGER, LONGER, taller variant of
  // cityExplosion for incoming missiles and called-in airstrikes. Same pooled
  // sprite system, same shared damage path; just dialed up: a larger white-hot
  // fireball that balloons up into a mushroom head, a tall lingering black smoke
  // COLUMN, more debris + sparks, a heavier shake and a touch more slow-mo.
  // opts: { power, radius, byPlayer, y } — y = optional detonation height (air-burst).
  // ============================================================
  CBZ.cityAirstrikeExplosion = function (x, z, opts) {
    opts = opts || {};
    const power = opts.power || 2, R = (opts.radius || 12) * power, byPlayer = !!opts.byPlayer;
    const P = Math.min(4.6, power * 1.35);     // bigger visual ceiling than a car blast (airstrike = huge)
    // detonation seat: air-bursts (missile caught a wall) sit higher, ground hits low
    const seat = Math.max(0, (opts.y || 0));
    const cy = 1.2 + seat * 0.5;

    // ---- FLASH: a huge blinding white-hot core, brighter + a beat longer ----
    spawnPuff(x, cy + 0.3, z, { additive: true, base: 10 * P, pop: 11 * P, life: 0.14, maxOp: 1 });
    spawnPuff(x, cy + 0.3, z, { additive: true, base: 1.5, pop: 7 * P, life: 0.3, maxOp: 1 });

    // ---- FIREBALL: a dense cluster that punches out then BALLOONS upward into a
    // mushroom head (buoyant rise). White→yellow→orange→deep-red, longer life. ----
    const nFire = Math.round(22 * P);
    for (let i = 0; i < nFire; i++) {
      const a = Math.random() * 6.2832, rr = Math.random() * 1.2 * P, sp = (1.4 + Math.random() * 3.0);
      spawnPuff(x + Math.cos(a) * rr, cy + (Math.random() - 0.1) * 1.4 * P, z + Math.sin(a) * rr,
        { additive: true, base: 0.8, pop: (4.2 + Math.random() * 2.4) * P, life: 1.0 + Math.random() * 1.0,
          maxOp: 1, spin: (Math.random() - 0.5) * 3,
          vx: Math.cos(a) * sp, vy: 1.0 + Math.random() * 2.4, vz: Math.sin(a) * sp });
    }
    // the rising MUSHROOM HEAD — a few big slow fireballs that climb and bloom
    for (let i = 0; i < Math.round(5 * P); i++) {
      const a = Math.random() * 6.2832, dr = 0.4 + Math.random() * 0.7;
      spawnPuff(x + Math.cos(a) * dr * P, cy + 1.2 * P, z + Math.sin(a) * dr * P,
        { additive: true, base: 1.2, pop: (5 + Math.random() * 3) * P, life: 1.3 + Math.random() * 0.9,
          maxOp: 1, spin: (Math.random() - 0.5) * 1.5,
          vx: Math.cos(a) * 0.8, vy: 3.2 + Math.random() * 2.2, vz: Math.sin(a) * 0.8,
          delay: 0.05 + Math.random() * 0.12 });
    }
    // low fireballs spreading along the ground (blast wash)
    for (let i = 0; i < Math.round(8 * P); i++) {
      const a = Math.random() * 6.2832, sp = 4 + Math.random() * 6 * P;
      spawnPuff(x, 0.6, z, { additive: true, base: 0.6, pop: (2.6 + Math.random() * 1.4) * P, life: 0.6 + Math.random() * 0.5,
        maxOp: 0.9, vx: Math.cos(a) * sp, vy: 0.25, vz: Math.sin(a) * sp });
    }
    // lingering flames cooking in the crater after the fireball collapses
    for (let i = 0; i < Math.round(7 * P); i++) {
      const a = Math.random() * 6.2832, rr = Math.random() * 1.0 * P;
      spawnPuff(x + Math.cos(a) * rr, 0.5, z + Math.sin(a) * rr,
        { additive: true, base: 0.5, pop: (1.8 + Math.random() * 1.1) * P, life: 1.4 + Math.random() * 1.1,
          maxOp: 0.88, spin: (Math.random() - 0.5) * 2, vy: 0.6 + Math.random() * 0.8,
          delay: 0.15 + Math.random() * 0.35 });
    }

    // ---- SMOKE: a tall black COLUMN — many puffs with strong upward velocity and
    // long life so the plume towers and lingers, plus wide low billows for girth. ----
    const nSmoke = Math.round(10 * P);
    for (let i = 0; i < nSmoke; i++) {
      const a = Math.random() * 6.2832, dr = 0.3 + Math.random() * 0.6;
      spawnPuff(x + (Math.random() - 0.5) * 1.6 * P, cy + 0.4 + Math.random() * 1.0, z + (Math.random() - 0.5) * 1.6 * P,
        { additive: false, smoke: true, base: 1.8, pop: (6.5 + Math.random() * 3.5) * P,
          life: 4.2 + Math.random() * 2.6, maxOp: 0.5, shade: 0.1 + Math.random() * 0.05,
          spin: (Math.random() - 0.5) * 1.0,
          vx: Math.cos(a) * dr, vy: 2.2 + Math.random() * 1.6, vz: Math.sin(a) * dr,
          delay: 0.06 + Math.random() * 0.2 });
    }
    // the column's upper reaches — slower, darker, the longest-lived smoke
    for (let i = 0; i < Math.round(5 * P); i++) {
      spawnPuff(x + (Math.random() - 0.5) * 1.0 * P, cy + 2.0 + Math.random() * 1.5, z + (Math.random() - 0.5) * 1.0 * P,
        { additive: false, smoke: true, base: 2.2, pop: (7 + Math.random() * 3) * P,
          life: 5.0 + Math.random() * 3.0, maxOp: 0.42, shade: 0.09,
          spin: (Math.random() - 0.5) * 0.8, vy: 1.6 + Math.random() * 1.2,
          delay: 0.25 + Math.random() * 0.5 });
    }
    // wide low billows rolling out at the base
    for (let i = 0; i < Math.round(6 * P); i++) {
      const a = Math.random() * 6.2832, sp = 1.8 + Math.random() * 2.2;
      spawnPuff(x, 0.7, z, { additive: false, smoke: true, base: 1.4, pop: (5 + Math.random() * 2.5) * P,
        life: 3.0 + Math.random() * 1.6, maxOp: 0.34, shade: 0.14, spin: (Math.random() - 0.5),
        vx: Math.cos(a) * sp, vy: 0.5 + Math.random() * 0.6, vz: Math.sin(a) * sp, delay: 0.05 + Math.random() * 0.15 });
    }

    // ---- SHOCKWAVE: a bigger, faster bright ground ring + a slower glowing rim ----
    ring(x, z, R * 1.2, 0xffe7b0, { additive: true, opacity: 0.9, inner: 1.05, spd: 6.0, life: 0.5, flat: true, y: 0.06, r0: 0.7 });
    ring(x, z, R, 0xffb05a, { additive: true, opacity: 0.65, inner: 0.78, spd: 2.8, life: 0.7, y: 0.1 });
    ring(x, z, R * 0.7, 0xfff2cc, { additive: true, opacity: 0.7, inner: 0.9, spd: 7.5, life: 0.4, flat: true, y: 0.08, r0: 0.5 });

    // ---- SPARKS + EMBERS + DEBRIS ----
    pointBurst(x, z, Math.round(40 * P), 0xffe08a, 0.18, 12 + 8 * power, 0.7, false); // fast bright sparks
    pointBurst(x, z, Math.round(20 * P), 0xfff0c0, 0.12, 16 + 9 * power, 0.5, false); // white-hot spray
    pointBurst(x, z, Math.round(26 * P), 0x8b8175, 0.5, 2 + power * 0.4, 1.1, true);  // big dust kick-up
    const nEmber = Math.round(26 * P);
    for (let i = 0; i < nEmber; i++) {
      const a = Math.random() * 6.2832, sp = 2 + Math.random() * 5 * P;
      spawnPuff(x + Math.cos(a) * 0.6, cy + Math.random() * 1.0, z + Math.sin(a) * 0.6,
        { additive: true, base: 0.2 + Math.random() * 0.18, pop: 0.1, life: 1.3 + Math.random() * 1.4,
          maxOp: 1, vx: Math.cos(a) * sp, vy: 4 + Math.random() * 6, vz: Math.sin(a) * sp });
    }
    addChunks(x, z, Math.round(18 * P), 9 + 7 * power, true);   // lots of chunky glowing debris
    addScorch(x, z, R * 0.55, 16);                              // big, long-lasting crater scorch

    // ---- IMPACT FEEDBACK: bigger boom, harder shake, more slow-mo, screen flash --
    if (CBZ.sfx) CBZ.sfx("explosion");
    if (CBZ.shake) CBZ.shake(5.5 * Math.min(2.4, power));
    if (CBZ.doSlowmo) CBZ.doSlowmo(0.5);
    if (CBZ.doHitstop) CBZ.doHitstop(0.26);
    try { const fl = CBZ.el && CBZ.el.flash; if (fl) { fl.classList.remove("go"); void fl.offsetWidth; fl.classList.add("go"); } } catch (e) {}

    // blast damage — SAME shared path as cityExplosion, just flings bodies harder
    applyBlastDamage(x, z, R, power, byPlayer, 14, 10);
    if (CBZ.cityEvent) CBZ.cityEvent("explosion", { x: x, z: z, panic: 14 * power, damage: 10 * power }, { silent: true, noWanted: true });
  };

  // ============================================================
  // RPG ON A BUILDING — the facade REACTS at the impact point (owner filmed a
  // rocket hit a tower and "a few windows popped"). CBZ.cityBlastWall(pt, n, o)
  // composes, at pt on a wall face with outward normal n:
  //   1) a big blackened BLAST SCAR decal (pooled, 2–4u, the scorch gradient)
  //      stamped on the face — the building remembers the rocket like walls
  //      remember 7.62 (gunfx bullet pocks),
  //   2) a debris AVALANCHE: concrete chunks + a sheet of pale dust cascading
  //      DOWN the facade from the wound (shared chunk pool, downward bias),
  //   3) a LINGERING smoke column seeping from the wound for 60–90s (pooled
  //      sprite emitter ~2/s — the show-off plume reads across the district),
  //   4) near the roofline: ONE parapet block knocked loose, tumbling the whole
  //      way down (collider tops locate the roof).
  // Ground-floor hits still breach (buildings.js cityBreach) — this layers on.
  // ============================================================
  const scars = [], wounds = [];
  const SCAR_CAP = 8;
  const _scarZ = new THREE.Vector3(0, 0, 1);
  const _scarN = new THREE.Vector3();
  function addWallScar(x, y, z, nx, ny, nz, size) {
    if (!scorchTex) scorchTex = makeScorchTexture();
    while (scars.length >= SCAR_CAP) { const o = scars.shift(); scene.remove(o.mesh); o.mat.dispose(); }
    const mat = new THREE.MeshBasicMaterial({
      map: scorchTex, transparent: true, opacity: 0, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    });
    const mesh = new THREE.Mesh(scorchGeo, mat);
    _scarN.set(nx, ny, nz);
    if (_scarN.lengthSq() < 1e-6) _scarN.set(0, 0, 1); else _scarN.normalize();
    mesh.quaternion.setFromUnitVectors(_scarZ, _scarN);
    mesh.rotateZ(Math.random() * Math.PI * 2);
    mesh.position.set(x + _scarN.x * 0.08, y + _scarN.y * 0.08, z + _scarN.z * 0.08);
    mesh.scale.set(size, size, 1);
    mesh.renderOrder = 3;
    scene.add(mesh);
    scars.push({ mesh, mat, t: 0, hold: 80 + Math.random() * 40 });
  }

  // debris + dust knocked off the face, biased DOWN the wall (an avalanche,
  // not the radial fountain a ground blast throws). tangent = along the wall.
  function facadeAvalanche(x, y, z, nx, nz, power) {
    let tx = -nz, tz = nx;
    const tl = Math.hypot(tx, tz);
    if (tl < 1e-4) { tx = 1; tz = 0; } else { tx /= tl; tz /= tl; }
    while (chunks.length > 56) { const old = chunks.shift(); scene.remove(old.mesh); }
    const n = Math.round(7 + 5 * power);
    const fall = Math.sqrt(Math.max(0.5, y) / 8.8);   // time to reach the street under chunk gravity
    for (let i = 0; i < n; i++) {
      const glow = Math.random() < 0.25;
      const mesh = new THREE.Mesh(chunkGeo, glow ? chunkMatHot : chunkMat);
      const along = (Math.random() - 0.5) * 2.4;
      mesh.position.set(x + tx * along + nx * 0.3, y + (Math.random() - 0.3) * 1.6, z + tz * along + nz * 0.3);
      mesh.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      mesh.scale.setScalar(0.7 + Math.random() * 1.1);
      scene.add(mesh);
      chunks.push({
        mesh,
        vx: nx * (0.8 + Math.random() * 2.4) + tx * (Math.random() - 0.5) * 3,
        vy: 0.5 - Math.random() * 3,                  // DOWNWARD bias — it pours off the wound
        vz: nz * (0.8 + Math.random() * 2.4) + tz * (Math.random() - 0.5) * 3,
        spin: (Math.random() - 0.5) * 14, t: 0, life: fall + 1.3 + Math.random() * 0.9,
        trail: glow ? 0 : -1,
      });
    }
    // pale concrete dust sheeting down the face below the wound, staggered so
    // it visibly CASCADES instead of appearing all at once
    const drop = Math.min(Math.max(2, y - 0.5), 14);
    const nd = Math.round(7 + 4 * power);
    for (let i = 0; i < nd; i++) {
      const f = i / nd;
      spawnPuff(x + tx * (Math.random() - 0.5) * 2 + nx * 0.5, y - f * drop, z + tz * (Math.random() - 0.5) * 2 + nz * 0.5, {
        additive: false, smoke: true, base: 1.0, pop: 3.2 + Math.random() * 2.2,
        life: 1.7 + Math.random(), maxOp: 0.42, shade: 0.4 + Math.random() * 0.08,
        spin: (Math.random() - 0.5),
        vx: nx * 0.7 + tx * (Math.random() - 0.5), vy: -(1.5 + Math.random() * 2.5), vz: nz * 0.7 + tz * (Math.random() - 0.5),
        delay: f * 0.5 + Math.random() * 0.08,
      });
    }
  }
  // fracture.js pours wall-hole debris through this same pooled cascade
  CBZ.cityFacadeAvalanche = facadeAvalanche;

  function addBlastWound(x, y, z, nx, ny, nz, dur) {
    while (wounds.length >= 3) wounds.shift();   // 3 live wounds max — the oldest stops smoking
    wounds.push({ x, y, z, nx, ny, nz, t: 0, dur, acc: 0.2 });
  }

  function parapetChunk(x, topY, z, nx, nz) {
    while (chunks.length > 56) { const old = chunks.shift(); scene.remove(old.mesh); }
    const mesh = new THREE.Mesh(chunkGeo, chunkMat);
    mesh.scale.set(4 + Math.random() * 2.5, 3 + Math.random() * 2, 4 + Math.random() * 2.5);  // a ~1.2–1.8u coping block
    mesh.position.set(x + nx * 0.8, topY + 0.5, z + nz * 0.8);
    mesh.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    scene.add(mesh);
    chunks.push({
      mesh, vx: nx * (1.5 + Math.random() * 2), vy: 1.2 + Math.random() * 1.5, vz: nz * (1.5 + Math.random() * 2),
      spin: (Math.random() - 0.5) * 6, t: 0, life: Math.sqrt(Math.max(1, topY) / 8.8) + 2.2, trail: -1,
    });
  }

  CBZ.cityBlastWall = function (pt, normal, opts) {
    opts = opts || {};
    if (!CBZ.game || CBZ.game.mode !== "city") return;
    const power = Math.min(2.4, opts.power || 1.4);
    const x = pt.x, y = Math.max(0.6, pt.y || 0), z = pt.z;
    let nx = normal ? normal.x : 0, ny = normal ? normal.y : 0, nz = normal ? normal.z : 1;
    const nl = Math.hypot(nx, ny, nz);
    if (nl < 1e-4) { nx = 0; ny = 0; nz = 1; } else { nx /= nl; ny /= nl; nz /= nl; }
    const roof = ny > 0.6;
    // (1) the blackened scar — 2–4u with the round's power
    addWallScar(x, y, z, nx, ny, nz, 2.2 + power * 0.85);
    // (2) avalanche down the facade (roof hits just scatter debris on the deck)
    if (roof) addChunks(x, z, Math.round(5 + 4 * power), 3.5, false, null, y);
    else facadeAvalanche(x, y, z, nx, nz, power);
    // a breath of concrete dust out of the wound itself
    pointBurst(x, z, Math.round(16 + 10 * power), 0x9a9082, 0.42, 3.5 + power, 1.0, true, y);
    // (3) the wound smokes for a minute-plus — visible across the district
    addBlastWound(x, y, z, nx, ny, nz, 60 + Math.random() * 30);
    // (4) a hit near the roofline knocks a parapet block loose. Collider tops
    // under the impact point locate the roof (the same wall AABBs cityScorch /
    // cityBreach search).
    let topY = -1;
    const cols = CBZ.colliders || [];
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i];
      if (c.y1 == null) continue;
      if (x < c.minX - 0.9 || x > c.maxX + 0.9 || z < c.minZ - 0.9 || z > c.maxZ + 0.9) continue;
      if (c.y1 > topY) topY = c.y1;
    }
    if (topY > 7 && (roof || y > topY - 3.2)) {
      let px = nx, pz = nz;
      if (Math.hypot(px, pz) < 0.3) { const a = Math.random() * 6.2832; px = Math.cos(a); pz = Math.sin(a); }
      parapetChunk(x, topY, z, px, pz);
    }
  };

  // fresh run → cold facades (fpsmode's reset path calls this with the pocks)
  CBZ.cityBlastFxReset = function () {
    wounds.length = 0;
    for (const s of scars) { scene.remove(s.mesh); s.mat.dispose(); }
    scars.length = 0;
  };

  CBZ.onAlways(9.5, function (dt) {
    if (puffs.length) updatePuffs(dt);
    // wall-blast scars: snap in, hold ~80–120s, fade out
    for (let i = scars.length - 1; i >= 0; i--) {
      const s = scars[i]; s.t += dt;
      if (s.t < 0.2) s.mat.opacity = (s.t / 0.2) * 0.95;
      else if (s.t < s.hold) s.mat.opacity = 0.95;
      else {
        s.mat.opacity = Math.max(0, 0.95 * (1 - (s.t - s.hold) / 8));
        if (s.t - s.hold >= 8) { scene.remove(s.mesh); s.mat.dispose(); scars.splice(i, 1); }
      }
    }
    // wounded facades keep smoking: ~2 puffs/s drifting up + out of the hole,
    // thinning as the wound cools; the first beats still cook with flame licks
    for (let i = wounds.length - 1; i >= 0; i--) {
      const w = wounds[i]; w.t += dt;
      if (w.t >= w.dur) { wounds.splice(i, 1); continue; }
      w.acc -= dt;
      if (w.acc > 0) continue;
      w.acc = 0.45 + Math.random() * 0.35;
      const cool = 1 - w.t / w.dur;
      spawnPuff(w.x + w.nx * 0.6 + (Math.random() - 0.5) * 0.5, w.y + 0.3, w.z + w.nz * 0.6 + (Math.random() - 0.5) * 0.5, {
        additive: false, smoke: true, base: 0.9, pop: (3.2 + Math.random() * 2.2) * (0.55 + 0.45 * cool),
        life: 3.6 + Math.random() * 1.6, maxOp: 0.32 * (0.45 + 0.55 * cool), shade: 0.12 + Math.random() * 0.04,
        spin: (Math.random() - 0.5) * 0.8,
        vx: w.nx * (0.5 + Math.random() * 0.4) + (Math.random() - 0.5) * 0.3,
        vy: 1.1 + Math.random() * 0.8,
        vz: w.nz * (0.5 + Math.random() * 0.4) + (Math.random() - 0.5) * 0.3,
      });
      if (w.t < 6) spawnPuff(w.x + w.nx * 0.3, w.y, w.z + w.nz * 0.3, {
        additive: true, base: 0.35, pop: 1.1 + Math.random() * 0.7, life: 0.6 + Math.random() * 0.4,
        maxOp: 0.85, vy: 0.7, spin: (Math.random() - 0.5) * 2,
      });
    }
    const grav = (CBZ.TUNE && CBZ.TUNE.gravity) || 22;
    for (let i = bursts.length - 1; i >= 0; i--) {
      const b = bursts[i]; b.t += dt;
      for (let j = 0; j < b.pos.length; j += 3) {
        b.vel[j + 1] -= grav * (b.dust ? 0.16 : 0.65) * dt;
        b.pos[j] += b.vel[j] * dt; b.pos[j + 1] += b.vel[j + 1] * dt; b.pos[j + 2] += b.vel[j + 2] * dt;
      }
      b.geo.attributes.position.needsUpdate = true;
      b.mat.opacity = Math.max(0, (b.dust ? 0.5 : 0.95) * (1 - b.t / b.life));
      if (b.t >= b.life) { scene.remove(b.mesh); b.geo.dispose(); b.mat.dispose(); bursts.splice(i, 1); }
    }
    for (let i = rings.length - 1; i >= 0; i--) {
      const r = rings[i]; r.t += dt;
      // expand fast then ease out (shockwaves decelerate as energy dissipates)
      r.r += r.radius * (r.spd || 2.2) * dt * (1 - 0.5 * (r.t / r.life));
      r.mesh.scale.set(r.r, r.r, 1);
      r.mat.opacity = Math.max(0, (r.op0 || 0.72) * (1 - r.t / r.life));
      if (r.t >= r.life) { scene.remove(r.mesh); r.geo.dispose(); r.mat.dispose(); rings.splice(i, 1); }
    }
    for (let i = chunks.length - 1; i >= 0; i--) {
      const c = chunks[i]; c.t += dt; c.vy -= grav * 0.8 * dt; // mild gravity so shrapnel hangs
      c.mesh.position.x += c.vx * dt; c.mesh.position.y += c.vy * dt; c.mesh.position.z += c.vz * dt;
      c.mesh.rotation.x += c.spin * dt; c.mesh.rotation.z += c.spin * 0.7 * dt;
      if (c.mesh.position.y < 0.1) { c.mesh.position.y = 0.1; c.vy *= -0.25; c.vx *= 0.6; c.vz *= 0.6; c.spin *= 0.6; }
      // glowing shards drip a faint ember spark every so often as they fly
      if (c.trail >= 0 && c.t < 0.6) {
        c.trail += dt;
        if (c.trail > 0.06) { c.trail = 0; spawnPuff(c.mesh.position.x, c.mesh.position.y, c.mesh.position.z, { additive: true, base: 0.16, pop: 0.05, life: 0.35, maxOp: 0.9, vy: -1 }); }
      }
      if (c.t >= c.life) { scene.remove(c.mesh); chunks.splice(i, 1); }
    }
    for (let i = scorches.length - 1; i >= 0; i--) {
      const s = scorches[i]; s.t += dt;
      if (s.t < 0.25) s.mat.opacity = (s.t / 0.25) * 0.9;          // snap in with the blast
      else if (s.t < s.hold) s.mat.opacity = 0.9;                  // linger as a black mark
      else { s.mat.opacity = Math.max(0, 0.9 * (1 - (s.t - s.hold) / 3)); if (s.t - s.hold >= 3) { scene.remove(s.mesh); s.mat.dispose(); scorches.splice(i, 1); } }
    }
    // blood pools: spread out fast on impact, hold as a dark stain, then fade
    for (let i = splats.length - 1; i >= 0; i--) {
      const s = splats[i]; s.t += dt;
      const grow = Math.min(1, s.t / 0.5);                          // spread over the first half-second
      const r = s.r0 + (s.r1 - s.r0) * (1 - Math.pow(1 - grow, 3));
      s.mesh.scale.setScalar(r);
      if (s.t < 0.2) s.mat.opacity = (s.t / 0.2) * 0.92;            // snap in
      else if (s.t < s.hold) s.mat.opacity = 0.92;                 // linger
      else { s.mat.opacity = Math.max(0, 0.92 * (1 - (s.t - s.hold) / 4)); if (s.t - s.hold >= 4) { scene.remove(s.mesh); s.mat.dispose(); splats.splice(i, 1); } }
    }
  });
})();
