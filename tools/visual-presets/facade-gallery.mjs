/* FACADE GALLERY — the before/after for tools/visual-compare.mjs.

   OWNER: "look how president mode turns the exact building that is already
   great — the office building … we have an amazing base building and the
   president mode uses a facade that makes a great base building interesting …
   I want 10 total new facades … show all in the before after pdf."

   WHAT IS BEING COMPARED
   ----------------------
   Exactly one variable. Both sides boot the same page, build the same shell
   through the same CBZ.cityMakeBuilding call, from the same seed, under the
   same lights, photographed from the same tripod. The ONLY difference is the
   URL flag:

       before   ?cfg_FACADE_KIT=0     the bare base building
       after    ?cfg_FACADE_KIT=1     the same building, dressed

   That is the honest form of this question. A facade that only looks good
   next to a differently-lit, differently-framed baseline has not been shown
   to look good at all.

   THE SUBJECT
   -----------
   city/facade_demo.js pins it: 22 x 16 m, four storeys, door on +z. An
   ordinary mid-block office — the shell the owner called already great. Every
   style dresses that identical box, so the sheet compares FACADES and not
   building sizes. Two extra plates re-run the whole set at 11 x 9 m single
   storey and 34 x 24 m eight storeys, because a facade that only works at one
   size is a decoration, not a grammar.

   THE STAGE
   ---------
   No city is booted. src/config.js creates the collider/platform arrays at
   parse time and cityMakeBuilding needs nothing else, so the page is loaded,
   the renderer is hijacked into a clean studio scene (the same trick
   tools/studio.mjs uses), and the building is raised into it alone on a
   neutral pad. A real street would vary the lot, the neighbours, the sun and
   the district palette all at once, and none of the differences you saw would
   be the facade.

   METRICS
   -------
   silhouetteBumps counts how many distinct heights the roofline reaches — a
   bare box scores 1, and a facade that earns its keep breaks its own parapet.
   decoBoxes and realMeshes are the cost: the first is free (merged into the
   host's buckets before flushDeco), the second is not, and the kit's budget
   is about 40.
*/

const SUBJ = { w: 22, d: 16, storeys: 4 };

/* One tripod, derived from the subject so a change to the box moves every
   shot together. A three-quarter view is the only honest single frame for a
   facade: it reads the entrance face and one flank at once, so ornament that
   was only applied to the front cannot hide. */
const hero = (s) => {
  const h = s.storeys * 3.2;
  const reach = Math.max(s.w, s.d);
  const dist = reach * 1.55 + h * 1.15 + 12;
  return {
    x: dist * 0.72, y: h * 0.62 + 4.5, z: dist * 0.72,
    ax: 0, ay: h * 0.44, az: 0, fov: 38,
  };
};
/* A street-level look up at the entrance, which is where a player actually
   meets a building and the only frame that judges the door. Stand-off has to
   clear the WHOLE width at this fov or the shot lands inside a portico and
   photographs one pier: a 55-degree lens sees about 1.04 x its distance in
   width, so the eye is pushed back until the full facade plus a margin fits,
   and pushed back further on a tall building so the crown stays in frame. */
const street = (s) => {
  const h = s.storeys * 3.2;
  const fov = 55;
  const needW = (s.w * 1.45) / 1.04;          // full width + margin at this lens
  const needH = h * 1.25;                     // and enough to see the crown
  return { x: s.w * 0.26, y: 1.7, z: s.d / 2 + Math.max(needW, needH, 16),
    ax: 0, ay: h * 0.46, az: 0, fov: fov };
};

const STYLES = [
  ["brick", "Chicago Loft", "Load-bearing brick: piers between the bays, segmental arches, a corbelled cornice, a cast-iron storefront and a fire escape down one flank. The test is whether it reads as STRUCTURE — brick piers carrying the floors — rather than as a red wrapper."],
  ["stone", "Ashlar Bank", "Dressed limestone in three parts: rusticated base, plain shaft, attic over a heavy cornice. The giant order must be solved backwards from the roofline so the entablature clears it, and the entry steps must be walkable."],
  ["mosque", "Grand Mosque", "Dome on a buttressed drum, a minaret off one corner, a horseshoe arcade and a monumental pishtaq portal. The dome must be buttressed, not a ball on a box, and the portal must not foul the door."],
  ["artdeco", "Deco Tower", "1930 setback skyscraper. Continuous fluted piers run base to crown with the spandrels recessed behind them — NOTHING horizontal may cross a pier. Judge the verticality first and the chevrons second."],
  ["brutalist", "Beton Brut", "Deep window hoods throwing real shadow, board-formed plank lines, an expressed service tower over the roofline, the mass lifted on pilotis. If it reads as a flat grey box, the relief is not deep enough."],
  ["hightech", "Exostructure", "Inside-out: the frame stands proud of the glass, the service risers and the stair are on the outside, the plant on the roof is architecture. The frame and the glass must not converge in tone — that contrast IS the style."],
  ["pagoda", "Tiered Eaves", "Timber frame under deep tiered eaves with upturned corners on visible dougong brackets. Shallow eaves are the failure mode; the lowest eave should project the furthest."],
  ["gothic", "Gothic Revival", "Stepped buttresses stepping back as they rise, pinnacles breaking the roofline, pointed arches with tracery, a rose window over a deeply recessed portal. Everything terminates in a point."],
  ["adobe", "Pueblo Adobe", "Earthen mass: battered walls thickening to the base, projecting vigas, stepped massing, small deep-set windows, a latilla porch. Irregularity is the point — a beige box with square edges is the failure."],
  ["victorian", "Second Empire", "Mansard roof with dormers punching through it, projecting oriel bays, a deep bracketed cornice, cast-iron storefront. The busiest of the ten by design."],
];

