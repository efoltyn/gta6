/* ============================================================
   city/props.js — street furniture + traffic-light poles + a shared
   billboard-label helper. Hooked by world.js via CBZ.cityProps(city).

   Traffic lights are built here (one signal head per intersection
   approach) and attached to the intersection record; city/traffic.js
   drives their colour each frame and reads them for red-light tickets.

   Also builds the HOMELESS CAMPS in the projects/industrial pocket —
   WHY: the money ladder only reads if its bottom rung is VISIBLE. The
   vagrants peds.js spawns on those same lots need somewhere they live
   (tarp tents, a burning barrel, carts, cardboard); driving from this
   to your penthouse IS the scoreboard. CBZ.cityCamps publishes anchors.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const mat = CBZ.mat;

  // ---- shared cached label sprite (storefront signs, ped names, markers) ----
  const labelCache = new Map();
  CBZ.makeLabelSprite = function (text, opts) {
    opts = opts || {};
    const key = text + "|" + (opts.color || "#eef4ff");
    let m = labelCache.get(key);
    if (!m) {
      const c = document.createElement("canvas");
      c.width = 256; c.height = 64;
      const x = c.getContext("2d");
      // auto-fit: long labels ("MOB BOSS · 24", storefront names) shrink to the
      // canvas instead of clipping at the edges. Cached per text, so it's free.
      let fs = 30;
      x.font = "bold 30px Fredoka, sans-serif";
      const tw = x.measureText(text).width;
      if (tw > 242) { fs = Math.max(16, Math.floor(30 * 242 / tw)); x.font = "bold " + fs + "px Fredoka, sans-serif"; }
      x.textAlign = "center"; x.textBaseline = "middle";
      x.lineWidth = Math.max(4, fs * 0.2); x.strokeStyle = "rgba(0,0,0,.75)";
      x.strokeText(text, 128, 34);
      x.fillStyle = opts.color || "#eef4ff";
      x.fillText(text, 128, 34);
      const tex = new THREE.CanvasTexture(c);
      m = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
      m._shared = true;
      labelCache.set(key, m);
    }
    const s = new THREE.Sprite(m);
    s.scale.set(4, 1, 1);
    return s;
  };

  // lamp emissive material factory
  function lampMat(color) { return new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.2 }); }

  // ---- shared geometry / material caches ----------------------------------
  // Hundreds of props get placed, so EVERY repeated mesh must share one geometry
  // and one material instance. Build them lazily, key by a descriptive string,
  // and never dispose (they live for the whole run).
  const GEO = new Map();
  function geo(key, make) { let g = GEO.get(key); if (!g) { g = make(); GEO.set(key, g); } return g; }
  const MAT = new Map();
  function smat(color, opts) {
    opts = opts || {};
    const key = color + "|" + (opts.emissive || 0) + "|" + (opts.ei || 0) + "|" + (opts.rough || 0);
    let m = MAT.get(key);
    if (!m) {
      m = new THREE.MeshLambertMaterial({ color });
      if (opts.emissive != null) { m.emissive = new THREE.Color(opts.emissive); m.emissiveIntensity = opts.ei || 0; }
      m._shared = true;
      MAT.set(key, m);
    }
    return m;
  }

  // ============================================================
  //  FAKE-GLOW FRESNEL SHELL (Stemkoski Shader-Glow / ektogamat fake-glow-
  //  material technique, hand-ported to a plain ShaderMaterial string — no
  //  post-processing bloom pass, just a view-dependent rim on a slightly
  //  bigger shell around the real bulb). WHY: with hundreds of bulbs city-
  //  wide, a real light source per bulb is a non-starter (see the POOLED
  //  POINT-LIGHT section below for why), and a flat emissive box alone reads
  //  as a dim rectangle at any distance — the Fresnel rim gives every bulb a
  //  convincing halo for the cost of one extra tiny shell tri-strip, additive-
  //  blended so overlapping shells only ever brighten, never occlude.
  //
  //  ONE InstancedMesh per colour (bulbs only ever need a handful of colours:
  //  warm streetlamp white + red/yellow/green signals), so citywide bulb
  //  count adds ZERO new draw calls beyond these few pooled meshes — matches
  //  this file's existing geo()/smat() sharing discipline, just extended to
  //  ShaderMaterial + InstancedMesh for this one repeated visual.
  //
  //  Per-instance "on/off" without touching instance COUNT: an instanced
  //  aGlow float attribute (0=dark/broken, 1=lit) lets a shot-out streetlamp
  //  or a signal's off-phase colour go dark without reshuffling indices —
  //  same idiom as systems/dustfx.js's per-vertex aFade attribute.
  // ============================================================
  const glowShellGeo = geo("glowShell", () => new THREE.SphereGeometry(1, 8, 6));
  function makeGlowShellMat(colorHex) {
    if (!THREE.ShaderMaterial) return null;    // minimal/headless THREE stub — caller skips the shell entirely
    const m = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(colorHex) } },
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      vertexShader: [
        "attribute float aGlow;",
        "varying float vGlow;",
        "varying vec3 vNormal;",
        "varying vec3 vViewDir;",
        "void main() {",
        "  vGlow = aGlow;",
        "  vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);",
        "  vNormal = normalize(normalMatrix * mat3(instanceMatrix) * normal);",
        "  vViewDir = normalize(-mv.xyz);",
        "  gl_Position = projectionMatrix * mv;",
        "}",
      ].join("\n"),
      fragmentShader: [
        "precision mediump float;",
        "uniform vec3 uColor;",
        "varying float vGlow;",
        "varying vec3 vNormal;",
        "varying vec3 vViewDir;",
        "void main() {",
        // classic Fresnel rim: glancing angles (normal perpendicular to the
        // view) glow brightest, face-on reads almost clear — the fake-glow-
        // material look, no lighting model needed at all.
        "  float rim = 1.0 - max(0.0, dot(normalize(vNormal), normalize(vViewDir)));",
        "  float fres = pow(rim, 2.2);",
        "  gl_FragColor = vec4(uColor, fres * vGlow * 0.85);",
        "}",
      ].join("\n"),
    });
    m._shared = true;
    return m;
  }
  // one small pooled InstancedMesh per glow colour. `cap` instances are
  // pre-allocated (never resized); positions/scales are written once at
  // build time from the collected spot list, aGlow toggled later by index
  // for broken lamps / dark signal phases. Returns null (headless-safe) if
  // ShaderMaterial/InstancedMesh aren't available or there's nothing to draw.
  function buildGlowShellPool(colorHex, spots, sizeScale) {
    if (!spots.length) return null;
    const mat2 = makeGlowShellMat(colorHex);
    if (!mat2) return null;
    const im = new THREE.InstancedMesh(glowShellGeo, mat2, spots.length);
    im.castShadow = false; im.receiveShadow = false; im.frustumCulled = false;
    im.renderOrder = 5;
    const aGlow = new Float32Array(spots.length).fill(1);
    // real THREE.BufferGeometry supports setAttribute on the instanced mesh's
    // geometry for a per-instance attribute keyed by gl_InstanceID via the
    // standard "instanced attribute" divisor path r128 wires automatically
    // when the attribute lives on the geometry of an InstancedMesh.
    if (im.geometry && im.geometry.setAttribute && THREE.InstancedBufferAttribute) {
      const attr = new THREE.InstancedBufferAttribute(aGlow, 1);
      im.geometry.setAttribute("aGlow", attr);
      im._aGlowAttr = attr;
    }
    im._aGlow = aGlow;
    const m4 = new THREE.Matrix4(), p = new THREE.Vector3(), q0 = new THREE.Quaternion(), s = new THREE.Vector3();
    spots.forEach((sp, i) => {
      p.set(sp.x, sp.y, sp.z);
      s.set(sp.r || sizeScale, sp.r || sizeScale, sp.r || sizeScale);
      m4.compose(p, q0, s);
      im.setMatrixAt(i, m4);
      sp.glowIndex = i; sp.glowPool = im;   // let the caller dim/relight this exact instance later
    });
    im.instanceMatrix.needsUpdate = true;
    return im;
  }
  // dim or relight one instance in a glow-shell pool (e.g. a shot-out
  // streetlamp, or a traffic phase that isn't the currently-lit colour)
  // without touching the shared instance count/order.
  function setGlowOn(spot, on) {
    if (!spot || !spot.glowPool || spot.glowIndex == null) return;
    const im = spot.glowPool;
    if (!im._aGlow) return;
    im._aGlow[spot.glowIndex] = on ? 1 : 0;
    if (im._aGlowAttr) im._aGlowAttr.needsUpdate = true;
  }

  // ============================================================
  //  SHOOTABLE STREET PROPS — the street REACTS to gunfire (USER-FILMED:
  //  "shooting objects feels wrong"). gunfx.js routes every shot LINE here
  //  (CBZ.cityShootProp); we test the few registered props near the segment
  //  and answer in kind: a streetlight SHATTERS DARK, a hydrant POPS a
  //  20-second water geyser (the classic showpiece), trash cans / news boxes
  //  / cones get KNOCKED FLYING, bolted steel (mailboxes, meters) rings and
  //  keeps the pock. WHY: a block you just shot up must LOOK shot up —
  //  that's the show-off receipt. COST: a cheap segment-vs-point scan over a
  //  flat registry (a few flops per prop per tracer), pooled water sprites,
  //  tip animations that touch only group transform — zero new draw calls
  //  beyond the pooled droplets.
  // ============================================================
  let shootables = [];                  // {type,x,z,y,r,...} registered at build
  const knocks = [];                    // props mid-tip
  const geysers = [];                   // popped hydrants {x,z,t,acc}
  const drops = [];                     // live water droplets
  const dropPool = [];
  // NO-DECOY FIX: light street furniture (bin/meter/newsbox/cone) used to be
  // shootable but utterly car-transparent — a car ploughed straight through a
  // trash can with zero reaction. carKnockables mirrors the record a car can
  // actually clip (x,z,r + the SAME group/over fields the shootables record
  // for that prop already carries, so a bullet-knock and a bumper-knock share
  // one "is it already tipped" flag and never double-animate the same prop).
  const carKnockables = [];             // {type,x,z,r,group,ref} — scanned vs CBZ.cityCars
  let waterTex = null;
  const deadLampM = new THREE.MeshLambertMaterial({ color: 0x202329 });
  deadLampM._shared = true;             // survives any teardown traversal
  const _qTip = new THREE.Quaternion(), _axTip = new THREE.Vector3();
  // headless-safe: real THREE.Quaternion always has setFromAxisAngle/multiply;
  // a minimal test stub (tools/harness.js) may not. Feature-detect ONCE so the
  // knock-over animator below can skip the rotation math gracefully instead of
  // throwing — this only ever matters off-browser (harness.js now legitimately
  // reaches tipProp via ordinary traffic driving past a bin/cone/newsbox/meter
  // over a long simulated run, a path nothing exercised before).
  const _hasFullQuat = typeof _qTip.setFromAxisAngle === "function" && typeof _qTip.multiply === "function";

  function waterTexture() {
    if (waterTex) return waterTex;
    const c = document.createElement("canvas"); c.width = c.height = 32;
    const x = c.getContext("2d");
    const gr = x.createRadialGradient(16, 16, 1, 16, 16, 15);
    gr.addColorStop(0, "rgba(235,245,255,0.95)");
    gr.addColorStop(0.55, "rgba(180,210,235,0.55)");
    gr.addColorStop(1, "rgba(150,190,225,0)");
    x.fillStyle = gr; x.fillRect(0, 0, 32, 32);
    waterTex = new THREE.CanvasTexture(c);
    return waterTex;
  }
  function takeDrop() {
    let s = dropPool.pop();
    if (!s) {
      s = new THREE.Sprite(new THREE.SpriteMaterial({ map: waterTexture(), transparent: true, opacity: 0, depthWrite: false }));
      s.renderOrder = 8;
      CBZ.scene.add(s);
    }
    s.visible = true;
    return s;
  }
  // knock a prop over AWAY from the shot: rotate about the horizontal axis
  // perpendicular to the bullet, slide it along, light things hop. Composes
  // with the prop's own yaw via quaternion (q0) — touches transform only.
  function tipProp(s, dirX, dirZ, hop, slide) {
    if (s.over || !s.group) return;
    s.over = true;
    const dl = Math.hypot(dirX, dirZ) || 1; dirX /= dl; dirZ /= dl;
    // headless-safe: a minimal Quaternion stub (tools/harness.js — it never
    // exercised this path before the car-knock scan below started reaching
    // props during ordinary traffic simulation) may lack .clone(); real THREE
    // always has it, so this fallback is a no-op in the browser.
    const q0 = (s.group.quaternion && s.group.quaternion.clone) ? s.group.quaternion.clone() : s.group.quaternion;
    knocks.push({
      g: s.group, t: 0, dur: 0.4 + Math.random() * 0.18,
      axx: dirZ, axz: -dirX,                  // tips the top toward +dir
      ang: 1.4 + Math.random() * 0.18,
      x0: s.group.position.x, y0: s.group.position.y, z0: s.group.position.z,
      sx: dirX * slide, sz: dirZ * slide, hop: hop || 0,
      q0,
    });
  }
  // one shot reaction, by what the round actually hit
  function hitProp(s, p, n, d) {
    const imp = CBZ.bulletImpact, hole = CBZ.bulletHole;
    if (s.type === "lamp") {
      if (imp) imp(p, n, { kind: "spark", power: 1.2 });
      if (!s.broken) {
        s.broken = true;
        if (s.bulb) s.bulb.material = deadLampM;       // the head goes DARK
        if (s.glow) s.glow.visible = false;            // and so does its pool on the street
        setGlowOn(s.glowSpot, false);                  // and its Fresnel glow-shell instance dims too
        if (imp) imp(p, { x: n.x, y: -0.6, z: n.z }, { kind: "chip", power: 1.2, color: 0xdfe9f2 });   // glass rains down
        if (CBZ.sfx) CBZ.sfx("clank");
      }
    } else if (s.type === "hydrant") {
      if (imp) imp(p, n, { kind: "spark", power: 1 });
      if (hole) hole(p, n, { size: 0.16 });
      if (!s.gy || s.gy.t <= 0) {                      // POP — the street fountain
        s.gy = { x: s.x, z: s.z, t: 20, acc: 0 };
        geysers.push(s.gy);
        if (CBZ.sfx) CBZ.sfx("clank");
      } else s.gy.t = Math.max(s.gy.t, 12);            // re-shot: keep it gushing
    } else if (s.type === "bin") {
      if (imp) imp(p, n, { kind: "chip", power: 0.9, color: 0x356b3e });
      if (hole) hole(p, n, { size: 0.15 });
      tipProp(s, d.x, d.z, 0, 0.45);
    } else if (s.type === "newsbox") {
      if (imp) imp(p, n, { kind: "chip", power: 0.8, color: 0x9aa0a8 });
      if (hole) hole(p, n, { size: 0.14 });
      tipProp(s, d.x, d.z, 0.1, 0.6);
    } else if (s.type === "cone") {
      if (imp) imp(p, n, { kind: "chip", power: 0.6, color: 0xff6a1a });
      tipProp(s, d.x, d.z, 0.3, 1.5);                  // light plastic FLIES
    } else {                                           // mailbox / meter: bolted steel
      if (imp) imp(p, n, { kind: "spark", power: 0.9 });
      if (hole) hole(p, n, { size: 0.13 });
    }
    return s;
  }
  // PUBLIC: a shot travelled from→to — react the nearest registered prop the
  // line passes through (within its radius). Returns the prop record or null.
  CBZ.cityShootProp = function (from, to) {
    if (!shootables.length || !from || !to) return null;
    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
    const len2 = dx * dx + dy * dy + dz * dz;
    if (len2 < 1e-4) return null;
    let best = null, bt = 2;
    for (let i = 0; i < shootables.length; i++) {
      const s = shootables[i];
      const ox = s.x - from.x, oy = s.y - from.y, oz = s.z - from.z;
      const t = (ox * dx + oy * dy + oz * dz) / len2;
      if (t < 0 || t > 1 || t >= bt) continue;
      const mx = ox - dx * t, my = oy - dy * t, mz = oz - dz * t;
      if (mx * mx + my * my + mz * mz > s.r * s.r) continue;
      bt = t; best = s;
    }
    if (!best) return null;
    const il = 1 / Math.sqrt(len2);
    return hitProp(best,
      { x: from.x + dx * bt, y: from.y + dy * bt, z: from.z + dz * bt },
      { x: -dx * il, y: -dy * il, z: -dz * il },
      { x: dx * il, z: dz * il });
  };
  // one always-driver animates tips + geysers; idles to a length check when quiet
  if (CBZ.onAlways) CBZ.onAlways(7.8, function (dt) {
    if (!knocks.length && !geysers.length && !drops.length) return;
    // knock-overs: eased tip + slide (+ a hop for the cones)
    for (let i = knocks.length - 1; i >= 0; i--) {
      const k = knocks[i];
      k.t += dt;
      const u = Math.min(1, k.t / k.dur);
      const e = 1 - (1 - u) * (1 - u);
      if (_hasFullQuat) {
        _axTip.set(k.axx, 0, k.axz);
        _qTip.setFromAxisAngle(_axTip, e * k.ang);
        k.g.quaternion.copy(_qTip).multiply(k.q0);
      }
      k.g.position.set(k.x0 + k.sx * e, k.y0 + (k.hop ? Math.sin(u * Math.PI) * k.hop : 0), k.z0 + k.sz * e);
      if (u >= 1) { k.g.position.y = k.y0; knocks.splice(i, 1); }
    }
    // hydrant geysers: emit pooled droplets while anyone's near enough to see
    const cam = CBZ.camera && CBZ.camera.position;
    for (let i = geysers.length - 1; i >= 0; i--) {
      const gy = geysers[i];
      gy.t -= dt;
      if (gy.t <= 0) { geysers.splice(i, 1); continue; }
      if (!cam) continue;
      const gdx = gy.x - cam.x, gdz = gy.z - cam.z;
      if (gdx * gdx + gdz * gdz > 90 * 90) continue;
      const fade = Math.min(1, gy.t / 3);              // pressure dies over the last seconds
      gy.acc += dt;
      while (gy.acc > 0.04 && drops.length < 80) {
        gy.acc -= 0.04;
        const s = takeDrop();
        s.position.set(gy.x + (Math.random() - 0.5) * 0.16, 0.75, gy.z + (Math.random() - 0.5) * 0.16);
        s.scale.set(0.3, 0.5, 1);
        s.material.opacity = 0.85 * fade;
        drops.push({ s, vx: (Math.random() - 0.5) * 1.6, vy: (8.5 + Math.random() * 3.5) * (0.55 + 0.45 * fade), vz: (Math.random() - 0.5) * 1.6, life: 1 });
      }
      if (gy.acc > 0.04) gy.acc = 0;                   // pool full — drop the backlog
    }
    // droplets: ballistic rise + fall, swell and thin out on the way down
    for (let i = drops.length - 1; i >= 0; i--) {
      const p = drops[i];
      p.life -= dt;
      p.vy -= 13 * dt;
      p.s.position.x += p.vx * dt; p.s.position.y += p.vy * dt; p.s.position.z += p.vz * dt;
      if (p.life <= 0 || p.s.position.y < 0.05) { p.s.visible = false; dropPool.push(p.s); drops.splice(i, 1); continue; }
      const u = 1 - p.life;
      p.s.scale.set(0.3 + u * 0.9, 0.5 + u * 0.7, 1);
      p.s.material.opacity = Math.min(0.85, p.life * 1.7) * 0.9;
    }
  });

  // ---- CAR-VS-PROP KNOCKDOWNS (NO-DECOY FIX) -------------------------------
  // Bullets already tip these four over (hitProp above); a car ploughing
  // through the same trash can/meter/newsbox/cone used to sail straight
  // through with zero reaction — the solidCollider() calls added at each
  // builder give the physics resolver something to nudge against, and THIS
  // scan is what makes it look and feel like a hit: the nearest live city car
  // within reach of an un-tipped prop tips it (tipProp, the exact same
  // animation gunfire uses) in the car's direction of travel, and bleeds a
  // touch of the car's speed so the bump reads as contact, not a phantom
  // wall. Deliberately cheap: a flat O(props × nearby cars) scan at 10Hz
  // (proximity, not per-frame), only over the handful of registered props —
  // never a draw call, never touches vehicles.js's own crash/crumple path
  // (these are far too light to dent a hull).
  let _carKnockT = 0;
  // order 14.7: strictly after vehicles.js's driving update (11, computes this
  // frame's car.pos/car.v) but its OWN slot — city/combat.js already owns 15
  // (a melee telegraph scan, unrelated but no need to tie-break against it).
  if (CBZ.onUpdate) CBZ.onUpdate(14.7, function (dt) {
    if (!carKnockables.length || !CBZ.cityCars || !CBZ.cityCars.length) return;
    const gm = CBZ.game; if (!gm || gm.mode !== "city") return;
    _carKnockT += dt;
    if (_carKnockT < 0.1) return;                 // 10Hz — a bumper clip doesn't need 60Hz reaction
    _carKnockT = 0;
    for (let i = 0; i < carKnockables.length; i++) {
      const s = carKnockables[i];
      if (s.over) continue;
      for (let j = 0; j < CBZ.cityCars.length; j++) {
        const car = CBZ.cityCars[j];
        if (!car || car.dead || !car.pos) continue;
        // a car whose physics went bad (NaN pos, e.g. a wrecked/despawning car
        // mid-teardown) must NOT pass the range test below: a NaN distance
        // compares false against EVERY bound, so an unguarded check would
        // silently treat every prop in the array as "in range" and spuriously
        // tip the whole city's street furniture in one tick.
        if (!isFinite(car.pos.x) || !isFinite(car.pos.z)) continue;
        const vmag = Math.abs(car.v || 0);
        if (!isFinite(vmag) || vmag < 0.6) continue;   // parked/crawling/broken cars don't "hit" anything
        const dx = s.x - car.pos.x, dz = s.z - car.pos.z;
        const hitR = s.r + 1.1;                     // s.r is the prop's own radius; +car half-width fudge
        if (dx * dx + dz * dz > hitR * hitR) continue;
        // tip it AWAY from the car, along its heading (mirrors hitProp's d.x/d.z)
        const fx = Math.sin(car.heading || 0), fz = Math.cos(car.heading || 0);
        const light = s.type === "cone" || s.type === "meter";
        tipProp(s, fx, fz, light ? 0.3 : 0.1, light ? 1.4 : 0.55);
        car.v *= 0.94;                              // barely felt — it's a can, not a curb
        if (CBZ.sfx) CBZ.sfx("clank");
        break;                                       // one car claims the hit this tick
      }
    }
  });

  // ---- shared advertising / poster canvas textures ------------------------
  // Billboards + bus-shelter ad panels read from a pool of generated poster
  // textures. Content is RELEVANT to OUR city — the real gangs that hold turf,
  // the real shops you can walk into, mock local brands, our own radio stations,
  // and the occasional WANTED poster keyed to YOUR notoriety. One CanvasTexture
  // per ad, reused everywhere.
  //
  // Each ad entry: [HEADLINE, tagline, bgHex, fgHex, opts?]
  //   opts.kind  — "ad" (default) | "radio" | "gang" | "wanted" | "shop"
  //   opts.tag   — tiny corner label ("AD","FM","TURF","WANTED","NOW OPEN")
  // The gang ads pull their colours straight from CBZ.CITY.gangs so a Vipers
  // board is always Vipers-green; if the player founds/owns a gang we surface
  // that too. WANTED boards read the live wanted star count.

  function gangDefs() { return (CBZ.CITY && CBZ.CITY.gangs) || []; }
  function hex(n) { return "#" + ("000000" + ((n | 0) & 0xffffff).toString(16)).slice(-6); }
  // a darkened version of a colour for poster backgrounds (so the headline pops)
  function darken(n, f) {
    const r = ((n >> 16) & 255) * f, gg = ((n >> 8) & 255) * f, b = (n & 255) * f;
    return "#" + ("000000" + (((r << 16) | (gg << 8) | b) | 0).toString(16)).slice(-6);
  }

  // ---- STATIC pool: local brands, our shops, radio stations, gang slogans ----
  // Mock local brands + funny in-world ads (kept ours, not a clone — these tie
  // into things you actually do in the city: cash, guns, cars, drip, casino).
  const BRAND_ADS = [
    ["SPRUNK", "carbonated with regret", 0x0b2d6b, 0xffd23a],
    ["CLUCKIN' DINER", "27 herbs, 0 questions", 0x7a3a0d, 0xffce7a, { tag: "EAT" }],
    ["PISSWASSER", "the beer you've earned", 0x5a3a12, 0xf0c060],
    ["eCOLA", "now 30% more cola", 0x7a0d14, 0xffe9e9],
    ["VOLT ELECTRONICS", "phones smarter than you", 0x062a2a, 0x39d0c0],
    ["KEYSTONE REALTY", "own the block — press Z", 0x0d3a2c, 0x4fd0a0, { tag: "Z" }],
    ["GRAND CASINO", "the house misses you", 0x2a1a05, 0xc9a227],
    ["BIGNESS BURGER", "supersize your debt", 0x3a0f0f, 0xffcf3a],
    ["BENNY'S CHOP SHOP", "no plate? no problem", 0x2a2308, 0xd0a23c],
    ["IRON GYM", "lift heavy, hit harder", 0x0d2a26, 0x66d9c0],
    ["VINEWOOD", "now casting nobodies", 0x2a1133, 0xff7ad9],
    ["LIFEINVADER", "we already read this", 0x10202c, 0x3fd0ff],
  ];
  // Our shops you can literally walk into — "advertised" so the city points at them.
  const SHOP_ADS = [
    ["AMMU-NATION", "rights. ammo. respect.", 0x1c2414, 0xff5a2c, { tag: "GUNS" }],
    ["BLING JEWELERS", "drip = respect", 0x2a2205, 0xffe08a, { tag: "DRIP" }],
    ["THREADS & DRIP", "look like money", 0x2a113a, 0xc792ea, { tag: "FITS" }],
    ["PREMIUM AUTOS", "test drive forever", 0x2a1805, 0xe88a3c, { tag: "CARS" }],
    ["PAWN & LOAN", "we buy hot junk", 0x2a1c0d, 0xc89a5a, { tag: "FENCE" }],
    ["VELVET CLUB", "after dark, anything", 0x2a0d1a, 0xe85d8a, { tag: "OPEN" }],
    ["THE TRAP HOUSE", "ask for the special", 0x0d2a18, 0x4caf6e, { tag: "??" }],
    ["FRESH CUTS", "lineup of your life", 0x0d1f2a, 0x6bb6ff, { tag: "STYLE" }],
  ];
  // OUR radio dial — invented stations with our own DJ/flavour (in-world humour).
  const RADIO_ADS = [
    ["98.4 BLOK FM", "all trap, all turf", 0x140c2a, 0xb079ea, { kind: "radio", tag: "FM" }],
    ["K-RAGE 101.1", "drive angry", 0x2a0c0c, 0xff6a4a, { kind: "radio", tag: "FM" }],
    ["SIREN AM 88", "police scanner & jazz", 0x0c1a2a, 0x5b8bff, { kind: "radio", tag: "AM" }],
    ["LOWRIDE 96.9", "bounce all night", 0x0c2a1a, 0x49c46e, { kind: "radio", tag: "FM" }],
    ["GHOST CITY RADIO", "nobody's listening", 0x14171d, 0x9fb0c6, { kind: "radio", tag: "FM" }],
    ["VINEWOOD GOLD", "songs your boss likes", 0x2a2205, 0xf2c43d, { kind: "radio", tag: "AM" }],
  ];

  // a board material per ad-record (so each poster can glow a touch at night).
  // adMat now takes an ad ARRAY (not an index) and caches by a content key so
  // dynamic gang/wanted boards rebuild only when their text changes.
  const adCache = new Map();      // key -> CanvasTexture
  const adMatCache = new Map();   // key -> MeshLambertMaterial
  // E3: the trailing "|line3" keeps the MARKET TICKER's third line (CPI) part
  // of the cache key too — every other kind leaves it "" (no behavior change).
  function adKey(ad) { return ad[0] + "|" + ad[1] + "|" + ((ad[4] && ad[4].kind) || "ad") + "|" + ((ad[4] && ad[4].line3) || ""); }

  function adTextureFor(ad) {
    const key = adKey(ad);
    let t = adCache.get(key);
    if (t) return t;
    const head = ad[0], tag = ad[1], bg = ad[2], fg = ad[3], opt = ad[4] || {};
    const kind = opt.kind || "ad";
    const c = document.createElement("canvas");
    c.width = 256; c.height = 128;
    const x = c.getContext("2d");
    // background — a flat fill plus a subtle top/bottom gradient band so it
    // doesn't read as a single dead rectangle.
    const bgCss = typeof bg === "number" ? hex(bg) : bg;
    x.fillStyle = bgCss; x.fillRect(0, 0, 256, 128);
    x.fillStyle = "rgba(255,255,255,.07)"; x.fillRect(0, 0, 256, 26);
    x.fillStyle = "rgba(0,0,0,.18)"; x.fillRect(0, 104, 256, 24);
    const fgCss = typeof fg === "number" ? hex(fg) : fg;

    if (kind === "wanted") {
      // a mock police WANTED poster — big WANTED banner, the player's "name",
      // a star row for the live wanted level and a bounty.
      x.fillStyle = fgCss;
      x.font = "bold 30px Fredoka, Arial, sans-serif";
      x.textAlign = "center"; x.textBaseline = "middle";
      x.fillText("✦ WANTED ✦", 128, 26);
      x.font = "bold 22px Fredoka, Arial, sans-serif";
      x.fillText(head, 128, 64);                 // headline = the perp line
      x.font = "16px Fredoka, Arial, sans-serif";
      x.fillStyle = "rgba(255,255,255,.92)";
      x.fillText(tag, 128, 96);                   // tagline = bounty line
    } else if (kind === "yours") {
      // the OWNER creative — gold double frame + a stylized mug (head, shades,
      // chain). city/adboard.js puts these up when YOU rent the board: the whole
      // money loop ends with the skyline wearing your name, so it must read as
      // YOURS from a block away, not as one more brand poster.
      x.strokeStyle = fgCss; x.lineWidth = 5; x.strokeRect(6, 6, 244, 116);
      x.lineWidth = 2; x.strokeRect(13, 13, 230, 102);
      x.fillStyle = fgCss;
      x.beginPath(); x.arc(44, 54, 18, 0, 6.3); x.fill();                 // head
      x.fillStyle = bgCss; x.fillRect(28, 45, 32, 8);                     // shades
      x.fillStyle = fgCss;
      for (let ci = 0; ci < 5; ci++) { x.beginPath(); x.arc(34 + ci * 5, 80 - Math.abs(ci - 2) * 2, 2.2, 0, 6.3); x.fill(); }  // chain
      // headline + tagline to the right of the face (shrink-to-fit)
      x.textAlign = "center"; x.textBaseline = "middle";
      let yfs = 26; x.font = "bold " + yfs + "px Fredoka, Arial, sans-serif";
      while (x.measureText(head).width > 158 && yfs > 13) { yfs -= 2; x.font = "bold " + yfs + "px Fredoka, Arial, sans-serif"; }
      x.fillText(head, 158, 50);
      x.font = "13px Fredoka, Arial, sans-serif";
      x.fillStyle = "rgba(255,255,255,.85)";
      x.fillText(tag, 158, 86);
      const yCorner = opt.tag || "YOURS";
      x.font = "bold 12px Fredoka, Arial, sans-serif";
      const ycw = x.measureText(yCorner).width + 12;
      x.fillStyle = fgCss; x.fillRect(256 - ycw - 10, 10, ycw, 16);
      x.fillStyle = bgCss; x.fillText(yCorner, 256 - ycw / 2 - 10, 18);
    } else if (kind === "ticker") {
      // E3 LEGIBILITY: the MARKET TICKER — a dark ticker-tape board reading
      // sim/market.js's live category levels + sim/econstate.js's CPI, straight
      // off the skyline. head/tag are two category lines ("FOOD ×1.24 ▲"),
      // opt.line3 is the CPI line; each line's own color reads its trend arrow
      // (no separate metadata needed — the arrow character IS the signal).
      x.fillStyle = "#05060a"; x.fillRect(0, 0, 256, 128);
      x.strokeStyle = "rgba(80,255,170,.4)"; x.lineWidth = 3; x.strokeRect(5, 5, 246, 118);
      x.textAlign = "center"; x.textBaseline = "middle";
      const lines = [head, tag, opt.line3 || ""];
      const ys = [34, 64, 94];
      lines.forEach(function (ln, i) {
        if (!ln) return;
        x.font = "bold 22px 'Courier New', monospace";
        x.fillStyle = ln.indexOf("▲") >= 0 ? "#ff9e6b" : (ln.indexOf("▼") >= 0 ? "#7ed957" : "#9fd8ff");
        x.fillText(ln, 128, ys[i]);
      });
      x.font = "bold 10px Fredoka, Arial, sans-serif";
      x.fillStyle = "rgba(140,255,200,.6)";
      x.fillText("CITY MARKETS", 128, 114);
    } else {
      // accent rules + corner tag
      x.fillStyle = fgCss;
      x.fillRect(0, 14, 256, 3); x.fillRect(0, 110, 256, 3);
      // big headline
      x.font = "bold 38px Fredoka, Arial, sans-serif";
      x.textAlign = "center"; x.textBaseline = "middle";
      // shrink long headlines to fit the board
      let fs = 38; x.font = "bold " + fs + "px Fredoka, Arial, sans-serif";
      while (x.measureText(head).width > 238 && fs > 18) { fs -= 2; x.font = "bold " + fs + "px Fredoka, Arial, sans-serif"; }
      x.fillText(head, 128, 52);
      x.fillStyle = "rgba(255,255,255,.88)";
      x.font = "16px Fredoka, Arial, sans-serif";
      x.fillText(tag, 128, 90);
      // corner tag chip (AD / FM / GUNS / TURF ...)
      const corner = opt.tag || (kind === "radio" ? "FM" : (kind === "gang" ? "TURF" : (kind === "shop" ? "OPEN" : "AD")));
      x.font = "bold 12px Fredoka, Arial, sans-serif";
      const cw = x.measureText(corner).width + 12;
      x.fillStyle = fgCss; x.fillRect(256 - cw - 6, 6, cw, 18);
      x.fillStyle = bgCss; x.textBaseline = "middle"; x.textAlign = "center";
      x.fillText(corner, 256 - cw / 2 - 6, 16);
    }
    t = new THREE.CanvasTexture(c);
    t.anisotropy = 4;
    adCache.set(key, t);
    return t;
  }
  function adMatFor(ad) {
    const key = adKey(ad);
    let m = adMatCache.get(key);
    if (!m) {
      const tex = adTextureFor(ad);
      m = new THREE.MeshLambertMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0 });
      m._ad = true;
      adMatCache.set(key, m);
    }
    return m;
  }
  // SHARED with city/adboard.js (the rentable-board market): the SAME cached
  // generator renders the player's own creatives, so a rented board looks
  // native to the city and costs zero extra materials when reused.
  CBZ.cityAdMatFor = adMatFor;
  CBZ.cityAdKey = adKey;

  // ---- a per-gang TURF board, coloured straight from the gang definition ----
  // Built on demand so the board always matches CBZ.CITY.gangs (and any gang
  // the player founds/recolours). Slogans are ours, not a clone.
  function gangAd(d) {
    const slogans = {
      vipers: "green means GO",
      kings: "ice in our veins",
      reapers: "steel never sleeps",
      saints: "pray we don't find you",
      // 2nd-wave crews
      lords:    "almighty, all is well",
      surenos:  "sur side till we die",
      nortenos: "puro norte, XIV up",
      cartel:   "the plug. everybody eats here",
      cosa:     "this block pays rent to us",
      angels:   "ride or get run over",
      brand:    "blood in, blood out",
    };
    return [d.name.toUpperCase(), slogans[d.id] || "this block is ours", darken(d.color, 0.16), hex(d.color), { kind: "gang", tag: "TURF" }];
  }

  CBZ.cityProps = function (city) {
    const root = city.root, rng = city.rng;
    city.streetProps = city.streetProps || [];
    // fresh world: drop every shootable record/animation from the old one
    shootables = [];
    carKnockables.length = 0;
    knocks.length = 0; geysers.length = 0;
    for (let i = drops.length - 1; i >= 0; i--) { drops[i].s.visible = false; dropPool.push(drops[i].s); }
    drops.length = 0;
    // ---- THE ROAD STOPS BULLETS: one invisible raycast plane just above the
    // street-paint stack (asphalt 0.04 → crosswalks 0.072 → pavement 0.09).
    // The shot resolver (fpsmode wallDistance) only tests CBZ.losBlockers, so
    // a round fired at the asphalt used to sail through the world and leave
    // NOTHING — now it terminates on the street like a wall hit: dust kick,
    // a persistent pock, the thud. visible=false → never rendered (zero draw
    // calls); r128 raycasts it regardless. Built ONCE, ever (losBlockers is
    // never wholesale reset), and one extra plane per ray is noise.
    if (!CBZ._cityGroundRayPlane && CBZ.losBlockers) {
      const gp = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.MeshBasicMaterial());
      gp.material._shared = true; gp.geometry._shared = true;
      gp.rotation.x = -Math.PI / 2;
      gp.position.y = 0.085;
      gp.visible = false;
      gp.updateMatrixWorld(true);          // never in the scene graph — bake the matrix once
      CBZ._cityGroundRayPlane = gp;
      CBZ.losBlockers.push(gp);
    }
    // collected emissive props that should glow after dark (lamp heads, billboard
    // panels, shelter ad-lights, neon shop signs). Driven once/frame in city mode.
    const nightLamps = city._nightLamps = city._nightLamps || [];
    const nightAds = city._nightAds = city._nightAds || [];
    // SMARTER STREET-LIGHT RENDERING collection arrays — fresh per rebuilt
    // world (mirrors shootables/carKnockables above): every streetlamp bulb
    // and every traffic-signal lamp registers a glow-shell "spot" here as
    // it's built; once ALL of them exist (end of cityProps) we bake exactly
    // one pooled InstancedMesh per colour (see buildGlowShellPool) and hand
    // out a small fixed pool of real THREE.PointLights to whichever handful
    // are nearest the camera (see the POOLED DYNAMIC LIGHTS driver near the
    // bottom of this function).
    const lampGlowSpots = [];      // warm streetlamp bulbs {x,y,z,r}
    const sigGlowSpots = { red: [], yel: [], grn: [] };   // traffic-signal lamps, by colour
    const lightCandidates = city._lightCandidates = [];   // {x,y,z,kind,ref|head,spots} — every real-light-eligible bulb, for the pool below
    // boards whose ad CONTENT is live (e.g. the player WANTED poster, or the
    // E3 market ticker below). Each entry is { mesh, dyn, lastKey, cats? } so
    // the driver re-skins only the few that actually change, never every frame.
    const dynAds = city._dynAds = city._dynAds || [];
    // registers a board's mesh for the live-content driver iff pickAd() flagged
    // it dynamic (wanted poster or market ticker) — shared by every board type
    // below so busShelter/billboard/roofBillboard don't each repeat this check.
    function regDynAd(mesh, pick) {
      if (pick && (pick.dyn === "wanted" || pick.dyn === "ticker")) {
        dynAds.push({ mesh: mesh, dyn: pick.dyn, lastKey: adKey(pick.ad), cats: pick.cats });
      }
    }
    // RENTABLE AD SURFACES — every billboard face / shelter panel / rooftop
    // board placed below registers here so city/adboard.js can put it on the
    // market (money → skyline visibility → show-off). Each record carries the
    // mesh(es) to re-skin, the walk-up point, the surface class for pricing,
    // and the original material(s) to restore when a lease lapses.
    const adBoards = CBZ.cityAdBoards = [];

    // ---- ad picker: bias gang/wanted boards where they belong --------------
    const gangAdRecords = gangDefs().map(gangAd);
    function gangNear(x, z) {
      // closest gang turf centre, if any registered (gangs.js sets gang.center)
      const list = CBZ.cityGangs || [];
      let best = null, bd = 70 * 70;
      for (const gg of list) {
        if (!gg.center) continue;
        const dx = gg.center.x - x, dz = gg.center.z - z, d = dx * dx + dz * dz;
        if (d < bd) { bd = d; best = gg; }
      }
      return best;
    }
    // the live WANTED poster — reads the player's notoriety so the city literally
    // puts your face up as the heat climbs. Returns null when you're clean.
    const WANTED_NAMES = ["THE KINGPIN", "PUBLIC ENEMY", "THE GHOST", "THAT GUY", "THE MENACE"];
    function wantedAd() {
      const gm = CBZ.game; if (!gm) return null;
      const wl = (gm.wanted | 0);
      if (wl <= 0) return null;
      const stars = "★".repeat(Math.min(5, wl)) + "☆".repeat(Math.max(0, 5 - wl));
      const who = gm.playerGang && gm.playerGang.name ? gm.playerGang.name.toUpperCase() + " BOSS" : WANTED_NAMES[Math.min(WANTED_NAMES.length - 1, wl - 1)];
      const bounty = "BOUNTY $" + (wl * 2500 + (gm.cityKills | 0) * 250).toLocaleString() + "   " + stars;
      return [who, bounty, 0x1a0d0d, 0xffe2a0, { kind: "wanted", tag: "WANTED" }];
    }
    // ---- E3 LEGIBILITY: the MARKET TICKER creative ---------------------------
    // A deterministic 0..1 hash of a WORLD POSITION — never city.rng(). props.js
    // is the LAST consumer of the shared seeded city.rng stream this build (see
    // world.js: "sibling modules build from city.rng stays byte-identical"), so
    // mixing the ticker in via rng() would still be safe, but a position hash
    // keeps pickAd() trivially reusable from anywhere without any ordering worry.
    function posHash01(x, z) {
      const h = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
      return h - Math.floor(h);
    }
    // the same two categories every time this exact (x,z) is asked — so the
    // ~1Hz live-refresh driver (below) recomputes the SAME board's ticker
    // instead of reshuffling which categories it tracks.
    function tickerCatsFor(x, z) {
      const CATS = (CBZ.market && CBZ.market.CATS) || ["food", "goods", "guns", "materials", "fuel", "luxury"];
      const n = CATS.length;
      const i = Math.floor(posHash01(x, z) * n) % n;
      let j = Math.floor(posHash01(z, x) * n) % n;   // swapped args -> an independent-looking hash
      if (j === i) j = (j + 1) % n;
      return [CATS[i], CATS[j]];
    }
    // builds the live 3-line ad record: two category levels (sim/market.js,
    // with trend arrows) + the city CPI (sim/econstate.js). Returns null if
    // neither system is loaded (a plain city build without Stage E still works).
    function tickerAd(cats) {
      const M = CBZ.market;
      if (!M || typeof M.tickerLine !== "function") return null;
      const line1 = M.tickerLine(cats[0]), line2 = M.tickerLine(cats[1]);
      const E = CBZ.econState;
      // E5/E7: every ~20s window in 4, the CPI line makes way for either the
      // roster's rotating earnings line (sim/corporations.js — E7: rotates
      // across all 8 companies + any player IPO, not just Bunbros) or the
      // LBX national index (sim/stocks.js) — "" falls back to CPI until
      // anything has ever listed.
      const C = CBZ.corps, S = CBZ.stocks;
      const win = Math.floor((CBZ.now || 0) / 20000) % 4;
      const corpLine = (win === 3 && C && typeof C.tickerLine === "function") ? C.tickerLine() : "";
      const idxLine = (win === 2 && S && typeof S.indexTickerLine === "function") ? S.indexTickerLine() : "";
      const line3 = corpLine || idxLine || ((E && typeof E.tickerLine === "function") ? E.tickerLine() : "");
      if (!line1 && !line2 && !line3) return null;
      return [line1, line2, 0x05060a, 0x9fd8ff, { kind: "ticker", tag: "MKT", line3: line3 }];
    }
    // returns an ad record for a board at (x,z): mostly static brand/shop/radio,
    // but a roadside board near a gang's turf shows THAT gang, a fraction of
    // boards become live WANTED posters once you have heat, and (E3) ~1-in-4
    // boards become a live MARKET TICKER instead — the economy readable right
    // off the skyline, no menu needed. `register` lets the caller flag a board
    // as dynamic (gets re-skinned later as those live values move).
    function pickAd(x, z, opts) {
      opts = opts || {};
      // TICKER, gated on the position hash above — checked FIRST and returns
      // before any rng() draw so the existing brand/shop/radio/gang/wanted mix
      // (still ~75% of boards) keeps its exact draw pattern unperturbed.
      if (opts.allowTicker !== false) {
        const th = posHash01(x, z);
        if (th < 0.25) {
          const cats = tickerCatsFor(x, z);
          const ad = tickerAd(cats);
          if (ad) return { ad: ad, dyn: "ticker", cats: cats };
        }
      }
      const r = rng();
      // 1 in ~7 big boards is a (potential) live WANTED poster
      if (opts.allowWanted && r < 0.14) {
        return { ad: wantedAd() || BRAND_ADS[(rng() * BRAND_ADS.length) | 0], dyn: "wanted" };
      }
      // near gang turf, prefer that gang's board
      const ng = gangNear(x, z);
      if (ng && rng() < 0.5) {
        const def = gangDefs().find((d) => d.id === ng.id);
        if (def) return { ad: gangAd(def), dyn: null };
      }
      // otherwise a weighted mix of our own world content
      const roll = rng();
      let pool;
      if (roll < 0.42) pool = BRAND_ADS;
      else if (roll < 0.72) pool = SHOP_ADS;
      else if (roll < 0.9) pool = RADIO_ADS;
      else pool = gangAdRecords.length ? gangAdRecords : BRAND_ADS;
      return { ad: pool[(rng() * pool.length) | 0] || BRAND_ADS[0], dyn: null };
    }

    // a tidy collider for solid props (cars crash, peds can't pass). noCam so the
    // chase camera never snaps in on a thin pole.
    function solidCollider(x, z, r, ref, noCam) {
      if (!CBZ.colliders) return;
      CBZ.colliders.push({ minX: x - r, maxX: x + r, minZ: z - r, maxZ: z + r, ref, noCam: noCam !== false });
    }

    function doorLots() {
      const out = (city.lots || []).slice();
      if (city.annex && city.annex.lots) out.push.apply(out, city.annex.lots);
      return out;
    }
    function pointSegmentD2(px, pz, ax, az, bx, bz) {
      const vx = bx - ax, vz = bz - az, wx = px - ax, wz = pz - az;
      const den = vx * vx + vz * vz || 1;
      const t = Math.max(0, Math.min(1, (wx * vx + wz * vz) / den));
      const dx = px - (ax + vx * t), dz = pz - (az + vz * t);
      return dx * dx + dz * dz;
    }
    // Door points sit just inside the room. Reserve the complete threshold and
    // exterior approach so a pole, bin or bench cannot visually block entry.
    function nearDoor(x, z, radius) {
      const r2 = radius * radius;
      for (const lot of doorLots()) {
        const d = lot.building && lot.building.door;
        if (!d) continue;
        const ex = d.x - d.nx * 4.8, ez = d.z - d.nz * 4.8;
        if (pointSegmentD2(x, z, d.x, d.z, ex, ez) < r2) return true;
      }
      return false;
    }

    // ---- traffic-light heads at every intersection ----
    // A REAL 4-way reads by APPROACH, not by axis-on-one-corner: a driver
    // rolling up to the stop line must see a lit face turned square AT them.
    // For each intersection we therefore build one head PER APPROACH THAT
    // ACTUALLY HAS ONCOMING ROAD, parked on that approach's near-right corner,
    // its lamp face rotated to point back at the oncoming driver.
    //   • makeHead's lamp face is on local +z, so a head at world yaw rotY
    //     shows its face along (sin rotY, 0, cos rotY). To face a driver who is
    //     COMING FROM unit dir (fx,fz) we set rotY = atan2(fx, fz).
    //   • the grid spans the whole map, so every interior crossing is a true
    //     4-way — but a crossing on the OUTERMOST line (i==0/N or j==0/N) has
    //     only a half-road stub on the outward side (the perimeter wall), i.e.
    //     NO oncoming traffic: that approach is OMITTED so no head ever faces a
    //     non-intersection. it.i / it.j vs N decide which approaches are real.
    //   • heads are grouped by the axis they govern: ns[] = N–S-travel faces
    //     (the avenue's north & south approaches), ew[] = E–W-travel faces
    //     (the cross-street's west & east approaches). traffic.js lights a
    //     whole axis array at once (and still handles the single-head path).
    // Geometry is shared via geo() so adding ~2-4 heads/intersection stays
    // draw-call cheap; the four base materials are shared, but each lamp keeps
    // its OWN emissive material (traffic.js mutates it per-head every cycle).
    const sigPoleG = geo("sigPole", () => new THREE.CylinderGeometry(0.12, 0.14, 5.2, 8));
    const sigBoxG = geo("sigBox", () => new THREE.BoxGeometry(0.6, 1.6, 0.5));
    const sigLampG = geo("sigLamp", () => new THREE.SphereGeometry(0.18, 10, 8));
    const sigPoleM = mat(0x2c2f35), sigBoxM = mat(0x1c1f24);
    function makeHead(px, pz, rotY) {
      const head = new THREE.Group();
      // two approaches share a near corner (e.g. the S and E heads both want
      // the +x/-z corner). Nudge each head sideways (perpendicular to its face)
      // so the poles sit shoulder-to-shoulder on the kerb instead of z-fighting.
      const sx = Math.cos(rotY) * 0.5, sz = -Math.sin(rotY) * 0.5;
      head.position.set(px + sx, 0, pz + sz); head.rotation.y = rotY;
      const pole = new THREE.Mesh(sigPoleG, sigPoleM);
      pole.position.y = 2.6; pole.castShadow = true; head.add(pole);
      const box = new THREE.Mesh(sigBoxG, sigBoxM);
      box.position.set(0, 4.6, 0); head.add(box);
      const red = new THREE.Mesh(sigLampG, lampMat(0xff3b3b));
      const yel = new THREE.Mesh(sigLampG, lampMat(0xffcf3b));
      const grn = new THREE.Mesh(sigLampG, lampMat(0x39ff66));
      red.position.set(0, 5.1, 0.28); yel.position.set(0, 4.6, 0.28); grn.position.set(0, 4.1, 0.28);
      head.add(red, yel, grn);
      root.add(head);
      // SMARTER STREET-LIGHT RENDERING: a Fresnel glow shell per lamp (world
      // position = head's world xz + its local sx/sz nudge; local z-offset
      // 0.28 rotated by rotY) and a light-pool CANDIDATE at the lit lamp's
      // position (only the currently-green one ever needs a real light, but
      // registering all three is cheap and the pool driver below only ever
      // lights whichever bulb is actually ON at pick time).
      const faceX = Math.sin(rotY) * 0.28, faceZ = Math.cos(rotY) * 0.28;
      const wx = px + sx + faceX, wz = pz + sz + faceZ;
      const redSpot = { x: wx, y: 5.1, z: wz, r: 0.34 };
      const yelSpot = { x: wx, y: 4.6, z: wz, r: 0.34 };
      const grnSpot = { x: wx, y: 4.1, z: wz, r: 0.34 };
      sigGlowSpots.red.push(redSpot); sigGlowSpots.yel.push(yelSpot); sigGlowSpots.grn.push(grnSpot);
      // kept together (not just pushed into the flat arrays) so the sync
      // driver below can dim/relight all three of THIS head's shells as a
      // matched set without hunting for them by array index.
      lightCandidates.push({ x: wx, y: 4.6, z: wz, kind: "signal", head: { red, yel, grn }, spots: { red: redSpot, yel: yelSpot, grn: grnSpot } });
      return { red, yel, grn };
    }
    const off = city.ROAD / 2 + 0.6;
    const NL = city.N != null ? city.N : ((city.xLines || [1]).length - 1);
    for (const it of city.intersections) {
      const ns = [], ew = [];
      // N–S travel runs along the avenue at this xLine. Its SOUTH (-z) approach
      // exists unless this is the southmost line (j==0); the NORTH (+z) approach
      // exists unless it's the northmost (j==N). Each head sits on the near-RIGHT
      // corner of that approach, face turned to the oncoming driver.
      if (it.j > 0)  ns.push(makeHead(it.x + off, it.z - off, Math.PI));   // from S, faces -z, right=+x
      if (it.j < NL) ns.push(makeHead(it.x - off, it.z + off, 0));         // from N, faces +z, right=-x
      // E–W travel runs along the cross-street at this zLine. WEST (-x) approach
      // exists unless westmost (i==0); EAST (+x) unless eastmost (i==N).
      if (it.i > 0)  ew.push(makeHead(it.x - off, it.z + off, -Math.PI / 2)); // from W, faces -x, right=+z
      if (it.i < NL) ew.push(makeHead(it.x + off, it.z - off, Math.PI / 2));  // from E, faces +x, right=-z
      // ns/ew are arrays of heads; traffic.js lights every head in an axis
      // together. Keep the legacy single-head fields pointing at the first head
      // of each axis (harmless back-compat; only traffic.js reads it.light).
      const ns0 = ns[0] || null, ew0 = ew[0] || null;
      it.light = { ns, ew, head: ns0 || ew0, red: ns0 && ns0.red, yel: ns0 && ns0.yel, grn: ns0 && ns0.grn };
    }

    // ---- street lamps along the avenues ----
    // Roads span the whole map, so a lamp marched down a road's length will,
    // wherever it crosses a perpendicular street, land in the MIDDLE of that
    // cross-road. Skip any position that falls inside an intersection box
    // (within ROAD/2 + margin of a perpendicular road centre-line) so lamps
    // only ever stand on real sidewalk, never out in the traffic.
    const crossClear = city.ROAD / 2 + 1.6;
    const crossLines = (vertical) => (vertical ? (city.allZLines || city.zLines) : (city.allXLines || city.xLines));
    function inCrossRoad(t, vertical, road) {
      const lines = crossLines(vertical);
      const center = vertical ? road.z : road.x;
      const coord = center + t;            // t is measured from road centre
      for (const c of lines) if (Math.abs(coord - c) < crossClear) return true;
      return false;
    }
    // shared lamp-post geometry/material — a tall pole, a curved arm reaching out
    // over the road, and a cobra-head lamp facing DOWN (real LA streetlamp shape).
    const lampPoleG = geo("lampPole", () => new THREE.CylinderGeometry(0.11, 0.15, 5.6, 6));
    const lampArmG = geo("lampArm", () => new THREE.CylinderGeometry(0.07, 0.07, 1.6, 5));
    const lampHeadG = geo("lampHead", () => new THREE.BoxGeometry(0.34, 0.2, 0.7));
    const lampGlowG = geo("lampGlow", () => new THREE.PlaneGeometry(0.5, 0.5));
    const lampBaseG = geo("lampBase", () => new THREE.CylinderGeometry(0.26, 0.32, 0.5, 6));
    const poleM = smat(0x33373e), darkM = smat(0x1d2026);
    const headLampM = lampMat(0xffe9a8);          // shared, glow driven by night
    headLampM.emissiveIntensity = 0.0;
    const glowM = new THREE.MeshBasicMaterial({ color: 0xfff0c0, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
    function makeLampPost(x, z, faceX, faceZ) {
      const g = new THREE.Group();
      g.position.set(x, 0, z);
      const ang = Math.atan2(faceX, faceZ);       // arm reaches toward road centre
      g.rotation.y = ang;
      const pole = new THREE.Mesh(lampPoleG, poleM); pole.position.y = 2.8; pole.castShadow = true; g.add(pole);
      const base = new THREE.Mesh(lampBaseG, darkM); base.position.y = 0.25; g.add(base);
      const arm = new THREE.Mesh(lampArmG, poleM); arm.rotation.z = Math.PI / 2; arm.position.set(0, 5.5, 0.7); g.add(arm);
      const head = new THREE.Mesh(lampHeadG, darkM); head.position.set(0, 5.45, 1.45); g.add(head);
      const bulb = new THREE.Mesh(geo("lampBulb", () => new THREE.BoxGeometry(0.22, 0.06, 0.5)), headLampM);
      bulb.position.set(0, 5.33, 1.45); g.add(bulb);
      const glow = new THREE.Mesh(lampGlowG, glowM); glow.rotation.x = -Math.PI / 2; glow.position.set(0, 5.27, 1.45); g.add(glow);
      root.add(g);
      solidCollider(x, z, 0.3, pole);
      nightLamps.push(glow);
      city.streetProps.push({ x, z, type: "lamp" });
      // SMARTER STREET-LIGHT RENDERING: this bulb's world position (head local
      // (0,5.33,1.45) rotated by `ang`, same rotation the group itself uses)
      // gets a Fresnel glow-shell spot AND is a candidate for the small real
      // THREE.PointLight pool below. Shot-out lamps are handled at push time
      // by wiring the SAME record's `.glowSpot` — hitProp (above) dims it
      // through setGlowOn when it goes dark.
      const bwx = x + Math.sin(ang) * 1.45, bwz = z + Math.cos(ang) * 1.45;
      const glowSpot = { x: bwx, y: 5.33, z: bwz, r: 0.42 };
      lampGlowSpots.push(glowSpot);
      // shoot the HEAD and the light dies (the pole just sparks via walls/ground)
      const shootRec = { type: "lamp", x, z, y: 5.35, r: 0.7, bulb, glow, broken: false, glowSpot };
      shootables.push(shootRec);
      // `ref` lets the pool driver below skip a shot-out lamp (shootRec.broken
      // flips true in hitProp) without a separate "is this lamp dead" lookup.
      lightCandidates.push({ x: bwx, y: 5.33, z: bwz, kind: "lamp", ref: shootRec });
      return g;
    }
    for (const r of city.roads) {
      const n = Math.max(2, Math.floor(r.len / 26));
      for (let i = 0; i <= n; i++) {
        const t = -r.len / 2 + i * (r.len / n);
        if (inCrossRoad(t, r.vertical, r)) continue;     // would sit in a cross-street
        const sgn = (i % 2 === 0 ? 1 : -1);
        const side = sgn * (city.ROAD / 2 + 1.0);
        const x = r.vertical ? r.x + side : r.x + t;
        const z = r.vertical ? r.z + t : r.z + side;
        if (Math.abs(x) > 9999) continue;
        if (nearDoor(x, z, 1.8)) continue;
        // arm reaches toward the road centre (opposite the sidewalk side)
        const fx = r.vertical ? -sgn : 0, fz = r.vertical ? 0 : -sgn;
        makeLampPost(x, z, fx, fz);
      }
    }

    // =====================================================================
    //  GTA-style street furniture. Real props that BELONG on a sidewalk and
    //  serve a function. Big ones (hydrants, mailboxes, bus shelters, billboards)
    //  get colliders; small decor (cones, meters, papers) does not so it never
    //  blocks pedestrians. Everything shares geometry + material.
    // =====================================================================

    // small helper: where a sidewalk edge sits, with a yaw facing the building
    // (so signs/meters face the street). edge 0..3 = N,S,W,E of a lot.
    function edgePoint(lot, edge, t, outBand) {
      const off = lot.w / 2 + (outBand == null ? 1.4 : outBand);
      if (edge === 0) return { x: lot.cx + t, z: lot.cz - off, yaw: 0 };
      if (edge === 1) return { x: lot.cx + t, z: lot.cz + off, yaw: Math.PI };
      if (edge === 2) return { x: lot.cx - off, z: lot.cz + t, yaw: Math.PI / 2 };
      return { x: lot.cx + off, z: lot.cz + t, yaw: -Math.PI / 2 };
    }

    // ----- FIRE HYDRANT: squat body, dome cap, two side outlets ------------
    const hydM = smat(0xd23b30), hydCapM = smat(0xf2c83a);
    function fireHydrant(x, z) {
      const g = new THREE.Group(); g.position.set(x, 0, z);
      const body = new THREE.Mesh(geo("hydBody", () => new THREE.CylinderGeometry(0.17, 0.2, 0.62, 8)), hydM);
      body.position.y = 0.31; body.castShadow = true; g.add(body);
      const cap = new THREE.Mesh(geo("hydCap", () => new THREE.SphereGeometry(0.18, 8, 5, 0, 6.3, 0, 1.3)), hydCapM);
      cap.position.y = 0.62; g.add(cap);
      const noz = geo("hydNoz", () => new THREE.CylinderGeometry(0.07, 0.07, 0.2, 6));
      const n1 = new THREE.Mesh(noz, hydCapM); n1.rotation.z = Math.PI / 2; n1.position.set(0.2, 0.4, 0); g.add(n1);
      const n2 = new THREE.Mesh(noz, hydCapM); n2.rotation.x = Math.PI / 2; n2.position.set(0, 0.4, 0.2); g.add(n2);
      root.add(g);
      solidCollider(x, z, 0.26, body);
      city.streetProps.push({ x, z, type: "hydrant" });
      shootables.push({ type: "hydrant", x, z, y: 0.5, r: 0.5, group: g, gy: null });
    }

    // ----- MAILBOX: USPS-style blue drum letterbox on a foot ---------------
    const mailM = smat(0x2f6bd6), mailLegM = smat(0x21304a);
    function mailbox(x, z, yaw) {
      const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = yaw;
      const drum = new THREE.Mesh(geo("mailDrum", () => {
        const gg = new THREE.CylinderGeometry(0.34, 0.34, 0.62, 10, 1, false, 0, Math.PI);
        gg.rotateZ(Math.PI / 2); return gg;
      }), mailM);
      drum.position.y = 1.05; drum.castShadow = true; g.add(drum);
      const front = new THREE.Mesh(geo("mailFront", () => new THREE.BoxGeometry(0.62, 0.7, 0.04)), mailM);
      front.position.set(0, 0.95, 0.34); g.add(front);
      const leg = geo("mailLeg", () => new THREE.BoxGeometry(0.08, 0.78, 0.08));
      for (const sx of [-0.22, 0.22]) { const l = new THREE.Mesh(leg, mailLegM); l.position.set(sx, 0.4, 0); g.add(l); }
      root.add(g);
      solidCollider(x, z, 0.36, drum);
      city.streetProps.push({ x, z, type: "mailbox" });
      shootables.push({ type: "mailbox", x, z, y: 0.95, r: 0.5 });
    }

    // ----- PUBLIC TRASH CAN: green mesh barrel + dome lid ------------------
    const canM = smat(0x356b3e), lidM = smat(0x223f28);
    function trashCan(x, z) {
      const g = new THREE.Group(); g.position.set(x, 0, z);
      const barrel = new THREE.Mesh(geo("canBarrel", () => new THREE.CylinderGeometry(0.27, 0.23, 0.78, 8)), canM);
      barrel.position.y = 0.39; barrel.castShadow = true; g.add(barrel);
      const lid = new THREE.Mesh(geo("canLid", () => new THREE.CylinderGeometry(0.3, 0.27, 0.12, 8)), lidM);
      lid.position.y = 0.82; g.add(lid);
      root.add(g);
      city.streetProps.push({ x, z, type: "bin" });
      // small, light — a real hit (bullet OR bumper) knocks it flat, it never
      // stops a car. solidCollider's radius is trivial (barrel footprint) so
      // pedestrians route around it but a car barely notices the nudge.
      solidCollider(x, z, 0.24, g);
      const rec = { type: "bin", x, z, y: 0.5, r: 0.48, group: g, over: false };
      shootables.push(rec);
      carKnockables.push(rec);
    }

    // ----- PARKING METER: post + head + tiny display -----------------------
    const meterPostM = smat(0x6a6f78), meterHeadM = smat(0x2a2d33), meterFaceM = smat(0x101216, { emissive: 0x39ff88, ei: 0.5 });
    function parkingMeter(x, z, yaw) {
      const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = yaw;
      const post = new THREE.Mesh(geo("meterPost", () => new THREE.CylinderGeometry(0.05, 0.06, 1.2, 6)), meterPostM);
      post.position.y = 0.6; g.add(post);
      const head = new THREE.Mesh(geo("meterHead", () => new THREE.BoxGeometry(0.22, 0.34, 0.16)), meterHeadM);
      head.position.y = 1.32; g.add(head);
      const face = new THREE.Mesh(geo("meterFace", () => new THREE.PlaneGeometry(0.14, 0.1)), meterFaceM);
      face.position.set(0, 1.36, 0.085); g.add(face);
      root.add(g);
      city.streetProps.push({ x, z, type: "meter" });
      // thin bolted post — a bullet just rings it (hitProp treats meter/
      // mailbox as "bolted steel"), but a CAR is a different order of force:
      // it bends the post right over. Tiny collider + it joins carKnockables
      // below so a bumper clip actually topples it, unlike a gunshot.
      solidCollider(x, z, 0.16, g);
      const rec = { type: "meter", x, z, y: 1.25, r: 0.28, group: g, over: false };
      shootables.push(rec);
      carKnockables.push(rec);
    }

    // ----- NEWSPAPER / NEWS BOX: little coin-op vending box ----------------
    const NEWS_COLORS = [0xc23a3a, 0x2f78d6, 0xe0a020, 0x3a3f47, 0x2f9d5a];
    function newsBox(x, z, yaw, ci) {
      const m = smat(NEWS_COLORS[ci % NEWS_COLORS.length]);
      const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = yaw;
      const body = new THREE.Mesh(geo("newsBody", () => new THREE.BoxGeometry(0.42, 0.78, 0.4)), m);
      body.position.y = 0.55; body.castShadow = true; g.add(body);
      const legG = geo("newsLeg", () => new THREE.BoxGeometry(0.05, 0.32, 0.05));
      for (const sx of [-0.16, 0.16]) for (const sz of [-0.13, 0.13]) { const l = new THREE.Mesh(legG, smat(0x202327)); l.position.set(sx, 0.16, sz); g.add(l); }
      const win = new THREE.Mesh(geo("newsWin", () => new THREE.PlaneGeometry(0.3, 0.4)), smat(0xdfe6ee));
      win.position.set(0, 0.62, 0.205); g.add(win);
      root.add(g);
      city.streetProps.push({ x, z, type: "newsbox" });
      // light sheet-metal box on skinny legs — a small collider so a bumper
      // clip registers as a real hit, not a ghost.
      solidCollider(x, z, 0.22, g);
      const rec = { type: "newsbox", x, z, y: 0.55, r: 0.45, group: g, over: false };
      shootables.push(rec);
      carKnockables.push(rec);
    }

    // ----- TRAFFIC CONE: orange cone + reflective collar -------------------
    const coneM = smat(0xff6a1a), coneBandM = smat(0xf0f0f0), coneBaseM = smat(0x2a1608);
    function trafficCone(x, z) {
      const g = new THREE.Group(); g.position.set(x, 0, z);
      const cone = new THREE.Mesh(geo("coneBody", () => new THREE.ConeGeometry(0.16, 0.5, 7)), coneM);
      cone.position.y = 0.27; cone.castShadow = true; g.add(cone);
      const band = new THREE.Mesh(geo("coneBand", () => new THREE.CylinderGeometry(0.13, 0.15, 0.07, 7)), coneBandM);
      band.position.y = 0.2; g.add(band);
      const base = new THREE.Mesh(geo("coneBase", () => new THREE.BoxGeometry(0.32, 0.04, 0.32)), coneBaseM);
      base.position.y = 0.02; g.add(base);
      root.add(g);
      // trivially light — smallest collider of the four (it's a hollow plastic
      // cone), so it's the easiest thing on the street to send flying.
      solidCollider(x, z, 0.14, g);
      const rec = { type: "cone", x, z, y: 0.27, r: 0.32, group: g, over: false };
      shootables.push(rec);
      carKnockables.push(rec);
    }

    // ----- PLANTER + low-poly TREE -----------------------------------------
    const planterM = smat(0x8a7a64), soilM = smat(0x3a2a1c);
    const trunkM = smat(0x6e4a2c);
    const FOLIAGE = [smat(0x3f7d3a), smat(0x4f9942), smat(0x356e34), smat(0x5aa84c)];
    function planterTree(x, z, withTree) {
      const g = new THREE.Group(); g.position.set(x, 0, z);
      const box = new THREE.Mesh(geo("planterBox", () => new THREE.BoxGeometry(1.0, 0.42, 1.0)), planterM);
      box.position.y = 0.21; box.castShadow = true; g.add(box);
      const soil = new THREE.Mesh(geo("planterSoil", () => new THREE.BoxGeometry(0.86, 0.06, 0.86)), soilM);
      soil.position.y = 0.42; g.add(soil);
      if (withTree) {
        const trunk = new THREE.Mesh(geo("treeTrunk", () => new THREE.CylinderGeometry(0.1, 0.14, 1.5, 6)), trunkM);
        trunk.position.y = 1.15; trunk.castShadow = true; g.add(trunk);
        const fm = FOLIAGE[(rng() * FOLIAGE.length) | 0];
        // two stacked low-poly blobs for a stylised canopy
        const c1 = new THREE.Mesh(geo("treeCanopy1", () => new THREE.IcosahedronGeometry(0.82, 0)), fm);
        c1.position.y = 2.0; c1.castShadow = true; c1.scale.set(1, 0.85, 1); g.add(c1);
        const c2 = new THREE.Mesh(geo("treeCanopy2", () => new THREE.IcosahedronGeometry(0.55, 0)), fm);
        c2.position.set(0.25, 2.55, 0.1); g.add(c2);
        solidCollider(x, z, 0.5, trunk);
        city.streetProps.push({ x, z, type: "tree" });
      } else {
        // shrub planter: a couple of small bushes
        const sm = FOLIAGE[(rng() * FOLIAGE.length) | 0];
        const b1 = new THREE.Mesh(geo("shrub1", () => new THREE.IcosahedronGeometry(0.34, 0)), sm);
        b1.position.set(-0.18, 0.62, 0.1); b1.scale.y = 0.8; g.add(b1);
        const b2 = new THREE.Mesh(geo("shrub2", () => new THREE.IcosahedronGeometry(0.3, 0)), sm);
        b2.position.set(0.2, 0.6, -0.12); g.add(b2);
        solidCollider(x, z, 0.55, box);
        city.streetProps.push({ x, z, type: "planter" });
      }
    }

    // ----- A-FRAME SANDWICH BOARD (sparse generic only) --------------------
    // NOTE: per-shop sidewalk signs were REMOVED — the store's name now lives ON
    // the building facade (buildings agent), not on a board out on the kerb. We
    // keep a *sparse* sandwich board as generic street decor carrying a city
    // brand/radio ad, never a "this is shop X" sign in front of a door.
    function aFrameSign(x, z, yaw, ad) {
      const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = yaw;
      const panelG = geo("aframePanel", () => new THREE.PlaneGeometry(0.7, 0.9));
      const front = new THREE.Mesh(panelG, adMatFor(ad));
      front.position.set(0, 0.55, 0.12); front.rotation.x = 0.18; g.add(front);
      const back = new THREE.Mesh(panelG, adMatFor(ad));
      back.position.set(0, 0.55, -0.12); back.rotation.x = -0.18; back.rotation.y = Math.PI; g.add(back);
      const footG = geo("aframeFoot", () => new THREE.BoxGeometry(0.74, 0.04, 0.5));
      const foot = new THREE.Mesh(footG, smat(0x2a2a2a)); foot.position.y = 0.02; g.add(foot);
      root.add(g);
      city.streetProps.push({ x, z, type: "sign" });  // light, no collider
    }

    // =====================================================================
    //  PER-SHOP SIDEWALK DRESSING — props that match the storefront's KIND.
    //  All share the geo()/smat() caches; small enough to skip colliders so
    //  they never trap a ped, and always placed off the door (caller guards
    //  with nearDoor). Branch picks one of these by lot.building.shop.kind.
    // =====================================================================

    // ----- PATIO SET: a round table, a tilted parasol + a couple of chairs --
    // (food / bar lots — a little outdoor seating spilling onto the kerb).
    const patioTopM = smat(0xb9c0c8), patioLegM = smat(0x55606b), chairM = smat(0x6a7280);
    const UMBRELLA = [smat(0xe05d5d), smat(0x4f9942), smat(0x2f78d6), smat(0xe0a020)];
    function patioSet(x, z, yaw) {
      const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = yaw;
      const top = new THREE.Mesh(geo("patioTop", () => new THREE.CylinderGeometry(0.55, 0.55, 0.06, 12)), patioTopM);
      top.position.y = 0.74; top.castShadow = true; g.add(top);
      const stem = new THREE.Mesh(geo("patioStem", () => new THREE.CylinderGeometry(0.05, 0.05, 0.74, 6)), patioLegM);
      stem.position.y = 0.37; g.add(stem);
      // parasol pole + canopy (a shallow cone)
      const pole = new THREE.Mesh(geo("umbPole", () => new THREE.CylinderGeometry(0.035, 0.035, 2.0, 5)), patioLegM);
      pole.position.y = 1.0; g.add(pole);
      const canopy = new THREE.Mesh(geo("umbTop", () => new THREE.ConeGeometry(1.05, 0.5, 8)), UMBRELLA[(rng() * UMBRELLA.length) | 0]);
      canopy.position.y = 2.05; canopy.castShadow = true; g.add(canopy);
      const chairSeatG = geo("chairSeat", () => new THREE.BoxGeometry(0.4, 0.06, 0.4));
      const chairBackG = geo("chairBack", () => new THREE.BoxGeometry(0.4, 0.4, 0.05));
      for (const a of [0.6, 3.74]) {
        const cx = Math.cos(a) * 0.95, cz = Math.sin(a) * 0.95;
        const seat = new THREE.Mesh(chairSeatG, chairM); seat.position.set(cx, 0.42, cz); g.add(seat);
        const back = new THREE.Mesh(chairBackG, chairM); back.position.set(cx - Math.cos(a) * 0.2, 0.62, cz - Math.sin(a) * 0.2); back.rotation.y = a; g.add(back);
      }
      root.add(g);
      city.streetProps.push({ x, z, type: "patio" });   // soft furniture, no collider
    }

    // ----- BIKE RACK: a low U-loop rail (gym — somewhere to chain a bike) ----
    const bikeM = smat(0x8a9099);
    function bikeRack(x, z, yaw) {
      const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = yaw;
      const railG = geo("bikeRail", () => new THREE.BoxGeometry(2.2, 0.07, 0.07));
      const legG = geo("bikeLeg", () => new THREE.CylinderGeometry(0.05, 0.05, 0.7, 5));
      const rail = new THREE.Mesh(railG, bikeM); rail.position.y = 0.62; g.add(rail);
      for (const lx of [-1.0, -0.33, 0.33, 1.0]) { const l = new THREE.Mesh(legG, bikeM); l.position.set(lx, 0.31, 0); g.add(l); }
      // a couple of upright loops so it reads as a real rack
      const loopG = geo("bikeLoop", () => new THREE.TorusGeometry(0.28, 0.04, 5, 9, Math.PI));
      for (const lx of [-0.66, 0.66]) { const lp = new THREE.Mesh(loopG, bikeM); lp.position.set(lx, 0.62, 0); g.add(lp); }
      root.add(g);
      solidCollider(x, z, 0.4, rail);
      city.streetProps.push({ x, z, type: "bikerack" });
    }

    // ----- PROPANE CAGE: a steel cage of swap-out tanks (hardware lot) ------
    const cageM = smat(0x9a6a2a), tankPropM = smat(0xc23a3a), cageBarM = smat(0x4a4f57);
    function propaneCage(x, z, yaw) {
      const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = yaw;
      const base = new THREE.Mesh(geo("cageBase", () => new THREE.BoxGeometry(1.4, 0.12, 0.8)), cageM);
      base.position.y = 0.06; base.castShadow = true; g.add(base);
      // a couple of propane bottles inside
      const tankG = geo("propaneTank", () => new THREE.CylinderGeometry(0.16, 0.16, 0.6, 8));
      for (const px of [-0.45, 0, 0.45]) { const tk = new THREE.Mesh(tankG, tankPropM); tk.position.set(px, 0.42, rng() < 0.5 ? -0.15 : 0.15); g.add(tk); }
      // cage bars (a top frame + corner posts) — reads as a locked rack
      const postG = geo("cagePost", () => new THREE.BoxGeometry(0.05, 0.95, 0.05));
      for (const px of [-0.68, 0.68]) for (const pz of [-0.36, 0.36]) { const p = new THREE.Mesh(postG, cageBarM); p.position.set(px, 0.5, pz); g.add(p); }
      const topG = geo("cageTop", () => new THREE.BoxGeometry(1.4, 0.05, 0.8));
      const topf = new THREE.Mesh(topG, cageBarM); topf.position.y = 0.96; g.add(topf);
      root.add(g);
      solidCollider(x, z, 0.55, base);
      city.streetProps.push({ x, z, type: "propane" });
    }

    // ----- PER-SHOP SANDWICH BOARD: an A-frame whose panel reflects the shop --
    // Unlike the sparse generic board, this one is keyed to the storefront's
    // kind so a diner shows a diner promo, a gym a gym promo, etc. It reuses the
    // cached adTextureFor() pipeline by composing a small per-kind ad record
    // (cached by content) — no per-frame work, no new canvas churn after first build.
    const SHOP_BOARD_AD = {
      food:     ["TODAY'S SPECIAL", "2-for-1 wings til 6", 0x7a3a0d, 0xffce7a, { tag: "EAT" }],
      bar:      ["HAPPY HOUR", "half off, all night", 0x2a0d1a, 0xe85d8a, { tag: "OPEN" }],
      gym:      ["FREE TRIAL WEEK", "lift heavy, hit harder", 0x0d2a26, 0x66d9c0, { tag: "GYM" }],
      hardware: ["TOOL SALE", "everything must go", 0x3a2a08, 0xffd166, { tag: "SALE" }],
      barber:   ["WALK-INS WELCOME", "lineup of your life", 0x0d1f2a, 0x6bb6ff, { tag: "STYLE" }],
      clothing: ["NEW DROP", "look like money", 0x2a113a, 0xc792ea, { tag: "FITS" }],
      jewelry:  ["BLOWOUT", "drip = respect", 0x2a2205, 0xffe08a, { tag: "DRIP" }],
      electronics: ["TRADE-IN", "phones smarter than you", 0x062a2a, 0x39d0c0, { tag: "TECH" }],
      guns:     ["RANGE OPEN", "rights. ammo. respect.", 0x1c2414, 0xff5a2c, { tag: "GUNS" }],
      pawn:     ["WE BUY GOLD", "we buy hot junk", 0x2a1c0d, 0xc89a5a, { tag: "CASH" }],
    };
    function shopBoard(x, z, yaw, kind) {
      const ad = SHOP_BOARD_AD[kind];
      if (!ad) return false;
      aFrameSign(x, z, yaw, ad);    // reuses the cached adMatFor()/adTextureFor()
      return true;
    }

    // ----- BUS-STOP SHELTER: posts, flat roof, bench, glass ad panel -------
    const shelterPostM = smat(0x3a3f47), shelterRoofM = smat(0x202327), glassM = new THREE.MeshLambertMaterial({ color: 0x9fc6e0, transparent: true, opacity: 0.28 });
    function busShelter(x, z, yaw) {
      const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = yaw;
      const postG = geo("shelterPost", () => new THREE.BoxGeometry(0.1, 2.3, 0.1));
      for (const px of [-1.7, 1.7]) for (const pz of [-0.6, 0.6]) { const p = new THREE.Mesh(postG, shelterPostM); p.position.set(px, 1.15, pz); g.add(p); }
      const roof = new THREE.Mesh(geo("shelterRoof", () => new THREE.BoxGeometry(3.8, 0.12, 1.5)), shelterRoofM);
      roof.position.y = 2.35; roof.castShadow = true; g.add(roof);
      // back glass wall
      const back = new THREE.Mesh(geo("shelterGlass", () => new THREE.PlaneGeometry(3.4, 1.9)), glassM);
      back.position.set(0, 1.2, -0.6); g.add(back);
      // bench
      const bench = new THREE.Mesh(geo("shelterBench", () => new THREE.BoxGeometry(2.6, 0.1, 0.5)), smat(0x55606b));
      bench.position.set(0, 0.55, -0.35); bench.castShadow = true; g.add(bench);
      const legG = geo("shelterBenchLeg", () => new THREE.BoxGeometry(0.1, 0.5, 0.4));
      for (const lx of [-1.1, 1.1]) { const l = new THREE.Mesh(legG, shelterPostM); l.position.set(lx, 0.25, -0.35); g.add(l); }
      // lit advertising panel on one end (glows at night). Bus shelters carry
      // our brand/shop/radio + gang ads (no wanted posters at street level).
      const pick = pickAd(x, z, { allowWanted: false });
      const adM = adMatFor(pick.ad);
      const ad = new THREE.Mesh(geo("shelterAd", () => new THREE.PlaneGeometry(1.0, 1.7)), adM);
      ad.position.set(1.74, 1.2, 0); ad.rotation.y = -Math.PI / 2; g.add(ad);
      nightAds.push(adM);
      regDynAd(ad, pick);   // wanted poster or E3 market ticker -> live-refresh driver
      // rentable: walk-up point is the PANEL end of the shelter (world coords)
      adBoards.push({ mesh: ad, x: x + Math.cos(yaw) * 1.74, z: z - Math.sin(yaw) * 1.74, y: 0, kind: "shelter", mat0: adM });
      // bus-stop sign pole at the end
      const sp = new THREE.Mesh(geo("shelterSignPole", () => new THREE.CylinderGeometry(0.05, 0.05, 2.6, 6)), shelterPostM);
      sp.position.set(2.1, 1.3, 0); g.add(sp);
      const sign = new THREE.Mesh(geo("shelterSign", () => new THREE.BoxGeometry(0.5, 0.5, 0.06)), smat(0x2f6bd6, { emissive: 0x2f6bd6, ei: 0.15 }));
      sign.position.set(2.1, 2.5, 0); g.add(sign);
      root.add(g);
      // colliders on the posts only (you can walk in, sit, take cover; cars crash the frame)
      solidCollider(x - Math.cos(yaw) * 1.7, z + Math.sin(yaw) * 1.7, 0.5, roof, false);
      solidCollider(x + Math.cos(yaw) * 1.7, z - Math.sin(yaw) * 1.7, 0.5, roof, false);
      city.streetProps.push({ x, z, type: "busstop" });
    }

    // ----- BILLBOARD: tall steel legs + a big lit ad board -----------------
    const billLegM = smat(0x4a4f57), billFrameM = smat(0x2a2d33);
    function billboard(x, z, yaw, big) {
      const W = big ? 8.5 : 6.0, H = big ? 4.2 : 3.0, post = big ? 8.0 : 6.5;
      const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = yaw;
      const legG = geo("billLeg" + (big ? "B" : "S"), () => new THREE.CylinderGeometry(0.22, 0.28, post, 7));
      for (const lx of [-W * 0.3, W * 0.3]) { const l = new THREE.Mesh(legG, billLegM); l.position.set(lx, post / 2, 0); l.castShadow = true; g.add(l); }
      // cross brace
      const brace = new THREE.Mesh(geo("billBrace" + (big ? "B" : "S"), () => new THREE.BoxGeometry(W * 0.7, 0.16, 0.16)), billLegM);
      brace.position.set(0, post * 0.55, 0); g.add(brace);
      const frame = new THREE.Mesh(geo("billFrame" + (big ? "B" : "S"), () => new THREE.BoxGeometry(W + 0.4, H + 0.4, 0.3)), billFrameM);
      frame.position.set(0, post + H / 2, 0); g.add(frame);
      // each face gets its OWN ad record. Big roadside boards may show a live
      // WANTED poster (your face goes up with your heat); both faces glow at night.
      const pickF = pickAd(x, z, { allowWanted: big });
      const pickB = pickAd(x, z, { allowWanted: false });
      const boardG = geo("billBoard" + (big ? "B" : "S"), () => new THREE.PlaneGeometry(W, H));
      const front = new THREE.Mesh(boardG, adMatFor(pickF.ad)); front.position.set(0, post + H / 2, 0.18); g.add(front);
      const back = new THREE.Mesh(boardG, adMatFor(pickB.ad)); back.position.set(0, post + H / 2, -0.18); back.rotation.y = Math.PI; g.add(back);
      nightAds.push(adMatFor(pickF.ad), adMatFor(pickB.ad));
      // register either face if it's live (WANTED poster or E3 market ticker)
      // so the driver can re-skin its material as those values change.
      regDynAd(front, pickF);
      regDynAd(back, pickB);
      // rentable: a lease takes BOTH faces (the flex reads from either direction)
      adBoards.push({ mesh: front, mesh2: back, x, z, y: 0, kind: big ? "bill" : "small", mat0: adMatFor(pickF.ad), mat0b: adMatFor(pickB.ad) });
      // walkway light bar under the board
      const bar = new THREE.Mesh(geo("billBar" + (big ? "B" : "S"), () => new THREE.BoxGeometry(W, 0.1, 0.4)), smat(0xfff4d0, { emissive: 0xfff4d0, ei: 0 }));
      bar.position.set(0, post - 0.1, 0.4); g.add(bar);
      nightLamps.push(bar);
      root.add(g);
      // two leg colliders so a car can smash into the billboard base
      solidCollider(x - Math.cos(yaw) * W * 0.3, z + Math.sin(yaw) * W * 0.3, 0.35, g, false);
      solidCollider(x + Math.cos(yaw) * W * 0.3, z - Math.sin(yaw) * W * 0.3, 0.35, g, false);
      city.streetProps.push({ x, z, type: "billboard" });
    }

    // ----- BILLBOARD ROAD-CLEARANCE TEST (BUG FIX) -------------------------
    // A billboard's footprint is a thin slab: its WIDTH (W, plus a little frame)
    // runs along the board TANGENT; it's nearly flat in the facing direction
    // (frame depth + the two leg colliders, r=0.35). The old placers only tested
    // the board CENTRE against ONE road, so a board whose centre cleared the kerb
    // could still throw its width — 4+ metres of it — out across a PERPENDICULAR
    // cross-street, or sit a perimeter board's legs straight in the edge street.
    // This tests the board's whole AABB footprint against EVERY road carriageway
    // (centre-line ± ROAD/2) with a margin, so no part overhangs any kerb.
    function billboardFootprint(yaw, big) {
      const W = big ? 8.5 : 6.0;
      const halfT = W / 2 + 0.2;                 // tangent half-span (frame = W+0.4)
      const halfN = 0.35 + 0.35;                 // facing depth (frame) + leg collider r
      const ca = Math.abs(Math.cos(yaw)), sa = Math.abs(Math.sin(yaw));
      // world AABB half-extents (tangent runs on local +x → world (cos,-sin);
      // normal on local +z → world (sin,cos))
      return { extX: halfT * ca + halfN * sa, extZ: halfT * sa + halfN * ca };
    }
    // true if every part of the board's footprint clears every road by `marg`.
    function billboardClearsRoads(x, z, yaw, big, marg) {
      const fp = billboardFootprint(yaw, big);
      const half = city.ROAD / 2;
      const m = marg == null ? 1.0 : marg;
      for (const r of city.roads) {
        if (r.vertical) {
          // carriageway is x ∈ road.x ± half, spanning z over road.len about road.z
          if (Math.abs(z - r.z) - fp.extZ > r.len / 2) continue;   // footprint off the road's length
          if (Math.abs(x - r.x) - fp.extX < half + m) return false;
        } else {
          if (Math.abs(x - r.x) - fp.extX > r.len / 2) continue;
          if (Math.abs(z - r.z) - fp.extZ < half + m) return false;
        }
      }
      return true;
    }

    // =====================================================================
    //  PLACEMENT — march props around every block's sidewalk; bias the corners
    //  for hydrants/meters and put the bigger landmark props (shelters, big
    //  billboards) only where there's room (corner lots / wide frontage).
    // =====================================================================
    const lots = city.lots;
    let lotIdx = 0;
    for (const lot of lots) {
      lotIdx++;
      // 1) parking meters in a short row along ONE street-facing edge
      if (rng() < 0.6) {
        const edge = (rng() * 4) | 0;
        const meters = 2 + ((rng() * 3) | 0);
        const start = -(meters - 1) * 1.1;
        for (let m = 0; m < meters; m++) {
          const p = edgePoint(lot, edge, start + m * 2.2, 1.0);
          if (nearDoor(p.x, p.z, 1.8)) continue;
          parkingMeter(p.x, p.z, p.yaw);
        }
      }
      // 2) a hydrant near one corner
      if (rng() < 0.5) {
        const edge = (rng() * 4) | 0;
        const p = edgePoint(lot, edge, (rng() - 0.5) * lot.w * 0.8, 1.2);
        if (!nearDoor(p.x, p.z, 2.0)) fireHydrant(p.x, p.z);
      }
      // 3) trash + news boxes near a corner (decor, no collide)
      if (rng() < 0.7) {
        const edge = (rng() * 4) | 0;
        const p = edgePoint(lot, edge, (rng() - 0.5) * lot.w * 0.7, 1.1);
        if (!nearDoor(p.x, p.z, 1.6)) {
          if (rng() < 0.5) trashCan(p.x, p.z);
          else newsBox(p.x, p.z, p.yaw, (rng() * NEWS_COLORS.length) | 0);
        }
      }
      // 4) a mailbox
      if (rng() < 0.35) {
        const edge = (rng() * 4) | 0;
        const p = edgePoint(lot, edge, (rng() - 0.5) * lot.w * 0.6, 1.3);
        if (!nearDoor(p.x, p.z, 2.2)) mailbox(p.x, p.z, p.yaw + Math.PI);
      }
      // 5) planters / street trees spaced along an edge
      if (rng() < 0.75) {
        const edge = (rng() * 4) | 0;
        const trees = 1 + ((rng() * 3) | 0);
        const start = -(trees - 1) * 2.2;
        for (let m = 0; m < trees; m++) {
          const p = edgePoint(lot, edge, start + m * 4.4 + (rng() - 0.5), 1.6);
          if (nearDoor(p.x, p.z, 2.4)) continue;
          planterTree(p.x, p.z, rng() < 0.65);
        }
      }
      // 6) RARELY a generic sandwich board out on the sidewalk (NOT a per-shop
      //    door sign — those are gone; the store name lives on the facade now).
      //    Carries a city brand/radio ad, placed on a clear kerb away from doors.
      if (rng() < 0.06) {
        const edge = (rng() * 4) | 0;
        const p = edgePoint(lot, edge, (rng() - 0.5) * lot.w * 0.5, 1.2);
        if (!nearDoor(p.x, p.z, 2.6)) {
          const mix = rng() < 0.5 ? BRAND_ADS : RADIO_ADS;
          aFrameSign(p.x, p.z, p.yaw, mix[(rng() * mix.length) | 0]);
        }
      }
      // 7) a bus shelter occasionally, on a long clear edge
      if (rng() < 0.12) {
        const edge = (rng() * 4) | 0;
        const p = edgePoint(lot, edge, 0, 2.2);
        if (!nearDoor(p.x, p.z, 3.0) && Math.abs(p.x) < 9990) {
          const yaw = edge < 2 ? 0 : Math.PI / 2;
          busShelter(p.x, p.z, yaw + (edge === 0 || edge === 2 ? 0 : Math.PI));
        }
      }
      // 8) a few traffic cones in a little cluster (roadwork feel)
      if (rng() < 0.18) {
        const edge = (rng() * 4) | 0;
        const p0 = edgePoint(lot, edge, (rng() - 0.5) * lot.w * 0.6, 0.7);
        for (let c = 0; c < 3; c++) trafficCone(p0.x + (rng() - 0.5) * 1.2, p0.z + (rng() - 0.5) * 1.2);
      }
      // 9) PER-SHOP sidewalk dressing keyed to the storefront kind. Placed on the
      //    door-facing edge but OFFSET to the side of the door (so it dresses the
      //    frontage without ever blocking entry); nearDoor() is the final guard.
      const shop = lot.building && lot.building.shop;
      if (shop) {
        const kind = shop.kind;
        // the storefront edge (door side); offset the prop along it, away from centre.
        const sEdge = lot.building.side != null ? lot.building.side : (rng() * 4) | 0;
        const t = (rng() < 0.5 ? -1 : 1) * (lot.w * 0.26 + 1.0);   // off to one side of the door
        const place = (band, fn, prob) => {
          if (rng() >= prob) return;
          const p = edgePoint(lot, sEdge, t, band);
          if (Math.abs(p.x) > 9990 || nearDoor(p.x, p.z, 2.6)) return;
          fn(p.x, p.z, p.yaw);
        };
        if (kind === "food" || kind === "bar") {
          // a patio table out front + a matching sandwich board
          place(2.0, (x, z, yaw) => patioSet(x, z, yaw), 0.7);
          place(1.2, (x, z, yaw) => shopBoard(x, z, yaw, kind), 0.45);
        } else if (kind === "gym") {
          place(1.4, (x, z, yaw) => bikeRack(x, z, yaw), 0.7);
          place(1.2, (x, z, yaw) => shopBoard(x, z, yaw, kind), 0.4);
        } else if (kind === "hardware") {
          place(1.4, (x, z, yaw) => propaneCage(x, z, yaw), 0.7);
          place(1.2, (x, z, yaw) => shopBoard(x, z, yaw, kind), 0.4);
        } else {
          // every other storefront just gets the occasional per-shop board
          place(1.2, (x, z, yaw) => shopBoard(x, z, yaw, kind), 0.35);
        }
      }
    }

    // ----- BILLBOARDS on the perimeter wall + a few rooftops ---------------
    // Big roadside billboards face inward along the outer walls (you see them as
    // you drive the ring road); their legs sit just inside the sidewalk band.
    // BUG FIX: the old fixed +6 inset dropped a board's legs straight into the
    // outermost cross-street (that street's kerb is only ~4.5 from the wall). We
    // now push each board INWARD (along its facing normal, away from the wall)
    // until its full footprint clears every road kerb, then place it — and skip
    // it entirely if no inset within reach is clear (better a gap than a board
    // in the carriageway). The inward direction is the board's local +z normal:
    // world (sin yaw, cos yaw).
    const mnX = city.minX, mxX = city.maxX, mnZ = city.minZ, mxZ = city.maxZ;
    const bbStepX = (mxX - mnX) / 4, bbStepZ = (mxZ - mnZ) / 4;
    // place a board at base (bx,bz) facing `yaw`, sliding it INWARD along
    // (inX,inZ) AND laterally along the kerb (the board tangent) until its whole
    // footprint clears every road. The lateral slide matters because a mid-wall
    // board lands square on the perpendicular CENTRAL road, and its width — not
    // its depth — straddles that carriageway: only stepping it sideways off the
    // centre-line clears it. First clear spot wins; give up rather than place in
    // the street.
    function placePerimBoard(bx, bz, yaw, big, inX, inZ) {
      const tx = inZ, tz = -inX;            // kerb tangent (perp to the inward dir)
      for (let step = 0; step <= 9; step++) {
        const ix = bx + inX * step * 1.5, iz = bz + inZ * step * 1.5;
        for (const lat of [0, 9, -9, 16, -16, 22, -22]) {
          const x = ix + tx * lat, z = iz + tz * lat;
          if (Math.abs(x) > 9990 || Math.abs(z) > 9990) continue;
          if (insideLot(x, z) || nearDoor(x, z, 3)) continue;
          if (billboardClearsRoads(x, z, yaw, big, 1.0)) { billboard(x, z, yaw, big); return true; }
        }
      }
      return false;
    }
    for (let k = 1; k <= 3; k++) {
      // north & south walls (face inward: +z from the south wall, -z from north)
      placePerimBoard(mnX + bbStepX * k, mnZ + 6, 0, true, 0, 1);
      placePerimBoard(mnX + bbStepX * k, mxZ - 6, Math.PI, true, 0, -1);
      // west & east walls (face inward: +x from west wall, -x from east)
      placePerimBoard(mnX + 6, mnZ + bbStepZ * k, Math.PI / 2, true, 1, 0);
      placePerimBoard(mxX - 6, mnZ + bbStepZ * k, -Math.PI / 2, k === 2 ? false : true, -1, 0);
    }

    // ----- CORE-AVENUE BILLBOARDS: the priciest faces in the city ----------
    // Perimeter boards only catch the ring road; the REAL eyeballs are on the
    // two central avenues. Stand a big board on each side of both, turned
    // square at oncoming traffic — these are the district-core surfaces
    // adboard.js prices at multiples of the docks (busyness = rent).
    const cAvX = (mnX + mxX) / 2, cAvZ = (mnZ + mxZ) / 2;
    let vAve = null, hAve = null, bvd = 1e9, bhd = 1e9;
    for (const r of city.roads) {
      if (r.vertical) { const d = Math.abs(r.x - cAvX); if (d < bvd) { bvd = d; vAve = r; } }
      else { const d = Math.abs(r.z - cAvZ); if (d < bhd) { bhd = d; hAve = r; } }
    }
    // a board may not stand inside a lot footprint (it would clip the facade)
    function insideLot(x, z) {
      for (const lot of doorLots()) {
        const hw = lot.w / 2 + 1.0, hd = (lot.d != null ? lot.d : lot.w) / 2 + 1.0;
        if (Math.abs(x - lot.cx) < hw && Math.abs(z - lot.cz) < hd) return true;
      }
      return false;
    }
    // BUG FIX: the old coreBand = ROAD/2 + 2.6 only stood the board CENTRE clear
    // of the avenue, and inCrossRoad() only tested the centre — so a board whose
    // 8.5m width spanned a perpendicular cross-street threw its edge/leg into
    // that carriageway. We now search both the along-road position AND the kerb
    // stand-off, and accept a spot ONLY when the board's full footprint clears
    // every road (billboardClearsRoads). If nothing clears, the board is skipped
    // rather than dropped in the street.
    function coreBoard(road, s) {
      if (!road) return;
      const yaw = road.vertical ? (s > 0 ? -Math.PI / 2 : Math.PI / 2) : (s > 0 ? Math.PI : 0);
      // along-road positions, then progressively deeper kerb stand-offs
      for (const t of [38, 24, 52, 16, 64]) {
        for (const band of [city.ROAD / 2 + 2.6, city.ROAD / 2 + 4.5, city.ROAD / 2 + 6.5]) {
          const bx = road.vertical ? road.x + s * band : road.x + s * t;
          const bz = road.vertical ? road.z + s * t : road.z + s * band;
          if (Math.abs(bx) > 9990 || Math.abs(bz) > 9990) continue;
          if (insideLot(bx, bz) || nearDoor(bx, bz, 4)) continue;
          if (!billboardClearsRoads(bx, bz, yaw, true, 1.0)) continue;
          billboard(bx, bz, yaw, true);
          return;
        }
      }
    }
    for (const s of [-1, 1]) { coreBoard(vAve, s); coreBoard(hAve, s); }

    // ----- ROOFTOP DETAIL: AC, vents, tanks, dishes, stair-hut, skylights,
    //       antenna masts, parapet rails + a RARE rooftop billboard -----------
    // Building lots get a cluster of mechanical gear on the roof — pure silhouette
    // detail, no colliders. Everything reuses the shared geo()/smat() caches, so
    // a hundred roofs add geometry/material instances but stay draw-call cheap.
    // Budget stays a modest 2..5 units/roof; the bigger landmark pieces (stair
    // hut, billboard) are gated behind size/height + low odds so counts don't balloon.
    const acM = smat(0x9aa0a8), ventM = smat(0x6a7079), tankM = smat(0x7a5a3a), pipeM = smat(0x4a4f57);
    const dishM = smat(0xd7dade), hutM = smat(0x6b6f77), hutRoofM = smat(0x33373e);
    const railM = smat(0x42474f), mastM = smat(0x2c2f35), beaconM = lampMat(0xff3b3b);
    // skylight glass: a faint emissive pane so lit interiors read at night.
    const skyGlassM = smat(0x9fb6cc, { emissive: 0xbfe0ff, ei: 0.18 });
    skyGlassM._sky = true;
    nightAds.push(skyGlassM);   // ride the night driver's glow ramp (treated like an ad panel)

    // a satellite dish: a small mast, a shallow parabolic-ish bowl + feed arm.
    function roofDish(ux, uz, h) {
      const post = new THREE.Mesh(geo("dishPost", () => new THREE.CylinderGeometry(0.06, 0.06, 0.5, 5)), pipeM);
      post.position.set(ux, h + 0.25, uz); root.add(post);
      const bowl = new THREE.Mesh(geo("dishBowl", () => new THREE.SphereGeometry(0.42, 9, 6, 0, 6.3, 0, 0.9)), dishM);
      bowl.position.set(ux, h + 0.6, uz); bowl.rotation.x = -1.0; bowl.rotation.y = rng() * 6.28; root.add(bowl);
      const arm = new THREE.Mesh(geo("dishArm", () => new THREE.CylinderGeometry(0.025, 0.025, 0.4, 4)), pipeM);
      arm.position.set(ux, h + 0.7, uz); arm.rotation.x = 0.6; root.add(arm);
    }
    // a skylight: a low frame + an emissive glass quad facing up.
    function roofSkylight(ux, uz, h) {
      const frame = new THREE.Mesh(geo("skyFrame", () => new THREE.BoxGeometry(1.2, 0.14, 0.9)), hutRoofM);
      frame.position.set(ux, h + 0.07, uz); root.add(frame);
      const glass = new THREE.Mesh(geo("skyGlass", () => new THREE.PlaneGeometry(1.04, 0.74)), skyGlassM);
      glass.rotation.x = -Math.PI / 2; glass.position.set(ux, h + 0.15, uz); root.add(glass);
    }
    // an antenna mast: thin pole + a couple of cross arms (+ a red beacon up top).
    function roofMast(ux, uz, h) {
      const tall = 2.2 + rng() * 2.6;
      const pole = new THREE.Mesh(geo("mastPole", () => new THREE.CylinderGeometry(0.05, 0.07, 1, 5)), mastM);
      pole.scale.y = tall; pole.position.set(ux, h + tall / 2, uz); root.add(pole);
      const armG = geo("mastArm", () => new THREE.BoxGeometry(0.9, 0.04, 0.04));
      for (const fy of [0.55, 0.78]) {
        const arm = new THREE.Mesh(armG, mastM); arm.position.set(ux, h + tall * fy, uz); arm.rotation.y = rng() * 6.28; root.add(arm);
      }
      const beacon = new THREE.Mesh(geo("mastBeacon", () => new THREE.SphereGeometry(0.08, 6, 5)), beaconM);
      beacon.position.set(ux, h + tall + 0.06, uz); root.add(beacon);
      nightLamps.push(beacon);   // night driver pulses its emissive
    }
    for (const lot of lots) {
      const b = lot.building; if (!b || b.park) continue;   // parks carry a stub building (owner only) but have NO structure — no roof gear floats over them
      // roof height + extent + the gear-clear roof centre (away from the stairwell)
      const h = (b.h || b.height || (8 + (rng() * 14))) + 0.1;
      const rcx = b.roofCx != null ? b.roofCx : lot.cx;
      const rcz = b.roofCz != null ? b.roofCz : lot.cz;
      const halfW = (b.w ? b.w / 2 : lot.w / 2) - 1.5;
      const halfD = (b.d ? b.d / 2 : lot.d / 2) - 1.5;
      if (halfW < 1.5 || halfD < 1.5) continue;
      const units = 2 + ((rng() * 4) | 0);
      for (let u = 0; u < units; u++) {
        const ux = rcx + (rng() - 0.5) * halfW * 1.4;
        const uz = rcz + (rng() - 0.5) * halfD * 1.4;
        const t = rng();
        if (t < 0.40) {
          const ac = new THREE.Mesh(geo("acUnit", () => new THREE.BoxGeometry(1.3, 0.7, 1.0)), acM);
          ac.position.set(ux, h + 0.35, uz); ac.castShadow = true; root.add(ac);
          const fan = new THREE.Mesh(geo("acFan", () => new THREE.CylinderGeometry(0.32, 0.32, 0.06, 8)), ventM);
          fan.position.set(ux, h + 0.72, uz); root.add(fan);
        } else if (t < 0.58) {
          const v = new THREE.Mesh(geo("roofVent", () => new THREE.CylinderGeometry(0.22, 0.26, 0.6, 7)), ventM);
          v.position.set(ux, h + 0.3, uz); root.add(v);
          const cap = new THREE.Mesh(geo("roofVentCap", () => new THREE.CylinderGeometry(0.3, 0.3, 0.12, 7)), pipeM);
          cap.position.set(ux, h + 0.62, uz); root.add(cap);
        } else if (t < 0.72) {
          const tank = new THREE.Mesh(geo("roofTank", () => new THREE.CylinderGeometry(0.6, 0.6, 1.4, 9)), tankM);
          tank.position.set(ux, h + 0.9, uz); tank.castShadow = true; root.add(tank);
          for (let lg = 0; lg < 3; lg++) {
            const a = lg / 3 * 6.28;
            const leg = new THREE.Mesh(geo("tankLeg", () => new THREE.CylinderGeometry(0.05, 0.05, 0.5, 4)), pipeM);
            leg.position.set(ux + Math.cos(a) * 0.5, h + 0.25, uz + Math.sin(a) * 0.5); root.add(leg);
          }
        } else if (t < 0.85) {
          roofDish(ux, uz, h);
        } else if (t < 0.95) {
          roofSkylight(ux, uz, h);
        } else {
          roofMast(ux, uz, h);
        }
      }
      // a long roof-edge parapet vent pipe for taller buildings
      if (h > 14 && rng() < 0.5) {
        const pipe = new THREE.Mesh(geo("roofPipe", () => new THREE.CylinderGeometry(0.12, 0.12, 1.8, 6)), pipeM);
        pipe.position.set(rcx + halfW * 0.8, h + 0.9, rcz - halfD * 0.8); root.add(pipe);
      }
      // ROOFTOP STAIR-HUT bulkhead REMOVED (owner-filmed): a plain box with a
      // door read as a "fake elevator" you'd expect to enter but can't. The draw
      // call below is preserved (same short-circuit as the old `&& rng() < 0.45`)
      // so the deterministic per-roof prop stream stays byte-identical — only the
      // hut meshes are gone. The real elevators (their lobby cab + enclosed shaft
      // + roof headhouse) are built by city/elevators.js on storeys>=3 towers and
      // are untouched.
      if (halfW > 3 && halfD > 3) { rng(); }
      // PARAPET-RAILING SLATS — a top rail + vertical slats around the roof rim,
      // built as ONE merged-look run per edge using shared slat geometry. Modest
      // slat spacing keeps the count sane; only on roomy roofs.
      if (halfW > 2.5 && halfD > 2.5 && rng() < 0.6) {
        const railTopG = geo("railTopX", () => new THREE.BoxGeometry(1, 0.06, 0.06));
        const railTopZG = geo("railTopZ", () => new THREE.BoxGeometry(0.06, 0.06, 1));
        const slatG = geo("railSlat", () => new THREE.CylinderGeometry(0.02, 0.02, 0.5, 4));
        const railY = h + 0.55;
        // top rails (scaled to each side's span)
        const rN = new THREE.Mesh(railTopG, railM); rN.scale.x = halfW * 2; rN.position.set(rcx, railY, rcz - halfD); root.add(rN);
        const rS = new THREE.Mesh(railTopG, railM); rS.scale.x = halfW * 2; rS.position.set(rcx, railY, rcz + halfD); root.add(rS);
        const rW = new THREE.Mesh(railTopZG, railM); rW.scale.z = halfD * 2; rW.position.set(rcx - halfW, railY, rcz); root.add(rW);
        const rE = new THREE.Mesh(railTopZG, railM); rE.scale.z = halfD * 2; rE.position.set(rcx + halfW, railY, rcz); root.add(rE);
        // vertical slats along N & S edges (spaced ~1.4u, capped at a handful)
        const nSlat = Math.min(10, Math.max(2, Math.floor(halfW * 2 / 1.4)));
        for (let s = 0; s <= nSlat; s++) {
          const sx = rcx - halfW + (s / nSlat) * halfW * 2;
          const a = new THREE.Mesh(slatG, railM); a.position.set(sx, h + 0.3, rcz - halfD); root.add(a);
          const c = new THREE.Mesh(slatG, railM); c.position.set(sx, h + 0.3, rcz + halfD); root.add(c);
        }
      }
      // a RARE rooftop BILLBOARD on tall buildings — a small framed lit ad board
      // standing on the roof, angled to face the street. Big landmark, low odds.
      if (h > 18 && halfW > 3.5 && halfD > 3.5 && rng() < 0.12) {
        const bg = new THREE.Group();
        bg.position.set(rcx, h, rcz + halfD * 0.4);
        bg.rotation.y = rng() < 0.5 ? 0 : Math.PI;
        const legG = geo("roofBillLeg", () => new THREE.CylinderGeometry(0.12, 0.15, 2.4, 6));
        for (const lx of [-2.4, 2.4]) { const l = new THREE.Mesh(legG, billLegM); l.position.set(lx, 1.2, 0); l.castShadow = true; bg.add(l); }
        const frame = new THREE.Mesh(geo("roofBillFrame", () => new THREE.BoxGeometry(6.4, 2.8, 0.25)), billFrameM);
        frame.position.set(0, 3.4, 0); bg.add(frame);
        const pick = pickAd(rcx, rcz, { allowWanted: true });
        const adM = adMatFor(pick.ad);
        const board = new THREE.Mesh(geo("roofBillBoard", () => new THREE.PlaneGeometry(6.0, 2.4)), adM);
        board.position.set(0, 3.4, 0.14); bg.add(board);
        nightAds.push(adM);
        regDynAd(board, pick);   // wanted poster or E3 market ticker -> live-refresh driver
        // rentable from THIS roof (y gates the walk-up): the apex flex — your
        // name over the skyline, reachable via the building's elevator.
        adBoards.push({ mesh: board, x: bg.position.x, z: bg.position.z, y: h, kind: "roof", mat0: adM });
        root.add(bg);
      }
    }

    // =====================================================================
    //  HOMELESS CAMPS — WHERE THE BOTTOM LIVES. 2–3 strips hugging a lot
    //  edge in the projects (industrial fringe as spillover): tarp tents
    //  against the wall, a fire barrel at the kerb, flattened cardboard and
    //  a loaded cart. Deterministic from the city seed and placed AFTER all
    //  other props so the existing rng stream (and thus the whole built
    //  city) is byte-identical to before. Every repeated mesh shares one
    //  geometry/material; the fire is a flicker sprite + an emissive ground
    //  pool — NO real THREE light. CBZ.cityCamps publishes the anchors so
    //  the vagrants can post up here and cop beats can come roust them.
    // =====================================================================
    const camps = CBZ.cityCamps = [];
    const campFires = [];                 // {flame, smoke, y0, ph} — flicker-driven below
    const GY = 0.09;                      // pavement top (sidewalk 0.08 / lot pad 0.10)
    // ridge tent: a 3-sided prism (apex up, flat base on the pavement)
    const tentG = geo("campTent", () => {
      const t = new THREE.CylinderGeometry(1.0, 1.0, 2.1, 3, 1, false, Math.PI / 2);
      t.rotateZ(Math.PI / 2);             // ridge runs along local x
      t.translate(0, 0.5, 0);             // base edge sits at y=0
      return t;
    });
    const flapG = geo("campFlap", () => new THREE.PlaneGeometry(0.55, 0.75));
    const cardG = geo("campCard", () => new THREE.BoxGeometry(0.95, 0.025, 1.5));
    const barrelG = geo("campBarrel", () => new THREE.CylinderGeometry(0.34, 0.3, 0.95, 8));
    const emberG = geo("campEmber", () => new THREE.CircleGeometry(0.27, 8));
    const poolGeo = geo("campPool", () => new THREE.CircleGeometry(2.0, 12));
    const TARPS = [smat(0x2f5fae), smat(0x4a6b3a), smat(0x6e7280)];  // blue tarp, army surplus, grey sheet
    const flapM = smat(0x191c21), cardM = smat(0xa8895c), rustM = smat(0x5e3422);
    const emberM = smat(0xff7a22, { emissive: 0xff7a22, ei: 0.95 }); // the coals burn day & night
    // ONE warm pool material for every camp → flickering them all is a single write
    const firePoolM = new THREE.MeshBasicMaterial({ color: 0xff9a3c, transparent: true, opacity: 0, depthWrite: false });
    // soft radial sprite texture (one tiny canvas per look, ever)
    function puffTex(inner, outer) {
      const c = document.createElement("canvas"); c.width = c.height = 64;
      const x = c.getContext("2d");
      const gr = x.createRadialGradient(32, 32, 2, 32, 32, 30);
      gr.addColorStop(0, inner); gr.addColorStop(1, outer);
      x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
      return new THREE.CanvasTexture(c);
    }
    const flameM = new THREE.SpriteMaterial({ map: puffTex("rgba(255,232,170,1)", "rgba(255,110,20,0)"), color: 0xffb050, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending });
    const smokeTexS = puffTex("rgba(205,210,220,0.8)", "rgba(205,210,220,0)");

    // a loaded shopping cart: basket + tray + handle + axles + a tarp bundle
    const cartM = smat(0x9aa0a8);
    function shoppingCart(x, z, yaw) {
      const g = new THREE.Group(); g.position.set(x, GY, z); g.rotation.y = yaw;
      const basket = new THREE.Mesh(geo("cartBasket", () => new THREE.BoxGeometry(0.82, 0.5, 0.56)), cartM);
      basket.position.y = 0.78; basket.castShadow = true; g.add(basket);
      const tray = new THREE.Mesh(geo("cartTray", () => new THREE.BoxGeometry(0.7, 0.04, 0.48)), cartM);
      tray.position.y = 0.3; g.add(tray);
      const bar = new THREE.Mesh(geo("cartBar", () => new THREE.BoxGeometry(0.07, 0.07, 0.62)), cartM);
      bar.position.set(-0.52, 1.02, 0); g.add(bar);
      const axleG = geo("cartAxle", () => { const a = new THREE.CylinderGeometry(0.07, 0.07, 0.56, 6); a.rotateX(Math.PI / 2); return a; });
      for (const ax of [-0.3, 0.3]) { const w = new THREE.Mesh(axleG, flapM); w.position.set(ax, 0.08, 0); g.add(w); }
      // everything they own, bundled in a tarp on top
      const bag = new THREE.Mesh(geo("cartBag", () => new THREE.IcosahedronGeometry(0.3, 0)), TARPS[(rng() * TARPS.length) | 0]);
      bag.position.set(0.05, 1.12, 0); bag.scale.set(1.1, 0.75, 0.95); g.add(bag);
      root.add(g);
      city.streetProps.push({ x, z, type: "cart" });   // soft junk, no collider (peds flow past)
    }

    // one camp strip on a lot edge. Local frame: t runs along the edge,
    // n points out toward the street (tents hug the wall, barrel at the kerb).
    function buildCamp(lot, edge) {
      const hw = lot.w / 2;
      const F = edge === 0 ? { ox: lot.cx, oz: lot.cz - hw, tx: 1, tz: 0, nx: 0, nz: -1 }
            : edge === 1   ? { ox: lot.cx, oz: lot.cz + hw, tx: 1, tz: 0, nx: 0, nz: 1 }
            : edge === 2   ? { ox: lot.cx - hw, oz: lot.cz, tx: 0, tz: 1, nx: -1, nz: 0 }
            :                { ox: lot.cx + hw, oz: lot.cz, tx: 0, tz: 1, nx: 1, nz: 0 };
      const at = (t, n) => ({ x: F.ox + F.tx * t + F.nx * n, z: F.oz + F.tz * t + F.nz * n });
      const tOff = (rng() - 0.5) * lot.w * 0.25;
      // the whole strip (≈±3 along the edge) must clear doors and the map rim
      for (const tt of [-2.8, 0, 2.8]) {
        const p = at(tOff + tt, 0.9);
        if (Math.abs(p.x) > 9990 || nearDoor(p.x, p.z, 2.8)) return false;
      }
      const ridgeYaw = F.tx ? 0 : -Math.PI / 2;       // tent ridge runs along the edge
      const nT = 2 + ((rng() * 2) | 0);               // 2–3 tents per camp
      for (let i = 0; i < nT; i++) {
        const tt = tOff + (i - (nT - 1) / 2) * 2.6 + (rng() - 0.5) * 0.4;
        const band = 0.1 + rng() * 0.25;              // hugging the wall line
        const p = at(tt, band);
        const tent = new THREE.Mesh(tentG, TARPS[(rng() * TARPS.length) | 0]);
        tent.position.set(p.x, GY, p.z); tent.rotation.y = ridgeYaw + (rng() - 0.5) * 0.16;
        tent.castShadow = true; root.add(tent);
        // dark door flap closing one open end
        const fs = rng() < 0.5 ? -1 : 1;
        const fp = at(tt + fs * 1.04, band);
        const flap = new THREE.Mesh(flapG, flapM);
        flap.position.set(fp.x, GY + 0.42, fp.z);
        flap.rotation.y = F.tx ? (fs > 0 ? Math.PI / 2 : -Math.PI / 2) : (fs > 0 ? 0 : Math.PI);
        root.add(flap);
        solidCollider(p.x, p.z, 0.8, tent);
      }
      // the FIRE BARREL out at the kerb — the camp's hearth
      const bp = at(tOff + (rng() - 0.5) * 1.4, 1.75);
      const barrel = new THREE.Mesh(barrelG, rustM);
      barrel.position.set(bp.x, GY + 0.48, bp.z); barrel.castShadow = true; root.add(barrel);
      const ember = new THREE.Mesh(emberG, emberM);
      ember.rotation.x = -Math.PI / 2; ember.position.set(bp.x, GY + 0.93, bp.z); root.add(ember);
      const flame = new THREE.Sprite(flameM);
      flame.position.set(bp.x, GY + 1.28, bp.z); flame.scale.set(0.55, 0.7, 1); root.add(flame);
      // each wisp owns its material so it can FADE as it rises (≤3 mats total)
      const smoke = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTexS, color: 0xb9bec8, transparent: true, opacity: 0, depthWrite: false }));
      smoke.position.set(bp.x, GY + 1.5, bp.z); root.add(smoke);
      // warm light POOL on the pavement — an emissive disc, not a real light;
      // the flicker driver fades it up after dark (firelight for free)
      const pool = new THREE.Mesh(poolGeo, firePoolM);
      pool.rotation.x = -Math.PI / 2; pool.position.set(bp.x, 0.165, bp.z); root.add(pool);   // floats above pad+cardboard (no z-fight)
      campFires.push({ flame, smoke, y0: GY + 1.4, ph: rng() * 6.28 });
      solidCollider(bp.x, bp.z, 0.42, barrel);
      // flattened CARDBOARD bedding between the tents and the fire
      const nC = 2 + ((rng() * 2) | 0);
      for (let i = 0; i < nC; i++) {
        const p = at(tOff + (rng() - 0.5) * 5.0, 0.7 + rng() * 0.8);
        const card = new THREE.Mesh(cardG, cardM);
        card.position.set(p.x, 0.12, p.z); card.rotation.y = rng() * 6.28; root.add(card);
      }
      // a loaded SHOPPING CART parked at the end of the row
      const cp = at(tOff + (rng() < 0.5 ? -1 : 1) * 3.4, 1.2 + rng() * 0.6);
      shoppingCart(cp.x, cp.z, rng() * 6.28);
      const cc = at(tOff, 1.0);
      camps.push({ x: cc.x, z: cc.z, r: 3.6 });        // anchor: vagrants/cops read this
      city.streetProps.push({ x: cc.x, z: cc.z, type: "camp" });
      return true;
    }

    // pick the camp blocks: the projects pocket first, the industrial fringe
    // as spillover — the SAME lots peds.js seeds its vagrants on, so the
    // beggars and their bedrolls end up on the same corners.
    const dKind = (l) => { const d = city.districtAt ? city.districtAt(l.cx, l.cz) : null; return d ? d.kind : null; };
    const okCampLot = (l) => l.building && !l.building.park;     // a camp needs a wall behind it
    const projLots = lots.filter((l) => dKind(l) === "projects" && okCampLot(l));
    const fringeLots = lots.filter((l) => dKind(l) === "industrial" && okCampLot(l));
    const basePool = projLots.length ? projLots : fringeLots;
    if (basePool.length) {
      const usedCampLots = new Set();
      let builtCamps = 0;
      for (let tries = 0; tries < 14 && builtCamps < 3; tries++) {
        // the third camp prefers the industrial fringe (the alley sleepers)
        const pool = (builtCamps === 2 && fringeLots.length) ? fringeLots : basePool;
        const lot = pool[(rng() * pool.length) | 0];
        if (usedCampLots.has(lot)) continue;
        if (buildCamp(lot, (rng() * 4) | 0)) { usedCampLots.add(lot); builtCamps++; }
      }
    }

    // =====================================================================
    //  CAMP-FIRE FLICKER — the camps' only per-frame cost, and it's tiny:
    //  ≤3 sprite transforms + 2 shared material writes. The flame breathes
    //  (two offset sines ≈ fire), smoke wisps rise/grow/fade on a loop, and
    //  after dark the shared pool disc washes each camp warm.
    // =====================================================================
    if (CBZ.onAlways && campFires.length && !city._campFireHooked) {
      city._campFireHooked = true;
      let ft = 0;
      CBZ.onAlways(7.5, function (dt) {
        const g = CBZ.game;
        if (!g || g.mode !== "city" || !root.visible) return;
        ft += dt || 0.016;
        const n = CBZ.nightAmount == null ? 0 : CBZ.nightAmount;
        const fl = 0.82 + Math.sin(ft * 9.3) * 0.11 + Math.sin(ft * 23.7) * 0.07;
        flameM.opacity = 0.5 + fl * 0.4;
        firePoolM.opacity = (0.04 + n * 0.34) * fl;    // the warm pool only reads after dark
        for (const e of campFires) {
          const s = 0.5 + 0.16 * Math.sin(ft * 11 + e.ph) + 0.05 * Math.sin(ft * 27 + e.ph * 2);
          e.flame.scale.set(s, s * 1.25, 1);
          const u = (ft * 0.3 + e.ph) % 1;             // wisp cycle: rise, swell, thin out
          e.smoke.position.y = e.y0 + u * 1.7;
          const ss = 0.35 + u * 0.9;
          e.smoke.scale.set(ss, ss, 1);
          e.smoke.material.opacity = 0.26 * (1 - u);
        }
      });
    }

    // =====================================================================
    //  NIGHT DRIVER — lamp heads glow + billboards/ad panels self-illuminate
    //  after dark. Reads CBZ.nightAmount (0 day .. 1 deep night) set by
    //  core/daynight.js. City mode only; cheap (a handful of material writes
    //  ramped over a couple seconds, not per-prop work every frame).
    // =====================================================================
    if (CBZ.onAlways && !city._propNightHooked) {
      city._propNightHooked = true;
      let lastN = -1;
      CBZ.onAlways(7, function () {
        const g = CBZ.game;
        if (!g || g.mode !== "city" || !root.visible) return;
        const n = CBZ.nightAmount == null ? 0 : CBZ.nightAmount;
        if (Math.abs(n - lastN) < 0.02) return;     // only touch materials on real change
        lastN = n;
        const on = n;                               // 0..1
        headLampM.emissiveIntensity = 0.05 + on * 0.95;
        glowM.opacity = on * 0.72;     // brighter lamp pool — the street reads by lamplight after dark
        for (const glow of nightLamps) { if (glow.material === glowM) continue; if (glow.material.emissive) glow.material.emissiveIntensity = on * 0.9; }
        for (const am of nightAds) { am.emissiveIntensity = 0.06 + on * 0.6; }
      });
    }

    // =====================================================================
    //  LIVE-CONTENT DRIVER — re-skins the handful of boards whose ad is dynamic:
    //  a WANTED poster (your face, as your heat climbs) or an E3 MARKET TICKER
    //  (sim/market.js + sim/econstate.js). Runs at ~1 Hz, only swaps a material
    //  map on the boards that actually changed, so it costs nothing the rest of
    //  the time. City mode only.
    //
    //  Throttling: the wanted branch is gated on a signature (unchanged →
    //  skipped entirely, as before this wave). The ticker branch has no single
    //  signature to gate on (many boards, each tracking its own category pair),
    //  so it recomputes every ~1s tick — but adKey() dedupes per board: a
    //  ticker's canvas/material is only actually rebuilt (cache miss) when its
    //  displayed text changes, i.e. when a price's 2-decimal readout moves,
    //  which is the ">1%" cheap-repaint throttle the plan calls for.
    // =====================================================================
    if (CBZ.onAlways && dynAds.length && !city._propWantedHooked) {
      city._propWantedHooked = true;
      let acc = 0, lastSig = "";
      const tickerCache = new Map();   // "cat0|cat1" -> this tick's ad record (recomputed once per pair, not per board)
      CBZ.onAlways(8, function (dt) {
        const g = CBZ.game;
        if (!g || g.mode !== "city" || !root.visible) return;
        acc += (dt || 0.016);
        if (acc < 1.0) return; acc = 0;
        const sig = (g.wanted | 0) + ":" + (g.cityKills | 0) + ":" + (g.playerGang && g.playerGang.name || "");
        const sigChanged = sig !== lastSig;
        if (sigChanged) lastSig = sig;
        const wAd = sigChanged ? (wantedAd() || BRAND_ADS[0]) : null;
        const lit = (CBZ.nightAmount == null ? 0 : CBZ.nightAmount);
        tickerCache.clear();
        for (const e of dynAds) {
          if (e.mesh.userData.adLease) continue;    // the player RENTS this face (adboard.js) — their creative outranks any live driver
          let ad = null;
          if (e.dyn === "wanted") {
            if (!sigChanged) continue;              // nothing the poster cares about changed
            ad = wAd;
          } else if (e.dyn === "ticker") {
            const ck = (e.cats || []).join("|");
            ad = tickerCache.get(ck);
            if (!ad) { ad = tickerAd(e.cats || []) || BRAND_ADS[0]; tickerCache.set(ck, ad); }
          } else continue;
          const key = adKey(ad);
          if (key === e.lastKey) continue;          // this board already shows it
          e.lastKey = key;
          const mat2 = adMatFor(ad);
          e.mesh.material = mat2;                   // swap to the live material
          mat2.emissiveIntensity = 0.06 + lit * 0.6;
          if (nightAds.indexOf(mat2) < 0) nightAds.push(mat2);
        }
      });
    }

    // =====================================================================
    //  SMARTER STREET-LIGHT RENDERING, part 1: bake the pooled Fresnel
    //  glow-shell InstancedMeshes now that every lamp/signal spot for this
    //  build has been collected above. ONE InstancedMesh per colour (warm
    //  streetlamp + red/yellow/green signal) no matter how many hundreds of
    //  bulbs the city has — draw-call cost is FIXED, not per-bulb. Skips
    //  cleanly (buildGlowShellPool returns null) on a headless/minimal THREE
    //  stub that lacks ShaderMaterial, or when a city rebuild has zero spots.
    // =====================================================================
    const lampGlowIM = buildGlowShellPool(0xffe9a8, lampGlowSpots, 0.62);
    const sigRedIM = buildGlowShellPool(0xff3b3b, sigGlowSpots.red, 0.4);
    const sigYelIM = buildGlowShellPool(0xffcf3b, sigGlowSpots.yel, 0.4);
    const sigGrnIM = buildGlowShellPool(0x39ff66, sigGlowSpots.grn, 0.4);
    if (lampGlowIM) root.add(lampGlowIM);
    if (sigRedIM) root.add(sigRedIM);
    if (sigYelIM) root.add(sigYelIM);
    if (sigGrnIM) root.add(sigGrnIM);
    // the lamp glow-shell pool RIDES the same night ramp as headLampM (a
    // streetlamp shouldn't glow at high noon) — read its already-throttled
    // emissiveIntensity (the night driver above writes it) instead of
    // re-deriving CBZ.nightAmount a second time.
    if (CBZ.onAlways && lampGlowIM && !city._lampGlowNightHooked) {
      city._lampGlowNightHooked = true;
      CBZ.onAlways(7.1, function () {
        const g = CBZ.game;
        if (!g || g.mode !== "city" || !root.visible) return;
        const n = (headLampM.emissiveIntensity - 0.05) / 0.95;   // 0..1, same ramp headLampM rides
        lampGlowIM.visible = n > 0.02;
      });
    }
    // signal glow shells track whichever colour traffic.js actually lit —
    // read the SAME lamp materials traffic.js's axisSet/lampSet already
    // drive (emissiveIntensity 1.0 lit / 0.04 dark) rather than re-deriving
    // the phase clock here, so this never drifts from the real state machine
    // (traffic.js already IS the red/yellow/green timer this task asked for;
    // this only mirrors its output onto the Fresnel shells).
    if (CBZ.onAlways && (sigRedIM || sigYelIM || sigGrnIM) && !city._sigGlowHooked) {
      city._sigGlowHooked = true;
      let acc = 0;
      CBZ.onAlways(7.2, function (dt) {
        const g = CBZ.game;
        if (!g || g.mode !== "city" || !root.visible) return;
        acc += (dt || 0.016);
        if (acc < 0.15) return; acc = 0;   // a couple times a second is plenty — the phase itself only flips a few times per cycle
        for (let i = 0; i < lightCandidates.length; i++) {
          const c = lightCandidates[i];
          if (c.kind !== "signal" || !c.head || !c.spots) continue;
          const h = c.head, sp = c.spots;
          setGlowOn(sp.red, h.red && h.red.material && h.red.material.emissiveIntensity > 0.5);
          setGlowOn(sp.yel, h.yel && h.yel.material && h.yel.material.emissiveIntensity > 0.5);
          setGlowOn(sp.grn, h.grn && h.grn.material && h.grn.material.emissiveIntensity > 0.5);
        }
      });
    }

    // =====================================================================
    //  SMARTER STREET-LIGHT RENDERING, part 2: a SMALL FIXED POOL of real
    //  THREE.PointLights (shadows OFF), reparented each throttled tick to
    //  whichever `lightCandidates` (streetlamp bulbs + lit traffic signals)
    //  are currently nearest the camera. WHY a pool instead of "a light per
    //  bulb": hundreds of real lights would be a lighting-pass catastrophe
    //  (the exact "many lights in a city game" problem the three.js forum
    //  guidance warns about) — a bounded handful of real lights exist at
    //  any moment REGARDLESS of city size, and the Fresnel glow shells above
    //  sell every OTHER bulb's presence for free. The distance-sort itself is
    //  a flat scan over lightCandidates (a few hundred entries, cheap) run on
    //  a throttled interval (NOT per frame) — recomputing which handful is
    //  nearest a few times a second is imperceptible; recomputing every
    //  frame would just be wasted CPU for a light that hasn't moved.
    // =====================================================================
    const POOL_SIZE = 8;
    if (!city._lightPool && THREE.PointLight && CBZ.onAlways) {
      const pool = [];
      for (let i = 0; i < POOL_SIZE; i++) {
        const pl = new THREE.PointLight(0xffe0a0, 0, 16, 2);
        pl.castShadow = false;
        pl.visible = false;
        root.add(pl);
        pool.push({ light: pl, boundTo: null });
      }
      city._lightPool = pool;
    }
    if (CBZ.onAlways && city._lightPool && lightCandidates.length && !city._lightPoolHooked) {
      city._lightPoolHooked = true;
      let acc2 = 999;
      CBZ.onAlways(7.3, function (dt) {
        const g = CBZ.game;
        const pool = city._lightPool;
        if (!g || g.mode !== "city" || !root.visible) { for (const slot of pool) slot.light.visible = false; return; }
        acc2 += (dt || 0.016);
        if (acc2 < 0.4) return;    // throttled re-sort — a light doesn't need to jump lamps 60x/sec
        acc2 = 0;
        const cam = CBZ.camera && CBZ.camera.position;
        if (!cam) return;
        // cheap distance-sort: partial selection of the POOL_SIZE nearest
        // candidates (a full sort over a few hundred entries is trivial at
        // this cadence, but partial-select avoids even that).
        const n = lightCandidates.length, want = pool.length;
        const best = [];   // {d2, cand}
        for (let i = 0; i < n; i++) {
          const c = lightCandidates[i];
          // a broken streetlamp or a currently-dark signal phase shouldn't
          // steal a pool slot from something actually lit.
          if (c.kind === "lamp" && c.ref && c.ref.broken) continue;
          if (c.kind === "signal" && c.head) {
            const hh = c.head;
            const litOne = (hh.red && hh.red.material && hh.red.material.emissiveIntensity > 0.5) ||
                           (hh.yel && hh.yel.material && hh.yel.material.emissiveIntensity > 0.5) ||
                           (hh.grn && hh.grn.material && hh.grn.material.emissiveIntensity > 0.5);
            if (!litOne) continue;
          }
          const dx = c.x - cam.x, dz = c.z - cam.z;
          const d2 = dx * dx + dz * dz;
          if (d2 > 90 * 90) continue;               // further than this, a real light adds nothing visible worth the cost
          if (best.length < want) { best.push({ d2, c }); best.sort((p, q) => p.d2 - q.d2); }
          else if (d2 < best[want - 1].d2) { best[want - 1] = { d2, c }; best.sort((p, q) => p.d2 - q.d2); }
        }
        // streetlamp real-lights ride the SAME night ramp as their emissive
        // bulb material — a lamp pool light at full brightness at high noon
        // would look like a bug, not a feature. Traffic signals stay lit day
        // and night (real signals do too), so only the "lamp" kind is scaled.
        const nightK = Math.max(0, Math.min(1, (headLampM.emissiveIntensity - 0.05) / 0.95));
        for (let i = 0; i < pool.length; i++) {
          const slot = pool[i], pick = best[i];
          if (!pick) { slot.light.visible = false; slot.boundTo = null; continue; }
          slot.boundTo = pick.c;
          slot.light.position.set(pick.c.x, pick.c.y, pick.c.z);
          if (pick.c.kind === "signal") {
            slot.light.color.setHex(colorForHead(pick.c.head));
            slot.light.intensity = 0.55;
          } else {
            slot.light.color.setHex(0xffe0a0);
            slot.light.intensity = 0.85 * nightK;
          }
          slot.light.visible = slot.light.intensity > 0.01;
        }
      });
    }
    function colorForHead(h) {
      if (h.red && h.red.material && h.red.material.emissiveIntensity > 0.5) return 0xff3b3b;
      if (h.yel && h.yel.material && h.yel.material.emissiveIntensity > 0.5) return 0xffcf3b;
      if (h.grn && h.grn.material && h.grn.material.emissiveIntensity > 0.5) return 0x39ff66;
      return 0xffe0a0;
    }
  };
})();
