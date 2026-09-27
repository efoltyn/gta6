/* Car showcase — every class, lit well, then driven, then sat in.

   THE ASK (owner, 2026-09-27): "one Opus on completely improving car and then
   showing it. It's going to look freaking car." Plus: "especially the interior
   and what it looks like for the driver and being a passenger ... open any door
   and sit in that seat, with two seats and six seats as well."

   STUDIO plates build cars with the page's OWN traffic builder
   (CBZ.cityBuildAmbientCarVisual, merge and all) on a neutral studio floor
   under a warm key, a cool rim and contact shadows, so the body, wheels,
   glass and lamps are the only variables. Tripods resolve on the BEFORE side
   and are copied to the AFTER side.

   LIVE plates boot the real city once per side with requestAnimationFrame
   frozen and CBZ.stepSim as the only clock:
     roll      a car driven down the longest downtown road, then steered hard;
               photographed from outside the turn at the tick the body leans
     night     the same street at midnight, lamps on
     seats     first person from the driver's seat, the passenger seat
               (rolling), and the third row of a six-seat SUV
   Everything is feature-detected: a build without a seat model photographs
   what its own seat verbs give, and the notes say so. */


const subjects = [
  {
    id: "lineup",
    label: "01 · The fleet: every class side by side",
    kind: "lineup",
    focus: "Sedan, hatch, SUV, pickup, sports, muscle, van, taxi, police. Does each read as its class from its silhouette alone: rounded bodies, raked glass, tyres sitting in arches, lamps, bumpers, plates?",
  },
  {
    id: "hero",
    label: "02 · Hero three-quarter",
    kind: "studio", model: "Falcone Rondine", color: 0xc4161c,
    view: { azDeg: 38, camY: 1.25, dist: 6.4, fov: 34, aim: "body" },
    focus: "The front three-quarter a car ad would use. Paint that holds a highlight, glass that reflects, a face with lamps and intakes, wheels that fill the arches.",
  },
  {
    id: "wheel-arch",
    label: "03 · Wheel and arch close-up",
    kind: "studio", model: "Voltra Ion", color: 0x2d5f9a,
    view: { azDeg: 78, camY: 0.62, dist: 2.4, fov: 34, aim: "frontWheel" },
    focus: "Tyre sidewall and shoulder, rim spokes and barrel, brake disc and caliper, and the arch lip the tyre tucks under.",
  },
  {
    id: "front-lamps",
    label: "04 · Front lamps close-up",
    kind: "studio", model: "Voltra Ion", color: 0x2d5f9a,
    view: { azDeg: 26, camY: 0.95, dist: 2.3, fov: 36, aim: "headlamp" },
    focus: "A headlamp should read as a lamp: a lens, a housing, a bright element, set into the bodywork, with the grille, bumper and plate around it.",
  },
  {
    id: "door-seat",
    label: "05 · SUV, doors open, seats visible",
    kind: "studio", model: "Bison Frontier", color: 0x44505e,
    open: ["driver", "rearL"],
    view: { azDeg: 104, camY: 1.85, dist: 5.6, fov: 40, aim: "cabin" },
    focus: "Open the door, see the seat you would sit in: bolstered seats with headrests, door cards, the rows behind.",
  },
  {
    id: "roll",
    label: "06 · Mid-turn: body roll",
    kind: "live", live: "roll", model: "Voltra Surge",
    focus: "Driven down the avenue and steered hard. The body should lean out of the turn on its springs while the wheels stay on the road.",
  },
  {
    id: "night",
    label: "07 · Night, lights on",
    kind: "live", live: "night", model: "Voltra Ion",
    focus: "Midnight on the same street. Headlamps and tail lamps lit, a pool on the road ahead, paint and glass catching the street lights.",
  },
  {
    id: "fp-driver",
    label: "08 · Driver's seat",
    kind: "live", live: "seat", seat: "driver", model: "Voltra Ion",
    focus: "The driver's eye: hands on the wheel, the cluster behind the rim, a dash that meets the windscreen, pillars, mirror, door card, the road through clear glass.",
  },
  {
    id: "fp-passenger",
    label: "09 · Passenger seat, riding",
    kind: "live", live: "seat", seat: "passenger", model: "Voltra Ion", rolling: true,
    focus: "Riding shotgun while the car rolls: the eye on the passenger side, the driver's seat and wheel beside you, the glovebox and dash ahead.",
  },
  {
    id: "fp-rear-six",
    label: "10 · Third row of a six-seat SUV",
    kind: "live", live: "seat", seat: "rear", model: "Bison Frontier",
    focus: "The back row of a three-row SUV: two rows of seat backs and headrests ahead, the roof liner, the windscreen far away.",
  },
];

