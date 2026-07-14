/* ============================================================
   city/crashfx.js - compact car-impact visuals for CITY mode.

   Crashes are infrequent, so a short-lived point burst and a few shared-geo
   body fragments buy a lot of impact without adding steady frame cost.

   DETERMINISM: every jitter/scatter draw in this file (particle spread,
   scorch/splat texture mottling, chunk/rubble placement, rebar angles, smoke
   and fire puff variance) runs off a local seeded LCG (rng()) — NEVER
   Math.random() — so replay/multiplayer-sync stays bit-exact across clients.

   FIREBALL LIFETIME: the dramatic flame core (the additive white→orange→red
   puffs in cityCrashFX/cityExplosion/cityAirstrikeExplosion) now lives a few
   seconds instead of well under one — only the background smoke/smolder was
   stretched long before; the fireball itself used to die before the eye could
   register it.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE || !CBZ.scene) return;
  const THREE = window.THREE;
  const scene = CBZ.scene;

  // ---- deterministic seeded LCG (NEVER Math.random() — replay/MP sync) ------
  let _rs = 78451;
  function rng() { _rs = (_rs * 1103515245 + 12345) & 0x7fffffff; return _rs / 0x7fffffff; }

  const bursts = [], rings = [], chunks = [], scorches = [];
  // B5: scratch reused by applyBlastDamage's piece-damage pass below (no
  // per-blast allocation) — a Set to dedupe pieceIds across the multiple
  // AABB colliders one piece can register (doorframe = 3), an Array for
  // CBZ.queryCollidersNear's own out-param convention (systems/physics.js).
  const blastPieceScratch = [];
  const blastPieceSeen = new Set();
  const chunkGeo = new THREE.BoxGeometry(0.28, 0.18, 0.42);
  chunkGeo._shared = true;
  const debrisBox = new THREE.Box3(), debrisSize = new THREE.Vector3();
  // base box half-height (the 0.18 dim above ÷2) — a chunk must rest with its
  // BOTTOM on the road, so y_rest = floor + halfHeight*scale, never center=0.1
  // (which buried half the box into the asphalt — the user-filmed sink).
  const CHUNK_HH = 0.09;

  // TRUE-WORLD ground sample: where wreckage actually comes to rest (rooftops,
  // raised terrain, breaches), not a flat hardcoded y. Falls back to 0.
  function floorAt(x, z) { return CBZ.floorAt ? CBZ.floorAt(x, z) : 0; }
  function camDist2(x, z) {
    const cam = CBZ.camera && CBZ.camera.position;
    if (!cam) return 0;
    const dx = x - cam.x, dz = z - cam.z; return dx * dx + dz * dz;
  }
  // PERMANENCE / population-pool recycle: when a debris pool is full, evict the
  // OLDEST piece that is FAR from the lens (GTA pattern) so nothing pops out in
  // view. Falls back to the literal oldest only if every piece is on-screen.
  function recycleChunk() {
    let idx = -1, far = 60 * 60;
    for (let i = 0; i < chunks.length; i++) {
      if (camDist2(chunks[i].mesh.position.x, chunks[i].mesh.position.z) > far) { idx = i; break; }
    }
    if (idx < 0) idx = 0;             // all in view → take the oldest anyway
    const old = chunks.splice(idx, 1)[0];
    scene.remove(old.mesh);
  }
  const CHUNK_CAP = 220;             // bias HARD toward persistence (was 56)
  // a couple of debris materials so flying chunks aren't all the same flat grey
  const chunkMat = new THREE.MeshLambertMaterial({ color: 0x3c4148 });
  chunkMat._shared = true;
  const chunkMatHot = new THREE.MeshBasicMaterial({ color: 0x6b3a22 }); // charred / glowing edge
  chunkMatHot._shared = true;
  // a paler, dustier concrete for the settled RUBBLE HEAP so the pile reads as
  // shattered masonry (lighter, chalky) against the darker flying shrapnel.
  const rubbleMat = new THREE.MeshLambertMaterial({ color: 0x6c6358 });
  rubbleMat._shared = true;
  const rubbleMat2 = new THREE.MeshLambertMaterial({ color: 0x554d44 }); // shadowed lumps in the heap
  rubbleMat2._shared = true;
  // an irregular-ish concrete lump geo for heap pieces (a stretched box reads as
  // a broken slab fragment better than the small flying-chunk box).
  const rubbleGeo = new THREE.BoxGeometry(0.55, 0.4, 0.7);
  rubbleGeo._shared = true;
  // exposed REBAR: a thin dark steel bar. One shared thin box (cheaper than a
  // cylinder, and at this gauge the silhouette is identical) bent into an L by a
  // child segment so it dangles + hooks like blown reinforcement.
  const rebarMat = new THREE.MeshLambertMaterial({ color: 0x2a2520 });
  rebarMat._shared = true;
  const rebarGeo = new THREE.BoxGeometry(0.05, 1, 0.05);
  rebarGeo._shared = true;
  const rebar = [];                 // [{group, t, hold}] dangling-rebar props
  const REBAR_CAP = 28;             // bars across all live wounds

  // ---- POOLED point-burst ring (CBZ.fxPool, default ON) ----------------------
  // THE EXPLOSION ALLOCATION SPIKE: the old pointBurst minted a fresh
  // Float32Array×2 + BufferGeometry + BufferAttribute + PointsMaterial + Points
  // on EVERY call (≈6 per blast, more for airstrikes/wall-ruins) and dispose()'d
  // them all on expiry — a rocket impact = a GC bomb that hitched the frame on
  // the weak Mac. Fix (research: three.js object pooling + DynamicDrawUsage +
  // setDrawRange — utsubo tip #39 "pool bullets/particles", joshmarinacci
  // particle recycling, threejs docs setDrawRange/setUsage): a fixed RING of
  // preallocated Points. Each slot owns ONE BufferGeometry whose position
  // attribute is sized to BURST_MAX particles + marked DynamicDrawUsage, a CPU
  // velocity scratch array, and ONE reusable PointsMaterial. A burst just writes
  // its particles into the slot's buffers, sets the per-burst look (color/size/
  // opacity/blending) on the reused material, setDrawRange(0,count) so only the
  // live particles draw, and flags needsUpdate. ZERO per-blast allocation, ZERO
  // dispose churn — the look/counts/motion are byte-identical to before.
  //
  // BURST_MAX covers the largest single pointBurst the game ever fires (airstrike
  // sparks ≈ round(40 * P), P≤4.6 ⇒ ~184) with headroom so nothing is truncated.
  // RING_CAP covers a multi-blast / sprint-through-crowd burst (cityExplosion ≈6
  // bursts, airstrike ≈3, wall-ruin ≈2, plus impact splats) so live bursts are
  // never stolen mid-flight; on overrun the oldest slot is reused — exactly the
  // permanence the old path got from expiry, just without the allocation.
  const BURST_MAX = 256, RING_CAP = 48;
  const burstPool = [];   // preallocated Points, lazily grown to RING_CAP
  let burstRing = 0;      // next slot to (re)use
  function makeBurstSlot() {
    const pos = new Float32Array(BURST_MAX * 3);
    const attr = new THREE.BufferAttribute(pos, 3);
    if (attr.setUsage) attr.setUsage(THREE.DynamicDrawUsage); else attr.dynamic = true;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", attr);
    geo.setDrawRange(0, 0);
    const mat = new THREE.PointsMaterial({
      size: 0.1, transparent: true, opacity: 0,
      depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.Points(geo, mat);
    mesh.renderOrder = 8;
    // these transient blast bursts always pop at the action: skip frustum culling
    // so a REUSED geometry whose computed bounds shrank can never wrongly vanish.
    mesh.frustumCulled = false;
    mesh.visible = false;
    scene.add(mesh);
    // velocity scratch lives on the slot too — reused, never reallocated.
    const slot = { mesh, geo, attr, mat, pos, vel: new Float32Array(BURST_MAX * 3), live: null };
    return slot;
  }
  // pull a slot out of the ring, evicting whatever burst was riding it (the
  // evicted burst is dropped from the active list — same as the old expiry).
  function acquireBurstSlot() {
    let slot = burstPool[burstRing];
    if (!slot) { slot = burstPool[burstRing] = makeBurstSlot(); }
    burstRing = (burstRing + 1) % RING_CAP;
    if (slot.live) {                       // evict the previous rider, if any
      const idx = bursts.indexOf(slot.live);
      if (idx >= 0) bursts.splice(idx, 1);
      slot.live = null;
    }
    return slot;
  }

  // y0 (optional) seats the burst at an impact HEIGHT (rocket on a tower face)
  // instead of the default street level.
  function pointBurst(x, z, count, color, size, speed, life, dust, y0) {
    if (count > BURST_MAX) count = BURST_MAX;   // never overrun the pooled buffer
    const baseY = y0 != null ? y0 : 0.35;
    const pooled = CBZ.fxPool !== false;
    // pooled path reuses the slot's preallocated buffers; the fallback (flag off)
    // allocates exactly as before so behavior degrades to today byte-for-byte.
    let pos, vel, slot = null, geo = null, mat = null, mesh = null;
    if (pooled) {
      slot = acquireBurstSlot();
      pos = slot.pos; vel = slot.vel;
    } else {
      pos = new Float32Array(count * 3);
      vel = new Float32Array(count * 3);
    }
    for (let i = 0; i < count; i++) {
      const o = i * 3, a = rng() * Math.PI * 2;
      const sp = speed * (0.35 + rng() * 0.8);
      pos[o] = x + (rng() - 0.5) * 0.8;
      pos[o + 1] = baseY + rng() * (dust ? 0.5 : 1.0);
      pos[o + 2] = z + (rng() - 0.5) * 0.8;
      vel[o] = Math.cos(a) * sp;
      vel[o + 1] = (dust ? 0.9 : 2.5) + rng() * (dust ? 1.7 : 4.5);
      vel[o + 2] = Math.sin(a) * sp;
    }
    const op0 = dust ? 0.5 : 0.95;
    const blend = dust ? THREE.NormalBlending : THREE.AdditiveBlending;
    if (pooled) {
      // re-dress the reused material + buffer for this burst's exact look/count
      mat = slot.mat; geo = slot.geo; mesh = slot.mesh;
      mat.color.set(color); mat.size = size; mat.opacity = op0; mat.blending = blend;
      mat.needsUpdate = true;            // blending swap needs a program recompile flag
      geo.setDrawRange(0, count);
      // bound the per-frame GPU upload to the LIVE particles only (the buffer is
      // BURST_MAX long but only `count` matter) — r128 honours updateRange.count.
      slot.attr.updateRange.offset = 0; slot.attr.updateRange.count = count * 3;
      slot.attr.needsUpdate = true;      // upload the freshly-written positions
      mesh.visible = true;
    } else {
      geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      mat = new THREE.PointsMaterial({
        color, size, transparent: true, opacity: op0,
        depthWrite: false, blending: blend,
      });
      mesh = new THREE.Points(geo, mat);
      mesh.renderOrder = 8;
      scene.add(mesh);
    }
    // n = LIVE byte-length so the shared updater steps only the real particles
    // (a pooled buffer is BURST_MAX long but only `count` are alive this burst).
    const b = { mesh, geo, mat, pos, vel, t: 0, life, dust: !!dust, op0, n: count * 3, slot };
    if (slot) slot.live = b;
    bursts.push(b);
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
    // CLAMP count to the pool cap: an oversized request (a huge-power blast) would
    // otherwise drive CHUNK_CAP-count negative (a never-terminating recycle loop)
    // AND spawn `count` meshes in the for-loop below — either one hard-freezes the
    // frame. Capping keeps every blast bounded to the pooled budget.
    count = Math.min(CHUNK_CAP, Math.max(0, count | 0));
    while (chunks.length > CHUNK_CAP - count) recycleChunk();
    const dx = dir ? dir.x : 0, dz = dir ? dir.z : 0, biased = !!dir;
    const baseY = y0 != null ? y0 : 0.4;
    const fall = y0 != null ? Math.sqrt(Math.max(0.5, y0) / 8.8) : 0;   // grav*0.8 fall time to street
    for (let i = 0; i < count; i++) {
      const a = rng() * Math.PI * 2;
      // mostly charred grey, a few glowing-hot shards on an explosion
      const glow = hot && rng() < 0.5;
      const mesh = new THREE.Mesh(chunkGeo, glow ? chunkMatHot : chunkMat);
      const sc = (0.65 + rng() * 0.8) * (hot ? 1.1 : 1);
      mesh.position.set(x, baseY + rng() * 0.8, z);
      mesh.rotation.set(rng() * 3, rng() * 3, rng() * 3);
      mesh.scale.setScalar(sc);
      scene.add(mesh);
      // debris flies fast then arcs down under gravity (slightly damped so it
      // hangs a touch longer like AAA shrapnel), heavier shards thrown lower
      const up = hot ? (3 + rng() * 6) : (2 + rng() * 4);
      const sp = force * (0.4 + rng() * 1.0);
      let vx = Math.cos(a) * sp, vz = Math.sin(a) * sp;
      if (biased) { vx += dx * force * (0.6 + rng() * 0.8); vz += dz * force * (0.6 + rng() * 0.8); }
      // hh = this chunk's half-height so it RESTS on the road, not buried to its
      // centre; rest = up to 60s of permanence once it has settled (true world).
      chunks.push({
        mesh, vx, vy: up, vz, hh: CHUNK_HH * sc,
        spin: (rng() - 0.5) * 16, t: 0, life: fall + 1.2 + rng() * 1.1,
        rest: 0, settled: false,
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
    if (!mesh) return false;
    // Never let a whole facade/window-wall enter the flying-debris pool. This
    // API is for car panels and small fragments; oversized donations are culled
    // immediately instead of hanging as giant angled planes in the world.
    try {
      mesh.updateWorldMatrix(true, true);
      debrisBox.setFromObject(mesh).getSize(debrisSize);
      if (Math.max(debrisSize.x, debrisSize.y, debrisSize.z) > 3.0) {
        if (mesh.parent) mesh.parent.remove(mesh);
        return false;
      }
    } catch (e) {}
    while (chunks.length > CHUNK_CAP - 1) recycleChunk();
    scene.add(mesh);
    mesh.userData.fractureShard = true;
    // a torn-off panel is built around its own origin; bbox half-height seats it
    // on the road so it lies flat instead of sinking through.
    let hh = 0.12;
    try { mesh.geometry.computeBoundingBox(); const bb = mesh.geometry.boundingBox; if (bb) hh = Math.max(0.04, (bb.max.y - bb.min.y) * 0.5 * (mesh.scale.y || 1)); } catch (e) {}
    chunks.push({
      mesh, vx: vx || 0, vy: vy == null ? 3 : vy, vz: vz || 0, hh,
      spin: (rng() - 0.5) * 9, t: 0, life: 1.8 + rng() * 0.8, rest: 0, settled: false, trail: -1,
    });
    return true;
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
      const a = rng() * 6.2832, rr = 18 + rng() * 44;
      ctx.beginPath(); ctx.arc(r + Math.cos(a) * rr, r + Math.sin(a) * rr, 2 + rng() * 5, 0, 6.2832);
      ctx.fillStyle = "rgba(0,0,0," + (0.2 + rng() * 0.5) + ")"; ctx.fill();
    }
    const t = new THREE.Texture(c); t.needsUpdate = true; return t;
  }
  const scorchGeo = new THREE.PlaneGeometry(1, 1); scorchGeo._shared = true;
  function addScorch(x, z, radius, hold) {
    if (!scorchTex) scorchTex = makeScorchTexture();
    while (scorches.length > 12) { const o = scorches.shift(); scene.remove(o.mesh); o.mesh.material.dispose(); }
    const mat = new THREE.MeshBasicMaterial({ map: scorchTex, transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    const mesh = new THREE.Mesh(scorchGeo, mat);
    mesh.rotation.x = -Math.PI / 2; mesh.rotation.z = rng() * 6.28;
    mesh.position.set(x, 0.045, z); mesh.scale.setScalar(radius * 2);
    mesh.renderOrder = 1; scene.add(mesh);
    // scorch marks linger as black road stains; airstrikes pass a longer hold
    scorches.push({ mesh, mat, t: 0, hold: (hold || 11) + rng() * 5, grow: 0 });
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
      const a = rng() * 6.2832, rr = 40 + rng() * 24;
      ctx.beginPath(); ctx.arc(r + Math.cos(a) * rr, r + Math.sin(a) * rr, 2 + rng() * 6, 0, 6.2832);
      ctx.fillStyle = "rgba(110,6,6," + (0.3 + rng() * 0.55) + ")"; ctx.fill();
    }
    // a couple of darker clots near the centre so it doesn't read as a flat disc
    ctx.globalCompositeOperation = "multiply";
    for (let i = 0; i < 10; i++) {
      const a = rng() * 6.2832, rr = rng() * 30;
      ctx.beginPath(); ctx.arc(r + Math.cos(a) * rr, r + Math.sin(a) * rr, 4 + rng() * 9, 0, 6.2832);
      ctx.fillStyle = "rgba(60,0,0,0.6)"; ctx.fill();
    }
    const t = new THREE.Texture(c); t.needsUpdate = true; return t;
  }
  function addBloodPool(x, z, radius) {
    if (!splatTex) splatTex = makeSplatTexture();
    while (splats.length > 10) { const o = splats.shift(); scene.remove(o.mesh); o.mat.dispose(); }
    const mat = new THREE.MeshBasicMaterial({ map: splatTex, transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 });
    const mesh = new THREE.Mesh(scorchGeo, mat);   // reuse the shared 1x1 plane
    mesh.rotation.x = -Math.PI / 2; mesh.rotation.z = rng() * 6.28;
    mesh.position.set(x, 0.05, z); mesh.scale.setScalar(0.4);
    mesh.renderOrder = 2; scene.add(mesh);
    splats.push({ mesh, mat, t: 0, r0: 0.4, r1: radius * 2, hold: 16 + rng() * 8 });
  }

  // x,y,z = impact point; opts.player flags the player's own splat (more gore),
  // opts.speed scales the violence. Safe to call without THREE gore loaded.
  CBZ.cityImpactSplat = function (x, y, z, opts) {
    opts = opts || {};
    if (!CBZ.game || CBZ.game.mode !== "city") return;
    const player = !!opts.player;
    const speed = opts.speed || 18;
    const power = Math.min(2.4, Math.max(1, speed / 16));   // visual dial, clamped
    // FX budget rides the perf/quality slider — tier0 sheds ~65% of burst
    // particles, Best (tier 4) is byte-identical. Sampled ONCE per burst.
    const fxq = CBZ.qScale ? CBZ.qScale(0.35, 1) : 1;
    // crimson sheet skidding out low across the ground (the splash on impact)
    pointBurst(x, z, Math.max(1, Math.round((player ? 40 : 26) * power * fxq)), 0x8a0a0a, 0.17, 3 + speed * 0.28, 0.6, false);
    pointBurst(x, z, Math.max(1, Math.round(14 * power * fxq)), 0xc01818, 0.12, 5 + speed * 0.3, 0.42, false);
    // a lingering dark-red blood POOL spreading at the impact seat
    addBloodPool(x, z, (player ? 2.4 : 1.7) * power);
    // a few chunky dark gibs tumbling off the splat (reuse the debris pool —
    // the pool KEEPS its full cap; only the per-event spawn rides the tier)
    addChunks(x, z, Math.max(1, Math.round((player ? 6 : 4) * power * fxq)), 2.2 + speed * 0.1, false, opts.dir || null);
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
      const px = 16 + rng() * 32, py = 16 + rng() * 32, rr = 10 + rng() * 16;
      const g = ctx.createRadialGradient(px, py, 0, px, py, rr);
      g.addColorStop(0, "rgba(255,255,255," + (0.45 + rng() * 0.35) + ")");
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
    p.position.set(x, y, z); p.material.rotation = rng() * 6.2832;
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

  // A bounded reusable wreck plume for aircraft modules. Several callers have
  // long feature-detected this hook; defining it here keeps those crashes on
  // the same pooled smoke sprites as explosions instead of silently doing
  // nothing. Each call is capped at six puffs and they return to puffPool.
  CBZ.cityCrashSmoke = function (x, y, z, opts) {
    opts = opts || {};
    const cy = Number.isFinite(+y) ? +y : 0.8;
    const count = Math.max(1, Math.min(6, opts.count == null ? 5 : opts.count | 0));
    const scale = Math.max(0.5, Math.min(2.2, opts.scale || 1));
    for (let i = 0; i < count; i++) {
      const a = rng() * 6.2832, drift = 0.25 + rng() * 0.5;
      spawnPuff(x + (rng() - 0.5) * 1.5 * scale,
        cy + 0.3 + rng() * 0.8 * scale,
        z + (rng() - 0.5) * 1.5 * scale, {
          additive: false, smoke: true, base: 1.3 * scale,
          pop: (4.8 + rng() * 2.6) * scale,
          life: 4.0 + rng() * 2.6, maxOp: 0.44,
          shade: 0.09 + rng() * 0.06, spin: (rng() - 0.5),
          vx: Math.cos(a) * drift, vy: 1.2 + rng() * 1.0,
          vz: Math.sin(a) * drift, delay: i * 0.08 + rng() * 0.1,
        });
    }
  };

  CBZ.cityCrashFX = function (x, z, opts) {
    opts = opts || {};
    const speed = opts.speed || 8;
    const hard = !!opts.hard, catastrophic = !!opts.catastrophic;
    const dir = opts.dir || null;   // downrange impact direction, for biased debris
    if ((hard || catastrophic) && CBZ.cityEvent) CBZ.cityEvent("crash", { x, z, damage: catastrophic ? 6 : 2, panic: catastrophic ? 7 : 3 }, { silent: true, noWanted: true, throttle: 0.9 });
    // FX budget rides the perf/quality slider — tier0 sheds ~65% of burst
    // particles, Best (tier 4) is byte-identical. Sampled ONCE per burst.
    const fxq = CBZ.qScale ? CBZ.qScale(0.35, 1) : 1;
    // hot orange impact sparks (additive) that shoot out fast and die quick
    pointBurst(x, z, Math.max(1, Math.round((catastrophic ? 58 : (hard ? 38 : 12)) * fxq)), 0xff9a38, catastrophic ? 0.19 : 0.13, 2 + speed * 0.2, catastrophic ? 0.7 : 0.48, false);
    // a tight WHITE-hot spark spray at the contact point (metal grinding)
    pointBurst(x, z, Math.max(1, Math.round((catastrophic ? 30 : (hard ? 18 : 6)) * fxq)), 0xfff0c0, 0.1, 4 + speed * 0.25, catastrophic ? 0.45 : 0.32, false);
    // kicked-up dust
    pointBurst(x, z, Math.max(1, Math.round((catastrophic ? 34 : (hard ? 22 : 8)) * fxq)), 0x8b8175, catastrophic ? 0.44 : 0.3, 1 + speed * 0.07, catastrophic ? 0.9 : 0.62, true);
    // shattered GLASS — pale blue-white shimmering shards (additive twinkle)
    if (hard) pointBurst(x, z, Math.max(1, Math.round((catastrophic ? 30 : 16) * fxq)), 0xcfe6ff, 0.09, 3 + speed * 0.16, catastrophic ? 0.8 : 0.6, false);
    if (hard && CBZ.sfx) CBZ.sfx("glass");
    if (hard) {
      ring(x, z, catastrophic ? 7 : 4.5, catastrophic ? 0xffd08a : 0xffa14f, { opacity: catastrophic ? 0.7 : 0.55, spd: catastrophic ? 3 : 2.4, life: catastrophic ? 0.7 : 0.55 });
      // debris pool keeps its full cap; only the per-event spawn rides the tier
      addChunks(x, z, Math.max(1, Math.round((catastrophic ? 10 : 5) * fxq)), 2.5 + speed * 0.12, false, dir);
      addScorch(x, z, catastrophic ? 3 : 1.4, catastrophic ? 9 : 5);   // a scuff/skid stain even on a hard (non-fatal) wall hit
      if (catastrophic) {
        if (CBZ.shake) CBZ.shake(1.6);
        // a clutch of small lingering flames + a thin smoke wisp so a wrecked car
        // looks like it's actually cooking, not just sparking for a frame.
        // LIFETIME STRETCHED (was 1.1-2.0s): the flame core lingers a couple of
        // seconds now, same fix as the bigger explosion fireballs above.
        for (let i = 0; i < 5; i++) {
          const a = rng() * 6.2832, rr = rng() * 1.1;
          spawnPuff(x + Math.cos(a) * rr, 0.45, z + Math.sin(a) * rr,
            { additive: true, base: 0.4, pop: 1.6 + rng() * 0.9, life: 2.2 + rng() * 1.4,
              maxOp: 0.85, spin: (rng() - 0.5) * 2, vy: 0.5 + rng() * 0.7,
              delay: rng() * 0.2 });
        }
        for (let i = 0; i < 4; i++) {
          const a = rng() * 6.2832, dr = 0.3 + rng() * 0.5;
          spawnPuff(x + (rng() - 0.5) * 1.2, 0.9 + rng() * 0.5, z + (rng() - 0.5) * 1.2,
            { additive: false, smoke: true, base: 1.2, pop: 4 + rng() * 2,
              life: 2.4 + rng() * 1.4, maxOp: 0.34, shade: 0.15, spin: (rng() - 0.5),
              vx: Math.cos(a) * dr, vy: 1.0 + rng() * 0.6, vz: Math.sin(a) * dr,
              delay: 0.15 + rng() * 0.3 });
        }
      }
    }
  };

  // ---- lingering ground SMOLDER columns — a big blast's crater keeps smoking
  // for tens of seconds (same pooled-emitter idea as the wall wounds below).
  // Hard cap 3 live smolders: the oldest crater just stops smoking.
  const smolders = [];
  function addSmolder(x, z, dur) {
    while (smolders.length >= 3) smolders.shift();
    smolders.push({ x, z, t: 0, dur, acc: 0.3 });
  }

  // a real EXPLOSION (super-fast car-on-car, grenades later, etc.): fireball +
  // smoke + shockwave + white flash + blast damage to everyone in radius. Reusable.
  CBZ.cityExplosion = function (x, z, opts) {
    opts = opts || {};
    const power = opts.power || 1, R = (opts.radius || 6) * power, byPlayer = !!opts.byPlayer;
    const P = Math.min(2.2, power);            // visual scale is clamped so huge blasts stay cheap
    // FX budget rides the perf/quality slider — tier0 sheds ~65% of burst
    // particles, Best (tier 4) is byte-identical. Sampled ONCE per blast.
    const fxq = CBZ.qScale ? CBZ.qScale(0.35, 1) : 1;
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
    // LIFETIMES STRETCHED (was 0.7-1.45s — gone before the eye registered it):
    // the fireball core now visibly burns for a couple of seconds, same as the
    // ramp/fade math in updatePuffs already supports — only the spawn-side
    // `life` was too short. Background smoke (LAYER 3 below) was already long.
    const nFire = Math.round(14 * P);
    for (let i = 0; i < nFire; i++) {
      const a = rng() * 6.2832, rr = rng() * 0.9 * P, sp = (1.0 + rng() * 2.2);
      spawnPuff(x + Math.cos(a) * rr, cy + (rng() - 0.15) * P, z + Math.sin(a) * rr,
        { additive: true, base: 0.6, pop: (3.4 + rng() * 1.8) * P, life: 1.9 + rng() * 1.3,
          maxOp: 1, spin: (rng() - 0.5) * 3,
          vx: Math.cos(a) * sp, vy: 0.4 + rng() * 1.2, vz: Math.sin(a) * sp });
    }
    // a few low fireballs that hug the ground (blast spreading along the road —
    // meaningless 30u up a facade, so elevated blasts skip the road wash)
    if (!elevated) for (let i = 0; i < Math.round(5 * P); i++) {
      const a = rng() * 6.2832, sp = 3 + rng() * 4 * P;
      spawnPuff(x, 0.55, z, { additive: true, base: 0.5, pop: (2.2 + rng()) * P, life: 1.4 + rng() * 0.9,
        maxOp: 0.9, vx: Math.cos(a) * sp, vy: 0.2, vz: Math.sin(a) * sp });
    }
    // lingering FLAMES that keep licking up from the blast seat for a beat
    // after the fireball collapses — sells a "still burning" crater cheaply.
    for (let i = 0; i < Math.round(4 * P); i++) {
      const a = rng() * 6.2832, rr = rng() * 0.7 * P;
      spawnPuff(x + Math.cos(a) * rr, elevated ? cy - 0.4 : 0.5, z + Math.sin(a) * rr,
        { additive: true, base: 0.4, pop: (1.4 + rng() * 0.8) * P, life: 2.6 + rng() * 1.6,
          maxOp: 0.85, spin: (rng() - 0.5) * 2, vy: 0.6 + rng() * 0.7,
          delay: 0.12 + rng() * 0.25 });
    }

    // ---- LAYER 3: SMOKE — lumpy dark plume that emerges as the flame cools,
    // RISES (negative gravity), drifts, expands and LINGERS the longest. Two
    // densities: a tall central column + wider low billows for volume.
    const nSmoke = Math.round(6 * P);
    for (let i = 0; i < nSmoke; i++) {
      const a = rng() * 6.2832, dr = 0.4 + rng() * 0.6;
      spawnPuff(x + (rng() - 0.5) * 1.4 * P, cy + 0.3 + rng() * 0.6, z + (rng() - 0.5) * 1.4 * P,
        { additive: false, smoke: true, base: 1.6, pop: (5.5 + rng() * 3) * P,
          life: 2.6 + rng() * 1.8, maxOp: 0.42, shade: 0.13 + rng() * 0.06,
          spin: (rng() - 0.5) * 1.2,
          vx: Math.cos(a) * dr, vy: 1.1 + rng() * 0.8, vz: Math.sin(a) * dr,
          delay: 0.08 + rng() * 0.18 });
    }
    // ROLLING HANDOFF: a few smoke billows spawn ON the fireball's rim with its
    // outward velocity inherited, so the orange roils visibly into black-orange
    // smoke instead of the plume just appearing at the centre (their early
    // heat-glow in updatePuffs paints them fire-orange before they sooty out).
    for (let i = 0; i < Math.round(3 * P); i++) {
      const a = rng() * 6.2832, rr = (0.8 + rng() * 0.8) * P, sp = 1.6 + rng() * 1.8;
      spawnPuff(x + Math.cos(a) * rr, cy + 0.4 + rng() * 0.8 * P, z + Math.sin(a) * rr,
        { additive: false, smoke: true, base: 1.2, pop: (4.5 + rng() * 2.5) * P,
          life: 2.2 + rng() * 1.4, maxOp: 0.46, shade: 0.12 + rng() * 0.05,
          spin: (rng() - 0.5) * 1.6,
          vx: Math.cos(a) * sp, vy: 1.4 + rng() * 1.0, vz: Math.sin(a) * sp,
          delay: 0.18 + rng() * 0.2 });
    }
    // low rolling billows that spread outward at the base (ground blasts only)
    if (!elevated) for (let i = 0; i < Math.round(4 * P); i++) {
      const a = rng() * 6.2832, sp = 1.4 + rng() * 1.6;
      spawnPuff(x, 0.6, z, { additive: false, smoke: true, base: 1.2, pop: (4 + rng() * 2) * P,
        life: 2.2 + rng() * 1.3, maxOp: 0.3, shade: 0.15, spin: (rng() - 0.5),
        vx: Math.cos(a) * sp, vy: 0.4 + rng() * 0.5, vz: Math.sin(a) * sp, delay: 0.05 + rng() * 0.12 });
    }

    // ---- LAYER 4: SHOCKWAVE — a fast thin bright additive ring on the ground
    // that races out JUST AFTER the flash, plus a slower glowing hot rim.
    // (an elevated blast never touched the road — no ground ring/scorch)
    if (!elevated) {
      ring(x, z, R * 1.15, 0xffe7b0, { additive: true, opacity: 0.85, inner: 1.05, spd: 5.0, life: 0.42, flat: true, y: 0.06, r0: 0.6 });
      ring(x, z, R, 0xffb05a, { additive: true, opacity: 0.6, inner: 0.78, spd: 2.4, life: 0.55, y: 0.1 });
      // ---- LAYER 4b: GROUND DUST — the pressure wave SLAPS the street: a pale
      // dust skirt races outward just behind the bright ring (fast, low, short-
      // lived) plus a kicked-up dust haze that hangs a beat. This is what makes
      // a blast read as touching the WORLD instead of floating on it.
      pointBurst(x, z, Math.max(1, Math.round(16 * P * fxq)), 0x8b8175, 0.42, 2 + power * 0.5, 0.95, true);
      for (let i = 0; i < Math.round(5 * P); i++) {
        const a = rng() * 6.2832, sp = 4.5 + rng() * 3.5 * P;
        spawnPuff(x + Math.cos(a) * 0.6, 0.45, z + Math.sin(a) * 0.6,
          { additive: false, smoke: true, base: 0.9, pop: (3 + rng() * 1.6) * P,
            life: 0.9 + rng() * 0.5, maxOp: 0.3, shade: 0.34 + rng() * 0.06,
            spin: (rng() - 0.5), vx: Math.cos(a) * sp, vy: 0.25, vz: Math.sin(a) * sp,
            delay: 0.03 + rng() * 0.05 });
      }
    }

    // ---- LAYER 5: SPARKS + EMBERS + DEBRIS (nearest layer) ----
    pointBurst(x, z, Math.max(1, Math.round(28 * P * fxq)), 0xffe08a, 0.16, 9 + 7 * power, 0.6, false, elevated ? cy : null); // fast bright sparks
    // glowing embers that arc up and rain down, lingering longer than sparks
    const nEmber = Math.round(16 * P);
    for (let i = 0; i < nEmber; i++) {
      const a = rng() * 6.2832, sp = 1.5 + rng() * 3.5 * P;
      spawnPuff(x + Math.cos(a) * 0.5, cy + rng() * 0.8, z + Math.sin(a) * 0.5,
        { additive: true, base: 0.18 + rng() * 0.16, pop: 0.1, life: 1.0 + rng() * 1.1,
          maxOp: 1, vx: Math.cos(a) * sp, vy: 3 + rng() * 4, vz: Math.sin(a) * sp });
    }
    addChunks(x, z, Math.max(1, Math.round(10 * P * fxq)), 6 + 5 * power, true, null, elevated ? cy : null); // chunky glowing debris (pool cap untouched — only the per-blast spawn rides the tier)
    if (!elevated) {
      addScorch(x, z, R * 0.5);                                        // lasting ground scorch
      // big blasts leave a SMOKING crater: a thin column keeps seeping off the
      // scorch for ~half a minute (pooled emitter, hard cap 3 — the show-off
      // plume that tells the whole block something detonated here).
      if (power >= 1.3) addSmolder(x, z, 22 + Math.min(20, power * 9));
    }

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

    // ---- STRUCTURAL COUPLING (the one place a blast wounds a building) --------
    // EVERY ordnance routes through cityExplosion (RPG, grenade, C4, airstrike),
    // so this is THE coupling point: after the FX/damage, carve+scar the nearest
    // facade within the blast radius, AT the blast HEIGHT (cy) — near or far, any
    // floor of a tower, not just the kerb. The carve primitive is height-aware
    // (cityFracture.blastAt(pt, r) → cityCarveWall at pt.y, finding the nearest
    // wall within `search`); blastAt floors the hole to a dramatic, room-exposing
    // size by ordnance class, so the wound is SATISFYING, not a dimple.
    //
    // ANTI-DOUBLE-CARVE: buildings.js wraps cityExplosion to run its own
    // structuralBlast→blastAt AFTER this returns. When that wrap is installed
    // (CBZ.cityExplosion._structWrapped), we SKIP here and let the wrap do it —
    // exactly one carve. We only self-couple as a FALLBACK when the wrap is
    // absent (buildings.js not loaded / not yet wrapped), so cityExplosion ALWAYS
    // wounds a building no matter the load order. Either path uses the SAME
    // deferral/coalescing in fracture.js (DEFER_CELL), so even a redundant call
    // collapses into one hole.
    //
    // GATES (mirror buildings.js structuralBlast): only meaningful ordnance
    // (power ≳1) carves; the heli ember (power 0.2, noDamage) and tiny car-pops
    // must NOT punch holes — noDamage is skipped outright, weak blasts scar at
    // most. CITY-ONLY (cityFracture.blastAt self-guards mode==="city").
    if (!opts.noDamage && power >= 1.0 && CBZ.cityFracture && CBZ.cityFracture.blastAt
        && !(CBZ.cityExplosion && CBZ.cityExplosion._structWrapped)) {
      // hole radius by ordnance class (blastAt re-floors it to a room-exposing
      // size); search left to blastAt's radius-scaled default so a blast a few
      // units off the wall still couples to the NEAREST facade at this height.
      const hr = power >= 1.3 ? Math.min(3.4, 2.6 + (power - 1.3) * 0.7) : 1.6;
      try { CBZ.cityFracture.blastAt({ x: x, y: cy, z: z }, hr, { power: power }); } catch (e) {}
    }
  };

  // Shared blast-damage application — the SAME path cityExplosion always used:
  // crowd circle-kill, peds, cops, and the player, scaled by distance/power.
  // Both cityExplosion and cityAirstrikeExplosion route through this so they hurt
  // people identically. (force/fling let an airstrike fling bodies harder.)
  function applyBlastDamage(x, z, R, power, byPlayer, force, fling) {
    force = force == null ? 9 : force; fling = fling == null ? 6 : fling;
    // REALISTIC LETHALITY: a blast is fatal near ground zero, not across its whole
    // visual / ground-shock radius. Killing EVERYONE within R wiped out crowds of
    // bystanders most of a block away (filmed "kills a huge amount of people").
    // Lethal core ≈ 0.55R (≈0.3× the area, so ~3× fewer deaths); past it, spared.
    const LR = R * 0.55, LR2 = LR * LR;
    if (CBZ.cityCrowdCircleKill) CBZ.cityCrowdCircleKill(x, z, LR, { byCar: true, quiet: true, fromX: x, fromZ: z, noCrime: !byPlayer });
    for (const p of (CBZ.cityPeds || [])) { if (p.dead) continue; const dx = p.pos.x - x, dz = p.pos.z - z; if (dx * dx + dz * dz <= LR2 && CBZ.cityKillPed) CBZ.cityKillPed(p, { fromX: x, fromZ: z, force: force, fling: fling, byPlayer: byPlayer }, "explosion"); }
    for (const c of (CBZ.cityCops || [])) { if (c.dead) continue; const dx = c.pos.x - x, dz = c.pos.z - z; if (dx * dx + dz * dz <= LR2 && CBZ.cityHurtCop) CBZ.cityHurtCop(c, 9999, { fromX: x, fromZ: z, force: force, fling: fling, byPlayer: byPlayer }); }
    const PL = CBZ.player;
    if (PL && !PL.dead) { const dx = PL.pos.x - x, dz = PL.pos.z - z, d2 = dx * dx + dz * dz; if (d2 < R * R) { const dmg = Math.round(85 * power * (1 - Math.sqrt(d2) / (R + 0.01))); if (dmg > 0 && CBZ.cityHurtPlayer) CBZ.cityHurtPlayer(dmg, x, z, "caught in an explosion", false, null, false); } }

    // ---- B5: STRUCTURAL BLAST DAMAGE — every player-built piece (systems/
    // pieces.js) within the FULL blast sphere R (not the reduced ped lethal
    // core LR above — a wall doesn't get to "survive by standing further
    // back" the way a scattering crowd does) takes damage on the SAME
    // linear 1→0 falloff shape as the player's own blast damage just above.
    // queryCollidersNear is a broadphase (square, not circular) so we still
    // gate on real distance below; pieceId can repeat across a piece's own
    // multiple AABBs (e.g. a doorframe's 3 colliders), hence the Set dedupe.
    // BASE tuned so a single C4 charge (power 1.4, structDamage.js's wood-
    // tier explosive mult 4.0) one-shots a full-hp (250) wood wall at close
    // range: 70 * 1.4 * 4.0 = 392 ≥ 250.
    if (CBZ.structDamage && CBZ.queryCollidersNear && CBZ.pieces) {
      const near = CBZ.queryCollidersNear(x, z, R, blastPieceScratch);
      blastPieceSeen.clear();
      for (let i = 0; i < near.length; i++) {
        const c = near[i];
        if (c.pieceId == null || blastPieceSeen.has(c.pieceId)) continue;
        blastPieceSeen.add(c.pieceId);
        const piece = CBZ.pieces.get(c.pieceId);
        if (!piece || !piece.alive) continue;
        const dx = piece.pos.x - x, dz = piece.pos.z - z, d = Math.hypot(dx, dz);
        if (d >= R) continue;
        const amt = 70 * power * (1 - d / R);
        if (amt > 0) CBZ.structDamage.hit(c.pieceId, amt, "explosive");
      }
    }
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
    // LIFETIMES STRETCHED (was 1.0-2.0s — an "airstrike" whose flame died faster
    // than the eye could track it): the heavy-ordnance fireball now visibly burns
    // for several seconds, bigger than a car blast's, before it sootily collapses
    // into the smoke column (LAYER below, already long-lived).
    const nFire = Math.round(22 * P);
    for (let i = 0; i < nFire; i++) {
      const a = rng() * 6.2832, rr = rng() * 1.2 * P, sp = (1.4 + rng() * 3.0);
      spawnPuff(x + Math.cos(a) * rr, cy + (rng() - 0.1) * 1.4 * P, z + Math.sin(a) * rr,
        { additive: true, base: 0.8, pop: (4.2 + rng() * 2.4) * P, life: 2.6 + rng() * 1.6,
          maxOp: 1, spin: (rng() - 0.5) * 3,
          vx: Math.cos(a) * sp, vy: 1.0 + rng() * 2.4, vz: Math.sin(a) * sp });
    }
    // the rising MUSHROOM HEAD — a few big slow fireballs that climb and bloom
    for (let i = 0; i < Math.round(5 * P); i++) {
      const a = rng() * 6.2832, dr = 0.4 + rng() * 0.7;
      spawnPuff(x + Math.cos(a) * dr * P, cy + 1.2 * P, z + Math.sin(a) * dr * P,
        { additive: true, base: 1.2, pop: (5 + rng() * 3) * P, life: 3.2 + rng() * 1.8,
          maxOp: 1, spin: (rng() - 0.5) * 1.5,
          vx: Math.cos(a) * 0.8, vy: 3.2 + rng() * 2.2, vz: Math.sin(a) * 0.8,
          delay: 0.05 + rng() * 0.12 });
    }
    // low fireballs spreading along the ground (blast wash)
    for (let i = 0; i < Math.round(8 * P); i++) {
      const a = rng() * 6.2832, sp = 4 + rng() * 6 * P;
      spawnPuff(x, 0.6, z, { additive: true, base: 0.6, pop: (2.6 + rng() * 1.4) * P, life: 1.6 + rng() * 1.0,
        maxOp: 0.9, vx: Math.cos(a) * sp, vy: 0.25, vz: Math.sin(a) * sp });
    }
    // lingering flames cooking in the crater after the fireball collapses
    for (let i = 0; i < Math.round(7 * P); i++) {
      const a = rng() * 6.2832, rr = rng() * 1.0 * P;
      spawnPuff(x + Math.cos(a) * rr, 0.5, z + Math.sin(a) * rr,
        { additive: true, base: 0.5, pop: (1.8 + rng() * 1.1) * P, life: 3.4 + rng() * 2.0,
          maxOp: 0.88, spin: (rng() - 0.5) * 2, vy: 0.6 + rng() * 0.8,
          delay: 0.15 + rng() * 0.35 });
    }

    // ---- SMOKE: a tall black COLUMN — many puffs with strong upward velocity and
    // long life so the plume towers and lingers, plus wide low billows for girth. ----
    const nSmoke = Math.round(10 * P);
    for (let i = 0; i < nSmoke; i++) {
      const a = rng() * 6.2832, dr = 0.3 + rng() * 0.6;
      spawnPuff(x + (rng() - 0.5) * 1.6 * P, cy + 0.4 + rng() * 1.0, z + (rng() - 0.5) * 1.6 * P,
        { additive: false, smoke: true, base: 1.8, pop: (6.5 + rng() * 3.5) * P,
          life: 4.2 + rng() * 2.6, maxOp: 0.5, shade: 0.1 + rng() * 0.05,
          spin: (rng() - 0.5) * 1.0,
          vx: Math.cos(a) * dr, vy: 2.2 + rng() * 1.6, vz: Math.sin(a) * dr,
          delay: 0.06 + rng() * 0.2 });
    }
    // the column's upper reaches — slower, darker, the longest-lived smoke
    for (let i = 0; i < Math.round(5 * P); i++) {
      spawnPuff(x + (rng() - 0.5) * 1.0 * P, cy + 2.0 + rng() * 1.5, z + (rng() - 0.5) * 1.0 * P,
        { additive: false, smoke: true, base: 2.2, pop: (7 + rng() * 3) * P,
          life: 5.0 + rng() * 3.0, maxOp: 0.42, shade: 0.09,
          spin: (rng() - 0.5) * 0.8, vy: 1.6 + rng() * 1.2,
          delay: 0.25 + rng() * 0.5 });
    }
    // wide low billows rolling out at the base
    for (let i = 0; i < Math.round(6 * P); i++) {
      const a = rng() * 6.2832, sp = 1.8 + rng() * 2.2;
      spawnPuff(x, 0.7, z, { additive: false, smoke: true, base: 1.4, pop: (5 + rng() * 2.5) * P,
        life: 3.0 + rng() * 1.6, maxOp: 0.34, shade: 0.14, spin: (rng() - 0.5),
        vx: Math.cos(a) * sp, vy: 0.5 + rng() * 0.6, vz: Math.sin(a) * sp, delay: 0.05 + rng() * 0.15 });
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
      const a = rng() * 6.2832, sp = 2 + rng() * 5 * P;
      spawnPuff(x + Math.cos(a) * 0.6, cy + rng() * 1.0, z + Math.sin(a) * 0.6,
        { additive: true, base: 0.2 + rng() * 0.18, pop: 0.1, life: 1.3 + rng() * 1.4,
          maxOp: 1, vx: Math.cos(a) * sp, vy: 4 + rng() * 6, vz: Math.sin(a) * sp });
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

    // STRUCTURAL COUPLING (same contract as cityExplosion above): an airstrike
    // wounds the nearest facade at its impact HEIGHT. buildings.js wraps this too
    // (wrapBlast("cityAirstrikeExplosion")), so we SKIP when that wrap is present
    // and only self-couple as a FALLBACK — exactly one carve, any load order.
    // Carve at the real wall-hit height (opts.y) when given, not the raised
    // air-burst seat. Airstrikes are heavy ordnance → always above the gate.
    // HEAVY READ: an airstrike is by definition power>=2 ordnance, so we floor the
    // power we hand to blastAt to 2.0 — blastAt→debris() then routes to the BIGGER
    // cityHeavyWallRuin (full-facade cascade + collapse curtain + taller plume)
    // instead of the standard rocket ruin. ONE carve only (blastAt owns it), so
    // there is no double-carve with the heavy ruin — the ruin is pure FX layered
    // on the single hole. (buildings.js's wrap, when present, drives the same.)
    if (!opts.noDamage && CBZ.cityFracture && CBZ.cityFracture.blastAt
        && !(CBZ.cityAirstrikeExplosion && CBZ.cityAirstrikeExplosion._structWrapped)) {
      const hy = opts.y != null ? Math.max(1.0, opts.y) : cy;
      const hr = Math.min(4.6, 3.4 + (Math.min(2.4, power) - 1.3) * 0.9);   // big, room-exposing
      const hp = Math.max(2.0, power);   // airstrike → heavy ruin tier in debris()
      try { CBZ.cityFracture.blastAt({ x: x, y: hy, z: z }, hr, { power: hp }); } catch (e) {}
    }
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
    mesh.rotateZ(rng() * Math.PI * 2);
    mesh.position.set(x + _scarN.x * 0.08, y + _scarN.y * 0.08, z + _scarN.z * 0.08);
    mesh.scale.set(size, size, 1);
    mesh.renderOrder = 3;
    scene.add(mesh);
    scars.push({ mesh, mat, t: 0, hold: 80 + rng() * 40 });
  }

  // debris + dust knocked off the face, biased DOWN the wall (an avalanche,
  // not the radial fountain a ground blast throws). tangent = along the wall.
  function facadeAvalanche(x, y, z, nx, nz, power) {
    let tx = -nz, tz = nx;
    const tl = Math.hypot(tx, tz);
    if (tl < 1e-4) { tx = 1; tz = 0; } else { tx /= tl; tz /= tl; }
    const n = Math.min(CHUNK_CAP, Math.max(0, Math.round(7 + 5 * power)));   // cap to the pool: a huge-power blast must not spin the recycle loop / mega-spawn
    while (chunks.length > CHUNK_CAP - n) recycleChunk();
    const fall = Math.sqrt(Math.max(0.5, y) / 8.8);   // time to reach the street under chunk gravity
    for (let i = 0; i < n; i++) {
      const glow = rng() < 0.25;
      const mesh = new THREE.Mesh(chunkGeo, glow ? chunkMatHot : chunkMat);
      const sc = 0.7 + rng() * 1.1;
      const along = (rng() - 0.5) * 2.4;
      mesh.position.set(x + tx * along + nx * 0.3, y + (rng() - 0.3) * 1.6, z + tz * along + nz * 0.3);
      mesh.rotation.set(rng() * 3, rng() * 3, rng() * 3);
      mesh.scale.setScalar(sc);
      scene.add(mesh);
      chunks.push({
        mesh, hh: CHUNK_HH * sc,
        vx: nx * (0.8 + rng() * 2.4) + tx * (rng() - 0.5) * 3,
        vy: 0.5 - rng() * 3,                  // DOWNWARD bias — it pours off the wound
        vz: nz * (0.8 + rng() * 2.4) + tz * (rng() - 0.5) * 3,
        spin: (rng() - 0.5) * 14, t: 0, life: fall + 1.3 + rng() * 0.9,
        rest: 0, settled: false, trail: glow ? 0 : -1,
      });
    }
    // pale concrete dust sheeting down the face below the wound, staggered so
    // it visibly CASCADES instead of appearing all at once
    const drop = Math.min(Math.max(2, y - 0.5), 14);
    const nd = Math.round(7 + 4 * power);
    for (let i = 0; i < nd; i++) {
      const f = i / nd;
      spawnPuff(x + tx * (rng() - 0.5) * 2 + nx * 0.5, y - f * drop, z + tz * (rng() - 0.5) * 2 + nz * 0.5, {
        additive: false, smoke: true, base: 1.0, pop: 3.2 + rng() * 2.2,
        life: 1.7 + rng(), maxOp: 0.42, shade: 0.4 + rng() * 0.08,
        spin: (rng() - 0.5),
        vx: nx * 0.7 + tx * (rng() - 0.5), vy: -(1.5 + rng() * 2.5), vz: nz * 0.7 + tz * (rng() - 0.5),
        delay: f * 0.5 + rng() * 0.08,
      });
    }
  }
  // fracture.js pours wall-hole debris through this same pooled cascade
  CBZ.cityFacadeAvalanche = facadeAvalanche;

  // ---- PERSISTENT RUBBLE HEAP at the base of a wall wound ----
  // Real blasted reinforced concrete dumps a HEAP of masonry on the sidewalk
  // (Red Faction / MechAssault: "down to a pile of dusty rubble"). The flying
  // chunks already tumble + settle, but they scatter thin; this drops a DENSE,
  // CLUSTERED pile that rests immediately and persists like a world prop —
  // overlapping lumps mounded highest near the wall and tapering out, a few
  // larger slab fragments, all seated on the true ground (floorAt).
  // cx,cz = the wall-base point under the wound; nx,nz = outward normal (the
  // heap spills onto the street side); spread/size scale with the hole width.
  function rubbleHeap(cx, cz, nx, nz, spread, size, count) {
    // tangent along the wall so the pile is wider than it is deep
    let tx = -nz, tz = nx; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
    const groundN = nNorm(nx, nz);
    const gx = groundN.x, gz = groundN.y;
    const base = floorAt(cx, cz);
    for (let i = 0; i < count; i++) {
      while (chunks.length > CHUNK_CAP - 1) recycleChunk();
      // bias placement toward the wall + low; pieces farther out sit lower so the
      // heap mounds against the facade and tapers onto the pavement.
      const out = rng() * rng() * spread;       // r^2 → clusters near 0 (the wall)
      const along = (rng() - 0.5) * spread * 1.6;
      const px = cx + gx * (0.35 + out) + tx * along;
      const pz = cz + gz * (0.35 + out) + tz * along;
      // mound height: tall against the wall, thinning outward, plus jitter
      const mound = Math.max(0, (1 - out / (spread + 0.01))) * size * 0.9;
      const big = rng() < 0.28;
      const sc = Math.min(1.8, (big ? 1.1 + rng() * 0.7 : 0.55 + rng() * 0.65) * Math.min(1.25, size));
      const mesh = new THREE.Mesh(big ? rubbleGeo : chunkGeo, rng() < 0.5 ? rubbleMat : rubbleMat2);
      mesh.scale.set(sc, sc * (0.6 + rng() * 0.5), sc * (0.8 + rng() * 0.5));
      const hh = (big ? 0.2 : CHUNK_HH) * sc;
      mesh.position.set(px, floorAt(px, pz) + hh + rng() * mound, pz);
      mesh.rotation.set(rng() * 3, rng() * 6.28, rng() * 3);
      scene.add(mesh);
      // born SETTLED — it's a heap, it doesn't fly. Long rest = persistent prop.
      chunks.push({ mesh, vx: 0, vy: 0, vz: 0, hh, spin: 0, t: 0, life: 1,
        rest: 0, settled: true, trail: -1, heap: true });
    }
  }
  // unit ground normal (guards a near-vertical / zero normal)
  const _nn = { x: 0, y: 1 };
  function nNorm(nx, nz) { const l = Math.hypot(nx, nz); if (l < 1e-3) { _nn.x = 0; _nn.y = 1; } else { _nn.x = nx / l; _nn.y = nz / l; } return _nn; }

  // ---- DANGLING REBAR off the wound's top edge ----
  // The iconic read of blasted reinforced concrete: bent steel bars hanging out
  // of the broken slab. A few thin dark bars rooted at the header line, kinked
  // and drooping outward over the hole. Pooled + persistent (they hold ~80s with
  // the wound, then fade), capped so a mag-dump of rockets can't flood them.
  function dangleRebar(cx, topY, cz, nx, nz, width, n) {
    let tx = -nz, tz = nx; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
    for (let i = 0; i < n; i++) {
      while (rebar.length >= REBAR_CAP) { const o = rebar.shift(); scene.remove(o.group); }
      const along = (rng() - 0.5) * width * 0.85;
      const x = cx + tx * along + nx * 0.12;
      const z = cz + tz * along + nz * 0.12;
      const g = new THREE.Group();
      g.position.set(x, topY - 0.05, z);
      // root segment hangs DOWN out of the broken header, kinked outward
      const len1 = 0.5 + rng() * 0.7;
      const s1 = new THREE.Mesh(rebarGeo, rebarMat);
      s1.scale.y = len1; s1.position.y = -len1 / 2;
      // tilt it outward + a little sideways so bars splay instead of hanging neat
      s1.rotation.z = (rng() - 0.5) * 0.5;
      s1.rotation.x = (nz !== 0 ? 1 : 0) * (0.3 + rng() * 0.5) * (nz > 0 ? 1 : -1);
      g.add(s1);
      // a kinked tip on most bars (the L-bend that sells "torn from concrete")
      if (rng() < 0.75) {
        const len2 = 0.25 + rng() * 0.4;
        const s2 = new THREE.Mesh(rebarGeo, rebarMat);
        s2.scale.y = len2;
        // hang the tip off the bottom of the first segment, bent ~60-100°
        s2.position.set((rng() - 0.5) * 0.1, -len1 - len2 / 2 * 0.4, (rng() - 0.5) * 0.1);
        s2.rotation.z = (rng() - 0.5) * 1.8;
        s2.rotation.x = (rng() - 0.5) * 1.8;
        g.add(s2);
      }
      // splay the whole bundle outward from the facade
      g.rotation.y = Math.atan2(nx, nz) + (rng() - 0.5) * 0.6;
      scene.add(g);
      rebar.push({ group: g, t: 0, hold: 78 + rng() * 40 });
    }
  }

  // ---- SOOT RING decal hugging the wall around the wound ----
  // The owner called the OLD floating brown decal fake — but that was a scar
  // sitting in EMPTY AIR with no hole behind it. Now there is a real carved hole,
  // so a blackened soot ring rimming the wound reads exactly right (research:
  // radial-gradient blackening that fades at the edges, smudges radiating from
  // the epicentre). Reuses the wall-scar pool/updater already in this file.
  function woundScorch(x, y, z, nx, ny, nz, size) {
    addWallScar(x, y, z, nx, ny, nz, size);
  }

  // ============================================================
  // cityWallRuin — the COMPLETE real-blast facade read in one call, composed by
  // fracture.js right after it carves a persistent hole. Layers, big→subtle:
  //   1) debris AVALANCHE pouring down the facade (the existing cascade),
  //   2) a DENSE PERSISTENT RUBBLE HEAP mounded at the wall base on the street,
  //   3) DANGLING REBAR off the broken header edge,
  //   4) a blackened SOOT RING rimming the hole on the wall face,
  //   5) a fat concrete DUST CLOUD bursting out of the wound,
  //   6) a LINGERING smoke wound (60-90s column) so the ruin reads across the
  //      district — wired through addBlastWound.
  // x,y,z = the wound centre on the outer wall plane; nx,nz = outward normal.
  // o = { power, width (hole width), top, bottom } from the carved gap.
  // ============================================================
  CBZ.cityWallRuin = function (x, y, z, nx, nz, o) {
    o = o || {};
    if (!CBZ.game || CBZ.game.mode !== "city") return;
    const power = Math.min(2.4, o.power || 1.4);
    const width = Math.max(1.0, o.width || (2 + power));
    const top = o.top != null ? o.top : y + width * 0.5;
    const bottom = o.bottom != null ? o.bottom : Math.max(0, y - width * 0.5);
    // normalize the outward normal in the ground plane
    const gn = nNorm(nx, nz); nx = gn.x; nz = gn.y;

    // (1) avalanche down the face (scaled to the hit, not capped to a dribble)
    facadeAvalanche(x, y, z, nx, nz, Math.min(2.2, power + 0.2));

    // (2) the persistent RUBBLE HEAP at the base — sized to the hole. A wider,
    //     more powerful hole drops a bigger, deeper pile of more pieces.
    const heapN = Math.round(14 + width * 4 + power * 6);
    const heapSpread = 1.4 + width * 0.5;
    const heapSize = 1.0 + power * 0.25;
    rubbleHeap(x, z, nx, nz, heapSpread, heapSize, heapN);

    // (3) dangling REBAR off the broken header (only if the wound is up off the
    //     deck — a slab edge to tear from; ground-line blasts get fewer bars)
    const nBar = top > 2.2 ? Math.round(3 + width * 0.8) : 2;
    dangleRebar(x, top - 0.1, z, nx, nz, width, Math.min(8, nBar));

    // (4) blackened SOOT RING rimming the hole on the wall face
    woundScorch(x, y, z, nx, 0, nz, width * 1.5 + 1.0);

    // (5) a fat CONCRETE DUST CLOUD punching out of the wound + a low billow that
    //     rolls down to the heap (this is the "dust sheet" the owner asked for)
    pointBurst(x, z, Math.round(22 + 14 * power), 0xa39a8c, 0.5, 3.5 + power * 1.2, 1.2, true, y);
    for (let i = 0; i < Math.round(5 + power * 3); i++) {
      const a = rng() * 6.2832, sp = 1.2 + rng() * 1.8;
      spawnPuff(x + nx * (0.4 + rng() * 0.6), y + (rng() - 0.4) * width * 0.5, z + nz * (0.4 + rng() * 0.6), {
        additive: false, smoke: true, base: 1.4, pop: (4 + rng() * 3) * power,
        life: 2.0 + rng() * 1.4, maxOp: 0.4, shade: 0.36 + rng() * 0.08,
        spin: (rng() - 0.5),
        vx: nx * sp + (rng() - 0.5), vy: 0.3 + rng() * 0.8, vz: nz * sp + (rng() - 0.5),
        delay: rng() * 0.25,
      });
    }
    // low dust rolling down the facade to the rubble pile (staggered cascade)
    const drop = Math.min(Math.max(2, top - bottom), 16);
    for (let i = 0; i < Math.round(5 + power * 2); i++) {
      const f = rng();
      spawnPuff(x + (rng() - 0.5) * width + nx * 0.5, top - f * drop, z + (rng() - 0.5) * width + nz * 0.5, {
        additive: false, smoke: true, base: 1.0, pop: 3.4 + rng() * 2.0,
        life: 1.6 + rng(), maxOp: 0.4, shade: 0.4 + rng() * 0.08,
        spin: (rng() - 0.5),
        vx: nx * 0.5, vy: -(1.5 + rng() * 2.0), vz: nz * 0.5,
        delay: f * 0.5,
      });
    }

    // (6) the wound keeps smoking for a minute-plus — the show-off plume that
    //     tells the whole block a rocket hit here.
    addBlastWound(x, y, z, nx, 0, nz, 60 + rng() * 30);
  };

  // ---- CBZ.cityDustKick — a cheap pooled DUST CLOUD at a blast seat ----------
  // The generic "breath of pulverized debris" a detonation kicks up off the deck,
  // exposed so fracture.js's debris-burst (CBZ.cityFracture(pos,r,dir)) and any
  // other caller can drop a dust pop without owning the puff/point-burst pools.
  // WHY: shrapnel + a scorch alone read dry; the dust is what sells "concrete
  // just shattered here". Pooled (pointBurst ring + spawnPuff pool), so it's
  // draw-call-cheap and can't flood; power scales the volume. Headless-safe.
  CBZ.cityDustKick = function (x, y, z, power) {
    if (!CBZ.game || CBZ.game.mode !== "city") return;
    const P = Math.min(2.6, Math.max(0.4, power || 1));
    const cy = y == null ? 0.4 : y;
    // a fast pale dust spray + a couple of slow rolling billows that linger
    pointBurst(x, z, Math.round(10 + 10 * P), 0x9a9082, 0.45, 2.2 + P * 1.2, 1.0, true, cy);
    for (let i = 0; i < Math.round(2 + P * 2); i++) {
      const a = rng() * 6.2832, sp = 0.8 + rng() * 1.4;
      spawnPuff(x + (rng() - 0.5) * 0.8, cy + 0.2 + rng() * 0.6, z + (rng() - 0.5) * 0.8, {
        additive: false, smoke: true, base: 1.1, pop: (3.2 + rng() * 2.0) * P,
        life: 1.6 + rng() * 1.0, maxOp: 0.34, shade: 0.36 + rng() * 0.08,
        spin: (rng() - 0.5),
        vx: Math.cos(a) * sp, vy: 0.5 + rng() * 0.8, vz: Math.sin(a) * sp,
        delay: rng() * 0.12,
      });
    }
  };

  // ---- COLLAPSE CURTAIN — pooled chunks raining the FULL height of a facade ---
  // Heavy ordnance doesn't just punch a hole — the wall above the wound SHEDS, a
  // sheet of masonry sloughing the whole way down to the street. This rains a
  // power-scaled (CAPPED) curtain of pooled chunks distributed across the height
  // from topY down to bottomY, all biased DOWNWARD so they pour rather than fly.
  // Reuses the shared chunk pool + recycleChunk (CHUNK_CAP bounds it), so even a
  // 6-missile salvo can't flood it. x,z = wound column; nx,nz = outward normal.
  function collapseCurtain(x, z, nx, nz, topY, bottomY, width, count) {
    let tx = -nz, tz = nx; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
    const n = Math.min(CHUNK_CAP, Math.max(0, count | 0));   // cap to the pool (curtain salvo can't flood or spin the recycle loop)
    while (chunks.length > CHUNK_CAP - n) recycleChunk();
    const span = Math.max(1, topY - bottomY);
    for (let i = 0; i < n; i++) {
      const glow = rng() < 0.18;
      const mesh = new THREE.Mesh(chunkGeo, glow ? chunkMatHot : chunkMat);
      const sc = 0.7 + rng() * 1.3;
      // distribute up the column (biased toward the upper half — the wall above
      // the wound is what comes down) and across the wound width along the face
      const h = bottomY + Math.pow(rng(), 0.7) * span;
      const along = (rng() - 0.5) * width * 1.1;
      mesh.position.set(x + tx * along + nx * 0.3, h, z + tz * along + nz * 0.3);
      mesh.rotation.set(rng() * 3, rng() * 3, rng() * 3);
      mesh.scale.setScalar(sc);
      scene.add(mesh);
      const fall = Math.sqrt(Math.max(0.5, h) / 8.8);
      chunks.push({
        mesh, hh: CHUNK_HH * sc,
        vx: nx * (0.4 + rng() * 1.8) + tx * (rng() - 0.5) * 2.2,
        vy: -(0.5 + rng() * 2.5),               // pours straight down the face
        vz: nz * (0.4 + rng() * 1.8) + tz * (rng() - 0.5) * 2.2,
        spin: (rng() - 0.5) * 12, t: 0, life: fall + 1.4 + rng() * 1.0,
        rest: 0, settled: false, trail: glow ? 0 : -1,
      });
    }
  }

  // ============================================================
  // cityHeavyWallRuin — the BIGGER, taller facade read for HEAVY ordnance
  // (power>=2: airstrike / missile / tank). Everything cityWallRuin does, then a
  // SECOND tier staged DOWN the whole facade from the wound to the street, a
  // collapse curtain raining the full height, a taller dust column and a fatter
  // persistent rubble heap — so a bomb reads as a bomb, not a rocket. All on the
  // existing pooled chunk/puff/scorch systems (CHUNK_CAP recycle bounds it), so
  // it's draw-call-neutral and a salvo can't flood it (curtain count is capped).
  // x,y,z = wound centre on the outer wall plane; nx,nz = outward normal.
  // o = { power, width, top, bottom } from the carved gap (same as cityWallRuin).
  // ============================================================
  CBZ.cityHeavyWallRuin = function (x, y, z, nx, nz, o) {
    o = o || {};
    if (!CBZ.game || CBZ.game.mode !== "city") return;
    const power = Math.min(2.6, o.power || 2);
    const width = Math.max(1.2, o.width || (2 + power));
    const top = o.top != null ? o.top : y + width * 0.5;
    const bottom = o.bottom != null ? o.bottom : Math.max(0, y - width * 0.5);
    const gn = nNorm(nx, nz); nx = gn.x; nz = gn.y;

    // (a) the standard ruin does the core hole read (avalanche + heap + rebar +
    //     soot ring + dust + smoking wound). Build everything bigger ON TOP.
    if (CBZ.cityWallRuin) CBZ.cityWallRuin(x, y, z, nx, nz, o);

    // (b) a SECOND avalanche tier sheeting the FULL facade from wound to street —
    //     a much larger drop than the core ruin's, with a tall staggered dust
    //     column so the whole wall visibly cascades, not just the wound lip.
    facadeAvalanche(x, y, z, nx, nz, Math.min(2.4, power + 0.3));
    const drop = Math.min(Math.max(3, top - 0.5), 26);   // extend the cascade to the wound HEIGHT
    const nCol = Math.round(8 + power * 4);
    for (let i = 0; i < nCol; i++) {
      const f = i / nCol;                                 // staggered top→bottom
      spawnPuff(x + (rng() - 0.5) * width * 1.2 + nx * 0.5, top - f * drop,
        z + (rng() - 0.5) * width * 1.2 + nz * 0.5, {
          additive: false, smoke: true, base: 1.2, pop: (4.0 + rng() * 2.6) * power,
          life: 2.0 + rng() * 1.4, maxOp: 0.44, shade: 0.38 + rng() * 0.08,
          spin: (rng() - 0.5),
          vx: nx * 0.6 + (rng() - 0.5), vy: -(1.6 + rng() * 2.6), vz: nz * 0.6 + (rng() - 0.5),
          delay: f * 0.6 + rng() * 0.08,
        });
    }
    // a tall dust COLUMN boiling up off the wound (the bomb's signature plume)
    pointBurst(x, z, Math.round(20 + 14 * power), 0xa39a8c, 0.55, 2.0 + power, 1.4, true, y + width * 0.4);

    // (c) the COLLAPSE CURTAIN — 12–18 extra pooled chunks (power-scaled, capped)
    //     raining the full height from the wound up to the street, biased down.
    const curtainN = Math.min(18, Math.round(12 + power * 3));
    collapseCurtain(x, z, nx, nz, Math.max(top, y + width), bottom, width, curtainN);

    // (d) a FATTER, taller persistent rubble heap (~1.5x spread + count) — a bomb
    //     dumps a deeper pile of masonry on the sidewalk than a rocket.
    const heapN = Math.round((14 + width * 4 + power * 6) * 1.5);
    const heapSpread = (1.4 + width * 0.5) * 1.5;
    const heapSize = (1.0 + power * 0.25) * 1.15;
    rubbleHeap(x, z, nx, nz, heapSpread, heapSize, heapN);
  };

  // ============================================================
  // CBZ.cityAirstrikeCollapse(lot) — a building PARTIAL COLLAPSE for the heaviest
  // hits (airstrike / missile / tank). The contract endpoint the player-air +
  // armored agents call when a structure takes ordnance it can't shrug off: a
  // section of the building SLOUGHS — a wide collapse curtain + heap raining down
  // a facade, a parapet block knocked loose off the roofline, a fat dust pall and
  // a lingering smoke wound. WHY: a tank shell into a tower that leaves it pristine
  // reads fake; this is the visible "you brought the corner DOWN" beat. Accepts a
  // lot ({cx,cz,w,d,building}) OR a bare position {x,z}; resolves the building's
  // tallest wall + footprint from the live colliders either way. Pooled (chunk /
  // puff / scorch caps), draw-call-cheap, headless-safe, and self-throttled so a
  // missile salvo on one building can't re-collapse it every frame.
  // ============================================================
  const _collapseSeen = new Map();   // building-key -> last collapse time (anti-spam)
  CBZ.cityAirstrikeCollapse = function (lot, opts) {
    opts = opts || {};
    if (!CBZ.game || CBZ.game.mode !== "city") return;
    // resolve a centre + footprint from a lot OR a bare position
    let cx, cz, half = 8, key = null;
    if (lot && lot.cx != null) {
      cx = lot.cx; cz = lot.cz;
      half = Math.max(4, Math.min((lot.w || 16), (lot.d || 16)) * 0.5);
      key = Math.round(cx) + "," + Math.round(cz);
    } else if (lot && (lot.x != null || lot.point)) {
      const p = lot.point || lot; cx = p.x; cz = p.z;
      key = Math.round(cx) + "," + Math.round(cz);
    } else if (lot && lot.building && lot.building.group) {
      cx = lot.building.group.position.x; cz = lot.building.group.position.z;
      key = Math.round(cx) + "," + Math.round(cz);
    } else return;
    // SELF-THROTTLE: one collapse per building per ~2.5s — a salvo of missiles
    // adds more rubble than re-running the whole sequence every impact.
    const tNow = performance.now() / 1000;
    if (key) {
      const last = _collapseSeen.get(key);
      if (last != null && tNow - last < 2.5) return;
      if (_collapseSeen.size > 64) {            // bound the dedup map
        _collapseSeen.forEach((v, k) => { if (tNow - v > 12) _collapseSeen.delete(k); });
      }
      _collapseSeen.set(key, tNow);
    }
    const power = Math.min(2.6, opts.power || 2.2);
    // find the building's TALLEST wall near the centre to anchor the collapsing
    // face + read the roof height (the same wall AABBs cityBreach/cityScorch use).
    let topY = -1, faceX = cx, faceZ = cz, fnx = 0, fnz = 1, found = false;
    const cols = CBZ.colliders || [];
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i];
      if (c.y1 == null || !c.ref) continue;
      const mt = c.ref.material; if (mt && mt.transparent) continue;   // skip glass
      const bx = (c.minX + c.maxX) / 2, bz = (c.minZ + c.maxZ) / 2;
      if (Math.abs(bx - cx) > half + 2 || Math.abs(bz - cz) > half + 2) continue;
      const ex = c.maxX - c.minX, ez = c.maxZ - c.minZ;
      if (Math.min(ex, ez) > 1.2) continue;                            // walls only, not slabs
      if (c.y1 <= topY) continue;
      topY = c.y1; found = true;
      // outward normal = the broad face pointing away from the building centre
      if (ex >= ez) { fnz = bz < cz ? -1 : 1; fnx = 0; faceZ = fnz < 0 ? c.minZ - 0.1 : c.maxZ + 0.1; faceX = bx; }
      else { fnx = bx < cx ? -1 : 1; fnz = 0; faceX = fnx < 0 ? c.minX - 0.1 : c.maxX + 0.1; faceZ = bz; }
    }
    if (!found) topY = Math.max(8, opts.top || 12);                    // no wall? assume a mid-rise
    const gn = nNorm(fnx, fnz); fnx = gn.x; fnz = gn.y;
    // the collapsing section spans a chunk of the upper facade
    const top = topY;
    const bottom = Math.max(0, topY * 0.35);
    const width = Math.max(3, half * 0.9);
    const woundY = (top + bottom) * 0.5;

    // (1) a WIDE collapse curtain raining the section down the face (capped)
    const curtainN = Math.min(26, Math.round(16 + power * 4));
    collapseCurtain(faceX, faceZ, fnx, fnz, top, bottom, width, curtainN);
    // (2) a big avalanche + a deep persistent rubble heap mounded at the base
    facadeAvalanche(faceX, woundY, faceZ, fnx, fnz, Math.min(2.4, power + 0.2));
    rubbleHeap(faceX, faceZ, fnx, fnz, (1.6 + width * 0.4) * 1.4, 1.2 + power * 0.25, Math.round(20 + width * 3));
    // (3) knock a parapet/coping block loose off the roofline (it tumbles down)
    if (topY > 7) {
      let px = fnx, pz = fnz;
      if (Math.hypot(px, pz) < 0.3) { const a = rng() * 6.2832; px = Math.cos(a); pz = Math.sin(a); }
      parapetChunk(faceX, topY, faceZ, px, pz);
      if (power >= 2.2) parapetChunk(faceX + (rng() - 0.5) * width, topY, faceZ + (rng() - 0.5) * width, px, pz);
    }
    // (4) a fat dust PALL rolling off the collapsing section + a tall column
    pointBurst(faceX, faceZ, Math.round(24 + 16 * power), 0xa39a8c, 0.6, 2.4 + power, 1.5, true, woundY);
    for (let i = 0; i < Math.round(6 + power * 3); i++) {
      const a = rng() * 6.2832, sp = 1.4 + rng() * 2.2;
      spawnPuff(faceX + fnx * (0.4 + rng()), woundY + (rng() - 0.3) * width, faceZ + fnz * (0.4 + rng()), {
        additive: false, smoke: true, base: 1.6, pop: (5 + rng() * 3) * power,
        life: 3.0 + rng() * 1.8, maxOp: 0.42, shade: 0.34 + rng() * 0.08,
        spin: (rng() - 0.5),
        vx: fnx * sp + (rng() - 0.5), vy: 0.6 + rng() * 1.0, vz: fnz * sp + (rng() - 0.5),
        delay: rng() * 0.3,
      });
    }
    // low dust cascading down the whole face to the heap (staggered)
    const drop = Math.min(Math.max(3, top - bottom), 26);
    for (let i = 0; i < Math.round(7 + power * 3); i++) {
      const f = rng();
      spawnPuff(faceX + (rng() - 0.5) * width + fnx * 0.5, top - f * drop, faceZ + (rng() - 0.5) * width + fnz * 0.5, {
        additive: false, smoke: true, base: 1.2, pop: 3.6 + rng() * 2.4,
        life: 1.8 + rng() * 1.2, maxOp: 0.42, shade: 0.4 + rng() * 0.08,
        spin: (rng() - 0.5),
        vx: fnx * 0.5, vy: -(1.6 + rng() * 2.4), vz: fnz * 0.5,
        delay: f * 0.6,
      });
    }
    // (5) the collapse keeps smoking for a minute-plus + a ground scorch ring
    addBlastWound(faceX, woundY, faceZ, fnx, 0, fnz, 60 + rng() * 30);
    addScorch(faceX + fnx * 1.2, faceZ + fnz * 1.2, width * 0.5 + 2, 18);
    // (6) feedback — a heavy structural rumble (sound is owned by the caller's
    // explosion; we add the felt shake of a section coming down).
    if (CBZ.shake) CBZ.shake(Math.min(4.0, 2.4 + power));
    // (7) escalate the building's persistent damage state so the wall STAYS hurt.
    if (CBZ.cityDamageBuilding) { try { CBZ.cityDamageBuilding(faceX, woundY, faceZ, Math.min(3, power)); } catch (e) {} }
  };

  function addBlastWound(x, y, z, nx, ny, nz, dur) {
    while (wounds.length >= 3) wounds.shift();   // 3 live wounds max — the oldest stops smoking
    wounds.push({ x, y, z, nx, ny, nz, t: 0, dur, acc: 0.2 });
  }

  function parapetChunk(x, topY, z, nx, nz) {
    while (chunks.length > CHUNK_CAP - 1) recycleChunk();
    const mesh = new THREE.Mesh(chunkGeo, chunkMat);
    const sy = 2.0 + rng() * 0.8;
    mesh.scale.set(2.4 + rng() * 0.7, sy, 2.4 + rng() * 0.7);  // bounded coping fragments, never facade slabs
    mesh.position.set(x + nx * 0.8, topY + 0.5, z + nz * 0.8);
    mesh.rotation.set(rng() * 3, rng() * 3, rng() * 3);
    scene.add(mesh);
    chunks.push({
      mesh, hh: CHUNK_HH * sy,
      vx: nx * (1.5 + rng() * 2), vy: 1.2 + rng() * 1.5, vz: nz * (1.5 + rng() * 2),
      spin: (rng() - 0.5) * 6, t: 0, life: Math.sqrt(Math.max(1, topY) / 8.8) + 2.2,
      rest: 0, settled: false, trail: -1,
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
    // (1) NO painted scar. The persistent mark is the REAL carved hole
    //     (buildings.js cityCarveWall via the cityExplosion → fracture chain) —
    //     the user filmed the old floating brown decal and called it exactly
    //     what it was: fake. Where no wall can carve (glass curtain towers),
    //     the shattered panes themselves are the mark.
    // (2) avalanche down the facade (roof hits just scatter debris on the deck)
    if (roof) addChunks(x, z, Math.round(5 + 4 * power), 3.5, false, null, y);
    else facadeAvalanche(x, y, z, nx, nz, power);
    // a breath of concrete dust out of the wound itself
    pointBurst(x, z, Math.round(16 + 10 * power), 0x9a9082, 0.42, 3.5 + power, 1.0, true, y);
    // (3) the wound smokes for a minute-plus — visible across the district
    addBlastWound(x, y, z, nx, ny, nz, 60 + rng() * 30);
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
      if (Math.hypot(px, pz) < 0.3) { const a = rng() * 6.2832; px = Math.cos(a); pz = Math.sin(a); }
      parapetChunk(x, topY, z, px, pz);
    }
  };

  // fresh run → cold facades (fpsmode's reset path calls this with the pocks)
  CBZ.cityBlastFxReset = function () {
    wounds.length = 0;
    smolders.length = 0;
    for (const s of scars) { scene.remove(s.mesh); s.mat.dispose(); }
    scars.length = 0;
    for (const rb of rebar) scene.remove(rb.group);   // shared geo/mats — remove only
    rebar.length = 0;
    if (_collapseSeen) _collapseSeen.clear();          // fresh run → un-throttle collapses
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
    // dangling rebar: hold with the wound, then quietly retire (no fade — steel
    // doesn't fade; we just despawn it once the wound has long stopped smoking).
    for (let i = rebar.length - 1; i >= 0; i--) {
      const rb = rebar[i]; rb.t += dt;
      if (rb.t >= rb.hold) { scene.remove(rb.group); rebar.splice(i, 1); }
    }
    // wounded facades keep smoking: ~2 puffs/s drifting up + out of the hole,
    // thinning as the wound cools; the first beats still cook with flame licks
    for (let i = wounds.length - 1; i >= 0; i--) {
      const w = wounds[i]; w.t += dt;
      if (w.t >= w.dur) { wounds.splice(i, 1); continue; }
      w.acc -= dt;
      if (w.acc > 0) continue;
      w.acc = 0.45 + rng() * 0.35;
      const cool = 1 - w.t / w.dur;
      spawnPuff(w.x + w.nx * 0.6 + (rng() - 0.5) * 0.5, w.y + 0.3, w.z + w.nz * 0.6 + (rng() - 0.5) * 0.5, {
        additive: false, smoke: true, base: 0.9, pop: (3.2 + rng() * 2.2) * (0.55 + 0.45 * cool),
        life: 3.6 + rng() * 1.6, maxOp: 0.32 * (0.45 + 0.55 * cool), shade: 0.12 + rng() * 0.04,
        spin: (rng() - 0.5) * 0.8,
        vx: w.nx * (0.5 + rng() * 0.4) + (rng() - 0.5) * 0.3,
        vy: 1.1 + rng() * 0.8,
        vz: w.nz * (0.5 + rng() * 0.4) + (rng() - 0.5) * 0.3,
      });
      if (w.t < 6) spawnPuff(w.x + w.nx * 0.3, w.y, w.z + w.nz * 0.3, {
        additive: true, base: 0.35, pop: 1.1 + rng() * 0.7, life: 0.6 + rng() * 0.4,
        maxOp: 0.85, vy: 0.7, spin: (rng() - 0.5) * 2,
      });
    }
    // smoking craters: a thin smoke column rises off each big-blast scorch,
    // thinning as it cools; the first beats still glow with small flame licks.
    for (let i = smolders.length - 1; i >= 0; i--) {
      const w = smolders[i]; w.t += dt;
      if (w.t >= w.dur) { smolders.splice(i, 1); continue; }
      w.acc -= dt;
      if (w.acc > 0) continue;
      w.acc = 0.5 + rng() * 0.4;
      const cool = 1 - w.t / w.dur;
      spawnPuff(w.x + (rng() - 0.5) * 0.9, 0.6, w.z + (rng() - 0.5) * 0.9, {
        additive: false, smoke: true, base: 1.0, pop: (3.4 + rng() * 2.4) * (0.5 + 0.5 * cool),
        life: 3.4 + rng() * 1.8, maxOp: 0.3 * (0.4 + 0.6 * cool), shade: 0.12 + rng() * 0.04,
        spin: (rng() - 0.5) * 0.8,
        vx: (rng() - 0.5) * 0.4, vy: 1.2 + rng() * 0.7, vz: (rng() - 0.5) * 0.4,
      });
      if (w.t < 5) spawnPuff(w.x, 0.4, w.z, {
        additive: true, base: 0.35, pop: 1.0 + rng() * 0.6, life: 0.6 + rng() * 0.4,
        maxOp: 0.8, vy: 0.7, spin: (rng() - 0.5) * 2,
      });
    }
    const grav = (CBZ.TUNE && CBZ.TUNE.gravity) || 22;
    for (let i = bursts.length - 1; i >= 0; i--) {
      const b = bursts[i]; b.t += dt;
      // step ONLY the live particles. n = count*3 for a pooled slot (its buffer
      // is BURST_MAX long but only `count` are alive) and the full length for the
      // legacy per-blast path — identical motion to before in both cases.
      const n = b.n != null ? b.n : b.pos.length;
      for (let j = 0; j < n; j += 3) {
        b.vel[j + 1] -= grav * (b.dust ? 0.16 : 0.65) * dt;
        b.pos[j] += b.vel[j] * dt; b.pos[j + 1] += b.vel[j + 1] * dt; b.pos[j + 2] += b.vel[j + 2] * dt;
      }
      b.geo.attributes.position.needsUpdate = true;
      b.mat.opacity = Math.max(0, (b.op0 != null ? b.op0 : (b.dust ? 0.5 : 0.95)) * (1 - b.t / b.life));
      if (b.t >= b.life) {
        if (b.slot) {
          // POOLED: just retire the slot for reuse — no scene churn, no dispose,
          // no GC. (If the slot was already re-acquired by a later burst its
          // .live points elsewhere; only clear it if it still references us.)
          b.mesh.visible = false; b.geo.setDrawRange(0, 0);
          if (b.slot.live === b) b.slot.live = null;
        } else {
          scene.remove(b.mesh); b.geo.dispose(); b.mat.dispose();
        }
        bursts.splice(i, 1);
      }
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
      const c = chunks[i]; c.t += dt;
      const p = c.mesh.position;
      if (c.settled) {
        // SETTLED: the piece RESTS on the road as a permanent prop of the world
        // (no per-frame physics). It lingers up to ~60s, then quietly retires —
        // but the population-pool recycle evicts it first if space is needed, so
        // nothing ever pops out from under the player's eye.
        c.rest += dt;
        // a RUBBLE-HEAP piece is the permanent ruin — it persists far longer
        // (the population-pool recycle still evicts it if space is needed AND
        // it's off-screen, so it never pops out under the player's eye).
        if (c.rest > (c.heap ? 180 : 18)) { scene.remove(c.mesh); chunks.splice(i, 1); }
        continue;
      }
      c.vy -= grav * 0.8 * dt; // mild gravity so shrapnel hangs
      p.x += c.vx * dt; p.y += c.vy * dt; p.z += c.vz * dt;
      c.mesh.rotation.x += c.spin * dt; c.mesh.rotation.z += c.spin * 0.7 * dt;
      // GROUND REST: a chunk's BOTTOM meets the actual ground (floorAt: street,
      // rooftop, raised terrain), seated by its half-height + a hair of offset so
      // it never z-fights the road paint. Bounce loses most of its energy; once
      // it is slow + low it SETTLES FLAT (kills jitter) and becomes permanent.
      const hh = c.hh || 0.09;
      const fl = floorAt(p.x, p.z) + hh + 0.015;
      if (p.y <= fl) {
        p.y = fl;
        if (c.vy < 0) c.vy *= -0.25;              // damped bounce
        c.vx *= 0.6; c.vz *= 0.6; c.spin *= 0.55;
        const slow = (c.vx * c.vx + c.vy * c.vy + c.vz * c.vz) < 0.6;
        if (slow || c.t > c.life) {
          c.settled = true; c.rest = 0;
          c.vx = c.vy = c.vz = 0; c.spin = 0;
          // lie flat on the deck rather than frozen at a tumble angle
          c.mesh.rotation.x = (rng() - 0.5) * 0.5;
          c.mesh.rotation.z = (rng() - 0.5) * 0.5;
        }
      }
      // glowing shards drip a faint ember spark every so often as they fly
      if (c.trail >= 0 && c.t < 0.6) {
        c.trail += dt;
        if (c.trail > 0.06) { c.trail = 0; spawnPuff(p.x, p.y, p.z, { additive: true, base: 0.16, pop: 0.05, life: 0.35, maxOp: 0.9, vy: -1 }); }
      }
      // safety: an in-flight piece that never found ground (flung off the map)
      // still retires so it can't leak the pool.
      if (!c.settled && c.t > c.life + 2.5) { scene.remove(c.mesh); chunks.splice(i, 1); }
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
