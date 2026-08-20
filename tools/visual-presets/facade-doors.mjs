/* FACADE DOORS — can you see the way in, on every single one?

   OWNER: "every single facade should have a door and not all do — review all
   in the pdf for visible door."

   WHY THIS IS ITS OWN SHEET. The hero and roofline plates in the other three
   sheets are framed to judge silhouette and ornament, and at that distance a
   doorway is a few pixels: a facade can bury its entrance behind a pier, a
   screen, a plinth or a porch beam and still photograph beautifully. This
   sheet frames nothing but the entrance — straight on, centred on the door
   axis, close enough that the door leaf itself is a large object in the
   frame — so "is there a visible way in" is the only question a plate can
   answer.

   THE BASE SHELL ALREADY DRAWS A DOOR at the centre of ctx.doorSide, so the
   BEFORE side of every pair is the same undressed doorway. Anything missing
   on the after side was taken away by the facade, which makes each pair a
   direct read on one grammar's entrance.

   Low-rise grammars are shot on the studio's standard 22x16m four-storey
   shell; skyline grammars on the standard 34x28m tower, framed on its bottom
   storeys — a tower's door is still a door.
*/

const LOW = ["adobe", "artdeco", "brick", "brickhouse", "brutalist", "desertmod",
  "gothic", "greekrev", "hightech", "machiya", "manor", "mosque", "pagoda",
  "plantation", "queenanne", "ranch", "romanvilla", "spanish", "stone",
  "techhouse", "victorian"];
const TOWERS = ["bundled", "faceted", "intl", "megabrace", "neogothic", "pencil",
  "postmodern", "pyramid", "sunburst", "ziggurat"];

const SHOP = { w: 22, d: 16, storeys: 4 };
const TOWER = { w: 34, d: 28, storeys: 40 };

/* Straight on the door axis. The shell puts the doorway at the CENTRE of the
   entrance face, so x = 0 is the door; the only judgement in this camera is
   how far back to stand, and that is solved from the width we must see rather
   than guessed: at 55 degrees on a 1200x780 frame the lens sees about 1.6x its
   distance in width, so 13 m of facade needs ~8 m of stand-off.

   The first run of this sheet stood at exactly that and photographed the
   INSIDE of a portico: a porch, loggia or temple front projects several metres
   past the wall, so a stand-off solved against the wall plane puts the lens
   under the porch roof looking at a column. The stand-off is measured from the
   wall but sized for the deepest thing a facade can put in front of it, and
   the lens tightened to keep the door large in frame. Eye height stays low —
   this is the view of somebody walking up to the door. */
const doorCam = (s) => ({
  x: 0, y: 3.0, z: s.d / 2 + 15,
  ax: 0, ay: 2.8, az: 0, fov: 48,
});
/* A three-quarter of the same entrance, because a porch, portico or recessed
   slot can read as a wall head-on and as a way in from 30 degrees off — and
   because a column standing exactly in the doorway only shows from an angle. */
const doorAngle = (s) => ({
  x: s.w * 0.40, y: 2.8, z: s.d / 2 + 15,
  ax: 0, ay: 2.6, az: 0, fov: 48,
});

const subjects = [];
for (const id of LOW) {
  subjects.push({ id: "door-" + id, style: id, subject: SHOP, cam: doorCam(SHOP),
    label: id + " — the door, head on",
    focus: "Straight down the door axis from where somebody walks up. There must be a visible, obviously usable way in: a door leaf, or an opening that plainly reads as an entrance. A pier, plinth, screen, shutter or porch beam standing across it is the failure." });
  subjects.push({ id: "angle-" + id, style: id, subject: SHOP, cam: doorAngle(SHOP),
    label: id + " — the door, from the side",
    focus: "The same entrance at 30 degrees, which is how a player usually arrives. A column planted in the doorway, or a portico whose beam crosses the head, shows here even when the head-on plate looked clear." });
}
for (const id of TOWERS) {
  subjects.push({ id: "door-" + id, style: id, subject: TOWER, cam: doorCam(TOWER),
    label: id + " — the door, head on",
    focus: "A tower's entrance is still a door, and it is the only part of a 128 m building a player on foot ever touches. Same test: a visible way in at the centre of the entrance face." });
  subjects.push({ id: "angle-" + id, style: id, subject: TOWER, cam: doorAngle(TOWER),
    label: id + " — the door, from the side",
    focus: "The same tower entrance at an angle — the frame that catches a colonnade or a plinth standing in front of the way in." });
}

