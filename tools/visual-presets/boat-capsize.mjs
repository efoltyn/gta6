/* Boats can be tipped — tools/visual-compare.mjs preset.

   OWNER: "how boats can be tipped by sharks etc. build all this logic while
   improving boats ... use before/after tool to present it all."

   WHAT THE BEFORE SIDE ACTUALLY WAS. Nothing in this game could tip a boat.
   The only thing a shark did to a hull's attitude was
   `car.group.rotation.z += +-0.12..0.24` (marine_predation.js:1250) — written
   straight onto the transform, and then erased wholesale by the very next
   buoyancy pass (water_buoyancy.js:236 copies a freshly-built quaternion over
   it at order 38.5, the same frame). So a 30-tonne megalodon hitting a
   4-metre boat produced a one-frame twitch and, by the time you could see it,
   nothing at all. That is exactly what these before frames photograph, and it
   is why they look level: the stage feature-detects CBZ.hullHeelImpulse and,
   where it is missing, does the old thing verbatim.

   THE AFTER SIDE is world/water_stability.js: a real single-degree-of-freedom
   roll model with a righting-arm curve, an angle of vanishing stability, an
   INVERTED stable point, green water and flooding. Same seed, same water,
   same hull, same camera, same production tick — one new file.

   IT STAGES THE REAL GAME. Each page boots its own city at seed 90210,
   freezes rAF, seeds Math.random from one LCG, finds a deterministic point of
   open ocean, spawns a REAL cityCars boat there (CBZ.cityMakeCar off the same
   economy record the player buys), puts a real city ped at the wheel, and
   then drives THAT PAGE'S OWN update bus with CBZ.stepSim so the helm, the
   buoyancy pass and the stability pass all run for real. Nothing here
   integrates a roll; the stage only decides WHEN to photograph.

   THE NUMBERS COME FROM THE FILE ITSELF. CBZ.hullStabAudit() is
   water_stability.js measuring itself — biggest roll reached, capsizes,
   floods. rollDeg is the only figure this preset derives, and it derives it
   from the hull's LIVE transform (the thing the camera is pointed at), which
   is the one measurement that exists identically on both sides. */

const SHARK_T = 1.5, SHARK_MS = 8;      // a great white: 1.5 t at 8 m/s
const MEG_T = 30, MEG_MS = 10;          // a megalodon: 30 t at 10 m/s

