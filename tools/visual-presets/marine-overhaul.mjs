/* THE MARINE OVERHAUL — the whole feature in one report.

   OWNER (2026-08-20, with photo reference): "improve the appearance of all
   sharks and fish in the game ... what they look like as their fins and what
   they look like from above the water ... Really focus on improving shark
   appearance and how they look from a ship when next to ship", and then
   "Great white is most important, focus on it and then generalize", and then
   "Orcas are also a concern".

   Every other marine preset in this directory answers one question — the
   mouth (shark-bites), the waterline (marine-surface), the deck view
   (shark-from-deck), the pod (orca-pod). This one is the CONTACT SHEET for
   the whole animal: it walks each species past the camera at the exact
   angles the owner's reference photographs were taken from, so the report
   reads against the photos frame for frame.

   THE ANGLES ARE THE REFERENCE SHEET. docs/SHARK-REFERENCE.md is organised
   as five numbered sections, each one a photograph; the subjects below are
   named after them:
     §1 open mouth, close up      -> the money shot, jaws at full gape
     §2 head-on at the surface    -> the wide dome and the ragged
                                     countershading line
     §3 the breach                -> pitched 45 deg out of the water,
                                     gill slits on the transition
     §4 from directly above       -> the drone frame: narrow torpedo, swept
                                     pectorals, long upper caudal lobe
     §5 the fin at the surface    -> the concave scythe

   IT NAMES NO GEOMETRY. The staging only ever calls species.build(),
   CBZ.buildSwimRig and CBZ.swimJaw, which is what makes it useful as the
   umbrella: it photographs WHATEVER each build produces. A species rebuilt
   in aquatic.js shows up here for free, and so does one re-registered from
   its own file (city/wildlife_orca.js takes the orca that way — defineSpecies
   is last-write-wins), with no edit here. Add a species to the catalogue
   tomorrow and it is one row in ROSTER.

   THE BASELINE IS THE DEPLOYED BUILD, deliberately. A flag A/B is the
   stronger claim for a BEHAVIOUR change and most presets here use one, but
   this report exists to answer "did the animals get better", and the honest
   before for that is the animal that is actually shipped. */

/* Who gets photographed, and how big the frame has to be to hold them.
   `frame` is the orthographic height in metres at the animal's own scale —
   it is the ONLY per-species number here, and it is a camera fact, not an
   anatomy fact, so it cannot go stale when a build changes. */
const ROSTER = [
  { id: "great_white_shark", label: "Great White",      frame: 7.0,  hero: true },
  { id: "orca",              label: "Orca",             frame: 8.0,  hero: true },
  { id: "megalodon",         label: "Megalodon",        frame: 15.0, hero: true },
  { id: "hammerhead_shark",  label: "Great Hammerhead", frame: 7.0 },
  { id: "bull_shark",        label: "Bull Shark",       frame: 5.5 },
  { id: "dolphin",           label: "Dolphin",          frame: 4.5 },
  { id: "marlin",            label: "Blue Marlin",      frame: 6.0 },
  { id: "barracuda",         label: "Great Barracuda",  frame: 4.0 },
  { id: "tuna",              label: "Bluefin Tuna",     frame: 4.0 },
  { id: "manta_ray",         label: "Giant Manta",      frame: 8.0 },
  { id: "sea_turtle",        label: "Green Sea Turtle", frame: 3.2 },
  { id: "humpback_whale",    label: "Humpback Whale",   frame: 20.0 },
  { id: "sardine",           label: "Sardine",          frame: 1.1 },
  { id: "fish",              label: "Mackerel",         frame: 1.4 },
];

/* The five reference angles, as camera recipes. `dir` is the offset from the
   animal toward the camera in its own body frame (+X is the nose, +Y up,
   +Z its left flank); `pitch` rolls the ANIMAL, not the camera, because a
   breach is a pose and a plan view is not. */
const ANGLES = {
  side:     { dir: [0.05, 0.10, 1], open: 0,    label: "Side",          note: "§3 silhouette: teardrop, max girth at the pectoral line, long taper to a narrow peduncle." },
  gape:     { dir: [0.85, 0.18, 0.55], open: 1, label: "Full Gape",     note: "§1 the money shot. The upper jaw should PROTRUDE and the snout LIFT — not a mandible swinging under a rigid head.", closeUp: 0.45 },
  headOn:   { dir: [1, 0.06, 0.04], open: 0.15, label: "Head-On",       note: "§2 a wide dome, wider than tall, and a RAGGED high-contrast countershading line across the cheek.", closeUp: 0.55 },
  breach:   { dir: [0.35, 0.25, 1], open: 0.55, pitch: 0.80, label: "Breach", note: "§3 pitched ~45° out of the water. Five pale gill slits sit ON the countershading transition." },
  plan:     { dir: [0, 1, 0.001], open: 0,      label: "From Above",    note: "§4 the drone frame. A NARROW torpedo widest at the pectorals, pectorals swept ~30°, upper caudal lobe clearly longer." },
};

