/* orca-pod — the orca, from the owner's reference photographs.

   A FLAG A/B AGAINST THIS SAME CHECKOUT. Both sides run the identical build;
   the BEFORE page carries ?orca=off, which src/city/wildlife_orca.js reads at
   load and which makes it hand city/wildlife/aquatic.js's original orca back
   through CBZ.defineSpecies (CBZ.orcaUseLegacyModel is the seam). So the two
   columns are the SAME renderer, the SAME lights, the SAME camera and the SAME
   pose — the only variable is which animal got built.

   WHAT THE BEFORE COLUMN ACTUALLY IS: a black hull with a white belly, two
   rectangles painted into thirteen rings of geometry (a "white eye patch" that
   is a band of quads and a "saddle" that is another one), one dorsal fin shape
   for every animal in the ocean regardless of sex, no blowhole, no flank flare,
   no white chin, and nothing above the water at all.

   WHAT THIS PRESET STAGES, and why each frame exists:

     bull-dorsal / cow-dorsal   THE DIMORPHISM. A bull's dorsal is a nearly
        straight vertical tower; a cow's is shorter and clearly falcate. One
        shape for both sexes is a bug, and it is the single most recognisable
        silhouette in the ocean. Two frames, same camera, so the reader can put
        a ruler on them.
     markings-side / -front / -under   THE MARKINGS, from three angles: the
        white post-ocular eye patch (above and BEHIND the eye, angled back),
        the grey saddle behind and below the dorsal, the flank flare sweeping
        up the side and back toward the tail, the white chin and throat, and
        the white undersides of the flukes.
     pod-formation   Four adults in line abreast with a CALF in its mother's
        slipstream — the thing the owner asked for and the thing you actually
        spend your time watching.
     spy-hop   The reference photograph: the animal rises vertically beside a
        real Speedboat hull to get its eye above the water and look at you.
     grab-drag   An orca does NOT bite and release like a shark. It holds, and
        it is photographed here with the prey still in its jaws.
     takedown-1 / -3 / -6 / -dead   THE MEGALODON, at four pod sizes, with the
        verdict AND the seconds read live out of the game's own solver
        (CBZ.orcaTakedown, which prefers city/marine_predation.js's threshold
        and falls back to wildlife_orca.js's own when that file is not loaded)
        rather than typed into this file. One loses and breaks off. Three
        harry it to a standstill and cannot finish it. Six roll it. Eight
        DROWN it — and that last frame exists because it did not before: an
        eight-orca pod staged in games/battle.html left the megalodon alive,
        which is the whole feature not happening, and a report with no frame of
        the animal dying could never have caught it.

   THE PRESET STAGES; IT DOES NOT SIMULATE. Every pose here is written by this
   file, because a still photograph of a behaviour is the point — the behaviour
   itself is ticked by the shared drivers in play and is not this tool's claim.
   The one thing that IS read live is the takedown arithmetic, which is a number
   the game computes and this file only prints. */

