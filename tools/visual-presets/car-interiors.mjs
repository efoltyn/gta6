/* Car Interiors comparison studio — high-fidelity cabin detailing.
   Flag A/B: defaultBefore="local" with cfg_CAR_CABIN_V4=0 on the BEFORE side
   and cfg_CAR_CABIN_V4=1 on the AFTER side. */

const subjects = [
  {
    id: "sedan-cabin-cutaway",
    label: "01 · Sedan cabin through the side glass",
    car: { style: "tesla-3", color: 0x1d4f8f },
    view: { azDeg: 68, camY: 2.45, dist: 3.6, fov: 40, aim: "cabin" },
    focus: "High side angle looking down through the greenhouse. Count furniture and details: dashboard trim, air vents, screens, gear shifter, cup holders, seatbelt buckles, headrest posts.",
  },
  {
    id: "cockpit-driver-view",
    label: "02 · Driver cockpit close-up",
    car: { style: "tesla-3", color: 0x1d4f8f },
    view: { azDeg: 52, camY: 1.82, dist: 2.4, fov: 38, aim: "driver" },
    focus: "Tightly framed on the driver's driving position: illuminated digital speedo/tach arcs on the cluster, air vents, steering wheel spoke controls, column stalks, and pedals in the footwell.",
  },
  {
    id: "center-console",
    label: "03 · Center console & infotainment UI",
    car: { style: "tesla-3", color: 0x1d4f8f },
    view: { azDeg: 82, camY: 2.05, dist: 2.3, fov: 36, aim: "console" },
    focus: "Looking directly at the transmission tunnel: console gear selector, twin recessed cup holders, upholstered armrest pad, active route navigation UI on the center screen, and hazard button.",
  },
  {
    id: "seats-and-belts",
    label: "04 · Front seats, headrest posts & buckles",
    car: { style: "tesla-3", color: 0x1d4f8f },
    view: { azDeg: 108, camY: 2.10, dist: 2.8, fov: 38, aim: "seats" },
    focus: "Framed on the seats from the rear three-quarter: twin chrome headrest posts connecting seat backs to headrests, seatbelt buckle receptacles with red release buttons, and adjustment controls.",
  },
  {
    id: "suv-cabin",
    label: "05 · SUV cabin through the side glass",
    car: { style: "suv", color: 0x37473a },
    view: { azDeg: 68, camY: 2.65, dist: 4.1, fov: 40, aim: "cabin" },
    focus: "SUV interior with its upright greenhouse: multi-row seats with headrest posts, console shifter, dashboard metallic trim, and driver footwell pedals.",
  },
  {
    id: "van-cabin",
    label: "06 · Van cabin through the glass",
    car: { style: "van", color: 0x6a625a },
    view: { azDeg: 68, camY: 2.85, dist: 4.4, fov: 40, aim: "cabin" },
    focus: "Van cab interior: high seating position, slatted air vents, full dashboard trim bar, digital cluster, and center console controls.",
  },
  {
    id: "coupe-cabin",
    label: "07 · Sports coupe cabin",
    car: { style: "lowrider", color: 0x7d2bd6 },
    view: { azDeg: 65, camY: 2.15, dist: 3.4, fov: 38, aim: "cabin" },
    focus: "Low-slung coupe interior: contoured sport seats, satin dash accent strip, driver pedals, and illuminated gauges.",
  },
  {
    id: "sedan-front-windshield",
    label: "08 · Oncoming view through windshield",
    car: { style: "tesla-3", color: 0x1d4f8f },
    view: { azDeg: 20, camY: 1.55, dist: 4.8, fov: 32, aim: "front" },
    focus: "A pedestrian's eye looking through the windshield: glowing cyan instrument cluster, hazard button, steering wheel emblem, rearview mirror mount, and headrest posts.",
  },
];

