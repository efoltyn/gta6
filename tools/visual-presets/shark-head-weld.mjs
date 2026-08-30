/* THE HEAD WELD — the shark's head is the front of the animal, not a cone
   plugged into it.

   OWNER (2026-08-30), with three photographs of a live great white on the
   table: "the head of the great white — like the tail, the former issue we
   had — the head meets the body and the head is less wide in diameter than
   the body where the geometry meets, and that should be fixed and streamlined
   like the tail was. And make the mouth front and the front of the face look
   better: more detail where it belongs, remove the extra things, get the
   shapes right."

   This is the tail weld's twin (tools/visual-presets/marine-tail-weld.mjs) at
   the other end of the animal. A shark in this game is a rigid hull plus
   separately authored shells pushed into it — a lifting ROSTRUM at the front
   the way there is a tapered SLEEVE at the back — and the same defect class
   applies: the shell's rings were typed, the hull's rings were typed, and
   nothing measured one against the other. What the eye reads is not a number:
   it is a SHOULDER in the outline where the head stops being the head.

   So every page is a REST POSE and the subject is the outline itself. The
   whole silhouette is measured by firing rays inward against the real built
   meshes — hull and shells together, fins excluded — at 40 stations from the
   nose to the widest part of the body, and the numbers under each frame come
   off that union, never off a ring table.

   In the photographs the owner supplied, three things are true of a real
   great white's head and were not true of this one:
     1. THE HEAD IS WIDE. Head-on, the head at the mouth corners is most of
        the width of the animal; the widest section is behind the gills and
        the run between them is one unbroken curve.
     2. THE SNOUT IS A CONE, not a dome — it narrows continuously to a blunt
        point, and the only break in the line is the mouth itself.
     3. THE FACE IS SMOOTH. What detail there is (the eye, the nostril, the
        pore field, the gill slits) sits ON that curve; nothing floats.
*/

const HERO = "great_white_shark";

const subjects = [
  {
    id: "gw-face", kind: "face", species: HERO,
    label: "Great White — Head-On, Mouth Closed",
    focus: "The owner's second photograph. A real great white seen head-on is WIDE: the head at the mouth corners carries most of the animal's beam, and the snout narrows out of it as a cone. Watch the outline where the head meets the shoulders — a shoulder, a step or a waist there is the bug.",
    state: "REST · FACE", metric: "Head width as a share of the body's widest",
  },
  {
    id: "gw-face-open", kind: "face", species: HERO, open: 0.9,
    label: "Great White — Head-On, Mouth Open",
    focus: "The owner's first photograph: the gape from in front. The mouth should be a broad arc across the width of the head with the teeth standing on the jaw line, not a small hole in a narrow face.",
    state: "FULL GAPE · FACE", metric: "Mouth width against head width",
  },
  {
    id: "gw-plan", kind: "plan", species: HERO,
    label: "Great White — Head And Shoulders From Above",
    focus: "The plan view is where a head weld fails: follow the skin line forward out of the body's widest section into the snout. It should be one continuous curve. A step, a flat, or a pinch behind the head is the animal reading as two objects.",
    state: "REST · PLAN", metric: "Largest break in the outline, nose to widest section",
  },
  {
    id: "gw-profile", kind: "profile", species: HERO,
    label: "Great White — Head And Shoulders From The Side",
    focus: "The same run in the vertical plane: the crown line from the nose over the head and into the back. The third photograph is this view — one long curve, no dome sitting on a body.",
    state: "REST · PROFILE", metric: "Largest break in the crown line",
  },
  {
    id: "gw-quarter", kind: "quarter", species: HERO,
    label: "Great White — Three-Quarter Head",
    focus: "The photograph the owner sent third. This is the view that makes a head-body step unmistakable, because both the width transition and the crown line are in frame at once — and it is the one anybody actually sees in the game.",
    state: "REST · THREE-QUARTER", metric: "Head girth vs body girth",
  },
  {
    id: "gw-mouth-front", kind: "mouth", species: HERO,
    probe: [[0.663, 0.462], [0.69, 0.33], [0.70, 0.59], [0.655, 0.36]],
    label: "Great White — The Front Of The Mouth, Closed",
    focus: "Owner: \"there are too many pieces on the front of the great white's mouth — it looks like white chunks all over, poorly streamlined.\" This is that view. A closed shark mouth is skin, one crease, and the tips of the teeth; anything else in this frame is a piece that should not be there.",
    state: "REST · MOUTH FRONT", metric: "How many separate pale pieces the jaw is made of",
  },
  {
    id: "gw-mouth-parts", kind: "mouth", species: HERO, parts: true,
    probe: [[0.663, 0.462], [0.69, 0.33], [0.70, 0.59], [0.655, 0.36]],
    label: "Great White — The Same Mouth, One Colour Per Piece",
    focus: "The diagnostic that names them. Every mesh in its own flat colour at the identical camera: this is how you tell a lip from a gum from a liner from a sack, and how many of them are stacked on the same square centimetre of jaw.",
    state: "PART MAP · MOUTH FRONT", metric: "One colour per mesh",
  },
  {
    id: "gw-parts", kind: "parts", species: HERO,
    label: "Great White — What Every Piece Of The Head Is",
    focus: "A diagnostic: each mesh in its own flat colour, same camera as the three-quarter page. This is how the white slabs in the gape stopped being a mystery.",
    state: "PART MAP", metric: "One colour per mesh",
  },
  {
    id: "gw-body", kind: "body", species: HERO,
    label: "Great White — The Whole Animal (Control)",
    focus: "The control. A head fix that widens the head into a bulge, or that thins the body to meet it, is a different bug — the whole silhouette has to stay a great white.",
    state: "REST · WHOLE BODY", metric: "The whole outline",
  },
  {
    id: "meg-face", kind: "face", species: "megalodon",
    label: "Megalodon — Head-On (Shared Grammar)",
    focus: "The apex form inherits the head from the same builder. If the fix is in the grammar rather than in one species' ring table, this face is fixed by construction.",
    state: "REST · FACE", metric: "Head width as a share of the body's widest",
  },
  {
    id: "bull-plan", kind: "plan", species: "bull_shark",
    label: "Bull Shark — Head And Shoulders From Above",
    focus: "The blunt inshore shark, whose head is genuinely broad and short. Its outline has to survive the same rule without becoming a great white.",
    state: "REST · PLAN", metric: "Largest break in the outline",
  },
];

