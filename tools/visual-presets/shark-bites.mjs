/* Shark-mouth and bite-action comparison for tools/visual-compare.mjs.

   A SELF A/B on this checkout. The BEFORE column carries ?sharkmouth=off,
   which src/city/wildlife/aquatic.js reads at load: the mouth reverts to the
   band-clamp grammar (gum arcs + a mandible slab swinging under a hull whose
   own chin never moves). The AFTER column is the split-body mouth: the lower
   jaw IS the body's white underside, cut from the species' own rings, and the
   hull/rostrum are notched along the seam so the black upper half and the
   white lower half separate the way an orca's do. The runner copies the
   before camera byte-for-byte into the after capture; open amounts, animal
   roots, prey, hull, waterline, light and viewport stay matched so the mouth
   is the only variable. */

const subjects = [
  {
    id: "great-white-rest", label: "Great White — Closed Mouth", species: "great_white_shark", open: 0,
    focus: "At rest the silhouette must not change: the white chin now IS the front underside of the body, sealed against the notched hull along the same seam.",
    frame: 3.0, target: [2.55, 0.78, 0], cameraOffset: [1.7, 1.0, 8],
    state: "REST · CLOSED", metric: "Chin = the body's own underside · seam sealed",
  },
  {
    id: "great-white-windup", label: "Great White — Bite Wind-up", species: "great_white_shark", open: 0.48,
    focus: "The lower jaw should rotate from its rear body hinge while the upper jaw begins a small forward protrusion.",
    frame: 3.25, target: [2.48, 0.62, 0], cameraOffset: [1.4, 0.95, 8],
    state: "WIND-UP · 48% GAPE", metric: "Hinge world drift: 0 · upper jaw protrudes",
  },
  {
    id: "great-white-full-gape", label: "Great White — Full Gape", species: "great_white_shark", open: 1,
    focus: "The bite must split the body, orca-style: the dark snout lifts, the WHITE CHIN drops as one continuation of the belly, and above it is the dark mouth roof — no closed underside left behind, no denture arc floating in front.",
    frame: 3.65, target: [2.45, 0.45, 0], cameraOffset: [2.1, 1.2, 8],
    state: "COMMIT · FULL GAPE", metric: "Black top lifts · white chin drops · teeth ring both",
  },
  {
    id: "great-white-tuna-contact", label: "Great White — Tuna Contact", species: "great_white_shark", open: 0.82,
    targetSpecies: "tuna", targetAt: [3.25, 0.70, 0], targetYaw: Math.PI / 2,
    focus: "The actual tuna flank should enter the visible tooth ring at the same socket used by mounted damage.",
    frame: 4.15, target: [2.55, 0.52, 0], cameraOffset: [1.3, 1.15, 9],
    state: "CONTACT · PREY IN TOOTH RING", metric: "Mounted hit: 30 damage · shared wildlife damage owner",
  },
  {
    id: "hammerhead-full-gape", label: "Great Hammerhead — Full Gape", species: "hammerhead_shark", open: 1,
    focus: "The famously small mouth remains beneath the cephalofoil, but now opens as one attached jaw instead of loose slabs.",
    frame: 3.1, target: [2.0, 0.55, 0], cameraOffset: [1.8, 1.0, 8],
    state: "FULL GAPE · SMALL MOUTH", metric: "13 upper + 13 lower teeth · zero hinge drift",
  },
  {
    id: "bull-shark-full-gape", label: "Bull Shark — Full Gape", species: "bull_shark", open: 1,
    focus: "The inshore shark should inherit the same physical mouth grammar while retaining its blunt, stocky head.",
    frame: 2.95, target: [1.86, 0.48, 0], cameraOffset: [1.8, 0.95, 8],
    state: "FULL GAPE · SHARED RIG", metric: "15 upper + 15 lower teeth · no species runtime copy",
  },
  {
    id: "megalodon-rest", label: "Megalodon — Closed Mouth", species: "megalodon", open: 0,
    animal: [0, -1.80, 0],
    focus: "At legendary scale, the closed jaw must still be the body: the chin is cut from the megalodon's own rings, so the head seals along the seam instead of resting on a slab.",
    frame: 7.0, target: [8.9, 0.05, 0], cameraOffset: [5.5, 2.6, 18],
    state: "REST · CHIN SEALED", metric: "Hinge embedded in head volume · reset drift: 0",
  },
  {
    id: "megalodon-full-gape", label: "Megalodon — Full Gape", species: "megalodon", open: 1,
    animal: [0, -1.80, 0],
    focus: "The huge bite should expose depth and teeth around the maw, with the mandible rotating from the rear rather than orbiting away.",
    frame: 8.2, target: [8.75, -0.45, 0], cameraOffset: [6.5, 3.1, 20],
    state: "COMMIT · FULL GAPE", metric: "19 upper + 19 lower teeth · one hinged assembly",
  },
  {
    id: "megalodon-speedboat-contact", label: "Megalodon — Speedboat Hull Contact", species: "megalodon", open: 0.88,
    animal: [0, -1.80, 0], ship: true, shipAt: [8.1, 0, 0], shipYaw: Math.PI / 2, shipRoll: -0.08,
    focus: "The real Speedboat hull should enter the visible gape exactly where the structural bite resolves.",
    frame: 11.2, target: [7.5, 0.0, 0], cameraOffset: [5.0, 3.6, 23],
    state: "CONTACT · HULL IN TOOTH RING", metric: "Ship engine destroyed · intact wreck handed to sinking physics",
  },
  {
    id: "megalodon-speedboat-clamp", label: "Megalodon — Clamp and Sink Handoff", species: "megalodon", open: 0.08,
    animal: [0.25, -1.55, 0], ship: true, shipAt: [8.0, -0.08, 0], shipYaw: Math.PI / 2, shipRoll: -0.18,
    focus: "After contact, the jaw should visibly clamp around the hull while the boat begins a physical, non-explosive roll.",
    frame: 11.2, target: [7.45, -0.05, 0], cameraOffset: [4.5, 3.5, 23],
    state: "CLAMP · STRUCTURE FAILS", metric: "No explosion · same hull continues into water physics",
  },
];

