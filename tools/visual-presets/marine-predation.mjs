/* MARINE PREDATION — blood in the water, a megalodon taking a boat, and a pod
   of orcas killing a megalodon.

   OWNER, three asks, verbatim:
     1. "bleeding in the water should attract sharks — not show up on HUD but
         just show in game"
     2. "how megalodon eating small ship looks"
     3. "how orcas attacking a megladon and enough orcas should beat a megladon"

   IT IS A FLAG A/B, NOT A DEPLOY DIFF. Both columns are THIS checkout and the
   only difference is `?marine=off`, which turns MARINE_PREDATION, ORCA_POD,
   MEG_SHIP_BITE and WATER_CHUM_ALL off — the block's own one-line reverts.
   Nothing else can move between the columns.

   IT IS A STUDIO BUILT OUT OF THE GAME'S OWN PARTS, NOT A GALLERY. Each frame
   boots the real city at seed 90210, freezes the rAF loop so CBZ.stepSim is
   the only clock, seeds Math.random from one LCG so both sides walk the same
   dice, finds a deterministic patch of deep water, and then SPAWNS THE CAST
   with the game's own builders (CBZ.WILDLIFE_SPECIES[id].build +
   CBZ.buildSwimRig for animals, CBZ.cityMakeCar for the boat) and registers
   them into CBZ.cityWildlife / CBZ.cityCars. From that point on nothing here
   drives anything: the fight is ticked by wildlife.js's own aquatic branch ->
   CBZ.sharkBrain -> the marine_predation wrapper -> CBZ.predatorHunt /
   CBZ.creatureFight, exactly as it runs in a played game.

   So the pictures and the numbers describe the same simulated seconds, and
   the numbers come off the block's own probe (CBZ.marineAudit) plus direct
   reads of the actors' health and the boat's hull.

   WHAT TO LOOK FOR is in each subject's `focus`. The claims the metrics test:

     sharksNear      sharks that closed to within 90 u of the bleeding animal
                     in 45 s. Before there is no chum at all and no marine
                     hunt, so they wander.
     chumSources     live entries in CBZ.goreChumList(). This is the seam that
                     existed and had three producers in the whole game.
     feedLines       killfeed / phone-notify calls made during the fight,
                     counted by wrapping them for its duration. Zero, and it
                     must stay zero — the owner asked twice.
     hullEngine      the boat's remaining engine health after the bite. 0 = the
                     hull is holed and vehicles.js has handed it to
                     water_float's flooding/sinking owner.
     megHpPct        what is left of the megalodon after the engagement.
     timeToKillS     how long the pod took. -1 = it never killed it.
     orcaDeaths      what the pod paid.
     rams / rolls    flank rams landed, and roll-over finishers started.
     podNeeded       the block's OWN derived answer to "how many does it take"
                     — solved from hp/bite/size, never typed in.
*/

/* A 30 Hz FIXED STEP, not 60. Every one of these frames is a full CBZ.stepSim
   over the whole city, and this page simulates about five minutes of fighting
   across its eleven subjects. 1/30 halves that bill and changes nothing about
   the result — every driver in the chain (predatorHunt, creatureFight, the
   swim mover, the tonic roll) integrates dt. */
const RUN = 1 / 30;

