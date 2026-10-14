/* ============================================================
   lab/labworld.js — THE LAB: a tiny REAL world made of chosen ingredients,
   running the real game systems, booted in about a second.

   lab.html?kit=person-chair&seed=3&...   (src/lab/kits/<kit>.js)

   index.html is ~729 classic scripts that talk only through CBZ.* globals, so
   no system loads alone. The lab loads the PRELUDE (three, the real
   config.js, seed.js, microboot as the fallback floor, this file), then the
   kit and its ingredients, then exactly the scripts the kit's entries need:
   the ordered closure tools/lab/deps.mjs traced into src/lab/deps.json,
   resolved HERE in the page by src/lab/closure.js. Then core/loop.js, last,
   as index.html does (it sorts the frame registry and owns CBZ.stepSim).

   WHAT THIS FILE STANDS IN FOR (and nothing else). The full game makes these
   in core/scene.js, core/renderer.js, core/lights.js, core/sky.js; those files
   build the prison/city look and pull a world with them. Here:
     CBZ.scene, CBZ.camera, CBZ.renderer, CBZ.canvas   one canvas, one camera
     sky + sun + hemi                                  microboot's rig
     the ground                                        a flat studio floor at
                                                       y = 0, which is the
                                                       engine's own default
                                                       ground (physics.js
                                                       groundAt answers 0 with
                                                       no platform), drawn
   Every symbol assigned below is PROVIDED to the tracer (it reads this file):
   the closure never pulls core/scene.js for CBZ.scene. Everything else is the
   real engine file or it is not on the page.

   DETERMINISM. Fixed dt (default 1/60, ?dt=), a seed (?seed=, default 1)
   that drives CBZ.WORLD_SEED, the brain's stream and Math.random (the LAB's
   own page only: a seeded generator is installed before any engine file
   loads, so dice-rolling systems replay). Time moves only through
   __lab.step(n) / __lab.run(seconds); rAF never drives the sim.

   window.__lab
     ready / error            boot state (await __lab.whenReady)
     boot                     { ms, scripts, traced, perPhase, loadErrors }
     step(n) / run(seconds)   advance the sim (kit script fires on its times)
     state()                  every ingredient's readout + the event log
     events()                 [{t, who, what}] (posture/brain/contact changes)
     probe()                  the kit's verdict { ok, summary, data }
     capture(cam, w, h, mime) one frame as a dataURL (cams below)
     cams                     3q | side | front | back | top | wide | close |
                              follow:<name> | orbit:<yaw>:<pitch>[:distMul] |
                              at:<x,y,z>:<lx,ly,lz>
============================================================ */
(function () {
  "use strict";
  const W0 = window;
  const CBZ = (W0.CBZ = W0.CBZ || {});
  const THREE = W0.THREE;
  const L = (CBZ.lab = CBZ.lab || {});
  const T0 = performance.now();
  const Q = new URLSearchParams(location.search);
  const params = {};
  Q.forEach(function (v, k) { params[k] = v; });
  L.params = params;
  L.kitName = params.kit || "empty";
  L.seed = params.seed != null ? (+params.seed | 0) : 1;
  L.dt = params.dt ? +params.dt : 1 / 60;
  L.t = 0;
  L.ready = false;
  L.error = null;
  const loadErrors = [];
  L.loadErrors = loadErrors;

  // the same lists as tools/lab/deps.mjs PRELUDE / POSTLUDE (kept in step by
  // tools/lab/check.mjs, which fails if they drift)
  L.PRELUDE = ["src/vendor/three.r128.min.js", "src/config.js", "src/core/seed.js", "src/core/microboot.js",
    "src/lab/closure.js", "src/lab/registry.js", "src/lab/labworld.js"];
  L.PRELUDE_PROVIDERS = ["src/config.js", "src/core/seed.js", "src/lab/labworld.js"];
  L.POSTLUDE = ["src/core/loop.js"];

  /* ---- a seeded Math.random, before any engine file rolls a die ---------- */
  let rs = (0x9e3779b9 ^ Math.imul(L.seed + 1, 0x85ebca6b)) >>> 0;
  function rand() {
    rs = (rs + 0x6D2B79F5) >>> 0;
    let t = rs;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  Math.random = rand;
  L.rand = rand;
  CBZ.WORLD_SEED = 90210 + L.seed;

  /* ---- the game state the engine expects: live, in the kit's mode -------- */
  const g = CBZ.game || (CBZ.game = {});
  g.state = "playing";
  g.paused = false;
  CBZ.LAB = true;

  /* ---- what the lab stands in for (PROVIDED to the tracer) --------------- */
  const canvas = document.createElement("canvas");
  canvas.id = "labCanvas";
  canvas.style.cssText = "position:fixed;inset:0;width:100%;height:100%;display:block;";
  (document.getElementById("game") || document.body).appendChild(canvas);
  CBZ.canvas = canvas;
  CBZ.scene = CBZ.scene || new THREE.Scene();
  CBZ.camera = new THREE.PerspectiveCamera(50, 16 / 10, 0.05, 3000);
  CBZ.camera.position.set(6, 4, 8);
  CBZ.camera.lookAt(0, 1, 0);
  CBZ.scene.add(CBZ.camera);
  /* THE CAMERA RIG RECORD. systems/camera.js owns CBZ.cam in the game (the
     third-person boom, 2.4k lines of follow/occlusion/aim). The lab frames
     its own shots, so only the record the player's physics reads is here:
     physics.js walks W along (-sin yaw, -cos yaw). ingredients/player.js
     steers by writing cam.yaw. */
  CBZ.cam = { yaw: 0, pitch: 0.3, dist: 4.5, lab: true };
  /* THE RENDERER IS LAZY. Creating a WebGL context under SwiftShader on a
     loaded box measured 3.8 s, ten times everything else in a boot, and a
     probe that only reads numbers never draws. So CBZ.renderer is a getter:
     the first thing that touches it (a capture, ?live=1, an engine file that
     really needs it) pays for the context, once. ?gl=1 makes it eager. */
  let renderer = null, glTried = false;
  function ensureRenderer() {
    if (renderer || glTried) return renderer;
    glTried = true;
    const tGL = performance.now();
    try {
      renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, preserveDrawingBuffer: true, powerPreference: "high-performance", stencil: false });
      renderer.setPixelRatio(1);
      renderer.setSize(640, 400, false);
      renderer.outputEncoding = THREE.sRGBEncoding;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    } catch (e) { loadErrors.push("renderer: " + (e && e.message)); }
    L.glMs = Math.round(performance.now() - tGL);
    return renderer;
  }
  Object.defineProperty(CBZ, "renderer", {
    configurable: true, enumerable: true,
    get: ensureRenderer,
    set: function (v) { renderer = v; glTried = true; },
  });
  L.renderer = ensureRenderer;
  CBZ.labWorld = L;

  /* ---- load errors, per file ---------------------------------------------- */
  W0.addEventListener("error", function (ev) {
    const f = (ev.filename || "").replace(location.origin + "/", "").split("?")[0];
    loadErrors.push((f || "?") + ":" + (ev.lineno || 0) + " " + String(ev.message || "").slice(0, 200));
  });

  function addScript(src) {
    return new Promise(function (res) {
      const s = document.createElement("script");
      s.src = src + (L.bust ? "?v=" + L.bust : "");
      s.async = false;
      s.onload = function () { res(true); };
      s.onerror = function () { loadErrors.push(src + ": 404 / load failed"); res(false); };
      document.head.appendChild(s);
    });
  }
  // many at once, executed in order (async=false keeps document order) — the
  // browser fetches them in parallel, which is most of why the lab is fast
  function addScripts(list) { return Promise.all(list.map(addScript)); }
  L.bust = params.v || "";

  /* ======================================================================
     THE WORLD API kits build with (W)
     ====================================================================== */
  const W = { P: null, handles: [], byName: Object.create(null), log: [], hooks: [], timeline: [], watches: [] };
  L.W = W;
  W.t = function () { return L.t; };
  W.event = function (who, what, data) {
    const e = { t: +L.t.toFixed(3), who: who, what: what };
    if (data !== undefined) e.data = data;
    W.log.push(e);
    if (W.log.length > 2000) W.log.shift();
    return e;
  };
  W.add = function (type, opts) {
    const d = L.registry.ingredients[type];
    if (!d) throw new Error("lab: no ingredient '" + type + "'");
    opts = opts || {};
    const name = opts.name || (type + (W.handles.filter(function (h) { return h.type === type; }).length + 1));
    const h = d.make(W, Object.assign({}, opts, { name: name })) || {};
    h.type = type; h.name = name;
    W.handles.push(h); W.byName[name] = h;
    if (h.watch) Object.keys(h.watch).forEach(function (k) { W.watch(name, k, h.watch[k]); });
    return h;
  };
  W.get = function (name) { return W.byName[name] || null; };
  // a sampled value: an event is logged every time it changes
  W.watch = function (who, what, fn) { W.watches.push({ who: who, what: what, fn: fn, last: undefined }); };
  W.every = function (fn) { W.hooks.push(fn); return fn; };
  W.at = function (t, fn, label) { W.timeline.push({ t: +t, fn: fn, label: label || "", done: false }); W.timeline.sort(function (a, b) { return a.t - b.t; }); };
  W.scene = CBZ.scene;
  W.v3 = function (a) { return Array.isArray(a) ? new THREE.Vector3(a[0], a[1] || 0, a[2] || 0) : a; };
  // the subjects a camera frames: every handle's object (or opts.subjects)
  W.subjects = function () {
    const out = [];
    W.handles.forEach(function (h) { if (h.obj && !h.noFrame) out.push(h.obj); });
    return out;
  };

  function sampleWatches() {
    for (let i = 0; i < W.watches.length; i++) {
      const w = W.watches[i];
      let v;
      try { v = w.fn(); } catch (e) { v = "error: " + (e && e.message); }
      const s = v && typeof v === "object" ? JSON.stringify(v) : v;
      if (s !== w.last) {
        if (w.last !== undefined || (v != null && v !== false && v !== "")) W.event(w.who, w.what + ": " + (s == null ? "-" : s));
        w.last = s;
      }
    }
  }

  /* ======================================================================
     STEPPING
     ====================================================================== */
  function fireTimeline() {
    for (let i = 0; i < W.timeline.length; i++) {
      const a = W.timeline[i];
      if (a.done || a.t > L.t + 1e-9) continue;
      a.done = true;
      try { a.fn(W); if (a.label) W.event("script", a.label); }
      catch (e) { W.event("script", "THREW " + (a.label || "") + ": " + (e && e.message)); console.error("[lab script]", e); }
    }
  }
  function stepOnce() {
    fireTimeline();
    CBZ.stepSim(L.dt);
    L.t += L.dt;
    for (let i = 0; i < W.hooks.length; i++) {
      try { W.hooks[i](L.dt, W); } catch (e) { console.error("[lab hook]", e); }
    }
    sampleWatches();
    const c = CBZ.camera;
    if (c) { c.updateMatrixWorld(true); c.matrixWorldInverse.copy(c.matrixWorld).invert(); }
  }
  L.step = function (n) {
    if (!L.ready) throw new Error("lab not ready" + (L.error ? ": " + L.error : ""));
    n = Math.max(0, n | 0);
    for (let k = 0; k < n; k++) stepOnce();
    return +L.t.toFixed(4);
  };
  L.run = function (seconds) { return L.step(Math.round(seconds / L.dt)); };
  L.runTo = function (t) { return L.step(Math.max(0, Math.round((t - L.t) / L.dt))); };

  /* ======================================================================
     READOUTS
     ====================================================================== */
  function round(v) { return Math.round(v * 1000) / 1000; }
  L.round = round;
  L.vec = function (v) { return v ? [round(v.x), round(v.y), round(v.z)] : null; };
  L.state = function () {
    const out = { kit: L.kitName, t: round(L.t), seed: L.seed, mode: g.mode, actors: {} };
    W.handles.forEach(function (h) {
      let s = null;
      try { s = h.state ? h.state() : null; } catch (e) { s = { error: String(e && e.message) }; }
      out.actors[h.name] = Object.assign({ type: h.type }, s || {});
    });
    out.events = W.log.length;
    return out;
  };
  L.events = function (since) { return W.log.filter(function (e) { return since == null || e.t >= since; }); };
  L.probe = function () {
    const k = L.kit;
    let r = null;
    try { r = k && k.probe ? k.probe(W, W.P) : { ok: true, summary: "no probe for kit " + L.kitName }; }
    catch (e) { r = { ok: false, summary: "probe threw: " + (e && e.message) }; }
    r = r || { ok: false, summary: "probe returned nothing" };
    r.t = round(L.t);
    r.events = W.log.slice(0, 400);
    r.state = L.state();
    r.boot = L.boot;
    r.errors = L.runtimeErrors.slice(0, 20);
    return r;
  };
  L.runtimeErrors = [];
  const _ce = console.error;
  console.error = function () {
    try { if (L.ready) L.runtimeErrors.push(Array.prototype.map.call(arguments, function (a) { return a && a.stack ? String(a.stack).split("\n").slice(0, 2).join(" ") : String(a); }).join(" ").slice(0, 300)); } catch (e) {}
    return _ce.apply(console, arguments);
  };

  /* ======================================================================
     CAMERAS + CAPTURE
     ====================================================================== */
  const _box = new THREE.Box3(), _b2 = new THREE.Box3(), _c = new THREE.Vector3(), _s = new THREE.Vector3();
  function boundsOf(list) {
    _box.makeEmpty();
    list.forEach(function (o) { if (!o) return; o.updateMatrixWorld(true); _b2.setFromObject(o); if (!_b2.isEmpty()) _box.union(_b2); });
    if (_box.isEmpty()) _box.set(new THREE.Vector3(-1, 0, -1), new THREE.Vector3(1, 2, 1));
    return _box;
  }
  L.aim = function (cam) {
    const c = CBZ.camera;
    cam = String(cam || "3q");
    let m;
    if ((m = /^at:([-\d.]+),([-\d.]+),([-\d.]+):([-\d.]+),([-\d.]+),([-\d.]+)$/.exec(cam))) {
      c.position.set(+m[1], +m[2], +m[3]); c.lookAt(+m[4], +m[5], +m[6]);
    } else {
      let subj = W.subjects();
      if ((m = /^follow:(\w[\w-]*)/.exec(cam))) { const h = W.get(m[1]); if (h && h.obj) subj = [h.obj]; cam = "3q"; }
      const kitCam = L.kit && L.kit.frame ? L.kit.frame(W) : null;
      if (kitCam && !/^follow:/.test(String(cam))) subj = kitCam;
      const b = boundsOf(subj);
      b.getCenter(_c); b.getSize(_s);
      const r = Math.max(1.2, 0.5 * Math.hypot(_s.x, _s.y, _s.z));
      let yaw = 35, pitch = 22, mul = 1;
      const T = { "3q": [35, 22], side: [90, 8], front: [0, 8], back: [180, 8], top: [0, 85], wide: [35, 30], close: [25, 12] };
      if (T[cam]) { yaw = T[cam][0]; pitch = T[cam][1]; if (cam === "wide") mul = 1.8; if (cam === "close") mul = 0.6; }
      else if ((m = /^orbit:([-\d.]+):([-\d.]+)(?::([\d.]+))?$/.exec(cam))) { yaw = +m[1]; pitch = +m[2]; mul = m[3] ? +m[3] : 1; }
      const dist = (r / Math.sin((c.fov * Math.PI / 180) / 2)) * 1.05 * mul;
      const yr = yaw * Math.PI / 180, pr = pitch * Math.PI / 180;
      c.position.set(_c.x + Math.sin(yr) * Math.cos(pr) * dist, _c.y + Math.sin(pr) * dist, _c.z + Math.cos(yr) * Math.cos(pr) * dist);
      c.lookAt(_c);
    }
    c.updateMatrixWorld(true);
    return true;
  };
  L.capture = function (cam, w, h, mime) {
    const renderer = ensureRenderer();
    if (!renderer) return { error: "no WebGL renderer" };
    w = w || 640; h = h || 400;
    renderer.setSize(w, h, false);
    CBZ.camera.aspect = w / h; CBZ.camera.updateProjectionMatrix();
    L.aim(cam);
    try { renderer.render(CBZ.scene, CBZ.camera); } catch (e) { return { error: "render: " + e.message }; }
    return { url: canvas.toDataURL(mime || "image/png", 0.86) };
  };

  /* ======================================================================
     THE STAGE: sky, lights, floor. microboot's rig, the engine's y = 0.
     ====================================================================== */
  function buildStage(P) {
    // microboot's sky dome + sun/hemi (published as CBZ.sun / CBZ.hemi), not
    // micro.boot(): that would make the renderer, which stays lazy
    const M = CBZ.micro;
    try {
      if (M && M.sky) M.sky({ top: 0x6f93b8, bottom: 0xcfd6dc, fogNear: 120, fogFar: 900 });
      if (M && M.lights) {
        const sun = M.lights({ shadowSpan: 30, shadowMap: 1024, sunDist: 60 });
        if (sun && sun.target) sun.target.position.set(0, 0, 0);
      }
    } catch (e) { loadErrors.push("stage: " + e.message); }
    const size = +P.floor || 120;
    const cv = document.createElement("canvas");
    cv.width = cv.height = 256;
    const x = cv.getContext("2d");
    x.fillStyle = "#8d9196"; x.fillRect(0, 0, 256, 256);
    x.strokeStyle = "#7c8085"; x.lineWidth = 2;
    for (let i = 0; i <= 256; i += 32) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, 256); x.stroke(); x.beginPath(); x.moveTo(0, i); x.lineTo(256, i); x.stroke(); }
    const tex = new THREE.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(size / 8, size / 8);
    tex.encoding = THREE.sRGBEncoding;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshLambertMaterial({ map: tex }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    floor.name = "labFloor";
    CBZ.scene.add(floor);
    L.floor = floor;
  }

  /* ======================================================================
     BOOT
     ====================================================================== */
  const phase = { prelude: Math.round(T0) };
  function mark(k, t0) { phase[k] = Math.round(performance.now() - t0); }
  L.whenReady = new Promise(function (res) { L._resolveReady = res; });

  async function loadKit(name) {
    const t0 = performance.now();
    await addScript(L.kitFile(name));
    const k = L.registry.kits[name];
    if (!k) throw new Error("no kit '" + name + "' (src/lab/kits/" + name + ".js did not register one)");
    for (let pass = 0; pass < 8; pass++) {
      const want = new Set(k.uses || []);
      Object.keys(L.registry.ingredients).forEach(function (n) { (L.registry.ingredients[n].uses || []).forEach(function (u) { want.add(u); }); });
      const todo = Array.from(want).filter(function (n) { return !L.registry.ingredients[n]; });
      if (!todo.length) break;
      await addScripts(todo.map(L.ingredientFile));
    }
    mark("kit", t0);
    return k;
  }

  async function boot() {
    try {
      const name = L.kitName;
      const k = L.kit = await loadKit(name);
      const P = W.P = Object.assign({}, k.params || {}, params);
      const E = L.entriesFor(name, P);
      // extra entries from the URL: &need=gore,verbs  &file=src/x.js
      if (P.need) E.symbols = E.symbols.concat(String(P.need).split(","));
      if (P.file) E.files = E.files.concat(String(P.file).split(","));
      g.mode = P.mode || E.mode || "lab";
      let t0 = performance.now();
      const man = await (await fetch("src/lab/deps.json" + (L.bust ? "?v=" + L.bust : ""), { cache: "no-store" })).json();
      mark("manifest", t0);
      t0 = performance.now();
      const provided = new Set(L.MICRO_PROVIDES || []);
      man.files.forEach(function (r) {
        if (L.PRELUDE_PROVIDERS.indexOf(r.f) >= 0 || L.POSTLUDE.indexOf(r.f) >= 0) {
          (r.d || []).forEach(function (s) { provided.add(s); }); (r.s || []).forEach(function (s) { provided.add(s); });
        }
      });
      const res = CBZ.labClosure.resolve(man, {
        files: E.files, symbols: E.symbols, provided: Array.from(provided),
        depth: P.depth != null ? (P.depth === "inf" ? Infinity : +P.depth) : E.depth,
        skip: (E.skip || []).concat(L.PRELUDE, L.POSTLUDE),
      });
      mark("resolve", t0);
      L.closure = res;
      t0 = performance.now();
      await addScripts(res.files.concat(L.POSTLUDE));
      mark("scripts", t0);
      t0 = performance.now();
      buildStage(P);
      if (CBZ.brain && CBZ.brain.seed) CBZ.brain.seed(L.seed);
      // live from here on: what the engine's play state reads
      g.state = "playing";
      /* THE OBSERVER. Several engine systems are player-centred (pushables
         sweeps the props within 8 m of CBZ.player; LOD, hearing and sight
         read his position). A kit without the "player" ingredient gets a
         body-less observer record at the origin so those systems still run.
         Assigned by computed key ON PURPOSE: it is a fallback, not a
         provision, so the tracer must not count it (a kit that reads
         CBZ.player for real still pulls entities/player.js). */
      const PK = "player";
      if (!CBZ[PK]) CBZ[PK] = { pos: new THREE.Vector3(+P.obsX || 0, 0, +P.obsZ || 0), vel: new THREE.Vector3(), radius: 0.55, hp: 100, moveX: 0, moveZ: 0, speed: 0, grounded: true, observer: true };
      if (k.setup) k.setup(W, P);
      // the kit's script: [[t, fn, label], ...]
      const sc = typeof k.script === "function" ? k.script(W, P) : (k.script || []);
      sc.forEach(function (a) { W.at(a[0], a[1], a[2]); });
      // sort the frame registry the way core/loop.js does at load: everything
      // the setup registered is "parse-time" work for this world
      const bySeq = function (a, b) { return (a.order - b.order) || ((a.seq || 0) - (b.seq || 0)); };
      if (CBZ.updaters) CBZ.updaters.sort(bySeq);
      if (CBZ.always) CBZ.always.sort(bySeq);
      mark("setup", t0);
      L.boot = {
        ms: Math.round(performance.now() - T0),
        sincePageStart: Math.round(performance.now()),
        scripts: L.PRELUDE.length + res.files.length + L.POSTLUDE.length + 1 + L.ingredientsOf(k).length,
        traced: res.files.length,
        indexCount: man.indexCount,
        missing: res.missing,
        files: res.files,
        phases: phase,
        loadErrors: loadErrors.slice(),
        mode: g.mode,
        webgl: params.gl === "1" ? (ensureRenderer() ? L.glMs + " ms" : "failed") : (renderer ? "made by an engine file (" + L.glMs + " ms)" : "lazy"),
      };
      sampleWatches();
      L.ready = true;
      document.title = "Lab · " + name;
      hud();
    } catch (e) {
      L.error = String(e && e.stack || e).slice(0, 800);
      console.error("[lab boot]", e);
      L.boot = { ms: Math.round(performance.now() - T0), error: L.error, loadErrors: loadErrors.slice(), phases: phase };
    }
    L._resolveReady(L.ready);
  }

  /* ---- a tiny HUD, and live play when a person opens lab.html by hand ---- */
  function hud() {
    const el = document.getElementById("labHud");
    if (!el) return;
    const b = L.boot;
    el.textContent = "lab: " + L.kitName + " · " + b.scripts + " scripts of " + b.indexCount + " · boot " + b.ms + " ms" +
      (b.loadErrors.length ? " · " + b.loadErrors.length + " load errors" : "");
    if (params.live === "1") {
      // watch it run at real time (still the fixed-dt stepper)
      let acc = 0, last = performance.now();
      (function frame(now) {
        acc += Math.min(0.25, (now - last) / 1000); last = now;
        while (acc >= L.dt) { stepOnce(); acc -= L.dt; }
        const r = ensureRenderer();
        if (r) {
          r.setSize(innerWidth, innerHeight, false);
          CBZ.camera.aspect = innerWidth / Math.max(1, innerHeight); CBZ.camera.updateProjectionMatrix();
          L.aim(params.cam || "3q");
          try { r.render(CBZ.scene, CBZ.camera); } catch (e) {}
        }
        requestAnimationFrame(frame);
      })(performance.now());
    } else if (params.gl === "1" && ensureRenderer()) {
      L.aim(params.cam || "3q");
      try { renderer.render(CBZ.scene, CBZ.camera); } catch (e) {}
    }
  }

  W0.__lab = L;
  // after this file's tag has run (registry.js is already loaded above us)
  setTimeout(boot, 0);
})();
