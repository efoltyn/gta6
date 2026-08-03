/* Wildlife model studio for tools/visual-compare.mjs.

   The same function is serialized into both source pages. It asks each page's
   own CBZ.WILDLIFE_SPECIES registry to build the animal, then photographs it
   in an isolated studio. That makes deployed-vs-local geometry differences
   visible without world spawning, AI timing, camera drift, or weather noise. */

const subjects = [
  ["whitetail_deer", "Whitetail Deer", "Inspect all decorative anatomy and body seams."],
  ["tuna", "Tuna", "Inspect the finlet row and tailward connections."],
  ["marlin", "Marlin", "Inspect fins, bill, and tail assembly continuity."],
  ["sea_turtle", "Sea Turtle", "Inspect the rear tail and shell-body connection.", "three-quarter"],
  ["manta_ray", "Manta Ray", "Inspect wing, cephalic-lobe, and whip-tail connections.", "top"],
  ["white_stag", "White Stag", "Inspect the antlers, ears, hooves, and tail seams.", "three-quarter"],
  ["bengal_tiger", "Bengal Tiger", "Inspect the long tail-to-tip connection."],
  ["lion", "Lion", "The original failure: the dark tuft must meet the raised tail end."],
  ["cheetah", "Cheetah", "Inspect the long tail-to-tip connection."],
  ["snow_leopard", "Snow Leopard", "Inspect the thick tail and curled end connection."],
  ["white_lion", "White Lion", "Inspect the pale tail-to-tuft connection."],
  ["coyote", "Coyote", "Inspect the angled tail-to-tip connection."],
  ["cow", "Cow", "Inspect the tail and other extremity seams."],
  ["goat", "Goat", "Inspect horns, beard, hooves, and body connections."],
  ["elk", "Elk", "Inspect antlers, head, legs, and tail continuity."],
  ["cottontail_rabbit", "Cottontail Rabbit", "Inspect ears, feet, and the white tail puff."],
  ["white_rhino", "White Rhino", "Inspect horn, ears, legs, and tail continuity."],
  ["giraffe", "Giraffe", "Inspect the wide ears and head connection.", "three-quarter"],
  ["zebra", "Zebra", "Inspect stripe pieces, legs, mane, and tail continuity.", "three-quarter"],
  ["jackrabbit", "Jackrabbit", "Inspect the black ear tips and ear connection.", "three-quarter"],
  ["moose", "Moose", "Inspect broad antlers, muzzle, legs, and tail continuity.", "three-quarter"],
  ["caribou", "Caribou", "Inspect the antler branches and head connection.", "three-quarter"],
  ["bison", "Bison", "Inspect the rear-to-body bridge and heavy front assembly."],
].map(([id, label, focus, view]) => ({ id, label, focus, ...(view ? { view } : {}) }));

