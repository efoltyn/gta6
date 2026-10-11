/* ============================================================
   units/vehicles/a400m.js — Airbus A400M Atlas tactical airlifter.

   Redrawn from scratch for NPC War (wave B). Before this file drew its own
   airframe the A400M was island_military.js's generic cargo plane (a tube,
   four grey crosses for propellers, no ramp, no doors) and it "airdropped"
   by having the battle drop its whole load onto the sand in a 30 m square
   under it, all in one tick: nobody ever left the aircraft. In node the
   build returned null and the battle stood a grey box in for it.

   THE AIRFRAME (real metres, nose +Z, port +X, wheels on y = 0). A400M
   figures: 45.1 m long, 42.4 m span, 14.7 m tall; a 5.64 m wide fuselage
   (cargo hold 17.71 m + 5.40 m ramp, 4.00 m wide, 3.85 m high); a high
   wing (221.5 m2, ~15 deg of sweep, a hair of anhedral) on a fairing over
   the hold; a T-tail. Four Europrop TP400-D6 turboprops (11,000 shp each)
   in long underslung nacelles with their chin intakes under the spinners
   and the exhausts turned up over the wing; Ratier-Figeac FH385/386
   propellers, 5.33 m, EIGHT scimitar composite blades, and the two on each
   wing turn opposite ways ("down between engines": the blades between the
   two nacelles both go down). Main gear: three legs a side, twin wheels,
   in sponsons on the lower fuselage, retracting straight up; a twin-wheel
   nose leg. Rear ramp + an upward-opening cargo door, two paratroop doors
   aft of the sponsons with the air deflectors ahead of them, the crew door
   forward to port, the refuelling probe over the cockpit, the DAS missile
   warners and flare dispensers, nav / beacon / strobe / formation lights.

   THE LOOK. The fuselage is ONE lofted superellipse hull (monotone cubic
   between measured stations) with the glazing cut out of it and the ramp,
   cargo door and paratroop doors made of the same skin on their own
   nodes, so they open as real panels over a real hold (liner, floor,
   rollers, troop seats). Every lifting surface is a NACA section loft
   built in this file (node-safe: no engine kit needed). Paint is the grey
   every A400M operator flies, with sun fade, belly grime, panel tone and
   exhaust soot over the wing baked per vertex; the side's flag is the fin
   flash and a fuselage flag on both sides. Every geometry and material is
   built once per page and shared by every airframe.

   THE RIG (on the battle clock, animate -> tick):
     props        four 8-blade propellers, opposite hands per wing, spinning
                  at a rate a camera shutter shows; a blur disc at speed; a
                  hit engine shuts down, feathers (blades edge-on) and stops
     airframe     banks to the real coordinated angle for its turn (capped at
                  30 deg, a transport's limit), sits a few degrees nose-up at
                  drop speed; ailerons, elevators and rudder follow the
                  motion; flaps run out for the drop
     gear         down on the ground (the studio), up into the sponsons and
                  the nose bay in flight
     the drop     doors open on the run-in (paratroop doors slide up, the
                  deflectors swing out, a jumpmaster in each door), then the
                  stick goes: one man out of each door alternately every
                  DROP.perDoor s, each a REAL man of the side flown down here:
                  out at the aircraft's speed, static line, canopy opening in
                  ~3 s, ~5.6 m/s under a round canopy drifting with the wind,
                  landing (a parachute landing fall), and he fights. A man shot
                  under his canopy dies there and falls; his canopy drifts on.
                  Canopies lie where they landed. Static lines stream from the
                  doors until the stick is out. A sortie with no troops aboard
                  drops four CDS supply bundles off the ramp under G-12s.
     defence      DAS flares in pairs on the run over the enemy, and a salvo
                  when something heavy hits it
     damage       smoke off a hit engine, flame when burning, fuel mist when
                  the wing is holed; dead, the props wind down and it falls;
                  on the ground the tail breaks off at the ramp, the outer
                  wings fold, the props bend and the paint burns.

   WEAPONS & ARMOUR. None: the Atlas carries no guns. Its skin is 2-3 mm of
   aluminium and composite (rifle rounds go straight through; it is built to
   take a great many of them), the cockpit floor and seats are armoured
   against 7.62 mm. What brings it down is a missile or a cannon.

   TACTICS. It flies in at drop height (stats.alt, 250 m: ~800 ft, a combat
   static-line jump), opens up, and the stick goes when the nearest enemy is
   stats.dismountAt out (the runtime's dismount trigger, thinkVehicle), so
   the men land short of the enemy's rifles and walk in, as a real drop zone
   is chosen. Then it goes home (stats.airdrop: egress).

   moves(veh, tgt, ctx): null. There is nothing on it a player can fire;
   taking it over you ride as crew and the drop is the jumpmasters'.

   COUPLING NOTE. The battle's vehDismount puts the passengers on the ground
   at once. This file then owns those same men from the door to the ground
   through physics.js's body-in-the-air state (`man._tossed`, the carried
   phase: a carry point this file moves, so the man is nobody else's while
   he is under the canopy, exactly as a thrown body is). It lands him through
   stepTossed's own landing (the impact, the PLF, getting up). Feature-
   detected: without `_tossed` support the men simply stay where the battle
   put them.

   Units: metres, m/s, kg; armour in mm RHA equivalent per face.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.unitKit) return;

  const PI = Math.PI, TAU = PI * 2, DEG = PI / 180;
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function wrap(a) { while (a > PI) a -= TAU; while (a < -PI) a += TAU; return a; }
  function smooth(e0, e1, x) { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); }

  // ---- the real numbers -------------------------------------------------------
  const DIM = { length: 45.1, span: 42.4, height: 14.7, fusW: 5.64, cgY: 4.2, propR: 2.665, propRpm: 842 };
  // the wing planform, root to tip: leading / trailing edge z, thickness/chord
  const WK = [
    { x: 0.0, le: 3.20, te: -4.60, tc: 0.165 },
    { x: 2.8, le: 2.95, te: -4.60, tc: 0.160 },
    { x: 7.0, le: 1.67, te: -4.75, tc: 0.150 },
    { x: 13.0, le: -0.17, te: -4.95, tc: 0.135 },
    { x: 21.2, le: -2.68, te: -5.30, tc: 0.120 },
  ];
  const WING_Y0 = 7.05, ANHEDRAL = 1.5 * DEG, WING_BREAK = 15.2;
  function wingY(x) { const ax = Math.abs(x); return WING_Y0 - Math.max(0, ax - 2.8) * Math.tan(ANHEDRAL); }
  function wingSt(x) {
    const ax = Math.abs(x);
    let a = WK[0], b = WK[WK.length - 1];
    for (let i = 0; i < WK.length - 1; i++) if (ax >= WK[i].x && ax <= WK[i + 1].x) { a = WK[i]; b = WK[i + 1]; break; }
    const t = b.x === a.x ? 0 : clamp((ax - a.x) / (b.x - a.x), 0, 1);
    const le = a.le + (b.le - a.le) * t, te = a.te + (b.te - a.te) * t;
    return { x: ax, le: le, c: le - te, tc: a.tc + (b.tc - a.tc) * t, y: wingY(ax) };
  }
  /* The engines, port first. `w` is the spin sign about +Z ("down between
     engines": port inboard and starboard outboard turn one way, the other
     two the other). The prop plane is 4.3 m ahead of the wing's leading
     edge; the thrust line 0.72 m under the wing's chord plane. */
  const ENG = [7.0, 13.0, -7.0, -13.0].map(function (x, i) {
    const st = wingSt(x), s = Math.sign(x), outboard = Math.abs(x) > 10;
    return { i: i, x: x, s: s, out: outboard, w: (s > 0) === outboard ? 1 : -1,
      zle: st.le, zte: st.le - st.c, zp: st.le + 4.3, ya: st.y - 0.72, yw: st.y };
  });
  // the stick: one man out of each door alternately; canopy physics
  const DROP = { perDoor: 0.6, lineT: 1.1, openT: 3.3, vDesc: 5.6, vBody: 52, push: 2.4, lineLen: 6.6,
    cdsDesc: 8.4, cdsEvery: 0.9, cdsN: 4 };
  const G0 = 9.81;
  // one wind for the page (every canopy in the sky drifts the same way)
  let WIND = null;
  function wind() {
    if (!WIND) { const a = Math.random() * TAU, s = 1.5 + Math.random() * 2.0; WIND = { x: Math.sin(a) * s, z: Math.cos(a) * s }; }
    return WIND;
  }

  // ---- the fuselage: superellipse stations ----------------------------------------
  // [z, half width, top y, bottom y, top exponent, bottom exponent]
  const FUS = [
    [22.30, 0.05, 3.80, 3.60, 2.0, 2.0],
    [22.10, 0.55, 4.25, 3.05, 2.0, 2.0],
    [21.70, 1.15, 4.78, 2.45, 2.1, 2.1],
    [21.00, 1.75, 5.32, 1.85, 2.2, 2.3],
    [20.20, 2.20, 5.78, 1.45, 2.3, 2.5],
    [19.20, 2.55, 6.25, 1.20, 2.4, 2.7],
    [18.00, 2.74, 6.62, 1.06, 2.4, 2.9],
    [16.60, 2.82, 6.80, 1.02, 2.3, 3.0],
    [14.50, 2.82, 6.82, 1.02, 2.25, 3.0],
    [-5.80, 2.82, 6.82, 1.02, 2.25, 3.0],
    [-7.40, 2.80, 6.82, 1.22, 2.25, 2.9],
    [-9.40, 2.68, 6.80, 1.85, 2.25, 2.7],
    [-11.80, 2.42, 6.76, 2.80, 2.2, 2.5],
    [-14.20, 2.05, 6.70, 3.75, 2.2, 2.4],
    [-16.60, 1.62, 6.62, 4.60, 2.1, 2.3],
    [-18.80, 1.15, 6.52, 5.25, 2.05, 2.2],
    [-20.60, 0.62, 6.40, 5.75, 2.0, 2.0],
    [-21.60, 0.12, 6.25, 6.02, 2.0, 2.0],
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
  function surf(z, th, off, out) {
    const S = station(z), c = Math.cos(th), sn = Math.sin(th), e = sn >= 0 ? S.p : S.pb;
    const cy = (S.yt + S.yb) / 2, hh = (S.yt - S.yb) / 2, ex = 2 / e;
    out[0] = (S.w + off) * Math.sign(c) * Math.pow(Math.abs(c), ex);
    out[1] = cy + (hh + off) * Math.sign(sn) * Math.pow(Math.abs(sn), ex);
    out[2] = z;
    return out;
  }
  // the hull's half width at height y on station z (the side skin)
  function sideX(z, y) {
    const S = station(z), cy = (S.yt + S.yb) / 2, hh = (S.yt - S.yb) / 2;
    const e = y >= cy ? S.p : S.pb;
    const sn = Math.min(1, Math.pow(Math.min(1, Math.abs(y - cy) / hh), e / 2));
    const c = Math.sqrt(Math.max(0, 1 - sn * sn));
    return S.w * Math.pow(c, 2 / e);
  }

  // ---- what each quad of skin is ---------------------------------------------------
  const RAMP = { z0: -6.40, z1: -11.85, hw: 2.05, up: 1.15 };
  const CDOOR = { z0: -11.85, z1: -16.55, hw: 1.95, up: 1.25 };
  const PDOOR = { z0: -6.32, z1: -5.24, y0: 1.86, y1: 3.80 };
  const TAILBREAK = -11.85;
  function zoneOf(x, y, z) {
    const ax = Math.abs(x);
    // the flight deck glazing: side windows, the windscreen, the posts
    if (z > 17.35 && z < 20.85 && y > 5.18 && y < (z < 19.15 ? 6.30 : 6.47)) {
      if (Math.abs(z - 18.25) < 0.08 || Math.abs(z - 19.15) < 0.10 || ax < 0.08 || (z > 19.15 && Math.abs(ax - 1.30) < 0.08)) return ["body", "frame"];
      return ["body", "glass"];
    }
    // the paratroop doors (their own nodes, the same skin)
    if (z > PDOOR.z0 && z < PDOOR.z1 && y > PDOOR.y0 && y < PDOOR.y1 && ax > 1.5) return [x > 0 ? "pdoorL" : "pdoorR", "paint"];
    const S = station(z);
    if (z < RAMP.z0 && z > RAMP.z1 && ax < RAMP.hw && y < S.yb + RAMP.up) return ["ramp", "paint"];
    if (z <= CDOOR.z0 && z > CDOOR.z1 && ax < CDOOR.hw && y < S.yb + CDOOR.up) return ["cdoor", "paint"];
    return [z < TAILBREAK ? "aft" : "body", "paint"];
  }

  // nodes: name -> [parent, model-space origin]
  const NODES = {
    body: [null, [0, 0, 0]],
    aft: ["body", [0, 6.0, TAILBREAK]],
    wingOutL: ["body", [WING_BREAK, wingY(WING_BREAK), wingSt(WING_BREAK).le - 0.4 * wingSt(WING_BREAK).c]],
    wingOutR: ["body", [-WING_BREAK, wingY(WING_BREAK), wingSt(WING_BREAK).le - 0.4 * wingSt(WING_BREAK).c]],
    ramp: ["body", [0, 1.32, RAMP.z0]],
    cdoor: ["aft", [0, 5.55, CDOOR.z1 + 0.10]],
    pdoorL: ["body", [2.6, 2.8, (PDOOR.z0 + PDOOR.z1) / 2]],
    pdoorR: ["body", [-2.6, 2.8, (PDOOR.z0 + PDOOR.z1) / 2]],
    deflL: ["body", [2.72, 2.8, PDOOR.z1 + 0.10]],
    deflR: ["body", [-2.72, 2.8, PDOOR.z1 + 0.10]],
    gearL: ["body", [2.55, 0.62, -0.40]],
    gearR: ["body", [-2.55, 0.62, -0.40]],
    gearN: ["body", [0, 0.46, 18.10]],
    jumpL: ["body", [2.2, 1.6, -5.78]],
    jumpR: ["body", [-2.2, 1.6, -5.78]],
    linesL: ["body", [2.85, 3.70, -5.40]],
    linesR: ["body", [-2.85, 3.70, -5.40]],
  };
  // the control surfaces: [node, parent, side, x0, x1, chord fraction of the hinge]
  const SURF = [
    ["flapL1", "body", 1, 2.95, 8.4, 0.735], ["flapL2", "body", 1, 8.4, 14.6, 0.735],
    ["flapR1", "body", -1, 2.95, 8.4, 0.735], ["flapR2", "body", -1, 8.4, 14.6, 0.735],
    ["ailL", "wingOutL", 1, 15.3, 20.6, 0.74], ["ailR", "wingOutR", -1, 15.3, 20.6, 0.74],
  ];
  function hingePt(x, frac) { const st = wingSt(x); return [x, st.y, st.le - frac * st.c]; }
  (function () {
    SURF.forEach(function (s) {
      const p0 = hingePt(s[3], s[5]);
      NODES[s[0]] = [s[1], [s[2] * p0[0], p0[1], p0[2]]];
    });
    ENG.forEach(function (e) { NODES["prop" + e.i] = ["body", [e.x, e.ya, e.zp]]; });
  })();
  // the tail: fin (x = height above FIN_Y0), the tailplane on top
  const FIN_Y0 = 6.30, FIN_H = 8.05, TP_Y = FIN_Y0 + FIN_H + 0.02;
  const FINK = [{ x: 0, le: -8.6, c: 10.0, tc: 0.12 }, { x: 0.9, le: -9.9, c: 8.9, tc: 0.12 }, { x: FIN_H, le: -15.4, c: 5.3, tc: 0.11 }];
  const TPK = [{ x: 0, le: -15.3, c: 5.6, tc: 0.10 }, { x: 9.8, le: -19.85, c: 2.7, tc: 0.09 }];
  function lerpK(K, x) {
    let a = K[0], b = K[K.length - 1];
    for (let i = 0; i < K.length - 1; i++) if (x >= K[i].x && x <= K[i + 1].x) { a = K[i]; b = K[i + 1]; break; }
    const t = b.x === a.x ? 0 : clamp((x - a.x) / (b.x - a.x), 0, 1);
    return { x: x, le: a.le + (b.le - a.le) * t, c: a.c + (b.c - a.c) * t, tc: a.tc + (b.tc - a.tc) * t, y: 0 };
  }
  (function () {
    const r0 = lerpK(FINK, 0.6), r1 = lerpK(FINK, FIN_H - 0.3);
    NODES.rudder = ["aft", [0, FIN_Y0 + 0.6, r0.le - 0.70 * r0.c]];
    NODES._rudTop = [null, [0, FIN_Y0 + FIN_H - 0.3, r1.le - 0.70 * r1.c]];
    const e0 = lerpK(TPK, 0.6);
    NODES.elevL = ["aft", [0.6, TP_Y, e0.le - 0.70 * e0.c]];
    NODES.elevR = ["aft", [-0.6, TP_Y, e0.le - 0.70 * e0.c]];
  })();

  // =====================================================================
  //  THE TEMPLATE: every geometry built once per page
  // =====================================================================
  const RGB = function (hex) { return [(hex >> 16 & 255) / 255, (hex >> 8 & 255) / 255, (hex & 255) / 255]; };
  const C = {
    seam: 0x55595d, frame: 0x24282b, gunmetal: 0x3a3d40, black: 0x0c0d0e, rubber: 0x161718, steel: 0x7a7f83,
    interior: 0x56604f, floor: 0x2f3234, roller: 0x8a8d8f, seat: 0x7a2a22, webbing: 0x6a5a3a,
    panel: 0x18191a, screen: 0x1b2a2e, prop: 0x2a2d30, propEdge: 0x6b6e70, intake: 0x101112, soot: 0x2a2624,
    canopy: 0x5c5b40, line: 0x9a9680, crate: 0x5b5640, strap: 0x2f2b20, pallet: 0x7a6a4a,
    suit: 0x5b6050, vest: 0x4a4c3c, helmet: 0x4a4e3e, visor: 0x101213, skin: 0xa77f63, glove: 0x2a2924, boot: 0x3e3428,
  };
  const PAINT = 0x6f767c;           // the grey every Atlas operator flies (RAL 7001-ish)
  const BURNT = 0x2b2927;

  // paint shading: sun-faded tops, grimy belly, panel tone, exhaust soot
  function weather(x, y, z, ny) {
    let k = 1 + 0.07 * Math.max(0, ny) - 0.10 * Math.max(0, -ny);
    k *= 1 + 0.028 * Math.sin(x * 1.3 + z * 0.9) * Math.sin(y * 2.1 - z * 0.7);
    if (y < 1.7 && Math.abs(x) < 3.6) k *= 0.91;
    // the TP400 exhaust blows up and aft over the wing's upper surface
    for (let i = 0; i < ENG.length; i++) {
      const e = ENG[i], ex = e.x + e.s * 0.55;
      if (y < e.yw - 0.25 || z > e.zle + 0.3 || Math.sign(x) !== e.s) continue;
      const dx = x - ex, dz = e.zle + 0.3 - z;
      k *= 1 - 0.5 * Math.exp(-(dx * dx) / (0.35 + dz * 0.06)) * Math.exp(-dz / 5.5) * clamp(dz * 2, 0, 1);
    }
    // oil / hydraulic weep below the nacelles, ramp hinge grime
    if (Math.abs(z - RAMP.z0) < 0.6 && y < 1.6) k *= 0.88;
    return k;
  }

  let TPL = null;
  function template() {
    if (TPL) return TPL;
    const THREE = window.THREE;
    if (!THREE || !THREE.BufferGeometry) return null;
    const BK = Object.create(null);
    const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3();

    // ---- primitives (own, so node builds the real airframe too) ----------------
    function xm(g, M) {
      g.applyMatrix4(M);
      if (M.determinant() < 0 && g.index) { const a = g.index.array; for (let i = 0; i < a.length; i += 3) { const t = a[i + 1]; a[i + 1] = a[i + 2]; a[i + 2] = t; } g.index.needsUpdate = true; }
      return g;
    }
    function at(g, x, y, z, rx, ry, rz, sx, sy, sz) {
      _q.setFromEuler(_e.set(rx || 0, ry || 0, rz || 0));
      _m4.compose(_v.set(x || 0, y || 0, z || 0), _q, _s.set(sx == null ? 1 : sx, sy == null ? 1 : sy, sz == null ? 1 : sz));
      return xm(g, _m4);
    }
    function mir(g) { return xm(g.clone(), new THREE.Matrix4().makeScale(-1, 1, 1)); }
    function box(w, h, d) { return new THREE.BoxGeometry(w, h, d); }
    function cylY(r0, r1, h, seg) { return new THREE.CylinderGeometry(r1, r0, h, seg || 14); }
    function cylZ(r, h, seg) { return at(new THREE.CylinderGeometry(r, r, h, seg || 12), 0, 0, 0, PI / 2); }
    function cylX(r, h, seg) { return at(new THREE.CylinderGeometry(r, r, h, seg || 12), 0, 0, 0, 0, 0, PI / 2); }
    function sph(r, ws, hs) { return new THREE.SphereGeometry(r, ws || 12, hs || 8); }
    function rod(a, b, r, seg) {
      const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], L = Math.hypot(dx, dy, dz) || 1e-3;
      const g = new THREE.CylinderGeometry(r, r, L, seg || 8);
      _q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(dx / L, dy / L, dz / L));
      _m4.compose(_v.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), _q, _s.set(1, 1, 1));
      return xm(g, _m4);
    }
    // a flat slab between two points (centre line), width along X
    function slab(a, b, w, t) {
      const dy = b[1] - a[1], dz = b[2] - a[2], L = Math.hypot(dy, dz);
      const g = box(w, t, L);
      // the box's +Z onto (0, dy, dz): a turn about X of atan2(-dy, dz)
      return at(g, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2, Math.atan2(-dy, dz), 0, 0);
    }
    function mkGeo(pos, idx) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      return g;
    }
    function triN(P, a, b, c) {
      const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2];
      const vx = P[c * 3] - P[a * 3], vy = P[c * 3 + 1] - P[a * 3 + 1], vz = P[c * 3 + 2] - P[a * 3 + 2];
      return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
    }
    function flipIdx(idx, a, b) { for (let i = a; i < b; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; } }
    /* A NACA 00xx LOFT along X (the span). Stations {x, le, c, tc, y}; the
       chord runs from le toward -Z. `a..b` is the slice of the chord to build
       (0..0.72 = the wing box ahead of the flap, 0.735..1 = the flap): the
       section is a closed ring, so a cut chord gets its own blunt face. */
    function naca(x) { return 5 * (0.2969 * Math.sqrt(x) - 0.1260 * x - 0.3516 * x * x + 0.2843 * x * x * x - 0.1036 * x * x * x * x); }
    function foil(st, o) {
      o = o || {};
      const a = o.a || 0, b = o.b == null ? 1 : o.b, K = o.K || 7;
      const xs = [];
      for (let k = 0; k <= K; k++) xs.push(a + (b - a) * 0.5 * (1 - Math.cos(PI * k / K)));
      const m = 2 * (K + 1), pos = [], idx = [];
      for (let i = 0; i < st.length; i++) {
        const s = st[i];
        for (let q = 0; q < m; q++) {
          const top = q <= K, k = top ? q : (2 * K + 1 - q), xc = xs[k];
          const ht = Math.max(0.0015, naca(Math.max(0, xc)) * s.tc * s.c);
          pos.push(s.x, (s.y || 0) + (top ? ht : -ht), s.le - xc * s.c);
        }
      }
      for (let i = 0; i < st.length - 1; i++) for (let q = 0; q < m; q++) {
        const p = i * m + q, r = i * m + (q + 1) % m;
        idx.push(p, p + m, r, r, p + m, r + m);
      }
      const tq = Math.max(1, K >> 1), nn = triN(pos, tq, tq + m, tq + 1);
      if (nn[1] < 0) flipIdx(idx, 0, idx.length);
      for (let e = 0; e < 2; e++) {
        if (e === 0 && o.root === false) continue;
        if (e === 1 && o.tip === false) continue;
        const i = e ? st.length - 1 : 0, base = i * m;
        let cx = 0, cy = 0, cz = 0;
        for (let q = 0; q < m; q++) { cx += pos[(base + q) * 3]; cy += pos[(base + q) * 3 + 1]; cz += pos[(base + q) * 3 + 2]; }
        const ci = pos.length / 3; pos.push(cx / m, cy / m, cz / m);
        const i0 = idx.length;
        for (let q = 0; q < m; q++) idx.push(ci, base + q, base + (q + 1) % m);
        const dir = (st[st.length - 1].x - st[0].x) * (e ? 1 : -1);
        const n2 = triN(pos, idx[i0], idx[i0 + 1], idx[i0 + 2]);
        if (n2[0] * dir < 0) flipIdx(idx, i0, idx.length);
      }
      return mkGeo(pos, idx);
    }
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
      if (st[0].z < st[st.length - 1].z) flipIdx(idx, 0, idx.length);
      if (caps !== false) {
        for (let e = 0; e < 2; e++) {
          const i = e ? st.length - 1 : 0, s = st[i];
          const ci = pos.length / 3; pos.push(s.x || 0, s.y || 0, s.z);
          const i0 = idx.length;
          for (let j = 0; j < n; j++) { const a = i * n + j, b = i * n + (j + 1) % n; idx.push(ci, a, b); }
          const want = (e ? 1 : -1) * Math.sign(st[st.length - 1].z - st[0].z || -1);
          const n2 = triN(pos, idx[i0], idx[i0 + 1], idx[i0 + 2]);
          if (n2[2] * want < 0) flipIdx(idx, i0, idx.length);
        }
      }
      return mkGeo(pos, idx);
    }

    // ---- colour + buckets ------------------------------------------------------
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
    const BUCKETS = ["paint", "vc", "glass", "lamp", "beacon", "strobe"];
    function put(node, g, col, bucket) {
      if (!g) return;
      if (Array.isArray(g)) { for (let i = 0; i < g.length; i++) put(node, g[i], col, bucket); return; }
      if (!g.attributes.normal) g.computeVertexNormals();
      if (!bucket) bucket = col === "paint" || (col && typeof col === "object") ? "paint" : "vc";
      if (bucket !== "glass") colour(g, col == null ? 0xffffff : col);
      const o = NODES[node][1];
      if (o[0] || o[1] || o[2]) g.translate(-o[0], -o[1], -o[2]);
      let b = BK[node];
      if (!b) { b = BK[node] = {}; BUCKETS.forEach(function (k) { b[k] = []; }); }
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
        const p = g.attributes.position, n = g.attributes.normal;
        P.set(p.array, vo * 3);
        if (n) N.set(n.array, vo * 3);
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

    // =================================================================
    //  THE HULL SKIN
    // =================================================================
    const NR = 64;
    const _p = [0, 0, 0];
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
        const key = r[0] + "|" + r[1];
        const L = out[key] || (out[key] = { node: r[0], bucket: r[1], p: [], n: [] });
        for (let q = 0; q < 6; q++) {
          const v = idx[t + q];
          L.p.push(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]);
          L.n.push(Nn[v * 3], Nn[v * 3 + 1], Nn[v * 3 + 2]);
        }
      }
      const list = [];
      for (const k in out) {
        const L = out[k], gg = new THREE.BufferGeometry();
        gg.setAttribute("position", new THREE.Float32BufferAttribute(L.p, 3));
        gg.setAttribute("normal", new THREE.Float32BufferAttribute(L.n, 3));
        list.push({ node: L.node, bucket: L.bucket, g: gg });
      }
      g.dispose();
      return list;
    }
    hullLoft(22.30, -21.60, 0.22, 0, zoneOf).forEach(function (r) {
      if (r.bucket === "glass") put(r.node, r.g, null, "glass");
      else if (r.bucket === "frame") put(r.node, r.g, C.frame, "vc");
      else put(r.node, r.g, "paint", "paint");
    });
    // the hold liner (seen through the open ramp and doors): cargo section only
    hullLoft(16.4, -16.4, 0.5, -0.14, function (x, y, z) {
      if (y < 1.45) return null;
      return [z < TAILBREAK ? "aft" : "body", "vc"];
    }, true).forEach(function (r) { put(r.node, r.g, C.interior, "vc"); });
    // the radome joint, frames every few metres, the tail joint
    [21.55, 16.8, 13.2, 9.6, 6.0, 2.4, -1.2, -4.8, -8.4, -13.6, -17.2, -19.9].forEach(function (z) {
      hullLoft(z + 0.016, z - 0.016, 0.032, 0.006, function (x, y, zz) {
        const r = zoneOf(x, y, zz);
        if (!r || r[1] === "glass" || r[1] === "frame") return null;
        return [r[0], "vc"];
      }).forEach(function (r) { put(r.node, r.g, C.seam, "vc"); });
    });
    // seam lines drawn on the skin: an outline (z0..z1 x y0..y1) on one side
    function outline(node, side, z0, z1, y0, y1, r) {
      const out = [], n = 6;
      function P(z, y) { return [side * (sideX(z, y) + 0.008), y, z]; }
      for (let i = 0; i < n; i++) {
        const za = z0 + (z1 - z0) * i / n, zb = z0 + (z1 - z0) * (i + 1) / n;
        out.push(rod(P(za, y0), P(zb, y0), r, 4), rod(P(za, y1), P(zb, y1), r, 4));
        const ya = y0 + (y1 - y0) * i / n, yb = y0 + (y1 - y0) * (i + 1) / n;
        out.push(rod(P(z0, ya), P(z0, yb), r, 4), rod(P(z1, ya), P(z1, yb), r, 4));
      }
      put(node, out, C.seam);
    }
    // crew door (port, forward), the paratroop door frames, emergency exits
    outline("body", 1, 14.25, 15.25, 1.75, 3.85, 0.02);
    [1, -1].forEach(function (s) {
      outline("body", s, PDOOR.z0 - 0.04, PDOOR.z1 + 0.04, PDOOR.y0 - 0.04, PDOOR.y1 + 0.04, 0.025);
      outline("body", s, 9.1, 9.75, 3.3, 4.2, 0.015);
      outline("body", s, -2.6, -1.95, 3.3, 4.2, 0.015);
      // the lap line along the hold and the ramp's edge seams
      const lap = [];
      for (let z = 16.2; z > -5.6; z -= 1.2) lap.push(rod([s * (sideX(z, 4.55) + 0.006), 4.55, z], [s * (sideX(z - 1.2, 4.55) + 0.006), 4.55, z - 1.2], 0.012, 4));
      put("body", lap, C.seam);
      const edge = [];
      for (let z = RAMP.z0; z > CDOOR.z1; z -= 0.5) {
        const zz = Math.max(CDOOR.z1, z - 0.5);
        const hw = z > RAMP.z1 ? RAMP.hw : CDOOR.hw, hw2 = zz > RAMP.z1 ? RAMP.hw : CDOOR.hw;
        const Sa = station(z).yb, Sb = station(zz).yb;
        const ya = Sa + (z > RAMP.z1 ? 0.35 : 0.45), yb = Sb + (zz > RAMP.z1 ? 0.35 : 0.45);
        edge.push(rod([s * hw, ya, z], [s * hw2, yb, zz], 0.022, 4));
      }
      put("body", edge.slice(0, Math.ceil((RAMP.z0 - RAMP.z1) / 0.5)), C.seam);
      put("aft", edge.slice(Math.ceil((RAMP.z0 - RAMP.z1) / 0.5)), C.seam);
    });
    // cabin windows: small round ports along the hold
    [12.4, 9.7, 6.1, -0.2, -3.1].forEach(function (z) {
      [1, -1].forEach(function (s) {
        const y = 4.25, x = s * (sideX(z, y) + 0.01);
        put("body", at(new THREE.CircleGeometry(0.17, 14), x, y, z, 0, s * PI / 2, 0), null, "glass");
        put("body", at(new THREE.TorusGeometry(0.18, 0.025, 4, 16), x, y, z, 0, s * PI / 2, 0), C.seam);
      });
    });

    // ---- hold: floor, rollers, troop seats, bulkheads ------------------------------
    put("body", at(box(4.0, 0.10, 21.2), 0, 1.50, 4.2), C.floor);
    for (let k = -1; k <= 1; k += 2) for (let j = 0; j < 2; j++) {
      put("body", at(box(0.22, 0.06, 20.6), k * (0.55 + j * 1.1), 1.58, 4.2), C.gunmetal);
    }
    [1, -1].forEach(function (s) {
      // sidewall troop seats (red webbing): a seat pan and a back strip, end to end
      put("body", [at(box(0.42, 0.05, 18.2), s * 1.72, 2.02, 3.6), at(box(0.04, 0.62, 18.2), s * 1.96, 2.40, 3.6)], C.seat);
      put("body", [at(box(0.38, 0.05, 18.2), s * 0.42, 2.02, 3.6), at(box(0.04, 0.62, 18.2), s * 0.20, 2.40, 3.6)], C.webbing);
    });
    put("body", at(box(4.6, 3.6, 0.10), 0, 3.35, 15.0), C.interior);          // flight deck / hold bulkhead

    // ---- the cockpit: panel, glareshield, pedestal, seats, the crew --------------------
    put("body", [at(box(3.2, 0.62, 0.20), 0, 5.12, 19.55, -0.35), at(box(3.1, 0.10, 0.50), 0, 5.50, 19.40, -0.12),
      at(box(0.62, 0.40, 1.30), 0, 4.62, 18.65), at(box(1.6, 0.14, 0.9), 0, 6.42, 18.35)], C.panel);
    [-1, 1].forEach(function (s) {
      for (let k = 0; k < 3; k++) put("body", at(box(0.36, 0.30, 0.02), s * (0.45 + k * 0.42), 5.15, 19.66, -0.35), C.screen);
      put("body", [at(box(0.58, 0.10, 0.55), s * 0.75, 4.62, 18.30), at(box(0.60, 0.80, 0.10), s * 0.75, 5.05, 17.98, 0.12)], C.gunmetal);
      put("body", rod([s * 1.15, 4.70, 18.75], [s * 1.18, 5.00, 18.85], 0.025, 6), C.black);     // the side stick
    });
    put("body", at(box(3.4, 0.08, 3.0), 0, 4.35, 18.5), C.floor);
    put("body", figure("pilot", 0.75, 4.67, 18.30, 0));
    put("body", figure("pilot", -0.75, 4.67, 18.30, 0));

    // ---- the wing-body fairing, the dorsal fin, sponsons ---------------------------------
    put("body", sloft([{ z: 5.0, y: 6.70, w: 0.25, t: 0.05, b: 0.05, p: 2.6 }, { z: 4.0, y: 6.70, w: 1.9, t: 0.70, b: 0.10, p: 2.8 },
      { z: 1.6, y: 6.70, w: 2.6, t: 1.02, b: 0.10, p: 3.0 }, { z: -3.0, y: 6.70, w: 2.6, t: 1.00, b: 0.10, p: 3.0 },
      { z: -6.0, y: 6.70, w: 2.0, t: 0.62, b: 0.10, p: 2.8 }, { z: -8.6, y: 6.68, w: 0.9, t: 0.12, b: 0.08, p: 2.4 }], 32), "paint");
    put("body", sloft([{ z: -5.8, y: 6.74, w: 0.06, t: 0.02, b: 0.02 }, { z: -8.2, y: 6.74, w: 0.30, t: 0.40, b: 0.05, p: 2.2 },
      { z: -9.4, y: 6.74, w: 0.42, t: 0.95, b: 0.05, p: 2.2 }, { z: -10.6, y: 6.72, w: 0.44, t: 1.30, b: 0.05, p: 2.2 }], 14), "paint");
    [1, -1].forEach(function (s) {
      // the sponson: a long blended fairing on the lower side, not a pod
      put("body", sloft([{ z: 4.4, x: s * 2.30, y: 1.95, w: 0.10, t: 0.20, b: 0.15, p: 2.2 },
        { z: 3.7, x: s * 2.40, y: 1.95, w: 0.55, t: 0.95, b: 0.86, p: 2.4 },
        { z: 2.6, x: s * 2.48, y: 1.95, w: 0.80, t: 1.15, b: 1.02, p: 2.8 },
        { z: -3.6, x: s * 2.48, y: 1.95, w: 0.80, t: 1.15, b: 1.02, p: 2.8 },
        { z: -4.7, x: s * 2.42, y: 2.00, w: 0.58, t: 0.95, b: 0.86, p: 2.4 },
        { z: -5.25, x: s * 2.32, y: 2.10, w: 0.12, t: 0.25, b: 0.25, p: 2.2 }], 28), "paint");
      // the gear bay slots in the sponson belly
      put("body", at(box(0.95, 0.02, 6.2), s * 2.55, 0.925, -0.4), C.black);
      // DAS: flare dispensers aft on the sponson, the missile warners
      put("body", at(box(0.10, 0.34, 0.60), s * 3.30, 1.35, -4.1), C.gunmetal);
      put("body", [at(sph(0.12, 10, 6), s * 3.36, 1.90, 3.0), at(sph(0.12, 10, 6), s * 1.85, 3.0, 20.35), at(sph(0.10, 10, 6), s * 0.55, 5.95, -20.4)], C.black);
      // pitot probes, the nose's static ports
      put("body", [rod([s * 1.55, 3.55, 20.65], [s * 1.78, 3.55, 21.10], 0.022, 6), rod([s * 1.95, 3.20, 20.35], [s * 2.18, 3.20, 20.70], 0.02, 6)], C.steel);
    });
    // refuelling probe over the cockpit, blade antennas, the tail cone's light
    put("body", [rod([0.0, 6.72, 16.2], [0.0, 7.08, 21.8], 0.07, 10), at(cylZ(0.11, 0.30, 10), 0.0, 7.09, 21.85)], C.gunmetal);
    put("body", at(box(0.26, 0.16, 0.9), 0.0, 6.82, 16.6), "paint");
    [[0, 6.82, 12.0, 0.45], [0, 6.82, 7.4, 0.35], [0, 1.0, 10.5, -0.3], [0, 1.0, -2.0, -0.35], [0.0, 7.70, -2.4, 0.30]].forEach(function (a) {
      put("body", at(box(0.02, Math.abs(a[3]), 0.28), a[0], a[1] + a[3] / 2, a[2], 0.25 * Math.sign(a[3]), 0, 0), C.gunmetal);
    });

    // ---- the wings ---------------------------------------------------------------------
    function wingRange(x0, x1, n) {
      const out = [];
      for (let i = 0; i <= n; i++) out.push(wingSt(x0 + (x1 - x0) * i / n));
      return out;
    }
    const knotsIn = [0, 2.8, 7.0, 13.0, WING_BREAK].map(wingSt);
    const knotsOut = [WING_BREAK, 21.2].map(wingSt);
    const wIn = foil(knotsIn, { a: 0, b: 0.72, K: 8 });
    const wInTE = foil([0, 2.95].map(wingSt), { a: 0.72, b: 1, K: 4 });      // the fixed root trailing edge inside the fairing
    put("body", [wIn, mir(wIn)], "paint");
    put("body", [wInTE, mir(wInTE)], "paint");
    const wOut = foil(knotsOut, { a: 0, b: 0.72, K: 8, root: false });
    const wOutM = mir(wOut);
    put("wingOutL", wOut, "paint");
    put("wingOutR", wOutM, "paint");
    // the outboard trailing edge past the aileron (fixed)
    const tipTE = foil(wingRange(20.6, 21.2, 1), { a: 0.72, b: 1, K: 3 });
    const tipTEm = mir(tipTE); put("wingOutL", tipTE, "paint"); put("wingOutR", tipTEm, "paint");
    // flaps and ailerons
    SURF.forEach(function (sf) {
      const g = foil(wingRange(sf[3], sf[4], 3), { a: sf[5], b: 1, K: 5 });
      put(sf[0], sf[2] > 0 ? g : mir(g), { paint: 0.97 });
      // static dischargers on the ailerons
      if (sf[0].indexOf("ail") === 0) {
        const d = [];
        [16.4, 18.2, 20.0].forEach(function (x) { const st = wingSt(x); d.push(rod([sf[2] * x, st.y, st.le - st.c + 0.02], [sf[2] * x, st.y, st.le - st.c - 0.16], 0.008, 4)); });
        put(sf[0], d, C.black);
      }
    });
    // the wing tip cap light fairings, walkway lines, flap track canoes
    [1, -1].forEach(function (s) {
      const node = s > 0 ? "wingOutL" : "wingOutR";
      const tip = wingSt(21.2);
      put(node, at(box(0.12, 0.10, 0.42), s * 21.24, tip.y, tip.le - 0.35), C.gunmetal);
      put(node, at(sph(0.07, 8, 6), s * 21.30, tip.y, tip.le - 0.30), s > 0 ? 0xff2a1e : 0x2ad070, "lamp");
      put(node, at(sph(0.06, 8, 6), s * 21.28, tip.y + 0.02, tip.le - tip.c + 0.15), 0xffffff, "strobe");
      const walk = [];
      [[3.2, 6.0], [7.8, 11.8]].forEach(function (r) {
        [0.18, 0.50].forEach(function (f) {
          const a = wingSt(r[0]), b = wingSt(r[1]);
          walk.push(rod([s * r[0], a.y + naca(f) * a.tc * a.c + 0.005, a.le - f * a.c], [s * r[1], b.y + naca(f) * b.tc * b.c + 0.005, b.le - f * b.c], 0.018, 3));
        });
      });
      put("body", walk, 0x3e4245);
      [4.6, 9.9, 14.3].forEach(function (x) {
        const st = wingSt(x), zt = st.le - st.c;
        put("body", sloft([{ z: st.le - 0.45 * st.c, x: s * x, y: st.y - 0.25, w: 0.05, t: 0.05, b: 0.05 },
          { z: st.le - 0.62 * st.c, x: s * x, y: st.y - 0.30, w: 0.17, t: 0.18, b: 0.26, p: 2.2 },
          { z: zt - 0.10, x: s * x, y: st.y - 0.32, w: 0.15, t: 0.14, b: 0.24, p: 2.2 },
          { z: zt - 1.15, x: s * x, y: st.y - 0.28, w: 0.04, t: 0.04, b: 0.06, p: 2 }], 12), { paint: 0.96 });
      });
      // landing light in the wing root leading edge
      const r0 = wingSt(3.2);
      put("body", at(sph(0.10, 8, 6), s * 3.2, r0.y - 0.05, r0.le + 0.02), 0xfff6d8, "lamp");
    });

    // ---- the nacelles ------------------------------------------------------------------
    ENG.forEach(function (e) {
      const node = Math.abs(e.x) > WING_BREAK ? (e.s > 0 ? "wingOutL" : "wingOutR") : "body";
      const x = e.x, y = e.ya, zp = e.zp;
      put(node, sloft([
        { z: zp - 0.10, x: x, y: y, w: 0.60, t: 0.60, b: 0.62, p: 2.0 },
        { z: zp - 0.55, x: x, y: y - 0.08, w: 0.70, t: 0.70, b: 0.92, p: 2.15 },
        { z: zp - 1.60, x: x, y: y - 0.08, w: 0.78, t: 0.78, b: 1.04, p: 2.3 },
        { z: e.zle - 0.20, x: x, y: y - 0.05, w: 0.80, t: 0.82, b: 1.04, p: 2.4 },
        { z: e.zle - 2.20, x: x, y: y - 0.10, w: 0.72, t: 0.82, b: 0.92, p: 2.4 },
        { z: e.zte + 0.20, x: x, y: y - 0.05, w: 0.50, t: 0.72, b: 0.62, p: 2.2 },
        { z: e.zte - 1.40, x: x, y: y + 0.18, w: 0.14, t: 0.28, b: 0.16, p: 2.0 }], 30, false), "paint");
      // chin intake under the spinner: dark throat + lip
      const iy = y - 0.70;
      put(node, at(sloft([{ z: zp - 0.30, x: 0, y: 0, w: 0.40, t: 0.20, b: 0.22, p: 2.6 }, { z: zp - 0.42, x: 0, y: 0, w: 0.36, t: 0.16, b: 0.18, p: 2.6 }], 18), x, iy, 0), C.intake);
      put(node, at(new THREE.TorusGeometry(0.40, 0.045, 5, 22), x, iy, zp - 0.28, 0, 0, 0, 1, 0.52, 1), "paint");
      // the oil cooler scoop on the nacelle's flank, panel seams, hinge lines
      put(node, at(box(0.10, 0.30, 0.55), x + e.s * 0.74, y - 0.35, zp - 1.4), C.gunmetal);
      put(node, [rod([x + 0.80 * e.s, y - 0.1, zp - 0.9], [x + 0.80 * e.s, y - 0.1, e.zle - 1.0], 0.012, 4),
        rod([x - 0.80 * e.s, y - 0.1, zp - 0.9], [x - 0.80 * e.s, y - 0.1, e.zle - 1.0], 0.012, 4)], C.seam);
      for (const dz of [-0.9, -2.6]) put(node, at(new THREE.TorusGeometry(0.79, 0.012, 4, 30), x, y - 0.08, zp + dz, 0, 0, 0, 1, 1.18, 1), C.seam);
      // the exhaust stack: out of the nacelle top, turned up and aft over the wing
      const ex = x + e.s * 0.55;
      put(node, sloft([{ z: e.zle + 1.30, x: ex - e.s * 0.15, y: y + 0.30, w: 0.26, t: 0.30, b: 0.26 },
        { z: e.zle + 0.40, x: ex, y: y + 0.62, w: 0.30, t: 0.33, b: 0.30 },
        { z: e.zle - 0.25, x: ex + e.s * 0.06, y: e.yw + 0.42, w: 0.31, t: 0.34, b: 0.30 }], 18, false), { paint: 0.82 });
      put(node, sloft([{ z: e.zle - 0.22, x: ex + e.s * 0.06, y: e.yw + 0.42, w: 0.27, t: 0.30, b: 0.26 }, { z: e.zle - 0.28, x: ex + e.s * 0.06, y: e.yw + 0.42, w: 0.27, t: 0.30, b: 0.26 }], 18), C.soot);
    });

    // ---- the tail: fin, rudder, tailplane, elevators --------------------------------------
    {
      const finSt = [0, 0.9, FIN_H].map(function (h) { return lerpK(FINK, h); });
      const fin = foil(finSt, { a: 0, b: 0.70, K: 8 });
      at(fin, 0, FIN_Y0, 0, 0, 0, PI / 2);
      put("aft", fin, "paint");
      const finTE = foil([lerpK(FINK, 0), lerpK(FINK, 0.6)], { a: 0.70, b: 1, K: 4 });
      at(finTE, 0, FIN_Y0, 0, 0, 0, PI / 2); put("aft", finTE, "paint");
      const finTop = foil([lerpK(FINK, FIN_H - 0.3), lerpK(FINK, FIN_H)], { a: 0.70, b: 1, K: 4 });
      at(finTop, 0, FIN_Y0, 0, 0, 0, PI / 2); put("aft", finTop, "paint");
      const rud = foil([lerpK(FINK, 0.6), lerpK(FINK, FIN_H - 0.3)], { a: 0.715, b: 1, K: 5 });
      at(rud, 0, FIN_Y0, 0, 0, 0, PI / 2); put("rudder", rud, { paint: 0.97 });
      // tailplane: centre box across the fin top, two halves
      const tpSt = [0, 0.6, 9.8].map(function (x) { const k = lerpK(TPK, x); k.y = TP_Y; return k; });
      const tp = foil(tpSt, { a: 0, b: 0.70, K: 7 });
      put("aft", [tp, mir(tp)], "paint");
      const tpc = foil([tpSt[0], tpSt[1]], { a: 0.70, b: 1, K: 4 });
      put("aft", [tpc, mir(tpc)], "paint");
      const el = foil([tpSt[1], tpSt[2]], { a: 0.715, b: 1, K: 5 });
      const elm = mir(el); put("elevL", el, { paint: 0.97 }); put("elevR", elm, { paint: 0.97 });
      const sd = [];
      [3.5, 6.5, 9.2].forEach(function (x) { const k = lerpK(TPK, x); sd.push(rod([x, TP_Y, k.le - k.c], [x, TP_Y, k.le - k.c - 0.15], 0.008, 4)); });
      const sdm = sd.map(function (g) { return mir(g); }); put("elevL", sd, C.black); put("elevR", sdm, C.black);
      // the bullet fairing where the tailplane meets the fin
      put("aft", sloft([{ z: -14.6, y: TP_Y, w: 0.05, t: 0.05, b: 0.05 }, { z: -15.4, y: TP_Y, w: 0.42, t: 0.38, b: 0.40, p: 2 },
        { z: -19.6, y: TP_Y, w: 0.46, t: 0.40, b: 0.42, p: 2 }, { z: -21.4, y: TP_Y, w: 0.10, t: 0.10, b: 0.10 }], 16), "paint");
      put("aft", at(sph(0.06, 8, 6), 0, TP_Y + 0.42, -17.0), 0xff2a1e, "beacon");
      put("aft", at(sph(0.06, 8, 6), 0, TP_Y, -21.45), 0xffffff, "strobe");
      put("aft", at(sph(0.06, 8, 6), 0, 6.15, -21.62), 0xfff4e0, "lamp");
      // formation light strips on the fin and the fuselage sides
      [-1, 1].forEach(function (s) {
        put("aft", at(box(0.006, 0.9, 0.08), s * 0.62, FIN_Y0 + 2.4, -13.0, 0.62), 0x3d7a4e, "lamp");
        put("body", at(box(0.006, 0.08, 0.9), s * 2.84, 5.0, 4.8), 0x3d7a4e, "lamp");
      });
    }
    // beacons top and belly
    put("body", at(sph(0.10, 10, 6), 0, 7.78, 0.6), 0xff2a1e, "beacon");
    put("body", at(sph(0.10, 10, 6), 0, 0.98, 6.0), 0xff2a1e, "beacon");

    // ---- ramp + cargo door: the inner faces ---------------------------------------------
    {
      const r0 = [0, station(RAMP.z0).yb + 0.40, RAMP.z0], r1 = [0, station(RAMP.z1).yb + 0.40, RAMP.z1];
      put("ramp", slab(r0, r1, 3.95, 0.10), C.floor);
      // the toes (the ramp extensions) at the sill
      [-1, 0, 1].forEach(function (k) { put("ramp", at(box(1.0, 0.05, 0.6), k * 1.2, r1[1] + 0.02, r1[2] + 0.25), C.gunmetal); });
      const c0 = [0, station(CDOOR.z0).yb + 0.52, CDOOR.z0], c1 = [0, station(CDOOR.z1 + 0.2).yb + 0.52, CDOOR.z1 + 0.2];
      put("cdoor", slab(c0, c1, 3.8, 0.08), C.interior);
      // the ramp's hinge fairings
      [1, -1].forEach(function (s) { put("body", at(cylX(0.10, 0.5, 8), s * 1.9, 1.32, RAMP.z0), C.gunmetal); });
    }
    // ---- paratroop doors: the panel's inner face, the deflector, the jumpmasters ----------
    [1, -1].forEach(function (s) {
      const dn = s > 0 ? "pdoorL" : "pdoorR", fn = s > 0 ? "deflL" : "deflR";
      const zc = (PDOOR.z0 + PDOOR.z1) / 2, x = s * (sideX(zc, 2.8) - 0.06);
      put(dn, at(box(0.03, PDOOR.y1 - PDOOR.y0, PDOOR.z1 - PDOOR.z0), x, (PDOOR.y0 + PDOOR.y1) / 2, zc), C.interior);
      put(dn, at(box(0.04, 0.05, 0.22), s * (sideX(zc, 2.4) + 0.01), 2.4, zc + 0.3), C.gunmetal);
      // the deflector: a plate flush with the skin ahead of the door, hinged on its forward edge
      const z0 = PDOOR.z1 + 0.10, h = 1.85, xx = s * (sideX(z0, 2.8) + 0.012);
      put(fn, at(box(0.03, h, 0.42), xx, 2.80, z0 - 0.21), { paint: 0.94 });
      put(fn, at(box(0.035, 0.02, 0.42), xx, 2.80 + h / 2, z0 - 0.21), C.seam);
      // the jumpmaster in the door, looking out and forward
      put(s > 0 ? "jumpL" : "jumpR", figure("stand", s * 2.2, 1.60, -5.78, s * PI / 2 * 0.75));
      // the static lines streaming from the anchor cable out of the door
      const lines = [];
      for (let k = 0; k < 7; k++) {
        const a = [s * 2.85, 3.70 - k * 0.03, -5.40 - k * 0.02];
        const b = [s * (3.4 + (k % 3) * 0.25), 2.9 - (k % 4) * 0.35, -9.5 - k * 0.55];
        lines.push(rod(a, b, 0.012, 3));
        lines.push(at(box(0.18, 0.28, 0.36), b[0], b[1], b[2]));        // the deployment bag at its end
      }
      put(s > 0 ? "linesL" : "linesR", lines, 0x6b6750);
    });

    // ---- landing gear ---------------------------------------------------------------------
    function wheelGeo(r, w) {
      const tire = at(new THREE.TorusGeometry(r - w * 0.42, w * 0.46, 8, 22), 0, 0, 0, 0, PI / 2, 0, 1, 1, 1.15);
      const hub = cylX(r * 0.58, w * 0.9, 16);
      return { tire: tire, hub: hub };
    }
    [1, -1].forEach(function (s) {
      const n = s > 0 ? "gearL" : "gearR";
      [1.5, -0.4, -2.3].forEach(function (z) {
        const ax = s * 2.55;
        put(n, [rod([ax, 0.62, z], [ax, 1.75, z], 0.10, 10), at(box(0.62, 0.10, 0.18), ax, 0.62, z)], C.steel);
        put(n, [rod([ax, 1.15, z + 0.30], [ax, 0.80, z + 0.08], 0.03, 5), rod([ax, 1.15, z + 0.30], [ax, 1.45, z + 0.08], 0.03, 5)], C.gunmetal);
        [-0.30, 0.30].forEach(function (o) {
          const w = wheelGeo(0.62, 0.40);
          put(n, at(w.tire, ax + o, 0.62, z), C.rubber);
          put(n, at(w.hub, ax + o, 0.62, z), C.steel);
        });
      });
    });
    {
      put("gearN", [rod([0, 0.46, 18.10], [0, 1.60, 18.30], 0.09, 10), at(box(0.80, 0.10, 0.16), 0, 0.46, 18.10),
        rod([0, 1.0, 18.20], [0, 1.35, 17.70], 0.04, 6)], C.steel);
      [-0.30, 0.30].forEach(function (o) {
        const w = wheelGeo(0.46, 0.30);
        put("gearN", at(w.tire, o, 0.46, 18.10), C.rubber);
        put("gearN", at(w.hub, o, 0.46, 18.10), C.steel);
      });
      put("gearN", at(sph(0.08, 8, 6), 0, 1.2, 18.42), 0xfff6d8, "lamp");          // taxi light
    }
    // the nose gear bay: a dark slot under the nose
    put("body", at(box(1.1, 0.02, 2.4), 0, 1.06, 17.8), C.black);

    // ---- bake the node buckets ----------------------------------------------------------
    const G = Object.create(null);
    for (const k in BK) { G[k] = {}; BUCKETS.forEach(function (b) { G[k][b] = merge(BK[k][b]); }); }

    // =================================================================
    //  PROPELLERS (built in the prop node's own frame: axis +Z, hub at 0)
    // =================================================================
    const PR = [0.50, 0.70, 1.00, 1.40, 1.80, 2.20, 2.45, 2.60, DIM.propR];
    const PC = [0.36, 0.46, 0.55, 0.60, 0.58, 0.50, 0.40, 0.28, 0.09];
    const PS = [0.0, 0.0, -0.02, 0.0, 0.06, 0.18, 0.30, 0.40, 0.47];          // scimitar sweep, back against the motion
    const PT = [0.30, 0.18, 0.12, 0.09, 0.07, 0.06, 0.05, 0.045, 0.04];
    const PB = [62, 55, 48, 42, 37, 33, 31, 30, 29];                          // blade angle, deg, in flight
    let BLADE_FLIP = null;            // one winding test (the flying pitch) for both pitches
    function blade(feather) {
      const K = 6, m = 2 * (K + 1), pos = [], idx = [];
      for (let i = 0; i < PR.length; i++) {
        const r = PR[i], c = PC[i], beta = (feather ? 86 : PB[i]) * DEG;
        const cvx = Math.cos(beta), cvz = -Math.sin(beta);                    // LE -> TE (the blade moves toward -X)
        const nx = Math.sin(beta), nz = Math.cos(beta);                       // the forward (suction) face
        for (let q = 0; q < m; q++) {
          const top = q <= K, k = top ? q : (2 * K + 1 - q), xc = 0.5 * (1 - Math.cos(PI * k / K));
          const ht = Math.max(0.002, naca(xc) * PT[i] * c) * (top ? 1 : -1);
          const u = (xc - 0.3) * c;
          pos.push(PS[i] + cvx * u + nx * ht, r, cvz * u + nz * ht);
        }
      }
      for (let i = 0; i < PR.length - 1; i++) for (let q = 0; q < m; q++) {
        const p = i * m + q, rr = i * m + (q + 1) % m;
        idx.push(p, p + m, rr, rr, p + m, rr + m);
      }
      const base = (PR.length - 1) * m, ci = pos.length / 3;
      pos.push(PS[PR.length - 1], DIM.propR + 0.01, 0);
      for (let q = 0; q < m; q++) idx.push(ci, base + q, base + (q + 1) % m);
      // outward check: the forward face of mid-span must face +Z-ish
      const g = mkGeo(pos, idx);
      const tq = 3 * m + 2, nn = triN(pos, tq, tq + m, tq + 1);
      if (BLADE_FLIP == null) BLADE_FLIP = nn[2] < 0;
      if (BLADE_FLIP) { flipIdx(g.index.array, 0, g.index.array.length); g.computeVertexNormals(); }
      return g;
    }
    function propGeo(hand, feather) {
      const parts = [];
      for (let k = 0; k < 8; k++) {
        const b = blade(feather);
        at(b, 0, 0, 0, 0, 0, k * PI / 4);
        colour(b, function (x, y, z) { const r = Math.hypot(x, y); return RGB(r > 2.5 ? C.propEdge : C.prop); });
        parts.push(b);
      }
      // the spinner (a lathe: axis Y -> Z) and the back plate
      const prof = [];
      for (let i = 0; i <= 12; i++) { const t = i / 12; prof.push(new THREE.Vector2(Math.max(0.001, 0.60 * Math.sqrt(1 - t * t * 0.96)), -0.12 + t * 1.35)); }
      const sp = new THREE.LatheGeometry(prof, 28); at(sp, 0, 0, 0, PI / 2, 0, 0);
      colour(sp, function (x, y, z, ny) { return [0.53 * 1.02, 0.55 * 1.02, 0.58 * 1.02]; });
      parts.push(sp);
      const bp = cylZ(0.60, 0.10, 28); colour(bp, C.gunmetal); parts.push(bp);
      const g = merge(parts);
      if (hand < 0) { xm(g, new THREE.Matrix4().makeScale(-1, 1, 1)); g.computeVertexNormals(); }
      return g;
    }
    G.prop = { 1: propGeo(1, false), "-1": propGeo(-1, false) };
    G.propF = { 1: propGeo(1, true), "-1": propGeo(-1, true) };
    G.disc = new THREE.CircleGeometry(DIM.propR, 40); G.disc._shared = true;
    G.flag = new THREE.PlaneGeometry(1.0, 1.0); G.flag._shared = true;

    // =================================================================
    //  CANOPIES, BUNDLES, FLARES (world-space, instanced)
    // =================================================================
    /* A round troop canopy (~8.5 m inflated, 24 gores, scalloped skirt, apex
       vent), its 24 suspension lines to the confluence and two risers to the
       harness at the origin (the man's shoulders). */
    function canopyGeo(R, H) {
      const parts = [], gores = 24, rings = 9, pos = [], idx = [];
      const skirt = 1.30, vent = 0.10;
      for (let i = 0; i <= rings; i++) {
        const th = vent + (skirt - vent) * i / rings;
        for (let j = 0; j <= gores * 2; j++) {
          const ph = j / (gores * 2) * TAU;
          const bulge = 1 + 0.05 * Math.abs(Math.sin(ph * gores / 2)) * Math.sin(th);
          const scal = i === rings ? 0.35 * (1 - Math.abs(Math.cos(ph * gores / 2))) : 0;
          pos.push(Math.sin(th) * R * bulge * Math.cos(ph), H + Math.cos(th) * R * 0.62 - scal, Math.sin(th) * R * bulge * Math.sin(ph));
        }
      }
      const W = gores * 2 + 1;
      for (let i = 0; i < rings; i++) for (let j = 0; j < gores * 2; j++) {
        const a = i * W + j, b = a + 1, c = a + W, d = c + 1;
        idx.push(a, b, c, b, d, c);
      }
      const dome = mkGeo(pos, idx);
      colour(dome, function (x, y, z) { const g = Math.floor((Math.atan2(z, x) + PI) / TAU * gores) & 1; const k = g ? 1 : 0.9; return [0.36 * k, 0.36 * k, 0.25 * k]; });
      parts.push(dome);
      const lines = [];
      for (let j = 0; j < gores; j++) {
        const ph = j / gores * TAU, rr = Math.sin(skirt) * R;
        const sk = [rr * Math.cos(ph), H + Math.cos(skirt) * R * 0.62, rr * Math.sin(ph)];
        lines.push(rod([Math.cos(ph) > 0 ? 0.20 : -0.20, 1.2, 0], sk, 0.014 * R / 4.2, 3));
      }
      lines.push(rod([0.2, 1.2, 0], [0.16, 0.0, 0], 0.03, 4), rod([-0.2, 1.2, 0], [-0.16, 0.0, 0], 0.03, 4));
      lines.forEach(function (l) { colour(l, C.line); parts.push(l); });
      return merge(parts);
    }
    G.canopy = canopyGeo(4.25, DROP.lineLen);
    G.cargoChute = canopyGeo(9.6, 13.5);
    {
      // a CDS bundle: an A-22 bag on a honeycomb skid, strapped
      const parts = [], col = [];
      const b0 = at(box(1.30, 1.15, 1.30), 0, 0.72, 0); colour(b0, C.crate); parts.push(b0);
      const sk = at(box(1.40, 0.14, 1.40), 0, 0.07, 0); colour(sk, C.pallet); parts.push(sk);
      [-0.35, 0.35].forEach(function (o) {
        const a = at(box(1.33, 1.18, 0.07), 0, 0.72, o); colour(a, C.strap); parts.push(a);
        const b = at(box(0.07, 1.18, 1.33), o, 0.72, 0); colour(b, C.strap); parts.push(b);
      });
      const r = rod([0, 1.3, 0], [0, 2.6, 0], 0.03, 4); colour(r, C.line); parts.push(r);
      G.crate = merge(parts);
    }
    G.flareHead = new THREE.SphereGeometry(0.45, 10, 8); G.flareHead._shared = true;
    G.flareTrail = new THREE.CylinderGeometry(0.25, 0.9, 1, 8, 1, true); G.flareTrail.translate(0, -0.5, 0); G.flareTrail._shared = true;

    // ---- materials ------------------------------------------------------------
    function vcMat(hex, opts) {
      let m = null;
      try { m = CBZ.cmat && !opts ? CBZ.cmat(hex, { vc: true }) : null; } catch (e) { m = null; }
      if (!m || !m.vertexColors) { m = new THREE.MeshLambertMaterial(Object.assign({ color: hex, vertexColors: true }, opts || {})); }
      m._shared = true;
      return m;
    }
    const M = {
      vc: vcMat(0xffffff),
      paint: vcMat(PAINT),
      burnt: vcMat(BURNT),
      glass: new THREE.MeshPhongMaterial({ color: 0x1e2a33, specular: 0xb4c4d0, shininess: 90, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }),
      lamp: new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true }),
      disc: new THREE.MeshBasicMaterial({ color: 0x15181a, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false }),
      canopy: vcMat(0xffffff, { side: THREE.DoubleSide }),
      flare: new THREE.MeshBasicMaterial({ color: 0xfff1c8, transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending }),
      trail: new THREE.MeshBasicMaterial({ color: 0xe9e6e0, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide }),
    };
    for (const k in M) if (M[k] && M[k].isMaterial) M[k]._shared = true;
    TPL = { G: G, M: M };
    return TPL;

    /* A MAN round his seat point (x, y, z), facing +Z (yaw turns him).
       pilot: seated at the side stick; stand: the jumpmaster in the door,
       harnessed, a hand on the door frame. */
    function figure(pose, X, Y, Z, yaw) {
      const P = [];
      function add(g, col) { if (!g.attributes.normal) g.computeVertexNormals(); colour(g, col); P.push(g); }
      const seated = pose === "pilot";
      const suit = C.suit, vest = C.vest;
      [-1, 1].forEach(function (s) {
        if (seated) {
          const hip = [s * 0.10, 0.02, 0.02], knee = [s * 0.12, 0.04, 0.44], ankle = [s * 0.12, -0.38, 0.52];
          add(rod(hip, knee, 0.075, 8), suit); add(rod(knee, ankle, 0.058, 8), suit);
          add(at(box(0.11, 0.09, 0.26), ankle[0], ankle[1] - 0.04, ankle[2] + 0.06), C.boot);
        } else {
          const hip = [s * 0.10, 0.95, 0], knee = [s * 0.11, 0.50, 0.06], ankle = [s * 0.11, 0.08, 0.0];
          add(rod(hip, knee, 0.075, 8), suit); add(rod(knee, ankle, 0.058, 8), suit);
          add(at(box(0.11, 0.09, 0.27), ankle[0], 0.045, 0.06), C.boot);
        }
      });
      const y0 = seated ? 0 : 0.95;
      add(at(box(0.32, 0.14, 0.22), 0, y0 + 0.05, 0), suit);
      const torso = cylY(0.15, 0.18, 0.50, 12); torso.scale(1, 1, 0.62); add(at(torso, 0, y0 + 0.36, 0), suit);
      add(at(box(0.37, 0.38, 0.27), 0, y0 + 0.38, 0.005), vest);
      if (!seated) add(at(box(0.30, 0.40, 0.14), 0, y0 + 0.40, -0.20), vest);               // the harness / reserve
      add(at(cylY(0.05, 0.05, 0.08, 8), 0, y0 + 0.64, 0), C.skin);
      add(at(sph(0.10, 12, 9), 0, y0 + 0.77, 0.01), C.skin);
      const h = new THREE.SphereGeometry(0.13, 14, 9, 0, TAU, 0, PI * 0.58); add(at(h, 0, y0 + 0.79, -0.005), C.helmet);
      if (seated) add(at(box(0.20, 0.07, 0.05), 0, y0 + 0.81, 0.12), C.visor);
      [-1, 1].forEach(function (s) {
        const sh = [s * 0.21, y0 + 0.55, 0];
        let el, hand;
        if (seated) { el = [s * 0.24, y0 + 0.30, 0.18]; hand = [s * 0.36, y0 + 0.24, 0.40]; }
        else if (s > 0) { el = [0.30, y0 + 0.70, 0.18]; hand = [0.34, y0 + 1.02, 0.30]; }
        else { el = [-0.24, y0 + 0.30, 0.10]; hand = [-0.22, y0 + 0.10, 0.18]; }
        add(rod(sh, el, 0.052, 8), suit); add(rod(el, hand, 0.045, 8), suit);
        add(at(sph(0.045, 8, 6), hand[0], hand[1], hand[2]), C.glove);
      });
      P.forEach(function (g) { at(g, 0, 0, 0, 0, yaw || 0, 0); at(g, X, Y, Z); });
      return P;
    }
  }

  // ---- nation flags ------------------------------------------------------------------
  const FLAGM = Object.create(null);
  function flagMat(id, design) {
    if (FLAGM[id] !== undefined) return FLAGM[id];
    const THREE = window.THREE, F = CBZ.flags;
    let m = null;
    try {
      const d = design || (F && F.designFor ? F.designFor(id) : null);
      if (THREE && F && F.paint && d && typeof document !== "undefined" && document.createElement) {
        const c = document.createElement("canvas"); c.width = 190; c.height = 100;
        const g = c.getContext && c.getContext("2d");
        if (g) {
          F.paint(g, d, 190, 100, { grain: false });
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
    const root = new THREE.Group(); root.name = "a400m-atlas";
    const lean = new THREE.Group(); lean.name = "a400m-lean"; lean.position.y = DIM.cgY; root.add(lean);
    const N = Object.create(null);
    N.body = new THREE.Group(); N.body.name = "a400m-body"; N.body.position.y = -DIM.cgY; lean.add(N.body);
    for (const k in NODES) {
      if (k === "body" || k.charAt(0) === "_") continue;
      const d = NODES[k], po = NODES[d[0]][1], o = d[1];
      const g = new THREE.Group(); g.name = "a400m-" + k;
      g.position.set(o[0] - po[0], o[1] - po[1], o[2] - po[2]);
      N[k] = g;
    }
    for (const k in NODES) if (k !== "body" && k.charAt(0) !== "_") N[NODES[k][0]].add(N[k]);
    function mesh(geo, mat, parent, shadow) {
      if (!geo) return null;
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = shadow !== false; m.receiveShadow = true;
      parent.add(m); return m;
    }
    const paints = [], lamps = [], beacons = [], strobes = [];
    for (const k in G) {
      if (!N[k] || !G[k] || !G[k].paint && !G[k].vc && !G[k].glass && !G[k].lamp) continue;
      const pm = mesh(G[k].paint, M.paint, N[k]); if (pm) paints.push(pm);
      mesh(G[k].vc, M.vc, N[k]);
      mesh(G[k].glass, M.glass, N[k], false);
      const lm = mesh(G[k].lamp, M.lamp, N[k], false); if (lm) lamps.push(lm);
      const bm = mesh(G[k].beacon, M.lamp, N[k], false); if (bm) beacons.push(bm);
      const sm = mesh(G[k].strobe, M.lamp, N[k], false); if (sm) strobes.push(sm);
    }
    // the props: one mesh each (feathered geometry swapped in when the engine dies) + blur disc
    const props = ENG.map(function (e) {
      const node = N["prop" + e.i];
      const m = mesh(G.prop[e.w], M.vc, node);
      const disc = mesh(G.disc, M.disc, node, false); disc.position.z = 0.15; disc.visible = false;
      return { e: e, node: node, mesh: m, disc: disc, a: (ctx && ctx.seed || 0) * 0.7 + e.i * 0.4, rpm: 0, dead: false, smoke: false, fire: false, bent: false };
    });
    // the flags: the fin flash (both faces) and a fuselage flag aft of the crew door
    const flags = [];
    [-1, 1].forEach(function (s) {
      const fh = 3.6, fs = lerpK(FINK, fh), half = 0.48 * fs.tc * fs.c;          // NACA half-thickness at 42% chord
      const f = new THREE.Mesh(G.flag, M.vc);
      f.scale.set(2.3, 1.45, 1);
      f.position.set(s * (half + 0.04), FIN_Y0 + fh - NODES.aft[1][1], fs.le - 0.42 * fs.c - NODES.aft[1][2]);
      f.rotation.y = s * PI / 2; if (s < 0) f.scale.x = -2.3;
      f.visible = false; f.castShadow = false; N.aft.add(f); flags.push(f);
      const g = new THREE.Mesh(G.flag, M.vc);
      // forward on the hold, between the cabin windows, where the side is upright
      const z = 11.05, y = 4.15;
      g.scale.set(s * 1.45, 0.92, 1);
      g.position.set(s * (sideX(z, y) + 0.025), y, z);
      g.rotation.set(0, s * PI / 2, 0);
      g.visible = false; g.castShadow = false; N.body.add(g); flags.push(g);
    });

    const R = {
      group: root, lean: lean, nodes: N, paints: paints, lamps: lamps, beacons: beacons, strobes: strobes, props: props, flags: flags, M: M, T: T,
      clock: (ctx && ctx.seed || 0) * 0.37, px: 0, py: 0, pz: 0, h0: 0, vx: 0, vz: 0, yawRate: 0, bank: 0, bankRate: 0, seeded: false, first: true,
      gear: 1, flap: 0, door: 0, ramp: 0, defl: 0, ail: 0, elev: 0, rud: 0, gamma0: 0,
      dead: false, crashed: false, burnt: false, hitWing: false, fire: false, smokeT: 0,
      veh: null, pax: [], paxPrev: [], drop: null, flares: null, fx: null, flareT: 0, salvo: 0,
      vel: { x: 0, y: 0, z: 0 }, vy: 0, crashV: { x: 0, y: 0, z: 0 },
    };
    const rig = {
      turret: null,
      settle: function () { R.seeded = false; tick(R, true, 0, null); },
      muzzleWorld: function (out, shot) { return worldAt(R.nodes.ramp, 0, 1.2, -5.0, out); },
      fire: function () {},
      canFire: function () { return false; },
      damage: function (vs, res) { damage(R, vs, res); },
      mark: function (nation, ground, side) {
        // every Atlas operator paints it the same grey, whatever it flies over
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
    root.userData.aircraftDims = { family: "A400M", length: DIM.length, span: DIM.span, height: DIM.height, bodyW: DIM.fusW, bodyL: 43.9 };
    root.userData.crewSeats = [
      { job: "Pilot", x: -0.75, y: 4.67, z: 18.30, yaw: 0 }, { job: "Copilot", x: 0.75, y: 4.67, z: 18.30, yaw: 0 },
      { job: "Loadmaster", x: 0, y: 1.60, z: -5.2, yaw: PI },
    ];
    if (ctx && (ctx.nation || ctx.flag)) rig.setNation(ctx.nation || ctx.flagId, ctx.flag);
    tick(R, true, 0, null);
    // footprint: the fuselage (what a round aimed at it hits), not the span
    return { group: root, rig: rig, footW: 6.2, footL: 44.0, height: 7.8 };
  }

  // ---- helpers --------------------------------------------------------------------
  let _w = null;
  function worldAt(node, x, y, z, out) {
    if (!_w) _w = new window.THREE.Vector3();
    out = out || _w;
    let r = node; while (r.parent) r = r.parent;
    r.updateMatrixWorld(true);
    return node.localToWorld(out.set(x, y, z));
  }
  function ground(ctx, x, z) {
    try {
      if (ctx && ctx.groundAt) return +ctx.groundAt(x, z) || 0;
      if (CBZ.floorAt) return +CBZ.floorAt(x, z) || 0;
    } catch (e) {}
    return 0;
  }
  const _ax = { x: 0, y: 0, z: 0 };
  function axisOf(a, b, s) {
    const dx = s * (b[0] - a[0]), dy = b[1] - a[1], dz = b[2] - a[2], L = Math.hypot(dx, dy, dz) || 1;
    _ax.x = dx / L; _ax.y = dy / L; _ax.z = dz / L;
    return _ax;
  }
  // hinge axes for the control surfaces (outboard / upward), built once
  let AXES = null;
  function axes() {
    if (AXES) return AXES;
    const THREE = window.THREE;
    AXES = Object.create(null);
    SURF.forEach(function (s) {
      const a = axisOf(hingePt(s[3], s[5]), hingePt(s[4], s[5]), s[2]);
      AXES[s[0]] = new THREE.Vector3(a.x, a.y, a.z);
    });
    AXES.elevL = new THREE.Vector3(1, 0, 0); AXES.elevR = new THREE.Vector3(-1, 0, 0);
    const r0 = NODES.rudder[1], r1 = NODES._rudTop[1];
    const a = axisOf(r0, r1, 1); AXES.rudder = new THREE.Vector3(a.x, a.y, a.z);
    AXES.x = new THREE.Vector3(1, 0, 0);
    return AXES;
  }
  function hinge(node, axis, ang) { node.quaternion.setFromAxisAngle(axis, ang); }

  // passengers still aboard (the crew seat book: units/kit/vehicle.js)
  function aboard(veh, list) {
    const S = veh && veh.seats;
    let n = 0;
    if (list) list.length = 0;
    if (!S) return 0;
    for (let i = 0; i < S.length; i++) if (!S[i].crew && S[i].man) { n++; if (list) list.push(S[i].man); }
    return n;
  }

  // ---- damage --------------------------------------------------------------------------
  function damage(R, vs, res) {
    if (!res || !res.pen) return;
    const heavy = res.dmg > 120;
    if (heavy || Math.random() < 0.08) {
      // the hit found an engine: smoke, and a bad one shuts it down
      const live = R.props.filter(function (p) { return !p.dead; });
      if (live.length) {
        const P = live[(Math.random() * live.length) | 0];
        P.smoke = true;
        if (heavy && Math.random() < 0.6) P.dead = true;
        if (res.burning || vs.burning) P.fire = true;
      }
    }
    if (res.zone === "side" || res.zone === "top" || heavy) R.hitWing = R.hitWing || Math.random() < (heavy ? 0.7 : 0.05);
    if (res.burning || vs.burning) R.fire = true;
    // the missile warner and the DAS: a salvo of flares on anything big
    if (heavy) R.salvo = Math.max(R.salvo, 8);
  }

  // =====================================================================
  //  THE DROP: real men, door to ground
  // =====================================================================
  /* THE SKY. Every body under a canopy (and every supply bundle) on the page
     lives here, not on its aircraft: the aircraft flies home long before its
     last man is down. The sky is stepped on the battle clock (CBZ.now, which
     the page advances on sim time) by whoever asks first in a step: an
     aircraft's animate, or a falling man's own body (physics.js asks his
     carry point where he is every step: the getter below). */
  const SKY = { t: null, planeT: -1e9, list: [] };
  function nowS() { return (typeof CBZ.now === "number" && isFinite(CBZ.now) ? CBZ.now : 0) / 1000; }
  function skyStep() {
    const now = nowS();
    if (SKY.t === null) { SKY.t = now; return; }
    let dt = now - SKY.t;
    if (!(dt > 0)) return;
    if (dt > 0.5) dt = 0.5;
    SKY.t = now;
    const planes = now - SKY.planeT < 0.6;
    for (let i = 0; i < SKY.list.length; i++) {
      const J = SKY.list[i];
      if (J.st === 5) continue;
      if (J.st === 0) {
        // still aboard an aircraft that no longer answers (flown off the map): out now
        if (!planes) exitJ(J, J.x, J.y, J.z, J.pvx, J.pvy, J.pvz, J.side);
        else continue;
      }
      if (J.st === 1 && J.man && (J.man.dead || J.man._tossed !== J.T)) J.st = 3;   // shot under the canopy: it drifts on empty
      if (J.st === 1 || J.st === 3) {
        const vd = J.st === 3 ? 3.2 : J.vDesc;
        let h = dt;
        while (h > 1e-4) { const s = Math.min(0.05, h); fly(J, s, vd); h -= s; }
        const gy = ground(null, J.x, J.z);
        if (J.y <= gy + 0.05) {
          J.y = gy + 0.04;
          if (J.st === 1 && J.man) landMan(J);
          J.st = 2; J.landT = planes ? 0 : 2.5;
        }
        J.cp.x = J.x; J.cp.y = J.y; J.cp.z = J.z;
      } else if (J.st === 2) J.landT += dt;
      drawJ(J);
      if (J.st === 2 && J.landT >= 2.5) J.st = 5;
    }
    for (let i = 0; i < SKY.list.length; i++) {
      const F = SKY.list[i].fx;
      if (F && F.dirty) { F.dirty = false; F.can.instanceMatrix.needsUpdate = true; F.big.instanceMatrix.needsUpdate = true; F.crate.instanceMatrix.needsUpdate = true; }
    }
  }
  // the man reaches the ground: physics.js's own landing takes it from here
  // (the impact by speed, the parachute landing fall, up again and fighting)
  function landMan(J) {
    const man = J.man, T = J.T;
    man.pos.x = J.x; man.pos.y = J.y; man.pos.z = J.z;
    T.lift = 0; T.vx = J.vx; T.vy = Math.min(-0.5, J.vy); T.vz = J.vz; T.spin = 0;
    if (man.home) { man.home.x = J.x; man.home.z = J.z; }
    if (man.target && man.target.set) man.target.set(J.x, 0, J.z);
  }
  /* A JUMPER. The man's body is held by physics.js's thrown-body state in
     its carried phase: each step it puts him at x0 + (carry - x0) * k, so
     both are the sky's own position for him (getters: the first read in a
     step brings the sky up to the battle clock). */
  function makeJumper(R, man, k, side) {
    const J = { kind: "man", man: man, side: side, k: k, st: 0, tExit: 0, fx: null, idx: -1,
      x: man.pos.x, y: man.pos.y, z: man.pos.z, vx: 0, vy: 0, vz: 0, pvx: 0, pvy: 0, pvz: 0,
      age: 0, s: 0, landT: 0, swing: Math.random() * TAU, vDesc: DROP.vDesc, lineT: DROP.lineT, openT: DROP.openT, lineLen: DROP.lineLen, R: 1,
      cp: { x: man.pos.x, y: man.pos.y, z: man.pos.z }, T: null };
    const carry = { heading: 0, noseR: 1e-9, eyeH: 1e-9, dead: false };
    Object.defineProperty(carry, "pos", { get: function () { skyStep(); return J.cp; } });
    const T = { by: null, age: 0, lift: 1e9, carry: carry, dmg: 0, down: 0, vx: 0, vy: 0, vz: 0, hit: true, rx: 0, spin: 0 };
    Object.defineProperty(T, "x0", { get: function () { skyStep(); return J.cp.x; }, set: function () {} });
    Object.defineProperty(T, "y0", { get: function () { return J.cp.y; }, set: function () {} });
    Object.defineProperty(T, "z0", { get: function () { return J.cp.z; }, set: function () {} });
    J.T = T;
    return J;
  }
  function exitJ(J, x, y, z, vx, vy, vz, side) {
    J.x = x; J.y = y; J.z = z; J.vx = vx; J.vy = vy; J.vz = vz;
    J.cp.x = x; J.cp.y = y; J.cp.z = z;
    J.age = 0; J.st = 1;
    const man = J.man;
    if (man) {
      const h = Math.atan2(vx, vz);
      if (man.group) { man.group.visible = true; man.group.rotation.y = h; }
      man.yaw = h;
    }
  }
  // the world-space meshes of one aircraft's drop (canopies, bundles, flares)
  function dropScene(R) {
    const THREE = window.THREE;
    let parent = R.group.parent;
    while (parent && parent.parent && !parent.isScene) parent = parent.parent;
    if (!parent) return null;
    if (R.fx && R.fx.parent === parent) return R.fx;
    const T = R.T, G = T.G, M = T.M;
    const can = new THREE.InstancedMesh(G.canopy, M.canopy, 120);
    const big = new THREE.InstancedMesh(G.cargoChute, M.canopy, DROP.cdsN);
    const crate = new THREE.InstancedMesh(G.crate, M.vc, DROP.cdsN);
    const fh = new THREE.InstancedMesh(G.flareHead, M.flare, 24);
    const ft = new THREE.InstancedMesh(G.flareTrail, M.trail, 24);
    [can, big, crate, fh, ft].forEach(function (m) {
      m.count = 0; m.frustumCulled = false; m.castShadow = m !== fh && m !== ft; m.receiveShadow = m === crate;
      if (m.instanceMatrix.setUsage) m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      parent.add(m);
    });
    R.fx = { parent: parent, can: can, big: big, crate: crate, fh: fh, ft: ft, nCan: 0, nCds: 0, dirty: false,
      m: new THREE.Matrix4(), q: new THREE.Quaternion(), e: new THREE.Euler(0, 0, 0, "YXZ"), v: new THREE.Vector3(), s: new THREE.Vector3(),
      up: new THREE.Vector3(0, 1, 0), d: new THREE.Vector3(), zero: new THREE.Matrix4().makeScale(0, 0, 0) };
    return R.fx;
  }
  // the door a jumper leaves by, in world space (k even: port, odd: starboard)
  const _d = { x: 0, y: 0, z: 0 };
  function doorWorld(R, side) {
    const p = worldAt(R.nodes.body, side * 2.75, 2.2, (PDOOR.z0 + PDOOR.z1) / 2);
    _d.x = p.x; _d.y = p.y; _d.z = p.z;
    return _d;
  }
  /* START THE STICK: the battle has just unseated the passengers. Each man
     becomes a jumper in order: he waits in the hold (hidden, held at his
     door) until his turn, then goes out of it. No troops: the load is four
     CDS bundles, which go off the ramp. */
  function startDrop(R, list) {
    const F = dropScene(R);
    const D = R.drop = { t: 0, jumpers: [], cds: null, linesT: 0, left: 0 };
    let k = 0;
    for (let i = 0; i < list.length && F; i++) {
      const man = list[i];
      if (!man || man.dead || man.inVeh || !man.pos || man._tossed) continue;
      const side = (k & 1) ? -1 : 1;
      const J = makeJumper(R, man, k, side);
      J.tExit = (k >> 1) * DROP.perDoor + (k & 1) * DROP.perDoor * 0.5;
      J.fx = F; J.idx = F.nCan < 120 ? F.nCan++ : -1;
      if (J.idx >= 0) { F.can.setMatrixAt(J.idx, F.zero); F.can.count = F.nCan; F.dirty = true; }
      man._tossed = J.T;                     // the body in the air is nobody else's (physics.js)
      if (man.group) man.group.visible = false;
      D.jumpers.push(J); SKY.list.push(J);
      k++;
    }
    if (!k) D.cds = { n: 0, t: 0 };
    return D;
  }
  /* ONE BODY UNDER (OR NOT YET UNDER) A CANOPY, integrated with quadratic
     drag toward a terminal speed that falls from free fall (~52 m/s) to the
     canopy's as it opens (static line taut at lineT, full canopy at openT),
     in the moving air. */
  function fly(J, h, vDesc) {
    const W = wind();
    J.age += h;
    J.s = smooth(J.lineT, J.openT, J.age);
    const vt = DROP.vBody + (vDesc - DROP.vBody) * J.s;
    const c = G0 / (vt * vt);
    const rx = J.vx - W.x, ry = J.vy, rz = J.vz - W.z;
    const sp = Math.hypot(rx, ry, rz), k = 1 / (1 + c * sp * h);
    J.vx = W.x + rx * k; J.vy = ry * k - G0 * h; J.vz = W.z + rz * k;
    J.x += J.vx * h; J.y += J.vy * h; J.z += J.vz * h;
  }
  // the canopy over a body in the air, or lying where it came down
  function canopyMatrix(F, J) {
    const e = F.e, q = F.q, s = F.s, v = F.v, sc = J.R;
    if (J.st === 2 || J.st === 5) {
      // collapsing downwind over 2.5 s, then flat on the ground
      const c = smooth(0, 2.5, J.landT);
      const W = wind(), lay = Math.atan2(W.x, W.z);
      const off = c * (J.lineLen * 0.55 + 1.5);
      v.set(J.x + Math.sin(lay) * off, J.y + (1 - c) * 1.6 + c * 0.05, J.z + Math.cos(lay) * off);
      e.set(c * PI / 2 * 0.96, lay, 0);
      s.set((1 - 0.35 * c) * sc, (1 - 0.92 * c) * sc, (1 + 0.15 * c) * sc);
    } else {
      const sw = J.s * 0.07 * Math.sin(J.age * 1.3 + J.swing);
      const sx = 0.10 + 0.90 * Math.pow(J.s, 1.4), sy = 1 + (1 - J.s) * 0.9;
      // while it opens it trails behind its man in the airflow
      const W = wind(), rx = J.vx - W.x, rz = J.vz - W.z, rh = Math.hypot(rx, rz);
      const lean = Math.atan2(rh, Math.max(1, -J.vy)) * (1 - J.s * 0.9);
      e.set(-lean + sw, Math.atan2(rx, rz), sw * 0.6);
      v.set(J.x, J.y + (J.kind === "man" ? 1.55 : 1.3), J.z);
      s.set(sx * sc, sy * sc, sx * sc);
    }
    q.setFromEuler(e);
    F.m.compose(v, q, s);
    return F.m;
  }
  function drawJ(J) {
    const F = J.fx;
    if (!F || J.idx < 0) return;
    F.dirty = true;
    if (J.kind === "cds") {
      F.e.set(0, J.lay || 0, 0); F.q.setFromEuler(F.e); F.v.set(J.x, J.y, J.z); F.s.set(1, 1, 1);
      F.m.compose(F.v, F.q, F.s); F.crate.setMatrixAt(J.idx, F.m);
      F.big.setMatrixAt(J.idx, J.age < J.lineT * 0.6 && J.st === 1 ? F.zero : canopyMatrix(F, J));
      return;
    }
    if (J.st === 0 || (J.st === 1 && J.age < J.lineT * 0.6)) { F.can.setMatrixAt(J.idx, F.zero); return; }   // still in the deployment bag
    F.can.setMatrixAt(J.idx, canopyMatrix(F, J));
  }
  /* THE AIRCRAFT'S HALF OF THE DROP: hold the men still aboard at their door,
     send each out at his time (the aircraft's velocity plus a push off the
     sill), bundles off the ramp. A stricken aircraft empties at once; one
     that hits the ground takes whoever is still aboard with it (they meet
     the ground at its speed: physics.js's landing decides). */
  function stepDrop(R, D, dt, ctx) {
    D.t += dt;
    const h = R.group.rotation.y, gam = ctx ? (ctx.gamma || 0) : 0, v = ctx ? (ctx.speed || 0) : 0;
    const vx = Math.sin(h) * v * Math.cos(gam), vy = v * Math.sin(gam) + (R.vy || 0) * (R.dead ? 1 : 0), vz = Math.cos(h) * v * Math.cos(gam);
    let left = 0;
    for (let i = 0; i < D.jumpers.length; i++) {
      const J = D.jumpers[i];
      if (J.st !== 0) continue;
      if (J.man.dead || J.man._tossed !== J.T) { J.st = 5; drawJ(J); continue; }
      left++;
      if (R.dead && J.tExit > D.t + 0.25 * left) J.tExit = D.t + 0.25 * left;
      const d = doorWorld(R, J.side);
      J.pvx = vx; J.pvy = vy; J.pvz = vz;
      if (R.crashed) {
        // still aboard when it hit: he meets the ground at the aircraft's speed
        J.x = d.x; J.y = Math.max(d.y - 1.5, ground(ctx, d.x, d.z) + 0.05); J.z = d.z;
        J.cp.x = J.x; J.cp.y = J.y; J.cp.z = J.z;
        J.T.lift = 0; J.T.vx = R.crashV.x; J.T.vy = -Math.abs(R.crashV.y); J.T.vz = R.crashV.z; J.T.spin = 0;
        if (J.man.group) J.man.group.visible = true;
        J.st = 5;
        continue;
      }
      J.x = d.x; J.y = d.y; J.z = d.z; J.cp.x = d.x; J.cp.y = d.y; J.cp.z = d.z;
      J.man.pos.x = d.x; J.man.pos.y = d.y; J.man.pos.z = d.z;
      if (D.t >= J.tExit + (1 - R.door) * 2.0) {
        const ox = Math.cos(h) * J.side, oz = -Math.sin(h) * J.side;
        exitJ(J, d.x, d.y, d.z, vx + ox * DROP.push, vy - 0.5, vz + oz * DROP.push, J.side);
        D.linesT = 8;
      }
    }
    D.left = left;
    if (left === 0 && D.linesT > 0) D.linesT -= dt;
    // supplies: four bundles off the ramp at the green light
    if (D.cds && D.cds.n < DROP.cdsN && !R.crashed && R.ramp > 0.9) {
      D.cds.t += dt;
      if (D.cds.t >= 0.6 + D.cds.n * DROP.cdsEvery) {
        const F = dropScene(R);
        if (F) {
          const p = worldAt(R.nodes.ramp, 0, 0.7, RAMP.z1 - RAMP.z0 - 0.4);
          const B = { kind: "cds", man: null, st: 1, fx: F, idx: F.nCds++, x: p.x, y: p.y, z: p.z, vx: vx * 0.97, vy: vy - 1.5, vz: vz * 0.97,
            age: 0, s: 0, landT: 0, lay: h, swing: Math.random() * TAU, vDesc: DROP.cdsDesc, lineT: 1.4, openT: 4.6, lineLen: 13.5, R: 1,
            cp: { x: p.x, y: p.y, z: p.z } };
          F.crate.count = F.nCds; F.big.count = F.nCds;
          SKY.list.push(B);
        }
        D.cds.n++;
      }
    }
  }

  // ---- flares (DAS): pooled, world space ---------------------------------------------
  function popFlares(R, n, ctx) {
    const F = dropScene(R);
    if (!F) return;
    if (!R.flares) R.flares = [];
    const h = R.group.rotation.y, v = ctx ? (ctx.speed || 0) : 0;
    for (let k = 0; k < n; k++) {
      let f = null;
      for (let i = 0; i < R.flares.length; i++) if (R.flares[i].life <= 0) { f = R.flares[i]; break; }
      if (!f) { if (R.flares.length >= 24) break; f = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0 }; R.flares.push(f); }
      const s = (k & 1) ? -1 : 1;
      const p = k % 4 < 2 ? worldAt(R.nodes.body, s * 3.3, 1.35, -4.2) : worldAt(R.nodes.body, s * 0.6, 5.9, -19.8);
      f.x = p.x; f.y = p.y; f.z = p.z;
      const out = 26 + Math.random() * 10;
      f.vx = Math.sin(h) * v + Math.cos(h) * s * out; f.vy = -12 - Math.random() * 6; f.vz = Math.cos(h) * v - Math.sin(h) * s * out;
      f.life = 4.2 + Math.random() * 0.8;
    }
  }
  function stepFlares(R, dt) {
    if (!R.flares || !R.fx) return;
    const F = R.fx;
    let n = 0;
    for (let i = 0; i < R.flares.length; i++) {
      const f = R.flares[i];
      if (f.life <= 0) continue;
      f.life -= dt;
      const sp = Math.hypot(f.vx, f.vy, f.vz) || 1, k = 1 / (1 + 0.012 * sp * dt);
      f.vx *= k; f.vz *= k; f.vy = f.vy * k - G0 * 0.55 * dt;
      f.x += f.vx * dt; f.y += f.vy * dt; f.z += f.vz * dt;
      if (f.life <= 0) continue;
      const g = clamp(f.life / 1.2, 0.2, 1);
      F.v.set(f.x, f.y, f.z); F.q.identity(); F.s.set(g, g, g);
      F.m.compose(F.v, F.q, F.s); F.fh.setMatrixAt(n, F.m);
      // the smoke trail hangs back along where it came from
      F.d.set(f.vx / sp, f.vy / sp, f.vz / sp);
      F.q.setFromUnitVectors(F.up, F.d);
      F.s.set(1, clamp(sp * 0.45, 2, 18), 1);
      F.m.compose(F.v, F.q, F.s); F.ft.setMatrixAt(n, F.m);
      n++;
    }
    F.fh.count = n; F.ft.count = n;
    if (n) { F.fh.instanceMatrix.needsUpdate = true; F.ft.instanceMatrix.needsUpdate = true; }
  }

  // =====================================================================
  //  THE RIG: every moving part, once per animate (the battle clock)
  // =====================================================================
  function tick(R, snap, dt, ctx) {
    if (!(dt > 0)) dt = 0;
    if (dt > 0.25) dt = 0.25;
    R.clock += dt;
    const g = R.group, N = R.nodes, A = axes();
    if (ctx && ctx.dead) R.dead = true;
    const dead = R.dead, veh = R.veh;
    if (R.first && ctx) { snap = true; R.first = false; }
    // ---- motion, read off the airframe's own transform
    const px = g.position.x, py = g.position.y, pz = g.position.z, h = g.rotation.y;
    if (!R.seeded || snap) { R.px = px; R.py = py; R.pz = pz; R.h0 = h; R.seeded = true; }
    if (dt > 0) {
      const k = Math.min(1, dt * 3);
      R.yawRate += (wrap(h - R.h0) / dt - R.yawRate) * k;
      R.vel.x = (px - R.px) / dt; R.vy = R.vel.y = (py - R.py) / dt; R.vel.z = (pz - R.pz) / dt;
    }
    R.px = px; R.py = py; R.pz = pz; R.h0 = h;
    const spd = ctx && isFinite(ctx.speed) ? ctx.speed : 0;
    const agl = ctx && isFinite(ctx.agl) ? ctx.agl : py - ground(ctx, px, pz);
    const airborne = agl > 3 && !R.crashed;
    if (dead && agl < 3 && !R.crashed) { R.crashed = true; R.crashV.x = R.vel.x; R.crashV.y = R.vel.y; R.crashV.z = R.vel.z; }
    if (ctx && dt > 0) { SKY.planeT = nowS(); skyStep(); }

    // ---- the bank: the coordinated angle for this turn, a transport's 30 deg at most;
    //      the battle's own roll is replaced (the lean node takes the difference)
    if (airborne && !dead) {
      const want = -clamp(Math.atan(spd * R.yawRate / G0), -0.52, 0.52);
      const b0 = R.bank;
      R.bank += (want - R.bank) * (snap ? 1 : Math.min(1, dt * 1.6));
      R.bankRate = dt > 0 ? (R.bank - b0) / dt : 0;
      R.lean.rotation.z = R.bank - g.rotation.z;
      R.lean.rotation.x = -0.05;                                   // the deck angle at drop speed
    } else {
      R.lean.rotation.z *= dt > 0 ? Math.max(0, 1 - dt * 2) : 0;
      R.lean.rotation.x *= dt > 0 ? Math.max(0, 1 - dt * 2) : 0;
      R.bankRate = 0;
    }

    // ---- the drop sequence: doors on the run-in, the stick on the dismount
    const S = veh && veh.def && veh.def.stats || {};
    const n = aboard(veh, R.pax);
    let runIn = false;
    if (veh && !veh.dismounted && airborne && !dead) {
      const t = veh.tgt && veh.tgt.pos && !veh.tgt.dead ? veh.tgt.pos : null;
      if (t) runIn = Math.hypot(t.x - px, t.z - pz) < (S.dismountAt || 600) + spd * 25;
    }
    // the battle unseats them all in one tick (vehDismount): the men aboard at
    // the last look are the stick
    if (veh && veh.dismounted && !R.drop && !snap) startDrop(R, R.paxPrev);
    if (!veh || !veh.dismounted) { R.paxPrev.length = 0; for (let i = 0; i < R.pax.length; i++) R.paxPrev.push(R.pax[i]); }
    const D = R.drop;
    const jumping = D && D.left > 0;
    const troops = (n > 0 || jumping) && !(D && D.cds);
    const cdsRun = (veh && !n && runIn) || (D && D.cds && D.cds.n < DROP.cdsN);
    // paratroop doors + deflectors + jumpmasters
    const doorT = airborne && ((runIn && troops) || jumping) ? 1 : 0;
    R.door = snap ? doorT : clamp(R.door + Math.sign(doorT - R.door) * dt / 1.8, 0, 1);
    const ds = smooth(0, 1, R.door);
    for (let side = 1; side >= -1; side -= 2) {
      const name = side > 0 ? "pdoorL" : "pdoorR", nd = N[name], o = NODES[name][1];
      nd.position.y = o[1] + 1.98 * ds; nd.position.x = o[0] - side * 0.10 * Math.min(1, ds * 5);
      nd.visible = ds < 0.98;
    }
    const df = smooth(0.4, 1, R.door);
    N.deflL.rotation.y = -df * 0.55; N.deflR.rotation.y = df * 0.55;
    N.jumpL.visible = N.jumpR.visible = R.door > 0.6 && !dead;
    const linesOn = D && D.linesT > 0 && !R.crashed;
    N.linesL.visible = N.linesR.visible = !!linesOn;
    if (linesOn) {
      const w = 0.04 * Math.sin(R.clock * 9);
      N.linesL.rotation.set(w, 0.02 * Math.sin(R.clock * 7), 0); N.linesR.rotation.set(-w, -0.02 * Math.sin(R.clock * 6), 0);
    }
    // ramp + cargo door: level (open) for a supply drop in the air, down to the ground parked
    const rampT = (airborne && cdsRun && !dead) ? 1 : 0;
    R.ramp = snap ? rampT : clamp(R.ramp + Math.sign(rampT - R.ramp) * dt / 4, 0, 1);
    const rs = smooth(0, 1, R.ramp);
    hinge(N.ramp, A.x, -0.33 * rs);
    hinge(N.cdoor, A.x, -1.05 * rs);
    // ---- gear: down parked, up into the sponsons and the nose bay in flight
    const gearT = airborne || (dead && !R.crashed) ? 0 : 1;
    R.gear = snap ? gearT : clamp(R.gear + Math.sign(gearT - R.gear) * dt / 6, 0, 1);
    const gs = smooth(0, 1, R.gear);
    N.gearL.position.y = NODES.gearL[1][1] + (1 - gs) * 1.25;
    N.gearR.position.y = NODES.gearR[1][1] + (1 - gs) * 1.25;
    N.gearN.position.y = NODES.gearN[1][1] + (1 - gs) * 0.95;
    N.gearN.rotation.x = -(1 - gs) * 0.35;
    // ---- flaps (drop setting on the run-in), ailerons, elevators, rudder
    const flapT = airborne && (runIn || jumping || cdsRun) ? 0.30 : 0;
    R.flap = snap ? flapT : R.flap + clamp(flapT - R.flap, -dt * 0.08, dt * 0.08);
    const ailT = dead ? 0 : clamp(R.bankRate * 0.6 + (R.bank - (airborne ? -clamp(Math.atan(spd * R.yawRate / G0), -0.52, 0.52) : 0)) * 0.8, -0.35, 0.35);
    R.ail += (ailT - R.ail) * Math.min(1, dt * 6 + (snap ? 1 : 0));
    const gam = ctx ? (ctx.gamma || 0) : 0, dgam = dt > 0 ? (gam - R.gamma0) / dt : 0;
    R.gamma0 = gam;
    const elT = dead ? 0.3 : clamp(-dgam * 2.5 - R.flap * 0.25, -0.3, 0.3);
    R.elev += (elT - R.elev) * Math.min(1, dt * 4 + (snap ? 1 : 0));
    R.rud += ((dead ? 0 : clamp(R.yawRate * 0.8, -0.2, 0.2)) - R.rud) * Math.min(1, dt * 3 + (snap ? 1 : 0));
    // a positive angle on a port hinge (axis outboard, +X) lifts the trailing edge
    hinge(N.flapL1, A.flapL1, -R.flap); hinge(N.flapL2, A.flapL2, -R.flap);
    hinge(N.flapR1, A.flapR1, -R.flap); hinge(N.flapR2, A.flapR2, -R.flap);
    hinge(N.ailL, A.ailL, R.ail); hinge(N.ailR, A.ailR, R.ail);
    hinge(N.elevL, A.elevL, R.elev); hinge(N.elevR, A.elevR, R.elev);
    hinge(N.rudder, A.rudder, R.rud);
    N.flapL1.position.z = NODES.flapL1[1][2] - R.flap * 0.9; N.flapR1.position.z = NODES.flapR1[1][2] - R.flap * 0.9;
    N.flapL2.position.z = NODES.flapL2[1][2] - R.flap * 0.8; N.flapR2.position.z = NODES.flapR2[1][2] - R.flap * 0.8;

    // ---- propellers: what a camera shutter shows of 842 rpm, plus the blur disc
    const T = R.T;
    for (let i = 0; i < R.props.length; i++) {
      const P = R.props[i];
      const on = !dead && !P.dead && (airborne || (ctx && ctx.speed > 0) || !ctx);
      const want = on ? (airborne ? 1 : 0.6) : 0;
      P.rpm += (want - P.rpm) * Math.min(1, dt * (want > P.rpm ? 0.8 : (R.crashed ? 3 : 0.35)));
      if (R.crashed) P.rpm = Math.max(0, P.rpm - dt * 2);
      const w = DIM.propRpm / 60 * TAU * P.rpm;
      P.a = (P.a + P.e.w * Math.min(w * dt, 0.36)) % TAU;
      P.node.rotation.z = P.a;
      P.disc.visible = dt > 0 && P.rpm > 0.5 && !P.bent;
      if (P.dead && P.rpm < 0.3 && P.mesh.geometry !== T.G.propF[P.e.w] && !P.bent) P.mesh.geometry = T.G.propF[P.e.w];
    }

    // ---- lights: beacons blink, the strobes double-flash, everything off when it dies
    const bOn = !dead && (R.clock % 1.0) < 0.12;
    const st = R.clock % 1.2, sOn = !dead && (st < 0.05 || (st > 0.14 && st < 0.19));
    for (let i = 0; i < R.beacons.length; i++) R.beacons[i].visible = bOn;
    for (let i = 0; i < R.strobes.length; i++) R.strobes[i].visible = sOn;
    for (let i = 0; i < R.lamps.length; i++) R.lamps[i].visible = !dead;

    // ---- the drop itself, the flares
    if (D && dt > 0) stepDrop(R, D, dt, ctx);
    if (dt > 0 && airborne && !dead) {
      // pairs on the run over the enemy (the DAS's pre-emptive programme), a salvo on a big hit
      R.flareT -= dt;
      if ((runIn || jumping) && agl < 900 && R.flareT <= 0) { R.flareT = 3.5 + Math.random() * 2.5; popFlares(R, 2, ctx); }
      if (R.salvo > 0) { popFlares(R, R.salvo, ctx); R.salvo = 0; }
    }
    if (dt > 0) stepFlares(R, dt);

    // ---- damage: engine smoke, fire, fuel mist off a holed wing
    if (dt > 0 && !R.burnt && CBZ.cityCrashSmoke) {
      R.smokeT -= dt;
      if (R.smokeT <= 0) {
        R.smokeT = airborne ? 0.18 : 0.6;
        try {
          for (let i = 0; i < R.props.length; i++) {
            const P = R.props[i];
            if (!P.smoke && !(dead && i % 2 === 0)) continue;
            const p = worldAt(N.body, P.e.x, P.e.ya + 0.3, P.e.zle - 1.5);
            CBZ.cityCrashSmoke(p.x, p.y, p.z, { count: 1, scale: dead || P.fire ? 1.4 : 0.8, shade: P.fire || dead ? 0.12 : 0.45, flame: !!(P.fire || (dead && R.fire)) });
          }
          if (R.hitWing && airborne) {
            const p = worldAt(N.body, 10.5, wingY(10.5) - 0.3, -4.6);
            CBZ.cityCrashSmoke(p.x, p.y, p.z, { count: 1, scale: 0.6, shade: 0.85 });
          }
        } catch (e) {}
      }
    }
    // ---- the wreck on the ground: tail off at the ramp, outer wings folded, props bent, burnt
    if (R.crashed) {
      if (!R.burnt) {
        R.burnt = true;
        for (let i = 0; i < R.paints.length; i++) R.paints[i].material = R.M.burnt;
        for (let i = 0; i < R.props.length; i++) {
          const P = R.props[i];
          P.bent = true; P.disc.visible = false;
          P.mesh.geometry = T.G.propF[P.e.w];
          P.mesh.scale.set(1, 1, 0.6); P.mesh.rotation.set(0.25 * (i % 2 ? 1 : -1), 0.3, 0);
        }
        N.linesL.visible = N.linesR.visible = false;
        N.jumpL.visible = N.jumpR.visible = false;
      }
      const k = snap ? 1 : Math.min(1, dt * 3);
      N.aft.rotation.x += (0.16 - N.aft.rotation.x) * k;
      N.aft.rotation.y += (0.22 - N.aft.rotation.y) * k;
      N.aft.position.y += (NODES.aft[1][1] - 0.9 - N.aft.position.y) * k;
      N.wingOutL.rotation.z += (-0.28 - N.wingOutL.rotation.z) * k;
      N.wingOutR.rotation.z += (0.22 - N.wingOutR.rotation.z) * k;
      R.lean.rotation.z += (0.06 - R.lean.rotation.z) * k;
    }
  }

  CBZ.unitKit.register("a400m", {
    kind: "vehicle",
    domain: "air",
    drive: "jet",
    /* A400M: 141 t max, ~100 t at a drop; 780 km/h cruise but the run-in and
       the drop are flown at ~125 kt (64 m/s), which is all the battle sees of
       it. Turning: a transport banks 25-30 deg, which at 64 m/s is ~0.085
       rad/s (a 750 m turn radius). Drop height 250 m AGL (~800 ft, a combat
       static-line jump). The stick goes when the nearest enemy is 640 m out
       (outside his rifles' effective range), and the aircraft goes home. */
    stats: { hp: 1100, mass: 100000, speed: 64, accel: 5, turn: 0.085, alt: 250,
      length: DIM.length, width: DIM.span, height: DIM.height,
      armour: { front: 4, side: 1, rear: 1, top: 1 },
      standoff: 0, dismountAt: 640, airdrop: true },
    crew: [{ seat: "pilot", pos: [-0.75, 5.3, 18.3] }, { seat: "copilot", pos: [0.75, 5.3, 18.3] }, { seat: "loadmaster", pos: [0, 2.4, -5.2] }],
    passengers: 116,
    // four rows down the hold: sidewall seats facing in, two centre rows back to back
    passengerPos: (function () {
      const out = [];
      for (let i = 0; i < 116; i++) {
        const row = i % 4, k = i >> 2;
        out.push([[1.72, 0.42, -0.42, -1.72][row], 2.1, 12.6 - k * 0.62]);
      }
      return out;
    })(),
    weapons: [],
    tactics: {
      role: "airlift",
      insert: "static-line", dropAGL: 250, dropSpeed: 64, stick: "both doors, alternating, " + DROP.perDoor + " s a door",
      dz: "dismountAt short of the nearest enemy, outside his rifles", egress: "home after the drop",
      engage: {}, priorities: [], hullDown: false, faceThreat: false, reverseOut: false,
      screen: "the stick it drops", evade: "DAS flares",
    },
    build: build,
    animate: function (veh, dt, ctx) {
      const r = veh && veh.rig;
      if (r && r.state) { r.state.veh = veh; tick(r.state, false, dt, ctx); }
    },
    // nothing to fire: a player who takes the Atlas over rides with the crew
    moves: function () { return null; },
  });
})();
