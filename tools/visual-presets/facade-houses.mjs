/* FACADE HOUSES — the before/after for the DOMESTIC half of the kit.

   OWNER: "There are 20 or so facades for buildings that got made recently, I
   want you to make 10 more but these should be like houses … look at how the
   facades like the gov building facade leaves windows of og building visible,
   that's very important."

   WHY THIS IS A SEPARATE SHEET FROM facade-gallery.mjs / facade-towers.mjs
   ----------------------------------------------------------------------
   A house is not a small commercial block, and the things that make the Ashlar
   Bank good are the wrong things here:

     · THE ROOF IS THE BUILDING. A commercial block is identified by its
       cornice and terminates in a parapet; a house is identified by its roof
       and a parapet on it reads as a mistake. So every one of these eleven
       grammars owns a pitched, hipped, tiled or floating-plane roof that
       stands ABOVE the host's roof deck — which is why the sheet measures
       roofAboveShellM, a number the other two sheets never needed.
     · THE HOST'S OWN WINDOWS MUST SURVIVE. The shell glazes one continuous
       band per storey per face (y = k*FH+0.55 … (k+1)*FH-0.45, FH 3.2, with
       0.55 m jambs). A house grammar dresses AROUND that band — shutters and
       surrounds flanking it, sill and header courses above and below it,
       verticals (posts, studs, battens, fins) crossing it so the ribbon reads
       as separate punched windows. Anything that lays a solid band across the
       glass has bricked the house up, and both the street plate and the
       three-quarter plate are framed to catch exactly that.
     · A HOUSE IS MET AT THE FRONT DOOR. Porches, verandas, loggias, stoops
       and porte-cocheres are the second identity move after the roof, and all
       of them are things a player walks INTO. Hence the pavement plate on
       every style.

   THE SUBJECTS
   ------------
   Three sizes, because a grammar re-proportions and a decoration does not:
   14 x 11 m two storeys is the house (the hero), 11 x 9 m one storey is the
   cottage, and 22 x 16 m four storeys is the mansion — which is also the exact
   shell facade-gallery.mjs photographs, so a house grammar can be compared
   directly against the commercial ten on the same box.

   THE STAGE
   ---------
   Identical to facade-gallery.mjs: no city is booted, the renderer is hijacked
   into a neutral studio (one hard key, one fill, shadows on, grey pad), and
   the subject is raised through CBZ.facadeStudio — one cityMakeBuilding call
   with facade:'office' plus a dress spec. Before is the same page with
   cfg_FACADE_KIT=0, which makes CBZ.dressFacade return immediately, so the
   identical call yields the bare shell. One variable.
*/

const HOUSE = { w: 14, d: 11, storeys: 2 };
const COTTAGE = { w: 11, d: 9, storeys: 1 };
const MANSION = { w: 22, d: 16, storeys: 4 };
const FH = 3.2;

/* Every camera is SOLVED from the subject, never eyeballed, and it budgets for
   a ROOF above the shell — the whole point of this set. Crop a chimney off and
   you have photographed the wrong half of the building.

   THE REACH TABLE. Per style, per subject size: [tallest point, largest
   half-extent from the centre], in metres, MEASURED by running each builder
   against a stub ctx that records the extremes of every box it emits (that
   probe lives in the scratchpad; re-run it and paste if a grammar changes
   shape). This is why the cottage plates are framed differently from the
   mansion plates: a manor's roof reaches 3.8x its wall on a one-storey shell
   and 1.95x on a four-storey one, and a desert house's garden walls run 17 m
   out from the centre while a brick Colonial stops at 11.7. A single guessed
   multiplier cannot serve both, and the first run of this sheet proved it by
   cropping the ridge off half the plates. */