function stageWildlife(input) {
  const T = window.THREE;
  const CBZ = window.CBZ;
  const sp = CBZ && CBZ.WILDLIFE_SPECIES && CBZ.WILDLIFE_SPECIES[input.subject.id];
  if (!T || !CBZ || !sp || typeof sp.build !== "function") {
    return { ok: false, missing: input.subject.id };
  }

  let studio = window.__cbzVisualCompare;
  if (!studio) {
    document.documentElement.style.cssText = "margin:0;width:100%;height:100%;background:#0d151d";
    document.body.innerHTML = "";
    document.body.style.cssText = "margin:0;width:100%;height:100%;overflow:hidden;background:#0d151d;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    const renderer = new T.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setSize(input.width, input.height, false);
    renderer.domElement.id = "visual-compare-canvas";
    renderer.domElement.style.cssText = `display:block;width:${input.width}px;height:${input.height}px`;
    document.body.appendChild(renderer.domElement);

    const overlay = document.createElement("div");
    overlay.id = "visual-compare-overlay";
    overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;color:#f4f8fb;text-shadow:0 2px 9px #000;z-index:5";
    overlay.innerHTML = "<div data-side></div><div data-name></div><div data-focus></div><div data-source></div>";
    document.body.appendChild(overlay);
    studio = window.__cbzVisualCompare = { renderer, overlay, scene: null, camera: null };
    studio.render = function () {
      if (studio.scene && studio.camera) studio.renderer.render(studio.scene, studio.camera);
    };
  }

  const materialCache = new Map();
  const material = (color) => {
    const key = Number(color || 0x8a8a8a);
    if (!materialCache.has(key)) materialCache.set(key, new T.MeshStandardMaterial({
      color: key,
      roughness: 0.78,
      metalness: 0.02,
      flatShading: true,
    }));
    return materialCache.get(key);
  };
  const model = sp.build({ THREE: T, mat: material, rng: () => 0.25 });
  model.scale.setScalar(Number(sp.scale) || 1);
  model.updateMatrixWorld(true);

  const box = new T.Box3().setFromObject(model);
  if (box.isEmpty()) return { ok: false, empty: input.subject.id };
  const size = box.getSize(new T.Vector3());
  const center = box.getCenter(new T.Vector3());
  const scene = new T.Scene();
  scene.background = new T.Color(0x111c27);
  scene.fog = new T.Fog(0x111c27, 18, 35);
  scene.add(new T.HemisphereLight(0xeaf5ff, 0x263322, 1.5));
  const key = new T.DirectionalLight(0xffffff, 2.15);
  key.position.set(center.x + 6, center.y + 10, center.z + 8);
  scene.add(key);
  const rim = new T.DirectionalLight(0x74baff, 1.0);
  rim.position.set(center.x - 8, center.y + 4, center.z - 7);
  scene.add(rim);

  model.position.y -= box.min.y;
  scene.add(model);
  model.updateMatrixWorld(true);
  box.setFromObject(model);
  box.getSize(size);
  box.getCenter(center);

  const floorSize = Math.max(16, size.x * 4, size.z * 4);
  const ground = new T.Mesh(
    new T.PlaneGeometry(floorSize, floorSize),
    new T.MeshStandardMaterial({ color: sp.aquatic ? 0x18384a : 0x29352e, roughness: 0.96, metalness: 0 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.015;
  scene.add(ground);
  const grid = new T.GridHelper(floorSize, 32, sp.aquatic ? 0x4c8da7 : 0x58705d, sp.aquatic ? 0x244f61 : 0x34473a);
  grid.position.y = -0.008;
  scene.add(grid);

  const aspect = input.width / input.height;
  const view = input.subject.view || "profile";
  const referenceCamera = input.referenceStage && input.referenceStage.camera;
  const framedHeight = referenceCamera
    ? referenceCamera.framedHeight
    : view === "top"
      ? Math.max(size.z * 1.38, (size.x * 1.34) / aspect, 1.25)
      : view === "three-quarter"
        ? Math.max(size.y * 1.45, ((size.x + size.z * 0.45) * 1.36) / aspect, 1.25)
        : Math.max(size.y * 1.36, (size.x * 1.32) / aspect, (size.z * 1.45) / aspect, 1.25);
  const camera = new T.OrthographicCamera(
    -framedHeight * aspect / 2,
    framedHeight * aspect / 2,
    framedHeight / 2,
    -framedHeight / 2,
    0.01,
    200
  );
  let cameraPosition, cameraUp;
  if (referenceCamera) {
    cameraPosition = referenceCamera.position;
    cameraUp = referenceCamera.up;
  } else if (view === "top") {
    cameraUp = [0, 0, -1];
    cameraPosition = [center.x, center.y + Math.max(10, size.y * 8), center.z];
  } else if (view === "three-quarter") {
    cameraUp = [0, 1, 0];
    cameraPosition = [center.x + Math.max(1.2, size.x * 0.75), center.y + size.y * 0.16, center.z + Math.max(8, size.z * 6)];
  } else {
    cameraUp = [0, 1, 0];
    cameraPosition = [center.x + size.x * 0.08, center.y + size.y * 0.1, center.z + Math.max(10, size.z * 7)];
  }
  const cameraTarget = referenceCamera ? referenceCamera.target : center.toArray();
  camera.position.fromArray(cameraPosition);
  camera.up.fromArray(cameraUp);
  camera.lookAt(new T.Vector3().fromArray(cameraTarget));
  camera.updateProjectionMatrix();

  studio.scene = scene;
  studio.camera = camera;
  studio.renderer.setSize(input.width, input.height, false);
  studio.renderer.render(scene, camera);

  const side = studio.overlay.querySelector("[data-side]");
  const name = studio.overlay.querySelector("[data-name]");
  const focus = studio.overlay.querySelector("[data-focus]");
  const source = studio.overlay.querySelector("[data-source]");
  const before = input.side === "before";
  side.textContent = before ? input.beforeLabel : input.afterLabel;
  side.style.cssText = `position:absolute;top:24px;left:28px;padding:7px 11px;border-radius:7px;background:${before ? "#c94c4c" : "#218b60"};font-size:12px;font-weight:900;letter-spacing:.12em`;
  name.textContent = sp.name || input.subject.label || sp.id;
  name.style.cssText = "position:absolute;top:69px;left:28px;font-size:31px;font-weight:800;letter-spacing:-.02em";
  focus.textContent = input.subject.focus || "Attachment continuity";
  focus.style.cssText = "position:absolute;top:108px;left:30px;color:#c0cfda;font-size:13px;font-weight:550";
  source.textContent = new URL(input.sourceUrl).host + new URL(input.sourceUrl).pathname;
  source.style.cssText = "position:absolute;bottom:20px;left:28px;color:#9cb0bf;font:11px ui-monospace,SFMono-Regular,Menlo,monospace";

  return {
    ok: true,
    id: sp.id,
    name: sp.name,
    meshes: (() => { let count = 0; model.traverse((part) => { if (part.isMesh) count++; }); return count; })(),
    view,
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
  id: "wildlife-attachments",
  title: "Wildlife Attachment Repairs",
  description: "Twenty-three repaired wildlife models captured from the deployed GitHub Pages baseline and the current local checkout. Each page pairs the same authored model in a fixed per-subject studio view so detached tails, tips, fins, ears, antlers, and other floating pieces are directly visible.",
  beforeLabel: "BEFORE · DEPLOYED",
  afterLabel: "AFTER · REPAIRED",
  viewport: { width: 960, height: 600 },
  readyExpression: "window.THREE && window.CBZ && CBZ.boxGeom && CBZ.WILDLIFE_SPECIES && Object.keys(CBZ.WILDLIFE_SPECIES).length >= 50",
  defaultFocus: "Inspect physical attachment seams and silhouette continuity.",
  subjects,
  stage: stageWildlife,
};
