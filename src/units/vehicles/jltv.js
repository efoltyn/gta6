/* ============================================================
   units/vehicles/jltv.js — OSHKOSH L-ATV, the Joint Light Tactical
   Vehicle (M1278 Heavy Guns Carrier, USA), with a CROWS remote weapon
   station and an M2 .50. The Humvee's replacement.

   What the Humvee was not: armoured from the drawing board (a crew capsule
   with an MRAP-grade underbody, not a B-kit bolted onto a truck), and fast
   off the road on Oshkosh's TAK-4i independent suspension.

   THE BODY  6.20 m long, 2.49 m wide, 2.20 m to the cab roof at the
             off-road ride height, 2.95 m over the CROWS. 3.58 m wheelbase,
             2.06 m track, 0.47 m under the hubs. 37-inch tyres (0.94 m) on
             beadlock rims (the bolted ring round the rim face).
             THE CAB: an angular capsule, its floor a shallow V; the lower
             doors lean out from the floor to the belt line, the window band
             stands straight, the roof edge is chamfered. Four armoured doors
             on outside hinges, each with its big thick window (the front
             pair's raked to the A-pillar), recessed handles; the split
             windscreen steeply raked between thick pillars. THE NOSE: the
             long hood falling to a high square face, vertical slots in the
             grille, the lamps set in the fender corners, the bumper with
             its shackles and winch. THE BED: a short cargo bed behind the
             cab with its tailgate, stowage, the jerry cans.
             THE SUSPENSION: TAK-4i, double A-arms and a coil-over at every
             wheel, half-shafts to each hub; 0.50 m of wheel travel, so each
             wheel follows the ground on its own (the rig's travel is real).
   THE CROWS  M153 Common Remotely Operated Weapon Station on the roof: the
             pedestal, the yoke, the M2 on the left of the cradle with its
             ready box, the sight head (day camera, thermal, laser) on the
             right, all elevating together; fired from inside the cab.
   PAINT     the side's nation and ground (units/kit/hull.js); the flag on
             both bed sides and the tailgate.
   CREW      driver and commander in front, the gunner behind the driver at
             the CROWS screen, one more behind the commander: four. Each man
             is drawn only while his seat is filled. The right rear door
             swings open when the passenger gets out.
   DRIVE     CBZ.vehicleDrive.wheeled. 8.6 t, 0-48 km/h in ~7 s, 108 km/h,
             0.75 g of grip: it corners like a truck that does not want to
             roll (low centre of gravity, wide track), unlike the MaxxPro.
   ARMOUR    stops rifle rounds and 7.62 AP all round, sniper and .50 ball
             from the front; the underbody is MRAP-class (armour.belly 200 mm
             against a ~160 mm IED): it lives through the buried charge a
             Humvee does not. An RPG goes through.
   WEAPON    M2HB .50 on the CROWS: stabilised, laid by thermal sight, fired
             from under armour; 9 rounds a second in bursts to 1,800 m.

   Units: metres, m/s, kg, armour in mm RHA equivalent per face. Nose +Z,
   +X is the vehicle's left (the driver's side).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.unitKit) return;
  const PI = Math.PI;

  // ---- the numbers -----------------------------------------------------------
  const L = 6.20, Wd = 2.49, ROOF = 2.20, HT = 2.95;
  const NOSE = 2.95, TAIL = -3.25;
  const AXF = 1.95, AXR = -1.63, TR = 1.03, R = 0.47, TW = 0.34, RIM = 0.215;
  // the cab: windscreen base, roof front, the cab's back; the section heights
  const CAB = { zf: 1.05, zr0: 0.58, zb: -1.10, keel: 0.58, flX: 0.62, flY: 0.66, belX: 1.13, belY: 0.98, winX: 1.17, winY: 1.40, roofX: 1.04, cowl: 1.64 };
  const BED = { z0: -1.14, z1: -3.20, y: 1.24, top: 1.62, hw: 1.16 };
  const CROWS = { z: -0.30, y: ROOF };
  const RDOOR = { z0: -0.25, z1: -1.08 };          // the right rear door's hinge (front edge) and back edge

  // the cab's cross-section at roof height `top` (convex, keel to roof)
  function cabSect(top) {
    const c = CAB;
    return [[0, c.keel], [c.flX, c.flY], [c.belX, c.belY], [c.winX, c.winY], [c.winX - 0.05, top - 0.10], [c.roofX, top], [-c.roofX, top], [-c.winX + 0.05, top - 0.10], [-c.winX, c.winY], [-c.belX, c.belY], [-c.flX, c.flY]];
  }

  /* ---- THE BODY: built once into shared geometry (one per material) -------- */
  function body() {
    const HK = CBZ.hullKit, G = HK.geo();
    // --- running gear: frame, TAK-4i double A-arms + coil-overs, half-shafts
    G.m("metal").c(0xb8b8b0);
    [-1, 1].forEach(function (s) { G.box(s * 0.44, 0.70, -0.20, 0.10, 0.18, 5.6); });           // frame rails
    [AXF, AXR].forEach(function (z) {
      G.box(0, 0.52, z, 0.62, 0.30, 0.46);                                                      // centre diff carrier
      [-1, 1].forEach(function (s) {
        G.cyl(s * 0.55, R, z, 0.04, 0.04, 0.70, "x", 6);                                        // half-shaft
        G.box(s * 0.62, 0.36, z + 0.08, 0.62, 0.06, 0.16, 0, 0, s * 0.10);                     // lower A-arm
        G.box(s * 0.64, 0.74, z - 0.06, 0.56, 0.06, 0.12, 0, 0, s * -0.14);                    // upper A-arm
        G.save().m("dark").c(1);
        G.cyl(s * 0.70, 0.74, z - 0.24, 0.06, 0.07, 0.56, "y", 10, 0, 0, s * 0.30);           // coil-over body
        G.restore();
        G.save().m("paint").c(0.6);
        for (let k = 0; k < 6; k++) G.cyl(s * (0.66 + k * 0.012), 0.56 + k * 0.06, z - 0.24, 0.085, 0.085, 0.02, "y", 10, 0, 0, s * 0.30);   // the coil
        G.restore();
        G.cyl(s * 0.86, R, z, 0.13, 0.13, 0.12, "x", 12);                                       // hub / upright
      });
    });
    G.cyl(0, 0.56, 0.16, 0.045, 0.045, 3.0, "z", 8);                                            // driveshaft
    G.save().m("dark").c(0x9a9a92);
    G.cyl(-0.66, 0.66, -0.4, 0.05, 0.05, 2.6, "z", 8);                                          // exhaust along the right rail
    G.cyl(-0.92, 0.70, -1.02, 0.055, 0.055, 0.50, "x", 8);                                      // out of the right side, ahead of the rear wheel
    G.restore();
    // --- THE CAB: the capsule with its V floor, and the raked windscreen wedge
    G.m("paint").c(1);
    G.sect([[CAB.zr0, cabSect(ROOF)], [CAB.zb, cabSect(ROOF - 0.02)]]);
    const wedge = function (top) {
      const c = CAB;
      return [[0, c.keel + 0.04], [c.flX, c.flY], [c.belX, c.belY], [c.winX, c.winY], [c.winX - 0.03, top - 0.06], [c.roofX + 0.02, top], [-c.roofX - 0.02, top], [-c.winX + 0.03, top - 0.06], [-c.winX, c.winY], [-c.belX, c.belY], [-c.flX, c.flY]];
    };
    G.sect([[CAB.zf, wedge(CAB.cowl)], [CAB.zr0, wedge(ROOF)]]);
    // the keel and the belt-line crease
    G.save().m("paint").c(0.84);
    G.box(0, CAB.keel + 0.02, -0.25, 0.10, 0.05, 2.20);
    [-1, 1].forEach(function (s) { G.box(s * (CAB.winX + 0.01), CAB.winY, -0.25, 0.04, 0.04, 2.34); });
    G.restore();
    // --- windscreen: two panes split by the centre pillar, in thick frames
    const ws = Math.atan2(CAB.zf - CAB.zr0, ROOF - CAB.cowl);
    G.save().tf(0, (ROOF + CAB.cowl) / 2, (CAB.zf + CAB.zr0) / 2 + 0.01, -ws, 0, 0);
    G.m("dark").c(1);
    [-1, 1].forEach(function (s) { G.box(s * 0.50, 0.0, 0.02, 0.90, Math.hypot(ROOF - CAB.cowl, CAB.zf - CAB.zr0) - 0.12, 0.03); });
    G.m("glass").c(1);
    [-1, 1].forEach(function (s) { G.box(s * 0.50, 0.0, 0.045, 0.82, Math.hypot(ROOF - CAB.cowl, CAB.zf - CAB.zr0) - 0.20, 0.03); });
    G.m("paint").c(0.9).box(0, 0, 0.04, 0.10, Math.hypot(ROOF - CAB.cowl, CAB.zf - CAB.zr0), 0.06);   // centre pillar
    G.m("black").c(1);
    [-1, 1].forEach(function (s) { G.box(s * 0.48, -0.22, 0.07, 0.02, 0.30, 0.02, 0, 0, s * 0.55); });
    G.restore();
    // --- the doors: seams, outside hinges, the thick windows, handles, steps
    G.save().m("black").c(1);
    [-1, 1].forEach(function (s) {
      const x = s * (CAB.winX + 0.005);
      [0.62, -0.25, -1.08].forEach(function (z) { G.box(x, 1.45, z, 0.012, 1.40, 0.018); });
      G.box(s * (CAB.belX + 0.02), CAB.belY - 0.02, -0.23, 0.012, 0.018, 1.70);
    });
    G.restore();
    const ra = Math.atan2(CAB.zf - CAB.zr0, ROOF - CAB.cowl);
    [-1, 1].forEach(function (s) {
      const x = s * CAB.winX;
      // the window frames, then the glass; the front pair raked at the A-pillar
      // (the right rear one is on its door, below)
      [[0.20, 0.66], [-0.66, 0.66]].forEach(function (wz, k) {
        if (k === 1 && s < 0) return;
        G.box(x + s * 0.025, 1.76, wz[0], 0.05, 0.56, wz[1] + 0.06);
        G.save().m("glass").c(1).box(x + s * 0.055, 1.77, wz[0], 0.02, 0.46, wz[1] - 0.06).restore();
      });
      // the A-pillar's small raked quarter light ahead of the front window
      G.save().m("glass").c(1).tf(x + s * 0.03, 1.74, 0.58, -ra, 0, 0).box(0, 0, 0, 0.02, 0.36, 0.06).restore();
      // outside hinges at each door's front edge
      G.save().m("dark").c(1);
      [0.60, -0.27].forEach(function (z) { [1.15, 1.70].forEach(function (y) { G.box(x + s * 0.03, y, z, 0.05, 0.12, 0.08); }); });
      // recessed handles, the door lock
      [0.0, -0.86].forEach(function (z) { G.box(x + s * 0.02, 1.32, z, 0.03, 0.05, 0.18); });
      G.restore();
      // the step under the doors and the rock rail
      G.save().m("dark").c(1).box(s * 1.08, 0.66, -0.24, 0.20, 0.05, 1.70).restore();
      G.save().m("amber").c(1).box(x + s * 0.01, 1.30, CAB.zb + 0.06, 0.02, 0.05, 0.08).restore();
    });
    // the doorway behind the right rear door (hidden by the door until it opens)
    G.save().m("black").c(1).box(-CAB.winX - 0.004, 1.72, (RDOOR.z0 + RDOOR.z1) / 2, 0.004, 0.62, RDOOR.z0 - RDOOR.z1 - 0.06).restore();
    // --- the roof: chamfered edge plate, the CROWS base plate, antennas
    G.box(0, ROOF + 0.015, -0.25, 1.90, 0.03, 1.60);
    G.save().m("black").c(1);
    [-1, 1].forEach(function (s) {
      G.cyl(s * 1.00, ROOF + 0.05, CAB.zb + 0.12, 0.035, 0.045, 0.10, "y", 8);
      let py = ROOF + 0.10, pz = CAB.zb + 0.12, a = 0;
      for (let i = 0; i < 5; i++) {
        a += 0.30;
        const l = 0.40, dy = Math.cos(a) * l, dz = Math.sin(a) * l;
        G.cyl(s * 1.00, py + dy / 2, pz + dz / 2, 0.006, 0.008, l, "y", 4, a, 0, 0);
        py += dy; pz += dz;
      }
    });
    G.restore();
    // --- THE HOOD: long, falling from the cowl to the high square nose. The
    // engine box between the front wheels, the wide hood shell over them
    G.m("paint").c(1);
    G.box(0, 1.08, (CAB.zf + 2.86) / 2 - 0.01, 1.44, 0.44, 2.86 - CAB.zf + 0.02);
    const hood = function (top, w) { return [[-w, 1.22], [w, 1.22], [w, top - 0.20], [w - 0.06, top - 0.06], [w - 0.22, top], [-w + 0.22, top], [-w + 0.06, top - 0.06], [-w, top - 0.20]]; };
    G.sect([[CAB.zf - 0.02, hood(CAB.cowl, 1.12)], [2.40, hood(1.54, 1.14)], [2.86, hood(1.47, 1.12)]]);
    // the fender flares stand proud over the front wheels, cut high for travel
    [-1, 1].forEach(function (s) {
      G.save().m("paint").c(0.9);
      G.sect([[1.30, [[s * 1.12, 1.22], [s * 1.26, 1.22], [s * 1.26, 1.32], [s * 1.14, 1.40]]], [2.62, [[s * 1.12, 1.22], [s * 1.26, 1.22], [s * 1.26, 1.30], [s * 1.14, 1.37]]]]);
      G.restore();
      G.save().m("black").c(1).box(s * 0.98, 1.21, AXF, 0.30, 0.02, 1.26).restore();          // wheel-well liner
      // the lamp pods in the fender corners, the turn signal under
      G.save().m("dark").c(1).box(s * 0.92, 1.30, 2.89, 0.34, 0.16, 0.08).restore();
      G.save().m("lamp").c(1).box(s * 0.92, 1.31, 2.935, 0.26, 0.09, 0.02).restore();
      G.save().m("amber").c(1).box(s * 0.92, 1.18, 2.92, 0.20, 0.04, 0.02).restore();
    });
    // the hood's crease lines and the louvred vent behind them
    G.save().m("paint").c(0.88);
    [-1, 1].forEach(function (s) { G.box(s * 0.60, 1.56, 1.95, 0.04, 0.03, 1.40, 0.06, 0, 0); });
    G.restore();
    G.save().m("black").c(1);
    for (let i = 0; i < 5; i++) G.box(0, 1.60 - i * 0.012, 1.40 + i * 0.08, 0.70, 0.015, 0.03);
    G.restore();
    // the face: a high black grille of vertical slots, the tow eyes, bumper + winch
    G.save().m("black").c(1).box(0, 1.08, 2.87, 1.30, 0.42, 0.03).restore();
    for (let i = 0; i < 11; i++) G.box(-0.55 + i * 0.11, 1.08, 2.885, 0.05, 0.42, 0.03);
    G.m("paint").c(0.85).box(0, 0.78, NOSE - 0.06, 2.20, 0.22, 0.16);
    G.save().m("dark").c(1);
    G.box(0, 0.80, NOSE + 0.02, 0.50, 0.16, 0.06);                                              // winch fairlead
    [-1, 1].forEach(function (s) { G.box(s * 0.70, 0.78, NOSE + 0.03, 0.10, 0.06, 0.08); G.cyl(s * 0.70, 0.78, NOSE + 0.08, 0.045, 0.045, 0.03, "x", 10); });
    G.restore();
    // mirrors on short arms at the A-pillars
    G.save().m("dark").c(1);
    [-1, 1].forEach(function (s) { G.box(s * 1.26, 1.80, 0.86, 0.20, 0.03, 0.03); G.box(s * 1.36, 1.84, 0.86, 0.05, 0.28, 0.18); });
    G.restore();
    // --- THE BED: floor, sides, the bulkhead behind the cab, stowage, tailgate frame
    G.m("paint").c(0.95);
    G.box(0, BED.y, (BED.z0 + BED.z1) / 2, 2 * BED.hw, 0.08, BED.z0 - BED.z1);                  // floor
    [-1, 1].forEach(function (s) {
      G.box(s * (BED.hw - 0.03), (BED.y + BED.top) / 2, (BED.z0 + BED.z1) / 2, 0.06, BED.top - BED.y, BED.z0 - BED.z1);   // sides
      G.box(s * (BED.hw - 0.03), BED.top + 0.02, (BED.z0 + BED.z1) / 2, 0.10, 0.04, BED.z0 - BED.z1);                     // top rail
      // the rear fender skirt over the wheel, cut high
      G.sect([[AXR + 0.70, [[s * 1.00, 1.22], [s * 1.25, 1.22], [s * 1.25, 1.28], [s * 1.00, 1.28]]], [AXR - 0.70, [[s * 1.00, 1.22], [s * 1.25, 1.22], [s * 1.25, 1.28], [s * 1.00, 1.28]]]]);
      G.save().m("tail").c(1).box(s * 0.98, 1.45, BED.z1 - 0.04, 0.12, 0.10, 0.02).restore();
      G.save().m("amber").c(1).box(s * 0.98, 1.34, BED.z1 - 0.04, 0.12, 0.05, 0.02).restore();
    });
    G.box(0, 1.00, BED.z1 + 0.05, 1.80, 0.40, 0.10);                                            // bed's rear sill under the gate
    G.save().m("dark").c(1).box(0, 0.80, BED.z1 - 0.06, 0.30, 0.14, 0.16).cyl(0, 0.80, BED.z1 - 0.16, 0.05, 0.05, 0.04, "y", 10).restore();  // pintle hitch
    // the tailgate (closed; the passenger uses his door)
    G.box(0, (BED.y + BED.top) / 2, BED.z1 - 0.01, 2 * BED.hw - 0.12, BED.top - BED.y, 0.05);
    G.save().m("black").c(1).box(0, BED.top - 0.06, BED.z1 - 0.04, 0.20, 0.03, 0.02).restore();
    // stowage in the bed: rucksacks, an ammo crate, jerry cans in their rack
    G.save().m("gear").c(1);
    G.sphere(0.55, BED.y + 0.22, -1.65, 0.28, 8, 1.0, 0.7, 1.2);
    G.sphere(-0.35, BED.y + 0.20, -2.05, 0.26, 8, 1.1, 0.7, 1.0);
    G.restore();
    G.save().m("paint").c(0.75).box(0.30, BED.y + 0.16, -2.60, 0.60, 0.26, 0.36).restore();
    G.save().m("paint").c(0.62);
    [-0.80, -0.55].forEach(function (x) { G.box(x, BED.y + 0.28, -2.85, 0.18, 0.48, 0.34); G.box(x, BED.y + 0.54, -2.78, 0.05, 0.04, 0.10); });
    G.restore();
    const geos = G.build({ uv: 2.6, mud: 0.95 });

    /* ---- THE RIGHT REAR DOOR, in door space: hinge line at its front edge
       (z 0), the door back to -z, outer face toward -x */
    const Dg = HK.geo();
    const dl = RDOOR.z0 - RDOOR.z1;
    Dg.m("paint").c(1);
    // the door skin follows the cab's section (door x: + is inboard): the
    // window band straight, the lower door leaning in to the belt, then in
    // along the floor's V to its bottom edge
    const lo = function (pts) { Dg.sect([[0, pts], [-dl, pts]]); };
    lo([[-0.03, CAB.winY], [0.0, CAB.winY], [CAB.winX - CAB.belX, CAB.belY], [CAB.winX - CAB.belX - 0.03, CAB.belY]]);
    lo([[CAB.winX - CAB.belX - 0.03, CAB.belY], [CAB.winX - CAB.belX, CAB.belY], [0.34, 0.80], [0.31, 0.78]]);
    Dg.box(-0.015, (CAB.winY + ROOF - 0.12) / 2, -dl / 2, 0.03, ROOF - 0.12 - CAB.winY, dl);
    Dg.box(-0.04, 1.76, -dl / 2, 0.05, 0.56, 0.72);
    Dg.m("glass").c(1).box(-0.07, 1.77, -dl / 2, 0.02, 0.46, 0.60);
    Dg.m("dark").c(1);
    [1.15, 1.70].forEach(function (y) { Dg.box(-0.03, y, -0.02, 0.05, 0.12, 0.08); });
    Dg.box(-0.035, 1.32, -dl + 0.18, 0.03, 0.05, 0.18);
    const dGeos = Dg.build({ uv: 2.6, mud: 0.95 });

    /* ---- THE CROWS (turret space: origin on the roof at the pedestal's
       foot), then the elevating cradle (gun space: the trunnion) */
    const Tg = HK.geo();
    Tg.m("paint").c(0.9);
    Tg.cyl(0, 0.05, 0, 0.34, 0.36, 0.10, "y", 20);                                              // the base ring
    Tg.box(0, 0.22, 0, 0.42, 0.26, 0.48);                                                       // the azimuth drive housing
    Tg.m("dark").c(1);
    [-1, 1].forEach(function (s) { Tg.box(s * 0.30, 0.42, 0.04, 0.06, 0.34, 0.20); });         // the yoke arms
    Tg.box(0, 0.30, -0.26, 0.30, 0.10, 0.06);
    const tGeos = Tg.build({ uv: 2.6, mud: 0 });
    // the cradle: the gun on the left, its ready box, the sight head on the right
    const Cg = HK.geo();
    Cg.m("paint").c(0.85);
    Cg.box(0, 0, 0.04, 0.54, 0.08, 0.30);                                                       // cross beam
    Cg.box(0.17, -0.06, -0.10, 0.20, 0.10, 0.60);                                               // the gun's cradle rail
    Cg.box(0.36, -0.08, -0.08, 0.16, 0.26, 0.36);                                               // ready box (400 rds)
    Cg.m("dark").c(1);
    Cg.box(0.27, 0.02, -0.06, 0.04, 0.05, 0.20);                                                // the feed chute
    Cg.m("paint").c(0.8);
    Cg.box(-0.22, 0.06, 0.08, 0.24, 0.24, 0.42);                                                // sight head
    Cg.m("glass").c(1);
    Cg.cyl(-0.27, 0.10, 0.30, 0.05, 0.05, 0.02, "z", 14);                                        // day camera
    Cg.cyl(-0.17, 0.10, 0.30, 0.055, 0.055, 0.02, "z", 14);                                      // thermal
    Cg.m("black").c(1);
    Cg.cyl(-0.22, -0.02, 0.30, 0.03, 0.03, 0.02, "z", 10);                                       // laser range finder
    Cg.box(-0.22, 0.06, 0.30, 0.26, 0.02, 0.03);
    const cGeos = Cg.build({ uv: 2.6, mud: 0 });
    const Gg = HK.geo();
    HK.m2(Gg);
    const gGeos = Gg.build({ uv: 2.6, mud: 0 });

    // wheels: the 37-inch tyre and the beadlock rim (the bolted outer ring)
    const Wg = HK.geo();
    HK.tyre(Wg, R, TW, RIM, { lug: "ndt", lugs: 22, dep: 0.028 });
    const tyreGeo = Wg.build({ uv: 1, mud: 0 }).rubber;
    const Rg = HK.geo();
    Rg.m("paint").c(0.82);
    Rg.cyl(TW * 0.34, 0, 0, RIM, RIM, 0.05, "x", 22);
    Rg.cyl(TW * 0.40, 0, 0, RIM * 1.04, RIM * 1.04, 0.03, "x", 22, 0, 0, 0, { open: false });   // the beadlock ring
    Rg.cyl(TW * 0.38, 0, 0, RIM * 0.62, RIM * 0.70, 0.05, "x", 16);
    Rg.m("dark").c(1);
    for (let i = 0; i < 20; i++) { const a = i * PI / 10; Rg.cyl(TW * 0.42, Math.cos(a) * RIM * 0.95, Math.sin(a) * RIM * 0.95, 0.011, 0.011, 0.025, "x", 6); }
    for (let i = 0; i < 8; i++) { const a = i * PI / 4; Rg.cyl(TW * 0.42, Math.cos(a) * RIM * 0.42, Math.sin(a) * RIM * 0.42, 0.014, 0.014, 0.03, "x", 6); }
    Rg.cyl(TW * 0.44, 0, 0, 0.07, 0.08, 0.06, "x", 12);                                          // CTIS hub
    Rg.m("paint").c(0.7).cyl(-TW * 0.34, 0, 0, RIM, RIM, 0.04, "x", 16);
    const rimGeos = Rg.build({ uv: 1, mud: 0 });
    return { geos: geos, dGeos: dGeos, tGeos: tGeos, cGeos: cGeos, gGeos: gGeos, tyreGeo: tyreGeo, rimGeos: rimGeos, decals: {} };
  }

  function build(ctx) {
    const THREE = window.THREE, HK = CBZ.hullKit;
    if (!THREE || !HK) return null;
    const B = HK.cache("jltv", body);
    const side = ctx.side || ctx.team || null, ground = ctx.ground || ctx.arena;
    const sc = HK.scheme(ctx.nation, ground, side);
    const M = HK.mats(sc);
    const root = new THREE.Group(); root.name = "jltv";
    const bodyG = new THREE.Group(); bodyG.name = "body"; root.add(bodyG);
    HK.meshes(bodyG, B.geos, M, "hull");
    // the right rear door on its hinge (its outer face at the window band)
    const door = new THREE.Group(); door.name = "reardoor"; door.position.set(-CAB.winX, 0, RDOOR.z0); door.rotation.y = 0; bodyG.add(door);
    HK.meshes(door, B.dGeos, M, "door");
    // the CROWS: traverses on the roof; the cradle (gun + sight) elevates
    const turret = new THREE.Group(); turret.name = "turret"; turret.position.set(0, CROWS.y, CROWS.z); bodyG.add(turret);
    HK.meshes(turret, B.tGeos, M, "crows");
    const gun = new THREE.Group(); gun.name = "gun"; gun.position.set(0, 0.48, 0.04); turret.add(gun);
    HK.meshes(gun, B.cGeos, M, "cradle");
    const tube = new THREE.Group(); tube.name = "tube"; tube.position.set(0.17, 0.0, -0.08); gun.add(tube);
    HK.meshes(tube, B.gGeos, M, "m2");
    const muzzle = new THREE.Object3D(); muzzle.name = "muzzle"; muzzle.position.set(0, 0.03, 1.46); tube.add(muzzle);
    // the four, each drawn only while his seat is filled
    const seed = (ctx.seed | 0) >>> 0;
    const fig = function (kind, k) { return HK.figMesh(kind, sc, (seed + k) % 4, M); };
    const driver = fig("seated", 0); driver.position.set(0.52, 1.16, 0.22); bodyG.add(driver);
    const tc = fig("seated", 1); tc.position.set(-0.52, 1.16, 0.22); bodyG.add(tc);
    const gunner = fig("seated", 2); gunner.position.set(0.52, 1.16, -0.70); bodyG.add(gunner);
    const pax = fig("seated", 3); pax.position.set(-0.52, 1.16, -0.70); bodyG.add(pax);
    const wheels = [
      { x: TR, y: R, z: AXF, r: R, steer: 1 }, { x: -TR, y: R, z: AXF, r: R, steer: 1 },
      { x: TR, y: R, z: AXR, r: R, steer: 0 }, { x: -TR, y: R, z: AXR, r: R, steer: 0 },
    ];
    const WS = HK.wheelSet(root, B.tyreGeo, B.rimGeos, M, 4, [-TR - TW, 0, AXR - R, TR + TW, 2 * R, AXF + R]);
    const rig = new HK.WheeledRig({
      root: root, body: bodyG, wheels: wheels, tyreIM: WS.tyreIM, rimIMs: WS.rimIMs, wheelbase: AXF - AXR, track: 2 * TR,
      // TAK-4i: 0.50 m of wheel travel, a stiff, flat-cornering body
      travel: [0.25, 0.25], turret: turret, gun: gun, tube: tube, muzzle: muzzle,
      tcfg: { rate: 1.05, elevRate: 1.0, elevMin: -0.35, elevMax: 1.05 },
      figs: { driver: driver, commander: tc, gunner: gunner, passenger: [pax] },
      tailgate: { obj: door, open: 1.15, axis: "y", rate: 2.5 },
      exhaust: { p: [-1.18, 0.70, -1.02], d: [-1, -0.1, 0], soot: 0.3 },
      engine: [0, 1.25, 2.0], cabin: [0, 1.5, -0.25], ground: ground, side: side, seed: seed,
      pitchK: 0.006, rollK: 0.0035, pitchMax: 0.045, rollMax: 0.05,
      // the nation's flag on both rear doors and the tailgate
      decal: { parent: bodyG, cache: B.decals, list: [[BED.hw + 0.004, 1.43, -2.40, 1, 0, 0.30], [-BED.hw - 0.004, 1.43, -2.40, -1, 0, 0.30],
        [0.62, 1.43, BED.z1 - 0.04, 0, -1, 0.26]] },
    });
    rig.mark(ctx.nation, ground, side);
    return { group: root, rig: rig, footW: Wd, footL: L, height: HT };
  }

  CBZ.unitKit.register("jltv", {
    kind: "vehicle",
    domain: "ground",
    drive: "wheeled",
    // 8.6 t combat weight (M1278 with its armour kit), 0.75 g of grip
    stats: { hp: 380, mass: 8600, speed: 30, reverse: 7, accel: 2.4, turn: 0.85, wheelbase: AXF - AXR, maxSteer: 0.46, grip: 0.75,
      length: L, width: Wd, height: HT,
      // rifle rounds stop all round; the floor is MRAP-class (armour.belly)
      armour: { front: 22, side: 16, rear: 14, top: 9, belly: 200 },
      standoff: 420, dismountAt: 500 },
    turret: { rate: 1.05, elevRate: 1.0, elevMin: -0.35, elevMax: 1.05 },
    // seat positions in hull space: the crew-casualty line is measured to these
    crew: [{ seat: "driver", pos: [0.52, 1.70, 0.22] }, { seat: "gunner", pos: [0.52, 1.70, -0.70] }, { seat: "commander", pos: [-0.52, 1.70, 0.22] }],
    passengers: 1,
    passengerPos: [[-0.52, 1.70, -0.70]],
    weapons: [
      // M2HB on the CROWS: stabilised, laid by its own sight, fired from inside
      { id: "m2_50cal_crows", seat: "gunner", kind: "mg", wid: "lmg", turret: true, rof: 9, burst: 8, pause: 1.0, dmg: 38, pen: 24, range: 1800, ammo: 1200 },
    ],
    /* TACTICS (src/battle/vehicles.js reads standoff and dismountAt; the rest
       is the interface the AI layer reads). A scout and gun truck that can
       take a hit: CONVOY it is the security vehicle, out front or at the
       tail, 80 m from the next truck, and on contact it turns into the fire
       and suppresses with the CROWS while the column drives through (it can
       fire on the move; the M2 is stabilised and the gunner is under
       armour). PATROL it moves fast and bounds between covered spots, the
       CROWS scanning by thermal, its one rifleman out at the halt. It keeps
       well off anything with real armour. */
    tactics: {
      role: "scout gun truck",
      engage: { soft: 1600, armour: 0, close: 18 },
      priorities: ["launcher", "mg", "men", "vehicle", "beast"],
      keepFrom: { men: 380, launcher: 450, armour: 1500 },
      hullDown: true, faceThreat: true, reverseOut: true, avoidArmour: true, fireOnMove: true,
      convoy: { slot: "lead-or-trail", gap: 80, speed: 20, contact: "turn-into-fire", suppress: true },
      patrol: { speed: 10, bound: 300, overwatch: 400, dismount: "at-halt" },
      dismount: { at: 500, door: "right-rear" },
      screen: { need: "men", behind: 40 },
      withdrawAt: 0.35,
    },
    animate: function (veh, dt, c) { if (CBZ.hullKit) CBZ.hullKit.animate(veh, dt, c); else if (c && c.shared) c.shared(dt); },
    build: build,
  });
})();