async function stageCarInteriors(input) {
  const T = window.THREE;
  const CBZ = window.CBZ;
  if (!T || !CBZ) return { ok: false, error: "no window.THREE / window.CBZ" };
  const S = input.subject || {};
  const HALF_PI = Math.PI / 2;
  const DEG = Math.PI / 180;

  let ST = window.__cbzCarInteriors;
  if (!ST) {
    const ren = new T.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
    ren.setPixelRatio(1);
    ren.setSize(input.width, input.height);
    ren.outputEncoding = T.sRGBEncoding || 3001;
    ren.toneMapping = T.ACESFilmicToneMapping || 4;
    ren.toneMappingExposure = 1.05;

    const overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:999999;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;color:#fff";
    overlay.innerHTML =
      '<div data-side></div><div data-name></div><div data-focus></div>' +
      '<div data-state></div><div data-detail></div><div data-source></div><div data-big></div>';

    const canvas = ren.domElement;
    canvas.style.cssText = "position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:999990;display:block";
    document.body.appendChild(canvas);
    document.body.appendChild(overlay);

    ST = window.__cbzCarInteriors = {
      renderer: ren, overlay: overlay, canvas: canvas,
    };
  }

  const aspect = input.width / input.height;
  const refCam = (input.referenceStage && input.referenceStage.camera) || null;

  const makeScene = function (opts) {
    const o = opts || {};
    const scene = new T.Scene();
    scene.background = new T.Color(o.sky == null ? 0x1b2430 : o.sky);
    scene.add(new T.HemisphereLight(0xdde8ff, 0x24272c, 0.95));
    const key = new T.DirectionalLight(0xffecd0, 1.45);
    key.position.set(7.0, 10.0, 6.0); scene.add(key);
    const rim = new T.DirectionalLight(0x8ebcff, 0.65);
    rim.position.set(-7.5, 4.5, -7.0); scene.add(rim);
    const fill = new T.DirectionalLight(0xffffff, 0.30);
    fill.position.set(1.0, 3.5, -8.5); scene.add(fill);
    if (o.ground !== false) {
      const g = new T.Mesh(
        new T.PlaneGeometry(300, 300),
        new T.MeshStandardMaterial({ color: 0x33373d, roughness: 0.96 })
      );
      g.rotation.x = -HALF_PI;
      scene.add(g);
    }
    return scene;
  };

  const tripod = function (aim, azDeg, camY, dist, fov) {
    const az = (azDeg == null ? 60 : azDeg) * DEG;
    const px = aim.x + Math.sin(az) * dist;
    const pz = aim.z + Math.cos(az) * dist;
    return { pos: [px, camY, pz], target: [aim.x, aim.y, aim.z], up: [0, 1, 0], fov: fov || 40 };
  };

  const applyCamera = function (scene, want) {
    const cam = refCam || want;
    const camera = new T.PerspectiveCamera(Number(cam.fov) || 40, aspect, 0.05, 3000);
    camera.position.fromArray(cam.pos);
    camera.up.fromArray(cam.up || [0, 1, 0]);
    camera.lookAt(new T.Vector3().fromArray(cam.target));
    camera.updateProjectionMatrix();
    ST.renderer.render(scene, camera);
    return { pos: cam.pos.slice(), target: cam.target.slice(), up: (cam.up || [0, 1, 0]).slice(), fov: Number(cam.fov) || 40 };
  };

  const surveyCabin = function (visual, fr) {
    const out = {
      total: 0, inCabin: 0, props: 0, inSeat: 0,
      pedals: 0, buckles: 0, airVents: 0, screensLit: 0, v4Features: 0,
    };
    if (!visual || !fr) return out;
    const L = (fr.dims && Number(fr.dims.length)) || 4.5;
    const box = new T.Box3(
      new T.Vector3(-fr.w * 0.5 - 0.05, fr.baseY - 0.32, fr.cx - L * 0.30),
      new T.Vector3(fr.w * 0.5 + 0.05, fr.baseY + fr.peakY + 0.10, fr.cx + L * 0.30)
    );
    const seatBox = new T.Box3(
      new T.Vector3(fr.w * 0.04, fr.baseY - 0.18, fr.cx - 0.28),
      new T.Vector3(fr.w * 0.54, fr.baseY + fr.peakY * 0.98, fr.cx + 0.55)
    );

    visual.updateMatrixWorld(true);
    const inv = new T.Matrix4().copy(visual.matrixWorld).invert();
    const bb = new T.Box3(), c = new T.Vector3(), sz = new T.Vector3(), m4 = new T.Matrix4();

    visual.traverse(function (o) {
      if (!o.isMesh || !o.geometry) return;
      out.total++;
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      if (!o.geometry.boundingBox) return;
      m4.multiplyMatrices(inv, o.matrixWorld);
      bb.copy(o.geometry.boundingBox).applyMatrix4(m4);
      bb.getCenter(c); bb.getSize(sz);
      const diag = Math.sqrt(sz.x * sz.x + sz.y * sz.y + sz.z * sz.z);
      if (!box.containsPoint(c)) return;
      out.inCabin++;
      if (diag <= 1.05) out.props++;
      if (seatBox.containsPoint(c)) out.inSeat++;

      const mat = Array.isArray(o.material) ? o.material[0] : o.material;
      const isTrim = mat && (mat.color && mat.color.getHex && (mat.color.getHex() === 0x7c8490 || mat.color.getHex() === 0x7a828e));
      const isCyan = mat && (mat.emissive && mat.emissive.getHex && (mat.emissive.getHex() === 0x3cd8f8 || mat.emissive.getHex() === 0x38d8f5));
      const isRed = mat && (mat.emissive && mat.emissive.getHex && (mat.emissive.getHex() === 0xfd3f3f || mat.emissive.getHex() === 0xfa3d3d));

      if (isCyan) out.screensLit++;
      if (isRed && diag < 0.12) out.buckles++;
      if (isTrim && diag < 0.16 && c.y < fr.baseY && c.z > fr.cx) out.pedals++;
      if (isTrim && diag < 0.14 && c.y >= fr.baseY - 0.10 && c.z > fr.cx + 0.20) out.airVents++;
      if (isTrim || isCyan || isRed) out.v4Features++;
    });
    return out;
  };

  const spec = S.car || {};
  const style = spec.style || "tesla-3";
  const visual = CBZ.cityBuildPlayerCarVisual(style, spec.color == null ? null : spec.color);
  if (!visual) return { ok: false, error: "could not build car: " + style };

  const fr = visual.userData && visual.userData.cabinInfo;
  const scene = makeScene();
  const car = new T.Group();
  car.add(visual);
  scene.add(car);
  scene.updateMatrixWorld(true);

  const survey = surveyCabin(visual, fr);

  let aim = { x: 0, y: (fr ? fr.baseY + fr.peakY * 0.45 : 1.2), z: (fr ? fr.cx : 0) };
  const vSpec = S.view || {};
  if (vSpec.aim === "driver" && fr) {
    aim = { x: (fr.seatX || 0.36), y: (fr.cushionY || 0.8) + 0.25, z: (fr.seatZ || 0) + 0.15 };
  } else if (vSpec.aim === "console" && fr) {
    aim = { x: 0, y: (fr.cushionY || 0.8) + 0.18, z: (fr.seatZ || 0) + 0.10 };
  } else if (vSpec.aim === "seats" && fr) {
    aim = { x: 0.12, y: (fr.cushionY || 0.8) + 0.28, z: (fr.seatZ || 0) - 0.10 };
  } else if (vSpec.aim === "front" && fr) {
    aim = { x: 0, y: fr.baseY + 0.10, z: fr.cx + 0.60 };
  }

  const want = tripod(aim, vSpec.azDeg, vSpec.camY, vSpec.dist, vSpec.fov);
  const cam = applyCamera(scene, want);

  const before = input.side === "before";
  const stateText = before
    ? "CABIN V3 (FLAG OFF) · " + survey.props + " CABIN PROPS"
    : "CABIN V4 (FLAG ON) · " + survey.props + " CABIN PROPS · " + survey.v4Features + " V4 DETAILS";
  const detailText = "style " + style + " · cabinMeshes " + survey.inCabin + " · props " + survey.props +
    " · driverSeat " + survey.inSeat + " · v4Details " + survey.v4Features + " · screensLit " + survey.screensLit;

  const q = function (sel) { return ST.overlay.querySelector(sel); };
  q("[data-side]").textContent = before ? input.beforeLabel : input.afterLabel;
  q("[data-side]").style.cssText = "position:absolute;top:22px;left:26px;padding:7px 11px;border-radius:7px;background:" +
    (before ? "#c94c4c" : "#218b60") + ";font-size:12px;font-weight:900;letter-spacing:.12em";
  q("[data-name]").textContent = S.label || S.id;
  q("[data-name]").style.cssText = "position:absolute;top:64px;left:26px;font-size:27px;font-weight:800;letter-spacing:-.02em";
  q("[data-focus]").textContent = S.focus || "";
  q("[data-focus]").style.cssText = "position:absolute;top:101px;left:28px;color:#c4d2dd;font-size:13px;font-weight:550;max-width:700px;line-height:1.35";
  q("[data-state]").textContent = stateText;
  q("[data-state]").style.cssText = "position:absolute;right:26px;top:24px;color:" +
    (before ? "#ff9c9c" : "#80e4b4") + ";font-size:11px;font-weight:850;letter-spacing:.11em;text-align:right;max-width:430px;line-height:1.5";
  q("[data-detail]").textContent = detailText;
  q("[data-detail]").style.cssText = "position:absolute;right:24px;bottom:18px;color:#9fb0bd;font:10px ui-monospace,SFMono-Regular,Menlo,monospace;text-align:right";
  let host = input.sourceUrl;
  try { const u = new URL(input.sourceUrl); host = u.host + u.pathname; } catch (e) {}
  q("[data-source]").textContent = host;
  q("[data-source]").style.cssText = "position:absolute;bottom:18px;left:26px;color:#9cb0bf;font:11px ui-monospace,SFMono-Regular,Menlo,monospace";

  return {
    ok: true, subject: S.id, staged: true,
    camera: cam,
    metrics: {
      cabinInfoDeclared: fr ? 1 : 0,
      cabinMeshes: survey.inCabin,
      cabinProps: survey.props,
      seatVolumeMeshes: survey.inSeat,
      v4Features: survey.v4Features,
      screensLit: survey.screensLit,
      pedals: survey.pedals,
      buckles: survey.buckles,
      airVents: survey.airVents,
    },
  };
}

