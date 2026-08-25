/* Marine tail attachment + fast-swim steering — a SELF A/B on this checkout.

   OWNER (2026-08-25): "when the shark or orca move fast, first sometimes their
   bodies move glitchy — fast left-right movement — and the tail visibly
   DISCONNECTS from the body. For orca the (vertical) disconnect, for sharks
   the horizontal disconnect."

   Both columns load THIS checkout. The BEFORE column carries
   ?cfg_MARINE_TAIL_V2=0&cfg_MARINE_STEER_V2=0, so city/wildlife_rig.js runs its
   old translate-the-whole-fin swim loop and city/waterfield.js runs its old
   flat +/-0.34-rad-per-FRAME shore steering. Nothing else differs: same
   species builders, same rig, same real elapsed seconds, same camera.

   THE TAIL PAGES ARE A MOTION STRIP, not a pose. Each subject declares a
   fraction of ONE TAIL BEAT and the stage advances the production animator
   (CBZ.animateSwim) at 60 Hz for that many real seconds while the body travels
   at a real rush speed — the same thing the swim mover does every frame in the
   city. Four consecutive beats of one cycle read as motion; a single still
   cannot show a joint coming apart and going back together.

   THE STEERING PAGE runs the production city/waterfield.js moveInWater over a
   SYNTHETIC analytic coastline (bound through the module's own bindArena, so
   the steering code under test is byte-for-byte the shipped one) and draws the
   integrated track plus the per-frame heading delta. A 60 Hz yaw strobe is not
   photographable in a still; its TRACK is.
*/

const BEAT = [0, 0.25, 0.5, 0.75];
const RUSH = 22;                       // u/s — a committed shark rush

function strip(species, plane, tag) {
  return BEAT.map(function (f, i) {
    return {
      id: species.replace(/_/g, "-") + "-beat-" + i,
      kind: "tail", species: species, beatFrac: f, speed: RUSH, view: plane,
      label: tag + " — Rush, Beat " + (i + 1) + " of 4",
      focus: plane === "plan"
        ? "Plan view, the shark's own plane. The caudal peduncle must stay inside the hull's tail as it sweeps: look at the line where the tail leaves the body, not at the fin tip."
        : "Profile, the orca's own plane. The peduncle must stay welded to the hull's tail as the fluke drives up and down.",
      state: "RUSH " + RUSH + " u/s · BEAT " + Math.round(f * 100) + "%",
      metric: "Weld displacement at the trunk seam, this frame",
    };
  });
}

const subjects = [].concat(
  strip("great_white_shark", "plan", "Great White"),
  strip("orca", "profile", "Orca"),
  [
    {
      id: "great-white-joint-closeup", kind: "tail", species: "great_white_shark",
      beatFrac: 0.25, speed: RUSH, view: "plan", closeup: true,
      label: "Great White — The Tail Root, At Peak Sweep",
      focus: "The joint itself at maximum sweep. Before, the whole peduncle slides sideways off a hull that never moved; after, the seam is the pivot and only the far end travels.",
      state: "CLOSE-UP · PEAK SWEEP", metric: "Peduncle-to-hull seam displacement",
    },
    {
      id: "orca-joint-closeup", kind: "tail", species: "orca",
      beatFrac: 0.25, speed: RUSH, view: "profile", closeup: true,
      label: "Orca — The Tail Root, At Peak Sweep",
      focus: "The same joint on the cetacean, in the vertical plane. The peduncle should hinge out of the hull, not step away from it.",
      state: "CLOSE-UP · PEAK SWEEP", metric: "Peduncle-to-hull seam displacement",
    },
    {
      id: "steering-track", kind: "steer", speed: RUSH,
      label: "Steering — 8 s Of Coast-Hugging Rush",
      focus: "The production moveInWater, driven over an analytic coast. The upper trace is the path; the lower strip is per-frame heading change. Before: a bang-bang feeler flipping the yaw by up to a third of a radian in ONE frame. After: one arc, capped by distance travelled.",
      state: "RUSH " + RUSH + " u/s · 60 Hz", metric: "Peak yaw rate and per-frame snaps",
    },
  ]
);