const subjects = [];
for (const sp of ROSTER) {
  // Heroes get the full five-angle sheet; everyone else gets the two angles
  // that carry the most information about a rebuild — the silhouette and the
  // plan view. That keeps the report long enough to be complete and short
  // enough that somebody actually pages through it.
  const angles = sp.hero ? ["side", "gape", "headOn", "breach", "plan"] : ["side", "plan"];
  for (const a of angles) {
    subjects.push({
      id: `${sp.id}-${a}`,
      label: `${sp.label} — ${ANGLES[a].label}`,
      species: sp.id, angle: a, frame: sp.frame,
      focus: ANGLES[a].note,
      state: `${ANGLES[a].label.toUpperCase()}`,
    });
  }
}

function stageMarine(input) {
  const T = window.THREE, CBZ = window.CBZ, subject = input.subject;
  if (!T || !CBZ || !CBZ.WILDLIFE_SPECIES) return { ok: false, missing: "wildlife species registry" };

  const ANG = {
    side:   { dir: [0.05, 0.10, 1], open: 0 },
    gape:   { dir: [0.85, 0.18, 0.55], open: 1, closeUp: 0.45 },
    headOn: { dir: [1, 0.06, 0.04], open: 0.15, closeUp: 0.55 },
    breach: { dir: [0.35, 0.25, 1], open: 0.55, pitch: 0.80 },
    plan:   { dir: [0, 1, 0.001], open: 0 },
  }[subject.angle] || { dir: [0.05, 0.1, 1], open: 0 };

  let studio = window.__cbzVisualCompare;
  if (!studio) {
    document.documentElement.style.cssText = "margin:0;width:100%;height:100%;background:#07202c";
    document.body.innerHTML = "";
    document.body.style.cssText = "margin:0;width:100%;height:100%;overflow:hidden;background:#07202c;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    const renderer = new T.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1); renderer.setSize(input.width, input.height, false);
    if (T.sRGBEncoding != null) renderer.outputEncoding = T.sRGBEncoding;
    renderer.domElement.style.cssText = `display:block;width:${input.width}px;height:${input.height}px`;
    document.body.appendChild(renderer.domElement);
    const overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;color:#f2fbff;text-shadow:0 2px 10px #001019;z-index:5";
    overlay.innerHTML = "<div data-side></div><div data-name></div><div data-focus></div><div data-state></div><div data-metric></div><div data-source></div>";
    document.body.appendChild(overlay);
    studio = window.__cbzVisualCompare = { renderer, overlay, scene: null, camera: null };
    studio.render = function () { if (studio.scene && studio.camera) studio.renderer.render(studio.scene, studio.camera); };
  }

  const materials = new Map();
  function animalMaterial(color) {
    const key = Number(color == null ? 0x78858d : color);
    if (!materials.has(key)) materials.set(key, new T.MeshStandardMaterial({
      color: key, roughness: 0.72, metalness: 0.01, flatShading: true,
    }));
    return materials.get(key);
  }

  const species = CBZ.WILDLIFE_SPECIES[subject.species];
  if (!species || typeof species.build !== "function") return { ok: false, missing: subject.species };
  let group;
  try { group = species.build({ THREE: T, mat: animalMaterial, rng: () => 0.25 }); }
  catch (err) { return { ok: false, missing: `${subject.species} build threw: ${err && err.message}` }; }
  if (!group) return { ok: false, missing: `${subject.species} build returned nothing` };
  group.scale.setScalar(Number(species.scale) || 1);

  // The swim rig and the jaw are the PAGE'S OWN production code — the point of
  // staging this way is that a gape is opened by whatever the build under test
  // uses, not by anything replicated here. Both are optional: a species with no
  // jaw still photographs, it just photographs closed.
  const actor = { species, group, pos: group.position, heading: 0, faceH: 0, dead: false };
  if (CBZ.buildSwimRig) { try { CBZ.buildSwimRig(actor); } catch (e) {} }
  if (CBZ.swimJaw && ANG.open) { try { CBZ.swimJaw(actor, ANG.open); } catch (e) {} }

  group.position.set(0, 0, 0);
  group.rotation.set(0, 0, ANG.pitch || 0);
  group.updateMatrixWorld(true);

  // MEASURE THE ANIMAL, DON'T ASSUME IT. Framing off the live bounding box is
  // what lets one recipe hold a sardine and a humpback, and it is also what
  // makes the report honest when a rebuild changes an animal's proportions.
  const box = new T.Box3().setFromObject(group);
  const size = new T.Vector3(); box.getSize(size);
  const centre = new T.Vector3(); box.getCenter(centre);

  const scene = new T.Scene();
  scene.background = new T.Color(0x07202c);
  scene.add(new T.HemisphereLight(0xcdf0ff, 0x03141c, 1.05));
  const key = new T.DirectionalLight(0xffffff, 1.5); key.position.set(6, 12, 9); scene.add(key);
  const rim = new T.DirectionalLight(0x49c9ff, 0.8); rim.position.set(-9, 3, -8); scene.add(rim);
  const belly = new T.DirectionalLight(0x9fd8e8, 0.42); belly.position.set(0, -8, 4); scene.add(belly);
  scene.add(group);

  // A waterline only where a waterline is part of the claim (§3 the breach,
  // §5 the surface). Everywhere else it is a distraction that hides the belly.
  if (subject.angle === "breach") {
    const water = new T.Mesh(new T.PlaneGeometry(400, 400), new T.MeshStandardMaterial({
      color: 0x0d6f93, roughness: 0.2, metalness: 0.02, transparent: true, opacity: 0.55, side: T.DoubleSide,
    }));
    water.rotation.x = -Math.PI / 2;
    water.position.y = centre.y - size.y * 0.12;
    water.renderOrder = 5; scene.add(water);
  }

  const aspect = input.width / input.height;
  const ref = input.referenceStage && input.referenceStage.camera;
  const base = Number(subject.frame) || Math.max(size.x, size.y, size.z) * 1.25;
  const framedHeight = ref ? ref.framedHeight : base * (ANG.closeUp || 1);
  // A close-up frames the HEAD, which is at the +X end of the body by the
  // species contract ("NOSE toward +X"), not the centre of the bounding box.
  const aim = ANG.closeUp
    ? new T.Vector3(box.max.x - size.x * 0.16, centre.y + size.y * 0.06, centre.z)
    : centre.clone();
  const dist = Math.max(size.x, size.y, size.z) * 3 + 12;
  const d = new T.Vector3().fromArray(ANG.dir).normalize().multiplyScalar(dist);
  const camera = new T.OrthographicCamera(
    -framedHeight * aspect / 2, framedHeight * aspect / 2,
    framedHeight / 2, -framedHeight / 2, 0.01, dist * 4);
  const cameraTarget = ref ? ref.target : aim.toArray();
  const cameraPosition = ref ? ref.position : [aim.x + d.x, aim.y + d.y, aim.z + d.z];
  // Looking straight down needs an up vector that is not also straight down.
  const cameraUp = ref ? ref.up : (subject.angle === "plan" ? [1, 0, 0] : [0, 1, 0]);
  camera.position.fromArray(cameraPosition);
  camera.up.fromArray(cameraUp);
  camera.lookAt(new T.Vector3().fromArray(cameraTarget));
  camera.updateProjectionMatrix();

  studio.scene = scene; studio.camera = camera;
  studio.renderer.setSize(input.width, input.height, false);
  studio.renderer.render(scene, camera);

  const after = input.side === "after", overlay = studio.overlay;
  const sideEl = overlay.querySelector("[data-side]");
  sideEl.textContent = after ? input.afterLabel : input.beforeLabel;
  sideEl.style.cssText = `position:absolute;top:23px;left:27px;padding:7px 11px;border-radius:7px;background:${after ? "#187e5a" : "#bd4848"};font-size:12px;font-weight:900;letter-spacing:.12em`;
  const name = overlay.querySelector("[data-name]"); name.textContent = subject.label;
  name.style.cssText = "position:absolute;top:67px;left:28px;font-size:28px;font-weight:850;letter-spacing:-.025em";
  const focus = overlay.querySelector("[data-focus]"); focus.textContent = subject.focus;
  focus.style.cssText = "position:absolute;top:105px;left:29px;color:#bfd6e2;font-size:13px;font-weight:550;max-width:780px;line-height:1.35";
  const state = overlay.querySelector("[data-state]"); state.textContent = subject.state;
  state.style.cssText = `position:absolute;right:27px;top:26px;color:${after ? "#7df0b8" : "#ffaaaa"};font-size:11px;font-weight:900;letter-spacing:.1em`;

  /* WHAT THE NUMBERS ARE FOR. Not one of these decides whether the animal
     looks right — the picture does that, and the report exists to be looked
     at. They are here because they are the handful of facts from the
     reference sheet that CAN be counted, and a count is what catches the
     regression a tired eye slides past: a plan view that quietly went fat
     again, a mesh that lost half its geometry, a gape that stopped moving. */
  let parts = 0, tris = 0;
  group.traverse(function (o) {
    if (!o.isMesh || !o.geometry) return;
    parts++;
    const g = o.geometry;
    const idx = g.index ? g.index.count : (g.attributes && g.attributes.position ? g.attributes.position.count : 0);
    tris += Math.floor(idx / 3);
  });
  /* §4's claim, as a ratio: from above the BODY is a narrow torpedo.
     Measured off the HULL, not the whole bounding box — the first version of
     this measured the bbox and so scored the long swept pectorals §4 also
     demands as a regression, marking the fix as the fault. The body is the
     named hull child where a species has one; anything else falls back to the
     bbox and is read with that caveat. Lower is more torpedo. */
  let bodyW = size.z, bodyL = size.x, onHull = false;
  group.traverse(function (o) {
    // Every species names its body <something>Hull — sharkHull, fishHull,
    // cetaceanHull. Matching only the shark's meant every fish, dolphin and
    // whale silently fell back to the whole bounding box and was scored down
    // for growing the swept pectorals §4 asks for. Match the suffix.
    if (!o.isMesh || !/Hull$/.test(o.name || "")) return;
    const hb = new T.Box3().setFromObject(o), hs = new T.Vector3(); hb.getSize(hs);
    if (hs.x > 0) { bodyW = hs.z; bodyL = hs.x; onHull = true; }
  });
  const planRatio = bodyL > 0 ? bodyW / bodyL : 0;
  const metrics = {
    parts: parts,
    triangles: tris,
    lengthM: Math.round(size.x * 100) / 100,
    heightM: Math.round(size.y * 100) / 100,
  };
  // Only report the plan ratio where it was actually measured on a body. A
  // bounding-box figure answers a different question and reporting it under
  // the same label would be worse than reporting nothing.
  if (onHull) metrics.planWidthRatio = Math.round(planRatio * 1000) / 1000;

  const metric = overlay.querySelector("[data-metric]");
  metric.textContent = `${parts} parts · ${tris} tris · ${metrics.lengthM} m · plan w/l ${metrics.planWidthRatio}`;
  metric.style.cssText = "position:absolute;right:27px;bottom:22px;padding:7px 10px;border-radius:6px;background:rgba(3,18,28,.78);color:#bfeeff;font:11px ui-monospace,SFMono-Regular,Menlo,monospace";
  const source = overlay.querySelector("[data-source]");
  try { const u = new URL(input.sourceUrl); source.textContent = u.host + u.pathname; } catch (e) { source.textContent = ""; }
  source.style.cssText = "position:absolute;bottom:22px;left:28px;color:#8ea9b7;font:11px ui-monospace,SFMono-Regular,Menlo,monospace";

  return {
    ok: true,
    species: subject.species,
    angle: subject.angle,
    metrics: metrics,
    camera: { position: cameraPosition, target: cameraTarget, up: cameraUp, framedHeight: framedHeight },
  };
}

