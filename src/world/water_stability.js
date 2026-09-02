/* ============================================================
   src/world/water_stability.js — BOATS CAN GO OVER.

   WHAT THIS REPLACES
   ------------------------------------------------------------
   Nothing in this game could tip a boat. Roll was two cosmetics:
   water_helm.js eased `car._roll` toward a turn-heel clamped at `maxHeel`
   (0.075 rad on the yacht, 0.26 on the RIB), and a shark bite did
   `car.group.rotation.z += +-0.12..0.24` (marine_predation.js:1250) — a
   one-frame wobble written straight onto the transform, which the very next
   buoyancy pass at order 38.5 overwrote wholesale. A 30-tonne megalodon
   hitting a 4-metre kayak produced a 0.2 rad twitch and then nothing.

   So: a real single-degree-of-freedom roll model, in ONE file, composed into
   the ride the same way every other attitude term already is. A hull that
   goes over STAYS over — floating inverted, keel up, people in the water —
   and then floods and sinks or drifts, per its class.

   THE MODEL (small, honest, tunable — every constant is at the top)
   ------------------------------------------------------------
   One state per hull: phi (roll about the keel axis, radians), phiDot, and
   how much water is inside it.

     I * phiDD = -disp*g*GZ(phi) - cL*phiDot - cQ*phiDot*|phiDot| + M_ext

   GZ is the righting arm. Naval architecture in three lines:
     • small angles: GZ = gm*sin(phi)          (gm = metacentric height)
     • past 0.6*phiV it falls away, crossing zero at phiV, the ANGLE OF
       VANISHING STABILITY — the hull's own weight now helps it over;
     • past phiV it is negative all the way to phi = +-PI, where it crosses
       back through zero: THE INVERTED STABLE POINT. A turtled hull sits
       there. Its stiffness is INV_GM_FRAC of the upright one, so righting a
       capsized hull takes a real counter-impulse — or, for a hull whose spec
       declares `selfRight`, a slow roll back after a few seconds (a PWC).

   Written as ONE odd function of phi so the two branches cannot disagree:
     GZ(phi) = gm * sin(phi) * k(|phi|),  k: +1 -> 0 at phiV -> -INV_GM_FRAC.
   sin() takes care of the zero at PI for free, and the sign symmetry is
   automatic.

   UNITS — and the one thing that would otherwise be wrong. Mass is carried
   in TONNES, not kilograms, because that is what the hull specs are written
   in. In tonne units the roll inertia I is t*m^2, and 1 kN*m == 1 t*m^2/s^2
   exactly, so a heeling moment in kN*m divided by I in t*m^2 is already
   rad/s^2. No 1000s anywhere. (Do not "fix" that by multiplying by 1000.)

   SIGN CONVENTION — verified against the two files that already write roll:
     water_helm.js:554 writes `group.rotation.set(_pitch, heading, _roll)`;
     water_buoyancy.js:232-236 composes the same `_roll` as the Z term of a
     local-frame euler. The hull's local +Z is the BOW (water_hulls' build
     convention) and its local +X is therefore up x fwd = Y x Z = +X, which
     is the PORT side (water_float's four-probe sampler literally calls that
     probe `yPort`). A positive rotation about +Z carries +X toward +Y, so it
     lifts the PORT rail:
        POSITIVE phi = HEELED TO STARBOARD  (port rail up, starboard rail
        down) = clockwise seen from astern looking forward.
     water_helm.js says the same thing in its own words at :406-:411
     ("Positive _roll raises the port side, i.e. leans to starboard").
     phi is ADDED to that cosmetic heel, never replaces it.

   THE SEAM
   ------------------------------------------------------------
     CBZ.hullStab(rec)                    -> the state object (created lazily)
     CBZ.hullStabTick(rec, dt)            -> integrate one frame
     CBZ.hullHeelImpulse(rec, moment, o)  -> heel it; returns the new phi
     CBZ.hullCapsize(rec, o)              -> force it over now
     CBZ.hullCapsized(rec)                -> bool
     CBZ.hullRight(rec)                   -> back upright
     CBZ.hullSwampAdd(rec, seconds)       -> green water aboard
     CBZ.hullStabRoll(rec)                -> extra roll radians for the ride
     CBZ.hullStabDrop(rec)                -> metres to LOWER the ride by
     CBZ.hullStabAudit(opts)              -> counters (the preset reads THIS)

   `rec` is anything with .group (Object3D), .pos, .heading and ._hullSpec:
   a city/vehicles.js car and a world/sea_craft.js record both qualify.

   WHERE IT RUNS. As its own post-pass at order 38.4 — one tick BEFORE
   water_buoyancy at 38.5, so the buoyancy pass composes a phi computed this
   frame rather than last frame's. It is a separate pass rather than a call
   inside buoyancy's loop because sea craft (world/sea_craft.js) are not
   cityCars and buoyancy never sees them: their owner calls hullStabTick +
   hullStabRoll + hullStabDrop directly, and it must be the same function,
   not a second copy living inside somebody else's loop.

   STATE IS LAZY. A boat nobody has hit has no `_stab` at all and this file
   costs it nothing — no allocation, no integration, no branch beyond one
   truthy test. Everything below only exists once something heels a hull.

   No flag. The old behaviour was a cosmetic twitch, not a feature; git is
   the undo (CLAUDE.md).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;

  // ---- TUNING (units in the name or the comment; no cfg flags) -------------
  const G = 9.81;                    // m/s^2
  const SUB_DT = 1 / 120;            // s — max integration substep. A big
                                     // impulse must not tunnel through phiV.
  const MAX_DT = 0.5;                // s — never integrate a stall
  // Roll gyradius as a fraction of the beam. 0.4*B is the standard first
  // estimate for a small craft (IMO uses 0.35-0.40 B for the roll radius of
  // gyration); I = massT * (0.4*beam)^2, in t*m^2.
  const GYR_BEAM = 0.40;
  // Damping. cL = DAMP_L * sqrt(I*K) with K = disp*g*gm the roll stiffness;
  // critical is 2*sqrt(I*K), so 0.16 is 8% of critical — the published range
  // for a hull with bilge keels, and a boat that rolls half a dozen times
  // after a knock before it settles. Higher than this and a megalodon's whole
  // ram is eaten by damping before the cruiser reaches its vanishing angle.
  const DAMP_L = 0.16;
  const DAMP_Q = 0.06;               // quadratic term, x I: bilge-keel-ish
  // The GZ curve's shape. It is flat gm*sin(phi) up to KNEE*phiV, then falls
  // through zero at phiV (the smoothstep's upper edge is past phiV so the
  // crossing lands ON phiV rather than short of it) and holds at
  // -INV_GM_FRAC of the upright stiffness out to the inverted point.
  const GZ_KNEE = 0.60;              // x phiV — where the fall-off starts
  const GZ_FAR = 1.18;               // x phiV — where the fall-off finishes
  const INV_GM_FRAC = 0.35;          // inverted stiffness / upright stiffness
  // A heeling IMPULSE is a moment sustained for this long. A ram contact is
  // about a fifth of a second; this exact number is what makes a 1.5 t great
  // white at 8 m/s heel a 6.2 m speedboat to 35 deg (rail under at 31, so
  // green water, but NOT over — it takes three rams in phase), barely rock a
  // 16 t cruiser (2.8 deg) and lets a 30 t megalodon at 10 m/s roll that same
  // cruiser past its vanishing angle in 0.98 s. Callers may override o.dur.
  const IMPULSE_DUR_S = 0.22;
  // A hull does not snap-roll: an absolute ceiling on roll rate, scaled by
  // length because a big hull rolls slowly. This is the coarse guard (without
  // it a megalodon hitting a 30 kg kayak is a 380 rad/s pinwheel); the
  // ENERGY ceiling below is the one that shapes the result.
  const ROLL_RATE_REF = 6.0;         // rad/s at loa 6 m
  const ROLL_RATE_LOA = 6.0;         // m
  // ...and an energy ceiling on top of it, which is the one that stops a hull
  // PINWHEELING. A single impulse may put in at most this multiple of the
  // energy it takes to reach the vanishing angle from upright. Past 1.0 the
  // hull is certain to go over; much past it and it arrives at the inverted
  // point with enough left to climb straight back out the other side and keep
  // rolling, which is a barrel-rolling kayak, not a capsize. 1.4 goes over
  // decisively and settles.
  const OVER_MARGIN = 1.4;
  // A body surfacing UNDER a hull heaves it as well as heeling it.
  const LIFT_RISE_S = 0.18;          // s — heave velocity x this = metres up
  const LIFT_TAU = 0.30;             // s — decay time constant of that heave
  const LIFT_MAX_LOA = 0.30;         // x loa — cap on the heave
  // Free-surface effect: water sloshing inside a hull kills its stiffness.
  // A swamping boat gets tender and then rolls over, which is exactly how
  // small boats are actually lost.
  const FREE_SURFACE = 0.85;         // gm multiplier lost at swamp = 1
  const SWAMP_DRAIN = 1 / 3;         // x the fill rate, when NOT shipping water
  const INVERT_LEAK = 8;             // x swampT — how long a turtled hull's
                                     // trapped air holds it up before it fills
  const SELF_RIGHT_RATE = 0.8;       // rad/s — how fast a self-righting hull
                                     // is rolled back over once it starts
  const SWAMP_DROP = 0.75;           // x freeboard — how much lower a full hull sits
  // How much lower an INVERTED hull sits. Deliberately small, and the reason
  // is geometric: rolling to pi has ALREADY put the keel up and the deck
  // down, so the hull is showing its bottom without any help. Dropping it by
  // a whole freeboard on top of that (the first cut did) simply BURIES the
  // keel and you photograph a hull with nothing above the water. What is
  // actually true is that a turtled hull floats a little deeper, because the
  // volume now doing the displacing is the superstructure and it is a worse
  // shape for the job.
  const CAPSIZE_DROP_DRAFT = 0.30;   // x draft
  const CAPSIZE_DROP_FB = 0.20;      // x freeboard
  // A hull past its vanishing angle is a bluff body being dragged sideways
  // through water, not a hull rolling on its lines: its damping is several
  // times what the upright ODE uses. Without this she arrives at the inverted
  // point with the excess energy the impulse gave her and rocks 60 degrees
  // either side of it for seconds, which reads as a boat wallowing, not a
  // boat that has capsized.
  const CAPSIZE_DAMP = 3.5;
  const SPLASH_NEAR_M = 30;          // m — the player feels a capsize this close

  const PI = Math.PI;
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function smoothstep(a, b, x) {
    if (b <= a) return x < a ? 0 : 1;
    const t = clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  }
  function wrapPi(a) {
    while (a > PI) a -= 2 * PI;
    while (a < -PI) a += 2 * PI;
    return a;
  }
  function seaAt(x, z) {
    if (CBZ.citySeaHeightAt) { const y = CBZ.citySeaHeightAt(x, z); if (Number.isFinite(y)) return y; }
    return CBZ.waterSeaY ? CBZ.waterSeaY() : (CBZ.SEA_Y != null ? CBZ.SEA_Y : -0.48);
  }

  // ============================================================
  //  1. THE STABILITY NUMBERS — spec.stab, or a default that never throws
  // ============================================================
  // world/water_hulls.js's deriveSpec() carries `stab` for every registered
  // hull. This table is the degrade path for a spec that predates it, for a
  // hull registered by another package, and for a record whose spec never
  // resolved at all — feature-detected at CALL time, so the two can land in
  // either order and neither breaks the other.
  //
  // gm/phiV are the wave contract's authored numbers. freeboard is the sheer
  // above the waterline amidships; swampT is seconds of green water before
  // the hull is full. selfRight is seconds inverted before a hull that CAN
  // come back does (a PWC rolls back upright; a turtled kayak does not, and
  // that turtled kayak is the read from the beach).
  const STAB_TABLE = {
    kayak:        { gm: 0.05, phiV: 0.70, freeboard: 0.18, swampT: 2,   selfRight: 0 },
    jetski:       { gm: 0.25, phiV: 1.00, freeboard: 0.28, swampT: 4,   selfRight: 5 },
    skiff:        { gm: 0.35, phiV: 0.95, freeboard: 0.45, swampT: 5,   selfRight: 0 },
    dinghy:       { gm: 0.60, phiV: 1.15, freeboard: 0.50, swampT: 20,  selfRight: 0 },
    boat:         { gm: 0.90, phiV: 1.25, freeboard: 0.62, swampT: 14,  selfRight: 0 },
    console:      { gm: 0.90, phiV: 1.20, freeboard: 0.70, swampT: 18,  selfRight: 0 },
    pirate_skiff: { gm: 0.50, phiV: 1.05, freeboard: 0.55, swampT: 8,   selfRight: 0 },
    sloop:        { gm: 0.80, phiV: 2.10, freeboard: 0.75, swampT: 40,  selfRight: 0 },
    sportfish:    { gm: 1.20, phiV: 1.40, freeboard: 0.95, swampT: 50,  selfRight: 0 },
    cruiser:      { gm: 1.40, phiV: 1.45, freeboard: 1.05, swampT: 60,  selfRight: 0 },
    trawler:      { gm: 1.00, phiV: 1.30, freeboard: 1.20, swampT: 90,  selfRight: 0 },
    yacht:        { gm: 2.40, phiV: 1.90, freeboard: 1.60, swampT: 999, selfRight: 0 },
    yacht46:      { gm: 3.00, phiV: 2.00, freeboard: 1.90, swampT: 999, selfRight: 0 },
    yacht88:      { gm: 3.00, phiV: 2.00, freeboard: 2.40, swampT: 999, selfRight: 0 },
    yacht156:     { gm: 3.00, phiV: 2.00, freeboard: 3.00, swampT: 999, selfRight: 0 },
  };
  // An unknown key falls back to LENGTH, which is the one thing every record
  // has. Anchored on the four hulls that existed before this wave, linearly
  // interpolated, clamped at the ends. Deliberately excludes the outliers
  // (a kayak is not a short RIB) — those are named rows above.
  const STAB_BY_LOA = [
    { loa: 4.5,  gm: 0.60, phiV: 1.15, freeboard: 0.50, swampT: 20 },
    { loa: 6.2,  gm: 0.90, phiV: 1.25, freeboard: 0.62, swampT: 14 },
    { loa: 14.0, gm: 1.40, phiV: 1.45, freeboard: 1.05, swampT: 60 },
    { loa: 34.0, gm: 2.40, phiV: 1.90, freeboard: 1.60, swampT: 999 },
  ];
  function stabByLoa(loa) {
    const A = STAB_BY_LOA;
    if (!(loa > A[0].loa)) return A[0];
    for (let i = 1; i < A.length; i++) {
      if (loa <= A[i].loa) {
        const a = A[i - 1], b = A[i];
        const t = (loa - a.loa) / (b.loa - a.loa);
        return {
          gm: a.gm + (b.gm - a.gm) * t,
          phiV: a.phiV + (b.phiV - a.phiV) * t,
          freeboard: a.freeboard + (b.freeboard - a.freeboard) * t,
          swampT: a.swampT + (b.swampT - a.swampT) * t,
        };
      }
    }
    return A[A.length - 1];
  }

  function specOf(rec) {
    if (!rec) return null;
    if (rec._hullSpec) return rec._hullSpec;
    if (CBZ.marineHulls && CBZ.marineHulls.specFor) {
      try { return CBZ.marineHulls.specFor(rec); } catch (e) { /* not a boat */ }
    }
    return null;
  }
  function keyOf(rec, spec) {
    if (spec && spec.key) return spec.key;
    const ud = rec && rec.group && rec.group.userData;
    if (ud && ud.hullKey) return ud.hullKey;
    if (rec && rec.detailStyle) return rec.detailStyle;
    return null;
  }
  // The one place the geometry of a hull is resolved. Everything downstream
  // reads this, so a record with no spec at all still gets honest numbers.
  function geomOf(rec) {
    const S = specOf(rec);
    const loa = (S && S.loa > 0.5) ? S.loa
      : ((rec.model && (+rec.model.len || +rec.model.length)) || 5.4);
    const beam = (S && S.beam > 0.2) ? S.beam
      : ((rec.model && (+rec.model.width || +rec.model.beam)) || 2.1);
    const draft = (S && S.draft > 0) ? S.draft : Math.max(0.15, beam * 0.22);
    // Displacement. A hull with no declared tonnage gets Archimedes on its own
    // block: loa*beam*draft * a 0.45 block coefficient * seawater density.
    const massT = (S && S.massT > 0) ? S.massT : Math.max(0.02, loa * beam * draft * 0.45 * 1.025);
    let st = (S && S.stab) || STAB_TABLE[keyOf(rec, S)] || null;
    if (!st) st = stabByLoa(loa);
    return {
      loa: loa, beam: beam, draft: draft, massT: massT,
      gm: st.gm > 0 ? st.gm : 0.5,
      phiV: st.phiV > 0.1 ? st.phiV : 1.15,
      freeboard: st.freeboard > 0 ? st.freeboard : Math.max(0.15, beam * 0.24),
      swampT: st.swampT > 0 ? st.swampT : 20,
      selfRight: +st.selfRight || 0,
      rideAbove: (S && S.rideAbove != null) ? S.rideAbove : 0.06,
    };
  }

  // ============================================================
  //  2. THE STATE
  // ============================================================
  const AUDIT = {
    impulses: 0, capsizes: 0, swamps: 0, floods: 0, righted: 0,
    biggestPhi: 0, lastFrom: null, live: 0,
  };

  function makeState(rec) {
    const g = geomOf(rec);
    const st = {
      phi: 0, phiDot: 0, capsized: false, swamp: 0, flooded: false, t: 0,
      maxPhi: 0, overT: 0, lift: 0, handedOff: false, lastFrom: null,
      // resolved geometry, refreshed whenever the spec changes underneath us
      g: g,
      I: Math.max(1e-6, g.massT * Math.pow(GYR_BEAM * g.beam, 2)),
      spec: specOf(rec),
    };
    rec._stab = st;
    AUDIT.live++;
    return st;
  }
  function stateOf(rec) {
    if (!rec) return null;
    let st = rec._stab;
    if (!st) st = makeState(rec);
    else {
      const S = specOf(rec);
      if (S !== st.spec) {          // the style cycler can change the hull
        st.spec = S; st.g = geomOf(rec);
        st.I = Math.max(1e-6, st.g.massT * Math.pow(GYR_BEAM * st.g.beam, 2));
      }
    }
    return st;
  }

  // ============================================================
  //  3. THE RIGHTING ARM
  // ============================================================
  // GZ(phi) = gm * sin(phi) * k(|phi|). One odd function; both branches and
  // the inverted equilibrium fall out of it. k is +1 up to GZ_KNEE*phiV,
  // crosses zero at phiV and holds at -INV_GM_FRAC beyond.
  function gzShape(a, phiV) {
    const s = smoothstep(GZ_KNEE * phiV, GZ_FAR * phiV, a);
    return Math.max(-INV_GM_FRAC, 1 - (1 + INV_GM_FRAC) * s);
  }
  function rightingArm(phi, gm, phiV) {
    return gm * Math.sin(phi) * gzShape(Math.abs(phi), phiV);
  }
  // Published so a test (or a future GZ-curve HUD) reads the same maths the
  // integrator does rather than a second copy of it.
  CBZ.hullRightingArm = function (rec, phi) {
    const st = stateOf(rec); if (!st) return 0;
    return rightingArm(phi, st.g.gm * (1 - FREE_SURFACE * st.swamp), st.g.phiV);
  };

  function rateCap(loa) { return ROLL_RATE_REF / Math.sqrt(Math.max(0.5, loa / ROLL_RATE_LOA)); }
  // The roll rate that exactly reaches phiV from upright: sqrt(2*E/I), where
  // E = disp*g * integral(GZ) from 0 to phiV — the area under the righting
  // curve, i.e. the hull's DYNAMIC stability. Integrated numerically off the
  // same rightingArm() the ODE uses, so the two can never disagree.
  const BARRIER_N = 24;
  function capsizeRate(st, gm) {
    const g = st.g, h = g.phiV / BARRIER_N;
    let area = 0;
    for (let i = 0; i < BARRIER_N; i++) area += rightingArm((i + 0.5) * h, gm, g.phiV) * h;
    const E = g.massT * G * Math.max(1e-9, area);
    return Math.sqrt(2 * E / st.I);
  }

  // ============================================================
  //  4. THE TICK
  // ============================================================
  function gunwaleAngle(g) { return Math.atan2(g.freeboard, Math.max(0.05, g.beam * 0.5)); }

  // Is green water coming aboard right now? Two ways, and a hull only needs
  // one: the rail is heeled under, or the sea itself is over the sheer at the
  // low rail (the crest that fills a swamped boat the rest of the way).
  function shippingWater(rec, st) {
    const g = st.g;
    if (Math.abs(st.phi) > gunwaleAngle(g)) return true;
    const p = rec.pos || (rec.group && rec.group.position);
    if (!p || !CBZ.citySeaHeightAt) return false;
    const h = rec.heading || 0;
    // low rail = the side the hull is leaning toward. phi > 0 is starboard
    // down, and local +X is PORT, so the low rail is at -sign(phi) * +X.
    const rx = Math.cos(h), rz = -Math.sin(h);       // hull local +X in world
    const sgn = st.phi >= 0 ? -1 : 1;
    const hb = g.beam * 0.5;
    const lx = p.x + rx * hb * sgn, lz = p.z + rz * hb * sgn;
    const railY = (rec.group ? rec.group.position.y : p.y)
      + g.freeboard * Math.cos(st.phi) - hb * Math.abs(Math.sin(st.phi));
    return seaAt(lx, lz) > railY;
  }

  function tick(rec, dt) {
    if (!rec || !(dt > 0)) return null;
    const st = rec._stab;
    if (!st) return null;                    // lazy: nothing has touched it
    dt = Math.min(dt, MAX_DT);
    st.t += dt;
    st.lift *= Math.exp(-dt / LIFT_TAU);
    if (st.lift < 1e-4) st.lift = 0;
    rec._stabLift = st.lift;

    const g = st.g;
    // Free-surface: water inside the hull eats the metacentric height.
    const gm = Math.max(0.01, g.gm * (1 - FREE_SURFACE * st.swamp));
    const disp = g.massT;
    const K = disp * G * gm;                 // kN*m per radian at small angles
    const I = st.I;
    const bluff = Math.abs(st.phi) > g.phiV ? CAPSIZE_DAMP : 1;
    const cL = DAMP_L * Math.sqrt(Math.max(1e-9, I * K)) * bluff;
    const cQ = DAMP_Q * I * bluff;

    // A hull that CAN come back does, after a beat inverted — a PWC rights
    // itself when the rider swims it over. Everything else stays turtled.
    let selfRoll = false;
    if (st.capsized && !st.flooded && g.selfRight > 0) {
      st.overT += dt;
      selfRoll = st.overT > g.selfRight;
    } else st.overT = 0;

    // Nothing is happening: skip the ODE entirely (an upright, dry, still
    // hull is the common case and it must cost nothing).
    if (st.phi === 0 && st.phiDot === 0 && st.swamp === 0 && !st.capsized) {
      rec._stabDrop = 0;
      return st;
    }

    const cap = rateCap(g.loa);
    const steps = Math.max(1, Math.ceil(dt / SUB_DT));
    const h = dt / steps;
    const wasOver = Math.abs(st.phi) > g.phiV;
    for (let i = 0; i < steps; i++) {
      if (selfRoll) {
        // A PWC that has gone over is rolled back by hand, and that is a
        // slow deliberate turn — NOT a second capsize in the other
        // direction, which is what a moment big enough to beat the inverted
        // branch actually produces (it whips through zero and turtles again).
        // Driven kinematically for exactly that reason.
        st.phiDot = 0;
        const step = SELF_RIGHT_RATE * h;
        st.phi = Math.abs(st.phi) <= step ? 0 : st.phi - Math.sign(st.phi) * step;
        continue;
      }
      const gz = rightingArm(st.phi, gm, g.phiV);
      const M = -disp * G * gz - cL * st.phiDot - cQ * st.phiDot * Math.abs(st.phiDot);
      st.phiDot += (M / I) * h;
      st.phiDot = clamp(st.phiDot, -cap, cap);
      st.phi = wrapPi(st.phi + st.phiDot * h);
    }
    if (!Number.isFinite(st.phi) || !Number.isFinite(st.phiDot)) { st.phi = 0; st.phiDot = 0; }
    const a = Math.abs(st.phi);
    if (a > st.maxPhi) st.maxPhi = a;
    if (a > AUDIT.biggestPhi) AUDIT.biggestPhi = a;

    // ---- the capsize event ------------------------------------------------
    if (!wasOver && a > g.phiV && !st.capsized) capsizeEvent(rec, st);
    // Righted by physics (self-righting hull, or somebody hit it back over).
    if (st.capsized && a < g.phiV * 0.6) {
      st.capsized = false; st.overT = 0;
      rec.engineDead = false; rec._helmDead = false;
      AUDIT.righted++;
    }

    // ---- green water ------------------------------------------------------
    // An INVERTED hull is not shipping green water — it is sitting on a
    // trapped bubble, which is precisely why a capsized boat floats keel-up
    // for so long. It only waterlogs, slowly, as that air leaks out. Using
    // the heel test here instead would drown every turtled hull in one
    // swampT and there would be no turtled kayak to see from the beach.
    if (!st.flooded) {
      if (st.capsized) {
        st.swamp = Math.min(1, st.swamp + dt / (g.swampT * INVERT_LEAK));
      } else if (shippingWater(rec, st)) {
        if (st.swamp === 0) AUDIT.swamps++;
        st.swamp = Math.min(1, st.swamp + dt / g.swampT);
      } else if (st.swamp > 0) {
        st.swamp = Math.max(0, st.swamp - (dt / g.swampT) * SWAMP_DRAIN);
      }
      if (st.swamp >= 1) floodEvent(rec, st);
    }

    // ---- how the ride reads this frame ------------------------------------
    rec._stabDrop = dropOf(st);
    return st;
  }

  function dropOf(st) {
    const g = st.g;
    let d = st.swamp * g.freeboard * SWAMP_DROP;
    if (st.capsized) d += CAPSIZE_DROP_DRAFT * g.draft + CAPSIZE_DROP_FB * g.freeboard;
    return d;
  }

  // ============================================================
  //  5. THE EVENTS
  // ============================================================
  function capsizeEvent(rec, st) {
    st.capsized = true;
    st.overT = 0;
    AUDIT.capsizes++;
    AUDIT.lastFrom = st.lastFrom;
    // The engine is finished. The HULL is not — it floats inverted.
    rec.engineDead = true;
    rec.v = 0; rec.vx = 0; rec.vz = 0;
    rec._planing = 0;
    rec._helmDead = true;             // water_helm.js refuses a turtled hull
    const p = rec.pos || (rec.group && rec.group.position);
    if (!p) return;
    const g = st.g;
    const sy = seaAt(p.x, p.z);
    // White water at BOTH rails — the hull is dumping its whole beam into
    // the sea, not making one splash.
    if (typeof CBZ.waterSplashAt === "function") {
      const h = rec.heading || 0;
      const rx = Math.cos(h), rz = -Math.sin(h);
      const hb = g.beam * 0.5;
      const power = 1.5 + g.loa * 0.15;
      try {
        CBZ.waterSplashAt(p.x + rx * hb, sy, p.z + rz * hb, power);
        CBZ.waterSplashAt(p.x - rx * hb, sy, p.z - rz * hb, power);
      } catch (e) {}
    }
    if (typeof CBZ.shake === "function" && CBZ.player && CBZ.player.pos) {
      const d = Math.hypot(CBZ.player.pos.x - p.x, CBZ.player.pos.z - p.z);
      if (d < SPLASH_NEAR_M) {
        try { CBZ.shake(clamp(0.55 * (1 - d / SPLASH_NEAR_M) + 0.15, 0, 0.8)); } catch (e) {}
      }
    }
    // AND THE PEOPLE GO IN THE WATER. sea_craft.js owns its own crew; for a
    // cityCars hull we do it here, with the philosophy marine_predation's
    // throwOccupants already set: hurt, ALIVE, and in the sea. No killfeed
    // line and no toast — the owner reads this off the screen, not off text.
    if (typeof CBZ.hullOccupantsOverboard === "function") {
      try { CBZ.hullOccupantsOverboard(rec); } catch (e) {}
    } else dumpCityOccupants(rec, st);
  }

  // The city-side occupant dump. Deliberately NOT a call into
  // marine_predation.js: that function is private to a bite sequence and
  // takes a bite line. Same philosophy, this file's own three cases.
  function dumpCityOccupants(rec, st) {
    const p = rec.pos || (rec.group && rec.group.position);
    if (!p) return;
    const g = st.g;
    const sy = seaAt(p.x, p.z);
    const h = rec.heading || 0;
    const rx = Math.cos(h), rz = -Math.sin(h);      // hull local +X (port)
    // Everybody goes over the LOW rail, which is the side that went under.
    const sgn = st.phi >= 0 ? -1 : 1;
    let n = 0;
    const place = function (q) {
      const off = g.beam * 0.55 + 0.6 + n * 0.85;
      q.pos.x = p.x + rx * off * sgn + Math.sin(h) * (n % 2 ? 0.9 : -0.9);
      q.pos.z = p.z + rz * off * sgn + Math.cos(h) * (n % 2 ? 0.9 : -0.9);
      q.pos.y = sy - 0.28;
      n++;
    };
    // THEY GO IN HURT AND THEY GO IN ALIVE — marine_predation.js's philosophy
    // for the same beat, and for the same reason: what makes this read is men
    // in the water, and the sea finishes them, not this function. No
    // No CBZ.body.hit: that is the BULLET/BLUNT-TRAUMA bus, and it fires the
    // blood burst and the ragdoll that go with being shot. Going over a rail
    // is neither. A ragdoll started over open ocean also flops on the
    // invisible y = 0 floor peds.js hands it, when world/water_float.js's
    // living-ped lift is what should own a body in the sea. The hp drop IS
    // the injury; the sea does the rest.
    const hurt = function (q) {
      const mx = (+q.maxHp > 0) ? +q.maxHp : 100;
      const to = Math.round(mx * 0.55);
      if (q.hp == null || q.hp > to) q.hp = to;
    };
    // 1. the NPC at the wheel
    const drv = rec.npcDriver;
    if (drv && !drv.dead && drv.pos) {
      drv.inCar = null; rec.npcDriver = null;
      place(drv); hurt(drv);
    }
    // 2. anybody aboard
    const peds = CBZ.cityPeds;
    if (peds) {
      const R = g.loa * 0.6;
      for (let i = 0; i < peds.length; i++) {
        const q = peds[i];
        if (!q || q.dead || !q.pos) continue;
        if (q.inCar !== rec) {
          const dx = q.pos.x - p.x, dz = q.pos.z - p.z;
          if (dx * dx + dz * dz > R * R) continue;
          if (q.inCar) continue;                   // aboard something else
        }
        q.inCar = null;
        place(q); hurt(q);
      }
    }
    // 3. THE PLAYER. Out through the one exit path, then into the sea beside
    //    the hull so city/swim.js claims him next frame (his feet are under
    //    the live surface, which is the only test that file makes).
    if (rec.player && CBZ.player && CBZ.player.driving && typeof CBZ.cityExitVehicle === "function") {
      try { CBZ.cityExitVehicle(); } catch (e) {}
      const P = CBZ.player.pos;
      if (P) {
        const off = g.beam * 0.6 + 0.9;
        P.x = p.x + rx * off * sgn;
        P.z = p.z + rz * off * sgn;
        P.y = sy - 0.3;
        CBZ.player.vy = 0;
        CBZ.player.grounded = false;
        if (CBZ.playerChar && CBZ.playerChar.group) {
          CBZ.playerChar.group.position.set(P.x, P.y, P.z);
          CBZ.playerChar.group.visible = true;
        }
      }
    }
  }

  // Full of water: buoyancy is gone and the hull belongs to the sinking
  // owner that already exists. We do not write a second sink arc.
  function floodEvent(rec, st) {
    if (st.flooded) return;
    st.flooded = true;
    st.swamp = 1;
    AUDIT.floods++;
    rec.engineDead = true;
    rec._helmDead = true;
    rec.v = 0; rec.vx = 0; rec.vz = 0;
    if (!st.capsized && typeof CBZ.hullOccupantsOverboard !== "function") {
      // A boat that fills without going over still puts its people in the
      // water; a capsize has already done it.
      dumpCityOccupants(rec, st);
    } else if (!st.capsized && typeof CBZ.hullOccupantsOverboard === "function") {
      try { CBZ.hullOccupantsOverboard(rec); } catch (e) {}
    }
    if (st.handedOff) return;
    st.handedOff = true;
    if (rec._seaCraft && CBZ.seaCraft && typeof CBZ.seaCraft.hurt === "function") {
      try { CBZ.seaCraft.hurt(rec, 1e9, { flood: true }); } catch (e) {}
      return;
    }
    // cityCars: world/water_float.js adopts any DEAD hull over water and
    // gives it a real settling arc (water_float.js:482-520). Three fields is
    // the whole handshake.
    rec.dead = true;
    rec.abandoned = true;
    rec.v = 0;
  }

  // ============================================================
  //  6. THE PUBLIC SEAM
  // ============================================================
  CBZ.hullStab = function (rec) { return stateOf(rec); };
  CBZ.hullStabTick = tick;
  CBZ.hullCapsized = function (rec) { return !!(rec && rec._stab && rec._stab.capsized); };
  CBZ.hullStabRoll = function (rec) {
    const st = rec && rec._stab;
    return st && Number.isFinite(st.phi) ? st.phi : 0;
  };
  CBZ.hullStabDrop = function (rec) {
    const st = rec && rec._stab;
    return st ? dropOf(st) : 0;
  };
  CBZ.hullStabLift = function (rec) {
    const st = rec && rec._stab;
    return st ? st.lift : 0;
  };

  /* A HEELING IMPULSE.
       moment  kN*m, sustained for o.dur seconds (default IMPULSE_DUR_S).
               POSITIVE rolls the hull to STARBOARD (port rail up) — the same
               sense as water_helm's _roll; see the header for the derivation.
       o.x/o.z world point of the push. Given, it decides the SIGN: a push
               landing on the PORT side rolls the hull to starboard, away
               from whatever hit it, so a caller can hand over a positive
               magnitude and a place and never think about signs. (Same rule
               for a body surfacing underneath: it lifts the side it comes up
               under, and the hull goes over the other way.)
       o.from  "ram" | "under" | "wave" | "crew" — bookkeeping, plus: "under"
               also HEAVES the hull, so a shark coming up beneath a kayak
               throws it up and over rather than merely leaning on it.
       o.dur   seconds of contact, if the caller knows better.
     Returns the new phi. */
  CBZ.hullHeelImpulse = function (rec, moment, o) {
    const st = stateOf(rec);
    if (!st || !Number.isFinite(moment) || moment === 0) return st ? st.phi : 0;
    o = o || {};
    const g = st.g;
    let m = moment;
    const p = rec.pos || (rec.group && rec.group.position);
    if (p && Number.isFinite(o.x) && Number.isFinite(o.z)) {
      const h = rec.heading || 0;
      const rx = Math.cos(h), rz = -Math.sin(h);          // hull local +X = PORT
      const side = (o.x - p.x) * rx + (o.z - p.z) * rz;   // >0: the push is to port
      // A push to port rolls her to starboard (+phi); to starboard, to port.
      if (side !== 0) m = Math.abs(moment) * (side > 0 ? 1 : -1);
    }
    const dur = (o.dur > 0) ? Math.min(1, o.dur) : IMPULSE_DUR_S;
    // 1 kN*m == 1 t*m^2/s^2 and I is in t*m^2, so this is already rad/s.
    const dPhiDot = (m * dur) / st.I;
    // Two ceilings: the hull's own maximum roll rate (a 34 m yacht does not
    // snap-roll), and the energy ceiling that stops a huge impulse turning a
    // 30 kg kayak into a pinwheel.
    const gmNow = Math.max(0.01, g.gm * (1 - FREE_SURFACE * st.swamp));
    const cap = Math.min(rateCap(g.loa), capsizeRate(st, gmNow) * OVER_MARGIN);
    st.phiDot = clamp(st.phiDot + dPhiDot, -cap, cap);
    st.lastFrom = o.from || "ram";
    AUDIT.impulses++;
    AUDIT.lastFrom = st.lastFrom;

    if (o.from === "under") {
      // Angular impulse / (displacement * half-beam) is a heave VELOCITY in
      // m/s; times the rise time is the metres of lift the hull actually
      // gets. Units check: (t*m^2/s) / (t*m) = m/s.
      const vHeave = Math.abs(m * dur) / Math.max(1e-6, g.massT * g.beam * 0.5);
      const lift = Math.min(vHeave * LIFT_RISE_S, g.loa * LIFT_MAX_LOA);
      if (lift > st.lift) st.lift = lift;
      rec._stabLift = st.lift;
    }
    // Resolve the first slice of the swing now so a caller that reads the
    // return value gets a phi that has actually moved.
    tick(rec, Math.min(SUB_DT, 1 / 60));
    return st.phi;
  };

  // Force it over. Used by the tests and by any beat that has decided the
  // boat goes over (the engulf run-up) rather than asking the physics.
  CBZ.hullCapsize = function (rec, o) {
    const st = stateOf(rec);
    if (!st) return 0;
    o = o || {};
    const g = st.g;
    let sgn = (o.dir < 0 || o.side === "port") ? -1 : 1;
    const p = rec.pos || (rec.group && rec.group.position);
    if (p && Number.isFinite(o.x) && Number.isFinite(o.z)) {
      const h = rec.heading || 0;
      const side = (o.x - p.x) * Math.cos(h) + (o.z - p.z) * (-Math.sin(h));
      if (side !== 0) sgn = side > 0 ? 1 : -1;
    }
    st.lastFrom = o.from || "forced";
    st.phi = sgn * (g.phiV + 0.05);
    st.phiDot = sgn * capsizeRate(st, g.gm) * 0.5;
    if (!st.capsized) capsizeEvent(rec, st);
    return st.phi;
  };

  CBZ.hullRight = function (rec) {
    const st = rec && rec._stab;
    if (!st) return false;
    st.phi = 0; st.phiDot = 0; st.overT = 0; st.lift = 0;
    if (st.capsized) { st.capsized = false; AUDIT.righted++; }
    rec.engineDead = false;
    rec._helmDead = false;
    rec._stabDrop = st.swamp * st.g.freeboard * SWAMP_DROP;
    rec._stabLift = 0;
    return true;
  };

  // Green water aboard: `seconds` of it, which is exactly the unit swampT is
  // written in. A bite that holes a hull calls this with the seconds the hole
  // is worth; the wave crest path in tick() calls the same accumulator.
  CBZ.hullSwampAdd = function (rec, seconds) {
    const st = stateOf(rec);
    if (!st || !(seconds > 0)) return st ? st.swamp : 0;
    if (st.flooded) return 1;
    if (st.swamp === 0) AUDIT.swamps++;
    st.swamp = Math.min(1, st.swamp + seconds / st.g.swampT);
    if (st.swamp >= 1) floodEvent(rec, st);
    rec._stabDrop = dropOf(st);
    return st.swamp;
  };

  /* THE AUDIT. The before/after preset reads THIS — the file measuring
     itself — rather than re-deriving degrees from a quaternion it can only
     guess the composition of. `reset` zeroes the counters, which is what a
     preset staging several subjects in one page needs between shots. */
  CBZ.hullStabAudit = function (opts) {
    const out = {
      impulses: AUDIT.impulses, capsizes: AUDIT.capsizes, swamps: AUDIT.swamps,
      floods: AUDIT.floods, righted: AUDIT.righted, live: AUDIT.live,
      biggestPhi: AUDIT.biggestPhi,
      biggestPhiDeg: AUDIT.biggestPhi * 180 / Math.PI,
      lastFrom: AUDIT.lastFrom,
    };
    if (opts && opts.reset) {
      AUDIT.impulses = 0; AUDIT.capsizes = 0; AUDIT.swamps = 0;
      AUDIT.floods = 0; AUDIT.righted = 0; AUDIT.biggestPhi = 0; AUDIT.lastFrom = null;
    }
    return out;
  };

  // ============================================================
  //  7. THE PASS — order 38.4, one tick before water_buoyancy (38.5)
  // ============================================================
  // Only hulls that already carry state are ticked, so this loop is a length
  // check and a truthy test for every boat nobody has touched.
  if (typeof CBZ.onUpdate === "function") {
    CBZ.onUpdate(38.4, function (dt) {
      const cars = CBZ.cityCars;
      if (!cars || !cars.length || !(dt > 0)) return;
      for (let i = 0; i < cars.length; i++) {
        const c = cars[i];
        if (!c || !c._stab || !c.group) continue;
        tick(c, dt);
      }
    });
  }
})();
