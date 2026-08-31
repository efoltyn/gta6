/* MARINE GIRTH — WHEN IT EATS, ALL OF IT GETS BIGGER.

   OWNER (2026-08-31): "the first shark and maybe all the sharks, when they eat
   things and get bigger, only the body is getting bigger right now. The head
   and tail stay the same, and that makes the body look stupidly big. Make it
   all get bigger proportionally."

   What he was watching is the FED/LEAN BODY CUE (city/wildlife_traits.js): an
   animal that has just eaten swells up to 12% in girth and a starving one
   draws in by the same, and the whole cue used to be a scale on ONE MESH —
   the hull. On a deer that is a belly. On a shark it is a broken weld:
   city/wildlife/aquatic.js solves the rostrum's ring and the tail sleeve's
   front ring against the hull's OWN rings so the three meshes share a rim to
   the millimetre, and fattening only the middle link steps at both ends. It
   also lifted the body, because a mesh scale pivots on the group's y=0, which
   on a shark is under the belly.

   EVERY PAGE IS THE SAME ANIMAL, FED. Each subject builds the production
   species, hands it to the production cue through CBZ.wildlifeTraits.bodyCue
   at hunger 1 (lean) and then hunger 0 (stuffed) — the real code path, not a
   staged scale — and photographs the stuffed body. The numbers under the frame
   are measured off the built meshes by raycast:

     SWELL SPREAD   the fed/lean swell of each piece of the body (hull,
                    rostrum, tail sleeve), max minus min. 0 = the animal grew
                    as one animal. The old cue scored ~27 points on a great
                    white: hull 1.27, rostrum 1.00, sleeve 1.00.
     WELD CORNER    the sharpest corner in the union outline across each
                    joint, in millimetres of the real animal — a taper is a
                    change, a broken weld is a change in the change. This is
                    the ledge the eye actually sees.

   Deliberately NOT a sim page: the cue is a function of one number (hunger)
   and photographing it in a live sea would put a swimming pose, a wave and a
   LOD state between the reader and the thing that changed.

     ba --preset marine-girth --before local
*/

const subjects = [
  {
    id: "gw-side-fed", species: "great_white_shark", kind: "side",
    label: "Great White, Stuffed — The Whole Side",
    focus: "A great white that has just eaten, photographed side-on. The body, the head and the tail are one animal or they are not. BEFORE: the middle of the fish is 12% fatter than the head it is welded to and rides high off it. AFTER: the same 12%, everywhere.",
    state: "HUNGER 0 · FED",
  },
  {
    id: "gw-tail-fed", species: "great_white_shark", kind: "tail",
    label: "Great White, Stuffed — The Tail Weld",
    focus: "The joint the tail wave is carried through. The sleeve's front ring was solved against the hull's last ring; a hull that swells alone leaves the sleeve standing inside a ledge, which reads as a body too big for its own tail.",
    state: "HUNGER 0 · TAIL JOINT",
  },
  {
    id: "gw-head-fed", species: "great_white_shark", kind: "head",
    label: "Great White, Stuffed — The Head Weld",
    focus: "The other end of the same argument, and the one the owner named first. The rostrum reads the rim off the hull at the hull's own last station; a fattened hull steps out past the head and the head becomes a small cone on a fat body.",
    state: "HUNGER 0 · HEAD JOINT",
  },
  {
    id: "gw-side-lean", species: "great_white_shark", kind: "side", hunger: 1,
    label: "Great White, Starving — The Whole Side (Control)",
    focus: "The other end of the range, which has to keep working: a starving shark draws in by the same 12%. If the fix only ever swells, this page is the one that catches it — and the animal still has to read as a great white, not a snake.",
    state: "HUNGER 1 · LEAN",
  },
  {
    id: "meg-side-fed", species: "megalodon", kind: "side",
    label: "Megalodon, Stuffed — The Grammar Check",
    focus: "The apex form is built by the same builder and fed by the same cue. If the fix is in the mechanism rather than in one species, this page is fixed by construction — and on a body this long the old ledge was the size of a person.",
    state: "HUNGER 0 · FED",
  },
  {
    id: "orca-side-fed", species: "orca", kind: "side",
    label: "Orca, Stuffed — A Different Hull, Same Rule",
    focus: "A cetacean, not a shark: its own hull name, its own tail sleeve, the same weld grammar. The cue must not be a shark special case.",
    state: "HUNGER 0 · FED",
  },
];

