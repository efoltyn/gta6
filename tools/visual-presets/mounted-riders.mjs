/* Mounted-rider comparison studio.

   The deployed page demonstrates the old runtime presentation (the ordinary
   walking character translated above an animal). The local page consumes the
   new cityRideVisualSpec + canonical character riding pose. Both sides build
   their own real species and player rigs from the source page being captured. */

const mounts = [
  ["horse", "Horse"],
  ["bison", "Bison"],
  ["lion", "Lion"],
  ["giraffe", "Giraffe"],
  ["african_elephant", "African Elephant"],
  ["zebra", "Zebra"],
];
const states = [
  ["idle", "At Rest", "Hips should sit on the back; bent knees and boots wrap down both flanks."],
  ["travel", "Moving", "The animal owns the stride while the rider stays seated instead of walking."],
  ["airborne", "Jumping", "Animal and rider share one airborne root; the rider braces without performing a human jump."],
];
const subjects = [];
for (const [animal, animalLabel] of mounts) {
  for (const [state, stateLabel, focus] of states) {
    subjects.push({
      id: `${animal}-${state}`,
      label: `${animalLabel} — ${stateLabel}`,
      animal,
      state,
      stateLabel,
      focus,
    });
  }
}

function stageMountedRider(input) {
  const T = window.THREE;
  const CBZ = window.CBZ;
  const sp = CBZ && CBZ.WILDLIFE_SPECIES && CBZ.WILDLIFE_SPECIES[input.subject.animal];
  if (!T || !CBZ || !sp || !CBZ.makeCharacter || !CBZ.animChar) {
    return { ok: false, missing: input.subject.animal };
  }

  let studio = window.__cbzVisualCompare;
  if (!studio) {
    document.documentElement.style.cssText = "margin:0;width:100%;height:100%;background:#0d151d";
    document.body.innerHTML = "";
    document.body.style.cssText = "margin:0;width:100%;height:100%;overflow:hidden;background:#0d151d;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    const renderer = new T.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setSize(input.width, input.height, false);
    renderer.domElement.style.cssText = `display:block;width:${input.width}px;height:${input.height}px`;
    document.body.appendChild(renderer.domElement);
    const overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;color:#f4f8fb;text-shadow:0 2px 9px #000;z-index:5";
    overlay.innerHTML = "<div data-side></div><div data-name></div><div data-focus></div><div data-state></div><div data-source></div>";
    document.body.appendChild(overlay);
    studio = window.__cbzVisualCompare = { renderer, overlay, scene: null, camera: null };
    studio.render = function () {
      if (studio.scene && studio.camera) studio.renderer.render(studio.scene, studio.camera);
    };
  }

  const materialCache = new Map();
  const material = (color) => {
    const key = Number(color == null ? 0x888888 : color);
    if (!materialCache.has(key)) materialCache.set(key, new T.MeshStandardMaterial({
      color: key, roughness: 0.76, metalness: 0.02, flatShading: true,
    }));
    return materialCache.get(key);
  };
  const animal = sp.build({ THREE: T, mat: material, rng: () => 0.25 });
  animal.scale.setScalar(sp.scale || 1);
  animal.updateMatrixWorld(true);

  const legacySeats = {
    horse: 1.55, bison: 1.85, lion: 1.15, giraffe: 2.7,
    african_elephant: 3.3, zebra: 1.45,
  };
  const animalBox = new T.Box3().setFromObject(animal);
  const animalSize = animalBox.getSize(new T.Vector3());
  const hasMountedPose = typeof CBZ.cityRideVisualSpec === "function";
  const visual = hasMountedPose
    ? CBZ.cityRideVisualSpec(sp, animal)
    : { y: legacySeats[sp.id] || animalBox.max.y * 0.72, width: Math.max(0.55, Math.min(1.4, animalSize.z)) };

  const rider = CBZ.makeCharacter({
    skin: 0xb87955,
    torso: 0x2f6597,
    collar: 0x2f6597,
    arms: 0x2f6597,
    legs: 0x1e2a38,
    shoes: 0x211b18,
    hair: 0x302016,
  });
  const moving = input.subject.state !== "idle";
  const airborne = input.subject.state === "airborne";
  const phase = input.subject.state === "travel" ? 1.1 : (airborne ? 2.2 : 0);
  if (hasMountedPose) rider.riding = {
    width: visual.width,
    moving,
    airborne,
    phase,
    speed: moving ? 8 : 0,
  };
  for (let i = 0; i < 90; i++) CBZ.animChar(rider, moving ? 8 : 0, 1 / 60);
  const humanScale = (rider.group.userData && rider.group.userData.humanScale) || 1;
  rider.group.position.set(
    hasMountedPose ? (visual.x || 0) : 0,
    hasMountedPose ? visual.y - (rider.hipY || 0.95) * humanScale : visual.y * 0.82,
    0
  );
  rider.group.rotation.y = Math.PI / 2; // human +Z follows animal +X

  const assembly = new T.Group();
  assembly.add(animal, rider.group);
  if (airborne) {
    assembly.position.y = Math.max(0.85, animalSize.y * 0.18);
    animal.rotation.z = -0.08;
  }
  assembly.updateMatrixWorld(true);

  const scene = new T.Scene();
  scene.background = new T.Color(0x111c27);
  scene.add(new T.HemisphereLight(0xeaf5ff, 0x253525, 1.5));
  const key = new T.DirectionalLight(0xffffff, 2.1);
  key.position.set(7, 11, 9); scene.add(key);
  const rim = new T.DirectionalLight(0x72b9ff, 0.9);
  rim.position.set(-8, 5, -7); scene.add(rim);
  scene.add(assembly);

  const box = new T.Box3().setFromObject(assembly);
  const size = box.getSize(new T.Vector3());
  const center = box.getCenter(new T.Vector3());
  const floorSize = Math.max(18, size.x * 4, size.z * 4);
  const ground = new T.Mesh(
    new T.PlaneGeometry(floorSize, floorSize),
    new T.MeshStandardMaterial({ color: 0x29362f, roughness: 0.96 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.02;
  scene.add(ground);
  const grid = new T.GridHelper(floorSize, 32, 0x58705d, 0x34473a);
  grid.position.y = -0.01; scene.add(grid);

  const aspect = input.width / input.height;
  const referenceCamera = input.referenceStage && input.referenceStage.camera;
  const framedHeight = referenceCamera
    ? referenceCamera.framedHeight
    : Math.max(size.y * 1.38, ((size.x + size.z * 0.32) * 1.34) / aspect, 2.4);
  const camera = new T.OrthographicCamera(
    -framedHeight * aspect / 2, framedHeight * aspect / 2,
    framedHeight / 2, -framedHeight / 2, 0.01, 200
  );
  const cameraPosition = referenceCamera
    ? referenceCamera.position
    : [center.x + Math.max(1.0, size.x * 0.22), center.y + size.y * 0.07, center.z + Math.max(9, size.z * 7)];
  const cameraTarget = referenceCamera ? referenceCamera.target : center.toArray();
  const cameraUp = referenceCamera ? referenceCamera.up : [0, 1, 0];
  camera.position.fromArray(cameraPosition);
  camera.up.fromArray(cameraUp);
  camera.lookAt(new T.Vector3().fromArray(cameraTarget)); camera.updateProjectionMatrix();
  studio.scene = scene; studio.camera = camera;
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
  name.textContent = `${sp.name} · ${input.subject.stateLabel}`;
  name.style.cssText = "position:absolute;top:69px;left:28px;font-size:29px;font-weight:800;letter-spacing:-.02em";
  focus.textContent = input.subject.focus;
  focus.style.cssText = "position:absolute;top:106px;left:30px;color:#c0cfda;font-size:13px;font-weight:550;max-width:700px";
  state.textContent = before ? "HUMAN WALK CYCLE" : (airborne ? "ANIMAL AIRBORNE ROOT" : moving ? "ANIMAL GAIT · RIDER BRACED" : "SADDLE-CONTACT POSE");
  state.style.cssText = `position:absolute;right:26px;top:25px;color:${before ? "#ff9c9c" : "#80e4b4"};font-size:11px;font-weight:850;letter-spacing:.11em`;
  source.textContent = new URL(input.sourceUrl).host + new URL(input.sourceUrl).pathname;
  source.style.cssText = "position:absolute;bottom:20px;left:28px;color:#9cb0bf;font:11px ui-monospace,SFMono-Regular,Menlo,monospace";

  return {
    ok: true,
    species: sp.id,
    state: input.subject.state,
    mountedPose: hasMountedPose,
    seatX: Number((visual.x || 0).toFixed(3)),
    seatY: Number(visual.y.toFixed(3)),
    seatWidth: Number(visual.width.toFixed(3)),
    bounds: [size.x, size.y, size.z].map((value) => Number(value.toFixed(3))),
    camera: {
      framedHeight,
      position: cameraPosition.slice(),
      target: cameraTarget.slice(),
      up: cameraUp.slice(),
    },
  };
}

export default {
  id: "mounted-riders",
  title: "Mounted Players: Walking Above Animals → Actually Riding",
  description: "Six very different mounts shown at rest, moving, and airborne. The deployed baseline uses the ordinary player walk cycle above the animal; the repaired build seats the hips on the back, wraps bent legs down both flanks, keeps the rider braced, and carries both bodies on the animal's physical root.",
  beforeLabel: "BEFORE · DEPLOYED",
  afterLabel: "AFTER · MOUNTED",
  viewport: { width: 1100, height: 680 },
  readyExpression: "window.THREE && window.CBZ && CBZ.makeCharacter && CBZ.animChar && CBZ.WILDLIFE_SPECIES && CBZ.WILDLIFE_SPECIES.horse && CBZ.WILDLIFE_SPECIES.bison",
  subjects,
  stage: stageMountedRider,
};
