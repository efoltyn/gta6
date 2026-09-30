/* ============================================================
   city/speedway_race.js — RACING AT THE BULLRING, in the world.

   OWNER: "I didn't mean a game inside the game. I still want it to be the
   character. The controls should be from the game."

   So there is no race page over a frozen city any more. Ten stock cars stand
   on the Bullring's grid (city/island_speedway.js is the place). Each one is
   a real Gang City vehicle (CBZ.cityRegisterVehicle): you walk up to any of
   them as yourself and get in with the game's own F (a tap on touch), and it
   drives with the game's own pedals and wheel (W/S/A/D, SPACE, the touch
   GAS/BRAKE pedals and LEFT/RIGHT or tilt, the pad), the game's own chase
   camera and [V] seat view, the game's own speedometer (mph) and exit. What
   is the race's is only what a race needs:
     - the chassis: city/vehicles.js hands the step to car._raceHelm, which
       runs the whole field on the racing model (race_physics: tyres, loads,
       downforce, drafting, the banking, car-to-car contact) with the other
       nine cars driven by race_ai;
     - the rules: race_session.js, the SAME grid → lights → laps → flag loop
       games/race.html runs (one racing game, two places to run it).

   THE LOOP A PLAYER SEES. Sit in a car that is on the grid: the five lamps
   light over the start line and the field goes on green. Five laps. Cross
   the line and the purse is paid; the others take a cool-down lap and you
   drive on as long as you like. Get out (F) anywhere and walk away. Get out
   mid-race and the others cool down and stop. The field is back on the grid
   the next time you come up the tunnel (it is re-laid while you cannot see
   the track: underground, or outside the stadium).

   Phone: the ten cars are built when you are inside FIELD_R of the bowl
   (quality "low" on touch: 512 px liveries, the far LOD past 65 m) and given
   back past DROP_R. Nothing is stepped while the field is parked.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const g = CBZ.game;
  const RACE = CBZ.race || {};
  if (!RACE.session || !RACE.physics || !RACE.car || !RACE.core || !RACE.ai) return;
  const RC = RACE.core, D = RC.DIMS;

  const FIELD = 10, LAPS = 5, HOME_SLOT = 5, HOME_NUMBER = 17;
  const FIELD_R = 700;             // build the cars inside this distance of the bowl
  const DROP_R = 2800;             // give them back past this (and not in one of them)
  const OUT_OF_SIGHT_R = 250;      // outside the stands you cannot see the track
  const PARK_AFTER = 25;           // s of cool-down with nobody racing before the field stops
  const PURSE = [5000, 3000, 2000, 1500, 1000, 800, 600, 400, 300, 200];
  const REDLINE = 9500;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const SW = () => CBZ.speedway;

  const F = {
    built: false, ses: null, cars: [], fx: null, root: null,
    onGrid: false,           // every car is in its grid box and nothing has moved
    live: false,             // the field is being stepped with nobody at the wheel
    stepped: -1, frame: 0, poseT: 0, pylonT: 0, lampsT: 0, lastLit: 0, green: false,
  };

  /* the start-light tone (880 Hz a lamp, 1320 Hz the green), on the game's one audio context */
  function beep(go) {
    const ac = CBZ.getAudioCtx ? CBZ.getAudioCtx() : null;
    if (!ac || ac.state !== "running") return;
    try {
      const o = ac.createOscillator(), gn = ac.createGain(), t = ac.currentTime;
      o.type = "sine"; o.frequency.value = go ? 1320 : 880;
      gn.gain.setValueAtTime(0.0001, t); gn.gain.exponentialRampToValueAtTime(0.18, t + 0.01);
      gn.gain.exponentialRampToValueAtTime(0.0001, t + (go ? 0.6 : 0.25));
      o.connect(gn); gn.connect(ac.destination); o.start(t); o.stop(t + 0.7);
    } catch (e) {}
  }

  // ---- the car as the world sees it (city coords) ----------------------------------
  function makeView() {
    return { pos: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0, roll: 0, wheels: null, damage: null,
      fx: { backfire: 0, sparks: 0, smoke: 0, impact: null, impactSeq: 0 }, _imp: {},
      vel: { x: 0, z: 0 }, speed: 0, latSpeed: 0, steer: 0, rpm: 0, gear: 1 };
  }
  function toView(c, v) {
    const sw = SW();
    v.pos.x = sw.VX - c.pos.x; v.pos.y = c.pos.y; v.pos.z = sw.VZ - c.pos.z;
    v.yaw = sw.yawToCity(c.yaw); v.pitch = c.pitch; v.roll = c.roll;
    v.wheels = c.wheels; v.damage = c.damage;
    v.vel.x = -c.vel.x; v.vel.z = -c.vel.z;
    v.speed = c.speed; v.latSpeed = c.latSpeed; v.steer = c.steer; v.rpm = c.rpm; v.gear = c.gear;
    const f = c.fx, o = v.fx;
    o.backfire = f.backfire; o.sparks = f.sparks; o.smoke = f.smoke; o.impactSeq = f.impactSeq;
    if (f.impact) {
      const im = v._imp;
      im.x = sw.VX - f.impact.x; im.y = f.impact.y; im.z = sw.VZ - f.impact.z;
      im.nx = -f.impact.nx; im.nz = -f.impact.nz; im.mag = f.impact.mag; im.part = f.impact.part;
      o.impact = im;
    } else o.impact = null;
    return v;
  }
  /* pose one car (visual + the city record it IS) from its physics car */
  function pose(fc, dt, cockpit) {
    const c = fc.e.car, v = toView(c, fc.view);
    fc.visual.update(v, dt, CBZ.camera, cockpit);
    const r = fc.rec;
    r.heading = v.yaw; r.v = c.speed; r.vx = v.vel.x; r.vz = v.vel.z;
    r._yawRate = c.yawRate;
    r._slipAngle = Math.abs(c.speed) > 2 ? Math.atan2(c.latSpeed, Math.abs(c.speed)) : 0;
    r._steerInput = c.steer; r._steerAngle = c.wheels[0].steer;
    r._gear = c.gear; r._rev = clamp(c.rpm / REDLINE, 0, 1);
    r._drift = Math.abs(c.latSpeed);
  }
  function poseAll(dt) {
    const fp = !!(CBZ.carFpActive && CBZ.carFpActive());
    const P = CBZ.player;
    for (const fc of F.cars) pose(fc, dt, fp && P && P._vehicle === fc.rec);
    if (F.fx) F.fx.update(dt, CBZ.camera, (CBZ.renderer && CBZ.renderer.domElement.clientHeight) || window.innerHeight);
  }

  // ---- the driver's seat: the one door is the window on the left ------------------------
  function cabinInfo() {
    const RD = RACE.car.DIMS, E = RD.eye;
    const seat = { id: "driver", row: 0, col: "L", side: 1, x: RD.seatX, z: E.z - 0.1, cushionY: 0.3, w: 0.5, bench: false, isDriver: true,
      eye: { x: E.x, y: E.y, z: E.z }, roofY: RD.height - 0.05, doors: ["FL"] };
    return {
      dressed: true, baseY: 0.85, peakY: RD.height - 0.85, cx: E.z, w: 1.8,
      beltY: 0.85, roofY: RD.height, floorY: 0.12, zRear: -0.95, zFront: 0.75, rows: 1, kind: "stock1",
      cushionY: 0.3, seatX: RD.seatX, seatZ: E.z - 0.1, wheel: { x: RD.seatX, y: 0.79, z: 0.12, r: 0.17, rake: 0.36 },
      eye: { x: E.x, y: E.y, z: E.z }, doorX: RD.width / 2, windowTopY: RD.height - 0.1,
      seatLayout: { kind: "stock1", rows: 1, seats: [seat], doors: [{ id: "FL", side: 1, row: 0, z0: -0.8, z1: 0.35 }] },
    };
  }

  // ---- build / drop -------------------------------------------------------------------
  function buildField() {
    const sw = SW(), root = sw.stadium.root;
    F.root = root;
    F.ses = RACE.session.create({
      field: FIELD, laps: LAPS, playerSlot: HOME_SLOT, playerNumber: HOME_NUMBER, coolPlayer: false,
      on: {
        lights(n, green) {
          F.lastLit = n; F.green = green; F.lampsT = green ? 1.4 : 0;
          const st = sw.stadium; if (st.venue) st.venue.setLights(n, green);
          if (n || green) beep(green);
        },
        flash(text) { hudFlash(text); },
        finish(e, place) {
          const pay = PURSE[place - 1] || 0;
          if (pay && CBZ.city && CBZ.city.addCash) CBZ.city.addCash(pay);
          if (pay && CBZ.city && CBZ.city.note) CBZ.city.note("P" + place + "   +$" + pay.toLocaleString("en-US"), 3);
        },
      },
    });
    F.ses.setPlayer(-1);
    F.ses.layGrid();
    F.fx = RACE.car.createFx(THREE, root, { quality: sw.QUALITY });
    const liveries = RACE.car.liveries(FIELD);
    const RD = RACE.car.DIMS;
    for (const e of F.ses.entries) {
      const visual = RACE.car.build(THREE, { number: e.number, livery: liveries[e.i], player: true, quality: sw.QUALITY, fx: F.fx });
      const grp = visual.group;
      grp.userData.raceCar = true;
      grp.userData.dynamic = true;                    // never baked into a static batch: it moves and it crumples
      grp.userData.cabinInfo = cabinInfo();
      // the livery is painted once: its canvas goes once it is on the GPU (phone memory)
      if (CBZ.freeCanvasAfterUpload) {
        const seen = new Set();
        grp.traverse((o) => { const m = o.material, t = m && m.map; if (t && t.isCanvasTexture && !seen.has(t)) { seen.add(t); CBZ.freeCanvasAfterUpload(t); } });
      }
      root.add(grp);
      const view = makeView();
      toView(e.car, view);
      const rec = CBZ.cityRegisterVehicle(grp, {
        body: "coupe", style: "stockcar", persist: true, heading: view.yaw,
        model: { name: "No. " + e.number, value: 0, rarity: 0, body: "coupe" },
        dims: { width: RD.width, length: RD.bodyLength, height: RD.height, wheelbase: RD.wheelbase },
        color: parseInt(String(liveries[e.i].base || "#888888").replace("#", ""), 16) || 0x888888,
      });
      if (!rec) { visual.dispose(); continue; }
      rec._raceCar = true; rec._raceEntry = e; rec.owned = true; rec.stolen = false;
      rec._raceHelm = helm;
      const fc = { e, visual, rec, view };
      F.cars.push(fc);
      pose(fc, 0, false);
    }
    F.built = true; F.onGrid = true; F.live = false;
  }
  function dropField() {
    for (const fc of F.cars) {
      const i = CBZ.cityCars ? CBZ.cityCars.indexOf(fc.rec) : -1;
      if (i >= 0) CBZ.cityCars.splice(i, 1);
      fc.rec.dead = true; fc.rec._raceHelm = null;
      fc.visual.dispose();
    }
    if (F.fx) { F.fx.dispose(); F.fx = null; }
    F.cars = []; F.ses = null; F.built = false; F.onGrid = false; F.live = false;
    hudShow(false);
  }
  const byRec = (rec) => { for (const fc of F.cars) if (fc.rec === rec) return fc; return null; };

  /* the car stands where the world says it does (a shove, a respawn): the
     physics car is re-made there before anybody drives it */
  function syncFromRecord(fc) {
    const c = fc.e.car, sw = SW();
    const cx = sw.VX - fc.rec.pos.x, cz = sw.VZ - fc.rec.pos.z;
    if (Math.hypot(cx - c.pos.x, cz - c.pos.z) < 0.4) return;
    F.ses.placeCar(fc.e, cx, cz, (fc.rec.heading || 0) - Math.PI);
    F.onGrid = false;
  }
  function atGridBox(e) {
    const sl = RC.GRID.slot(e.i), f = RC.frame(sl.s);
    return Math.hypot(e.car.pos.x - (f.x + f.nx * sl.u), e.car.pos.z - (f.z + f.nz * sl.u)) < 1.5;
  }

  // ---- stepping ------------------------------------------------------------------------
  const HIN = { steer: 0, throttle: 0, brake: 0, hold: false };
  let skidLast = [];
  function stepField(dt, input) {
    F.ses.step(Math.min(dt, 0.1), input);
    F.stepped = F.frame;
    marks();
  }
  /* rubber on the concrete: the driven (rear) wheels lay it past the tyres' peak */
  function marks() {
    const tr = SW().stadium.track;
    if (!tr || !tr.skid || F.ses.phase === "idle") return;
    for (const fc of F.cars) {
      const c = fc.e.car, w = c.wheels, sy = Math.sin(c.yaw), cy = Math.cos(c.yaw);
      for (let k = 2; k < 4; k++) {
        const key = fc.e.i * 4 + k, wl = w[k];
        if (!wl || wl.slip < 0.45 || Math.abs(c.speed) < 4) { skidLast[key] = null; continue; }
        const side = k === 2 ? 0.86 : -0.86;
        const x = c.pos.x + cy * side - sy * 1.4, z = c.pos.z - sy * side - cy * 1.4;
        const lm = skidLast[key];
        if (lm && Math.hypot(x - lm.x, z - lm.z) < 0.7) continue;
        tr.skid(x, c.pos.y + 0.02, z, c.yaw, 0.3, clamp((wl.slip - 0.45) * 2, 0.15, 1));
        skidLast[key] = { x, z };
      }
    }
  }

  /* THE HELM. city/vehicles.js's order-11 loop calls this with the game's own
     pedals and wheel for the car the player sits in. Returns {speed} when it
     owned the frame. */
  function helm(car, throttle, steer, handbrake, dt) {
    if (!F.built || !F.ses) return null;
    const fc = byRec(car);
    if (!fc) return null;
    const S = F.ses, e = fc.e;
    if (S.me !== e) {                                   // just sat down in this car
      syncFromRecord(fc);
      S.setPlayer(e.i);
      if (F.onGrid && S.phase === "idle" && atGridBox(e)) { S.begin(); F.onGrid = false; hudShow(true); }
    }
    HIN.steer = clamp(steer, -1, 1);
    HIN.throttle = throttle > 0 ? throttle : 0;
    HIN.brake = Math.max(throttle < 0 ? -throttle : 0, handbrake ? 1 : 0);
    HIN.hold = !!handbrake && !(throttle < 0);          // SPACE holds the car; only the brake pedal backs it up
    stepField(dt, HIN);
    const c = e.car;
    // off the racing surface (pit lane, the infield) the buildings are solid to it too
    if (c.u < D.APRON_IN - 1 && CBZ.cityCollideVehicle) {
      poseAll(dt);
      const x0 = car.pos.x, z0 = car.pos.z;
      const moved = CBZ.cityCollideVehicle(car);
      if (moved > 0.001) {
        const dx = car.pos.x - x0, dz = car.pos.z - z0, m = Math.hypot(dx, dz);
        c.pos.x -= dx; c.pos.z -= dz;                                   // city → circuit (half a turn)
        const nx = -dx / m, nz = -dz / m, vIn = c.vel.x * nx + c.vel.z * nz;
        if (vIn < 0) { c.vel.x -= nx * vIn * 1.2; c.vel.z -= nz * vIn * 1.2; }
      }
    } else poseAll(dt);
    // the engine you hear is the car's own rev and gear
    if (CBZ.carAudio) {
      const w = c.wheels, sl = Math.max(w[0].slip, w[1].slip, w[2].slip, w[3].slip);
      CBZ.carAudio.update(0.06 + clamp(c.rpm / REDLINE, 0, 1) * 0.9, c.throttle, sl, "muscle", c._shiftT > 0.05);
    }
    return { speed: Math.hypot(c.vel.x, c.vel.z) };
  }

  /* the player got out (or was taken out): a race in progress winds down */
  function playerLeft() {
    const S = F.ses;
    if (S.phase === "grid") { S.layGrid(); F.onGrid = true; F.live = false; }
    else if (S.phase === "race") { S.abandon(); F.live = true; }
    else if (S.phase === "done") F.live = true;
    S.setPlayer(-1);
    hudShow(false);
    poseAll(0);
  }

  // ---- the frame ------------------------------------------------------------------------
  CBZ.onUpdate(0.02, function () { F.frame++; });
  CBZ.onUpdate(11.3, function (dt) {
    if (!g || g.mode !== "city") return;
    const sw = SW(), P = CBZ.player;
    if (!sw || !P || !P.pos) return;
    const dist = sw.distance(P.pos.x, P.pos.z);
    const inRace = !!(P.driving && P._vehicle && P._vehicle._raceCar);
    if (!F.built) {
      if (dist < FIELD_R && sw.ready()) buildField();
      return;
    }
    if (sw.stadium.root !== F.root || (dist > DROP_R && !inRace)) { dropField(); return; }
    const S = F.ses;
    for (const fc of F.cars) { const vis = sw.stadium.shown; if (fc.visual.group.visible !== vis) fc.visual.group.visible = vis; }
    if (S.me && !inRace) playerLeft();
    if (!inRace && F.live) {
      stepField(dt, null);
      if (S.phase === "done" && S.doneT > PARK_AFTER) S.park();
      if (S.phase === "idle") {
        let moving = false;
        for (const fc of F.cars) if (Math.abs(fc.e.car.speed) > 0.2) { moving = true; break; }
        if (!moving) F.live = false;
      }
      poseAll(dt);
    } else if (!inRace && F.stepped !== F.frame && sw.stadium.shown) {
      F.poseT -= dt;                                   // parked: a slow refresh keeps the near/far LOD right
      if (F.poseT <= 0) { F.poseT = 0.3; poseAll(0); }
    }
    // back on the grid while nobody can see the track: in the tunnel, or outside the stands
    if (!inRace && !F.onGrid) {
      const hidden = P.pos.y < -1.2 || dist > OUT_OF_SIGHT_R;
      if (hidden) {
        S.layGrid(); F.onGrid = true; F.live = false;
        for (const fc of F.cars) {
          fc.visual.reset();
          if (fc.rec._fuelCap != null) fc.rec._fuel = fc.rec._fuelCap;   // the crews fill them between races
        }
        poseAll(0);
      }
    }
    // the stadium's own boards: the scoring pylon and the crowd
    if (S.phase === "race") {
      F.pylonT -= dt;
      if (F.pylonT <= 0) {
        F.pylonT = 0.5;
        const st = S.standings(), ven = sw.stadium.venue;
        if (ven && ven.setPylon) ven.setPylon(st.map((e) => e.number));
        if (S.leader && S.leader !== st[0]) S.excite = Math.min(1, S.excite + 0.5);
        S.leader = st[0];
      }
    }
    hudTick(dt, inRace);
  });

  /* what the venue's lights, flags and crowd read (island_speedway.js) */
  CBZ.speedwayRaceState = function () {
    const S = F.ses;
    if (!S) return null;
    return { phase: S.phase, excite: Math.max(0.05, S.excite || 0), flag: S.flag, leader: S.leader ? S.leader.number : 0 };
  };
  /* for tools and tests: the field, the session and the helm */
  CBZ.speedwayRaceAudit = function () {
    const S = F.ses;
    return {
      built: F.built, onGrid: F.onGrid, live: F.live, phase: S ? S.phase : null, laps: LAPS,
      me: S && S.me ? S.me.number : null, place: S && S.me ? S.me.place : null,
      cars: F.cars.map((fc) => ({ number: fc.e.number, x: +fc.rec.pos.x.toFixed(2), z: +fc.rec.pos.z.toFixed(2), mph: CBZ.speedMph ? Math.round(CBZ.speedMph(fc.rec.v)) : null })),
    };
  };
  CBZ.speedwayRace = { F, helm, buildField, dropField, HOME_SLOT, LAPS };

  // ---- the HUD: the position chip, the five lamps, a word at the flag ------------------
  let hud = null, flashT = 0;
  function hudBuild() {
    if (hud || typeof document === "undefined" || !document.body) return hud;
    const st = document.createElement("style");
    st.textContent =
      "#swRace{position:fixed;left:50%;top:calc(10px + env(safe-area-inset-top,0px));transform:translateX(-50%);z-index:21;pointer-events:none;display:none;text-align:center;font:700 20px/1 Fredoka,system-ui,sans-serif;color:#fff;letter-spacing:.06em}" +
      "#swRace.on{display:block}" +
      "#swRace .chip{display:inline-flex;gap:14px;padding:7px 16px;border-radius:12px;background:rgba(10,14,22,.6);text-shadow:0 1px 3px rgba(0,0,0,.6)}" +
      "#swRace .chip span{opacity:.78}" +
      "#swRace .lamps{display:none;justify-content:center;gap:10px;margin-top:10px;padding:10px 14px;border-radius:14px;background:rgba(0,0,0,.55)}" +
      "#swRace .lamps.on{display:inline-flex}" +
      "#swRace .lamps i{width:28px;height:28px;border-radius:50%;background:#1b1d22;box-shadow:inset 0 0 0 3px #2a2d33}" +
      "#swRace .lamps i.r{background:#ff2a1f;box-shadow:0 0 18px #ff2a1f}" +
      "#swRace .lamps i.g{background:#27e06b;box-shadow:0 0 18px #27e06b}" +
      "#swRace .word{display:block;margin-top:14px;font-size:clamp(34px,7vw,64px);opacity:0;transition:opacity .25s;text-shadow:0 4px 24px rgba(0,0,0,.7)}" +
      "#swRace .word.on{opacity:1}";
    document.head.appendChild(st);
    hud = document.createElement("div");
    hud.id = "swRace";
    hud.innerHTML = '<div class="chip"><b class="pos">P1/10</b><span class="lap">LAP 1/5</span></div><br><div class="lamps"><i></i><i></i><i></i><i></i><i></i></div><b class="word"></b>';
    document.body.appendChild(hud);
    hud._pos = hud.querySelector(".pos"); hud._lap = hud.querySelector(".lap");
    hud._lamps = hud.querySelector(".lamps"); hud._lampEls = Array.from(hud.querySelectorAll(".lamps i"));
    hud._word = hud.querySelector(".word");
    return hud;
  }
  function hudShow(on) {
    const h = on ? hudBuild() : hud;
    if (h) h.classList.toggle("on", !!on);
  }
  function hudFlash(text) {
    const h = hudBuild(); if (!h) return;
    h._word.textContent = text; h._word.classList.add("on"); flashT = 2.6;
  }
  let hudAcc = 0;
  function hudTick(dt, inRace) {
    if (!hud) return;
    const S = F.ses;
    const racing = inRace && S && S.me && (S.phase === "grid" || S.phase === "race" || flashT > 0);
    hud.classList.toggle("on", !!racing);
    if (!racing) return;
    if (flashT > 0) { flashT -= dt; if (flashT <= 0) hud._word.classList.remove("on"); }
    if (F.lampsT > 0) F.lampsT -= dt;
    const showLamps = S.phase === "grid" || F.lampsT > 0;
    hud._lamps.classList.toggle("on", showLamps);
    if (showLamps) hud._lampEls.forEach((l, i) => { l.className = F.green ? "g" : (i < F.lastLit ? "r" : ""); });
    hudAcc += dt;
    if (hudAcc < 1 / 8) return;
    hudAcc = 0;
    if (S.phase === "race") S.standings();
    hud._pos.textContent = "P" + S.me.place + "/" + FIELD;
    hud._lap.textContent = "LAP " + clamp(S.me.car.lap + 1, 1, LAPS) + "/" + LAPS;
  }
})();
