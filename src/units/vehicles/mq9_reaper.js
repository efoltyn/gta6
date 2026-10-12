/* ============================================================
   units/vehicles/mq9_reaper.js — General Atomics MQ-9A Reaper (USAF),
   flown from a ground control station: nobody aboard.

   Redrawn from scratch for NPC War (wave B). Before this file drew its own
   airframe the Reaper was city/mil_air.js's generic "drone": a round tube,
   a flat untapered wing, a V-tail with no ruddervators, a sensor ball that
   never moved, a prop that turned at idle in the air, Hellfires and bombs
   welded to the wings, and gear hanging down at 4.5 km.

   THE AIRFRAME (real metres, nose +Z, port +X, wheels on y = 0). Numbers
   from the MQ-9A Block 1/5: 11.0 m long over the spinner, 20.1 m span,
   3.81 m tall over the V-tail, ~1 m wide fuselage, a straight high-aspect
   wing (root chord 1.46 m, tip 0.70 m, ~2 deg dihedral) with flaps inboard
   and ailerons outboard, the Y-tail (a V-tail of two ruddervator surfaces
   at 52 deg dihedral over a ventral fin that guards the prop), a 3-blade
   2.5 m Hartzell pusher on the Honeywell TPE331-10 turboprop, the dorsal
   engine air scoop and the two exhaust stacks either side of the tail cone,
   the bulbous forward fuselage that houses the Ku-band SATCOM dish over the
   Lynx SAR radome, the MTS-B (AN/DAS-1) sensor ball under the chin on a
   yaw collar, the pilot's fixed nose camera, blade antennas and the
   C-band line-of-sight dome, nav lights and strobes, a tricycle gear that
   retracts (nose forward, mains aft into their wells).

   STORES (the common hunter-killer load): two GBU-12 Paveway II (500 lb,
   Mk 82 body, laser seeker and canards, stowed MXU-650 wings) on the
   inboard 1,500 lb stations, four AGM-114 Hellfires on two twin-rail
   launchers on the middle stations. The outboard light stations are empty.

   THE LOOK: one vertex-coloured material for every opaque part. The paint
   is FS 36375 light compass ghost grey all over (every USAF Reaper, any
   theatre: it lives at 15,000 ft, not on the ground), sun-faded on top,
   grimier underneath, the composite radome a touch lighter, exhaust soot
   down the tail cone behind the stacks, oil streaks on the belly, panel
   seams cut round the hull. The side's flag is on the outer faces of the
   V-tail (rig.mark). Every geometry is built ONCE per page and shared.

   THE RIG (moving parts, all driven from animate -> tick on the battle clock):
     prop         ~1,900 rpm with a blur disc, spools down when knocked out
                  and windmills while it falls
     surfaces     ailerons from the roll rate, ruddervators from the pitch
                  rate (together) and the yaw rate (split), flaps down low
     sensor ball  the MTS-B slews onto the mark at its real rate and holds
                  the laser on it; it scans the ground with nothing in sight.
                  Hellfire and GBU-12 are both laser-guided: rig.canFire
                  holds them until the ball has lased the mark for ~1 s
     gear         retracts above 9 m over the ground, drops below it
     stores       each Hellfire leaves its rail (motor flash, smoke), each
                  GBU-12 drops off its rack
     lights       red port tip, green starboard tip, white tail, strobes
     damage       a hit engine trails smoke, a fire trails flame; a hit on
                  the ball blinds it (no lase, no launch); a wreck spools the
                  prop down, kills the lights and on the ground one outer
                  wing folds up at the break and the other ruddervator bends

   FLIGHT is the runtime's jet doctrine (src/battle/vehicles.js stepJet):
   it comes in at 4.5 km, launches Hellfires inside 0.85 x 8 km with the
   nose on the mark, breaks off inside its stand-off and flies a racetrack
   back round (its turn is bank-limited to ~40 deg at 87 m/s: a 1 km turn
   radius); with the Hellfires gone it flies level GBU-12 passes, released
   where the fall lands on the mark, guided down.

   Units: metres, m/s, kg; armour in mm RHA equivalent per face.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.unitKit) return;

  const PI = Math.PI, TAU = PI * 2;
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  // ---- the real numbers -----------------------------------------------------
  const DIM = {
    length: 11.0, span: 20.1, height: 3.81,
    propR: 1.25, propHub: [0, 1.45, -5.15], omega: 1900 * TAU / 60,
    tailDihedral: 52 * PI / 180,
  };
  // MTS-B: continuous azimuth, +10 deg up to 105 deg down, ~85 deg/s slew
  const BALL = { up: -0.17, down: 1.83, rate: 1.5, lock: 0.9, tol: 0.03 };
  const HF_N = 4, GB_N = 2;

  /* The pass is planned round the first weapon with rounds left: Hellfires
     first (point targets, armour, a man), the GBU-12s after them. Both are
     semi-active laser: the ball has to be on the mark (rig.canFire). */
  const WEAPONS = [
    // AGM-114R "Romeo": multi-purpose (HEAT + blast-frag), Mach 1.3,
    // 0.5-8 km off a Reaper; fired one at a time, a few seconds apart
    { id: "agm114_hellfire", seat: null, kind: "missile", vs: "any", mount: "fixed", arc: 0.5, rof: 0.25,
      mun: "agm114r", range: 8000, minRange: 500, ammo: HF_N },
    // GBU-12 Paveway II: Mk 82 (89 kg tritonal) on a laser seeker; released
    // level from cruise where the fall reaches the mark, steered all the way down
    { id: "gbu12", seat: null, kind: "bombs", vs: "any", guided: true, basket: 0.15, rof: 0.4, mun: "gbu12", ammo: GB_N },
  ];

  // =====================================================================
  //  THE TEMPLATE: every geometry built once per page
  // =====================================================================
  const PAINT = 0x8b9095;                          // FS 36375, lit by Lambert
  const RGB = function (hex) { return [(hex >> 16 & 255) / 255, (hex >> 8 & 255) / 255, (hex & 255) / 255]; };
  const C = {
    seam: 0x6c7176, dark: 0x2b2e31, black: 0x0d0e10, rubber: 0x161719, metal: 0x5d6266, steel: 0x8f9396,
    glass: 0x121a22, lens: 0x26384a, prop: 0x2a2d30, tipY: 0xc9b23a,
    store: 0x5e6248, seeker: 0x1c2328, yellow: 0xc0a22e, brown: 0x6b4a2a, bomb: 0x585d44, kit: 0x6c7062,
  };
  // the planform (port side, x out from the centreline)
  function wLE(x) { return 0.40 - 0.012 * x; }
  function wTE(x) { return -1.10 + 0.068 * x; }
  function wY(x) { return 1.55 + 0.03 * x; }
  function wTC(x) { return 0.16 - 0.004 * x; }
  const HINGE = 0.74;                              // control surfaces: the rear 26 % of the chord
  function wH(x) { return wLE(x) - HINGE * (wLE(x) - wTE(x)); }
  const BREAK = 6.0, AIL1 = 9.75, TIP = 10.05;
  // V-tail: built along +X, then turned up by the dihedral round (0, TY, 0)
  const TY = 1.45;
  const VT = { r: 0.15, t: 2.95, leR: -3.00, cR: 1.45, leT: -3.95, cT: 0.62, hinge: 0.64 };
  // nodes: name -> [parent, model-space origin in the rest pose]
  const NODES = {
    body: [null, [0, 0, 0]],
    ballYaw: ["body", [0, 0.92, 4.30]], ballPitch: ["ballYaw", [0, 0.64, 4.30]],
    prop: ["body", DIM.propHub],
    flapL: ["body", [3.2, wY(3.2), wH(3.2)]], flapR: ["body", [-3.2, wY(3.2), wH(3.2)]],
    wingL: ["body", [BREAK, wY(BREAK), wH(BREAK)]], wingR: ["body", [-BREAK, wY(BREAK), wH(BREAK)]],
    ailL: ["wingL", [7.9, wY(7.9), wH(7.9)]], ailR: ["wingR", [-7.9, wY(7.9), wH(7.9)]],
    rvL: ["body", [0, 0, 0]], rvR: ["body", [0, 0, 0]],          // origins set from the hinge below
    gearN: ["body", [0, 0.93, 3.95]], gearL: ["body", [0.32, 0.86, 0.45]], gearR: ["body", [-0.32, 0.86, 0.45]],
  };
  // the ruddervator hinge (port), model space: root and tip on the hinge line
  function tailPt(x, z) {
    const a = DIM.tailDihedral;
    return [x * Math.cos(a), TY + x * Math.sin(a), z];
  }
  function vtLE(x) { return VT.leR + (VT.leT - VT.leR) * (x - VT.r) / (VT.t - VT.r); }
  function vtC(x) { return VT.cR + (VT.cT - VT.cR) * (x - VT.r) / (VT.t - VT.r); }
  function vtH(x) { return vtLE(x) - VT.hinge * vtC(x); }
  {
    const m = 0.5 * (VT.r + 0.3 + VT.t);
    const p = tailPt(m, vtH(m));
    NODES.rvL[1] = p; NODES.rvR[1] = [-p[0], p[1], p[2]];
  }
  // stores: Hellfire rails (x, y, z of the missile's centre), GBU-12 racks
  const HF_LEN = 1.63, HF_R = 0.089, GB_LEN = 3.30, GB_R = 0.137;
  const HF_AT = [[4.45, 1.20, -0.08], [-4.45, 1.20, -0.08], [4.15, 1.20, -0.08], [-4.15, 1.20, -0.08]];
  const GB_AT = [[2.30, 1.12, -0.20], [-2.30, 1.12, -0.20]];

  let TPL = null;
  function template() {
    if (TPL) return TPL;
    const THREE = window.THREE, K = CBZ.milAir && CBZ.milAir.kit;
    if (!THREE || !K || !K.loft || !K.wing) return null;
    const BK = Object.create(null);

    // ---- colour ------------------------------------------------------------
    function weather(x, y, z, ny) {
      let k = 1 + 0.06 * Math.max(0, ny) - 0.09 * Math.max(0, -ny);            // sun-faded tops, grimy belly
      k *= 1 + 0.03 * Math.sin(x * 2.3 + z * 1.9) * Math.sin(y * 5.1 - z * 2.7);  // re-sprayed panels
      if (z > 2.65 && Math.abs(x) < 0.7 && y > 0.95) k *= 1.04;                 // the composite radome
      const ax = Math.abs(x);
      if (z < -3.9 && ax < 0.45 && y > 1.0 && y < 1.75) {                      // exhaust soot down the tail cone
        const s = Math.exp(-((ax - 0.30) * (ax - 0.30)) / 0.02 - ((y - 1.30) * (y - 1.30)) / 0.05) * clamp((-3.9 - z) / 0.5, 0, 1);
        k *= 1 - 0.5 * s;
      }
      if (z < -0.5 && z > -4.6 && y < 1.15 && ax < 0.35) k *= 0.9 + 0.05 * Math.sin(x * 40);   // oil streaks
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
    function put(node, g, col, bucket) {
      if (!g) return;
      if (Array.isArray(g)) { for (let i = 0; i < g.length; i++) put(node, g[i], col, bucket); return; }
      if (!g.attributes.normal) g.computeVertexNormals();
      bucket = bucket || "vc";
      colour(g, col);
      const o = worldOrigin(node);
      if (o[0] || o[1] || o[2]) g.translate(-o[0], -o[1], -o[2]);
      const b = BK[node] || (BK[node] = { vc: [], lamp: [] });
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
    const xf = K.xf, mir = K.mir, box = K.box, rod = K.rod, rnd = K.rnd;
    function cylY(r0, r1, h, seg) { return new THREE.CylinderGeometry(r1, r0, h, seg || 14); }
    function at(g, x, y, z, rx, ry, rz) { return xf(g, x, y, z, rx, ry, rz); }
    function sph(r, x, y, z, ws, hs) { return at(new THREE.SphereGeometry(r, ws || 10, hs || 8), x, y, z); }

    // =================================================================
    //  FUSELAGE: the SATCOM forehead, the long body, the tail cone
    // =================================================================
    const FUS = [
      [5.30, 1.22, 0.02, 0.02, 0.02, 2.0],
      [5.18, 1.23, 0.20, 0.21, 0.19, 2.0],
      [4.95, 1.26, 0.33, 0.36, 0.31, 2.1],
      [4.55, 1.31, 0.42, 0.48, 0.38, 2.3],
      [4.00, 1.35, 0.47, 0.58, 0.42, 2.5],
      [3.30, 1.36, 0.49, 0.60, 0.44, 2.6],
      [2.55, 1.34, 0.49, 0.54, 0.45, 2.7],
      [1.60, 1.30, 0.48, 0.46, 0.45, 2.8],
      [0.50, 1.28, 0.46, 0.43, 0.44, 2.8],
      [-0.80, 1.30, 0.43, 0.40, 0.41, 2.7],
      [-2.20, 1.34, 0.38, 0.36, 0.35, 2.6],
      [-3.40, 1.40, 0.30, 0.30, 0.28, 2.4],
      [-4.40, 1.44, 0.22, 0.23, 0.21, 2.3],
      [-4.98, 1.45, 0.17, 0.17, 0.17, 2.2],
    ].map(function (r) { return { z: r[0], y: r[1], w: r[2], t: r[3], b: r[4], p: r[5] }; });
    function stationAt(z) {
      for (let i = 0; i < FUS.length - 1; i++) {
        const a = FUS[i], b = FUS[i + 1];
        if (z <= a.z && z >= b.z) {
          const t = (a.z - z) / (a.z - b.z);
          return { z: z, y: a.y + (b.y - a.y) * t, w: a.w + (b.w - a.w) * t, t: a.t + (b.t - a.t) * t, b: a.b + (b.b - a.b) * t, p: a.p + (b.p - a.p) * t };
        }
      }
      return FUS[FUS.length - 1];
    }
    function topAt(z) { const s = stationAt(z); return s.y + s.t; }
    function botAt(z) { const s = stationAt(z); return s.y - s.b; }
    put("body", K.loft(FUS, { n: 30 }), { paint: 1 });
    // panel seams round the hull (the radome joint, the bays, the engine section)
    [4.92, 2.62, 1.20, -0.55, -2.55, -3.70, -4.85].forEach(function (z) {
      const s = stationAt(z), e = 0.005;
      const A = { z: z + 0.01, y: s.y, w: s.w + e, t: s.t + e, b: s.b + e, p: s.p }, B = Object.assign({}, A, { z: z - 0.01 });
      put("body", K.loft([A, B], { n: 30, caps: false }), C.seam);
    });
    // the long avionics hatches on each side, and the belly payload bay
    [-1, 1].forEach(function (s) {
      const zs = [2.45, 1.30], y0 = 1.10, y1 = 1.50;
      const X = s * (stationAt(1.9).w * 0.985 + 0.004);
      put("body", [rod([X, y0, zs[0]], [X, y0, zs[1]], 0.005, 4), rod([X, y1, zs[0]], [X, y1, zs[1]], 0.005, 4),
        rod([X, y0, zs[0]], [X, y1, zs[0]], 0.005, 4), rod([X, y0, zs[1]], [X, y1, zs[1]], 0.005, 4)], C.seam);
      // engine-bay cooling louvres
      const Xe = s * (stationAt(-3.0).w * 0.97 + 0.004);
      for (let k = 0; k < 5; k++) put("body", at(box(0.012, 0.025, 0.22), Xe, 1.36 + k * 0.045, -3.0), C.dark);
      // pitot-static probes either side of the nose
      put("body", rod([s * 0.30, 1.30, 4.95], [s * 0.33, 1.30, 5.38], 0.012, 6), C.steel);
    });
    put("body", [rod([0.18, 0.88, 2.4], [0.18, 0.85, 0.9], 0.005, 4), rod([-0.18, 0.88, 2.4], [-0.18, 0.85, 0.9], 0.005, 4)], C.seam);
    // the pilot's fixed nose camera, a window under the radome tip
    put("body", at(box(0.16, 0.09, 0.03), 0, 1.08, 5.02, -0.5), C.glass);
    // dorsal engine air scoop, its dark mouth
    put("body", K.loft([{ z: -1.20, y: topAt(-1.2) - 0.01, w: 0.10, t: 0.005, b: 0.005, p: 2.4 },
      { z: -1.50, y: topAt(-1.5) - 0.01, w: 0.16, t: 0.10, b: 0.01, p: 3 },
      { z: -2.30, y: topAt(-2.3) - 0.01, w: 0.16, t: 0.09, b: 0.01, p: 3 },
      { z: -2.75, y: topAt(-2.75) - 0.02, w: 0.10, t: 0.01, b: 0.01, p: 2.4 }], { n: 16 }), { paint: 0.97 });
    put("body", at(box(0.24, 0.075, 0.02), 0, topAt(-1.5) + 0.045, -1.495), C.black);
    // exhaust stacks either side of the tail cone, turned out and aft
    [-1, 1].forEach(function (s) {
      put("body", rod([s * 0.18, 1.33, -3.90], [s * 0.34, 1.29, -4.42], 0.065, 10), C.metal);
      put("body", at(new THREE.CircleGeometry(0.055, 10), s * 0.343, 1.288, -4.43, 0, s * 0.3 + PI, 0), C.black);
    });
    // antennas: blades on top and under, the GPS puck, the C-band LOS dome
    put("body", [at(box(0.018, 0.20, 0.18), 0, topAt(0.9) + 0.09, 0.9, 0.35), at(box(0.018, 0.16, 0.14), 0, topAt(-0.4) + 0.07, -0.4, 0.35),
      at(box(0.018, 0.17, 0.15), 0, botAt(-1.4) - 0.08, -1.4, -0.35), at(box(0.018, 0.14, 0.12), 0.12, botAt(3.0) - 0.06, 3.0, -0.35)], C.dark);
    put("body", at(cylY(0.07, 0.06, 0.03, 12), 0, topAt(1.9) + 0.01, 1.9), C.dark);
    put("body", at(new THREE.SphereGeometry(0.13, 14, 6, 0, TAU, PI / 2, PI / 2), 0, botAt(-0.2) + 0.02, -0.2), C.steel);
    // spinner
    put("prop", K.loft([rnd(-4.98, 0.17, 1.45), rnd(-5.20, 0.165, 1.45), rnd(-5.45, 0.10, 1.45), rnd(-5.62, 0.01, 1.45)], { n: 16 }), C.steel);

    // =================================================================
    //  WING: inboard box + flap, outboard panel + aileron, the tip
    // =================================================================
    function wst(x, part) {
      const le = wLE(x), te = wTE(x), c = le - te, y = wY(x), tc = wTC(x), h = wH(x);
      if (part === "box") return { x: x, le: le, c: c * HINGE - 0.005, tc: tc * 1.12, y: y };
      if (part === "cs") return { x: x, le: h - 0.012, c: c * (1 - HINGE) - 0.012, tc: 0.12, y: y - 0.01 };
      return { x: x, le: le, c: c, tc: tc, y: y };
    }
    const inBox = K.wing([wst(0.30, "box"), wst(3.0, "box"), wst(BREAK, "box")], { K: 7 });
    const outBox = K.wing([wst(BREAK, "box"), wst(8.0, "box"), wst(AIL1, "box")], { K: 7 });
    const tipP = K.wing([wst(AIL1, "full"), wst(TIP - 0.08, "full"), { x: TIP, le: wLE(TIP) - 0.06, c: (wLE(TIP) - wTE(TIP)) * 0.8, tc: 0.08, y: wY(TIP) }], { K: 7 });
    const flap = K.wing([wst(0.55, "cs"), wst(BREAK - 0.08, "cs")], { K: 4 });
    const ail = K.wing([wst(BREAK + 0.08, "cs"), wst(AIL1 - 0.05, "cs")], { K: 4 });
    put("body", [inBox, mir(inBox)], { paint: 1 });
    put("wingL", [outBox.clone(), tipP.clone()], { paint: 1 });
    put("wingR", [mir(outBox), mir(tipP)], { paint: 1 });
    put("flapL", flap.clone(), { paint: 0.97 }); put("flapR", mir(flap), { paint: 0.97 });
    put("ailL", ail.clone(), { paint: 0.97 }); put("ailR", mir(ail), { paint: 0.97 });
    // the wing-root fairing and the break seam
    [-1, 1].forEach(function (s) {
      put("body", K.loft([{ z: 0.55, x: s * 0.40, y: 1.53, w: 0.02, t: 0.02, b: 0.02 }, { z: 0.30, x: s * 0.42, y: 1.55, w: 0.10, t: 0.12, b: 0.08, p: 2.4 },
        { z: -0.90, x: s * 0.42, y: 1.55, w: 0.10, t: 0.11, b: 0.08, p: 2.4 }, { z: -1.30, x: s * 0.41, y: 1.55, w: 0.02, t: 0.02, b: 0.02 }], { n: 12 }), { paint: 1 });
      const n = s > 0 ? "wingL" : "wingR";
      put(n, rod([s * (BREAK + 0.004), wY(BREAK) + 0.005, wLE(BREAK) - 0.02], [s * (BREAK + 0.004), wY(BREAK) + 0.005, wH(BREAK) + 0.02], 0.007, 4), C.seam);
      // static wicks on the trailing edges
      [8.5, 9.6].forEach(function (x) { put(n, rod([s * x, wY(x), wTE(x) + 0.02], [s * x, wY(x), wTE(x) - 0.10], 0.006, 4), C.dark); });
      // empty outboard hardpoint fittings
      put(n, at(box(0.06, 0.03, 0.40), s * 6.6, wY(6.6) - 0.07, wLE(6.6) - 0.35), C.dark);
    });

    // =================================================================
    //  Y-TAIL: two ruddervator surfaces at 52 deg over a ventral fin
    // =================================================================
    {
      const a = DIM.tailDihedral;
      const st = [{ x: VT.r, le: VT.leR, c: VT.cR * VT.hinge - 0.005, tc: 0.12 }, { x: VT.t, le: VT.leT, c: VT.cT * VT.hinge - 0.005, tc: 0.11 }];
      const fixed = K.wing(st, { K: 6 });
      const tipC = K.loft([rnd(VT.leT, 0.01, 0, VT.t), rnd(VT.leT - 0.10, 0.03, 0, VT.t + 0.01), rnd(VT.leT - VT.cT + 0.05, 0.02, 0, VT.t + 0.01)], { n: 8 });
      const mv = K.wing([{ x: VT.r + 0.3, le: vtH(VT.r + 0.3) - 0.012, c: vtC(VT.r + 0.3) * (1 - VT.hinge) - 0.012, tc: 0.11 },
        { x: VT.t - 0.04, le: vtH(VT.t - 0.04) - 0.012, c: vtC(VT.t - 0.04) * (1 - VT.hinge) - 0.012, tc: 0.10 }], { K: 4 });
      [fixed, tipC, mv].forEach(function (g) { xf(g, 0, TY, 0, 0, 0, a); });
      put("body", [fixed, mir(fixed)], { paint: 1 });
      put("body", [tipC, mir(tipC)], { paint: 0.98 });
      put("rvL", mv.clone(), { paint: 0.97 });
      put("rvR", mir(mv), { paint: 0.97 });
      // the tail-root fairings
      put("body", K.loft([{ z: -2.75, y: 1.62, w: 0.04, t: 0.02, b: 0.02 }, { z: -3.10, y: 1.62, w: 0.30, t: 0.12, b: 0.05, p: 2.4 },
        { z: -4.30, y: 1.56, w: 0.24, t: 0.10, b: 0.05, p: 2.4 }, { z: -4.62, y: 1.52, w: 0.04, t: 0.02, b: 0.02 }], { n: 14 }), { paint: 1 });
      // the ventral fin (it keeps the prop off the runway) and its tail skid
      const vf = K.wing([{ x: 0.10, le: -3.30, c: 1.30, tc: 0.10 }, { x: 0.98, le: -3.98, c: 0.66, tc: 0.08 }], { K: 6 });
      put("body", at(vf, 0, 1.24, 0, 0, 0, -PI / 2), { paint: 1 });
      put("body", rod([0, 0.30, -4.00], [0, 0.27, -4.55], 0.025, 6), C.metal);
    }

    // =================================================================
    //  MTS-B SENSOR BALL on its yaw collar under the chin
    // =================================================================
    {
      const bx = 0, by = 0.64, bz = 4.30;
      put("body", at(cylY(0.20, 0.17, 0.06, 18), 0, 0.95, bz), C.dark);
      put("ballYaw", [at(cylY(0.16, 0.16, 0.10, 18), 0, 0.88, bz), at(box(0.06, 0.26, 0.26), 0.25, 0.73, bz), at(box(0.06, 0.26, 0.26), -0.25, 0.73, bz)], { paint: 0.95 });
      put("ballPitch", [sph(0.235, bx, by, bz, 22, 16)], { paint: 1.02 });
      // the window face: a flat dark bezel with the apertures
      put("ballPitch", at(new THREE.CylinderGeometry(0.19, 0.20, 0.04, 22), bx, by, bz + 0.215, PI / 2), C.dark);
      put("ballPitch", [at(new THREE.CircleGeometry(0.075, 16), bx - 0.07, by + 0.05, bz + 0.237), at(new THREE.CircleGeometry(0.055, 14), bx + 0.08, by + 0.06, bz + 0.237),
        at(new THREE.CircleGeometry(0.045, 12), bx + 0.06, by - 0.08, bz + 0.237), at(new THREE.CircleGeometry(0.035, 12), bx - 0.06, by - 0.09, bz + 0.237)], C.lens);
    }

    // =================================================================
    //  STORES: pylons, Hellfire twin rails, GBU-12 racks
    // =================================================================
    [-1, 1].forEach(function (s) {
      // GBU-12 station (inboard), Hellfire station (middle)
      put("body", K.pylon(s * 2.30, wY(2.3) - 0.06, 1.27, wLE(2.3) - 0.10, 0.95), { paint: 0.95 });
      put("body", K.pylon(s * 4.30, wY(4.3) - 0.06, 1.36, wLE(4.3) - 0.12, 0.80), { paint: 0.95 });
      // the twin-rail launcher: a spine and two rails
      put("body", [at(box(0.44, 0.05, 1.10), s * 4.30, 1.335, -0.10), at(box(0.035, 0.03, 0.95), s * 4.15, 1.30, -0.10), at(box(0.035, 0.03, 0.95), s * 4.45, 1.30, -0.10)], C.metal);
      // the bomb rack's sway braces
      put("body", [rod([s * 2.18, 1.27, 0.25], [s * 2.22, 1.20, 0.25], 0.012, 4), rod([s * 2.42, 1.27, 0.25], [s * 2.38, 1.20, 0.25], 0.012, 4),
        rod([s * 2.18, 1.27, -0.65], [s * 2.22, 1.20, -0.65], 0.012, 4), rod([s * 2.42, 1.27, -0.65], [s * 2.38, 1.20, -0.65], 0.012, 4)], C.metal);
    });

    // =================================================================
    //  LANDING GEAR (built down; tick retracts it)
    // =================================================================
    {
      const nw = K.wheel(0.19, 0.10);
      put("gearN", [rod([0, 0.93, 3.95], [0, 0.34, 3.98], 0.04, 8), rod([0, 0.34, 3.98], [0.07, 0.19, 4.0], 0.02, 6), rod([0, 0.34, 3.98], [-0.07, 0.19, 4.0], 0.02, 6),
        rod([0, 0.80, 3.95], [0, 0.90, 3.55], 0.02, 6)], C.steel);
      put("gearN", at(nw.tire, 0, 0.19, 4.0), C.rubber);
      put("gearN", at(nw.hub, 0, 0.19, 4.0), C.metal);
      [-1, 1].forEach(function (s) {
        const n = s > 0 ? "gearL" : "gearR", mw = K.wheel(0.26, 0.14);
        put(n, [rod([s * 0.32, 0.86, 0.45], [s * 1.12, 0.27, 0.35], 0.045, 8), rod([s * 0.32, 0.86, -0.05], [s * 0.85, 0.47, 0.37], 0.025, 6)], C.steel);
        put(n, at(mw.tire, s * 1.20, 0.26, 0.35), C.rubber);
        put(n, at(mw.hub, s * 1.20, 0.26, 0.35), C.metal);
        // the well outline the leg folds into
        put("body", [rod([s * 0.26, botAt(0.5) + 0.004, 0.55], [s * 0.26, botAt(-0.7) + 0.004, -0.75], 0.005, 4)], C.seam);
      });
    }

    // =================================================================
    //  LIGHTS: red port tip, green starboard tip, white tail, strobes
    // =================================================================
    put("wingL", sph(0.04, TIP + 0.01, wY(TIP), wLE(TIP) - 0.15), 0xff3b30, "lamp");
    put("wingR", sph(0.04, -TIP - 0.01, wY(TIP), wLE(TIP) - 0.15), 0x30d070, "lamp");
    put("body", sph(0.035, 0, 0.36, -4.62), 0xf2f4ff, "lamp");

    // ---- bake the buckets ---------------------------------------------------
    const G = Object.create(null);
    for (const k in BK) G[k] = { vc: merge(BK[k].vc), lamp: merge(BK[k].lamp) };

    // ---- the prop: 3 twisted blades, built in the hub's own space --------------
    {
      const parts = [];
      for (let i = 0; i < 3; i++) {
        const st = [{ x: 0.12, le: 0.09, c: 0.18, tc: 0.18 }, { x: 0.35, le: 0.12, c: 0.24, tc: 0.10 }, { x: 0.95, le: 0.10, c: 0.20, tc: 0.07 }, { x: DIM.propR, le: 0.05, c: 0.10, tc: 0.06 }];
        const b = K.wing(st, { K: 4 });
        // blade pitch (the chord laid nearly in the disc, leading edge up the turn)
        xf(b, 0, 0, 0, PI / 2 - 0.42, 0, 0);
        xf(b, 0, 0, 0, 0, 0, i * TAU / 3);
        b.computeVertexNormals();
        colour(b, function (x, y) { return RGB(Math.hypot(x, y) > DIM.propR - 0.09 ? C.tipY : C.prop); });
        parts.push(b);
      }
      G.blades = merge(parts);
      G.disc = new THREE.CircleGeometry(DIM.propR, 36); G.disc._shared = true;
    }
    // ---- the stores (one geometry each, a mesh per round) ------------------------
    {
      const r = HF_R, h = HF_LEN / 2;
      const parts = [K.loft([rnd(h, 0.004), rnd(h - 0.05, 0.05), rnd(h - 0.13, r), rnd(-h + 0.02, r), rnd(-h, r * 0.82)], { n: 12 })];
      for (let k = 0; k < 4; k++) {
        const a = k * PI / 2 + PI / 4;
        parts.push(xf(K.wing([{ x: r * 0.9, le: 0.05, c: 0.28, tc: 0.05 }, { x: 0.165, le: -0.04, c: 0.17, tc: 0.05 }], { K: 3 }), 0, 0, 0, 0, 0, a));
        parts.push(xf(K.wing([{ x: r * 0.9, le: -0.66, c: 0.13, tc: 0.05 }, { x: 0.15, le: -0.70, c: 0.08, tc: 0.05 }], { K: 3 }), 0, 0, 0, 0, 0, a));
      }
      parts.push(at(box(0.04, 0.03, 0.9), 0, r + 0.012, -0.05));
      parts.forEach(function (p) {
        if (!p.attributes.normal) p.computeVertexNormals();
        colour(p, function (x, y, z) { return RGB(z > h - 0.13 ? C.seeker : (z > 0.40 && z < 0.45 ? C.yellow : (z < -0.25 && z > -0.30 ? C.brown : C.store))); });
      });
      G.hellfire = merge(parts);
    }
    {
      // GBU-12: Mk 82 body, the seeker + canard section ahead of it, stowed wings aft
      const r = GB_R, h = GB_LEN / 2;
      const body = K.loft([rnd(h - 0.55, 0.075), rnd(h - 0.80, r * 0.85), rnd(h - 1.20, r), rnd(-h + 0.85, r), rnd(-h + 0.45, r * 0.78)], { n: 16 });
      const seek = K.loft([rnd(h, 0.02), rnd(h - 0.05, 0.065), rnd(h - 0.25, 0.075), rnd(h - 0.56, 0.075)], { n: 14 });
      const ring = at(new THREE.TorusGeometry(0.105, 0.012, 6, 18), 0, 0, h - 0.06);
      const parts = [body, seek, ring];
      for (let k = 0; k < 4; k++) {
        const a = k * PI / 2 + PI / 4;
        parts.push(xf(K.wing([{ x: 0.07, le: h - 0.40, c: 0.16, tc: 0.06 }, { x: 0.20, le: h - 0.45, c: 0.10, tc: 0.06 }], { K: 3 }), 0, 0, 0, 0, 0, a));      // canards
        parts.push(xf(K.wing([{ x: r * 0.75, le: -h + 0.50, c: 0.48, tc: 0.05 }, { x: r + 0.09, le: -h + 0.45, c: 0.43, tc: 0.05 }], { K: 3 }), 0, 0, 0, 0, 0, a)); // stowed wings
      }
      parts.push(at(cylY(r * 0.78, r * 0.6, 0.10, 14), 0, 0, -h + 0.40, PI / 2));
      parts.forEach(function (p) {
        if (!p.attributes.normal) p.computeVertexNormals();
        colour(p, function (x, y, z) {
          if (z > h - 0.56) return RGB(z > h - 0.07 ? C.seeker : C.kit);
          if (z < -h + 0.50) return RGB(C.kit);
          return RGB(z > h - 1.0 && z < h - 0.93 ? C.yellow : C.bomb);
        });
      });
      G.gbu = merge(parts);
    }
    G.flag = new THREE.PlaneGeometry(0.52, 0.32); G.flag._shared = true;

    // ---- materials ------------------------------------------------------------
    let vc = null;
    try { vc = CBZ.cmat ? CBZ.cmat(0xffffff, { vc: true }) : null; } catch (e) { vc = null; }
    if (!vc || !vc.vertexColors) { vc = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true }); vc._shared = true; }
    const M = {
      vc: vc,
      lamp: new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true }),
      disc: new THREE.MeshBasicMaterial({ color: 0x1a1c1e, transparent: true, opacity: 0.14, side: THREE.DoubleSide, depthWrite: false }),
      strobe: new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95 }),
    };
    M.lamp._shared = M.disc._shared = M.strobe._shared = true;
    G.strobe = new THREE.SphereGeometry(0.05, 8, 6); G.strobe._shared = true;
    TPL = { G: G, M: M };
    return TPL;
  }
  // a node's origin in model space (the rest pose), whatever its parent
  function worldOrigin(k) { return NODES[k][1]; }

  // ---- nation flags on the V-tail ------------------------------------------------
  const FLAGM = Object.create(null);
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
  function build(ctx) {
    const T = template();
    if (!T) return null;
    const THREE = window.THREE, G = T.G, M = T.M;
    const root = new THREE.Group(); root.name = "mq9-reaper";
    const N = Object.create(null);
    N.body = new THREE.Group(); N.body.name = "mq9-body"; root.add(N.body);
    for (const k in NODES) {
      if (k === "body") continue;
      const d = NODES[k], po = NODES[d[0]][1], o = d[1];
      const g = new THREE.Group(); g.name = "mq9-" + k;
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
    const lamps = [];
    for (const k in G) {
      if (!N[k] || !G[k] || !G[k].vc) continue;
      mesh(G[k].vc, M.vc, N[k]);
      const lm = mesh(G[k].lamp, M.lamp, N[k], false); if (lm) lamps.push(lm);
    }
    mesh(G.blades, M.vc, N.prop);
    const disc = mesh(G.disc, M.disc, N.prop, false); disc.visible = false;
    // strobes: top of the fuselage and the belly
    const strobes = [mesh(G.strobe, M.strobe, N.body, false), mesh(G.strobe, M.strobe, N.body, false)];
    strobes[0].position.set(0, 1.74, 0.0); strobes[1].position.set(0, 0.83, 0.9);
    strobes[0].visible = strobes[1].visible = false;
    // stores
    const hf = HF_AT.map(function (p) { const m = mesh(G.hellfire, M.vc, N.body); m.position.set(p[0], p[1], p[2]); return m; });
    const gb = GB_AT.map(function (p) { const m = mesh(G.gbu, M.vc, N.body); m.position.set(p[0], p[1], p[2]); return m; });
    // hinge axes (model space; the parents are unrotated at rest)
    function axis(a, b) { const v = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]); return v.normalize(); }
    const AX = {
      flapL: axis([0.55, wY(0.55), wH(0.55)], [BREAK, wY(BREAK), wH(BREAK)]),
      ailL: axis([BREAK, wY(BREAK), wH(BREAK)], [AIL1, wY(AIL1), wH(AIL1)]),
      rvL: axis(tailPt(VT.r + 0.3, vtH(VT.r + 0.3)), tailPt(VT.t, vtH(VT.t))),
    };
    AX.flapR = new THREE.Vector3(AX.flapL.x, -AX.flapL.y, -AX.flapL.z);   // mirrored: the same sense of deflection
    AX.ailR = new THREE.Vector3(AX.ailL.x, -AX.ailL.y, -AX.ailL.z);
    AX.rvR = new THREE.Vector3(AX.rvL.x, -AX.rvL.y, -AX.rvL.z);
    // V-tail flags: on the outer faces, hoist forward
    const flags = [];
    [1, -1].forEach(function (s) {
      const a = DIM.tailDihedral, m = 1.45;
      const p = tailPt(m, vtLE(m) - vtC(m) * 0.36);
      const n = new THREE.Vector3(s * Math.sin(a), -Math.cos(a), 0);
      const x = new THREE.Vector3(0, 0, s > 0 ? -1 : 1);
      const y = new THREE.Vector3().crossVectors(n, x);
      const f = new THREE.Mesh(G.flag, M.vc);
      f.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, n));
      f.position.set(s * p[0] + n.x * 0.045, p[1] + n.y * 0.045, p[2]);
      if (s < 0) f.scale.x = -1;
      f.visible = false; f.castShadow = false;
      N.body.add(f); flags.push(f);
    });

    const seed = (ctx && ctx.seed) || 0;
    const R = {
      group: root, nodes: N, AX: AX, lamps: lamps, strobes: strobes, disc: disc, hf: hf, gb: gb, flags: flags,
      hfShot: 0, gbShot: 0, clock: seed * 0.37, dead: false, crashed: false, seeded: false,
      rx: 0, rz: 0, ry: 0, pRate: 0, rRate: 0, yRate: 0,
      rpm: 1, propA: seed * 1.1, gear: 0, flap: 0, ail: 0, rvP: 0, rvY: 0,
      ballY: 0, ballP: 0.5, lockT: 0, ballDead: false, scan: seed * 2.3,
      hitEngine: false, fire: false, smokeT: 0, veh: null,
      _v: new THREE.Vector3(), _m: new THREE.Matrix4(),
    };
    const rig = {
      turret: null,
      settle: function () { R.seeded = false; tick(R, true, 0, null); },
      muzzleWorld: function (out, shot) { return muzzle(R, out, shot); },
      fire: function (shot) { fire(R, shot); },
      canFire: function (shot) { return canFire(R, shot); },
      aimError: function () { return 0; },
      damage: function (vs, res) { damage(R, vs, res); },
      // the Reaper wears ghost grey over any ground; the side's flag goes on the tail
      mark: function (nation, ground, side) { rig.setNation(nation || (side && side.flagId), side && side.flag); },
      setNation: function (id, design) {
        const m = id || design ? flagMat(String(id || "flag"), design) : null;
        for (let i = 0; i < flags.length; i++) { flags[i].material = m || M.vc; flags[i].visible = !!m; }
        return !!m;
      },
      state: R,
    };
    R.rig = rig;
    root.userData.rig = rig;
    root.userData.aircraftDims = { family: "MQ-9A", length: DIM.length, span: DIM.span, height: DIM.height, bodyW: 1.0, bodyL: DIM.length };
    root.userData.drone = true;
    root.userData.crewSeats = [];
    if (ctx && (ctx.nation || ctx.flag)) rig.setNation(ctx.nation || ctx.flagId, ctx.flag);
    tick(R, true, 0, null);
    return { group: root, rig: rig, footW: DIM.span, footL: DIM.length, height: DIM.height };
  }

  // ---- the stores' ends ------------------------------------------------------------
  let _w = null;
  function worldAt(node, x, y, z, out) {
    if (!_w) _w = new window.THREE.Vector3();
    out = out || _w;
    let r = node; while (r.parent) r = r.parent;
    r.updateMatrixWorld(true);
    return node.localToWorld(out.set(x, y, z));
  }
  function muzzle(R, out, shot) {
    const wid = shot && shot.wid;
    if (wid === "gbu12") {
      const p = GB_AT[Math.min(R.gbShot, GB_N - 1)];
      return worldAt(R.nodes.body, p[0], p[1] - 0.2, p[2], out);
    }
    const p = HF_AT[Math.min(R.hfShot, HF_N - 1)];
    return worldAt(R.nodes.body, p[0], p[1], p[2] + HF_LEN / 2 + 0.1, out);
  }
  function fire(R, shot) {
    const wid = shot && shot.wid;
    if (wid === "gbu12") {
      if (R.gbShot < GB_N) R.gb[R.gbShot++].visible = false;     // off the rack: the runtime flies the bomb
      return;
    }
    if (R.hfShot >= HF_N) return;
    const i = R.hfShot++;
    R.hf[i].visible = false;
    const p = HF_AT[i];
    try {
      const w = worldAt(R.nodes.body, p[0], p[1], p[2] - HF_LEN / 2 - 0.2);
      if (CBZ.muzzleFlash) CBZ.muzzleFlash(w, { scale: 1.6, color: 0xffd6a0, life: 0.1 });
      if (CBZ.cityCrashSmoke) CBZ.cityCrashSmoke(w.x, w.y, w.z, { count: 1, scale: 0.6, shade: 0.8 });
    } catch (e) {}
  }
  // laser-guided: the ball has to be on the mark, and have held it for a beat
  function canFire(R, shot) {
    if (R.dead || R.ballDead) return false;
    if (shot && shot.wid === "agm114_hellfire" && R.hfShot >= HF_N) return false;
    if (shot && shot.wid === "gbu12" && R.gbShot >= GB_N) return false;
    return R.lockT >= BALL.lock;
  }
  function damage(R, vs, res) {
    if (!res || !res.pen) return;
    if (res.zone === "rear" || res.zone === "top" || res.dmg > 80) R.hitEngine = true;
    if (res.burning || (vs && vs.burning)) R.fire = true;
    if (res.firepower) R.ballDead = true;         // the ball is blind: nothing to lase with
  }

  // ---- the rig: every moving part, once per animate (the battle clock) ------------
  function spin(node, ax, a) { node.quaternion.setFromAxisAngle(ax, a); }
  function tick(R, snap, dt, ctx) {
    if (!(dt > 0)) dt = 0;
    if (dt > 0.1) dt = 0.1;
    R.clock += dt;
    const g = R.group, N = R.nodes;
    if (ctx && ctx.dead) R.dead = true;
    const dead = R.dead;
    // ---- the attitude rates, off the airframe's own transform ----
    const rx = g.rotation.x, rz = g.rotation.z, ry = g.rotation.y;
    if (!R.seeded || snap) { R.rx = rx; R.rz = rz; R.ry = ry; R.seeded = true; }
    if (dt > 0) {
      const k = Math.min(1, dt * 5);
      let dy = ry - R.ry; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      R.pRate += ((-(rx - R.rx)) / dt - R.pRate) * k;   // nose-up rate
      R.rRate += ((rz - R.rz) / dt - R.rRate) * k;
      R.yRate += (dy / dt - R.yRate) * k;
    }
    R.rx = rx; R.rz = rz; R.ry = ry;
    let agl;
    if (ctx && isFinite(ctx.agl)) agl = ctx.agl;
    else { let gy0 = 0; try { gy0 = CBZ.floorAt ? (+CBZ.floorAt(g.position.x, g.position.z) || 0) : 0; } catch (e) { gy0 = 0; } agl = g.position.y - gy0; }
    const flying = agl > 1.5;
    // ---- prop: spools down when knocked out, windmills while it falls ----
    const rpmT = dead ? (flying && !R.crashed ? 0.12 : 0) : (flying ? 1 : 0.35);
    R.rpm = snap ? rpmT : R.rpm + (rpmT - R.rpm) * Math.min(1, dt * (dead ? 0.6 : 1.2));
    R.propA = (R.propA + DIM.omega * R.rpm * dt) % TAU;
    N.prop.rotation.z = -R.propA;
    R.disc.visible = dt > 0 && R.rpm > 0.3;
    // ---- gear: up above 9 m, down below; the wheels go into their wells ----
    const gT = flying && agl > 9 && !dead ? 1 : (dead ? R.gear : 0);
    R.gear = snap ? gT : R.gear + clamp(gT - R.gear, -dt / 7, dt / 7);
    N.gearN.rotation.x = -1.75 * R.gear;
    N.gearL.rotation.x = N.gearR.rotation.x = 1.55 * R.gear;
    N.gearL.rotation.z = -0.55 * R.gear; N.gearR.rotation.z = 0.55 * R.gear;
    const down = R.gear < 0.97;
    N.gearN.visible = N.gearL.visible = N.gearR.visible = down;
    // ---- control surfaces ----
    const k = snap ? 1 : Math.min(1, dt * 6);
    const ailT = dead ? 0.3 : clamp(-R.rRate * 0.8, -0.35, 0.35);
    const flapT = flying && agl < 40 && !dead ? 0.35 : 0;
    const pT = dead ? -0.25 : clamp(-R.pRate * 1.5, -0.4, 0.4);
    const yT = dead ? 0 : clamp(R.yRate * 1.2, -0.35, 0.35);
    R.ail += (ailT - R.ail) * k; R.flap += (flapT - R.flap) * Math.min(1, dt * 0.8 + (snap ? 1 : 0));
    R.rvP += (pT - R.rvP) * k; R.rvY += (yT - R.rvY) * k;
    spin(N.ailL, R.AX.ailL, R.ail); spin(N.ailR, R.AX.ailR, -R.ail);
    spin(N.flapL, R.AX.flapL, R.flap); spin(N.flapR, R.AX.flapR, R.flap);
    spin(N.rvL, R.AX.rvL, R.rvP + R.rvY); spin(N.rvR, R.AX.rvR, R.rvP - R.rvY);
    // ---- the MTS-B: onto the mark, else a slow search pattern ----
    let wy, wp, onMark = false;
    const t = ctx && ctx.target && ctx.target.pos && !R.ballDead && !dead ? ctx.target : null;
    if (t) {
      g.updateMatrixWorld(true);
      const v = R._v.set(t.pos.x, t.pos.y + (t.aimY || 1), t.pos.z);
      v.applyMatrix4(R._m.copy(N.body.matrixWorld).invert());
      const o = NODES.ballPitch[1];
      const dx = v.x - o[0], dy = v.y - o[1], dz = v.z - o[2];
      wy = Math.atan2(dx, dz); wp = Math.atan2(-dy, Math.hypot(dx, dz));
      onMark = wp >= BALL.up && wp <= BALL.down;
      wp = clamp(wp, BALL.up, BALL.down);
    } else {
      R.scan += dt;
      wy = dead || R.ballDead ? R.ballY : 0.9 * Math.sin(R.scan * 0.13);
      wp = dead || R.ballDead ? R.ballP : 0.55 + 0.25 * Math.sin(R.scan * 0.21);
    }
    let ey = wy - R.ballY; ey = Math.atan2(Math.sin(ey), Math.cos(ey));
    const ep = wp - R.ballP;
    if (snap) { R.ballY += ey; R.ballP += ep; }
    else { R.ballY += clamp(ey, -BALL.rate * dt, BALL.rate * dt); R.ballP += clamp(ep, -BALL.rate * dt, BALL.rate * dt); }
    N.ballYaw.rotation.y = R.ballY; N.ballPitch.rotation.x = R.ballP;
    if (onMark && Math.abs(ey) < BALL.tol && Math.abs(ep) < BALL.tol) R.lockT += dt; else R.lockT = 0;
    // ---- lights ----
    const lit = !dead;
    for (let i = 0; i < R.lamps.length; i++) R.lamps[i].visible = lit;
    const ph = R.clock % 1.2;
    R.strobes[0].visible = lit && ph < 0.05;
    R.strobes[1].visible = lit && ph > 0.6 && ph < 0.65;
    // ---- damage: smoke from a hit engine, flame when burning ----
    const veh = R.veh, hpF = veh && veh.vs && veh.vs.maxHp ? veh.vs.hp / veh.vs.maxHp : 1;
    if (dt > 0 && !R.crashed && (R.hitEngine || hpF < 0.5 || R.fire || dead) && CBZ.cityCrashSmoke) {
      R.smokeT -= dt;
      if (R.smokeT <= 0) {
        R.smokeT = 0.25;
        try {
          const p = worldAt(N.body, 0, 1.45, -4.6);
          CBZ.cityCrashSmoke(p.x, p.y, p.z, { count: 1, scale: 0.6 + 0.6 * (1 - hpF), shade: hpF < 0.3 || R.fire || dead ? 0.25 : 0.6, flame: !!(R.fire || dead) });
        } catch (e) {}
      }
    }
    // ---- the wreck on the ground: an outer wing folds at the break, a ruddervator bends ----
    if (dead && !R.crashed && agl < 2.5 && R.clock > 0.5) {
      R.crashed = true;
      N.wingL.rotation.z = 0.55;
      N.wingR.rotation.z = 0.12;
      spin(N.rvR, R.AX.rvR, 0.9);
      N.prop.rotation.z += 0.4;
    }
  }

  // which store a PLAYER's attack works: a Hellfire at a point (a hull, a
  // man), a GBU-12 at a crowd or when the rails are empty
  function moves(veh, tgt, ctx) {
    const W = veh && veh.wpn;
    let hf = 0, gb = 0;
    for (let i = 0; W && i < W.length; i++) { if (W[i].w.id === "agm114_hellfire") hf = W[i].ammo; else if (W[i].w.id === "gbu12") gb = W[i].ammo; }
    if (tgt && tgt.vehicle) return hf > 0 ? "agm114_hellfire" : (gb > 0 ? "gbu12" : null);
    const crowd = ctx && ctx.crowd || 0;
    if (gb > 0 && (crowd >= 6 || hf <= 0)) return "gbu12";
    return hf > 0 ? "agm114_hellfire" : (gb > 0 ? "gbu12" : null);
  }

  CBZ.unitKit.register("mq9_reaper", {
    kind: "vehicle",
    domain: "air",
    drive: "jet",
    /* MQ-9A: 4,760 kg max take-off, 2,223 kg empty, 313 km/h cruise (87 m/s),
       a TPE331-10 of 900 shp. It is not armoured at all: a 23 mm burst or a
       MANPADS brings it down. It strikes from 4.5 km, out of reach of any
       rifle; the bank is held to ~40 deg (turn rate g tan(bank) / v). */
    stats: { hp: 240, mass: 4760, speed: 87, accel: 3, turn: 0.09, alt: 4500, length: DIM.length, width: DIM.span, height: DIM.height,
      armour: { front: 2, side: 2, rear: 2, top: 2 }, standoff: 3000, remote: true },
    crew: [],
    passengers: 0,
    weapons: WEAPONS,
    tactics: {
      role: "strike-isr",               // hunter-killer: finds, lases and kills from altitude
      loiter: true,
      engage: { missile: 8000, bombs: 2700 },
      priorities: ["armour", "sam", "launcher", "mg", "men"],
      designates: true,                 // the MTS-B lases for its own Hellfires and GBU-12s
      hullDown: false, faceThreat: false, reverseOut: false, screen: null,
    },
    build: build,
    animate: function (veh, dt, ctx) {
      const r = veh && veh.rig;
      if (r && r.state) { r.state.veh = veh; tick(r.state, false, dt, ctx); }
    },
    moves: moves,
  });
})();
