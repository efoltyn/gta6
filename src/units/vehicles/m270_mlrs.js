/* ============================================================
   units/vehicles/m270_mlrs.js — M142 HIMARS, High Mobility Artillery Rocket
   System: a 6x6 FMTV truck carrying ONE six-round GMLRS pod (USA; fielded by
   any nation's army here). The id keeps the census name (m270_mlrs).

   REDRAWN FROM SCRATCH (2026-10-11). What was here: city/mil_armor.js's
   buildMLRS, a box truck with a box on the back, rockets on a 220 m/s
   ballistic lob (an 85-degree climb, ~45 s in the air at 400 m: every man it
   was fired at had walked 100 m before it came down, so in the smoke run it
   killed nothing). What is here, from the vehicle's own numbers:

   THE TRUCK  7.0 m long, 2.4 m wide, 3.2 m over the pod in travel; 16.25 t
              loaded. The FMTV 5-ton chassis: cab-over, the front axle under
              the cab, tandem rear axles (2.55 / -0.95 / -2.30 m from the
              middle: 4.18 m to the tandem's centre), 2.0 m track, six SINGLE
              395/85R20 tyres (1.14 m) on two-piece rims with the central tyre
              inflation hose at every hub. Ladder frame, leaf springs, the
              three differentials. The armoured three-man cab (LSAC): flat
              front with its slatted grille, the split two-pane windscreen
              raked back, armoured door windows, the big mirrors on their
              arms, the roof hatch over the section chief, two whips, the step
              behind the front wheel. Fuel tank left, battery box right, the
              air intake and the exhaust stack behind the cab, stowage boxes
              along the deck, tail lamps, the pintle.
   THE LAUNCHER  the launcher-loader module on the deck: a turntable, the
              base with the hinge at its forward end and the pod's rest posts
              aft, the elevating jack (drawn as two telescoping stages between
              the base and the cage, re-laid every frame), the cage round the
              pod, and the two reload booms that swing up over the back. In
              travel the pod lies fore-and-aft with its six tube mouths
              (frangible caps) at the REAR. To lay, the cage lifts to clear the
              cab, traverses, and takes the elevation; the mouth end rises.
   THE POD    the 227 mm GMLRS launch pod-container: a ribbed 4.1 x 1.06 x 0.84
              m box, two rows of three tubes, a cap per tube mouth that blows
              away with its rocket, the motor vents at the hinge end.

   FIRE MISSION (the known gap, fixed)
              M31A1 GMLRS unitary: a GPS/INS guided 227 mm rocket, 90 kg HE.
              The launcher STOPS, lays (traverse 0.55 rad/s, elevation 0.3
              rad/s, the cage lifts clear of the cab before it swings), and
              ripples the pod one rocket every ~5 s. Each rocket leaves the
              tube along the pod (rig.launched: src/battle/vehicles.js hands the
              rig its round), climbs on its motor, and is GUIDED onto the
              aim point the whole way (fire.js stepRockets `homing`): the aim
              point is the middle of the enemy group round the mark (an area
              fire mission, never one man), corrected by the observer until
              2.5 s out, then held: it falls on a coordinate. CEP ~4 m. The
              warhead: 30 m blast radius (everything inside ~17 m dies, men
              out to ~28 m), a hull inside ~16 m is destroyed.
              Ranges are battle-scaled: the real thing reaches 70+ km and will
              not fire under 15 km; here it engages 250 m - 1.6 km, flight
              ~6-14 s, standing off at ~700 m.
   RELOAD     by pod: the empty pod comes out on the reload booms and a full
              one goes in (150 s, the crew with the resupply truck's pods). It
              carries the pod on the rails plus two from the ammunition
              section: 18 rockets.
   ARMOUR     the cab's add-on armour stops rifle fire and fragments from the
              front and sides; the pod and the launcher are thin sheet. 12 / 9
              / 5 / 5 mm RHA.
   CREW       driver (left), gunner (centre), section chief (right). The chief
              rides head-out of the roof hatch when nothing is in range and he
              has not fired for a while; he gets down for the fire mission.
   DAMAGE     the hull kit's smoke, fire, flat tyre and wreck; a firepower
              kill freezes the launcher where it is; a catastrophic kill
              throws the cage off its hinge, and the caps are gone.

   TACTICS (src/battle/vehicles.js reads standoff; the rest is the
   interface the AI agent reads): artillery. It never closes, it keeps 700 m
   from the mark and backs away from anything inside its minimum range,
   fires a pod, and (the real drill) moves after a salvo.

   Units: metres, m/s, kg, mm RHA. Nose +Z, +X is the vehicle's LEFT.
============================================================ */
(function () {
  "use strict";
  const W = typeof window !== "undefined" ? window : globalThis;
  const CBZ = W.CBZ;
  if (!CBZ || !CBZ.unitKit) return;
  const PI = Math.PI;
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function wrap(a) { while (a > PI) a -= 2 * PI; while (a < -PI) a += 2 * PI; return a; }

  /* ---------------------------------------------------------- the numbers */
  const L = 7.0, Wd = 2.4, H = 3.2;
  const R = 0.57, TW = 0.40, RIM = 0.27;                      // 395/85R20
  const AXF = 2.55, AXM = -0.95, AXR = -2.30, TRK = 0.98;       // axle z, track half
  const CAB = { zf: 3.40, zr: 1.42, y0: 1.18, roof: 2.92, hw: 1.18 };
  const DECK = { z0: 1.10, z1: -3.42, y: 1.56 };
  // the launcher: turntable centre (hull), hinge in turntable space, the pod
  const TT = { x: 0, y: DECK.y, z: -1.30 };
  const HINGE = { y: 0.81, z: 2.05 };
  const POD = { len: 4.10, hw: 0.53, h: 0.84 };
  const JACK = { b: [0, 0.38, 0.55], a: 1.5 };                 // base clevis (turntable space), cage lug (m from the hinge)
  const TUBES = [];                                            // tube mouths in pod space, firing order
  [0.62, 0.24].forEach(function (y) { [0.335, 0, -0.335].forEach(function (x) { TUBES.push([x, y]); }); });
  const LAY = { trav: 0.55, elev: 0.30, clear: 0.38, max: 1.05 };
  const HATCH = { x: -0.45, z: 2.30 };
  const RELOAD = 150;

  // elevation and time of flight for a range (battle-scaled GMLRS profile)
  function elFor(d) { return clamp(0.82 + d / 9000, 0.82, 1.0); }
  function tofFor(d) { return 4 + d / 160; }

  /* ---------------------------------------------------------- the weapon */
  const GMLRS = {
    id: "m31a1_gmlrs", seat: "gunner", kind: "rockets", mount: "free", indirect: true, guided: true,
    rof: 0.2, salvo: 6, reload: RELOAD, ammo: 18,
    mun: "m31a1", speed: 300, heSpeed: 300, grav: 9.8,
    range: 1600, minRange: 250,
  };

  /* ================================================================ BODY */
  function inset(pts, d) {
    let cx = 0, cy = 0;
    pts.forEach(function (p) { cx += p[0]; cy += p[1]; });
    cx /= pts.length; cy /= pts.length;
    return pts.map(function (p) {
      const dx = p[0] - cx, dy = p[1] - cy, l = Math.hypot(dx, dy) || 1;
      return [p[0] - dx / l * d, p[1] - dy / l * d];
    });
  }

  function body() {
    const HK = CBZ.hullKit, G = HK.geo();
    // ------------------------------------------------------------ frame + running gear
    G.m("paint").c(0.6);
    [-1, 1].forEach(function (s) {
      G.box(s * 0.47, 1.02, -0.08, 0.09, 0.26, 6.66);
      G.box(s * 0.43, 1.02, -0.08, 0.01, 0.22, 6.66);
    });
    [3.15, 1.6, 0.4, -1.62, -3.30].forEach(function (z) { G.box(0, 1.00, z, 0.86, 0.14, 0.10); });
    G.m("metal").c(0.85);
    [AXF, AXM, AXR].forEach(function (z, k) {
      G.cyl(0, R, z, 0.08, 0.08, 1.66, "x", 10);                                     // axle tube
      G.sphere(k ? 0 : 0.15, R, z, 0.24, 10, 1.0, 0.95, 0.9);                        // the differential
      [-1, 1].forEach(function (s) {
        G.cyl(s * 0.72, R, z, 0.15, 0.15, 0.18, "x", 12);                            // brake drum / hub reduction
        G.tube([s * 0.47, 0.90, z + 0.18], [s * 0.62, R + 0.05, z + 0.12], 0.035, 0.035);   // shock absorber
      });
    });
    // parabolic leaf springs: front on its hangers, the rear bogie
    [-1, 1].forEach(function (s) {
      for (let i = 0; i < 3; i++) G.box(s * 0.47, R + 0.13 + i * 0.03, AXF, 0.08, 0.025, 1.40 - i * 0.30);
      G.box(s * 0.47, R + 0.10, AXF, 0.11, 0.08, 0.18);
      const ZT = (AXM + AXR) / 2;
      G.cyl(s * 0.47, 0.88, ZT, 0.10, 0.10, 0.26, "x", 10);                          // bogie trunnion
      for (let i = 0; i < 4; i++) G.box(s * 0.47, 0.80 - i * 0.026, ZT, 0.08, 0.024, 1.46 - i * 0.22);
      G.box(s * 0.32, R + 0.14, ZT, 0.05, 0.05, 1.28);                               // torque rods
    });
    G.cyl(0, 0.70, 0.9, 0.05, 0.05, 2.9, "z", 6, 0.06, 0, 0);                       // propeller shafts
    G.cyl(0, 0.66, (AXM + AXR) / 2, 0.045, 0.045, 1.3, "z", 6);
    G.box(0, 0.80, -0.2, 0.40, 0.30, 0.50);                                          // transfer case
    G.box(0, 0.92, 2.15, 0.70, 0.46, 1.10);                                          // engine sump/transmission under the cab
    // ------------------------------------------------------------ front end
    G.m("paint").c(0.95);
    G.box(0, 0.74, 3.47, 2.30, 0.30, 0.20);                                          // bumper
    G.box(0, 0.92, 3.38, 1.10, 0.10, 0.12);
    G.m("dark").c(1);
    [-1, 1].forEach(function (s) {
      // tow hooks, lifting shackles
      G.box(s * 0.55, 0.66, 3.60, 0.08, 0.16, 0.10);
      G.cyl(s * 0.55, 0.60, 3.64, 0.05, 0.05, 0.04, "x", 8);
      // headlamp in the bumper end, its brush guard
      G.m("paint").c(0.85).cyl(s * 0.90, 0.80, 3.56, 0.11, 0.11, 0.08, "z", 14);
      G.m("lamp").c(1).cyl(s * 0.90, 0.80, 3.60, 0.09, 0.09, 0.01, "z", 14);
      G.m("amber").c(1).box(s * 0.62, 0.82, 3.575, 0.10, 0.07, 0.02);
      G.m("dark").c(1);
      for (let i = 0; i < 4; i++) G.box(s * (0.79 + i * 0.07), 0.80, 3.625, 0.015, 0.26, 0.015);
      G.box(s * 0.90, 0.93, 3.625, 0.26, 0.015, 0.015); G.box(s * 0.90, 0.67, 3.625, 0.26, 0.015, 0.015);
    });
    // ------------------------------------------------------------ THE CAB (LSAC)
    G.m("paint").c(1);
    const cabSide = [[CAB.zr, CAB.y0], [3.36, CAB.y0], [CAB.zf, 1.62], [3.38, 1.80], [3.20, 2.72], [3.08, CAB.roof - 0.02], [1.50, CAB.roof], [CAB.zr, 2.84]];
    const cabIn = inset(cabSide, 0.045);
    G.loft("x", [{ a: -CAB.hw, pts: cabIn }, { a: -CAB.hw + 0.05, pts: cabSide }, { a: CAB.hw - 0.05, pts: cabSide }, { a: CAB.hw, pts: cabIn }]);
    // the grille: slats in a frame on the cab's flat front
    G.m("black").c(1).box(0, 1.40, 3.385, 1.30, 0.40, 0.02);
    G.m("paint").c(0.9);
    for (let i = 0; i < 6; i++) G.box(0, 1.24 + i * 0.064, 3.40, 1.30, 0.022, 0.035);
    G.box(0, 1.62, 3.40, 1.38, 0.04, 0.04); G.box(0, 1.19, 3.40, 1.38, 0.04, 0.04);
    [-1, 1].forEach(function (s) { G.box(s * 0.67, 1.40, 3.40, 0.04, 0.46, 0.04); });
    // marker lamps on the cab front
    G.m("amber").c(1);
    [-1, 1].forEach(function (s) { G.box(s * 1.00, 1.70, 3.40, 0.10, 0.05, 0.02); });
    // windscreen frame on the raked face
    const rk = -Math.atan2(0.18, 0.92);
    G.m("paint").c(0.9);
    G.save().tf(0, 2.26, 3.29, rk, 0, 0);
    G.box(0, 0.44, 0.012, 2.20, 0.07, 0.05); G.box(0, -0.44, 0.012, 2.20, 0.07, 0.05);
    [-1, 0, 1].forEach(function (s) { G.box(s * 1.04, 0, 0.012, s ? 0.10 : 0.08, 0.92, 0.05); });
    G.m("black").c(1);
    [-1, 1].forEach(function (s) { G.box(s * 0.50, -0.36, 0.045, 0.42, 0.016, 0.016, 0, 0, s * 0.35); });   // wipers
    G.restore();
    G.m("glassT").c(1);
    G.save().tf(0, 2.26, 3.29, rk, 0, 0);
    [-1, 1].forEach(function (s) { G.box(s * 0.52, 0, 0.004, 0.94, 0.82, 0.02); });
    G.restore();
    // doors: armoured windows, seams, handles, hinges; the step behind the front wheel
    [-1, 1].forEach(function (s) {
      const x = s * (CAB.hw + 0.004);
      G.m("glassT").c(1).box(x, 2.28, 2.62, 0.02, 0.52, 0.62);
      G.box(x, 2.26, 1.86, 0.02, 0.42, 0.34);                                        // rear quarter window
      G.m("paint").c(0.88);
      G.box(x + s * 0.01, 2.28, 2.62, 0.02, 0.60, 0.07).box(x + s * 0.01, 2.28, 2.62, 0.02, 0.07, 0.70);   // window frame cross (the armour bezel)
      G.m("black").c(1);
      G.box(x, 1.95, 3.07, 0.01, 1.48, 0.015); G.box(x, 1.95, 2.12, 0.01, 1.48, 0.015);   // door seams
      G.box(x, 2.69, 2.60, 0.01, 0.015, 0.95);
      G.box(x + s * 0.02, 1.86, 2.25, 0.03, 0.05, 0.16);                             // handle
      [1.45, 2.40].forEach(function (y) { G.box(x + s * 0.02, y, 3.05, 0.035, 0.12, 0.06); });   // hinges
      // the step ladder behind the front wheel, the grab handle
      G.m("dark").c(1);
      G.box(s * 1.04, 0.62, 1.78, 0.28, 0.03, 0.26); G.box(s * 1.04, 0.95, 1.78, 0.28, 0.03, 0.26);
      G.box(s * 1.17, 0.85, 1.78, 0.02, 0.62, 0.26);
      G.tube([s * 1.22, 1.55, 2.10], [s * 1.22, 2.45, 2.10], 0.018, 0.018);
      // the front wheel's fender flare (black)
      G.m("black").c(0.55).cyl(s * TRK, R, AXF, 0.66, 0.66, 0.46, "x", 16, 0, 0, 0, { a0: PI * 0.42, a1: PI * 1.58, open: true });
      // mirrors on their arms
      G.m("dark").c(1);
      G.tube([s * 1.18, 2.55, 3.10], [s * 1.46, 2.62, 3.12], 0.018, 0.018);
      G.tube([s * 1.18, 2.05, 3.16], [s * 1.46, 2.30, 3.12], 0.018, 0.018);
      G.box(s * 1.47, 2.45, 3.10, 0.05, 0.42, 0.24);
      G.m("glassT").c(1).box(s * 1.47, 2.45, 2.975, 0.04, 0.38, 0.01);
    });
    // the roof: the hatch ring over the section chief, gutters, the whips
    G.m("paint").c(0.92);
    [-1, 1].forEach(function (s) { G.box(s * 1.12, CAB.roof + 0.02, 2.28, 0.04, 0.04, 1.62); });
    G.cyl(HATCH.x, CAB.roof + 0.05, HATCH.z, 0.38, 0.40, 0.10, "y", 18);
    G.m("black").c(1).cyl(HATCH.x, CAB.roof + 0.101, HATCH.z, 0.31, 0.31, 0.01, "y", 18);
    G.m("dark").c(1);
    [-1, 1].forEach(function (s) {
      G.cyl(s * 1.02, CAB.roof + 0.06, 1.58, 0.05, 0.06, 0.12, "y", 8);
      G.cyl(s * 1.02, CAB.roof + 0.20, 1.58, 0.03, 0.03, 0.18, "y", 6);
      G.m("black").c(1).cyl(s * 1.02, CAB.roof + 1.40, 1.58, 0.005, 0.009, 2.30, "y", 4).m("dark").c(1);
    });
    G.m("amber").c(1).box(0.55, CAB.roof + 0.05, 3.02, 0.12, 0.08, 0.06).box(-0.25, CAB.roof + 0.05, 3.02, 0.12, 0.08, 0.06);
    // ------------------------------------------------------------ behind the cab
    G.m("paint").c(0.9);
    // the air intake (right): duct up the cab's back, the mushroom cap
    G.box(-0.88, 2.12, 1.28, 0.30, 1.50, 0.24);
    G.cyl(-0.88, 2.94, 1.28, 0.20, 0.20, 0.10, "y", 14);
    G.m("black").c(1).cyl(-0.88, 2.88, 1.28, 0.15, 0.15, 0.04, "y", 14);
    // exhaust stack (left): pipe, perforated heat shield, the rain cap
    G.m("black").c(1);
    G.cyl(0.92, 2.18, 1.24, 0.06, 0.06, 1.85, "y", 10);
    G.tube([0.92, 3.10, 1.24], [0.92, 3.16, 1.12], 0.06, 0.06);
    G.m("dark").c(1).cyl(0.92, 2.30, 1.24, 0.10, 0.10, 0.90, "y", 12, 0, 0, 0, { open: true });
    // ------------------------------------------------------------ the deck and what hangs under it
    G.m("paint").c(1);
    G.box(0, DECK.y - 0.07, (DECK.z0 + DECK.z1) / 2, 2.40, 0.14, DECK.z0 - DECK.z1);
    G.m("paint").c(0.85);
    [-1, 1].forEach(function (s) {
      G.box(s * 1.19, DECK.y - 0.05, (DECK.z0 + DECK.z1) / 2, 0.03, 0.10, DECK.z0 - DECK.z1);   // edge lip
      for (let z = DECK.z0 - 0.3; z > DECK.z1; z -= 0.9) G.box(s * 1.205, DECK.y - 0.07, z, 0.02, 0.05, 0.08);   // lashing rings
    });
    // stowage boxes (both sides, between the front wheel and the tandem)
    [-1, 1].forEach(function (s) {
      G.m("paint").c(0.95).box(s * 1.04, 1.18, -0.05, 0.30, 0.42, 0.62);
      G.m("black").c(1).box(s * 1.195, 1.18, -0.05, 0.01, 0.38, 0.015).box(s * 1.195, 1.36, -0.05, 0.01, 0.015, 0.58);
      G.m("dark").c(1);
      [-0.22, 0.12].forEach(function (z) { G.box(s * 1.20, 1.30, z, 0.02, 0.05, 0.06); });   // latches
    });
    // fuel tank (left, D-section) on its straps, battery box and air tanks (right)
    G.m("paint").c(0.92);
    G.loft("z", [{ a: 0.30, pts: [[0.78, 0.82], [1.12, 0.82], [1.17, 0.95], [1.17, 1.28], [0.78, 1.28]] }, { a: 1.20, pts: [[0.78, 0.82], [1.12, 0.82], [1.17, 0.95], [1.17, 1.28], [0.78, 1.28]] }]);
    G.m("black").c(1);
    [0.5, 1.0].forEach(function (z) { G.box(0.98, 1.05, z, 0.42, 0.50, 0.04); });
    G.cyl(1.06, 1.30, 0.75, 0.06, 0.06, 0.06, "y", 10);
    G.m("paint").c(0.9).box(-0.98, 1.06, 0.80, 0.38, 0.42, 0.72);
    G.m("dark").c(1).box(-0.98, 1.28, 0.80, 0.30, 0.02, 0.60);
    G.m("metal").c(0.9);
    [-0.70, -0.92].forEach(function (x) { G.cyl(x, 0.82, 0.80, 0.11, 0.11, 0.62, "z", 10); });
    // the tandem's fenders, the mud flaps
    G.m("black").c(0.55);
    [-1, 1].forEach(function (s) {
      G.box(s * TRK, DECK.y - 0.20, (AXM + AXR) / 2, 0.50, 0.03, 2.90);
      G.box(s * TRK, DECK.y - 0.30, AXM + 0.70, 0.50, 0.20, 0.03);
      G.box(s * TRK, 0.86, AXR - 0.66, 0.52, 0.66, 0.025);
    });
    // the rear: bumper, tail lamps, pintle, the step
    G.m("paint").c(0.95).box(0, 0.98, DECK.z1 - 0.02, 2.30, 0.20, 0.16);
    G.m("dark").c(1);
    G.box(0, 0.88, DECK.z1 - 0.12, 0.20, 0.16, 0.20).cyl(0, 0.88, DECK.z1 - 0.26, 0.07, 0.07, 0.05, "y", 10);
    [-1, 1].forEach(function (s) {
      G.box(s * 0.95, 1.18, DECK.z1 - 0.04, 0.26, 0.16, 0.10);
      G.m("tail").c(1).box(s * 1.00, 1.18, DECK.z1 - 0.095, 0.10, 0.10, 0.02);
      G.m("amber").c(1).box(s * 0.88, 1.18, DECK.z1 - 0.095, 0.08, 0.08, 0.02);
      G.m("dark").c(1);
      G.box(s * 0.60, 0.92, DECK.z1 - 0.12, 0.06, 0.14, 0.08);
    });
    const geos = G.build({ uv: 2.6, mud: 1.0 });

    // ============================================================ THE LAUNCHER BASE (turntable space)
    const B = HK.geo();
    B.m("dark").c(1);
    B.cyl(0, 0.05, 0, 0.92, 0.95, 0.10, "y", 28);                                  // turntable bearing
    B.m("paint").c(0.95);
    B.cyl(0, 0.14, 0, 0.86, 0.90, 0.08, "y", 28);
    // the base frame: two box beams, cross members, the hinge end deeper
    [-1, 1].forEach(function (s) {
      B.box(s * 0.56, 0.28, 0.10, 0.20, 0.24, 4.00);
      B.m("black").c(1);
      for (let i = 0; i < 5; i++) B.cyl(s * 0.665, 0.28, -1.5 + i * 0.75, 0.06, 0.06, 0.01, "x", 10);   // lightening holes
      B.m("paint").c(0.95);
      // hinge brackets at the forward end, the rest posts aft
      B.box(s * 0.50, 0.60, HINGE.z, 0.05, 0.50, 0.34);
      B.box(s * 0.64, 0.60, HINGE.z, 0.05, 0.50, 0.34);
      B.box(s * 0.45, 0.58, -1.75, 0.10, 0.40, 0.12);
      B.m("black").c(1).box(s * 0.45, 0.79, -1.75, 0.16, 0.03, 0.18).m("paint").c(0.95);
    });
    [-1.9, -0.6, 0.7, 1.95].forEach(function (z) { B.box(0, 0.26, z, 1.0, 0.18, 0.14); });
    B.m("metal").c(1).cyl(0, HINGE.y, HINGE.z, 0.05, 0.05, 1.40, "x", 10);           // hinge pin
    // the jack's clevis, the hydraulic power unit (left), the launcher interface unit (right)
    B.m("dark").c(1).box(0, JACK.b[1] - 0.06, JACK.b[2], 0.22, 0.12, 0.18);
    B.m("paint").c(0.9);
    B.box(0.84, 0.34, 0.65, 0.26, 0.40, 0.90);
    B.box(-0.84, 0.34, 0.40, 0.26, 0.44, 1.10);
    B.m("black").c(1);
    B.box(-0.975, 0.36, 0.40, 0.01, 0.30, 0.90).box(0.975, 0.36, 0.65, 0.01, 0.26, 0.70);
    B.m("dark").c(1);
    B.tube([0.84, 0.40, 0.20], [0.30, 0.32, 0.30], 0.02, 0.02); B.tube([0.84, 0.36, 0.20], [0.30, 0.28, 0.40], 0.02, 0.02);   // hydraulic lines
    const baseGeos = B.build({ uv: 2.6, mud: 0 });

    // ============================================================ THE CAGE (elevation space: hinge at 0, pod along -Z)
    const C = HK.geo();
    C.m("paint").c(0.82);
    const len = POD.len;
    [-1, 1].forEach(function (s) {
      C.box(s * 0.61, 0.04, -len / 2, 0.09, 0.10, len + 0.10);                         // bottom rails
      C.box(s * 0.61, POD.h + 0.02, -len / 2, 0.08, 0.08, len + 0.10);                 // top rails
      [-0.06, -1.40, -2.70, -4.06].forEach(function (z) { C.box(s * 0.61, POD.h / 2 + 0.03, z, 0.08, POD.h, 0.08); });
      C.tube([s * 0.61, 0.08, -0.06], [s * 0.61, POD.h - 0.02, -1.40], 0.022, 0.022);   // diagonal bracing
      C.tube([s * 0.61, 0.08, -2.70], [s * 0.61, POD.h - 0.02, -1.40], 0.022, 0.022);
      C.tube([s * 0.61, 0.08, -2.70], [s * 0.61, POD.h - 0.02, -4.06], 0.022, 0.022);
      // hinge lugs on the cage
      C.box(s * 0.57, 0.0, 0.0, 0.07, 0.16, 0.26);
    });
    C.box(0, -0.02, -0.06, 1.30, 0.10, 0.12);                                          // hinge-end crossmember
    C.box(0, -0.02, -JACK.a, 0.60, 0.10, 0.16);                                        // jack lug beam
    C.m("dark").c(1).box(0, -0.10, -JACK.a, 0.18, 0.10, 0.12);
    C.m("paint").c(0.82).box(0, POD.h + 0.02, -4.06, 1.30, 0.08, 0.08);                // mouth-end top beam
    const cageGeos = C.build({ uv: 2.6, mud: 0 });

    // the jack: barrel and rod, both along +Z from the clevis
    const J = HK.geo();
    J.m("paint").c(0.8).cyl(0, 0, 0.22, 0.085, 0.085, 0.44, "z", 12);
    J.m("dark").c(1).cyl(0, 0, 0.0, 0.10, 0.10, 0.08, "z", 12);
    const jackGeos = J.build({ uv: 2.6, mud: 0 });
    const Jr = HK.geo();
    Jr.m("metal").c(1.0).cyl(0, 0, 0.5, 0.05, 0.05, 1.0, "z", 10);
    const rodGeos = Jr.build({ uv: 2.6, mud: 0 });

    // the reload booms (hoist space: pivot at the cage's mouth end, lying toward the hinge)
    const Hh = HK.geo();
    Hh.m("paint").c(0.8);
    [-1, 1].forEach(function (s) {
      Hh.box(s * 0.62, 0.06, 0.58, 0.07, 0.10, 1.16);
      Hh.cyl(s * 0.62, 0.0, 0.0, 0.06, 0.06, 0.10, "x", 10);
    });
    Hh.box(0, 0.08, 1.16, 1.30, 0.09, 0.09);
    Hh.m("dark").c(1).box(0, -0.02, 1.16, 0.14, 0.12, 0.10);
    const hoistGeos = Hh.build({ uv: 2.6, mud: 0 });

    // ============================================================ THE POD (pod space = elevation space, lifts on reload)
    const P = HK.geo();
    P.m("paint").c(0.97);
    const pz = -len / 2, ph = POD.h;
    P.box(0, ph / 2 + 0.02, pz, POD.hw * 2, ph, len - 0.08);
    P.m("paint").c(0.88);
    [-1, 1].forEach(function (s) {
      const x = s * (POD.hw + 0.012);
      [0.18, 0.44, 0.70].forEach(function (y) { P.box(x, y, pz, 0.025, 0.05, len - 0.12); });     // longitudinal channels
      for (let z = -0.25; z > -len + 0.1; z -= 0.48) P.box(x + s * 0.005, ph / 2 + 0.02, z, 0.02, ph - 0.04, 0.04);   // stiffeners
    });
    for (let z = -0.25; z > -len + 0.1; z -= 0.48) P.box(0, ph + 0.032, z, POD.hw * 2 - 0.02, 0.02, 0.04);
    // the end frames (heavier), lifting eyes at the corners
    [-0.04, -len + 0.04].forEach(function (z) {
      P.box(0, ph / 2 + 0.02, z, POD.hw * 2 + 0.04, ph + 0.04, 0.08);
    });
    P.m("dark").c(1);
    [-1, 1].forEach(function (s) {
      [-0.15, -len + 0.15].forEach(function (z) { P.cyl(s * (POD.hw - 0.08), ph + 0.09, z, 0.05, 0.05, 0.02, "x", 10); });
    });
    // tube mouths (aft face, recessed dark bores) and the motor vents at the hinge end
    P.m("black").c(1);
    TUBES.forEach(function (t) {
      P.cyl(t[0], t[1], -len - 0.005, 0.15, 0.15, 0.02, "z", 18);
    });
    P.m("dark").c(0.8);
    TUBES.forEach(function (t) { P.cyl(t[0], t[1], 0.004, 0.09, 0.09, 0.02, "z", 14); });   // the closed end: motor vent plugs
    P.m("paint").c(0.75);
    TUBES.forEach(function (t) { P.cyl(t[0], t[1], -len - 0.02, 0.165, 0.165, 0.012, "z", 18, 0, 0, 0, { open: true }); });
    // the stencilled data plate and the HE band (yellow) on both flanks
    P.m("gear").c(0x6b5b2e);
    [-1, 1].forEach(function (s) { P.box(s * (POD.hw + 0.026), 0.58, -2.6, 0.005, 0.10, 0.90); });
    P.m("black").c(1);
    [-1, 1].forEach(function (s) { P.box(s * (POD.hw + 0.026), 0.32, -1.2, 0.005, 0.18, 0.60); });
    const podGeos = P.build({ uv: 2.6, mud: 0 });

    // one frangible cap (instanced six times on the mouths)
    const Cp = HK.geo();
    Cp.m("gear").c(0.95).cyl(0, 0, 0, 0.148, 0.148, 0.03, "z", 18);
    Cp.m("gear").c(0.7).cyl(0, 0, -0.016, 0.06, 0.06, 0.004, "z", 12);
    const capGeo = Cp.build({ uv: 1, mud: 0 }).gear;

    // ============================================================ wheels
    const Wg = HK.geo();
    HK.tyre(Wg, R, TW, RIM, { lug: "ndt", lugs: 24, dep: 0.03 });
    const tyreGeo = Wg.build({ uv: 1, mud: 0 }).rubber;
    // the two-piece rim: disc, hub reduction, ten nuts, the CTIS hose
    const Dg = HK.geo();
    Dg.m("paint").c(0.82);
    Dg.cyl(TW * 0.30, 0, 0, RIM, RIM, 0.05, "x", 22);
    Dg.cyl(TW * 0.36, 0, 0, RIM * 0.92, RIM * 0.92, 0.03, "x", 22, 0, 0, 0, { open: true });
    Dg.cyl(TW * 0.40, 0, 0, 0.13, 0.15, 0.10, "x", 16);
    Dg.m("black").c(1);
    for (let i = 0; i < 6; i++) { const a = i * PI / 3 + 0.25; Dg.cyl(TW * 0.335, Math.cos(a) * RIM * 0.68, Math.sin(a) * RIM * 0.68, 0.035, 0.035, 0.02, "x", 8); }
    Dg.m("dark").c(1);
    for (let i = 0; i < 10; i++) { const a = i * PI / 5; Dg.cyl(TW * 0.36, Math.cos(a) * 0.17, Math.sin(a) * 0.17, 0.016, 0.016, 0.04, "x", 6); }
    Dg.cyl(TW * 0.46, 0, 0, 0.05, 0.06, 0.06, "x", 10);
    Dg.tube([TW * 0.48, 0, 0], [TW * 0.46, RIM * 0.55, RIM * 0.25], 0.012, 0.012);   // CTIS hose to the valve
    Dg.tube([TW * 0.46, RIM * 0.55, RIM * 0.25], [TW * 0.36, RIM * 0.85, RIM * 0.15], 0.012, 0.012);
    Dg.m("paint").c(0.7).cyl(-TW * 0.36, 0, 0, RIM, RIM, 0.04, "x", 16);
    const rimGeos = Dg.build({ uv: 1, mud: 0 });

    const Ld = HK.geo();
    Ld.m("paint").c(0.92).cyl(0, 0.03, 0.34, 0.35, 0.35, 0.06, "y", 18);
    Ld.m("dark").c(1).box(0, 0.08, 0.34, 0.20, 0.03, 0.04);
    const lidGeos = Ld.build({ uv: 2.6, mud: 0 });

    return { geos: geos, lidGeos: lidGeos, baseGeos: baseGeos, cageGeos: cageGeos, jackGeos: jackGeos, rodGeos: rodGeos, hoistGeos: hoistGeos,
      podGeos: podGeos, capGeo: capGeo, tyreGeo: tyreGeo, rimGeos: rimGeos, decals: {} };
  }

  // see-through armoured glass (its own key: rig.mark leaves it alone)
  let GLASS = null;
  function glassMat(THREE) {
    if (GLASS) return GLASS;
    GLASS = new THREE.MeshPhongMaterial({ color: 0x24302f, specular: 0x9fb0b4, shininess: 90, transparent: true, opacity: 0.42, depthWrite: false, vertexColors: true });
    return GLASS;
  }

  /* ================================================================ THE RIG
     The hull kit's WheeledRig (wheels, springs, body, exhaust, dust, crew,
     damage, wreck) plus the launcher, the fire mission and the reload. */
  function HimarsRig(o) {
    CBZ.hullKit.WheeledRig.call(this, o);
    this.yaw = 0; this.el = 0; this.wantYaw = 0; this.wantEl = 0; this.layT = -99; this.laid = false;
    this.left = TUBES.length; this.reT = 0; this.reTot = RELOAD; this.lastFire = -99; this.hatch = 0; this.u = null;
    this.flights = []; this.pool = [];
    for (let i = 0; i < 8; i++) this.pool.push({ r: null, tgt: null, mark: { pos: { x: 0, y: 0, z: 0 }, dead: false }, T: 0, age: 0, upd: 0, st: { on: false, x: 0, y: 0, z: 0 } });
    const THREE = W.THREE;
    this._v = new THREE.Vector3(); this._v2 = new THREE.Vector3(); this._mm = new THREE.Matrix4();
    this._cq = new THREE.Quaternion(); this._cp = new THREE.Vector3(); this._cs = new THREE.Vector3(1, 1, 1);
    this.capsFull();
  }
  function rigProto() {
    const base = CBZ.hullKit.WheeledRig.prototype;
    if (HimarsRig.prototype._base === base) return;
    HimarsRig.prototype = Object.create(base);
    const P = HimarsRig.prototype;
    P.constructor = HimarsRig;
    P._base = base;

    P.capsFull = function () {
      const im = this.caps;
      if (!im) return;
      for (let i = 0; i < TUBES.length; i++) this.capSet(i, true);
      im.instanceMatrix.needsUpdate = true;
    };
    P.capSet = function (i, on) {
      const t = TUBES[i];
      this._cp.set(t[0], t[1], -POD.len - 0.03);
      this._cs.set(on ? 1 : 0.0001, on ? 1 : 0.0001, on ? 1 : 0.0001);
      this.caps.setMatrixAt(i, this._mm.compose(this._cp, this._cq, this._cs));
      this.caps.instanceMatrix.needsUpdate = true;
    };

    /* the battle hands the mark's bearing off the nose (vehicles.js vehFight);
       the elevation is the fire mission's, for the range */
    P.aimLauncher = function (rel, elMax, dt) {
      const u = this.u, t = u && u.tgt;
      let d = 800;
      if (t && t.pos && u.pos) d = Math.hypot(t.pos.x - u.pos.x, t.pos.z - u.pos.z);
      this.wantYaw = wrap(rel + PI);           // the mouths are the pod's aft face
      this.wantEl = elFor(d);
      this.layT = this.t;
    };
    P.aimTurret = function () {};
    P.aimError = function () { return this.laid ? 0 : 1; };
    P.canFire = function (shot) {
      if (this.dead || this.jammed || this.reT > 0 || this.left <= 0) return false;
      return this.laid;
    };
    // the mouth of the next tube to fire
    P.muzzleWorld = function (out, shot) {
      const i = clamp(TUBES.length - this.left, 0, TUBES.length - 1), t = TUBES[i];
      this.pod.updateWorldMatrix(true, false);
      return out.set(t[0], t[1], -POD.len - 0.1).applyMatrix4(this.pod.matrixWorld);
    };
    /* EVERY ROCKET: its cap goes, the motor lights in the tube, and the pod
       blows a cloud out of both ends that swallows the launcher */
    P.fire = function (shot) {
      if (shot && shot.kind && shot.kind !== "rockets") return;
      const i = clamp(TUBES.length - this.left, 0, TUBES.length - 1);
      if (this.left > 0) { this.left--; this.capSet(i, false); }
      this.lastFire = this.t;
      if (this.left <= 0) { this.reT = this.reTot = (shot && shot.w && shot.w.reload) || RELOAD; }
      this.recV -= 0.8;
      if (!this.root.parent) return;
      const t = TUBES[i], m = this.pod.matrixWorld.elements;
      const dx = -m[8], dy = -m[9], dz = -m[10];                       // the pod's aft axis, world
      const mo = this._v.set(t[0], t[1], -POD.len - 0.1).applyMatrix4(this.pod.matrixWorld);
      const ve = this._v2.set(t[0], t[1], 0.1).applyMatrix4(this.pod.matrixWorld);
      const r = Math.random, MU = CBZ.munitions;
      const F = this.glow, FX = [1, 0.75, 0.4];
      for (let k = 0; k < 6; k++) F.emit(mo.x + dx * k * 0.6, mo.y + dy * k * 0.6, mo.z + dz * k * 0.6, dx * 12, dy * 12, dz * 12, 0.18 + k * 0.03, 1.2, 2.6, 1.0, FX, 0, 1);
      for (let k = 0; k < 4; k++) F.emit(ve.x, ve.y, ve.z, -dx * 8 + (r() - 0.5) * 2, -dy * 8, -dz * 8 + (r() - 0.5) * 2, 0.25, 1.0, 2.2, 0.9, FX, 0, 1);
      const smoke = MU && MU.smoke ? function (x, y, z, vx, vy, vz, s0, s1, life, a0, sh) { MU.smoke(x, y, z, vx, vy, vz, s0, s1, life, a0, sh, sh * 0.98, sh * 0.94, { drag: 0.9, rise: 0.35 }); }
        : function (x, y, z, vx, vy, vz, s0, s1, life, a0, sh) { this.smoke.emit(x, y, z, vx, vy, vz, life, s0, s1, a0, [sh, sh * 0.98, sh * 0.94], -0.03, 0.9); }.bind(this);
      for (let k = 0; k < 10; k++) {
        const sp = 4 + r() * 16;
        smoke(mo.x, mo.y, mo.z, dx * sp + (r() - 0.5) * 5, dy * sp + (r() - 0.5) * 3, dz * sp + (r() - 0.5) * 5, 1.2, 6 + r() * 5, 5 + r() * 4, 0.55, 0.80 + r() * 0.1);
      }
      for (let k = 0; k < 10; k++) {
        const sp = 3 + r() * 9;
        smoke(ve.x, ve.y, ve.z, -dx * sp + (r() - 0.5) * 4, -dy * sp + r() * 1.5, -dz * sp + (r() - 0.5) * 4, 1.4, 7 + r() * 5, 5 + r() * 4, 0.6, 0.74 + r() * 0.12);
      }
      // the blast raises the ground's dust under the launcher
      const a = this._a, dc = this.dustCol;
      for (let k = 0; k < 12; k++) {
        const ang = r() * 2 * PI;
        const w = this.root.matrixWorld.elements;
        a[0] = w[12] + Math.cos(ang) * 2.5; a[1] = w[13] + 0.3; a[2] = w[14] + Math.sin(ang) * 2.5;
        smoke(a[0], a[1], a[2], Math.cos(ang) * (5 + r() * 6), 0.6 + r(), Math.sin(ang) * (5 + r() * 6), 1.0, 5 + r() * 3, 3 + r() * 3, 0.35 * (this.dustK || 0.5) + 0.1, dc ? Math.min(1, dc[0] * 1.3) : 0.7);
      }
    };
    // the pod is full again (the battle's reload has finished)
    P.reload = function () { this.left = TUBES.length; this.reT = 0; this.capsFull(); };

    /* THE ROUND (src/battle/vehicles.js vehFireHE hands it over): a guided
       rocket. It leaves along the pod, climbs and comes down on the aim point
       (fire.js stepRockets: `homing`), the warhead is the M31A1's. */
    P.launched = function (rk, shot, tgt) {
      if (!rk || !rk.pos) return;
      const rnd = typeof lcg === "function" ? lcg : Math.random;     // the battle's own stream when there is one
      const u = this.u || rk.by;
      const fl = this.flightOf();
      const aim = fl.mark.pos;
      if (tgt && tgt.pos) areaAim(u, tgt, aim); else { aim.x = rk.pos.x + rk.vel.x; aim.z = rk.pos.z + rk.vel.z; }
      // CEP ~4 m: GPS/INS
      aim.x += gauss(rnd) * 3.4; aim.z += gauss(rnd) * 3.4;
      const gy = groundY(u, aim.x, aim.z); aim.y = gy;
      const dx = aim.x - rk.pos.x, dz = aim.z - rk.pos.z, d = Math.hypot(dx, dz) || 1, dy = gy - rk.pos.y;
      const T = tofFor(d), el = elFor(d);
      const vh = d / T;
      let vy0 = vh * Math.tan(el), g = 2 * (vy0 * T - dy) / (T * T);
      if (g < 6) { g = 6; vy0 = (dy + g * T * T / 2) / T; }
      rk.vel.set(dx / d * vh, vy0, dz / d * vh);
      rk.grav = g;
      rk.life = T * 1.6 + 4;
      rk.homing = fl.mark;
      const he = (shot && shot.w && shot.w.he) || CBZ.munitionTable.arm(GMLRS).he;
      rk.w = { blastRadius: he.blast, blastPower: he.power / 0.55, sfx: null };
      const MU = CBZ.munitions;
      if (MU && MU.acquire && CBZ.scene) {
        try { const m = MU.acquire("mlrs"); if (m) { m.position.copy(rk.pos); CBZ.scene.add(m); rk.mesh = m; } } catch (e) {}
      }
      fl.r = rk; fl.tgt = tgt || null; fl.T = T; fl.age = 0; fl.upd = 0; fl.st.on = false; fl.mesh = !!rk.mesh;
      fl.mark.dead = false;
      this.flights.push(fl);
    };
    P.flightOf = function () {
      if (this.pool.length) return this.pool.pop();
      const old = this.flights.shift();               // more than 8 in the air: recycle the oldest record (it keeps flying)
      if (old && old.r) old.r.homing = null;
      return old;
    };
    P.stepFlights = function (dt) {
      const MU = CBZ.munitions, spec = MU && MU.spec ? MU.spec("mlrs") : null;
      for (let i = this.flights.length - 1; i >= 0; i--) {
        const fl = this.flights[i], r = fl.r;
        fl.age += dt;
        const gone = !r || (fl.mesh && !r.mesh) || fl.age > (r.life || 30) + 0.5 || (fl.age > 1 && r.pos.y <= groundY(this.u, r.pos.x, r.pos.z) + 0.3);
        if (gone) { fl.r = null; fl.tgt = null; this.flights.splice(i, 1); this.pool.push(fl); continue; }
        // the observer corrects the aim point until the last seconds, then it is a coordinate
        fl.upd -= dt;
        if (fl.upd <= 0 && fl.age < fl.T - 2.5 && fl.tgt && !fl.tgt.dead && fl.tgt.pos) {
          fl.upd = 0.25;
          areaAim(this.u || r.by, fl.tgt, fl.mark.pos);
          fl.mark.pos.y = groundY(this.u, fl.mark.pos.x, fl.mark.pos.z);
        }
        // the motor burns for the climb: flame and its smoke trail
        if (fl.age < 3.2 && MU) {
          const sp = r.vel.length() || 1, ux = r.vel.x / sp, uy = r.vel.y / sp, uz = r.vel.z / sp;
          const nx = r.pos.x - ux * 2.0, ny = r.pos.y - uy * 2.0, nz = r.pos.z - uz * 2.0;
          if (spec && spec.trail && MU.trail) MU.trail(fl.st, nx, ny, nz, ux, uy, uz, spec.trail, sp);
          if (MU.fire) MU.fire(nx, ny, nz, -ux * 6, -uy * 6, -uz * 6, 0.9, 0.3, 0.12, 0.95, 1, 0.62, 0.22, { drag: 3, rise: 0, wind: 0 });
        }
      }
    };

    /* THE FRAME */
    P.update = function (dt, v, w, steer, u, ctx) {
      if (!(dt > 0)) return;
      base.update.call(this, dt, v, w, steer, u, ctx);
      this.u = u || this.u;
      this.layLauncher(dt, v, u);
      this.crewLook(dt, v, u);
      this.stepFlights(dt);
    };
    P.layLauncher = function (dt, v, u) {
      if (this.jammed) { this.laid = false; this.pose(); return; }
      const moving = Math.abs(v) > 0.4;
      // you, at the controls: the launcher follows your look and your mark
      if (u && u.you && typeof YOU !== "undefined" && !moving) {
        const lk = YOU.tgt && !YOU.tgt.dead ? YOU.tgt : null;
        const brg = lk ? Math.atan2(lk.pos.x - u.pos.x, lk.pos.z - u.pos.z) : YOU.yaw;
        this.wantYaw = wrap(brg - u.h + PI);
        this.wantEl = elFor(lk ? Math.hypot(lk.pos.x - u.pos.x, lk.pos.z - u.pos.z) : 800);
        this.layT = this.t;
      }
      const engaged = !moving && this.reT <= 0 && this.t - this.layT < 0.8 && this.left > 0;
      let ty = engaged ? this.wantYaw : 0, te = engaged ? this.wantEl : 0;
      if (this.reT > 0) { ty = 0; te = 0; }
      // the cage must be up off the deck before it swings over the cab
      const yErr = wrap(ty - this.yaw);
      const needSwing = Math.abs(yErr) > 0.02 && (Math.abs(this.yaw) > 0.6 || Math.abs(ty) > 0.6);
      if (needSwing) te = Math.max(te, LAY.clear);
      te = clamp(te, 0, LAY.max);
      this.el += clamp(te - this.el, -LAY.elev * dt, LAY.elev * dt);
      if (!needSwing || this.el >= LAY.clear - 0.02) this.yaw = wrap(this.yaw + clamp(yErr, -LAY.trav * dt, LAY.trav * dt));
      this.laid = engaged && Math.abs(wrap(this.wantYaw - this.yaw)) < 0.035 && Math.abs(this.wantEl - this.el) < 0.03;
      if (u && u.tur) u.tur.yaw = wrap(this.yaw - PI);
      // the reload: the booms swing up, the empty pod comes out, the full one goes in
      let boom = 0, lift = 0;
      if (this.reT > 0) {
        this.reT = Math.max(0, this.reT - dt);
        const p = 1 - this.reT / (this.reTot || RELOAD);
        const sm = function (a, b, x) { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
        boom = sm(0.04, 0.14, p) * (1 - sm(0.88, 0.98, p));
        lift = sm(0.16, 0.36, p) * (1 - sm(0.62, 0.84, p));
        if (p > 0.5 && this.left <= 0 && !this.swapped) { this.swapped = true; this.capsFull(); }     // the full pod is on the hook
        if (p < 0.5) this.swapped = false;
      }
      this.boom = boom; this.lift = lift;
      this.pose();
    };
    P.pose = function () {
      this.launcher.rotation.y = this.yaw;
      this.elev.rotation.x = this.el;
      this.hoist.rotation.x = -(this.boom || 0) * 1.95;
      this.pod.position.y = (this.lift || 0) * 0.62;
      // the jack between its clevis and the cage's lug
      const s = Math.sin(this.el), c = Math.cos(this.el);
      const ay = HINGE.y + JACK.a * s, az = HINGE.z - JACK.a * c;
      const dy = ay - JACK.b[1], dz = az - JACK.b[2], l = Math.hypot(dy, dz) || 1e-3;
      const rx = -Math.atan2(dy, dz);
      this.jack.rotation.x = rx; this.rod.rotation.x = rx;
      this.rod.scale.z = Math.max(0.05, l);
    };
    // the section chief rides head-out of the roof hatch when it is quiet
    P.crewLook = function (dt, v, u) {
      const has = this._has || {};
      const quiet = !(u && u.tgt && !u.tgt.dead) && this.t - this.lastFire > 15 && this.reT <= 0;
      const out = !!has.commander && quiet && !this.dead;
      this.hatch += ((out ? 1 : 0) - this.hatch) * Math.min(1, dt * 3);
      this.hatchLid.rotation.x = -this.hatch * 1.9;
      this.chiefUp.visible = out && this.hatch > 0.6;
      this.chiefSeat.visible = !!has.commander && !this.chiefUp.visible && !this.dead;
    };
    P.damage = function (vs, res) {
      base.damage.call(this, vs, res);
      if (vs && vs.firepower) this.jammed = true;
    };
    /* THE WRECK: the hull kit's fire and settling; a catastrophic kill
       throws the cage off its hinge and the caps are gone */
    P.wrecked = function (dt, u) {
      if (!(dt > 0)) return;
      const first = !this.dead;
      base.wrecked.call(this, dt, u);
      if (first) {
        this.chiefUp.visible = false; this.chiefSeat.visible = false;
        this.hatchLid.rotation.x = -1.9;
        if (this.cat) {
          for (let i = 0; i < TUBES.length; i++) this.capSet(i, false);
          this.elev.rotation.set(0.34, 0.08, 0.22);
          this.elev.position.y += 0.18;
          this.hoist.rotation.x = -0.9;
        }
      }
      this.stepFlights(dt);
    };
  }

  // the middle of the enemy group round the mark (an area fire mission),
  // never on top of our own men; else the mark itself
  function areaAim(u, tgt, out) {
    out.x = tgt.pos.x; out.z = tgt.pos.z;
    const M = typeof men !== "undefined" && Array.isArray(men) ? men : null;
    if (!M || !u) return out;
    let sx = 0, sz = 0, n = 0;
    for (let i = 0; i < M.length; i++) {
      const o = M[i];
      if (o.dead || o.fled || o.air || o.team === u.team || !o.pos) continue;
      const dx = o.pos.x - tgt.pos.x, dz = o.pos.z - tgt.pos.z;
      if (dx * dx + dz * dz > 32 * 32) continue;
      sx += o.pos.x; sz += o.pos.z; n++;
    }
    if (n < 2) return out;
    const cx = sx / n, cz = sz / n, keep = (GMLRS.he ? GMLRS.he.blast : CBZ.munitionTable.fx(GMLRS.mun).R) * 0.8;
    for (let i = 0; i < M.length; i++) {
      const o = M[i];
      if (o.dead || o.team !== u.team || o.vehicle || !o.pos) continue;
      const dx = o.pos.x - cx, dz = o.pos.z - cz;
      if (dx * dx + dz * dz < keep * keep) return out;           // danger close: on the mark only
    }
    out.x = cx; out.z = cz;
    return out;
  }
  function groundY(u, x, z) {
    try {
      if (typeof MAP !== "undefined" && MAP && MAP.groundAt) return MAP.groundAt(x, z);
      if (CBZ.floorAt) return CBZ.floorAt(x, z);
    } catch (e) {}
    return 0;
  }
  function gauss(rnd) { let s = 0; for (let i = 0; i < 6; i++) s += rnd(); return (s - 3) / 0.7071; }

  /* ================================================================ BUILD */
  let BODY = null, BODY_HK = null;
  function build(ctx) {
    const THREE = W.THREE, HK = CBZ.hullKit;
    if (!THREE || !HK) return null;
    rigProto();
    // the body is built once per load of THIS file and of the kit (a hot swap of either rebuilds it)
    if (BODY_HK !== HK || !BODY) { BODY = body(); BODY_HK = HK; }
    const B = BODY;
    const side = ctx.side || ctx.team || null, ground = ctx.ground || ctx.arena;
    const sc = HK.scheme(ctx.nation, ground, side);
    const M = HK.mats(sc);
    const root = new THREE.Group(); root.name = "himars";
    const bodyG = new THREE.Group(); bodyG.name = "body"; root.add(bodyG);
    HK.meshes(bodyG, B.geos, M, "hull");
    if (B.geos.glassT) { const g = new THREE.Mesh(B.geos.glassT, glassMat(THREE)); g.name = "glass"; g.renderOrder = 1; bodyG.add(g); }
    // the roof hatch lid on its hinge (rear edge)
    const lid = new THREE.Group(); lid.name = "hatch"; lid.position.set(HATCH.x, CAB.roof + 0.10, HATCH.z - 0.34); bodyG.add(lid);
    HK.meshes(lid, B.lidGeos, M, "lid");
    // THE LAUNCHER: turntable -> elevation (at the hinge) -> pod (lifts on reload), hoist on the cage
    const launcher = new THREE.Group(); launcher.name = "turret"; launcher.position.set(TT.x, TT.y, TT.z); bodyG.add(launcher);
    HK.meshes(launcher, B.baseGeos, M, "base");
    const elev = new THREE.Group(); elev.name = "gun"; elev.position.set(0, HINGE.y, HINGE.z); launcher.add(elev);
    HK.meshes(elev, B.cageGeos, M, "cage");
    const pod = new THREE.Group(); pod.name = "pod"; elev.add(pod);
    HK.meshes(pod, B.podGeos, M, "pod");
    const caps = new THREE.InstancedMesh(B.capGeo, M.gear, TUBES.length);
    caps.name = "caps"; caps.userData.hkKey = "gear"; caps.castShadow = false;
    if (!B.capGeo._hkBounds) {
      B.capGeo._hkBounds = true;
      B.capGeo.boundingBox = new THREE.Box3(new THREE.Vector3(-0.6, -0.1, -POD.len - 0.2), new THREE.Vector3(0.6, 1.0, -POD.len + 0.1));
      B.capGeo.boundingSphere = new THREE.Sphere(); B.capGeo.boundingBox.getBoundingSphere(B.capGeo.boundingSphere);
    }
    pod.add(caps);
    const hoist = new THREE.Group(); hoist.name = "hoist"; hoist.position.set(0, POD.h + 0.06, -POD.len + 0.08); elev.add(hoist);
    HK.meshes(hoist, B.hoistGeos, M, "hoist");
    const jack = new THREE.Group(); jack.name = "jack"; jack.position.set(JACK.b[0], JACK.b[1], JACK.b[2]); launcher.add(jack);
    HK.meshes(jack, B.jackGeos, M, "jack");
    const rod = new THREE.Group(); rod.name = "jackRod"; rod.position.copy(jack.position); launcher.add(rod);
    HK.meshes(rod, B.rodGeos, M, "rod");
    // the crew: driver left, gunner centre, section chief right (and head-out in the hatch)
    const seed = (ctx.seed | 0) >>> 0;
    const fig = function (kind, k) { return HK.figMesh(kind, sc, (seed + k) % 4, M); };
    const driver = fig("seated", 0); driver.position.set(0.60, 1.80, 2.45); bodyG.add(driver);
    const gunner = fig("seated", 1); gunner.position.set(0.0, 1.80, 2.40); bodyG.add(gunner);
    const chief = fig("seated", 2); chief.position.set(-0.60, 1.80, 2.45); bodyG.add(chief);
    const chiefUp = fig("seated", 3); chiefUp.position.set(HATCH.x, 2.42, HATCH.z); chiefUp.castShadow = true; bodyG.add(chiefUp);
    chiefUp.visible = false;
    // six single wheels
    const wheels = [];
    [[AXF, 1], [AXM, 0], [AXR, 0]].forEach(function (a) {
      wheels.push({ x: TRK, y: R, z: a[0], r: R, steer: a[1] });
      wheels.push({ x: -TRK, y: R, z: a[0], r: R, steer: a[1] });
    });
    const WS = HK.wheelSet(root, B.tyreGeo, B.rimGeos, M, wheels.length, [-1.25, 0, AXR - R, 1.25, 2 * R, AXF + R]);
    const rig = new HimarsRig({
      root: root, body: bodyG, wheels: wheels, tyreIM: WS.tyreIM, rimIMs: WS.rimIMs, wheelbase: AXF - (AXM + AXR) / 2, track: 2 * TRK,
      travel: [0.12, 0.12], scan: false,
      figs: { driver: driver, gunner: gunner },
      exhaust: { p: [0.92, 3.18, 1.08], d: [0, 0.7, -0.35], soot: 0.9 },
      engine: [0, 1.30, 2.30], cabin: [0, 2.10, 2.40], ground: ground, side: side, seed: seed,
      pitchK: 0.008, rollK: 0.006,
      launcher: launcher, elev: elev, pod: pod, caps: caps, hoist: hoist, jack: jack, rod: rod,
      hatchLid: lid, chiefUp: chiefUp, chiefSeat: chief,
      // the nation's flag on both doors and on the stowage boxes
      decal: { parent: bodyG, cache: B.decals, list: [[1.184, 1.62, 2.58, 1, 0, 0.34], [-1.184, 1.62, 2.58, -1, 0, 0.34],
        [1.20, 1.18, -0.05, 1, 0, 0.30], [-1.20, 1.18, -0.05, -1, 0, 0.30]] },
    });
    rig.pose();
    rig.mark(ctx.nation, ground, side);
    return { group: root, rig: rig, footW: Wd, footL: L, height: H };
  }

  CBZ.unitKit.register("m270_mlrs", {
    kind: "vehicle",
    domain: "ground",
    drive: "wheeled",
    // 16.25 t, 290 hp Caterpillar C7: 85 km/h, ~22 m turning circle
    stats: { hp: 300, mass: 16250, speed: 23.6, reverse: 5, accel: 1.3, turn: 0.5, wheelbase: AXF - (AXM + AXR) / 2, maxSteer: 0.38, grip: 0.55,
      length: L, width: Wd, height: H,
      armour: { front: 12, side: 9, rear: 5, top: 5 },
      standoff: 700 },
    launcher: { rate: LAY.trav, elevRate: LAY.elev, elevMin: 0, elevMax: LAY.max },
    crew: [{ seat: "driver", pos: [0.60, 2.25, 2.45] }, { seat: "gunner", pos: [0.0, 2.25, 2.40] }, { seat: "commander", pos: [-0.60, 2.25, 2.45] }],
    passengers: 0,
    weapons: [GMLRS],
    tactics: {
      role: "artillery",
      engage: { soft: 1600, armour: 1600, close: 0 },
      minRange: GMLRS.minRange,
      priorities: ["artillery", "launcher", "group", "vehicle", "men"],
      keepFrom: { men: 700, launcher: 900, armour: 1500 },
      hullDown: false, faceThreat: false, reverseOut: true, lead: false,
      halt: "fire",                       // it stops to fire: the rig holds canFire until laid and still
      shootAndScoot: { after: "salvo", move: 300 },
      screen: { need: "men", behind: 300 },
      withdrawAt: 0.6,
    },
    animate: function (veh, dt, c) {
      const r = veh && veh.rig;
      if (r && r instanceof HimarsRig) {
        if (c && c.dead) r.wrecked(dt, veh);
        else r.update(dt, c ? c.speed : 0, c ? c.yawRate : 0, c ? c.steer : 0, veh, c);
      } else if (CBZ.hullKit) CBZ.hullKit.animate(veh, dt, c);
      else if (c && c.shared) c.shared(dt);
    },
    // a player at the controls: there is one weapon, the pod
    moves: function () { return GMLRS.id; },
    build: build,
  });
})();
