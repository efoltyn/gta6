/* THE TAIL WELD — is the tail's circle the same circle as the body's?

   OWNER (2026-08-27): "shark tails and orca tails, where they meet with the
   body the tail part is much wider than the body part — the circle where the
   tail meets the body, the tail circle is much bigger, when they should be
   identical so the tail looks connected to the body."

   This is NOT the 2026-08-25 animation bug (MARINE_TAIL_V2, the hinge). That
   one was about a tail that slid off a hull while swimming. This one is
   visible on a DEAD STILL animal: every marine body in this game is a big
   rigid hull plus a separately-authored tapered sleeve (the caudal peduncle)
   pushed into its back end, and the sleeve's front ring was hand-typed, not
   measured off the hull it plugs into. Nothing kept the two in sync.

   So every page here is a REST POSE. No swim rig runs; the geometry alone is
   the subject. Each species gets three pages:

     SECTION   the two circles themselves, drawn head-on at the joint: the
               sleeve's front rim and the hull's cross-section a hair in front
               of it, superimposed. This is the owner's sentence as a picture.
     PLAN      the joint from above (a shark's swim plane).
     PROFILE   the joint from the side (a cetacean's swim plane).

   plus a whole-animal profile, because a weld that closes the step by making
   the tail a needle would be a different bug, not a fix.

   Both circles are measured the same way in both columns: rays fired inward
   at the joint station against the real built mesh, so the number under each
   frame is the surface, not the authored table.
*/

const CAST = [
  { id: "orca", label: "Orca", plane: "profile" },
  { id: "great_white_shark", label: "Great White", plane: "plan" },
  { id: "humpback_whale", label: "Humpback", plane: "profile" },
  { id: "hammerhead_shark", label: "Great Hammerhead", plane: "plan" },
];

const subjects = [];
for (const c of CAST) {
  subjects.push({
    id: c.id.replace(/_/g, "-") + "-section", kind: "section", species: c.id,
    label: c.label + " — The Two Circles At The Joint",
    focus: "Head-on at the tail joint. The filled outline is the BODY's cross-section; the bright ring is the front rim of the TAIL sleeve pushed into it. Two circles that should be one.",
    state: "REST POSE · SECTION AT THE WELD",
    metric: "Tail rim vs body section, at the same station",
  });
  subjects.push({
    id: c.id.replace(/_/g, "-") + "-plan", kind: "joint", species: c.id, view: "plan",
    label: c.label + " — The Joint From Above",
    focus: "Plan view of the tail root. Follow the skin line from the body into the tailstock: a step in that line is the tail sitting proud of the body it grows out of.",
    state: "REST POSE · PLAN",
    metric: "Widest step in the skin line at the joint",
  });
  subjects.push({
    id: c.id.replace(/_/g, "-") + "-profile", kind: "joint", species: c.id, view: "profile",
    label: c.label + " — The Joint From The Side",
    focus: "The same joint in the vertical plane, which is where a cetacean's step shows worst — the fluke drives up and down through it.",
    state: "REST POSE · PROFILE",
    metric: "Widest step in the skin line at the joint",
  });
  subjects.push({
    id: c.id.replace(/_/g, "-") + "-body", kind: "body", species: c.id, view: c.plane,
    label: c.label + " — The Whole Animal",
    focus: "The control. Closing the step must not turn the tailstock into a needle or the body into a sausage: this is the silhouette the joint has to belong to.",
    state: "REST POSE · WHOLE BODY",
    metric: "Joint step, for reference",
  });
}

