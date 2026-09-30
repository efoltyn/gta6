/* ============================================================
   race/race_game.js — THE RACE: renderer, sky, input, cameras, HUD,
   the grid → lights → laps → flag → standings loop, and the restart.

   It owns no physics, no car model, no stadium and no race rules. It wires:
     race_core     the circuit (frame, surface, grid, pit)
     race_session  the rules: grid, lights, laps, flag, standings (shared
                   with Gang City's Bullring, city/speedway_race.js)
     race_physics  every car's dynamics, walls and contact
     race_ai       the nine other drivers
     race_car      the car you see (and the cockpit you sit in)
     race_track    racing surface, walls, fence, tyre marks
     race_venue    stands + crowd, pit road, gantry lights, pylon
     race_audio    the engine you hear

   This page is the dev/test bench for the racing modules. In Gang City the
   race is run in the world itself: your own character walks into the
   Bullring and gets into a car with F (city/speedway_race.js), on the same
   circuit, cars, drivers and rules as here.

   URL: ?laps=N  ?q=low|high  ?cam=cockpit  ?auto=1 (you drive as an AI
   too; a demo/attract mode)  ?go=1 (skip the tap-to-race card).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ = window.CBZ || {};
  const R = CBZ.race = CBZ.race || {};
  const THREE = window.THREE;
  const core = R.core, PH = R.physics, AI = R.ai;
  const Q = new URLSearchParams(location.search);

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const $ = (id) => document.getElementById(id);

  // ---- who and how many -------------------------------------------------------
  const PLAYER_SLOT = 5;                       // row 3, outside: you start mid-pack and race forward
  const LAPS = clamp(+Q.get("laps") || 8, 1, 60);
  const TOUCH = ("ontouchstart" in window) || navigator.maxTouchPoints > 0;
  const QUALITY = Q.get("q") || (TOUCH || Math.min(screen.width, screen.height) < 700 ? "low" : "high");
  const AUTO = Q.get("auto") === "1";
  // the miles-per-hour readout (1 m/s = 2.23694 mph), the same number Gang City's gauges show
  const MPH = 2.2369362920544;

  // ---- renderer, scene, sky -------------------------------------------------
  const renderer = new THREE.WebGLRenderer({ antialias: QUALITY === "high", powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, QUALITY === "high" ? 2 : 1.5));
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  $("stage").appendChild(renderer.domElement);
  CBZ.renderer = renderer;                      // tools/speed.mjs reads the one renderer here

  const scene = new THREE.Scene();
  const FOG = new THREE.Color(0x1b2233);
  scene.fog = new THREE.Fog(FOG, 260, 900);
  scene.background = FOG;

  /* A NIGHT RACE UNDER THE LIGHTS. The sky is a dome with the last of the
     dusk low in the west and the town's glow all round the rim; the stadium
     lamps do the rest. Stars are one Points draw. */
  (function sky() {
    const g = new THREE.SphereGeometry(1400, 32, 16);
    const m = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {},
      vertexShader: "varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
      fragmentShader: [
        "varying vec3 vP;",
        "void main(){",
        "  float h = clamp(vP.y, -0.2, 1.0);",
        "  vec3 top = vec3(0.012, 0.018, 0.045);",
        "  vec3 mid = vec3(0.045, 0.06, 0.12);",
        "  vec3 rim = vec3(0.16, 0.15, 0.2);",
        "  vec3 c = mix(rim, mid, smoothstep(0.0, 0.12, h));",
        "  c = mix(c, top, smoothstep(0.12, 0.7, h));",
        // the last of the dusk, low in the west (-x)
        "  float w = max(0.0, dot(normalize(vec3(vP.x, 0.0, vP.z)), vec3(-0.85, 0.0, 0.52)));",
        "  c += vec3(0.42, 0.16, 0.06) * pow(w, 6.0) * (1.0 - smoothstep(0.0, 0.22, h));",
        "  gl_FragColor = vec4(c, 1.0);",
        "}",
      ].join("\n"),
    });
    const dome = new THREE.Mesh(g, m);
    dome.renderOrder = -10; dome.frustumCulled = false;
    scene.add(dome);
    const N = QUALITY === "high" ? 1400 : 600, p = new Float32Array(N * 3);
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < N; i++) {
      const a = rnd() * Math.PI * 2, y = 0.12 + rnd() * 0.88, r = Math.sqrt(1 - y * y);
      p[i * 3] = Math.cos(a) * r * 1300; p[i * 3 + 1] = y * 1300; p[i * 3 + 2] = Math.sin(a) * r * 1300;
    }
    const sg = new THREE.BufferGeometry(); sg.setAttribute("position", new THREE.BufferAttribute(p, 3));
    const stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0x9fb0d0, size: 1.6, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.8, depthWrite: false }));
    stars.frustumCulled = false; stars.renderOrder = -9;
    scene.add(stars);
  })();

  // the light: a cool sky fill, a warm bounce off the infield, and the lamp
  // banks as one high key over the track (no shadow maps: the car ships its
  // own contact shade)
  scene.add(new THREE.HemisphereLight(0x9fb4d8, 0x3b3226, 0.85));
  const key = new THREE.DirectionalLight(0xfff1dc, 1.35);
  key.position.set(60, 180, 90);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x8fa8ff, 0.35);
  rim.position.set(-120, 60, -140);
  scene.add(rim);

  const camera = new THREE.PerspectiveCamera(62, 1, 0.08, 2000);
  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = w + "px"; renderer.domElement.style.height = h + "px";
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  window.addEventListener("resize", resize); resize();

  // ---- the place ----------------------------------------------------------------
  const track = R.track.build(THREE, core, { quality: QUALITY });
  scene.add(track.group);
  const venue = R.venue.build(THREE, core, { quality: QUALITY });
  scene.add(venue.group);
  const fx = R.car.createFx(THREE, scene, { quality: QUALITY });

  // ---- the field: the rules are race_session.js (shared with Gang City's Bullring) ----
  const hudFlash = { fn: null };
  const SES = R.session.create({
    field: 10, laps: LAPS, playerSlot: PLAYER_SLOT, playerNumber: 17, auto: AUTO, coolPlayer: true,
    on: {
      lights(n, green) { venue.setLights(n, green); hudLights(n, green); if (R.audio && (n || green)) R.audio.beep(green); if (green) setTimeout(() => { if (SES.phase === "race") hudLights(0, false); }, 1400); },
      flash(text, kind) { if (hudFlash.fn) hudFlash.fn(text, kind); },
      results() { results(); },
    },
  });
  const liveries = R.car.liveries(SES.field);
  const entries = SES.entries;
  for (const e of entries) {
    e.visual = R.car.build(THREE, { number: e.number, livery: liveries[e.i], player: e.player, quality: QUALITY, fx });
    scene.add(e.visual.group);
  }
  const me = SES.me;
  const bestOf = (e) => (e.car && e.car.bestLap > 0 ? e.car.bestLap : Infinity);

  // ---- input: keyboard, gamepad, touch ----------------------------------------------
  const keys = Object.create(null);
  window.addEventListener("keydown", (ev) => {
    keys[ev.code] = true;
    if (R.audio) R.audio.start();                 // the first key is the gesture audio needs
    if (ev.code === "KeyC") cycleCam();
    if (ev.code === "KeyR" && SES.phase === "done") restart();
    if (ev.code === "Escape" || ev.code === "KeyP") togglePause();
    if (/^Arrow/.test(ev.code) || ev.code === "Space") ev.preventDefault();
  });
  window.addEventListener("keyup", (ev) => { keys[ev.code] = false; });
  window.addEventListener("pointerdown", () => { if (R.audio) R.audio.start(); });
  window.addEventListener("blur", () => { for (const k in keys) keys[k] = false; if (SES.phase === "race") setPause(true); });

  // TOUCH: the left thumb steers (drag from where it lands: a virtual wheel,
  // analog), the right thumb works two pedals. Big targets, no text.
  const touch = { steer: 0, gas: 0, brake: 0, steerId: null, steerX0: 0 };
  function bindPedal(el, field) {
    const on = (ev) => { ev.preventDefault(); touch[field] = 1; el.classList.add("on"); };
    const off = (ev) => { ev.preventDefault(); touch[field] = 0; el.classList.remove("on"); };
    el.addEventListener("touchstart", on, { passive: false });
    el.addEventListener("touchend", off, { passive: false });
    el.addEventListener("touchcancel", off, { passive: false });
    el.addEventListener("mousedown", on); el.addEventListener("mouseup", off); el.addEventListener("mouseleave", off);
  }
  bindPedal($("gas"), "gas");
  bindPedal($("brk"), "brake");
  (function steerPad() {
    const pad = $("steerPad"), knob = $("steerKnob");
    const RANGE = () => Math.min(120, window.innerWidth * 0.16);
    pad.addEventListener("touchstart", (ev) => {
      ev.preventDefault();
      const t = ev.changedTouches[0];
      touch.steerId = t.identifier; touch.steerX0 = t.clientX;
      pad.classList.add("on");
    }, { passive: false });
    pad.addEventListener("touchmove", (ev) => {
      ev.preventDefault();
      for (const t of ev.changedTouches) {
        if (t.identifier !== touch.steerId) continue;
        const d = clamp((t.clientX - touch.steerX0) / RANGE(), -1, 1);
        touch.steer = -d;                                   // drag right = steer right = negative (contract: +1 = LEFT)
        knob.style.transform = "translateX(" + (d * 56).toFixed(0) + "px)";
      }
    }, { passive: false });
    const end = (ev) => {
      for (const t of ev.changedTouches) if (t.identifier === touch.steerId) {
        touch.steerId = null; touch.steer = 0; knob.style.transform = ""; pad.classList.remove("on");
      }
    };
    pad.addEventListener("touchend", end); pad.addEventListener("touchcancel", end);
  })();
  if (TOUCH) document.body.classList.add("touch");

  const input = { steer: 0, throttle: 0, brake: 0 };
  let kbSteer = 0;
  function readInput(dt) {
    let steer = 0, gas = 0, brake = 0;
    const L = keys.ArrowLeft || keys.KeyA, Rt = keys.ArrowRight || keys.KeyD;
    // keyboard steering ramps like a hand on a wheel instead of snapping
    const target = (L ? 1 : 0) - (Rt ? 1 : 0);
    const rate = target === 0 ? 5.5 : (Math.sign(target) !== Math.sign(kbSteer) && kbSteer !== 0 ? 7 : 3.2);
    kbSteer += clamp(target - kbSteer, -rate * dt, rate * dt);
    steer = kbSteer;
    if (keys.ArrowUp || keys.KeyW) gas = 1;
    if (keys.ArrowDown || keys.KeyS || keys.Space) brake = 1;
    if (touch.steerId != null || touch.steer) steer = touch.steer;
    gas = Math.max(gas, touch.gas); brake = Math.max(brake, touch.brake);
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p) continue;
      const ax = p.axes[0] || 0;
      if (Math.abs(ax) > 0.08) steer = -ax;
      if (p.buttons[7]) gas = Math.max(gas, p.buttons[7].value);
      if (p.buttons[6]) brake = Math.max(brake, p.buttons[6].value);
      if (p.buttons[0] && p.buttons[0].pressed) gas = 1;
      if (p.buttons[2] && p.buttons[2].pressed) brake = 1;
      break;
    }
    input.steer = steer;                         // raw: the session applies the steering assist
    input.throttle = gas; input.brake = brake;
    return input;
  }

  // ---- cameras ---------------------------------------------------------------------
  const CAMS = ["chase", "cockpit", "far"];
  let camMode = Q.get("cam") === "cockpit" ? 1 : 0;
  function cycleCam() { camMode = (camMode + 1) % CAMS.length; me.visual.setCockpit(CAMS[camMode] === "cockpit"); }
  $("camBtn").addEventListener("click", cycleCam);
  const camPos = new THREE.Vector3(), camLook = new THREE.Vector3();
  const _v = new THREE.Vector3(), _w = new THREE.Vector3();
  let camInit = false, orbitT = 0;

  function chaseCam(e, dt, far) {
    const c = e.car, sy = Math.sin(c.yaw), cy = Math.cos(c.yaw);
    // follow the velocity a little, not only the nose, so a slide reads as a slide
    const sp = Math.max(1, Math.hypot(c.vel.x, c.vel.z));
    const vx = c.vel.x / sp, vz = c.vel.z / sp, wv = clamp(sp / 30, 0, 0.35);
    const fx_ = lerp(sy, vx, wv), fz_ = lerp(cy, vz, wv);
    const back = far ? 12.5 : 7.4, up = far ? 4.6 : 2.35;
    _v.set(c.pos.x - fx_ * back, c.pos.y + up, c.pos.z - fz_ * back);
    // never inside the wall: clamp the camera to the track side of the fence
    const n = core.nearest(_v.x, _v.z, c.s);
    if (n.u > core.DIMS.WALL_U - 0.6) { const f = core.frame(n.s); const du = n.u - (core.DIMS.WALL_U - 0.6); _v.x -= f.nx * du; _v.z -= f.nz * du; }
    _v.y = Math.max(_v.y, core.surfaceY(n.s, Math.min(n.u, core.DIMS.WALL_U)) + 1.1);
    const k = camInit ? 1 - Math.exp(-dt * (far ? 5 : 7.5)) : 1;
    camPos.lerp(_v, k);
    _w.set(c.pos.x + sy * 7, c.pos.y + 1.0, c.pos.z + cy * 7);
    camLook.lerp(_w, camInit ? 1 - Math.exp(-dt * 12) : 1);
    camInit = true;
    camera.position.copy(camPos);
    camera.up.set(0, 1, 0);
    camera.lookAt(camLook);
    const fov = lerp(60, 74, clamp(sp / 75, 0, 1));
    if (Math.abs(camera.fov - fov) > 0.05) { camera.fov = fov; camera.updateProjectionMatrix(); }
  }
  const _q = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, "YXZ");
  let shake = 0, lastImpact = 0;
  function cockpitCam(e, dt) {
    const eye = e.visual.eye;
    e.visual.group.updateMatrixWorld(true);
    eye.getWorldPosition(camera.position);
    eye.getWorldQuaternion(_q);
    camera.quaternion.copy(_q);
    // the head: a little road buzz with speed, a jolt on contact
    const c = e.car, sp = Math.abs(c.speed);
    shake *= Math.exp(-dt * 6);
    if (c.fx && c.fx.impactSeq !== lastImpact) { lastImpact = c.fx.impactSeq; if (c.fx.impact) shake = Math.max(shake, clamp(c.fx.impact.mag / 25, 0, 1)); }
    const t = performance.now() / 1000, b = 0.0012 * clamp(sp / 60, 0, 1) + shake * 0.02;
    _e.set(Math.sin(t * 37) * b, Math.sin(t * 29) * b, 0);
    _q.setFromEuler(_e); camera.quaternion.multiply(_q);
    const fov = lerp(70, 78, clamp(sp / 75, 0, 1));
    if (Math.abs(camera.fov - fov) > 0.05) { camera.fov = fov; camera.updateProjectionMatrix(); }
    camInit = false;
  }
  // before the start: the TV opening, a slow sweep round the bowl
  function orbitCam(dt) {
    orbitT += dt * 0.06;
    const r = 250, a = orbitT + 0.6;
    camera.position.set(Math.cos(a) * r, 95, Math.sin(a) * r * 0.75);
    camera.lookAt(0, 0, 10);
    if (camera.fov !== 55) { camera.fov = 55; camera.updateProjectionMatrix(); }
    camInit = false;
  }

  // ---- HUD (the chip, the lights, the speed; nothing else) --------------------
  const hud = { pos: $("hPos"), lap: $("hLap"), spd: $("hSpd"), gear: $("hGear"), lights: $("lights"), flag: $("flag"), rpm: $("hRpm") };
  const lamps = [...document.querySelectorAll("#lights i")];
  function hudLights(n, go) {
    hud.lights.classList.toggle("show", n > 0 || go);
    lamps.forEach((l, i) => { l.className = go ? "g" : (i < n ? "r" : ""); });
  }
  let flagT = 0;
  function flash(text, cls) { hud.flag.textContent = text; hud.flag.className = "show " + (cls || ""); flagT = 2.6; }
  hudFlash.fn = flash;
  let hudAcc = 0;
  function updateHud(dt) {
    hudAcc += dt;
    if (flagT > 0) { flagT -= dt; if (flagT <= 0) hud.flag.className = ""; }
    if (hudAcc < 1 / 12) return;
    hudAcc = 0;
    const c = me.car;
    hud.pos.textContent = "P" + me.place + "/" + SES.field;
    hud.lap.textContent = "LAP " + clamp(c.lap + 1, 1, LAPS) + "/" + LAPS;
    hud.spd.textContent = Math.round(Math.abs(c.speed) * MPH);
    hud.gear.textContent = c.gear > 0 ? c.gear : (c.gear < 0 ? "R" : "N");
    hud.rpm.style.transform = "scaleX(" + clamp((c.rpm || 0) / 9500, 0, 1).toFixed(3) + ")";
  }

  // ---- the race --------------------------------------------------------------------
  const S = { phase: "intro", paused: false, lastPylon: 0 };
  window.__race = { S, SES, entries, core, restart: () => restart(), start: () => begin() };

  function begin() {
    if (S.phase !== "intro" && S.phase !== "results") return;
    $("card").classList.add("gone");
    $("board").classList.remove("show");
    document.body.classList.add("racing");
    if (R.audio) R.audio.start();
    SES.begin();
    for (const e of entries) e.visual.reset();
    me.visual.setCockpit(CAMS[camMode] === "cockpit");
    S.phase = "run";
    hudLights(0, false);
    camInit = false;
  }
  function restart() { S.phase = "results"; begin(); }

  function setPause(p) {
    if (SES.phase !== "race" && SES.phase !== "grid") p = false;
    S.paused = p;
    $("pause").classList.toggle("show", p);
    if (R.audio) R.audio.mute(p);
  }
  function togglePause() { setPause(!S.paused); }
  $("resume").addEventListener("click", () => setPause(false));
  $("pauseBtn").addEventListener("click", togglePause);

  const ordinal = R.session.ordinal;
  const fmt = (t) => { if (!isFinite(t) || !t) return ""; const m = Math.floor(t / 60), s = t - m * 60; return (m ? m + ":" + (s < 10 ? "0" : "") : "") + s.toFixed(3); };

  function results() {
    S.phase = "results";
    const order = SES.standings();
    const lead = order[0];
    const bestLap = Math.min(...entries.map(bestOf));
    const rows = order.map((e, i) => {
      const gap = i === 0 ? fmt(e.finishT) : e.finishT ? "+" + (e.finishT - lead.finishT).toFixed(3) : (lead.car.lap - e.car.lap) + " LAP" + (lead.car.lap - e.car.lap === 1 ? "" : "S");
      return "<tr class='" + (e.player ? "me" : "") + "'><td>" + (i + 1) + "</td><td><b>" + e.number + "</b></td><td>" + e.name +
        "</td><td>" + gap + "</td><td class='" + (bestOf(e) === bestLap ? "fl" : "") + "'>" + fmt(bestOf(e)) + "</td></tr>";
    }).join("");
    $("boardRows").innerHTML = rows;
    $("boardTitle").textContent = me.place === 1 ? "WINNER" : ordinal(me.place);
    $("board").classList.add("show");
    document.body.classList.remove("racing");
  }
  $("again").addEventListener("click", restart);
  $("go").addEventListener("click", begin);

  // ---- tyre marks and the pylon ---------------------------------------------------
  const lastMark = [];
  function marks(e) {
    const c = e.car, w = c.wheels;
    if (!w || !track.skid) return;
    const sy = Math.sin(c.yaw), cy = Math.cos(c.yaw);
    for (let k = 2; k < 4; k++) {                       // the driven (rear) wheels lay the rubber
      const wl = w[k]; if (!wl || wl.slip < 0.45 || Math.abs(c.speed) < 4) { lastMark[e.i * 4 + k] = null; continue; }
      const side = k === 2 ? 0.86 : -0.86;
      const x = c.pos.x + cy * side - sy * 1.4, z = c.pos.z - sy * side - cy * 1.4;
      const lm = lastMark[e.i * 4 + k];
      if (lm && Math.hypot(x - lm.x, z - lm.z) < 0.7) continue;
      track.skid(x, c.pos.y + 0.02, z, c.yaw, 0.3, clamp((wl.slip - 0.45) * 2, 0.15, 1));
      lastMark[e.i * 4 + k] = { x, z };
    }
  }

  // ---- the loop ----------------------------------------------------------------------
  let last = performance.now(), acc = 0;
  const DT = 1 / 60;
  function frame(now) {
    requestAnimationFrame(frame);
    let dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (S.paused) dt = 0;
    if (S.phase !== "intro") {
      acc += dt;
      let n = 0;
      while (acc >= DT && n < 6) { SES.step(DT, SES.phase === "race" ? readInput(DT) : null); acc -= DT; n++; }
      if (n === 6) acc = 0;
    }
    // presentation
    const cockpit = CAMS[camMode] === "cockpit" && S.phase !== "intro";
    for (const e of entries) {
      if (!e.car) continue;
      e.visual.update(e.car, dt, camera, e.player && cockpit);
      if (SES.phase === "race") marks(e);
    }
    if (fx) fx.update(dt, camera, renderer.domElement.clientHeight || window.innerHeight);
    if (S.phase === "intro") orbitCam(dt);
    else if (CAMS[camMode] === "cockpit") cockpitCam(me, dt);
    else chaseCam(me, dt, CAMS[camMode] === "far");
    if (SES.phase === "race") {
      S.lastPylon -= dt;
      if (S.lastPylon <= 0) {
        S.lastPylon = 0.5;
        const st = SES.standings();
        if (venue.setPylon) venue.setPylon(st.map((e) => e.number));
        if (SES.leader && SES.leader !== st[0]) SES.excite = Math.min(1, SES.excite + 0.5);
        SES.leader = st[0];
      }
      updateHud(dt);
    }
    venue.update(dt, { excite: SES.excite, flag: SES.flag, leaderNumber: SES.leader ? SES.leader.number : 0, camera });
    if (track.update) track.update(dt, camera);
    if (R.audio && me.car) R.audio.update(me.car, entries, camera, dt);
    renderer.render(scene, camera);
  }

  // the first frame: the stadium, from the air, and the one button
  SES.layGrid();                                  // the cars stand on the grid under the opening sweep
  if (Q.get("go") === "1" || AUTO) setTimeout(begin, 50);
  window.__raceReady = true;
  const b = $("boot"); if (b) b.remove();
  requestAnimationFrame(frame);
})();
