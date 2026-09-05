/* Car first-person seats — what the PLAYER sees from inside a car in the city.

   Three live plates, the real world, the real camera, the real car:
     01 the driver's seat   ([V] in a car — city/view.js carFpPose)
     02 the shotgun seat    (citySeatShift → the same view from the other chair)
     03 the drive-by        (shotgun seat, a gun in hand, aimed out of the window)

   Both sides run this SAME file. Everything is feature-detected and MEASURED:
   the camera's position in the car's own frame (which side of the cabin the
   eye is on, how far outboard of the door line it went), whether the gun
   viewmodel is on screen, whether bullets exist, what fraction of the frame
   the cabin geometry covers. A build that has no drive-by simply photographs
   what it does instead, and the numbers say so.

   The world boots once per side with requestAnimationFrame frozen and
   CBZ.stepSim as the only clock, so both builds sample the same simulated
   seconds on any machine. The camera is NOT ours: it is whatever the game's
   own camera system wrote on the last tick — the thing being photographed. */

const subjects = [
  {
    id: "fp-driver",
    label: "01 · Driver's seat, rolling",
    seat: "driver",
    focus: "The driver's eye. Is this a car? Wheel and hands under the eye, cluster behind the rim, a dash that meets the base of the windscreen, A-pillars, a mirror, a door card and a sill beside the elbow, the road ahead through glass — or a few floating slabs in a box.",
  },
  {
    id: "fp-passenger",
    label: "02 · Shotgun seat, rolling",
    seat: "shotgun",
    focus: "Slid across to the passenger side. The camera must be on the passenger's side of the cabin (eyeSideM negative), looking past the wheel and the driver's chair on the other side, with the glovebox and dash in front and the door beside the right elbow.",
  },
  {
    id: "fp-driveby",
    label: "03 · Shotgun seat, leaning out the window with an Uzi",
    seat: "shotgun",
    driveby: true,
    focus: "Riding shotgun with a gun drawn and aimed out of the side window. The head should be at (or past) the door line, the window frame and door top in view, the gun viewmodel in hand and the street outside the car in the sights — not a chase camera, not a gun-less cabin.",
  },
];

