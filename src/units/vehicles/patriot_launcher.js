/* ============================================================
   units/vehicles/patriot_launcher.js — the Patriot M903 launching station
   on its M860A1 semitrailer, towed by an M983 HEMTT 8x8 tractor (USA;
   fielded by any nation's army here).

   REDRAWN FROM SCRATCH (2026-10-11). What was here: city/mil_armor.js's
   buildPatriot, a generic 6x6 truck with a box of four tubes on its back.
   What is here, from the system's own numbers:

   THE TRACTOR  M983A4 HEMTT: 8x8, two steered front axles 1.52 m apart, the
             rear tandem on walking beams, 16.00R20 tyres (1.24 m) on big
             disc wheels, all singles. The flat-fronted cab over the front
             axles: grille, raked two-pane windscreen, doors with their
             windows, steps, mirrors on their arms, the commander's roof
             hatch with a ring mount and an M2. Behind the cab the engine
             house with its louvres, the air intake stack (right) and the
             exhaust stack (left), fuel tank, tool and battery boxes, the
             catwalk, a spare wheel, and the fifth wheel over the tandem.
   THE TRAILER  M860A1 two-axle semitrailer, ARTICULATED at the kingpin: it
             follows the tractor through a turn on the real trailer
             kinematics (no side-slip at its axles), it rides the ground on
             its own wheels and pitches about the hitch. On the gooseneck the
             15 kW 400 Hz generator in its louvred housing, the data link
             mast; on the deck the launcher electronics, the fibre-optic
             cable reel, four outriggers (two a side) with screw jacks.
   THE LAUNCHER  M903 launching station: a turntable mid-deck, the launcher
             frame hinged at its front, two erecting rams. Twelve PAC-3 MSE
             canisters in three rows of four (the M903's MSE load), banded,
             their frangible covers facing the trailer's tail. It ERECTS to a
             fixed 38 degree launch angle and trains +/-110 degrees in
             azimuth; it fires over the trailer's rear. A cover blows off
             with every launch and the empty cell stays open.
   EMPLACE   a real sequence, on the battle clock: stop, outriggers out and
             down (4 s), the mast up, the launcher up to 38 degrees (about
             7 s), slew onto the bearing (20 deg/s), fire. March order is the
             reverse: back to the travel lock, down, jacks up, drive.
   WEAPONS   PAC-3 MSE: hit-to-kill interceptor, Mach 5 class (1,600 m/s
             here), 35 km against aircraft; it engages aircraft and
             helicopters only, fired as a two-round ripple (shoot-shoot) and
             not reloaded in battle (a reload is an hour with the transporter
             crane). An M2HB .50 on the cab's ring for close defence.
   ARMOUR    the HEMTT A4's armoured cab kit stops rifle ball from the front
             (10 mm); everything else is a truck, a trailer and aluminium
             canisters: rifle fire goes through the sides and the back.
   DAMAGE    the kit's smoke, fire and burnt-off tyres; a wreck's paint
             burns black, the launcher frame slumps off its rams, and a
             catastrophic kill cooks off the missiles still in their cells
             one by one and throws the launcher off its turntable.
   CREW      driver and launcher chief (commander) in the cab. Calm: the
             chief rides head-out of the roof hatch. A ground fight: he
             stands up on the .50. A launch: he is buttoned up inside.

   TACTICS   a Patriot launcher never leads and never chases. The runtime's
             default is to drive a hull to its stand-off from its mark (a
             launcher would drive under the jet it is shooting at, or at the
             enemy infantry): this file keeps its own site instead, through
             veh.target in animate. On the first tick it turns round (the
             launcher covers the REAR 220 degrees, so a crew puts its tail
             to the threat), goes some 20-60 m, stops and emplaces; it holds
             that site for the battle. A ground threat inside 450 m makes it
             march-order and displace 300 m away from it, then emplace again.
             def.tactics says all of this for the AI layer (src/battle/ai/*):
             role "air-defence", emplace, faceThreat "rear", displaceAt.

   Units: metres, m/s, kg, mm RHA. Nose +Z, +X is the vehicle's left.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.unitKit) return;
  const PI = Math.PI;

  // ---------------------------------------------------------- the numbers
  const L = 16.5, Wd = 2.50, H = 4.05;
  const R = 0.62, TW = 0.40, RIM = 0.27, TX = 1.00;          // 16.00R20 on a 20 in. rim, track half
  const A1 = 6.90, A2 = 5.38, A3 = 2.10, A4 = 0.58;          // tractor axles (front bumper at +8.2)
  const KPZ = 1.45, KPY = 1.58;                               // the kingpin on the fifth wheel
  const RC = (A3 + A4) / 2;                                   // the tractor's rear tandem centre
  const T1 = -7.55, T2 = -8.85, TREAR = -9.75;                // trailer axles and tail, kingpin space
  const L2 = -(T1 + T2) / 2;                                  // kingpin to the trailer tandem centre
  const DECK = -0.18;                                         // trailer deck top, kingpin space
  const HZ = -3.60, HY = 0.32;                                // launcher hinge (turntable), kingpin space
  const BOXL = 5.95;                                          // launcher frame length from the hinge
  const COLS = [0.87, 0.29, -0.29, -0.87], ROWS = [0.53, 1.14, 1.75], CW = 0.56, CH = 0.59;
  const ELEV = 38 * PI / 180, TRAV = 110 * PI / 180;
  const RATE = { trav: 0.35, elev: 0.09, jack: 0.25, mast: 0.4 };
  const JACKS = [[1, -2.75], [-1, -2.75], [1, -9.25], [-1, -9.25]];   // side, z (kingpin space)
  const RING = { x: -0.52, y: 3.00, z: 7.05, r: 0.42 };
  const DISPLACE = 450;

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function wrap(a) { while (a > PI) a -= 2 * PI; while (a < -PI) a += 2 * PI; return a; }
  function toward(cur, want, step) { return cur + clamp(want - cur, -step, step); }

  /* ================================================================ THE BODY */
  function tractorBody(HK) {
    const G = HK.geo();
    // ------------------------------------------------ frame and running gear
    G.m("paint").c(0.6);
    [-1, 1].forEach(function (s) {
      G.box(s * 0.47, 1.06, 3.85, 0.10, 0.30, 8.30);
      G.box(s * 0.43, 1.06, 3.85, 0.02, 0.26, 8.30);
    });
    [7.8, 6.2, 4.6, 3.0, 1.45, -0.1].forEach(function (z) { G.box(0, 1.02, z, 0.86, 0.18, 0.12); });
    G.m("metal").c(0.85);
    [A1, A2, A3, A4].forEach(function (z) {
      G.cyl(0, R, z, 0.085, 0.085, 1.70, "x", 10);
      G.sphere(0, R, z, 0.24, 9, 0.9, 1.0, 1.0);
      [-1, 1].forEach(function (s) { G.cyl(s * 0.74, R, z, 0.15, 0.15, 0.18, "x", 12); });
    });
    // front: taper-leaf springs on both steer axles, the steering drag links
    [A1, A2].forEach(function (z) {
      [-1, 1].forEach(function (s) {
        for (let i = 0; i < 4; i++) G.box(s * 0.47, R + 0.13 + i * 0.03, z, 0.08, 0.025, 1.20 - i * 0.2);
        G.box(s * 0.47, R + 0.10, z, 0.12, 0.08, 0.18);
      });
    });
    G.tube([0.62, R + 0.12, A1], [0.62, R + 0.12, A2], 0.03, 0.03);
    // rear: walking beams on the tandem, the torque rods
    [-1, 1].forEach(function (s) {
      G.box(s * 0.58, R + 0.02, RC, 0.12, 0.22, A3 - A4 + 0.3);
      G.cyl(s * 0.50, R + 0.30, RC, 0.12, 0.12, 0.22, "x", 10);
      G.box(s * 0.47, R + 0.38, RC, 0.10, 0.12, 0.6);
      G.tube([s * 0.30, R + 0.2, A3], [s * 0.30, R + 0.38, RC + 0.2], 0.03, 0.03);
      G.tube([s * 0.30, R + 0.2, A4], [s * 0.30, R + 0.38, RC - 0.2], 0.03, 0.03);
    });
    G.cyl(0, 0.80, (A2 + A3) / 2, 0.05, 0.05, A2 - A3, "z", 8);           // propeller shafts
    G.box(0, 0.85, 3.9, 0.42, 0.34, 0.55);                                 // transfer case
    // ------------------------------------------------ the front: bumper, winch, lamps
    G.m("paint").c(0.95);
    G.box(0, 0.98, 8.10, 2.44, 0.34, 0.20);
    G.m("dark").c(1);
    G.box(0, 0.98, 8.21, 0.80, 0.22, 0.04);                                // winch fairlead
    G.cyl(0, 0.98, 8.0, 0.11, 0.11, 0.62, "x", 10);
    [-1, 1].forEach(function (s) {
      G.box(s * 0.82, 0.98, 8.23, 0.10, 0.10, 0.06);
      G.cyl(s * 0.82, 0.98, 8.27, 0.06, 0.06, 0.03, "x", 10);              // tow shackles
      G.m("paint").c(0.9).box(s * 0.98, 1.20, 8.12, 0.40, 0.20, 0.12);     // lamp pods in the bumper corners
      G.m("lamp").c(1).cyl(s * 1.04, 1.20, 8.185, 0.075, 0.075, 0.01, "z", 14);
      G.m("amber").c(1).box(s * 0.86, 1.20, 8.185, 0.08, 0.06, 0.01);
      G.m("lamp").c(0.6).box(s * 1.04, 1.36, 8.10, 0.10, 0.05, 0.04);       // blackout marker
      G.m("dark").c(1);
    });
    // ------------------------------------------------ the cab (side profile loft)
    G.m("paint").c(1);
    G.prof(-1.21, 1.21, [[6.00, 1.18], [8.04, 1.18], [8.06, 1.95], [7.86, 2.72], [7.74, 2.86], [6.00, 2.86]]);
    // roof edge cap, drip rails
    G.c(0.92).box(0, 2.875, 6.88, 2.30, 0.03, 1.66);
    [-1, 1].forEach(function (s) { G.box(s * 1.215, 2.78, 6.9, 0.03, 0.03, 1.80); });
    // the grille: the slatted panel in the flat front, the bar guard
    G.m("black").c(1).box(0, 1.55, 8.065, 1.70, 0.62, 0.02);
    G.m("paint").c(0.85);
    for (let i = 0; i < 14; i++) G.box(0, 1.27 + i * 0.044, 8.075, 1.66, 0.012, 0.03);
    G.c(1).box(0, 1.90, 8.07, 2.0, 0.05, 0.03);
    // windscreen: two raked panes, the frame, wipers
    G.save().tf(0, 2.32, 7.965, -0.25, 0, 0);
    G.m("glass").c(1);
    [-1, 1].forEach(function (s) { G.box(s * 0.56, 0, 0.012, 0.98, 0.70, 0.02); });
    G.m("paint").c(0.8).box(0, 0, 0.0, 0.07, 0.76, 0.04);
    G.m("black").c(1);
    [-1, 1].forEach(function (s) { G.box(s * 0.56, -0.30, 0.03, 0.42, 0.015, 0.015, 0, 0, s * 0.25); });
    G.restore();
    // doors: seams, windows, handles, hinges; the steps and grab handles
    [-1, 1].forEach(function (s) {
      const x = s * 1.215;
      G.m("black").c(1);
      G.box(x, 2.0, 7.60, 0.012, 1.55, 0.015); G.box(x, 2.0, 6.25, 0.012, 1.55, 0.015);
      G.box(x, 2.76, 6.92, 0.012, 0.015, 1.36); G.box(x, 1.24, 6.92, 0.012, 0.015, 1.36);
      G.box(x + s * 0.01, 1.98, 6.40, 0.03, 0.04, 0.14);
      [1.55, 2.45].forEach(function (y) { G.box(x + s * 0.01, y, 7.58, 0.03, 0.12, 0.05); });
      G.m("glass").c(1).box(x + s * 0.004, 2.40, 6.95, 0.01, 0.56, 1.10);
      G.m("paint").c(0.8);
      G.box(s * 1.10, 0.92, 6.95, 0.30, 0.03, 0.70); G.box(s * 1.10, 0.62, 6.95, 0.30, 0.03, 0.70);
      G.box(s * 1.24, 0.80, 6.62, 0.02, 0.40, 0.03); G.box(s * 1.24, 0.80, 7.28, 0.02, 0.40, 0.03);
      G.m("dark").c(1).tube([s * 1.24, 1.45, 6.10], [s * 1.24, 2.55, 6.10], 0.018, 0.018);
      // mirrors on their arms off the front corners
      G.tube([s * 1.21, 2.55, 7.70], [s * 1.52, 2.62, 7.62], 0.018, 0.018);
      G.tube([s * 1.21, 1.95, 7.80], [s * 1.52, 2.20, 7.62], 0.018, 0.018);
      G.box(s * 1.54, 2.38, 7.62, 0.05, 0.46, 0.24);
      G.m("glass").c(1).box(s * 1.54, 2.38, 7.62 - 0.125, 0.04, 0.42, 0.005);
      // front fenders over both steer axles, their mud flaps
      G.m("paint").c(1);
      G.box(s * 1.04, 1.30, 6.10, 0.42, 0.04, 2.40);
      G.box(s * 1.24, 1.22, 6.10, 0.03, 0.16, 2.40);
      G.m("black").c(1).box(s * 1.04, 0.85, 4.85, 0.40, 0.70, 0.02);
    });
    // the roof hatch and ring (commander's side)
    G.m("paint").c(0.9).cyl(RING.x, 2.92, RING.z, RING.r + 0.06, RING.r + 0.08, 0.10, "y", 20);
    G.m("dark").c(1);
    for (let i = 0; i < 24; i++) {
      const a0 = i * PI / 12, a1 = (i + 1) * PI / 12;
      G.tube([RING.x + Math.sin(a0) * RING.r, RING.y, RING.z + Math.cos(a0) * RING.r], [RING.x + Math.sin(a1) * RING.r, RING.y, RING.z + Math.cos(a1) * RING.r], 0.03, 0.03, 6);
    }
    G.m("paint").c(0.9).box(RING.x - 0.30, 2.99, RING.z - 0.42, 0.50, 0.04, 0.42, 0, 0.4, -0.9);   // hatch lid, open
    // antennas: two whips on the cab's back corners
    G.m("black").c(1);
    [-1, 1].forEach(function (s) {
      G.cyl(s * 1.05, 2.95, 6.10, 0.04, 0.05, 0.12, "y", 8);
      G.cyl(s * 1.05, 3.95, 6.10, 0.005, 0.008, 1.9, "y", 4);
    });
    // ------------------------------------------------ behind the cab
    G.m("paint").c(1);
    G.prof(-0.78, 0.78, [[4.85, 1.20], [5.98, 1.20], [5.98, 2.40], [5.10, 2.46], [4.85, 2.30]]);    // the engine house
    G.m("black").c(1);
    [-1, 1].forEach(function (s) {
      for (let i = 0; i < 8; i++) G.box(s * 0.785, 1.85, 5.0 + i * 0.12, 0.012, 0.6, 0.04, 0, 0, s * 0.3);
    });
    // air intake stack (right) with its rain cap; exhaust stack (left) with heat shield
    G.m("paint").c(0.95);
    G.cyl(-0.98, 2.30, 5.55, 0.17, 0.17, 1.35, "y", 16);
    G.cyl(-0.98, 3.02, 5.55, 0.22, 0.20, 0.12, "y", 16);
    G.m("dark").c(1).cyl(-0.98, 3.10, 5.55, 0.16, 0.16, 0.06, "y", 14);
    G.m("black").c(1);
    G.cyl(0.98, 2.30, 5.40, 0.07, 0.07, 1.55, "y", 10);
    G.tube([0.98, 3.07, 5.40], [0.98, 3.16, 5.28], 0.07, 0.07);
    G.m("dark").c(1).cyl(0.98, 2.45, 5.40, 0.11, 0.11, 0.80, "y", 12, 0, 0, 0, { open: true });
    // fuel tank (left), battery box and tool box (right)
    G.m("paint").c(0.9);
    G.cyl(1.0, 0.98, 5.35, 0.30, 0.30, 1.10, "z", 16);
    G.m("dark").c(1).cyl(1.0, 1.28, 5.55, 0.06, 0.06, 0.04, "y", 10);
    G.m("paint").c(0.85).box(-1.0, 0.98, 5.30, 0.42, 0.50, 1.00);
    G.box(-1.0, 0.98, 3.90, 0.42, 0.44, 1.30);
    G.m("black").c(1).box(-1.215, 0.98, 3.90, 0.01, 0.30, 1.10);
    // the catwalk with tread plate, the spare wheel lying on it
    G.m("paint").c(0.8).box(0, 1.24, 3.75, 2.20, 0.04, 2.20);
    G.m("dark").c(1);
    for (let i = 0; i < 10; i++) G.box(0, 1.265, 2.75 + i * 0.22, 2.16, 0.012, 0.04);
    // the fifth wheel: mounting brackets, the plate with its throat and ramps
    G.m("metal").c(0.8);
    [-1, 1].forEach(function (s) { G.box(s * 0.40, KPY - 0.28, KPZ, 0.14, 0.30, 0.70); });
    G.cyl(0, KPY - 0.08, KPZ, 0.62, 0.62, 0.10, "y", 20);
    G.m("dark").c(1).box(0, KPY - 0.02, KPZ - 0.42, 0.18, 0.02, 0.50);
    [-1, 1].forEach(function (s) { G.box(s * 0.40, KPY - 0.20, KPZ - 0.75, 0.20, 0.06, 0.50, -0.35, 0, 0); });
    // rear mudguards over the tandem, the light bar, the pintle
    G.m("paint").c(0.95);
    [-1, 1].forEach(function (s) {
      G.box(s * 1.00, 1.36, RC, 0.50, 0.04, A3 - A4 + 1.45);
      G.box(s * 1.24, 1.28, RC, 0.03, 0.16, A3 - A4 + 1.45);
      G.save().m("black").c(1).box(s * 1.00, 0.85, A4 - 0.82, 0.46, 0.70, 0.02).restore();
    });
    G.box(0, 1.00, -0.28, 2.30, 0.12, 0.12);
    [-1, 1].forEach(function (s) {
      G.save().m("tail").c(1).box(s * 0.95, 1.00, -0.35, 0.14, 0.08, 0.02).restore();
      G.save().m("amber").c(1).box(s * 0.78, 1.00, -0.35, 0.08, 0.06, 0.02).restore();
    });
    G.m("dark").c(1).box(0, 0.90, -0.36, 0.20, 0.14, 0.14).cyl(0, 0.90, -0.46, 0.07, 0.07, 0.04, "y", 10);
    return G.build({ uv: 2.6, mud: 1.15 });
  }

  // the spare wheel on the catwalk (tyre + disc), in tractor space
  function spareInto(HK, G) {
    G.save().tf(0.45, 1.26 + TW / 2, 3.30, 0, 0, PI / 2);
    HK.tyre(G, R, TW, RIM, { lug: "ndt", lugs: 20, dep: 0.03 });
    G.m("paint").c(0.8).cyl(0, 0, 0, RIM, RIM, 0.10, "x", 18);
    G.restore();
  }

  function trailerBody(HK) {
    const G = HK.geo();
    // ------------------------------------------------ the gooseneck, upper deck
    G.m("paint").c(1);
    G.box(0, 0.22, -0.525, 2.44, 0.36, 2.95);
    G.c(0.9).box(0, 0.05, -0.40, 0.80, 0.10, 2.5);
    G.m("dark").c(1).cyl(0, -0.04, 0, 0.05, 0.05, 0.10, "y", 10);           // the kingpin
    G.m("paint").c(0.95);
    G.sect([[-2.00, [[-1.22, 0.40], [1.22, 0.40], [1.22, 0.02], [-1.22, 0.02]]], [-2.45, [[-1.22, DECK], [1.22, DECK], [1.22, DECK - 0.42], [-1.22, DECK - 0.42]]]]);
    // landing legs (cranked up), the crank
    G.m("paint").c(0.8);
    [-1, 1].forEach(function (s) {
      G.box(s * 0.85, -0.48, -1.70, 0.14, 0.80, 0.14);
      G.box(s * 0.85, -0.98, -1.70, 0.10, 0.30, 0.10);
      G.m("dark").c(1).box(s * 0.85, -1.15, -1.70, 0.30, 0.04, 0.30).m("paint").c(0.8);
    });
    G.box(0, -0.62, -1.70, 1.60, 0.06, 0.06);
    G.m("dark").c(1).tube([1.0, -0.40, -1.70], [1.18, -0.55, -1.70], 0.015, 0.015);
    // ------------------------------------------------ the generator housing on the gooseneck
    G.m("paint").c(1);
    G.box(0, 1.00, -0.02, 2.24, 1.20, 1.70);
    G.c(0.9).box(0, 1.62, -0.02, 2.30, 0.05, 1.76);
    G.m("black").c(1);
    [-1, 1].forEach(function (s) {
      for (let i = 0; i < 9; i++) G.box(s * 1.122, 1.05, -0.60 + i * 0.075, 0.012, 0.55, 0.03, 0, 0, s * 0.35);   // louvres
      G.box(s * 1.122, 1.00, 0.45, 0.012, 1.0, 0.012); G.box(s * 1.122, 1.00, -0.70, 0.012, 1.0, 0.012);
      G.box(s * 1.13, 0.80, 0.55, 0.02, 0.05, 0.10);
    });
    G.box(0, 1.00, 0.832, 1.6, 0.9, 0.012);                                   // the front access panel
    G.m("dark").c(1);
    G.cyl(0.85, 1.85, -0.65, 0.05, 0.05, 0.42, "y", 8);                       // generator exhaust
    G.tube([0.85, 2.05, -0.65], [0.85, 2.10, -0.78], 0.05, 0.05);
    G.cyl(-0.85, 1.67, 0.55, 0.06, 0.06, 0.05, "y", 10);                      // fuel filler
    // ------------------------------------------------ the main deck
    const zc = (-2.45 + TREAR) / 2, zl = -2.45 - TREAR;
    G.m("paint").c(1);
    G.box(0, DECK - 0.05, zc, 2.44, 0.10, zl);
    G.m("paint").c(0.7);
    [-1, 1].forEach(function (s) {
      G.box(s * 0.50, DECK - 0.35, zc, 0.10, 0.50, zl);                        // main I-beams
      G.box(s * 0.50, DECK - 0.58, zc, 0.24, 0.04, zl);
      G.c(0.95).box(s * 1.20, DECK - 0.10, zc, 0.04, 0.22, zl);                 // side rails
      G.c(0.7);
      for (let z = -3.0; z > TREAR + 0.2; z -= 0.9) {
        G.save().m("dark").c(1).box(s * 1.23, DECK - 0.12, z, 0.03, 0.06, 0.10).restore();   // tie-down rings
      }
    });
    for (let z = -2.6; z > TREAR; z -= 0.75) G.box(0, DECK - 0.22, z, 2.30, 0.12, 0.08);   // outriggers of the deck
    // trailer running gear: spring hangers, axles, mud flaps
    G.m("metal").c(0.85);
    [T1, T2].forEach(function (z) {
      G.cyl(0, R - KPY, z, 0.08, 0.08, 1.70, "x", 10);
      [-1, 1].forEach(function (s) { G.cyl(s * 0.74, R - KPY, z, 0.14, 0.14, 0.18, "x", 12); });
    });
    [-1, 1].forEach(function (s) {
      for (let i = 0; i < 5; i++) G.box(s * 0.50, R - KPY + 0.16 + i * 0.028, (T1 + T2) / 2, 0.08, 0.024, 1.9 - i * 0.25);
      G.box(s * 0.50, R - KPY + 0.40, T1 + 0.55, 0.10, 0.36, 0.08); G.box(s * 0.50, R - KPY + 0.40, T2 - 0.55, 0.10, 0.36, 0.08);
      G.save().m("black").c(1).box(s * 1.00, -0.95, T2 - 0.80, 0.46, 0.60, 0.02).restore();
    });
    // the rear: bumper / under-ride bar, lamps, reflectors
    G.m("paint").c(0.9);
    G.box(0, -0.70, TREAR + 0.10, 2.30, 0.16, 0.14);
    [-1, 1].forEach(function (s) {
      G.box(s * 0.60, -0.45, TREAR + 0.12, 0.10, 0.40, 0.10);
      G.save().m("tail").c(1).box(s * 0.95, -0.36, TREAR - 0.01, 0.16, 0.10, 0.02).restore();
      G.save().m("amber").c(1).box(s * 0.75, -0.36, TREAR - 0.01, 0.08, 0.08, 0.02).restore();
    });
    // ------------------------------------------------ on the deck: electronics, cable reel, outrigger housings
    G.m("paint").c(0.95);
    G.box(-0.80, DECK + 0.45, -2.85, 0.70, 0.90, 0.80);                         // launcher electronics module
    G.m("black").c(1);
    G.box(-0.80, DECK + 0.50, -2.445, 0.56, 0.70, 0.012);
    G.box(-0.80, DECK + 0.72, -2.44, 0.30, 0.18, 0.02);
    [-0.65, -0.95].forEach(function (x) { G.cyl(x, DECK + 0.25, -2.43, 0.035, 0.035, 0.04, "z", 8); });
    G.m("paint").c(0.85);
    G.cyl(0.78, DECK + 0.48, -2.85, 0.42, 0.42, 0.48, "x", 18);                // fibre-optic cable reel
    G.m("dark").c(1).cyl(0.78, DECK + 0.48, -2.85, 0.30, 0.30, 0.44, "x", 16);
    G.m("paint").c(0.8);
    [-1, 1].forEach(function (s) { G.box(0.78 + s * 0.26, DECK + 0.22, -2.85, 0.04, 0.44, 0.60); });
    JACKS.forEach(function (j) {
      G.m("paint").c(0.85).box(j[0] * 1.10, DECK - 0.30, j[1], 0.26, 0.24, 0.40);   // outrigger hinge boxes
    });
    return G.build({ uv: 2.6, mud: 1.0 });
  }

  // the turntable and the launcher's base frame (launcher space: hinge at 0)
  function mountBody(HK) {
    const G = HK.geo(), dy = DECK - HY;
    G.m("metal").c(0.8);
    G.cyl(0, dy + 0.08, -0.6, 0.95, 1.0, 0.16, "y", 24);
    G.m("paint").c(0.9);
    // base frame rails back under the launcher, the travel lock post at the tail end
    [-1, 1].forEach(function (s) {
      G.box(s * 0.75, dy + 0.24, -1.6, 0.14, 0.18, 3.0);
      // the A-frames carrying the hinge bearings
      G.prof(s * 1.08, s * 0.92, [[0.25, dy + 0.16], [-1.30, dy + 0.16], [-0.25, -0.05], [0.12, -0.05]]);
      G.save().m("dark").c(1).cyl(s * 1.12, 0, 0, 0.13, 0.13, 0.12, "x", 14).restore();
    });
    G.box(0, dy + 0.24, -0.1, 1.64, 0.18, 0.18);
    G.box(0, dy + 0.24, -3.0, 1.64, 0.18, 0.18);
    G.box(0, dy + 0.40, -5.20, 0.30, 0.42, 0.20);                            // the travel-lock post
    G.m("dark").c(1).box(0, dy + 0.63, -5.20, 0.42, 0.04, 0.26);
    // ram anchors
    [-1, 1].forEach(function (s) { G.box(s * 0.70, dy + 0.34, -1.20, 0.16, 0.20, 0.24); });
    // umbilical harness from the turntable to the launcher's hinge end
    G.m("black").c(1);
    G.tube([0.35, dy + 0.18, 0.05], [0.35, 0.05, 0.25], 0.05, 0.05);
    G.tube([0.35, 0.05, 0.25], [0.35, 0.25, 0.10], 0.05, 0.05);
    return G.build({ uv: 2.6, mud: 0.6 });
  }

  // the launcher frame and its twelve canisters (cradle space: hinge at 0, tail -Z)
  function launcherBody(HK) {
    const G = HK.geo(), z0 = -0.25, z1 = -5.85, zc = (z0 + z1) / 2, zl = z0 - z1;
    // the canisters: banded aluminium boxes
    G.m("gear").c(1);
    COLS.forEach(function (x, ci) {
      ROWS.forEach(function (y, ri) {
        G.c(0.92 + ((ci + ri) % 3) * 0.04);
        G.box(x, y, zc, CW, CH, zl);
        G.c(0.8);
        for (let z = z0 - 0.35; z > z1; z -= 0.72) G.box(x, y, z, CW + 0.012, CH + 0.012, 0.05);
        G.box(x, y, z1 + 0.04, CW + 0.02, CH + 0.02, 0.08);                    // forward flange round the cover
        // the open mouth behind the cover (seen once it has gone)
        G.save().m("black").c(1).box(x, y, z1 + 0.005, CW - 0.06, CH - 0.06, 0.012).restore();
        G.c(1);
      });
    });
    // the launcher frame: bottom beams, side trusses, top bars, end frames
    G.m("paint").c(0.95);
    [-1, 1].forEach(function (s) {
      G.box(s * 1.13, 0.17, -2.95, 0.14, 0.14, 6.0);
      G.box(s * 1.21, 2.10, -2.95, 0.06, 0.08, 6.0);
      [-0.15, -2.0, -3.9, -5.85].forEach(function (z) { G.box(s * 1.21, 1.13, z, 0.07, 1.94, 0.10); });
      // diagonal truss bracing between the posts
      [[-0.15, -2.0], [-2.0, -3.9], [-3.9, -5.85]].forEach(function (p, k) {
        const a = k % 2 ? [s * 1.21, 0.25, p[0]] : [s * 1.21, 2.05, p[0]], b = k % 2 ? [s * 1.21, 2.05, p[1]] : [s * 1.21, 0.25, p[1]];
        G.tube(a, b, 0.03, 0.03, 6);
      });
      // lifting eyes on the top corners
      G.save().m("dark").c(1).box(s * 1.18, 2.18, -0.2, 0.04, 0.10, 0.12).box(s * 1.18, 2.18, -5.8, 0.04, 0.10, 0.12).restore();
    });
    [-0.15, -2.0, -3.9, -5.85].forEach(function (z) { G.box(0, 2.13, z, 2.40, 0.06, 0.08); G.box(0, 0.17, z, 2.40, 0.10, 0.10); });
    // the hinge end: bulkhead with the connector boxes and the hinge lugs
    G.box(0, 1.13, -0.06, 2.36, 1.98, 0.06);
    G.m("dark").c(1);
    [-0.6, 0, 0.6].forEach(function (x) { G.box(x, 1.30, 0.0, 0.34, 0.26, 0.10); });
    G.box(0, 0.75, 0.0, 1.4, 0.10, 0.08);
    [-1, 1].forEach(function (s) {
      G.box(s * 1.00, 0.06, 0.0, 0.16, 0.22, 0.30);
      G.cyl(s * 1.00, 0, 0, 0.10, 0.10, 0.20, "x", 12);
      G.box(s * 0.70, 0.08, -2.60, 0.18, 0.14, 0.24);                          // ram lugs
    });
    return G.build({ uv: 2.6, mud: 0.3 });
  }

  // a ram: barrel along +Z from its anchor, the rod slides out of it
  function ramBody(HK) {
    const B = HK.geo();
    B.m("paint").c(0.85).cyl(0, 0, 0.50, 0.075, 0.085, 1.0, "z", 10);
    B.m("dark").c(1).cyl(0, 0, 0.0, 0.09, 0.09, 0.12, "x", 10);
    const Rd = HK.geo();
    Rd.m("metal").c(1.0).cyl(0, 0, 0.55, 0.042, 0.042, 1.1, "z", 8);
    Rd.m("dark").c(1).cyl(0, 0, 1.1, 0.07, 0.07, 0.12, "x", 10);
    return { barrel: B.build({ uv: 1, mud: 0 }), rod: Rd.build({ uv: 1, mud: 0 }) };
  }

  // an outrigger: the arm along +Z from its hinge, the screw jack at its tip
  function jackBody(HK) {
    const A = HK.geo();
    A.m("paint").c(0.9).box(0, 0, 0.55, 0.16, 0.16, 1.10);
    A.m("dark").c(1).cyl(0, 0, 0, 0.09, 0.09, 0.26, "y", 10);
    A.m("paint").c(0.9).cyl(0, -0.15, 1.12, 0.09, 0.09, 0.46, "y", 10);        // the jack housing
    A.m("dark").c(1).cyl(0, 0.14, 1.12, 0.03, 0.03, 0.14, "y", 6);             // the crank head
    const Lg = HK.geo();
    Lg.m("metal").c(1).cyl(0, -0.3, 0, 0.06, 0.06, 0.6, "y", 8);               // inner leg, top at 0
    Lg.m("dark").c(1).cyl(0, -0.6, 0, 0.24, 0.26, 0.05, "y", 14);              // the pad
    return { arm: A.build({ uv: 1.6, mud: 0.2 }), leg: Lg.build({ uv: 1, mud: 0 }) };
  }

  // the data link mast: folds up from the gooseneck (pivot at its foot, +Y up)
  function mastBody(HK) {
    const G = HK.geo();
    G.m("paint").c(0.85).cyl(0, 0.60, 0, 0.05, 0.06, 1.2, "y", 8);
    G.c(0.8).cyl(0, 1.75, 0, 0.035, 0.04, 1.1, "y", 8);
    G.m("dark").c(1).box(0, 2.35, 0, 0.30, 0.04, 0.04);
    G.box(0, 2.36, 0, 0.04, 0.04, 0.30);
    G.m("black").c(1).cyl(0, 2.95, 0, 0.006, 0.012, 1.2, "y", 4);
    G.m("dark").c(1).cyl(0, 0, 0, 0.07, 0.07, 0.16, "x", 10);
    return G.build({ uv: 1, mud: 0 });
  }

  // PAC-3 MSE: 5.2 m, 0.29 m body, the long ogive with its seeker, the
  // control fins and the bigger tail fins; along +Z, nose forward
  function missileBody(HK) {
    const G = HK.geo();
    G.save().tf(0, 0, 0, 0, -PI / 2, 0);                  // lathe axis X -> +Z
    G.m("lamp").c(0xe9e7df);
    G.lathe([[0.0, 2.62], [0.035, 2.55], [0.075, 2.38], [0.11, 2.15], [0.135, 1.90], [0.145, 1.62], [0.145, -2.40], [0.13, -2.52], [0.11, -2.58]], 14);
    G.c(0x2b2b28).lathe([[0.11, -2.58], [0.10, -2.62], [0.0, -2.62]], 12);
    G.restore();
    G.m("lamp").c(0xd4d2c8);
    for (let k = 0; k < 4; k++) {
      const a = k * PI / 2 + PI / 4, c = Math.cos(a), s = Math.sin(a);
      G.box(c * 0.27, s * 0.27, -2.15, 0.012, 0.26, 0.55, 0, 0, a + PI / 2);    // tail fins
      G.box(c * 0.20, s * 0.20, 1.20, 0.010, 0.11, 0.26, 0, 0, a + PI / 2);     // forward strakes
    }
    G.c(0x2b2b28).cyl(0, 0, 1.55, 0.147, 0.147, 0.06, "z", 14);                 // the seeker band
    return G.build({ uv: 1, mud: 0 });
  }

  function wheelBody(HK) {
    const Wg = HK.geo();
    HK.tyre(Wg, R, TW, RIM, { lug: "ndt", lugs: 20, dep: 0.03 });
    const tyreGeo = Wg.build({ uv: 1, mud: 0 }).rubber;
    // the HEMTT's big steel disc wheel: dished disc, the CTIS hub, the nuts
    const Dg = HK.geo();
    Dg.m("paint").c(0.85);
    Dg.cyl(TW * 0.30, 0, 0, RIM, RIM, 0.06, "x", 22);
    Dg.cyl(TW * 0.36, 0, 0, RIM * 0.62, RIM * 0.78, 0.06, "x", 20);
    Dg.cyl(TW * 0.44, 0, 0, 0.11, 0.13, 0.10, "x", 14);
    Dg.m("black").c(1);
    for (let i = 0; i < 8; i++) { const a = i * PI / 4 + 0.2; Dg.cyl(TW * 0.335, Math.cos(a) * RIM * 0.80, Math.sin(a) * RIM * 0.80, 0.035, 0.035, 0.02, "x", 8); }
    Dg.m("dark").c(1);
    for (let i = 0; i < 10; i++) { const a = i * PI / 5; Dg.cyl(TW * 0.40, Math.cos(a) * 0.155, Math.sin(a) * 0.155, 0.015, 0.015, 0.04, "x", 6); }
    Dg.tube([TW * 0.48, 0, 0], [TW * 0.48, 0.20, 0.06], 0.012, 0.012);         // the CTIS line
    Dg.m("paint").c(0.7).cyl(-TW * 0.36, 0, 0, RIM, RIM, 0.04, "x", 18);
    return { tyreGeo: tyreGeo, rimGeos: Dg.build({ uv: 1, mud: 0 }) };
  }

  function body() {
    const HK = CBZ.hullKit;
    const tr = tractorBody(HK);
    const Sp = HK.geo(); spareInto(HK, Sp);
    const C = HK.geo();
    C.m("gear").c(0.86).box(0, 0, 0, CW - 0.03, CH - 0.03, 0.025);
    C.c(0.74).cyl(0, 0, -0.016, 0.20, 0.20, 0.012, "z", 18);
    C.c(0.95).cyl(0, 0, -0.024, 0.12, 0.14, 0.03, "z", 16);
    C.m("black").c(1).box(0, 0.21, -0.017, 0.30, 0.035, 0.005);
    const w = wheelBody(HK), ram = ramBody(HK), jack = jackBody(HK);
    // the M2 on the ring: the carriage that runs on the ring, the pintle, the gun
    const Rg = HK.geo();
    Rg.m("dark").c(1).box(0, 0.02, RING.r, 0.22, 0.08, 0.16).cyl(0, 0.13, RING.r, 0.035, 0.04, 0.20, "y", 8);
    const Gg = HK.geo(); HK.m2(Gg);
    return {
      tractor: tr, spare: Sp.build({ uv: 1, mud: 0.3 }), trailer: trailerBody(HK), mount: mountBody(HK), launcher: launcherBody(HK),
      cover: C.build({ uv: 1, mud: 0 }), ram: ram, jack: jack, mast: mastBody(HK), missile: missileBody(HK),
      tyreGeo: w.tyreGeo, rimGeos: w.rimGeos, ring: Rg.build({ uv: 2.6, mud: 0 }), m2: Gg.build({ uv: 2.6, mud: 0 }), decals: {},
    };
  }
  // the body is cached against the kit that built it: a hot-swapped kit
  // (or a hot-swapped copy of this file) rebuilds it
  let BODY = null, BODYHK = null;
  function bodyFor(HK) {
    if (!BODY || BODYHK !== HK.WheeledRig) { BODY = body(); BODYHK = HK.WheeledRig; }
    return BODY;
  }

  /* ================================================================ THE RIG */
  // shared non-scheme materials, made once per THREE
  let MISMAT = null, BURNT = null, MATTHREE = null;
  function extraMats(THREE) {
    if (MATTHREE !== THREE) {
      MATTHREE = THREE;
      MISMAT = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true });
      BURNT = new THREE.MeshLambertMaterial({ color: 0x2b2826, vertexColors: true });
    }
  }

  let RIGC = null, RIGBASE = null;
  function rigClass(HK) {
    if (RIGC && RIGBASE === HK.WheeledRig) return RIGC;
    const Base = HK.WheeledRig, BP = Base.prototype;
    const lin = HK.lin;
    const C = { flash: lin(0xffc070), white: lin(0xe9e6e0), grey: lin(0xb8b4ac), dust: lin(0xb4a68a), fire: lin(0xffb050), black: lin(0x1e1d1c) };
    function PR(o) { Base.call(this, o); }
    PR.prototype = Object.create(BP);
    PR.prototype.constructor = PR;
    const P = PR.prototype;
    P.isPatriot = true;

    P.initPatriot = function (o) {
      const THREE = window.THREE;
      Object.assign(this, o.pat);
      this.phi = 0;                 // hitch angle: trailer yaw off the tractor
      this.tPitch = 0; this.tRoll = 0;
      this.jack = 0; this.elev = 0; this.trav = 0; this.mast = 0;
      this.travWant = 0; this.inArc = false; this.lAimT = -99;
      this.stillT = 0; this.stowReq = false; this.slant = 0;
      this.loaded = []; for (let i = 0; i < 12; i++) this.loaded.push(true);
      this.left = 12;
      this.mis = []; this.cook = 0; this.cookT = 0;
      this.cloud = new HK.Fx(260, false); this.root.add(this.cloud.points);
      this._v = new THREE.Vector3(); this._w = new THREE.Vector3(); this._inv = new THREE.Matrix4();
      this._zero = new THREE.Matrix4().makeScale(0, 0, 0);
      this._c = [0, 0, 0]; this._d = [0, 0, 0];
      this.ai = null;
      this.poseLauncher();
      this.poseTrailer(0, null);
    };
    P.settle = function () {
      BP.settle.call(this);
      if (this.trailer) { this.poseTrailer(0, null); this.poseLauncher(); }
    };
    /* ---------------------------------------------- the launcher's pose */
    P.poseLauncher = function () {
      this.launcher.rotation.y = this.trav;
      this.cradle.rotation.x = this.elev + (this.slump || 0);
      // the rams: from their anchors to the lugs under the frame
      const e = this.cradle.rotation.x, ce = Math.cos(e), se = Math.sin(e);
      for (let k = 0; k < this.rams.length; k++) {
        const r = this.rams[k];
        const ay = 0.08 * ce + 2.60 * se, az = 0.08 * se - 2.60 * ce;    // the lug (0.08, -2.60) rotated by e
        const dy = ay - r.by, dz = az - r.bz, len = Math.hypot(dy, dz);
        r.g.rotation.x = Math.atan2(-dy, dz);
        r.rod.position.z = Math.max(0, len - 1.1);
      }
      // outriggers: swing out, then the jacks go down
      const sw = clamp(this.jack * 2, 0, 1), dn = clamp(this.jack * 2 - 1, 0, 1);
      for (let k = 0; k < this.jacks.length; k++) {
        const j = this.jacks[k];
        j.g.rotation.y = j.stow + (j.out - j.stow) * sw;
        j.leg.position.y = -dn * j.reach;
      }
      this.mastG.rotation.z = (1 - this.mast) * (PI / 2) * 0.98;
    };
    /* ---------------------------------------------- the trailer follows the tractor */
    P.poseTrailer = function (dt, ctx) {
      const tg = this.trailer;
      tg.position.set(0, KPY + (this.body ? this.body.position.y - this.body0 : 0), KPZ);
      tg.rotation.set(this.tPitch, this.phi, this.tRoll, "YXZ");
      // the trailer's wheels: spin, ride their springs inside the trailer
      const ws = this.twheels, m = this._m, q = this._q, e = this._e, p = this._p, s = this._s;
      for (let i = 0; i < ws.length; i++) {
        const w = ws[i];
        e.set(w.x < 0 ? -w.spin : w.spin, w.x < 0 ? PI : 0, 0, "YXZ");
        q.setFromEuler(e);
        p.set(w.x, w.y + w.off - (w.sq < 1 ? R * (1 - w.sq) : 0), w.z);
        s.set(1, w.sq, w.sq < 1 ? 1.04 : 1);
        m.compose(p, q, s);
        this.tTyre.setMatrixAt(i, m);
        s.set(1, 1, 1); m.compose(p, q, s);
        for (let k = 0; k < this.tRims.length; k++) this.tRims[k].setMatrixAt(i, m);
      }
      this.tTyre.instanceMatrix.needsUpdate = true;
      for (let k = 0; k < this.tRims.length; k++) this.tRims[k].instanceMatrix.needsUpdate = true;
    };
    P.stepTrailer = function (dt, v, w, ctx) {
      // hitch kinematics: the kingpin sits c ahead of the tractor's rear
      // tandem; the trailer's axles do not slip sideways
      const c = KPZ - RC;
      const dphi = (-v * Math.sin(this.phi) + c * w * Math.cos(this.phi)) / L2 - w;
      this.phi = clamp(this.phi + dphi * dt, -1.25, 1.25);
      // the trailer's wheels ride the ground; it pitches on the hitch, rolls on its springs
      const ground = (ctx && ctx.groundAt) || CBZ.floorAt, live = !!this.root.parent;
      const ws = this.twheels, a = this._c, cp = Math.cos(this.phi), sp = Math.sin(this.phi);
      let sum = 0, dsum = 0, lr = 0;
      for (let i = 0; i < ws.length; i++) {
        const wh = ws[i];
        wh.spin = (wh.spin + v * Math.cos(this.phi) * dt / R) % (2 * PI);
        let want = 0;
        if (ground && live) {
          // the wheel's foot in tractor space (trailer yawed about the kingpin)
          const x = KPZ, lx = wh.x * cp + wh.z * sp, lz = -wh.x * sp + wh.z * cp;
          const e = this.root.matrixWorld.elements, px = lx, pz = x + lz;
          a[0] = e[0] * px + e[8] * pz + e[12]; a[1] = e[1] * px + e[9] * pz + e[13]; a[2] = e[2] * px + e[10] * pz + e[14];
          let gy = a[1];
          try { gy = ground(a[0], a[2]); } catch (er) {}
          want = clamp(gy - a[1], -0.25, 0.30);
        }
        wh.want = want;
        sum += want; dsum += -wh.z; lr += want * (wh.x > 0 ? 1 : -1);
      }
      const n = ws.length, mean = sum / n, dmean = dsum / n;
      const pt = Math.atan2(mean, dmean), rl = clamp(lr / n / TX, -0.08, 0.08);
      this.tPitch += (pt - this.tPitch) * Math.min(1, dt * 8);
      this.tRoll += (-rl - this.tRoll) * Math.min(1, dt * 6);
      for (let i = 0; i < n; i++) {
        const wh = ws[i];
        const res = clamp(wh.want - (-wh.z) * Math.tan(this.tPitch) - (wh.x > 0 ? -1 : 1) * this.tRoll * TX, -0.12, 0.12);
        wh.off += (res - wh.off) * Math.min(1, dt * 14);
      }
      this.poseTrailer(dt, ctx);
    };
    /* ---------------------------------------------- the crew: who shows where */
    P.crew = function (u) {
      BP.crew.call(this, u);
      const on = !!this._has.commander;
      const t = u.tgt, engaged = !!(t && !t.dead && u.sees);
      let mode = "seat";
      if (on && engaged && !t.air) mode = "gun";                     // a ground fight: up on the .50
      else if (on && !engaged && this.left > 0) mode = "head";       // calm: head out of the hatch
      if (on && engaged && t.air) mode = "seat";                     // a launch: buttoned up
      if (on && !engaged && this.left <= 0) mode = "head";
      const F = this.cdr;
      F.seated.visible = on && mode === "seat";
      F.stand.visible = on && mode !== "seat";
      const want = mode === "head" ? F.standY - 0.62 : F.standY;
      F.stand.position.y += (want - F.stand.position.y) * Math.min(1, (this.dt || 0.05) * 3);
    };
    /* ---------------------------------------------- the emplacement sequence */
    P.stepLauncher = function (dt, v, u) {
      this.stillT = Math.abs(v) < 0.3 ? this.stillT + dt : 0;
      let crewOk = false;
      const seats = u.seats || [];
      for (let i = 0; i < seats.length; i++) if (seats[i].crew && (seats[i].man || seats[i].implicit)) { crewOk = true; break; }
      if (u.vs && u.vs.firepower) crewOk = false;
      let deploy = crewOk && !this.stowReq && this.stillT > 1.5;
      let k = 1;
      if (u.you && Math.abs(v) > 0.5) { deploy = false; k = 4; }   // you drove off: the crew rushes the march order
      if (deploy) {
        this.mast = toward(this.mast, 1, RATE.mast * dt);
        if (this.elev < 1e-4 && Math.abs(this.trav) < 1e-3) this.jack = toward(this.jack, 1, RATE.jack * dt);
        if (this.jack >= 1) this.elev = toward(this.elev, ELEV, RATE.elev * dt);
        if (this.elev >= ELEV - 1e-4) {
          const aiming = this.t - this.lAimT < 1.2;
          this.trav = toward(this.trav, aiming ? this.travWant : 0, RATE.trav * (aiming ? 1 : 0.4) * dt);
        }
      } else {
        this.trav = toward(this.trav, 0, RATE.trav * k * dt);
        if (Math.abs(this.trav) < 1e-3) this.elev = toward(this.elev, 0, RATE.elev * 1.3 * k * dt);
        if (this.elev < 1e-4) { this.jack = toward(this.jack, 0, RATE.jack * k * dt); this.mast = toward(this.mast, 0, RATE.mast * k * dt); }
      }
      // what the mark is: its slant range (the interceptor's real minimum)
      const t = u.tgt;
      this.slant = t && !t.dead ? Math.hypot(t.pos.x - u.pos.x, t.pos.y - u.pos.y, t.pos.z - u.pos.z) : 0;
      this.poseLauncher();
    };
    P.ready = function () {
      return this.jack >= 1 && this.elev >= ELEV - 1e-3 && this.inArc && Math.abs(wrap(this.travWant - this.trav)) < 0.05 && this.left > 0 && this.slant >= 400;
    };
    /* ---------------------------------------------- the contract hooks */
    // vehicles.js: rel is the mark's bearing off the TRACTOR's nose
    P.aimLauncher = function (rel, elevMax, dt) {
      const want = wrap(rel - this.phi - PI);
      this.inArc = Math.abs(want) <= TRAV;
      this.travWant = clamp(want, -TRAV, TRAV);
      this.lAimT = this.t;
    };
    P.canFire = function (shot) {
      if (shot && shot.kind === "sam") return this.ready();
      return true;
    };
    P.reload = function () {};
    P.nextCell = function () { for (let i = 0; i < 12; i++) if (this.loaded[i]) return i; return -1; };
    P.cellWorld = function (i, out, z) {
      const c = i % 4, r = (i / 4) | 0;
      this.cradle.updateWorldMatrix(true, false);
      return out.set(COLS[c], ROWS[r], z).applyMatrix4(this.cradle.matrixWorld);
    };
    P.muzzleWorld = function (out, shot) {
      if (shot && shot.kind === "sam") {
        const i = this.nextCell();
        return this.cellWorld(i < 0 ? 0 : i, out, -6.0);
      }
      return BP.muzzleWorld.call(this, out);
    };
    P.fire = function (shot) {
      if (!shot || shot.kind !== "sam") { this.fired(shot && shot.kind === "mg" ? 0.3 : 0.5); return; }
      const i = this.nextCell();
      if (i < 0) return;
      this.loaded[i] = false; this.left--;
      this.covers.setMatrixAt(i, this._zero); this.covers.instanceMatrix.needsUpdate = true;
      if (!this.root.parent) return;
      this.launchFx(i);
    };
    // the launch: the cover bursts, the motor lights in the cell, a white
    // cloud rolls off the launcher and along the ground
    P.launchFx = function (i) {
      const p = this.cellWorld(i, this._v, -5.9), r = Math.random;
      const e = this.cradle.matrixWorld.elements, dx = -e[8], dy = -e[9], dz = -e[10];
      const l = Math.hypot(dx, dy, dz) || 1, fx = dx / l, fy = dy / l, fz = dz / l;
      for (let k = 0; k < 7; k++) this.glow.emit(p.x + fx * k * 0.6, p.y + fy * k * 0.6, p.z + fz * k * 0.6, fx * 20, fy * 20, fz * 20, 0.18 + r() * 0.1, 1.6, 3.6, 1.0, C.flash, 0, 0);
      for (let k = 0; k < 46; k++) {
        const s = 2 + r() * 10;
        this.cloud.emit(p.x + (r() - 0.5) * 0.8, p.y + (r() - 0.5) * 0.8, p.z + (r() - 0.5) * 0.8,
          fx * s + (r() - 0.5) * 5, fy * s + (r() - 0.5) * 3, fz * s + (r() - 0.5) * 5, 3 + r() * 4, 1.2, 5 + r() * 4, 0.55, r() < 0.7 ? C.white : C.grey, -0.01, 0.9);
      }
      // the cover's pieces
      for (let k = 0; k < 8; k++) this.smoke.emit(p.x, p.y, p.z, fx * 12 + (r() - 0.5) * 6, fy * 12 + 3, fz * 12 + (r() - 0.5) * 6, 1.4, 0.10, 0.10, 1.0, C.grey, 1, 0.1);
      // the ground cloud under the launcher
      const g = this._c;
      this.trailerPoint(0, DECK, HZ - 3.0, g);
      const gy = this.root.position.y + 0.4;
      for (let k = 0; k < 26; k++) {
        const a = r() * 2 * PI, s = 3 + r() * 7;
        this.cloud.emit(g[0], gy, g[2], Math.cos(a) * s, 0.4 + r() * 0.8, Math.sin(a) * s, 4 + r() * 3, 2, 8 + r() * 4, 0.45, C.white, -0.005, 0.7);
      }
    };
    // a point in trailer (kingpin) space -> world
    P.trailerPoint = function (x, y, z, out) {
      this.trailer.updateWorldMatrix(true, false);
      const e = this.trailer.matrixWorld.elements;
      out[0] = e[0] * x + e[4] * y + e[8] * z + e[12];
      out[1] = e[1] * x + e[5] * y + e[9] * z + e[13];
      out[2] = e[2] * x + e[6] * y + e[10] * z + e[14];
      return out;
    };
    /* ---------------------------------------------- the missiles in flight
       (the runtime flies the round: u.shots carries its position; the rig
       draws the airframe on it, the motor flame and the first smoke) */
    P.stepMissiles = function (u, dt) {
      const shots = u && u.shots;
      const pool = this.mis;
      for (let k = 0; k < pool.length; k++) pool[k].seen = false;
      if (shots && shots.length) {
        for (let i = 0; i < shots.length; i++) {
          const s = shots[i];
          if (!s.w || s.w.kind !== "sam") continue;
          let m = null;
          for (let k = 0; k < pool.length; k++) if (pool[k].shot === s) { m = pool[k]; break; }
          if (!m) {
            for (let k = 0; k < pool.length; k++) if (!pool[k].shot) { m = pool[k]; break; }
            if (!m) {
              const THREE = window.THREE;
              const mesh = new THREE.Mesh(this.misGeo, MISMAT);
              mesh.name = "pac3"; mesh.castShadow = true; mesh.matrixAutoUpdate = true;
              this.root.add(mesh);
              m = { mesh: mesh, shot: null, seen: false, lx: 0, ly: 0, lz: 0 };
              pool.push(m);
            }
            m.shot = s; m.mesh.visible = true; m.lx = s.pos.x; m.ly = s.pos.y; m.lz = s.pos.z;
          }
          m.seen = true;
          this.drawMissile(m, s, dt);
        }
      }
      for (let k = 0; k < pool.length; k++) {
        const m = pool[k];
        if (m.shot && !m.seen) {
          // the round is gone: the hit-to-kill flash where it ended
          const r = Math.random;
          for (let j = 0; j < 6; j++) this.glow.emit(m.lx, m.ly, m.lz, (r() - 0.5) * 30, (r() - 0.5) * 30, (r() - 0.5) * 30, 0.25, 3, 7, 1.0, C.flash, 0, 2);
          for (let j = 0; j < 10; j++) this.cloud.emit(m.lx, m.ly, m.lz, (r() - 0.5) * 8, (r() - 0.5) * 8, (r() - 0.5) * 8, 3 + r() * 2, 2, 9, 0.5, C.grey, -0.005, 0.8);
          m.shot = null; m.mesh.visible = false;
        }
      }
    };
    P.drawMissile = function (m, s, dt) {
      const r = Math.random, mesh = m.mesh, tgt = s.tgt;
      const w = this._w.set(s.pos.x, s.pos.y, s.pos.z);
      this.root.updateWorldMatrix(true, false);
      this._inv.copy(this.root.matrixWorld).invert();
      mesh.position.copy(w).applyMatrix4(this._inv);
      // nose down the line it is flying (to the mark)
      const ty = tgt && tgt.pos ? tgt.pos.y + (tgt.aimY || 1) : s.pos.y + 1;
      const v = this._v.set(tgt && tgt.pos ? tgt.pos.x : s.pos.x + (s.pos.x - m.lx), ty, tgt && tgt.pos ? tgt.pos.z : s.pos.z + (s.pos.z - m.lz));
      mesh.lookAt(v);
      const dx = v.x - w.x, dy = v.y - w.y, dz = v.z - w.z, l = Math.hypot(dx, dy, dz) || 1;
      const bx = w.x - dx / l * 2.8, by = w.y - dy / l * 2.8, bz = w.z - dz / l * 2.8;
      this.glow.emit(bx, by, bz, -dx / l * 30, -dy / l * 30, -dz / l * 30, 0.07, 1.0, 2.2, 1.0, C.fire, 0, 0);
      if (s.t < 2.5) this.cloud.emit(bx, by, bz, (r() - 0.5) * 2, (r() - 0.5) * 2, (r() - 0.5) * 2, 2.5 + r() * 2, 0.8, 3.5, 0.45, C.white, -0.01, 0.6);
      m.lx = w.x; m.ly = w.y; m.lz = w.z;
    };
    /* ---------------------------------------------- the frame */
    P.update = function (dt, v, w, steer, u, ctx) {
      if (!(dt > 0)) return;
      BP.update.call(this, dt, v, w, steer, u, ctx);
      this.stepTrailer(dt, v, w, ctx);
      if (u) { this.stepLauncher(dt, v, u); this.stepMissiles(u, dt); }
      // the generator runs once the launcher is emplaced: a thin exhaust
      if (this.jack > 0.5 && this.root.parent && Math.random() < dt * 3) {
        const a = this.trailerPoint(0.85, 2.15, -0.80, this._c);
        this.smoke.emit(a[0], a[1], a[2], 0, 0.9, 0, 1.6, 0.15, 0.7, 0.12, C.grey, -0.02, 1.2);
      }
      this.cloud.step(dt);
    };
    P.damage = function (vs, res) {
      BP.damage.call(this, vs, res);
      // a heavy penetration through the launcher can set a motor off in its cell
      if (res && res.pen && res.dmg > 400 && this.left > 0 && Math.random() < 0.3) this.cookOne();
    };
    P.cookOne = function () {
      const i = this.nextCell();
      if (i < 0) return;
      this.loaded[i] = false; this.left--;
      this.covers.setMatrixAt(i, this._zero); this.covers.instanceMatrix.needsUpdate = true;
      if (this.root.parent) this.launchFx(i);
    };
    P.wrecked = function (dt, u) {
      if (!(dt > 0)) return;
      const first = !this.dead;
      BP.wrecked.call(this, dt, u);
      const F = this.cdr;
      F.seated.visible = false; F.stand.visible = false;
      if (first) {
        extraMats(window.THREE);
        // the frame slumps off its rams; a catastrophic kill throws it askew
        this.slump = -Math.min(this.elev, 0.25) * 0.6;
        if (this.cat) {
          this.cradle.rotation.z = 0.22; this.cradle.position.y += 0.35; this.cradle.position.x -= 0.25;
          this.launcher.rotation.y += 0.18;
          this.cook = this.left; this.cookT = 0.6;
          this.root.traverse(function (o) {
            const k = o.userData && o.userData.hkKey;
            if (k === "paint" || k === "canvas" || k === "gear" || k === "metal") o.material = BURNT;
          });
        }
        this.poseLauncher();
        for (let k = 0; k < this.mis.length; k++) { this.mis[k].shot = null; this.mis[k].mesh.visible = false; }
      }
      // the missiles left in their cells cook off, one by one
      if (this.cook > 0) {
        this.cookT -= dt;
        if (this.cookT <= 0) { this.cook--; this.cookOne(); this.cookT = 1.5 + Math.random() * 4; }
      }
      // the trailer's tyres burn too; the launcher burns where it was hit
      if (u && u.burnT > 0) {
        const a = this._d;
        a[0] = Math.sin(this.phi) * (HZ - 2.5 - 0); a[1] = KPY + 1.6; a[2] = KPZ + Math.cos(this.phi) * (HZ - 2.5);
        this.burn(dt, a, 10);
        const kk = clamp((this.burnt || 0) / 50, 0, 1);
        for (let i = 0; i < this.twheels.length; i++) this.twheels[i].sq = 1 - kk * 0.22;
        this.poseTrailer(dt, null);
      }
      this.cloud.step(dt);
    };
    RIGC = PR; RIGBASE = HK.WheeledRig;
    return PR;
  }

  /* ================================================================ BUILD */
  function build(ctx) {
    const THREE = window.THREE, HK = CBZ.hullKit;
    if (!THREE || !HK) return null;
    extraMats(THREE);
    const B = bodyFor(HK);
    const side = ctx.side || ctx.team || null, ground = ctx.ground || ctx.arena;
    const sc = HK.scheme(ctx.nation, ground, side);
    const M = HK.mats(sc);
    const root = new THREE.Group(); root.name = "patriot";
    // ---- the tractor (the sprung body)
    const bodyG = new THREE.Group(); bodyG.name = "body"; root.add(bodyG);
    HK.meshes(bodyG, B.tractor, M, "tractor");
    HK.meshes(bodyG, B.spare, M, "spare");
    // the ring mount and the M2
    const turret = new THREE.Group(); turret.name = "turret"; turret.position.set(RING.x, RING.y, RING.z); bodyG.add(turret);
    HK.meshes(turret, B.ring, M, "carriage");
    const gun = new THREE.Group(); gun.name = "gun"; gun.position.set(0, 0.26, RING.r - 0.02); turret.add(gun);
    const tube = new THREE.Group(); tube.name = "tube"; gun.add(tube);
    HK.meshes(tube, B.m2, M, "m2");
    const muzzle = new THREE.Object3D(); muzzle.name = "muzzle"; muzzle.position.set(0, 0.03, 1.46); tube.add(muzzle);
    // the crew
    const seed = (ctx.seed | 0) >>> 0;
    const fig = function (kind, k) { return HK.figMesh(kind, sc, (seed + k) % 4, M); };
    const driver = fig("seated", 0); driver.position.set(0.55, 1.95, 6.95); bodyG.add(driver);
    const cdrSeat = fig("seated", 1); cdrSeat.position.set(-0.55, 1.95, 6.95); bodyG.add(cdrSeat);
    const standY = -0.17;
    const cdrStand = fig("gunner", 2); cdrStand.position.set(0, standY, RING.r - 0.02 - 0.62); turret.add(cdrStand);
    cdrSeat.visible = false; cdrStand.visible = false;
    // the tractor's wheels: two steered axles, the tandem
    const wheels = [];
    [[A1, 1], [A2, 0.62], [A3, 0], [A4, 0]].forEach(function (a) {
      [1, -1].forEach(function (s) { wheels.push({ x: s * TX, y: R, z: a[0], r: R, steer: a[1] }); });
    });
    const WS = HK.wheelSet(root, B.tyreGeo, B.rimGeos, M, wheels.length, [-1.3, 0, A4 - R, 1.3, 2 * R, A1 + R]);
    // ---- the trailer, hinged on the kingpin
    const trailer = new THREE.Group(); trailer.name = "trailer"; trailer.rotation.order = "YXZ"; root.add(trailer);
    HK.meshes(trailer, B.trailer, M, "trailer");
    const twheels = [];
    [T1, T2].forEach(function (z) { [1, -1].forEach(function (s) { twheels.push({ x: s * TX, y: R - KPY, z: z, spin: 0, off: 0, sq: 1, want: 0 }); }); });
    // the trailer's own wheel set (its geometry shares the tractor's tyres;
    // its instances live in trailer space)
    const tTyre = new THREE.InstancedMesh(B.tyreGeo, M.rubber, 4);
    tTyre.name = "tyres:trailer"; tTyre.castShadow = true; tTyre.receiveShadow = true; tTyre.userData.hkKey = "rubber";
    tTyre.frustumCulled = false; trailer.add(tTyre);
    const tRims = Object.keys(B.rimGeos).map(function (k) {
      const im = new THREE.InstancedMesh(B.rimGeos[k], M[k], 4);
      im.name = "rims:trailer:" + k; im.castShadow = true; im.receiveShadow = true; im.userData.hkKey = k; im.frustumCulled = false;
      trailer.add(im);
      return im;
    });
    // the data link mast on the gooseneck
    const mastG = new THREE.Group(); mastG.name = "mast"; mastG.position.set(1.05, 1.62, 0.70); trailer.add(mastG);
    HK.meshes(mastG, B.mast, M, "mast");
    // the outriggers
    const jacks = JACKS.map(function (j) {
      const g = new THREE.Group(); g.position.set(j[0] * 1.10, DECK - 0.30, j[1]); trailer.add(g);
      HK.meshes(g, B.jack.arm, M, "outrigger");
      const leg = new THREE.Group(); leg.position.set(0, 0, 1.12); g.add(leg);
      HK.meshes(leg, B.jack.leg, M, "jack");
      // stowed: folded along the deck (front pair back, rear pair forward); out: square to the side
      const front = j[1] > -5;
      return { g: g, leg: leg, stow: front ? j[0] * PI : 0, out: j[0] * PI / 2, reach: KPY + DECK - 0.30 - 0.6 - 0.03 };
    });
    jacks.forEach(function (j) { j.g.rotation.y = j.stow; });
    // ---- the launcher: turntable (traverse), the hinged frame (elevation)
    const launcher = new THREE.Group(); launcher.name = "launcher"; launcher.position.set(0, HY, HZ); trailer.add(launcher);
    HK.meshes(launcher, B.mount, M, "mount");
    const cradle = new THREE.Group(); cradle.name = "cradle"; launcher.add(cradle);
    HK.meshes(cradle, B.launcher, M, "canisters");
    const covers = new THREE.InstancedMesh(B.cover.gear, M.gear, 12);
    covers.name = "covers"; covers.userData.hkKey = "gear"; covers.castShadow = false; covers.receiveShadow = true;
    {
      const m = new THREE.Matrix4();
      for (let i = 0; i < 12; i++) covers.setMatrixAt(i, m.makeTranslation(COLS[i % 4], ROWS[(i / 4) | 0], -5.875));
      covers.instanceMatrix.needsUpdate = true;
      covers.frustumCulled = false;
    }
    cradle.add(covers);
    // the black stencil ring on each cover rides the cover (its own mesh would double the draws: folded into gear)
    if (B.cover.black) {
      const cb = new THREE.InstancedMesh(B.cover.black, M.black, 12);
      cb.name = "covers:stencil"; cb.userData.hkKey = "black"; cb.frustumCulled = false;
      cb.instanceMatrix = covers.instanceMatrix;
      cradle.add(cb);
    }
    // the erecting rams
    const rams = [-1, 1].map(function (s) {
      const g = new THREE.Group(); g.position.set(s * 0.70, DECK - HY + 0.40, -1.20); launcher.add(g);
      HK.meshes(g, B.ram.barrel, M, "ram");
      const rod = new THREE.Group(); g.add(rod);
      HK.meshes(rod, B.ram.rod, M, "rod");
      return { g: g, rod: rod, by: DECK - HY + 0.40, bz: -1.20 };
    });
    const Rig = rigClass(HK);
    const rig = new Rig({
      root: root, body: bodyG, wheels: wheels, tyreIM: WS.tyreIM, rimIMs: WS.rimIMs, wheelbase: (A1 + A2) / 2 - RC, track: 2 * TX,
      travel: [0.14, 0.14], turret: turret, gun: gun, tube: tube, muzzle: muzzle,
      tcfg: { rate: 1.2, elevRate: 1.0, elevMin: -0.25, elevMax: 1.2 },
      figs: { driver: driver },
      exhaust: { p: [0.98, 3.18, 5.24], d: [0, 0.7, -0.3], soot: 0.8 },
      engine: [0, 1.9, 5.4], cabin: [0, 2.1, 6.9], ground: ground, side: side, seed: seed,
      pitchK: 0.008, rollK: 0.006,
      decal: { parent: bodyG, cache: B.decals, list: [[1.217, 1.62, 6.92, 1, 0, 0.42], [-1.217, 1.62, 6.92, -1, 0, 0.42]] },
    });
    rig.initPatriot({ pat: {
      trailer: trailer, twheels: twheels, tTyre: tTyre, tRims: tRims, launcher: launcher, cradle: cradle, covers: covers,
      rams: rams, jacks: jacks, mastG: mastG, misGeo: B.missile.lamp, cdr: { seated: cdrSeat, stand: cdrStand, standY: standY },
    } });
    rig.mark(ctx.nation, ground, side);
    return { group: root, rig: rig, footW: Wd, footL: L, height: H };
  }

  /* ================================================================ THE SITE
     A launcher keeps its own site (see TACTICS in the header). Called every
     animate, before the rig's frame; writes only veh.target. */
  function site(veh, dt, rig, c) {
    if (veh.you || veh.fled || (veh.vs && (veh.vs.firepower))) { rig.stowReq = false; return; }
    const p = veh.pos;
    let A = rig.ai;
    if (!A) {
      A = rig.ai = { mode: "site", t: 0, sx: p.x, sz: p.z, tx: 0, tz: 0, gx: 0, gz: 0, armed: false };
      if (!c || !(c.t > 3)) {
        // THE BATTLE OPENS WITH THE BATTERY ALREADY IN POSITION: its tail to
        // the threat (it fires over the rear), outriggers down, launcher up.
        // The army formed it facing the enemy; the crew emplaced it the other
        // way round before the first aircraft came.
        veh.h = wrap(veh.h + PI);
        if (veh.ds) { veh.ds.v = 0; veh.ds.w = 0; }
        if (veh.group) veh.group.rotation.y = veh.h;
        rig.jack = 1; rig.elev = ELEV; rig.mast = 1; rig.stillT = 9;
        rig.poseLauncher();
      } else A.mode = "turn";
    }
    A.t += dt;
    const mobile = !(veh.vs && veh.vs.mobility);
    const t = veh.tgt;
    const near = t && !t.dead && !t.air && !t.fled && Math.hypot(t.pos.x - p.x, t.pos.z - p.z) < DISPLACE;
    const moving = Math.abs(veh.ds ? veh.ds.v : 0) > 0.4;
    if (A.mode === "turn") {
      // came in on the march (a reinforcement): tail to the threat first
      if (!A.armed) { A.armed = true; A.away = wrap(veh.h + PI); A.x0 = p.x; A.z0 = p.z; A.gx = p.x + Math.sin(A.away) * 160; A.gz = p.z + Math.cos(A.away) * 160; }
      const moved = Math.hypot(p.x - A.x0, p.z - A.z0);
      if (!mobile || (Math.abs(wrap(veh.h - A.away)) < 0.3 && moved > 18) || A.t > 45) A.mode = "site";
    } else if (A.mode === "site") {
      if (near && mobile) { A.mode = "displace"; A.t = 0; A.armed = false; A.tx = t.pos.x; A.tz = t.pos.z; }
    }
    let gx, gz;
    if (A.mode === "site") {
      // the site is where it comes to rest: no circling back to a mark
      if (moving) { A.sx = p.x; A.sz = p.z; }
      gx = A.sx; gz = A.sz;
    } else if (A.mode === "turn") { gx = A.gx; gz = A.gz; }
    else {
      if (rig.jack > 0) { gx = p.x; gz = p.z; }                     // march order first
      else {
        if (!A.armed) {
          A.armed = true; A.t = 0;
          const dx = p.x - A.tx, dz = p.z - A.tz, d = Math.hypot(dx, dz) || 1;
          A.gx = p.x + dx / d * 300; A.gz = p.z + dz / d * 300;
        }
        gx = A.gx; gz = A.gz;
        if (Math.hypot(p.x - gx, p.z - gz) < 15 || A.t > 40 || !mobile) { A.mode = "site"; A.sx = p.x; A.sz = p.z; gx = p.x; gz = p.z; }
      }
    }
    rig.stowReq = A.mode !== "site";
    if (veh.target && veh.target.set) veh.target.set(gx, 0, gz);
    veh.slot = A.mode === "site" ? (veh.tgt && veh.sees ? "fire" : "hold") : "push";
  }

  CBZ.unitKit.register("patriot_launcher", {
    kind: "vehicle",
    domain: "ground",
    drive: "wheeled",
    stats: { hp: 260, mass: 37500, speed: 18, reverse: 3, accel: 0.9, turn: 0.40, wheelbase: 4.8, maxSteer: 0.36, grip: 0.45,
      length: L, width: Wd, height: H,
      armour: { front: 10, side: 4, rear: 2, top: 2 }, standoff: 2500 },
    // the ring mount (the .50's traverse); the launcher's own numbers below
    turret: { rate: 1.2, elevRate: 1.0, elevMin: -0.25, elevMax: 1.2 },
    launcher: { rate: RATE.trav, elevRate: RATE.elev, elevMin: 0, elevMax: ELEV, traverse: TRAV, jacks: 1 / RATE.jack },
    crew: [{ seat: "driver", pos: [0.55, 2.35, 6.95] }, { seat: "commander", pos: [-0.55, 2.35, 6.95] }],
    passengers: 0,
    weapons: [
      // PAC-3 MSE: hit-to-kill, a two-round ripple, no reload in battle
      { id: "pac3_mse", seat: "commander", kind: "sam", vs: "air", mount: "free", rof: 0.5, burst: 2, pause: 5,
        pen: 300, beh: 2400, speed: 1600, range: 35000, minRange: 0, ammo: 12, he: { blast: 3, power: 0.6 } },
      // M2HB .50 on the cab's ring: the ring mount's own ballistics row
      { id: "m2_50cal_ring", seat: "commander", kind: "mg", wid: "lmg", turret: true, rof: 8, burst: 7, pause: 1.6, dmg: 38, pen: 24, range: 1800, ammo: 600 },
    ],
    tactics: {
      role: "air-defence",
      engage: { air: 35000, soft: 1800, armour: 0, minSlant: 400 },
      priorities: ["helicopter", "jet", "drone", "men"],
      emplace: { jacks: 4, erect: ELEV / RATE.elev, fixedElev: ELEV, traverse: TRAV, firesOver: "rear" },
      keepFrom: { men: DISPLACE, armour: 2500 },
      displaceAt: DISPLACE, displaceBy: 300,
      hullDown: false, faceThreat: "rear", reverseOut: false, lead: false, holdsSite: true,
      screen: { need: "men", ahead: 0 },
      withdrawAt: 0.4,
    },
    // a player at the controls: the interceptor for aircraft, the .50 for the rest
    moves: function (veh, tgt) { return tgt && tgt.air ? "pac3_mse" : "m2_50cal_ring"; },
    animate: function (veh, dt, c) {
      const r = veh && veh.rig;
      if (!r || !r.isPatriot) { if (CBZ.hullKit) CBZ.hullKit.animate(veh, dt, c); else if (c && c.shared) c.shared(dt); return; }
      if (c && c.dead) { r.wrecked(dt, veh); return; }
      site(veh, dt, r, c);
      r.update(dt, c ? c.speed : 0, c ? c.yawRate : 0, c ? c.steer : 0, veh, c);
    },
    build: build,
  });
})();
