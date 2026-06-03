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
  const bursts = [], rings = [], chunks = [];
  const chunkGeo = new THREE.BoxGeometry(0.28, 0.18, 0.42);
  chunkGeo._shared = true;
  const chunkMat = new THREE.MeshLambertMaterial({ color: 0x3c4148 });
  chunkMat._shared = true;

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

  function ring(x, z, radius, color) {
    const geo = new THREE.RingGeometry(0.7, 1.3, 30);
    const mat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.72, depthWrite: false, side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, 0.08, z);
    mesh.renderOrder = 7;
    scene.add(mesh);
    rings.push({ mesh, geo, mat, radius, r: 1, t: 0, life: 0.5 });
  }

  function addChunks(x, z, count, force) {
    while (chunks.length > 48) {
      const old = chunks.shift();
      scene.remove(old.mesh);
    }
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const mesh = new THREE.Mesh(chunkGeo, chunkMat);
      mesh.position.set(x, 0.4 + Math.random() * 0.8, z);
      mesh.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      mesh.scale.setScalar(0.65 + Math.random() * 0.8);
      scene.add(mesh);
      chunks.push({
        mesh, vx: Math.cos(a) * force * (0.4 + Math.random() * 0.8),
        vy: 2 + Math.random() * 4, vz: Math.sin(a) * force * (0.4 + Math.random() * 0.8),
        spin: (Math.random() - 0.5) * 12, t: 0, life: 1.1 + Math.random() * 0.9,
      });
    }
  }

  // ---- soft additive FIREBALL sprites (the good-looking explosion) ----
  // One shared 64px radial-gradient texture (white core → transparent rim) used
  // by every pooled sprite; additive blending sums overlaps toward white-hot.
  const puffs = [], _ecol = new THREE.Color();
  let puffPool = [], puffTex = null;
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
  function getPuff(additive) {
    if (!puffTex) puffTex = makePuffTexture();
    let p = puffPool.pop();
    if (!p) {
      const m = new THREE.SpriteMaterial({ map: puffTex, depthWrite: false, depthTest: true, transparent: true, opacity: 0 });
      p = new THREE.Sprite(m); p.renderOrder = 9; scene.add(p);
    }
    p.material.blending = additive ? THREE.AdditiveBlending : THREE.NormalBlending;
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
    const p = getPuff(o.additive !== false);
    p.position.set(x, y, z); p.material.rotation = Math.random() * 6.2832;
    p.scale.set(o.base, o.base, 1); p.material.opacity = 0; p.visible = (o.delay || 0) <= 0;
    puffs.push({ s: p, age: -(o.delay || 0), life: o.life, base: o.base, pop: o.pop, y: y, vy: o.vy || 0, smoke: !!o.smoke, maxOp: o.maxOp == null ? 1 : o.maxOp });
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
      p.s.material.opacity = Math.max(0, (t < 0.1 ? t / 0.1 : 1 - (t - 0.1) / 0.9) * p.maxOp);
      if (p.smoke) { p.y += p.vy * dt; p.s.position.y = p.y; p.s.material.color.setRGB(0.17, 0.16, 0.16); }
      else rampColor(p.s.material.color, t);
    }
  }

  CBZ.cityCrashFX = function (x, z, opts) {
    opts = opts || {};
    const speed = opts.speed || 8;
    const hard = !!opts.hard, catastrophic = !!opts.catastrophic;
    if ((hard || catastrophic) && CBZ.cityEvent) CBZ.cityEvent("crash", { x, z, damage: catastrophic ? 6 : 2, panic: catastrophic ? 7 : 3 }, { silent: true, noWanted: true, throttle: 0.9 });
    pointBurst(x, z, catastrophic ? 54 : (hard ? 34 : 12), 0xff9a38, catastrophic ? 0.18 : 0.13, 2 + speed * 0.18, catastrophic ? 0.7 : 0.48, false);
    pointBurst(x, z, catastrophic ? 34 : (hard ? 22 : 8), 0x8b8175, catastrophic ? 0.44 : 0.3, 1 + speed * 0.07, catastrophic ? 0.9 : 0.62, true);
    if (hard) {
      ring(x, z, catastrophic ? 7 : 4.5, catastrophic ? 0xffd08a : 0xffa14f);
      addChunks(x, z, catastrophic ? 9 : 4, 2.5 + speed * 0.1);
    }
  };

  // a real EXPLOSION (super-fast car-on-car, grenades later, etc.): fireball +
  // smoke + shockwave + white flash + blast damage to everyone in radius. Reusable.
  CBZ.cityExplosion = function (x, z, opts) {
    opts = opts || {};
    const power = opts.power || 1, R = (opts.radius || 6) * power, byPlayer = !!opts.byPlayer;
    const cy = 1.0;
    // FLASH — one instant huge additive sprite that snaps in and fades fast
    spawnPuff(x, cy + 0.3, z, { additive: true, base: 6 * power, pop: 6 * power, life: 0.11, maxOp: 1 });
    // FIREBALL — a CLUSTER of soft additive puffs that pop outward and ramp
    // white→yellow→orange→deep-red (overlap sums to white-hot in the middle)
    const nFire = Math.round(12 * Math.min(1.6, power));
    for (let i = 0; i < nFire; i++) {
      spawnPuff(x + (Math.random() - 0.5) * power, cy + (Math.random() - 0.2), z + (Math.random() - 0.5) * power,
        { additive: true, base: 0.6, pop: (3.6 + Math.random() * 1.4) * power, life: 0.5 + Math.random() * 0.4, maxOp: 1 });
    }
    // SMOKE — dark normal-blended puffs that rise + linger, emerging as flame dies
    const nSmoke = Math.round(4 * Math.min(1.5, power));
    for (let i = 0; i < nSmoke; i++) {
      spawnPuff(x + (Math.random() - 0.5) * 1.2, cy + 0.4, z + (Math.random() - 0.5) * 1.2,
        { additive: false, smoke: true, base: 1.5, pop: (6 + Math.random() * 2) * power, life: 1.3 + Math.random() * 0.6, maxOp: 0.38, vy: 0.7 + Math.random() * 0.4, delay: 0.12 + Math.random() * 0.1 });
    }
    ring(x, z, 6 * power, 0xffb05a);                                   // hot shockwave rim
    pointBurst(x, z, Math.round(24 * power), 0xffd27a, 0.16, 7 + 6 * power, 0.55, false);   // bright sparks
    addChunks(x, z, Math.round(8 * power), 6 + 5 * power);             // chunky voxel debris
    if (CBZ.sfx) CBZ.sfx("explosion");
    if (CBZ.shake) CBZ.shake(2.6 * power);
    if (CBZ.doSlowmo) CBZ.doSlowmo(0.32);
    if (CBZ.doHitstop) CBZ.doHitstop(0.16);
    try { const fl = CBZ.el && CBZ.el.flash; if (fl) { fl.classList.remove("go"); void fl.offsetWidth; fl.classList.add("go"); } } catch (e) {}
    // blast damage in radius — crowd, peds, cops, and the player
    if (CBZ.cityCrowdCircleKill) CBZ.cityCrowdCircleKill(x, z, R, { byCar: true, quiet: true, fromX: x, fromZ: z, noCrime: !byPlayer });
    for (const p of (CBZ.cityPeds || [])) { if (p.dead) continue; const dx = p.pos.x - x, dz = p.pos.z - z; if (dx * dx + dz * dz <= R * R && CBZ.cityKillPed) CBZ.cityKillPed(p, { fromX: x, fromZ: z, force: 9, fling: 6, byPlayer: byPlayer }, "explosion"); }
    for (const c of (CBZ.cityCops || [])) { if (c.dead) continue; const dx = c.pos.x - x, dz = c.pos.z - z; if (dx * dx + dz * dz <= R * R && CBZ.cityHurtCop) CBZ.cityHurtCop(c, 9999, { fromX: x, fromZ: z, force: 9, fling: 6, byPlayer: byPlayer }); }
    const P = CBZ.player;
    if (P && !P.dead) { const dx = P.pos.x - x, dz = P.pos.z - z, d2 = dx * dx + dz * dz; if (d2 < R * R) { const dmg = Math.round(85 * power * (1 - Math.sqrt(d2) / (R + 0.01))); if (dmg > 0 && CBZ.cityHurtPlayer) CBZ.cityHurtPlayer(dmg, x, z, "caught in an explosion", false, null, false); } }
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
      const r = rings[i]; r.t += dt; r.r += r.radius * 2.2 * dt;
      r.mesh.scale.setScalar(r.r);
      r.mat.opacity = Math.max(0, 0.72 * (1 - r.t / r.life));
      if (r.t >= r.life) { scene.remove(r.mesh); r.geo.dispose(); r.mat.dispose(); rings.splice(i, 1); }
    }
    for (let i = chunks.length - 1; i >= 0; i--) {
      const c = chunks[i]; c.t += dt; c.vy -= grav * dt;
      c.mesh.position.x += c.vx * dt; c.mesh.position.y += c.vy * dt; c.mesh.position.z += c.vz * dt;
      c.mesh.rotation.x += c.spin * dt; c.mesh.rotation.z += c.spin * 0.7 * dt;
      if (c.mesh.position.y < 0.1) { c.mesh.position.y = 0.1; c.vy *= -0.25; c.vx *= 0.65; c.vz *= 0.65; }
      if (c.t >= c.life) { scene.remove(c.mesh); chunks.splice(i, 1); }
    }
  });
})();
