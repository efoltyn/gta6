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

  /* ---- ?cfg_X=0 ON A SLICE PAGE ------------------------------------------
     `src/config.js` has always turned every `cfg_*` query param into a
     CBZ.CONFIG flag, and that is the seam the whole A/B toolchain is built on:
     tools/visual-compare.mjs's flag-A/B mode boots the SAME checkout twice and
     flips exactly one flag, which is the only honest "before" for a behaviour
     change. A slice page (games/*.html) never loads config.js, so on those
     pages `?cfg_WILDLIFE_RAGDOLL=0` did nothing at all and every engine flag
     they inherited was untestable from the outside.

     Same three lines as config.js, and applied HERE — at microboot's module
     load, i.e. before any pack file runs — so it still wins over every
     `== null` default in every module the page goes on to load. If config.js
     is present it ran first and this is a byte-identical no-op. */
  try {
    if (typeof location !== "undefined" && location.search) {
      new URLSearchParams(location.search).forEach(function (v, k) {
        if (k.slice(0, 4) !== "cfg_") return;
        C[k.slice(4)] = v === "0" || v === "false" ? false : v === "1" || v === "true" ? true : v;
      });
    }
  } catch (e) {}

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

    /* PUBLISHED UNDER THE NAMES THE ENGINE READS, AND RE-ASSERTED EVERY FRAME.
       `CBZ.sun` / `CBZ.hemi` are what core/daynight.js drives and what every
       light-modifying pass in this repo reaches for — systems/fixtures.js's
       darken() (the whole "somewhere meant to be black between sweeps") among
       them. A slice page published neither, so a rig's nightFloor was a no-op
       and a night existed only as a NUMBER: rig.level() said dark, the screen
       said noon.

       The restore is not decoration, it is the contract. Those passes are
       MULTIPLIES — daynight.js re-writes the base intensity every frame and
       they scale it. With nobody re-writing the base, one multiply per frame
       is a geometric decay: the sun fades to zero over a few seconds and never
       comes back, which reads as "the page slowly broke". So this file takes
       daynight.js's other half too: order 9, before anything that shapes it. */
    if (!CBZ.sun) CBZ.sun = sun;
    if (!CBZ.hemi) CBZ.hemi = hemi;
    if (CBZ.onAlways) {
      const baseSun = sun.intensity, baseHemi = hemi.intensity;
      const skyC = hemi.color.clone(), gndC = hemi.groundColor.clone();
      const fogC = scene.fog ? scene.fog.color.clone() : null;
      CBZ.onAlways(9, function () {
        sun.intensity = baseSun;
        hemi.intensity = baseHemi;
        hemi.color.copy(skyC);
        hemi.groundColor.copy(gndC);
        if (fogC && scene.fog) scene.fog.color.copy(fogC);
      });
    }
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
  let _fpsAcc = 0, _fpsN = 0, _last = null, _wall = null, _raf = 0;

  /* ---- A TIME SCALE IS A SUBSTEP, NEVER A MULTIPLY ------------------------
     A page that wants the world to run at 8x cannot get there by handing this
     loop eight times the dt. Every integrator on the far side of these hooks
     — a man walking, a bullet flying, a circle resolve pushing two bodies
     apart — is only correct for a step of the size it was tuned against, and
     one 133 ms step is how a soldier ends up on the other side of a mesa. So
     the loop takes its dt from a clock the page may WARP, and then splits
     whatever comes back into steps of at most maxStep.

     Four knobs, and their defaults are today's loop EXACTLY: maxStep 0.1 is
     the dt clamp this file has always had, maxSubsteps 1 is one step per
     frame, simClock null is rAF's own timestamp, and stepBudgetMs 0 is no
     wall budget. A page that sets none of them cannot tell this comment was
     written. games/warlord.html sets all four from CBZ.warlord.clock.

     THE BUDGET IS THE SAFETY. Substepping is unbounded work per frame, so a
     slow machine at a high scale would spend the whole frame in the sim and
     never draw. When the loop has spent stepBudgetMs it stops substepping and
     the world FALLS BEHIND the clock — which is survivable and measurable —
     instead of the page freezing, which is neither.

     WHAT A HOOK CAN ASK. subCount/subIndex say where in the frame it is, and
     `drawing` is true on exactly one substep per frame: the one the render
     follows. Presentation work (a mixer flushing voices, an LOD swap) checks
     it and runs once; frameDt is that frame's real WALL seconds, for anything
     scheduled against a real timeline like audio. */
  micro.simClock = null;        // () => game milliseconds; null = rAF's own
  micro.maxStep = 0.1;          // biggest dt any hook may ever be handed
  micro.maxSubsteps = 1;        // 1 = one step per frame — today's loop
  micro.stepBudgetMs = 0;       // wall ms the substep loop may spend; 0 = uncapped
  micro.subCount = 1;           // substeps this frame
  micro.subIndex = 0;           // which one is running
  micro.drawing = true;         // true on the last substep — the drawn one
  micro.frameDt = 0;            // this frame's WALL seconds (unscaled, clamped)
  micro.simDt = 0;              // game seconds this frame has delivered so far

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

  // The wall stopwatch the substep budget is spent against — never the sim
  // clock, which is the thing being budgeted.
  const nowMsRaw = (typeof performance !== "undefined" && performance.now)
    ? function () { return performance.now(); }
    : function () { return Date.now(); };

  function runBridged(entry, dt, band) {
    if (entry.dead) return;
    try { entry.fn(dt); entry.fails = 0; }
    catch (e) {
      entry.fails = (entry.fails || 0) + 1;
      if (entry.fails >= 3) {
        entry.dead = true;
        micro.retired.push({ band: band, order: entry.order, source: entry.source || "", error: String(e && e.message || e) });
        console.warn("[micro] retired a " + band + " hook (order " + entry.order + "), it needs the full engine:", e);
      }
    }
  }

  function tick(now) {
    _raf = requestAnimationFrame(tick);
    // WALL first, always, and it is its own measurement: fps, micro.elapsed
    // and anything scheduled against a real timeline are about how fast this
    // machine is drawing, which a time scale must not be allowed to lie about.
    if (_wall === null) _wall = now;
    let wdt = (now - _wall) / 1000;
    _wall = now;
    if (!(wdt > 0)) wdt = 0;
    if (wdt > 0.1) wdt = 0.1;
    micro.frameDt = wdt;

    // …and the SIM clock second. Same number unless the page warped it.
    const clk = micro.simClock ? +micro.simClock() : now;
    if (_last === null) _last = clk;
    // dt clamp: a tab that was backgrounded for 40 s must not teleport every
    // projectile in the world through a building on the first frame back.
    // The ceiling is now the substep budget rather than a bare 0.1, because
    // the budget is what actually bounds the work — see maxSubsteps above.
    let dt = (clk - _last) / 1000;
    _last = clk;
    if (!(dt > 0)) dt = 0;
    const maxStep = micro.maxStep > 0 ? micro.maxStep : 0.1;
    const maxSub = micro.maxSubsteps > 1 ? Math.floor(micro.maxSubsteps) : 1;
    if (dt > maxStep * maxSub) dt = maxStep * maxSub;
    // n substeps of EQUAL size, so a frame's steps are all the same shape and
    // nothing gets a ragged last one.
    const n = dt > maxStep ? Math.min(maxSub, Math.ceil(dt / maxStep)) : 1;
    const sdt = n > 1 ? dt / n : dt;

    micro.frames++;
    _fpsAcc += wdt; _fpsN++;
    if (_fpsAcc >= 0.5) { micro.fps = Math.round(_fpsN / _fpsAcc); _fpsAcc = 0; _fpsN = 0; }
    // the engine's own registry first, in ITS declared order (see the bridge
    // in ensureHelpers): `always` runs even while paused, by contract.
    if (bridgeDirty) {
      bridgeDirty = false;
      CBZ.always.sort(function (a, b) { return a.order - b.order; });
      CBZ.updaters.sort(function (a, b) { return a.order - b.order; });
    }
    micro.subCount = n;
    micro.simDt = 0;
    const budget = micro.stepBudgetMs > 0 ? micro.stepBudgetMs : 0;
    const spendFrom = budget ? now : 0;
    for (let s = 0; s < n; s++) {
      /* THE LAST SUBSTEP IS DECIDED AT THE TOP OF THE ITERATION, not at the
         bottom, because the budget can end the frame early: if `drawing` were
         computed as (s === n-1) a budget cut would leave a frame in which no
         substep was ever the drawn one, and every presentation hook that
         gates on it would silently skip that frame. */
      const spent = budget && s > 0 && (nowMsRaw() - spendFrom) > budget;
      const last = spent || s === n - 1;
      micro.subIndex = s;
      micro.drawing = last;
      micro.simDt = (s + 1) * sdt;
      _shakeDecay(sdt);
      for (let i = 0; i < CBZ.always.length; i++) runBridged(CBZ.always[i], sdt, "always");
      /* THE PAUSE KEY IS OWNED HERE, ABOVE THE GATE, and that is the whole point.
         A page that toggles micro.paused from inside its own onFrame hook can
         pause once and never unpause: the hooks are exactly what the gate below
         stops running. Every page hits this the same way, so it is not a page's
         problem to solve. Set micro.pauseKey = null to own it yourself.
         Read on the FIRST substep only: input.down is a one-frame edge and
         re-reading it eight times is eight toggles from one keypress. */
      if (s === 0 && micro.pauseKey && input.down[micro.pauseKey]) micro.paused = !micro.paused;
      // A PAUSED PAGE CANNOT DRAW ITS OWN "PAUSED", because the frame hooks are
      // precisely what stopped. So the state goes on the document, where CSS can
      // still see it, and studio's HUD reads the mark.
      if (micro.paused !== _wasPaused) {
        _wasPaused = micro.paused;
        try { document.body.classList.toggle("micro-paused", !!micro.paused); } catch (e) {}
      }
      if (!micro.paused) {
        // micro.elapsed is the RENDER clock and stays on wall seconds: it is
        // read as an animation phase (shake oscillation, a marching gait) and
        // as a "did the other module draw recently" handshake, and both of
        // those are questions about frames, not about world time. Advanced
        // once per frame, on the first substep, exactly as it always was.
        if (s === 0) micro.elapsed += wdt;
        for (let i = 0; i < CBZ.updaters.length; i++) runBridged(CBZ.updaters[i], sdt, "update");
        for (let i = 0; i < frameHooks.length; i++) {
          try { frameHooks[i].fn(sdt, micro.elapsed); }
          catch (e) { console.error("[micro frame " + (frameHooks[i].id || i) + "]", e); }
        }
      }
      if (last) { micro.subCount = s + 1; break; }
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

  micro.start = function () { if (!_raf) { _last = null; _wall = null; _raf = requestAnimationFrame(tick); } };
  micro.stop = function () { if (_raf) { cancelAnimationFrame(_raf); _raf = 0; } };

  /* ---- HEADLESS SIM STEP (tools only — inert in normal play) --------------
     core/loop.js publishes CBZ.stepSim for exactly this and a slice page has
     no loop.js, so every one-shot game in games/ was verifiable only by
     WAITING on software-rasterized frames at roughly 60x slow: a three-minute
     game costs three hours of probe, which means in practice nobody ever
     tested one to its end. The whole point of scrolls/claude/verification.md is
     that a gate reads state and steps time by hand.

     Same shape and the same order as tick() above, minus the renderer, with
     the same per-hook try/catch so a throw surfaces without killing the burst.
     `micro.elapsed` advances, because cooldowns and phases are read off it. */
  micro.stepSim = function (dt) {
    dt = dt > 0 ? dt : 1 / 60;
    /* A HAND-DRIVEN STEP IS ALWAYS THE DRAWN ONE. Tools call this in a burst
       and then screenshot; a presentation hook that gates on micro.drawing
       would otherwise never run in any headless capture. */
    micro.subCount = 1; micro.subIndex = 0; micro.drawing = true;
    micro.frameDt = dt; micro.simDt = dt;
    if (bridgeDirty) {
      bridgeDirty = false;
      CBZ.always.sort(function (a, b) { return a.order - b.order; });
      CBZ.updaters.sort(function (a, b) { return a.order - b.order; });
    }
    _shakeDecay(dt);
    for (let i = 0; i < CBZ.always.length; i++) runBridged(CBZ.always[i], dt, "always");
    if (!micro.paused) {
      micro.elapsed += dt;
      micro.frames++;
      for (let i = 0; i < CBZ.updaters.length; i++) runBridged(CBZ.updaters[i], dt, "update");
      for (let i = 0; i < frameHooks.length; i++) {
        try { frameHooks[i].fn(dt, micro.elapsed); }
        catch (e) { console.error("[micro frame " + (frameHooks[i].id || i) + "]", e); }
      }
    }
    input.endFrame();
  };
  if (!CBZ.stepSim) CBZ.stepSim = micro.stepSim;

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
    micro.lock = function () {
      // requestPointerLock returns a PROMISE in current Chrome, so a page that
      // asks outside a user gesture (a programmatic start, a probe) gets an
      // UNHANDLED rejection — a console error in a game that did nothing wrong.
      try { const r = el.requestPointerLock(); if (r && r.catch) r.catch(function () {}); } catch (e) {}
    };
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

  /* EDGE OFFSETS TAKE A CSS LENGTH, NOT JUST A NUMBER.

     The furniture layer is `inset:0` on the raw viewport, so a plain
     `bottom: 24` puts a control UNDER the home indicator on every phone made
     since 2017 — while the HUD next to it, which uses env(safe-area-inset-*),
     sits correctly above it. The two layers disagreed by the height of the
     inset and nothing could express the difference. Now anything that can be
     a CSS length can be one: pass a number for plain pixels, or a string like
     "calc(160px + env(safe-area-inset-bottom,0px))" to respect the notch. */
  function len(v, dflt) {
    const x = v != null ? v : dflt;
    return typeof x === "number" ? x + "px" : String(x);
  }

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
    b.style.right = len(o.right, 24);
    b.style.bottom = len(o.bottom, 24);
    if (o.left != null) { b.style.left = len(o.left); b.style.right = "auto"; }
    // TOP ANCHORING, because a layer that can only hang off the bottom edge
    // forces every page to put system controls (pause, mute, camera) in the
    // thumb zone with the game verbs, where they get hit by accident.
    if (o.top != null) { b.style.top = len(o.top); b.style.bottom = "auto"; }
    b.textContent = o.glyph || o.label || "";
    /* THE ID GOES ON THE ELEMENT, not just on the handle. It was only ever
       stored in the returned object, which means a stylesheet could not reach
       one button and a tool could not ask whether it was on screen — and a
       contextual control (a reach prompt, a mount button) is exactly the kind
       whose visibility is the thing worth checking. */
    if (o.id) b.id = o.id;
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
    el.style.cssText += "width:" + len(W) + ";height:" + len(H) +
      ";right:" + len(o.right, 24) + ";bottom:" + len(o.bottom, 108) + ";";
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
  /* THE SLICE PAGE'S PHYSICS CORE (2026-09-29). Every games/ page that stands
     on microboot (Warlord, Battle, Bomb Survivor, ...) resolves bodies here,
     because systems/physics.js cannot come to a slice page: it reads the
     player, the city and the game mode at load. So this IS physics.js for
     those pages, and it speaks the SAME record and the SAME verbs:

       record   {minX,maxX,minZ,maxZ}          the conservative AABB (always)
                + {y0,y1}                      optional vertical band
                + {cx,cz,hw,hd,yaw}            optional ORIENTED body; hw/hd are
                                               half-extents on the box's own
                                               local +x/+z, yaw is THREE's
                                               rotation.y. The AABB stays the
                                               broadphase; the resolve is exact.
                + noBlock                      sight/blast pass through it
                + ref / tag / anything else    carried, never read

       CBZ.collide(pos, r, feetY, headY)        push a disc out, -> moved
       CBZ.collideSlide(pos, r, feetY, headY)   same, -> moved >= 2 mm
       CBZ.sweepCircle(from, to, r, feetY, headY, out)   first contact of
                                                a moving disc, -> hit
       CBZ.rayColliders(ox,oy,oz, dx,dy,dz, maxT, out, opts) -> record|null
       CBZ.colliderAdd / colliderRemove / colliderShrunk / segmentHitsCollider
       CBZ.orientedCollider / orientedSlack

     Every CBZ name yields (the full engine defines its own first), so the
     page shims that used to translate collide() into resolveCircle() are
     gone; shared consumers (ragdolls, debris, bodyfall, verbs) call the same
     name in both worlds and get the same answer.

     THE OLD FLOOR WAS AABB-ONLY. A prop turned 30 degrees registered its
     rotated bounding rectangle, so a 6 m x 0.9 m sandbag run became a 5.6 m
     square of solid air: men stopped a metre and a half short of cover they
     could see through, and the corner of a turned container was walk-through
     on one diagonal and an invisible wall on the other.

     THE GRID HOLDS RECORDS, NOT INDICES. It used to file array indices, so a
     splice without the doorbell silently shifted every later box onto the
     wrong record. A record-filed grid can at worst keep a ghost until the
     next rebuild, never answer with the wrong wall. */
  const CELL = 48;
  const grid = new Map();
  // adopt a registry an earlier file already made: one array, never two
  const boxes = Array.isArray(CBZ.colliders) ? CBZ.colliders : [];
  const cellsOf = new WeakMap();          // record -> [x0,x1,z0,z1] it was filed under
  let gridN = 0, gridDirty = false, qid = 0;
  function cellKey(cx, cz) { return cx * 73856093 ^ cz * 19349663; }
  function gridAdd(b) {
    const x0 = Math.floor(b.minX / CELL), x1 = Math.floor(b.maxX / CELL);
    const z0 = Math.floor(b.minZ / CELL), z1 = Math.floor(b.maxZ / CELL);
    for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) {
      const k = cellKey(cx, cz);
      let a = grid.get(k);
      if (!a) { a = []; grid.set(k, a); }
      a.push(b);
    }
    cellsOf.set(b, [x0, x1, z0, z1]);
  }
  function gridDrop(b) {
    const r = cellsOf.get(b);
    if (!r) return false;
    let ok = true;
    for (let cx = r[0]; cx <= r[1]; cx++) for (let cz = r[2]; cz <= r[3]; cz++) {
      const k = cellKey(cx, cz), a = grid.get(k);
      const i = a ? a.indexOf(b) : -1;
      if (i < 0) { ok = false; continue; }
      a.splice(i, 1);
      if (!a.length) grid.delete(k);
    }
    cellsOf.delete(b);
    return ok;
  }
  function inSync() { return !gridDirty && gridN === boxes.length; }
  function ensureGrid() {
    if (inSync()) return;
    grid.clear();
    for (let i = 0; i < boxes.length; i++) gridAdd(boxes[i]);
    gridN = boxes.length;
    gridDirty = false;
  }

  // A record made of only an oriented body gets its AABB; a swapped AABB is
  // put right. Mutates and returns the record (callers keep their object).
  function normalize(b) {
    if (b.yaw && b.cx != null && b.hw != null) {
      const co = Math.cos(b.yaw), si = Math.sin(b.yaw);
      const ac = co < 0 ? -co : co, as = si < 0 ? -si : si;
      const ex = b.hw * ac + b.hd * as, ez = b.hw * as + b.hd * ac;
      if (b.minX == null || b.maxX == null) { b.minX = b.cx - ex; b.maxX = b.cx + ex; }
      if (b.minZ == null || b.maxZ == null) { b.minZ = b.cz - ez; b.maxZ = b.cz + ez; }
    }
    if (b.minX > b.maxX) { const t = b.minX; b.minX = b.maxX; b.maxX = t; }
    if (b.minZ > b.maxZ) { const t = b.minZ; b.minZ = b.maxZ; b.maxZ = t; }
    return b;
  }

  // addCollider({minX,maxX,minZ,maxZ, y0?, y1?, cx?,cz?,hw?,hd?,yaw?, ref?, tag?})
  // y0/y1 make it a HEIGHT-GATED box (a wall you can fly over, a rail you can
  // vault); omit them and it is full height, which is what a building is.
  micro.addCollider = function (b) {
    if (!b) return null;
    normalize(b);
    const sync = inSync();
    boxes.push(b);
    if (sync) { gridAdd(b); gridN = boxes.length; }
    return b;
  };
  // THE ONE PLACE A ROTATED WALL BECOMES A COLLIDER (physics.js's own
  // function, same numbers): the oriented body plus its conservative AABB. A
  // box within a hair of a right angle comes back a plain AABB with no yaw.
  const ORI_EPS = 1e-4;
  function orientedCollider(cx, cz, hw, hd, yaw, y0, y1) {
    yaw = +yaw || 0;
    const co = Math.cos(yaw), si = Math.sin(yaw);
    const ac = co < 0 ? -co : co, as = si < 0 ? -si : si;
    const ex = hw * ac + hd * as, ez = hw * as + hd * ac;
    const c = { minX: cx - ex, maxX: cx + ex, minZ: cz - ez, maxZ: cz + ez };
    if (as > ORI_EPS && ac > ORI_EPS) { c.cx = cx; c.cz = cz; c.hw = hw; c.hd = hd; c.yaw = yaw; }
    if (y0 != null) { c.y0 = y0; c.y1 = y1; }
    return c;
  }
  micro.orientedCollider = orientedCollider;
  if (!CBZ.orientedCollider) CBZ.orientedCollider = orientedCollider;
  if (!CBZ.orientedSlack) CBZ.orientedSlack = function (hw, hd, yaw) {
    const co = Math.cos(yaw), si = Math.sin(yaw);
    const ac = co < 0 ? -co : co, as = si < 0 ? -si : si;
    const ex = hw * ac + hd * as, ez = hw * as + hd * ac;
    return (ex * as + ez * ac) - hd;
  };
  // A box centred (x,y,z), w x h x d. `extra.yaw` turns it about Y exactly as
  // a mesh's rotation.y would (w along the turned local x, d along local z);
  // every other key on `extra` is copied onto the record.
  micro.addBoxCollider = function (x, y, z, w, h, d, extra) {
    const yaw = extra && extra.yaw ? +extra.yaw : 0;
    const b = orientedCollider(x, z, w / 2, d / 2, yaw, y - h / 2, y + h / 2);
    if (extra) for (const k in extra) if (k !== "yaw") b[k] = extra[k];
    return micro.addCollider(b);
  };
  // Take a record (or every record carrying `ref`) out of the world, in place.
  // Returns how many went.
  micro.removeCollider = function (bOrRef) {
    if (bOrRef == null) return 0;
    let n = 0;
    for (let i = boxes.length - 1; i >= 0; i--) {
      const b = boxes[i];
      if (b !== bOrRef && !(b.ref != null && b.ref === bOrRef)) continue;
      const sync = inSync();
      boxes.splice(i, 1);
      if (sync && gridDrop(b)) gridN = boxes.length; else gridDirty = true;
      n++;
      if (b === bOrRef) break;
    }
    return n;
  };
  // A record's bounds were edited in place (a door slid, a crate was shoved):
  // refile it. Cheap — only its own cells are touched.
  micro.moveCollider = function (b) {
    if (!b) return;
    if (!inSync() || !cellsOf.has(b)) { gridDirty = true; return; }
    gridDrop(b);
    gridAdd(b);
  };
  // Translate a record (AABB and oriented centre together) and refile it.
  micro.shiftCollider = function (b, dx, dz) {
    if (!b) return;
    b.minX += dx; b.maxX += dx; b.minZ += dz; b.maxZ += dz;
    if (b.cx != null) { b.cx += dx; b.cz += dz; }
    micro.moveCollider(b);
  };
  micro.colliders = boxes;

  /* PUBLISHED UNDER THE NAME THE ENGINE ALREADY READS (2026-08-07).
     `CBZ.colliders` is Gang City's world-geometry registry — 40+ files write
     it and the shared verbs READ it: physics.js's vault probe, fracture.js's
     carveHole, crashfx.js's wall ruin and airstrike collapse, the camera's
     occlusion test. Its element is exactly the box this file builds. SAME
     ARRAY, not a copy, and nothing may ever reassign it: every mutation here
     is in place (push / splice / length = 0). Yields to a registry the full
     engine or an earlier file already made. */
  if (!CBZ.colliders) CBZ.colliders = boxes;

  /* ---- THE DOORBELL, AND THE NAMES A MOVING SOLID NEEDS -------------------
     A caller that pushes straight onto the array (world/materials.js addBox
     {solid:true}, systems/pushables.js) is caught by the length check; one
     that translates a record in place must ring markCollidersDirty (or use
     micro.moveCollider), exactly as it must under physics.js. */
  micro.rebuildColliderGrid = function () { gridDirty = true; ensureGrid(); };
  micro.markCollidersDirty = function () { gridDirty = true; };
  if (!CBZ.markCollidersDirty) CBZ.markCollidersDirty = micro.markCollidersDirty;
  if (!CBZ.colliderAdd) CBZ.colliderAdd = micro.addCollider;
  if (!CBZ.colliderRemove) CBZ.colliderRemove = function (c) { return micro.removeCollider(c) > 0; };
  if (!CBZ.colliderShrunk) CBZ.colliderShrunk = function (c) { micro.moveCollider(c); };

  /* ---- WALK SURFACES ------------------------------------------------------
     `CBZ.platforms` is the engine's ONE contract for "the top of this thing is
     ground": systems/pieces.js's walkTop, city/buildings.js's stairs and
     systems/pushables.js's `stand:true` prop all write that record, and
     physics.js's groundAt() reads it. A slice page has no physics.js, so the
     array did not exist — and `if (spec.stand && CBZ.platforms)` is a silent
     guard, so a pushable declared standable created no record at all and the
     crate you shoved under the vent was scenery you could walk through the top
     of. Same rule as CBZ.colliders above: publish under the name the engine
     already reads, and yield to anything that made one first.

     `platformTop` is the read side, so a page's own groundAt() is one max()
     away from honouring every walk surface in the world. Linear: the records a
     slice page owns are a handful of props, not a city's stairwells. */
  if (!CBZ.platforms) CBZ.platforms = [];
  if (!CBZ.markPlatformsDirty) CBZ.markPlatformsDirty = function () {};
  micro.stepUp = 0.45;                    // physics.js's own riser/curb/sill climb
  micro.platformTop = function (x, z, fromY, floor) {
    const plats = CBZ.platforms;
    let best = floor || 0;
    if (!plats || !plats.length) return best;
    const reach = (fromY != null ? fromY : best) + micro.stepUp;
    for (let i = 0; i < plats.length; i++) {
      const p = plats[i];
      if (x < p.minX || x > p.maxX || z < p.minZ || z > p.maxZ) continue;
      // an oriented walk surface (a diagonal flight, a curved tier): the AABB
      // is only its broadphase, as in physics.js groundAt
      if (p.obb) {
        const o = p.obb, rx = x - o.cx, rz = z - o.cz;
        const a = rx * o.ux + rz * o.uz, c = rx * o.uz - rz * o.ux;
        if (a < -o.hl || a > o.hl || c < -o.hw || c > o.hw) continue;
      }
      let top = p.top;
      if (p.ramp) {
        const r = p.ramp;
        let t = r.dir ? ((x - r.ox) * r.dx + (z - r.oz) * r.dz) / r.len
          : (r.axis === "x") ? (x - r.x0) / (r.x1 - r.x0) : (z - r.z0) / (r.z1 - r.z0);
        if (t < 0) t = 0; else if (t > 1) t = 1;
        top = (r.steps && CBZ.rampTop) ? CBZ.rampTop(r, t) : r.y0 + t * (r.y1 - r.y0);
      }
      if (top <= reach && top > best) best = top;
    }
    return best;
  };

  micro.clearColliders = function () { boxes.length = 0; grid.clear(); gridN = 0; gridDirty = false; };

  // ---- broadphase ---------------------------------------------------------
  // Dedupe by stamping the record with the query id (physics.js's trick): a
  // property compare instead of a Set per call.
  function gatherCells(x0, x1, z0, z1, id, out) {
    for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) {
      const a = grid.get(cellKey(cx, cz));
      if (!a) continue;
      for (let i = 0; i < a.length; i++) {
        const b = a[i];
        if (b._mq === id) continue;
        b._mq = id;
        out.push(b);
      }
    }
  }
  micro.queryColliders = function (x, z, r, out) {
    out = out || [];
    out.length = 0;
    ensureGrid();
    r = r || 0;
    gatherCells(Math.floor((x - r) / CELL), Math.floor((x + r) / CELL),
      Math.floor((z - r) / CELL), Math.floor((z + r) / CELL), ++qid, out);
    return out;
  };
  // every record in the cells a segment (widened by `pad`) passes through.
  // Samples at half a cell with a quarter-cell halo, so the union of the
  // sampled squares covers the whole swept band: no cell is ever stepped over.
  function gatherSegment(ax, az, bx, bz, pad, out) {
    out.length = 0;
    ensureGrid();
    const id = ++qid;
    const dx = bx - ax, dz = bz - az;
    const n = Math.max(1, Math.ceil(Math.hypot(dx, dz) / (CELL * 0.5)));
    const h = CELL * 0.25 + (pad || 0);
    for (let i = 0; i <= n; i++) {
      const x = ax + dx * i / n, z = az + dz * i / n;
      gatherCells(Math.floor((x - h) / CELL), Math.floor((x + h) / CELL),
        Math.floor((z - h) / CELL), Math.floor((z + h) / CELL), id, out);
    }
    return out;
  }

  // ---- one record's own frame ---------------------------------------------
  // THREE's rotation.y sends local +x -> world (cos,-sin) and local +z ->
  // world (sin,cos); world -> local is the transpose. An AABB is the same
  // frame with no turn, centred on its middle.
  const F = { ox: 0, oz: 0, co: 1, si: 0, hw: 0, hd: 0 };
  function frame(c) {
    if (c.yaw && c.cx != null && c.hw != null) {
      // trig cached on the record under physics.js's own field names
      if (c._triYaw !== c.yaw) { c._triYaw = c.yaw; c._co = Math.cos(c.yaw); c._si = Math.sin(c.yaw); }
      F.ox = c.cx; F.oz = c.cz; F.co = c._co; F.si = c._si;
      F.hw = c.hw; F.hd = c.hd;
    } else {
      F.ox = (c.minX + c.maxX) * 0.5; F.oz = (c.minZ + c.maxZ) * 0.5; F.co = 1; F.si = 0;
      F.hw = (c.maxX - c.minX) * 0.5; F.hd = (c.maxZ - c.minZ) * 0.5;
    }
    return F;
  }
  // feetY/headY gate a banded record exactly as physics.js's collide() does:
  // skipped when the body is wholly under it or wholly over it. Omit both and
  // every record is full height.
  function bandSkip(c, feetY, headY) {
    return c.y0 != null && (headY <= c.y0 || feetY >= (c.y1 == null ? Infinity : c.y1));
  }

  // Penetration of a disc into one record. Returns the depth (0 = clear) and
  // leaves the world-space push that clears it in _pen.
  const _pen = { x: 0, z: 0 };
  function penetration(c, x, z, r) {
    const f = frame(c);
    const rx = x - f.ox, rz = z - f.oz;
    const lx = rx * f.co - rz * f.si, lz = rx * f.si + rz * f.co;
    const qx = lx < -f.hw ? -f.hw : (lx > f.hw ? f.hw : lx);
    const qz = lz < -f.hd ? -f.hd : (lz > f.hd ? f.hd : lz);
    const dx = lx - qx, dz = lz - qz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= r * r) return 0;
    let px, pz, depth;
    if (d2 < 1e-8) {
      // centre INSIDE: leave through the nearest face, on the box's own axes
      const penX = f.hw - (lx < 0 ? -lx : lx), penZ = f.hd - (lz < 0 ? -lz : lz);
      if (penX < penZ) { depth = penX + r; px = (lx < 0 ? -1 : 1) * depth; pz = 0; }
      else { depth = penZ + r; px = 0; pz = (lz < 0 ? -1 : 1) * depth; }
    } else {
      const d = Math.sqrt(d2), k = (r - d) / d;
      depth = r - d; px = dx * k; pz = dz * k;
    }
    _pen.x = px * f.co + pz * f.si;
    _pen.z = -px * f.si + pz * f.co;
    return depth;
  }

  /* ---- THE RESOLVER — physics.js's collide(), same contract (2026-09-29).
     Each pass collects the contacts, resolves them DEEPEST FIRST (each one
     re-measured from where the deeper pushes left the body, so a contact the
     first push already cleared costs nothing), and repeats until a pass finds
     none (cap 4). A body wedged into an inside corner clears both walls in
     one call instead of being shoved out of one into the other. Mutates
     pos.{x,z}; pos.y untouched. Returns true iff a collider pushed it. */
  const MAX_PASSES = 4, CT_MAX = 16, PEN_EPS = 1e-4;
  const _qbuf = [], _cand = [], _ctC = new Array(CT_MAX), _ctD = new Float64Array(CT_MAX);
  function collideCore(pos, r, feetY, headY) {
    if (!pos || !(r > 0)) return false;
    const list = micro.queryColliders(pos.x, pos.z, r + 1, _qbuf);
    if (!list.length) return false;
    // narrow once: band + a generous AABB halo (a centre-inside push can move
    // the body up to a box half-width, so the halo is not just r)
    const reach = r + 6;
    _cand.length = 0;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (bandSkip(c, feetY, headY)) continue;
      if (!(pos.x >= c.minX - reach && pos.x <= c.maxX + reach && pos.z >= c.minZ - reach && pos.z <= c.maxZ + reach)) continue;
      _cand.push(c);
    }
    // depth > PEN_EPS: a body resolved to exactly r is not re-counted
    let moved = false;
    for (let pass = 0; pass < MAX_PASSES; pass++) {
      const x = pos.x, z = pos.z;
      let n = 0;
      for (let i = 0; i < _cand.length && n < CT_MAX; i++) {
        const c = _cand[i];
        if (!(x >= c.minX - r && x <= c.maxX + r && z >= c.minZ - r && z <= c.maxZ + r)) continue;
        const d = penetration(c, x, z, r);
        if (d > PEN_EPS) { _ctC[n] = c; _ctD[n] = d; n++; }
      }
      if (!n) break;
      for (let i = 1; i < n; i++) {        // deepest first (insertion sort, n is tiny)
        const c = _ctC[i], d = _ctD[i];
        let j = i - 1;
        while (j >= 0 && _ctD[j] < d) { _ctC[j + 1] = _ctC[j]; _ctD[j + 1] = _ctD[j]; j--; }
        _ctC[j + 1] = c; _ctD[j + 1] = d;
      }
      for (let i = 0; i < n; i++) {
        if (penetration(_ctC[i], pos.x, pos.z, r) > PEN_EPS) { pos.x += _pen.x; pos.z += _pen.z; moved = true; }
      }
    }
    return moved;
  }
  micro.collide = function (pos, r, feetY, headY) {
    const hit = collideCore(pos, r, feetY, headY);
    // moving walls (systems/platforms_moving.js), exactly as physics.js does
    if (CBZ.mpCollide) CBZ.mpCollide(pos, r, feetY, headY);
    return hit;
  };
  // The old name, kept for the forty call sites that use it: a body of
  // `height` standing at `y`. height omitted = a 1.8 m person.
  micro.resolveCircle = function (pos, r, y, height) {
    return micro.collide(pos, r, y, y + (height != null ? height : 1.8));
  };
  // collide() plus "did it actually move >= 2 mm" (the old 5th `passes`
  // argument is accepted and ignored, as in physics.js)
  micro.collideSlide = function (pos, r, feetY, headY) {
    const bx = pos.x, bz = pos.z;
    micro.collide(pos, r, feetY, headY);
    const dx = pos.x - bx, dz = pos.z - bz;
    return dx * dx + dz * dz >= 0.002 * 0.002;
  };
  if (!CBZ.collide) CBZ.collide = micro.collide;
  if (!CBZ.collideSlide) CBZ.collideSlide = micro.collideSlide;

  // Exact point tests, for the call sites that used to read minX..maxZ by
  // hand (an OBB's AABB is conservative, never exact). `pad` grows the box.
  micro.colliderContains = function (c, x, z, pad) {
    const f = frame(c), p = pad || 0;
    const rx = x - f.ox, rz = z - f.oz;
    const lx = rx * f.co - rz * f.si, lz = rx * f.si + rz * f.co;
    return lx >= -f.hw - p && lx <= f.hw + p && lz >= -f.hd - p && lz <= f.hd + p;
  };
  // the first record containing (x,z) whose band holds y (y null = any height)
  const _atBuf = [];
  micro.colliderAt = function (x, y, z, pad) {
    const list = micro.queryColliders(x, z, (pad || 0) + 0.01, _atBuf);
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (y != null && c.y0 != null && (y < c.y0 || y > (c.y1 == null ? Infinity : c.y1))) continue;
      if (micro.colliderContains(c, x, z, pad)) return c;
    }
    return null;
  };

  /* ---- THE SWEPT DISC — physics.js's CBZ.sweepCircle, same contract.
       micro.sweepCircle(from, to, radius, feetY, headY, out?) -> hit:boolean
         from/to  {x,z} (not mutated)
         out      {hit, t, x, z, nx, nz, c}: t = fraction of from->to at first
                  contact (1 = none); x,z = the SAFE centre, backed off 1 cm
                  along the path (== to when nothing is hit); (nx,nz) = unit
                  outward normal at the contact; c = the record.
     Exact: the Minkowski sum of a box and a disc is two widened rectangles
     and four corner discs, and the first entry into their union is the first
     contact, in the box's own frame. No step size, so no speed tunnels
     through a 12 cm wall. A box the disc already overlaps at `from` is
     collide()'s business and is ignored, unless the step drives deeper into
     it (t = 0); a centre already inside is ignored outright. */
  function rayRect(ox, oz, dx, dz, ex, ez) {
    let t0 = -Infinity, t1 = Infinity, a, b, s;
    if (dx > -1e-12 && dx < 1e-12) { if (ox < -ex || ox > ex) return Infinity; }
    else { a = (-ex - ox) / dx; b = (ex - ox) / dx; if (a > b) { s = a; a = b; b = s; } if (a > t0) t0 = a; if (b < t1) t1 = b; }
    if (dz > -1e-12 && dz < 1e-12) { if (oz < -ez || oz > ez) return Infinity; }
    else { a = (-ez - oz) / dz; b = (ez - oz) / dz; if (a > b) { s = a; a = b; b = s; } if (a > t0) t0 = a; if (b < t1) t1 = b; }
    if (t0 > t1 || t1 < 0 || t0 < -1e-6) return Infinity;
    return t0 < 0 ? 0 : t0;
  }
  function rayDisc(ox, oz, dx, dz, cx, cz, r) {
    const fx = ox - cx, fz = oz - cz;
    const a = dx * dx + dz * dz;
    if (a < 1e-18) return Infinity;
    const b = fx * dx + fz * dz, c = fx * fx + fz * fz - r * r;
    const disc = b * b - a * c;
    if (disc < 0) return Infinity;
    const t = (-b - Math.sqrt(disc)) / a;
    if (t < -1e-6) return Infinity;
    return t < 0 ? 0 : t;
  }
  const SWEEP = { hit: false, t: 1, x: 0, z: 0, nx: 0, nz: 0, c: null };
  const SW_SKIN = 0.01;
  const _sw = [];
  micro.sweepCircle = function (from, to, r, feetY, headY, out) {
    out = out || SWEEP;
    const ax = from.x, az = from.z, bx = to.x, bz = to.z;
    const vx = bx - ax, vz = bz - az, len2 = vx * vx + vz * vz;
    out.hit = false; out.t = 1; out.x = bx; out.z = bz; out.nx = 0; out.nz = 0; out.c = null;
    if (!(len2 > 1e-12)) return false;
    r = r > 0 ? r : 0;
    const list = gatherSegment(ax, az, bx, bz, r + 0.01, _sw);
    const sx0 = Math.min(ax, bx) - r, sx1 = Math.max(ax, bx) + r;
    const sz0 = Math.min(az, bz) - r, sz1 = Math.max(az, bz) + r;
    let bestT = 1, bestC = null, bnx = 0, bnz = 0;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (c.maxX < sx0 || c.minX > sx1 || c.maxZ < sz0 || c.minZ > sz1) continue;
      if (bandSkip(c, feetY, headY)) continue;
      const f = frame(c);
      const hw = f.hw, hd = f.hd, co = f.co, si = f.si;
      const r0x = ax - f.ox, r0z = az - f.oz;
      const l0x = r0x * co - r0z * si, l0z = r0x * si + r0z * co;
      const ddx = vx * co - vz * si, ddz = vx * si + vz * co;
      let qx = l0x < -hw ? -hw : (l0x > hw ? hw : l0x);
      let qz = l0z < -hd ? -hd : (l0z > hd ? hd : l0z);
      let ex = l0x - qx, ez = l0z - qz;
      const s2 = ex * ex + ez * ez;
      let t, nlx, nlz;
      if (s2 < r * r && r - Math.sqrt(s2) > 1e-5) {
        // overlapping at the start
        if (s2 < 1e-10) continue;                        // centre inside: collide()'s job
        if (ex * ddx + ez * ddz >= 0) continue;          // leaving (or sliding along) it
        const s = Math.sqrt(s2);
        t = 0; nlx = ex / s; nlz = ez / s;
      } else {
        t = rayRect(l0x, l0z, ddx, ddz, hw + r, hd);
        let u = rayRect(l0x, l0z, ddx, ddz, hw, hd + r); if (u < t) t = u;
        u = rayDisc(l0x, l0z, ddx, ddz, -hw, -hd, r); if (u < t) t = u;
        u = rayDisc(l0x, l0z, ddx, ddz, hw, -hd, r); if (u < t) t = u;
        u = rayDisc(l0x, l0z, ddx, ddz, -hw, hd, r); if (u < t) t = u;
        u = rayDisc(l0x, l0z, ddx, ddz, hw, hd, r); if (u < t) t = u;
        if (!(t < bestT)) continue;
        // the contact normal: from the box to the disc centre at contact
        const px = l0x + ddx * t, pz = l0z + ddz * t;
        qx = px < -hw ? -hw : (px > hw ? hw : px);
        qz = pz < -hd ? -hd : (pz > hd ? hd : pz);
        ex = px - qx; ez = pz - qz;
        const nl = Math.sqrt(ex * ex + ez * ez);
        if (nl < 1e-9) continue;
        nlx = ex / nl; nlz = ez / nl;
        if (ddx * nlx + ddz * nlz >= 0) continue;        // grazing / leaving
      }
      if (!(t < bestT)) continue;
      bestT = t; bestC = c;
      bnx = nlx * co + nlz * si; bnz = -nlx * si + nlz * co;
    }
    if (!bestC) return false;
    const tb = Math.max(0, bestT - SW_SKIN / Math.sqrt(len2));
    out.hit = true; out.t = bestT; out.c = bestC;
    out.x = ax + vx * tb; out.z = az + vz * tb; out.nx = bnx; out.nz = bnz;
    return true;
  };
  if (!CBZ.sweepCircle) CBZ.sweepCircle = micro.sweepCircle;

  /* ---- THE RAY — physics.js's CBZ.rayColliders, same contract.
       micro.rayColliders(ox,oy,oz, dx,dy,dz, maxT, out?, opts?) -> record|null
         ray o + d*t, t in [0, maxT], t in units of |d| (b-a with maxT 1 is
         the segment a->b); x/z on the record's own axes, y on its band
         (unbanded = opts.y0..y1, default unbounded).
         out   {hit, c, t, x,y,z, nx,ny,nz}: nearest entry, the unit outward
               normal of the face entered.
         opts  {any, inside, minT, noCam, skip, filter, y0, y1}
               any    first hit met, not the nearest (LOS "blocked?")
               inside a record CONTAINING the origin hits at t=0, normal -d
                      (default: skipped, it has no entry face)
               minT   entries nearer than this are ignored
               noCam  skip records flagged noCam
               skip   one record to ignore (the caller's own)
               filter fn(c) -> false ignores c
         On a slice page noBlock records also never block (the ordnance
         flag); physics.js has no such records. */
  const RAYHIT = { hit: false, c: null, t: 0, x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0 };
  const NO_OPTS = {};
  const _ry = [];
  micro.rayColliders = function (ox, oy, oz, dx, dy, dz, maxT, out, opts) {
    out = out || RAYHIT;
    opts = opts || NO_OPTS;
    out.hit = false; out.c = null; out.t = maxT;
    out.x = ox + dx * maxT; out.y = oy + dy * maxT; out.z = oz + dz * maxT;
    out.nx = 0; out.ny = 0; out.nz = 0;
    if (!(maxT > 0)) return null;
    const any = !!opts.any, inside = !!opts.inside, minT = opts.minT || 0;
    const noCam = !!opts.noCam, skip = opts.skip || null, filter = opts.filter || null;
    const y0d = opts.y0 != null ? opts.y0 : -1e9, y1d = opts.y1 != null ? opts.y1 : 1e9;
    const ex = ox + dx * maxT, ez = oz + dz * maxT;
    const list = gatherSegment(ox, oz, ex, ez, 0.01, _ry);
    const sx0 = Math.min(ox, ex), sx1 = Math.max(ox, ex), sz0 = Math.min(oz, ez), sz1 = Math.max(oz, ez);
    let best = maxT, bc = null, bax = -1, bsg = 0, bco = 1, bsi = 0, bIn = false;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (c.maxX < sx0 || c.minX > sx1 || c.maxZ < sz0 || c.minZ > sz1) continue;
      if (c === skip || c.noBlock || (noCam && c.noCam)) continue;
      const f = frame(c);
      const rx = ox - f.ox, rz = oz - f.oz;
      const lox = rx * f.co - rz * f.si, loz = rx * f.si + rz * f.co;
      const ldx = dx * f.co - dz * f.si, ldz = dx * f.si + dz * f.co;
      const y0 = c.y0 != null ? c.y0 : y0d, y1 = c.y1 != null ? c.y1 : y1d;
      let t0 = -Infinity, t1 = best, ax = -1, sg = 0, a, b, s;
      if (ldx > -1e-12 && ldx < 1e-12) { if (!(lox >= -f.hw && lox <= f.hw)) continue; }
      else {
        a = (-f.hw - lox) / ldx; b = (f.hw - lox) / ldx; if (a > b) { s = a; a = b; b = s; }
        if (a > t0) { t0 = a; ax = 0; sg = ldx > 0 ? -1 : 1; } if (b < t1) t1 = b;
        if (t0 > t1) continue;
      }
      if (dy > -1e-12 && dy < 1e-12) { if (!(oy >= y0 && oy <= y1)) continue; }
      else {
        a = (y0 - oy) / dy; b = (y1 - oy) / dy; if (a > b) { s = a; a = b; b = s; }
        if (a > t0) { t0 = a; ax = 1; sg = dy > 0 ? -1 : 1; } if (b < t1) t1 = b;
        if (t0 > t1) continue;
      }
      if (ldz > -1e-12 && ldz < 1e-12) { if (!(loz >= -f.hd && loz <= f.hd)) continue; }
      else {
        a = (-f.hd - loz) / ldz; b = (f.hd - loz) / ldz; if (a > b) { s = a; a = b; b = s; }
        if (a > t0) { t0 = a; ax = 2; sg = ldz > 0 ? -1 : 1; } if (b < t1) t1 = b;
        if (t0 > t1) continue;
      }
      if (t1 < 0) continue;
      if (t0 < 0 || ax < 0) {                            // origin inside
        if (!inside) continue;
        if (filter && filter(c) === false) continue;
        best = 0; bc = c; bIn = true;
        break;                                           // nothing is nearer than t=0
      }
      if (t0 < minT || t0 >= best) continue;
      if (filter && filter(c) === false) continue;
      best = t0; bc = c; bax = ax; bsg = sg; bco = f.co; bsi = f.si; bIn = false;
      if (any) break;
    }
    if (!bc) return null;
    out.hit = true; out.c = bc; out.t = best;
    out.x = ox + dx * best; out.y = oy + dy * best; out.z = oz + dz * best;
    if (bIn) {
      const l = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      out.nx = -dx / l; out.ny = -dy / l; out.nz = -dz / l;
    } else {
      const lnx = bax === 0 ? bsg : 0, lnz = bax === 2 ? bsg : 0;
      out.nx = lnx * bco + lnz * bsi; out.ny = bax === 1 ? bsg : 0; out.nz = -lnx * bsi + lnz * bco;
    }
    return bc;
  };
  if (!CBZ.rayColliders) CBZ.rayColliders = micro.rayColliders;

  // Does a straight line from a to b clear every collider? The one honest
  // answer to "can the blast see me" and "can that shot land" — used by
  // systems/ordnance.js for cover attenuation. EXACT, not sampled (a sampler
  // steps over the 1.3 m shelter roof that is the whole cover rule), and now
  // exact against a turned box too. An endpoint INSIDE a box counts as
  // blocked (a man inside the bunker is behind its walls), as it always has.
  const _segOut = { hit: false, c: null, t: 0, x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0 };
  const SEG_OPTS = { any: true, inside: true };
  micro.segmentBlocked = function (ax, ay, az, bx, by, bz) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    if (dx * dx + dy * dy + dz * dz < 1e-6) return false;
    return micro.rayColliders(ax, ay, az, dx, dy, dz, 1, _segOut, SEG_OPTS) !== null;
  };

  // physics.js's early-out segment walk: hit(c) is asked of every record whose
  // AABB meets the (pad-widened) segment's box, first true wins.
  const _shc = [];
  micro.segmentHitsCollider = function (ax, az, bx, bz, pad, hit) {
    pad = pad || 0;
    const list = gatherSegment(ax, az, bx, bz, pad, _shc);
    const minX = Math.min(ax, bx) - pad, maxX = Math.max(ax, bx) + pad;
    const minZ = Math.min(az, bz) - pad, maxZ = Math.max(az, bz) + pad;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (c.maxX < minX || c.minX > maxX || c.maxZ < minZ || c.minZ > maxZ) continue;
      if (hit(c)) return true;
    }
    return false;
  };
  if (!CBZ.segmentHitsCollider) CBZ.segmentHitsCollider = micro.segmentHitsCollider;
  // the name every shared verb in the engine asks by (physics.js's own)
  if (!CBZ.queryCollidersNear) CBZ.queryCollidersNear = function (x, z, r, out) { return micro.queryColliders(x, z, r, out); };

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