export function stagePredatorMouth(input) {
  const T = window.THREE, CBZ = window.CBZ;
  // A cadence sheet derives `open` from real elapsed seconds. Clone the preset
  // subject because the comparator reuses its descriptor across before/after;
  // mutating it would leak one side's production timing into the other.
  const subject = Object.assign({}, input.subject);
  if (!T || !CBZ || !CBZ.WILDLIFE_SPECIES || !CBZ.buildSwimRig || !CBZ.swimJaw) {
    return { ok: false, missing: "shark mouth staging APIs" };
  }

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

  const actor = makeAnimal(subject.species);
  if (!actor || !actor.swim) return { ok: false, missing: subject.species };
  let biteTiming = null;
  if (Number.isFinite(subject.elapsedS)) {
    const isNewCadence = !!(CBZ.biteTimeline && CBZ.biteTimeline.version >= 2 &&
      CBZ.aquaticBiteDuration && CBZ.biteCurve);
    const oldHeavy = subject.species === "megalodon";
    const targetKind = subject.ship ? "ship" : (subject.targetSpecies ? "animal" : null);
    const duration = isNewCadence
      ? CBZ.aquaticBiteDuration(actor, targetKind)
      : (oldHeavy ? 0.72 : 0.56);
    const p = Math.max(0, Math.min(1, subject.elapsedS / duration));
    const smooth = t => {
      const k = Math.max(0, Math.min(1, t));
      return k * k * (3 - 2 * k);
    };
    let open;
    if (isNewCadence) open = CBZ.biteCurve(p);
    else {
      // Byte-for-byte shape of the deployed mounted bite. A real hit latched
      // at the first legal p=.38 sample and collapsed the next .16 of progress;
      // a miss held until .70 and recovered across the final .30.
      open = p < 0.30 ? smooth(p / 0.30) : 1;
      if (subject.contact && p >= 0.38) {
        open = Math.max(0.08, 1 - smooth((p - 0.38) / 0.16) * 0.92);
      } else if (p > 0.70) open = 1 - smooth((p - 0.70) / 0.30);
      if (p >= 1) open = 0;
    }
    const timeline = isNewCadence ? CBZ.biteTimeline : {
      // The timing metric describes the deployed hit path even on rest/tell
      // pages. A miss used its longer recovery branch, but it is not the
      // contact-to-clench behavior this comparison is measuring.
      fullAt: 0.30, holdTo: 0.38, shutAt: 0.54,
    };
    subject.open = open;
    biteTiming = {
      elapsedS: subject.elapsedS,
      progress: p,
      durationS: duration,
      fullGapeAtS: duration * timeline.fullAt,
      compressionS: duration * (timeline.shutAt - timeline.holdTo),
      recoveryGapS: isNewCadence ? (targetKind === "ship" ? 0.55 : 0.42)
        : (oldHeavy ? 0.13 : 0.06),
      newCadence: isNewCadence,
    };
  }
  const animal = actor.group;
  animal.position.fromArray(subject.animal || [0, 0, 0]);
  animal.rotation.y = subject.animalYaw || -0.04;
  CBZ.swimJaw(actor, Number(subject.open) || 0);
  animal.updateMatrixWorld(true);

  const scene = new T.Scene();
  scene.background = new T.Color(0x061824);
  scene.fog = new T.Fog(0x061824, 22, 58);
  scene.add(new T.HemisphereLight(0xccefff, 0x041019, 1.14));
  const key = new T.DirectionalLight(0xffffff, 1.55); key.position.set(4, 10, 11); scene.add(key);
  const mouthFill = new T.DirectionalLight(0xffa6a0, 0.62); mouthFill.position.set(12, -2, 5); scene.add(mouthFill);
  const rim = new T.DirectionalLight(0x42c8ff, 0.75); rim.position.set(-8, 4, -8); scene.add(rim);

  const water = new T.Mesh(new T.PlaneGeometry(80, 42), new T.MeshPhysicalMaterial({
    color: 0x0d769b, transparent: true, opacity: 0.18, roughness: 0.15,
    metalness: 0.02, depthWrite: false, side: T.DoubleSide,
  }));
  water.rotation.x = -Math.PI / 2; water.position.y = 0; water.renderOrder = 5; scene.add(water);
  const seabed = new T.Mesh(new T.PlaneGeometry(80, 42), new T.MeshStandardMaterial({ color: 0x0b3038, roughness: 1 }));
  seabed.rotation.x = -Math.PI / 2; seabed.position.y = -8.5; scene.add(seabed);
  for (let i = 0; i < 24; i++) {
    const bubble = new T.Mesh(new T.SphereGeometry(0.025 + (i % 4) * 0.012, 6, 5), new T.MeshBasicMaterial({ color: 0x8ddcf5, transparent: true, opacity: 0.42 }));
    bubble.position.set(-8 + i * 0.78, -0.5 - (i % 6) * 0.72, -1.4 - (i % 5) * 0.34); scene.add(bubble);
  }
  scene.add(animal);

  let targetActor = null;
  if (subject.targetSpecies) {
    targetActor = makeAnimal(subject.targetSpecies);
    if (!targetActor) return { ok: false, missing: subject.targetSpecies };
    targetActor.group.position.fromArray(subject.targetAt);
    targetActor.group.rotation.y = subject.targetYaw || 0;
    targetActor.group.updateMatrixWorld(true); scene.add(targetActor.group);
  }

  let ship = null;
  if (subject.ship) {
    if (!CBZ.cityBuildAmbientCarVisual) return { ok: false, missing: "Speedboat builder" };
    ship = CBZ.cityBuildAmbientCarVisual("Speedboat");
    if (!ship) return { ok: false, missing: "Speedboat visual" };
    ship.position.fromArray(subject.shipAt);
    ship.rotation.y = subject.shipYaw || 0;
    ship.rotation.z = subject.shipRoll || 0;
    ship.updateMatrixWorld(true); scene.add(ship);
  }

  const aspect = input.width / input.height;
  const ref = input.referenceStage && input.referenceStage.camera;
  const framedHeight = ref ? ref.framedHeight : Number(subject.frame || 4);
  const camera = new T.OrthographicCamera(-framedHeight * aspect / 2, framedHeight * aspect / 2, framedHeight / 2, -framedHeight / 2, 0.01, 250);
  const cameraTarget = ref ? ref.target : subject.target;
  const off = subject.cameraOffset || [1.5, 1, 9];
  const cameraPosition = ref ? ref.position : [cameraTarget[0] + off[0], cameraTarget[1] + off[1], cameraTarget[2] + off[2]];
  const cameraUp = ref ? ref.up : [0, 1, 0];
  camera.position.fromArray(cameraPosition); camera.up.fromArray(cameraUp);
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
  focus.style.cssText = "position:absolute;top:105px;left:29px;color:#c2d5df;font-size:13px;font-weight:550;max-width:760px;line-height:1.35";
  const state = overlay.querySelector("[data-state]"); state.textContent = subject.state;
  state.style.cssText = `position:absolute;right:27px;top:26px;color:${after ? "#7df0b8" : "#ffaaaa"};font-size:11px;font-weight:900;letter-spacing:.1em`;
  const phase = overlay.querySelector("[data-phase]");
  phase.textContent = biteTiming
    ? `T + ${biteTiming.elapsedS.toFixed(2)} s  ·  JAW ${Math.round(subject.open * 100)}%`
    : `JAW  ${Math.round(subject.open * 100)}%`;
  phase.style.cssText = "position:absolute;right:28px;top:54px;color:#d7eef8;font:12px ui-monospace,SFMono-Regular,Menlo,monospace";
  const metric = overlay.querySelector("[data-metric]"); metric.textContent = subject.metric;
  metric.style.cssText = "position:absolute;right:27px;bottom:22px;padding:7px 10px;border-radius:6px;background:rgba(3,18,28,.76);color:#bfeeff;font:11px ui-monospace,SFMono-Regular,Menlo,monospace";
  const source = overlay.querySelector("[data-source]"); source.textContent = new URL(input.sourceUrl).host + new URL(input.sourceUrl).pathname;
  source.style.cssText = "position:absolute;bottom:22px;left:28px;color:#91aab7;font:11px ui-monospace,SFMono-Regular,Menlo,monospace";

  const mouth = animal.userData && animal.userData.aquaticMouth;
  const jaw = actor.swim;
  const hinge = jaw.jawGroup ? jaw.jawGroup.getWorldPosition(new T.Vector3()) : null;

  // ---- measured, not asserted --------------------------------------------
  // staticVsJawM: the lowest STATIC vertex in the mouth span (hull, rostrum —
  // anything that does not move with the bite, cavity excluded) minus the
  // moving lower jaw's lowest vertex at rest. The clamp mouth scores NEGATIVE:
  // the hull's own closed chin hangs below the jaw it is supposed to be, so a
  // bite swings dentures under a shut head. The split-body mouth scores
  // positive: the underside of the head IS the jaw, and the only static thing
  // left up there is the dark mouth roof.
  // mouthOpeningM: centre-to-centre separation of the authored front lips.
  // Measuring the farthest shell vertex used to confuse rostrum travel with
  // gape (and could claim a larger opening on a closed mouth); the named lips
  // are the actual boundary the player sees.
  let staticVsJawM = null, mouthOpeningM = null;
  let staticChinDepthM = null, upperEnvelopeTravelM = null, lowerEnvelopeTravelM = null;
  let lipProudM = null;
  if (mouth && jaw.jawGroup) {
    const sc = animal.scale.x || 1;
    const spanLen = mouth.upperReachX
      ? mouth.upperReachX - (mouth.protrude || 0) - mouth.hinge.x : 1;
    const wx0 = animal.position.x + (mouth.hinge.x + spanLen * 0.25) * sc;
    const wx1 = animal.position.x + (mouth.hinge.x + spanLen * 1.12) * sc;
    const v = new T.Vector3();
    const lowestIn = function (root, x0, x1, skipJaws) {
      let low = Infinity;
      root.traverse(function (o2) {
        if (!o2.isMesh || !o2.geometry || !o2.geometry.attributes.position) return;
        if (o2 === jaw.jawCavity) return;
        if (skipJaws) {
          for (let p = o2; p; p = p.parent) if (p === jaw.jawGroup || p === jaw.jawUpper) return;
        }
        const pos = o2.geometry.attributes.position;
        for (let i2 = 0; i2 < pos.count; i2++) {
          v.fromBufferAttribute(pos, i2).applyMatrix4(o2.matrixWorld);
          if (v.x >= x0 && v.x <= x1 && v.y < low) low = v.y;
        }
      });
      return low;
    };
    const authored = animal._aquaticMouth || null;
    function namedMesh(name) {
      let found = null;
      if (!name) return null;
      animal.traverse(function (o2) { if (!found && o2.isMesh && o2.name === name) found = o2; });
      return found;
    }
    const upperShell = (authored && authored.upperShell) || namedMesh(mouth.upperShell);
    const lowerShell = (authored && authored.lowerShell) || namedMesh(mouth.lowerShell) || namedMesh("sharkChin");
    const upperLip = namedMesh("sharkUpperLip") || namedMesh("orcaUpperGum");
    const lowerLip = namedMesh("sharkLowerLip") || namedMesh("orcaLowerGum");
    function frontPoint(mesh) {
      if (!mesh || !mesh.geometry || !mesh.geometry.attributes.position) return null;
      const pos = mesh.geometry.attributes.position, p = new T.Vector3(), best = new T.Vector3();
      let maxX = -Infinity;
      for (let q = 0; q < pos.count; q++) {
        p.fromBufferAttribute(pos, q).applyMatrix4(mesh.matrixWorld);
        if (p.x > maxX) { maxX = p.x; best.copy(p); }
      }
      return isFinite(maxX) ? best : null;
    }
    function worldCenter(mesh) {
      if (!mesh) return null;
      const box = new T.Box3().setFromObject(mesh);
      return box.isEmpty() ? null : box.getCenter(new T.Vector3());
    }
    function localFrontX(mesh) {
      if (!mesh || !mesh.geometry || !mesh.geometry.attributes.position) return null;
      const inv = new T.Matrix4().copy(animal.matrixWorld).invert();
      const pos = mesh.geometry.attributes.position, p = new T.Vector3();
      let maxX = -Infinity;
      for (let q = 0; q < pos.count; q++) {
        p.fromBufferAttribute(pos, q).applyMatrix4(mesh.matrixWorld).applyMatrix4(inv);
        if (p.x > maxX) maxX = p.x;
      }
      return isFinite(maxX) ? maxX : null;
    }
    animal.updateMatrixWorld(true);
    const posedUpper = frontPoint(upperShell), posedLower = frontPoint(lowerShell);
    const posedUpperLip = worldCenter(upperLip), posedLowerLip = worldCenter(lowerLip);
    const staticFloor = lowestIn(animal, wx0, wx1, true);
    const posedLow = lowestIn(jaw.jawGroup, -Infinity, Infinity, false);
    CBZ.swimJaw(actor, 0); animal.updateMatrixWorld(true);
    const restLow = lowestIn(jaw.jawGroup, -Infinity, Infinity, false);
    const restUpper = frontPoint(upperShell), restLower = frontPoint(lowerShell);
    if (mouth.upperReachX != null && upperLip && lowerLip) {
      // `upperReachX` includes the animated protrusion. Remove that travel to
      // recover the authored closed-mouth arc: any named lip vertex beyond it
      // is literal tissue sticking into open water. Measure at rest regardless
      // of the photographed phase so every cadence frame reports one truth.
      const arcX = mouth.upperReachX - (mouth.protrude || 0) - (mouth.dentalProtrude || 0);
      const uf = localFrontX(upperLip), lf = localFrontX(lowerLip);
      if (uf != null && lf != null) lipProudM = Number((Math.max(0, uf - arcX, lf - arcX) * sc).toFixed(3));
    }
    CBZ.swimJaw(actor, Number(subject.open) || 0); animal.updateMatrixWorld(true);
    // No static vertex in the mouth span is the strongest possible result: the
    // builder handed the entire visible envelope to the jaws.  Report zero
    // residual chin rather than a blank cell.
    if (isFinite(restLow)) {
      staticVsJawM = isFinite(staticFloor) ? Number((staticFloor - restLow).toFixed(3)) : 0;
      staticChinDepthM = isFinite(staticFloor) ? Number(Math.max(0, restLow - staticFloor).toFixed(3)) : 0;
    }
    if (posedUpperLip && posedLowerLip) {
      mouthOpeningM = Number(Math.abs(posedUpperLip.y - posedLowerLip.y).toFixed(3));
    }
    if (posedUpper && restUpper) upperEnvelopeTravelM = Number(posedUpper.distanceTo(restUpper).toFixed(3));
    if (posedLower && restLower) lowerEnvelopeTravelM = Number(posedLower.distanceTo(restLower).toFixed(3));
  }

  return {
    ok: true, species: actor.species.id, openness: subject.open,
    authoredMouth: !!mouth, upperTeeth: mouth && mouth.upperTeeth, lowerTeeth: mouth && mouth.lowerTeeth,
    bodySplitMouth: !!(mouth && mouth.bodySplit),
    lowerJawGroup: !!jaw.jawGroup, legacyLooseParts: jaw.jaw ? jaw.jaw.length : 0,
    hinge: hinge && hinge.toArray().map(v => Number(v.toFixed(3))),
    prey: targetActor && targetActor.species.id, realSpeedboat: !!ship,
    articulatedEnvelope: !!(mouth && mouth.articulatedEnvelope),
    upperShell: mouth && mouth.upperShell, lowerShell: mouth && mouth.lowerShell,
    embeddedToothFraction: mouth && mouth.embeddedToothFraction,
    metrics: {
      staticVsJawM: staticVsJawM, mouthOpeningM: mouthOpeningM,
      staticChinDepthM: staticChinDepthM,
      upperEnvelopeTravelM: upperEnvelopeTravelM,
      lowerEnvelopeTravelM: lowerEnvelopeTravelM,
      lipProudM: lipProudM,
      biteCycleS: biteTiming ? Number(biteTiming.durationS.toFixed(3)) : null,
      fullGapeAtS: biteTiming ? Number(biteTiming.fullGapeAtS.toFixed(3)) : null,
      compressionS: biteTiming ? Number(biteTiming.compressionS.toFixed(3)) : null,
      recoveryGapS: biteTiming ? Number(biteTiming.recoveryGapS.toFixed(3)) : null,
      jawOpenPct: biteTiming ? Number((subject.open * 100).toFixed(1)) : null,
    },
    camera: { framedHeight, position: cameraPosition.slice(), target: cameraTarget.slice(), up: cameraUp.slice() },
  };
}

