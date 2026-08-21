/* OURS vs A DIFFERENT MODEL'S — tools/visual-compare.mjs preset.

   OWNER: "ask it to make a three js shark, show it yours and say I don't like
   the mouth, have it make one, and then show me a pdf of it."

   So this is a head-to-head, and the before/after harness turns out to be
   exactly the right shape for it without any modification: the two columns
   were built to hold two BUILDS of the same page, and "two authors' answers to
   the same brief" is the same comparison with a different variable. The stage
   branches on `input.side` — the BEFORE column renders this repo's own mouth,
   the AFTER column renders the one stealth/ox-alpha wrote — at identical
   cameras, identical lights, identical gape values. Nothing else differs, so
   the difference is the design.

   WHERE THE OTHER MODEL'S CODE COMES FROM. It is read off disk at import time
   and carried into the browser inside the subject payload, because a preset's
   `stage` is stringified and cannot close over anything. The generated source
   is never imported by the game and never runs anywhere but this report — it
   is a photograph of somebody else's answer, not a dependency.

   IT IS ALLOWED TO FAIL, and failing is a result. A model's first draft of 300
   lines of r128 geometry may simply throw; when it does, the AFTER frame says
   so on the page with the error on it, rather than the run dying. A picture of
   the wreck beats an empty slot — the same rule --keep-going follows. */

import { readFile } from "node:fs/promises";

const OX_PATH = process.env.OX_MOUTH ||
  "/tmp/claude-0/-home-user-gta6/69ee2b68-117c-55ca-96c1-e832ba98645c/scratchpad/ox/mouth.js";

