/* Sea-animal interaction and motion comparison for tools/visual-compare.mjs.

   This is deliberately not an isolated asset gallery. Every frame combines the
   registered aquatic model with the canonical player rig, a target animal, or
   the actual Speedboat visual. The deployed page stages the old swimmer-beside-
   animal state; the local page stages the new mounted trajectory/contact state.
   Camera framing is authored per action and the runner copies the deployed
   camera byte-for-byte into the matching local capture. */

const subjects = [
  {
    id: "dolphin-surface-mount", label: "Dolphin — iPad Surface Mount", species: "dolphin", scene: "mount",
    focus: "The player should move from chasing beside the dolphin to a real hip-on-back riding assembly.",
    frame: 6.6, target: [0, 0.25, 0], animal: [0, -1.25, 0], swimmer: [-2.35, -0.62, 1.15],
    beforeState: "SWIMMER MUST CHASE", afterState: "IPAD PRESS → RIDE",
    metric: "Every aquatic:true species inherits the same touch/mount path",
  },
  {
    id: "dolphin-breach-takeoff", label: "Dolphin — Sprint + Rise Takeoff", species: "dolphin", scene: "takeoff",
    focus: "Sprint plus rise at the surface should launch one connected dolphin-and-rider body.",
    frame: 8.4, target: [0.4, 1.45, 0], animal: [-0.8, -1.08, 0], swimmer: [-2.85, -0.55, 1.0],
    afterAnimal: [0.55, 0.2, 0], afterPitch: 0.72,
    beforeState: "SURFACE SWIM ONLY", afterState: "SPRINT + RISE · TAKEOFF",
    metric: "15.5 m/s vertical breach impulse",
  },
  {
    id: "dolphin-breach-apex", label: "Dolphin — Huge Breach Apex", species: "dolphin", scene: "apex",
    focus: "At the apex, gravity carries the same physical root and the rider remains seated through pitch.",
    frame: 10.8, target: [0.3, 3.0, 0], animal: [-1.7, -1.2, 0], swimmer: [-3.6, -0.58, 1.0],
    afterAnimal: [4.2, 5.15, 0], afterPitch: 0.12,
    beforeState: "NO BREACH CONTROL", afterState: "BALLISTIC APEX · RIDER ATTACHED",
    metric: "Focused browser contract measured 8.14 m of rise",
  },
  {
    id: "dolphin-breach-reentry", label: "Dolphin — Nose-Down Re-entry", species: "dolphin", scene: "reentry",
    focus: "The mounted root should pitch nose-down, cross the waterline, splash, and return to water control.",
    frame: 8.6, target: [0.35, 1.05, 0], animal: [-1.25, -1.2, 0], swimmer: [-3.0, -0.6, 1.0],
    afterAnimal: [0.95, 0.65, 0], afterPitch: -0.72,
    beforeState: "SEPARATE SWIM ROOTS", afterState: "SAME ROOT · SPLASH RE-ENTRY",
    metric: "Gravity → water handoff, without teleporting the rider",
  },
  {
    id: "manta-mounted-glide", label: "Manta Ray — Mounted Glide", species: "manta_ray", scene: "dive",
    focus: "The capability follows aquatic:true, including peaceful shapes that were never hand-listed as mounts.",
    frame: 8.8, target: [0.2, -0.45, 0], animal: [-0.4, -2.15, 0], swimmer: [-3.2, -0.65, 1.15],
    afterAnimal: [0.7, -2.0, 0], afterPitch: -0.18,
    beforeState: "MOVING ASSET · NOT TRANSPORT", afterState: "PRESSABLE · MOUNTED · GLIDING",
    metric: "Generated ride profile; no second aquatic roster",
  },
  {
    id: "orca-mounted-dive", label: "Orca — Rider-Controlled Dive", species: "orca", scene: "dive",
    focus: "A mounted sea animal should create a new vertical travel mode, not imitate land running underwater.",
    frame: 9.6, target: [0.2, -1.2, 0], animal: [-1.4, -2.1, 0], swimmer: [-3.8, -0.75, 1.1],
    afterAnimal: [0.9, -3.35, 0], afterPitch: -0.48,
    beforeState: "PLAYER SWIMS BESIDE", afterState: "MOUNTED · DIVE INPUT",
    metric: "Camera-relative steering · rise/dive · seabed clamp",
  },
  {
    id: "great-white-mounted", label: "Great White — Mounted Cruise", species: "great_white_shark", scene: "mount",
    focus: "The rider should sit on the moving shark root with a visible two-hand brace and wrapped legs.",
    frame: 8.1, target: [0.15, 0.0, 0], animal: [0, -2.25, 0], swimmer: [-3.25, -0.72, 1.2],
    beforeState: "PREDATOR MOVES ALONE", afterState: "IPAD PRESS → SHARK RIDE",
    metric: "Touch, mouse, keyboard, and gamepad share the mount owner",
  },
  {
    id: "great-white-bites-tuna", label: "Great White — Player Bite Contact", species: "great_white_shark", targetSpecies: "tuna", scene: "bite",
    focus: "Fire should open the authored jaw and resolve damage at the visible tuna contact—not at an arbitrary radius.",
    frame: 8.5, target: [0.45, -0.15, 0], animal: [-1.25, -2.25, 0], swimmer: [-4.1, -0.72, 1.15],
    afterAnimal: [-1.15, -2.25, 0], targetAnimal: [3.0, -0.83, 0], afterPitch: 0.08,
    beforeState: "CLOSED JAW · NO RIDER ATTACK", afterState: "FIRE → GAPE → CONTACT",
    metric: "Shared jaw point · swept contact window · wildlife damage owner",
  },
  {
    id: "megalodon-mounted-ship-approach", label: "Megalodon — Ride Toward a Ship", species: "megalodon", scene: "ship-approach", ship: true,
    focus: "Even the legendary-scale animal should be pressable and carry the player toward a real marine target.",
    frame: 18.5, target: [0.6, -1.15, 0], animal: [-5.4, -7.15, 0], swimmer: [-10.7, -0.85, 1.45],
    afterAnimal: [-5.0, -7.0, 0], shipAt: [7.2, 0, 0],
    beforeState: "SWIMMER CANNOT USE ITS SPEED", afterState: "LEGENDARY ANIMAL · MOUNTED",
    metric: "Same mount contract scales from fish to megalodon",
  },
  {
    id: "megalodon-bites-speedboat", label: "Megalodon — Structural Ship Bite", species: "megalodon", scene: "ship-bite", ship: true,
    focus: "The open jaw should visibly meet the real Speedboat hull; the bite kills structure and hands the intact wreck to sinking physics.",
    frame: 18.5, target: [0.35, -0.55, 0], animal: [-5.2, -7.0, 0], swimmer: [-10.6, -0.85, 1.45],
    afterAnimal: [-4.7, -6.4, 0], afterPitch: 0.42, shipAt: [3.6, 0, 0], shipRoll: -0.11,
    beforeState: "SHIP IS NOT A PLAYER-BITE TARGET", afterState: "FIRE → HULL BITE → SINK HANDOFF",
    metric: "Structural damage only · no fake gunfire or explosion",
  },
];