const REACH = {
  greekrev:   { 1: [7.8, 7.4],  2: [12.3, 9.2],  4: [20.9, 13.8] },
  romanvilla: { 1: [6.4, 7.3],  2: [10.2, 9.2],  4: [17.2, 13.3] },
  spanish:    { 1: [10.2, 7.5], 2: [13.9, 10.1], 4: [21.4, 14.0] },
  manor:      { 1: [12.1, 6.6], 2: [17.1, 7.9],  4: [25.0, 12.1] },
  queenanne:  { 1: [10.0, 7.5], 2: [15.6, 9.4],  4: [23.1, 14.3] },
  plantation: { 1: [7.4, 7.8],  2: [11.4, 9.8],  4: [19.7, 15.1] },
  machiya:    { 1: [7.0, 7.5],  2: [11.0, 9.5],  4: [21.0, 14.3] },
  desertmod:  { 1: [6.6, 9.8],  2: [9.9, 12.3],  4: [16.4, 17.3] },
  techhouse:  { 1: [5.1, 6.8],  2: [8.3, 8.5],   4: [14.7, 12.7] },
  ranch:      { 1: [8.2, 6.5],  2: [12.2, 9.4],  4: [20.1, 14.4] },
  brickhouse: { 1: [9.0, 6.1],  2: [13.0, 7.6],  4: [20.6, 11.7] },
};
const MARGIN = 1.12;                      // air around the measured extreme
const frame = (span, fill, fov) => (span / fill) / (2 * Math.tan(fov * Math.PI / 360));
/* A style with no measured entry (a new grammar, or a subject size not in the
   table) falls back to the envelope the table's worst case implies: a roof
   allowance that shrinks as the shell grows, and a plan reach a little wider
   than the footprint. Generous on purpose — sky in the plate is a blemish,
   a cropped ridge is a lie. */
const reach = (style, s) => {
  const r = REACH[style] && REACH[style][s.storeys];
  const top = r ? r[0] : s.storeys * FH * (1.75 + 2.65 / Math.max(1, s.storeys));
  const half = r ? r[1] : Math.max(s.w, s.d) * 0.9;
  return { top: top * MARGIN, half: half * MARGIN };
};

/* THE HERO. Three-quarter, from a little above eye level — high enough that the
   roof PLANE reads (on a house the roof is a surface you see, not just an
   outline) and low enough that it is still a house seen from the street rather
   than a plan. */
const hero = (style, s) => {
  const { top, half } = reach(style, s);
  const fov = 40;
  // Hold whichever is larger: the full height, or the three-quarter width —
  // a low wide desert house overflows sideways long before it overflows up.
  const dist = frame(Math.max(top, half * 1.55), 0.88, fov);
  return { x: dist * 0.74, y: top * 0.52, z: dist * 0.74,
    ax: 0, ay: top * 0.44, az: 0, fov: fov };
};
/* THE PAVEMENT. Standing at the gate looking at the front door — the frame that
   judges the porch, the steps, the door surround, and whether the ground-floor
   glass survived the dressing. Pushed back far enough to hold the full width
   plus the roof at this lens, and never inside the porch. */
const street = (style, s) => {
  const fov = 58;
  const { top, half } = reach(style, s);
  // Wide enough for the whole front, far enough for the ridge, and aimed at
  // the middle of the WHOLE building — aiming at mid-wall throws away the top
  // of the frame on a house whose roof is most of its height.
  const needW = frame(half * 2.05, 0.94, fov);
  const needH = frame(top, 0.94, fov) * 0.66;
  return { x: s.w * 0.16, y: 1.65, z: s.d / 2 + Math.max(needW, needH, 11),
    ax: 0, ay: top * 0.40, az: 0, fov: fov };
};
/* THE ROOFLINE. A house is recognised from down the block as a shape against
   the sky, so this frames the top half only: eaves, ridge, dormers, chimneys,
   turret, tile courses. If a style has no roof it fails visibly here. */
const roofline = (style, s) => {
  const h = s.storeys * FH, fov = 30;
  const { top, half } = reach(style, s);
  const y0 = h * 0.60;                       // start just below the wall head
  const band = Math.max((top - y0) * 1.25, half * 1.5);
  const dist = frame(band, 0.86, fov);
  return { x: dist * 0.66, y: h * 0.88, z: dist * 0.66,
    ax: 0, ay: (y0 + top) / 2, az: 0, fov: fov };
};

