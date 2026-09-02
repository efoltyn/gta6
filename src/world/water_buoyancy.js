/* ============================================================
   src/world/water_buoyancy.js — BOATS RIDE THE ACTUAL WAVES.

   city/vehicles.js floats a marine vehicle at a hardcoded constant
   (`WATER_Y = -0.12`, vehicles.js:99, applied at :2432) and never asks the
   water how high it is. The sea visibly rolls through +-0.42m of swell and the
   hull sails through it at a perfectly flat height, with no heave, no pitch and
   no roll — the single most obvious tell in the whole game the moment anyone
   takes a boat out, and it is exactly what a swimmer beside the boat does NOT
   do (city/swim.js has always read the real surface).

   This module fixes it WITHOUT editing vehicles.js: it runs as a post-pass at
   order 38.5 — after every vehicle updater in that file (11, 37, 37.6, 38) has
   finished writing `car.group.position` / `car.group.rotation` — and re-seats
   any marine hull that is currently over open water onto the live surface.

   HOW THE ATTITUDE IS DERIVED: not from the point slope under the origin (a
   10-metre hull does not follow a 3-metre ripple), but from four probes at the
   bow, stern and both beams. Their mean is the heave; their differences are
   the along-hull and across-hull gradients, i.e. pitch and roll filtered by
   the hull's own length — the same reason a long boat rides a chop more calmly
   than a dinghy, for free. Orientation is written as a quaternion built from
   the surface normal and the heading, then composed with vehicles.js's own
   squat/dive/lean so the acceleration feel it authors is preserved.

   THAT FOUR-PROBE SAMPLER NO LONGER LIVES HERE. It moved to
   world/water_float.js as CBZ.waterRideAt(x, z, {heading, len, beam}, out) —
   the shared float block that corpses, drowned wrecks and floating debris now
   ride too. It used to be private to this file, which is why nothing else in
   the game floated. What is left here is the BOAT POLICY: which hulls qualify,
   how high a boat sits, how planing flattens the ride, and how vehicles.js's
   own weight-transfer lean composes on top. Same numbers, same behaviour —
   only the maths is shared. If water_float.js is missing, the inline fallback
   below reproduces the original probes verbatim, so this file never breaks.

   Every query goes through CBZ.citySeaHeightAt / CBZ.citySeaSlopeAt, which
   world/water_spec.js guarantees is the identical summation the vertex shader
   displaces by — so the hull sits on the crest you can SEE.

   THE HULL SPEC (world/water_hulls.js) — added with the marine fleet
   ------------------------------------------------------------
   This file used to hardcode ONE boat: HULL_LEN 5.4 / HULL_BEAM 2.1 /
   RIDE_ABOVE_MEAN 0.36 / plane = min(1, spd/11). That was fine when there was
   exactly one hull in the game and wrong the moment there were four. It now
   reads `car._hullSpec` for the footprint, the ride height, the planing
   fraction and — the one that actually matters — the WAVE-SLOPE-FOLLOWING
   GAIN (research §C):

     a slow, heavy hull sits IN the water and follows the surface normal
     (gain ~1); a fast planing hull is stiff, springs back to its own trim and
     PLOUGHS through chop rather than surfing every ripple (gain low).

   So a 34m / 260-tonne yacht in a 0.4m swell barely moves (gain 0.22) and a
   4.5m RIB is thrown around by everything (gain 1.0), out of ONE number per
   hull applied to the four-probe sampler's existing output.

   DEGRADE-SAFE: with no `_hullSpec` present, every constant below falls back
   to the exact value it had before and the wave-gain arithmetic is SKIPPED
   entirely rather than multiplied by 1 — byte-identical behaviour.

   FLAG: CBZ.CONFIG.WATER_BUOYANCY (default ON, declared in
   world/water_spec.js). OFF -> we never touch a vehicle transform and boats
   ride the flat constant exactly as before.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const CFG = (CBZ.CONFIG = CBZ.CONFIG || {});
  if (CFG.WATER_BUOYANCY == null) CFG.WATER_BUOYANCY = true;

  // vehicles.js floats hulls this far above mean sea level ("a boat rides ON
  // the surface, not in it"). Derived, not copied, so a future SEA_Y move
  // carries: WATER_Y (-0.12) - SEA_Y (-0.48).
  const RIDE_ABOVE_MEAN = 0.36;
  // Default hull footprint used for the four probes when the model carries no
  // dimensions. A small runabout: 5.4m long, 2.1m in the beam.
  const HULL_LEN = 5.4, HULL_BEAM = 2.1;
  // Hard caps so a freak gradient can never flip a boat on its back.
  const MAX_PITCH = 0.34, MAX_ROLL = 0.30;

  const _up = new THREE.Vector3();
  const _fwd = new THREE.Vector3();
  const _right = new THREE.Vector3();
  const _basis = new THREE.Matrix4();
  const _flatUp = new THREE.Vector3(0, 1, 0);
  const _fwd0 = new THREE.Vector3();
  const _q = new THREE.Quaternion();
  const _qLean = new THREE.Quaternion();
  const _e = new THREE.Euler();

  // "Is this vehicle a boat" — MIGRATED to the one shared predicate
  // (CBZ.isMarineHull, world/water_hulls.js). This exact three-line body was
  // hand-copied in city/vehicles.js:104, here, and was about to be written a
  // third time in city/swim.js; the shared form also answers correctly for a
  // registered hull whose _playerCarFeel has not been promoted yet. The
  // inline body is retained verbatim as the degrade-safe fallback, so this
  // file still behaves identically if water_hulls.js is not on the page.
  function isMarine(car) {
    if (!car) return false;
    if (CBZ.isMarineHull) return CBZ.isMarineHull(car);
    const feel = car._playerCarFeel;
    if (feel) return !!feel.marine;
    return !!(car.model && car.model.body === "boat");
  }
  function overWater(x, z) { return !!(CBZ.cityWaterAt && CBZ.cityWaterAt(x, z)); }

  // ---- THE SHARED RIDE QUERY ------------------------------------------------
  // One line of adoption: hand the block a position, a heading and the hull's
  // footprint and it hands back the heave and the two gradients. The `else`
  // branch is the ORIGINAL inline code, kept verbatim so this file still works
  // (degrade-safe) if world/water_float.js is not on the page.
  const _rideQ = { heading: 0, len: 0, beam: 0 };
  const _rideOut = { y: 0, pitch: 0, roll: 0, nx: 0, ny: 1, nz: 0, gF: 0, gR: 0 };
  function rideAt(x, z, heading, len, beam) {
    if (CBZ.waterRideAt) {
      _rideQ.heading = heading; _rideQ.len = len; _rideQ.beam = beam;
      return CBZ.waterRideAt(x, z, _rideQ, _rideOut);
    }
    const surfaceY = CBZ.citySeaHeightAt;
    const fx = Math.sin(heading), fz = Math.cos(heading);
    const rx = fz, rz = -fx;
    const hl = len * 0.5, hb = beam * 0.5;
    const yBow = surfaceY(x + fx * hl, z + fz * hl);
    const yStern = surfaceY(x - fx * hl, z - fz * hl);
    const yPort = surfaceY(x + rx * hb, z + rz * hb);
    const yStbd = surfaceY(x - rx * hb, z - rz * hb);
    _rideOut.y = (yBow + yStern + yPort + yStbd) * 0.25;
    _rideOut.gF = (yBow - yStern) / Math.max(0.5, hl * 2);
    _rideOut.gR = (yPort - yStbd) / Math.max(0.4, hb * 2);
    return _rideOut;
  }

  function hullLen(car) {
    const m = car.model;
    const L = m && (+m.len || +m.length);
    return Number.isFinite(L) && L > 1 ? L : HULL_LEN;
  }
  function hullBeam(car) {
    const m = car.model;
    const W = m && (+m.width || +m.beam);
    return Number.isFinite(W) && W > 0.6 ? W : HULL_BEAM;
  }

  // Order 38.5 — after city/vehicles.js's last transform writer (38) and
  // before city/swim.js (45.8) and the camera (onAlways 50), so a player
  // driving a boat gets the heave in the same frame the camera reads it.
  CBZ.onUpdate(38.5, function (dt) {
    if (CFG.WATER_BUOYANCY === false || CFG.WATER_V2 === false) return;
    const g = CBZ.game;
    if (!g || g.mode !== "city") return;
    const cars = CBZ.cityCars;
    if (!cars || !cars.length) return;
    const surfaceY = CBZ.citySeaHeightAt;
    if (!surfaceY) return;

    for (let i = 0; i < cars.length; i++) {
      const car = cars[i];
      if (!car || car.dead || !car.group || !car.pos) continue;
      if (!isMarine(car)) continue;
      const x = car.pos.x, z = car.pos.z;
      if (!overWater(x, z)) { car._waveHeave = 0; continue; }

      const h = car.heading || 0;
      // vehicles.js's forward convention: (sin(heading), cos(heading)) in XZ.
      const fx = Math.sin(h), fz = Math.cos(h);
      const rx = fz, rz = -fx;                    // right-hand lateral axis

      // THE HULL SPEC. Resolved (and cached on the car) by the registry;
      // null for any marine vehicle that isn't a registered class, in which
      // case every constant below is exactly what it was before this existed.
      const HS = (CBZ.marineHulls && CBZ.marineHulls.specFor)
        ? CBZ.marineHulls.specFor(car) : (car._hullSpec || null);

      // The four-probe heave + along-hull gradients, from the shared block.
      const R = rideAt(x, z, h, HS ? HS.loa : hullLen(car), HS ? HS.beam : hullBeam(car));
      let mean = R.y, gF = R.gF, gR = R.gR;

      // WAVE-SLOPE-FOLLOWING GAIN — one number per hull, applied to the
      // sampler's output. Below 1, the hull only partially answers the swell:
      // its heave is pulled back toward mean sea level and its along/across
      // gradients are damped, which is exactly what mass and length do to a
      // real hull's response. Skipped outright at gain 1 so the common path
      // is byte-identical.
      if (HS && HS.waveGain !== 1) {
        const wg = HS.waveGain;
        const flat = CBZ.waterSeaY ? CBZ.waterSeaY() : (CBZ.SEA_Y != null ? CBZ.SEA_Y : -0.48);
        mean = flat + (mean - flat) * wg;
        gF *= wg; gR *= wg;
      }

      // Surface normal expressed in the hull's own horizontal frame.
      _up.set(-gR * rx - gF * fx, 1, -gR * rz - gF * fz).normalize();
      _fwd.set(fx, 0, fz);
      _right.crossVectors(_up, _fwd);
      if (_right.lengthSq() < 1e-8) continue;     // degenerate: leave it alone
      _right.normalize();
      _fwd.crossVectors(_right, _up).normalize();

      // Planing: past a few m/s the bow lifts and the ride flattens out, so a
      // boat under power stops mirroring every ripple. water_helm.js already
      // integrates the real (eased, Froude-driven) planing fraction for the
      // hull it is driving, so PREFER that — one signal, not two disagreeing
      // ones. Failing that (a parked or AI hull), derive it from the spec's
      // own planing threshold; failing that, the original spd/11.
      const spd = Math.abs(+car.v || 0);
      const plane = car._planing != null ? car._planing
        : (HS ? (HS.canPlane && HS.planeMs > 0.1 ? Math.min(1, spd / (HS.planeMs * 1.6)) : 0)
              : Math.min(1, spd / 11));
      const settle = 1 - plane * 0.55;
      if (plane > 0.001) {
        _up.lerp(_flatUp, plane * 0.55).normalize();
        _fwd0.set(fx, 0, fz);
        _right.crossVectors(_up, _fwd0);
        if (_right.lengthSq() < 1e-8) continue;
        _right.normalize();
        _fwd.crossVectors(_right, _up).normalize();
      }

      _basis.makeBasis(_right, _up, _fwd);
      _q.setFromRotationMatrix(_basis);

      // Preserve the driver's own weight-transfer lean (squat/dive/roll) by
      // composing it in the hull's local frame. A hull with a SPEC already
      // carries its real Froude-driven trim in car._pitch (water_helm.js
      // writes -trim there, bow-up being negative rotation.x in this engine),
      // so the old cosmetic `- plane*0.085` bow-lift must NOT be added on top
      // of it — that would double the trim. Without a spec it is exactly the
      // term it always was.
      const trimAdd = HS ? 0 : plane * 0.085;
      const lean = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, (car._pitch || 0) - trimAdd));
      // MAX_ROLL clamps the DRIVER'S HEEL only. world/water_stability.js's phi
      // is a real attitude — a boat rolled onto her beam ends by a shark, or
      // floating inverted at pi — and clamping it to 0.30 rad is exactly the
      // "a freak gradient can never flip a boat" rule this line was written
      // for, applied to the one case where flipping is the point. Added on
      // top, never replacing the heel.
      let roll = Math.max(-MAX_ROLL, Math.min(MAX_ROLL, car._roll || 0));
      if (car._stab && CBZ.hullStabRoll) roll += CBZ.hullStabRoll(car);
      _e.set(lean, 0, roll, "XYZ");
      _qLean.setFromEuler(_e);
      car.group.quaternion.copy(_q).multiply(_qLean);

      // How high the hull floats. RIDE_ABOVE_MEAN (0.36) is the runabout's
      // authored keel-above-origin offset; a hull modelled with its designed
      // waterline AT the origin declares its own much smaller value.
      const rideAbove = HS && HS.rideAbove != null ? HS.rideAbove : RIDE_ABOVE_MEAN;
      // A swamped hull sits LOW, a turtled one sits lower still (its keel is
      // what shows), and a body surfacing under it throws it UP. All three
      // come out of world/water_stability.js as two numbers.
      let stabY = 0;
      if (car._stab) {
        if (CBZ.hullStabDrop) stabY -= CBZ.hullStabDrop(car);
        stabY += car._stabLift || 0;
      }
      const rideY = mean + rideAbove * settle + (car._airY || 0) + stabY;
      car._waveHeave = rideY - car.group.position.y;   // read by the wake FX
      car.group.position.y = rideY;
      car._waveY = rideY;

      // The player's own boat also owns the player transform this frame
      // (vehicles.js copies car.pos into P.pos and the character rig), so lift
      // both or the camera stays flat while the hull rises under it.
      if (car.player && CBZ.player && CBZ.player.driving) {
        CBZ.player.pos.y = rideY;
        if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.position.y = rideY;
      }
    }
  });

  // "How high is this hull riding right now" — for the wake FX and anything
  // that wants to sit something on a boat.
  CBZ.cityBoatRideY = function (car) {
    if (!car) return null;
    return car._waveY != null ? car._waveY : null;
  };
})();