function stageMarineGirth(input) {
  const T = window.THREE, CBZ = window.CBZ, subject = input.subject;
  if (!T || !CBZ || !CBZ.WILDLIFE_SPECIES || !CBZ.wildlifeTraits) return { ok: false, missing: "engine" };

  // deterministic: ragged rings, pore fields and scars are all drawn from this
  let _s = 0x9e3779b9;
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
      color: key, roughness: 0.62, metalness: 0.02,
    }));
    return materials.get(key);
  }

  const species = CBZ.WILDLIFE_SPECIES[subject.species];
  if (!species || typeof species.build !== "function") return { ok: false, missing: subject.species };
  const g = species.build({ THREE: T, mat: animalMaterial, rng: () => 0.25 });
  const sc = Number(species.scale) || 1;

  /* THE PRODUCTION REST POSE. The authored geometry is not the rest pose —
     CBZ.swimJaw(actor, 0) applies the mouth contract's own restClose — and the
     actor built here is also the one handed to the cue below, so this page is
     driven by exactly what the game drives. */
  const actor = {
    species: species, group: g, pos: g.position, heading: 0, faceH: 0,
    dead: false, hunger: 0.5, _sizeEff: 1,
  };
  if (CBZ.buildSwimRig && CBZ.swimJaw) {
    try { CBZ.buildSwimRig(actor); CBZ.swimJaw(actor, 0); } catch (e) {}
  }

  // ---- the pieces of the body, by name (this is a weld page; the welds have
  //      names, and a geometric guess would blur the two sides of one) -------
  function meshes(test) {
    const out = [];
    g.traverse(function (o) { if (o.isMesh && o.geometry && test(o.name || "")) out.push(o); });
    return out;
  }
  const hull = meshes((n) => /hull$|^mantaCore$/i.test(n));
  /* THE TAIL PIECE HAS TWO NAMES. aquatic.js calls it tailSleeve;
     wildlife_orca.js builds its own and calls it orcaPeduncle, and a matcher
     that knew only the first reported the orca as an animal with no tail —
     which came back as a page where nothing could possibly disagree. */
  const sleeve = meshes((n) => /tailSleeve|Peduncle$/i.test(n));
  const rostrum = meshes((n) => /Rostrum/i.test(n));
  if (!hull.length) return { ok: false, missing: "hull" };

  function refresh() {
    /* BOTH HALVES BY HAND. Matrices are LOD'd off in the live game and
       core/matrixskip.js short-circuits updateMatrixWorld on anything
       invisible; in a studio neither applies, but doing it the safe way here
       means this preset measures the same on a live rig if it is ever pointed
       at one. */
    g.traverse(function (o) { o.updateMatrix(); });
    g.updateWorldMatrix(true, true);
  }
  refresh();

  const rc = new T.Raycaster();
  const _o = new T.Vector3(), _d = new T.Vector3();
  const full = new T.Box3().setFromObject(g);
  const bodyLen = full.max.x - full.min.x;
  const FAR = Math.max(20, bodyLen * 6);
  function shoot(list, ox, oy, oz, dx, dy, dz) {
    _o.set(ox, oy, oz); _d.set(dx, dy, dz).normalize();
    rc.set(_o, _d); rc.near = 0; rc.far = FAR * 2.4;
    const h = rc.intersectObjects(list, false);
    return h.length ? h[0].point : null;
  }
  /* ONE SECTION, AS AN EQUIVALENT CIRCLE. These hulls are jittered up to 7.5%
     on purpose, so a single ray per axis measures the rag and not the animal
     (this is the ragged-hull trap the head-weld preset paid for twice). A fan
     right round the section, and the radius of the circle with its area. */
  const FAN = 28;
  function radiusAt(list, x, cy) {
    let area = 0, ok = 0;
    const dth = (Math.PI * 2) / FAN;
    for (let i = 0; i < FAN; i++) {
      const a = i * dth, sy = Math.sin(a), sz = Math.cos(a);
      const h = shoot(list, x, cy + sy * FAR, sz * FAR, 0, -sy, -sz);
      if (!h) continue;
      const r = Math.hypot(h.y - cy, h.z);
      area += 0.5 * r * r * dth; ok++;
    }
    if (ok < FAN * 0.6) return 0;
    return Math.sqrt(Math.max(0, area) / Math.PI);
  }
  function boxOf(list) {
    const b = new T.Box3();
    for (const m of list) b.expandByObject(m);
    return b;
  }
  function girthOf(list) {          // the y/z size of a piece, as one number
    const b = boxOf(list);
    if (!isFinite(b.max.y) || !isFinite(b.min.y)) return 0;
    return ((b.max.y - b.min.y) + (b.max.z - b.min.z)) / 2;
  }

  const hullBox0 = boxOf(hull);
  const axisY = (hullBox0.min.y + hullBox0.max.y) / 2;
  /* WHERE THE WELDS ARE, MEASURED. The sleeve is buried into the hull's tail
     and the rostrum into its nose, so the station that shows the joint is
     inside the overlap: a quarter of the way into the piece from its own
     buried end. Both meshes answer there, which is what makes a STEP a
     subtraction rather than a guess. */
  function weldX(piece, atFront) {
    if (!piece.length) return null;
    const b = boxOf(piece);
    return atFront ? b.min.x + (b.max.x - b.min.x) * 0.18
      : b.max.x - (b.max.x - b.min.x) * 0.18;
  }
  const tailX = weldX(sleeve, false);
  const headX = weldX(rostrum, true);

  // ---- THE MEASUREMENT: lean, then fed, through the production cue --------
  const TR = CBZ.wildlifeTraits;
  function pose(h) {
    actor.hunger = h; actor._bellyQ = null; actor._girthK = undefined;
    TR.bodyCue(actor);
    refresh();
  }
  /* THE LEDGE, AS A CORNER IN THE ANIMAL'S OWN OUTLINE — and the first draft
     of this page got it wrong in a way worth recording. It subtracted the
     hull's radius from the neighbour's AT one buried station, which is not the
     defect: those two pieces are not supposed to agree there (they agree at
     the RIM; behind it the sleeve is deliberately inside the hull), so the
     subtraction carried a constant that the swell then scaled — and on the
     megalodon, where the sleeve is the wider of the two at that station,
     fattening the hull ALONE made the number smaller. A ledge is a CORNER:
     measure the union outline across the joint and take its largest second
     difference, which is a taper's change of change. */
  const chain = hull.concat(sleeve, rostrum);
  function kinkAt(x0, span) {
    if (x0 == null) return 0;
    const N = 17, r = [];
    for (let i = 0; i < N; i++) r.push(radiusAt(chain, x0 - span + (2 * span * i) / (N - 1), axisY));
    let worst = 0;
    for (let i = 1; i < N - 1; i++) {
      if (!(r[i - 1] > 0) || !(r[i] > 0) || !(r[i + 1] > 0)) continue;
      const k = Math.abs(r[i - 1] - 2 * r[i] + r[i + 1]);
      if (k > worst) worst = k;
    }
    return worst;
  }
  const SPAN = bodyLen * 0.06;
  function sample() {
    return {
      hull: girthOf(hull),
      sleeve: sleeve.length ? girthOf(sleeve) : 0,
      rostrum: rostrum.length ? girthOf(rostrum) : 0,
      kinkTail: sleeve.length ? kinkAt(tailX, SPAN) : 0,
      kinkHead: rostrum.length ? kinkAt(headX, SPAN) : 0,
    };
  }
  pose(1); const lean = sample();
  pose(subject.hunger == null ? 0 : subject.hunger); const shown = sample();
  pose(0); const fed = sample();
  // ..and leave the body in the state this page is photographing
  pose(subject.hunger == null ? 0 : subject.hunger);

  const swell = {};
  let lo = Infinity, hi = -Infinity;
  for (const k of ["hull", "sleeve", "rostrum"]) {
    if (!(lean[k] > 1e-6) || !(fed[k] > 1e-6)) continue;
    const r = fed[k] / lean[k];
    swell[k] = r;
    if (r < lo) lo = r;
    if (r > hi) hi = r;
  }
  const spreadPts = isFinite(hi - lo) ? (hi - lo) * 100 : 0;
  const kinkTailMM = (shown.kinkTail || 0) * sc * 1000;
  const kinkHeadMM = (shown.kinkHead || 0) * sc * 1000;

  // ---- scene -------------------------------------------------------------
  const scene = new T.Scene();
  scene.background = new T.Color(0x08202e);
  scene.add(new T.HemisphereLight(0xccefff, 0x041019, 1.0));
  const key = new T.DirectionalLight(0xffffff, 1.5); key.position.set(6, 11, 9); scene.add(key);
  const rim = new T.DirectionalLight(0x42c8ff, 0.8); rim.position.set(-9, 4, -8); scene.add(rim);
  const fill = new T.DirectionalLight(0xbfe6ff, 0.5); fill.position.set(2, -6, 6); scene.add(fill);
  scene.add(g);

  const aspect = input.width / input.height;
  const ref = input.referenceStage && input.referenceStage.camera;
  /* FRAME BY WIDTH, NOT BY HEIGHT. An orthographic camera is given its
     HEIGHT, and a shark is a long thin thing: the first cut of this page asked
     for 0.46 of the body's length as a height and photographed a wall of skin
     with the animal running out of both sides of the frame. What each page
     needs is a WIDTH — the whole animal, or half a body across a joint — so
     the width is the number chosen here and the height falls out of the
     aspect. */
  let wantWide, target;
  if (subject.kind === "tail") {
    wantWide = bodyLen * 0.62;
    target = [tailX == null ? full.min.x + bodyLen * 0.12 : tailX, axisY, 0];
  } else if (subject.kind === "head") {
    wantWide = bodyLen * 0.62;
    target = [headX == null ? full.max.x - bodyLen * 0.12 : headX, axisY, 0];
  } else {
    wantWide = bodyLen * 1.12;
    target = [(full.min.x + full.max.x) / 2, axisY, 0];
  }
  const framedHeight = wantWide / aspect;
  const position = [target[0], target[1], bodyLen * 8];

  const framedH = ref ? ref.framedHeight : framedHeight;
  const cameraTarget = ref ? ref.target : target;
  const cameraPosition = ref ? ref.position : position;
  const cameraUp = ref ? ref.up : [0, 1, 0];
  const camera = new T.OrthographicCamera(-framedH * aspect / 2, framedH * aspect / 2,
    framedH / 2, -framedH / 2, 0.01, Math.max(400, bodyLen * 40));
  camera.position.fromArray(cameraPosition); camera.up.fromArray(cameraUp);
  camera.lookAt(new T.Vector3().fromArray(cameraTarget)); camera.updateProjectionMatrix();
  studio.renderer.setSize(input.width, input.height, false);
  studio.renderer.render(scene, camera);

  // ---- overlay -----------------------------------------------------------
  const after = input.side === "after";
  const overlay = studio.overlay;
  const side = overlay.querySelector("[data-side]");
  side.textContent = after ? "AFTER" : "BEFORE";
  side.style.cssText = `position:absolute;top:24px;left:28px;padding:5px 12px;border-radius:999px;font-size:12px;font-weight:800;letter-spacing:.14em;background:${after ? "rgba(46,204,113,.22)" : "rgba(231,76,60,.22)"};color:${after ? "#7df0b8" : "#ffb3ab"}`;
  const name = overlay.querySelector("[data-name]"); name.textContent = subject.label;
  name.style.cssText = "position:absolute;top:67px;left:28px;font-size:26px;font-weight:850;letter-spacing:-.025em";
  const focus = overlay.querySelector("[data-focus]"); focus.textContent = subject.focus;
  focus.style.cssText = "position:absolute;top:103px;left:29px;color:#c2d5df;font-size:13px;font-weight:550;max-width:820px;line-height:1.35";
  const state = overlay.querySelector("[data-state]"); state.textContent = subject.state;
  state.style.cssText = `position:absolute;right:27px;top:26px;color:${after ? "#7df0b8" : "#ffaaaa"};font-size:11px;font-weight:900;letter-spacing:.1em`;
  const phase = overlay.querySelector("[data-phase]");
  phase.textContent = "swell  " + ["hull", "rostrum", "sleeve"].filter((k) => swell[k])
    .map((k) => k + " " + swell[k].toFixed(3)).join("   ");
  phase.style.cssText = "position:absolute;right:28px;top:54px;color:#d7eef8;font:12px ui-monospace,SFMono-Regular,Menlo,monospace";
  const metric = overlay.querySelector("[data-metric]");
  metric.textContent = "spread " + spreadPts.toFixed(1) + " pts   ·   weld corner  tail " +
    kinkTailMM.toFixed(0) + " mm  head " + kinkHeadMM.toFixed(0) + " mm";
  metric.style.cssText = "position:absolute;right:27px;bottom:22px;padding:7px 10px;border-radius:6px;background:rgba(3,18,28,.76);color:#bfeeff;font:11px ui-monospace,SFMono-Regular,Menlo,monospace";
  const source = overlay.querySelector("[data-source]");
  source.textContent = new URL(input.sourceUrl).host + new URL(input.sourceUrl).pathname;
  source.style.cssText = "position:absolute;bottom:22px;left:28px;color:#91aab7;font:11px ui-monospace,SFMono-Regular,Menlo,monospace";

  return {
    ok: true, species: subject.species,
    bodyLenM: Number((bodyLen * sc).toFixed(2)),
    swell: Object.keys(swell).map((k) => [k, Number(swell[k].toFixed(4))]),
    /* ONE PAGE OWNS EACH CLAIM. None of these numbers depends on the camera,
       so reporting all of them on all six pages multiplied one result by six
       and buried the page that is actually about it. The side pages carry the
       swell, each joint page carries its own joint, and girthYZ — the
       mechanism, not a result — rides along everywhere without a direction,
       because on the starving page it is correctly BELOW 1 and a gate that
       called that a regression would be reading the wrong sentence. */
    metrics: Object.assign(
      { girthYZ: Number(((g.scale.y + g.scale.z) / 2).toFixed(4)) },
      subject.kind === "side" ? { swellSpreadPts: Number(spreadPts.toFixed(2)) } : {},
      subject.kind === "tail" ? { weldCornerTailMM: Number(kinkTailMM.toFixed(1)) } : {},
      subject.kind === "head" ? { weldCornerHeadMM: Number(kinkHeadMM.toFixed(1)) } : {}),
    camera: { framedHeight: framedH, position: cameraPosition.slice(), target: cameraTarget.slice(), up: cameraUp.slice() },
  };
}

