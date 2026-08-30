/* DESERT WARLORD — cavalry, photographed against its own revert.

   THE CHANGE UNDER TEST is src/warlord/mounts.js: horses, camels and
   technicals as campaign speed AND as a battle arm. The honest BEFORE is
   therefore not a deployed build (which differs by every commit since deploy)
   but this same checkout with ?cfg_WARLORD_CAVALRY=0 — the one flag the file
   reverts on. With it off there is no such thing as cavalry, so every subject
   below asks for exactly the same thing and gets men on their own feet.

   THREE SUBJECTS, FOR THREE DIFFERENT FAILURES:

     seat        A rider floating above a saddle is the classic mounted-rider
                 bug (tools/visual-presets/mounted-riders.mjs exists because
                 somebody had to fix it), and it is invisible in motion and
                 obvious in a still. One rider, side on, orthographic, filling
                 the frame. `seatGap` is published beside it so the picture and
                 the number have to agree.
     column      The signature image: a column crossing a dune line. A film
                 strip, because the whole claim is about SPEED — a single
                 frame of a fast column and a slow one are the same picture,
                 and four frames a second and a half apart are not.
     charge      Cavalry landing on an infantry line. Also a strip: a charge
                 IS motion, and the thing worth seeing is the line coming
                 apart between frame two and frame four.

   The stage never builds a diorama: every body on screen comes out of
   W.mountsStudio, which is the same bake the campaign column and the battle
   use, so a repair here is a repair there. */

const SUBJECTS = [
  { id: "seat-horse", label: "Horse — Seat & Pose", mode: "rider", kind: "horse",
    focus: "Hips ON the saddle, not above it. Thighs wrap the barrel; boots hang down both flanks.",
    strip: null },
  { id: "seat-camel", label: "Camel — Seat & Pose", mode: "rider", kind: "camel",
    focus: "A narrower back than a horse: the same solver has to close the straddle, not splay it.",
    strip: null },
  { id: "seat-technical", label: "Technical — Gunner & Gun", mode: "rider", kind: "technical",
    focus: "The gunner stands on the bed deck behind the cab, at the armoury's own M249.",
    strip: null },
  { id: "column-dune", label: "The Column Crossing a Dune", mode: "column", kind: "horse",
    focus: "Four frames, 1.4 s apart, over identical simulated seconds. How far the party got is the whole campaign half.",
    strip: { frames: 4, stepSec: 1.4 } },
  { id: "charge", label: "A Charge Landing on a Levy Line", mode: "charge", kind: "horse",
    focus: "Five frames, 0.6 s apart. The wedge closes, lands on frame four, and rides through.",
    strip: { frames: 5, stepSec: 0.6 } },
];