export function stageMarineTail(input) {
  const T = window.THREE, CBZ = window.CBZ;
  const subject = Object.assign({}, input.subject);
  if (!T || !CBZ || !CBZ.WILDLIFE_SPECIES || !CBZ.buildSwimRig || !CBZ.animateSwim) {
    return { ok: false, missing: "swim rig APIs" };
  }
  // determinism: a seeded stream, so both columns and every rerun agree.
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
    studio = window.__cbzVisualCompare = { renderer, overlay, scene: null, camera: null };
    studio.render = function () { if (studio.scene && studio.camera) studio.renderer.render(studio.scene, studio.camera); };
  }

  const materials = new Map();
  function animalMaterial(color) {
    const key = Number(color == null ? 0x78858d : color);
    if (!materials.has(key)) materials.set(key, new T.MeshStandardMaterial({
      color: key, roughness: 0.68, metalness: 0.015, flatShading: true,
    }));
    return materials.get(key);
  }
  function makeAnimal(id) {
    const species = CBZ.WILDLIFE_SPECIES[id];
    if (!species || typeof species.build !== "function") return null;
    const group = species.build({ THREE: T, mat: animalMaterial, rng: () => 0.25 });
    group.scale.setScalar(Number(species.scale) || 1);
    group.traverse(o => { o.matrixAutoUpdate = true; });
    const actor = { species, group, pos: group.position, heading: 0, faceH: 0, dead: false };
    CBZ.buildSwimRig(actor);
    return actor;
  }

  function lights(scene, bg) {
    scene.background = new T.Color(bg);
    scene.add(new T.HemisphereLight(0xccefff, 0x041019, 1.10));
    const key = new T.DirectionalLight(0xffffff, 1.5); key.position.set(4, 12, 9); scene.add(key);
    const rim = new T.DirectionalLight(0x42c8ff, 0.8); rim.position.set(-9, 5, -8); scene.add(rim);
  }

  function paint(extraPhase, metricLine) {
    const after = input.side === "after", overlay = studio.overlay;
    const side = overlay.querySelector("[data-side]");
    side.textContent = after ? input.afterLabel : input.beforeLabel;
    side.style.cssText = `position:absolute;top:23px;left:27px;padding:7px 11px;border-radius:7px;background:${after ? "#187e5a" : "#bd4848"};font-size:12px;font-weight:900;letter-spacing:.12em`;
    const name = overlay.querySelector("[data-name]"); name.textContent = subject.label;
    name.style.cssText = "position:absolute;top:67px;left:28px;font-size:26px;font-weight:850;letter-spacing:-.025em";
    const focus = overlay.querySelector("[data-focus]"); focus.textContent = subject.focus;
    focus.style.cssText = "position:absolute;top:103px;left:29px;color:#c2d5df;font-size:13px;font-weight:550;max-width:780px;line-height:1.35";
    const state = overlay.querySelector("[data-state]"); state.textContent = subject.state;
    state.style.cssText = `position:absolute;right:27px;top:26px;color:${after ? "#7df0b8" : "#ffaaaa"};font-size:11px;font-weight:900;letter-spacing:.1em`;
    const phase = overlay.querySelector("[data-phase]"); phase.textContent = extraPhase;
    phase.style.cssText = "position:absolute;right:28px;top:54px;color:#d7eef8;font:12px ui-monospace,SFMono-Regular,Menlo,monospace";
    const metric = overlay.querySelector("[data-metric]"); metric.textContent = metricLine;
    metric.style.cssText = "position:absolute;right:27px;bottom:22px;padding:7px 10px;border-radius:6px;background:rgba(3,18,28,.76);color:#bfeeff;font:11px ui-monospace,SFMono-Regular,Menlo,monospace";
    const source = overlay.querySelector("[data-source]"); source.textContent = new URL(input.sourceUrl).host + new URL(input.sourceUrl).pathname;
    source.style.cssText = "position:absolute;bottom:22px;left:28px;color:#91aab7;font:11px ui-monospace,SFMono-Regular,Menlo,monospace";
  }

  // ======================================================================
  //  THE TAIL PAGES
  // ======================================================================
  if (subject.kind === "tail") {
    const actor = makeAnimal(subject.species);
    if (!actor || !actor.swim) return { ok: false, missing: subject.species + " swim rig" };
    const g = actor.group, rig = actor.swim, sc = g.scale.x || 1;
    const DT = 1 / 60, WARM = 1.5;

    // ---- the weld probes: where each tail part LEAVES the rigid trunk -----
    // v1 rigs have no anchor of their own, so the probe derives one the same
    // way v2 does — the rear-most point of every mesh that is not a tail part.
    const bb = (m, mat) => {
      if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
      return new T.Box3().copy(m.geometry.boundingBox).applyMatrix4(mat);
    };
    const restOf = (m, p) => new T.Matrix4().compose(
      p ? new T.Vector3(p.bx, p.by, p.bz) : m.position.clone(),
      new T.Quaternion().setFromEuler(new T.Euler(m.rotation.x, p ? p.ry : m.rotation.y, p ? p.rz : m.rotation.z, m.rotation.order)),
      m.scale.clone());
    let anchorX = Infinity, spineY = 0, spineZ = 0, hullBox = null;
    const probes = [];
    for (const m of g.children) {
      if (!m || !m.isMesh) continue;
      const p = rig.parts.find(q => q.m === m) || null;
      const M = restOf(m, p), box = bb(m, M);
      if (!p) {
        if (box.min.x < anchorX) {
          anchorX = box.min.x; hullBox = box;
          spineY = (box.min.y + box.max.y) * 0.5; spineZ = (box.min.z + box.max.z) * 0.5;
        }
        continue;
      }
      probes.push({ m: m, M: M, box: box });
    }
    for (const pr of probes) {
      if (!(pr.box.min.x <= anchorX && pr.box.max.x > anchorX)) { pr.skip = true; continue; }
      const w = new T.Vector3(anchorX,
        Math.max(pr.box.min.y, Math.min(pr.box.max.y, spineY)),
        Math.max(pr.box.min.z, Math.min(pr.box.max.z, spineZ)));
      pr.world = w.clone();
      pr.local = w.clone().applyMatrix4(new T.Matrix4().copy(pr.M).invert());
    }
    // the tail tip, so the strip also proves the whip survived
    let tipPart = probes[0], tipMin = Infinity;
    for (const pr of probes) if (pr.box.min.x < tipMin) { tipMin = pr.box.min.x; tipPart = pr; }
    const tipLocal = new T.Vector3(tipPart.box.min.x, (tipPart.box.min.y + tipPart.box.max.y) / 2,
      (tipPart.box.min.z + tipPart.box.max.z) / 2);
    const tipRest = tipLocal.clone();
    tipLocal.applyMatrix4(new T.Matrix4().copy(tipPart.M).invert());

    // ---- run the PRODUCTION animator for real elapsed seconds -------------
    const phStep = Math.min(subject.speed * rig.freq * DT, DT * 24) + DT * 0.9;
    const beatS = phStep > 0 ? (6.283185307 / (phStep / DT)) : 0.25;
    const elapsed = WARM + subject.beatFrac * beatS;
    rig.px = null; rig.pz = null; rig.py = null; rig.ph = 0; rig.k = 0;
    if (rig.spd01 != null) rig.spd01 = 0;
    g.position.set(0, 0, 0); g.rotation.set(0, 0, 0);
    const steps = Math.max(1, Math.round(elapsed / DT));
    for (let i = 0; i < steps; i++) {
      g.position.x += subject.speed * DT;
      g.rotation.y = 0;                          // the mover rewrites yaw every frame
      CBZ.animateSwim(actor, DT);
    }
    const bodyYaw = g.rotation.y;
    g.position.set(0, 0, 0); g.rotation.y = bodyYaw;
    g.updateMatrixWorld(true);

    let weldGapM = 0;
    const _p = new T.Vector3();
    for (const pr of probes) {
      if (pr.skip) continue;
      pr.m.updateMatrix();
      _p.copy(pr.local).applyMatrix4(pr.m.matrix);
      const d = _p.distanceTo(pr.world) * sc;
      if (d > weldGapM) weldGapM = d;
    }
    tipPart.m.updateMatrix();
    _p.copy(tipLocal).applyMatrix4(tipPart.m.matrix);
    const tipOffsetM = Math.abs(rig.vert ? (_p.y - tipRest.y) : (_p.z - tipRest.z)) * sc;

    const scene = new T.Scene();
    lights(scene, 0x061824);
    scene.fog = new T.Fog(0x061824, 26, 74);
    scene.add(g);

    const jointX = anchorX * sc, tipX = tipMin * sc, spY = spineY * sc;
    const aspect = input.width / input.height;
    const ref = input.referenceStage && input.referenceStage.camera;
    const bodyLen = (hullBox ? (hullBox.max.x - hullBox.min.x) : 4) * sc;
    const framedHeight = ref ? ref.framedHeight
      : (subject.closeup ? Math.max(1.2, (jointX - tipX) * 2.6) : bodyLen * 1.30);
    const tgt = subject.closeup ? [(jointX + tipX) * 0.5, spY, 0] : [bodyLen * 0.06, spY, 0];
    const plan = subject.view === "plan";
    const off = plan ? [0, 26, 0] : [0, 0.6, 26];
    const camera = new T.OrthographicCamera(-framedHeight * aspect / 2, framedHeight * aspect / 2,
      framedHeight / 2, -framedHeight / 2, 0.01, 260);
    const cameraTarget = ref ? ref.target : tgt;
    const cameraPosition = ref ? ref.position : [cameraTarget[0] + off[0], cameraTarget[1] + off[1], cameraTarget[2] + off[2]];
    const cameraUp = ref ? ref.up : (plan ? [0, 0, -1] : [0, 1, 0]);
    camera.position.fromArray(cameraPosition); camera.up.fromArray(cameraUp);
    camera.lookAt(new T.Vector3().fromArray(cameraTarget)); camera.updateProjectionMatrix();
    studio.scene = scene; studio.camera = camera;
    studio.renderer.setSize(input.width, input.height, false);
    studio.renderer.render(scene, camera);

    paint(`T + ${(subject.beatFrac * beatS).toFixed(3)} s of a ${beatS.toFixed(3)} s beat`,
      `weld ${weldGapM.toFixed(3)} m  ·  tip ${tipOffsetM.toFixed(3)} m`);

    return {
      ok: true, species: subject.species,
      plane: rig.vert ? "vertical (fluke)" : "horizontal (caudal)",
      tailV2: !!(CBZ.CONFIG && CBZ.CONFIG.MARINE_TAIL_V2 !== false && rig.tspan > 0),
      metrics: {
        weldGapM: Number(weldGapM.toFixed(4)),
        tailTipOffsetM: Number(tipOffsetM.toFixed(4)),
        beatS: Number(beatS.toFixed(4)),
      },
      camera: { framedHeight, position: cameraPosition.slice(), target: cameraTarget.slice(), up: cameraUp.slice() },
    };
  }

  // ======================================================================
  //  THE STEERING PAGE — production moveInWater over an analytic channel
  //
  //  A 60 Hz yaw strobe cannot be photographed in a still, so this page plots
  //  it. The steering function under test is the shipped one; only the coast
  //  is synthetic, and it is bound through waterfield.js's own bindArena so
  //  coastAt() reads it exactly the way it reads the continent.
  // ======================================================================
  const wf = CBZ.waterField;
  if (!wf || !wf.moveInWater || !wf.bindArena) return { ok: false, missing: "waterField.moveInWater" };
  // A WINDING CHANNEL, land on both banks — the case a fast body actually has
  // to steer through, and the case where the old feeler branch chattered.
  const mid = (x) => 21 * Math.sin(x / 34) + 8 * Math.sin(x / 13 + 0.7);
  const HALF = 19;
  wf.bindArena({
    minX: -1e6, maxX: 1e6, minZ: -1e6, maxZ: 1e6, regions: [],
    mapTerrain: { shoreAt: (x, z) => (Math.abs(z - mid(x)) - HALF) * 0.92 },
  });

  const DT = 1 / 60, SECS = 8, CLEAR = 8;
  const nav = { x: 0, z: 0, heading: 0, blocked: false, shore: 0 };
  let px = -140, pz = mid(-140), ph2 = 0.30, maxRate = 0, snaps = 0, blocked = 0;
  const head = [], deltas = [];
  const N = Math.round(SECS / DT);
  for (let i = 0; i < N; i++) {
    const r = wf.moveInWater(px, pz, ph2, subject.speed * DT, CLEAR, i * DT, nav);
    let d = r.heading - ph2;
    while (d > Math.PI) d -= 6.283185307; while (d < -Math.PI) d += 6.283185307;
    if (Math.abs(d) / DT > maxRate) maxRate = Math.abs(d) / DT;
    if (Math.abs(d) > 0.15) snaps++;
    if (r.blocked) blocked++;
    head.push(r.heading); deltas.push(d);
    ph2 = r.heading; px = r.x; pz = r.z;
  }

  const scene = new T.Scene();
  scene.background = new T.Color(0x061521);
  const hot = input.side === "after" ? 0x7df0b8 : 0xff8f8f;
  const X0 = 0, W = 300;
  function panel(cz, ch, label) {
    const back = new T.Mesh(new T.PlaneGeometry(W + 16, ch * 2 + 18),
      new T.MeshBasicMaterial({ color: 0x0a2231, side: T.DoubleSide }));
    back.rotation.x = -Math.PI / 2; back.position.set(X0 + W / 2, 0, cz); scene.add(back);
    void label;
  }
  function trace(vals, cz, ch, scale, color, y) {
    const pts = [];
    for (let i = 0; i < vals.length; i++) {
      pts.push(X0 + W * i / (vals.length - 1), 0, cz - Math.max(-1.25, Math.min(1.25, vals[i] / scale)) * ch);
    }
    const geo = new T.BufferGeometry();
    geo.setAttribute("position", new T.Float32BufferAttribute(pts, 3));
    const ln = new T.Line(geo, new T.LineBasicMaterial({ color: color }));
    ln.position.y = y; scene.add(ln);
  }
  function rule(cz, color, y) {
    const geo = new T.BufferGeometry();
    geo.setAttribute("position", new T.Float32BufferAttribute([X0, 0, cz, X0 + W, 0, cz], 3));
    const ln = new T.Line(geo, new T.LineBasicMaterial({ color: color }));
    ln.position.y = y; scene.add(ln);
  }
  // TOP: the heading itself. BOTTOM: what the field did to it in ONE frame,
  // against the old +/-0.34 rad-per-frame clamp drawn as the outer rules.
  const TOP_Z = 42, BOT_Z = 132, CH = 34;
  panel(TOP_Z, CH); panel(BOT_Z, CH);
  rule(TOP_Z, 0x3a5c6c, 0.05);
  rule(BOT_Z, 0x3a5c6c, 0.05);
  rule(BOT_Z - CH, 0x7a4550, 0.05); rule(BOT_Z + CH, 0x7a4550, 0.05);
  trace(head, TOP_Z, CH, 1.4, hot, 0.2);
  trace(deltas, BOT_Z, CH, 0.34, hot, 0.2);

  const aspect = input.width / input.height;
  const ref = input.referenceStage && input.referenceStage.camera;
  const framedHeight = ref ? ref.framedHeight : 236;
  const cameraTarget = ref ? ref.target : [X0 + W / 2, 0, 92];
  const cameraPosition = ref ? ref.position : [cameraTarget[0], 200, cameraTarget[2]];
  const cameraUp = ref ? ref.up : [0, 0, -1];
  const camera = new T.OrthographicCamera(-framedHeight * aspect / 2, framedHeight * aspect / 2,
    framedHeight / 2, -framedHeight / 2, 0.01, 600);
  camera.position.fromArray(cameraPosition); camera.up.fromArray(cameraUp);
  camera.lookAt(new T.Vector3().fromArray(cameraTarget)); camera.updateProjectionMatrix();
  studio.scene = scene; studio.camera = camera;
  studio.renderer.setSize(input.width, input.height, false);
  studio.renderer.render(scene, camera);

  const legend = document.createElement("div");
  legend.id = "cbz-steer-legend";
  const old = document.getElementById("cbz-steer-legend"); if (old) old.remove();
  legend.style.cssText = "position:fixed;left:29px;top:170px;color:#9fc0d0;font:12px ui-monospace,SFMono-Regular,Menlo,monospace;z-index:6;line-height:1.8;text-shadow:0 2px 10px #00101a";
  legend.innerHTML = "HEADING over 8 s (rad)<br><span style='display:inline-block;margin-top:88px'>PER-FRAME HEADING CHANGE &mdash; outer rules are the old &plusmn;0.34 rad/frame clamp</span>";
  document.body.appendChild(legend);

  paint(`${SECS} s @ 60 Hz  ·  ${subject.speed} u/s  ·  19 u channel`,
    `peak ${maxRate.toFixed(1)} rad/s  ·  ${snaps} frames > 0.15 rad`);

  return {
    ok: true,
    steerV2: !(CBZ.CONFIG && CBZ.CONFIG.MARINE_STEER_V2 === false),
    metrics: {
      peakYawRate: Number(maxRate.toFixed(2)),
      frameSnaps: snaps,
      blockedSteps: blocked,
    },
    camera: { framedHeight, position: cameraPosition.slice(), target: cameraTarget.slice(), up: cameraUp.slice() },
  };
}