const subjects = [
  {
    id: "speedboat-hit", spotR: 1400,
    label: "Speedboat — A Great White Hits The Port Beam",
    hull: "boat", event: "ram", tonnes: SHARK_T, speed: SHARK_MS,
    at: 0.35, side: 9, camEye: 1.05, crew: 1,
    focus: "One shoulder-check from a 1.5-tonne great white, photographed a third of a second later. She is over on her ear with the starboard rail in the water — heeled far enough to be shipping green water, and not far enough to go.",
    state: "RAM · 0.35 s",
    note: "35 degrees. The rail goes under at 31. This is the hit that does not quite do it.",
  },
  {
    id: "speedboat-over", spotR: 1720,
    label: "Speedboat — And Now The Megalodon",
    hull: "boat", event: "ram", tonnes: MEG_T, speed: MEG_MS,
    at: 2.6, side: 10, camEye: 1.10, crew: 1,
    focus: "The same boat, the same beam, thirty tonnes instead of one and a half. She goes past her angle of vanishing stability, keeps going, and settles inverted: keel up, driver in the water beside her.",
    state: "CAPSIZED · INVERTED",
    note: "A hull that goes over STAYS over. The inverted point is a real equilibrium in the righting curve, not a pose.",
  },
  {
    id: "dinghy-swamped", spotR: 2040,
    label: "The RIB — Twenty-Five Seconds Of Green Water",
    hull: "dinghy", event: "swamp", swampS: 25,
    at: 1.6, side: 9, camEye: 1.30, crew: 1,
    focus: "No shark at all: a tender with the sea coming in over the tubes. Past its swamp time the buoyancy is gone, she sits low, floods, and is handed to the sinking arc world/water_float.js already owns.",
    state: "FLOODED",
    note: "swampT is seconds of green water per hull class. The RIB is self-bailing and takes 20 of them.",
  },
  {
    id: "cruiser-rocked", spotR: 2360,
    label: "The 14 m Cruiser — The Same Great White",
    hull: "cruiser", event: "ram", tonnes: SHARK_T, speed: SHARK_MS,
    at: 0.9, side: 14, camEye: 1.20, crew: 2,
    focus: "THE CONTRAST FRAME. The identical animal at the identical speed against sixteen tonnes and a 1.4 m metacentric height: about three degrees, and it rings down. A big hull is scenery to a small shark and the numbers say so without a gate anywhere.",
    state: "RAM · BARELY MOVED",
    note: "No special case: same impulse, same curve, ten times the inertia and four times the stiffness.",
  },
  {
    id: "cruiser-rolled", spotR: 2680,
    label: "The Cruiser — A Megalodon Comes Up Underneath",
    hull: "cruiser", event: "under", tonnes: MEG_T, speed: MEG_MS,
    at: 1.05, side: 15, camEye: 1.30, crew: 2,
    focus: "A body surfacing beneath a hull does not just lean on it, it LIFTS it — so this is heave and heel together, caught going over: past the vanishing angle, still rolling, her keel coming out of the water.",
    state: "UNDER · GOING OVER",
    note: "The lift is derived from the same angular impulse: (impulse / displacement / half-beam) is a heave velocity in m/s.",
  },
  // ---- THE FILM STRIP. One roll, four instants. --------------------------
  {
    id: "strip-1-hit", spotR: 3000, strip: 1, label: "The Roll, Frame 1 — The Hit",
    hull: "kayak", hullElse: "dinghy", event: "ram", tonnes: SHARK_T, speed: SHARK_MS,
    at: 0.0, side: 6, camEye: 0.90, crew: 1,
    focus: "A bull shark takes a sea kayak on the beam. Frame one: the instant of contact.",
    state: "t = 0.00 s", note: "Four frames of one roll. Nothing between them but time.",
  },
  {
    id: "strip-2-heel", spotR: 3320, strip: 2, label: "The Roll, Frame 2 — On Her Ear",
    hull: "kayak", hullElse: "dinghy", event: "ram", tonnes: SHARK_T, speed: SHARK_MS,
    at: 0.30, side: 6, camEye: 0.90, crew: 1,
    focus: "Three tenths of a second. Past the gunwale angle and past the point of no return — a kayak's angle of vanishing stability is 40 degrees.",
    state: "t = 0.30 s", note: "gm 0.05 m. There is almost nothing holding a kayak upright and that is correct.",
  },
  {
    id: "strip-3-past", spotR: 3640, strip: 3, label: "The Roll, Frame 3 — Past Vertical",
    hull: "kayak", hullElse: "dinghy", event: "ram", tonnes: SHARK_T, speed: SHARK_MS,
    at: 0.70, side: 6, camEye: 0.90, crew: 1,
    focus: "Past ninety degrees the righting arm is NEGATIVE: her own buoyancy is now taking her the rest of the way.",
    state: "t = 0.70 s", note: "The sign flip past phiV is the whole capsize model in one line.",
  },
  {
    id: "strip-4-turtled", spotR: 3960, strip: 4, label: "The Roll, Frame 4 — Turtled",
    hull: "kayak", hullElse: "dinghy", event: "ram", tonnes: SHARK_T, speed: SHARK_MS,
    at: 2.20, side: 6, camEye: 0.90, crew: 1,
    focus: "Hull up, paddler in the water. She sits on a trapped bubble and stays there — the turtled kayak you see from the beach.",
    state: "t = 2.20 s", note: "An inverted hull ships no green water; it only waterlogs, slowly, as that air leaks.",
  },
];

