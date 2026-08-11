/* Captain fleet visual census.

   This is deliberately exhaustive rather than a beauty-shot preset. It uses
   the live marine registry for every hull and boots the real Captain origin
   for the Bergen trawler so its crew, chart table, hold gate and runtime
   fittings are present. The room plates put the camera at a standing eye in
   each modelled space; an empty shell therefore photographs as an empty shell.

   The AFTER side inherits the exact local tripod returned by the deployed
   BEFORE side. Hull, seed, viewport, light, waterline and camera are held
   constant; production source is the variable. */

const subjects = [
  // Every canonical marine-hull registry row, exactly once from outside.
  { id: "captain-trawler-exterior", key: "trawler", liveCaptain: true, kind: "exterior", label: "01 · Captain flagship — Bergen Fisher 60", focus: "The actual Captain-origin trawler with its live crew and fittings. Judge hull sheer, wheelhouse, gantry, mast support, work-deck hierarchy, and whether every vertical element visibly lands on structure." },
  { id: "dinghy-exterior", key: "dinghy", kind: "exterior", label: "02 · Calanque Tender 15 — exterior", focus: "Whole RIB silhouette: tube collar, console, seat, transom and outboard must read as one supported craft." },
  { id: "speedboat-exterior", key: "boat", kind: "exterior", label: "03 · Bellamar Speedboat — exterior", focus: "Whole runabout silhouette and cockpit anatomy; no floating trim, windscreen or engine pieces." },
  { id: "skiff-exterior", key: "skiff", kind: "exterior", label: "04 · Coastline Skiff 18 — exterior", focus: "Small fishing-boat read: open sole, console, fish box, rods and outboard must remain physically connected." },
  { id: "cruiser-exterior", key: "cruiser", kind: "exterior", label: "05 · Bellamar Corsa 46 — exterior", focus: "Fourteen-metre cruiser silhouette: boarding path, saloon shell, side decks, flybridge and radar arch." },
  { id: "yacht34-exterior", key: "yacht", kind: "exterior", label: "06 · Nordholm Aurelia 112 — exterior", focus: "Thirty-four-metre yacht: beach platform through sun deck, with readable level hierarchy and attached mast/arch." },
  { id: "sportfish-exterior", key: "sportfish", kind: "exterior", label: "07 · Ravenna 41 Convertible — exterior", focus: "Sportfisher silhouette: cockpit, flybridge, tuna tower and outriggers must have believable load paths." },
  { id: "sloop-exterior", key: "sloop", kind: "exterior", label: "08 · Marlow 44 Sloop — exterior", focus: "Sloop silhouette: keel, coachroof, cockpit, mast, boom and stays must meet at visible attachment points." },
  { id: "yacht46-exterior", key: "yacht46", kind: "exterior", label: "09 · Verano 150 — exterior", focus: "Forty-six-metre yacht: proportion, deckhouse setbacks, circulation, mast cluster and tender garage." },
  { id: "yacht88-exterior", key: "yacht88", kind: "exterior", label: "10 · Corveline 290 — exterior", focus: "Eighty-eight-metre yacht: deck stack must remain ship-like rather than a pile of slabs." },
  { id: "yacht156-exterior", key: "yacht156", kind: "exterior", label: "11 · Vosswerft Aurora 512 — exterior", focus: "Flagship scale read: continuous hull, five-level superstructure, two supported helidecks, garages and mast cluster." },

  // Captain-mode spaces — cloned from the actual origin boat after it starts.
  { id: "captain-workdeck", key: "trawler", liveCaptain: true, kind: "room", room: "captain-workdeck", label: "12 · Captain trawler — working deck", focus: "The crew's real workplace. Gantry, winch, crates, bulwarks, chart route and people need clear working clearance." },
  { id: "captain-wheelhouse", key: "trawler", liveCaptain: true, kind: "room", room: "captain-wheelhouse", label: "13 · Captain trawler — wheelhouse", focus: "Standing-eye view in the actual Captain wheelhouse. Helm, windows, chart table, seat and navigation equipment must form a usable room." },
  { id: "captain-fish-hold", key: "trawler", liveCaptain: true, kind: "room", room: "captain-hold", label: "14 · Captain trawler — fish hold", focus: "Player-eye view through the Captain hold. Floor, gate, walls, cargo and deck machinery must not overlap or float." },

  // Open cockpits count as occupied interiors even when the hull has no room.
  { id: "dinghy-helm", key: "dinghy", kind: "room", room: "dinghy-helm", label: "15 · Calanque Tender — helm", focus: "Seated/standing eye over the RIB console: wheel, screen, grab rail, seat and deck clearances." },
  { id: "speedboat-cockpit", key: "boat", kind: "room", room: "speedboat-cockpit", label: "16 · Bellamar Speedboat — cockpit", focus: "The entire open cockpit from the aft quarter: seats, dash, wheel, windscreen and bow seating." },
  { id: "skiff-helm", key: "skiff", kind: "room", room: "skiff-helm", label: "17 · Coastline Skiff — fishing cockpit", focus: "A working open skiff from inside: console, wheel, fish box, rod rack, casting deck and safe floor." },

  { id: "cruiser-cockpit", key: "cruiser", kind: "room", room: "cruiser-cockpit", label: "18 · Bellamar Corsa 46 — aft cockpit", focus: "Aft social cockpit from boarding height: settees, wet bar, sole and the saloon threshold." },
  { id: "cruiser-saloon", key: "cruiser", kind: "room", room: "cruiser-saloon", label: "19 · Bellamar Corsa 46 — saloon", focus: "Standing eye inside the enclosed saloon. Furniture, galley, helm and doorway must fill a believable room rather than an empty shell." },
  { id: "cruiser-flybridge", key: "cruiser", kind: "room", room: "cruiser-flybridge", label: "20 · Bellamar Corsa 46 — flybridge", focus: "Flybridge from the stair landing: console, twin seats, screen, sunpad, rails and radar arch." },

  { id: "yacht34-saloon", key: "yacht", kind: "room", room: "yacht34-saloon", label: "21 · Nordholm Aurelia — main saloon", focus: "Main-deck saloon at player eye height: lounge, dining, galley, glazing and circulation." },
  { id: "yacht34-skylounge", key: "yacht", kind: "room", room: "yacht34-skylounge", label: "22 · Nordholm Aurelia — skylounge", focus: "Upper lounge from its aft threshold; it should be a distinct furnished room, not leftover deck volume." },
  { id: "yacht34-wheelhouse", key: "yacht", kind: "room", room: "yacht34-wheelhouse", label: "23 · Nordholm Aurelia — wheelhouse", focus: "Wheelhouse from behind the helm chairs: console, wheel, glazing, charting and clear sightlines." },
  { id: "yacht34-garage", key: "yacht", kind: "room", room: "yacht34-garage", label: "24 · Nordholm Aurelia — tender garage", focus: "Tender garage from inside: deck, cradled RIB, door, machinery and a physically readable launch path." },
  { id: "yacht34-sundeck", key: "yacht", kind: "room", room: "yacht34-sundeck", label: "25 · Nordholm Aurelia — sun deck", focus: "Top deck circulation and amenities: pads, jacuzzi, bar, rails and mast base all supported." },

  { id: "sportfish-cockpit", key: "sportfish", kind: "room", room: "sportfish-cockpit", label: "26 · Ravenna 41 — fishing cockpit", focus: "The fighting cockpit as a workplace: chair, fish door, live well, side decks and transom clearance." },
  { id: "sportfish-saloon", key: "sportfish", kind: "room", room: "sportfish-saloon", label: "27 · Ravenna 41 — saloon", focus: "Convertible saloon from inside. Galley, seating, helm/threshold and glazing need human scale." },
  { id: "sportfish-flybridge", key: "sportfish", kind: "room", room: "sportfish-flybridge", label: "28 · Ravenna 41 — flybridge", focus: "Flybridge from the stair: helm, seats, rails and the tuna tower's supported base." },
  { id: "sportfish-tower", key: "sportfish", kind: "room", room: "sportfish-tower", label: "29 · Ravenna 41 — tuna tower", focus: "Tower helm at working height. Every leg and outrigger must visibly terminate on a load-bearing deck or bracket." },

  { id: "sloop-cockpit", key: "sloop", kind: "room", room: "sloop-cockpit", label: "30 · Marlow 44 — cockpit", focus: "Sailing cockpit from the stern: helm, benches, companionway and boom clearance." },
  { id: "sloop-cabin", key: "sloop", kind: "room", room: "sloop-cabin", label: "31 · Marlow 44 — cabin", focus: "Standing/seated eye below the coachroof. Berth, table, galley, navigation seat and companionway must use the small volume honestly." },
  { id: "sloop-rig", key: "sloop", kind: "room", room: "sloop-rig", label: "32 · Marlow 44 — mast and standing rigging", focus: "Close rig inspection: mast foot, boom gooseneck, forestay, backstay and furled sails must meet real endpoints." },

  // The procedural superyacht builder exposes the same three enclosed room
  // classes at each scale; photographing all three boats catches scale drift.
  ...["yacht46", "yacht88", "yacht156"].flatMap((key, i) => {
    const names = ["Verano 150", "Corveline 290", "Vosswerft Aurora 512"];
    const n = 33 + i * 3;
    return [
      { id: `${key}-saloon`, key, kind: "room", room: "super-saloon", label: `${n} · ${names[i]} — main saloon`, focus: "Main saloon at human eye height: lounge, dining, bar/galley, glazing, doors and circulation must scale with the hull." },
      { id: `${key}-bridge`, key, kind: "room", room: "super-bridge", label: `${n + 1} · ${names[i]} — bridge`, focus: "Bridge from behind the chairs: believable console depth, navigation displays, wheel, glazing and bridge-wing access." },
      { id: `${key}-garage`, key, kind: "room", room: "super-garage", label: `${n + 2} · ${names[i]} — tender garage`, focus: "Side-shell garage from inside: tender cradle, structural deck, door and launch opening must read as one room." },
    ];
  }),
];

