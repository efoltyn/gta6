/* GREAT WHITE ANATOMY — tools/visual-compare.mjs preset.

   OWNER (2026-08-20, with photographs): "improve the appearance of all sharks
   and fish in the game… what they look like as their fins… Really focus on
   improving shark appearance and how they look from a ship when next to ship",
   then "Great white is most important, focus on it and then generalize."
   docs/SHARK-REFERENCE.md wrote those photographs down as acceptance criteria.
   This preset photographs the hero animal against every section of that sheet.

   WHAT THE TWO SIDES ARE. This is a SELF comparison (`defaultBefore: "local"`):
   the same checkout serves both halves. The BEFORE side does not load an old
   build — it rebuilds, inside this file, the great white exactly as it stood at
   git HEAD before this pass: a lathe hull with ONE flat countershading cut, a
   4-sided ConeGeometry dorsal squashed on Z, `box(0.95, 0.09, 0.5)` pectorals,
   two boxes for a tail, a black (0x10070a) mouth cavity, one row of 3-sided
   cone teeth on a hairline gum, sphere nostrils, and five detached box gill
   slabs. Those numbers are transcribed from HEAD, not invented, and they are
   in ONE function (`legacyGreatWhite`) so it is obvious what is being claimed.
   The AFTER side is the registered species out of CBZ.WILDLIFE_SPECIES.

   THE SIX FRAMES ARE THE SIX SECTIONS OF THE REFERENCE SHEET: closed mouth
   side-on (silhouette and countershading), full gape three-quarter (§1, the
   money shot), head-on at the surface (§2, the wide dome and the ragged line),
   a 45° breach (§3, dorsal and pectoral shape), straight down (§4, "what you
   see from a ship"), and the lone fin at the surface (§5, the Jaws shot).

   THE NUMBERS. Every metric is measured off the built Object3D, not asserted:

     boxFins          fin objects whose geometry is an axis-aligned box or a
                      cone — i.e. NOT a swept blade. The headline defect.
     dorsalConcavity  the first dorsal's deepest trailing-edge excursion from
                      the straight apex->rear-tip chord, over that chord. A
                      triangle is 0. A cone is 0. The reference sheet's
                      "distinctly CONCAVE, scythe-like trailing edge" is this
                      number being clearly above zero.
     bellyLineSpan    how much the countershading boundary MOVES from nose to
                      tail, in ring-sine units. A flat band is exactly 0; the
                      reference line "kicks UP behind the pectoral" and that
                      kick is this number.
     gapePastRostrumM metres the forward-most upper tooth travels PAST the
                      closed-mouth rostrum tip at full gape. Reference §1's
                      literal claim. A jaw that only hinges is <= 0.
     planWidthRatio   max hull width over hull length, from directly above.
                      A narrow torpedo is small; a fat lozenge is not.
*/

