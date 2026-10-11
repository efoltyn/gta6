/* ============================================================
   units/vehicles/bradley_ifv.js — M2A3 BRADLEY infantry fighting vehicle (USA).

   Drawn here from scratch from the real vehicle, not from city/mil_armor.js
   (which drew a generic "Bradley/CV90 class" box). Units: metres, m/s, kg,
   armour in mm RHA equivalent. Nose is local +Z, the vehicle's LEFT is +X.

   THE REAL THING (M2A3, the numbers this file is built on)
     hull 6.55 m long, 3.28 m over the skirts (3.61 with BRAT tiles, not
     fitted here), hull roof 1.98 m, turret roof 2.70 m, CIV head 2.98 m,
     ground clearance 0.45 m. Welded aluminium hull with bolted spaced
     laminate steel armour on the sides and skirts. Driver front LEFT, the
     Cummins VTA-903T (600 hp) front RIGHT, two-man turret offset to the
     RIGHT, rear hydraulic ramp with a door in it, roof cargo hatch.
     Running gear: 6 dual road wheels a side on torsion bars, FRONT drive
     sprocket, REAR idler, 3 return rollers, T161 track (0.53 m, 152 mm
     pitch). 61 km/h road, pivot steer through the HMPT-500.
     Turret: M242 Bushmaster 25 mm chain gun (200 rds/min, M919 APFSDS-T at
     1385 m/s, M792 HEI-T at 1100 m/s), M240C 7.62 mm coax, twin TOW-2B
     launcher on the turret's LEFT side that RAISES to fire and must be
     stowed to move, IBAS gunner's sight front left, Commander's Independent
     Viewer (CIV) rear right, two M257 four-tube smoke dischargers. 900 rds
     of 25 mm, 7 TOW (2 in the box), 2,200 rds 7.62 mm.

   THE RIG (what the battle runtime, src/battle/vehicles.js, talks to)
     update(dt, v, w, steer)   running gear (tracks + road wheels on real
                               torsion-bar travel over the ground, belt wraps
                               the wheels it touches), hull squat / dive /
                               lean, recoil, TOW raise + reload, hatches,
                               heads out when calm, CIV scan, exhaust, dust
     aimTurret(yaw, elev, dt)  turret slew with drive inertia (60 deg/s),
                               gun -9..+59 deg; the raised TOW box follows
     muzzleWorld(out, shot)    the 25 mm muzzle, or the TOW tube in use
     fire(shot)                every round (shot.wid says which gun): the
                               25 mm recoils and spits its case, the coax
                               flashes, the TOW leaves its tube
     canFire(shot)             the TOW only with the launcher up, the hull
                               still and a round in a tube (the real TOW
                               cannot be fired on the move)
     damage(vs, res)           a resolve() result -> drooped gun, stopped
                               track, fire (every hit that lands)
     mark(nation, ground)      scheme by ground (woodland on grass / fields
                               / forest, else desert) + the nation's flag
     setNation(id), setScheme("desert"|"woodland"), ramp(open)
   All of it is the vehicle contract in docs/npcwar/ARCHITECTURE.md.

   KNOCKED OUT. The runtime clones and darkens every material of a dead
   hull (x0.55 knocked out, x0.28 catastrophic). The hull mesh notices that
   in its own onBeforeRender: hatches blow open, the crew figures are gone,
   and a catastrophic kill cooks off the 25 mm and TOW stowage: the turret
   is lifted off and the hull burns.

   PERF. One template per scheme (geometry + materials shared by every
   Bradley), per-vehicle meshes are views of it. Running gear = 5 instanced
   meshes; matrices are only rewritten while the hull moves. Exhaust, dust,
   fire and smoke are two shared point clouds; cases one instanced mesh.
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
  // hull, from the side: belly, lower glacis, nose, upper glacis, roof, rear
  const H = {
    HL: 3.275, roof: 1.98, belly: 0.45, tub: 1.06, spon: 1.55, sponB: 1.17, ch: 0.10, chH: 0.12,
    noseTop: 1.12, noseBot: 0.98, glacisZ: 1.62, lowZ: 2.62, rearBot: 0.62, rearBevZ: -3.0,
  };
  const TUR = { x: -0.22, z: -0.05, rate: 1.05, accel: 4.5, elevRate: 1.0, elevMin: -0.157, elevMax: 1.03 };
  const GUN = { x: 0.08, y: 0.44, z: 0.98, muz: 2.30 };
  const TR = 0.82;                     // turret roof above the hull roof
  const GEAR = {
    xs: [1.33, -1.33], w: 0.53, r: 0.305, thick: 0.045, pad: 0.03, pitch: 0.152,
    wheelZ: [-2.15, -1.30, -0.45, 0.40, 1.25, 2.10],
    drive: { z: 2.90, y: 0.80, r: 0.27 }, idler: { z: -2.90, y: 0.60, r: 0.27 },
    rollerZ: [1.45, 0.0, -1.45], rollerR: 0.10, travelUp: 0.20, travelDown: 0.08,
  };
  GEAR.axleY = GEAR.r + GEAR.thick + GEAR.pad;
  const OFF = GEAR.thick / 2;          // belt centreline sits this far outside a wheel
  function topAt(z) { return z <= H.glacisZ ? H.roof : H.roof + (z - H.glacisZ) * (H.noseTop - H.roof) / (H.HL - H.glacisZ); }
  function botAt(z) {
    if (z >= H.lowZ) return H.belly + (z - H.lowZ) * (H.noseBot - H.belly) / (H.HL - H.lowZ);
    if (z <= H.rearBevZ) return H.belly + (H.rearBevZ - z) * (H.rearBot - H.belly) / (H.rearBevZ + H.HL);
    return H.belly;
  }
  function zAtTop(y) { return H.glacisZ + (H.roof - y) / (H.roof - H.noseTop) * (H.HL - H.glacisZ); }

  /* ---------------------------------------------------------- the weapons */
  const TOW = { id: "tow_2b", seat: "gunner", kind: "missile", turret: true, rof: 0.05, vs: "armour",
    pen: 900, beh: 950, speed: 190, range: 3750, minRange: 65, ammo: 7 };
  const M242 = { id: "m242_25mm", seat: "gunner", kind: "autocannon", turret: true, rof: 3.33, burst: 4, pause: 1,
    pen: 65, beh: 140, he: { pen: 12, beh: 110, blast: 3, power: 0.55 }, speed: 1385, heSpeed: 1100, grav: 9.8, range: 2500, ammo: 900 };
  const COAX = { id: "m240_coax", seat: "gunner", kind: "mg", wid: "lmg", turret: true, rof: 10, burst: 8, pause: 1.2,
    dmg: 22, pen: 9, range: 900, ammo: 2200 };

  CBZ.unitKit.register("bradley_ifv", {
    kind: "vehicle",
    domain: "ground",
    drive: "tracked",
    stats: { hp: 600, mass: 30400, speed: 16.9, reverse: 5.5, accel: 1.7, turn: 0.75, length: 6.55, width: 3.28, height: 2.98,
      armour: { front: 70, side: 35, rear: 25, top: 18 }, standoff: 220, dismountAt: 140 },
    turret: { rate: TUR.rate, elevRate: TUR.elevRate, elevMin: TUR.elevMin, elevMax: TUR.elevMax },
    crew: [
      { seat: "driver", pos: [0.72, 1.5, 1.30] },
      { seat: "gunner", pos: [TUR.x + 0.40, 2.2, TUR.z - 0.55] },
      { seat: "commander", pos: [TUR.x - 0.42, 2.4, TUR.z - 0.62] },
    ],
    passengers: 6,
    // the TOW first: it makes the Bradley an anti-armour unit when armour is
    // about (vehPickTarget scores by the first weapon) and is skipped by its
    // own minRange gate whenever it cannot fire; then the chain gun, then the coax
    weapons: [TOW, M242, COAX],
    build: function (ctx) { return buildBradley(ctx || {}); },
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
     normals for plate, box-projected UVs (world-scale camouflage), a tint
     per piece and grime by height for painted metal ---------------------- */
  function Builder() { this.slots = {}; this.tint = [1, 1, 1]; }
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
  // cylinder along an axis ('x' | 'y' | 'z'); rTop at the + end
  Builder.prototype.cyl = function (slot, x, y, z, rTop, rBot, len, axis, seg, rx, ry, rz, tint, open) {
    const g = new THREE.CylinderGeometry(rTop, rBot, len, seg || 12, 1, !!open);
    if (axis === "x") g.rotateZ(-PI / 2); else if (axis === "z") g.rotateX(PI / 2);
    this.geo(slot, g, M4(x, y, z, rx, ry, rz), tint);
  };
  Builder.prototype.ball = function (slot, x, y, z, r, sx, sy, sz, tint, wseg, hseg) {
    this.geo(slot, new THREE.SphereGeometry(r, wseg || 10, hseg || 8), M4(x, y, z, 0, 0, 0, sx, sy, sz), tint);
  };
  // LOFT: closed solid through convex (or star-shaped) slices along an axis.
  // axis 'z': pts [x, y]; 'y': pts [x, z]; 'x': pts [z, y]
  Builder.prototype.loft = function (slot, axis, slices, tint) {
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
    [[0, 1], [last, last - 1]].forEach(function (pr) {
      const r = rings[pr[0]], c = cents[pr[0]], ref = cents[pr[1]];
      for (let j = 0; j < r.length; j++) self.tri(slot, c, r[j], r[(j + 1) % r.length], ref, tint);
    });
  };
  // a flat plate lying ON a surface with normal (0, cos a, sin a) about X
  Builder.prototype.onGlacis = function (slot, x, z, w, h, d, tint) {
    const a = Math.atan((H.roof - H.noseTop) / (H.HL - H.glacisZ));
    this.box(slot, x, topAt(z) + h / 2 * Math.cos(a), z + h / 2 * Math.sin(a), w, h, d, a, 0, 0, tint);
  };
  // finish: one BufferGeometry per slot. `grime` darkens low and underside
  // faces (dust, oil, shade); `uv` box-projects at 4 m per texture repeat.
  Builder.prototype.build = function (opts) {
    opts = opts || {};
    const out = {};
    const self = this;
    Object.keys(this.slots).forEach(function (k) {
      const s = self.slots[k];
      const P = new Float32Array(s.p), N = new Float32Array(s.n), C = new Float32Array(s.c);
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(P, 3));
      g.setAttribute("normal", new THREE.BufferAttribute(N, 3));
      const grime = opts.grime && opts.grime[k];
      if (grime) {
        const y0 = opts.y0 || 0;
        for (let i = 0; i < P.length / 3; i++) {
          const y = P[i * 3 + 1] + y0, ny = N[i * 3 + 1];
          let f = 1 - 0.30 * smooth(1.35, 0.35, y);
          if (ny < -0.5) f *= 0.55; else if (ny > 0.7) f *= 1.04;
          C[i * 3] = Math.min(1, C[i * 3] * f); C[i * 3 + 1] = Math.min(1, C[i * 3 + 1] * f * 0.985); C[i * 3 + 2] = Math.min(1, C[i * 3 + 2] * f * 0.96);
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

  /* ---- paint: CARC tan 686A (desert) or the NATO three-tone (woodland).
     A periodic value-noise field thresholded into crisp blotches. ---------- */
  function hash(i, j, s) { let h = (i * 374761393 + j * 668265263 + s * 2246822519) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
  function vnoise(x, y, P, s) {
    const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
    const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    const a = hash(((xi % P) + P) % P, ((yi % P) + P) % P, s), b = hash((((xi + 1) % P) + P) % P, ((yi % P) + P) % P, s);
    const c = hash(((xi % P) + P) % P, (((yi + 1) % P) + P) % P, s), d = hash((((xi + 1) % P) + P) % P, (((yi + 1) % P) + P) % P, s);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  function fbm(x, y, P, s) { return vnoise(x, y, P, s) * 0.55 + vnoise(x * 2, y * 2, P * 2, s + 1) * 0.3 + vnoise(x * 4, y * 4, P * 4, s + 2) * 0.15; }
  const SCHEME = {
    // colours picked against the studio key light: CARC tan 686A, and Green 383 / Brown 383 / Black
    desert: { base: [178, 158, 118], gear: 0xa8966f },
    woodland: { base: [74, 84, 56], brown: [92, 74, 52], black: [34, 34, 30], gear: 0x4a5438 },
  };
  function camoTexture(name) {
    if (typeof document === "undefined" || !document.createElement) return null;
    const N = 512, cv = document.createElement("canvas"); cv.width = cv.height = N;
    const g = cv.getContext && cv.getContext("2d");
    if (!g) return null;
    const im = g.createImageData ? g.createImageData(N, N) : null;
    if (!im || !im.data || !g.putImageData) return null;      // a canvas stub (node): flat paint
    const a = im.data, sc = SCHEME[name];
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const u = x / N * 4, v = y / N * 4;
        let c = sc.base;
        if (name === "woodland") {
          const b = fbm(u * 1.4, v * 1.4, 6, 11), k = fbm(u * 1.7 + 3, v * 1.7 + 7, 7, 23);
          if (b > 0.56) c = sc.brown;
          if (k > 0.63 && k < 0.71) c = sc.black;
        }
        const m = 0.86 + 0.2 * fbm(u * 3, v * 3, 12, 5) + 0.06 * fbm(u * 9, v * 1.5, 36, 3) + (hash(x, y, 9) - 0.5) * 0.05;
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
    const sc = SCHEME[scheme];
    const tex = camoTexture(scheme);
    const flat = sc.base;
    return {
      paint: std(tex ? { color: 0xffffff, map: tex, vertexColors: true, roughness: 0.78, metalness: 0.12 }
        : { color: (flat[0] << 16) | (flat[1] << 8) | flat[2], vertexColors: true }),
      gear: std({ color: sc.gear, vertexColors: true, roughness: 0.8, metalness: 0.15 }),
      dark: std({ color: 0x1e2022, roughness: 0.7, metalness: 0.3 }),
      metal: std({ color: 0x33363a, roughness: 0.45, metalness: 0.6 }),
      glass: std({ color: 0x14242c, roughness: 0.12, metalness: 0.4, emissive: 0x040a0c }),
      lamp: std({ color: 0xe8e2c8, roughness: 0.2, metalness: 0.2, emissive: 0x3a3424 }),
      tail: std({ color: 0x8a1c12, roughness: 0.3, metalness: 0.1, emissive: 0x2a0606 }),
      canvas: std({ color: 0xffffff, vertexColors: true, roughness: 0.95, metalness: 0 }),
      crew: std({ color: 0xffffff, vertexColors: true, roughness: 0.75, metalness: 0 }),
      shoe: std({ color: 0xffffff, vertexColors: true, roughness: 0.65, metalness: 0.35 }),
    };
  }
  const VC = { paint: 1, gear: 1, canvas: 1, crew: 1, shoe: 1 };

  /* ------------------------------------------------------------ the hull */
  function buildHull(B) {
    // the hull tub + sponsons + both glacis plates, lofted along Z
    const half = function (z) {
      const t = topAt(z), b = botAt(z), cy = function (y) { return clamp(y, b, t); };
      return [[H.tub, b], [H.tub, cy(H.sponB)], [H.spon, cy(H.sponB)], [H.spon, cy(H.roof - H.chH)], [H.spon - H.ch, cy(H.roof)]];
    };
    const sect = function (z) { const h = half(z), out = h.slice(); for (let i = h.length - 1; i >= 0; i--) out.push([-h[i][0], h[i][1]]); return out; };
    const zs = [-H.HL, H.rearBevZ, H.glacisZ, zAtTop(H.roof - H.chH), H.lowZ, zAtTop(H.sponB), H.HL].sort(function (a, b) { return a - b; });
    B.loft("paint", "z", zs.map(function (z) { return [z, sect(z)]; }));

    [-1, 1].forEach(function (s) {
      const xo = s * (H.spon + 0.028);
      // SPACED LAMINATE ARMOUR: bolted panels on the upper hull side, the
      // front one cut to the glacis line
      const y0 = H.sponB + 0.05, y1 = H.roof - H.chH - 0.02;
      [[-3.2, -2.04], [-2.0, -0.84], [-0.8, 0.36], [0.40, 0.96]].forEach(function (p) {
        B.box("paint", xo, (y0 + y1) / 2, (p[0] + p[1]) / 2, 0.05, y1 - y0, p[1] - p[0]);
        for (let z = p[0] + 0.1; z < p[1] - 0.05; z += 0.24) {
          [y0 + 0.05, y1 - 0.05].forEach(function (y) { B.cyl("paint", xo + s * 0.03, y, z, 0.018, 0.02, 0.02, "x", 6, 0, 0, 0, 0.82); });
        }
      });
      const zf = 2.75;
      B.loft("paint", "x", [[xo - 0.025, [[1.0, y0], [zf, y0], [zf, topAt(zf) - 0.05], [zAtTop(y1 + 0.02), y1], [1.0, y1]]],
        [xo + 0.025, [[1.0, y0], [zf, y0], [zf, topAt(zf) - 0.05], [zAtTop(y1 + 0.02), y1], [1.0, y1]]]]);
      for (let z = 1.1; z < 2.6; z += 0.24) B.cyl("paint", xo + s * 0.03, y0 + 0.05, z, 0.018, 0.02, 0.02, "x", 6, 0, 0, 0, 0.82);
      // SKIRTS over the top run: six bolted plates and the raked front plate
      const sx = s * 1.625, sy0 = 0.55, sy1 = H.sponB + 0.04;
      for (let i = 0; i < 6; i++) {
        const z0 = -3.1 + i * 0.95, z1 = z0 + 0.93;
        B.box("paint", sx, (sy0 + sy1) / 2, (z0 + z1) / 2, 0.04, sy1 - sy0, z1 - z0);
        for (let z = z0 + 0.12; z < z1 - 0.05; z += 0.23) {
          B.cyl("paint", sx + s * 0.025, sy1 - 0.06, z, 0.016, 0.018, 0.02, "x", 6, 0, 0, 0, 0.8);
          B.cyl("paint", sx + s * 0.025, sy0 + 0.07, z, 0.016, 0.018, 0.02, "x", 6, 0, 0, 0, 0.8);
        }
      }
      B.loft("paint", "x", [[sx - 0.02, [[2.6, sy0], [3.08, 0.86], [3.08, sy1], [2.6, sy1]]], [sx + 0.02, [[2.6, sy0], [3.08, 0.86], [3.08, sy1], [2.6, sy1]]]]);
      // HEADLIGHTS in their brush guards at the glacis corners
      const hz = 2.98, hy = topAt(hz) + 0.10;
      B.box("paint", s * 1.27, hy, hz, 0.24, 0.17, 0.16, 0, 0, 0, 0.9);
      B.cyl("lamp", s * 1.21, hy + 0.01, hz + 0.081, 0.055, 0.055, 0.01, "z", 12);
      B.box("tail", s * 1.36, hy + 0.01, hz + 0.081, 0.05, 0.05, 0.01);
      [-0.15, 0, 0.15].forEach(function (dx) { B.cyl("metal", s * 1.27 + dx, hy + 0.02, hz + 0.17, 0.012, 0.012, 0.26, "y", 5); });
      B.cyl("metal", s * 1.27, hy + 0.15, hz + 0.08, 0.012, 0.012, 0.34, "x", 5);
      B.cyl("metal", s * 1.27, hy + 0.15, hz + 0.04, 0.012, 0.012, 0.26, "z", 5);
      // TOW EYES on the nose
      B.box("paint", s * 0.82, 1.02, H.HL + 0.04, 0.1, 0.14, 0.1, 0, 0, 0, 0.85);
      B.cyl("metal", s * 0.82, 1.02, H.HL + 0.08, 0.06, 0.06, 0.05, "x", 10, 0, 0, 0, null, true);
      // REAR: stowage bins either side of the ramp, tail lights, rear lights
      const bx0 = s * 1.27;
      B.box("paint", bx0, 1.50, -H.HL - 0.17, 0.52, 0.66, 0.34);
      B.box("paint", bx0, 1.85, -H.HL - 0.17, 0.56, 0.04, 0.38, 0, 0, 0, 0.92);
      B.box("dark", bx0, 1.52, -H.HL - 0.345, 0.40, 0.01, 0.01);
      B.box("tail", s * 1.46, 1.70, -H.HL - 0.345, 0.07, 0.10, 0.015);
      B.box("lamp", s * 1.46, 1.57, -H.HL - 0.345, 0.07, 0.06, 0.015);
      // grab rails along the roof edge
      B.cyl("metal", s * 1.38, H.roof + 0.10, -1.9, 0.014, 0.014, 1.2, "z", 5);
      [-2.45, -1.35].forEach(function (z) { B.cyl("metal", s * 1.38, H.roof + 0.05, z, 0.014, 0.014, 0.1, "y", 5); });
    });

    // GLACIS: the engine access panel lines, its bolts, the trim of the nose
    B.onGlacis("paint", -0.45, 2.05, 1.5, 0.008, 0.018, 0.6);
    B.onGlacis("paint", -0.45, 3.0, 1.5, 0.008, 0.018, 0.6);
    B.onGlacis("paint", 0.3, 2.52, 0.018, 0.008, 0.96, 0.6);
    B.onGlacis("paint", -1.2, 2.52, 0.018, 0.008, 0.96, 0.6);
    for (let x = -1.1; x < 0.25; x += 0.22) { B.onGlacis("paint", x, 2.12, 0.04, 0.025, 0.04, 0.8); B.onGlacis("paint", x, 2.93, 0.04, 0.025, 0.04, 0.8); }
    B.box("paint", 0, H.noseBot + 0.07, H.HL + 0.01, 3.0, 0.03, 0.03, 0, 0, 0, 0.85);

    // ROOF: driver's hatch ring + periscopes (front left), engine grille and
    // exhaust (front right), turret ring, cargo hatch (rear)
    const dx = 0.72, dz = 1.30;
    B.cyl("paint", dx, H.roof + 0.03, dz, 0.36, 0.38, 0.06, "y", 18);
    [-0.75, -0.25, 0.25, 0.75].forEach(function (a) {
      const px = dx + Math.sin(a) * 0.45, pz = dz + Math.cos(a) * 0.45;
      B.box("paint", px, H.roof + 0.07, pz, 0.17, 0.10, 0.12, 0, a, 0, 0.9);
      B.box("glass", px + Math.sin(a) * 0.062, H.roof + 0.075, pz + Math.cos(a) * 0.062, 0.13, 0.05, 0.01, 0, a, 0);
    });
    B.box("paint", -1.01, H.roof + 0.015, 1.32, 0.86, 0.03, 0.50, 0, 0, 0, 0.9);
    for (let i = 0; i < 6; i++) B.box("dark", -1.01, H.roof + 0.035, 1.12 + i * 0.08, 0.78, 0.02, 0.03);
    B.box("paint", -1.32, H.roof + 0.11, 1.55, 0.26, 0.20, 0.36, 0, 0, 0, 0.88);
    for (let i = 0; i < 4; i++) B.box("dark", -1.455, H.roof + 0.06 + i * 0.04, 1.55, 0.01, 0.018, 0.30);
    B.cyl("paint", TUR.x, H.roof + 0.03, TUR.z, 1.02, 1.04, 0.06, "y", 28, 0, 0, 0, 0.9);
    B.box("paint", 0.0, H.roof + 0.025, -2.38, 1.30, 0.05, 1.12, 0, 0, 0, 0.96);
    B.box("dark", 0.0, H.roof + 0.052, -2.38, 1.22, 0.006, 0.012);
    [-0.45, 0.45].forEach(function (x) { B.cyl("metal", x, H.roof + 0.06, -1.80, 0.035, 0.035, 0.22, "x", 8); });
    B.cyl("metal", 0.3, H.roof + 0.08, -2.75, 0.012, 0.012, 0.22, "x", 5);

    // THE RAMP: hinged at the bottom, the troop door in its left half
    B.box("paint", 0, 1.26, -H.HL - 0.03, 1.9, 1.22, 0.06, 0, 0, 0, 0.96);
    B.box("paint", 0.35, 1.30, -H.HL - 0.065, 0.64, 1.06, 0.02, 0, 0, 0, 0.92);
    B.box("dark", 0.35, 1.30, -H.HL - 0.077, 0.66, 0.012, 0.006);
    B.box("metal", 0.10, 1.32, -H.HL - 0.09, 0.03, 0.14, 0.03);
    B.cyl("metal", 0, 0.68, -H.HL - 0.05, 0.05, 0.05, 1.9, "x", 10);
    B.box("metal", 0, 0.62, -H.HL - 0.12, 0.16, 0.10, 0.14);       // pintle
  }

  /* ------------------------------------------------------------ the turret */
  function buildTurret(B) {
    const sl = function (y, f, s, sb, r, rw) {
      return [y, [[f * 0.70, 0], [s, -0.35], [s, -sb], [rw, r], [-rw, r], [-s, -sb], [-s, -0.35], [-f * 0.70, 0]]];
    };
    // plan slices, written as [x, z]; front z added below
    const S = [
      [0.0, [[0.70, 1.00], [1.02, 0.68], [1.02, -0.95], [0.88, -1.25], [-0.88, -1.25], [-1.02, -0.95], [-1.02, 0.68], [-0.70, 1.00]]],
      [0.30, [[0.72, 1.08], [1.04, 0.74], [1.04, -0.98], [0.88, -1.28], [-0.88, -1.28], [-1.04, -0.98], [-1.04, 0.74], [-0.72, 1.08]]],
      [TR, [[0.56, 0.46], [0.92, 0.20], [0.94, -0.94], [0.80, -1.20], [-0.80, -1.20], [-0.94, -0.94], [-0.92, 0.20], [-0.56, 0.46]]],
    ];
    void sl;
    B.loft("paint", "y", S);
    B.cyl("paint", 0, 0.03, 0, 0.98, 0.98, 0.06, "y", 28, 0, 0, 0, 0.75);
    // the sloped front: the gun's mantlet opening and the coax port
    B.box("paint", GUN.x, GUN.y - 0.02, 1.0, 0.56, 0.46, 0.10, 0.30, 0, 0, 0.88);
    B.box("paint", GUN.x - 0.40, 0.38, 1.03, 0.10, 0.12, 0.10, 0, 0, 0, 0.85);
    // IBAS: the gunner's sight, front left, armoured doors over its windows
    const ix = 0.42, iz = 0.18;
    B.box("paint", ix, 0.96, iz, 0.46, 0.30, 0.56, 0, 0, 0, 0.96);
    B.loft("paint", "x", [[ix - 0.23, [[iz + 0.28, 0.82], [iz + 0.42, 0.82], [iz + 0.28, 1.11]]], [ix + 0.23, [[iz + 0.28, 0.82], [iz + 0.42, 0.82], [iz + 0.28, 1.11]]]]);
    B.box("glass", ix - 0.08, 1.00, iz + 0.285, 0.14, 0.12, 0.012);
    B.box("glass", ix + 0.10, 1.00, iz + 0.285, 0.12, 0.12, 0.012);
    [-1, 1].forEach(function (s) { B.box("paint", ix + s * 0.2, 1.02, iz + 0.36, 0.03, 0.18, 0.18, 0, s * 0.5, 0, 0.9); });
    // the commander's and gunner's hatch rings, vision blocks round the commander
    const cx = -0.42, cz = -0.62;
    B.cyl("paint", cx, 0.85, cz, 0.35, 0.37, 0.06, "y", 18);
    for (let i = 0; i < 6; i++) {
      const a = -1.6 + i * 0.64, px = cx + Math.sin(a) * 0.43, pz = cz + Math.cos(a) * 0.43;
      B.box("paint", px, 0.89, pz, 0.15, 0.10, 0.10, 0, a, 0, 0.9);
      B.box("glass", px + Math.sin(a) * 0.052, 0.895, pz + Math.cos(a) * 0.052, 0.11, 0.05, 0.01, 0, a, 0);
    }
    B.cyl("paint", 0.40, 0.85, -0.58, 0.31, 0.33, 0.06, "y", 16);
    B.cyl("paint", 0.40, 0.90, -0.58, 0.29, 0.29, 0.05, "y", 16, 0, 0, 0, 0.95);
    B.box("metal", 0.40, 0.94, -0.58, 0.20, 0.03, 0.03);
    // M257 smoke dischargers, four tubes a side, splayed out and up
    [-1, 1].forEach(function (s) {
      B.box("paint", s * 0.93, 0.50, 0.55, 0.16, 0.20, 0.20, 0, 0, 0, 0.85);
      for (let r = 0; r < 2; r++) for (let c = 0; c < 2; c++) {
        B.cyl("dark", s * (0.90 + c * 0.075), 0.47 + r * 0.075, 0.70, 0.032, 0.034, 0.18, "z", 8, -0.35, s * 0.4, 0);
      }
    });
    // the bustle rack and what rides in it
    const rz0 = -1.05, rz1 = -1.65;
    [0.34, 0.80].forEach(function (y) {
      B.cyl("metal", 0, y, rz1, 0.015, 0.015, 1.9, "x", 5);
      [-0.95, 0.95].forEach(function (x) { B.cyl("metal", x, y, (rz0 + rz1) / 2, 0.015, 0.015, rz0 - rz1, "z", 5); });
    });
    [-0.95, -0.32, 0.32, 0.95].forEach(function (x) { B.cyl("metal", x, 0.57, rz1, 0.015, 0.015, 0.46, "y", 5); });
    const bags = [
      [-0.62, 0.48, -1.38, 0.55, 0.38, 0.42, 0x8b7355], [-0.08, 0.46, -1.36, 0.45, 0.34, 0.48, 0x5d5b3f],
      [0.48, 0.47, -1.40, 0.58, 0.36, 0.40, 0xa08f6a], [0.2, 0.75, -1.33, 0.38, 0.12, 0.42, 0x2f312b],
    ];
    bags.forEach(function (b) { B.box("canvas", b[0], b[1] + 0.06, b[2], b[3], b[4], b[5], 0, 0.06 * b[0], 0, b[6]); });
    B.cyl("canvas", -0.25, 0.88, -1.30, 0.13, 0.13, 1.1, "x", 10, 0, 0, 0, 0x6a6448);
    // antennas: two whips off the rear corners
    [-0.72, 0.72].forEach(function (x) {
      B.cyl("dark", x, 0.90, -1.05, 0.045, 0.06, 0.16, "y", 8);
      B.cyl("dark", x, 0.98 + 1.2, -1.05 - 0.17, 0.004, 0.009, 2.4, "y", 4, -0.14, 0, 0);
    });
    // the TOW launcher's mount on the left side
    B.box("paint", 1.0, 0.30, 0.05, 0.12, 0.22, 0.95, 0, 0, 0, 0.85);
  }
  function buildGun(B) {
    // mantlet + the M242 in its housing; the barrel recoils inside "tube"
    B.box("paint", 0, 0, 0.12, 0.44, 0.34, 0.28, 0, 0, 0, 0.92);
    B.cyl("paint", 0, 0, 0.27, 0.16, 0.17, 0.08, "z", 14, 0, 0, 0, 0.9);
    B.cyl("dark", -0.40 + 0.0, -0.02, 0.30, 0.022, 0.022, 0.20, "z", 8);     // coax barrel through its port
  }
  function buildTube(B) {
    B.cyl("metal", 0, 0, 0.45, 0.072, 0.075, 0.42, "z", 14);
    B.cyl("metal", 0, 0, 1.30, 0.036, 0.042, 1.90, "z", 12);
    B.cyl("metal", 0, 0, 2.22, 0.046, 0.046, 0.12, "z", 12);
    B.cyl("dark", 0, 0, 2.285, 0.014, 0.014, 0.01, "z", 8);
  }
  function buildTowBox(B) {
    // two TOW tubes side by side in an armoured box (x across, z along)
    B.box("paint", 0, 0, 0, 0.58, 0.40, 1.50, 0, 0, 0, 0.97);
    B.box("paint", 0, 0.205, 0, 0.50, 0.02, 1.30, 0, 0, 0, 0.9);
    [-0.135, 0.135].forEach(function (x) {
      B.cyl("dark", x, 0, 0.752, 0.115, 0.115, 0.01, "z", 14);
      B.cyl("paint", x, 0, -0.752, 0.12, 0.12, 0.01, "z", 14, 0, 0, 0, 0.8);
    });
    B.box("dark", 0, -0.205, 0, 0.50, 0.012, 1.2);
  }

  /* ------------------------------------------------------------ the crew */
  const SKIN = [0xc8987a, 0x8d5a3b, 0xe0b898, 0x5f3a24, 0xb07a52];
  function buildFigure(B, skin, full) {
    // a head-out crewman: CVC helmet, goggles on the brow, OCP top, arms on the rim
    const ocp = 0x7b7458, cvc = 0x4a4a3a;
    if (full) {
      B.cyl("crew", 0, -0.22, 0, 0.19, 0.17, 0.50, "y", 10, 0, 0, 0, ocp);
      B.ball("crew", 0, 0.04, 0, 0.21, 1, 0.55, 0.85, ocp);
      [-1, 1].forEach(function (s) {
        B.cyl("crew", s * 0.24, 0.0, 0.10, 0.055, 0.06, 0.26, "z", 8, 0.3, s * 0.25, 0, ocp);
        B.ball("crew", s * 0.20, -0.05, 0.27, 0.05, 1, 0.8, 1, 0x3b3a30);
      });
    } else B.ball("crew", 0, 0.0, 0, 0.18, 1, 0.5, 0.8, ocp);
    B.cyl("crew", 0, 0.12, 0, 0.05, 0.055, 0.08, "y", 8, 0, 0, 0, skin);
    B.ball("crew", 0, 0.25, 0.01, 0.10, 0.92, 1.05, 1, skin);
    B.ball("crew", 0, 0.285, -0.01, 0.125, 1, 0.92, 1.05, cvc);
    [-1, 1].forEach(function (s) { B.cyl("crew", s * 0.115, 0.24, -0.005, 0.05, 0.05, 0.04, "x", 10, 0, 0, 0, 0x2f2f28); });
    B.box("crew", 0, 0.355, 0.09, 0.16, 0.045, 0.05, 0.25, 0, 0, 0x1a1c1d);
    B.cyl("crew", 0.03, 0.22, 0.11, 0.008, 0.008, 0.10, "x", 4, 0, 0, 0.4, 0x222222);   // boom mic
  }

  /* ------------------------------------------------------------ running gear */
  function wheelGeo(rTyre, discT) {
    // a DUAL road wheel: two rubber-tyred discs (the guide horn runs in the
    // gap), hub, bolt circle. Axle along X; tint = vertex colour x paint
    const B = new Builder();
    [-1, 1].forEach(function (s) {
      B.cyl("gear", s * 0.145, 0, 0, rTyre, rTyre, 0.20, "x", 22, 0, 0, 0, 0.11);
      B.cyl("gear", s * (0.145 + 0.101), 0, 0, rTyre * 0.80, rTyre * 0.80, 0.004, "x", 22, 0, 0, 0, discT);
      B.cyl("gear", s * 0.26, 0, 0, rTyre * 0.30, rTyre * 0.36, 0.035, "x", 12, 0, 0, 0, 0.6);
      for (let i = 0; i < 8; i++) {
        const a = i * PI / 4;
        B.cyl("gear", s * 0.252, Math.sin(a) * rTyre * 0.55, Math.cos(a) * rTyre * 0.55, 0.016, 0.016, 0.02, "x", 6, 0, 0, 0, 0.5);
      }
      B.cyl("gear", s * 0.248, 0, 0, rTyre * 0.70, rTyre * 0.70, 0.006, "x", 22, 0, 0, 0, discT * 0.82);
    });
    B.cyl("gear", 0, 0, 0, rTyre * 0.72, rTyre * 0.72, 0.09, "x", 16, 0, 0, 0, 0.5);
    return B.build({ vc: VC }).gear;
  }
  function sprocketGeo(r) {
    const B = new Builder(), teeth = 11;
    [-1, 1].forEach(function (s) {
      B.cyl("gear", s * 0.15, 0, 0, r * 0.86, r * 0.86, 0.06, "x", 22, 0, 0, 0, 0.75);
      for (let i = 0; i < teeth; i++) {
        const a = i * TAU / teeth;
        B.box("gear", s * 0.15, Math.cos(a) * r * 0.95, Math.sin(a) * r * 0.95, 0.06, r * 0.20, r * 0.24, a, 0, 0, 0.42);
      }
    });
    B.cyl("gear", 0, 0, 0, r * 0.45, r * 0.45, 0.36, "x", 14, 0, 0, 0, 0.7);
    for (let i = 0; i < 10; i++) {
      const a = i * TAU / 10;
      [-1, 1].forEach(function (s) { B.cyl("gear", s * 0.19, Math.sin(a) * r * 0.32, Math.cos(a) * r * 0.32, 0.018, 0.018, 0.03, "x", 6, 0, 0, 0, 0.45); });
    }
    B.cyl("gear", 0.20, 0, 0, r * 0.18, r * 0.22, 0.06, "x", 10, 0, 0, 0, 0.5);
    B.cyl("gear", -0.20, 0, 0, r * 0.18, r * 0.22, 0.06, "x", 10, 0, 0, 0, 0.5);
    return B.build({ vc: VC }).gear;
  }
  function shoeGeo() {
    // one T161 shoe: steel body, rubber road pads (ground side, -Y), the
    // centre guide horn (inside, +Y), end connectors and wedge bolts
    const B = new Builder(), w = GEAR.w, p = GEAR.pitch, t = GEAR.thick;
    B.box("shoe", 0, 0, 0, w, t, p * 0.80, 0, 0, 0, 0x45423d);
    [-1, 1].forEach(function (s) {
      B.box("shoe", s * w * 0.27, -t / 2 - GEAR.pad / 2, 0, w * 0.40, GEAR.pad, p * 0.66, 0, 0, 0, 0x1b1b1b);
      B.box("shoe", s * (w / 2 + 0.025), 0, p * 0.5 * 0.0, 0.05, t * 0.9, p * 0.98, 0, 0, 0, 0x3a3834);
      B.box("shoe", s * (w / 2 + 0.03), 0, 0, 0.03, 0.035, 0.035, 0, 0, 0, 0x2a2826);
    });
    B.box("shoe", 0, t / 2 + 0.045, 0, 0.05, 0.09, p * 0.40, 0, 0, 0, 0x55514a);
    return B.build({ vc: VC }).shoe;
  }

  /* ------------------------------------------------------------ the template */
  function template(scheme) {
    if (TPL[scheme]) return TPL[scheme];
    scratch();
    const MT = materials(scheme);
    const parts = {};
    let B = new Builder(); buildHull(B);
    parts.hull = B.build({ grime: { paint: 1 }, vc: VC, uv: { paint: 1 } });
    B = new Builder(); buildTurret(B);
    parts.turret = B.build({ grime: { paint: 1 }, y0: H.roof, vc: VC, uv: { paint: 1 } });
    B = new Builder(); buildGun(B); parts.gun = B.build({ vc: VC, uv: { paint: 1 } });
    B = new Builder(); buildTube(B); parts.tube = B.build({});
    B = new Builder(); buildTowBox(B); parts.tow = B.build({ vc: VC, uv: { paint: 1 } });
    B = new Builder(); B.box("paint", 0, 0, 0, 0.03, 0.30, 0.06); parts.strut = B.build({ vc: VC, uv: { paint: 1 } });
    // TOW tube end caps (the frangible covers of a loaded round)
    B = new Builder(); B.cyl("paint", 0, 0, 0, 0.11, 0.11, 0.012, "z", 14, 0, 0, 0, 0.85); parts.cap = B.build({ vc: VC, uv: { paint: 1 } });
    // hatch lids
    B = new Builder(); B.cyl("paint", 0, 0.02, 0.31, 0.31, 0.31, 0.05, "y", 16); B.box("metal", 0, 0.06, 0.31, 0.18, 0.025, 0.025); parts.lidC = B.build({ vc: VC, uv: { paint: 1 } });
    B = new Builder(); B.cyl("paint", 0, 0.02, 0.32, 0.32, 0.32, 0.05, "y", 16); B.box("metal", 0, 0.06, 0.32, 0.16, 0.025, 0.025); parts.lidD = B.build({ vc: VC, uv: { paint: 1 } });
    // CIV head (pedestal + armoured head) and its window
    B = new Builder();
    B.cyl("paint", 0, 0.14, 0, 0.16, 0.18, 0.28, "y", 14, 0, 0, 0, 0.9);
    B.box("paint", 0, 0.42, 0.02, 0.42, 0.28, 0.40);
    B.loft("paint", "x", [[-0.21, [[0.22, 0.28], [0.30, 0.30], [0.22, 0.56]]], [0.21, [[0.22, 0.28], [0.30, 0.30], [0.22, 0.56]]]]);
    B.box("glass", 0, 0.44, 0.225, 0.30, 0.13, 0.01);
    parts.civ = B.build({ vc: VC, uv: { paint: 1 } });
    // crew figures, one per skin tone
    parts.cmd = []; parts.drv = [];
    SKIN.forEach(function (sk) {
      let F = new Builder(); buildFigure(F, sk, true); parts.cmd.push(F.build({ vc: VC }).crew);
      F = new Builder(); buildFigure(F, sk, false); parts.drv.push(F.build({ vc: VC }).crew);
    });
    // running gear
    parts.wheel = wheelGeo(GEAR.r, 1.0);
    parts.idler = wheelGeo(GEAR.idler.r, 0.9);
    parts.roller = wheelGeo(GEAR.rollerR, 0.8);
    parts.sprocket = sprocketGeo(GEAR.drive.r);
    parts.shoe = shoeGeo();
    // instanced bounds: the whole running-gear envelope (r128 culls an
    // InstancedMesh by its geometry's sphere)
    const env = new THREE.Sphere(new THREE.Vector3(0, 0.6, 0), 3.6);
    ["wheel", "idler", "roller", "sprocket", "shoe"].forEach(function (k) { parts[k].boundingSphere = env.clone(); });
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
    this.n = n; this.next = 0; this.live = 0; this.last = 0;
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
    pts.name = "bradley-fx";
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
    if (this.life[i] <= 0 || this.age[i] >= this.life[i]) this.live++;
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
    this.live = live;
    if (!live) this.pts.visible = false;
    this.aP.needsUpdate = this.aS.needsUpdate = this.aA.needsUpdate = this.aC.needsUpdate = true;
  };
  // spent 25 mm cases out of the chute under the gun
  function Cases(n) {
    const g = new THREE.CylinderGeometry(0.0145, 0.0145, 0.137, 8);
    g.rotateX(PI / 2);
    const m = std({ color: 0xb08d3c, roughness: 0.35, metalness: 0.85 });
    this.im = new THREE.InstancedMesh(g, m, n); this.im.frustumCulled = false; this.im.name = "bradley-cases";
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
        const gy = CBZ.floorAt ? CBZ.floorAt(c.x, c.z) + 0.015 : 0.015;
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
    if (!FX.smoke) {
      FX.smoke = new Pool(900, false); FX.fire = new Pool(220, true); FX.cases = new Cases(48);
      CBZ.scene.add(FX.smoke.pts); CBZ.scene.add(FX.fire.pts); CBZ.scene.add(FX.cases.im);
    } else if (FX.smoke.pts.parent !== CBZ.scene) {
      CBZ.scene.add(FX.smoke.pts); CBZ.scene.add(FX.fire.pts); CBZ.scene.add(FX.cases.im);
    }
    return FX;
  }
  function flash(p, scale, color) { if (CBZ.muzzleFlash) { try { CBZ.muzzleFlash(p, { scale: scale, life: 0.07, color: color || 0xffd890 }); } catch (e) {} } }

  /* =========================================================== belt maths */
  // The track loop round a list of circles in CCW (z, y) order (bottom run
  // forward): outer tangents + arcs. A concave corner (a wheel lifted above
  // its neighbours) becomes a short chord: the belt bridges under it.
  function Belt(nc) {
    this.nc = nc;
    this.cz = new Float32Array(nc); this.cy = new Float32Array(nc); this.cr = new Float32Array(nc);
    const ns = nc * 2;
    this.kind = new Uint8Array(ns); this.s0 = new Float32Array(ns); this.len = new Float32Array(ns);
    this.a = new Float32Array(ns); this.b = new Float32Array(ns); this.c = new Float32Array(ns); this.d = new Float32Array(ns); this.e = new Float32Array(ns);
    this.nz = new Float32Array(nc); this.ny = new Float32Array(nc);
    this.total = 0; this.ns = 0;
  }
  Belt.prototype.solve = function () {
    const n = this.nc;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, Dz = this.cz[j] - this.cz[i], Dy = this.cy[j] - this.cy[i], L = Math.hypot(Dz, Dy) || 1e-6;
      const dz = Dz / L, dy = Dy / L, a = clamp((this.cr[i] - this.cr[j]) / L, -1, 1), b = Math.sqrt(1 - a * a);
      this.nz[i] = a * dz + b * dy; this.ny[i] = a * dy - b * dz;
    }
    let s = 0, k = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const z0 = this.cz[i] + this.cr[i] * this.nz[i], y0 = this.cy[i] + this.cr[i] * this.ny[i];
      const z1 = this.cz[j] + this.cr[j] * this.nz[i], y1 = this.cy[j] + this.cr[j] * this.ny[i];
      const L = Math.hypot(z1 - z0, y1 - y0) || 1e-6;
      this.kind[k] = 0; this.s0[k] = s; this.len[k] = L; this.a[k] = z0; this.b[k] = y0; this.c[k] = (z1 - z0) / L; this.d[k] = (y1 - y0) / L; s += L; k++;
      // round circle j from this edge's normal to the next edge's
      const a0 = Math.atan2(this.ny[i], this.nz[i]), a1 = Math.atan2(this.ny[j], this.nz[j]);
      const da = wrap(a1 - a0);
      if (da > 1e-4) {
        this.kind[k] = 1; this.s0[k] = s; this.len[k] = this.cr[j] * da; this.a[k] = this.cz[j]; this.b[k] = this.cy[j]; this.c[k] = this.cr[j]; this.d[k] = a0; this.e[k] = da;
        s += this.len[k]; k++;
      } else if (da < -1e-4) {
        const za = z1, ya = y1, zb = this.cz[j] + this.cr[j] * this.nz[j], yb = this.cy[j] + this.cr[j] * this.ny[j];
        const Lc = Math.hypot(zb - za, yb - ya) || 1e-6;
        this.kind[k] = 0; this.s0[k] = s; this.len[k] = Lc; this.a[k] = za; this.b[k] = ya; this.c[k] = (zb - za) / Lc; this.d[k] = (yb - ya) / Lc; s += Lc; k++;
      }
    }
    this.ns = k; this.total = s;
  };

  /* =========================================================== the rig */
  const NW = GEAR.wheelZ.length, NR = GEAR.rollerZ.length;
  function Rig(root, P, seed) {
    this.root = root; this.P = P; this.seed = seed | 0;
    this.body = P.body; this.turret = P.turret; this.gun = P.gun; this.tube = P.tube; this.muzzle = P.muzzle;
    this.tow = P.tow; this.towBox = P.towBox; this.struts = P.struts; this.caps = P.caps;
    this.civ = P.civ; this.cmdLid = P.cmdLid; this.drvLid = P.drvLid; this.cmd = P.cmd; this.drv = P.drv;
    this.ims = P.ims; this.hullMesh = P.hullMesh; this.mat0 = P.hullMesh.material;
    // drive state
    this.travL = 0; this.travR = 0; this.lastV = 0; this.accF = 0; this.pitch = 0; this.roll = 0; this.bounceT = seed * 0.37;
    this.off = new Float32Array(NW * 2); this.gearDirty = 2;
    this.belts = [new Belt(NW + 2 + NR), new Belt(NW + 2 + NR)];
    this.nShoe = P.nShoe;
    // turret / weapons
    this.tw = 0; this.elev = 0; this.engT = -1e9; this.fireT = -1e9; this.recoilT = 9; this.rockT = 9; this.rockYaw = 0;
    this.firingId = null; this.tubes = 2; this.loaded = 2; this.towRaise = 0; this.towWant = 0; this.stillT = 0; this.reloadT = 0; this.towNext = 0;
    this.gunDroop = 0; this.stopSide = -1; this.burnT = 0;
    // crew
    this.cmdUp = 1; this.drvUp = 1; this.calmT = 0; this.civYaw = 0; this.civT = seed * 1.3;
    // fx
    this.exhT = 0; this.dustT = 0; this.v = 0; this.w = 0;
    this.wrecked = false; this.wreckT = 0; this.toss = null; this.smokeT = 0;
    const self = this;
    this.hullMesh.onBeforeRender = function () { self.watch(); };
  }
  // ---- the gear -----------------------------------------------------------
  Rig.prototype.sampleGround = function (dt) {
    if (!CBZ.floorAt) return;
    const r = this.root;
    r.updateMatrix();
    const e = r.matrix.elements, upY = Math.max(0.5, e[5]);
    const k = dt > 0 ? Math.min(1, dt * 16) : 1;
    let moved = false;
    for (let s = 0; s < 2; s++) {
      const x = GEAR.xs[s];
      for (let i = 0; i < NW; i++) {
        const z = GEAR.wheelZ[i];
        // the rest contact point, in the world
        const wx = e[0] * x + e[8] * z + e[12], wy = e[1] * x + e[9] * z + e[13], wz = e[2] * x + e[10] * z + e[14];
        const want = clamp((CBZ.floorAt(wx, wz) - wy) / upY, -GEAR.travelDown, GEAR.travelUp);
        const o = s * NW + i, nv = this.off[o] + (want - this.off[o]) * k;
        if (Math.abs(nv - this.off[o]) > 1e-4) moved = true;
        this.off[o] = nv;
      }
    }
    if (moved) this.gearDirty = 1;
  };
  Rig.prototype.poseGear = function () {
    const ims = this.ims, G = GEAR;
    let wi = 0, ri = 0;
    const wa = ims.wheel.instanceMatrix.array, ia = ims.idler.instanceMatrix.array, ra = ims.roller.instanceMatrix.array;
    const sa = ims.sprocket.instanceMatrix.array, ta = ims.shoe.instanceMatrix.array;
    for (let s = 0; s < 2; s++) {
      const x = G.xs[s], trav = s === 0 ? this.travL : this.travR, bl = this.belts[s];
      let c = 0;
      // idler (rear), road wheels rear -> front, sprocket, rollers front -> rear
      bl.cz[c] = G.idler.z; bl.cy[c] = G.idler.y; bl.cr[c] = G.idler.r + OFF; c++;
      for (let i = 0; i < NW; i++) {
        const y = G.axleY + this.off[s * NW + i];
        bl.cz[c] = G.wheelZ[i]; bl.cy[c] = y; bl.cr[c] = G.r + OFF; c++;
        writeRX(wa, wi++, x, y, G.wheelZ[i], trav / G.r, 1);
      }
      bl.cz[c] = G.drive.z; bl.cy[c] = G.drive.y; bl.cr[c] = G.drive.r + OFF; c++;
      for (let i = 0; i < NR; i++) {
        const z = G.rollerZ[i];
        const yTop = G.idler.y + G.idler.r + (z - G.idler.z) / (G.drive.z - G.idler.z) * (G.drive.y + G.drive.r - G.idler.y - G.idler.r);
        const y = yTop - G.rollerR + 0.012;
        bl.cz[c] = z; bl.cy[c] = y; bl.cr[c] = G.rollerR + OFF; c++;
        writeRX(ra, ri++, x, y, z, -trav / G.rollerR, G.rollerR / G.r);
      }
      writeRX(ia, s, x, G.idler.y, G.idler.z, trav / G.idler.r, G.idler.r / G.r);
      writeRX(sa, s, x, G.drive.y, G.drive.z, trav / G.drive.r, 1);
      bl.solve();
      // the shoes: evenly spaced round the loop, the loop rolled by -travel
      const n = this.nShoe, pitch = bl.total / n;
      let sv = ((-trav % bl.total) + bl.total) % bl.total, seg = 0;
      while (seg < bl.ns - 1 && sv >= bl.s0[seg] + bl.len[seg]) seg++;
      for (let i = 0; i < n; i++) {
        if (sv >= bl.total) { sv -= bl.total; seg = 0; }
        while (seg < bl.ns - 1 && sv >= bl.s0[seg] + bl.len[seg]) seg++;
        const t = sv - bl.s0[seg];
        let z, y, tz, ty;
        if (bl.kind[seg] === 0) { z = bl.a[seg] + bl.c[seg] * t; y = bl.b[seg] + bl.d[seg] * t; tz = bl.c[seg]; ty = bl.d[seg]; }
        else { const an = bl.d[seg] + t / bl.c[seg]; z = bl.a[seg] + bl.c[seg] * Math.cos(an); y = bl.b[seg] + bl.c[seg] * Math.sin(an); tz = -Math.sin(an); ty = Math.cos(an); }
        writeShoe(ta, s * n + i, x, y, z, tz, ty);
        sv += pitch;
      }
    }
    ims.wheel.instanceMatrix.needsUpdate = ims.idler.instanceMatrix.needsUpdate = ims.roller.instanceMatrix.needsUpdate = true;
    ims.sprocket.instanceMatrix.needsUpdate = ims.shoe.instanceMatrix.needsUpdate = true;
  };
  // a wheel: rotation about X by `a`, scale (1, s, s), at (x, y, z)
  function writeRX(arr, i, x, y, z, a, s) {
    const c = Math.cos(a), sn = Math.sin(a), o = i * 16;
    arr[o] = 1; arr[o + 1] = 0; arr[o + 2] = 0; arr[o + 3] = 0;
    arr[o + 4] = 0; arr[o + 5] = c * s; arr[o + 6] = sn * s; arr[o + 7] = 0;
    arr[o + 8] = 0; arr[o + 9] = -sn * s; arr[o + 10] = c * s; arr[o + 11] = 0;
    arr[o + 12] = x; arr[o + 13] = y; arr[o + 14] = z; arr[o + 15] = 1;
  }
  // a shoe: its +Z along the belt (tz, ty), +Y into the loop
  function writeShoe(arr, i, x, y, z, tz, ty) {
    const o = i * 16;
    arr[o] = 1; arr[o + 1] = 0; arr[o + 2] = 0; arr[o + 3] = 0;
    arr[o + 4] = 0; arr[o + 5] = tz; arr[o + 6] = -ty; arr[o + 7] = 0;
    arr[o + 8] = 0; arr[o + 9] = ty; arr[o + 10] = tz; arr[o + 11] = 0;
    arr[o + 12] = x; arr[o + 13] = y; arr[o + 14] = z; arr[o + 15] = 1;
  }

  // ---- per frame ----------------------------------------------------------
  Rig.prototype.update = function (dt, v, w) {
    dt = clamp(dt || 0, 0, 0.1);
    if (this.wrecked) return;
    v = v || 0; w = w || 0;
    this.v = v; this.w = w;
    const t = now();
    // the belts: each side runs at the hull speed less the turn
    const vl = this.stopSide === 0 ? 0 : v - w * GEAR.xs[0], vr = this.stopSide === 1 ? 0 : v - w * GEAR.xs[1];
    this.travL += vl * dt; this.travR += vr * dt;
    const moving = Math.abs(vl) + Math.abs(vr) > 0.02;
    if (moving || this.gearDirty) { this.sampleGround(dt); }
    if (moving || this.gearDirty) { this.poseGear(); if (!moving) this.gearDirty = Math.max(0, this.gearDirty - 1); }
    // the hull on its torsion bars: squat under power, dive under braking,
    // lean out of a turn, a little road bounce, rock from the gun
    const acc = dt > 0 ? (v - this.lastV) / dt : 0;
    this.lastV = v;
    this.accF += (acc - this.accF) * Math.min(1, dt * 5);
    this.bounceT += dt * (2.2 + Math.abs(v) * 0.25);
    const bounce = Math.min(1, Math.abs(v) / 8) * 0.004;
    let px = clamp(-this.accF * 0.010, -0.035, 0.035) + Math.sin(this.bounceT * 3.1) * bounce;
    let rz = clamp(v * w * 0.006, -0.03, 0.03) + Math.sin(this.bounceT * 2.3 + 1) * bounce * 0.6;
    if (this.rockT < 1.5) {
      this.rockT += dt;
      const a = 0.006 * Math.exp(-5 * this.rockT) * Math.cos(14 * this.rockT);
      px -= a * Math.cos(this.rockYaw); rz += a * Math.sin(this.rockYaw);
    }
    this.pitch += (px - this.pitch) * Math.min(1, dt * 6); this.roll += (rz - this.roll) * Math.min(1, dt * 6);
    this.body.rotation.set(this.pitch, 0, this.roll);
    // the turret home to twelve o'clock when nobody is laying it
    const engaged = t - this.engT < 1500;
    if (!engaged && t - this.engT > 3000) this.lay(0, 0, dt, 0.5);
    // the chain gun's barrel runs out and back on every round
    if (this.recoilT < 0.3) {
      this.recoilT += dt;
      const k = this.recoilT < 0.025 ? this.recoilT / 0.025 : Math.max(0, 1 - (this.recoilT - 0.025) / 0.12);
      this.tube.position.z = -0.045 * k;
    } else this.tube.position.z = 0;
    // TOW: the box comes up when the hull has been still for a second
    // under fire, goes down to move or to reload through the cargo hatch
    if (Math.abs(v) < 0.4) this.stillT += dt; else this.stillT = 0;
    if (this.tubes <= 0) {
      this.towWant = 0;
      this.reloadT -= dt;
      if (this.reloadT <= 0) { this.tubes = 2; this.caps[0].visible = this.caps[1].visible = true; }
    } else if (engaged && this.stillT > 1.0) this.towWant = 1;
    else if (Math.abs(v) > 1.2 || t - this.engT > 20000) this.towWant = 0;
    this.loaded = this.tubes;
    const rr = this.towWant - this.towRaise;
    if (Math.abs(rr) > 1e-4) { this.towRaise += clamp(rr, -dt / 3.5, dt / 3.5); }
    this.poseTow();
    // gun droop when the firepower is gone
    if (this.gunDroop > 0) this.gun.rotation.x += (this.gunDroop - this.gun.rotation.x) * Math.min(1, dt * 2);
    // crew: heads out when nothing has happened for a while, down at the first shot
    const calm = t - this.engT > 8000 && t - this.fireT > 15000 && this.burnT <= 0;
    this.cmdUp += clamp((calm ? 1 : 0) - this.cmdUp, -dt * 2.5, dt * 0.8);
    this.drvUp += clamp((calm ? 1 : 0) - this.drvUp, -dt * 2.5, dt * 0.7);
    this.poseCrew();
    // the CIV sweeps its sector when calm; on target it looks down the gun
    this.civT += dt;
    const cw = engaged ? 0 : Math.sin(this.civT * 0.35) * 1.3;
    this.civYaw += clamp(cw - this.civYaw, -dt * 1.2, dt * 1.2);
    this.civ.rotation.y = this.civYaw;
    // exhaust and dust
    this.emit(dt, v, w);
    if (this.burnT > 0) this.burnT -= dt;
  };
  Rig.prototype.poseTow = function () {
    const r = smooth(0, 1, this.towRaise);
    // stowed hugging the turret side; raised on its arm above the roofline
    const x = 1.32 - 0.20 * r, y = 0.32 + 0.74 * r;
    this.towBox.position.set(x, y, 0.05);
    this.towBox.rotation.x = -this.elev * r;
    for (let i = 0; i < 2; i++) {
      const s = this.struts[i], ax = 1.02, ay = 0.30, bx = x - 0.22, by = y - 0.12;
      const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy);
      s.visible = r > 0.05;
      s.position.set((ax + bx) / 2, (ay + by) / 2, i ? -0.45 : 0.55);
      s.rotation.z = -Math.atan2(dx, dy);
      s.scale.y = Math.max(0.05, L / 0.30);
    }
  };
  Rig.prototype.poseCrew = function () {
    const c = smooth(0, 1, this.cmdUp), d = smooth(0, 1, this.drvUp);
    this.cmdLid.rotation.x = -1.75 * smooth(0, 0.35, this.cmdUp);
    this.drvLid.rotation.x = -1.6 * smooth(0, 0.35, this.drvUp);
    this.cmd.position.y = 0.85 - 0.95 + 0.95 * c; this.cmd.visible = c > 0.02;
    this.drv.position.y = H.roof - 0.62 + 0.62 * d; this.drv.visible = d > 0.02;
  };
  Rig.prototype.emit = function (dt, v, w) {
    const F = fx();
    if (!F) return;
    const e = this.root.matrix.elements;
    // EXHAUST: the grille on the right of the roof, a dark burst when the
    // diesel is loaded (accelerating, pivoting), a thin haze at idle
    const load = clamp(this.accF * 0.6, 0, 1) + clamp(Math.abs(w) * 0.8, 0, 0.6);
    this.exhT -= dt;
    if (this.exhT <= 0) {
      this.exhT = load > 0.25 ? 0.05 : 0.28;
      const lx = -1.47, ly = H.roof + 0.12, lz = 1.55;
      const x = e[0] * lx + e[4] * ly + e[8] * lz + e[12], y = e[1] * lx + e[5] * ly + e[9] * lz + e[13], z = e[2] * lx + e[6] * ly + e[10] * lz + e[14];
      const k = 0.6 + load * 1.6, g = load > 0.25 ? 0.16 : 0.42;
      F.smoke.emit(x, y, z, -e[0] * 1.6 + e[4] * 0.8 + (Math.random() - 0.5) * 0.3, 0.9 + Math.random() * 0.4, -e[2] * 1.6 + e[6] * 0.8 + (Math.random() - 0.5) * 0.3,
        0.25, 1.4 * k, load > 0.25 ? 0.42 : 0.12, 1.4 + Math.random(), g, g, g * 1.05, 0.9, 0.5);
    }
    // DUST off the tracks: where the belts leave the ground
    const sp = Math.abs(v) + Math.abs(w) * 1.5;
    if (sp > 1.0) {
      this.dustT -= dt * clamp(sp / 4, 0.3, 4);
      if (this.dustT <= 0) {
        this.dustT = 0.08;
        for (let s = 0; s < 2; s++) {
          const lx = GEAR.xs[s] * 1.05, lz = v >= 0 ? -3.0 : 3.0, ly = 0.15;
          const x = e[0] * lx + e[8] * lz + e[12], y = e[1] * lx + e[9] * lz + e[13] + ly, z = e[2] * lx + e[10] * lz + e[14];
          const back = v >= 0 ? -1 : 1;
          F.smoke.emit(x, y, z, e[8] * back * 1.5 + (Math.random() - 0.5) * 1.2, 0.5 + Math.random() * 0.6, e[10] * back * 1.5 + (Math.random() - 0.5) * 1.2,
            0.8, 3.6 + Math.random() * 1.8, clamp(sp / 14, 0.10, 0.34), 2.5 + Math.random() * 1.8, 0.74, 0.66, 0.52, 0.8, 0.12);
        }
      }
    }
    // BURNING (a damage hook said so): flame and black smoke off the engine deck
    if (this.burnT > 0) this.burnFX(dt, -1.0, H.roof + 0.1, 1.32, 1);
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
  // ---- the turret ---------------------------------------------------------
  Rig.prototype.lay = function (wantYaw, wantElev, dt, k) {
    const cur = this.turret.rotation.y, d = wrap(wantYaw - cur), rate = TUR.rate * (k || 1);
    const want = clamp(d * 5, -rate, rate);
    this.tw += clamp(want - this.tw, -TUR.accel * dt, TUR.accel * dt);
    if (Math.abs(d) < 1e-3 && Math.abs(this.tw) < 0.05) this.tw = 0;
    this.turret.rotation.y = wrap(cur + this.tw * dt);
    const e = clamp(wantElev, TUR.elevMin, TUR.elevMax);
    this.elev += clamp(e - this.elev, -TUR.elevRate * dt, TUR.elevRate * dt);
    if (this.gunDroop <= 0) this.gun.rotation.x = -this.elev;
  };
  Rig.prototype.aimTurret = function (wantYaw, wantElev, dt) {
    if (this.wrecked) return;
    this.engT = now();
    this.lay(wantYaw, wantElev, clamp(dt || 0, 0, 0.1), 1);
  };
  Rig.prototype.towReady = function () {
    return this.tubes > 0 && this.towRaise > 0.98 && Math.abs(this.v) < 0.3 && this.gunDroop <= 0 && now() >= this.towNext;
  };
  // the runtime's hooks (the vehicle contract): which gun, from the shot
  Rig.prototype.canFire = function (shot) { return !shot || shot.wid !== "tow_2b" || this.towReady(); };
  Rig.prototype.fire = function (shot) {
    const id = shot && shot.wid;
    // the 25 mm's flash at the muzzle (its smoke and case are onFire's)
    if (id === "m242_25mm") { const p = this.muzzleWorld(_m.v2, shot); if (p) flash(p, 1.5, 0xffe0a0); }
    this.onFire(id);
  };
  Rig.prototype.onFire = function (id) {
    this.firingId = id;
    this.fireT = now();
    this.cmdUp = Math.min(this.cmdUp, 0.3); this.drvUp = Math.min(this.drvUp, 0.3);
    const F = fx();
    if (id === "m242_25mm") {
      this.recoilT = 0; this.rockT = 0; this.rockYaw = this.turret.rotation.y;
      const p = this.muzzleWorld(_m.v2);
      if (F && p) {
        F.smoke.emit(p.x, p.y, p.z, 0, 0.4, 0, 0.25, 1.6, 0.30, 0.9, 0.62, 0.60, 0.57, 2.5, 0.3);
        // the case leaves the chute under the mantlet, forward and down
        const c = _m.v3.set(0, -0.20, 0.30).applyMatrix4(this.gun.matrixWorld);
        const d = this.gun.getWorldDirection(_m.v);
        F.cases.emit(c.x, c.y, c.z, d.x * 2.5 + (Math.random() - 0.5), -0.5, d.z * 2.5 + (Math.random() - 0.5));
      }
    } else if (id === "m240_coax") {
      this.root.updateMatrixWorld(true);
      const p = _m.v2.set(-0.40, -0.02, 0.42).applyMatrix4(this.gun.matrixWorld);
      flash(p, 0.7);
    } else if (id === "tow_2b") {
      const i = clamp(this.tubes - 1, 0, 1);
      this.caps[i].visible = false;
      this.tubes = Math.max(0, this.tubes - 1); this.loaded = this.tubes;
      this.towNext = now() + 3000;
      if (this.tubes <= 0) this.reloadT = 45;                // two rounds out of stowage through the roof hatch
      this.root.updateMatrixWorld(true);
      const m = _m.v2.set(i ? 0.135 : -0.135, 0, 0.80).applyMatrix4(this.towBox.matrixWorld);
      flash(m, 2.6, 0xfff0c0);
      if (F) {
        const b = _m.v3.set(i ? 0.135 : -0.135, 0, -0.8).applyMatrix4(this.towBox.matrixWorld);
        const d = this.towBox.getWorldDirection(_m.v);
        for (let k = 0; k < 22; k++) {
          const sp = 3 + Math.random() * 9;
          F.smoke.emit(b.x, b.y, b.z, -d.x * sp + (Math.random() - 0.5) * 2, (Math.random() - 0.2) * 2, -d.z * sp + (Math.random() - 0.5) * 2,
            0.6, 3.5 + Math.random() * 2, 0.5, 2.5 + Math.random() * 2, 0.86, 0.84, 0.8, 1.6, 0.4);
        }
        for (let k = 0; k < 6; k++) F.fire.emit(b.x, b.y, b.z, -d.x * 6, 0, -d.z * 6, 0.5, 1.6, 0.8, 0.25, 1, 0.7, 0.3, 4, 0);
      }
    }
  };
  Rig.prototype.muzzleWorld = function (out, shot) {
    out = out || new THREE.Vector3();
    this.root.updateMatrixWorld(true);
    if (shot && shot.wid === "tow_2b") {
      const i = clamp(this.tubes - 1, 0, 1);   // the tube about to fire
      return out.set(i ? 0.135 : -0.135, 0, 0.85).applyMatrix4(this.towBox.matrixWorld);
    }
    return this.muzzle.getWorldPosition(out);
  };
  Rig.prototype.settle = function () {
    this.body.rotation.set(0, 0, 0); this.tube.position.z = 0;
    this.recoilT = 9; this.rockT = 9; this.pitch = this.roll = 0; this.lastV = 0; this.accF = 0;
    for (let i = 0; i < this.off.length; i++) this.off[i] = 0;
    this.sampleGround(0);
    this.poseGear(); this.poseTow(); this.poseCrew();
  };
  // every hit that lands: the runtime hands over the damage state and the resolve() result
  Rig.prototype.damage = function (vs, res) {
    if (!res) return;
    if (res.firepower) this.gunDroop = 0.14;
    if (res.mobility && this.stopSide < 0) this.stopSide = Math.random() < 0.5 ? 0 : 1;
    if (res.burning) this.burnT = 40;
  };
  Rig.prototype.ramp = function () { /* the ramp is drawn shut; a lowered ramp waits on the runtime telling us */ };
  Rig.prototype.setNation = function (id) { applyNation(this.root, this.P.flagMesh, id); };
  // the side's markings, right after build: the scheme for the ground, the flag
  Rig.prototype.mark = function (nation, ground) {
    const g = String(ground || "");
    const scheme = /grass|field|forest|wood|jungle|farm|island/.test(g) || (nation && WOODLAND[nation] && !/sand|desert|dune/.test(g)) ? "woodland" : "desert";
    this.setScheme(scheme);
    if (nation) this.setNation(nation);
  };
  Rig.prototype.setScheme = function (name) {
    const T = template(SCHEME[name] ? name : "desert");
    const map = this.P.matSlots;
    for (let i = 0; i < map.length; i++) map[i][0].material = T.MT[map[i][1]];
    this.mat0 = this.hullMesh.material;
  };
  // ---- knocked out ---------------------------------------------------------
  Rig.prototype.watch = function () {
    if (this.wrecked) { this.wreckStep(); return; }
    const m = this.hullMesh.material;
    if (m === this.mat0 || !m.color || !this.mat0.color) return;
    const k = m.color.r / Math.max(1e-3, this.mat0.color.r);
    this.wreck(k < 0.4);
  };
  Rig.prototype.wreck = function (catastrophic) {
    this.wrecked = true; this.wreckT = now(); this.cat = catastrophic;
    this.cmd.visible = false; this.drv.visible = false;
    this.cmdLid.rotation.x = -2.0; this.drvLid.rotation.x = -1.9;
    this.burnT = catastrophic ? 90 : 25;
    if (catastrophic) {
      // the stowed 25 mm and TOW rounds cook off: the turret lifts off its ring
      const s = Math.random() < 0.5 ? 1 : -1;
      this.toss = { vx: s * (1.6 + Math.random() * 1.6), vy: 6.5 + Math.random() * 2.5, vz: (Math.random() - 0.5) * 2,
        wx: (Math.random() - 0.5) * 3, wz: s * (1.5 + Math.random() * 2), done: false, last: now() };
      this.gun.rotation.x = 0.1;
      const F = fx();
      if (F) {
        this.root.updateMatrixWorld(true);
        const p = _m.v3.set(TUR.x, H.roof + 0.5, TUR.z).applyMatrix4(this.root.matrixWorld);
        for (let k = 0; k < 30; k++) F.fire.emit(p.x, p.y, p.z, (Math.random() - 0.5) * 8, 2 + Math.random() * 9, (Math.random() - 0.5) * 8, 0.8, 2.6, 0.9, 0.5 + Math.random() * 0.6, 1, 0.55, 0.2, 2, 0.5);
      }
    } else this.gun.rotation.x = 0.12;
  };
  Rig.prototype.wreckStep = function () {
    const t = now(), age = (t - this.wreckT) / 1000;
    const T = this.toss;
    if (T && !T.done) {
      const dt = clamp((t - T.last) / 1000, 0, 0.05); T.last = t;
      const tr = this.turret;
      T.vy -= 9.8 * dt;
      tr.position.x += T.vx * dt; tr.position.y += T.vy * dt; tr.position.z += T.vz * dt;
      tr.rotation.x += T.wx * dt; tr.rotation.z += T.wz * dt;
      const onHull = Math.abs(tr.position.x) < H.spon + 0.2 && Math.abs(tr.position.z) < H.HL;
      const floor = onHull ? H.roof + 0.25 : 0.55;
      if (tr.position.y < floor && T.vy < 0) {
        tr.position.y = floor; T.done = true;
        tr.rotation.x = clamp(tr.rotation.x, -0.5, 0.5); tr.rotation.z = clamp(tr.rotation.z, -0.6, 0.6);
      }
    }
    if (this.burnT > 0 && age < this.burnT) {
      const dt = clamp((t - (this._wl || t)) / 1000, 0, 0.1); this._wl = t;
      if (this.cat) this.burnFX(dt, TUR.x, H.roof + 0.1, TUR.z, 1.4);
      else this.burnFX(dt, -0.42 + TUR.x, H.roof + 0.8, TUR.z - 0.62, 0.6);
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
    // one painted flag on each side of the hull, hoist forward on both
    const x = H.spon + 0.056, y0 = 1.42, y1 = 1.70, z0 = -1.15, z1 = -1.62;
    const P = [], U = [], N = [];
    [-1, 1].forEach(function (s) {
      const xx = s * x, q = [[xx, y0, z0, 0, 0], [xx, y0, z1, 1, 0], [xx, y1, z1, 1, 1], [xx, y1, z0, 0, 1]];
      const idx = s > 0 ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3];
      idx.forEach(function (k) { P.push(q[k][0], q[k][1], q[k][2]); U.push(q[k][3], q[k][4]); N.push(s, 0, 0); });
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(N, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(U, 2));
    g.computeBoundingSphere();
    return (FLAG_GEO = g);
  }
  function applyNation(root, mesh, id) {
    if (!mesh) return;
    const m = id ? flagMaterial(id) : null;
    mesh.visible = !!m;
    if (m) mesh.material = m;
  }
  // nations that field woodland green; everyone else wears desert tan
  const WOODLAND = { republic: 1, veridia: 1 };

  /* =========================================================== build one */
  function hideProp(o, k, v) { Object.defineProperty(o, k, { value: v, enumerable: false, writable: true, configurable: true }); return v; }
  function buildBradley(ctx) {
    THREE = ctx.THREE || W.THREE || null;
    if (!THREE) return null;
    const scheme = ctx.scheme && SCHEME[ctx.scheme] ? ctx.scheme : (ctx.nation && WOODLAND[ctx.nation] ? "woodland" : "desert");
    const T = template(scheme), MT = T.MT, PT = T.parts;
    const matSlots = [];
    function meshes(parent, geos, name) {
      let first = null;
      Object.keys(geos).forEach(function (k) {
        const m = new THREE.Mesh(geos[k], MT[k]);
        m.castShadow = true; m.receiveShadow = true; m.name = name + ":" + k;
        parent.add(m); matSlots.push([m, k]);
        if (k === "paint" && !first) first = m;
      });
      return first;
    }
    const root = new THREE.Group(); root.name = "bradley_ifv";
    const body = new THREE.Group(); body.name = "body"; body.position.y = 1.0; root.add(body);
    const hull = new THREE.Group(); hull.name = "hull"; hull.position.y = -1.0; body.add(hull);
    const hullMesh = meshes(hull, PT.hull, "hull");
    // turret -> gun (trunnions) -> tube (recoils) -> muzzle
    const turret = new THREE.Group(); turret.name = "turret"; turret.position.set(TUR.x, H.roof, TUR.z); hull.add(turret);
    meshes(turret, PT.turret, "turret");
    const gun = new THREE.Group(); gun.name = "gun"; gun.position.set(GUN.x, GUN.y, GUN.z); turret.add(gun);
    meshes(gun, PT.gun, "gun");
    const tube = new THREE.Group(); tube.name = "tube"; gun.add(tube);
    meshes(tube, PT.tube, "tube");
    const muzzle = new THREE.Object3D(); muzzle.name = "muzzle"; muzzle.position.set(0, 0, GUN.muz); tube.add(muzzle);
    // the TOW launcher on its arm, two struts, two tube caps
    const tow = new THREE.Group(); tow.name = "tow"; turret.add(tow);
    const towBox = new THREE.Group(); towBox.name = "towBox"; tow.add(towBox);
    meshes(towBox, PT.tow, "tow");
    const caps = [-0.135, 0.135].map(function (x) {
      const m = new THREE.Mesh(PT.cap.paint, MT.paint); m.position.set(x, 0, 0.758); m.name = "towCap"; towBox.add(m); matSlots.push([m, "paint"]); return m;
    });
    const struts = [0, 1].map(function () { const m = new THREE.Mesh(PT.strut.paint, MT.paint); m.name = "towStrut"; tow.add(m); matSlots.push([m, "paint"]); return m; });
    // CIV head, hatch lids, the crew
    const civ = new THREE.Group(); civ.name = "civ"; civ.position.set(-0.48, TR, 0.08); turret.add(civ);
    meshes(civ, PT.civ, "civ");
    const cmdLid = new THREE.Group(); cmdLid.name = "cmdLid"; cmdLid.position.set(-0.42, 0.87, -0.62 - 0.31); turret.add(cmdLid);
    meshes(cmdLid, PT.lidC, "lid");
    const drvLid = new THREE.Group(); drvLid.name = "drvLid"; drvLid.position.set(0.72, H.roof + 0.06, 1.30 - 0.32); hull.add(drvLid);
    meshes(drvLid, PT.lidD, "lid");
    const seed = (ctx.seed | 0) + 7;
    const cmd = new THREE.Mesh(PT.cmd[seed % SKIN.length], MT.crew); cmd.name = "commander"; cmd.position.set(-0.42, 0.85, -0.62); turret.add(cmd);
    const drv = new THREE.Mesh(PT.drv[(seed * 3 + 1) % SKIN.length], MT.crew); drv.name = "driver"; drv.position.set(0.72, H.roof, 1.30); hull.add(drv);
    matSlots.push([cmd, "crew"], [drv, "crew"]);
    // the flag (only when the side has a nation)
    const flagMesh = new THREE.Mesh(flagGeo(), MT.dark); flagMesh.name = "flag"; flagMesh.visible = false; hull.add(flagMesh);
    // running gear: five instanced meshes on the root (they stay on the ground)
    const ims = {};
    let nShoe = 0;
    {
      // shoe count from the belt at rest
      const b = new Belt(NW + 2 + NR); let c = 0;
      b.cz[c] = GEAR.idler.z; b.cy[c] = GEAR.idler.y; b.cr[c] = GEAR.idler.r + OFF; c++;
      for (let i = 0; i < NW; i++) { b.cz[c] = GEAR.wheelZ[i]; b.cy[c] = GEAR.axleY; b.cr[c] = GEAR.r + OFF; c++; }
      b.cz[c] = GEAR.drive.z; b.cy[c] = GEAR.drive.y; b.cr[c] = GEAR.drive.r + OFF; c++;
      for (let i = 0; i < NR; i++) { b.cz[c] = GEAR.rollerZ[i]; b.cy[c] = 0.95; b.cr[c] = GEAR.rollerR + OFF; c++; }
      b.solve(); nShoe = Math.round(b.total / GEAR.pitch);
    }
    [["wheel", NW * 2, "gear"], ["idler", 2, "gear"], ["roller", NR * 2, "gear"], ["sprocket", 2, "gear"], ["shoe", nShoe * 2, "shoe"]].forEach(function (d) {
      const im = new THREE.InstancedMesh(PT[d[0]], MT[d[2]], d[1]);
      im.name = "gear:" + d[0]; im.castShadow = true; im.receiveShadow = true; im.frustumCulled = true;
      root.add(im); ims[d[0]] = im; matSlots.push([im, d[2]]);
    });
    const P = { body: body, turret: turret, gun: gun, tube: tube, muzzle: muzzle, tow: tow, towBox: towBox, struts: struts, caps: caps,
      civ: civ, cmdLid: cmdLid, drvLid: drvLid, cmd: cmd, drv: drv, ims: ims, hullMesh: hullMesh, nShoe: nShoe, flagMesh: flagMesh, matSlots: matSlots };
    const rig = new Rig(root, P, seed);
    hideProp(root.userData, "rig", rig);
    hideProp(root.userData, "turret", turret);
    root.userData.armorType = "ifv";
    // the nation and the ground: the runtime calls rig.mark(nation, ground) after build
    rig.settle();
    return { group: root, rig: rig, footW: 3.28, footL: 6.55, height: 2.98 };
  }
  // for node checks and the console
  CBZ.bradley = { dims: H, gear: GEAR, turret: TUR, Belt: Belt, template: function (s) { return template(s || "desert"); } };
})();