async function stageCaptainFleet(input) {
  const T = window.THREE;
  const CBZ = window.CBZ;
  if (!T || !CBZ || !CBZ.marineHulls) return { ok: false, error: "marine registry unavailable" };
  const sub = input.subject || {};
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const until = async (test, budget, step) => {
    const end = Date.now() + (budget || 120000);
    while (Date.now() < end) {
      try { if (test()) return true; } catch (_) {}
      await wait(step || 200);
    }
    return false;
  };
  const round = (v, n) => {
    const p = Math.pow(10, n == null ? 2 : n);
    return Number.isFinite(Number(v)) ? Math.round(Number(v) * p) / p : 0;
  };

  let ST = window.__cbzCaptainFleetVisual;
  if (!ST) {
    const renderer = new T.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setSize(input.width, input.height, false);
    if (renderer.shadowMap) renderer.shadowMap.enabled = true;
    if (T.SRGBColorSpace && "outputColorSpace" in renderer) renderer.outputColorSpace = T.SRGBColorSpace;
    if (T.ACESFilmicToneMapping != null) { renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.06; }
    renderer.domElement.style.cssText = `position:fixed;left:0;top:0;width:${input.width}px;height:${input.height}px;z-index:2147483000`;
    document.body.appendChild(renderer.domElement);

    const overlay = document.createElement("div");
    overlay.id = "__cbzCaptainFleetOverlay";
    overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483600;color:#f4f7f9;text-shadow:0 2px 9px #000;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    overlay.innerHTML = "<div data-side></div><div data-name></div><div data-focus></div><div data-state></div><div data-detail></div><div data-source></div>";
    document.body.appendChild(overlay);

    const scene = new T.Scene();
    scene.background = new T.Color(0x9fc2d4);
    scene.fog = new T.Fog(0x9fc2d4, 180, 900);
    const camera = new T.PerspectiveCamera(42, input.width / input.height, 0.035, 2400);
    scene.add(new T.HemisphereLight(0xe7f5ff, 0x31404b, 2.25));
    const sun = new T.DirectionalLight(0xfff2d8, 3.2);
    sun.position.set(-80, 110, -55); sun.castShadow = true; scene.add(sun);
    const fill = new T.DirectionalLight(0x9dd7ff, 1.15);
    fill.position.set(70, 35, 50); scene.add(fill);
    const eyeFill = new T.PointLight(0xfff0d2, 0.72, 42, 2);
    scene.add(eyeFill);

    const seaMat = new T.MeshStandardMaterial({ color: 0x176b86, roughness: 0.37, metalness: 0.05 });
    const sea = new T.Mesh(new T.PlaneGeometry(1800, 1800, 1, 1), seaMat);
    sea.rotation.x = -Math.PI / 2; sea.position.y = -0.035; scene.add(sea);
    const horizon = new T.GridHelper(1800, 180, 0x8bc7d4, 0x4d91a5);
    horizon.position.y = -0.025; horizon.material.transparent = true; horizon.material.opacity = 0.16; scene.add(horizon);

    ST = window.__cbzCaptainFleetVisual = { renderer, overlay, scene, camera, eyeFill, sea, horizon, subject: null, captain: null, bootError: null };
    ST.render = function () { try { renderer.render(scene, camera); } catch (_) {} };
    window.__cbzVisualCompare = { render: ST.render };
  }
  ST.renderer.setSize(input.width, input.height, false);
  ST.camera.aspect = input.width / input.height;
  ST.camera.updateProjectionMatrix();

  const showStudio = () => {
    const keep = [ST.renderer.domElement, ST.overlay];
    for (const child of Array.from(document.body.children)) {
      child.style.visibility = keep.includes(child) ? "" : "hidden";
    }
  };
  const showPage = () => {
    for (const child of Array.from(document.body.children)) child.style.visibility = "";
    ST.renderer.domElement.style.visibility = "hidden";
    ST.overlay.style.visibility = "hidden";
  };

  const ensureCaptain = async () => {
    if (ST.captain || ST.bootError) return ST.captain;
    showPage();
    const booted = await until(() => CBZ.game && (CBZ.bootComplete || CBZ.game.state === "title") && CBZ.stepSim && document.getElementById("playBtn"), 300000, 250);
    if (!booted) { ST.bootError = "game never booted"; return null; }
    try { if (CBZ.setMode) CBZ.setMode("city"); else CBZ.game.mode = "city"; } catch (_) {}
    try { if (CBZ.setCityOrigin) CBZ.setCityOrigin("captain", true); else { CBZ.game.cityOrigin = "captain"; CBZ.game.cityOriginPicked = true; } } catch (_) {}
    const playing = await until(() => {
      if (CBZ.game.state === "playing") return true;
      const b = document.getElementById("playBtn"); if (b) b.click();
      return CBZ.game.state === "playing";
    }, 150000, 300);
    if (!playing) { ST.bootError = "Captain origin never reached playing"; return null; }
    try { if (CBZ.setQualityLevel) CBZ.setQualityLevel(3); } catch (_) {}
    await wait(650);
    window.requestAnimationFrame = function () { return 0; };
    const step = () => {
      CBZ.hitstop = 0; CBZ.slowmo = 0;
      try { CBZ.stepSim(1 / 60); } catch (_) {}
      try { if (CBZ.player) { CBZ.player.hp = 100; CBZ.player.dead = false; } } catch (_) {}
    };
    let boat = null;
    for (let i = 0; i < 2400; i++) {
      step();
      if (i % 120 === 0 && CBZ.captainStart) { try { CBZ.captainStart(); } catch (_) {} }
      try { boat = CBZ.captainBoat && CBZ.captainBoat(); } catch (_) { boat = null; }
      if (boat && i > 1080) break;
    }
    if (boat) for (let i = 0; i < 240; i++) step();
    try { if (CBZ.dayPhase) { CBZ.dayPhase(0.43); for (let i = 0; i < 30; i++) step(); } } catch (_) {}
    if (!boat || !boat.group) { ST.bootError = "Captain flagship did not spawn"; return null; }
    ST.captain = boat;
    return boat;
  };

  let rec = null;
  try { rec = CBZ.marineHulls.get(sub.key); } catch (_) { rec = null; }
  if (!rec) return { ok: false, error: `missing hull ${sub.key}` };

  let root = null;
  let actualCaptain = false;
  if (sub.liveCaptain) {
    const boat = await ensureCaptain();
    if (boat && boat.group) {
      try { root = boat.group.clone(true); actualCaptain = true; } catch (_) { root = null; }
    }
  }
  if (!root) {
    try { root = CBZ.marineHulls.build(sub.key); } catch (_) { root = null; }
  }
  if (!root) return { ok: false, error: `could not build ${sub.key}${ST.bootError ? ` · ${ST.bootError}` : ""}` };

  showStudio();
  ST.renderer.domElement.style.visibility = "";
  ST.overlay.style.visibility = "";
  if (ST.subject) ST.scene.remove(ST.subject);
  ST.subject = root;
  root.position.set(0, 0, 0); root.rotation.set(0, 0, 0);
  root.updateMatrixWorld(true);
  ST.scene.add(root);

  const spec = rec.spec || rec.hull || {};
  const solve = rec._solve || null;
  const loa = Number(spec.loa || (solve && solve.loa) || 10);
  const beam = Number(spec.beam || (solve && solve.beam) || 3);
  let dims = root.userData && root.userData.vehicleDims;
  if (!dims) root.traverse((o) => { if (!dims && o.userData && o.userData.vehicleDims) dims = o.userData.vehicleDims; });
  const height = Number((dims && dims.height) || spec.airDraft || Math.max(2, beam * 0.8));

  const roomCamera = (room) => {
    const fixed = {
      "captain-workdeck": { pos: [4.5, 5.2, -8.6], target: [0, 3.0, -3.2], fov: 54 },
      "captain-wheelhouse": { pos: [-1.35, 3.92, 1.55], target: [0.35, 3.70, 4.25], fov: 61 },
      "captain-hold": { pos: [0.25, 4.25, -8.15], target: [0, 2.95, -3.65], fov: 60 },
      "dinghy-helm": { pos: [-0.88, 1.18, -1.55], target: [0, 0.62, 0.18], fov: 61 },
      "speedboat-cockpit": { pos: [-1.28, 1.62, -2.55], target: [0, 1.02, 0.05], fov: 62 },
      "skiff-helm": { pos: [-1.02, 1.43, -1.75], target: [0, 0.76, 0.22], fov: 61 },
      "cruiser-cockpit": { pos: [1.72, 2.72, -6.85], target: [0, 1.85, -3.65], fov: 59 },
      "cruiser-saloon": { pos: [-0.92, 2.62, -1.78], target: [0, 2.20, 2.25], fov: 64 },
      "cruiser-flybridge": { pos: [-1.38, 4.88, -1.62], target: [0, 4.42, 1.92], fov: 59 },
      "yacht34-saloon": { pos: [-1.72, 4.05, -7.85], target: [0, 3.60, -0.65], fov: 66 },
      "yacht34-skylounge": { pos: [-1.62, 7.05, -5.75], target: [0, 6.55, 1.35], fov: 65 },
      "yacht34-wheelhouse": { pos: [-1.42, 6.96, 4.05], target: [0, 6.48, 6.65], fov: 60 },
      "yacht34-garage": { pos: [0, 2.12, -13.55], target: [0, 1.62, -16.08], fov: 62 },
      "yacht34-sundeck": { pos: [-3.25, 10.65, -5.25], target: [0, 8.78, 0.15], fov: 61 },
      "sportfish-cockpit": { pos: [1.70, 2.86, -5.92], target: [0, 2.05, -3.28], fov: 60 },
      "sportfish-saloon": { pos: [-1.10, 2.86, -1.36], target: [0, 2.42, 1.62], fov: 63 },
      "sportfish-flybridge": { pos: [-1.32, 4.78, -1.40], target: [0, 4.15, 1.72], fov: 59 },
      "sportfish-tower": { pos: [2.28, 6.42, -0.92], target: [0, 6.00, 0.92], fov: 55 },
      "sloop-cockpit": { pos: [1.52, 2.32, -5.55], target: [0, 1.62, -3.05], fov: 60 },
      "sloop-cabin": { pos: [-1.05, 1.98, -0.82], target: [0, 1.58, 2.62], fov: 65 },
      "sloop-rig": { pos: [7.8, 9.0, -7.8], target: [0, 8.4, 1.35], fov: 45 },
    };
    if (fixed[room]) return fixed[room];
    if (solve && room === "super-saloon") {
      const z0 = solve.supZ0[0], span = Math.abs(solve.supZ1[0] - z0);
      return { pos: [-Math.min(2.4, beam * 0.12), solve.deckY[0] + 1.68, z0 + Math.min(2.2, span * 0.12)], target: [0, solve.deckY[0] + 1.32, z0 + Math.min(9, span * 0.48)], fov: 64 };
    }
    if (solve && room === "super-bridge") {
      const tier = Math.max(1, solve.tiers - 1), y = solve.deckY[tier], z = solve.supZ1[tier];
      return { pos: [-Math.min(2.4, beam * 0.10), y + 1.72, z - loa * 0.090], target: [0, y + 1.35, z - loa * 0.032], fov: 61 };
    }
    if (solve && room === "super-garage" && solve.garage) {
      const G = solve.garage;
      return { pos: [0, G.y + 1.55, G.z - G.len * 0.31], target: [-(solve.halfBeam - 1.5), G.y + 1.05, G.z], fov: 63 };
    }
    return { pos: [-beam * 0.7, Math.max(1.6, height * 0.35), -loa * 0.35], target: [0, Math.max(1, height * 0.24), 0], fov: 58 };
  };

  let desired;
  if (sub.kind === "exterior") {
    const distance = Math.max(loa * 0.82, beam * 3.5, 6.5);
    desired = {
      pos: [distance * 0.72, Math.max(2.2, height * 0.48), -distance * 0.72],
      target: [0, Math.max(0.45, height * 0.28), 0], fov: loa > 80 ? 35 : 39,
    };
  } else desired = roomCamera(sub.room);
  const ref = input.referenceStage && input.referenceStage.camera;
  const cam = ref || desired;
  ST.camera.position.fromArray(cam.pos);
  ST.camera.up.set(0, 1, 0);
  ST.camera.lookAt(new T.Vector3().fromArray(cam.target));
  ST.camera.fov = Number(cam.fov) || 50;
  ST.camera.near = sub.kind === "room" ? 0.025 : Math.max(0.035, loa / 1800);
  ST.camera.far = Math.max(1200, loa * 12);
  ST.camera.updateProjectionMatrix(); ST.camera.updateMatrixWorld(true);
  ST.eyeFill.position.copy(ST.camera.position);
  ST.eyeFill.distance = Math.max(28, beam * 3);
  ST.sea.scale.set(Math.max(1, loa / 120), Math.max(1, loa / 120), 1);
  ST.horizon.scale.set(Math.max(1, loa / 120), Math.max(1, loa / 120), 1);

  let meshes = 0, triangles = 0, fixtures = 0, rooms = 0, rigAnchors = 0, rigGaps = 0;
  root.traverse((o) => {
    if (o.isMesh && o.geometry) {
      meshes++;
      const p = o.geometry.index ? o.geometry.index.count : (o.geometry.attributes && o.geometry.attributes.position ? o.geometry.attributes.position.count : 0);
      triangles += Math.floor(p / 3);
    }
    if (o.userData && o.userData.marineFixture) fixtures++;
    if (o.userData && o.userData.marineRigAnchor) rigAnchors++;
  });
  root.traverse((o) => {
    if (o.userData && Array.isArray(o.userData.marineRooms)) rooms = Math.max(rooms, o.userData.marineRooms.length);
    if (o.userData && o.userData.marineRigAudit && Number.isFinite(Number(o.userData.marineRigAudit.gaps))) rigGaps += Number(o.userData.marineRigAudit.gaps);
  });

  const side = ST.overlay.querySelector("[data-side]");
  const name = ST.overlay.querySelector("[data-name]");
  const focus = ST.overlay.querySelector("[data-focus]");
  const state = ST.overlay.querySelector("[data-state]");
  const detail = ST.overlay.querySelector("[data-detail]");
  const source = ST.overlay.querySelector("[data-source]");
  side.textContent = input.side === "before" ? input.beforeLabel : input.afterLabel;
  side.style.cssText = `position:absolute;left:24px;top:20px;padding:8px 12px;border-radius:7px;background:${input.side === "before" ? "#a43131" : "#197650"};font-size:12px;font-weight:900;letter-spacing:.12em`;
  name.textContent = sub.label || rec.label || sub.key;
  name.style.cssText = "position:absolute;left:24px;top:66px;font-size:27px;font-weight:900";
  focus.textContent = sub.focus || "Inspect structure, scale and room anatomy.";
  focus.style.cssText = "position:absolute;left:25px;top:105px;max-width:650px;color:#d5e2e8;font-size:13px;line-height:1.35";
  state.textContent = `${sub.kind === "exterior" ? "WHOLE VESSEL" : `ROOM · ${sub.room}`} · ${round(loa, 1)} m × ${round(beam, 1)} m${actualCaptain ? " · LIVE CAPTAIN ORIGIN" : ""}`;
  state.style.cssText = "position:absolute;left:24px;bottom:57px;padding:7px 10px;background:rgba(6,13,18,.78);border:1px solid rgba(255,255,255,.25);border-radius:6px;font:700 12px ui-monospace,SFMono-Regular,Menlo,monospace";
  detail.textContent = `${meshes} meshes · ${triangles.toLocaleString()} triangles · ${fixtures} tagged fixtures · ${rooms} declared rooms · ${rigAnchors} solved rig anchors`;
  detail.style.cssText = "position:absolute;left:24px;bottom:27px;color:#d5e2e8;font:11px ui-monospace,SFMono-Regular,Menlo,monospace";
  source.textContent = `${rec.label || sub.key} · registry key ${sub.key}`;
  source.style.cssText = "position:absolute;right:24px;bottom:27px;color:#c7d8df;font:11px ui-monospace,SFMono-Regular,Menlo,monospace";

  ST.render();
  return {
    ok: true,
    key: sub.key,
    room: sub.room || null,
    actualCaptain,
    camera: { pos: cam.pos.slice(), target: cam.target.slice(), fov: Number(cam.fov) || 50 },
    metrics: { meshes, triangles, fixtures, rooms, rigAnchors, rigGaps, captainLive: actualCaptain ? 1 : 0 },
  };
}