const subjects = [
  {
    id: "closed-side",
    label: "Closed Mouth, Side On — The Silhouette",
    open: 0, frame: 4.6, target: [-0.15, 1.35, 0], cameraOffset: [0, 0.05, 15],
    waterY: null,
    focus: "Reference §3: the whole animal is a TEARDROP — max girth just behind the head at the pectoral line, then a long taper to a narrow peduncle. Count the fins: first dorsal, second dorsal, pectorals, pelvics, anal, caudal keel, and a caudal whose upper lobe is clearly longer.",
    state: "REST · SIDE ON",
  },
  {
    id: "full-gape",
    label: "Full Gape, Three-Quarter — The Money Shot",
    open: 1, frame: 2.4, target: [2.80, 0.80, 0], cameraOffset: [2.6, 0.8, 5.0],
    waterY: null,
    focus: "Reference §1: the palatoquadrate SLIDES FORWARD AND DOWN out from under the snout and the snout LIFTS off it, so the upper tooth row ends up in front of the closed-mouth rostrum tip. Gums a thick wet dark red-pink band, interior dark pink-red (never black), multiple tooth rows raked further back.",
    state: "COMMIT · 100% GAPE",
  },
  {
    id: "gape-head-on",
    label: "Full Gape, Head On — Into The Hole",
    open: 1, frame: 2.2, target: [2.70, 0.68, 0], cameraOffset: [8.0, -0.2, 1.1],
    waterY: null,
    focus: "Reference §6: read the bands outside-in — pale outer jaw skin, the bright wet gum RIM (all the strong pink lives here and only here), the white tooth ring, then a DARK CAVITY, maroon at the front falling to near-black down the throat. The centre of the frame must be a receding hole; nothing in the gape may read as convex.",
    state: "COMMIT · 100% GAPE · HEAD ON",
  },
  {
    id: "head-on",
    label: "Head On At The Surface — The Wide Dome",
    open: 0.22, frame: 2.35, target: [2.55, 1.05, 0], cameraOffset: [9.0, 0.5, 0.30],
    waterY: 1.06,
    focus: "Reference §2: the head is a WIDE DOME, markedly wider than it is tall. The countershading boundary is a hard, RAGGED, high-contrast line that runs low across the cheek and kicks up above the gills — not a soft gradient and not a straight edge. Ampullae pores speckle the white underside; the nostrils are curved slits, not spheres.",
    state: "SURFACE · HEAD ON",
  },
  {
    id: "breach",
    label: "The Breach — 45° Out Of The Water",
    open: 0.78, frame: 7.2, target: [0.6, 2.10, 0], cameraOffset: [-0.9, 0.2, 16],
    animalPitch: 0.80, animal: [0, -0.60, 0], waterY: 1.05,
    focus: "Reference §3: pitched up ~45°, head and pectorals clear of the water. Dorsal a broad triangle with a ROUNDED apex and a concave trailing edge, dark outside and paler at the base; pectoral broad, swept back and DARK-TIPPED; five pale gill slits sitting on the countershading transition.",
    state: "BREACH · 45°",
  },
  {
    id: "plan-view",
    label: "Straight Down — What You See From A Ship",
    open: 0, frame: 7.4, planView: true, target: [-0.15, 1.05, 0],
    waterY: null,
    focus: "Reference §4, the drone shot, and literally the owner's question. From directly above the body must be a NARROW torpedo, widest at the pectoral line, with the pectorals swept back about 30° from the body axis and the tail a tall crescent whose upper lobe is clearly longer. The dorsal from overhead is a thin sliver, almost nothing.",
    state: "PLAN VIEW · FROM THE DECK",
  },
  {
    id: "fin-surface",
    label: "The Fin At The Surface — The Jaws Shot",
    open: 0, frame: 1.55, target: [0.35, 2.42, 0], cameraOffset: [0.9, 0.18, 11],
    waterY: 2.18,
    focus: "Reference §5: the above-water dorsal is a triangle with a distinctly CONCAVE, scythe-like trailing edge and an apex leaning BACK — not an isoceles triangle, and certainly not a cone. Lighter along the trailing margin, with a subtle darker mass under the surface trailing behind and below it.",
    state: "SURFACE · FIN ONLY",
  },
];