async function stageCarFpSeats(input) {
  const T = window.THREE;
  const CBZ = window.CBZ;
  if (!T || !CBZ) return { ok: false, error: "no window.THREE / window.CBZ" };
  const S = input.subject || {};

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

  // ---- the page-wide rig: an overlay for captions + the render hook ---------
  let ST = window.__cbzCarFpSeats;
  if (!ST) {
    const overlay = document.createElement("div");
    overlay.id = "__cbzCarFpSeatsOverlay";
    overlay.style.cssText =
      "position:fixed;inset:0;pointer-events:none;color:#f4f8fb;text-shadow:0 2px 9px #000;z-index:2147483600;" +
      "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    overlay.innerHTML = "<div data-side></div><div data-name></div><div data-focus></div>" +
      "<div data-state></div><div data-detail></div><div data-big></div>";
    document.body.appendChild(overlay);
    ST = window.__cbzCarFpSeats = { overlay: overlay, live: null };
    ST.render = function () {
      try { if (CBZ.renderer && CBZ.scene && CBZ.camera) CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (e) {}
    };
    window.__cbzVisualCompare = { render: ST.render };
  }
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
  const allVisible = function () {
    const kids = Array.prototype.slice.call(document.body.children);
    for (let i = 0; i < kids.length; i++) kids[i].style.visibility = "";
  };
  const liveMode = function () {
    const gameCanvas = CBZ.renderer && CBZ.renderer.domElement;
    showOnly([gameCanvas, ST.overlay]);
  };

  let stateText = "", detailText = "", bigText = "";
  const paint = function () {
    const o = ST.overlay;
    const q = function (k) { return o.querySelector("[data-" + k + "]"); };
    const side = q("side"), name = q("name"), focus = q("focus"), st = q("state"), det = q("detail"), big = q("big");
    side.textContent = input.side === "before" ? (input.beforeLabel || "BEFORE") : (input.afterLabel || "AFTER");
    side.style.cssText = "position:absolute;left:18px;top:14px;font:700 13px/1 sans-serif;letter-spacing:.14em;padding:7px 10px;border-radius:4px;background:" +
      (input.side === "before" ? "#8d2323" : "#1f6f3a");
    name.textContent = S.label || S.id || "";
    name.style.cssText = "position:absolute;left:18px;top:44px;font:700 20px/1.2 sans-serif";
    focus.textContent = S.focus || "";
    focus.style.cssText = "position:absolute;left:18px;right:18px;top:72px;font:400 12px/1.35 sans-serif;opacity:.86;max-width:760px";
    st.textContent = stateText;
    st.style.cssText = "position:absolute;left:18px;bottom:34px;font:700 13px/1.3 sans-serif;letter-spacing:.06em";
    det.textContent = detailText;
    det.style.cssText = "position:absolute;left:18px;right:18px;bottom:14px;font:400 11px/1.3 monospace;opacity:.9";
    big.textContent = bigText;
    big.style.cssText = "position:absolute;left:0;right:0;top:44%;text-align:center;font:800 34px/1.1 sans-serif;letter-spacing:.06em;" +
      (bigText ? "" : "display:none");
  };

  // ---- boot the world once per side ------------------------------------------
  allVisible();
  let L = ST.live;
  if (!L) {
    const booted = await until(function () {
      return CBZ.game && (CBZ.bootComplete || CBZ.game.state === "title") &&
        typeof CBZ.stepSim === "function" && document.getElementById("playBtn");
    }, 300000);
    if (!booted) {
      liveMode(); bigText = "WORLD NEVER BOOTED"; stateText = "NO PLAY BUTTON / NO CBZ.stepSim WITHIN 300s"; paint();
      return { ok: true, subject: S.id, staged: false, error: "never booted" };
    }
    if (CBZ.CONFIG) { CBZ.CONFIG.CITY_HITMAN_CAMPAIGN = false; CBZ.CONFIG.CONTROLS_AUTO = false; }
    const playing = await until(function () {
      if (CBZ.game.state === "playing") return true;
      const b = document.getElementById("playBtn");
      if (b) b.click();
      return CBZ.game.state === "playing";
    }, 120000, 300);
    if (!playing) {
      liveMode(); bigText = "NEVER REACHED PLAYING"; stateText = "game " + CBZ.game.state; paint();
      return { ok: true, subject: S.id, staged: false, error: "never playing" };
    }
    if (CBZ.game.cityCampaign) CBZ.game.cityCampaign.phase = "endless_contracts";
    try { if (CBZ.setQualityLevel) CBZ.setQualityLevel(3); } catch (e) {}
    try { if (CBZ.dayPhase) CBZ.dayPhase(0.42); } catch (e) {}
    window.requestAnimationFrame = function () { return 0; };
    await wait(700);
    L = ST.live = { simT: 0, car: null, notes: [] };
    for (let i = 0; i < 120; i++) { CBZ.hitstop = 0; CBZ.slowmo = 0; try { CBZ.stepSim(1 / 60); } catch (e) {} L.simT += 1 / 60; }
  }
  liveMode();

  const tick = function (n, speed) {
    const count = n == null ? 1 : n;
    for (let i = 0; i < count; i++) {
      // systems/glcontext.js pauses the game on a lost WebGL context (a loaded
      // machine does that); a paused sim never boards, so resume and carry on
      if (CBZ.game && CBZ.game.state === "paused") { try { if (CBZ.resumeGame) CBZ.resumeGame(); else CBZ.game.state = "playing"; } catch (e) {} }
      CBZ.hitstop = 0; CBZ.slowmo = 0;
      // a push, not a forced velocity: a car driven INTO a wall at a held
      // speed crashes on every tick and frosts its own glass (measured), so
      // the speed is set once and the car coasts on its own friction
      if (speed != null && i === 0 && L.car && !L.car.dead && Math.abs(L.car.v || 0) < speed) { L.car.v = speed; }
      try { CBZ.stepSim(1 / 60); } catch (e) {}
      L.simT += 1 / 60;
      try { if (CBZ.player) { CBZ.player.hp = 100; CBZ.player.wanted = 0; } } catch (e) {}
    }
  };
  const dismissHelp = function () {
    // the card's own verb, never a synthetic Escape: with no card up, Escape
    // is the pause menu and the whole world stops (measured)
    try { if (CBZ.controls && CBZ.controls.hide) CBZ.controls.hide(); } catch (e) {}
    try {
      const all = document.querySelectorAll("div");
      for (let i = 0; i < all.length; i++) {
        const t = all[i].textContent || "";
        if (t.indexOf("Accelerate / brake") >= 0 && t.length < 400) all[i].style.display = "none";
      }
    } catch (e) {}
  };

  // ---- board the car (once per side) ------------------------------------------
  if (!L.car) {
    const P = CBZ.player;
    /* ON THE LONGEST AVENUE, POINTED DOWN IT. The car used to spawn beside the
       player, which on one build put a parked van across the windscreen and a
       building wall against the passenger window — the plate then compared
       scenery, not cabins. The longest road is the same road on both sides. */
    let road = null;
    try {
      const roads = (CBZ.city && CBZ.city.arena && CBZ.city.arena.roads) || [];
      // the longest DOWNTOWN road: the 17 km highway is the longest of all and
      // photographs a hillside, not the gang city the ask is about
      for (let i = 0; i < roads.length; i++) {
        const r = roads[i];
        if (!r || !r.len || r.len > 1500) continue;
        if (!road || r.len > road.len) road = r;
      }
    } catch (e) {}
    const px = road ? road.x - (road.vertical ? 0 : road.len * 0.2) : ((P && P.pos) ? P.pos.x + 4.5 : 0);
    const pz = road ? road.z - (road.vertical ? road.len * 0.2 : 0) : ((P && P.pos) ? P.pos.z + 1.5 : 0);
    const heading = road ? (road.vertical ? 0 : Math.PI / 2) : 0;
    let car = null;
    try { if (CBZ.citySpawnOwnedCar) car = CBZ.citySpawnOwnedCar(px, pz, "Voltra Ion"); } catch (e) { L.notes.push("spawn " + msg(e)); }
    if (!car) { try { if (CBZ.citySpawnOwnedCar) car = CBZ.citySpawnOwnedCar(px, pz); } catch (e) { L.notes.push("spawn2 " + msg(e)); } }
    if (car) {
      try {
        car.heading = heading;
        if (car.group) car.group.rotation.y = heading;
        car.v = 0; car.vx = 0; car.vz = 0;
        if (P && P.pos) P.pos.set(car.pos.x + 1.4, P.pos.y, car.pos.z);
        if (CBZ.cityEnterVehicle) CBZ.cityEnterVehicle(car);
      } catch (e) { L.notes.push("enter " + msg(e)); }
    } else L.notes.push("no owned car");
    if (road) L.notes.push("road " + Math.round(road.len) + " m " + (road.vertical ? "N-S" : "E-W"));
    L.car = car || null;
    // boarding is a WALK to the door (city/boarding.js), not a teleport: step
    // until the seat is actually taken, with a ceiling, before asking for a view
    for (let i = 0; i < 420; i++) {
      tick(1, 0);
      if (car && P && P.driving && P._vehicle === car && i > 20) break;
    }
    if (car && !(P && P.driving && P._vehicle === car)) L.notes.push("never boarded within 7 s");
    dismissHelp();
  }
  const car = L.car;
  if (!car) {
    bigText = "NO CAR"; stateText = L.notes.join(" · "); paint();
    return { ok: true, subject: S.id, staged: false, error: "no car" };
  }

  // ---- the seat this plate wants ----------------------------------------------
  const wantPax = S.seat === "shotgun";
  const paxNow = function () { return !!(CBZ.cityPaxAboard && CBZ.cityPaxAboard(car)); };
  if (CBZ.citySeatShift) {
    if (wantPax && !paxNow()) CBZ.citySeatShift({ to: "shotgun", quiet: true });
    if (!wantPax && paxNow()) CBZ.citySeatShift({ to: "driver", quiet: true });
  } else if (wantPax) L.notes.push("no citySeatShift on this build");
  tick(10, 0);

  // first person in the car: the game's own toggle, judged by the camera
  if (CBZ.carFpSetView) CBZ.carFpSetView(true);
  else if (CBZ.carFpToggle && !(CBZ.carFpActive && CBZ.carFpActive())) CBZ.carFpToggle();
  else if (!CBZ.carFpToggle) L.notes.push("no car first person on this build");
  // eyes forward: a neutral look, identical on both sides
  if (CBZ.cam) { CBZ.cam.yaw = (car.heading || 0) + Math.PI; CBZ.cam.pitch = 0; }
  if (CBZ.camFreeLook) { try { CBZ.camFreeLook(false); } catch (e) {} }

  // ---- the drive-by ---------------------------------------------------------------
  // aim across the street out of THIS seat's window: +X is the car's left
  // (the driver's window), so the shotgun seat looks to -X
  const winYaw = wantPax ? -1.05 : 1.05;
  let gunGiven = 0, leanAsked = 0, leanApi = "none";
  if (S.driveby) {
    try { if (CBZ.cityGiveWeapon) { CBZ.cityGiveWeapon("Uzi"); gunGiven = 1; } } catch (e) { L.notes.push("gun " + msg(e)); }
    try { if (CBZ.cityAddAmmo) CBZ.cityAddAmmo(200); } catch (e) {}
    // the lean: whatever verb this build has. New builds publish carLeanOut;
    // older ones only have the aim button, which does nothing while driving.
    if (typeof CBZ.carLeanOut === "function") { CBZ.carLeanOut(true); leanAsked = 1; leanApi = "carLeanOut"; }
    if (CBZ.fpsSetAim) { CBZ.fpsSetAim(true); if (!leanAsked) { leanAsked = 1; leanApi = "fpsSetAim"; } }
    // aim across the street out of THIS seat's window: +X is the car's left
    // (the driver's window), so the shotgun seat looks to -X
    if (CBZ.cam) { CBZ.cam.yaw = (car.heading || 0) + Math.PI + winYaw; CBZ.cam.pitch = 0.12; }
    if (CBZ.camFreeLook) { try { CBZ.camFreeLook(true); } catch (e) {} }
  }

  // ---- roll ------------------------------------------------------------------------
  tick(60, 6);
  if (S.driveby) {
    // pull the trigger mid-roll so a muzzle flash / tracer can be in frame
    try { if (CBZ.fpsFire) CBZ.fpsFire(true); } catch (e) {}
    if (CBZ.cam) { CBZ.cam.yaw = (car.heading || 0) + Math.PI + winYaw; CBZ.cam.pitch = 0.12; }
    tick(6, 6);
    try { if (CBZ.fpsFire) CBZ.fpsFire(false); } catch (e) {}
    tick(1, 6);
  }

  // ---- MEASURE ----------------------------------------------------------------------
  dismissHelp();
  liveMode();                       // anything the ticks raised (help card, HUD) goes away
  const cam = CBZ.camera;
  if (cam) cam.updateMatrixWorld(true);
  const grp = car.group;
  const vis = (grp && grp.userData && grp.userData.carVisual) || grp;
  let ci = null;
  try { ci = CBZ.carCabinInfo ? CBZ.carCabinInfo(car) : null; } catch (e) {}
  let local = null;
  if (cam && vis) {
    vis.updateWorldMatrix(true, false);
    local = new T.Vector3().copy(cam.position);
    local.applyMatrix4(new T.Matrix4().copy(vis.matrixWorld).invert());
  }
  const halfW = ci ? ci.w * 0.5 : 0.9;
  const camInCabin = (local && ci)
    ? ((Math.abs(local.x) <= halfW + 0.05 && local.y >= (ci.floorY != null ? ci.floorY : ci.baseY - 0.5) && local.y <= (ci.roofY != null ? ci.roofY + 0.05 : ci.baseY + ci.peakY + 0.1)) ? 1 : 0)
    : 0;
  const eyeSideM = local ? round(local.x, 3) : 0;
  const leanOutM = local ? round(Math.max(0, Math.abs(local.x) - halfW), 3) : 0;
  const fpsOn = !!(CBZ.fps && CBZ.fps.active);
  const carFpOn = !!(CBZ.carFpActive && CBZ.carFpActive());
  // is a gun viewmodel on screen? fpsmode keeps it at CBZ.fpsWeaponModels; the
  // parent group is what is toggled — find the first visible ancestor chain
  let vmVisible = 0;
  try {
    const models = CBZ.fpsWeaponModels || [];
    for (let i = 0; i < models.length; i++) {
      const m = models[i];
      if (!m) continue;
      let o = m, vis2 = true;
      while (o) { if (o.visible === false) { vis2 = false; break; } o = o.parent; }
      if (vis2 && o === null) { vmVisible = 1; break; }
    }
  } catch (e) {}
  let bulletsLive = 0;
  try { bulletsLive = CBZ.fpsBulletsInFlight ? CBZ.fpsBulletsInFlight() : 0; } catch (e) {}
  // cabin coverage: how much of the frame is car geometry within 2.5 m of the eye
  let cabinCoverPct = 0;
  try {
    const rc = new T.Raycaster();
    rc.near = 0.02; rc.far = 2.6;
    const targets = [];
    grp.traverse(function (o) { if (o.isMesh && o.visible) targets.push(o); });
    let hit = 0, n = 0;
    const N = 18;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const nd = new T.Vector2((x + 0.5) / N * 2 - 1, -((y + 0.5) / N * 2 - 1));
      rc.setFromCamera(nd, cam);
      const hits = rc.intersectObjects(targets, false);
      n++; if (hits.length) hit++;
    }
    cabinCoverPct = round(100 * hit / Math.max(1, n), 1);
  } catch (e) { L.notes.push("cover " + msg(e)); }
  // meshes of the car within 1.2 m of the eye (the near cabin: door, sill, wheel, dash)
  let nearMeshes = 0;
  try {
    const bb = new T.Box3(), c = new T.Vector3();
    grp.traverse(function (o) {
      if (!o.isMesh || !o.visible) return;
      bb.setFromObject(o); bb.getCenter(c);
      if (c.distanceTo(cam.position) < 1.2) nearMeshes++;
    });
  } catch (e) {}
  const speed = round(Math.abs(car.v || 0), 2);

  stateText = (carFpOn ? "CAR FIRST PERSON" : (fpsOn ? "FPS MODE" : "CHASE CAMERA")) +
    (wantPax ? (paxNow() ? " · SHOTGUN SEAT" : " · ASKED FOR SHOTGUN, STILL DRIVER") : " · DRIVER") +
    (S.driveby ? (vmVisible ? " · GUN UP" : " · NO GUN ON SCREEN") : "");
  detailText = "eye x " + eyeSideM + " m (cabin half " + round(halfW, 2) + ") · lean " + leanOutM + " m · inCabin " + camInCabin +
    " · cover " + cabinCoverPct + "% · near meshes " + nearMeshes + " · speed " + speed +
    (S.driveby ? " · lean via " + leanApi + " · bullets " + bulletsLive : "") +
    (L.notes.length ? " · " + L.notes.join(" · ") : "");
  paint();
  ST.render();

  return {
    ok: true, subject: S.id, staged: true,
    metrics: {
      carFirstPerson: carFpOn ? 1 : 0,
      camInCabin: camInCabin,
      eyeSideM: eyeSideM,
      leanOutM: leanOutM,
      passengerSeated: wantPax ? (paxNow() ? 1 : 0) : 0,
      gunViewmodel: S.driveby ? vmVisible : 0,
      bulletsLive: S.driveby ? bulletsLive : 0,
      cabinCoverPct: cabinCoverPct,
      nearCabinMeshes: nearMeshes,
    },
    notes: L.notes.slice(),
  };
}

