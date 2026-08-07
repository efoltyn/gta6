/* ============================================================
   core/microboot.js — THE ENGINE WITHOUT THE CITY.

   WHY THIS EXISTS. This repo has two ways to stand up a page today and
   both of them are wrong for a WORLD SLICE:

     • index.html boots the WHOLE game — 468 script tags, the prison, the
       city, the campaign. Correct for the game. Ruinous for a page that
       only wants a scene, a camera, a clock and the world builders.
     • games/dev.html fetches index.html and REPLAYS its script list, which
       is the same 468 scripts with an extra fetch in front.

   So every standalone page in games/ (racing, boxing, ocean, casino…) grew
   its own renderer, its own resize handler, its own key map, its own
   pointer-lock dance, its own frame loop, its own material cache, its own
   AABB slide, its own WebAudio bleeps. Five copies of the same 300 lines,
   drifting. That is the fork the doctrine forbids, and it happened because
   there was no SMALL door into the engine — only the big one.

   THIS IS THE SMALL DOOR. `CBZ.micro.boot()` stands up the minimum any
   3D page needs and publishes it under the SAME names the full engine
   uses (`CBZ.scene`, `CBZ.camera`, `CBZ.renderer`, `CBZ.clock`), so a
   module written against microboot runs UNCHANGED inside the full game —
   the full engine simply got there first and microboot yields to it.

   THE YIELD RULE (the whole contract, in one sentence): microboot never
   overwrites anything that already exists. Every export is
   `if (!CBZ.x) CBZ.x = …`. Load it under index.html and it is a no-op;
   load it alone and it IS the engine core. That is what makes a slice
   page and the shipped game run the same world code.

   WHAT IT OWNS (and nothing else — it is a floor, not a game):
     scene + fog + sky dome  ·  renderer w/ DPR clamp + resize
     camera + clock          ·  frame loop with dt clamp + hooks
     input (keys, mouse look, pointer lock, blur-safe)
     material/geometry caches (the world/materials.js contract, minus PBR)
     collider registry + circle-vs-AABB slide (the movement floor)
     procedural WebAudio SFX (no asset files, no CDN)
     an HTML overlay root for HUD

   SCENE AT LOAD, NOT AT BOOT: `world/materials.js` binds
   `const scene = CBZ.prisonRoot || CBZ.scene` at MODULE LOAD, so a page
   that wants the real material factory must have a scene before that
   script tag runs. Microboot therefore creates the scene at load time and
   boot() only attaches the renderer to it.

   Flags: MICRO_V1 (master), MICRO_SHADOWS, MICRO_DPR_MAX, MICRO_SFX.
   Audit: CBZ.microAudit().
============================================================ */
(function () {
  "use strict";
  const CBZ = (window.CBZ = window.CBZ || {});
  const THREE = window.THREE;
  if (!THREE) return;

  CBZ.CONFIG = CBZ.CONFIG || {};
  const C = CBZ.CONFIG;
  if (C.MICRO_V1 == null) C.MICRO_V1 = true;
  if (C.MICRO_SHADOWS == null) C.MICRO_SHADOWS = true;
  if (C.MICRO_DPR_MAX == null) C.MICRO_DPR_MAX = 1.75;
  if (C.MICRO_SFX == null) C.MICRO_SFX = true;
  if (C.MICRO_V1 === false) return;

  // ---------------------------------------------------------------- scene
  // Created at LOAD (see header): world/materials.js captures it on its own
  // load line. Yields to a scene the full engine already made.
  if (!CBZ.scene) CBZ.scene = new THREE.Scene();
  const scene = CBZ.scene;

  const micro = (CBZ.micro = CBZ.micro || {});
  micro.version = 1;
  micro.booted = false;

  // ------------------------------------------------------- helper fallbacks
  // The world/materials.js contract, minus the PBR twin machinery. Anything
  // built on these runs identically under the full engine, which defines the
  // richer versions first and therefore wins every one of these guards.
  const matCache = new Map(), geomCache = new Map();
  let helperOwn = 0;
  let bridgeDirty = false;      // an onAlways/onUpdate arrived; re-sort by order
  function ensureHelpers() {
    if (!CBZ.mat) {
      helperOwn++;
      CBZ.mat = function (color, opts) {
        opts = opts || {};
        return new THREE.MeshLambertMaterial({
          color: color,
          emissive: opts.emissive || 0x000000,
          emissiveIntensity: opts.ei != null ? opts.ei : 1,
        });
      };
    }
    if (!CBZ.cmat) {
      helperOwn++;
      CBZ.cmat = function (color, opts) {
        opts = opts || {};
        const em = opts.emissive || 0, ei = opts.ei != null ? opts.ei : 1;
        const k = color + "|" + em + "|" + ei;
        let m = matCache.get(k);
        if (!m) {
          m = new THREE.MeshLambertMaterial({ color: color, emissive: em, emissiveIntensity: ei });
          m._shared = true;
          matCache.set(k, m);
        }
        return m;
      };
    }
    if (!CBZ.boxGeom) {
      helperOwn++;
      CBZ.boxGeom = function (w, h, d) {
        const k = w + "," + h + "," + d;
        let g = geomCache.get(k);
        if (!g) { g = new THREE.BoxGeometry(w, h, d); g._shared = true; geomCache.set(k, g); }
        return g;
      };
    }
    // THE FRAME-HOOK BRIDGE. `config.js` owns `CBZ.onUpdate(order, fn)` and
    // `CBZ.onAlways(order, fn)` — the registry EVERY engine module uses to ask
    // for per-frame work, consumed by `core/loop.js`. A slice page loads
    // neither, so the first engine file that registered frame work
    // (world/materials.js's wet-road tick) threw at load and took its whole
    // module with it — the page silently fell back to microboot's own
    // material helpers and nobody could tell from the outside. That is the
    // exact failure this bridge exists to make impossible: the registry is
    // part of the small door, so a module written for the engine RUNS here.
    //   `always` = every frame, paused or not (the engine's contract).
    //   `updaters` = gameplay frames only.
    if (!CBZ.always) CBZ.always = [];
    if (!CBZ.updaters) CBZ.updaters = [];
    if (!CBZ.onAlways) {
      helperOwn++;
      CBZ.onAlways = function (order, fn) { CBZ.always.push({ order: order, fn: fn, source: "micro" }); bridgeDirty = true; };
    }
    if (!CBZ.onUpdate) {
      CBZ.onUpdate = function (order, fn) { CBZ.updaters.push({ order: order, fn: fn, source: "micro" }); bridgeDirty = true; };
    }
    // Engine modules routinely read `CBZ.game.state` and `CBZ.game.mode`
    // before doing work. A slice page has no state machine, so declare the
    // one the engine expects: LIVE, but explicitly NOT "city". That second
    // word is doing real work — city systems guard on `g.mode !== "city"`
    // and returning early is exactly what they should do here, so declaring
    // an honest mode turns dozens of would-be exceptions into clean no-ops
    // and lets a page load a city module purely for the assets inside it.
    if (!CBZ.game) CBZ.game = { state: "playing", mode: "slice", paused: false };

    // Seeded streams are DOCTRINE (core/seed.js). If seed.js was not loaded,
    // stand up the same mulberry32-by-name contract so world builders stay
    // deterministic on a slice page too.
    if (!CBZ.seedStream) {
      helperOwn++;
      CBZ.WORLD_SEED = CBZ.WORLD_SEED != null ? CBZ.WORLD_SEED : 90210;
      CBZ.seedStream = function (name) {
        let h = 2166136261 >>> 0;
        const s = String(name);
        for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
        let a = (h ^ (CBZ.WORLD_SEED >>> 0)) >>> 0;
        return function () {
          a = (a + 0x6d2b79f5) >>> 0;
          let t = a;
          t = Math.imul(t ^ (t >>> 15), t | 1);
          t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
          return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
      };
    }
  }
  micro.ensureHelpers = ensureHelpers;
  ensureHelpers();

  // --------------------------------------------------------------- the sky
  // A gradient dome + matching fog. One shader, no texture, no asset. The
  // caller passes two colours and a horizon bias; everything else (fog
  // colour, hemisphere light tint) is derived so a page cannot desync its
  // sky from its haze — the single most common look bug in the games/ pages.
  micro.sky = function (opts) {
    opts = opts || {};
    const top = new THREE.Color(opts.top != null ? opts.top : 0x2f6ea8);
    const bot = new THREE.Color(opts.bottom != null ? opts.bottom : 0xd9c39a);
    const off = opts.offset != null ? opts.offset : 120;
    const exp = opts.exponent != null ? opts.exponent : 0.7;
    const R = opts.radius != null ? opts.radius : 9000;

    const geo = new THREE.SphereGeometry(R, 24, 16);
    const matl = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        topColor: { value: top }, bottomColor: { value: bot },
        offset: { value: off }, exponent: { value: exp },
      },
      vertexShader:
        "varying vec3 vW;void main(){vec4 w=modelMatrix*vec4(position,1.0);vW=w.xyz;" +
        "gl_Position=projectionMatrix*viewMatrix*w;}",
      fragmentShader:
        "uniform vec3 topColor;uniform vec3 bottomColor;uniform float offset;uniform float exponent;" +
        "varying vec3 vW;void main(){float h=normalize(vW+vec3(0.0,offset,0.0)).y;" +
        "gl_FragColor=vec4(mix(bottomColor,topColor,pow(max(h,0.0),exponent)),1.0);}",
    });
    const dome = new THREE.Mesh(geo, matl);
    dome.frustumCulled = false;
    dome.renderOrder = -1000;
    dome.name = "microSky";
    scene.add(dome);

    // fog colour = the sky at the horizon, always. Derived, never re-typed.
    const hazeC = bot.clone().lerp(top, 0.18);
    if (opts.fog !== false) {
      scene.fog = new THREE.Fog(hazeC.getHex(),
        opts.fogNear != null ? opts.fogNear : 900,
        opts.fogFar != null ? opts.fogFar : 6200);
    }
    scene.background = hazeC.clone();
    micro.skyDome = dome;
    micro.hazeColor = hazeC;
    return dome;
  };

  // ------------------------------------------------------------- the lights
  micro.lights = function (opts) {
    opts = opts || {};
    const hemi = new THREE.HemisphereLight(
      opts.skyColor != null ? opts.skyColor : 0xbcd7f0,
      opts.groundColor != null ? opts.groundColor : 0x8a7550,
      opts.hemi != null ? opts.hemi : 0.62);
    hemi.position.set(0, 800, 0);
    scene.add(hemi);

    const sun = new THREE.DirectionalLight(
      opts.sunColor != null ? opts.sunColor : 0xfff2d6,
      opts.sun != null ? opts.sun : 1.05);
    const d = opts.sunDist != null ? opts.sunDist : 900;
    sun.position.set(d * 0.55, d, d * 0.35);
    if (C.MICRO_SHADOWS && opts.shadows !== false) {
      sun.castShadow = true;
      const S = opts.shadowSpan != null ? opts.shadowSpan : 620;
      sun.shadow.mapSize.width = sun.shadow.mapSize.height = opts.shadowMap || 2048;
      sun.shadow.camera.left = -S; sun.shadow.camera.right = S;
      sun.shadow.camera.top = S; sun.shadow.camera.bottom = -S;
      sun.shadow.camera.near = 10; sun.shadow.camera.far = d * 2.6;
      sun.shadow.bias = -0.0009;
    }
    scene.add(sun);
    scene.add(sun.target);
    micro.sun = sun;
    micro.hemiLight = hemi;
    // A shadow map that spans 600 u cannot also span a 12 km world; the sun
    // rig FOLLOWS the camera so the shadowed box is always where the player
    // is. One line here saves every page from the "shadows vanish when I walk"
    // report.
    micro.onFrame(function () {
      const cam = CBZ.camera;
      if (!cam || !sun.castShadow) return;
      sun.position.set(cam.position.x + d * 0.55, d, cam.position.z + d * 0.35);
      sun.target.position.set(cam.position.x, 0, cam.position.z);
      sun.target.updateMatrixWorld();
    }, { order: -100 });
    return sun;
  };

  // --------------------------------------------------------------- the loop
  const frameHooks = [];
  micro.onFrame = function (fn, opts) {
    opts = opts || {};
    frameHooks.push({ fn: fn, order: opts.order || 0, id: opts.id || "" });
    frameHooks.sort(function (a, b) { return a.order - b.order; });
    return fn;
  };
  micro.offFrame = function (fn) {
    for (let i = frameHooks.length - 1; i >= 0; i--) if (frameHooks[i].fn === fn) frameHooks.splice(i, 1);
  };

  micro.paused = false;
  micro.pauseKey = "KeyP";
  let _wasPaused = false;
  micro.autoRender = true;      // false → the page owns its own render calls
  micro.elapsed = 0;
  micro.frames = 0;
  micro.fps = 0;
  let _fpsAcc = 0, _fpsN = 0, _last = 0, _raf = 0;

  // A BRIDGED HOOK THAT CANNOT RUN HERE GETS RETIRED, NOT RE-THROWN.
  // Loading a city module for the assets inside it also brings its per-frame
  // work along, and some of that work genuinely cannot run without the city.
  // Left alone it throws sixty times a second: the console fills, the profile
  // is meaningless, and a real error further down is impossible to see. Three
  // strikes and the hook is dropped, with ONE line saying which and why —
  // which is also the honest signal that the module needs a better seam.
  micro.retired = [];

  /* ---- CAMERA SHAKE, PUBLISHED UNDER THE NAME THE ENGINE ALREADY CALLS ----
     `CBZ.shake(m)` is owned by systems/camera.js in the full engine, and
     city/crashfx.js calls it on EVERY detonation — guarded, so outside the
     full engine those calls have simply been landing on undefined. Which is
     why a slice page's explosions were silent and still: the blast was asking
     for the kick and nothing was there to answer.

     The shape is camera.js's: a scalar somebody raises, which decays. The
     decay is frame-rate independent and the offset is undone straight after
     the draw, so this composes with any camera a page writes, including
     studio.chase's smoothing. Yields if camera.js got here first. */
  let _shake = 0, _shookX = 0, _shookY = 0, _shookZ = 0;
  if (!CBZ.shake) CBZ.shake = function (m) { _shake = Math.max(_shake, Math.min(3.5, m || 0)); };
  micro.shake = function (m) { if (CBZ.shake) CBZ.shake(m); };
  micro.shakeAmount = function () { return _shake; };
  function _shakeDecay(dt) { if (_shake > 0) _shake = Math.max(0, _shake - dt * (2.2 + _shake * 1.6)); }
  function _shakeApply() {
    if (!(_shake > 0.001) || !CBZ.camera) return false;
    // three uncorrelated sinusoids rather than random noise: a random jitter
    // reads as a broken frame, a beat reads as a shockwave passing through.
    const t = micro.elapsed * 46;
    const a = _shake * 0.5;
    _shookX = Math.sin(t * 1.00) * a;
    _shookY = Math.sin(t * 1.37 + 1.1) * a * 0.8;
    _shookZ = Math.sin(t * 0.83 + 2.3) * a * 0.6;
    CBZ.camera.position.x += _shookX;
    CBZ.camera.position.y += _shookY;
    CBZ.camera.position.z += _shookZ;
    return true;
  }
  function _shakeUndo() {
    CBZ.camera.position.x -= _shookX;
    CBZ.camera.position.y -= _shookY;
    CBZ.camera.position.z -= _shookZ;
  }

  function runBridged(entry, dt, band) {
    if (entry.dead) return;
    try { entry.fn(dt); entry.fails = 0; }
    catch (e) {
      entry.fails = (entry.fails || 0) + 1;
      if (entry.fails >= 3) {
        entry.dead = true;
        micro.retired.push({ band: band, order: entry.order, source: entry.source || "", error: String(e && e.message || e) });
        console.warn("[micro] retired a " + band + " hook (order " + entry.order + ") — it needs the full engine:", e);
      }
    }
  }

  function tick(now) {
    _raf = requestAnimationFrame(tick);
    if (!_last) _last = now;
    // dt clamp: a tab that was backgrounded for 40 s must not teleport every
    // projectile in the world through a building on the first frame back.
    let dt = (now - _last) / 1000;
    _last = now;
    if (!(dt > 0)) dt = 0;
    if (dt > 0.1) dt = 0.1;
    micro.frames++;
    _shakeDecay(dt);
    _fpsAcc += dt; _fpsN++;
    if (_fpsAcc >= 0.5) { micro.fps = Math.round(_fpsN / _fpsAcc); _fpsAcc = 0; _fpsN = 0; }
    // the engine's own registry first, in ITS declared order (see the bridge
    // in ensureHelpers): `always` runs even while paused, by contract.
    if (bridgeDirty) {
      bridgeDirty = false;
      CBZ.always.sort(function (a, b) { return a.order - b.order; });
      CBZ.updaters.sort(function (a, b) { return a.order - b.order; });
    }
    for (let i = 0; i < CBZ.always.length; i++) runBridged(CBZ.always[i], dt, "always");
    /* THE PAUSE KEY IS OWNED HERE, ABOVE THE GATE, and that is the whole point.
       A page that toggles micro.paused from inside its own onFrame hook can
       pause once and never unpause: the hooks are exactly what the gate below
       stops running. Every page hits this the same way, so it is not a page's
       problem to solve. Set micro.pauseKey = null to own it yourself. */
    if (micro.pauseKey && input.down[micro.pauseKey]) micro.paused = !micro.paused;
    // A PAUSED PAGE CANNOT DRAW ITS OWN "PAUSED", because the frame hooks are
    // precisely what stopped. So the state goes on the document, where CSS can
    // still see it, and studio's HUD reads the mark.
    if (micro.paused !== _wasPaused) {
      _wasPaused = micro.paused;
      try { document.body.classList.toggle("micro-paused", !!micro.paused); } catch (e) {}
    }
    if (!micro.paused) {
      micro.elapsed += dt;
      for (let i = 0; i < CBZ.updaters.length; i++) runBridged(CBZ.updaters[i], dt, "update");
      for (let i = 0; i < frameHooks.length; i++) {
        try { frameHooks[i].fn(dt, micro.elapsed); }
        catch (e) { console.error("[micro frame " + (frameHooks[i].id || i) + "]", e); }
      }
    }
    // A page that draws its OWN views (a multi-viewport gallery, a split
    // screen, a render-to-texture pass) must be able to stop the default
    // one. Without this switch its only lever is nulling CBZ.camera, and
    // meanwhile the default render keeps firing into whatever viewport and
    // scissor rect the page last set — silently painting over every region
    // it just drew, one per frame, until the whole page is blank.
    if (micro.autoRender && CBZ.renderer && CBZ.camera) {
      // SHAKE IS APPLIED HERE AND UNDONE IMMEDIATELY, so a page's own camera
      // maths never has to know it happened — a page that reads camera.position
      // next frame gets the number it set, not the number that was drawn.
      const sh = _shakeApply();
      try { CBZ.renderer.render(scene, CBZ.camera); } catch (e) { console.error("[micro render]", e); }
      if (sh) _shakeUndo();
    }
    input.endFrame();
  }

  micro.start = function () { if (!_raf) { _last = 0; _raf = requestAnimationFrame(tick); } };
  micro.stop = function () { if (_raf) { cancelAnimationFrame(_raf); _raf = 0; } };

  // -------------------------------------------------------------- the input
  // One key map, one mouse delta, one pointer lock, blur-safe. The rule the
  // games/ copies all got wrong at least once: a page that loses focus mid
  // key-hold must not keep walking, so blur CLEARS the map.
  const input = (micro.input = {
    keys: Object.create(null),
    down: Object.create(null),   // edge: true for exactly one frame
    up: Object.create(null),
    mx: 0, mz: 0,                // accumulated mouse delta this frame
    wheel: 0,
    buttons: [false, false, false],
    clicked: [false, false, false],
    locked: false,
    enabled: true,
    sensitivity: 0.0022,
  });
  input.isDown = function (code) { return !!input.keys[code]; };
  input.pressed = function (code) { return !!input.down[code]; };
  input.released = function (code) { return !!input.up[code]; };
  input.axis = function (neg, pos) { return (input.keys[pos] ? 1 : 0) - (input.keys[neg] ? 1 : 0); };
  input.clear = function () {
    for (const k in input.keys) input.keys[k] = false;
    input.buttons[0] = input.buttons[1] = input.buttons[2] = false;
    input.mx = input.mz = 0;
  };
  input.endFrame = function () {
    for (const k in input.down) input.down[k] = false;
    for (const k in input.up) input.up[k] = false;
    input.mx = 0; input.mz = 0; input.wheel = 0;
    input.clicked[0] = input.clicked[1] = input.clicked[2] = false;
    if (micro.touch) micro.touch.stickTap = false;   // the L3 gesture is one frame
  };

  function bindInput(el) {
    window.addEventListener("keydown", function (e) {
      if (!input.enabled) return;
      if (!input.keys[e.code]) input.down[e.code] = true;
      input.keys[e.code] = true;
      // the browser's own bindings that fight a game: space scrolls, / opens
      // quick-find, arrows scroll. Swallow them, never the modifier combos.
      if (!e.ctrlKey && !e.metaKey && !e.altKey &&
        /^(Space|Arrow|Tab|Slash|F1$)/.test(e.code)) e.preventDefault();
    });
    window.addEventListener("keyup", function (e) {
      if (input.keys[e.code]) input.up[e.code] = true;
      input.keys[e.code] = false;
    });
    window.addEventListener("blur", input.clear);
    document.addEventListener("visibilitychange", function () { if (document.hidden) input.clear(); });

    el.addEventListener("mousedown", function (e) {
      if (!input.enabled) return;
      input.buttons[e.button] = true; input.clicked[e.button] = true;
    });
    window.addEventListener("mouseup", function (e) { input.buttons[e.button] = false; });
    el.addEventListener("contextmenu", function (e) { e.preventDefault(); });
    window.addEventListener("wheel", function (e) { input.wheel += e.deltaY; }, { passive: true });
    // DRAG-LOOK IS NOT A DOWNGRADE, IT IS THE FALLBACK THAT KEEPS THE PAGE
    // PLAYABLE. Pointer lock is refused in plenty of real places a slice page
    // ends up — an iframe without allow="pointer-lock", a browser that wants
    // a fresh gesture, a user who pressed Escape. Without a fallback the
    // camera simply stops answering and the page looks broken. Holding the
    // left button and dragging feeds the SAME mx/mz, so nothing downstream
    // knows which one is driving.
    document.addEventListener("mousemove", function (e) {
      if (!input.enabled) return;
      if (!input.locked && !input.buttons[0]) return;
      input.mx += e.movementX || 0;
      input.mz += e.movementY || 0;
    });
    document.addEventListener("pointerlockchange", function () {
      input.locked = document.pointerLockElement === el;
      if (!input.locked) { input.clear(); if (micro.onUnlock) micro.onUnlock(); }
    });
    micro.lock = function () { try { el.requestPointerLock(); } catch (e) {} };
    micro.unlock = function () { try { document.exitPointerLock(); } catch (e) {} };
  }

  // ------------------------------------------------------------- the thumbs
  // THE STANDALONE COUNTERPART TO systems/touch.js. That file is the real
  // touch layer and it is not portable — it reaches into cityCars, fpsFire,
  // interactions, grapple, the camera rig and the ped grid, so it cannot
  // stand up without the whole game under it. What IS portable is its
  // GRAMMAR, and that grammar is the part that took a year of thumbs to
  // learn, so this layer implements it verbatim rather than inventing a
  // second vocabulary that would then have to be un-learned:
  //
  //   • LEFT thumb = a FIXED stick, bottom-left, faint until touched. A move
  //     must BEGIN inside its catch zone, so taps on HUD or world elsewhere
  //     on the left never get mistaken for walking.
  //   • GAIT LIVES IN THE STICK. Sprint is not a button — ram the stick to
  //     its rim and you sprint, ease back and you don't. With hysteresis, so
  //     the gait cannot flap at the boundary.
  //   • RIGHT half drag = look. It feeds the SAME mx/mz the mouse feeds, so
  //     nothing downstream knows or cares which one moved the camera.
  //   • A HOLD OWNS THE THUMB IT IS UNDER, and the right thumb is the only
  //     one that can reach the trigger. So anything that wants to be held
  //     at the same time as the trigger is a LATCH, and anything that must
  //     be continuously set is a SLIDER — never a second hold.
  //   • Movement/combat controls are ICONS. Interaction verbs are WORDS.
  //
  // Buttons synthesise the SAME key codes the desktop build reads, so a page
  // wires its controls once and both input methods arrive at one handler.
  const touch = (micro.touch = {
    active: false,
    stick: { x: 0, y: 0, mag: 0, rim: false, held: false },
    lookScale: 1.5,
    buttons: [],
    root: null,
  });

  function isTouchDevice() {
    try {
      return (window.matchMedia && window.matchMedia("(pointer: coarse)").matches) ||
        ("ontouchstart" in window) || (navigator.maxTouchPoints || 0) > 0;
    } catch (e) { return false; }
  }

  // synthesise a key so a page's ONE handler serves both input methods
  function synth(code, down) {
    if (!code) return;
    if (down) { if (!input.keys[code]) input.down[code] = true; input.keys[code] = true; }
    else { if (input.keys[code]) input.up[code] = true; input.keys[code] = false; }
  }
  touch.synth = synth;

  touch.init = function (opts) {
    opts = opts || {};
    if (touch.root) return touch;
    touch.active = opts.force != null ? !!opts.force : isTouchDevice();
    if (!touch.active) return touch;
    document.body.classList.add("micro-touch");

    const root = document.createElement("div");
    root.id = "microTouch";
    root.style.cssText = "position:fixed;inset:0;z-index:8;pointer-events:none;touch-action:none;" +
      "-webkit-user-select:none;user-select:none;";
    document.body.appendChild(root);
    touch.root = root;

    const style = document.createElement("style");
    style.textContent =
      ".mt-stick{position:absolute;border-radius:50%;border:2px solid rgba(255,255,255,.20);" +
        "background:rgba(255,255,255,.05);pointer-events:none;transition:opacity .18s;opacity:.35}" +
      ".mt-stick.on{opacity:.85}" +
      ".mt-nub{position:absolute;border-radius:50%;background:rgba(255,255,255,.30);" +
        "border:2px solid rgba(255,255,255,.45);pointer-events:none}" +
      ".mt-stick.rim{border-color:rgba(255,196,90,.95)}" +
      ".mt-btn{position:absolute;pointer-events:auto;display:flex;align-items:center;" +
        "justify-content:center;border-radius:50%;background:rgba(12,16,20,.5);" +
        "border:2px solid rgba(255,255,255,.24);color:#fff;font:700 22px 'Trebuchet MS',sans-serif;" +
        "backdrop-filter:blur(2px);touch-action:none;-webkit-tap-highlight-color:transparent}" +
      ".mt-btn.word{border-radius:12px;font-size:14px;letter-spacing:2px;padding:0 14px;width:auto!important}" +
      ".mt-btn.on{background:rgba(255,150,60,.55);border-color:#ffc46a}" +
      ".mt-btn.press{transform:scale(.92);background:rgba(255,255,255,.22)}" +
      ".mt-slider{position:absolute;pointer-events:auto;border-radius:16px;" +
        "background:rgba(12,16,20,.5);border:2px solid rgba(255,255,255,.22);overflow:hidden;touch-action:none}" +
      ".mt-slider>i{position:absolute;left:0;right:0;bottom:0;background:linear-gradient(180deg,#7fb6ff,#3f78d8);display:block}" +
      ".mt-slider>b{position:absolute;left:0;right:0;top:6px;text-align:center;font:700 10px sans-serif;" +
        "letter-spacing:2px;color:rgba(255,255,255,.75)}";
    document.head.appendChild(style);

    // ---- the fixed left stick
    const R = Math.round(Math.min(96, Math.max(64, window.innerWidth * 0.12)));
    const base = document.createElement("div");
    base.className = "mt-stick";
    base.style.cssText += "width:" + R * 2 + "px;height:" + R * 2 + "px;left:22px;bottom:24px;";
    const nub = document.createElement("div");
    nub.className = "mt-nub";
    nub.style.cssText += "width:" + R * 0.78 + "px;height:" + R * 0.78 + "px;";
    base.appendChild(nub);
    root.appendChild(base);
    touch.stickEl = base;
    touch.nubEl = nub;
    function nubTo(dx, dy) {
      nub.style.left = (R - R * 0.39 + dx) + "px";
      nub.style.top = (R - R * 0.39 + dy) + "px";
    }
    nubTo(0, 0);

    // ---- pointer routing. Each pointer belongs to exactly one role for its
    //      whole life: the stick, the look drag, or a widget. A pointer never
    //      changes role mid-gesture, which is what stops a thumb that slides
    //      off the stick from suddenly spinning the camera.
    const pointers = new Map();
    function stickCentre() {
      const r = base.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, r: r.width / 2 };
    }

    root.addEventListener("pointerdown", function (e) {
      // widgets set their own handlers and stopPropagation
      const c = stickCentre();
      const inStick = Math.hypot(e.clientX - c.x, e.clientY - c.y) < c.r * 1.55;
      pointers.set(e.pointerId, {
        role: inStick ? "stick" : "look",
        x: e.clientX, y: e.clientY, t: performance.now(),
        sx: e.clientX, sy: e.clientY,
      });
      if (inStick) { base.classList.add("on"); touch.stick.held = true; }
      e.preventDefault();
    }, { passive: false });
    // the layer itself must catch touches that are not on a widget
    root.style.pointerEvents = "auto";

    root.addEventListener("pointermove", function (e) {
      const p = pointers.get(e.pointerId);
      if (!p) return;
      if (p.role === "stick") {
        const c = stickCentre();
        let dx = e.clientX - c.x, dy = e.clientY - c.y;
        const d = Math.hypot(dx, dy);
        const lim = c.r;
        if (d > lim) { dx *= lim / d; dy *= lim / d; }
        nubTo(dx, dy);
        touch.stick.x = dx / lim;
        touch.stick.y = dy / lim;
        touch.stick.mag = Math.min(1, d / lim);
        // GAIT LIVES IN THE STICK — rim deflection sprints, with hysteresis
        if (!touch.stick.rim && touch.stick.mag > 0.92) touch.stick.rim = true;
        else if (touch.stick.rim && touch.stick.mag < 0.78) touch.stick.rim = false;
        base.classList.toggle("rim", touch.stick.rim);
      } else if (p.role === "look" && input.enabled) {
        input.mx += (e.clientX - p.x) * touch.lookScale;
        input.mz += (e.clientY - p.y) * touch.lookScale;
      }
      p.x = e.clientX; p.y = e.clientY;
      e.preventDefault();
    }, { passive: false });

    function endPointer(e) {
      const p = pointers.get(e.pointerId);
      if (!p) return;
      if (p.role === "stick") {
        touch.stick.x = touch.stick.y = touch.stick.mag = 0;
        touch.stick.rim = false;
        touch.stick.held = false;
        nubTo(0, 0);
        base.classList.remove("on", "rim");
        // a quick PRESS on the base (no drag) is the console L3 gesture
        if (performance.now() - p.t < 260 && Math.hypot(p.x - p.sx, p.y - p.sy) < 14) {
          touch.stickTap = true;
        }
      }
      pointers.delete(e.pointerId);
    }
    root.addEventListener("pointerup", endPointer);
    root.addEventListener("pointercancel", endPointer);
    root.addEventListener("lostpointercapture", endPointer);

    // on a phone there is no pointer lock and nothing should ask for one
    micro.lock = function () {};
    micro.unlock = function () {};
    input.locked = true;
    return touch;
  };

  // addButton({glyph, word, key, latch, right, bottom, size, id})
  // `key` is the desktop code this button stands in for — the page keeps ONE
  // handler. `word:true` renders a verb pill (interaction), otherwise an icon.
  touch.addButton = function (o) {
    if (!touch.root) return { set: function () {}, el: null, lit: false };
    o = o || {};
    const b = document.createElement("div");
    b.className = "mt-btn" + (o.word ? " word" : "");
    const S = o.size || 64;
    b.style.width = S + "px";
    b.style.height = S + "px";
    b.style.right = (o.right != null ? o.right : 24) + "px";
    b.style.bottom = (o.bottom != null ? o.bottom : 24) + "px";
    if (o.left != null) { b.style.left = o.left + "px"; b.style.right = "auto"; }
    // TOP ANCHORING, because a layer that can only hang off the bottom edge
    // forces every page to put system controls (pause, mute, camera) in the
    // thumb zone with the game verbs, where they get hit by accident.
    if (o.top != null) { b.style.top = o.top + "px"; b.style.bottom = "auto"; }
    b.textContent = o.glyph || o.label || "";
    touch.root.appendChild(b);

    const h = { el: b, lit: false, key: o.key, latch: !!o.latch, id: o.id || "" };
    h.set = function (visible, lit, label) {
      b.style.display = visible === false ? "none" : "flex";
      if (lit != null) { h.lit = !!lit; b.classList.toggle("on", !!lit); }
      if (label != null) b.textContent = label;
    };
    function down(e) {
      e.stopPropagation(); e.preventDefault();
      b.classList.add("press");
      if (h.latch) {
        h.lit = !h.lit;
        b.classList.toggle("on", h.lit);
        synth(h.key, true);
        setTimeout(function () { synth(h.key, false); }, 30);   // a latch is one press
      } else synth(h.key, true);
      if (o.onDown) o.onDown(h);
    }
    function up(e) {
      e.stopPropagation();
      b.classList.remove("press");
      if (!h.latch) synth(h.key, false);
      if (o.onUp) o.onUp(h);
    }
    b.addEventListener("pointerdown", down);
    b.addEventListener("pointerup", up);
    b.addEventListener("pointercancel", up);
    b.addEventListener("pointerleave", function (e) { if (!h.latch) up(e); });
    touch.buttons.push(h);
    return h;
  };

  // A control that must be CONTINUOUSLY SET but cannot be a second hold (see
  // the grammar): drag it, let go, it stays where you put it.
  touch.addSlider = function (o) {
    if (!touch.root) return { value: 0, set: function () {} };
    o = o || {};
    const el = document.createElement("div");
    el.className = "mt-slider";
    const W = o.width || 46, H = o.height || 190;
    el.style.cssText += "width:" + W + "px;height:" + H + "px;right:" +
      (o.right != null ? o.right : 24) + "px;bottom:" + (o.bottom != null ? o.bottom : 108) + "px;";
    const fill = document.createElement("i");
    const cap = document.createElement("b");
    cap.textContent = o.label || "";
    el.appendChild(fill); el.appendChild(cap);
    touch.root.appendChild(el);
    const h = { el: el, value: o.value != null ? o.value : 0 };
    function paint() { fill.style.height = Math.round(h.value * 100) + "%"; }
    h.set = function (v) { h.value = Math.max(0, Math.min(1, v)); paint(); };
    h.show = function (on) { el.style.display = on === false ? "none" : "block"; };
    h.set(h.value);
    function grab(e) {
      e.stopPropagation(); e.preventDefault();
      const r = el.getBoundingClientRect();
      h.set(1 - (e.clientY - r.top) / r.height);
      if (o.onChange) o.onChange(h.value);
    }
    el.addEventListener("pointerdown", function (e) { el.setPointerCapture(e.pointerId); grab(e); });
    el.addEventListener("pointermove", function (e) { if (el.hasPointerCapture && el.hasPointerCapture(e.pointerId)) grab(e); });
    el.addEventListener("pointerup", function (e) { e.stopPropagation(); });
    return h;
  };

  // ---------------------------------------------------------- the colliders
  // The movement floor every games/ page re-typed: axis-aligned boxes and a
  // circle that SLIDES along them instead of stopping dead. Boxes live in a
  // uniform hash grid so a 12 km world with 3000 colliders still resolves in
  // constant time.
  const CELL = 48;
  const grid = new Map();
  const boxes = [];
  function cellKey(cx, cz) { return cx * 73856093 ^ cz * 19349663; }
  function gridAdd(b, i) {
    const x0 = Math.floor(b.minX / CELL), x1 = Math.floor(b.maxX / CELL);
    const z0 = Math.floor(b.minZ / CELL), z1 = Math.floor(b.maxZ / CELL);
    for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) {
      const k = cellKey(cx, cz);
      let a = grid.get(k);
      if (!a) { a = []; grid.set(k, a); }
      a.push(i);
    }
  }
  // addCollider({minX,maxX,minZ,maxZ, y0?, y1?, ref?, tag?})
  // y0/y1 make it a HEIGHT-GATED box (a wall you can fly over, a rail you can
  // vault); omit them and it is full height, which is what a building is.
  micro.addCollider = function (b) {
    if (!b) return null;
    if (b.minX > b.maxX) { const t = b.minX; b.minX = b.maxX; b.maxX = t; }
    if (b.minZ > b.maxZ) { const t = b.minZ; b.minZ = b.maxZ; b.maxZ = t; }
    boxes.push(b);
    gridAdd(b, boxes.length - 1);
    return b;
  };
  micro.addBoxCollider = function (x, y, z, w, h, d, extra) {
    const b = { minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, y0: y - h / 2, y1: y + h / 2 };
    if (extra) for (const k in extra) b[k] = extra[k];
    return micro.addCollider(b);
  };
  micro.colliders = boxes;

  /* PUBLISHED UNDER THE NAME THE ENGINE ALREADY READS (2026-08-07).
     `CBZ.colliders` is Gang City's world-geometry registry — 40+ files write
     it and the shared verbs READ it: physics.js's vault probe, fracture.js's
     carveHole, crashfx.js's wall ruin and airstrike collapse, the camera's
     occlusion test. Its element is exactly the box this file already builds,
     field for field: {minX,maxX,minZ,maxZ, y0?, y1?, ref?}. Nothing needed
     converting; the two registries were the same registry under two names.

     THE FAULT. Microboot kept its boxes at `micro.colliders` and nowhere
     else, so a one-shot page stood up a world with two hundred towers in it
     and every shared verb in the engine looked at `CBZ.colliders`, found
     undefined, and did nothing. The owner filmed the result: "you can't hit
     buildings". The buildings were never invulnerable. They were INVISIBLE
     to the only code that knew how to hurt them.

     SAME ARRAY, not a copy — a copy would go stale the moment a game
     registered another box, and staleness here reads as "the collapse missed
     a building that is plainly there". Yields per this file's own rule: the
     full engine defines CBZ.colliders long before microboot would run, and a
     slice page that already made one keeps it, so adoption cannot clobber. */
  if (!CBZ.colliders) CBZ.colliders = boxes;

  micro.clearColliders = function () { boxes.length = 0; grid.clear(); };

  micro.queryColliders = function (x, z, r, out) {
    out = out || [];
    out.length = 0;
    const x0 = Math.floor((x - r) / CELL), x1 = Math.floor((x + r) / CELL);
    const z0 = Math.floor((z - r) / CELL), z1 = Math.floor((z + r) / CELL);
    const seen = micro._qseen || (micro._qseen = new Set());
    seen.clear();
    for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) {
      const a = grid.get(cellKey(cx, cz));
      if (!a) continue;
      for (let i = 0; i < a.length; i++) {
        const idx = a[i];
        if (seen.has(idx)) continue;
        seen.add(idx);
        out.push(boxes[idx]);
      }
    }
    return out;
  };

  // Slide a circle of radius `r` at height span [y, y+height] out of every
  // box it overlaps. Pushes along the SHALLOWEST axis, which is what makes a
  // wall slide instead of a wall stop.
  const _qbuf = [];
  micro.resolveCircle = function (pos, r, y, height) {
    const list = micro.queryColliders(pos.x, pos.z, r + 4, _qbuf);
    let hit = false;
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      if (b.y0 != null && b.y1 != null) {
        if (y + (height || 0) < b.y0 || y > b.y1) continue;   // passes over/under
      }
      const cx = Math.max(b.minX, Math.min(pos.x, b.maxX));
      const cz = Math.max(b.minZ, Math.min(pos.z, b.maxZ));
      const dx = pos.x - cx, dz = pos.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 > r * r) continue;
      hit = true;
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2);
        pos.x = cx + (dx / d) * r;
        pos.z = cz + (dz / d) * r;
      } else {
        // dead centre inside the box: leave by the nearest face
        const pxL = pos.x - b.minX, pxR = b.maxX - pos.x;
        const pzL = pos.z - b.minZ, pzR = b.maxZ - pos.z;
        const m = Math.min(pxL, pxR, pzL, pzR);
        if (m === pxL) pos.x = b.minX - r;
        else if (m === pxR) pos.x = b.maxX + r;
        else if (m === pzL) pos.z = b.minZ - r;
        else pos.z = b.maxZ + r;
      }
    }
    return hit;
  };

  // Does a straight line from a to b clear every collider? The one honest
  // answer to "can the blast see me" and "can that shot land" — used by
  // systems/ordnance.js for cover attenuation.
  // EXACT, not sampled. Point-sampling a segment misses any slab thinner
  // than the step, and the thin slabs are precisely the ones that matter —
  // a 1.3 m shelter roof under a bomb is the whole cover rule, and a sampler
  // walking 2 m at a time steps over it two times in three. Worse, it fails
  // SILENTLY and at random, so cover appears to "sometimes work". This is
  // the standard three-slab ray/AABB test against every box the segment's
  // cells contain: no step size, no misses.
  const _segSeen = new Set();
  const _segList = [];
  micro.segmentBlocked = function (ax, ay, az, bx, by, bz) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    if (Math.hypot(dx, dy, dz) < 0.001) return false;

    _segSeen.clear();
    _segList.length = 0;
    const n = Math.max(1, Math.ceil(Math.hypot(dx, dz) / (CELL * 0.5)));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const list = micro.queryColliders(ax + dx * t, az + dz * t, CELL * 0.75, _qbuf);
      for (let j = 0; j < list.length; j++) {
        const b = list[j];
        if (!_segSeen.has(b)) { _segSeen.add(b); _segList.push(b); }
      }
    }

    for (let i = 0; i < _segList.length; i++) {
      const b = _segList[i];
      if (b.noBlock) continue;
      const y0 = b.y0 != null ? b.y0 : -1e6, y1 = b.y1 != null ? b.y1 : 1e6;
      let t0 = 0, t1 = 1, ta, tb, s;
      if (Math.abs(dx) < 1e-9) { if (ax < b.minX || ax > b.maxX) continue; }
      else {
        ta = (b.minX - ax) / dx; tb = (b.maxX - ax) / dx;
        if (ta > tb) { s = ta; ta = tb; tb = s; }
        if (ta > t0) t0 = ta; if (tb < t1) t1 = tb;
        if (t0 > t1) continue;
      }
      if (Math.abs(dy) < 1e-9) { if (ay < y0 || ay > y1) continue; }
      else {
        ta = (y0 - ay) / dy; tb = (y1 - ay) / dy;
        if (ta > tb) { s = ta; ta = tb; tb = s; }
        if (ta > t0) t0 = ta; if (tb < t1) t1 = tb;
        if (t0 > t1) continue;
      }
      if (Math.abs(dz) < 1e-9) { if (az < b.minZ || az > b.maxZ) continue; }
      else {
        ta = (b.minZ - az) / dz; tb = (b.maxZ - az) / dz;
        if (ta > tb) { s = ta; ta = tb; tb = s; }
        if (ta > t0) t0 = ta; if (tb < t1) t1 = tb;
        if (t0 > t1) continue;
      }
      return true;
    }
    return false;
  };

  // ------------------------------------------------------------- the SFX
  // Procedurally synthesised, zero asset files, zero CDN. Every games/ page
  // wanted a thump, a click and a whoosh; now there is one of each.
  const sfx = (micro.sfx = { ctx: null, master: null, muted: false });
  function actx() {
    if (!C.MICRO_SFX) return null;
    if (!sfx.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      sfx.ctx = new AC();
      sfx.master = sfx.ctx.createGain();
      sfx.master.gain.value = 0.5;
      sfx.master.connect(sfx.ctx.destination);
    }
    if (sfx.ctx.state === "suspended") { try { sfx.ctx.resume(); } catch (e) {} }
    return sfx.ctx;
  }
  sfx.resume = actx;
  sfx.setVolume = function (v) { if (actx()) sfx.master.gain.value = Math.max(0, Math.min(1, v)); };

  // one shared noise buffer — building a new one per explosion is how a page
  // ends up allocating 2 MB every time something blows up
  let noiseBuf = null;
  function noise() {
    const ctx = actx(); if (!ctx) return null;
    if (!noiseBuf) {
      const n = ctx.sampleRate * 2;
      noiseBuf = ctx.createBuffer(1, n, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      let seed = 12345;
      for (let i = 0; i < n; i++) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; d[i] = (seed / 0x3fffffff) - 1; }
    }
    return noiseBuf;
  }

  // gain of a source scaled by distance — the one place attenuation lives
  sfx.gainAt = function (dist, ref) {
    const R = ref || 300;
    return Math.max(0, Math.min(1, R / (R + Math.max(0, dist))));
  };

  sfx.tone = function (freq, dur, opts) {
    const ctx = actx(); if (!ctx || sfx.muted) return;
    opts = opts || {};
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = opts.type || "sine";
    o.frequency.setValueAtTime(freq, ctx.currentTime);
    if (opts.slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, opts.slideTo), ctx.currentTime + dur);
    const v = (opts.gain != null ? opts.gain : 0.3);
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, v), ctx.currentTime + Math.min(0.03, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    o.connect(g); g.connect(sfx.master);
    o.start(); o.stop(ctx.currentTime + dur + 0.02);
  };

  sfx.boom = function (opts) {
    const ctx = actx(); if (!ctx || sfx.muted) return;
    opts = opts || {};
    const vol = opts.gain != null ? opts.gain : 0.7;
    const dur = opts.dur != null ? opts.dur : 1.6;
    const b = noise(); if (!b) return;
    const src = ctx.createBufferSource(); src.buffer = b; src.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass";
    lp.frequency.setValueAtTime(opts.bright ? 1800 : 900, ctx.currentTime);
    lp.frequency.exponentialRampToValueAtTime(90, ctx.currentTime + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    src.connect(lp); lp.connect(g); g.connect(sfx.master);
    src.start(); src.stop(ctx.currentTime + dur + 0.05);
    // the sub-bass punch that makes it read as ORDNANCE and not as static
    const o = ctx.createOscillator(), og = ctx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(opts.sub || 90, ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(24, ctx.currentTime + dur * 0.7);
    og.gain.setValueAtTime(vol * 0.9, ctx.currentTime);
    og.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur * 0.8);
    o.connect(og); og.connect(sfx.master);
    o.start(); o.stop(ctx.currentTime + dur);
  };

  // A looping, pitch-and-volume-controllable noise bed: engines, wind, sirens.
  // Returns a handle with set(freqOrRate, gain) and stop().
  sfx.loop = function (opts) {
    const ctx = actx(); if (!ctx) return { set: function () {}, stop: function () {} };
    opts = opts || {};
    const b = noise(); if (!b) return { set: function () {}, stop: function () {} };
    const src = ctx.createBufferSource(); src.buffer = b; src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = opts.filter || "bandpass";
    bp.frequency.value = opts.freq || 220;
    bp.Q.value = opts.q != null ? opts.q : 1.2;
    const g = ctx.createGain(); g.gain.value = 0;
    src.connect(bp); bp.connect(g); g.connect(sfx.master);
    src.start();
    let dead = false;
    return {
      set: function (freq, gain) {
        if (dead) return;
        const t = ctx.currentTime;
        if (freq != null) bp.frequency.setTargetAtTime(Math.max(20, freq), t, 0.08);
        if (gain != null) g.gain.setTargetAtTime(sfx.muted ? 0 : Math.max(0, gain), t, 0.08);
      },
      stop: function () { if (dead) return; dead = true; try { g.gain.setTargetAtTime(0, ctx.currentTime, 0.1); src.stop(ctx.currentTime + 0.4); } catch (e) {} },
    };
  };

  // A siren is two tones walking against each other — a generic warning voice.
  sfx.siren = function (dur, opts) {
    opts = opts || {};
    const n = Math.max(1, Math.round((dur || 2.4) / 0.6));
    for (let i = 0; i < n; i++) {
      setTimeout(function () {
        sfx.tone(opts.hi || 620, 0.34, { type: "sawtooth", gain: (opts.gain || 0.16), slideTo: opts.lo || 400 });
      }, i * 600);
    }
  };

  // ------------------------------------------------------------- the boot
  micro.boot = function (opts) {
    opts = opts || {};
    if (micro.booted) return micro;
    ensureHelpers();

    let canvas = opts.canvas;
    if (typeof canvas === "string") canvas = document.querySelector(canvas);
    if (!canvas) {
      canvas = document.createElement("canvas");
      canvas.id = "microCanvas";
      canvas.style.cssText = "position:fixed;inset:0;width:100%;height:100%;display:block;touch-action:none;";
      document.body.appendChild(canvas);
    }
    micro.canvas = canvas;

    if (!CBZ.renderer) {
      const r = new THREE.WebGLRenderer({
        canvas: canvas,
        antialias: opts.antialias !== false,
        powerPreference: "high-performance",
        stencil: false,
      });
      r.setPixelRatio(Math.min(window.devicePixelRatio || 1, C.MICRO_DPR_MAX));
      r.setSize(window.innerWidth, window.innerHeight, false);
      r.outputEncoding = THREE.sRGBEncoding;          // r128 spelling — this repo is pinned
      r.toneMapping = opts.toneMapping != null ? opts.toneMapping : THREE.ACESFilmicToneMapping;
      r.toneMappingExposure = opts.exposure != null ? opts.exposure : 1.0;
      if (C.MICRO_SHADOWS && opts.shadows !== false) {
        r.shadowMap.enabled = true;
        r.shadowMap.type = THREE.PCFSoftShadowMap;
      }
      CBZ.renderer = r;
    }

    if (!CBZ.camera) {
      CBZ.camera = new THREE.PerspectiveCamera(
        opts.fov != null ? opts.fov : 68,
        window.innerWidth / Math.max(1, window.innerHeight),
        opts.near != null ? opts.near : 0.35,
        opts.far != null ? opts.far : 14000);
      CBZ.camera.position.set(0, 20, 60);
    }
    if (!CBZ.clock) CBZ.clock = new THREE.Clock();

    function resize() {
      const w = window.innerWidth, h = Math.max(1, window.innerHeight);
      CBZ.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, C.MICRO_DPR_MAX));
      CBZ.renderer.setSize(w, h, false);
      CBZ.camera.aspect = w / h;
      CBZ.camera.updateProjectionMatrix();
    }
    window.addEventListener("resize", resize);
    window.addEventListener("orientationchange", resize);
    resize();

    bindInput(canvas);

    if (opts.sky !== false) micro.sky(opts.sky || {});
    if (opts.lights !== false) micro.lights(opts.lights || {});

    micro.booted = true;
    if (opts.autoStart !== false) micro.start();
    return micro;
  };

  // -------------------------------------------------------------- the audit
  // What a slice page actually got from the engine vs what it had to own.
  // helpersOwned > 0 on a page that DID load world/materials.js means the
  // load order is wrong (materials.js after microboot's ensureHelpers).
  CBZ.microAudit = function () {
    return {
      version: micro.version,
      booted: micro.booted,
      helpersOwned: helperOwn,
      hasRealMaterials: !!CBZ.pbrMat,          // world/materials.js present
      hasRealSeed: !!CBZ.hash01,               // core/seed.js present
      bridgedAlways: CBZ.always ? CBZ.always.length : 0,
      bridgedUpdaters: CBZ.updaters ? CBZ.updaters.length : 0,
      retiredHooks: micro.retired ? micro.retired.length : 0,
      retired: micro.retired || [],
      colliders: boxes.length,
      frameHooks: frameHooks.length,
      fps: micro.fps,
      sceneChildren: scene.children.length,
      sfx: !!sfx.ctx,
    };
  };
})();