const subjects = [
  {
    id: "blood-in-the-water",
    label: "Blood in the water",
    scenario: "chum",
    seconds: 32,
    focus: "A wounded dolphin trailing blood in open water with four great whites 210 m off. BEFORE: nothing in this game made a hurt animal bleed, so the sharks have no reason to come and do not. AFTER: the bleeder holds a goreChum handle whose position is a FUNCTION, so the plume follows it, and the sharks converge on it. Look for the red bloom on the surface and the fins turning toward it.",
    state: "CHUM · 4 GREAT WHITES @ 210 m",
    shot: { dist: 120, height: 46, pitch: 0.52 },
  },
  {
    id: "meg-ship-approach",
    label: "Megalodon — the approach, from below and behind",
    scenario: "ship", seconds: 4.5,
    focus: "A shark taking a surface target comes up from below and behind. The approach bearing is the boat's own stern quarter and the dive target is deep until the last moment — so what you should see is a big dark shape rising astern, not a fish swimming at a boat on the level.",
    state: "APPROACH · STERN QUARTER",
    shot: { dist: 34, height: 11, pitch: 0.34 },
  },
  {
    id: "meg-ship-jaws",
    label: "Megalodon — jaws across the beam",
    scenario: "ship", seconds: 7.2,
    focus: "The bite is not a nose-bump. The jaws are wide and they close ACROSS the beam of the hull, and the contact test is the boat's version of creature_combat's jawReaches — the animal's own tooth ring taken into the hull's frame and tested against the real LOA x beam box, so a short bite MISSES.",
    state: "CONTACT · JAWS ON THE HULL",
    shot: { dist: 26, height: 7, pitch: 0.22 },
  },
  {
    id: "meg-ship-crushed",
    label: "Megalodon — the hull crushes",
    scenario: "ship", seconds: 9.5,
    focus: "At the bite line the hull caves and splinters: crashdeform's own crater loop (which had boats excluded, and now takes them when a caller declares a structural bite) plus crashfx's directed ejecta cone for the debris. The boat is lifted and shaken. No fireball — a shark's mouth does not explode a boat.",
    state: "STRUCTURE FAILS · DEBRIS",
    shot: { dist: 24, height: 8, pitch: 0.3 },
  },
  {
    id: "meg-ship-sinking",
    label: "Megalodon — the boat goes down",
    scenario: "ship", seconds: 22,
    focus: "Engine gutted, the same intact hull is handed to water_float's wreck/flooding owner and goes down by the bow. This is reuse, not a new sinking system: the exact path a megalodon RIDDEN by the player already used.",
    state: "HOLED · FLOODING",
    shot: { dist: 28, height: 9, pitch: 0.42 },
  },
  {
    id: "meg-ship-men",
    label: "Men in the water",
    scenario: "shipmen", seconds: 28,
    focus: "The occupants went over the side at the bite. In the water they are hurt, so they bleed, so they are chum, so the sharks come — three separate blocks composing with no code between them. That composition IS the feature.",
    state: "SURVIVORS · SHARKS INBOUND",
    shot: { dist: 44, height: 16, pitch: 0.5 },
  },
  {
    id: "orca-one",
    label: "One orca against a megalodon",
    scenario: "pod", pod: 1, seconds: 45,
    focus: "It loses, and it has to visibly lose. One orca cannot unlock the roll-over (the block's own podNeeded says four), so it harries, takes a bite, and breaks off bleeding — which chums the water and draws sharks to it. Watch the megalodon's health barely move.",
    state: "POD 1 · THE ORCA LOSES",
    shot: { dist: 60, height: 26, pitch: 0.5 },
  },
  {
    id: "orca-three",
    label: "Three orcas — a stalemate",
    scenario: "pod", pod: 3, seconds: 48,
    focus: "Three is a real fight and nobody wins it. They take bearings, they ram the flank, the megalodon is staggered and loses its facing — but three is still one short of what the numbers say it takes, so the finisher never unlocks and it grinds.",
    state: "POD 3 · NEITHER SIDE WINS",
    shot: { dist: 62, height: 28, pitch: 0.5 },
  },
  {
    id: "orca-pod-kill",
    label: "The pod — enough orcas",
    scenario: "pod", pod: 5, seconds: 48,
    focus: "Five. Past the derived threshold, so the roll-over unlocks and the megalodon dies. The tactics are the point: they harry it from several bearings at once so it cannot face them all, and the staggers from the flank rams overlap.",
    state: "POD 5 · THE MEGALODON DIES",
    shot: { dist: 62, height: 28, pitch: 0.48 },
  },
  {
    id: "orca-roll-over",
    label: "The roll-over finisher",
    scenario: "pod", pod: 5, seconds: 48, holdRoll: true,
    focus: "Tonic immobility, and it is the animation that makes this feature. The megalodon is turned belly-up and stops fighting. It must read as a slow, deliberate INVERSION with a struggle at the front of it — a fast flip reads as a rotation glitch, which is the one failure mode this shot exists to catch. White belly at the surface.",
    state: "FINISHER · BELLY-UP",
    shot: { dist: 30, height: 10, pitch: 0.26 },
  },
  {
    id: "big-meg-small-pod",
    label: "Control — a monster megalodon against the same pod",
    scenario: "pod", pod: 5, megSize: 1.5, seconds: 48,
    focus: "The control that proves size is in the expression on BOTH sides, not decoration. The same five orcas against a megalodon half again as big: podNeeded goes from four to eleven, so the finisher never unlocks and the pod that just won loses. If this frame looks like the one before it, the size term is doing nothing.",
    state: "MONSTER MEG · THE POD LOSES",
    shot: { dist: 68, height: 30, pitch: 0.5 },
  },
];