async function stageCavalry(input) {
  const T = window.THREE;
  const CBZ = window.CBZ;
  const W = CBZ && CBZ.warlord;
  const MS = W && W.mountsStudio;
  const M = W && W.mounts;
  if (!T || !MS || !M) return { ok: false, missing: "CBZ.warlord.mountsStudio" };
  await MS.ready();

  const sub = input.subject;
  const W_ = input.width, H_ = input.height;

  let st = window.__cbzVisualCompare;
  if (!st) {
    document.documentElement.style.cssText = "margin:0;width:100%;height:100%;background:#0d1016";
    document.body.innerHTML = "";
    document.body.style.cssText = "margin:0;width:100%;height:100%;overflow:hidden;background:#0d1016;" +
      "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    const renderer = new T.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setSize(W_, H_, false);
    renderer.shadowMap.enabled = false;
    if (T.sRGBEncoding != null) renderer.outputEncoding = T.sRGBEncoding;
    renderer.domElement.style.cssText = `display:block;width:${W_}px;height:${H_}px`;
    document.body.appendChild(renderer.domElement);
    const overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;color:#f6efe2;" +
      "text-shadow:0 2px 9px #000;z-index:5";
    overlay.innerHTML = "<div data-side></div><div data-name></div><div data-focus></div>" +
      "<div data-state></div><div data-src></div>";
    document.body.appendChild(overlay);
    st = window.__cbzVisualCompare = { renderer, overlay, scene: null, camera: null, subject: null };
    st.render = function () { if (st.scene && st.camera) st.renderer.render(st.scene, st.camera); };
    /* THE STRIP HOOK. The runner calls this between captures; both sides get
       the identical simulated seconds because time only ever moves through
       here, in fixed 1/60 steps so a big step and sixty small ones agree. */
    st.advance = function (sec) {
      let left = Math.max(0, sec || 0);
      while (left > 1e-6) { const d = Math.min(1 / 60, left); if (st.subject) st.subject.step(d); left -= d; }
      st.render();
    };
    st.metrics = function () { return st.lastMetrics || {}; };
  }

  // every subject starts from a clean world: the instanced columns are cached
  // per kind, so two subjects sharing the horse would otherwise fight over one
  // buffer and the second would photograph the first's leftovers
  M.disposeColumns();
  /* LIGHT IT LIKE SAND, NOT LIKE A SHOWROOM. The first pass ran a 1.05
     hemisphere over a 1.55 key and blew every ground pixel to white — the
     column and the charge were both photographed against a blank page, and
     no metric would ever have said so. Total incident is under 1.4 now, the
     ground reads as sand, and the fog starts past the far edge of the
     subject instead of 120 m in front of it. */
  const scene = new T.Scene();
  scene.background = new T.Color(0x93aec8);
  scene.fog = new T.Fog(0xbdc9d4, 340, 1600);
  scene.add(new T.HemisphereLight(0xcfe2f7, 0x8a6a3c, 0.52));
  const key = new T.DirectionalLight(0xfff0d2, 0.92);
  key.position.set(-34, 46, 26);
  scene.add(key);
  const rim = new T.DirectionalLight(0x8fb6e8, 0.22);
  rim.position.set(30, 18, -34);
  scene.add(rim);

  const root = new T.Group();
  scene.add(root);

  /* THE DUNE IS ANALYTIC and it is the same function the debug pad uses, so
     "do the legs move with the ground" is asked on ground that actually
     moves. A flat pad cannot ask it. */
  /* A DUNE WITH RELIEF YOU CAN SEE. The pad's gentle ripple is right for a
     debug view and invisible at the range this camera stands off at, and
     "do the legs move with the ground" cannot be asked of ground that looks
     flat. Three octaves, ridge amplitude ~9 m over ~120 m, which is a real
     dune line rather than a wobble. */
  const dune = (x, z) =>
    Math.sin(x * 0.031) * 5.4 + Math.cos(z * 0.026) * 4.2 +
    Math.sin((x + z) * 0.011) * 3.1;
  const flatMode = sub.mode === "rider";
  const heightAt = flatMode ? null : dune;

  const SPAN = flatMode ? 60 : 620;
  const SEG = flatMode ? 2 : 90;
  const gg = new T.PlaneGeometry(SPAN, SPAN, SEG, SEG);
  gg.rotateX(-Math.PI / 2);
  if (!flatMode) {
    const p = gg.attributes.position;
    for (let i = 0; i < p.count; i++) p.setY(i, dune(p.getX(i), p.getZ(i)));
    gg.computeVertexNormals();
  }
  const ground = new T.Mesh(gg, new T.MeshLambertMaterial({ color: 0xb08a4e }));
  ground.position.y = flatMode ? -0.001 : 0;
  root.add(ground);

  let subject = null, metrics = {}, camPos, camTarget, ortho = null;
  const bake = MS.bake(sub.kind === "technical" ? "technical" : sub.kind);

  if (sub.mode === "rider") {
    subject = MS.rider(root, { kind: sub.kind, speed: sub.kind === "technical" ? 9 : 4.2 });
    if (!flatMode) subject.step(0);
    const b = MS.bake(subject.kind);
    /* ONE FIXED SCALE ACROSS EVERY SEAT SUBJECT AND BOTH SIDES, and this took
       two attempts to get right. Framing each side on its own subject's
       bounding box looks obviously correct and is wrong here, because the
       runner hands the AFTER side the BEFORE side's camera so the two
       pictures are comparable — and the before subject is a 1.86 m man while
       the after subject is a 3.2 m horse carrying him. The after side
       inherited a 2.3 m frame and photographed a shoulder.
       A constant 5.2 m of frame holds the tallest thing here (a camel and
       its rider, 3.32 m) and the longest (a technical, 4.6 m, which at this
       aspect needs 3.2 m of height) with room around it — so the man, the
       horse, the camel and the truck are all at the SAME scale, side by side
       and page to page, and the reader can compare them to each other as well
       as to their own before. */
    const framedH = 5.2;
    ortho = { framedH, y: 1.75 };
    camPos = [18, 2.35, 0.0001];
    camTarget = [0, 1.55, 0];
    metrics = { seatGap: Math.round((b.seatGap || 0) * 1000) / 10 };   // cm
  } else if (sub.mode === "column") {
    /* THE COLUMN RIDES OUT OF THE FRAME'S NEAR CORNER TOWARD THE RIDGE. Its
       head starts at the origin and the tail trails to z = -45, and the after
       side covers another ~24 m over the strip, so the camera has to hold
       roughly 70 m of column at a three-quarter angle. The first attempt put
       the head 150 m from the camera's own look-at and photographed empty
       sand on both sides. */
    subject = MS.column(root, {
      n: 9, kind: sub.kind, x: 0, z: 0, yaw: 0.05, spacing: 4.0, heightAt,
    });
    /* IN CLOSE ENOUGH TO SEE A HORSE. The first framing held the column in
       shot and made every rider four pixels tall, which answers "did they
       move" and not "is that a horse". 63 m of stand-off holds the 45 m
       column plus the ~24 m the mounted side covers over the strip, at a
       three-quarter angle so the column has depth instead of being a row. */
    camPos = [32, 12, 24];
    camTarget = [-2, 2.5, -13];
  } else {
    /* THE GAP HAS TO BE CROSSABLE INSIDE THE STRIP. The first version put the
       line 78 m from the start; five frames 0.45 s apart is 1.8 s, a gallop
       covers 27 m in that, and the strip photographed a charge that never
       arrived — every charge metric came back zero and the pictures agreed.
       27 m at 15 m/s lands the first impact at ~1.8 s, which is frame four of
       a 0.6 s strip: two frames closing, one landing, one aftermath. */
    subject = MS.charge(root, {
      kind: sub.kind, cav: 12, inf: 26, lineZ: 2, startZ: -20, heightAt,
    });
    /* BOTH FORMATIONS, WHOLE, WITH THE ACTION IN THE MIDDLE OF THE FRAME.
       The first camera put the wedge half off the right edge on frame one
       and left the bottom two-thirds of the picture as empty sand. Standing
       off 52 m on the flank gives ~58 m of frame width, which holds the line
       at z=+2, the wedge's tail at z=-30, and the ~36 m it rides through —
       and it centres the IMPACT rather than the empty ground before it, so
       the strip's last frame is the wedge inside the line and not the wedge
       leaving the picture. */
    camPos = [50, 17, -6];
    camTarget = [-2, 1.6, -6];
  }
  st.subject = subject;

  const aspect = W_ / H_;
  const ref = input.referenceStage && input.referenceStage.camera;
  let camera;
  if (ortho) {
    const fh = ref ? ref.framedHeight : ortho.framedH;
    camera = new T.OrthographicCamera(-fh * aspect / 2, fh * aspect / 2, fh / 2, -fh / 2, 0.01, 400);
    camera.position.fromArray(ref ? ref.position : camPos);
    camera.lookAt(new T.Vector3().fromArray(ref ? ref.target : camTarget));
    camera.updateProjectionMatrix();
  } else {
    camera = new T.PerspectiveCamera(38, aspect, 0.5, 2200);
    camera.position.fromArray(ref ? ref.position : camPos);
    camera.lookAt(new T.Vector3().fromArray(ref ? ref.target : camTarget));
  }
  st.scene = scene;
  st.camera = camera;
  st.renderer.setSize(W_, H_, false);
  st.render();

  /* THE CAMPAIGN NUMBERS, read off the module rather than restated here. A
     fully mounted party against a walking one, over the island's own 14 km. */
  const ISLAND_M = 14000;
  const HOUR_PER_M = 0.00062;
  const foot = 1.35;
  const pace = subject.pace != null ? subject.pace : (subject.mounted === false ? foot : 4.2);
  const days = ISLAND_M * HOUR_PER_M * (foot / pace) / 24;

  if (sub.mode === "column") {
    metrics.partyPace = Math.round(pace * 100) / 100;
    metrics.crossDays = Math.round(days * 100) / 100;
    // what the crossing costs a 40-man force at core's own wage ladder
    metrics.crossWages = Math.round(days * 84);
  }
  if (sub.mode === "charge") {
    metrics.chargeImpacts = 0;
    metrics.chargeShock = 0;
  }

  st.lastMetrics = metrics;
  /* THE STRIP'S NUMBERS ARE SAMPLED OVER THE PHOTOGRAPHED FRAMES, not at
     stage time, or the report would caption a moving picture with a standing
     start. metrics() is re-read after the last capture. */
  const baseZ = subject.z != null ? subject.z : 0;
  st.metrics = function () {
    const m = Object.assign({}, metrics);
    if (sub.mode === "column") m.columnAdvance = Math.round((subject.dist || 0) * 10) / 10;
    if (sub.mode === "charge") {
      m.chargeImpacts = subject.impacts || 0;
      m.chargeShock = Math.round(subject.damage || 0);
      m.lineStanding = subject.foot.filter((f) => !f.down).length;
    }
    return m;
  };

  const before = input.side === "before";
  const o = st.overlay;
  const q = (s) => o.querySelector(s);
  q("[data-side]").textContent = before ? input.beforeLabel : input.afterLabel;
  q("[data-side]").style.cssText = "position:absolute;top:22px;left:26px;padding:7px 11px;border-radius:7px;" +
    `background:${before ? "#b8433c" : "#1f8459"};font-size:12px;font-weight:900;letter-spacing:.12em`;
  q("[data-name]").textContent = sub.label;
  q("[data-name]").style.cssText = "position:absolute;top:64px;left:26px;font-size:28px;font-weight:800;letter-spacing:-.02em";
  q("[data-focus]").textContent = sub.focus;
  q("[data-focus]").style.cssText = "position:absolute;top:101px;left:28px;color:#d8cdb8;font-size:13px;font-weight:550;max-width:720px";
  q("[data-state]").textContent = before
    ? "ON FOOT · " + Math.round(foot * 100) / 100 + " m/s"
    : (sub.mode === "rider" ? "SEATED · GAP " + (metrics.seatGap || 0) + " cm"
      : sub.kind.toUpperCase() + " · " + pace + " m/s");
  q("[data-state]").style.cssText = `position:absolute;right:24px;top:23px;color:${before ? "#ffb1ab" : "#83e7b7"};` +
    "font-size:11px;font-weight:850;letter-spacing:.11em";
  q("[data-src]").textContent = new URL(input.sourceUrl).host + new URL(input.sourceUrl).pathname;
  q("[data-src]").style.cssText = "position:absolute;bottom:18px;left:26px;color:#a9b6c2;" +
    "font:11px ui-monospace,SFMono-Regular,Menlo,monospace";

  return {
    ok: true,
    subject: sub.id,
    mounted: subject.mounted !== false,
    kind: subject.kind,
    seatGap: bake ? Math.round((bake.seatGap || 0) * 1000) / 10 : null,
    drawCalls: countDraws(root),
    metrics: st.metrics(),
    camera: {
      framedHeight: ortho ? ortho.framedH : 0,
      position: (ref ? ref.position : camPos).slice(),
      target: (ref ? ref.target : camTarget).slice(),
    },
  };

  function countDraws(g) {
    let n = 0;
    g.traverse((o2) => { if (o2.isMesh || o2.isInstancedMesh) n++; });
    return n;
  }
}

