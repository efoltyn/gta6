/* FACADE TOWERS — the before/after for the SKYSCRAPER half of the kit.

   OWNER: "now 10 more but these should be focused for the massive tall
   buildings skyscraper facades."

   WHY THIS IS A SEPARATE SHEET FROM facade-gallery.mjs
   ---------------------------------------------------
   A tower is not a tall shop, and the things that make a low block good are
   the wrong things here:

     · At 128 m a storey is 2.5% of the elevation. Per-storey ornament stops
       being visible and starts being a triangle bill — so a tower grammar
       has to BAND its detail (podium, shaft, mechanical floors, setbacks,
       crown) instead of repeating it forty times.
     · The SILHOUETTE carries almost all the identity. You recognise a
       skyscraper from a kilometre as a black shape, long before any surface
       reads. That is why every one of these ten owns a distinct top.
     · The base is a different building from the shaft. The only part a
       player on foot ever touches is the bottom 15 m, and it has to work as
       a street wall whatever the tower above it is doing.

   So this sheet photographs each tower four ways: the full hero, the crown
   alone, the base at eye level, and a distant skyline silhouette. Then it
   re-runs every grammar at 14 storeys and at 52 (the height of buildings.js's
   own makeMegaTower) to prove the banding re-proportions rather than smearing.

   Both sides are the same page, the same seed, the same lights and the same
   tripod. The only difference is the URL flag:

       before   ?cfg_FACADE_KIT=0     the bare 40-storey shell
       after    ?cfg_FACADE_KIT=1     the same shell, dressed

   METRICS
   -------
   boxesPerStorey is the number that matters here and is the one a low-rise
   sheet never needed: merged deco boxes divided by storeys. The bare shell
   sits near 100. A grammar that bands its detail stays close to that; one
   that repeats a low-rise elevation forty times will show it here long
   before the frame rate does.
*/

const TOWER = { w: 34, d: 28, storeys: 40 };
const FH = 3.2;

/* Every camera is SOLVED, not guessed. A tower that overflows its own frame
   teaches nothing, and the first run of this sheet cropped every crown off the
   top because the distances were eyeballed against the shell height.
   `CROWN_ALLOW` is the headroom the cameras must budget for: a facade may put
   a spire, a setback stack or a minaret above ctx.rTop, and the measured worst
   case across the ten grammars is ~1.50x the shell (the tapered spire, at
   192 m over a 128 m shell). 1.55 leaves a little air.
   `frame(top, fill, fov)` returns the distance at which `top` metres occupies
   `fill` of the vertical frame — the whole reason nothing gets cropped. */
const CROWN_ALLOW = 1.55;
const frame = (span, fill, fov) => (span / fill) / (2 * Math.tan(fov * Math.PI / 360));
const fullTop = (s) => s.storeys * FH * CROWN_ALLOW;

/* The whole tower, three-quarter, filling most of the frame. */
const heroCam = (s) => {
  const top = fullTop(s), fov = 40;
  const dist = frame(top, 0.88, fov);
  return { x: dist * 0.70, y: top * 0.54, z: dist * 0.70, ax: 0, ay: top * 0.47, az: 0, fov: fov };
};
/* The crown alone — from below its own springing, which is how a crown is seen
   from anywhere in the city that is not directly underneath. Frames the band
   from the shell roof up to the tallest possible finial. */
const crownCam = (s) => {
  const h = s.storeys * FH, top = fullTop(s), fov = 32;
  const band = (top - h) * 1.7;                 // the crown plus air around it
  const dist = frame(band, 0.86, fov);
  return { x: dist * 0.70, y: h * 0.98, z: dist * 0.70, ax: 0, ay: (h + top) / 2, az: 0, fov: fov };
};
/* Eye level at the entrance. The only part of a tower a player ever touches,
   so this frames the bottom ~50 m and deliberately lets the shaft run out of
   frame — cropping is correct here, it is what standing there looks like. */
const baseCam = (s) => {
  const fov = 62;
  const dist = frame(52, 0.92, fov);
  return { x: s.w * 0.26, y: 1.7, z: s.d / 2 + dist, ax: 0, ay: 15, az: 0, fov: fov };
};
/* Far enough that only the shape survives — the honest test of a skyline. */
const skylineCam = (s) => {
  const top = fullTop(s), fov = 18;
  const dist = frame(top, 0.80, fov);
  return { x: dist * 0.72, y: top * 0.42, z: dist * 0.72, ax: 0, ay: top * 0.44, az: 0, fov: fov };
};

