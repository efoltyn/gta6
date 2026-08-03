/* Skydiving and parachute presentation comparison.

   Each side uses the character and canopy code shipped by that page. The
   deployed page exposes its old canopy only through the real bailout/deploy
   path, so the studio captures and clones that runtime object once. The local
   page uses the new public runtime builders directly. Camera, light, viewport,
   clothing, pose time, and flight phase remain matched within every pair. */

const subjects = [
  {
    id: "third-person-freefall",
    label: "Third Person — Stable Freefall",
    phase: "freefall", view: "third", t: 1.4,
    focus: "The player should form a readable belly-to-earth arch with wide arms, bent knees, chin up, and a body-worn parachute pack.",
  },
  {
    id: "third-person-opening",
    label: "Third Person — Canopy Opening",
    phase: "opening", view: "third", opening: 0.35, t: 2.0,
    focus: "Deployment should bloom from a compact wing while the body transitions into the harness, not pop instantly into a ceiling.",
  },
  {
    id: "third-person-canopy",
    label: "Third Person — Under Canopy",
    phase: "canopy", view: "third", opening: 1, t: 2.8,
    focus: "Inspect the ram-air cells, cascaded upper lines, four risers, shoulder attachment, seated hips, raised hands, and bent legs.",
  },
  {
    id: "third-person-flare",
    label: "Third Person — Landing Flare",
    phase: "canopy", view: "third", opening: 1, flare: 1, t: 3.5,
    focus: "Both hands should pull the controls down together while the load path still terminates at the harness shoulders—not the feet.",
  },
  {
    id: "first-person-freefall",
    label: "First Person — Freefall Hands",
    phase: "freefall", view: "first", t: 1.4,
    focus: "The game's simple block hands and forearms should live in the wind at the edges of the view; the ordinary gun or fist viewmodel should be absent.",
  },
  {
    id: "first-person-canopy",
    label: "First Person — Risers and Toggles",
    phase: "canopy", view: "first", opening: 1, t: 2.8,
    focus: "Both hands should visibly hold two toggle/riser groups, giving the first-person view a believable connection to the canopy.",
  },
  {
    id: "first-person-flare",
    label: "First Person — Flare Pull",
    phase: "canopy", view: "first", opening: 1, flare: 1, t: 3.5,
    focus: "The landing input should pull both first-person hands and toggles downward instead of leaving a static overlay.",
  },
];