export default {
  id: "car-interiors",
  title: "Car Interiors: High-Fidelity Cabin Detailing",
  description: "Matched before/after plates for the car interior wave: dashboard metallic accent trim, HVAC air vents, illuminated instrument cluster graphics (speedometer/tachometer arcs), center infotainment route navigation UI, driver pedal box and footrest, center console gear selector and cup holders, chrome headrest posts, seatbelt buckles, and door sill plates.",
  defaultBefore: "local",
  beforeParams: { cfg_CAR_CABIN_V4: "0" },
  afterParams: { cfg_CAR_CABIN_V4: "1" },
  beforeLabel: "BEFORE · CABIN V3 (FLAG OFF)",
  afterLabel: "AFTER · CABIN V4 (FLAG ON)",
  viewport: { width: 1100, height: 680 },
  readyExpression: "window.THREE && window.CBZ && CBZ.CONFIG && typeof CBZ.cityBuildPlayerCarVisual === 'function'",
  urlParams: { seed: 90210 },
  stageTimeoutMs: 60000,
  defaultFocus: "Compare cabin interior detail: dashboard trim, air vents, active screens, shifter, cup holders, seatbelt buckles, and headrest posts.",
  pairNote: "Same seed · same builder · same tripod · flag A/B (?cfg_CAR_CABIN_V4=0 vs 1)",
  method: "Every plate is staged in this preset's studio WebGLRenderer using the live CBZ.cityBuildPlayerCarVisual builder. The BEFORE side boots with ?cfg_CAR_CABIN_V4=0 (the pre-wave cabin); the AFTER side boots with ?cfg_CAR_CABIN_V4=1 (high-fidelity detailing). Tripods are resolved on the BEFORE side and copied verbatim to the AFTER side.",
  metricsNote: "Counts were measured inside the build during capture: total meshes in cabin volume, furniture-sized props, driver seat meshes, active illuminated screen elements, driver pedals, seatbelt buckles, and air vents.",
  metrics: {
    cabinInfoDeclared: { label: "Builder publishes cabinInfo", better: "higher" },
    cabinMeshes: { label: "Meshes in cabin volume", better: "higher" },
    cabinProps: { label: "Cabin props (furniture-sized)", better: "higher" },
    seatVolumeMeshes: { label: "Meshes in driver seat volume", better: "higher" },
    v4Features: { label: "V4 cabin features active", better: "higher" },
    screensLit: { label: "Active digital display meshes", better: "higher" },
    pedals: { label: "Pedals in footwell", better: "higher" },
    buckles: { label: "Seatbelt buckles", better: "higher" },
    airVents: { label: "Air vents (HVAC)", better: "higher" },
  },
  subjects,
  stage: stageCarInteriors,
};