const subjects = [
  {
    id: "bull-dorsal", label: "Bull — The Dorsal Tower", sex: "bull",
    focus: "A bull's dorsal fin is enormous, nearly straight and vertical. The before build gives every orca in the ocean the same fin.",
    frame: 9.0, target: [0.2, 2.0, 0], cameraOffset: [0.2, 1.4, 16], animalYaw: -0.02,
    state: "MALE · STRAIGHT VERTICAL",
  },
  {
    id: "cow-dorsal", label: "Cow — The Falcate Blade", sex: "cow",
    focus: "A cow's or juvenile's dorsal is shorter and clearly falcate — curved back. Same camera as the bull frame, so the two are directly comparable.",
    frame: 9.0, target: [0.2, 2.0, 0], cameraOffset: [0.2, 1.4, 16], animalYaw: -0.02,
    state: "FEMALE · FALCATE",
  },
  {
    id: "markings-side", label: "Markings — Full Flank", sex: "bull",
    focus: "Eye patch above and behind the eye, grey saddle behind and below the dorsal, and the white flank flare sweeping up the side and back toward the tail.",
    frame: 8.4, target: [0.6, 1.5, 0], cameraOffset: [0.0, 0.3, 16], animalYaw: 0,
    state: "SIDE · HARD-EDGED CONTRAST",
  },
  {
    id: "markings-head", label: "Markings — The Eye Patch, Close", sex: "cow",
    focus: "The white post-ocular patch is THE identifying mark of the animal. It must be a crisp angled oval on curved skin, not a staircase of hull quads.",
    frame: 3.4, target: [3.5, 1.6, 0], cameraOffset: [1.1, 0.55, 9], animalYaw: -0.34,
    state: "HEAD · POST-OCULAR PATCH",
  },
  {
    id: "markings-front", label: "Markings — Head On", sex: "bull",
    focus: "From the front an orca is a white face: the chin and throat white climbs well up the lower head, with a black brow and two eye patches.",
    frame: 5.6, target: [4.0, 1.4, 0], cameraOffset: [11, 1.2, 0.1], animalYaw: 0,
    state: "HEAD-ON · WHITE CHIN + THROAT",
  },
  {
    id: "markings-under", label: "Markings — Belly and Fluke Undersides", sex: "cow",
    focus: "The white belly, the flare lobes on both flanks, and the WHITE UNDERSIDES of the horizontal flukes. A shark's tail is vertical; this one is not.",
    frame: 9.5, target: [-1.0, 1.0, 0], cameraOffset: [1.0, -12, 3.0], animalYaw: 0,
    state: "FROM BELOW · FLUKE UNDERSIDES",
  },
  {
    id: "pod-formation", label: "The Pod — Line Abreast, With a Calf", sex: "bull",
    pod: true,
    focus: "A matriarch, cows and a bull travelling abreast, with a calf glued into its mother's slipstream just behind and beside her.",
    frame: 34, target: [0, 1.2, 4], cameraOffset: [-6, 20, 24],
    state: "POD · ABREAST + CALF",
  },
  {
    id: "spy-hop", label: "Spy-Hop Beside the Boat", sex: "bull",
    ship: true, shipAt: [-1.5, 0, 7.5], shipYaw: 0.35, act: "spyhop",
    focus: "The reference photograph: it rises vertically to get its eye above the water and LOOK at the boat. No shark in this game can do this.",
    frame: 17, target: [1.2, 3.0, 3.2], cameraOffset: [7.5, 2.0, 13],
    state: "SPY-HOP · EYE ABOVE WATER",
  },
  {
    id: "grab-drag", label: "The Grab-and-Drag", sex: "bull",
    prey: "tuna", act: "drag",
    focus: "An orca holds. It does not bite and back off like a shark — it drags the prey under, thrashes it, and surfaces with it still in its mouth.",
    frame: 8.0, target: [3.0, 1.1, 0], cameraOffset: [2.2, 0.9, 12], animalYaw: -0.10,
    state: "SEIZED · HELD, NOT RELEASED",
  },
  {
    id: "takedown-1", label: "One Orca vs. a Megalodon — It Loses", sex: "bull",
    meg: true, podSize: 1,
    focus: "One orca takes a bite and breaks off bleeding. The verdict under the frame is read out of the game's own pod solver, not typed here.",
    frame: 30, target: [0, 0.5, 0], cameraOffset: [3, 12, 26],
    state: "POD 1 · LOSES",
  },
  {
    id: "takedown-3", label: "Three Orcas vs. a Megalodon — Stalemate", sex: "bull",
    meg: true, podSize: 3,
    focus: "Three harry it from several bearings so it cannot face them all, and neither side wins cleanly.",
    frame: 34, target: [0, 0.5, 0], cameraOffset: [3, 14, 30],
    state: "POD 3 · GRINDING STALEMATE",
  },
  {
    id: "takedown-6", label: "Six Orcas — The Roll-Over Finisher", sex: "bull",
    meg: true, podSize: 6, roll: 0.55,
    focus: "Enough of them and the megalodon dies — rammed, stunned, then rolled BELLY-UP into tonic immobility and held there until it drowns. This is the roll, halfway over.",
    frame: 36, target: [0, 0.5, 0], cameraOffset: [4, 15, 32],
    state: "POD 6 · TONIC ROLL",
  },
  {
    id: "takedown-dead", label: "Eight Orcas — The Megalodon Is Dead", sex: "bull",
    meg: true, podSize: 8, roll: 1, megDead: true,
    focus: "THE FRAME THE WHOLE FEATURE IS FOR. Fully inverted, drowned, sinking, with the pod still on it. Eight orcas against a megalodon has to END, and the number under the frame is the seconds the game's own solver says it takes.",
    frame: 40, target: [0, -1.0, 0], cameraOffset: [5, 13, 34],
    state: "POD 8 · DROWNED · KILL",
  },
];