async function stageCapsize(input) {
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
  const hideHud = () => {
    const canvas = CBZ.renderer && CBZ.renderer.domElement;
    for (const child of Array.from(document.body.children)) {
      if (child === canvas || (canvas && child.contains && child.contains(canvas))) continue;
      if (child.id === "__capOverlay") continue;
      child.style.visibility = "hidden";
    }
  };

  // ---- boot once, then every subject reuses the same world ----------------
  let S = window.__capsizeStage;
  if (!S) {
    const booted = await until(
      () => CBZ.game && (CBZ.bootComplete || CBZ.game.state === "title") &&
        CBZ.stepSim && document.getElementById("playBtn"), 300000);
    if (!booted) return { ok: false, err: "never booted" };
    if (CBZ.CONFIG) CBZ.CONFIG.CITY_HITMAN_CAMPAIGN = false;
    const playing = await until(() => {
      if (CBZ.game.state === "playing") return true;
      const b = document.getElementById("playBtn"); if (b) b.click();
      return CBZ.game.state === "playing";
    }, 120000, 300);
    if (!playing) return { ok: false, err: "never reached playing" };
    if (CBZ.game.cityCampaign) CBZ.game.cityCampaign.phase = "endless_contracts";
    try { if (CBZ.setQualityLevel) CBZ.setQualityLevel(3); } catch (_) {}

    window.requestAnimationFrame = function () { return 0; };
    await wait(700);
    let seed = 0x9e3779b9 >>> 0;
    Math.random = function () {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let i = 0; i < 90; i++) { CBZ.hitstop = 0; CBZ.slowmo = 0; CBZ.stepSim(1 / 60); }
    try { if (CBZ.dayPhase) { CBZ.dayPhase(0.30); for (let i = 0; i < 8; i++) CBZ.stepSim(1 / 60); } } catch (_) {}

    const overlay = document.createElement("div");
    overlay.id = "__capOverlay";
    overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;color:#f2f8fc;text-shadow:0 2px 9px #001019;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    overlay.innerHTML = "<div data-side></div><div data-name></div><div data-focus></div><div data-state></div><div data-read></div><div data-note></div><div data-source></div>";
    document.body.appendChild(overlay);
    S = window.__capsizeStage = { overlay, cars: [], men: [], anchor: null };
    window.__cbzVisualCompare = {
      render() { try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (_) {} },
    };
  }

  // ---- clear the previous subject -----------------------------------------
  for (const c of S.cars) {
    // A hull that flooded was handed to world/water_float.js's registry; let
    // it go before the record leaves cityCars, or the sinking arc keeps
    // ticking a boat nobody can see.
    if (c._waterFloat && typeof c._waterFloat.release === "function") {
      try { c._waterFloat.release(); } catch (_) {}
    }
    const list = CBZ.cityCars;
    if (list) { const i = list.indexOf(c); if (i >= 0) list.splice(i, 1); }
    if (c.group && c.group.parent) c.group.parent.remove(c.group);
  }
  S.cars.length = 0;
  for (const q of S.men) {
    if (!q) continue;
    q.inCar = null; q._parked = false;
    if (q._borrowHome) {
      q._parked = false;
      q.pos.x = q._borrowHome.x; q.pos.y = q._borrowHome.y; q.pos.z = q._borrowHome.z;
      // The RIG too: peds.js skips a ped with inCar set, so its group has not
      // been re-synced from .pos since we borrowed it — restoring only .pos
      // leaves the body standing where the last subject left it, and the next
      // subject photographs somebody else's drowned crew.
      if (q.group) q.group.position.set(q.pos.x, q.pos.y, q.pos.z);
    }
    if (q._borrowHp != null) q.hp = q._borrowHp;
  }
  S.men.length = 0;

  const wf = CBZ.waterField;
  if (!wf) return { ok: false, missing: "waterField" };

  // ---- deterministic open-ocean anchor (fixed scan order, never random) ----
  function findWater(minShore, maxShore, from) {
    for (let r = Number(from) || 900; r <= 9000; r += 30) {
      for (let i = 0; i < 96; i++) {
        const ang = (i / 96) * Math.PI * 2;
        const x = Math.cos(ang) * r, z = Math.sin(ang) * r;
        const s = wf.shoreAt(x, z);
        if (!(s <= maxShore && s >= minShore)) continue;
        if (!wf.isSurfaceWater(x, z, 0)) continue;
        if (CBZ.waterInlandFactorAt && CBZ.waterInlandFactorAt(x, z) > 0.02) continue;
        return { x: Number(x.toFixed(2)), z: Number(z.toFixed(2)) };
      }
    }
    return null;
  }
  const ref = input.referenceStage || null;
  // EVERY SUBJECT GETS ITS OWN PATCH OF SEA. They share one page, and gore,
  // spray decals and a sinking wreck all persist — the first cut staged all
  // nine at the same anchor and the cruiser's "barely moved" contrast frame
  // was photographed through the blood cloud the RIB's crew had left there
  // two subjects earlier. The scan is deterministic, so a declared start
  // radius is a repeatable, distinct point on both sides.
  const anchor = (ref && ref.anchor) || findWater(-6000, -900, Number(subject.spotR) || 1400);
  if (!anchor) return { ok: false, err: "no open water found" };

  // ---- the boat: a REAL cityCars hull off the registry's own economy row ---
  // The key may not exist on the before side (builder A's kayak is new), so
  // every subject declares a fallback and the frame says which one it got.
  const MH = CBZ.marineHulls;
  let hullKey = String(subject.hull || "boat");
  if (subject.hullElse && !(MH && MH.get && MH.get(hullKey))) hullKey = String(subject.hullElse);
  const rec = MH && MH.get ? MH.get(hullKey) : null;
  const modelName = (rec && rec.model) || "Speedboat";
  const econ = CBZ.cityEcon;
  const model = econ && econ.carByName ? (econ.carByName(modelName) || econ.carByName("Speedboat")) : null;
  if (!model || !CBZ.cityMakeCar) return { ok: false, missing: "cityMakeCar/" + modelName };

  // heading 0: the hull's bow is +Z, its local +X (PORT) is world +X.
  const heading = 0;
  let car = null;
  try { car = CBZ.cityMakeCar(anchor.x, anchor.z, heading, false, model, 0); } catch (e) { car = null; }
  if (!car) return { ok: false, missing: "hull " + modelName };
  car.ai = false; car.v = 0; car.baseV = 0; car.road = null; car.player = false;
  S.cars.push(car);
  const spec = (MH && MH.specFor) ? MH.specFor(car) : car._hullSpec;
  if (!spec) return { ok: false, missing: "_hullSpec for " + modelName };

  // ---- the men aboard ------------------------------------------------------
  // Borrowed from CBZ.cityPeds, not built here: peds.js owns ped construction
  // and a staging file has no business owning a second way to make one.
  const peds = CBZ.cityPeds || [];
  const wantCrew = Math.max(0, Number(subject.crew) || 0);
  for (let i = 0, taken = 0; i < peds.length && taken < wantCrew; i++) {
    const q = peds[i];
    if (!q || q.dead || q.inCar || !q.pos || S.men.indexOf(q) >= 0) continue;
    q._borrowHome = { x: q.pos.x, y: q.pos.y, z: q.pos.z };
    q._borrowHp = q.hp;
    // NOT `inCar`. Setting it hands the body to city/vehicles.js's passenger
    // system, which re-points ped.pos at the CAR's own position object — after
    // which every seat this file writes is a write to car.pos, the rig drifts
    // off on its own, and the read-back says a man is aboard a boat that
    // turned over two seconds ago. `_parked` alone is what we want: peds.js's
    // wander and water_float.js's living-ped lift both skip on it, and
    // water_stability's own dump picks a body up by PROXIMITY, which is what
    // being on a boat actually looks like from the outside.
    q._parked = true;
    S.men.push(q); taken++;
  }
  // Hold the crew on the deck until the hull dumps them. water_float.js lifts
  // ANY living ped over water into the sea at order 38.6 — it does not know
  // about inCar — so a seat written before the step is overwritten during it;
  // it has to be re-written after. The moment the hull goes over or fills,
  // this stops entirely and water_float owns them, which is the point.
  const seatMen = () => {
    const st0 = car._stab;
    const dumped = !!(st0 && (st0.capsized || st0.flooded));
    for (let i = 0; i < S.men.length; i++) {
      const q = S.men[i];
      if (!q || !q.pos) continue;
      if (dumped) { q._parked = false; continue; }   // the sea owns them now
      // _parked is the flag world/water_float.js's living-ped lift (and
      // peds.js's wander) both skip on. Without it that lift drags a seated
      // crewman off the deck to 1.28 m UNDER the surface every single frame,
      // and the instanced ped pass bakes THAT matrix — which is why the first
      // four runs photographed a man hanging under the hull.
      q._parked = true;
      // Re-asserted, not tested: something in the city loop clears inCar on a
      // parked hull, and a crew member who quietly lost his seat was rendered
      // hanging under the boat at ped-brain y = 0 in every frame of the first
      // three runs. `pos` IS the rig's position object (peds.js:1198), so
      // writing it here is writing the body.
      q.inCar = car;
      q.pos.x = car.pos.x + Math.sin(heading) * (spec.loa * 0.1) + (i ? 0.5 : -0.5);
      q.pos.z = car.pos.z + Math.cos(heading) * (spec.loa * 0.1);
      q.pos.y = (car.group ? car.group.position.y : 0) + (spec.deckY != null ? spec.deckY : 0.8);
    }
  };

  // ---- settle her on the real sea before anything happens ------------------
  const step = (n) => {
    for (let i = 0; i < n; i++) {
      CBZ.hitstop = 0; CBZ.slowmo = 0;
      seatMen(); CBZ.stepSim(1 / 60); seatMen();
    }
  };
  const P = CBZ.player && CBZ.player.pos;
  // The camera swims on the STARBOARD side — the side that goes DOWN — so the
  // hull leans toward the lens and the rail goes under in the foreground.
  const camSide = -(Number(subject.side) || 9);
  // THE PLAYER IS NOT THE CAMERA HERE, and that is deliberate: city/peds.js
  // spawns its ambient crowd AROUND THE PLAYER, so parking him at the lens
  // filled the foreground of every frame with a pedestrian standing on the
  // open sea two metres from the camera. He stands 30 m off on the far
  // quarter instead — near enough that nothing LODs the hull out, far enough
  // that his crowd is behind the boat.
  if (P) {
    P.x = anchor.x + 30; P.z = anchor.z + 26;
    P.y = CBZ.citySeaHeightAt(P.x, P.z) - 0.2;
    CBZ.player.hp = 100;
  }
  // ...and anything that wandered in anyway is walked back off the set. Stage
  // dressing only: these are ambient bodies with no part in the subject, and
  // a ped standing on the water in front of the hull is not what either side
  // of this comparison is about.
  const clearBystanders = () => {
    const lists = [peds];
    if (Array.isArray(CBZ.bots)) lists.push(CBZ.bots);
    for (const list of lists) for (let i = 0; i < list.length; i++) {
      const q = list[i];
      if (!q || !q.pos || S.men.indexOf(q) >= 0) continue;
      const dx = q.pos.x - anchor.x, dz = q.pos.z - anchor.z;
      if (dx * dx + dz * dz > 3600) continue;           // 60 m
      q.pos.x = anchor.x + 420; q.pos.z = anchor.z + 420;
      if (q.group && q.group.position !== q.pos) q.group.position.set(q.pos.x, q.pos.y, q.pos.z);
    }
  };
  step(50);
  clearBystanders();

  // ---- reset the audit, then fire the event --------------------------------
  const hasStab = typeof CBZ.hullHeelImpulse === "function";
  if (typeof CBZ.hullStabAudit === "function") CBZ.hullStabAudit({ reset: true });
  const armM = Math.max(0.18, spec.beam * 0.5);
  const moment = (Number(subject.tonnes) || 0) * (Number(subject.speed) || 0) * armM;
  // The push lands on the PORT beam (local +X at heading 0). The model reads
  // the SIDE off that point and rolls her away from it, to starboard.
  const hitX = anchor.x + spec.beam * 0.5, hitZ = anchor.z;
  let howBefore = null;
  if (subject.event === "swamp") {
    if (typeof CBZ.hullSwampAdd === "function") CBZ.hullSwampAdd(car, Number(subject.swampS) || 25);
    else howBefore = "no swamping model exists";
  } else if (hasStab) {
    CBZ.hullHeelImpulse(car, moment, { x: hitX, z: hitZ, from: subject.event === "under" ? "under" : "ram" });
  } else {
    // THE BEFORE SIDE, VERBATIM: marine_predation.js:1250's whole contribution
    // to a hull's attitude. Written onto the transform, and erased by the next
    // buoyancy pass in the same frame — which is the point of the comparison.
    if (car.group) car.group.rotation.z += 0.24;
    howBefore = "rotation.z += 0.24 (erased by the next buoyancy pass)";
  }

  const shutterFrames = Math.max(0, Math.round((Number(subject.at) || 0) * 60));
  for (let f = 0; f < shutterFrames; f += 12) {
    step(Math.min(12, shutterFrames - f));
    clearBystanders();
  }

  // ---- read it back --------------------------------------------------------
  const grp = car.group;
  grp.updateMatrixWorld(true);
  // The one figure this preset derives, and it derives it from the LIVE
  // transform the camera is pointed at — the only measurement that exists
  // identically on both sides. Everything else comes out of the file itself.
  // Decomposed off the hull's own AXES rather than as an euler: a euler
  // extraction gimbals near +-180 deg and reported a turtled boat as 122.
  // bow = local +Z in world, hullUp = local +Y; the reference "port" axis is
  // world-up crossed onto the bow, which is exactly the local +X the sign
  // convention is written against.
  const _m = grp.matrixWorld.elements;
  const bow = new T.Vector3(_m[8], _m[9], _m[10]).normalize();
  const hullUp = new T.Vector3(_m[4], _m[5], _m[6]).normalize();
  const upRef = new T.Vector3(0, 1, 0).addScaledVector(bow, -bow.y).normalize();
  const portRef = new T.Vector3().crossVectors(upRef, bow).normalize();
  const rollDeg = Math.abs(Math.atan2(hullUp.dot(portRef), hullUp.dot(upRef)) * 180 / Math.PI);
  const audit = (typeof CBZ.hullStabAudit === "function") ? CBZ.hullStabAudit() : null;
  const st = (typeof CBZ.hullStab === "function" && car._stab) ? car._stab : null;

  // people in the water within 8 m of the hull: out of a boat, at or under
  // the surface. Counted off cityPeds, which is where they actually are.
  // IN THE WATER = the rendered body is at or under the surface and within
  // 8 m of the hull. Measured off the RIG (q.group.position), because that is
  // the body the camera photographs — a .pos that says one thing while the
  // rig says another is exactly the bug that made the first five runs lie.
  let overboard = 0;
  const sy = CBZ.citySeaHeightAt(car.pos.x, car.pos.z);
  const crewRead = [];
  for (let i = 0; i < peds.length; i++) {
    const q = peds[i];
    if (!q || !q.group || q.inCar) continue;
    const g2 = q.group.position;
    const dx = g2.x - car.pos.x, dz = g2.z - car.pos.z;
    if (dx * dx + dz * dz > 64) continue;
    if (g2.y <= sy + 0.6) overboard++;
  }
  for (const q of S.men) {
    if (!q || !q.group) continue;
    crewRead.push({
      dead: !!q.dead, culled: !!q.culled, parked: !!q._parked, hp: q.hp,
      rigDySea: Number((q.group.position.y - sy).toFixed(2)),
      rigDHull: Number(Math.hypot(q.group.position.x - car.pos.x, q.group.position.z - car.pos.z).toFixed(2)),
    });
  }

  // ---- camera: a swimmer's eye, off the beam -------------------------------
  const camera = CBZ.camera;
  let camPos, camAim;
  if (ref && ref.camera) { camPos = ref.camera.position.slice(); camAim = ref.camera.target.slice(); }
  else {
    const eye = CBZ.citySeaHeightAt(anchor.x + camSide, anchor.z) + (Number(subject.camEye) || 0.5);
    camPos = [anchor.x + camSide, eye, anchor.z + spec.loa * 0.22];
    camAim = [car.pos.x, grp.position.y + spec.beam * 0.25, car.pos.z];
  }
  camera.aspect = input.width / input.height;
  camera.fov = Number(subject.fov) || 44;
  camera.near = 0.08; camera.far = 24000;
  camera.position.set(camPos[0], camPos[1], camPos[2]);
  camera.lookAt(camAim[0], camAim[1], camAim[2]);
  camera.updateProjectionMatrix();
  if (typeof CBZ.skySync === "function") CBZ.skySync();
  hideHud();
  CBZ.renderer.render(CBZ.scene, camera);

  const before = input.side === "before";
  const q = (n) => S.overlay.querySelector(`[data-${n}]`);
  const put = (n, text, css) => { const el = q(n); if (el) { el.textContent = text; el.style.cssText = css; } };
  const fellBack = subject.hullElse && hullKey !== subject.hull;
  const stateLine = (howBefore ? "NO MODEL · " + howBefore : subject.state)
    + (fellBack ? "  ·  no `" + subject.hull + "` hull in this build → " + hullKey : "");
  put("side", before ? input.beforeLabel : input.afterLabel,
    `position:absolute;top:22px;left:26px;padding:7px 11px;border-radius:7px;background:${before ? "#c94c4c" : "#218b60"};font-size:12px;font-weight:900;letter-spacing:.12em`);
  put("name", subject.label, "position:absolute;top:64px;left:26px;font-size:25px;font-weight:800;letter-spacing:-.02em");
  put("focus", subject.focus, "position:absolute;top:100px;left:28px;color:#c3d4de;font-size:13px;font-weight:550;max-width:700px;line-height:1.35");
  put("state", stateLine,
    `position:absolute;right:26px;top:25px;color:${before ? "#ffb0b0" : "#7ff0bb"};font-size:11px;font-weight:900;letter-spacing:.08em;max-width:430px;text-align:right`);
  put("read",
    `${hullKey} · ${spec.loa.toFixed(1)}m · ${spec.massT}t · beam ${spec.beam.toFixed(1)}m` +
    `\nmoment ${moment.toFixed(1)} kN.m  (${subject.event})` +
    `\nroll ${rollDeg.toFixed(1)} deg   model peak ${audit ? audit.biggestPhiDeg.toFixed(1) + " deg" : "n/a"}` +
    `\ncapsized ${st ? (st.capsized ? "YES" : "no") : "n/a"} · swamp ${st ? st.swamp.toFixed(2) : "n/a"} · flooded ${st ? (st.flooded ? "YES" : "no") : "n/a"}` +
    `\noverboard ${overboard}`,
    `position:absolute;right:26px;top:52px;font:12px ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre;text-align:right;color:${st && st.capsized ? "#9fe8c3" : "#cfe2ee"}`);
  put("note", subject.note, "position:absolute;right:26px;bottom:20px;padding:7px 10px;border-radius:6px;background:rgba(3,18,28,.72);color:#bfe9ff;font:11px ui-monospace,SFMono-Regular,Menlo,monospace;max-width:520px");
  put("source", new URL(input.sourceUrl).host + new URL(input.sourceUrl).pathname,
    "position:absolute;bottom:20px;left:26px;color:#9cb0bf;font:11px ui-monospace,SFMono-Regular,Menlo,monospace");

  return {
    ok: true,
    anchor,
    hull: hullKey,
    model: modelName,
    modelPresent: hasStab,
    camera: { position: camPos.slice(), target: camAim.slice() },
    crew: crewRead,
    rideY: Number(grp.position.y.toFixed(2)),
    seaY: Number(sy.toFixed(2)),
    metrics: {
      rollDeg: Number(rollDeg.toFixed(1)),
      phiDeg: audit ? Number(audit.biggestPhiDeg.toFixed(1)) : 0,
      capsized: st && st.capsized ? 1 : 0,
      swamp: st ? Number(st.swamp.toFixed(3)) : 0,
      flooded: st && st.flooded ? 1 : 0,
      overboard: overboard,
      impulses: audit ? audit.impulses : 0,
      momentKNm: Number(moment.toFixed(1)),
      loaM: Number(spec.loa.toFixed(2)),
      massT: Number(spec.massT.toFixed(2)),
    },
  };
}

