/* ============================================================
   core/sky.js — THE SKY AND THE EDGE OF THE WORLD.
   WHY: the world must never visibly end. The old dome was r=400 with
   depthWrite ON — anything past 400u got depth-rejected, so the far
   island/city VANISHED across town. Now: an r=850 dome (camera far is
   1000) that writes no depth, whose horizon is forced to EXACTLY the
   scene fog colour every frame (no seam between fogged ground and sky,
   in every mode, at every time of day), stars + sun + moon riding
   daynight's clock, and clouds over every inhabited region.
   NO HORIZON RINGS — owner's standing order (filmed it twice): no
   painted skyline cylinders, no window-light ring, no haze band. The
   horizon is the real sea + fog, nothing else. Do not re-add them.

   THE SUNSET PASS (user-filmed: skyline read as flat white paper
   cutouts, dusk read as one flat orange wash):
   - the dome canvas is now a TRUE multi-stop gradient driven by
     deliberate palette tables (day / dusk / night) — zenith stays deep
     blue at sunset while a wide warm BURN pinned to the sun's azimuth
     makes the horizon glow on the sun's side only. A uniform tint
     (the old daynight skyC multiply) mathematically cannot do this;
     daynight now leaves the dome tint white and this file owns colour.
   - the sun disc grows a big soft additive halo at golden hour/dusk.
   BUDGET: everything here is ≤8 draw calls (haze band: city only,
   halo: dusk only) — the old clouds (~36 meshes, one per puff) are ONE
   InstancedMesh, so the net draw-call count is still DOWN vs the
   pre-dome build.
   - assets/sky/day.jpg (2:1 equirect) is used as the day layer when it
     loads; it crossfades OUT at golden hour (the photo has no sunset
     in it) and the procedural gradient takes over.
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
  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

  // Everything sky-distance lives on one rig that FOLLOWS the camera, so
  // the sky surrounds the player in all three worlds (escape z≈0,
  // survival z≈600, city z≈-700) — a dome pinned to origin showed as a
  // black "roof" over the far arenas.
  const rig = new THREE.Group();
  scene.add(rig);

  /* ---------------- 0. palette tables --------------------------------
     Deliberate keyframes instead of deriving every colour from the one
     fog colour (that derivation is exactly what made day rings read as
     white paper and dusk read flat). Day ring tints still TRACK the
     live fog (weather darkens them correctly) — but desaturated and
     stepped darker; dusk/night looks are authored here. */
  const PAL = {
    day: {
      zen: new THREE.Color(0x2a64c8),   // zenith blue
      mid: new THREE.Color(0x6fa3e8),   // mid-sky
    },
    dusk: {
      zen: new THREE.Color(0x1d2c58),   // zenith STAYS deep blue at sunset
      mid: new THREE.Color(0x8a5f7e),   // mauve mid-band
      ringNear: new THREE.Color(0x2e2840), // dark backlit silhouette
      ringFar: new THREE.Color(0x4d3c52),  // one haze step lighter
      win: new THREE.Color(0xffa45e),      // window dots warm up
    },
    night: {
      zen: new THREE.Color(0x05080f),
      mid: new THREE.Color(0x0c1428),
      ringNear: new THREE.Color(0x0a0e16), // near-black; windows carry it
      ringFar: new THREE.Color(0x121a2b),
    },
    glow: { // the sunset burn, golden hour (sun up) → civil dusk (sun dipped)
      golden: new THREE.Color(0xffd98c),
      goldenMid: new THREE.Color(0xffb15e),
      civil: new THREE.Color(0xff7330),    // hot orange core
      civilMid: new THREE.Color(0xff5a57), // pink shoulder
    },
  };

  function css(c) {
    return "rgb(" + Math.round(c.r * 255) + "," + Math.round(c.g * 255) + "," + Math.round(c.b * 255) + ")";
  }
  function cssA(c, aa) {
    return "rgba(" + Math.round(c.r * 255) + "," + Math.round(c.g * 255) + "," + Math.round(c.b * 255) + "," + (+aa).toFixed(3) + ")";
  }

  /* ---------------- 1. the dome -------------------------------------
     r=850 < camera far (1000); depthWrite:false so it can never depth-
     reject real geometry behind/inside it. The canvas is repainted
     (throttled) so its horizon band ALWAYS equals scene.fog.color
     divided by the dome's tint — survival's env override multiplies the
     dome by material.color, so texel × tint must land exactly on the
     fog colour where sky meets ground. */
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
  CBZ.skyDome = dome; // modes/survival.js tints this for disaster moods

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

  // frame state the painter reads (computed each frame, painted throttled)
  const frame = { glowU: 0, glowK: 0, photoK: 1, duskW: 0 };
  const _zen = new THREE.Color(), _mid = new THREE.Color();
  const _hot = new THREE.Color(), _gmid = new THREE.Color();

  function paintSky(fog, tint) {
    const hz = horizonCss(fog, tint);
    // 1) multi-stop vertical gradient: zenith → mid → fog-horizon. The
    //    zenith keeps its own colour while only the low sky approaches the
    //    fog — the one thing a whole-dome tint could never do.
    const grd = skyCtx.createLinearGradient(0, 0, 0, SKY_H);
    grd.addColorStop(0, css(_zen));
    grd.addColorStop(0.28, css(_mid));
    grd.addColorStop(0.47, hz);
    grd.addColorStop(1, hz);
    skyCtx.fillStyle = grd; skyCtx.fillRect(0, 0, SKY_W, SKY_H);
    // 2) the photo sky owns clear daylight, fading out into golden hour —
    //    there is no sunset inside the jpg, the gradient has to take over
    if (photoLayer && frame.photoK > 0.01) {
      skyCtx.globalAlpha = frame.photoK;
      skyCtx.drawImage(photoLayer, 0, 0);
      skyCtx.globalAlpha = 1;
    }
    // 3) THE BURN: a wide warm glow pinned to the sun's azimuth (canvas u),
    //    so the horizon goes hot orange/pink on the sun's side while the
    //    far side and zenith stay cool. Drawn 3× for the u=0/1 seam wrap;
    //    only above the horizon — below it the fog band owns everything.
    if (frame.glowK > 0.015) {
      const gx = frame.glowU * SKY_W, ry = SKY_H * 0.44;
      for (let i = -1; i <= 1; i++) {
        skyCtx.save();
        skyCtx.translate(gx + i * SKY_W, HORIZON_Y);
        skyCtx.scale(2.2, 1); // sunset glow is wide, not tall
        const g2 = skyCtx.createRadialGradient(0, 0, 0, 0, 0, ry);
        g2.addColorStop(0, cssA(_hot, 0.85 * frame.glowK));
        g2.addColorStop(0.38, cssA(_gmid, 0.45 * frame.glowK));
        g2.addColorStop(1, cssA(_gmid, 0));
        skyCtx.fillStyle = g2;
        skyCtx.fillRect(-ry, -ry, ry * 2, ry);
        skyCtx.restore();
      }
    }
    // 4) the fog band: sky melts into EXACTLY the fog colour at the horizon,
    //    and everything below the horizon IS the fog colour (no seam, ever).
    //    The band gets SHORTER at dusk so the burn reaches the waterline.
    const fadeTop = HORIZON_Y - (52 - 26 * frame.duskW);
    const fade = skyCtx.createLinearGradient(0, fadeTop, 0, HORIZON_Y + 4);
    fade.addColorStop(0, hz.replace("rgb", "rgba").replace(")", ",0)"));
    fade.addColorStop(1, hz.replace("rgb", "rgba").replace(")", ",1)"));
    skyCtx.fillStyle = fade; skyCtx.fillRect(0, fadeTop, SKY_W, HORIZON_Y + 4 - fadeTop);
    skyCtx.fillStyle = hz; skyCtx.fillRect(0, HORIZON_Y, SKY_W, SKY_H - HORIZON_Y);
    skyTex.needsUpdate = true;
  }

  /* ---------------- 2. NO horizon rings. EVER. ----------------------
     OWNER DECISION (stated twice, with screenshots): no painted skyline
     cutouts, no lit-window ring, no haze-band cylinder — every one of
     them reads as a fake "ring around the world" from any rooftop or
     aircraft. The horizon is the real sea plane melting into the fog
     and the dome's fog band. DO NOT ADD RING MESHES BACK. */

  /* ---------------- 3. stars -----------------------------------------
     Disabled by design.  Screen-space Points read as white weather/dust
     floating in front of the HUD and terrain from an aircraft.  The authored
     sky gradient, sun and moon carry time-of-day without fake specks. */
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

  /* ---------------- 4. sun + moon sprites + dusk halo ----------------
     Placed from daynight's sun angle (CBZ.sunAngle) so the glowing disc
     in the sky IS the light that's hitting the streets. Additive, no
     depth write — the skyline rings silhouette against them at dusk.
     At golden hour/dusk the disc warms, swells slightly, and a big soft
     additive halo blooms around it (the burn made local). */
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
  // coreless, very soft falloff — pure glow, the white centre stays the disc's job
  const haloSpr = skySprite(discTexture([
    [0, "rgba(255,210,150,0.5)"], [0.4, "rgba(255,165,95,0.26)"], [1, "rgba(255,120,60,0)"],
  ]), 200);

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

  /* ---------------- 5b. billboard cloud layer (Technique 1) ---------
     mrdoob's classic clouds example merged a pile of plane meshes into
     ONE static BufferGeometry with GeometryUtils.merge (deprecated/gone
     in r128) so puffs the camera could fly past were still just flat
     paper cutouts baked at world-fixed spots. We want the OPPOSITE of
     world-fixed here: a thin high layer that always reads as "clouds
     drifting overhead ahead of you" no matter which of the three worlds
     (or how far you've walked in the city) you're in — so instead of a
     merge we use ONE InstancedMesh (same draw-call win the merge was
     going for, just the r128-idiomatic instanced form) of small soft-
     edged billboard planes, RECYCLED AROUND THE CAMERA exactly like
     weather.js's rain pool: a fixed-size ring of puffs seeded on a disc
     around the player, each one silently re-seeded to a fresh spot once
     it drifts far enough away that recycling it is invisible. That's
     the only way a bounded instance count can cover unbounded player
     travel across escape/survival/city without ever thinning out or
     needing per-region authoring (the section above, which stays as-is
     for the low "always visible in the distance" skyline puffs).
     Texture: one shared runtime radial-gradient CanvasTexture (same
     canvas-blob-of-alpha approach city/blobshadows.js uses for ground
     contact shadows, just white-on-transparent instead of black) — no
     asset dependency, one canvas, one texture, one material, one mesh. */
  const BCLOUD_N = 26;              // pooled billboard count (small: this is a THIN high layer, not full overcast)
  const BCLOUD_RADIUS = 340;        // disc radius around the camera puffs are scattered/recycled within
  const BCLOUD_Y_MIN = 100, BCLOUD_Y_MAX = 150; // altitude band, above the box-puff clusters (72-92)
  const BCLOUD_DRIFT = 1.1;         // units/sec — same order of magnitude as the box clusters' 0.8

  function billboardCloudTex() {
    const cv = document.createElement("canvas");
    cv.width = cv.height = 64;
    const cx = cv.getContext("2d");
    const grd = cx.createRadialGradient(32, 32, 2, 32, 32, 30);
    grd.addColorStop(0, "rgba(255,255,255,0.85)");
    grd.addColorStop(0.5, "rgba(255,255,255,0.4)");
    grd.addColorStop(1, "rgba(255,255,255,0)");
    cx.fillStyle = grd; cx.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(cv);
  }

  // seeded LCG (never Math.random — matches weather.js / every other
  // system's determinism rule) so the puff layout is stable session to
  // session instead of reshuffling on every reload.
  let _bcSeed = 91771;
  function bcRng() { _bcSeed = (_bcSeed * 1103515245 + 12345) & 0x7fffffff; return _bcSeed / 0x7fffffff; }

  const bcTex = billboardCloudTex();
  const bcMat = new THREE.MeshBasicMaterial({
    map: bcTex, color: 0xffffff, transparent: true, depthWrite: false,
    fog: true, side: THREE.DoubleSide,
  });
  const bcGeo = new THREE.PlaneGeometry(1, 1);
  const bcInst = new THREE.InstancedMesh(bcGeo, bcMat, BCLOUD_N);
  bcInst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  bcInst.frustumCulled = false; // camera-relative pool — never off-screen-culled away wrongly
  bcInst.renderOrder = -3;      // behind sun/moon/halo sprites, in front of the dome
  scene.add(bcInst);            // world-space, NOT parented to the camera rig — mirrors rain's `scene.add`

  // per-puff scratch (positions/scale only — no per-instance rotation
  // state needed since ALL puffs share one camera-facing quaternion,
  // written once per frame below, exactly like a billboard particle pool)
  const bcPos = new Float32Array(BCLOUD_N * 3);
  const bcScale = new Float32Array(BCLOUD_N);
  function bcSeed(i, cx, cz, anywhere) {
    const a = bcRng() * Math.PI * 2;
    const r = (anywhere ? Math.sqrt(bcRng()) : (0.55 + bcRng() * 0.45)) * BCLOUD_RADIUS;
    const o = i * 3;
    bcPos[o] = cx + Math.cos(a) * r;
    bcPos[o + 1] = BCLOUD_Y_MIN + bcRng() * (BCLOUD_Y_MAX - BCLOUD_Y_MIN);
    bcPos[o + 2] = cz + Math.sin(a) * r;
    bcScale[i] = 55 + bcRng() * 70;
  }
  (function seedAll() {
    const cx = CBZ.camera.position.x, cz = CBZ.camera.position.z;
    for (let i = 0; i < BCLOUD_N; i++) bcSeed(i, cx, cz, true);
  })();

  const _bcM = new THREE.Matrix4(), _bcP = new THREE.Vector3(), _bcS = new THREE.Vector3();
  const _bcQ = new THREE.Quaternion();
  const BCLOUD_R2 = (BCLOUD_RADIUS + 40) * (BCLOUD_RADIUS + 40); // recycle band (a little past the seed radius, like rain's r2 hysteresis)
  function writeBillboardClouds(dt) {
    const cx = CBZ.camera.position.x, cz = CBZ.camera.position.z;
    _bcQ.copy(CBZ.camera.quaternion); // one shared billboard facing for every instance this frame
    // gentle uniform drift (wind reads as "the whole layer creeping one way"
    // rather than each puff wandering independently — cheap and looks right
    // at this altitude/scale) + camera-relative recycling, same shape as
    // weather.js's rain-drop recycle: past the ring → reseed "ahead of you".
    const driftX = BCLOUD_DRIFT, driftZ = BCLOUD_DRIFT * 0.35;
    for (let i = 0; i < BCLOUD_N; i++) {
      const o = i * 3;
      bcPos[o] += driftX * dt;
      bcPos[o + 2] += driftZ * dt;
      const dx = bcPos[o] - cx, dz = bcPos[o + 2] - cz;
      if (dx * dx + dz * dz > BCLOUD_R2) bcSeed(i, cx, cz, false);
      _bcP.set(bcPos[o], bcPos[o + 1], bcPos[o + 2]);
      _bcS.setScalar(bcScale[i]);
      _bcM.compose(_bcP, _bcQ, _bcS);
      bcInst.setMatrixAt(i, _bcM);
    }
    bcInst.instanceMatrix.needsUpdate = true;
  }
  writeBillboardClouds(0);

  /* ---------------- per-frame sync ----------------------------------
     Runs at order 99 — AFTER daynight (@2), weather's fog lerp (@90),
     survival's env override (@93) and city's light override (@94) — so
     it reads the FINAL fog colour of the frame, whatever mode wrote it.
     That's the whole seam fix: horizon stop == scene.fog.color, always. */
  let forcePaint = true, lastPaintAt = -1e9;
  const lastFog = new THREE.Color(-1, -1, -1), lastTint = new THREE.Color(-1, -1, -1);
  let lastKDay = -1, lastGlowK = -1, lastGlowU = -1, lastPhotoK = -1;
  const _fogFallback = new THREE.Color(0xbfe0ff);
  function moved(a, b) {
    return Math.abs(a.r - b.r) > 0.006 || Math.abs(a.g - b.g) > 0.006 || Math.abs(a.b - b.b) > 0.006;
  }

  CBZ.onAlways(99, function (dt) {
    const cam = CBZ.camera.position;
    rig.position.set(cam.x, 0, cam.z);

    const fog = scene.fog ? scene.fog.color : _fogFallback;
    const tint = dome.material.color;

    const night = CBZ.nightAmount == null ? 0 : CBZ.nightAmount;
    const dayness = CBZ.dayness == null ? 1 : CBZ.dayness;
    const duskness = CBZ.duskness == null ? 0 : CBZ.duskness;
    const a = CBZ.sunAngle == null ? 1.1 : CBZ.sunAngle;
    const up = CBZ.sunHeight == null ? Math.sin(a) : CBZ.sunHeight; // signed sun height

    // ---- frame palette: blend the keyframe tables -------------------
    const kDay = clamp01(up * 2.2 + 0.05);   // full daytime sky by mid-morning
    const civil = clamp01(0.45 - up * 3.2);  // 0 = golden hour, 1 = sun dipped
    _zen.copy(PAL.night.zen).lerp(PAL.day.zen, kDay).lerp(PAL.dusk.zen, duskness * 0.6);
    _mid.copy(PAL.night.mid).lerp(PAL.day.mid, kDay).lerp(PAL.dusk.mid, duskness * 0.85);
    _hot.copy(PAL.glow.golden).lerp(PAL.glow.civil, civil);
    _gmid.copy(PAL.glow.goldenMid).lerp(PAL.glow.civilMid, civil);
    frame.duskW = duskness;
    frame.glowK = duskness;
    frame.photoK = clamp01((up - 0.3) * 4); // photo fades out entering golden hour
    // sun azimuth → canvas u (r128 SphereGeometry: x=-cos(2πu)·s, z=sin(2πu)·s)
    let gu = Math.atan2(-10, -Math.cos(a) * 80) / (Math.PI * 2);
    frame.glowU = gu - Math.floor(gu);

    // dome repaint — throttled (canvas refill + ~2MB upload is cheap at
    // <10Hz, wasteful at 60); fog/palette drift over seconds, not frames
    const du = Math.abs(frame.glowU - lastGlowU);
    const palMoved = Math.abs(kDay - lastKDay) > 0.02 ||
      Math.abs(frame.glowK - lastGlowK) > 0.02 ||
      (frame.glowK > 0.02 && Math.min(du, 1 - du) > 0.01) ||
      Math.abs(frame.photoK - lastPhotoK) > 0.03;
    if (forcePaint || (CBZ.now - lastPaintAt > 100 && (moved(fog, lastFog) || moved(tint, lastTint) || palMoved))) {
      paintSky(fog, tint);
      lastFog.copy(fog); lastTint.copy(tint);
      lastKDay = kDay; lastGlowK = frame.glowK; lastGlowU = frame.glowU; lastPhotoK = frame.photoK;
      lastPaintAt = CBZ.now; forcePaint = false;
    }

    // No floating point-stars: keep the object inert so no per-frame scene
    // rebuild is needed and older save/config state cannot turn it back on.
    stars.visible = false;

    // sun + moon ride daynight's angle
    _p.set(Math.cos(a) * 80, Math.sin(a) * 95, -10).normalize();
    const sunY = _p.y;
    sunSpr.position.copy(_p).multiplyScalar(795);
    let sop = Math.min(1, dayness * 1.6 + duskness * 0.5);
    if (sunY < -0.02) sop = 0;
    sunSpr.visible = sop > 0.01;
    if (sunSpr.visible) {
      sunSpr.material.opacity = sop;
      if (CBZ.sunTint) sunSpr.material.color.copy(CBZ.sunTint);
      const coreS = 95 * (1 + duskness * 0.5); // the low sun looks bigger
      sunSpr.scale.set(coreS, coreS, 1);
    }
    // dusk halo: blooms with duskness, lingers a moment after the disc dips
    const hop = duskness * clamp01((sunY + 0.15) * 7);
    haloSpr.visible = hop > 0.015;
    if (haloSpr.visible) {
      haloSpr.position.copy(sunSpr.position);
      haloSpr.material.opacity = Math.min(1, hop);
      haloSpr.material.color.copy(_hot);
      const hs = 170 + 170 * duskness;
      haloSpr.scale.set(hs * 1.35, hs, 1); // wider than tall — it hugs the horizon
    }
    _p.set(Math.cos(a + Math.PI) * 80, Math.sin(a + Math.PI) * 95, -10).normalize();
    moonSpr.position.copy(_p).multiplyScalar(795);
    let mop = Math.min(1, Math.max(0, (night - 0.12) * 1.25));
    if (_p.y < -0.02) mop = 0;
    moonSpr.visible = mop > 0.01;
    if (moonSpr.visible) moonSpr.material.opacity = mop;

    // clouds: drift + day/night shading (white by day, sunset-lit at dusk,
    // dimmed and pushed toward the haze colour at night)
    writeClouds(dt);
    cloudMat.color.setScalar(0.35 + 0.65 * dayness).lerp(fog, 0.12 + night * 0.2 + duskness * 0.25);

    // billboard cloud layer: same day/night/dusk tint recipe as the box-puff
    // clusters above (one shared look, two techniques) plus a storm-darken
    // pass so the high layer reads as "weather" too — feature-detected since
    // weather.js loads AFTER this file in index.html and may not exist yet
    // on the very first frames (or at all, in a stripped-down build).
    writeBillboardClouds(dt);
    const rainI = (CBZ.weather && typeof CBZ.weather.intensity === "number") ? CBZ.weather.intensity : 0;
    bcMat.color.setScalar(0.35 + 0.65 * dayness).lerp(fog, 0.12 + night * 0.2 + duskness * 0.25);
    bcMat.color.multiplyScalar(1 - rainI * 0.35); // storm clouds read darker/heavier, not just wetter streets
    bcMat.opacity = 0.9 - rainI * 0.15; // slightly thins the soft edge in a downpour rather than solid overcast
  });
})();
