/* ============================================================
   city/racedrivers.js — OPPONENTS THAT ACTUALLY DRIVE.

   WHY: every "race" in the city used to be a lie. The speedway field
   was sprites sliding along a parametric spline, street-race rivals
   were invisible progress numbers, and police PIT cars wrote their
   position directly. Nobody used throttle, brakes or a steering
   wheel — so nobody could be raced. This file is the racing-driver
   BRAIN: it drives REAL car records (CBZ.cityMakeCar) through the
   same fields the player control loop writes — v, heading, pos,
   vx/vz — so an opponent brakes into corners, carries a racing line,
   defends, attacks, makes skill-proportional mistakes, crashes via
   the REAL car-car collision pass (vehicles.js order 37.6), crumples,
   loses pace with engine damage, spins, and recovers. One brain, two
   course modes:
     • "line"  — a closed parametric racing line (the speedway oval):
                 follow a lookahead point with a lane offset, brake to
                 a curvature-derived corner speed, hug the inside line.
     • "path"  — an open waypoint course (street circuits): road-legal
                 waypoints (callers thread checkpoints through
                 CBZ.cityNav.routeTo), corner-entry slowdown from the
                 bend angle between legs.

   It also owns CBZ.raceKit — the ONE checkpoint/lap/timing/position
   library both the speedway weekend and the street race use, so the
   two hand-rolled one-offs collapse into a shared scorer: live
   ordering, gap-in-seconds ahead/behind, per-lap timing + best lap.

   CONTRACTS honoured (vehicles.js is NOT edited):
   • cars come from CBZ.cityMakeCar → real records in CBZ.cityCars
     with mass/dims, so the order-37.6 crash pass gives door-to-door
     contact real consequences (crumple, spin via wreckT, engine HP).
   • ai=false → the lane AI (order 37) never fights this brain; the
     police pursuer pattern (police.js updatePursuers) proved external
     control of a car record is safe.
   • performance envelope mirrors vehicles.js carDynamics' body-type
     tables (read-only re-derivation — carDynamics isn't exported),
     including the damage degradation curve, so a wrecked opponent
     drives like a wrecked car.
   • visuals may be liveried via CBZ.cityApplyRaceLivery; disposal
     mirrors clearCars (skip _shared geo/mats).

   Runtime-only: all randomness is per-race (Math.random is allowed
   outside world-build paths). Feature-flagged: RACE_REAL_DRIVERS.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const g = CBZ.game;

  CBZ.CONFIG = CBZ.CONFIG || {};
  if (CBZ.CONFIG.RACE_REAL_DRIVERS == null) CBZ.CONFIG.RACE_REAL_DRIVERS = true;

  // ============================================================
  //  PERFORMANCE ENVELOPE — mirror of vehicles.js carDynamics' body
  //  tables + rarity scaling + damage curve (:1441-1502). Read-only
  //  re-derivation; numbers kept identical so an AI Ferrari and the
  //  player's Ferrari share a physics ceiling.
  // ============================================================
  const BODY = {
    coupe:  { accel: 42, top: 44, turn: 3.0,  grip: 9.4, brake: 38 },
    muscle: { accel: 40, top: 41, turn: 2.45, grip: 6.6, brake: 30 },
    sedan:  { accel: 32, top: 35, turn: 2.6,  grip: 7.4, brake: 32 },
    suv:    { accel: 26, top: 31, turn: 2.1,  grip: 5.6, brake: 27 },
    pickup: { accel: 27, top: 32, turn: 2.0,  grip: 5.2, brake: 26 },
    van:    { accel: 23, top: 29, turn: 1.85, grip: 4.8, brake: 24 },
    hatch:  { accel: 29, top: 31, turn: 2.85, grip: 7.2, brake: 31 },
  };
  function perf(car) {
    const bk = car._bk || (CBZ.cityVehicleBodyKind && car.model ? CBZ.cityVehicleBodyKind(car.model) : "coupe");
    const b = BODY[bk] || BODY.sedan;
    const rarity = car.model ? Math.max(0, Math.min(1, car.model.rarity || 0)) : 0.35;
    let accel = b.accel * (0.9 + rarity * 0.22);
    let top = b.top * (0.88 + rarity * 0.28);
    let grip = b.grip, brake = b.brake, turn = b.turn;
    // DAMAGE degrades it exactly like the player's car (carDynamics :1484-85)
    const d = 1 - Math.max(0, Math.min(100, car.engineHp == null ? 100 : car.engineHp)) / 100;
    accel *= 1 - d * 0.55; top *= 1 - d * 0.42; grip *= 1 - d * 0.5; turn *= 1 - d * 0.28;
    return { accel, top, grip, brake, turn, dmg: d };
  }

  function angDiff(a) { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; }
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // ============================================================
  //  THE DRIVER LIST
  // ============================================================
  const D = { list: [] };

  // find a catalog model whose detailStyle matches a racer's homeStyle
  function modelForStyle(style, color) {
    const CARS = (CBZ.cityEcon && CBZ.cityEcon.CARS) || [];
    let m = null;
    for (const c of CARS) { if (c.detailStyle === style) { m = c; break; } }
    if (!m) m = CARS.length ? CARS[CARS.length - 1] : { name: "Race Car", value: 60000, body: "coupe", rarity: 0.9, color: 0xc0392b };
    // shallow clone so the catalog stays untouched; paint = team colour
    return Object.assign({}, m, color != null ? { color: color } : null);
  }

  /* spawn a driver.
     opts = {
       x, z, heading,                       // grid slot
       model | style, color,                // car identity
       livery: {number, base, accent},      // optional (race_livery.js)
       name, number, skill (0..1), aggr (0..1), consistency (0..1),
       tag,                                 // group key for despawnAll
       mode: "line" | "path",
       line: t -> {x,z,tx,tz,nx,nz,heading},// closed course (mode "line")
       lineLen,                             // course length in metres
       trackHalf,                           // half racing-surface width
       path: [{x,z,cp}],                    // open course (mode "path")
       cpTotal,                             // # of checkpoints threaded in path
       playerProgress: fn -> total,         // optional: rubber-band reference
     }                                                                       */
  function spawn(opts) {
    if (!CBZ.cityMakeCar || !CBZ.city || !CBZ.city.arena) return null;
    const model = opts.model || modelForStyle(opts.style || "muscle", opts.color);
    let car = null;
    try { car = CBZ.cityMakeCar(opts.x, opts.z, opts.heading || 0, false, model, 0.3); } catch (e) { return null; }
    if (!car) return null;
    car.ai = false;             // lane AI keeps its hands off — WE are the driver
    car.baseV = 0; car.v = 0; car.vx = 0; car.vz = 0;
    car._raceCar = true;
    if (opts.livery && CBZ.cityApplyRaceLivery) {
      try { CBZ.cityApplyRaceLivery(car.group, opts.livery); } catch (e) { /* headless rigs */ }
    }
    const skill = opts.skill != null ? opts.skill : 0.8;
    const m = {
      car: car, tag: opts.tag || "race",
      name: opts.name || (model.name || "Rival"),
      number: opts.number != null ? opts.number : 0,
      skill: skill,
      aggr: opts.aggr != null ? opts.aggr : 0.5,
      consistency: opts.consistency != null ? opts.consistency : (0.5 + skill * 0.45),
      mode: opts.mode || "line",
      // line mode
      line: opts.line || null, lineLen: opts.lineLen || 700,
      trackHalf: opts.trackHalf || 7,
      t: 0, laps: 0, lane: opts.lane0 || 0, targetLane: opts.lane0 || 0,
      lane0: opts.lane0 || 0, biasT: null,
      // path mode
      path: opts.path || null, wpi: 0, cpPassed: 0, cpTotal: opts.cpTotal || 0,
      finished: false, dnf: false,
      state: "grid",            // grid (held) → race → recover
      stuckT: 0, recoverT: 0,
      mistakeCD: 2 + Math.random() * 5, mistakeT: 0, mistakeSteer: 0,
      playerProgress: opts.playerProgress || null,
      _lapFloor: 0,
    };
    if (m.line) {
      // seat the param at the spawn point so progress starts clean
      m.t = coarseParam(m.line, opts.x, opts.z);
    }
    D.list.push(m);
    return m;
  }

  function coarseParam(line, x, z) {
    let best = 0, bd = Infinity;
    for (let i = 0; i < 96; i++) {
      const t = i / 96, f = line(t);
      const d = (x - f.x) * (x - f.x) + (z - f.z) * (z - f.z);
      if (d < bd) { bd = d; best = t; }
    }
    return best;
  }
  // refine the param near the previous one (cheap local search, handles wrap)
  function paramNear(line, x, z, tPrev) {
    let best = tPrev, bd = Infinity;
    for (let k = -4; k <= 12; k++) {
      const t = (tPrev + k * 0.004 + 1) % 1;
      const f = line(t);
      const d = (x - f.x) * (x - f.x) + (z - f.z) * (z - f.z);
      if (d < bd) { bd = d; best = t; }
    }
    return best;
  }
  // curvature (1/m) of the line a bit ahead of param t
  function curvatureAt(line, t, lineLen) {
    const dq = 0.01;
    const f0 = line((t + 1) % 1), f1 = line((t + dq + 1) % 1);
    const dh = Math.abs(angDiff(f1.heading - f0.heading));
    const ds = Math.max(0.5, dq * lineLen);
    return dh / ds;
  }

  function despawn(m) {
    const i = D.list.indexOf(m);
    if (i >= 0) D.list.splice(i, 1);
    const car = m.car;
    if (!car) return;
    const ci = CBZ.cityCars ? CBZ.cityCars.indexOf(car) : -1;
    if (ci >= 0) CBZ.cityCars.splice(ci, 1);
    car.dead = true;
    if (car.group) {
      if (car.group.parent) car.group.parent.remove(car.group);
      car.group.traverse(function (o) {
        if (o.isSprite) return;
        if (o.geometry && !o.geometry._shared && o.geometry.dispose) { try { o.geometry.dispose(); } catch (e) {} }
        const mm = o.material;
        if (Array.isArray(mm)) mm.forEach((x) => { if (x && !x._shared && x.dispose) x.dispose(); });
        else if (mm && !mm._shared && mm.dispose) { try { mm.dispose(); } catch (e) {} }
      });
    }
  }
  function despawnAll(tag) {
    for (let i = D.list.length - 1; i >= 0; i--) {
      if (!tag || D.list[i].tag === tag) despawn(D.list[i]);
    }
  }
  function setState(state, tag) {
    for (const m of D.list) if (!tag || m.tag === tag) m.state = state;
  }

  // progress in "laps" units (line mode) or waypoint units (path mode)
  function progressOf(m) {
    if (m.mode === "path") {
      if (!m.path || !m.path.length) return 0;
      let frac = 0;
      const wp = m.path[Math.min(m.wpi, m.path.length - 1)];
      if (wp && m.car) {
        const d = Math.hypot(wp.x - m.car.pos.x, wp.z - m.car.pos.z);
        frac = clamp(1 - d / 40, 0, 0.95);
      }
      return (m.wpi + frac) / m.path.length;
    }
    return m.laps + m.t;
  }

  // ============================================================
  //  TRAFFIC SCAN + RACECRAFT — one relative-frame sweep over the
  //  field + the player, reused for lane choice AND the anti-pile-up
  //  speed governor. `ahead.lat` is the other car's lateral offset in
  //  OUR heading frame, so "same line" is geometric, not bookkeeping.
  // ============================================================
  function scanTraffic(m) {
    const car = m.car;
    const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
    const rx = Math.cos(car.heading), rz = -Math.sin(car.heading);
    let ahead = null, aheadDot = 18, behind = null, behindDot = -10;
    function consider(oc, oLane) {
      if (!oc || oc === car || oc.dead) return;
      const dx = oc.pos.x - car.pos.x, dz = oc.pos.z - car.pos.z;
      if (dx * dx + dz * dz > 20 * 20) return;
      const dot = dx * fx + dz * fz;      // + ahead of us, − behind
      const lat = dx * rx + dz * rz;      // + to our right
      if (dot > 1 && dot < aheadDot && Math.abs(lat) < 5) { aheadDot = dot; ahead = { c: oc, lane: oLane, d: dot, lat: lat, v: Math.abs(oc.v || 0) }; }
      else if (dot < -1 && dot > behindDot && Math.abs(lat) < 4) { behindDot = dot; behind = { c: oc, lane: oLane, d: -dot, lat: lat, v: Math.abs(oc.v || 0) }; }
    }
    for (const o of D.list) { if (o.tag === m.tag) consider(o.car, o.lane); }
    const P = CBZ.player;
    if (P && P.driving && P._vehicle) consider(P._vehicle, null);
    return { ahead, behind };
  }
  function racecraft(m, insideLane, traffic) {
    let want = insideLane;
    const car = m.car;
    const ahead = traffic.ahead, behind = traffic.behind;
    if (ahead && Math.abs(car.v) > ahead.v + 1) {
      // ATTACK: swing to the free side of the slower car ahead
      want = ahead.lat >= 0 ? Math.max(-(m.trackHalf - 2.2), insideLane - 2.6)
                            : Math.min(m.trackHalf - 2.2, insideLane + 2.6);
    } else if (behind && behind.d > 4 && m.aggr > 0.45 && behind.v > Math.abs(car.v) - 0.5) {
      // DEFEND: mirror the attacker's line (a block), scaled by aggression —
      // only with daylight behind (never a swerve across someone's nose)
      const oL = behind.lane != null ? behind.lane : clamp(m.lane + behind.lat, -2.6, 2.6);
      want = clamp(oL, -2.6, 2.6) * (0.5 + m.aggr * 0.5);
    }
    return want;
  }

  // ============================================================
  //  THE TICK — order 37.3: after the lane AI (37) has moved traffic,
  //  before the car-car collision pass (37.6) resolves the frame's
  //  contacts. Same slot family as the player loop (11): we write
  //  v/heading/pos/vx/vz and let the shared passes do the physics.
  // ============================================================
  CBZ.onUpdate(37.3, function (dt) {
    if (g.mode !== "city" || !D.list.length) return;
    if (dt > 0.12) dt = 0.12;
    for (let i = 0; i < D.list.length; i++) {
      const m = D.list[i], car = m.car;
      if (!car || car.dead || car._exploded) { m.dnf = true; continue; }
      const P = perf(car);

      // ---- GRID HOLD: parked on the slot, brakes on, engine idling ----
      if (m.state === "grid") {
        car.v = 0; car.vx = 0; car.vz = 0;
        car.group.position.set(car.pos.x, 0, car.pos.z);
        car.group.rotation.y = car.heading;
        continue;
      }

      // ---- WRECKED (the crash pass hit us): spin out, coast, recover ----
      // (vehicles.js order 37 owns this arc for ai-cars; ai=false means we
      //  replicate the spin-coast here so a T-boned racer visibly loses it.)
      if (car.wreckT > 0) {
        car.wreckT -= dt;
        car.v *= Math.pow(0.05, dt);
        car.spin = (car.spin || 0) * Math.pow(0.25, dt);
        car.heading += (car.spin || 0) * dt;
        car.pos.x += Math.sin(car.heading) * car.v * dt;
        car.pos.z += Math.cos(car.heading) * car.v * dt;
        if (CBZ.cityCollideVehicle) CBZ.cityCollideVehicle(car);
        car.vx = Math.sin(car.heading) * car.v; car.vz = Math.cos(car.heading) * car.v;
        car.group.position.set(car.pos.x, 0, car.pos.z);
        car.group.rotation.y = car.heading;
        if (car.wreckT <= 0) { m.state = "race"; m.stuckT = 0; }
        continue;
      }

      // ---- pick the target point + the corner-speed ceiling ----
      let tgtX, tgtZ, cornerV = P.top;
      const v = car.v, vmag = Math.abs(v);
      const traffic = scanTraffic(m);
      if (m.mode === "line" && m.line) {
        // where am I on the course?
        const tPrev = m.t;
        m.t = paramNear(m.line, car.pos.x, car.pos.z, m.t);
        if (tPrev > 0.9 && m.t < 0.1) m.laps++;          // crossed the line
        else if (tPrev < 0.1 && m.t > 0.9) m.laps--;     // rolled back over it
        // lookahead point scales with speed (racing-line pursuit)
        const look = clamp(6 + vmag * 0.5, 8, 26) / m.lineLen;
        const ft = m.line((m.t + look) % 1);
        // corner ceiling from curvature ahead: v = sqrt(a_lat / k). a_lat is
        // arcade-scaled off the grip stat; the aces carry more apex speed.
        const curv = curvatureAt(m.line, m.t + look * 0.6, m.lineLen);
        const aLat = P.grip * (1.7 + m.skill * 0.75);
        cornerV = Math.sqrt(aLat / Math.max(0.002, curv));
        // racing line: hug the INSIDE of corners (−normal), open out on straights
        let insideLane = -(0.8 + m.skill * 1.2) * clamp(curv * 55, 0, 1);
        // LAUNCH DISCIPLINE: hold your grid column off the start and converge
        // to the racing line over the opening seconds — six cars diving for
        // the same apex at once is a first-corner pile-up, not a race.
        if (m.biasT == null) m.biasT = 5;
        if (m.biasT > 0) {
          m.biasT -= dt;
          const mix = clamp(m.biasT / 5, 0, 1);
          insideLane = insideLane * (1 - mix) + (m.lane0 || 0) * mix;
        }
        m.targetLane = racecraft(m, insideLane, traffic);
        m.lane += (m.targetLane - m.lane) * Math.min(1, dt * 1.8);
        m.lane = clamp(m.lane, -(m.trackHalf - 1.6), m.trackHalf - 1.6);
        tgtX = ft.x + ft.nx * m.lane; tgtZ = ft.z + ft.nz * m.lane;
        // ran wide / off the surface → come back on at a sane speed
        const f0 = m.line(m.t);
        const off = (car.pos.x - f0.x) * f0.nx + (car.pos.z - f0.z) * f0.nz;
        if (Math.abs(off) > m.trackHalf + 1.5) { cornerV = Math.min(cornerV, 13); tgtX = f0.x; tgtZ = f0.z; }
      } else if (m.mode === "path" && m.path && m.path.length) {
        if (m.wpi >= m.path.length) { m.finished = true; }
        const wp = m.path[Math.min(m.wpi, m.path.length - 1)];
        tgtX = wp.x; tgtZ = wp.z;
        const d = Math.hypot(tgtX - car.pos.x, tgtZ - car.pos.z);
        if (d < 7 && m.wpi < m.path.length) {
          if (wp.cp != null) m.cpPassed = Math.max(m.cpPassed, wp.cp + 1);
          m.wpi++;
          if (m.cpTotal && m.cpPassed >= m.cpTotal) m.finished = true;
        }
        // corner-entry slowdown: bend angle between this leg and the next
        const nx2 = m.path[Math.min(m.wpi + 1, m.path.length - 1)];
        const a1 = Math.atan2(tgtX - car.pos.x, tgtZ - car.pos.z);
        const a2 = Math.atan2(nx2.x - tgtX, nx2.z - tgtZ);
        const bend = Math.abs(angDiff(a2 - a1));
        const nearV = Math.max(7, P.top * (1 - bend * 0.45));
        const cruise = P.top * (0.72 + m.skill * 0.16);   // street pace < oval pace
        cornerV = d < 22 ? nearV + (cruise - nearV) * clamp((d - 6) / 16, 0, 1) : cruise;
      } else { continue; }

      // ---- pace: skill sets the ceiling; a MILD bounded rubber band keeps
      //      the show close without ever teleporting anyone (GameAIPro c.42) ----
      let pace = 0.86 + m.skill * 0.14;
      if (m.playerProgress) {
        const gap = progressOf(m) - m.playerProgress();
        pace *= clamp(1 - gap * 0.28, 0.93, 1.06);
      }
      let targetV = Math.min(P.top * pace, cornerV);

      // ---- MISTAKES, proportional to (in)consistency: a late-brake or a
      //      wobble that runs the car wide — sometimes into the wall ----
      m.mistakeCD -= dt;
      if (m.mistakeCD <= 0) {
        m.mistakeCD = 3 + Math.random() * 7;
        if (Math.random() < (1 - m.consistency) * (0.3 + m.aggr * 0.25)) {
          m.mistakeT = 0.5 + Math.random() * 0.9;
          m.mistakeSteer = (Math.random() < 0.5 ? -1 : 1) * (0.2 + Math.random() * 0.3);
        }
      }
      if (m.mistakeT > 0) { m.mistakeT -= dt; targetV *= 1.12; }   // carrying too much speed

      // ---- ANTI-PILE-UP GOVERNOR: a car dead ahead on OUR line gets raced,
      //      not rear-ended — match its speed at close range (racecraft is
      //      already steering us to the free side to make the pass) ----
      if (traffic.ahead && Math.abs(traffic.ahead.lat) < 2.1) {
        const closeD = 3.5 + vmag * 0.4;
        if (traffic.ahead.d < closeD) {
          targetV = Math.min(targetV, traffic.ahead.v + Math.max(-2, (traffic.ahead.d - closeD * 0.5) * 0.8));
          // path mode has no lane channel — dodge the blocker by biasing the
          // target point to its free side (streets: swing around, don't shove)
          if (m.mode === "path") {
            const rx2 = Math.cos(car.heading), rz2 = -Math.sin(car.heading);
            const side = traffic.ahead.lat >= 0 ? -1 : 1;
            tgtX += rx2 * side * 3.2; tgtZ += rz2 * side * 3.2;
            targetV = Math.max(targetV, Math.min(cornerV, traffic.ahead.v + 3));   // keep creeping past
          }
        }
      }

      // ---- STEER: pursue the target point, yaw-rate limited like the
      //      player's bicycle-model clamp (speed bleeds steering authority) ----
      const des = Math.atan2(tgtX - car.pos.x, tgtZ - car.pos.z);
      let err = angDiff(des - car.heading);
      if (m.mistakeT > 0) err += m.mistakeSteer;
      const speedNorm = clamp(vmag / Math.max(1, P.top), 0, 1);
      const maxYaw = P.turn * (1 - speedNorm * 0.42);
      const yaw = clamp(err * 3.0, -maxYaw, maxYaw);
      if (vmag > 0.3) car.heading += yaw * dt * (v < 0 ? -1 : 1);

      // hard turn scrubs speed (tyres aren't free) — the wider the error the
      // more the entry speed matters, so a missed apex costs real time
      if (Math.abs(err) > 0.5 && vmag > 12) targetV = Math.min(targetV, vmag * (1 - Math.min(0.5, (Math.abs(err) - 0.5) * 0.5)));

      // ---- THROTTLE / BRAKE toward targetV (the player loop's shapes) ----
      if (v < targetV - 0.5) {
        car.v += P.accel * dt * (1 - Math.min(0.7, Math.max(0, v) / P.top));
      } else if (v > targetV + 0.8) {
        car.v -= P.brake * dt;
      } else {
        // coast: rolling resistance only
        car.v = Math.max(0, car.v - 1.1 * dt);
      }
      car.v = clamp(car.v, -9, P.top);

      // ---- STUCK → RECOVER: nose in a wall / beached after contact.
      //      Back out steering opposite, then re-attack the line. ----
      if (m.state === "recover") {
        m.recoverT -= dt;
        car.v = -6;
        car.heading -= clamp(err, -1, 1) * 1.4 * dt;
        if (m.recoverT <= 0) { m.state = "race"; m.stuckT = 0; }
      } else {
        if (vmag < 1.4 && targetV > 4) m.stuckT += dt; else m.stuckT = 0;
        if (m.stuckT > 1.6) { m.state = "recover"; m.recoverT = 1.1 + Math.random() * 0.6; }
      }

      // ---- integrate + the shared wall contract ----
      car.vx = Math.sin(car.heading) * car.v;
      car.vz = Math.cos(car.heading) * car.v;
      car.pos.x += car.vx * dt;
      car.pos.z += car.vz * dt;
      if (CBZ.cityCollideVehicle) {
        const moved = CBZ.cityCollideVehicle(car);
        if (moved > 0.05 && vmag > 10) {
          // wall strike: shed speed + nick the motor (speed-scaled, the NHTSA
          // ladder shape used by vehicles.js — the perf() damage curve then
          // makes a beat-up racer visibly slower, so wall-riding never pays)
          car.v *= 0.45;
          if (car.engineHp == null) car.engineHp = 100;
          car.engineHp = Math.max(0, car.engineHp - Math.max(0, (vmag - 6) * 0.7));
          if (car.engineHp <= 45) car._smoking = true;
        }
      } else if (CBZ.collide) CBZ.collide(car.pos, 1.0);
      if (m.mode === "path" && CBZ.city.arena && CBZ.city.arena.clampToCity) CBZ.city.arena.clampToCity(car.pos, 1.0);
      car.group.position.set(car.pos.x, 0, car.pos.z);
      car.group.rotation.y = car.heading;
    }
  });

  // ============================================================
  //  CBZ.raceKit — checkpoints / laps / timing / positions.
  //  One scorer for every race in the game.
  //  entrants: [{ id, name, number, color, isPlayer, driver?,
  //               progress: fn -> total (laps+frac | course frac),
  //               speed:    fn -> m/s }]
  // ============================================================
  function createRace(opts) {
    const kit = {
      laps: opts.laps || 1,
      trackLen: opts.trackLen || 700,        // metres per progress-unit (gap→seconds)
      entrants: opts.entrants.map(function (e) {
        return {
          id: e.id, name: e.name, number: e.number, color: e.color,
          isPlayer: !!e.isPlayer, driver: e.driver || null,
          progress: e.progress, speed: e.speed || function () { return 20; },
          total: 0, pos: opts.entrants.length,
          // lapFloor0 = -1 for a grid that sits BEHIND the line: the roll-over
          // crossing arms lap 1 without being scored as one.
          lapFloor: e.lapFloor0 != null ? e.lapFloor0 : 0,
          lapStart: 0, lapTimes: [], best: 0, lastLap: 0,
          finished: false, finishT: 0,
        };
      }),
      time: 0, order: [],
      update: function (dt) {
        kit.time += dt;
        for (const e of kit.entrants) {
          if (e.finished) continue;
          e.total = e.progress();
          // lap crossing → lap time
          const fl = Math.floor(e.total + 1e-6);
          if (fl > e.lapFloor) {
            e.lapFloor = fl;
            const lt = kit.time - e.lapStart;
            e.lapStart = kit.time;
            // fl===0 is the grid roll-over crossing (start of lap 1) — resets
            // the clock but never scores; jitter re-crosses under 3s ignored.
            if (fl > 0 && lt > 3) {
              e.lastLap = lt; e.lapTimes.push(lt);
              if (!e.best || lt < e.best) e.best = lt;
            }
          }
          if (e.total >= kit.laps - 1e-6 && !e.finished) { e.finished = true; e.finishT = kit.time; }
        }
        kit.order = kit.entrants.slice().sort(function (a, b) {
          if (a.finished && b.finished) return a.finishT - b.finishT;
          if (a.finished !== b.finished) return a.finished ? -1 : 1;
          return b.total - a.total;
        });
        for (let i = 0; i < kit.order.length; i++) kit.order[i].pos = i + 1;
      },
      // seconds between two entrants (progress gap × track length ÷ chaser speed)
      gapSeconds: function (ahead, behind) {
        const dp = Math.max(0, ahead.total - behind.total);
        const sp = Math.max(6, behind.speed());
        return dp * kit.trackLen / sp;
      },
      playerRow: function () {
        for (const e of kit.entrants) if (e.isPlayer) return e;
        return null;
      },
      // neighbours of the player in the running order: {ahead, behind, gapA, gapB}
      playerContext: function () {
        const p = kit.playerRow(); if (!p) return null;
        const idx = kit.order.indexOf(p);
        const ahead = idx > 0 ? kit.order[idx - 1] : null;
        const behind = idx < kit.order.length - 1 ? kit.order[idx + 1] : null;
        return {
          row: p, ahead: ahead, behind: behind,
          gapA: ahead ? kit.gapSeconds(ahead, p) : 0,
          gapB: behind ? kit.gapSeconds(p, behind) : 0,
        };
      },
    };
    for (const e of kit.entrants) e.lapStart = 0;
    CBZ.raceKit._last = kit;      // debug/probe handle (headless gates read time)
    return kit;
  }

  CBZ.raceDrivers = {
    spawn: spawn,
    despawn: despawn,
    despawnAll: despawnAll,
    setState: setState,
    progressOf: progressOf,
    modelForStyle: modelForStyle,
    list: function (tag) { return tag ? D.list.filter((m) => m.tag === tag) : D.list.slice(); },
    enabled: function () { return CBZ.CONFIG.RACE_REAL_DRIVERS !== false; },
  };
  CBZ.raceKit = { create: createRace };
})();