export function stageMarineWeld(input) {
  const T = window.THREE, CBZ = window.CBZ;
  const subject = Object.assign({}, input.subject);
  if (!T || !CBZ || !CBZ.WILDLIFE_SPECIES) return { ok: false, missing: "species registry" };

  var _s = 0x9e3779b9;
  Math.random = function () { _s ^= _s << 13; _s ^= _s >>> 17; _s ^= _s << 5; return ((_s >>> 0) % 100000) / 100000; };

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
    studio = window.__cbzVisualCompare = { renderer, overlay };
  }

  const materials = new Map();
  function animalMaterial(color) {
    const key = Number(color == null ? 0x78858d : color);
    if (!materials.has(key)) materials.set(key, new T.MeshStandardMaterial({
      color: key, roughness: 0.66, metalness: 0.02,
    }));
    return materials.get(key);
  }

  const species = CBZ.WILDLIFE_SPECIES[subject.species];
  if (!species || typeof species.build !== "function") return { ok: false, missing: subject.species };
  const g = species.build({ THREE: T, mat: animalMaterial, rng: () => 0.25 });
  const sc = Number(species.scale) || 1;
  g.updateMatrixWorld(true);

  // ---- find the hull and the tail sleeve, geometrically ------------------
  // No names are trusted: the hull is the largest solid, the sleeve is the
  // fattest remaining solid behind the body's midpoint (a fin is a blade and
  // loses that test on its thin axis). The same test runs on both columns.
  function boxOf(m) {
    if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
    m.updateMatrix();
    return new T.Box3().copy(m.geometry.boundingBox).applyMatrix4(m.matrix);
  }
  const items = [];
  for (const o of g.children) if (o.isMesh && o.geometry && o.geometry.attributes) items.push({ m: o, bb: boxOf(o) });
  if (!items.length) return { ok: false, missing: "meshes" };
  let hull = null, hv = -1;
  for (const it of items) { const d = it.bb.getSize(new T.Vector3()); const v = d.x * d.y * d.z; if (v > hv) { hv = v; hull = it; } }
  const mid = (hull.bb.min.x + hull.bb.max.x) / 2;
  let sleeve = null, sv = -1;
  for (const it of items) {
    if (it === hull || it.bb.max.x > mid) continue;
    const d = it.bb.getSize(new T.Vector3());
    const girth = Math.min(d.y, d.z);
    if (girth > sv) { sv = girth; sleeve = it; }
  }
  if (!sleeve) return { ok: false, missing: "tail sleeve" };

  const bodyLen = hull.bb.max.x - hull.bb.min.x;
  const eps = bodyLen * 0.004;
  const weldX = sleeve.bb.max.x;                 // the sleeve's front face
  const axisY = (sleeve.bb.min.y + sleeve.bb.max.y) / 2;

  // ---- measure both circles by raycast, on the real surface --------------
  const rc = new T.Raycaster();
  const FAR = Math.max(20, bodyLen * 6);
  function hit(mesh, o, d) {
    rc.set(o, d); rc.near = 0; rc.far = FAR * 2.2;
    const h = rc.intersectObject(mesh, false);
    return h.length ? h[0].point.clone() : null;
  }
  function sectionAt(mesh, x, cy) {
    const top = hit(mesh, new T.Vector3(x, cy + FAR, 0), new T.Vector3(0, -1, 0));
    const bot = hit(mesh, new T.Vector3(x, cy - FAR, 0), new T.Vector3(0, 1, 0));
    if (!top || !bot) return null;
    const c = (top.y + bot.y) / 2;
    const side = hit(mesh, new T.Vector3(x, c, FAR), new T.Vector3(0, 0, -1));
    return { ry: (top.y - bot.y) / 2, rz: side ? Math.abs(side.z) : 0, cy: c };
  }
  // the sleeve's own rim, and the hull a hair in FRONT of it (the hull may end
  // behind the rim, so it is never sampled at the sleeve's own station)
  const pedSec = sectionAt(sleeve.m, weldX - 1e-4, axisY);
  const hullSec = sectionAt(hull.m, weldX + eps, axisY);
  const ratioY = (pedSec && hullSec && hullSec.ry > 0) ? pedSec.ry / hullSec.ry : 0;
  const ratioZ = (pedSec && hullSec && hullSec.rz > 0) ? pedSec.rz / hullSec.rz : 0;
  const stepMM = (pedSec && hullSec)
    ? Math.max(pedSec.ry - hullSec.ry, pedSec.rz - hullSec.rz) * sc * 1000 : 0;

  function outline(mesh, x, cy, n) {
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      const o = new T.Vector3(x, cy + Math.sin(a) * FAR, Math.cos(a) * FAR);
      const d = new T.Vector3(0, -Math.sin(a), -Math.cos(a));
      const h = hit(mesh, o, d);
      if (h) pts.push(h.y, h.z);
      else if (pts.length >= 2) pts.push(pts[pts.length - 2], pts[pts.length - 1]);
    }
    return pts;
  }

  const scene = new T.Scene();
  scene.background = new T.Color(0x061824);
  scene.add(new T.HemisphereLight(0xccefff, 0x041019, 1.05));
  const key = new T.DirectionalLight(0xffffff, 1.45); key.position.set(4, 12, 9); scene.add(key);
  const rim = new T.DirectionalLight(0x42c8ff, 0.75); rim.position.set(-9, 5, -8); scene.add(rim);

  const aspect = input.width / input.height;
  const ref = input.referenceStage && input.referenceStage.camera;
  let framedHeight, target, position, up;

  if (subject.kind === "section") {
    // ---- THE DIAGRAM. Two rings, drawn in the y-z plane, seen head-on. ----
    const N = 96;
    const hullPts = outline(hull.m, weldX + eps, axisY, N);
    const pedPts = outline(sleeve.m, weldX - 1e-4, axisY, N);
    function ringMesh(flat, color, width, z) {
      const a = [];
      for (let i = 0; i < flat.length; i += 2) a.push(0, flat[i], flat[i + 1]);
      const geo = new T.BufferGeometry();
      geo.setAttribute("position", new T.Float32BufferAttribute(a, 3));
      const ln = new T.Line(geo, new T.LineBasicMaterial({ color: color, linewidth: width }));
      ln.position.x = z;
      return ln;
    }
    // the BODY as a filled disc, so the tail rim standing outside it is
    // unmistakable rather than a matter of which line is which
    const shape = new T.Shape();
    for (let i = 0; i < hullPts.length; i += 2) {
      if (i === 0) shape.moveTo(hullPts[i + 1], hullPts[i]);
      else shape.lineTo(hullPts[i + 1], hullPts[i]);
    }
    const disc = new T.Mesh(new T.ShapeGeometry(shape),
      new T.MeshBasicMaterial({ color: 0x1d4f6b, side: T.DoubleSide }));
    disc.rotation.y = Math.PI / 2;               // shape's x is world z
    disc.position.x = -0.02;
    scene.add(disc);
    scene.add(ringMesh(hullPts, 0x7fd8ff, 2, 0));
    scene.add(ringMesh(pedPts, input.side === "after" ? 0x7df0b8 : 0xff8f8f, 3, 0.01));

    const r = Math.max(pedSec ? Math.max(pedSec.ry, pedSec.rz) : 1,
      hullSec ? Math.max(hullSec.ry, hullSec.rz) : 1);
    framedHeight = r * 3.2;
    target = [0, axisY, 0];
    position = [weldX + bodyLen, axisY, 0];
    up = [0, 1, 0];
    // the diagram lives at x=0; move the camera onto that axis
    position = [4 * r + 1, axisY, 0];
    scene.add(g);
    g.visible = false;
  } else {
    scene.add(g);
    scene.fog = new T.Fog(0x061824, bodyLen * 6, bodyLen * 16);
    const plan = subject.view === "plan";
    if (subject.kind === "body") {
      framedHeight = bodyLen * 1.24;
      target = [(hull.bb.min.x + hull.bb.max.x) / 2, axisY, 0];
    } else {
      const span = Math.max(bodyLen * 0.10, (weldX - sleeve.bb.min.x) * 1.05);
      framedHeight = span * 1.5;
      target = [weldX - span * 0.18, axisY, 0];
    }
    const d = bodyLen * 8;
    position = plan ? [target[0], axisY + d, 0.0001] : [target[0], axisY, d];
    up = plan ? [0, 0, -1] : [0, 1, 0];
  }

  const framedH = ref ? ref.framedHeight : framedHeight;
  const cameraTarget = ref ? ref.target : target;
  const cameraPosition = ref ? ref.position : position;
  const cameraUp = ref ? ref.up : up;
  const camera = new T.OrthographicCamera(-framedH * aspect / 2, framedH * aspect / 2,
    framedH / 2, -framedH / 2, 0.01, Math.max(400, bodyLen * 40));
  camera.position.fromArray(cameraPosition); camera.up.fromArray(cameraUp);
  camera.lookAt(new T.Vector3().fromArray(cameraTarget)); camera.updateProjectionMatrix();
  studio.renderer.setSize(input.width, input.height, false);
  studio.renderer.render(scene, camera);

  // ---- captions ---------------------------------------------------------
  const after = input.side === "after", overlay = studio.overlay;
  const side = overlay.querySelector("[data-side]");
  side.textContent = after ? input.afterLabel : input.beforeLabel;
  side.style.cssText = `position:absolute;top:23px;left:27px;padding:7px 11px;border-radius:7px;background:${after ? "#187e5a" : "#bd4848"};font-size:12px;font-weight:900;letter-spacing:.12em`;
  const name = overlay.querySelector("[data-name]"); name.textContent = subject.label;
  name.style.cssText = "position:absolute;top:67px;left:28px;font-size:26px;font-weight:850;letter-spacing:-.025em";
  const focus = overlay.querySelector("[data-focus]"); focus.textContent = subject.focus;
  focus.style.cssText = "position:absolute;top:103px;left:29px;color:#c2d5df;font-size:13px;font-weight:550;max-width:790px;line-height:1.35";
  const state = overlay.querySelector("[data-state]"); state.textContent = subject.state;
  state.style.cssText = `position:absolute;right:27px;top:26px;color:${after ? "#7df0b8" : "#ffaaaa"};font-size:11px;font-weight:900;letter-spacing:.1em`;
  const phase = overlay.querySelector("[data-phase]");
  phase.textContent = `tail rim ${pedSec ? pedSec.ry.toFixed(3) + " x " + pedSec.rz.toFixed(3) : "?"}  ·  body ${hullSec ? hullSec.ry.toFixed(3) + " x " + hullSec.rz.toFixed(3) : "?"}`;
  phase.style.cssText = "position:absolute;right:28px;top:54px;color:#d7eef8;font:12px ui-monospace,SFMono-Regular,Menlo,monospace";
  const metric = overlay.querySelector("[data-metric]");
  metric.textContent = `tail/body  ${ratioY.toFixed(2)}x deep · ${ratioZ.toFixed(2)}x wide   ·   step ${stepMM.toFixed(0)} mm`;
  metric.style.cssText = "position:absolute;right:27px;bottom:22px;padding:7px 10px;border-radius:6px;background:rgba(3,18,28,.76);color:#bfeeff;font:11px ui-monospace,SFMono-Regular,Menlo,monospace";
  const source = overlay.querySelector("[data-source]");
  source.textContent = new URL(input.sourceUrl).host + new URL(input.sourceUrl).pathname;
  source.style.cssText = "position:absolute;bottom:22px;left:28px;color:#91aab7;font:11px ui-monospace,SFMono-Regular,Menlo,monospace";

  return {
    ok: true, species: subject.species,
    metrics: {
      weldRatioDeep: Number(ratioY.toFixed(3)),
      weldRatioWide: Number(ratioZ.toFixed(3)),
      weldStepMM: Number(stepMM.toFixed(1)),
    },
    camera: { framedHeight: framedH, position: cameraPosition.slice(), target: cameraTarget.slice(), up: cameraUp.slice() },
  };
}

