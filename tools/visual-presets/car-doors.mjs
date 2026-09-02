/* Car doors — the body is HOLLOW where its doors are.

   THE ASK (owner, verbatim): "when door opens and shit car really isnt hollow
   its not geometrically realistic, and it just doesnt look real enough."

   WHAT EACH PLATE PHOTOGRAPHS. The page's own car builder
   (CBZ.cityBuildAmbientCarVisual — the exact traffic pipeline, merge and all)
   builds the car, and the page's own boarding verb (CBZ.boarding.door) opens
   the driver's door on BOTH sides. On the deployed build that verb conjures a
   5 cm slab with a pane on it and swings it over a solid flank; on the local
   build it swings the real hinged door out of a real aperture. Same builder,
   same verb, same tripod — the source change is the only variable.

   MEASURED, NOT EYEBALLED. With every door object hidden, a ray is fired
   inboard through the middle of the driver's door opening at hip height:
   the distance it travels past the flank line before it hits anything is
   `apertureDepthM`. A solid flank stops it at ~0; a real aperture lets it
   run to the console or the far door card. `windowCutM` does the same
   through the window area. `doorThicknessM` is the shut door's extent across
   the car (a slab is 0.055; a skin + card is ~0.12). `doorMeshes` counts what
   the door object is made of. Studio plates share a fixed tripod resolved on
   the BEFORE side and copied to the AFTER side verbatim.

   The last plate is LIVE: the real city, a real car placed by cityMakeCar,
   the real cityEnterVehicle arc, photographed the tick the door is open —
   the moment the complaint is about. It boots the world, so it goes last
   and is the one plate allowed to fail without killing the run. */

const subjects = [
  {
    id: "sedan-door-open",
    label: "01 · Sedan, driver's door open",
    kind: "studio", model: "Voltra Ion", color: 0x1d4f8f,
    open: ["driver"],
    view: { azDeg: 106, camY: 1.5, dist: 5.0, fov: 38, aim: "door" },
    focus: "Rear three-quarter from the driver's side, looking past the open door into the opening. Is there a hole in the car where the door was — sill, jamb, seat, console, the far door card — or is the flank still a painted wall with a slab hanging off it?",
  },
  {
    id: "sedan-door-edge",
    label: "02 · The door itself, from behind the hinge",
    kind: "studio", model: "Voltra Ion", color: 0x1d4f8f,
    open: ["driver"],
    view: { azDeg: 112, camY: 1.15, dist: 2.6, fov: 42, aim: "door" },
    focus: "Looking along the open door from the rear quarter. A real door has an edge: the skin, the card behind it, an armrest and a pull, a window in a frame, hinges at the leading edge, and the aperture it came out of behind it.",
  },
  {
    id: "suv-both-doors",
    label: "03 · SUV, front and rear doors open",
    kind: "studio", model: "Bison Frontier", color: 0x2e3a4a,
    open: ["driver", "rearL"],
    view: { azDeg: 102, camY: 1.9, dist: 6.0, fov: 40, aim: "cabin" },
    focus: "Two apertures with a B-pillar between them. The rear bench and the front seat are visible through the openings; each door carries its own window, so no glass is left standing in the body behind an open door.",
  },
  {
    id: "coupe-door-open",
    label: "04 · Coupe, one long door",
    kind: "studio", model: "Adler 901 Turbo", color: 0xf3cf39,
    open: ["driver"],
    view: { azDeg: 106, camY: 1.3, dist: 4.8, fov: 38, aim: "door" },
    focus: "A two-door body gets one long door per side, hinged at the A-pillar. The opening runs from the front arch back past the seat.",
  },
  {
    id: "sedan-shut",
    label: "05 · Same sedan, doors shut",
    kind: "studio", model: "Voltra Ion", color: 0x1d4f8f,
    open: [],
    view: { azDeg: 106, camY: 1.5, dist: 5.0, fov: 38, aim: "door" },
    focus: "The control plate. Shut, the car must read as it always did — the shut line, the handle and the window are now the door's own, so the silhouette should not change.",
  },
  {
    id: "live-walkup",
    label: "06 · LIVE: walking up and opening the door",
    kind: "live",
    focus: "The real city, a real car, the real cityEnterVehicle arc, photographed the tick the door reaches open. This is the moment the complaint is about.",
  },
];

