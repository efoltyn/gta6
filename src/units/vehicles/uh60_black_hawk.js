/* ============================================================
   units/vehicles/uh60_black_hawk.js — UH-60M Black Hawk utility helicopter.

   Redrawn from scratch for NPC War (wave B). Before this file drew its own
   airframe the Black Hawk was city/mil_air.js's generic utilityHeli: a
   round tube with one door gun stuck to the starboard window, a rotor that
   never turned in the battle, and its eleven troops popping out of thin air
   on the ground under it while it flew past at 30 m/s.

   THE AIRFRAME (real metres, nose +Z, port +X, wheels on y = 0, the main
   rotor mast on z = 0). UH-60A/L/M figures: main rotor 16.36 m (4 blades,
   0.53 m chord, -18 deg twist, 20 deg swept tips, 258 rpm, counter-clockwise
   seen from above), tail rotor 3.35 m on the STARBOARD side of the pylon,
   canted 20 deg (top toward port) so it lifts as well as it pushes (4
   blades as two crossed flexbeams, 1190 rpm), 19.76 m long with the rotors
   turning, 15.26 m fuselage, 2.36 m wide, 5.13 m tall over the tail rotor,
   main wheel track 2.71 m, wheelbase 8.83 m, stabilator 4.38 m (all-moving:
   42 deg trailing edge down in the hover to 10 deg up at cruise). A flat-
   sided cabin 3.84 x 2.21 x 1.37 m inside, sliding cabin doors 1.75 m wide,
   the crew-chief and gunner windows just aft of the cockpit doors with an
   M240H on each, two T700 engines on the roof either side of the main
   gearbox with their HIRSS exhaust suppressors turned outboard, the
   ALQ-144 jammer behind the mast, wire-strike cutters, pitot tubes, chaff
   dispensers, blade antennas, nav / anti-collision / formation lights, the
   bifilar vibration absorber on the rotor head, the FRIES bars over the
   doors for the fast rope.

   THE LOOK. The skin is ONE lofted superellipse hull (the cabin is the same
   section along its length, so the doors slide on it) with the glazing,
   the gunner windows and the door openings cut out of it; an inner liner,
   a floor, troop seats, an instrument panel and the crew are inside. Paint
   is a per-scheme material (Army green, desert tan, grey) chosen by
   rig.mark for the ground, with sun fade, belly grime, panel tone and
   HIRSS soot baked per vertex; the nation's flag goes on both faces of the
   tail pylon. Every geometry is built once per page and shared.

   THE RIG (all on the battle clock, animate -> tick):
     main rotor   spins; each blade droops at rest, cones in flight, the disc
                  tilts into the flight (cyclic); a blur disc at speed
     tail rotor   spins in its canted carrier
     airframe     banks into turns, flares when it brakes, a hover wander;
                  the stabilator follows the airspeed schedule
     door guns    two M240H on pintles, each with its own sector (port gun
                  across the nose to well aft on the left, starboard the
                  same on the right), laid on the mark at a gunner's rate,
                  recoil and brass; the gunner turns with his gun
     insertion    the cabin doors slide open, the FRIES bars swing out, the
                  ropes drop and the troops come down them two ropes at a
                  time at the same cadence the battle puts them on the
                  ground (stats.fastRope / ropeDelay / ropeEvery / ropeSpeed)
     damage       smoke from a hit engine, flame when burning; a wreck's
                  rotor winds down, and on the ground three blades snap and
                  the tail breaks at the boom joint
     rotor wash   dust (sand, snow, earth, spray) under it below 30 m

   WEAPONS & ARMOUR. Two M240H 7.62 mm door guns (650-950 rounds/min, 1,100 m
   area fire), worked by the crew chief (port) and the door gunner
   (starboard). rig.canFire holds a gun whose sector does not hold the mark
   or which is still swinging onto it. The Black Hawk is not armoured: rifle
   rounds go through the skin (and can kill whoever sits behind it), but the
   airframe was built to take 7.62 / 12.7 mm hits in its systems and keep
   flying, so it takes many; an RPG or a cannon is what brings it down.

   TACTICS (def.tactics + the stats the rotor doctrine reads): it carries
   eleven troops low and fast to a landing zone short of the enemy, hovers
   at 12 m and fast-ropes them in, then works the area with its door guns,
   turning its side to the mark (stats.broadside) so a door bears.

   moves(veh, tgt, ctx): the door gun on the mark's side, for a player who
   has taken the aircraft over (the AI flies, you work the guns).

   Units: metres, m/s, kg; armour in mm RHA equivalent per face.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.unitKit) return;

  const PI = Math.PI, TAU = PI * 2, DEG = PI / 180;
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function wrap(a) { while (a > PI) a -= TAU; while (a < -PI) a += TAU; return a; }

  // ---- the real numbers -----------------------------------------------------
  const DIM = {
    rotorR: 8.18, hubY: 3.80, omega: 258 * TAU / 60,
    tailR: 1.675, tail: [-0.44, 3.55, -9.95], cant: 20 * DEG, omegaTail: 1190 * TAU / 60,
    length: 19.76, fuselage: 15.26, width: 2.36, height: 5.13, cgY: 1.55,
    tailBreak: -7.40,
  };
  // the fast rope: hover height, ropes out, one man per rope every `every` s
  const ROPE = { agl: 12, delay: 1.6, every: 0.9, speed: 6 };
  // the two door guns: pintle in the window, sector in hull yaw (0 = nose, + = port)
  const GUNS = [
    { id: "m240h_port", s: 1, seat: "crewchief", pos: [1.13, 1.56, 1.62], lo: -0.05, hi: 2.75 },
    { id: "m240h_stbd", s: -1, seat: "gunner", pos: [-1.13, 1.56, 1.62], lo: -2.75, hi: 0.05 },
  ];
  const GUN_UP = -0.35, GUN_DOWN = 1.25, GUN_YAW_RATE = 3.2, GUN_PITCH_RATE = 2.4;

  /* M240H: 7.62 x 51 mm, ~750 rounds/min cyclic, fired in bursts of 8-12;
     1,100 m for area fire. The flown round is ballistics.js's 7.62 NATO
     (an unknown mount id falls back to the m240_coax cartridge). */
  const WEAPONS = GUNS.map(function (g) {
    return { id: g.id, seat: g.seat, kind: "mg", wid: "lmg", mount: "free", yawLo: g.lo, yawHi: g.hi, rof: 12.5, burst: 10, pause: 1.1,
      dmg: 25, pen: 9, range: 1100, ammo: 1500 };
  });

  // =====================================================================
  //  THE TEMPLATE: every geometry built once per page
  // =====================================================================
  const RGB = function (hex) { return [(hex >> 16 & 255) / 255, (hex >> 8 & 255) / 255, (hex & 255) / 255]; };
  const C = {
    seam: 0x1d201a, gunmetal: 0x2a2c2d, black: 0x0c0d0e, rubber: 0x161718, steel: 0x55595c,
    interior: 0x3a3f37, floor: 0x1f2120, panel: 0x18191a, screen: 0x1b2a2e, canvas: 0x5d5a45,
    blade: 0x26292b, edge: 0x7a7e80, tipCap: 0x8a8d8e,
    suit: 0x5c6150, vest: 0x4b4d3c, helmet: 0x494d3d, visor: 0x101213, skin: 0xa77f63, glove: 0x2a2924,
    boot: 0x4a3f30, uniform: 0x6c6a52, kit: 0x575540, rifle: 0x1c1d1e, rope: 0x2b2a26, pack: 0x5a5641,
  };
  // the paint schemes rig.mark picks from (lit by Lambert)
  const SCHEME = { green: 0x363c2e, tan: 0x8e7b5a, grey: 0x5f6568 };
  // nodes: name -> [parent, model-space origin in the rest pose]
  const NODES = {
    body: [null, [0, 0, 0]],
    rotor: ["body", [0, DIM.hubY, 0]],
    tailSec: ["body", [0, 1.95, DIM.tailBreak]],
    tailCant: ["tailSec", DIM.tail],
    tailSpin: ["tailCant", DIM.tail],
    stab: ["tailSec", [0, 1.98, -9.20]],
    doorL: ["body", [1.20, 1.40, 0.10]], doorR: ["body", [-1.20, 1.40, 0.10]],
    friesL: ["body", [1.02, 2.30, 0.10]], friesR: ["body", [-1.02, 2.30, 0.10]],
    gunLYaw: ["body", GUNS[0].pos], gunLPitch: ["gunLYaw", GUNS[0].pos], gunLKick: ["gunLPitch", GUNS[0].pos],
    gunRYaw: ["body", GUNS[1].pos], gunRPitch: ["gunRYaw", GUNS[1].pos], gunRKick: ["gunRPitch", GUNS[1].pos],
    gunnerL: ["body", [0.62, 0.80, 1.55]], gunnerR: ["body", [-0.62, 0.80, 1.55]],
  };

  // ---- the hull: one smooth loft of superellipse sections ----------------------
  // [z, half width, top y, bottom y, top exponent, bottom exponent]
  const FUS = [
    [5.36, 0.05, 1.21, 1.11, 2.0, 2.0],
    [5.30, 0.30, 1.40, 0.97, 2.2, 2.2],
    [5.14, 0.56, 1.56, 0.85, 2.4, 2.6],
    [4.88, 0.80, 1.69, 0.73, 2.7, 3.2],
    [4.55, 1.00, 1.81, 0.63, 3.0, 4.0],
    [4.15, 1.10, 1.99, 0.57, 3.0, 4.5],
    [3.70, 1.15, 2.17, 0.55, 3.1, 5.0],
    [3.30, 1.17, 2.24, 0.55, 3.2, 5.0],
    [2.40, 1.18, 2.25, 0.55, 3.3, 5.0],
    [1.95, 1.18, 2.25, 0.55, 3.4, 5.0],
    [-1.95, 1.18, 2.25, 0.55, 3.4, 5.0],
    [-2.40, 1.12, 2.24, 0.62, 3.2, 4.5],
    [-2.90, 0.98, 2.22, 0.82, 3.0, 3.6],
    [-3.40, 0.80, 2.20, 1.08, 2.7, 3.0],
    [-3.90, 0.62, 2.16, 1.30, 2.4, 2.4],
    [-4.60, 0.48, 2.13, 1.42, 2.2, 2.2],
    [-5.80, 0.40, 2.11, 1.52, 2.1, 2.1],
    [-7.00, 0.34, 2.11, 1.60, 2.05, 2.05],
    [-7.80, 0.30, 2.13, 1.66, 2.0, 2.0],
    [-8.80, 0.26, 2.19, 1.74, 2.0, 2.0],
    [-9.60, 0.20, 2.23, 1.82, 2.0, 2.0],
    [-10.05, 0.05, 2.22, 1.90, 2.0, 2.0],
  ];
  const SZ = FUS.map(function (r) { return -r[0]; });       // s = -z, increasing
  // monotone cubic slopes per column (no overshoot: flat stays flat)
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
  // a point on the hull: z, angle th (0 = port, PI/2 = top), offset along the section's normal-ish
  function surf(z, th, off, out) {
    const S = station(z), c = Math.cos(th), sn = Math.sin(th), e = sn >= 0 ? S.p : S.pb;
    const cy = (S.yt + S.yb) / 2, hh = (S.yt - S.yb) / 2;
    const ex = 2 / e;
    let x = (S.w + off) * Math.sign(c) * Math.pow(Math.abs(c), ex);
    let y = cy + (hh + off) * Math.sign(sn) * Math.pow(Math.abs(sn), ex);
    out[0] = x; out[1] = y; out[2] = z;
    return out;
  }

  /* WHERE EACH PIECE OF SKIN GOES. (x, y, z) is the centre of a quad of the
     hull; the answer is [node, bucket] or null (cut out: an opening). */
  function zoneOf(x, y, z) {
    const ax = Math.abs(x);
    const node = z < DIM.tailBreak ? "tailSec" : "body";
    // windscreen (two panes and the centre post), overhead windows, cockpit doors, chin windows
    if (z > 3.68 && z < 4.52 && y > 1.66 && ax > 0.045) return ["body", "glass"];
    if (z > 2.92 && z < 3.55 && y > 2.13 && ax > 0.14 && ax < 0.82) return ["body", "glass"];
    if (z > 2.32 && z < 3.50 && y > 1.36 && y < 2.07 && ax > 0.85) return ["body", "glass"];
    if (z > 4.02 && z < 4.92 && y > 0.74 && y < 1.36 && ax > 0.32) return ["body", "glass"];
    // the gunner windows: open, the guns are in them
    if (z > 1.28 && z < 1.96 && y > 1.30 && y < 2.02 && ax > 0.85) return null;
    // the cabin door openings (the doors are their own nodes)
    if (z > -0.76 && z < 0.97 && y > 0.70 && y < 2.10 && ax > 0.85) return null;
    // the seal round the door opening and the gunner window
    if (z > -0.84 && z < 1.05 && y > 0.64 && y < 2.16 && ax > 0.85) return ["body", "seam"];
    if (z > 1.22 && z < 2.02 && y > 1.24 && y < 2.08 && ax > 0.85) return ["body", "seam"];
    return [node, "paint"];
  }
  function doorZone(x, y, z) {
    if (!(z > -0.76 && z < 0.97 && y > 0.70 && y < 2.10 && Math.abs(x) > 0.85)) return null;
    if (z > -0.40 && z < 0.62 && y > 1.42 && y < 1.96) return "glass";
    return "paint";
  }

  let TPL = null;
  function template() {
    if (TPL) return TPL;
    const THREE = window.THREE, K = CBZ.milAir && CBZ.milAir.kit;
    if (!THREE || !K || !K.wing || !K.rod) return null;
    const BK = Object.create(null);

    // ---- colour ------------------------------------------------------------
    // the paint is a greyscale multiplier on the scheme's material colour
    function weather(x, y, z, ny) {
      let k = 1 + 0.08 * Math.max(0, ny) - 0.12 * Math.max(0, -ny);              // sun-faded tops, grimy belly
      k *= 1 + 0.035 * Math.sin(x * 2.9 + z * 1.6) * Math.sin(y * 4.1 - z * 2.3);  // re-sprayed panels
      // HIRSS soot: the outlets throw it outboard and aft over the boom
      if (z < -2.6 && y > 1.7) {
        const ax = Math.abs(x);
        const s = Math.exp(-((ax - 0.55) * (ax - 0.55)) / 0.18) * clamp((-2.6 - z) / 0.8, 0, 1) * clamp(1 - (-z - 3.2) / 4.5, 0, 1);
        k *= 1 - 0.38 * s;
      }
      // oil weeping off the gearbox down the cabin sides
      if (y > 1.6 && y < 2.3 && z > -1.5 && z < 0.6) k *= 1 - 0.06 * Math.exp(-((z + 0.4) * (z + 0.4)) / 0.2);
      if (y < 0.75) k *= 0.93;                                                     // belly dirt
      return k;
    }
    function colour(g, col) {
      const p = g.attributes.position, n = g.attributes.normal, N = p.count;
      const out = new Float32Array(N * 3);
      const paint = col === "paint" || (col && typeof col === "object" && col.paint != null);
      const fn = typeof col === "function" ? col : null;
      const base = paint || fn ? null : RGB(col);
      const tint = paint && typeof col === "object" ? col.paint : 1;
      for (let i = 0; i < N; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        let r, gg, b;
        if (fn) { const c = fn(x, y, z, n ? n.getY(i) : 0); r = c[0]; gg = c[1]; b = c[2]; }
        else if (paint) { r = gg = b = tint * weather(x, y, z, n ? n.getY(i) : 0); }
        else { r = base[0]; gg = base[1]; b = base[2]; }
        out[i * 3] = r; out[i * 3 + 1] = gg; out[i * 3 + 2] = b;
      }
      g.setAttribute("color", new THREE.BufferAttribute(out, 3));
    }
    // put a MODEL-space geometry into a node's bucket: paint | vc | glass | lamp
    function put(node, g, col, bucket) {
      if (!g) return;
      if (Array.isArray(g)) { for (let i = 0; i < g.length; i++) put(node, g[i], col, bucket); return; }
      if (!g.attributes.normal) g.computeVertexNormals();
      if (!bucket) bucket = col === "paint" || (col && typeof col === "object") ? "paint" : "vc";
      if (bucket !== "glass" && !(col == null && g.attributes.color)) colour(g, col);
      const o = NODES[node][1];
      if (o[0] || o[1] || o[2]) g.translate(-o[0], -o[1], -o[2]);
      const b = BK[node] || (BK[node] = { paint: [], vc: [], glass: [], lamp: [] });
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
    const xf = K.xf, mir = K.mir, box = K.box, rod = K.rod;
    function at(g, x, y, z, rx, ry, rz) { return xf(g, x, y, z, rx, ry, rz); }
    function cylY(r0, r1, h, seg) { return new THREE.CylinderGeometry(r1, r0, h, seg || 14); }
    function cylZ(r, h, seg) { return xf(new THREE.CylinderGeometry(r, r, h, seg || 12), 0, 0, 0, PI / 2); }
    function cylX(r, h, seg) { return xf(new THREE.CylinderGeometry(r, r, h, seg || 12), 0, 0, 0, 0, 0, PI / 2); }
    function sph(r, ws, hs) { return new THREE.SphereGeometry(r, ws || 12, hs || 8); }
    // a superellipse loft for the small parts: [{z, x, y, w, t, b, p}] front first
    function sloft(st, n, caps) {
      const pos = [], idx = [];
      n = n || 16;
      for (let i = 0; i < st.length; i++) {
        const s = st[i], p = s.p || 2;
        for (let j = 0; j < n; j++) {
          const th = j / n * TAU, c = Math.cos(th), sn = Math.sin(th), e = 2 / p;
          pos.push((s.x || 0) + s.w * Math.sign(c) * Math.pow(Math.abs(c), e),
            (s.y || 0) + (sn >= 0 ? s.t : s.b) * Math.sign(sn) * Math.pow(Math.abs(sn), e), s.z);
        }
      }
      for (let i = 0; i < st.length - 1; i++) for (let j = 0; j < n; j++) {
        const a = i * n + j, b = i * n + (j + 1) % n;
        idx.push(a, a + n, b, b, a + n, b + n);
      }
      if (caps !== false) {
        for (let e = 0; e < 2; e++) {
          const i = e ? st.length - 1 : 0, s = st[i];
          const ci = pos.length / 3; pos.push(s.x || 0, s.y || 0, s.z);
          for (let j = 0; j < n; j++) {
            const a = i * n + j, b = i * n + (j + 1) % n;
            if (e) idx.push(ci, b, a); else idx.push(ci, a, b);
          }
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(pos.length / 3 * 2), 2));
      g.setIndex(idx);
      g.computeVertexNormals();
      return g;
    }

    // =================================================================
    //  THE HULL SKIN, THE LINER, THE DOORS
    // =================================================================
    const NR = 64;
    const _p = [0, 0, 0];
    // a grid loft of the hull between z0 > z1 at offset `off`; every quad is
    // handed to `sort(x, y, z)` -> [node, bucket] | null
    function hullLoft(z0, z1, step, off, sort, flipped) {
      const rings = Math.max(2, Math.ceil((z0 - z1) / step) + 1);
      const P = new Float32Array(rings * (NR + 1) * 3);
      for (let i = 0; i < rings; i++) {
        const z = z0 + (z1 - z0) * i / (rings - 1);
        for (let j = 0; j <= NR; j++) {
          surf(z, j / NR * TAU, off, _p);
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
      const N = g.attributes.normal.array;
      // weld the seam column's normals (j = 0 and j = NR are the same point)
      for (let i = 0; i < rings; i++) {
        const a = (i * (NR + 1)) * 3, b = (i * (NR + 1) + NR) * 3;
        for (let q = 0; q < 3; q++) { const v = (N[a + q] + N[b + q]) / 2; N[a + q] = v; N[b + q] = v; }
      }
      const out = Object.create(null);
      for (let t = 0; t < idx.length; t += 6) {
        const a = idx[t], b = idx[t + 1], c = idx[t + 2], e = idx[t + 4];
        const cx = (P[a * 3] + P[b * 3] + P[c * 3] + P[e * 3]) / 4;
        const cy = (P[a * 3 + 1] + P[b * 3 + 1] + P[c * 3 + 1] + P[e * 3 + 1]) / 4;
        const cz = (P[a * 3 + 2] + P[b * 3 + 2] + P[c * 3 + 2] + P[e * 3 + 2]) / 4;
        const r = sort(cx, cy, cz);
        if (!r) continue;
        const key = r[0] + "|" + r[1];
        const L = out[key] || (out[key] = { node: r[0], bucket: r[1], p: [], n: [] });
        for (let q = 0; q < 6; q++) {
          const v = idx[t + q];
          L.p.push(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]);
          L.n.push(N[v * 3], N[v * 3 + 1], N[v * 3 + 2]);
        }
      }
      const list = [];
      for (const k in out) {
        const L = out[k], gg = new THREE.BufferGeometry();
        gg.setAttribute("position", new THREE.Float32BufferAttribute(L.p, 3));
        gg.setAttribute("normal", new THREE.Float32BufferAttribute(L.n, 3));
        gg.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(L.p.length / 3 * 2), 2));
        list.push({ node: L.node, bucket: L.bucket, g: gg });
      }
      g.dispose();
      return list;
    }
    hullLoft(5.36, -10.05, 0.11, 0, zoneOf).forEach(function (r) {
      if (r.bucket === "glass") put(r.node, r.g, null, "glass");
      else if (r.bucket === "seam") put(r.node, r.g, C.seam, "vc");
      else put(r.node, r.g, "paint", "paint");
    });
    // the liner inside the cockpit and the cabin (only behind skin: the openings stay open)
    hullLoft(5.05, -2.15, 0.14, -0.045, function (x, y, z) {
      const r = zoneOf(x, y, z);
      return r && r[1] === "paint" && y > 0.62 ? ["body", "vc"] : null;
    }, true).forEach(function (r) { put("body", r.g, C.interior, "vc"); });
    // the sliding doors: the same skin, a hair proud of it
    [["doorL", 1], ["doorR", -1]].forEach(function (d) {
      hullLoft(1.0, -0.8, 0.06, 0.02, function (x, y, z) {
        if (Math.sign(x) !== d[1]) return null;
        const b = doorZone(x, y, z);
        return b ? [d[0], b] : null;
      }).forEach(function (r) {
        if (r.bucket === "glass") put(r.node, r.g, null, "glass");
        else put(r.node, r.g, { paint: 0.97 }, "paint");
      });
      // the door's own frame, handle and the rail rollers
      const X = d[1] * 1.205;
      put(d[0], [rod([X, 0.74, 0.95], [X, 2.06, 0.95], 0.012, 4), rod([X, 0.74, -0.74], [X, 2.06, -0.74], 0.012, 4),
        at(box(0.03, 0.04, 0.14), X + d[1] * 0.012, 1.25, 0.82)], C.seam);
    });
    // panel seams round the boom and at the tail joint
    [-2.62, -3.42, -4.90, -6.15, DIM.tailBreak + 0.02, -8.45].forEach(function (z) {
      hullLoft(z + 0.012, z - 0.012, 0.024, 0.004, function (x, y, zz) { return [zz < DIM.tailBreak ? "tailSec" : "body", "vc"]; })
        .forEach(function (r) { put(r.node, r.g, C.seam, "vc"); });
    });

    // ---- interior: floors, bulkheads, the cockpit -----------------------------
    put("body", [at(box(2.22, 0.08, 4.05), 0, 0.74, -0.05), at(box(2.10, 0.08, 1.95), 0, 0.74, 3.25)], C.floor);
    put("body", [at(box(2.2, 1.45, 0.05), 0, 1.45, -2.07)], C.interior);     // the rear bulkhead
    // the nose: the avionics bay bulkhead and the pedals behind the chin windows
    put("body", [at(box(1.6, 0.75, 0.05), 0, 1.02, 4.80), at(box(1.7, 0.06, 0.95), 0, 0.72, 4.35)], C.interior);
    [-0.55, 0.55].forEach(function (x) { put("body", [at(box(0.10, 0.16, 0.04), x - 0.1, 0.86, 3.85, -0.5), at(box(0.10, 0.16, 0.04), x + 0.1, 0.86, 3.85, -0.5)], C.black); });
    // instrument panel, glareshield, centre console, overhead console
    put("body", [at(box(1.95, 0.55, 0.12), 0, 1.40, 4.05, -0.25), at(box(1.85, 0.08, 0.36), 0, 1.70, 3.95, -0.10),
      at(box(0.36, 0.32, 1.05), 0, 0.95, 3.35), at(box(0.45, 0.10, 0.70), 0, 2.12, 3.25)], C.panel);
    [-0.52, 0, 0.52].forEach(function (x) {
      put("body", [at(box(0.40, 0.30, 0.02), x - 0.12, 1.43, 3.985, -0.25), at(box(0.40 * (x ? 1 : 0.6), 0.30, 0.02), x + 0.16, 1.43, 3.985, -0.25)], C.screen);
    });
    // pilot seats (armoured buckets) + cyclic + collective
    [-0.55, 0.55].forEach(function (x) {
      put("body", [at(box(0.56, 0.10, 0.52), x, 1.04, 3.02), at(box(0.58, 0.80, 0.10), x, 1.45, 2.72, 0.14),
        at(box(0.06, 0.62, 0.52), x + 0.30, 1.30, 2.95), at(box(0.06, 0.62, 0.52), x - 0.30, 1.30, 2.95)], C.gunmetal);
      put("body", [rod([x, 0.80, 3.48], [x, 1.32, 3.40], 0.02, 6), rod([x + 0.30, 1.05, 3.05], [x + 0.30, 1.22, 3.45], 0.022, 6)], C.black);
    });
    // troop seats: canvas on tube frames (rear bench of 4 facing forward,
    // a middle row of 4, a forward row of 3 facing aft)
    TROOP_SEATS.forEach(function (s) {
      const fwd = s[3];
      put("body", [at(box(0.46, 0.05, 0.42), s[0], 1.15, s[2] + fwd * 0.02), at(box(0.46, 0.55, 0.04), s[0], 1.47, s[2] - fwd * 0.22)], C.canvas);
      put("body", [rod([s[0] - 0.2, 0.78, s[2] + fwd * 0.18], [s[0] - 0.2, 1.15, s[2] + fwd * 0.18], 0.012, 4),
        rod([s[0] + 0.2, 0.78, s[2] + fwd * 0.18], [s[0] + 0.2, 1.15, s[2] + fwd * 0.18], 0.012, 4)], C.steel);
    });
    // the gunners' seats behind the windows
    [-1, 1].forEach(function (s) { put("body", [at(box(0.42, 0.06, 0.42), s * 0.62, 1.12, 1.55), at(box(0.06, 0.5, 0.42), s * 0.40, 1.38, 1.55)], C.canvas); });
    // the crew: two pilots in HGU-56 helmets
    PILOTS.forEach(function (x) { put("body", figure("pilot", x, 1.10, 3.00, 0)); });

    // ---- the doghouse, gearbox, engines, HIRSS ----------------------------------
    // the forward fairing from the cockpit roof up to the gearbox
    put("body", sloft([{ z: 2.70, y: 2.22, w: 0.40, t: 0.03, b: 0.02, p: 3 }, { z: 2.25, y: 2.26, w: 0.58, t: 0.22, b: 0.04, p: 3.2 },
      { z: 1.40, y: 2.28, w: 0.66, t: 0.52, b: 0.05, p: 3.4 }, { z: 0.30, y: 2.28, w: 0.62, t: 0.66, b: 0.05, p: 3.4 },
      { z: -0.90, y: 2.28, w: 0.58, t: 0.62, b: 0.05, p: 3.2 }, { z: -2.30, y: 2.24, w: 0.46, t: 0.34, b: 0.05, p: 3 },
      { z: -3.60, y: 2.17, w: 0.26, t: 0.05, b: 0.03, p: 2.6 }], 28), "paint");
    [-1, 1].forEach(function (s) {
      const X = s * 0.80;
      // the T700 nacelle
      put("body", sloft([{ z: 1.10, x: X, y: 2.56, w: 0.29, t: 0.30, b: 0.28, p: 2.3 }, { z: 0.85, x: X, y: 2.56, w: 0.34, t: 0.35, b: 0.32, p: 2.5 },
        { z: -1.10, x: X, y: 2.56, w: 0.35, t: 0.35, b: 0.32, p: 2.6 }, { z: -1.75, x: X, y: 2.55, w: 0.31, t: 0.31, b: 0.30, p: 2.6 }], 22, false), "paint");
      // intake: the particle separator's dark throat and its lip
      put("body", at(new THREE.CircleGeometry(0.27, 20), X, 2.56, 1.08), C.black);
      put("body", at(new THREE.TorusGeometry(0.28, 0.025, 6, 22), X, 2.56, 1.11), C.gunmetal);
      put("body", at(cylZ(0.07, 0.10, 10), X, 2.56, 1.11), C.gunmetal);
      // cowling hinge line + the engine access seam
      put("body", [rod([X + s * 0.33, 2.50, 0.80], [X + s * 0.33, 2.50, -1.70], 0.008, 4), rod([X, 2.90, 0.20], [X, 2.90, -1.50], 0.008, 4)], C.seam);
      // HIRSS: the suppressor duct turns outboard and slightly up, outlet open
      put("body", sloft([{ z: -1.70, x: X, y: 2.55, w: 0.30, t: 0.29, b: 0.27, p: 3.4 }, { z: -2.30, x: X + s * 0.06, y: 2.56, w: 0.28, t: 0.34, b: 0.28, p: 3.6 },
        { z: -2.95, x: X + s * 0.20, y: 2.60, w: 0.22, t: 0.38, b: 0.26, p: 3.6 }, { z: -3.32, x: X + s * 0.32, y: 2.64, w: 0.18, t: 0.38, b: 0.24, p: 3.6 }], 20, false), { paint: 0.82 });
      put("body", sloft([{ z: -3.30, x: X + s * 0.32, y: 2.64, w: 0.16, t: 0.35, b: 0.21, p: 3.6 }, { z: -3.33, x: X + s * 0.33, y: 2.64, w: 0.16, t: 0.35, b: 0.21, p: 3.6 }], 20), C.black);
      // the louvres along the duct
      for (let k = 0; k < 4; k++) put("body", at(box(0.02, 0.36, 0.05), X + s * (0.27 + k * 0.03), 2.60, -2.15 - k * 0.27, 0, s * 0.2, 0), C.gunmetal);
    });
    // mast, static swashplate, scissors
    put("body", [at(cylY(0.26, 0.20, 0.30, 16), 0, 3.02, 0), at(cylY(0.15, 0.15, 0.72, 12), 0, 3.42, 0)], C.gunmetal);
    put("body", at(cylY(0.34, 0.34, 0.06, 18), 0, 3.20, 0), C.steel);
    // APU exhaust, ALQ-144 IR jammer ("disco ball") behind the mast, antennas
    put("body", [at(cylY(0.17, 0.17, 0.12, 16), 0, 2.98, -2.35), at(cylY(0.15, 0.15, 0.30, 12), 0, 3.18, -2.35)], C.gunmetal);
    put("body", at(sph(0.15, 10, 6), 0, 3.34, -2.35), C.black);
    put("body", [at(box(0.015, 0.26, 0.20), 0, 2.36, -4.20, 0.3), at(box(0.015, 0.20, 0.16), 0, 0.46, 0.60, -0.3),
      at(box(0.015, 0.22, 0.18), 0, 2.33, 2.20, 0.3), rod([0, 2.15, -6.4], [0, 2.85, -6.9], 0.008, 4)], C.gunmetal);
    // wire-strike cutters: above the cockpit, below the nose; windshield deflector
    put("body", [at(box(0.025, 0.30, 0.10), 0, 2.40, 3.30, -0.45), at(box(0.025, 0.26, 0.08), 0, 0.50, 4.72, 0.45),
      rod([0, 1.72, 4.60], [0, 2.20, 3.68], 0.018, 5)], C.gunmetal);
    // pitot tubes on the nose, the landing light, RWR domes
    [-1, 1].forEach(function (s) {
      put("body", [rod([s * 0.40, 1.62, 4.90], [s * 0.46, 1.70, 5.35], 0.014, 5), at(cylZ(0.02, 0.18, 6), s * 0.46, 1.70, 5.40)], C.steel);
      put("body", [at(sph(0.06, 8, 6), s * 0.70, 1.05, 4.95), at(sph(0.05, 8, 6), s * 0.27, 1.95, -9.70)], C.black);
      // M130 chaff/flare dispensers on the tail cone
      put("body", at(box(0.08, 0.20, 0.34), s * 0.47, 1.70, -4.60), C.gunmetal);
      // steps under the cockpit doors
      put("body", at(box(0.06, 0.04, 0.34), s * 1.20, 0.78, 2.75), C.gunmetal);
    });
    put("body", at(cylY(0.13, 0.12, 0.08, 12), 0, 0.53, 4.30), C.steel);

    // ---- the main gear and the tail wheel ------------------------------------
    [-1, 1].forEach(function (s) {
      const ax = [s * 1.355, 0.38, 2.05];
      // drag beam to the axle, the shock strut up to the fuselage side
      put("body", [rod([s * 0.70, 0.52, 2.30], [ax[0], ax[1] + 0.05, ax[2] + 0.12], 0.075, 8), rod([ax[0], ax[1] + 0.05, ax[2]], [s * 1.16, 1.30, 2.18], 0.065, 10),
        rod([s * 1.25, 0.85, 2.12], [s * 1.16, 1.30, 2.18], 0.085, 10)], C.gunmetal);
      const wh = K.wheel(0.38, 0.22);
      put("body", at(wh.tire, ax[0] + s * 0.06, ax[1], ax[2]), C.rubber);
      put("body", at(wh.hub, ax[0] + s * 0.06, ax[1], ax[2]), C.steel);
    });
    put("body", at(box(1.40, 0.10, 0.16), 0, 0.50, 2.30), C.gunmetal);
    put("body", [rod([0, 1.55, -6.70], [0, 0.40, -6.92], 0.06, 8), rod([0.08, 0.42, -6.92], [0.08, 0.22, -7.05], 0.025, 6),
      rod([-0.08, 0.42, -6.92], [-0.08, 0.22, -7.05], 0.025, 6)], C.gunmetal);
    {
      const tw = K.wheel(0.22, 0.13);
      put("body", at(tw.tire, 0, 0.22, -7.05), C.rubber);
      put("body", at(tw.hub, 0, 0.22, -7.05), C.steel);
    }

    // ---- the tail: pylon, gearbox, drive shaft cover, stabilator ---------------
    {
      const fin = K.wing([{ x: 0, le: -7.80, c: 2.05, tc: 0.15 }, { x: 1.95, le: -9.28, c: 1.06, tc: 0.13 }], { K: 6 });
      put("tailSec", at(fin, 0, 2.02, 0, 0, 0, PI / 2), "paint");
      // the 90 deg gearbox fairing at the top of the pylon
      put("tailSec", sloft([{ z: -9.05, y: 3.72, w: 0.06, t: 0.10, b: 0.10 }, { z: -9.30, y: 3.70, w: 0.15, t: 0.22, b: 0.20, p: 2.4 },
        { z: -10.20, y: 3.62, w: 0.15, t: 0.22, b: 0.22, p: 2.4 }, { z: -10.45, y: 3.58, w: 0.05, t: 0.06, b: 0.06 }], 14), "paint");
      // the tail-rotor drive shaft cover along the boom top
      put("tailSec", sloft([{ z: -7.42, y: 2.17, w: 0.09, t: 0.06, b: 0.02 }, { z: -8.60, y: 2.27, w: 0.09, t: 0.06, b: 0.02 }], 10), { paint: 0.95 });
      put("body", sloft([{ z: -3.55, y: 2.17, w: 0.09, t: 0.06, b: 0.02 }, { z: -7.38, y: 2.15, w: 0.09, t: 0.06, b: 0.02 }], 10), { paint: 0.95 });
      // the tail gearbox stub the rotor hangs on (starboard face)
      put("tailSec", at(cylX(0.10, 0.34, 12), -0.25, DIM.tail[1], DIM.tail[2]), C.gunmetal);
      const st = K.wing([{ x: 0.22, le: -8.75, c: 1.02, tc: 0.11, y: 1.98 }, { x: 2.19, le: -8.88, c: 0.86, tc: 0.10, y: 1.98 }], { K: 5 });
      put("stab", [st, mir(st)], "paint");
      // formation lights (the green strips) on the pylon and boom
      [-1, 1].forEach(function (s) {
        put("tailSec", at(box(0.006, 0.40, 0.05), s * 0.135, 2.80, -8.95, 0.55), 0x3d7a4e, "lamp");
        put("body", at(box(0.006, 0.05, 0.42), s * 0.40, 1.95, -5.40), 0x3d7a4e, "lamp");
      });
      put("tailSec", at(sph(0.05, 8, 6), 0, 3.86, -10.40), 0xff3020, "lamp");
    }
    // nav lights (red port, green starboard), the belly beacon
    put("body", at(sph(0.05, 8, 6), 1.19, 1.70, 2.0), 0xff3b30, "lamp");
    put("body", at(sph(0.05, 8, 6), -1.19, 1.70, 2.0), 0x30d070, "lamp");
    put("body", at(sph(0.06, 8, 6), 0, 0.50, -1.2), 0xff2a20, "lamp");

    // ---- door rails, FRIES bars, the guns, the gunners ---------------------------
    [-1, 1].forEach(function (s) {
      put("body", [at(box(0.04, 0.05, 3.40), s * 1.20, 2.13, -0.80), at(box(0.04, 0.04, 3.40), s * 1.17, 0.70, -0.80)], C.gunmetal);
      const fn = s > 0 ? "friesL" : "friesR", o = NODES[fn][1];
      // the bar (along outboard) with its hinge plate; the rope's eye at the end
      put(fn, [rod([o[0], o[1], o[2]], [o[0] + s * 1.02, o[1] - 0.03, o[2]], 0.035, 8), at(box(0.12, 0.08, 0.16), o[0], o[1], o[2])], C.gunmetal);
      put(fn, at(new THREE.TorusGeometry(0.05, 0.012, 5, 10), o[0] + s * 1.0, o[1] - 0.08, o[2], 0, PI / 2, 0), C.steel);
    });
    GUNS.forEach(function (gd, gi) {
      const yawN = gi ? "gunRYaw" : "gunLYaw", kickN = gi ? "gunRKick" : "gunLKick", p = gd.pos;
      // the pintle arm (yaws with the gun) and the window sill post (fixed)
      put("body", rod([p[0], 1.18, p[2]], [p[0], p[1] - 0.12, p[2]], 0.03, 6), C.gunmetal);
      put(yawN, [at(cylY(0.05, 0.05, 0.12, 10), p[0], p[1] - 0.08, p[2]), at(box(0.06, 0.06, 0.20), p[0], p[1] - 0.02, p[2] - 0.05)], C.gunmetal);
      // M240H: receiver, feed cover, barrel + flash hider, spade grips, ammo can, link bag
      const g = [];
      g.push(at(box(0.10, 0.13, 0.52), p[0], p[1] + 0.03, p[2] + 0.06));
      g.push(at(box(0.10, 0.04, 0.26), p[0], p[1] + 0.115, p[2] + 0.14));
      g.push(at(cylZ(0.022, 0.62, 8), p[0], p[1] + 0.05, p[2] + 0.62));
      g.push(at(cylZ(0.034, 0.10, 8), p[0], p[1] + 0.05, p[2] + 0.94));
      g.push(at(cylZ(0.035, 0.20, 8), p[0], p[1] + 0.05, p[2] + 0.42));      // gas cylinder housing
      g.push(rod([p[0] - 0.07, p[1] + 0.02, p[2] - 0.22], [p[0] - 0.07, p[1] - 0.10, p[2] - 0.26], 0.02, 6));
      g.push(rod([p[0] + 0.07, p[1] + 0.02, p[2] - 0.22], [p[0] + 0.07, p[1] - 0.10, p[2] - 0.26], 0.02, 6));
      g.push(rod([p[0] - 0.07, p[1] + 0.02, p[2] - 0.22], [p[0] + 0.07, p[1] + 0.02, p[2] - 0.22], 0.015, 5));
      put(kickN, g, C.gunmetal);
      put(kickN, at(box(0.11, 0.17, 0.27), p[0] - gd.s * 0.13, p[1] - 0.06, p[2] + 0.04), 0x4a4d3a);
      put(kickN, at(box(0.12, 0.14, 0.18), p[0] + gd.s * 0.11, p[1] - 0.08, p[2] + 0.08), 0x2f3027);
      put(kickN, at(new THREE.CircleGeometry(0.012, 6), p[0], p[1] + 0.05, p[2] + 0.991), C.black);
      // the gunner (crew chief to port), sat behind his window
      put(gi ? "gunnerR" : "gunnerL", figure("gunner", NODES[gi ? "gunnerR" : "gunnerL"][1][0], 1.15, NODES.gunnerL[1][2], 0));
    });

    // ---- bake the buckets ---------------------------------------------------
    const G = Object.create(null);
    for (const k in BK) G[k] = { paint: merge(BK[k].paint), vc: merge(BK[k].vc), glass: merge(BK[k].glass), lamp: merge(BK[k].lamp) };

    // =================================================================
    //  ROTORS (built in their own node space)
    // =================================================================
    function bladeGeo(tipX) {
      const parts = [];
      parts.push(at(box(0.50, 0.12, 0.22), 0.25, 0, 0));                    // the elastomeric bearing / cuff
      parts.push(at(box(0.10, 0.05, 0.18), 0.10, 0.09, 0.10));              // pitch horn
      const st = [{ x: 0.50, le: 0.12, c: 0.36, tc: 0.20 }, { x: 1.10, le: 0.13, c: 0.53, tc: 0.095 }];
      if (tipX > 7.5) st.push({ x: 7.66, le: 0.13, c: 0.53, tc: 0.09 }, { x: 7.92, le: 0.04, c: 0.46, tc: 0.08 }, { x: 8.18 - 0.30, le: -0.06, c: 0.34, tc: 0.07 });
      else st.push({ x: tipX - 0.25, le: 0.13, c: 0.53, tc: 0.09 }, { x: tipX, le: 0.06, c: 0.30, tc: 0.08 });
      const w = K.wing(st, { K: 5 });
      // -18 deg of twist root to tip (washout), about the quarter chord
      const P = w.attributes.position;
      for (let i = 0; i < P.count; i++) {
        const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
        const a = (0.13 - 0.18 * clamp((x - 1.1) / 7.0, 0, 1)) * 1, zq = 0.13 - 0.13;
        const c = Math.cos(a), sn = Math.sin(a), dz = z - zq;
        P.setXYZ(i, x, y * c + dz * sn, zq - y * sn + dz * c);
      }
      w.computeVertexNormals();
      parts.push(w);
      const g = merge(parts.map(function (p) {
        // leading edge toward -Z: the rotor turns counter-clockwise seen from above
        K.xm(p, new THREE.Matrix4().makeScale(1, 1, -1));
        if (!p.attributes.normal) p.computeVertexNormals();
        colour(p, function (x, y, z) { return RGB(x > 7.6 && tipX > 7.5 ? C.tipCap : (x > 1.0 && z < -0.08 ? C.edge : C.blade)); });
        return p;
      }));
      return g;
    }
    G.blade = bladeGeo(8.18);
    G.bladeStub = bladeGeo(2.6);
    {
      // hub plate, the four arms, the bifilar absorber on top, pitch links
      const parts = [cylY(0.42, 0.42, 0.14, 18), at(cylY(0.20, 0.16, 0.30, 14), 0, 0.20, 0), at(cylY(0.34, 0.34, 0.05, 18), 0, -0.48, 0)];
      for (let i = 0; i < 4; i++) {
        const a = i * PI / 2, c = Math.cos(a), s = -Math.sin(a);
        parts.push(at(box(0.36, 0.10, 0.20), c * 0.40, 0, s * 0.40, 0, a, 0));
        parts.push(rod([c * 0.32, -0.46, s * 0.32 - 0.08 * c], [c * 0.40, -0.06, s * 0.40 - 0.08 * c], 0.018, 5));
        const b = a + PI / 4, cb = Math.cos(b), sb = -Math.sin(b);
        parts.push(rod([0, 0.32, 0], [cb * 0.42, 0.32, sb * 0.42], 0.03, 6));
        parts.push(at(cylY(0.07, 0.07, 0.12, 10), cb * 0.46, 0.32, sb * 0.46));
      }
      parts.forEach(function (p) { if (!p.attributes.normal) p.computeVertexNormals(); colour(p, C.gunmetal); });
      G.hub = merge(parts);
    }
    {
      // tail rotor in its spin node's frame: axis X, blades in the YZ plane
      const parts = [at(cylX(0.11, 0.18, 12), -0.05, 0, 0)];
      for (let i = 0; i < 4; i++) {
        const b = K.wing([{ x: 0.12, le: 0.11, c: 0.22, tc: 0.12 }, { x: 0.30, le: 0.125, c: 0.25, tc: 0.10 }, { x: DIM.tailR, le: 0.125, c: 0.25, tc: 0.08 }], { K: 4 });
        xf(b, 0, 0, 0, 0.12, 0, 0);
        xf(b, 0, 0, 0, 0, 0, PI / 2);
        xf(b, -0.10 - (i & 1) * 0.04, 0, 0, i * PI / 2, 0, 0);
        parts.push(b);
      }
      parts.forEach(function (p) { if (!p.attributes.normal) p.computeVertexNormals(); colour(p, C.blade); });
      G.trotor = merge(parts);
    }
    G.disc = new THREE.RingGeometry(0.6, DIM.rotorR - 0.05, 64, 1); G.disc.rotateX(-PI / 2); G.disc._shared = true;
    G.tdisc = new THREE.CircleGeometry(DIM.tailR, 28); G.tdisc.rotateY(PI / 2); G.tdisc._shared = true;
    G.flag = new THREE.PlaneGeometry(0.62, 0.40); G.flag._shared = true;

    // ---- the troops (instanced): seated in the cabin, and on the ropes ------------
    function fig(pose) {
      const parts = figure(pose, 0, 0, 0, 0);
      return merge(parts);
    }
    G.trooper = fig("seat");
    G.slider = fig("rope");
    {
      const r = new THREE.CylinderGeometry(0.022, 0.022, 1, 6, 1, true); r.translate(0, -0.5, 0);
      colour(r, C.rope); G.rope = merge([r]);
    }

    // ---- materials ------------------------------------------------------------
    function vcMat(hex) {
      let m = null;
      try { m = CBZ.cmat ? CBZ.cmat(hex, { vc: true }) : null; } catch (e) { m = null; }
      if (!m || !m.vertexColors) { m = new THREE.MeshLambertMaterial({ color: hex, vertexColors: true }); m._shared = true; }
      return m;
    }
    const M = {
      vc: vcMat(0xffffff),
      paint: { green: vcMat(SCHEME.green), tan: vcMat(SCHEME.tan), grey: vcMat(SCHEME.grey) },
      glass: new THREE.MeshPhongMaterial({ color: 0x22303a, specular: 0xa8bcc8, shininess: 90, transparent: true, opacity: 0.36, side: THREE.DoubleSide, depthWrite: false }),
      lamp: new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true }),
      disc: new THREE.MeshBasicMaterial({ color: 0x15181a, transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false }),
      tdisc: new THREE.MeshBasicMaterial({ color: 0x15181a, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false }),
    };
    M.glass._shared = M.lamp._shared = M.disc._shared = M.tdisc._shared = true;
    TPL = { G: G, M: M };
    return TPL;

    /* A MAN, built round his seat point (x, y, z), facing +Z (yaw rotates).
       pose: pilot | gunner | seat (a trooper on a bench, rifle between his
       knees) | rope (on a fast rope: gloved hands over his head, feet
       crossed on the rope, rifle slung). */
    function figure(pose, X, Y, Z, yaw) {
      const P = [];
      function add(g, col) { if (!g.attributes.normal) g.computeVertexNormals(); colour(g, col); P.push(g); }
      const seated = pose !== "rope";
      const crew = pose === "pilot" || pose === "gunner";
      const suit = crew ? C.suit : C.uniform, vest = crew ? C.vest : C.kit;
      // legs
      [-1, 1].forEach(function (s) {
        if (seated) {
          const hip = [s * 0.10, 0.02, 0.02], knee = [s * 0.12, 0.04, 0.44], ankle = [s * 0.12, -0.38, 0.50];
          add(rod(hip, knee, 0.075, 8), suit); add(rod(knee, ankle, 0.058, 8), suit);
          add(at(box(0.11, 0.09, 0.26), ankle[0], ankle[1] - 0.04, ankle[2] + 0.06), C.boot);
        } else {
          const knee = [s * 0.08, -0.43, 0.10], ankle = [-s * 0.03, -0.84, 0.10 + s * 0.04];
          add(rod([s * 0.09, 0, 0], knee, 0.075, 8), suit); add(rod(knee, ankle, 0.058, 8), suit);
          add(at(box(0.10, 0.09, 0.25), ankle[0], ankle[1] - 0.05, ankle[2] + 0.04), C.boot);
        }
      });
      // pelvis, torso, armour
      add(at(box(0.32, 0.14, 0.22), 0, 0.05, 0), suit);
      const torso = cylY(0.15, 0.18, 0.50, 12); torso.scale(1, 1, 0.62); add(at(torso, 0, 0.36, 0), suit);
      add(at(box(0.37, 0.38, 0.27), 0, 0.38, 0.005), vest);
      if (!crew) {
        // pouches on the carrier, the assault pack
        add(at(box(0.30, 0.10, 0.06), 0, 0.27, 0.15), vest);
        add(at(box(0.30, 0.36, 0.16), 0, 0.42, -0.21), C.pack);
      }
      add(at(cylY(0.05, 0.05, 0.08, 8), 0, 0.64, 0), C.skin);
      // head + helmet
      add(at(sph(0.10, 12, 9), 0, 0.77, 0.01), C.skin);
      if (crew) {
        const h = new THREE.SphereGeometry(0.135, 14, 9, 0, TAU, 0, PI * 0.62); add(at(h, 0, 0.79, -0.005), C.helmet);
        add(at(box(0.22, 0.08, 0.05), 0, 0.81, 0.12), C.visor);
        add(at(box(0.10, 0.04, 0.04), 0, 0.92, 0.10), C.helmet);              // NVG mount
      } else {
        const h = new THREE.SphereGeometry(0.128, 14, 9, 0, TAU, 0, PI * 0.56); add(at(h, 0, 0.79, 0), C.helmet);
        add(at(box(0.07, 0.04, 0.03), 0, 0.86, 0.12), C.black);
      }
      // arms
      [-1, 1].forEach(function (s) {
        const sh = [s * 0.21, 0.55, 0];
        let el, hand;
        if (pose === "rope") { el = [s * 0.17, 0.80, 0.12]; hand = [s * 0.03, 1.02 - (s > 0 ? 0 : 0.16), 0.15]; }
        else if (pose === "pilot") { el = [s * 0.24, 0.30, 0.18]; hand = s > 0 ? [0.30, 0.12, 0.30] : [0.02, 0.22, 0.42]; }
        else if (pose === "gunner") { el = [s * 0.24, 0.36, 0.20]; hand = [s * 0.10, 0.44, 0.48]; }
        else { el = [s * 0.23, 0.30, 0.16]; hand = [s * 0.06, 0.32, 0.36]; }
        add(rod(sh, el, 0.052, 8), suit); add(rod(el, hand, 0.045, 8), suit);
        add(at(sph(0.045, 8, 6), hand[0], hand[1], hand[2]), crew || pose === "rope" ? C.glove : C.glove);
      });
      // the carbine: between his knees seated, slung across his back on the rope
      if (pose === "seat") { add(rod([0.02, 0.40, 0.36], [0.0, -0.36, 0.48], 0.022, 6), C.rifle); add(at(box(0.04, 0.10, 0.20), 0.01, 0.12, 0.42, -1.4), C.rifle); }
      if (pose === "rope") add(rod([0.20, 0.62, -0.28], [-0.22, 0.05, -0.26], 0.022, 6), C.rifle);
      P.forEach(function (g) { xf(g, X, Y, Z, 0, yaw || 0, 0); });
      return P;
    }
  }
  // seat points in the cabin [x, y, z, facing (+1 forward / -1 aft)]: rear 4, middle 4, forward 3
  const TROOP_SEATS = [
    [0.75, 1.15, -1.62, 1], [0.25, 1.15, -1.62, 1], [-0.25, 1.15, -1.62, 1], [-0.75, 1.15, -1.62, 1],
    [0.75, 1.15, -0.48, 1], [0.25, 1.15, -0.48, 1], [-0.25, 1.15, -0.48, 1], [-0.75, 1.15, -0.48, 1],
    [0.45, 1.15, 0.78, -1], [0.0, 1.15, 0.78, -1], [-0.45, 1.15, 0.78, -1],
  ];
  const PILOTS = [-0.55, 0.55];         // the pilot in command on the right, as in every US helicopter

  // ---- nation flags on the pylon ------------------------------------------------
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
  function schemeFor(ground) {
    const g = String(ground || "").toLowerCase();
    if (/snow|ice|arctic|winter|tundra|water|sea|ocean|naval/.test(g)) return "grey";
    if (/sand|dune|desert|erg|arid/.test(g)) return "tan";
    return "green";
  }
  const DUST = { tan: 0xb7a584, grey: 0xdfe5ea, green: 0x8b8466 };

  // =====================================================================
  //  BUILD: one airframe, sharing every geometry and material
  // =====================================================================
  function build(ctx) {
    const T = template();
    if (!T) return null;
    const THREE = window.THREE, G = T.G, M = T.M;
    const root = new THREE.Group(); root.name = "uh60-black-hawk";
    const lean = new THREE.Group(); lean.name = "uh60-lean"; lean.position.y = DIM.cgY; root.add(lean);
    const N = Object.create(null);
    N.body = new THREE.Group(); N.body.name = "uh60-body"; N.body.position.y = -DIM.cgY; lean.add(N.body);
    for (const k in NODES) {
      if (k === "body") continue;
      const d = NODES[k], po = NODES[d[0]][1], o = d[1];
      const g = new THREE.Group(); g.name = "uh60-" + k;
      g.position.set(o[0] - po[0], o[1] - po[1], o[2] - po[2]);
      N[k] = g;
    }
    for (const k in NODES) if (k !== "body") N[NODES[k][0]].add(N[k]);
    N.tailCant.rotation.z = -DIM.cant;
    function mesh(geo, mat, parent, shadow) {
      if (!geo) return null;
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = shadow !== false; m.receiveShadow = true;
      parent.add(m); return m;
    }
    const scheme = schemeFor(ctx && ctx.ground);
    const paints = [], lamps = [];
    for (const k in G) {
      if (!N[k] || !G[k] || !(G[k].vc || G[k].paint || G[k].glass)) continue;
      const pm = mesh(G[k].paint, M.paint[scheme], N[k]); if (pm) paints.push(pm);
      mesh(G[k].vc, M.vc, N[k]);
      mesh(G[k].glass, M.glass, N[k], false);
      const lm = mesh(G[k].lamp, M.lamp, N[k], false); if (lm) lamps.push(lm);
    }
    // main rotor: hub + four blades on flap hinges
    mesh(G.hub, M.vc, N.rotor);
    const blades = [];
    for (let i = 0; i < 4; i++) {
      const arm = new THREE.Group(); arm.rotation.y = i * PI / 2; N.rotor.add(arm);
      const flap = new THREE.Group(); flap.position.x = 0.40; flap.rotation.order = "ZYX"; arm.add(flap);
      blades.push({ flap: flap, mesh: mesh(G.blade, M.vc, flap), az: i * PI / 2 });
    }
    const disc = mesh(G.disc, M.disc, N.rotor, false); disc.position.y = 0.05; disc.visible = false;
    mesh(G.trotor, M.vc, N.tailSpin);
    const tdisc = mesh(G.tdisc, M.tdisc, N.tailSpin, false); tdisc.position.x = -0.06; tdisc.visible = false;
    // the troops: seated in the cabin, sliding down the ropes
    const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(1, 1, 1), _v = new THREE.Vector3();
    const troops = new THREE.InstancedMesh(G.trooper, M.vc, TROOP_SEATS.length);
    for (let i = 0; i < TROOP_SEATS.length; i++) {
      const s = TROOP_SEATS[i];
      troops.setMatrixAt(i, _m.compose(_v.set(s[0], s[1], s[2]), _q.setFromEuler(_e.set(0, s[3] > 0 ? 0 : PI, 0)), _s));
    }
    troops.count = 0; troops.frustumCulled = false; troops.castShadow = false; N.body.add(troops);
    const sliders = new THREE.InstancedMesh(G.slider, M.vc, 6);
    sliders.count = 0; sliders.frustumCulled = false; sliders.castShadow = true; N.body.add(sliders);
    sliders.instanceMatrix.setUsage && sliders.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const ropes = [];
    [N.friesL, N.friesR].forEach(function (f, i) {
      const r = mesh(G.rope, M.vc, f); r.position.set((i ? -1 : 1) * 1.0, -0.10, 0); r.visible = false; r.castShadow = false;
      ropes.push(r);
    });
    // pylon flags (both faces; starboard reversed so the hoist leads)
    const flags = [];
    [-1, 1].forEach(function (s) {
      const f = new THREE.Mesh(G.flag, M.vc);
      f.position.set(s * 0.15, 2.62 - NODES.tailSec[1][1], -8.85 - NODES.tailSec[1][2]);
      f.rotation.y = s * PI / 2;
      if (s < 0) f.scale.x = -1;
      f.visible = false; f.castShadow = false;
      N.tailSec.add(f); flags.push(f);
    });

    const R = {
      group: root, lean: lean, nodes: N, paints: paints, blades: blades, disc: disc, tdisc: tdisc, lamps: lamps,
      troops: troops, sliders: sliders, ropes: ropes, flags: flags, scheme: scheme, M: M,
      clock: 0, px: 0, py: 0, pz: 0, h0: 0, vx: 0, vz: 0, fwdA: 0, yawRate: 0, dead: false, seeded: false,
      rpm: 1, rotA: (ctx && ctx.seed || 0) * 1.37, tA: 0, cone: 0.03, stabA: -0.70, wob: (ctx && ctx.seed || 0) * 2.1,
      gun: [{ yaw: PI / 2 * 0.9, pitch: 0.3, kick: 0, ok: false, want: 0, wantP: 0, dead: false, brass: 0 },
        { yaw: -PI / 2 * 0.9, pitch: 0.3, kick: 0, ok: false, want: 0, wantP: 0, dead: false, brass: 0 }],
      tgt: null, veh: null, door: 0, doorsLatched: false, fries: 0, insT: -1, insN: 0, insDone: false,
      dustT: 0, smokeT: 0, hitEngine: false, fire: false, broken: false, crashed: false, tailBent: 0,
      _m: _m, _q: _q, _e: _e, _s: _s, _v: _v,
    };
    const rig = {
      turret: null,
      settle: function () { R.seeded = false; tick(R, true, 0, null); },
      muzzleWorld: function (out, shot) { return muzzle(R, out, shot); },
      fire: function (shot) { fire(R, shot); },
      canFire: function (shot) { return canFire(R, shot); },
      damage: function (vs, res) { damage(R, vs, res); },
      mark: function (nation, ground, side) {
        const sc = schemeFor(ground);
        R.scheme = sc;
        for (let i = 0; i < paints.length; i++) paints[i].material = M.paint[sc];
        rig.setNation(nation || (side && side.flagId), side && side.flag);
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
    root.userData.aircraftDims = { family: "UH-60M", length: DIM.length, span: DIM.rotorR * 2, height: DIM.height, bodyW: DIM.width, bodyL: DIM.fuselage };
    root.userData.crewSeats = [
      { job: "Pilot", x: -0.55, y: 1.10, z: 3.00, yaw: 0, cushionH: 0.42, floorBelow: 0.36 },
      { job: "Copilot", x: 0.55, y: 1.10, z: 3.00, yaw: 0, cushionH: 0.42, floorBelow: 0.36 },
      { job: "Crew Chief", x: 0.62, y: 1.15, z: 1.55, yaw: PI / 2, cushionH: 0.4, floorBelow: 0.37 },
      { job: "Door Gunner", x: -0.62, y: 1.15, z: 1.55, yaw: -PI / 2, cushionH: 0.4, floorBelow: 0.37 },
    ];
    if (ctx && (ctx.nation || ctx.flag)) rig.setNation(ctx.nation || ctx.flagId, ctx.flag);
    tick(R, true, 0, null);
    // footprint: the fuselage and its guns (what a round can hit), not the rotor disc
    return { group: root, rig: rig, footW: 4.0, footL: 17.0, height: DIM.height };
  }

  // ---- the guns -----------------------------------------------------------------
  let _w = null, _t = null;
  function V3() { return new window.THREE.Vector3(); }
  function worldAt(node, x, y, z, out) {
    if (!_w) _w = V3();
    out = out || _w;
    let r = node; while (r.parent) r = r.parent;
    r.updateMatrixWorld(true);
    return node.localToWorld(out.set(x, y, z));
  }
  function gunIndex(shot) { return shot && shot.wid === GUNS[1].id ? 1 : 0; }
  function muzzle(R, out, shot) {
    const gi = gunIndex(shot), p = GUNS[gi].pos;
    return worldAt(R.nodes[gi ? "gunRKick" : "gunLKick"], 0, 0.05, 1.0, out);
  }
  /* the yaw / pitch a gun needs for the point (wx, wy, wz), in hull terms,
     and whether its sector holds it. Writes R.sol = {yaw, pitch, ok}. */
  const SOL = { yaw: 0, pitch: 0, ok: false };
  function solve(R, gi, wx, wy, wz) {
    if (!_t) _t = V3();
    const g = GUNS[gi];
    _t.set(wx, wy, wz);
    R.nodes.body.worldToLocal(_t);
    const dx = _t.x - g.pos[0], dy = _t.y - g.pos[1], dz = _t.z - g.pos[2];
    SOL.yaw = Math.atan2(dx, dz);
    SOL.pitch = Math.atan2(-dy, Math.hypot(dx, dz));
    SOL.ok = SOL.yaw >= g.lo && SOL.yaw <= g.hi && SOL.pitch <= GUN_DOWN && SOL.pitch >= GUN_UP;
    return SOL;
  }
  function canFire(R, shot) {
    const gi = gunIndex(shot), G = R.gun[gi];
    if (G.dead || R.dead) return false;
    const t = (shot && shot.target) || R.tgt;
    if (!t || !t.pos) return true;
    R.group.updateMatrixWorld(true);
    const s = solve(R, gi, t.pos.x, t.pos.y + (t.aimY || 1), t.pos.z);
    if (!s.ok) return false;
    // the gunner is still swinging onto it
    return Math.abs(s.yaw - G.yaw) < 0.12 && Math.abs(s.pitch - G.pitch) < 0.12;
  }
  function fire(R, shot) {
    const gi = gunIndex(shot), G = R.gun[gi];
    G.kick = 1;
    // brass and links out of the ejection port, every few rounds (pooled)
    if (CBZ.ejectBrass && ((G.brass = (G.brass + 1) % 3) === 0)) {
      try {
        const p = worldAt(R.nodes[gi ? "gunRKick" : "gunLKick"], 0.06 * GUNS[gi].s, 0.0, 0.10);
        const h = R.group.rotation.y, a = h + G.yaw;
        CBZ.ejectBrass(p, { x: -Math.cos(a) * GUNS[gi].s, z: Math.sin(a) * GUNS[gi].s }, {});
      } catch (e) {}
    }
  }
  function damage(R, vs, res) {
    if (!res || !res.pen) return;
    if (res.zone === "top" || res.zone === "rear" || res.dmg > 120) R.hitEngine = true;
    if (res.burning || vs.burning) R.fire = true;
    // a hit that takes the firepower out took a gunner or his gun
    if (res.firepower) { const gi = R.gun[0].dead ? 1 : (Math.random() < 0.5 ? 0 : 1); R.gun[gi].dead = true; }
  }

  // passengers still aboard (the crew seat book: units/kit/vehicle.js)
  function aboard(veh) {
    const S = veh && veh.seats;
    if (!S) return 0;
    let n = 0;
    for (let i = 0; i < S.length; i++) if (!S[i].crew && S[i].man) n++;
    return n;
  }

  // ---- the rig: every moving part, once per animate (the battle clock) ------------
  function tick(R, snap, dt, ctx) {
    if (!(dt > 0)) dt = 0;
    if (dt > 0.1) dt = 0.1;
    R.clock += dt;
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
    const flying = agl > 1.6 && !wrecked;
    R.tgt = ctx && ctx.target || null;
    const veh = R.veh;

    // ---- rotors ---------------------------------------------------------------
    const rpmT = wrecked ? 0 : 1;
    R.rpm += (rpmT - R.rpm) * Math.min(1, dt * (wrecked ? (R.crashed ? 2.5 : 0.25) : 0.8));
    if (R.rpm < 0.01) R.rpm = 0;
    R.rotA = (R.rotA + DIM.omega * R.rpm * dt) % TAU;
    R.tA = (R.tA + DIM.omegaTail * R.rpm * (R.tailBent ? 0 : 1) * dt) % TAU;
    N.rotor.rotation.y = R.rotA;
    N.tailSpin.rotation.x = R.tA;
    const lift = flying ? 1 : 0.15;
    // a Black Hawk's blades droop hard at rest; in flight the disc cones up
    const coneT = -0.055 * (1 - R.rpm) + R.rpm * (-0.01 + 0.058 * lift);
    R.cone = snap ? coneT : R.cone + (coneT - R.cone) * Math.min(1, dt * 3);
    const a1 = flying ? clamp(0.012 + spd * 0.0006 + R.fwdA * 0.004, -0.03, 0.08) : 0;
    const coll = R.rpm * (0.03 + 0.10 * lift);
    for (let i = 0; i < 4; i++) {
      const B = R.blades[i], th = R.rotA + B.az;
      if (B.snapped) continue;
      B.flap.rotation.z = R.cone + a1 * Math.sin(th);
      B.flap.rotation.x = coll + a1 * 0.5 * Math.cos(th);
    }
    const spinning = dt > 0 && R.rpm > 0.55;
    R.disc.visible = spinning; R.tdisc.visible = spinning && !R.tailBent;

    // ---- the airframe: bank, flare, hover wander, stabilator ----------------------
    if (flying) {
      R.wob += dt;
      const bank = clamp(Math.atan(spd * R.yawRate / 9.81), -0.5, 0.5);
      const flare = clamp(R.fwdA / 9.81 * 0.9, -0.2, 0.2);
      const hov = spd < 6 ? 1 : 0.3;
      const k = snap ? 1 : Math.min(1, dt * 2.5);
      R.lean.rotation.z += (-bank + hov * 0.008 * Math.sin(R.wob * 0.9) - R.lean.rotation.z) * k;
      R.lean.rotation.x += (flare + hov * 0.01 * Math.sin(R.wob * 0.7 + 1) - R.lean.rotation.x) * k;
    } else if (!wrecked) {
      R.lean.rotation.x *= 1 - Math.min(1, dt * 3); R.lean.rotation.z *= 1 - Math.min(1, dt * 3);
    }
    // 42 deg trailing edge down in the hover, -10 deg (up) at cruise
    const stabT = spd < 15 ? -0.73 : spd < 40 ? -0.73 * (1 - (spd - 15) / 25) : clamp((spd - 40) / 35, 0, 1) * 0.17;
    R.stabA = snap ? stabT : R.stabA + (stabT - R.stabA) * Math.min(1, dt * 1.2);
    N.stab.rotation.x = R.stabA;

    // ---- the door guns ----------------------------------------------------------
    const t = R.tgt;
    let tgtOk = false;
    if (t && t.pos && !wrecked) { g.updateMatrixWorld(true); tgtOk = true; }
    for (let gi = 0; gi < 2; gi++) {
      const G = R.gun[gi], gd = GUNS[gi];
      let wy = gd.s * (1.45 + 0.35 * Math.sin(R.clock * 0.31 + gi * 2)), wp = 0.28 + 0.1 * Math.sin(R.clock * 0.47 + gi);  // scanning his sector
      if (tgtOk && !G.dead) {
        const s = solve(R, gi, t.pos.x, t.pos.y + (t.aimY || 1), t.pos.z);
        if (s.ok) { wy = s.yaw; wp = s.pitch; }
      }
      if (G.dead || wrecked) { wy = G.yaw; wp = 0.9; }
      if (snap) { G.yaw = wy; G.pitch = wp; }
      else {
        G.yaw += clamp(wy - G.yaw, -GUN_YAW_RATE * dt, GUN_YAW_RATE * dt);
        G.pitch += clamp(wp - G.pitch, -GUN_PITCH_RATE * dt, GUN_PITCH_RATE * dt);
      }
      G.yaw = clamp(G.yaw, gd.lo, gd.hi);
      N[gi ? "gunRYaw" : "gunLYaw"].rotation.y = G.yaw;
      N[gi ? "gunRPitch" : "gunLPitch"].rotation.x = clamp(G.pitch, GUN_UP, GUN_DOWN);
      G.kick = Math.max(0, G.kick - dt * 16);
      N[gi ? "gunRKick" : "gunLKick"].position.z = -0.05 * G.kick;
      // the gunner turns with his gun (inside the window he can)
      N[gi ? "gunnerR" : "gunnerL"].rotation.y = gd.s > 0 ? clamp(G.yaw, 0.6, 2.2) : clamp(G.yaw, -2.2, -0.6);
      N[gi ? "gunnerR" : "gunnerL"].visible = !G.dead;
    }

    // ---- the insertion: doors, FRIES, ropes, the men on them ---------------------------
    const phase = ctx && ctx.phase || "";
    const pax = aboard(veh);
    if (phase === "insert" && !wrecked) {
      if (R.insT < 0) { R.insT = 0; R.insN = pax; R.insDone = false; }
      else R.insT += dt;
      R.doorsLatched = true;
    } else if (R.insT >= 0 && (phase !== "insert" || wrecked)) { R.insT = -1; R.insDone = true; }
    const landed = !flying && !wrecked && spd < 2;
    const doorT = R.doorsLatched || landed ? 1 : 0;
    R.door = snap ? doorT : clamp(R.door + Math.sign(doorT - R.door) * dt / 1.1, 0, 1);
    const ds = R.door * R.door * (3 - 2 * R.door);
    N.doorL.position.z = NODES.doorL[1][2] - 1.78 * ds; N.doorL.position.x = NODES.doorL[1][0] + 0.05 * Math.min(1, ds * 4);
    N.doorR.position.z = NODES.doorR[1][2] - 1.78 * ds; N.doorR.position.x = NODES.doorR[1][0] - 0.05 * Math.min(1, ds * 4);
    const roping = R.insT >= 0 && !wrecked;
    const friesT = roping && R.insT > 0.5 ? 1 : 0;
    R.fries = snap ? friesT : clamp(R.fries + Math.sign(friesT - R.fries) * dt / 0.7, 0, 1);
    N.friesL.rotation.y = (1 - R.fries) * PI / 2;
    N.friesR.rotation.y = -(1 - R.fries) * PI / 2;
    const slideT = ROPE.agl / ROPE.speed, gap = ROPE.every / 2;
    let onRope = 0;
    for (let i = 0; i < 2; i++) {
      const r = R.ropes[i];
      const show = roping && R.insT > 1.15 && R.fries > 0.95;
      r.visible = show;
      if (show) r.scale.y = Math.min(1, (R.insT - 1.15) / 0.45) * Math.max(1, agl + 2.2 + 0.6);
    }
    let n6 = 0;
    if (roping && R.insN > 0) {
      for (let k = 0; k < R.insN && n6 < 6; k++) {
        const land = ROPE.delay + slideT + k * gap, start = land - slideT;
        if (R.insT < start || R.insT >= land) continue;
        const f = (R.insT - start) / slideT, s = (k & 1) ? -1 : 1;
        const fall = agl + 0.35;
        // a man slides fast and brakes near the bottom
        const ff = f < 0.8 ? f * 1.1 : 0.88 + (f - 0.8) * 0.6;
        R._m.compose(R._v.set(s * 2.17, 2.2 - 0.95 - fall * clamp(ff, 0, 1), NODES.friesL[1][2] + 0.0),
          R._q.setFromEuler(R._e.set(0, s > 0 ? -PI / 2 : PI / 2, 0)), R._s);
        R.sliders.setMatrixAt(n6++, R._m);
        onRope++;
      }
      // everyone who has left the bench, landed or not
      let left = 0;
      for (let k = 0; k < R.insN; k++) if (R.insT >= ROPE.delay + k * gap) left++;
      onRope = left - (R.insN - pax);
    }
    R.sliders.count = n6;
    if (n6) R.sliders.instanceMatrix.needsUpdate = true;
    R.troops.count = Math.max(0, Math.min(TROOP_SEATS.length, pax - Math.max(0, roping ? onRope : 0)));

    // ---- rotor wash ---------------------------------------------------------------------
    if (dt > 0 && !wrecked && R.rpm > 0.7 && agl < 30 && CBZ.cityDustKick) {
      R.dustT -= dt;
      if (R.dustT <= 0) {
        R.dustT = 0.09 + agl * 0.006;
        const a = Math.random() * TAU, r = 3 + Math.random() * 9;
        try { CBZ.cityDustKick(px + Math.cos(a) * r, gy + 0.2, pz + Math.sin(a) * r, 0.6 + 1.6 * (1 - agl / 30), DUST[R.scheme] || DUST.green, { dirx: Math.cos(a), dirz: Math.sin(a), speed: 6 }); } catch (e) {}
      }
    }
    // ---- damage: smoke from a hit engine, flame when burning ------------------------------
    const hpF = veh && veh.vs && veh.vs.maxHp ? veh.vs.hp / veh.vs.maxHp : 1;
    if (dt > 0 && !R.crashed && (R.hitEngine || hpF < 0.55 || R.fire) && CBZ.cityCrashSmoke) {
      R.smokeT -= dt;
      if (R.smokeT <= 0) {
        R.smokeT = 0.28;
        try {
          const p = worldAt(N.body, -1.12, 2.64, -3.35);
          CBZ.cityCrashSmoke(p.x, p.y, p.z, { count: 1, scale: 0.55 + 0.6 * (1 - hpF), shade: hpF < 0.3 || R.fire ? 0.25 : 0.6, flame: !!R.fire });
        } catch (e) {}
      }
    }
    // ---- the wreck: on the ground the blades strike and snap, the tail breaks ---------------
    if (wrecked) {
      for (let i = 0; i < R.lamps.length; i++) R.lamps[i].visible = false;
      if (!R.crashed && agl < 2.5) {
        R.crashed = true;
        const T = template();
        if (T && T.G.bladeStub) for (let i = 1; i < 4; i++) { R.blades[i].mesh.geometry = T.G.bladeStub; R.blades[i].snapped = true; }
        R.blades[0].flap.rotation.z = -0.22; R.blades[0].flap.rotation.y = 0.35; R.blades[0].snapped = true;
        R.tailBent = 1;
        R.ropes[0].visible = R.ropes[1].visible = false; R.sliders.count = 0;
      }
      if (R.tailBent) {
        N.tailSec.rotation.x += (0.22 - N.tailSec.rotation.x) * Math.min(1, dt * 4 + (snap ? 1 : 0));
        N.tailSec.rotation.y += (0.30 - N.tailSec.rotation.y) * Math.min(1, dt * 4 + (snap ? 1 : 0));
      }
    }
  }

  // which door gun a player's attack works: the one on the mark's side
  function moves(veh, tgt, ctx) {
    if (!veh || !tgt || !tgt.pos) return null;
    const rel = wrap(Math.atan2(tgt.pos.x - veh.pos.x, tgt.pos.z - veh.pos.z) - (veh.h || 0));
    const want = rel >= 0 ? 0 : 1;
    const R = veh.rig && veh.rig.state;
    const gi = R && R.gun[want].dead ? 1 - want : want;
    return GUNS[gi].id;
  }

  CBZ.unitKit.register("uh60_black_hawk", {
    kind: "vehicle",
    domain: "air",
    drive: "rotor",
    /* UH-60M: 9,980 kg max gross, 159 kt top (82 m/s), 150 kt cruise; nap of
       the earth at 10 m. Not armoured: rifle rounds go through the skin
       (2-3 mm of aluminium) and can find whoever sits behind it, but the
       airframe takes dozens of them in its systems (built tolerant to 7.62
       and 12.7 mm) before it goes down; an RPG or a cannon brings it down.
       The doctrine numbers (src/battle/vehicles.js stepRotor): carry the
       troops to a landing zone short of the enemy by 0.8 x dismountAt, hover
       at fastRope m and put them down the ropes, then work the area with the
       door guns from battle positions, turning a side (broadside rad) to the
       mark so a gun bears. */
    stats: { hp: 820, mass: 9980, speed: 82, accel: 6, turn: 0.9, alt: 30, nap: 10, climb: 8, popAlt: 45, popWindow: 9, popShots: 60,
      length: DIM.length, width: DIM.width, height: DIM.height,
      armour: { front: 3, side: 2, rear: 2, top: 2 },
      standoff: 420, dismountAt: 450,
      fastRope: ROPE.agl, ropeDelay: ROPE.delay, ropeEvery: ROPE.every, ropeSpeed: ROPE.speed, broadside: 1.1 },
    crew: [
      { seat: "pilot", pos: [-0.55, 1.75, 3.0] }, { seat: "copilot", pos: [0.55, 1.75, 3.0] },
      { seat: "gunner", pos: [-0.62, 1.75, 1.55] }, { seat: "crewchief", pos: [0.62, 1.75, 1.55] },
    ],
    passengers: 11,
    weapons: WEAPONS,
    tactics: {
      role: "lift",
      insert: "fastrope", ropeAGL: ROPE.agl,
      engage: { mg: 1100 },
      priorities: ["launcher", "mg", "men", "soft"],
      present: "broadside",          // a door gun bears abeam, not over the nose
      hullDown: false, faceThreat: false,
      screen: "the troops it put down",
    },
    build: build,
    animate: function (veh, dt, ctx) {
      const r = veh && veh.rig;
      if (r && r.state) { r.state.veh = veh; tick(r.state, false, dt, ctx); }
    },
    moves: moves,
  });
})();
