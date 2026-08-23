/* The orca's flank pass, before/after, ON THE REAL FIGHT DRIVER.

   Owner (2026-08-21): "orca attack is legit just head butting and it overlaps
   instead of colliding with shape of sharks — it doesn't bite, it headbutts."

   Both columns load this same checkout and run the PRODUCTION
   CBZ.creatureFight loop — an orca committing a flank pass at a megalodon —
   frozen at matched swing phases. The BEFORE column carries ?bitepass=off:
   the old shut-mouth ram_flank with no body cap, so the orca drives clean
   through the megalodon's hull. The AFTER column is the bite pass:
   creature_combat's `bite_flank` (jaws on the bite curve, teeth arriving at
   the flank) plus the body-stops-at-body lunge cap. Nothing here is posed by
   hand — the driver moves the animal, this file only decides when to stop
   the clock and photograph.

   Metrics, measured off the frozen frame:
     nosePenM     how deep the orca's nose tip has been INSIDE the megalodon's
                  beam at any point up to this frame. The overlap complaint as
                  a number: the ram buries metres of orca; a bite leaves only
                  the tooth grip.
     jawOpenPct   the production swimJaw gape at this frame. A headbutt is 0. */

const subjects = [
  {
    id: "run-in", label: "The Pass — Jaws Opening On The Way In", p: 0.44,
    focus: "Committed and closing on the flank. The bite pass opens the jaws on the way in (the bite curve's fast open); the old ram arrives mouth-shut.",
    frame: 12, target: [1.2, 0.2, -4.2], cameraOffset: [-12, 3.0, -1.5],
    state: "DRIVE · 44%",
  },
  {
    id: "contact", label: "Contact — Teeth At The Flank", p: 0.56,
    focus: "The held-open beat, teeth arriving. AFTER: the drive stops where the tooth ring meets the megalodon's measured flank — the melon presses in a tooth-grip, nothing more. BEFORE: the shut-mouth ram keeps driving.",
    frame: 9, target: [1.4, 0.3, -2.6], cameraOffset: [-10, 2.4, -0.8],
    state: "STRIKE · 56% · GAPE HELD",
  },
  {
    id: "contact-top", label: "The Pass From Above", p: 0.74, top: true, up: [1, 0, 0],
    focus: "The drive's deepest frame, from a drone. Two bodies should COLLIDE at their surfaces: the before column draws one animal through the other's hull to the centreline; the after seats a bite on the flank.",
    frame: 18, target: [0.5, 0, -1.2], cameraOffset: [0, 24, 0],
    state: "DEEPEST DRIVE · 74% · TOP-DOWN",
  },
  {
    id: "snap", label: "The Snap And The Worry", p: 0.80,
    focus: "Past the hold the jaws slam shut — much faster than they opened — and the head worries the hit while the teeth stay seated on the flank. The old ram is buried to the pectorals with nothing to close.",
    frame: 10, target: [1.4, 0.3, -2.0], cameraOffset: [-11, 2.6, -1.0],
    state: "SNAP · 80%",
  },
  {
    id: "commit-rush", label: "The Live Commit — predatorHunt's Own Rush", p: 0.56, fsm: true,
    focus: "Not a staged strike: CBZ.predatorCommit plus the production predatorHunt FSM drive the whole run-in. BEFORE: the rush closes on a CENTRE distance and parks the orca inside the megalodon before the swing even starts. AFTER: §R stops the drive where the teeth meet the measured flank, and the fight driver takes over out there.",
    frame: 11, target: [1.2, 0.3, -2.4], cameraOffset: [-11, 2.6, -1.0],
    state: "FSM RUSH · 56%",
  },
];