function stageSharkHead(input) {
  const T = window.THREE, CBZ = window.CBZ, subject = input.subject;
  if (!T || !CBZ || !CBZ.WILDLIFE_SPECIES) return { ok: false, missing: "engine" };

  // deterministic: every ragged ring and pore field is drawn from this
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

  // POSE IT WITH THE PRODUCTION RIG when a gape is asked for, so an open mouth
  // on this page is the same open mouth the game shows.
  /* EVERY PAGE IS RIGGED, INCLUDING THE CLOSED ONES — and this was a real
     staging error. The authored geometry is not the rest pose: production
     CBZ.swimJaw(actor, 0) applies the contract's own restClose on top of it,
     so a page that skipped the rig photographed a mouth STANDING OPEN by that
     margin and reported its exposed gums and interior as the animal. Build the
     rig on every subject and drive it to the gape the page asks for. */
  let actor = null;
  if (CBZ.buildSwimRig && CBZ.swimJaw) {
    actor = { species: species, group: g, pos: g.position, heading: 0, faceH: 0, dead: false };
    try { CBZ.buildSwimRig(actor); CBZ.swimJaw(actor, Number(subject.open) || 0); } catch (e) { actor = null; }
  }
  g.updateMatrixWorld(true);

  /* ---- WHAT COUNTS AS THE BODY ------------------------------------------
     The silhouette this preset is about is the ANIMAL's, not the fins'. The
     hull is the largest solid; a shell (rostrum, chin, jaw) is anything else
     that is fat on BOTH cross-axes. A fin is a blade and fails that test on
     its thin axis; a pore, a tooth or a scar is too small to reach it. Named
     nothing, so the identical test runs on both columns and on a species
     whose parts were never named at all. */
  function boxOf(m) {
    if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
    return new T.Box3().copy(m.geometry.boundingBox).applyMatrix4(m.matrixWorld);
  }
  const solids = [];
  let hull = null, hv = -1;
  g.traverse(function (o) {
    if (!o.isMesh || !o.geometry || !o.geometry.attributes) return;
    const bb = boxOf(o), d = bb.getSize(new T.Vector3());
    const v = d.x * d.y * d.z;
    solids.push({ m: o, bb: bb, d: d, v: v });
    if (v > hv) { hv = v; hull = solids[solids.length - 1]; }
  });
  if (!hull) return { ok: false, missing: "meshes" };
  const bodyLen = hull.bb.max.x - hull.bb.min.x;
  /* A FIN IS NOT THE ANIMAL, AND IT IS FOUND BY WHERE IT SITS. A pectoral
     passes any "is it fat" test — it is long and broad — but it hangs off ONE
     side, so its box is centred metres off the axis. Anything centred on the
     axis is the body (hull, rostrum, chin, throat, sack); anything that is not
     is a limb. Caught by measuring: the pectorals were in the silhouette and
     the animal's "widest section" was a fin. */
  const body = [];
  for (const s of solids) {
    if (s === hull) { body.push(s.m); continue; }
    const cz = (s.bb.min.z + s.bb.max.z) / 2;
    if (Math.abs(cz) > bodyLen * 0.06) continue;
    if (Math.min(s.d.y, s.d.z) > bodyLen * 0.06 && s.d.x > bodyLen * 0.04) body.push(s.m);
  }
  const axisY = (hull.bb.min.y + hull.bb.max.y) / 2;

  // ---- measure the union silhouette by raycast ---------------------------
  const rc = new T.Raycaster();
  const FAR = Math.max(20, bodyLen * 6);
  const _o = new T.Vector3(), _d = new T.Vector3();
  function shoot(ox, oy, oz, dx, dy, dz) {
    _o.set(ox, oy, oz); _d.set(dx, dy, dz).normalize();
    rc.set(_o, _d); rc.near = 0; rc.far = FAR * 2.4;
    const h = rc.intersectObjects(body, false);
    return h.length ? h[0].point.clone() : null;
  }
  /* ONE STATION, MEASURED THE WAY A GIRTH IS MEASURED — and this is the trap
     that cost this preset its first two runs. These hulls are deliberately
     RAGGED (the great white's rings are jittered 7.5%), so a single ray per
     axis samples that jitter and not the animal: the outline came back with
     8% steps in it that were noise, on both columns, swamping the joint the
     page exists to look at. So every station fires a fan of rays right round
     the section and reports its EQUIVALENT-CIRCLE radius — the radius of a
     circle with the section's own area — plus width and depth averaged over
     the four rays nearest each axis. Jitter and polygon flats average out;
     a step, a corner or a waist does not. */
  const FAN = 28;
  function station(x) {
    const top = shoot(x, axisY + FAR, 0, 0, -1, 0);
    const bot = shoot(x, axisY - FAR, 0, 0, 1, 0);
    if (!top || !bot) return null;
    const cy = (top.y + bot.y) / 2;
    let area = 0, wSum = 0, wN = 0, hSum = 0, hN = 0, ok = 0;
    const dth = (Math.PI * 2) / FAN;
    for (let i = 0; i < FAN; i++) {
      const a = i * dth;
      const sy = Math.sin(a), sz = Math.cos(a);
      const h = shoot(x, cy + sy * FAR, sz * FAR, 0, -sy, -sz);
      if (!h) continue;
      const dy = h.y - cy, dz = h.z;
      const r = Math.hypot(dy, dz);
      area += 0.5 * r * r * dth; ok++;
      const c = Math.abs(sz);                     // 1 on the horizontal axis
      if (c > 0.86) { wSum += Math.abs(dz); wN++; }
      if (c < 0.51) { hSum += Math.abs(dy); hN++; }
    }
    if (ok < FAN * 0.7) return null;
    return {
      x: x, cy: cy,
      rz: wN ? wSum / wN : 0,
      ry: hN ? hSum / hN : 0,
      r: Math.sqrt(Math.max(0, area) / Math.PI),
    };
  }

  const N = 44;
  const noseX = hull.bb.max.x;
  let frontX = noseX;
  for (const s of solids) if (s.bb.max.x > frontX) frontX = s.bb.max.x;
  const prof = [];
  for (let i = 0; i <= N; i++) {
    const x = frontX - (i / N) * bodyLen * 0.62;      // nose back through the shoulders
    const s = station(x);
    if (s) prof.push(s);
  }
  if (prof.length < 8) return { ok: false, missing: "silhouette" };

  let maxRy = 0, maxRz = 0, maxRzX = prof[0].x;
  for (const s of prof) {
    if (s.ry > maxRy) maxRy = s.ry;
    if (s.rz > maxRz) { maxRz = s.rz; maxRzX = s.x; }
  }
  /* THE BREAK IN THE LINE, and it is a second difference, not a step.
     A taper is a change; a WELD FAILURE is a change in the change — a corner.
     Sampled evenly, the second difference of the outline is proportional to
     its curvature, so the largest one is the sharpest corner anywhere between
     the nose and the widest section. Reported in millimetres of the real
     animal (species scale applied), so it is a length a person can picture. */
  /* THE WINDOW. Forward of the jaw the sections stop being the whole animal —
     the chin ends behind the nose, so the depth genuinely halves there — and
     that anatomy would otherwise be reported as the sharpest corner on the
     fish. Judge the run from the widest section forward to the base of the
     snout cone, which is where a weld can even exist. */
  const winFront = frontX - bodyLen * 0.13;
  function inWindow(s2) { return s2.x <= winFront && s2.x >= maxRzX; }
  function kink(key) {
    let worst = 0;
    for (let i = 1; i < prof.length - 1; i++) {
      if (!inWindow(prof[i])) continue;
      const k = Math.abs(prof[i - 1][key] - 2 * prof[i][key] + prof[i + 1][key]);
      if (k > worst) worst = k;
    }
    return worst * sc * 1000;
  }
  /* AND A WAIST IS ITS OWN FAILURE. Walking BACK from the nose the outline
     must never get narrower again before it reaches the widest section: a dip
     and a recovery is a neck, and a neck is exactly "the head is thinner than
     the body where they meet". Measured as the deepest such dip. */
  function waist(key) {
    let run = 0, worst = 0;
    for (let i = 1; i < prof.length; i++) {
      if (prof[i].x > maxRzX) {
        const drop = prof[i - 1][key] - prof[i][key];
        if (drop > 0) run += drop; else { if (run > worst) worst = run; run = 0; }
      }
    }
    if (run > worst) worst = run;
    return worst * sc * 1000;
  }

  // the head's own station: where the eye sits on a shark, a fifth of the
  // body back from the nose — measured, not authored
  const headX = frontX - bodyLen * 0.16;
  const headSec = station(headX) || prof[0];
  const headWidthPct = maxRz > 0 ? (headSec.rz / maxRz) * 100 : 0;
  const headDeepPct = maxRy > 0 ? (headSec.ry / maxRy) * 100 : 0;

  /* PART MAP — a diagnostic page. Every mesh in the head gets its own flat
     colour so a blob in the gape can be NAMED. Kept in the preset (rather
     than done by hand in a console) because the next person to look at this
     mouth will want it too. */
  // 20 hues, because at 10 the palette WRAPPED and two different pieces in
  // the same square centimetre of jaw came back the same colour — which is
  // exactly the question this page exists to answer.
  const PART_HUES = ["#ff5f5f", "#ffd23f", "#4ad991", "#5aa9ff", "#c77dff", "#ff9f45", "#3ddad7", "#ff6fb5",
    "#b6ff3d", "#8f8fff", "#d94a4a", "#a37b00", "#0f8f5a", "#0b4ea8", "#6a1fb0", "#8a4b00", "#0d7a78",
    "#a8005c", "#5f8f00", "#3a3aa8"];
  let partLegend = "";
  if (subject.parts || subject.kind === "parts") {
    let n = 0;
    const seen = new Map();
    g.traverse(function (o) {
      if (!o.isMesh) return;
      const nm = o.name || "(unnamed)";
      if (!seen.has(nm)) { seen.set(nm, PART_HUES[n % PART_HUES.length]); n++; }
      o.material = new T.MeshBasicMaterial({ color: seen.get(nm) });
    });
    partLegend = Array.from(seen.entries()).map(function (e) { return e[0] + "=" + e[1]; }).join("  ");
  }

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
  const headSpan = bodyLen * 0.42;
  let framedHeight, target, position, up;
  if (subject.kind === "face") {
    framedHeight = maxRy * 3.0;
    target = [headX, headSec.cy, 0];
    position = [frontX + bodyLen * 3, headSec.cy, 0];
    up = [0, 1, 0];
  } else if (subject.kind === "plan") {
    framedHeight = headSpan * 1.30;
    target = [frontX - headSpan * 0.42, axisY, 0];
    position = [target[0], axisY + bodyLen * 8, 0.0001];
    up = [0, 0, -1];
  } else if (subject.kind === "profile") {
    framedHeight = headSpan * 0.92;
    target = [frontX - headSpan * 0.42, headSec.cy, 0];
    position = [target[0], headSec.cy, bodyLen * 8];
    up = [0, 1, 0];
  } else if (subject.kind === "mouth") {
    /* THE FRONT OF THE MOUTH, from where a diver sees it: low, close, and off
       the centreline, which is the angle every one of the owner's photographs
       is taken from and the one that shows whether the jaw is one surface or
       a pile of pieces. */
    framedHeight = headSpan * 0.42;
    target = [frontX - headSpan * 0.30, headSec.cy - maxRy * 0.42, 0];
    position = [target[0] + bodyLen * 1.1, target[1] - bodyLen * 0.22, bodyLen * 1.05];
    up = [0, 1, 0];
  } else if (subject.kind === "quarter" || subject.kind === "parts") {
    framedHeight = headSpan * 1.05;
    target = [frontX - headSpan * 0.38, headSec.cy, 0];
    position = [target[0] + bodyLen * 1.9, headSec.cy + bodyLen * 0.55, bodyLen * 1.5];
    up = [0, 1, 0];
  } else {
    framedHeight = bodyLen * 0.74;
    target = [(hull.bb.min.x + hull.bb.max.x) / 2, axisY, 0];
    position = [target[0], axisY, bodyLen * 8];
    up = [0, 1, 0];
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

  /* HOW MANY PIECES IS THIS MOUTH MADE OF — the owner's sentence, counted.
     A grid of rays through the frame, each one asking the scene which mesh it
     landed on: `mouthPieces` is how many DIFFERENT meshes hold more than half
     a per cent of the picture, and `cavityPct` is how much of a CLOSED mouth
     is interior — buccal sack, throat, mandible liner — which should be none
     of it, because those parts are inside the animal. Both are read off the
     same rendered geometry on both columns, so neither can be argued with. */
  let mouthPieces = null, cavityPct = null;
  if (subject.kind === "mouth" && subject.open == null) {
    const pr2 = new T.Raycaster();
    const seen = {}, GX = 48, GY = 30;
    let hits = 0, cav = 0;
    for (let iy = 0; iy < GY; iy++) {
      for (let ix = 0; ix < GX; ix++) {
        pr2.setFromCamera({ x: ((ix + 0.5) / GX) * 2 - 1, y: 1 - ((iy + 0.5) / GY) * 2 }, camera);
        const h2 = pr2.intersectObject(g, true);
        if (!h2.length) continue;
        hits++;
        const nm = h2[0].object.name || "(unnamed)";
        seen[nm] = (seen[nm] || 0) + 1;
        if (/Sack|Throat|Liner/.test(nm)) cav++;
      }
    }
    let n = 0;
    for (const nm in seen) if (seen[nm] > hits * 0.005) n++;
    mouthPieces = n;
    cavityPct = hits ? (cav / hits) * 100 : 0;
  }

  /* ASK THE PICTURE WHAT IT IS SHOWING. A part map tells you the pieces are
     there; it does not tell you which one is the dark arch at pixel (790,350),
     and guessing cost this wave three capture cycles. `probe` fires a ray from
     the camera through named screen points and reports the first mesh it hits,
     which is the same question a person asks by pointing at the frame. */
  let probed = "";
  if (subject.probe && subject.probe.length) {
    const pr = new T.Raycaster();
    probed = subject.probe.map(function (pt) {
      pr.setFromCamera({ x: pt[0] * 2 - 1, y: 1 - pt[1] * 2 }, camera);
      const hit = pr.intersectObject(g, true);
      if (!hit.length) return "(" + pt[0].toFixed(2) + "," + pt[1].toFixed(2) + ")=(nothing)";
      const h0 = hit[0];
      const mi = h0.face && h0.face.materialIndex != null ? h0.face.materialIndex : -1;
      return "(" + pt[0].toFixed(2) + "," + pt[1].toFixed(2) + ")=" + (h0.object.name || "(unnamed)")
        + "#g" + mi + "@" + h0.point.x.toFixed(2) + "," + h0.point.y.toFixed(2) + "," + h0.point.z.toFixed(2);
    }).join("  ");
  }

  // ---- captions ----------------------------------------------------------
  const after = input.side === "after", overlay = studio.overlay;
  const side = overlay.querySelector("[data-side]");
  side.textContent = after ? input.afterLabel : input.beforeLabel;
  side.style.cssText = `position:absolute;top:23px;left:27px;padding:7px 11px;border-radius:7px;background:${after ? "#187e5a" : "#bd4848"};font-size:12px;font-weight:900;letter-spacing:.12em`;
  const name = overlay.querySelector("[data-name]"); name.textContent = subject.label;
  name.style.cssText = "position:absolute;top:67px;left:28px;font-size:26px;font-weight:850;letter-spacing:-.025em";
  const focus = overlay.querySelector("[data-focus]"); focus.textContent = subject.focus;
  focus.style.cssText = "position:absolute;top:103px;left:29px;color:#c2d5df;font-size:13px;font-weight:550;max-width:800px;line-height:1.35";
  const state = overlay.querySelector("[data-state]"); state.textContent = subject.state;
  state.style.cssText = `position:absolute;right:27px;top:26px;color:${after ? "#7df0b8" : "#ffaaaa"};font-size:11px;font-weight:900;letter-spacing:.1em`;
  const phase = overlay.querySelector("[data-phase]");
  phase.textContent = `head ${headSec.rz.toFixed(3)} wide x ${headSec.ry.toFixed(3)} deep  ·  body ${maxRz.toFixed(3)} x ${maxRy.toFixed(3)}`;
  phase.style.cssText = "position:absolute;right:28px;top:54px;color:#d7eef8;font:12px ui-monospace,SFMono-Regular,Menlo,monospace";
  const metric = overlay.querySelector("[data-metric]");
  metric.textContent = probed || partLegend || `head ${headWidthPct.toFixed(0)}% of the body's width · girth kink ${kink("r").toFixed(0)} mm · waist ${waist("r").toFixed(0)} mm`;
  metric.style.cssText = "position:absolute;right:27px;bottom:22px;padding:7px 10px;border-radius:6px;background:rgba(3,18,28,.76);color:#bfeeff;font:11px ui-monospace,SFMono-Regular,Menlo,monospace";
  const source = overlay.querySelector("[data-source]");
  source.textContent = new URL(input.sourceUrl).host + new URL(input.sourceUrl).pathname;
  source.style.cssText = "position:absolute;bottom:22px;left:28px;color:#91aab7;font:11px ui-monospace,SFMono-Regular,Menlo,monospace";

  /* THE OPEN MOUTH IS NOT AN OUTLINE PAGE. A dropped jaw is a real break in
     the silhouette — that is what opening a mouth means — so the weld numbers
     are reported only from the rest pose, and this page is judged by eye and
     by the head's own width. */
  const shape = subject.open == null ? {
    girthKinkMM: Number(kink("r").toFixed(1)),
    planKinkMM: Number(kink("rz").toFixed(1)),
    crownKinkMM: Number(kink("ry").toFixed(1)),
    girthWaistMM: Number(waist("r").toFixed(1)),
  } : {};
  return {
    ok: true, species: subject.species,
    bodyLenM: Number((bodyLen * sc).toFixed(2)),
    parts: body.map(function (mm) {
      const bb = new T.Box3().setFromObject(mm);
      return [mm.name || "(unnamed)", Number(bb.min.x.toFixed(2)), Number(bb.max.x.toFixed(2)),
        Number(bb.max.z.toFixed(3)), Number(bb.max.y.toFixed(2))];
    }),
    outline: prof.map(function (s2) {
      return [Number(s2.x.toFixed(3)), Number(s2.rz.toFixed(3)), Number(s2.ry.toFixed(3)), Number(s2.r.toFixed(3))];
    }),
    /* ONE PAGE OWNS EACH CLAIM. The shape numbers describe the animal, not
       the camera, so reporting them on all eleven pages multiplied every
       sub-millimetre wobble by eleven and buried the page that actually moved.
       The outline pages carry the outline; the mouth pages carry the mouth. */
    metrics: mouthPieces != null ? {
      mouthPieces: mouthPieces,
      cavityPct: Number(cavityPct.toFixed(2)),
    } : (subject.kind === "plan" || subject.kind === "profile" || subject.kind === "body"
      ? Object.assign({
        headWidthPct: Number(headWidthPct.toFixed(1)),
        headDeepPct: Number(headDeepPct.toFixed(1)),
        headFlatPct: Number((headSec.ry > 0 ? (headSec.rz / headSec.ry) * 100 : 0).toFixed(1)),
      }, shape)
      : {}),
    camera: { framedHeight: framedH, position: cameraPosition.slice(), target: cameraTarget.slice(), up: cameraUp.slice() },
  };
}

export default {
  id: "shark-head-weld",
  title: "The Head Weld — One Animal At The Front End Too",
  description: "Eight matched rest-pose frames of the great white's head (plus the megalodon and the bull shark as grammar checks): head-on with the mouth closed and open, the head and shoulders from above and from the side, the three-quarter view anybody actually sees in game, and the whole animal as a control. The head was narrower than the body it grows out of and stepped into it; the outline from the nose to the widest section is now one curve.",
  beforeLabel: "BEFORE — head stepped into the body",
  afterLabel: "AFTER · ONE CURVE, NOSE TO SHOULDERS",
  pairNote: "Same species builders · rest pose · identical orthographic camera, light and viewport",
  method: "Each page builds the registered production species with CBZ.WILDLIFE_SPECIES[id].build and renders it at rest (the open-mouth page poses it through production CBZ.buildSwimRig / CBZ.swimJaw). The hull and its shells are found geometrically — largest solid, plus anything fat on both cross-axes, so fins and pores are excluded and nothing is found by name — and the silhouette is measured by firing rays inward against those real meshes at 44 stations from the nose back through the widest section. Every number under every frame comes off that union. The runner copies the before camera into the after capture.",
  viewport: { width: 1180, height: 720 },
  readyExpression: "window.THREE && window.CBZ && CBZ.WILDLIFE_SPECIES && CBZ.WILDLIFE_SPECIES.great_white_shark && CBZ.WILDLIFE_SPECIES.megalodon && CBZ.WILDLIFE_SPECIES.bull_shark",
  subjects,
  stage: stageSharkHead,
  metricsWhitelist: true,
  metrics: {
    headWidthPct: { label: "Head width at the eye, as a share of the body's widest section", unit: "%", better: "higher" },
    headDeepPct: { label: "Head depth at the eye, as a share of the body's deepest section", unit: "%", better: "higher" },
    girthKinkMM: { label: "Sharpest corner in the animal's girth, nose to shoulders", unit: "mm", better: "lower" },
    planKinkMM: { label: "Sharpest corner in the outline from above, nose to shoulders", unit: "mm", better: "lower" },
    crownKinkMM: { label: "Sharpest corner in the crown line", unit: "mm", better: "lower" },
    girthWaistMM: { label: "Deepest pinch in the girth behind the head (a neck)", unit: "mm", better: "lower" },
    headFlatPct: { label: "Head width against its own depth (a great white's head is a wedge, not a ball)", unit: "%", better: "higher" },
    mouthPieces: { label: "Separate pieces visible in the closed mouth frame", better: "lower" },
    cavityPct: { label: "Share of a CLOSED mouth that is mouth INTERIOR showing through", unit: "%", better: "lower" },
  },
  metricsNote: "The pinch is reported on the GIRTH and not on the width alone, and that is a measurement decision worth writing down: this animal wears rake scars that stand four millimetres off its flank, so a width read from four rays picks a scar as the widest thing on the shark and calls the skin behind it a waist. The girth is the equivalent-circle radius of a twenty-eight ray fan, which a scar cannot move. headWidthPct is the owner's sentence as a number: how much of the animal's beam the head actually carries. planKinkMM and crownKinkMM are second differences of the measured outline — a taper is a change, a weld failure is a change IN the change, i.e. a corner — reported in millimetres of the real animal. waistMM catches the other shape of the same defect: an outline that narrows behind the head and widens again is a neck, and a shark has no neck.",
};
