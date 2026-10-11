/* ============================================================
   units/vehicles/b52.js — B-52H Stratofortress strategic bomber (USAF).

   Redrawn from scratch for NPC War (wave B). Before this file drew its own
   airframe the B-52 was city/mil_air.js's `bomber` template: one flat grey
   loft with a band of glass, the wings a rigid plank (no droop on the
   ground, no flex in the air), no bomb bay, no stores, nothing moving, and
   in the battle its "carpet" was three bombs a pass dropped out of the
   middle of the fuselage with no bomb seen falling.

   THE AIRFRAME (real metres, nose +Z, port +X, wheels on y = 0). B-52H
   figures: 48.5 m long, 56.4 m span, 12.4 m to the fin tip; a shoulder
   wing of 370 m2 swept 35 deg at the quarter chord (10.6 m root chord to
   3.6 m tip, 13 % thick at the root); eight Pratt & Whitney TF33-P-3
   turbofans in four twin pods slung ahead of and below the leading edge
   (inboard pods at 9.6 m, outboard at 18.4 m: the fat fan cowl, the fan
   exhaust step, the narrow core cowl and its plug); 700-gallon tanks near
   the tips; quadricycle main gear (four twin-wheel trucks on 56 x 16
   tyres, 15.3 m wheelbase) with outrigger wheels at 22.6 m (the 45 m
   outrigger track); the tall swept fin with its narrow rudder; the
   stabiliser with elevators; seven spoiler panels per wing for roll (the
   B-52 has no ailerons); the 8.0 m bomb bay between the gear trucks; the
   stepped flight deck (windscreen, eyebrow and side windows), the two
   EVS turrets under the chin (FLIR and low-light TV), the dark radome,
   the refuelling receptacle behind the cockpit, blade antennas, the
   tail-warning fairing on the stinger (the H's tail gun is long gone),
   nav lights and the two red beacons.

   THE WING BENDS. The airframe is ONE skinned mesh on nine bones (the body
   and four along each wing). On the ground the wings droop until the
   outriggers touch; in level flight they straighten (the jig shape is the
   1 g shape); in a turn they bend up with the load factor and ring on a
   spring. Pods, tanks, outriggers and spoilers ride the bone at their
   station.

   THE LOOK. Gunship Gray (FS 36118) on a vertex-weathered skin: sun-faded
   tops, belly grime, panel tone, the TF33's soot streaks on the wing and
   flaps behind each pod, darker panel seams round the fuselage. The side's
   flag goes on both faces of the fin and on the forward fuselage; the
   fin tip carries a band in the side's colour (a squadron band). A
   knocked-out airframe goes down; on the ground its wings break at the
   outboard pods and the skin is burnt.

   THE RIG (all on the battle clock, animate -> tick):
     wings       droop on the ground, flex with the load factor in the air
     gear        down below 60 m at approach speed, else up (8 s cycle):
                 the trucks fold into the belly, the outriggers into the wing
     controls    spoilers on the down-going wing for roll (all up as speed
                 brakes in a fast descent), elevators on pitch rate, rudder
                 with the turn
     engines     sixteen fan faces spin with the throttle
     contrails   above 7,000 m, four (one per pod) that widen and drift for
                 ~40 s; lower down the TF33's grey smoke trail; black smoke
                 and flame from a pod that is on fire
     bomb bay    the radar navigator opens the doors on the run-in (4 s
                 before the first release) and shuts them after the stick;
                 the 27 Mk-82s on their clips and the 12 JDAMs on the wing
                 HSABs are drawn and leave their own stations, and each
                 falling bomb is drawn (weapons/munitions.js, pooled)

   WEAPONS. A B-52H mixed load as flown over Afghanistan and Iraq:
     mk82_stick   27 x Mk-82 500 lb in the bay, rippled as ONE stick walked
                  across the mark (~30 m apart, ~0.8 km long) from 9,100 m
     gbu31_jdam   12 x GBU-31 (Mk-84 + JDAM kit) on the two Heavy Stores
                  Adapter Beams, GPS-guided: one per aim point per pass (the
                  first one at armour; the Mk-82 stick does not go at tanks)
   Released level at the weapon's height where the fall (43 s from 9 km)
   lands on the mark; the JDAM inside a basket of 0.15 x its fall distance.

   ARMOUR. None: 2-3 mm of aluminium. Nothing on the ground reaches it but a
   SAM; one hit-to-kill interceptor usually brings it down, a near-burst can
   leave it flying on fire.

   TACTICS. It does not loiter over a battle: it comes in from beyond the
   horizon on a straight run (stats.ingress: the release distance plus a
   lining-up leg), drops, turns away on a 46 deg bank and comes round again
   only if it has bombs left.

   moves(veh, tgt, ctx): the weapon a player's attack works on this mark
   (JDAM at armour, the stick at anything else).

   Units: metres, m/s, kg; armour in mm RHA equivalent per face.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.unitKit) return;

  const PI = Math.PI, TAU = PI * 2, DEG = PI / 180;
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function wrap(a) { while (a > PI) a -= TAU; while (a < -PI) a += TAU; return a; }
  function naca(x) { return 5 * (0.2969 * Math.sqrt(Math.max(0, x)) - 0.1260 * x - 0.3516 * x * x + 0.2843 * x * x * x - 0.1036 * x * x * x * x); }

  // ---- the real numbers -------------------------------------------------------
  const ALT = 9100;                                   // 30,000 ft: the bombing height
  const SPD = 230;                                    // m/s true airspeed at that height (M 0.77)
  const FALL = Math.sqrt(2 * ALT / 9.81);             // 43 s
  const DIM = { length: 48.5, span: 56.4, height: 12.4, bodyW: 3.02 };
  // the wing planform (port side, x outboard): chord line height in the jig (1 g) shape
  const WY = 5.0, X0 = 1.2;
  function LE(x) { return 6.6 - (x - X0) * 0.745; }
  function CH(x) { return 10.6 - (x - X0) * (7.0 / 27.0); }
  function TC(x) { return 0.13 - 0.05 * clamp((x - X0) / 27, 0, 1); }
  function WYx(x) { return WY + 0.02 * (x - X0); }
  function wLow(x, f) { return WYx(x) - naca(f) * TC(x) * CH(x); }
  function wUp(x, f) { return WYx(x) + naca(f) * TC(x) * CH(x); }
  function zEA(x) { return LE(x) - 0.4 * CH(x); }
  // the wing bones: stations, droop at rest (rad, + = down) and bend per extra g (rad)
  const KN = [1.5, 9.6, 18.4, 22.6];
  const DROOP = [0.050, 0.085, 0.100, -0.18];
  const BEND = [-0.025, -0.035, -0.030, 0];
  const PODS = [9.6, 18.4];
  function podY(px) { return wLow(px, 0.3) - 0.45 - 0.74; }
  function podZ(px) { return LE(px) + 4.0; }               // the intake face
  const TANK_X = 25.4, OUT_X = 22.6, HSAB_X = 6.0;
  // the bomb bay and the gear
  const BAY = { x: 0.95, z0: 3.8, z1: -4.2, top: 3.45 };
  const BELLY = 1.55;
  const TRUCKS = [[1, 8.4], [-1, 8.4], [1, -6.9], [-1, -6.9]];
  const TYRE = { r: 0.71, w: 0.41 };

  // ---- the stores -------------------------------------------------------------
  // the bay: 3 across x 3 along x 3 high on clips, released bottom layer first,
  // aft to fore, alternating sides (release order k = 0..26)
  const BAYSLOT = (function () {
    const out = [];
    [1.95, 2.35, 2.75].forEach(function (y) {
      [-2.9, -0.2, 2.5].forEach(function (z) {
        [0.42, -0.42, 0].forEach(function (x) { out.push([x, y, z]); });
      });
    });
    return out;
  })();
  // a wing HSAB: two triple-ejector clusters (two shoulder, one below), in
  // the beam's own frame (origin under the wing at x = HSAB_X); release order
  const HSAB = (function () {
    const out = [];
    [-4.1, 0].forEach(function (dz) {
      [[0, -0.86], [0.33, -0.36], [-0.33, -0.36]].forEach(function (p) { out.push([p[0], p[1], dz - 1.0]); });
    });
    return out;
  })();

  const WEAPONS = [
    { id: "mk82_stick", seat: "radar", kind: "bombs", vs: "soft", store: "mk82", alt: ALT,
      rof: 7.7, stick: 820, pen: 120, beh: 1800, he: { pen: 120, beh: 1800, blast: 18, power: 2.8 }, range: 12000, ammo: 27 },
    { id: "gbu31_jdam", seat: "radar", kind: "bombs", vs: "any", store: "jdam", alt: ALT, guided: true, basket: 0.15,
      rof: 1.2, pen: 300, beh: 2600, he: { pen: 300, beh: 2600, blast: 30, power: 4.4 }, range: 12000, ammo: 12 },
  ];

  // =====================================================================
  //  THE TEMPLATE: every geometry and the node tree, built once per page
  // =====================================================================
  const RGB = function (hex) { return [(hex >> 16 & 255) / 255, (hex >> 8 & 255) / 255, (hex & 255) / 255]; };
  const C = {
    paint: 0x50555b, radome: 0x34373b, seam: 0x2c2f33, black: 0x0c0d0e, duct: 0x16181a, fan: 0x5d6166,
    metal: 0x8d9298, lip: 0xa3a8ae, rubber: 0x18191a, gear: 0xb6bac0, steel: 0x6b7077, interior: 0x2a2d30,
    panel: 0x141516, screen: 0x1d2b30, suit: 0x56603f, helmet: 0x3d4135, visor: 0x101214, skin: 0xa77f63,
    plug: 0x3a2e26, soot: 0x2a2724, rack: 0x3f4347, bay: 0x2f3236, evs: 0x0f1416,
  };
  let TPL = null;

  // the hull: [z, half width, top y, bottom y, top exponent, bottom exponent]
  const FUS = [
    [24.25, 0.05, 3.41, 3.31, 2.0, 2.0],
    [23.95, 0.45, 3.75, 2.95, 2.1, 2.1],
    [23.40, 0.84, 4.11, 2.51, 2.2, 2.3],
    [22.60, 1.16, 4.41, 2.13, 2.4, 2.6],
    [21.60, 1.36, 4.69, 1.85, 2.6, 3.0],
    [20.60, 1.46, 5.13, 1.69, 2.7, 3.4],
    [19.60, 1.50, 5.45, 1.61, 2.8, 3.6],
    [18.40, 1.51, 5.53, 1.57, 2.9, 3.8],
    [16.80, 1.51, 5.45, 1.55, 3.0, 3.8],
    [14.00, 1.51, 5.39, 1.55, 3.0, 3.8],
    [-6.00, 1.51, 5.39, 1.55, 3.0, 3.8],
    [-10.0, 1.48, 5.39, 1.71, 3.0, 3.5],
    [-14.0, 1.36, 5.37, 2.25, 2.9, 3.0],
    [-17.5, 1.14, 5.33, 2.95, 2.7, 2.6],
    [-20.5, 0.86, 5.25, 3.63, 2.5, 2.4],
    [-22.6, 0.58, 5.15, 4.11, 2.3, 2.2],
    [-23.8, 0.32, 4.95, 4.41, 2.1, 2.1],
    [-24.25, 0.05, 4.73, 4.63, 2.0, 2.0],
  ];
  const SZ = FUS.map(function (r) { return -r[0]; });
  const SLOPE = (function () {
    const out = [];
    for (let c = 1; c < 6; c++) {
      const m = [], n = FUS.length, d = [];
      for (let i = 0; i < n - 1; i++) d.push((FUS[i + 1][c] - FUS[i][c]) / (SZ[i + 1] - SZ[i]));
      for (let i = 0; i < n; i++) {
        if (i === 0) m.push(d[0]); else if (i === n - 1) m.push(d[n - 2]);
        else m.push(d[i - 1] * d[i] <= 0 ? 0 : 2 / (1 / d[i - 1] + 1 / d[i]));
      }
      out[c] = m;
    }
    return out;
  })();
  const _st = { w: 0, yt: 0, yb: 0, p: 2, pb: 2 };
  function station(z) {
    const s = -z;
    let i = 0;
    while (i < FUS.length - 2 && s > SZ[i + 1]) i++;
    const h = SZ[i + 1] - SZ[i], t = clamp((s - SZ[i]) / h, 0, 1);
    const t2 = t * t, t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
    const v = [];
    for (let c = 1; c < 6; c++) v[c] = h00 * FUS[i][c] + h10 * h * SLOPE[c][i] + h01 * FUS[i + 1][c] + h11 * h * SLOPE[c][i + 1];
    _st.w = Math.max(0.001, v[1]); _st.yt = v[2]; _st.yb = v[3]; _st.p = v[4]; _st.pb = v[5];
    return _st;
  }
  // a point on the hull: z, angle th (0 = port, PI/2 = top), offset outward
  function surf(z, th, off, out) {
    const S = station(z), c = Math.cos(th), sn = Math.sin(th), e = sn >= 0 ? S.p : S.pb;
    const cy = (S.yt + S.yb) / 2, hh = (S.yt - S.yb) / 2, ex = 2 / e;
    out[0] = (S.w + off) * Math.sign(c) * Math.pow(Math.abs(c), ex);
    out[1] = cy + (hh + off) * Math.sign(sn) * Math.pow(Math.abs(sn), ex);
    out[2] = z;
    return out;
  }
  // the hull's top / bottom at z (centreline)
  function hullTop(z) { return station(z).yt; }
  function hullBot(z) { return station(z).yb; }

  /* WHERE EACH PIECE OF SKIN GOES: [bucket] for the quad centred at (x, y, z),
     or null for an opening (the bomb bay). */
  function zoneOf(x, y, z) {
    const ax = Math.abs(x);
    const S = station(z), yc = (S.yt + S.yb) / 2, v = (y - yc) / Math.max(0.01, (S.yt - yc));
    // the bomb bay opening (the doors are their own nodes)
    if (z < BAY.z0 && z > BAY.z1 && ax < BAY.x && y < BELLY + 0.25) return null;
    if (z < BAY.z0 + 0.08 && z > BAY.z1 - 0.08 && ax < BAY.x + 0.08 && y < BELLY + 0.3) return "seam";
    // the radome
    if (z > 22.75) return z > 22.69 && z < 22.82 ? "seam" : "radome";
    // THE FLIGHT DECK GLAZING
    if (z > 20.02 && z < 21.32 && v > 0.42) {
      // windscreen posts: centre, and the two corner posts
      if (ax < 0.045 || Math.abs(ax - 0.66) < 0.05 || Math.abs(ax - 1.18) < 0.05) return "seam";
      return "glass";
    }
    if (z > 19.36 && z < 19.98 && v > 0.76 && ax > 0.24 && ax < 1.02) return Math.abs(ax - 0.63) < 0.04 ? "seam" : "glass";   // eyebrows
    if (z > 18.15 && z < 19.98 && v > 0.36 && v < 0.70 && ax > 1.2) return Math.abs(z - 19.05) < 0.05 ? "seam" : "glass";     // side windows
    if (z > 17.55 && z < 18.05 && y > 2.75 && y < 3.08 && ax > 1.38) return "glass";                                            // lower deck
    // frames round the glazing
    if (z > 19.95 && z < 21.40 && v > 0.36) return "seam";
    if (z > 19.30 && z < 20.05 && v > 0.72 && ax > 0.2 && ax < 1.08) return "seam";
    if (z > 18.08 && z < 20.05 && v > 0.32 && v < 0.74 && ax > 1.16) return "seam";
    if (z > 17.48 && z < 18.12 && y > 2.69 && y < 3.14 && ax > 1.36) return "seam";
    return "paint";
  }

  // ---- materials -------------------------------------------------------------
  let MATS = null;
  function mats() {
    if (MATS) return MATS;
    const THREE = window.THREE;
    function lam(hex, skin) {
      const m = new THREE.MeshLambertMaterial({ color: hex, vertexColors: true, skinning: !!skin });
      m._shared = true; return m;
    }
    MATS = {
      skinPaint: lam(0xffffff, true), skinVc: lam(0xffffff, true), skinBurnt: lam(0x343230, true),
      paint: lam(0xffffff), vc: lam(0xffffff), burnt: lam(0x343230),
      glass: new THREE.MeshPhongMaterial({ color: 0x1c2a34, specular: 0xb0c4d0, shininess: 95, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }),
      lamp: new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true }),
      flame: new THREE.MeshBasicMaterial({ color: 0xff7a1e, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }),
      band: Object.create(null),
    };
    MATS.glass._shared = MATS.lamp._shared = MATS.flame._shared = true;
    return MATS;
  }
  function bandMat(hex) {
    const M = mats(), k = String(hex);
    if (M.band[k]) return M.band[k];
    const m = new window.THREE.MeshLambertMaterial({ color: hex == null ? 0x8a1c1c : hex });
    m._shared = true;
    return (M.band[k] = m);
  }

  function template() {
    if (TPL) return TPL;
    const THREE = window.THREE, K = CBZ.milAir && CBZ.milAir.kit;
    if (!THREE || !K || !K.wing || !K.loft) return null;
    const xf = K.xf, mir = K.mir, box = K.box, rod = K.rod, loft = K.loft, rnd = K.rnd, wingG = K.wing, annulus = K.annulus;
    function at(g, x, y, z, rx, ry, rz) { return xf(g, x, y, z, rx, ry, rz); }
    function cylY(r0, r1, h, seg) { return new THREE.CylinderGeometry(r1, r0, h, seg || 12); }
    function cylZ(r, h, seg) { return xf(new THREE.CylinderGeometry(r, r, h, seg || 12), 0, 0, 0, PI / 2); }
    function cylX(r, h, seg) { return xf(new THREE.CylinderGeometry(r, r, h, seg || 12), 0, 0, 0, 0, 0, PI / 2); }
    function sph(r, ws, hs) { return new THREE.SphereGeometry(r, ws || 12, hs || 8); }

    // ---- THE NODE TREE (the prototype every airframe is cloned from) -----------
    const root = new THREE.Group(); root.name = "b52";
    const bones = [];
    const rootBone = new THREE.Bone(); rootBone.name = "b52-bone-0"; root.add(rootBone); bones.push(rootBone);
    const WB = { 1: [], "-1": [] };
    [1, -1].forEach(function (s) {
      let parent = rootBone, px = 0, py = 0, pz = 0;
      for (let i = 0; i < KN.length; i++) {
        const b = new THREE.Bone(); b.name = "b52-bone-" + (s > 0 ? "L" : "R") + i;
        const x = s * KN[i], y = WYx(KN[i]), z = zEA(KN[i]);
        b.position.set(x - px, y - py, z - pz);
        parent.add(b); bones.push(b); WB[s].push(b);
        parent = b; px = x; py = y; pz = z;
      }
    });
    const NODE = Object.create(null);
    function node(name, parent, x, y, z) {
      const g = new THREE.Group(); g.name = "b52-" + name;
      parent.updateWorldMatrix(true, false);
      const p = new THREE.Vector3(x || 0, y || 0, z || 0);
      parent.worldToLocal(p);
      g.position.copy(p);
      parent.add(g); g.updateWorldMatrix(true, false);
      NODE[name] = g; return g;
    }
    // a hinge: local +X along A->B; geometry goes in the child that deflects (rotation.x)
    function hinge(name, parent, A, B) {
      parent.updateWorldMatrix(true, false);
      const h = new THREE.Group(); h.name = "b52-" + name + ":hinge";
      const pa = new THREE.Vector3(A[0], A[1], A[2]), pb = new THREE.Vector3(B[0], B[1], B[2]);
      const ax = pb.clone().sub(pa).normalize();
      const qw = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), ax);
      const pq = new THREE.Quaternion(); parent.getWorldQuaternion(pq);
      h.quaternion.copy(pq.invert().multiply(qw));
      parent.worldToLocal(pa); h.position.copy(pa);
      parent.add(h);
      const d = new THREE.Group(); d.name = "b52-" + name; h.add(d);
      d.updateWorldMatrix(true, false);
      NODE[name] = d; return d;
    }
    root.updateMatrixWorld(true);

    // ---- buckets ----------------------------------------------------------------
    // SKIN: the one skinned airframe (paint | vc), weights by mode. RIGID: per node.
    const SKIN = { paint: [], vc: [] };
    const RIG = new Map();
    function weather(x, y, z, ny, wing) {
      let k = 1 + 0.07 * Math.max(0, ny) - 0.10 * Math.max(0, -ny);
      k *= 1 + 0.03 * Math.sin(x * 1.3 + z * 0.9) * Math.sin(y * 2.1 - z * 1.7) + 0.02 * Math.sin(z * 0.37 + x * 0.21);
      if (wing) {
        const ax = Math.abs(x);
        // TF33 soot: the streaks off each pod's exhaust under the wing and over the flaps
        for (let i = 0; i < PODS.length; i++) {
          const dx = ax - PODS[i];
          if (Math.abs(dx) > 2.2) continue;
          const zn = podZ(PODS[i]) - 5.6;
          if (z > zn) continue;
          const s = Math.exp(-dx * dx / 0.9) * clamp((zn - z) / 2.5, 0, 1) * (ny < 0.2 ? 1 : 0.45);
          k *= 1 - 0.32 * s;
        }
        // eroded leading edges
        const f = (LE(ax) - z) / Math.max(1, CH(ax));
        if (f < 0.06 && ax > 1.6) k *= 1.07;
      } else {
        if (y < BELLY + 0.25) k *= 0.9;                           // belly grime
        if (z < -18 && y > 4.3) k *= 0.95;                          // the fin root
      }
      return k;
    }
    function colour(g, col, wing) {
      const p = g.attributes.position, n = g.attributes.normal, N = p.count;
      const out = new Float32Array(N * 3);
      const paint = col === "paint" || (col && typeof col === "object");
      const tint = col && typeof col === "object" ? col.paint : 1;
      const base = paint ? null : RGB(col);
      for (let i = 0; i < N; i++) {
        let r, gg, b;
        if (paint) {
          const pc = RGB(C.paint), w = tint * weather(p.getX(i), p.getY(i), p.getZ(i), n ? n.getY(i) : 0, wing);
          r = pc[0] * w; gg = pc[1] * w; b = pc[2] * w;
        } else { r = base[0]; gg = base[1]; b = base[2]; }
        out[i * 3] = r; out[i * 3 + 1] = gg; out[i * 3 + 2] = b;
      }
      g.setAttribute("color", new THREE.BufferAttribute(out, 3));
    }
    function prep(g) {
      if (g.index === null) {
        const n = g.attributes.position.count, ix = []; for (let i = 0; i < n; i++) ix.push(i); g.setIndex(ix);
      }
      if (!g.attributes.normal) g.computeVertexNormals();
      if (!g.attributes.uv) g.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      return g;
    }
    // skin weights: mode "wing" (by span station), or a fixed bone index
    function skinOf(g, mode) {
      const p = g.attributes.position, N = p.count;
      const si = new Uint16Array(N * 4), sw = new Float32Array(N * 4);
      for (let i = 0; i < N; i++) {
        let b0 = 0, b1 = 0, w1 = 0;
        if (mode === "wing") {
          const x = p.getX(i), ax = Math.abs(x), off = x >= 0 ? 1 : 5;
          if (ax <= KN[0]) { b0 = 0; }
          else if (ax >= KN[3]) { b0 = off + 3; }
          else {
            let k = 0; while (k < 2 && ax > KN[k + 1]) k++;
            const t = (ax - KN[k]) / (KN[k + 1] - KN[k]);
            b0 = off + k; b1 = off + k + 1; w1 = t;
          }
        } else b0 = mode | 0;
        si[i * 4] = b0; si[i * 4 + 1] = b1; sw[i * 4] = 1 - w1; sw[i * 4 + 1] = w1;
      }
      g.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(si, 4));
      g.setAttribute("skinWeight", new THREE.Float32BufferAttribute(sw, 4));
    }
    // put a MODEL-space geometry onto the skinned airframe
    function skin(g, col, mode, wing) {
      if (!g) return;
      if (Array.isArray(g)) { for (let i = 0; i < g.length; i++) skin(g[i], col, mode, wing); return; }
      prep(g);
      colour(g, col, wing == null ? mode === "wing" : wing);
      skinOf(g, mode == null ? 0 : mode);
      SKIN[col === "paint" || (col && typeof col === "object") ? "paint" : "vc"].push(g);
    }
    // put a MODEL-space geometry into a rigid node's bucket: paint | vc | glass | lamp
    const _inv = new THREE.Matrix4();
    function put(nd, g, col, bucket) {
      if (!g) return;
      if (Array.isArray(g)) { for (let i = 0; i < g.length; i++) put(nd, g[i], col, bucket); return; }
      prep(g);
      if (!bucket) bucket = col === "paint" || (col && typeof col === "object") ? "paint" : "vc";
      if (bucket !== "glass") colour(g, col, false);
      nd.updateWorldMatrix(true, false);
      K.xm(g, _inv.copy(nd.matrixWorld).invert());
      let b = RIG.get(nd); if (!b) RIG.set(nd, b = { paint: [], vc: [], glass: [], lamp: [] });
      b[bucket].push(g);
    }
    function merge(list) {
      if (!list || !list.length) return null;
      let nv = 0, ni = 0;
      for (const g of list) { nv += g.attributes.position.count; ni += g.index.count; }
      const P = new Float32Array(nv * 3), N = new Float32Array(nv * 3), U = new Float32Array(nv * 2);
      const has = function (k) { return list.every(function (g) { return !!g.attributes[k]; }); };
      const Cc = has("color") ? new Float32Array(nv * 3) : null;
      const SI = has("skinIndex") ? new Uint16Array(nv * 4) : null, SW = SI ? new Float32Array(nv * 4) : null;
      const I = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
      let vo = 0, io = 0;
      for (const g of list) {
        const p = g.attributes.position;
        P.set(p.array, vo * 3);
        N.set(g.attributes.normal.array, vo * 3);
        if (g.attributes.uv && g.attributes.uv.itemSize === 2) U.set(g.attributes.uv.array, vo * 2);
        if (Cc) Cc.set(g.attributes.color.array, vo * 3);
        if (SI) { SI.set(g.attributes.skinIndex.array, vo * 4); SW.set(g.attributes.skinWeight.array, vo * 4); }
        const a = g.index.array; for (let i = 0; i < a.length; i++) I[io + i] = a[i] + vo; io += a.length;
        vo += p.count;
        g.dispose();
      }
      const out = new THREE.BufferGeometry();
      out.setAttribute("position", new THREE.BufferAttribute(P, 3));
      out.setAttribute("normal", new THREE.BufferAttribute(N, 3));
      out.setAttribute("uv", new THREE.BufferAttribute(U, 2));
      if (Cc) out.setAttribute("color", new THREE.BufferAttribute(Cc, 3));
      if (SI) { out.setAttribute("skinIndex", new THREE.BufferAttribute(SI, 4)); out.setAttribute("skinWeight", new THREE.BufferAttribute(SW, 4)); }
      out.setIndex(new THREE.BufferAttribute(I, 1));
      out.computeBoundingSphere(); out.computeBoundingBox();
      out._shared = true;
      return out;
    }

    // =================================================================
    //  THE FUSELAGE: one grid loft of superellipse sections
    // =================================================================
    const NR = 96, _p = [0, 0, 0];
    const ZS = (function () {
      const out = [];
      let z = 24.25;
      while (z > -24.25) {
        out.push(z);
        z -= z > 16.8 ? 0.09 : (z > 4.2 || z < -4.6 ? 0.32 : 0.2);
      }
      out.push(-24.25);
      // land a ring on the bay's edges
      [BAY.z0, BAY.z1].forEach(function (b) { let bi = 0, bd = 9; for (let i = 0; i < out.length; i++) if (Math.abs(out[i] - b) < bd) { bd = Math.abs(out[i] - b); bi = i; } out[bi] = b; });
      return out;
    })();
    function hullLoft(zs, off, sort, flipped) {
      const rings = zs.length;
      const P = new Float32Array(rings * (NR + 1) * 3);
      for (let i = 0; i < rings; i++) {
        for (let j = 0; j <= NR; j++) {
          surf(zs[i], j / NR * TAU, off, _p);
          const k = (i * (NR + 1) + j) * 3;
          P[k] = _p[0]; P[k + 1] = _p[1]; P[k + 2] = _p[2];
        }
      }
      const idx = [];
      for (let i = 0; i < rings - 1; i++) for (let j = 0; j < NR; j++) {
        const a = i * (NR + 1) + j, b = a + 1, c = a + NR + 1, d = c + 1;
        if (flipped) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(P, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      const Nn = g.attributes.normal.array;
      for (let i = 0; i < rings; i++) {
        const a = (i * (NR + 1)) * 3, b = (i * (NR + 1) + NR) * 3;
        for (let q = 0; q < 3; q++) { const v = (Nn[a + q] + Nn[b + q]) / 2; Nn[a + q] = v; Nn[b + q] = v; }
      }
      const out = Object.create(null);
      for (let t = 0; t < idx.length; t += 6) {
        const a = idx[t], b = idx[t + 1], c = idx[t + 2], e = idx[t + 4];
        const cx = (P[a * 3] + P[b * 3] + P[c * 3] + P[e * 3]) / 4;
        const cy = (P[a * 3 + 1] + P[b * 3 + 1] + P[c * 3 + 1] + P[e * 3 + 1]) / 4;
        const cz = (P[a * 3 + 2] + P[b * 3 + 2] + P[c * 3 + 2] + P[e * 3 + 2]) / 4;
        const r = sort(cx, cy, cz);
        if (!r) continue;
        const L = out[r] || (out[r] = { p: [], n: [] });
        for (let q = 0; q < 6; q++) {
          const v = idx[t + q];
          L.p.push(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]);
          L.n.push(Nn[v * 3], Nn[v * 3 + 1], Nn[v * 3 + 2]);
        }
      }
      g.dispose();
      const list = [];
      for (const k in out) {
        const gg = new THREE.BufferGeometry();
        gg.setAttribute("position", new THREE.Float32BufferAttribute(out[k].p, 3));
        gg.setAttribute("normal", new THREE.Float32BufferAttribute(out[k].n, 3));
        list.push({ bucket: k, g: gg });
      }
      return list;
    }
    hullLoft(ZS, 0, zoneOf).forEach(function (r) {
      if (r.bucket === "glass") put(root, r.g, null, "glass");
      else if (r.bucket === "paint") skin(r.g, "paint", 0);
      else skin(r.g, r.bucket === "radome" ? C.radome : C.seam, 0);
    });
    // the flight deck liner behind the glass (dark), only where there is skin
    hullLoft(ZS.filter(function (z) { return z < 21.5 && z > 16.9; }), -0.05, function (x, y, z) {
      return y > 2.3 ? "vc" : null;
    }, true).forEach(function (r) { skin(r.g, C.interior, 0); });
    // panel seams round the hull (frames) and the drag-chute door
    [16.2, 12.0, 6.6, -4.9, -9.6, -13.4, -17.2, -20.9].forEach(function (zc) {
      hullLoft([zc + 0.014, zc - 0.014], 0.006, function () { return "vc"; }).forEach(function (r) { skin(r.g, C.seam, 0); });
    });

    // ---- the wing-root fairing over the fuselage, the dorsal spine ---------------
    skin(loft([
      { z: 8.6, y: hullTop(8.6) - 0.06, w: 0.9, t: 0.04, b: 0.04, p: 3 },
      { z: 6.6, y: hullTop(6.6) - 0.06, w: 1.38, t: 0.42, b: 0.04, p: 3.2 },
      { z: 2.0, y: hullTop(2.0) - 0.06, w: 1.42, t: 0.48, b: 0.04, p: 3.4 },
      { z: -2.5, y: hullTop(-2.5) - 0.06, w: 1.40, t: 0.40, b: 0.04, p: 3.2 },
      { z: -5.5, y: hullTop(-5.5) - 0.06, w: 1.0, t: 0.12, b: 0.04, p: 3 },
      { z: -7.0, y: hullTop(-7.0) - 0.06, w: 0.6, t: 0.03, b: 0.03, p: 2.5 },
    ], { n: 28 }), "paint", 0);

    // =================================================================
    //  THE WING (skinned by span), spoilers, nav lights
    // =================================================================
    const WXS = [X0, 2.4, 4.0, 6.0, 8.0, 9.6, 11.2, 13.4, 15.8, 18.4, 20.5, 22.6, 24.4, 26.2, 27.4, 28.2];
    function wingStations(x0, x1, cut, back) {
      return WXS.filter(function (x) { return x >= x0 - 1e-6 && x <= x1 + 1e-6; }).map(function (x) {
        const c = CH(x), le = LE(x) - (back || 0) * c;
        return { x: x, le: le, c: c * (cut || 1), tc: TC(x) / (cut || 1) * (cut ? 0.92 : 1), y: WYx(x) };
      });
    }
    {
      const wg = wingG(wingStations(X0, 28.2), { K: 10 });
      skin([wg, mir(wg)], "paint", "wing");
      // flap and spoiler panel lines (top and bottom) along the span
      [0.70, 0.78].forEach(function (f) {
        [1, -1].forEach(function (s) {
          for (let i = 0; i < WXS.length - 1; i++) {
            const xa = WXS[i], xb = WXS[i + 1];
            if (xa < 1.6) continue;
            [wUp, wLow].forEach(function (fn) {
              const ya = fn(xa, f) + (fn === wUp ? 0.006 : -0.006), yb = fn(xb, f) + (fn === wUp ? 0.006 : -0.006);
              skin(rod([s * xa, ya, LE(xa) - f * CH(xa)], [s * xb, yb, LE(xb) - f * CH(xb)], 0.012, 3), C.seam, "wing");
            });
          }
        });
      });
    }
    // spoilers: five panels per wing between the pods, on the upper surface
    const SPOIL = { 1: [], "-1": [] };
    [1, -1].forEach(function (s) {
      const bone = WB[s][1];
      for (let i = 0; i < 5; i++) {
        const xa = 10.6 + i * 1.5, xb = xa + 1.38, f = 0.56;
        const A = [s * xa, wUp(xa, f) + 0.004, LE(xa) - f * CH(xa)], B = [s * xb, wUp(xb, f) + 0.004, LE(xb) - f * CH(xb)];
        const nd = hinge("spoiler" + (s > 0 ? "L" : "R") + i, bone, s > 0 ? A : B, s > 0 ? B : A);
        // the panel: a thin plate from the hinge back 14 % chord, following the surface
        const g = new THREE.BufferGeometry(), pos = [], ix = [];
        const NS = 4, cf = 0.14;
        for (let a = 0; a <= NS; a++) {
          const x = xa + (xb - xa) * a / NS;
          for (let q = 0; q <= 2; q++) {
            const ff = f + cf * q / 2;
            pos.push(s * x, wUp(x, ff) + 0.012, LE(x) - ff * CH(x));
          }
        }
        for (let a = 0; a < NS; a++) for (let q = 0; q < 2; q++) {
          const i0 = a * 3 + q;
          if (s > 0) ix.push(i0, i0 + 1, i0 + 3, i0 + 1, i0 + 4, i0 + 3); else ix.push(i0, i0 + 3, i0 + 1, i0 + 1, i0 + 3, i0 + 4);
        }
        g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(ix); g.computeVertexNormals();
        put(nd, g, { paint: 0.94 });
        put(nd, rod(A, B, 0.01, 3), C.seam);
        SPOIL[s].push(nd);
      }
    });
    // nav lights (red port, green starboard) at the tips; tail white
    [1, -1].forEach(function (s) {
      const nd = node("tip" + (s > 0 ? "L" : "R"), WB[s][3], s * 28.25, WYx(28.2), LE(28.2) - 1.6);
      put(nd, at(sph(0.1, 8, 6), s * 28.25, WYx(28.2), LE(28.2) - 1.6), s > 0 ? 0xff3b30 : 0x30d070, "lamp");
    });

    // =================================================================
    //  ENGINES: four twin pods of TF33s on swept pylons
    // =================================================================
    const FANS = [], NOZ = [];
    [1, -1].forEach(function (s) {
      PODS.forEach(function (px, pi) {
        const bone = WB[s][pi + 1];
        const y = podY(px), zf = podZ(px), bi = (s > 0 ? 1 : 5) + pi + 1;
        const pod = node("pod" + (s > 0 ? "L" : "R") + pi, bone, s * px, y, zf - 5.6);
        NOZ.push({ node: pod, s: s, pi: pi });
        [-0.78, 0.78].forEach(function (dx) {
          const x = s * px + dx;
          // nacelle: intake lip, fan cowl, the fan exhaust step, core cowl, nozzle
          skin(loft([rnd(zf, 0.70, y, x), rnd(zf - 0.32, 0.75, y, x), rnd(zf - 1.4, 0.75, y, x), rnd(zf - 2.25, 0.72, y, x)], { n: 24, capFront: false, capBack: false }), "paint", bi, true);
          skin(loft([rnd(zf - 2.3, 0.55, y, x), rnd(zf - 3.3, 0.54, y, x), rnd(zf - 4.6, 0.46, y, x), rnd(zf - 5.0, 0.37, y, x)], { n: 20, capFront: false, capBack: false }), { paint: 0.82 }, bi, true);
          skin(annulus(rnd(zf, 0.70, y, x), rnd(zf, 0.58, y, x), 24, [0, 0, 1]), C.lip, bi);
          skin(loft([rnd(zf, 0.58, y, x), rnd(zf - 0.62, 0.55, y, x)], { n: 24, caps: false, flipped: true }), C.duct, bi);
          skin(annulus(rnd(zf - 2.25, 0.72, y, x), rnd(zf - 2.25, 0.55, y, x), 24, [0, 0, -1]), C.black, bi);
          skin(annulus(rnd(zf - 5.0, 0.37, y, x), rnd(zf - 5.0, 0.24, y, x), 20, [0, 0, -1]), C.soot, bi);
          skin(loft([rnd(zf - 4.85, 0.24, y, x), rnd(zf - 5.3, 0.17, y, x), rnd(zf - 5.62, 0.02, y, x)], { n: 14 }), C.plug, bi);
          // the oil-cooler scoop under the fan cowl, the cowl hinge seam
          skin(loft([rnd(zf - 0.6, 0.06, y - 0.70, x, { w: 0.14 }), rnd(zf - 0.8, 0.12, y - 0.74, x, { w: 0.2 }), rnd(zf - 1.9, 0.10, y - 0.72, x, { w: 0.18 }), rnd(zf - 2.2, 0.03, y - 0.70, x, { w: 0.1 })], { n: 10 }), { paint: 0.9 }, bi, true);
          skin(rod([x, y + 0.752, zf - 0.4], [x, y + 0.752, zf - 2.1], 0.008, 3), C.seam, bi);
          // the fan: spinner and blades (its own node, spun by the rig)
          const fan = node("fan" + FANS.length, pod, x, y, zf - 0.6);
          const parts = [at(cylZ(0.17, 0.12, 14), x, y, zf - 0.6), at(xf(new THREE.ConeGeometry(0.17, 0.3, 14), 0, 0, 0, PI / 2), x, y, zf - 0.39)];
          for (let k = 0; k < 18; k++) {
            const a = k * TAU / 18;
            parts.push(at(box(0.36, 0.012, 0.10), x + Math.cos(a) * 0.36, y + Math.sin(a) * 0.36, zf - 0.6, 0.55, 0, a));
          }
          put(fan, parts, C.fan);
          put(fan, at(new THREE.CircleGeometry(0.55, 24), x, y, zf - 0.66, 0, 0, 0), C.duct);
          FANS.push(fan);
        });
        // the pylon: a swept blade from between the nacelles up into the wing
        const ytop = wLow(px, 0.25) + 0.25, ybot = y + 0.5;
        const pl = wingG([{ x: 0, le: zf - 0.9, c: 4.4, tc: 0.10 }, { x: ytop - ybot, le: LE(px) + 0.3, c: 5.2, tc: 0.10 }], { K: 5 });
        skin(at(pl, s * px, ybot, 0, 0, 0, PI / 2), { paint: 0.96 }, bi, true);
        skin(at(box(0.7, 0.4, 4.3), s * px, y + 0.32, zf - 2.6), { paint: 0.96 }, bi, true);
        // the fire flame (shown when this pod burns)
        const fl = node("flame" + (s > 0 ? "L" : "R") + pi, pod, s * px, y, zf - 5.6);
        NOZ[NOZ.length - 1].flame = fl;
      });
    });

    // ---- external tanks, the outriggers' fairings -------------------------------
    [1, -1].forEach(function (s) {
      const x = s * TANK_X, y = wLow(TANK_X, 0.3) - 0.62, z0 = LE(TANK_X) + 2.0, bi = s > 0 ? 4 : 8;
      skin(loft([rnd(z0, 0.04, y, x), rnd(z0 - 0.8, 0.38, y, x), rnd(z0 - 2.2, 0.52, y, x), rnd(z0 - 5.0, 0.50, y, x), rnd(z0 - 6.6, 0.22, y, x), rnd(z0 - 7.1, 0.03, y, x)], { n: 18 }), "paint", bi, true);
      skin(at(box(0.10, 0.5, 2.4), x, y + 0.55, z0 - 3.2), { paint: 0.9 }, bi, true);
      // the tank's tail fins
      skin(at(box(0.04, 0.6, 0.7), x, y + 0.42, z0 - 6.5), "paint", bi, true);
      // the outrigger's well
      skin(at(box(0.5, 0.06, 1.6), s * OUT_X, wLow(OUT_X, 0.45) - 0.02, LE(OUT_X) - 0.45 * CH(OUT_X)), C.seam, bi, true);
    });

    // ---- the HSABs (Heavy Stores Adapter Beams) between fuselage and inboard pods ----
    const HS = {};
    [1, -1].forEach(function (s) {
      const x = s * HSAB_X, yb = wLow(HSAB_X, 0.3) - 0.55, zl = LE(HSAB_X);
      const pl = wingG([{ x: 0, le: zl - 0.2, c: 3.4, tc: 0.11 }, { x: 0.62, le: zl - 0.1, c: 3.6, tc: 0.11 }], { K: 4 });
      const hb = s > 0 ? 1 : 5;          // the beam and its bombs ride one bone together
      skin(at(pl, x, yb + 0.05, 0, 0, 0, PI / 2), C.rack, hb, false);
      skin(at(box(0.36, 0.22, 6.4), x, yb, zl - 3.1), C.rack, hb, false);
      // the ejector racks (two TERs)
      [-1.0, -5.1].forEach(function (dz) { skin(at(box(0.62, 0.18, 1.6), x, yb - 0.18, zl + dz), C.rack, hb, false); });
      HS[s] = node("hsab" + (s > 0 ? "L" : "R"), WB[s][0], x, yb - 0.1, zl);
    });

    // =================================================================
    //  THE TAIL: fin + rudder, stabiliser + elevators, the stinger
    // =================================================================
    const FIN = { y0: 5.25, h: 7.15, le0: -11.6, sw: 0.95, c0: 11.2, c1: 3.6, tc0: 0.10, tc1: 0.08 };
    function finSt(h, cut) {
      const t = h / FIN.h, c = FIN.c0 + (FIN.c1 - FIN.c0) * t;
      return { x: h, le: FIN.le0 - h * FIN.sw, c: c * (cut || 1), tc: (FIN.tc0 + (FIN.tc1 - FIN.tc0) * t) / (cut || 1) * (cut ? 0.9 : 1) };
    }
    const RUD = 0.16;
    skin(at(wingG([finSt(0, 1 - RUD), finSt(2.4, 1 - RUD), finSt(4.6, 1 - RUD), finSt(6.35, 1 - RUD)], { K: 8 }), 0, FIN.y0, 0, 0, 0, PI / 2), "paint", 0);
    const BAND = (function () {
      const g = wingG([finSt(6.35, 1 - RUD), finSt(FIN.h, 1 - RUD)], { K: 8, root: false });
      xf(g, 0, FIN.y0, 0, 0, 0, PI / 2); prep(g); g._shared = true; return g;
    })();
    {
      const a = finSt(0.25), b = finSt(FIN.h - 0.05);
      const A = [0, FIN.y0 + 0.25, a.le - a.c * (1 - RUD)], B = [0, FIN.y0 + FIN.h - 0.05, b.le - b.c * (1 - RUD)];
      const rud = hinge("rudder", rootBone, A, B);
      const rs = function (h) { const s = finSt(h); return { x: h, le: s.le - s.c * (1 - RUD) - 0.02, c: s.c * RUD, tc: 0.12 }; };
      put(rud, at(wingG([rs(0.25), rs(3.5), rs(FIN.h - 0.05)], { K: 4 }), 0, FIN.y0, 0, 0, 0, PI / 2), { paint: 0.95 });
    }
    // the stabiliser (the fixed part) and its elevators
    const ST = { y: 4.62, x0: 0.6, x1: 7.7, le0: -16.6, sw: 0.72, c0: 6.2, c1: 2.1, ev: 0.28 };
    function stSt(x, cut, off) {
      const t = (x - ST.x0) / (ST.x1 - ST.x0), c = ST.c0 + (ST.c1 - ST.c0) * t;
      return { x: x, le: ST.le0 - (x - ST.x0) * ST.sw - (off || 0) * c, c: c * (cut || 1), tc: 0.09 / (cut ? Math.max(0.3, cut) : 1) * (cut ? 0.8 : 1), y: ST.y + 0.03 * (x - ST.x0) };
    }
    {
      const sg = wingG([stSt(ST.x0, 1 - ST.ev), stSt(4, 1 - ST.ev), stSt(ST.x1, 1 - ST.ev)], { K: 7 });
      skin([sg, mir(sg)], "paint", 0);
      [1, -1].forEach(function (s) {
        const a = stSt(ST.x0 + 0.3), b = stSt(ST.x1 - 0.05);
        const A = [s * a.x, a.y, a.le - a.c * (1 - ST.ev)], B = [s * b.x, b.y, b.le - b.c * (1 - ST.ev)];
        const ev = hinge("elev" + (s > 0 ? "L" : "R"), rootBone, s > 0 ? A : B, s > 0 ? B : A);
        let eg = wingG([stSt(ST.x0 + 0.3, ST.ev, 1 - ST.ev), stSt(ST.x1 - 0.05, ST.ev, 1 - ST.ev)].map(function (q) { q.le -= 0.02; q.tc = 0.16; return q; }), { K: 4 });
        if (s < 0) eg = mir(eg);
        put(ev, eg, { paint: 0.95 });
      });
    }
    // the stinger: tail-warning radar fairing and ECM antennas where the gun was
    skin([at(loft([rnd(-23.0, 0.30, 5.05), rnd(-23.9, 0.34, 5.08), rnd(-24.6, 0.22, 5.04), rnd(-24.85, 0.04, 5.0)], { n: 14 }), 0, 0, 0)], C.radome, 0);
    skin([at(box(0.5, 0.36, 0.4), 0, 4.62, -24.15), at(sph(0.16, 10, 6), 0.0, 4.35, -24.2)], C.radome, 0);
    // the drag-chute door seam on top behind the fin
    skin(at(box(0.9, 0.02, 1.6), 0, hullTop(-22.4) + 0.005, -22.4), C.seam, 0);

    // =================================================================
    //  THE NOSE: EVS turrets, cheek antennas, pitots, receptacle, antennas
    // =================================================================
    [1, -1].forEach(function (s) {
      const z = 21.85, y = hullBot(z) + 0.08;
      skin(at(new THREE.SphereGeometry(0.34, 14, 8, 0, TAU, 0, PI / 2), s * 0.70, y, z, PI), { paint: 0.92 }, 0);
      skin(at(new THREE.SphereGeometry(0.22, 12, 6, 0, TAU, 0, PI / 2), s * 0.70, y - 0.12, z + 0.08, PI * 0.82), C.evs, 0);
      // cheek ECM antenna fairings and the pitot tubes
      skin(loft([rnd(22.5, 0.02, 3.35, s * 1.06, { w: 0.02 }), rnd(22.1, 0.24, 3.35, s * 1.20, { w: 0.12 }), rnd(20.9, 0.24, 3.3, s * 1.34, { w: 0.12 }), rnd(20.5, 0.02, 3.3, s * 1.36, { w: 0.02 })], { n: 10 }), { paint: 0.88 }, 0);
      skin([rod([s * 0.95, 3.9, 22.4], [s * 1.0, 3.95, 22.9], 0.02, 5), at(cylZ(0.025, 0.25, 6), s * 1.0, 3.95, 23.0)], C.steel, 0);
      // the forward truck doors' seam and the crew entry hatch
      skin(at(box(0.02, 0.03, 1.2), s * 0.6, hullBot(16.4) - 0.005, 16.4), C.seam, 0);
    });
    skin(at(box(1.0, 0.02, 1.15), 0, hullBot(15.6) - 0.006, 15.6), C.seam, 0);
    // UARRSI: the refuelling receptacle's slipway on top behind the flight deck
    skin([at(box(0.62, 0.03, 1.5), 0, hullTop(16.6) + 0.004, 16.6), at(box(0.22, 0.04, 0.4), 0, hullTop(16.1) + 0.01, 16.1)], C.black, 0);
    skin([rod([0.32, hullTop(17.3) + 0.01, 17.3], [0.24, hullTop(15.9) + 0.01, 15.9], 0.015, 3), rod([-0.32, hullTop(17.3) + 0.01, 17.3], [-0.24, hullTop(15.9) + 0.01, 15.9], 0.015, 3)], 0xd8d0b0, 0);
    // blade antennas top and bottom
    [[12.6, 1], [3.2, 1], [-9.8, 1], [-15.6, 1], [13.8, -1], [-11.5, -1]].forEach(function (a) {
      const y = a[1] > 0 ? hullTop(a[0]) : hullBot(a[0]);
      skin(at(box(0.04, 0.42, 0.55), 0, y + a[1] * 0.2, a[0], a[1] * -0.25), C.rack, 0);
    });
    // the beacons (flash) and the tail light
    const beaconT = node("beaconT", rootBone, 0, hullTop(-1.2) + 0.08, -1.2);
    put(beaconT, at(sph(0.11, 10, 6), 0, hullTop(-1.2) + 0.08, -1.2), 0xff2a20, "lamp");
    const beaconB = node("beaconB", rootBone, 0, BELLY - 0.08, 11.6);
    put(beaconB, at(sph(0.11, 10, 6), 0, BELLY - 0.08, 11.6), 0xff2a20, "lamp");
    put(root, at(sph(0.08, 8, 6), 0, 4.75, -24.9), 0xf2f4ff, "lamp");

    // ---- the flight deck: panel, seats, the two pilots -------------------------------
    skin([at(box(2.3, 0.5, 0.14), 0, 4.48, 20.55, -0.35), at(box(2.4, 0.08, 0.5), 0, 4.78, 20.62)], C.panel, 0);
    skin([at(box(0.5, 0.26, 0.02), -0.45, 4.52, 20.47, -0.35), at(box(0.5, 0.26, 0.02), 0.45, 4.52, 20.47, -0.35)], C.screen, 0);
    skin(at(box(2.8, 0.06, 4.4), 0, 3.82, 18.9), C.interior, 0);
    [-0.62, 0.62].forEach(function (x) {
      skin([at(box(0.58, 0.12, 0.56), x, 4.1, 19.25), at(box(0.6, 0.95, 0.14), x, 4.6, 18.92, 0.1)], C.interior, 0);
      // the pilot: torso, head in a helmet, arms to the yoke
      skin([at(box(0.42, 0.55, 0.26), x, 4.52, 19.18, -0.1), at(cylY(0.11, 0.11, 0.1, 8), x, 4.85, 19.2)], C.suit, 0);
      skin(at(sph(0.15, 12, 8), x, 5.0, 19.24), C.helmet, 0);
      skin(at(box(0.2, 0.07, 0.04), x, 5.0, 19.38), C.visor, 0);
      skin([rod([x - 0.2, 4.68, 19.2], [x - 0.08, 4.42, 19.62], 0.04, 6), rod([x + 0.2, 4.68, 19.2], [x + 0.08, 4.42, 19.62], 0.04, 6)], C.suit, 0);
      skin(rod([x, 4.1, 19.8], [x, 4.42, 19.66], 0.03, 6), C.black, 0);
    });

    // =================================================================
    //  THE BOMB BAY: liner, clips, two doors
    // =================================================================
    {
      const L = BAY.z0 - BAY.z1, zc = (BAY.z0 + BAY.z1) / 2, hgt = BAY.top - BELLY;
      const li = xf(box(BAY.x * 2, hgt, L), 0, BELLY + hgt / 2 - 0.02, zc);
      // inside-facing: flip the winding
      const ia = li.index.array; for (let i = 0; i < ia.length; i += 3) { const t = ia[i + 1]; ia[i + 1] = ia[i + 2]; ia[i + 2] = t; }
      li.computeVertexNormals();
      skin(li, C.bay, 0);
      // the clip racks (three vertical beams across the bay)
      [2.5, -0.2, -2.9].forEach(function (z) {
        [0.21, -0.21].forEach(function (x) { skin(at(box(0.05, 1.5, 0.12), x, 2.45, z), C.rack, 0); });
      });
      skin(at(box(1.8, 0.08, L - 0.2), 0, BAY.top - 0.05, zc), C.rack, 0);
      [1, -1].forEach(function (s) {
        const A = [s * BAY.x, BELLY + 0.02, BAY.z0], B = [s * BAY.x, BELLY + 0.02, BAY.z1];
        const d = hinge("door" + (s > 0 ? "L" : "R"), rootBone, A, B);
        const pts = [];
        for (let k = 0; k <= 8; k++) { const x = s * BAY.x * (1 - k / 8); pts.push(x); }
        const g = new THREE.BufferGeometry(), pos = [], ix = [];
        for (let k = 0; k <= 8; k++) {
          const x = pts[k], y = BELLY + 0.004 + (x / BAY.x) * (x / BAY.x) * 0.02;
          pos.push(x, y, BAY.z0 - 0.01, x, y, BAY.z1 + 0.01);
        }
        for (let k = 0; k < 8; k++) { const a = k * 2; if (s > 0) ix.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); else ix.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
        g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(ix); g.computeVertexNormals();
        // a door is skin outside, structure inside
        const inner = g.clone(); inner.translate(0, 0.03, 0);
        const ii = inner.index.array; for (let i = 0; i < ii.length; i += 3) { const t = ii[i + 1]; ii[i + 1] = ii[i + 2]; ii[i + 2] = t; }
        inner.computeVertexNormals();
        put(d, g, { paint: 0.95 });
        put(d, inner, C.bay);
        // the stiffeners on the inside face
        for (let k = 0; k < 6; k++) put(d, at(box(BAY.x * 0.9, 0.06, 0.05), s * BAY.x * 0.5, BELLY + 0.06, BAY.z0 - 0.6 - k * 1.36), C.rack);
        NODE["door" + (s > 0 ? "L" : "R")] = d;
      });
    }

    // =================================================================
    //  THE GEAR: four twin-wheel trucks, their doors, the outriggers
    // =================================================================
    const W = K.wheel(TYRE.r, TYRE.w);
    TRUCKS.forEach(function (t, i) {
      const s = t[0], z = t[1], x = s * 1.0;
      const tr = node("truck" + i, rootBone, x, BELLY + 0.1, z);
      put(tr, [rod([x, BELLY + 0.15, z], [x, TYRE.r, z], 0.12, 10), at(box(0.9, 0.16, 0.24), x, TYRE.r, z),
        rod([x, BELLY - 0.05, z + 0.9], [x, TYRE.r + 0.12, z + 0.08], 0.06, 6)], C.gear);
      [-0.29, 0.29].forEach(function (dx) {
        put(tr, at(W.tire.clone(), x + dx, TYRE.r, z), C.rubber);
        put(tr, at(W.hub.clone(), x + dx, TYRE.r, z), C.steel);
      });
      // the bay door on the outer side, hinged at the hull's lower edge
      const A = [s * 1.42, BELLY + 0.12, z + 1.25], B = [s * 1.42, BELLY + 0.12, z - 1.25];
      const d = hinge("gdoor" + i, rootBone, s > 0 ? A : B, s > 0 ? B : A);
      put(d, at(box(0.03, 1.0, 2.5), s * 1.42, BELLY + 0.12 - 0.5, z), { paint: 0.93 });
    });
    [1, -1].forEach(function (s) {
      const z = LE(OUT_X) - 0.45 * CH(OUT_X), ytop = wLow(OUT_X, 0.45);
      // the strut reaches the ground when the wing droops (rest pose); its length is the droop
      const drop = DROOP[0] * (OUT_X - KN[0]) + DROOP[1] * (OUT_X - KN[1]) + DROOP[2] * (OUT_X - KN[2]);
      const len = ytop - drop - 0.41;
      const o = node("outrig" + (s > 0 ? "L" : "R"), WB[s][3], s * OUT_X, ytop, z);
      put(o, [rod([s * OUT_X, ytop, z], [s * OUT_X, ytop - len + 0.12, z - 0.18], 0.07, 8), rod([s * OUT_X, ytop - len * 0.4, z - 0.6], [s * OUT_X, ytop - 0.05, z - 1.0], 0.04, 6)], C.gear);
      const ow = K.wheel(0.41, 0.24);
      put(o, at(ow.tire, s * OUT_X, ytop - len, z - 0.18), C.rubber);
      put(o, at(ow.hub, s * OUT_X, ytop - len, z - 0.18), C.steel);
    });

    // ---- flags: one plane geometry, placed per airframe ---------------------------
    const G = { flag: new THREE.PlaneGeometry(2.1, 1.3), flagS: new THREE.PlaneGeometry(1.25, 0.78), band: BAND };
    G.flag._shared = G.flagS._shared = true;

    // ---- bake -------------------------------------------------------------------------
    G.skinPaint = merge(SKIN.paint); G.skinVc = merge(SKIN.vc);
    RIG.forEach(function (b, nd) {
      ["paint", "vc", "glass", "lamp"].forEach(function (k) {
        const g = merge(b[k]);
        if (!g) return;
        const M = mats();
        const m = new THREE.Mesh(g, k === "paint" ? M.paint : k === "vc" ? M.vc : k === "glass" ? M.glass : M.lamp);
        m.castShadow = k === "paint" || k === "vc"; m.receiveShadow = k !== "lamp" && k !== "glass";
        m.name = "b52-part-" + k;
        nd.add(m);
      });
    });
    // flames: a cone of fire out of each pod's nozzle (hidden)
    NOZ.forEach(function (n) {
      const fl = new THREE.Mesh(xf(new THREE.ConeGeometry(0.9, 5.5, 10, 1, true), 0, 2.75, 0, 0, 0, 0), mats().flame);
      fl.rotation.x = -PI / 2;     // the base on the nozzle, the tongue trailing aft fl.visible = false; fl.name = "b52-flame";
      n.flame.add(fl);
    });
    root.updateMatrixWorld(true);
    const boneInv = bones.map(function (b) { return new THREE.Matrix4().copy(b.matrixWorld).invert(); });
    TPL = { root: root, G: G, boneInv: boneInv, nb: bones.length };
    return TPL;
  }

  // ---- nation flags ------------------------------------------------------------------
  const FLAGM = Object.create(null);
  function flagMat(id, design) {
    if (FLAGM[id] !== undefined) return FLAGM[id];
    const THREE = window.THREE, F = CBZ.flags;
    let m = null;
    try {
      const d = design || (F && F.designFor ? F.designFor(id) : null);
      if (THREE && F && F.paint && d && typeof document !== "undefined") {
        const c = document.createElement("canvas"); c.width = 192; c.height = 120;
        const g = c.getContext && c.getContext("2d");
        if (g) {
          F.paint(g, d, 192, 120, { grain: false });
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
  //  TRAILS: contrails, engine smoke, fire smoke. One mesh per airframe,
  //  world space, crossed soft ribbons (5 verts a sample), no allocation.
  // =====================================================================
  const TRN = 64, TREVERY = 0.6;
  let TRMAT = null;
  function trailMat() {
    if (TRMAT) return TRMAT;
    const THREE = window.THREE;
    TRMAT = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {}]),
      vertexShader: "attribute float a; attribute vec3 tint; varying float vA; varying vec3 vC;\n#include <fog_pars_vertex>\nvoid main(){ vA = a; vC = tint; vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mvPosition;\n#include <fog_vertex>\n}",
      fragmentShader: "varying float vA; varying vec3 vC;\n#include <fog_pars_fragment>\nvoid main(){ if (vA < 0.004) discard; gl_FragColor = vec4(vC, vA);\n#include <fog_fragment>\n}",
      transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true,
    });
    TRMAT._shared = true;
    return TRMAT;
  }
  // per-mode look: [r, g, b, alpha, life s, width0, grow m/s, fade-in s]
  const TMODE = [null,
    [0.93, 0.95, 0.97, 0.50, 38, 1.6, 1.15, 0.35],    // contrail
    [0.38, 0.36, 0.33, 0.22, 7, 1.0, 1.3, 0.05],      // TF33 smoke (low)
    [0.07, 0.06, 0.06, 0.62, 12, 1.8, 2.6, 0.0],      // a pod on fire
  ];
  function makeTrails(nT) {
    const THREE = window.THREE;
    const NV = nT * TRN * 5;
    const pos = new Float32Array(NV * 3), al = new Float32Array(NV), ti = new Float32Array(NV * 3);
    const idx = [];
    for (let t = 0; t < nT; t++) for (let k = 0; k < TRN - 1; k++) {
      const a = (t * TRN + k) * 5, b = a + 5;
      // centre 0, side +1, side -1, up +3, down +4
      idx.push(a, a + 1, b, a + 1, b + 1, b, a, b, a + 2, a + 2, b, b + 2,
        a, a + 3, b, a + 3, b + 3, b, a, b, a + 4, a + 4, b, b + 4);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("a", new THREE.BufferAttribute(al, 1));
    g.setAttribute("tint", new THREE.BufferAttribute(ti, 3));
    g.setIndex(idx);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    const mesh = new THREE.Mesh(g, trailMat());
    mesh.frustumCulled = false; mesh.renderOrder = 840; mesh.name = "b52-trails";
    mesh.visible = false;
    return { mesh: mesh, g: g, pos: pos, al: al, ti: ti, nT: nT,
      sx: new Float32Array(nT * TRN), sy: new Float32Array(nT * TRN), sz: new Float32Array(nT * TRN),
      st: new Float32Array(nT * TRN), sm: new Uint8Array(nT * TRN), n: new Int32Array(nT), last: -1, added: false, wall: 0 };
  }
  // push a sample for each trail (newest first), then rewrite the ribbons
  function trailsStep(T, now, heads, modes, push) {
    const N = TRN;
    for (let t = 0; t < T.nT; t++) {
      const o = t * N;
      if (push) {
        // shift (N is small; ordered buffers keep the index static)
        for (let k = N - 1; k > 0; k--) { T.sx[o + k] = T.sx[o + k - 1]; T.sy[o + k] = T.sy[o + k - 1]; T.sz[o + k] = T.sz[o + k - 1]; T.st[o + k] = T.st[o + k - 1]; T.sm[o + k] = T.sm[o + k - 1]; }
        T.n[t] = Math.min(N, T.n[t] + 1);
      }
      // sample 0 is the live head at the nozzle
      T.sx[o] = heads[t * 3]; T.sy[o] = heads[t * 3 + 1]; T.sz[o] = heads[t * 3 + 2]; T.st[o] = now; T.sm[o] = modes[t];
      if (T.n[t] < 1) T.n[t] = 1;
      for (let k = 0; k < N; k++) {
        const i = o + k, v = i * 5;
        const kk = k < T.n[t] ? k : T.n[t] - 1, j = o + kk;
        const m = T.sm[j], M = TMODE[m];
        const age = Math.max(0, now - T.st[j]);
        let a = 0, w = 1;
        if (M && k < T.n[t]) {
          a = M[3] * clamp(M[7] > 0 ? age / M[7] : 1, 0, 1) * clamp(1 - age / M[4], 0, 1);
          w = M[5] + M[6] * age;
        }
        // the ribbon's frame: along the trail, a horizontal side, an up
        const j2 = kk + 1 < T.n[t] ? j + 1 : (kk > 0 ? j - 1 : j);
        let dx = T.sx[j] - T.sx[j2], dy = T.sy[j] - T.sy[j2], dz = T.sz[j] - T.sz[j2];
        if (j2 < j) { dx = -dx; dy = -dy; dz = -dz; }
        let L = Math.hypot(dx, dy, dz); if (L < 1e-4) { dx = 0; dy = 0; dz = 1; L = 1; }
        dx /= L; dy /= L; dz /= L;
        let sx = dz, sz = -dx, sl = Math.hypot(sx, sz); if (sl < 1e-4) { sx = 1; sz = 0; sl = 1; }
        sx /= sl; sz /= sl;
        // up = side x along (unit: the two are perpendicular)
        const ux = -sz * dy, uy = sz * dx - sx * dz, uz = sx * dy;
        const x = T.sx[j], y = T.sy[j], z = T.sz[j];
        T.pos[v * 3] = x; T.pos[v * 3 + 1] = y; T.pos[v * 3 + 2] = z;
        T.pos[v * 3 + 3] = x + sx * w; T.pos[v * 3 + 4] = y; T.pos[v * 3 + 5] = z + sz * w;
        T.pos[v * 3 + 6] = x - sx * w; T.pos[v * 3 + 7] = y; T.pos[v * 3 + 8] = z - sz * w;
        T.pos[v * 3 + 9] = x + ux * w; T.pos[v * 3 + 10] = y + uy * w; T.pos[v * 3 + 11] = z + uz * w;
        T.pos[v * 3 + 12] = x - ux * w; T.pos[v * 3 + 13] = y - uy * w; T.pos[v * 3 + 14] = z - uz * w;
        T.al[v] = a; T.al[v + 1] = 0; T.al[v + 2] = 0; T.al[v + 3] = 0; T.al[v + 4] = 0;
        const r = M ? M[0] : 1, gg = M ? M[1] : 1, b = M ? M[2] : 1;
        for (let q = 0; q < 5; q++) { T.ti[(v + q) * 3] = r; T.ti[(v + q) * 3 + 1] = gg; T.ti[(v + q) * 3 + 2] = b; }
      }
    }
    T.g.attributes.position.needsUpdate = true;
    T.g.attributes.a.needsUpdate = true;
    T.g.attributes.tint.needsUpdate = true;
  }

  // =====================================================================
  //  BUILD: one airframe; geometry and materials shared
  // =====================================================================
  function build(ctx) {
    const T = template();
    if (!T) return null;
    const THREE = window.THREE, M = mats(), G = T.G;
    const root = T.root.clone(true);
    root.name = "b52-stratofortress";
    // the skeleton of THIS airframe (clone's bones, the template's inverses)
    const bones = [];
    root.traverse(function (o) { if (o.isBone) bones.push(o); });
    bones.sort(function (a, b) { return order(a.name) - order(b.name); });
    function order(n) { const m = /bone-(L|R)?(\d)/.exec(n); if (!m) return 99; return m[1] === "L" ? 1 + +m[2] : m[1] === "R" ? 5 + +m[2] : 0; }
    const skel = new THREE.Skeleton(bones, T.boneInv);
    const I4 = new THREE.Matrix4();
    const skins = [];
    [[G.skinPaint, M.skinPaint], [G.skinVc, M.skinVc]].forEach(function (p) {
      if (!p[0]) return;
      const m = new THREE.SkinnedMesh(p[0], p[1]);
      m.name = "b52-airframe"; m.castShadow = true; m.receiveShadow = true;
      root.add(m); m.bind(skel, I4);
      skins.push(m);
    });
    const N = Object.create(null);
    root.traverse(function (o) { if (o.name && o.name.indexOf("b52-") === 0) N[o.name.slice(4)] = o; });
    const B = { L: [], R: [] };
    for (let i = 0; i < 4; i++) { B.L.push(N["bone-L" + i]); B.R.push(N["bone-R" + i]); }
    const fans = [], spoil = { L: [], R: [] }, flames = [], noz = [], trucks = [], gdoors = [];
    for (let i = 0; i < 16; i++) if (N["fan" + i]) fans.push(N["fan" + i]);
    for (let i = 0; i < 5; i++) { spoil.L.push(N["spoilerL" + i]); spoil.R.push(N["spoilerR" + i]); }
    ["L", "R"].forEach(function (s) { for (let i = 0; i < 2; i++) { noz.push(N["pod" + s + i]); const f = N["flame" + s + i]; flames.push(f ? f.children[0] : null); } });
    for (let i = 0; i < 4; i++) { trucks.push(N["truck" + i]); gdoors.push(N["gdoor" + i]); }
    const lampMeshes = [];
    root.traverse(function (o) { if (o.isMesh && o.material === M.lamp) lampMeshes.push(o); });

    // ---- the stores: the bay's Mk-82s, the HSABs' JDAMs ---------------------------
    const MU = CBZ.munitions;
    function storeGeo(t) {
      if (MU && MU.geometry) { try { const g = MU.geometry(t); if (g) return g; } catch (e) {} }
      return null;
    }
    const sMat = MU && MU.material ? MU.material() : M.vc;
    const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(1, 1, 1), _v = new THREE.Vector3();
    let bayInst = null, jd = { L: null, R: null };
    const gMk = storeGeo("mk82"), gJd = storeGeo("jdam");
    if (gMk) {
      bayInst = new THREE.InstancedMesh(gMk, sMat, BAYSLOT.length);
      for (let k = 0; k < BAYSLOT.length; k++) {
        const p = BAYSLOT[k];
        bayInst.setMatrixAt(BAYSLOT.length - 1 - k, _m.compose(_v.set(p[0], p[1], p[2]), _q.identity(), _s));
      }
      bayInst.frustumCulled = false; bayInst.castShadow = false; bayInst.name = "b52-bay-stores";
      root.add(bayInst);
    }
    if (gJd) {
      ["L", "R"].forEach(function (s) {
        const hs = N["hsab" + s];
        if (!hs) return;
        const im = new THREE.InstancedMesh(gJd, sMat, HSAB.length);
        for (let k = 0; k < HSAB.length; k++) {
          const p = HSAB[k];
          im.setMatrixAt(HSAB.length - 1 - k, _m.compose(_v.set(p[0], p[1], p[2]), _q.identity(), _s));
        }
        im.frustumCulled = false; im.castShadow = true; im.name = "b52-hsab-stores";
        hs.add(im); jd[s] = im;
      });
    }

    // ---- flags on the fin and the forward fuselage; the fin band --------------------
    const flags = [];
    const fs = (function () {
      const h = 3.4, t = h / 7.15, c = 11.2 + (3.6 - 11.2) * t;
      return { y: 5.25 + h, z: -11.6 - h * 0.95 - 0.42 * c * 0.84, half: 0.5 * (0.10 + (0.08 - 0.10) * t) * c * 0.84 + 0.035 };
    })();
    [1, -1].forEach(function (s) {
      const f = new THREE.Mesh(G.flag, M.vc);
      f.position.set(s * fs.half, fs.y, fs.z); f.rotation.y = s * PI / 2;
      if (s < 0) f.scale.x = -1;
      f.visible = false; f.castShadow = false; N["bone-0"].add(f); flags.push(f);
      const g2 = new THREE.Mesh(G.flagS, M.vc);
      g2.position.set(s * 1.53, 3.6, 14.6); g2.rotation.y = s * PI / 2;
      if (s < 0) g2.scale.x = -1;
      g2.visible = false; g2.castShadow = false; N["bone-0"].add(g2); flags.push(g2);
    });
    const band = new THREE.Mesh(G.band, bandMat(ctx && ctx.color != null ? ctx.color : 0x8a1c1c));
    band.castShadow = true; band.name = "b52-fin-band"; N["bone-0"].add(band);

    const trails = THREE && CBZ.scene ? makeTrails(4) : null;
    const seed = (ctx && ctx.seed) || 0;
    const R = {
      group: root, N: N, B: B, skins: skins, fans: fans, spoil: spoil, flames: flames, noz: noz, trucks: trucks, gdoors: gdoors,
      lampMeshes: lampMeshes, bay: bayInst, jd: jd, flags: flags, band: band, trails: trails,
      clock: 0, seeded: false, px: 0, py: 0, pz: 0, h0: 0, roll0: 0, g0: 0,
      flex: 0, flexV: 0, droop: 1, gearUp: 0, door: 0, fanA: seed * 0.7, thr: 0.85, spL: 0, spR: 0, elev: 0, rud: 0,
      burnPod: [false, false, false, false], podOut: [false, false, false, false], smokeT: 0, beacon: seed * 0.37,
      dead: false, crashed: false, burnt: false, veh: null, tgt: null, phase: "", lastPush: -9, jdamOn: [], jdamN: 0,
      heads: new Float32Array(12), modes: new Uint8Array(4), ammo: [27, 12],
      _v: new THREE.Vector3(), _w: new THREE.Vector3(),
    };
    const rig = {
      turret: null,
      settle: function () { R.seeded = false; tick(R, true, 0, null); },
      muzzleWorld: function (out, shot) { return storePoint(R, out, shot); },
      fire: function (shot) { fire(R, shot); },
      canFire: function (shot) { return canFire(R, shot); },
      damage: function (vs, res) { damage(R, vs, res); },
      store: function (shot) { return storeMesh(R, shot); },
      mark: function (nation, ground, side) {
        rig.setNation(nation || (side && side.flagId), side && side.flag);
        if (side && side.color != null) band.material = bandMat(side.color);
      },
      setNation: function (id, design) {
        const m = id || design ? flagMat(String(id || "flag"), design) : null;
        for (let i = 0; i < flags.length; i++) { flags[i].material = m || M.vc; flags[i].visible = !!m; }
        return !!m;
      },
      state: R,
    };
    R.rig = rig;
    root.userData.rig = rig;
    root.userData.aircraftDims = { family: "B-52H", length: DIM.length, span: DIM.span, height: DIM.height, bodyW: DIM.bodyW, bodyL: DIM.length };
    root.userData.crewSeats = [
      { job: "Pilot", x: 0.62, y: 4.15, z: 19.25, yaw: 0 }, { job: "Copilot", x: -0.62, y: 4.15, z: 19.25, yaw: 0 },
      { job: "Electronic Warfare Officer", x: 0.5, y: 4.15, z: 17.4, yaw: PI },
      { job: "Radar Navigator", x: 0.5, y: 2.2, z: 18.7, yaw: 0 }, { job: "Navigator", x: -0.5, y: 2.2, z: 18.7, yaw: 0 },
    ];
    if (ctx && (ctx.nation || ctx.flag)) rig.setNation(ctx.nation || ctx.flagId, ctx.flag);
    tick(R, true, 0, null);
    return { group: root, rig: rig, footW: DIM.span, footL: DIM.length, height: DIM.height };
  }

  // ---- the stores' points, release, the falling bomb ------------------------------
  function isBay(shot) { return !shot || shot.wid !== "gbu31_jdam"; }
  function storePoint(R, out, shot) {
    const THREE = window.THREE;
    out = out || new THREE.Vector3();
    const n = shot ? (shot.n | 0) : 0;
    let r = R.group; while (r.parent) r = r.parent;
    r.updateMatrixWorld(true);
    if (isBay(shot)) {
      const p = BAYSLOT[Math.min(BAYSLOT.length - 1, n % BAYSLOT.length)];
      return R.group.localToWorld(out.set(p[0], p[1] - 0.3, p[2]));
    }
    // JDAMs alternate port / starboard so the wings stay balanced
    const side = (n & 1) ? "R" : "L", k = Math.min(HSAB.length - 1, n >> 1);
    const hs = R.N["hsab" + side], p = HSAB[k];
    if (!hs) return R.group.localToWorld(out.set(0, BELLY - 0.5, 0));
    return hs.localToWorld(out.set(p[0], p[1] - 0.3, p[2]));
  }
  function storeMesh(R, shot) {
    const MU = CBZ.munitions;
    if (!MU || !MU.acquire || !CBZ.scene) return null;
    let o = null;
    try { o = MU.acquire(isBay(shot) ? "mk82" : "jdam"); } catch (e) { o = null; }
    if (!o) return null;
    storePoint(R, o.position, shot);
    o.rotation.y = R.group.rotation.y;
    CBZ.scene.add(o);
    return o;
  }
  function fire(R, shot) {
    if (!isBay(shot) && shot && shot.target) {
      // one JDAM per aim point: hold the next until this one has landed
      R.jdamOn[R.jdamN++ % 4] = { t: shot.target, until: R.clock + FALL + 3 };
    }
    stores(R);
  }
  function canFire(R, shot) {
    if (R.dead) return false;
    if (isBay(shot)) return R.door > 0.92;
    const t = shot && shot.target || R.tgt;
    if (!t) return true;
    for (let i = 0; i < R.jdamOn.length; i++) { const j = R.jdamOn[i]; if (j && j.t === t && j.until > R.clock) return false; }
    return true;
  }
  function damage(R, vs, res) {
    if (!res || !res.pen) return;
    // an interceptor's fragments go through a nacelle or the wing tanks
    if (res.burning || vs.burning || res.dmg > 400) {
      const i = Math.floor(Math.random() * 4);
      R.burnPod[i] = true;
      if (res.dmg > 900) R.podOut[i] = true;
    }
    if (res.firepower) R.podOut[Math.floor(Math.random() * 4)] = true;
  }
  // the stores drawn are the stores left
  function stores(R) {
    const veh = R.veh, W = veh && veh.wpn;
    if (W) for (let k = 0; k < W.length && k < 2; k++) R.ammo[W[k].w.id === "gbu31_jdam" ? 1 : 0] = Math.max(0, W[k].ammo | 0);
    if (R.bay) R.bay.count = R.dead ? 0 : Math.min(BAYSLOT.length, R.ammo[0]);
    const gone = 12 - Math.min(12, R.ammo[1]);
    if (R.jd.L) R.jd.L.count = R.dead ? 0 : Math.max(0, 6 - Math.ceil(gone / 2));
    if (R.jd.R) R.jd.R.count = R.dead ? 0 : Math.max(0, 6 - Math.floor(gone / 2));
  }

  // ---- the rig: every moving part, once per animate (the battle clock) ---------------
  function tick(R, snap, dt, ctx) {
    if (!(dt > 0)) dt = 0;
    if (dt > 0.25) dt = 0.25;
    R.clock += dt;
    const g = R.group, veh = R.veh;
    if (ctx && ctx.dead) R.dead = true;
    const dead = R.dead;
    const px = g.position.x, py = g.position.y, pz = g.position.z, h = g.rotation.y, roll = -g.rotation.z, gam = -g.rotation.x;
    if (!R.seeded || snap) { R.px = px; R.py = py; R.pz = pz; R.h0 = h; R.roll0 = roll; R.g0 = gam; R.seeded = true; }
    let spd = 0, rollRate = 0, pitchRate = 0, yawRate = 0;
    if (dt > 0) {
      spd = ctx && isFinite(ctx.speed) ? Math.abs(ctx.speed) : Math.hypot(px - R.px, pz - R.pz) / dt;
      rollRate = wrap(roll - R.roll0) / dt; pitchRate = (gam - R.g0) / dt; yawRate = wrap(h - R.h0) / dt;
    } else if (ctx && isFinite(ctx.speed)) spd = Math.abs(ctx.speed);
    R.px = px; R.py = py; R.pz = pz; R.h0 = h; R.roll0 = roll; R.g0 = gam;
    let agl;
    if (ctx && isFinite(ctx.agl)) agl = ctx.agl;
    else { let gy0 = 0; try { gy0 = CBZ.floorAt ? (+CBZ.floorAt(px, pz) || 0) : 0; } catch (e) { gy0 = 0; } agl = py - gy0; }
    const air = agl > 3 && !R.crashed;
    R.tgt = ctx && ctx.target || null;
    R.phase = ctx && ctx.phase || "";
    const N = R.N;

    // ---- the wings: droop on the ground, flex with the load in the air -----------------
    // the load factor: the bank holds the turn, the pull adds to it
    const n = air ? clamp(1 / Math.max(0.35, Math.cos(roll)) + spd * pitchRate / 9.81, -0.5, 3) : 1;
    // turbulence at height: a slow ring in the wing
    const turb = air && !dead ? 0.06 * Math.sin(R.clock * 1.7 + R.fanA) * Math.sin(R.clock * 0.43) : 0;
    const flexT = air ? (n - 1) + turb : 0;
    const droopT = air ? 0 : 1;
    if (snap) { R.flex = flexT; R.flexV = 0; R.droop = droopT; }
    else {
      // a 1.2 Hz wing, lightly damped (sub-stepped: a far hull is animated on a long dt)
      const w0 = TAU * 1.2, ns = Math.ceil(dt / 0.02), h1 = dt / ns;
      for (let q = 0; q < ns; q++) {
        const acc = w0 * w0 * (flexT - R.flex) - 2 * 0.18 * w0 * R.flexV;
        R.flexV += acc * h1; R.flex += R.flexV * h1;
      }
      R.droop += (droopT - R.droop) * Math.min(1, dt * 1.5);
    }
    let broke = R.crashed ? 1 : 0;
    for (let i = 0; i < 4; i++) {
      let a = DROOP[i] * R.droop + BEND[i] * R.flex;
      if (broke) a += i === 2 ? 0.55 : i === 1 ? 0.12 : 0;      // a wreck's wings break at the outboard pods
      R.B.L[i].rotation.z = -a;
      R.B.R[i].rotation.z = a * (broke && i === 2 ? 0.7 : 1);
    }

    // ---- the gear: down for the ground and approach, up in the fight ----------------------
    const gearDown = !air || (agl < 60 && spd < 110);
    const gT = gearDown ? 0 : 1;
    R.gearUp = snap ? gT : clamp(R.gearUp + Math.sign(gT - R.gearUp) * dt / 8, 0, 1);
    const gu = R.gearUp, fold = gu < 0.6 ? gu / 0.6 : 1, shut = gu < 0.6 ? 0 : (gu - 0.6) / 0.4;
    for (let i = 0; i < 4; i++) {
      const t = R.trucks[i]; if (!t) continue;
      t.rotation.x = -fold * 1.45; t.visible = gu < 0.98 && !R.crashed;
      // the truck door hangs open while the gear is out, swings shut under the belly after it
      const d = R.gdoors[i]; if (!d) continue;
      d.rotation.x = shut * 1.52; d.visible = shut < 0.98;
    }
    ["L", "R"].forEach(function (s) {
      const o = N["outrig" + s]; if (!o) return;
      o.rotation.x = fold * 1.5; o.visible = gu < 0.98 && !R.crashed;
    });

    // ---- the controls: spoilers (roll), speed brakes, elevators, rudder -------------------
    const vy = ctx && isFinite(ctx.vy) ? ctx.vy : 0;
    const brake = air && vy < -25 && !dead ? 0.35 : 0;
    const rl = air && !dead ? clamp(rollRate * 2.2 + roll * 0.25, -1, 1) : 0;
    // roll right (starboard down): the starboard spoilers come up
    const spLT = Math.max(brake, rl < 0 ? -rl * 0.95 : 0), spRT = Math.max(brake, rl > 0 ? rl * 0.95 : 0);
    const kS = snap ? 1 : Math.min(1, dt * 5);
    R.spL += (spLT - R.spL) * kS; R.spR += (spRT - R.spR) * kS;
    for (let i = 0; i < 5; i++) {
      if (R.spoil.L[i]) R.spoil.L[i].rotation.x = R.spL * 0.9;
      if (R.spoil.R[i]) R.spoil.R[i].rotation.x = R.spR * 0.9;
    }
    const evT = air && !dead ? clamp(pitchRate * 6, -0.3, 0.3) : 0;
    R.elev += (evT - R.elev) * kS;
    if (N.elevL) N.elevL.rotation.x = R.elev;
    if (N.elevR) N.elevR.rotation.x = R.elev;
    const rdT = air && !dead ? clamp(yawRate * 4, -0.25, 0.25) : 0;
    R.rud += (rdT - R.rud) * kS;
    if (N.rudder) N.rudder.rotation.x = R.rud;

    // ---- engines: fans spin with the throttle ---------------------------------------------
    const thrT = dead ? 0 : !air ? 0.08 : clamp(0.82 + vy * 0.015 + (n - 1) * 0.15, 0.35, 1);
    R.thr += (thrT - R.thr) * Math.min(1, dt * 0.8);
    R.fanA = (R.fanA + dt * (8 + 70 * R.thr)) % TAU;
    for (let i = 0; i < R.fans.length; i++) {
      const out = R.podOut[i >> 1];
      R.fans[i].rotation.z = out ? R.fanA * 0.05 + i : R.fanA + i * 0.37;
    }

    // ---- the bomb bay: open on the run-in, shut after the stick ---------------------------
    stores(R);
    let bayWant = false;
    const t = R.tgt;
    if (!dead && air && R.ammo[0] > 0 && t && t.pos) {
      if (veh && veh.you) bayWant = true;
      else if (R.phase !== "out") {
        const vh = spd * Math.cos(gam), tgy = t.pos.y || 0;
        const tf = Math.sqrt(2 * Math.max(10, py - tgy) / 9.81), lead = vh * tf;
        const fx = Math.sin(h), fz = Math.cos(h);
        const ix = px + fx * lead, iz = pz + fz * lead;
        const ax = t.pos.x - ix, az = t.pos.z - iz;
        const along = ax * fx + az * fz, cross = Math.abs(ax * fz - az * fx);
        bayWant = along < WEAPONS[0].stick / 2 + vh * 4.5 && along > -WEAPONS[0].stick / 2 - vh * 2 && cross < 400;
      }
    }
    if (R.crashed) bayWant = false;
    const dT = bayWant ? 1 : 0;
    R.door = snap ? dT : clamp(R.door + Math.sign(dT - R.door) * dt / 2.2, 0, 1);
    const de = R.door * R.door * (3 - 2 * R.door);
    if (N.doorL) N.doorL.rotation.x = -de * 1.6;
    if (N.doorR) N.doorR.rotation.x = de * 1.6;

    // ---- lights: beacons flash, all dark on a wreck ---------------------------------------
    R.beacon += dt;
    const on = !dead && (R.beacon % 1.1) < 0.12;
    if (N.beaconT) N.beaconT.visible = on;
    if (N.beaconB) N.beaconB.visible = !dead && ((R.beacon + 0.55) % 1.1) < 0.12;
    if (dead && !R.lampsOff) { R.lampsOff = true; for (let i = 0; i < R.lampMeshes.length; i++) R.lampMeshes[i].visible = false; }

    // ---- fire: a burning pod flames; the wreck burns on the ground --------------------------
    if (dead) for (let i = 0; i < 4; i++) if (!R.burnPod[i] && Math.random() < dt * 0.6) R.burnPod[i] = true;
    for (let i = 0; i < 4; i++) {
      const f = R.flames[i]; if (!f) continue;
      f.visible = R.burnPod[i] && !R.crashed;
      if (f.visible) { const k = 0.8 + 0.3 * Math.sin(R.clock * 23 + i * 2.1); f.scale.set(k, 0.8 + 0.4 * Math.sin(R.clock * 17 + i), k); }
    }
    if (R.crashed && !R.burnt) {
      R.burnt = true;
      const M = mats();
      for (let i = 0; i < R.skins.length; i++) R.skins[i].material = R.skins[i].material === M.skinPaint ? M.skinBurnt : M.skinVc;
      R.group.traverse(function (o) { if (o.isMesh && o.material === M.paint) o.material = M.burnt; });
      if (R.bay) R.bay.count = 0; if (R.jd.L) R.jd.L.count = 0; if (R.jd.R) R.jd.R.count = 0;
    }
    if (dt > 0 && dead && CBZ.cityCrashSmoke) {
      R.smokeT -= dt;
      if (R.smokeT <= 0) {
        R.smokeT = R.crashed ? 0.5 : 0.25;
        try {
          const i = Math.floor(Math.random() * 4), p = R.noz[i];
          if (p) { p.getWorldPosition(R._v); CBZ.cityCrashSmoke(R._v.x, R.crashed ? Math.max(R._v.y, py + 1) : R._v.y, R._v.z, { count: R.crashed ? 2 : 1, scale: 1.6, shade: 0.2, flame: true }); }
        } catch (e) {}
      }
    }
    if (!R.crashed && dead && !air) R.crashed = true;

    // ---- trails: contrails at height, TF33 smoke lower, black smoke from a fire -----------------
    const T = R.trails;
    if (T && dt > 0) {
      if (!T.added && CBZ.scene) {
        CBZ.scene.add(T.mesh); T.added = true;
        T.mesh.onBeforeRender = function () { if (Date.now() - T.wall > 1500) T.mesh.visible = false; };
      }
      T.wall = Date.now();
      const show = g.visible !== false && air;
      T.mesh.visible = show || T.mesh.visible && !R.crashed;
      if (show || dead) {
        const contrail = py > 7000;
        for (let i = 0; i < 4; i++) {
          const p = R.noz[i];
          if (p) { p.getWorldPosition(R._v); R.heads[i * 3] = R._v.x; R.heads[i * 3 + 1] = R._v.y; R.heads[i * 3 + 2] = R._v.z; }
          R.modes[i] = R.crashed ? 0 : R.burnPod[i] ? 3 : (dead || R.podOut[i]) ? 0 : contrail ? 1 : R.thr > 0.6 ? 2 : 0;
        }
        const push = R.clock - R.lastPush >= TREVERY;
        if (push) R.lastPush = R.clock;
        trailsStep(T, R.clock, R.heads, R.modes, push);
      }
    }
  }

  // the weapon a player's attack works: the JDAM at armour, the stick at anything else
  function moves(veh, tgt) {
    if (!veh || !tgt) return null;
    const W = veh.wpn || [];
    let mk = 0, jd = 0;
    for (let i = 0; i < W.length; i++) { if (W[i].w.id === "mk82_stick") mk = W[i].ammo; if (W[i].w.id === "gbu31_jdam") jd = W[i].ammo; }
    const armour = tgt.vehicle && tgt.def && tgt.def.stats && tgt.def.stats.armour && (tgt.def.stats.armour.side || 0) > 30;
    if (armour) return jd > 0 ? "gbu31_jdam" : null;
    return mk > 0 ? "mk82_stick" : jd > 0 ? "gbu31_jdam" : null;
  }

  CBZ.unitKit.register("b52", {
    kind: "vehicle",
    domain: "air",
    drive: "jet",
    /* B-52H: 48.5 x 56.4 x 12.4 m; ~175 t at combat weight (219.6 t max);
       M 0.77 at 30,000 ft (230 m/s true). It turns on a 46 deg bank (1.45 g):
       a 5 km turn radius, so a pass is a racetrack ~16 km long. It is not
       armoured (2-3 mm of aluminium skin) and nothing on the ground but a
       SAM reaches it. stats.ingress: it starts its run from beyond the
       horizon, the release distance (speed x fall time) plus a lining-up leg. */
    stats: { hp: 1800, mass: 175000, speed: SPD, accel: 2, turn: 0.045, alt: ALT,
      length: DIM.length, width: DIM.span, height: DIM.height,
      armour: { front: 3, side: 2, rear: 2, top: 2 }, standoff: 0,
      ingress: Math.round(SPD * FALL + 2600) },
    // five crew on two decks: pilots and the EWO up top (the EWO facing aft),
    // the radar navigator (the bombardier) and the navigator below
    crew: [
      { seat: "pilot", pos: [0.62, 4.6, 19.25] }, { seat: "copilot", pos: [-0.62, 4.6, 19.25] },
      { seat: "radar", pos: [0.5, 2.6, 18.7] }, { seat: "navigator", pos: [-0.5, 2.6, 18.7] },
      { seat: "ewo", pos: [0.5, 4.6, 17.4] },
    ],
    passengers: 0,
    weapons: WEAPONS,
    tactics: {
      role: "strategic bomber",
      profile: "level, 9,100 m; one straight run from beyond the horizon, release where the 43 s fall lands on the mark",
      engage: { bombs: Math.round(SPD * FALL) },
      priorities: ["massed men", "soft", "armour (JDAM, one per aim point)"],
      stick: "27 x Mk-82 walked across the mark, ~30 m apart",
      hullDown: false, faceThreat: false, screen: null,
      breakaway: "46 deg bank, out past the mark, round again only with bombs left",
    },
    build: build,
    animate: function (veh, dt, ctx) {
      const r = veh && veh.rig;
      if (r && r.state) { r.state.veh = veh; tick(r.state, false, dt, ctx); }
    },
    moves: moves,
  });
})();