export default {
  id: "marine-girth",
  title: "Marine Girth — When It Eats, All Of It Gets Bigger",
  description: "Six matched frames of marine animals at the ends of the fed/lean range, driven through the production body cue. A shark that had just eaten used to swell in the middle only: the hull went up 12% in girth and rode up off the head and tail it is welded to, which is what made the body look stupidly big. The swell is now the whole animal's.",
  beforeLabel: "BEFORE — only the middle swelled",
  afterLabel: "AFTER · ONE ANIMAL, ONE SWELL",
  pairNote: "Same species builders · production rest pose · production cue · identical orthographic camera, light and viewport",
  method: "Each page builds the registered production species with CBZ.WILDLIFE_SPECIES[id].build, poses it with CBZ.buildSwimRig/CBZ.swimJaw, then drives the REAL cue — CBZ.wildlifeTraits.bodyCue on an actor at hunger 1 and hunger 0 — and photographs the state the subject asks for. Every number is measured off the built meshes: piece swell from the y/z size of the hull, the rostrum and the tail sleeve at each end of the range, and the weld step from a 28-ray fan fired at a station inside each joint's overlap, reported as the equivalent-circle radius the two pieces disagree by (in millimetres of the real animal, species scale applied).",
  viewport: { width: 1180, height: 720 },
  readyExpression: "window.THREE && window.CBZ && CBZ.wildlifeTraits && CBZ.WILDLIFE_SPECIES && CBZ.WILDLIFE_SPECIES.great_white_shark && CBZ.WILDLIFE_SPECIES.megalodon && CBZ.WILDLIFE_SPECIES.orca",
  subjects,
  stage: stageMarineGirth,
  metricsWhitelist: true,
  metrics: {
    swellSpreadPts: { label: "Disagreement between the body's pieces about how much they grew (hull vs rostrum vs tail sleeve)", unit: "pts", better: "lower" },
    weldCornerTailMM: { label: "Sharpest corner in the outline across the tail weld, on a stuffed animal", unit: "mm", better: "lower" },
    weldCornerHeadMM: { label: "Sharpest corner in the outline across the head weld, on a stuffed animal", unit: "mm", better: "lower" },
    girthYZ: { label: "The girth the group itself carries (1.00 = the cue never reached the whole body; a lean animal's is below 1 and that is correct)" },
  },
  metricsNote: "swellSpreadPts is the owner's sentence as a number: it is the difference between how much the body grew and how much the head and tail grew, so 0 IS 'proportionally'. The weld corners are what that difference looks like from a boat — the sharpest bend in the outline where the hull ends and the next piece begins, in millimetres of the real fish; a taper is a change, a broken weld is a change IN the change. girthYZ is reported because it is the mechanism, not a result: the cue used to live on one mesh and the group never moved off 1.00, which is precisely why the head and tail could not follow. It is not comparable BETWEEN the fed and lean pages (a lean animal's is below 1), only between the columns of the same page.",
};