const subjects = [];
for (const [id, label, focus] of STYLES) {
  subjects.push({
    id: "hero-" + id, label: label + " — three-quarter", style: id,
    focus: focus,
    subject: SUBJ, cam: hero(SUBJ),
  });
}
for (const [id, label] of STYLES) {
  subjects.push({
    id: "street-" + id, label: label + " — from the pavement", style: id,
    focus: "Street level, looking up at the entrance. This is where the player actually meets the building. The doorway must be clear and reachable, nothing may hang below head height across it, and the facade has to still read from underneath rather than only from the hero angle.",
    subject: SUBJ, cam: street(SUBJ),
  });
}
/* THE SCALE PROOF. A grammar re-proportions; a decoration does not. */
const SMALL = { w: 11, d: 9, storeys: 1 };
const BIG = { w: 34, d: 24, storeys: 8 };
for (const [id, label] of STYLES) {
  subjects.push({
    id: "small-" + id, label: label + " — one storey, 11 m", style: id,
    focus: "The same grammar on a corner shop. Bay counts, order heights and crown sizes must all have come down with the building. Ornament sized for a four-storey block and pasted onto a single storey is the tell that a constant was hardcoded.",
    subject: SMALL, cam: hero(SMALL),
  });
  subjects.push({
    id: "big-" + id, label: label + " — eight storeys, 34 m", style: id,
    focus: "The same grammar on a block four times the size. Detail must multiply where it should (bays, courses, buttresses) and stay singular where it should (one dome, one minaret, one crown). Watch for ornament that stretched instead of repeating.",
    subject: BIG, cam: hero(BIG),
  });
}

async function stageFacadeGallery(input) {
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

  // The kit and the studio helper have to be parsed before anything can be
  // raised. On the BEFORE side facade_kit is still present — it is the flag,
  // not the file, that is off — so this wait is symmetric.
  await until(() => CBZ.cityMakeBuilding && CBZ.facadeStudio, 60000, 200);
  if (!CBZ.cityMakeBuilding) return { ok: false, missing: "cityMakeBuilding" };
  if (!CBZ.facadeStudio) return { ok: false, missing: "facadeStudio" };

  // ---- the studio scene, built once and reused --------------------------
  // Hijack exactly the way tools/studio.mjs does: no-op the public render so
  // the game's rAF cannot starve our stills under SwiftShader, keep the
  // original for our own shot, and point CBZ.scene/CBZ.camera at ours.
  let S = window.__facadeStudio;
  if (!S) {
    S = window.__facadeStudio = {};
    S._render = CBZ.renderer.render.bind(CBZ.renderer);
    CBZ.renderer.render = function () {};
    const scene = new T.Scene();
    scene.background = new T.Color(0xbcd2e8);
    scene.fog = null;
    const hemi = new T.HemisphereLight(0xe8f2ff, 0x6b7480, 0.85);
    scene.add(hemi);
    // A single hard key from the front-left is what makes relief readable —
    // and relief is the entire subject here. Shadowing is left ON for the
    // same reason: a deep window hood that casts nothing has not been proved.
    const key = new T.DirectionalLight(0xfff2df, 1.25);
    key.position.set(48, 72, 40);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -70; key.shadow.camera.right = 70;
    key.shadow.camera.top = 70; key.shadow.camera.bottom = -70;
    key.shadow.camera.far = 260;
    scene.add(key);
    const fill = new T.DirectionalLight(0xdde8ff, 0.42);
    fill.position.set(-52, 34, -46);
    scene.add(fill);
    const ground = new T.Mesh(new T.CircleGeometry(150, 56),
      new T.MeshLambertMaterial({ color: 0x8a8f88 }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);
    S.scene = scene;
    S.holder = new T.Group();
    scene.add(S.holder);
    const cam = new T.PerspectiveCamera(38, input.width / input.height, 0.15, 3000);
    S.cam = cam;
    CBZ.scene = scene;
    CBZ.camera = cam;
    const renderer = CBZ.renderer;
    renderer.shadowMap.enabled = true;
    renderer.setPixelRatio(1);
    renderer.setSize(input.width, input.height, false);
    document.body.style.margin = "0";
    const cv = renderer.domElement;
    cv.style.position = "fixed"; cv.style.left = "0"; cv.style.top = "0";
    cv.style.zIndex = "99999";
    document.body.appendChild(cv);
    // Hide the title screen DOM: the menu would sit over every plate.
    for (const child of Array.from(document.body.children)) {
      if (child === cv) continue;
      child.style.visibility = "hidden";
    }
  }

  // ---- raise this subject's building ------------------------------------
  while (S.holder.children.length) {
    const c = S.holder.children[0];
    S.holder.remove(c);
    c.traverse && c.traverse((o) => {
      if (o.geometry && o.geometry.dispose) o.geometry.dispose();
    });
  }
  const built = CBZ.facadeStudio(subject.style, { subject: subject.subject });
  S.holder.add(built);

  // ---- measure -----------------------------------------------------------
  const metrics = {};
  let decoBoxes = 0, realMeshes = 0, tris = 0;
  const heights = [];
  built.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    const g = o.geometry;
    const pos = g.attributes && g.attributes.position;
    if (!pos) return;
    // A merged deco bucket is one mesh holding many boxes; an individually
    // minted mesh (column, dome, ball, cone) is the expensive kind. 24 verts
    // per box is the BoxGeometry signature the merge preserves.
    const boxes = pos.count / 24;
    if (Number.isInteger(boxes) && boxes >= 1) decoBoxes += boxes; else realMeshes += 1;
    tris += (g.index ? g.index.count : pos.count) / 3;
    if (!g.boundingBox) g.computeBoundingBox();
    const bb = g.boundingBox;
    if (bb && Number.isFinite(bb.max.y)) heights.push(Math.round((bb.max.y + o.position.y) * 4) / 4);
  });
  // How many DISTINCT levels the silhouette reaches. A bare box is 1-2; a
  // facade that owns its silhouette breaks its own parapet several times.
  const uniq = Array.from(new Set(heights.filter((h) => h > 1))).sort((a, b) => a - b);
  metrics.silhouetteBumps = uniq.length;
  metrics.roofTopM = uniq.length ? Math.round(uniq[uniq.length - 1] * 10) / 10 : 0;
  metrics.decoBoxes = Math.round(decoBoxes);
  metrics.realMeshes = realMeshes;
  metrics.triangles = Math.round(tris);

  // ---- compose ------------------------------------------------------------
  const locked = input.referenceStage && input.referenceStage.camera;
  const cam = locked || subject.cam;
  const camera = S.cam;
  camera.aspect = input.width / input.height;
  camera.fov = cam.fov || 38;
  camera.position.set(cam.x, cam.y, cam.z);
  camera.lookAt(cam.ax, cam.ay, cam.az);
  camera.updateProjectionMatrix();
  CBZ.renderer.setSize(input.width, input.height, false);
  await wait(60);
  S._render(S.scene, camera);
  return {
    ok: true,
    camera: { x: cam.x, y: cam.y, z: cam.z, ax: cam.ax, ay: cam.ay, az: cam.az, fov: cam.fov || 38 },
    metrics,
  };
}

