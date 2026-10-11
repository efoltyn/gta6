/* ============================================================
   units/vehicles/stryker_apc.js — M1126 STRYKER ICV, 8x8 infantry carrier (USA).

   Drawn here from scratch from the real vehicle (the old body was
   city/mil_armor.js's generic "apc" box). Units: metres, m/s, kg, armour in
   mm RHA equivalent. Nose is local +Z, the vehicle's LEFT is +X.

   THE REAL THING (M1126 ICV, the numbers this file is built on)
     6.95 m long, 2.72 m wide over the hull (3.62 m over the slat cage),
     hull roof 2.10 m, top of the RWS 2.67 m, ground clearance 0.53 m.
     ~17.2 t combat weight (19.5 t with slat). High-hardness steel hull
     (14.5 mm-proof frontal arc, 7.62 mm AP all round with the bolted MEXAS
     ceramic tiles), long shallow glacis, tumblehome upper sides, driver
     front LEFT, Caterpillar C7 (350 hp) front RIGHT with its exhaust on the
     right flank, Allison 3200SP. Eight Michelin 1200R20 XML tyres (r 0.56 m)
     with central tyre inflation, axles at 1.22 / 1.84 / 1.22 m, the front
     TWO axles steer (Ackermann about the rear pair), 8x8 / 8x4 drive,
     97 km/h, ~16 m turning circle. Rear hydraulic ramp with a door in it,
     two air-guard hatches over the troop bay, commander's cupola behind the
     M151 Protector remote weapon station (M2HB .50, 400 rounds in its ready
     box, 2,000 carried), two 4-tube M6 smoke dischargers. Crew 2 + 9.
     In Iraq it wore the SLAT CAGE: horizontal bars 0.42 m off the hull that
     short out or crush an RPG's fuze about half the time.

   THE RIG (what src/battle/vehicles.js talks to; def.animate drives it)
     update(dt, v, w, steer)  eight wheels: Ackermann steer on axles 1-2,
                              roll by distance, each sprung over the ground
                              (half-shafts follow), hull squat / dive / lean,
                              RWS recoil, hatches, heads out when calm, air
                              guards when carrying, exhaust, dust
     aimTurret(yaw, elev, dt) the RWS: 60 deg/s traverse, -20..+60 deg
     muzzleWorld(out, shot)   the M2's muzzle
     fire(shot)               flash, recoil, case + link out, 400-rd ready box
     canFire(shot)            false while the commander reloads the ready box
                              (25 s, head out: the real RWS has to be fed by hand)
     damage(vs, res)          flat tyre + list, RWS knocked out, engine fire,
                              an RPG caught by the slat (res.slat)
     mark(nation, ground)     desert: tan 686A + the slat cage (Iraq);
                              green ground: Green 383, no slat (Europe)
   KNOCKED OUT: hatches blown open, crew gone, the tyres burn down to the
   rims and the hull settles on them; a catastrophic kill throws the RWS
   and drops the ramp.

   PERF. One template per scheme (geometry + materials shared by every
   Stryker). Wheels = 3 instanced meshes (tyres, rims, half-shafts); the
   matrices are rewritten only while the hull moves. Exhaust, dust, fire and
   smoke are two shared point clouds, the .50 cases one instanced mesh.
   Nothing allocates per frame.
============================================================ */
(function () {
  "use strict";
  const W = typeof window !== "undefined" ? window : globalThis;
  const CBZ = W.CBZ;
  if (!CBZ || !CBZ.unitKit) return;
  const PI = Math.PI, TAU = PI * 2;
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function wrap(a) { while (a > PI) a -= TAU; while (a < -PI) a += TAU; return a; }
  function now() { return W.performance && W.performance.now ? W.performance.now() : Date.now(); }
  function smooth(a, b, x) { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }

  /* ---------------------------------------------------------- the numbers */
  const H = {
    HL: 3.475, roof: 2.10, belly: 0.53, lowW: 0.90, lowW2: 0.98, sponB: 1.24, spon: 1.36, sponT: 1.52, roofW: 1.16,
    glZ: 1.95, noseZ: 3.30, noseY: 1.35, tipY: 1.25, lowZ: 2.72, lowTipY: 1.12, rearBot: 0.80, rearBevZ: -3.15,
  };
  // the wheels: z of each axle, tyre radius, track (centre of tyre), travel
  const WH = { z: [2.05, 0.83, -1.01, -2.23], x: 1.17, r: 0.556, w: 0.32, rimR: 0.27, up: 0.12, down: 0.16 };
  WH.zc = (WH.z[2] + WH.z[3]) / 2;                         // the turning centre line (rear pair)
  WH.wb = WH.z[0] - WH.zc;                                   // effective wheelbase, 3.67 m
  const RWS = { x: -0.18, z: 0.55, rate: 1.05, accel: 6, elevRate: 1.0, elevMin: -0.35, elevMax: 1.05, armY: 0.36, muz: 1.40 };
  const CMD = { x: 0.32, z: -0.22 }, DRV = { x: 0.60, z: 1.62 };
  const SLAT = { x: 1.78, y0: 0.78, y1: 2.02, zf: 3.25, zr: -3.88, nose: 3.92, pitch: 0.088, p: 0.5 };
  function wmul(z) { return z > 2.95 ? 1 - 0.13 * smooth(2.95, H.HL, z) : z < -3.3 ? 1 - 0.025 * smooth(-3.3, -H.HL, z) : 1; }
  function topAt(z) {
    if (z <= H.glZ) return H.roof;
    if (z <= H.noseZ) return H.roof + (z - H.glZ) * (H.noseY - H.roof) / (H.noseZ - H.glZ);
    return H.noseY + (z - H.noseZ) * (H.tipY - H.noseY) / (H.HL - H.noseZ);
  }
  function zAtTop(y) { return H.glZ + (H.roof - y) / (H.roof - H.noseY) * (H.noseZ - H.glZ); }
  function botAt(z) {
    if (z >= H.lowZ) return H.belly + (z - H.lowZ) * (H.lowTipY - H.belly) / (H.HL - H.lowZ);
    if (z <= H.rearBevZ) return H.belly + (H.rearBevZ - z) * (H.rearBot - H.belly) / (H.rearBevZ + H.HL);
    return H.belly;
  }
  // the upper side (tumblehome) at height y: its x on the +X side
  function sideX(y) { return y <= H.sponT ? H.spon : H.spon + (y - H.sponT) * (H.roofW + 0.05 - H.spon) / (H.roof - 0.05 - H.sponT); }
  const TUMBLE = Math.atan2(H.spon - H.roofW - 0.05, H.roof - 0.05 - H.sponT);
  const GLACIS = Math.atan2(H.roof - H.noseY, H.noseZ - H.glZ);

  /* ---------------------------------------------------------- the weapon
     M2HB .50 on the M151 Protector: 450-600 rds/min, the RWS fires it in
     bursts off its own sight (laser range finder, thermal); 1,800 m against
     an area, AP-M2 defeats ~24 mm at combat range. */
  const M2 = { id: "m2_50cal_rws", seat: "commander", kind: "mg", wid: "lmg", turret: true, rof: 9.2, burst: 9, pause: 1.3,
    dmg: 38, pen: 24, range: 1800, ammo: 2000 };
  const READY = 400;                      // the RWS ammunition can

  CBZ.unitKit.register("stryker_apc", {
    kind: "vehicle",
    domain: "ground",
    drive: "wheeled",
    stats: { hp: 460, mass: 19500, speed: 27, reverse: 8, accel: 1.4, turn: 0.7, wheelbase: WH.wb, maxSteer: 0.44,
      length: 6.95, width: 2.72, height: 2.67,
      // steel hull + MEXAS: 14.5 mm AP from the front, 7.62 AP round the sides
      armour: { front: 35, side: 18, rear: 14, top: 10 },
      armourCE: { front: 40, side: 22, rear: 16, top: 10 },
      // (the slat cage is per hull: rig.slat sets veh.vs.slat, read by the kit's resolve())
      standoff: 380, dismountAt: 300 },
    turret: { rate: RWS.rate, elevRate: RWS.elevRate, elevMin: RWS.elevMin, elevMax: RWS.elevMax },
    crew: [
      { seat: "driver", pos: [DRV.x, 1.45, DRV.z] },
      { seat: "commander", pos: [CMD.x, 1.55, CMD.z] },
    ],
    passengers: 9,
    // the squad: two benches of four facing in, one seat behind the commander
    benches: [[0.72, 1.2, -0.9], [-0.72, 1.2, -0.9], [0.72, 1.2, -1.5], [-0.72, 1.2, -1.5], [0.72, 1.2, -2.1], [-0.72, 1.2, -2.1],
      [0.72, 1.2, -2.7], [-0.72, 1.2, -2.7], [-0.40, 1.25, -0.35]],
    weapons: [M2],
    /* TACTICS, for the AI layer (src/battle/ai/*): an APC is a battle taxi
       with a heavy machine gun. It carries the squad to 300 m short of the
       fight, drops the ramp, then supports by fire from a covered spot
       behind them. It does not duel armour or ATGM teams: it pops smoke and
       backs out. The RWS lets it fight hull-down (only the weapon station
       over the crest). */
    tactics: {
      role: "apc",
      engage: { soft: 1500, armour: 0, close: 25 },
      priorities: ["launcher", "atgm", "mg", "men", "beast", "vehicle"],
      hullDown: true,           // only the RWS over the crest
      faceThreat: true,         // 35 mm front, 18 mm sides
      reverseOut: true,         // back out of a fire sack, never turn the flank
      avoidArmour: true,        // tanks and IFVs are the infantry's (Javelin) problem
      smoke: "contact",         // M6 smoke at the first penetrating hit or a rocket team in range
      dismount: { at: 300, cover: true },   // drop the squad behind cover short of the fight
      overwatch: 380,           // support-by-fire distance behind the dismounts
      screen: { need: "men", ahead: 50, spread: 40 },
      crush: true,
      buttonUp: "contact",
    },
    build: function (ctx) { return buildStryker(ctx || {}); },
    animate: function (veh, dt, ctx) { const r = veh.rig; if (r && r.step) r.step(veh, dt, ctx); else if (ctx && ctx.shared) ctx.shared(dt); },
    /* A PLAYER AT THE CONTROLS (the moves hook, src/units/kit/moves.js
       grammar, for a vehicle): what the crew would do with the mark. The
       runtime's vehicle driver (vehYouSeatWeapon) picks the gun today; this
       says how to work it. */
    moves: function (veh, tgt, ctx) {
      const d = ctx && ctx.dist != null ? ctx.dist : 99;
      if (!tgt) return { id: "rws_scan", style: "rws", weapon: M2.id, burst: 0, cd: 0.5 };
      const armour = tgt.vehicle && tgt.def && tgt.def.stats && tgt.def.stats.armour ? tgt.def.stats.armour.front || 0 : 0;
      if (armour > M2.pen * 2) return { id: "pop_smoke", style: "smoke", weapon: "m6_smoke", cd: 30 };   // an APC does not duel a tank
      if (!tgt.vehicle && d < 12 && (ctx.speed || 0) > 3) return { id: "crush", style: "ram", pow: 1, leap: 0, cd: 1.2 };
      if (tgt.launcher) return { id: "rws_long", style: "rws", weapon: M2.id, burst: 15, cd: 0.6 };
      return d > 600 ? { id: "rws_burst", style: "rws", weapon: M2.id, burst: 6, cd: 1.2 }
        : { id: "rws_burst_close", style: "rws", weapon: M2.id, burst: 10, cd: 0.8 };
    },
  });

  /* =========================================================== THREE side */
  let THREE = null;
  const _m = {}, TPL = {};
  function scratch() {
    if (_m.v) return;
    _m.v = new THREE.Vector3(); _m.v2 = new THREE.Vector3(); _m.v3 = new THREE.Vector3();
    _m.q = new THREE.Quaternion(); _m.e = new THREE.Euler(); _m.s = new THREE.Vector3();
    _m.m = new THREE.Matrix4(); _m.c = new THREE.Color(); _m.v2d = new THREE.Vector2();
  }
  function M4(x, y, z, rx, ry, rz, sx, sy, sz) {
    _m.e.set(rx || 0, ry || 0, rz || 0, "XYZ");
    _m.q.setFromEuler(_m.e);
    _m.v.set(x || 0, y || 0, z || 0);
    _m.s.set(sx == null ? 1 : sx, sy == null ? 1 : sy, sz == null ? 1 : sz);
    return _m.m.compose(_m.v, _m.q, _m.s);
  }

  /* ---- the plate builder: triangles bucketed per material slot, flat
     normals for plate, box-projected UVs, a tint per piece, grime by height */
  function Builder() { this.slots = {}; }
  Builder.prototype.S = function (n) { return this.slots[n] || (this.slots[n] = { p: [], n: [], c: [] }); };
  Builder.prototype.col = function (t) {
    if (t == null) return [1, 1, 1];
    if (typeof t === "number" && t <= 1.5) return [t, t, t];
    if (typeof t === "number") { _m.c.setHex(t); return [_m.c.r, _m.c.g, _m.c.b]; }
    return t;
  };
  Builder.prototype.tri = function (slot, A, B, C, ref, tint) {
    const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2], vx = C[0] - A[0], vy = C[1] - A[1], vz = C[2] - A[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (l < 1e-10) return;
    nx /= l; ny /= l; nz /= l;
    if (ref) {
      const mx = (A[0] + B[0] + C[0]) / 3 - ref[0], my = (A[1] + B[1] + C[1]) / 3 - ref[1], mz = (A[2] + B[2] + C[2]) / 3 - ref[2];
      if (nx * mx + ny * my + nz * mz < 0) { const t = B; B = C; C = t; nx = -nx; ny = -ny; nz = -nz; }
    }
    const s = this.S(slot), c = this.col(tint);
    s.p.push(A[0], A[1], A[2], B[0], B[1], B[2], C[0], C[1], C[2]);
    for (let i = 0; i < 3; i++) { s.n.push(nx, ny, nz); s.c.push(c[0], c[1], c[2]); }
  };
  Builder.prototype.geo = function (slot, g, m4, tint) {
    const gg = g.index ? g.toNonIndexed() : g;
    if (gg !== g) g.dispose();
    if (m4) gg.applyMatrix4(m4);
    const p = gg.attributes.position.array, n = gg.attributes.normal.array, s = this.S(slot), c = this.col(tint);
    for (let i = 0; i < p.length; i++) { s.p.push(p[i]); s.n.push(n[i]); }
    for (let i = 0; i < p.length / 3; i++) s.c.push(c[0], c[1], c[2]);
    gg.dispose();
  };
  Builder.prototype.box = function (slot, x, y, z, w, h, d, rx, ry, rz, tint) {
    this.geo(slot, new THREE.BoxGeometry(w, h, d), M4(x, y, z, rx, ry, rz), tint);
  };
  Builder.prototype.cyl = function (slot, x, y, z, rTop, rBot, len, axis, seg, rx, ry, rz, tint, open) {
    const g = new THREE.CylinderGeometry(rTop, rBot, len, seg || 12, 1, !!open);
    if (axis === "x") g.rotateZ(-PI / 2); else if (axis === "z") g.rotateX(PI / 2);
    this.geo(slot, g, M4(x, y, z, rx, ry, rz), tint);
  };
  Builder.prototype.ball = function (slot, x, y, z, r, sx, sy, sz, tint, wseg, hseg) {
    this.geo(slot, new THREE.SphereGeometry(r, wseg || 10, hseg || 8), M4(x, y, z, 0, 0, 0, sx, sy, sz), tint);
  };
  // LOFT: closed solid through convex slices along an axis.
  // axis 'z': pts [x, y]; 'y': pts [x, z]; 'x': pts [z, y]. caps: [first, last] (default both)
  Builder.prototype.loft = function (slot, axis, slices, tint, caps) {
    const P = axis === "z" ? function (a, p, q) { return [p, q, a]; } : axis === "y" ? function (a, p, q) { return [p, a, q]; } : function (a, p, q) { return [a, q, p]; };
    const rings = slices.map(function (s) { return s[1].map(function (pt) { return P(s[0], pt[0], pt[1]); }); });
    const cents = rings.map(function (r) { const c = [0, 0, 0]; r.forEach(function (v) { c[0] += v[0]; c[1] += v[1]; c[2] += v[2]; }); return [c[0] / r.length, c[1] / r.length, c[2] / r.length]; });
    for (let i = 0; i < rings.length - 1; i++) {
      const r0 = rings[i], r1 = rings[i + 1], n = r0.length;
      const ref = [(cents[i][0] + cents[i + 1][0]) / 2, (cents[i][1] + cents[i + 1][1]) / 2, (cents[i][2] + cents[i + 1][2]) / 2];
      for (let j = 0; j < n; j++) {
        const k = (j + 1) % n;
        this.tri(slot, r0[j], r0[k], r1[k], ref, tint);
        this.tri(slot, r0[j], r1[k], r1[j], ref, tint);
      }
    }
    const last = rings.length - 1, self = this;
    caps = caps || [true, true];
    [[0, 1, caps[0]], [last, last - 1, caps[1]]].forEach(function (pr) {
      if (!pr[2]) return;
      const r = rings[pr[0]], c = cents[pr[0]], ref = cents[pr[1]];
      for (let j = 0; j < r.length; j++) self.tri(slot, c, r[j], r[(j + 1) % r.length], ref, tint);
    });
  };
  // a flat convex polygon in the plane z = z0 (pts [x, y]), facing nz
  Builder.prototype.face = function (slot, pts, z0, nz, tint) {
    if (pts.length < 3) return;
    const ref = [0, 0, z0 - nz];
    let cx = 0, cy = 0;
    pts.forEach(function (p) { cx += p[0]; cy += p[1]; });
    cx /= pts.length; cy /= pts.length;
    for (let j = 0; j < pts.length; j++) {
      const a = pts[j], b = pts[(j + 1) % pts.length];
      this.tri(slot, [cx, cy, z0], [a[0], a[1], z0], [b[0], b[1], z0], ref, tint);
    }
  };
  // a plate lying ON the glacis, centred at (x, z) of the glacis line
  Builder.prototype.onGlacis = function (slot, x, z, w, h, d, tint) {
    const a = GLACIS;
    this.box(slot, x, topAt(z) + h / 2 * Math.cos(a), z + h / 2 * Math.sin(a), w, h, d, a, 0, 0, tint);
  };
  // a plate lying ON the upper side (tumblehome) of side s at height y, z
  Builder.prototype.onSide = function (slot, s, y, z, w, h, d, tint) {
    const x = sideX(y), a = TUMBLE;
    this.box(slot, s * (x + h / 2 * Math.cos(a)), y + h / 2 * Math.sin(a), z, h, w, d, 0, 0, s * a, tint);
  };
  Builder.prototype.build = function (opts) {
    opts = opts || {};
    const out = {}, self = this;
    Object.keys(this.slots).forEach(function (k) {
      const s = self.slots[k];
      const P = new Float32Array(s.p), N = new Float32Array(s.n), C = new Float32Array(s.c);
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(P, 3));
      g.setAttribute("normal", new THREE.BufferAttribute(N, 3));
      if (opts.grime && opts.grime[k]) {
        const y0 = opts.y0 || 0;
        for (let i = 0; i < P.length / 3; i++) {
          const y = P[i * 3 + 1] + y0, ny = N[i * 3 + 1];
          // road dirt thrown up by the tyres: lower hull dusty and darker
          let f = 1 - 0.26 * smooth(1.5, 0.5, y);
          if (ny < -0.5) f *= 0.5; else if (ny > 0.7) f *= 1.05;
          C[i * 3] = Math.min(1, C[i * 3] * f); C[i * 3 + 1] = Math.min(1, C[i * 3 + 1] * f * 0.985); C[i * 3 + 2] = Math.min(1, C[i * 3 + 2] * f * 0.95);
        }
      }
      if (opts.vc && opts.vc[k]) g.setAttribute("color", new THREE.BufferAttribute(C, 3));
      if (opts.uv && opts.uv[k]) {
        const U = new Float32Array(P.length / 3 * 2), sc = 1 / 4;
        for (let i = 0; i < P.length / 3; i++) {
          const ax = Math.abs(N[i * 3]), ay = Math.abs(N[i * 3 + 1]), az = Math.abs(N[i * 3 + 2]);
          const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
          if (ax >= ay && ax >= az) { U[i * 2] = z * sc; U[i * 2 + 1] = y * sc; }
          else if (ay >= az) { U[i * 2] = x * sc + 0.37; U[i * 2 + 1] = z * sc + 0.61; }
          else { U[i * 2] = x * sc + 0.13; U[i * 2 + 1] = y * sc + 0.29; }
        }
        g.setAttribute("uv", new THREE.BufferAttribute(U, 2));
      }
      g.computeBoundingBox(); g.computeBoundingSphere();
      out[k] = g;
    });
    return out;
  };

  /* ---- paint: CARC tan 686A or Green 383, solid (Strykers are not
     patterned), weathered: a low-frequency mottle, streaks running down,
     dust. A periodic value-noise field so the box projection tiles. -------- */
  function hash(i, j, s) { let h = (i * 374761393 + j * 668265263 + s * 2246822519) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
  function vnoise(x, y, P, s) {
    const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
    const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    const m = function (a) { return ((a % P) + P) % P; };
    const a = hash(m(xi), m(yi), s), b = hash(m(xi + 1), m(yi), s), c = hash(m(xi), m(yi + 1), s), d = hash(m(xi + 1), m(yi + 1), s);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  function fbm(x, y, P, s) { return vnoise(x, y, P, s) * 0.55 + vnoise(x * 2, y * 2, P * 2, s + 1) * 0.3 + vnoise(x * 4, y * 4, P * 4, s + 2) * 0.15; }
  const SCHEME = {
    desert: { base: [186, 165, 124], gear: 0xa99572, slat: true },
    green: { base: [78, 86, 62], gear: 0x4c5440, slat: false },
  };
  function paintTexture(name) {
    if (typeof document === "undefined" || !document.createElement) return null;
    const N = 256, cv = document.createElement("canvas"); cv.width = cv.height = N;
    const g = cv.getContext && cv.getContext("2d");
    if (!g) return null;
    const im = g.createImageData ? g.createImageData(N, N) : null;
    if (!im || !im.data || !g.putImageData) return null;
    const a = im.data, c = SCHEME[name].base;
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const u = x / N * 4, v = y / N * 4;
        // mottle + vertical rain streaks + fine speckle
        const m = 0.9 + 0.13 * fbm(u * 2, v * 2, 8, 5) + 0.05 * (fbm(u * 10, v * 0.6, 40, 3) - 0.5) + (hash(x, y, 9) - 0.5) * 0.045;
        const i = (y * N + x) * 4;
        a[i] = clamp(c[0] * m, 0, 255); a[i + 1] = clamp(c[1] * m, 0, 255); a[i + 2] = clamp(c[2] * m * 0.99, 0, 255); a[i + 3] = 255;
      }
    }
    g.putImageData(im, 0, 0);
    const t = new THREE.CanvasTexture(cv);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    if (THREE.sRGBEncoding != null) t.encoding = THREE.sRGBEncoding;
    t.anisotropy = 4;
    return t;
  }
  function std(o) {
    const m = new THREE.MeshStandardMaterial(Object.assign({ roughness: 0.8, metalness: 0.1, envMap: CBZ.ENV || null, envMapIntensity: 0.45 }, o));
    m._shared = true;
    return m;
  }
  function materials(scheme) {
    const sc = SCHEME[scheme], tex = paintTexture(scheme), b = sc.base;
    return {
      paint: std(tex ? { color: 0xffffff, map: tex, vertexColors: true, roughness: 0.8, metalness: 0.12 }
        : { color: (b[0] << 16) | (b[1] << 8) | b[2], vertexColors: true }),
      gear: std({ color: sc.gear, vertexColors: true, roughness: 0.75, metalness: 0.2 }),
      rubber: std({ color: 0x232322, vertexColors: true, roughness: 0.93, metalness: 0.0, envMapIntensity: 0.15 }),
      dark: std({ color: 0x1d1f20, roughness: 0.75, metalness: 0.3 }),
      inside: std({ color: 0x55574e, roughness: 0.9, metalness: 0.1, side: THREE.BackSide }),
      metal: std({ color: 0x34373a, roughness: 0.45, metalness: 0.6 }),
      gun: std({ color: 0x2a2c2d, roughness: 0.5, metalness: 0.65 }),
      glass: std({ color: 0x12222b, roughness: 0.1, metalness: 0.5, emissive: 0x03080a }),
      lamp: std({ color: 0xe8e2c8, roughness: 0.2, metalness: 0.2, emissive: 0x3a3424 }),
      tail: std({ color: 0x8a1c12, roughness: 0.3, metalness: 0.1, emissive: 0x2a0606 }),
      canvas: std({ color: 0xffffff, vertexColors: true, roughness: 0.95, metalness: 0 }),
      crew: std({ color: 0xffffff, vertexColors: true, roughness: 0.75, metalness: 0 }),
    };
  }
  const VC = { paint: 1, gear: 1, rubber: 1, canvas: 1, crew: 1 };

  /* ------------------------------------------------------------ the hull */
  // the hull's cross-section at z (the +X half, bottom to top, then mirrored)
  function hullSect(z) {
    const t = topAt(z), b = botAt(z), k = wmul(z), cy = function (y) { return clamp(y, b, t); };
    const h = [[H.lowW, b], [H.lowW2, cy(H.sponB - 0.04)], [H.spon - 0.02, cy(H.sponB)], [H.spon, cy(H.sponB + 0.03)],
      [H.spon, cy(H.sponT)], [H.roofW + 0.05, cy(H.roof - 0.05)], [H.roofW, cy(H.roof)]];
    const out = [];
    h.forEach(function (p) { out.push([p[0] * k, p[1]]); });
    for (let i = h.length - 1; i >= 0; i--) out.push([-h[i][0] * k, h[i][1]]);
    return out;
  }
  // Sutherland-Hodgman: keep the part of a convex polygon where a*x + b*y <= c
  function clipPoly(pts, a, b, c) {
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const P = pts[i], Q = pts[(i + 1) % pts.length];
      const dp = a * P[0] + b * P[1] - c, dq = a * Q[0] + b * Q[1] - c;
      if (dp <= 0) out.push(P);
      if ((dp < 0 && dq > 0) || (dp > 0 && dq < 0)) { const t = dp / (dp - dq); out.push([P[0] + (Q[0] - P[0]) * t, P[1] + (Q[1] - P[1]) * t]); }
    }
    return out;
  }
  const RAMP = { w: 0.64, y0: 0.86, y1: 1.96 };     // the ramp opening, half width, sill, head
  function buildHull(B) {
    const zs = [-H.HL, -3.3, H.rearBevZ, H.lowZ, H.glZ, zAtTop(H.roof - 0.05), zAtTop(H.sponT), zAtTop(H.sponB + 0.03), zAtTop(H.sponB),
      2.95, 3.1, H.noseZ, H.HL].filter(function (z) { return z >= -H.HL && z <= H.HL; }).sort(function (a, b) { return a - b; });
    // the rear face is drawn round the ramp opening below, so no rear cap
    B.loft("paint", "z", zs.map(function (z) { return [z, hullSect(z)]; }), null, [false, true]);
    const rear = hullSect(-H.HL), zr = -H.HL;
    B.face("paint", clipPoly(rear, -1, 0, -RAMP.w), zr, -1);        // x >= w  (the left of the ramp)
    B.face("paint", clipPoly(rear, 1, 0, -RAMP.w), zr, -1);         // x <= -w
    B.face("paint", clipPoly(clipPoly(clipPoly(rear, 1, 0, RAMP.w), -1, 0, RAMP.w), 0, -1, -RAMP.y1), zr, -1);   // over the door
    B.face("paint", clipPoly(clipPoly(clipPoly(rear, 1, 0, RAMP.w), -1, 0, RAMP.w), 0, 1, RAMP.y0), zr, -1);     // the sill
    // the troop bay, seen when the ramp is down: walls, benches, the squad's kit
    B.box("inside", 0, 1.36, -2.0, 1.92, 1.34, 2.9);
    [-1, 1].forEach(function (s) {
      B.box("dark", s * 0.74, 1.02, -1.95, 0.42, 0.06, 2.4);
      B.box("dark", s * 0.92, 1.42, -1.95, 0.06, 0.55, 2.4);
      for (let i = 0; i < 4; i++) B.box("canvas", s * 0.85, 1.75, -0.95 - i * 0.6, 0.14, 0.32, 0.38, 0, 0, 0, 0x5d5b46);
    });
    B.box("dark", 0, 0.82, -2.0, 1.2, 0.04, 2.9);

    // MEXAS: bolted ceramic tiles on the vertical band and the tumblehome
    [-1, 1].forEach(function (s) {
      for (let z = -3.28; z < 2.75; z += 0.56) {
        const z1 = Math.min(z + 0.54, 2.86);
        B.box("paint", s * (H.spon + 0.016), (H.sponB + H.sponT) / 2 + 0.01, (z + z1) / 2, 0.032, H.sponT - H.sponB - 0.04, z1 - z - 0.02, 0, 0, 0, 0.97);
        [z + 0.07, z1 - 0.07].forEach(function (bz) { [H.sponB + 0.06, H.sponT - 0.05].forEach(function (by) { B.cyl("paint", s * (H.spon + 0.036), by, bz, 0.013, 0.016, 0.014, "x", 6, 0, 0, 0, 0.8); }); });
      }
      for (let z = -3.28; z < 1.85; z += 0.56) {
        [1.66, 1.90].forEach(function (y) {
          B.onSide("paint", s, y - 0.11, z + 0.27, 0.23, 0.03, 0.54, 0.95);
          B.onSide("paint", s, y - 0.02, z + 0.07, 0.024, 0.04, 0.024, 0.8);
          B.onSide("paint", s, y - 0.02, z + 0.47, 0.024, 0.04, 0.024, 0.8);
        });
      }
      // the forward side panel run along the glacis line
      for (let z = 1.95; z < 2.8; z += 0.42) {
        const y1 = Math.min(H.roof - 0.08, topAt(z + 0.4) - 0.06);
        if (y1 > H.sponT + 0.08) B.onSide("paint", s, H.sponT + 0.02 + (y1 - H.sponT) / 2 - 0.04, z + 0.2, y1 - H.sponT - 0.06, 0.03, 0.4, 0.95);
      }
      // mud flaps between the axle pairs and behind the last wheels
      [-0.09, -2.92, 2.78].forEach(function (z) { B.box("dark", s * 1.17, 0.84, z, 0.34, 0.66, 0.02); });
      // side marker lights, a step, the fuel filler on the left
      B.box("tail", s * (H.spon + 0.02), 1.30, -3.35, 0.02, 0.05, 0.08);
      B.box("lamp", s * (H.spon + 0.02), 1.30, 2.75, 0.02, 0.05, 0.08);
      B.box("metal", s * (H.spon + 0.04), 1.18, -3.05, 0.06, 0.03, 0.34);
      // HEADLIGHT clusters in brush guards at the nose corners
      const hz = 3.24, hy = topAt(hz) + 0.10, hx = s * 1.02;
      B.box("paint", hx, hy, hz, 0.30, 0.18, 0.18, 0, 0, 0, 0.88);
      B.cyl("lamp", hx + s * 0.06, hy + 0.01, hz + 0.091, 0.055, 0.055, 0.01, "z", 12);
      B.box("tail", hx - s * 0.08, hy + 0.01, hz + 0.091, 0.06, 0.05, 0.01);
      [-0.13, 0, 0.13].forEach(function (dx) { B.cyl("metal", hx + dx, hy + 0.02, hz + 0.18, 0.011, 0.011, 0.24, "y", 5); });
      B.cyl("metal", hx, hy + 0.14, hz + 0.18, 0.011, 0.011, 0.30, "x", 5);
      B.cyl("metal", hx, hy + 0.14, hz + 0.09, 0.011, 0.011, 0.18, "z", 5);
      // TOW SHACKLES front and rear
      B.box("paint", s * 0.62, 1.05, H.HL - 0.04, 0.12, 0.16, 0.14, 0, 0, 0, 0.85);
      B.cyl("metal", s * 0.62, 1.05, H.HL + 0.04, 0.05, 0.05, 0.05, "x", 10, 0, 0, 0, null, true);
      B.cyl("metal", s * 0.78, 0.78, -H.HL - 0.05, 0.05, 0.05, 0.05, "x", 10, 0, 0, 0, null, true);
      // MIRRORS on folding stalks at the front corners
      B.cyl("metal", s * 1.26, 1.86, 2.25, 0.012, 0.012, 0.42, "x", 5, 0, 0, s * 0.35);
      B.box("dark", s * 1.46, 1.96, 2.25, 0.04, 0.22, 0.16, 0, s * 0.3, 0);
      B.box("glass", s * 1.47, 1.96, 2.17, 0.02, 0.19, 0.005, 0, s * 0.3, 0);
      // M6 SMOKE DISCHARGERS: four tubes a bank, splayed out and up
      const mz = 2.45, my = topAt(mz) + 0.05, mx = s * 0.98;
      B.box("paint", mx, my, mz, 0.24, 0.10, 0.22, GLACIS, 0, 0, 0.85);
      for (let r = 0; r < 2; r++) for (let c = 0; c < 2; c++) {
        B.cyl("dark", mx + s * (c * 0.085 - 0.04), my + 0.08 + r * 0.075, mz + 0.06, 0.033, 0.035, 0.20, "z", 8, -0.65, s * 0.45, 0);
      }
      // the REAR: stowage boxes either side of the ramp, lights on them
      const bx = s * 1.02;
      B.box("paint", bx, 1.42, -H.HL - 0.17, 0.60, 0.80, 0.34, 0, 0, 0, 0.95);
      B.box("paint", bx, 1.84, -H.HL - 0.17, 0.62, 0.04, 0.37, 0, 0, 0, 0.9);
      B.box("dark", bx, 1.45, -H.HL - 0.342, 0.46, 0.01, 0.01);
      B.box("tail", bx + s * 0.20, 1.70, -H.HL - 0.345, 0.08, 0.10, 0.012);
      B.box("lamp", bx + s * 0.20, 1.58, -H.HL - 0.345, 0.08, 0.06, 0.012);
      B.box("metal", bx - s * 0.12, 1.25, -H.HL - 0.345, 0.04, 0.03, 0.03);
      // GRAB RAILS along the roof edge
      B.cyl("metal", s * 1.12, H.roof + 0.09, -1.4, 0.013, 0.013, 1.6, "z", 5);
      [-2.15, -0.65].forEach(function (z) { B.cyl("metal", s * 1.12, H.roof + 0.045, z, 0.013, 0.013, 0.09, "y", 5); });
    });
    // jerry cans on the right stowage box, a camo net roll on the left
    [-0.88, -1.12].forEach(function (x) { B.box("canvas", x, 1.36, -H.HL - 0.47, 0.17, 0.46, 0.13, 0, 0, 0, 0x55603f); });
    B.box("metal", -1.0, 1.36, -H.HL - 0.40, 0.44, 0.03, 0.03);
    B.cyl("canvas", 1.0, 1.94, -H.HL - 0.17, 0.12, 0.12, 0.58, "x", 10, 0, 0, 0, 0x6c6a4a);

    // GLACIS: MEXAS tiles on the left (driver) half, the engine deck on the
    // right: access panel, louvred grilles, the air intake
    for (let z = 2.0; z < 3.2; z += 0.4) for (let x = 0.1; x < 1.0; x += 0.45) B.onGlacis("paint", x + 0.22, z + 0.19, 0.42, 0.03, 0.37, 0.96);
    B.onGlacis("paint", -0.45, 2.55, 0.80, 0.012, 1.15, 0.9);
    for (let i = 0; i < 7; i++) B.onGlacis("dark", -0.45, 2.12 + i * 0.12, 0.66, 0.02, 0.05);
    B.onGlacis("paint", -0.45, 3.08, 0.70, 0.06, 0.12, 0.85);
    for (let x = -1.05; x < -0.0; x += 0.2) B.onGlacis("paint", x, 1.99, 0.04, 0.02, 0.04, 0.75);
    // the nose: front bumper, the winch fairlead, the trim of the lower plate
    B.box("paint", 0, H.lowTipY + 0.05, H.HL + 0.02, 2.2, 0.10, 0.06, 0, 0, 0, 0.82);
    B.box("dark", 0, H.lowTipY - 0.06, H.HL - 0.02, 0.26, 0.10, 0.04);
    B.box("metal", 0, H.lowTipY - 0.06, H.HL + 0.01, 0.14, 0.04, 0.03);
    // the EXHAUST on the right flank, under its heat shield
    B.onSide("paint", -1, 1.80, 1.35, 0.30, 0.05, 0.72, 0.85);
    for (let i = 0; i < 5; i++) B.onSide("dark", -1, 1.71 + i * 0.045, 1.35, 0.012, 0.06, 0.6);
    B.cyl("dark", -(sideX(1.62) + 0.09), 1.62, 1.08, 0.055, 0.06, 0.16, "x", 10);

    // ROOF: driver's hatch ring + 3 periscopes, RWS base, commander's cupola,
    // the air-guard hatch frames, antenna bases, the GPS dome
    B.cyl("paint", DRV.x, H.roof + 0.03, DRV.z, 0.33, 0.35, 0.06, "y", 18);
    [-0.4, 0, 0.4].forEach(function (a) {
      const px = DRV.x + Math.sin(a) * 0.40, pz = DRV.z + Math.cos(a) * 0.40;
      B.box("paint", px, H.roof + 0.07, pz, 0.16, 0.10, 0.12, 0, a, 0, 0.9);
      B.box("glass", px + Math.sin(a) * 0.062, H.roof + 0.075, pz + Math.cos(a) * 0.062, 0.12, 0.05, 0.01, 0, a, 0);
    });
    B.cyl("paint", RWS.x, H.roof + 0.04, RWS.z, 0.30, 0.33, 0.08, "y", 20, 0, 0, 0, 0.9);
    B.cyl("paint", CMD.x, H.roof + 0.05, CMD.z, 0.36, 0.38, 0.10, "y", 20);
    for (let i = 0; i < 6; i++) {
      const a = -2.2 + i * 0.88, px = CMD.x + Math.sin(a) * 0.43, pz = CMD.z + Math.cos(a) * 0.43;
      B.box("paint", px, H.roof + 0.10, pz, 0.15, 0.11, 0.10, 0, a, 0, 0.9);
      B.box("glass", px + Math.sin(a) * 0.052, H.roof + 0.105, pz + Math.cos(a) * 0.052, 0.11, 0.06, 0.01, 0, a, 0);
    }
    [-1, 1].forEach(function (s) {
      B.box("paint", s * 0.47, H.roof + 0.02, -2.32, 0.74, 0.04, 1.08, 0, 0, 0, 0.92);
      B.box("dark", s * 0.47, H.roof + 0.042, -2.32, 0.64, 0.006, 0.98);
    });
    [[1.0, -3.15], [-1.0, -3.15], [-0.95, 1.45]].forEach(function (p) { B.cyl("dark", p[0], H.roof + 0.08, p[1], 0.05, 0.065, 0.16, "y", 8); });
    B.ball("dark", -0.55, H.roof + 0.04, 0.0, 0.09, 1, 0.45, 1);
    B.box("paint", -0.62, H.roof + 0.03, -0.75, 0.42, 0.06, 0.30, 0, 0, 0, 0.9);        // the fan cover
    // stowage on the roof: rucksacks lashed by the right rail
    [[-0.88, -0.55, 0x6b6142], [-0.92, -1.05, 0x4f5136], [-0.86, -1.5, 0x7a6d4c]].forEach(function (b) { B.box("canvas", b[0], H.roof + 0.17, b[1], 0.34, 0.30, 0.46, 0, 0.1, 0, b[2]); });
    // the underside: driveline and the four differentials between the wheels
    B.box("dark", 0, 0.47, -0.1, 0.34, 0.14, 4.6);
    WH.z.forEach(function (z) { B.cyl("dark", 0, 0.56, z, 0.16, 0.16, 0.44, "x", 12); });
  }
  // the ramp, hinged at the sill: built about the hinge line (y up, z out)
  function buildRamp(B) {
    const h = RAMP.y1 - RAMP.y0, w = RAMP.w * 2 - 0.04;
    B.box("paint", 0, h / 2, -0.035, w, h, 0.07, 0, 0, 0, 0.96);
    // the door in its left half, its handle, the vision block
    B.box("paint", 0.30, 0.56, -0.075, 0.56, 0.98, 0.02, 0, 0, 0, 0.93);
    B.box("dark", 0.30, 1.055, -0.085, 0.58, 0.012, 0.006);
    B.box("dark", 0.585, 0.56, -0.085, 0.012, 0.98, 0.006);
    B.box("metal", 0.08, 0.6, -0.10, 0.03, 0.15, 0.03);
    B.box("glass", 0.30, 0.86, -0.088, 0.14, 0.06, 0.008);
    // hinges, the hydraulic ram's anchor, rubbing strips
    [-0.45, 0.45].forEach(function (x) { B.cyl("metal", x, 0.0, -0.05, 0.05, 0.05, 0.2, "x", 10); });
    B.box("paint", 0, 0.08, -0.08, w, 0.06, 0.03, 0, 0, 0, 0.8);
  }

  /* ------------------------------------------------------------ the slat cage */
  function bar(B, x0, z0, x1, z1, y, tint) {
    const dx = x1 - x0, dz = z1 - z0, L = Math.hypot(dx, dz);
    B.box("paint", (x0 + x1) / 2, y, (z0 + z1) / 2, 0.05, 0.022, L, 0, Math.atan2(dx, dz), 0, tint);
  }
  function buildSlat(B) {
    const S = SLAT, ny = Math.floor((S.y1 - S.y0) / S.pitch);
    [-1, 1].forEach(function (s) {
      const x = s * S.x, xr = s * (RAMP.w + 0.06), xn = s * 1.50;
      for (let i = 0; i <= ny; i++) {
        const y = S.y0 + i * S.pitch;
        bar(B, x, S.zr, x, S.zf, y);                               // the side
        if (y < 1.62) bar(B, x, S.zf, xn, S.nose, y);             // the front corner
        bar(B, x, S.zr, xr, S.zr, y);                              // the rear corner panel
      }
      // frame: top and bottom rails, posts every ~0.9 m with standoff arms
      [S.y0 - 0.02, S.y1 + 0.02].forEach(function (y) { B.box("paint", x, y, (S.zr + S.zf) / 2, 0.07, 0.05, S.zf - S.zr, 0, 0, 0, 0.85); });
      for (let z = S.zr; z <= S.zf + 0.01; z += (S.zf - S.zr) / 8) {
        B.box("paint", x, (S.y0 + S.y1) / 2, z, 0.06, S.y1 - S.y0 + 0.06, 0.05, 0, 0, 0, 0.82);
        [1.32, 1.96].forEach(function (y) {
          const hx = y < H.sponT ? H.spon : sideX(y);
          B.box("paint", s * (hx + S.x) / 2, y, z, S.x - hx, 0.04, 0.04, 0, 0, 0, 0.8);
        });
      }
      B.box("paint", (x + xr) / 2, (S.y0 + S.y1) / 2, S.zr, 0.05, S.y1 - S.y0 + 0.06, 0.05, 0, 0, 0, 0.82);
      B.box("paint", xr, (S.y0 + S.y1) / 2, S.zr, 0.05, S.y1 - S.y0 + 0.06, 0.05, 0, 0, 0, 0.82);
      [S.y0 - 0.02, S.y1 + 0.02].forEach(function (y) { bar(B, x, S.zr, xr, S.zr, y, 0.85); });
      // the rear panel's arms back to the stowage boxes
      [1.2, 1.8].forEach(function (y) { B.box("paint", s * 1.02, y, (S.zr - H.HL - 0.34) / 2, 0.04, 0.04, -H.HL - 0.34 - S.zr, 0, 0, 0, 0.8); });
    });
    // the nose panel across the front, below the driver's sight line
    for (let y = S.y0; y < 1.62; y += S.pitch) bar(B, -1.50, S.nose, 1.50, S.nose, y);
    for (let x = -1.5; x <= 1.51; x += 0.75) {
      B.box("paint", x, (S.y0 + 1.6) / 2, S.nose, 0.05, 1.62 - S.y0 + 0.04, 0.05, 0, 0, 0, 0.82);
      B.box("paint", x * 0.9, 1.0, (S.nose + H.HL) / 2, 0.04, 0.04, S.nose - H.HL, 0, 0, 0, 0.8);
    }
  }
  // the slat panel that rides on the ramp (hinge space)
  function buildRampSlat(B) {
    const S = SLAT, off = -H.HL - S.zr;            // 0.405 m behind the ramp
    for (let y = S.y0 - RAMP.y0 + 0.02; y <= S.y1 - RAMP.y0; y += S.pitch) bar(B, -RAMP.w + 0.02, -off, RAMP.w - 0.02, -off, y);
    [-RAMP.w + 0.02, 0, RAMP.w - 0.02].forEach(function (x) {
      B.box("paint", x, (S.y1 - RAMP.y0) / 2 + 0.02, -off, 0.05, S.y1 - S.y0, 0.05, 0, 0, 0, 0.82);
      [0.3, 0.9].forEach(function (y) { B.box("paint", x, y, -off / 2 - 0.035, 0.04, 0.04, off - 0.07, 0, 0, 0, 0.8); });
    });
  }

  /* ------------------------------------------------------------ the RWS */
  // the M151 Protector: the yawing base on its ring (built about the ring)
  function buildRwsBase(B) {
    B.cyl("paint", 0, 0.05, 0, 0.27, 0.29, 0.10, "y", 18, 0, 0, 0, 0.9);
    // the cradle's two arms up to the elevation axis, the electronics box
    B.box("paint", 0, 0.16, -0.08, 0.50, 0.18, 0.46, 0, 0, 0, 0.95);
    B.loft("paint", "x", [[-0.25, [[0.15, 0.07], [0.30, 0.07], [0.15, 0.25]]], [0.25, [[0.15, 0.07], [0.30, 0.07], [0.15, 0.25]]]], 0.92);
    [-1, 1].forEach(function (s) {
      B.box("paint", s * 0.27, RWS.armY - 0.08, 0.02, 0.05, 0.30, 0.26, 0, 0, 0, 0.9);
      B.cyl("metal", s * 0.30, RWS.armY, 0.02, 0.06, 0.06, 0.04, "x", 12);
    });
    B.box("dark", 0, 0.16, -0.32, 0.30, 0.10, 0.02);
  }
  // the elevating cradle: gun, sight head on its left, ammunition can on its right
  function buildRwsCradle(B) {
    // sensor head: day TV, thermal, laser range finder behind armoured shutters
    B.box("paint", 0.22, 0.04, 0.02, 0.20, 0.25, 0.44, 0, 0, 0, 0.96);
    B.box("paint", 0.22, 0.175, 0.0, 0.22, 0.02, 0.46, 0, 0, 0, 0.88);
    B.box("glass", 0.22, 0.08, 0.225, 0.12, 0.08, 0.01);
    B.cyl("glass", 0.19, -0.03, 0.225, 0.035, 0.035, 0.01, "z", 12);
    B.cyl("dark", 0.26, -0.03, 0.225, 0.02, 0.02, 0.01, "z", 10);
    // the ammunition can (400 rds) and its feed chute into the receiver
    B.box("paint", -0.24, 0.0, -0.06, 0.17, 0.27, 0.40, 0, 0, 0, 0.9);
    B.box("metal", -0.24, 0.14, -0.06, 0.13, 0.02, 0.06);
    B.box("dark", -0.13, 0.08, -0.02, 0.07, 0.05, 0.12, 0, 0, -0.5);
    // the cradle tray under the gun
    B.box("paint", 0, -0.09, 0.0, 0.30, 0.04, 0.70, 0, 0, 0, 0.85);
  }
  // the M2HB itself (recoils): receiver, perforated barrel jacket, barrel, handle
  function buildM2(B) {
    B.box("gun", 0, 0, -0.05, 0.12, 0.16, 0.66);
    B.box("gun", 0, 0.085, -0.05, 0.10, 0.012, 0.60);
    B.box("gun", 0, 0, -0.39, 0.10, 0.10, 0.04);
    B.cyl("gun", 0, 0, 0.42, 0.042, 0.042, 0.28, "z", 12);
    for (let i = 0; i < 4; i++) B.cyl("dark", 0.043, 0, 0.32 + i * 0.065, 0.012, 0.012, 0.004, "x", 6);
    B.cyl("gun", 0, 0, 0.98, 0.026, 0.029, 1.0, "z", 12);
    B.cyl("gun", 0, 0, 1.40, 0.032, 0.030, 0.07, "z", 10);
    B.cyl("dark", 0, 0, 1.435, 0.012, 0.012, 0.005, "z", 8);
    B.box("gun", 0, 0.09, 0.62, 0.025, 0.08, 0.12);
    B.box("gun", 0, 0.13, 0.62, 0.03, 0.02, 0.18);
  }

  /* ------------------------------------------------------------ the crew */
  const SKIN = [0xc8987a, 0x8d5a3b, 0xe0b898, 0x5f3a24, 0xb07a52];
  function buildFigure(B, skin, kind) {
    // kind: "cmd" (CVC helmet, arms on the rim), "drv" (head and shoulders),
    // "guard" (ACH helmet, plate carrier, M4 laid outboard)
    const ocp = 0x7b7458, plate = 0x6b6650, cvc = 0x4a4a3a, ach = 0x6e6a52;
    if (kind !== "drv") {
      B.cyl("crew", 0, -0.22, 0, 0.19, 0.17, 0.50, "y", 10, 0, 0, 0, ocp);
      B.ball("crew", 0, 0.04, 0, 0.21, 1, 0.55, 0.85, ocp);
      if (kind === "guard") B.box("crew", 0, -0.12, 0.0, 0.36, 0.30, 0.30, 0, 0, 0, plate);
      [-1, 1].forEach(function (s) {
        B.cyl("crew", s * 0.24, 0.0, 0.10, 0.055, 0.06, 0.26, "z", 8, 0.3, s * 0.25, 0, ocp);
        B.ball("crew", s * 0.20, -0.05, 0.27, 0.05, 1, 0.8, 1, 0x3b3a30);
      });
      if (kind === "guard") {
        B.box("crew", 0.02, 0.0, 0.38, 0.05, 0.08, 0.50, 0, 0, 0, 0x1e1f1d);
        B.cyl("crew", 0.02, 0.01, 0.74, 0.011, 0.011, 0.26, "z", 6, 0, 0, 0, 0x1a1a1a);
        B.box("crew", 0.02, 0.07, 0.40, 0.04, 0.05, 0.12, 0, 0, 0, 0x222222);
      }
    } else B.ball("crew", 0, 0.0, 0, 0.18, 1, 0.5, 0.8, ocp);
    B.cyl("crew", 0, 0.12, 0, 0.05, 0.055, 0.08, "y", 8, 0, 0, 0, skin);
    B.ball("crew", 0, 0.25, 0.01, 0.10, 0.92, 1.05, 1, skin);
    if (kind === "guard") {
      B.ball("crew", 0, 0.29, -0.005, 0.125, 1.02, 0.85, 1.08, ach);
      B.box("crew", 0, 0.345, 0.10, 0.06, 0.04, 0.03, 0, 0, 0, 0x1a1a1a);         // NVG mount
      B.box("crew", 0, 0.20, 0.10, 0.17, 0.035, 0.02, 0, 0, 0, 0x101010);          // eye pro
    } else {
      B.ball("crew", 0, 0.285, -0.01, 0.125, 1, 0.92, 1.05, cvc);
      [-1, 1].forEach(function (s) { B.cyl("crew", s * 0.115, 0.24, -0.005, 0.05, 0.05, 0.04, "x", 10, 0, 0, 0, 0x2f2f28); });
      B.box("crew", 0, 0.355, 0.09, 0.16, 0.045, 0.05, 0.25, 0, 0, 0x1a1c1d);
      B.cyl("crew", 0.03, 0.22, 0.11, 0.008, 0.008, 0.10, "x", 4, 0, 0, 0.4, 0x222222);
    }
  }

  /* ------------------------------------------------------------ the wheels */
  // a Michelin 1200R20 XML: lathe-turned carcass + the big chevron lugs.
  // Axle along X, the outer face +X.
  function tyreGeo() {
    const B = new Builder(), r = WH.r, hw = WH.w / 2;
    const prof = [[0.272, -hw + 0.01], [0.33, -hw - 0.006], [0.43, -hw - 0.004], [0.50, -hw + 0.01], [0.53, -hw + 0.035], [r - 0.035, -hw + 0.055],
      [r - 0.035, hw - 0.055], [0.53, hw - 0.035], [0.50, hw - 0.01], [0.43, hw + 0.004], [0.33, hw + 0.006], [0.272, hw - 0.01]];
    const g = new THREE.LatheGeometry(prof.map(function (p) { return new THREE.Vector2(p[0], p[1]); }), 36);
    g.rotateZ(-PI / 2);
    B.geo("rubber", g, null, 1);
    // the lugs: two staggered rows of chevron blocks, open shoulders
    const n = 22;
    for (let i = 0; i < n; i++) {
      const a = i * TAU / n;
      [-1, 1].forEach(function (s) {
        const aa = a + (s > 0 ? PI / n : 0), rr = r - 0.018;
        B.box("rubber", s * 0.075, Math.sin(aa) * rr, Math.cos(aa) * rr, 0.135, 0.04, 0.085, PI / 2 - aa, s * 0.32, 0, 0.92);
      });
    }
    // the sidewall lettering band (a faint raised ring)
    [-1, 1].forEach(function (s) { B.cyl("rubber", s * (hw + 0.002), 0, 0, 0.47, 0.47, 0.004, "x", 30, 0, 0, 0, 0.8, true); });
    return B.build({ vc: VC }).rubber;
  }
  function rimGeo() {
    const B = new Builder(), R = WH.rimR;
    B.cyl("gear", 0.0, 0, 0, R, R, WH.w - 0.06, "x", 24, 0, 0, 0, 0.75, true);           // the rim barrel
    B.cyl("gear", 0.07, 0, 0, R * 0.98, R * 0.98, 0.012, "x", 24, 0, 0, 0, 1.0);         // the dished disc
    B.cyl("gear", 0.09, 0, 0, 0.15, 0.17, 0.04, "x", 18, 0, 0, 0, 0.85);                  // the hub
    for (let i = 0; i < 10; i++) {
      const a = i * TAU / 10;
      B.cyl("gear", 0.115, Math.sin(a) * 0.125, Math.cos(a) * 0.125, 0.014, 0.014, 0.02, "x", 6, 0, 0, 0, 0.45);
    }
    // the CTIS rotary seal on the hub, and its air line to the valve
    B.cyl("gear", 0.13, 0, 0, 0.055, 0.065, 0.06, "x", 12, 0, 0, 0, 0.55);
    B.cyl("gear", 0.17, 0, 0, 0.03, 0.03, 0.03, "x", 10, 0, 0, 0, 0.35);
    B.box("gear", 0.10, 0.10, 0.13, 0.014, 0.014, 0.16, 0.9, 0, 0, 0.3);
    B.cyl("gear", -0.07, 0, 0, R * 0.98, R * 0.98, 0.012, "x", 24, 0, 0, 0, 0.55);        // inner disc
    return B.build({ vc: VC }).gear;
  }
  function shaftGeo() {
    // a unit-length half-shaft along +X (0..1) with its CV boots
    const B = new Builder();
    const g = new THREE.CylinderGeometry(0.035, 0.035, 1, 8, 1, true); g.rotateZ(-PI / 2); g.translate(0.5, 0, 0);
    B.geo("rubber", g, null, 0.6);
    return B.build({ vc: VC }).rubber;
  }

  /* ------------------------------------------------------------ the template */
  function template(scheme) {
    if (TPL[scheme]) return TPL[scheme];
    scratch();
    const MT = materials(scheme), parts = {};
    let B = new Builder(); buildHull(B);
    parts.hull = B.build({ grime: { paint: 1 }, vc: VC, uv: { paint: 1 } });
    B = new Builder(); buildSlat(B); parts.slat = B.build({ grime: { paint: 1 }, vc: VC, uv: { paint: 1 } });
    B = new Builder(); buildRamp(B); parts.ramp = B.build({ vc: VC, uv: { paint: 1 } });
    B = new Builder(); buildRampSlat(B); parts.rampSlat = B.build({ vc: VC, uv: { paint: 1 } });
    B = new Builder(); buildRwsBase(B); parts.rws = B.build({ vc: VC, uv: { paint: 1 } });
    B = new Builder(); buildRwsCradle(B); parts.cradle = B.build({ vc: VC, uv: { paint: 1 } });
    B = new Builder(); buildM2(B); parts.m2 = B.build({});
    // hatch lids: the driver's, the commander's, the two air-guard hatches
    B = new Builder(); B.cyl("paint", 0, 0.025, 0.30, 0.30, 0.30, 0.05, "y", 16); B.box("metal", 0, 0.06, 0.30, 0.16, 0.025, 0.025); parts.lidD = B.build({ vc: VC, uv: { paint: 1 } });
    B = new Builder(); B.cyl("paint", 0, 0.025, 0.33, 0.33, 0.33, 0.05, "y", 18); B.box("metal", 0, 0.06, 0.33, 0.18, 0.025, 0.025); parts.lidC = B.build({ vc: VC, uv: { paint: 1 } });
    B = new Builder(); B.box("paint", 0.32, 0.025, 0, 0.64, 0.05, 0.98); B.box("metal", 0.5, 0.06, 0, 0.025, 0.025, 0.2); parts.lidA = B.build({ vc: VC, uv: { paint: 1 } });
    parts.cmd = []; parts.drv = []; parts.guard = [];
    SKIN.forEach(function (sk) {
      let F = new Builder(); buildFigure(F, sk, "cmd"); parts.cmd.push(F.build({ vc: VC }).crew);
      F = new Builder(); buildFigure(F, sk, "drv"); parts.drv.push(F.build({ vc: VC }).crew);
      F = new Builder(); buildFigure(F, sk, "guard"); parts.guard.push(F.build({ vc: VC }).crew);
    });
    parts.tyre = tyreGeo(); parts.rim = rimGeo(); parts.shaft = shaftGeo();
    // r128 culls an InstancedMesh by its geometry's sphere: the whole axle set
    const env = new THREE.Sphere(new THREE.Vector3(0, 0.6, 0), 3.8);
    // (and anything that sizes the group by Box3.setFromObject reads the box:
    // one wheel's box centred on the origin would put the hull 0.56 m up)
    const box = new THREE.Box3(new THREE.Vector3(-1.45, -0.02, -2.85), new THREE.Vector3(1.45, 1.15, 2.65));
    ["tyre", "rim", "shaft"].forEach(function (k) { parts[k].boundingSphere = env.clone(); parts[k].boundingBox = box.clone(); });
    return (TPL[scheme] = { MT: MT, parts: parts });
  }

  /* =========================================================== the FX pool */
  const FX = { smoke: null, fire: null, cases: null };
  const VS = [
    "attribute float aSize; attribute float aAlpha; attribute vec3 aColor; uniform float uScale;",
    "varying float vA; varying vec3 vC;", "#include <fog_pars_vertex>",
    "void main(){ vA=aAlpha; vC=aColor; vec4 mvPosition=modelViewMatrix*vec4(position,1.0);",
    " gl_PointSize = aSize*uScale/max(0.2,-mvPosition.z); gl_Position=projectionMatrix*mvPosition;", "#include <fog_vertex>", "}",
  ].join("\n");
  const FS = [
    "varying float vA; varying vec3 vC;", "#include <fog_pars_fragment>",
    "void main(){ vec2 p=gl_PointCoord*2.0-1.0; float r=dot(p,p); if(r>1.0) discard;",
    " float a=vA*(1.0-r)*(1.0-r); gl_FragColor=vec4(vC,a);", "#include <fog_fragment>", "}",
  ].join("\n");
  function Pool(n, additive) {
    this.n = n; this.next = 0; this.last = 0;
    this.P = new Float32Array(n * 3); this.Vl = new Float32Array(n * 3);
    this.age = new Float32Array(n); this.life = new Float32Array(n);
    this.s0 = new Float32Array(n); this.s1 = new Float32Array(n); this.a0 = new Float32Array(n);
    this.drag = new Float32Array(n); this.buoy = new Float32Array(n);
    this.size = new Float32Array(n); this.alpha = new Float32Array(n); this.C = new Float32Array(n * 3);
    const g = new THREE.BufferGeometry();
    this.aP = new THREE.BufferAttribute(this.P, 3); this.aS = new THREE.BufferAttribute(this.size, 1);
    this.aA = new THREE.BufferAttribute(this.alpha, 1); this.aC = new THREE.BufferAttribute(this.C, 3);
    [this.aP, this.aS, this.aA, this.aC].forEach(function (a) { a.setUsage && a.setUsage(THREE.DynamicDrawUsage); });
    g.setAttribute("position", this.aP); g.setAttribute("aSize", this.aS); g.setAttribute("aAlpha", this.aA); g.setAttribute("aColor", this.aC);
    const mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uScale: { value: 600 } }]),
      vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false, fog: !additive,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    const pts = new THREE.Points(g, mat);
    pts.frustumCulled = false; pts.renderOrder = additive ? 9 : 8; pts.visible = false;
    pts.name = "stryker-fx";
    const self = this;
    pts.onBeforeRender = function (renderer, scene, camera) {
      const t = now(), dt = self.last ? clamp((t - self.last) / 1000, 0, 0.1) : 0;
      self.last = t;
      self.step(dt);
      renderer.getDrawingBufferSize(_m.v2d);
      const fov = camera.isPerspectiveCamera ? camera.fov : 50;
      mat.uniforms.uScale.value = _m.v2d.y * 0.5 / Math.tan(fov * PI / 360);
    };
    this.pts = pts;
  }
  Pool.prototype.emit = function (x, y, z, vx, vy, vz, s0, s1, a0, life, r, g, b, drag, buoy) {
    const i = this.next; this.next = (i + 1) % this.n;
    this.P[i * 3] = x; this.P[i * 3 + 1] = y; this.P[i * 3 + 2] = z;
    this.Vl[i * 3] = vx; this.Vl[i * 3 + 1] = vy; this.Vl[i * 3 + 2] = vz;
    this.age[i] = 0; this.life[i] = life; this.s0[i] = s0; this.s1[i] = s1; this.a0[i] = a0;
    this.drag[i] = drag; this.buoy[i] = buoy;
    this.C[i * 3] = r; this.C[i * 3 + 1] = g; this.C[i * 3 + 2] = b;
    if (!this.pts.visible) { this.pts.visible = true; this.last = now(); }
  };
  Pool.prototype.step = function (dt) {
    let live = 0;
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue;
      const a = (this.age[i] += dt);
      if (a >= this.life[i]) { this.life[i] = 0; this.alpha[i] = 0; this.size[i] = 0; continue; }
      live++;
      const k = a / this.life[i], d = Math.max(0, 1 - this.drag[i] * dt), j = i * 3;
      this.Vl[j] *= d; this.Vl[j + 1] = this.Vl[j + 1] * d + this.buoy[i] * dt; this.Vl[j + 2] *= d;
      this.P[j] += this.Vl[j] * dt; this.P[j + 1] += this.Vl[j + 1] * dt; this.P[j + 2] += this.Vl[j + 2] * dt;
      this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * (1 - (1 - k) * (1 - k));
      this.alpha[i] = this.a0[i] * (k < 0.08 ? k / 0.08 : 1) * Math.pow(1 - k, 1.4);
    }
    if (!live) this.pts.visible = false;
    this.aP.needsUpdate = this.aS.needsUpdate = this.aA.needsUpdate = this.aC.needsUpdate = true;
  };
  // spent .50 cases (brass) and M9 links (dark steel), out under the receiver
  function Cases(n) {
    const g = new THREE.CylinderGeometry(0.0105, 0.0105, 0.099, 7);
    g.rotateX(PI / 2);
    const m = std({ color: 0xb08d3c, roughness: 0.35, metalness: 0.85 });
    this.im = new THREE.InstancedMesh(g, m, n); this.im.frustumCulled = false; this.im.name = "stryker-cases";
    this.n = n; this.next = 0; this.d = [];
    for (let i = 0; i < n; i++) { this.d.push({ t: 9, x: 0, y: -1e4, z: 0, vx: 0, vy: 0, vz: 0, rx: 0, ry: 0, w: 0, rest: false }); this.im.setMatrixAt(i, _m.m.makeScale(0, 0, 0)); }
    const self = this;
    this.last = 0;
    this.im.onBeforeRender = function () { const t = now(), dt = self.last ? clamp((t - self.last) / 1000, 0, 0.1) : 0; self.last = t; self.step(dt); };
    this.im.visible = false;
  }
  Cases.prototype.emit = function (x, y, z, vx, vy, vz) {
    const c = this.d[this.next]; this.next = (this.next + 1) % this.n;
    c.t = 0; c.x = x; c.y = y; c.z = z; c.vx = vx; c.vy = vy; c.vz = vz; c.rx = Math.random() * 6; c.ry = Math.random() * 6; c.w = 14 + Math.random() * 10; c.rest = false;
    if (!this.im.visible) { this.im.visible = true; this.last = now(); }
  };
  Cases.prototype.step = function (dt) {
    let any = false;
    for (let i = 0; i < this.n; i++) {
      const c = this.d[i];
      if (c.t > 6) continue;
      c.t += dt; any = true;
      if (!c.rest) {
        c.vy -= 9.8 * dt; c.x += c.vx * dt; c.y += c.vy * dt; c.z += c.vz * dt; c.rx += c.w * dt; c.ry += c.w * 0.6 * dt;
        const gy = CBZ.floorAt ? CBZ.floorAt(c.x, c.z) + 0.011 : 0.011;
        if (c.y < gy) { c.y = gy; if (Math.abs(c.vy) > 1.2) { c.vy *= -0.3; c.vx *= 0.5; c.vz *= 0.5; c.w *= 0.5; } else { c.rest = true; c.rx = PI / 2; } }
      }
      if (c.t > 6) { this.im.setMatrixAt(i, _m.m.makeScale(0, 0, 0)); continue; }
      this.im.setMatrixAt(i, M4(c.x, c.y, c.z, c.rx, c.ry, 0));
    }
    this.im.instanceMatrix.needsUpdate = true;
    if (!any) this.im.visible = false;
  };
  function fx() {
    if (!CBZ.scene || !THREE) return null;
    if (!FX.smoke) { FX.smoke = new Pool(1100, false); FX.fire = new Pool(260, true); FX.cases = new Cases(64); }
    if (FX.smoke.pts.parent !== CBZ.scene) { CBZ.scene.add(FX.smoke.pts); CBZ.scene.add(FX.fire.pts); CBZ.scene.add(FX.cases.im); }
    return FX;
  }
  function flash(p, scale, color) { if (CBZ.muzzleFlash) { try { CBZ.muzzleFlash(p, { scale: scale, life: 0.06, color: color || 0xffd890 }); } catch (e) {} } }

  /* =========================================================== the rig */
  // a wheel: T * Ry(yaw) * Rx(spin) * S(1, s, s)
  function writeYX(arr, i, x, y, z, yaw, spin, s) {
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cx = Math.cos(spin), sx = Math.sin(spin), o = i * 16;
    arr[o] = cy; arr[o + 1] = 0; arr[o + 2] = -sy; arr[o + 3] = 0;
    arr[o + 4] = sy * sx * s; arr[o + 5] = cx * s; arr[o + 6] = cy * sx * s; arr[o + 7] = 0;
    arr[o + 8] = sy * cx * s; arr[o + 9] = -sx * s; arr[o + 10] = cy * cx * s; arr[o + 11] = 0;
    arr[o + 12] = x; arr[o + 13] = y; arr[o + 14] = z; arr[o + 15] = 1;
  }
  // a half-shaft from (ax, ay) to (bx, by) at z: T * Rz * S(len, 1, 1)
  function writeShaft(arr, i, ax, ay, bx, by, z) {
    const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1e-3, c = dx / L, s = dy / L, o = i * 16;
    arr[o] = c * L; arr[o + 1] = s * L; arr[o + 2] = 0; arr[o + 3] = 0;
    arr[o + 4] = -s; arr[o + 5] = c; arr[o + 6] = 0; arr[o + 7] = 0;
    arr[o + 8] = 0; arr[o + 9] = 0; arr[o + 10] = 1; arr[o + 11] = 0;
    arr[o + 12] = ax; arr[o + 13] = ay; arr[o + 14] = z; arr[o + 15] = 1;
  }
  const NW = 8;          // wheel i: side = i >> 2 (0 left / +X, 1 right), axle = i & 3
  function Rig(root, P, seed) {
    this.root = root; this.P = P; this.seed = seed | 0;
    this.body = P.body; this.turret = P.turret; this.gun = P.gun; this.tube = P.tube; this.muzzle = P.muzzle;
    this.ramp = P.ramp; this.slatMesh = P.slatMesh; this.rampSlat = P.rampSlat;
    this.lids = P.lids; this.cmd = P.cmd; this.drv = P.drv; this.guards = P.guards; this.sensorGlass = P.sensorGlass;
    this.ims = P.ims; this.hullMesh = P.hullMesh;
    this.clock = 0;
    // drive
    this.trav = new Float32Array(NW); this.off = new Float32Array(NW); this.flat = -1; this.gearDirty = 2;
    this.lastV = 0; this.accF = 0; this.latF = 0; this.pitch = 0; this.roll = 0; this.bounceT = seed * 0.37; this.v = 0; this.w = 0; this.steer = 0;
    this.sink = 0; this.list = 0;
    // weapon
    this.tw = 0; this.elev = 0; this.engT = -1e9; this.fireT = -1e9; this.recoilT = 9; this.ready = READY; this.reloadT = 0;
    this.dead = false; this.droop = 0;
    // crew
    this.cmdUp = 1; this.drvUp = 1; this.guardUp = 0; this.nPass = 0; this.wantGuards = 0;
    this.rampA = 0; this.rampWant = 0; this.rampT = 0; this.wasDismounted = false;
    // fx / damage
    this.exhT = 0; this.dustT = 0; this.smokeT = 0; this.burnT = 0; this.tyreBurn = 0; this.smokePopped = false;
    this.wrecked = false; this.cat = false; this.toss = null; this.ground = "";
    this.slat = false;
  }
  // ---- the wheels ---------------------------------------------------------
  Rig.prototype.sampleGround = function (dt) {
    const ga = this._groundAt || CBZ.floorAt;
    if (!ga) return;
    const r = this.root;
    r.updateMatrix();
    const e = r.matrix.elements, upY = Math.max(0.5, e[5]);
    const k = dt > 0 ? Math.min(1, dt * 14) : 1;
    let moved = false;
    for (let i = 0; i < NW; i++) {
      const x = (i >> 2) ? -WH.x : WH.x, z = WH.z[i & 3];
      const wx = e[0] * x + e[8] * z + e[12], wy = e[1] * x + e[9] * z + e[13], wz = e[2] * x + e[10] * z + e[14];
      const want = clamp((ga(wx, wz) - wy) / upY, -WH.down, WH.up);
      const nv = this.off[i] + (want - this.off[i]) * k;
      if (Math.abs(nv - this.off[i]) > 1e-4) moved = true;
      this.off[i] = nv;
    }
    if (moved) this.gearDirty = 1;
  };
  Rig.prototype.poseWheels = function () {
    const ta = this.ims.tyre.instanceMatrix.array, ra = this.ims.rim.instanceMatrix.array, sa = this.ims.shaft.instanceMatrix.array;
    // Ackermann on axles 1-2 about the rear pair's centre line
    const tsr = Math.tan(this.steer);
    for (let i = 0; i < NW; i++) {
      const side = i >> 2, ax = i & 3, sx = side ? -1 : 1, x = sx * WH.x, z = WH.z[ax];
      let yaw = 0;
      if (ax < 2 && Math.abs(tsr) > 1e-4) yaw = -Math.atan((z - WH.zc) * tsr / (WH.wb + x * tsr));
      const flat = i === this.flat ? 1 : 0;
      const rr = flat ? 0.86 : 1, y = WH.r * rr + this.off[i] - this.sink + (flat ? 0 : 0);
      const spin = this.trav[i] / WH.r;
      if (side) { writeYX(ta, i, x, y, z, PI + yaw, -spin, rr); writeYX(ra, i, x, y, z, PI + yaw, -spin, 1); }
      else { writeYX(ta, i, x, y, z, yaw, spin, rr); writeYX(ra, i, x, y, z, yaw, spin, 1); }
      // the half-shaft from the differential out to the hub
      writeShaft(sa, i, sx * 0.20, 0.58 - this.sink * 0.5, x - sx * 0.12, y, z);
    }
    this.ims.tyre.instanceMatrix.needsUpdate = this.ims.rim.instanceMatrix.needsUpdate = this.ims.shaft.instanceMatrix.needsUpdate = true;
  };

  // ---- per step (def.animate -> step -> update) --------------------------
  Rig.prototype.step = function (veh, dt, ctx) {
    this._groundAt = ctx && ctx.groundAt || null;
    if (ctx && ctx.dead) {
      if (!this.wrecked) {
        const vs = veh.vs || {};
        this.wreck(!!(vs.wreck && vs.burning) || (vs.hp < -(veh.maxHp || 460) * 0.3));
      }
      this.wreckStep(dt);
      return;
    }
    // the slat cage is this hull's: the kit's resolve() reads vs.slat
    if (veh.vs && veh.vs.slat == null) veh.vs.slat = this.slat ? SLAT.p : 0;
    // who is aboard: the squad's air guards stand in the rear hatches
    let n = 0;
    const seats = veh.seats || [];
    for (let k = 0; k < seats.length; k++) if (!seats[k].crew && seats[k].man) n++;
    this.nPass = n;
    // the ramp drops when the squad gets out, and closes again behind them
    if (veh.dismounted && !this.wasDismounted) { this.rampWant = 1; this.rampT = 9; }
    this.wasDismounted = !!veh.dismounted;
    // M6 smoke: a rocket team in range or the first penetration
    const t = ctx && ctx.target;
    if (!this.smokePopped && t && t.launcher && !t.dead) {
      const d = Math.hypot(t.pos.x - veh.pos.x, t.pos.z - veh.pos.z);
      if (d < 320) this.popSmoke(t.pos.x - veh.pos.x, t.pos.z - veh.pos.z);
    }
    this.update(dt, ctx ? ctx.speed : veh.ds.v, ctx ? ctx.yawRate : veh.ds.w, ctx ? ctx.steer : veh.ds.steer);
  };
  Rig.prototype.update = function (dt, v, w, steer) {
    dt = clamp(dt || 0, 0, 0.25);
    if (this.wrecked) return;
    v = v || 0; w = w || 0;
    this.clock += dt;
    this.v = v; this.w = w;
    const st = clamp(steer || 0, -0.6, 0.6);
    if (Math.abs(st - this.steer) > 1e-4) { this.steer = st; this.gearDirty = Math.max(this.gearDirty, 1); }
    // each wheel rolls its own path: outer wheels further in a turn
    let moving = false;
    for (let i = 0; i < NW; i++) {
      const x = (i >> 2) ? -WH.x : WH.x;
      const vi = v - w * x;
      this.trav[i] += vi * dt;
      if (Math.abs(vi) > 0.02) moving = true;
    }
    if (moving || this.gearDirty) { this.sampleGround(dt); this.poseWheels(); if (!moving) this.gearDirty = Math.max(0, this.gearDirty - 1); }
    // the hull on its springs: squat, dive, lean out of the turn, road bounce,
    // the list onto a flat tyre, the gun's rock
    const acc = dt > 0 ? (v - this.lastV) / dt : 0;
    this.lastV = v;
    this.accF += (clamp(acc, -8, 8) - this.accF) * Math.min(1, dt * 5);
    this.latF += (v * w - this.latF) * Math.min(1, dt * 4);
    this.bounceT += dt * (1.6 + Math.abs(v) * 0.22);
    const bounce = Math.min(1, Math.abs(v) / 10) * 0.006;
    let px = clamp(-this.accF * 0.012, -0.045, 0.045) + Math.sin(this.bounceT * 3.3) * bounce;
    let rz = clamp(this.latF * 0.009, -0.06, 0.06) + Math.sin(this.bounceT * 2.1 + 1) * bounce * 0.7 + this.list;
    // the hull follows its wheels: front pair vs rear pair, left vs right
    const o = this.off;
    px += clamp(((o[3] + o[7] + o[2] + o[6]) - (o[0] + o[4] + o[1] + o[5])) * 0.25 / 4.3, -0.03, 0.03);
    rz += clamp(((o[0] + o[1] + o[2] + o[3]) - (o[4] + o[5] + o[6] + o[7])) * 0.25 / 2.34, -0.03, 0.03);
    if (this.recoilT < 0.35) {
      this.recoilT += dt;
      const k = this.recoilT < 0.02 ? this.recoilT / 0.02 : Math.max(0, 1 - (this.recoilT - 0.02) / 0.06);
      this.tube.position.z = -0.025 * k;
    } else this.tube.position.z = 0;
    this.pitch += (px - this.pitch) * Math.min(1, dt * 6); this.roll += (rz - this.roll) * Math.min(1, dt * 6);
    this.body.rotation.set(this.pitch, 0, this.roll);
    this.body.position.y = 1.0 - this.sink + (o[0] + o[1] + o[2] + o[3] + o[4] + o[5] + o[6] + o[7]) / 8 * 0.6;
    // the RWS parks forward when nobody has laid it for a while
    const engaged = this.clock - this.engT < 1.5;
    if (!engaged && this.clock - this.engT > 4) this.lay(0, 0, dt, 0.4);
    if (this.droop > 0) this.gun.rotation.x += (this.droop - this.gun.rotation.x) * Math.min(1, dt * 2);
    // the ready box: when it runs dry the commander climbs out and feeds it
    if (this.reloadT > 0) { this.reloadT -= dt; if (this.reloadT <= 0) this.ready = READY; }
    // crew: heads out when calm, down at the first shot; air guards up when
    // carrying and calm; the commander is OUT while he reloads the RWS
    const calm = this.clock - this.engT > 8 && this.clock - this.fireT > 15 && this.burnT <= 0;
    const cmdW = calm || this.reloadT > 0 ? 1 : 0;
    this.cmdUp += clamp(cmdW - this.cmdUp, -dt * 2.5, dt * 0.8);
    this.drvUp += clamp((calm && Math.abs(v) < 12 ? 1 : 0) - this.drvUp, -dt * 2.5, dt * 0.7);
    const gW = calm && this.nPass > 0 && this.rampA < 0.05 ? 1 : 0;
    this.guardUp += clamp(gW - this.guardUp, -dt * 2.2, dt * 0.6);
    this.wantGuards = Math.min(2, this.nPass);
    // the ramp: 4 s down on its ram, held while they clear, then up
    if (this.rampT > 0) { this.rampT -= dt; if (this.rampT <= 0) this.rampWant = 0; }
    this.rampA += clamp(this.rampWant - this.rampA, -dt / 4, dt / 4);
    this.poseCrew();
    this.emit(dt, v, w);
    if (this.burnT > 0) this.burnT -= dt;
  };
  Rig.prototype.poseCrew = function () {
    const c = smooth(0, 1, this.cmdUp), d = smooth(0, 1, this.drvUp), g = smooth(0, 1, this.guardUp);
    const L = this.lids;
    L.cmd.rotation.x = -1.8 * smooth(0, 0.35, this.cmdUp);
    L.drv.rotation.x = -1.6 * smooth(0, 0.35, this.drvUp);
    L.ag[0].rotation.z = -1.5 * smooth(0, 0.4, this.guardUp);
    L.ag[1].rotation.z = 1.5 * smooth(0, 0.4, this.guardUp);
    this.cmd.position.y = H.roof + 0.05 - 0.95 + 0.95 * c; this.cmd.visible = c > 0.02;
    this.drv.position.y = H.roof - 0.62 + 0.62 * d; this.drv.visible = d > 0.02;
    for (let i = 0; i < 2; i++) {
      const gm = this.guards[i];
      gm.visible = g > 0.02 && i < this.wantGuards;
      gm.position.y = H.roof - 0.95 + 0.95 * g;
    }
    this.ramp.rotation.x = (this.slat ? -2.0 : -2.32) * smooth(0, 1, this.rampA);
  };
  Rig.prototype.emit = function (dt, v, w) {
    const F = fx();
    if (!F) return;
    const e = this.root.matrix.elements;
    // EXHAUST: the C7 on the right flank; a dark puff when it is loaded
    const load = clamp(this.accF * 0.5, 0, 1) + clamp(Math.abs(w) * Math.abs(v) * 0.05, 0, 0.4);
    this.exhT -= dt;
    if (this.exhT <= 0) {
      this.exhT = load > 0.25 ? 0.06 : 0.3;
      const lx = -(sideX(1.62) + 0.17), ly = 1.62 + this.body.position.y - 1.0, lz = 1.08;
      const x = e[0] * lx + e[4] * ly + e[8] * lz + e[12], y = e[1] * lx + e[5] * ly + e[9] * lz + e[13], z = e[2] * lx + e[6] * ly + e[10] * lz + e[14];
      const k = 0.6 + load * 1.4, g = load > 0.25 ? 0.17 : 0.45;
      F.smoke.emit(x, y, z, -e[0] * 1.8 + (Math.random() - 0.5) * 0.3, 0.6 + Math.random() * 0.4, -e[2] * 1.8 + (Math.random() - 0.5) * 0.3,
        0.2, 1.3 * k, load > 0.25 ? 0.4 : 0.1, 1.3 + Math.random(), g, g, g * 1.05, 0.9, 0.5);
    }
    // DUST thrown off the tyres (tan on sand, a white spray on snow, little on grass)
    const sp = Math.abs(v);
    if (sp > 1.5) {
      this.dustT -= dt * clamp(sp / 5, 0.3, 4);
      if (this.dustT <= 0) {
        this.dustT = 0.07;
        const snow = /snow/.test(this.ground), green = /grass|field|forest|wood|farm|island/.test(this.ground);
        const col = snow ? [0.92, 0.94, 0.97] : green ? [0.55, 0.5, 0.4] : [0.76, 0.67, 0.52];
        const a0 = clamp(sp / 16, 0.08, 0.34) * (green ? 0.45 : 1);
        for (let s = 0; s < 2; s++) {
          const lx = (s ? -WH.x : WH.x) * 1.05, lz = v >= 0 ? WH.z[3] - 0.5 : WH.z[0] + 0.5, ly = 0.25;
          const x = e[0] * lx + e[8] * lz + e[12], y = e[1] * lx + e[9] * lz + e[13] + ly, z = e[2] * lx + e[10] * lz + e[14];
          const back = v >= 0 ? -1 : 1;
          F.smoke.emit(x, y, z, e[8] * back * 1.8 + (Math.random() - 0.5) * 1.4, 0.6 + Math.random() * 0.8, e[10] * back * 1.8 + (Math.random() - 0.5) * 1.4,
            0.9, 4.2 + Math.random() * 2.2, a0, 2.6 + Math.random() * 2, col[0], col[1], col[2], 0.8, 0.12);
        }
      }
    }
    if (this.burnT > 0) this.burnFX(dt, -0.55, H.roof + 0.05, 2.5, 1);     // the engine deck
  };
  Rig.prototype.burnFX = function (dt, lx, ly, lz, k) {
    const F = fx();
    if (!F) return;
    this.smokeT -= dt;
    if (this.smokeT > 0) return;
    this.smokeT = 0.06;
    this.root.updateMatrixWorld(true);
    const p = _m.v3.set(lx, ly, lz).applyMatrix4(this.body.matrixWorld);
    for (let i = 0; i < 2; i++) F.fire.emit(p.x + (Math.random() - 0.5) * 0.6 * k, p.y, p.z + (Math.random() - 0.5) * 0.6 * k, 0, 1.6 + Math.random() * 1.6, 0,
      0.5 * k, 1.3 * k, 0.65, 0.5 + Math.random() * 0.5, 1.0, 0.45 + Math.random() * 0.2, 0.12, 0.6, 1.5);
    if (Math.random() < 0.35) F.smoke.emit(p.x, p.y + 0.6, p.z, (Math.random() - 0.5) * 0.6, 2.2, (Math.random() - 0.5) * 0.6,
      0.9 * k, 6 * k, 0.55, 5 + Math.random() * 3, 0.07, 0.07, 0.07, 0.25, 0.3);
  };
  // M6 smoke: a salvo of four grenades a bank, a screen 25-30 m out across the threat
  Rig.prototype.popSmoke = function (dx, dz) {
    this.smokePopped = true;
    const F = fx();
    if (!F) return;
    this.root.updateMatrixWorld(true);
    const e = this.root.matrixWorld.elements;
    const d = Math.hypot(dx, dz) || 1, ux = dx / d, uz = dz / d;
    const cx = e[12] + ux * 24, cz = e[14] + uz * 24, cy = e[13];
    for (let k = 0; k < 8; k++) {
      const a = (k - 3.5) * 0.16, px = cx + uz * Math.sin(a) * 28, pz = cz - ux * Math.sin(a) * 28;
      for (let j = 0; j < 9; j++) F.smoke.emit(px + (Math.random() - 0.5) * 3, cy + 0.5 + Math.random() * 2, pz + (Math.random() - 0.5) * 3,
        (Math.random() - 0.5) * 1.5, 0.3 + Math.random() * 0.5, (Math.random() - 0.5) * 1.5, 3, 13 + Math.random() * 6, 0.85, 22 + Math.random() * 10, 0.86, 0.86, 0.84, 0.35, 0.05);
      F.fire.emit(px, cy + 1, pz, 0, 1, 0, 1, 3, 0.8, 0.2, 1, 0.8, 0.5, 2, 0);
    }
  };
  // ---- the RWS --------------------------------------------------------------
  Rig.prototype.lay = function (wantYaw, wantElev, dt, k) {
    const cur = this.turret.rotation.y, d = wrap(wantYaw - cur), rate = RWS.rate * (k || 1);
    const want = clamp(d * 6, -rate, rate);
    this.tw += clamp(want - this.tw, -RWS.accel * dt, RWS.accel * dt);
    if (Math.abs(d) < 1e-3 && Math.abs(this.tw) < 0.05) this.tw = 0;
    this.turret.rotation.y = wrap(cur + this.tw * dt);
    const e = clamp(wantElev, RWS.elevMin, RWS.elevMax);
    this.elev += clamp(e - this.elev, -RWS.elevRate * dt, RWS.elevRate * dt);
    if (this.droop <= 0) this.gun.rotation.x = -this.elev;
  };
  Rig.prototype.aimTurret = function (wantYaw, wantElev, dt) {
    if (this.wrecked || this.droop > 0) return;
    this.engT = this.clock;
    this.lay(wantYaw, wantElev, clamp(dt || 0, 0, 0.1), 1);
  };
  Rig.prototype.canFire = function () { return !this.wrecked && this.droop <= 0 && this.reloadT <= 0 && this.ready > 0; };
  Rig.prototype.fire = function (shot) {
    this.fireT = this.clock;
    this.cmdUp = Math.min(this.cmdUp, 0.3); this.drvUp = Math.min(this.drvUp, 0.3); this.guardUp = Math.min(this.guardUp, 0.3);
    this.recoilT = 0;
    this.ready--;
    if (this.ready <= 0) this.reloadT = 25;
    const p = this.muzzleWorld(_m.v2, shot);
    if (!p) return;
    flash(p, 1.1, 0xffdc90);
    const F = fx();
    if (!F) return;
    if (Math.random() < 0.3) F.smoke.emit(p.x, p.y, p.z, 0, 0.3, 0, 0.12, 0.9, 0.22, 0.6, 0.64, 0.62, 0.58, 2.5, 0.3);
    // the case and its link drop out under the receiver
    const c = _m.v3.set(0, -0.10, -0.05).applyMatrix4(this.tube.matrixWorld);
    const r = _m.v.set(1, 0, 0).transformDirection(this.gun.matrixWorld);
    F.cases.emit(c.x, c.y, c.z, -r.x * 1.2 + (Math.random() - 0.5) * 0.6, -0.6, -r.z * 1.2 + (Math.random() - 0.5) * 0.6);
  };
  Rig.prototype.muzzleWorld = function (out) {
    out = out || new THREE.Vector3();
    this.root.updateMatrixWorld(true);
    return this.muzzle.getWorldPosition(out);
  };
  Rig.prototype.settle = function () {
    this.body.rotation.set(0, 0, 0); this.tube.position.z = 0; this.body.position.y = 1.0;
    this.recoilT = 9; this.pitch = this.roll = 0; this.lastV = 0; this.accF = 0; this.latF = 0;
    for (let i = 0; i < NW; i++) this.off[i] = 0;
    this.sampleGround(0);
    this.poseWheels(); this.poseCrew();
  };
  // every hit that lands: the runtime hands over the damage state and the resolve() result
  Rig.prototype.damage = function (vs, res) {
    if (!res || this.wrecked) return;
    if (res.slat) {
      // the RPG burst in the cage: a flash and a puff where it hit, the bars bent
      const F = fx();
      if (F) {
        this.root.updateMatrixWorld(true);
        const z = res.zone === "front" ? SLAT.nose : res.zone === "rear" ? SLAT.zr : (Math.random() - 0.5) * 4;
        const x = res.zone === "side" ? (Math.random() < 0.5 ? 1 : -1) * SLAT.x : (Math.random() - 0.5) * 2;
        const p = _m.v3.set(x, 1.4, z).applyMatrix4(this.root.matrixWorld);
        flash(p, 3.5, 0xffc070);
        for (let k = 0; k < 14; k++) F.smoke.emit(p.x, p.y, p.z, (Math.random() - 0.5) * 3, Math.random() * 2, (Math.random() - 0.5) * 3, 0.6, 4, 0.6, 3 + Math.random() * 2, 0.25, 0.24, 0.22, 1.2, 0.3);
      }
      return;
    }
    if (res.pen && !this.smokePopped) this.popSmoke(Math.sin(this.root.rotation.y), Math.cos(this.root.rotation.y));
    if (res.firepower) {
      // the RWS is knocked out: shattered optics, the gun hanging on its cradle
      this.droop = 0.28;
      if (this.sensorGlass) this.sensorGlass.visible = false;
    }
    if (res.mobility && this.flat < 0) {
      this.flat = (Math.random() * NW) | 0;
      this.list = ((this.flat >> 2) ? -1 : 1) * -0.025;
      this.gearDirty = 2;
    }
    if (res.burning) this.burnT = 40;
  };
  Rig.prototype.setNation = function (id) { applyNation(this.P.flagMesh, id); };
  // the side's markings, right after build: the scheme for the ground, the flag
  Rig.prototype.mark = function (nation, ground) {
    const g = String(ground || "");
    this.ground = g;
    this.setScheme(/grass|field|forest|wood|jungle|farm|island|snow/.test(g) ? "green" : "desert");
    if (nation) this.setNation(nation);
  };
  Rig.prototype.setScheme = function (name) {
    const T = template(SCHEME[name] ? name : "desert");
    const map = this.P.matSlots;
    for (let i = 0; i < map.length; i++) map[i][0].material = T.MT[map[i][1]];
    this.slat = !!SCHEME[name].slat;
    this.slatMesh.visible = this.slat; this.rampSlat.visible = this.slat;
  };
  // ---- knocked out -----------------------------------------------------------
  Rig.prototype.wreck = function (catastrophic) {
    this.wrecked = true; this.wreckAge = 0; this.cat = catastrophic;
    this.cmd.visible = this.drv.visible = false; this.guards[0].visible = this.guards[1].visible = false;
    this.lids.cmd.rotation.x = -2.0; this.lids.drv.rotation.x = -1.9;
    this.lids.ag[0].rotation.z = -1.9; this.lids.ag[1].rotation.z = 1.9;
    this.burnT = catastrophic ? 120 : 50;
    this.tyreBurn = 0;
    this.gun.rotation.x = 0.25;
    if (catastrophic) {
      // the stowed ammunition goes: the RWS is thrown off its ring, the ramp blown down
      const s = Math.random() < 0.5 ? 1 : -1;
      this.toss = { vx: s * (1.5 + Math.random() * 2), vy: 7 + Math.random() * 3, vz: (Math.random() - 0.5) * 2,
        wx: (Math.random() - 0.5) * 6, wz: s * (2 + Math.random() * 3), done: false };
      this.ramp.rotation.x = -2.1;
      const F = fx();
      if (F) {
        this.root.updateMatrixWorld(true);
        const p = _m.v3.set(0, H.roof + 0.4, -1.0).applyMatrix4(this.root.matrixWorld);
        for (let k = 0; k < 34; k++) F.fire.emit(p.x, p.y, p.z, (Math.random() - 0.5) * 8, 2 + Math.random() * 9, (Math.random() - 0.5) * 8, 0.8, 2.6, 0.9, 0.5 + Math.random() * 0.6, 1, 0.55, 0.2, 2, 0.5);
      }
    }
  };
  Rig.prototype.wreckStep = function (dt) {
    dt = clamp(dt || 0, 0, 0.25);
    this.wreckAge += dt;
    const T = this.toss;
    if (T && !T.done) {
      const tr = this.turret;
      T.vy -= 9.8 * dt;
      tr.position.x += T.vx * dt; tr.position.y += T.vy * dt; tr.position.z += T.vz * dt;
      tr.rotation.x += T.wx * dt; tr.rotation.z += T.wz * dt;
      const onHull = Math.abs(tr.position.x) < H.roofW && Math.abs(tr.position.z) < H.HL;
      const floor = onHull ? H.roof + 0.1 : 0.3 - (1.0 - this.body.position.y);
      if (tr.position.y < floor && T.vy < 0) {
        tr.position.y = floor; T.done = true;
        tr.rotation.x = clamp(tr.rotation.x, -1.2, 1.2); tr.rotation.z = clamp(tr.rotation.z, -1.4, 1.4);
      }
    }
    if (this.wreckAge < this.burnT) {
      // the fire inside comes out of the hatches; the tyres catch and burn down
      if (this.cat) this.burnFX(dt, 0, H.roof + 0.1, -1.6, 1.5);
      else this.burnFX(dt, -0.55, H.roof + 0.05, 2.4, 0.8);
      this.tyreBurn += dt;
      const F = fx();
      if (F && this.tyreBurn > 6 && this.tyreBurn < 70 && Math.random() < dt * 10) {
        const i = (Math.random() * NW) | 0, x = (i >> 2) ? -WH.x : WH.x, z = WH.z[i & 3];
        const p = _m.v3.set(x, 0.5, z).applyMatrix4(this.root.matrixWorld);
        F.fire.emit(p.x, p.y, p.z, 0, 1.4, 0, 0.6, 1.4, 0.6, 0.7, 1, 0.5, 0.15, 0.6, 1.2);
        F.smoke.emit(p.x, p.y + 0.8, p.z, 0, 1.6, 0, 1, 5, 0.5, 5, 0.05, 0.05, 0.05, 0.25, 0.25);
      }
      // rubber gone: the hull settles onto its rims
      if (this.tyreBurn > 40 && this.ims.tyre.visible) { this.ims.tyre.visible = false; }
      const want = this.tyreBurn > 40 ? WH.r - WH.rimR - 0.01 : 0;
      if (Math.abs(want - this.sink) > 1e-3) {
        this.sink += clamp(want - this.sink, -dt * 0.05, dt * 0.05);
        this.body.position.y = 1.0 - this.sink;
        this.poseWheels();
      }
    }
  };

  /* =========================================================== markings */
  const FLAG_MAT = {};
  function flagMaterial(id) {
    if (FLAG_MAT[id]) return FLAG_MAT[id];
    const tex = CBZ.flags && CBZ.flags.texture ? CBZ.flags.texture(id) : null;
    if (!tex) return null;
    const m = new THREE.MeshLambertMaterial({ map: tex, polygonOffset: true, polygonOffsetFactor: -2 });
    m._shared = true;
    return (FLAG_MAT[id] = m);
  }
  let FLAG_GEO = null;
  function flagGeo() {
    if (FLAG_GEO) return FLAG_GEO;
    // on the tumblehome near the rear, both sides, hoist forward
    const y0 = 1.62, y1 = 1.90, z0 = -2.42, z1 = -2.92, out = 0.045;
    const P = [], U = [], N = [];
    [-1, 1].forEach(function (s) {
      const xa = s * (sideX(y0) + out), xb = s * (sideX(y1) + out);
      const q = [[xa, y0, z0, 0, 0], [xa, y0, z1, 1, 0], [xb, y1, z1, 1, 1], [xb, y1, z0, 0, 1]];
      const idx = s > 0 ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3];
      const nx = s * Math.cos(TUMBLE), ny = Math.sin(TUMBLE);
      idx.forEach(function (k) { P.push(q[k][0], q[k][1], q[k][2]); U.push(q[k][3], q[k][4]); N.push(nx, ny, 0); });
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(N, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(U, 2));
    g.computeBoundingSphere();
    return (FLAG_GEO = g);
  }
  function applyNation(mesh, id) {
    if (!mesh) return;
    const m = id ? flagMaterial(id) : null;
    mesh.visible = !!m;
    if (m) mesh.material = m;
  }

  /* =========================================================== build one */
  function hideProp(o, k, v) { Object.defineProperty(o, k, { value: v, enumerable: false, writable: true, configurable: true }); return v; }
  function buildStryker(ctx) {
    THREE = ctx.THREE || W.THREE || null;
    if (!THREE) return null;
    const scheme = ctx.scheme && SCHEME[ctx.scheme] ? ctx.scheme : "desert";
    const T = template(scheme), MT = T.MT, PT = T.parts;
    const matSlots = [];
    function meshes(parent, geos, name) {
      let first = null;
      Object.keys(geos).forEach(function (k) {
        const m = new THREE.Mesh(geos[k], MT[k]);
        m.castShadow = k !== "inside"; m.receiveShadow = true; m.name = name + ":" + k;
        parent.add(m); matSlots.push([m, k]);
        if (k === "paint" && !first) first = m;
      });
      return first;
    }
    const root = new THREE.Group(); root.name = "stryker_apc";
    const body = new THREE.Group(); body.name = "body"; body.position.y = 1.0; root.add(body);
    const hull = new THREE.Group(); hull.name = "hull"; hull.position.y = -1.0; body.add(hull);
    const hullMesh = meshes(hull, PT.hull, "hull");
    const slatG = new THREE.Group(); slatG.name = "slat"; hull.add(slatG); meshes(slatG, PT.slat, "slat");
    // the ramp on its hinge, its own slat panel
    const ramp = new THREE.Group(); ramp.name = "ramp"; ramp.position.set(0, RAMP.y0, -H.HL); hull.add(ramp);
    meshes(ramp, PT.ramp, "ramp");
    const rampSlat = new THREE.Group(); rampSlat.name = "rampSlat"; ramp.add(rampSlat); meshes(rampSlat, PT.rampSlat, "rampSlat");
    // RWS: yaw ("turret") -> cradle ("gun", elevates) -> M2 ("tube", recoils) -> muzzle
    const turret = new THREE.Group(); turret.name = "turret"; turret.position.set(RWS.x, H.roof + 0.08, RWS.z); hull.add(turret);
    meshes(turret, PT.rws, "rws");
    const gun = new THREE.Group(); gun.name = "gun"; gun.position.set(0, RWS.armY, 0.02); turret.add(gun);
    meshes(gun, PT.cradle, "cradle");
    let sensorGlass = null;
    gun.children.forEach(function (c) { if (c.name === "cradle:glass") sensorGlass = c; });
    const tube = new THREE.Group(); tube.name = "tube"; tube.position.set(0, 0.02, 0); gun.add(tube);
    meshes(tube, PT.m2, "m2");
    const muzzle = new THREE.Object3D(); muzzle.name = "muzzle"; muzzle.position.set(0, 0, RWS.muz + 0.04); tube.add(muzzle);
    // hatches
    const lidD = new THREE.Group(); lidD.name = "drvLid"; lidD.position.set(DRV.x, H.roof + 0.06, DRV.z - 0.30); hull.add(lidD); meshes(lidD, PT.lidD, "lid");
    const lidC = new THREE.Group(); lidC.name = "cmdLid"; lidC.position.set(CMD.x, H.roof + 0.10, CMD.z - 0.33); hull.add(lidC); meshes(lidC, PT.lidC, "lid");
    const ag = [1, -1].map(function (s) {
      const g = new THREE.Group(); g.name = "agLid"; g.position.set(s * 0.79, H.roof + 0.045, -2.32); g.scale.x = -s; hull.add(g); meshes(g, PT.lidA, "lid");
      return g;
    });
    // the crew and the air guards
    const seed = (ctx.seed | 0) + 11;
    const cmd = new THREE.Mesh(PT.cmd[seed % SKIN.length], MT.crew); cmd.name = "commander"; cmd.position.set(CMD.x, H.roof, CMD.z); hull.add(cmd);
    const drv = new THREE.Mesh(PT.drv[(seed * 3 + 1) % SKIN.length], MT.crew); drv.name = "driver"; drv.position.set(DRV.x, H.roof, DRV.z); hull.add(drv);
    const guards = [1, -1].map(function (s, i) {
      const m = new THREE.Mesh(PT.guard[(seed * 7 + i * 2) % SKIN.length], MT.crew); m.name = "airGuard";
      m.position.set(s * 0.47, H.roof, -2.25 + i * 0.2); m.rotation.y = s * 1.15; m.visible = false; hull.add(m);
      matSlots.push([m, "crew"]);
      return m;
    });
    matSlots.push([cmd, "crew"], [drv, "crew"]);
    const flagMesh = new THREE.Mesh(flagGeo(), MT.dark); flagMesh.name = "flag"; flagMesh.visible = false; hull.add(flagMesh);
    // the wheels: tyres, rims, half-shafts (instanced, on the root: they stay on the ground)
    const ims = {};
    [["tyre", "rubber"], ["rim", "gear"], ["shaft", "rubber"]].forEach(function (d) {
      const im = new THREE.InstancedMesh(PT[d[0]], MT[d[1]], NW);
      im.name = "wheels:" + d[0]; im.castShadow = d[0] !== "shaft"; im.receiveShadow = true;
      root.add(im); ims[d[0]] = im; matSlots.push([im, d[1]]);
    });
    const P = { body: body, turret: turret, gun: gun, tube: tube, muzzle: muzzle, ramp: ramp, slatMesh: slatG, rampSlat: rampSlat,
      lids: { drv: lidD, cmd: lidC, ag: ag }, cmd: cmd, drv: drv, guards: guards, sensorGlass: sensorGlass,
      ims: ims, hullMesh: hullMesh, flagMesh: flagMesh, matSlots: matSlots };
    const rig = new Rig(root, P, seed);
    rig.setScheme(scheme);
    hideProp(root.userData, "rig", rig);
    hideProp(root.userData, "turret", turret);
    root.userData.armorType = "apc";
    rig.settle();
    return { group: root, rig: rig, footW: 3.62, footL: 7.4, height: 2.67 };
  }
  // for node checks and the console
  CBZ.stryker = { dims: H, wheels: WH, rws: RWS, slat: SLAT, template: function (s) { return template(s || "desert"); } };
})();