function stageGreatWhiteAnatomy(input) {
  const T = window.THREE, CBZ = window.CBZ, subject = input.subject;
  if (!T || !CBZ || !CBZ.WILDLIFE_SPECIES) return { ok: false, missing: "wildlife species registry" };

  /* ---------------------------------------------------------------------
     THE BEFORE SIDE. The great white as it stood at git HEAD, transcribed
     from that file: addSharkHull (one flat bellyCut), addSharkFaceDetails
     (sphere nostrils, box gill slabs), addSharkMouth (arc bars, one cone
     tooth row, a near-black cavity), and the build() body itself — cone
     dorsals, box pectorals, a box peduncle and two box tail blades.
     --------------------------------------------------------------------- */
  function legacyGreatWhite(mat) {
    const g = new T.Group();
    function box(w, h, d, mm) { return new T.Mesh(CBZ.boxGeom(w, h, d), mm); }
    const grey = mat(0x6b7880), white = mat(0xe8ebec);

    // ---- addSharkHull, HEAD version: one flat bellyCut for the whole body
    const rings = [
      { x: -1.55, y: 0.86, ry: 0.22, rz: 0.15 },
      { x: -0.85, y: 0.85, ry: 0.44, rz: 0.32 },
      { x: 0.15, y: 0.85, ry: 0.60, rz: 0.47 },
      { x: 1.05, y: 0.87, ry: 0.56, rz: 0.45 },
      { x: 1.80, y: 0.92, ry: 0.44, rz: 0.40 },
      { x: 2.30, y: 1.00, ry: 0.24, rz: 0.30 },
      { x: 2.60, y: 1.02, ry: 0.12, rz: 0.19 },
    ];
    const sides = 14, bellyCut = -0.30, positions = [];
    for (let i = 0; i < rings.length; i++) {
      for (let j = 0; j < sides; j++) {
        const a = (j / sides) * Math.PI * 2;
        positions.push(rings[i].x, rings[i].y + Math.sin(a) * rings[i].ry, Math.cos(a) * rings[i].rz);
      }
    }
    const top = [], belly = [];
    function bucket(j) {
      const a0 = (j / sides) * Math.PI * 2, a1 = (((j + 1) % sides) / sides) * Math.PI * 2;
      let s = (Math.sin(a0) + Math.sin(a1)) * 0.5;
      if (j === sides - 1) s = (Math.sin(a0) + Math.sin(Math.PI * 2)) * 0.5;
      return s < bellyCut ? belly : top;
    }
    for (let i = 0; i < rings.length - 1; i++) {
      for (let j = 0; j < sides; j++) {
        const n = (j + 1) % sides;
        bucket(j).push(i * sides + j, (i + 1) * sides + j, i * sides + n,
          (i + 1) * sides + j, (i + 1) * sides + n, i * sides + n);
      }
    }
    const rearCenter = positions.length / 3;
    positions.push(rings[0].x, rings[0].y, 0);
    const frontCenter = positions.length / 3;
    const fr = rings[rings.length - 1];
    positions.push(fr.x, fr.y, 0);
    for (let j = 0; j < sides; j++) {
      const n = (j + 1) % sides, dst = bucket(j), base = (rings.length - 1) * sides;
      dst.push(rearCenter, j, n); dst.push(frontCenter, base + n, base + j);
    }
    const geom = new T.BufferGeometry();
    geom.setAttribute("position", new T.Float32BufferAttribute(positions, 3));
    geom.setIndex(top.concat(belly));
    geom.addGroup(0, top.length, 0); geom.addGroup(top.length, belly.length, 1);
    geom.computeVertexNormals(); geom.computeBoundingBox(); geom.computeBoundingSphere();
    const hull = new T.Mesh(geom, [grey, white]);
    hull.name = "sharkHull"; g.add(hull);
    const maxWidth = rings.reduce(function (v, r) { return Math.max(v, r.rz * 2); }, 0);
    g.userData.sharkShape = {
      profile: "broad-wedge", noseWidth: fr.rz * 2, noseHeight: fr.ry * 2,
      headWidth: maxWidth, noseWidthRatio: maxWidth > 0 ? (fr.rz * 2) / maxWidth : 0,
      hullLength: rings[rings.length - 1].x - rings[0].x,
      hullWidth: maxWidth,
      bellyLineSpan: 0, bellyLineRagged: 0, pores: 0, scars: 0, folds: 0,
    };

    // ---- addSharkMouth, HEAD version
    const hingeX = 1.90, hingeY = 0.72, len = 0.60, width = 0.64, gap = 0.28;
    const gumH = Math.max(0.05, gap * 0.17), railW = Math.max(0.07, width * 0.13);
    const toothH = 0.13, toothR = toothH * 0.34, lipH = gumH + gap * 0.09;
    const gum = mat(0x54242b), tooth = mat(0xf4f1df);
    const cavityMat = mat(0x10070a), skin = mat(0xe8ebec), upperSkin = mat(0x6b7880);
    const cavity = new T.Mesh(new T.SphereGeometry(1, 10, 6), cavityMat);
    cavity.name = "sharkMouthCavity";
    cavity.position.set(hingeX + len * 0.58, hingeY, 0);
    cavity.scale.set(len * 0.58, gap * 0.06, width * 0.38); g.add(cavity);
    const upper = new T.Group(); upper.name = "sharkUpperJaw";
    const lower = new T.Group(); lower.name = "sharkLowerJaw";
    upper.position.set(hingeX, hingeY, 0); lower.position.set(hingeX, hingeY, 0);
    g.add(upper); g.add(lower);
    const upperY = gap * 0.27, lowerY = -gap * 0.27, arcSteps = 10, arc = [];
    for (let i = 0; i <= arcSteps; i++) {
      const a = -Math.PI * 0.48 + (i / arcSteps) * Math.PI * 0.96;
      arc.push({ x: len * (0.18 + 0.82 * Math.cos(a)), z: width * 0.5 * Math.sin(a) });
    }
    lower.rotation.z = 0.04;
    function arcBar(parent, p0, p1, y, h, d, mm, name, outward) {
      const dx = p1.x - p0.x, dz = p1.z - p0.z;
      const seg = box(Math.hypot(dx, dz) * 1.12, h, d, mm), z0 = (p0.z + p1.z) * 0.5;
      seg.name = name;
      seg.position.set((p0.x + p1.x) * 0.5, y, z0 + (outward ? (z0 < 0 ? -1 : 1) * outward : 0));
      seg.rotation.y = Math.atan2(-dz, dx); parent.add(seg); return seg;
    }
    for (let i = 0; i < arc.length - 1; i++) {
      const p0 = arc[i], p1 = arc[i + 1];
      arcBar(upper, p0, p1, upperY, gumH, railW, gum, "sharkUpperGum", 0);
      arcBar(lower, p0, p1, lowerY, gumH, railW, gum, "sharkLowerGum", 0);
      arcBar(lower, p0, p1, lowerY - gumH * 0.55, gumH * 0.95, railW * 1.15, skin, "sharkMandible", 0);
      arcBar(upper, p0, p1, upperY, lipH, railW * 0.20, upperSkin, "sharkUpperLip", railW * 0.52);
      arcBar(lower, p0, p1, lowerY, lipH, railW * 0.20, skin, "sharkLowerLip", railW * 0.52);
    }
    let upperTeeth = 0, lowerTeeth = 0;
    function toothPair(parent, x, z, isTop) {
      const t = new T.Mesh(new T.ConeGeometry(toothR, toothH, 3), tooth);
      t.position.set(x, isTop ? upperY - gumH * 0.5 - toothH * 0.10
        : lowerY + gumH * 0.5 + toothH * 0.10, z);
      if (isTop) t.rotation.x = Math.PI;
      t.name = isTop ? "sharkUpperTooth" : "sharkLowerTooth";
      parent.add(t);
      if (isTop) upperTeeth++; else lowerTeeth++;
    }
    for (let i = 0; i < 15; i++) {
      const t = i / 14, a = -Math.PI * 0.43 + t * Math.PI * 0.86;
      const x = len * (0.18 + 0.82 * Math.cos(a)), z = width * 0.44 * Math.sin(a);
      toothPair(upper, x, z, true); toothPair(lower, x + len * 0.018, z, false);
    }
    const contract = {
      version: 2, shape: "arched-underside", hinge: { x: hingeX, y: hingeY, z: 0 },
      bite: { x: hingeX + len * 0.96, y: hingeY, z: 0 },
      maxOpen: 0.62, travel: 0.62 + 0.04, restClose: 0.04,
      protrude: len * 0.075, upperDrop: gap * 0.08,
      toothRows: 1, upperTeeth: upperTeeth, lowerTeeth: lowerTeeth,
    };
    g.userData.aquaticMouth = contract;
    g._aquaticMouth = { lower: lower, upper: upper, cavity: cavity, contract: contract };

    // ---- addSharkFaceDetails, HEAD version: sphere nostrils, box gill slabs
    const dark = mat(0x10161a);
    const eyeGeom = new T.SphereGeometry(0.05, 7, 5);
    [-1, 1].forEach(function (side) {
      const eye = new T.Mesh(eyeGeom, dark); eye.name = "sharkEye";
      eye.position.set(2.16, 1.00, side * 0.31); eye.scale.z = 0.55; g.add(eye);
      const nostril = new T.Mesh(new T.SphereGeometry(0.035, 6, 4), dark);
      nostril.name = "sharkNostril";
      nostril.position.set(2.50, 0.92, side * 0.12); nostril.scale.set(1, 0.45, 0.55); g.add(nostril);
      for (let i = 0; i < 5; i++) {
        const slot = new T.Mesh(CBZ.boxGeom(0.032, 0.30 * (1 - i * 0.045), 0.06), dark);
        slot.name = "sharkGill";
        slot.position.set(1.62 - i * 0.095, 0.90, side * (0.405 + i * 0.012));
        slot.rotation.z = -0.08; g.add(slot);
      }
    });

    // ---- build(): CONE dorsals, BOX pectorals, BOX peduncle, BOX tail
    const dorsal = new T.Mesh(new T.ConeGeometry(0.5, 1.15, 4), grey);
    dorsal.name = "legacyDorsal";
    dorsal.position.set(0.1, 1.75, 0); dorsal.scale.z = 0.22; dorsal.rotation.z = 0.14; g.add(dorsal);
    const dorsal2 = new T.Mesh(new T.ConeGeometry(0.18, 0.35, 4), grey);
    dorsal2.position.set(-1.3, 1.32, 0); dorsal2.scale.z = 0.3; g.add(dorsal2);
    const peduncle = box(0.5, 0.44, 0.26, grey); peduncle.position.set(-1.7, 0.85, 0); g.add(peduncle);
    const tailUp = box(0.30, 1.2, 0.14, grey); tailUp.position.set(-2.05, 1.35, 0); tailUp.rotation.z = 0.35; g.add(tailUp);
    const tailDn = box(0.26, 0.7, 0.13, grey); tailDn.position.set(-2.0, 0.45, 0); tailDn.rotation.z = -0.3; g.add(tailDn);
    [0.6, -0.6].forEach(function (z) {
      const f = box(0.95, 0.09, 0.5, grey);
      f.position.set(0.95, 0.48, z);
      f.rotation.y = (z > 0 ? -0.62 : 0.62); f.rotation.x = (z > 0 ? 0.22 : -0.22); g.add(f);
    });
    return g;
  }

  /* ---- studio ---------------------------------------------------------- */
  let studio = window.__cbzVisualCompare;
  if (!studio) {
    document.documentElement.style.cssText = "margin:0;width:100%;height:100%;background:#05141f";
    document.body.innerHTML = "";
    document.body.style.cssText = "margin:0;width:100%;height:100%;overflow:hidden;background:#05141f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
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
      color: key, roughness: 0.86, metalness: 0.01,     // §2: shark skin is MATTE
    }));
    return materials.get(key);
  }

  const before = input.side !== "after";
  const species = CBZ.WILDLIFE_SPECIES.great_white_shark;
  if (!species || typeof species.build !== "function") return { ok: false, missing: "great_white_shark" };
  const animal = before
    ? legacyGreatWhite(animalMaterial)
    : species.build({ THREE: T, mat: animalMaterial, rng: () => 0.25 });
  animal.scale.setScalar(Number(species.scale) || 1);
  animal.traverse(function (o) { o.matrixAutoUpdate = true; });

  /* ---- MEASUREMENTS, taken off the built object -------------------------
     Everything below reads the real Object3D. Nothing is asserted. */
  const box3 = new T.Box3();
  function meshList(root) {
    const out = []; root.traverse(function (o) { if (o.isMesh) out.push(o); });
    return out;
  }
  function triCount(mesh) {
    const gg = mesh.geometry;
    if (!gg || !gg.attributes || !gg.attributes.position) return 0;
    return gg.index ? gg.index.count / 3 : gg.attributes.position.count / 3;
  }
  // A blade or a box? A BoxGeometry has exactly 24 positions / 12 triangles and
  // a ConeGeometry a single apex; a swept blade has a chordwise-by-spanwise
  // grid on two skins. Count both by their unmistakable signatures.
  function isBoxOrCone(mesh) {
    const gg = mesh.geometry;
    if (!gg) return false;
    const t = gg.type || "";
    if (t === "BoxGeometry" || t === "ConeGeometry" || t === "CylinderGeometry") return true;
    return false;
  }
  // Reference §5, as a number: the trailing edge's deepest excursion from the
  // straight apex->rear-tip chord, in units of that chord. A triangle is 0.
  // Measured in the fin's own local plane (its two widest principal axes).
  function trailingConcavity(mesh) {
    const gg = mesh.geometry;
    if (!gg || !gg.attributes || !gg.attributes.position) return 0;
    const pos = gg.attributes.position, n = pos.count;
    if (n < 8) return 0;
    // Local frame: +x is the chord (leading edge forward), +y the span. So the
    // TRAILING outline is, in each spanwise band, the smallest x.
    let apex = null, rear = null, minX = Infinity, maxY = -Infinity;
    for (let i = 0; i < n; i++) {
      const x = pos.getX(i), y = pos.getY(i);
      if (y > maxY + 1e-6) { maxY = y; apex = [x, y]; }
      else if (Math.abs(y - maxY) <= 1e-6 && apex && x < apex[0]) apex = [x, y];
      if (x < minX) { minX = x; rear = [x, y]; }
    }
    if (!apex || !rear) return 0;
    const cx = apex[0] - rear[0], cy = apex[1] - rear[1];
    const clen = Math.hypot(cx, cy);
    if (clen < 1e-5 || Math.abs(cy) < 1e-5) return 0;
    // bin the trailing outline by span, then take its deepest excursion from
    // the straight rear-tip -> apex chord. A cone or a triangle gives 0.
    const BINS = 24, bin = new Array(BINS).fill(null);
    for (let i = 0; i < n; i++) {
      const x = pos.getX(i), y = pos.getY(i);
      const t = (y - rear[1]) / cy;
      if (t < 0 || t > 1) continue;
      const b = Math.min(BINS - 1, Math.max(0, Math.floor(t * BINS)));
      if (bin[b] === null || x < bin[b][0]) bin[b] = [x, y];
    }
    let deepest = 0;
    for (let b = 0; b < BINS; b++) {
      if (!bin[b]) continue;
      const dx = bin[b][0] - rear[0], dy = bin[b][1] - rear[1];
      const t = (dx * cx + dy * cy) / (clen * clen);
      if (t < 0.10 || t > 0.90) continue;
      const d = (dx * cy - dy * cx) / clen;      // > 0 = cut IN toward the leading edge
      if (d > deepest) deepest = d;
    }
    return deepest / clen;
  }
  // the tallest fin whose root sits above the body centreline IS the first dorsal
  function findDorsal(root) {
    let best = null, bestTop = -Infinity;
    meshList(root).forEach(function (mesh) {
      if (NOT_A_FIN.test(mesh.name || "")) return;
      box3.setFromObject(mesh);                    // WORLD, so mesh.scale counts
      const sz = box3.getSize(new T.Vector3());
      if (sz.y < 0.5 || sz.z > sz.y * 0.55) return;   // a dorsal is thin and tall
      if (box3.max.y > bestTop) { bestTop = box3.max.y; best = mesh; }
    });
    return best;
  }

  // Face and mouth parts are not fins; naming them out keeps the count honest.
  const NOT_A_FIN = /gill|eye|nostril|gum|lip|mandible|chin|tooth|cavity|pore|skin/i;
  const allMeshes = meshList(animal);
  let triangles = 0, boxFins = 0;
  allMeshes.forEach(function (mesh) {
    triangles += triCount(mesh);
    if (NOT_A_FIN.test(mesh.name || "")) return;
    box3.setFromObject(mesh);
    const sz = box3.getSize(new T.Vector3());
    const big = Math.max(sz.x, sz.y, sz.z), small = Math.min(sz.x, sz.y, sz.z);
    if (big > 0.4 && small < 0.28 * big && isBoxOrCone(mesh)) boxFins++;
  });
  const dorsal = findDorsal(animal);
  const dorsalConcavity = dorsal ? trailingConcavity(dorsal) : 0;

  // §1 as a number: how far the forward-most upper tooth travels PAST the
  // closed-mouth rostrum tip. Measured, by opening the real jaw.
  animal.updateMatrixWorld(true);
  const closedTip = new T.Box3().setFromObject(animal).max.x;
  let gapePastRostrum = 0;
  const mouth = animal._aquaticMouth;
  if (mouth && mouth.upper) {
    const c = mouth.contract;
    const keepX = mouth.upper.position.x, keepY = mouth.upper.position.y;
    mouth.upper.position.x = c.hinge.x + (c.protrude || 0);
    mouth.upper.position.y = c.hinge.y - (c.upperDrop || 0);
    if (mouth.applyGape) mouth.applyGape(1);
    animal.updateMatrixWorld(true);
    let toothMax = -Infinity;
    mouth.upper.traverse(function (o) {
      if (o.isMesh && /Tooth/.test(o.name || "")) {
        toothMax = Math.max(toothMax, new T.Box3().setFromObject(o).max.x);
      }
    });
    if (toothMax > -Infinity) gapePastRostrum = toothMax - closedTip;
    mouth.upper.position.x = keepX; mouth.upper.position.y = keepY;
    if (mouth.applyGape) mouth.applyGape(0);
    animal.updateMatrixWorld(true);
  }

  /* ---- pose ------------------------------------------------------------ */
  const open = Number(subject.open) || 0;
  if (mouth) {
    const c = mouth.contract;
    mouth.lower.rotation.z = (c.restClose || 0) - open * (c.maxOpen || 1);
    mouth.upper.position.x = c.hinge.x + open * (c.protrude || 0);
    mouth.upper.position.y = c.hinge.y - open * (c.upperDrop || 0);
    if (mouth.applyGape) mouth.applyGape(open);
  }
  animal.position.fromArray(subject.animal || [0, 0, 0]);
  animal.rotation.z = Number(subject.animalPitch) || 0;
  animal.updateMatrixWorld(true);

  const shape = (animal.userData && animal.userData.sharkShape) || {};
  const bbox = new T.Box3().setFromObject(animal);
  // §4 is about the BODY ("far narrower than the side view implies"), not the
  // fin span — the same sheet demands LONG pectorals swept back 30 degrees, so
  // a whole-bbox width would score the fix as a regression. Hull over length.
  const planLen = bbox.max.x - bbox.min.x;
  const planWid = (Number(shape.hullWidth) || (bbox.max.z - bbox.min.z)) * (Number(species.scale) || 1);

  /* ---- scene ----------------------------------------------------------- */
  const scene = new T.Scene();
  scene.background = new T.Color(0x06202e);
  scene.fog = new T.Fog(0x06202e, 26, 70);
  // r128 is PRE-physically-correct-lights: intensities simply sum, so a stack
  // that looks reasonable in a modern build saturates a dark slate to white —
  // and the countershading contrast this preset exists to judge lives exactly
  // there. Keep the total under 1 so 0x53585a stays a dark grey.
  // TWO constraints, and the first run failed both. (1) r128 is PRE-physically
  // correct: intensities simply SUM, so the brightest face must see a total
  // under 1.0 or the white belly clips and takes the dark back up with it.
  // (2) The hemisphere GROUND colour is what lights every downward face, so a
  // near-black ground turns a white belly dark and inverts the very
  // countershading this preset exists to judge. Sky+key = 0.82 caps the top;
  // a lit ground plus an upward bounce carries the belly.
  scene.add(new T.HemisphereLight(0xdaf2ff, 0x2a4d66, 0.40));
  const key = new T.DirectionalLight(0xffffff, 0.42); key.position.set(5, 12, 10); scene.add(key);
  const bounce = new T.DirectionalLight(0xbfe6f7, 0.50); bounce.position.set(3, -8, 5); scene.add(bounce);
  const rim = new T.DirectionalLight(0x46c9ff, 0.18); rim.position.set(-9, 5, -9); scene.add(rim);
  scene.add(animal);

  if (subject.waterY != null) {
    const water = new T.Mesh(new T.PlaneGeometry(120, 70), new T.MeshPhysicalMaterial({
      color: 0x0c6d94, transparent: true, opacity: 0.42, roughness: 0.2,
      metalness: 0.02, depthWrite: false, side: T.DoubleSide,
    }));
    water.rotation.x = -Math.PI / 2; water.position.y = subject.waterY;
    water.renderOrder = 5; scene.add(water);
  }
  const seabed = new T.Mesh(new T.PlaneGeometry(140, 80), new T.MeshStandardMaterial({ color: 0x0a2c36, roughness: 1 }));
  seabed.rotation.x = -Math.PI / 2; seabed.position.y = -9; scene.add(seabed);

  /* ---- camera: the BEFORE side's camera is copied byte-for-byte ---------- */
  const aspect = input.width / input.height;
  const ref = input.referenceStage && input.referenceStage.camera;
  const framedHeight = ref ? ref.framedHeight : Number(subject.frame || 4);
  const camTarget = ref ? ref.target : subject.target;
  let camPos, camUp;
  if (ref) { camPos = ref.position; camUp = ref.up; }
  else if (subject.planView) {
    camPos = [camTarget[0], camTarget[1] + 16, camTarget[2]];
    camUp = [1, 0, 0];                       // nose points to the top of frame
  } else {
    const off = subject.cameraOffset || [1.5, 1, 9];
    camPos = [camTarget[0] + off[0], camTarget[1] + off[1], camTarget[2] + off[2]];
    camUp = [0, 1, 0];
  }
  const camera = new T.OrthographicCamera(
    -framedHeight * aspect / 2, framedHeight * aspect / 2,
    framedHeight / 2, -framedHeight / 2, 0.01, 260);
  camera.position.fromArray(camPos); camera.up.fromArray(camUp);
  camera.lookAt(new T.Vector3().fromArray(camTarget)); camera.updateProjectionMatrix();
  studio.renderer.setSize(input.width, input.height, false);
  studio.renderer.render(scene, camera);

  /* ---- overlay --------------------------------------------------------- */
  const after = input.side === "after", overlay = studio.overlay;
  const sideEl = overlay.querySelector("[data-side]");
  sideEl.textContent = after ? input.afterLabel : input.beforeLabel;
  sideEl.style.cssText = `position:absolute;top:23px;left:27px;padding:7px 11px;border-radius:7px;background:${after ? "#187e5a" : "#bd4848"};font-size:12px;font-weight:900;letter-spacing:.12em`;
  const nameEl = overlay.querySelector("[data-name]"); nameEl.textContent = subject.label;
  nameEl.style.cssText = "position:absolute;top:67px;left:28px;font-size:27px;font-weight:850;letter-spacing:-.025em";
  const focusEl = overlay.querySelector("[data-focus]"); focusEl.textContent = subject.focus;
  focusEl.style.cssText = "position:absolute;top:104px;left:29px;color:#c2d5df;font-size:13px;font-weight:550;max-width:790px;line-height:1.35";
  const stateEl = overlay.querySelector("[data-state]"); stateEl.textContent = subject.state;
  stateEl.style.cssText = `position:absolute;right:27px;top:26px;color:${after ? "#7df0b8" : "#ffaaaa"};font-size:11px;font-weight:900;letter-spacing:.1em`;
  const phaseEl = overlay.querySelector("[data-phase]");
  phaseEl.textContent = `GAPE ${Math.round(open * 100)}%`;
  phaseEl.style.cssText = "position:absolute;right:28px;top:54px;color:#d7eef8;font:12px ui-monospace,SFMono-Regular,Menlo,monospace";
  const metricEl = overlay.querySelector("[data-metric]");
  metricEl.textContent = `box/cone fins ${boxFins} · dorsal concavity ${dorsalConcavity.toFixed(3)} · belly-line span ${(shape.bellyLineSpan || 0).toFixed(2)} · meshes ${allMeshes.length}`;
  metricEl.style.cssText = "position:absolute;right:27px;bottom:22px;padding:7px 10px;border-radius:6px;background:rgba(3,18,28,.78);color:#bfeeff;font:11px ui-monospace,SFMono-Regular,Menlo,monospace";
  const srcEl = overlay.querySelector("[data-source]");
  srcEl.textContent = (before ? "reconstructed git HEAD anatomy · " : "registered species · ")
    + new URL(input.sourceUrl).host + new URL(input.sourceUrl).pathname;
  srcEl.style.cssText = "position:absolute;bottom:22px;left:28px;color:#91aab7;font:11px ui-monospace,SFMono-Regular,Menlo,monospace";

  const contract = (animal.userData && animal.userData.aquaticMouth) || {};
  return {
    ok: true,
    side: input.side,
    legacyReconstruction: before,
    camera: { framedHeight, position: camPos.slice(), target: camTarget.slice(), up: camUp.slice() },
    metrics: {
      boxFins: boxFins,
      dorsalConcavity: Number(dorsalConcavity.toFixed(4)),
      bellyLineSpan: Number((shape.bellyLineSpan || 0).toFixed(3)),
      bellyLineRagged: Number((shape.bellyLineRagged || 0).toFixed(3)),
      toothRows: Number(contract.toothRows || 0),
      teeth: Number(contract.upperTeeth || 0) + Number(contract.lowerTeeth || 0),
      jawProtrudeM: Number((contract.protrude || 0).toFixed(3)),
      snoutLiftRad: Number((contract.snoutLift || 0).toFixed(3)),
      gapePastRostrumM: Number(gapePastRostrum.toFixed(3)),
      poreCount: Number(shape.pores || 0),
      scarCount: Number(shape.scars || 0),
      foldCount: Number(shape.folds || 0),
      planWidthRatio: planLen > 0 ? Number((planWid / planLen).toFixed(3)) : 0,
      meshes: allMeshes.length,
      triangles: Math.round(triangles),
    },
  };
}

