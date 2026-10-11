/* ============================================================
   units/vehicles/fmtv.js — FMTV M1083A1 5-ton 6x6 cargo truck (MTV), with
   the LTAS armoured cab, troop seats in the bed and an M2 .50 on the cab
   ring (USA; fielded here by any nation's army).

   The Family of Medium Tactical Vehicles replaced the M35 "deuce and a half"
   (units/vehicles/m35_truck.js) in the US Army from the mid-1990s. This is
   the truck the infantry rides behind the tanks: sixteen men on the bench
   seats down both sides of the bed, under the canvas, the tailgate dropping
   when they get out.

   THE BODY  6.93 m long, 2.44 m wide, 2.95 m over the cab roof, 3.30 m over
             the bows. A flat-fronted cab-over: the Caterpillar C7 sits UNDER
             the cab, the front axle under the doors. 4.17 m wheelbase (front
             axle to the centre of the tandem), 1.37 m between the rear axles;
             six SINGLE 395/85R20 Michelin XZL tyres (1.12 m) on ten-stud
             steel discs, each hub with the CTIS rotary seal and its air line
             to the valve (the driver pumps the tyres up for the road and lets
             them down for sand). Ladder frame on two C-rails, parabolic leaf
             springs, the rear tandem on its trunnion.
   THE CAB   LTAS (Long Term Armor Strategy) cab: the A-kit steel shell with
             the B-kit bolted on, armour panels on both doors with their bolt
             rows, small thick armoured door windows, a split flat windscreen
             with top-pivot wipers, the black grille under it, the clearance
             lamps on the roof edge, the big mirrors on their arms, the
             headlamps down in the bumper corners behind brush guards, black
             fender flares over the front wheels, the two-step ladder behind
             each front wheel. The roof hatch on the commander's (right) side
             carries the ring: an M2HB on its carriage, the gunner stands up
             through the hatch to fight.
   THE BED   4.4 m steel cargo body: drop sides with their pressed ribs and
             hinges, the side racks that are the troop seats' backrests, the
             fold-down bench seats, the headboard; five bows under an olive
             canvas cover that sags between them, the rear curtain rolled up.
             Behind the cab: the air intake stack, the exhaust with its heat
             shield, the spare on its carrier. At the tail: the tailgate on
             its hinges (it drops for the dismount), the troop step, the tail
             lamps, the pintle, the mud flaps.
   TROOPS    sixteen riflemen on the benches, eight a side, facing in, rifles
             up; each one is drawn only while his seat is filled.
   PAINT     the side's nation and ground (units/kit/hull.js): CARC tan or
             Gulf sand on sand, NATO three-tone green elsewhere, whitewash on
             snow; canvas to match; the nation's flag on both doors and both
             sides of the bed.
   DRIVE     8,800 kg empty, ~10.4 t with the squad and kit; 330 hp: 0-48
             km/h in ~10 s, 94 km/h governed, 12.7 m turning radius, ~0.6 g.
             Every wheel rides its own spring over the ground; the body
             squats, dives and rolls.
   ARMOUR    BY PLACE (stats.plates, the battle's hull-space armour boxes):
             the LTAS cab stops rifle ball on every face (11 mm RHA
             equivalent; 6 mm roof): 5.56, 7.62x39 and 7.62x51 ball bounce,
             .50 and anything bigger goes through. Under the cab (bumper,
             radiator, engine) is plain truck. The BED is sheet steel and
             canvas: rifle fire goes straight through it into the men on the
             benches. A round that bounces off the cab leaves its splash on
             the paint or a star in the armoured glass.
   DAMAGE    hit: smoke out from under the cab; burning: fire; a mobility kill
             sits it on a shot-out tyre; a firepower kill hangs the .50; burnt
             out: the canvas burns off the bows, the tyres go and it settles
             onto its rims.
   WEAPON    M2HB .50 on the cab ring, 600 rounds aboard.

   TACTICS (src/battle/vehicles.js reads standoff and dismountAt; the rest
   is the interface the AI agent reads): a CONVOY TRUCK. It rides behind the
   armour, puts its sixteen men out at 520 m (out of aimed rifle range: it is
   soft-skinned from the cab back), then stays back at ~420 m behind them
   with the .50 for support. It never leads and it never closes on armour.

   Units: metres, m/s, kg, mm RHA. Nose +Z, +X is the vehicle's left (the
   driver's side).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.unitKit) return;
  const PI = Math.PI;

  // ---- the numbers -----------------------------------------------------------
  const L = 6.93, Wd = 2.44, H = 3.30;
  const AXF = 2.48, AXM = -1.00, AXR = -2.37, R = 0.56, TW = 0.40, RIM = 0.26, TRK = 1.00;
  // the cab: back wall, front face, floor, roof; half width
  const CAB = { zb: 1.42, zf: 3.38, y0: 1.42, y1: 2.92, w: 1.17, wsy: 2.08, rake: 0.106 };
  const BED = { z0: 0.97, z1: -3.42, y: 1.55, w: 1.20, side: 2.12 };
  const RING = { x: -0.45, y: 3.08, z: 2.20, r: 0.52 };
  // the sixteen bench places, hips: left and right alternating, front to back
  const BENCH = [];
  for (let i = 0; i < 16; i++) { const s = i % 2 ? -1 : 1; BENCH.push([s * 1.00, BED.y + 0.48, BED.z0 - 0.48 - Math.floor(i / 2) * 0.52]); }
  // the cover's arch over the side top (x, y), right half; mirrored for the left
  const ARCH = [[1.22, BED.side], [1.22, 2.78], [1.16, 3.04], [0.97, 3.20], [0.62, 3.28], [0.22, 3.30]];

  function arch(k) {          // the canvas arch, full width, k slightly inflates it
    const a = ARCH.map(function (p) { return [p[0] * k, BED.side + (p[1] - BED.side) * k]; });
    const out = a.slice();
    for (let i = a.length - 1; i >= 0; i--) out.push([-a[i][0], a[i][1]]);
    return out;
  }

  /* ---- THE BODY: built once into shared geometry (one per material) -------- */
  function body() {
    const HK = CBZ.hullKit, G = HK.geo();
    // ---------------------------------------------------------- frame + running gear
    G.m("paint").c(0.6);
    [-1, 1].forEach(function (s) {
      G.box(s * 0.46, 1.02, -0.05, 0.09, 0.26, 6.60);                                          // C-channel rails
      G.box(s * 0.42, 1.02, -0.05, 0.01, 0.22, 6.60);
    });
    [3.10, 1.60, 0.30, -0.60, -1.70, -3.20].forEach(function (z) { G.box(0, 1.00, z, 0.84, 0.14, 0.10); });
    G.m("metal").c(0.9);
    [AXF, AXM, AXR].forEach(function (z) {
      G.cyl(0, R, z, 0.08, 0.08, 1.66, "x", 10);                                               // axle housing
      G.sphere(0.12, R, z, 0.24, 9, 1.0, 0.95, 0.9);                                           // the differential
      [-1, 1].forEach(function (s) { G.cyl(s * 0.74, R, z, 0.15, 0.15, 0.18, "x", 12); });     // hubs and drums
    });
    // front parabolic springs (three tapered leaves), shocks
    [-1, 1].forEach(function (s) {
      for (let i = 0; i < 3; i++) G.box(s * 0.46, R + 0.13 + i * 0.03, AXF, 0.08, 0.025, 1.40 - i * 0.26);
      G.box(s * 0.46, R + 0.10, AXF, 0.11, 0.09, 0.18);                                        // U-bolts and pad
      G.save().m("dark").c(1).tube([s * 0.62, R + 0.05, AXF + 0.22], [s * 0.56, 1.10, AXF + 0.30], 0.035, 0.03).restore();
    });
    // the rear tandem: springs on the trunnion, torque rods
    const ZT = (AXM + AXR) / 2;
    [-1, 1].forEach(function (s) {
      G.cyl(s * 0.46, 0.90, ZT, 0.10, 0.10, 0.26, "x", 10);
      for (let i = 0; i < 4; i++) G.box(s * 0.46, 0.84 - i * 0.026, ZT, 0.08, 0.025, 1.50 - i * 0.22);
      G.box(s * 0.30, R + 0.13, ZT, 0.05, 0.05, 1.30);
    });
    G.cyl(0, 0.74, 0.70, 0.05, 0.05, 2.6, "z", 6);                                             // propeller shafts
    G.cyl(0, 0.62, ZT, 0.045, 0.045, 1.3, "z", 6);
    G.box(0, 0.80, -0.35, 0.40, 0.30, 0.50);                                                   // transfer case
    // the engine and the transmission, seen between the front wheels
    G.m("dark").c(1);
    G.box(0, 1.08, 2.45, 0.66, 0.52, 1.10);
    G.box(0, 1.00, 1.60, 0.48, 0.40, 0.70);
    G.m("black").c(1).box(0, 0.90, 3.05, 0.78, 0.20, 0.08);                                    // the sump guard's lip
    // ---------------------------------------------------------- bumper, lamps, guards
    G.m("paint").c(1);
    G.box(0, 1.15, 3.46, 2.42, 0.30, 0.18);                                                    // the bumper
    G.box(0, 1.33, 3.40, 2.30, 0.06, 0.10);
    G.m("dark").c(1);
    [-1, 1].forEach(function (s) {
      // tow shackles
      G.box(s * 0.48, 1.06, 3.57, 0.10, 0.06, 0.06);
      G.cyl(s * 0.48, 1.06, 3.62, 0.055, 0.055, 0.03, "x", 10);
      // the headlamp in its recess in the bumper end, the turn lamp beside it, the guard
      G.save().m("black").c(1).box(s * 0.92, 1.16, 3.555, 0.34, 0.24, 0.01).restore();
      G.save().m("lamp").c(1).cyl(s * 0.98, 1.16, 3.56, 0.085, 0.085, 0.02, "z", 14).restore();
      G.save().m("amber").c(1).box(s * 0.80, 1.16, 3.56, 0.07, 0.07, 0.02).restore();
      for (let i = 0; i < 3; i++) G.tube([s * (0.80 + i * 0.09), 1.04, 3.58], [s * (0.80 + i * 0.09), 1.28, 3.58], 0.012, 0.012, 5);
      G.tube([s * 0.74, 1.28, 3.58], [s * 1.10, 1.28, 3.58], 0.014, 0.014, 5);
    });
    // black fender flares over the front wheels; mud flaps behind them
    [-1, 1].forEach(function (s) {
      G.save().m("black").c(1);
      G.box(s * 1.05, 1.36, AXF, 0.42, 0.04, 1.22);
      G.box(s * 1.24, 1.26, AXF, 0.03, 0.18, 1.24);
      G.box(s * 1.05, 1.20, AXF + 0.62, 0.42, 0.30, 0.03, -0.35, 0, 0);
      G.box(s * 1.00, 0.80, AXF - 0.68, 0.46, 0.55, 0.02);
      G.restore();
    });
    // ---------------------------------------------------------- the LTAS cab
    G.m("paint").c(1);
    const zr = CAB.zf - (CAB.y1 - 0.12 - CAB.wsy) * CAB.rake;            // the top of the raked windscreen
    G.prof(-CAB.w, CAB.w, [[CAB.zb, CAB.y0], [CAB.zf, CAB.y0], [CAB.zf + 0.01, CAB.wsy], [zr, CAB.y1 - 0.12], [zr - 0.12, CAB.y1],
      [CAB.zb + 0.10, CAB.y1], [CAB.zb, CAB.y1 - 0.08]]);
    // the drip rail round the roof, the roof's stiffening ribs
    G.c(0.9);
    [-1, 1].forEach(function (s) { G.box(s * (CAB.w + 0.01), CAB.y1 - 0.06, (CAB.zb + zr) / 2, 0.03, 0.04, zr - CAB.zb); });
    for (let i = 0; i < 3; i++) G.box(0, CAB.y1 + 0.012, CAB.zb + 0.40 + i * 0.45, 2.10, 0.02, 0.05);
    G.c(1);
    // the front face: the black grille under the windscreen, its bars, the badge plate
    G.save().m("black").c(1).box(0, 1.80, CAB.zf + 0.012, 1.70, 0.44, 0.02).restore();
    G.c(0.85);
    for (let i = 0; i < 7; i++) G.box(0, 1.62 + i * 0.06, CAB.zf + 0.03, 1.66, 0.018, 0.025);
    G.c(1);
    G.box(0, 1.50, CAB.zf + 0.02, 2.20, 0.10, 0.03);                                            // the lower valance
    // windscreen: frame, two flat panes, the pillar, top-pivot wipers
    G.save().tf(0, CAB.wsy, CAB.zf + 0.01, -CAB.rake, 0, 0);
    G.box(0, 0.04, 0.01, 2.26, 0.06, 0.04); G.box(0, 0.66, 0.01, 2.26, 0.06, 0.04);
    [-1, 0, 1].forEach(function (s) { G.box(s * 1.07, 0.35, 0.01, s ? 0.10 : 0.07, 0.66, 0.04); });
    G.m("glass").c(1);
    [-1, 1].forEach(function (s) { G.box(s * 0.53, 0.35, 0.015, 0.96, 0.56, 0.02); });
    G.m("black").c(1);
    [-1, 1].forEach(function (s) { G.box(s * 0.53, 0.40, 0.04, 0.02, 0.48, 0.015, 0, 0, s * 0.35); G.cyl(s * 0.60, 0.64, 0.04, 0.02, 0.02, 0.03, "z", 8); });
    G.restore();
    // clearance lamps on the roof's front edge: three in the middle, one at each corner
    G.m("amber").c(1);
    [-0.18, 0, 0.18, -1.05, 1.05].forEach(function (x) { G.box(x, CAB.y1 + 0.03, zr - 0.14, 0.07, 0.05, 0.05); });
    // DOORS: the B-kit armour panel with its bolt rows, the armoured window,
    // seams, the hinges on the front edge, the handle
    [-1, 1].forEach(function (s) {
      const x = s * CAB.w;
      G.m("black").c(1);
      G.box(x + s * 0.004, 1.98, 3.10, 0.012, 1.10, 0.015); G.box(x + s * 0.004, 1.98, 1.74, 0.012, 1.10, 0.015);
      G.m("paint").c(0.94);
      G.box(x + s * 0.025, 1.84, 2.42, 0.04, 0.70, 1.20);                                        // armour panel
      G.box(x + s * 0.025, 2.47, 2.42, 0.04, 0.10, 1.20);
      G.m("dark").c(1);
      for (let i = 0; i < 6; i++) {
        G.cyl(x + s * 0.05, 2.15, 1.92 + i * 0.20, 0.016, 0.016, 0.012, "x", 6);
        G.cyl(x + s * 0.05, 1.53, 1.92 + i * 0.20, 0.016, 0.016, 0.012, "x", 6);
      }
      [1.68, 2.24].forEach(function (y) { G.box(x + s * 0.05, y, 3.02, 0.04, 0.12, 0.06); });   // hinges
      G.box(x + s * 0.06, 2.05, 1.92, 0.04, 0.05, 0.16);                                         // handle
      // the armoured window: a deep frame, then the thick glass set into it
      G.m("paint").c(0.85);
      G.box(x + s * 0.05, 2.70, 2.42, 0.06, 0.06, 0.92); G.box(x + s * 0.05, 2.30, 2.42, 0.06, 0.06, 0.92);
      G.box(x + s * 0.05, 2.50, 2.93, 0.06, 0.46, 0.06); G.box(x + s * 0.05, 2.50, 1.91, 0.06, 0.46, 0.06);
      G.m("glass").c(1).box(x + s * 0.03, 2.50, 2.42, 0.02, 0.36, 0.96);
      // the two-step ladder behind the front wheel
      G.m("paint").c(0.8);
      G.box(x - s * 0.05, 0.78, 1.66, 0.30, 0.03, 0.34); G.box(x - s * 0.05, 1.12, 1.66, 0.30, 0.03, 0.34);
      G.box(x + s * 0.09, 1.00, 1.50, 0.03, 0.62, 0.04); G.box(x + s * 0.09, 1.00, 1.82, 0.03, 0.62, 0.04);
      // grab handle on the A-pillar
      G.m("dark").c(1).tube([x + s * 0.05, 1.70, 3.30], [x + s * 0.05, 2.30, 3.30], 0.015, 0.015, 6);
      // MIRRORS: the big west-coast glass and the spot mirror under it, on their arms
      G.tube([x, 2.62, 3.28], [x + s * 0.28, 2.66, 3.30], 0.016, 0.016, 6);
      G.tube([x, 2.08, 3.28], [x + s * 0.28, 2.18, 3.30], 0.016, 0.016, 6);
      G.box(x + s * 0.30, 2.42, 3.30, 0.05, 0.46, 0.22);
      G.box(x + s * 0.30, 2.08, 3.30, 0.05, 0.16, 0.18);
      G.m("glass").c(1).box(x + s * 0.30, 2.42, 3.28, 0.03, 0.42, 0.19);
    });
    // the back wall: its small armoured window
    G.m("paint").c(0.85).box(0, 2.42, CAB.zb - 0.03, 0.70, 0.36, 0.04);
    G.m("glass").c(1).box(0, 2.42, CAB.zb - 0.05, 0.60, 0.26, 0.01);
    // a whip antenna on the left rear corner, tied forward over the cab
    G.m("dark").c(1).cyl(1.00, CAB.y1 + 0.06, CAB.zb + 0.10, 0.03, 0.04, 0.12, "y", 8);
    G.m("black").c(1).tube([1.00, CAB.y1 + 0.10, CAB.zb + 0.10], [0.92, CAB.y1 + 0.32, CAB.zb + 1.60], 0.006, 0.005, 4);
    // THE RING over the commander's hatch: the hatch coaming, three posts, the ring
    G.m("paint").c(0.9);
    G.cyl(RING.x, CAB.y1 + 0.04, RING.z, 0.42, 0.44, 0.08, "y", 20, 0, 0, 0, { open: true });
    [0, 2.1, 4.2].forEach(function (a) {
      const px = RING.x + Math.sin(a) * RING.r * 0.92, pz = RING.z + Math.cos(a) * RING.r * 0.92;
      G.tube([px, CAB.y1, pz], [px, RING.y, pz], 0.035, 0.035, 6);
    });
    for (let i = 0; i < 24; i++) {
      const a0 = i * PI / 12, a1 = (i + 1) * PI / 12;
      G.tube([RING.x + Math.sin(a0) * RING.r, RING.y, RING.z + Math.cos(a0) * RING.r], [RING.x + Math.sin(a1) * RING.r, RING.y, RING.z + Math.cos(a1) * RING.r], 0.035, 0.035, 6);
    }
    // ---------------------------------------------------------- behind the cab
    // the fuel tank (driver's side), the battery and tool boxes (right)
    G.m("paint").c(0.92);
    G.box(1.00, 1.02, 0.55, 0.36, 0.46, 1.10);
    G.box(-1.00, 1.02, 0.65, 0.36, 0.42, 0.80);
    G.box(-1.00, 1.02, -0.05, 0.36, 0.42, 0.50);
    G.m("dark").c(1);
    [0.20, 0.90].forEach(function (z) { G.box(1.185, 1.02, z, 0.01, 0.48, 0.05); });
    G.cyl(1.00, 1.27, 0.85, 0.06, 0.06, 0.04, "y", 10);
    [0.65, -0.05].forEach(function (z) { G.box(-1.185, 1.10, z, 0.01, 0.04, 0.12); });
    // the air intake stack on the right rear corner: the stack, the rain cap
    G.m("paint").c(0.95);
    G.cyl(-1.02, 2.05, 1.22, 0.13, 0.13, 1.70, "y", 14);
    G.cyl(-1.02, 2.98, 1.22, 0.17, 0.15, 0.16, "y", 14);
    G.cyl(-1.02, 3.08, 1.22, 0.10, 0.17, 0.05, "y", 14);
    // the exhaust up the right side with its perforated heat shield
    G.m("black").c(1);
    G.cyl(-0.66, 2.10, 1.16, 0.055, 0.055, 1.80, "y", 10);
    G.tube([-0.66, 3.0, 1.16], [-0.66, 3.10, 1.06], 0.055, 0.055, 8);
    G.m("dark").c(1).cyl(-0.66, 2.35, 1.16, 0.09, 0.09, 0.80, "y", 12, 0, 0, 0, { open: true });
    // the spare's carrier against the headboard (the tyre itself is the wheel set's 7th)
    G.m("paint").c(0.8);
    G.box(0.62, 2.0, BED.z0 + 0.06, 0.08, 0.90, 0.06);
    G.box(0.62, 1.58, BED.z0 + 0.20, 0.70, 0.06, 0.30);
    // ---------------------------------------------------------- the cargo bed
    G.m("paint").c(1);
    const zc = (BED.z0 + BED.z1) / 2, len = BED.z0 - BED.z1;
    G.box(0, BED.y - 0.04, zc, BED.w * 2, 0.08, len);                                          // floor
    [-1, 1].forEach(function (s) { G.box(s * 0.46, 1.33, zc, 0.12, 0.22, len); });            // long sills
    for (let z = BED.z0 - 0.2; z > BED.z1; z -= 0.50) G.box(0, 1.42, z, 2.36, 0.08, 0.07);     // cross sills
    [-1, 1].forEach(function (s) {
      const x = s * (BED.w - 0.02);
      // the drop side: two panels, pressed ribs, the bottom hinges, latches
      G.box(x, (BED.y + BED.side) / 2, zc, 0.03, BED.side - BED.y, len);
      G.c(0.9);
      G.box(x + s * 0.02, BED.side - 0.03, zc, 0.03, 0.06, len);
      for (let z = BED.z0 - 0.20; z > BED.z1 + 0.1; z -= 0.30) G.box(x + s * 0.02, (BED.y + BED.side) / 2, z, 0.02, BED.side - BED.y - 0.14, 0.05);
      G.box(x + s * 0.025, (BED.y + BED.side) / 2, zc, 0.03, BED.side - BED.y, 0.06);         // the split between panels
      G.c(1);
      G.save().m("dark").c(1);
      for (let z = BED.z0 - 0.4; z > BED.z1; z -= 1.10) G.cyl(x + s * 0.03, BED.y + 0.02, z, 0.025, 0.025, 0.16, "z", 8);
      [zc + 1.05, zc - 1.05].forEach(function (z) { G.box(x + s * 0.04, BED.side - 0.10, z, 0.03, 0.08, 0.10); });
      G.restore();
      // the side rack above it: stakes in their pockets, two rails (the seat backs)
      G.save().m("gear").c(0.95);
      for (let z = BED.z0 - 0.10; z > BED.z1; z -= 0.88) G.box(s * 1.17, 2.32, z, 0.05, 0.42, 0.05);
      G.box(s * 1.17, 2.28, zc, 0.03, 0.10, len - 0.1); G.box(s * 1.17, 2.48, zc, 0.03, 0.10, len - 0.1);
      // the troop seat: plank, the folding legs, the rail it hinges on
      G.box(s * 0.98, BED.y + 0.43, zc - 0.05, 0.38, 0.04, len - 0.30);
      for (let z = BED.z0 - 0.45; z > BED.z1 + 0.2; z -= 0.86) G.box(s * 0.84, BED.y + 0.21, z, 0.04, 0.42, 0.04);
      G.box(s * 1.16, BED.y + 0.40, zc - 0.05, 0.03, 0.04, len - 0.30);
      G.restore();
      // mud flaps behind the tandem, a lashing D-ring under the side
      G.save().m("black").c(1).box(s * 1.00, 0.78, AXR - 0.70, 0.48, 0.60, 0.02).restore();
      G.save().m("dark").c(1).cyl(s * 1.22, 1.44, zc, 0.04, 0.04, 0.02, "x", 8).restore();
    });
    // the headboard, its slats, the cab protector over it
    G.box(0, (BED.y + 2.60) / 2, BED.z0 - 0.02, BED.w * 2, 2.60 - BED.y, 0.04);
    G.c(0.85);
    for (let i = 0; i < 7; i++) G.box(-1.02 + i * 0.34, (BED.y + 2.60) / 2, BED.z0 + 0.005, 0.05, 2.60 - BED.y, 0.02);
    G.c(1);
    // the rear: bumperettes, tail lamps, the pintle, the troop step
    [-1, 1].forEach(function (s) {
      G.box(s * 0.92, 1.24, BED.z1 - 0.04, 0.40, 0.20, 0.16);
      G.save().m("tail").c(1).box(s * 1.00, 1.36, BED.z1 - 0.12, 0.14, 0.09, 0.03).restore();
      G.save().m("amber").c(1).box(s * 0.84, 1.36, BED.z1 - 0.12, 0.09, 0.07, 0.03).restore();
      G.save().m("dark").c(1).cyl(s * 0.60, 1.18, BED.z1 - 0.14, 0.05, 0.05, 0.04, "x", 8).restore();
    });
    G.save().m("dark").c(1).box(0, 1.08, BED.z1 - 0.06, 0.20, 0.16, 0.20).cyl(0, 1.08, BED.z1 - 0.20, 0.07, 0.07, 0.04, "y", 10).restore();
    // the troop step: a stirrup on two hangers under the tail
    G.save().m("dark").c(1);
    G.box(0, 0.62, BED.z1 + 0.08, 0.60, 0.03, 0.18);
    [-1, 1].forEach(function (s) { G.box(s * 0.30, 0.94, BED.z1 + 0.08, 0.03, 0.64, 0.04); });
    G.restore();
    // the bows inside the cover (seen from the open tail; the cover hangs from them)
    G.m("dark").c(1);
    for (let k = 0; k < 5; k++) {
      const z = BED.z0 - 0.06 - k * (len - 0.10) / 4, A = arch(0.985);
      for (let i = 0; i < A.length - 1; i++) G.tube([A[i][0], A[i][1], z], [A[i + 1][0], A[i + 1][1], z], 0.02, 0.02, 5);
    }
    G.tube([0, 3.25, BED.z0 - 0.06], [0, 3.25, BED.z1 + 0.04], 0.018, 0.018, 5);                // the ridge pole
    const geos = G.build({ uv: 2.6, mud: 1.15 });

    // ---------------------------------------------------------- the canvas cover
    const C = HK.geo(); C.m("canvas").c(1);
    const rows = [], A = arch(1.0), nz = 17;
    for (let j = 0; j < nz; j++) {
      const z = BED.z0 - 0.02 - j * (len - 0.04) / (nz - 1);
      const ph = (j % 4) / 4, sag = Math.sin(ph * PI) * 0.035;
      rows.push(A.map(function (p) {
        const roof = Math.max(0, (p[1] - 2.7) / 0.6);
        return [p[0] * (1 - sag * 0.4 * (1 - roof)), p[1] - sag * roof, z];
      }));
    }
    C.grid(rows, true, [0.62, 0.62, 0.62]);
    // the front end panel, closed (a fan from the bottom centre), both faces
    const zf = BED.z0 - 0.02;
    for (let i = 0; i < A.length - 1; i++) C.tri(null, [0, BED.side, zf], [A[i][0], A[i][1], zf], [A[i + 1][0], A[i + 1][1], zf], [0, 0, 1]);
    for (let i = 0; i < A.length - 1; i++) C.tri(null, [0, BED.side, zf - 0.01], [A[i + 1][0], A[i + 1][1], zf - 0.01], [A[i][0], A[i][1], zf - 0.01], [0, 0, -1]);
    // the tie-down rope along the bottom edge, both sides
    C.m("dark").c(1);
    [-1, 1].forEach(function (s) { C.box(s * 1.23, BED.side + 0.03, zc, 0.015, 0.015, len - 0.05); });
    // the rear curtain rolled up under the crown, its straps
    C.m("canvas").c(0.9).cyl(0, 3.14, BED.z1 + 0.05, 0.10, 0.10, 1.60, "x", 12);
    C.m("black").c(1);
    [-0.55, 0.55].forEach(function (x) { C.box(x, 3.18, BED.z1 + 0.05, 0.04, 0.26, 0.22); });
    const cGeos = C.build({ uv: 1.6, mud: 0 });

    // ---------------------------------------------------------- tailgate (hinge at the floor)
    const Tg = HK.geo(); Tg.m("paint").c(1);
    Tg.box(0, 0.28, 0, BED.w * 2 - 0.06, 0.56, 0.04);
    Tg.c(0.9);
    for (let i = 0; i < 6; i++) Tg.box(-0.95 + i * 0.38, 0.28, -0.025, 0.05, 0.50, 0.02);
    Tg.box(0, 0.54, -0.025, BED.w * 2 - 0.10, 0.04, 0.02);
    Tg.m("dark").c(1);
    [-1, 1].forEach(function (s) { Tg.box(s * 1.05, 0.50, -0.03, 0.08, 0.06, 0.05); Tg.cyl(s * 1.12, 0.02, 0, 0.03, 0.03, 0.14, "x", 8); });
    const tgGeos = Tg.build({ uv: 2.6, mud: 0.5 });

    // ---------------------------------------------------------- the M2 on the ring
    const Rg = HK.geo();
    Rg.m("dark").c(1);
    Rg.box(0, 0.02, RING.r, 0.24, 0.08, 0.18);                       // the carriage that runs on the ring
    Rg.cyl(0, 0.13, RING.r, 0.035, 0.04, 0.20, "y", 8);              // the pintle
    const rGeos = Rg.build({ uv: 2.6, mud: 0 });
    const Gg = HK.geo(); HK.m2(Gg);
    const gGeos = Gg.build({ uv: 2.6, mud: 0 });

    // ---------------------------------------------------------- wheels
    const Wg = HK.geo();
    HK.tyre(Wg, R, TW, RIM, { lug: "xtr", lugs: 20, dep: 0.032 });
    const tyreGeo = Wg.build({ uv: 1, mud: 0 }).rubber;
    // the steel disc: dished, ten studs, the hub and its CTIS rotary seal, the
    // air line round to the valve
    const Dg = HK.geo();
    Dg.m("paint").c(0.85);
    Dg.cyl(TW * 0.30, 0, 0, RIM, RIM, 0.06, "x", 22);
    Dg.cyl(TW * 0.36, 0, 0, RIM * 0.62, RIM * 0.76, 0.06, "x", 20);
    Dg.cyl(TW * 0.42, 0, 0, 0.12, 0.13, 0.08, "x", 14);
    Dg.m("black").c(1);
    for (let i = 0; i < 6; i++) { const a = i * PI / 3 + 0.26; Dg.box(TW * 0.335, Math.cos(a) * RIM * 0.82, Math.sin(a) * RIM * 0.82, 0.02, 0.05, 0.08, a); }
    Dg.m("dark").c(1);
    for (let i = 0; i < 10; i++) { const a = i * PI / 5; Dg.cyl(TW * 0.42, Math.cos(a) * 0.155, Math.sin(a) * 0.155, 0.015, 0.015, 0.05, "x", 6); }
    Dg.cyl(TW * 0.50, 0, 0, 0.05, 0.065, 0.08, "x", 12);                                       // CTIS seal
    Dg.m("black").c(1);
    Dg.tube([TW * 0.53, 0.03, 0.02], [TW * 0.42, RIM * 0.70, 0.10], 0.010, 0.010, 5);           // its air line
    Dg.tube([TW * 0.42, RIM * 0.70, 0.10], [TW * 0.33, RIM * 0.90, 0.12], 0.010, 0.010, 5);
    Dg.m("paint").c(0.7).cyl(-TW * 0.36, 0, 0, RIM, RIM, 0.04, "x", 16);
    const rimGeos = Dg.build({ uv: 1, mud: 0 });

    return { geos: geos, cGeos: cGeos, tgGeos: tgGeos, rGeos: rGeos, gGeos: gGeos, tyreGeo: tyreGeo, rimGeos: rimGeos, decals: {} };
  }

  /* ---- STRIKES: a round the cab stopped leaves its mark where it hit ------- */
  const STRIKES = 28;
  // put a hull-space hit point onto the cab's skin: [x, y, z, face]
  function onCab(res, out) {
    const zn = res.zone, x = Math.max(-CAB.w + 0.05, Math.min(CAB.w - 0.05, res.hx)), y = Math.max(CAB.y0 + 0.05, Math.min(CAB.y1 - 0.05, res.hy));
    if (zn === "front") {
      const z = y > CAB.wsy ? CAB.zf - (y - CAB.wsy) * CAB.rake : CAB.zf;
      out[0] = x; out[1] = y; out[2] = z + 0.045; out[3] = 0;
    } else if (zn === "side") {
      const s = res.hx >= 0 ? 1 : -1, z = Math.max(CAB.zb + 0.08, Math.min(CAB.zf - 0.08, res.hz));
      // the door's armour panel stands 4.5 cm proud of the skin; its window 6 cm
      out[0] = s * (CAB.w + (y > 2.25 && y < 2.75 && z > 1.92 && z < 2.92 ? 0.045 : 0.05)); out[1] = y; out[2] = z; out[3] = s;
    } else if (zn === "rear") { out[0] = x; out[1] = y; out[2] = CAB.zb - 0.06; out[3] = 2; }
    else { out[0] = x; out[1] = CAB.y1 + 0.015; out[2] = Math.max(CAB.zb, Math.min(CAB.zf - 0.2, res.hz)); out[3] = 3; }
    return out;
  }

  function build(ctx) {
    const THREE = window.THREE, HK = CBZ.hullKit;
    if (!THREE || !HK) return null;
    const B = HK.cache("fmtv", body);
    const side = ctx.side || ctx.team || null, ground = ctx.ground || ctx.arena;
    const sc = HK.scheme(ctx.nation, ground, side);
    const M = HK.mats(sc);
    const root = new THREE.Group(); root.name = "fmtv";
    const bodyG = new THREE.Group(); bodyG.name = "body"; root.add(bodyG);
    HK.meshes(bodyG, B.geos, M, "hull");
    const cover = new THREE.Group(); cover.name = "cover"; bodyG.add(cover);
    HK.meshes(cover, B.cGeos, M, "cover");
    // the tailgate on its hinge at the floor
    const gate = new THREE.Group(); gate.name = "tailgate"; gate.position.set(0, BED.y, BED.z1 + 0.02); bodyG.add(gate);
    HK.meshes(gate, B.tgGeos, M, "gate");
    // the ring's traversing carriage and the gun
    const turret = new THREE.Group(); turret.name = "turret"; turret.position.set(RING.x, RING.y, RING.z); bodyG.add(turret);
    HK.meshes(turret, B.rGeos, M, "carriage");
    const gun = new THREE.Group(); gun.name = "gun"; gun.position.set(0, 0.26, RING.r - 0.02); turret.add(gun);
    const tube = new THREE.Group(); tube.name = "tube"; gun.add(tube);
    HK.meshes(tube, B.gGeos, M, "m2");
    const muzzle = new THREE.Object3D(); muzzle.name = "muzzle"; muzzle.position.set(0, 0.03, 1.46); tube.add(muzzle);
    // the crew: driver (left) and commander (right) in the cab; the commander
    // stands up through his hatch into the ring to fight; sixteen on the benches
    const seed = (ctx.seed | 0) >>> 0;
    const fig = function (kind, k) { return HK.figMesh(kind, sc, (seed + k) % 4, M); };
    const driver = fig("seated", 0); driver.position.set(0.55, 1.90, 2.30); bodyG.add(driver);
    const cdr = fig("seated", 1); cdr.position.set(-0.55, 1.90, 2.30); bodyG.add(cdr);
    const stand = fig("gunner", 2); stand.position.set(0, -0.17, RING.r - 0.02 - 0.62); stand.castShadow = true; turret.add(stand);
    const troops = HK.figMesh("bench", sc, seed % 4, M, 16, [-1.2, BED.y - 0.5, BED.z1, 1.2, 3.0, BED.z0]); troops.name = "troops";
    const tm = new THREE.Matrix4(), tq = new THREE.Quaternion(), tp = new THREE.Vector3(), ts = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < 16; i++) {
      const p = BENCH[i];
      tq.setFromAxisAngle(up, p[0] > 0 ? -PI / 2 : PI / 2);
      tp.set(p[0], p[1], p[2]);
      troops.setMatrixAt(i, tm.compose(tp, tq, ts));
    }
    troops.count = 0;
    bodyG.add(troops);
    // six single wheels; the spare rides as a 7th instance that never turns
    const wheels = [{ x: TRK, y: R, z: AXF, r: R, steer: 1 }, { x: -TRK, y: R, z: AXF, r: R, steer: 1 }];
    [AXM, AXR].forEach(function (z) { wheels.push({ x: TRK, y: R, z: z, r: R, steer: 0 }, { x: -TRK, y: R, z: z, r: R, steer: 0 }); });
    const WS = HK.wheelSet(root, B.tyreGeo, B.rimGeos, M, wheels.length + 1, [-1.25, 0, AXR - R, 1.25, 2 * R + 1.6, AXF + R]);
    // the spare: standing on its carrier against the headboard, face to the rear
    const sm = new THREE.Matrix4().compose(new THREE.Vector3(0.62, 1.61 + R, BED.z0 + 0.22), new THREE.Quaternion().setFromAxisAngle(up, PI / 2), new THREE.Vector3(1, 1, 1));
    WS.tyreIM.setMatrixAt(wheels.length, sm);
    WS.rimIMs.forEach(function (im) { im.setMatrixAt(wheels.length, sm); });
    // the cab's strike marks: a splash of lead on the paint, a star in the glass
    const strikeGeo = B.strikeGeo || (B.strikeGeo = (function () {
      const g = new THREE.CircleGeometry(0.035, 7);
      g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 2.2, 2.4), 2.2);
      return g;
    })());
    const strikeMat = B.strikeMat || (B.strikeMat = new THREE.MeshLambertMaterial({ color: 0xb9b5aa, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
    const strikes = new THREE.InstancedMesh(strikeGeo, strikeMat, STRIKES);
    strikes.name = "strikes"; strikes.count = 0; strikes.castShadow = false;
    bodyG.add(strikes);
    const rig = new HK.WheeledRig({
      root: root, body: bodyG, wheels: wheels, tyreIM: WS.tyreIM, rimIMs: WS.rimIMs, wheelbase: AXF - (AXM + AXR) / 2, track: 2 * TRK,
      travel: [0.12, 0.12], turret: turret, gun: gun, tube: tube, muzzle: muzzle,
      tcfg: { rate: 1.2, elevRate: 1.0, elevMin: -0.30, elevMax: 0.9 },
      figs: { driver: driver },
      ringStand: { seat: "commander", standing: stand, seated: cdr },
      troops: { im: troops, max: 16 },
      tailgate: { obj: gate, open: -1.55 },
      exhaust: { p: [-0.66, 3.10, 1.00], d: [0, 0.7, -0.3], soot: 0.6 },
      engine: [0, 1.30, 2.45], cabin: [0, 2.2, 2.3], ground: ground, side: side, seed: seed,
      pitchK: 0.009, rollK: 0.007,
      // the nation's flag on both doors and both sides of the bed
      decal: { parent: bodyG, cache: B.decals, list: [[CAB.w + 0.047, 1.86, 2.42, 1, 0, 0.32], [-(CAB.w + 0.047), 1.86, 2.42, -1, 0, 0.32],
        [BED.w + 0.02, 1.84, -0.60, 1, 0, 0.40], [-(BED.w + 0.02), 1.84, -0.60, -1, 0, 0.40]] },
    });
    // the WheeledRig poses only the six running wheels; keep the spare where it is
    const pose = rig.poseWheels;
    rig.poseWheels = function (steer) {
      pose.call(this, steer);
      this.tyreIM.setMatrixAt(wheels.length, sm);
      for (let k = 0; k < this.rimIMs.length; k++) this.rimIMs[k].setMatrixAt(wheels.length, sm);
    };
    rig.poseWheels(0);
    /* DAMAGE STATES beyond the kit's (smoke, fire, flat, hung gun): every round
       the LTAS cab stops leaves a strike where it hit (res.hx/hy/hz, the hull
       point the battle hands a flown round's hit); a burnt-out truck loses
       its canvas off the bows. */
    const _o = [0, 0, 0, 0];
    let nStrike = 0;
    const kitDamage = rig.damage;
    rig.damage = function (vs, res) {
      kitDamage.call(this, vs, res);
      if (!res || res.pen || res.hx == null || res.hz < CAB.zb - 0.1 || res.hy < CAB.y0 - 0.1) return;
      const o = onCab(res, _o), r = Math.random;
      if (o[3] === 0) tq.setFromAxisAngle(up, 0);
      else if (o[3] === 1 || o[3] === -1) tq.setFromAxisAngle(up, o[3] * PI / 2);
      else if (o[3] === 2) tq.setFromAxisAngle(up, PI);
      else tq.setFromAxisAngle(tp.set(1, 0, 0), -PI / 2);
      const k = 0.7 + r() * 0.7;
      ts.set(k, k, 1);
      strikes.setMatrixAt(nStrike % STRIKES, tm.compose(tp.set(o[0], o[1], o[2]), tq, ts));
      ts.set(1, 1, 1);
      nStrike++;
      strikes.count = Math.min(STRIKES, nStrike);
      strikes.instanceMatrix.needsUpdate = true;
    };
    const kitWrecked = rig.wrecked;
    rig.wrecked = function (dt, u) {
      kitWrecked.call(this, dt, u);
      if (cover.visible && this.burnt > 9) cover.visible = false;
    };
    rig.mark(ctx.nation, ground, side);
    return { group: root, rig: rig, footW: Wd, footL: L, height: H };
  }

  CBZ.unitKit.register("fmtv", {
    kind: "vehicle",
    domain: "ground",
    drive: "wheeled",
    // 8,800 kg empty, ~10.4 t loaded with a squad; 330 hp; 0.6 g on dirt
    stats: { hp: 320, mass: 10400, speed: 26, reverse: 4, accel: 1.35, turn: 0.5, wheelbase: 4.17, maxSteer: 0.34, grip: 0.6,
      length: L, width: Wd, height: H,
      // the face table is the fallback for a hit with no impact point (a blast,
      // a table hit): the cab is what the front shows, the bed is most of the
      // side, the rear and the top. Under 2 mm is the kit's soft-skin rule.
      armour: { front: 11, side: 1, rear: 1, top: 1 },
      // ARMOUR BY PLACE (hull space, first match wins): the LTAS cab, then the
      // soft truck under it; everything else (the bed) takes the face table
      plates: [
        { part: "cab", box: [-CAB.w - 0.12, CAB.y0, CAB.zb - 0.08, CAB.w + 0.12, H + 0.1, L / 2 + 0.1], armour: { front: 11, side: 11, rear: 11, top: 6 } },
        { part: "chassis", box: [-Wd / 2 - 0.1, 0, CAB.zb - 0.08, Wd / 2 + 0.1, CAB.y0, L / 2 + 0.1], armour: { front: 1.5, side: 1.5, rear: 1, top: 1 } },
      ],
      standoff: 420, dismountAt: 520 },
    turret: { rate: 1.2, elevRate: 1.0, elevMin: -0.30, elevMax: 0.9 },
    // hull-space seats: the crew-casualty line is measured to these (a burst
    // down the bed reaches the men on the benches; the cab's crew sit behind armour)
    crew: [{ seat: "driver", pos: [0.55, 2.35, 2.30] }, { seat: "commander", pos: [-0.55, 2.35, 2.30] }],
    passengers: 16,
    passengerPos: BENCH.map(function (p) { return [p[0], p[1] + 0.45, p[2]]; }),
    weapons: [
      // M2HB on the cab ring: the ring mount's own ballistics row
      { id: "m2_50cal_ring", seat: "commander", kind: "mg", wid: "lmg", turret: true, rof: 8, burst: 7, pause: 1.6, dmg: 38, pen: 24, range: 1800, ammo: 600 },
    ],
    tactics: {
      role: "transport",
      convoy: { place: "behind", follow: "armour", gap: 60 },    // a convoy truck: it rides behind the tanks
      carries: 16,
      engage: { soft: 1200, armour: 0, close: 18 },
      priorities: ["launcher", "mg", "men", "vehicle"],
      keepFrom: { men: 420, launcher: 500, armour: 1500 },
      hullDown: false, faceThreat: true, reverseOut: true, lead: false,   // the armoured cab toward the fire
      screen: { need: "men", behind: 80 },             // never ahead of the infantry it carried
      withdrawAt: 0.5,
    },
    animate: function (veh, dt, c) { if (CBZ.hullKit) CBZ.hullKit.animate(veh, dt, c); else if (c && c.shared) c.shared(dt); },
    build: build,
  });
})();
