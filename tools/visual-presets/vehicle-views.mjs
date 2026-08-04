/* Vehicle views comparison studio — cabins, drivers, cockpits, pilots.

   THE WAVE THIS PHOTOGRAPHS
   (a) car cabins + a visible player-driver read in third person
   (b) a first-person in-car drive view
   (c) decluttered aircraft cockpits
   (d) pilot bodies visible in planes from outside

   Both sides run the SAME stage code, so everything new is FEATURE-DETECTED
   BY MEASURING and only corroborated by a typeof check:

     • cabins      — build the live visual and MEASURE it. Does the builder
                     publish userData.cabinInfo for this body style? How many
                     meshes actually sit inside the cabin volume? How many of
                     those are prop-sized? How many sit in the driver's seat
                     volume? Today makeRoadCar publishes cabinInfo and draws a
                     six-piece interior; makeSUV/makeVan publish neither and
                     draw one slab. That gap IS the before plate.
     • occupants   — the real path, not a replica: city/vehicles.js's
                     addOccupants() runs inside cityMakeCar(), so the traffic
                     plate borrows CBZ.city.arena.root for the length of three
                     SYNCHRONOUS makeCar calls (nothing can interleave), keeps
                     the returned records, truncates CBZ.cityCars back to where
                     it found it, and restores every global in a finally. If
                     cityMakeCar cannot run at all, the plate falls back to
                     cityBuildAmbientCarVisual (no occupants) and SAYS SO.
     • car FP      — unknown API on purpose. The primary probe is BEHAVIOURAL:
                     board a real car in the real world, press the game's own
                     [V] (city/view.js returns early while driving, so today
                     nothing happens), step the sim, and ask the only honest
                     question — IS THE CAMERA INSIDE THE CABIN BOX? A pile of
                     candidate CBZ.* names is tried the same way afterwards.
                     No FP anywhere → the plate is the REAL chase rig at the
                     numbers systems/camera.js uses (back 9.5 / up 10.0 /
                     ahead 6.0 / fov 66) and the state line says so.
     • cockpit     — built by the live generator through the sanctioned
                     synthetic-probe seam (CBZ.cockpitSpec on a bare
                     {airClass:"jet"} literal, exactly as cockpitSightAudit
                     does), so mesh COUNT — the owner's "too many props"
                     complaint — is the headline number, beside the measured
                     downVisionDeg from the audit itself.
     • pilot       — CBZ.debugBuildAircraft.jet() and userData.pilot made
                     visible the way playeraircraft.js makes it visible when
                     somebody boards. Two boxes today; a real rig would move
                     the measured count, not a flag.

   STUDIO FIRST, LIVE ONLY WHERE THE LIVE CAMERA *IS* THE SUBJECT. Every plate
   except fp-car is staged in this file's own WebGLRenderer against builders
   that need no booted world — deterministic and fast. fp-car boots the real
   game once (rAF frozen, CBZ.stepSim the only clock) because the thing being
   photographed is the game's camera solver, not a model.

   COEXISTENCE. Unlike interiors.mjs this studio never does
   `document.body.innerHTML = ""` — that would delete the game canvas the live
   subject needs. It appends its own fixed canvas over the page and hides/shows
   body children per mode, so studio and live subjects may appear in any order
   and `--subjects` may select any mix.  */

const CAB_VIEW = { azDeg: 68, camY: 2.45, dist: 3.6, fov: 40, aim: "cabin" };

const subjects = [
  {
    id: "sedan-exterior-front",
    label: "01 · Sedan, oncoming front quarter",
    kind: "car",
    car: { style: "tesla-3", color: 0x1d4f8f },
    view: { azDeg: 26, camY: 1.52, dist: 5.4, fov: 34, aim: "front" },
    focus: "A pedestrian's eye on an oncoming car: whole front fascia and windshield in the upper half, road under the bumper. Can you see a driver behind the glass, or is the cabin an empty tinted tub?",
  },
  {
    id: "sedan-cabin-cutaway",
    label: "02 · Sedan cabin through the side glass",
    kind: "car",
    car: { style: "tesla-3", color: 0x1d4f8f },
    view: CAB_VIEW,
    focus: "High side angle looking down through the greenhouse. Seat deck, two seat backs, rear bench, dash and wheel are what makeRoadCar draws today — count what is actually in there.",
  },
  {
    id: "suv-cabin",
    label: "03 · SUV cabin through the side glass",
    kind: "car",
    car: { style: "suv", color: 0x37473a },
    view: CAB_VIEW,
    focus: "Same framing recipe, a body style with NO published cabin frame. Today makeSUV drops one interior slab under the glass and publishes no cabinInfo at all.",
  },
  {
    id: "van-cabin",
    label: "04 · Van cabin through the side glass",
    kind: "car",
    car: { style: "van", color: 0x6a625a },
    view: CAB_VIEW,
    focus: "The other body style with no cabin frame. A van's glasshouse is the biggest window in the fleet, so an empty cabin shows here worst of all.",
  },
  {
    id: "traffic-occupants",
    label: "05 · Traffic occupants, three cars",
    kind: "traffic",
    focus: "Three REAL cityMakeCar traffic cars in echelon, each seated by the game's own addOccupants(). Heads and shoulders behind glass are what makes a street read as driven rather than parked.",
  },
  {
    id: "fp-car",
    label: "06 · First person, at the wheel",
    kind: "live",
    focus: "THE MONEY SHOT. Deployed: no in-car first person exists at all, so the honest plate is the real chase rig at its drive numbers. The measured question is whether the camera is inside the cabin box.",
  },
  {
    id: "fp-fighter-cockpit",
    label: "07 · Fighter cockpit from the seat",
    kind: "cockpit",
    cockpit: { airClass: "jet", displayName: "PROBE JET", want: "fighter" },
    focus: "What the pilot's eye sees, built by the live cockpit generator. The owner's complaint is clutter, so MESH COUNT is the headline number and the sightline audit is the guard against fixing it by deletion.",
  },
  {
    id: "tp-plane-pilot",
    label: "08 · Plane from outside, canopy height",
    kind: "aircraft",
    focus: "Three-quarter view at canopy height with the pilot made visible exactly as boarding makes it visible. Two dark boxes today: a torso and a head.",
  },
  {
    id: "companion-boarding",
    label: "09 · Companion boarding",
    kind: "boarding",
    focus: "THE SLOT IS NO LONGER EMPTY. Two crew are recruited in the live world, walked away from the player, and then the player takes a car — the game's own cityEnterVehicle, nothing staged. The sim is stepped tick by tick and every follower's position is sampled EVERY tick, which turns the owner's complaint into two numbers that cannot be argued with: pathWalked (how far each body actually travelled on its legs) and maxJump (the largest single-tick displacement any of them made). A body that glitches into a car has maxJump of several metres and pathWalked near zero; a body that walked to a door has the reverse. Beside them: how many followers ended up inside the cabin volume, how many of those are still VISIBLE (the whole point of glass), and how many door leaves exist on the car at all.",
  },
  {
    id: "cargo-ramp",
    label: "10 · Cargo ramp",
    kind: "stub",
    focus: "Reserved for a later wave.",
  },
  {
    id: "jack-reaction",
    label: "11 · Carjack reaction",
    kind: "jack",
    focus: "THE MONEY SHOT OF THIS WAVE. A real occupied ambient car is jacked in the live world and the sim is stepped two seconds. The measured question: how many bodies came out, on which SIDE of the car, and did any of them decide anything (draw / run / hands up)?",
  },
  {
    id: "backseat-occupants",
    label: "12 · Who is actually in the car",
    kind: "occupancy",
    focus: "Three cars built by the game's own cityMakeCar at fixed world points, framed on the rear side glass. The headline is MEASURED over a 240-point lattice: what fraction of cars carry a back-seat passenger, and does the answer stay the same when you look twice?",
  },
  {
    id: "driveby-in-traffic",
    label: "13 · Drive-by, in a lane",
    kind: "dbtraffic",
    focus: "A live drive-by staged near the player. The measurement is the one the owner named: does the gang car have a ROAD (a lane, a light, an IDM leader) or is it flying at the target with road=null, outside traffic entirely?",
  },
];