export default {
  id: "marine-tail",
  title: "Marine Tails — One Animal, Not A Fin Towed Behind A Plank",
  description: "Eleven matched frames. Four beats of one great white tail cycle at a 22 u/s rush in plan view, four beats of an orca cycle in profile, a close-up of each animal's tail root at peak sweep, and the production shore-steering track that produced the left-right strobe. The BEFORE column is this same checkout with ?cfg_MARINE_TAIL_V2=0&cfg_MARINE_STEER_V2=0.",
  beforeLabel: "BEFORE — cfg_MARINE_TAIL_V2=0",
  afterLabel: "AFTER · HINGED TAIL + DISTANCE-CAPPED STEERING",
  pairNote: "Same checkout · species · rush speed · elapsed second · camera · light · viewport",
  method: "Both columns load this checkout; the BEFORE side carries ?cfg_MARINE_TAIL_V2=0&cfg_MARINE_STEER_V2=0. Each page builds the registered production species, runs CBZ.buildSwimRig, then advances the production CBZ.animateSwim at 60 Hz for a real number of elapsed seconds while the body travels at 22 u/s — so every frame is a real moment of the shipped animator, not a hand-posed fin. The steering page drives the production city/waterfield.js moveInWater over an analytic coastline bound through that module's own bindArena. The runner copies the before camera into the after capture.",
  defaultBefore: "local",
  beforeParams: { cfg_MARINE_TAIL_V2: "0", cfg_MARINE_STEER_V2: "0" },
  viewport: { width: 1180, height: 720 },
  readyExpression: "window.THREE && window.CBZ && CBZ.buildSwimRig && CBZ.animateSwim && CBZ.waterField && CBZ.waterField.moveInWater && CBZ.WILDLIFE_SPECIES && CBZ.WILDLIFE_SPECIES.great_white_shark && CBZ.WILDLIFE_SPECIES.orca",
  subjects,
  stage: stageMarineTail,
  metrics: {
    weldGapM: {
      label: "How far the tail's root moved off the rigid trunk it is welded to, this frame",
      unit: "m", better: "lower",
    },
    tailTipOffsetM: {
      label: "Tail-tip excursion out of the centreline, this frame (the whip must survive)",
      unit: "m", better: "higher",
    },
    peakYawRate: {
      label: "Peak yaw rate the shore steering imposed over 8 s at rush speed",
      unit: "rad/s", better: "lower",
    },
    frameSnaps: {
      label: "Frames where the shore steering moved the heading by more than 0.15 rad in ONE frame",
      unit: "frames", better: "lower",
    },
  },
  metricsNote: "weldGapM is the whole bug in one number: it is the distance between the point where the tail leaves the trunk and where that same point sits at rest. The trunk never animates, so any non-zero value is a visible seam opening. tailTipOffsetM is the control — the fix must close the seam without flattening the beat.",
};
