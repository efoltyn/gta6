/* ============================================================
   units/vehicles/maxxpro_mrap.js — NAVISTAR MaxxPro MRAP (Category I/II,
   USA), with the O-GPK gunner's turret and an M2 .50.

   The Mine-Resistant Ambush-Protected truck that replaced the up-armoured
   Humvee on the roads of Iraq and Afghanistan from 2007: a V-shaped steel
   crew capsule bolted onto a Navistar 7000-series truck chassis, built to
   live through the IED under it and the rifle fire round it.

   THE BODY  6.45 m long, 2.59 m wide over the capsule, 2.95 m to the roof,
             3.84 m over the gunner's shield. 3.94 m wheelbase, 2.10 m track,
             0.40 m under the axles. 395/85R20 tyres (1.16 m) on run-flat
             steel rims. THE CAPSULE: a V hull (keel 0.85 m, chines 1.30 m),
             flat ledges over the wheels, vertical armoured sides, tumblehome
             to the roof; two big ballistic windscreen panes in a thick frame
             on a 12 degree rake; the heavy crew doors with their external
             hinges, thick proud windows and grab handles; two small windows
             a side in the troop compartment, each over its gun port; the
             rear door on its right-hand hinge with its own window, and the
             fold-down step under it; roof hatch, the A/C unit, antennas,
             grab rails. THE TRUCK: the short square hood over the MaxxForce
             diesel, the black grille, the brush guard with the lamps in it,
             bumper, shackles, flared front fenders; frame rails, beam axles
             on leaf springs, the differentials, the driveshaft, the exhaust
             out of the right side; steps up to the crew doors; mirrors on
             their long arms.
   THE TURRET  The kit's O-GPK (the Humvee's) on the roof ring, an M2 on its
             cradle, the gunner standing on his platform inside.
   PAINT     the side's nation and ground (units/kit/hull.js), the flag on
             both troop-compartment flanks and the rear wall.
   CREW      driver and commander up front, the gunner in the ring, six
             riflemen on two benches facing in behind them. Each man drawn
             only while his seat is filled. The rear door swings open when
             they get out (and stands open on a wreck: that is how the
             survivors left).
   DRIVE     CBZ.vehicleDrive.wheeled. 16.8 t on a truck chassis: slow off
             the line (0-50 km/h ~13 s), 86 km/h flat out, a 16 m turning
             circle. TOP-HEAVY: the static stability factor is ~1.0 and a
             loaded MaxxPro tips at about half a g sideways, which is what
             killed crews in canals and on wadi banks. So stats.grip is the
             ROLLOVER limit (0.42 g), not the tyres': the driver slows for
             every tight corner because the truck would go over, and on its
             soft springs the body heels twice as far as a Humvee's
             (rollK, rollMax).
   ARMOUR    rifle rounds stop on every face, 7.62 AP and a sniper's
             full-power rounds included (a .50 AP gets through the sides
             now and then; an RPG goes through anything without its net). THE BELLY: the V deflects the blast
             of a buried charge (armour.belly 260 mm against a ~160 mm IED,
             src/battle/vehicles.js puts a blast under the hull on the
             belly): it may lose a wheel, the crew lives. Damage states from
             the kit: engine smoke, fire, a shot-out tyre, the gun hung, the
             burnt-out wreck on its rims with the shield thrown askew.
   WEAPON    M2HB .50 BMG on the O-GPK ring: 450-600 rds/min in bursts,
             1,800 m.

   Units: metres, m/s, kg, armour in mm RHA equivalent per face. Nose +Z,
   +X is the vehicle's left (the driver's side).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.unitKit) return;
  const PI = Math.PI;

  // ---- the numbers -----------------------------------------------------------
  const L = 6.45, Wd = 2.59, ROOF = 2.95, HT = 3.84;
  const NOSE = 3.22, TAIL = -3.23;
  const AXF = 2.10, AXR = -1.84, TR = 1.05, R = 0.58, TW = 0.40, RIM = 0.27;
  // the capsule: keel, chine, side, roof (half widths) and its ends
  const CAP = { zf: 1.58, zw: 1.36, zr: -3.05, keel: 0.86, chX: 1.10, chY: 1.30, hw: 1.295, sideTop: 2.42, roofHW: 1.17, cowl: 2.06 };
  const RING = { z: -0.55, y: ROOF + 0.04 };
  const DOOR = { x: -0.50, w: 1.00, y0: 1.40, y1: 2.68, z: CAP.zr };
  // the six riflemen: two benches of three facing in
  const BENCH = [];
  for (let i = 0; i < 6; i++) { const s = i % 2 ? -1 : 1; BENCH.push([s * 0.80, 1.74, -0.80 - Math.floor(i / 2) * 0.68]); }

  function capSect(top, sideTop) {
    const c = CAP;
    return [[0, c.keel], [c.chX, c.chY], [c.hw, c.chY + 0.12], [c.hw, sideTop], [c.roofHW, top], [-c.roofHW, top], [-c.hw, sideTop], [-c.hw, c.chY + 0.12], [-c.chX, c.chY]];
  }

  /* ---- THE BODY: built once into shared geometry (one per material) -------- */
  function body() {
    const HK = CBZ.hullKit, G = HK.geo();
    // --- the truck under it: frame rails, beam axles on leaf springs, diffs
    G.m("metal").c(0xb4b4ac);
    [-1, 1].forEach(function (s) { G.box(s * 0.46, 0.82, -0.05, 0.12, 0.26, 6.10); });           // frame rails
    [AXF, AXR].forEach(function (z) {
      G.cyl(0, R, z, 0.075, 0.075, 1.86, "x", 10);                                              // the beam axle
      G.sphere(0, R, z, 0.24, 10, 1.0, 0.9, 0.95);                                              // differential
      G.save().m("dark").c(1);
      [-1, 1].forEach(function (s) {
        // leaf spring pack: stacked leaves, the hangers and shackles at the ends
        for (let k = 0; k < 4; k++) G.box(s * 0.62, R + 0.12 + k * 0.035, z, 0.09, 0.03, 1.30 - k * 0.22);
        G.box(s * 0.62, R + 0.30, z + 0.66, 0.10, 0.20, 0.08); G.box(s * 0.62, R + 0.30, z - 0.66, 0.10, 0.20, 0.08);
        G.cyl(s * 0.72, R + 0.22, z - 0.20, 0.045, 0.05, 0.45, "y", 8, 0, 0, s * 0.25);        // shock
        G.cyl(s * 0.86, R, z, 0.16, 0.16, 0.12, "x", 12);                                       // hub
      });
      G.restore();
    });
    G.cyl(0, 0.70, 0.12, 0.05, 0.05, 3.6, "z", 8);                                              // driveshaft
    G.save().m("dark").c(0x9a9a92);
    G.cyl(-0.78, 0.92, 1.0, 0.06, 0.06, 1.2, "z", 8);                                           // exhaust run
    G.cyl(-1.16, 0.98, 1.30, 0.07, 0.07, 0.30, "x", 8);                                         // out of the right side
    G.restore();
    // --- THE CAPSULE: the V hull, one piece, cab to rear wall
    G.m("paint").c(1);
    G.sect([[CAP.zw, capSect(ROOF, CAP.sideTop)], [CAP.zr, capSect(ROOF, CAP.sideTop)]]);
    // the windscreen wedge: the capsule's roof falls to the cowl at the front
    const wedge = function (top) {
      const c = CAP, st = Math.min(c.sideTop, top - 0.02);
      return [[0, c.keel + 0.04], [c.chX, c.chY], [c.hw, c.chY + 0.12], [c.hw, st], [c.roofHW, top], [-c.roofHW, top], [-c.hw, st], [-c.hw, c.chY + 0.12], [-c.chX, c.chY]];
    };
    G.sect([[CAP.zf, wedge(CAP.cowl)], [CAP.zw, wedge(ROOF)]]);
    // the keel strake and the chine angles welded along the V
    G.save().m("paint").c(0.82);
    G.box(0, CAP.keel + 0.02, -0.75, 0.10, 0.06, 4.6);
    [-1, 1].forEach(function (s) { G.box(s * CAP.chX, CAP.chY + 0.01, -0.75, 0.06, 0.06, 4.6); });
    G.restore();
    // rub ledge over the wheels, roof gutter
    [-1, 1].forEach(function (s) {
      G.box(s * (CAP.hw + 0.03), CAP.chY + 0.14, -0.74, 0.07, 0.05, 4.62);
      G.box(s * (CAP.roofHW + 0.02), ROOF + 0.02, -0.74, 0.04, 0.05, 4.4);
    });
    // --- windscreen: two thick panes in a heavy frame on the raked face
    const ws = Math.atan2(CAP.zf - CAP.zw, ROOF - CAP.cowl);
    const wy = (ROOF + CAP.cowl) / 2, wz = (CAP.zf + CAP.zw) / 2;
    G.save().tf(0, wy, wz, -ws, 0, 0);
    G.m("paint").c(0.88);
    G.box(0, 0, 0.03, 2.30, 0.80, 0.08);                                                        // the frame plate
    G.m("dark").c(1);
    [-1, 1].forEach(function (s) { G.box(s * 0.56, 0.02, 0.075, 0.98, 0.66, 0.03); });          // the glass seats
    G.m("glass").c(1);
    [-1, 1].forEach(function (s) { G.box(s * 0.56, 0.02, 0.10, 0.90, 0.58, 0.04); });           // ~90 mm of glass
    G.m("black").c(1);
    [-1, 1].forEach(function (s) { G.box(s * 0.50, -0.20, 0.13, 0.02, 0.36, 0.02, 0, 0, s * 0.5); });  // wipers
    G.restore();
    // --- the crew doors: seams, external hinges, proud windows, handles
    G.save().m("black").c(1);
    [-1, 1].forEach(function (s) {
      const x = s * (CAP.hw + 0.005);
      [CAP.zw - 0.02, 0.32].forEach(function (z) { G.box(x, 2.02, z, 0.012, 1.30, 0.018); });
      G.box(x, 1.38, 0.84, 0.012, 0.018, 1.04); G.box(x, 2.66, 0.84, 0.012, 0.018, 1.04);
    });
    G.restore();
    [-1, 1].forEach(function (s) {
      const x = s * CAP.hw;
      // three heavy hinges on the front edge
      G.save().m("dark").c(1);
      [1.55, 2.02, 2.50].forEach(function (y) { G.box(x + s * 0.03, y, CAP.zw - 0.06, 0.06, 0.16, 0.12); G.cyl(x + s * 0.06, y, CAP.zw - 0.06, 0.03, 0.03, 0.20, "y", 8); });
      // grab handle and the latch
      G.box(x + s * 0.04, 1.86, 0.48, 0.03, 0.04, 0.24); G.box(x + s * 0.025, 1.98, 0.42, 0.03, 0.08, 0.06);
      G.restore();
      // the door window: a frame proud of the door, the thick glass in it
      G.box(x + s * 0.035, 2.25, 0.86, 0.07, 0.62, 0.72);
      G.save().m("glass").c(1).box(x + s * 0.075, 2.26, 0.86, 0.02, 0.50, 0.60).restore();
      // the troop compartment: two small windows a side, a gun port under each
      [-1.05, -2.15].forEach(function (z) {
        G.box(x + s * 0.03, 2.28, z, 0.06, 0.46, 0.46);
        G.save().m("glass").c(1).box(x + s * 0.065, 2.29, z, 0.02, 0.34, 0.34).restore();
        G.save().m("dark").c(1).cyl(x + s * 0.03, 1.88, z, 0.075, 0.075, 0.04, "x", 12).box(x + s * 0.05, 1.88, z, 0.02, 0.05, 0.16).restore();
      });
      // side marker lamps, a fire-extinguisher pull, the stowage box under the ledge
      G.save().m("amber").c(1).box(x + s * 0.01, 1.50, CAP.zr + 0.10, 0.02, 0.05, 0.08).box(x + s * 0.01, 1.50, CAP.zw - 0.20, 0.02, 0.05, 0.08).restore();
      G.box(s * 1.12, 1.05, -0.45, 0.28, 0.34, 0.95);                                         // stowage / battery box
      G.save().m("black").c(1).box(s * 1.265, 1.05, -0.45, 0.01, 0.30, 0.02).box(s * 1.265, 1.17, -0.45, 0.01, 0.02, 0.9).restore();
      // two steps up to the crew door
      G.save().m("dark").c(1);
      G.box(s * 1.22, 0.98, 0.86, 0.22, 0.04, 0.50); G.box(s * 1.24, 0.66, 0.86, 0.20, 0.04, 0.48);
      G.box(s * 1.32, 0.82, 0.62, 0.03, 0.40, 0.03); G.box(s * 1.32, 0.82, 1.10, 0.03, 0.40, 0.03);
      G.restore();
    });
    // --- the rear wall: the door frame, the step under the door, lamps, the hitch
    G.save().m("dark").c(1);
    G.box(0, (DOOR.y0 + DOOR.y1) / 2, CAP.zr - 0.01, DOOR.w + 0.10, DOOR.y1 - DOOR.y0 + 0.10, 0.02);
    // fold-down ladder: two treads on their hangers
    [-1, 1].forEach(function (s) { G.box(s * 0.36, 1.00, CAP.zr - 0.22, 0.04, 0.70, 0.04, 0.32, 0, 0); });
    G.box(0, 1.18, CAP.zr - 0.16, 0.76, 0.04, 0.20); G.box(0, 0.86, CAP.zr - 0.28, 0.76, 0.04, 0.20);
    G.box(0, 0.72, CAP.zr - 0.20, 0.30, 0.16, 0.20); G.cyl(0, 0.72, CAP.zr - 0.33, 0.06, 0.06, 0.05, "y", 10);   // pintle hitch
    G.restore();
    [-1, 1].forEach(function (s) {
      G.box(s * 0.95, 1.55, CAP.zr - 0.03, 0.30, 0.26, 0.06);                                    // lamp guard
      G.save().m("tail").c(1).box(s * 0.95, 1.60, CAP.zr - 0.065, 0.20, 0.08, 0.02).restore();
      G.save().m("amber").c(1).box(s * 0.95, 1.50, CAP.zr - 0.065, 0.20, 0.06, 0.02).restore();
      G.save().m("dark").c(1).box(s * 0.95, 0.95, CAP.zr - 0.05, 0.40, 0.14, 0.12).restore();    // rear bumperette
    });
    // --- the roof: ring collar, rear hatch, A/C unit, grab rails, antennas
    G.cyl(0, ROOF + 0.02, RING.z, 0.74, 0.76, 0.05, "y", 28);
    // (everything on the roof stays outside the O-GPK's swing, ~1 m round the ring)
    G.box(0.45, ROOF + 0.03, -2.35, 0.76, 0.05, 0.76);                                          // escape hatch
    G.save().m("dark").c(1).box(0.72, ROOF + 0.07, -2.35, 0.08, 0.04, 0.20).box(0.18, ROOF + 0.07, -2.35, 0.08, 0.04, 0.20).restore();
    G.box(-0.62, ROOF + 0.19, -2.05, 0.62, 0.34, 0.78);                                         // A/C unit
    G.save().m("black").c(1);
    for (let i = 0; i < 6; i++) G.box(-0.62, ROOF + 0.07 + i * 0.045, -1.655, 0.52, 0.025, 0.01);
    G.restore();
    G.save().m("dark").c(1);
    [-1, 1].forEach(function (s) {
      [-1.25, -1.95, -2.65].forEach(function (z) { G.cyl(s * 1.06, ROOF + 0.06, z, 0.02, 0.02, 0.12, "y", 6); });
      G.cyl(s * 1.06, ROOF + 0.12, -1.95, 0.02, 0.02, 1.44, "z", 6);
    });
    G.restore();
    G.save().m("black").c(1);
    [-1, 1].forEach(function (s) {
      G.cyl(s * 1.10, ROOF + 0.08, -2.85, 0.04, 0.05, 0.14, "y", 8);
      let py = ROOF + 0.15, pz = -2.85, a = 0;
      for (let i = 0; i < 6; i++) {
        a += 0.27;
        const l = 0.42, dy = Math.cos(a) * l, dz = Math.sin(a) * l;
        G.cyl(s * 1.10, py + dy / 2, pz + dz / 2, 0.006, 0.008, l, "y", 4, a, 0, 0);
        py += dy; pz += dz;
      }
    });
    G.restore();
    // --- THE HOOD: square, over the diesel, narrower than the fenders (the
    // front wheels steer either side of it); flared fenders over the wheels
    G.m("paint").c(1);
    const hood = function (top, w) { return [[-w, 0.95], [w, 0.95], [w, top - 0.08], [w - 0.10, top], [-w + 0.10, top], [-w, top - 0.08]]; };
    G.sect([[CAP.zf - 0.02, hood(CAP.cowl - 0.02, 0.82)], [2.90, hood(1.98, 0.82)], [3.08, hood(1.90, 0.80)]]);
    G.box(0, CAP.cowl - 0.01, 2.30, 1.30, 0.03, 1.20);                                          // hood centre panel
    G.save().m("black").c(1).box(0.42, 1.99, 2.55, 0.30, 0.02, 0.40).restore();                 // intake grille on top
    [-1, 1].forEach(function (s) {
      const fen = function (top) { return [[s * 0.96, 1.30], [s * 1.33, 1.30], [s * 1.33, top - 0.05], [s * 1.28, top], [s * 0.96, top + 0.02]]; };
      G.sect([[1.50, fen(1.62)], [2.75, fen(1.58)], [3.02, fen(1.50)]]);
      G.box(s * 1.31, 1.20, 1.62, 0.06, 0.24, 0.16);                                           // the fender's flap behind the wheel
      G.save().m("black").c(1).box(s * 1.14, 1.29, 2.26, 0.34, 0.02, 1.40).restore();         // wheel-well liner
      G.save().m("amber").c(1).box(s * 1.20, 1.64, 2.92, 0.12, 0.05, 0.08).restore();
      G.save().m("black").c(1).box(s * 0.83, 1.72, 1.80, 0.05, 0.16, 0.04).box(s * 0.83, 1.72, 2.70, 0.05, 0.16, 0.04).restore();  // hood latches
    });
    // the grille: the black recess and its bars
    G.save().m("black").c(1).box(0, 1.42, 3.09, 1.60, 0.82, 0.03).restore();
    for (let i = 0; i < 13; i++) G.box(-0.72 + i * 0.12, 1.42, 3.105, 0.035, 0.82, 0.03);
    G.box(0, 1.86, 3.10, 1.70, 0.06, 0.04);
    // brush guard: uprights, cross bars, lamp cages with the lamps in them
    G.save().m("dark").c(1);
    [-0.86, -0.30, 0.30, 0.86].forEach(function (x) { G.box(x, 1.30, NOSE - 0.04, 0.07, 1.00, 0.07); });
    [0.95, 1.55, 1.78].forEach(function (y) { G.box(0, y, NOSE - 0.04, 1.86, 0.06, 0.07); });
    [-1, 1].forEach(function (s) {
      G.box(s * 0.92, 1.62, NOSE - 0.12, 0.34, 0.30, 0.18);
      G.save().m("lamp").c(1).box(s * 0.92, 1.64, NOSE - 0.02, 0.24, 0.18, 0.02).restore();
      G.save().m("amber").c(1).box(s * 0.92, 1.49, NOSE - 0.02, 0.24, 0.05, 0.02).restore();
    });
    G.restore();
    // bumper, shackles, the winch fairlead
    G.m("paint").c(0.85).box(0, 0.86, NOSE - 0.14, 2.30, 0.24, 0.20);
    G.save().m("dark").c(1);
    [-1, 1].forEach(function (s) { G.box(s * 0.62, 0.86, NOSE - 0.01, 0.12, 0.06, 0.08); G.cyl(s * 0.62, 0.86, NOSE + 0.04, 0.05, 0.05, 0.03, "x", 10); });
    G.box(0, 0.86, NOSE - 0.02, 0.36, 0.12, 0.06);
    G.restore();
    // --- mirrors on their long arms off the front corners
    G.save().m("dark").c(1);
    [-1, 1].forEach(function (s) {
      G.box(s * 1.42, 2.40, CAP.zw - 0.06, 0.30, 0.04, 0.04);
      G.box(s * 1.56, 2.30, CAP.zw - 0.06, 0.04, 0.24, 0.04);
      G.box(s * 1.58, 2.24, CAP.zw - 0.06, 0.06, 0.36, 0.24);
    });
    G.restore();
    const geos = G.build({ uv: 2.6, mud: 1.10 });

    /* ---- THE REAR DOOR, in door space: hinge line at x 0 (the vehicle's
       right), the door out to +x, its outer face toward -z */
    const Dg = HK.geo();
    Dg.m("paint").c(0.96);
    Dg.box(DOOR.w / 2, (DOOR.y0 + DOOR.y1) / 2, -0.05, DOOR.w, DOOR.y1 - DOOR.y0, 0.09);
    Dg.box(DOOR.w / 2, 2.30, -0.12, 0.46, 0.44, 0.05);                                          // window frame
    Dg.m("glass").c(1).box(DOOR.w / 2, 2.30, -0.145, 0.34, 0.32, 0.02);
    Dg.m("dark").c(1);
    [1.62, 2.05, 2.48].forEach(function (y) { Dg.box(0.03, y, -0.12, 0.10, 0.14, 0.06); Dg.cyl(-0.01, y, -0.15, 0.03, 0.03, 0.20, "y", 8); });
    Dg.box(DOOR.w - 0.12, 1.92, -0.12, 0.05, 0.22, 0.04);                                       // handle
    Dg.box(DOOR.w - 0.12, 1.80, -0.11, 0.10, 0.04, 0.04);
    Dg.cyl(DOOR.w / 2, 1.70, -0.11, 0.07, 0.07, 0.03, "z", 12);                                 // gun port
    const dGeos = Dg.build({ uv: 2.6, mud: 1.10 });

    /* ---- THE TURRET (the kit's O-GPK) + THE M2 */
    const Tg = HK.geo();
    HK.ogpk(Tg, 0.92);
    const tGeos = Tg.build({ uv: 2.6, mud: 0 });
    const Gg = HK.geo();
    HK.m2(Gg);
    const gGeos = Gg.build({ uv: 2.6, mud: 0 });

    // wheels: the 395/85R20 and its steel run-flat rim, eight-stud hub
    const Wg = HK.geo();
    HK.tyre(Wg, R, TW, RIM, { lug: "xtr", lugs: 22, dep: 0.03 });
    const tyreGeo = Wg.build({ uv: 1, mud: 0 }).rubber;
    const Rg = HK.geo();
    Rg.m("paint").c(0.85);
    Rg.cyl(TW * 0.30, 0, 0, RIM, RIM, 0.05, "x", 22);
    Rg.cyl(TW * 0.36, 0, 0, RIM * 0.60, RIM * 0.72, 0.06, "x", 18);
    Rg.m("dark").c(1);
    for (let i = 0; i < 10; i++) { const a = i * PI / 5; Rg.cyl(TW * 0.335, Math.cos(a) * RIM * 0.84, Math.sin(a) * RIM * 0.84, 0.03, 0.03, 0.02, "x", 8); }   // vent holes
    for (let i = 0; i < 8; i++) { const a = i * PI / 4; Rg.cyl(TW * 0.40, Math.cos(a) * RIM * 0.42, Math.sin(a) * RIM * 0.42, 0.016, 0.016, 0.04, "x", 6); }
    Rg.cyl(TW * 0.42, 0, 0, 0.09, 0.10, 0.07, "x", 12);
    Rg.m("paint").c(0.7).cyl(-TW * 0.30, 0, 0, RIM, RIM, 0.04, "x", 16);
    const rimGeos = Rg.build({ uv: 1, mud: 0 });
    return { geos: geos, dGeos: dGeos, tGeos: tGeos, gGeos: gGeos, tyreGeo: tyreGeo, rimGeos: rimGeos, decals: {} };
  }

  function build(ctx) {
    const THREE = window.THREE, HK = CBZ.hullKit;
    if (!THREE || !HK) return null;
    const B = HK.cache("maxxpro_mrap", body);
    const side = ctx.side || ctx.team || null, ground = ctx.ground || ctx.arena;
    const sc = HK.scheme(ctx.nation, ground, side);
    const M = HK.mats(sc);
    const root = new THREE.Group(); root.name = "maxxpro_mrap";
    const bodyG = new THREE.Group(); bodyG.name = "body"; root.add(bodyG);
    HK.meshes(bodyG, B.geos, M, "hull");
    // the rear door on its hinge
    const door = new THREE.Group(); door.name = "reardoor"; door.position.set(DOOR.x, 0, DOOR.z); bodyG.add(door);
    HK.meshes(door, B.dGeos, M, "door");
    // turret on the roof ring, the gun on its cradle, the tube that recoils
    const turret = new THREE.Group(); turret.name = "turret"; turret.position.set(0, RING.y, RING.z); bodyG.add(turret);
    const shield = new THREE.Group(); shield.name = "shield"; turret.add(shield);
    HK.meshes(shield, B.tGeos, M, "ogpk");
    const gun = new THREE.Group(); gun.name = "gun"; gun.position.set(0, 0.30, 0.28); turret.add(gun);
    const tube = new THREE.Group(); tube.name = "tube"; gun.add(tube);
    HK.meshes(tube, B.gGeos, M, "m2");
    const muzzle = new THREE.Object3D(); muzzle.name = "muzzle"; muzzle.position.set(0, 0.03, 1.46); tube.add(muzzle);
    // the crew, each drawn only while his seat is filled
    const seed = (ctx.seed | 0) >>> 0;
    const fig = function (kind, k) { return HK.figMesh(kind, sc, (seed + k) % 4, M); };
    const driver = fig("seated", 0); driver.position.set(0.55, 1.66, 0.95); bodyG.add(driver);
    const tc = fig("seated", 1); tc.position.set(-0.55, 1.66, 0.95); bodyG.add(tc);
    const gunner = fig("gunner", 2); gunner.position.set(0, -0.14, -0.62); gunner.castShadow = true; turret.add(gunner);
    // six riflemen on the benches, facing in (one instanced draw)
    const troops = HK.figMesh("bench", sc, seed % 4, M, 6, [-1.1, 1.2, -2.3, 1.1, 2.6, -0.4]); troops.name = "troops";
    const tm = new THREE.Matrix4(), tq = new THREE.Quaternion(), tp = new THREE.Vector3(), ts = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < 6; i++) {
      const p = BENCH[i];
      tq.setFromAxisAngle(up, p[0] > 0 ? -PI / 2 : PI / 2);
      tp.set(p[0], p[1], p[2]);
      troops.setMatrixAt(i, tm.compose(tp, tq, ts));
    }
    troops.count = 0;
    bodyG.add(troops);
    const wheels = [
      { x: TR, y: R, z: AXF, r: R, steer: 1 }, { x: -TR, y: R, z: AXF, r: R, steer: 1 },
      { x: TR, y: R, z: AXR, r: R, steer: 0 }, { x: -TR, y: R, z: AXR, r: R, steer: 0 },
    ];
    const WS = HK.wheelSet(root, B.tyreGeo, B.rimGeos, M, 4, [-TR - TW, 0, AXR - R, TR + TW, 2 * R, AXF + R]);
    const rig = new HK.WheeledRig({
      root: root, body: bodyG, wheels: wheels, tyreIM: WS.tyreIM, rimIMs: WS.rimIMs, wheelbase: AXF - AXR, track: 2 * TR,
      // stiff leaf springs (little travel), soft in roll: the capsule heels
      travel: [0.09, 0.12], turret: turret, gun: gun, tube: tube, muzzle: muzzle, shield: shield,
      tcfg: { rate: 1.4, elevRate: 1.2, elevMin: -0.25, elevMax: 0.9 },
      figs: { driver: driver, commander: tc },
      gunner: { obj: gunner, seat: "gunner", calm: 0.02, fight: -0.14 },
      troops: { im: troops, max: 6 },
      tailgate: { obj: door, open: 1.72, axis: "y", rate: 2.2 },
      exhaust: { p: [-1.32, 0.98, 1.30], d: [-1, -0.15, -0.1], soot: 0.6 },
      engine: [0, 1.6, 2.35], cabin: [0, 2.0, -0.9], ground: ground, side: side, seed: seed,
      pitchK: 0.009, rollK: 0.013, pitchMax: 0.06, rollMax: 0.15,
      // the nation's flag on both troop-compartment flanks and the rear wall
      decal: { parent: bodyG, cache: B.decals, list: [[CAP.hw + 0.004, 1.78, -1.60, 1, 0, 0.42], [-CAP.hw - 0.004, 1.78, -1.60, -1, 0, 0.42],
        [0.86, 2.30, CAP.zr - 0.004, 0, -1, 0.30]] },
    });
    rig.mark(ctx.nation, ground, side);
    return { group: root, rig: rig, footW: Wd, footL: L, height: HT };
  }

  CBZ.unitKit.register("maxxpro_mrap", {
    kind: "vehicle",
    domain: "ground",
    drive: "wheeled",
    // 16.8 t loaded; grip = the ROLLOVER limit (0.42 g), not the tyres' (see the header)
    stats: { hp: 560, mass: 16800, speed: 24, reverse: 5, accel: 1.1, turn: 0.55, wheelbase: AXF - AXR, maxSteer: 0.44, grip: 0.42,
      length: L, width: Wd, height: HT,
      // rifle rounds stop on every face; armour.belly is the V-hull against a blast from below
      armour: { front: 30, side: 26, rear: 26, top: 12, belly: 260 },
      standoff: 320, dismountAt: 400 },
    turret: { rate: 1.4, elevRate: 1.2, elevMin: -0.25, elevMax: 0.9 },
    // seat positions in hull space: the crew-casualty line is measured to these
    crew: [{ seat: "driver", pos: [0.55, 2.20, 0.95] }, { seat: "gunner", pos: [0, 3.25, -0.65] }, { seat: "commander", pos: [-0.55, 2.20, 0.95] }],
    passengers: 6,
    passengerPos: BENCH.map(function (p) { return [p[0], p[1] + 0.45, p[2]]; }),
    weapons: [
      { id: "m2_50cal_ring", seat: "gunner", kind: "mg", wid: "lmg", turret: true, rof: 8, burst: 8, pause: 1.3, dmg: 38, pen: 24, range: 1800, ammo: 1600 },
    ],
    /* TACTICS (src/battle/vehicles.js reads standoff and dismountAt; the rest
       is the interface the AI layer reads). An MRAP is a protected taxi with
       a gun on top, built for the road and the ambush on it.
       CONVOY: it rides in the body of the column (the tank leads), 50 m
       intervals, 15 m/s on a road; on contact it does NOT stop in the kill
       zone: it pushes through, the gunner suppresses, and if it is stopped
       the men stay inside the capsule (it is the safest place there is)
       until the column has fire superiority, then get out the back on the
       far side from the fire. PATROL: walking pace with its squad out
       ahead and to the flanks, the truck in overwatch 150 m behind them,
       the .50 covering their front. It never duels armour. */
    tactics: {
      role: "mrap",
      engage: { soft: 1500, armour: 0, close: 20 },
      priorities: ["launcher", "mg", "men", "vehicle", "beast"],
      keepFrom: { men: 280, launcher: 350, armour: 1500 },
      hullDown: false, faceThreat: true, reverseOut: false, avoidArmour: true,
      convoy: { slot: "body", gap: 50, speed: 15, contact: "push-through", stayAboardInKillZone: true, dismountSide: "away" },
      patrol: { speed: 4, overwatch: 150, dismount: true, screen: { need: "men", ahead: 60, spread: 40 } },
      dismount: { at: 400, door: "rear", cover: "hull" },
      screen: { need: "men", behind: 40 },
      withdrawAt: 0.3,
    },
    animate: function (veh, dt, c) { if (CBZ.hullKit) CBZ.hullKit.animate(veh, dt, c); else if (c && c.shared) c.shared(dt); },
    build: build,
  });
})();