const readyExpression = "window.THREE && window.CBZ && CBZ.CONFIG && CBZ.WILDLIFE_SPECIES";

async function stageMarinePredation(input) {
  const CBZ = window.CBZ, T = window.THREE;
  if (!CBZ || !T) return { ok: false, missing: "CBZ/THREE" };
  const subject = input.subject;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (test, budgetMs, stepMs) => {
    const deadline = Date.now() + budgetMs;
    while (Date.now() < deadline) {
      try { if (test()) return true; } catch (_) {}
      await wait(stepMs || 250);
    }
    return false;
  };

  let S = window.__marinePredStage;
  if (!S) {
    const booted = await until(
      () => CBZ.game && (CBZ.bootComplete || CBZ.game.state === "title") &&
        CBZ.stepSim && document.getElementById("playBtn"), 420000);
    if (!booted) return { ok: false, err: "never booted" };
    if (CBZ.CONFIG) CBZ.CONFIG.CITY_HITMAN_CAMPAIGN = false;
    const playing = await until(() => {
      if (CBZ.game.state === "playing") return true;
      const b = document.getElementById("playBtn"); if (b) b.click();
      return CBZ.game.state === "playing";
    }, 420000, 300);
    if (!playing) return { ok: false, err: "never reached playing" };
    if (CBZ.game.cityCampaign) CBZ.game.cityCampaign.phase = "endless_contracts";
    try { if (CBZ.setQualityLevel) CBZ.setQualityLevel(3); } catch (_) {}

    // Freeze the render loop. CBZ.stepSim is the only clock from here.
    window.requestAnimationFrame = function () { return 0; };
    await wait(700);

    // ONE seeded stream for the whole pass, so predator.js's fake-out roll and
    // creature_combat's cadence walk the same path on both sides.
    let seed = 0x9e3779b9 >>> 0;
    Math.random = function () {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let i = 0; i < 90; i++) { CBZ.hitstop = 0; CBZ.slowmo = 0; CBZ.stepSim(RUN); }

    const overlay = document.createElement("div");
    overlay.id = "__marinePredOverlay";
    overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;color:#f2f8fc;text-shadow:0 2px 9px #001019;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    overlay.innerHTML = "<div data-side></div><div data-name></div><div data-focus></div><div data-state></div><div data-read></div><div data-source></div>";
    document.body.appendChild(overlay);
    S = window.__marinePredStage = { overlay, spawned: [], cars: [], men: [] };
    window.__cbzVisualCompare = {
      render() { try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (_) {} },
    };
  }

  // ---- THE FLAG A/B ---------------------------------------------------------
  // The block reads its flags LIVE at every entry point, so flipping them here
  // is the whole "before" — no reload, no second build, nothing else can move.
  const OFF = new URLSearchParams(location.search).get("marine") === "off";
  CBZ.CONFIG.MARINE_PREDATION = !OFF;
  CBZ.CONFIG.ORCA_POD = !OFF;
  CBZ.CONFIG.MEG_SHIP_BITE = !OFF;
  CBZ.CONFIG.WATER_CHUM_ALL = !OFF;
  if (CBZ.marineAuditReset) CBZ.marineAuditReset();

  const wf = CBZ.waterField;
  if (!wf) return { ok: false, missing: "waterField" };

  // ---- clear the previous subject's cast -----------------------------------
  const wl = CBZ.cityWildlife || [];
  for (const a of S.spawned) {
    const i = wl.indexOf(a);
    if (i >= 0) wl.splice(i, 1);
    a._despawned = true; a.dead = true;
    if (a.group && a.group.parent) a.group.parent.remove(a.group);
  }
  S.spawned.length = 0;
  const cars = CBZ.cityCars || [];
  for (const c of S.cars) {
    const i = cars.indexOf(c);
    if (i >= 0) cars.splice(i, 1);
    if (c.group && c.group.parent) c.group.parent.remove(c.group);
  }
  S.cars.length = 0;
  if (S.men) S.men.length = 0;
  if (CBZ.goreChumStop && CBZ.goreChumList) {
    const live = CBZ.goreChumList();
    // (the list is rebuilt in place by gore.js; nothing to free by hand)
    void live;
  }

  // ---- a deterministic patch of open sea ------------------------------------
  const ref = input.referenceStage || null;
  function findWater(minShore, maxShore, from) {
    for (let r = Number(from) || 900; r <= 9000; r += 40) {
      for (let i = 0; i < 96; i++) {
        const ang = (i / 96) * Math.PI * 2;
        const x = Math.cos(ang) * r, z = Math.sin(ang) * r;
        const sh = wf.shoreAt(x, z);
        if (!(sh <= maxShore && sh >= minShore)) continue;
        if (!wf.isSurfaceWater(x, z, 0)) continue;
        return { x: Number(x.toFixed(2)), z: Number(z.toFixed(2)), shore: Number(sh.toFixed(2)) };
      }
    }
    return null;
  }
  const anchor = (ref && ref.anchor) || findWater(-6000, -700, 1100);
  if (!anchor) return { ok: false, err: "no deep water found" };
  const surf = CBZ.citySeaHeightAt(anchor.x, anchor.z);

  // ---- the cast, built with the game's own builders -------------------------
  const mats = new Map();
  function matFn(color) {
    const key = Number(color == null ? 0x78858d : color);
    if (!mats.has(key)) mats.set(key, new T.MeshLambertMaterial({ color: key }));
    return mats.get(key);
  }
  let spawnSeed = 12345;
  function srng() { spawnSeed = (spawnSeed * 1103515245 + 12345) >>> 0; return spawnSeed / 4294967296; }

  function spawnAnimal(id, x, z, heading, sizeMul) {
    const sp = CBZ.WILDLIFE_SPECIES[id];
    if (!sp || typeof sp.build !== "function") return null;
    let grp;
    try { grp = sp.build({ THREE: T, mat: matFn, rng: srng }); } catch (e) { return null; }
    if (!grp) return null;
    const size = sizeMul || 1;
    grp.scale.setScalar((sp.scale || 1) * size);
    grp.userData.dynamic = true;
    grp.traverse((o) => { o.matrixAutoUpdate = true; if (o.isMesh) o.castShadow = true; });
    const swimDepth = (sp.swimDepth != null ? sp.swimDepth : Math.max(0.8, (sp.scale || 1) * 1.25)) * size;
    grp.position.set(x, CBZ.citySeaHeightAt(x, z) - swimDepth, z);
    (CBZ.scene || CBZ.city && CBZ.city.root).add(grp);
    const a = {
      species: sp, kind: "animal", animal: true,
      group: grp, pos: grp.position,
      hp: sp.hp || 40, maxHp: sp.hp || 40, dead: false, ko: 0, escaped: false,
      heading: heading, faceH: heading, turnT: 3, spd: sp.spd || 1.4,
      state: "wander", alarm: 0, home: { x: x, z: z },
      bob: 0, hitCount: 0, cleanKill: false, stateT: 0,
      waterClearance: sp.clearance || 20, swimDepth: swimDepth,
      _waterMove: { x: x, z: z, heading: heading, blocked: false, shore: -999 },
      _sizeMul: size,
    };
    if (CBZ.buildSwimRig) { try { CBZ.buildSwimRig(a); } catch (e) {} }
    if (CBZ.faceAnimalHeading) { try { CBZ.faceAnimalHeading(grp, heading); } catch (e) {} }
    wl.push(a); S.spawned.push(a);
    return a;
  }

  function spawnBoat(x, z, heading) {
    if (!CBZ.cityMakeCar || !CBZ.cityEcon || !CBZ.cityEcon.carByName) return null;
    const model = CBZ.cityEcon.carByName("Speedboat");
    if (!model) return null;
    let c = null;
    try { c = CBZ.cityMakeCar(x, z, heading, false, model, 0); } catch (e) { c = null; }
    if (!c) return null;
    c.ai = false; c.v = 0; c.baseV = 0; c.road = null;
    S.cars.push(c);
    return c;
  }

  // Park the player in the water beside the action: the marine block's own
  // distance gate is measured off the player, and wildlife.js will not tick a
  // LOD-frozen actor.
  const P = CBZ.player && CBZ.player.pos;
  function parkPlayer(x, z) {
    if (!P) return;
    P.x = x; P.z = z; P.y = CBZ.citySeaHeightAt(x, z) - 0.2;
    CBZ.player._swim = true; CBZ.player.hp = 100;
    if (CBZ.player.hpMax == null) CBZ.player.hpMax = 100;
  }

  // ---- build the scenario ---------------------------------------------------
  let meg = null, bleeder = null, boat = null;
  const orcas = [], sharks = [];
  const A = anchor;

  if (subject.scenario === "chum") {
    bleeder = spawnAnimal("dolphin", A.x, A.z, 0.4);
    if (!bleeder) return { ok: false, missing: "dolphin" };
    bleeder.hp = Math.round(bleeder.maxHp * 0.22);          // badly hurt: it trails
    for (let i = 0; i < 4; i++) {
      const ang = (i / 4) * Math.PI * 2 + 0.3;
      const s = spawnAnimal("great_white_shark", A.x + Math.cos(ang) * 210, A.z + Math.sin(ang) * 210, ang + Math.PI);
      if (s) sharks.push(s);
    }
    parkPlayer(A.x + 26, A.z + 26);
  } else if (subject.scenario === "ship" || subject.scenario === "shipmen") {
    boat = spawnBoat(A.x, A.z, 0);
    if (!boat) return { ok: false, missing: "Speedboat record" };
    meg = spawnAnimal("megalodon", A.x - 40, A.z - 14, 0.32);
    if (!meg) return { ok: false, missing: "megalodon" };
    if (subject.scenario === "shipmen") {
      for (let i = 0; i < 3; i++) {
        const ang = (i / 3) * Math.PI * 2;
        const s = spawnAnimal("great_white_shark", A.x + Math.cos(ang) * 180, A.z + Math.sin(ang) * 180, ang + Math.PI);
        if (s) sharks.push(s);
      }
      /* THE MEN. Real city peds, borrowed and put over the side beside the
         boat at 40% health — which is the state the bite leaves them in. From
         there nothing in this preset touches them: water_float.js reports them
         as occupants of the sea, the marine block's chum poll sees a hurt
         living body in the water and opens a trail on it, and the great whites
         above come for it. Borrowed rather than built because peds.js owns
         ped construction and a staging file has no business owning a second
         way to make one. */
      const peds = CBZ.cityPeds || [];
      let taken = 0;
      for (let i = 0; i < peds.length && taken < 3; i++) {
        const q = peds[i];
        if (!q || q.dead || q.inCar || !q.pos) continue;
        const ang = (taken / 3) * Math.PI * 2 + 0.4;
        q.pos.x = A.x + Math.cos(ang) * 7;
        q.pos.z = A.z + Math.sin(ang) * 7;
        q.pos.y = CBZ.citySeaHeightAt(q.pos.x, q.pos.z) - 0.3;
        q.maxHp = q.maxHp || 100;
        q.hp = Math.round(q.maxHp * 0.4);
        S.men.push(q);
        taken++;
      }
    }
    parkPlayer(A.x + 30, A.z + 30);
  } else {
    meg = spawnAnimal("megalodon", A.x, A.z, 0, subject.megSize || 1);
    if (!meg) return { ok: false, missing: "megalodon" };
    const n = subject.pod || 1;
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2;
      const o = spawnAnimal("orca", A.x + Math.cos(ang) * 46, A.z + Math.sin(ang) * 46, ang + Math.PI);
      if (o) orcas.push(o);
    }
    parkPlayer(A.x + 34, A.z + 34);
  }

  // The block's own derived answer, read BEFORE the fight so the picture and
  // the threshold describe the same pairing.
  let podNeeded = 0;
  if (CBZ.marinePodNeeded && orcas.length && meg) {
    try { podNeeded = CBZ.marinePodNeeded(orcas[0], meg); } catch (e) { podNeeded = 0; }
  }

  /* ---- THE NO-HUD MEASUREMENT, and it has to be a measurement.

     "It must not show up on the HUD" is the owner's constraint and a counter
     the block increments itself would be worth nothing — it would only ever
     report the number its own author chose to write. So the two things that
     actually put text on this game's screen are wrapped HERE, for exactly the
     duration of the fight, and counted: killfeed.js's CBZ.cityKillFeed (the
     only sanctioned death popup) and the phone notifier it forwards to. A pod
     killing a megalodon at sea must produce zero of both. The wrappers are
     removed again the moment the sim loop ends. */
  let feedLines = 0;
  const origFeed = CBZ.cityKillFeed, origNotify = CBZ.cityPhoneNotify;
  if (typeof origFeed === "function") {
    CBZ.cityKillFeed = function () { feedLines++; return origFeed.apply(this, arguments); };
  }
  if (typeof origNotify === "function") {
    CBZ.cityPhoneNotify = function () { feedLines++; return origNotify.apply(this, arguments); };
  }

  // ---- RUN IT. The page's own frame, in fixed steps. ------------------------
  const steps = Math.round((subject.seconds || 20) / RUN);
  let megDeadAt = -1, rollSeenAt = -1, holdFrame = -1;
  const megHp0 = meg ? meg.hp : 0;
  let hullMin = boat ? (boat.engineHp == null ? 100 : boat.engineHp) : -1;
  for (let i = 0; i < steps; i++) {
    CBZ.hitstop = 0; CBZ.slowmo = 0;
    // hold the boat still: a moored hull makes the bite geometry the variable
    if (boat && !boat.dead) { boat.v = 0; boat.vx = boat.vx || 0; }
    try { CBZ.stepSim(RUN); } catch (e) { /* one bad frame must not kill the run */ }
    if (meg && meg.dead && megDeadAt < 0) megDeadAt = i * RUN;
    if (meg && meg._mpRoll && rollSeenAt < 0) rollSeenAt = i * RUN;
    // THE ROLL-OVER FRAME. Photographed at the moment the inversion is deepest
    // rather than wherever the clock happened to land.
    if (subject.holdRoll && meg && meg._mpRoll) {
      const p = meg._mpRoll.t / meg._mpRoll.dur;
      if (p > 0.82 && holdFrame < 0) { holdFrame = i; break; }
    }
    if (boat && boat.engineHp != null && boat.engineHp < hullMin) hullMin = boat.engineHp;
    if (!subject.holdRoll && meg && meg.dead && (i * RUN) > megDeadAt + 3) break;
  }

  if (typeof origFeed === "function") CBZ.cityKillFeed = origFeed;
  if (typeof origNotify === "function") CBZ.cityPhoneNotify = origNotify;

  // ---- read the result ------------------------------------------------------
  const audit = (CBZ.marineAudit && CBZ.marineAudit()) || {};
  function nearCount(list, x, z, r) {
    let n = 0;
    for (const a of list) {
      if (!a || !a.pos) continue;
      if (Math.hypot(a.pos.x - x, a.pos.z - z) <= r) n++;
    }
    return n;
  }
  let sharksNear = 0;
  if (bleeder) sharksNear = nearCount(sharks, bleeder.pos.x, bleeder.pos.z, 90);
  else if (sharks.length) sharksNear = nearCount(sharks, A.x, A.z, 110);
  let orcaDeaths = 0;
  for (const o of orcas) if (o.dead) orcaDeaths++;
  const megHpPct = meg ? Math.max(0, Math.round((meg.hp / (meg.maxHp || megHp0 || 1)) * 100)) : -1;
  const tonic = (CBZ.creatureTonicAngle && meg) ? CBZ.creatureTonicAngle(meg) : 0;

  // ---- the camera -----------------------------------------------------------
  const focusOn = meg || bleeder || (boat && boat.pos) || { x: A.x, y: surf, z: A.z };
  const fx = focusOn.pos ? focusOn.pos.x : (focusOn.x != null ? focusOn.x : A.x);
  const fz = focusOn.pos ? focusOn.pos.z : (focusOn.z != null ? focusOn.z : A.z);
  const shot = subject.shot || { dist: 50, height: 20, pitch: 0.45 };
  let camPos, camAim;
  if (ref && ref.camera) { camPos = ref.camera.position.slice(); camAim = ref.camera.target.slice(); }
  else {
    const yaw = 0.9;
    camPos = [fx + Math.cos(yaw) * shot.dist, surf + shot.height, fz + Math.sin(yaw) * shot.dist];
    camAim = [fx, surf - 1.2, fz];
  }
  const camera = CBZ.camera;
  camera.aspect = input.width / input.height;
  camera.fov = 52; camera.near = 0.12; camera.far = 24000;
  camera.position.set(camPos[0], camPos[1], camPos[2]);
  camera.lookAt(camAim[0], camAim[1], camAim[2]);
  camera.updateProjectionMatrix();
  if (P) { P.x = camPos[0]; P.z = camPos[2]; P.y = surf - 0.2; }
  if (typeof CBZ.skySync === "function") CBZ.skySync();

  // hide every HUD element: this page's claim is that the feature needs none,
  // and leaving the city's own HUD in shot would make that unreadable.
  const canvas = CBZ.renderer && CBZ.renderer.domElement;
  for (const child of Array.from(document.body.children)) {
    if (child === canvas || (canvas && child.contains && child.contains(canvas))) continue;
    if (child.id === "__marinePredOverlay") continue;
    child.style.visibility = "hidden";
  }
  CBZ.renderer.render(CBZ.scene, camera);

  // ---- the overlay ----------------------------------------------------------
  const before = input.side === "before";
  const label = (name, text, css) => {
    const el = S.overlay.querySelector("[data-" + name + "]");
    if (!el) return;
    el.textContent = text; el.style.cssText = css;
  };
  label("side", before ? input.beforeLabel : input.afterLabel,
    `position:absolute;top:22px;left:26px;padding:7px 11px;border-radius:7px;background:${before ? "#c94c4c" : "#218b60"};font-size:12px;font-weight:900;letter-spacing:.12em`);
  label("name", subject.label, "position:absolute;top:64px;left:26px;font-size:26px;font-weight:800;letter-spacing:-.02em");
  label("focus", subject.focus, "position:absolute;top:100px;left:28px;color:#c3d4de;font-size:13px;font-weight:550;max-width:740px;line-height:1.35");
  label("state", subject.state, `position:absolute;right:26px;top:25px;color:${before ? "#ffb0b0" : "#7ff0bb"};font-size:11px;font-weight:900;letter-spacing:.1em`);
  label("read",
    `chum ${audit.chumSources || 0} · sharks@90m ${sharksNear} · rams ${audit.rams || 0} · rolls ${audit.rolls || 0}` +
    `\nmeg ${megHpPct}% · orca deaths ${orcaDeaths} · needs ${podNeeded}` +
    `\nhull ${hullMin} · feed lines ${feedLines}`,
    "position:absolute;right:26px;top:52px;font:12px ui-monospace,SFMono-Regular,Menlo,monospace;color:#9fe8c3;white-space:pre;text-align:right");
  label("source", new URL(input.sourceUrl).host + new URL(input.sourceUrl).pathname,
    "position:absolute;bottom:20px;left:26px;color:#9cb0bf;font:11px ui-monospace,SFMono-Regular,Menlo,monospace");

  return {
    ok: true,
    anchor,
    camera: { position: camPos.slice(), target: camAim.slice() },
    stage: {
      scenario: subject.scenario, pod: orcas.length,
      megDeadAt: Number(megDeadAt.toFixed(2)),
      rollSeenAt: Number(rollSeenAt.toFixed(2)),
      tonicRad: Number(tonic.toFixed(3)),
      wrapped: !!audit.wrapped,
    },
    metrics: {
      sharksNear: sharksNear,
      chumSources: audit.chumSources || 0,
      chumOpened: audit.chumOpened || 0,
      rams: audit.rams || 0,
      rolls: audit.rolls || 0,
      megHpPct: megHpPct,
      timeToKillS: megDeadAt < 0 ? -1 : Number(megDeadAt.toFixed(1)),
      orcaDeaths: orcaDeaths,
      podNeeded: podNeeded,
      hullEngine: hullMin,
      shipBites: audit.shipBites || 0,
      feedLines: feedLines,
    },
  };
}