export default {
  id: "warlord-cavalry",
  title: "Desert Warlord: Nobody Rides → Cavalry",
  description:
    "Horses, camels and technicals as campaign speed and as a battle arm. The BEFORE side is this same " +
    "checkout with ?cfg_WARLORD_CAVALRY=0, so the only difference between the two sides is the one flag " +
    "src/warlord/mounts.js reverts on: with it off there is no cavalry and the same party walks.",
  page: "games/warlord.html",
  defaultBefore: "local",
  beforeParams: { cfg_WARLORD_CAVALRY: 0 },
  beforeLabel: "BEFORE · ON FOOT",
  afterLabel: "AFTER · MOUNTED",
  viewport: { width: 1180, height: 700 },
  /* NO ?go=1. The stage replaces document.body with its own studio, so
     booting the campaign would spend thirty seconds raising 14 km of terrain
     that nothing photographs — and on a loaded box that alone pushed the
     runner past its readiness budget. The seed still pins the world in case a
     future subject wants the real island under the column. */
  urlParams: { seed: 1337 },
  stageTimeoutMs: 120000,
  readyExpression:
    "window.__warlordReady && window.CBZ && CBZ.warlord && CBZ.warlord.mountsStudio && CBZ.warlord.mounts",
  subjects: SUBJECTS,
  stage: stageCavalry,
  metrics: {
    seatGap: { label: "Rider hip above the saddle", unit: "cm", better: "lower" },
    partyPace: { label: "Party cross-country pace", unit: "m/s", better: "higher" },
    crossDays: { label: "Days to cross the island (14 km)", unit: "d", better: "lower" },
    crossWages: { label: "Wages burnt on one crossing", unit: "$", better: "lower" },
    columnAdvance: { label: "Ground covered over the strip", unit: "m", better: "higher" },
    chargeImpacts: { label: "Men ridden down", unit: "men", better: "higher" },
    chargeShock: { label: "Shock damage delivered", unit: "hp", better: "higher" },
    lineStanding: { label: "Levies still standing", unit: "men", better: "lower" },
  },
  metricsNote:
    "The campaign numbers are read off W.mounts against the island's real 14 km and core.js's own wage " +
    "ladder; the charge numbers come out of the same impact() the battle calls, sampled over exactly the " +
    "frames the strip photographed.",
};
