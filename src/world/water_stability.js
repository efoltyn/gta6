/* ============================================================
   src/world/water_stability.js — HOW A HULL SITS IN MOVING WATER.

   Every hull in the water, every frame: heave, pitch and roll as damped
   oscillators whose periods come from the hull's own numbers (loa, beam,
   draft, massT, stab.gm), driven by the water sampled at five points of the
   hull; flight and slamming when the water falls away faster than buoyancy
   can follow; the water's own flow carrying the hull; grounding; green water;
   capsize. Section 4 has the model and the numbers by hull size.

   ROLL keeps its naval-architecture core:
     I * phiDD = -disp*g*GZ(phi - target) - cL*w - cQ*w*|w| + M_ext
   target = the across-hull water slope + the turn/sail heel; w is the roll
   rate relative to the water's. GZ is the righting arm:
     • small angles: GZ = gm*sin(phi)          (gm = metacentric height)
     • past 0.6*phiV it falls away, crossing zero at phiV, the ANGLE OF
       VANISHING STABILITY;
     • past phiV it is negative out to +-PI, where it crosses zero again: THE
       INVERTED STABLE POINT. A turtled hull sits there at INV_GM_FRAC of the
       upright stiffness; a hull whose spec declares `selfRight` (a PWC) is
       rolled back after a few seconds.
   One odd function: GZ(phi) = gm * sin(phi) * k(|phi|).

   UNITS: mass in TONNES. I is t*m^2, 1 kN*m == 1 t*m^2/s^2, so kN*m / I is
   already rad/s^2. No 1000s anywhere.

   SIGN: the hull's local +Z is the bow and +X is PORT; a positive rotation
   about +Z lifts the port rail. POSITIVE phi = heeled to STARBOARD. The same
   sense as water_helm's `_roll` and water_float's `yPort` probe.

   THE SEAM
     CBZ.hullSeakeep(rec, dt)             -> integrate one frame; the state
                                             carries Y (origin height), th
                                             (pitch, bow up +), phi (roll), air
     CBZ.hullStab(rec)                    -> the state object
     CBZ.hullHeelImpulse(rec, moment, o)  -> heel it; returns the new phi
     CBZ.hullCapsize(rec, o) / hullCapsized(rec) / hullRight(rec)
     CBZ.hullSwampAdd(rec, seconds)       -> green water aboard
     CBZ.hullStabRoll / hullStabDrop / hullStabLift (rec)
     CBZ.hullStabAudit(opts), CBZ.hullSeakeepAudit(rec)

   `rec` is anything with .group, .pos, .heading and ._hullSpec: a
   city/vehicles.js car (water_buoyancy.js calls seakeep) and a
   world/sea_craft.js record (its ride() calls seakeep) both qualify.
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
    slams: 0, launches: 0, breakouts: 0,
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
      // seakeeping (section 4)
      init: false, Y: 0, Yv: 0, Yt0: 0, th: 0, thv: 0, alpha: 0,
      zeta0: 0, beta0: 0, alpha0: 0, yBow: 0, yPo: 0, ySt: 0,
      air: false, airT: 0, grounded: false, slamCD: 0, slams: 0, launches: 0, maxTh: 0,
      cvx: 0, cvz: 0, load: 0,
      Teq: 0.1, wh: 6, wp: 7, kdLong: 1, kdLat: 1,
    };
    skDerive(st);
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
        skDerive(st);
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
  //  4. SEAKEEPING — heave, pitch and roll from the hull's own numbers
  // ============================================================
  /* Every hull in the water is three damped oscillators driven by the water
     under it, and nothing in here knows what kind of boat it is:

     SAMPLED where the hull is: centre, bow and stern (+-0.36 loa), both
     sides (+-0.38 beam), through CBZ.waterSample (the sea, rings, a tsunami
     bore or a flood, plus every OTHER hull's wake). The mean of those points
     is what the hull feels, so a long hull averages out chop shorter than
     itself and answers only the long waves; a jetski feels every one.

     HEAVE. Waterplane Awp = 0.72 loa beam, equivalent draft Teq = massT /
     (1.025 Awp), stiffness per unit mass g / (Teq (1 + added mass 0.8)):
     periods kayak 0.54 s, PWC 0.97 s, 6 m runabout 1.1 s, 14 m cruiser
     1.6 s, 140 m freighter 6.7 s. Damping is on the motion RELATIVE to the
     water (radiation), 35% of critical (more on the plane). Water can only push UP: once the
     hull's bottom is clear of the surface (it rose more than Teq above its
     floating line) the only force is gravity, so a fast light hull that
     meets a crest at speed leaves the water, flies, and slams back.
     Planing lift stiffens the ride (x(1 + 1.5 planing)).

     PITCH. The same spring 1.15x faster, toward the along-hull surface slope
     plus the hull's own running trim. Airborne, it keeps its rate (the bow
     drops slowly) and snaps to the water on landing.

     ROLL. I phi'' = -disp g GZ(phi - alpha - heel) - damping + impulses, with
     alpha the across-hull surface slope, heel the turn/sail heel, and GZ the
     righting arm below. Period 0.80 beam / sqrt(gm): kayak 2.6 s, PWC
     1.9 s, runabout 1.8 s, cruiser 2.8 s, freighter 9.8 s. Capsize is the
     hull's angle RELATIVE TO THE WATER past phiV (a broaching hull on a
     steep face goes over; one heeled with a wave does not).

     THE WATER MOVES THE HULL TOO. The water's own velocity (current, surge,
     a tsunami's flow, backwash) drags the hull with drag on the relative
     velocity scaled by wetted area over mass (beam-on uses loa x draft,
     head-on beam x draft): a kayak is taken at once, a cruiser over seconds,
     a freighter barely. The mover's own speed is through the water, so an
     engine beats a current only if it is stronger. Shear between bow and
     stern turns the hull. Less water than the draft and the hull sits on
     the bed, heeled onto its bilge; it stays where the water leaves it.
     An anchored hull holds until the drag on it passes what a rode holds.
     A hull climbing a face loses way, one running down it surges. */
  const SAMPLE_A = 0.36, SAMPLE_B = 0.38;
  const ADDED_MASS = 0.8, Z_HEAVE = 0.35, Z_PITCH = 0.32;
  const SURGE_K = 0.45;              // fraction of g sin(slope) along the keel
  const ANCHOR_HOLD = 2.5;           // m/s^2 of current drag a rode holds
  const SLAM_CD = 0.25;              // s between slams
  const AIR_NOSE = 0.35;             // rad/s^2 the bow drops while flying
  const AIR_CLEAR = 0.03;            // m of clear air under the keel that is flight
  const AIR_RATE = 1.2;              // rad/s: most pitch rate a hull leaves a crest with
  const AIR_TAU = 0.6;               // s: pitch/roll rate decay in the air (rider, air)

  function skDerive(st) {
    const g = st.g;
    const Awp = 0.72 * g.loa * g.beam;
    st.Teq = Math.max(0.04, g.massT / (1.025 * Awp));
    st.wh = Math.sqrt(G / (st.Teq * (1 + ADDED_MASS)));
    st.wp = st.wh * 1.15;
    // per-tonne drag of the water on the hull (1/m), Cd ~1
    st.kdLong = 0.5 * 1.025 * g.beam * g.draft / Math.max(0.005, g.massT);
    st.kdLat = 0.5 * 1.025 * g.loa * g.draft / Math.max(0.005, g.massT);
  }

  const _c = {}, _bw = {}, _sn = {}, _pt = {}, _sb = {};
  function sample(x, z, out, self) {
    if (CBZ.waterSample) return CBZ.waterSample(x, z, out, self);
    out.y = seaAt(x, z); out.depth = 8; out.vx = 0; out.vz = 0; out.wet = 1; out.wake = 0;
    return out;
  }

  function gunwaleAngle(g) { return Math.atan2(g.freeboard, Math.max(0.05, g.beam * 0.5)); }

  // Green water: the low rail under the sea, or the bow buried in a crest.
  function shippingWater(rec, st, relPhi) {
    const g = st.g;
    if (Math.abs(relPhi) > gunwaleAngle(g)) return true;
    if (!st.init) return false;
    const hb = g.beam * 0.5;
    const railY = st.Y + g.freeboard * Math.cos(st.phi) - hb * Math.abs(Math.sin(st.phi));
    const lowSea = st.phi >= 0 ? st.ySt : st.yPo;      // phi > 0: starboard rail down
    if (lowSea > railY) return true;
    const bowDeck = st.Y + g.freeboard * 1.25 + Math.sin(st.th) * g.loa * SAMPLE_A;
    return st.yBow > bowDeck;
  }

  // The roll ODE alone (impulses resolve their first slice through this).
  function rollStep(rec, st, dt, target, contact, stiff, av) {
    const g = st.g;
    const gm = Math.max(0.01, g.gm * (1 - FREE_SURFACE * st.swamp)) * stiff;
    const disp = g.massT;
    const K = disp * G * gm;
    const I = st.I;
    const rel0 = wrapPi(st.phi - target);
    const bluff = Math.abs(rel0) > g.phiV ? CAPSIZE_DAMP : 1;
    const cL = DAMP_L * Math.sqrt(Math.max(1e-9, I * K)) * bluff;
    const cQ = DAMP_Q * I * bluff;
    let selfRoll = false;
    if (st.capsized && !st.flooded && g.selfRight > 0) {
      st.overT += dt;
      selfRoll = st.overT > g.selfRight;
    } else st.overT = 0;
    const cap = rateCap(g.loa);
    const steps = Math.max(1, Math.ceil(dt / SUB_DT));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      if (selfRoll) {
        // a PWC is rolled back by hand: a slow deliberate turn, kinematic
        st.phiDot = 0;
        const rel = wrapPi(st.phi - target);
        const step = SELF_RIGHT_RATE * h;
        st.phi = Math.abs(rel) <= step ? target : st.phi - Math.sign(rel) * step;
        continue;
      }
      const rel = wrapPi(st.phi - target);
      const gz = contact ? rightingArm(rel, gm, g.phiV) : 0;
      // the waves roll her through the righting arm (the water's slope is in
      // `target`); damping is on her own roll rate
      const w = st.phiDot;
      const M = -disp * G * gz - (contact ? (cL * w + cQ * w * Math.abs(w)) : 0);
      st.phiDot += (M / I) * h;
      if (!contact) st.phiDot *= Math.exp(-h / AIR_TAU);
      st.phiDot = clamp(st.phiDot, -cap, cap);
      st.phi = wrapPi(st.phi + st.phiDot * h);
    }
    if (!Number.isFinite(st.phi) || !Number.isFinite(st.phiDot)) { st.phi = 0; st.phiDot = 0; }
  }

  function slam(rec, st, vImpact, x, y, z) {
    const g = st.g;
    st.slamCD = SLAM_CD;
    st.slams++;
    AUDIT.slams++;
    const slamV = (st.spec && st.spec.slamV > 0) ? st.spec.slamV : 2.5;
    const sev = clamp((vImpact - slamV * 0.6) / 5, 0, 1);
    // the hull is stopped a little: way lost on every landing
    const keep = 1 - 0.16 * sev;
    if (Number.isFinite(rec.v)) rec.v *= keep;
    if (Number.isFinite(rec.vx)) { rec.vx *= keep; rec.vz *= keep; }
    // the bow is driven down into the water it landed on
    st.thv -= 0.6 * sev;
    if (CBZ.waterHit) {
      try {
        CBZ.waterHit(x, y, z, {
          kind: "vehicle", mass: g.massT * 1000 * 0.5, speed: vImpact,
          vx: rec.vx || 0, vz: rec.vz || 0, src: rec, quiet: vImpact < 3,
        });
      } catch (e) {}
    }
    if (rec.player && CBZ.shake) { try { CBZ.shake(Math.min(0.85, 0.15 + 0.6 * sev)); } catch (e) {} }
    rec._slamT = 0;
    rec._slamSev = sev;
  }

  /* CBZ.hullSeakeep(rec, dt) -> the state, with st.Y (the hull origin's
     height), st.th (pitch, bow up +), st.phi (roll, port rail up +), st.air.
     Movers call it once per frame after they moved the hull. */
  function seakeep(rec, dt) {
    if (!rec || !(dt > 0)) return null;
    const st = stateOf(rec);
    if (!st) return null;
    dt = Math.min(dt, 0.1);
    st.t += dt;
    st.lift *= Math.exp(-dt / LIFT_TAU);
    if (st.lift < 1e-4) st.lift = 0;
    rec._stabLift = st.lift;
    if (st.slamCD > 0) st.slamCD -= dt;
    const g = st.g;
    const p = rec.pos || (rec.group && rec.group.position);
    if (!p) return st;
    const hd = rec.heading || 0;
    const fx = Math.sin(hd), fz = Math.cos(hd);
    const rx = fz, rz = -fx;                       // hull local +X = PORT
    const a = g.loa * SAMPLE_A, b = g.beam * SAMPLE_B;
    sample(p.x, p.z, _c, rec);
    sample(p.x + fx * a, p.z + fz * a, _bw, rec);
    sample(p.x - fx * a, p.z - fz * a, _sn, rec);
    sample(p.x + rx * b, p.z + rz * b, _pt, rec);
    sample(p.x - rx * b, p.z - rz * b, _sb, rec);
    const wetN = (_c.wet ? 2 : 0) + (_bw.wet ? 1 : 0) + (_sn.wet ? 1 : 0) + (_pt.wet ? 1 : 0) + (_sb.wet ? 1 : 0);
    const wet = wetN >= 2;
    const zeta = (2 * _c.y + _bw.y + _sn.y + _pt.y + _sb.y) / 6;
    const beta = Math.atan2(_bw.y - _sn.y, 2 * a);
    const alpha = Math.atan2(_pt.y - _sb.y, 2 * b);
    st.yBow = _bw.y; st.yPo = _pt.y; st.ySt = _sb.y;
    // the bed under the hull (the shallowest of the probes decides grounding)
    const depth = Math.min(_c.depth, _bw.depth, _sn.depth);
    const bedY = _c.y - _c.wake - _c.depth;

    const S = st.spec;
    const pl = clamp(+rec._planing || 0, 0, 1);
    const trim = Number.isFinite(rec._trim) ? rec._trim : (S && S.trimRest) || 0;
    const rideAbove = g.rideAbove;
    const Yt = zeta + rideAbove * (1 - 0.55 * pl) - dropOf(st) + st.lift;
    const Yrest = bedY + g.draft * 0.92 + rideAbove;  // keel on the bed

    if (!st.init || Math.abs(zeta - st.zeta0) > 6) {
      st.init = true;
      st.Y = Math.max(Yt, Yrest); st.Yv = 0; st.th = beta + trim; st.thv = 0;
      st.zeta0 = zeta; st.beta0 = beta; st.alpha0 = alpha; st.Yt0 = Yt; st.air = false;
    }
    const zv = clamp((zeta - st.zeta0) / dt, -20, 20);
    const bv = clamp((beta - st.beta0) / dt, -6, 6);
    const av = clamp((alpha - st.alpha0) / dt, -6, 6);
    st.zeta0 = zeta; st.beta0 = beta; st.alpha0 = alpha;
    const stiff = 1 + 1.5 * pl;
    // a planing bottom is damped hard by its own lift (it skims, it does not bob)
    const zH = Z_HEAVE + 0.45 * pl;

    // ---- heave ----------------------------------------------------------
    const wh = st.wh * Math.sqrt(stiff);
    const n = Math.max(1, Math.min(16, Math.ceil(dt / Math.min(1 / 60, 0.25 / wh))));
    const h = dt / n;
    const wasAir = st.air;
    let air = false, grounded = false;
    for (let i = 0; i < n; i++) {
      const tgt = st.Yt0 + (Yt - st.Yt0) * (i + 1) / n;
      const dY = st.Y - tgt;
      let acc;
      // clear of the water: gravity alone (it is FLYING once the keel is a
      // few centimetres clear, not merely kissing the surface)
      if (!wet || dY >= st.Teq) { acc = -G; air = wet && dY > st.Teq + AIR_CLEAR; }
      else {
        // buoyancy saturates once the sea is over her sheer (she cannot
        // displace more than her whole hull), and water rising past her
        // drags her up no harder than her weight: a bore lifts and carries
        // a hull, it does not fire it into the sky. A planing bottom meeting
        // a face at speed gets its dynamic lift on top (up to 3 g): that is
        // what kicks a fast light hull off a crest.
        acc = -wh * wh * Math.max(dY, -g.freeboard)
          - Math.max(-G * (1 + 2 * pl), 2 * zH * wh * (st.Yv - zv));
      }
      st.Yv += acc * h;
      st.Y += st.Yv * h;
      if (st.Y < Yrest && (depth < g.draft * 1.05 || !wet)) {
        st.Y = Yrest; if (st.Yv < 0) st.Yv = 0; grounded = true; air = false;
      }
    }
    st.Yt0 = Yt;
    // a hull that lands back on the water hard slams
    if (wasAir && !air && wet && st.slamCD <= 0) {
      const vImp = -(st.Yv - zv);
      if (vImp > 1.2) slam(rec, st, vImp, p.x + fx * a * 0.5, zeta, p.z + fz * a * 0.5);
      // water is not a trampoline: a landing is a plastic impact
      if (st.Yv < zv) st.Yv = zv + (st.Yv - zv) * 0.25;
    }
    if (air) st.airT += dt; else st.airT = 0;
    if (air && !wasAir) { st.launches++; AUDIT.launches++; }
    st.air = air; st.grounded = grounded;

    // ---- pitch ----------------------------------------------------------
    if (air) {
      if (!wasAir) st.thv = clamp(st.thv, -AIR_RATE, AIR_RATE);
      st.thv = st.thv * Math.exp(-dt / AIR_TAU) - AIR_NOSE * dt;
      st.th += st.thv * dt;
    } else {
      const wp = st.wp * Math.sqrt(stiff);
      const thT = (wet ? beta : 0) + trim;
      for (let i = 0; i < n; i++) {
        st.thv += (wp * wp * (thT - st.th) - 2 * Z_PITCH * wp * (st.thv - bv * 0.5)) * h;
        st.th += st.thv * h;
      }
    }
    st.th = clamp(st.th, -1.2, 1.2);
    if (Math.abs(st.th) > st.maxTh) st.maxTh = Math.abs(st.th);

    // ---- roll -----------------------------------------------------------
    let heel = clamp(+rec._roll || 0, -0.6, 0.6) + (+rec._sailHeel || 0);
    let target = (wet ? alpha : 0) + heel;
    if (grounded && depth < g.draft * 0.8 && !st.capsized) {
      // dried out: she lies over onto her bilge, the way she was leaning
      const side = st.phi !== 0 ? Math.sign(st.phi) : 1;
      target = side * (0.12 + 0.2 * clamp(1 - depth / (g.draft * 0.8), 0, 1));
    }
    const wasOver = Math.abs(wrapPi(st.phi - target)) > g.phiV;
    rollStep(rec, st, dt, target, (wet && !air) || grounded, 1 + pl, wet ? av : 0);
    st.alpha = target;
    const rel = wrapPi(st.phi - target);
    const ar = Math.abs(rel);
    if (ar > st.maxPhi) st.maxPhi = ar;
    if (ar > AUDIT.biggestPhi) AUDIT.biggestPhi = ar;
    if (!wasOver && ar > g.phiV && !st.capsized && wet) capsizeEvent(rec, st);
    if (st.capsized && ar < g.phiV * 0.6) {
      st.capsized = false; st.overT = 0;
      rec.engineDead = false; rec._helmDead = false;
      AUDIT.righted++;
    }

    // ---- green water ------------------------------------------------------
    if (!st.flooded && wet) {
      if (st.capsized) {
        st.swamp = Math.min(1, st.swamp + dt / (g.swampT * INVERT_LEAK));
      } else if (shippingWater(rec, st, rel)) {
        if (st.swamp === 0) AUDIT.swamps++;
        st.swamp = Math.min(1, st.swamp + dt / g.swampT);
        // a sea coming aboard stops a small hull
        const k = Math.exp(-dt * 1.5);
        if (Number.isFinite(rec.v)) rec.v *= k;
        if (Number.isFinite(rec.vx)) { rec.vx *= k; rec.vz *= k; }
      } else if (st.swamp > 0) {
        st.swamp = Math.max(0, st.swamp - (dt / g.swampT) * SWAMP_DRAIN);
      }
      if (st.swamp >= 1) floodEvent(rec, st);
    }

    // ---- the water's slope along the keel: lose way uphill, surf down -----
    if (wet && !air && !grounded && Math.abs(+rec.v || 0) > 0.5) {
      const dv = -G * Math.sin(beta) * SURGE_K * dt * Math.sign(rec.v);
      rec.v += dv;
      if (Number.isFinite(rec.vx)) { rec.vx += fx * dv; rec.vz += fz * dv; }
    }

    // ---- the water carries the hull --------------------------------------
    const wvx = (2 * _c.vx + _bw.vx + _sn.vx) * 0.25, wvz = (2 * _c.vz + _bw.vz + _sn.vz) * 0.25;
    if (wet && !grounded) {
      const ex = wvx - st.cvx, ez = wvz - st.cvz;
      const e = Math.hypot(ex, ez);
      if (e > 1e-4) {
        const side = Math.abs(ex * rx + ez * rz) / e;     // 1 = beam-on
        const kd = st.kdLong + (st.kdLat - st.kdLong) * side;
        st.load = kd * e * e;
        if (rec.anchored) {
          if (st.load > ANCHOR_HOLD) { rec.anchored = false; rec._brokeOut = true; AUDIT.breakouts++; }
        }
        const k = Math.min(1, kd * e * dt);
        st.cvx += ex * k; st.cvz += ez * k;
      } else st.load = 0;
      // shear between bow and stern turns her
      const shear = ((_bw.vx - _sn.vx) * rx + (_bw.vz - _sn.vz) * rz) / (2 * a);
      if (Number.isFinite(shear) && shear !== 0) rec.heading = hd + clamp(shear, -1.5, 1.5) * dt * 0.6;
    } else {
      const k = Math.exp(-dt * (grounded ? 5 : 3));
      st.cvx *= k; st.cvz *= k; st.load = 0;
      if (grounded) {
        const kk = Math.exp(-dt * 4);
        if (Number.isFinite(rec.v)) rec.v *= kk;
        if (Number.isFinite(rec.vx)) { rec.vx *= kk; rec.vz *= kk; }
      }
    }
    if (rec.anchored && !rec._brokeOut) { st.cvx = 0; st.cvz = 0; }
    if (st.cvx * st.cvx + st.cvz * st.cvz > 1e-6) {
      p.x += st.cvx * dt; p.z += st.cvz * dt;
      // swept into a wall: the hull stops against it and swings
      if (CBZ.collide && (st.cvx * st.cvx + st.cvz * st.cvz) > 0.25) {
        _probe.x = p.x; _probe.y = st.Y; _probe.z = p.z;
        CBZ.collide(_probe, clamp(g.beam * 0.5, 0.5, 6), st.Y - g.draft, st.Y + g.freeboard + 1);
        const px = _probe.x - p.x, pz = _probe.z - p.z, pm = Math.hypot(px, pz);
        if (pm > 1e-3) {
          p.x = _probe.x; p.z = _probe.z;
          const nx = px / pm, nz = pz / pm, into = st.cvx * nx + st.cvz * nz;
          if (into < 0) { st.cvx -= nx * into * 1.3; st.cvz -= nz * into * 1.3; }
          rec.heading = (rec.heading || 0) + clamp((st.cvx * rx + st.cvz * rz) * 0.05, -0.3, 0.3);
        }
      }
    }
    rec._flowVx = st.cvx; rec._flowVz = st.cvz;
    rec._skAir = air; rec._grounded = grounded;
    rec._stabDrop = dropOf(st);
    return st;
  }
  const _probe = { x: 0, y: 0, z: 0 };

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
    // White water at BOTH rails: the hull's whole beam goes into the sea, at
    // the speed a rail falls through its half-beam arc.
    if (typeof CBZ.waterHit === "function") {
      const h = rec.heading || 0;
      const rx = Math.cos(h), rz = -Math.sin(h);
      const hb = g.beam * 0.5;
      const v = Math.sqrt(2 * G * Math.max(0.2, hb + g.freeboard));
      const m = g.massT * 1000 * 0.5;
      try {
        CBZ.waterHit(p.x + rx * hb, sy, p.z + rz * hb, { kind: "vehicle", mass: m, speed: v, src: rec });
        CBZ.waterHit(p.x - rx * hb, sy, p.z - rz * hb, { kind: "vehicle", mass: m, speed: v, src: rec, quiet: true });
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
  CBZ.hullSeakeep = seakeep;
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
    rollStep(rec, st, Math.min(SUB_DT, 1 / 60), st.alpha, !st.air, 1, 0);
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
      slams: AUDIT.slams, launches: AUDIT.launches, breakouts: AUDIT.breakouts,
    };
    if (opts && opts.reset) {
      AUDIT.impulses = 0; AUDIT.capsizes = 0; AUDIT.swamps = 0;
      AUDIT.floods = 0; AUDIT.righted = 0; AUDIT.biggestPhi = 0; AUDIT.lastFrom = null;
      AUDIT.slams = 0; AUDIT.launches = 0; AUDIT.breakouts = 0;
    }
    return out;
  };
  // One hull's seakeeping numbers: natural periods, and what it is doing now.
  CBZ.hullSeakeepAudit = function (rec) {
    const st = rec && rec._stab;
    if (!st) return null;
    const g = st.g;
    return {
      heaveT: +(2 * PI / st.wh).toFixed(2), pitchT: +(2 * PI / st.wp).toFixed(2),
      rollT: +(2 * PI * Math.sqrt(st.I / (g.massT * G * Math.max(0.01, g.gm)))).toFixed(2),
      air: st.air, airT: +st.airT.toFixed(2), slams: st.slams, launches: st.launches,
      pitchDeg: +(st.th * 180 / PI).toFixed(1), maxPitchDeg: +(st.maxTh * 180 / PI).toFixed(1),
      rollDeg: +(st.phi * 180 / PI).toFixed(1), grounded: st.grounded,
      flow: +Math.hypot(st.cvx, st.cvz).toFixed(2), load: +st.load.toFixed(2),
    };
  };

  // ============================================================
  //  7. WHO CALLS IT: water_buoyancy.js (order 38.5) for every marine city
  //  car, world/sea_craft.js's ride() for every sea-craft hull. One call per
  //  hull per frame, after its mover.
  // ============================================================
})();