function stageSeaMount(input) {
  const T = window.THREE;
  const CBZ = window.CBZ;
  const subject = input.subject;
  const sp = CBZ && CBZ.WILDLIFE_SPECIES && CBZ.WILDLIFE_SPECIES[subject.species];
  if (!T || !CBZ || !sp || !CBZ.makeCharacter || !CBZ.animChar || !CBZ.buildSwimRig) {
    return { ok: false, missing: subject.species };
  }
  const after = input.side === "after";
  if (after && typeof CBZ.cityRideVisualSpec !== "function") {
    return { ok: false, missing: "cityRideVisualSpec" };
  }

  let studio = window.__cbzVisualCompare;
  if (!studio) {
    document.documentElement.style.cssText = "margin:0;width:100%;height:100%;background:#071a28";
    document.body.innerHTML = "";
    document.body.style.cssText = "margin:0;width:100%;height:100%;overflow:hidden;background:#071a28;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    const renderer = new T.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setSize(input.width, input.height, false);
    renderer.outputEncoding = T.sRGBEncoding;
    renderer.domElement.style.cssText = `display:block;width:${input.width}px;height:${input.height}px`;
    document.body.appendChild(renderer.domElement);
    const overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;color:#f3f9fc;text-shadow:0 2px 10px #00101b;z-index:5";
    overlay.innerHTML = "<div data-side></div><div data-name></div><div data-focus></div><div data-state></div><div data-metric></div><div data-source></div>";
    document.body.appendChild(overlay);
    studio = window.__cbzVisualCompare = { renderer, overlay, scene: null, camera: null };
    studio.render = function () {
      if (studio.scene && studio.camera) studio.renderer.render(studio.scene, studio.camera);
    };
  }

  const materials = new Map();
  function animalMaterial(color) {
    const key = Number(color == null ? 0x7e8d98 : color);
    if (!materials.has(key)) materials.set(key, new T.MeshStandardMaterial({
      color: key, roughness: 0.72, metalness: 0.015, flatShading: true,
    }));
    return materials.get(key);
  }
  function makeAnimal(speciesId) {
    const species = CBZ.WILDLIFE_SPECIES[speciesId];
    if (!species || typeof species.build !== "function") return null;
    const group = species.build({ THREE: T, mat: animalMaterial, rng: () => 0.25 });
    group.scale.setScalar(Number(species.scale) || 1);
    group.updateMatrixWorld(true);
    const actor = { species, group, pos: group.position, heading: 0, faceH: 0, dead: false };
    CBZ.buildSwimRig(actor);
    if (actor.swim && CBZ.animateSwim) {
      actor.swim.px = group.position.x - 0.36;
      actor.swim.py = group.position.y;
      actor.swim.pz = group.position.z;
      actor.swim.k = 1;
      actor.swim.ph = subject.scene === "bite" || subject.scene === "ship-bite" ? 2.2 : 1.05;
      CBZ.animateSwim(actor, 1 / 30);
    }
    return actor;
  }
  function makeRider() {
    return CBZ.makeCharacter({
      skin: 0xb87955, torso: 0x2c7fbd, collar: 0x56a9da, arms: 0x2c7fbd,
      legs: 0x182a3a, shoes: 0x17191d, hair: 0x302016,
    });
  }
  function poseSwimmer(ch, phase) {
    for (let i = 0; i < 50; i++) CBZ.animChar(ch, 3.2, 1 / 60);
    const sw = Math.sin(phase || 1.1);
    if (ch.body) { ch.body.rotation.x = 0.34; ch.body.position.y = 0.02; }
    if (ch.parts) {
      if (ch.parts.la) { ch.parts.la.rotation.x = -1.20 + sw * 0.62; ch.parts.la.rotation.z = -0.28; }
      if (ch.parts.ra) { ch.parts.ra.rotation.x = -1.20 - sw * 0.62; ch.parts.ra.rotation.z = 0.28; }
      if (ch.parts.ll) ch.parts.ll.rotation.x = sw * 0.30;
      if (ch.parts.rl) ch.parts.rl.rotation.x = -sw * 0.30;
    }
    if (ch.low) {
      if (ch.low.la) ch.low.la.rotation.x = -0.45;
      if (ch.low.ra) ch.low.ra.rotation.x = -0.45;
      if (ch.low.ll) ch.low.ll.rotation.x = 0.45;
      if (ch.low.rl) ch.low.rl.rotation.x = 0.25;
    }
  }
  function addSplash(scene, x, size) {
    const splashMat = new T.MeshStandardMaterial({ color: 0xbdefff, emissive: 0x286c85, emissiveIntensity: 0.45, roughness: 0.2 });
    const count = 15;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      const r = size * (0.45 + (i % 3) * 0.18);
      const drop = new T.Mesh(new T.SphereGeometry(size * (0.035 + (i % 4) * 0.008), 7, 5), splashMat);
      drop.position.set(x + Math.cos(a) * r, 0.08 + (i % 5) * size * 0.12, Math.sin(a) * r * 0.48);
      scene.add(drop);
    }
    const ring = new T.Mesh(new T.TorusGeometry(size * 0.72, size * 0.035, 7, 36), splashMat);
    ring.rotation.x = Math.PI / 2; ring.position.set(x, 0.035, 0); scene.add(ring);
  }

  const actor = makeAnimal(subject.species);
  if (!actor) return { ok: false, missing: subject.species };
  const animal = actor.group;
  const visual = after ? CBZ.cityRideVisualSpec(sp, animal) : null;
  if (after && (!visual || !visual.aquatic)) return { ok: false, missing: `aquatic ride profile for ${sp.id}` };

  const baseAnimal = subject.animal || [0, -1.3, 0];
  const afterAnimal = subject.afterAnimal || baseAnimal;
  animal.position.fromArray(after ? afterAnimal : baseAnimal);
  animal.rotation.set(after ? (subject.afterRoll || 0) : 0, 0, after ? (subject.afterPitch || 0) : 0, "XYZ");
  animal.updateMatrixWorld(true);
  if (after && (subject.scene === "bite" || subject.scene === "ship-bite") && CBZ.swimJaw) CBZ.swimJaw(actor, 1);

  const scene = new T.Scene();
  scene.background = new T.Color(0x071c2b);
  scene.fog = new T.Fog(0x071c2b, 25, 68);
  scene.add(new T.HemisphereLight(0xc9efff, 0x05121b, 0.92));
  const sun = new T.DirectionalLight(0xffffff, 1.32); sun.position.set(-7, 13, 11); scene.add(sun);
  const fill = new T.DirectionalLight(0x4ab9ed, 0.52); fill.position.set(10, -1, 7); scene.add(fill);

  const floor = new T.Mesh(new T.PlaneGeometry(80, 42), new T.MeshStandardMaterial({ color: 0x0d3541, roughness: 0.96 }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -9.2; scene.add(floor);
  const floorGrid = new T.GridHelper(80, 48, 0x286779, 0x154552); floorGrid.position.y = -9.18; scene.add(floorGrid);
  const surface = new T.Mesh(new T.PlaneGeometry(80, 34), new T.MeshPhysicalMaterial({
    color: 0x1683ad, transparent: true, opacity: 0.25, roughness: 0.18,
    metalness: 0.03, depthWrite: false, side: T.DoubleSide,
  }));
  surface.rotation.x = -Math.PI / 2; surface.position.y = 0; surface.renderOrder = 5; scene.add(surface);
  const waterline = new T.Mesh(new T.BoxGeometry(80, 0.045, 0.07), new T.MeshBasicMaterial({ color: 0x7ce1ff, transparent: true, opacity: 0.9 }));
  waterline.position.set(0, 0.015, 0.3); waterline.renderOrder = 6; scene.add(waterline);
  for (let i = 0; i < 18; i++) {
    const bubble = new T.Mesh(new T.SphereGeometry(0.035 + (i % 3) * 0.012, 6, 5), new T.MeshBasicMaterial({ color: 0x8bdaf4, transparent: true, opacity: 0.42 }));
    bubble.position.set(-13 + i * 1.55, -1.4 - (i % 5) * 1.15, -0.7 - (i % 4) * 0.45); scene.add(bubble);
  }
  scene.add(animal);

  let rider = null;
  if (after) {
    rider = makeRider();
    const moving = subject.scene !== "mount";
    rider.riding = {
      width: visual.width, moving, airborne: /takeoff|apex|reentry/.test(subject.scene),
      phase: subject.scene === "bite" || subject.scene === "ship-bite" ? 2.2 : 1.1,
      speed: moving ? (visual.sprint || visual.cruise || 8) : 0,
      aquatic: true, attacking: subject.scene === "bite" || subject.scene === "ship-bite",
    };
    for (let i = 0; i < 90; i++) CBZ.animChar(rider, rider.riding.speed, 1 / 60);
    const hs = (rider.group.userData && rider.group.userData.humanScale) || 1;
    const hip = (rider.hipY || 0.95) * hs;
    const seat = new T.Vector3(visual.x, visual.y, 0).applyEuler(animal.rotation);
    rider.group.rotation.x = animal.rotation.x * 0.42;
    rider.group.rotation.y = Math.PI / 2;
    rider.group.rotation.z = animal.rotation.z * 0.58;
    const hipOffset = new T.Vector3(0, hip, 0).applyEuler(rider.group.rotation);
    rider.group.position.copy(animal.position).add(seat).sub(hipOffset);
    scene.add(rider.group);
  } else {
    rider = makeRider(); poseSwimmer(rider, 1.15);
    rider.group.position.fromArray(subject.swimmer || [-2.5, -0.65, 1.1]);
    rider.group.rotation.y = Math.PI / 2;
    scene.add(rider.group);
  }

  let targetActor = null;
  if (subject.targetSpecies) {
    targetActor = makeAnimal(subject.targetSpecies);
    if (!targetActor) return { ok: false, missing: subject.targetSpecies };
    targetActor.group.position.fromArray(subject.targetAnimal || [2.2, -0.8, 0]);
    targetActor.group.updateMatrixWorld(true);
    scene.add(targetActor.group);
  }

  let ship = null;
  if (subject.ship) {
    if (!CBZ.cityBuildAmbientCarVisual) return { ok: false, missing: "cityBuildAmbientCarVisual" };
    ship = CBZ.cityBuildAmbientCarVisual("Speedboat");
    if (!ship) return { ok: false, missing: "Speedboat visual" };
    ship.position.fromArray(subject.shipAt || [6.5, 0, 0]);
    ship.rotation.y = Math.PI / 2;
    ship.rotation.z = after ? (subject.shipRoll || 0) : 0;
    ship.updateMatrixWorld(true);
    scene.add(ship);
  }

  if (after && subject.scene === "takeoff") addSplash(scene, afterAnimal[0] - 0.45, 1.05);
  if (after && subject.scene === "reentry") addSplash(scene, afterAnimal[0] + 0.35, 1.35);
  if (after && subject.scene === "ship-bite") addSplash(scene, (subject.shipAt || [4.25])[0] - 0.6, 1.8);

  const aspect = input.width / input.height;
  const ref = input.referenceStage && input.referenceStage.camera;
  const framedHeight = ref ? ref.framedHeight : Number(subject.frame || 8);
  const camera = new T.OrthographicCamera(-framedHeight * aspect / 2, framedHeight * aspect / 2, framedHeight / 2, -framedHeight / 2, 0.01, 250);
  const cameraTarget = ref ? ref.target : (subject.target || [0, 0, 0]);
  const cameraPosition = ref ? ref.position : [cameraTarget[0] + 0.5, cameraTarget[1] + 0.8, 34];
  const cameraUp = ref ? ref.up : [0, 1, 0];
  camera.position.fromArray(cameraPosition); camera.up.fromArray(cameraUp);
  camera.lookAt(new T.Vector3().fromArray(cameraTarget)); camera.updateProjectionMatrix();
  studio.scene = scene; studio.camera = camera;
  studio.renderer.setSize(input.width, input.height, false);
  studio.renderer.render(scene, camera);

  const side = studio.overlay.querySelector("[data-side]");
  const name = studio.overlay.querySelector("[data-name]");
  const focus = studio.overlay.querySelector("[data-focus]");
  const state = studio.overlay.querySelector("[data-state]");
  const metric = studio.overlay.querySelector("[data-metric]");
  const source = studio.overlay.querySelector("[data-source]");
  side.textContent = after ? input.afterLabel : input.beforeLabel;
  side.style.cssText = `position:absolute;top:24px;left:28px;padding:7px 11px;border-radius:7px;background:${after ? "#187e5a" : "#bd4848"};font-size:12px;font-weight:900;letter-spacing:.12em`;
  name.textContent = subject.label;
  name.style.cssText = "position:absolute;top:69px;left:28px;font-size:29px;font-weight:850;letter-spacing:-.025em";
  focus.textContent = subject.focus;
  focus.style.cssText = "position:absolute;top:108px;left:30px;color:#c1d5df;font-size:13px;font-weight:550;max-width:760px;line-height:1.35";
  state.textContent = after ? subject.afterState : subject.beforeState;
  state.style.cssText = `position:absolute;right:27px;top:26px;color:${after ? "#7df0b8" : "#ffaaaa"};font-size:11px;font-weight:900;letter-spacing:.1em`;
  metric.textContent = subject.metric;
  metric.style.cssText = "position:absolute;right:27px;bottom:22px;padding:7px 10px;border-radius:6px;background:rgba(3,18,28,.72);color:#bfeeff;font:11px ui-monospace,SFMono-Regular,Menlo,monospace";
  source.textContent = new URL(input.sourceUrl).host + new URL(input.sourceUrl).pathname;
  source.style.cssText = "position:absolute;bottom:22px;left:28px;color:#91aab7;font:11px ui-monospace,SFMono-Regular,Menlo,monospace";

  const box = new T.Box3().setFromObject(animal);
  return {
    ok: true,
    species: sp.id,
    scene: subject.scene,
    mounted: after,
    jawOpen: !!(after && (subject.scene === "bite" || subject.scene === "ship-bite")),
    targetSpecies: targetActor && targetActor.species.id,
    realSpeedboat: !!ship,
    ride: visual ? {
      x: Number(visual.x.toFixed(3)), y: Number(visual.y.toFixed(3)), width: Number(visual.width.toFixed(3)),
      sprint: Number((visual.sprint || 0).toFixed(2)), breach: !!visual.breach, attack: !!visual.attack, shipBite: !!visual.shipBite,
    } : null,
    bounds: box.getSize(new T.Vector3()).toArray().map((value) => Number(value.toFixed(3))),
    camera: { framedHeight, position: cameraPosition.slice(), target: cameraTarget.slice(), up: cameraUp.slice() },
  };
}

export default {
  id: "sea-mounts",
  title: "Sea Animals Become Movement, Attack, and Transport",
  description: "Ten matched interaction frames compare the deployed swimmer-beside-animal baseline with the current mounted system: iPad press-to-ride, a dolphin's sprint-and-rise breach sequence, water-column steering, shark bites at the authored jaw, and a mounted megalodon biting the real Speedboat hull. These are combined assemblies and state transitions—not isolated asset portraits.",
  beforeLabel: "BEFORE · DEPLOYED",
  afterLabel: "AFTER · SEA MOUNTS",
  pairNote: "Same registered assets · camera · waterline · light · viewport",
  method: "Each pair loads its animal, player, prey, and ship assets from the page being captured. The deployed frame stages the prior swimmer-beside-animal state; the local frame stages the requested mounted/contact state. Subject geometry, viewport, waterline, lighting, and the camera returned by the deployed capture are held fixed so assembly and motion are directly comparable.",
  viewport: { width: 1100, height: 680 },
  readyExpression: "window.THREE && window.CBZ && CBZ.makeCharacter && CBZ.animChar && CBZ.buildSwimRig && CBZ.swimJaw && CBZ.cityBuildAmbientCarVisual && CBZ.WILDLIFE_SPECIES && CBZ.WILDLIFE_SPECIES.dolphin && CBZ.WILDLIFE_SPECIES.megalodon && CBZ.WILDLIFE_SPECIES.manta_ray",
  subjects,
  stage: stageSeaMount,
};
