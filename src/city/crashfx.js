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

  function pointBurst(x, z, count, color, size, speed, life, dust) {
    const pos = new Float32Array(count * 3);
    const vel = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const o = i * 3, a = Math.random() * Math.PI * 2;
      const sp = speed * (0.35 + Math.random() * 0.8);
      pos[o] = x + (Math.random() - 0.5) * 0.8;
      pos[o + 1] = 0.35 + Math.random() * (dust ? 0.5 : 1.0);
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

  function addChunks(x, z, count, force, hot) {
    while (chunks.length > 56) {
      const old = chunks.shift();
      scene.remove(old.mesh);
    }
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      // mostly charred grey, a few glowing-hot shards on an explosion
      const glow = hot && Math.random() < 0.5;
      const mesh = new THREE.Mesh(chunkGeo, glow ? chunkMatHot : chunkMat);
      mesh.position.set(x, 0.4 + Math.random() * 0.8, z);
      mesh.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      mesh.scale.setScalar((0.65 + Math.random() * 0.8) * (hot ? 1.1 : 1));
      scene.add(mesh);
      // debris flies fast then arcs down under gravity (slightly damped so it
      // hangs a touch longer like AAA shrapnel), heavier shards thrown lower
      const up = hot ? (3 + Math.random() * 6) : (2 + Math.random() * 4);
      chunks.push({
        mesh, vx: Math.cos(a) * force * (0.4 + Math.random() * 1.0),
        vy: up, vz: Math.sin(a) * force * (0.4 + Math.random() * 1.0),
        spin: (Math.random() - 0.5) * 16, t: 0, life: 1.2 + Math.random() * 1.1,
        trail: glow ? 0 : -1, // glowing shards drip a tiny ember trail
      });
    }
  }

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
  function addScorch(x, z, radius) {
    if (!scorchTex) scorchTex = makeScorchTexture();
    while (scorches.length > 10) { const o = scorches.shift(); scene.remove(o.mesh); o.mesh.material.dispose(); }
    const mat = new THREE.MeshBasicMaterial({ map: scorchTex, transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    const mesh = new THREE.Mesh(scorchGeo, mat);
    mesh.rotation.x = -Math.PI / 2; mesh.rotation.z = Math.random() * 6.28;
    mesh.position.set(x, 0.045, z); mesh.scale.setScalar(radius * 2);
    mesh.renderOrder = 1; scene.add(mesh);
    scorches.push({ mesh, mat, t: 0, hold: 6 + Math.random() * 4, grow: 0 });
  }

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
    if ((hard || catastrophic) && CBZ.cityEvent) CBZ.cityEvent("crash", { x, z, damage: catastrophic ? 6 : 2, panic: catastrophic ? 7 : 3 }, { silent: true, noWanted: true, throttle: 0.9 });
    // hot orange impact sparks (additive) that shoot out fast and die quick
    pointBurst(x, z, catastrophic ? 54 : (hard ? 34 : 12), 0xff9a38, catastrophic ? 0.18 : 0.13, 2 + speed * 0.18, catastrophic ? 0.7 : 0.48, false);
    // a tight WHITE-hot spark spray at the contact point (metal grinding)
    pointBurst(x, z, catastrophic ? 26 : (hard ? 16 : 6), 0xfff0c0, 0.1, 4 + speed * 0.22, catastrophic ? 0.45 : 0.32, false);
    // kicked-up dust
    pointBurst(x, z, catastrophic ? 34 : (hard ? 22 : 8), 0x8b8175, catastrophic ? 0.44 : 0.3, 1 + speed * 0.07, catastrophic ? 0.9 : 0.62, true);
    // shattered GLASS — pale blue-white shimmering shards (additive twinkle)
    if (hard) pointBurst(x, z, catastrophic ? 30 : 16, 0xcfe6ff, 0.09, 3 + speed * 0.16, catastrophic ? 0.8 : 0.6, false);
    if (hard && CBZ.sfx) CBZ.sfx("glass");
    if (hard) {
      ring(x, z, catastrophic ? 7 : 4.5, catastrophic ? 0xffd08a : 0xffa14f, { opacity: catastrophic ? 0.7 : 0.55, spd: catastrophic ? 3 : 2.4, life: catastrophic ? 0.55 : 0.45 });
      addChunks(x, z, catastrophic ? 9 : 4, 2.5 + speed * 0.1, false);
      if (catastrophic) { addScorch(x, z, 3); if (CBZ.shake) CBZ.shake(1.6); }
    }
  };

  // a real EXPLOSION (super-fast car-on-car, grenades later, etc.): fireball +
  // smoke + shockwave + white flash + blast damage to everyone in radius. Reusable.
  CBZ.cityExplosion = function (x, z, opts) {
    opts = opts || {};
    const power = opts.power || 1, R = (opts.radius || 6) * power, byPlayer = !!opts.byPlayer;
    const P = Math.min(2.2, power);            // visual scale is clamped so huge blasts stay cheap
    const cy = 1.0;

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
        { additive: true, base: 0.6, pop: (3.4 + Math.random() * 1.8) * P, life: 0.42 + Math.random() * 0.5,
          maxOp: 1, spin: (Math.random() - 0.5) * 3,
          vx: Math.cos(a) * sp, vy: 0.4 + Math.random() * 1.2, vz: Math.sin(a) * sp });
    }
    // a few low fireballs that hug the ground (blast spreading along the road)
    for (let i = 0; i < Math.round(5 * P); i++) {
      const a = Math.random() * 6.2832, sp = 3 + Math.random() * 4 * P;
      spawnPuff(x, 0.55, z, { additive: true, base: 0.5, pop: (2.2 + Math.random()) * P, life: 0.3 + Math.random() * 0.3,
        maxOp: 0.9, vx: Math.cos(a) * sp, vy: 0.2, vz: Math.sin(a) * sp });
    }

    // ---- LAYER 3: SMOKE — lumpy dark plume that emerges as the flame cools,
    // RISES (negative gravity), drifts, expands and LINGERS the longest. Two
    // densities: a tall central column + wider low billows for volume.
    const nSmoke = Math.round(6 * P);
    for (let i = 0; i < nSmoke; i++) {
      const a = Math.random() * 6.2832, dr = 0.4 + Math.random() * 0.6;
      spawnPuff(x + (Math.random() - 0.5) * 1.4 * P, cy + 0.3 + Math.random() * 0.6, z + (Math.random() - 0.5) * 1.4 * P,
        { additive: false, smoke: true, base: 1.6, pop: (5.5 + Math.random() * 3) * P,
          life: 1.5 + Math.random() * 1.2, maxOp: 0.42, shade: 0.13 + Math.random() * 0.06,
          spin: (Math.random() - 0.5) * 1.2,
          vx: Math.cos(a) * dr, vy: 1.1 + Math.random() * 0.8, vz: Math.sin(a) * dr,
          delay: 0.08 + Math.random() * 0.18 });
    }
    // low rolling billows that spread outward at the base
    for (let i = 0; i < Math.round(4 * P); i++) {
      const a = Math.random() * 6.2832, sp = 1.4 + Math.random() * 1.6;
      spawnPuff(x, 0.6, z, { additive: false, smoke: true, base: 1.2, pop: (4 + Math.random() * 2) * P,
        life: 1.2 + Math.random() * 0.8, maxOp: 0.3, shade: 0.15, spin: (Math.random() - 0.5),
        vx: Math.cos(a) * sp, vy: 0.4 + Math.random() * 0.5, vz: Math.sin(a) * sp, delay: 0.05 + Math.random() * 0.12 });
    }

    // ---- LAYER 4: SHOCKWAVE — a fast thin bright additive ring on the ground
    // that races out JUST AFTER the flash, plus a slower glowing hot rim.
    ring(x, z, R * 1.15, 0xffe7b0, { additive: true, opacity: 0.85, inner: 1.05, spd: 5.0, life: 0.42, flat: true, y: 0.06, r0: 0.6 });
    ring(x, z, R, 0xffb05a, { additive: true, opacity: 0.6, inner: 0.78, spd: 2.4, life: 0.55, y: 0.1 });

    // ---- LAYER 5: SPARKS + EMBERS + DEBRIS (nearest layer) ----
    pointBurst(x, z, Math.round(28 * P), 0xffe08a, 0.16, 9 + 7 * power, 0.6, false); // fast bright sparks
    // glowing embers that arc up and rain down, lingering longer than sparks
    const nEmber = Math.round(16 * P);
    for (let i = 0; i < nEmber; i++) {
      const a = Math.random() * 6.2832, sp = 1.5 + Math.random() * 3.5 * P;
      spawnPuff(x + Math.cos(a) * 0.5, cy + Math.random() * 0.8, z + Math.sin(a) * 0.5,
        { additive: true, base: 0.18 + Math.random() * 0.16, pop: 0.1, life: 0.7 + Math.random() * 0.9,
          maxOp: 1, vx: Math.cos(a) * sp, vy: 3 + Math.random() * 4, vz: Math.sin(a) * sp });
    }
    addChunks(x, z, Math.round(10 * P), 6 + 5 * power, true);          // chunky glowing debris
    addScorch(x, z, R * 0.5);                                          // lasting ground scorch

    // ---- IMPACT FEEDBACK: sound, heavy shake, slow-mo, screen flash ----
    if (CBZ.sfx) CBZ.sfx("explosion");
    if (CBZ.shake) CBZ.shake(3.2 * Math.min(2, power));
    if (CBZ.doSlowmo) CBZ.doSlowmo(0.34);
    if (CBZ.doHitstop) CBZ.doHitstop(0.18);
    try { const fl = CBZ.el && CBZ.el.flash; if (fl) { fl.classList.remove("go"); void fl.offsetWidth; fl.classList.add("go"); } } catch (e) {}
    // blast damage in radius — crowd, peds, cops, and the player
    if (CBZ.cityCrowdCircleKill) CBZ.cityCrowdCircleKill(x, z, R, { byCar: true, quiet: true, fromX: x, fromZ: z, noCrime: !byPlayer });
    for (const p of (CBZ.cityPeds || [])) { if (p.dead) continue; const dx = p.pos.x - x, dz = p.pos.z - z; if (dx * dx + dz * dz <= R * R && CBZ.cityKillPed) CBZ.cityKillPed(p, { fromX: x, fromZ: z, force: 9, fling: 6, byPlayer: byPlayer }, "explosion"); }
    for (const c of (CBZ.cityCops || [])) { if (c.dead) continue; const dx = c.pos.x - x, dz = c.pos.z - z; if (dx * dx + dz * dz <= R * R && CBZ.cityHurtCop) CBZ.cityHurtCop(c, 9999, { fromX: x, fromZ: z, force: 9, fling: 6, byPlayer: byPlayer }); }
    const PL = CBZ.player;
    if (PL && !PL.dead) { const dx = PL.pos.x - x, dz = PL.pos.z - z, d2 = dx * dx + dz * dz; if (d2 < R * R) { const dmg = Math.round(85 * power * (1 - Math.sqrt(d2) / (R + 0.01))); if (dmg > 0 && CBZ.cityHurtPlayer) CBZ.cityHurtPlayer(dmg, x, z, "caught in an explosion", false, null, false); } }
    if (CBZ.cityEvent) CBZ.cityEvent("explosion", { x: x, z: z, panic: 10 * power, damage: 8 * power }, { silent: true, noWanted: true });
  };

  CBZ.onAlways(9.5, function (dt) {
    if (puffs.length) updatePuffs(dt);
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
  });
})();