export default {
  id: "captain-fleet",
  title: "Captain Fleet — Every Boat, Every Modelled Space",
  description: "Eleven canonical boats and every occupied/modelled interior zone, including the real Captain-origin trawler. Exact deployed-before tripods are reused by the current checkout.",
  beforeLabel: "BEFORE · DEPLOYED",
  afterLabel: "AFTER · CURRENT",
  readyExpression: "window.THREE && window.CBZ && CBZ.CONFIG && CBZ.marineHulls && CBZ.marineHulls.keys && CBZ.marineHulls.keys().length >= 11 && CBZ.captainStart",
  viewport: { width: 1120, height: 700 },
  stageTimeoutMs: 900000,
  urlParams: { seed: "captain-fleet-2026-08-11" },
  pairNote: "Same registry row · Captain origin · seed · local tripod · waterline · light · viewport",
  method: "Every exterior is built by CBZ.marineHulls. Captain plates boot the real Captain origin and clone its live flagship after crew, chart table and hold fittings attach. Room cameras stand inside the authored volume; the AFTER side inherits the exact BEFORE camera.",
  metricsNote: "Live builder census. Tagged fixtures, declared rooms and solved rig anchors intentionally start at zero on the deployed build and rise only when the production builders publish real anatomy.",
  metrics: {
    meshes: { label: "Rendered mesh nodes", better: "lower" },
    triangles: { label: "Rendered triangles", better: "lower" },
    fixtures: { label: "Tagged room fixtures", better: "higher" },
    rooms: { label: "Declared modelled rooms", better: "higher" },
    rigAnchors: { label: "Endpoint-solved rig anchors", better: "higher" },
    rigGaps: { label: "Disconnected rig endpoints", better: "lower" },
    captainLive: { label: "Real Captain-origin flagship", better: "higher" },
  },
  defaultFocus: "Compare silhouette, physical support, usable clearances and room anatomy.",
  subjects,
  stage: stageCaptainFleet,
};