const STYLES = [
  ["greekrev", "Greek Revival Mansion",
   "The 1840s temple front bolted to a house: a full-height colonnade standing clear of the entrance face carrying a real triangular pediment with a deep raking cornice and a tympanum, a plain frieze ring, corner pilasters answering the columns, and broad walkable steps to the door. The order has to be solved so the entablature clears the roofline instead of growing through it, and the pediment must read as a triangle from 200 m."],
  ["romanvilla", "Roman Villa",
   "The patrician villa: an arcaded loggia of round arches on piers wrapping the entrance and a flank, a low hipped pantile roof with a strongly overhanging bracketed eave, rendered stucco over a stone plinth, and a roof terrace with a low parapet. The arches must have real shadow in their heads — an arcade drawn as flat openings is the failure."],
  ["spanish", "Spanish Colonial Mansion",
   "White stucco and red barrel tile: a deeply overhanging low-pitched tile roof whose courses read as rounded pantiles, a tower or raised gable breaking the roofline over the entrance, a carved door surround, wrought-iron juliet balconies, a small round-arched arcade and iron window grilles. The tile and the tower carry it at distance."],
  ["manor", "English Manor",
   "The country house with a name: a steep roof, multiple cross gables of different sizes stepping across the front, and tall clustered chimney stacks standing well clear of the ridge — those chimneys are the kilometre read. Then half-timbering over pale infill with a jettied upper storey, a projecting two-storey bay, mullioned leaded lights and a hooded porch."],
  ["queenanne", "Queen Anne Painted Lady",
   "The painted lady: a polygonal corner turret with a candle-snuffer roof rising above the main ridge, steep cross gables, a wraparound porch on turned posts with spindlework and brackets, a projecting bay, fish-scale shingle bands over clapboard, and a three-colour paint scheme. Asymmetry is the point — the turret takes ONE corner, chosen by position hash."],
  ["plantation", "Antebellum Plantation House",
   "The double-height wraparound veranda: a colossal colonnade standing off the wall on every visible face carrying an upper gallery with a balustrade between the columns, under a broad hipped roof with dormers and chimneys. The gallery must project far enough to throw real shadow on the wall behind it, and the columns must be countable from the street."],
  ["machiya", "Japanese Residence",
   "Minka, not temple: one great irimoya roof of dark kawara tile with a thick ridge and eaves overhanging far past the wall on exposed rafter tails, over a pale plaster wall gridded by dark timber posts and rails, a continuous engawa veranda along the entrance face, and koushi lattice and shoji grids framing the host glass. The roof should own a third of the elevation and must NOT tier."],
  ["desertmod", "Desert Modern House",
   "Palm Springs 1962: one enormous blade-thin roof plane floating past the walls on slim steel posts and throwing a hard shadow across the whole elevation, a deep shaded carport, pierced breeze-block screens standing off the glass (you must still see through them to the host windows), a clerestory strip and low stone garden walls running out past the house."],
  ["techhouse", "Modern Tech House",
   "Stacked shifted slabs: an upper volume cantilevering over a recessed ground floor to make a deep shaded soffit, one volume in vertical timber battens standing proud as a brise-soleil, another in board-formed concrete or dark panel, a razor-thin floating roof edge, a full-height entrance slot in a stone blade wall, and a rooftop solar grid. No ornament — all the identity is in the massing and the two materials."],
  ["ranch", "Plain House",
   "The hardest one in the set, because it has nothing to hide behind: a simple shingled gable roof with a modest overhang and a fascia, lap siding coursing across the wall, a small shed-roofed stoop on two posts, plain trim with a drip cap and shutters flanking the glass, corner boards, a brick chimney, a foundation skirt and a porch light. The test is whether a player walking past believes someone lives here."],
  ["brickhouse", "Brick Colonial House",
   "Symmetry and brick: the door dead centre under a pedimented surround with pilasters and a fanlight, an even rhythm of windows with splayed jack arches and keystones, a projecting water table, a header course in the sill zone, a white dentil cornice, a side-gabled shingle roof with dormers, two gable-end chimneys, black shutters and quoined corners."],
];

const subjects = [];
for (const [id, label, focus] of STYLES) {
  subjects.push({ id: "hero-" + id, label: label + " — the house", style: id,
    focus: focus, subject: HOUSE, cam: hero(id, HOUSE) });
}
for (const [id, label] of STYLES) {
  subjects.push({ id: "street-" + id, label: label + " — from the pavement", style: id,
    focus: "Standing at the gate. This is where a player meets the house: the door must be clear and reachable, nothing may hang below head height across it, and — the owner's first requirement — the base building's OWN window glass must still be visible between whatever the facade added. Shutters, posts, surrounds and mullions framing the glass are right; a solid band laid across it is the bug this frame exists to catch.",
    subject: HOUSE, cam: street(id, HOUSE) });
}
for (const [id, label] of STYLES) {
  subjects.push({ id: "roof-" + id, label: label + " — the roofline", style: id,
    focus: "The top half alone, which is how a house is recognised from down the block: eaves and their overhang, ridge, gables, dormers, tile or shingle coursing, chimneys, turret, finials. A house grammar that terminated in a flat parapet has failed here and nowhere else.",
    subject: HOUSE, cam: roofline(id, HOUSE) });
}
for (const [id, label] of STYLES) {
  subjects.push({ id: "cottage-" + id, label: label + " — one storey, 11 m", style: id,
    focus: "The same grammar on a cottage. Bay counts, porch bays, roof height, chimney size and column count must all have come down with the building. Ornament sized for a two-storey house and pasted onto one storey is the tell that a metre constant was hardcoded instead of derived from the host.",
    subject: COTTAGE, cam: hero(id, COTTAGE) });
}
/* Four of the eleven declare maxStoreys 3, so the mansion plate is deliberately
   OUTSIDE their range: the auto-picker would never hand them this shell, and an
   explicit dress spec at a call site is always obeyed, so this is what the
   author would get if they asked anyway. Said plainly on the plate rather than
   quietly skipped — a grammar's limit is worth seeing. */