export default {
  id: "marine-predation",
  title: "Marine predation — blood in the water, a megalodon on a boat, and a pod on a megalodon",
  description:
    "Eleven simulated engagements in the real game world at seed 90210, photographed against this same " +
    "checkout with the block's own reverts off (?marine=off). BEFORE: nothing in the ocean hunts anything " +
    "but the player, a wounded or dead thing in the water bleeds into nowhere because the chum seam had " +
    "three producers in the whole game, and a megalodon swims past a speedboat. AFTER: one predation graph " +
    "derived from the bestiary's own numbers decides who eats whom and who MOBS whom, a pod of orcas takes " +
    "bearings, rams the flank, staggers the megalodon and rolls it belly-up — but only once there are " +
    "enough of them, a number solved from hp/bite/size rather than typed in — and a megalodon closes its " +
    "jaws across a speedboat's beam, crushes the hull, throws the crew in the water and leaves them " +
    "bleeding for the sharks it just drew. No HUD anywhere: the owner asked twice.",
  defaultBefore: "local",
  beforeLabel: "BEFORE — ?marine=off (this checkout, block reverted)",
  afterLabel: "AFTER — this checkout",
  pairNote: "Same seed · same water anchor · same cast · same camera · same simulated seconds",
  method:
    "Each page boots the same city at seed 90210, freezes the rAF loop, seeds Math.random from one LCG, " +
    "finds a deterministic patch of open sea, and spawns the cast with the game's own builders " +
    "(WILDLIFE_SPECIES[id].build + buildSwimRig, CBZ.cityMakeCar) into CBZ.cityWildlife / CBZ.cityCars. " +
    "The engagement is then ticked by CBZ.stepSim — i.e. wildlife.js's own aquatic branch into " +
    "CBZ.sharkBrain into the marine_predation wrapper into CBZ.predatorHunt / CBZ.creatureFight — for a " +
    "fixed number of frames. Nothing in the preset drives an animal.",
  urlParams: { seed: 90210 },
  beforeParams: { marine: "off" },
  viewport: { width: 1100, height: 680 },
  stageTimeoutMs: 600000,
  subjects,
  readyExpression,
  stage: stageMarinePredation,
  metricsNote:
    "Every number is read at the end of the same simulated seconds the picture was taken in: the block's " +
    "own probe (CBZ.marineAudit) for chum, rams, rolls and ship bites, and direct reads of the actors' " +
    "health and the boat's engine for the rest. `podNeeded` is the block's DERIVED answer to 'how many " +
    "does it take' (solved from hp, bite and size — never a constant), so the 5-orca and monster-meg " +
    "frames can be read against it. `timeToKillS` of -1 means the megalodon survived. `feedLines` is the " +
    "no-HUD promise measured from OUTSIDE the block, by wrapping the two things in this game that can " +
    "put text on the screen.",
  metrics: {
    sharksNear: { label: "Sharks that closed on the bleeder", unit: "animals", better: "higher" },
    chumSources: { label: "Live blood trails in the water", unit: "sources", better: "higher" },
    chumOpened: { label: "Chum handles opened during the run", unit: "handles", better: "higher" },
    rams: { label: "Flank rams landed", unit: "strikes", better: "higher" },
    rolls: { label: "Roll-over finishers started", unit: "events", better: "higher" },
    megHpPct: { label: "Megalodon health left", unit: "%", better: "lower" },
    timeToKillS: { label: "Time for the pod to kill it (-1 = survived)", unit: "s", better: "lower" },
    orcaDeaths: { label: "Orcas the pod lost", unit: "animals", better: "lower" },
    podNeeded: { label: "Pod size the block derives as sufficient", unit: "orcas", better: "lower" },
    hullEngine: { label: "Boat structure left after the bite", unit: "hp", better: "lower" },
    shipBites: { label: "Bites landed on the hull", unit: "bites", better: "higher" },
    feedLines: { label: "HUD feed lines the fight produced (must stay zero)", unit: "lines", better: "lower" },
  },
};
