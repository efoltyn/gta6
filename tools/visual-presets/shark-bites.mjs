/* Shark-mouth and bite-action comparison for tools/visual-compare.mjs.

   Every frame is staged by the page being photographed. The deployed URL
   therefore builds its old solid jaw, while localhost builds the current
   hinged mouth. The runner then copies the deployed camera byte-for-byte into
   the local capture. Open amounts, animal roots, prey, hull, waterline, light,
   and viewport stay matched so anatomy and contact are the only variables. */

const subjects = [
  {
    id: "great-white-rest", label: "Great White — Closed Mouth", species: "great_white_shark", open: 0,
    focus: "At rest, the mouth should read as a dark closed seam connected beneath the snout—not a grey block.",
    frame: 3.0, target: [2.55, 0.78, 0], cameraOffset: [1.7, 1.0, 8],
    state: "REST · CLOSED", metric: "One recessed cavity · one attached mandible",
  },
  {
    id: "great-white-windup", label: "Great White — Bite Wind-up", species: "great_white_shark", open: 0.48,
    focus: "The lower jaw should rotate from its rear body hinge while the upper jaw begins a small forward protrusion.",
    frame: 3.25, target: [2.48, 0.62, 0], cameraOffset: [1.4, 0.95, 8],
    state: "WIND-UP · 48% GAPE", metric: "Hinge world drift: 0 · upper jaw protrudes",
  },
  {
    id: "great-white-full-gape", label: "Great White — Full Gape", species: "great_white_shark", open: 1,
    focus: "Full gape should reveal a dark mouth cavity and a continuous U-shaped ring of front and side teeth.",
    frame: 3.65, target: [2.45, 0.45, 0], cameraOffset: [2.1, 1.2, 8],
    state: "COMMIT · FULL GAPE", metric: "15 upper + 15 lower teeth · connected components: 1 + 1",
  },
  {
    id: "great-white-tuna-contact", label: "Great White — Tuna Contact", species: "great_white_shark", open: 0.82,
    targetSpecies: "tuna", targetAt: [3.25, 0.70, 0], targetYaw: Math.PI / 2,
    focus: "The actual tuna flank should enter the visible tooth ring at the same socket used by mounted damage.",
    frame: 4.15, target: [2.55, 0.52, 0], cameraOffset: [1.3, 1.15, 9],
    state: "CONTACT · PREY IN TOOTH RING", metric: "Mounted hit: 30 damage · shared wildlife damage owner",
  },
  {
    id: "hammerhead-full-gape", label: "Great Hammerhead — Full Gape", species: "hammerhead_shark", open: 1,
    focus: "The famously small mouth remains beneath the cephalofoil, but now opens as one attached jaw instead of loose slabs.",
    frame: 3.1, target: [2.0, 0.55, 0], cameraOffset: [1.8, 1.0, 8],
    state: "FULL GAPE · SMALL MOUTH", metric: "13 upper + 13 lower teeth · zero hinge drift",
  },
  {
    id: "bull-shark-full-gape", label: "Bull Shark — Full Gape", species: "bull_shark", open: 1,
    focus: "The inshore shark should inherit the same physical mouth grammar while retaining its blunt, stocky head.",
    frame: 2.95, target: [1.86, 0.48, 0], cameraOffset: [1.8, 0.95, 8],
    state: "FULL GAPE · SHARED RIG", metric: "15 upper + 15 lower teeth · no species runtime copy",
  },
  {
    id: "megalodon-rest", label: "Megalodon — Closed Mouth", species: "megalodon", open: 0,
    animal: [0, -1.80, 0],
    focus: "At legendary scale, the lower mouth must still meet the head; this is where the old pink board was most obvious.",
    frame: 7.0, target: [8.9, 0.05, 0], cameraOffset: [5.5, 2.6, 18],
    state: "REST · MANDIBLE ATTACHED", metric: "Hinge embedded in head volume · reset drift: 0",
  },
  {
    id: "megalodon-full-gape", label: "Megalodon — Full Gape", species: "megalodon", open: 1,
    animal: [0, -1.80, 0],
    focus: "The huge bite should expose depth and teeth around the maw, with the mandible rotating from the rear rather than orbiting away.",
    frame: 8.2, target: [8.75, -0.45, 0], cameraOffset: [6.5, 3.1, 20],
    state: "COMMIT · FULL GAPE", metric: "19 upper + 19 lower teeth · one hinged assembly",
  },
  {
    id: "megalodon-speedboat-contact", label: "Megalodon — Speedboat Hull Contact", species: "megalodon", open: 0.88,
    animal: [0, -1.80, 0], ship: true, shipAt: [8.1, 0, 0], shipYaw: Math.PI / 2, shipRoll: -0.08,
    focus: "The real Speedboat hull should enter the visible gape exactly where the structural bite resolves.",
    frame: 11.2, target: [7.5, 0.0, 0], cameraOffset: [5.0, 3.6, 23],
    state: "CONTACT · HULL IN TOOTH RING", metric: "Ship engine destroyed · intact wreck handed to sinking physics",
  },
  {
    id: "megalodon-speedboat-clamp", label: "Megalodon — Clamp and Sink Handoff", species: "megalodon", open: 0.08,
    animal: [0.25, -1.55, 0], ship: true, shipAt: [8.0, -0.08, 0], shipYaw: Math.PI / 2, shipRoll: -0.18,
    focus: "After contact, the jaw should visibly clamp around the hull while the boat begins a physical, non-explosive roll.",
    frame: 11.2, target: [7.45, -0.05, 0], cameraOffset: [4.5, 3.5, 23],
    state: "CLAMP · STRUCTURE FAILS", metric: "No explosion · same hull continues into water physics",
  },
];

