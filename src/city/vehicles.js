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

   BRAKE LIGHTS: every car's rear lamps flare when its driver is on the
   brake (slowing for a red / a queue / a ped, or held stopped). WHY: a
   street where you can SEE everyone obeying the rules is what makes
   blasting through it feel like breaking them — and a wall of brake
   lights ahead reads as "traffic" from a block away. Cost: TWO extra
   shared materials for the whole fleet (a bright clone per distinct
   tail material), swapped by pointer only when a car's braking state
   actually changes. No new meshes, so the model audit stays intact.

   HOLE-PROOFING: cars are the most-looked-at prop in a driving game — a
   visible gap reads as broken art (USER-FILMED BUG: "weird holes"). Every
   visual is passed through sealSeams (thin panels get epsilon-overlap;
   deck slabs riding a sloped hull get skirted DOWN into the body) plus
   ONE dark interior-shell box reusing a material the car already draws
   (merges into an existing batch bucket → zero extra draw calls), so a
   residual crack shows cabin-dark interior/floor pan, never daylight.
   crumpleCar clamps panel offsets so deformation can't tear the hull
   away from the merged static grille/bumpers/glass.

   DRIVING JUICE (PLAYER car only — AI traffic keeps just its brake
   lights): the getaway IS the show. A synthesized ENGINE VOICE
   (systems/audio.js CBZ.carAudio) revs with speed+throttle through
   fake gear steps; the [SPACE] handbrake breaks the rear loose for
   slides with a tyre screech; hard slip lays real RUBBER (one
   80-segment ring-buffer mesh = ONE draw call, oldest overwritten)
   and boils white smoke off the rear wheels. WHY: a corner you can
   hear taken flat and then read in skid marks afterwards is showing
   off — the game's whole point — without one extra HUD pixel.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const mat = CBZ.mat;
  const cmat = CBZ.cmat || mat;
  const boxGeo = CBZ.boxGeom || function (w, h, d) { return new THREE.BoxGeometry(w, h, d); };
  const g = CBZ.game;

  // SHINY material API (world/carfx.js → CBZ.vehicleMat), with a flat-lambert
  // fallback for headless/gallery. Routes the BOX-RIG fallback car's surfaces
  // through the same reflective env-mapped materials the detailed visual uses,
  // so the gallery / no-visual path also reads as polished, not toy-matte.
  function vmat(role, color, opts) {
    return (CBZ.vehicleMat) ? CBZ.vehicleMat(role, color, opts)
                            : cmat(color == null ? 0x888888 : color, opts);
  }

  /* ============================================================
     THE SPEEDOMETER IS ONE CONVERSION — CBZ.speedRead(v)

     OWNER (2026-08-15): "the normal cars in gang city show km/h on the
     speedometer not mph."

     He is reading a number that is too big for the label, and there were THREE
     different answers to "how fast is this car" in the repo, none of them the
     world's own:

       city/carcluster.js   v x 2.4    labelled MPH   (the instrument cluster)
       city/hud.js          v x 3      labelled MPH   (the fallback readout)
       city/roadrules.js    v x 2.4    posted limits compared in mph

     hud.js's own comment admits its 3 is a guess ("rough mph"), and 3 against
     2.4 is a 25% disagreement between two numbers that have appeared in the
     same corner of the same screen — which is the "TWO SPEEDS SHOWN IN BOTTOM
     RIGHT" the owner already complained about once, still there in the
     arithmetic after being fixed in the layout.

     AND 2.4 IS NOT RIGHT EITHER. A world unit in this game is a METRE — a man
     is 1.82 units tall, the prison is 248 x 244 units and is described as
     hectares — and `car.v` is units per second, because `pos.x += vx * dt` is
     the only integration there is. So the conversions are not a taste knob and
     never were:

         1 unit/s  =  2.23694 mph  =  3.6 km/h

     2.4 overstates every speed by 7.3%, which is exactly the flavour of wrong
     that makes a speedometer read like the other unit. It is derived here now,
     once, from the two definitions, and the three consumers ask instead of
     each typing their own. `CAR_SPEED_UNIT` picks the label ("mph" | "kmh")
     and BOTH branches come off the same metres-per-second, so the two can
     never disagree about how fast the car is — only about what to call it.

     SPEED_UNIT_V2=false restores the historical 2.4/3.0 pair at every site. */
  const MPS_PER_UNIT = 1;                 // a world unit is a metre
  const MPH_PER_MPS = 2.2369362920544;    // exact: 3600 / 1609.344
  const KMH_PER_MPS = 3.6;                // exact
  if (CBZ.CONFIG.SPEED_UNIT_V2 == null) CBZ.CONFIG.SPEED_UNIT_V2 = true;
  if (CBZ.CONFIG.CAR_SPEED_UNIT == null) CBZ.CONFIG.CAR_SPEED_UNIT = "mph";
  CBZ.speedMph = function (v) {
    const s = Math.abs(v || 0) * MPS_PER_UNIT;
    return CBZ.CONFIG.SPEED_UNIT_V2 === false ? s * 2.4 : s * MPH_PER_MPS;
  };
  // {n, unit, mph} — n/unit are what to DRAW, mph is the comparable number a
  // posted limit is expressed in, so a caller never converts a limit twice.
  CBZ.speedRead = function (v) {
    const mph = CBZ.speedMph(v);
    if (CBZ.CONFIG.CAR_SPEED_UNIT === "kmh") {
      const s = Math.abs(v || 0) * MPS_PER_UNIT;
      const kmh = CBZ.CONFIG.SPEED_UNIT_V2 === false ? mph * 1.609344 : s * KMH_PER_MPS;
      return { n: Math.max(0, Math.round(kmh)), unit: "KM/H", mph: mph };
    }
    return { n: Math.max(0, Math.round(mph)), unit: "MPH", mph: mph };
  };
  // a posted limit is authored in mph; this is how it is DRAWN
  CBZ.speedLimitRead = function (mphLimit) {
    if (!(mphLimit > 0)) return 0;
    return CBZ.CONFIG.CAR_SPEED_UNIT === "kmh"
      ? Math.round(mphLimit * 1.609344 / 5) * 5 : Math.round(mphLimit);
  };

  // CRASH SEVERITY THRESHOLDS — re-grounded in real-world crash data (NHTSA/IIHS).
  // The sim's speed unit ≈ 2.4 mph (sedan top ≈ 35u ≈ 80 mph; cruise 7-12u ≈ 20-30
  // mph), so the bands below map onto the real damage ladder:
  //   • < 5 mph  (≈ 2u)   : fender-bender — scratches/dents/bumper scuff only.
  //   • 10-15 mph(≈ 4-6u) : minor body damage, fully drivable.
  //   • 20-30 mph(≈ 8-13u): real body/frame damage — a "hard" crash.
  //   • 35-40+mph(≈ 14-17u): severe → total-loss territory — "catastrophic".
  // The OLD carHard:8 fired a "real crash" at ~13 mph closing AND mass-inflated
  // severity pushed slow bumps over it, so a parking-lot tap gutted the engine and
  // could reach a fireball. Bars raised so low-speed contact stays cosmetic and a
  // car survives many bumps before it's a wreck.
  const CRASH = CBZ.cityCrashTune = {
    wallHard: 20, wallCatastrophic: 30,   // ~48 / ~72 mph into a fixed wall
    carHard: 14, carCatastrophic: 30,     // ~real body damage / total-loss closing severity
    pedLethal: 14, npcDriverLethal: 30,
    // Speedway loaners + race-grid cars are race-prepped, not disposable.
    // Crashes still crumple/smoke/disable them; bullets and blasts stay full force.
    raceCrashDamageMul: 0.72, raceForceFire: 44,
  };

  // ---- MARINE (boat) HANDLING — NO-DECOY FIX -------------------------------
  // playercars.js's FEEL table already tags style "boat" with `marine:true`,
  // but nothing downstream ever branched on it: a player who cycled into the
  // boat visual was still driving ordinary road physics wearing a hull mesh.
  // This is the minimal real branch: (a) a boat drifting over open water
  // skips the building/seawall wall-resolver + clampToCity — a hull nosing
  // out of the harbor toward the sea shouldn't crunch on the same knee-wall
  // collider that stops a pedestrian at the quay; (b) it rides at a fixed
  // near-water Y instead of the flat car y=0 (this engine has no terrain-
  // following suspension at all — every car sits at y=0 — so "float" here
  // just means "don't sit at the car height"); (c) slower/wider turning, tuned
  // in carDynamics below. No buoyancy sim — the bar is "reads like a boat,
  // not a car", not physical accuracy. WATER_Y is a shade above swim.js's
  // SURF_Y (-0.38, a half-submerged SWIMMER's chest height) since a boat
  // rides ON the surface, not in it.
  const WATER_Y = -0.12;
  // true iff this car's CURRENT handling class is the boat one — checks the
  // live playercars.js feel hook first (style-cycler can change it mid-drive)
  // and falls back to the model's own body so a freshly-entered boat (before
  // cityPromotePlayerCar has run) still reads as marine.
  function isMarineCar(car) {
    if (!car) return false;
    const feel = car._playerCarFeel;
    if (feel) return !!feel.marine;
    return !!(car.model && car.model.body === "boat");
  }
  // feature-detected: swim.js exposes "is this point open water" (used for the
  // player's own swim state); reuse it here instead of re-deriving shorelines.
  function overWater(x, z) { return !!(CBZ.cityWaterAt && CBZ.cityWaterAt(x, z)); }

  // ==========================================================================
  //  VEHICLES STAND ON THE GROUND  (CBZ.CONFIG.VEHICLE_TERRAIN, default ON)
  // ==========================================================================
  // OWNER, verbatim: "IT'S NOT LIKE DRIVING ON HILLS, IT'S LIKE DRIVING ON
  // WATER." He was describing arithmetic, not a feeling: EVERY car in this file
  // wrote `group.position.set(pos.x, 0, pos.z)` — a literal zero — at seven
  // separate sites, and the file's own comment admitted it ("this engine has no
  // terrain-following suspension — every car sits at y=0"). Measured against
  // the rendered country plate that is a mean 11.0 m and a max 22.9 m of green
  // ground passing through the bodywork.
  //
  // `seatCar` REPLACES those seven `position.set(x, 0, z)` calls — it is not a
  // parallel bookkeeping layer, it is the line the caller already wrote. One
  // call now buys ride height, terrain pitch and terrain roll.
  //
  // PROBE COUNT IS THE WHOLE PERFORMANCE STORY. CBZ.floorAt costs ~0.35 µs once
  // continent.js's TERRAIN_PHYSICS_MATCH grid is live (it was 6.03 µs against
  // the analytic field — 17x worse, and at that price this feature could not
  // ship). A NEAR car takes 4 probes (a wheel at each corner: height is their
  // mean, pitch and roll fall out of the differences); a FAR car takes 1 and
  // keeps its attitude flat, because nobody can see the attitude of a car they
  // cannot see. ~150 cars, mostly far: ≈ 300 probes/frame ≈ 0.1 ms/s.
  if (CBZ.CONFIG && CBZ.CONFIG.VEHICLE_TERRAIN == null) CBZ.CONFIG.VEHICLE_TERRAIN = true;
  const TERRAIN_ON = function () {
    return (!CBZ.CONFIG || CBZ.CONFIG.VEHICLE_TERRAIN !== false) && !!CBZ.floorAt;
  };
  // How hard the body is allowed to follow the ground. A real suspension is a
  // low-pass filter, not a rigid follower: without this a 40 m plate triangle
  // edge reads as a step, and cars twitch on it.
  const TERRAIN_EASE = 9;          // 1/s exponential approach on ride height
  const TERRAIN_ATT_EASE = 6;      // 1/s on pitch/roll
  const TERRAIN_MAX_TILT = 0.55;   // rad — a car never stands on its nose
  /* `fromY` IS WHAT LETS A CAR DRIVE ONTO STEEL. Passed, this consults
     CBZ.mpGroundAt — the SAME query the player's feet make (physics.js's
     groundAt calls it right after its static-platform loop) — so a car and a
     body agree about what the floor is on a trailer ramp, a boat deck, a lift,
     or anything any future rig declares. It is militaryvehicles.js's floorY,
     verbatim in shape, because that file already solved "even a tank can drive
     into the back" and a second answer would be a second answer.
     OMITTED, this is byte-identical to the terrain-only line it replaces, which
     is what keeps CBZ.cityCarGroundY's two-argument contract intact for every
     external caller and what keeps the cost off the ~240 probes a frame the
     ambient fleet makes. Only the car somebody is STEERING passes it: an AI
     lane-follower is never going to be driven up a ramp, and paying six rig
     tests per corner per car per frame so it could would be the quiet cost this
     repo keeps finding in itself.
     fromY also gates it honestly — mpGroundAt only offers support within
     STEP_UP of where you already are, so a car cannot levitate onto a deck it
     never touched. It has to come at the ramp from the bottom.

     …EXCEPT FROM ITS OWN CARGO FLOOR, WHICH IS THE ONE DECK THAT TRAVELS WITH
     THE CAR ASKING. `self` is what closes that, and it is not a hypothetical:
     a freight body's hold is a moving-platform rig anchored to its own group,
     so the deck is ALWAYS exactly deckTop() above the car, and "within STEP_UP
     of where you already are" is therefore permanently true for any hold
     shallower than 0.45 m. MEASURED on a live van (deck 0.26): the two REAR
     terrain corners sit inside the cargo box — the box runs to −0.47·len and
     the corners are sampled at ±0.45·len — and each came back 0.259 m high, so
     a van somebody was DRIVING was being held up by the floor of its own load
     space and settled ~0.13 m off the road, tail high. The semi measured 0.000
     on all four corners and always will: its deck is 0.95, which STEP_UP
     cannot reach from the ground, so it can never bootstrap. This was a
     van-only fault and it is the only body the flag ships shallow enough.
     The test is done in the ASKING CAR'S OWN FRAME, not by height, because
     height cannot tell the two cases apart: driving a van up a semi's ramp,
     the support is at the van's own feet (local y ≈ 0, well under its 0.26
     deck) and is taken; its own floor is at local y = deckTop and is refused.
     `self` omitted → byte-identical to the two-argument contract above. */
  const _ownLo = {};
  function ownCargoFloor(car, x, y, z) {
    const h = car && car.hold;
    if (!h || h.inert || !h.localOf) return false;
    const l = h.localOf(x, y, z, _ownLo);
    return !!l && l.y > h.deckTop() - 0.06;
  }
  function groundY(x, z, fromY, self) {
    if (!TERRAIN_ON()) return 0;
    const y = +CBZ.floorAt(x, z);
    let b = Number.isFinite(y) ? y : 0;
    if (fromY != null && CBZ.mpGroundAt) {
      try {
        const t = CBZ.mpGroundAt(x, z, fromY, b);
        if (t > b && isFinite(t) && !ownCargoFloor(self, x, t, z)) b = t;
      } catch (e) {}
    }
    return b;
  }
  CBZ.cityCarGroundY = groundY;
  // Sample the four corners and fold them into ride height + terrain attitude.
  // `near` false = one probe, flat attitude (the far-car budget).
  function terrainSeat(car, near, dt) {
    if (!TERRAIN_ON()) { car._terrY = 0; car._terrPitch = 0; car._terrRoll = 0; return 0; }
    const h = +car.heading || 0;
    const fx = Math.sin(h), fz = Math.cos(h);
    const d = vehicleDims(car);
    const half = Math.max(1, (d && d.length ? d.length : 4.2) * 0.45);
    const halfW = Math.max(0.6, (d && d.width ? d.width : 1.9) * 0.45);
    let gy, pitch = 0, roll = 0;
    // the DRIVEN car — and only the driven car — asks about moving decks too
    const fromY = car.player ? (car._terrY != null ? car._terrY : (car.pos.y || 0)) : null;
    if (near) {
      // right vector = (fz, -fx) with this file's (sin,cos) forward convention
      const rx = fz, rz = -fx;
      const fL = groundY(car.pos.x + fx * half + rx * halfW, car.pos.z + fz * half + rz * halfW, fromY, car);
      const fR = groundY(car.pos.x + fx * half - rx * halfW, car.pos.z + fz * half - rz * halfW, fromY, car);
      const bL = groundY(car.pos.x - fx * half + rx * halfW, car.pos.z - fz * half + rz * halfW, fromY, car);
      const bR = groundY(car.pos.x - fx * half - rx * halfW, car.pos.z - fz * half - rz * halfW, fromY, car);
      gy = (fL + fR + bL + bR) * 0.25;
      // nose-up is NEGATIVE rotation.x with this rig (see the airborne pitch,
      // which uses -vy), so climbing (front higher than back) pitches negative.
      pitch = -Math.atan2(((fL + fR) - (bL + bR)) * 0.5, half * 2);
      roll = Math.atan2(((fL + bL) - (fR + bR)) * 0.5, halfW * 2);
      if (pitch > TERRAIN_MAX_TILT) pitch = TERRAIN_MAX_TILT; else if (pitch < -TERRAIN_MAX_TILT) pitch = -TERRAIN_MAX_TILT;
      if (roll > TERRAIN_MAX_TILT) roll = TERRAIN_MAX_TILT; else if (roll < -TERRAIN_MAX_TILT) roll = -TERRAIN_MAX_TILT;
    } else {
      gy = groundY(car.pos.x, car.pos.z, fromY, car);
    }
    // suspension damping. A car that has never been seated snaps to the ground
    // on its first frame (no drop-in from y=0 when it spawns on a hill).
    const k = dt > 0 ? 1 - Math.exp(-TERRAIN_EASE * dt) : 1;
    const ka = dt > 0 ? 1 - Math.exp(-TERRAIN_ATT_EASE * dt) : 1;
    car._terrY = car._terrY == null ? gy : car._terrY + (gy - car._terrY) * k;
    car._terrPitch = car._terrPitch == null ? pitch : car._terrPitch + (pitch - car._terrPitch) * ka;
    car._terrRoll = car._terrRoll == null ? roll : car._terrRoll + (roll - car._terrRoll) * ka;
    return car._terrY;
  }
  // THE call every ambient/AI/wreck site makes instead of writing a literal 0.
  //   seatCar(car, dt, extraY, near) — extraY is the site's own offset (a
  //   drowned wreck's -1.1, a boat's WATER_Y); `near` defaults to the car's own
  //   visibility, which every one of those sites already computed.
  // PARKED / ABANDONED hulls never enter the drive loop, so they kept the
  // literal y=0 they were spawned at — and a parked car sitting in the green at
  // the edge of a lot is EXACTLY the screenshot the owner sent. Seat them once,
  // and again only when something has moved them: a still car costs three float
  // compares a frame and no ground probe at all.
  function parkSeat(c) {
    if (!TERRAIN_ON() || !c || !c.group || !c.pos) return;
    if (c._parkX === c.pos.x && c._parkZ === c.pos.z && c._parkH === c.heading) return;
    c._parkX = c.pos.x; c._parkZ = c.pos.z; c._parkH = c.heading;
    c._terrY = c._terrPitch = c._terrRoll = null;     // snap onto the hill, no drop-in
    seatCar(c, 0, 0, true);
  }
  function seatCar(c, dt, extraY, near) {
    const base = terrainSeat(c, near == null ? !!c.group.visible : !!near, dt || 0);
    const y = base + (extraY || 0);
    c.group.position.set(c.pos.x, y, c.pos.z);
    let px = c._terrPitch || 0, rz = c._terrRoll || 0;
    // A BLOWN TIRE'S SAG. cityCarTireHit wrote rotation.x/z ONCE on an AI car
    // with the comment "the AI loop only writes rotation.y" — which stopped
    // being true the moment this function started writing a terrain attitude,
    // and the sag would have been erased on the very next frame. It composes
    // now, exactly the way the player car composes _pitch/_roll on top.
    if (c._flats) { const L = flatLean(c); if (L) { px += L.pitch; rz += L.roll; } }
    c.group.rotation.set(px, c.heading, rz);
    if (c.npcDriver && c.npcDriver.pos) c.npcDriver.pos.set(c.pos.x, y, c.pos.z);
    return base;
  }

  // ---- RUN-OVER JUICE ------------------------------------------------------
  // A lethal run-over currently fires shake + a speed-bleed but — unlike a melee
  // land() (combat.js) — NO hit-stop and NO bass impact, so a kill at speed reads
  // LIGHTER than a punch. This restores the "thunk": a TINY hit-stop, a one-frame
  // car-speed "catch", and a bass-heavy impact voice scaled by impact speed.
  // WHY tiny: loop.js decrements CBZ.hitstop by the WORLD dt (clamped to 0.05s);
  // on the weak Mac at ~5 FPS one rendered frame ≈ 0.2s of wall-clock, so the
  // loop's clamped 0.05 drain means even a 0.05 hit-stop is ~ONE near-frozen
  // frame — long enough to read as weight, short enough not to swallow an input
  // sample. A bigger value here would eat a keypress at low FPS (research:
  // hitstop is "3–5 frames" — but that's at 60 FPS; at 5 FPS 3 frames is a
  // visible stall). Fired AT MOST ONCE per runOver() call (a car can clip
  // several bodies in one frame — we must never stack N hit-stops / spam the
  // audio channel). MP-SAFE: hit-stop scales this client's LOCAL sim dt only,
  // SFX/shake are local present-path effects, and we touch no networked state
  // beyond the car.v bleed the lethal path ALREADY applies here (host-sim value,
  // broadcast via snapshots like today); guests see the ragdoll via snapshots.
  // No ped HP / death / crime / witness / population logic is touched.
  if (CBZ.runoverJuice === undefined) CBZ.runoverJuice = true;   // default ON; honour an owner toggle
  let _s = 1234;
  function rng() { _s = (_s * 1103515245 + 12345) & 0x7fffffff; return _s / 0x7fffffff; }
  let _trafficStopNoteT = 0;   // global cooldown for the ambient "traffic stop nearby" feed line
  const TR = () => (CBZ.CITY && CBZ.CITY.traf) || {};
  // multi-lane geometry (mirrors traffic.js): lane index → signed lateral offset.
  // ROAD-AWARE via CBZ.roadLaneCenter(r,dir,idx) / CBZ.roadLanesPerDir(r): a car
  // on a 3+3 highway now targets the right lane count/centres and sits outboard
  // of the median, instead of the old global-2-lane guess that hugged the centre-
  // line. Guard-called so a missing helper falls back to the old global math.
  const lanesPerDir = (r) => (CBZ.roadLanesPerDir ? CBZ.roadLanesPerDir(r) : Math.max(1, (TR().lanesPerDir != null ? TR().lanesPerDir : 2) | 0));
  const laneWidth = () => (TR().laneW != null ? TR().laneW : 3.6);
  const laneOffset = (r, dir, idx) => (CBZ.roadLaneCenter ? CBZ.roadLaneCenter(r, dir, idx) : dir * laneWidth() * (idx + 0.5));

  /* ======================================================================
     THE INTELLIGENT DRIVER MODEL (Treiber, Hennecke & Helbing 2000)

     WHY THIS AND NOT MORE HEURISTICS. Ambient traffic here used to decide its
     speed with a stack of independent caps — "if the gap is under X, target
     the leader's speed times 0.85", "if the light is red, target
     distance × 1.25" — each reasonable alone and collectively the reason the
     owner reads our traffic as dumb. Threshold rules do nothing at all until
     their threshold trips and then act at full strength, so a queue of cars
     coasts, stamps on the brakes together, releases together, and concertinas.
     That is a real phenomenon in the WORLD (the phantom jam), but in the world
     it DAMPS OUT and here it amplified, because nothing in the rule set was
     continuous.

     IDM is one continuous equation and it is the standard answer:

         vdot = a · [ 1 − (v/v0)^delta − (sStar / s)² ]
         sStar = s0 + v·T + (v·dv) / (2·sqrt(a·b))

     v0 desired speed · s actual bumper gap · Δv closing rate (v − v_lead).
     The braking term is ALWAYS slightly on and grows as the square of how far
     inside your desired gap you are, so following looks like following.

     It is also COLLISION-FREE BY CONSTRUCTION: as s → s0 the braking term
     diverges, so the model cannot drive into the car in front as long as the
     integrator keeps up — which removes a whole class of shunt bug rather than
     patching it.

     EVERY HAZARD IS A LEADER. A red light is a stationary car on the stop
     line; a pedestrian in the lane is a stationary car where they stand. One
     equation, applied three times, replaces three unrelated heuristics — and
     each caller takes the MINIMUM acceleration, which is just "obey the
     scariest thing you can see".

     PARAMETERS are the published calibration, then bent by the driver
     personality this file already carries (`driver.aggr`, `reckless`): a
     maniac runs a 0.5 s headway and accelerates harder; a cautious driver runs
     1.8 s. δ = 4 is the canonical exponent (it controls how acceleration
     tapers as v → v0).

     Flag: CBZ.CONFIG.TRAFFIC_IDM — false restores the original cap stack and
     the original Euler step exactly, in one line.
     ====================================================================== */
  if (CBZ.CONFIG && CBZ.CONFIG.TRAFFIC_IDM == null) CBZ.CONFIG.TRAFFIC_IDM = true;
  const IDM = {
    s0: 2.0,        // jam distance — bumper gap at a dead stop
    T: 1.5,         // desired time headway (s), published calibration
    a: 1.9,         // max acceleration (m/s²) — above the 0.73 highway figure:
                    //   this is a city at game pace, and a car that pulls away
                    //   from a green like a real one feels better than one that
                    //   is technically correct on a motorway
    b: 2.6,         // comfortable deceleration (m/s²)
    bMax: 9.0,      // physical limit — the only hard clamp in the model
    delta: 4,       // acceleration exponent (canonical)
  };
  function IDM_ON() { return !CBZ.CONFIG || CBZ.CONFIG.TRAFFIC_IDM !== false; }

  // One IDM evaluation. `s` is the bumper gap to the hazard (pass 1e6 for the
  // free road), `dv` the closing rate. `c` supplies the personality.
  function idmAccel(v, v0, s, dv, c) {
    const aggr = (c && c.driver && c.driver.aggr) || 0.3;
    // a maniac tailgates and accelerates hard; a cautious driver leaves room.
    const T = c && c.reckless ? 0.5 : (1.9 - aggr * 1.1);
    const a = IDM.a * (c && c.reckless ? 1.35 : (0.85 + aggr * 0.5));
    const b = IDM.b * (c && c.reckless ? 1.25 : 1);
    const free = 1 - Math.pow(v / Math.max(0.5, v0), IDM.delta);
    // s* may not go below the jam distance, and a NEGATIVE closing rate (the
    // leader pulling away) must not be allowed to shrink the desired gap below
    // s0 — that is the classic IDM sign trap and it makes cars creep forward
    // into a moving leader.
    const sStar = Math.max(IDM.s0, IDM.s0 + v * T + (v * dv) / (2 * Math.sqrt(a * b)));
    const ratio = sStar / Math.max(0.3, s);
    const acc = a * (free - ratio * ratio);
    return Math.max(-IDM.bMax, Math.min(a, acc));
  }
  CBZ.cityTrafficIDM = idmAccel;      // exported so the airside/service AI can share it
  let brakeAt = 1e9;                  // per-car scratch: distance to a body in lane

  // ---- ambient car MODEL builder ----------------------------------------
  // Cars read as real vehicles: a low body with a chamfered roof/hood, a
  // separate glass-tinted greenhouse (windshield + side windows), four dark
  // wheels at the corners, pale emissive headlights + red taillights, and one
  // of seven BODY TYPES (hatch / sedan / SUV / pickup / van / muscle / coupe) with distinct
  // proportions. crumpleCar animates userData.body + userData.cabin, so those
  // two meshes stay the deformable hull (low at y≈0.78) and roof (y≈1.45).
  const WHEEL_GEO = new THREE.CylinderGeometry(0.45, 0.45, 0.42, 16);   // rounder tyre
  WHEEL_GEO._shared = true;
  const HUB_GEO = new THREE.CylinderGeometry(0.2, 0.2, 0.44, 8);
  HUB_GEO._shared = true;
  const WEDGE_GEOS = new Map();
  function boxMesh(w, h, d, material) { return new THREE.Mesh(boxGeo(w, h, d), material); }
  // a flat-topped wedge prism (a chamfered slab) used for the hull + roof so
  // the body isn't a plain box — tapered top, full-width bottom.
  function wedgeGeo(w, h, d, topFrac, noseFrac, tailFrac) {
    topFrac = topFrac == null ? 0.82 : topFrac;
    const key = [w, h, d, topFrac, noseFrac == null ? 1 : noseFrac, tailFrac == null ? 1 : tailFrac].join("|");
    const cached = WEDGE_GEOS.get(key); if (cached) return cached;
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
    geo._shared = true;
    WEDGE_GEOS.set(key, geo);
    return geo;
  }

  function mergeGeometryCopies(geos) {
    let vertices = 0;
    for (const geo of geos) vertices += geo.attributes.position.count;
    const pos = new Float32Array(vertices * 3);
    const nrm = new Float32Array(vertices * 3);
    let pi = 0;
    for (const geo of geos) {
      pos.set(geo.attributes.position.array, pi);
      if (geo.attributes.normal) nrm.set(geo.attributes.normal.array, pi);
      pi += geo.attributes.position.array.length;
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    out.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
    out.computeBoundingSphere();
    return out;
  }

  // ---- ALLOY RIM geometry (shared, built once): a bright wheel face = flat disc
  //      + 5 radial spokes + hub cap, baked into ONE geometry for a radius-0.45
  //      reference wheel and SCALED per car in addWheels. Replaces the old plain
  //      hub cylinder so wheels read as machined alloys, not black discs.
  let RIM_GEO = null;
  function buildRimGeo() {
    if (RIM_GEO) return RIM_GEO;
    try {
      const r = 0.45, width = 0.42, rimR = r * 0.66, parts = [];
      const pushNI = (g3) => { g3.computeVertexNormals(); parts.push(g3.index ? g3.toNonIndexed() : g3); };
      pushNI(new THREE.CylinderGeometry(rimR, rimR, width * 0.5, 16));   // rim face disc
      const spokeLen = rimR * 0.95, spokeW = r * 0.13, spokeT = width * 0.52;
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        const s = new THREE.BoxGeometry(spokeLen, spokeW, spokeT);
        s.translate(spokeLen * 0.5, 0, 0);
        s.applyMatrix4(new THREE.Matrix4().makeRotationY(a));
        pushNI(s);
      }
      pushNI(new THREE.CylinderGeometry(r * 0.17, r * 0.17, width * 0.62, 8));   // hub cap
      RIM_GEO = mergeGeometryCopies(parts);
      parts.forEach((g3) => g3.dispose && g3.dispose());
    } catch (e) {
      RIM_GEO = HUB_GEO;   // headless renderer w/o BufferGeometry baking: fall back to the old cap
    }
    RIM_GEO._shared = true;
    return RIM_GEO;
  }

  // Ambient-car parts never animate independently, except for the deformable
  // hull and cabin. Bake the rest into a few per-material meshes so richer car
  // silhouettes do not cost dozens of draw calls per traffic vehicle.
  function mergeStaticCarParts(grp, keep) {
    const isMesh = (o) => !!(o && o.geometry && o.material);
    const sourceParts = grp.children.reduce((n, o) => n + (isMesh(o) ? 1 : 0), 0);
    const buckets = new Map();
    for (const mesh of grp.children.slice()) {
      if (!isMesh(mesh) || keep.has(mesh) || Array.isArray(mesh.material)) continue;
      // renderOrder joins the bucket key: playercars.js's markGlassOrder puts
      // every transparent pane at 1 so the interior behind it is unambiguously
      // drawn first, and a merge that dropped that would silently undo it (the
      // merged mesh takes the PROTOTYPE's flags, and a bucket is only allowed
      // to hold meshes that agree on every flag it will inherit).
      const key = [mesh.material.id, mesh.castShadow ? 1 : 0, mesh.receiveShadow ? 1 : 0,
        mesh.renderOrder | 0].join("|");
      (buckets.get(key) || buckets.set(key, []).get(key)).push(mesh);
    }
    buckets.forEach((meshes) => {
      if (meshes.length < 2) return;
      const proto = meshes[0];
      let mergedGeo;
      if (proto.updateMatrix && proto.geometry.attributes && proto.geometry.attributes.position && proto.geometry.clone && proto.geometry.applyMatrix4) {
        const copies = meshes.map((mesh) => {
          mesh.updateMatrix();
          const geo = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
          geo.applyMatrix4(mesh.matrix);
          return geo;
        });
        mergedGeo = mergeGeometryCopies(copies);
        copies.forEach((geo) => geo.dispose && geo.dispose());
      } else {
        // Lightweight test renderers do not implement BufferGeometry baking.
        mergedGeo = proto.geometry;
      }
      const merged = new THREE.Mesh(mergedGeo, proto.material);
      merged.castShadow = proto.castShadow;
      merged.receiveShadow = proto.receiveShadow;
      merged.renderOrder = proto.renderOrder;
      if (proto.userData && proto.userData.carGlass) merged.userData.carGlass = true;
      merged.matrixAutoUpdate = false;
      grp.add(merged);
      meshes.forEach((mesh) => grp.remove(mesh));
    });
    grp.userData.sourceParts = sourceParts;
    grp.userData.drawMeshes = grp.children.reduce((n, o) => n + (isMesh(o) ? 1 : 0), 0);
  }

  // ---- HOLE-PROOFING (USER-FILMED BUG: "some cars have weird holes in them").
  //      Systematic, not per-model — runs on every visual BEFORE batching:
  //      • deck slabs (hood/trunk breaks, tonneau, roof caps) ride the body
  //        prism's SLOPING nose/tail, so their leading edge floats with an open
  //        slit under it → extend the box DOWN into the hull (the buried part
  //        is invisible; the exposed part reads as a proper panel edge).
  //      • racing stripes were authored ~0.19 above the hood line → settle
  //        them onto the deck and skirt them down a touch.
  //      • every other thin box (door seams, plates, lamps, glass slabs) gets
  //        a few cm of epsilon-overlap on its thin axes so abutting panels
  //        interpenetrate — backface culling can no longer show daylight
  //        through an exact-contact seam at grazing angles.
  //      Touches mesh.scale/position only (geometries are shared caches), and
  //      everything still merges into the same per-material buckets.
  function extendBoxDown(mesh, by) {
    const p = mesh.geometry.parameters, h = p.height;
    by = Math.min(by, mesh.position.y - h / 2 - 0.12);   // never punch below the floor pan
    if (by <= 0) return;
    mesh.scale.y *= (h + by) / h;
    mesh.position.y -= by / 2;                            // top edge stays put, bottom drops
  }
  function sealSeams(root, dims) {
    const hullW = (dims && dims.width) || 2;
    for (const o of root.children) {
      if (!o.geometry || !o.material || Array.isArray(o.material)) continue;
      if (o.userData && o.userData.playerWheel) continue;
      // A CABIN PANEL IS AUTHORED, NOT APPROXIMATE. Hole-proofing inflates
      // thin boxes and skirts wide flat ones downward, which is right for
      // exterior panel work and wrong inside a room: it would hang the
      // headliner 0.45 m into the cabin and eat the SCREEN LAW gap between a
      // display and its bezel. playercars.js's dressCabin marks the pieces
      // whose dimensions ARE the design.
      if (o.userData && o.userData.noSeal) continue;
      const p = o.geometry.parameters;
      if (!p || p.width == null || p.height == null || p.depth == null) continue;   // boxes only
      const flat = !o.rotation.x && !o.rotation.y && !o.rotation.z;
      // wide flat deck panel narrower than the hull → skirt it into the body
      if (flat && p.height <= 0.1 && p.width >= 1 && p.width < hullW && p.depth >= 0.4) {
        extendBoxDown(o, 0.45);
        continue;
      }
      // long thin hood stripe floated above the deck → settle + skirt
      if (flat && p.height <= 0.03 && p.width <= 0.3 && p.depth >= 2) {
        o.position.y -= 0.19;
        extendBoxDown(o, 0.18);
        continue;
      }
      if (p.width <= 0.09) o.scale.x *= (p.width + 0.04) / p.width;
      if (p.height <= 0.09) o.scale.y *= (p.height + 0.04) / p.height;
      if (p.depth <= 0.09) o.scale.z *= (p.depth + 0.04) / p.depth;
    }
  }
  // ONE dark interior shell + floor pan per car: whatever hairline seam
  // survives now shows a dark cabin/undercarriage instead of seeing clean
  // through the body from a low camera. It reuses the darkest opaque material
  // the car ALREADY draws, so it merges into that existing bucket — zero extra
  // draw calls, one extra source box (the allowed budget).
  function addInteriorShell(root, dims, fallbackMat) {
    const sw = ((dims && dims.width) || 2) * 0.78;
    const top = (dims && dims.shellTop) || (((dims && dims.height) || 1.5) * 0.55);
    const sd = ((dims && dims.length) || 4.4) * 0.78;
    let donor = null, lum = 9;
    for (const o of root.children) {
      const m = o.material;
      if (!o.geometry || !m || Array.isArray(m) || (o.userData && o.userData.playerWheel)) continue;
      if (!m.color || m.color.r == null) continue;
      if (m.transparent) continue;   // REAL GLASS: never build the opaque shell from a see-through pane
      // skip lamps: judge by actual GLOW (emissive luminance × intensity) —
      // dark trim has default intensity 1 but a black emissive, so it passes.
      const glow = m.emissive && m.emissive.r != null
        ? (m.emissive.r + m.emissive.g + m.emissive.b) * (m.emissiveIntensity == null ? 1 : m.emissiveIntensity) : 0;
      if (glow > 0.8) continue;
      const l = m.color.r + m.color.g + m.color.b;
      if (l < lum) { lum = l; donor = o; }
    }
    const m = donor ? donor.material : fallbackMat;
    if (!m || top - 0.14 <= 0.05) return;
    function block(depth, z) {
      if (depth <= 0.06) return;
      const b = boxMesh(sw, top - 0.14, depth, m);
      b.position.set(0, (top + 0.14) / 2, z);
      if (donor) { b.castShadow = donor.castShadow; b.receiveShadow = donor.receiveShadow; }
      root.add(b);
    }
    /* THE SHELL MUST NOT EAT THE ROOM (CAR_CABIN_V2).
       This one box exists to stop a low camera seeing daylight through a
       hairline panel seam, and for a car with no interior that was free. It is
       not free any more: its top sits at ~0.55·H, i.e. ABOVE a driver's hip
       point, so a solid slab through the middle of the car would bury the
       seats, the console and the seated body from the chest down and leave a
       flat dark plane where the footwell should be in first person.
       A cabin that publishes its own z-extent gets the shell in TWO pieces,
       nose and tail, and keeps its floor pan + door cards + bulkheads (which
       playercars.js's dressCabin builds, and which seal the room properly
       rather than by filling it). No cabin published → the single box, exactly
       as before, so the legacy box rig and every open frame are untouched. */
    const ci = root.userData && root.userData.cabinInfo;
    const hs = root.userData && root.userData.holdSpec;
    const carve = ci && ci.dressed && ci.zFront != null && ci.zRear != null &&
      (!CBZ.CONFIG || CBZ.CONFIG.CAR_CABIN_V2 !== false);
    const half = sd / 2;
    /* THE CABIN-OFF PATH HAD TO LEARN THE SAME LESSON. With CAR_CABIN_V2 off
       there is no published cabin to carve against, so the shell was ONE box
       spanning the whole car — which on a freight body is a dark slab filling
       the load space, and the two flags are independently revertible, so that
       combination is a real build somebody can ask for. A hold publishes its
       own forward bulkhead, so the block simply stops there: the nose still
       gets its hole-proofing and the room stays a room under either flag. */
    const holdF = hs && hs.floor ? Math.min(half, +hs.floor.z + Math.abs(+hs.floor.d) / 2) : null;
    if (!carve) {
      if (holdF == null) block(sd, 0);
      else block(half - holdF, (half + holdF) / 2);
      return;
    }
    const zF = Math.min(half, Math.max(-half, ci.zFront));
    const zR = Math.min(half, Math.max(-half, ci.zRear));
    block(half - zF, (half + zF) / 2);        // nose block, ahead of the windscreen
    /* A WALK-IN HOLD IS A ROOM, AND THE TAIL BLOCK WOULD FILL IT.
       Exactly the fault the paragraph above describes, one body back: on a van
       the published cabin covers only the CAB, so `zRear` sits at the cargo
       box's front face and the tail block is a solid dark slab spanning the
       whole load space from 0.14 m to 0.55·H. That was free when the box was a
       painted slab. It is not free now — it would bury the deck, the duffels
       and anybody standing on them, and the first plate of this feature would
       have photographed a black wall.
       Skipping it costs nothing the block was there to buy: its ONLY job is to
       stop a low camera seeing daylight through a hairline panel seam, and a
       hold is five real panels with real thickness, which seals the tail
       properly rather than by filling it. Same argument, same shape, as the
       cabin carve itself. */
    if (hs) return;
    block(zR + half, (zR - half) / 2);        // tail block, behind the backlight
  }

  function addWheels(grp, halfTrack, wz, r) {
    const wmat = vmat("tire", 0x131417, { emissive: 0x060708, ei: 0.2 });   // shiny rubber
    const rmat = vmat("rim", 0xc2c9d1, { emissive: 0x20242a, ei: 0.3 });     // bright alloy
    const rim = buildRimGeo();
    [[halfTrack, wz, -1], [-halfTrack, wz, 1], [halfTrack, -wz, -1], [-halfTrack, -wz, 1]].forEach(([wx, wzz, out]) => {
      const wh = new THREE.Mesh(WHEEL_GEO, wmat);
      wh.rotation.z = Math.PI / 2; wh.position.set(wx, r, wzz);
      wh.scale.set(r / 0.45, 1, r / 0.45); wh.castShadow = false; grp.add(wh);   // blob shadows ground cars
      // alloy rim proud of the OUTboard tyre face (sign per side keeps it facing out)
      const rd = new THREE.Mesh(rim, rmat);
      rd.rotation.z = out * Math.PI / 2;
      rd.position.set(wx, r, wzz);
      rd.scale.set(r / 0.45, 1, r / 0.45);
      rd.position.x += out * 0.13 * (r / 0.45);   // push the face outboard a touch
      rd.castShadow = false; grp.add(rd);
    });
  }

  // headlights (front, pale) + taillights (rear, red), as small emissive bars.
  // Colours/emissives are kept EXACTLY as before (the brake-light + crash dead-
  // lamp detectors key off these specific values); vmat just adds the glossy lens.
  function addLights(grp, w, hullTopY, frontZ, rearZ) {
    const head = vmat("lightFront", 0xeaf6ff, { emissive: 0xbfe6ff, ei: 0.85 });
    const tail = vmat("lightTail", 0xff3038, { emissive: 0xff2630, ei: 0.8 });
    const lx = w * 0.34;
    [lx, -lx].forEach((hx) => {
      const hl = boxMesh(0.4, 0.18, 0.06, head);
      hl.position.set(hx, hullTopY, frontZ + 0.02); grp.add(hl);
    });
    const tl = boxMesh(w * 0.86, 0.16, 0.07, tail);
    tl.position.set(0, hullTopY, rearZ - 0.02); grp.add(tl);
  }

  // ---- BRAKE LIGHTS -------------------------------------------------------
  // All tail lamps in the fleet use a handful of SHARED red-emissive materials
  // (cmat / playercars' sharedMat are cached singletons). We lazily build ONE
  // bright "braking" counterpart per distinct tail material (a pool of ~2-3 for
  // the entire city, ever) and flip a car's tail meshes between the two by
  // pointer when its braking state changes. Zero clones per car, zero per-frame
  // material work, and the merged-mesh part structure is untouched.
  const _brakeMats = new Map();           // tail material -> bright counterpart
  function isTailMat(m) {
    // A tail lamp = STRONG red emissive (the glow), regardless of the lens BODY
    // colour. carfx gives lamps a realistic DARK lens (color.r≈0.13) lit by a
    // bright emissive, so the old `color.r>0.78` clause (which assumed a bright
    // red body) wrongly rejected every carfx tail and broke brake lights. We now
    // key purely off the emissive: high red, low green/blue. This still excludes
    // headlights (pale-white emissive → green/blue high) and body PAINT (whose
    // emissive is a dim fraction of its colour, ~0.04-0.2 r, well under 0.78).
    if (!m || !m.emissive || m.emissive.r == null) return false;
    return m.emissive.r > 0.78 && m.emissive.g < 0.45 && m.emissive.b < 0.5;
  }
  function brakeMatFor(tailMat) {
    let b = _brakeMats.get(tailMat);
    if (!b) {
      b = tailMat.clone ? tailMat.clone() : tailMat;
      if (b !== tailMat) {
        if (b.color && b.color.setHex) b.color.setHex(0xff4a52);
        if (b.emissive && b.emissive.setHex) b.emissive.setHex(0xff0d18);
        b.emissiveIntensity = 2.2;
        b._shared = true;                 // never disposed by clearCars
      }
      _brakeMats.set(tailMat, b);
    }
    return b;
  }
  function tagTailMeshes(c) {
    const grp = c.group; if (!grp || !grp.traverse) return;
    const list = [];
    grp.traverse(function (o) {
      const m = o.material;
      if (m && !Array.isArray(m) && isTailMat(m)) { o._tailMat = m; list.push(o); }
    });
    c._tailMeshes = list;
    c._tailVisual = (grp.userData && grp.userData.carVisual) || null;
    c._brakeOn = false;
  }
  function setBrake(c, on) {
    on = !!on;
    if (!c._tailMeshes) return;
    // the [C] style-cycler can rebuild the visual under us — re-tag and re-apply
    const vis = (c.group && c.group.userData && c.group.userData.carVisual) || null;
    if (vis !== c._tailVisual) tagTailMeshes(c);
    if (c._brakeOn === on) return;
    c._brakeOn = on;
    for (let i = 0; i < c._tailMeshes.length; i++) {
      const mesh = c._tailMeshes[i];
      mesh.material = on ? brakeMatFor(mesh._tailMat) : mesh._tailMat;
    }
  }

  // tinted-glass greenhouse: a thin windshield slab + two side-window slabs
  // wrapped around the cabin so the cabin reads as a windowed passenger box.
  function addGlass(grp, cabinW, cabinD, cabinY, cabinH, raked) {
    // keep the tint colour (crash frost-glass detector keys off it); vmat adds gloss.
    const glass = vmat("glass", 0x16242e, { emissive: 0x0a151c, ei: 0.45 });
    const half = cabinD / 2;
    // windshield (front, raked back) + rear glass
    const wsW = cabinW * 0.9;
    [half + 0.01, -half - 0.01].forEach((zz, i) => {
      const gw = boxMesh(wsW, cabinH * 0.7, 0.05, glass);
      gw.position.set(0, cabinY, zz);
      gw.rotation.x = (i === 0 ? -1 : 1) * (raked ? 0.5 : 0.32);
      grp.add(gw);
    });
    // side windows
    [cabinW / 2 + 0.005, -cabinW / 2 - 0.005].forEach((xx) => {
      const sw = boxMesh(0.04, cabinH * 0.6, cabinD * 0.84, glass);
      sw.position.set(xx, cabinY, 0); grp.add(sw);
    });
  }

  // ---- REAL-GLASS CABIN FURNITURE (box rig) -------------------------------
  // With the shared vehicle glass genuinely transparent, an empty greenhouse
  // reads as a hollow shell. Give the legacy box rig a legible interior: two
  // front seat backs, a rear bench back, a dash slab and a steering wheel.
  // Everything reuses the trim material, so it all merges into the trim
  // bucket that already exists on every car — zero extra draw calls.
  function addCabinFurniture(grp, roofW, roofH, roofD, roofY, roofZ, trim) {
    if (CBZ.CONFIG && CBZ.CONFIG.VEHICLE_REAL_GLASS === false) return;
    const seatY = roofY - roofH * 0.12;
    [0.34, -0.34].forEach(function (sx) {
      const back = boxMesh(0.5, roofH * 0.62, 0.12, trim);
      back.position.set(sx * roofW, seatY, roofZ - roofD * 0.06); grp.add(back);
    });
    const bench = boxMesh(roofW * 0.74, roofH * 0.52, 0.12, trim);
    bench.position.set(0, seatY - roofH * 0.05, roofZ - roofD * 0.36); grp.add(bench);
    const dash = boxMesh(roofW * 0.8, 0.14, 0.28, trim);
    dash.position.set(0, roofY - roofH * 0.22, roofZ + roofD * 0.4); grp.add(dash);
    const wheel = boxMesh(0.3, 0.24, 0.05, trim);
    wheel.position.set(0.34 * roofW, roofY - roofH * 0.2, roofZ + roofD * 0.26);
    wheel.rotation.x = -0.55; grp.add(wheel);
  }

  // ---- VISIBLE OCCUPANTS ---------------------------------------------------
  // Owner ask: through real glass you must SEE the driver (and sometimes a
  // passenger). One shared vertex-coloured material + a small pool of merged
  // seated-body geometries (shirt × skin variants), ONE mesh per visible
  // occupant. Deterministic per car via position-hash — never the shared rng
  // stream. Hidden the moment the car is stolen/parked/dead.
  const OCC_SHIRTS = [0x8c3b3b, 0x3b5a8c, 0x3f7a4c, 0x8a793a, 0x5b4a78, 0x394048];
  const OCC_SKINS = [0xe8c39e, 0xc98e63, 0x8d5b3a, 0xf0d0b0];
  const OCC_GEOS = new Map();
  let OCC_MAT = null;
  function occMat() {
    if (!OCC_MAT) {
      // A BODY IN A ROOFED BOX GETS NO SUN. Same fault the cabin dressing has
      // (playercars.js writes it up where the interior materials are built):
      // this is a Lambert world with no bounce, the roof shadows every
      // occupant completely, and the result then passes through a
      // 0.35-opacity pane — so a driver who is unquestionably there renders as
      // nothing at all. The lift is flat (vertexColors carries the shirt and
      // skin; emissive cannot), which is exactly what a fill light is.
      const lift = !CBZ.CONFIG || CBZ.CONFIG.CAR_CABIN_V2 !== false;
      OCC_MAT = new THREE.MeshLambertMaterial({
        vertexColors: true,
        // sized against playercars.js's cabin lift, not guessed: an occupant
        // that reads DARKER than the upholstery behind him is a silhouette
        // nobody can find, and the first plate of this wave was exactly that.
        emissive: lift ? 0x5a5f68 : 0x000000,
        emissiveIntensity: lift ? 0.9 : 1,
      });
      OCC_MAT._shared = true;
    }
    return OCC_MAT;
  }
  // merged seated body: lap + torso + two arms + head, facing +z, origin at
  // the seat surface. Per-part flat vertex colour bakes shirt/skin/trouser.
  function occGeo(variant) {
    let geo = OCC_GEOS.get(variant);
    if (geo) return geo;
    const shirt = new THREE.Color(OCC_SHIRTS[variant % OCC_SHIRTS.length]);
    const skin = new THREE.Color(OCC_SKINS[(variant / OCC_SHIRTS.length | 0) % OCC_SKINS.length]);
    const pants = shirt.clone().multiplyScalar(0.45);
    const parts = [];
    function part(w, h, d, x, y, z, col) {
      const b = new THREE.BoxGeometry(w, h, d);
      b.translate(x, y, z);
      const n = b.attributes.position.count, cols = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { cols[i * 3] = col.r; cols[i * 3 + 1] = col.g; cols[i * 3 + 2] = col.b; }
      b.setAttribute("color", new THREE.BufferAttribute(cols, 3));
      parts.push(b.toNonIndexed ? b.toNonIndexed() : b);
    }
    part(0.46, 0.16, 0.44, 0, 0.1, 0.12, pants);      // lap / thighs
    part(0.44, 0.52, 0.26, 0, 0.44, -0.05, shirt);    // torso
    part(0.1, 0.4, 0.12, 0.27, 0.42, 0.02, shirt);    // arms
    part(0.1, 0.4, 0.12, -0.27, 0.42, 0.02, shirt);
    part(0.2, 0.22, 0.2, 0, 0.84, -0.03, skin);       // head
    // concat (positions + normals + colours) into one buffer
    let verts = 0;
    for (const p of parts) verts += p.attributes.position.count;
    const pos = new Float32Array(verts * 3), nrm = new Float32Array(verts * 3), col = new Float32Array(verts * 3);
    let o = 0;
    for (const p of parts) {
      pos.set(p.attributes.position.array, o);
      nrm.set(p.attributes.normal.array, o);
      col.set(p.attributes.color.array, o);
      o += p.attributes.position.array.length;
      p.dispose && p.dispose();
    }
    geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    geo.computeBoundingSphere();
    geo._shared = true;
    OCC_GEOS.set(variant, geo);
    return geo;
  }
  function carHash(x, z, salt) {
    if (CBZ.hash01) return CBZ.hash01(x, z, salt);
    const s = Math.sin(x * 12.9898 + z * 78.233 + salt * 37.719) * 43758.5453;
    return s - Math.floor(s);
  }
  // seat anchor inside THIS car's cabin (unified visuals export cabinInfo;
  // the box rig gets an equivalent; a registered custom group has neither and
  // simply gets no occupant).
  function occSeatAnchor(grp) {
    const vis = grp.userData && grp.userData.carVisual;
    const ci = (vis && vis.userData && vis.userData.cabinInfo) || (grp.userData && grp.userData.cabinInfo);
    if (ci) return ci;
    // styles without an exported cabin frame (SUV/van/cybertruck templates):
    // derive a serviceable seat anchor from the vehicle dims so every driven
    // car still shows its driver. Proportions follow the road-car law
    // (greenhouse base ≈ 55% of H, slightly rear-of-centre cabin).
    const dims = (vis && vis.userData && vis.userData.vehicleDims) || (grp.userData && grp.userData.vehicleDims);
    if (!dims || !dims.height) return null;
    return {
      baseY: dims.height * 0.55,
      peakY: dims.height * 0.36,
      cx: -(dims.length || 4.4) * 0.04,
      w: (dims.width || 2) * 0.9,
    };
  }
  /* ==========================================================================
     OCCUPANCY IS A FACT, NOT A DRAW — CAR_OCCUPANCY_REAL

     OWNER, verbatim: "no npc gets out of the backseat, which should be 1/10 or
     whatever BUT NOT RANDOM CHANCE, REAL."

     What this file used to do, and why it could never satisfy that: the visible
     bodies were TWO meshes drawn at build time off a hash of the car's position
     (`_occDriver` always, `_occPass` at hash < 0.3), and the only body that
     could ever LEAVE a car was `car.npcDriver` — a field set exclusively by
     `cityNpcCarjack`. Those two facts had nothing to do with each other. The
     passenger you saw through the glass did not exist to any other system, so
     jacking the car ejected a person who was never in it and left behind a
     person who was.

     THE MODEL. Every populated car carries ONE record, `car.occ`, decided once
     from a LATCHED position hash (the point the car was populated at, kept even
     as it drives, so the fact cannot drift), modulated by the district it was
     populated in and the hour it was populated at:

         car.occ = { hx, hz, seats: [ {slot, side, row, h, blob, ped, react}, … ] }

     A seat is the SINGLE record for that person at every fidelity. Far away it
     is a merged vertex-coloured blob (`seat.blob`, the cheap body traffic has
     always used). Close up the SAME seat is promoted to a real rig through
     `npcLife.attach` — reusing a body the world was already running wherever
     one can be claimed (giglife.js's cabPassenger precedent), so a full crowd
     of car occupants costs the sim almost nothing new. Jack the car and the
     bodies that step out are exactly the seats you could see, on the side of
     the car their seat is on, because there is only ever one list.

     WHY A LATCHED HASH AND NOT A ROLL. `CBZ.hash01` over the populate point is
     the same determinism channel worldgen uses: the same car in the same seed
     is populated the same way on every client, on every reload, and — this is
     the part the owner asked for — the SAME WAY EVERY TIME YOU LOOK AT IT. A
     `rng() < 0.3` cannot promise any of that. Recycled traffic (traffic.js
     teleports a far idle car to a fresh road) re-latches deliberately through
     `CBZ.carOccupancyReseat`: it is a different car in a different place now,
     and pretending its old crew rode along would be the same lie backwards.
  ========================================================================== */
  CBZ.CONFIG = CBZ.CONFIG || {};
  if (CBZ.CONFIG.CAR_OCCUPANCY_REAL == null) CBZ.CONFIG.CAR_OCCUPANCY_REAL = true;
  if (CBZ.CONFIG.JACK_REACTIONS == null) CBZ.CONFIG.JACK_REACTIONS = true;
  function occOn() { return CBZ.CONFIG.CAR_OCCUPANCY_REAL !== false; }

  // how many bodies ride in THIS car, and who they are. Everything below is a
  // threshold on a stable channel — no draw, no rng, no per-look re-decision.
  const OCC_SLOTS = [
    { slot: "driver",  side: -1, row: 0 },
    { slot: "shotgun", side:  1, row: 0 },
    { slot: "rearR",   side:  1, row: 1 },
    { slot: "rearL",   side: -1, row: 1 },
  ];
  function occDistrictAt(c) {
    if (c.road && c.road.district) return String(c.road.district);
    if (CBZ.roadSegmentAt) { const r = CBZ.roadSegmentAt(c.pos.x, c.pos.z, 8); if (r && r.district) return String(r.district); }
    return "core";
  }
  function occHour() { return CBZ.cityHour ? CBZ.cityHour() : 12; }
  function occDecide(c) {
    // LATCH the origin. A car's crew is decided where it was populated and
    // travels with it; re-reading c.pos every frame would let the fact wobble.
    const hx = c.pos.x, hz = c.pos.z;
    const hour = occHour(), dist = occDistrictAt(c);
    const rush = (hour >= 7 && hour < 9.5) || (hour >= 16 && hour < 19);
    const night = hour >= 22 || hour < 5.5;
    const outlying = dist === "town" || dist === "island" || dist === "farmland" ||
                     dist === "desert" || dist === "snow" || dist === "forest";
    // A FRONT PASSENGER is common; a BACK SEAT is the owner's one-in-ten. Both
    // move with the hour the way real occupancy does — the commute runs two-up,
    // the 3 a.m. street runs alone, and a family car out of town runs full.
    let pFront = 0.20, pRear = 0.10;
    if (rush) { pFront += 0.11; pRear += 0.05; }
    if (night) { pFront -= 0.07; pRear -= 0.04; }
    if (outlying) { pRear += 0.05; pFront += 0.03; }
    if (dist === "highway") { pFront += 0.05; pRear += 0.03; }
    const seats = [];
    for (let i = 0; i < OCC_SLOTS.length; i++) {
      const S = OCC_SLOTS[i];
      const h = carHash(hx, hz, 601 + i * 7);
      let want;
      if (i === 0) want = true;                                   // somebody is driving it
      else if (i === 1) want = h < pFront;
      else if (i === 2) want = h < pRear;
      else want = h < pRear * 0.34;                               // both rear seats filled is rare
      if (!want) continue;
      seats.push({
        slot: S.slot, side: S.side, row: S.row, h: h,
        variant: (carHash(hx, hz, 640 + i * 3) * 24) | 0,
        blob: null, ped: null, spawned: false, react: null, armed: null,
      });
    }
    c.occ = { hx: hx, hz: hz, hour: hour, district: dist, seats: seats, rigs: 0, jacked: false };
    return c.occ;
  }
  // IS THIS SEAT'S PERSON CARRYING? Decided from the same stable channel, but
  // read LAZILY — gangs.js publishes turf after vehicles.js loads, and a gun in
  // a car is a fact about the neighbourhood, not about the chassis.
  function occArmed(c, seat) {
    if (seat.armed != null) return seat.armed;
    let p = 0.07;
    if (CBZ.cityGangOf) { try { if (CBZ.cityGangOf(c.occ.hx, c.occ.hz)) p = 0.21; } catch (e) {} }
    if (c.occ.hour >= 22 || c.occ.hour < 5.5) p += 0.04;
    if (seat.slot === "driver") p *= 0.72;                         // the wheel is busy
    seat.armed = carHash(c.occ.hx, c.occ.hz, 660 + seat.row * 5 + (seat.side > 0 ? 1 : 0)) < p;
    return seat.armed;
  }
  // where a seat SITS, in the car group's local frame — the one cabin query,
  // so a blob, a promoted rig and a door-side step-out can never disagree.
  function occSeatPose(c, seat) {
    const f = c._occFrame; if (!f) return null;
    return {
      x: seat.side * f.seatX,
      y: seat.row ? f.cushionY + 0.01 : f.cushionY,
      z: seat.row ? f.rearZ : f.frontZ,
    };
  }

  function addOccupants(c) {
    if (CBZ.CONFIG && CBZ.CONFIG.VEHICLE_REAL_GLASS === false) return;
    const grp = c.group; if (!grp) return;
    // bikes model their own rider (moto_rider); boats/helis are open frames
    if (/motorcycle|helicopter|boat/.test(grp.userData && grp.userData.carStyle || "")) return;
    /* ONE SEAT ANCHOR, ALWAYS. This used to read the raw greenhouse box and
       park the body a hand's width under the beltline at a scale guessed from
       the headroom — which on a sedan put the head at y=1.47 with the roof cap
       at 1.48, i.e. the driver's skull was INSIDE the roof and no camera on
       earth could see him. The audit counted him the whole time; that is the
       "an audit nobody has executed is not a measurement" trap, one level down
       (it was executed, and it counted a mesh, and a counted mesh is not a
       VISIBLE one). cabinFrame() is the one query that always answers with a
       real cushion and a real eye — authored where playercars.js dressed the
       cabin, derived from the greenhouse where it did not — so the body sits
       ON the seat and is scaled so ITS eye (occGeo puts the head ~0.86 over
       the seat surface) lands on the same eye height the player's own rig
       uses. Flag off keeps the original two lines, byte for byte. */
    const v2 = !CBZ.CONFIG || CBZ.CONFIG.CAR_CABIN_V2 !== false;
    const ci = (v2 ? cabinFrame(c) : null) || occSeatAnchor(grp); if (!ci) return;
    const fit = v2 && ci.eye;
    const roomY = Math.max(0.3, ci.peakY + 0.08);              // seat surface → roofline
    const seatY = fit ? ci.cushionY : ci.baseY - 0.1;
    const seatX = fit ? ci.seatX : Math.min(0.45, ci.w * 0.22);
    const s = fit
      ? Math.max(0.55, Math.min(1.0, (ci.eye.y - seatY) / 0.86))
      : Math.max(0.6, Math.min(1.0, roomY / 0.98));
    const h = carHash(c.pos.x, c.pos.z, 101);
    function seatBody(x, z, variant) {
      const m = new THREE.Mesh(occGeo(variant), occMat());
      m.position.set(x, seatY, z);
      m.scale.setScalar(s);
      m.castShadow = false; m.receiveShadow = false;
      m.userData.occupant = true;                              // spare from any merge/batch pass
      grp.add(m);
      return m;
    }
    const occZ = fit ? ci.seatZ : ci.cx + 0.12;
    if (!occOn()) {
      // ---- LEGACY (CAR_OCCUPANCY_REAL=false): the original two lines, byte
      //      for byte. One driver, a 30% coin-flip passenger, no record. ----
      c._occDriver = seatBody(seatX, occZ, (h * 24) | 0);
      if (carHash(c.pos.x, c.pos.z, 102) < 0.3) {
        c._occPass = seatBody(-seatX, occZ, (carHash(c.pos.x, c.pos.z, 103) * 24) | 0);
      }
      syncOccupants(c);
      return;
    }
    // THE CABIN FRAME IS PUBLISHED ONCE, and every occupant query reads it: the
    // blob below, the promoted rig, and the door-side step-out all solve off
    // these four numbers, so they can never drift apart.
    c._occFrame = {
      seatX: seatX, cushionY: seatY, frontZ: occZ, fit: s,
      // the bench: behind the front cushion, ahead of the rear bulkhead. A
      // dressed cabin publishes its own; a derived one gets the same
      // proportion (a road car's rows sit ~0.74 m apart).
      rearZ: (fit && ci.rearSeatZ != null) ? ci.rearSeatZ
        : Math.max((ci.zRear != null ? ci.zRear + 0.30 : occZ - 0.95), occZ - 0.74),
      halfW: Math.max(0.7, (ci.w || 1.8) * 0.5),
    };
    const occ = occDecide(c);
    for (let i = 0; i < occ.seats.length; i++) {
      const st = occ.seats[i];
      const p = occSeatPose(c, st);
      st.blob = seatBody(p.x, p.z, st.variant);
      if (st.row) st.blob.position.y = p.y;
    }
    // the two legacy handles stay pointed at the real meshes: airside.js reads
    // `_occDriver` directly and gangs.js clears both. A field other files use
    // is part of the contract — it gets a new meaning, not a new name.
    c._occDriver = occ.seats[0] ? occ.seats[0].blob : null;
    c._occPass = occ.seats[1] ? occ.seats[1].blob : null;
    syncOccupants(c);
  }
  function occWanted(c) {
    return !!(c && !c.player && !c.dead && (c.ai || c.npcDriver));
  }

  /* ---- REAL BODIES IN THE SEATS ------------------------------------------
     Near the player a seat stops being a blob and becomes a person. The body
     is CLAIMED wherever possible — npcLife.claimCity pulls somebody the world
     was already simulating (giglife.js's cabPassenger does exactly this for a
     fare) — so a street full of occupied cars adds bodies to seats, not to the
     population. Only when nobody can be claimed do we spawn.

     THE BUDGET IS THE WHOLE DESIGN. `OCC_RIG_D` is a hair past the
     interaction reach plus a sprint, and `OCC_RIG_CARS` caps how many cars may
     hold rigs at once, so the cost is bounded no matter how dense the jam.
     Everything past that ring stays a blob and costs one small mesh. */
  const OCC_RIG_D = 24, OCC_RIG_D2 = OCC_RIG_D * OCC_RIG_D;
  const OCC_RIG_OFF2 = 40 * 40;                      // hysteresis: hand bodies back
  const OCC_RIG_CARS = 3;
  let occRigCars = 0, occStat = { promoted: 0, claimed: 0, spawned: 0, jacks: 0, hostages: 0,
    react: { fight: 0, flee: 0, freeze: 0, beg: 0 } };
  function occAnchorFor(c, seat) {
    const p = occSeatPose(c, seat); if (!p) return null;
    // A REAR passenger sits turned a few degrees into the cabin and a shotgun
    // rider leans toward the window — the same anchor grammar gangs.js's
    // DB_SEATS uses, which npclife re-asserts every frame.
    return {
      x: p.x, y: p.y, z: p.z,
      pitch: 0.12, yaw: seat.row ? -seat.side * 0.16 : (seat.slot === "shotgun" ? -0.10 : 0),
      roll: 0, pose: "sit", state: "sit",
    };
  }
  function occDraftOk(p, c) {
    if (!CBZ.npcLife || !CBZ.npcLife.draftableCity) return false;
    if (!CBZ.npcLife.draftableCity(p)) return false;
    // NEVER LET THE PLAYER SEE A BODY LEAVE THE PAVEMENT. giglife.js's
    // safeFareDraft is the shipped rule and this is it: far away is always
    // fine, near is only fine behind the camera.
    const P = CBZ.player; if (!P || !P.pos) return true;
    const dx = p.pos.x - P.pos.x, dz = p.pos.z - P.pos.z, d2 = dx * dx + dz * dz;
    if (d2 > 90 * 90) return true;
    if (d2 < 40 * 40) return false;
    const yaw = CBZ.cam ? CBZ.cam.yaw : 0, d = Math.sqrt(d2) || 1;
    return (Math.sin(yaw) * (dx / d) + Math.cos(yaw) * (dz / d)) < -0.15;
  }
  // SEAT ONE REAL BODY. Exported (CBZ.carOccupancySeat) because gangs.js seats
  // a drive-by crew into the same record — a crew rides in SEATS, not in a
  // private array beside them, which is what makes a drive-by car jackable
  // with the same reactions as any other occupied car.
  function occSeatPed(c, seat, ped, opts) {
    if (!c || !seat || !ped) return false;
    const anchor = occAnchorFor(c, seat);
    if (!anchor || !CBZ.npcLife || !CBZ.npcLife.attach) return false;
    if (!CBZ.npcLife.attach(ped, c.group, anchor)) return false;
    seat.ped = ped; seat.spawned = !!(opts && opts.spawned);
    ped.inCar = c; ped.controlled = true;
    ped._occCar = c; ped._occSeat = seat;
    if (seat.blob) seat.blob.visible = false;
    c.occ.rigs++;
    if (seat.slot === "driver" && !c.npcDriver) { c.npcDriver = ped; c._occOwnsDriver = true; }
    return true;
  }
  function occPromoteSeat(c, seat) {
    if (seat.ped || !CBZ.npcLife) return false;
    const anchor = occAnchorFor(c, seat); if (!anchor) return false;
    const place = { parent: c.group, anchor: anchor };
    let ped = null, spawned = false;
    if (CBZ.npcLife.claimCity) {
      try { ped = CBZ.npcLife.claimCity("carOccupant", place, function (p) { return occDraftOk(p, c); }); } catch (e) { ped = null; }
    }
    if (ped) {
      // claimCity already attached it; finish the seat bookkeeping by hand.
      seat.ped = ped; ped.inCar = c; ped.controlled = true;
      ped._occCar = c; ped._occSeat = seat;
      if (seat.blob) seat.blob.visible = false;
      c.occ.rigs++;
      if (seat.slot === "driver" && !c.npcDriver) { c.npcDriver = ped; c._occOwnsDriver = true; }
      occStat.claimed++;
    } else if (CBZ.npcLife.spawnCity) {
      try { ped = CBZ.npcLife.spawnCity("carOccupant", { x: c.pos.x, z: c.pos.z, rng: rng, parent: c.group, anchor: anchor }); } catch (e) { ped = null; }
      if (!ped) return false;
      spawned = true;
      seat.ped = ped; ped.inCar = c; ped.controlled = true;
      ped._occCar = c; ped._occSeat = seat; seat.spawned = true;
      if (seat.blob) seat.blob.visible = false;
      c.occ.rigs++;
      if (seat.slot === "driver" && !c.npcDriver) { c.npcDriver = ped; c._occOwnsDriver = true; }
      occStat.spawned++;
    } else return false;
    if (occArmed(c, seat) && !ped.armed) {
      ped.armed = true;
      ped.weapon = ped.weapon || (carHash(c.occ.hx, c.occ.hz, 690 + seat.row) < 0.7 ? "Pistol" : "SMG");
      ped.ammo = ped.ammo || 18;
      // the gun stays out of sight until it is drawn — a glove-box pistol is
      // not a threat display (actorweapons.js's own "gun away" intent flag).
      ped._holstered = true;
      if (CBZ.syncActorWeapon) { try { CBZ.syncActorWeapon(ped); } catch (e) {} }
    }
    occStat.promoted++;
    return true;
  }
  function occPromote(c, all) {
    if (!c.occ || !c.group) return 0;
    // A FAILED CLAIM MUST NOT COST A SCAN PER FRAME. claimCity walks cityPeds;
    // if nobody is draftable (a quiet street, everybody in view) the answer
    // will not have changed by the next frame. Back off and try again shortly.
    if (!all) {
      const t = CBZ.now || 0;
      if (t < (c._occTryT || 0)) return 0;
      c._occTryT = t + 420;
    }
    let n = 0;
    for (let i = 0; i < c.occ.seats.length; i++) {
      const st = c.occ.seats[i];
      // A SEAT SOMEBODY LEFT STAYS EMPTY. Without the `gone` test the promoter
      // reads a vacated seat as an unfilled one and hands it a brand-new body —
      // measured: a car jacked once quietly refilled itself, 29 promotions
      // against 10 jacks, and the rig budget went to 12 cars against a cap of 3.
      if (st.ped || st.gone) continue;
      if (occPromoteSeat(c, st)) { n++; if (!all) break; }   // one seat per tick unless forced
    }
    if (n && !c._occRigged) { c._occRigged = true; occRigCars++; }
    return n;
  }
  // HAND THE BODIES BACK. Only ever off-camera: a rig blinking back into a
  // merged blob in view is the same lie as a spawn in view.
  function occDemote(c) {
    if (!c.occ || !c._occRigged) return false;
    if (CBZ.npcTransitionSafe && !CBZ.npcTransitionSafe(c.pos.x, c.pos.z, { minDistance: 24, maxDistance: 400 })) return false;
    // A BODY WITH A STORY STAYS, and the ones around it still go home. An
    // early `return` here used to abandon the sweep half-done, leaving the rig
    // count describing a car that no longer matched it.
    let left = 0;
    for (let i = 0; i < c.occ.seats.length; i++) {
      const st = c.occ.seats[i];
      const p = st.ped; if (!p) continue;
      if (p.dead || p.hostage || p._dbRole || st.frozen) { left++; continue; }
      try {
        if (st.spawned && CBZ.npcLife.destroyCity) CBZ.npcLife.destroyCity(p);
        else if (CBZ.npcLife.release) CBZ.npcLife.release(p, { state: "walk" });
      } catch (e) { left++; continue; }
      p.inCar = null; p.controlled = false; p._occCar = null; p._occSeat = null;
      st.ped = null; st.spawned = false;
      if (st.blob && !st.gone) st.blob.visible = true;
      if (c.npcDriver === p && c._occOwnsDriver) { c.npcDriver = null; c._occOwnsDriver = false; }
    }
    c.occ.rigs = left;
    if (left) return false;
    c._occRigged = false; occRigCars = Math.max(0, occRigCars - 1);
    return true;
  }
  function syncOccupants(c) {
    if (!c._occDriver && !(c.occ && c.occ.seats.length)) return;
    const on = occWanted(c);
    if (!c.occ) {                                     // legacy path
      if (c._occDriver && c._occDriver.visible !== on) c._occDriver.visible = on;
      if (c._occPass && c._occPass.visible !== on) c._occPass.visible = on;
      return;
    }
    const seats = c.occ.seats;
    for (let i = 0; i < seats.length; i++) {
      const st = seats[i];
      if (!st.blob) continue;
      // a promoted seat shows its rig, not its blob; a seat somebody LEFT is
      // empty for good — the fact changed, so the glass must change with it.
      const want = on && !st.ped && !st.gone;
      if (st.blob.visible !== want) st.blob.visible = want;
    }
    if (!on) return;
    // PROMOTION / DEMOTION. One seat per car per tick, bounded car count.
    const cm = CBZ.camera && CBZ.camera.position; if (!cm) return;
    const dx = c.pos.x - cm.x, dz = c.pos.z - cm.z, d2 = dx * dx + dz * dz;
    if (d2 < OCC_RIG_D2 && CBZ.npcLife && CBZ.npcLife.attach) {
      if (c._occRigged || occRigCars < OCC_RIG_CARS) occPromote(c, false);
    } else if (d2 > OCC_RIG_OFF2 && c._occRigged) occDemote(c);
  }

  /* ============================================================
     THE PLAYER AT THE WHEEL — CAR_DRIVER_VISIBLE

     OWNER: "fix the appearance of how player driving car in third person like
     if player was driving towards you." Today his car is EMPTY, and it is
     empty on purpose: `occWanted` refuses `c.player`, and the drive loop
     force-hid the real rig every single frame because FPS/view toggles kept
     re-showing a STANDING body whose head came out through the roof.

     Hiding the body was never the fix — SEATING it is. Two things had to exist
     first, and now do: a cabin with a floor and a cushion to sit on
     (playercars.js's dressCabin), and a pose that reads as driving rather than
     as sitting at a desk (character.js's "drive" seat posture).

     WHY THE REAL RIG AND NOT THE CHEAP BLOB. Outfits are the game — the
     clothing store, the origins, the jewellery all land on THIS rig — and a
     player who dressed himself must be the person visible at the wheel of his
     own car. That is exactly ONE full rig, the one already built and animated
     for him; traffic keeps the merged vertex-coloured blob it has always used
     (addOccupants above), so a jam of sixty cars still costs sixty small
     meshes and not sixty skeletons. Near = real, far = cheap, and the split
     falls on the only body the player can inspect.

     HOW IT HOLDS THE SEAT. Per-frame world write from the car's own matrix —
     npclife.js's attach/syncAttached grammar minus the re-parent, because
     clothes.js, wounds.js and the weapon sockets all assume this rig is a
     direct child of the arena root. Everything else (the sink onto the
     cushion, the fold of the legs, the hands) is the shared seat solve, told
     `kind: "car"`.
  ============================================================ */
  // (this file guards every other CBZ.CONFIG read, because a headless harness
  // can load it without config.js — so the flag has to create the bag, not
  // assume it)
  CBZ.CONFIG = CBZ.CONFIG || {};
  if (CBZ.CONFIG.CAR_DRIVER_VISIBLE == null) CBZ.CONFIG.CAR_DRIVER_VISIBLE = true;

  const _drvV = new THREE.Vector3();
  const drv = { car: null, fit: 1, steer: 0, fpHid: false };

  /* THE ONE CABIN QUERY. Hands back playercars.js's authored cabin frame when
     there is one, and derives an equivalent from the greenhouse box when there
     is not (the legacy box rig, a registered custom group, CAR_CABIN_V2 off),
     so no consumer ever has two code paths. null = this thing has no cabin at
     all — a bike, an open boat — and every caller degrades to nothing. */
  function cabinFrame(car) {
    const grp = car && (car.group || car);
    if (!grp || !grp.userData) return null;
    if (/motorcycle|helicopter|boat/.test(grp.userData.carStyle || "")) return null;
    const ci = occSeatAnchor(grp);
    if (!ci) return null;
    if (ci.dressed) return ci;
    const beltY = ci.baseY, gh = Math.max(0.16, ci.peakY), w = ci.w || 1.8;
    const roofY = beltY + gh;
    const dims = grp.userData.vehicleDims;
    const cl = Math.max(1.2, ((dims && dims.length) || 4.4) * 0.42);
    const zF = ci.cx + cl * 0.5, zR = ci.cx - cl * 0.5;
    const floorY = Math.max(0.05, beltY - Math.max(0.30, gh * 0.9));
    const cushionY = floorY + Math.max(0.11, (beltY - floorY) * 0.26);
    const seatX = Math.min(0.42, w * 0.24);
    const seatZ = Math.max(zR + 0.34, zF - 0.86);
    const eyeY = Math.max(beltY + 0.04,
      Math.min(beltY + Math.max(0.12, Math.min(gh * 0.30, 0.42)), roofY - 0.20));
    return {
      baseY: beltY, peakY: gh, cx: ci.cx, w: w,
      beltY: beltY, roofY: roofY, floorY: floorY, zRear: zR, zFront: zF, rows: 1,
      cushionY: cushionY, seatX: seatX, seatZ: seatZ, rearSeatZ: null,
      wheel: { x: seatX, y: Math.max(cushionY + 0.28, beltY + gh * 0.09), z: seatZ + 0.44,
        r: Math.min(0.185, w * 0.108) },
      eye: { x: seatX, y: eyeY, z: seatZ + 0.19 },
      dressed: false, derived: true,
    };
  }
  CBZ.carCabinInfo = function (car) { return cabinFrame(car); };

  /* HOW BIG IS THE DRIVER? This rig is stylised — its head is 24% of its
     height where a real one is 13% (character.js says so in its own comment) —
     so a 1:1 adult folded into a real-sized cabin puts his crown ~0.2 m
     through the headliner. The cars are not the thing to change: their
     dimensions are published spec and the whole silhouette law hangs off them.
     So solve the seat solve BACKWARDS for the one uniform scale that lands
     this body's eye on the cabin's authored eye height, then cap it so the
     crown still clears the roof. It lands near 0.6 on a sedan and near 0.75 in
     a van, which is the same answer the merged blob has always reached by
     eyeballing a constant — except this one is derived, and it is per-body, so
     a woman or a teenager gets her own. */
  function fitSeatedRig(ch, ci) {
    const m = CBZ.charSeatMetrics ? CBZ.charSeatMetrics(ch) : null;
    if (!m) return 0.6;
    const cush = Math.max(0.02, ci.cushionY - ci.floorY);
    function solve(target, over) {
      if (!(target > 0)) return 1;
      // world hip = max(cush + hipPad*s, hipFloor*s); world eye/top = hip + over*s
      const a = (target - cush) / (m.hipPad + over);          // cushion branch
      if (a > 0 && cush >= (m.hipFloor - m.hipPad) * a) return a;
      return target / (m.hipFloor + over);                    // low-clamp branch
    }
    const s = Math.min(
      solve(ci.eye.y - ci.floorY, m.eyeOverHip),
      solve((ci.roofY - 0.05) - ci.floorY, m.topOverHip));
    return Math.max(0.50, Math.min(1.0, s));
  }

  function driverWanted(car) {
    if (CBZ.CONFIG.CAR_DRIVER_VISIBLE === false) return false;
    const P = CBZ.player, ch = CBZ.playerChar;
    if (!P || P.dead || P._aircraft) return false;            // cockpit_view owns aircraft
    if (!ch || !ch.group || !car || car.dead) return false;
    return true;
  }

  function seatDriver(car, dt) {
    const ch = CBZ.playerChar;
    const ci = cabinFrame(car);
    if (!ci) return false;
    const grp = car.group;
    const vis = (grp.userData && grp.userData.carVisual) || grp;
    if (drv.car !== car) { drv.car = car; drv.fit = fitSeatedRig(ch, ci); drv.steer = 0; }
    const s = drv.fit;
    vis.updateWorldMatrix(true, false);
    _drvV.set(ci.seatX, ci.floorY, ci.seatZ).applyMatrix4(vis.matrixWorld);
    ch.group.position.copy(_drvV);
    // the rig faces its own local +Z and so does the car body, so the car's
    // full attitude (terrain pitch, weight-transfer roll, heading) copies over
    // one-for-one — the driver leans with the car, which is half of why a
    // seated body reads as riding IN something rather than glued to it.
    ch.group.rotation.set(grp.rotation.x, grp.rotation.y, grp.rotation.z, grp.rotation.order);
    if (ch.group.scale.x !== s) ch.group.scale.setScalar(s);
    ch.group.visible = true;
    ch.sitting = true;
    ch.crouch = false; ch.slidePose = false; ch.pronePose = false; ch.typing = false;
    // cushion/floorBelow are GROUP-LOCAL (the seat solve runs inside the scaled
    // group), so the world clearance is divided back out by the fit.
    if (!ch.seatRef || ch.seatRef.kind !== "car" || ch.seatRef._fit !== s) {
      ch.seatRef = { cushion: (ci.cushionY - ci.floorY) / s, floorBelow: 0, kind: "car", _fit: s };
    }
    // HANDS FOLLOW THE WHEEL. The sim keeps no steering angle of its own, so
    // the honest signal is the heading RATE. +heading turns the nose toward
    // local +X, which is the car's left, so the sign flips into driveSteer's
    // "+1 is right" convention.
    let dh = car.heading - (car._drvHeading == null ? car.heading : car._drvHeading);
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    car._drvHeading = car.heading;
    const want = Math.max(-1, Math.min(1, -(dh / Math.max(0.001, dt)) * 1.35));
    drv.steer += (want - drv.steer) * Math.min(1, dt * 8);
    ch.driveSteer = drv.steer;
    // FIRST PERSON: you are inside this body, so drop the two parts of it that
    // are AT the camera — the head (with the face) and the chest — and keep
    // everything the view exists to show: the arms on the wheel, the hands,
    // the legs in the footwell, and whatever the player is wearing on them.
    // cockpit_view.js hides its pilot outright; a car cannot, because the
    // driver's own hands ARE the shot. The chest has to go with the head
    // regardless of how far forward the eye is authored — a torso box is
    // ~0.28 m deep and the near plane is 0.10, so a few centimetres of eye
    // placement is the difference between a cabin and a wall of shirt.
    const fp = !!(CBZ.carFpActive && CBZ.carFpActive());
    if (drv.fpHid !== fp) {
      drv.fpHid = fp;
      if (ch.neck) ch.neck.visible = !fp;
      const sk = ch.skinSlots;
      if (sk) {
        const near = (sk.torso || []).concat(sk.collar || []);
        for (let i = 0; i < near.length; i++) if (near[i]) near[i].visible = !fp;
      }
    }
    if (CBZ.animChar) CBZ.animChar(ch, 0, dt);
    return true;
  }

  /* Everything the seat owns, handed back. Called on exit, on death, on any
     frame the player is not driving (city/view.js's visibility pass) and
     whenever the flag goes off mid-session — the rig must never be left scaled
     down, folded, or missing its head. */
  function releaseDriver() {
    if (!drv.car) return false;
    drv.car = null; drv.steer = 0; drv.fit = 1;
    const ch = CBZ.playerChar;
    if (ch) {
      ch.sitting = false; ch.seatRef = null; ch.driveSteer = 0;
      if (ch.group) {
        ch.group.scale.setScalar(1);
        ch.group.rotation.x = 0; ch.group.rotation.z = 0;
      }
      if (ch.neck) ch.neck.visible = true;
      const sk = ch.skinSlots;
      if (sk) {
        const near = (sk.torso || []).concat(sk.collar || []);
        for (let i = 0; i < near.length; i++) if (near[i]) near[i].visible = true;
      }
    }
    drv.fpHid = false;
    return true;
  }
  CBZ.carDriverRelease = releaseDriver;
  CBZ.carDriverSeated = function () { return !!drv.car; };
  CBZ.carDriverAudit = function () {
    let occ = 0, cars = 0;
    const list = CBZ.cityCars || [];
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (c.occ && c.occ.seats.length) {
        cars++;
        for (let k = 0; k < c.occ.seats.length; k++) if (!c.occ.seats[k].gone) occ++;
        continue;
      }
      if (!c._occDriver) continue;
      cars++; occ++; if (c._occPass) occ++;
    }
    return {
      driverFlag: CBZ.CONFIG.CAR_DRIVER_VISIBLE !== false,
      driverRigSeated: drv.car ? 1 : 0,
      driverFit: drv.car ? +drv.fit.toFixed(3) : null,
      npcOccupantCars: cars,
      npcOccupantMeshes: occ,      // merged blobs, NEVER full rigs — the budget
    };
  };

  /* THE RATCHET. `blobSeats` + `rigSeats` is the whole occupant budget; the
     rate rows are MEASURED, not claimed (the doctrine's "an audit nobody has
     executed is not a measurement"), so the back-seat number the owner asked
     for can be checked against the world instead of against this comment. */
  CBZ.carOccupancyAudit = function () {
    const list = CBZ.cityCars || [];
    let populated = 0, blobSeats = 0, rigSeats = 0, goneSeats = 0, armedSeats = 0;
    let backseatCars = 0, frontPassCars = 0, live = 0, frozen = 0, held = 0, rigCars = 0;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (!c.occ || !c.occ.seats.length) continue;
      const on = occWanted(c);
      if (on) live++;
      populated++;
      if (c._occRigged) rigCars++;
      let rear = 0, front = 0;
      for (let k = 0; k < c.occ.seats.length; k++) {
        const st = c.occ.seats[k];
        if (st.gone) { goneSeats++; continue; }
        if (st.ped) rigSeats++; else blobSeats++;
        if (st.armed) armedSeats++;
        if (st.frozen) frozen++;
        if (st.hostage) held++;
        if (st.row) rear++; else if (st.slot !== "driver") front++;
      }
      if (rear) backseatCars++;
      if (front) frontPassCars++;
    }
    return {
      flag: occOn(), reactFlag: CBZ.CONFIG.JACK_REACTIONS !== false,
      cars: list.length, populated: populated, driving: live,
      blobSeats: blobSeats, rigSeats: rigSeats, emptiedSeats: goneSeats,
      rigCars: rigCars, rigCap: OCC_RIG_CARS, armedSeats: armedSeats,
      // MEASURED occupancy rates over the live world (owner asked for ~1/10 in
      // the back). These are read off the record, never off the constants.
      backseatRate: populated ? +(backseatCars / populated).toFixed(3) : 0,
      frontPassRate: populated ? +(frontPassCars / populated).toFixed(3) : 0,
      meanOccupants: populated ? +((blobSeats + rigSeats) / populated).toFixed(2) : 0,
      jacks: occStat.jacks, reactions: occStat.react,
      promoted: occStat.promoted, claimed: occStat.claimed, spawned: occStat.spawned,
      frozenSeated: frozen, hostagesHeld: held, hostagesTaken: occStat.hostages,
    };
  };

  // Per-model trim on the LEGACY BOX RIG. The branch table moved to
  // city/carparts.js (applyBoxIdentity) — the same file that owns the brand
  // design languages for the unified visuals — so all model identity lives in
  // one place. Accepts both new fictional designStyles and old strings.
  function addModelIdentity(grp, model, d) {
    if (CBZ.carParts && CBZ.carParts.applyBoxIdentity) CBZ.carParts.applyBoxIdentity(grp, model, d);
  }

  // Every named model has a stable body class. The old random fallback could
  // turn a Prius or a Yellow Cab into a pickup/van, which made the traffic mix
  // look broken rather than varied. Unknown models fall back to a normal sedan.
  function modelBodyKind(model) {
    if (model && model.body) return model.body;
    const nm = model ? model.name : "";
    if (/F-150|Caravan|Sprinter|Transit|truck|pickup/i.test(nm)) return /Caravan|Sprinter|Transit|van/i.test(nm) ? "van" : "pickup";
    if (/van|cargo/i.test(nm)) return "van";
    if (/Charger|Mustang|Camaro|Challenger|muscle/i.test(nm)) return "muscle";
    if (/Cherokee|SUV|Model X|Model Y|Cybertruck|Escalade|Tahoe|Range/i.test(nm)) return "suv";
    if (/Corvette|911|370Z|Aventador|Enzo|Veyron|coupe|Ferrari|Porsche/i.test(nm)) return "coupe";
    if (/Prius|Civic|Golf|hatch/i.test(nm)) return "hatch";
    return "sedan";
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
    // AN ARTIC OUTWEIGHS EVERYTHING ELSE ON THE ROAD AND THE DEPENETRATION
    // SOLVER IS WHERE THAT HAS TO BE TRUE. resolveCars weights separation by
    // `mass`, so this one number is the difference between a semi shouldering a
    // hatchback aside and the pair of them splitting the impulse like two
    // sedans. 4.2 is the real ratio of a loaded tractor-trailer to a saloon,
    // not a feel knob.
    else if (bk === "semi") { mass = 4.2; armor = 0.34; repair = 0.72; }
    else if (bk === "hatch") { mass = 0.96; armor = 0.04; repair = 0.9; }
    if (s > 1.35) { mass *= 0.94; repair *= 1.25; }     // exotics are lighter and expensive to fix
    return { mass, armor, repair };
  }

  // UNIFIED car visual: build the SAME detailed model the player drives, painted
  // for THIS car, so it looks identical parked, in traffic, and while driven —
  // no more swap-on-entry (a car was a small box rig until you stole it, then
  // popped into a different hero mesh of a different colour). Falls back to the
  // lightweight box rig when the visual system isn't loaded (headless / gallery).
  function buildCar(model) {
    if (!CBZ.cityBuildPlayerCarVisual || !CBZ.cityInferCarStyle) return buildCarBox(model);
    const grp = new THREE.Group();
    const bt = modelBodyKind(model);
    const s = model ? (model.s || 1) : 1;
    const baseColor = model ? model.color : 0x3c6fd6;
    // per-car clearcoat tint so a row of one model still reads as varied
    const tint = 0.86 + rng() * 0.28;
    const paintHex = new THREE.Color(baseColor).multiplyScalar(tint).getHex();
    const style = CBZ.cityInferCarStyle(model) || "tesla-3";
    let visual = null;
    // model rides along so carparts.js can apply the BRAND face + per-model
    // identity (incl. the taxi roof sign the unified path used to drop).
    try { visual = CBZ.cityBuildPlayerCarVisual(style, paintHex, null, model); } catch (e) { visual = null; }
    if (!visual) return buildCarBox(model);
    grp.add(visual);
    // Wheels stay as individual meshes (tagged playerWheel) so the driven car can
    // spin them; everything else merges into a few meshes — the city is draw-call
    // bound (core/profile.js), and an unmerged hero mesh per car would blow that.
    const keep = new Set();
    visual.traverse(function (o) { if (o.userData && o.userData.playerWheel) keep.add(o); });
    const dims = visual.userData.vehicleDims ||
      { width: 2, length: 4.4 * s, height: 1.5, wheelbase: 2.7 };
    // hole-proof the panel work before it gets baked into the merge buckets
    // (bikes/aircraft/boats have open frames by design — no shell, no sealing)
    if (!/motorcycle|helicopter|boat/.test(style)) {
      sealSeams(visual, dims);
      addInteriorShell(visual, dims, null);
    }
    if (mergeStaticCarParts) mergeStaticCarParts(visual, keep);
    grp.userData.carVisual = visual;
    grp.userData.carStyle = style;
    grp.userData.bodyKind = bt;
    grp.userData.designStyle = (model && model.designStyle) || bt;
    grp.userData.vehicleDims = dims;
    return grp;
  }

  function buildCarBox(model) {
    const grp = new THREE.Group();
    const s = model ? model.s : 1;
    const len = 4.2 * s;
    const color = model ? model.color : 0x3c6fd6;
    // a steered palette: dim/lighten the model colour a touch per-car so a
    // row of the same model still varies, plus a clearcoat-ish emissive sheen.
    const tint = 0.86 + rng() * 0.28;
    const c3 = new THREE.Color(color).multiplyScalar(tint);
    const paintHex = c3.getHex();
    // shiny clearcoat body (fresh per car so it carries THIS colour + reflections)
    const paint = vmat("paint", paintHex, { emissive: c3.clone().multiplyScalar(0.18).getHex(), ei: 0.5 });
    const trim = vmat("plastic", 0x16181c, { emissive: 0x070809, ei: 0.25 });

    // Use the model's stable body class so named traffic always reads correctly.
    let bt = modelBodyKind(model);

    // shared dimensions, tuned per body type below
    let w = 2.0, hullH = 0.62, hullY = 0.7, wheelR = 0.45, halfTrack = 0.98;
    let roofW = 1.62, roofH = 0.66, roofD = len * 0.42, roofY = 1.45, roofZ = -0.1;
    let topFrac = 0.8, raked = false;

    if (bt === "sedan") {
      w = 1.94; hullH = 0.64; hullY = 0.72; wheelR = 0.46; halfTrack = 0.99;
      roofW = 1.56; roofH = 0.62; roofD = len * 0.42; roofY = 1.42; roofZ = -0.12; topFrac = 0.84;
    } else if (bt === "hatch") {
      w = 1.84; hullH = 0.66; hullY = 0.72; wheelR = 0.44; halfTrack = 0.94;
      roofW = 1.52; roofH = 0.74; roofD = len * 0.53; roofY = 1.48; roofZ = -0.2; topFrac = 0.88;
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
    body.position.y = 0.78; body.castShadow = false; grp.add(body);   // blob shadows ground cars
    // raise/lower the visual hull to its type's ride height without breaking the
    // crumpler baseline (it sets body.position.y = 0.78 - c*0.14): nudge via the
    // group children offset instead — keep body at 0.78 and float a skirt.
    if (hullY !== 0.7) body.position.y = 0.78 + (hullY - 0.72);

    // ---- ROOF / CABIN (the deformable greenhouse). ----
    const cabin = new THREE.Mesh(wedgeGeo(roofW, roofH, roofD, topFrac * 0.94, raked ? 0.6 : 0.8, 0.95), paint);
    cabin.position.set(0, roofY, roofZ); grp.add(cabin);
    grp.userData.body = body; grp.userData.cabin = cabin;   // crash crumpling
    grp.userData.crashBase = { bodyY: body.position.y, bodyZ: body.position.z, cabinY: cabin.position.y, cabinZ: cabin.position.z };

    // glass on the greenhouse
    addGlass(grp, roofW, roofD, roofY, roofH, raked);
    // legible interior behind the (now genuinely transparent) glass
    addCabinFurniture(grp, roofW, roofH, roofD, roofY, roofZ, trim);
    grp.userData.cabinInfo = { baseY: roofY - roofH / 2, peakY: roofH, cx: roofZ, w: roofW };

    // a contrasting belt-line / bumpers so the body isn't one flat colour
    const beltY = 0.78 + (hullY - 0.72) - hullH * 0.18;
    const belt = boxMesh(w + 0.04, 0.16, len * 0.96, trim);
    belt.position.set(0, Math.max(0.5, beltY), 0); grp.add(belt);

    // pickup bed walls (an open box behind the cab)
    if (bt === "pickup") {
      const bedY = 0.78 + (hullY - 0.72) + hullH * 0.32;
      const bedmat = paint;
      const sideD = len * 0.42;
      [w / 2 - 0.06, -w / 2 + 0.06].forEach((bx) => {
        const wall = boxMesh(0.1, 0.26, sideD, bedmat);
        wall.position.set(bx, bedY + 0.13, -len * 0.22); grp.add(wall);
      });
      const tail = boxMesh(w - 0.1, 0.26, 0.1, bedmat);
      tail.position.set(0, bedY + 0.13, -len * 0.44); grp.add(tail);
    }
    // coupe rear spoiler
    if (bt === "coupe") {
      const spoiler = boxMesh(w * 0.74, 0.07, 0.2, trim);
      spoiler.position.set(0, 0.78 + (hullY - 0.72) + hullH * 0.42, -len * 0.46); grp.add(spoiler);
    }
    // muscle: a black hood scoop + a low ducktail wing so it reads aggressive
    if (bt === "muscle") {
      const scoop = boxMesh(w * 0.36, 0.13, len * 0.18, trim);
      scoop.position.set(0, 0.78 + (hullY - 0.72) + hullH * 0.5, len * 0.26); grp.add(scoop);
      const wing = boxMesh(w * 0.8, 0.08, 0.16, trim);
      wing.position.set(0, 0.78 + (hullY - 0.72) + hullH * 0.5, -len * 0.46); grp.add(wing);
    }
    // van: a side-crease + a roof cap so the tall slab doesn't read as a brick
    if (bt === "van") {
      const cap = boxMesh(roofW + 0.06, 0.1, roofD, paint);
      cap.position.set(0, roofY + roofH * 0.5, roofZ); grp.add(cap);
    }
    if (bt === "hatch") {
      const spoiler = boxMesh(roofW * 0.92, 0.07, 0.16, trim);
      spoiler.position.set(0, roofY + roofH * 0.52, -len * 0.43); grp.add(spoiler);
    }

    // Small universal cues matter at traffic distance: mirrors, door cuts and a
    // rear plate make the silhouette read as a vehicle instead of stacked boxes.
    [1, -1].forEach((side) => {
      const mirror = boxMesh(0.18, 0.12, 0.26, trim);
      mirror.position.set(side * (roofW * 0.56), roofY - roofH * 0.18, roofZ + roofD * 0.28); grp.add(mirror);
      const seam = boxMesh(0.025, hullH * 0.68, 0.035, trim);
      seam.position.set(side * (w * 0.505), 0.78 + (hullY - 0.72) + hullH * 0.1, -len * 0.05); grp.add(seam);
    });
    const plate = boxMesh(w * 0.28, 0.14, 0.025, vmat("metal", 0xe8edf2, { emissive: 0x25282c, ei: 0.25 }));
    plate.position.set(0, 0.78 + (hullY - 0.72) - hullH * 0.08, -len * 0.5 - 0.085); grp.add(plate);

    if (model && model.livery === "taxi") {
      const sign = boxMesh(0.72, 0.22, 0.34, cmat(0xf8e46b, { emissive: 0x5a4a14, ei: 0.45 }));
      sign.position.set(0, roofY + roofH * 0.62, roofZ); grp.add(sign);
      const check = boxMesh(w + 0.025, 0.1, len * 0.48, trim);
      check.position.set(0, 0.78 + (hullY - 0.72) + hullH * 0.28, -len * 0.05); grp.add(check);
    }
    const detail = model && model.detailStyle;
    if (detail && /^tesla-/.test(detail)) {
      const roofGlass = boxMesh(roofW * 0.72, 0.035, roofD * 0.5, vmat("glass", 0x111d26, { emissive: 0x061018, ei: 0.35 }));
      roofGlass.position.set(0, roofY + roofH * 0.51, roofZ - roofD * 0.04); grp.add(roofGlass);
      const cleanNose = boxMesh(w * 0.72, 0.06, 0.03, paint);
      cleanNose.position.set(0, 0.78 + (hullY - 0.72) - hullH * 0.05, len * 0.5 + 0.02); grp.add(cleanNose);
    }
    if (detail === "cybertruck") {
      const cyberGlass = vmat("glass", 0x111d26, { emissive: 0x061018, ei: 0.35 });
      const tonneau = boxMesh(w * 0.86, 0.08, len * 0.34, trim);
      tonneau.position.set(0, roofY - roofH * 0.2, -len * 0.28); grp.add(tonneau);
      [1, -1].forEach((side) => {
        const sideGlass = boxMesh(0.035, roofH * 0.52, roofD * 0.7, cyberGlass);
        sideGlass.position.set(side * roofW * 0.51, roofY, roofZ); grp.add(sideGlass);
      });
    }
    if (detail && /ferrari|enzo|veyron|aventador|porsche/.test(detail)) {
      [1, -1].forEach((side) => {
        const intake = boxMesh(0.035, 0.18, len * 0.2, trim);
        intake.position.set(side * w * 0.505, 0.78 + (hullY - 0.72), -len * 0.05); grp.add(intake);
      });
    }
    addModelIdentity(grp, model, { w, len, hullH, hullY, roofW, roofH, roofY, roofZ, paint, trim });

    // shared FRONT FASCIA: a dark grille + a slim bumper bar so every nose has a
    // face (and a chrome-ish bumper at the tail). Cheap boxes; one trim material.
    const noseY = 0.78 + (hullY - 0.72) - hullH * 0.05;
    const grille = boxMesh(w * 0.7, hullH * 0.55, 0.08, trim);
    grille.position.set(0, noseY, len * 0.5 - 0.03); grp.add(grille);
    [len * 0.5 + 0.02, -len * 0.5 - 0.02].forEach((bz) => {
      const bump = boxMesh(w * 0.96, 0.18, 0.12, trim);
      bump.position.set(0, 0.78 + (hullY - 0.72) - hullH * 0.38, bz); grp.add(bump);
    });

    addWheels(grp, halfTrack, len * (bt === "van" ? 0.34 : 0.32), wheelR);
    addLights(grp, w, 0.78 + (hullY - 0.72) + hullH * 0.05, len * 0.5, -len * 0.5);
    grp.userData.bodyKind = bt;
    grp.userData.designStyle = model && model.designStyle || bt;
    grp.userData.vehicleDims = { width: w, length: len, height: roofY + roofH * 0.5, wheelbase: len * (bt === "van" ? 0.68 : 0.64) };
    // same hole-proofing as the unified visual: seal thin-panel seams and drop
    // a dark interior shell inside the hull (merges into the trim/tire bucket)
    sealSeams(grp, { width: w });
    addInteriorShell(grp, { width: w, length: len, shellTop: 0.78 + (hullY - 0.72) + hullH * 0.45 }, trim);
    mergeStaticCarParts(grp, new Set([body, cabin]));
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
      _bk: grp.userData && grp.userData.bodyKind, dims: grp.userData && grp.userData.vehicleDims,
      mass: prof.mass, armor: prof.armor, repair: prof.repair,
    };
    // A tiny fraction of genuine halo cars leave the factory/tuner scene with
    // the same purchasable chop-shop booster already fitted. This is rarity,
    // not random clutter: only the top catalog tier can roll it.
    if (model && model.rarity >= 0.975 && rng() < 0.10) c.mods = { booster: true, factoryBooster: true };
    tagTailMeshes(c);                     // one traverse per car, at build time
    addOccupants(c);                      // visible driver (+ sometimes a passenger) through the real glass
    CBZ.cityCars.push(c);
    return c;
  }

  // Lightweight inspection hooks used by the vehicle audit/gallery tools.
  CBZ.cityVehicleBodyKind = modelBodyKind;
  // multiplayer: net code spawns real local cars (ownership transfer on enter/exit)
  CBZ.cityMakeCar = makeCar;
  CBZ.cityBuildAmbientCarVisual = function (modelName) {
    const model = CBZ.cityEcon && CBZ.cityEcon.carByName ? CBZ.cityEcon.carByName(modelName) : null;
    return buildCar(model);
  };
  // A drive-by / hit car used to be a crude placeholder box (gangs.js buildDbCar)
  // — the user's "fake-as-fuck car comes when a hit is sent". This builds the SAME
  // real detailed visual every other city car uses, painted in the gang's colour so
  // the rolling-up car reads as that crew's ride. A real model (rarity-weighted to
  // common street cars) carries the body/style; only the paint is overridden.
  // Returns null when the visual system isn't loaded (headless/gallery) so the
  // caller can keep its lightweight box fallback. Parity, not new cost: this is the
  // exact pipeline used by all traffic.
  CBZ.cityBuildGangCarVisual = function (color) {
    if (!CBZ.cityBuildPlayerCarVisual || !CBZ.cityInferCarStyle) return null;
    const econ = CBZ.cityEcon;
    let model = econ && econ.pickCar ? econ.pickCar(rng() < 0.1) : null;
    // paint it the gang's colour (shallow clone so the catalog entry is untouched)
    if (color != null) model = Object.assign({}, model || {}, { color: color });
    // buildCar runs the real cityBuildPlayerCarVisual pipeline (guarded above), so
    // this is the same detailed mesh all traffic uses — painted for this gang.
    return buildCar(model);
  };

  CBZ.spawnCityTraffic = function (n) {
    clearCars();
    const A = CBZ.city.arena; if (!A) return;
    _s = 1234 + n;
    const econ = CBZ.cityEcon;
    const reckFrac = TR().recklessFrac != null ? TR().recklessFrac : 0.18;
    const [cLo, cHi] = TR().cruise || [7, 12];
    // ADOPTED: city/roadrules.js's CBZ.roadPick is the ONE placement query
    // (see its header). It replaces the eight-line road/lane/x/z/heading draw
    // that used to live here — and with it we stop putting ambient cars inside
    // the airport keep-out, on the military apron and in open water, which is
    // what the owner was looking at when he said the spawning was dumb.
    // We pass OUR SEEDED STREAM (`rng`), so worldgen stays byte-identical per
    // seed; roadPick makes a bounded, fixed number of draws off it. The `:`
    // arm is the original body verbatim — one-line revert, and the only thing
    // that runs if roadrules.js is absent.
    if (CBZ.roadPickUsed) CBZ.roadPickUsed("vehicles:spawnCityTraffic");
    for (let i = 0; i < n; i++) {
      let r, x, z, lane, laneIdx, dirSign, heading;
      const spot = CBZ.roadPick ? CBZ.roadPick({ rng: rng, tries: 10, spread: 90 }) : null;
      if (spot) {
        r = spot.road; x = spot.x; z = spot.z;
        lane = spot.lane; laneIdx = spot.laneIdx; dirSign = spot.dirSign; heading = spot.heading;
      } else {
        // roadPick exhausted its tries (a dense map where every candidate was
        // already occupied, or roadrules.js absent). The original body follows
        // — but it is wrapped in a few redraws that still refuse a keep-out
        // point, because falling back must not mean falling back INTO the
        // airfield. With roadrules absent roadPointOpen is undefined and this
        // degrades to exactly one pass of the original code.
        for (let t = 0; t < 6; t++) {
          r = A.roads[(rng() * A.roads.length) | 0];
          const along = (rng() - 0.5) * r.len * 0.85;
          dirSign = rng() < 0.5 ? 1 : -1;
          laneIdx = (rng() * lanesPerDir(r)) | 0;
          lane = laneOffset(r, dirSign, laneIdx);
          x = r.vertical ? r.x + lane : r.x + along;
          z = r.vertical ? r.z + along : r.z + lane;
          heading = r.vertical ? (dirSign > 0 ? 0 : Math.PI) : (dirSign > 0 ? Math.PI / 2 : -Math.PI / 2);
          if (!CBZ.roadPointOpen || CBZ.roadPointOpen(x, z)) break;
        }
      }
      const reckless = rng() < reckFrac;
      const aggr = reckless ? 0.65 + rng() * 0.35 : 0.15 + rng() * 0.35;
      const model = econ ? econ.pickCar(rng() < 0.12) : null;
      const c = makeCar(x, z, heading, r.vertical, model, aggr);
      c.road = r; c.lane = lane; c.dirSign = dirSign; c.laneIdx = laneIdx;
      c.baseV = (cLo + rng() * (cHi - cLo)) * (reckless ? (TR().aggrSpeedMul || 1.7) : 1);
      c.v = c.baseV * 0.6; c.reckless = reckless;
    }
  };

  function clearCars() {
    const keep = [];
    for (const c of CBZ.cityCars) {
      // _persist records (farm tractor/combine — world fixtures registered via
      // cityRegisterVehicle) are built ONCE at world build; a traffic reset
      // must not strip their visuals out of the biome. They keep their slot.
      if (c._persist) { keep.push(c); continue; }
      if (CBZ.cityDemotePlayerCar) CBZ.cityDemotePlayerCar(c);
      if (c.group && c.group.parent) c.group.parent.remove(c.group);
      if (c.group) c.group.traverse(function (o) {
        if (o.geometry && !o.geometry._shared && o.geometry.dispose) o.geometry.dispose();
        if (o.material && !o.material._shared && o.material.dispose) o.material.dispose();
      });
    }
    CBZ.cityCars.length = 0;
    for (const c of keep) CBZ.cityCars.push(c);
    // burnt-out hulks go with the fleet — the array is a ledger of records
    // this pass has just torn down, and a stale entry would let the eviction
    // in makeHusk re-dispose a group whose geometry is already freed.
    husks.length = 0;
  }
  CBZ.clearCityCars = clearCars;

  /* ---- SCRAP ONE CAR ------------------------------------------------------
     clearCars() tears down the WHOLE fleet, and until this existed there was
     no supported way to take a single record back out of the world again.
     Everywhere that needed one wrote its own four lines — racedrivers.js's
     despawn(), the chop-shop payout, the arena-root purges — and every place
     that FORGOT to write them leaked a car: a group welded to the arena root
     with a live record in CBZ.cityCars and nothing left holding a reference.
     island_speedway's loaner was exactly that bug, twenty times over on one
     grid. One entry point now, and it is idempotent: scrapping a car twice,
     or a car that was never registered, is a no-op rather than a double
     dispose of shared geometry. */
  CBZ.cityScrapCar = function (car) {
    if (!car || car._scrapped) return false;
    car._scrapped = true;
    // never scrap the car under the player — hand the seat back first
    if (car.player && CBZ.cityExitVehicle) { try { CBZ.cityExitVehicle(); } catch (e) {} }
    if (CBZ.cityDemotePlayerCar) { try { CBZ.cityDemotePlayerCar(car); } catch (e) {} }
    if (car._heldBy && CBZ.vehicleHoldRelease) { try { CBZ.vehicleHoldRelease(car); } catch (e) {} }
    const i = CBZ.cityCars.indexOf(car);
    if (i >= 0) CBZ.cityCars.splice(i, 1);
    car.dead = true;
    if (car.group) {
      if (car.group.parent) car.group.parent.remove(car.group);
      car.group.traverse(function (o) {
        if (o.isSprite) return;
        if (o.geometry && !o.geometry._shared && o.geometry.dispose) { try { o.geometry.dispose(); } catch (e) {} }
        const m = o.material;
        if (Array.isArray(m)) m.forEach((x) => { if (x && !x._shared && x.dispose) { try { x.dispose(); } catch (e) {} } });
        else if (m && !m._shared && m.dispose) { try { m.dispose(); } catch (e) {} }
      });
    }
    return true;
  };

  // ---- CUSTOM-VISUAL VEHICLE REGISTRATION ---------------------------------
  // Turn an already-built THREE.Group (emergency truck, farm tractor) into a
  // first-class CBZ.cityCars record: enterable via the interaction system
  // (cityNearestCar scans cityCars), solid to all traffic (resolveCars), and
  // drivable by the order-11 player loop. The group is registered as its OWN
  // "carVisual" so cityPromotePlayerCar keeps the custom body instead of
  // swapping in a procedural silhouette; wheel meshes the caller tagged with
  // userData.playerWheel spin while driven. opts:
  //   record   — augment THIS object in place (e.g. traffic.js's emergency
  //              record keeps a single identity) instead of a fresh one.
  //   body     — bodyKind for handling/mass ("van", "pickup", ...).
  //   style    — playercars FEEL style for the driven feel (default "van").
  //   model    — {name, value, rarity, body} for HUD/chop-shop/handling tier.
  //   dims     — {width, length, height, wheelbase} collision + visual dims.
  //   heading, color, persist (survive traffic resets — world fixtures).
  CBZ.cityRegisterVehicle = function (grp, opts) {
    if (!grp || !CBZ.cityCars) return null;
    opts = opts || {};
    const body = opts.body || "van";
    const prof = vehicleProfile(opts.model || null, body);
    const dims = opts.dims || { width: 2.2, length: 5.4, height: 2.2, wheelbase: 3.2 };
    grp.userData.carVisual = grp;
    grp.userData.carStyle = opts.style || "van";
    grp.userData.bodyKind = body;
    grp.userData.vehicleDims = dims;
    const c = opts.record || {};
    const defaults = {
      group: grp, pos: grp.position, heading: opts.heading || 0, vertical: false,
      model: opts.model || null, v: 0, vx: 0, vz: 0,
      color: opts.color != null ? opts.color : 0xdde3e8,
      stolen: false, player: false, ai: false, lane: 0, road: null, dirSign: 1, dead: false,
      driver: { aggr: 0.2 }, pullover: 0, ranRedCD: 0, turnCD: 2, npcWanted: 0, npcDriver: null,
      dwell: 0, stopT: 0, roadRageTarget: null, roadRageT: 0, playerHitCD: 0,
      engineHp: 100, _bk: body, dims: dims,
      mass: prof.mass, armor: prof.armor, repair: prof.repair,
    };
    for (const k in defaults) if (c[k] == null) c[k] = defaults[k];
    c._persist = !!opts.persist;
    tagTailMeshes(c);
    if (CBZ.cityCars.indexOf(c) < 0) CBZ.cityCars.push(c);
    return c;
  };

  /* ============================================================
     FREIGHT BODIES — a cargo box that is a ROOM
     ============================================================
     OWNER: "a semi truck with a cargo back that you can press on ipad or
     interact with E on desktop to open the back of the truck — and like
     elevators it is a space that can be filled by things. say you rob a bank:
     you bring a van and open the back of it... and drive to your warehouse."

     THIS FILE WRITES NO ROOM, NO DOOR, NO VERB AND NO LATCH. All of that is
     city/vehicle_hold.js, whose adoption contract is one call and which
     registers the E verb and the touch pill ONCE for every hold that will ever
     exist. What lives here is the three things only vehicles.js can know:

       (1) WHEN a car record exists to hang a hold on          — adoptHold
       (2) WHICH cars are eligible to be strapped down inside  — cargoCensus
       (3) WHERE the trucks are                                — the fleet placer

     ADOPTION IS LAZY, AND THAT IS A BUDGET, NOT AN OPTIMISATION. Every van in
     the city publishes a holdSpec, and a city holds dozens of vans. A hold is a
     moving-platform rig with decks and walls plus a 0.3 s latch sweep over the
     whole car list, and thirty of those idling for vans nobody is near is
     exactly the quiet cost this repo keeps finding in itself. So a hold is
     minted inside HOLD_NEAR and given back past HOLD_FAR — and NOTHING VISIBLE
     CHANGES either way, because a hold draws nothing: the box, the doors and
     the deck are art that is always there. That is what makes this budget free
     where the occupancy rig's (OCC_RIG_CARS) had to be careful.

     A LOADED HOLD IS NEVER RETIRED. retireHold refuses while the ramp is open
     or anything at all is aboard, so the van you filled with bank money keeps
     its room for as long as the money is in it, however far you drive. */
  const HOLD_NEAR2 = 90 * 90, HOLD_FAR2 = 200 * 200, HOLD_LIVE_MAX = 10;
  let holdAdopted = 0, holdRetired = 0, holdWatched = false, holdSweepT = 0;
  let holdDoorless = 0;

  /* WHERE THE SPEC ACTUALLY LIVES, and it is TWO places for one honest reason.
     A registered custom group (the semi) IS its own visual — cityRegisterVehicle
     sets `carVisual = grp` — so the spec is on the record's group. A catalogue
     car (the van) is built by buildCar(), which wraps playercars.js's template
     clone in a FRESH group and copies only the four fields it knows about; the
     holdSpec stays on the clone. Both frames are identical (the visual is added
     at the origin with no rotation and no scale), so the LOCAL METRES the
     contract asks for mean the same thing either way — but the lookup has to
     know about the wrapper or every van in the city is invisible to this wave.
     MEASURED: without the second clause, cityFreightAudit read `vans: 0` in a
     world holding 264 cars. */
  function holdSpecOf(c) {
    const ud = c && c.group && c.group.userData;
    if (!ud) return null;
    if (ud.holdSpec) return ud.holdSpec;
    const v = ud.carVisual;
    return (v && v !== c.group && v.userData && v.userData.holdSpec) || null;
  }

  /* THE ONE ADOPTION SITE. Everything that can ever carry freight goes through
     here — a van built by makeCar off the catalog, a semi registered by the
     fleet placer, anything a future builder publishes a holdSpec on. */
  function adoptHold(c) {
    if (!c || !c.group || !c.group.parent || c.dead) return null;
    if (c.hold && !c.hold.inert) return c.hold;
    if (!CBZ.vehicleHold) return null;
    const spec = holdSpecOf(c);
    if (!spec || !spec.floor) return null;
    /* RE-RESOLVE THE DOOR OFF THIS INSTANCE. playercars.js caches ONE template
       per silhouette and hands out clone(true)s that share userData BY
       REFERENCE (its own comment says so, and it is why the rotor/prop handles
       are re-resolved by name). A live Object3D stashed in a holdSpec would
       therefore be the TEMPLATE's door on every van in the city — one node,
       forty vans, and opening any of them would animate a mesh nobody can see.
       So the spec carries a NAME and the node is looked up here, every time. */
    let ramp = null;
    const R = spec.ramp;
    if (R && R.nodeName) {
      const node = c.group.getObjectByName(R.nodeName);
      // No node = the flag that draws it is off, or a merge ate it. A hold with
      // a declared-but-missing door would be a permanently sealed room, which
      // is worse than no hold: refuse, and let holdAudit count the absence.
      if (!node) { holdDoorless++; return null; }
      ramp = {
        node: node, w: R.w, len: R.len, x: R.x,
        sillZ: R.sillZ, sillTop: R.sillTop,
        closedRx: R.closedRx, openRx: R.openRx, dir: R.dir, seconds: R.seconds,
      };
    }
    const h = CBZ.vehicleHold(c, {
      id: spec.id, label: spec.label, floor: spec.floor,
      roof: spec.roof, walls: spec.walls, ramp: ramp, scale: spec.scale,
    });
    // vehicleHold stamps `c.hold` itself for a record host — never mirror it.
    if (!h || h.inert) return null;
    holdAdopted++;
    return h;
  }

  /* HOW MANY GROUND HOLDS ARE LIVE — COUNTED, NEVER TRACKED. The first draft
     kept a `holdLive` counter that adoptHold incremented and retireHold
     decremented, and it drifted within one probe run: vehicle_hold.js disposes
     a hold ITSELF when its host leaves the scene (an arena rebuild), which no
     decrement here can see. Measured: the counter read 5 against 4 real holds,
     and since the budget gate reads it, a long session would have quietly
     stopped minting holds altogether.
     That is the parallel-bookkeeping trap this repo's own doctrine names, and
     the answer is the one factions.js uses: do not mirror state somebody else
     owns — ask. It costs one pass over the car list per 0.4 s sweep, once, not
     once per car. */
  function liveGroundHolds() {
    let n = 0;
    const cars = CBZ.cityCars || [];
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i];
      if (c && c.hold && !c.hold.inert && holdSpecOf(c)) n++;
    }
    return n;
  }
  CBZ.cityVehicleHoldAdopt = adoptHold;

  function retireHold(c) {
    const h = c && c.hold;
    if (!h || h.inert || !h.dispose) return false;
    if (!h.closed) return false;                       // a door left open stays open
    const o = h.occupants();
    if (o.vehicles || o.cargo || o.actors || o.player) return false;
    h.dispose();
    c.hold = null;
    if (c.group && c.group.userData) c.group.userData.cargoHold = null;
    holdRetired++;
    return true;
  }

  /* WHAT MAY BE CHAINED DOWN IN A TRAILER. The census contract is
     CBZ.vehicleHoldWatch's (the CBZ.heliFleet pattern): a fleet owner pushes
     ONE function and every hold in the world can strap its machines down.
     Four refusals, and each is a decision:
       · dead / husk — vehicle_hold's own sweep filters `rec.destroyed`, which
         nothing in this file has ever set. A city car says `dead` (+ `_husk`
         for a standing wreck), so without this line a burnt-out hulk would
         chain itself into any trailer that parked over it.
       · player / ai / npcDriver — a machine somebody is driving owns its own
         pose, and an AMBIENT car is somebody driving. Latching a traffic car
         that happened to stop inside a trailer would put the hold and the AI
         lane-follower in a fight over the same transform every frame. What you
         CAN load is a car nobody is driving: parked, abandoned, or the one you
         drove up the ramp yourself and stepped out of.
       · a freight body — a hold inside a hold is a moving platform anchored to
         a group whose own pose is written by another moving platform. That may
         well work; it is not something this wave measured, and shipping an
         untested nesting is how a bug with no owner starts. */
  const _census = [];
  function cargoCensus() {
    _census.length = 0;
    const cars = CBZ.cityCars;
    if (!cars) return _census;
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i];
      if (!c || c.dead || c._husk || c.player || c.ai || c.npcDriver) continue;
      if (!c.group || !c.group.parent) continue;
      if (holdSpecOf(c)) continue;
      _census.push(c);
    }
    return _census;
  }

  CBZ.onUpdate(14.64, function (dt) {
    if (g.mode !== "city" || !CBZ.vehicleHold) return;
    if (!holdWatched && CBZ.vehicleHoldWatch) { CBZ.vehicleHoldWatch(cargoCensus); holdWatched = true; }
    holdSweepT -= dt || 0;
    if (holdSweepT > 0) return;
    holdSweepT = 0.4;
    const cm = CBZ.camera && CBZ.camera.position; if (!cm) return;
    const cars = CBZ.cityCars; if (!cars) return;
    let live = liveGroundHolds();
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i];
      if (!c || !c.group || !holdSpecOf(c)) continue;
      const dx = c.pos.x - cm.x, dz = c.pos.z - cm.z, d2 = dx * dx + dz * dz;
      if (!c.hold || c.hold.inert) {
        if (d2 < HOLD_NEAR2 && live < HOLD_LIVE_MAX && adoptHold(c)) live++;
      } else if (d2 > HOLD_FAR2) {
        if (retireHold(c)) live--;
      }
    }
  });

  /* ============================================================
     THE FLEET — where the trucks are
     ============================================================
     TWO PLACES, AND BOTH ARE PLACES THE WORLD ALREADY BUILT. This wave spawns
     no scenery and invents no coordinate: the Freeport's own published
     warehouse record says where its loading dock is and WHICH WAY IS OUT
     (govcomplex.js authored `out` for exactly this — its comment names "a
     parked truck, a spawn"), and the city's own lot grid says which blocks are
     industrial. If neither exists in a build, no truck exists in it, and that
     is the honest answer rather than a truck in a field.

     DETERMINISM: every choice is a position hash (carHash → CBZ.hash01), never
     the shared rng() stream, which is the same rule cityAddParkedCar states —
     an order-fragile draw here would move every car in the city. */
  const SEMI_MODEL = { name: "Bison Longhauler", value: 96000, rarity: 0.30, body: "semi", s: 1 };
  let fleetRoot = null, fleetDockDone = false, fleetWait = 0, fleetCount = 0;

  function placeSemi(x, z, heading, tag) {
    const root = CBZ.city && CBZ.city.arena && CBZ.city.arena.root;
    if (!root || !CBZ.cityBuildPlayerCarVisual) return null;
    if (CBZ.cityWaterAt) { try { if (CBZ.cityWaterAt(x, z)) return null; } catch (e) {} }
    let v = null;
    // SEMI_TRUCK_V1 off → makeProcedural answers null and the yard stays empty.
    try { v = CBZ.cityBuildPlayerCarVisual("semi", null, null, SEMI_MODEL); } catch (e) { v = null; }
    if (!v) return null;
    /* THE SAME HOLE-PROOFING AND THE SAME MERGE buildCar() gives every other
       car, applied by hand because a registered custom group does not pass
       through it. This is not optional book-keeping — an unmerged semi is
       ~130 source meshes (five shell panels, twenty-eight corrugation ribs,
       twenty wheel parts, the whole cab), and the city is draw-call bound
       (core/profile.js). Merged, it is a handful of buckets.
       WHAT IS SPARED: the tyres, tagged playerWheel so the drive loop can spin
       them — and the tailgate, which needs no sparing at all because it is a
       GROUP and mergeStaticCarParts only ever bakes direct MESH children. That
       is the same property playercars.js's wheel-arch comment relies on, and it
       is exactly why the door was authored as a group. */
    const dims = v.userData.vehicleDims || { width: 2.5, length: 14.5, height: 3.31, wheelbase: 8.6 };
    const keep = new Set();
    v.traverse(function (o) { if (o.userData && o.userData.playerWheel) keep.add(o); });
    try {
      sealSeams(v, dims);
      addInteriorShell(v, dims, null);
      if (mergeStaticCarParts) mergeStaticCarParts(v, keep);
    } catch (e) { /* a lightweight test renderer without geometry baking */ }
    v.position.set(x, 0, z);
    v.rotation.y = heading;
    root.add(v);
    const c = CBZ.cityRegisterVehicle(v, {
      body: "semi", style: "semi", heading: heading, persist: true,
      color: 0xd8dde3, model: SEMI_MODEL, dims: dims,
    });
    if (!c) return null;
    c.ai = false; c.v = 0; c.baseV = 0; c.stolen = false;
    c._propParked = true; c._arenaRoot = root; c._cargoFleet = tag || "yard";
    parkSeat(c);                       // sit it on the real ground, not at y = 0
    fleetCount++;
    return c;
  }

  function freeportYard() {
    const L = CBZ.govComplexes;
    if (!L || !L.length) return null;
    for (let i = 0; i < L.length; i++) {
      const s = L[i];
      if (s && s.id === "freeport" && s.warehouse && s.warehouse.dock && s.warehouse.out) return s.warehouse;
    }
    return null;
  }

  /* BACKED ONTO THE DOCK. The rig's REAR is what has to face the shed, so its
     nose points along `out` — and forward at heading h is (sin h, cos h) in
     this engine, which makes the heading atan2(out.x, out.z) and nothing else.
     Two of the shed's three roller doors get a trailer (they are 9.4 m apart,
     govcomplex.js's own pitch); the middle one is left clear because a dock you
     cannot walk up to is a dock you cannot unload at. */
  function spawnDockFleet() {
    const W = freeportYard();
    if (!W) return false;
    const ox = W.out.x, oz = W.out.z;
    const h = Math.atan2(ox, oz);
    const px = oz, pz = -ox;                       // the dock face's own lateral axis
    let n = 0;
    for (const k of [-1, 1]) {
      // origin = dock point + out·(half the rig) so the trailer's tail sits at
      // the lip and the tailgate lands ON the deck when it drops.
      const x = W.dock.x + ox * 7.25 + px * (k * 9.4);
      const z = W.dock.z + oz * 7.25 + pz * (k * 9.4);
      if (!spotClear(x, z, h, 7.25, 1.6)) continue;
      if (placeSemi(x, z, h, "freeport-dock")) n++;
    }
    // and the van the owner actually named, on the apron beside them, through
    // the SHARED parked-car placer rather than a second one of our own.
    if (CBZ.cityAddParkedCar) {
      try {
        CBZ.cityAddParkedCar(W.apron.x - px * 6, W.apron.z - pz * 6, h, { modelName: "Bison Hauler" });
      } catch (e) {}
    }
    return n > 0;
  }

  /* IS THERE ROOM FOR SIXTEEN METRES OF TRUCK HERE? Asked of CBZ.collide — the
     SAME static-collider query collideVehicle makes for a driven car — at three
     points down the rig's own length. collide() resolves in place, so a probe
     that came back moved is a probe that was inside something. This is what
     lets a placement be authored as an intention ("a row along the yard") and
     still be safe in a world that was laid out by somebody else. */
  const _clearProbe = new THREE.Vector3();
  function spotClear(x, z, heading, halfLen, rad) {
    if (CBZ.cityWaterAt) { try { if (CBZ.cityWaterAt(x, z)) return false; } catch (e) {} }
    /* Nothing already PARKED here — a fixture on top of a fixture is a bug you
       only see from one angle. Deliberately only FIXTURES (`_propParked` /
       `_cargoFleet`), never ambient traffic: an AI car's position depends on
       how many frames have elapsed when this pass happens to run, so testing
       against one would make placement depend on the clock and the same seed
       would lay the yard out differently on every load. A parked fixture is
       placed by a position hash and is in the same place forever. */
    const cars = CBZ.cityCars || [];
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i];
      if (!c || !c.pos || !(c._propParked || c._cargoFleet)) continue;
      const dx = c.pos.x - x, dz = c.pos.z - z;
      if (dx * dx + dz * dz < 12 * 12) return false;
    }
    if (!CBZ.collide) return true;
    const fx = Math.sin(heading), fz = Math.cos(heading);
    for (let t = -1; t <= 1; t++) {
      const ox = x + fx * halfLen * t, oz = z + fz * halfLen * t;
      _clearProbe.set(ox, 1.2, oz);
      try { CBZ.collide(_clearProbe, rad); } catch (e) { return true; }
      if (Math.abs(_clearProbe.x - ox) > 0.03 || Math.abs(_clearProbe.z - oz) > 0.03) return false;
    }
    return true;
  }

  /* THE YARD ROW — tractor units standing in the Freeport's own hardstanding.
     WHY NOT INDUSTRIAL LOTS, which is where a first draft put them: because
     there are none free. MEASURED on seed 90210 — 318 lots, of which 8 resolve
     to the industrial districts (7 and 8), and every one of the 8 carries a
     building. `lot.district` is an INDEX into arena.districts, not the string
     the first draft compared against, so that scan matched nothing and would
     have matched nothing even spelled correctly. Shipping the scan anyway
     because it "might find something on another seed" is exactly the dead
     branch doctrine bans.
     So the trucks go where the world actually built a place for trucks: the
     Freeport yard is 178 × 96 m of asphalt inside a fence with a shed, a dock
     and a racking hall, and govcomplex.js published its origin and its OUT
     direction. Every spot is still probed against the real colliders, so a
     future change to that yard's furniture cannot silently park a semi inside
     a container stack. */
  function spawnYardFleet() {
    const W = freeportYard();
    if (!W) return 0;
    const ox = W.out.x, oz = W.out.z, px = oz, pz = -ox;
    const h = Math.atan2(ox, oz);
    let n = 0;
    // A ROW, nose-out toward the gate, well clear of the dock lane (which runs
    // to +18.5 m out from the origin) and on the far side of the yard from it.
    for (let k = 0; k < 3; k++) {
      const lat = -46 + k * 15;
      const x = W.origin.x + ox * 34 + px * lat;
      const z = W.origin.z + oz * 34 + pz * lat;
      // hashed, so a seed that wants a busier or emptier yard gets one and it
      // is the SAME yard every time you load it
      if (carHash(x, z, 613) < 0.30) continue;
      if (!spotClear(x, z, h, 7.25, 1.6)) continue;
      if (placeSemi(x, z, h, "freeport-yard")) n++;
    }
    return n;
  }

  /* ============================================================
     CBZ.cityFreightAudit() — THE RATCHET for the ground half
     ============================================================
     holdAudit() owns the ROOM's numbers; this owns the FLEET's, because they
     are different facts with different authors and an audit that answered both
     could not be pinned by either.

     `doorless` IS THE NUMBER THAT MATTERS and it is pinned at 0: it counts
     freight bodies whose holdSpec named a hinged door node that the built group
     does not contain. That is a spec and its art disagreeing — a sealed room —
     and it is the one failure this design can produce silently, because the
     hold simply never appears and nothing looks broken.

     `overBudget` is the second invariant: live ground holds may never exceed
     HOLD_LIVE_MAX, or the lazy budget above is not a budget. Everything else is
     evidence printed beside them, so a "fix" that stops declaring freight
     bodies (bodies -> 0) cannot pass either number. */
  CBZ.cityFreightAudit = function () {
    let bodies = 0, semis = 0, vans = 0, withHold = 0, open = 0, loads = 0, fleet = 0;
    const cars = CBZ.cityCars || [];
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i];
      if (!c || !holdSpecOf(c)) continue;
      bodies++;
      if (c._bk === "semi") semis++; else vans++;
      if (c._cargoFleet) fleet++;
      const h = c.hold;
      if (h && !h.inert) {
        withHold++;
        if (h.open) open++;
        const o = h.occupants();
        loads += o.vehicles + o.cargo + o.actors;
      }
    }
    return {
      bodies: bodies, semis: semis, vans: vans, fleetPlaced: fleet,
      holds: withHold, rampsOpen: open, loads: loads,
      adopted: holdAdopted, retired: holdRetired,
      budget: HOLD_LIVE_MAX,
      overBudget: Math.max(0, withHold - HOLD_LIVE_MAX),
      doorless: holdDoorless,
    };
  };

  // ONE ENTRY POINT. The dock row goes down FIRST so the yard row's clearance
  // probe can see it — order is the only coupling between the two.
  function spawnCargoFleet() {
    if (!freeportYard()) return 0;
    const before = fleetCount;
    spawnDockFleet();
    spawnYardFleet();
    return fleetCount - before;
  }
  CBZ.citySpawnCargoFleet = spawnCargoFleet;

  /* ONE SHOT PER ARENA, AND IT RETRIES. govcomplex.js publishes the Freeport
     during world build, but a landmass rebuild re-runs both passes and the
     order between them is not ours to assume — asking once and giving up would
     make the fleet's existence depend on a race. Twelve seconds of sim, then we
     stop asking: a build with no Freeport is a legitimate build, and it gets no
     trucks rather than trucks in a field. */
  CBZ.onUpdate(55.2, function (dt) {
    if (g.mode !== "city") return;
    const A = CBZ.city && CBZ.city.arena, root = A && A.root;
    if (!root || !CBZ.cityBuildPlayerCarVisual) return;
    if (root !== fleetRoot) {
      fleetRoot = root; fleetDockDone = false; fleetWait = 0;
      // drop fixtures belonging to a torn-down arena, exactly as the parked-car
      // placer does — a stale record keeps a dead group's hold alive
      for (let i = CBZ.cityCars.length - 1; i >= 0; i--) {
        const old = CBZ.cityCars[i];
        if (old && old._cargoFleet && old._arenaRoot !== root) CBZ.cityCars.splice(i, 1);
      }
    }
    if (fleetDockDone) return;
    fleetWait += dt || 0;
    if (spawnCargoFleet() > 0 || fleetWait > 12) fleetDockDone = true;
  });

  // ---- EVERY CAR CONTROLLABLE (owner law: no dumb props) -------------------
  // A deterministic PARKED-but-REAL car for world/template builders: a full
  // cityCars record (enterable, drivable, damageable) that starts stationary
  // and survives traffic resets (world fixture). Model picked by position-hash
  // from the catalog (never the shared rng stream — order-safe), or by name.
  // Stale fixtures from a previous arena build are purged on the next spawn.
  if (CBZ.CONFIG && CBZ.CONFIG.CARS_ALL_DRIVABLE == null) CBZ.CONFIG.CARS_ALL_DRIVABLE = true;
  CBZ.cityAddParkedCar = function (x, z, heading, opts) {
    if (!CBZ.city || !CBZ.city.arena) return null;
    if (CBZ.CONFIG && CBZ.CONFIG.CARS_ALL_DRIVABLE === false) return null;
    opts = opts || {};
    // A parked car IN THE SEA is never anything but a bug, whoever placed it.
    // Deliberately only the WATER half of roadPointOpen's test and not the
    // keep-out half: these are AUTHORED positions, and a builder parking staff
    // cars inside its own airside or motor pool is doing the right thing —
    // refusing those would silently delete legitimate world content to fix a
    // problem that lives in the AMBIENT paths (see roadrules.js). `force`
    // exists for a builder that genuinely means to put a car in the water
    // (a boat ramp, a flood set-piece).
    if (!opts.force && CBZ.cityWaterAt) {
      try { if (CBZ.cityWaterAt(x, z)) return null; } catch (e) {}
    }
    const root = CBZ.city.arena.root;
    // purge fixtures whose group belongs to a torn-down arena root
    for (let i = CBZ.cityCars.length - 1; i >= 0; i--) {
      const old = CBZ.cityCars[i];
      if (old._propParked && old._arenaRoot !== root) CBZ.cityCars.splice(i, 1);
    }
    const econ = CBZ.cityEcon;
    let model = null;
    if (opts.modelName && econ && econ.carByName) model = econ.carByName(opts.modelName);
    if (!model && econ && econ.CARS && econ.CARS.length) {
      model = econ.CARS[(carHash(x, z, 77) * econ.CARS.length) | 0] || null;
    }
    const c = makeCar(x, z, heading || 0, false, model, 0.2);
    c.ai = false; c.v = 0; c.baseV = 0; c.stolen = false;
    c._persist = true; c._propParked = true; c._arenaRoot = root;
    if (opts.color != null && c.group) {
      // repaint deterministically via the shared recolor hook when present
      if (CBZ.cityRecolorCar) { try { CBZ.cityRecolorCar(c, opts.color); } catch (e) {} }
    }
    if (opts.color != null) c.color = opts.color;
    syncOccupants(c);                       // parked = empty; no ghost driver
    return c;
  };

  /* THE REPAINT HOOK THAT WAS ONLY EVER CALLED. `cityAddParkedCar` has asked
     for `CBZ.cityRecolorCar` since the day it was written and nothing in the
     repo ever defined it, so every caller that passed a colour — a venue
     dressing its staff cars, a gang parking its fleet — silently got the
     position-hashed catalog paint instead. It is one line over the shared
     traversal; it never was worth a second implementation, only a definition. */
  CBZ.cityRecolorCar = function (car, color) {
    if (!car || color == null) return false;
    const root = (car.group && car.group.userData && car.group.userData.carVisual) || car.group;
    if (!root || !CBZ.cityRecolorCarBody) return false;
    CBZ.cityRecolorCarBody(root, color);
    car.color = color;
    return true;
  };

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
    // c.dead skip: a sunk (CARS_NO_WATER) or exploded-awaiting-reap wreck must
    // never offer "Get in"/"Boost it" — you can't drive a dead hull.
    for (const c of CBZ.cityCars) { if (c.player || c.dead) continue; const d = Math.hypot(c.pos.x - x, c.pos.z - z); if (d < bd) { bd = d; best = c; } }
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
    ped._njCarjack = true;                        // whose eject decrements the cap
    npcDrivers++;
    if (CBZ.cityNpcOffense) CBZ.cityNpcOffense(ped, 24, "carjacking");
    return true;
  };

  /* ==========================================================================
     GETTING OUT OF A CAR — the door, the decision, and what it leaves behind.

     `ejectNpcDriver` used to be five lines: null the field, show the body,
     `pos.set(car.pos.x + 1.6, 0, car.pos.z)`. That single `+1.6` on X is the
     whole bug the owner filmed — it ignores which way the car is pointing, so
     half the time the driver materialised through his own door, into oncoming
     traffic, or inside a wall; it ignores the ground (a literal y = 0, the
     fault `seatCar` was written to end); and having no state to set, the man
     who was just dragged out of his own car at a junction simply resumed
     walking, with no fear, no gun, no memory and nothing filed.

     Everything below replaces those five lines. NOTHING here is a new system:
     the door side comes from the car's heading and the seat's own side, the
     exit runs through `CBZ.cityUnseat` (the ONE sanctioned seat exit), the
     decision runs through `CBZ.cityScare` + `CBZ.citySizeUp` (freeze-or-bolt
     and "does this person dare", both stable per person), the weapon appears
     through `CBZ.syncActorWeapon`, the crime and its witnesses through
     `CBZ.cityCrime`, and what the person REMEMBERS through
     `CBZ.cityRelShift` + `CBZ.cityTraitShift`.
  ========================================================================== */
  const _occOut = { x: 0, y: 0, z: 0 };
  function occDoorSpot(c, side, row, out) {
    out = out || _occOut;
    const h = c.heading || 0;
    const rx = Math.cos(h), rz = -Math.sin(h);          // car's local +X, in world
    const fx = Math.sin(h), fz = Math.cos(h);           // car's local +Z (forward)
    const dims = vehicleDims(c);
    const half = c._occFrame ? c._occFrame.halfW : (((dims && dims.width) || 1.9) * 0.5);
    const outD = half + 0.85;
    const alongZ = row ? -0.75 : 0.25;                  // rear doors are behind the B-pillar
    out.x = c.pos.x + rx * side * outD + fx * alongZ;
    out.z = c.pos.z + rz * side * outD + fz * alongZ;
    // A DOOR THAT OPENS INTO A WALL IS NOT AN EXIT. Same depenetration every
    // NPC mover uses; if the near side is blocked the body slides clear of it
    // rather than standing inside a facade.
    if (CBZ.collide) {
      out.y = 0;
      try { CBZ.collide(out, 0.42, 0, 1.7); } catch (e) {}
    }
    return out;
  }
  // put ONE body on the pavement beside its own door. Returns the ped.
  function occStepOut(c, seat, opts) {
    opts = opts || {};
    const p = seat.ped; if (!p) return null;
    const spot = occDoorSpot(c, seat.side, seat.row);
    const gy = CBZ.floorAt ? CBZ.floorAt(spot.x, spot.z) : 0;
    if (p._npcAttached && CBZ.cityUnseat) {
      try { CBZ.cityUnseat(p, { x: spot.x, z: spot.z, y: gy, state: p.dead ? "dead" : (opts.state || "walk") }); } catch (e) {}
    } else if (p.pos && p.pos.set) {
      p.pos.set(spot.x, gy, spot.z);
      if (p.group) { p.group.position.copy(p.pos); p.group.visible = !p._spawnHidden; }
      // a fleeing body already has a target it is running toward — never stomp it
      if (!opts.keepTarget && p.target && p.target.set) p.target.set(spot.x, 0, spot.z);
    }
    p.inCar = null; p.controlled = false;
    p._occCar = null; p._occSeat = null;
    seat.ped = null; seat.spawned = false; seat.frozen = false;
    seat.gone = true;                                   // THE SEAT IS EMPTY NOW
    if (seat.blob) seat.blob.visible = false;
    if (c.npcDriver === p && c._occOwnsDriver) { c.npcDriver = null; c._occOwnsDriver = false; }
    if (c.occ) c.occ.rigs = Math.max(0, c.occ.rigs - 1);
    // AN EMPTY CAR IS NOT A RIGGED CAR. The rig budget is a live count of cars
    // holding real bodies; a car everybody has climbed out of must give its
    // slot back or the cap silently strangles every promotion after it
    // (measured: 14 "rigged" cars against a cap of 3, all of them empty).
    if (c._occRigged && (!c.occ || c.occ.rigs <= 0)) { c._occRigged = false; occRigCars = Math.max(0, occRigCars - 1); }
    // OUT OF BALANCE, not teleported: a body shoved out of a seat needs a beat
    // to find its feet before its brain takes over.
    if (!p.dead) { p.speed = 0; p.pause = Math.max(p.pause || 0, opts.stumble === false ? 0.2 : 0.42); }
    return p;
  }

  /* ---- THE DECISION TABLE -------------------------------------------------
     ONE decision per person, LATCHED on the seat, so the man who drew on you
     is the man who is still drawn on you two seconds later. Nothing here rolls
     a die: `citySizeUp` answers "does this person dare" off levels and backup,
     `cityScare` draws freeze-vs-bolt from the person's own stable roleHash and
     the live panic field, and `cityTraits` reads nerve/greed/loyalty off data
     the ped already carried.

        armed & dares & not bolting ............ FIGHT   (draws, turns on you)
        loyal armed passenger, driver fighting . FIGHT   (he does not leave his man)
        cityScare says bolt .................... FLEE    (out the far door, running)
        greedy + shaky, or already afraid ...... BEG     (hands up, pleading)
        otherwise .............................. FREEZE  (hands up, holds still)

     FREEZE IS THE ONE THAT MATTERS FOR A PASSENGER: a frozen passenger does
     not get out. Drive away with him and he is not a loose end, he is your
     hostage — the fields `social.js`'s hostage system and `restrain.js` read
     get set for real. */
  function occReact(c, seat, by, driverKind) {
    if (seat.react) return seat.react;
    const p = seat.ped; if (!p) return null;
    const T = CBZ.cityTraits ? CBZ.cityTraits(p) : null;
    const nerve = T ? T.nerve : (p.aggr == null ? 0.4 : p.aggr);
    const armed = !!p.armed;
    const dares = CBZ.citySizeUp ? !!CBZ.citySizeUp(p, by) : nerve > 0.6;
    // a steady person is harder to send running; cityScare adds this to its
    // bolt odds, so nerve bends the SHARED decision instead of forking it. A
    // passenger gets a little more, and it is not a thumb on the scale: he has
    // a door nobody is standing at, which is exactly what the front seats do
    // not have.
    const bias = (0.5 - nerve) * 0.30 + (seat.slot === "driver" ? 0 : 0.10);
    // HAND THE BODY BACK FOR THE LENGTH OF ONE QUESTION. `cityScare` refuses
    // any actor flagged `controlled` — correctly, because that flag means some
    // other system owns this body and a panic brain must not fight it for the
    // wheel. A seated occupant carries it, so asking freeze-or-bolt while the
    // flag was up returned "hold" EVERY TIME and the whole flee branch was
    // dead code (measured: 0 of 14 jacked people ran). We are about to stop
    // owning him either way, so we release him, ask, and only re-claim him if
    // the answer was to sit still.
    const wasCtl = p.controlled;
    p.controlled = false;
    const scare = CBZ.cityScare ? CBZ.cityScare(p, by, { seat: true, bias: bias })
      : (nerve < 0.4 ? "bolt" : "hold");
    if (scare !== "bolt") p.controlled = wasCtl;
    let kind;
    if (armed && dares && scare !== "bolt") kind = "fight";
    else if (seat.slot !== "driver" && driverKind === "fight" && armed && T && T.loyalty > 0.62) kind = "fight";
    else if (scare === "bolt") kind = "flee";
    else if (T && T.greed > 0.62 && nerve < 0.46) kind = "beg";
    else if (nerve < 0.28 || (p.fear || 0) > 6) kind = "beg";
    else kind = "freeze";
    seat.react = kind;
    if (occStat.react[kind] != null) occStat.react[kind]++;
    return kind;
  }
  // A GUN THAT DOES NOT APPEAR IS NOT A GUN. actorweapons.js sockets the prop;
  // `_holstered` is its own "gun away" intent flag, so drawing is un-setting it.
  function occDraw(p) {
    if (!p) return false;
    if (!p.armed) { p.armed = true; p.weapon = p.weapon || "Pistol"; p.ammo = p.ammo || 12; }
    p._holstered = false; p._gunLowered = false; p._gunHidden = false;
    if (CBZ.syncActorWeapon) { try { CBZ.syncActorWeapon(p); } catch (e) {} }
    return true;
  }
  function occHandsUp(p, secs) {
    p.surrender = true;
    p.surrenderT = Math.max(p.surrenderT || 0, secs);
    p.poseHandsUp = true;
    if (p.char) p.char.handsUp = true;
    p.rage = null;
  }
  function occApply(c, seat, kind, by) {
    const p = seat.ped; if (!p) return;
    const isDriver = seat.slot === "driver";
    // the decision travels WITH the person, not just with the seat he left —
    // a body on the pavement can still say what it decided.
    p._occLastReact = kind;
    if (kind === "fight") {
      occStepOut(c, seat, { state: "walk", stumble: false });
      occDraw(p);
      p.rage = by || (CBZ.city && CBZ.city.playerActor) || null;
      p.alarmed = Math.max(p.alarmed || 0, 8);
      p.aggr = Math.max(p.aggr || 0, 0.75);
      if (CBZ.cityTraitShift) CBZ.cityTraitShift(p, "nerve", +0.03);
    } else if (kind === "flee") {
      // cityScare's bolt branch has already unseated + aimed him; step-out only
      // moves him to his own door and must not touch the flee target.
      occStepOut(c, seat, { state: "flee", keepTarget: true });
      p.fear = Math.max(p.fear || 0, 9);
      p.alarmed = Math.max(p.alarmed || 0, 7);
      if (CBZ.cityPanicRaise) CBZ.cityPanicRaise(p.pos.x, p.pos.z, 1);
    } else if (kind === "beg") {
      occStepOut(c, seat, { state: "walk" });
      occHandsUp(p, 5.5);
      p.fear = 10;
      if (CBZ.cityPanicRaise) CBZ.cityPanicRaise(p.pos.x, p.pos.z, 0.6);
    } else {                                                   // freeze
      if (isDriver) {                                          // his seat is taken — he goes
        occStepOut(c, seat, { state: "walk" });
        occHandsUp(p, 4.0);
        p.fear = Math.max(p.fear || 0, 8);
      } else {
        // HE DOES NOT MOVE. Still attached, still in the seat, still yours.
        seat.frozen = true; seat.frozenT = 0;
        occHandsUp(p, 6.0);
        p.fear = Math.max(p.fear || 0, 9);
      }
    }
    // WHAT IT LEAVES ON HIM. The relationship moves through the one shared
    // ledger; the trait drift is the permanent half — a man dragged out of his
    // own car at gunpoint is a little less brave for the rest of his life.
    if (CBZ.cityRelShift) CBZ.cityRelShift(p, "carjacked", isDriver ? 1 : 0.6);
    if (CBZ.cityTraitShift) {
      CBZ.cityTraitShift(p, "nerve", kind === "fight" ? 0 : -0.06);
      CBZ.cityTraitShift(p, "snitch", +0.05);
    }
  }

  /* ---- THE JACK ---------------------------------------------------------- */
  function occJack(c, by) {
    if (!c) return 0;
    // A PARKED CAR HAS NOBODY IN IT. The seat record is decided at build time
    // for every car (it is a fact about the vehicle, not about this frame);
    // `occWanted` is the one query for whether that crew is aboard RIGHT NOW,
    // and it is the same query the glass reads, so the two cannot disagree.
    if (!occWanted(c) && !c.npcDriver) return 0;
    if (!occOn() || !c.occ || CBZ.CONFIG.JACK_REACTIONS === false) {
      if (c.npcDriver) legacyEject(c);
      return 0;
    }
    // WHAT YOU SAW IS WHAT GETS OUT. Force every decided seat to a real body
    // before anybody reacts — a blob cannot draw a gun or remember you.
    occPromote(c, true);
    const seats = c.occ.seats;
    let n = 0, driverKind = null;
    // the driver answers first; his crew read his answer before they choose.
    for (let i = 0; i < seats.length; i++) {
      if (seats[i].slot !== "driver" || !seats[i].ped) continue;
      driverKind = occReact(c, seats[i], by, null);
      occApply(c, seats[i], driverKind, by); n++;
    }
    for (let i = 0; i < seats.length; i++) {
      const st = seats[i];
      if (st.slot === "driver" || !st.ped) continue;
      const k = occReact(c, st, by, driverKind);
      occApply(c, st, k, by); n++;
    }
    // a driver nobody decided for (a carjacker's own body, a scripted rider)
    if (c.npcDriver) legacyEject(c);
    if (n) {
      c.occ.jacked = true; occStat.jacks++;
      c._occJackX = c.pos.x; c._occJackZ = c.pos.z;
      // TAKING AN OCCUPIED CAR IS A DIFFERENT CRIME THAN BOOSTING AN EMPTY ONE,
      // and it happens in front of the people who were in it. cityCrime tags
      // the witnesses itself — we never re-derive a witness list.
      if (CBZ.cityCrime) CBZ.cityCrime(45, { x: c.pos.x, z: c.pos.z, type: "carjacking" });
    }
    return n;
  }

  // the ORIGINAL five lines, kept for a driver that never went through the
  // occupancy record (a carjacker's own body, a gig driver, a scripted rider)
  // — but with the door solved instead of a blind +1.6 on X.
  function legacyEject(car) {
    const ped = car.npcDriver; if (!ped) return;
    car.npcDriver = null; car._occOwnsDriver = false;
    if (ped._njCarjack) { ped._njCarjack = false; npcDrivers = Math.max(0, npcDrivers - 1); }
    ped.inCar = null; ped.controlled = false;
    const spot = occDoorSpot(car, -1, 0);
    const gy = CBZ.floorAt ? CBZ.floorAt(spot.x, spot.z) : 0;
    if (ped._npcAttached && CBZ.cityUnseat) {
      try { CBZ.cityUnseat(ped, { x: spot.x, z: spot.z, y: gy, state: ped.dead ? "dead" : "walk" }); } catch (e) {}
    } else {
      if (ped.group) ped.group.visible = !ped._spawnHidden;
      ped.pos.set(spot.x, gy, spot.z);
      if (ped.target && ped.target.copy) ped.target.copy(ped.pos);
    }
    if (!ped.dead) ped.pause = Math.max(ped.pause || 0, 0.4);
  }
  function ejectNpcDriver(car) {
    // a seated occupant leaves through the seat record so the fact stays true
    if (car.occ && car._occOwnsDriver && car.npcDriver) {
      const seats = car.occ.seats;
      for (let i = 0; i < seats.length; i++) {
        if (seats[i].ped === car.npcDriver) { occStepOut(car, seats[i], {}); return; }
      }
    }
    legacyEject(car);
  }

  /* ---- HOSTAGES, AND LETTING PEOPLE GO ------------------------------------
     A passenger who froze is not scenery. Drive off with him aboard and it is
     a kidnapping — filed through social.js's OWN hostage entry point, which
     sets `ped.hostage`, claims `g.cityHostage` and reports the crime, so every
     system that already reads those fields (restrain.js, police.js, vips.js,
     tells.js, the ransom flow) picks this up with no code here. */
  function occHostageTick(c, dt) {
    const seats = c.occ.seats;
    const jx = c._occJackX == null ? c.pos.x : c._occJackX;
    const jz = c._occJackZ == null ? c.pos.z : c._occJackZ;
    for (let i = 0; i < seats.length; i++) {
      const st = seats[i], p = st.ped;
      if (!p || !st.frozen) continue;
      if (p.dead) { st.frozen = false; continue; }
      if (!c.player) {
        // YOU LEFT HIM THERE. Terror does not hold forever — he comes out of
        // it, gets out, and remembers being let go.
        st.frozenT = (st.frozenT || 0) + dt;
        if (st.frozenT > 6 && !p.hostage) {
          occStepOut(c, st, { state: "flee", keepTarget: true });
          p.fear = Math.max(p.fear || 0, 8);
          if (CBZ.cityRelShift) CBZ.cityRelShift(p, "spared", 0.7);
          if (CBZ.cityPanicRaise) CBZ.cityPanicRaise(p.pos.x, p.pos.z, 0.8);
        }
        continue;
      }
      st.frozenT = 0;
      if (p.hostage) continue;
      const dx = c.pos.x - jx, dz = c.pos.z - jz;
      if (dx * dx + dz * dz < 26 * 26) continue;                // still on the same corner
      if (CBZ.cityTakeHostage) { try { CBZ.cityTakeHostage(p); } catch (e) {} }
      p.hostage = true; p.controlled = true; p.inCar = c;
      st.hostage = true; occStat.hostages++;
      if (CBZ.cityRelShift) CBZ.cityRelShift(p, "passengerTaken", 1);
      if (CBZ.cityTraitShift) CBZ.cityTraitShift(p, "nerve", -0.12);
      if (CBZ.city && CBZ.city.note) CBZ.city.note("There's still somebody in the back.", 2.2);
    }
  }
  // LET THEM OUT. The counterpart verb — interact.js surfaces it on your own
  // car whenever somebody is still riding in it who did not choose to be.
  CBZ.carOccupancyRelease = function (c) {
    if (!c || !c.occ) return 0;
    let n = 0;
    for (let i = 0; i < c.occ.seats.length; i++) {
      const st = c.occ.seats[i], p = st.ped;
      if (!p || !(st.frozen || st.hostage)) continue;
      const wasHostage = !!p.hostage;
      occStepOut(c, st, { state: "flee", keepTarget: false });
      p.hostage = false; p.surrender = false; p.surrenderT = 0;
      if (p.char) p.char.handsUp = false;
      p.fear = Math.max(p.fear || 0, 7);
      if (wasHostage && CBZ.cityReleaseHostage) { try { CBZ.cityReleaseHostage(false); } catch (e) {} }
      if (CBZ.cityRelShift) CBZ.cityRelShift(p, "spared", 1);
      if (CBZ.cityTraitShift) CBZ.cityTraitShift(p, "snitch", -0.04);
      n++;
    }
    return n;
  };
  CBZ.carOccupancyHeld = function (c) {
    if (!c || !c.occ) return null;
    for (let i = 0; i < c.occ.seats.length; i++) {
      const st = c.occ.seats[i];
      if (st.ped && (st.frozen || st.hostage)) return st.ped;
    }
    return null;
  };

  /* ---- THE PUBLIC SEAT API (gangs.js rides on this) ---------------------- */
  // is anybody actually in this car right now?
  CBZ.carOccupied = function (c) {
    if (!c) return false;
    if (c.npcDriver) return true;
    if (!c.occ || !occWanted(c)) return false;
    for (let i = 0; i < c.occ.seats.length; i++) if (!c.occ.seats[i].gone) return true;
    return false;
  };
  CBZ.carOccupantCount = function (c) {
    if (!c || !c.occ || !occWanted(c)) return c && c.npcDriver ? 1 : 0;
    let n = 0;
    for (let i = 0; i < c.occ.seats.length; i++) if (!c.occ.seats[i].gone) n++;
    return n;
  };
  // EMPTY THIS CAR OUT (gangs.js taking one over): every blob unparented,
  // every promoted rig handed back. The geometry is a shared per-variant cache
  // — unparent it, never dispose it.
  CBZ.carOccupancyClear = function (c) {
    if (!c) return;
    if (c.occ) {
      for (let i = 0; i < c.occ.seats.length; i++) {
        const st = c.occ.seats[i];
        if (st.ped) {
          const p = st.ped;
          try {
            if (st.spawned && CBZ.npcLife && CBZ.npcLife.destroyCity) CBZ.npcLife.destroyCity(p);
            else if (CBZ.npcLife && CBZ.npcLife.release) CBZ.npcLife.release(p, { state: "walk" });
          } catch (e) {}
          p.inCar = null; p.controlled = false; p._occCar = null; p._occSeat = null;
          st.ped = null;
        }
        if (st.blob && st.blob.parent) st.blob.parent.remove(st.blob);
        st.blob = null; st.gone = true;
      }
      c.occ.seats.length = 0; c.occ.rigs = 0;
    }
    if (c._occRigged) { c._occRigged = false; occRigCars = Math.max(0, occRigCars - 1); }
    const keys = ["_occDriver", "_occPass"];
    for (let i = 0; i < keys.length; i++) {
      const m = c[keys[i]];
      if (m && m.parent) m.parent.remove(m);
      c[keys[i]] = null;
    }
    if (c.npcDriver && c._occOwnsDriver) { c.npcDriver = null; c._occOwnsDriver = false; }
  };
  // seat a body the CALLER owns (a gang crew) into a named slot, so a drive-by
  // car answers "who is in it" through the same record every other car uses.
  CBZ.carOccupancySeat = function (c, slotName, ped, opts) {
    if (!c || !ped) return false;
    if (!c.occ) c.occ = { hx: c.pos.x, hz: c.pos.z, hour: occHour(), district: "core", seats: [], rigs: 0, jacked: false };
    if (!c._occFrame) return false;                    // no cabin (bike/boat) — caller keeps its own
    const S = OCC_SLOTS.filter(function (s) { return s.slot === slotName; })[0] || OCC_SLOTS[0];
    let st = null;
    for (let i = 0; i < c.occ.seats.length; i++) if (c.occ.seats[i].slot === S.slot) st = c.occ.seats[i];
    if (!st) {
      st = { slot: S.slot, side: S.side, row: S.row, h: 0, variant: 0, blob: null, ped: null,
        spawned: false, react: null, armed: !!(opts && opts.armed) };
      c.occ.seats.push(st);
    }
    st.gone = false; st.armed = opts && opts.armed != null ? !!opts.armed : st.armed;
    if (st.blob && st.blob.parent) { st.blob.parent.remove(st.blob); st.blob = null; }
    return occSeatPed(c, st, ped, opts);
  };
  CBZ.carOccupancySeatAnchor = function (c, slotName) {
    if (!c || !c._occFrame) return null;
    const S = OCC_SLOTS.filter(function (s) { return s.slot === slotName; })[0] || OCC_SLOTS[0];
    return occAnchorFor(c, { slot: S.slot, side: S.side, row: S.row });
  };
  // THE CAR MOVED HOUSE. traffic.js teleports a far idle car onto a fresh road;
  // it is a different car in a different place now, so its crew is re-decided
  // from the NEW point rather than riding along as a stale fact.
  CBZ.carOccupancyReseat = function (c) {
    if (!c || !occOn() || !c.occ || !c._occFrame) return false;
    if (c._occRigged || c.occ.jacked) return false;    // real bodies aboard: never
    CBZ.carOccupancyClear(c);
    addOccupants(c);
    return true;
  };
  CBZ.carOccupancyJack = occJack;

  // ---- visible crash damage: permanently squash/cave the car mesh. Severity
  //      accumulates, so a worse hit (or a second one) deforms it further. Only
  //      group SCALE + child rotations are touched (the AI rewrites group
  //      position/heading.y every frame but never these), so the wreck persists. ----
  function crumpleCar(car, sev, impact) {
    car.crumple = Math.min(1, (car.crumple || 0) + sev);
    if (car._cside == null) car._cside = rng() < 0.5 ? -1 : 1;
    addCornerDamage(car, sev, impact);   // localized handling: mirrors crashdeform's per-corner split
    const c = car.crumple, grp = car.group, ud = grp.userData;
    // unified visuals now carry REAL panel craters (crashdeform.js), so the
    // whole-body squash drops to a hint — the old full squash stacked on the
    // vertex damage read as a melting toy. Box rigs keep the legacy read.
    if (CBZ.cityCarImpact && ud && ud.carVisual) grp.scale.set(1 - c * 0.05, 1 - c * 0.1, 1 - c * 0.04);
    else grp.scale.set(1 - c * 0.14, 1 - c * 0.32, 1 - c * 0.12);
    const base = ud && ud.crashBase ? ud.crashBase : { bodyY: 0.78, bodyZ: 0, cabinY: 1.45, cabinZ: 0 };
    let front = 0, rear = 0, side = 0;
    if (impact) {
      const fx = Math.sin(car.heading || 0), fz = Math.cos(car.heading || 0);
      const sx = Math.cos(car.heading || 0), sz = -Math.sin(car.heading || 0);
      const f = impact.x * fx + impact.z * fz, s = impact.x * sx + impact.z * sz;
      if (Math.abs(f) >= Math.abs(s)) { if (f > 0) front = c; else rear = c; }
      else side = c * Math.sign(s || car._cside);
    } else side = c * car._cside;
    // Deformation stays CLAMPED to panel contact (USER-FILMED BUG: the old
    // bigger offsets tore the deformable hull/cabin away from the merged
    // STATIC panels — grille/bumpers/glass floated free with see-through
    // holes between them). These maxima keep every neighbour overlapping the
    // hull at full crumple, so a wreck reads caved-in, never hollowed-out.
    if (ud && ud.body) {
      ud.body.rotation.z = (side || c * car._cside) * 0.18;
      ud.body.position.y = base.bodyY - c * 0.14;
      ud.body.position.z = base.bodyZ + (rear - front) * 0.08;
      ud.body.scale.x = 1 - Math.abs(side) * 0.1;
      ud.body.scale.z = 1 - (front + rear) * 0.12;
    }
    if (ud && ud.cabin) {
      ud.cabin.rotation.x = -front * 0.22 + rear * 0.12;
      ud.cabin.rotation.z = (side || c * car._cside) * 0.12;
      ud.cabin.position.y = base.cabinY - c * 0.26;
      ud.cabin.position.z = base.cabinZ + (rear - front) * 0.08;
    }
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

  /* ============================================================
     CARS BLOW UP REALISTICALLY  (CBZ.CONFIG.CAR_COOKOFF_V2, default ON)

     OWNER: "make cars blow up realistically."

     What was wrong was not the fireball, it was the SEQUENCE, and it was four
     separate faults that all pulled the same way — toward "a car is a health
     bar that deletes itself":

       (1) `damageEngine(car, amount, fromGun)` took a BOOLEAN, and
           CBZ.cityDamageCar hardcoded `true` into it. So every source that was
           not a crash — a rifle round, an RPG, a nuke's shock front, a molotov
           — arrived as "gunfire", and gunfire's rule was `engineHp <= 0 =>
           explodeCar(car)` IN THE SAME FRAME. The crash path, meanwhile, ran a
           genuinely good arc (dented -> smoking -> a rolled chance of fire -> a
           long fuse -> half of them merely burn out). One of the two paths was
           realistic and the other was a switch, and the realistic one was
           unreachable from anything that shoots.
       (2) Because the pop was same-frame, a blast could never CASCADE: the
           first car to reach 0 HP deleted itself instantly, and its own
           detonation therefore happened inside the frame that killed it. A
           parking lot could not roll.
       (3) explodeCar disposed the mesh on the spot. Aircraft leave hulks; cars
           left nothing — the most destructive thing you can do to a street
           erased its own evidence.
       (4) Nobody ever got out. bailout.js is aircraft-only, and a burning car
           held its driver until it detonated with them in it.

     The flag changes the SOURCE OF TRUTH, not the numbers: `damageEngine`'s
     third argument becomes a MODE, and cityDamageCar passes the truth it was
     already being handed in `opts`. Each mode gets the arc its physics
     deserves, and every one of them ends in a FUSE — a readable beat between
     the hit and the fireball — because that beat is the whole difference
     between an explosion and a deletion:

       "gun"     a round finds the fuel line: instant FIRE, 2-5 s cook-off
                 (igniteCar's own weapon-fire fuse, untouched)
       "blast"   overpressure: ignition + a 0.4-1.6 s PER-CAR JITTERED fuse.
                 The jitter is the point — identical fuses would make a car
                 park detonate as one chord instead of a roll.
       "direct"  a heavy warhead's impact point ON the hull: a 0.2-0.4 s
                 fuel-flash. Effectively instant, but never same-frame, so the
                 eye always gets the flash before the fireball.
       "fire"    an already-burning car finishing itself.
       false     a CRASH. Byte-identical to before; this path was already right.

     Flag OFF => `damageEngine(car, amount, true)` exactly as before, no husk,
     no bail-out. One line back.
     ============================================================ */
  if (CBZ.CONFIG && CBZ.CONFIG.CAR_COOKOFF_V2 == null) CBZ.CONFIG.CAR_COOKOFF_V2 = true;
  function COOKOFF() { return !CBZ.CONFIG || CBZ.CONFIG.CAR_COOKOFF_V2 !== false; }

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
      type, maxOp: type === "tire" ? 0.4 : (fire ? 0.95 : 0.42),
    });
  }
  function emitTireSmoke(car, side) {
    const a = car.heading, hx = Math.sin(a), hz = Math.cos(a), sx = Math.cos(a), sz = -Math.sin(a);
    if (side == null) side = Math.random() < 0.5 ? 1 : -1;   // a slide boils BOTH rears (caller passes ±1)
    spawnVPart(car.pos.x - hx * 1.3 + sx * side * 0.95, 0.3, car.pos.z - hz * 1.3 + sz * side * 0.95, "tire");
  }

  // ---- SKID MARKS — rubber the PLAYER's rear wheels leave under slides,
  //      handbrake lock-ups and burnouts. WHY: marks are the receipt a
  //      power-slide writes on the asphalt — you look back after the corner
  //      and SEE you drove it sideways (and a burnout outside the club is
  //      showing off in rubber). COST: every segment lives in ONE
  //      pre-allocated mesh with ONE shared material (a single draw call,
  //      ever) — a ring buffer of 80 quads, oldest silently overwritten;
  //      laying a strip is an 18-float write, zero allocation. Quads sit at
  //      y≈0.08, ABOVE the road paint stack (asphalt 0.04 → crosswalks
  //      0.072) because real rubber covers lane lines. AI cars never lay. ----
  const SKID_MAX = 80, SKID_W = 0.3;
  let skidMesh = null, skidPosArr = null, skidRing = 0, skidDead = false;
  function ensureSkidMesh() {
    if (skidMesh || skidDead) return;
    try {
      skidPosArr = new Float32Array(SKID_MAX * 18);          // 2 tris × 3 verts × xyz per segment
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(skidPosArr, 3));
      geo.computeBoundingSphere();
      const m = new THREE.MeshBasicMaterial({ color: 0x0c0d10, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide });
      m._shared = true;
      skidMesh = new THREE.Mesh(geo, m);
      skidMesh.frustumCulled = false;                        // verts span blocks; 1 call is cheaper than reculling
      skidMesh.matrixAutoUpdate = false;
      skidMesh.renderOrder = 2;
      CBZ.scene.add(skidMesh);
    } catch (e) { skidDead = true; }                          // stub renderer (headless) — marks just skip
  }
  function laySkidSegment(x0, z0, x1, z1) {
    ensureSkidMesh();
    if (!skidMesh) return;
    const dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz);
    if (len < 0.05) return;
    const px = (-dz / len) * SKID_W * 0.5, pz = (dx / len) * SKID_W * 0.5;
    const y = 0.078 + (skidRing % 5) * 0.0012;               // micro-stagger: crossing marks never z-fight
    const o = skidRing * 18; skidRing = (skidRing + 1) % SKID_MAX;
    const p = skidPosArr;
    p[o] = x0 + px; p[o + 1] = y; p[o + 2] = z0 + pz;
    p[o + 3] = x0 - px; p[o + 4] = y; p[o + 5] = z0 - pz;
    p[o + 6] = x1 - px; p[o + 7] = y; p[o + 8] = z1 - pz;
    p[o + 9] = x0 + px; p[o + 10] = y; p[o + 11] = z0 + pz;
    p[o + 12] = x1 - px; p[o + 13] = y; p[o + 14] = z1 - pz;
    p[o + 15] = x1 + px; p[o + 16] = y; p[o + 17] = z1 + pz;
    skidMesh.geometry.attributes.position.needsUpdate = true;
  }
  // lay strips under both rear wheels while the tyres are working hard. Anchors
  // per-wheel previous positions on the car; a gap (respawn/teleport/slide end)
  // re-anchors instead of drawing one long false stripe across the city.
  function laySkids(car, amt, fwdX, fwdZ) {
    if (amt <= 0.25 || Math.abs(car.v) < 3) { if (car._skid) car._skid.on = false; return; }
    const cm = CBZ.camera.position;
    const ddx = car.pos.x - cm.x, ddz = car.pos.z - cm.z;
    if (ddx * ddx + ddz * ddz > 60 * 60) { if (car._skid) car._skid.on = false; return; }   // beyond 60u nobody reads rubber
    const d = vehicleDims(car);
    const rb = (d.wheelbase || 2.7) * 0.45;                  // rear axle behind centre
    const two = car._playerCarFeel && car._playerCarFeel.twoWheel;
    const tw = two ? 0 : (d.width || 2) * 0.4;               // a bike lays ONE centre stripe
    const lx = car.pos.x - fwdX * rb + fwdZ * tw, lz = car.pos.z - fwdZ * rb - fwdX * tw;
    const rx = car.pos.x - fwdX * rb - fwdZ * tw, rz = car.pos.z - fwdZ * rb + fwdX * tw;
    const S = car._skid || (car._skid = { lx: 0, lz: 0, rx: 0, rz: 0, on: false });
    const moved = Math.hypot(lx - S.lx, lz - S.lz);
    if (!S.on || moved > 3.5) S.on = true;                   // (re)anchor this frame, draw from the next
    else if (moved > 0.55) {
      laySkidSegment(S.lx, S.lz, lx, lz);
      if (!two) laySkidSegment(S.rx, S.rz, rx, rz);
    } else return;                                           // not far enough yet — keep the anchor
    S.lx = lx; S.lz = lz; S.rx = rx; S.rz = rz;
  }
  // per-frame: float + fade every live car particle. Cheap; runs only when any exist.
  CBZ.onAlways(9.6, function (dt) {
    if (skidMesh && skidMesh.visible !== (g.mode === "city")) skidMesh.visible = g.mode === "city";   // rubber is city asphalt only
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
      } else if (p.type === "tire") col.setRGB(0.82, 0.82, 0.84);   // burnout smoke is WHITE — vaporized rubber, not engine oil
      else col.setRGB(0.17, 0.21, 0.2);  // grey-ish engine smoke
    }
  });

  // apply mechanical damage to a car's engine. fromGun/explosion may ignite or
  // pop it instantly at high amounts. CRASHES (fromGun=false) NEVER instant-pop:
  // reaching 0 HP from an impact leaves a DISABLED, SMOKING wreck — a fire (and
  // then an explosion) only develops over time via the burn fuse, mirroring the
  // real world where post-crash fires are rare (~0.2% of all crashes) and build
  // over minutes rather than detonating on contact (a fuel-tank fireball is a
  // Hollywood myth). Gunfire/explosive damage keeps the old instant-pop so those
  // weapons still cook a car off as before.
  // `mode`: false = a CRASH (unchanged, and the one path that was always
  // right); true = the legacy "gunfire" boolean; or one of the CAR_COOKOFF_V2
  // strings "gun" / "blast" / "direct" / "fire" (see the block above SMOKE_AT).
  function damageEngine(car, amount, mode) {
    if (!car || car.dead) return;
    if (car.engineHp == null) car.engineHp = 100;
    const fromGun = !!mode;                       // anything that is not a crash
    if (!fromGun && car._raceCar) amount *= CRASH.raceCrashDamageMul;
    const armor = Math.max(0, Math.min(0.35, car.armor || 0));
    amount *= Math.max(0.55, 1 - armor * (fromGun ? 1.25 : 0.85));
    car.engineHp = Math.max(-50, car.engineHp - amount);
    if (car.engineHp <= 0 && !car._exploded) {
      if (fromGun) {
        // THE ENGINE IS GONE. What happens next is the mode's business, and it
        // is never the same frame unless the flag is off.
        //   `fuseOnly` matters: the cook-off gate in tickDamageStage explodes a
        //   weapon fire the moment `engineHp <= 0` OR the fuse runs out, and
        //   engineHp is ALREADY <= 0 here — so without it the "fuse" would
        //   expire on the very next tick and we would be back to the pop.
        if (!COOKOFF()) { explodeCar(car); return; }        // legacy: weapon hits pop instantly
        if (mode === "direct") igniteCar(car, false, { fuse: 0.2 + Math.random() * 0.2, fuseOnly: true, burnsOut: false, quiet: true });
        else if (mode === "blast") igniteCar(car, false, { fuse: 0.4 + Math.random() * 1.2, fuseOnly: true, burnsOut: false, quiet: true });
        else igniteCar(car, false, { fuseOnly: true });     // "gun"/"fire": the existing 2.4-4.6 s cook-off
        return;
      }
      // a crash that guts the motor DISABLES it (smoking wreck). A fire only
      // sometimes develops — post-crash fires are rare (~0.2% of crashes) — and
      // when it does it cooks off slowly, never an instant bump-to-fireball.
      car._smoking = true;
      maybeCrashFire(car, true);
      return;
    }
    if (fromGun) {
      // Survived, but hurt past the fire line. A DIRECT heavy hit or a blast
      // that leaves the motor running still lights it (the fuel line is the
      // fuel line); the fuse is the ordinary weapon-fire one, so there is time
      // to run or to shoot it again.
      if (car.engineHp <= FIRE_AT && !car._onFire) igniteCar(car, false);
    } else if (car.engineHp <= FIRE_AT) maybeCrashFire(car, false);   // badly-crashed: a CHANCE to ignite
    if (car.engineHp <= SMOKE_AT) car._smoking = true;
  }
  // CRASH-INDUCED FIRE — rare and slow, per real-world data (vehicle fires occur
  // in only ~0.2% of all crashes / ~2.9% of fatal ones, and post-crash fires
  // build over minutes, they do NOT instant-detonate). A badly-wrecked car only
  // SOMETIMES catches fire; disabled = the common outcome. `gutted` (engine fully
  // dead) carries a higher chance than merely fire-threshold damage.
  function maybeCrashFire(car, gutted) {
    car._smoking = true;                          // a hurt-enough motor always wisps
    if (car._onFire || car.dead || car._exploded || car._crashFireRolled) return;
    car._crashFireRolled = true;                  // roll once per wreck (re-bumps don't re-roll)
    const chance = gutted ? 0.18 : 0.06;          // most wrecks just smoke + die
    if (Math.random() < chance) igniteCar(car, true);
  }
  // crashFire = a slow post-crash burn (long cook-off); otherwise a weapon/molotov
  // fire that cooks off in a few seconds as before.
  // opts (all optional, all CAR_COOKOFF_V2 era — a 2-argument call is
  // byte-identical to before):
  //   fuse      explicit seconds to cook-off (a blast's 0.4-1.6, a direct
  //             heavy hit's 0.2-0.4) instead of the class default
  //   fuseOnly  the engine is ALREADY gone; only the fuse may fire it. Without
  //             this the `engineHp <= 0` half of the cook-off gate detonates on
  //             the next tick and the fuse is decorative.
  //   burnsOut  force / forbid the burn-out-instead-of-detonate outcome
  //   quiet     skip the bail-out prompt (a 0.3 s fuel flash is not advice)
  function igniteCar(car, crashFire, opts) {
    if (car.dead || car._exploded) return;
    opts = opts || {};
    // ALREADY BURNING. A second, HARDER hit on a car that is already alight
    // must be able to shorten its fuse — otherwise the blast that lights a car
    // at 1.4 s makes the direct rocket that follows meaningless, and "I shot
    // it again and nothing happened" is exactly the readability failure this
    // whole arc exists to fix. Only ever shortens; never relights, never
    // extends, never re-runs the bail-out.
    if (car._onFire) {
      if (opts.fuse != null && opts.fuse < car._fuse) {
        car._fuse = opts.fuse;
        if (opts.fuseOnly) car._fuseOnly = true;
        if (opts.burnsOut === false) car._burnsOut = false;
      }
      return;
    }
    car._onFire = true; car._smoking = true;
    car._crashFire = !!crashFire;
    // a FUSE: a weapon fire cooks off in a few seconds; a CRASH fire builds slowly
    // (real post-crash fires take minutes), giving plenty of time to bail. About
    // half of crash fires simply BURN OUT into a charred wreck instead of ever
    // exploding (a fuel-tank fireball is the exception, not the rule).
    car._fuse = opts.fuse != null ? opts.fuse : (crashFire ? (14 + Math.random() * 12) : (2.4 + Math.random() * 2.2));
    car._fuseOnly = !!opts.fuseOnly;
    car._burnsOut = opts.burnsOut != null ? !!opts.burnsOut
      : (crashFire && Math.random() < 0.5);            // crash fire that never detonates
    // NOBODY EVER GOT OUT. A burning car held its NPC driver until it
    // detonated with them inside — the one place in this game where a person
    // sat still for a fire. They bail through the existing eject and then run
    // through the ONE panic decision (peds.js's cityScare), so the flight is
    // the same contagious wave a gun in the street produces, not a bespoke
    // "run from car" brain. Only for a fuse long enough to actually beat: a
    // 0.3 s fuel flash kills whoever is in the seat, which is correct.
    if (COOKOFF() && car.npcDriver && !car.npcDriver.dead && car._fuse > 1.2) {
      const ped = car.npcDriver;
      ejectNpcDriver(car);
      car.abandoned = true; car.npcWanted = 0; car.stolen = false;
      car.roadRageTarget = null; car.roadRageT = 0; car.pullover = 0;
      car.wreckT = Math.max(car.wreckT || 0, 0.8);
      if (CBZ.cityScare) { try { CBZ.cityScare(ped, { pos: car.pos }, { bias: 0.9, seat: true }); } catch (e) {} }
    }
    // A BURNING CAR IS A THING PEOPLE BACK AWAY FROM. peds.js's decaying
    // spatial panic field is what every cityScare decision already reads, so
    // one call makes the whole pavement nervous and the next person to be
    // scared here bolts sooner — the same contagion a gunshot produces. No
    // second "run from fire" brain, and no cost when nobody is nearby.
    if (COOKOFF() && CBZ.cityPanicRaise) { try { CBZ.cityPanicRaise(car.pos.x, car.pos.z, 0.8); } catch (e) {} }
    if (!opts.quiet && CBZ.city && (car.player || nearCam(car, 60))) CBZ.city.note("The car's on fire, bail out!", 1.1);
  }
  /* THE FUEL LOAD IS THE PAYLOAD. A cook-off is a chemical event whose size is
     set by how much fuel the vehicle carries, and fuel capacity tracks vehicle
     size — which `car.mass` (vehicleProfile's body factor, 0.9 coupe .. 1.5
     van, sedan 1.05) already is. Feeding that to the "carcook" row's declared
     refE lets THE KINETIC LAW do the proportioning: cube root for the
     fireball, 2/3 power for the damage. A saloon prices at exactly 1.0, i.e.
     the numbers explodeCar has always used; a box van makes a 13% wider
     fireball and hits 27% harder. Nothing here picks a number per body type. */
  const CARCOOK_REF_E = 8.4e6;          // = the "carcook" row's refE; a saloon's tank
  function cookEnergy(car) {
    const m = car && car.mass > 0 ? car.mass : 1.05;
    return CARCOOK_REF_E * (m / 1.05);
  }

  function explodeCar(car) {
    if (car._exploded) return;
    car._exploded = true; car.dead = true; car._onFire = false; car._smoking = false;
    const x = car.pos.x, z = car.pos.z;
    if (car.npcDriver) killNpcDriverInCar(car);
    const byPlayer = !!(car._burnByPlayer || car.player);
    // ONE ORDNANCE VERB. The row carries what the inline call never could: a
    // structural coupling, a real fire term, the ordnance identity every
    // downstream wrapper reads — and, through `energy`, the vehicle's own size.
    //   `y`: cityExplosion treats a seat above 3 m as an AIRBURST and cancels
    //   its ground rings AND most of its damage footprint. A car parked on a
    //   hill is not an airburst. The old call passed no y at all (so the
    //   fireball always bloomed at y=1 regardless of terrain); we seat it on
    //   the car but CLAMP strictly under that threshold, which is honest on
    //   the flat, better on a slope, and cannot trip the airburst branch.
    const gy = car.group ? car.group.position.y : 0;
    const seatY = CBZ.blastSeatY ? Math.max(CBZ.blastSeatY(x, z), Math.min(2.9, (gy > 0 ? gy : 0) + 1.0))
                                 : Math.min(2.9, (gy > 0 ? gy : 0) + 1.0);
    if (CBZ.detonate && CBZ.CONFIG.ORDNANCE_BUS_ALL !== false) {
      CBZ.detonate(x, seatY, z, "carcook", { byPlayer: byPlayer, energy: cookEnergy(car) });
    } else if (CBZ.cityExplosion) {
      CBZ.cityExplosion(x, z, { power: 1.15, radius: 6.5, byPlayer: byPlayer });
    }
    // B7: a wreck the PLAYER caused leaves scrap behind (systems/resources.js's
    // Scrap item) — a real reason to blow cars up beyond the spectacle.
    if (byPlayer && CBZ.cityEcon && CBZ.cityEcon.add) CBZ.cityEcon.add("Scrap", 2 + ((Math.random() * 5) | 0));
    // if the PLAYER was still inside, the blast handles their damage; eject them
    if (car.player && CBZ.player.driving) { CBZ.cityExitVehicle(); }
    // THE HUSK. Aircraft leave hulks and cars left NOTHING — the most
    // destructive thing you can do to a street erased its own evidence one
    // frame later. makeHusk keeps the wreck standing (charred, crazed,
    // buckled, hood gone, collider intact) and hands it to the SAME `_reap`
    // flag the reaper below has always consumed, just minutes later and only
    // once nobody is looking. Flag off / husk refused => the original teardown,
    // unchanged.
    if (!(COOKOFF() && makeHusk(car))) disposeCar(car);
  }
  function disposeCar(car) {
    // remove the wreck mesh now; DEFER the array splice to the reaper so we never
    // mutate cityCars mid-iteration (explodeCar fires from inside the AI loop).
    if (car.group && car.group.parent) car.group.parent.remove(car.group);
    if (car.group) car.group.traverse(function (o) {
      if (o.geometry && !o.geometry._shared && o.geometry.dispose) o.geometry.dispose();
      if (o.material && !o.material._shared && o.material.dispose) o.material.dispose();
    });
    car._reap = true;
  }

  /* ============================================================
     THE BURNT-OUT HULK.

     Everything a wreck should look like was ALREADY written, in
     city/crashdeform.js, and explodeCar threw the car away before any of it
     could be read: the vertex craters, the sprung hood, the hanging door, the
     splayed wheel, the crazed glass, the bent chassis. `cityCarBurnOut` (this
     wave's one addition to that file) fires the lot from a single call and
     chars the paint on top. This function authors NO geometry and NO material
     of its own — it seats the wreck on the ground, asks crashdeform for the
     look, and turns the record into scenery.

     BUDGET: hard cap on live husks (oldest goes first, and it goes by the
     ordinary disposal path), plus a lifetime, plus a "not while you are
     watching" gate on the despawn. The cap is also what protects the ambient
     TRAFFIC POOL — traffic.js recycles far cars to keep the streets busy, and
     a husk is a car it can never recycle, so an uncapped graveyard would
     quietly empty the city.
     ============================================================ */
  const HUSK_MAX = 10;                       // live burnt-out wrecks
  const HUSK_LIFE = 165;                     // seconds before it is allowed to go
  const HUSK_HARD = 420;                     // ...and the age at which it goes regardless
  const husks = [];
  function makeHusk(car) {
    if (!car || !car.group || !car.group.parent) return false;
    if (car._husk) return true;
    // oldest first — reuses the ordinary teardown, so a retired husk is
    // disposed exactly the way an exploded car always was
    while (husks.length >= HUSK_MAX) {
      const old = husks.shift();
      if (old && !old._reap) disposeCar(old);
    }
    car._husk = true;
    car._huskT = 0;
    car.ai = false; car.abandoned = true; car.stolen = false; car.owned = false;
    car.v = 0; car.vx = 0; car.vz = 0; car.baseV = 0; car.spin = 0; car.wreckT = 0;
    car.npcWanted = 0; car.roadRageTarget = null; car.roadRageT = 0; car.pullover = 0;
    car._smoking = true;                     // a fresh hulk keeps seeping for a while
    car._flats = 15;                         // all four tyres are gone (bitmask: FL|FR|RL|RR)
    // A DEAD WEIGHT. resolveCars splits depenetration by mass, so a burnt
    // shell with 12x its own mass is shunted a few centimetres by a car that
    // rams it instead of skating down the street — no special case needed in
    // the contact solver, which is the whole reason this is one field and not
    // a branch. Nothing else reads mass on a car that never drives again.
    car.mass = Math.max(0.6, car.mass || 1.05) * 12;
    try { applyFlatVisual(car); } catch (e) {}     // rims on the road, no rubber left
    // Seat it on the real ground FIRST: seatCar writes group.rotation
    // wholesale, and on a rig whose carVisual IS the group
    // (cityRegisterVehicle's shape) doing it afterwards would erase the buckle.
    car._parkX = car._parkZ = car._parkH = null;
    // The traffic loop's distance cull only ever writes `visible` for a LIVE
    // ai/road car, so a wreck made from a far-off car would inherit
    // `visible=false` and be an invisible obstacle forever. A husk draws like
    // a parked car does — always.
    if (car.group) car.group.visible = true;
    try { seatCar(car, 0, 0, true); } catch (e) {}
    // crashdeform.js owns every part of the LOOK and already knew how to draw
    // all of it — craters, crazed glass, dead lamps, the hood gone, a splayed
    // corner, the buckled frame. This authors none of it.
    if (CBZ.cityCarBurnOut) { try { CBZ.cityCarBurnOut(car); } catch (e) {} }
    husks.push(car);
    return true;
  }
  // Ticked from the SAME order-38 pass that already owns the reaper, so this
  // adds no updater. A husk only leaves when it is old, out of sight and far
  // enough away that its disappearance cannot be witnessed — with a hard
  // ceiling so a wreck parked in the player's driveway still eventually goes.
  const HUSK_SMOULDER = 34;                  // seconds a fresh hulk keeps seeping
  function stepHusk(car, dt) {
    car._huskT = (car._huskT || 0) + dt;
    // A fresh wreck SMOULDERS. Same pooled sprite emitter tickDamageStage
    // uses for a hurt engine, just slower and off the roofline rather than the
    // bonnet — the bonnet is somewhere else now.
    if (car._huskT < HUSK_SMOULDER && (car.group && car.group.visible) && nearCam(car, 95)) {
      car._smkT = (car._smkT || 0) + dt;
      if (car._smkT > 0.34) {
        car._smkT = 0;
        spawnVPart(car.pos.x + (Math.random() - 0.5) * 1.6, 1.5,
                   car.pos.z + (Math.random() - 0.5) * 1.6, "smoke");
      }
    }
    if (car._huskT < HUSK_LIFE) return;
    // 160 u is deliberately PAST the 150 u group-visibility cull the traffic
    // loop applies, so a husk that retires here was provably not being drawn.
    // Cheaper and quieter than CBZ.npcTransitionSafe, which would also pump
    // the shared crowd-spawn guard counters that another audit is pinned on.
    if (car._huskT < HUSK_HARD && nearCam(car, 160)) return;
    const i = husks.indexOf(car);
    if (i >= 0) husks.splice(i, 1);
    disposeCar(car);
  }
  // CBZ.blastAudit() reads this — a husk count of zero after a car has been
  // blown up is the fastest proof the wreck is being deleted again.
  CBZ.cityCarHusks = function () {
    let n = 0;
    for (let i = 0; i < husks.length; i++) if (husks[i] && !husks[i]._reap) n++;
    return n;
  };
  // ordnance-bus adoption, declared at LOAD (CBZ.blastAudit()). An ARRAY
  // because this file loads before systems/impactbus.js does.
  (CBZ.ordnanceBusSites = CBZ.ordnanceBusSites || []).push("vehicles:carcook");
  // damage-stage tick for EVERY non-player car (smoke/fire/explode progresses
  // for ambient + abandoned wrecks too, independent of the AI lane logic), then
  // reap exploded wrecks — AFTER every per-car pass has finished this frame so we
  // never mutate cityCars mid-iteration.
  CBZ.onUpdate(38, function (dt) {
    if (g.mode !== "city") return;
    const cars = CBZ.cityCars;
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i];
      syncOccupants(c);                      // driver body appears/vanishes with control state
      // a passenger who froze in his seat: still there, still yours, and the
      // moment you actually drive off with him it stops being a jack.
      if (c.occ && c.occ.jacked) occHostageTick(c, dt);
      // A BURNT-OUT HULK still ages, on the reaper's own loop — no second
      // timer system. It is `dead`, so it falls out of every line below.
      if (c._husk) { if (!c._reap) stepHusk(c, dt); continue; }
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
      // burn keeps eating the engine so even a parked burning weapon-fire car
      // eventually blows. A crash fire's engine is already gutted, so its cook-off
      // is governed by the (long) fuse alone — not an instantly-zero engineHp.
      if (!car._crashFire) car.engineHp -= 7 * dt;
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
      // cook-off: weapon fires blow when the burn finishes the engine or the
      // fuse runs out; a crash fire only when its (long) fuse expires — and a
      // _burnsOut crash fire just dies down into a charred, smoking wreck.
      if (car._crashFire) {
        if (car._fuse <= 0) {
          if (car._burnsOut) { car._onFire = false; car._smoking = true; car._fuse = 0; return; }
          explodeCar(car); return;
        }
      // `_fuseOnly` (CAR_COOKOFF_V2): the motor is already at or below zero
      // because that is WHY this fire started, so the engineHp half of the
      // test would fire on the very next tick and there would be no fuse at
      // all. This is the line that turns "the car pops" into "the car catches,
      // and then the car goes".
      } else if (car._fuse <= 0 || (car.engineHp <= 0 && !car._fuseOnly)) { explodeCar(car); return; }
    }
  }

  // ============================================================
  //  TIRES ARE A TARGET — shoot a wheel and THAT tire blows, instead of the
  //  round quietly chipping generic engine HP (USER-FILMED: "shooting cars
  //  feels wrong"). WHY: aiming for rubber is the classic chase-ender — it
  //  must read corner-exact: the struck wheel deflates, the body settles
  //  toward it, a front flat drags the nose, a rear flat kills the launch,
  //  and all four leaves you grinding along on the rims.
  //  State: car._flats bitmask — 1=front-left  2=front-right
  //                              4=rear-left   8=rear-right
  //  (left = the car's local +x side; forward = local +z, like heading math)
  // ============================================================
  function tireAt(car, p) {
    if (!p || p.y == null || p.y > 1.1) return 0;          // wheels live below ~1.1u
    const d = vehicleDims(car);
    const wb = (d.wheelbase || 2.7) * 0.5, track = (d.width || 2) * 0.5;
    const h = car.heading || 0;
    const fx = Math.sin(h), fz = Math.cos(h), sx = Math.cos(h), sz = -Math.sin(h);
    const rx = p.x - car.pos.x, rz = p.z - car.pos.z;
    const along = rx * fx + rz * fz, lat = rx * sx + rz * sz;
    // nearest wheel centre in the car's own frame — generous 0.75u radius so a
    // round into the arch/fender skirt still counts as a wheel shot.
    const ca = along > 0 ? wb : -wb, cl = lat > 0 ? track : -track;
    const da = along - ca, dl = lat - cl;
    if (da * da + dl * dl > 0.75 * 0.75) return 0;
    return 1 << ((along > 0 ? 0 : 2) + (lat > 0 ? 0 : 1));
  }
  // body settles toward the dead corner(s) — tiny angles, but at a glance the
  // car reads "sitting wrong" exactly where you shot it.
  function flatLean(car) {
    const f = car._flats | 0; if (!f) return null;
    let roll = 0, pitch = 0;
    if (f & 1) { roll += 0.032; pitch += 0.02; }
    if (f & 2) { roll -= 0.032; pitch += 0.02; }
    if (f & 4) { roll += 0.032; pitch -= 0.02; }
    if (f & 8) { roll -= 0.032; pitch -= 0.02; }
    return { roll, pitch };
  }
  // deflate the struck corner's wheel MESH (radial squash + drop onto the rim).
  // Wheels stay unmerged + tagged playerWheel by the unified visual builder;
  // scale.x/z shrink the cylinder's radius and stay invariant under the spin
  // applied by cityUpdatePlayerCarVisual. Box rigs merge their wheels — they
  // skip the squash and keep just the body lean.
  function applyFlatVisual(car) {
    const ud = car.group && car.group.userData;
    const vis = car._playerCarVisual || (ud && ud.carVisual);
    car._flatVis = vis || null;
    if (!vis) return;
    const wheels = (vis.userData && vis.userData.playerWheels) || [];
    const list = wheels.length ? wheels : (function () {
      const out = [];
      vis.traverse(function (o) { if (o.userData && o.userData.playerWheel) out.push(o); });
      return out;
    })();
    for (let i = 0; i < list.length; i++) {
      const w = list[i];
      const bit = 1 << ((w.position.z > 0 ? 0 : 2) + (w.position.x > 0 ? 0 : 1));
      if (!(car._flats & bit) || w._flatSq) continue;
      w._flatSq = true;
      const r = (w.geometry && w.geometry.parameters && w.geometry.parameters.radiusTop) || 0.4;
      w.scale.x *= 0.68; w.scale.z *= 0.68;        // radial: tire's gone, rim's left
      w.position.y -= r * 0.3;                     // settle the rim toward the road
    }
  }
  // PUBLIC: a bullet landed at `point` — if that's a wheel, blow the tire.
  // Returns true when the round hit rubber (callers soften engine damage).
  CBZ.cityCarTireHit = function (car, point) {
    if (!car || car.dead || !point) return false;
    const bit = tireAt(car, point);
    if (!bit) return false;
    if (car._flats == null) car._flats = 0;
    const side = (bit === 1 || bit === 4) ? 1 : -1;
    emitTireSmoke(car, side);                      // even re-shooting a flat coughs rubber
    if (car._flats & bit) return true;             // that corner's already dead
    car._flats |= bit;
    // the POP: a burst of shredded-rubber smoke + a bang you hear over the gun
    emitTireSmoke(car, side); emitTireSmoke(car, side);
    applyFlatVisual(car);
    const L = flatLean(car);
    if (L && !car.player) {                        // AI loop only writes rotation.y — set the sag once
      car.group.rotation.x = L.pitch; car.group.rotation.z = L.roll;
    }
    // a fresh flat under an AI driver: a brief swerve/wobble (the wreckT spin
    // machinery the crash path already uses), then LIMP to the curb and crawl —
    // a blown tire ends the cruise, it doesn't get floored through.
    if (car.ai && !car.player) {
      car.wreckT = Math.max(car.wreckT || 0, 0.7);
      car.spin = (car.spin || 0) + (Math.random() < 0.5 ? -1 : 1) * (0.8 + Math.random() * 0.9);
      car.baseV = Math.min(car.baseV || 9, 2.2);
      if (car.lane) {                                          // hug the curb (scaled to road width)
        const rd = (CBZ.CITY && CBZ.CITY.road) || 9;
        car.lane = (car.lane < 0 ? -1 : 1) * Math.max(2.2, rd / 2 - 1.5);
        car.laneIdx = lanesPerDir(car.road) - 1;
      }
      car.reckless = false;
    }
    return true;
  };

  // ---- PUBLIC: take damage from bullets / explosions elsewhere (combat, cops).
  //      amount is in engine-HP points; opts.byPlayer attributes the kill. A
  //      direct hit on an already-smoking car can light it; big hits pop it. ----
  CBZ.cityDamageCar = function (car, amount, opts) {
    if (!car || car.dead) return;
    opts = opts || {};
    if (opts.byPlayer) car._burnByPlayer = true;
    if (car.engineHp == null) car.engineHp = 100;
    // WHEEL SHOT: the round went into rubber, not the motor — blow that tire
    // and let only a sliver of the energy reach the engine block.
    const tire = opts.point ? CBZ.cityCarTireHit(car, opts.point) : false;
    if (tire) amount *= 0.25;
    // tracer hits also visibly spark/dent the hull a touch
    if (!tire && opts.crumple) crumpleCar(car, Math.min(0.2, amount * 0.004));
    // exact-point dent: a small crater under the bullet-hole decal. The shot
    // resolver threads opts.point (world Vector3-ish), opts.normal (entry
    // face, toward the shooter) and opts.cal — caliber sets the dimple.
    if (!tire && opts.point && !opts.blast && CBZ.cityCarImpact) {
      const n = opts.normal || { x: 0, y: 0, z: 0 };
      CBZ.cityCarImpact(car, opts.point, { x: -(n.x || 0), y: -(n.y || 0), z: -(n.z || 0) },
        1.6 + (opts.cal || 1) * 1.5, { r: 0.22 + (opts.cal || 1) * 0.08 });
    }
    // TELL damageEngine THE TRUTH. This line used to read `damageEngine(car,
    // amount, true)` — one hardcoded boolean that flattened a rifle round, a
    // molotov, an RPG and a nuclear shock front into "gunfire", and gunfire's
    // rule was to POP the car the same frame its engine hit zero. Every caller
    // already declared what it was in `opts`; nothing was ever reading it.
    // Flag off => the literal `true`, byte-identical.
    // A creature bite is structural impact, never gunfire: no fireball grows
    // out of a shark's mouth, including when the cook-off feature is disabled.
    damageEngine(car, amount, opts.bite ? false : (COOKOFF()
      ? (opts.direct ? "direct" : opts.blast ? "blast" : opts.fire ? "fire" : "gun")
      : true));
    // A megalodon-sized bite that guts a marine engine tears open the hull.
    // Marking it dead hands that existing boat to water_float's wreck/sinking
    // owner on the next frame; the mesh remains, takes on water and disappears
    // below the surface instead of producing an unrelated Hollywood explosion.
    if (opts.bite && car.engineHp <= 0 && !car.dead) {
      car.dead = true; car.abandoned = true; car.ai = false; car.v = 0;
      car._onFire = false; car._smoking = false;
      if (car.npcDriver) killNpcDriverInCar(car);
      if (car.player && CBZ.player.driving && CBZ.cityExitVehicle) CBZ.cityExitVehicle();
    }
    // a driver taking fire doesn't keep cruising the speed limit — they FLOOR it
    // (unless the round just took a tire: you can't floor it on a flat)
    if (!tire && opts.byPlayer && car.ai && !car.dead && !car.npcDriver) {
      car.reckless = true;
      car.baseV = Math.max(car.baseV || 0, ((CBZ.CITY.traf && CBZ.CITY.traf.cruise) || [7, 12])[1] * 1.5);
    }
  };
  // PUBLIC: force a car to catch fire now (e.g. molotov, fuel-line shot, a
  // blast that wounded but did not gut it). `opts` is igniteCar's bag —
  // {fuse, fuseOnly, burnsOut, quiet} — so a caller with a reason to pick the
  // beat can, and the 2-argument call every existing site makes is unchanged.
  CBZ.cityCarIgnite = function (car, byPlayer, opts) {
    if (!car || car.dead) return;
    if (car.engineHp == null || car.engineHp > FIRE_AT) car.engineHp = FIRE_AT;
    if (byPlayer) car._burnByPlayer = true;
    igniteCar(car, false, opts);
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
    /* TAKING THE WHEEL UNCHAINS IT. vehicle_hold.js's law is that a latched
       machine is released the instant somebody claims its controls — that is
       what makes driving one back OUT of a trailer possible at all, and
       militaryvehicles.js's driveArmor says it for armour. A city car has no
       equivalent controller, and this is the one door into its driver's seat:
       every path to driving (the interact verb, the touch pill, a jack, a
       mission) comes through here, so no future path can skip it. */
    if (car._heldBy && CBZ.vehicleHoldRelease) {
      try { CBZ.vehicleHoldRelease(car); } catch (e) {}
    }
    // THE PEOPLE IN IT ANSWER FIRST. occJack promotes every decided seat to a
    // real body, runs each one's decision, and puts the ones who leave beside
    // their OWN door. It degrades to the old single-driver eject when the flag
    // is off or the car never carried an occupancy record.
    const jacked = occJack(car, (CBZ.city && CBZ.city.playerActor) || null);
    if (car.npcDriver) ejectNpcDriver(car);
    const P = CBZ.player;
    P.driving = true; P._vehicle = car;
    car.player = true; car.ai = false; car.pullover = 0;
    if (!car.stolen && !car.owned) {
      car.stolen = true;
      CBZ.cityCrime && CBZ.cityCrime(60, { x: car.pos.x, z: car.pos.z, type: "gta" });
      if (anyWitness(car.pos.x, car.pos.z, 22)) CBZ.city && CBZ.city.note("Grand Theft Auto!", 1.6);
      // EMERGENCY_STEALABLE: boosting a marked unit (police cruiser, ambulance,
      // fire engine) is instant heat — the force notices its own ride leaving.
      // cityAddStars is the star API another system publishes; fall back to the
      // wanted.js floor-to-N call so the stars land either way.
      if ((car._patrolCar || car._emergency) && (!CBZ.CONFIG || CBZ.CONFIG.EMERGENCY_STEALABLE !== false)) {
        if (CBZ.cityAddStars) CBZ.cityAddStars(2, "emergency vehicle theft");
        else if (CBZ.cityForceStars) CBZ.cityForceStars(2);
      }
    }
    car.v = 0;
    CBZ.playerChar.group.visible = false;
    if (CBZ.cityPromotePlayerCar) CBZ.cityPromotePlayerCar(car);
    if (CBZ.carAudio) CBZ.carAudio.start();   // the motor turns over the moment you're in
    const worth = car.model ? "  ·  " + car.model.name : "";   // value stays hidden until you chop it
    CBZ.city && CBZ.city.note("Driving" + worth + " · [E] out  [C] car style", 1.8);
    return true;
  };
  CBZ.cityExitVehicle = function () {
    const P = CBZ.player, car = P._vehicle;
    P.driving = false; P._vehicle = null;
    if (CBZ.carAudio) CBZ.carAudio.stop();    // key off — the engine voice dies with the seat
    if (car && car._skid) car._skid.on = false;
    if (car) {
      car.player = false; car.v = 0; car.vx = car.vz = 0; car.ai = false;
      car._pitch = car._roll = 0;
      setBrake(car, false);               // parked — foot's off the pedal
      if (car.group) car.group.rotation.set(0, car.heading, 0);   // drop the weight-transfer lean
      if (CBZ.cityDemotePlayerCar) CBZ.cityDemotePlayerCar(car);
    }
    releaseDriver();          // unfold, un-scale, give the head back
    CBZ.playerChar.group.visible = true;
    if (car) {
      const ox = Math.cos(car.heading) * 1.6, oz = -Math.sin(car.heading) * 1.6;
      P.pos.set(car.pos.x + ox, 0, car.pos.z + oz);
      P.grounded = true; P.vy = 0;
      CBZ.playerChar.group.position.copy(P.pos);
    }
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

  // (the old dedicated F-to-enter/exit binding is GONE: car enter/boost/jack/
  //  step-out are option records in the interaction registry now — see
  //  city/interact.js "vehicle" / "vehicle:inside" registrations. One context
  //  system, every verb visible before you press it.)

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

  // ---- SURFACE-DEPENDENT GRIP ------------------------------------------------
  // GTA-r128 tarmac is the implicit default everywhere; nothing previously asked
  // "what's actually under this car". Roads carry a `district` tag already used
  // by traffic.js's far-seeder (highway/desert/snow/farmland/forest/town/island/
  // bridge, or untagged = city grid asphalt) — cheap, already-loaded data, zero
  // new colliders. A car still glued to its lane (the common case: ~all ambient
  // traffic, the player on a road) reads its OWN road's district for free. A car
  // that's left the road network entirely (the player free-roaming a beach/
  // field, a wrecked AI car spun onto the sidewalk) falls back to
  // CBZ.cityBiomeAt(x,z) — a short linear scan over the registered landmasses
  // (a handful of entries), so still cheap and only paid off-road. Rain
  // (CBZ.weather.intensity) layers a wet-asphalt penalty on top of whichever
  // surface we land on — pavement loses the most (it has the most grip to lose),
  // a dirt/sand road barely changes (already loose).
  const SURFACE_GRIP = {
    asphalt: 1.0, dirt: 0.74, sand: 0.62, snow: 0.5, grass: 0.7,
  };
  function districtSurface(d) {
    if (d === "desert") return "sand";
    if (d === "snow") return "snow";
    if (d === "farmland" || d === "forest") return "dirt";
    return "asphalt";   // highway / city grid / town / island / bridge / untagged
  }
  function biomeSurface(b) {
    if (b === "desert") return "sand";
    if (b === "snow") return "snow";
    if (b === "forest" || b === "farmland") return "dirt";
    if (b === "city") return "grass";    // off the paved lane but still in town = verge/sidewalk planter
    return "asphalt";                    // purpose-built islands (speedway/airport/military/etc) are paved
  }
  function surfaceFor(car) {
    const r = car && car.road;
    if (r) {
      // still within (roughly) this road's width of its stored centreline? keep
      // reading ITS district even off to the shoulder a touch — exactly matches
      // what the AI lane-keeper already treats as "on this road".
      const A = CBZ.city && CBZ.city.arena;
      const half = (A && A.ROAD ? A.ROAD : 9) * 0.7;
      const lat = r.vertical ? car.pos.x - r.x : car.pos.z - r.z;
      if (Math.abs(lat) < half) return districtSurface(r.district);
    }
    if (CBZ.cityBiomeAt) return biomeSurface(CBZ.cityBiomeAt(car.pos.x, car.pos.z));
    return "asphalt";
  }
  // PUBLIC: surface grip multiplier (0..1] for a car right now — read by the
  // friction-circle math below and exposed for HUD/debug or other modules.
  function surfaceGripMul(car) {
    const kind = surfaceFor(car);
    let mul = SURFACE_GRIP[kind] || 1.0;
    // wet asphalt sheds grip fast; an already-loose surface has less to lose.
    const wet = (CBZ.weather && CBZ.weather.intensity) || 0;
    if (wet > 0) {
      const wetLoss = kind === "asphalt" ? 0.3 : kind === "grass" ? 0.22 : 0.08;
      mul *= 1 - wetLoss * wet;
    }
    return { mul: Math.max(0.32, mul), kind };
  }
  CBZ.cityCarSurfaceGrip = surfaceGripMul;

  // ---- LOCALIZED (per-corner) CRASH DAMAGE -----------------------------------
  // crashdeform.js owns the VISUAL per-corner crater state (front/rear/sideL/
  // sideR) but keeps it in a private LRU registry with no public getter — we
  // can't reach into it without editing a file outside this task's scope. Every
  // call site that feeds crashdeform.js (cityCarImpact) already computes the
  // SAME impact-direction split crumpleCar uses below, so we mirror it into a
  // small persistent accumulator on the car itself (car._cornerDmg), driven by
  // the identical front/rear/side math at the identical call sites. This stays
  // in lock-step with the visual craters (same inputs, same frame) without
  // touching crashdeform.js. Values are 0..1ish and only grow (a corner that's
  // been hit stays weaker — matches the permanent crumple read).
  function addCornerDamage(car, sev, impact) {
    if (!sev || sev <= 0) return;
    const cd = car._cornerDmg || (car._cornerDmg = { front: 0, rear: 0, sideL: 0, sideR: 0 });
    if (!impact) { cd.front = Math.min(1, cd.front + sev * 0.5); cd.rear = Math.min(1, cd.rear + sev * 0.5); return; }
    const fx = Math.sin(car.heading || 0), fz = Math.cos(car.heading || 0);
    const sx = Math.cos(car.heading || 0), sz = -Math.sin(car.heading || 0);
    const f = impact.x * fx + impact.z * fz, s = impact.x * sx + impact.z * sz;
    if (Math.abs(f) >= Math.abs(s)) {
      if (f > 0) cd.front = Math.min(1, cd.front + sev); else cd.rear = Math.min(1, cd.rear + sev);
    } else if (s >= 0) cd.sideR = Math.min(1, cd.sideR + sev); else cd.sideL = Math.min(1, cd.sideL + sev);
  }
  // PUBLIC: read a car's corner-damage record (or a pristine one if undamaged).
  CBZ.cityCarCornerDamage = function (car) {
    return (car && car._cornerDmg) || { front: 0, rear: 0, sideL: 0, sideR: 0 };
  };

  // ---- LIGHTWEIGHT AI SLIP MODEL (shared, NOT the full player grip block) ---
  // Ordinary calm traffic stays on the cheap lane-snap path (order-37's main
  // loop below) for performance — hundreds of cars don't need tire physics to
  // sit in a lane. But the moment a car is in a HIGH-STAKES state — wrecked/
  // spinning out, mid road-rage ram, fleeing a PIT, off-rails after a crash —
  // it deserves to actually carry lateral momentum and lose control like the
  // player can, instead of just curving on a fixed spin rate. This reuses (not
  // duplicates) the same forward/lateral split + slip-curve + surface-grip
  // shape as the player's carDynamics/grip code, trimmed to the handful of
  // terms that matter for a car that's already out of normal driving control:
  // no steering input, no per-gear torque, no weight-transfer friction circle
  // (those only matter for a DRIVEN car) — just "how fast does this car's
  // sideways momentum bleed off, on whatever it's currently sliding across".
  // State carried on the car: vx/vz (world-space velocity — already a field
  // every car has from the solid-collision code), spin (yaw rate, rad/s).
  function aiSlipStep(car, dt, gripBase) {
    const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
    let vx = car.vx == null ? fx * (car.v || 0) : car.vx;
    let vz = car.vz == null ? fz * (car.v || 0) : car.vz;
    const fwdDot = vx * fx + vz * fz;
    let latX = vx - fx * fwdDot, latZ = vz - fz * fwdDot;
    const speed = Math.hypot(vx, vz);
    const rawSlip = Math.hypot(latX, latZ);
    const slipRatio = rawSlip / Math.max(3, speed);
    const slideGrip = slipRatio <= 0.18 ? 1 : Math.max(0.4, 1 - (slipRatio - 0.18) * 1.6);
    const surf = surfaceGripMul(car).mul;
    const grip = Math.max(0.5, (gripBase == null ? 6 : gripBase)) * slideGrip * surf;
    const latKeep = Math.max(0, 1 - grip * dt);
    latX *= latKeep; latZ *= latKeep;
    // heading follows the spin (already decaying in the caller) PLUS a touch of
    // the surviving slip feeding back into yaw — a sliding tail visibly drags
    // the nose with it instead of the body translating sideways like a puck.
    car.heading += (latX * fz - latZ * fx) * 0.03 * dt;
    vx = fx * fwdDot + latX; vz = fz * fwdDot + latZ;
    car.vx = vx; car.vz = vz;
    // car.v stays a non-negative SPEED MAGNITUDE (every other reader in this
    // file — crash thresholds, damage curves, audio — assumes that), even
    // though the velocity vector itself can now point off-heading mid-slide.
    car.v = Math.hypot(vx, vz);
    return Math.hypot(latX, latZ);
  }

  function carDynamics(car) {
    const bk = bodyKind(car);
    const rarity = car.model ? Math.max(0, Math.min(1, car.model.rarity || 0)) : 0.35;
    // Base profile per body type. Wheelbase + steering lock feed a bicycle-model
    // yaw approximation; drag/rolling resistance control coast-down separately
    // from braking, so letting off the throttle no longer feels like braking.
    // GTA vehicle-class feel — super/sports grip + accel high, muscle grunty but
    // loose-tailed, SUV/van/pickup heavy & numb with weaker brakes.
    let accel = 30, top = 33, turn = 2.5, grip = 7.0, brake = 30;
    let wheelbase = 2.62, steerLock = 0.56, drag = 0.0065, rolling = 1.15;
    if (bk === "coupe") { accel = 42; top = 44; turn = 3.0; grip = 9.4; brake = 38; }
    else if (bk === "muscle") { accel = 40; top = 41; turn = 2.45; grip = 6.6; brake = 30; }   // fast in a line, tail steps out
    else if (bk === "sedan") { accel = 32; top = 35; turn = 2.6; grip = 7.4; brake = 32; }
    else if (bk === "suv") { accel = 26; top = 31; turn = 2.1; grip = 5.6; brake = 27; }
    else if (bk === "pickup") { accel = 27; top = 32; turn = 2.0; grip = 5.2; brake = 26; }
    else if (bk === "van") { accel = 23; top = 29; turn = 1.85; grip = 4.8; brake = 24; }
    else if (bk === "semi") { accel = 14; top = 25; turn = 1.05; grip = 3.6; brake = 15; }
    else if (bk === "hatch") { accel = 29; top = 31; turn = 2.85; grip = 7.2; brake = 31; wheelbase = 2.42; steerLock = 0.6; }
    if (bk === "coupe") { wheelbase = 2.48; steerLock = 0.58; drag = 0.0055; rolling = 0.9; }
    else if (bk === "muscle") { wheelbase = 2.78; steerLock = 0.52; rolling = 1.05; }
    else if (bk === "suv") { wheelbase = 2.9; steerLock = 0.48; drag = 0.008; rolling = 1.4; }
    else if (bk === "pickup") { wheelbase = 3.08; steerLock = 0.46; drag = 0.0085; rolling = 1.5; }
    else if (bk === "van") { wheelbase = 3.18; steerLock = 0.44; drag = 0.009; rolling = 1.6; }
    /* THE TURNING CIRCLE IS THE WHOLE CHARACTER OF A TRUCK, and in a bicycle
       model it is `wheelbase / tan(steerLock)` — nothing else. 8.6 m of
       wheelbase against a 0.30 rad lock gives ~28 m, which is a real artic's
       kerb-to-kerb and is why you cannot take a downtown corner in one bite.
       Authoring a small `turn` and leaving the wheelbase at a car's would have
       made it feel sluggish rather than LONG: the yaw rate would be low but the
       swept path still a hatchback's, so the trailer would pivot on its own
       middle and the corner would come out fine. It has to be the geometry. */
    else if (bk === "semi") { wheelbase = 8.6; steerLock = 0.30; drag = 0.0165; rolling = 2.6; }
    // Performance follows the model's market tier, not its visual length. The
    // old use of `s` accidentally made long vans faster than short sports cars.
    top *= 0.88 + rarity * 0.28;
    accel *= 0.9 + rarity * 0.22;
    // the promoted player-car STYLE layers its GTA-class feel on top (a Veyron
    // grips and rockets, a van wallows) so swapping style ([C]) actually drives
    // differently — published by playercars.js as car._playerCarFeel.
    const feel = car.player ? car._playerCarFeel : null;
    let roll = 0.6, drift = 1.0;
    if (feel) {
      accel *= feel.accel; top *= feel.top; turn *= feel.turn; grip *= feel.grip; brake *= feel.brake;
      roll = feel.roll == null ? 0.6 : feel.roll; drift = feel.drift == null ? 1.0 : feel.drift;
      if (feel.twoWheel) roll = 0;   // a bike leans via its own rider rig, not whole-body roll
      // MARINE: a hull doesn't carve like a car — it comes around SLOW and WIDE.
      // FEEL.boat's turn:1.0 is a straight sedan-rate multiplier (playercars.js
      // never branches on `marine` itself — that's this fix), so cut the yaw
      // rate + widen the effective turning circle here instead of in the FEEL
      // table: a long, low steerLock means holding full rudder still sweeps a
      // big arc rather than snapping the bow around like a wheeled steer lock.
      if (feel.marine) { turn *= 0.5; steerLock *= 0.55; wheelbase *= 1.6; }
    } else {
      if (bk === "coupe") { roll = 0.4; drift = 0.9; }
      else if (bk === "muscle") { roll = 0.7; drift = 1.35; }
      else if (bk === "suv") { roll = 1.1; drift = 1.05; }
      else if (bk === "pickup") { roll = 1.0; drift = 1.05; }
      else if (bk === "van") { roll = 1.3; drift = 1.1; }
      else if (bk === "semi") { roll = 1.5; drift = 1.25; }
    }
    // DAMAGE degrades it: a smoking/burning car is gutless and squirrelly
    const d = carDmg(car);
    accel *= 1 - d * 0.55; top *= 1 - d * 0.42; grip *= 1 - d * 0.5; turn *= 1 - d * 0.28;
    // BLOWN TIRES (car._flats bitmask): a flat FRONT cuts grip + steering and
    // (in the drive loop) drags the nose toward the dead side; a flat REAR cuts
    // grip + top speed. All four = riding on rims — barely a car anymore.
    const f = car._flats | 0;
    let flatPull = 0;
    if (f) {
      const fc = (f & 1 ? 1 : 0) + (f & 2 ? 1 : 0), rc = (f & 4 ? 1 : 0) + (f & 8 ? 1 : 0);
      grip *= 1 - fc * 0.18 - rc * 0.14;
      turn *= 1 - fc * 0.2;
      top *= 1 - fc * 0.05 - rc * 0.14;
      accel *= 1 - (fc + rc) * 0.07;
      if (fc + rc === 4) { top *= 0.45; grip *= 0.65; }
      // front flats steer the car: pull toward the flat side (left = +heading)
      flatPull = (f & 1 ? 0.14 : 0) - (f & 2 ? 0.14 : 0);
    }
    // LOCALIZED (per-corner) CRASH DAMAGE folded into the grip computation: a
    // car hit hard on one corner handles worse FROM that corner specifically,
    // not just a flat global cut. Front/rear damage eats overall grip+turn
    // (a crumpled axle can't transmit cornering force cleanly); a side hit
    // (sideL/sideR) biases the car toward its undamaged side, same as a blown
    // front tire's flatPull. cd mirrors crashdeform.js's per-corner craters —
    // see addCornerDamage above, fed by the identical impact-direction math at
    // every crumpleCar() call site.
    const cd = car._cornerDmg;
    let cornerGripMul = 1, cornerPull = 0;
    if (cd) {
      cornerGripMul = Math.max(0.45, 1 - Math.max(cd.front, cd.rear) * 0.32 - Math.max(cd.sideL, cd.sideR) * 0.16);
      grip *= cornerGripMul; turn *= 1 - Math.max(cd.front, cd.rear) * 0.18;
      cornerPull = (cd.sideR - cd.sideL) * 0.16;     // a dead side drags the nose toward the healthy one
    }
    // SURFACE: asphalt is the baseline; dirt/sand/snow/wet tarmac loosen the
    // tires' hold on the road. Sampled here (once per carDynamics call, i.e.
    // once a frame for the driven car) so callers don't each re-derive it.
    const surf = surfaceGripMul(car);
    grip *= surf.mul;
    /* SLIPSTREAM. `_draft` (0..1) is written by racedrivers.js's one sweep over
       every car on track — the AI field AND this one — so the tow down a
       straight is symmetric and there is no second aero model living in the
       player's loop. Outside a race nothing writes it and this is a no-op. */
    if (car._draft > 0) {
      const gain = CBZ.DRAFT_TOP_GAIN == null ? 0.10 : CBZ.DRAFT_TOP_GAIN;
      top *= 1 + car._draft * gain;
      accel *= 1 + car._draft * 0.18;
      drag *= 1 - car._draft * 0.35;      // it is a DRAG reduction; say so
    }
    return { accel, top, turn, grip, brake, dmg: d, roll, drift, wheelbase, steerLock, drag, rolling, flatPull, cornerGripMul, cornerPull, surfMul: surf.mul, surfKind: surf.kind };
  }
  function vehicleDims(car) {
    return (car && (car._visualDims || car.dims)) || { width: 2, length: 4.4, wheelbase: 2.7 };
  }
  // ---- ENGINE VOICE class + fake gearbox ----------------------------------
  // The audio synth (systems/audio.js CBZ.carAudio) has five crank voices; map
  // whatever you're sitting in onto one so a stolen Veyron SOUNDS exotic and a
  // work van sounds like a work van. Re-checked every frame (string compare,
  // free) so the [C] style-cycler retunes the motor the moment the body swaps.
  function engineFlavor(car) {
    const feel = car._playerCarFeel, cls = feel && feel.class;
    if (cls === "motorcycle") return "bike";
    if (cls === "super" || cls === "sports") return "sports";
    if (cls === "muscle" || cls === "lowrider") return "muscle";
    if (cls === "suv" || cls === "van" || cls === "boat" || cls === "helicopter") return "truck";
    const bk = bodyKind(car);
    if (bk === "coupe") return "sports";
    if (bk === "muscle") return "muscle";
    if (bk === "suv" || bk === "pickup" || bk === "van" || bk === "semi") return "truck";
    return "sedan";
  }
  // top-of-gear points as fractions of the car's own top speed: revs climb
  // through each band and DROP on the shift — five fake gears read as a real
  // box without simulating one.
  const GEAR_TOP = [0.14, 0.30, 0.50, 0.74, 1.01];
  // ---- PER-GEAR TORQUE-BAND CURVE ----------------------------------------
  // Real engines aren't a flat taper to top speed: torque is soft right off
  // idle, builds to a mid-band peak, then falls again near the redline (where
  // you'd shift). A handful of (revFrac, torqueMul) keypoints per gear is
  // cheap (one lerp per frame) and makes a downshift/upshift actually feel
  // like it changed available power, instead of one smooth accel taper for
  // the whole speed range. revFrac is this gear's OWN 0..1 band (matches the
  // `sN`/`glo`/GEAR_TOP[gear] math the audio rev code already computes), so
  // the same curve drives both throttle response and the engine voice — sound
  // and power stay in sync by construction (one curve, two readers).
  // 1st gear bites hard off idle (launch torque); top gear is long and flat
  // (cruise gear, no torque headroom to spare); middle gears get the classic
  // low→peak→fall hump. modshop.js Stage N performance reshapes this curve
  // (flatter, higher peak, later fall-off) rather than just scaling a number.
  const GEAR_TORQUE = [
    [[0, 0.62], [0.18, 1.0], [0.55, 0.96], [1, 0.74]],     // 1st: bites instantly, eases late
    [[0, 0.7], [0.3, 1.0], [0.65, 0.92], [1, 0.7]],        // 2nd
    [[0, 0.68], [0.35, 0.97], [0.7, 0.88], [1, 0.66]],     // 3rd
    [[0, 0.64], [0.4, 0.92], [0.75, 0.82], [1, 0.62]],     // 4th
    [[0, 0.6], [0.45, 0.84], [0.8, 0.76], [1, 0.58]],      // 5th/top: long, flatter, less headroom
  ];
  // PUBLIC (read-only reference): modshop.js's Stage N performance mod builds
  // a RESHAPED copy of this table (flatter, higher-peak, later-falling curves)
  // instead of just multiplying a flat scalar — see cityApplyCarMod("perf",...).
  CBZ.cityGearTorqueBase = GEAR_TORQUE;
  function lerpCurve(curve, t) {
    t = Math.max(0, Math.min(1, t));
    for (let i = 1; i < curve.length; i++) {
      if (t <= curve[i][0]) {
        const a = curve[i - 1], b = curve[i], span = b[0] - a[0];
        const u = span > 1e-5 ? (t - a[0]) / span : 0;
        return a[1] + (b[1] - a[1]) * u;
      }
    }
    return curve[curve.length - 1][1];
  }
  // gear index + this-gear rev fraction for a given speedNorm (0..1 of top
  // speed) — shared by the throttle integrator AND the audio rev code so a
  // shift always lands on the same gear both readers agree on.
  function gearFor(sN) {
    let gear = 0; while (gear < GEAR_TOP.length - 1 && sN >= GEAR_TOP[gear]) gear++;
    const glo = gear === 0 ? 0 : GEAR_TOP[gear - 1];
    const revFrac = Math.max(0, Math.min(1, (sN - glo) / Math.max(0.05, GEAR_TOP[gear] - glo)));
    return { gear, revFrac };
  }
  // torque multiplier for the gear/rev-fraction a car is CURRENTLY turning,
  // optionally reshaped by a performance-mod curve override (modshop.js
  // publishes car._perfGearTorque — same [revFrac,mul] keypoint shape).
  function gearTorqueMul(car, sN) {
    const { gear, revFrac } = gearFor(sN);
    const table = (car && car._perfGearTorque) || GEAR_TORQUE;
    const curve = table[Math.min(gear, table.length - 1)];
    return { mul: lerpCurve(curve, revFrac), gear, revFrac };
  }
  function wallRadius(car) {
    const d = vehicleDims(car);
    return Math.max(1.05, Math.min(1.6, d.width * 0.58));
  }
  const _sweepPt = { x: 0, y: 0, z: 0 };   // scratch — zero per-call allocation
  const _agroundN = { x: 0, z: 0 };        // ditto, for the aground shore normal

  /* ---- THE HEIGHT GATE A CAR NEVER HAD ---------------------------------
     THE OWNER'S BUG, AND IT IS ONLY A BUG WHEN YOU DRIVE. Every call below
     used to be CBZ.collide(pos, radius) with NO feetY/headY, and physics.js
     is explicit about what that means: "Omit both args and EVERY collider
     acts full-height". Height-gated boxes are how this game draws anything
     you are meant to pass UNDER or OVER — gantry beams, balconies, canopies,
     upper-floor window bands, the arena's stand rails twenty metres up, the
     marina travel-lift's 8.7 m cross-beams. On foot they correctly ignore
     you. In a car every one of them was a wall standing in mid-air.

     MEASURED on the shipped world before this change, on the port alone
     (x -220..360, z -920..-480, sampled every 2 m): 68 ground points where a
     car is stopped by geometry that sits ENTIRELY ABOVE ITS ROOF — the worst
     a 16 x 12 m block of open ground you simply cannot drive across. Nothing
     is drawn there at car height because there is nothing there.

     The band is deliberately generous DOWNWARD (0.9 m below the chassis) so
     nothing a car should hit stops catching it: kerbs (y1 0.22), the harbour
     knee-wall (y1 0.55), the breakwater moles that start at y -1.4. Only
     geometry above the roof is released, which is the whole bug.

     The marine special-case above this function exists because of the same
     defect — a boat "crunching to a stop at the dock like it hit a building"
     on the harbour knee-wall — and it is left exactly as it is: it fires on
     open water before any of this runs.

     Revert: CBZ.CONFIG.VEH_HEIGHT_GATE = false (or ?cfg_VEH_HEIGHT_GATE=0). */
  const _span = { feet: 0, head: 0 };
  function wallSpan(car) {
    const C = CBZ.CONFIG || (CBZ.CONFIG = {});
    if (C.VEH_HEIGHT_GATE == null) C.VEH_HEIGHT_GATE = true;
    if (C.VEH_HEIGHT_GATE === false) { _span.feet = undefined; _span.head = undefined; return _span; }
    const base = car.pos.y || 0;
    const h = +vehicleDims(car).height;
    _span.feet = base - 0.9;
    _span.head = base + (isFinite(h) && h > 0.8 ? h : 1.9) + 0.15;
    return _span;
  }
  function collideVehicle(car) {
    if (!CBZ.collide || !car || !car.pos) return 0;
    // MARINE: a boat out on open water has no buildings/seawall to bump — skip
    // the road-car wall resolver entirely so it can nose past the harbor's
    // knee-wall collider (height-gated for a JUMPING pedestrian, not a boat
    // hull sitting at y=0) instead of crunching to a stop at the dock like it
    // hit a building. Still resolves normally over land (a beached/marooned
    // boat, or the moment it noses back toward the quay, behaves like any car).
    if (isMarineCar(car) && overWater(car.pos.x, car.pos.z)) {
      car._sweepX = car.pos.x; car._sweepZ = car.pos.z;   // keep the sweep anchor fresh over water
      return 0;
    }
    const ox = car.pos.x, oz = car.pos.z, radius = wallRadius(car);
    const span = wallSpan(car);          // the car's own vertical band (above)
    // ---- ANTI-TUNNEL SWEEP (VEH_COLLIDE_FIX): every caller integrates
    // position FIRST and only then depenetrates here, so a frame whose
    // displacement exceeds the body radius could jump clean over a thin
    // collider (signal poles, lampposts — 0.5m boxes) with both endpoints
    // outside it. Walk the segment from the LAST resolved position and stop
    // the car at the first sample a collider pushes back. Skipped for small
    // steps (can't tunnel) and huge ones (teleport/spawn/respawn, not motion).
    if (!CBZ.CONFIG || CBZ.CONFIG.VEH_COLLIDE_FIX !== false) {
      const px0 = car._sweepX, pz0 = car._sweepZ;
      if (px0 != null) {
        const sdx = ox - px0, sdz = oz - pz0;
        const sdist = Math.hypot(sdx, sdz), step = radius * 0.8;
        if (sdist > step && sdist < 12) {
          const n = Math.min(8, Math.ceil(sdist / step));
          for (let i = 1; i < n; i++) {
            _sweepPt.x = px0 + sdx * (i / n); _sweepPt.z = pz0 + sdz * (i / n); _sweepPt.y = car.pos.y || 0;
            const sx = _sweepPt.x, sz = _sweepPt.z;
            CBZ.collide(_sweepPt, radius, span.feet, span.head);
            if (_sweepPt.x !== sx || _sweepPt.z !== sz) {
              car.pos.x = _sweepPt.x; car.pos.z = _sweepPt.z;   // hit mid-frame: stop AT the obstacle
              break;
            }
          }
        }
      }
    }
    CBZ.collide(car.pos, radius, span.feet, span.head);
    const d = vehicleDims(car);
    const reach = Math.max(0, d.length * 0.5 - radius * 0.45);
    if (reach > 0.2) {
      const sign = (car.v || 0) < -0.1 ? -1 : 1;
      const fx = Math.sin(car.heading || 0) * sign, fz = Math.cos(car.heading || 0) * sign;
      const probe = { x: car.pos.x + fx * reach, y: car.pos.y || 0, z: car.pos.z + fz * reach };
      const px = probe.x, pz = probe.z;
      CBZ.collide(probe, radius * 0.75, span.feet, span.head);
      car.pos.x += probe.x - px;
      car.pos.z += probe.z - pz;
    }
    car._sweepX = car.pos.x; car._sweepZ = car.pos.z;   // anchor for next frame's sweep
    return Math.hypot(car.pos.x - ox, car.pos.z - oz);
  }
  CBZ.cityCollideVehicle = collideVehicle;
  // PUBLIC so an ALTERNATIVE vehicle controller (world/water_helm.js takes the
  // whole frame for a marine hull) can still run the two per-frame duties the
  // player drive loop below owns and which are NOT specific to road physics:
  // hitting bodies with the hull, and the smoke -> fire -> explode damage
  // stager. Without these a boat could neither run down a swimmer nor ever
  // finish burning. Read-only exports; no behaviour changes here.
  CBZ.cityVehicleRunOver = runOver;
  CBZ.cityVehicleTickDamage = tickDamageStage;

  // ---- player driving (order 11) ----
  CBZ.onUpdate(11, function (dt) {
    if (g.mode !== "city") return;
    const P = CBZ.player;
    if (!P.driving || !P._vehicle || P.dead) return;
    const car = P._vehicle, k = CBZ.keys;
    const D = carDynamics(car);
    // ---- THE MARINE HELM SEAM (world/water_helm.js) ------------------------
    // A hull is not a car. Everything below this line — the tyre grip model,
    // the friction circle, the fake 5-speed gearbox, the wheelbase bicycle
    // steer, the weight-transfer dive/squat — describes a thing with four
    // contact patches on tarmac, and a boat has none of it. The whole marine
    // model used to be the three multipliers at carDynamics()'s `feel.marine`
    // branch, which left a boat steering at zero throttle, never planing,
    // never drifting and pivoting at its own centre of gravity.
    //
    // CBZ.marineHelm returns TRUE only when it has fully owned the frame for
    // this hull (input, Froude-based drag with the wave-making hump, thrust-
    // vectored or rudder steering, sway damping, aft pivot, wave slamming,
    // quay collision, player/camera sync and engine audio). It returns FALSE —
    // having touched nothing — when the hull is beached, airborne off a stunt
    // ramp, has no registered spec, or the flag is off, and then this loop
    // runs exactly as it always has. carDynamics()'s marine branch stays put
    // as that fallback path.
    if (CBZ.marineHelm && CBZ.CONFIG.WATER_HELM !== false && CBZ.marineHelm(car, dt, D)) return;
    const ACCEL = D.accel, MAXV = D.top, REV = 13, TURN = D.turn;
    // ---- throttle / braking ----
    let throttle = 0;
    if (k["w"]) throttle += 1;
    if (k["s"]) throttle -= 1;
    // CARS_NO_WATER: a flooded engine takes no throttle (set in the water block
    // below once the grace window passes — during grace you can reverse out).
    if (car._flooded && (!CBZ.CONFIG || CBZ.CONFIG.CARS_NO_WATER !== false)) throttle = 0;
    // VEH_FUEL: a dry tank is the same statement as a drowned engine — this
    // engine makes no torque right now — so it cuts throttle in exactly the
    // same place and the same way. city/fuel.js owns the tank; feature-detected
    // and flag-gated, so with fuel.js absent or VEH_FUEL=false this is a no-op.
    // `_lastThrottle` is read back by the burn tick so fuel is priced against
    // the throttle actually applied, not the key that was held.
    car._lastThrottle = throttle;
    if (CBZ.fuelStarved && CBZ.fuelStarved(car)) throttle = 0;
    const handbrake = !!k[" "];   // SPACE = handbrake → break grip and DRIFT
    if (throttle > 0) {
      if (car.v < 0) car.v += D.brake * dt;           // brake out of reverse first
      else {
        // REAL GEAR/TORQUE: the old flat top-end taper is replaced by a
        // per-gear torque-band curve (gearTorqueMul) — same gear math the
        // engine-voice code below reads, so a downshift's extra grunt and its
        // sound stay in sync. A loose surface also caps how much of that
        // torque the tires can put down (wheelspin on sand/snow/wet tarmac)
        // instead of pure ground friction silently eating the power.
        const sN0 = Math.min(1, Math.abs(car.v) / MAXV);
        const gt = gearTorqueMul(car, sN0);
        const wheelspinCap = throttle > 0 && Math.abs(car.v) < MAXV * 0.4 ? Math.min(1, 0.55 + D.surfMul * 0.6) : 1;
        // AERO DRAG TAPER: the gear-torque curve alone models engine/gearbox
        // power delivery per gear -- it has no notion of the car's own
        // aerodynamic drag rising with v^2, which is what actually caps real
        // top speed (the old flat taper this replaced folded that in
        // implicitly). Without an equivalent term a car sustains far more of
        // its peak torque all the way to MAXV than before and reaches a given
        // speed dramatically sooner (verified: without this, a full-throttle
        // run into a wall a fixed distance away hits at a meaningfully higher
        // speed than the pre-existing formula produced for the same run,
        // enough to flip a survivable "hard" wall hit into a fatal
        // "catastrophic" one). Keep the same overall envelope the old taper
        // guaranteed -- multiply the gear curve by it directly -- while still
        // letting the per-gear shape do its job in the low/mid range where
        // the old taper was close to 1 anyway.
        const dragTaper = 1 - Math.min(0.7, sN0);
        car.v += ACCEL * gt.mul * dragTaper * wheelspinCap * dt;
      }
    } else if (throttle < 0) {
      if (car.v > 0.5) car.v -= D.brake * dt;         // S brakes hard when rolling forward
      else car.v -= (ACCEL * 0.55) * dt;              // then backs up
    }
    if (throttle === 0) {
      const coast = (D.rolling + D.drag * car.v * car.v) * dt;
      if (car.v > 0) car.v = Math.max(0, car.v - coast);
      else if (car.v < 0) car.v = Math.min(0, car.v + coast);
    }
    if (handbrake) car.v *= Math.pow(0.34, dt);       // handbrake bleeds forward speed
    car.v = Math.max(-REV, Math.min(MAXV, car.v));
    // ---- steering: smooth input + speed-sensitive bicycle-model yaw. This
    //      keeps low-speed parking controllable and removes instant high-speed
    //      direction changes while preserving arcade authority. ----
    const touchSteer = CBZ.touchCarSteerValue ? CBZ.touchCarSteerValue(car) : null;
    let steer = Number.isFinite(touchSteer) ? touchSteer : 0;
    if (!Number.isFinite(touchSteer)) {
      if (k["a"]) steer += 1;
      if (k["d"]) steer -= 1;
    }
    const vmag = Math.abs(car.v);
    // brake lights: S while rolling forward, or the handbrake at speed
    setBrake(car, (throttle < 0 && car.v > 0.4) || (handbrake && vmag > 1));
    const steerRate = steer ? 7.5 : 10.5;
    car._steerInput = (car._steerInput || 0) + (steer - (car._steerInput || 0)) * Math.min(1, dt * steerRate);
    const speedNorm = Math.min(1, vmag / Math.max(1, MAXV));
    const lock = D.steerLock * (1 - speedNorm * 0.48);
    const bicycleYaw = (car.v / Math.max(1.8, D.wheelbase)) * Math.tan(car._steerInput * lock);
    const yawLimit = TURN * (1 - speedNorm * 0.42) * (handbrake ? 1.35 : 1);
    const yaw = Math.max(-yawLimit, Math.min(yawLimit, bicycleYaw));
    if (vmag > 0.3) {
      car.heading += yaw * dt;
      if (D.dmg > 0.45) {                              // damaged axle drags the nose to one side
        if (car._pull == null) car._pull = (car._cside || 1) * (0.18 + Math.random() * 0.12);
        car.heading += car._pull * (D.dmg - 0.45) * dt * Math.min(1, vmag / 8);
      }
      // a blown FRONT tire drags the wheel steadily toward the flat — you hold
      // opposite lock the whole way home (carDynamics signs it per corner)
      if (D.flatPull) car.heading += D.flatPull * dt * Math.min(1, vmag / 8);
      // a dead corner from CRASH damage (sideL/sideR) drags the nose toward
      // its healthy side, same channel as the flat-tire pull above.
      if (D.cornerPull) car.heading += D.cornerPull * dt * Math.min(1, vmag / 8);
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
    const rawSlip = Math.hypot(latX, latZ);
    const slipRatio = rawSlip / Math.max(3, vmag);
    // ---- WEIGHT TRANSFER feeds the grip curve (Marco Monster "Car Physics for
    //      Games"): braking dives the nose (front axle load UP, rear DOWN —
    //      the rear has LESS grip to resist a slide, which is exactly why
    //      trail-braking into a corner can snap the tail loose); accelerating
    //      squats the tail (rear load UP, front DOWN — power-on understeer).
    //      accelG mirrors the cosmetic pitch-lean's sign convention below so the
    //      body dive you SEE is the same load shift the tires actually feel.
    const accelG = throttle > 0 ? -1 : (throttle < 0 && car.v > 0.5 ? 1.3 : 0);
    // FRICTION CIRCLE: a tire has one shared budget for longitudinal (brake/
    // accel) + lateral (cornering) force — you can't have 100% of both. Hard
    // braking (accelG>0, i.e. nose-dive) eats into the rear's lateral budget on
    // top of the static load shift, so a hard stop mid-corner genuinely induces
    // a slide instead of just scrubbing speed. brakeDemand is how much of the
    // rear tire's grip the braking itself is currently spending.
    const brakeDemand = throttle < 0 && car.v > 0.5 ? Math.min(0.55, vmag / Math.max(8, MAXV) * 0.6) : 0;
    const rearLoadGrip = 1 - Math.max(-0.22, Math.min(0.3, accelG * 0.18)) - brakeDemand;   // dive/brake steals rear grip
    // Tire force peaks at modest slip, then falls once the tire is sliding. It
    // makes a drift recoverable without the rear snapping unrealistically back.
    // DRIVE_FEEL_V2 raises the sliding-tire floor 0.38→0.5 (a fully lit-up
    // tire still finds half its grip — arcade-GTA recoverability, not ice).
    const feel2 = !CBZ.CONFIG || CBZ.CONFIG.DRIVE_FEEL_V2 !== false;
    const slideGrip = slipRatio <= 0.18 ? 1 : Math.max(feel2 ? 0.5 : 0.38, 1 - (slipRatio - 0.18) * 1.75);
    // D.grip already carries SURFACE (asphalt/dirt/sand/snow/rain) and
    // LOCALIZED CORNER DAMAGE (carDynamics folds both in — see surfaceGripMul
    // + cornerGripMul there) — this block only adds the per-frame DYNAMIC
    // terms (weight transfer / friction circle / slip curve) on top.
    // DRIVE_FEEL_V2 ("driving feels too out of control"):
    //   • grip floor 0.42 → 1.6: the old floor let a broken-loose car keep its
    //     slide with a ~1.7s half-life — every clipped corner turned into a
    //     runaway drift. Slides still happen (steer penalty + power-oversteer)
    //     but recover in a beat unless the handbrake deliberately holds them.
    //   • steer-at-speed penalty −2.25 → −1.3, and scaled by the ACTUAL
    //     steering input: the old gate was `car._steerInput &&` — truthiness
    //     of an exponentially-decaying float that never re-reaches exactly 0,
    //     so after your first-ever turn the full penalty applied FOREVER
    //     (plain straight-line cruising drove on buttered rears).
    const steerMag = Math.abs(car._steerInput || 0);
    const steerPen = feel2
      ? (steerMag > 0.05 && vmag > 8 ? -1.3 * driftMul * Math.min(1, steerMag) : 0)
      : (car._steerInput && vmag > 8 ? -2.25 * driftMul : 0);
    const gripFactor = handbrake ? 0.75 * D.surfMul
      : Math.max(feel2 ? 1.6 : 0.42, (D.grip * rearLoadGrip + steerPen - power) * slideGrip);
    const latKeep = handbrake ? Math.min(0.95, 0.9 + driftMul * 0.02 + (1 - D.surfMul) * 0.5) : Math.max(0, 1 - gripFactor * dt);
    latX *= latKeep; latZ *= latKeep;
    const velX = fwdX * car.v + latX, velZ = fwdZ * car.v + latZ;
    const slip = Math.hypot(latX, latZ);
    car._drift = slip;
    // ---- DRIVING JUICE: one number — how hard are the rear tyres working?
    //      Slides (lateral slip), handbrake lock-ups, a full-brake stop from
    //      speed and a hard launch in something powerful all count. It drives
    //      the screech volume, the white smoke and the rubber on the road. ----
    const burnout = throttle > 0 && vmag > 0.6 && vmag < 7 && D.accel > 32;   // a strong motor lights them up off the line
    const skidAmt = Math.max(
      slip > 2.2 && vmag > 6 ? Math.min(1, slip / 8) : 0,
      handbrake && vmag > 6 ? 0.85 : 0,
      throttle < 0 && car.v > Math.max(14, MAXV * 0.55) ? 0.55 : 0,           // locked-up panic stop
      burnout ? 0.6 : 0
    );
    if (skidAmt > 0.3) {                               // white smoke boils off BOTH rears
      car._tireT = (car._tireT || 0) + dt;
      if (car._tireT > 0.13 - skidAmt * 0.06) { car._tireT = 0; emitTireSmoke(car, 1); emitTireSmoke(car, -1); }
    }
    // ALL FOUR SHOT OUT: grinding along on bare rims — a constant cough of
    // shredded-rubber/rim smoke off both rears whenever you force it to move
    if (car._flats === 15 && vmag > 6) {
      car._rimT = (car._rimT || 0) + dt;
      if (car._rimT > 0.16) { car._rimT = 0; emitTireSmoke(car, 1); emitTireSmoke(car, -1); }
    }
    laySkids(car, skidAmt, fwdX, fwdZ);
    // ---- POOLED fading skid-TRAILS + drift/burnout DUST (systems/skidmarks.js
    //      + systems/dustfx.js) — feature-detected, ADDITIVE to the opaque
    //      laySkids() rubber above; reuses the exact same skidAmt slip signal
    //      so both effects only ever run while the tyres are actually working.
    //      Smallest possible hook: compute the two rear-wheel world seats (same
    //      rb/tw geometry laySkids already derives) and hand them to the pooled
    //      systems, which own all their own pooling/eviction/fade internally.
    if (skidAmt > 0.3 && (CBZ.cityBeginSkid || CBZ.cityDriftDust)) {
      const rd = vehicleDims(car);
      const rb2 = (rd.wheelbase || 2.7) * 0.45;
      const two2 = car._playerCarFeel && car._playerCarFeel.twoWheel;
      const tw2 = two2 ? 0 : (rd.width || 2) * 0.4;
      const wlx = car.pos.x - fwdX * rb2 + fwdZ * tw2, wlz = car.pos.z - fwdZ * rb2 - fwdX * tw2;
      const wrx = car.pos.x - fwdX * rb2 - fwdZ * tw2, wrz = car.pos.z - fwdZ * rb2 + fwdX * tw2;
      if (CBZ.cityBeginSkid && CBZ.cityUpdateSkid) {
        CBZ.cityBeginSkid(car, 0, wlx, wlz); CBZ.cityUpdateSkid(car, 0, wlx, wlz);
        if (!two2) { CBZ.cityBeginSkid(car, 1, wrx, wrz); CBZ.cityUpdateSkid(car, 1, wrx, wrz); }
      }
      if (CBZ.cityDriftDust) {
        CBZ.cityDriftDust(wlx, 0.15, wlz, { amt: skidAmt });
        if (!two2) CBZ.cityDriftDust(wrx, 0.15, wrz, { amt: skidAmt });
      }
    } else if (CBZ.cityEndSkid) { CBZ.cityEndSkid(car, 0); CBZ.cityEndSkid(car, 1); }
    // ---- ENGINE VOICE: revs climb through the fake gear band, snap down on
    //      the upshift. Reverse whines low; revving at a standstill screams.
    //      gear/revFrac come from the SAME gearFor() the throttle integrator
    //      above reads (via gearTorqueMul), so a downshift's extra grunt and
    //      the note you hear are always the same gear, every frame. ----
    if (CBZ.carAudio) {
      const sN = Math.min(1, vmag / Math.max(1, MAXV));
      const gf = gearFor(sN);
      const gear = gf.gear;
      let rev = car.v < 0 ? Math.min(1, vmag / REV) * 0.4 : gf.revFrac;
      rev = 0.06 + Math.max(0, Math.min(1, rev)) * 0.9;
      if (throttle > 0 && vmag < 2.5) rev = Math.max(rev, 0.5);   // revving it off the line / mid-burnout
      const shifted = car._gear != null && gear > car._gear && throttle > 0;
      car._gear = gear;
      CBZ.carAudio.update(rev, throttle > 0 ? 1 : 0, skidAmt, engineFlavor(car), shifted);
    }
    // ---- WEIGHT TRANSFER (visual + physical — accelG is the SAME load-shift
    //      signal the grip model above already consumed, so the dive/squat you
    //      SEE here is exactly the load shift the tires felt this frame, not a
    //      decorative coincidence): the body PITCHES (squat on throttle, dive
    //      on brake) and ROLLS into a turn, eased so it reads as mass shifting.
    //      softer cars (high D.roll) lean more. Touches only the group rotation
    //      x/z, which the crash crumple leaves alone. ----
    const pitchTarget = Math.max(-0.07, Math.min(0.09, accelG * 0.05 * Math.min(1, vmag / 14)));
    // body leans OUTWARD of the turn: steering at speed plus any tail-out slip.
    const latG = car._steerInput * Math.min(1, vmag / 12) + (latX * fwdZ - latZ * fwdX) * 0.16;
    let rollTarget = Math.max(-0.16, Math.min(0.16, latG * 0.06 * (D.roll || 0.6)));
    let pitchT2 = pitchTarget;
    // the body SITS on its blown corner(s) — the lean rides the same eased
    // weight-transfer channel, so it composes with squat/dive/roll for free
    if (car._flats) {
      const FL = flatLean(car);
      if (FL) { pitchT2 += FL.pitch; rollTarget += FL.roll; }
      // [C] style-cycler swapped the visual under us — re-deflate the new wheels
      if (car._playerCarVisual && car._playerCarVisual !== car._flatVis) applyFlatVisual(car);
    }
    car._pitch = (car._pitch || 0) + (pitchT2 - (car._pitch || 0)) * Math.min(1, dt * 7);
    car._roll = (car._roll || 0) + (rollTarget - (car._roll || 0)) * Math.min(1, dt * 6);
    car.vx = velX; car.vz = velZ;
    const moveFromX = car.pos.x, moveFromZ = car.pos.z;
    car.pos.x += velX * dt; car.pos.z += velZ * dt;
    // Authored stunt ramps launch the whole vehicle into a proper ballistic
    // state. Horizontal momentum continues untouched; gravity, pitch/roll and
    // landing impulse are integrated here by the same car controller.
    if (!car._airborne && CBZ.cityStuntRampHit) {
      const launch = CBZ.cityStuntRampHit(car, moveFromX, moveFromZ, car.pos.x, car.pos.z, vmag);
      if (launch) {
        car._airborne = true; car._airY = Math.max(0.12, car._airY || 0);
        car._airVy = launch.vy; car._airPitch = -0.16; car._airRoll = 0;
        if (CBZ.sfx) CBZ.sfx("jump");
        if (CBZ.shake) CBZ.shake(0.32);
      }
    }
    if (car._airborne) {
      car._airVy -= 19.2 * dt;
      car._airY += car._airVy * dt;
      const flightPitch = Math.max(-0.34, Math.min(0.30, -car._airVy * 0.026));
      car._airPitch += (flightPitch - (car._airPitch || 0)) * Math.min(1, dt * 4.5);
      const flightRoll = Math.max(-0.24, Math.min(0.24, -(car._steerInput || 0) * Math.min(1, vmag / 16) * 0.18));
      car._airRoll += (flightRoll - (car._airRoll || 0)) * Math.min(1, dt * 3.5);
      if (car._airY <= 0 && car._airVy < 0) {
        const impactV = -car._airVy;
        car._airY = 0; car._airVy = 0; car._airborne = false;
        if (impactV > 10) {
          damageEngine(car, Math.max(0, (impactV - 9) * 1.8), false);
          if (CBZ.shake) CBZ.shake(Math.min(1.4, impactV * 0.07));
          if (impactV > 15 && CBZ.sfx) CBZ.sfx("ko");
        }
      }
    }
    const before = { x: car.pos.x, z: car.pos.z };
    const moved = car._airborne && car._airY > 0.55 ? 0 : collideVehicle(car);
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
      // the impact damages the engine on a SPEED-SCALED curve (NHTSA/IIHS ladder):
      // a low-speed wall scuff barely touches the motor, a moderate hit dings it,
      // and only a fast slam guts it. Even a catastrophic hit no longer instantly
      // explodes (damageEngine routes crashes through the burn fuse) — it disables
      // the car into a smoking/burning wreck the player can bail from.
      //   below wallHard : 0.6 HP per unit of speed above the 5-unit no-damage floor
      //                    (~9 HP at a 20 mph clip — survives many; many bumps to kill)
      //   hard           : ~26 + speed-over-threshold ramp
      //   catastrophic   : heavy enough to GUT the motor (engineHp→0) so it always
      //                    becomes at least a disabled, smoking wreck (was 52 → a
      //                    30-unit slam left it at HP 48, not even smoking; the bug
      //                    fast-impact-velocity-detonate flags). Now it reliably
      //                    disables, then cooks off via the (rare, slow) fire fuse.
      const crashE = catastrophic ? (110 + (vmag - CRASH.wallCatastrophic) * 8)
                   : hard         ? (24 + (vmag - CRASH.wallHard) * 2)
                                  : Math.max(0, (vmag - 5) * 0.6);
      damageEngine(car, crashE, false);
      // TOP-SPEED ram ALWAYS ignites → explodes (fast-impact-velocity-detonate
      // "things hitting things BLOW UP when they should"): a genuinely flat-out
      // slam (normally vmag>=38 ≈ 91mph, near a car's top end) is past the point
      // where it merely smokes — it GUARANTEES a cook-off, overriding the
      // rare-fire roll. Race-prepped cars get a little more escape room (44).
      // A mid-catastrophic ram (30..38) keeps the realistic odds (usually a
      // disabled smoker, sometimes a slow burn). Guarded so a freak engine state
      // never double-ignites. The breach above + the wreck flag dedup the carve.
      const forceFireAt = car._raceCar ? CRASH.raceForceFire : 38;
      if (catastrophic && vmag >= forceFireAt && !car._onFire && !car._exploded && !car.dead) {
        car._smoking = true; car._crashFireRolled = true;   // we're forcing it — skip the chance roll
        igniteCar(car, true);                               // slow crash-fire fuse → time to bail, then detonates
        car._burnsOut = false;                              // a top-speed ram fireball does NOT just burn out
      }
      // crater point from the PRE-impact pose (group.matrixWorld still holds it) —
      // captured before the push-back/spin below so the dent lands on the contact
      const dentX = car.pos.x + Math.sin(car.heading) * 2.2, dentZ = car.pos.z + Math.cos(car.heading) * 2.2;
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
      if (hard && CBZ.sfx) { CBZ.sfx("ko"); CBZ.sfx("punch"); }
      const ix = car.pos.x + Math.sin(car.heading) * 2.2, iz = car.pos.z + Math.cos(car.heading) * 2.2;
      crashBurst(ix, iz, vmag, hard, catastrophic, { x: -nwx, z: -nwz });   // debris sprays into the wall
      if (hard && CBZ.cityShatter) CBZ.cityShatter(ix, iz, catastrophic ? 10 : 6);
      if (CBZ.cityRankEvent) CBZ.cityRankEvent("crash", { speed: vmag, hard, catastrophic, wall: true, car });
      // the car visibly CRUMPLES (the building/post is only lightly scuffed)
      crumpleCar(car, catastrophic ? 0.78 : (hard ? 0.42 : 0.08), { x: -nwx, z: -nwz });
      // and the nose CRATERS at the contact — a 60mph wall hit stays cratered
      if (CBZ.cityCarImpact) CBZ.cityCarImpact(car, { x: dentX, y: (vehicleDims(car).height || 1.5) * 0.42, z: dentZ }, { x: -nwx, y: 0, z: -nwz }, vmag);
      // ---- STRUCTURAL COUPLING (ram-breaches-building): the WALL the car hit
      //      reacts to the slam, not just the car. A HARD hit scorches/dents the
      //      facade, bursts its panes and knocks chunks loose (the same damage
      //      escalation an explosion uses, dialled modest so it scuffs — never
      //      levels — at <=1.4 power). A CATASTROPHIC (top-speed, vmag>=30) ram
      //      ALSO punches a car-sized WALK-THROUGH BREACH so a 70mph ram opens a
      //      hole you can keep driving through — the exact ground-floor carve the
      //      RPG ground-hit uses, which self-dedups via fracture.recent() and is
      //      a harmless no-op on open air. NOT a detonation: a ram makes no
      //      fireball unless the engine later cooks off through the damage fuse.
      //      Contact point ix,iz + wall normal nwx,nwz are already derived above.
      if (hard && CBZ.cityDamageBuilding) {
        const wy = (CBZ.floorAt ? CBZ.floorAt(ix, iz) : 0) + 1.0;
        CBZ.cityDamageBuilding(ix, wy, iz, catastrophic ? 1.4 : 0.8);
      }
      if (catastrophic && CBZ.cityBreach) CBZ.cityBreach(ix, iz, 1.6);
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
    // MARINE: a hull on open water rides the water surface instead of the flat
    // car-height y=0. Position is never forced back into the walkable-land
    // union; quays are enforced only by their visible collision geometry.
    /* WHICH WATER TEST, AND IT DEPENDS ON THE HULL. The same point under a
       bridge is water to the boat passing beneath and dry deck to the car
       driving over — and waterfield.js's isSurfaceWater cannot tell them
       apart, because the question carries no y and it has to keep the deck
       dry or every car on a causeway floods. So the split is made HERE,
       where the asker is known: a marine hull reads cityNavWaterAt (which
       adds the registered river channel under a deck), everything with
       wheels keeps cityWaterAt exactly as before.

       Without this a river cannot pass under a highway, and this country
       carries 31 link regions — city/river.js measured that there is no
       route from the harbour to any coast that avoids them all. With it in
       the shared oracle instead, the gate caught a car floating: CARS ON
       WATER: 1. */
    const isHull = isMarineCar(car);
    const onWater = isHull && CBZ.cityNavWaterAt
      ? !!CBZ.cityNavWaterAt(car.pos.x, car.pos.z)
      : overWater(car.pos.x, car.pos.z);
    const marine = isHull && onWater;
    // ---- BOAT_NO_LAND: the exact mirror of CARS_NO_WATER below. A road car
    // in the sea floods; a boat on the sand is AGROUND. water_helm.js keeps a
    // hull UNDER WAY from ever crossing the waterline, but a hull can still
    // ARRIVE on land another way — spawned there, launched off a stunt ramp,
    // left high and dry by a retreating surge — and from here the road path
    // would hand it tyre grip, a gearbox and a terrain seat: a speedboat
    // touring the city on its keel. Aground it keeps walking-pace way and no
    // more, which is enough to shove itself back off the beach and never
    // enough to drive anywhere. It is a clamp, not a stop: a boat you can't
    // refloat is a boat you've lost, and that punishes the wrong thing.
    // The waterline is a wall on THIS path too. water_helm.js owns the resolver
    // when it owns the frame; this is the same one call for the frames it does
    // not own (WATER_HELM off, a hull with no registered spec), so "a boat
    // cannot be driven onto land" holds whichever physics has the helm.
    if (marine && CBZ.marineShoreBlock) {
      try { CBZ.marineShoreBlock(car, car._hullSpec, dt); } catch (e) {}
    }
    if (isMarineCar(car) && !onWater
        && (!CBZ.CONFIG || CBZ.CONFIG.BOAT_NO_LAND !== false) && !car._airborne) {
      const AGROUND_MS = 2.2;                        // ~8 km/h — a shove, not a drive
      car.v *= Math.pow(0.30, dt);                   // sand and shingle, not tarmac
      car.v = Math.max(-AGROUND_MS, Math.min(AGROUND_MS, car.v));
      const gm = Math.hypot(car.vx || 0, car.vz || 0);
      if (gm > AGROUND_MS) { const f = AGROUND_MS / gm; car.vx *= f; car.vz *= f; }
      // AND ONLY TOWARD THE WATER. A crawl is still a drive — at 2.2 m/s a
      // patient player walks a speedboat across the map. The one way off a
      // beach is OFF it: way that carries the hull seaward is allowed (drive
      // off bow-first, or back off stern-first), way that would carry it
      // further up the sand is refused outright. Not damped — REFUSED. A held
      // throttle re-applies its acceleration every single frame, so any decay
      // gentle enough to feel like friction just finds an equilibrium and the
      // boat keeps crawling; the number this must beat is the throttle, not
      // the momentum. The shore gradient points water -> land, so the whole
      // test is one dot product.
      if (CBZ.waterField && CBZ.waterField.shoreGradient) {
        const gn = CBZ.waterField.shoreGradient(car.pos.x, car.pos.z, 6, _agroundN);
        const nose = Math.sin(car.heading) * gn.x + Math.cos(car.heading) * gn.z;
        if (!(-nose * car.v > 0)) { car.v = 0; car.vx = 0; car.vz = 0; }
      }
      if (!car._agroundNoted) {
        car._agroundNoted = true;
        CBZ.city && CBZ.city.note("Aground, back her off the beach.", 1.8);
      }
    } else if (car._agroundNoted) car._agroundNoted = false;
    // ---- CARS_NO_WATER: a road car is not a boat. Past a grace window (a
    // quick nose-dip can still reverse straight back out), open water floods
    // the engine: throttle dies (cut at the top of this loop), all momentum
    // hard-decays, the hull visibly SINKS, and after a beat the driver bails
    // into a swim (swim.js owns the water the frame P.driving turns false).
    // The drowned hull is marked dead — never enterable, never smoking (the
    // damage stager returns on dead, so no underwater fire/explosion).
    const noWater = !CBZ.CONFIG || CBZ.CONFIG.CARS_NO_WATER !== false;
    let sinkY = 0;
    if (noWater && !marine && onWater) {
      const GRACE = 0.35, SINK_T = 2.2, BAIL = 1.3, DEPTH = -1.6;
      car._waterT = (car._waterT || 0) + dt;
      if (car._waterT > GRACE) {
        car._flooded = true;
        const dec = Math.pow(0.05, dt);
        car.v *= dec; car.vx *= dec; car.vz *= dec;
        sinkY = DEPTH * Math.min(1, (car._waterT - GRACE) / SINK_T);
        if (CBZ.carAudio && !car._engineCutNoted) { car._engineCutNoted = true; CBZ.carAudio.stop(); CBZ.city && CBZ.city.note("Engine flooded!", 1.4); }
        if (car._waterT > GRACE + BAIL) {
          // driver bails: the car is a drowned wreck for good
          car.dead = true;
          car.group.position.set(car.pos.x, sinkY, car.pos.z);
          CBZ.cityExitVehicle();
          CBZ.city && CBZ.city.note("The car went under, swim!", 2.0);
          return;
        }
      }
    } else if (car._waterT) { car._waterT = 0; car._flooded = false; car._engineCutNoted = false; }
    // The driven car has no region clamp. Visible colliders, terrain and the
    // flood/swim path own the edge, so a quay or biome boundary can never act
    // like an invisible wall. Autonomous traffic keeps its containment path.
    // VEHICLE_TERRAIN: the driven car stands on the ground under it — the same
    // CBZ.floorAt the player's own feet use — and PITCHES AND ROLLS over the
    // hills. Marine hulls still ride WATER_Y, a swamped hull still sinks and an
    // airborne car still keeps its ballistic _airY, because all three are
    // OFFSETS FROM THE GROUND, not replacements for it. Weight-transfer
    // pitch/roll (_pitch/_roll) composes on top of the terrain's attitude, and
    // the terrain's is dropped entirely while airborne — a jumping car's
    // attitude belongs to the jump.
    let terrY = 0;
    if (!marine && !(noWater && onWater)) terrY = terrainSeat(car, true, dt);
    else { car._terrY = 0; car._terrPitch = 0; car._terrRoll = 0; }
    const rideY = (marine ? WATER_Y : sinkY + terrY) + (car._airY || 0);
    car.group.position.set(car.pos.x, rideY, car.pos.z);
    car.group.rotation.set(
      (car._pitch || 0) + (car._airPitch || 0) + (car._airborne ? 0 : (car._terrPitch || 0)),
      car.heading,
      (car._roll || 0) + (car._airRoll || 0) + (car._airborne ? 0 : (car._terrRoll || 0)));
    if (!car._airborne) {
      car._airPitch = (car._airPitch || 0) * Math.max(0, 1 - dt * 7);
      car._airRoll = (car._airRoll || 0) * Math.max(0, 1 - dt * 7);
    }
    if (vmag > 6) runOver(car, vmag);
    P.pos.set(car.pos.x, rideY, car.pos.z);
    // THE DRIVER. CAR_DRIVER_VISIBLE seats the player's real, dressed rig at
    // the wheel of his own car (see the block above); the `else` arm is the
    // pre-wave behaviour and the one-line revert — park the rig at the car's
    // ground point and hide it EVERY frame, because FPS/view toggles kept
    // re-showing a standing body whose head came out through the roof.
    if (!(driverWanted(car) && seatDriver(car, dt))) {
      if (drv.car) releaseDriver();
      CBZ.playerChar.group.position.copy(P.pos);
      CBZ.playerChar.group.visible = false;
    }
    P.speed = vmag;
    if (CBZ.cityUpdatePlayerCarVisual) CBZ.cityUpdatePlayerCarVisual(car, dt);
    if (CBZ.cam && vmag > 3 && !(CBZ.camRecenterSuspended && CBZ.camRecenterSuspended())) {
      const target = car.heading + Math.PI;
      CBZ.cam.yaw = CBZ.lerpAngle(CBZ.cam.yaw, target, 1 - Math.pow(0.02, dt));
    }
    // chop shop: idle a stolen/owned car in the bay to cash it out
    chopCheck(car, vmag, dt);
    // multi-stage damage: smoke → fire → explode (ticking burn under the player)
    tickDamageStage(car, dt);
  });

  // ---- SOLID car-vs-car collision + crashes (spatially-near pairs, once a frame).
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
  function setCrashVelocity(car, x, z, offRails) {
    car.vx = x; car.vz = z;
    const speed = Math.hypot(x, z);
    if (car.player) {
      const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
      car.v = x * fx + z * fz;
    } else if (offRails) {
      car.v = speed;
      if (speed > 0.1) car.heading = Math.atan2(x, z);
    } else {
      const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
      car.v = Math.max(0, x * fx + z * fz);
    }
  }
  function collisionImpulse(a, b, av, bv, nx, nz, closing, hard, catastrophic) {
    const am = Math.max(0.6, a.mass || 1), bm = Math.max(0.6, b.mass || 1);
    const restitution = catastrophic ? 0.04 : (hard ? 0.1 : 0.2);
    const impulse = (1 + restitution) * closing / (1 / am + 1 / bm);
    const ax = av.x - nx * impulse / am, az = av.z - nz * impulse / am;
    const bx = bv.x + nx * impulse / bm, bz = bv.z + nz * impulse / bm;
    const deltaA = Math.hypot(ax - av.x, az - av.z);
    const deltaB = Math.hypot(bx - bv.x, bz - bv.z);
    setCrashVelocity(a, ax, az, hard);
    setCrashVelocity(b, bx, bz, hard);
    return { deltaA, deltaB, am, bm };
  }
  function wreckCar(c, speed, dir, rammer, hard, catastrophic) {
    if (c.player) {
      // The impulse owns the actual velocity change. The player keeps control,
      // but a side impact now slews the car instead of being overwritten by a
      // canned speed multiplier.
      if (!rammer && hard && CBZ.cam) CBZ.cam.pitch = (CBZ.cam.pitch || 0) - Math.min(0.18, speed * 0.008);
      return;
    }
    c.wreckT = Math.max(c.wreckT || 0, catastrophic ? 2.8 : (hard ? 1.8 : 0.72));
    // spin scales with impact + the struck side: a T-bone whips the car around,
    // a glancing tap just nudges it — heavier on the car that got rammed.
    const spinMag = (rammer ? 0.55 : 1) * Math.min(catastrophic ? 9 : 6, speed * 0.45);
    c.spin = (c.spin || 0) + (Math.random() - 0.5) * spinMag + dir * Math.min(catastrophic ? 4.5 : 2.8, speed * 0.15);
    c.pullover = 0; c.turning = false;     // abandon whatever it was doing
  }
  function carCrash(a, b, speed, nx, nz) {
    const av = carVel(a), bv = carVel(b);
    const aSpeed = Math.hypot(av.x, av.z), bSpeed = Math.hypot(bv.x, bv.z);
    const am = Math.max(0.6, a.mass || 1), bm = Math.max(0.6, b.mass || 1);
    const reducedMass = (am * bm) / (am + bm);
    const severity = speed * Math.sqrt(Math.max(0.5, reducedMass * 2));
    const hard = severity >= CRASH.carHard, catastrophic = severity >= CRASH.carCatastrophic;
    a._crashCD = hard ? 0.6 : 0.24; b._crashCD = hard ? 0.6 : 0.24;
    // The rammer is whichever vehicle contributes more velocity into the contact
    // normal. A stationary player hit from the side is no longer blamed as the rammer.
    const aInto = Math.max(0, av.x * nx + av.z * nz);
    const bInto = Math.max(0, -(bv.x * nx + bv.z * nz));
    const aRammer = aInto >= bInto;
    const imp = collisionImpulse(a, b, av, bv, nx, nz, speed, hard, catastrophic);
    wreckCar(a, severity, -1, aRammer, hard, catastrophic);
    wreckCar(b, severity, 1, !aRammer, hard, catastrophic);
    const massAvg = Math.max(0.8, Math.min(1.65, (am + bm) * 0.5));
    const heavy = (catastrophic ? 0.92 : (hard ? 0.62 : 0.26)) * massAvg;
    const light = (catastrophic ? 0.6 : (hard ? 0.34 : 0.12)) * massAvg;
    crumpleCar(a, aRammer ? light : heavy, { x: nx, z: nz });
    crumpleCar(b, aRammer ? heavy : light, { x: -nx, z: -nz });
    // panel craters at the actual contact point: each hull caves toward its
    // own centre (n points a→b), the rammed car the deeper of the two
    if (CBZ.cityCarImpact) {
      const px = (a.pos.x + b.pos.x) / 2, pz = (a.pos.z + b.pos.z) / 2;
      const py = Math.min(vehicleDims(a).height || 1.5, vehicleDims(b).height || 1.5) * 0.4;
      CBZ.cityCarImpact(a, { x: px, y: py, z: pz }, { x: -nx, y: 0, z: -nz }, severity * (aRammer ? 0.75 : 1));
      CBZ.cityCarImpact(b, { x: px, y: py, z: pz }, { x: nx, y: 0, z: nz }, severity * (aRammer ? 1 : 0.75));
    }
    // engine HP: a collision guts the motor on a SPEED-SCALED curve, the rammed
    // car taking the worst of it. A low-speed fender-bender (severity below
    // carHard) costs only a sliver per car, so two cars can trade many bumps
    // without dying; repeated/major rams build toward smoke → fire → explosion.
    // No collision instantly turns a car into a fireball — even a catastrophic
    // wreck disables it and the fire (then blast) develops over the burn fuse.
    //   below carHard : ~0.5 HP per severity-unit over the 6-unit no-damage floor
    //   hard          : ~26 + ramp over threshold
    //   catastrophic  : heavy (still routed through the fire fuse, not instant)
    const sevOver = Math.max(0, severity - 6);
    const eHeavy = catastrophic ? (58 + (severity - CRASH.carCatastrophic) * 3)
                 : hard         ? (26 + (severity - CRASH.carHard) * 2.2)
                                : sevOver * 0.5;
    const eLight = catastrophic ? (36 + (severity - CRASH.carCatastrophic) * 2)
                 : hard         ? (15 + (severity - CRASH.carHard) * 1.3)
                                : sevOver * 0.28;
    damageEngine(a, Math.min(82, (aRammer ? eLight : eHeavy) * Math.max(0.85, Math.min(1.3, bm))), false);
    damageEngine(b, Math.min(82, (aRammer ? eHeavy : eLight) * Math.max(0.85, Math.min(1.3, am))), false);
    if ((a.player || b.player)) { if (a.player) a._burnByPlayer = true; if (b.player) b._burnByPlayer = true; }
    // Occupant injury follows delta-v, the quantity people actually feel in a
    // collision. Normal bumps do nothing; a hard side/T-bone hit hurts badly.
    if (hard && CBZ.cityHurtPlayer) {
      const playerCar = a.player ? a : (b.player ? b : null);
      const deltaV = a.player ? imp.deltaA : imp.deltaB;
      if (playerCar && deltaV > 4.5) {
        const protection = Math.max(0.68, 1 - (playerCar.armor || 0) * 0.75);
        const dmg = Math.min(catastrophic ? 165 : 88, Math.round((deltaV - 4.5) * (catastrophic ? 7.2 : 4.5) * protection));
        if (dmg > 0) CBZ.cityHurtPlayer(dmg, playerCar.pos.x, playerCar.pos.z, "car crash", false, null, !catastrophic);
      }
    }
    // A small contact-position kick prevents the meshes from immediately
    // re-colliding; velocity transfer itself is handled by the impulse above.
    const kick = Math.min(catastrophic ? 1.6 : 0.9, severity * (catastrophic ? 0.05 : 0.035));
    const aMassFac = Math.max(0.5, Math.min(1.8, bm / am));   // how hard A is shoved (by B's mass)
    const bMassFac = Math.max(0.5, Math.min(1.8, am / bm));
    a.pos.x -= nx * kick * aMassFac; a.pos.z -= nz * kick * aMassFac;
    b.pos.x += nx * kick * bMassFac; b.pos.z += nz * kick * bMassFac;
    const cx = (a.pos.x + b.pos.x) / 2, cz = (a.pos.z + b.pos.z) / 2;
    const cam = CBZ.camera.position, cd2 = (cx - cam.x) * (cx - cam.x) + (cz - cam.z) * (cz - cam.z);
    if (a.player || b.player || cd2 < 75 * 75) {
      if (a.player || b.player) {
        const playerCar = a.player ? a : b;
        playerCar.lastCrashScore = Math.max(playerCar.lastCrashScore || 0, Math.round(severity * massAvg));
        if (CBZ.cityRankEvent) CBZ.cityRankEvent("crash", { speed: severity, hard, catastrophic, carA: a, carB: b });
      }
      crashBurst(cx, cz, severity, hard, catastrophic, { x: nx, z: nz });
      if (CBZ.shake) CBZ.shake(catastrophic ? 1.45 : (hard ? 0.95 : 0.26));
      if (CBZ.doHitstop) CBZ.doHitstop(catastrophic ? 0.1 : (hard ? 0.06 : 0.02));
      if (CBZ.sfx) CBZ.sfx(hard ? "ko" : "punch");
      if (hard && CBZ.cityShatter) CBZ.cityShatter(cx, cz, catastrophic ? 8 : 4.5);
    }
  }
  function collisionSupport(car, nx, nz) {
    const d = vehicleDims(car), h = car.heading || 0;
    const fx = Math.sin(h), fz = Math.cos(h), sx = Math.cos(h), sz = -Math.sin(h);
    return Math.abs(nx * fx + nz * fz) * d.length * 0.5 + Math.abs(nx * sx + nz * sz) * d.width * 0.5;
  }
  function collisionBound(car) {
    const d = vehicleDims(car);
    return Math.hypot(d.width, d.length) * 0.5;
  }
  const CAR_GRID_CELL = 9;
  const carGrid = new Map();
  // A BURNT-OUT HULK IS STILL IN THE ROAD. `dead` used to mean "gone next
  // frame", so every collision path in this file skips it — correct then,
  // wrong now that a cook-off leaves a wreck standing for minutes. A husk is
  // solid (you shunt it, you cannot drive through it) but it is NOT a crash
  // partner: there is nothing left of it to wreck, and running carCrash on a
  // dead record would re-enter the damage ladder it has already finished.
  function solidCar(c) { return c && (!c.dead || c._husk); }
  function resolveCars(dt) {
    const cars = CBZ.cityCars, n = cars.length;
    carGrid.clear();
    /* A LOAD IN A HOLD IS NOT IN THE DEPENETRATION SOLVE. It is standing
       INSIDE another car's OBB on purpose — that is what "drove into the back"
       means — so leaving it in would make the trailer and its own cargo shove
       each other apart at 37.6 every frame, against a latch re-asserted at
       12.7. Nothing else can reach it (it is inside a box), so removing it from
       the grid entirely is both correct and free. */
    for (let i = 0; i < n; i++) {
      const a = cars[i]; if (!solidCar(a) || a._heldBy) continue;
      if (a._crashCD > 0) a._crashCD -= dt;
      const gx = Math.floor(a.pos.x / CAR_GRID_CELL), gz = Math.floor(a.pos.z / CAR_GRID_CELL);
      // numeric key (no per-frame string alloc; gx/gz are small at CELL=9) — packs
      // two ints collision-free for any |coord| < 1024 (offset+stride 4096 > range).
      const key = (gx + 1024) * 4096 + (gz + 1024), bucket = carGrid.get(key);
      if (bucket) bucket.push(i); else carGrid.set(key, [i]);
    }
    for (let i = 0; i < n; i++) {
      const a = cars[i]; if (!solidCar(a) || a._heldBy) continue;
      const gx = Math.floor(a.pos.x / CAR_GRID_CELL), gz = Math.floor(a.pos.z / CAR_GRID_CELL);
      for (let ox = -1; ox <= 1; ox++) for (let oz = -1; oz <= 1; oz++) {
        const bucket = carGrid.get(((gx + ox) + 1024) * 4096 + ((gz + oz) + 1024)); if (!bucket) continue;
        for (let bi = 0; bi < bucket.length; bi++) {
          const j = bucket[bi]; if (j <= i) continue;
          const b = cars[j]; if (!solidCar(b)) continue;
          if (a._husk && b._husk) continue;            // two wrecks already at rest
          const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z, d2 = dx * dx + dz * dz;
          const broadHit = collisionBound(a) + collisionBound(b);
          if (d2 > broadHit * broadHit) continue;
          const d = Math.sqrt(Math.max(1e-6, d2));
          const nx = d2 < 1e-6 ? (i & 1 ? 1 : -1) : dx / d, nz = d2 < 1e-6 ? 0 : dz / d;
          const hit = collisionSupport(a, nx, nz) + collisionSupport(b, nx, nz);
          if (d >= hit) continue;
          /* A CAR BEING DRIVEN INTO A TRAILER IS NOT CRASHING INTO IT. Once its
             nose is past the aperture it is standing INSIDE the truck's own OBB
             on purpose, and separating them is not just wrong-looking — a semi
             is mass 4.2 against a saloon's 1.05, so the depenetration weighting
             shoves the car straight back down the ramp and the load can never
             be driven aboard at all. That was the measured symptom: the ramp
             worked, the ground query worked, and the car bounced out.
             Asked only AFTER the broad phase has already said these two
             overlap, so the common case pays nothing. (Once it comes to REST it
             latches, `_heldBy` is set, and the grid loops above drop it from the
             solve entirely — this clause covers only the drive-in itself.) */
          if ((a.hold && !a.hold.inert && a.hold.contains(b.pos.x, b.pos.y + 0.4, b.pos.z)) ||
              (b.hold && !b.hold.inert && b.hold.contains(a.pos.x, a.pos.y + 0.4, a.pos.z))) continue;
          const overlap = hit - d;
        // SOLID separation — they cannot occupy the same space
          const am = Math.max(0.6, a.mass || 1), bm = Math.max(0.6, b.mass || 1), tm = am + bm;
          const aw = bm / tm, bw = am / tm;
          a.pos.x -= nx * overlap * aw; a.pos.z -= nz * overlap * aw;
          b.pos.x += nx * overlap * bw; b.pos.z += nz * overlap * bw;
        // closing speed along the contact normal
          const va = carVel(a), vb = carVel(b);
          const closing = (va.x - vb.x) * nx + (va.z - vb.z) * nz;
          if (closing > 2 && !a._husk && !b._husk && (a._crashCD || 0) <= 0 && (b._crashCD || 0) <= 0) carCrash(a, b, closing, nx, nz);
          else if (closing > 0.25) {
            const imp = collisionImpulse(a, b, va, vb, nx, nz, closing, false, false);
            if (imp.deltaA < 0.01 && imp.deltaB < 0.01) { a.v *= 0.98; b.v *= 0.98; }
          }
        // keep visuals (and the player's position/camera) in sync this frame
          // The DRIVEN car's altitude and attitude belong to the drive step
          // (it composes _airY, sinkY, WATER_Y and the weight transfer); this
          // depenetration pass only owns XZ, so it must not re-seat it or a
          // shove mid-jump would snap the car to the ground for a frame.
          const ay = a.player ? a.group.position.y : seatCar(a, dt);
          const by = b.player ? b.group.position.y : seatCar(b, dt);
          if (a.player) { a.group.position.set(a.pos.x, ay, a.pos.z); CBZ.player.pos.set(a.pos.x, ay, a.pos.z); CBZ.playerChar.group.position.copy(CBZ.player.pos); }
          if (b.player) { b.group.position.set(b.pos.x, by, b.pos.z); CBZ.player.pos.set(b.pos.x, by, b.pos.z); CBZ.playerChar.group.position.copy(CBZ.player.pos); }
        }
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
    // one-per-call latch so a car that clips SEVERAL bodies this frame still
    // fires exactly ONE hit-stop / impact voice / "catch" (never stack N).
    let juiced = false;
    for (const p of CBZ.cityPeds) {
      if (p.dead || p.inCar) continue;
      const dx = p.pos.x - car.pos.x, dz = p.pos.z - car.pos.z;
      const _d2 = dx * dx + dz * dz;
      /* THE ONE THAT MISSED. A car doing 15 m/s that passes a metre from
         somebody is an event to that person even though nothing touched them —
         it is most of what makes driving through a crowd FEEL like something,
         and until now the only thing a pedestrian could notice was being hit.
         Costs nothing: this loop was already walking every ped, and the latch
         means one person can only be startled by you every few seconds. */
      if (_d2 >= 3.2 && _d2 < 34 && car.player && vmag > 10 && !p.inCar &&
          (p._nearMissT || 0) <= (CBZ.now || 0)) {
        p._nearMissT = (CBZ.now || 0) + 4200;
        p.fear = Math.min(10, (p.fear || 0) + 1.6);
        p.alarmed = Math.max(p.alarmed || 0, 4);
        if (CBZ.cityRelShift) CBZ.cityRelShift(p, "nearMiss", 1);
        if (CBZ.cityPanicRaise) CBZ.cityPanicRaise(p.pos.x, p.pos.z, 0.35);
        if (CBZ.cityScare && CBZ.city) CBZ.cityScare(p, CBZ.city.playerActor, { bias: 0.14 });
      }
      if (_d2 < 3.2) {
        if ((p._carHitUntil || 0) > (CBZ.now || 0)) continue;
        p._carHitUntil = (CBZ.now || 0) + 850;
        // Low-speed contact knocks a person over and makes them react. Only a
        // genuinely fast impact becomes a lethal run-over.
        const imp = { fromX: car.pos.x, fromZ: car.pos.z, force: 8 + vmag * 0.35, fling: 4 + vmag * 0.3 };
        if (!car.player) { imp.attacker = car.npcDriver || null; imp.byPlayer = false; }
        const lethal = vmag >= CRASH.pedLethal && !p.dead;   // a genuine kill THIS contact
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
            // only a genuinely HARD impact is the 2★ vehicular-assault; a light
            // nudge (rolling into someone) is just 1★ reckless driving at low sev,
            // so it can't climb past the star-1 floor.
            if (vmag >= CRASH.carHard) CBZ.cityCrime && CBZ.cityCrime(28, { x: p.pos.x, z: p.pos.z, type: "vehicular-assault" });
            else CBZ.cityCrime && CBZ.cityCrime(15, { x: p.pos.x, z: p.pos.z, type: "reckless" });
          } else if (car.npcDriver && CBZ.cityNpcOffense) CBZ.cityNpcOffense(car.npcDriver, 22, "vehicular-assault");
        }
        if (CBZ.shake) CBZ.shake((car.player ? 0.2 : 0.12) + Math.min(0.7, vmag * 0.025));
        // ---- THE THUNK (CBZ.runoverJuice, once per call, clean lethal only) ----
        // Make a kill-at-speed read as WEIGHT, matching melee's land(). A car
        // that mows a whole line still thunks exactly once (the `juiced` latch).
        if (lethal && CBZ.runoverJuice && !juiced) {
          juiced = true;
          // TINY, speed-scaled, hard-capped hit-stop. Base ~0.038s so even at
          // 5 FPS it's a single near-frozen frame (loop.js drains by the clamped
          // 0.05 world dt); never above 0.05 so it can't eat an input sample.
          // doHitstop() is Math.max-merged in loop.js, so the per-call latch +
          // this cap together guarantee it can't compound across bodies/frames.
          if (CBZ.doHitstop) CBZ.doHitstop(Math.min(0.05, 0.034 + vmag * 0.0009));
          // BASS-HEAVY impact voice, speed-scaled, camera-distance attenuated so
          // a far kill is quieter (dist convention used elsewhere in this file).
          // `ko` is the layered heavy-punch + low-pitched thud_real (the bass).
          if (CBZ.sfx) {
            const cm = CBZ.camera && CBZ.camera.position;
            const dist = cm ? Math.hypot(car.pos.x - cm.x, car.pos.z - cm.z) : 0;
            const hard = vmag >= CRASH.carHard;            // a normal-speed-or-faster kill
            const vol = Math.min(1, 0.62 + vmag * 0.012);  // louder the faster you hit
            // pitch DOWN slightly with speed → more bass/body on a heavy impact
            const pitch = Math.max(0.84, 1.02 - vmag * 0.006);
            CBZ.sfx("ko", { dist: dist, volume: vol, pitch: pitch });
          }
        }
        // one-frame car "catch": a lethal kill bleeds a touch more speed when
        // juiced so the car visibly hooks on the body (today: *=0.9). Floored at
        // *=0.82 so a determined player still plows THROUGH a crowd — we never
        // strand the car, never zero v (that would change driving logic).
        const lethalBleed = (CBZ.runoverJuice && car.player) ? 0.84 : 0.9;
        car.v *= vmag >= CRASH.pedLethal ? lethalBleed : 0.72;
      }
    }
    // mow down the ambient instanced crowd (the far NPCs) — player car only so
    // the kill is attributed to you, not to NPC drivers. Fast impacts are lethal.
    if (car.player && vmag >= CRASH.pedLethal && CBZ.cityCrowdCircleKill) {
      const n = CBZ.cityCrowdCircleKill(car.pos.x, car.pos.z, 2.0, { byCar: true, fromX: car.pos.x, fromZ: car.pos.z });
      if (n > 0 && CBZ.shake) CBZ.shake(0.25 + Math.min(0.5, vmag * 0.02));
      // same THUNK for plowing the ambient crowd (shares the per-call `juiced`
      // latch so a kill that already thunked above doesn't double-fire). Note:
      // cityCrowdCircleKill already plays a "ko" voice (crowd.js) — we only add
      // the missing hit-stop here, never a second bass voice, to avoid stacking.
      if (n > 0 && CBZ.runoverJuice && !juiced) {
        juiced = true;
        if (CBZ.doHitstop) CBZ.doHitstop(Math.min(0.05, 0.034 + vmag * 0.0009));
      }
    }
    // ---- WILDLIFE. OWNER: "they ... don't get hit by cars." They could not:
    // every loop in this function walks CBZ.cityPeds / the ambient crowd /
    // CBZ.cityCops, and animals live in a fourth list (CBZ.cityWildlife) that
    // nothing here had ever heard of — so a truck through a herd of elk was a
    // no-event for both parties. This is that loop, and it is deliberately the
    // ONLY thing this wave adds to this file: the damage MODEL (mass-scaled
    // lethal speed, energy going as v², the launch direction, the herd panic)
    // lives in wildlife.js where the species is, exactly as the ped kill lives
    // in cityKillPed. Same cheap squared-distance reject and the same
    // per-victim cooldown latch as the peds loop above, so the cost of a car
    // that hits nothing is one distance test per nearby animal.
    // AND IT IS BOUNDED. CBZ.cityWildlife is ~850 long — an order of magnitude
    // more than anything else this function walks — and runOver already runs
    // for every moving car in the world. A third full-length sweep per car per
    // frame is exactly how a surgical loop becomes a frame-rate bug, so only
    // cars near the camera sweep it. Nothing is lost: an animal struck by a car
    // nobody is within 240u of is a tree falling in a forest, and wildlife.js
    // has LOD-frozen it out of the simulation at that range anyway.
    const _wcam = CBZ.camera && CBZ.camera.position;
    const _wdx = _wcam ? car.pos.x - _wcam.x : 0, _wdz = _wcam ? car.pos.z - _wcam.z : 0;
    if (CBZ.cityWildlife && CBZ.cityWildlifeCarHit &&
        (!_wcam || _wdx * _wdx + _wdz * _wdz < 240 * 240)) {
      const wl = CBZ.cityWildlife;
      for (let wi = 0; wi < wl.length; wi++) {
        const an = wl[wi];
        if (!an || an.dead || an.ridden || !an.pos) continue;
        const adx = an.pos.x - car.pos.x, adz = an.pos.z - car.pos.z;
        // a bull moose is a wider target than a rabbit — the reach scales with
        // the animal, which is the only species-aware number in this loop and
        // it comes off the species' own `scale`.
        const rr = 1.55 + ((an.species && an.species.scale) || 1) * 0.75;
        if (adx * adx + adz * adz > rr * rr) continue;
        if ((an._carHitUntil || 0) > (CBZ.now || 0)) continue;
        an._carHitUntil = (CBZ.now || 0) + 850;
        const hitDmg = CBZ.cityWildlifeCarHit(an, {
          v: vmag, vx: car.vx, vz: car.vz, lethal: CRASH.pedLethal,
          fromX: car.pos.x, fromZ: car.pos.z,
          by: car.player ? null : (car.npcDriver || null),
        });
        if (hitDmg > 0) {
          if (CBZ.shake) CBZ.shake((car.player ? 0.18 : 0.1) + Math.min(0.6, vmag * 0.02));
          // the car HOOKS on the body, scaled by what it hit — clipping a hare
          // must not stop a truck, and a bison must not feel like a traffic cone.
          car.v *= Math.max(0.7, 1 - Math.min(0.3, ((an.species && an.species.scale) || 1) * 0.12));
        }
      }
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
    car.vx = Math.sin(car.heading) * car.v; car.vz = Math.cos(car.heading) * car.v;
    car.pos.x += car.vx * dt; car.pos.z += car.vz * dt;
    const before = car.pos.x, beforeZ = car.pos.z;
    const pushed = collideVehicle(car);
    // a PIT-chaser that clips a wall/roadblock mid-ram now actually loses
    // control instead of silently absorbing the push-back: this is a real
    // high-stakes state (a ram, by definition, is driven flat-out and reckless)
    // so it earns the same slip-capable response a wrecked car gets — a glance
    // off a corner kicks real lateral momentum into vx/vz, then aiSlipStep
    // bleeds it off by surface grip over the following frames instead of the
    // car just snapping back onto its beeline next frame.
    if (pushed > 0.04 && car.v > 7) {
      const nx = before - car.pos.x, nz = beforeZ - car.pos.z, nl = Math.hypot(nx, nz) || 1;
      const kick = Math.min(car.v * 0.5, 6);
      car.vx += (nx / nl) * kick; car.vz += (nz / nl) * kick;
      car.spin = (car.spin || 0) + (rng() - 0.5) * Math.min(2.2, car.v * 0.12);
    }
    aiSlipStep(car, dt, 6);   // decays any slide; keeps car.v/vx/vz consistent (no-op when undisturbed)
    if (arena) arena.clampToCity(car.pos, wallRadius(car));
    seatCar(car, dt);
    if (car.v > 6) runOver(car, car.v);
    setBrake(car, false);                 // a rammer is flat on the throttle
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
      else if (CBZ.city) CBZ.city.note("Hold still to chop this " + (car.model ? car.model.name : "car") + "…", 0.5);
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
  // FAR-CAR LOD: full traffic AI is costly per car — world-collision raycasts
  // against ~1000 colliders AND a scan of every ped to brake for. A car BEYOND
  // the render-visibility cull (the player literally can't see it) doesn't need
  // that every frame, so we step it on a 1-in-3 stride with accumulated dt;
  // its straight-line motion stays continuous and it snaps back to full-rate
  // simulation the instant it matters (turning, wrecked, wanted, fleeing, or
  // back on screen). This is the single biggest CPU saving in the traffic loop.
  let _vframe = 0, _vslice = 0;
  const FARCAR_D2 = 150 * 150;     // == the group-visibility cull distance below

  // ---- CAR-AHEAD broad phase (the O(n²) killer) -----------------------------
  // carAhead() below is the traffic loop's hot path: it scans the ENTIRE car
  // list once (sometimes twice) PER car, PER frame, to find the nearest vehicle
  // in that driver's path. With ~66 ambient cars + parked/cop/player cars that's
  // a few thousand pair tests every frame on the average — and a single-frame
  // SPIKE when a light releases a cluster and every car simultaneously runs at
  // full rate (the far-car LOD stride below stops hiding the cost). Mirroring
  // peds.js / crowd.js, we rebuild ONE spatial hash of the cars per frame
  // (CBZ.makeGrid, alloc-free after warm-up) and let carAhead inspect only the
  // cells its speed-scaled lookahead actually reaches. The cars near a clustered
  // light are genuinely close (the grid can't conjure them apart), but every car
  // on a DIFFERENT block — the bulk of the list — is skipped, which is what
  // turns the all-pairs spike back into a local scan.
  //
  // CORRECTNESS: the grid only chooses the CANDIDATE set (bucketed from this
  // frame's start positions). The gap / along / lateral math in carAhead still
  // reads each candidate's LIVE o.pos exactly as the old full scan did, so the
  // steering decision is byte-identical. A car moves <~0.6m in one 60fps frame —
  // far less than the cell-quantised padding of the query box below — so a car
  // that should be a candidate can never have slipped out of the queried cells.
  // Reverse the flag and carAhead falls straight back to the original full scan.
  const CARAHEAD_GRID = true;      // default ON (proven peds/crowd pattern; candidate-complete)
  const CAR_AHEAD_CELL = 12;       // cell ≈ a couple of car lengths; query pads to cover `look`
  let _carGrid = null;
  function _carVec(c) { return c.pos; }
  function rebuildCarGrid() {
    if (!CARAHEAD_GRID) return;
    if (!_carGrid && CBZ.makeGrid) _carGrid = CBZ.makeGrid(CAR_AHEAD_CELL);
    if (!_carGrid) return;
    // bucket EVERY car carAhead would otherwise scan — including the player's
    // car and parked/stolen/cop cars (carAhead treats them all as obstacles).
    // Dead cars are skipped inside carAhead, so bucketing them is harmless, but
    // we drop them here too so the cells stay small.
    _carGrid.rebuild(CBZ.cityCars, _carVec);
  }

  CBZ.onUpdate(37, function (dt) {
    if (g.mode !== "city") return;
    const A = CBZ.city.arena; if (!A) return;
    const baseDt = dt;
    const camx = CBZ.camera.position.x, camz = CBZ.camera.position.z;
    _vframe++;
    rebuildCarGrid();   // ONE rebuild per frame; carAhead queries it per car
    for (const c of CBZ.cityCars) {
      dt = baseDt;     // reset each car (a strided far car overrides this below)
      /* A CHAINED-DOWN LOAD HAS NO GROUND UNDER IT. This pass runs at 37 and
         vehicle_hold.js writes strapped freight at 12.7, so anything this loop
         does to a latched car is the LAST word — and what it does to a car with
         no `road` is parkSeat(), which re-seats it on the TERRAIN. Measured
         before the guard: a car driven into a trailer sat on the tarmac under
         the truck for exactly as long as the truck stood still, and slid along
         the road when it moved. `_heldBy` is the hold's own back-pointer, so
         there is nothing to keep in sync. */
      if (c._heldBy) continue;
      if (c.player || c.dead || !c.ai || !c.road) {
        if (!c.player && !c.dead) {
          // settled = parkSeat's own cache says nothing moved since last frame.
          // A settled parked car 60m+ from the camera is completely inert, so
          // its ~20-node subtree keeps last frame's world matrices — stamp it
          // and core/matrixskip.js skips the recompose (this was most of the
          // car half of the render matrix walk: parked cars vastly outnumber
          // traffic). Near cars stay live for door/entry/impact animation.
          const settled = c._parkX === c.pos.x && c._parkZ === c.pos.z && c._parkH === c.heading;
          parkSeat(c);
          if (settled && CBZ.CONFIG.CAR_MATRIX_HOLD !== false && c.group) {
            const pdx = c.pos.x - camx, pdz = c.pos.z - camz;
            if (pdx * pdx + pdz * pdz > 3600) c.group._cbzMatrixOwnedFrame = CBZ._matrixOwnStamp;
          }
        }
        continue;
      }
      // off-screen, non-critical cars: skip 2 of every 3 frames, banking dt so
      // they still cover the same ground when they do tick.
      const _cdx = c.pos.x - camx, _cdz = c.pos.z - camz;
      // a DEAD driver at the wheel must be handled EVERY frame (eject + wreck), or
      // the far-car LOD skip below ghost-drives the corpse until its slice comes up.
      const _critical = c.turning || c.wreckT > 0 || (c.npcWanted | 0) >= 1 || c.pullover || c.roadRageTarget || c.abandoned || (c.npcDriver && c.npcDriver.dead);
      if (!_critical && (_cdx * _cdx + _cdz * _cdz) > FARCAR_D2) {
        if (c._vsl == null) c._vsl = (_vslice++ & 3);
        c._acc = (c._acc || 0) + baseDt;
        // PERF: default far-car stride is 3 (unchanged at Balanced+); Fastest/Fast
        // skip far cars even more often — same reasoning as the ped move() throttle
        // above, invisible traffic doesn't need per-frame simulation.
        const _q = CBZ.qualityLevel == null ? 4 : CBZ.qualityLevel;
        const farStride = _q === 0 ? 6 : _q === 1 ? 4 : 3;
        if ((_vframe + c._vsl) % farStride !== 0) {
          // NOTHING about this car changes on a skipped frame — the stride
          // above is the guarantee — so its ~20-node subtree's world matrices
          // are still exactly right. Stamp it so core/matrixskip.js skips the
          // recompose too (the stamp expires next frame by construction; the
          // frame the car actually ticks it moves and is left unstamped).
          // ?cfg_CAR_MATRIX_HOLD=0 reverts.
          if (CBZ.CONFIG.CAR_MATRIX_HOLD !== false && c.group) c.group._cbzMatrixOwnedFrame = CBZ._matrixOwnStamp;
          continue;     // skipped this frame
        }
        dt = c._acc; c._acc = 0;                         // catch-up step
      }
      // DRIVER SHOT DEAD AT THE WHEEL (cops / gunfire): drop the body out and let
      // the now-driverless car careen to a stop — no more ghost-driving a corpse.
      if (c.npcDriver && c.npcDriver.dead) {
        ejectNpcDriver(c);
        c.abandoned = true; c.npcWanted = 0; c.stolen = false; c.roadRageTarget = null; c.roadRageT = 0; c.pullover = 0;
        c.wreckT = Math.max(c.wreckT || 0, 1.1);
      }
      // WRECKED (just crashed): spin out off-rails and coast to a stop, then
      // recover and drive on — skips all lane-keeping so the crash actually reads.
      // SLIP-CAPABLE: a hard hit already left real sideways momentum in c.vx/vz
      // (setCrashVelocity, offRails=true) that the OLD code threw away every
      // frame by re-deriving motion purely from the scalar c.v along c.heading
      // — a spin-out could never actually carry a slide. aiSlipStep (the same
      // lightweight grip/slip shape the player uses, trimmed for an
      // uncontrolled car) now decays that real lateral momentum against
      // whatever surface it's sliding across instead of discarding it, so a
      // PIT/T-bone genuinely skids before it settles, not just curves.
      if (c.wreckT > 0) {
        setBrake(c, false);               // nobody's on the pedal mid-spin
        c.wreckT -= dt;
        c.v *= Math.pow(0.04, dt);
        if (c.vx != null) { c.vx *= Math.pow(0.04, dt); c.vz *= Math.pow(0.04, dt); }
        c.spin = (c.spin || 0) * Math.pow(0.25, dt);
        c.heading += c.spin * dt;
        aiSlipStep(c, dt, 5.5);           // bleeds lateral slip by surface grip; rewrites c.vx/vz/v
        c.pos.x += c.vx * dt; c.pos.z += c.vz * dt;
        const pushed = collideVehicle(c);
        if (A.clampToCity) A.clampToCity(c.pos, wallRadius(c));
        // CARS_NO_WATER: a spun-out AI car that slides past a region gap onto
        // open water doesn't float at y=0 forever — it drowns where it stopped.
        if ((!CBZ.CONFIG || CBZ.CONFIG.CARS_NO_WATER !== false) && overWater(c.pos.x, c.pos.z)) {
          c.dead = true; c.abandoned = true; c.ai = false;
          if (c.npcDriver) ejectNpcDriver(c);
          seatCar(c, dt, -1.1, false);
          continue;
        }
        // slammed a building / lamppost mid-spin: crumple the car (the structure
        // only sheds some glass), and a fast hit kills whoever's driving.
        if (pushed > 0.05 && c.v > 11) {
          const catastrophic = c.v >= CRASH.npcDriverLethal, hard = c.v >= CRASH.wallHard;
          crumpleCar(c, catastrophic ? 0.7 : (hard ? 0.42 : 0.16), { x: -Math.sin(c.heading), z: -Math.cos(c.heading) });
          if (CBZ.cityCarImpact) {
            const fx = Math.sin(c.heading), fz = Math.cos(c.heading), vd = vehicleDims(c);
            CBZ.cityCarImpact(c, { x: c.pos.x + fx * vd.length * 0.45, y: (vd.height || 1.5) * 0.4, z: c.pos.z + fz * vd.length * 0.45 }, { x: -fx, y: 0, z: -fz }, c.v);
          }
          // speed-scaled (NHTSA/IIHS ladder): a slow scrape barely dents the
          // motor, only a fast slam disables it — and never an instant fireball
          // (damageEngine routes the crash through the burn fuse).
          damageEngine(c, catastrophic ? (50 + (c.v - CRASH.npcDriverLethal) * 3)
                          : hard ? (24 + (c.v - CRASH.wallHard) * 2)
                          : Math.max(0, (c.v - 5) * 0.6), false);
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
        seatCar(c, dt);
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
        let tv = Math.min(c.baseV, c.reckless ? 11 : 8);   // ease off to corner
        // yield mid-arc: don't sweep the turn into a car crossing the box
        const blk = carAhead(c);
        if (blk && blk.gap < 5) tv = Math.min(tv, Math.max(0.8, blk.v * 0.5));
        c.v += Math.max(-20 * dt, Math.min(12 * dt, tv - c.v));
        c.v = Math.max(0.8, c.v);
        advanceTurn(c, dt);
        seatCar(c, dt);
        if (c.v > 9 && (c.reckless || c.pullover === 4)) runOver(c, c.v);
        const tdx = c.pos.x - CBZ.camera.position.x, tdz = c.pos.z - CBZ.camera.position.z;
        c.group.visible = (tdx * tdx + tdz * tdz) < 150 * 150;
        setBrake(c, c.group.visible && tv < c.v - 0.4);   // easing off into the corner
        continue;
      }
      const r = c.road;

      // ---- desired speed: cruise, modulated by lights, following, stops ----
      let target = c.baseV;
      // IDM_V2 collects the frame's most restrictive constraint as an
      // ACCELERATION rather than as a speed cap (see the block above idmAccel).
      // Each hazard below folds its own virtual-leader term in with Math.min;
      // the FREE-ROAD term is evaluated last, at the integrator, because the
      // desired speed itself can still change (a car that starts fleeing wants
      // to exceed its cruise, and a free term pinned to cruise would cap it).
      const useIdm = IDM_ON();
      let idmA = 1e9;                    // most restrictive hazard so far
      let idmDesired = c.baseV;          // v0 for the free-road term

      // red-light stop (calm drivers; the reckless gamble on it). HIGHWAY +
      // arterial roads (the new mini-city/island network) have NO city-grid
      // intersection, so nearestIntersection can return null — treat that as
      // "no signal ahead" (open highway) instead of dereferencing undefined.
      const it = A.nearestIntersection(c.pos.x, c.pos.z);
      const distToInt = !it ? 1e9 : (r.vertical ? (it.z - c.pos.z) * c.dirSign : (it.x - c.pos.x) * c.dirSign);
      const red = CBZ.cityIsRed(r.vertical);
      const stopGap = TR().stopGap || 6.5;
      const redLookahead = stopGap + 5 + Math.min(11, c.v * 0.75);
      // calm drivers ANTICIPATE the red — ease to a smooth stop at the line from
      // further out (reads clearly as obeying the signal). Reckless ones gamble.
      // WHERE THE STOP LINE ACTUALLY IS. `distToInt` is measured to the
      // junction's CENTRE, and 1.6 m short of a centre is ~7.4 m INSIDE an 18 m
      // box — cars were halting in the middle of the crossing. Nobody noticed
      // while a junction was an unmarked square; now that props.js paints a
      // real stop bar and crosswalk there, the paint said one thing and the
      // traffic did another. Derived from the junction's own geometry (half
      // widths + corner return + crosswalk + the MUTCD 1.2 m setback), so it
      // is right on an 18 m street and a 12 m town lane without a second
      // number. Degrade-safe: no junction record, or the street work reverted,
      // and it falls back to the old 1.6.
      let stopBack = 1.6;
      if (CBZ.roadJunctionAt) {
        try {
          const J = CBZ.roadJunctionAt(it.x, it.z);
          if (J) {
            const h = r.vertical ? J.hb : J.ha;
            const xw = Math.max(1.8, Math.min(3.0, 0.16 * 2 * (r.vertical ? J.ha : J.hb)));
            stopBack = h + 0.6 + xw + 1.2;
          }
        } catch (e) {}
      }
      if (red && distToInt > 1.2 && distToInt < redLookahead) {
        if (!c.reckless || c.driver.aggr < 0.8) {
          target = Math.min(target, Math.max(0, (distToInt - stopBack) * 1.25));
          // IDM_V2: a red light is a STATIONARY VIRTUAL LEADER parked on the
          // stop line. This is the textbook treatment (SUMO does exactly this)
          // and it is strictly better than the linear speed ramp above,
          // because the same equation that makes a car follow smoothly now
          // makes it ARRIVE smoothly — decelerating hard while far and fast,
          // easing off as it settles, instead of tracking a ruler-straight
          // ramp down to the line.
          if (useIdm) idmA = Math.min(idmA, idmAccel(c.v, Math.max(0.5, c.baseV), Math.max(0.4, distToInt - stopBack), c.v, c));
        }
      }

      // Car-following. THE LEADER GAP AND CLOSING RATE ARE THE SAME TWO
      // NUMBERS EITHER WAY — what changed is what we do with them (see
      // idmAccel). The legacy arm is the original speed-cap heuristic; it
      // braked on a threshold (`gap < follow`) and so did nothing at all until
      // the gap was already short, which is what produced the concertina of
      // cars alternately coasting and stamping on the brakes. IDM's braking
      // term is continuous — it is always a little bit on — so a queue
      // compresses and releases smoothly and stop-and-go waves damp out
      // instead of amplifying.
      const ahead = carAhead(c);
      if (ahead) {
        const gap = ahead.gap;
        if (useIdm) {
          idmA = Math.min(idmA, idmAccel(c.v, Math.max(0.5, c.baseV), Math.max(0.3, gap), c.v - ahead.v, c));
        } else {
          const staticGap = Math.max(2.4, (TR().follow || 8) * 0.45);
          const headway = c.reckless ? 0.3 : (c.driver.aggr < 0.25 ? 0.9 : 0.62);
          const follow = staticGap + c.v * headway;
          if (gap < follow) target = Math.min(target, Math.max(0, ahead.v * (gap < follow * 0.4 ? 0.3 : 0.85)));
        }
      }

      // a signalled pull-over: comply (stop) unless fleeing
      if (c.pullover === 1) { if (c.driver.aggr >= 0.6 || c.npcWanted >= 1) { startFlee(c); } else { c.pullover = 2; } }
      if (c.pullover === 2 || c.pullover === 3) {
        target = 0;
        const enf = copNear(c.pos.x, c.pos.z, 7);
        if (enf) { c.pullover = 3; c.stopT += dt; if (c.stopT > 3) { c.pullover = 0; c.stopT = 0; CBZ.city && CBZ.city.note("" + (c.model ? c.model.name : "Driver") + " ticketed", 0.8); } }
        else { c.stopT += dt; if (c.stopT > 6) { c.pullover = 0; c.stopT = 0; } }   // no cop showed — drive on
      }
      if (c.pullover === 4) {
        target = c.baseV * 1.15; idmDesired = target;              // fleeing flat-out
        c.fleeT -= dt;
        if (c.fleeT <= 0) { c.pullover = 0; c.npcWanted = 0; c.stopT = 0; }   // lost them
      }

      // PEDESTRIANS: a normal driver brakes for someone in their lane ahead; a
      // RECKLESS one (the aggression stat maxed out) keeps their foot down and
      // mows them over — the personality spectrum's extreme is a maniac.
      if ((!c.reckless || c.driver.aggr < 0.8) && c.pullover !== 4) {
        const fwx = r.vertical ? 0 : c.dirSign, fwz = r.vertical ? c.dirSign : 0;
        const pedLookahead = Math.min(19, 7 + c.v * 0.7);
        const dangerGap = 2.5 + c.v * 0.22;
        let brake = 0;
        brakeAt = 1e9;                       // distance to the nearest body in lane
        for (let i = 0; i < CBZ.cityPeds.length && brake < 1; i++) {
          const p = CBZ.cityPeds[i]; if (p.dead || p.inCar) continue;
          const dx = p.pos.x - c.pos.x, dz = p.pos.z - c.pos.z, ah = dx * fwx + dz * fwz;
          if (ah > 0.5 && ah < pedLookahead && Math.abs(dx * -fwz + dz * fwx) < 2.0) {
            brake = ah < dangerGap ? 1 : Math.max(brake, 0.5);
            if (ah < brakeAt) brakeAt = ah;
          }
        }
        if (brake < 1 && !CBZ.player.driving && !CBZ.player.dead) {
          const dx = CBZ.player.pos.x - c.pos.x, dz = CBZ.player.pos.z - c.pos.z, ah = dx * fwx + dz * fwz;
          if (ah > 0.5 && ah < pedLookahead && Math.abs(dx * -fwz + dz * fwx) < 2.0) {
            brake = ah < dangerGap ? 1 : Math.max(brake, 0.5);
            if (ah < brakeAt) brakeAt = ah;
          }
        }
        if (brake >= 1) target = 0; else if (brake > 0) target = Math.min(target, c.v * 0.3);
        // IDM_V2: the person in the road is a third virtual leader, at the
        // distance they actually are. `brakeAt` is set alongside `brake` above.
        if (useIdm && brake > 0 && brakeAt < 1e8) {
          idmA = Math.min(idmA, idmAccel(c.v, Math.max(0.5, c.baseV), Math.max(0.3, brakeAt - 1.4), c.v, c));
        }
      }

      // ---- THE INTEGRATOR ---------------------------------------------------
      // Legacy: a symmetric clamp toward `target` — a bang-bang controller that
      // is either flat out or flat off, which is most of why traffic read as
      // robotic.
      // IDM_V2: BALLISTIC integration — v' = v + a·dt, then advance by the
      // AVERAGE of the old and new speed rather than by either one. This is not
      // a nicety: naive Euler under-integrates every braking step and leaves a
      // residual jitter that gets worse as the frame rate drops, and the
      // trapezoidal form costs one extra add. It is also what every serious
      // traffic simulator uses (SUMO included) in preference to both Euler and
      // RK4 — RK4's higher order buys nothing across the discrete events (lane
      // changes, turns) that a driving sim is full of.
      const vPrev = c.v;
      if (useIdm) {
        // THE FREE-ROAD TERM, evaluated now that the desired speed is final,
        // then the scariest hazard wins. This is just "obey whichever of the
        // open road, the leader, the red light and the body in the road gives
        // you the least acceleration".
        const acc = Math.min(idmA, idmAccel(c.v, Math.max(0.5, idmDesired), 1e6, 0, c));
        c.v = Math.max(0, c.v + acc * dt);
        // hard caps still win: a pull-over that says STOP means stop, and no
        // driver exceeds what the lights/peds block computed for them.
        if (target <= 0.05) c.v = Math.max(0, Math.min(c.v, vPrev - IDM.bMax * dt));
        else if (c.v > target) c.v = Math.max(target, vPrev - IDM.bMax * dt);
      } else {
        const accel = (target > c.v ? 12 : 22) * (c.reckless ? 1.3 : 1);
        c.v += Math.max(-accel * dt, Math.min(accel * dt, target - c.v));
        c.v = Math.max(0, c.v);
      }

      // ---- JUNCTION DEADLOCK VALVE -----------------------------------------
      // The one failure class every source on traffic AI agrees is real and
      // that no shipped game has published a fix for: two cars each waiting for
      // the other inside a box, forever. A car that has been stopped INSIDE an
      // intersection long enough to be a bug rather than a queue is granted
      // right of way and forced to move. Cheap, unconditional, and it can only
      // ever unstick — it never creates a stop.
      if (c.v < 0.35 && distToInt > -14 && distToInt < 14) {
        c._jamT = (c._jamT || 0) + dt;
        if (c._jamT > 6) { c.v = Math.max(c.v, 2.2); c._mustTurn = true; c._jamT = 0; }
      } else if (c._jamT) c._jamT = 0;

      // ---- advance along the road ----
      const moveAxisZ = r.vertical;
      // ballistic position update: average of the two speeds across the step
      const vAdv = useIdm ? (vPrev + c.v) * 0.5 : c.v;
      if (moveAxisZ) c.pos.z += c.dirSign * vAdv * dt; else c.pos.x += c.dirSign * vAdv * dt;

      // lane-keeping: EASE toward the lane line instead of pinning to it, so a
      // lane flip (overtake, U-turn, post-crash recovery) reads as a real
      // steered swerve, not a 4-metre sideways teleport. Reckless drivers WEAVE
      // (drunk/aggressive sway) within the lane so they read as bad drivers.
      const swayAmp = c.reckless ? 0.85 : 0;
      let phaseRate = 0;
      if (swayAmp) { phaseRate = (1.6 + (c.driver.aggr - 0.6) * 1.4); c.swayPhase = (c.swayPhase || rng() * 6) + dt * phaseRate; }
      const sway = swayAmp ? Math.sin(c.swayPhase) * swayAmp : 0;
      const latNow = moveAxisZ ? c.pos.x - r.x : c.pos.z - r.z;
      // KEEP RIGHT as the baseline (lane-recover-right): a CALM, non-deviating
      // car whose lane offset somehow ended up on the WRONG side of the centre-
      // line (sign of c.lane ≠ sign of c.dirSign — e.g. a botched turn/U-turn
      // restore left it crossed over) is snapped back onto its proper right-hand
      // lane. We do NOT touch a car that is deliberately deviating — reckless
      // weavers, an active road-rage pass (_rageT, including the reckless
      // oncoming chicken-pass), a car mid-turn, or one pulling over — those OWN
      // their lane this frame. WHY: right-hand driving is the law of the road;
      // recklessness is the deviation ON TOP, not the default.
      if (!c.reckless && (c._rageT || 0) <= 0 && !c.turning && !c.pullover && !c.roadRageTarget) {
        const want = laneOffset(r, c.dirSign, c.laneIdx != null ? c.laneIdx : 0);
        if (c.lane * want < 0 || Math.abs(c.lane) < 0.2) c.lane = want;   // crossed over (or zeroed) → back to the right
      }
      const latWant = c.lane + sway;
      // faster car corrects faster. A calm (non-weaving) car corrects MORE
      // briskly so a recovered/crossed lane is reclaimed promptly instead of
      // drifting; reckless cars keep the gentler rate so their weave still reads.
      const latRate = c.reckless ? (1.6 + Math.abs(c.v) * 0.24) : (2.2 + Math.abs(c.v) * 0.3);
      const lat = latNow + Math.max(-latRate * dt, Math.min(latRate * dt, latWant - latNow));
      if (moveAxisZ) c.pos.x = r.x + lat; else c.pos.z = r.z + lat;

      // heading follows the ACTUAL motion (forward + lateral correction), so the
      // nose visibly steers through lane changes and weaves instead of crabbing
      const dlat = dt > 0.0001 ? (lat - latNow) / dt : 0;
      const dalong = c.dirSign * Math.max(2, c.v);
      c.heading = moveAxisZ ? Math.atan2(dlat, dalong) : Math.atan2(dalong, dlat);

      // crossing the intersection: ran-a-red check + ONE committed route choice
      // per box (the old per-frame coin-flip re-rolled every frame a car sat in
      // the intersection — most cars turned at almost every corner, so traffic
      // read as aimless wandering instead of people going somewhere).
      const insideInt = it != null && Math.abs(c.pos.x - it.x) < A.ROAD / 2 + 0.5 && Math.abs(c.pos.z - it.z) < A.ROAD / 2 + 0.5;
      if (insideInt && red && c.ranRedCD <= 0 && c.v > 4) {
        c.ranRedCD = 3; ranRed(c);
      }
      if (insideInt && !c._intActive) {
        c._intActive = true;
        // METHOD (PROCGEN.md #4): purposeful routing, not a coin flip. Every
        // ambient car carries a destination intersection; at each box it
        // turns exactly when turning reduces the remaining Manhattan
        // distance (the grid staircase citynav uses for peds). On arrival it
        // picks a fresh destination and drives on — traffic goes SOMEWHERE.
        if (c.destX == null || (Math.abs(c.destX - it.x) < 30 && Math.abs(c.destZ - it.z) < 30)) pickCarDest(c, A);
        const ddx = c.destX - it.x, ddz = c.destZ - it.z;
        const wantV = Math.abs(ddz) > Math.abs(ddx);
        let wantTurn = false, prefDir = null;
        if (wantV !== c.vertical) {
          wantTurn = true;
          prefDir = wantV ? (ddz > 0 ? 1 : -1) : (ddx > 0 ? 1 : -1);
        } else {
          // right axis, wrong way → turn off toward the larger cross
          // component (two staircase turns flip a grid car around)
          const alongSign = (c.vertical ? ddz : ddx) >= 0 ? 1 : -1;
          if (alongSign !== c.dirSign) {
            wantTurn = true;
            prefDir = c.vertical ? (ddx > 0 ? 1 : -1) : (ddz > 0 ? 1 : -1);
          }
        }
        if (c.v > 1 && (c._mustTurn || (c.turnCD <= 0 && wantTurn))) {
          beginTurn(c, it, A, prefDir);
          if (c.turning) c._mustTurn = false;
        }
      } else if (!insideInt && c._intActive) c._intActive = false;

      // approaching the end of the road: commit to turning off at the next
      // intersection; if there is none left, U-TURN at the dead end (swing into
      // the opposite lane and head back) — never teleport-wrap across the map.
      const lim = r.len / 2 - 2;
      const along = moveAxisZ ? (c.pos.z - r.z) * c.dirSign : (c.pos.x - r.x) * c.dirSign;
      if (lim - along < 26) c._mustTurn = true;
      if (along > lim) {
        c.dirSign *= -1;
        c.lane = -c.lane;                       // back onto the right-hand side
        c.heading = moveAxisZ ? (c.dirSign > 0 ? 0 : Math.PI) : (c.dirSign > 0 ? Math.PI / 2 : -Math.PI / 2);
        c.v = Math.min(c.v, 4);                 // a U-turn is taken slow
        c._mustTurn = false;
      }

      // fleeing suspect caught: a cop right on it ends the chase
      if (c.pullover === 4) {
        const cop = copNear(c.pos.x, c.pos.z, 3.2);
        if (cop) busted(c);
      }

      // VEH_COLLIDE_FIX: walls are walls for AI traffic too. Ordinary lane-
      // following historically never consulted CBZ.colliders at all — the lane
      // math kept cars clear of buildings only as long as nothing (a botched
      // turn restore, a resolveCars shove, a prop dropped in the road) pushed
      // them off the centerline; then they clipped straight through geometry
      // with zero reaction. Near the camera (where it's visible) resolve the
      // hull like every driven car; a real push bleeds speed so the car reads
      // as having hit the thing, and the lane-keep above steers it back out.
      if ((!CBZ.CONFIG || CBZ.CONFIG.VEH_COLLIDE_FIX !== false) &&
          (_cdx * _cdx + _cdz * _cdz) < 110 * 110 && c.v > 0.5) {
        const pushedAI = collideVehicle(c);
        if (pushedAI > 0.04) c.v *= Math.max(0.25, 1 - pushedAI * 2);
      }

      // keep a carjacker's body riding with the car so cops chase the right spot
      seatCar(c, dt);
      // any moving car hits whoever's in front of it — calm drivers braked
      // above so they rarely connect; reckless ones plow straight through.
      if (c.v > 5) runOver(c, c.v);
      // simple distance cull: cars far from the camera stop drawing
      const cdx = c.pos.x - CBZ.camera.position.x, cdz = c.pos.z - CBZ.camera.position.z;
      c.group.visible = (cdx * cdx + cdz * cdz) < 150 * 150;
      // brake lights flare while the driver is shedding speed (red / queue /
      // ped ahead) or held stopped — only swapped for cars you can see.
      setBrake(c, c.group.visible && (target < c.v - 0.6 || (c.v < 0.45 && target < 0.6)));
    }
  });

  // nearest car directly ahead of `c` — scanned in c's OWN heading frame, so it
  // sees EVERYTHING in its path: the car it's following, cross traffic sweeping
  // the intersection, a car mid-turn, the player's dumped getaway car. The old
  // same-road-only check made drivers blind to anything not in their exact lane
  // record — they'd plow into crossing traffic and phase past parked obstacles.
  // carAhead's running best, shared by the grid scan and the full-scan fallback
  // so BOTH paths run byte-identical per-candidate math. _caTest(c,o,...) folds
  // one candidate `o` into the best-so-far and returns the new bumper gap.
  let _caBest = null, _caBg = 1e9, _caAlong = 0;
  function _caConsider(c, o, fx, fz, myHalf, look) {
    // `_husk` — a burnt-out wreck standing in the lane IS the car ahead. It is
    // `dead`, but traffic.js already knows what to do with a stationary
    // obstacle (its blockedT / `deadAhead` pull-around names exactly this
    // case), so letting the IDM see it is the whole fix — a queue forms, then
    // the queue goes round.
    if (o === c || (o.dead && !o._husk)) return;
    const dx = o.pos.x - c.pos.x, dz = o.pos.z - c.pos.z;   // LIVE pos (same as old full scan)
    const along = dx * fx + dz * fz;
    if (along <= 0 || along > look) return;
    const lat = Math.abs(dx * fz - dz * fx);
    if (lat > 2.3) return;
    const bumperGap = along - myHalf - vehicleDims(o).length * 0.5;
    if (bumperGap < _caBg) { _caBg = bumperGap; _caBest = o; _caAlong = along; }
  }
  function carAhead(c) {
    const fx = Math.sin(c.heading), fz = Math.cos(c.heading);
    const myHalf = vehicleDims(c).length * 0.5;
    const look = 8 + Math.abs(c.v) * 1.1;          // speed-scaled lookahead
    _caBest = null; _caBg = 1e9; _caAlong = 0;
    if (CARAHEAD_GRID && _carGrid) {
      // Visit only the cells the lookahead box can reach. Padding by `look` on
      // every side (floor/ceil over the radius — the standard variable-radius
      // hash query, same shape as CBZ.queryCollidersNear) guarantees we never
      // miss a candidate the old full scan would have found. A car only LOOKS
      // forward (along>0) but is bucketed by its centre, so a long obstacle
      // straddling a cell boundary just behind us must still be reachable — the
      // symmetric ±look box covers that with margin to spare.
      const gx0 = _carGrid.cellIndex(c.pos.x - look), gx1 = _carGrid.cellIndex(c.pos.x + look);
      const gz0 = _carGrid.cellIndex(c.pos.z - look), gz1 = _carGrid.cellIndex(c.pos.z + look);
      for (let gx = gx0; gx <= gx1; gx++) for (let gz = gz0; gz <= gz1; gz++) {
        const cell = _carGrid.bucket(gx, gz); if (!cell) continue;
        for (let i = 0; i < cell.length; i++) _caConsider(c, cell[i], fx, fz, myHalf, look);
      }
    } else {
      // fallback (flag OFF / grid unavailable): the original whole-list scan.
      const cars = CBZ.cityCars;
      for (let i = 0; i < cars.length; i++) _caConsider(c, cars[i], fx, fz, myHalf, look);
    }
    const best = _caBest;
    if (!best) return null;
    // how fast the obstacle is moving AWAY along our heading (crossing traffic
    // and oncoming cars project to ~0 → we brake instead of matching "speed")
    const ov = carVel(best);
    return { v: Math.max(0, ov.x * fx + ov.z * fz), gap: _caBg, car: best, along: _caAlong };
  }

  // a fresh errand for an ambient car: a random far-ish intersection —
  // destination-driven turning replaces the old aimless 38% coin flip.
  function pickCarDest(c, A) {
    const its = A.intersections;
    if (!its || !its.length) { c.destX = c.pos.x; c.destZ = c.pos.z; return; }
    let t = its[(rng() * its.length) | 0];
    // prefer somewhere actually worth driving to (2 tries for a far one)
    if (Math.hypot(t.x - c.pos.x, t.z - c.pos.z) < 90) t = its[(rng() * its.length) | 0];
    // ...and never AIM a car at a keep-out. The destination is what the
    // staircase router steers toward at every junction, so a destination
    // inside the airfield is a standing instruction to drive onto it.
    if (CBZ.roadPointOpen && !CBZ.roadPointOpen(t.x, t.z)) {
      for (let k = 0; k < 4; k++) {
        const t2 = its[(rng() * its.length) | 0];
        if (CBZ.roadPointOpen(t2.x, t2.z)) { t = t2; break; }
      }
    }
    c.destX = t.x; c.destZ = t.z;
  }

  // set up a smooth quarter-arc onto the perpendicular road. The arc is a
  // quadratic Bézier from the car's current lane position, through the corner
  // where the two lane centre-lines meet, out onto the new lane — so the car
  // sweeps the turn instead of teleporting + snapping its heading.
  function beginTurn(c, it, A, prefDir) {
    const wantVertical = !c.vertical;
    // pass the junction's ALONG coordinate too: roadCross needs both to prove
    // the segment it returns actually reaches this intersection.
    const road = findRoad(A, wantVertical, wantVertical ? it.x : it.z, wantVertical ? it.z : it.x);
    if (!road) return;
    let newDir = prefDir != null ? prefDir : (rng() < 0.5 ? 1 : -1);
    // don't turn INTO a dead end: if this direction runs out of road in a couple
    // of car lengths, take the other one (real drivers turn toward the city,
    // not the wall — and it kills the U-turn-right-after-turning read).
    const intAlong = wantVertical ? it.z - road.z : it.x - road.x;
    if (road.len / 2 - intAlong * newDir < 30) newDir = -newDir;
    // keep the car's lane INDEX through the turn → its offset on the new road.
    const idx = c.laneIdx != null ? c.laneIdx : 0;
    const newLane = laneOffset(road, newDir, idx);
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
  // Nearest perpendicular road at a junction. THE BUG THIS CARRIED FOR ITS
  // WHOLE LIFE: it matched purely on the cross coordinate and never checked
  // the junction actually lies ON the segment — so a downtown intersection at
  // x≈0 matched the AIRPORT CAUSEWAY record (x=0, vertical) hundreds of metres
  // south, the turning car adopted a road it was nowhere near, U-turned at the
  // "end" and drove the length of the airfield across runway 09/27. That is
  // the owner's "cars inside the airport near the runway", and it was never a
  // spawn. roadrules.js's CBZ.roadCross is this query with the containment
  // test restored (and closed segments skipped); the `:` arm is the original.
  function findRoad(A, vertical, coord, along) {
    if (CBZ.roadCross && along != null) {
      return CBZ.roadCross(A, vertical, vertical ? coord : along, vertical ? along : coord);
    }
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
      else {
        c.pullover = 1;
        // only surface this ambient line when it's actually near the player AND
        // not more than once every several seconds (complements the feed cooldown).
        if (nearCam(c, 60) && (CBZ.now || 0) - _trafficStopNoteT > 6000) {
          _trafficStopNoteT = CBZ.now || 0;
          CBZ.city && CBZ.city.note("Traffic stop nearby", 0.8);
        }
      }
    }
  }
  function startFlee(c) {
    if (c.pullover === 4) return;
    c.pullover = 4; c.npcWanted = Math.max(1, c.npcWanted); c.fleeT = 12 + rng() * 6;
    CBZ.city && CBZ.city.note("" + (c.model ? c.model.name : "A driver") + " is fleeing the police!", 1.2);
    // register the fleeing driver as an NPC offender the cops will chase
    if (CBZ.cityRegisterCarSuspect) CBZ.cityRegisterCarSuspect(c);
  }
  function busted(c) {
    c.pullover = 0; c.npcWanted = 0; c.v = 0; c.baseV = Math.max(2, c.baseV * 0.5); c.reckless = false; c.driver.aggr = 0.2;
    if (c.npcDriver) { const ped = c.npcDriver; ejectNpcDriver(c); if (ped && CBZ.cityNpcArrest) CBZ.cityNpcArrest(ped); }
  }
  CBZ.cityVehiclesReset = function () {
    npcDrivers = 0;
    // the occupant budget is a LIVE count, not a save — a fresh run starts with
    // no rigged cars and no remembered jack tally.
    occRigCars = 0;
    occStat = { promoted: 0, claimed: 0, spawned: 0, jacks: 0, hostages: 0,
      react: { fight: 0, flee: 0, freeze: 0, beg: 0 } };
    if (CBZ.cityCarDeformReset) CBZ.cityCarDeformReset();   // pristine fleet on a fresh run
    if (CBZ.carAudio) CBZ.carAudio.stop();   // a fresh run never inherits an orphaned motor
    // wipe the rubber: a new run starts on clean asphalt (zeroed quads are degenerate = invisible)
    if (skidPosArr) { skidPosArr.fill(0); skidRing = 0; if (skidMesh) skidMesh.geometry.attributes.position.needsUpdate = true; }
    // retire any live smoke/flame sprites to the pool so a reset starts clean
    for (let i = _vparts.length - 1; i >= 0; i--) { _vparts[i].s.visible = false; _vpool.push(_vparts[i].s); }
    _vparts.length = 0;
  };
  // let police flag a car for a stop
  CBZ.cityCarPullover = function (c) { if (c && !c.player && c.pullover === 0) c.pullover = 1; };
})();
