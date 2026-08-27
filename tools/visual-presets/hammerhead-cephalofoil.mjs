/* THE CEPHALOFOIL COUNTERSHADING — which face of a fin is the UNDERSIDE.

   OWNER (2026-08-27): "look at the hammerhead shark head rn one side of head
   left side is white right side is gray when it should be top side of left and
   right are gray and bottom side is white".

   That is not a hammerhead bug, it is a FIN GRAMMAR bug, and it is on every
   shark in the ocean. emitFin() builds its blade in an orthonormal basis
   u = chord, v = span, w = u x v, and paints material slot 1 (the pale
   underside) on the -w face. A left/right pair is built by NEGATING spanDir,
   which negates w — so on exactly one side of the body the "underside" faces
   the sky. The cephalofoil is where it screams, because its wings are
   horizontal and half a metre wide: one wing reads white from above and the
   other grey. The pectorals and pelvics of every shark have the same flip,
   just at a shallower angle.

   SO THIS REPORT PHOTOGRAPHS THE MIRROR PAIR, from directly above and directly
   below, on the two species that carry the most mirrored blade area — plus one
   three-quarter frame, because the seam between the head block and the wings is
   only visible when the light is raking.

   AND IT COUNTS THE FAULT. The pictures decide, but the fault is countable:
   every triangle of every fin belongs to a material, and the material's own
   luminance says whether that triangle is meant to be the dark top or the pale
   belly. A pale triangle whose world normal points UP is inverted. So is a dark
   triangle pointing DOWN. Both should be zero, and the difference between the
   +Z and -Z halves of the animal is the owner's exact sentence as a number. */

const ROSTER = [
  { id: "hammerhead_shark",  label: "Great Hammerhead", frame: 7.2,  head: 4.4,
    angles: ["above", "below", "quarter", "fins"] },
  { id: "great_white_shark", label: "Great White",      frame: 7.0,  head: 4.6,
    angles: ["above", "below", "quarter", "fins"] },
  // The grammar is shared, so the fix is ocean-wide. One more species proves it.
  { id: "megalodon",         label: "Megalodon",        frame: 15.0, head: 9.0,
    angles: ["above", "below"] },
];

/* dir = offset from the animal toward the camera, in the animal's own body
   frame (+X nose, +Y up, +Z its left flank). `up` matters for the plan views:
   looking straight down needs an up vector that is not also straight down. */
const ANGLES = {
  above: {
    dir: [0.0, 1, 0.001], up: [1, 0, 0], aim: "head",
    label: "From Above",
    note: "The top of BOTH wings must be the same dark grey. A white wing here is the bug.",
  },
  below: {
    dir: [0.0, -1, 0.001], up: [-1, 0, 0], aim: "head",
    label: "From Below",
    note: "The underside of BOTH wings must be the same pale belly white — a prey's-eye view.",
  },
  quarter: {
    dir: [0.62, 0.55, 0.56], up: [0, 1, 0], aim: "head",
    label: "Three-Quarter",
    note: "The raking frame: the seam where the pale underside turns over into the grey top.",
  },
  fins: {
    dir: [0.05, 0.62, 0.78], up: [0, 1, 0], aim: "body",
    label: "Whole Animal",
    note: "Pectorals and pelvics are the same mirrored blade — the left/right pair must match.",
  },
};

const subjects = [];
for (const sp of ROSTER) {
  for (const key of sp.angles) {
    const a = ANGLES[key];
    subjects.push({
      id: `${sp.id}-${key}`,
      label: `${sp.label} — ${a.label}`,
      species: sp.id, angle: key,
      frame: a.aim === "head" ? sp.head : sp.frame,
      focus: a.note,
      state: a.label.toUpperCase(),
    });
  }
}