function stageSharkBite(input) {
  const T = window.THREE, CBZ = window.CBZ, subject = input.subject;
  if (!T || !CBZ || !CBZ.WILDLIFE_SPECIES || !CBZ.buildSwimRig || !CBZ.swimJaw) {
    return { ok: false, missing: "shark mouth staging APIs" };
  }

  let studio = window.__cbzVisualCompare;
  if (!studio) {
    document.documentElement.style.cssText = "margin:0;width:100%;height:100%;background:#061521";
    document.body.innerHTML = "";
    document.body.style.cssText = "margin:0;width:100%;height:100%;overflow:hidden;background:#061521;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    const renderer = new T.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1); renderer.setSize(input.width, input.height, false);
    renderer.outputEncoding = T.sRGBEncoding;
    renderer.domElement.style.cssText = `display:block;width:${input.width}px;height:${input.height}px`;
    document.body.appendChild(renderer.domElement);
    const overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;color:#f5fbff;text-shadow:0 2px 10px #00101a;z-index:5";
    overlay.innerHTML = "<div data-side></div><div data-name></div><div data-focus></div><div data-state></div><div data-phase></div><div data-metric></div><div data-source></div>";
    document.body.appendChild(overlay);
    studio = window.__cbzVisualCompare = { renderer, overlay, scene: null, camera: null };
    studio.render = function () { if (studio.scene && studio.camera) studio.renderer.render(studio.scene, studio.camera); };
  }

  const materials = new Map();
  function animalMaterial(color) {
    const key = Number(color == null ? 0x78858d : color);
    if (!materials.has(key)) materials.set(key, new T.MeshStandardMaterial({
      color: key, roughness: 0.68, metalness: 0.015, flatShading: true,
    }));
    return materials.get(key);
  }
  function makeAnimal(id) {
    const species = CBZ.WILDLIFE_SPECIES[id];
    if (!species || typeof species.build !== "function") return null;
    const group = species.build({ THREE: T, mat: animalMaterial, rng: () => 0.25 });
    group.scale.setScalar(Number(species.scale) || 1);
    group.traverse(o => { o.matrixAutoUpdate = true; });
    const actor = { species, group, pos: group.position, heading: 0, faceH: 0, dead: false };
    CBZ.buildSwimRig(actor);
    return actor;
  }

  const actor = makeAnimal(subject.species);
  if (!actor || !actor.swim) return { ok: false, missing: subject.species };
  const animal = actor.group;
  animal.position.fromArray(subject.animal || [0, 0, 0]);
  animal.rotation.y = subject.animalYaw || -0.04;
  CBZ.swimJaw(actor, Number(subject.open) || 0);
  animal.updateMatrixWorld(true);

  const scene = new T.Scene();
  scene.background = new T.Color(0x061824);
  scene.fog = new T.Fog(0x061824, 22, 58);
  scene.add(new T.HemisphereLight(0xccefff, 0x041019, 1.14));
  const key = new T.DirectionalLight(0xffffff, 1.55); key.position.set(4, 10, 11); scene.add(key);
  const mouthFill = new T.DirectionalLight(0xffa6a0, 0.62); mouthFill.position.set(12, -2, 5); scene.add(mouthFill);
  const rim = new T.DirectionalLight(0x42c8ff, 0.75); rim.position.set(-8, 4, -8); scene.add(rim);

  const water = new T.Mesh(new T.PlaneGeometry(80, 42), new T.MeshPhysicalMaterial({
    color: 0x0d769b, transparent: true, opacity: 0.18, roughness: 0.15,
    metalness: 0.02, depthWrite: false, side: T.DoubleSide,
  }));
  water.rotation.x = -Math.PI / 2; water.position.y = 0; water.renderOrder = 5; scene.add(water);
  const seabed = new T.Mesh(new T.PlaneGeometry(80, 42), new T.MeshStandardMaterial({ color: 0x0b3038, roughness: 1 }));
  seabed.rotation.x = -Math.PI / 2; seabed.position.y = -8.5; scene.add(seabed);
  for (let i = 0; i < 24; i++) {
    const bubble = new T.Mesh(new T.SphereGeometry(0.025 + (i % 4) * 0.012, 6, 5), new T.MeshBasicMaterial({ color: 0x8ddcf5, transparent: true, opacity: 0.42 }));
    bubble.position.set(-8 + i * 0.78, -0.5 - (i % 6) * 0.72, -1.4 - (i % 5) * 0.34); scene.add(bubble);
  }
  scene.add(animal);

  let targetActor = null;
  if (subject.targetSpecies) {
    targetActor = makeAnimal(subject.targetSpecies);
    if (!targetActor) return { ok: false, missing: subject.targetSpecies };
    targetActor.group.position.fromArray(subject.targetAt);
    targetActor.group.rotation.y = subject.targetYaw || 0;
    targetActor.group.updateMatrixWorld(true); scene.add(targetActor.group);
  }

  let ship = null;
  if (subject.ship) {
    if (!CBZ.cityBuildAmbientCarVisual) return { ok: false, missing: "Speedboat builder" };
    ship = CBZ.cityBuildAmbientCarVisual("Speedboat");
    if (!ship) return { ok: false, missing: "Speedboat visual" };
    ship.position.fromArray(subject.shipAt);
    ship.rotation.y = subject.shipYaw || 0;
    ship.rotation.z = subject.shipRoll || 0;
    ship.updateMatrixWorld(true); scene.add(ship);
  }

  const aspect = input.width / input.height;
  const ref = input.referenceStage && input.referenceStage.camera;
  const framedHeight = ref ? ref.framedHeight : Number(subject.frame || 4);
  const camera = new T.OrthographicCamera(-framedHeight * aspect / 2, framedHeight * aspect / 2, framedHeight / 2, -framedHeight / 2, 0.01, 250);
  const cameraTarget = ref ? ref.target : subject.target;
  const off = subject.cameraOffset || [1.5, 1, 9];
  const cameraPosition = ref ? ref.position : [cameraTarget[0] + off[0], cameraTarget[1] + off[1], cameraTarget[2] + off[2]];
  const cameraUp = ref ? ref.up : [0, 1, 0];
  camera.position.fromArray(cameraPosition); camera.up.fromArray(cameraUp);
  camera.lookAt(new T.Vector3().fromArray(cameraTarget)); camera.updateProjectionMatrix();
  studio.scene = scene; studio.camera = camera;
  studio.renderer.setSize(input.width, input.height, false); studio.renderer.render(scene, camera);

  const after = input.side === "after", overlay = studio.overlay;
  const side = overlay.querySelector("[data-side]");
  side.textContent = after ? input.afterLabel : input.beforeLabel;
  side.style.cssText = `position:absolute;top:23px;left:27px;padding:7px 11px;border-radius:7px;background:${after ? "#187e5a" : "#bd4848"};font-size:12px;font-weight:900;letter-spacing:.12em`;
  const name = overlay.querySelector("[data-name]"); name.textContent = subject.label;
  name.style.cssText = "position:absolute;top:67px;left:28px;font-size:28px;font-weight:850;letter-spacing:-.025em";
  const focus = overlay.querySelector("[data-focus]"); focus.textContent = subject.focus;
  focus.style.cssText = "position:absolute;top:105px;left:29px;color:#c2d5df;font-size:13px;font-weight:550;max-width:760px;line-height:1.35";
  const state = overlay.querySelector("[data-state]"); state.textContent = subject.state;
  state.style.cssText = `position:absolute;right:27px;top:26px;color:${after ? "#7df0b8" : "#ffaaaa"};font-size:11px;font-weight:900;letter-spacing:.1em`;
  const phase = overlay.querySelector("[data-phase]"); phase.textContent = `JAW  ${Math.round(subject.open * 100)}%`;
  phase.style.cssText = "position:absolute;right:28px;top:54px;color:#d7eef8;font:12px ui-monospace,SFMono-Regular,Menlo,monospace";
  const metric = overlay.querySelector("[data-metric]"); metric.textContent = subject.metric;
  metric.style.cssText = "position:absolute;right:27px;bottom:22px;padding:7px 10px;border-radius:6px;background:rgba(3,18,28,.76);color:#bfeeff;font:11px ui-monospace,SFMono-Regular,Menlo,monospace";
  const source = overlay.querySelector("[data-source]"); source.textContent = new URL(input.sourceUrl).host + new URL(input.sourceUrl).pathname;
  source.style.cssText = "position:absolute;bottom:22px;left:28px;color:#91aab7;font:11px ui-monospace,SFMono-Regular,Menlo,monospace";

  const mouth = animal.userData && animal.userData.aquaticMouth;
  const jaw = actor.swim;
  const hinge = jaw.jawGroup ? jaw.jawGroup.getWorldPosition(new T.Vector3()) : null;
  return {
    ok: true, species: actor.species.id, openness: subject.open,
    authoredMouth: !!mouth, upperTeeth: mouth && mouth.upperTeeth, lowerTeeth: mouth && mouth.lowerTeeth,
    lowerJawGroup: !!jaw.jawGroup, legacyLooseParts: jaw.jaw ? jaw.jaw.length : 0,
    hinge: hinge && hinge.toArray().map(v => Number(v.toFixed(3))),
    prey: targetActor && targetActor.species.id, realSpeedboat: !!ship,
    camera: { framedHeight, position: cameraPosition.slice(), target: cameraTarget.slice(), up: cameraUp.slice() },
  };
}