async function stageCarDoors(input) {
  const T = window.THREE;
  const CBZ = window.CBZ;
  if (!T || !CBZ) return { ok: false, error: "no window.THREE / window.CBZ" };
  const S = input.subject || {};
  const kind = S.kind || "studio";
  const DEG = Math.PI / 180;
  const round = function (v, n) {
    const k = Math.pow(10, n == null ? 3 : n);
    return Number.isFinite(Number(v)) ? Math.round(Number(v) * k) / k : 0;
  };
  const wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  const until = async function (test, budgetMs, stepMs) {
    const deadline = Date.now() + (budgetMs || 30000);
    while (Date.now() < deadline) {
      try { if (test()) return true; } catch (e) {}
      await wait(stepMs || 250);
    }
    return false;
  };

  // ---- the page-wide rig: one studio renderer, one overlay, a mode switch --
  let ST = window.__cbzCarDoors;
  if (!ST) {
    const renderer = new T.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setSize(input.width, input.height, false);
    renderer.domElement.style.cssText =
      "position:fixed;left:0;top:0;display:block;width:" + input.width + "px;height:" + input.height + "px;z-index:2147483000";
    document.body.appendChild(renderer.domElement);
    const overlay = document.createElement("div");
    overlay.style.cssText =
      "position:fixed;inset:0;pointer-events:none;color:#f4f8fb;text-shadow:0 2px 9px #000;z-index:2147483600;" +
      "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    overlay.innerHTML = "<div data-side></div><div data-name></div><div data-focus></div>" +
      "<div data-state></div><div data-detail></div><div data-source></div><div data-big></div>";
    document.body.appendChild(overlay);
    ST = window.__cbzCarDoors = { renderer: renderer, overlay: overlay, canvas: renderer.domElement, scene: null, camera: null, mode: "studio", live: null };
    ST.render = function () {
      try {
        if (ST.mode === "live") { if (CBZ.renderer && CBZ.scene && CBZ.camera) CBZ.renderer.render(CBZ.scene, CBZ.camera); }
        else if (ST.scene && ST.camera) ST.renderer.render(ST.scene, ST.camera);
      } catch (e) {}
    };
    window.__cbzVisualCompare = { render: ST.render };
  }
  ST.renderer.setSize(input.width, input.height, false);
  ST.canvas.style.width = input.width + "px";
  ST.canvas.style.height = input.height + "px";
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

  // ---- overlay ------------------------------------------------------------
  let stateText = "", detailText = "", bigText = "";
  const paint = function () {
    const before = input.side === "before";
    const q = function (sel) { return ST.overlay.querySelector(sel); };
    const el = { side: q("[data-side]"), name: q("[data-name]"), focus: q("[data-focus]"), state: q("[data-state]"), detail: q("[data-detail]"), source: q("[data-source]"), big: q("[data-big]") };
    el.side.textContent = before ? input.beforeLabel : input.afterLabel;
    el.side.style.cssText = "position:absolute;top:22px;left:26px;padding:7px 11px;border-radius:7px;background:" + (before ? "#c94c4c" : "#218b60") + ";font-size:12px;font-weight:900;letter-spacing:.12em";
    el.name.textContent = S.label || S.id;
    el.name.style.cssText = "position:absolute;top:64px;left:26px;font-size:27px;font-weight:800;letter-spacing:-.02em";
    el.focus.textContent = S.focus || "";
    el.focus.style.cssText = "position:absolute;top:101px;left:28px;color:#c4d2dd;font-size:13px;font-weight:550;max-width:700px;line-height:1.35";
    el.state.textContent = stateText;
    el.state.style.cssText = "position:absolute;right:26px;top:24px;color:" + (before ? "#ff9c9c" : "#80e4b4") + ";font-size:11px;font-weight:850;letter-spacing:.11em;text-align:right;max-width:430px;line-height:1.5";
    el.detail.textContent = detailText;
    el.detail.style.cssText = "position:absolute;right:24px;bottom:18px;color:#9fb0bd;font:10px ui-monospace,SFMono-Regular,Menlo,monospace;text-align:right;max-width:600px;line-height:1.45;white-space:pre-line";
    let host = input.sourceUrl;
    try { const u = new URL(input.sourceUrl); host = u.host + u.pathname; } catch (e) {}
    el.source.textContent = host;
    el.source.style.cssText = "position:absolute;bottom:18px;left:26px;color:#9cb0bf;font:11px ui-monospace,SFMono-Regular,Menlo,monospace";
    el.big.textContent = bigText;
    el.big.style.cssText = bigText ? "position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:38px;font-weight:900;letter-spacing:.10em;color:#7f8f9d;text-align:center;padding:0 60px" : "display:none";
  };

  // ---- the door objects of a car, whichever build made them ---------------
  // deployed: boarding.js leaf groups (userData._cbzDoorLeaf, in the tree)
  // local:    playercars.js door groups (userData.carDoor), which live on the
  //           visual's door rig and are PARKED off the graph while shut, plus
  //           the baked shut copies (userData.doorsShut)
  const visualOf = function (grp) { return (grp.userData && grp.userData.carVisual) || grp; };
  const doorObjects = function (grp) {
    const vis = visualOf(grp);
    const out = [];
    vis.traverse(function (o) {
      if (o.userData && (o.userData._cbzDoorLeaf || o.userData.carDoor) && o.type === "Group") out.push(o);
      if (o.userData && o.userData.doorsShut) out.push(o);
    });
    const rig = vis._cbzDoorRig;
    if (rig && rig.doors) for (let i = 0; i < rig.doors.length; i++) if (out.indexOf(rig.doors[i]) < 0) out.push(rig.doors[i]);
    return out;
  };
  const visibleChain = function (o) { for (let p = o; p; p = p.parent) if (p.visible === false) return false; return true; };
  // first thing a ray meets, ignoring hidden objects (r128's Raycaster does not)
  const firstHit = function (root, origin, dir) {
    const rc = new T.Raycaster(new T.Vector3().fromArray(origin), new T.Vector3().fromArray(dir).normalize(), 0.01, 20);
    const hits = rc.intersectObject(root, true);
    for (let i = 0; i < hits.length; i++) if (visibleChain(hits[i].object)) return hits[i];
    return null;
  };

  // ---- the measurements every studio plate reports -------------------------
  const measure = function (grp, veh) {
    const vis = visualOf(grp);
    const dims = (grp.userData && grp.userData.vehicleDims) || { width: 2, length: 4.5, height: 1.5 };
    const halfW = dims.width * 0.5;
    const ci = CBZ.carCabinInfo ? CBZ.carCabinInfo(veh) : null;
    const m = { apertureDepthM: 0, windowCutM: 0, doorThicknessM: 0, doorMeshes: 0, doorObjects: 0, realDoors: 0, hullTris: 0 };
    const doors = doorObjects(grp);
    m.doorObjects = doors.length;
    m.realDoors = CBZ.carDoors && CBZ.carDoors(veh) ? CBZ.carDoors(veh).length : 0;
    // shut-door thickness: the driver's door object, rotation zero, extent across the car
    const driverDoor = doors.filter(function (o) {
      return (o.userData._cbzDoorLeaf === "driver") || (o.userData.carDoor && o.userData.carDoor.id === "FL");
    })[0] || null;
    if (driverDoor) {
      const rot = driverDoor.rotation.y, vis0 = driverDoor.visible;
      driverDoor.rotation.y = 0; driverDoor.visible = true;
      driverDoor.updateMatrixWorld(true);
      const bb = new T.Box3().setFromObject(driverDoor);
      m.doorThicknessM = round(bb.max.x - bb.min.x);
      let n = 0; driverDoor.traverse(function (o) { if (o.isMesh) n++; });
      m.doorMeshes = n;
      driverDoor.rotation.y = rot; driverDoor.visible = vis0;
      driverDoor.updateMatrixWorld(true);
    }
    // the hull, NEAR-side doors hidden: how far does a ray get past the flank
    // line? The far doors stay, so the honest ceiling is the far door card
    // (~width - 0.25); the shut bake is one mesh for all four and has to go.
    const near = doors.filter(function (o) {
      const ud = o.userData;
      if (ud.doorsShut) return true;
      if (ud.carDoor) return ud.carDoor.side > 0;
      return ud._cbzDoorLeaf === "driver" || ud._cbzDoorLeaf === "rearL";
    });
    const saved = near.map(function (o) { return o.visible; });
    near.forEach(function (o) { o.visible = false; });
    grp.updateMatrixWorld(true);
    if (ci) {
      const zRay = ci.seatZ + 0.35, yRay = ci.cushionY + 0.30;
      const h1 = firstHit(grp, [halfW + 2.0, yRay, zRay], [-1, 0, 0]);
      m.apertureDepthM = h1 ? round(halfW - h1.point.x) : round(dims.width);
      const yWin = ci.beltY + Math.max(0.10, (ci.roofY - ci.beltY) * 0.45);
      const h2 = firstHit(grp, [halfW + 2.0, yWin, zRay], [-1, 0, 0]);
      m.windowCutM = h2 ? round(halfW - h2.point.x) : round(dims.width);
      const desc = function (h) {
        if (!h) return "nothing";
        const o = h.object, mat = o.material && !Array.isArray(o.material) ? o.material : null;
        const bb = o.geometry && (o.geometry.boundingBox || (o.geometry.computeBoundingBox(), o.geometry.boundingBox));
        return (o.name || o.type) + (mat && mat.color ? " #" + mat.color.getHexString() : "") + (mat && mat.transparent ? " glass" : "") +
          (bb ? " bb=" + [bb.min.x, bb.min.y, bb.min.z, bb.max.x, bb.max.y, bb.max.z].map(function (v) { return round(v, 2); }).join("/") : "") +
          " at " + round(h.point.x, 2) + "," + round(h.point.y, 2) + "," + round(h.point.z, 2);
      };
      m._hipHit = desc(h1); m._winHit = desc(h2);
    }
    near.forEach(function (o, i) { o.visible = saved[i]; });
    let tris = 0;
    vis.traverse(function (o) { if (o.isMesh && o.geometry && o.geometry.attributes && o.geometry.attributes.position) tris += o.geometry.attributes.position.count / 3; });
    m.hullTris = Math.round(tris);
    return m;
  };

  // ---- studio scene ---------------------------------------------------------
  const aspect = input.width / input.height;
  const refCam = (input.referenceStage && input.referenceStage.camera) || null;
  const makeScene = function () {
    const scene = new T.Scene();
    scene.background = new T.Color(0x1c2836);
    scene.add(new T.HemisphereLight(0xdfeaff, 0x2a2620, 0.92));
    const key = new T.DirectionalLight(0xffe9c8, 1.5); key.position.set(7.5, 11.0, 6.5); scene.add(key);
    const rim = new T.DirectionalLight(0x8fc0ff, 0.66); rim.position.set(-8.0, 5.0, -7.5); scene.add(rim);
    const fill = new T.DirectionalLight(0xffffff, 0.26); fill.position.set(1.5, 3.5, -9.0); scene.add(fill);
    const g = new T.Mesh(new T.PlaneGeometry(300, 300), new T.MeshStandardMaterial({ color: 0x35393f, roughness: 0.97 }));
    g.rotation.x = -Math.PI / 2; scene.add(g);
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
    ST.renderer.render(scene, camera);
    return { pos: cam.pos.slice(), target: cam.target.slice(), up: (cam.up || [0, 1, 0]).slice(), fov: Number(cam.fov) || 45, matched: !!refCam };
  };

  if (kind === "studio") {
    studioMode();
    let grp = null, err = null;
    try { grp = CBZ.cityBuildAmbientCarVisual ? CBZ.cityBuildAmbientCarVisual(S.model) : null; } catch (e) { err = String(e && e.message || e); }
    if (!grp) {
      bigText = "NO CAR"; stateText = "cityBuildAmbientCarVisual FAILED"; detailText = err || "builder missing";
      const scene0 = makeScene();
      const cam0 = applyCamera(scene0, { pos: [0, 1.6, 6], target: [0, 1.6, 0], up: [0, 1, 0], fov: 45 });
      paint();
      return { ok: true, subject: S.id, staged: false, error: err, camera: cam0 };
    }
    if (S.color != null && CBZ.cityRecolorCarBody) { try { CBZ.cityRecolorCarBody(grp, S.color); } catch (e) {} }
    const scene = makeScene();
    grp.position.set(0, 0, 0); grp.rotation.set(0, 0, 0);
    scene.add(grp);
    scene.updateMatrixWorld(true);
    const veh = { group: grp, heading: 0, pos: grp.position, color: S.color };
    const notes = [];
    // open the doors the way the game does — its own verb, on both builds
    const opened = [];
    for (let i = 0; i < (S.open || []).length; i++) {
      let ok = false;
      try { ok = !!(CBZ.boarding && CBZ.boarding.door && CBZ.boarding.door(veh, S.open[i], 1)); } catch (e) { notes.push("door " + S.open[i] + ": " + (e && e.message)); }
      opened.push(S.open[i] + (ok ? "" : "(no door)"));
    }
    scene.updateMatrixWorld(true);
    const m = measure(grp, veh);
    // what the door actually is at render time, so a shut-looking plate says why
    try {
      const vis = visualOf(grp), rig = vis._cbzDoorRig;
      if (rig) {
        const fl = rig.doors.filter(function (g) { return g.userData.carDoor.id === "FL"; })[0];
        notes.push("FL t=" + (CBZ.carDoorOpenT ? CBZ.carDoorOpenT(veh, "FL") : "?") + " rotY=" + (fl ? round(fl.rotation.y, 2) : "?") +
          " parent=" + (fl && fl.parent ? fl.parent.type : "none") + " split=" + rig.split + " bakeVisible=" + (rig.shut[0] ? rig.shut[0].visible : "?") +
          " pos=" + (fl ? fl.position.toArray().map(function (v) { return round(v, 2); }).join(",") : "?"));
      }
    } catch (e) { notes.push("rig read: " + (e && e.message)); }
    const ci = CBZ.carCabinInfo ? CBZ.carCabinInfo(veh) : null;
    const dims = grp.userData.vehicleDims || { width: 2, length: 4.5 };
    const view = S.view || { azDeg: 58, camY: 1.45, dist: 4.6, fov: 38, aim: "door" };
    let aim;
    if (ci && view.aim === "door") aim = { x: dims.width * 0.5, y: ci.cushionY + 0.25, z: ci.seatZ + 0.35 };
    else if (ci) aim = { x: 0, y: ci.beltY, z: ci.seatZ - 0.2 };
    else aim = { x: 0, y: 0.8, z: 0 };
    const cam = applyCamera(scene, tripod(aim, view.azDeg, view.camY, view.dist, view.fov));
    stateText = (m.realDoors ? m.realDoors + " REAL DOORS" : "NO REAL DOORS · BOARDING LEAF") +
      " · APERTURE " + m.apertureDepthM.toFixed(2) + " m · DOOR " + m.doorThicknessM.toFixed(3) + " m THICK";
    detailText = "style " + (grp.userData.carStyle || "?") + " · opened " + (opened.join(",") || "none") +
      "\napertureDepthM " + m.apertureDepthM + " · windowCutM " + m.windowCutM + " · doorMeshes " + m.doorMeshes +
      " · doorObjects " + m.doorObjects + " · tris " + m.hullTris + "\nhip ray → " + m._hipHit + "\nwindow ray → " + m._winHit + (notes.length ? "\n" + notes.join(" · ") : "");
    paint();
    ST.render();
    return { ok: true, subject: S.id, staged: true, metrics: m, camera: cam, style: grp.userData.carStyle, opened: opened, notes: notes };
  }

  // ---- LIVE: the real arc -----------------------------------------------------
  allVisible();
  const booted = await until(function () {
    return CBZ.game && (CBZ.bootComplete || CBZ.game.state === "title") && typeof CBZ.stepSim === "function" && document.getElementById("playBtn");
  }, 300000);
  if (!booted) { liveMode(); bigText = "WORLD NEVER BOOTED"; paint(); return { ok: true, subject: S.id, staged: false, error: "never booted" }; }
  if (CBZ.CONFIG) CBZ.CONFIG.CITY_HITMAN_CAMPAIGN = false;
  const playing = await until(function () {
    if (CBZ.game.state === "playing") return true;
    const b = document.getElementById("playBtn"); if (b) b.click();
    return CBZ.game.state === "playing";
  }, 120000, 300);
  if (!playing) { liveMode(); bigText = "NEVER PLAYING"; paint(); return { ok: true, subject: S.id, staged: false, error: "never playing" }; }
  if (CBZ.game.cityCampaign) CBZ.game.cityCampaign.phase = "endless_contracts";
  try { if (CBZ.setQualityLevel) CBZ.setQualityLevel(3); } catch (e) {}
  try { if (CBZ.dayPhase) CBZ.dayPhase(0.45); } catch (e) {}
  window.requestAnimationFrame = function () { return 0; };
  await wait(700);
  const tick = function (n) {
    for (let i = 0; i < (n == null ? 1 : n); i++) {
      CBZ.hitstop = 0; CBZ.slowmo = 0;
      try { CBZ.stepSim(1 / 60); } catch (e) {}
      try { if (CBZ.player) CBZ.player.hp = 100; } catch (e) {}
    }
  };
  tick(120);
  liveMode();
  const dismissHelp = function () {
    try {
      const all = document.querySelectorAll("div");
      for (let i = 0; i < all.length; i++) {
        const t = all[i].textContent || "";
        if (t.indexOf("Accelerate / brake") >= 0 && t.length < 400) all[i].style.display = "none";
      }
    } catch (e) {}
  };
  const P = CBZ.player;
  const notes = [];
  if (!P || !P.pos || typeof CBZ.cityMakeCar !== "function") {
    bigText = "NO PLAYER / NO cityMakeCar"; paint(); return { ok: true, subject: S.id, staged: false, error: "no player" };
  }
  // a sedan 5 m ahead of the player, side-on, driver's door toward him
  const model = CBZ.cityEcon && CBZ.cityEcon.carByName ? CBZ.cityEcon.carByName("Voltra Ion") : null;
  const yaw = (CBZ.playerChar && CBZ.playerChar.group) ? CBZ.playerChar.group.rotation.y : 0;
  const cx = P.pos.x + Math.sin(yaw) * 5.5, cz = P.pos.z + Math.cos(yaw) * 5.5;
  let car = null;
  try { car = CBZ.cityMakeCar(cx, cz, yaw + Math.PI / 2, false, model, 0); } catch (e) { notes.push("cityMakeCar: " + (e && e.message)); }
  if (!car) { bigText = "NO CAR PLACED"; paint(); return { ok: true, subject: S.id, staged: false, error: "no car", notes: notes }; }
  car.ai = false; car.v = 0;
  tick(5);
  let entered = false;
  try { entered = !!CBZ.cityEnterVehicle(car); } catch (e) { notes.push("enter: " + (e && e.message)); }
  dismissHelp();
  // the door amount, whichever build: the real door's own read, or the leaf's swing
  const openAmount = function () {
    if (CBZ.carDoorOpenT) { const t = CBZ.carDoorOpenT(car, "FL"); if (t != null) return t; }
    const vis = visualOf(car.group);
    const bag = vis.userData && vis.userData._cbzDoorLeaves;
    const leaf = bag && bag.driver;
    return leaf && leaf.visible ? Math.abs(leaf.rotation.y) / 1.02 : 0;
  };
  let simT = 0, peak = 0, peakT = 0;
  const wantT = 0.95;
  while (simT < 9) {
    tick(1); simT += 1 / 60;
    const a = openAmount();
    if (a > peak) { peak = a; peakT = simT; }
    if (a >= wantT) break;
  }
  const grp = car.group;
  grp.updateMatrixWorld(true);
  const h = car.heading || 0;
  const dims = grp.userData.vehicleDims || { width: 2, length: 4.5 };
  const ci = CBZ.carCabinInfo ? CBZ.carCabinInfo(car) : null;
  // door-side three-quarter, in the car's frame: +x is the driver's side
  const lx = dims.width * 0.5 + 2.6, ly = 1.55, lz = (ci ? ci.seatZ + 0.35 : 0) + 2.4;
  const wx = grp.position.x + Math.cos(h) * lx + Math.sin(h) * lz;
  const wz = grp.position.z - Math.sin(h) * lx + Math.cos(h) * lz;
  const ax = grp.position.x + Math.cos(h) * (dims.width * 0.5) + Math.sin(h) * (ci ? ci.seatZ + 0.35 : 0);
  const az = grp.position.z - Math.sin(h) * (dims.width * 0.5) + Math.cos(h) * (ci ? ci.seatZ + 0.35 : 0);
  const c = CBZ.camera;
  const want = { pos: [wx, ly, wz], target: [ax, (ci ? ci.cushionY + 0.25 : 0.8), az], up: [0, 1, 0], fov: 46 };
  if (c) {
    c.position.fromArray(want.pos); c.up.set(0, 1, 0);
    c.lookAt(new T.Vector3().fromArray(want.target));
    c.fov = want.fov; c.updateProjectionMatrix(); c.updateMatrixWorld(true);
  }
  dismissHelp();
  const m = { doorOpenAmount: round(peak, 2), doorOpenAtSimS: round(peakT, 2), realDoors: CBZ.carDoors && CBZ.carDoors(car) ? CBZ.carDoors(car).length : 0 };
  stateText = (m.realDoors ? m.realDoors + " REAL DOORS" : "BOARDING LEAF") + " · DOOR " + Math.round(peak * 100) + "% OPEN AT " + peakT.toFixed(2) + " s";
  detailText = "entered=" + entered + " · style " + (grp.userData.carStyle || "?") + (notes.length ? "\n" + notes.join(" · ") : "");
  paint();
  ST.render();
  return { ok: true, subject: S.id, staged: true, metrics: m, camera: want, notes: notes };
}