const CAPPED_AT_3 = { romanvilla: true, machiya: true, desertmod: true, techhouse: true };
for (const [id, label] of STYLES) {
  subjects.push({ id: "mansion-" + id, label: label + " — four storeys, 22 m", style: id,
    focus: "The same grammar on the 22x16m four-storey shell facade-gallery.mjs uses, so a house can be judged against the commercial ten on the identical box. Detail must multiply where it should (bays, columns, dormers, courses) and stay singular where it should (one turret, one tower, one ridge, one porch)."
      + (CAPPED_AT_3[id] ? " NOTE: this grammar declares maxStoreys 3 — it is horizontal by definition and the registry will never hand it a shell this tall. The plate is here to show what its author was avoiding." : ""),
    subject: MANSION, cam: hero(id, MANSION) });
}

async function stageFacadeHouses(input) {
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
  if (!CBZ.cityMakeBuilding) return { ok: false, missing: "cityMakeBuilding" };
  if (!CBZ.facadeStudio) return { ok: false, missing: "facadeStudio" };

  // ---- the studio scene, built once and reused (same trick as studio.mjs) --
  let S = window.__facadeStudio;
  if (!S) {
    S = window.__facadeStudio = {};
    S._render = CBZ.renderer.render.bind(CBZ.renderer);
    CBZ.renderer.render = function () {};
    const scene = new T.Scene();
    scene.background = new T.Color(0xbcd2e8);
    scene.fog = null;
    scene.add(new T.HemisphereLight(0xe8f2ff, 0x6b7480, 0.85));
    // One hard key light. Relief is the subject — an eave that casts nothing
    // has not been proved to overhang — so shadows stay on.
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
    S.cam = new T.PerspectiveCamera(40, input.width / input.height, 0.15, 3000);
    CBZ.scene = scene;
    CBZ.camera = S.cam;
    const renderer = CBZ.renderer;
    renderer.shadowMap.enabled = true;
    renderer.setPixelRatio(1);
    renderer.setSize(input.width, input.height, false);
    document.body.style.margin = "0";
    const cv = renderer.domElement;
    cv.style.position = "fixed"; cv.style.left = "0"; cv.style.top = "0";
    cv.style.zIndex = "99999";
    document.body.appendChild(cv);
    for (const child of Array.from(document.body.children)) {
      if (child === cv) continue;
      child.style.visibility = "hidden";
    }
  }

  // ---- raise this subject's house -----------------------------------------
  while (S.holder.children.length) {
    const c = S.holder.children[0];
    S.holder.remove(c);
    c.traverse && c.traverse((o) => {
      if (o.geometry && o.geometry.dispose) o.geometry.dispose();
    });
  }
  const built = CBZ.facadeStudio(subject.style, { subject: subject.subject });
  S.holder.add(built);

  // ---- measure -------------------------------------------------------------
  const metrics = {};
  let decoBoxes = 0, realMeshes = 0, tris = 0;
  const heights = [];
  built.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    const g = o.geometry;
    const pos = g.attributes && g.attributes.position;
    if (!pos) return;
    const boxes = pos.count / 24;
    if (Number.isInteger(boxes) && boxes >= 1) decoBoxes += boxes; else realMeshes += 1;
    tris += (g.index ? g.index.count : pos.count) / 3;
    if (!g.boundingBox) g.computeBoundingBox();
    const bb = g.boundingBox;
    if (bb && Number.isFinite(bb.max.y)) heights.push(Math.round((bb.max.y + o.position.y) * 4) / 4);
  });
  const uniq = Array.from(new Set(heights.filter((h) => h > 1))).sort((a, b) => a - b);
  const top = uniq.length ? uniq[uniq.length - 1] : 0;
  const shell = (subject.subject.storeys || 1) * 3.2;
  metrics.silhouetteBumps = uniq.length;
  metrics.roofTopM = Math.round(top * 10) / 10;
  // THE HOUSE NUMBER: how far the roof reaches above the host's own roof deck.
  // A bare shell scores ~1 (its parapet). A house that terminated in a flat
  // parapet instead of a roof is visible in this column before it is visible
  // in the plate.
  metrics.roofAboveShellM = Math.round(Math.max(0, top - shell) * 10) / 10;
  metrics.decoBoxes = Math.round(decoBoxes);
  metrics.realMeshes = realMeshes;
  metrics.triangles = Math.round(tris);

  // ---- compose -------------------------------------------------------------
  const locked = input.referenceStage && input.referenceStage.camera;
  const cam = locked || subject.cam;
  const camera = S.cam;
  camera.aspect = input.width / input.height;
  camera.fov = cam.fov || 40;
  camera.position.set(cam.x, cam.y, cam.z);
  camera.lookAt(cam.ax, cam.ay, cam.az);
  camera.updateProjectionMatrix();
  CBZ.renderer.setSize(input.width, input.height, false);
  await wait(60);
  S._render(S.scene, camera);
  return {
    ok: true,
    camera: { x: cam.x, y: cam.y, z: cam.z, ax: cam.ax, ay: cam.ay, az: cam.az, fov: cam.fov || 40 },
    metrics,
  };
}

