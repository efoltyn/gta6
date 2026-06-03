/* ============================================================
   city/vehicles.js — REAL traffic + the cars you steal, drive, garage
   and sell.

   Ambient cars have a MODEL (real $ value) and a DRIVER on the same
   aggression spectrum as the peds. The traffic AI does proper road work:
     • lane discipline + car-FOLLOWING (no rear-ending the car ahead)
     • TURNING at intersections (picks a through/turn route)
     • full STOP at red lights (creep, then go on green)
     • AGGRESSIVE drivers speed, tailgate, run yellows/reds, shove
   Running a red near a cop is a VIOLATION → a traffic STOP: calm drivers
   pull over and take the ticket; aggressive ones FLEE (self-wanted → a
   pursuit). High-aggression peds can CARJACK an ambient car and rampage.

   Player driving owns the transform (physics.js bails when driving):
   WASD, follow-cam, run people over, crash, and drive a STOLEN car into
   the chop shop to cash it out (value scales with how rare the car is).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const mat = CBZ.mat;
  const g = CBZ.game;

  const CAR_R = 1.5;
  const CRASH = CBZ.cityCrashTune = {
    wallHard: 18, wallCatastrophic: 27,
    carHard: 8, carCatastrophic: 24,    // a normal-speed ram now counts as a real (hard) crash, not a trivial bump
    pedLethal: 14, npcDriverLethal: 26,
  };
  let _s = 1234;
  function rng() { _s = (_s * 1103515245 + 12345) & 0x7fffffff; return _s / 0x7fffffff; }
  const TR = () => (CBZ.CITY && CBZ.CITY.traf) || {};

  // ---- ambient car MODEL builder ----------------------------------------
  // Cars read as real vehicles: a low body with a chamfered roof/hood, a
  // separate glass-tinted greenhouse (windshield + side windows), four dark
  // wheels at the corners, pale emissive headlights + red taillights, and one
  // of four BODY TYPES (sedan / SUV / pickup / sports coupe) with distinct
  // proportions. crumpleCar animates userData.body + userData.cabin, so those
  // two meshes stay the deformable hull (low at y≈0.78) and roof (y≈1.45).
  const WHEEL_GEO = new THREE.CylinderGeometry(0.45, 0.45, 0.42, 12);
  WHEEL_GEO._shared = true;
  const HUB_GEO = new THREE.CylinderGeometry(0.2, 0.2, 0.44, 8);
  HUB_GEO._shared = true;
  // a flat-topped wedge prism (a chamfered slab) used for the hull + roof so
  // the body isn't a plain box — tapered top, full-width bottom.
  function wedgeGeo(w, h, d, topFrac, noseFrac, tailFrac) {
    topFrac = topFrac == null ? 0.82 : topFrac;
    const tw = (w * topFrac) / 2, bw = w / 2;
    const fz = (d * (noseFrac == null ? 1 : noseFrac)) / 2;   // front (+z) length
    const rz = (d * (tailFrac == null ? 1 : tailFrac)) / 2;   // rear  (-z) length
    const tf = fz * topFrac, tr = rz * topFrac;
    const y0 = -h / 2, y1 = h / 2;
    // 8 verts: bottom (full) then top (tapered, shorter)
    const v = [
      [-bw, y0, -rz], [bw, y0, -rz], [bw, y0, fz], [-bw, y0, fz],   // 0-3 bottom
      [-tw, y1, -tr], [tw, y1, -tr], [tw, y1, tf], [-tw, y1, tf],   // 4-7 top
    ];
    const faces = [
      [0, 1, 2], [0, 2, 3],   // bottom
      [4, 6, 5], [4, 7, 6],   // top
      [3, 2, 6], [3, 6, 7],   // front
      [1, 0, 4], [1, 4, 5],   // back
      [0, 3, 7], [0, 7, 4],   // left
      [2, 1, 5], [2, 5, 6],   // right
    ];
    const pos = [];
    for (const f of faces) for (const i of f) pos.push(v[i][0], v[i][1], v[i][2]);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.computeVertexNormals();
    return geo;
  }

  function addWheels(grp, halfTrack, wz, r) {
    const wmat = mat(0x131417, { emissive: 0x060708, ei: 0.2 });
    const hmat = mat(0x70767e, { emissive: 0x24272b, ei: 0.3 });
    [[halfTrack, wz], [-halfTrack, wz], [halfTrack, -wz], [-halfTrack, -wz]].forEach(([wx, wzz]) => {
      const wh = new THREE.Mesh(WHEEL_GEO, wmat);
      wh.rotation.z = Math.PI / 2; wh.position.set(wx, r, wzz);
      wh.scale.set(r / 0.45, 1, r / 0.45); wh.castShadow = true; grp.add(wh);
      const hub = new THREE.Mesh(HUB_GEO, hmat);
      hub.rotation.z = Math.PI / 2; hub.position.set(wx + (wx > 0 ? 0.01 : -0.01), r, wzz);
      hub.scale.set(r / 0.45, 1.02, r / 0.45); grp.add(hub);
    });
  }

  // headlights (front, pale) + taillights (rear, red), as small emissive bars
  function addLights(grp, w, hullTopY, frontZ, rearZ) {
    const head = mat(0xeaf6ff, { emissive: 0xbfe6ff, ei: 0.85 });
    const tail = mat(0xff3038, { emissive: 0xff2630, ei: 0.8 });
    const lx = w * 0.34;
    [lx, -lx].forEach((hx) => {
      const hl = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.18, 0.06), head);
      hl.position.set(hx, hullTopY, frontZ + 0.02); grp.add(hl);
    });
    const tl = new THREE.Mesh(new THREE.BoxGeometry(w * 0.86, 0.16, 0.07), tail);
    tl.position.set(0, hullTopY, rearZ - 0.02); grp.add(tl);
  }

  // tinted-glass greenhouse: a thin windshield slab + two side-window slabs
  // wrapped around the cabin so the cabin reads as a windowed passenger box.
  function addGlass(grp, cabinW, cabinD, cabinY, cabinH, raked) {
    const glass = mat(0x16242e, { emissive: 0x0a151c, ei: 0.45 });
    const half = cabinD / 2;
    // windshield (front, raked back) + rear glass
    const wsW = cabinW * 0.9;
    [half + 0.01, -half - 0.01].forEach((zz, i) => {
      const gw = new THREE.Mesh(new THREE.BoxGeometry(wsW, cabinH * 0.7, 0.05), glass);
      gw.position.set(0, cabinY, zz);
      gw.rotation.x = (i === 0 ? -1 : 1) * (raked ? 0.5 : 0.32);
      grp.add(gw);
    });
    // side windows
    [cabinW / 2 + 0.005, -cabinW / 2 - 0.005].forEach((xx) => {
      const sw = new THREE.Mesh(new THREE.BoxGeometry(0.04, cabinH * 0.6, cabinD * 0.84), glass);
      sw.position.set(xx, cabinY, 0); grp.add(sw);
    });
  }

  // the four body archetypes, returned as { build } closures keyed by id
  const BODY_TYPES = ["sedan", "suv", "pickup", "coupe"];

  function buildCar(model) {
    const grp = new THREE.Group();
    const s = model ? model.s : 1;
    const len = 4.2 * s;
    const color = model ? model.color : 0x3c6fd6;
    // a steered palette: dim/lighten the model colour a touch per-car so a
    // row of the same model still varies, plus a clearcoat-ish emissive sheen.
    const tint = 0.86 + rng() * 0.28;
    const c3 = new THREE.Color(color).multiplyScalar(tint);
    const paintHex = c3.getHex();
    const paint = mat(paintHex, { emissive: c3.clone().multiplyScalar(0.18).getHex(), ei: 0.5 });
    const trim = mat(0x16181c, { emissive: 0x070809, ei: 0.25 });

    // pick a body type. honour a hint on the model name so trucks/SUVs read
    // right, otherwise random across the four archetypes.
    let bt;
    const nm = model ? model.name : "";
    if (/F-150|Caravan|truck|pickup/i.test(nm)) bt = "pickup";
    else if (/Cherokee|SUV|Model X|Model Y|Cybertruck/i.test(nm)) bt = "suv";
    else if (/Corvette|911|370Z|Aventador|Enzo|Veyron|coupe|Charger/i.test(nm)) bt = "coupe";
    else bt = BODY_TYPES[(rng() * BODY_TYPES.length) | 0];

    // shared dimensions, tuned per body type below
    let w = 2.0, hullH = 0.62, hullY = 0.7, wheelR = 0.45, halfTrack = 0.98;
    let roofW = 1.62, roofH = 0.66, roofD = len * 0.42, roofY = 1.45, roofZ = -0.1;
    let topFrac = 0.8, raked = false;

    if (bt === "sedan") {
      w = 1.96; hullH = 0.66; hullY = 0.72; wheelR = 0.46;
      roofW = 1.58; roofH = 0.62; roofD = len * 0.4; roofY = 1.42; roofZ = -0.15; topFrac = 0.84;
    } else if (bt === "suv") {
      w = 2.08; hullH = 0.86; hullY = 0.82; wheelR = 0.52; halfTrack = 1.04;
      roofW = 1.78; roofH = 0.82; roofD = len * 0.5; roofY = 1.7; roofZ = -0.06; topFrac = 0.9;
    } else if (bt === "pickup") {
      w = 2.06; hullH = 0.8; hullY = 0.8; wheelR = 0.52; halfTrack = 1.04;
      // cab sits forward; an open bed sits behind it
      roofW = 1.7; roofH = 0.74; roofD = len * 0.34; roofY = 1.62; roofZ = len * 0.16; topFrac = 0.92;
    } else { // coupe — sports car: low, wide, raked
      w = 2.04; hullH = 0.5; hullY = 0.58; wheelR = 0.47; halfTrack = 1.0;
      roofW = 1.5; roofH = 0.52; roofD = len * 0.34; roofY = 1.18; roofZ = -0.16; topFrac = 0.74; raked = true;
    }

    // ---- HULL (the deformable body the crumpler caves in). chamfered wedge,
    //      kept centred at y≈0.78 so crumpleCar's 0.78-baseline math still lands. ----
    const body = new THREE.Mesh(wedgeGeo(w, hullH, len, topFrac, bt === "coupe" ? 0.92 : 1, 1), paint);
    body.position.y = 0.78; body.castShadow = true; grp.add(body);
    // raise/lower the visual hull to its type's ride height without breaking the
    // crumpler baseline (it sets body.position.y = 0.78 - c*0.14): nudge via the
    // group children offset instead — keep body at 0.78 and float a skirt.
    if (hullY !== 0.7) body.position.y = 0.78 + (hullY - 0.72);

    // ---- ROOF / CABIN (the deformable greenhouse). ----
    const cabin = new THREE.Mesh(wedgeGeo(roofW, roofH, roofD, topFrac * 0.94, raked ? 0.6 : 0.8, 0.95), paint);
    cabin.position.set(0, roofY, roofZ); grp.add(cabin);
    grp.userData.body = body; grp.userData.cabin = cabin;   // crash crumpling

    // glass on the greenhouse
    addGlass(grp, roofW, roofD, roofY, roofH, raked);

    // a contrasting belt-line / bumpers so the body isn't one flat colour
    const beltY = 0.78 + (hullY - 0.72) - hullH * 0.18;
    const belt = new THREE.Mesh(new THREE.BoxGeometry(w + 0.04, 0.16, len * 0.96), trim);
    belt.position.set(0, Math.max(0.5, beltY), 0); grp.add(belt);

    // pickup bed walls (an open box behind the cab)
    if (bt === "pickup") {
      const bedY = 0.78 + (hullY - 0.72) + hullH * 0.32;
      const bedmat = paint;
      const sideD = len * 0.42;
      [w / 2 - 0.06, -w / 2 + 0.06].forEach((bx) => {
        const wall = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.26, sideD), bedmat);
        wall.position.set(bx, bedY + 0.13, -len * 0.22); grp.add(wall);
      });
      const tail = new THREE.Mesh(new THREE.BoxGeometry(w - 0.1, 0.26, 0.1), bedmat);
      tail.position.set(0, bedY + 0.13, -len * 0.44); grp.add(tail);
    }
    // coupe rear spoiler
    if (bt === "coupe") {
      const spoiler = new THREE.Mesh(new THREE.BoxGeometry(w * 0.74, 0.07, 0.2), trim);
      spoiler.position.set(0, 0.78 + (hullY - 0.72) + hullH * 0.42, -len * 0.46); grp.add(spoiler);
    }

    addWheels(grp, halfTrack, len * 0.32, wheelR);
    addLights(grp, w, 0.78 + (hullY - 0.72) + hullH * 0.05, len * 0.5, -len * 0.5);
    return grp;
  }

  function makeCar(x, z, heading, vertical, model, aggr) {
    const grp = buildCar(model);
    grp.position.set(x, 0, z); grp.rotation.y = heading;
    CBZ.city.arena.root.add(grp);
    const c = {
      group: grp, pos: grp.position, heading, vertical, model: model || null,
      v: 0, vx: 0, vz: 0, color: model ? model.color : 0x3c6fd6, stolen: false, player: false, ai: true,
      lane: 0, road: null, dirSign: 1, dead: false,
      driver: { aggr: aggr != null ? aggr : 0.3 },
      pullover: 0, ranRedCD: 0, turnCD: 1 + rng() * 2, npcWanted: 0, npcDriver: null, dwell: 0, stopT: 0,
      roadRageTarget: null, roadRageT: 0, playerHitCD: 0,
    };
    CBZ.cityCars.push(c);
    return c;
  }

  CBZ.spawnCityTraffic = function (n) {
    clearCars();
    const A = CBZ.city.arena; if (!A) return;
    _s = 1234 + n;
    const econ = CBZ.cityEcon;
    const reckFrac = TR().recklessFrac != null ? TR().recklessFrac : 0.18;
    const [cLo, cHi] = TR().cruise || [7, 12];
    for (let i = 0; i < n; i++) {
      const r = A.roads[(rng() * A.roads.length) | 0];
      const along = (rng() - 0.5) * r.len * 0.85;
      const dirSign = rng() < 0.5 ? 1 : -1;
      const lane = dirSign * (TR().lane != null ? TR().lane : 2.2);
      const x = r.vertical ? r.x + lane : r.x + along;
      const z = r.vertical ? r.z + along : r.z + lane;
      const heading = r.vertical ? (dirSign > 0 ? 0 : Math.PI) : (dirSign > 0 ? Math.PI / 2 : -Math.PI / 2);
      const reckless = rng() < reckFrac;
      const aggr = reckless ? 0.65 + rng() * 0.35 : 0.15 + rng() * 0.35;
      const model = econ ? econ.pickCar(rng() < 0.12) : null;
      const c = makeCar(x, z, heading, r.vertical, model, aggr);
      c.road = r; c.lane = lane; c.dirSign = dirSign;
      c.baseV = (cLo + rng() * (cHi - cLo)) * (reckless ? (TR().aggrSpeedMul || 1.7) : 1);
      c.v = c.baseV * 0.6; c.reckless = reckless;
    }
  };

  function clearCars() {
    for (const c of CBZ.cityCars) {
      if (CBZ.cityDemotePlayerCar) CBZ.cityDemotePlayerCar(c);
      if (c.group && c.group.parent) c.group.parent.remove(c.group);
      if (c.group) c.group.traverse(function (o) {
        if (o.geometry && !o.geometry._shared && o.geometry.dispose) o.geometry.dispose();
        if (o.material && !o.material._shared && o.material.dispose) o.material.dispose();
      });
    }
    CBZ.cityCars.length = 0;
  }
  CBZ.clearCityCars = clearCars;

  // a car the player bought / pulled from a garage — owned, full value
  CBZ.citySpawnOwnedCar = function (x, z, modelName) {
    if (!CBZ.city || !CBZ.city.arena) return null;
    const econ = CBZ.cityEcon;
    const model = modelName && econ ? econ.carByName(modelName) : (econ ? econ.pickCar(true) : null);
    const c = makeCar(x, z, 0, true, model, 0.2);
    c.stolen = false; c.ai = false; c.owned = true; c.baseV = 0; c.v = 0;
    return c;
  };

  CBZ.cityNearestCar = function (x, z, maxd) {
    let best = null, bd = maxd || 4;
    for (const c of CBZ.cityCars) { if (c.player) continue; const d = Math.hypot(c.pos.x - x, c.pos.z - z); if (d < bd) { bd = d; best = c; } }
    return best;
  };

  // ---- carjacking: a high-aggression ped grabs an ambient car + rampages ----
  let npcDrivers = 0;
  CBZ.cityNpcCarjack = function (ped, target) {
    if (npcDrivers >= 3) return false;            // bound the chaos
    const car = nearestAmbientCar(ped.pos.x, ped.pos.z, 6.5);
    if (!car) return false;
    car.npcDriver = ped; car.ai = true; car.stolen = true; car.reckless = true;
    car.driver.aggr = Math.max(0.8, ped.aggr); car.baseV = ((TR().cruise || [7, 12])[1]) * (TR().aggrSpeedMul || 1.7);
    car.pullover = 0; car.npcWanted = 1;
    // A victim escalating from a contact event pursues that offender directly.
    // Autonomous carjackers still create general traffic chaos without
    // magically knowing to target the player.
    car.roadRageTarget = target && target.pos ? target : null; car.roadRageT = car.roadRageTarget ? 12 : 0;
    ped.inCar = car; ped.group.visible = false; ped.controlled = true;
    npcDrivers++;
    if (CBZ.cityNpcOffense) CBZ.cityNpcOffense(ped, 24, "carjacking");
    return true;
  };
  function ejectNpcDriver(car) {
    const ped = car.npcDriver; if (!ped) return;
    car.npcDriver = null; npcDrivers = Math.max(0, npcDrivers - 1);
    ped.inCar = null; ped.controlled = false; ped.group.visible = true;
    ped.pos.set(car.pos.x + 1.6, 0, car.pos.z); ped.target.copy(ped.pos);
    if (CBZ.playerCharSync) {}
  }

  // ---- visible crash damage: permanently squash/cave the car mesh. Severity
  //      accumulates, so a worse hit (or a second one) deforms it further. Only
  //      group SCALE + child rotations are touched (the AI rewrites group
  //      position/heading.y every frame but never these), so the wreck persists. ----
  function crumpleCar(car, sev) {
    car.crumple = Math.min(1, (car.crumple || 0) + sev);
    if (car._cside == null) car._cside = Math.random() < 0.5 ? -1 : 1;
    const c = car.crumple, grp = car.group, ud = grp.userData;
    grp.scale.set(1 - c * 0.14, 1 - c * 0.32, 1 - c * 0.12);
    if (ud && ud.body) { ud.body.rotation.z = c * 0.28 * car._cside; ud.body.position.y = 0.78 - c * 0.14; }
    if (ud && ud.cabin) { ud.cabin.rotation.x = -c * 0.34; ud.cabin.rotation.z = c * 0.16 * car._cside; ud.cabin.position.y = 1.45 - c * 0.45; }
  }
  function crashBurst(x, z, speed, hard, catastrophic) {
    if (CBZ.cityCrashFX) CBZ.cityCrashFX(x, z, { speed, hard, catastrophic });
  }
  // a driver dies AT THE WHEEL (a fast crash into a building/post): the body
  // drops out and the now-driverless car careens to a dead stop and is abandoned.
  function killNpcDriverInCar(car) {
    const ped = car.npcDriver;
    ejectNpcDriver(car);                                  // body drops out, visible
    if (ped && !ped.dead && CBZ.cityKillPed) CBZ.cityKillPed(ped, { fromX: car.pos.x, fromZ: car.pos.z, force: 5, fling: 2 }, "killed in the crash");
    car.npcWanted = 0; car.stolen = false; car.roadRageTarget = null; car.roadRageT = 0; car.pullover = 0;
    car.abandoned = true;
    car.wreckT = Math.max(car.wreckT || 0, 1.0);
  }
  function nearestAmbientCar(x, z, maxd) {
    let best = null, bd = maxd * maxd;
    for (const c of CBZ.cityCars) { if (c.player || c.npcDriver || c.owned || c.dead) continue; const dd = (c.pos.x - x) * (c.pos.x - x) + (c.pos.z - z) * (c.pos.z - z); if (dd < bd) { bd = dd; best = c; } }
    return best;
  }

  // ---- enter / exit ----
  CBZ.cityEnterVehicle = function (car) {
    if (!car || car.player) return false;
    if (car.npcDriver) ejectNpcDriver(car);
    const P = CBZ.player;
    P.driving = true; P._vehicle = car;
    car.player = true; car.ai = false; car.pullover = 0;
    if (!car.stolen && !car.owned) {
      car.stolen = true;
      CBZ.cityCrime && CBZ.cityCrime(60, { x: car.pos.x, z: car.pos.z, type: "gta" });
      if (anyWitness(car.pos.x, car.pos.z, 22)) CBZ.city && CBZ.city.note("🚗 Grand Theft Auto!", 1.6);
    }
    car.v = 0;
    CBZ.playerChar.group.visible = false;
    if (CBZ.cityPromotePlayerCar) CBZ.cityPromotePlayerCar(car);
    if (CBZ.sfx) CBZ.sfx("door");
    const worth = car.model ? "  ·  " + car.model.name : "";   // value stays hidden until you chop it
    CBZ.city && CBZ.city.note("Driving" + worth + " — [F] out  [C] car style", 1.8);
    return true;
  };
  CBZ.cityExitVehicle = function () {
    const P = CBZ.player, car = P._vehicle;
    P.driving = false; P._vehicle = null;
    if (car) {
      car.player = false; car.v = 0; car.vx = car.vz = 0; car.ai = false;
      if (CBZ.cityDemotePlayerCar) CBZ.cityDemotePlayerCar(car);
    }
    CBZ.playerChar.group.visible = true;
    if (car) {
      const ox = Math.cos(car.heading) * 1.6, oz = -Math.sin(car.heading) * 1.6;
      P.pos.set(car.pos.x + ox, 0, car.pos.z + oz);
      P.grounded = true; P.vy = 0;
      CBZ.playerChar.group.position.copy(P.pos);
    }
    if (CBZ.sfx) CBZ.sfx("door");
  };

  function anyWitness(x, z, r) {
    const r2 = r * r;
    for (const p of CBZ.cityPeds) { if (p.dead || p.vendor) continue; const dx = p.pos.x - x, dz = p.pos.z - z; if (dx * dx + dz * dz < r2) return true; }
    for (const c of CBZ.cityCops) { if (c.dead) continue; const dx = c.pos.x - x, dz = c.pos.z - z; if (dx * dx + dz * dz < r2) return true; }
    return false;
  }
  function copNear(x, z, r) {
    const r2 = r * r;
    for (const c of CBZ.cityCops) { if (c.dead) continue; const dx = c.pos.x - x, dz = c.pos.z - z; if (dx * dx + dz * dz < r2) return c; }
    return null;
  }

  // ---- F to enter / exit ----
  function active() { return g.mode === "city" && g.state === "playing" && document.pointerLockElement; }
  addEventListener("keydown", function (e) {
    if (!active() || e.repeat) return;
    if (e.key.toLowerCase() === "f") {
      e.preventDefault();
      if (CBZ.player.driving) CBZ.cityExitVehicle();
      else { const c = CBZ.cityNearestCar(CBZ.player.pos.x, CBZ.player.pos.z, 4.0); if (c) CBZ.cityEnterVehicle(c); }
    }
  });

  // ---- player driving (order 11) ----
  CBZ.onUpdate(11, function (dt) {
    if (g.mode !== "city") return;
    const P = CBZ.player;
    if (!P.driving || !P._vehicle || P.dead) return;
    const car = P._vehicle, k = CBZ.keys;
    const ACCEL = 26, MAXV = 34 * (car.model ? (0.8 + car.model.s * 0.2) : 1), REV = 12, TURN = 2.2;
    let throttle = 0;
    if (k["w"]) throttle += 1;
    if (k["s"]) throttle -= 1;
    if (throttle > 0) car.v += ACCEL * dt;
    else if (throttle < 0) car.v -= ACCEL * dt;
    if (throttle === 0) car.v *= Math.pow(0.4, dt);
    car.v = Math.max(-REV, Math.min(MAXV, car.v));
    let steer = 0;
    if (k["a"]) steer += 1;
    if (k["d"]) steer -= 1;
    const vmag = Math.abs(car.v);
    if (vmag > 0.3) car.heading += steer * TURN * dt * Math.sign(car.v) * Math.min(1, vmag / 10);
    const vx = Math.sin(car.heading) * car.v, vz = Math.cos(car.heading) * car.v;
    car.vx = vx; car.vz = vz;
    car.pos.x += vx * dt; car.pos.z += vz * dt;
    const before = { x: car.pos.x, z: car.pos.z };
    if (CBZ.collide) CBZ.collide(car.pos, CAR_R);
    const moved = Math.hypot(car.pos.x - before.x, car.pos.z - before.z);
    if (moved > 0.05 && vmag > 5) {
      // CRASH — far cooler at speed: kill the momentum, bounce back and spin
      // out, a big speed-scaled shake (plus a hitstop punch on a hard hit), a
      // crunch, and shatter / drive-through any storefront glass ahead.
      const hard = vmag >= CRASH.wallHard, catastrophic = vmag >= CRASH.wallCatastrophic;
      car.v *= catastrophic ? 0.06 : (hard ? 0.16 : 0.52);
      const back = Math.min(catastrophic ? 2.2 : 1.35, vmag * (catastrophic ? 0.075 : 0.05));
      car.pos.x -= Math.sin(car.heading) * back; car.pos.z -= Math.cos(car.heading) * back;
      car.heading += (Math.random() - 0.5) * Math.min(catastrophic ? 1.8 : 0.95, vmag * (catastrophic ? 0.07 : 0.045));
      if (CBZ.shake) CBZ.shake(catastrophic ? 2.1 : (hard ? 1.15 : 0.3));
      if (CBZ.doHitstop) CBZ.doHitstop(catastrophic ? 0.14 : (hard ? 0.075 : 0.025));
      if (catastrophic && CBZ.doSlowmo) CBZ.doSlowmo(0.34);
      if (CBZ.sfx) CBZ.sfx(hard ? "ko" : "punch");
      const ix = car.pos.x + Math.sin(car.heading) * 2.2, iz = car.pos.z + Math.cos(car.heading) * 2.2;
      crashBurst(ix, iz, vmag, hard, catastrophic);
      if (hard && CBZ.cityShatter) CBZ.cityShatter(ix, iz, catastrophic ? 10 : 6);
      // the car visibly CRUMPLES (the building/post is only lightly scuffed)
      crumpleCar(car, catastrophic ? 0.78 : (hard ? 0.42 : 0.08));
      // Medium crashes hurt but are explicitly non-lethal. Only a truly
      // catastrophic top-speed slam is allowed to kill the driver.
      if (hard && CBZ.cityHurtPlayer) {
        // a building crash should HURT, not auto-kill — you survive most of them
        // (heavy damage), and only a genuinely extreme top-speed slam is fatal.
        const dmg = catastrophic ? 90 + (vmag - CRASH.wallCatastrophic) * 12
                                 : 16 + (vmag - CRASH.wallHard) * 8;
        CBZ.cityHurtPlayer(Math.round(dmg), car.pos.x, car.pos.z, "crashed the car", false, null, !catastrophic);
        if (P.dead) return;                  // death.js ejects + ragdolls the driver
      }
    }
    if (CBZ.city.arena) CBZ.city.arena.clampToCity(car.pos, CAR_R);
    car.group.position.set(car.pos.x, 0, car.pos.z);
    car.group.rotation.y = car.heading;
    if (vmag > 6) runOver(car, vmag);
    P.pos.set(car.pos.x, 0, car.pos.z);
    CBZ.playerChar.group.position.copy(P.pos);
    CBZ.playerChar.group.visible = false;   // keep the driver's body hidden every frame (FPS/view toggles kept re-showing it → head poked out the roof)
    P.speed = vmag;
    if (CBZ.cityUpdatePlayerCarVisual) CBZ.cityUpdatePlayerCarVisual(car, dt);
    if (CBZ.cam && vmag > 3) {
      const target = car.heading + Math.PI;
      CBZ.cam.yaw = CBZ.lerpAngle(CBZ.cam.yaw, target, 1 - Math.pow(0.02, dt));
    }
    // chop shop: idle a stolen/owned car in the bay to cash it out
    chopCheck(car, vmag, dt);
  });

  // ---- SOLID car-vs-car collision + crashes (every car pair, once a frame).
  //      Cars can no longer phase through each other; a fast impact WRECKS the
  //      AI cars (spin off-rails, smoke, lose control) and dramatically shakes
  //      the screen. The player keeps the wheel but loses most of their speed. ----
  function wreckCar(c, speed, dir) {
    const hard = speed >= CRASH.carHard, catastrophic = speed >= CRASH.carCatastrophic;
    if (c.player) { c.v *= catastrophic ? 0.34 : (hard ? 0.6 : 0.72); return; }   // you keep momentum and PLOW through, not a dead stop
    c.wreckT = Math.max(c.wreckT || 0, catastrophic ? 2.8 : (hard ? 1.8 : 0.72));
    c.v *= catastrophic ? 0.07 : (hard ? 0.16 : 0.56);
    c.spin = (c.spin || 0) + (Math.random() - 0.5) * Math.min(catastrophic ? 8 : 5.5, speed * 0.4) + dir * Math.min(catastrophic ? 4 : 2.4, speed * 0.13);
    c.pullover = 0; c.turning = false;     // abandon whatever it was doing
  }
  function carCrash(a, b, speed, nx, nz) {
    const hard = speed >= CRASH.carHard, catastrophic = speed >= CRASH.carCatastrophic;
    a._crashCD = 0.6; b._crashCD = 0.6;
    wreckCar(a, speed, -1); wreckCar(b, speed, 1);
    // ASYMMETRIC damage: whoever's going faster (the rammer) deals more than they
    // take — the struck car crumples HARD and gets shoved away with momentum, so
    // ramming actually wrecks the other car instead of a soft bounce.
    const aRammer = a.player || (Math.abs(a.v || 0) >= Math.abs(b.v || 0));
    const heavy = catastrophic ? 0.92 : (hard ? 0.62 : 0.26);
    const light = catastrophic ? 0.6 : (hard ? 0.34 : 0.12);
    crumpleCar(a, aRammer ? light : heavy); crumpleCar(b, aRammer ? heavy : light);
    const kick = Math.min(catastrophic ? 3.6 : 2.4, speed * (catastrophic ? 0.12 : 0.09));
    const shove = Math.min(catastrophic ? 15 : 9, speed * 0.62);   // knock the struck car away with real speed
    if (!a.player) { a.pos.x -= nx * kick; a.pos.z -= nz * kick; if (!aRammer) { a.v = Math.max(Math.abs(a.v || 0), shove); a.heading = Math.atan2(-nx, -nz); a.wreckT = Math.max(a.wreckT || 0, 1.2); } }
    if (!b.player) { b.pos.x += nx * kick; b.pos.z += nz * kick; if (aRammer) { b.v = Math.max(Math.abs(b.v || 0), shove); b.heading = Math.atan2(nx, nz); b.wreckT = Math.max(b.wreckT || 0, 1.2); } }
    const cx = (a.pos.x + b.pos.x) / 2, cz = (a.pos.z + b.pos.z) / 2;
    const cam = CBZ.camera.position, cd2 = (cx - cam.x) * (cx - cam.x) + (cz - cam.z) * (cz - cam.z);
    if (a.player || b.player || cd2 < 75 * 75) {
      crashBurst(cx, cz, speed, hard, catastrophic);
      if (catastrophic && CBZ.cityExplosion) {
        // super-fast smash → the wreck goes up in a fireball (no more boring bump)
        a.abandoned = b.abandoned = true; a.wreckT = b.wreckT = Math.max(2, a.wreckT || 0);
        CBZ.cityExplosion(cx, cz, { power: Math.min(1.6, 0.9 + (speed - CRASH.carCatastrophic) * 0.04), byPlayer: !!(a.player || b.player), radius: 6 });
        // a driver caught in the blast goes with it
        if (a.npcDriver) killNpcDriverInCar(a);
        if (b.npcDriver) killNpcDriverInCar(b);
      } else {
        if (CBZ.shake) CBZ.shake(hard ? 0.95 : 0.26);
        if (CBZ.doHitstop) CBZ.doHitstop(hard ? 0.06 : 0.02);
        if (CBZ.sfx) CBZ.sfx(hard ? "ko" : "punch");
      }
      if (hard && CBZ.cityShatter) CBZ.cityShatter(cx, cz, catastrophic ? 8 : 4.5);
    }
  }
  const HIT = 3.4, HIT2 = HIT * HIT;
  function resolveCars(dt) {
    const cars = CBZ.cityCars, n = cars.length;
    for (let i = 0; i < n; i++) {
      const a = cars[i]; if (a.dead) continue;
      if (a._crashCD > 0) a._crashCD -= dt;
      for (let j = i + 1; j < n; j++) {
        const b = cars[j]; if (b.dead) continue;
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z, d2 = dx * dx + dz * dz;
        if (d2 >= HIT2 || d2 < 1e-5) continue;
        const d = Math.sqrt(d2), nx = dx / d, nz = dz / d, overlap = HIT - d;
        // SOLID separation — they cannot occupy the same space
        const aw = a.player ? 0.32 : 0.5, bw = b.player ? 0.32 : 0.5;
        a.pos.x -= nx * overlap * aw; a.pos.z -= nz * overlap * aw;
        b.pos.x += nx * overlap * bw; b.pos.z += nz * overlap * bw;
        // closing speed along the contact normal
        const rel = (Math.sin(a.heading) * a.v - Math.sin(b.heading) * b.v) * nx
                  + (Math.cos(a.heading) * a.v - Math.cos(b.heading) * b.v) * nz;
        if (rel > 2 && a._crashCD <= 0 && b._crashCD <= 0) carCrash(a, b, rel, nx, nz);
        else { a.v *= 0.92; b.v *= 0.92; }     // gentle bumper kiss
        // keep visuals (and the player's position/camera) in sync this frame
        a.group.position.set(a.pos.x, 0, a.pos.z); b.group.position.set(b.pos.x, 0, b.pos.z);
        if (a.player) { CBZ.player.pos.set(a.pos.x, 0, a.pos.z); CBZ.playerChar.group.position.copy(CBZ.player.pos); }
        if (b.player) { CBZ.player.pos.set(b.pos.x, 0, b.pos.z); CBZ.playerChar.group.position.copy(CBZ.player.pos); }
      }
    }
  }
  // run after the player (order 11) and the AI traffic (order 37) have moved
  CBZ.onUpdate(37.6, function (dt) { if (g.mode === "city") resolveCars(dt); });

  function runOver(car, vmag) {
    const P = CBZ.player;
    if (!car.player && !P.dead && !P.driving && car.playerHitCD <= 0) {
      const pdx = P.pos.x - car.pos.x, pdz = P.pos.z - car.pos.z;
      if (pdx * pdx + pdz * pdz < 3.6) {
        car.playerHitCD = 0.85;
        // you get hit the SAME way you hit others: a fast car FLINGS you into a
        // ragdoll tumble (physics.js owns the airborne state); a slow one knocks
        // you down. Damage, shake and hitstop all scale hard with speed.
        if (CBZ.cityHurtPlayer) CBZ.cityHurtPlayer(Math.min(165, 12 + vmag * 5), car.pos.x, car.pos.z, "run over", false, car.npcDriver || null, vmag < 18);
        if (!P.dead && CBZ.body && CBZ.city) {
          if (vmag > 13) CBZ.body.fling(CBZ.city.playerActor, { fromX: car.pos.x, fromZ: car.pos.z, force: 6 + vmag * 0.5, up: 4 + vmag * 0.24 });
          else CBZ.body.knockdown(CBZ.city.playerActor, { fromX: car.pos.x, fromZ: car.pos.z, force: 8 + vmag * 0.4, t: 1.6 });
        }
        if (car.npcDriver && CBZ.cityNpcOffense) CBZ.cityNpcOffense(car.npcDriver, 48, "vehicular-assault");
        if (CBZ.shake) CBZ.shake(0.4 + Math.min(1.2, vmag * 0.05));
        if (CBZ.doHitstop) CBZ.doHitstop(Math.min(0.1, 0.03 + vmag * 0.002));
        car.v *= 0.7;
      }
    }
    for (const p of CBZ.cityPeds) {
      if (p.dead || p.inCar) continue;
      const dx = p.pos.x - car.pos.x, dz = p.pos.z - car.pos.z;
      if (dx * dx + dz * dz < 3.2) {
        if ((p._carHitUntil || 0) > (CBZ.now || 0)) continue;
        p._carHitUntil = (CBZ.now || 0) + 850;
        // Low-speed contact knocks a person over and makes them react. Only a
        // genuinely fast impact becomes a lethal run-over.
        const imp = { fromX: car.pos.x, fromZ: car.pos.z, force: 8 + vmag * 0.35, fling: 4 + vmag * 0.3 };
        if (!car.player) { imp.attacker = car.npcDriver || null; imp.byPlayer = false; }
        if (vmag >= CRASH.pedLethal) CBZ.cityKillPed && CBZ.cityKillPed(p, imp, "run over");
        else {
          const offender = car.player ? CBZ.city.playerActor : (car.npcDriver || null);
          p.ko = Math.max(p.ko || 0, 2.2 + vmag * 0.2);
          p.alarmed = Math.max(p.alarmed || 0, 6);
          p.fear = Math.min(10, (p.fear || 0) + 3);
          if (offender) {
            p.mem = offender;
            if ((p.aggr || 0) >= 0.58) { p.rage = offender; p.state = "fight"; }
          }
          if (CBZ.body) CBZ.body.hit(p, { fromX: car.pos.x, fromZ: car.pos.z, force: 5 + vmag * 0.45, knockdown: true });
          if (car.player) {
            CBZ.cityAlarm && CBZ.cityAlarm(p.pos.x, p.pos.z, 14, 0.8, CBZ.city.playerActor);
            CBZ.cityCrime && CBZ.cityCrime(28, { x: p.pos.x, z: p.pos.z, type: "vehicular-assault" });
          } else if (car.npcDriver && CBZ.cityNpcOffense) CBZ.cityNpcOffense(car.npcDriver, 22, "vehicular-assault");
        }
        if (CBZ.shake) CBZ.shake((car.player ? 0.2 : 0.12) + Math.min(0.7, vmag * 0.025));
        car.v *= vmag >= CRASH.pedLethal ? 0.9 : 0.72;
      }
    }
    // mow down the ambient instanced crowd (the far NPCs) — player car only so
    // the kill is attributed to you, not to NPC drivers. Fast impacts are lethal.
    if (car.player && vmag >= CRASH.pedLethal && CBZ.cityCrowdCircleKill) {
      const n = CBZ.cityCrowdCircleKill(car.pos.x, car.pos.z, 2.0, { byCar: true, fromX: car.pos.x, fromZ: car.pos.z });
      if (n > 0 && CBZ.shake) CBZ.shake(0.25 + Math.min(0.5, vmag * 0.02));
    }
    for (const c of CBZ.cityCops) {
      if (c.dead) continue;
      const dx = c.pos.x - car.pos.x, dz = c.pos.z - car.pos.z;
      if (dx * dx + dz * dz < 3.2) {
        if ((c._carHitUntil || 0) > (CBZ.now || 0)) continue;
        c._carHitUntil = (CBZ.now || 0) + 850;
        if (vmag >= CRASH.pedLethal) CBZ.cityHurtCop && CBZ.cityHurtCop(c, 90, { fromX: car.pos.x, fromZ: car.pos.z, force: 8 + vmag * 0.3, fling: 3 + vmag * 0.2, attacker: car.player ? null : (car.npcDriver || null), byPlayer: !!car.player });
        else if (CBZ.body) CBZ.body.hit(c, { fromX: car.pos.x, fromZ: car.pos.z, force: 5 + vmag * 0.4, knockdown: true });
        car.v *= 0.82;
      }
    }
  }

  function advanceRoadRage(car, dt, arena) {
    const target = car.roadRageTarget;
    if (!target || target.dead || car.roadRageT <= 0) {
      car.roadRageTarget = null; car.roadRageT = 0;
      return false;
    }
    car.roadRageT -= dt;
    const dx = target.pos.x - car.pos.x, dz = target.pos.z - car.pos.z;
    const desired = Math.atan2(dx, dz);
    car.heading = CBZ.lerpAngle(car.heading, desired, 1 - Math.pow(0.0008, dt));
    const top = Math.max(13, car.baseV || 13);
    car.v += Math.min(18 * dt, top - car.v);
    car.v = Math.max(0, car.v);
    car.pos.x += Math.sin(car.heading) * car.v * dt;
    car.pos.z += Math.cos(car.heading) * car.v * dt;
    if (CBZ.collide) CBZ.collide(car.pos, CAR_R);
    if (arena) arena.clampToCity(car.pos, CAR_R);
    car.group.position.set(car.pos.x, 0, car.pos.z);
    car.group.rotation.y = car.heading;
    if (car.npcDriver && car.npcDriver.pos) car.npcDriver.pos.set(car.pos.x, 0, car.pos.z);
    if (car.v > 6) runOver(car, car.v);
    const cdx = car.pos.x - CBZ.camera.position.x, cdz = car.pos.z - CBZ.camera.position.z;
    car.group.visible = (cdx * cdx + cdz * cdz) < 150 * 150;
    return true;
  }

  function chopCheck(car, vmag, dt) {
    const lot = CBZ.city.arena.chopShop; if (!lot || !lot.building.chopZone) return;
    const cz = lot.building.chopZone;
    const inZone = Math.hypot(car.pos.x - cz.x, car.pos.z - cz.z) < cz.r;
    if (inZone && vmag < 1.5 && (car.stolen || car.owned)) {
      car.dwell = (car.dwell || 0) + dt;
      if (car.dwell > 1.2) { sellToChop(car); }
      else if (CBZ.city) CBZ.city.note("🔧 Hold still to chop this " + (car.model ? car.model.name : "car") + "…", 0.5);
    } else car.dwell = 0;
  }
  function sellToChop(car) {
    const E = (CBZ.CITY && CBZ.CITY.econ) || {};
    const base = car.model ? car.model.value : 3000;
    const frac = car.owned ? (E.chopOwned || 0.85) : (E.chopStolen || 0.42);
    const pay = Math.round(base * frac);
    CBZ.cityExitVehicle();
    if (car.group && car.group.parent) car.group.parent.remove(car.group);
    const idx = CBZ.cityCars.indexOf(car); if (idx >= 0) CBZ.cityCars.splice(idx, 1);
    CBZ.city.addCash(pay); CBZ.city.addRespect(2);
    CBZ.city.big("CHOPPED " + (car.model ? car.model.name : "car") + " + $" + pay.toLocaleString());
    if (CBZ.sfx) CBZ.sfx("coin");
    if (!car.owned && anyWitness(CBZ.player.pos.x, CBZ.player.pos.z, 26)) CBZ.cityCrime && CBZ.cityCrime((CBZ.CITY.econ && CBZ.CITY.econ.chopHeat) || 14, { type: "chop" });
  }

  // ---- ambient traffic AI (order 37) ----
  CBZ.onUpdate(37, function (dt) {
    if (g.mode !== "city") return;
    const A = CBZ.city.arena; if (!A) return;
    const lane = TR().lane != null ? TR().lane : 2.2;
    for (const c of CBZ.cityCars) {
      if (c.player || c.dead || !c.ai || !c.road) continue;
      // DRIVER SHOT DEAD AT THE WHEEL (cops / gunfire): drop the body out and let
      // the now-driverless car careen to a stop — no more ghost-driving a corpse.
      if (c.npcDriver && c.npcDriver.dead) {
        ejectNpcDriver(c);
        c.abandoned = true; c.npcWanted = 0; c.stolen = false; c.roadRageTarget = null; c.roadRageT = 0; c.pullover = 0;
        c.wreckT = Math.max(c.wreckT || 0, 1.1);
      }
      // WRECKED (just crashed): spin out off-rails and coast to a stop, then
      // recover and drive on — skips all lane-keeping so the crash actually reads.
      if (c.wreckT > 0) {
        c.wreckT -= dt;
        c.v *= Math.pow(0.04, dt);
        c.spin = (c.spin || 0) * Math.pow(0.25, dt);
        c.heading += c.spin * dt;
        c.pos.x += Math.sin(c.heading) * c.v * dt;
        c.pos.z += Math.cos(c.heading) * c.v * dt;
        const px = c.pos.x, pz = c.pos.z;
        if (CBZ.collide) CBZ.collide(c.pos, CAR_R);
        const pushed = Math.hypot(c.pos.x - px, c.pos.z - pz);
        if (A.clampToCity) A.clampToCity(c.pos, CAR_R);
        // slammed a building / lamppost mid-spin: crumple the car (the structure
        // only sheds some glass), and a fast hit kills whoever's driving.
        if (pushed > 0.05 && c.v > 11) {
          const catastrophic = c.v >= CRASH.npcDriverLethal, hard = c.v >= CRASH.wallHard;
          crumpleCar(c, catastrophic ? 0.7 : (hard ? 0.42 : 0.16));
          crashBurst(c.pos.x, c.pos.z, c.v, hard, catastrophic);
          if (hard && CBZ.cityShatter) CBZ.cityShatter(c.pos.x, c.pos.z, catastrophic ? 8 : 4.5);
          const cm = CBZ.camera.position;
          if (((c.pos.x - cm.x) * (c.pos.x - cm.x) + (c.pos.z - cm.z) * (c.pos.z - cm.z)) < 80 * 80) {
            if (CBZ.shake) CBZ.shake(0.12 + Math.min(0.6, c.v * 0.03));
            if (CBZ.sfx) CBZ.sfx(c.v > 16 ? "ko" : "punch");
          }
          if (catastrophic && c.npcDriver && !c.abandoned) killNpcDriverInCar(c);
          c.v *= catastrophic ? 0.08 : (hard ? 0.18 : 0.45);
        }
        c.group.position.set(c.pos.x, 0, c.pos.z);
        c.group.rotation.y = c.heading;
        if (c.npcDriver && c.npcDriver.pos) c.npcDriver.pos.set(c.pos.x, 0, c.pos.z);
        const wdx = c.pos.x - CBZ.camera.position.x, wdz = c.pos.z - CBZ.camera.position.z;
        c.group.visible = (wdx * wdx + wdz * wdz) < 150 * 150;
        if (c.wreckT <= 0 && c.abandoned) c.ai = false;   // settle as an abandoned wreck
        continue;
      }
      if (c.playerHitCD > 0) c.playerHitCD = Math.max(0, c.playerHitCD - dt);
      if (c.npcDriver && c.roadRageTarget && advanceRoadRage(c, dt, A)) continue;
      if (c.ranRedCD > 0) c.ranRedCD -= dt;
      if (c.turnCD > 0) c.turnCD -= dt;

      // ---- mid-turn: arc smoothly through the intersection (no snap) ----
      if (c.turning) {
        const tv = Math.min(c.baseV, c.reckless ? 8 : 5.5);   // ease off to corner
        c.v += Math.max(-18 * dt, Math.min(10 * dt, tv - c.v));
        c.v = Math.max(1.5, c.v);
        advanceTurn(c, dt);
        c.group.position.set(c.pos.x, 0, c.pos.z);
        c.group.rotation.y = c.heading;
        if (c.npcDriver && c.npcDriver.pos) c.npcDriver.pos.set(c.pos.x, 0, c.pos.z);
        if (c.v > 9 && (c.reckless || c.pullover === 4)) runOver(c, c.v);
        const tdx = c.pos.x - CBZ.camera.position.x, tdz = c.pos.z - CBZ.camera.position.z;
        c.group.visible = (tdx * tdx + tdz * tdz) < 150 * 150;
        continue;
      }
      const r = c.road;

      // ---- desired speed: cruise, modulated by lights, following, stops ----
      let target = c.baseV;

      // red-light stop (calm drivers; the reckless gamble on it)
      const it = A.nearestIntersection(c.pos.x, c.pos.z);
      const distToInt = r.vertical ? (it.z - c.pos.z) * c.dirSign : (it.x - c.pos.x) * c.dirSign;
      const red = CBZ.cityIsRed(r.vertical);
      const stopGap = TR().stopGap || 6.5;
      // calm drivers ANTICIPATE the red — ease to a smooth stop at the line from
      // further out (reads clearly as obeying the signal). Reckless ones gamble.
      if (red && distToInt > 1.2 && distToInt < stopGap + 5) {
        if (!c.reckless || c.driver.aggr < 0.8) target = Math.min(target, Math.max(0, (distToInt - 1.6) * 1.4));
      }

      // car-following: never rear-end the car ahead in your lane
      const ahead = carAhead(c);
      if (ahead) {
        const gap = ahead.gap, follow = (TR().follow || 8) * (c.reckless ? 0.55 : 1);
        if (gap < follow) target = Math.min(target, Math.max(0, ahead.v * (gap < follow * 0.4 ? 0.3 : 0.85)));
      }

      // a signalled pull-over: comply (stop) unless fleeing
      if (c.pullover === 1) { if (c.driver.aggr >= 0.6 || c.npcWanted >= 1) { startFlee(c); } else { c.pullover = 2; } }
      if (c.pullover === 2 || c.pullover === 3) {
        target = 0;
        const enf = copNear(c.pos.x, c.pos.z, 7);
        if (enf) { c.pullover = 3; c.stopT += dt; if (c.stopT > 3) { c.pullover = 0; c.stopT = 0; CBZ.city && CBZ.city.note("🎫 " + (c.model ? c.model.name : "Driver") + " ticketed", 0.8); } }
        else { c.stopT += dt; if (c.stopT > 6) { c.pullover = 0; c.stopT = 0; } }   // no cop showed — drive on
      }
      if (c.pullover === 4) {
        target = c.baseV * 1.15;                                    // fleeing flat-out
        c.fleeT -= dt;
        if (c.fleeT <= 0) { c.pullover = 0; c.npcWanted = 0; c.stopT = 0; }   // lost them
      }

      // PEDESTRIANS: a normal driver brakes for someone in their lane ahead; a
      // RECKLESS one (the aggression stat maxed out) keeps their foot down and
      // mows them over — the personality spectrum's extreme is a maniac.
      if ((!c.reckless || c.driver.aggr < 0.8) && c.pullover !== 4) {
        const fwx = r.vertical ? 0 : c.dirSign, fwz = r.vertical ? c.dirSign : 0;
        let brake = 0;
        for (let i = 0; i < CBZ.cityPeds.length && brake < 1; i++) {
          const p = CBZ.cityPeds[i]; if (p.dead || p.inCar) continue;
          const dx = p.pos.x - c.pos.x, dz = p.pos.z - c.pos.z, ah = dx * fwx + dz * fwz;
          if (ah > 0.5 && ah < 8 && Math.abs(dx * -fwz + dz * fwx) < 2.0) brake = ah < 4 ? 1 : Math.max(brake, 0.5);
        }
        if (brake < 1 && !CBZ.player.driving && !CBZ.player.dead) {
          const dx = CBZ.player.pos.x - c.pos.x, dz = CBZ.player.pos.z - c.pos.z, ah = dx * fwx + dz * fwz;
          if (ah > 0.5 && ah < 8 && Math.abs(dx * -fwz + dz * fwx) < 2.0) brake = ah < 4 ? 1 : Math.max(brake, 0.5);
        }
        if (brake >= 1) target = 0; else if (brake > 0) target = Math.min(target, c.v * 0.3);
      }

      // approach the target speed
      const accel = (target > c.v ? 9 : 16) * (c.reckless ? 1.3 : 1);
      c.v += Math.max(-accel * dt, Math.min(accel * dt, target - c.v));
      c.v = Math.max(0, c.v);

      // ---- advance along the road ----
      const moveAxisZ = r.vertical;
      if (moveAxisZ) c.pos.z += c.dirSign * c.v * dt; else c.pos.x += c.dirSign * c.v * dt;

      // lane-keeping: pin to the lane's lateral line; reckless drivers WEAVE
      // (drunk/aggressive sway) within the lane so they read as bad drivers.
      const swayAmp = c.reckless ? 0.85 : 0;
      let phaseRate = 0;
      if (swayAmp) { phaseRate = (1.6 + (c.driver.aggr - 0.6) * 1.4); c.swayPhase = (c.swayPhase || rng() * 6) + dt * phaseRate; }
      const sway = swayAmp ? Math.sin(c.swayPhase) * swayAmp : 0;
      if (moveAxisZ) c.pos.x = r.x + c.lane + sway; else c.pos.z = r.z + c.lane + sway;

      // heading follows travel, tilted by the weave so the nose visibly swerves
      const baseH = moveAxisZ ? (c.dirSign > 0 ? 0 : Math.PI) : (c.dirSign > 0 ? Math.PI / 2 : -Math.PI / 2);
      if (swayAmp) {
        const dlat = Math.cos(c.swayPhase) * swayAmp * phaseRate;
        const dalong = c.dirSign * Math.max(2, c.v);
        c.heading = moveAxisZ ? Math.atan2(dlat, dalong) : Math.atan2(dalong, dlat);
      } else c.heading = baseH;

      // crossing the intersection: ran-a-red check + maybe begin a turn
      const insideInt = Math.abs(c.pos.x - it.x) < A.ROAD / 2 + 0.5 && Math.abs(c.pos.z - it.z) < A.ROAD / 2 + 0.5;
      if (insideInt && red && c.ranRedCD <= 0 && c.v > 4) {
        c.ranRedCD = 3; ranRed(c);
      }
      if (insideInt && c.turnCD <= 0 && c.v > 2 && rng() < 0.5) beginTurn(c, it, A, lane);

      // wrap at the end of the road (fallback if it never turned)
      const lim = r.len / 2 - 2;
      if (moveAxisZ) { if ((c.pos.z - r.z) * c.dirSign > lim) c.pos.z = r.z - c.dirSign * lim; }
      else { if ((c.pos.x - r.x) * c.dirSign > lim) c.pos.x = r.x - c.dirSign * lim; }

      // fleeing suspect caught: a cop right on it ends the chase
      if (c.pullover === 4) {
        const cop = copNear(c.pos.x, c.pos.z, 3.2);
        if (cop) busted(c);
      }

      c.group.position.set(c.pos.x, 0, c.pos.z);
      c.group.rotation.y = c.heading;
      // keep a carjacker's body riding with the car so cops chase the right spot
      if (c.npcDriver && c.npcDriver.pos) c.npcDriver.pos.set(c.pos.x, 0, c.pos.z);
      // any moving car hits whoever's in front of it — calm drivers braked
      // above so they rarely connect; reckless ones plow straight through.
      if (c.v > 5) runOver(c, c.v);
      // simple distance cull: cars far from the camera stop drawing
      const cdx = c.pos.x - CBZ.camera.position.x, cdz = c.pos.z - CBZ.camera.position.z;
      c.group.visible = (cdx * cdx + cdz * cdz) < 150 * 150;
    }
  });

  // nearest car directly ahead of `c` in the same road & direction
  function carAhead(c) {
    let best = null, bg = 1e9;
    for (const o of CBZ.cityCars) {
      if (o === c || o.dead || o.road !== c.road || o.dirSign !== c.dirSign) continue;
      const along = c.vertical ? (o.pos.z - c.pos.z) * c.dirSign : (o.pos.x - c.pos.x) * c.dirSign;
      const lat = c.vertical ? Math.abs(o.pos.x - c.pos.x) : Math.abs(o.pos.z - c.pos.z);
      if (along > 0 && lat < 2.4 && along < bg) { bg = along; best = o; }
    }
    return best ? { v: best.v, gap: bg } : null;
  }

  // set up a smooth quarter-arc onto the perpendicular road. The arc is a
  // quadratic Bézier from the car's current lane position, through the corner
  // where the two lane centre-lines meet, out onto the new lane — so the car
  // sweeps the turn instead of teleporting + snapping its heading.
  function beginTurn(c, it, A, laneW) {
    const wantVertical = !c.vertical;
    const road = findRoad(A, wantVertical, wantVertical ? it.x : it.z);
    if (!road) return;
    const newDir = rng() < 0.5 ? 1 : -1;
    const newLane = newDir * laneW;
    const lead = A.ROAD / 2 + 1.2;

    // P0: where we are now, snapped onto the current lane's lateral line
    const P0 = c.vertical ? { x: c.road.x + c.lane, z: c.pos.z }
                          : { x: c.pos.x, z: c.road.z + c.lane };
    // P2: out onto the new lane, just past the intersection
    const P2 = wantVertical ? { x: road.x + newLane, z: it.z + newDir * lead }
                            : { x: it.x + newDir * lead, z: road.z + newLane };
    // P1: the corner — intersection of the old lane line and the new lane line
    const P1 = c.vertical ? { x: c.road.x + c.lane, z: road.z + newLane }
                          : { x: road.x + newLane, z: c.road.z + c.lane };

    const len = Math.hypot(P1.x - P0.x, P1.z - P0.z) + Math.hypot(P2.x - P1.x, P2.z - P1.z);
    const endH = wantVertical ? (newDir > 0 ? 0 : Math.PI) : (newDir > 0 ? Math.PI / 2 : -Math.PI / 2);
    c.turning = { P0, P1, P2, len, t: 0, road, vertical: wantVertical, dirSign: newDir, lane: newLane, endH };
    c.turnCD = 3 + rng() * 3;
  }

  // advance the in-progress turn arc by this frame's distance
  function advanceTurn(c, dt) {
    const T = c.turning;
    T.t += (c.v * dt) / Math.max(0.5, T.len);
    if (T.t >= 1) {                                   // arrived — commit to the new road
      c.pos.x = T.P2.x; c.pos.z = T.P2.z;
      c.road = T.road; c.vertical = T.vertical; c.dirSign = T.dirSign; c.lane = T.lane;
      c.heading = T.endH; c.turning = null;
      return;
    }
    const t = T.t, u = 1 - t;
    c.pos.x = u * u * T.P0.x + 2 * u * t * T.P1.x + t * t * T.P2.x;
    c.pos.z = u * u * T.P0.z + 2 * u * t * T.P1.z + t * t * T.P2.z;
    const dx = 2 * u * (T.P1.x - T.P0.x) + 2 * t * (T.P2.x - T.P1.x);
    const dz = 2 * u * (T.P1.z - T.P0.z) + 2 * t * (T.P2.z - T.P1.z);
    c.heading = Math.atan2(dx, dz);                   // nose follows the arc tangent
  }
  function findRoad(A, vertical, coord) {
    let best = null, bd = 9;
    for (const r of A.roads) { if (!!r.vertical !== !!vertical) continue; const v = vertical ? r.x : r.z; const d = Math.abs(v - coord); if (d < bd) { bd = d; best = r; } }
    return best;
  }

  // a car ran a red — a violation; a nearby cop starts a stop
  function ranRed(c) {
    c.npcViolation = (c.npcViolation || 0) + 1;
    const cop = copNear(c.pos.x, c.pos.z, 30);
    if (cop) {
      if (c.driver.aggr >= 0.6) { startFlee(c); }
      else { c.pullover = 1; CBZ.city && CBZ.city.note("🚓 Traffic stop nearby", 0.8); }
    }
  }
  function startFlee(c) {
    if (c.pullover === 4) return;
    c.pullover = 4; c.npcWanted = Math.max(1, c.npcWanted); c.fleeT = 12 + rng() * 6;
    CBZ.city && CBZ.city.note("🚨 " + (c.model ? c.model.name : "A driver") + " is fleeing the police!", 1.2);
    // register the fleeing driver as an NPC offender the cops will chase
    if (CBZ.cityRegisterCarSuspect) CBZ.cityRegisterCarSuspect(c);
  }
  function busted(c) {
    c.pullover = 0; c.npcWanted = 0; c.v = 0; c.baseV = Math.max(2, c.baseV * 0.5); c.reckless = false; c.driver.aggr = 0.2;
    if (c.npcDriver) { const ped = c.npcDriver; ejectNpcDriver(c); if (ped && CBZ.cityNpcArrest) CBZ.cityNpcArrest(ped); }
  }
  CBZ.cityVehiclesReset = function () { npcDrivers = 0; };
  // let police flag a car for a stop
  CBZ.cityCarPullover = function (c) { if (c && !c.player && c.pullover === 0) c.pullover = 1; };
})();