let oxSource = "";
try { oxSource = await readFile(OX_PATH, "utf8"); } catch (_) { oxSource = ""; }
// Models fence code even when told not to; strip it rather than fail the run.
oxSource = oxSource.replace(/^\s*```[a-zA-Z]*\s*$/gm, "").trim();

const ANGLES = [
  { id: "head-on", label: "Head-On Into The Gape", gape: 1,
    dir: [1, 0.05, 0.03], frame: 1.7,
    focus: "The centre of the frame must be a receding hole: pale jaw skin, a wet gum RIM, the tooth ring, then dark falling to near-black. Nothing in the opening may read as convex." },
  { id: "gape-3q", label: "Full Gape, Three-Quarter", gape: 1,
    dir: [0.85, 0.20, 0.55], frame: 1.9,
    focus: "The money shot. The upper jaw should have slid FORWARD and DOWN out from under the snout, so the upper tooth row sits ahead of the closed-mouth rostrum tip." },
  { id: "half", label: "Half Gape", gape: 0.5,
    dir: [0.8, 0.16, 0.62], frame: 1.9,
    focus: "Mid-opening. The protrusion should be underway, not switched on at the end — and the cavity should already be dark." },
  { id: "closed", label: "Closed", gape: 0,
    dir: [0.35, 0.12, 1], frame: 2.1,
    focus: "Shut, from the side. The mouth must read as a dark closed seam under the snout, with nothing of the cavity or the gums poking through." },
];

const subjects = ANGLES.map((a) => ({
  id: a.id, label: a.label, gape: a.gape, dir: a.dir, frame: a.frame, focus: a.focus,
  state: `GAPE ${Math.round(a.gape * 100)}%`,
  oxSource,
}));

function stageMouth(input) {
  const T = window.THREE, CBZ = window.CBZ, subject = input.subject;
  if (!T) return { ok: false, missing: "THREE" };
  const isOx = input.side === "after";

  let studio = window.__cbzVisualCompare;
  if (!studio) {
    document.documentElement.style.cssText = "margin:0;width:100%;height:100%;background:#08202b";
    document.body.innerHTML = "";
    document.body.style.cssText = "margin:0;width:100%;height:100%;overflow:hidden;background:#08202b;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    const renderer = new T.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1); renderer.setSize(input.width, input.height, false);
    if (T.sRGBEncoding != null) renderer.outputEncoding = T.sRGBEncoding;
    renderer.domElement.style.cssText = `display:block;width:${input.width}px;height:${input.height}px`;
    document.body.appendChild(renderer.domElement);
    const overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;color:#f3fbff;text-shadow:0 2px 10px #00121b;z-index:5";
    overlay.innerHTML = "<div data-side></div><div data-name></div><div data-focus></div><div data-state></div><div data-metric></div><div data-err></div>";
    document.body.appendChild(overlay);
    studio = window.__cbzVisualCompare = { renderer, overlay, scene: null, camera: null };
    studio.render = function () { if (studio.scene && studio.camera) studio.renderer.render(studio.scene, studio.camera); };
  }

  const scene = new T.Scene();
  scene.background = new T.Color(0x08202b);
  scene.add(new T.HemisphereLight(0xd6f2ff, 0x06161f, 0.62));
  const key = new T.DirectionalLight(0xffffff, 0.86); key.position.set(7, 9, 8); scene.add(key);
  const rim = new T.DirectionalLight(0x54cbff, 0.34); rim.position.set(-7, 2, -7); scene.add(rim);
  // A light INTO the mouth, because the claim under test is about what the
  // inside looks like and an unlit cavity is dark for the wrong reason.
  const maw = new T.DirectionalLight(0xffd0c4, 0.5); maw.position.set(9, 1, 2); scene.add(maw);

  let group = null, err = null, built = "";

  if (!isOx) {
    /* OURS. The real registered species out of the live game — not a replica —
       posed through the same jaw driver the game uses, so the left column is
       the shipped animal and not a reconstruction of it. */
    const sp = CBZ && CBZ.WILDLIFE_SPECIES && CBZ.WILDLIFE_SPECIES.great_white_shark;
    if (!sp || typeof sp.build !== "function") return { ok: false, missing: "great_white_shark" };
    const mats = new Map();
    const mat = function (c) {
      const k = Number(c == null ? 0x78858d : c);
      if (!mats.has(k)) mats.set(k, new T.MeshStandardMaterial({ color: k, roughness: 0.72, metalness: 0.01, flatShading: true }));
      return mats.get(k);
    };
    try {
      group = sp.build({ THREE: T, mat: mat, rng: function () { return 0.25; } });
      group.scale.setScalar(Number(sp.scale) || 1);
      const actor = { species: sp, group: group, pos: group.position, heading: 0, faceH: 0, dead: false };
      if (CBZ.buildSwimRig) { try { CBZ.buildSwimRig(actor); } catch (e) {} }
      if (CBZ.swimJaw) { try { CBZ.swimJaw(actor, subject.gape); } catch (e) {} }
      built = "this repo · registered species";
    } catch (e) { err = String(e && e.message || e); }
  } else {
    /* THEIRS. Evaluated in an isolated Function so a syntax error or a missing
       r128 symbol is caught and PHOTOGRAPHED rather than taking the run down. */
    const src = subject.oxSource || "";
    if (!src) err = "no generated source on disk (OX_MOUTH)";
    else {
      try {
        const factory = new Function("THREE",
          src + "\nreturn { buildSharkMouth: typeof buildSharkMouth === 'function' ? buildSharkMouth : null," +
          " setGape: typeof setGape === 'function' ? setGape : null };");
        const api = factory(T);
        if (!api.buildSharkMouth) throw new Error("buildSharkMouth not defined by the generated source");
        group = api.buildSharkMouth(T, {});
        if (!group) throw new Error("buildSharkMouth returned nothing");
        if (api.setGape) api.setGape(group, subject.gape);
        built = "stealth/ox-alpha · generated";
      } catch (e) { err = String(e && e.message || e); }
    }
  }

  let parts = 0, tris = 0, size = new T.Vector3(), centre = new T.Vector3();
  if (group) {
    group.updateMatrixWorld(true);
    scene.add(group);
    group.traverse(function (o) {
      if (!o.isMesh || !o.geometry) return;
      parts++;
      const g = o.geometry;
      const idx = g.index ? g.index.count : (g.attributes && g.attributes.position ? g.attributes.position.count : 0);
      tris += Math.floor(idx / 3);
    });
    const box = new T.Box3().setFromObject(group);
    box.getSize(size); box.getCenter(centre);
  }

  /* AIM AT THE MOUTH, and find it rather than assume it. Ours is a whole 6 m
     shark whose jaw sits near the nose; theirs is a bare mouth whose origin is
     the hinge. Framing both off a bounding-box centre would photograph our
     midriff, so the aim point is the FRONT of whatever was built. */
  const aspect = input.width / input.height;
  const ref = input.referenceStage && input.referenceStage.camera;
  const span = Math.max(size.x, size.y, size.z) || 1;
  const aim = group
    ? [centre.x + size.x * 0.34, centre.y + size.y * 0.02, centre.z]
    : [0, 0, 0];
  const dist = span * 3 + 4;
  const d = new T.Vector3().fromArray(subject.dir).normalize().multiplyScalar(dist);
  const framed = Number(subject.frame) || 2;
  const camera = new T.OrthographicCamera(-framed * aspect / 2, framed * aspect / 2, framed / 2, -framed / 2, 0.01, dist * 5);
  // Each side frames its OWN geometry: the two authors were given the same
  // brief, not the same coordinates, so copying the camera across would
  // photograph one of them off-centre and call that the comparison.
  camera.position.set(aim[0] + d.x, aim[1] + d.y, aim[2] + d.z);
  camera.up.set(0, 1, 0);
  camera.lookAt(new T.Vector3().fromArray(aim));
  camera.updateProjectionMatrix();
  void ref;

  studio.scene = scene; studio.camera = camera;
  studio.renderer.setSize(input.width, input.height, false);
  studio.renderer.render(scene, camera);

  const ov = studio.overlay;
  const sideEl = ov.querySelector("[data-side]");
  sideEl.textContent = isOx ? "STEALTH/OX-ALPHA" : "THIS REPO";
  sideEl.style.cssText = `position:absolute;top:22px;left:26px;padding:7px 11px;border-radius:7px;background:${isOx ? "#186f8e" : "#6b4a1f"};font-size:12px;font-weight:900;letter-spacing:.12em`;
  const nm = ov.querySelector("[data-name]"); nm.textContent = subject.label;
  nm.style.cssText = "position:absolute;top:64px;left:27px;font-size:27px;font-weight:850;letter-spacing:-.025em";
  const fo = ov.querySelector("[data-focus]"); fo.textContent = subject.focus;
  fo.style.cssText = "position:absolute;top:102px;left:28px;color:#bfd8e4;font-size:13px;font-weight:550;max-width:760px;line-height:1.35";
  const st = ov.querySelector("[data-state]"); st.textContent = subject.state;
  st.style.cssText = `position:absolute;right:26px;top:25px;color:${isOx ? "#8fe3ff" : "#ffd79a"};font-size:11px;font-weight:900;letter-spacing:.1em`;
  const me = ov.querySelector("[data-metric]");
  me.textContent = group ? `${parts} meshes · ${tris} tris · ${built}` : "FAILED TO BUILD";
  me.style.cssText = "position:absolute;right:26px;bottom:20px;padding:7px 10px;border-radius:6px;background:rgba(2,16,24,.78);color:#bfeeff;font:11px ui-monospace,SFMono-Regular,Menlo,monospace";
  const ee = ov.querySelector("[data-err]");
  ee.textContent = err ? ("ERROR: " + err).slice(0, 300) : "";
  ee.style.cssText = "position:absolute;left:28px;bottom:20px;max-width:70%;color:#ff9a9a;font:12px ui-monospace,SFMono-Regular,Menlo,monospace";

  return {
    ok: true,
    author: isOx ? "ox-alpha" : "repo",
    built: !!group,
    error: err,
    metrics: { meshes: parts, triangles: tris, buildFailed: group ? 0 : 1 },
    camera: { position: camera.position.toArray(), target: aim, up: [0, 1, 0], framedHeight: framed },
  };
}

export default {
  title: "The Mouth: This Repo vs stealth/ox-alpha",
  subtitle: "Same brief, same cameras, same gape values. Left is the shipped shark, right is what another model wrote when shown it.",
  subjects,
  stage: stageMouth,
  /* The left column poses the REAL registered species, so the page has to be
     far enough up to have a bestiary — not just a DOM. Same readiness the
     other species presets wait on. */
  readyExpression: "window.CBZ && window.THREE && CBZ.WILDLIFE_SPECIES && CBZ.WILDLIFE_SPECIES.great_white_shark",
  defaultBefore: "local",
  frames: [{ id: "custom", label: "custom", width: 1200, height: 780, deviceScaleFactor: 1 }],
  stageTimeoutMs: 120000,
  metrics: {
    meshes: { label: "Meshes" },
    triangles: { label: "Triangles" },
    buildFailed: { label: "Build failed", better: "lower" },
  },
  metricsNote:
    "Counts, not verdicts — this is a comparison of two designs and the pictures decide. " +
    "'Build failed' is the only one that votes: generated code that throws is photographed with " +
    "its error rather than silently skipped.",
};