const readyExpression =
  "window.THREE && window.CBZ && CBZ.buildSwimRig && CBZ.WILDLIFE_SPECIES && " +
  "CBZ.WILDLIFE_SPECIES.orca && CBZ.WILDLIFE_SPECIES.megalodon && CBZ.WILDLIFE_SPECIES.tuna";

function stageOrcaPod(input) {
  const T = window.THREE, CBZ = window.CBZ, subject = input.subject;
  if (!T || !CBZ || !CBZ.WILDLIFE_SPECIES || !CBZ.buildSwimRig) {
    return { ok: false, missing: "orca staging APIs" };
  }

  // ---- THE FLAG A/B --------------------------------------------------------
  // ?orca=off is read by wildlife_orca.js at LOAD (so the species registration
  // never happens), but the tool serves both sides from one page load per side,
  // so the model is also swapped explicitly here. Belt and braces: whichever
  // mechanism fires, the two columns cannot end up building the same animal.
  const OFF = new URLSearchParams(location.search).get("orca") === "off";
  if (typeof CBZ.orcaUseLegacyModel === "function") {
    try { CBZ.orcaUseLegacyModel(OFF); } catch (_) {}
  }

  let studio = window.__cbzVisualCompare;
  if (!studio || !studio.renderer) {
    document.documentElement.style.cssText = "margin:0;width:100%;height:100%;background:#04121c";
    document.body.innerHTML = "";
    document.body.style.cssText = "margin:0;width:100%;height:100%;overflow:hidden;background:#04121c;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    const renderer = new T.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1); renderer.setSize(input.width, input.height, false);
    renderer.outputEncoding = T.sRGBEncoding;
    renderer.domElement.style.cssText = `display:block;width:${input.width}px;height:${input.height}px`;
    document.body.appendChild(renderer.domElement);
    const overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;color:#f2f9ff;text-shadow:0 2px 10px #00131f;z-index:2147483647";
    overlay.innerHTML = "<div data-side></div><div data-name></div><div data-focus></div><div data-state></div><div data-read></div><div data-source></div>";
    document.body.appendChild(overlay);
    studio = window.__cbzVisualCompare = { renderer, overlay, scene: null, camera: null };
    studio.render = function () { if (studio.scene && studio.camera) studio.renderer.render(studio.scene, studio.camera); };
  }

  const materials = new Map();
  function animalMaterial(color) {
    const key = Number(color == null ? 0x78858d : color);
    if (!materials.has(key)) {
      materials.set(key, new T.MeshStandardMaterial({
        color: key, roughness: 0.55, metalness: 0.02, flatShading: false,
      }));
    }
    return materials.get(key);
  }
  function makeAnimal(id) {
    const species = CBZ.WILDLIFE_SPECIES[id];
    if (!species || typeof species.build !== "function") return null;
    const group = species.build({ THREE: T, mat: animalMaterial, rng: () => 0.25 });
    group.scale.setScalar(Number(species.scale) || 1);
    group.traverse(o => { o.matrixAutoUpdate = true; });
    const actor = {
      species, group, pos: group.position, heading: 0, faceH: 0, dead: false,
      hp: species.hp, maxHp: species.hp, swimDepth: species.swimDepth || 2,
      home: { x: 0, z: 0 }, _sizeMul: 1, _sizeEff: Number(species.scale) || 1,
    };
    CBZ.buildSwimRig(actor);
    return actor;
  }
  // the model's own answer for "which sex is this one", forced for staging
  function setSex(actor, sex) {
    if (typeof CBZ.orcaStage === "function") {
      try { return CBZ.orcaStage(actor, sex); } catch (_) {}
    }
    return false;
  }

  const scene = new T.Scene();
  scene.background = new T.Color(0x04121c);
  scene.fog = new T.Fog(0x04121c, 46, 150);
  scene.add(new T.HemisphereLight(0xd6f0ff, 0x03131c, 1.05));
  const key = new T.DirectionalLight(0xffffff, 1.75); key.position.set(6, 14, 12); scene.add(key);
  const rim = new T.DirectionalLight(0x58c8ff, 0.85); rim.position.set(-11, 5, -9); scene.add(rim);
  const bounce = new T.DirectionalLight(0x2c6f8a, 0.55); bounce.position.set(0, -8, 4); scene.add(bounce);

  const water = new T.Mesh(new T.PlaneGeometry(340, 260), new T.MeshPhysicalMaterial({
    color: 0x0b6f95, transparent: true, opacity: 0.20, roughness: 0.16,
    metalness: 0.02, depthWrite: false, side: T.DoubleSide,
  }));
  water.rotation.x = -Math.PI / 2; water.position.y = 3.2; water.renderOrder = 5; scene.add(water);
  const seabed = new T.Mesh(new T.PlaneGeometry(340, 260), new T.MeshStandardMaterial({ color: 0x0a2c36, roughness: 1 }));
  seabed.rotation.x = -Math.PI / 2; seabed.position.y = -16; scene.add(seabed);

  // ---- the cast ------------------------------------------------------------
  const orca = makeAnimal("orca");
  if (!orca) return { ok: false, missing: "orca" };
  setSex(orca, subject.sex || "bull");
  const g = orca.group;
  g.position.set(0, 0, 0);
  g.rotation.y = subject.animalYaw || 0;

  const read = { podSize: 0, needed: 0, verdict: "", spout: 0 };
  const cast = [orca];

  if (subject.pod) {
    /* THE POD, STAGED IN THE FORMATION THE GAME'S OWN station() PRODUCES:
       line abreast, ranked outward from the matriarch, plus a calf tucked into
       its mother's slipstream just behind and beside her. */
    const stations = [[-2.5, -11], [-4.0, 11], [-6.0, -22], [-3.0, 21]];
    const sexes = ["cow", "cow", "cow", "cow"];
    for (let i = 0; i < stations.length; i++) {
      const o = makeAnimal("orca");
      if (!o) continue;
      setSex(o, sexes[i]);
      o.group.position.set(stations[i][0], -0.4 - i * 0.25, stations[i][1]);
      o.group.rotation.y = -0.03 + i * 0.012;
      scene.add(o.group);
      cast.push(o);
      if (i === 0) {
        const calf = makeAnimal("orca");
        if (calf) {
          setSex(calf, "calf");
          calf.group.scale.multiplyScalar(0.55);
          // just behind and beside her — the slipstream station
          calf.group.position.set(stations[i][0] - 6.4, -1.1, stations[i][1] + 3.1);
          calf.group.rotation.y = -0.02;
          scene.add(calf.group);
          cast.push(calf);
          read.calfGap = Number(calf.group.position.distanceTo(cast[1].group.position).toFixed(2));
        }
      }
    }
    read.podSize = cast.length;
  }

  if (subject.act === "spyhop") {
    // rise vertically, nose up, eye above the water
    g.rotation.z = -1.26;
    g.position.set(0, 2.4, 0);
    g.rotation.y = 1.15;
  }

  let prey = null;
  if (subject.prey) {
    prey = makeAnimal(subject.prey);
    if (prey) {
      // in the jaws, at the socket the game's own damage uses
      const mouth = g.userData && g.userData.aquaticMouth;
      const sc = g.scale.x;
      const bx = mouth && mouth.bite ? mouth.bite.x : 2.6;
      const by = mouth && mouth.bite ? mouth.bite.y : 0.8;
      prey.group.position.set(bx * sc + 0.6, by * sc - 0.35, 0.15);
      prey.group.rotation.set(0.35, Math.PI * 0.52, 0.5);
      scene.add(prey.group);
      if (CBZ.swimJaw) { try { CBZ.swimJaw(orca, 0.85); } catch (_) {} }
      g.rotation.z = 0.32;                      // nosed down: dragging it under
      read.held = true;
    }
  }

  let meg = null;
  if (subject.meg) {
    meg = makeAnimal("megalodon");
    if (!meg) return { ok: false, missing: "megalodon" };
    meg.group.position.set(0, -2.0, 0);
    meg.group.rotation.y = 0.22;
    // the inversion, as a FRACTION of the roll: 0.55 is halfway over (the
    // finisher in progress), 1 is fully belly-up (drowned).
    if (subject.roll) meg.group.rotation.x = Math.PI * Number(subject.roll);
    if (subject.megDead) {
      meg.dead = true; meg.hp = 0;
      meg.group.position.y = -5.2;                          // sinking
      meg.group.rotation.z = 0.22;                          // nose down, going
    }
    scene.add(meg.group);

    // THE ORCAS, ON BEARINGS AROUND IT — the "it cannot face them all" read.
    const n = Math.max(1, subject.podSize | 0);
    g.position.set(15, -1.2, -9);
    g.rotation.y = Math.PI * 0.78;
    for (let i = 1; i < n; i++) {
      const o = makeAnimal("orca");
      if (!o) continue;
      setSex(o, i === 1 ? "bull" : "cow");
      const a = (i / n) * Math.PI * 2 + 0.7;
      const r = 15 + (i % 2) * 4;
      o.group.position.set(Math.cos(a) * r, -1.0 - (i % 3) * 1.1, Math.sin(a) * r);
      o.group.rotation.y = -a + Math.PI;
      scene.add(o.group);
      cast.push(o);
    }
    read.podSize = n;

    // THE VERDICT, READ LIVE. CBZ.orcaTakedown asks marine_predation's own
    // podNeeded() (and falls back to the same time-to-kill arithmetic if that
    // block is absent), so this number is the game's, not the preset's.
    if (typeof CBZ.orcaTakedown === "function") {
      try {
        if (typeof CBZ.orcaIdentity === "function") CBZ.orcaIdentity(orca);
        const td = CBZ.orcaTakedown(orca, meg, n);
        if (td) {
          read.needed = td.needed; read.verdict = td.verdict;
          read.rollOver = !!td.rollOver; read.source = td.source;
          read.driver = td.driver;
          // WITH THE BLOCK REVERTED THIS FIGHT DOES NOT HAPPEN, so the seconds
          // are reported as zero rather than as arithmetic nobody would ever
          // see play out. That is what makes the column honest.
          read.seconds = td.enabled ? td.seconds : 0;
          read.killed = td.enabled && td.killed ? 1 : 0;
          read.casualties = td.enabled ? (td.casualties + (td.withdrew || 0)) : 0;
          read.quarryHpPct = td.enabled ? td.quarryHpPct : 100;
        }
      } catch (_) {}
    }
  }

  let ship = null;
  if (subject.ship && CBZ.cityBuildAmbientCarVisual) {
    try { ship = CBZ.cityBuildAmbientCarVisual("Speedboat"); } catch (_) { ship = null; }
    if (ship) {
      ship.position.fromArray(subject.shipAt || [0, 0, 6]);
      ship.rotation.y = subject.shipYaw || 0;
      ship.position.y = 3.0;
      scene.add(ship);
    }
  }

  scene.add(g);
  scene.updateMatrixWorld(true);

  // ---- WHAT IS ACTUALLY ON THIS MODEL — measured off the built group -------
  function measure(group) {
    const out = {
      markingMeshes: 0, dorsalShapes: 0, blowhole: 0, hullTris: 0,
      whiteFrac: 0, eyePatchAreaM2: 0, dorsalSpanM: 0, meshes: 0,
    };
    const sc = group.scale.x || 1;
    let hull = null;
    group.traverse(function (o) {
      if (!o.isMesh) return;
      out.meshes++;
      const n = o.name || "";
      if (n === "orcaEyePatch" || n === "orcaSaddle") out.markingMeshes++;
      if (n === "orcaBlowhole") { out.blowhole = 1; out.markingMeshes++; }
      if (n === "orcaDorsalBull" || n === "orcaDorsalCow") out.dorsalShapes++;
      if (n === "cetaceanHull" || n === "sharkHull") hull = o;
      if (n === "orcaEyePatch" && o.geometry) {
        if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
        const b = o.geometry.boundingBox;
        if (b) out.eyePatchAreaM2 = Number((Math.abs(b.max.x - b.min.x) * Math.abs(b.max.y - b.min.y) * sc * sc).toFixed(3));
      }
    });
    if (hull && hull.geometry) {
      const idx = hull.geometry.getIndex();
      const total = idx ? idx.count / 3 : (hull.geometry.getAttribute("position").count / 3);
      out.hullTris = Math.round(total);
      // how much of the animal is WHITE — the countershading plus the flank
      // flare, measured off the material groups rather than asserted
      let white = 0, all = 0;
      const gs = hull.geometry.groups || [];
      for (let i = 0; i < gs.length; i++) {
        all += gs[i].count;
        if (gs[i].materialIndex === 1) white += gs[i].count;
      }
      out.whiteFrac = all > 0 ? Number((white / all).toFixed(4)) : 0;
    }
    // the visible dorsal's height above the back, in world metres
    let tall = 0;
    group.traverse(function (o) {
      if (!o.isMesh || o.visible === false) return;
      const n = o.name || "";
      if (n.indexOf("orcaDorsal") !== 0 && n !== "sharkDorsal") return;
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      const b = o.geometry.boundingBox;
      if (b) tall = Math.max(tall, (b.max.y - b.min.y) * sc);
    });
    if (!tall) {
      // BEFORE has no named dorsal: measure the tallest child above the hull
      let top = -1e9, back = -1e9;
      group.traverse(function (o) {
        if (!o.isMesh) return;
        if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
        const b = o.geometry.boundingBox; if (!b) return;
        const t2 = (b.max.y + o.position.y) * sc;
        if (o.name === "cetaceanHull" || o.name === "sharkHull") back = t2;
        if (t2 > top) top = t2;
      });
      if (top > -1e8 && back > -1e8) tall = Math.max(0, top - back);
    }
    out.dorsalSpanM = Number(tall.toFixed(3));
    return out;
  }
  const m = measure(g);

  // BOTH dorsal shapes, measured on purpose: the dimorphism is a RATIO and a
  // single frame cannot show it. Build one of each off-scene and compare.
  let dimorph = 1, bullM = m.dorsalSpanM, cowM = m.dorsalSpanM;
  {
    const b = makeAnimal("orca"), c = makeAnimal("orca");
    if (b && c) {
      setSex(b, "bull"); setSex(c, "cow");
      bullM = measure(b.group).dorsalSpanM;
      cowM = measure(c.group).dorsalSpanM;
      dimorph = cowM > 0 ? Number((bullM / cowM).toFixed(3)) : 1;
    }
  }

  // ---- camera (the deployed side's camera is copied in by the runner) ------
  const aspect = input.width / input.height;
  const ref = input.referenceStage && input.referenceStage.camera;
  const framedHeight = ref ? ref.framedHeight : Number(subject.frame || 10);
  const camera = new T.OrthographicCamera(
    -framedHeight * aspect / 2, framedHeight * aspect / 2,
    framedHeight / 2, -framedHeight / 2, 0.01, 600);
  const cameraTarget = ref ? ref.target : subject.target;
  const off = subject.cameraOffset || [2, 2, 14];
  const cameraPosition = ref ? ref.position
    : [cameraTarget[0] + off[0], cameraTarget[1] + off[1], cameraTarget[2] + off[2]];
  const cameraUp = ref ? ref.up : [0, 1, 0];
  camera.position.fromArray(cameraPosition); camera.up.fromArray(cameraUp);
  camera.lookAt(new T.Vector3().fromArray(cameraTarget)); camera.updateProjectionMatrix();
  studio.scene = scene; studio.camera = camera;
  studio.renderer.setSize(input.width, input.height, false);
  studio.renderer.render(scene, camera);

  // ---- overlay -------------------------------------------------------------
  const after = input.side === "after", overlay = studio.overlay;
  const side = overlay.querySelector("[data-side]");
  side.textContent = after ? input.afterLabel : input.beforeLabel;
  side.style.cssText = `position:absolute;top:23px;left:27px;padding:7px 11px;border-radius:7px;background:${after ? "#187e5a" : "#bd4848"};font-size:12px;font-weight:900;letter-spacing:.12em`;
  const name = overlay.querySelector("[data-name]"); name.textContent = subject.label;
  name.style.cssText = "position:absolute;top:67px;left:28px;font-size:28px;font-weight:850;letter-spacing:-.025em";
  const focus = overlay.querySelector("[data-focus]"); focus.textContent = subject.focus;
  focus.style.cssText = "position:absolute;top:105px;left:29px;color:#bfd6e2;font-size:13px;font-weight:550;max-width:780px;line-height:1.35";
  const state = overlay.querySelector("[data-state]"); state.textContent = subject.state;
  state.style.cssText = `position:absolute;right:27px;top:26px;color:${after ? "#7df0b8" : "#ffaaaa"};font-size:11px;font-weight:900;letter-spacing:.1em`;
  const rd = overlay.querySelector("[data-read]");
  rd.textContent =
    "patches " + m.markingMeshes + " · dorsals " + m.dorsalShapes +
    " · blowhole " + (m.blowhole ? "yes" : "no") +
    " · hull " + m.hullTris + " tris · white " + Math.round(m.whiteFrac * 100) + "%" +
    (read.podSize
      ? "  |  pod " + read.podSize + (read.needed ? " / needs " + read.needed + " → " + read.verdict : "") +
        (read.seconds ? " in " + read.seconds + "s" : "") +
        (read.driver ? " [" + read.driver + "]" : "")
      : "");
  rd.style.cssText = "position:absolute;right:27px;bottom:22px;padding:7px 10px;border-radius:6px;background:rgba(2,17,27,.78);color:#bfeeff;font:11px ui-monospace,SFMono-Regular,Menlo,monospace";
  const source = overlay.querySelector("[data-source]");
  source.textContent = new URL(input.sourceUrl).host + new URL(input.sourceUrl).pathname;
  source.style.cssText = "position:absolute;bottom:22px;left:28px;color:#8ba7b6;font:11px ui-monospace,SFMono-Regular,Menlo,monospace";

  const ud = (g.userData && g.userData.orca) || null;
  return {
    ok: true,
    subject: subject.id,
    legacyModel: OFF,
    markingMeshes: m.markingMeshes,
    dorsalShapes: m.dorsalShapes,
    blowhole: m.blowhole,
    hullTris: m.hullTris,
    whitePct: Number((m.whiteFrac * 100).toFixed(2)),
    eyePatchAreaM2: m.eyePatchAreaM2,
    bullDorsalM: bullM,
    cowDorsalM: cowM,
    dorsalRatio: dimorph,
    meshCount: m.meshes,
    flankFlare: ud && ud.marks ? (ud.marks.flankFlare ? 1 : 0) : 0,
    whiteChin: ud && ud.marks ? (ud.marks.whiteChin ? 1 : 0) : 0,
    flukeUnder: ud && ud.marks ? (ud.marks.flukeUnder ? 1 : 0) : 0,
    podStaged: read.podSize || 0,
    podNeeded: read.needed || 0,
    podVerdict: read.verdict || "",
    takedownSeconds: read.seconds || 0,
    megKilled: read.killed || 0,
    podCasualties: read.casualties || 0,
    megHpLeftPct: read.podSize ? (read.quarryHpPct == null ? 100 : read.quarryHpPct) : 0,
    takedownDriver: read.driver || "",
    calfGapM: read.calfGap || 0,
    heldPrey: read.held ? 1 : 0,
    rollOverAvailable: read.rollOver ? 1 : 0,
    solverSource: read.source || "",
    hasShip: !!ship,
    camera: { framedHeight, position: cameraPosition.slice(), target: cameraTarget.slice(), up: cameraUp.slice() },
  };
}