export default {
  id: "facade-houses",
  title: "Eleven House Facades on the Same Base Building",
  description: "The facade kit, pointed at houses. Eleven domestic grammars — Greek Revival, Roman villa, Spanish Colonial, English manor, Queen Anne, antebellum plantation, Japanese minka, desert modern, tech house, plain house, brick Colonial — each dressing the IDENTICAL shell through one cityMakeBuilding call, then re-run as a one-storey cottage and as the four-storey mansion box the commercial sheet uses. Every one of them dresses AROUND the base building's own window band rather than over it, and every one of them puts a real roof where the shell had a parapet. Before is the bare shell; after is the same shell with one flag flipped.",
  beforeLabel: "BEFORE · BARE BASE BUILDING",
  afterLabel: "AFTER · HOUSE FACADE",
  viewport: { width: 1200, height: 780 },
  readyExpression: "window.THREE && window.CBZ && CBZ.CONFIG",
  urlParams: { seed: 64321 },
  defaultBefore: "local",
  beforeParams: { cfg_FACADE_KIT: 0 },
  afterParams: { cfg_FACADE_KIT: 1 },
  stageTimeoutMs: 420000,
  pairNote: "Same shell · seed · pad · lights · tripod — only cfg_FACADE_KIT differs",
  method: "Neither side boots a city. src/config.js creates the collider and platform arrays at parse time and cityMakeBuilding needs nothing further, so both sides load the page, hijack the renderer into an identical studio scene (one hard key light plus a fill, shadows on, neutral pad) and raise the subject through CBZ.facadeStudio — a single cityMakeBuilding call with facade:'office' plus a dress spec. On the before side cfg_FACADE_KIT=0 makes CBZ.dressFacade return immediately, so the identical call yields the undressed shell. Studio buildings are unwound from CBZ.colliders/platforms/losBlockers after each raise so nothing accumulates across plates.",
  metricsNote: "roofAboveShellM is the house number: metres of roof standing above the host's own roof deck. The bare shell scores about 1 (its parapet); a grammar that terminated in a parapet instead of a gable, hip, tile or floating plane shows up here before you see it in the plate. silhouetteBumps counts the distinct heights the roofline reaches — dormers, chimneys, turrets and ridges each add one. decoBoxes is the FREE cost (merged into the host's deco buckets before flushDeco, then folded city-wide by core/batch.js); realMeshes is the cost that is not free — individually minted columns, cones, domes and balls — and the kit's working budget is about 40 per building.",
  metrics: {
    roofAboveShellM: { label: "Roof above the shell", unit: "m", better: "higher" },
    silhouetteBumps: { label: "Distinct roofline levels", better: "higher" },
    roofTopM: { label: "Tallest point", unit: "m" },
    decoBoxes: { label: "Merged deco boxes (free)", better: "higher" },
    realMeshes: { label: "Individually minted meshes", unit: "meshes", better: "lower" },
    triangles: { label: "Triangles", better: "lower" },
  },
  subjects,
  stage: stageFacadeHouses,
};
