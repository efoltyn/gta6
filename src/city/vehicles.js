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

  // the body archetypes — distinct silhouettes so traffic reads as a real mix:
  // sedan / SUV / pickup / coupe(sports) / muscle / van. Ambient spawns weight
  // toward the everyday three; muscle & van also appear so the street has variety.
  const BODY_TYPES = ["sedan", "sedan", "suv", "pickup", "coupe", "muscle", "van"];
  function modelBodyKind(model) {
    const nm = model ? model.name : "";
    if (/F-150|Caravan|Sprinter|Transit|truck|pickup/i.test(nm)) return /Caravan|Sprinter|Transit|van/i.test(nm) ? "van" : "pickup";
    if (/van|cargo/i.test(nm)) return "van";
    if (/Charger|Mustang|Camaro|Challenger|muscle/i.test(nm)) return "muscle";
    if (/Cherokee|SUV|Model X|Model Y|Cybertruck|Escalade|Tahoe|Range/i.test(nm)) return "suv";
    if (/Corvette|911|370Z|Aventador|Enzo|Veyron|coupe|Ferrari|Porsche/i.test(nm)) return "coupe";
    return BODY_TYPES[(rng() * BODY_TYPES.length) | 0];
  }
  function vehicleProfile(model, body) {
    const s = model ? model.s || 1 : 1;
    const bk = body || modelBodyKind(model);
    let mass = 1.05, armor = 0.05, repair = 1.0;
    if (bk === "coupe") { mass = 0.9; armor = 0.02; repair = 1.18; }
    else if (bk === "muscle") { mass = 1.12; armor = 0.08; repair = 1.1; }
    else if (bk === "suv") { mass = 1.36; armor = 0.16; repair = 1.12; }
    else if (bk === "pickup") { mass = 1.44; armor = 0.2; repair = 0.98; }
    else if (bk === "van") { mass = 1.5; armor = 0.18; repair = 0.94; }
    if (s > 1.35) { mass *= 0.94; repair *= 1.25; }     // exotics are lighter and expensive to fix
    return { mass, armor, repair };
  }

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
    let bt = modelBodyKind(model);

    // shared dimensions, tuned per body type below
    let w = 2.0, hullH = 0.62, hullY = 0.7, wheelR = 0.45, halfTrack = 0.98;
    let roofW = 1.62, roofH = 0.66, roofD = len * 0.42, roofY = 1.45, roofZ = -0.1;
    let topFrac = 0.8, raked = false;

    if (bt === "sedan") {
      w = 1.94; hullH = 0.64; hullY = 0.72; wheelR = 0.46; halfTrack = 0.99;
      roofW = 1.56; roofH = 0.62; roofD = len * 0.42; roofY = 1.42; roofZ = -0.12; topFrac = 0.84;
    } else if (bt === "suv") {
      w = 2.1; hullH = 0.9; hullY = 0.86; wheelR = 0.54; halfTrack = 1.06;
      roofW = 1.82; roofH = 0.84; roofD = len * 0.52; roofY = 1.78; roofZ = -0.04; topFrac = 0.92;
    } else if (bt === "pickup") {
      w = 2.08; hullH = 0.82; hullY = 0.82; wheelR = 0.54; halfTrack = 1.06;
      // cab sits forward; an open bed sits behind it
      roofW = 1.72; roofH = 0.76; roofD = len * 0.32; roofY = 1.66; roofZ = len * 0.18; topFrac = 0.94;
    } else if (bt === "muscle") { // long-hood American muscle: wide, low, fat rear
      w = 2.06; hullH = 0.6; hullY = 0.66; wheelR = 0.5; halfTrack = 1.03;
      roofW = 1.6; roofH = 0.56; roofD = len * 0.3; roofY = 1.3; roofZ = -0.2; topFrac = 0.8;
    } else if (bt === "van") { // tall slab-sided cargo box, short hood
      w = 2.14; hullH = 1.36; hullY = 1.06; wheelR = 0.5; halfTrack = 1.06;
      roofW = 1.96; roofH = 0.5; roofD = len * 0.4; roofY = 2.02; roofZ = len * 0.18; topFrac = 0.98;
    } else { // coupe — sports car: low, wide, raked
      w = 2.04; hullH = 0.5; hullY = 0.58; wheelR = 0.47; halfTrack = 1.01;
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
    // muscle: a black hood scoop + a low ducktail wing so it reads aggressive
    if (bt === "muscle") {
      const scoop = new THREE.Mesh(new THREE.BoxGeometry(w * 0.36, 0.13, len * 0.18), trim);
      scoop.position.set(0, 0.78 + (hullY - 0.72) + hullH * 0.5, len * 0.26); grp.add(scoop);
      const wing = new THREE.Mesh(new THREE.BoxGeometry(w * 0.8, 0.08, 0.16), trim);
      wing.position.set(0, 0.78 + (hullY - 0.72) + hullH * 0.5, -len * 0.46); grp.add(wing);
    }
    // van: a side-crease + a roof cap so the tall slab doesn't read as a brick
    if (bt === "van") {
      const cap = new THREE.Mesh(new THREE.BoxGeometry(roofW + 0.06, 0.1, roofD), paint);
      cap.position.set(0, roofY + roofH * 0.5, roofZ); grp.add(cap);
    }

    // shared FRONT FASCIA: a dark grille + a slim bumper bar so every nose has a
    // face (and a chrome-ish bumper at the tail). Cheap boxes; one trim material.
    const noseY = 0.78 + (hullY - 0.72) - hullH * 0.05;
    const grille = new THREE.Mesh(new THREE.BoxGeometry(w * 0.7, hullH * 0.55, 0.08), trim);
    grille.position.set(0, noseY, len * 0.5 - 0.03); grp.add(grille);
    [len * 0.5 + 0.02, -len * 0.5 - 0.02].forEach((bz) => {
      const bump = new THREE.Mesh(new THREE.BoxGeometry(w * 0.96, 0.18, 0.12), trim);
      bump.position.set(0, 0.78 + (hullY - 0.72) - hullH * 0.38, bz); grp.add(bump);
    });

    addWheels(grp, halfTrack, len * (bt === "van" ? 0.34 : 0.32), wheelR);
    addLights(grp, w, 0.78 + (hullY - 0.72) + hullH * 0.05, len * 0.5, -len * 0.5);
    grp.userData.bodyKind = bt;
    return grp;
  }

  function makeCar(x, z, heading, vertical, model, aggr) {
    const grp = buildCar(model);
    grp.position.set(x, 0, z); grp.rotation.y = heading;
    CBZ.city.arena.root.add(grp);
    const prof = vehicleProfile(model, grp.userData && grp.userData.bodyKind);
    const c = {
      group: grp, pos: grp.position, heading, vertical, model: model || null,
      v: 0, vx: 0, vz: 0, color: model ? model.color : 0x3c6fd6, stolen: false, player: false, ai: true,
      lane: 0, road: null, dirSign: 1, dead: false,
      driver: { aggr: aggr != null ? aggr : 0.3 },
      pullover: 0, ranRedCD: 0, turnCD: 1 + rng() * 2, npcWanted: 0, npcDriver: null, dwell: 0, stopT: 0,
      roadRageTarget: null, roadRageT: 0, playerHitCD: 0,
      _bk: grp.userData && grp.userData.bodyKind, mass: prof.mass, armor: prof.armor, repair: prof.repair,
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
  function crashBurst(x, z, speed, hard, catastrophic, dir) {
    if (CBZ.cityCrashFX) CBZ.cityCrashFX(x, z, { speed, hard, catastrophic, dir });
  }

  // ============================================================
  //  MULTI-STAGE VEHICLE DAMAGE  —  intact → dented → SMOKING → FIRE → EXPLODE
  //  Engine HP (100 → 0) is the master health. Crashes, gunfire and ramming
  //  chip it. Thresholds (per the GTA wisp→flame→fireball model):
  //    < 45  : SMOKING  (engine wisps, light grey)
  //    <= 15 : ON FIRE  (orange flames, ticking burn HP + driver damage)
  //    <= 0  : EXPLODE  (cityExplosion fireball, car removed)
  //  Visuals are a tiny pooled-sprite emitter LOCAL to this module (crashfx's
  //  puff pool is private), so it stays cheap: only burning/smoking cars emit,
  //  capped, distance-culled, and reusing one shared radial texture.
  // ============================================================
  const SMOKE_AT = 45, FIRE_AT = 15;
  // shared soft radial texture for all car smoke/flame sprites
  let _vfxTex = null;
  function vfxTex() {
    if (_vfxTex) return _vfxTex;
    const cv = document.createElement("canvas"); cv.width = cv.height = 48;
    const ctx = cv.getContext("2d"), r = 24, gr = ctx.createRadialGradient(r, r, 0, r, r, r);
    gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.4, "rgba(255,255,255,0.5)");
    gr.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = gr; ctx.fillRect(0, 0, 48, 48);
    _vfxTex = new THREE.Texture(cv); _vfxTex.needsUpdate = true; return _vfxTex;
  }
  const _vparts = [], _vpool = [];
  function getVPart(additive) {
    let p = _vpool.pop();
    if (!p) {
      const m = new THREE.SpriteMaterial({ map: vfxTex(), depthWrite: false, transparent: true, opacity: 0 });
      p = new THREE.Sprite(m); p.renderOrder = 9; CBZ.scene.add(p);
    }
    p.material.blending = additive ? THREE.AdditiveBlending : THREE.NormalBlending;
    p.visible = true; return p;
  }
  // emit one smoke / flame / tyre puff. type: "smoke" | "fire" | "tire"
  function spawnVPart(x, y, z, type) {
    if (_vparts.length > 140) return;             // hard cap — never flood the GPU
    const fire = type === "fire";
    const p = getVPart(fire);
    p.position.set(x, y, z);
    const base = type === "tire" ? 0.5 : (fire ? 0.7 : 0.9);
    p.scale.set(base, base, 1); p.material.opacity = 0;
    p.material.rotation = Math.random() * 6.28;
    _vparts.push({
      s: p, age: 0,
      life: type === "tire" ? 0.5 + Math.random() * 0.3 : (fire ? 0.45 + Math.random() * 0.35 : 1.1 + Math.random() * 0.7),
      base, pop: type === "tire" ? 1.4 : (fire ? 2.0 + Math.random() : 2.6 + Math.random() * 1.4),
      vy: type === "tire" ? 0.2 : (fire ? 2.2 + Math.random() * 1.4 : 1.3 + Math.random() * 0.8),
      vx: (Math.random() - 0.5) * (fire ? 0.5 : 1.0), vz: (Math.random() - 0.5) * (fire ? 0.5 : 1.0),
      type, maxOp: type === "tire" ? 0.32 : (fire ? 0.95 : 0.42),
    });
  }
  function emitTireSmoke(car) {
    const a = car.heading, hx = Math.sin(a), hz = Math.cos(a), sx = Math.cos(a), sz = -Math.sin(a);
    const side = Math.random() < 0.5 ? 1 : -1;
    spawnVPart(car.pos.x - hx * 1.3 + sx * side * 0.95, 0.3, car.pos.z - hz * 1.3 + sz * side * 0.95, "tire");
  }
  // per-frame: float + fade every live car particle. Cheap; runs only when any exist.
  CBZ.onAlways(9.6, function (dt) {
    if (g.mode !== "city" || !_vparts.length) return;
    for (let i = _vparts.length - 1; i >= 0; i--) {
      const p = _vparts[i]; p.age += dt;
      const t = p.age / p.life;
      if (t >= 1) { p.s.visible = false; _vpool.push(p.s); _vparts.splice(i, 1); continue; }
      const sc = p.base + (p.pop - p.base) * (1 - (1 - t) * (1 - t));
      p.s.scale.set(sc, sc, 1);
      p.s.position.x += p.vx * dt; p.s.position.y += p.vy * dt; p.s.position.z += p.vz * dt;
      p.s.material.opacity = (t < 0.12 ? t / 0.12 : 1 - (t - 0.12) / 0.88) * p.maxOp;
      const col = p.s.material.color;
      if (p.type === "fire") {
        // white-hot → orange → dark over the puff's short life
        col.setRGB(1, 0.85 - t * 0.55, 0.25 - t * 0.22);
      } else col.setRGB(0.22 - (p.type === "tire" ? 0 : 0.05), 0.21, 0.2);  // grey-ish smoke
    }
  });

  // apply mechanical damage to a car's engine. fromGun/explosion may ignite or
  // pop it instantly at high amounts; crashes feed in here too.
  function damageEngine(car, amount, fromGun) {
    if (!car || car.dead) return;
    if (car.engineHp == null) car.engineHp = 100;
    const armor = Math.max(0, Math.min(0.35, car.armor || 0));
    amount *= Math.max(0.55, 1 - armor * (fromGun ? 1.25 : 0.85));
    car.engineHp = Math.max(-50, car.engineHp - amount);
    if (car.engineHp <= 0 && !car._exploded) { explodeCar(car); return; }
    if (car.engineHp <= FIRE_AT && !car._onFire) igniteCar(car);
    if (fromGun && car.engineHp <= SMOKE_AT) car._smoking = true;
  }
  function igniteCar(car) {
    if (car._onFire || car.dead || car._exploded) return;
    car._onFire = true; car._smoking = true;
    // a FUSE: a burning car cooks off in a few seconds (sooner the more it's hurt)
    car._fuse = 2.4 + Math.random() * 2.2;
    if (CBZ.city && (car.player || nearCam(car, 60))) CBZ.city.note("🔥 The car's on fire — bail out!", 1.1);
  }
  function explodeCar(car) {
    if (car._exploded) return;
    car._exploded = true; car.dead = true; car._onFire = false; car._smoking = false;
    const x = car.pos.x, z = car.pos.z;
    if (car.npcDriver) killNpcDriverInCar(car);
    if (CBZ.cityExplosion) CBZ.cityExplosion(x, z, { power: 1.15, radius: 6.5, byPlayer: !!(car._burnByPlayer || car.player) });
    // if the PLAYER was still inside, the blast handles their damage; eject them
    if (car.player && CBZ.player.driving) { CBZ.cityExitVehicle(); }
    // remove the wreck mesh now; DEFER the array splice to the reaper so we never
    // mutate cityCars mid-iteration (explodeCar fires from inside the AI loop).
    if (car.group && car.group.parent) car.group.parent.remove(car.group);
    if (car.group) car.group.traverse(function (o) {
      if (o.geometry && !o.geometry._shared && o.geometry.dispose) o.geometry.dispose();
      if (o.material && !o.material._shared && o.material.dispose) o.material.dispose();
    });
    car._reap = true;
  }
  // damage-stage tick for EVERY non-player car (smoke/fire/explode progresses
  // for ambient + abandoned wrecks too, independent of the AI lane logic), then
  // reap exploded wrecks — AFTER every per-car pass has finished this frame so we
  // never mutate cityCars mid-iteration.
  CBZ.onUpdate(38, function (dt) {
    if (g.mode !== "city") return;
    const cars = CBZ.cityCars;
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i];
      if (c.player || c.dead || c.engineHp == null) continue;
      tickDamageStage(c, dt);
    }
    for (let i = cars.length - 1; i >= 0; i--) if (cars[i]._reap) cars.splice(i, 1);
  });
  function nearCam(car, r) {
    const cm = CBZ.camera.position, dx = car.pos.x - cm.x, dz = car.pos.z - cm.z;
    return dx * dx + dz * dz < r * r;
  }
  // run the smoke/fire/explosion lifecycle for ONE car for this frame. Called for
  // the player's car (every frame) and for AI cars (time-sliced in the AI loop).
  function tickDamageStage(car, dt) {
    if (car.dead || car._exploded) return;
    if (car.engineHp == null) return;          // never damaged → nothing to do
    const visible = car.player || nearCam(car, 95);
    // SMOKING — engine wisps once the motor's hurt
    if (car._smoking || car.engineHp < SMOKE_AT) {
      car._smoking = true;
      if (visible) {
        car._smkT = (car._smkT || 0) + dt;
        const rate = car._onFire ? 0.05 : 0.16;   // fire smokes harder
        if (car._smkT > rate) {
          car._smkT = 0;
          const a = car.heading, hx = Math.sin(a) * 1.7, hz = Math.cos(a) * 1.7;
          spawnVPart(car.pos.x + hx + (Math.random() - 0.5) * 0.6, 1.1, car.pos.z + hz + (Math.random() - 0.5) * 0.6, "smoke");
        }
      }
    }
    // ON FIRE — flames off the hood + a ticking burn that finishes the engine,
    // hurts the driver, and finally cooks off into the explosion.
    if (car._onFire) {
      car._burnByPlayer = car._burnByPlayer || car.player;
      car._fuse -= dt;
      // burn keeps eating the engine so even a parked burning car eventually blows
      car.engineHp -= 7 * dt;
      if (visible) {
        car._fireT = (car._fireT || 0) + dt;
        if (car._fireT > 0.06) {
          car._fireT = 0;
          const a = car.heading, hx = Math.sin(a) * 1.7, hz = Math.cos(a) * 1.7;
          spawnVPart(car.pos.x + hx + (Math.random() - 0.5) * 0.7, 1.0, car.pos.z + hz + (Math.random() - 0.5) * 0.7, "fire");
        }
      }
      // tick damage to whoever's inside while it burns
      if (car.player && CBZ.cityHurtPlayer) {
        car._burnTickCD = (car._burnTickCD || 0) - dt;
        if (car._burnTickCD <= 0) { car._burnTickCD = 0.5; CBZ.cityHurtPlayer(6, car.pos.x, car.pos.z, "burned in the car", false, null, true); if (CBZ.player.dead) return; }
      }
      if (car._fuse <= 0 || car.engineHp <= 0) { explodeCar(car); return; }
    }
  }

  // ---- PUBLIC: take damage from bullets / explosions elsewhere (combat, cops).
  //      amount is in engine-HP points; opts.byPlayer attributes the kill. A
  //      direct hit on an already-smoking car can light it; big hits pop it. ----
  CBZ.cityDamageCar = function (car, amount, opts) {
    if (!car || car.dead) return;
    opts = opts || {};
    if (opts.byPlayer) car._burnByPlayer = true;
    if (car.engineHp == null) car.engineHp = 100;
    // tracer hits also visibly spark/dent the hull a touch
    if (opts.crumple) crumpleCar(car, Math.min(0.2, amount * 0.004));
    damageEngine(car, amount, true);
  };
  // PUBLIC: force a car to catch fire now (e.g. molotov, fuel-line shot)
  CBZ.cityCarIgnite = function (car, byPlayer) {
    if (!car || car.dead) return;
    if (car.engineHp == null || car.engineHp > FIRE_AT) car.engineHp = FIRE_AT;
    if (byPlayer) car._burnByPlayer = true;
    igniteCar(car);
  };
  // PUBLIC: read damage stage for HUD/minimap. 0 intact,1 dented,2 smoke,3 fire
  CBZ.cityCarStage = function (car) {
    if (!car || car.engineHp == null) return (car && car.crumple > 0.25) ? 1 : 0;
    if (car._onFire) return 3;
    if (car.engineHp < SMOKE_AT) return 2;
    return car.crumple > 0.25 ? 1 : 0;
  };
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
      car._pitch = car._roll = 0;
      if (car.group) car.group.rotation.set(0, car.heading, 0);   // drop the weight-transfer lean
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

  // ---- per-car DYNAMICS, derived from the model + how wrecked it is ---------
  // GTA-style arcade handling: a body type sets the base feel (a coupe darts,
  // an SUV/pickup is heavy & numb), the model's rarity (s) scales top speed +
  // grunt, and accumulated DAMAGE (engine HP) eats accel/grip/top-speed and
  // adds a bent-axle pull so a beat-up car drives like a beat-up car.
  function bodyKind(car) {
    if (car._bk) return car._bk;
    car._bk = modelBodyKind(car.model); return car._bk;
  }
  // 0 = pristine, 1 = totalled. engineHp starts at 100 and only falls.
  function carDmg(car) { return 1 - Math.max(0, Math.min(100, car.engineHp == null ? 100 : car.engineHp)) / 100; }
  function vehicleCondition(car) {
    const engine = Math.max(0, Math.min(100, !car || car.engineHp == null ? 100 : car.engineHp));
    const cr = Math.max(0, Math.min(1, (car && car.crumple) || 0));
    const burn = car && car._onFire ? 0.35 : 0;
    const pct = Math.max(0, Math.min(1, engine / 100 - cr * 0.35 - burn));
    const label = car && car._onFire ? "on fire"
      : pct > 0.82 ? "clean"
      : pct > 0.62 ? "dented"
      : pct > 0.38 ? "wrecked"
      : pct > 0.12 ? "barely running"
      : "totaled";
    const valueMul = Math.max(0.12, 0.42 + pct * 0.68 - cr * 0.22);
    return { pct, label, valueMul, engine, crumple: cr };
  }
  CBZ.cityVehicleCondition = vehicleCondition;
  function carDynamics(car) {
    const bk = bodyKind(car);
    const s = car.model ? car.model.s : 1;
    // base profile per body type: [accel, topSpeed, turn, grip, brake]. Tuned from
    // GTA vehicle-class feel — super/sports grip + accel high, muscle grunty but
    // loose-tailed, SUV/van/pickup heavy & numb with weaker brakes.
    let accel = 30, top = 33, turn = 2.5, grip = 7.0, brake = 30;
    if (bk === "coupe") { accel = 42; top = 44; turn = 3.0; grip = 9.4; brake = 38; }
    else if (bk === "muscle") { accel = 40; top = 41; turn = 2.45; grip = 6.6; brake = 30; }   // fast in a line, tail steps out
    else if (bk === "sedan") { accel = 32; top = 35; turn = 2.6; grip = 7.4; brake = 32; }
    else if (bk === "suv") { accel = 26; top = 31; turn = 2.1; grip = 5.6; brake = 27; }
    else if (bk === "pickup") { accel = 27; top = 32; turn = 2.0; grip = 5.2; brake = 26; }
    else if (bk === "van") { accel = 23; top = 29; turn = 1.85; grip = 4.8; brake = 24; }
    // rarer/sportier models (higher s) get more grunt + a higher top end
    const sm = 0.82 + s * 0.26;
    top *= sm; accel *= (0.9 + s * 0.18);
    // the promoted player-car STYLE layers its GTA-class feel on top (a Veyron
    // grips and rockets, a van wallows) so swapping style ([C]) actually drives
    // differently — published by playercars.js as car._playerCarFeel.
    const feel = car.player ? car._playerCarFeel : null;
    let roll = 0.6, drift = 1.0;
    if (feel) {
      accel *= feel.accel; top *= feel.top; turn *= feel.turn; grip *= feel.grip; brake *= feel.brake;
      roll = feel.roll == null ? 0.6 : feel.roll; drift = feel.drift == null ? 1.0 : feel.drift;
      if (feel.twoWheel) roll = 0;   // a bike leans via its own rider rig, not whole-body roll
    } else {
      if (bk === "coupe") { roll = 0.4; drift = 0.9; }
      else if (bk === "muscle") { roll = 0.7; drift = 1.35; }
      else if (bk === "suv") { roll = 1.1; drift = 1.05; }
      else if (bk === "pickup") { roll = 1.0; drift = 1.05; }
      else if (bk === "van") { roll = 1.3; drift = 1.1; }
    }
    // DAMAGE degrades it: a smoking/burning car is gutless and squirrelly
    const d = carDmg(car);
    accel *= 1 - d * 0.55; top *= 1 - d * 0.42; grip *= 1 - d * 0.5; turn *= 1 - d * 0.28;
    return { accel, top, turn, grip, brake, dmg: d, roll, drift };
  }

  // ---- player driving (order 11) ----
  CBZ.onUpdate(11, function (dt) {
    if (g.mode !== "city") return;
    const P = CBZ.player;
    if (!P.driving || !P._vehicle || P.dead) return;
    const car = P._vehicle, k = CBZ.keys;
    const D = carDynamics(car);
    const ACCEL = D.accel, MAXV = D.top, REV = 13, TURN = D.turn;
    // ---- throttle / braking ----
    let throttle = 0;
    if (k["w"]) throttle += 1;
    if (k["s"]) throttle -= 1;
    const handbrake = !!k[" "];   // SPACE = handbrake → break grip and DRIFT
    if (throttle > 0) {
      if (car.v < 0) car.v += D.brake * dt;           // brake out of reverse first
      else car.v += ACCEL * dt * (1 - Math.min(0.7, car.v / MAXV));   // accel tapers near top end
    } else if (throttle < 0) {
      if (car.v > 0.5) car.v -= D.brake * dt;         // S brakes hard when rolling forward
      else car.v -= (ACCEL * 0.55) * dt;              // then backs up
    }
    if (throttle === 0) car.v *= Math.pow(0.5, dt);   // engine braking / coast-down
    if (handbrake) car.v *= Math.pow(0.34, dt);       // handbrake bleeds forward speed
    car.v = Math.max(-REV, Math.min(MAXV, car.v));
    // ---- steering: speed-sensitive (twitchy off the line, planted at speed),
    //      a bent-axle PULL when badly damaged, extra rotation while drifting ----
    let steer = 0;
    if (k["a"]) steer += 1;
    if (k["d"]) steer -= 1;
    const vmag = Math.abs(car.v);
    const steerAuthority = vmag > 0.3 ? Math.min(1, 0.45 + vmag / 14) * (1 - Math.min(0.5, vmag / MAXV * 0.5)) : 0;
    if (vmag > 0.3) {
      car.heading += steer * TURN * dt * Math.sign(car.v) * steerAuthority * (handbrake ? 1.5 : 1);
      if (D.dmg > 0.45) {                              // damaged axle drags the nose to one side
        if (car._pull == null) car._pull = (car._cside || 1) * (0.18 + Math.random() * 0.12);
        car.heading += car._pull * (D.dmg - 0.45) * dt * Math.min(1, vmag / 8);
      }
    }
    // ---- GRIP model: split the PREVIOUS velocity into forward + lateral
    //      (relative to the now-steered heading), bleed the lateral slip down by
    //      grip, then rebuild velocity = engine-forward + the surviving slip. Low
    //      grip (handbrake / a steered hard turn / a worn car) lets the rear step
    //      out and the car holds a power-slide instead of running on rails. ----
    const fwdX = Math.sin(car.heading), fwdZ = Math.cos(car.heading);
    const prevX = car.vx == null ? fwdX * car.v : car.vx;
    const prevZ = car.vz == null ? fwdZ * car.v : car.vz;
    const latDot = prevX * fwdX + prevZ * fwdZ;        // forward component of old vel
    let latX = prevX - fwdX * latDot, latZ = prevZ - fwdZ * latDot;   // sideways slip
    // grip = how fast lateral slip decays. handbrake / power-steer keeps it alive.
    // loose-tailed cars (muscle, van — D.drift>1) let the rear step out sooner; a
    // grippy super (D.drift<1) stays planted. throttle-on in a hard turn also
    // breaks traction a touch (power-oversteer) so muscle cars feel rowdy.
    const driftMul = D.drift || 1;
    const power = throttle > 0 && vmag > 10 ? 1.4 * driftMul : 0;
    const gripFactor = handbrake ? 1.0 : Math.max(0.5, (D.grip + (steer && vmag > 8 ? -2.4 * driftMul : 0) - power));
    const latKeep = handbrake ? Math.min(0.95, 0.9 + driftMul * 0.02) : Math.max(0, 1 - gripFactor * dt);
    latX *= latKeep; latZ *= latKeep;
    const velX = fwdX * car.v + latX, velZ = fwdZ * car.v + latZ;
    const slip = Math.hypot(latX, latZ);
    car._drift = slip;
    if (slip > 2.4 && vmag > 6) {                      // tyre smoke off the rears
      car._tireT = (car._tireT || 0) + dt;
      if (car._tireT > 0.1) { car._tireT = 0; emitTireSmoke(car); }
    }
    // ---- WEIGHT TRANSFER (visual game-feel): the body PITCHES (squat on
    //      throttle, dive on brake) and ROLLS into a turn, eased so it reads as
    //      mass shifting. softer cars (high D.roll) lean more. Touches only the
    //      group rotation x/z, which the crash crumple leaves alone. ----
    const accelG = throttle > 0 ? -1 : (throttle < 0 && car.v > 0.5 ? 1.3 : 0);
    const pitchTarget = Math.max(-0.07, Math.min(0.09, accelG * 0.05 * Math.min(1, vmag / 14)));
    // body leans OUTWARD of the turn: steering at speed plus any tail-out slip.
    const latG = steer * Math.min(1, vmag / 12) + (latX * fwdZ - latZ * fwdX) * 0.16;
    const rollTarget = Math.max(-0.16, Math.min(0.16, latG * 0.06 * (D.roll || 0.6)));
    car._pitch = (car._pitch || 0) + (pitchTarget - (car._pitch || 0)) * Math.min(1, dt * 7);
    car._roll = (car._roll || 0) + (rollTarget - (car._roll || 0)) * Math.min(1, dt * 6);
    car.vx = velX; car.vz = velZ;
    car.pos.x += velX * dt; car.pos.z += velZ * dt;
    const before = { x: car.pos.x, z: car.pos.z };
    if (CBZ.collide) CBZ.collide(car.pos, CAR_R);
    const moved = Math.hypot(car.pos.x - before.x, car.pos.z - before.z);
    if (moved > 0.05 && vmag > 5) {
      // CRASH — far cooler at speed: the car PILES INTO the wall, sheds nearly all
      // its forward momentum but RICOCHETS back along the surface (keeps a chunk of
      // the slide so it slews sideways instead of dead-stopping), spins out, jolts
      // the driver, throws a big speed-scaled shake + hitstop, a metal crunch, and
      // shatters / drives through any storefront glass ahead.
      const hard = vmag >= CRASH.wallHard, catastrophic = vmag >= CRASH.wallCatastrophic;
      // approximate the wall normal from how the collider pushed the car back
      let nwx = before.x - car.pos.x, nwz = before.z - car.pos.z;
      const nl = Math.hypot(nwx, nwz) || 1; nwx /= nl; nwz /= nl;
      car.v *= catastrophic ? 0.05 : (hard ? 0.14 : 0.48);
      // momentum transfer into the wall: bleed the velocity, reflect a little of it
      // back off the surface so the hull slews + scrubs rather than freezing.
      const bounce = catastrophic ? 0.12 : (hard ? 0.2 : 0.35);
      const vdotn = car.vx * nwx + car.vz * nwz;
      car.vx = (car.vx - 2 * vdotn * nwx) * bounce; car.vz = (car.vz - 2 * vdotn * nwz) * bounce;
      // the impact ALSO guts the engine — enough hard hits → smoke → fire → boom
      damageEngine(car, catastrophic ? 60 : (hard ? 28 : 6), false);
      const back = Math.min(catastrophic ? 2.2 : 1.35, vmag * (catastrophic ? 0.075 : 0.05));
      car.pos.x += nwx * back; car.pos.z += nwz * back;
      // a glancing hit SPINS the car off the wall toward the surface tangent; a
      // square hit just shudders. scaled by speed so a fast clip whips it around.
      const tang = car.vx * -nwz + car.vz * nwx;     // sideways component along the wall
      const spinKick = Math.sign(tang || (Math.random() - 0.5)) * Math.min(catastrophic ? 2.0 : 1.1, vmag * (catastrophic ? 0.08 : 0.05));
      car.heading += spinKick + (Math.random() - 0.5) * (catastrophic ? 0.5 : 0.2);
      // JOLT the driver: a sharp camera punch back from the impact (weighty stop)
      if (CBZ.cam) { CBZ.cam.pitch = (CBZ.cam.pitch || 0) - Math.min(0.25, vmag * 0.012); }
      if (CBZ.shake) CBZ.shake(catastrophic ? 2.4 : (hard ? 1.3 : 0.34));
      if (CBZ.doHitstop) CBZ.doHitstop(catastrophic ? 0.16 : (hard ? 0.085 : 0.028));
      if (catastrophic && CBZ.doSlowmo) CBZ.doSlowmo(0.34);
      if (CBZ.sfx) { CBZ.sfx(hard ? "ko" : "clank"); if (hard) CBZ.sfx("punch"); }
      const ix = car.pos.x + Math.sin(car.heading) * 2.2, iz = car.pos.z + Math.cos(car.heading) * 2.2;
      crashBurst(ix, iz, vmag, hard, catastrophic, { x: -nwx, z: -nwz });   // debris sprays into the wall
      if (hard && CBZ.cityShatter) CBZ.cityShatter(ix, iz, catastrophic ? 10 : 6);
      if (CBZ.cityRankEvent) CBZ.cityRankEvent("crash", { speed: vmag, hard, catastrophic, wall: true, car });
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
    car.group.rotation.set(car._pitch || 0, car.heading, car._roll || 0);   // y=heading, x/z = weight-transfer lean
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
    // multi-stage damage: smoke → fire → explode (ticking burn under the player)
    tickDamageStage(car, dt);
  });

  // ---- SOLID car-vs-car collision + crashes (every car pair, once a frame).
  //      Cars can no longer phase through each other; a fast impact WRECKS the
  //      AI cars (spin off-rails, smoke, lose control) and dramatically shakes
  //      the screen. The player keeps the wheel but loses most of their speed. ----
  function carVel(car) {
    if (car && Number.isFinite(car.vx) && Number.isFinite(car.vz) && (Math.abs(car.vx) + Math.abs(car.vz)) > 0.01) {
      return { x: car.vx, z: car.vz };
    }
    const v = car ? car.v || 0 : 0, h = car ? car.heading || 0 : 0;
    return { x: Math.sin(h) * v, z: Math.cos(h) * v };
  }
  function wreckCar(c, speed, dir, rammer) {
    const hard = speed >= CRASH.carHard, catastrophic = speed >= CRASH.carCatastrophic;
    if (c.player) {
      // the player keeps the wheel and PLOWS through, not a dead stop — but a
      // ram still scrubs real speed (more if you were the one struck) and slews
      // the slide so a side-impact knocks you off your line, plus a driver jolt.
      const keep = rammer ? (catastrophic ? 0.42 : (hard ? 0.62 : 0.74)) : (catastrophic ? 0.24 : (hard ? 0.46 : 0.62));
      c.v *= keep;
      if (c.vx != null) { c.vx *= keep; c.vz *= keep; }
      if (!rammer && hard && CBZ.cam) CBZ.cam.pitch = (CBZ.cam.pitch || 0) - Math.min(0.18, speed * 0.008);
      return;
    }
    c.wreckT = Math.max(c.wreckT || 0, catastrophic ? 2.8 : (hard ? 1.8 : 0.72));
    c.v *= catastrophic ? 0.07 : (hard ? 0.16 : 0.56);
    // spin scales with impact + the struck side: a T-bone whips the car around,
    // a glancing tap just nudges it — heavier on the car that got rammed.
    const spinMag = (rammer ? 0.55 : 1) * Math.min(catastrophic ? 9 : 6, speed * 0.45);
    c.spin = (c.spin || 0) + (Math.random() - 0.5) * spinMag + dir * Math.min(catastrophic ? 4.5 : 2.8, speed * 0.15);
    c.pullover = 0; c.turning = false;     // abandon whatever it was doing
  }
  function carCrash(a, b, speed, nx, nz) {
    const hard = speed >= CRASH.carHard, catastrophic = speed >= CRASH.carCatastrophic;
    a._crashCD = 0.6; b._crashCD = 0.6;
    // ASYMMETRIC damage: whoever's going faster (the rammer) deals more than they
    // take — the struck car crumples HARD and gets shoved away with momentum, so
    // ramming actually wrecks the other car instead of a soft bounce.
    const av = carVel(a), bv = carVel(b);
    const aSpeed = Math.hypot(av.x, av.z), bSpeed = Math.hypot(bv.x, bv.z);
    const aRammer = a.player || (aSpeed >= bSpeed);
    wreckCar(a, speed, -1, aRammer); wreckCar(b, speed, 1, !aRammer);
    const am = Math.max(0.6, a.mass || 1), bm = Math.max(0.6, b.mass || 1);
    const massAvg = Math.max(0.8, Math.min(1.65, (am + bm) * 0.5));
    const heavy = (catastrophic ? 0.92 : (hard ? 0.62 : 0.26)) * massAvg;
    const light = (catastrophic ? 0.6 : (hard ? 0.34 : 0.12)) * massAvg;
    crumpleCar(a, aRammer ? light : heavy); crumpleCar(b, aRammer ? heavy : light);
    // engine HP: a collision guts the motor; the rammed car takes the worst of it,
    // so repeated rams build a struck car toward smoking → fire → blowing up. (The
    // catastrophic path below already fireballs both, so only feed the lighter hits.)
    if (!catastrophic) {
      const eHeavy = hard ? 30 : 9, eLight = hard ? 16 : 4;
      damageEngine(a, (aRammer ? eLight : eHeavy) * (b.mass || 1), false);
      damageEngine(b, (aRammer ? eHeavy : eLight) * (a.mass || 1), false);
      if ((a.player || b.player)) { if (a.player) a._burnByPlayer = true; if (b.player) b._burnByPlayer = true; }
    }
    // MOMENTUM TRANSFER: the shove on each car is scaled by the OTHER car's mass
    // (a heavy SUV launches a light coupe; the coupe barely budges the SUV) so the
    // exchange reads with real weight. The struck car gets flung off with speed +
    // a fresh heading down the contact normal; both get a positional kick apart.
    const kick = Math.min(catastrophic ? 3.6 : 2.4, speed * (catastrophic ? 0.12 : 0.09));
    const shove = Math.min(catastrophic ? 16 : 10, speed * 0.62);
    const aMassFac = Math.max(0.5, Math.min(1.8, bm / am));   // how hard A is shoved (by B's mass)
    const bMassFac = Math.max(0.5, Math.min(1.8, am / bm));
    if (!a.player) { a.pos.x -= nx * kick * aMassFac; a.pos.z -= nz * kick * aMassFac; if (!aRammer) { a.v = Math.max(Math.abs(a.v || 0), shove * aMassFac); a.heading = Math.atan2(-nx, -nz); a.wreckT = Math.max(a.wreckT || 0, 1.2); } }
    if (!b.player) { b.pos.x += nx * kick * bMassFac; b.pos.z += nz * kick * bMassFac; if (aRammer) { b.v = Math.max(Math.abs(b.v || 0), shove * bMassFac); b.heading = Math.atan2(nx, nz); b.wreckT = Math.max(b.wreckT || 0, 1.2); } }
    // the player car gets a positional nudge + shake-jolt too so a wreck reads
    if (a.player) { a.pos.x -= nx * kick * 0.4 * aMassFac; a.pos.z -= nz * kick * 0.4 * aMassFac; }
    if (b.player) { b.pos.x += nx * kick * 0.4 * bMassFac; b.pos.z += nz * kick * 0.4 * bMassFac; }
    const cx = (a.pos.x + b.pos.x) / 2, cz = (a.pos.z + b.pos.z) / 2;
    const cam = CBZ.camera.position, cd2 = (cx - cam.x) * (cx - cam.x) + (cz - cam.z) * (cz - cam.z);
    if (a.player || b.player || cd2 < 75 * 75) {
      if (a.player || b.player) {
        const playerCar = a.player ? a : b;
        playerCar.lastCrashScore = Math.max(playerCar.lastCrashScore || 0, Math.round(speed * massAvg));
        if (CBZ.cityRankEvent) CBZ.cityRankEvent("crash", { speed, hard, catastrophic, carA: a, carB: b });
      }
      crashBurst(cx, cz, speed, hard, catastrophic, { x: nx, z: nz });
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
        const am = Math.max(0.6, a.mass || 1), bm = Math.max(0.6, b.mass || 1), tm = am + bm;
        const aw = a.player ? 0.24 : Math.max(0.24, Math.min(0.74, bm / tm));
        const bw = b.player ? 0.24 : Math.max(0.24, Math.min(0.74, am / tm));
        a.pos.x -= nx * overlap * aw; a.pos.z -= nz * overlap * aw;
        b.pos.x += nx * overlap * bw; b.pos.z += nz * overlap * bw;
        // closing speed along the contact normal
        const va = carVel(a), vb = carVel(b);
        const rel = (va.x - vb.x) * nx + (va.z - vb.z) * nz;
        const closing = Math.abs(rel);
        if (closing > 2 && a._crashCD <= 0 && b._crashCD <= 0) carCrash(a, b, closing, rel >= 0 ? nx : -nx, rel >= 0 ? nz : -nz);
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
    const cond = vehicleCondition(car);
    const pay = Math.round(base * frac * cond.valueMul);
    CBZ.cityExitVehicle();
    if (car.group && car.group.parent) car.group.parent.remove(car.group);
    const idx = CBZ.cityCars.indexOf(car); if (idx >= 0) CBZ.cityCars.splice(idx, 1);
    CBZ.city.addCash(pay); CBZ.city.addRespect(2);
    CBZ.city.big("CHOPPED " + (car.model ? car.model.name : "car") + " + $" + pay.toLocaleString());
    CBZ.city.note("Condition: " + cond.label + " · payout adjusted", 1.5);
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
          damageEngine(c, catastrophic ? 55 : (hard ? 26 : 8), false);
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
  CBZ.cityVehiclesReset = function () {
    npcDrivers = 0;
    // retire any live smoke/flame sprites to the pool so a reset starts clean
    for (let i = _vparts.length - 1; i >= 0; i--) { _vparts[i].s.visible = false; _vpool.push(_vparts[i].s); }
    _vparts.length = 0;
  };
  // let police flag a car for a stop
  CBZ.cityCarPullover = function (c) { if (c && !c.player && c.pullover === 0) c.pullover = 1; };
})();