export default {
  title: "The Marine Overhaul — Every Animal, at the Reference Angles",
  subtitle: "Owner photo reference, section by section: the gape, the head-on dome, the breach, the drone frame.",
  subjects,
  stage: stageMarine,
  /* The gate the runner waits on before it stages anything. Deliberately the
     minimum this preset actually needs — the species registry and a couple of
     great whites' worth of catalogue — rather than a list of every id in
     ROSTER. A roster entry that has not registered yet fails its own subject
     with a readable `missing`, which is information; making it block the whole
     run would turn one absent species into an empty report. */
  readyExpression: "window.THREE && window.CBZ && CBZ.WILDLIFE_SPECIES && CBZ.WILDLIFE_SPECIES.great_white_shark && CBZ.WILDLIFE_SPECIES.megalodon && CBZ.WILDLIFE_SPECIES.orca",
  frames: [{ id: "custom", label: "custom", width: 1400, height: 860, deviceScaleFactor: 1 }],
  stageTimeoutMs: 90000,
  metrics: {
    // Neither of these has a "better" direction and claiming one lies. Fewer
    // meshes for the same animal is a WIN (the great white went 103 -> 30);
    // more meshes can equally mean more detail. They are here to catch a build
    // that silently lost its geometry, which is a thing you read, not a score.
    parts: { label: "Mesh parts" },
    triangles: { label: "Triangles" },
    lengthM: { label: "Length", unit: "m" },
    /* Reported, not scored. §4 asks for two things at once — a narrow plan
       AND maximum girth just behind the head — and a single width-over-length
       number cannot arbitrate between them: building the teardrop the sheet
       demands necessarily raises it. Declaring a direction here made the fix
       read as the fault, which is the same mistake twice, so it is a number
       you read now. */
    planWidthRatio: { label: "Plan width / length (hull)" },
    heightM: { label: "Height", unit: "m" },
  },
  metricsNote:
    "Counts, not verdicts — the pictures decide whether the animal looks right. " +
    "Parts and triangles catch a build that silently lost geometry; plan width/length " +
    "is §4's claim that a shark from above is a narrow torpedo (lower is better); " +
    "length and height are there so a proportion change is visible as a number.",
};