export default {
  id: "car-doors",
  title: "Car Doors: the body is hollow where its doors are",
  description: "Five studio plates and one live plate. The page's own traffic car builder makes the car and the page's own boarding verb opens the driver's door on both sides; a ray fired through the opening with the door hidden measures whether there is a car body in the way. The last plate walks the real player up to a real car in the real city and photographs the door at the top of its arc.",
  beforeLabel: "BEFORE · HEAD",
  afterLabel: "AFTER · LOCAL",
  viewport: { width: 1100, height: 680 },
  readyExpression: "window.THREE && window.CBZ && CBZ.CONFIG && typeof CBZ.cityBuildAmbientCarVisual === 'function' && !!CBZ.boarding",
  urlParams: { seed: 90210 },
  stageTimeoutMs: 600000,
  defaultFocus: "Is there a hole in the car where the open door was, and does the door itself have an edge, a card, a frame and a window?",
  pairNote: "Same seed · same builder · same door verb · same tripod",
  method: "Studio plates are built by the photographed build's own cityBuildAmbientCarVisual and opened by its own CBZ.boarding.door; tripods resolve on the BEFORE side and are copied to the AFTER side. The live plate boots the real world with requestAnimationFrame frozen, places a car with cityMakeCar, calls cityEnterVehicle and steps the sim one tick at a time until the door reads open.",
  metricsNote: "apertureDepthM: with the near-side door objects hidden, how far (m) a ray fired inboard through the driver's door opening at hip height travels past the flank line before hitting anything — ~0 is a solid wall, >0.4 is a real opening. windowCutM: the same through the window area. doorThicknessM: the shut driver's door's extent across the car. doorMeshes: meshes in the door object.",
  metrics: {
    apertureDepthM: { label: "Opening depth behind the door (m)", better: "higher" },
    windowCutM: { label: "Opening depth through the window (m)", better: "higher" },
    doorThicknessM: { label: "Door thickness, shut (m)", better: "higher" },
    doorMeshes: { label: "Meshes in the door" },
    realDoors: { label: "Real hinged doors on the car", better: "higher" },
    hullTris: { label: "Triangles in the car" },
    doorOpenAmount: { label: "Live: door open amount" },
    doorOpenAtSimS: { label: "Live: sim seconds to open" },
  },
  subjects: subjects,
  stage: stageCarDoors,
};