async function stageVehicleViews(input) {
  const T = window.THREE;
  const CBZ = window.CBZ;
  if (!T || !CBZ) return { ok: false, error: "no window.THREE / window.CBZ" };
  const S = input.subject || {};
  const kind = S.kind || "car";
  const HALF_PI = Math.PI / 2;
  const DEG = Math.PI / 180;

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

  // ==========================================================================
  //  THE PAGE-WIDE RIG: one renderer, one overlay, a mode switch.
  //  Never deletes page DOM — the live subject needs the game's own canvas.
  // ==========================================================================
  let ST = window.__cbzVehicleViews;
  if (!ST) {
    const renderer = new T.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setSize(input.width, input.height, false);
    renderer.domElement.style.cssText =
      "position:fixed;left:0;top:0;display:block;width:" + input.width + "px;height:" + input.height + "px;z-index:2147483000";
    document.body.appendChild(renderer.domElement);

    const overlay = document.createElement("div");
    overlay.id = "__cbzVehicleViewsOverlay";
    overlay.style.cssText =
      "position:fixed;inset:0;pointer-events:none;color:#f4f8fb;text-shadow:0 2px 9px #000;z-index:2147483600;" +
      "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    overlay.innerHTML = "<div data-side></div><div data-name></div><div data-focus></div>" +
      "<div data-state></div><div data-detail></div><div data-source></div><div data-big></div>";
    document.body.appendChild(overlay);

    ST = window.__cbzVehicleViews = {
      renderer: renderer, overlay: overlay, canvas: renderer.domElement,
      scene: null, camera: null, mode: "studio",
      mats: new Map(), feat: null, live: null, audit: undefined,
    };
    ST.render = function () {
      try {
        if (ST.mode === "live") {
          if (CBZ.renderer && CBZ.scene && CBZ.camera) CBZ.renderer.render(CBZ.scene, CBZ.camera);
        } else if (ST.scene && ST.camera) {
          ST.renderer.render(ST.scene, ST.camera);
        }
      } catch (e) {}
    };
    window.__cbzVisualCompare = { render: ST.render };
  }
  ST.renderer.setSize(input.width, input.height, false);
  ST.canvas.style.width = input.width + "px";
  ST.canvas.style.height = input.height + "px";

  // Show only what this mode photographs. Everything else in the page (the
  // title screen, HUD layers, the other renderer's canvas) goes invisible —
  // never removed, so the next subject can switch back.
  const showOnly = function (keep) {
    const kids = Array.prototype.slice.call(document.body.children);
    for (let i = 0; i < kids.length; i++) {
      const el = kids[i];
      let wanted = false;
      for (let j = 0; j < keep.length; j++) {
        const k = keep[j];
        if (!k) continue;
        if (k === el || (el.contains && el.contains(k))) { wanted = true; break; }
      }
      el.style.visibility = wanted ? "" : "hidden";
    }
  };
  const studioMode = function () {
    ST.mode = "studio";
    showOnly([ST.canvas, ST.overlay]);
  };
  const liveMode = function () {
    ST.mode = "live";
    const gameCanvas = CBZ.renderer && CBZ.renderer.domElement;
    showOnly([gameCanvas, ST.overlay]);
  };
  const allVisible = function () {
    const kids = Array.prototype.slice.call(document.body.children);
    for (let i = 0; i < kids.length; i++) kids[i].style.visibility = "";
    ST.canvas.style.visibility = "hidden";
  };

  const material = function (color, o) {
    const c = Number(color == null ? 0x8a8f96 : color);
    const rough = (o && o.roughness != null) ? Number(o.roughness) : 0.86;
    const key = c + "|" + rough;
    if (!ST.mats.has(key)) {
      ST.mats.set(key, new T.MeshStandardMaterial({ color: c, roughness: rough, metalness: 0.04 }));
    }
    return ST.mats.get(key);
  };

  // ==========================================================================
  //  MEASURED FEATURE DETECTION (once per page)
  //  A flag an old build ignores leaves the geometry identical, so every
  //  question below is answered by building the real thing and counting it.
  //  typeof is only ever the corroborating second opinion.
  // ==========================================================================
  const buildVisual = function (style, color) {
    if (typeof CBZ.cityBuildPlayerCarVisual !== "function") return null;
    try { return CBZ.cityBuildPlayerCarVisual(style, color, null, null); } catch (e) { return null; }
  };

  // The cabin frame the game itself seats bodies against. Road cars publish
  // userData.cabinInfo; SUV/van/cybertruck do not, so re-derive EXACTLY the
  // fallback city/vehicles.js occSeatAnchor() uses — and record that it was
  // derived, because "declared" is itself a before/after number.
  const cabinFrame = function (visual) {
    const ud = (visual && visual.userData) || {};
    const dims = ud.vehicleDims || null;
    const ci = ud.cabinInfo;
    if (ci && Number.isFinite(Number(ci.baseY))) {
      return {
        baseY: Number(ci.baseY), peakY: Number(ci.peakY), cx: Number(ci.cx), w: Number(ci.w),
        declared: true, dims: dims,
      };
    }
    if (!dims || !Number(dims.height)) return null;
    return {
      baseY: dims.height * 0.55, peakY: dims.height * 0.36,
      cx: -(dims.length || 4.4) * 0.04, w: (dims.width || 2) * 0.9,
      declared: false, dims: dims,
    };
  };

  // Count what is REALLY inside the cabin. Three nested questions:
  //   inCabin  every mesh centre inside the greenhouse volume (glass tub,
  //            interior slab, seats, dash, wheel, any occupant)
  //   props    of those, the ones small enough to be furniture rather than
  //            the tub or the body shell (bbox diagonal <= 1.05 m)
  //   inSeat   of those, the ones in the DRIVER's seat volume
  // plus the biggest transparent pane found in the cabin, so the report can
  // argue about glass opacity/renderOrder instead of squinting at a JPEG.
  const surveyCabin = function (visual, fr) {
    const out = {
      total: 0, inCabin: 0, props: 0, inSeat: 0, tagged: 0,
      glassOpacity: null, glassRenderOrder: null, glassDepthWrite: null, glassTransparent: 0,
    };
    if (!visual || !fr) return out;
    const L = (fr.dims && Number(fr.dims.length)) || 4.5;
    const box = new T.Box3(
      new T.Vector3(-fr.w * 0.5 - 0.03, fr.baseY - 0.30, fr.cx - L * 0.28),
      new T.Vector3(fr.w * 0.5 + 0.03, fr.baseY + fr.peakY + 0.08, fr.cx + L * 0.28)
    );
    // driver side is +x (city/vehicles.js seats the driver at +seatX), the seat
    // itself a shin-to-headroom column just aft of the cabin centre.
    const seat = new T.Box3(
      new T.Vector3(fr.w * 0.04, fr.baseY - 0.18, fr.cx - 0.26),
      new T.Vector3(fr.w * 0.54, fr.baseY + fr.peakY * 0.98, fr.cx + 0.55)
    );
    visual.updateMatrixWorld(true);
    const inv = new T.Matrix4().copy(visual.matrixWorld).invert();
    const bb = new T.Box3(), c = new T.Vector3(), sz = new T.Vector3(), m4 = new T.Matrix4();
    let bestDiag = -1;
    visual.traverse(function (o) {
      if (!o.isMesh || !o.geometry) return;
      out.total++;
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      if (!o.geometry.boundingBox) return;
      m4.multiplyMatrices(inv, o.matrixWorld);            // mesh → visual-local
      bb.copy(o.geometry.boundingBox).applyMatrix4(m4);
      bb.getCenter(c); bb.getSize(sz);
      const diag = Math.sqrt(sz.x * sz.x + sz.y * sz.y + sz.z * sz.z);
      const ud = o.userData || {};
      const nm = String(o.name || "");
      if (ud.occupant || ud.driver || ud.passenger || ud.pilot ||
          /occupant|driver|passenger|pilot|rider/i.test(nm)) out.tagged++;
      if (!box.containsPoint(c)) return;
      out.inCabin++;
      if (diag <= 1.05) out.props++;
      if (seat.containsPoint(c)) out.inSeat++;
      const mat = Array.isArray(o.material) ? o.material[0] : o.material;
      if (mat && mat.transparent) {
        out.glassTransparent++;
        if (diag > bestDiag) {
          bestDiag = diag;
          out.glassOpacity = Number.isFinite(Number(mat.opacity)) ? Number(mat.opacity) : null;
          out.glassRenderOrder = Number(o.renderOrder) || 0;
          out.glassDepthWrite = mat.depthWrite ? 1 : 0;
        }
      }
    });
    return out;
  };

  if (!ST.feat) {
    // Throwaway rigs, one per body style: does the LIVE builder publish a
    // cabin frame, and how much furniture does it actually draw?
    const styleProbe = {};
    const probeStyles = ["tesla-3", "suv", "van"];
    for (let i = 0; i < probeStyles.length; i++) {
      const st = probeStyles[i];
      const v = buildVisual(st, 0x808080);
      const fr = cabinFrame(v);
      const sv = v ? surveyCabin(v, fr) : null;
      styleProbe[st] = {
        built: !!v,
        declared: fr ? !!fr.declared : false,
        props: sv ? sv.props : 0,
        inSeat: sv ? sv.inSeat : 0,
        tagged: sv ? sv.tagged : 0,
      };
    }
    // Candidate car-FP verbs. Presence is NOT the test (the behavioural probe
    // in the live subject is) — this list only tells the report what the build
    // even offers, so a rename shows up as a name change and not as silence.
    const FP_NAMES = [
      "carFpMount", "carFirstPerson", "carFpSetView", "cityCarFpMount",
      "cityCarFirstPerson", "cityCarSetView", "cityCarViewToggle", "cityDriveFirstPerson",
      "driveFirstPerson", "driveFpSet", "carInteriorView", "carCockpitView",
      "vehicleFpView", "vehicleFirstPerson", "cockpitSetView", "cockpitToggleView",
      "cockpitCarMount", "camDriveFp",
    ];
    const fpNamed = [];
    for (let i = 0; i < FP_NAMES.length; i++) if (typeof CBZ[FP_NAMES[i]] === "function") fpNamed.push(FP_NAMES[i]);
    const CFG = CBZ.CONFIG || {};
    const FP_FLAGS = ["CAR_FIRST_PERSON", "CAR_FP_VIEW", "VEHICLE_FP_VIEW", "DRIVE_FIRST_PERSON", "COCKPIT_CAR_VIEW"];
    const fpFlags = [];
    for (let i = 0; i < FP_FLAGS.length; i++) if (CFG[FP_FLAGS[i]] !== undefined) fpFlags.push(FP_FLAGS[i]);

    ST.feat = {
      buildVisual: typeof CBZ.cityBuildPlayerCarVisual === "function",
      ambientVisual: typeof CBZ.cityBuildAmbientCarVisual === "function",
      makeCar: typeof CBZ.cityMakeCar === "function",
      cockpit: !!(CBZ.cockpitShapes && typeof CBZ.cockpitShapes.build === "function" &&
                  typeof CBZ.cockpitSpec === "function"),
      sightAudit: typeof CBZ.cockpitSightAudit === "function",
      jet: !!(CBZ.debugBuildAircraft && typeof CBZ.debugBuildAircraft.jet === "function"),
      heli: !!(CBZ.debugBuildAircraft && typeof CBZ.debugBuildAircraft.heli === "function"),
      styleProbe: styleProbe,
      // MEASURED headline: how many body styles publish a cabin frame today.
      cabinsDeclared: probeStyles.filter(function (s) { return styleProbe[s].declared; }).length,
      fpNames: fpNamed,
      fpFlags: fpFlags,
    };
    ST.feat.fpNamesText = fpNamed.length ? fpNamed.join(",") : "none";
  }
  const feat = ST.feat;
  const FP_NAMES_LIVE = feat.fpNames.slice();

  // ==========================================================================
  //  STUDIO SCENE + CAMERA
  // ==========================================================================
  const aspect = input.width / input.height;
  const refCam = (input.referenceStage && input.referenceStage.camera) || null;

  const makeScene = function (opts) {
    const o = opts || {};
    const scene = new T.Scene();
    scene.background = new T.Color(o.sky == null ? 0x1c2836 : o.sky);
    scene.add(new T.HemisphereLight(o.hemiSky == null ? 0xdfeaff : o.hemiSky,
      o.hemiGround == null ? 0x2a2620 : o.hemiGround, o.hemi == null ? 0.92 : o.hemi));
    const key = new T.DirectionalLight(0xffe9c8, o.key == null ? 1.5 : o.key);
    key.position.set(7.5, 11.0, 6.5); scene.add(key);
    const rim = new T.DirectionalLight(0x8fc0ff, 0.66);
    rim.position.set(-8.0, 5.0, -7.5); scene.add(rim);
    const fill = new T.DirectionalLight(0xffffff, 0.26);
    fill.position.set(1.5, 3.5, -9.0); scene.add(fill);
    if (o.ground !== false) {
      const g = new T.Mesh(
        new T.PlaneGeometry(o.groundSize || 400, o.groundSize || 400),
        new T.MeshStandardMaterial({ color: o.groundColor == null ? 0x3a3f45 : o.groundColor, roughness: 0.97 })
      );
      g.rotation.x = -HALF_PI;
      g.position.y = o.groundY == null ? 0 : o.groundY;
      scene.add(g);
    }
    return scene;
  };

  // A tripod written as (azimuth off the nose, absolute eye height, slant
  // range to the aim point, fov). Solving the horizontal leg from dist and the
  // height difference means the framing survives a car whose roofline moves:
  // the range to the subject is exactly `dist`, always.
  const tripod = function (aim, azDeg, camY, dist, fov) {
    const dy = camY - aim.y;
    let horiz = dist * dist - dy * dy;
    horiz = horiz > 0.02 ? Math.sqrt(horiz) : dist * 0.35;
    const a = azDeg * DEG;
    return {
      pos: [aim.x + Math.sin(a) * horiz, camY, aim.z + Math.cos(a) * horiz],
      target: [aim.x, aim.y, aim.z],
      up: [0, 1, 0],
      fov: fov,
    };
  };

  // The AFTER side reuses the BEFORE side's tripod verbatim — the camera must
  // never be a variable. fp-car is the deliberate exception: its camera IS the
  // subject, so it declines the reference and reports both poses instead.
  const applyCamera = function (scene, want, opts) {
    const o = opts || {};
    const cam = (refCam && o.match !== false) ? refCam : want;
    const camera = new T.PerspectiveCamera(
      Number(cam.fov) || 45, aspect,
      o.near == null ? 0.06 : o.near,
      o.far == null ? 6000 : o.far
    );
    camera.position.fromArray(cam.pos);
    camera.up.fromArray(cam.up || [0, 1, 0]);
    camera.lookAt(new T.Vector3().fromArray(cam.target));
    camera.updateProjectionMatrix();
    ST.scene = scene;
    ST.camera = camera;
    ST.renderer.render(scene, camera);
    return {
      pos: cam.pos.slice(), target: cam.target.slice(),
      up: (cam.up || [0, 1, 0]).slice(), fov: Number(cam.fov) || 45,
      matched: !!(refCam && o.match !== false),
    };
  };

  // ==========================================================================
  //  OVERLAY
  // ==========================================================================
  let stateText = "";
  let detailText = "";
  let bigText = "";
  const paint = function () {
    const before = input.side === "before";
    const q = function (sel) { return ST.overlay.querySelector(sel); };
    const el = {
      side: q("[data-side]"), name: q("[data-name]"), focus: q("[data-focus]"),
      state: q("[data-state]"), detail: q("[data-detail]"), source: q("[data-source]"),
      big: q("[data-big]"),
    };
    el.side.textContent = before ? input.beforeLabel : input.afterLabel;
    el.side.style.cssText = "position:absolute;top:22px;left:26px;padding:7px 11px;border-radius:7px;background:" +
      (before ? "#c94c4c" : "#218b60") + ";font-size:12px;font-weight:900;letter-spacing:.12em";
    el.name.textContent = S.label || S.id;
    el.name.style.cssText = "position:absolute;top:64px;left:26px;font-size:27px;font-weight:800;letter-spacing:-.02em";
    el.focus.textContent = S.focus || "";
    el.focus.style.cssText = "position:absolute;top:101px;left:28px;color:#c4d2dd;font-size:13px;font-weight:550;max-width:700px;line-height:1.35";
    el.state.textContent = stateText;
    el.state.style.cssText = "position:absolute;right:26px;top:24px;color:" +
      (before ? "#ff9c9c" : "#80e4b4") +
      ";font-size:11px;font-weight:850;letter-spacing:.11em;text-align:right;max-width:430px;line-height:1.5";
    el.detail.textContent = detailText;
    el.detail.style.cssText = "position:absolute;right:24px;bottom:18px;color:#9fb0bd;" +
      "font:10px ui-monospace,SFMono-Regular,Menlo,monospace;text-align:right;max-width:560px;line-height:1.45";
    let host = input.sourceUrl;
    try { const u = new URL(input.sourceUrl); host = u.host + u.pathname; } catch (e) {}
    el.source.textContent = host;
    el.source.style.cssText = "position:absolute;bottom:18px;left:26px;color:#9cb0bf;font:11px ui-monospace,SFMono-Regular,Menlo,monospace";
    el.big.textContent = bigText;
    el.big.style.cssText = bigText
      ? "position:absolute;inset:0;display:flex;align-items:center;justify-content:center;" +
        "font-size:38px;font-weight:900;letter-spacing:.10em;color:#7f8f9d;text-align:center;padding:0 60px"
      : "display:none";
  };

  // ==========================================================================
  //  SUBJECT: stub — an honest empty slot, never a crash
  // ==========================================================================
  if (kind === "stub") {
    studioMode();
    const scene = makeScene({ sky: 0x121820, ground: false });
    const cam = applyCamera(scene, { pos: [0, 1.6, 6], target: [0, 1.6, 0], up: [0, 1, 0], fov: 45 });
    bigText = "NOT BUILT IN THIS WAVE";
    stateText = "SLOT RESERVED · NOTHING STAGED ON EITHER SIDE";
    detailText = "subject " + S.id + " · staged=false";
    paint();
    return { ok: true, subject: S.id, staged: false, features: feat, camera: cam };
  }

  // ==========================================================================
  //  SUBJECT: car — one hero body, one view
  // ==========================================================================
  if (kind === "car") {
    studioMode();
    const spec = S.car || {};
    const style = spec.style || "tesla-3";
    const visual = buildVisual(style, spec.color == null ? null : spec.color);
    if (!visual) {
      bigText = "cityBuildPlayerCarVisual UNAVAILABLE";
      stateText = "NO CAR BUILDER ON THIS BUILD";
      detailText = "style " + style;
      const scene0 = makeScene({ sky: 0x121820, ground: false });
      const cam0 = applyCamera(scene0, { pos: [0, 1.6, 6], target: [0, 1.6, 0], up: [0, 1, 0], fov: 45 });
      paint();
      return { ok: true, subject: S.id, staged: false, missing: "cityBuildPlayerCarVisual", camera: cam0, features: feat };
    }
    const fr = cabinFrame(visual);
    const scene = makeScene({ sky: 0x1c2836, groundColor: 0x35393f, groundSize: 300 });
    const car = new T.Group();
    car.add(visual);
    scene.add(car);
    scene.updateMatrixWorld(true);
    const survey = surveyCabin(visual, fr);

    const L = (fr && fr.dims && Number(fr.dims.length)) || 4.5;
    // stage() is serialized into the page, so it can never close over module
    // scope — the shared cabin recipe is re-stated here as the literal default.
    const view = S.view || { azDeg: 68, camY: 2.45, dist: 3.6, fov: 40, aim: "cabin" };
    let aim;
    if (!fr) {
      const b = new T.Box3().setFromObject(car);
      const c = b.getCenter(new T.Vector3());
      aim = { x: 0, y: c.y, z: c.z };
    } else if (view.aim === "front") {
      // A PEDESTRIAN'S EYE ON AN ONCOMING CAR. Aiming at the windshield with a
      // short boom put the near clip plane inside the hood and photographed a
      // blue wedge. The aim point is therefore LOW (a little over half the
      // greenhouse base, i.e. about the beltline) and only a third of a body
      // length forward of the cabin, with the boom out at car-lengths: the
      // whole nose and the full width of the fascia sit in the upper half of
      // the frame, the roofline clears the top, and the road stays visible
      // under the bumper. Eye height is a standing adult's, not a kerb's.
      aim = { x: 0, y: fr.baseY * 0.58, z: fr.cx + L * 0.30 };
    } else if (view.aim === "windshield") {
      // Windshield mid-height, at the forward end of the greenhouse: the cabin
      // profile's top corner sits at cx + cabLen*0.30 and its base at
      // cx + cabLen*0.50, so their mean is ~cx + L*0.18 for a road car.
      aim = { x: 0, y: fr.baseY + fr.peakY * 0.58, z: fr.cx + L * 0.18 };
    } else {
      aim = { x: 0, y: fr.baseY + fr.peakY * 0.45, z: fr.cx };
    }
    const want = tripod(aim, view.azDeg, view.camY, view.dist, view.fov);
    const cam = applyCamera(scene, want, { near: 0.05, far: 3000 });

    const metrics = {
      cabinInfoDeclared: fr && fr.declared ? 1 : 0,
      cabinMeshes: survey.inCabin,
      cabinProps: survey.props,
      seatVolumeMeshes: survey.inSeat,
      occupantMeshes: survey.tagged,
      driverPresent: survey.tagged > 0 ? 1 : 0,
      visualMeshes: survey.total,
    };
    if (survey.glassOpacity != null) metrics.glassOpacity = round(survey.glassOpacity);
    if (survey.glassRenderOrder != null) metrics.glassRenderOrder = survey.glassRenderOrder;
    if (survey.glassDepthWrite != null) metrics.glassDepthWrite = survey.glassDepthWrite;

    stateText = (fr && fr.declared ? "cabinInfo DECLARED" : "cabinInfo DERIVED (occSeatAnchor fallback)") +
      " · " + survey.props + " CABIN PROPS · " +
      (survey.tagged > 0 ? survey.tagged + " OCCUPANT MESHES" : "NO OCCUPANT MESH");
    detailText = "style " + style +
      " · dims " + (fr && fr.dims ? round(fr.dims.width, 2) + "x" + round(fr.dims.length, 2) + "x" + round(fr.dims.height, 2) : "?") +
      " · cabin baseY " + (fr ? round(fr.baseY, 2) : "?") + " peakY " + (fr ? round(fr.peakY, 2) : "?") +
      " · meshes " + survey.total + " (cabin " + survey.inCabin + ", props " + survey.props + ", seat " + survey.inSeat + ")" +
      " · glass op " + (survey.glassOpacity == null ? "n/a" : round(survey.glassOpacity, 2)) +
      " ro " + (survey.glassRenderOrder == null ? "n/a" : survey.glassRenderOrder) +
      " · declaredStyles " + feat.cabinsDeclared + "/3";
    paint();
    return {
      ok: true, subject: S.id, staged: true, style: style,
      cabin: fr ? { baseY: round(fr.baseY), peakY: round(fr.peakY), cx: round(fr.cx), w: round(fr.w), declared: fr.declared } : null,
      dims: fr && fr.dims ? { w: round(fr.dims.width), l: round(fr.dims.length), h: round(fr.dims.height) } : null,
      survey: survey, features: feat, camera: cam, metrics: metrics,
    };
  }

  // ==========================================================================
  //  SUBJECT: traffic — the REAL cityMakeCar path, occupants and all
  // ==========================================================================
  if (kind === "traffic") {
    studioMode();
    const scene = makeScene({ sky: 0x1c2836, groundColor: 0x33373c, groundSize: 300 });
    const fleet = new T.Group();
    scene.add(fleet);

    // fixed echelon: deterministic positions → deterministic carHash → the
    // same occupant variants on both builds.
    const slots = [
      { x: 0.0, z: 0.0, h: 0.0, pick: 3 },
      { x: 3.1, z: -2.9, h: 0.0, pick: 11 },
      { x: 6.2, z: -5.8, h: 0.0, pick: 19 },
    ];
    const catalog = (CBZ.cityEcon && Array.isArray(CBZ.cityEcon.CARS)) ? CBZ.cityEcon.CARS : null;
    for (let i = 0; i < slots.length; i++) {
      slots[i].model = catalog && catalog.length ? catalog[slots[i].pick % catalog.length] : null;
    }

    const notes = [];
    let path = "none";
    const cars = [];

    if (typeof CBZ.cityMakeCar === "function") {
      // Borrow the arena for three SYNCHRONOUS calls. Nothing can interleave
      // (single-threaded, no awaits inside), and every global is put back in
      // the finally — including truncating CBZ.cityCars to the mark, so a
      // studio car never joins the live fleet.
      const hadCityOwn = Object.prototype.hasOwnProperty.call(CBZ, "city");
      const prevCity = CBZ.city;
      const cityExisted = !!CBZ.city;
      const arenaExisted = !!(CBZ.city && CBZ.city.arena);
      const prevArena = arenaExisted ? CBZ.city.arena : null;
      const prevRoot = arenaExisted ? CBZ.city.arena.root : null;
      const carsExisted = Array.isArray(CBZ.cityCars);
      const prevCars = CBZ.cityCars;
      try {
        if (!CBZ.city) CBZ.city = {};
        if (!CBZ.city.arena) CBZ.city.arena = { root: fleet };
        else CBZ.city.arena.root = fleet;
        if (!Array.isArray(CBZ.cityCars)) CBZ.cityCars = [];
        const mark = CBZ.cityCars.length;
        for (let i = 0; i < slots.length; i++) {
          let c = null;
          try { c = CBZ.cityMakeCar(slots[i].x, slots[i].z, slots[i].h, false, slots[i].model, 0.3); } catch (e) {
            notes.push("makeCar[" + i + "] " + msg(e));
          }
          if (c) cars.push(c);
        }
        if (CBZ.cityCars.length > mark) CBZ.cityCars.length = mark;
        if (cars.length) path = "cityMakeCar";
      } catch (e) {
        notes.push("arena shim " + msg(e));
      } finally {
        if (cityExisted) {
          if (arenaExisted) { prevArena.root = prevRoot; CBZ.city.arena = prevArena; }
          else { try { delete CBZ.city.arena; } catch (e) { CBZ.city.arena = null; } }
        } else if (hadCityOwn) { CBZ.city = prevCity; }
        else { try { delete CBZ.city; } catch (e) { CBZ.city = undefined; } }
        if (carsExisted) CBZ.cityCars = prevCars;
        else { try { delete CBZ.cityCars; } catch (e) { CBZ.cityCars = undefined; } }
      }
    } else {
      notes.push("no CBZ.cityMakeCar");
    }

    // Honest degrade: visuals with no occupant path at all, and the plate says it.
    if (!cars.length) {
      const mk = typeof CBZ.cityBuildAmbientCarVisual === "function"
        ? function (m) { try { return CBZ.cityBuildAmbientCarVisual(m && m.name); } catch (e) { return null; } }
        : function () { return buildVisual("tesla-3", 0x555b64); };
      for (let i = 0; i < slots.length; i++) {
        const g = mk(slots[i].model);
        if (!g) continue;
        g.position.set(slots[i].x, 0, slots[i].z);
        g.rotation.y = slots[i].h;
        fleet.add(g);
        cars.push({ group: g, _fallback: true });
      }
      if (cars.length) path = feat.ambientVisual ? "cityBuildAmbientCarVisual (NO occupant path)" : "player visual (NO occupant path)";
    }

    scene.updateMatrixWorld(true);

    // occupants counted off the staged groups, never assumed from the API name
    let occTotal = 0;
    const perCar = [];
    for (let i = 0; i < cars.length; i++) {
      let n = 0, meshes = 0;
      const g = cars[i].group;
      if (g) {
        g.traverse(function (o) {
          if (!o.isMesh) return;
          meshes++;
          const ud = o.userData || {};
          if (ud.occupant || ud.driver || ud.passenger ||
              /occupant|driver|passenger/i.test(String(o.name || ""))) {
            if (o.visible !== false) n++;
          }
        });
      }
      occTotal += n;
      perCar.push({ occupants: n, meshes: meshes, bodyKind: (g && g.userData && g.userData.bodyKind) || null });
    }

    // framed on the second car of the echelon so the first fills the near
    // third and the third recedes — occupant heads are ~0.2 m objects, so a
    // wide "three cars" shot would photograph nothing worth counting.
    const aim = { x: 1.55, y: 1.28, z: -1.45 };
    const want = tripod(aim, 34, 2.15, 7.0, 34);
    const cam = applyCamera(scene, want, { near: 0.05, far: 3000 });

    stateText = (cars.length || 0) + " CARS · " + occTotal + " OCCUPANT MESHES · " +
      (path === "cityMakeCar" ? "REAL addOccupants PATH" : "FALLBACK: " + path.toUpperCase());
    detailText = "path " + path +
      " · per-car " + perCar.map(function (p) { return p.occupants + "/" + p.meshes; }).join("  ") +
      " · bodyKinds " + perCar.map(function (p) { return p.bodyKind || "?"; }).join(",") +
      (notes.length ? " · NOTE " + notes.join(" | ") : "");
    paint();
    return {
      ok: true, subject: S.id, staged: cars.length > 0, path: path, notes: notes,
      perCar: perCar, features: feat, camera: cam,
      metrics: {
        carsStaged: cars.length,
        occupantMeshes: occTotal,
        occupantsPerCar: cars.length ? round(occTotal / cars.length, 2) : 0,
        realOccupantPath: path === "cityMakeCar" ? 1 : 0,
      },
    };
  }

  // ==========================================================================
  //  SUBJECT: occupancy — WHO IS ACTUALLY IN THE CAR
  //
  //  Studio, deterministic, and the headline number is MEASURED over a lattice
  //  rather than read off a constant: cars are built by the game's own
  //  cityMakeCar at 240 fixed world points and we count how many carry a REAR
  //  occupant. On the deployed build the answer is structurally zero — there
  //  are only ever two occupant meshes and both sit in the front row — and
  //  that is the before plate, stated as a measurement instead of a claim.
  //
  //  It also proves the LATCH: the three hero cars are made at their sampled
  //  world points and then their groups are moved onto fixed studio slots.
  //  If occupancy were a draw off the current position the crews would change
  //  when they moved. They do not, because the fact was latched where the car
  //  was populated.
  // ==========================================================================
  if (kind === "occupancy") {
    studioMode();
    const scene = makeScene({ sky: 0x1b2634, groundColor: 0x33373c, groundSize: 300 });
    const fleet = new T.Group();
    scene.add(fleet);

    const notes = [];
    const catalog = (CBZ.cityEcon && Array.isArray(CBZ.cityEcon.CARS)) ? CBZ.cityEcon.CARS : null;
    const model = catalog && catalog.length ? catalog[3 % catalog.length] : null;

    // the lattice: 240 fixed points, wide enough apart that carHash decorrelates
    const LAT = [];
    for (let i = 0; i < 240; i++) LAT.push({ x: -600 + (i % 20) * 61, z: -600 + ((i / 20) | 0) * 97 });

    const made = [];
    const hero = [];
    let latticeCars = 0, latticeRear = 0, latticeFront = 0, latticeSeats = 0;
    let occRecord = 0;

    const hadCityOwn = Object.prototype.hasOwnProperty.call(CBZ, "city");
    const prevCity = CBZ.city;
    const cityExisted = !!CBZ.city;
    const arenaExisted = !!(CBZ.city && CBZ.city.arena);
    const prevArena = arenaExisted ? CBZ.city.arena : null;
    const prevRoot = arenaExisted ? CBZ.city.arena.root : null;
    const carsExisted = Array.isArray(CBZ.cityCars);
    const prevCars = CBZ.cityCars;
    const scrap = new T.Group();          // lattice cars are measured, never shown
    if (typeof CBZ.cityMakeCar === "function") {
      try {
        if (!CBZ.city) CBZ.city = {};
        if (!CBZ.city.arena) CBZ.city.arena = { root: scrap };
        else CBZ.city.arena.root = scrap;
        if (!Array.isArray(CBZ.cityCars)) CBZ.cityCars = [];
        const mark = CBZ.cityCars.length;
        for (let i = 0; i < LAT.length; i++) {
          let c = null;
          try { c = CBZ.cityMakeCar(LAT[i].x, LAT[i].z, 0, false, model, 0.3); } catch (e) {
            if (notes.length < 3) notes.push("makeCar " + msg(e));
            break;
          }
          if (!c) continue;
          latticeCars++;
          made.push(c);
          let rear = 0, front = 0, seats = 0;
          if (c.occ && Array.isArray(c.occ.seats)) {
            occRecord++;
            for (let k = 0; k < c.occ.seats.length; k++) {
              seats++;
              if (c.occ.seats[k].row) rear++;
              else if (c.occ.seats[k].slot !== "driver") front++;
            }
          } else {
            // deployed shape: _occDriver always, _occPass sometimes, both FRONT
            if (c._occDriver) seats++;
            if (c._occPass) { seats++; front++; }
          }
          latticeSeats += seats;
          if (rear) latticeRear++;
          if (front) latticeFront++;
          if (rear && hero.length < 3) hero.push(c);
        }
        // fall back to the first three cars when nothing has a back seat (the
        // deployed build) so the plate is still a photograph of the same thing.
        for (let i = 0; hero.length < 3 && i < made.length; i++) {
          if (hero.indexOf(made[i]) < 0) hero.push(made[i]);
        }
        if (CBZ.cityCars.length > mark) CBZ.cityCars.length = mark;
      } catch (e) {
        notes.push("arena shim " + msg(e));
      } finally {
        if (cityExisted) {
          if (arenaExisted) { prevArena.root = prevRoot; CBZ.city.arena = prevArena; }
          else { try { delete CBZ.city.arena; } catch (e) { CBZ.city.arena = null; } }
        } else if (hadCityOwn) { CBZ.city = prevCity; }
        else { try { delete CBZ.city; } catch (e) { CBZ.city = undefined; } }
        if (carsExisted) CBZ.cityCars = prevCars;
        else { try { delete CBZ.cityCars; } catch (e) { CBZ.cityCars = undefined; } }
      }
    } else notes.push("no CBZ.cityMakeCar");

    // move the three heroes onto fixed studio slots — the fact must not move
    const slots = [{ x: 0.0, z: 0.0 }, { x: 3.2, z: -3.0 }, { x: 6.4, z: -6.0 }];
    const perCar = [];
    for (let i = 0; i < hero.length; i++) {
      const c = hero[i], g = c.group;
      if (!g) continue;
      const before = c.occ ? c.occ.seats.length : ((c._occDriver ? 1 : 0) + (c._occPass ? 1 : 0));
      g.position.set(slots[i].x, 0, slots[i].z);
      g.rotation.y = 0;
      fleet.add(g);
      const after = c.occ ? c.occ.seats.length : ((c._occDriver ? 1 : 0) + (c._occPass ? 1 : 0));
      let vis = 0, rear = 0;
      g.traverse(function (o) {
        if (!o.isMesh || !o.userData || !o.userData.occupant) return;
        if (o.visible !== false) vis++;
      });
      if (c.occ) for (let k = 0; k < c.occ.seats.length; k++) if (c.occ.seats[k].row) rear++;
      perCar.push({ seats: after, seatsBeforeMove: before, occupantMeshes: vis, rear: rear });
    }
    // force the blobs visible: a studio car is never "driving", and occWanted
    // hides an idle car's occupants — we are photographing the RECORD.
    fleet.traverse(function (o) { if (o.isMesh && o.userData && o.userData.occupant) o.visible = true; });
    scene.updateMatrixWorld(true);

    // framed from the rear three-quarter, above the beltline, looking FORWARD
    // through the rear side glass — the back seat is the thing on trial, so it
    // gets the frame, and the front row stays in shot behind it for scale.
    const aim = { x: 0.10, y: 1.10, z: -1.15 };
    const want = tripod(aim, 122, 2.55, 7.2, 34);
    const cam = applyCamera(scene, want, { near: 0.05, far: 3000 });

    const rearRate = latticeCars ? latticeRear / latticeCars : 0;
    const frontRate = latticeCars ? latticeFront / latticeCars : 0;
    stateText = "REAR-SEAT RATE " + (rearRate * 100).toFixed(1) + "% OF " + latticeCars + " CARS · " +
      "FRONT-PASS " + (frontRate * 100).toFixed(1) + "% · " +
      (occRecord ? "OCCUPANCY RECORD ON " + occRecord + " CARS" : "NO OCCUPANCY RECORD — FRONT ROW ONLY");
    detailText = "lattice " + latticeCars + " cars / " + latticeSeats + " seats · " +
      "mean " + (latticeCars ? (latticeSeats / latticeCars).toFixed(2) : "0") + " per car · " +
      "hero " + perCar.map(function (p) { return p.seats + "seat/" + p.rear + "rear/" + p.occupantMeshes + "mesh"; }).join("  ") +
      " · latchHeld " + (perCar.every(function (p) { return p.seats === p.seatsBeforeMove; }) ? "yes" : "NO") +
      (notes.length ? " · NOTE " + notes.join(" | ") : "");
    paint();
    return {
      ok: true, subject: S.id, staged: hero.length > 0, notes: notes, perCar: perCar,
      features: feat, camera: cam,
      metrics: {
        latticeCars: latticeCars,
        backseatRate: round(rearRate, 4),
        frontPassRate: round(frontRate, 4),
        meanOccupants: latticeCars ? round(latticeSeats / latticeCars, 3) : 0,
        occupancyRecords: occRecord,
        latchHeld: perCar.every(function (p) { return p.seats === p.seatsBeforeMove; }) ? 1 : 0,
      },
    };
  }

  // ==========================================================================
  //  LIVE BOOT — shared by the two live subjects added in this wave. The
  //  fp-car branch below keeps its own inline copy on purpose: it is a shipped
  //  plate and must not change one byte because a new subject arrived.
  // ==========================================================================
  const bootLiveWorld = async function () {
    allVisible();
    if (ST.live2) return ST.live2;
    const booted = await until(function () {
      return CBZ.game && (CBZ.bootComplete || CBZ.game.state === "title") &&
        typeof CBZ.stepSim === "function" && document.getElementById("playBtn");
    }, 300000);
    if (!booted) return { failed: "never booted" };
    if (CBZ.CONFIG) CBZ.CONFIG.CITY_HITMAN_CAMPAIGN = false;
    const playing = await until(function () {
      if (CBZ.game.state === "playing") return true;
      const b = document.getElementById("playBtn");
      if (b) b.click();
      return CBZ.game.state === "playing";
    }, 120000, 300);
    if (!playing) return { failed: "never playing" };
    if (CBZ.game.cityCampaign) CBZ.game.cityCampaign.phase = "endless_contracts";
    try { if (CBZ.setQualityLevel) CBZ.setQualityLevel(3); } catch (e) {}
    try { if (CBZ.dayPhase) CBZ.dayPhase(0.45); } catch (e) {}
    window.requestAnimationFrame = function () { return 0; };
    await wait(700);
    const L = ST.live2 = { simT: 0, notes: [] };
    for (let i = 0; i < 150; i++) { CBZ.hitstop = 0; CBZ.slowmo = 0; try { CBZ.stepSim(1 / 60); } catch (e) {} L.simT += 1 / 60; }
    return L;
  };
  const liveTick = function (L, n) {
    for (let i = 0; i < (n == null ? 1 : n); i++) {
      CBZ.hitstop = 0; CBZ.slowmo = 0;
      try { CBZ.stepSim(1 / 60); } catch (e) {}
      L.simT += 1 / 60;
      try { if (CBZ.player) CBZ.player.hp = 100; } catch (e) {}
    }
  };
  // the live camera is ours for the length of one plate: rAF is frozen, so the
  // pose we write is the pose that renders. Honours the BEFORE side's tripod.
  const applyLiveCamera = function (want) {
    const c = CBZ.camera;
    const cam = refCam || want;
    if (c) {
      c.position.fromArray(cam.pos);
      c.up.fromArray(cam.up || [0, 1, 0]);
      c.lookAt(new T.Vector3().fromArray(cam.target));
      c.fov = Number(cam.fov) || 45;
      c.updateProjectionMatrix();
      c.updateMatrixWorld(true);
    }
    return { pos: cam.pos.slice(), target: cam.target.slice(), up: (cam.up || [0, 1, 0]).slice(),
      fov: Number(cam.fov) || 45, matched: !!refCam };
  };

  // ==========================================================================
  //  SUBJECT: jack — WHAT COMES OUT OF THE CAR
  // ==========================================================================
  if (kind === "jack") {
    const L = await bootLiveWorld();
    liveMode();
    if (L.failed) {
      bigText = "WORLD NEVER BOOTED";
      stateText = String(L.failed).toUpperCase();
      paint();
      return { ok: true, subject: S.id, staged: false, error: L.failed };
    }
    const notes = [];
    const P = CBZ.player;
    const px = (P && P.pos) ? P.pos.x : 0, pz = (P && P.pos) ? P.pos.z : 0;

    // KILL THE TUTORIAL CARD. cityEnterVehicle raises the one-time "Driving"
    // help modal, which sits dead centre over the subject. It is a DOM overlay,
    // so it is dismissed the way a player dismisses it.
    const dismissHelp = function () {
      try {
        for (const k of ["Escape", " ", "Space"]) {
          document.body.dispatchEvent(new KeyboardEvent("keydown", { key: k, code: k === " " ? "Space" : "Escape", bubbles: true, cancelable: true }));
        }
      } catch (e) {}
      try {
        const all = document.querySelectorAll("div");
        for (let i = 0; i < all.length; i++) {
          const t = all[i].textContent || "";
          if (t.indexOf("Accelerate / brake") >= 0 && t.length < 400) { all[i].style.display = "none"; }
        }
      } catch (e) {}
    };

    // the nearest ambient car that is genuinely IN traffic (a road, an AI, not
    // ours), PREFERRING one with a back seat — the subject of the plate is what
    // comes out of a car, so a car with more than one person in it is the
    // honest sample. The rule is identical on both builds (the deployed one has
    // no occupancy record, so it simply takes the nearest).
    let car = null, bd = 1e9, bs = -1;
    const cars = CBZ.cityCars || [];
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i];
      if (!c || !c.ai || c.player || c.owned || c.dead || !c.road) continue;
      const dx = c.pos.x - px, dz = c.pos.z - pz, d2 = dx * dx + dz * dz;
      if (d2 > 500 * 500) continue;
      let score = 0;
      if (c.occ && c.occ.seats) for (let k = 0; k < c.occ.seats.length; k++) score += c.occ.seats[k].row ? 3 : 1;
      if (score > bs || (score === bs && d2 < bd)) { bs = score; bd = d2; car = c; }
    }
    if (!car) {
      bigText = "NO AMBIENT CAR IN TRAFFIC";
      stateText = "cityCars " + cars.length + " · NONE WITH A ROAD";
      paint();
      return { ok: true, subject: S.id, staged: false, error: "no ambient car" };
    }
    // stage it: stopped, square to the world, one car length off the player's
    // shoulder, so the DOOR SIDE is unambiguous in the frame.
    const HEAD = 0;
    car.pos.x = px + 5.0; car.pos.z = pz + 1.0;
    car.heading = HEAD; car.v = 0; car.baseV = 0;
    if (car.group) { car.group.position.set(car.pos.x, car.group.position.y || 0, car.pos.z); car.group.rotation.y = HEAD; }
    liveTick(L, 20);

    const seatsBefore = (typeof CBZ.carOccupantCount === "function") ? CBZ.carOccupantCount(car)
      : (car.npcDriver ? 1 : 0);
    let blobsBefore = 0;
    if (car.group) car.group.traverse(function (o) {
      if (o.isMesh && o.userData && o.userData.occupant && o.visible !== false) blobsBefore++;
    });
    const pedsBefore = (CBZ.cityPeds || []).length;

    // JACK IT — the game's own verb, exactly what [E]-hold calls.
    try {
      if (P && P.pos) P.pos.set(car.pos.x - 1.6, P.pos.y, car.pos.z);
      if (typeof CBZ.cityEnterVehicle === "function") CBZ.cityEnterVehicle(car);
    } catch (e) { notes.push("enter " + msg(e)); }
    dismissHelp();
    liveTick(L, 100);          // ~1.6 s: long enough for a decision to read
    dismissHelp();

    // MEASURE WHAT CAME OUT, and on which side.
    const out = [];
    const peds = CBZ.cityPeds || [];
    const rx = Math.cos(HEAD), rz = -Math.sin(HEAD);
    for (let i = 0; i < peds.length; i++) {
      const p = peds[i];
      if (!p || p.dead || p.inCar || !p.pos) continue;
      const dx = p.pos.x - car.pos.x, dz = p.pos.z - car.pos.z;
      if (dx * dx + dz * dz > 10 * 10) continue;
      const side = (dx * rx + dz * rz) >= 0 ? "R" : "L";
      const drew = !!(p.armed && !p._holstered && p._weaponProp);
      const handsUp = !!(p.surrender || (p.char && p.char.handsUp));
      const running = !!(p.state === "flee" || (p.fear || 0) >= 8);
      out.push({
        side: side, d: round(Math.sqrt(dx * dx + dz * dz), 2),
        wx: p.pos.x, wz: p.pos.z,
        act: drew ? "drew" : handsUp ? "handsUp" : running ? "ran" : "stood",
        react: p._occLastReact || (p._occSeat && p._occSeat.react) || null,
      });
    }
    let seated = 0, frozen = 0;
    if (car.occ) for (let k = 0; k < car.occ.seats.length; k++) {
      if (car.occ.seats[k].ped) seated++;
      if (car.occ.seats[k].frozen) frozen++;
    }
    const audit = (typeof CBZ.carOccupancyAudit === "function") ? CBZ.carOccupancyAudit() : null;

    // frame it: high three-quarter over the car so BOTH flanks are in shot —
    // the whole point is which door each body used. Centred on the midpoint of
    // the car and whoever got out, so a body that ran does not leave frame.
    let cx = car.pos.x, cz = car.pos.z;
    if (out.length) {
      let sx = 0, sz = 0;
      for (const b of out) { sx += b.wx; sz += b.wz; }
      cx = (car.pos.x + sx / out.length) * 0.5; cz = (car.pos.z + sz / out.length) * 0.5;
    }
    const aim = { x: cx, y: 1.0, z: cz };
    const cam = applyLiveCamera(tripod(aim, 46, 6.2, 13.5, 40));
    ST.render();

    stateText = out.length + " BODIES OUT (" + out.map(function (o) { return o.side + ":" + o.act; }).join(" ") + ")" +
      " · " + seated + " STILL SEATED" + (frozen ? " (" + frozen + " FROZEN)" : "") +
      (audit ? "" : " · NO OCCUPANCY AUDIT ON THIS BUILD");
    detailText = "occupantsBefore " + seatsBefore + " · blobsBefore " + blobsBefore +
      " · pedDelta " + ((CBZ.cityPeds || []).length - pedsBefore) +
      " · reactions " + (out.map(function (o) { return o.react || "-"; }).join(",") || "-") +
      (audit ? " · jacks " + audit.jacks + " hostagesTaken " + audit.hostagesTaken : "") +
      (notes.length ? " · NOTE " + notes.join(" | ") : "");
    paint();
    return {
      ok: true, subject: S.id, staged: true, notes: notes, camera: cam, features: feat,
      bodies: out, audit: audit,
      metrics: {
        occupantsBefore: seatsBefore, blobsBefore: blobsBefore,
        bodiesOut: out.length, stillSeated: seated, frozenSeated: frozen,
        decided: out.filter(function (o) { return o.react; }).length,
        drew: out.filter(function (o) { return o.act === "drew"; }).length,
        handsUp: out.filter(function (o) { return o.act === "handsUp"; }).length,
        ran: out.filter(function (o) { return o.act === "ran"; }).length,
      },
    };
  }

  // ==========================================================================
  //  SUBJECT: boarding — DID THEY WALK, OR DID THEY GLITCH IN?
  //
  //  Both builds run this identical stage. Nothing about it knows whether
  //  boarding.js exists: it recruits with the game's own cityRecruit, boards
  //  with the game's own cityEnterVehicle, and then MEASURES. The measurement
  //  is per-tick, which is the only way to tell a walk from a warp — a summed
  //  distance hides a teleport inside it, but a per-tick maximum cannot.
  // ==========================================================================
  if (kind === "boarding") {
    const L = await bootLiveWorld();
    liveMode();
    if (L.failed) {
      bigText = "WORLD NEVER BOOTED";
      stateText = String(L.failed).toUpperCase();
      paint();
      return { ok: true, subject: S.id, staged: false, error: L.failed };
    }
    const notes = [];
    const P = CBZ.player;
    const px = (P && P.pos) ? P.pos.x : 0, pz = (P && P.pos) ? P.pos.z : 0;
    const dismissHelp = function () {
      try {
        const all = document.querySelectorAll("div");
        for (let i = 0; i < all.length; i++) {
          const t = all[i].textContent || "";
          // THE BOUND WAS THE BUG. The "Driving" card's full text — every key
          // row plus the fuel note — runs past 400 characters, so the guard
          // that was meant to avoid hiding a whole ancestor hid nothing at all
          // and the card sat dead centre over the subject. Match on two of its
          // own strings instead of trusting a length.
          if (t.indexOf("Accelerate / brake") >= 0 && t.indexOf("Handbrake") >= 0 && t.length < 3000) {
            all[i].style.display = "none";
          }
        }
      } catch (e) {}
    };

    // ---- a car we are allowed to just get into -----------------------------
    let car = null, bd = 1e9;
    const cars = CBZ.cityCars || [];
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i];
      if (!c || c.player || c.dead || !c.pos || !c.group) continue;
      // A CAR WITH NO CABIN HAS NO SEATS AND NO DOORS — a bike or an open boat
      // is not a subject for a boarding plate. carCabinInfo ships on BOTH
      // builds, so this narrows the sample identically on each side.
      if (typeof CBZ.carCabinInfo === "function" && !CBZ.carCabinInfo(c)) continue;
      const dx = c.pos.x - px, dz = c.pos.z - pz, d2 = dx * dx + dz * dz;
      if (d2 < bd) { bd = d2; car = c; }
    }
    if (!car) {
      bigText = "NO CAR IN THE WORLD";
      stateText = "cityCars " + cars.length;
      paint();
      return { ok: true, subject: S.id, staged: false, error: "no car" };
    }
    const HEAD = 0;
    car.owned = true; car.ai = false; car.road = null;
    car.pos.x = px + 4.2; car.pos.z = pz;
    car.heading = HEAD; car.v = 0; car.vx = 0; car.vz = 0; car.baseV = 0;
    if (car.group) { car.group.position.set(car.pos.x, car.group.position.y || 0, car.pos.z); car.group.rotation.y = HEAD; }
    liveTick(L, 10);

    // ---- two followers, put DELIBERATELY far from the door ------------------
    // The ask is "walk or run from WHERE THEY ARE", so the plate has to make
    // that distance real. 11 m off the far flank is a walk you can see.
    const crew = [];
    const peds = CBZ.cityPeds || [];
    const cands = [];
    for (let i = 0; i < peds.length; i++) {
      const p = peds[i];
      if (!p || p.dead || p.vendor || p.recruited || p.companion || p.controlled || !p.pos) continue;
      const dx = p.pos.x - px, dz = p.pos.z - pz;
      cands.push({ p: p, d2: dx * dx + dz * dz });
    }
    cands.sort(function (a, b) { return a.d2 - b.d2; });
    for (let i = 0; i < cands.length && crew.length < 2; i++) {
      const p = cands[i].p;
      try { if (typeof CBZ.cityRecruit === "function") CBZ.cityRecruit(p); } catch (e) { notes.push("recruit " + msg(e)); }
      if (p.companion || p.recruited) {
        /* A STAGED POSITION MUST BE A STANDABLE ONE, AND "I RAN collide() ON IT"
           IS NOT A PROOF OF THAT. The first three runs of this plate dropped
           the crew on a fixed ±9.5 m offset and measured them covering 3.75 m
           of a 9.5 m walk in eight seconds. The wanted-vs-actual pair added
           above is what settled it: the mover INTENDED 3.16 m/s and the body
           achieved 0.41 — and the DEPLOYED build, which has no boarding code
           at all, showed the same 15% on the same spot. The bodies were inside
           geometry, and the plate was photographing a wall.
           So candidates are SCORED: `collide` is a depenetration, so how far it
           shoves a point is a direct measure of how buried that point was, and
           the least-shoved candidate wins. The player's own feet are the
           guaranteed-clear fallback, because he is standing there. */
        const base = crew.length ? 1 : -1;
        let best = null, bestPush = 1e9;
        for (let k = 0; k < 6; k++) {
          const ang = Math.atan2(px - car.pos.x, pz - car.pos.z) + base * (0.35 + k * 0.42);
          const cx = px + Math.sin(ang) * 6.5, cz = pz + Math.cos(ang) * 6.5;
          const probe = { x: cx, y: 0, z: cz };
          try { if (CBZ.collide) CBZ.collide(probe, 0.5, 0, 1.7); } catch (e) {}
          const push = Math.hypot(probe.x - cx, probe.z - cz);
          if (push < bestPush) { bestPush = push; best = { x: probe.x, z: probe.z }; }
          if (push < 0.02) break;                       // genuinely clear — take it
        }
        if (!best || bestPush > 0.45) { best = { x: px + base * 1.6, z: pz - 1.2 }; notes.push("fell back to the player's feet"); }
        p.pos.set(best.x, 0, best.z);
        if (p.group) p.group.position.set(p.pos.x, 0, p.pos.z);
        if (p.target) p.target.set(p.pos.x, 0, p.pos.z);
        p.path = null; p.finalGoal = null; p.pause = 0; p.state = "walk";
        crew.push(p);
      }
    }
    if (!crew.length) notes.push("no recruitable civilians in reach");
    liveTick(L, 6);

    // ---- the measurement rig: sample EVERY follower EVERY tick --------------
    const track = crew.map(function (p) {
      return { ped: p, lx: p.pos.x, lz: p.pos.z, path: 0, jump: 0, start: { x: p.pos.x, z: p.pos.z },
               wanted: 0, ticks: 0, phases: {}, moving: 0 };
    });
    /* THE PLATE MEASURES ITS OWN SUBJECT'S DRIVETRAIN, not just the outcome.
       peds.js writes `ped.speed` to the speed it INTENDED this frame and then
       integrates the position separately, so wanted-vs-actual is a direct read
       of whether the shared steering clamped the step (its blocked case cuts
       the forward move to a quarter). Without this pair, a body that crawls
       and a body that is standing still look identical in a summed distance,
       and you end up guessing at which system is holding it. */
    const sample = function () {
      for (let i = 0; i < track.length; i++) {
        const t = track[i], p = t.ped;
        if (!p || !p.pos) continue;
        // an attached body's `pos` is npclife's world mirror, which is exactly
        // the number we want: where the body IS, whatever it is parented to.
        const d = Math.hypot(p.pos.x - t.lx, p.pos.z - t.lz);
        t.path += d;
        // A NUMBER WITHOUT A PROVENANCE IS A RUMOUR. The first run to reach a
        // seat also reported a 5.8 m single-tick jump while the file's own
        // audit reported zero teleports, and the two cannot both be describing
        // the same write. Recording the phase either side of the biggest jump
        // is what tells you WHICH system moved the body.
        if (d > t.jump) {
          t.jump = d;
          t.jumpAt = t.ticks;
          t.jumpFrom = t.lastPhase || "?";
          t.jumpTo = p._cbzArc ? ("arc:" + p._cbzArc.phase) : (p._cbzSeat ? "seated" : ("st:" + (p.state || "?")));
          t.jumpAttached = !!p._npcAttached;
        }
        t.lx = p.pos.x; t.lz = p.pos.z;
        t.ticks++;
        t.wanted += (p.speed || 0);
        if (d > 1e-4) t.moving++;
        const ph = p._cbzArc ? ("arc:" + p._cbzArc.phase) : (p._cbzSeat ? "seated" : ("st:" + (p.state || "?")));
        t.phases[ph] = (t.phases[ph] || 0) + 1;
        t.lastPhase = ph;
      }
    };

    // ---- take the car. The game's own verb, from beside the driver's door. --
    if (P && P.pos) P.pos.set(car.pos.x - 2.4, P.pos.y, car.pos.z);
    try { if (typeof CBZ.cityEnterVehicle === "function") CBZ.cityEnterVehicle(car); } catch (e) { notes.push("enter " + msg(e)); }
    dismissHelp();
    /* 12 s of sim, one tick at a time. THE BUDGET IS THE SUBJECT: a body ten
       metres away walking to a door is supposed to take several seconds, and a
       plate that only waits four is measuring its own impatience. Sampling
       every tick (rather than stepping in bursts) is what makes maxJump mean
       anything — a burst hides a warp inside it. */
    let arcsLive = 0;
    const hasAudit = (typeof CBZ.companionBoardAudit === "function");
    for (let i = 0; i < 480; i++) {
      liveTick(L, 1); sample();
      // THE CARD APPEARS WHEN THE BOARDING COMMITS, AND ON THE LOCAL BUILD THAT
      // IS ~1.5 s LATE — the player now walks to his own door first, so a
      // single dismissal fired right after the call ran before the card
      // existed. Sweep it periodically instead of guessing at one moment.
      if ((i % 45) === 0) dismissHelp();
      // the audit is a full scan of cityPeds + cityCars; polling it every tick
      // is what pushed the DEPLOYED side past the stage budget, and a peak
      // does not need 60 Hz to be a peak.
      if (hasAudit && (i % 20) === 0) {
        try { arcsLive = Math.max(arcsLive, CBZ.companionBoardAudit().arcsLive || 0); } catch (e) {}
      }
    }

    // ---- what ended up where ----------------------------------------------
    const ci = (typeof CBZ.carCabinInfo === "function") ? CBZ.carCabinInfo(car) : null;
    const dimsCar = (car.group && car.group.userData && car.group.userData.vehicleDims) || null;
    const vis = (car.group && car.group.userData && car.group.userData.carVisual) || car.group;
    let inside = 0, visibleInside = 0, attached = 0;
    const inv = new T.Matrix4();
    if (vis) { vis.updateWorldMatrix(true, false); inv.copy(vis.matrixWorld).invert(); }
    for (let i = 0; i < track.length; i++) {
      const p = track[i].ped;
      if (!p || !p.pos || !vis) continue;
      const lp = new T.Vector3(p.pos.x, p.pos.y || 0, p.pos.z).applyMatrix4(inv);
      const inBox = ci
        ? (Math.abs(lp.x) <= (ci.w * 0.5 + 0.45) && lp.z <= ci.zFront + 0.5 && lp.z >= ci.zRear - 0.5)
        : (Math.abs(lp.x) <= 1.4 && Math.abs(lp.z) <= 2.2);
      if (inBox) {
        inside++;
        if (p.group && p.group.visible !== false) visibleInside++;
      }
      if (p._npcAttached) attached++;
      track[i].endLocal = { x: round(lp.x, 2), z: round(lp.z, 2) };
    }
    // door hardware actually present on this car, counted off the scene graph
    let leaves = 0;
    if (vis) vis.traverse(function (o) { if (o.userData && o.userData._cbzDoorLeaf) leaves++; });
    dismissHelp();
    const audit = (typeof CBZ.companionBoardAudit === "function") ? CBZ.companionBoardAudit() : null;
    const maxJump = track.reduce(function (m, t) { return Math.max(m, t.jump); }, 0);
    const walked = track.reduce(function (m, t) { return m + t.path; }, 0);

    // ---- frame it on the PASSENGER flank at window height -------------------
    // The owner's second sentence is about seeing people through the glass, so
    // the camera stands where a pedestrian stands: shoulder height, off the
    // side of the car, looking at the greenhouse.
    // STAND WHERE A PEDESTRIAN STANDS, AND FAR ENOUGH BACK TO SEE THE CAR.
    // The first framing put the lens 5.4 m off a full-size van at fov 36 and
    // photographed a wheel arch. Distance is derived from the vehicle's own
    // published length so a coupe and a box van both fit the frame, and the
    // azimuth looks along -X, which is the flank the shotgun and rear-right
    // doors are on (the seats a companion actually takes).
    const vlen = (dimsCar && dimsCar.length) || 4.6;
    const aim = { x: car.pos.x, y: ci ? Math.max(0.95, ci.beltY + 0.10) : 1.15, z: car.pos.z };
    const cam = applyLiveCamera(tripod(aim, 242, 2.35, Math.max(7.0, vlen * 1.75), 40));
    ST.render();

    stateText = (crew.length ? crew.length : 0) + " FOLLOWERS · " + inside + " ENDED INSIDE THE CABIN" +
      " (" + visibleInside + " VISIBLE) · maxJump " + round(maxJump, 2) + " m/tick" +
      " · walked " + round(walked, 1) + " m · " + leaves + " DOOR LEAVES";
    // wanted-vs-actual: the drivetrain read. Equal = the mover ran free;
    // actual well under wanted = the shared steering was clamping every step.
    const dt60 = 1 / 60;
    const wantAvg = track.length ? track.reduce(function (m, t) { return m + (t.ticks ? t.wanted / t.ticks : 0); }, 0) / track.length : 0;
    const actAvg = track.length ? track.reduce(function (m, t) { return m + (t.ticks ? t.path / (t.ticks * dt60) : 0); }, 0) / track.length : 0;
    const phaseText = track.map(function (t) {
      const ks = Object.keys(t.phases).sort(function (a, b) { return t.phases[b] - t.phases[a]; });
      return ks.slice(0, 3).map(function (k) { return k + "x" + t.phases[k]; }).join(",");
    }).join(" | ");
    detailText = "seats " + (CBZ.boarding && CBZ.boarding.seatsOf ? (CBZ.boarding.seatsOf(car) || []).length : "n/a") +
      " · attached " + attached +
      " · speed wanted " + round(wantAvg, 2) + " actual " + round(actAvg, 2) + " m/s" +
      " · phases " + (phaseText || "-") +
      " · ends " + (track.map(function (t) { return t.endLocal ? ("(" + t.endLocal.x + "," + t.endLocal.z + ")") : "-"; }).join(" ") || "-") +
      (audit ? " · audit boarded " + audit.boarded + " arcs " + audit.arcsRun + " teleports " + audit.teleports
             : " · NO BOARDING AUDIT ON THIS BUILD") +
      (notes.length ? " · NOTE " + notes.join(" | ") : "");
    paint();
    return {
      ok: true, subject: S.id, staged: true, notes: notes, camera: cam, features: feat,
      audit: audit,
      jumps: track.map(function (t) {
        return { m: round(t.jump, 2), atTick: t.jumpAt || 0, from: t.jumpFrom || "-", to: t.jumpTo || "-", attached: !!t.jumpAttached };
      }),
      metrics: {
        followers: crew.length,
        endedInsideCabin: inside,
        visibleInsideCabin: visibleInside,
        maxJumpPerTick: round(maxJump, 3),
        metresWalked: round(walked, 1),
        arcsStillRunning: (typeof CBZ.companionBoardAudit === "function") ? (CBZ.companionBoardAudit().arcsLive | 0) : 0,
        peakArcsLive: arcsLive,
        speedWanted: round(wantAvg, 2),
        speedActual: round(actAvg, 2),
        doorLeaves: leaves,
        seatedAttached: attached,
      },
    };
  }

  // ==========================================================================
  //  SUBJECT: dbtraffic — IS THE DRIVE-BY CAR IN TRAFFIC AT ALL
  // ==========================================================================
  if (kind === "dbtraffic") {
    const L = await bootLiveWorld();
    liveMode();
    if (L.failed) {
      bigText = "WORLD NEVER BOOTED";
      stateText = String(L.failed).toUpperCase();
      paint();
      return { ok: true, subject: S.id, staged: false, error: L.failed };
    }
    const notes = [];
    const P = CBZ.player;
    const px = (P && P.pos) ? P.pos.x : 0, pz = (P && P.pos) ? P.pos.z : 0;

    let fired = false;
    const gangs = CBZ.cityGangs || [];
    if (typeof CBZ.cityGangDriveby === "function" && gangs.length) {
      for (let k = 0; k < 6 && !fired; k++) {
        try { fired = !!CBZ.cityGangDriveby(gangs[k % gangs.length], { x: px, z: pz }, null); } catch (e) { notes.push("driveby " + msg(e)); }
        if (!fired) liveTick(L, 30);
      }
    } else notes.push("no CBZ.cityGangDriveby / no gangs");
    liveTick(L, 90);

    // find the drive-by car the same way on BOTH builds: the _driveby flag has
    // existed since the real-car wave, so this measurement is comparable.
    let db = null;
    const cars = CBZ.cityCars || [];
    for (let i = 0; i < cars.length; i++) if (cars[i] && cars[i]._driveby) { db = cars[i]; break; }
    const audit = (typeof CBZ.drivebyAudit === "function") ? CBZ.drivebyAudit() : null;
    const onRoad = db ? (db.road ? 1 : 0) : 0;

    let crew = 0;
    if (db) {
      const peds = CBZ.cityPeds || [];
      for (let i = 0; i < peds.length; i++) if (peds[i] && peds[i].inCar === db) crew++;
    }
    // how much of the ordinary traffic is around it — a car "in traffic" should
    // have neighbours in lanes, not an empty beeline.
    let neighbours = 0;
    if (db) for (let i = 0; i < cars.length; i++) {
      const c = cars[i];
      if (!c || c === db || c.dead || !c.road) continue;
      const dx = c.pos.x - db.pos.x, dz = c.pos.z - db.pos.z;
      if (dx * dx + dz * dz < 60 * 60) neighbours++;
    }

    const at = db ? db.pos : { x: px, y: 0, z: pz };
    const aim = { x: at.x, y: 1.2, z: at.z };
    const cam = applyLiveCamera(tripod(aim, 40, 9.0, 22.0, 46));
    ST.render();

    if (!db) {
      bigText = "NO DRIVE-BY CAR STAGED";
      stateText = "cityGangDriveby " + (fired ? "returned true but no _driveby car" : "refused") +
        " · gangs " + gangs.length;
    } else {
      stateText = (onRoad ? "IN TRAFFIC — road=" + (db.road.district || "core") + " lane " + (db.laneIdx | 0)
        : "OUTSIDE TRAFFIC — road=null (private steering)") +
        " · CREW " + crew + " · " + neighbours + " CARS IN LANES WITHIN 60 m";
    }
    detailText = "drivebyCar " + (db ? "yes" : "no") + " · road " + (db && db.road ? "set" : "null") +
      " · v " + (db ? round(db.v, 2) : 0) + " · reckless " + (db && db.reckless ? 1 : 0) +
      " · chase " + (db && db.roadRageTarget ? 1 : 0) +
      (audit ? " · audit inTraffic " + audit.inTraffic + " offRoad " + audit.offRoad +
        " claimed " + audit.claimedFromTraffic + " rail " + audit.railCars : " · NO drivebyAudit ON THIS BUILD") +
      (notes.length ? " · NOTE " + notes.join(" | ") : "");
    paint();
    return {
      ok: true, subject: S.id, staged: !!db, notes: notes, camera: cam, features: feat, audit: audit,
      metrics: {
        drivebyStaged: db ? 1 : 0, onRoad: onRoad, crewAboard: crew,
        trafficNeighbours: neighbours,
        speed: db ? round(db.v, 2) : 0,
        inTraffic: audit ? audit.inTraffic : (onRoad ? 1 : 0),
        offRoad: audit ? audit.offRoad : (db && !db.road ? 1 : 0),
      },
    };
  }

  // ==========================================================================
  //  SUBJECT: cockpit — the fighter's front office from the design eye
  // ==========================================================================
  if (kind === "cockpit") {
    studioMode();
    const spec0 = S.cockpit || { airClass: "jet", displayName: "PROBE JET", want: "fighter" };
    if (!feat.cockpit) {
      bigText = "COCKPIT GENERATOR UNAVAILABLE";
      stateText = "NO CBZ.cockpitSpec / cockpitShapes.build ON THIS BUILD";
      detailText = "cockpitSpec " + (typeof CBZ.cockpitSpec) + " · cockpitShapes " + (CBZ.cockpitShapes ? "yes" : "no");
      const scene0 = makeScene({ sky: 0x121820, ground: false });
      const cam0 = applyCamera(scene0, { pos: [0, 1.6, 6], target: [0, 1.6, 0], up: [0, 1, 0], fov: 45 });
      paint();
      return { ok: true, subject: S.id, staged: false, missing: "cockpit-generator", camera: cam0, features: feat };
    }
    // The sanctioned synthetic probe: cockpitSightAudit() itself calls
    // cockpitSpec on exactly this kind of bare literal when no aeroplane is
    // in the world, so nothing here invents a private seam.
    let spec = null, built = null, err = null;
    try {
      spec = CBZ.cockpitSpec({ airClass: spec0.airClass || "jet", displayName: spec0.displayName || "PROBE JET" });
      built = CBZ.cockpitShapes.build(spec, {});
    } catch (e) { err = msg(e); }
    if (!built || !built.root) {
      bigText = "COCKPIT BUILD FAILED";
      stateText = "cockpitShapes.build THREW";
      detailText = String(err || "no root returned");
      const scene0 = makeScene({ sky: 0x121820, ground: false });
      const cam0 = applyCamera(scene0, { pos: [0, 1.6, 6], target: [0, 1.6, 0], up: [0, 1, 0], fov: 45 });
      paint();
      return { ok: true, subject: S.id, staged: false, error: err, camera: cam0, features: feat };
    }

    // ---- PAINT THE TWO UNMAPPED FACES ------------------------------------
    // cockpitShapes.build() hands back a panel face and a head-up combiner
    // whose materials are created with `map: null`. Their canvases are only
    // wired up by CBZ.cockpitAttach(), which needs a real craft in a real
    // world — so a studio that calls build() directly gets a WHITE unlit quad
    // where the instruments belong and, far worse, a white ADDITIVE quad
    // 0.40 m in front of the eye where the combiner belongs. That second one
    // is the blowout that swallowed the middle of the frame.
    //
    // Fix through the panel kit's own published entry points, with ONE static
    // flight snapshot (no clock, no rng, no live tick) so both builds paint
    // the identical bitmap. Every seam is typeof-guarded: a build that lacks
    // one darkens the face instead of leaving it white.
    const paintNotes = [];
    {
      const hex = function (n, d) {
        const v = Number.isFinite(Number(n)) ? Number(n) : d;
        return "#" + ("00000" + ((v >>> 0)).toString(16)).slice(-6);
      };
      const pal = spec.pal || {};
      // the kit speaks CSS colour strings, the spec speaks hex numbers
      const PAL = {
        panelTop: hex(pal.panelTop, 0x1b2027), panelBot: hex(pal.panelBot, 0x0e1116),
        bezel: hex(pal.bezel, 0x15181c), dialFace: hex(pal.dialFace, 0x0b0d10),
        ink: hex(pal.ink, 0x9fe8c3),
      };
      // level-ish, fast, gear up, ordnance aboard — chosen so every gauge on
      // every layout has something to say and nothing reads as a fault light.
      let SNAP = {
        ias: 320, gs: 330, mach: 0.52, alt: 8200, agl: 8000, vsi: 240, hdg: 47,
        pitch: 3.5, roll: -8, aoa: 2.6, slip: 0, slipDeg: -1.2, g: 1.15,
        thr: 0.78, rpm: 0.82, rotor: 0.98, ng: 0.9, torque: 0.6, fuel: 0.72,
        hp: 1, ammo: 4, maxAmmo: 6, vne: 620,
        stalled: false, gear: false, onGround: false, autorotating: false,
        bayOpen: false, lock: false, name: spec.name || "PROBE JET",
      };
      if (typeof CBZ.cockpitNormalizeState === "function") {
        try { SNAP = CBZ.cockpitNormalizeState(SNAP); } catch (e) { paintNotes.push("normalizeState " + msg(e)); }
      }
      // NOTE: no tex.encoding here. core/renderer.js runs the game in
      // sRGBEncoding output; this studio renderer is left at r128's default,
      // and tagging the canvas sRGB against a linear output would darken the
      // instruments by a gamma. Untagged means "show me exactly what I drew".
      const canvasTex = function (c) {
        const tex = new T.CanvasTexture(c);
        tex.minFilter = T.LinearFilter;
        tex.magFilter = T.LinearFilter;
        tex.generateMipmaps = false;
        if (T.ClampToEdgeWrapping) tex.wrapS = tex.wrapT = T.ClampToEdgeWrapping;
        return tex;
      };
      const parts = built.parts || {};

      // --- instrument panel face
      const panelMesh = parts.panelMesh;
      let panelOk = false;
      if (panelMesh && panelMesh.material) {
        try {
          const size = (typeof CBZ.cockpitLayoutSize === "function" && CBZ.cockpitLayoutSize(spec.layout)) ||
            { w: 1024, h: 384 };
          const c = document.createElement("canvas");
          c.width = size.w; c.height = size.h;
          const ctx = c.getContext("2d");
          if (ctx) {
            let base = null;
            if (typeof CBZ.cockpitPaintBase === "function") {
              const bc = document.createElement("canvas");
              bc.width = size.w; bc.height = size.h;
              const bx = bc.getContext("2d");
              if (bx) { CBZ.cockpitPaintBase(bx, size.w, size.h, PAL, spec.layout); base = bc; }
            }
            if (typeof CBZ.cockpitPaintPanel === "function") {
              CBZ.cockpitPaintPanel(ctx, base, size.w, size.h, SNAP, PAL, spec.layout);
              panelOk = true;
            } else if (base) { ctx.drawImage(base, 0, 0); panelOk = true; }
            if (panelOk) {
              panelMesh.material.map = canvasTex(c);
              panelMesh.material.needsUpdate = true;
            }
          }
        } catch (e) { paintNotes.push("panel " + msg(e)); panelOk = false; }
        if (!panelOk) {
          // never leave an unlit white slab where the instruments belong
          if (panelMesh.material.color && panelMesh.material.color.setHex) {
            panelMesh.material.color.setHex(Number.isFinite(Number(pal.dialFace)) ? Number(pal.dialFace) : 0x0b0d10);
            panelMesh.material.needsUpdate = true;
          }
          paintNotes.push("panel canvas unavailable — face darkened");
        }
      }

      // --- head-up combiner: additive blending + map:null = a white flare
      const hudMesh = parts.hudMesh;
      let hudOk = false;
      if (hudMesh && hudMesh.material) {
        try {
          if (typeof CBZ.cockpitHudDraw === "function") {
            const c = document.createElement("canvas");
            c.width = 512; c.height = 448;
            const ctx = c.getContext("2d");
            if (ctx) {
              CBZ.cockpitHudDraw(ctx, 512, 448, SNAP, { ink: PAL.ink, mode: "NAV" });
              hudMesh.material.map = canvasTex(c);
              hudMesh.material.needsUpdate = true;
              hudOk = true;
            }
          }
        } catch (e) { paintNotes.push("hud " + msg(e)); }
        if (!hudOk) {
          // an additive white rectangle over the pilot's eyeline is worse than
          // no combiner at all — hide it and say so on the plate.
          hudMesh.visible = false;
          paintNotes.push("hud symbology unavailable — combiner hidden");
        }
      }
      built._painted = { panel: panelOk ? 1 : 0, hud: hudOk ? 1 : 0, hasHud: hudMesh ? 1 : 0 };
    }

    // ---- windscreen sanity, MEASURED off the shared glass material --------
    // (never mutated: CBZ.glass() hands back a module-cached, _shared material
    // that the live city is also using.)
    let glaze = null;
    {
      const gm = (built.parts && built.parts.glassMats && built.parts.glassMats[0]) || null;
      if (gm) {
        glaze = {
          opacity: Number.isFinite(Number(gm.opacity)) ? Number(gm.opacity) : null,
          transparent: gm.transparent ? 1 : 0,
          depthWrite: gm.depthWrite ? 1 : 0,
          emissiveIntensity: Number.isFinite(Number(gm.emissiveIntensity)) ? Number(gm.emissiveIntensity) : null,
          doubleSide: gm.side === T.DoubleSide ? 1 : 0,
        };
      }
    }

    // Cockpit geometry is BODY-LOCAL with the design eye at spec.eye. The
    // horizon is a plate far below and far away: an aeroplane in flight sees
    // the world edge at eye level, and this is a deterministic stand-in for it.
    // The light rig is deliberately softer than the vehicle plates: the panel
    // face is an UNLIT MeshBasicMaterial canvas, so an interior lit to street
    // brightness drowns the instrument ink and hazes the 17%-opacity canopy.
    const scene = makeScene({
      sky: 0x6f9dc4, hemiSky: 0xbfd4ea, hemiGround: 0x4c4a42, hemi: 0.58, key: 0.85,
      groundColor: 0x445039, groundSize: 30000, groundY: -260,
    });
    scene.add(built.root);
    scene.updateMatrixWorld(true);

    let meshCount = 0;
    let tri = 0;
    built.root.traverse(function (o) {
      if (!o.isMesh) return;
      meshCount++;
      const g = o.geometry;
      if (g && g.index) tri += g.index.count / 3;
      else if (g && g.attributes && g.attributes.position) tri += g.attributes.position.count / 3;
    });
    const declared = Number(built.root.userData && built.root.userData.cockpitMeshCount);

    // downVision straight from the ratchet's own audit (cached: it builds five
    // probe cockpits of its own and that is not a per-subject cost).
    if (ST.audit === undefined) {
      ST.audit = null;
      if (feat.sightAudit) { try { ST.audit = CBZ.cockpitSightAudit(); } catch (e) { ST.audit = null; } }
    }
    let downDeg = null, seatDown = null, auditFor = null;
    const A = ST.audit;
    if (A && Array.isArray(A.per)) {
      const wantId = String(spec0.want || spec.id || "fighter");
      for (let i = 0; i < A.per.length; i++) {
        const p = A.per[i];
        if (p && String(p.id || "").indexOf(wantId) === 0) { auditFor = p; break; }
      }
      if (!auditFor && A.per.length) auditFor = A.per[0];
      if (auditFor) {
        downDeg = Number(auditFor.downVisionDeg);
        seatDown = Number(auditFor.seatDownDeg);
      }
    }

    const eye = spec.eye || { x: 0, y: 0, z: 0 };
    // Nose is +Z in canonical space; a pilot's gaze sits a hair below level.
    const want = {
      pos: [eye.x, eye.y, eye.z],
      target: [eye.x, eye.y - 0.9, eye.z + 30],
      up: [0, 1, 0],
      // The cockpit overlay pass shares the main camera's FOV, and the city
      // vehicle/aircraft chase runs at 66 — so 66 is what the seat really sees.
      fov: 66,
    };
    const cam = applyCamera(scene, want, { near: 0.03, far: 60000 });

    const metrics = {
      cockpitMeshes: Number.isFinite(declared) && declared > 0 ? declared : meshCount,
      cockpitMeshesWalked: meshCount,
      cockpitTriangles: Math.round(tri),
    };
    if (Number.isFinite(downDeg)) metrics.downVisionDeg = round(downDeg, 2);
    if (Number.isFinite(seatDown)) metrics.seatDownDeg = round(seatDown, 2);
    if (A && A.minDeg != null) metrics.sightFloorDeg = Number(A.minDeg);
    const painted = built._painted || { panel: 0, hud: 0, hasHud: 0 };
    metrics.panelPainted = painted.panel;
    if (painted.hasHud) metrics.hudPainted = painted.hud;
    if (glaze && glaze.opacity != null) metrics.windscreenOpacity = round(glaze.opacity, 3);

    stateText = metrics.cockpitMeshes + " COCKPIT MESHES" +
      (Number.isFinite(downDeg) ? " · DOWN VISION " + round(downDeg, 1) + "°" : " · SIGHT AUDIT UNAVAILABLE") +
      (A && A.blocked ? " · BLOCKED" : "") +
      (painted.panel ? "" : " · PANEL UNPAINTED");
    detailText = "class " + spec.id + " · layout " + spec.layout +
      " · painted panel " + (painted.panel ? "yes" : "no") +
      (painted.hasHud ? " hud " + (painted.hud ? "yes" : "HIDDEN") : "") +
      " · glaze " + (glaze
        ? "op " + round(glaze.opacity, 2) + " ei " + round(glaze.emissiveIntensity, 2) +
          " dw " + glaze.depthWrite + " 2side " + glaze.doubleSide
        : "none") +
      " · eye " + round(eye.x, 2) + "," + round(eye.y, 2) + "," + round(eye.z, 2) + " (" + spec.eyeSource + ")" +
      " · scale " + round(spec.scale, 3) +
      " · panel dist " + round(spec.panel && spec.panel.dist, 2) + " drop " + round(spec.panel && spec.panel.drop, 2) +
      " · declared " + (Number.isFinite(declared) ? declared : "n/a") + " walked " + meshCount +
      " · tris " + Math.round(tri) +
      (A ? " · audit " + (A.measured || 0) + " worst " + (A.worst || "?") + " panelsIntact " + (A.panelsIntact ? "yes" : "no") : "") +
      (paintNotes.length ? " · NOTE " + paintNotes.join(" | ") : "");
    paint();
    return {
      ok: true, subject: S.id, staged: true,
      spec: {
        id: spec.id, layout: spec.layout, eyeSource: spec.eyeSource,
        scale: round(spec.scale, 3),
        eye: [round(eye.x), round(eye.y), round(eye.z)],
      },
      audit: auditFor || null, painted: painted, glaze: glaze, paintNotes: paintNotes,
      features: feat, camera: cam, metrics: metrics,
    };
  }

  // ==========================================================================
  //  SUBJECT: aircraft — the plane from outside, pilot in the seat
  // ==========================================================================
  if (kind === "aircraft") {
    studioMode();
    let grp = null, which = null;
    if (feat.jet) { try { grp = CBZ.debugBuildAircraft.jet(); which = "jet"; } catch (e) { grp = null; } }
    if (!grp && feat.heli) { try { grp = CBZ.debugBuildAircraft.heli(); which = "heli"; } catch (e) { grp = null; } }
    if (!grp && CBZ.debugBuildPlayerVehicle && typeof CBZ.debugBuildPlayerVehicle.helicopter === "function") {
      try { grp = CBZ.debugBuildPlayerVehicle.helicopter(); which = "heli-fallback"; } catch (e) { grp = null; }
    }
    if (!grp) {
      bigText = "NO STANDALONE AIRCRAFT BUILDER";
      stateText = "CBZ.debugBuildAircraft UNAVAILABLE ON THIS BUILD";
      detailText = "debugBuildAircraft " + (CBZ.debugBuildAircraft ? "present" : "absent");
      const scene0 = makeScene({ sky: 0x121820, ground: false });
      const cam0 = applyCamera(scene0, { pos: [0, 1.6, 8], target: [0, 1.6, 0], up: [0, 1, 0], fov: 45 });
      paint();
      return { ok: true, subject: S.id, staged: false, missing: "debugBuildAircraft", camera: cam0, features: feat };
    }

    // playeraircraft.js reveals userData.pilot the moment somebody boards
    // (enterAircraft: pilot.visible = true). This plate is the boarded state.
    const pilot = grp.userData && grp.userData.pilot;
    if (pilot) pilot.visible = true;
    const canopy = grp.userData && grp.userData.canopy;

    const scene = makeScene({ sky: 0x21384c, groundColor: 0x2f3339, groundSize: 600 });
    scene.add(grp);
    grp.updateMatrixWorld(true);
    // stand it on the tarmac rather than guessing a gear height
    const gb = new T.Box3().setFromObject(grp);
    if (Number.isFinite(gb.min.y)) grp.position.y -= gb.min.y;
    scene.updateMatrixWorld(true);

    let pilotMeshes = 0;
    if (pilot) pilot.traverse(function (o) { if (o.isMesh) pilotMeshes++; });

    // Measured, not tagged: everything sitting inside the canopy volume.
    let canopyMeshes = 0;
    let canopyCentre = null;
    if (canopy) {
      const cb = new T.Box3().setFromObject(canopy);
      canopyCentre = cb.getCenter(new T.Vector3());
      const grown = cb.clone().expandByScalar(0.12);
      const bb = new T.Box3(), c = new T.Vector3();
      grp.traverse(function (o) {
        if (!o.isMesh || o === canopy) return;
        bb.setFromObject(o);
        bb.getCenter(c);
        if (grown.containsPoint(c)) canopyMeshes++;
      });
    }
    let total = 0;
    grp.traverse(function (o) { if (o.isMesh) total++; });

    const box = new T.Box3().setFromObject(grp);
    const size = box.getSize(new T.Vector3());
    const centre = box.getCenter(new T.Vector3());
    const aim = canopyCentre
      ? { x: canopyCentre.x, y: canopyCentre.y, z: canopyCentre.z }
      : { x: centre.x, y: box.min.y + size.y * 0.72, z: centre.z + size.z * 0.22 };
    // three-quarter, AT canopy height, close enough that the canopy is a
    // window and not a highlight.
    const want = tripod(aim, 42, Math.max(aim.y + 0.15, 1.6), Math.max(5.0, size.z * 0.72), 34);
    const cam = applyCamera(scene, want, { near: 0.05, far: 4000 });

    const metrics = {
      pilotMeshes: pilotMeshes,
      pilotVisible: pilot && pilot.visible ? 1 : 0,
      canopyVolumeMeshes: canopyMeshes,
      airframeMeshes: total,
    };
    stateText = (pilot ? pilotMeshes + " PILOT MESHES" : "NO userData.pilot") +
      " · " + canopyMeshes + " MESHES UNDER THE CANOPY";
    detailText = "craft " + which +
      " · airframe " + round(size.x, 2) + "x" + round(size.y, 2) + "x" + round(size.z, 2) +
      " · meshes " + total +
      " · pilot " + (pilot ? "group(" + pilotMeshes + ")" : "absent") +
      " · canopy " + (canopy ? "tagged" : "absent");
    paint();
    return {
      ok: true, subject: S.id, staged: true, craft: which,
      features: feat, camera: cam, metrics: metrics,
    };
  }

  // ==========================================================================
  //  SUBJECT: live — the real world, the real camera, the real car
  // ==========================================================================
  if (kind === "live") {
    allVisible();   // the boot needs a clickable, laid-out page

    let L = ST.live;
    if (!L) {
      const booted = await until(function () {
        return CBZ.game && (CBZ.bootComplete || CBZ.game.state === "title") &&
          typeof CBZ.stepSim === "function" && document.getElementById("playBtn");
      }, 300000);
      if (!booted) {
        liveMode();
        bigText = "WORLD NEVER BOOTED";
        stateText = "NO PLAY BUTTON / NO CBZ.stepSim WITHIN 300s";
        detailText = "game " + (CBZ.game ? CBZ.game.state : "absent");
        paint();
        return { ok: true, subject: S.id, staged: false, error: "never booted" };
      }
      if (CBZ.CONFIG) CBZ.CONFIG.CITY_HITMAN_CAMPAIGN = false;
      const playing = await until(function () {
        if (CBZ.game.state === "playing") return true;
        const b = document.getElementById("playBtn");
        if (b) b.click();
        return CBZ.game.state === "playing";
      }, 120000, 300);
      if (!playing) {
        liveMode();
        bigText = "NEVER REACHED PLAYING";
        stateText = "THE BUILD WOULD NOT ENTER FREE PLAY";
        detailText = "game " + CBZ.game.state;
        paint();
        return { ok: true, subject: S.id, staged: false, error: "never playing" };
      }
      if (CBZ.game.cityCampaign) CBZ.game.cityCampaign.phase = "endless_contracts";
      try { if (CBZ.setQualityLevel) CBZ.setQualityLevel(3); } catch (e) {}
      try { if (CBZ.dayPhase) CBZ.dayPhase(0.45); } catch (e) {}

      // Freeze the render loop; CBZ.stepSim becomes the only clock, so both
      // builds sample the same simulated seconds on any machine.
      window.requestAnimationFrame = function () { return 0; };
      await wait(700);
      L = ST.live = { simT: 0, car: null, notes: [] };
      for (let i = 0; i < 120; i++) { CBZ.hitstop = 0; CBZ.slowmo = 0; try { CBZ.stepSim(1 / 60); } catch (e) {} L.simT += 1 / 60; }
    }
    liveMode();

    const tick = function (n) {
      const count = n == null ? 1 : n;
      for (let i = 0; i < count; i++) {
        CBZ.hitstop = 0; CBZ.slowmo = 0;
        try { CBZ.stepSim(1 / 60); } catch (e) {}
        L.simT += 1 / 60;
        try { if (CBZ.player) CBZ.player.hp = 100; } catch (e) {}
      }
    };

    // ---- board a real car ------------------------------------------------
    if (!L.car) {
      const P = CBZ.player;
      const px = (P && P.pos) ? P.pos.x : 0, pz = (P && P.pos) ? P.pos.z : 0;
      let car = null;
      try {
        if (typeof CBZ.citySpawnOwnedCar === "function") car = CBZ.citySpawnOwnedCar(px + 4.5, pz + 1.5, "Voltra Ion");
      } catch (e) { L.notes.push("spawn " + msg(e)); }
      if (!car) {
        try { if (typeof CBZ.citySpawnOwnedCar === "function") car = CBZ.citySpawnOwnedCar(px + 4.5, pz + 1.5); } catch (e) { L.notes.push("spawn2 " + msg(e)); }
      }
      if (car) {
        try {
          if (CBZ.player && CBZ.player.pos) CBZ.player.pos.set(car.pos.x, CBZ.player.pos.y, car.pos.z);
          if (typeof CBZ.cityEnterVehicle === "function") CBZ.cityEnterVehicle(car);
        } catch (e) { L.notes.push("enter " + msg(e)); }
      } else {
        L.notes.push("no owned car — shooting the on-foot camera");
      }
      L.car = car || null;
      tick(150);   // let the chase rig's smoothDamp settle onto the car
    }
    const car = L.car;

    // ---- the honest test: is the camera INSIDE the cabin? ----------------
    const cabinWorldBox = function () {
      if (!car || !car.group) return null;
      const grp = car.group;
      const vis = car._playerCarVisual || (grp.userData && grp.userData.carVisual) || grp;
      const fr = cabinFrame(vis) || cabinFrame(grp);
      if (!fr) return null;
      const len = (fr.dims && Number(fr.dims.length)) || (car.dims && Number(car.dims.length)) || 4.5;
      const local = new T.Box3(
        new T.Vector3(-fr.w * 0.5 - 0.10, fr.baseY - 0.45, fr.cx - len * 0.30),
        new T.Vector3(fr.w * 0.5 + 0.10, fr.baseY + fr.peakY + 0.15, fr.cx + len * 0.30)
      );
      grp.updateMatrixWorld(true);
      return local.applyMatrix4(grp.matrixWorld);
    };
    const camSample = function () {
      const c = CBZ.camera;
      const box = cabinWorldBox();
      const p = c ? c.position : { x: 0, y: 0, z: 0 };
      const cp = (car && car.pos) ? car.pos : { x: 0, y: 0, z: 0 };
      const dx = p.x - cp.x, dz = p.z - cp.z;
      return {
        pos: [round(p.x, 2), round(p.y, 2), round(p.z, 2)],
        fov: c ? round(c.fov, 2) : null,
        inCabin: box ? (box.containsPoint(new T.Vector3(p.x, p.y, p.z)) ? 1 : 0) : 0,
        haveBox: box ? 1 : 0,
        above: round(p.y - (cp.y || 0), 2),
        dist: round(Math.sqrt(dx * dx + dz * dz), 2),
      };
    };

    const chase = camSample();
    let mounted = null;
    let method = "none";
    const tried = [];
    // GUARD: [V] on foot is city/view.js's own first-person toggle. Probing it
    // without a seated player would photograph on-foot FP and call it a car
    // cabin — the exact stat fiction this report exists to prevent.
    const driving = !!(CBZ.player && CBZ.player.driving && !CBZ.player._aircraft);
    if (!driving) L.notes.push("player not driving — FP probes skipped");

    if (car && driving) {
      // PRIMARY, BEHAVIOURAL: the game's own [V]. city/view.js returns early
      // while P.driving is true, so on a build with no car FP this is a no-op
      // and the plate stays the chase — which is exactly the honest answer.
      const pressV = function () {
        try {
          const down = new KeyboardEvent("keydown", { key: "v", code: "KeyV", bubbles: true, cancelable: true });
          window.dispatchEvent(down);
          document.dispatchEvent(new KeyboardEvent("keydown", { key: "v", code: "KeyV", bubbles: true, cancelable: true }));
          window.dispatchEvent(new KeyboardEvent("keyup", { key: "v", code: "KeyV", bubbles: true }));
        } catch (e) { L.notes.push("keyV " + msg(e)); }
      };
      pressV();
      tick(45);
      let probe = camSample();
      tried.push({ how: "key:V", inCabin: probe.inCabin, pos: probe.pos });
      if (probe.inCabin) { mounted = probe; method = "key:V"; }
      else { pressV(); tick(20); }

      // SECONDARY: every candidate verb the build actually exposes, each judged
      // by the same measurement rather than by its name.
      if (!mounted) {
        for (let i = 0; i < FP_NAMES_LIVE.length && !mounted; i++) {
          const name = FP_NAMES_LIVE[i];
          const fn = CBZ[name];
          if (typeof fn !== "function") continue;
          let called = false;
          try { fn.call(CBZ, true); called = true; } catch (e) {
            try { fn.call(CBZ); called = true; } catch (e2) { L.notes.push(name + " " + msg(e2)); }
          }
          if (!called) continue;
          tick(45);
          probe = camSample();
          tried.push({ how: name, inCabin: probe.inCabin, pos: probe.pos });
          if (probe.inCabin) { mounted = probe; method = name; break; }
          try { fn.call(CBZ, false); } catch (e) {}
          tick(15);
        }
      }
    }

    let final;
    let fallback = false;
    if (mounted) {
      // The after build owns the camera; do not touch it. Just square the
      // aspect to the capture viewport.
      const c = CBZ.camera;
      if (c) { c.aspect = aspect; c.updateProjectionMatrix(); }
      final = camSample();
      stateText = "IN-CAR FIRST PERSON · MOUNTED VIA " + method.toUpperCase() +
        " · CAMERA INSIDE THE CABIN BOX";
    } else {
      // HONEST FALLBACK: the real chase rig at its real drive numbers, posed
      // exactly (systems/camera.js: back 9.5, up 10.0, ahead 6.0, look +0.6,
      // fov 66) so the plate is the shot the game gives, not a damped frame.
      fallback = true;
      const c = CBZ.camera;
      const P = CBZ.player;
      if (c && P && P.pos) {
        const yaw = (CBZ.cam && Number.isFinite(CBZ.cam.yaw)) ? CBZ.cam.yaw : 0;
        const cfx = -Math.sin(yaw), cfz = -Math.cos(yaw);
        c.aspect = aspect;
        c.fov = 66;
        c.position.set(P.pos.x - cfx * 9.5, P.pos.y + 10.0, P.pos.z - cfz * 9.5);
        c.lookAt(P.pos.x + cfx * 6.0, P.pos.y + 0.6, P.pos.z + cfz * 6.0);
        c.updateProjectionMatrix();
      }
      final = camSample();
      stateText = (driving
        ? "NO IN-CAR FIRST PERSON ON THIS BUILD · "
        : "PLAYER NEVER GOT INTO A CAR · ") +
        "CHASE RIG AT ITS DRIVE NUMBERS (back 9.5 · up 10.0 · ahead 6.0 · fov 66)";
    }

    if (typeof CBZ.skySync === "function") { try { CBZ.skySync(); } catch (e) {} }
    if (CBZ.renderer && CBZ.renderer.info && CBZ.renderer.info.reset) CBZ.renderer.info.reset();
    try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (e) { L.notes.push("render " + msg(e)); }
    const render = ((CBZ.renderer && CBZ.renderer.info) || {}).render || {};

    detailText = "car " + (car ? (car.detailStyle || "spawned") : "NONE") +
      " · driving " + (driving ? "yes" : "no") +
      " · cabinBox " + (final.haveBox ? "yes" : "no") +
      " · cam " + final.pos.join(",") + " fov " + final.fov +
      " · chase " + chase.pos.join(",") + " fov " + chase.fov +
      " · probes " + (tried.length ? tried.map(function (t) { return t.how + "=" + t.inCabin; }).join(" ") : "none") +
      " · named " + feat.fpNamesText +
      " · flags " + (feat.fpFlags.length ? feat.fpFlags.join(",") : "none") +
      " · simT " + round(L.simT, 1) + "s" +
      (L.notes.length ? " · NOTE " + L.notes.join(" | ") : "");
    paint();

    return {
      ok: true, subject: S.id, staged: true,
      firstPerson: !!mounted, method: method, fallbackChase: fallback, driving: driving,
      tried: tried, notes: L.notes.slice(), features: feat,
      // deliberately NOT reused by the after side: the camera IS the subject
      camera: { pos: final.pos, target: null, up: [0, 1, 0], fov: final.fov, matched: false },
      chaseCamera: { pos: chase.pos, fov: chase.fov },
      metrics: {
        camInCabin: final.inCabin,
        carFirstPerson: mounted ? 1 : 0,
        camHeightOverCar: final.above,
        camDistFromCar: final.dist,
        camFov: final.fov == null ? 0 : final.fov,
        drawCalls: Number(render.calls || 0),
      },
    };
  }

  return { ok: false, error: "unknown subject kind: " + kind };
}