export default {
  id: "shark-bites",
  title: "Shark Mouths — The Body Splits, Not a Clamp",
  description: "Ten matched frames compare the band-clamp mouth (?sharkmouth=off, this same checkout) with the split-body mouth across rest, wind-up, full gape, prey contact, ship contact, and clamp. The lower jaw is now the shark's own white chin cut from its body rings; the hull and rostrum are notched along the mouth seam so nothing stays closed behind the dropped jaw — a bite separates the dark upper half of the head from the white lower half, orca-style. The metrics table proves it: the static underside of the mouth region (the chin that never moved) is gone.",
  beforeLabel: "BEFORE — ?sharkmouth=off (the clamp)",
  afterLabel: "AFTER · SPLIT-BODY MOUTHS",
  pairNote: "Same checkout · jaw phase · target · camera · water · light · viewport",
  method: "Both columns load this same checkout; the BEFORE side carries ?sharkmouth=off, which aquatic.js reads at load to build the old band-clamp mouth. Each page builds its own registered shark, opens it through production CBZ.swimJaw, and adds the same prey or Speedboat asset where applicable. The runner copies the before camera into the after capture. These are matched action-state frames, not hand-retouched images.",
  defaultBefore: "local",
  beforeParams: { sharkmouth: "off" },
  metrics: {
    staticVsJawM: {
      label: "Static underside minus moving-jaw underside at rest (negative = a closed chin the bite cannot move)",
      unit: "m", better: "higher",
    },
    mouthOpeningM: {
      label: "Vertical opening at this frame's gape, roof of the hole down to the dropped jaw",
      unit: "m", better: "higher",
    },
  },
  viewport: { width: 1100, height: 680 },
  readyExpression: "window.THREE && window.CBZ && CBZ.buildSwimRig && CBZ.swimJaw && CBZ.cityBuildAmbientCarVisual && CBZ.WILDLIFE_SPECIES && CBZ.WILDLIFE_SPECIES.great_white_shark && CBZ.WILDLIFE_SPECIES.hammerhead_shark && CBZ.WILDLIFE_SPECIES.bull_shark && CBZ.WILDLIFE_SPECIES.megalodon",
  subjects,
  stage: stagePredatorMouth,
};
