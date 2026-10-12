/* ============================================================
   units/vehicles/shahed_launcher.js — the Shahed-136 rack truck: a KamAZ-
   43118 6x6 with a five-cell launch rack on its platform (Iran / Russia;
   fielded here by any nation's army).

   WHAT IT IS. The cheapest way to put five one-way attack drones in the air
   from anywhere: an ordinary army truck carrying a steel box frame, inclined
   over the tail, that holds five Shahed-136s one above the other, each on
   its own rail with a solid booster strapped under its tail. The crew parks,
   squares the truck to the launch bearing and fires them one after another
   (src/battle/drones.js): the booster burns ~2 s and drops, the engine is
   already turning, the drone climbs away on its programmed route. Then the
   truck drives off before anyone answers.

   THE TRUCK  KamAZ-43118: 8.53 m long, 2.50 m wide, ~3 m over the cab; a
             flat-fronted cab-over (the V8 under the cab), the front axle
             under the doors, 3.69 m to the first rear axle and 1.32 m to the
             second; six 425/85R21 tyres (1.24 m) with central tyre
             inflation; a steel platform behind the cab. ~11.6 t empty, ~14 t
             with the rack and five drones; 260 hp, 90 km/h.
   THE CAB   the KamAZ face: the two flat windscreen panes under the sun
             visor, the black grille band, the bumper with the headlamps and
             tow hooks, the big mirrors, the air intake stack behind the cab,
             the spare wheel standing against the cab's back wall.
   THE RACK  a welded box frame of square tube on a base frame bolted to the
             platform, tipped up 16 deg toward the rear: five cells at 0.70 m
             over each other, each with its pair of launch rails and the
             umbilical drop. The cells are where the drones sit
             (def.launches.slots, hull space): the drone units themselves are
             drawn by units/vehicles/shahed_136.js, in the cell until they go.
   PAINT     the side's nation and ground (units/kit/hull.js), the flag on
             both doors.
   ARMOUR    none: 1-2 mm of truck everywhere. A rifle round goes through
             the cab.

   TACTICS. It does not fight: it drives back to a launch site out of the
   enemy's sight (tactics.launchBack m behind its start), parks, fires its
   cells one by one (src/battle/drones.js), then withdraws to its own edge.

   Units: metres, m/s, kg, mm RHA. Nose +Z, +X is the vehicle's left.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.unitKit) return;
  const PI = Math.PI;

  // ---- the numbers -----------------------------------------------------------
  const L = 8.53, Wd = 2.50, H = 6.5;                    // H over the top of the loaded rack
  const AXF = 2.85, AXM = -0.84, AXR = -2.16, R = 0.62, TW = 0.42, RIM = 0.27, TRK = 1.005;
  const CAB = { zb: 2.30, zf: 3.98, y0: 1.32, y1: 2.98, w: 1.20, wsy: 2.10 };
  const DECK = { z0: 2.15, z1: -4.20, y: 1.48, w: 1.24 };
  const RACK = { pitch: 16 * PI / 180, z0: 1.35, len: 4.0, gap: 0.70, n: 5, y0: 1.80, w: 2.62 };     // the box is wider than the 2.5 m span
  // a cell's drone origin (the Shahed's own bottom-centre at mid-length) in
  // hull space: along the rack's incline from its low (front) end, stacked up
  const SLOTS = [];
  for (let k = 0; k < RACK.n; k++) {
    const along = RACK.len * 0.5 + 0.05, up = 0.06 + k * RACK.gap;
    SLOTS.push([0, RACK.y0 + Math.sin(RACK.pitch) * along + Math.cos(RACK.pitch) * up, RACK.z0 - Math.cos(RACK.pitch) * along + Math.sin(RACK.pitch) * up]);
  }

  function body() {
    const HK = CBZ.hullKit, G = HK.geo();
    // ---------------------------------------------------------- frame + running gear
    G.m("paint").c(0.55);
    [-1, 1].forEach(function (s) { G.box(s * 0.44, 1.05, -0.20, 0.09, 0.28, 7.90); });
    [3.30, 1.80, 0.40, -1.50, -3.00, -4.05].forEach(function (z) { G.box(0, 1.03, z, 0.80, 0.14, 0.10); });
    G.m("metal").c(0.9);
    [AXF, AXM, AXR].forEach(function (z) {
      G.cyl(0, R, z, 0.085, 0.085, 1.70, "x", 10);
      G.sphere(0, R, z, 0.25, 9, 1.0, 0.95, 0.9);
      [-1, 1].forEach(function (s) { G.cyl(s * 0.76, R, z, 0.16, 0.16, 0.18, "x", 12); });
    });
    [-1, 1].forEach(function (s) {
      for (let i = 0; i < 4; i++) G.box(s * 0.44, R + 0.14 + i * 0.03, AXF, 0.08, 0.025, 1.50 - i * 0.28);
      for (let i = 0; i < 5; i++) G.box(s * 0.44, 0.92 - i * 0.03, (AXM + AXR) / 2, 0.09, 0.025, 1.70 - i * 0.24);
    });
    G.cyl(0, 0.78, 0.9, 0.05, 0.05, 3.2, "z", 6);
    G.box(0, 0.86, 0.10, 0.44, 0.34, 0.52);                                            // transfer case
    G.m("dark").c(1);
    G.box(0, 1.10, 2.75, 0.72, 0.56, 1.20);                                            // the V8 under the cab
    // ---------------------------------------------------------- bumper, lamps, steps
    G.m("paint").c(1);
    G.box(0, 1.12, 4.10, 2.46, 0.32, 0.20);
    G.m("dark").c(1);
    [-1, 1].forEach(function (s) {
      G.save().m("black").c(1).box(s * 0.95, 1.14, 4.205, 0.30, 0.20, 0.01).restore();
      G.save().m("lamp").c(1).cyl(s * 0.98, 1.14, 4.21, 0.08, 0.08, 0.02, "z", 14).restore();
      G.save().m("amber").c(1).box(s * 0.74, 1.14, 4.21, 0.08, 0.06, 0.02).restore();
      G.cyl(s * 0.55, 0.98, 4.24, 0.05, 0.05, 0.10, "z", 8);                            // tow hooks
      G.box(s * 1.12, 0.85, 3.30, 0.30, 0.03, 0.40);                                    // the cab steps
      G.box(s * 1.12, 1.15, 3.30, 0.30, 0.03, 0.40);
    });
    // fenders over the front wheels
    [-1, 1].forEach(function (s) { G.save().m("black").c(1).box(s * 1.05, 1.42, AXF, 0.44, 0.04, 1.30).box(s * 1.26, 1.30, AXF, 0.03, 0.20, 1.30).restore(); });
    // ---------------------------------------------------------- the cab (KamAZ face)
    G.m("paint").c(1);
    G.prof(-CAB.w, CAB.w, [[CAB.zb, CAB.y0], [CAB.zf, CAB.y0], [CAB.zf + 0.02, CAB.wsy], [CAB.zf - 0.08, CAB.y1 - 0.10], [CAB.zf - 0.20, CAB.y1],
      [CAB.zb + 0.08, CAB.y1], [CAB.zb, CAB.y1 - 0.06]]);
    // the sun visor over the windscreen
    G.c(0.92).box(0, CAB.y1 - 0.06, CAB.zf - 0.02, 2.30, 0.05, 0.30, -0.15, 0, 0);
    // the grille band: black, five slots, the badge
    G.save().m("black").c(1).box(0, 1.80, CAB.zf + 0.025, 1.60, 0.40, 0.02).restore();
    G.c(0.82);
    for (let i = 0; i < 5; i++) G.box(0, 1.64 + i * 0.08, CAB.zf + 0.04, 1.56, 0.022, 0.02);
    G.c(1).box(0, 1.47, CAB.zf + 0.03, 2.30, 0.12, 0.03);
    G.save().m("metal").c(1.2).box(0, 2.03, CAB.zf + 0.05, 0.30, 0.05, 0.01).restore();
    // the windscreen: two flat panes, the pillar, wipers hanging from the top
    G.save().tf(0, CAB.wsy, CAB.zf + 0.02, -0.07, 0, 0);
    G.box(0, 0.02, 0, 2.30, 0.05, 0.04); G.box(0, 0.74, 0, 2.30, 0.05, 0.04);
    [-1, 0, 1].forEach(function (s) { G.box(s * 1.11, 0.38, 0, s ? 0.08 : 0.06, 0.72, 0.04); });
    G.m("glass").c(1);
    [-1, 1].forEach(function (s) { G.box(s * 0.55, 0.38, 0.005, 1.02, 0.66, 0.02); });
    G.m("black").c(1);
    [-1, 1].forEach(function (s) { G.box(s * 0.55, 0.42, 0.03, 0.02, 0.52, 0.015, 0, 0, s * 0.3); });
    G.restore();
    // doors: seams, the window, the handle, the mirror on its arm
    [-1, 1].forEach(function (s) {
      const x = s * CAB.w;
      G.m("black").c(1);
      G.box(x + s * 0.004, 2.0, 3.70, 0.012, 1.15, 0.015); G.box(x + s * 0.004, 2.0, 2.60, 0.012, 1.15, 0.015);
      G.m("glass").c(1).box(x + s * 0.01, 2.50, 3.20, 0.02, 0.50, 0.88);
      G.m("dark").c(1).box(x + s * 0.03, 2.08, 2.72, 0.04, 0.05, 0.16);
      G.tube([x, 2.70, 3.85], [x + s * 0.34, 2.72, 3.90], 0.016, 0.016, 6).tube([x, 2.20, 3.85], [x + s * 0.34, 2.30, 3.90], 0.016, 0.016, 6);
      G.box(x + s * 0.36, 2.48, 3.90, 0.05, 0.50, 0.22);
      G.m("glass").c(1).box(x + s * 0.36, 2.48, 3.88, 0.03, 0.46, 0.19);
    });
    // the back wall's window, the air intake stack behind the cab, the exhaust
    G.m("glass").c(1).box(0, 2.45, CAB.zb - 0.02, 0.70, 0.28, 0.02);
    G.m("paint").c(0.95);
    G.cyl(-1.00, 2.10, 2.05, 0.14, 0.14, 1.75, "y", 14);
    G.cyl(-1.00, 3.04, 2.05, 0.18, 0.16, 0.16, "y", 14);
    G.m("black").c(1).cyl(1.05, 1.95, 2.10, 0.06, 0.06, 1.50, "y", 10);
    G.m("dark").c(1).cyl(1.05, 2.25, 2.10, 0.09, 0.09, 0.70, "y", 12, 0, 0, 0, { open: true });
    // the fuel tank (left) and the battery box (right) under the platform's front
    G.m("paint").c(0.9);
    G.box(1.00, 1.05, 1.40, 0.40, 0.50, 1.10); G.box(-1.00, 1.05, 1.50, 0.40, 0.40, 0.70);
    // ---------------------------------------------------------- the platform
    G.m("paint").c(1);
    const zc = (DECK.z0 + DECK.z1) / 2, len = DECK.z0 - DECK.z1;
    G.box(0, DECK.y - 0.05, zc, DECK.w * 2, 0.10, len);
    [-1, 1].forEach(function (s) { G.box(s * (DECK.w - 0.02), DECK.y + 0.10, zc, 0.04, 0.20, len); });   // low sides
    G.box(0, DECK.y + 0.10, DECK.z1 + 0.02, DECK.w * 2, 0.20, 0.04);
    // the rear: lamps, bumper, the hitch
    [-1, 1].forEach(function (s) {
      G.box(s * 0.92, 1.18, DECK.z1 - 0.06, 0.40, 0.18, 0.14);
      G.save().m("tail").c(1).box(s * 1.00, 1.30, DECK.z1 - 0.13, 0.14, 0.08, 0.02).restore();
      G.save().m("black").c(1).box(s * 1.00, 0.80, AXR - 0.75, 0.48, 0.55, 0.02).restore();
    });
    // ---------------------------------------------------------- THE RACK
    G.m("gear").c(0.8);
    // the base frame on the platform: two long beams, the cross members, the
    // front A-frame and the rear legs that hold the incline
    [-1, 1].forEach(function (s) {
      G.box(s * 0.70, DECK.y + 0.08, (RACK.z0 + DECK.z1 + 0.3) / 2, 0.12, 0.12, RACK.z0 - DECK.z1 - 0.3);
    });
    const cs = Math.cos(RACK.pitch), sn = Math.sin(RACK.pitch);
    const P = function (along, up, x) { return [x, RACK.y0 + sn * along + cs * up, RACK.z0 - cs * along + sn * up]; };
    const top = (RACK.n - 1) * RACK.gap + 0.85;
    // the box: four corner posts, top and bottom rails, the cell floors
    [-1, 1].forEach(function (s) {
      const x = s * RACK.w * 0.5;
      [0.05, RACK.len - 0.05].forEach(function (a) { G.tube(P(a, 0, x), P(a, top, x), 0.045, 0.045, 6); });
      [0, top].forEach(function (u) { G.tube(P(0, u, x), P(RACK.len, u, x), 0.04, 0.04, 6); });
      // the diagonal braces down each side
      G.tube(P(0.05, 0, x), P(RACK.len - 0.05, top, x), 0.03, 0.03, 5);
      // the legs from the rack's high end down to the base frame
      const hi = P(RACK.len - 0.1, 0, x);
      G.tube(hi, [x * 0.98, DECK.y + 0.14, hi[2]], 0.05, 0.05, 6);
    });
    for (let k = 0; k < RACK.n; k++) {
      const u = k * RACK.gap;
      // the cell's two launch rails and its cross ties
      [-0.16, 0.16].forEach(function (x) { G.tube(P(0.2, u, x), P(RACK.len - 0.1, u, x), 0.025, 0.025, 5); });
      [0.4, 2.0, 3.6].forEach(function (a) { G.tube(P(a, u, -RACK.w * 0.5), P(a, u, RACK.w * 0.5), 0.022, 0.022, 5); });
      // the umbilical connector box at the cell's low end
      G.save().m("dark").c(1).box(0, P(0.12, u + 0.1, 0)[1], P(0.12, u + 0.1, 0)[2], 0.2, 0.12, 0.12).restore();
    }
    // the top cross members
    [0.05, RACK.len - 0.05].forEach(function (a) { G.tube(P(a, top, -RACK.w * 0.5), P(a, top, RACK.w * 0.5), 0.04, 0.04, 6); });
    const geos = G.build({ uv: 2.6, mud: 1.1 });

    // ---------------------------------------------------------- wheels
    const Wg = HK.geo();
    HK.tyre(Wg, R, TW, RIM, { lug: "xtr", lugs: 20, dep: 0.034 });
    const tyreGeo = Wg.build({ uv: 1, mud: 0 }).rubber;
    const Dg = HK.geo();
    Dg.m("paint").c(0.85);
    Dg.cyl(TW * 0.30, 0, 0, RIM, RIM, 0.06, "x", 22);
    Dg.cyl(TW * 0.36, 0, 0, RIM * 0.6, RIM * 0.76, 0.06, "x", 20);
    Dg.cyl(TW * 0.42, 0, 0, 0.12, 0.13, 0.08, "x", 14);
    Dg.m("dark").c(1);
    for (let i = 0; i < 10; i++) { const a = i * PI / 5; Dg.cyl(TW * 0.42, Math.cos(a) * 0.16, Math.sin(a) * 0.16, 0.016, 0.016, 0.05, "x", 6); }
    Dg.cyl(TW * 0.50, 0, 0, 0.05, 0.065, 0.08, "x", 12);                               // the CTIS seal
    const rimGeos = Dg.build({ uv: 1, mud: 0 });
    return { geos: geos, tyreGeo: tyreGeo, rimGeos: rimGeos, decals: {} };
  }

  function build(ctx) {
    const THREE = window.THREE, HK = CBZ.hullKit;
    if (!THREE || !HK) return null;
    const B = HK.cache("shahed_launcher", body);
    const side = ctx.side || ctx.team || null, ground = ctx.ground || ctx.arena;
    const sc = HK.scheme(ctx.nation, ground, side);
    const M = HK.mats(sc);
    const root = new THREE.Group(); root.name = "shahed_launcher";
    const bodyG = new THREE.Group(); bodyG.name = "body"; root.add(bodyG);
    HK.meshes(bodyG, B.geos, M, "hull");
    const seed = (ctx.seed | 0) >>> 0;
    const driver = HK.figMesh("seated", sc, seed % 4, M); driver.position.set(0.55, 1.95, 3.15); bodyG.add(driver);
    const cdr = HK.figMesh("seated", sc, (seed + 1) % 4, M); cdr.position.set(-0.55, 1.95, 3.15); bodyG.add(cdr);
    const wheels = [{ x: TRK, y: R, z: AXF, r: R, steer: 1 }, { x: -TRK, y: R, z: AXF, r: R, steer: 1 }];
    [AXM, AXR].forEach(function (z) { wheels.push({ x: TRK, y: R, z: z, r: R, steer: 0 }, { x: -TRK, y: R, z: z, r: R, steer: 0 }); });
    const WS = HK.wheelSet(root, B.tyreGeo, B.rimGeos, M, wheels.length + 1, [-1.3, 0, AXR - R, 1.3, 2 * R + 2.0, AXF + R]);
    // the spare: standing against the cab's back wall
    const up = new THREE.Vector3(0, 1, 0);
    const sm = new THREE.Matrix4().compose(new THREE.Vector3(0.45, DECK.y + R + 0.02, CAB.zb - 0.32), new THREE.Quaternion().setFromAxisAngle(up, PI / 2), new THREE.Vector3(1, 1, 1));
    WS.tyreIM.setMatrixAt(wheels.length, sm);
    WS.rimIMs.forEach(function (im) { im.setMatrixAt(wheels.length, sm); });
    const rig = new HK.WheeledRig({
      root: root, body: bodyG, wheels: wheels, tyreIM: WS.tyreIM, rimIMs: WS.rimIMs, wheelbase: AXF - (AXM + AXR) / 2, track: 2 * TRK,
      travel: [0.12, 0.12], figs: { driver: driver, commander: cdr },
      exhaust: { p: [1.05, 2.72, 2.10], d: [0, 0.8, -0.2], soot: 0.6 },
      engine: [0, 1.30, 2.75], cabin: [0, 2.2, 3.1], ground: ground, side: side, seed: seed,
      pitchK: 0.010, rollK: 0.008, rollMax: 0.09,
      decal: { parent: bodyG, cache: B.decals, list: [[CAB.w + 0.012, 1.80, 3.20, 1, 0, 0.36], [-(CAB.w + 0.012), 1.80, 3.20, -1, 0, 0.36]] },
    });
    const pose = rig.poseWheels;
    rig.poseWheels = function (steer) {
      pose.call(this, steer);
      this.tyreIM.setMatrixAt(wheels.length, sm);
      for (let k = 0; k < this.rimIMs.length; k++) this.rimIMs[k].setMatrixAt(wheels.length, sm);
    };
    rig.poseWheels(0);
    rig.mark(ctx.nation, ground, side);
    return { group: root, rig: rig, footW: Wd, footL: L, height: H };
  }

  CBZ.unitKit.register("shahed_launcher", {
    kind: "vehicle",
    domain: "ground",
    drive: "wheeled",
    stats: { hp: 300, mass: 14000, speed: 25, reverse: 4, accel: 1.2, turn: 0.5, wheelbase: AXF - (AXM + AXR) / 2, maxSteer: 0.36, grip: 0.6,
      length: L, width: Wd, height: H,
      armour: { front: 2, side: 1, rear: 1, top: 1 },
      standoff: 3000, dismountAt: 0 },
    crew: [{ seat: "driver", pos: [0.55, 2.35, 3.15] }, { seat: "commander", pos: [-0.55, 2.35, 3.15] }],
    passengers: 0,
    weapons: [],
    /* THE CELLS: where each drone this truck carries sits (hull space, the
       drone's own origin), its nose `yaw` off the truck's (PI: over the tail)
       and `pitch` up the rails. src/battle/drones.js puts a Shahed-136 of the
       same side in each until it launches. */
    launches: { ids: ["shahed_136"], yaw: PI, pitch: RACK.pitch, slots: SLOTS, rail: 4.0 },
    tactics: {
      role: "launcher",
      priorities: [],
      holdUntilEmpty: true,                          // drives to its launch site and parks while the cells are loaded
      launchBack: 700,                               // the site: this far behind its start, out of sight
      keepFrom: { men: 3000, armour: 5000 },
      hullDown: false, faceThreat: false, reverseOut: false, lead: false,
      withdrawAt: 1,
    },
    animate: function (veh, dt, c) { if (CBZ.hullKit) CBZ.hullKit.animate(veh, dt, c); else if (c && c.shared) c.shared(dt); },
    build: build,
  });
})();