export default {
  id: "shark-bites",
  title: "Shark and Megalodon Mouths — Anatomy Through Contact",
  description: "Ten matched frames compare the deployed shark mouths with the current repair across rest, wind-up, full gape, prey contact, ship contact, and clamp. Four species now share one authored U-jaw contract: a rear hinge embedded in the head, a recessed cavity, front-and-side tooth rows, and the same visible socket used by damage. The last pages combine the megalodon with the real Speedboat to show the full bite-to-sinking handoff.",
  beforeLabel: "BEFORE · DEPLOYED",
  afterLabel: "AFTER · HINGED MOUTHS",
  pairNote: "Same source asset · jaw phase · target · camera · water · light · viewport",
  method: "Each source page builds its own registered shark, opens it through that page's production CBZ.swimJaw, and adds the same prey or Speedboat asset where applicable. The runner copies the deployed camera into the local capture. These are matched action-state frames, not hand-retouched images.",
  viewport: { width: 1100, height: 680 },
  readyExpression: "window.THREE && window.CBZ && CBZ.buildSwimRig && CBZ.swimJaw && CBZ.cityBuildAmbientCarVisual && CBZ.WILDLIFE_SPECIES && CBZ.WILDLIFE_SPECIES.great_white_shark && CBZ.WILDLIFE_SPECIES.hammerhead_shark && CBZ.WILDLIFE_SPECIES.bull_shark && CBZ.WILDLIFE_SPECIES.megalodon",
  subjects,
  stage: stageSharkBite,
};