export default {
  id: "car-fp-seats",
  title: "Car first person: the driver's seat, the shotgun seat, the drive-by",
  description: "Three live plates of what the player sees from inside a car in the city: at the wheel, riding shotgun, and riding shotgun with a gun out of the window. The world boots once per side, the game's own seat verbs are used, and the camera photographed is the one the game's own camera system wrote.",
  beforeLabel: "BEFORE · HEAD",
  afterLabel: "AFTER · LOCAL",
  viewport: { width: 1100, height: 680 },
  readyExpression: "window.THREE && window.CBZ && CBZ.CONFIG && typeof CBZ.cityEnterVehicle === 'function'",
  urlParams: { seed: 90210 },
  stageTimeoutMs: 600000,
  defaultFocus: "Does this read as sitting inside a real car?",
  pairNote: "Same seed · same car · same seat verb · same look direction · same sim seconds",
  method: "Both sides boot the real world with requestAnimationFrame frozen and step CBZ.stepSim. An owned car is spawned and entered with cityEnterVehicle, the seat is chosen with citySeatShift, first person with carFpSetView, and for the drive-by an Uzi is given with cityGiveWeapon and the lean verb the build exposes is called. The camera is read back in the car's own frame.",
  metricsNote: "eyeSideM: the camera's x in the car's frame (+ is the driver's side, - the passenger's). leanOutM: how far the eye is outboard of the cabin wall. cabinCoverPct: fraction of the frame where car geometry sits within 2.6 m of the eye. nearCabinMeshes: car meshes within 1.2 m of the eye.",
  metrics: {
    carFirstPerson: { label: "Car first person mounted", better: "higher" },
    camInCabin: { label: "Camera inside the cabin" },
    eyeSideM: { label: "Eye x in car frame (m)" },
    leanOutM: { label: "Eye outboard of cabin wall (m)" },
    passengerSeated: { label: "Passenger seat taken", better: "higher" },
    gunViewmodel: { label: "Gun viewmodel on screen", better: "higher" },
    bulletsLive: { label: "Bullets in the air", better: "higher" },
    cabinCoverPct: { label: "Frame covered by near cabin (%)" },
    nearCabinMeshes: { label: "Car meshes within 1.2 m of eye" },
  },
  subjects: subjects,
  stage: stageCarFpSeats,
};
