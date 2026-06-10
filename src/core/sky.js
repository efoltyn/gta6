/* ============================================================
   core/sky.js — THE SKY AND THE EDGE OF THE WORLD.
   WHY: the world must never visibly end. The old dome was r=400 with
   depthWrite ON — anything past 400u got depth-rejected, so the far
   island/city VANISHED across town. Now: an r=850 dome (camera far is
   1000) that writes no depth, whose horizon is forced to EXACTLY the
   scene fog colour every frame (no seam between fogged ground and sky,
   in every mode, at every time of day), an endless painted skyline
   past the city's last real block (city-gated — jail/survival horizons
   untouched), stars + sun + moon riding daynight's clock, and clouds
   over every inhabited region.
   BUDGET: everything here is ≤6 extra draw calls — and the old clouds
   (~36 meshes, one per puff) are now ONE InstancedMesh, so the net
   draw-call count actually went DOWN.
   - assets/sky/day.jpg (2:1 equirect) is used as the day layer when it
     loads; full procedural gradient fallback if it doesn't.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const scene = CBZ.scene;
  const g = CBZ.game;

  // seeded prng so the skyline is the same city every session (players
  // learn the silhouette of "their" town — it reads as a place, not noise)
  function mulberry32(s) {
    return function () {
      s |= 0; s = (s + 0x6D2B79F5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Everything sky-distance lives on one rig that FOLLOWS the camera, so
  // the sky surrounds the player in all three worlds (escape z≈0,
  // survival z≈600, city z≈-700) — a dome pinned to origin showed as a
  // black "roof" over the far arenas.
  const rig = new THREE.Group();
  scene.add(rig);

  /* ---------------- 1. the dome -------------------------------------
     r=850 < camera far (1000); depthWrite:false so it can never depth-
     reject real geometry behind/inside it. The canvas is repainted
     (throttled) so its horizon band ALWAYS equals scene.fog.color
     divided by the dome's tint — daynight/survival multiply the dome by
     material.color, so texel × tint must land exactly on the fog colour
     where sky meets ground. */
  const SKY_W = 1024, SKY_H = 512, HORIZON_Y = SKY_H * 0.5; // v=0.5 = y-0 horizon
  const skyCanvas = document.createElement("canvas");
  skyCanvas.width = SKY_W; skyCanvas.height = SKY_H;
  const skyCtx = skyCanvas.getContext("2d");
  const skyTex = new THREE.CanvasTexture(skyCanvas);
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(850, 32, 20),
    new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false, depthWrite: false })
  );
  rig.add(dome);
  CBZ.skyDome = dome; // core/daynight.js + modes/survival.js tint this

  // optional photo sky: assets/sky/day.jpg (equirect 2:1). Pre-downscaled
  // ONCE into an offscreen canvas so each repaint is a cheap blit, never a
  // 2048×1024 rescale. If the file is missing/broken we just stay procedural.
  let photoLayer = null;
  (function loadPhoto() {
    const img = new Image();
    img.onload = function () {
      const pc = document.createElement("canvas");
      pc.width = SKY_W; pc.height = Math.floor(SKY_H * 0.66); // upper sky only; fog band owns the rest
      pc.getContext("2d").drawImage(img, 0, 0, img.width, img.height * 0.66, 0, 0, pc.width, pc.height);
      photoLayer = pc;
      forcePaint = true;
    };
    img.onerror = function () { photoLayer = null; };
    img.src = "assets/sky/day.jpg";
  })();

  // horizon colour = fog ÷ tint (clamped) so (texel × tint) == fog exactly
  function horizonCss(fog, tint) {
    const r = Math.min(255, Math.round((fog.r / Math.max(tint.r, 0.004)) * 255));
    const gg = Math.min(255, Math.round((fog.g / Math.max(tint.g, 0.004)) * 255));
    const b = Math.min(255, Math.round((fog.b / Math.max(tint.b, 0.004)) * 255));
    return "rgb(" + r + "," + gg + "," + b + ")";
  }

  function paintSky(fog, tint) {
    const hz = horizonCss(fog, tint);
    if (photoLayer) {
      skyCtx.clearRect(0, 0, SKY_W, SKY_H);
      skyCtx.drawImage(photoLayer, 0, 0);
    } else {
      const grd = skyCtx.createLinearGradient(0, 0, 0, SKY_H);
      grd.addColorStop(0, "#1f63cf");
      grd.addColorStop(0.30, "#5fa0ee");
      grd.addColorStop(0.47, hz);
      grd.addColorStop(1, hz);
      skyCtx.fillStyle = grd; skyCtx.fillRect(0, 0, SKY_W, SKY_H);
    }
    // the fog band: sky melts into EXACTLY the fog colour at the horizon,
    // and everything below the horizon IS the fog colour (no seam, ever)
    const fadeTop = HORIZON_Y - 52;
    const fade = skyCtx.createLinearGradient(0, fadeTop, 0, HORIZON_Y + 4);
    fade.addColorStop(0, hz.replace("rgb", "rgba").replace(")", ",0)"));
    fade.addColorStop(1, hz.replace("rgb", "rgba").replace(")", ",1)"));
    skyCtx.fillStyle = fade; skyCtx.fillRect(0, fadeTop, SKY_W, HORIZON_Y + 4 - fadeTop);
    skyCtx.fillStyle = hz; skyCtx.fillRect(0, HORIZON_Y, SKY_W, SKY_H - HORIZON_Y);
    skyTex.needsUpdate = true;
  }

  /* ---------------- 2. the endless skyline (CITY ONLY) ---------------
     Two camera-following BackSide cylinder rings past the last real
     block: r=430 taller/sparser, r=560 lower/denser. Their colour tracks
     the fog colour each frame (slightly darkened) so they read as the
     NEXT districts already swallowed by haze — money out there you
     haven't taken yet. A third ring of lit window dots fades up with
     CBZ.nightAmount: the city that never sleeps, seen from your block.
     City-gated: invisible (zero draw calls) in jail/survival. */
  function buildSkyline(W, H, seed, minW, maxW, minH, maxH, gapChance, slots) {
    const cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    const cx = cv.getContext("2d");
    const rnd = mulberry32(seed);
    let x = 4;
    while (x < W - maxW - 4) {
      const w = minW + rnd() * (maxW - minW);
      if (rnd() < gapChance) { x += w * 0.8; continue; }
      const h = H * (minH + rnd() * (maxH - minH));
      const a = 0.86 + rnd() * 0.14;
      cx.fillStyle = "rgba(255,255,255," + a.toFixed(2) + ")";
      cx.fillRect(x, H - h, w, h);
      if (rnd() < 0.3) cx.fillRect(x + w * 0.42, H - h - 6 - rnd() * 16, 2, 8 + rnd() * 16); // antenna
      if (rnd() < 0.22) cx.fillRect(x + 3, H - h - 4, w - 6, 4); // penthouse step
      if (slots) slots.push({ x: x, w: w, h: h });
      x += w + 3 + rnd() * 12;
    }
    return cv;
  }

  function ringMesh(radius, height, y, canvas, renderOrder, extraMat) {
    const tex = new THREE.CanvasTexture(canvas);
    const mat = new THREE.MeshBasicMaterial(Object.assign({
      map: tex, transparent: true, fog: false, depthWrite: false, side: THREE.BackSide,
    }, extraMat || {}));
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, 64, 1, true), mat);
    mesh.position.y = y;
    mesh.renderOrder = renderOrder;
    mesh.visible = false;
    rig.add(mesh);
    return mesh;
  }

  const nearSlots = [];
  const farRing = ringMesh(560, 64, 20, buildSkyline(1024, 128, 1337, 10, 26, 0.22, 0.55, 0.10, null), -3);
  const nearCanvas = buildSkyline(1024, 256, 4242, 24, 52, 0.26, 0.78, 0.22, nearSlots);
  const nearRing = ringMesh(430, 110, 40, nearCanvas, -2);

  // window dots aligned to the near silhouette (same texture-u layout, so a
  // slightly smaller radius keeps them painted ON the same towers)
  const lightCanvas = (function () {
    const cv = document.createElement("canvas");
    cv.width = 1024; cv.height = 256;
    const cx = cv.getContext("2d");
    const rnd = mulberry32(99);
    const pal = ["#ffd98a", "#ffedb8", "#bcd6ff", "#ffc46e"];
    for (const s of nearSlots) {
      for (let yy = 256 - s.h + 5; yy < 248; yy += 7) {
        for (let xx = s.x + 3; xx < s.x + s.w - 3; xx += 5) {
          if (rnd() < 0.42) { cx.fillStyle = pal[(rnd() * pal.length) | 0]; cx.fillRect(xx, yy, 2, 3); }
        }
      }
    }
    return cv;
  })();
  const lightsRing = ringMesh(427, 110, 40, lightCanvas, -1, { blending: THREE.AdditiveBlending, opacity: 0 });

  /* ---------------- 3. stars (ALL modes — night is universal) -------- */
  const STARS = 800;
  const starGeo = new THREE.BufferGeometry();
  (function () {
    const rnd = mulberry32(777);
    const pos = new Float32Array(STARS * 3), col = new Float32Array(STARS * 3);
    for (let i = 0; i < STARS; i++) {
      const az = rnd() * Math.PI * 2;
      const up = 0.05 + 0.95 * rnd();                  // upper hemisphere only
      const hr = Math.sqrt(Math.max(0, 1 - up * up));
      const r = 780 * (0.97 + rnd() * 0.03);
      pos[i * 3] = Math.cos(az) * hr * r; pos[i * 3 + 1] = up * r; pos[i * 3 + 2] = Math.sin(az) * hr * r;
      const warm = rnd();                              // subtle blue↔warm spread
      const b = 0.72 + rnd() * 0.28;
      col[i * 3] = b * (0.85 + warm * 0.15); col[i * 3 + 1] = b * 0.92; col[i * 3 + 2] = b * (1.0 - warm * 0.18);
    }
    starGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    starGeo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  })();
  const starMat = new THREE.PointsMaterial({
    size: 1.7, sizeAttenuation: false, vertexColors: true,
    transparent: true, opacity: 0, depthWrite: false, fog: false,
  });
  const stars = new THREE.Points(starGeo, starMat);
  stars.renderOrder = -5; stars.visible = false;
  rig.add(stars);

  /* ---------------- 4. sun + moon sprites ---------------------------
     Placed from daynight's sun angle (CBZ.sunAngle) so the glowing disc
     in the sky IS the light that's hitting the streets. Additive, no
     depth write — the skyline rings silhouette against them at dusk. */
  function discTexture(stops) {
    const cv = document.createElement("canvas");
    cv.width = 128; cv.height = 128;
    const cx = cv.getContext("2d");
    const grd = cx.createRadialGradient(64, 64, 0, 64, 64, 64);
    for (const s of stops) grd.addColorStop(s[0], s[1]);
    cx.fillStyle = grd; cx.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(cv);
  }
  function skySprite(tex, scale) {
    const m = new THREE.SpriteMaterial({
      map: tex, blending: THREE.AdditiveBlending, transparent: true,
      depthWrite: false, fog: false, opacity: 0,
    });
    const s = new THREE.Sprite(m);
    s.scale.set(scale, scale, 1);
    s.renderOrder = -4; s.visible = false;
    rig.add(s);
    return s;
  }
  const sunSpr = skySprite(discTexture([
    [0, "#ffffff"], [0.16, "#fff3c8"], [0.42, "rgba(255,205,110,0.55)"], [1, "rgba(255,170,60,0)"],
  ]), 95);
  const moonSpr = skySprite(discTexture([
    [0, "#f4f8ff"], [0.2, "#cfd9f2"], [0.45, "rgba(168,188,228,0.28)"], [1, "rgba(150,170,210,0)"],
  ]), 58);
  moonSpr.material.color.setHex(0xdfe8ff);

  /* ---------------- 5. clouds — ONE InstancedMesh -------------------
     The old clouds were ~36 separate meshes (one draw call per puff) and
     only covered the prison + survival island — the city had an empty
     ceiling. Now every puff in every region is one instanced draw call,
     and clusters drift/wrap over all three worlds. */
  const PUFFS = [[0, 0, 0, 9], [6, -1, 1, 6], [-6, -1, -1, 7], [2, 2, 0, 5]];
  const clusters = [];
  function cloud(x, y, z, s, wrapMin, wrapMax) {
    clusters.push({ x: x, y: y, z: z, s: s, min: wrapMin, max: wrapMax });
  }
  // prison / escape (origin) — same spots as always
  cloud(-60, 70, -40, 1.4, -150, 150);
  cloud(50, 80, 30, 1.8, -150, 150);
  cloud(10, 75, 90, 1.2, -150, 150);
  cloud(-30, 85, 70, 1.6, -150, 150);
  // survival island
  if (CBZ.SURV && CBZ.SURV.arena) {
    const a = CBZ.SURV.arena;
    cloud(a.cx - 55, 74, a.cz - 45, 1.6, a.cx - 150, a.cx + 150);
    cloud(a.cx + 50, 84, a.cz + 35, 2.0, a.cx - 150, a.cx + 150);
    cloud(a.cx + 15, 78, a.cz + 85, 1.3, a.cx - 150, a.cx + 150);
    cloud(a.cx - 35, 88, a.cz + 55, 1.7, a.cx - 150, a.cx + 150);
    cloud(a.cx + 65, 72, a.cz - 65, 1.5, a.cx - 150, a.cx + 150);
  }
  // THE CITY — wide drift wrap across the whole span (center ≈ z=-700)
  const cc = (CBZ.CITY && CBZ.CITY.center) || { x: 0, z: -700 };
  cloud(cc.x - 180, 76, cc.z + 120, 1.7, cc.x - 280, cc.x + 280);
  cloud(cc.x + 40, 84, cc.z + 60, 2.1, cc.x - 280, cc.x + 280);
  cloud(cc.x + 190, 72, cc.z, 1.5, cc.x - 280, cc.x + 280);
  cloud(cc.x - 90, 88, cc.z - 60, 1.9, cc.x - 280, cc.x + 280);
  cloud(cc.x + 120, 78, cc.z - 120, 1.6, cc.x - 280, cc.x + 280);
  cloud(cc.x - 200, 82, cc.z, 1.4, cc.x - 280, cc.x + 280);
  cloud(cc.x, 92, cc.z + 160, 1.8, cc.x - 280, cc.x + 280);

  const cloudMat = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false });
  const cloudInst = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 0.6, 1), cloudMat, clusters.length * PUFFS.length
  );
  cloudInst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  cloudInst.frustumCulled = false; // clusters span all three worlds
  scene.add(cloudInst);            // world-anchored — NOT on the camera rig

  const _m = new THREE.Matrix4(), _p = new THREE.Vector3(),
        _q = new THREE.Quaternion(), _s = new THREE.Vector3();
  function writeClouds(dt) {
    for (let i = 0; i < clusters.length; i++) {
      const cl = clusters[i];
      cl.x += dt * 0.8;
      if (cl.x > cl.max) cl.x = cl.min;
      for (let p = 0; p < PUFFS.length; p++) {
        const pf = PUFFS[p];
        _p.set(cl.x + pf[0] * cl.s, cl.y + pf[1] * cl.s, cl.z + pf[2] * cl.s);
        _s.setScalar(pf[3] * cl.s);
        _m.compose(_p, _q, _s);
        cloudInst.setMatrixAt(i * PUFFS.length + p, _m);
      }
    }
    cloudInst.instanceMatrix.needsUpdate = true;
  }
  writeClouds(0);

  /* ---------------- per-frame sync ----------------------------------
     Runs at order 99 — AFTER daynight (@2), weather's fog lerp (@90),
     survival's env override (@93) and city's light override (@94) — so
     it reads the FINAL fog colour of the frame, whatever mode wrote it.
     That's the whole seam fix: horizon stop == scene.fog.color, always. */
  let forcePaint = true, lastPaintAt = -1e9;
  const lastFog = new THREE.Color(-1, -1, -1), lastTint = new THREE.Color(-1, -1, -1);
  const _fogFallback = new THREE.Color(0xbfe0ff);
  function moved(a, b) {
    return Math.abs(a.r - b.r) > 0.006 || Math.abs(a.g - b.g) > 0.006 || Math.abs(a.b - b.b) > 0.006;
  }

  CBZ.onAlways(99, function (dt) {
    const cam = CBZ.camera.position;
    rig.position.set(cam.x, 0, cam.z);

    const fog = scene.fog ? scene.fog.color : _fogFallback;
    const tint = dome.material.color;

    // dome horizon repaint — throttled (canvas refill + ~2MB upload is cheap
    // at <10Hz, wasteful at 60); the colour drifts over seconds, not frames
    if (forcePaint || (CBZ.now - lastPaintAt > 100 && (moved(fog, lastFog) || moved(tint, lastTint)))) {
      paintSky(fog, tint);
      lastFog.copy(fog); lastTint.copy(tint);
      lastPaintAt = CBZ.now; forcePaint = false;
    }

    const night = CBZ.nightAmount == null ? 0 : CBZ.nightAmount;
    const dayness = CBZ.dayness == null ? 1 : CBZ.dayness;
    const duskness = CBZ.duskness == null ? 0 : CBZ.duskness;

    // skyline rings: city only; pre-fogged into the haze (colour == fog,
    // nudged darker so the silhouettes still read against the horizon band)
    const city = g.mode === "city";
    nearRing.visible = city; farRing.visible = city;
    if (city) {
      nearRing.material.color.copy(fog).multiplyScalar(0.88);
      farRing.material.color.copy(fog).multiplyScalar(0.95);
    }
    lightsRing.visible = city && night > 0.04;
    if (lightsRing.visible) lightsRing.material.opacity = Math.min(1, night);

    // stars
    const so = Math.max(0, night - 0.25) * 1.2;
    stars.visible = so > 0.01;
    if (stars.visible) starMat.opacity = Math.min(1, so);

    // sun + moon ride daynight's angle
    const a = CBZ.sunAngle == null ? 1.1 : CBZ.sunAngle;
    _p.set(Math.cos(a) * 80, Math.sin(a) * 95, -10).normalize();
    sunSpr.position.copy(_p).multiplyScalar(795);
    let sop = Math.min(1, dayness * 1.6 + duskness * 0.5);
    if (_p.y < -0.02) sop = 0;
    sunSpr.visible = sop > 0.01;
    if (sunSpr.visible) {
      sunSpr.material.opacity = sop;
      if (CBZ.sunTint) sunSpr.material.color.copy(CBZ.sunTint);
    }
    _p.set(Math.cos(a + Math.PI) * 80, Math.sin(a + Math.PI) * 95, -10).normalize();
    moonSpr.position.copy(_p).multiplyScalar(795);
    let mop = Math.min(1, Math.max(0, (night - 0.12) * 1.25));
    if (_p.y < -0.02) mop = 0;
    moonSpr.visible = mop > 0.01;
    if (moonSpr.visible) moonSpr.material.opacity = mop;

    // clouds: drift + day/night shading (white by day, dimmed and pushed
    // toward the haze colour at night so they stop glowing in the dark)
    writeClouds(dt);
    cloudMat.color.setScalar(0.35 + 0.65 * dayness).lerp(fog, 0.12 + night * 0.2);
  });
})();