export default {
  id: "boat-capsize",
  title: "Boats Can Be Tipped — Heel, Capsize, Swamp, Turtle",
  description: "Nine frames from the real game world (seed 90210) put a real cityCars hull on a deterministic patch of open ocean, hit it with the heeling moment a real animal makes, and photograph what happens at a swimmer's eye off the beam. A great white puts a speedboat's rail under; a megalodon rolls the same boat and she settles inverted with her driver in the water; a RIB fills with green water and floods; the identical great white barely moves a 16-tonne cruiser (the contrast frame), which a megalodon surfacing underneath rolls straight over; and a four-frame strip follows one kayak from contact to turtled. The before side is the pre-wave checkout, where the ONLY thing a shark did to a hull's attitude was `car.group.rotation.z += 0.24` (marine_predation.js:1250) — erased by the next buoyancy pass in the very same frame, which is why those frames are level.",
  defaultBefore: "local",
  beforeLabel: "BEFORE · NO ROLL MODEL",
  afterLabel: "AFTER · water_stability.js",
  pairNote: "Same seed · same water · same hull · same camera · same production tick · one new file",
  method: "Each page boots its own city at seed 90210, freezes rAF, seeds Math.random from one LCG, pins the day phase, finds open water by a fixed scan, spawns the hull with CBZ.cityMakeCar off the registry's own economy row, borrows real cityPeds for her crew, settles her for 50 frames of CBZ.stepSim, applies ONE heeling impulse through CBZ.hullHeelImpulse (or, where that does not exist, the old rotation.z jolt verbatim) and steps to the declared instant. Every number but rollDeg is read back from CBZ.hullStabAudit / rec._stab — world/water_stability.js measuring itself; rollDeg is decomposed from the hull's live transform, which is the one figure that exists on both sides.",
  viewport: { width: 1100, height: 680 },
  readyExpression: "window.THREE && window.CBZ && CBZ.CONFIG",
  urlParams: { seed: 90210 },
  stageTimeoutMs: 900000,
  metrics: {
    rollDeg: { label: "Roll on the hull's live transform at the shutter", unit: "deg" },
    phiDeg: { label: "Biggest roll the model reached", unit: "deg" },
    capsized: { label: "Went over and stayed over", unit: "0/1", better: "higher" },
    swamp: { label: "Water aboard", unit: "0-1" },
    flooded: { label: "Full, buoyancy gone, handed to the sinking arc", unit: "0/1" },
    overboard: { label: "People in the water within 8 m", unit: "" },
    impulses: { label: "Heeling impulses the model accepted", unit: "" },
    momentKNm: { label: "Heeling moment applied (tonnes x m/s x beam/2)", unit: "kN.m" },
    loaM: { label: "Hull length", unit: "m" },
    massT: { label: "Hull displacement", unit: "t" },
  },
  metricsNote: "rollDeg has no universally better direction — cruiser-rocked is CORRECT at ~3 degrees and speedboat-hit is correct at ~35. What matters is that the before column is the wave's own roll on every single frame, because before this wave nothing could tip a boat at all.",
  subjects,
  stage: stageCapsize,
};
