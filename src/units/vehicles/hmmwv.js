/* ============================================================
   units/vehicles/hmmwv.js — M1151A1 HMMWV, up-armoured, with the O-GPK
   gunner's turret and an M2 .50 (USA; fielded here by any nation's army).

   REDRAWN FROM SCRATCH (2026-10-11). What was here: city/mil_armor.js's
   generic "LUV", the right box size with a ring and a shield on top.
   What is here, from the vehicle's own numbers:

   THE BODY  4.93 m long, 2.18 m wide, 1.93 m to the roof, 2.69 m over the
             gunner's shield. 3.30 m wheelbase, 1.82 m track, 0.41 m under the
             belly (geared hubs: the axles sit higher than the floor).
             37x12.50R16.5 tyres (0.94 m) on two-piece run-flat rims, the
             bolt ring round the rim face, NDT bar tread. The wide one-piece
             hood over flat fenders, the slatted grille with the lamps at its
             ends, the steel bumper with its shackles; the four armoured doors
             (B-kit) with their small thick windows, hinges and paddle
             handles; the split raked windscreen; the sloping armoured trunk
             lid; the passenger-side air intake; tail lamp clusters,
             bumperettes, the pintle; mirrors on their arms; two whip antennas
             tied forward; stowage on the deck; the running gear underneath
             (A-arms, half-shafts, differentials, exhaust out the right rear).
   THE TURRET  The O-GPK: ring, a front shield with its two ballistic windows
             and the gun slot, angled wings, side and rear plates, all
             traversing on the ring. The M2 on its cradle: receiver, spade
             grips, barrel jacket, barrel and flash hider, carrying handle,
             the ammunition can on the feed side.
   PAINT     the side's nation and ground (units/kit/hull.js): NATO three-tone,
             CARC tan, Gulf sand, splinter, whitewash; the nation's flag on
             both rear doors and the trunk.
   CREW      driver and commander (TC) in front, two in the back, the gunner
             standing in the ring: each one drawn only while his seat is
             filled. The gunner stands tall to look round when calm and gets
             down on the grips behind the shield to shoot.
   DRIVE     CBZ.vehicleDrive.wheeled (Ackermann about the rear axle), 7.6 m
             turning circle radius, ~0.7 g of grip, 0-48 km/h in ~9 s,
             113 km/h governed. Every wheel rides the ground on its own
             independent suspension (25 cm of travel), the body squats, dives
             and leans; dust off the tyres, diesel haze out of the exhaust.
   ARMOUR    B-kit: stops 7.62x39 and 7.62x51 ball everywhere but the roof,
             frag from above; .50 AP and sniper rounds go through, an RPG goes
             through anything. Mobility kill sits it on a shot-out wheel, a
             firepower kill hangs the gun. Damaged: smoke out of the engine;
             burning: fire; burnt out: tyres gone, on its rims, gun shield
             thrown askew if it brewed up.
   WEAPON    M2HB .50 BMG: 450-600 rds/min (8/s) in 6-10 round bursts, 1,800 m
             maximum effective (1,500 here), 200-round belts on the deck.

   TACTICS (read by src/battle/vehicles.js today: standoff, dismountAt; the
   rest is the interface the AI agent reads): a gun truck, not a tank. It
   keeps its distance from infantry (400 m: its .50 outranges their rifles;
   their RPGs outrange its armour inside 300 m), puts its two dismounts out
   at 480 m (before it parks on its firing line, or they would never get out),
   and leaves anything with real armour to somebody else.

   Units: metres, m/s, kg, armour in mm RHA equivalent per face. Nose +Z,
   +X is the vehicle's left (the driver's side).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.unitKit) return;
  const PI = Math.PI;

  // ---- the numbers -----------------------------------------------------------
  const L = 4.93, Wd = 2.18, ROOF = 1.92;
  const AXF = 1.65, AXR = -1.65, TR = 0.91, R = 0.47, TW = 0.32, RIM = 0.215;
  const RING = { z: -0.30, y: ROOF + 0.04 };

  /* ---- THE BODY: built once into shared geometry (one per material) -------- */
  function body() {

    const HK = CBZ.hullKit, G = HK.geo();
    const D = 0.92, P = 1;                     // panel tints
    // --- chassis, belly armour, running gear (unpainted steel underneath)
    G.m("metal").c(0xb8b8b0);
    [-1, 1].forEach(function (s) { G.box(s * 0.42, 0.56, 0, 0.10, 0.16, 4.3); });           // frame rails
    G.m("paint").c([0.8, 0.8, 0.8]);
    G.sect([[-1.05, [[-0.62, 0.43], [0.62, 0.43], [0.70, 0.60], [-0.70, 0.60]]], [1.15, [[-0.62, 0.43], [0.62, 0.43], [0.70, 0.60], [-0.70, 0.60]]]]);  // V-ish belly plate
    G.m("metal").c(0xa0a098);
    [AXF, AXR].forEach(function (z) {
      G.sphere(0, 0.55, z, 0.17, 8, 1.1, 0.9, 1.0);                                          // differential
      [-1, 1].forEach(function (s) {
        G.cyl(s * 0.45, 0.50, z, 0.035, 0.035, 0.75, "x", 6);                                // half-shaft to the geared hub
        G.box(s * 0.50, 0.40, z + 0.12, 0.62, 0.05, 0.10, 0, 0, s * 0.10);                  // lower A-arm
        G.box(s * 0.52, 0.66, z - 0.10, 0.55, 0.05, 0.09, 0, 0, s * -0.12);                 // upper A-arm
        G.cyl(s * 0.62, 0.66, z - 0.22, 0.04, 0.045, 0.42, "y", 6, 0, 0, s * 0.35);        // shock
        G.cyl(s * 0.80, 0.47, z, 0.12, 0.12, 0.10, "x", 10);                                 // geared hub housing
      });
    });
    G.cyl(0, 0.50, 0, 0.04, 0.04, 2.9, "z", 6);                                             // driveshaft
    G.m("dark").c(0x9a9a92);
    G.cyl(-0.70, 0.52, -0.6, 0.045, 0.045, 3.4, "z", 8);                                    // exhaust along the right rail
    G.cyl(-0.78, 0.55, -2.32, 0.05, 0.05, 0.20, "z", 8, 0, 0.35, 0);                        // tail pipe out the right rear
    // --- the hood + fenders: one wide fibreglass piece over the wheels
    G.m("paint").c(P);
    const hood = function (top, bot, w) { return [[-w, bot], [w, bot], [w, top - 0.06], [w - 0.10, top], [-w + 0.10, top], [-w, top - 0.06]]; };
    G.sect([[0.92, hood(1.235, 0.66, 0.72)], [2.10, hood(1.20, 0.66, 0.72)], [2.31, hood(1.15, 0.66, 0.70)]]);
    [-1, 1].forEach(function (s) {
      const sec = function (top, lo) {
        return [[s * 0.70, lo], [s * 1.09, lo], [s * 1.09, top - 0.06], [s * 1.04, top], [s * 0.70, top + 0.02]];
      };
      G.sect([[0.92, sec(1.15, 1.02)], [2.12, sec(1.12, 1.00)], [2.29, sec(1.07, 0.98)]]);
      // the fender's skirt behind the front wheel down to the rocker
      G.box(s * 0.91, 0.84, 1.00, 0.36, 0.40, 0.10);
      // turn signal on the fender top, blackout marker
      G.save().m("amber").c(1).box(s * 0.98, 1.10, 2.22, 0.10, 0.05, 0.08).restore();
      // hood hold-down latch (the rubber T-handle strap)
      G.save().m("black").c(1).box(s * 0.72, 1.12, 1.25, 0.05, 0.14, 0.04).box(s * 0.72, 1.12, 1.95, 0.05, 0.14, 0.04).restore();
      // inner wheel-well liner (dark)
      G.save().m("black").c(1).box(s * 0.90, 1.00, 1.65, 0.38, 0.02, 1.25).restore();
    });
    // hood centre bulge + lifting eyes
    G.box(0, 1.245, 1.55, 0.95, 0.03, 1.10);
    [-1, 1].forEach(function (s) { G.cyl(s * 0.40, 1.25, 2.18, 0.03, 0.03, 0.04, "x", 8); });
    // grille: the recess, its slats, the lamps at its ends
    G.save().m("black").c(1).box(0, 0.90, 2.30, 1.10, 0.40, 0.03).restore();
    for (let i = 0; i < 9; i++) G.box(-0.44 + i * 0.11, 0.90, 2.315, 0.035, 0.40, 0.03);
    [-1, 1].forEach(function (s) {
      G.cyl(s * 0.64, 0.92, 2.30, 0.105, 0.11, 0.05, "z", 14);                               // bezel
      G.save().m("lamp").c(1).cyl(s * 0.64, 0.92, 2.33, 0.08, 0.08, 0.02, "z", 14).restore();
      G.save().m("amber").c(1).box(s * 0.64, 0.78, 2.32, 0.10, 0.05, 0.02).restore();
    });
    // passenger-side cowl air intake (the M1151's raised box with slats)
    G.box(-0.62, 1.30, 1.02, 0.34, 0.12, 0.26);
    G.save().m("black").c(1);
    for (let i = 0; i < 4; i++) G.box(-0.62, 1.30, 1.155, 0.30, 0.012, 0.02 + 0 * i).tf(0, 0.025, 0);
    G.restore();
    // --- front bumper, shackles, (no winch on this one)
    G.m("paint").c(0.85);
    G.box(0, 0.60, 2.40, 2.02, 0.20, 0.14);
    G.save().m("dark").c(1);
    [-1, 1].forEach(function (s) {
      G.box(s * 0.55, 0.60, 2.49, 0.10, 0.05, 0.06);
      G.cyl(s * 0.55, 0.60, 2.53, 0.045, 0.045, 0.03, "x", 10, 0, 0, 0, { open: false });
    });
    G.restore();
    // --- THE CAB: armoured doors, windscreen rake, roof
    G.m("paint").c(P);
    const cabS = function (top, lo, belt) { return [[-1.04, lo], [1.04, lo], [1.065, belt], [0.97, top], [-0.97, top], [-1.065, belt]]; };
    G.sect([[0.98, cabS(1.26, 0.62, 1.25)], [0.82, cabS(ROOF, 0.62, 1.27)], [-0.95, cabS(ROOF - 0.02, 0.62, 1.27)], [-1.07, cabS(ROOF - 0.07, 0.62, 1.27)]]);
    // rear body over the rear wheels + the centre tub
    G.sect([[-1.07, [[-1.07, 1.02], [1.07, 1.02], [1.08, 1.24], [0.97, ROOF - 0.07], [-0.97, ROOF - 0.07], [-1.08, 1.24]]],
      [-2.38, [[-1.07, 1.02], [1.07, 1.02], [1.08, 1.22], [0.97, 1.36], [-0.97, 1.36], [-1.08, 1.22]]]]);
    G.box(0, 0.80, -1.72, 1.24, 0.46, 1.30);
    G.save().m("black").c(1);
    [-1, 1].forEach(function (s) { G.box(s * 0.90, 1.00, -1.65, 0.36, 0.02, 1.30); });          // rear wheel-well roof
    G.restore();
    // door seams, hinges, handles, the armour's edge reveal
    G.save().m("black").c(1);
    [-1, 1].forEach(function (s) {
      const x = s * 1.067;
      [0.95, 0.02, -1.04].forEach(function (z) { G.box(x, 0.95, z, 0.012, 0.66, 0.018); });
      G.box(x, 0.635, -0.05, 0.012, 0.018, 1.98);
      [[0.80, 0.92], [0.80, 1.45], [-0.15, 0.92], [-0.15, 1.45]].forEach(function (h) { G.box(x + s * 0.01, h[1], h[0] + 0.07, 0.03, 0.10, 0.05); });
      [0.12, -0.92].forEach(function (z) { G.box(x + s * 0.012, 1.18, z, 0.025, 0.035, 0.13); });
    });
    G.restore();
    // armoured door window frames, then the glass
    const rk = Math.atan2(0.08, 0.64);
    [-1, 1].forEach(function (s) {
      [[0.48, 0.66], [-0.52, 0.66]].forEach(function (wz) {
        G.box(s * 1.05, 1.56, wz[0], 0.035, 0.46, wz[1] + 0.08, 0, 0, s * rk);
        G.save().m("glass").c(1).box(s * 1.07, 1.56, wz[0], 0.02, 0.36, wz[1], 0, 0, s * rk).restore();
      });
    });
    // windscreen: two flat panes in a thick frame on the raked face
    const ws = Math.atan2(0.16, ROOF - 1.26);
    G.box(0, 1.585, 0.905, 2.0, 0.66, 0.05, -ws, 0, 0);
    G.save().m("glass").c(1);
    [-1, 1].forEach(function (s) { G.box(s * 0.47, 1.59, 0.935, 0.84, 0.50, 0.02, -ws, 0, 0); });
    G.restore();
    // wipers
    G.save().m("black").c(1);
    [-1, 1].forEach(function (s) { G.box(s * 0.45, 1.40, 0.955, 0.02, 0.32, 0.02, -ws, 0, s * 0.6); });
    G.restore();
    // mirrors on their arms off the A-pillars
    G.save().m("dark").c(1);
    [-1, 1].forEach(function (s) {
      G.box(s * 1.18, 1.46, 0.86, 0.26, 0.03, 0.03);
      G.box(s * 1.31, 1.50, 0.86, 0.05, 0.30, 0.20);
    });
    G.restore();
    // roof: the turret ring's armour collar, roof hatch seams
    G.cyl(0, ROOF + 0.02, RING.z, 0.72, 0.74, 0.05, "y", 28);
    // --- the trunk lid detail, tail end
    G.save().m("black").c(1);
    G.box(0, 1.37, -2.32, 1.60, 0.015, 0.02);
    [-1, 1].forEach(function (s) { G.box(s * 0.80, 1.62, -1.70, 0.015, 0.012, 1.20, -0.34, 0, 0); });
    G.restore();
    // rear bumperettes, pintle, tail lamp clusters, fuel filler
    G.m("paint").c(0.85);
    [-1, 1].forEach(function (s) { G.box(s * 0.80, 0.66, -2.42, 0.40, 0.16, 0.12); });
    G.save().m("dark").c(1).box(0, 0.62, -2.46, 0.16, 0.10, 0.12).cyl(0, 0.62, -2.54, 0.05, 0.05, 0.03, "y", 10).restore();
    [-1, 1].forEach(function (s) {
      G.box(s * 0.92, 1.12, -2.39, 0.18, 0.20, 0.03);
      G.save().m("tail").c(1).box(s * 0.92, 1.17, -2.405, 0.12, 0.06, 0.02).restore();
      G.save().m("amber").c(1).box(s * 0.92, 1.09, -2.405, 0.12, 0.04, 0.02).restore();
    });
    G.save().m("dark").c(1).cyl(-1.075, 1.13, -1.95, 0.06, 0.06, 0.03, "x", 10).restore();
    // tow eyes at the rear corners
    G.save().m("dark").c(1);
    [-1, 1].forEach(function (s) { G.cyl(s * 0.55, 0.52, -2.44, 0.04, 0.04, 0.04, "x", 8); });
    G.restore();
    // --- antennas: whips on their bases at the rear corners, tied forward
    G.save().m("black").c(1);
    [-1, 1].forEach(function (s) {
      G.cyl(s * 0.90, 1.42, -2.15, 0.035, 0.045, 0.12, "y", 8);
      let px = s * 0.90, py = 1.48, pz = -2.15, a = 0;
      for (let i = 0; i < 6; i++) {
        a += 0.24;
        const l = 0.42, dy = Math.cos(a) * l, dz = Math.sin(a) * l;
        G.cyl(px, py + dy / 2, pz + dz / 2, 0.006, 0.008, l, "y", 4, a, 0, 0);
        py += dy; pz += dz;
      }
    });
    G.restore();
    // --- stowage on the trunk lid: two rucksacks, an ammo can, a cargo strap
    G.save().m("gear").c(1);
    G.tf(0, 1.47, -1.80, -0.34, 0, 0);
    G.sphere(0.40, 0.06, 0.05, 0.24, 8, 1.0, 0.55, 1.1);
    G.sphere(-0.30, 0.06, -0.10, 0.22, 8, 1.1, 0.6, 1.0);
    G.m("paint").c(0.75).box(0.0, 0.05, 0.35, 0.30, 0.18, 0.15);
    G.m("black").c(1).box(0, 0.12, 0.0, 1.5, 0.02, 0.05);
    G.restore();
    // CIP-style thermal panel on the left rear
    G.save().m("black").c(1).box(1.085, 1.13, -1.90, 0.01, 0.16, 0.42).restore();
    const geos = G.build({ uv: 2.6, mud: 0.95 });

    /* ---- THE TURRET (O-GPK) + THE M2, in turret space (origin on the ring) */
    const Tg = HK.geo();
    Tg.m("dark").c(1).cyl(0, 0.03, 0, 0.68, 0.68, 0.06, "y", 28);                            // traversing ring
    Tg.m("paint").c(P);
    // front shield: lower plate, two upper plates either side of the gun slot,
    // a slot lip over the gun, all leaning back 8 degrees
    const lean = -0.14;
    Tg.save().tf(0, 0, 0.62, lean, 0, 0);
    Tg.box(0, 0.16, 0, 1.30, 0.32, 0.04);
    [-1, 1].forEach(function (s) { Tg.box(s * 0.40, 0.55, 0, 0.50, 0.46, 0.04); });
    Tg.box(0, 0.72, 0, 0.32, 0.12, 0.04);
    Tg.m("dark").c(1);
    [-1, 1].forEach(function (s) {
      // window frames, and the transparent armour in them
      Tg.box(s * 0.40, 0.57, 0.025, 0.36, 0.30, 0.02);
    });
    Tg.m("glass").c(1);
    [-1, 1].forEach(function (s) { Tg.box(s * 0.40, 0.57, 0.04, 0.30, 0.24, 0.02); });
    Tg.restore();
    // wings: angled out and back from the front shield's edges
    Tg.m("paint").c(D);
    [-1, 1].forEach(function (s) {
      Tg.save().tf(s * 0.78, 0, 0.40, 0, s * -0.78, 0);
      Tg.box(0, 0.38, 0, 0.04, 0.70, 0.52);
      Tg.m("glass").c(1).box(s * 0.02, 0.56, 0, 0.02, 0.18, 0.22);
      Tg.restore();
      // side plates to the rear corners
      Tg.box(s * 0.86, 0.32, -0.12, 0.04, 0.58, 0.58);
      Tg.box(s * 0.70, 0.30, -0.56, 0.04, 0.54, 0.36, 0, s * 0.62, 0);
    });
    // bolts on the front plate
    Tg.m("dark").c(1);
    for (let i = 0; i < 6; i++) Tg.cyl(-0.55 + i * 0.22, 0.04, 0.60, 0.012, 0.012, 0.02, "z", 6);
    // the pintle post and cradle under the gun
    Tg.cyl(0, 0.13, 0.28, 0.04, 0.05, 0.22, "y", 8);
    Tg.box(0, 0.24, 0.28, 0.12, 0.06, 0.14);
    const tGeos = Tg.build({ uv: 2.6, mud: 0 });

    // the M2 (gun space: pivot at the cradle trunnion, +Z down the barrel)
    const Gg = HK.geo();
    HK.m2(Gg);
    const gGeos = Gg.build({ uv: 2.6, mud: 0 });

    // wheels: the tyre and the run-flat rim (bolt ring + hub with 8 nuts)
    const Wg = HK.geo();
    HK.tyre(Wg, R, TW, RIM, { lug: "ndt", lugs: 20, dep: 0.026 });
    const tyreGeo = Wg.build({ uv: 1, mud: 0 }).rubber;
    const Rg = HK.geo();
    Rg.m("paint").c(0.85);
    Rg.cyl(TW * 0.36, 0, 0, RIM, RIM, 0.05, "x", 20);
    Rg.cyl(TW * 0.40, 0, 0, RIM * 0.62, RIM * 0.70, 0.05, "x", 16);
    Rg.m("dark").c(1);
    for (let i = 0; i < 16; i++) { const a = i * PI / 8; Rg.cyl(TW * 0.395, Math.cos(a) * RIM * 0.86, Math.sin(a) * RIM * 0.86, 0.012, 0.012, 0.02, "x", 6); }
    for (let i = 0; i < 8; i++) { const a = i * PI / 4; Rg.cyl(TW * 0.44, Math.cos(a) * RIM * 0.42, Math.sin(a) * RIM * 0.42, 0.014, 0.014, 0.03, "x", 6); }
    Rg.cyl(TW * 0.46, 0, 0, 0.07, 0.08, 0.06, "x", 12);                                      // geared hub cap
    Rg.m("paint").c(0.7).cyl(-TW * 0.36, 0, 0, RIM, RIM, 0.04, "x", 16);                     // inner face
    const rimGeos = Rg.build({ uv: 1, mud: 0 });
    return { geos: geos, tGeos: tGeos, gGeos: gGeos, tyreGeo: tyreGeo, rimGeos: rimGeos, decals: {} };
  }

  function build(ctx) {
    const THREE = window.THREE, HK = CBZ.hullKit;
    if (!THREE || !HK) return null;
    const B = HK.cache("hmmwv", body);
    // built in the scheme for this side and ground; rig.mark (the battle calls
    // it after build) repaints it if the side's markings say otherwise
    const side = ctx.side || ctx.team || null, ground = ctx.ground || ctx.arena;
    const sc = HK.scheme(ctx.nation, ground, side);
    const M = HK.mats(sc);
    const root = new THREE.Group(); root.name = "hmmwv";
    const bodyG = new THREE.Group(); bodyG.name = "body"; root.add(bodyG);
    HK.meshes(bodyG, B.geos, M, "hull");
    // turret on the ring, the gun on its cradle, the tube that recoils
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
    const driver = fig("seated", 0); driver.position.set(0.48, 1.06, 0.18); bodyG.add(driver);
    const tc = fig("seated", 1); tc.position.set(-0.48, 1.06, 0.18); bodyG.add(tc);
    const p1 = fig("seated", 2); p1.position.set(0.48, 1.06, -0.72); bodyG.add(p1);
    const p2 = fig("seated", 3); p2.position.set(-0.48, 1.06, -0.72); bodyG.add(p2);
    // hips just under the ring: hands on the grips (0.33 up, 0.22 behind the trunnion)
    const gunner = fig("gunner", 4); gunner.position.set(0, -0.14, -0.62); gunner.castShadow = true; turret.add(gunner);
    // wheels: one instanced draw per part for the four of them
    const wheels = [
      { x: TR, y: R, z: AXF, r: R, steer: 1 }, { x: -TR, y: R, z: AXF, r: R, steer: 1 },
      { x: TR, y: R, z: AXR, r: R, steer: 0 }, { x: -TR, y: R, z: AXR, r: R, steer: 0 },
    ];
    const WS = HK.wheelSet(root, B.tyreGeo, B.rimGeos, M, 4, [-TR - TW, 0, AXR - R, TR + TW, 2 * R, AXF + R]);
    const rig = new HK.WheeledRig({
      root: root, body: bodyG, wheels: wheels, tyreIM: WS.tyreIM, rimIMs: WS.rimIMs, wheelbase: AXF - AXR, track: 2 * TR,
      travel: [0.13, 0.12], turret: turret, gun: gun, tube: tube, muzzle: muzzle, shield: shield,
      tcfg: { rate: 1.6, elevRate: 1.3, elevMin: -0.25, elevMax: 0.9 },
      figs: { driver: driver, commander: tc, passenger: [p1, p2] },
      gunner: { obj: gunner, seat: "gunner", calm: 0.02, fight: -0.14 },
      exhaust: { p: [-0.80, 0.55, -2.45], d: [-0.3, -0.1, -1], soot: 0.35 },
      engine: [0, 1.3, 1.6], cabin: [0, 1.5, -0.3], ground: ground, side: side, seed: seed,
      pitchK: 0.008, rollK: 0.0045,
      // the nation's flag on both rear doors and the trunk lid
      decal: { parent: bodyG, cache: B.decals, list: [[1.072, 1.06, -0.52, 1, 0, 0.30], [-1.072, 1.06, -0.52, -1, 0, 0.30], [0.55, 1.17, -2.386, 0, -1, 0.26]] },
    });
    rig.mark(ctx.nation, ground, side);
    return { group: root, rig: rig, footW: Wd, footL: L, height: 2.69 };
  }

  CBZ.unitKit.register("hmmwv", {
    kind: "vehicle",
    domain: "ground",
    drive: "wheeled",
    // 5,400 kg combat weight (M1151A1 with B-kit); 0.7 g grip on dirt
    stats: { hp: 260, mass: 5400, speed: 31, reverse: 6, accel: 2.2, turn: 0.8, wheelbase: 3.30, maxSteer: 0.42, grip: 0.7,
      length: L, width: Wd, height: 2.69,
      armour: { front: 13, side: 12, rear: 10, top: 6 }, standoff: 400, dismountAt: 480 },
    turret: { rate: 1.6, elevRate: 1.3, elevMin: -0.25, elevMax: 0.9 },
    // seat positions in hull space: the crew-casualty line is measured to these
    crew: [{ seat: "driver", pos: [0.48, 1.55, 0.25] }, { seat: "gunner", pos: [0, 2.30, -0.90] }, { seat: "commander", pos: [-0.48, 1.55, 0.25] }],
    passengers: 2,
    weapons: [
      // M2HB on the O-GPK ring: 450-600 rds/min in bursts; the ring mount's own ballistics row
      { id: "m2_50cal_ring", seat: "gunner", kind: "mg", wid: "lmg", turret: true, rof: 8, burst: 8, pause: 1.3, dmg: 38, pen: 24, range: 1800, ammo: 1200 },
    ],
    tactics: {
      role: "gun truck",
      engage: { soft: 1500, armour: 0, close: 18 },        // a .50 for men and soft-skins; armour is someone else's
      priorities: ["launcher", "mg", "men", "vehicle", "beast"],
      keepFrom: { men: 400, launcher: 450, armour: 1200 },
      hullDown: false, faceThreat: true, reverseOut: true,
      screen: { need: "men", behind: 40 },                 // fights behind its dismounts once they are out
      withdrawAt: 0.35,
    },
    animate: function (veh, dt, c) { if (CBZ.hullKit) CBZ.hullKit.animate(veh, dt, c); else if (c && c.shared) c.shared(dt); },
    build: build,
  });
})();