async function stageCarShowcase(input) {
  const T = window.THREE;
  const CBZ = window.CBZ;
  if (!T || !CBZ) return { ok: false, error: "no window.THREE / window.CBZ" };
  const S = input.subject || {};
  const DEG = Math.PI / 180;
  // (inside the stage: the stage function is serialised into the page alone)
  const LINEUP = [
    { name: "Voltra Ion", tag: "SEDAN", color: 0x2d5f9a },
    { name: "Kotori Pip", tag: "HATCH", color: 0x4caf6e },
    { name: "Bison Frontier", tag: "SUV", color: 0x44505e },
    { name: "Bison Rampart", tag: "PICKUP", color: 0xb8322e },
    { name: "Adler 901 Turbo", tag: "SPORTS", color: 0xf3cf39 },
    { name: "Bison Stampede", tag: "MUSCLE", color: 0xe88a3c },
    { name: "Bison Hauler", tag: "VAN", color: 0xe8e8ee },
    { name: "Metro Cab", tag: "TAXI", color: null },
    { model: { name: "Police Cruiser", value: 3200, color: 0x16181d, body: "sedan", designStyle: "malibu", livery: "police" }, tag: "POLICE", color: null },
  ];

  const round = function (v, n) {
    const k = Math.pow(10, n == null ? 3 : n);
    return Number.isFinite(Number(v)) ? Math.round(Number(v) * k) / k : 0;
  };
  const msg = function (e) { return (e && e.message) ? String(e.message) : String(e); };
  const wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  const until = async function (test, budgetMs, stepMs) {
    const deadline = Date.now() + (budgetMs || 30000);
    while (Date.now() < deadline) {
      try { if (test()) return true; } catch (e) {}
      await wait(stepMs || 250);
    }
    return false;
  };

  // ---- one studio renderer + one overlay per page ---------------------------
  let ST = window.__cbzCarShowcase;
  if (!ST) {
    const renderer = new T.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setSize(input.width, input.height, false);
    // the game's own output: sRGB + ACES (core/renderer.js), so a studio car
    // is graded exactly like a street car
    renderer.outputEncoding = T.sRGBEncoding;
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.92;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFSoftShadowMap;
    renderer.domElement.style.cssText =
      "position:fixed;left:0;top:0;display:block;width:" + input.width + "px;height:" + input.height + "px;z-index:2147483000";
    document.body.appendChild(renderer.domElement);
    const overlay = document.createElement("div");
    overlay.style.cssText =
      "position:fixed;inset:0;pointer-events:none;color:#f4f8fb;text-shadow:0 2px 9px #000;z-index:2147483600;" +
      "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    overlay.innerHTML = "<div data-side></div><div data-name></div><div data-focus></div>" +
      "<div data-state></div><div data-detail></div><div data-big></div><div data-tags></div>";
    document.body.appendChild(overlay);
    ST = window.__cbzCarShowcase = { renderer: renderer, overlay: overlay, canvas: renderer.domElement, scene: null, camera: null, mode: "studio", live: null };
    ST.render = function () {
      try {
        if (ST.mode === "live") { if (CBZ.renderer && CBZ.scene && CBZ.camera) CBZ.renderer.render(CBZ.scene, CBZ.camera); }
        else if (ST.scene && ST.camera) ST.renderer.render(ST.scene, ST.camera);
      } catch (e) {}
    };
    window.__cbzVisualCompare = { render: ST.render };
  }
  ST.renderer.setSize(input.width, input.height, false);
  const showOnly = function (keep) {
    const kids = Array.prototype.slice.call(document.body.children);
    for (let i = 0; i < kids.length; i++) {
      const el = kids[i];
      let wanted = false;
      for (let j = 0; j < keep.length; j++) {
        const k = keep[j];
        if (k && (k === el || (el.contains && el.contains(k)))) { wanted = true; break; }
      }
      el.style.visibility = wanted ? "" : "hidden";
    }
  };
  const studioMode = function () { ST.mode = "studio"; showOnly([ST.canvas, ST.overlay]); };
  const liveMode = function () { ST.mode = "live"; showOnly([CBZ.renderer && CBZ.renderer.domElement, ST.overlay]); };
  const allVisible = function () {
    const kids = Array.prototype.slice.call(document.body.children);
    for (let i = 0; i < kids.length; i++) kids[i].style.visibility = "";
    ST.canvas.style.visibility = "hidden";
  };

  // ---- overlay --------------------------------------------------------------
  let stateText = "", detailText = "", bigText = "", tagsHtml = "";
  const paint = function () {
    const before = input.side === "before";
    const q = function (k) { return ST.overlay.querySelector("[data-" + k + "]"); };
    const side = q("side"), name = q("name"), focus = q("focus"), st = q("state"), det = q("detail"), big = q("big"), tags = q("tags");
    side.textContent = before ? (input.beforeLabel || "BEFORE") : (input.afterLabel || "AFTER");
    side.style.cssText = "position:absolute;top:18px;left:22px;padding:6px 10px;border-radius:6px;background:" + (before ? "#c94c4c" : "#218b60") + ";font-size:12px;font-weight:900;letter-spacing:.12em";
    name.textContent = S.label || S.id;
    name.style.cssText = "position:absolute;top:54px;left:22px;font-size:24px;font-weight:800;letter-spacing:-.01em";
    focus.textContent = S.focus || "";
    focus.style.cssText = "position:absolute;top:88px;left:24px;color:#d4dee6;font-size:12.5px;font-weight:550;max-width:660px;line-height:1.35";
    st.textContent = stateText;
    st.style.cssText = "position:absolute;right:22px;top:20px;color:" + (before ? "#ff9c9c" : "#80e4b4") + ";font-size:11px;font-weight:850;letter-spacing:.1em;text-align:right;max-width:420px;line-height:1.5";
    det.textContent = detailText;
    det.style.cssText = "position:absolute;right:20px;bottom:14px;color:#b4c2cd;font:10px ui-monospace,SFMono-Regular,Menlo,monospace;text-align:right;max-width:640px;line-height:1.45;white-space:pre-line";
    big.textContent = bigText;
    big.style.cssText = bigText ? "position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:34px;font-weight:900;letter-spacing:.08em;color:#8f9dab;text-align:center;padding:0 60px" : "display:none";
    tags.innerHTML = tagsHtml;
    tags.style.cssText = "position:absolute;inset:0";
  };

  // ---- studio ------------------------------------------------------------------
  const aspect = input.width / input.height;
  const refCam = (input.referenceStage && input.referenceStage.camera) || null;
  const makeScene = function (span) {
    const scene = new T.Scene();
    // a graded studio sky: a big inward sphere, cool at the top, warm at the horizon
    const skyGeo = new T.SphereGeometry(400, 32, 16);
    const col = [];
    const pos = skyGeo.attributes.position;
    const top = new T.Color(0x6f8fb3), hor = new T.Color(0xb9b5ae), bot = new T.Color(0x3a3a3c);
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) / 400;
      const c = y > 0 ? hor.clone().lerp(top, Math.pow(y, 0.6)) : hor.clone().lerp(bot, Math.min(1, -y * 4));
      col.push(c.r, c.g, c.b);
    }
    skyGeo.setAttribute("color", new T.Float32BufferAttribute(col, 3));
    scene.add(new T.Mesh(skyGeo, new T.MeshBasicMaterial({ vertexColors: true, side: T.BackSide, depthWrite: false })));
    scene.add(new T.HemisphereLight(0xdfeaff, 0x3a342c, 0.45));
    const key = new T.DirectionalLight(0xfff0d8, 1.55);
    key.position.set(9, 14, 10);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    const r = Math.max(6, span || 6);
    key.shadow.camera.left = -r; key.shadow.camera.right = r; key.shadow.camera.top = r; key.shadow.camera.bottom = -r;
    key.shadow.camera.near = 1; key.shadow.camera.far = 60;
    key.shadow.bias = -0.0004; key.shadow.radius = 3;
    scene.add(key); scene.add(key.target);
    const rim = new T.DirectionalLight(0x9cc4ff, 0.9); rim.position.set(-9, 6, -8); scene.add(rim);
    const fill = new T.DirectionalLight(0xffffff, 0.3); fill.position.set(-2, 3, 10); scene.add(fill);
    const g = new T.Mesh(new T.CircleGeometry(80, 64), new T.MeshStandardMaterial({ color: 0x44474b, roughness: 0.82, metalness: 0.0 }));
    g.rotation.x = -Math.PI / 2; g.receiveShadow = true; scene.add(g);
    scene.fog = new T.Fog(0xb9b5ae, 45, 160);
    return scene;
  };
  const tripod = function (aim, azDeg, camY, dist, fov) {
    const dy = camY - aim.y;
    let horiz = dist * dist - dy * dy;
    horiz = horiz > 0.02 ? Math.sqrt(horiz) : dist * 0.35;
    const a = azDeg * DEG;
    return { pos: [aim.x + Math.sin(a) * horiz, camY, aim.z + Math.cos(a) * horiz], target: [aim.x, aim.y, aim.z], up: [0, 1, 0], fov: fov };
  };
  const applyCamera = function (scene, want) {
    const cam = refCam || want;
    const camera = new T.PerspectiveCamera(Number(cam.fov) || 45, aspect, 0.05, 3000);
    camera.position.fromArray(cam.pos);
    camera.up.fromArray(cam.up || [0, 1, 0]);
    camera.lookAt(new T.Vector3().fromArray(cam.target));
    camera.updateProjectionMatrix();
    ST.scene = scene; ST.camera = camera;
    return { pos: cam.pos.slice(), target: cam.target.slice(), up: (cam.up || [0, 1, 0]).slice(), fov: Number(cam.fov) || 45, matched: !!refCam };
  };
  const ensureEnv = function () {
    try { if (!CBZ.ENV && CBZ.buildVehicleEnv) CBZ.buildVehicleEnv(ST.renderer); } catch (e) {}
  };
  const buildCar = function (spec) {
    let grp = null, err = null;
    try { grp = CBZ.cityBuildAmbientCarVisual ? CBZ.cityBuildAmbientCarVisual(spec.model || spec.name) : null; } catch (e) { err = msg(e); }
    if (grp && spec.color != null && CBZ.cityRecolorCarBody) { try { CBZ.cityRecolorCarBody(grp, spec.color); } catch (e) {} }
    if (grp) grp.traverse(function (o) { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    return { grp: grp, err: err };
  };
  const countCar = function (grp) {
    let tris = 0, meshes = 0;
    grp.traverse(function (o) {
      if (!o.isMesh || !o.geometry || !o.geometry.attributes || !o.geometry.attributes.position) return;
      meshes++;
      const g = o.geometry;
      tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
    });
    return { tris: Math.round(tris), meshes: meshes };
  };
  const screenOf = function (camera, v) {
    const p = v.clone().project(camera);
    return { x: (p.x * 0.5 + 0.5) * input.width, y: (-p.y * 0.5 + 0.5) * input.height };
  };

  if (S.kind === "lineup") {
    studioMode(); ensureEnv();
    const scene = makeScene(18);
    const built = [], notes = [];
    const GAP = 3.1;
    for (let i = 0; i < LINEUP.length; i++) {
      const L = LINEUP[i];
      const r = buildCar(L);
      if (!r.grp) { notes.push(L.tag + ": " + (r.err || "no car")); continue; }
      const x = (i - (LINEUP.length - 1) / 2) * GAP;
      r.grp.position.set(x, 0, 0);
      r.grp.rotation.set(0, 0, 0);
      scene.add(r.grp);
      const st = r.grp.userData.carStyle || "?";
      const c = countCar(r.grp);
      built.push({ tag: L.tag, grp: r.grp, style: st, tris: c.tris, meshes: c.meshes, x: x });
    }
    scene.updateMatrixWorld(true);
    const cam = applyCamera(scene, { pos: [-12.5, 5.2, 21.5], target: [1.2, 0.6, 0], up: [0, 1, 0], fov: 42 });
    // left to right, nearest first
    tagsHtml = "<div style=\"position:absolute;left:24px;top:132px;font:800 12px/1.4 sans-serif;letter-spacing:.12em;color:#fff\">" + built.map(function (b) { return b.tag; }).join(" \u2192 ") + "</div>";
    let triSum = 0, meshSum = 0;
    built.forEach(function (b) { triSum += b.tris; meshSum += b.meshes; });
    stateText = built.length + " CLASSES · AVG " + Math.round(triSum / Math.max(1, built.length)) + " TRIS · AVG " + round(meshSum / Math.max(1, built.length), 1) + " MESHES / CAR";
    detailText = built.map(function (b) { return b.tag.toLowerCase() + "=" + b.style + " " + b.tris + "t/" + b.meshes + "m"; }).join("  ") + (notes.length ? "\n" + notes.join(" · ") : "");
    paint();
    ST.render();
    return {
      ok: true, subject: S.id, staged: true, camera: cam,
      metrics: { avgTris: Math.round(triSum / Math.max(1, built.length)), avgMeshes: round(meshSum / Math.max(1, built.length), 2), classes: built.length },
      notes: notes,
    };
  }

  if (S.kind === "studio") {
    studioMode(); ensureEnv();
    const r = buildCar(S);
    const scene = makeScene(6);
    if (!r.grp) {
      bigText = "NO CAR"; stateText = "cityBuildAmbientCarVisual FAILED"; detailText = r.err || "builder missing";
      applyCamera(scene, { pos: [0, 1.6, 6], target: [0, 0.8, 0], up: [0, 1, 0], fov: 45 });
      paint(); ST.render();
      return { ok: true, subject: S.id, staged: false, error: r.err };
    }
    const grp = r.grp;
    grp.position.set(0, 0, 0); grp.rotation.set(0, 0, 0);
    scene.add(grp);
    scene.updateMatrixWorld(true);
    const veh = { group: grp, heading: 0, pos: grp.position, color: S.color };
    const notes = [];
    const opened = [];
    const doorIds = { driver: "FL", shotgun: "FR", rearL: "RL", rearR: "RR" };
    for (let i = 0; i < (S.open || []).length; i++) {
      let ok = false;
      try { ok = !!(CBZ.boarding && CBZ.boarding.door && CBZ.boarding.door(veh, S.open[i], 1)); } catch (e) { notes.push("door " + S.open[i] + ": " + msg(e)); }
      if (!ok && CBZ.carDoorPose) { try { ok = !!CBZ.carDoorPose(veh, doorIds[S.open[i]], 1); } catch (e) {} }
      opened.push(S.open[i] + (ok ? "" : "(no door)"));
    }
    grp.traverse(function (o) { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    scene.updateMatrixWorld(true);
    const dims = grp.userData.vehicleDims || { width: 2, length: 4.5, height: 1.5, wheelbase: 2.8 };
    const ci = CBZ.carCabinInfo ? CBZ.carCabinInfo(veh) : null;
    // the front-left wheel, found by its tag (the thing the plate is about)
    let wheel = null;
    grp.traverse(function (o) {
      if (!o.userData || !o.userData.playerWheel) return;
      const p = new T.Vector3(); o.getWorldPosition(p);
      if (p.x > 0 && (!wheel || p.z > wheel.z)) wheel = p;
    });
    const view = S.view || { azDeg: 40, camY: 1.3, dist: 6, fov: 36, aim: "body" };
    let aim;
    if (view.aim === "frontWheel" && wheel) aim = { x: wheel.x, y: wheel.y + 0.05, z: wheel.z };
    else if (view.aim === "headlamp") aim = { x: dims.width * 0.3, y: (ci ? ci.beltY : 0.8) - 0.18, z: dims.length * 0.5 - 0.15 };
    else if (view.aim === "cabin" && ci) aim = { x: 0.2, y: ci.beltY - 0.05, z: ci.seatZ - 0.4 };
    else aim = { x: 0, y: (dims.height || 1.4) * 0.42, z: 0 };
    const cam = applyCamera(scene, tripod(aim, view.azDeg, view.camY, view.dist, view.fov));
    const c = countCar(grp);
    stateText = (grp.userData.carStyle || "?").toUpperCase() + " · " + c.tris + " TRIS · " + c.meshes + " MESHES";
    detailText = "dims " + round(dims.width, 2) + " x " + round(dims.length, 2) + " x " + round(dims.height || 0, 2) + " m" +
      (opened.length ? " · opened " + opened.join(",") : "") + (notes.length ? "\n" + notes.join(" · ") : "");
    paint();
    ST.render();
    return { ok: true, subject: S.id, staged: true, camera: cam, metrics: { tris: c.tris, meshes: c.meshes }, notes: notes };
  }

  // ---- LIVE --------------------------------------------------------------------
  allVisible();
  let L = ST.live;
  if (!L) {
    const booted = await until(function () {
      return CBZ.game && (CBZ.bootComplete || CBZ.game.state === "title") && typeof CBZ.stepSim === "function" && document.getElementById("playBtn");
    }, 300000);
    if (!booted) { liveMode(); bigText = "WORLD NEVER BOOTED"; paint(); return { ok: true, subject: S.id, staged: false, error: "never booted" }; }
    if (CBZ.CONFIG) { CBZ.CONFIG.CITY_HITMAN_CAMPAIGN = false; CBZ.CONFIG.CONTROLS_AUTO = false; }
    const playing = await until(function () {
      if (CBZ.game.state === "playing") return true;
      const b = document.getElementById("playBtn"); if (b) b.click();
      return CBZ.game.state === "playing";
    }, 120000, 300);
    if (!playing) { liveMode(); bigText = "NEVER PLAYING"; paint(); return { ok: true, subject: S.id, staged: false, error: "never playing" }; }
    if (CBZ.game.cityCampaign) CBZ.game.cityCampaign.phase = "endless_contracts";
    try { if (CBZ.setQualityLevel) CBZ.setQualityLevel(3); } catch (e) {}
    window.requestAnimationFrame = function () { return 0; };
    await wait(700);
    L = ST.live = { simT: 0, notes: [], road: null };
    for (let i = 0; i < 120; i++) { CBZ.hitstop = 0; CBZ.slowmo = 0; try { CBZ.stepSim(1 / 60); } catch (e) {} L.simT += 1 / 60; }
    try {
      const roads = (CBZ.city && CBZ.city.arena && CBZ.city.arena.roads) || [];
      for (let i = 0; i < roads.length; i++) {
        const r = roads[i];
        if (!r || !r.len || r.len > 1500) continue;
        if (!L.road || r.len > L.road.len) L.road = r;
      }
    } catch (e) {}
  }
  liveMode();
  const notes = [];
  const keys = CBZ.keys || {};
  const releaseKeys = function () { ["w", "a", "s", "d", " "].forEach(function (k) { keys[k] = false; }); };
  const tick = function (n, speed) {
    for (let i = 0; i < (n == null ? 1 : n); i++) {
      if (CBZ.game && CBZ.game.state === "paused") { try { if (CBZ.resumeGame) CBZ.resumeGame(); else CBZ.game.state = "playing"; } catch (e) {} }
      CBZ.hitstop = 0; CBZ.slowmo = 0;
      if (speed != null && i === 0 && L.car && !L.car.dead && Math.abs(L.car.v || 0) < speed) L.car.v = speed;
      try { CBZ.stepSim(1 / 60); } catch (e) {}
      L.simT += 1 / 60;
      try { if (CBZ.player) { CBZ.player.hp = 100; CBZ.player.wanted = 0; } } catch (e) {}
    }
  };
  const dismissHelp = function () {
    try { if (CBZ.controls && CBZ.controls.hide) CBZ.controls.hide(); } catch (e) {}
    try {
      const all = document.querySelectorAll("div");
      for (let i = 0; i < all.length; i++) {
        const t = all[i].textContent || "";
        if (t.indexOf("Accelerate / brake") >= 0 && t.length < 400) all[i].style.display = "none";
      }
    } catch (e) {}
  };
  // leave whatever car the last plate put us in, and park it out of the way
  const leaveCar = function () {
    releaseKeys();
    try { if (CBZ.carFpSetView) CBZ.carFpSetView(false); } catch (e) {}
    const P = CBZ.player;
    if (P && P.driving) { try { if (CBZ.cityExitVehicle) CBZ.cityExitVehicle(); } catch (e) {} }
    if (L.car) {
      try { if (CBZ.cityScrapCar) CBZ.cityScrapCar(L.car); } catch (e) {}
      L.car = null;
    }
    tick(4);
  };
  const spawnOnRoad = function (modelName, back) {
    const road = L.road;
    const P = CBZ.player;
    const px = road ? road.x - (road.vertical ? 0 : road.len * (back || 0.2)) : ((P && P.pos) ? P.pos.x + 4.5 : 0);
    const pz = road ? road.z - (road.vertical ? road.len * (back || 0.2) : 0) : ((P && P.pos) ? P.pos.z + 1.5 : 0);
    const heading = road ? (road.vertical ? 0 : Math.PI / 2) : 0;
    let car = null;
    try { if (CBZ.citySpawnOwnedCar) car = CBZ.citySpawnOwnedCar(px, pz, modelName); } catch (e) { notes.push("spawn " + msg(e)); }
    if (!car) return null;
    car.heading = heading;
    if (car.group) car.group.rotation.y = heading;
    car.v = 0; car.vx = 0; car.vz = 0;
    if (P && P.pos) P.pos.set(car.pos.x + 1.4, P.pos.y, car.pos.z);
    return car;
  };
  // the seat model if this build has one, else the verbs it does have
  const seatLayout = function (car) {
    try {
      if (CBZ.carSeatDebug && CBZ.carSeatDebug.layout) {
        const L0 = CBZ.carSeatDebug.layout(car);
        return L0 ? (Array.isArray(L0) ? L0 : L0.seats) : null;
      }
    } catch (e) {}
    return null;
  };
  const pickSeat = function (layout, want) {
    if (!layout || !layout.length) return null;
    const isDrv = function (s) { return !!(s.isDriver || s.driver || s.id === "driver"); };
    if (want === "driver") return layout.filter(isDrv)[0] || layout[0];
    const row = function (s) { return s.row != null ? s.row : 0; };
    if (want === "passenger") return layout.filter(function (s) { return !isDrv(s) && row(s) === 0; })[0] || null;
    let maxRow = 0; layout.forEach(function (s) { if (row(s) > maxRow) maxRow = row(s); });
    return layout.filter(function (s) { return row(s) === maxRow && !isDrv(s); })[0] || null;
  };
  const sitIn = function (car, want) {
    const P = CBZ.player;
    const layout = seatLayout(car);
    const seat = pickSeat(layout, want);
    if (seat && CBZ.carSeatDebug && CBZ.carSeatDebug.sitPlayer) {
      try { CBZ.carSeatDebug.sitPlayer(car, seat.id); tick(20); return "seat model: " + seat.id + " of " + layout.length; } catch (e) { notes.push("sitPlayer " + msg(e)); }
    }
    try { if (CBZ.cityEnterVehicle) CBZ.cityEnterVehicle(car); } catch (e) { notes.push("enter " + msg(e)); }
    for (let i = 0; i < 420; i++) { tick(1, 0); if (P && P.driving && P._vehicle === car && i > 20) break; }
    if (want !== "driver") {
      if (CBZ.citySeatShift) { try { CBZ.citySeatShift({ to: "shotgun", quiet: true }); } catch (e) {} tick(10, 0); return "legacy: driver then citySeatShift(shotgun)" + (want === "rear" ? " (no rear seat verb on this build)" : ""); }
      return "legacy: driver only (no seat swap on this build)";
    }
    return "legacy: cityEnterVehicle (driver)";
  };
  const place3q = function (car, lx, ly, lz, tx, ty, tz, fov) {
    const grp = car.group, h = car.heading || 0;
    const w = function (x, z) { return [grp.position.x + Math.cos(h) * x + Math.sin(h) * z, grp.position.z - Math.sin(h) * x + Math.cos(h) * z]; };
    const a = w(lx, lz), b = w(tx, tz);
    const c = CBZ.camera;
    if (!c) return null;
    c.position.set(a[0], grp.position.y + ly, a[1]); c.up.set(0, 1, 0);
    c.lookAt(new T.Vector3(b[0], grp.position.y + ty, b[1]));
    c.fov = fov || 42; c.updateProjectionMatrix(); c.updateMatrixWorld(true);
    return { pos: c.position.toArray(), target: [b[0], grp.position.y + ty, b[1]], fov: c.fov };
  };

  leaveCar();
  let metrics = {}, camOut = null, how = "";
  if (S.live === "roll") {
    try { if (CBZ.dayPhase) CBZ.dayPhase(0.40); } catch (e) {}
    const car = L.car = spawnOnRoad(S.model || "Voltra Surge", 0.35);
    if (!car) { bigText = "NO CAR"; paint(); return { ok: true, subject: S.id, staged: false }; }
    how = sitIn(car, "driver");
    try { if (CBZ.carFpSetView) CBZ.carFpSetView(false); } catch (e) {}
    dismissHelp();
    // launch, cruise, then a hard left at ~45 mph
    keys.w = true; tick(260);
    keys.a = true; tick(24);
    const grp = car.group;
    let body = grp;
    const rz = function (o) { return o ? o.rotation.z : 0; };
    let bodyRoll = rz(grp);
    // the visual body may carry the lean instead of the root group
    const vis = grp.userData && grp.userData.carVisual;
    if (vis && Math.abs(rz(vis)) > Math.abs(bodyRoll)) { bodyRoll = rz(vis); body = vis; }
    grp.traverse(function (o) { if (o !== grp && o.userData && o.userData.suspensionBody && Math.abs(o.rotation.z) > Math.abs(bodyRoll)) { bodyRoll = o.rotation.z; body = o; } });
    const speedMph = CBZ.speedMph ? CBZ.speedMph(Math.abs(car.v || 0)) : Math.abs(car.v || 0) * 2.4;
    camOut = place3q(car, 5.2, 1.35, 5.4, 0, 0.75, 0.2, 44);
    releaseKeys();
    metrics = { rollDeg: round(Math.abs(bodyRoll) / DEG, 2), speedMph: round(speedMph, 1), carRollField: round(((car._roll || 0) / DEG), 2) };
    stateText = "BODY ROLL " + metrics.rollDeg.toFixed(1) + " DEG AT " + Math.round(speedMph) + " MPH";
    detailText = how + " · style " + (grp.userData.carStyle || "?");
  } else if (S.live === "night") {
    try { if (CBZ.dayPhase) CBZ.dayPhase(0.75); } catch (e) {}
    const car = L.car = spawnOnRoad(S.model || "Voltra Ion", 0.1);
    if (!car) { bigText = "NO CAR"; paint(); return { ok: true, subject: S.id, staged: false }; }
    how = sitIn(car, "driver");
    try { if (CBZ.carFpSetView) CBZ.carFpSetView(false); } catch (e) {}
    dismissHelp();
    tick(90, 3);
    camOut = place3q(car, -3.6, 1.05, 6.8, 0, 0.7, 1.2, 46);
    stateText = "MIDNIGHT · NIGHT AMOUNT " + round(CBZ.nightAmount || 0, 2);
    detailText = how;
    metrics = { night: round(CBZ.nightAmount || 0, 2) };
  } else {
    try { if (CBZ.dayPhase) CBZ.dayPhase(0.40); } catch (e) {}
    const car = L.car = spawnOnRoad(S.model || "Voltra Ion", 0.2);
    if (!car) { bigText = "NO CAR"; paint(); return { ok: true, subject: S.id, staged: false }; }
    how = sitIn(car, S.seat);
    dismissHelp();
    if (CBZ.carFpSetView) CBZ.carFpSetView(true);
    else if (CBZ.carFpToggle && !(CBZ.carFpActive && CBZ.carFpActive())) CBZ.carFpToggle();
    if (CBZ.cam) { CBZ.cam.yaw = (car.heading || 0) + Math.PI; CBZ.cam.pitch = 0; }
    if (S.seat === "passenger" && CBZ.cam) CBZ.cam.yaw += 0.25;   // glance across at the driver's side
    if (CBZ.camFreeLook) { try { CBZ.camFreeLook(S.seat === "passenger"); } catch (e) {} }
    tick(50, S.rolling ? 7 : 0);
    const cam = CBZ.camera;
    const vis = (car.group.userData && car.group.userData.carVisual) || car.group;
    let local = null;
    if (cam && vis) { vis.updateWorldMatrix(true, false); local = cam.position.clone().applyMatrix4(new T.Matrix4().copy(vis.matrixWorld).invert()); }
    const layout = seatLayout(car);
    metrics = { eyeX: local ? round(local.x, 2) : 0, eyeZ: local ? round(local.z, 2) : 0, seats: layout ? layout.length : 0 };
    stateText = (S.seat || "").toUpperCase() + " SEAT · EYE x " + metrics.eyeX + " z " + metrics.eyeZ + (layout ? " · " + layout.length + " SEATS IN THIS CAR" : "");
    detailText = how + " · style " + (car.group.userData.carStyle || "?");
    camOut = cam ? { pos: cam.position.toArray(), fov: cam.fov } : null;
  }
  dismissHelp();
  liveMode();
  paint();
  ST.render();
  return { ok: true, subject: S.id, staged: true, camera: camOut, metrics: metrics, notes: notes.concat(L.notes) };
}

export default {
  id: "car-showcase",
  title: "Car showcase: every class, driven, and sat in",
  description: "Five studio plates built by the page's own traffic builder (lineup of every class, hero three-quarter, wheel and arch, front lamps, SUV with doors open) and five live plates in the real city (mid-turn body roll, midnight with lamps on, driver's seat, passenger seat riding, third row of a six-seat SUV).",
  beforeLabel: "BEFORE · MAIN",
  afterLabel: "AFTER · CAR WAVE",
  viewport: { width: 1200, height: 720 },
  readyExpression: "window.THREE && window.CBZ && CBZ.CONFIG && typeof CBZ.cityBuildAmbientCarVisual === 'function'",
  urlParams: { seed: 90210 },
  stageTimeoutMs: 600000,
  defaultFocus: "Does it look and feel like a real car, outside and in?",
  pairNote: "Same seed · same builder · same studio · same tripod",
  method: "Studio plates: the photographed build's own cityBuildAmbientCarVisual on a studio floor (sRGB + ACES like the game, one warm shadowing key, a cool rim), tripods resolved on the BEFORE side and copied. Live plates: the real world booted with requestAnimationFrame frozen and CBZ.stepSim as the clock; cars spawned with citySpawnOwnedCar on the longest downtown road; seats taken with the build's seat model when it has one (CBZ.carSeatDebug), else cityEnterVehicle and citySeatShift.",
  metricsNote: "avgTris/avgMeshes: per car in the lineup. rollDeg: the body's lean in the photographed tick of a hard turn. eyeX/eyeZ: the camera in the car's own frame (+x is the driver's side).",
  metrics: {
    avgTris: { label: "Lineup: triangles per car" },
    avgMeshes: { label: "Lineup: meshes per car", better: "lower" },
    classes: { label: "Lineup: classes built", better: "higher" },
    tris: { label: "Triangles in the car" },
    meshes: { label: "Meshes in the car" },
    rollDeg: { label: "Body roll mid-turn (deg)", better: "higher" },
    speedMph: { label: "Speed in the turn (mph)" },
    seats: { label: "Seats in the car", better: "higher" },
  },
  subjects: subjects,
  stage: stageCarShowcase,
};