export default {
  id: "great-white-anatomy",
  title: "The Great White, Against The Reference Sheet",
  description: "Six frames photograph the hero shark against the six sections of docs/SHARK-REFERENCE.md: closed mouth side-on, full gape three-quarter, head-on at the surface, a 45° breach, straight down from a flybridge, and the lone fin cutting a calm sea. Both halves come out of the same checkout — the BEFORE side rebuilds, inside the preset, the great white exactly as it stood at git HEAD (a lathe hull with one flat countershading cut, a squashed 4-sided cone for a dorsal, box(0.95, 0.09, 0.5) pectorals, two boxes for a tail, a black mouth cavity, one row of cone teeth on a hairline gum, sphere nostrils and five detached box gill slabs), and the AFTER side builds the registered species. What changed is one shared fin grammar — a swept blade with a concave scythe trailing edge, a free rear tip and a knife edge at the tip — used for every dorsal, pectoral, pelvic, anal, caudal lobe and keel; a countershading line that is a function of the ring plus deterministic raggedness so the white kicks up behind the pectoral; ampullae pores, rake scars and flank folds; gill slots cut onto the hull's real cross-section; curved nostril slits; three raked tooth rows on a thick wet gum in a dark pink-red mouth; and an upper jaw that slides forward and down while the rostrum lifts off it.",
  defaultBefore: "local",
  beforeLabel: "BEFORE · GIT HEAD ANATOMY",
  afterLabel: "AFTER · LOCAL",
  pairNote: "Same checkout · same lights · same water · same gape phase · same camera, copied from the before capture",
  method: "One page per side. The before side reconstructs the HEAD-committed builder from that file's own numbers (transcribed, in one function, so the claim is inspectable); the after side calls CBZ.WILDLIFE_SPECIES.great_white_shark.build. Both are posed through the authored mouth contract at the same gape and photographed with an orthographic camera whose framing, position, target and up vector are copied byte-for-byte from the before capture. Every number in the table is measured off the built Object3D — geometry types, a trailing-edge chord excursion, and a real jaw opening — not asserted.",
  viewport: { width: 1100, height: 680 },
  readyExpression: "window.THREE && window.CBZ && CBZ.boxGeom && CBZ.WILDLIFE_SPECIES && CBZ.WILDLIFE_SPECIES.great_white_shark",
  subjects,
  metrics: {
    boxFins: { label: "Fin-shaped parts that are still a box or a cone", unit: "", better: "lower" },
    dorsalConcavity: { label: "First dorsal trailing-edge concavity (a triangle or a cone is 0)", unit: "×chord", better: "higher" },
    bellyLineSpan: { label: "Travel of the countershading line nose to tail (a flat band is 0)", unit: "ring-sine", better: "higher" },
    bellyLineRagged: { label: "Raggedness of that line (a machine-straight seam is 0)", unit: "ring-sine", better: "higher" },
    toothRows: { label: "Tooth rows per jaw", unit: "", better: "higher" },
    teeth: { label: "Teeth, both jaws", unit: "", better: "higher" },
    jawProtrudeM: { label: "Upper-jaw forward slide at full gape", unit: "m", better: "higher" },
    snoutLiftRad: { label: "Rostrum lift at full gape", unit: "rad", better: "higher" },
    gapePastRostrumM: { label: "Upper tooth row past the closed rostrum tip at full gape", unit: "m", better: "higher" },
    poreCount: { label: "Ampullae of Lorenzini pores", unit: "", better: "higher" },
    scarCount: { label: "Rake scars on the dorsal skin (deleted 2026-08-30 — see megalodon-camera)", unit: "" },
    foldCount: { label: "Flank wrinkle folds behind the head", unit: "", better: "higher" },
    planWidthRatio: { label: "Hull width over body length from directly above (a narrow torpedo is small)", unit: "×", better: "lower" },
    meshes: { label: "Meshes in the animal (draw calls before batching)", unit: "", better: "lower" },
    triangles: { label: "Triangles in the animal", unit: "" },
  },
  metricsNote: "boxFins and dorsalConcavity are the owner's actual complaint — \"what they look like as their fins\" — turned into two numbers: how many parts are still primitives, and whether the dorsal's trailing edge is a scythe or a straight line. bellyLineSpan is the countershading fix: it is exactly 0 for any flat band however dark. gapePastRostrumM is reference §1's literal claim (\"at full gape the upper tooth row is in front of the closed-mouth rostrum tip\") measured by opening the real jaw — a mouth that only hinges scores at or below zero. meshes going UP is the honest cost: the whole animal gained pelvic fins, an anal fin, a second dorsal, keels, a rostrum shell and three merged detail meshes, and every geometry is shared across the pack.",
  stage: stageGreatWhiteAnatomy,
};
