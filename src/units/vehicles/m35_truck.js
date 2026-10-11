/* ============================================================
   units/vehicles/m35_truck.js — M35A2 2½-ton 6x6 cargo truck, "deuce and a
   half", with the M36 ring mount and an M2 .50 over the cab (USA; fielded
   by any nation's army here).

   REDRAWN FROM SCRATCH (2026-10-11). What was here: city/mil_armor.js's
   generic 6x6 "TRUCK" (a hull with a canvas box). What is here, from the
   vehicle's own numbers:

   THE BODY  6.71 m long, 2.44 m wide, 2.84 m over the soft-top cab, 3.10 m
             over the bows. 3.91 m wheelbase to the centre of the tandem,
             1.22 m between the rear axles, 1.72 m track; 9.00-20 cross-country
             tyres (1.03 m) on 20 in. Budd disc wheels, DUAL on both rear
             axles. Ladder frame on its two C-rails; solid Rockwell axles on
             leaf springs, the rear bogie's inverted springs on their trunnion,
             the three differentials. The narrow flat-topped hood with louvred
             sides, the grille behind its bar guard, headlamps in their guard
             loops, flat fenders, the air cleaner on the right cowl, the
             vertical exhaust stack behind the cab (the multifuel engine puts
             out black smoke when it pulls). The open cab under a canvas soft
             top: fold-down two-pane windscreen, canvas door curtains with
             vinyl windows, the big mirrors, steps, battery box, fuel tank.
   THE BED   3.7 m x 2.24 m steel cargo body with ribbed sides and stake
             pockets, the troop benches, the headboard, the tailgate on its
             chains; five bows under an olive canvas cover that sags between
             them, rear flap rolled up. Sixteen riflemen ride on the benches,
             facing in, rifles up; each one is drawn while he is aboard. The
             tailgate drops when they get out.
   M36 RING  over the commander's seat on three posts: the M2 rides the ring.
             The commander sits in the cab to ride and stands up in the ring
             to fight.
   PAINT     the side's nation and ground (units/kit/hull.js), canvas to match,
             the nation's flag on the doors and the bed sides.
   DRIVE     5,900 kg empty, 134 hp: 0-48 km/h in ~14 s, 90 km/h flat out,
             11 m turning radius, ~0.6 g of grip. Every wheel rides its own
             spring over the ground; the body squats, dives and rolls.
   ARMOUR    none: sheet steel and canvas (the windscreen frame and engine
             block stop a little from the front). Rifle fire goes through.
   WEAPON    M2HB .50 on the ring, 600 rounds aboard.

   TACTICS (src/battle/vehicles.js reads standoff and dismountAt; the rest
   is the interface the AI agent reads): a truck, not a fighting vehicle.
   It puts its sixteen men out at 520 m, out of rifle range, then stays back
   at ~420 m behind them with the .50 for support. It never leads.

   Units: metres, m/s, kg, mm RHA. Nose +Z, +X is the vehicle's left.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.unitKit) return;
  const PI = Math.PI;

  const L = 6.71, Wd = 2.44, H = 3.10;
  const AXF = 2.28, AXM = -1.015, AXR = -2.235, R = 0.515, TW = 0.26, RIM = 0.255;
  const TRF = 0.86, TRD = 0.86, DUAL = 0.145;          // front track half, dual-centre half, dual spacing half
  const BED = { z0: 0.32, z1: -3.35, y: 1.32, w: 1.12, side: 1.80 };
  const RING = { x: -0.42, y: 2.92, z: 1.08, r: 0.56 };
  const ARCH = [[1.13, 1.80], [1.13, 2.45], [1.06, 2.74], [0.88, 2.94], [0.60, 3.05], [0.22, 3.10]];

  function arch(k) {          // the canvas arch, full width, k slightly inflates it
    const a = ARCH.map(function (p) { return [p[0] * k, 1.80 + (p[1] - 1.80) * k]; });
    const out = a.slice();
    for (let i = a.length - 1; i >= 0; i--) out.push([-a[i][0], a[i][1]]);
    return out;
  }

  function body() {
    const HK = CBZ.hullKit, G = HK.geo();
    // ---------------------------------------------------------- frame + running gear
    G.m("paint").c(0.62);
    [-1, 1].forEach(function (s) {
      G.box(s * 0.44, 0.94, -0.05, 0.08, 0.24, 6.50);                                         // C-channel rails
      G.box(s * 0.405, 0.94, -0.05, 0.01, 0.20, 6.50);
    });
    [3.05, 1.55, 0.2, -1.6, -3.2].forEach(function (z) { G.box(0, 0.92, z, 0.80, 0.14, 0.10); });   // crossmembers
    G.m("metal").c(0.9);
    [AXF, AXM, AXR].forEach(function (z, k) {
      G.cyl(0, R, z, 0.075, 0.075, 1.62, "x", 10);                                            // axle tube
      G.sphere(0, R, z + (k ? 0 : 0.0), 0.22, 9, 1.0, 0.95, 0.9);                             // the pumpkin
      [-1, 1].forEach(function (s) { G.cyl(s * 0.70, R, z, 0.13, 0.13, 0.16, "x", 12); });    // brake drums
    });
    // front leaf springs
    [-1, 1].forEach(function (s) {
      for (let i = 0; i < 6; i++) {
        const l = 1.30 - i * 0.15;
        G.box(s * 0.44, R + 0.12 + i * 0.022, AXF, 0.07, 0.02, l, 0.0, 0, 0);
      }
      G.box(s * 0.44, R + 0.09, AXF, 0.10, 0.08, 0.16);                                       // U-bolts and pad
    });
    // the rear bogie: inverted springs on the trunnion, torque rods
    const ZT = (AXM + AXR) / 2;
    [-1, 1].forEach(function (s) {
      G.cyl(s * 0.44, 0.86, ZT, 0.09, 0.09, 0.24, "x", 10);                                   // trunnion
      for (let i = 0; i < 6; i++) {
        const l = 1.34 - i * 0.16;
        G.box(s * 0.44, 0.80 - i * 0.022, ZT, 0.07, 0.02, l);
      }
      G.box(s * 0.30, R + 0.12, ZT, 0.05, 0.05, 1.20, 0, 0, 0);                               // torque rods
    });
    G.cyl(0, 0.68, 0.6, 0.045, 0.045, 3.1, "z", 6, 0.08, 0, 0);                               // propeller shafts
    G.box(0, 0.78, -0.6, 0.36, 0.26, 0.45);                                                   // transfer case
    G.cyl(0, 0.60, ZT, 0.04, 0.04, 1.2, "z", 6);
    // ---------------------------------------------------------- the front end
    G.m("paint").c(1);
    // front bumper (heavy channel), shackles, lifting rings
    G.box(0, 0.86, 3.27, 2.30, 0.24, 0.16);
    G.m("dark").c(1);
    [-1, 1].forEach(function (s) {
      G.box(s * 0.62, 0.86, 3.37, 0.10, 0.06, 0.08);
      G.cyl(s * 0.62, 0.86, 3.41, 0.05, 0.05, 0.03, "x", 10);
    });
    // HOOD: narrow, flat-topped, louvred sides, rounded top edges
    G.m("paint").c(1);
    const hood = function (top, w) { return [[-w, 1.06], [w, 1.06], [w, top - 0.05], [w - 0.05, top], [-w + 0.05, top], [-w, top - 0.05]]; };
    G.sect([[1.64, hood(1.79, 0.49)], [3.10, hood(1.71, 0.47)]]);
    G.box(0, 1.79, 2.35, 0.012, 0.012, 1.40);                                                 // centre hinge
    G.m("black").c(1);
    [-1, 1].forEach(function (s) {
      for (let i = 0; i < 7; i++) G.box(s * 0.485, 1.52, 2.05 + i * 0.12, 0.012, 0.16, 0.035, 0, 0, s * 0.25);   // louvres
    });
    // grille behind the bar guard
    G.box(0, 1.38, 3.115, 0.88, 0.60, 0.02);
    G.m("paint").c(0.9);
    for (let i = 0; i < 11; i++) G.box(-0.40 + i * 0.08, 1.38, 3.125, 0.025, 0.58, 0.03);
    G.m("dark").c(1);
    // the brush guard: vertical bars between two rails, loops round the lamps
    G.box(0, 1.72, 3.22, 1.30, 0.04, 0.04); G.box(0, 1.10, 3.22, 1.30, 0.04, 0.04);
    for (let i = 0; i < 9; i++) G.cyl(-0.44 + i * 0.11, 1.41, 3.22, 0.012, 0.012, 0.62, "y", 6);
    [-1, 1].forEach(function (s) {
      G.tube([s * 0.50, 1.72, 3.22], [s * 0.78, 1.55, 3.20], 0.018, 0.018);
      G.tube([s * 0.78, 1.55, 3.20], [s * 0.78, 1.08, 3.20], 0.018, 0.018);
      G.tube([s * 0.78, 1.08, 3.20], [s * 0.50, 1.10, 3.22], 0.018, 0.018);
      // headlamp on its bracket
      G.m("paint").c(0.9).cyl(s * 0.64, 1.30, 3.14, 0.10, 0.10, 0.10, "z", 14);
      G.m("lamp").c(1).cyl(s * 0.64, 1.30, 3.195, 0.082, 0.082, 0.01, "z", 14);
      G.m("dark").c(1);
    });
    G.m("amber").c(1).box(0.64, 1.47, 3.13, 0.08, 0.05, 0.03).box(-0.64, 1.47, 3.13, 0.08, 0.05, 0.03);
    G.m("lamp").c(0.6).box(0.95, 1.40, 3.06, 0.08, 0.05, 0.04);                                // blackout drive light
    // FENDERS: flat plates over the front wheels, sloping down at the front
    G.m("paint").c(1);
    [-1, 1].forEach(function (s) {
      const sec = function (y) { return [[s * 0.47, y - 0.05], [s * 1.17, y - 0.05], [s * 1.17, y], [s * 0.47, y]]; };
      G.sect([[1.58, sec(1.36)], [2.92, sec(1.36)], [3.14, sec(1.06)]]);
      G.box(s * 1.165, 1.27, 2.25, 0.03, 0.14, 1.34);                                         // outer lip
      G.save().m("black").c(1).box(s * 0.82, 1.30, 2.25, 0.66, 0.02, 1.30).restore();         // underside
      // splash panel between fender and cab
      G.box(s * 0.82, 1.18, 1.62, 0.70, 0.36, 0.04);
    });
    // AIR CLEANER on the right cowl, its pipe into the hood
    G.cyl(-0.80, 2.05, 1.80, 0.17, 0.17, 0.55, "y", 16);
    G.cyl(-0.80, 2.36, 1.80, 0.19, 0.19, 0.06, "y", 16);
    G.cyl(-0.80, 2.44, 1.80, 0.07, 0.09, 0.12, "y", 10);
    G.tube([-0.80, 1.85, 1.80], [-0.46, 1.70, 1.90], 0.06, 0.06);
    // ---------------------------------------------------------- the cab
    // the steel lower cab (the doors are cut down to the belt; canvas above)
    G.sect([[1.66, [[-1.02, 1.06], [1.02, 1.06], [1.03, 1.90], [-1.03, 1.90]]], [0.56, [[-1.02, 1.06], [1.02, 1.06], [1.03, 1.90], [-1.03, 1.90]]]]);
    G.box(0, 1.90, 1.62, 2.08, 0.04, 0.10);                                                   // cowl lip
    // door seams, handles, hinges
    G.m("black").c(1);
    [-1, 1].forEach(function (s) {
      G.box(s * 1.033, 1.48, 1.55, 0.012, 0.80, 0.015); G.box(s * 1.033, 1.48, 0.66, 0.012, 0.80, 0.015);
      G.box(s * 1.033, 1.09, 1.10, 0.012, 0.015, 0.90);
      G.box(s * 1.045, 1.70, 0.80, 0.03, 0.04, 0.14);
      [1.25, 1.75].forEach(function (y) { G.box(s * 1.04, y, 1.56, 0.03, 0.10, 0.05); });
    });
    // steps, battery box (left), fuel tank (right)
    G.m("paint").c(0.85);
    [-1, 1].forEach(function (s) { G.box(s * 0.92, 0.80, 1.10, 0.36, 0.03, 0.70); });
    G.box(0.78, 0.98, 1.10, 0.34, 0.34, 0.80);
    G.box(-0.78, 0.98, 1.05, 0.34, 0.36, 0.95);
    G.m("dark").c(1).cyl(-0.78, 1.18, 1.25, 0.05, 0.05, 0.04, "y", 10);
    // windscreen: the frame (paint), two panes, wipers, clamp knobs
    G.m("paint").c(1);
    const rake = -0.12;
    G.save().tf(0, 1.90, 1.64, rake, 0, 0);
    G.box(0, 0.04, 0, 2.06, 0.08, 0.05); G.box(0, 0.62, 0, 2.06, 0.06, 0.05);
    [-1, 0, 1].forEach(function (s) { G.box(s * 1.0, 0.33, 0, s ? 0.06 : 0.05, 0.62, 0.05); });
    G.m("glass").c(1);
    [-1, 1].forEach(function (s) { G.box(s * 0.50, 0.33, 0.005, 0.92, 0.52, 0.015); });
    G.m("black").c(1);
    [-1, 1].forEach(function (s) { G.box(s * 0.50, 0.58, 0.03, 0.30, 0.015, 0.015, 0, 0, s * 0.3); });
    G.restore();
    // the canvas soft top: roof, rear curtain, side curtains with vinyl windows
    G.m("canvas").c(1);
    G.sect([[1.60, [[-1.05, 2.50], [1.05, 2.50], [1.05, 2.55], [0.6, 2.60], [-0.6, 2.60], [-1.05, 2.55]]],
      [0.55, [[-1.05, 2.50], [1.05, 2.50], [1.05, 2.55], [0.6, 2.60], [-0.6, 2.60], [-1.05, 2.55]]]]);
    G.box(0, 2.20, 0.57, 2.06, 0.62, 0.03);
    [-1, 1].forEach(function (s) {
      G.box(s * 1.035, 2.20, 1.08, 0.02, 0.62, 0.98);
      G.save().m("glass").c(1).box(s * 1.047, 2.24, 1.10, 0.01, 0.34, 0.62).restore();
    });
    G.save().m("glass").c(1).box(0, 2.25, 0.555, 0.60, 0.22, 0.01).restore();
    // the cab's back wall (steel), mirrors on their arms
    G.m("paint").c(1).box(0, 1.48, 0.545, 2.06, 0.84, 0.04);
    G.m("dark").c(1);
    [-1, 1].forEach(function (s) {
      G.tube([s * 1.02, 2.10, 1.62], [s * 1.26, 2.18, 1.62], 0.015, 0.015);
      G.tube([s * 1.02, 1.75, 1.62], [s * 1.26, 2.00, 1.62], 0.015, 0.015);
      G.box(s * 1.27, 2.18, 1.62, 0.04, 0.34, 0.20);
    });
    // EXHAUST STACK behind the cab on the right, heat shield, rain cap
    G.m("black").c(1);
    G.cyl(-0.98, 1.90, 0.42, 0.05, 0.05, 1.70, "y", 10);
    G.tube([-0.98, 2.75, 0.42], [-0.98, 2.84, 0.32], 0.05, 0.05);
    G.m("dark").c(1).cyl(-0.98, 2.05, 0.42, 0.085, 0.085, 0.70, "y", 12, 0, 0, 0, { open: true });
    // M36 ring mount: three posts, the ring
    G.m("paint").c(0.9);
    G.tube([RING.x, 1.90, 1.62], [RING.x, RING.y, 1.62], 0.04, 0.04);
    G.tube([RING.x + 0.42, 1.90, 0.56], [RING.x + 0.30, RING.y, 0.62], 0.04, 0.04);
    G.tube([RING.x - 0.48, 1.90, 0.56], [RING.x - 0.36, RING.y, 0.62], 0.04, 0.04);
    for (let i = 0; i < 24; i++) {
      const a0 = i * PI / 12, a1 = (i + 1) * PI / 12;
      G.tube([RING.x + Math.sin(a0) * RING.r, RING.y, RING.z + Math.cos(a0) * RING.r], [RING.x + Math.sin(a1) * RING.r, RING.y, RING.z + Math.cos(a1) * RING.r], 0.035, 0.035, 6);
    }
    // ---------------------------------------------------------- the cargo bed
    G.m("paint").c(1);
    G.box(0, BED.y - 0.04, (BED.z0 + BED.z1) / 2, BED.w * 2, 0.08, BED.z0 - BED.z1);           // floor
    [-1, 1].forEach(function (s) { G.box(s * 0.44, 1.14, (BED.z0 + BED.z1) / 2, 0.10, 0.20, BED.z0 - BED.z1); });   // long sills
    for (let z = BED.z0 - 0.2; z > BED.z1; z -= 0.46) G.box(0, 1.20, z, 2.20, 0.08, 0.07);     // cross sills
    // sides: ribbed steel, stake pockets, the troop benches inside
    [-1, 1].forEach(function (s) {
      const x = s * (BED.w - 0.015), zc = (BED.z0 + BED.z1) / 2, len = BED.z0 - BED.z1;
      G.box(x, (BED.y + BED.side) / 2, zc, 0.03, BED.side - BED.y, len);
      G.c(0.9);
      [1.42, 1.58, 1.74].forEach(function (y) { G.box(x + s * 0.02, y, zc, 0.02, 0.04, len); });
      for (let z = BED.z0 - 0.15; z > BED.z1; z -= 0.62) G.box(x + s * 0.03, 1.56, z, 0.04, 0.48, 0.07);
      G.c(1);
      // troop bench: seat planks on legs, the slatted back
      G.save().m("gear").c(0.95);
      G.box(s * 0.93, 1.76, zc - 0.05, 0.36, 0.04, len - 0.3);
      for (let z = BED.z0 - 0.4; z > BED.z1 + 0.2; z -= 0.9) G.box(s * 0.80, 1.54, z, 0.04, 0.42, 0.04);
      G.box(s * 1.08, 1.98, zc - 0.05, 0.03, 0.10, len - 0.3); G.box(s * 1.08, 2.20, zc - 0.05, 0.03, 0.10, len - 0.3);
      G.restore();
      // mud flaps behind the tandem
      G.save().m("black").c(1).box(s * 0.86, 0.72, AXR - 0.62, 0.50, 0.55, 0.02).restore();
    });
    // headboard with its slats; the cab protector
    G.box(0, 1.74, BED.z0 - 0.02, BED.w * 2, 0.84, 0.04);
    G.c(0.85);
    for (let i = 0; i < 6; i++) G.box(-0.95 + i * 0.38, 1.74, BED.z0 + 0.005, 0.05, 0.84, 0.02);
    G.c(1);
    // rear: bumperettes, tail lamps, pintle hook, lifting shackles
    [-1, 1].forEach(function (s) {
      G.box(s * 0.90, 1.04, BED.z1 - 0.03, 0.40, 0.18, 0.14);
      G.save().m("tail").c(1).box(s * 0.98, 1.16, BED.z1 - 0.10, 0.12, 0.08, 0.03).restore();
      G.save().m("amber").c(1).box(s * 0.84, 1.16, BED.z1 - 0.10, 0.08, 0.06, 0.03).restore();
      G.save().m("dark").c(1).cyl(s * 0.62, 1.00, BED.z1 - 0.12, 0.045, 0.045, 0.04, "x", 8).restore();
    });
    G.save().m("dark").c(1).box(0, 0.92, BED.z1 - 0.05, 0.18, 0.14, 0.18).cyl(0, 0.92, BED.z1 - 0.18, 0.06, 0.06, 0.04, "y", 10).restore();
    // the bows inside the cover (seen from the open tail)
    G.m("dark").c(1);
    // (on the canvas rows where it does not sag: the cover hangs FROM them)
    for (let k = 0; k < 5; k++) {
      const z = BED.z0 - 0.06 - k * (BED.z0 - BED.z1 - 0.04) / 4 + (k === 4 ? 0.06 : 0), A = arch(0.985);
      for (let i = 0; i < A.length - 1; i++) G.tube([A[i][0], A[i][1], z], [A[i + 1][0], A[i + 1][1], z], 0.02, 0.02, 5);
    }
    const geos = G.build({ uv: 2.6, mud: 1.1 });

    // ---------------------------------------------------------- the canvas cover
    // a sheet over the bows, sagging between them, open at the tail; the
    // front end closed. Two-sided: the inside is seen through the tail.
    const C = HK.geo(); C.m("canvas").c(1);
    const rows = [], A = arch(1.0), nz = 17;
    for (let j = 0; j < nz; j++) {
      const z = BED.z0 - 0.02 - j * (BED.z0 - BED.z1 - 0.04) / (nz - 1);
      const ph = (j % 4) / 4, sag = Math.sin(ph * PI) * 0.035;
      rows.push(A.map(function (p) {
        const roof = Math.max(0, (p[1] - 2.4) / 0.7);
        return [p[0] * (1 - sag * 0.4 * (1 - roof)), p[1] - sag * roof, z];
      }));
    }
    C.grid(rows, true, [0.62, 0.62, 0.62]);
    // front end panel (fan from the bottom centre)
    const zf = BED.z0 - 0.02;
    for (let i = 0; i < A.length - 1; i++) C.tri(null, [0, 1.80, zf], [A[i][0], A[i][1], zf], [A[i + 1][0], A[i + 1][1], zf], [0, 0, 1]);
    for (let i = 0; i < A.length - 1; i++) C.tri(null, [0, 1.80, zf - 0.01], [A[i + 1][0], A[i + 1][1], zf - 0.01], [A[i][0], A[i][1], zf - 0.01], [0, 0, -1]);
    // the rear flap rolled up under the crown, its tie straps
    C.cyl(0, 2.92, BED.z1 + 0.05, 0.09, 0.09, 1.50, "x", 12);
    C.m("black").c(1);
    [-0.5, 0.5].forEach(function (x) { C.box(x, 2.96, BED.z1 + 0.05, 0.04, 0.24, 0.20); });
    const cGeos = C.build({ uv: 1.6, mud: 0 });

    // ---------------------------------------------------------- tailgate
    const Tg = HK.geo(); Tg.m("paint").c(1);
    Tg.box(0, 0.24, 0, BED.w * 2 - 0.06, 0.48, 0.04);
    Tg.c(0.9);
    [0.10, 0.26, 0.42].forEach(function (y) { Tg.box(0, y, -0.025, BED.w * 2 - 0.10, 0.04, 0.02); });
    Tg.m("dark").c(1);
    [-1, 1].forEach(function (s) { Tg.box(s * 1.0, 0.44, -0.03, 0.08, 0.06, 0.04); });
    const tgGeos = Tg.build({ uv: 2.6, mud: 0.5 });

    // ---------------------------------------------------------- the M2 on the ring
    const Rg = HK.geo();
    Rg.m("dark").c(1);
    // the carriage that runs on the ring, the pintle
    Rg.box(0, 0.02, RING.r, 0.22, 0.08, 0.16);
    Rg.cyl(0, 0.13, RING.r, 0.035, 0.04, 0.20, "y", 8);
    const rGeos = Rg.build({ uv: 2.6, mud: 0 });
    const Gg = HK.geo(); HK.m2(Gg);
    const gGeos = Gg.build({ uv: 2.6, mud: 0 });

    // ---------------------------------------------------------- wheels
    const Wg = HK.geo();
    HK.tyre(Wg, R, TW, RIM, { lug: "xtr", lugs: 18, dep: 0.03 });
    const tyreGeo = Wg.build({ uv: 1, mud: 0 }).rubber;
    // the Budd disc wheel: dished disc, ten nuts, hub, hand holes
    const Dg = HK.geo();
    Dg.m("paint").c(0.85);
    Dg.cyl(TW * 0.30, 0, 0, RIM, RIM, 0.06, "x", 20);
    Dg.cyl(TW * 0.36, 0, 0, RIM * 0.60, RIM * 0.72, 0.06, "x", 18);
    Dg.cyl(TW * 0.42, 0, 0, 0.11, 0.12, 0.08, "x", 14);
    Dg.m("black").c(1);
    for (let i = 0; i < 5; i++) { const a = i * 2 * PI / 5 + 0.3; Dg.box(TW * 0.335, Math.cos(a) * RIM * 0.80, Math.sin(a) * RIM * 0.80, 0.02, 0.06, 0.09, a); }
    Dg.m("dark").c(1);
    for (let i = 0; i < 10; i++) { const a = i * PI / 5; Dg.cyl(TW * 0.40, Math.cos(a) * 0.14, Math.sin(a) * 0.14, 0.014, 0.014, 0.04, "x", 6); }
    Dg.m("paint").c(0.7).cyl(-TW * 0.36, 0, 0, RIM, RIM, 0.04, "x", 16);
    const rimGeos = Dg.build({ uv: 1, mud: 0 });

    return { geos: geos, cGeos: cGeos, tgGeos: tgGeos, rGeos: rGeos, gGeos: gGeos, tyreGeo: tyreGeo, rimGeos: rimGeos, decals: {} };
  }

  function build(ctx) {
    const THREE = window.THREE, HK = CBZ.hullKit;
    if (!THREE || !HK) return null;
    const B = HK.cache("m35_truck", body);
    const sc = HK.scheme(ctx.nation, ctx.arena, ctx.team);
    const M = HK.mats(sc);
    const root = new THREE.Group(); root.name = "m35";
    const bodyG = new THREE.Group(); bodyG.name = "body"; root.add(bodyG);
    HK.meshes(bodyG, B.geos, M, "hull");
    HK.meshes(bodyG, B.cGeos, M, "cover");
    const nation = ctx.nation || (ctx.team === "red" ? "kesh" : "republic");
    const fm = HK.flagMat(nation);
    if (fm) {
      const ratio = HK.flagRatio(nation), key = ratio.toFixed(3);
      if (!B.decals[key]) B.decals[key] = HK.decalGeo([[1.034, 1.50, 1.12, 1, 0, 0.30], [-1.034, 1.50, 1.12, -1, 0, 0.30],
        [1.15, 1.60, -0.35, 1, 0, 0.36], [-1.15, 1.60, -0.35, -1, 0, 0.36]], ratio);
      const dm = new THREE.Mesh(B.decals[key], fm); dm.name = "flags"; bodyG.add(dm);
    }
    // the tailgate on its hinge
    const gate = new THREE.Group(); gate.name = "tailgate"; gate.position.set(0, BED.y, BED.z1 + 0.02); bodyG.add(gate);
    HK.meshes(gate, B.tgGeos, M, "gate");
    // the ring mount's traversing carriage and the gun
    const turret = new THREE.Group(); turret.name = "turret"; turret.position.set(RING.x, RING.y, RING.z); bodyG.add(turret);
    HK.meshes(turret, B.rGeos, M, "carriage");
    const gun = new THREE.Group(); gun.name = "gun"; gun.position.set(0, 0.26, RING.r - 0.02); turret.add(gun);
    const tube = new THREE.Group(); tube.name = "tube"; gun.add(tube);
    HK.meshes(tube, B.gGeos, M, "m2");
    const muzzle = new THREE.Object3D(); muzzle.name = "muzzle"; muzzle.position.set(0, 0.03, 1.46); tube.add(muzzle);
    // the crew: driver and commander in the cab; the commander stands in the
    // ring to fight; sixteen riflemen on the benches
    const seed = (ctx.seed | 0) >>> 0;
    const fig = function (kind, k) { const m = new THREE.Mesh(HK.figure(kind, sc, (seed + k) % 4), M.crew); m.castShadow = false; return m; };
    const driver = fig("seated", 0); driver.position.set(0.48, 1.72, 1.08); bodyG.add(driver);
    const cdr = fig("seated", 1); cdr.position.set(-0.48, 1.72, 1.08); bodyG.add(cdr);
    const stand = fig("gunner", 2); stand.position.set(0, -0.17, RING.r - 0.02 - 0.62); stand.castShadow = true; turret.add(stand);
    const benchGeo = HK.figure("bench", sc, seed % 4);
    if (!benchGeo._hkBounds) {
      benchGeo._hkBounds = true;
      benchGeo.boundingBox = new THREE.Box3(new THREE.Vector3(-1.1, 1.3, BED.z1), new THREE.Vector3(1.1, 2.6, BED.z0));
      benchGeo.boundingSphere = new THREE.Sphere(); benchGeo.boundingBox.getBoundingSphere(benchGeo.boundingSphere);
    }
    const troops = new THREE.InstancedMesh(benchGeo, M.crew, 16); troops.name = "troops";
    const tm = new THREE.Matrix4(), tq = new THREE.Quaternion(), tp = new THREE.Vector3(), ts = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < 16; i++) {
      const s = i % 2 ? -1 : 1, k = Math.floor(i / 2);
      tq.setFromAxisAngle(up, s > 0 ? -PI / 2 : PI / 2);
      tp.set(s * 0.95, 1.80, BED.z0 - 0.40 - k * 0.42);
      troops.setMatrixAt(i, tm.compose(tp, tq, ts));
    }
    troops.count = 0;
    bodyG.add(troops);
    // wheels: front singles, rear duals (inner + outer) on both tandem axles
    const wheels = [
      { x: TRF, y: R, z: AXF, r: R, steer: 1 }, { x: -TRF, y: R, z: AXF, r: R, steer: 1 },
    ];
    [AXM, AXR].forEach(function (z) {
      [1, -1].forEach(function (s) {
        wheels.push({ x: s * (TRD + DUAL), y: R, z: z, r: R, steer: 0 });
        wheels.push({ x: s * (TRD - DUAL), y: R, z: z, r: R, steer: 0 });
      });
    });
    const WS = HK.wheelSet(root, B.tyreGeo, B.rimGeos, M, wheels.length, [-1.2, 0, AXR - R, 1.2, 2 * R, AXF + R]);
    const rig = new HK.WheeledRig({
      root: root, body: bodyG, wheels: wheels, tyreIM: WS.tyreIM, rimIMs: WS.rimIMs, wheelbase: AXF - (AXM + AXR) / 2, track: 2 * TRF,
      travel: [0.10, 0.10], turret: turret, gun: gun, tube: tube, muzzle: muzzle,
      tcfg: { rate: 1.2, elevRate: 1.0, elevMin: -0.30, elevMax: 0.9 },
      figs: { driver: driver },
      ringStand: { seat: "commander", standing: stand, seated: cdr },
      troops: { im: troops, max: 16 },
      tailgate: { obj: gate, open: -1.50 },
      exhaust: { p: [-0.98, 2.86, 0.30], d: [0, 0.6, -0.4], soot: 1.0 },
      engine: [0, 1.75, 2.4], cabin: [0, 2.0, 1.1], arena: ctx.arena, seed: seed, mgKick: true,
      pitchK: 0.010, rollK: 0.007,
    });
    return { group: root, rig: rig, footW: Wd, footL: L, height: H };
  }

  CBZ.unitKit.register("m35_truck", {
    kind: "vehicle",
    domain: "ground",
    drive: "wheeled",
    stats: { hp: 260, mass: 6100, speed: 25, reverse: 4, accel: 1.1, turn: 0.55, wheelbase: 3.91, maxSteer: 0.36, grip: 0.6,
      length: L, width: Wd, height: H,
      armour: { front: 3, side: 0, rear: 0, top: 0 }, standoff: 420, dismountAt: 520 },
    turret: { rate: 1.2, elevRate: 1.0, elevMin: -0.30, elevMax: 0.9 },
    crew: [{ seat: "driver", pos: [0.48, 2.1, 1.1] }, { seat: "commander", pos: [-0.48, 2.1, 1.1] }],
    passengers: 16,
    weapons: [
      { id: "m2hb_50cal_m36", seat: "commander", kind: "mg", wid: "lmg", turret: true, rof: 8, burst: 7, pause: 1.6, dmg: 38, pen: 24, range: 1500, ammo: 600 },
    ],
    tactics: { role: "transport", keepFrom: { men: 420, launcher: 500 }, avoidArmour: true, dismountAt: 520, lead: false, withdrawAt: 0.5 },
    build: build,
  });
})();