export default {
  id: "vehicle-views",
  title: "Vehicle Views: Cabins, Drivers, Cockpits, Pilots",
  description: "Eleven matched plates for the vehicle-interior wave. Car bodies are drawn by the live CBZ.cityBuildPlayerCarVisual inside the page being photographed; traffic occupants come from the real cityMakeCar path, cockpits from the live CBZ.cockpitSpec generator, and the plane from CBZ.debugBuildAircraft with its pilot revealed the way boarding reveals it. One plate boots the real world and asks the only honest first-person question there is: is the camera inside the cabin box? Three slots are reserved blank for later waves.",
  beforeLabel: "BEFORE · DEPLOYED",
  afterLabel: "AFTER · LOCAL",
  viewport: { width: 1100, height: 680 },
  // Deliberately minimal: it must be true on the DEPLOYED build too, and every
  // other symbol this preset uses is feature-detected inside stage() so a
  // missing one leaves an honest plate instead of killing the run.
  readyExpression: "window.THREE && window.CBZ && CBZ.CONFIG && typeof CBZ.cityBuildPlayerCarVisual === 'function'",
  urlParams: { seed: 90210 },
  // Raised from 480000 for the boarding plate: it steps 8 s of sim ONE TICK AT
  // A TIME (a burst would hide a teleport inside it) on top of the world boot,
  // and headless runs the sim ~60x slow.
  stageTimeoutMs: 700000,
  defaultFocus: "Compare what is inside the glass: cabin furniture, an occupant body, and where the camera sits relative to it.",
  pairNote: "Same seed · same builder · same tripod · same viewport",
  method: "Every plate is built by the photographed build's own code — the car visual builder, the traffic spawner, the cockpit generator, the aircraft builder — inside this file's studio renderer. Tripods are resolved on the BEFORE side and copied verbatim to the AFTER side, so the source change is the only variable. The one exception is fp-car, where the camera IS the subject: that plate boots the real world with requestAnimationFrame frozen, advances only through CBZ.stepSim, probes for an in-car first person BEHAVIOURALLY (press the game's own [V], then every candidate verb the build exposes, judging each by whether the camera lands inside the cabin box), and falls back to the real chase rig at its published drive numbers.",
  metricsNote: "Everything below was counted inside the build while the plate was staged: meshes the car builder actually placed in the cabin volume, occupant bodies the real addOccupants path seated, the cockpit generator's own mesh count beside the sightline audit's measured down-vision, pilot meshes under the canopy, and where the drive camera ended up relative to the cabin.",
  metrics: {
    cabinInfoDeclared: { label: "Builder publishes cabinInfo", better: "higher" },
    cabinMeshes: { label: "Meshes in cabin volume", better: "higher" },
    cabinProps: { label: "Cabin props (furniture-sized)", better: "higher" },
    seatVolumeMeshes: { label: "Meshes in driver seat volume", better: "higher" },
    occupantMeshes: { label: "Occupant-tagged meshes", better: "higher" },
    driverPresent: { label: "Driver present", better: "higher" },
    visualMeshes: { label: "Meshes in the whole visual" },
    glassOpacity: { label: "Cabin glass opacity" },
    glassRenderOrder: { label: "Cabin glass renderOrder" },
    glassDepthWrite: { label: "Cabin glass depthWrite" },
    carsStaged: { label: "Cars staged" },
    occupantsPerCar: { label: "Occupant bodies per car", better: "higher" },
    realOccupantPath: { label: "Real addOccupants path used", better: "higher" },
    cockpitMeshes: { label: "Cockpit meshes", better: "lower" },
    cockpitMeshesWalked: { label: "Cockpit meshes (walked)", better: "lower" },
    cockpitTriangles: { label: "Cockpit triangles", better: "lower" },
    downVisionDeg: { label: "Down vision", unit: "deg", better: "higher" },
    seatDownDeg: { label: "Seat down vision", unit: "deg", better: "higher" },
    sightFloorDeg: { label: "Sightline floor", unit: "deg" },
    panelPainted: { label: "Instrument face painted", better: "higher" },
    hudPainted: { label: "HUD symbology painted", better: "higher" },
    windscreenOpacity: { label: "Windscreen opacity" },
    pilotMeshes: { label: "Pilot body meshes", better: "higher" },
    pilotVisible: { label: "Pilot visible", better: "higher" },
    canopyVolumeMeshes: { label: "Meshes under the canopy", better: "higher" },
    airframeMeshes: { label: "Airframe meshes" },
    // ---- companion boarding: the walk-vs-warp pair is the headline ----
    followers: { label: "Followers with you" },
    endedInsideCabin: { label: "Followers who ended up in the cabin", better: "higher" },
    visibleInsideCabin: { label: "…and are VISIBLE through the glass", better: "higher" },
    maxJumpPerTick: { label: "Largest single-tick jump", unit: "m", better: "lower" },
    metresWalked: { label: "Distance actually walked", unit: "m", better: "higher" },
    doorLeaves: { label: "Openable door leaves on the car", better: "higher" },
    seatedAttached: { label: "Bodies held by a real seat anchor", better: "higher" },
    peakArcsLive: { label: "Boarding arcs running at once", better: "higher" },
    speedWanted: { label: "Speed the mover intended", unit: "m/s" },
    speedActual: { label: "Speed the body achieved", unit: "m/s", better: "higher" },
    arcsStillRunning: { label: "Arcs unfinished after 12 s", better: "lower" },
    camInCabin: { label: "Camera inside cabin box", better: "higher" },
    carFirstPerson: { label: "In-car first person found", better: "higher" },
    camHeightOverCar: { label: "Camera above the car", unit: "m", better: "lower" },
    camDistFromCar: { label: "Camera distance from car", unit: "m", better: "lower" },
    camFov: { label: "Camera FOV", unit: "deg" },
    drawCalls: { label: "Draw calls", better: "lower" },
  },
  subjects,
  stage: stageVehicleViews,
};