export default {
  id: "marine-tail-weld",
  title: "The Tail Weld — One Animal, Not A Tube Plugged Into A Body",
  description: "Sixteen matched rest-pose frames. For the orca, the great white, the humpback and the hammerhead: the two circles at the tail joint drawn head-on, the joint from above, the joint from the side, and the whole animal as a control. Nothing animates — this is a geometry bug and it is visible on a still.",
  beforeLabel: "BEFORE — hand-typed sleeve ring",
  afterLabel: "AFTER · SLEEVE MEASURED OFF THE HULL",
  pairNote: "Same species builders · rest pose · identical orthographic camera, light and viewport",
  method: "Each page builds the registered production species with CBZ.WILDLIFE_SPECIES[id].build and renders it at rest — no swim rig, no animator. The hull and the tail sleeve are found geometrically (largest solid; fattest remaining solid behind the body's midpoint), never by name, so the same test runs on both columns. Both cross-sections are measured by firing rays inward at the joint station against the real built mesh: the sleeve at its own front face, the hull a hair in front of it. The runner copies the before camera into the after capture.",
  viewport: { width: 1180, height: 720 },
  readyExpression: "window.THREE && window.CBZ && CBZ.WILDLIFE_SPECIES && CBZ.WILDLIFE_SPECIES.orca && CBZ.WILDLIFE_SPECIES.great_white_shark",
  subjects,
  stage: stageMarineWeld,
  metrics: {
    weldRatioDeep: { label: "Tail sleeve depth ÷ body depth at the joint (1.00 = welded)", unit: "x", better: "lower" },
    weldRatioWide: { label: "Tail sleeve width ÷ body width at the joint (1.00 = welded)", unit: "x", better: "lower" },
    weldStepMM: { label: "How far the tail's rim stands proud of the body's skin", unit: "mm", better: "lower" },
  },
  metricsNote: "1.00x is the whole target: the tail's circle and the body's circle are the same circle. Anything above 1.00 is a tube of the wrong size pushed into the back of the animal, and the step in millimetres is how far that rim sticks out at the species' shipped scale.",
};