export default {
  id: "facade-gallery",
  title: "Ten Facades on One Base Building",
  description: "President mode does not build a Capitol — it builds the ordinary office shell and hands it a spec at the call site. This sheet generalises that: ten architectural grammars, each dressing the IDENTICAL 22x16m four-storey office box, then re-run at one storey and at eight to prove they re-proportion instead of stretching. Before is the bare shell; after is the same shell with one flag flipped.",
  beforeLabel: "BEFORE · BARE BASE BUILDING",
  afterLabel: "AFTER · FACADE KIT",
  viewport: { width: 1200, height: 780 },
  readyExpression: "window.THREE && window.CBZ && CBZ.CONFIG",
  urlParams: { seed: 64321 },
  stageTimeoutMs: 420000,
  pairNote: "Same shell · seed · pad · lights · tripod — only cfg_FACADE_KIT differs",
  method: "Neither side boots a city. src/config.js creates the collider and platform arrays at parse time and cityMakeBuilding needs nothing further, so both sides load the page, hijack the renderer into an identical studio scene (one hard key light plus a fill, shadows on, neutral pad) and raise the subject through CBZ.facadeStudio, which is a single cityMakeBuilding call with facade:'office' plus a dress spec. On the before side cfg_FACADE_KIT=0 makes CBZ.dressFacade return immediately, so the identical call yields the undressed shell. Studio buildings are unwound from CBZ.colliders/platforms/losBlockers after each raise so nothing accumulates across plates.",
  metricsNote: "silhouetteBumps counts the distinct heights the roofline reaches — a bare box scores 1 or 2, and a facade that owns its silhouette (dome, minaret, setbacks, pinnacles, mansard) scores several. decoBoxes is the FREE cost: boxes merged into the host's deco buckets before flushDeco, which core/batch.js then folds city-wide. realMeshes is the cost that is not free — individually minted columns, domes, balls and cones — and the kit's working budget is about 40 per building.",
  metrics: {
    silhouetteBumps: { label: "Distinct roofline levels", better: "higher" },
    roofTopM: { label: "Tallest point", unit: "m" },
    decoBoxes: { label: "Merged deco boxes (free)", better: "higher" },
    realMeshes: { label: "Individually minted meshes", unit: "meshes", better: "lower" },
    triangles: { label: "Triangles", better: "lower" },
  },
  subjects,
  stage: stageFacadeGallery,
};
