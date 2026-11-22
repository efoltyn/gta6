/* ============================================================
   world/prisonoutside.js — OUT OF THE WIRE IS NOT OUT.

   OWNER (2026-11-22): "once you get out of jail there's a huge field and
   then another outsider wall but the outside wall you can't even see it's so
   far so stealing a car in parking lot becomes even more needed and also the
   current exit from the White House in gang city is a good outer exit for
   prison". And: "other prison people should want to run out when doors open
   too".

   WHAT THIS FILE OWNS
     1. THE COUNTRY. The open field between the compound's wire
        (CBZ.WORLD.wings) and the outer perimeter (CBZ.WORLD.outer), 1.1 to
        1.25 km off every side, beyond the prison's 360 m fog: from the wire
        you see grass to the haze and nothing else. The grass itself is
        world/ground.js's one sheet, which now runs past the outer wall.
     2. THE ROADS AND THE STAFF LOT. A spine road from the main sally port
        (GATE 3) south to the outer gate, a staff lot east of GATE 4 with a
        lane into it, and the service road from the vehicle sally port in the
        north wall round the east side to the lot.
     3. THE CARS. Real Gang City vehicles (city/vehicles.js cityAddParkedCar,
        the same records the island parks: config.js CBZ.VEHICLE_MODES now
        lists "escape"), parked nose-in on the lot's bays, enterable with the
        Drive pill and driven on the real chassis. A staff car is anybody's
        once you are at its door (no keys system exists for parked cars).
     4. THE OUTER WALL AND ITS GATE. The Executive Mansion's own kit
        (city/govcomplex.js CBZ.govGateKit): the masonry perimeter with a
        24 m gap on the south side, the walk-in gate booth, and the working
        checkpoint (planter, drop arm, anti-ram bollards, magnetometer arch,
        X-ray belt, sentry kiosk). Two officers stand it.
     5. THE BREAK AND THE WIN. systems/interactions.js no longer ends the run
        at the sally port, the culvert mouth or over the wall: it calls
        breakout() here, which marks you OUT and lets the run go on. The run
        is won past the outer gate's line (or anywhere past the outer wall).
     6. THE GATE'S MIND. Calm, the drop arm lifts for a car that comes up to
        it slowly from inside (staff cars come and go), and a car that hits
        it hard snaps it. A count that finds you gone puts the gate on
        notice (no more waving cars through); once the alarm is up (you were
        seen, or the search was called off as an escape and the prison
        locked down) the bollards rise across the vehicle lane and stay up:
        from then on the way out is on foot, through the arch, past the two
        officers, who hold the gate instead of joining the hunt.
     7. THE WAYS OUT, FOR EVERYONE. The three sally ports' inner doors are
        the ways out of the compound. When one comes open (the Gate Key, a
        charge), the men near it are asked, on that edge and not per frame,
        whether they go: entities/ai.js's considerRun decides from the man's
        own nerve, guts, whether a screw is watching, whether his crew went
        and how many have made it. The ones who go run through the port,
        across the field and out of the outer gate's arch, and are removed
        only past the gate and out of sight.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE || !CBZ.WORLD) return;
  const THREE = window.THREE;
  const g = CBZ.game;
  const W = CBZ.WORLD;
  const OUT = W.outer || { x0: -1250, x1: 1250, z0: -1250, z1: 1380, gateX: 0 };
  const WIRE = W.wings || { x0: -124, x1: 124, z0: -116, z1: 128 };
  const EZ = (W.exit && W.exit.z) || 128;          // the south wire line, where the ports stand
  const GX = (OUT.x0 + OUT.x1) / 2;                // the perimeter kit centres its gate on its side
  const GZ = OUT.z1;                               // the outer gate's line; inside is -Z
  const LOT = { x0: 64, x1: 120, z0: 150, z1: 170 };
  const LANE_Z = (LOT.z0 + LOT.z1) / 2;            // the lot's aisle, and the lane into it
  const SPINE_W = 8, LANE_W = 7;
  const ARCH_DX = 8.4;                             // the checkpoint's walk-through arch, off the gate centre
  const PHONE = (CBZ.deviceClass || "") === "phone";
  // the prison's own haze (core/scene.js's at boot): the outer wall is
  // three times past it from anywhere on the wire
  const FOG_NEAR = 95, FOG_FAR = 360;

  // a staff lot's fleet: the catalogue names the island town parks
  // (city/economy.js), one per body kind, so the instanced pools stay a
  // handful of draws
  const MODELS = ["Bison Vista", "Kotori Sprout", "Bison Frontier", "Bison Rampart"];
  const PAINT = [0x2b2f36, 0x8a8f96, 0xd9d9d4, 0x30425a, 0x5b2a26, 0x3d4a3a];
  const BAY_W = 2.7, BAY_D = 5.5;

  const S = {
    built: false,
    gate: null,             // the checkpoint record (govcomplex G)
    posts: [],              // its officers' posts
    spots: [],              // every parked-car spot
    cars: [],               // { car, spot }
    queue: [],              // spots still to stand a car on
    buildT: 0,
    armCar: null,
    out: false, outAt: 0, how: null, seen: false,
    alarm: false,
    armBroken: false, armPassT: 0,
    lastElapsed: -1,
    ways: [], beatT: 0,
    officers: [],           // the two who stand the gate (entities/guards.js records)
  };

  function hash01(x, z, salt) {
    let h = (Math.floor(x * 7.31) * 73856093) ^ (Math.floor(z * 3.17) * 19349663) ^ (salt * 83492791);
    h = (h ^ (h >>> 13)) * 1274126177;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  function playing() { return !!(g && g.mode === "escape" && g.state === "playing"); }

  /* ==========================================================
     THE BUILD (a prison builder: it runs when the jail is first needed)
     ========================================================== */
  CBZ.definePrison("world/prisonoutside.js", function () {
    const K = CBZ.prisonKit;
    const GK = CBZ.govGateKit;
    const ROOT = CBZ.prisonRoot || CBZ.scene;
    if (!K) return;

    // the cars' own group: dynamic, so the prison's one-time static batch
    // never bakes a car that will drive away
    const carRoot = new THREE.Group();
    carRoot.name = "prison-staff-cars";
    carRoot.userData.dynamic = true;
    ROOT.add(carRoot);
    CBZ.prisonCarRoot = carRoot;

    // ---- 2. ROADS ---------------------------------------------------------
    const ROAD_Y = 0.02;
    const EDGE = 0xd8d2b8, CENTRE = 0xd6b85a;
    const spineZ0 = EZ + 11, spineZ1 = GZ + 60;       // from the port's apron to past the gate
    K.ground(GX, (spineZ0 + spineZ1) / 2, SPINE_W, spineZ1 - spineZ0, "asphalt", { y: ROAD_Y });
    for (const s of [-1, 1]) K.paint(GX + s * (SPINE_W / 2 - 0.3), (spineZ0 + spineZ1) / 2, 0.12, spineZ1 - spineZ0, EDGE);
    for (let z = spineZ0 + 6; z < spineZ1 - 4; z += 12) K.paint(GX, z, 0.12, 3.0, CENTRE);
    // the lane into the lot, off the spine
    const laneX0 = GX + SPINE_W / 2, laneX1 = LOT.x0;
    K.ground((laneX0 + laneX1) / 2, LANE_Z, laneX1 - laneX0, LANE_W, "asphalt", { y: ROAD_Y });
    for (const s of [-1, 1]) K.paint((laneX0 + laneX1) / 2, LANE_Z + s * (LANE_W / 2 - 0.3), laneX1 - laneX0, 0.12, EDGE);
    // the service road: out of the vehicle sally port in the north wall,
    // east round the compound and down to the lot's far side
    const VG = CBZ.prisonVehicleGate || { x0: 92, x1: 112, z: WIRE.z0 };
    const vx = (VG.x0 + VG.x1) / 2, SX = WIRE.x1 + 24, NZ = WIRE.z0 - 20;
    // (from the wall's outer face: inside it the patrol road is the ground)
    const nTop = VG.z - 0.5, nBot = NZ - LANE_W / 2;
    K.ground(vx, (nTop + nBot) / 2, LANE_W, nTop - nBot, "asphalt", { y: ROAD_Y });                                  // north out of the gate
    K.ground((vx + SX) / 2, NZ, SX - vx + LANE_W, LANE_W, "asphalt", { y: ROAD_Y - 0.004 });                          // east
    K.ground(SX, (NZ + LANE_Z) / 2, LANE_W, LANE_Z - NZ, "asphalt", { y: ROAD_Y - 0.008 });                            // south
    K.ground((LOT.x1 + SX) / 2, LANE_Z, SX - LOT.x1, LANE_W, "asphalt", { y: ROAD_Y - 0.004 });                       // west into the lot

    // ---- 2b. THE STAFF LOT ------------------------------------------------
    const lw = LOT.x1 - LOT.x0, ld = LOT.z1 - LOT.z0;
    K.ground((LOT.x0 + LOT.x1) / 2, (LOT.z0 + LOT.z1) / 2, lw, ld, "asphalt", { y: ROAD_Y + 0.004, a: "#4a4e53", b: "#44484d" });
    const nBays = Math.floor((lw - 2) / BAY_W);
    const bx0 = (LOT.x0 + LOT.x1) / 2 - nBays * BAY_W / 2;
    for (const row of [0, 1]) {
      const zc = row === 0 ? LOT.z0 + BAY_D / 2 : LOT.z1 - BAY_D / 2;
      for (let i = 0; i <= nBays; i++) K.paint(bx0 + i * BAY_W, zc, 0.12, BAY_D, 0xe9e9e4, ROAD_Y + 0.011);
      // a concrete kerb along the back of the row, and the bays' wheel stops
      const kz = row === 0 ? LOT.z0 + 0.15 : LOT.z1 - 0.15;
      K.stat(new THREE.BoxGeometry(lw, 0.15, 0.3), K.skin("concrete", 0xa9adb1), (LOT.x0 + LOT.x1) / 2, 0.075, kz, { cast: false });
      for (let i = 0; i < nBays; i++) {
        const x = bx0 + (i + 0.5) * BAY_W;
        const wz = row === 0 ? LOT.z0 + 0.9 : LOT.z1 - 0.9;
        K.stat(new THREE.BoxGeometry(1.7, 0.12, 0.2), K.skin("concrete", 0x9ea3a8), x, 0.06, wz, { cast: false });
        // the parked spots: a seeded two bays in five taken, nose in to the kerb
        if (hash01(x, zc, 41) < 0.4) {
          S.spots.push({
            x: x, z: zc + (row === 0 ? -0.2 : 0.2), heading: row === 0 ? Math.PI : 0,
            model: MODELS[(hash01(x, zc, 7) * MODELS.length) | 0],
            color: PAINT[(hash01(zc, x, 9) * PAINT.length) | 0],
          });
        }
      }
    }
    K.program("staff-lot", LOT.x0, LOT.x1, LOT.z0, LOT.z1);
    // two masts light it at night (world/prisonkit.js registers them with
    // the prison's lights, so they follow the same schedule as the wire's)
    K.floodMast(LOT.x0 - 2, LOT.z1 + 2.5, 12, { x: 0.7, z: -0.7 });
    K.floodMast(LOT.x1 + 2, LOT.z0 - 2.5, 12, { x: -0.7, z: 0.7 });

    // ---- 4. THE OUTER WALL, ITS BOOTH AND ITS CHECKPOINT ------------------
    if (GK && GK.perimeter && GK.checkpoint) {
      const R = { minX: OUT.x0, maxX: OUT.x1, minZ: OUT.z0, maxZ: OUT.z1 };
      const WALL_H = 5.2;
      GK.perimeter(ROOT, R, { style: "wall", h: WALL_H, thick: 0.8, hex: 0x8d9096, gate: 1, gateW: 24, leaves: false });
      // the outer face of every run is noBreach: a charge on it is a charge
      // on a 1 m masonry perimeter, and the run is won at its gate
      const cols = CBZ.colliders || [];
      for (let i = cols.length - 1, n = 0; i >= 0 && n < 12; i--, n++) {
        const c = cols[i];
        if (c && (c.maxX - c.minX > 200 || c.maxZ - c.minZ > 200)) c.noBreach = true;
      }
      GK.gatehouse(ROOT, GX, GZ - 6, true, GK.M ? GK.M.stone : 0xd6d2c4, { noArms: true, booth: 8 });
      const cp = GK.checkpoint(ROOT, GX, GZ);
      S.gate = cp.gate;
      S.posts = cp.gatePosts || [];
      // the wire on the wall top, either side of the gate, where you see it
      const galv = K.skin("galv", 0xb4bcc4);
      K.coilRun(GX - 72, GZ, GX - 12.4, GZ, WALL_H + 0.55, 0.36, galv);
      K.coilRun(GX + 12.4, GZ, GX + 72, GZ, WALL_H + 0.55, 0.36, galv);
      // the gate is lit all night, from inside, onto the lanes
      K.floodMast(GX - 17, GZ - 14, 12, { x: 0.6, z: 0.8 });
      K.floodMast(GX + 17, GZ - 14, 12, { x: -0.6, z: 0.8 });
      // TWO OFFICERS STAND IT: one walks the booth-to-lane line, one holds
      // the arch. entities/guards.js's own guard (sight, chase, arrest).
      if (CBZ.spawnGuard) {
        const post = function (id) { for (let i = 0; i < S.posts.length; i++) if (S.posts[i].id === id) return S.posts[i]; return null; };
        const lane = post("lane"), booth = post("booth"), arch = post("arch");
        if (lane && booth) S.officers.push(CBZ.spawnGuard([[booth.x, booth.z], [lane.x, lane.z]], 2.0, 16, 0.62, { post: "outergate" }));
        if (arch) S.officers.push(CBZ.spawnGuard([[arch.x, arch.z], [arch.x, arch.z - 3.5]], 1.6, 16, 0.62, { post: "outergate" }));
      }
    }
    S.built = true;
  });

  /* ==========================================================
     THE HAZE. Every other world writes its own fog every frame; the prison
     only ever had core/scene.js's boot value, so a run started after Gang
     City kept the city's kilometre of sight and the outer wall stood on the
     horizon. The prison's range is its own again.
     ========================================================== */
  CBZ.onAlways(94.5, function () {
    if (!g || g.mode !== "escape" || !CBZ.scene || !CBZ.scene.fog) return;
    const f = CBZ.scene.fog;
    if (f.near !== FOG_NEAR) f.near = FOG_NEAR;
    if (f.far !== FOG_FAR) f.far = FOG_FAR;
  });

  /* ==========================================================
     3. THE CARS
     ========================================================== */
  function drivable(c) { return !!(c && !c.dead && !c._husk && !c._wrecked && !c._scrapped && !c._flooded); }
  function standCar(spot) {
    if (!CBZ.cityAddParkedCar) return null;
    let car = null;
    try { car = CBZ.cityAddParkedCar(spot.x, spot.z, spot.heading, { force: true, modelName: spot.model, color: spot.color }); } catch (e) { car = null; }
    if (!car) return null;
    car._world = "escape";
    car.owned = true;                 // a staff car taken in the lot is not a Gang City theft
    car._prisonStaffCar = true;
    car.ai = false;
    return car;
  }
  function pristine(r) {
    const c = r.car, s = r.spot;
    if (!c || c._scrapped || c._reap || c.dead || c._husk || c._exploded || c._everDriven || c._playerLeft || c._wrecked) return false;
    if (c.crumple > 0 || (c.engineHp != null && c.engineHp < 100)) return false;
    if (CBZ.cityCars.indexOf(c) < 0) return false;
    return Math.abs(c.pos.x - s.x) < 0.05 && Math.abs(c.pos.z - s.z) < 0.05;
  }
  function scrapCar(c) {
    if (!c) return;
    if (CBZ.cityScrapCar) { try { CBZ.cityScrapCar(c); return; } catch (e) {} }
    if (c.group && c.group.parent) c.group.parent.remove(c.group);
    const i = CBZ.cityCars.indexOf(c); if (i >= 0) CBZ.cityCars.splice(i, 1);
  }
  // A NEW RUN: untouched cars stay on their bays, every car the last run
  // touched goes and its bay is queued for a fresh one
  function resetFleet() {
    const keep = [];
    for (let i = 0; i < S.cars.length; i++) {
      const r = S.cars[i];
      if (pristine(r)) keep.push(r);
      else scrapCar(r.car);
    }
    const have = new Set(keep.map(function (r) { return r.spot; }));
    S.cars = keep;
    S.queue = S.spots.filter(function (s) { return !have.has(s); });
    if (CBZ.cityCarCachePrune) { try { CBZ.cityCarCachePrune(); } catch (e) {} }
  }
  // one car at a time, spaced out: the first of each look is the expensive
  // build (city/vehicles.js finishes a style once), never four in one frame
  function buildSome(dt) {
    if (!S.queue.length || !CBZ.prisonCarRoot) return;
    if ((S.buildT -= dt) > 0) return;
    S.buildT = PHONE ? 0.6 : 0.25;
    const spot = S.queue.pop();
    const car = standCar(spot);
    if (car) S.cars.push({ car: car, spot: spot });
  }
  // the car's flank distance from a point, in its own frame
  function carGap(car, x, z) {
    const d = car.dims || {};
    const hw = (+d.width || 2) * 0.5, hl = (+d.length || 4.5) * 0.5;
    const h = car.heading || 0, s = Math.sin(h), c = Math.cos(h);
    const dx = x - car.pos.x, dz = z - car.pos.z;
    const lz = dx * s + dz * c, lx = dx * c - dz * s;
    return Math.hypot(Math.max(0, Math.abs(lx) - hw), Math.max(0, Math.abs(lz) - hl));
  }
  CBZ.prisonCarDrive = function () {
    const r = S.armCar, P = CBZ.player;
    if (!r || !P || P.dead || P.driving || !drivable(r.car) || !CBZ.cityEnterVehicle) return false;
    const ok = CBZ.cityEnterVehicle(r.car);
    if (ok) r.car._everDriven = true;
    return ok;
  };
  (CBZ._prisonPromptSites || (CBZ._prisonPromptSites = [])).push(
    { id: "prison-car-drive", act: "@prisonCarDrive", was: "the prison had prop vans only", now: "Drive, pinned on a staff car in the lot" }
  );
  function armVerbs() {
    S.armCar = null;
    const P = CBZ.player;
    if (!P || !P.pos || P.dead || P.driving || P._doorArc) return;
    if (CBZ.crawling) return;
    const px = P.pos.x, pz = P.pos.z;
    let best = null, bd = 1.6;
    for (let i = 0; i < S.cars.length; i++) {
      const r = S.cars[i], c = r.car;
      if (!c || !c.pos || Math.abs(c.pos.x - px) > 5 || Math.abs(c.pos.z - pz) > 5) continue;
      if (!drivable(c) || c.player || !c.group) continue;
      const gap = carGap(c, px, pz);
      if (gap < bd) { bd = gap; best = r; }
    }
    if (best && CBZ.prisonPrompt) {
      S.armCar = best;
      const c = best.car;
      CBZ.prisonPrompt("prison-car-drive", "@prisonCarDrive", "Drive",
        { at: { x: c.pos.x, y: c.pos.y + 1.7, z: c.pos.z }, key: "e", bind: true, d2: bd * bd, noReach: true });
    }
  }

  /* ==========================================================
     5. THE BREAK AND THE WIN
     ========================================================== */
  function lockdownOn() { return !!(CBZ.lockdown && CBZ.lockdown.active && CBZ.lockdown.active()); }
  // systems/interactions.js calls this where the run used to be won: the
  // main port's win point, an alt port's, the culvert mouth, over the wall
  function breakout(how, reason) {
    if (S.out || !playing() || g.role === "cop") return false;
    S.out = true; S.how = how || "prison-exit"; S.reason = reason || "gate"; S.outAt = g.elapsed || 0;
    // seen going: the screws already know (the port's klaxon, a tower that
    // had him, a chase in progress)
    S.seen = (g.detection || 0) >= 50 || lockdownOn();
    // the way out moves with you: the compass and the maps (systems/
    // compass.js, fullmap.js read CBZ.EXIT) point at the outer gate now
    if (CBZ.EXIT && CBZ.EXIT.set) {
      if (!S.portExit) S.portExit = { x: CBZ.EXIT.x, z: CBZ.EXIT.z };
      CBZ.EXIT.set(GX, 0, GZ + 6);
    }
    const P = CBZ.player && CBZ.player.pos;
    if (P) noteMade(P.x, P.z, null);
    return true;
  }
  function pastOuter(x, z) {
    if (z > GZ + 3 && Math.abs(x - GX) < 14) return true;                  // out through the gate
    return x < OUT.x0 - 4 || x > OUT.x1 + 4 || z < OUT.z0 - 4 || z > OUT.z1 + 4;
  }
  CBZ.prisonOutside = {
    outer: OUT, gate: { x: GX, z: GZ }, lot: LOT,
    breakout: breakout,
    // built, with its gate: until then systems/interactions.js wins at the wire
    ready: function () { return S.built && !!S.gate; },
    isOut: function () { return S.out; },
    // what the run is won as (escapeend's line): how you got through the wire
    reason: function () { return S.reason || "gate"; },
    won: function (x, z) { return S.built && pastOuter(x, z); },
    alarm: function () { return S.alarm; },
    audit: function () {
      return {
        built: S.built, out: S.out, how: S.how, alarm: S.alarm, seen: S.seen,
        cars: S.cars.length, queued: S.queue.length, spots: S.spots.length,
        gate: S.gate ? { arm: +S.gate.armT.toFixed(2), bollards: +S.gate.bolT.toFixed(2), broken: S.armBroken } : null,
        ways: S.ways.map(function (w) { return { id: w.id, open: w.open, made: w.made, gone: w.gone }; }),
        officers: S.officers.map(function (gd) { const p = gd.group.position; return { x: +p.x.toFixed(1), z: +p.z.toFixed(1), state: gd.state, sus: +(gd.sus || 0).toFixed(2), torch: !!gd.flashlightOn }; }),
        notice: !!S.notice,
      };
    },
  };

  /* ==========================================================
     6. THE GATE'S MIND
     ========================================================== */
  function carSpeed(c) {
    if (!c) return 0;
    const vx = c.vx, vz = c.vz;
    if (isFinite(vx) && isFinite(vz) && (Math.abs(vx) + Math.abs(vz)) > 0.01) return Math.hypot(vx, vz);
    return Math.abs(c.v || 0);
  }
  /* WHEN THE GATE HEARS. Not a timer from the moment you went through the
     wire: the gate hears what the prison KNOWS.
       ON NOTICE  a count found the cell empty (systems/prisonschedule.js:
                  "Count's short." and the search inside the wire). The gate
                  is told to stop waving cars through: the arm stays down for
                  a car that comes up to it slowly. A car that hits it hard
                  still takes it off.
       ALARM      seen going, the heat of a chase, or the search called off
                  as an escape (the warden's lockdown). The bollards come up:
                  from then on the way out is on foot, past the officers.
     A man who goes after the lights-out count has the dark until somebody
     counts again, and the search inside the wire before the perimeter is
     sealed. A prison with no day plan keeps a flat while instead. */
  const NO_PLAN_T = 240;
  function planOn() { const SC = CBZ.prisonSchedule; return !!(SC && SC.enabled && SC.enabled()); }
  function alarmDue(t) {
    if (S.seen || lockdownOn() || (g.detection || 0) >= 60) return true;
    return planOn() ? false : t - S.outAt > NO_PLAN_T;
  }
  function noticeDue() {
    const SC = CBZ.prisonSchedule;
    return !!(planOn() && SC.searching && SC.searching());
  }
  function gateTick(dt) {
    const G = S.gate;
    if (!G) return;
    const t = g.elapsed || 0;
    S.alarm = S.alarm || (S.out && alarmDue(t));
    S.notice = S.notice || S.alarm || (S.out && noticeDue());
    const P = CBZ.player;
    const car = P && P.driving ? P._vehicle : null;
    const veh = G.vehicle || { minX: GX - 5.8, maxX: GX + 6.3, z: GZ - 1.6 };
    let carNear = false, carFast = false;
    if (car && car.pos) {
      const cx = car.pos.x, cz = car.pos.z;
      const inLane = cx > veh.minX - 1.5 && cx < veh.maxX + 1.5;
      carNear = inLane && cz > veh.z - 16 && cz < veh.z + 4;
      // coming at the arm, hard, from inside
      const sp = carSpeed(car);
      carFast = inLane && sp > 7 && cz > veh.z - 4.5 && cz < veh.z + 0.5 && (car.vz == null ? Math.cos(car.heading || 0) * (car.v || 0) : car.vz) > 4;
    }
    // A CAR THROUGH THE ARM. The barrier is a 12 m aluminium pole on a
    // pivot: a car at speed takes it off. It drops out of the lane and the
    // lane is open until the next run.
    if (!S.armBroken && carFast && G.armT < 0.35) {
      S.armBroken = true;
      G.armT = 0.99; G.setArm(true);
      if (G.arm) G.arm.visible = false;
      if (CBZ.worldSfx) { try { CBZ.worldSfx("crash", veh.minX + 3, veh.z, { ref: 20 }); } catch (e) {} }
      if (CBZ.shake) CBZ.shake(0.35);
      S.alarm = true;
    }
    if (S.alarm) {
      G.setLamp("alarm");
      if (!S.armBroken) G.setArm(false);
      // the bollards come up only over an empty lane (never under a car)
      const bz = G.bollards ? G.bollards.z : GZ - 4.2;
      const over = car && car.pos && car.pos.x > veh.minX - 1 && car.pos.x < veh.maxX + 1 && Math.abs(car.pos.z - bz) < 3.2;
      if (!over) G.setBollards(true);
      // UP, THEY STOP A CAR. Eight steel posts 1.5 m apart: the car's own
      // collider pass let a car driven at them slip the 1.2 m gaps (measured:
      // a staff car through raised bollards at 14 m/s and out). The nose
      // stops at the posts, hard, and the way out is on foot.
      if (G.bolT > 0.4 && car && car.pos && car.pos.x > veh.minX - 1.2 && car.pos.x < veh.maxX + 1.2) {
        const hl = ((car.dims && +car.dims.length) || 4.5) * 0.5;
        const front = car.pos.z + Math.abs(Math.cos(car.heading || 0)) * hl;
        if (car.pos.z < bz && front > bz - 0.35) {
          const sp = carSpeed(car);
          car.pos.z -= front - (bz - 0.35);
          car.v = 0; car.vx = 0; car.vz = 0;
          if (car.group) car.group.position.z = car.pos.z;
          if (P && P.driving && P._vehicle === car) P.pos.z = car.pos.z;
          if (sp > 3) {
            if (car.engineHp != null) car.engineHp = Math.max(0, car.engineHp - sp * 3);
            if (CBZ.worldSfx) { try { CBZ.worldSfx("crash", car.pos.x, bz, { ref: 20 }); } catch (e) {} }
            if (CBZ.shake) CBZ.shake(Math.min(1, 0.2 + sp * 0.04));
          }
        }
      }
    } else {
      G.setBollards(false);
      // a car that comes up to the arm from inside, slowly, is waved through
      // (not once the gate is on notice: then it is a car to be looked at)
      if (carNear && carSpeed(car) < 6 && !S.notice) { S.armPassT = 4; }
      if (S.armPassT > 0) S.armPassT -= dt;
      if (!S.armBroken) G.setArm(S.armPassT > 0);
      G.setLamp(S.armPassT > 0 ? "pass" : "idle");
    }
    G.step(dt);
  }
  /* THE GATE IS HELD. The two officers on the outer gate are the perimeter:
     a lockdown inside the wire (systems/lockdown.js whips every guard into a
     hunt from the last place the block had you) or a radio call does not
     walk them a kilometre up the road and leave the gate standing open. They
     chase what they see at the gate, and they stand to at their posts while
     the prison is locked down. Runs before entities/guards.js thinks (20) and after the
     lockdown's whip (72) of the frame before. */
  const HOLD_R = 70;
  function holdGate() {
    if (!S.officers.length || !playing()) return;
    const P = CBZ.player;
    if (!P || !P.pos) return;
    const near = Math.hypot(P.pos.x - GX, P.pos.z - GZ) < HOLD_R;
    for (let i = 0; i < S.officers.length; i++) {
      const gd = S.officers[i];
      if (!gd || gd.dead || gd.ko > 0) continue;
      // standing to while the prison is locked down: at his post he stops
      // walking his beat and watches (the lockdown over, he walks it again,
      // the bollards still up)
      const post = gd.waypoints && gd.waypoints[0], p = gd.group.position;
      if (S.alarm && lockdownOn() && post && Math.hypot(p.x - post.x, p.z - post.z) < 2.5) gd.alert = Math.max(gd.alert || 0, 0.5);
      if (near) continue;
      if (gd.hunt > 0) { gd.hunt = 0; gd._chase = null; }
      const iv = gd.investigate;
      if (iv && Math.hypot(iv.x - GX, iv.z - GZ) > HOLD_R - 10) gd.investigate = null;
    }
  }
  CBZ.onUpdate(19.9, function () { if (S.built && g && g.mode === "escape") holdGate(); });
  function gateReset() {
    const G = S.gate;
    S.armBroken = false; S.armPassT = 0; S.alarm = false; S.notice = false;
    if (!G) return;
    if (G.arm) G.arm.visible = true;
    G.setArm(false); G.setBollards(false); G.setLamp("idle");
  }

  /* ==========================================================
     7. THE WAYS OUT, FOR EVERYONE
     ========================================================== */
  const PORTS = [{ id: "prison-exit", x: 0 }, { id: "prison-exit-w", x: -50 }, { id: "prison-exit-e", x: 50 }];
  function specOf(id) {
    const L = CBZ._prisonDoorSpecs || [];
    for (let i = 0; i < L.length; i++) if (L[i] && L[i].id === id) return L[i];
    return null;
  }
  function ensureWays() {
    if (S.ways.length) return;
    for (let i = 0; i < PORTS.length; i++) {
      const p = PORTS[i], spec = specOf(p.id + "-inner");
      if (!spec) continue;
      S.ways.push({
        id: p.id, spec: spec, x: p.x, lineZ: EZ,
        inside: { x: p.x, z: EZ - 10 },             // the approach, the yard side of the port
        out: { x: p.x, z: EZ + 7 + 3.6 },            // past the out door
        open: false, made: 0, gone: 0, crews: {}, evalT: 0,
      });
    }
  }
  function wayOpen(w) { return !!(w.spec && w.spec.isOpen && w.spec.isOpen()); }
  // ask the men near a way that is open, once per edge (or per success)
  function offer(w, cx, cz, r) {
    if (!CBZ.aiConsiderRun || !CBZ.npcs) return 0;
    const r2 = r * r;
    let n = 0;
    for (let i = 0; i < CBZ.npcs.length; i++) {
      const a = CBZ.npcs[i];
      if (!a || !a.group || a.dead || a.escaped || a._crowd || a.aiState === "escape") continue;
      const p = a.group.position, dx = p.x - cx, dz = p.z - cz, d2 = dx * dx + dz * dz;
      if (d2 > r2) continue;
      if (CBZ.aiConsiderRun(a, w, Math.sqrt(d2))) n++;
    }
    return n;
  }
  // somebody got out through a way: the ones who saw it think again
  function noteMade(x, z, way) {
    ensureWays();
    let w = way;
    if (!w) {
      let bd = 1e9;
      for (let i = 0; i < S.ways.length; i++) {
        const q = S.ways[i], d = Math.hypot(x - q.x, z - (q.lineZ + 7));
        if (d < bd) { bd = d; w = q; }
      }
      if (bd > 25) return;                        // not through a port (the wall, the culvert)
    }
    w.made++;
    if (wayOpen(w)) offer(w, w.inside.x, w.inside.z, 30);
  }
  function waysBeat() {
    ensureWays();
    const t = g.elapsed || 0;
    for (let i = 0; i < S.ways.length; i++) {
      const w = S.ways[i], open = wayOpen(w);
      if (open && !w.open) { w.evalT = t; offer(w, w.inside.x, w.inside.z, 45); }
      // a way that stays open (a charge took the door off) keeps drawing the
      // men who come near it, at a slow beat
      else if (open && t - w.evalT > 10) { w.evalT = t; offer(w, w.inside.x, w.inside.z, 30); }
      w.open = open;
    }
  }
  /* THE RUN, LEG BY LEG. entities/ai.js's "escape" state asks this for his
     next point every think: "go" (target set), "back" (the way shut before he
     reached it: he thinks better of it), "gone" (out of the outer gate and
     out of sight: the brain removes him). */
  function steer(n, w) {
    const p = n.group.position;
    if (!w || !w.spec) return "back";
    let ph = n._runPh | 0;
    if (ph === 0) {
      // not yet through the inner door: it has to be open by the time he is
      // at it (a man sent by a plan or an open yard gate walks over to try
      // it; at the port, shut, he thinks better of it)
      if (p.z < w.lineZ - 0.3 && !wayOpen(w)) {
        if (Math.hypot(p.x - w.inside.x, p.z - w.inside.z) < 7) return "back";
        n.target.set(w.inside.x, 0, w.inside.z);
        return "go";
      }
      n.target.set(w.out.x, 0, w.out.z);
      if (p.z > w.out.z - 1.2) {
        n._runPh = ph = 1;
        w.made++;
        if (n.gang != null && n.gang >= 0) w.crews[n.gang] = (w.crews[n.gang] || 0) + 1;
        // a man over the wire is an escape, as the player's is
        if (CBZ.guardHear) { try { CBZ.guardHear(p.x, p.z, 60, { type: "alarm" }); } catch (e) {} }
        if (CBZ.lockdown && CBZ.lockdown.begin && !lockdownOn()) { try { CBZ.lockdown.begin("escape", { hunt: false }); } catch (e) {} }
        if (wayOpen(w)) offer(w, w.inside.x, w.inside.z, 30);
      }
      return "go";
    }
    const ax = GX + ARCH_DX, az = GZ - 2.6;
    if (ph === 1) {
      // across the field to the gate's walk-through lane
      n.target.set(ax, 0, az - 9);
      if (Math.abs(p.x - ax) < 2.5 && Math.abs(p.z - (az - 9)) < 2.5) n._runPh = 2;
      return "go";
    }
    if (ph === 2) {
      // through the arch, and out
      n.target.set(ax, 0, GZ + 40);
      if (p.z > GZ + 22) n._runPh = 3;
      return "go";
    }
    // past the gate: gone once nobody can see it happen
    n.target.set(ax, 0, GZ + 60);
    const unseen = CBZ.leave && CBZ.leave.unseen ? CBZ.leave.unseen({ x: p.x, y: p.y, z: p.z })
      : !CBZ.camera || Math.hypot(CBZ.camera.position.x - p.x, CBZ.camera.position.z - p.z) > FOG_FAR + 40;
    if (unseen) { w.gone++; return "gone"; }
    return "go";
  }
  // the port nearest a man (a run decided elsewhere: systems/prisondoorwatch.js
  // when a yard gate is left open at night, systems/prisonsnitch.js's plan)
  function nearestWay(n) {
    ensureWays();
    const p = n && n.group && n.group.position;
    if (!p) return null;
    let best = null, bd = 1e9;
    for (let i = 0; i < S.ways.length; i++) {
      const w = S.ways[i], d = Math.hypot(p.x - w.inside.x, p.z - w.inside.z);
      if (d < bd) { bd = d; best = w; }
    }
    return best;
  }
  CBZ.prisonRun = { steer: steer, nearest: nearestWay, ways: function () { ensureWays(); return S.ways; } };

  /* ==========================================================
     THE FRAME
     ========================================================== */
  /* OUT OF A STAFF CAR WHERE YOU STAND. A new run (or another world) finds
     the player still in the seat of the car he won in: he is taken out of it
     through the vehicle system's own exit, which stands him at the car's
     door, and put back where the reset had already put him. */
  function leaveCarInPlace() {
    const P = CBZ.player;
    if (!P || !P.driving || !P._vehicle || !P._vehicle._prisonStaffCar || !CBZ.cityExitVehicle) return;
    const x = P.pos.x, y = P.pos.y, z = P.pos.z;
    try { CBZ.cityExitVehicle(); } catch (e) {}
    P.pos.set(x, y, z);
    if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.position.copy(P.pos);
    if (CBZ.bodyTeleported) { try { CBZ.bodyTeleported(P); } catch (e) {} }
  }
  function newRun() {
    leaveCarInPlace();
    if (S.portExit && CBZ.EXIT && CBZ.EXIT.set) CBZ.EXIT.set(S.portExit.x, 0, S.portExit.z);
    S.out = false; S.outAt = 0; S.how = null; S.reason = null; S.seen = false; S.notice = false;
    gateReset();
    for (let i = 0; i < S.ways.length; i++) { const w = S.ways[i]; w.made = 0; w.gone = 0; w.crews = {}; w.open = false; w.evalT = 0; }
    resetFleet();
  }
  CBZ.onUpdate(40.5, function (dt) {
    if (!S.built || !g) return;
    if (g.mode !== "escape") { leaveCarInPlace(); return; }
    // a new run: the clock went back to zero
    const t = g.elapsed || 0;
    if (t + 0.5 < S.lastElapsed || S.lastElapsed < 0) newRun();
    S.lastElapsed = t;
    if (g.state !== "playing") return;
    buildSome(dt);
    armVerbs();
    gateTick(dt);
    if ((S.beatT -= dt) <= 0) { S.beatT = 0.5; waysBeat(); }
  });
})();
