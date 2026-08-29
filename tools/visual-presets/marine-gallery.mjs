/* THE OCEAN, PHOTOGRAPHED. Not a diagram — the animals.

   The tail-weld work (5b89ad2, 435ce0a) was argued with cross-sections and
   millimetres, which is the right way to argue it and the wrong way to look
   at it. This preset just takes the picture: every species whose tailstock
   was rebuilt, lit underwater, from the two angles that show a body — the
   profile (what a diver sees) and a three-quarter hero from above the
   shoulder (what the game's camera sees on a pass).

   It is single-sided by design. Run it with `--only after` when you want to
   SEE the fleet; run marine-tail-weld when you need to prove something about
   it. Nothing here animates: a still is what a silhouette is judged on.
*/

const CAST = [
  { id: "orca", label: "Orca", note: "Rear third regraded; joint 47% of max depth" },
  { id: "great_white_shark", label: "Great White", note: "Tailstock 46% deep, 41% wide" },
  { id: "megalodon", label: "Megalodon", note: "Tailstock 46% deep" },
  { id: "hammerhead_shark", label: "Great Hammerhead", note: "Tailstock 47% deep" },
  { id: "bull_shark", label: "Bull Shark", note: "Tailstock 46% deep" },
  { id: "humpback_whale", label: "Humpback Whale", note: "Tailstock 44% deep, laterally compressed" },
  { id: "dolphin", label: "Bottlenose Dolphin", note: "Tailstock 46% deep" },
];

const VIEWS = [
  { id: "profile", label: "Profile", dir: [0, 0.08, 1] },
  { id: "hero", label: "Three-quarter", dir: [0.62, 0.34, 0.70] },
];

const subjects = [];
for (const c of CAST) {
  for (const v of VIEWS) {
    subjects.push({
      id: c.id.replace(/_/g, "-") + "-" + v.id,
      species: c.id, view: v.id, dir: v.dir,
      label: c.label, sub: v.label, note: c.note,
    });
  }
}

