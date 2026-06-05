/* ============================================================
   city/crowd.js — instanced BACKGROUND mass crowd for the city.

   Reuses the jail crowd's InstancedMesh body-part technique
   (entities/crowd.js) but is written NATIVELY in city coordinates — no
   prison-zone graph, no z≈-700 offset bookkeeping, no web-worker society
   sim. The near-camera detail and ALL interaction stay with the per-rig
   CBZ.cityPeds; this layer is pure ambient density: hundreds of little
   people walking the sidewalks, filling the streets out to the fog.

   Each agent strolls between sidewalk waypoints (city/world.js
   randomSidewalkPoint, clamped into the city). Six instanced parts per
   body (shirt torso + skin head/arms + pants legs) with per-instance
   tint and a cheap leg/arm stride. The whole thing is ONE Group toggled
   by mode; the simulation is pure math (testable headlessly), and the
   render no-ops where THREE.InstancedMesh is unavailable.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ, THREE = window.THREE;
  if (!CBZ || !THREE) return;

  const CAP = 360;                       // hard ceiling on instanced bodies
  let count = 0, built = false, ready = false;

  // --- agent state (flat arrays; index 0..count-1) ---
  const px = new Float32Array(CAP), pz = new Float32Array(CAP);   // position (world/city coords)
  const tx = new Float32Array(CAP), tz = new Float32Array(CAP);   // current sidewalk target
  const heading = new Float32Array(CAP), spd = new Float32Array(CAP), phase = new Float32Array(CAP);
  const skin = new Int32Array(CAP), shirt = new Int32Array(CAP), hairC = new Int32Array(CAP);

  const SKINS = [0xf1c9a5, 0xe0a878, 0xc68642, 0x8d5524, 0xffdbac, 0xa66a3c];
  const SHIRTS = [0x3a6ea5, 0x9c3b3b, 0x4a7a44, 0xb8973f, 0x6a4a8a, 0x444a52, 0xb06a3a, 0x2f8a8a, 0xcfcfcf, 0x356b9a];
  const HAIRS = [0x1a1410, 0x2a2018, 0x3b2a1a, 0x6b4a2a, 0x8a6a3a, 0x101010, 0x55524e, 0x4a3520];

  let root, wm = null;
  // full body + FACE so the city crowd reads as PEOPLE, not short faceless boxes —
  // same parts + proportions as the jail mass-crowd (entities/crowd.js).
  let torso, hd, hair, armL, armR, legL, legR, eyeL, eyeR, mouth, meshes = null;
  const rootD = new THREE.Object3D(), partD = new THREE.Object3D(), col = new THREE.Color();

  // ---- ON-DEMAND PROMOTION (same idea as the jail mass-crowd face-rigs) ----
  // The nearest ambient agents become REAL, fully interactive city peds (added
  // to CBZ.cityPeds, so the ped brain @34 AND the city interaction menu just
  // work on them) as you walk up, then get parked back to instanced density
  // when you walk away. Without this the city crowd was render-only and dead to
  // interaction — you could walk into someone and nothing happened.
  const PROMO = 18;                              // pool of interactive peds kept near you
  const PROMO_IN2 = 22 * 22;                     // promote-in radius (any direction)
  // FAR REACH: an agent in your sightline (ahead of the camera) gets promoted to a
  // real, shoot/run-over-able ped from much farther out, so anyone you can SEE down
  // the street is fully real before you reach them — not a phantom that pops in.
  const PROMO_AHEAD2 = 40 * 40;                  // promote-in distance for agents in front of you
  const AHEAD_DOT = 0.35;                        // cone half-width for "ahead of the camera"
  // demote-out must sit BEYOND the farthest promote-in (the ahead range) so a
  // body promoted way down the street doesn't instantly flicker back to density.
  const PROMO_OUT2 = 48 * 48;                    // hysteresis: park only past this
  const PARK = -4000;                            // where parked pool peds wait, off-map
  const promotedBy = new Int32Array(CAP);        // crowd index -> pool slot (or -1)
  const deadAgent = new Uint8Array(CAP);         // agent fully removed (corpse faded)
  const corpseT = new Float32Array(CAP);         // >0 = freshly killed, lying as a body for this many sec
  let pool = [], poolBuilt = false;
  promotedBy.fill(-1);

  // a UNIT (1×1×1) box scaled per-part at render time, jail-crowd style. Tinted
  // parts need a white color attribute (r128 USE_COLOR multiplies by 0 → black);
  // solid parts (legs/eyes/mouth) use a plain unit box.
  function tintUnit() {
    const g = new THREE.BoxGeometry(1, 1, 1);
    const n = g.attributes.position.count, white = new Float32Array(n * 3); white.fill(1);
    g.setAttribute("color", new THREE.BufferAttribute(white, 3));
    return g;
  }

  function buildMeshes() {
    if (built) return;
    if (!THREE.InstancedMesh) return;    // headless / no-instancing → sim only, no render
    built = true;
    wm = new THREE.Matrix4();
    root = new THREE.Group(); root.name = "city-crowd"; root.visible = false;
    CBZ.scene.add(root);
    const unitT = tintUnit();                              // shared geom for all tinted parts
    const unitP = new THREE.BoxGeometry(1, 1, 1);          // shared geom for solid parts
    const skinMat = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true });
    const shirtMat = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true });
    const hairMat = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true });
    const pants = CBZ.mat ? CBZ.mat(0x2c3038) : new THREE.MeshLambertMaterial({ color: 0x2c3038 });
    const dark = CBZ.mat ? CBZ.mat(0x141414) : new THREE.MeshLambertMaterial({ color: 0x141414 });
    function part(mat, geo) {
      const m = new THREE.InstancedMesh(geo, mat, CAP);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.castShadow = false; m.receiveShadow = true; m.frustumCulled = false;
      root.add(m); return m;
    }
    torso = part(shirtMat, unitT);
    hd = part(skinMat, unitT);
    hair = part(hairMat, unitT);
    armL = part(skinMat, unitT); armR = part(skinMat, unitT);
    legL = part(pants, unitP); legR = part(pants, unitP);
    eyeL = part(dark, unitP); eyeR = part(dark, unitP); mouth = part(dark, unitP);
    meshes = [torso, hd, hair, armL, armR, legL, legR, eyeL, eyeR, mouth];
    ready = true;
  }

  function arena() { return CBZ.city && CBZ.city.arena; }
  const _tmp = { x: 0, z: 0 };
  function pickWaypoint(out) {            // a sidewalk point, kept inside the city
    const A = arena(); if (!A) { out.x = 0; out.z = 0; return; }
    const p = A.randomSidewalkPoint();
    if (A.clampToCity) A.clampToCity(p, 0.6);
    out.x = p.x; out.z = p.z;
  }

  CBZ.spawnCityCrowd = function (n) {
    buildMeshes();
    const A = arena(); if (!A) { count = 0; return 0; }
    count = Math.max(0, Math.min(CAP, n | 0));
    if (poolBuilt) releaseAll();                 // un-assign any held peds before re-seeding
    promotedBy.fill(-1); deadAgent.fill(0); corpseT.fill(0);
    for (let i = 0; i < count; i++) {
      pickWaypoint(_tmp); px[i] = _tmp.x; pz[i] = _tmp.z;
      pickWaypoint(_tmp); tx[i] = _tmp.x; tz[i] = _tmp.z;
      heading[i] = Math.atan2(tx[i] - px[i], tz[i] - pz[i]);
      spd[i] = 1.0 + Math.random() * 1.6;
      phase[i] = Math.random() * 6.2832;
      skin[i] = (Math.random() * SKINS.length) | 0;
      shirt[i] = (Math.random() * SHIRTS.length) | 0;
      hairC[i] = (Math.random() * HAIRS.length) | 0;
    }
    paintColors();
    if (ready) render(0);                 // place them so frame 0 isn't a pile at the origin
    return count;
  };
  CBZ.cityCrowdReset = function () { CBZ.spawnCityCrowd(count || ((CBZ.CITY && CBZ.CITY.crowd) || 320)); };
  // tiny debug accessors (used by the headless harness; cheap, read-only)
  CBZ.cityCrowdCount = function () { return count; };
  CBZ.cityCrowdAgent = function (i) { return { x: px[i], z: pz[i], tx: tx[i], tz: tz[i], heading: heading[i] }; };

  function paintColors() {
    if (!ready) return;
    for (let i = 0; i < count; i++) {
      col.setHex(SHIRTS[shirt[i]]); torso.setColorAt(i, col);
      col.setHex(SKINS[skin[i]]); hd.setColorAt(i, col); armL.setColorAt(i, col); armR.setColorAt(i, col);
      col.setHex(HAIRS[hairC[i]]); hair.setColorAt(i, col);
    }
    [torso, hd, hair, armL, armR].forEach(function (m) { if (m.instanceColor) m.instanceColor.needsUpdate = true; });
  }

  // pure-math simulation: stroll toward the target, repick on arrival.
  function sim(dt) {
    const A = arena(); if (!A) return;
    for (let i = 0; i < count; i++) {
      if (deadAgent[i]) continue;
      if (corpseT[i] > 0) { corpseT[i] -= dt; if (corpseT[i] <= 0) deadAgent[i] = 1; continue; }  // lying dead → fade out
      if (promotedBy[i] >= 0) continue;                   // a real promoted ped owns this one
      let dx = tx[i] - px[i], dz = tz[i] - pz[i], d = Math.hypot(dx, dz);
      if (d < 1.4) { pickWaypoint(_tmp); tx[i] = _tmp.x; tz[i] = _tmp.z; dx = tx[i] - px[i]; dz = tz[i] - pz[i]; d = Math.hypot(dx, dz); }
      const inv = 1 / (d || 1);
      const want = Math.atan2(dx, dz);
      heading[i] = CBZ.lerpAngle ? CBZ.lerpAngle(heading[i], want, 1 - Math.pow(0.0015, dt)) : want;
      const step = spd[i] * dt;
      px[i] += dx * inv * step; pz[i] += dz * inv * step;
      phase[i] += spd[i] * 2.4 * dt;
    }
  }

  function put(mesh, i, lx, ly, lz, sx, sy, sz, rx) {
    partD.position.set(lx, ly, lz);
    partD.rotation.set(rx || 0, 0, 0);
    partD.scale.set(sx, sy, sz);
    partD.updateMatrix();
    wm.multiplyMatrices(rootD.matrix, partD.matrix);
    mesh.setMatrixAt(i, wm);
  }
  // the 10 body parts at standard proportions (matches the jail mass-crowd)
  function drawParts(i, sw, bob) {
    put(torso, i, 0, 1.42 + bob, 0, 0.82, 0.88, 0.44, 0);
    put(hd, i, 0, 2.18 + bob, 0, 0.54, 0.54, 0.54, 0);
    put(hair, i, 0, 2.50 + bob, 0, 0.58, 0.14, 0.58, 0);
    put(legL, i, -0.20, 0.52, 0, 0.28, 0.92, 0.28, sw);
    put(legR, i, 0.20, 0.52, 0, 0.28, 0.92, 0.28, -sw);
    put(armL, i, -0.55, 1.40 + bob, 0, 0.24, 0.78, 0.24, -sw * 0.82);
    put(armR, i, 0.55, 1.40 + bob, 0, 0.24, 0.78, 0.24, sw * 0.82);
    put(eyeL, i, -0.12, 2.235 + bob, 0.235, 0.10, 0.13, 0.06, 0);
    put(eyeR, i, 0.12, 2.235 + bob, 0.235, 0.10, 0.13, 0.06, 0);
    put(mouth, i, 0, 2.045 + bob, 0.235, 0.20, 0.05, 0.05, 0);
  }
  function render() {
    if (!ready || !count) return;
    for (let i = 0; i < count; i++) {
      if (deadAgent[i] || promotedBy[i] >= 0) {        // faded corpse, or promoted to a real rig → collapse the instanced body
        wm.makeScale(0.0001, 0.0001, 0.0001); wm.setPosition(0, PARK, 0);
        for (let m = 0; m < meshes.length; m++) meshes[m].setMatrixAt(i, wm);
        continue;
      }
      if (corpseT[i] > 0) {                            // freshly killed → lie flat ON the ground
        // Rotating the standing rig 90° about X lays it on its back: each part's
        // local +Z (body depth) becomes the world-vertical extent. The thickest
        // parts (head/torso, ~0.27 half-depth) set how high the whole body must
        // ride so NOTHING sinks below the surface — lift the lying body to ~0.42
        // above the floor so it rests cleanly ON the ground, not bisected by it.
        const fy = (CBZ.floorAt ? CBZ.floorAt(px[i], pz[i]) : 0) + 0.42;
        rootD.position.set(px[i], fy, pz[i]);
        rootD.rotation.set(Math.PI / 2, heading[i], 0);
        rootD.scale.set(1, 1, 1);
        rootD.updateMatrix();
        drawParts(i, 0, 0);
        continue;
      }
      rootD.position.set(px[i], 0, pz[i]);
      rootD.rotation.set(0, heading[i], 0);
      rootD.scale.set(1, 1, 1);
      rootD.updateMatrix();
      drawParts(i, Math.sin(phase[i]) * 0.5, Math.abs(Math.cos(phase[i])) * 0.05);
    }
    for (let m = 0; m < meshes.length; m++) meshes[m].instanceMatrix.needsUpdate = true;
  }

  // ---- promotion pool: real makeCharacter peds reused as you move ----
  // isolate a pooled rig's tinted materials once so recolouring it per agent
  // can't bleed onto the shared material cache.
  function cloneLook(ped) {
    const ch = ped.char; if (!ch) return;
    const iso = (arr) => (arr || []).forEach((m) => { if (m && m.material) m.material = m.material.clone(); });
    if (ch.head && ch.head.material) ch.head.material = ch.head.material.clone();
    const ss = ch.skinSlots || {};
    iso(ss.hands); iso(ss.arms); iso(ss.hair); iso(ss.torso); iso(ss.collar);
  }
  function setLook(ped, skinHex, shirtHex, hairHex) {
    const ch = ped.char; if (!ch) return;
    const paint = (arr, hex) => (arr || []).forEach((m) => { if (m && m.material && m.material.color) m.material.color.setHex(hex); });
    if (ch.head && ch.head.material && ch.head.material.color) ch.head.material.color.setHex(skinHex);
    const ss = ch.skinSlots || {};
    paint(ss.hands, skinHex); paint(ss.arms, skinHex); paint(ss.hair, hairHex);
    paint(ss.torso, shirtHex); paint(ss.collar, shirtHex);
  }
  function makePooled() {
    const A = arena();
    const ped = CBZ.cityMakePed(PARK, PARK, Math.random, { kind: "civilian" });
    ped._crowd = true; ped._parked = true; ped.group.visible = false;
    ped.pos.set(PARK, 0, PARK); ped.target.set(PARK, 0, PARK);
    cloneLook(ped);
    A.root.add(ped.group);
    CBZ.cityPeds.push(ped);
    return ped;
  }
  function buildPool() {
    if (poolBuilt) return;
    if (!arena() || !CBZ.cityMakePed || !CBZ.cityPeds) return;
    pool = [];
    for (let s = 0; s < PROMO; s++) pool.push({ ped: makePooled(), idx: -1 });
    poolBuilt = true;
  }
  function park(e) {
    const ped = e.ped;
    ped._parked = true; ped.group.visible = false;
    ped.pos.set(PARK, 0, PARK); ped.target.set(PARK, 0, PARK);
    ped.rage = null; ped.mem = null; ped.state = "walk"; ped.path = null; ped.finalGoal = null;
    e.idx = -1;
  }
  function assign(e, s, i) {
    const ped = e.ped;
    e.idx = i; promotedBy[i] = s;
    ped._parked = false; ped.dead = false; ped.deadT = 0; ped.ko = 0; ped.culled = false; ped.collected = false; ped.needsPickup = false;
    ped.pos.set(px[i], 0, pz[i]); ped.char.group.rotation.y = heading[i];
    ped.target.set(px[i], 0, pz[i]);
    ped.group.visible = true;
    ped.state = "walk"; ped.path = null; ped.finalGoal = null; ped.pause = 0.2 + Math.random() * 0.6;
    setLook(ped, SKINS[skin[i]], SHIRTS[shirt[i]], HAIRS[hairC[i]]);
  }
  function releaseAll() {
    if (!poolBuilt) return;
    for (let s = 0; s < pool.length; s++) { const e = pool[s]; if (e.idx >= 0) { promotedBy[e.idx] = -1; park(e); } }
  }
  function updatePromotion() {
    if (!poolBuilt) { buildPool(); if (!poolBuilt) return; }
    const P = CBZ.player; if (!P) return;
    const ppx = P.pos.x, ppz = P.pos.z;
    // 1) reconcile currently-promoted slots
    for (let s = 0; s < pool.length; s++) {
      const e = pool[s]; if (e.idx < 0) continue;
      const i = e.idx, ped = e.ped;
      if (ped.dead) { deadAgent[i] = 1; promotedBy[i] = -1; pool[s] = { ped: makePooled(), idx: -1 }; continue; } // killed → consume agent, fresh pool ped
      px[i] = ped.pos.x; pz[i] = ped.pos.z; heading[i] = ped.char.group.rotation.y;   // mirror live motion back
      const dx = ped.pos.x - ppx, dz = ped.pos.z - ppz;
      if (P.dead || P.driving || dx * dx + dz * dz > PROMO_OUT2) { promotedBy[i] = -1; park(e); }   // walked away → back to density
    }
    if (P.dead || P.driving) return;
    // camera facing (city look dir): used to extend promotion reach for agents
    // you're looking AT, so distant NPCs down your sightline are real by the time
    // you draw a bead on them — you can shoot or run anyone you can see.
    const yaw = (CBZ.cam ? CBZ.cam.yaw : 0);
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    // 2) promote agents into any free slots: nearby in any direction, OR farther
    //    out but inside the forward cone. Score = squared distance, but agents in
    //    front get their effective range pushed out to PROMO_AHEAD2.
    for (let s = 0; s < pool.length; s++) {
      const e = pool[s]; if (e.idx >= 0) continue;
      let best = -1, bd = PROMO_AHEAD2;
      for (let i = 0; i < count; i++) {
        if (promotedBy[i] >= 0 || deadAgent[i]) continue;
        const dx = px[i] - ppx, dz = pz[i] - ppz, d2 = dx * dx + dz * dz;
        if (d2 >= bd) continue;
        // near in any direction, OR ahead of the camera within the far range
        const dn = Math.sqrt(d2) || 1;
        const ahead = (dx / dn) * fx + (dz / dn) * fz >= AHEAD_DOT;
        const range = ahead ? PROMO_AHEAD2 : PROMO_IN2;
        if (d2 < range && d2 < bd) { bd = d2; best = i; }
      }
      if (best < 0) break;
      assign(e, s, best);
    }
  }
  // ---- AHEAD RESEED: bias density toward where the player is looking/heading ----
  // Agents wander randomly across the whole city, so the street ahead of you can
  // end up sparse — a ghost world. Each frame we cheaply recycle a FEW distant,
  // non-promoted, living agents to fresh sidewalk points out in front of the
  // camera (just past promotion reach, so they're real-and-ready as you advance).
  // No new bodies are spawned (cap is fixed); we just teleport far ones forward.
  const AHEAD_NEAR = 30, AHEAD_FAR = 64;          // ring out in front to seed into
  const RESEED_BEHIND2 = 70 * 70;                 // only recycle agents this far away
  let reseedScan = 0;
  function aheadReseed() {
    const P = CBZ.player; if (!P || P.dead) return;
    const A = arena(); if (!A || !A.randomSidewalkPoint) return;
    const ppx = P.pos.x, ppz = P.pos.z;
    const yaw = (CBZ.cam ? CBZ.cam.yaw : 0);
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    let moved = 0, scanned = 0;
    // walk a rolling window of agents (a few per frame) so the cost is bounded
    for (let n = 0; n < count && scanned < 40 && moved < 2; n++) {
      const i = reseedScan; reseedScan = (reseedScan + 1) % Math.max(1, count); scanned++;
      if (deadAgent[i] || corpseT[i] > 0 || promotedBy[i] >= 0) continue;
      const dx = px[i] - ppx, dz = pz[i] - ppz, d2 = dx * dx + dz * dz;
      if (d2 < RESEED_BEHIND2) continue;          // already close enough to matter
      // is this far agent BEHIND / off to the side? if so, recycle it ahead.
      const dn = Math.sqrt(d2) || 1;
      if ((dx / dn) * fx + (dz / dn) * fz > 0.2) continue;  // already roughly ahead → leave it
      // find a sidewalk point inside the forward ring (a few tries)
      for (let t = 0; t < 4; t++) {
        const p = A.randomSidewalkPoint();
        const rx = p.x - ppx, rz = p.z - ppz, rd = Math.hypot(rx, rz) || 1;
        if (rd < AHEAD_NEAR || rd > AHEAD_FAR) continue;
        if ((rx / rd) * fx + (rz / rd) * fz < AHEAD_DOT) continue;
        if (A.clampToCity) A.clampToCity(p, 0.6);
        px[i] = p.x; pz[i] = p.z;
        pickWaypoint(_tmp); tx[i] = _tmp.x; tz[i] = _tmp.z;
        heading[i] = Math.atan2(tx[i] - px[i], tz[i] - pz[i]);
        moved++; break;
      }
    }
  }

  // ---- COMBAT: the ambient crowd is now shootable + run-over-able ----
  // (previously only the ~14 promoted peds could be hit; far NPCs were phantoms).
  function shootable(i) { return !deadAgent[i] && corpseT[i] <= 0 && promotedBy[i] < 0; }
  // distance along a (normalised) ray at which it first enters a sphere, or -1.
  function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r, maxT) {
    const mx = ox - cx, my = oy - cy, mz = oz - cz;
    const b = mx * dx + my * dy + mz * dz;
    const c = mx * mx + my * my + mz * mz - r * r;
    if (c > 0 && b > 0) return -1;
    const disc = b * b - c;
    if (disc < 0) return -1;
    let t = -b - Math.sqrt(disc);
    if (t < 0) t = 0;                         // origin inside sphere
    return t <= maxT ? t : -1;
  }
  // nearest ambient agent the ray hits within maxT (head sphere wins). hr/br = assist radii.
  CBZ.cityCrowdRayHit = function (ox, oy, oz, dx, dy, dz, maxT, hr, br) {
    let best = -1, bd = maxT, head = false;
    const HR = (hr || 0.33) + 0.05, BR = (br || 0.48) + 0.08;
    for (let i = 0; i < count; i++) {
      if (!shootable(i)) continue;
      const hd = raySphere(ox, oy, oz, dx, dy, dz, px[i], 2.18, pz[i], HR, bd);
      if (hd >= 0 && hd < bd) { bd = hd; best = i; head = true; continue; }
      const td = raySphere(ox, oy, oz, dx, dy, dz, px[i], 1.42, pz[i], BR, bd);
      if (td >= 0 && td < bd) { bd = td; best = i; head = false; }
    }
    return best >= 0 ? { i: best, dist: bd, head: head, x: px[best], z: pz[best] } : null;
  };
  // kill ambient agent i: leave a body, throw gore, and report the crime (wanted).
  CBZ.cityCrowdKill = function (i, opts) {
    opts = opts || {};
    if (i < 0 || i >= count || !shootable(i)) return false;
    const x = px[i], z = pz[i];
    corpseT[i] = 28;                                   // lie on the ground a good long while, then fade
    if (CBZ.gore) try { CBZ.gore(x, 1.4, z, { dir: opts.fromX != null ? { x: x - opts.fromX, z: z - opts.fromZ } : null, amount: opts.head ? 1.4 : 1.0, player: false }); } catch (e) {}
    if (CBZ.sfx && !opts.quiet) CBZ.sfx(opts.byCar ? "ko" : (opts.head ? "headshot" : "hit"));
    // a killed civilian is a witnessed crime → routes through the city wanted system
    // (skip when an NPC/explosion you didn't cause did the killing — opts.noCrime)
    if (CBZ.cityCrime && !opts.noCrime) CBZ.cityCrime(opts.byCar ? 150 : 200, { x: x, z: z, type: opts.byCar ? "vehicular homicide" : "murder" });
    if (CBZ.game) CBZ.game.cityKills = (CBZ.game.cityKills || 0) + 1;
    if (CBZ.city && CBZ.city.addKill) CBZ.city.addKill();   // count crowd kills toward story/leaderboard too
    return true;
  };
  // everyone within r of (x,z) gets run down (car mowing through a crowd).
  CBZ.cityCrowdCircleKill = function (x, z, r, opts) {
    let n = 0; const r2 = r * r;
    for (let i = 0; i < count; i++) {
      if (!shootable(i)) continue;
      const dx = px[i] - x, dz = pz[i] - z;
      if (dx * dx + dz * dz < r2 && CBZ.cityCrowdKill(i, opts)) n++;
    }
    return n;
  };

  // a city teardown (new run / mode reset) nukes CBZ.cityPeds — drop the pool too
  if (CBZ.clearCityPeds) {
    const _clear = CBZ.clearCityPeds;
    CBZ.clearCityPeds = function () { pool = []; poolBuilt = false; promotedBy.fill(-1); deadAgent.fill(0); return _clear.apply(this, arguments); };
  }

  // ambient layer: runs during city play (own order, independent of peds @34).
  CBZ.onUpdate(23.7, function (dt) {
    if (CBZ.game.mode !== "city") { if (root) { root.visible = false; } if (poolBuilt) releaseAll(); return; }
    if (root) root.visible = true;
    if (!count && arena()) CBZ.spawnCityCrowd((CBZ.CITY && CBZ.CITY.crowd) || 320);
    sim(dt);
    aheadReseed();        // pull distant bodies into the street ahead of you
    updatePromotion();
    render();
  });
})();