export default {
  id: "orca-pod",
  title: "The Orca — Markings, the Dimorphic Dorsal, the Pod, and the Megalodon",
  description:
    "Twelve matched frames against this same checkout with the block reverted (?orca=off). BEFORE: a black " +
    "hull with a white belly, an 'eye patch' and a 'saddle' that are two bands of quads painted into " +
    "thirteen rings, ONE dorsal fin shape for every animal in the ocean whatever its sex, no blowhole, no " +
    "flank flare, no white chin, and nothing at all above the water. AFTER: the markings that actually " +
    "identify the animal — the white post-ocular patch as a crisp angled oval conforming to the skin, the " +
    "grey saddle as a crescent behind and below the dorsal, the white belly sweeping UP the flank in a " +
    "lobe that flares back toward the tail, the white chin and throat, white fluke undersides — a bull's " +
    "vertical dorsal tower and a cow's falcate blade built as two shapes and chosen per individual, a " +
    "blowhole that vents, a pod in formation with a calf in its mother's slipstream, the spy-hop beside a " +
    "real Speedboat hull, the grab-and-drag, and the megalodon takedown at pod sizes 1 / 3 / 6 with the " +
    "roll-over finisher. The pod-size verdict under each takedown frame is read live out of the game's own " +
    "solver.",
  defaultBefore: "local",
  beforeLabel: "BEFORE — ?orca=off (this checkout, block reverted)",
  afterLabel: "AFTER — this checkout",
  pairNote: "Same renderer · same lights · same pose · same camera · only the animal changes",
  method:
    "Both sides load the same page; the BEFORE side carries ?orca=off, which src/city/wildlife_orca.js " +
    "reads at load and which hands city/wildlife/aquatic.js's original orca back through " +
    "CBZ.defineSpecies (CBZ.orcaUseLegacyModel). Each frame then builds the registered species with the " +
    "game's own builder (WILDLIFE_SPECIES.orca.build + CBZ.buildSwimRig), forces the individual's sex " +
    "through CBZ.orcaStage, and poses it. The megalodon, the tuna and the Speedboat are the game's own " +
    "assets. THE PRESET STAGES; IT DOES NOT SIMULATE — a still of a behaviour is the point, and the " +
    "behaviour itself is ticked by the shared drivers in play. The one live read is the takedown " +
    "arithmetic (CBZ.orcaTakedown -> CBZ.marinePodNeeded), which the preset prints and does not compute.",
  urlParams: {},
  beforeParams: { orca: "off" },
  viewport: { width: 1100, height: 680 },
  stageTimeoutMs: 240000,
  subjects,
  readyExpression,
  stage: stageOrcaPod,
  metricsNote:
    "Everything is measured off the built group, not asserted: marking meshes are counted by name, hull " +
    "triangles off the index buffer, and `whitePct` off the hull's own material groups — so the flank " +
    "flare and the white chin show up as real geometry rather than as a claim in a comment. `dorsalRatio` " +
    "builds one bull and one cow off-scene and divides their dorsal heights; 1.000 means the model has ONE " +
    "fin shape for both sexes, which is the before column's bug. `podNeeded` and `podVerdict` come from " +
    "CBZ.orcaTakedown, i.e. from city/marine_predation.js's own solver — this file only prints them. THE " +
    "PICTURES ARE THE TEST; these numbers only say whether the thing in the picture is there at all.",
  metrics: {
    markingMeshes: { label: "Conforming marking meshes on the model", unit: "meshes", better: "higher" },
    dorsalShapes: { label: "Distinct dorsal fin shapes built", unit: "shapes", better: "higher" },
    dorsalRatio: { label: "Bull dorsal / cow dorsal (1.0 = no dimorphism)", unit: "x", better: "higher" },
    bullDorsalM: { label: "Bull dorsal height above the back", unit: "m", better: "higher" },
    blowhole: { label: "Blowhole on the model", unit: "0/1", better: "higher" },
    flankFlare: { label: "White flank flare declared and painted", unit: "0/1", better: "higher" },
    whiteChin: { label: "White chin and throat", unit: "0/1", better: "higher" },
    flukeUnder: { label: "White fluke undersides", unit: "0/1", better: "higher" },
    eyePatchAreaM2: { label: "Post-ocular eye patch, as its own mesh", unit: "m2", better: "higher" },
    hullTris: { label: "Hull triangles (marking resolution)", unit: "tris", better: "higher" },
    whitePct: { label: "Hull faces painted white", unit: "%", better: "higher" },
    podStaged: { label: "Animals staged in the frame", unit: "orcas", better: "higher" },
    podNeeded: { label: "Orcas the solver says it takes to kill the meg", unit: "orcas", better: "higher" },
    rollOverAvailable: { label: "Tonic roll-over finisher reachable", unit: "0/1", better: "higher" },
    megKilled: { label: "Does the megalodon actually die at this pod size", unit: "0/1", better: "higher" },
    takedownSeconds: { label: "Seconds the takedown takes (0 = it never happens)", unit: "s", better: "higher" },
    megHpLeftPct: { label: "Megalodon health left when the fight ends", unit: "%", better: "lower" },
    calfGapM: { label: "Calf's distance from its mother (slipstream)", unit: "m", better: "lower" },
  },
};