async function stageDoors(input) {
  const CBZ = window.CBZ;
  const T = window.THREE;
  if (!CBZ || !T) return { ok: false, missing: "CBZ/THREE" };
  const subject = input.subject;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (test, budgetMs, stepMs) => {
    const deadline = Date.now() + budgetMs;
    while (Date.now() < deadline) {
      try { if (test()) return true; } catch (_) {}
      await wait(stepMs || 200);
    }
    return false;
  };

  await until(() => CBZ.cityMakeBuilding && CBZ.facadeStudio, 60000, 200);
  if (!CBZ.facadeStudio) return { ok: false, missing: "facadeStudio" };

  let S = window.__doorStudio;
  if (!S) {
    S = window.__doorStudio = {};
    S._render = CBZ.renderer.render.bind(CBZ.renderer);
    CBZ.renderer.render = function () {};
    const scene = new T.Scene();
    scene.background = new T.Color(0xbcd2e8);
    scene.add(new T.HemisphereLight(0xe8f2ff, 0x6b7480, 0.9));
    // The key is aimed ACROSS the entrance face rather than down it: a doorway
    // is a hole, and a hole only reads if something is lighting one jamb and
    // shadowing the other.
    const key = new T.DirectionalLight(0xfff2df, 1.2);
    key.position.set(52, 60, 78);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -70; key.shadow.camera.right = 70;
    key.shadow.camera.top = 70; key.shadow.camera.bottom = -70;
    key.shadow.camera.far = 260;
    scene.add(key);
    const fill = new T.DirectionalLight(0xdde8ff, 0.5);
    fill.position.set(-40, 26, 40);
    scene.add(fill);
    const ground = new T.Mesh(new T.CircleGeometry(150, 48),
      new T.MeshLambertMaterial({ color: 0x8a8f88 }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);
    S.scene = scene;
    S.holder = new T.Group();
    scene.add(S.holder);
    S.cam = new T.PerspectiveCamera(55, input.width / input.height, 0.1, 3000);
    CBZ.scene = scene; CBZ.camera = S.cam;
    const r = CBZ.renderer;
    r.shadowMap.enabled = true; r.setPixelRatio(1);
    r.setSize(input.width, input.height, false);
    document.body.style.margin = "0";
    const cv = r.domElement;
    cv.style.position = "fixed"; cv.style.left = "0"; cv.style.top = "0"; cv.style.zIndex = "99999";
    document.body.appendChild(cv);
    for (const child of Array.from(document.body.children)) {
      if (child === cv) continue;
      child.style.visibility = "hidden";
    }
  }

  while (S.holder.children.length) {
    const c = S.holder.children[0];
    S.holder.remove(c);
    c.traverse && c.traverse((o) => { if (o.geometry && o.geometry.dispose) o.geometry.dispose(); });
  }
  S.holder.add(CBZ.facadeStudio(input.subject.style, { subject: subject.subject }));

  const cam = (input.referenceStage && input.referenceStage.camera) || subject.cam;
  const camera = S.cam;
  camera.aspect = input.width / input.height;
  camera.fov = cam.fov || 55;
  camera.position.set(cam.x, cam.y, cam.z);
  camera.lookAt(cam.ax, cam.ay, cam.az);
  camera.updateProjectionMatrix();
  CBZ.renderer.setSize(input.width, input.height, false);
  await wait(50);
  S._render(S.scene, camera);
  return { ok: true, camera: cam, metrics: {} };
}

export default {
  id: "facade-doors",
  title: "The Way In: Every Facade's Entrance",
  description: "All 31 registered grammars, photographed at nothing but their front door — head on down the door axis, then at 30 degrees. The base shell draws a doorway at the centre of the entrance face, so the before side of every pair is the same undressed opening and anything missing after is the facade's doing.",
  beforeLabel: "BEFORE · THE SHELL'S OWN DOORWAY",
  afterLabel: "AFTER · WITH THE FACADE",
  viewport: { width: 1200, height: 780 },
  readyExpression: "window.THREE && window.CBZ && CBZ.CONFIG",
  urlParams: { seed: 64321 },
  defaultBefore: "local",
  beforeParams: { cfg_FACADE_KIT: 0 },
  afterParams: { cfg_FACADE_KIT: 1 },
  stageTimeoutMs: 420000,
  pairNote: "Same shell · seed · lights · tripod — only cfg_FACADE_KIT differs",
  method: "Both sides raise the subject through CBZ.facadeStudio into a neutral studio and photograph the entrance face straight on and at 30 degrees. The key light is aimed across the doorway rather than down it, because a doorway is a hole and a hole only reads when one jamb is lit and the other is in shadow.",
  subjects,
  stage: stageDoors,
};