function stageOrcaBite(input) {
  const T = window.THREE, CBZ = window.CBZ, subject = input.subject;
  if (!T || !CBZ || !CBZ.WILDLIFE_SPECIES || !CBZ.buildSwimRig || !CBZ.creatureFight) {
    return { ok: false, missing: "orca bite staging APIs" };
  }

  let studio = window.__cbzVisualCompare;
  if (!studio) {
    document.documentElement.style.cssText = "margin:0;width:100%;height:100%;background:#05131d";
    document.body.innerHTML = "";
    document.body.style.cssText = "margin:0;width:100%;height:100%;overflow:hidden;background:#05131d;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    const renderer = new T.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1); renderer.setSize(input.width, input.height, false);
    renderer.outputEncoding = T.sRGBEncoding;
    renderer.domElement.style.cssText = `display:block;width:${input.width}px;height:${input.height}px`;
    document.body.appendChild(renderer.domElement);
    const overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;color:#f2fbff;text-shadow:0 2px 10px #001018;z-index:5";
    overlay.innerHTML = "<div data-side></div><div data-name></div><div data-focus></div><div data-state></div><div data-metric></div><div data-source></div>";
    document.body.appendChild(overlay);
    studio = window.__cbzVisualCompare = { renderer, overlay, scene: null, camera: null };
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
    const actor = { species, group, pos: group.position, heading: 0, faceH: 0, dead: false, swimDepth: 1 };
    CBZ.buildSwimRig(actor);
    return actor;
  }
  // measured, rotation zeroed, exactly the way marine_predation measures —
  // and the BEAM comes off the named hull alone: the whole-group box counts
  // the pectoral fins and calls a megalodon 13 m wide.
  function measure(actor) {
    const g = actor.group;
    g.rotation.set(0, 0, 0); g.updateMatrixWorld(true);
    const box = new T.Box3().setFromObject(g);
    let hull = null;
    g.traverse(o => { if (!hull && o.isMesh && /hull$/i.test(o.name || "")) hull = o; });
    const hb = hull ? new T.Box3().setFromObject(hull) : box;
    return {
      len: box.max.x - box.min.x, maxX: box.max.x - g.position.x,
      hullHalfB: (hb.max.z - hb.min.z) * 0.5,
      hullHalfL: (hb.max.x - hb.min.x) * 0.5,
      hullCx: (hb.max.x + hb.min.x) * 0.5 - g.position.x,
    };
  }

  const meg = makeAnimal("megalodon");
  const orca = makeAnimal("orca");
  if (!meg || !orca) return { ok: false, missing: "megalodon/orca species" };
  const megM = measure(meg), orcaM = measure(orca);

  meg.group.position.set(0, -1, 0);
  meg.heading = 0; meg.group.rotation.set(0, 0, 0);
  meg.group.updateMatrixWorld(true);
  orca.group.position.set(1.5, -1, -8.2);  // inside commit range: the swing IS the pass
  orca.heading = Math.PI / 2;              // facing the flank; the driver steers
  if (CBZ.faceAnimalHeading) CBZ.faceAnimalHeading(orca, orca.heading);

  // the flag decides the style exactly as marine_predation does
  const bite = typeof CBZ.creatureBitePass === "function" ? !!CBZ.creatureBitePass() : true;
  const opts = {
    style: bite ? "bite_flank" : "ram_flank",
    seize: false, speed: 11, rate: 2.6, dmg: 1,
    reach: orcaM.len * 0.55 + megM.len * 0.42,
    targetRad: megM.hullHalfB,               // the measured flank, as marine_predation passes it
    onHit: function () {},
    move: function (actor, dx, dz, step) {   // planar mover: the driver owns y
      actor.group.position.x += dx * step;
      actor.group.position.z += dz * step;
    },
  };

  // ---- run the production driver to the subject's phase -------------------
  // Two modes. Plain subjects hand the pass straight to creatureFight with
  // marine_predation's numbers (the flanker's path). `fsm: true` subjects run
  // the ACTUAL predatorHunt commit — CBZ.predatorCommit skips the tease, then
  // the production FSM owns the whole run-in, so §R's surface stop and the
  // reach floor are exercised exactly as a live pod fight exercises them.
  const useFSM = !!subject.fsm;
  let fsmOpts = null;
  if (useFSM) {
    if (typeof CBZ.predatorHunt !== "function" || typeof CBZ.predatorCommit !== "function") {
      return { ok: false, missing: "predatorHunt/predatorCommit" };
    }
    fsmOpts = {
      medium: "water", seize: false, rate: 2.6, dmg: 1,
      onHit: function () {},
      move: opts.move,
    };
    orca.group.position.set(1.5, -1, -14);
    try { CBZ.predatorCommit(orca, meg); }
    catch (e) { return { ok: false, missing: "predatorCommit threw: " + (e && e.message) }; }
  }
  orca._atkT = 0;                            // no random cadence seed
  const dt = 1 / 60;
  let nosePen = 0, steps = 0;
  while (steps++ < 1800) {
    if (useFSM) {
      try { CBZ.predatorHunt(orca, meg, dt, fsmOpts); }
      catch (e) { return { ok: false, missing: "predatorHunt threw: " + (e && e.message) }; }
    } else CBZ.creatureFight(orca, meg, dt, opts);
    // track the deepest the orca's NOSE has been inside the megalodon's HULL
    const h = orca.heading;
    const nx = orca.group.position.x + Math.cos(h) * orcaM.maxX;
    const nz = orca.group.position.z + Math.sin(h) * orcaM.maxX;
    const lx = nx - meg.group.position.x - megM.hullCx, lz = nz - meg.group.position.z;
    if (Math.abs(lx) < megM.hullHalfL && Math.abs(lz) < megM.hullHalfB) {
      nosePen = Math.max(nosePen, megM.hullHalfB - Math.abs(lz));
    }
    if (orca._atkAnim >= subject.p) break;
  }
  orca.group.updateMatrixWorld(true); meg.group.updateMatrixWorld(true);
  const jawOpen = (orca.swim && orca.swim.jawK > 0) ? orca.swim.jawK : 0;

  const scene = new T.Scene();
  scene.background = new T.Color(0x07202e);
  scene.fog = new T.Fog(0x07202e, 30, 80);
  scene.add(new T.HemisphereLight(0xcdeeff, 0x04101a, 1.1));
  const key = new T.DirectionalLight(0xffffff, 1.5); key.position.set(6, 12, 8); scene.add(key);
  const rim = new T.DirectionalLight(0x46c8ff, 0.7); rim.position.set(-9, 5, -7); scene.add(rim);
  scene.add(meg.group); scene.add(orca.group);
  const seabed = new T.Mesh(new T.PlaneGeometry(120, 120), new T.MeshStandardMaterial({ color: 0x0a2e36, roughness: 1 }));
  seabed.rotation.x = -Math.PI / 2; seabed.position.y = -9; scene.add(seabed);

  const aspect = input.width / input.height;
  const ref = input.referenceStage && input.referenceStage.camera;
  const framedHeight = ref ? ref.framedHeight : Number(subject.frame || 14);
  const camera = new T.OrthographicCamera(-framedHeight * aspect / 2, framedHeight * aspect / 2, framedHeight / 2, -framedHeight / 2, 0.01, 300);
  const cameraTarget = ref ? ref.target : subject.target;
  const off = subject.cameraOffset || [2, 5, -14];
  const cameraPosition = ref ? ref.position : [cameraTarget[0] + off[0], cameraTarget[1] + off[1], cameraTarget[2] + off[2]];
  camera.position.fromArray(cameraPosition);
  const camUp = ref ? ref.up : (subject.up || [0, 1, 0]);
  camera.up.fromArray(camUp);
  camera.lookAt(new T.Vector3().fromArray(cameraTarget)); camera.updateProjectionMatrix();
  studio.scene = scene; studio.camera = camera;
  studio.renderer.setSize(input.width, input.height, false); studio.renderer.render(scene, camera);

  const after = input.side === "after", overlay = studio.overlay;
  const side = overlay.querySelector("[data-side]");
  side.textContent = after ? input.afterLabel : input.beforeLabel;
  side.style.cssText = `position:absolute;top:23px;left:27px;padding:7px 11px;border-radius:7px;background:${after ? "#187e5a" : "#bd4848"};font-size:12px;font-weight:900;letter-spacing:.12em`;
  const name = overlay.querySelector("[data-name]"); name.textContent = subject.label;
  name.style.cssText = "position:absolute;top:67px;left:28px;font-size:28px;font-weight:850;letter-spacing:-.025em";
  const focus = overlay.querySelector("[data-focus]"); focus.textContent = subject.focus;
  focus.style.cssText = "position:absolute;top:105px;left:29px;color:#c2d7e0;font-size:13px;font-weight:550;max-width:780px;line-height:1.35";
  const state = overlay.querySelector("[data-state]"); state.textContent = subject.state;
  state.style.cssText = `position:absolute;right:27px;top:26px;color:${after ? "#7df0b8" : "#ffaaaa"};font-size:11px;font-weight:900;letter-spacing:.1em`;
  const metric = overlay.querySelector("[data-metric]");
  metric.textContent = `nose inside quarry ${nosePen.toFixed(2)} m · gape ${(jawOpen * 100) | 0}%`;
  metric.style.cssText = "position:absolute;right:27px;bottom:22px;padding:7px 10px;border-radius:6px;background:rgba(2,16,26,.78);color:#bfeeff;font:11px ui-monospace,SFMono-Regular,Menlo,monospace";
  const source = overlay.querySelector("[data-source]"); source.textContent = new URL(input.sourceUrl).host + new URL(input.sourceUrl).pathname;
  source.style.cssText = "position:absolute;bottom:22px;left:28px;color:#8fa9b6;font:11px ui-monospace,SFMono-Regular,Menlo,monospace";

  const JW = CBZ.creatureJawWorld ? CBZ.creatureJawWorld(orca) : null;
  return {
    ok: true, style: opts.style, phase: subject.p, steps: steps,
    atkAnim: Number((orca._atkAnim || 0).toFixed(3)),
    debug: {
      lungeCap: orca._lungeCap, lungeAmt: orca._lungeAmt,
      centerDist: Number(Math.hypot(orca.group.position.x - meg.group.position.x,
        orca.group.position.z - meg.group.position.z).toFixed(2)),
      jawDist: JW ? Number(Math.hypot(meg.group.position.x - JW.x, meg.group.position.z - JW.z).toFixed(2)) : null,
      hullHalfB: Number(megM.hullHalfB.toFixed(2)), megLen: Number(megM.len.toFixed(2)),
      orcaMaxX: Number(orcaM.maxX.toFixed(2)), orcaLen: Number(orcaM.len.toFixed(2)),
      reach: Number(opts.reach.toFixed(2)),
    },
    metrics: {
      nosePenM: Number(nosePen.toFixed(3)),
      jawOpenPct: Number((jawOpen * 100).toFixed(1)),
    },
    camera: { framedHeight, position: cameraPosition.slice(), target: cameraTarget.slice(), up: camUp.slice() },
  };
}