function stageParachute(input) {
  const T = window.THREE;
  const CBZ = window.CBZ;
  if (!T || !CBZ || !CBZ.makeCharacter || !CBZ.animChar || !CBZ.cityBailOut || !CBZ.cityChuteDeploy) {
    return { ok: false, missing: "parachute runtime" };
  }

  let studio = window.__cbzVisualCompare;
  if (!studio) {
    document.documentElement.style.cssText = "margin:0;width:100%;height:100%;background:#72b9e8";
    document.body.innerHTML = "";
    document.body.style.cssText = "margin:0;width:100%;height:100%;overflow:hidden;background:#72b9e8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    const renderer = new T.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setSize(input.width, input.height, false);
    renderer.outputColorSpace = T.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFSoftShadowMap;
    renderer.domElement.id = "visual-compare-canvas";
    renderer.domElement.style.cssText = `display:block;width:${input.width}px;height:${input.height}px`;
    document.body.appendChild(renderer.domElement);
    const overlay = document.createElement("div");
    overlay.id = "visual-compare-overlay";
    overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;color:#f8fbfe;text-shadow:0 2px 10px rgba(0,25,48,.82);z-index:5";
    overlay.innerHTML = "<div data-side></div><div data-name></div><div data-focus></div><div data-state></div><div data-source></div>";
    document.body.appendChild(overlay);
    studio = window.__cbzVisualCompare = { renderer, overlay, scene: null, camera: null };
    studio.render = function () {
      if (studio.scene && studio.camera) studio.renderer.render(studio.scene, studio.camera);
    };
  }

  const hasSkyPose = typeof CBZ.poseSkydiver === "function";
  const hasRamAir = typeof CBZ.cityBuildChuteCanopy === "function";
  const firstPerson = input.subject.view === "first";
  const hasCanopy = input.subject.phase !== "freefall";

  // The baseline's canopy builder is private. Trigger its actual bailout path,
  // find the one new scene object, and retain a clone for all matched states.
  function legacyCanopy() {
    if (window.__cbzDeployedCanopyTemplate) return window.__cbzDeployedCanopyTemplate.clone(true);
    if (!CBZ.scene || !CBZ.player) return null;
    const prior = new Set(CBZ.scene.children);
    const craft = {
      pos: new T.Vector3(0, 1400, 0), heading: 0, speed: 44,
      vx: 0, vy: 0, vz: 44, roll: 0, pitch: 0, belly: 1.2,
      onGround: false, group: new T.Group(), pilot: {}, airClass: "airliner", mass: 72000,
    };
    if (CBZ.CONFIG) CBZ.CONFIG.CONTROLS_AUTO = false;
    if (CBZ.controls && CBZ.controls.hide) CBZ.controls.hide();
    CBZ.player.pos.set(0, 1400, 0);
    CBZ.player.grounded = false;
    const bailed = CBZ.cityBailOut(craft);
    const deployed = bailed && CBZ.cityChuteDeploy();
    const added = CBZ.scene.children.filter((child) => !prior.has(child));
    const live = added.find((child) => child && child.isGroup && child.children && child.children.length);
    if (!deployed || !live) return null;
    live.visible = false;
    window.__cbzDeployedCanopyTemplate = live.clone(true);
    return window.__cbzDeployedCanopyTemplate.clone(true);
  }

  const scene = new T.Scene();
  scene.background = new T.Color(0x79bee9);
  scene.fog = new T.Fog(0x91c7e9, 28, 85);
  scene.add(new T.HemisphereLight(0xeaf8ff, 0x75654c, 2.0));
  const sun = new T.DirectionalLight(0xffffff, 2.5);
  sun.position.set(-7, 13, -8); sun.castShadow = true; scene.add(sun);
  const fill = new T.DirectionalLight(0xaedbff, 0.9);
  fill.position.set(8, 3, 10); scene.add(fill);

  // A distant, deliberately soft landscape gives height and travel direction
  // without introducing a changing game-world seed into the comparison.
  const land = new T.Mesh(
    new T.PlaneGeometry(170, 170, 1, 1),
    new T.MeshBasicMaterial({ color: 0x5d7652 })
  );
  land.rotation.x = -Math.PI / 2;
  land.position.set(0, -18, 14);
  scene.add(land);
  const roads = new T.GridHelper(150, 24, 0xb2b79b, 0x708268);
  roads.position.set(0, -17.96, 14); scene.add(roads);
  for (let i = 0; i < 8; i++) {
    const cloud = new T.Mesh(
      new T.SphereGeometry(1, 10, 6),
      new T.MeshBasicMaterial({ color: 0xe9f5fc, transparent: true, opacity: 0.72 })
    );
    cloud.scale.set(2.6 + (i % 3), 0.25 + (i % 2) * 0.12, 0.7);
    cloud.position.set(-18 + i * 5.2, 8 + (i % 3) * 1.7, 21 + (i % 2) * 5);
    scene.add(cloud);
  }

  let rider = null;
  let canopy = null;
  let fpRig = null;
  let lineCount = 0;
  let riserCount = 0;
  let cellCount = 0;
  let harnessVisible = false;

  if (firstPerson) {
    if (hasRamAir && CBZ.cityBuildBailoutFirstPerson && CBZ.cityPoseBailoutFirstPerson) {
      fpRig = CBZ.cityBuildBailoutFirstPerson();
      fpRig.visible = true;
      CBZ.cityPoseBailoutFirstPerson(fpRig, input.subject);
      scene.add(fpRig);
    }
  } else {
    rider = CBZ.makeCharacter({
      skin: 0xb87955, torso: 0x2f6597, collar: 0x2f6597,
      arms: 0x2f6597, legs: 0x1e2a38, shoes: 0x211b18, hair: 0x302016,
    });
    if (hasSkyPose) {
      if (CBZ.cityEnsureBailoutHarness) {
        const harness = CBZ.cityEnsureBailoutHarness(rider);
        harnessVisible = !!(harness && harness.root && harness.root.visible);
      }
      for (let i = 0; i < 120; i++) CBZ.poseSkydiver(rider, input.subject, 1 / 60);
    } else {
      for (let i = 0; i < 120; i++) CBZ.animChar(rider, 0, 1 / 60);
    }
    rider.group.rotation.y = 0;
    scene.add(rider.group);

    if (hasCanopy) {
      canopy = hasRamAir ? CBZ.cityBuildChuteCanopy() : legacyCanopy();
      if (!canopy) return { ok: false, missing: "deployed canopy" };
      canopy.visible = true;
      if (hasRamAir && CBZ.citySetChuteOpening) {
        CBZ.citySetChuteOpening(canopy, input.subject.phase === "opening" ? input.subject.opening : 1);
      }
      scene.add(canopy);
      cellCount = canopy.userData.cells || 0;
      lineCount = canopy.userData.upperLineCount || 0;
      riserCount = canopy.userData.riserCount || 0;
      if (!lineCount) canopy.traverse((part) => {
        if (part.isLineSegments && part.geometry && part.geometry.attributes.position) {
          lineCount += part.geometry.attributes.position.count / 2;
        }
      });
    }
  }

  const aspect = input.width / input.height;
  const referenceCamera = input.referenceStage && input.referenceStage.camera;
  const camera = new T.PerspectiveCamera(firstPerson ? 67 : 42, aspect, 0.01, 220);
  const defaultPosition = firstPerson
    ? [0, 0, 0]
    : hasCanopy ? [7.7, 4.65, -12.8] : [3.0, 2.25, -5.5];
  const defaultTarget = firstPerson
    ? [0, -0.08, -1]
    : hasCanopy ? [0, 3.7, 0] : [0, 1.0, 0];
  const cameraPosition = referenceCamera ? referenceCamera.position : defaultPosition;
  const cameraTarget = referenceCamera ? referenceCamera.target : defaultTarget;
  const cameraUp = referenceCamera ? referenceCamera.up : [0, 1, 0];
  camera.position.fromArray(cameraPosition);
  camera.up.fromArray(cameraUp);
  camera.lookAt(new T.Vector3().fromArray(cameraTarget));
  camera.updateProjectionMatrix();

  studio.scene = scene;
  studio.camera = camera;
  for (const child of Array.from(document.body.children)) {
    if (child !== studio.renderer.domElement && child !== studio.overlay) child.remove();
  }
  studio.renderer.setSize(input.width, input.height, false);
  studio.renderer.render(scene, camera);

  const before = input.side === "before";
  const side = studio.overlay.querySelector("[data-side]");
  const name = studio.overlay.querySelector("[data-name]");
  const focus = studio.overlay.querySelector("[data-focus]");
  const state = studio.overlay.querySelector("[data-state]");
  const source = studio.overlay.querySelector("[data-source]");
  side.textContent = before ? input.beforeLabel : input.afterLabel;
  side.style.cssText = `position:absolute;top:24px;left:28px;padding:7px 11px;border-radius:7px;background:${before ? "#c94c4c" : "#218b60"};font-size:12px;font-weight:900;letter-spacing:.12em`;
  name.textContent = input.subject.label;
  name.style.cssText = "position:absolute;top:69px;left:28px;font-size:29px;font-weight:800;letter-spacing:-.02em";
  focus.textContent = input.subject.focus;
  focus.style.cssText = "position:absolute;top:106px;left:30px;color:#e6f2f9;font-size:13px;font-weight:600;max-width:720px";
  const stateText = firstPerson
    ? (hasRamAir ? (input.subject.flare ? "TWO-HAND FLARE" : input.subject.phase === "freefall" ? "BLOCK HANDS IN RELATIVE WIND" : "TWO RISERS · TWO TOGGLES") : "NO AIRBORNE FIRST-PERSON BODY")
    : (hasSkyPose ? (input.subject.flare ? "TOGGLES DOWN · HARNESS LOADED" : input.subject.phase === "freefall" ? "BELLY-TO-EARTH BODY" : input.subject.phase === "opening" ? "CELL WING BLOOMING" : "4 RISERS → SHOULDER HARNESS") : "ORDINARY STANDING BODY");
  state.textContent = stateText;
  state.style.cssText = `position:absolute;right:26px;top:25px;color:${before ? "#ffd0d0" : "#c0ffe0"};font-size:11px;font-weight:850;letter-spacing:.10em`;
  source.textContent = new URL(input.sourceUrl).host + new URL(input.sourceUrl).pathname;
  source.style.cssText = "position:absolute;bottom:20px;left:28px;color:#e5f1f7;font:11px ui-monospace,SFMono-Regular,Menlo,monospace";

  return {
    ok: true,
    phase: input.subject.phase,
    view: input.subject.view,
    skydiverPose: hasSkyPose,
    ramAirCanopy: hasRamAir,
    harnessVisible,
    cells: cellCount,
    upperLines: lineCount,
    risers: riserCount,
    firstPersonRig: !!fpRig,
    camera: {
      position: cameraPosition.slice(),
      target: cameraTarget.slice(),
      up: cameraUp.slice(),
    },
  };
}

export default {
  id: "parachute-rig",
  title: "Player Skydiving: Falling Body, Harness, Ram-Air Canopy, and First-Person Controls",
  description: "Seven matched browser states compare the deployed presentation with the current checkout: stable freefall, canopy inflation, ordinary flight, a landing flare, and dedicated first-person hands. The repair replaces foot-converging suspension strings with cell-to-cascade lines, four risers, and shoulder-mounted harness webbing while giving the canonical player rig physically readable poses in both views.",
  beforeLabel: "BEFORE · DEPLOYED",
  afterLabel: "AFTER · SKYDIVING RIG",
  viewport: { width: 1100, height: 680 },
  readyExpression: "window.THREE && window.CBZ && CBZ.bootComplete && CBZ.makeCharacter && CBZ.animChar && CBZ.cityBailOut && CBZ.cityChuteDeploy",
  pairNote: "Same flight phase · pose time · character · camera · light · viewport",
  method: "Each side runs the character and canopy code shipped by its own page. The deployed canopy is obtained through its real bailout/deploy path; the local side uses the same exported builders and pose owner as gameplay. Flight phase, pose time, character palette, camera, lighting, and viewport are held constant within every pair.",
  subjects,
  stage: stageParachute,
};