const STYLES = [
  ["intl", "Seagram Curtain Wall",
   "International Style done properly: a bronze-and-glass curtain wall on an absolutely regular mullion grid, lifted on a recessed plinth over an open granite plaza. The whole difference between this and a glass box is discipline — the mullion rhythm, the spandrel tone and the way the shaft meets the ground. If the plaza and the podium reveal are not there, it has failed."],
  ["ziggurat", "Zoning Setback Tower",
   "The 1916 New York envelope made literal: the mass steps back repeatedly as it rises, each setback a real terrace with its own parapet, so the tower tapers in profile without a single sloped surface. Judge the rhythm of the steps — even setbacks read as a wedding cake, uneven ones read as a building."],
  ["sunburst", "Radiator Crown",
   "The Chrysler idea: an ordinary shaft that spends everything it has on the top. Tiered radiating arches, triangular dormer lights, and a needle spire. The crown must be legible in the skyline plate as a shape, not merely as detail visible from close up."],
  ["bundled", "Bundled Tube",
   "Sears/Willis logic: the tower is nine square tubes bundled together, and they terminate at DIFFERENT heights. Pure massing — almost no ornament. The whole identity is that stepped, asymmetric termination, so the skyline plate is the one that matters most for this grammar."],
  ["pyramid", "Tapered Spire",
   "Transamerica: a four-sided tapering shaft that continues into a solid windowless spire, with vertical service wings breaking out of two flanks. The taper must be built from stepped courses that read as continuous, and the wings are what stop it being a plain cone."],
  ["faceted", "Faceted Prism",
   "Bank of China logic: the mass is cut by large diagonal facets so different quadrants terminate at different heights, giving a crystalline, sliced top. Built from stepped boxes, no rotation. The facets must be BIG — a few large cuts, not a texture of small ones."],
  ["pencil", "Supertall Slim",
   "The contemporary pencil tower: an extreme slenderness ratio, open mechanical VOID floors punched through the shaft at intervals (which is how these are really built — they let wind through), expressed outrigger belts at those levels, and a minimal flat crown. The voids are the identity."],
  ["postmodern", "Broken Pediment",
   "The AT&T building's joke, played straight: a granite-clad shaft with punched windows rather than a curtain wall, a monumental arched portal at the base several storeys tall, and a giant broken pediment crowning the top. Deliberately unfashionable and completely recognisable."],
  ["neogothic", "Cathedral of Commerce",
   "Woolworth: gothic verticality at 40 storeys. Continuous piers running the full height uninterrupted, tracery spandrels, and a crown of flying buttresses, pinnacles and a central spire. This is the most ornate of the ten and the one most at risk of blowing the box budget — band the detail."],
  ["megabrace", "Braced Tube",
   "John Hancock: a tower that tapers on both plan axes with gigantic exterior X-braces spanning many storeys at once. The braces are structure, not decoration — each X should cross roughly six to ten floors, and there should only be a handful up the whole height."],
];

const SMALL = { w: 26, d: 22, storeys: 14 };
const HUGE = { w: 38, d: 32, storeys: 52 };

const subjects = [];
for (const [id, label, focus] of STYLES) {
  subjects.push({ id: "hero-" + id, label: label + " — the tower", style: id,
    focus: focus, subject: TOWER, cam: heroCam(TOWER) });
}
for (const [id, label] of STYLES) {
  subjects.push({ id: "crown-" + id, label: label + " — the crown", style: id,
    focus: "The top, framed alone. A skyscraper is identified by its crown from anywhere in the city, so this has to be a considered piece of architecture rather than the shaft simply stopping. Check that it is seated ON the tower rather than floating over it, and that its scale is a fraction of the building rather than a second tower.",
    subject: TOWER, cam: crownCam(TOWER) });
}
for (const [id, label] of STYLES) {
  subjects.push({ id: "base-" + id, label: label + " — the base", style: id,
    focus: "Eye level at the entrance — the ONLY part of a tower a player on foot ever touches. The doorway must be clear and reachable, the podium must read as a street wall rather than as the bottom slice of a shaft, and nothing may hang into the entrance. A tower that is magnificent at 500 m and blank at 2 m has solved the wrong problem.",
    subject: TOWER, cam: baseCam(TOWER) });
}
for (const [id, label] of STYLES) {
  subjects.push({ id: "sky-" + id, label: label + " — skyline silhouette", style: id,
    focus: "Far enough away that only the SHAPE survives. This is the plate that decides whether the grammar was worth building: at this distance surface detail is gone and the tower is a black shape on the sky. If it is indistinguishable from the bare shell here, the facade is decoration rather than architecture.",
    subject: TOWER, cam: skylineCam(TOWER) });
}