export default {
  id: "orca-bite",
  title: "The Orca's Pass — A Bite, Not A Headbutt",
  description: "Four matched frames run the production creatureFight loop — an orca committing a flank pass at a megalodon — frozen at the same swing phases. BEFORE (?bitepass=off): the shut-mouth ram, driving clean through the megalodon's body. AFTER: creature_combat's bite_flank — jaws riding the bite curve into the flank, the drive capped so the teeth stop at the quarry's surface and the two bodies collide instead of overlapping.",
  beforeLabel: "BEFORE — ?bitepass=off (the headbutt)",
  afterLabel: "AFTER · THE BITE PASS",
  pairNote: "Same checkout · same driver · same swing phase · same camera · same light",
  method: "Each page builds a registered orca and megalodon, hands them to the production CBZ.creatureFight with marine_predation's own numbers, and steps the driver at 60 Hz until the swing reaches the subject's phase. The BEFORE side carries ?bitepass=off, which creature_combat and the pod callers read at load. The runner copies the before camera into the after capture. Nothing is posed by hand.",
  defaultBefore: "local",
  beforeParams: { bitepass: "off" },
  metrics: {
    nosePenM: {
      label: "Deepest the attacker's nose has been inside the quarry's beam",
      unit: "m", better: "lower",
    },
    jawOpenPct: { label: "Gape at this frame (a headbutt is 0)", unit: "%", better: "higher" },
  },
  viewport: { width: 1100, height: 680 },
  readyExpression: "window.THREE && window.CBZ && CBZ.buildSwimRig && CBZ.swimJaw && CBZ.creatureFight && CBZ.WILDLIFE_SPECIES && CBZ.WILDLIFE_SPECIES.orca && CBZ.WILDLIFE_SPECIES.megalodon",
  subjects,
  stage: stageOrcaBite,
};