export function stageMarineGallery(input) {
  const T = window.THREE, CBZ = window.CBZ;
  const s0 = input.subject;
  if (!T || !CBZ || !CBZ.WILDLIFE_SPECIES) return { ok: false, missing: "species registry" };

  var _s = 0x9e3779b9;
  Math.random = function () { _s ^= _s << 13; _s ^= _s >>> 17; _s ^= _s << 5; return ((_s >>> 0) % 100000) / 100000; };

  let studio = window.__cbzVisualCompare;
  if (!studio) {
    document.documentElement.style.cssText = "margin:0;width:100%;height:100%;background:#03131e";
    document.body.innerHTML = "";
    document.body.style.cssText = "margin:0;width:100%;height:100%;overflow:hidden;background:#03131e;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    const renderer = new T.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1); renderer.setSize(input.width, input.height, false);
    renderer.outputEncoding = T.sRGBEncoding;
    renderer.domElement.style.cssText = `display:block;width:${input.width}px;height:${input.height}px`;
    document.body.appendChild(renderer.domElement);
    const overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;color:#eaf6ff;z-index:5";
    overlay.innerHTML = "<div data-name></div><div data-sub></div><div data-note></div>";
    document.body.appendChild(overlay);
    studio = window.__cbzVisualCompare = { renderer, overlay };
  }

  const materials = new Map();
  function animalMaterial(color) {
    const key = Number(color == null ? 0x78858d : color);
    if (!materials.has(key)) materials.set(key, new T.MeshStandardMaterial({
      color: key, roughness: 0.60, metalness: 0.03,
    }));
    return materials.get(key);
  }

  const species = CBZ.WILDLIFE_SPECIES[s0.species];
  if (!species || typeof species.build !== "function") return { ok: false, missing: s0.species };
  const g = species.build({ THREE: T, mat: animalMaterial, rng: () => 0.25 });
  g.updateMatrixWorld(true);

  const box = new T.Box3().setFromObject(g);
  const size = box.getSize(new T.Vector3());
  const mid = box.getCenter(new T.Vector3());

  /* THE WATER, AND NOT ONE MILLIMETRE OF FOG.
     THE TRAP: the camera stands SIX BODY LENGTHS out (it is orthographic, so
     distance costs nothing in framing) — which puts the animal far beyond any
     fog far-plane written in units of its own size. The first run of this
     preset fogged every species to one flat teal and threw away the
     countershading, the saddle and the eye patch: a gallery that could not
     show the paint. Depth haze is the sea's job in the game, not the
     portrait's. The backdrop is a gradient TEXTURE instead of a plane, so it
     is correct from the three-quarter angle too. */
  const scene = new T.Scene();
  const cv = document.createElement("canvas");
  cv.width = 4; cv.height = 256;
  const cx = cv.getContext("2d");
  const grad = cx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, "#15618a");        // the lit surface above
  grad.addColorStop(0.55, "#0a3550");
  grad.addColorStop(1, "#031019");        // the dark below
  cx.fillStyle = grad; cx.fillRect(0, 0, 4, 256);
  const bg = new T.CanvasTexture(cv);
  bg.minFilter = T.LinearFilter; bg.magFilter = T.LinearFilter;
  scene.background = bg;

  // sunlight from above and slightly ahead, plus the cold upwelling bounce
  // that keeps a white belly from going to a silhouette
  scene.add(new T.HemisphereLight(0xbfe9ff, 0x07202e, 1.00));
  const sun = new T.DirectionalLight(0xffffff, 1.55); sun.position.set(2.2, 9, 4.5); scene.add(sun);
  const bounce = new T.DirectionalLight(0x2f9fd0, 0.55); bounce.position.set(-3, -6, -2); scene.add(bounce);
  const rim = new T.DirectionalLight(0x8fe3ff, 0.70); rim.position.set(-7, 3, -7); scene.add(rim);
  scene.add(g);

  const aspect = input.width / input.height;
  const ref = input.referenceStage && input.referenceStage.camera;
  const plan = s0.view === "plan";
  // frame the animal on its longest axis with a margin for the fins
  const need = Math.max(size.y * 1.05, (size.x * 1.10) / aspect);
  const framedHeight = ref ? ref.framedHeight : need;
  const d = new T.Vector3().fromArray(s0.dir).normalize().multiplyScalar(size.x * 6);
  const cameraTarget = ref ? ref.target : [mid.x, mid.y, mid.z];
  const cameraPosition = ref ? ref.position : [mid.x + d.x, mid.y + d.y, mid.z + d.z];
  const cameraUp = ref ? ref.up : (plan ? [0, 0, -1] : [0, 1, 0]);
  const camera = new T.OrthographicCamera(-framedHeight * aspect / 2, framedHeight * aspect / 2,
    framedHeight / 2, -framedHeight / 2, 0.01, size.x * 40);
  camera.position.fromArray(cameraPosition); camera.up.fromArray(cameraUp);
  camera.lookAt(new T.Vector3().fromArray(cameraTarget)); camera.updateProjectionMatrix();
  studio.renderer.setSize(input.width, input.height, false);
  studio.renderer.render(scene, camera);

  const o = studio.overlay;
  const name = o.querySelector("[data-name]"); name.textContent = s0.label;
  name.style.cssText = "position:absolute;left:34px;bottom:52px;font-size:30px;font-weight:850;letter-spacing:-.02em;text-shadow:0 3px 16px #00121c";
  const sub = o.querySelector("[data-sub]"); sub.textContent = s0.sub;
  sub.style.cssText = "position:absolute;left:36px;bottom:32px;font-size:12px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#7fc9ea;text-shadow:0 2px 10px #00121c";
  const note = o.querySelector("[data-note]"); note.textContent = s0.note;
  note.style.cssText = "position:absolute;right:34px;bottom:34px;color:#9fd0e6;font:12px ui-monospace,SFMono-Regular,Menlo,monospace;text-shadow:0 2px 10px #00121c";

  return {
    ok: true, species: s0.species,
    metrics: { bodyLength: Number(size.x.toFixed(2)) },
    camera: { framedHeight, position: cameraPosition.slice(), target: cameraTarget.slice(), up: cameraUp.slice() },
  };
}

export default {
  id: "marine-gallery",
  title: "The Ocean, Photographed",
  description: "Every species whose tailstock was rebuilt, lit underwater, in profile and three-quarter. A look, not an argument — marine-tail-weld is the argument.",
  beforeLabel: "BEFORE",
  afterLabel: "AFTER",
  pairNote: "Same light, same water column, orthographic",
  method: "Builds the registered production species and photographs it at rest against a depth-graded water column. No animation, no rig.",
  defaultBefore: "local",
  viewport: { width: 1400, height: 800 },
  readyExpression: "window.THREE && window.CBZ && CBZ.WILDLIFE_SPECIES && CBZ.WILDLIFE_SPECIES.orca && CBZ.WILDLIFE_SPECIES.great_white_shark",
  subjects,
  stage: stageMarineGallery,
  metrics: { bodyLength: { label: "Model length", unit: "u", better: "higher" } },
};
