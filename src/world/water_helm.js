/* ============================================================
   src/world/water_helm.js — REAL BOAT PHYSICS. A hull is not a car.

   WHAT THIS REPLACES
   ------------------------------------------------------------
   Until now the ENTIRE marine model in this game was three multipliers at
   city/vehicles.js:1839 — `turn *= 0.5; steerLock *= 0.55; wheelbase *= 1.6`.
   A boat ran the tyre grip model, the friction circle, the fake gearbox and a
   wheelbase bicycle-steer. It steered at zero throttle, it never planed, it
   never drifted, and it pivoted at its own centre of gravity.

   THE SEAM
   ------------------------------------------------------------
     CBZ.marineHelm(car, dt, D) -> boolean
   vehicles.js's player drive loop calls this ONE line after carDynamics() and
   returns immediately if it comes back true, so when it returns true this file
   owns the WHOLE frame for that hull: input, integration, position, collision,
   player/camera sync and engine audio. When it returns false (hull beached,
   airborne off a stunt ramp, flag off, no spec) nothing has been touched and
   the road-car path runs exactly as it does today. That is the degrade path
   and it is a complete, working boat — just the old one.

   THE SEVEN THINGS THAT MAKE IT A BOAT  (research §J)
   ------------------------------------------------------------
   1. A FELT REGIME TRANSITION. Froude Fn = v/sqrt(g*Lwl). Wave-making drag
      peaks at Fn 0.50 — the HUMP — as `waveK*v^2*exp(-((Fn-0.5)/0.15)^2)`.
      Past it, dynamic lift collapses the wetted area and drag FALLS: the wall,
      then the surge. The trim curve rides the same signal (rest 2.5deg ->
      hump 7deg bow-up -> on-plane 3deg), so the bow visibly RISES then DROPS.
      A yacht is permanently below the hump and never planes; a RIB is over it
      almost immediately. Published as car._planing / car._trim.
   2. NO STEERING WITHOUT WAY ON. Outboard/sterndrive hulls VECTOR THRUST:
      F_side = T*sin(steer), so zero throttle is very nearly zero steering
      authority. Rudder hulls get authority from v^2 — near nothing at bare
      steerageway. This is the single biggest tell and the old model had it
      exactly backwards (full authority at any speed, from a wheelbase).
   3. DRIFT. Velocity is decomposed into surge and sway AFTER the heading
      rotates, so the hull's momentum is left behind by the turn automatically;
      sway is then bled by FINITE Fossen-style damping (linear ~3x surge's,
      plus quadratic). The hull visibly slips sideways of its heading and
      recovers. That drift IS the boat feel.
   4. AFT PIVOT POINT. The yaw is applied about a point ASTERN of the hull, so
      the bow sweeps the wide arc and the stern is the fulcrum.
   5. HEEL SIGN FLIPS BY CLASS. Planing powerboats heel INTO the turn (lift
      asymmetry loads the inside chine); displacement hulls heel OUT.
   6. CLASS INERTIA. "Big things commit to a turn" is a cap on yaw
      ACCELERATION (~1/(L^2*m)), not a lower top speed. The yacht takes ~2.4s
      to answer the helm.
   7. CURRENTS. CBZ.waterField.currentAt carries a drifting hull and crabs a
      moving one.
   Plus SLAMMING: re-entry after a crest at >slamV relative vertical velocity
   fires an impulse, a shake and a CBZ.waterHit spray burst.

   CONTRACTS THIS FILE HONOURS
   ------------------------------------------------------------
   - leaves car.v / vx / vz / heading / _pitch / _roll in exactly the shape
     world/water_buoyancy.js (order 38.5) re-seats the hull from;
   - calls CBZ.collide() along the hull centreline so a hull hitting a quay
     STOPS (vehicles.js's collideVehicle deliberately skips walls for marine
     hulls over water — that is why boats phase through docks today);
   - writes P.pos and CBZ.playerChar.group.position;
   - respects CBZ.camRecenterSuspended() before touching CBZ.cam.yaw;
   - drives CBZ.carAudio (voice per hull: outboard buzz vs big diesel);
   - calls CBZ.waterWakeFor(car, dt) feature-detected at the end of the frame,
     with car._planing / _trim / _steerInput / v already published for it.

   FLAGS
     CBZ.CONFIG.WATER_HELM        (default true)  the whole model. false ->
                                  vehicles.js's road physics owns boats again.
     CBZ.CONFIG.BOAT_NO_LAND      (default true)  the waterline is a wall —
                                  CBZ.marineShoreBlock below. false -> boats
                                  drive up the beach and into town again.
     CBZ.CONFIG.BOAT_QUAY_COLLIDE (default true)  hulls stop at quays/seawalls
     CBZ.CONFIG.BOAT_SLAM         (default true)  crest re-entry slams
     CBZ.CONFIG.BOAT_CURRENT      (default true)  ocean current carries hulls
     CBZ.CONFIG.BOAT_AUDIO_VOICE  (default true)  per-hull engine voice;
                                  false -> every boat is the "truck" voice
                                  (today's behaviour) again.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const CFG = (CBZ.CONFIG = CBZ.CONFIG || {});
  if (CFG.WATER_HELM == null) CFG.WATER_HELM = true;
  if (CFG.BOAT_NO_LAND == null) CFG.BOAT_NO_LAND = true;
  if (CFG.BOAT_QUAY_COLLIDE == null) CFG.BOAT_QUAY_COLLIDE = true;
  if (CFG.BOAT_SLAM == null) CFG.BOAT_SLAM = true;
  if (CFG.BOAT_CURRENT == null) CFG.BOAT_CURRENT = true;
  if (CFG.BOAT_AUDIO_VOICE == null) CFG.BOAT_AUDIO_VOICE = true;

  const G = 9.81;
  const SEA_Y_FALLBACK = -0.48;

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function seaMean() { return CBZ.waterSeaY ? CBZ.waterSeaY() : (CBZ.SEA_Y != null ? CBZ.SEA_Y : SEA_Y_FALLBACK); }
  function surfaceAt(x, z) {
    return CBZ.citySeaHeightAt ? CBZ.citySeaHeightAt(x, z) : seaMean();
  }
  function overWater(x, z) { return !!(CBZ.cityWaterAt && CBZ.cityWaterAt(x, z)); }

  // Scratch — this runs every frame for the driven hull; zero allocation.
  const _cur = { x: 0, z: 0 };
  const _probe = { x: 0, y: 0, z: 0 };
  const _shoreN = { x: 0, z: 0 };

  // ============================================================
  //  THE DRAG LAW  (research §A)
  // ============================================================
  // R(v) = dragL*v  +  dragQ*v^2*(1 - 0.55*plane)  +  waveK*v^2*wf(Fn)
  //
  // The middle term is friction/form drag, and planing collapses it because
  // dynamic lift lifts the hull and the wetted area falls with it. The last
  // term is the wave-making HUMP: a Gaussian centred on Fn 0.50, sigma 0.15,
  // exactly the shape a real resistance curve has. Do NOT solve Savitsky —
  // the SHAPE is the whole point, and this shape is what produces "you hit a
  // wall at 8 knots and then it lets go and surges".
  //
  // water_hulls.js SOLVED `thrust` so that R(topMs) == thrust, so a hull's
  // equilibrium speed is its spec-sheet top speed and nothing can run away.
  function dragAt(S, v, plane) {
    const a = Math.abs(v);
    if (a < 1e-4) return 0;
    const fn = a / Math.sqrt(G * S.Lwl);
    const t = (fn - 0.5) / 0.15;
    const wf = t > 5 || t < -5 ? 0 : Math.exp(-t * t);
    return S.dragL * a
      + S.dragQ * a * a * (1 - 0.55 * plane)
      + S.waveK * a * a * wf;
  }

  // Trim (bow-up, radians) vs Froude number: rest -> hump peak -> on plane.
  function trimTarget(S, spd) {
    const fn = spd / Math.sqrt(G * S.Lwl);
    if (fn <= 0.18) return S.trimRest;
    if (fn < 0.5) return S.trimRest + (S.trimHump - S.trimRest) * ((fn - 0.18) / 0.32);
    if (fn < 1.05) return S.trimHump + (S.trimPlane - S.trimHump) * ((fn - 0.5) / 0.55);
    return S.trimPlane;
  }

  // ============================================================
  //  THE WATERLINE IS A WALL   (CBZ.marineShoreBlock, BOAT_NO_LAND)
  // ============================================================
  // You could drive a boat up the beach and into town, and nothing in the game
  // objected. The helm below integrates position freely, and the instant the
  // hull's CENTRE left the water its `overWater` bail handed the frame back to
  // vehicles.js — where a speedboat picks up tyre grip, a friction circle, a
  // five-speed gearbox and a terrain seat and drives inland like a van.
  //
  // The quay resolver (§13) already says "a hull stops at a wall". This is the
  // same sentence about the other edge of the water, and it is a resolver for
  // the same reason: a shoreline you bounce off reads as a shoreline, while a
  // shoreline that merely cuts the throttle reads as a bug.
  //
  // WHY NO NEW DISTANCE FIELD. waterField.shoreAt() is already a SIGNED
  // DISTANCE in metres (negative = water), so a probe reading +3.2 is exactly
  // 3.2 m inland and the push is that number. There is nothing to derive and
  // no second shoreline to keep in sync with the one swim.js, the autopilot
  // and the wildlife already read.
  //
  // BOW, CENTRE AND STERN, SUMMED — the quay resolver's own shape. A 34 m
  // yacht is not a point: it grounds its bow long before its centre. And in a
  // channel narrower than the hull the two banks push back against each other
  // and CANCEL, so a boat threading a creek is squared up rather than fired at
  // one bank. Only the LANDWARD component of the velocity is removed, so a
  // hull running the beach at an angle slides along it and drives off under
  // its own power; head-on, it stops.
  //
  // Returns the metres actually pushed (0 when the hull is clear), and leaves
  // car.v / vx / vz / heading in the shape every caller already re-reads. `S`
  // is optional: a hull with no registered spec (WATER_HELM off, an old save,
  // a boat visual nothing ever measured) still gets a shoreline, sized like
  // the runabout — the guarantee must not depend on the registry being there.
  // Per-frame push cap. The quay resolver uses 0.35 because a hull can spawn
  // INSIDE a dock and must crawl out rather than fire across the harbour. A
  // shoreline penetration is bounded by one frame of travel instead, and the
  // fastest hull in the fleet covers 0.19 m in a frame — so 1.2 m clears any
  // legitimate overshoot the same frame it happens, which is the whole point:
  // the hull's CENTRE must never be allowed to go dry, because that is the
  // condition that hands the frame to the road physics.
  const SHORE_MAX_PUSH = 1.2;
  const SHORE_ANY = { draft: 0.5, loa: 6.2, massT: 1.6 };
  CBZ.marineShoreBlock = function (car, S, dt) {
    if (CFG.BOAT_NO_LAND === false) return 0;
    const WF = CBZ.waterField;
    if (!car || !car.pos || !WF || !WF.shoreAt || !WF.shoreGradient) return 0;
    S = S || SHORE_ANY;
    if (car._shoreCD > 0) car._shoreCD -= (dt || 0);
    // A deep hull grounds a little sooner than a tender. Capped hard at 1.2 m:
    // this is a nod to draft, not a bathymetry claim, and a generous cap would
    // strand a yacht outside its own berth.
    const clear = clamp((S.draft || 0.4) * 0.5, 0, 1.2);
    const half = (S.loa || 6) * 0.40;
    const h = car.heading || 0, fx = Math.sin(h), fz = Math.cos(h);
    let pushX = 0, pushZ = 0, aground = false;
    for (let i = -1; i <= 1; i++) {
      const px = car.pos.x + fx * half * i, pz = car.pos.z + fz * half * i;
      const sd = WF.shoreAt(px, pz) + clear;          // > 0 -> this end is aground
      if (!(sd > 0)) continue;
      aground = true;
      const n = WF.shoreGradient(px, pz, 6, _shoreN); // points water -> land
      pushX -= n.x * sd; pushZ -= n.z * sd;
    }
    if (!aground) return 0;
    const pm = Math.hypot(pushX, pushZ);
    if (pm < 1e-3) return 0;                          // opposing banks cancelled
    const scale = Math.min(1, SHORE_MAX_PUSH / pm);
    car.pos.x += pushX * scale; car.pos.z += pushZ * scale;
    const nx = pushX / pm, nz = pushZ / pm;           // unit normal, seaward
    const into = -((car.vx || 0) * nx + (car.vz || 0) * nz);
    if (into > 0) {
      // Strip the landward component, then scrub the surviving alongshore
      // slide: sand and shingle take way off a hull that is dragging through
      // them, which is what stops a boat "coasting" along a beach forever.
      const cx = (car.vx || 0) + nx * into, cz = (car.vz || 0) + nz * into;
      const rx = fz, rz = -fx;
      const u = (cx * fx + cz * fz) * 0.86;
      const w = (cx * rx + cz * rz) * 0.86;
      car.v = u;
      car.vx = fx * u + rx * w; car.vz = fz * u + rz * w;
      car._yawRate = (car._yawRate || 0) * 0.9;
      // A grounding at speed READS — one shove and one spray burst, on their
      // own cooldown so a hull scraping a beach does not machine-gun the FX
      // layer. Never a fireball: putting a boat on the sand is embarrassing,
      // not fatal.
      if (car.player && into > 2.5 && !(car._shoreCD > 0)) {
        car._shoreCD = 0.5;
        if (CBZ.shake) CBZ.shake(Math.min(0.7, into * 0.09));
        if (CBZ.waterHit) {
          CBZ.waterHit(car.pos.x, surfaceAt(car.pos.x, car.pos.z), car.pos.z,
            { speed: into, mass: (S.massT || 1) * 1000, kind: "vehicle" });
        }
      }
    }
    return pm * scale;
  };

  // ============================================================
  //  THE HELM
  // ============================================================
  const NO_HELM = Object.freeze(Object.create(null));   // an unmanned wheel
  CBZ.marineHelm = function (car, dt, D) {
    if (CFG.WATER_HELM === false) return false;
    if (!car || !car.pos || !car.group || car.dead) return false;
    // A hull launched off a stunt ramp finishes its ballistic arc on the road
    // path (that integrator owns _airY/_airVy) — do not fight it for the frame.
    if (car._airborne) return false;
    if (!CBZ.isMarineHull || !CBZ.isMarineHull(car)) return false;
    const S = CBZ.marineHulls && CBZ.marineHulls.specFor
      ? CBZ.marineHulls.specFor(car) : null;
    if (!S) return false;
    // Beached / over land: the road path (visible wall resolver + terrain seat)
    // is the correct owner of a hull sitting on sand, and how you nudge one off.
    if (!overWater(car.pos.x, car.pos.z)) return false;
    if (!dt || dt <= 0) return true;                 // owned, but nothing to do
    dt = Math.min(dt, 0.05);                          // never integrate a stall

    const P = CBZ.player;
    // NOBODY AT THE HELM. A player who has stepped back from the wheel to ride
    // is still aboard — this file still owns the hull's frame, its camera and
    // its engine voice — but the throttle and the helm are no longer his, so
    // the input comes out of an empty bag and the hull carries its way off
    // exactly as the drag model already says it should. (Same statement
    // vehicles.js's road loop makes; city/passengerseat.js owns the state.)
    const k = (CBZ.cityPaxAboard && CBZ.cityPaxAboard(car)) ? NO_HELM : (CBZ.keys || {});

    // ---- 1. INPUT --------------------------------------------------------
    let throttle = 0;
    if (k["w"]) throttle += 1;
    if (k["s"]) throttle -= 1;
    const backDown = !!k[" "];                        // SPACE = astern thrust
    let steer = 0;
    if (k["a"]) steer += 1;                           // +1 = to PORT (+heading)
    if (k["d"]) steer -= 1;
    // Helm input eases at the hull's own rate: a yacht's wheel is many turns
    // lock to lock, a RIB's tiller is instant.
    const sr = S.steerRate;
    car._steerInput = (car._steerInput || 0) + (steer - (car._steerInput || 0)) * Math.min(1, dt * sr);
    const steerIn = car._steerInput;

    // ---- 2. VELOCITY -> SURGE / SWAY ------------------------------------
    // Decomposed against the CURRENT heading; the yaw below rotates the
    // heading WITHOUT rotating the velocity, which is where the drift is born.
    let h = car.heading || 0;
    let fx = Math.sin(h), fz = Math.cos(h);
    let rx = fz, rz = -fx;                            // local +x = PORT (makeBoat's convention)
    let vx = car.vx, vz = car.vz;
    if (!Number.isFinite(vx) || !Number.isFinite(vz)) { vx = fx * (car.v || 0); vz = fz * (car.v || 0); }
    let u = vx * fx + vz * fz;                        // surge (signed: - is astern)
    let w = vx * rx + vz * rz;                        // sway  (+ is to port)

    // ---- 3. PLANING + TRIM ----------------------------------------------
    const spd0 = Math.abs(u);
    let planeTarget = 0;
    if (S.canPlane && S.planeMs > 0.1) {
      planeTarget = clamp((spd0 - S.planeMs * 0.75) / (S.planeMs * 0.85), 0, 1);
    }
    // Eased, because the hull physically takes a beat to climb onto its own
    // bow wave — the ease is what makes the transition FELT rather than a step.
    car._planing = (car._planing || 0) + (planeTarget - (car._planing || 0)) * Math.min(1, dt * 2.2);
    const plane = car._planing;

    // ---- 4. SURGE INTEGRATION -------------------------------------------
    // Thrust is mass-normalised (m/s^2). Astern thrust is deliberately weak —
    // a screw in reverse is a fraction as efficient as in forward.
    let acc = 0;
    if (throttle > 0) acc += S.thrust;
    else if (throttle < 0) acc -= S.thrust * 0.42;
    if (backDown) acc -= S.thrust * 0.85;             // crash stop / back down
    // Drag ALWAYS opposes the hull's own motion, never the throttle — getting
    // that sign wrong makes a boat accelerate backwards out of reverse.
    const opp = u > 0.02 ? -1 : (u < -0.02 ? 1 : 0);
    const uPrev = u;
    u += (acc + opp * dragAt(S, u, plane)) * dt;
    // Coasting must decay TO zero, never through it.
    if (acc === 0 && opp !== 0 && u * uPrev < 0) u = 0;
    u = clamp(u, -S.reverseMs, S.topMs);
    const spd = Math.abs(u);
    const dirSign = u < -0.05 ? -1 : 1;

    // ---- 5. STEERING AUTHORITY  (research §B) ---------------------------
    // THE defining difference between the two drive classes.
    let authority;
    if (S.steerKind === "thrust") {
      // Outboard / sterndrive: F_side = Thrust * sin(steer). No throttle, no
      // turn. The small residual is the drive leg acting as a passive foil on
      // a coasting hull — enough that a boat gliding into a berth is not
      // literally uncontrollable, far too little to steer with.
      const thr = Math.max(Math.abs(throttle), backDown ? 0.8 : 0);
      authority = Math.min(1, thr + 0.10 * Math.min(1, spd / 6));
    } else {
      // Rudder / foil: F_side proportional to v^2. Authority BUILDS with speed
      // and is near zero at bare steerageway — "she needs way on to answer
      // the helm". Prop wash over the rudder adds a little on throttle.
      const sn = spd / Math.max(0.5, S.topMs * 0.55);
      authority = Math.min(1, sn * sn + (throttle > 0 ? 0.12 : 0));
    }

    // ---- 6. YAW with a CLASS-INERTIA ACCELERATION CAP  (research §E) -----
    // The yaw RATE is what the helm asks for; the yaw ACCELERATION cap is what
    // makes a 260-tonne hull take seconds to answer it. Two different numbers,
    // and conflating them is why "big boat" usually just means "slow boat".
    //
    // BOW / STERN THRUSTER. Everything over ~12m carries one, and without it a
    // rudder hull at berthing speed is genuinely unsteerable (authority goes
    // as v^2, so at 1 m/s a 34m yacht answers the helm at about one degree per
    // second and docking is impossible rather than difficult). Only live below
    // manoeuvring speed, where a real thruster is the only thing working.
    let yawCmd = S.yawRate * authority;
    if (S.thrusterYaw > 0 && spd < 2.5) {
      yawCmd = Math.max(yawCmd, S.thrusterYaw * (1 - spd / 2.5));
    }
    const yawWant = steerIn * yawCmd * dirSign;
    let yawRate = car._yawRate || 0;
    const dw = yawWant - yawRate;
    const maxStep = S.yawAccel * dt;
    yawRate += clamp(dw, -maxStep, maxStep);
    // Hydrodynamic yaw damping: with the helm centred the hull straightens.
    if (Math.abs(steerIn) < 0.03) yawRate *= Math.max(0, 1 - S.yawDamp * dt);
    car._yawRate = yawRate;
    const dTheta = yawRate * dt;
    h += dTheta;
    car.heading = h;
    fx = Math.sin(h); fz = Math.cos(h);
    rx = fz; rz = -fx;

    // ---- 7. SWAY  (research §B: Fossen damping, FINITE) ------------------
    // Re-project the UNROTATED velocity onto the NEW heading: the momentum is
    // left behind by the turn and appears as sway. That is the drift, and it
    // costs nothing because the decomposition does it for us.
    const uOld = u, wOld = w;
    const c = Math.cos(dTheta), s = Math.sin(dTheta);
    u = uOld * c + wOld * s;
    w = wOld * c - uOld * s;
    // The drive itself kicks the STERN sideways (thrust vectoring / rudder
    // side force). Turning to port pushes the stern to starboard, so the hull
    // crabs to starboard on the way in.
    w -= steerIn * authority * S.thrust * 0.22 * dt * dirSign;
    // Finite damping: exponential so it can never overshoot through zero.
    const swayDecay = Math.exp(-(S.swayL + S.swayQ * Math.abs(w)) * dt);
    w *= swayDecay;

    // ---- 8. TRIM + HEEL --------------------------------------------------
    let trim = trimTarget(S, spd);
    if (throttle <= 0 && spd < 0.6) trim = S.trimRest;
    car._trim = (car._trim || S.trimRest) + (trim - (car._trim || S.trimRest)) * Math.min(1, dt * 2.6);
    // group.rotation.x is NOSE-DOWN positive in this engine (see vehicles.js's
    // squat/dive), so bow-up trim is a NEGATIVE _pitch. water_buoyancy.js
    // composes this in the hull's local frame on top of the wave attitude.
    car._pitch = -car._trim;
    // Heel: keyed on yawRate * speed. heelSign +1 heels OUT of the turn
    // (displacement), -1 heels INTO it (planing). Positive _roll raises the
    // port side, i.e. leans to starboard — so a port turn (+yawRate) with
    // heelSign +1 leans outboard, which is the displacement-hull behaviour.
    const heelWant = clamp(S.heelSign * yawRate * spd * S.heelGain, -S.maxHeel, S.maxHeel);
    car._roll = (car._roll || 0) + (heelWant - (car._roll || 0)) * Math.min(1, dt * 3.0);

    // ---- 9. REBUILD VELOCITY + INTEGRATE POSITION ------------------------
    const velX = fx * u + rx * w, velZ = fz * u + rz * w;
    car.v = u;                                        // signed surge (the drive loop's convention)
    car.vx = velX; car.vz = velZ;
    car._drift = Math.abs(w);
    car.pos.x += velX * dt;
    car.pos.z += velZ * dt;

    // ---- 10. AFT PIVOT POINT  (research §B) ------------------------------
    // Rotating the hull about a point ASTERN of it (rather than about the CG)
    // is what makes the BOW sweep the wide arc while the stern acts as the
    // fulcrum. Geometrically this is just "keep the pivot fixed and re-place
    // the hull ahead of it along the new heading". Faded in with speed so a
    // hull turning on the spot in a berth doesn't slew sideways.
    if (Math.abs(dTheta) > 1e-6) {
      const arm = S.pivotAft * Math.min(1, spd / 2.5);
      if (arm > 0.01) {
        const oldFx = Math.sin(h - dTheta), oldFz = Math.cos(h - dTheta);
        car.pos.x += (fx - oldFx) * arm;
        car.pos.z += (fz - oldFz) * arm;
      }
    }

    // ---- 11. CURRENT  (research §C / waterfield.js) ----------------------
    // A drifting hull is CARRIED; a hull under way only crabs. Applied to
    // position rather than velocity so it can never feed back into the sim.
    if (CFG.BOAT_CURRENT !== false && CBZ.waterField && CBZ.waterField.currentAt) {
      const cu = CBZ.waterField.currentAt(car.pos.x, car.pos.z, undefined, _cur);
      const carry = 1 - 0.78 * Math.min(1, spd / 6);
      car.pos.x += cu.x * carry * dt;
      car.pos.z += cu.z * carry * dt;
    }

    // ---- 11.5 THE WATERLINE ----------------------------------------------
    // Last thing to touch position before the seat, so the hull the camera and
    // the buoyancy pass see this frame is one that is actually in the water.
    // The resolver rewrites car.v/vx/vz, so surge and sway are re-read from it
    // rather than kept — everything below (quay, slam, transforms, audio)
    // works off the CORRECTED velocity, not the one that drove ashore.
    if (CBZ.marineShoreBlock(car, S, dt) > 0) {
      u = car.vx * fx + car.vz * fz;
      w = car.vx * rx + car.vz * rz;
    }

    // ---- 12. RIDE HEIGHT -------------------------------------------------
    // water_buoyancy.js (order 38.5) is the authority on the final Y and the
    // full four-probe attitude; this is the provisional seat so the camera and
    // the player transform are right in the SAME frame, and it is the only
    // seat if buoyancy is flagged off. One probe, deliberately — the four-probe
    // query is buoyancy's job and it runs later in this same frame.
    const rideY = surfaceAt(car.pos.x, car.pos.z) + S.rideAbove * (1 - 0.55 * plane);

    // ---- 13. QUAY / SEAWALL COLLISION ------------------------------------
    // vehicles.js's collideVehicle() deliberately returns 0 for a marine hull
    // over water, so today a boat drives THROUGH the harbour wall. Resolve it
    // here instead, along the hull's centreline (a 34m yacht is not a circle)
    // and with the hull's real vertical span, so height-gated colliders (the
    // knee-walls that exist to stop a jumping pedestrian) correctly ignore it.
    if (CFG.BOAT_QUAY_COLLIDE !== false && CBZ.collide) {
      const rad = clamp(S.beam * 0.48, 0.85, 3.4);
      const feetY = rideY - S.draft;
      const headY = rideY + (S.deckY != null ? S.deckY : 1) + 1.2;
      const half = S.loa * 0.36;
      let pushX = 0, pushZ = 0;
      for (let i = -1; i <= 1; i++) {
        _probe.x = car.pos.x + fx * half * i;
        _probe.z = car.pos.z + fz * half * i;
        _probe.y = rideY;
        const bx = _probe.x, bz = _probe.z;
        CBZ.collide(_probe, rad, feetY, headY);
        pushX += _probe.x - bx; pushZ += _probe.z - bz;
      }
      const pm = Math.hypot(pushX, pushZ);
      if (pm > 0.001) {
        // Clamp so a hull wedged in a corner is nudged out over a few frames
        // instead of teleporting across the harbour. 0.35m per frame is still
        // 21 m/s of escape velocity — plenty to clear anything, gentle enough
        // that a hull spawned inside geometry crawls out instead of firing off.
        const scale = Math.min(1, 0.35 / pm);
        car.pos.x += pushX * scale;
        car.pos.z += pushZ * scale;
        if (pm > 0.04 && spd > 1.5) {
          // A hull hitting a wall scrubs off nearly everything and stops. No
          // engine damage and no fireball: a boat bumping a dock is a bump.
          const hard = spd > 9;
          u *= hard ? 0.12 : 0.42;
          w *= 0.25;
          car.v = u;
          car.vx = fx * u + rx * w; car.vz = fz * u + rz * w;
          car._yawRate *= 0.4;
          if (!car._hullBumpCD || car._hullBumpCD <= 0) {
            car._hullBumpCD = 0.35;
            if (CBZ.shake) CBZ.shake(Math.min(1.1, spd * 0.06));
            if (hard && CBZ.sfx) CBZ.sfx("ko");
            if (hard && CBZ.doHitstop) CBZ.doHitstop(0.05);
            if (CBZ.waterHit) {
              CBZ.waterHit(car.pos.x + fx * half, rideY, car.pos.z + fz * half,
                { speed: spd, mass: S.massT * 1000, kind: "vehicle" });
            }
          }
        }
      }
    }
    if (car._hullBumpCD > 0) car._hullBumpCD -= dt;

    // ---- 14. SLAMMING  (research §C) -------------------------------------
    // The bow leaves a crest and comes back down. The signal is the vertical
    // velocity of the SURFACE under the bow — at planing speed the hull
    // traverses a whole wavelength several times a second, so the surface
    // under the bow moves far faster than the swell itself ever does. A stiff
    // (planing) hull takes the full hit; a heavy hull rides over it.
    if (CFG.BOAT_SLAM !== false) {
      const bx = car.pos.x + fx * S.loa * 0.42, bz = car.pos.z + fz * S.loa * 0.42;
      const bowY = surfaceAt(bx, bz);
      if (car._bowPrevY != null) {
        const rel = ((bowY - car._bowPrevY) / dt) * (0.35 + 0.65 * plane);
        car._slamCD = Math.max(0, (car._slamCD || 0) - dt);
        // rel is bounded by the swell amplitude over dt, so a legitimate slam
        // tops out around 8 m/s. Anything above 25 is a teleport (respawn,
        // garage retrieval, a frame the helm did not own) and must not slam.
        if (rel > S.slamV && rel < 25 && spd > 4 && car._slamCD <= 0) {
          car._slamCD = 0.45;
          const sev = Math.min(1, (rel - S.slamV) / 6);
          u *= 1 - 0.10 * sev;                        // the hull is stopped dead a little
          car.v = u;
          car.vx = fx * u + rx * w; car.vz = fz * u + rz * w;
          car._trim = Math.max(0, car._trim - 0.10 * sev);   // the bow is driven DOWN
          car._pitch = -car._trim;
          if (CBZ.shake) CBZ.shake(Math.min(0.85, 0.25 + sev * 0.6));
          if (CBZ.waterHit) {
            CBZ.waterHit(bx, bowY, bz, { speed: rel, mass: S.massT * 1000, kind: "vehicle" });
          }
        }
      }
      car._bowPrevY = bowY;
    }

    // ---- 15. TRANSFORMS --------------------------------------------------
    // Written in the SAME shape the road path writes them, so water_buoyancy
    // at 38.5 composes on top of this exactly as it always has.
    car.group.position.set(car.pos.x, rideY, car.pos.z);
    car.group.rotation.set(car._pitch || 0, h, car._roll || 0);

    const speed = Math.hypot(u, w);
    if (car.player && P) {
      P.pos.set(car.pos.x, rideY, car.pos.z);
      if (CBZ.playerChar && CBZ.playerChar.group) {
        CBZ.playerChar.group.position.copy(P.pos);
        CBZ.playerChar.group.visible = false;
      }
      P.speed = speed;
    }
    if (CBZ.cityUpdatePlayerCarVisual) CBZ.cityUpdatePlayerCarVisual(car, dt);

    // ---- 16. CAMERA ------------------------------------------------------
    // Same recenter the road path uses, and the SAME free-look/look-back veto.
    // A hull's heading leads its track in a drift, so the camera following the
    // heading is exactly what shows you the slip.
    if (car.player && CBZ.cam && speed > 2.5
        && !(CBZ.camRecenterSuspended && CBZ.camRecenterSuspended())) {
      const target = h + Math.PI;
      CBZ.cam.yaw = CBZ.lerpAngle(CBZ.cam.yaw, target, 1 - Math.pow(0.05, dt));
    }

    // ---- 17. ENGINE VOICE ------------------------------------------------
    // No gearbox: a boat's revs track speed and throttle directly, which is
    // why the fake 5-speed the road loop feeds carAudio always sounded wrong
    // in a hull. Voice per class — a 4.5m outboard is not a pair of diesels.
    if (car.player && CBZ.carAudio) {
      const sN = Math.min(1, spd / Math.max(1, S.topMs));
      let rev = 0.10 + sN * 0.78;
      if (throttle > 0 && sN < 0.15) rev = Math.max(rev, 0.55);   // opening up at the dock
      if (throttle === 0 && !backDown) rev = Math.max(0.08, rev * 0.55);
      const voice = CFG.BOAT_AUDIO_VOICE === false ? "truck" : (S.audio || "truck");
      CBZ.carAudio.update(rev, throttle > 0 || backDown ? 1 : 0, 0, voice, false);
    }

    // ---- 18. THE TWO DUTIES THAT ARE NOT ROAD PHYSICS --------------------
    // Owning the frame means owning ALL of it. These two are the parts of the
    // player drive loop that have nothing to do with tyres: a hull at speed
    // still runs down a swimmer, and a shot-up boat still has to finish
    // burning. Both feature-detected (vehicles.js publishes them beside
    // cityCollideVehicle) so an older vehicles.js just means neither happens.
    if (speed > 6 && CBZ.cityVehicleRunOver) CBZ.cityVehicleRunOver(car, speed);
    if (CBZ.cityVehicleTickDamage) CBZ.cityVehicleTickDamage(car, dt);

    // ---- 19. THE WAKE HOOK (WP-4 owns everything it draws) ---------------
    // car._planing, car._trim, car._steerInput, car.v and car._hullSpec are
    // all published above, which is the entire contract.
    if (CBZ.waterWakeFor) {
      try { CBZ.waterWakeFor(car, dt); } catch (e) { /* FX must never break the helm */ }
    }
    return true;
  };

  // "What regime is this hull in right now" — one number for the FX layer and
  // anything that wants to describe a boat without re-deriving Froude.
  CBZ.marineRegime = function (car) {
    const S = car && car._hullSpec;
    if (!S) return null;
    const spd = Math.abs(car.v || 0);
    const fn = spd / Math.sqrt(G * S.Lwl);
    return {
      speedMs: spd, knots: spd / 0.514444, froude: fn,
      planing: car._planing || 0, trim: car._trim || 0,
      regime: fn < 0.35 ? "displacement" : (fn < 0.75 ? "hump" : "planing"),
      drift: car._drift || 0, yawRate: car._yawRate || 0,
    };
  };
})();
