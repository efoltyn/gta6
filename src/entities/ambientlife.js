/* ============================================================
   entities/ambientlife.js — Ambient life (pure decoration).

   Three cheap, capped, never-gameplay layers that just sell the
   world as a living place:

     1. CROWS  — a handful of low-poly box birds slowly circling
                 high above the yard on lazy elliptical orbits,
                 wings flapping. They cast no shadow and never
                 collide with anything.
     2. DUST   — ~120 dust motes (one THREE.Points cloud) gently
                 drifting through the play area and recycling
                 (wrapping) back in when they float out of bounds.
     3. MOTHS  — a few small glowing sprites that, only at night,
                 fade in and circle near the tower lamp positions,
                 then fade back out at dawn.

   Everything runs on CBZ.onAlways so it keeps breathing on the
   title / pause screens too. All geometry is built ONCE up front;
   the per-frame loop allocates nothing in its hot paths (reused
   scratch vectors, direct buffer writes). Safe on phones.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.scene || typeof THREE === "undefined") return;
  if (typeof CBZ.onAlways !== "function" || typeof CBZ.mat !== "function") return;

  const scene = CBZ.scene;

  // ---- play-area bounds (yard + a margin). Dust recycles inside here. ----
  const B = { minX: -30, maxX: 30, minZ: -8, maxZ: 52, floor: 0.4, ceil: 8.5 };
  const SPANX = B.maxX - B.minX;
  const SPANZ = B.maxZ - B.minZ;
  const CX = (B.minX + B.maxX) / 2;   // yard centre x
  const CZ = (B.minZ + B.maxZ) / 2;   // yard centre z

  const TAU = Math.PI * 2;
  const rnd = Math.random;            // built-in RNG is allowed & encouraged
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const sign = (v) => (v < 0 ? -1 : v > 0 ? 1 : 0); // avoid Math.sign edge fuss

  // "is it night?" — sun dips below the horizon. Soft so moths cross-fade.
  // sun.position.y ~ +95 noon .. -95 midnight (see core/daynight.js).
  // Returns 0 (full day) .. 1 (deep night).
  function nightAmount() {
    const sun = CBZ.sun;
    const y = sun && sun.position ? sun.position.y : 50;
    return clamp((10 - y) / 30, 0, 1);
  }

  /* ============================================================
     1. CROWS — box bodies with flapping wings, circling on high.
  ============================================================ */
  const CROWS = [];
  const CROW_COUNT = 4;

  // shared geometries / material so all crows are dirt-cheap
  const crowBodyGeo = new THREE.BoxGeometry(0.55, 0.32, 0.32);
  const crowHeadGeo = new THREE.BoxGeometry(0.26, 0.26, 0.26);
  const crowBeakGeo = new THREE.BoxGeometry(0.22, 0.1, 0.1);
  const crowTailGeo = new THREE.BoxGeometry(0.4, 0.06, 0.26);
  const crowWingGeo = new THREE.BoxGeometry(0.95, 0.05, 0.46);
  const crowBodyMat = CBZ.mat(0x1c1f26, { emissive: 0x05070b, ei: 0.4 });
  const crowBeakMat = CBZ.mat(0xffb43a, { emissive: 0x3a2400, ei: 0.5 });
  const crowWingMat = CBZ.mat(0x262a33, { emissive: 0x06080c, ei: 0.4 });

  function makeCrow() {
    const group = new THREE.Group();

    const body = new THREE.Mesh(crowBodyGeo, crowBodyMat);
    body.castShadow = body.receiveShadow = false;
    group.add(body);

    // head + beak pointing forward (+x is "forward" before we yaw the group)
    const head = new THREE.Mesh(crowHeadGeo, crowBodyMat);
    head.position.set(0.34, 0.08, 0);
    head.castShadow = head.receiveShadow = false;
    group.add(head);
    const beak = new THREE.Mesh(crowBeakGeo, crowBeakMat);
    beak.position.set(0.52, 0.06, 0);
    beak.castShadow = beak.receiveShadow = false;
    group.add(beak);

    // splayed tail at the back
    const tail = new THREE.Mesh(crowTailGeo, crowBodyMat);
    tail.position.set(-0.42, 0.02, 0);
    tail.castShadow = tail.receiveShadow = false;
    group.add(tail);

    // wings live on pivot groups hinged at the shoulder so they flap
    const wingL = new THREE.Group();
    const wingLmesh = new THREE.Mesh(crowWingGeo, crowWingMat);
    wingLmesh.position.set(0, 0, 0.52);     // offset out from the hinge
    wingLmesh.castShadow = wingLmesh.receiveShadow = false;
    wingL.add(wingLmesh);
    group.add(wingL);

    const wingR = new THREE.Group();
    const wingRmesh = new THREE.Mesh(crowWingGeo, crowWingMat);
    wingRmesh.position.set(0, 0, -0.52);
    wingRmesh.castShadow = wingRmesh.receiveShadow = false;
    wingR.add(wingRmesh);
    group.add(wingR);

    // distinct lazy orbit per bird
    const crow = {
      group, wingL, wingR,
      cx: CX + (rnd() - 0.5) * 18,        // orbit centre
      cz: CZ + (rnd() - 0.5) * 22,
      rx: 12 + rnd() * 9,                 // elliptical radii
      rz: 10 + rnd() * 9,
      y: 18 + rnd() * 7,                  // cruise height, well above walls
      ang: rnd() * TAU,                   // current angle around orbit
      spd: 0.10 + rnd() * 0.06,           // radians/sec — slow & lazy
      flapBase: 5 + rnd() * 2,            // flaps/sec
      flapPhase: rnd() * TAU,
      bobPhase: rnd() * TAU,
      glide: 0,                           // 0..1, occasional glide (wings still)
      glideT: 2 + rnd() * 4,
    };
    if (rnd() < 0.5) crow.spd = -crow.spd; // half circle the other way

    group.position.set(crow.cx + crow.rx, crow.y, crow.cz);
    scene.add(group);
    CROWS.push(crow);
    return crow;
  }
  for (let i = 0; i < CROW_COUNT; i++) makeCrow();

  function updateCrows(dt, t) {
    for (let i = 0; i < CROWS.length; i++) {
      const c = CROWS[i];

      // advance along the orbit
      c.ang += c.spd * dt;
      const px = c.cx + Math.cos(c.ang) * c.rx;
      const pz = c.cz + Math.sin(c.ang) * c.rz;
      const bob = Math.sin(t * 0.0007 + c.bobPhase) * 0.8; // gentle vertical drift
      c.group.position.set(px, c.y + bob, pz);

      // face along the direction of travel (tangent to the ellipse)
      const tx = -Math.sin(c.ang) * c.rx * c.spd;
      const tz = Math.cos(c.ang) * c.rz * c.spd;
      c.group.rotation.y = Math.atan2(-tz, tx);
      // subtle bank into the turn
      c.group.rotation.z = -0.18 * sign(c.spd);

      // occasional glide: wings briefly hold near level
      c.glideT -= dt;
      if (c.glideT <= 0) {
        c.glide = c.glide > 0.5 ? 0 : 1;
        c.glideT = c.glide ? 1.2 + rnd() * 1.5 : 2.5 + rnd() * 4;
      }
      const flapAmt = c.glide ? 0.12 : 1.0;

      // flap: wings beat up/down around the shoulder hinge
      c.flapPhase += dt * c.flapBase * (c.glide ? 0.4 : 1);
      const beat = Math.sin(c.flapPhase) * (0.55 + 0.35 * flapAmt);
      c.wingL.rotation.x = -beat;   // mirrored so they move together visually
      c.wingR.rotation.x = beat;
    }
  }

  /* ============================================================
     2. DUST — one Points cloud of ~120 motes drifting & recycling.
  ============================================================ */
  const DUST_N = 120;
  const dustPos = new Float32Array(DUST_N * 3);
  // per-mote velocity + a little individual sway so they don't move in lockstep
  const dvx = new Float32Array(DUST_N);
  const dvy = new Float32Array(DUST_N);
  const dvz = new Float32Array(DUST_N);
  const dswP = new Float32Array(DUST_N);   // sway phase
  const dswS = new Float32Array(DUST_N);   // sway speed

  for (let i = 0; i < DUST_N; i++) {
    dustPos[i * 3 + 0] = B.minX + rnd() * SPANX;
    dustPos[i * 3 + 1] = B.floor + rnd() * (B.ceil - B.floor);
    dustPos[i * 3 + 2] = B.minZ + rnd() * SPANZ;
    dvx[i] = (rnd() - 0.5) * 0.6;
    dvy[i] = 0.05 + rnd() * 0.18;          // mostly gently rising
    dvz[i] = (rnd() - 0.5) * 0.6;
    dswP[i] = rnd() * TAU;
    dswS[i] = 0.5 + rnd() * 1.2;
  }

  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute("position", new THREE.BufferAttribute(dustPos, 3));
  const dustMat = new THREE.PointsMaterial({
    color: 0xfff3d0,
    size: 0.12,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
    fog: true,
  });
  const dust = new THREE.Points(dustGeo, dustMat);
  dust.frustumCulled = false; // it spans the whole yard; skip the cull test
  scene.add(dust);

  function updateDust(dt, t) {
    const arr = dustPos;
    for (let i = 0; i < DUST_N; i++) {
      const o = i * 3;
      // horizontal sway gives the motes a floaty, non-linear path
      const sway = Math.sin(t * 0.001 * dswS[i] + dswP[i]) * 0.25;
      let x = arr[o] + (dvx[i] + sway) * dt;
      let y = arr[o + 1] + dvy[i] * dt;
      let z = arr[o + 2] + (dvz[i] - sway) * dt;

      // recycle (wrap) when a mote drifts out of the play volume
      if (x < B.minX) x = B.maxX; else if (x > B.maxX) x = B.minX;
      if (z < B.minZ) z = B.maxZ; else if (z > B.maxZ) z = B.minZ;
      if (y > B.ceil) {                  // rose out the top — respawn low & random
        y = B.floor;
        x = B.minX + rnd() * SPANX;
        z = B.minZ + rnd() * SPANZ;
      }

      arr[o] = x; arr[o + 1] = y; arr[o + 2] = z;
    }
    dustGeo.attributes.position.needsUpdate = true;
    // motes are a touch more visible at dusk/night (catch the searchlights)
    dustMat.opacity = 0.42 + nightAmount() * 0.22;
  }

  /* ============================================================
     3. MOTHS — glowing sprites that circle the lamps after dark.
  ============================================================ */
  // lamp anchor points: the four tower lamp heads (see world/towers.js +
  // entities/searchlight.js — heads sit at y~6.2 on the corner towers).
  const LAMPS = [
    [-30, 6.0, 52], [30, 6.0, 52],
    [-30, 6.0, -8], [30, 6.0, -8],
  ];

  // soft round glow sprite, built once on a tiny canvas. If the 2D context
  // is unavailable for any reason we just fall back to a null map (the
  // sprite still renders as a tinted quad) — never throw at load.
  function mothTexture() {
    let cv, g;
    try {
      cv = document.createElement("canvas");
      cv.width = cv.height = 32;
      g = cv.getContext("2d");
    } catch (e) { g = null; }
    if (!g) return null;
    const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, "rgba(255,248,205,1)");
    grad.addColorStop(0.4, "rgba(255,238,170,0.65)");
    grad.addColorStop(1, "rgba(255,230,150,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 32, 32);
    return new THREE.CanvasTexture(cv);
  }
  const mothTex = mothTexture();

  const MOTHS = [];
  const MOTH_PER_LAMP = 2;
  for (let li = 0; li < LAMPS.length; li++) {
    const L = LAMPS[li];
    for (let k = 0; k < MOTH_PER_LAMP; k++) {
      const matOpts = {
        color: 0xfff0b0,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        fog: false,
      };
      if (mothTex) matOpts.map = mothTex;
      const mat = new THREE.SpriteMaterial(matOpts);
      const spr = new THREE.Sprite(mat);
      spr.scale.set(0.28, 0.28, 1);
      spr.visible = false;
      scene.add(spr);
      MOTHS.push({
        spr, mat,
        lx: L[0], ly: L[1], lz: L[2],
        ang: rnd() * TAU,
        spd: 1.4 + rnd() * 1.6,           // fast little flutter orbit
        r: 0.7 + rnd() * 0.9,             // radius around the lamp
        ybob: rnd() * TAU,
        jit: rnd() * TAU,
        cur: 0,                           // current fade-in level 0..1
      });
    }
  }

  function updateMoths(dt, t) {
    const targetGlow = nightAmount();        // moths only show at night
    for (let i = 0; i < MOTHS.length; i++) {
      const m = MOTHS[i];
      // smooth fade toward the night target so they don't pop in/out
      m.cur += (targetGlow - m.cur) * Math.min(1, dt * 1.5);
      const vis = m.cur > 0.02;
      m.spr.visible = vis;
      if (!vis) continue;

      m.ang += m.spd * dt;
      // erratic radius + height so flight looks fluttery, not a clean circle
      const jit = Math.sin(t * 0.004 + m.jit) * 0.25;
      const r = m.r + jit;
      const x = m.lx + Math.cos(m.ang) * r;
      const z = m.lz + Math.sin(m.ang * 1.3) * r;     // 1.3 -> lissajous-ish
      const y = m.ly + Math.sin(t * 0.003 + m.ybob) * 0.4;
      m.spr.position.set(x, y, z);

      // flicker the brightness a little, scaled by how "night" it is
      const flick = 0.75 + 0.25 * Math.sin(t * 0.02 + i);
      m.mat.opacity = m.cur * 0.85 * flick;
    }
  }

  /* ============================================================
     DRIVER — one onAlways tick (animates on menus too). Cheap.
  ============================================================ */
  CBZ.onAlways(78, function (dt) {
    // guard against absurd / non-finite dt (the loop already clamps real
    // dt to 0.05 and scales it, but stay defensive for stable motion).
    if (!(dt > 0)) dt = 0;
    else if (dt > 0.1) dt = 0.1;
    const t = CBZ.now || 0;
    updateCrows(dt, t);
    updateDust(dt, t);
    updateMoths(dt, t);
  });

  // expose for debugging / other modules, but nothing depends on it
  CBZ.ambientLife = { crows: CROWS, dust, moths: MOTHS };
})();