function stageCephalofoil(input) {
  const T = window.THREE, CBZ = window.CBZ, subject = input.subject;
  if (!T || !CBZ || !CBZ.WILDLIFE_SPECIES) return { ok: false, missing: "wildlife species registry" };

  const ANG = {
    above:   { dir: [0.0, 1, 0.001], up: [1, 0, 0], aim: "head" },
    below:   { dir: [0.0, -1, 0.001], up: [-1, 0, 0], aim: "head" },
    quarter: { dir: [0.62, 0.55, 0.56], up: [0, 1, 0], aim: "head" },
    fins:    { dir: [0.05, 0.62, 0.78], up: [0, 1, 0], aim: "body" },
  }[subject.angle] || { dir: [0, 1, 0.001], up: [1, 0, 0], aim: "body" };

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
  group.position.set(0, 0, 0);
  group.rotation.set(0, 0, 0);
  group.updateMatrixWorld(true);

  /* ---- THE COUNT ------------------------------------------------------
     Walk every triangle of every FIN (a blade records its own recipe in
     userData.finShape, so no name matching and no geometry guessing), decide
     from its MATERIAL whether it is meant to be the dark top or the pale
     belly, and from its WORLD NORMAL which way it actually faces. Area
     weighted, because a hundred slivers along a trailing edge must not
     outvote the face of a wing. */
  const a = new T.Vector3(), b = new T.Vector3(), c = new T.Vector3();
  const ab = new T.Vector3(), ac = new T.Vector3(), nrm = new T.Vector3();
  const centre3 = new T.Vector3();
  const acc = {
    paleUp: 0, paleAll: 0, darkDown: 0, darkAll: 0,
    side: { pos: { up: 0, all: 0 }, neg: { up: 0, all: 0 } },
  };
  const UPFACE = 0.35;   // |n.y| below this is a rim/edge face, not a side

  const lumOf = (mat) => (mat && mat.color
    ? 0.299 * mat.color.r + 0.587 * mat.color.g + 0.114 * mat.color.b : 0.5);

  group.traverse(function (o) {
    if (!o.isMesh || !o.geometry || !o.userData || !o.userData.finShape) return;
    const geo = o.geometry, pos = geo.attributes && geo.attributes.position;
    if (!pos) return;
    const index = geo.index;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    /* ONLY COUNTERSHADED BLADES CAN BE INVERTED. A caudal keel is one grey
       material on both faces — it has no belly to put on the wrong side, and
       counting its downward half as "dark facing down" buried the real signal
       under twenty points of permanent noise. A blade qualifies only if it
       carries both a pale and a dark material. */
    let hasPale = false, hasDark = false;
    for (const mat of mats) { const l = lumOf(mat); if (l > 0.55) hasPale = true; else if (l < 0.45) hasDark = true; }
    if (!hasPale || !hasDark) return;
    const groups = geo.groups && geo.groups.length
      ? geo.groups
      : [{ start: 0, count: index ? index.count : pos.count, materialIndex: 0 }];
    // Which flank this blade lives on: its own world centre, not a vertex.
    o.geometry.computeBoundingBox();
    centre3.copy(o.geometry.boundingBox.getCenter(new T.Vector3())).applyMatrix4(o.matrixWorld);
    const flank = centre3.z > 0.02 ? "pos" : (centre3.z < -0.02 ? "neg" : null);

    for (let g = 0; g < groups.length; g++) {
      const mat = mats[Math.min(groups[g].materialIndex, mats.length - 1)];
      if (!mat || !mat.color) continue;
      const lum = lumOf(mat);
      const pale = lum > 0.55, dark = lum < 0.45;
      if (!pale && !dark) continue;            // eyes, mouth interior, mid greys
      const start = groups[g].start, end = start + groups[g].count;
      for (let i = start; i < end; i += 3) {
        const i0 = index ? index.getX(i) : i;
        const i1 = index ? index.getX(i + 1) : i + 1;
        const i2 = index ? index.getX(i + 2) : i + 2;
        a.fromBufferAttribute(pos, i0).applyMatrix4(o.matrixWorld);
        b.fromBufferAttribute(pos, i1).applyMatrix4(o.matrixWorld);
        c.fromBufferAttribute(pos, i2).applyMatrix4(o.matrixWorld);
        ab.subVectors(b, a); ac.subVectors(c, a);
        nrm.crossVectors(ab, ac);
        const area = nrm.length() * 0.5;
        if (!(area > 1e-9)) continue;
        nrm.divideScalar(area * 2);
        if (Math.abs(nrm.y) < UPFACE) continue;   // an edge face has no "side"
        if (pale) {
          acc.paleAll += area;
          if (nrm.y > 0) acc.paleUp += area;
          if (flank) {
            acc.side[flank].all += area;
            if (nrm.y > 0) acc.side[flank].up += area;
          }
        } else {
          acc.darkAll += area;
          if (nrm.y < 0) acc.darkDown += area;
        }
      }
    }
  });

  const pct = (n, d) => (d > 1e-9 ? Math.round((n / d) * 1000) / 10 : 0);
  const leftUp = pct(acc.side.pos.up, acc.side.pos.all);
  const rightUp = pct(acc.side.neg.up, acc.side.neg.all);
  const metrics = {
    finPaleUpPct: pct(acc.paleUp, acc.paleAll),
    finDarkDownPct: pct(acc.darkDown, acc.darkAll),
    finSideAsymPct: Math.round(Math.abs(leftUp - rightUp) * 10) / 10,
  };

  const box = new T.Box3().setFromObject(group);
  const size = new T.Vector3(); box.getSize(size);
  const centre = new T.Vector3(); box.getCenter(centre);

  const scene = new T.Scene();
  scene.background = new T.Color(0x07202c);
  /* THE LIGHT IS PART OF THE CLAIM. This report is about which face is GREY
     and which is WHITE, so it cannot be lit like the rest of the marine
     presets: at their intensities a 0x434c50 top blows out to near white and
     both wings photograph the same, which would hide the very fault the run
     exists to show. Dim, balanced, and enough fill from below that the belly
     frames are not a black cutout. */
  scene.add(new T.HemisphereLight(0xbfe4f2, 0x061820, 0.5));
  const key = new T.DirectionalLight(0xffffff, 0.85); key.position.set(6, 12, 9); scene.add(key);
  const rim = new T.DirectionalLight(0x49c9ff, 0.30); rim.position.set(-9, 3, -8); scene.add(rim);
  const belly = new T.DirectionalLight(0xcfeaf5, 0.85); belly.position.set(2, -10, 4); scene.add(belly);
  scene.add(group);

  const aspect = input.width / input.height;
  const ref = input.referenceStage && input.referenceStage.camera;
  // The head sits at the +X end of the body by the species contract.
  const aim = ANG.aim === "head"
    ? new T.Vector3(box.max.x - size.x * 0.13, centre.y, centre.z)
    : centre.clone();
  const framedHeight = ref ? ref.framedHeight : (Number(subject.frame) || Math.max(size.x, size.y, size.z) * 1.25);
  const dist = Math.max(size.x, size.y, size.z) * 3 + 12;
  const d = new T.Vector3().fromArray(ANG.dir).normalize().multiplyScalar(dist);
  const camera = new T.OrthographicCamera(
    -framedHeight * aspect / 2, framedHeight * aspect / 2,
    framedHeight / 2, -framedHeight / 2, 0.01, dist * 4);
  const cameraTarget = ref ? ref.target : aim.toArray();
  const cameraPosition = ref ? ref.position : [aim.x + d.x, aim.y + d.y, aim.z + d.z];
  const cameraUp = ref ? ref.up : ANG.up;
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
  focus.style.cssText = "position:absolute;top:105px;left:29px;color:#bfd6e2;font-size:13px;font-weight:550;max-width:820px;line-height:1.35";
  const state = overlay.querySelector("[data-state]"); state.textContent = subject.state;
  state.style.cssText = `position:absolute;right:27px;top:26px;color:${after ? "#7df0b8" : "#ffaaaa"};font-size:11px;font-weight:900;letter-spacing:.1em`;
  const metric = overlay.querySelector("[data-metric]");
  metric.textContent = `pale facing up ${metrics.finPaleUpPct}% · dark facing down ${metrics.finDarkDownPct}% · L/R gap ${metrics.finSideAsymPct}%`;
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
  id: "hammerhead-cephalofoil",
  title: "The Cephalofoil — Grey On Top, White Underneath, On BOTH Sides",
  subtitle: "A mirrored fin negates its span axis, which negates its normal: half the sharks in the ocean wore their belly on their back.",
  subjects,
  stage: stageCephalofoil,
  readyExpression: "window.THREE && window.CBZ && CBZ.WILDLIFE_SPECIES && CBZ.WILDLIFE_SPECIES.hammerhead_shark && CBZ.WILDLIFE_SPECIES.great_white_shark",
  frames: [{ id: "custom", label: "custom", width: 1400, height: 860, deviceScaleFactor: 1 }],
  stageTimeoutMs: 90000,
  metrics: {
    finPaleUpPct: { label: "Pale fin area facing UP", unit: "%", better: "lower" },
    finDarkDownPct: { label: "Dark fin area facing DOWN", unit: "%", better: "lower" },
    finSideAsymPct: { label: "Left/right pale-up gap", unit: "%", better: "lower" },
  },
  metricsNote:
    "Area-weighted over every COUNTERSHADED blade the fin grammar built — a single-material " +
    "blade (a caudal keel) has no belly to misplace and is not counted. A pale (belly) triangle whose world " +
    "normal points up is countershading painted on the wrong face; so is a dark (top) triangle " +
    "pointing down. The left/right gap is the owner's sentence as a number — one wing white from " +
    "above and the other grey means the two flanks disagree. All three should be 0.",
};
