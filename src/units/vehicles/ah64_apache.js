/* ============================================================
   units/vehicles/ah64_apache.js — AH-64E Apache Guardian attack helicopter.

   Redrawn from scratch for NPC War (wave B). Before this file drew its own
   airframe the Apache was city/mil_air.js's generic attackHeli: a narrow
   lofted tube with a smooth bubble canopy, no cheek bays, no TADS/PNVS
   drums, a rotor that never turned in the battle and Hellfires that never
   left their rails.

   THE AIRFRAME (real metres, nose +Z, port +X, wheels on y = 0, the main
   rotor mast on z = 0). Numbers from the AH-64D/E: main rotor 14.63 m
   (4 blades, 0.533 m chord, swept tips, 289 rpm), tail rotor 2.79 m on
   the PORT side of the fin (4 blades as two teetering pairs 55° apart,
   1403 rpm), 17.73 m long with the rotors turning, 5.23 m over the stub
   wings, 4.95 m tall over the Longbow radome, wheelbase 10.6 m, main gear
   track 2.03 m. Tandem cockpit (copilot/gunner low in front, pilot raised
   behind) glazed as FLAT panes the way the real one is, extended forward
   avionics bays (the cheeks), two T700 nacelles with "Black Hole" exhaust
   suppressors turned outboard, a fixed trailing-arm main gear and a
   tailwheel on a tall strut, an all-moving stabilator, the M230 chain gun
   in its under-nose turret, TADS (the big drum with the two sensor boxes)
   and PNVS (the small turret on top) on the nose, the Longbow fire-control
   radar on the mast, the ALQ-144 jammer, wire cutters, chaff dispensers,
   antennas, nav lights, two crew in IHADSS helmets.

   THE LOOK: one vertex-coloured material for every opaque part (paint,
   gunmetal, rubber, sensor glass, crew): the paint is FS 34031 "Army
   helicopter green" with sun fade on top, grime underneath, panel tone
   variation and exhaust soot behind the suppressors baked per vertex, and
   dark panel seams cut round the hull. The canopy is a separate glass
   material you can see the crew through. Every piece of geometry is built
   ONCE per page and shared; an Apache costs one group of meshes, two
   InstancedMeshes per side for the stores, and zero allocation per frame.

   THE RIG (moving parts, all driven from animate -> tick):
     main rotor   spins at 289 rpm on the battle clock (the runtime calls
                  animate every sim step: it stops when the battle is frozen
                  and follows the speed dial),
                  each blade flaps on its own hinge: droop at rest, coning
                  in flight, the disc tilting forward with speed (cyclic)
     tail rotor   1403 rpm, a faint blur disc on both rotors at speed
     airframe     banks into turns (tan(bank) = v * yaw rate / g), flares
                  nose-up when it brakes, a slow hover wander; the
                  stabilator runs from 25° trailing-edge-down in the hover
                  to neutral at cruise; pylons articulate to keep the stores
                  on the flight path
     M230         slews at the real turret's rates (±110°, +11°/-60°), kicks
                  back on every round, stows nose-up when nothing is in the
                  sights; TADS follows the gunner's line of sight, PNVS
                  scans with the pilot's head
     stores       8 Hellfires (2 x M299) leave their rails one by one, 38
                  Hydra 70s (2 x 19-tube M261) leave their tubes one by one;
                  each launch comes off the right rail or tube
     rotor wash   kicks dust off the ground below 28 m
     damage       a wreck's rotor winds down, two blades are snapped off;
                  the battle blackens the paint and lights the fire

   HOW IT IS DRIVEN (the vehicle contract, docs/npcwar/ARCHITECTURE.md):
     animate(veh, dt, ctx)   the runtime calls it every sim step on the battle
                             clock; ctx.dead winds the rotor down and snaps
                             two blades
     rig.muzzleWorld(out, shot)  shot.wid says which weapon: the chin gun's
                             muzzle brake, the next Hydra tube, the next
                             Hellfire rail
     rig.fire(shot)          every round: the gun recoils and flashes, a
                             Hydra or a Hellfire leaves its tube or rail
     rig.aimError(shot)      how far the M230 turret still has to slew: the
                             runtime holds the burst until it is on
   The chin gun's line of sight comes from CBZ.milAirAim through
   userData.chinGun (two empty aim nodes); the real turret then lays onto
   that line at its own rates. The weapons say how they point: the M230 is a
   SLEWING mount (fires anywhere in its +-110 deg), the Hydras and the
   Hellfire are FIXED (the nose goes on the mark; the Hellfire's seeker has
   to see it before lock, +-20 deg).

   NATION. build(ctx) paints ctx.flag (the side's city/flags.js design) on
   both faces of the fin (the starboard one reversed, hoist forward, as real
   aircraft carry it); the rig's setNation(id) repaints it.

   Units: metres, m/s, kg; armour in mm RHA equivalent per face.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.unitKit) return;

  const PI = Math.PI, TAU = PI * 2;
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function wrap(a) { while (a > PI) a -= TAU; while (a < -PI) a += TAU; return a; }

  // ---- the real numbers -----------------------------------------------------
  const DIM = {
    rotorR: 7.315, hubY: 3.80, tailR: 1.395, tail: [0.44, 3.27, -9.05],
    omega: 289 * TAU / 60, omegaTail: 1403 * TAU / 60,
    length: 17.73, rotorSpan: 14.63, wingSpan: 5.23, height: 4.95,
    cgY: 1.9,
  };
  // M230 turret: ±110° in azimuth, +11° / -60° in elevation, ~120°/s slew
  const GUN = { yawMax: 110 * PI / 180, up: -11 * PI / 180, down: 60 * PI / 180, yawRate: 2.1, elevRate: 1.6 };
  const HF_N = 8, HY_N = 38;

  /* The order is the engagement order vehFight walks: a Hellfire for armour
     first; the gun for everything else; the rockets in the gun's pauses.
     `mount` / `arc` / `yawMax` are the runtime's per-weapon facing rule. */
  const WEAPONS = [
    // AGM-114K/L: semi-active laser / radar tandem HEAT, Mach 1.3, 0.5-8 km;
    // the seeker has to see the mark off the nose before it locks
    { id: "agm114_hellfire", seat: "gunner", kind: "missile", vs: "armour", mount: "fixed", arc: 0.35, rof: 0.25,
      mun: "agm114k", range: 8000, minRange: 500, ammo: HF_N },
    // M230E1 30x113 mm chain gun, 625 rounds/min, M789 HEDP (~25-30 mm RHA,
    // 4 m lethal radius), 805 m/s, effective to 1.7 km; 1200 rounds; the
    // turret slews +-110 deg
    { id: "m230_30mm", seat: "gunner", kind: "autocannon", mount: "slew", yawMax: GUN.yawMax, tol: 0.06, rof: 10.4, burst: 16, pause: 1.4,
      mun: "m789", grav: 9.8, range: 1700, ammo: 1200 },
    // Hydra 70 with the M151 10 lb HE warhead, rippled in pairs of pairs,
    // unguided off fixed pods: the nose is the aim
    { id: "hydra70", seat: "pilot", kind: "rockets", vs: "soft", mount: "fixed", arc: 0.05, rof: 6, salvo: 4, reload: 9,
      mun: "m151", grav: 9.8, range: 5000, minRange: 200, ammo: HY_N },
  ];

  // =====================================================================
  //  THE TEMPLATE: every geometry built once per page
  // =====================================================================
  const PAINT = 0x2d3327;                       // FS 34031, lit by Lambert
  const RGB = function (hex) { return [(hex >> 16 & 255) / 255, (hex >> 8 & 255) / 255, (hex & 255) / 255]; };
  const C = {
    seam: 0x22271d, gunmetal: 0x2a2c2b, black: 0x0c0d0e, rubber: 0x18191a, sensor: 0x141c22,
    suit: 0x5a5d44, helmet: 0x3b3f31, visor: 0x0f1112, blade: 0x2c3031, edge: 0x6c7072,
    hellfire: 0x565c43, seeker: 0x1a2226, yellow: 0xb39a2c, hydra: 0x4f5538, lens: 0x2b3a46,
  };
  // nodes: name -> [parent, model-space origin in the rest pose]
  const NODES = {
    body: [null, [0, 0, 0]],
    chinYaw: ["body", [0, 0.90, 3.45]], chinPitch: ["chinYaw", [0, 0.72, 3.45]], barrel: ["chinPitch", [0, 0.72, 3.45]],
    aimYaw: ["body", [0, 0.90, 3.45]], aimPitch: ["aimYaw", [0, 0.72, 3.45]],
    tadsYaw: ["body", [0, 1.22, 5.66]], tadsPitch: ["tadsYaw", [0, 1.22, 5.66]],
    pnvs: ["body", [0, 1.68, 5.50]],
    rotor: ["body", [0, DIM.hubY, 0]],
    tail: ["body", DIM.tail],
    stab: ["body", [0, 2.24, -8.26]],
    pylIL: ["body", [1.30, 1.86, 0.30]], pylIR: ["body", [-1.30, 1.86, 0.30]],
    pylOL: ["body", [2.20, 1.86, 0.30]], pylOR: ["body", [-2.20, 1.86, 0.30]],
  };
  // Hydra tube pattern of the M261 (19 x 70 mm, hexagonal)
  const TUBES = (function () {
    const t = [[0, 0]];
    for (let k = 0; k < 6; k++) t.push([Math.cos(k * PI / 3) * 0.072, Math.sin(k * PI / 3) * 0.072]);
    for (let k = 0; k < 6; k++) t.push([Math.cos(k * PI / 3) * 0.144, Math.sin(k * PI / 3) * 0.144]);
    for (let k = 0; k < 6; k++) t.push([Math.cos(k * PI / 3 + PI / 6) * 0.125, Math.sin(k * PI / 3 + PI / 6) * 0.125]);
    // fire from the outside in, round the rings
    return t.reverse();
  })();
  const POD = { y: 1.42, z: 0.05, len: 1.70, r: 0.20 };
  // Hellfire rails of the M299, relative to the outboard pylon: upper pair, lower pair
  const RAILS = [[0.20, 1.52], [-0.20, 1.52], [0.20, 1.20], [-0.20, 1.20]];
  const HF_Z = 0.05, HF_LEN = 1.63;

  let TPL = null;
  function template() {
    if (TPL) return TPL;
    const THREE = window.THREE, K = CBZ.milAir && CBZ.milAir.kit;
    if (!THREE || !K || !K.loft || !K.wing) return null;
    const BK = Object.create(null);

    // ---- colour ------------------------------------------------------------
    function weather(x, y, z, ny) {
      let k = 1 + 0.07 * Math.max(0, ny) - 0.08 * Math.max(0, -ny);         // sun-faded tops, grimy belly
      k *= 1 + 0.035 * Math.sin(x * 3.1 + z * 1.7) * Math.sin(y * 4.3 - z * 2.2); // re-sprayed panels
      if (z < -2.1 && y > 1.6) {                                              // Black Hole soot
        const ax = Math.abs(x), s = Math.exp(-((ax - 0.95) * (ax - 0.95)) / 0.22 - ((y - 2.45) * (y - 2.45)) / 0.35)
          * clamp((-2.1 - z) / 0.9, 0, 1) * clamp(1 - (-z - 3.0) / 4.5, 0, 1);
        k *= 1 - 0.42 * s;
      }
      if (y < 1.2 && z > -3) k *= 0.96;                                       // oil and dust low down
      return k;
    }
    function colour(g, col) {
      const p = g.attributes.position, n = g.attributes.normal, N = p.count;
      const out = new Float32Array(N * 3);
      const paint = col == null || (typeof col === "object" && col.paint != null);
      const fn = typeof col === "function" ? col : null;
      const base = paint ? RGB(PAINT) : (fn ? null : RGB(col));
      const tint = paint && col ? col.paint : 1;
      for (let i = 0; i < N; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        let r, gg, b;
        if (fn) { const c = fn(x, y, z, n ? n.getY(i) : 0); r = c[0]; gg = c[1]; b = c[2]; }
        else {
          const k = paint ? tint * weather(x, y, z, n ? n.getY(i) : 0) : 1;
          r = base[0] * k; gg = base[1] * k; b = base[2] * k;
        }
        out[i * 3] = r; out[i * 3 + 1] = gg; out[i * 3 + 2] = b;
      }
      g.setAttribute("color", new THREE.BufferAttribute(out, 3));
    }
    // put a MODEL-space geometry into a node's bucket (bucket: vc | glass | lamp)
    function put(node, g, col, bucket) {
      if (!g) return;
      if (Array.isArray(g)) { for (let i = 0; i < g.length; i++) put(node, g[i], col, bucket); return; }
      if (!g.attributes.normal) g.computeVertexNormals();
      bucket = bucket || "vc";
      if (bucket !== "glass") colour(g, col);
      const o = NODES[node][1];
      if (o[0] || o[1] || o[2]) g.translate(-o[0], -o[1], -o[2]);
      const b = BK[node] || (BK[node] = { vc: [], glass: [], lamp: [] });
      b[bucket].push(g);
    }
    function merge(list) {
      if (!list || !list.length) return null;
      let nv = 0, ni = 0;
      for (const g of list) { nv += g.attributes.position.count; ni += g.index ? g.index.count : g.attributes.position.count; }
      const P = new Float32Array(nv * 3), N = new Float32Array(nv * 3), U = new Float32Array(nv * 2);
      const hasC = list.every(function (g) { return !!g.attributes.color; });
      const Cc = hasC ? new Float32Array(nv * 3) : null;
      const I = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
      let vo = 0, io = 0;
      for (const g of list) {
        const p = g.attributes.position, n = g.attributes.normal, u = g.attributes.uv;
        P.set(p.array, vo * 3);
        if (n) N.set(n.array, vo * 3);
        if (u && u.itemSize === 2) U.set(u.array, vo * 2);
        if (Cc) Cc.set(g.attributes.color.array, vo * 3);
        if (g.index) { const a = g.index.array; for (let i = 0; i < a.length; i++) I[io + i] = a[i] + vo; io += a.length; }
        else { for (let i = 0; i < p.count; i++) I[io + i] = vo + i; io += p.count; }
        vo += p.count;
        g.dispose();
      }
      const out = new THREE.BufferGeometry();
      out.setAttribute("position", new THREE.BufferAttribute(P, 3));
      out.setAttribute("normal", new THREE.BufferAttribute(N, 3));
      out.setAttribute("uv", new THREE.BufferAttribute(U, 2));
      if (Cc) out.setAttribute("color", new THREE.BufferAttribute(Cc, 3));
      out.setIndex(new THREE.BufferAttribute(I, 1));
      out.computeBoundingSphere(); out.computeBoundingBox();
      out._shared = true;
      return out;
    }
    // flat-faceted: every triangle its own normal (the Apache's glazing)
    function flat(g) { const f = g.index ? g.toNonIndexed() : g; f.computeVertexNormals(); return f; }
    // a loft of polygon profiles [{z, pts:[[x,y]...]}], front (high z) first, open at the profile ends
    function prism(secs, closed) {
      const pos = [], m = secs[0].pts.length;
      for (let i = 0; i < secs.length - 1; i++) {
        const A = secs[i], B = secs[i + 1];
        for (let j = 0; j < (closed ? m : m - 1); j++) {
          const j1 = (j + 1) % m;
          const a = [A.pts[j][0], A.pts[j][1], A.z], b = [A.pts[j1][0], A.pts[j1][1], A.z];
          const c = [B.pts[j][0], B.pts[j][1], B.z], d = [B.pts[j1][0], B.pts[j1][1], B.z];
          pos.push.apply(pos, a.concat(c, b, b, c, d));
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(pos.length / 3 * 2), 2));
      g.computeVertexNormals();
      return g;
    }
    const xf = K.xf, mir = K.mir, box = K.box, rod = K.rod, rnd = K.rnd;
    function cylY(r0, r1, h, seg) { return new THREE.CylinderGeometry(r1, r0, h, seg || 14); }
    function at(g, x, y, z, rx, ry, rz) { return xf(g, x, y, z, rx, ry, rz); }

    // =================================================================
    //  FUSELAGE: slab-sided, narrow cockpit, the hump, the boom
    // =================================================================
    const FUS = [
      [5.62, 0.16, 0.16, 0.18, 1.44, 2.2],
      [5.40, 0.33, 0.28, 0.33, 1.45, 2.8],
      [5.00, 0.42, 0.34, 0.45, 1.45, 3.4],
      [4.40, 0.47, 0.37, 0.50, 1.44, 3.8],
      [3.30, 0.49, 0.39, 0.53, 1.44, 3.8],
      [3.10, 0.50, 0.47, 0.54, 1.45, 3.8],
      [1.70, 0.52, 0.45, 0.57, 1.50, 3.8],
      [1.05, 0.54, 1.02, 0.58, 1.56, 3.6],
      [0.00, 0.56, 1.10, 0.60, 1.60, 3.4],
      [-1.50, 0.54, 0.98, 0.56, 1.70, 3.2],
      [-2.70, 0.42, 0.70, 0.40, 1.86, 3.0],
      [-3.60, 0.30, 0.42, 0.28, 2.00, 3.0],
      [-5.50, 0.28, 0.35, 0.29, 2.06, 3.0],
      [-7.80, 0.22, 0.29, 0.24, 2.12, 3.0],
      [-8.80, 0.18, 0.25, 0.20, 2.14, 3.0],
      [-9.40, 0.06, 0.08, 0.07, 2.17, 2.4],
    ].map(function (r) { return { z: r[0], w: r[1], t: r[2], b: r[3], y: r[4], p: r[5] }; });
    function stationAt(z) {
      for (let i = 0; i < FUS.length - 1; i++) {
        const a = FUS[i], b = FUS[i + 1];
        if (z <= a.z && z >= b.z) {
          const t = (a.z - z) / (a.z - b.z);
          return { z: z, w: a.w + (b.w - a.w) * t, t: a.t + (b.t - a.t) * t, b: a.b + (b.b - a.b) * t, y: a.y + (b.y - a.y) * t, p: a.p + (b.p - a.p) * t };
        }
      }
      return FUS[FUS.length - 1];
    }
    put("body", K.loft(FUS, { n: 28 }), { paint: 1 });
    // panel seams round the hull
    [5.05, 3.20, 1.15, -0.95, -2.75, -3.62, -5.9, -8.2].forEach(function (z) {
      const s = stationAt(z), e = 0.006;
      const A = { z: z + 0.012, w: s.w + e, t: s.t + e, b: s.b + e, y: s.y, p: s.p }, B = Object.assign({}, A, { z: z - 0.012 });
      put("body", K.loft([A, B], { n: 28, caps: false }), C.seam);
    });
    // the cheeks: the extended forward avionics bays either side
    const CHEEK = [[3.10, 0.02, 0.02, 0.02], [2.90, 0.20, 0.36, 0.30], [2.55, 0.27, 0.46, 0.36], [0.40, 0.29, 0.48, 0.38],
      [-0.55, 0.26, 0.44, 0.34], [-0.95, 0.08, 0.12, 0.10], [-1.05, 0.02, 0.02, 0.02]];
    [-1, 1].forEach(function (s) {
      put("body", K.loft(CHEEK.map(function (c) { return { z: c[0], x: s * 0.66, y: 1.32, w: c[1], t: c[2], b: c[3], p: 4 }; }), { n: 20 }), { paint: 1 });
      // access panels on the bay sides, and the footholds
      const X = s * (0.66 + 0.29 * 0.97 + 0.006);
      [[2.30, 1.00], [0.70, -0.40]].forEach(function (r) {
        const z0 = r[0], z1 = r[1], y0 = 1.05, y1 = 1.62;
        put("body", [rod([X, y0, z0], [X, y0, z1], 0.006, 4), rod([X, y1, z0], [X, y1, z1], 0.006, 4),
          rod([X, y0, z0], [X, y1, z0], 0.006, 4), rod([X, y0, z1], [X, y1, z1], 0.006, 4)], C.seam);
      });
      put("body", [at(box(0.03, 0.05, 0.16), X, 1.02, 2.15), at(box(0.03, 0.05, 0.16), X, 1.68, 1.55)], C.black);
    });

    // =================================================================
    //  COCKPIT: flat-paned tandem canopy, frames, crew
    // =================================================================
    function prof(ys, yt, ws, wt) {
      const m = ys + (yt - ys) * 0.58;
      return [[ws, ys], [ws * 0.97, m], [wt, yt], [-wt, yt], [-ws * 0.97, m], [-ws, ys]];
    }
    const CAN = [
      [5.02, 1.80, 1.83, 0.40, 0.16], [4.42, 1.80, 2.30, 0.46, 0.22], [3.30, 1.82, 2.36, 0.48, 0.24],
      [3.22, 1.84, 2.38, 0.48, 0.24], [2.72, 1.86, 2.88, 0.49, 0.25], [1.55, 1.90, 2.92, 0.50, 0.27],
    ].map(function (c) { return { z: c[0], pts: prof(c[1], c[2], c[3], c[4]) }; });
    put("body", flat(prism(CAN)), null, "glass");
    // the opaque fairing behind the pilot, into the hump
    put("body", flat(prism([CAN[5], { z: 1.05, pts: prof(1.95, 2.80, 0.52, 0.32) }, { z: 0.40, pts: prof(2.0, 2.76, 0.56, 0.40) },
      { z: 0.0, pts: prof(2.0, 2.70, 0.55, 0.35) }])), { paint: 1 });
    // frames: every pane edge, painted
    {
      const fr = [];
      for (let i = 0; i < CAN.length; i++) {
        const S = CAN[i];
        if (i > 0) for (let j = 0; j < S.pts.length - 1; j++) fr.push(rod([S.pts[j][0], S.pts[j][1], S.z], [S.pts[j + 1][0], S.pts[j + 1][1], S.z], 0.022, 5));
        if (i < CAN.length - 1) {
          const N = CAN[i + 1];
          for (let j = 0; j < S.pts.length; j++) fr.push(rod([S.pts[j][0], S.pts[j][1], S.z], [N.pts[j][0], N.pts[j][1], N.z], j === 0 || j === 5 ? 0.03 : 0.02, 5));
        }
      }
      put("body", fr, { paint: 0.85 });
      // wire-strike cutters: over the gunner, over the pilot, under the nose
      put("body", [at(box(0.025, 0.06, 0.34), 0, 2.36, 4.30, -0.35), at(box(0.025, 0.06, 0.30), 0, 2.95, 2.62, -0.25),
        at(box(0.025, 0.24, 0.07), 0, 0.84, 5.10, 0.5)], C.gunmetal);
    }
    // glareshields + armoured seats + the two crew in IHADSS helmets
    put("body", [at(box(0.62, 0.09, 0.34), 0, 1.86, 4.48, -0.25), at(box(0.66, 0.09, 0.36), 0, 2.30, 2.98, -0.25)], C.black);
    [[3.82, 1.18], [2.25, 1.60]].forEach(function (c) {
      const z = c[0], y = c[1];
      put("body", [at(box(0.56, 0.72, 0.10), 0, y + 0.40, z - 0.24), at(box(0.06, 0.40, 0.46), 0.27, y + 0.22, z), at(box(0.06, 0.40, 0.46), -0.27, y + 0.22, z)], C.gunmetal);
      put("body", [at(box(0.40, 0.52, 0.26), 0, y + 0.44, z - 0.02),
        rod([0.21, y + 0.62, z], [0.15, y + 0.34, z + 0.34], 0.055, 6), rod([-0.21, y + 0.62, z], [-0.15, y + 0.34, z + 0.34], 0.055, 6),
        at(cylY(0.06, 0.06, 0.10, 8), 0, y + 0.74, z)], C.suit);
      put("body", at(new THREE.SphereGeometry(0.135, 12, 9), 0, y + 0.86, z + 0.01), C.helmet);
      put("body", [at(box(0.22, 0.07, 0.04), 0, y + 0.84, z + 0.135), at(new THREE.CylinderGeometry(0.018, 0.018, 0.07, 6), -0.05, y + 0.84, z + 0.17, PI / 2)], C.visor);
    });

    // =================================================================
    //  NOSE: TADS (the drum + two sensor boxes) and PNVS (on top)
    // =================================================================
    put("tadsYaw", [at(cylY(0.26, 0.26, 0.50, 18), 0, 1.22, 5.66), at(new THREE.SphereGeometry(0.26, 18, 6, 0, TAU, PI / 2, PI / 2), 0, 0.97, 5.66)], { paint: 0.95 });
    put("tadsYaw", at(cylY(0.12, 0.12, 0.08, 12), 0, 1.50, 5.66), C.gunmetal);
    [-1, 1].forEach(function (s) {
      put("tadsPitch", K.loft([{ z: 6.00, x: s * 0.36, y: 1.22, w: 0.10, t: 0.18, b: 0.18, p: 4 }, { z: 5.94, x: s * 0.36, y: 1.22, w: 0.12, t: 0.20, b: 0.20, p: 4 },
        { z: 5.45, x: s * 0.36, y: 1.22, w: 0.12, t: 0.20, b: 0.20, p: 4 }, { z: 5.38, x: s * 0.36, y: 1.22, w: 0.08, t: 0.15, b: 0.15, p: 4 }], { n: 16 }), { paint: 1 });
      // sensor windows: day TV / laser on the left box, FLIR on the right
      if (s > 0) put("tadsPitch", [at(box(0.15, 0.13, 0.02), s * 0.36, 1.30, 6.005), at(box(0.10, 0.09, 0.02), s * 0.36, 1.11, 6.005)], C.lens);
      else put("tadsPitch", at(new THREE.CylinderGeometry(0.085, 0.085, 0.02, 14), s * 0.36, 1.22, 6.005, PI / 2), C.lens);
    });
    put("pnvs", [at(cylY(0.14, 0.15, 0.24, 14), 0, 1.68, 5.50), at(new THREE.SphereGeometry(0.14, 14, 5, 0, TAU, 0, PI / 2), 0, 1.80, 5.50)], { paint: 0.95 });
    put("pnvs", at(box(0.15, 0.11, 0.03), 0, 1.69, 5.645), C.lens);

    // =================================================================
    //  ENGINES, MAST, HUMP FITTINGS
    // =================================================================
    [-1, 1].forEach(function (s) {
      const X = s * 0.92;
      put("body", K.loft([{ z: 0.80, x: X, y: 2.38, w: 0.27, t: 0.28, b: 0.27, p: 2.6 }, { z: 0.55, x: X, y: 2.38, w: 0.31, t: 0.32, b: 0.30, p: 2.8 },
        { z: -1.90, x: X, y: 2.38, w: 0.31, t: 0.31, b: 0.29, p: 2.8 }, { z: -2.35, x: X, y: 2.38, w: 0.26, t: 0.26, b: 0.25, p: 2.8 }], { n: 20, capFront: false }), { paint: 1 });
      put("body", K.loft([{ z: -0.78, x: X, y: 2.38, w: 0.317, t: 0.317, b: 0.297, p: 2.8 }, { z: -0.80, x: X, y: 2.38, w: 0.317, t: 0.317, b: 0.297, p: 2.8 }], { n: 20, caps: false }), C.seam);
      put("body", at(new THREE.CircleGeometry(0.24, 18), X, 2.38, 0.74), C.black);           // intake + particle separator
      put("body", at(new THREE.TorusGeometry(0.25, 0.025, 6, 20), X, 2.38, 0.79), C.gunmetal);
      // the pylon joining the nacelle to the hull
      put("body", at(box(0.30, 0.34, 2.4), s * 0.62, 2.22, -0.70), { paint: 0.97 });
      // Black Hole suppressor: the duct turns outboard and up; soot inside
      const ex = K.loft([{ z: -2.30, x: X, y: 2.38, w: 0.24, t: 0.22, b: 0.22, p: 3.5 }, { z: -2.70, x: X + s * 0.10, y: 2.42, w: 0.22, t: 0.24, b: 0.20, p: 3.5 },
        { z: -3.05, x: X + s * 0.26, y: 2.47, w: 0.20, t: 0.26, b: 0.18, p: 3.5 }], { n: 16, capBack: false });
      put("body", ex, { paint: 0.9 });
      put("body", K.loft([{ z: -3.02, x: X + s * 0.255, y: 2.47, w: 0.17, t: 0.22, b: 0.15, p: 3.5 }, { z: -3.04, x: X + s * 0.258, y: 2.47, w: 0.17, t: 0.22, b: 0.15, p: 3.5 }], { n: 16 }), C.black);
    });
    // mast, fairing, swashplate (static half)
    put("body", [at(cylY(0.36, 0.22, 0.42, 16), 0, 2.88, 0), at(cylY(0.16, 0.16, 0.95, 12), 0, 3.25, 0)], { paint: 0.9 });
    put("body", at(cylY(0.36, 0.36, 0.06, 18), 0, 3.24, 0), C.gunmetal);
    // Longbow fire-control radar on its static mast extension
    put("body", at(cylY(0.09, 0.09, 0.50, 10), 0, 4.18, 0), C.gunmetal);
    put("body", K.loft([{ z: 0.40, y: 4.62, w: 0.30, t: 0.18, b: 0.18, p: 2.6 }, { z: 0.30, y: 4.62, w: 0.42, t: 0.24, b: 0.22, p: 2.6 },
      { z: -0.20, y: 4.62, w: 0.45, t: 0.26, b: 0.24, p: 2.6 }, { z: -0.38, y: 4.62, w: 0.30, t: 0.20, b: 0.18, p: 2.6 },
      { z: -0.42, y: 4.62, w: 0.05, t: 0.04, b: 0.04, p: 2 }], { n: 20 }), { paint: 1.12 });
    // ALQ-144 IR jammer behind the mast, antennas, chaff dispensers
    put("body", at(cylY(0.15, 0.15, 0.26, 14), 0, 2.74, -2.20), C.black);
    put("body", [at(box(0.02, 0.24, 0.20), 0, 2.48, -5.0, 0, 0, 0), at(box(0.02, 0.18, 0.14), 0, 0.88, -0.55), at(box(0.02, 0.16, 0.12), 0, 2.80, 1.05)], C.gunmetal);
    [-1, 1].forEach(function (s) {
      put("body", at(box(0.08, 0.18, 0.32), s * 0.27, 2.05, -4.20), C.gunmetal);
      put("body", at(new THREE.SphereGeometry(0.05, 8, 6), s * 0.40, 1.52, 5.12), C.black);   // radar-warning receivers
    });

    // =================================================================
    //  STUB WINGS, PYLONS, STORES
    // =================================================================
    {
      const sw = K.wing([{ x: 0.50, le: 0.65, c: 1.30, tc: 0.16, y: 1.98 }, { x: 2.55, le: 0.45, c: 1.05, tc: 0.12, y: 1.98 }], { K: 6 });
      put("body", [sw, mir(sw)], { paint: 1 });
      [-1, 1].forEach(function (s) {
        // wingtip fairings (the Stinger / RF-interferometer stations) + nav lights
        put("body", K.loft([rnd(0.50, 0.01, 1.98, s * 2.60), rnd(0.40, 0.065, 1.98, s * 2.60), rnd(-0.45, 0.065, 1.98, s * 2.60), rnd(-0.58, 0.01, 1.98, s * 2.60)], { n: 10 }), { paint: 0.95 });
        put("body", at(new THREE.SphereGeometry(0.045, 8, 6), s * 2.60, 1.98, 0.50), s > 0 ? 0xff3b30 : 0x30d070, "lamp");
      });
      put("body", at(new THREE.SphereGeometry(0.05, 8, 6), 0, 4.03, -9.62), 0xf2f4ff, "lamp");
      put("body", at(new THREE.SphereGeometry(0.06, 8, 6), 0, 2.84, -1.0), 0xff2a20, "lamp");
    }
    // pylons: an aerofoil on end under each hardpoint
    ["pylIL", "pylIR", "pylOL", "pylOR"].forEach(function (k) {
      const o = NODES[k][1];
      const outb = k.charAt(3) === "O";
      put(k, K.pylon(o[0], 1.93, outb ? 1.70 : 1.62, 0.70, 0.95), { paint: 0.92 });
    });
    // M261 rocket pods on the inboard pylons
    ["pylIL", "pylIR"].forEach(function (k) {
      const x = NODES[k][1][0];
      const P = K.pod(POD.len, POD.r);
      put(k, at(P.body, x, POD.y, POD.z), { paint: 0.95 });
      put(k, at(P.face, x, POD.y, POD.z), C.gunmetal);
      const fz = POD.z + POD.len / 2 - 0.015;
      put(k, TUBES.map(function (t) { return at(new THREE.CircleGeometry(0.034, 10), x + t[0], POD.y + t[1], fz); }), C.black);
      put(k, [at(new THREE.TorusGeometry(POD.r - 0.005, 0.012, 5, 22), x, POD.y, POD.z + 0.35), at(new THREE.TorusGeometry(POD.r - 0.005, 0.012, 5, 22), x, POD.y, POD.z - 0.45)], C.seam);
    });
    // M299 launchers on the outboard pylons: spine and two rail beams
    ["pylOL", "pylOR"].forEach(function (k) {
      const x = NODES[k][1][0];
      put(k, [at(box(0.09, 0.46, 1.30), x, 1.47, HF_Z), at(box(0.54, 0.035, 1.20), x, 1.645, HF_Z), at(box(0.54, 0.035, 1.20), x, 1.325, HF_Z)], { paint: 0.88 });
    });

    // =================================================================
    //  GEAR, TAIL, STABILATOR
    // =================================================================
    [-1, 1].forEach(function (s) {
      const ax = [s * 1.02, 0.33, 2.02];
      put("body", [rod([s * 0.80, 0.92, 2.55], [ax[0], ax[1] + 0.05, ax[2]], 0.06, 8), rod([s * 1.0, 0.48, 2.08], [s * 0.86, 1.05, 1.72], 0.075, 10),
        rod([s * 0.80, 0.92, 2.55], [s * 0.86, 1.05, 1.72], 0.04, 6), rod([s * 0.70, 0.98, 2.55], [s * 0.90, 0.98, 2.55], 0.05, 6)], { paint: 0.82 });
      const wh = K.wheel(0.33, 0.20);
      put("body", at(wh.tire, ax[0], ax[1], ax[2]), C.rubber);
      put("body", at(wh.hub, ax[0], ax[1], ax[2]), C.gunmetal);
    });
    // the tailwheel's faired leg under the boom
    put("body", at(K.wing([{ x: 0, le: -8.05, c: 0.85, tc: 0.12 }, { x: 0.62, le: -8.28, c: 0.42, tc: 0.12 }], { K: 4 }), 0, 1.98, 0, 0, 0, -PI / 2), { paint: 0.95 });
    put("body", [rod([0, 1.45, -8.42], [0, 0.42, -8.55], 0.06, 8), rod([0.07, 0.45, -8.55], [0.07, 0.19, -8.62], 0.03, 6), rod([-0.07, 0.45, -8.55], [-0.07, 0.19, -8.62], 0.03, 6)], { paint: 0.85 });
    {
      const tw = K.wheel(0.19, 0.11);
      put("body", at(tw.tire, 0, 0.19, -8.62), C.rubber);
      put("body", at(tw.hub, 0, 0.19, -8.62), C.gunmetal);
    }
    // the fin (swept, NACA section) and the tail-rotor gearbox on its port face
    const fin = K.wing([{ x: 0, le: -7.70, c: 1.75, tc: 0.14 }, { x: 1.70, le: -8.75, c: 0.95, tc: 0.12 }], { K: 6 });
    put("body", at(fin, 0, 2.30, 0, 0, 0, PI / 2), { paint: 1 });
    put("body", K.loft([rnd(-8.80, 0.02, DIM.tail[1], 0.10), rnd(-8.88, 0.13, DIM.tail[1], 0.12), rnd(-9.20, 0.13, DIM.tail[1], 0.12), rnd(-9.32, 0.03, DIM.tail[1], 0.10)], { n: 12 }), { paint: 0.95 });
    put("body", at(new THREE.CylinderGeometry(0.06, 0.08, 0.30, 10), 0.28, DIM.tail[1], DIM.tail[2], 0, 0, PI / 2), C.gunmetal);
    // the stabilator: all-moving, pivoting on its quarter chord
    {
      const st = K.wing([{ x: 0.12, le: -8.05, c: 0.85, tc: 0.10, y: 2.24 }, { x: 1.70, le: -8.10, c: 0.72, tc: 0.09, y: 2.24 }], { K: 5 });
      put("stab", [st, mir(st)], { paint: 1 });
    }

    // =================================================================
    //  CHIN GUN: the M230 in its turret
    // =================================================================
    put("body", at(cylY(0.27, 0.24, 0.10, 18), 0, 0.93, 3.45), { paint: 0.9 });
    put("chinYaw", [at(cylY(0.20, 0.20, 0.06, 16), 0, 0.88, 3.45), at(box(0.05, 0.26, 0.40), 0.15, 0.76, 3.45), at(box(0.05, 0.26, 0.40), -0.15, 0.76, 3.45)], C.gunmetal);
    put("chinPitch", [at(box(0.20, 0.23, 0.64), 0, 0.72, 3.50), rod([0.08, 0.84, 3.30], [0.18, 0.90, 3.05], 0.05, 6), at(cylY(0.05, 0.05, 0.25, 8), 0, 0.72, 3.45, 0, 0, PI / 2)], C.gunmetal);
    put("barrel", [at(new THREE.CylinderGeometry(0.065, 0.065, 0.24, 10), 0, 0.72, 3.88, PI / 2), at(new THREE.CylinderGeometry(0.042, 0.042, 0.92, 10), 0, 0.72, 4.42, PI / 2),
      at(new THREE.CylinderGeometry(0.06, 0.055, 0.16, 10), 0, 0.72, 4.85, PI / 2)], C.gunmetal);
    put("barrel", at(new THREE.CircleGeometry(0.032, 8), 0, 0.72, 4.932), C.black);

    // ---- bake the buckets ---------------------------------------------------
    const G = Object.create(null);
    for (const k in BK) G[k] = { vc: merge(BK[k].vc), glass: merge(BK[k].glass), lamp: merge(BK[k].lamp) };

    // =================================================================
    //  ROTORS (built in their own node space)
    // =================================================================
    function bladeGeo(tipX) {
      const parts = [];
      // grip + strap pack from the flap hinge to the cuff
      parts.push(at(box(0.48, 0.13, 0.20), 0.24, 0, 0));
      parts.push(at(box(0.10, 0.06, 0.20), 0.12, 0.10, 0.10));            // pitch horn
      const st = [{ x: 0.45, le: 0.11, c: 0.40, tc: 0.20 }, { x: 0.90, le: 0.133, c: 0.533, tc: 0.10 }];
      if (tipX > 6.6) st.push({ x: 6.50, le: 0.133, c: 0.533, tc: 0.095 }, { x: 7.015, le: -0.06, c: 0.33, tc: 0.07 });
      else st.push({ x: tipX - 0.25, le: 0.133, c: 0.533, tc: 0.095 }, { x: tipX, le: 0.05, c: 0.30, tc: 0.08 });  // snapped: a ragged stub
      parts.push(K.wing(st, { K: 5 }));
      const g = merge(parts.map(function (p) {
        // leading edge toward -Z (the rotor turns counter-clockwise seen from above)
        K.xm(p, new THREE.Matrix4().makeScale(1, 1, -1));
        if (!p.attributes.normal) p.computeVertexNormals();
        colour(p, function (x, y, z) { return RGB(x > 0.8 && z < -0.07 && x < 7.0 ? C.edge : C.blade); });
        return p;
      }));
      return g;
    }
    G.blade = bladeGeo(7.015);
    G.bladeStub = bladeGeo(2.3);
    {
      const parts = [cylY(0.30, 0.30, 0.28, 16), at(cylY(0.20, 0.12, 0.16, 14), 0, 0.22, 0), at(cylY(0.30, 0.30, 0.05, 16), 0, -0.55, 0)];
      for (let i = 0; i < 4; i++) {
        const a = i * PI / 2 + 0.3, c = Math.cos(a), s = -Math.sin(a);
        parts.push(rod([c * 0.30, -0.53, s * 0.30], [c * 0.36, -0.10, s * 0.36], 0.018, 5));       // pitch links
      }
      parts.forEach(function (p) { if (!p.attributes.normal) p.computeVertexNormals(); colour(p, C.gunmetal); });
      G.hub = merge(parts);
    }
    {
      const parts = [at(new THREE.CylinderGeometry(0.09, 0.09, 0.16, 10), 0.03, 0, 0, 0, 0, PI / 2)];
      [0, 55, 180, 235].forEach(function (deg) {
        const b = K.wing([{ x: 0.10, le: 0.10, c: 0.22, tc: 0.12 }, { x: 0.22, le: 0.127, c: 0.254, tc: 0.10 }, { x: DIM.tailR, le: 0.127, c: 0.254, tc: 0.08 }], { K: 4 });
        xf(b, 0, 0, 0, 0.14, 0, 0);                // blade pitch
        xf(b, 0, 0, 0, 0, 0, PI / 2);             // along +Y
        xf(b, 0.06, 0, 0, deg * PI / 180, 0, 0);  // the scissor angle
        parts.push(b);
      });
      parts.forEach(function (p) { if (!p.attributes.normal) p.computeVertexNormals(); colour(p, C.blade); });
      G.tail = merge(parts);
    }
    // rotor blur discs
    G.disc = new THREE.RingGeometry(0.5, DIM.rotorR - 0.05, 56, 1); G.disc.rotateX(-PI / 2); G.disc._shared = true;
    G.tdisc = new THREE.CircleGeometry(DIM.tailR, 28); G.tdisc.rotateY(PI / 2); G.tdisc._shared = true;

    // =================================================================
    //  STORES (instanced per launcher)
    // =================================================================
    {
      const r = 0.089, h = HF_LEN / 2;
      const parts = [K.loft([rnd(h, 0.004), rnd(h - 0.05, 0.05), rnd(h - 0.13, r), rnd(-h + 0.02, r), rnd(-h, r * 0.82)], { n: 12 })];
      for (let k = 0; k < 4; k++) {
        const a = k * PI / 2 + PI / 4;
        parts.push(xf(K.wing([{ x: r * 0.9, le: 0.05, c: 0.28, tc: 0.05 }, { x: 0.165, le: -0.04, c: 0.17, tc: 0.05 }], { K: 3 }), 0, 0, 0, 0, 0, a));
        parts.push(xf(K.wing([{ x: r * 0.9, le: -0.66, c: 0.13, tc: 0.05 }, { x: 0.15, le: -0.70, c: 0.08, tc: 0.05 }], { K: 3 }), 0, 0, 0, 0, 0, a));
      }
      parts.push(at(box(0.04, 0.03, 0.9), 0, r + 0.012, -0.05));        // rail shoe
      parts.forEach(function (p) {
        if (!p.attributes.normal) p.computeVertexNormals();
        colour(p, function (x, y, z) { return RGB(z > h - 0.13 ? C.seeker : (z > 0.40 && z < 0.46 ? C.yellow : C.hellfire)); });
      });
      G.hellfire = merge(parts);
    }
    {
      const tip = new THREE.CylinderGeometry(0.001, 0.034, 0.16, 8); tip.rotateX(PI / 2);
      colour(tip, function (x, y, z) { return RGB(z < -0.03 && z > -0.06 ? C.yellow : C.hydra); });
      G.hydra = merge([tip]);
    }
    G.flag = new THREE.PlaneGeometry(0.56, 0.35); G.flag._shared = true;

    // ---- materials ------------------------------------------------------------
    let vc = null;
    try { vc = CBZ.cmat ? CBZ.cmat(0xffffff, { vc: true }) : null; } catch (e) { vc = null; }
    if (!vc || !vc.vertexColors) { vc = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true }); vc._shared = true; }
    const M = {
      vc: vc,
      glass: new THREE.MeshPhongMaterial({ color: 0x24323a, specular: 0xa8bcc8, shininess: 90, transparent: true, opacity: 0.38, side: THREE.DoubleSide, depthWrite: false }),
      lamp: new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true }),
      disc: new THREE.MeshBasicMaterial({ color: 0x14181a, transparent: true, opacity: 0.09, side: THREE.DoubleSide, depthWrite: false }),
      tdisc: new THREE.MeshBasicMaterial({ color: 0x14181a, transparent: true, opacity: 0.2, side: THREE.DoubleSide, depthWrite: false }),
    };
    M.glass._shared = M.lamp._shared = M.disc._shared = M.tdisc._shared = true;
    TPL = { G: G, M: M };
    return TPL;
  }

  // ---- nation flags on the fin ------------------------------------------------
  const FLAGM = Object.create(null);
  // one material per flag: `id` keys the cache, `design` (ctx.flag) wins over a lookup
  function flagMat(id, design) {
    if (FLAGM[id] !== undefined) return FLAGM[id];
    const THREE = window.THREE, F = CBZ.flags;
    let m = null;
    try {
      const d = design || (F && F.designFor ? F.designFor(id) : null);
      if (THREE && F && F.paint && d && typeof document !== "undefined") {
        const c = document.createElement("canvas"); c.width = 160; c.height = 100;
        const g = c.getContext && c.getContext("2d");
        if (g) {
          F.paint(g, d, 160, 100, { grain: false });
          const t = new THREE.CanvasTexture(c);
          if (THREE.sRGBEncoding) t.encoding = THREE.sRGBEncoding;
          m = new THREE.MeshLambertMaterial({ map: t, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 });
          m._shared = true;
        }
      }
    } catch (e) { m = null; }
    return (FLAGM[id] = m);
  }

  // =====================================================================
  //  BUILD: one airframe, sharing every geometry and material
  // =====================================================================
  const _zero = { m: null };

  function build(ctx) {
    const T = template();
    if (!T) return null;
    const THREE = window.THREE, G = T.G, M = T.M;
    const root = new THREE.Group(); root.name = "ah64-apache";
    const lean = new THREE.Group(); lean.name = "ah64-lean"; lean.position.y = DIM.cgY; root.add(lean);
    const N = Object.create(null);
    N.body = new THREE.Group(); N.body.name = "ah64-body"; N.body.position.y = -DIM.cgY; lean.add(N.body);
    for (const k in NODES) {
      if (k === "body") continue;
      const d = NODES[k], po = NODES[d[0]][1], o = d[1];
      const g = new THREE.Group(); g.name = "ah64-" + k;
      g.position.set(o[0] - po[0], o[1] - po[1], o[2] - po[2]);
      N[k] = g;
    }
    for (const k in NODES) if (k !== "body") N[NODES[k][0]].add(N[k]);
    function mesh(geo, mat, parent, shadow) {
      if (!geo) return null;
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = shadow !== false; m.receiveShadow = true;
      parent.add(m); return m;
    }
    let fus = null;
    const lamps = [];
    for (const k in G) {
      if (!N[k] || !G[k] || !G[k].vc && !G[k].glass) continue;
      const m = mesh(G[k].vc, M.vc, N[k]);
      if (k === "body") fus = m;
      mesh(G[k].glass, M.glass, N[k], false);
      const lm = mesh(G[k].lamp, M.lamp, N[k], false); if (lm) lamps.push(lm);
    }
    // rotor: hub + four blades on flap hinges
    mesh(G.hub, M.vc, N.rotor);
    const blades = [];
    for (let i = 0; i < 4; i++) {
      const arm = new THREE.Group(); arm.rotation.y = i * PI / 2; N.rotor.add(arm);
      const flap = new THREE.Group(); flap.position.x = 0.30; flap.rotation.order = "ZYX"; arm.add(flap);
      blades.push({ flap: flap, mesh: mesh(G.blade, M.vc, flap), az: i * PI / 2 });
    }
    const disc = mesh(G.disc, M.disc, N.body, false); disc.position.y = DIM.hubY + 0.02; disc.visible = false;
    mesh(G.tail, M.vc, N.tail);
    const tdisc = mesh(G.tdisc, M.tdisc, N.body, false); tdisc.position.set(DIM.tail[0] + 0.06, DIM.tail[1], DIM.tail[2]); tdisc.visible = false;
    // stores
    const _m = new THREE.Matrix4();
    function launcher(node, geo, list) {
      const im = new THREE.InstancedMesh(geo, M.vc, list.length);
      for (let i = 0; i < list.length; i++) im.setMatrixAt(i, _m.makeTranslation(list[i][0], list[i][1], list[i][2]));
      im.frustumCulled = false; im.castShadow = true;
      node.add(im); return im;
    }
    const hfPos = RAILS.map(function (r) { return [r[0], r[1] - NODES.pylOL[1][1], HF_Z - NODES.pylOL[1][2]]; });
    const hyPos = TUBES.map(function (t) { return [t[0], POD.y + t[1] - NODES.pylIL[1][1], POD.z + POD.len / 2 - 0.06 - NODES.pylIL[1][2]]; });
    const hf = [launcher(N.pylOL, G.hellfire, hfPos), launcher(N.pylOR, G.hellfire, hfPos)];
    const hy = [launcher(N.pylIL, G.hydra, hyPos), launcher(N.pylIR, G.hydra, hyPos)];
    // fin flags (both faces; starboard reversed so the hoist leads)
    const flags = [];
    [-1, 1].forEach(function (s) {
      const f = new THREE.Mesh(G.flag, M.vc);
      f.position.set(s * 0.105, 2.72, -8.88);
      f.rotation.y = s * PI / 2;
      if (s < 0) f.scale.x = -1;
      f.visible = false; f.castShadow = false;
      N.body.add(f); flags.push(f);
    });

    const R = {
      group: root, lean: lean, nodes: N, fus: fus, mat0: M.vc, blades: blades, disc: disc, tdisc: tdisc,
      lamps: lamps, hf: hf, hy: hy, hfPos: hfPos, hyPos: hyPos, hfShot: 0, hyShot: 0, flags: flags,
      clock: 0, px: 0, py: 0, pz: 0, h0: 0, vx: 0, vz: 0, vy: 0, fwdA: 0, yawRate: 0, dead: false,
      rpm: 1, rotA: (ctx && ctx.seed || 0) * 1.37, tA: 0, cone: 0.03, rec: 0, stabA: -0.44,
      aimY: 0, aimP: 0, aimT: -1e9, dustT: 0, broken: false, seeded: false, wob: (ctx && ctx.seed || 0) * 2.1,
    };
    const rig = {
      turret: null,
      settle: function () { R.seeded = false; tick(R, true, 0, null); },
      muzzleWorld: function (out, shot) { return muzzle(R, out, shot); },
      fire: function (shot) { fire(R, shot); },
      aimError: function (shot) {
        if (!shot || shot.wid !== "m230_30mm") return 0;
        const ay = clamp(N.aimYaw.rotation.y, -GUN.yawMax, GUN.yawMax), ap = clamp(N.aimPitch.rotation.x, GUN.up, GUN.down);
        return Math.max(Math.abs(ay - N.chinYaw.rotation.y), Math.abs(ap - N.chinPitch.rotation.x));
      },
      setNation: function (id, design) {
        const m = id || design ? flagMat(String(id || "flag"), design) : null;
        for (let i = 0; i < flags.length; i++) { flags[i].material = m || M.vc; flags[i].visible = !!m; }
        return !!m;
      },
      state: R,
    };
    R.rig = rig;
    // the battle runtime's air hooks: milAirAim lays the two aim nodes; the
    // real turret follows them at its own rate (tick)
    root.userData.chinGun = { yaw: N.aimYaw.name, pitch: N.aimPitch.name, muzzle: N.barrel.name };
    root.userData.rig = rig;
    root.userData.aircraftDims = { family: "AH-64E", length: DIM.length, span: DIM.rotorSpan, height: DIM.height, bodyW: DIM.wingSpan, bodyL: 15.5 };
    root.userData.crewSeats = [
      { job: "Pilot", x: 0, y: 1.60, z: 2.25, yaw: 0, cushionH: 0.42, floorBelow: 0.42 },
      { job: "Copilot/Gunner", x: 0, y: 1.18, z: 3.82, yaw: 0, cushionH: 0.42, floorBelow: 0.42 },
    ];
    if (ctx && (ctx.nation || ctx.flag)) rig.setNation(ctx.nation || ctx.flagId, ctx.flag);
    tick(R, true, 0, null);
    return { group: root, rig: rig, footW: DIM.rotorSpan, footL: DIM.length, height: DIM.height };
  }

  // ---- the weapons' ends --------------------------------------------------------
  let _w = null;
  function worldAt(node, x, y, z, out) {
    const THREE = window.THREE;
    if (!_w) _w = new THREE.Vector3();
    out = out || _w;
    let r = node; while (r.parent) r = r.parent;
    r.updateMatrixWorld(true);
    return node.localToWorld(out.set(x, y, z));
  }
  // where the round in hand leaves: the next rail, the next tube, else the chin gun
  function muzzle(R, out, shot) {
    const N = R.nodes, wid = shot && shot.wid;
    if (wid === "agm114_hellfire" && R.hfShot < HF_N) {
      const i = R.hfShot, side = i & 1, rail = i >> 1, p = R.hfPos[rail];
      return worldAt(side ? N.pylOR : N.pylOL, p[0], p[1], p[2] + HF_LEN / 2 + 0.05, out);
    }
    if (wid === "hydra70" && R.hyShot < HY_N) {
      const i = R.hyShot, side = i & 1, tube = i >> 1, p = R.hyPos[Math.min(tube, R.hyPos.length - 1)];
      return worldAt(side ? N.pylIR : N.pylIL, p[0], p[1], p[2] + 0.12, out);
    }
    return worldAt(N.barrel, 0, 0, 1.49, out);
  }
  // a round leaves: the gun kicks and flashes; a store leaves its rail or tube
  function fire(R, shot) {
    const wid = shot && shot.wid;
    if (wid !== "agm114_hellfire" && wid !== "hydra70") {
      R.rec = 1;
      if (CBZ.muzzleFlash) { try { CBZ.muzzleFlash(worldAt(R.nodes.barrel, 0, 0, 1.48, _w), { scale: 1.4 }); } catch (e) {} }
      return;
    }
    const THREE = window.THREE;
    const zero = _zero.m || (_zero.m = new THREE.Matrix4().makeScale(0, 0, 0));
    let p = null;
    if (wid === "agm114_hellfire" && R.hfShot < HF_N) {
      const i = R.hfShot++, im = R.hf[i & 1];
      im.setMatrixAt(i >> 1, zero); im.instanceMatrix.needsUpdate = true;
      p = worldAt(i & 1 ? R.nodes.pylOR : R.nodes.pylOL, R.hfPos[i >> 1][0], R.hfPos[i >> 1][1], R.hfPos[i >> 1][2] - 0.6);
    } else if (wid === "hydra70" && R.hyShot < HY_N) {
      const i = R.hyShot++, im = R.hy[i & 1];
      if ((i >> 1) < R.hyPos.length) { im.setMatrixAt(i >> 1, zero); im.instanceMatrix.needsUpdate = true; }
      p = worldAt(i & 1 ? R.nodes.pylIR : R.nodes.pylIL, 0, R.hyPos[0][1], -0.85);
    }
    if (!p) return;
    // launch: motor flash at the tube, white motor smoke behind the launcher
    try { if (CBZ.muzzleFlash) CBZ.muzzleFlash(p, { scale: 1.6, color: 0xffd6a0, life: 0.09 }); } catch (e) {}
    try { if (CBZ.cityCrashSmoke) CBZ.cityCrashSmoke(p.x, p.y - 0.8, p.z, { count: 1, scale: 0.6, shade: 0.78 }); } catch (e) {}
  }

  // ---- the rig: every moving part, once per animate (the battle clock) ------------
  function tick(R, snap, dt, ctx) {
    if (!(dt > 0)) dt = 0;
    if (dt > 0.1) dt = 0.1;
    R.clock += dt;
    const now = R.clock * 1000;
    const g = R.group, N = R.nodes;
    if (ctx && ctx.dead) R.dead = true;
    const wrecked = R.dead;
    // motion, read off the airframe's own transform
    const px = g.position.x, py = g.position.y, pz = g.position.z, h = g.rotation.y;
    if (!R.seeded || snap) { R.px = px; R.py = py; R.pz = pz; R.h0 = h; R.seeded = true; }
    if (dt > 0) {
      const k = Math.min(1, dt * 4);
      const vx = (px - R.px) / dt, vz = (pz - R.pz) / dt;
      const fx = Math.sin(h), fz = Math.cos(h);
      const fwdOld = R.vx * fx + R.vz * fz;
      R.vx += (vx - R.vx) * k; R.vz += (vz - R.vz) * k;
      const fwd = R.vx * fx + R.vz * fz;
      R.fwdA += ((fwd - fwdOld) / dt - R.fwdA) * Math.min(1, dt * 2);
      R.yawRate += (wrap(h - R.h0) / dt - R.yawRate) * k;
    }
    R.px = px; R.py = py; R.pz = pz; R.h0 = h;
    const spd = Math.hypot(R.vx, R.vz);
    let agl;
    if (ctx && isFinite(ctx.agl)) agl = ctx.agl;
    else { let gy0 = 0; try { gy0 = CBZ.floorAt ? (+CBZ.floorAt(px, pz) || 0) : 0; } catch (e) { gy0 = 0; } agl = py - gy0; }
    const gy = py - agl;
    const flying = agl > 1.2 && !wrecked;
    // ---- rotors: spool, spin, blade flapping -------------------------------------
    const rpmT = wrecked ? 0 : 1;
    R.rpm += (rpmT - R.rpm) * Math.min(1, dt * (wrecked ? 0.3 : 0.8));
    if (R.rpm < 0.01) R.rpm = 0;
    R.rotA = (R.rotA + DIM.omega * R.rpm * dt) % TAU;
    R.tA = (R.tA + DIM.omegaTail * R.rpm * dt) % TAU;
    N.rotor.rotation.y = R.rotA;
    N.tail.rotation.x = R.tA;
    const lift = flying ? 1 : 0.12;
    const coneT = -0.035 * (1 - R.rpm) + R.rpm * (0.006 + 0.05 * lift);
    R.cone = snap ? coneT : R.cone + (coneT - R.cone) * Math.min(1, dt * 3);
    const a1 = flying ? clamp(0.012 + spd * 0.0007 + R.fwdA * 0.004, -0.03, 0.08) : 0;   // disc tilts into the flight
    const coll = R.rpm * (0.03 + 0.11 * lift);
    for (let i = 0; i < 4; i++) {
      const B = R.blades[i], th = R.rotA + B.az;
      B.flap.rotation.z = R.cone + a1 * Math.sin(th);        // lowest over the nose
      B.flap.rotation.x = coll + a1 * 0.5 * Math.cos(th);   // cyclic feathering
    }
    const spinning = dt > 0 && R.rpm > 0.55;
    R.disc.visible = spinning; R.tdisc.visible = spinning;
    // ---- the airframe: bank, flare, hover wander, stabilator, pylons --------------------
    if (flying) {
      R.wob += dt;
      const bank = clamp(Math.atan(spd * R.yawRate / 9.81), -0.45, 0.45);
      const flare = clamp(R.fwdA / 9.81 * 0.9, -0.18, 0.18);
      const k = snap ? 1 : Math.min(1, dt * 2.5);
      R.lean.rotation.z += (-bank + 0.006 * Math.sin(R.wob * 0.9) - R.lean.rotation.z) * k;
      R.lean.rotation.x += (flare + 0.008 * Math.sin(R.wob * 0.7 + 1) - R.lean.rotation.x) * k;
    } else if (!wrecked) {
      R.lean.rotation.x *= 1 - Math.min(1, dt * 3); R.lean.rotation.z *= 1 - Math.min(1, dt * 3);
    }
    const stabT = -0.44 * (1 - clamp((spd - 8) / 30, 0, 1));
    R.stabA = snap ? stabT : R.stabA + (stabT - R.stabA) * Math.min(1, dt * 1.5);
    N.stab.rotation.x = R.stabA;
    const pyl = clamp(-(g.rotation.x + R.lean.rotation.x), -0.087, 0.07);
    N.pylIL.rotation.x = N.pylIR.rotation.x = N.pylOL.rotation.x = N.pylOR.rotation.x = pyl;
    // ---- the gun, TADS, PNVS ------------------------------------------------------------
    const ay = N.aimYaw.rotation.y, ap = N.aimPitch.rotation.x;
    if (Math.abs(ay - R.aimY) > 1e-5 || Math.abs(ap - R.aimP) > 1e-5) { R.aimY = ay; R.aimP = ap; R.aimT = now; }
    const live = now - R.aimT < 5000 && !wrecked;
    const wy = live ? clamp(ay, -GUN.yawMax, GUN.yawMax) : 0;
    const wp = live ? clamp(ap, GUN.up, GUN.down) : GUN.up;    // stowed: forward and up, clear of the ground
    if (snap) { N.chinYaw.rotation.y = wy; N.chinPitch.rotation.x = wp; }
    else {
      N.chinYaw.rotation.y += clamp(wy - N.chinYaw.rotation.y, -GUN.yawRate * dt, GUN.yawRate * dt);
      N.chinPitch.rotation.x += clamp(wp - N.chinPitch.rotation.x, -GUN.elevRate * dt, GUN.elevRate * dt);
    }
    const ty = live ? clamp(ay, -2.09, 2.09) : 0, tp = live ? clamp(ap, -0.52, 1.05) : 0.05;
    N.tadsYaw.rotation.y += clamp(ty - N.tadsYaw.rotation.y, -1.6 * dt, 1.6 * dt) + (snap ? ty - N.tadsYaw.rotation.y : 0);
    N.tadsPitch.rotation.x += clamp(tp - N.tadsPitch.rotation.x, -1.2 * dt, 1.2 * dt) + (snap ? tp - N.tadsPitch.rotation.x : 0);
    N.pnvs.rotation.y = wrecked ? N.pnvs.rotation.y : 0.55 * Math.sin(now * 0.00035 + R.wob);   // the pilot's head scans
    R.rec = Math.max(0, R.rec - dt * 14);
    N.barrel.position.z = -0.07 * R.rec;
    // ---- rotor wash -----------------------------------------------------------------------
    if (dt > 0 && !wrecked && R.rpm > 0.7 && agl < 28 && CBZ.cityDustKick) {
      R.dustT -= dt;
      if (R.dustT <= 0) {
        R.dustT = 0.12 + agl * 0.006;
        const a = Math.random() * TAU, r = 3 + Math.random() * 8;
        try { CBZ.cityDustKick(px + Math.cos(a) * r, gy + 0.2, pz + Math.sin(a) * r, 0.5 + 1.4 * (1 - agl / 28), 0xb3a283, { dirx: Math.cos(a), dirz: Math.sin(a), speed: 5 }); } catch (e) {}
      }
    }
    // ---- damage: a wreck's blades strike and snap ------------------------------------------
    if (wrecked && !R.broken) {
      R.broken = true;
      const T = template();
      if (T && T.G.bladeStub) { R.blades[1].mesh.geometry = T.G.bladeStub; R.blades[3].mesh.geometry = T.G.bladeStub; }
      R.blades[2].flap.rotation.y = 0.25;
      for (let i = 0; i < R.lamps.length; i++) R.lamps[i].visible = false;   // the bus is dead
    }
  }

  CBZ.unitKit.register("ah64_apache", {
    kind: "vehicle",
    domain: "air",
    drive: "rotor",
    /* AH-64E: 8,000 kg combat weight, 293 km/h top (81 m/s), cruise 74 m/s,
       a pedal turn of ~60°/s in the hover. Armour is what the Apache was
       built to: crew seats, cockpit floor and the blast shield in boron
       carbide, critical systems tolerant of 12.7 mm, rotor blades of 23 mm.
       Rifle fire bounces, 12.7 mm hurts, an RPG or a missile kills it. */
    stats: { hp: 520, mass: 8000, speed: 81, accel: 4, turn: 1.0, alt: 40, length: DIM.length, width: DIM.rotorSpan, height: DIM.height,
      armour: { front: 20, side: 16, rear: 12, top: 8 }, standoff: 1500 },
    crew: [{ seat: "pilot", pos: [0, 2.46, 2.25] }, { seat: "gunner", pos: [0, 2.04, 3.82] }],
    passengers: 0,
    weapons: WEAPONS,
    build: build,
    // the battle calls this every sim step (src/battle/vehicles.js vehAnimate)
    animate: function (veh, dt, ctx) {
      const r = veh && veh.rig;
      if (r && r.state) tick(r.state, false, dt, ctx);
    },
  });
})();