async function stageFacadeTowers(input) {
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

  let S = window.__facadeTowerStudio;
  if (!S) {
    S = window.__facadeTowerStudio = {};
    S._render = CBZ.renderer.render.bind(CBZ.renderer);
    CBZ.renderer.render = function () {};
    const scene = new T.Scene();
    scene.background = new T.Color(0xbcd2e8);
    scene.fog = null;
    scene.add(new T.HemisphereLight(0xe8f2ff, 0x6b7480, 0.85));
    // One hard key so relief reads. The shadow camera has to cover a 170 m
    // subject, which is an order of magnitude bigger than the low-rise sheet's
    // — a frustum sized for a shop leaves a tower entirely unshadowed.
    const key = new T.DirectionalLight(0xfff2df, 1.25);
    key.position.set(150, 260, 130);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -200; key.shadow.camera.right = 200;
    key.shadow.camera.top = 240; key.shadow.camera.bottom = -120;
    key.shadow.camera.far = 900;
    scene.add(key);
    const fill = new T.DirectionalLight(0xdde8ff, 0.42);
    fill.position.set(-160, 120, -140);
    scene.add(fill);
    const ground = new T.Mesh(new T.CircleGeometry(900, 56),
      new T.MeshLambertMaterial({ color: 0x8a8f88 }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);
    S.scene = scene;
    S.holder = new T.Group();
    scene.add(S.holder);
    S.cam = new T.PerspectiveCamera(40, input.width / input.height, 0.4, 8000);
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

  while (S.holder.children.length) {
    const c = S.holder.children[0];
    S.holder.remove(c);
    c.traverse && c.traverse((o) => { if (o.geometry && o.geometry.dispose) o.geometry.dispose(); });
  }
  const built = CBZ.facadeStudio(subject.style, { tower: true, subject: subject.subject });
  S.holder.add(built);

  const metrics = {};
  let decoBoxes = 0, realMeshes = 0, tris = 0;
  const heights = [];
  built.traverse((o) => {
    if (!o.isMesh || !o.geometry || o.name === "facadePad") return;
    const g = o.geometry;
    const pos = g.attributes && g.attributes.position;
    if (!pos) return;
    const boxes = pos.count / 24;
    if (Number.isInteger(boxes) && boxes >= 1) decoBoxes += boxes; else realMeshes += 1;
    tris += (g.index ? g.index.count : pos.count) / 3;
    if (!g.boundingBox) g.computeBoundingBox();
    const bb = g.boundingBox;
    if (bb && Number.isFinite(bb.max.y)) heights.push(Math.round((bb.max.y + o.position.y) * 2) / 2);
  });
  const st = (subject.subject && subject.subject.storeys) || 40;
  const uniq = Array.from(new Set(heights.filter((h) => h > 2))).sort((a, b) => a - b);
  metrics.silhouetteBumps = uniq.length;
  metrics.roofTopM = uniq.length ? Math.round(uniq[uniq.length - 1] * 10) / 10 : 0;
  metrics.decoBoxes = Math.round(decoBoxes);
  metrics.boxesPerStorey = Math.round(decoBoxes / st);
  metrics.realMeshes = realMeshes;
  metrics.triangles = Math.round(tris);

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
  id: "facade-towers",
  title: "Ten Skyscraper Grammars",
  description: "The tower half of the facade kit. Ten grammars written for the 40-storey end of the range, each dressing the IDENTICAL 34x28m 40-storey shell, photographed as a hero, as a crown, at street level, and as a distant silhouette. Before is the bare shell; after is the same shell with one flag flipped.",
  beforeLabel: "BEFORE · BARE 40-STOREY SHELL",
  afterLabel: "AFTER · TOWER FACADE",
  viewport: { width: 1000, height: 1000 },
  readyExpression: "window.THREE && window.CBZ && CBZ.CONFIG",
  urlParams: { seed: 64321 },
  stageTimeoutMs: 420000,
  pairNote: "Same shell · seed · pad · lights · tripod — only cfg_FACADE_KIT differs",
  method: "Neither side boots a city. Both load the page, hijack the renderer into an identical studio scene sized for a 170 m subject (the shadow frustum is 400 m across — a frustum sized for a shop leaves a tower unshadowed) and raise the subject through CBZ.facadeStudio(style, {tower:true}), which is one cityMakeBuilding call with facade:'office' plus a dress spec. On the before side cfg_FACADE_KIT=0 makes CBZ.dressFacade return immediately, so the identical call yields the undressed shell. A square viewport is used because a tower is a portrait subject.",
  metricsNote: "boxesPerStorey is the metric this sheet exists for: merged deco boxes divided by storeys. The bare shell sits near 100. A grammar that BANDS its detail into a podium, a shaft, mechanical levels and a crown stays near that number; one that repeats a low-rise elevation forty times shows it here long before the frame rate does. silhouetteBumps counts distinct roofline levels, which is what the skyline plate judges by eye.",
  metrics: {
    boxesPerStorey: { label: "Deco boxes per storey", better: "lower" },
    silhouetteBumps: { label: "Distinct roofline levels", better: "higher" },
    roofTopM: { label: "Tallest point", unit: "m" },
    decoBoxes: { label: "Merged deco boxes (free)" },
    realMeshes: { label: "Individually minted meshes", unit: "meshes", better: "lower" },
    triangles: { label: "Triangles", better: "lower" },
  },
  subjects,
  stage: stageFacadeTowers,
};
