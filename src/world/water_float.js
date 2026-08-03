/* ============================================================
   src/world/water_float.js — THE FLOAT BLOCK. ONE buoyancy primitive that
   EVERYTHING that touches water rides: boats, drowned cars, corpses, debris.

   WHY THIS FILE EXISTS (the duplication it kills)
   ------------------------------------------------------------
   "How high is the water here, and how do I sit on it" was written from
   scratch every time somebody needed it, and the results disagreed:

     • world/water_buoyancy.js owned a PRIVATE 4-probe hull sampler that only
       marine cars could ever reach — the only real buoyancy in the game.
     • city/vehicles.js:2408 drives a flooded road car's Y linearly to a
       hardcoded DEPTH = -1.6 over SINK_T = 2.2s and then freezes it: a car
       "sinks" to a fixed height that is neither the seabed nor the surface,
       and never bobs, wallows or settles.
     • a corpse in the harbour keeps the y=0 the ped mover gave it — standing
       on an invisible floor, exactly the fake-world read this game bans.
     • a LIVING ped that walks into deep water does the same.
     • systems/disasters.js:809-834 already wrote this whole block by hand for
       the survival flood — bots paddle at `wy - 1.12 + sin(...)`, corpses ride
       at `wy - 0.32 + sin(...)` and both are drifted by the flood current.
       A working floating-corpse implementation that nothing else can call.
     • games/ocean.js, city/wildlife.js and city/swim.js each re-derive their
       own "ride the surface" expression from citySeaHeightAt.

   The maths was never the hard part; the fact that it lived inside ONE
   consumer was. So the 4-probe sampler moves HERE, gets a graduated
   submergence query and a registry, and water_buoyancy.js becomes what it
   should always have been: a thin BOAT POLICY layer over a shared primitive.
   Three consumers are migrated in this same change (boats, drowned cars,
   corpses) plus a fourth presentational one (living peds), which is what
   proves the API — a block with no consumers is prose (CLAUDE.md BLOCK LAW).

   THE API (one line to adopt, degrade-safe, zero ceremony)
   ------------------------------------------------------------
   CBZ.waterSubmergenceAt(x, y, z, span) -> 0..1
       GRADUATED, never a boolean — 0 = clear of the water, 1 = fully under.
       `y` is the body's BASE (the origin every rig/group in this engine sits
       on) and `span` its vertical extent (default 1), so the body occupies
       [y, y+span]. 0 immediately if CBZ.cityWaterAt(x,z) is false. A
       graduated value is what stops water transitions snapping.

   CBZ.waterRideAt(x, z, opts, out) -> out
       "How do I sit on the water here." opts = {heading, len, beam, t}.
       Fills out with {y, pitch, roll, nx, ny, nz} (plus gF/gR/bow/stern/
       port/stbd for callers that want the raw gradients) from four probes —
       bow, stern, port, starboard — of CBZ.citySeaHeightAt. Allocation-free
       with a reused `out`. THIS is the sampler water_buoyancy.js used to own.

   CBZ.waterFloat(obj, opts) -> {release()}
       Register anything as a floating body. `obj` needs `.pos` ({x,y,z}) or
       is a THREE.Object3D (then `.position`); if it also carries a `.group`
       Object3D that group gets the transform. opts:
         len, beam        hull footprint for the probes (default 1 / 1)
         buoy             0..1+ buoyancy, default 1
         ride             metres above the surface at rest, default 0
         waterlog         buoyancy lost per second, default 0 (floats forever)
         drift            0..1 how much the current carries it, default 1
         tilt             follow the wave attitude, default true
         baseTilt         fixed body-X rotation applied first (corpses: +PI/2
                          = face-down); non-zero switches the euler order to
                          YXZ so the yaw still reads as a heading
         heading          number or fn; defaults to obj.heading, else group yaw
         plane            number or fn 0..1 — speed planing (bow lifts, ride
                          flattens); the boat policy layer passes this
         keepDead         keep ticking a body whose obj.dead is true (corpses
                          and drowned wrecks ARE dead — they opt in)
         kind             label reported by waterOccupants (default "prop")
         onSink, onSettle callbacks, fired at most once each
       Re-registering the same object returns the existing handle.

   CBZ.waterFloatCount() -> live body count (probes).
   CBZ.waterFloatAudit() -> {legacy:N} ratchet — see the function's comment
       for the exact site list. May only ever go DOWN.

   NEIGHBOUR SEAM — CBZ.waterOccupants(out)
   ------------------------------------------------------------
   Fills and returns an array of everything currently in/on the water:
     {kind, ref, x, y, z, submergence, moving}
     kind: "player" | "ped" | "corpse" | "boat" | "car" | "prop"
   This is the query a shark/predator uses to pick a victim, a mission uses
   to know what is floating, and a rescue job uses to find a body. It is a
   walk of registries that already exist (float registry, CBZ.cityPeds,
   CBZ.cityCars, CBZ.player), cached once per frame, allocation-free after
   warm-up (pooled records + a reused array), and degrade-safe: a registry
   that is missing is simply absent from the result.

   FLAG: CBZ.CONFIG.WATER_FLOAT (default ON). OFF -> nothing here ticks and
   every consumer falls back to exactly what it did before. One-line revert:
   ?cfg_WATER_FLOAT=0. Honours CFG.WATER_V2 === false as the master
   off-switch, same as every sibling water file. Sub-flags per consumer
   below so any single migration can be dropped on its own.

   DETERMINISM: closed-form only. Every value is a function of position and
   CBZ.waterClock() (the shared wall-clock wave phase, runtime-only FX and
   explicitly allowed). No Math.random, no rng stream, no hash — buoyancy is
   gameplay state, so it must be reproducible from position + clock alone.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const CFG = (CBZ.CONFIG = CBZ.CONFIG || {});

  // WATER_FLOAT: the shared buoyancy/submergence primitive plus the post-pass
  // that adopts drowned cars, corpses and swamped peds into it. ON -> a sunk
  // car wallows and settles on the seabed, a body in the harbour floats
  // face-down on the swell and drifts, and a ped over deep water bobs instead
  // of standing on nothing. OFF -> none of this ticks; vehicles.js's linear
  // sink and the y=0 corpse/ped floor are back exactly as before, and
  // water_buoyancy.js falls back to its own inline probe maths.
  // One-line revert: ?cfg_WATER_FLOAT=0
  if (CFG.WATER_FLOAT == null) CFG.WATER_FLOAT = true;

  // WATER_FLOAT_CARS: adopt a dead/flooded road car that is over water into
  // the float registry — it bobs, wallows, noses down as it floods, sinks to
  // the seabed and settles. OFF -> vehicles.js's hardcoded -1.6 snap stands.
  // One-line revert: ?cfg_WATER_FLOAT_CARS=0
  if (CFG.WATER_FLOAT_CARS == null) CFG.WATER_FLOAT_CARS = true;

  // WATER_FLOAT_CORPSES: a dead ped over water goes face-down (the real
  // resting attitude of a drowned body), rides the swell, drifts with the
  // current and slowly waterlogs under. OFF -> corpses keep the ped mover's
  // y=0. One-line revert: ?cfg_WATER_FLOAT_CORPSES=0
  if (CFG.WATER_FLOAT_CORPSES == null) CFG.WATER_FLOAT_CORPSES = true;

  // WATER_FLOAT_PEDS: a LIVING ped over deep water bobs at the surface at the
  // same depth swim.js floats the player, instead of standing on an invisible
  // floor. PRESENTATION ONLY — the lift is undone at order 33.9, before
  // peds.js's brain runs, so their collision/AI sees the unchanged y=0 (see
  // the restore pass below for why that matters). OFF -> peds stand on the
  // water. One-line revert: ?cfg_WATER_FLOAT_PEDS=0
  if (CFG.WATER_FLOAT_PEDS == null) CFG.WATER_FLOAT_PEDS = true;

  function on() { return CFG.WATER_FLOAT !== false && CFG.WATER_V2 !== false; }

  // ---- shared constants ---------------------------------------------------
  const SEA_Y_FALLBACK = -0.48;
  // Hard caps so a freak gradient can never flip anything on its back. Same
  // numbers water_buoyancy.js has always used.
  const MAX_PITCH = 0.34, MAX_ROLL = 0.30;
  // Vertical spring. Damping is EXPONENTIAL (vy *= exp(-c*dt)), which is
  // unconditionally stable at any dt — the naive `vy -= vy*c*dt` explodes the
  // moment c*dt > 2, i.e. on exactly the slow frames this engine ships with.
  const SPRING_K = 26, DAMP_C = 5.5, MAX_VY = 8;
  // Submersion depth is CLAMPED before it drives the spring, so a teleport or
  // a freshly adopted body cannot spike into orbit; past SNAP_D we just snap.
  const MAX_D = 2.5, SNAP_D = 6;
  const ATT_K = 8;                    // attitude exponential approach rate
  const DT_MAX = 1 / 20;              // tick delta ceiling (see tick())
  const SINK_BUOY = 0.15;             // below this the body goes under
  const SWAMP_DROP = 0.55;            // metres a body settles as buoyancy is lost
  const SINK_V = 1.15;                // terminal sink speed, m/s
  const SEABED_MIN = 1.2, SEABED_MAX = 14;   // sane clamp on cityWaterDepthAt
  // A human floating at the surface: swim.js's BODY_SUBMERGE, reused verbatim
  // so a bobbing ped and the swimming player sit at the SAME depth.
  const HUMAN_SUBMERGE = 1.28;
  const CORPSE_RIDE = -0.10;          // a face-down body lies awash
  const CORPSE_LOG = 0.020;           // ~42s afloat, then it goes under
  const CAR_RIDE = -0.55, CAR_LOG = 0.35;    // a swamped hull, under in ~2.4s
  const CAR_SINK_PITCH = -0.42;       // bonnet-down as the engine bay floods

  // CBZ.waterSeaY() is mean sea level PLUS any live surge (water_spec.js), so
  // a flooded coast floats what it should. Falls back to the static mean.
  function seaMean() { return CBZ.waterSeaY ? CBZ.waterSeaY() : (CBZ.SEA_Y != null ? CBZ.SEA_Y : SEA_Y_FALLBACK); }
  function surfaceAt(x, z, t) {
    return CBZ.citySeaHeightAt ? CBZ.citySeaHeightAt(x, z, t) : seaMean();
  }
  function overWater(x, z, clearance) {
    const wf = CBZ.waterField;
    if (wf && wf.isSurfaceWater) return !!wf.isSurfaceWater(x, z, clearance || 0);
    return !!(CBZ.cityWaterAt && CBZ.cityWaterAt(x, z));
  }
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  // ============================================================
  //  1. SUBMERGENCE — the graduated primitive
  // ============================================================
  // 0 = clear of the water, 1 = fully under. `y` is the body's BASE (the
  // origin convention every rig/group in this engine uses: feet on the
  // ground, wheels on the road) and `span` its height, so the body occupies
  // [y, y+span]. Graduated rather than boolean specifically so consumers can
  // ramp drag/audio/camera instead of snapping at a threshold.
  CBZ.waterSubmergenceAt = function (x, y, z, span) {
    if (!CBZ.cityWaterAt || !CBZ.cityWaterAt(x, z)) return 0;
    const h = Number.isFinite(span) && span > 0.01 ? span : 1;
    const sy = surfaceAt(x, z);
    return clamp((sy - y) / h, 0, 1);
  };

  // ---- THE NAMING COLLISION, RESOLVED --------------------------------------
  // Two functions, nearly identical names, DIFFERENT UNITS, and eventually
  // somebody calls the wrong one:
  //
  //   CBZ.waterSubmergenceAt(x, y, z, span)  -> 0..1 FRACTION   (above)
  //   CBZ.waterSubmergence(x, y, z)          -> METRES          (systems/gore.js)
  //
  // Metres is the primitive; the 0..1 fraction is just metres/span clamped.
  // So the metres query gets the name that SAYS metres, and lives here beside
  // its sibling where the relationship is visible:
  //
  //   CBZ.waterDepthUnder(x, y, z)  -> metres this point sits BELOW the live
  //                                    surface. 0 in air, 0 on land, 0 with no
  //                                    water system. Never NaN, never null.
  //
  // DEPRECATED: CBZ.waterSubmergence (systems/gore.js). Do not call it in new
  // code and do not delete it — city/ragdoll.js:461 still uses it and gore.js
  // is not this file's to edit. It is retained as a working alias for exactly
  // one caller; that caller is the migration owed. This function delegates to
  // it when present so there is only ever ONE implementation live (gore.js's
  // has a try/catch and a DRY sentinel this must not silently diverge from),
  // and falls back to its own arithmetic when gore.js is absent.
  CBZ.waterDepthUnder = function (x, y, z) {
    if (CBZ.waterSubmergence) return CBZ.waterSubmergence(x, y, z);
    if (!CBZ.cityWaterAt || !CBZ.cityWaterAt(x, z)) return 0;
    const d = surfaceAt(x, z) - y;
    return Number.isFinite(d) && d > 0 ? d : 0;
  };

  // ============================================================
  //  2. THE 4-PROBE RIDE QUERY (was water_buoyancy.js's private maths)
  // ============================================================
  // Attitude is NOT derived from the point slope under the origin — a
  // 10-metre hull does not follow a 3-metre ripple. Four probes at the bow,
  // stern and both beams give the heave (their mean) and the along/across
  // gradients (their differences), i.e. pitch and roll already filtered by
  // the body's own length. That is why a long boat rides a chop more calmly
  // than a dinghy, for free.
  const _ride = {
    y: 0, pitch: 0, roll: 0, nx: 0, ny: 1, nz: 0,
    gF: 0, gR: 0, bow: 0, stern: 0, port: 0, stbd: 0,
  };
  const _noOpts = {};
  CBZ.waterRideAt = function (x, z, opts, out) {
    out = out || _ride;
    opts = opts || _noOpts;
    const h = +opts.heading || 0;
    const len = Number.isFinite(+opts.len) && +opts.len > 0 ? +opts.len : 1;
    const beam = Number.isFinite(+opts.beam) && +opts.beam > 0 ? +opts.beam : 1;
    const t = opts.t;
    // vehicles.js's forward convention: (sin(heading), cos(heading)) in XZ.
    const fx = Math.sin(h), fz = Math.cos(h);
    const rx = fz, rz = -fx;                    // right-hand lateral axis
    const hl = len * 0.5, hb = beam * 0.5;

    const yBow = surfaceAt(x + fx * hl, z + fz * hl, t);
    const yStern = surfaceAt(x - fx * hl, z - fz * hl, t);
    const yPort = surfaceAt(x + rx * hb, z + rz * hb, t);
    const yStbd = surfaceAt(x - rx * hb, z - rz * hb, t);

    // Gradients ALONG the body — the wave slope it actually feels. The 0.5 /
    // 0.4 floors keep a point-sized body from dividing by nothing.
    const gF = (yBow - yStern) / Math.max(0.5, hl * 2);
    const gR = (yPort - yStbd) / Math.max(0.4, hb * 2);

    // Surface normal expressed in the body's own horizontal frame.
    let nx = -gR * rx - gF * fx, ny = 1, nz = -gR * rz - gF * fz;
    const inv = 1 / Math.sqrt(nx * nx + 1 + nz * nz);
    nx *= inv; ny = inv; nz *= inv;

    out.y = (yBow + yStern + yPort + yStbd) * 0.25;
    out.pitch = Math.atan2(yBow - yStern, Math.max(0.5, hl * 2));
    out.roll = Math.atan2(yPort - yStbd, Math.max(0.4, hb * 2));
    out.nx = nx; out.ny = ny; out.nz = nz;
    out.gF = gF; out.gR = gR;
    out.bow = yBow; out.stern = yStern; out.port = yPort; out.stbd = yStbd;
    return out;
  };

  // ============================================================
  //  3. THE FLOAT REGISTRY
  // ============================================================
  const bodies = [];
  const _cur = { x: 0, z: 0 };
  const _e = new THREE.Euler();

  function posOf(obj) {
    if (!obj) return null;
    if (obj.pos && typeof obj.pos.x === "number") return obj.pos;
    if (obj.isObject3D) return obj.position;
    if (obj.position && typeof obj.position.x === "number") return obj.position;
    return null;
  }
  function groupOf(obj) {
    if (!obj) return null;
    if (obj.group && obj.group.isObject3D) return obj.group;
    if (obj.isObject3D) return obj;
    return null;
  }
  function numOrFn(v, dflt) {
    if (typeof v === "function") return v;
    return Number.isFinite(+v) ? +v : dflt;
  }
  function evalTerm(v, e) {
    return typeof v === "function" ? (+v(e.obj) || 0) : v;
  }

  CBZ.waterFloat = function (obj, opts) {
    if (!obj) return _deadHandle;
    if (obj._waterFloat && !obj._waterFloat.released) return obj._waterFloat.handle;
    const pos = posOf(obj);
    if (!pos) return _deadHandle;
    opts = opts || _noOpts;
    const grp = groupOf(obj);
    const e = {
      obj: obj, pos: pos, grp: grp,
      len: Number.isFinite(+opts.len) && +opts.len > 0 ? +opts.len : 1,
      beam: Number.isFinite(+opts.beam) && +opts.beam > 0 ? +opts.beam : 1,
      buoy: Number.isFinite(+opts.buoy) ? +opts.buoy : 1,
      ride: Number.isFinite(+opts.ride) ? +opts.ride : 0,
      waterlog: Math.max(0, +opts.waterlog || 0),
      drift: opts.drift == null ? 1 : clamp(+opts.drift || 0, 0, 1),
      tilt: opts.tilt !== false,
      baseTilt: +opts.baseTilt || 0,
      sinkPitch: Number.isFinite(+opts.sinkPitch) ? +opts.sinkPitch : 0,
      heading: opts.heading,
      plane: numOrFn(opts.plane, 0),
      keepDead: !!opts.keepDead,
      kind: typeof opts.kind === "string" ? opts.kind : "prop",
      onSink: typeof opts.onSink === "function" ? opts.onSink : null,
      onSettle: typeof opts.onSettle === "function" ? opts.onSettle : null,
      x: pos.x, y: pos.y, z: pos.z,
      vy: 0, pitch: 0, roll: 0, speed: 0,
      sunk: false, settled: false, released: false, handle: null,
    };
    e.handle = { release: function () { release(e); } };
    obj._waterFloat = e;
    bodies.push(e);
    return e.handle;
  };
  const _deadHandle = { release: function () {} };

  function release(e) {
    if (!e || e.released) return;
    e.released = true;
    if (e.obj && e.obj._waterFloat === e) e.obj._waterFloat = null;
    const i = bodies.indexOf(e);
    if (i >= 0) bodies.splice(i, 1);
  }

  CBZ.waterFloatCount = function () { return bodies.length; };

  // Still ours to drive? Drops a body whose object died (obj.dead unless it
  // explicitly opted in with keepDead — corpses and drowned wrecks ARE dead),
  // was reaped, was culled, or was removed from the scene graph.
  function stillOurs(e) {
    const o = e.obj;
    if (!o || e.released) return false;
    if (o._reap || o.culled) return false;
    if (o.dead && !e.keepDead) return false;
    if (e.grp && !e.grp.parent) return false;
    return true;
  }

  function headingOf(e) {
    const h = e.heading;
    if (typeof h === "function") return +h(e.obj) || 0;
    if (Number.isFinite(+h)) return +h;
    if (Number.isFinite(+e.obj.heading)) return +e.obj.heading;
    if (e.grp) return e.grp.rotation.y;
    return 0;
  }

  function writePose(e, pitch, roll, heading) {
    const p = e.pos;
    p.x = e.x; p.y = e.y; p.z = e.z;
    const g = e.grp;
    if (!g) return;
    if (g.position !== p) g.position.set(e.x, e.y, e.z);
    if (!e.tilt) return;
    if (e.baseTilt) {
      // A fixed body-X rotation (face-down for a corpse) composed with the
      // wave attitude. YXZ so the yaw still reads as a compass heading after
      // the body has been laid flat.
      _e.set(e.baseTilt + pitch, heading, roll, "YXZ");
      g.quaternion.setFromEuler(_e);
    } else {
      g.rotation.set(pitch, heading, roll);
    }
  }

  function tickBody(e, dt) {
    if (e.settled) return;
    const heading = headingOf(e);
    const wet = overWater(e.x, e.z, 0);

    // ---- sinking: buoyancy is spent, descend to the seabed and stop --------
    if (e.buoy < SINK_BUOY) {
      if (!e.sunk) {
        e.sunk = true;
        if (e.onSink) { try { e.onSink(e.obj); } catch (err) {} }
      }
      const depth = clamp(CBZ.cityWaterDepthAt ? +CBZ.cityWaterDepthAt(e.x, e.z) || 0 : 3,
                          SEABED_MIN, SEABED_MAX);
      const bed = seaMean() - depth;
      e.vy = 0;
      e.y = Math.max(bed, e.y - SINK_V * dt);
      // keep drifting, but a sinking body is barely carried
      driftStep(e, dt * 0.4);
      const k = 1 - Math.exp(-ATT_K * 0.5 * dt);
      e.pitch += ((e.sinkPitch || 0) - e.pitch) * k;
      e.roll += (0 - e.roll) * k;
      writePose(e, e.pitch, e.roll, heading);
      if (e.y <= bed + 0.01) {
        e.settled = true;
        e.speed = 0;
        if (e.onSettle) { try { e.onSettle(e.obj); } catch (err) {} }
      }
      return;
    }

    if (!wet) {
      // Drifted clear of the water (a body washed onto a bridge deck). Leave
      // it exactly where it is — dry land is somebody else's writer.
      e.vy = 0;
      return;
    }

    // ---- waterlogging ------------------------------------------------------
    if (e.waterlog > 0) e.buoy = Math.max(0, e.buoy - e.waterlog * dt);

    // ---- the ride ----------------------------------------------------------
    _rideOpts.heading = heading; _rideOpts.len = e.len; _rideOpts.beam = e.beam;
    const r = CBZ.waterRideAt(e.x, e.z, _rideOpts, _ride);
    const pl = clamp(evalTerm(e.plane, e) || 0, 0, 1);
    const settle = 1 - pl * 0.55;
    // Resting height: `ride` is where the body sits at buoy = 1, and losing
    // buoyancy walks it monotonically DOWNWARD (a flooding hull settles into
    // the water long before it goes under). buoy > 1 rides correspondingly
    // higher, which is what makes the parameter a scalar rather than a switch.
    const target = r.y + e.ride * settle + (clamp(e.buoy, 0, 2) - 1) * SWAMP_DROP;

    // Clamp the submersion error BEFORE it drives the spring; snap outright
    // past SNAP_D (a teleport, or the frame we adopted the body).
    let d = target - e.y;
    if (d > SNAP_D || d < -SNAP_D) { e.y = target; e.vy = 0; d = 0; }
    else d = clamp(d, -MAX_D, MAX_D);

    e.vy += d * SPRING_K * dt;
    e.vy *= Math.exp(-DAMP_C * dt);          // unconditionally stable at any dt
    e.vy = clamp(e.vy, -MAX_VY, MAX_VY);
    e.y += e.vy * dt;

    // ---- attitude: damp toward the wave gradient, never integrated ---------
    if (e.tilt) {
      const tp = clamp(r.pitch * settle - pl * 0.085, -MAX_PITCH, MAX_PITCH);
      const tr = clamp(r.roll * settle, -MAX_ROLL, MAX_ROLL);
      const k = 1 - Math.exp(-ATT_K * dt);
      e.pitch += (tp - e.pitch) * k;
      e.roll += (tr - e.roll) * k;
    }

    driftStep(e, dt);
    writePose(e, e.pitch, e.roll, heading);
  }
  const _rideOpts = { heading: 0, len: 1, beam: 1, t: undefined };

  // The current carries a floating body — but only onto more water. Rejecting
  // a step that leaves the surface is what stops the drift field from
  // conveyor-belting a corpse up a beach and into a wall.
  function driftStep(e, dt) {
    if (e.drift <= 0) { e.speed = 0; return; }
    const wf = CBZ.waterField;
    if (!wf || !wf.currentAt) { e.speed = 0; return; }
    const c = wf.currentAt(e.x, e.z, undefined, _cur);
    const nx = e.x + c.x * e.drift * dt;
    const nz = e.z + c.z * e.drift * dt;
    if (overWater(nx, nz, 0.4)) {
      e.speed = Math.hypot(nx - e.x, nz - e.z) / Math.max(1e-4, dt);
      e.x = nx; e.z = nz;
    } else e.speed = 0;
  }

  // ============================================================
  //  4. CONSUMER 1 — DROWNED / FLOODED ROAD CARS
  // ============================================================
  // city/vehicles.js:2408 ramps a swamped car's Y linearly to a hardcoded
  // -1.6 over 2.2s, marks the hull dead, and then EVERY vehicle updater in
  // that file skips it (`if (c.player || c.dead ...) continue` at 37/38, and
  // the player updater returns the moment it ejects you). So from the frame
  // the wreck goes dead NOTHING writes its transform any more — which is
  // exactly why this post-pass can own it outright without editing
  // vehicles.js and without fighting a second writer. We adopt only DEAD
  // hulls for that reason: a car that is `_flooded` but still under the
  // player is still being written at order 11, and stealing it there would
  // desync P.pos (vehicles.js:2440 copies the same ride height onto the
  // player and the character rig).
  //
  // BOTH sink paths are covered by the one `dead && over water` test: the
  // player path above, and the AI/traffic path at vehicles.js:2939-2944 which
  // slams a stranded wreck to a flat y = -1.1 and marks it dead/abandoned in
  // a single frame (no arc at all). We pick it up the very next tick.
  function adoptCars() {
    if (CFG.WATER_FLOAT_CARS === false) return;
    const cars = CBZ.cityCars;
    if (!cars || !cars.length) return;
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i];
      if (!c || c._waterFloat || !c.dead || !c.group || !c.pos) continue;
      if (!overWater(c.pos.x, c.pos.z, 0)) continue;
      const m = c.model;
      const len = (m && (+m.len || +m.length)) || 4.4;
      const beam = (m && (+m.width || +m.beam)) || 1.9;
      CBZ.waterFloat(c, {
        kind: "car", keepDead: true,
        len: len > 1 ? len : 4.4, beam: beam > 0.6 ? beam : 1.9,
        ride: CAR_RIDE, waterlog: CAR_LOG, drift: 0.55,
        sinkPitch: CAR_SINK_PITCH,
        heading: function (car) { return car.heading || 0; },
      });
    }
  }

  // ============================================================
  //  5. CONSUMER 2 — CORPSES
  // ============================================================
  // Dead bodies live in CBZ.cityPeds (city/peds.js:565 — `pos` IS the rig
  // group's position object) and are skipped by the ped mover the frame they
  // die (peds.js:4285 `if (p.dead) { ... continue; }`), so their Y is left
  // wherever it was: y = 0, standing on nothing, over open water.
  // city/ragdoll.js re-writes the pose of the ~36 nearest corpses every frame
  // at order 25; this pass runs at 38.6, so it wins the frame cleanly without
  // touching that file. We wait for deadT > 1.2 so the verlet flop plays out
  // first and the sea only takes the body once it has stopped thrashing.
  // (CBZ.body.busy() is NOT the gate to use here: starting a ragdoll pins
  // _phys.down = 9999 so busy() stays true for the corpse FOREVER — gating on
  // it would exclude every ragdolled body, i.e. every corpse near the camera.
  // The deadT delay plus running after order 25 is the correct seam.)
  // Ambient instanced crowd corpses (typed arrays in city/crowd.js and
  // entities/crowd.js) are deliberately NOT adopted — they have no per-body
  // Object3D to re-seat. They stay a known seam.
  //
  // Face-down is the real resting attitude of a drowned body (the chest
  // cavity is the last buoyant volume, so a corpse rolls prone). We SET that
  // pose rather than simulating a roll: baseTilt = +PI/2 about the rig's own
  // X, which maps the rig's forward (+Z at yaw 0) to straight down.
  function adoptCorpses() {
    if (CFG.WATER_FLOAT_CORPSES === false) return;
    const peds = CBZ.cityPeds;
    if (!peds || !peds.length) return;
    for (let i = 0; i < peds.length; i++) {
      const p = peds[i];
      if (!p || p._waterFloat || !p.dead || p.culled || p.collected) continue;
      if (!p.group || !p.pos || !(p.deadT > 1.2)) continue;
      if (!overWater(p.pos.x, p.pos.z, 0)) continue;
      CBZ.waterFloat(p, {
        kind: "corpse", keepDead: true,
        len: 1.75, beam: 0.55,
        ride: CORPSE_RIDE, waterlog: CORPSE_LOG, drift: 1,
        baseTilt: Math.PI / 2,
        heading: p.group.rotation.y,
      });
    }
  }

  // ============================================================
  //  6. CONSUMER 3 — LIVING PEDS OVER DEEP WATER (presentation only)
  // ============================================================
  // A living ped is moved by peds.js's brain at order 34, which finishes with
  // a flat `ped.pos.y = 0` (peds.js:4220) — so a ped that wanders off a quay
  // walks on top of the sea. We lift the rig to the same depth swim.js floats
  // the player at (BODY_SUBMERGE = 1.28 below the live surface) at 38.6.
  //
  // WHY THE RESTORE PASS EXISTS (do not delete it): peds.js's move() feeds
  // `ped.pos.y` to CBZ.collide as the body's feetY (peds.js:4212) BEFORE it
  // resets y to 0. A ped left sitting at y = -1.76 would therefore be tested
  // against height-gated colliders — the seawall cap is gated at y1 = 0.55 —
  // with a span that misses them entirely, and could drift straight through a
  // quay wall. So at order 33.9, immediately before the ped brain, we put
  // every lifted ped back on y = 0. The lift is purely what the frame RENDERS;
  // collision and AI never see it. Only peds with real shore clearance are
  // lifted, so nothing near a beach or a jetty is touched.
  const lifted = [];
  let liftedScanT = 0;

  function scanLiftedPeds() {
    lifted.length = 0;
    if (CFG.WATER_FLOAT_PEDS === false) return;
    const peds = CBZ.cityPeds;
    if (!peds || !peds.length) return;
    for (let i = 0; i < peds.length; i++) {
      const p = peds[i];
      if (!p || p.dead || p.culled || p._parked || p._npcAttached || p._waterFloat) continue;
      if (!p.pos || !p.group || p.enterT > 0) continue;
      if (!overWater(p.pos.x, p.pos.z, 3)) continue;
      lifted.push(p);
    }
  }

  function liftPeds() {
    if (CFG.WATER_FLOAT_PEDS === false) { lifted.length = 0; return; }
    const t = CBZ.waterClock ? CBZ.waterClock() : 0;
    for (let i = 0; i < lifted.length; i++) {
      const p = lifted[i];
      if (!p || p.dead || p.culled || !p.pos) continue;
      // RE-TEST THE WATER EVERY FRAME. The membership scan above is throttled
      // to 0.45s and a ped covers ~2m in that window, so a scan-cached list
      // alone kept lifting a ped that had already stepped out onto the sand —
      // rendering it 1.7m UNDER the beach until the next sweep. The clearance
      // is looser than the scan's (0.5 vs 3) so a ped legitimately bobbing
      // near the band's edge does not flicker between lifted and not.
      if (!overWater(p.pos.x, p.pos.z, 0.5)) continue;
      const bob = Math.sin(t * 2 + p.pos.x * 0.7) * 0.045;
      p.pos.y = surfaceAt(p.pos.x, p.pos.z) - HUMAN_SUBMERGE + bob;
    }
  }

  // Order 33.9 — the LAST thing before city/peds.js's brain at 34, so the
  // collider/AI path below it reads the untouched y = 0 it has always read.
  CBZ.onUpdate(33.9, function () {
    if (!lifted.length) return;
    for (let i = 0; i < lifted.length; i++) {
      const p = lifted[i];
      if (p && p.pos && !p.dead) p.pos.y = 0;
    }
    // Flag flipped off mid-run (or we left city mode): put everyone back on
    // the floor once and stop tracking them.
    if (!on() || CFG.WATER_FLOAT_PEDS === false) lifted.length = 0;
  });

  // ============================================================
  //  7. THE TICK
  // ============================================================
  // Order 38.6 — immediately after world/water_buoyancy.js's boat pass (38.5),
  // which is itself after city/vehicles.js's last transform writer (38) and
  // city/peds.js's ped brain (34) and city/ragdoll.js's corpse pose (25). So
  // every other writer has finished with these transforms before we re-seat
  // them, and we are still ahead of city/swim.js (45.8) and the camera
  // (onAlways 50), which read the result in the same frame.
  let scanT = 0;
  CBZ.onUpdate(38.6, function (dt) {
    if (!on()) return;
    const g = CBZ.game;
    // Left city mode (or a teardown): drop every body properly — clearing the
    // array alone would leave the `_waterFloat` markers set and the same
    // objects could never be re-adopted on the next run.
    if (!g || g.mode !== "city") {
      for (let i = bodies.length - 1; i >= 0; i--) release(bodies[i]);
      lifted.length = 0;
      return;
    }
    // Clamp the step. Everything below is exponentially damped and therefore
    // stable at any dt, but a 0.5s hitch would still teleport a drifting body.
    if (!(dt > 0)) return;
    if (dt > DT_MAX) dt = DT_MAX;

    // Membership scans are throttled: a body moves at most a metre between
    // sweeps, and the per-frame integration below runs on the cached lists.
    scanT -= dt;
    if (scanT <= 0) {
      scanT = 0.45;
      adoptCars();
      adoptCorpses();
    }
    liftedScanT -= dt;
    if (liftedScanT <= 0) { liftedScanT = 0.45; scanLiftedPeds(); }

    for (let i = bodies.length - 1; i >= 0; i--) {
      const e = bodies[i];
      if (!stillOurs(e)) { release(e); continue; }
      // Something else legitimately moved the body a long way (a medic lift,
      // a blast, a net correction) — take its word for it and re-seat.
      const p = e.pos;
      if (Math.abs(p.x - e.x) > 3 || Math.abs(p.z - e.z) > 3) { e.x = p.x; e.z = p.z; e.y = p.y; e.vy = 0; }
      tickBody(e, dt);
    }

    liftPeds();
  });

  // ============================================================
  //  8. NEIGHBOUR SEAM — CBZ.waterOccupants(out)
  // ============================================================
  // Everything in or on the water, right now, in one call. Pooled records +
  // a reused array, recomputed at most once per frame (CBZ.now is the frame
  // stamp both the real loop and CBZ.stepSim advance), so a predator can poll
  // it every tick without paying for the walk more than once.
  const occ = [];
  const occPool = [];
  let occFrame = -1;

  function pushOcc(kind, ref, x, y, z, span, moving) {
    let r = occPool[occ.length];
    if (!r) r = occPool[occ.length] = { kind: "", ref: null, x: 0, y: 0, z: 0, submergence: 0, moving: false };
    r.kind = kind; r.ref = ref; r.x = x; r.y = y; r.z = z;
    r.submergence = CBZ.waterSubmergenceAt(x, y, z, span);
    r.moving = !!moving;
    occ.push(r);
    return r;
  }

  function rebuildOccupants() {
    occ.length = 0;

    // 1. the float registry (adopted wrecks/corpses + any prop a caller
    //    registered). These carry their own kind label.
    for (let i = 0; i < bodies.length; i++) {
      const e = bodies[i];
      if (!e || e.released) continue;
      pushOcc(e.kind, e.obj, e.x, e.y, e.z,
              e.kind === "corpse" ? 0.5 : Math.max(0.6, e.beam),
              Math.abs(e.vy) > 0.15 || e.speed > 0.05);
    }

    // 2. the player (never while driving — the boat below is the occupant)
    const P = CBZ.player;
    if (P && P.pos && !P.driving && overWater(P.pos.x, P.pos.z, 0)) {
      const swimming = CBZ.citySwimming ? !!CBZ.citySwimming() : false;
      pushOcc("player", P, P.pos.x, P.pos.y, P.pos.z, 1.8, swimming || (+P.speed || 0) > 0.4);
    }

    // 3. peds — alive ("ped") and dead ("corpse"). Anything already adopted
    //    into the registry was emitted above; skip it here.
    const peds = CBZ.cityPeds;
    if (peds) {
      for (let i = 0; i < peds.length; i++) {
        const p = peds[i];
        if (!p || p._waterFloat || p.culled || p._parked || !p.pos) continue;
        if (!overWater(p.pos.x, p.pos.z, 0)) continue;
        pushOcc(p.dead ? "corpse" : "ped", p, p.pos.x, p.pos.y, p.pos.z,
                p.dead ? 0.5 : 1.8, !p.dead && (+p.speed || 0) > 0.15);
      }
    }

    // 4. vehicles — a hull under way is a "boat", anything else afloat is a
    //    "car". Adopted wrecks were emitted from the registry above.
    const cars = CBZ.cityCars;
    if (cars) {
      for (let i = 0; i < cars.length; i++) {
        const c = cars[i];
        if (!c || c._waterFloat || !c.pos || !c.group) continue;
        if (!overWater(c.pos.x, c.pos.z, 0)) continue;
        const feel = c._playerCarFeel;
        const marine = feel ? !!feel.marine : !!(c.model && c.model.body === "boat");
        pushOcc(marine ? "boat" : "car", c, c.pos.x, c.group.position.y, c.pos.z,
                1.2, Math.abs(+c.v || 0) > 0.5);
      }
    }
  }

  CBZ.waterOccupants = function (out) {
    const frame = CBZ.now || 0;
    // (!frame = the loop has not stamped a time yet — rebuild every call
    // rather than serving one stale answer forever.)
    if (!frame || frame !== occFrame) { occFrame = frame; rebuildOccupants(); }
    if (!out) return occ;
    out.length = 0;
    for (let i = 0; i < occ.length; i++) out.push(occ[i]);
    return out;
  };

  // ============================================================
  //  9. THE RATCHET (CLAUDE.md BLOCK LAW item 5)
  // ============================================================
  // Counts the places STILL LOADED IN THIS PAGE that compute a water ride
  // height on their own instead of going through this block. Feature-detected
  // at call time — never a hand-maintained constant — so it tracks the real
  // page, and it may only ever go DOWN as sites migrate. Exactly what is
  // counted, and what would retire each one:
  //
  //  1. city/vehicles.js marine hull, hardcoded WATER_Y = -0.12 (vehicles.js
  //     :99, applied :2432). Counted ONLY when the boat policy layer is off
  //     (WATER_BUOYANCY or WATER_V2 false), because that is the one state
  //     where the flat constant is what actually renders. NOTE: WATER_FLOAT=0
  //     does NOT re-count it — the query half of this file (waterRideAt) is
  //     published unconditionally so adoption can never be broken by a flag;
  //     only the registry tick honours the flag. Retired for good by deleting
  //     the constant in vehicles.js.
  //  2. city/vehicles.js PLAYER flooded-car sink, hardcoded DEPTH = -1.6
  //     ramped linearly over SINK_T = 2.2s (vehicles.js:2408-2419). We adopt
  //     the wreck the frame it goes dead, but the ~1.65s flood window before
  //     that is still driven by the linear ramp. Counted whenever
  //     CARS_NO_WATER is not explicitly false. Retired by pointing that block
  //     at CBZ.waterFloat.
  //  3. city/vehicles.js AI/traffic wreck, slammed to a flat y = -1.1 the
  //     instant it strands over water (vehicles.js:2939-2944). Same gate as
  //     (2); a separate site with a separate fix, so it is counted separately.
  //     We adopt the wreck one frame later and give it a real arc, but the
  //     snap itself still executes.
  //  4. city/swim.js player float, `seaY - BODY_SUBMERGE` (swim.js:182-186).
  //     Counted whenever swim.js is loaded. Retired when the player becomes a
  //     waterFloat body (its handle would set CBZ.waterFloatOwnsPlayer).
  //  5. games/ocean.js dive-game buoys + floating debris, `surfaceY(...) +
  //     0.1` (ocean.js:859, 555, 986). Counted whenever the "ocean" package is
  //     registered.
  //  6. city/wildlife.js surface-riding aquatic animals, `wf.surfaceY(...) -
  //     swimDepth + sin(bob)` (wildlife.js:1549, 220). Counted whenever the
  //     wildlife roster exists.
  //  7. systems/disasters.js flood sim — live bots ride `wy - 1.12 + sin(...)`
  //     and dead ones `wy - 0.32 + sin(...)` with a hand-rolled current drift
  //     (disasters.js:809-834). Survival mode's own private copy of exactly
  //     this block. Counted whenever the disaster system is loaded.
  //  8. city/playeraircraft.js `floorY()` (published as CBZ.aircraftSurfaceY,
  //     playeraircraft.js:270-295) returns CBZ.SEA_Y over water and is used as
  //     the landing/altitude/crash "ground" at ~17 sites — so an airframe rests
  //     ON the sea with no ditching arc at all. Counted whenever it exists.
  //     NOT migrated here on purpose: the aircraft updaters run at 42/42.5,
  //     AFTER this pass at 38.6, so a post-pass could not own that transform.
  //
  // NOT counted, deliberately: world/water_wake.js and world/water_underwater
  // .js read citySeaHeightAt to place FX/decals and to test the camera eye —
  // they position no BODY, so they are not buoyancy implementations.
  CBZ.waterFloatAudit = function () {
    let n = 0;
    // 1 — the flat marine ride, only reachable with the policy layer off
    if (CFG.WATER_BUOYANCY === false || CFG.WATER_V2 === false) n++;
    // 2 + 3 — the two hardcoded car-sink snaps in vehicles.js
    if (CBZ.cityCars && CFG.CARS_NO_WATER !== false) n += 2;
    // 4 — swim.js's own player float
    if (CBZ.citySwimming && !CBZ.waterFloatOwnsPlayer) n++;
    // 5 — the dive game's buoys/debris
    try {
      if (CBZ.games && CBZ.games.list && CBZ.games.list().indexOf("ocean") >= 0) n++;
    } catch (err) {}
    // 6 — surface-riding wildlife
    if (CBZ.cityWildlifeList) n++;
    // 7 — the survival flood's private float
    if (CBZ.disasters) n++;
    // 8 — aircraft treat the sea as a runway
    if (CBZ.aircraftSurfaceY) n++;
    return { legacy: n };
  };
})();
