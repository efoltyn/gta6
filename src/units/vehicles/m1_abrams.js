/* ============================================================
   units/vehicles/m1_abrams.js — M1A2 SEP v2 ABRAMS main battle tank (USA).

   Drawn here from the real vehicle, not borrowed (wave A borrowed
   city/mil_armor.js buildMBT; that builder is still the fallback when this one
   cannot run, and its muzzle blast is reused).

   THE REAL NUMBERS this is built to (metres; nose is local +Z, left is +X):
     hull 7.93 long (9.77 gun forward), 3.66 wide over the skirts, 2.44 to the
     turret roof, 0.48 ground clearance. Seven dual road wheels a side
     (635 mm), idler forward, 11-tooth double sprocket aft, two support
     rollers, T-158 double-pin track (635 mm wide, 193 mm pitch) with rubber
     pads. Upper glacis ~82 deg from vertical, flat slab turret with the
     arrow-head cheek armour, long bustle with ammunition blow-off panels and
     a bustle rack, gunner's primary sight (right front), commander's
     independent thermal viewer (left front), commander's cupola with the
     CROWS remote .50 (right), loader's hatch and M240 (left), wind sensor,
     two whip antennas, M250 smoke dischargers, 120 mm M256 L/44 with thermal
     sleeve, bore evacuator and muzzle reference sensor, coax M240.

   THE RIG (rig.update(dt, v, w, steer) every frame from the runtime):
     · the hull is a sprung `body` on unsprung running gear: squat on throttle,
       dive on braking, lean out of turns, rock against the 120 mm's recoil;
     · every road wheel rides its own torsion-bar arm over the real ground
       (CBZ.floorAt), 0.30 m bump / 0.10 m rebound, and spins;
     · each belt is solved as a real belt round its pulleys (outer tangents
       between idler, road wheels, sprocket and support rollers, the top run
       sagging), ~70 instanced links a side that CRAWL at that track's own
       belt speed (skid steer: the inner belt slows / counter-rotates);
     · turret traverse 40 deg/s, gun -9..+20 deg at 25 deg/s, stabilised
       against the hull's pitch and roll, lifted clear of the engine deck
       over the rear; the CROWS lays on its own; 0.33 m recoil and run-out;
     · the commander rides head-out when nothing is being aimed at or fired
       on and drops inside, hatch shut, the moment it is;
     · tan dust off both belts by speed, turbine exhaust shimmer, a ground
       dust ring under the 120 mm's blast;
     · knocked out: the hull chars, the gun droops, hatches stand open; a
       catastrophic kill vents through the bustle blow-off panels (and in one
       case of five the hull ammunition goes and the turret is thrown).

   INTERFACE TO THE RUNTIME (src/battle/vehicles.js), all optional calls:
     rig.mark(nation, ground)  paint scheme by ground (desert tan / NATO
                               three-tone / winter) + the nation's flag
                               (city/flags.js) on the turret sides; called
                               by the runtime right after build
     rig.damage(vs, res)       damage states before death (burning, gun
                               hit); called on every hit that lands
     def.tactics               what the AI should do with an MBT (§ TACTICS),
                               exposed as veh.tactics
   The wreck look is self-driven (the runtime's darkening of the materials is
   the signal), so it works today without any runtime call.

   Units: metres, m/s, kg, armour in mm of rolled homogeneous armour
   equivalent per face. Nose is local +Z.
============================================================ */
(function () {
  "use strict";
  const W = typeof window !== "undefined" ? window : globalThis;
  const CBZ = W.CBZ;
  if (!CBZ || !CBZ.unitKit) return;
  const PI = Math.PI, TAU = PI * 2;
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function wrap(a) { while (a > PI) a -= TAU; while (a < -PI) a += TAU; return a; }

  // ================================================================ DIMENSIONS
  const DM = {
    wheelR: 0.3175, wheelY: 0.41, linkC: 0.035,            // link centre line sits linkC outside a wheel's rim
    wheelZ: [2.12, 1.38, 0.64, -0.10, -0.84, -1.58, -2.32],
    trackX: 1.425, trackW: 0.635, pitch: 0.193,
    idler: { z: 3.02, y: 0.60, r: 0.30 },
    sprocket: { z: -3.30, y: 0.68, r: 0.33 },
    rollers: [{ z: -1.05, y: 0.93, r: 0.11 }, { z: 1.05, y: 0.92, r: 0.11 }],   // rear, front (loop order)
    belly: 0.48, spB: 1.20, deck: 1.58, nose: 3.80, rear: -3.92,
    skirtX: 1.83,
    turY: 1.49, turZ: 0.45,                                   // turret ring on the hull
    gunY: 0.46, gunZ: 1.72,                                   // trunnions, turret-local
    muzzle: 3.97, recoil: 0.33,
    cmdr: [-0.70, 0.82, -0.05], loader: [0.72, 0.82, -0.12], crows: [-1.24, 0.82, 0.36],
  };
  const TUR = { rate: 0.70, elevRate: 0.44, elevMin: -0.157, elevMax: 0.349, deckMin: -0.03 };

  // ================================================================ COLOUR
  function lin(hex) {
    const r = ((hex >> 16) & 255) / 255, g = ((hex >> 8) & 255) / 255, b = (hex & 255) / 255;
    const f = function (c) { return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    return [f(r), f(g), f(b)];
  }
  // multipliers on the PAINT (texture carries the colour)
  const PW = [1, 1, 1], PD = [0.62, 0.62, 0.62], PDD = [0.36, 0.36, 0.36], PRUB = [0.075, 0.072, 0.07], PSEAM = [0.42, 0.41, 0.4];
  // real colours on the PLAIN material
  const C = {
    steel: lin(0x4a4843), steelD: lin(0x2b2a28), rubber: lin(0x161616), black: lin(0x0b0b0b),
    canvas: lin(0x6f6a4c), canvasT: lin(0x8f7d5c), od: lin(0x4b4f36), coyote: lin(0x8a7458),
    skin: lin(0xb88a6a), cvc: lin(0x6e6650), ocp: lin(0x8c8466), goggle: lin(0x1c1c1c),
    amber: lin(0xd28a2a), red: lin(0x8a1a12), lamp: lin(0xe8e4d0), brass: lin(0x8a7a4a), jerry: lin(0x4d5236),
  };

  // ================================================================ BUFFER
  // flat-shaded, non-indexed, box-projected UVs (the camouflage texture), a
  // per-vertex colour (part tint x a baked ambient occlusion)
  function Buf(T, ao, warp) { this.T = T; this.p = []; this.n = []; this.u = []; this.c = []; this.ao = ao || null; this.s = 1 / 3.0; this.warp = warp || null; }
  Buf.prototype.v = function (x, y, z, nx, ny, nz, fx, fy, fz, col) {
    if (this.warp) y = this.warp(y);
    this.p.push(x, y, z); this.n.push(nx, ny, nz);
    const ax = Math.abs(fx), ay = Math.abs(fy), az = Math.abs(fz), s = this.s;
    if (ax >= ay && ax >= az) this.u.push(z * s * (fx > 0 ? -1 : 1), y * s);
    else if (ay >= az) this.u.push(x * s, z * s);
    else this.u.push(x * s * (fz > 0 ? 1 : -1), y * s);
    let k = 1;
    if (this.ao) k = this.ao(x, y, z, fx, fy, fz);
    if (typeof col === "function") col = col(x, y, z, fx, fy, fz);
    this.c.push(col[0] * k, col[1] * k, col[2] * k);
  };
  // a triangle, wound so its normal agrees with `dir` (the way out)
  Buf.prototype.tri = function (a, b, c, col, dir) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz);
    if (l < 1e-10) return;
    nx /= l; ny /= l; nz /= l;
    if (dir && nx * dir[0] + ny * dir[1] + nz * dir[2] < 0) { const t = b; b = c; c = t; nx = -nx; ny = -ny; nz = -nz; }
    this.v(a[0], a[1], a[2], nx, ny, nz, nx, ny, nz, col);
    this.v(b[0], b[1], b[2], nx, ny, nz, nx, ny, nz, col);
    this.v(c[0], c[1], c[2], nx, ny, nz, nx, ny, nz, col);
  };
  Buf.prototype.quad = function (a, b, c, d, col, dir) { this.tri(a, b, c, col, dir); this.tri(a, c, d, col, dir); };
  // a THREE geometry through a matrix; smooth normals kept unless flat
  Buf.prototype.geo = function (g, m, col, flat) {
    const T = this.T, pos = g.attributes.position, nor = g.attributes.normal, idx = g.index;
    const nm = new T.Matrix3().getNormalMatrix(m);
    const P = [new T.Vector3(), new T.Vector3(), new T.Vector3()], N = [new T.Vector3(), new T.Vector3(), new T.Vector3()];
    const e1 = new T.Vector3(), e2 = new T.Vector3(), fn = new T.Vector3();
    const cnt = idx ? idx.count : pos.count;
    for (let i = 0; i + 2 < cnt; i += 3) {
      for (let k = 0; k < 3; k++) {
        const vi = idx ? idx.getX(i + k) : i + k;
        P[k].fromBufferAttribute(pos, vi).applyMatrix4(m);
        if (nor) N[k].fromBufferAttribute(nor, vi).applyMatrix3(nm).normalize();
      }
      e1.subVectors(P[1], P[0]); e2.subVectors(P[2], P[0]); fn.crossVectors(e1, e2);
      if (fn.lengthSq() < 1e-14) continue;
      fn.normalize();
      for (let k = 0; k < 3; k++) {
        const n = flat || !nor ? fn : N[k];
        this.v(P[k].x, P[k].y, P[k].z, n.x, n.y, n.z, fn.x, fn.y, fn.z, col);
      }
    }
    g.dispose();
  };
  Buf.prototype.box = function (x, y, z, w, h, d, col, rx, ry, rz) {
    this.geo(new this.T.BoxGeometry(w, h, d), M4(this.T, x, y, z, rx, ry, rz), col, true);
  };
  // axis: "x" | "y" | "z"; r1 is the +axis end
  Buf.prototype.cyl = function (x, y, z, r1, r2, h, axis, col, seg, flat, rx, ry, rz) {
    const T = this.T, g = new T.CylinderGeometry(r1, r2, h, seg || 12, 1, false);
    const m = M4(T, x, y, z, rx, ry, rz);
    if (axis === "x") m.multiply(new T.Matrix4().makeRotationZ(-PI / 2));
    else if (axis === "z") m.multiply(new T.Matrix4().makeRotationX(PI / 2));
    this.geo(g, m, col, flat);
  };
  // side profile [[z,y]...] pushed across x0..x1
  Buf.prototype.prismX = function (prof, x0, x1, col) {
    const n = prof.length;
    let A = 0;
    for (let i = 0; i < n; i++) { const a = prof[i], b = prof[(i + 1) % n]; A += a[0] * b[1] - b[0] * a[1]; }
    const sg = A > 0 ? 1 : -1;
    for (let i = 0; i < n; i++) {
      const a = prof[i], b = prof[(i + 1) % n];
      const dz = b[0] - a[0], dy = b[1] - a[1];
      const dir = [0, -dz * sg, dy * sg];
      this.quad([x0, a[1], a[0]], [x1, a[1], a[0]], [x1, b[1], b[0]], [x0, b[1], b[0]], col, dir);
    }
    const T = this.T, cont = prof.map(function (p) { return new T.Vector2(p[0], p[1]); });
    const tris = T.ShapeUtils.triangulateShape(cont, []);
    for (let i = 0; i < tris.length; i++) {
      const t = tris[i], a = prof[t[0]], b = prof[t[1]], c = prof[t[2]];
      this.tri([x0, a[1], a[0]], [x0, b[1], b[0]], [x0, c[1], c[0]], col, [-1, 0, 0]);
      this.tri([x1, a[1], a[0]], [x1, b[1], b[0]], [x1, c[1], c[0]], col, [1, 0, 0]);
    }
  };
  // rings of 3D points (same count), quads between, fan caps
  Buf.prototype.loft = function (rings, col, capA, capB) {
    const cen = rings.map(function (r) {
      let x = 0, y = 0, z = 0;
      for (let i = 0; i < r.length; i++) { x += r[i][0]; y += r[i][1]; z += r[i][2]; }
      return [x / r.length, y / r.length, z / r.length];
    });
    for (let i = 0; i + 1 < rings.length; i++) {
      const A = rings[i], B = rings[i + 1], n = A.length;
      const mc = [(cen[i][0] + cen[i + 1][0]) / 2, (cen[i][1] + cen[i + 1][1]) / 2, (cen[i][2] + cen[i + 1][2]) / 2];
      for (let j = 0; j < n; j++) {
        const k = (j + 1) % n;
        const qc = [(A[j][0] + A[k][0] + B[j][0] + B[k][0]) / 4, (A[j][1] + A[k][1] + B[j][1] + B[k][1]) / 4, (A[j][2] + A[k][2] + B[j][2] + B[k][2]) / 4];
        const dir = [qc[0] - mc[0], qc[1] - mc[1], qc[2] - mc[2]];
        this.quad(A[j], A[k], B[k], B[j], col, dir);
      }
    }
    const self = this;
    function cap(r, c, away) {
      const dir = [c[0] - away[0], c[1] - away[1], c[2] - away[2]];
      for (let j = 0; j < r.length; j++) self.tri(c, r[j], r[(j + 1) % r.length], col, dir);
    }
    const L = rings.length - 1;
    if (capA !== false) cap(rings[0], cen[0], cen[1]);
    if (capB !== false) cap(rings[L], cen[L], cen[L - 1]);
  };
  Buf.prototype.toGeo = function () {
    const T = this.T, g = new T.BufferGeometry();
    g.setAttribute("position", new T.Float32BufferAttribute(this.p, 3));
    g.setAttribute("normal", new T.Float32BufferAttribute(this.n, 3));
    g.setAttribute("uv", new T.Float32BufferAttribute(this.u, 2));
    g.setAttribute("color", new T.Float32BufferAttribute(this.c, 3));
    g.computeBoundingSphere();
    this.p = this.n = this.u = this.c = null;
    return g;
  };
  Buf.prototype.empty = function () { return !this.p || this.p.length === 0; };
  function M4(T, x, y, z, rx, ry, rz, sx, sy, sz) {
    const m = new T.Matrix4();
    m.compose(new T.Vector3(x || 0, y || 0, z || 0), new T.Quaternion().setFromEuler(new T.Euler(rx || 0, ry || 0, rz || 0, "XYZ")),
      new T.Vector3(sx == null ? 1 : sx, sy == null ? 1 : sy, sz == null ? 1 : sz));
    return m;
  }

  // ================================================================ PAINT
  /* Camouflage canvases, tileable (every blot is drawn at its wrapped twins),
     in sRGB with the renderer's sRGB output. A worn, dusty finish: blotchy
     fade, fine speckle, faint rain streaks. */
  function rngOf(seed) { let s = seed >>> 0; return function () { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  const SCHEMES = {
    tan: { base: "#b49c76", mottle: ["#c2ab86", "#a28a66", "#b9a27c"], blots: null, streak: "#8d7a5c", spec: 0.10 },
    green3: { base: "#4c5639", mottle: ["#56603f", "#444d33"], blots: [["#5b4b37", 0.33], ["#1f211d", 0.17]], streak: "#3a3f2c", spec: 0.10 },
    winter: { base: "#cfd0c8", mottle: ["#dcdcd4", "#bfc0b6"], blots: [["#525a3e", 0.26]], streak: "#9c9c92", spec: 0.10 },
    burnt: { base: "#2b2724", mottle: ["#3a332d", "#1c1a19", "#4a443f"], blots: [["#5e3421", 0.30, 0.22], ["#6f6a63", 0.16, 0.18]], streak: "#5a3420", spec: 0.0 },
  };
  function paintCanvas(sch, seed) {
    if (typeof document === "undefined" || !document.createElement) return null;
    const S = 512, cv = document.createElement("canvas");
    cv.width = cv.height = S;
    const g = cv.getContext("2d");
    if (!g) return null;
    const R = rngOf(seed);
    g.fillStyle = sch.base; g.fillRect(0, 0, S, S);
    function blot(x, y, r, col, a, sx, sy) {
      g.globalAlpha = a; g.fillStyle = col;
      for (let ox = -S; ox <= S; ox += S) for (let oy = -S; oy <= S; oy += S) {
        if (x + ox + r * sx < 0 || x + ox - r * sx > S || y + oy + r * sy < 0 || y + oy - r * sy > S) continue;
        g.beginPath(); g.ellipse(x + ox, y + oy, r * sx, r * sy, 0, 0, TAU); g.fill();
      }
    }
    // the camouflage pattern: big hard-edged blots built from overlapping lobes
    if (sch.blots) sch.blots.forEach(function (b) {
      // long, ragged patches (NATO pattern scale: a patch is ~1 m on a 3 m tile)
      const n = Math.round(5 * b[1] / 0.2);
      for (let i = 0; i < n; i++) {
        let cx = R() * S, cy = R() * S;
        const ang = R() * PI, lobes = 7 + (R() * 6 | 0);
        for (let l = 0; l < lobes; l++) {
          cx += Math.cos(ang) * 22 + (R() - 0.5) * 30; cy += Math.sin(ang) * 22 + (R() - 0.5) * 30;
          blot(cx, cy, 22 + R() * 30, b[0], b[2] == null ? 1 : b[2],1 + R() * 0.6, 0.6 + R() * 0.4);
        }
      }
    });
    // the fade: soft mottling
    for (let i = 0; i < 260; i++) blot(R() * S, R() * S, 10 + R() * 60, sch.mottle[i % sch.mottle.length], 0.08 + R() * 0.1, 1, 1);
    // streaks (V runs up the sides)
    g.globalAlpha = 0.07; g.fillStyle = sch.streak;
    for (let i = 0; i < 70; i++) { const x = R() * S, w = 1 + R() * 3, h = 40 + R() * 160, y = R() * S; g.fillRect(x, y, w, h); if (y + h > S) g.fillRect(x, y - S, w, h); }
    g.globalAlpha = 1;
    // speckle
    try {
      const im = g.getImageData(0, 0, S, S), d = im.data;
      for (let i = 0; i < d.length; i += 4) { const k = (R() - 0.5) * 22; d[i] = clamp(d[i] + k, 0, 255); d[i + 1] = clamp(d[i + 1] + k, 0, 255); d[i + 2] = clamp(d[i + 2] + k * 0.9, 0, 255); }
      g.putImageData(im, 0, 0);
    } catch (e) {}
    return cv;
  }
  const MATS = { paint: {}, plain: null, glass: null, track: null, flag: {} };
  function paintMat(T, key) {
    if (MATS.paint[key]) return MATS.paint[key];
    const sch = SCHEMES[key] || SCHEMES.tan;
    const cv = paintCanvas(sch, key.length * 7919 + 17);
    const o = { vertexColors: true, roughness: 0.82, metalness: 0.06 };
    if (cv) {
      const tx = new T.CanvasTexture(cv);
      tx.wrapS = tx.wrapT = T.RepeatWrapping;
      if (T.sRGBEncoding) tx.encoding = T.sRGBEncoding;
      tx.anisotropy = 4;
      o.map = tx;
    } else o.color = new T.Color().setRGB.apply(new T.Color(), lin(parseInt(sch.base.slice(1), 16)));
    const m = new T.MeshStandardMaterial(o);
    m.name = "abrams-paint-" + key; m._shared = true;
    return (MATS.paint[key] = m);
  }
  function plainMat(T) {
    if (!MATS.plain) { MATS.plain = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.86, metalness: 0.05 }); MATS.plain._shared = true; }
    return MATS.plain;
  }
  function trackMat(T) {
    if (!MATS.track) { MATS.track = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.74, metalness: 0.25 }); MATS.track._shared = true; }
    return MATS.track;
  }
  function glassMat(T) {
    if (!MATS.glass) {
      const c = lin(0x0f2228), e = lin(0x0a2a22);
      MATS.glass = new T.MeshStandardMaterial({ color: new T.Color(c[0], c[1], c[2]), roughness: 0.12, metalness: 0.7,
        emissive: new T.Color(e[0], e[1], e[2]), emissiveIntensity: 0.6 });
      MATS.glass._shared = true;
    }
    return MATS.glass;
  }
  function flagMat(T, nation) {
    if (MATS.flag[nation] !== undefined) return MATS.flag[nation];
    let m = null;
    try {
      const tex = CBZ.flags && CBZ.flags.texture ? CBZ.flags.texture(nation) : null;
      if (tex) {
        m = new T.MeshStandardMaterial({ map: tex, roughness: 0.75, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
        m._shared = true;
      }
    } catch (e) { m = null; }
    return (MATS.flag[nation] = m);
  }

  // ================================================================ THE HULL
  function aoHull(x, y, z, nx, ny) {
    let k = 0.58 + 0.42 * clamp((y - 0.45) / 1.0, 0, 1);
    if (ny < -0.5) k *= 0.55;
    return k;
  }
  // the hull is authored with its deck at 1.58 and pressed down above the
  // track line to the real 1.49 (one place to tune the hull's height)
  function hullWarp(y) { return y <= 1.0 ? y : 1.0 + (y - 1.0) * 0.845; }
  function buildHull(T) {
    const K = new Buf(T, aoHull, hullWarp), P = new Buf(T, null, hullWarp), G = new Buf(T, null, hullWarp);
    const gy = function (z) { return DM.deck - (z - 1.75) * (DM.deck - 1.30) / (DM.nose - 1.75); };   // the glacis line
    // ---- the tub between the tracks: lower nose plate, belly, rear plate
    K.prismX([[DM.nose, 1.30], [3.42, 0.58], [3.20, DM.belly], [-3.45, DM.belly], [-3.80, 0.66], [DM.rear, 1.22]], -1.05, 1.05, PW);
    // ---- the upper hull, full width over the tracks: glacis, deck, sponsons
    K.prismX([[DM.nose, 1.30], [1.75, DM.deck], [-1.40, DM.deck], [-3.15, 1.545], [DM.rear, 1.50], [DM.rear, DM.spB], [3.66, DM.spB], [DM.nose, 1.21]], -1.76, 1.76, PW);
    // lower front plate weld seam + the glacis/side chamfer lines
    K.box(0, 1.29, DM.nose - 0.01, 2.10, 0.018, 0.03, PSEAM);
    [-1, 1].forEach(function (s) {
      // ---- the SKIRTS: three heavy armoured panels forward with a raked
      // leading edge, thin panels aft, seams and bolt rows
      const xo = s * DM.skirtX;
      K.prismX([[3.66, 1.50], [3.66, 1.10], [3.08, 0.52], [1.02, 0.50], [1.02, 1.50]], s > 0 ? xo - 0.10 : xo, s > 0 ? xo : xo + 0.10, PW);
      K.prismX([[1.02, 1.50], [1.02, 0.51], [-3.62, 0.51], [-3.86, 0.76], [-3.86, 1.50]], s > 0 ? xo - 0.075 : xo + 0.035, s > 0 ? xo - 0.035 : xo + 0.075, PW);
      [2.92, 1.98, 1.02].forEach(function (z) { K.box(xo + s * 0.003, 0.99, z, 0.012, 0.94, 0.022, PSEAM); });
      for (let z = 0.06; z > -3.7; z -= 0.94) K.box(xo - s * 0.033, 1.0, z, 0.012, 0.96, 0.02, PSEAM);
      for (let z = 3.45; z > -3.8; z -= 0.235) {
        const xb = z > 1.02 ? xo + s * 0.006 : xo - s * 0.03;
        K.box(xb, 1.43, z, 0.02, 0.035, 0.035, PD);
      }
      K.box(xo - s * 0.05, 0.525, -1.3, 0.11, 0.025, 4.6, PD);   // the lower lip of the rear panels
      // the hull side above the skirt line, under the sponson lip
      K.box(s * 1.765, 1.53, -0.2, 0.012, 0.06, 7.4, PSEAM);
      // ---- front fender, mud flap, the headlight cluster with its brush guard
      P.box(s * 1.45, 1.09, DM.nose - 0.02, 0.62, 0.22, 0.025, C.rubber);
      const hx = s * 1.42, hz = DM.nose - 0.18, hy = gy(hz);
      K.box(hx, hy + 0.09, hz, 0.24, 0.16, 0.16, PD);
      G.box(hx - s * 0.05, hy + 0.1, hz + 0.085, 0.08, 0.07, 0.01, [1, 1, 1]);
      P.box(hx + s * 0.05, hy + 0.1, hz + 0.082, 0.06, 0.05, 0.01, C.amber);
      K.box(hx, hy + 0.21, hz + 0.12, 0.30, 0.025, 0.025, PD);
      K.box(hx - 0.14, hy + 0.12, hz + 0.12, 0.025, 0.2, 0.025, PD);
      K.box(hx + 0.14, hy + 0.12, hz + 0.12, 0.025, 0.2, 0.025, PD);
      // tow eyes front and rear
      K.box(s * 0.62, 0.86, 3.47, 0.08, 0.18, 0.16, PD, -0.5);
      K.box(s * 0.70, 0.86, DM.rear - 0.06, 0.09, 0.20, 0.14, PD);
      // rear fender flap + tail lights (blackout + stop)
      P.box(s * 1.45, 1.30, DM.rear - 0.02, 0.60, 0.20, 0.02, C.rubber);
      K.box(s * 1.52, 1.40, DM.rear - 0.04, 0.22, 0.13, 0.06, PD);
      P.box(s * 1.47, 1.40, DM.rear - 0.075, 0.07, 0.07, 0.01, C.red);
      P.box(s * 1.57, 1.40, DM.rear - 0.075, 0.07, 0.07, 0.01, C.amber);
      // engine deck: grille doors with louvres, hinges, fuel caps
      const gx = s * 0.80;
      K.box(gx, 1.555, -2.55, 1.02, 0.03, 1.60, PDD);
      for (let i = 0; i < 12; i++) K.box(gx, 1.575, -3.30 + i * 0.135, 1.04, 0.022, 0.05, PD, 0.35);
      K.box(gx, 1.58, -1.70, 1.08, 0.02, 0.05, PSEAM);
      K.cyl(s * 1.52, 1.585, -3.55, 0.07, 0.07, 0.035, "y", PD, 10);
      K.cyl(s * 1.52, 1.585, 1.35, 0.07, 0.07, 0.035, "y", PD, 10);
      // grab rails along the deck edge
      for (let z = -1.0; z > -3.6; z -= 0.9) K.box(s * 1.70, 1.62, z, 0.025, 0.025, 0.3, PD);
      // ---- running gear that does not move: the support rollers' brackets,
      // the final drive housing, the idler arm
      DM.rollers.forEach(function (r) { K.cyl(s * (DM.trackX - 0.22), r.y, r.z, 0.06, 0.06, 0.30, "x", PD, 8); });
      K.cyl(s * 1.08, DM.sprocket.y, DM.sprocket.z, 0.22, 0.26, 0.16, "x", PD, 14);
      K.box(s * 1.10, DM.idler.y + 0.05, DM.idler.z - 0.25, 0.14, 0.12, 0.6, PD, 0.15);
      // road arms (trailing torsion-bar arms) from the hull to every wheel
      DM.wheelZ.forEach(function (z) { K.box(s * 1.10, DM.wheelY + 0.11, z + 0.20, 0.10, 0.10, 0.44, PDD, -0.35); });
      // rollers themselves (static): rubber tyred
      DM.rollers.forEach(function (r) {
        K.cyl(s * DM.trackX, r.y, r.z, r.r, r.r, 0.42, "x", PRUB, 14);
        K.cyl(s * (DM.trackX + 0.215), r.y, r.z, 0.06, 0.07, 0.03, "x", PD, 10);
      });
    });
    // ---- the driver: hatch on the glacis, three periscopes ahead of it
    const dz = 2.92, dy = gy(dz), sl = Math.atan((DM.deck - 1.30) / (DM.nose - 1.75));
    K.cyl(0, dy + 0.03, dz, 0.33, 0.35, 0.06, "y", PW, 20, true, sl);
    K.box(0, dy + 0.07, dz - 0.25, 0.22, 0.04, 0.10, PD, sl);
    for (let i = -1; i <= 1; i++) {
      const pz = 3.30 + Math.abs(i) * -0.05, py = gy(pz), px = i * 0.24;
      K.box(px, py + 0.06, pz, 0.20, 0.11, 0.13, PD, sl, -i * 0.38);
      G.box(px + Math.sin(i * 0.38) * -0.065, py + 0.075, pz + Math.cos(i * 0.38) * 0.066, 0.15, 0.06, 0.012, [1, 1, 1], -0.35, -i * 0.38);
    }
    // glacis panel seams and lifting eyes
    K.box(0, gy(2.0) + 0.012, 2.0, 2.4, 0.012, 0.02, PSEAM, sl);
    [-1, 1].forEach(function (s) { K.box(s * 0.95, gy(3.45) + 0.06, 3.45, 0.05, 0.1, 0.12, PD, sl); });
    // ---- the rear plate: the turbine's big exhaust grille, the tow pintle
    K.box(0, 1.04, DM.rear - 0.01, 1.80, 0.70, 0.04, PDD);
    for (let i = 0; i < 10; i++) K.box(0, 0.74 + i * 0.066, DM.rear - 0.035, 1.76, 0.022, 0.05, PD, -0.55);
    K.box(0, 1.41, DM.rear - 0.04, 1.90, 0.04, 0.06, PD);
    K.box(0, 0.70, DM.rear - 0.08, 0.20, 0.14, 0.16, PD);
    K.cyl(0, 0.70, DM.rear - 0.18, 0.05, 0.05, 0.12, "y", PDD, 8);
    // the turret ring race under the turret
    P.cyl(0, DM.deck + 0.012, DM.turZ, 1.12, 1.14, 0.03, "y", C.steelD, 32);
    return { paint: K.toGeo(), plain: P.toGeo(), glass: G.toGeo() };
  }

  // ================================================================ THE TURRET
  function aoTur(x, y, z, nx, ny) {
    let k = 0.80 + 0.20 * clamp(y / 0.82, 0, 1);
    if (ny < -0.4) k *= 0.5;
    return k;
  }
  function ring(z, yb, hb, ym, hm, yt, ht) { return [[-hb, yb, z], [hb, yb, z], [hm, ym, z], [ht, yt, z], [-ht, yt, z], [-hm, ym, z]]; }
  function buildTurret(T) {
    const K = new Buf(T, aoTur), P = new Buf(T), G = new Buf(T);
    // ---- the body: flat slab sides, an undercut, the arrow-head front, the
    // long bustle hung over the engine deck
    K.loft([
      ring(1.76, 0.06, 0.60, 0.40, 0.62, 0.74, 0.56),
      ring(1.12, 0.00, 1.62, 0.40, 1.68, 0.82, 1.56),
      ring(0.40, 0.00, 1.78, 0.38, 1.84, 0.82, 1.71),
      ring(-1.30, 0.00, 1.78, 0.40, 1.84, 0.82, 1.71),
      ring(-1.36, 0.20, 1.74, 0.42, 1.84, 0.82, 1.71),
      ring(-2.95, 0.22, 1.64, 0.42, 1.72, 0.80, 1.60),
      ring(-3.12, 0.30, 1.52, 0.44, 1.58, 0.74, 1.48),
    ], PW, true, true);
    // the special-armour cavity covers on the cheek roofs, bolted
    [-1, 1].forEach(function (s) {
      K.loft([
        [[s * 0.66, 0.822, 1.62], [s * 1.52, 0.822, 1.15], [s * 1.62, 0.822, 0.62], [s * 0.66, 0.822, 0.62]],
        [[s * 0.68, 0.84, 1.58], [s * 1.50, 0.84, 1.14], [s * 1.60, 0.84, 0.64], [s * 0.68, 0.84, 0.64]],
      ], PD, false, true);
      for (let i = 0; i < 6; i++) K.box(s * (0.75 + i * 0.15), 0.85, 0.70, 0.03, 0.02, 0.03, PDD);
      // the side seam where the armour package meets the turret wall
      K.box(s * 1.80, 0.40, 0.40, 0.03, 0.70, 0.02, PSEAM, 0, 0, s * 0.03);
      K.box(s * 1.80, 0.40, -1.30, 0.03, 0.70, 0.02, PSEAM, 0, 0, s * 0.03);
      // M250 smoke dischargers: six tubes in two rows on each front corner
      for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) {
        const tx = s * (1.62 + c * 0.05), ty = 0.62 + r * 0.11, tz = 1.02 - c * 0.12;
        K.cyl(tx, ty, tz, 0.045, 0.05, 0.26, "z", PD, 10, false, -0.35, s * 0.45, 0);
        P.cyl(tx + s * 0.055, ty + 0.045, tz + 0.11, 0.035, 0.035, 0.01, "z", C.black, 8, false, -0.35, s * 0.45, 0);
      }
      K.box(s * 1.66, 0.55, 0.92, 0.22, 0.05, 0.42, PD, 0, s * 0.45);
      // lifting eyes, grab rails on the roof edge
      K.box(s * 1.45, 0.88, 1.20, 0.05, 0.10, 0.12, PD);
      K.box(s * 1.45, 0.88, -2.70, 0.05, 0.10, 0.12, PD);
      K.box(s * 1.66, 0.60, -0.70, 0.03, 0.03, 0.8, PD);
      // ammunition blow-off panels in the bustle roof, raised, edged, bolted
      K.box(s * 0.78, 0.81, -2.10, 1.10, 0.025, 1.12, PW);
      K.box(s * 0.78, 0.826, -1.55, 1.12, 0.012, 0.025, PSEAM);
      K.box(s * 0.78, 0.826, -2.66, 1.12, 0.012, 0.025, PSEAM);
      K.box(s * 0.22, 0.826, -2.10, 0.025, 0.012, 1.12, PSEAM);
      K.box(s * 1.34, 0.826, -2.10, 0.025, 0.012, 1.12, PSEAM);
      // ---- the BUSTLE RACK: posts and two rails round the sides and back
      const bx = s * 1.98;
      for (let z = -1.15; z > -3.5; z -= 0.40) K.box(bx, 0.48, z, 0.035, 0.46, 0.035, PD);
      K.box(bx, 0.70, -2.30, 0.035, 0.035, 2.30, PD);
      K.box(bx, 0.40, -2.30, 0.035, 0.035, 2.30, PD);
      K.box(s * 1.78, 0.27, -2.30, 0.40, 0.025, 2.30, PDD);
      K.box(s * 1.8, 0.70, -1.12, 0.36, 0.035, 0.035, PD);
      // stowage in the rack: rolled bags, rucks, ammunition cans, a water can
      P.cyl(s * 1.80, 0.45, -1.6, 0.17, 0.17, 0.75, "z", C.canvas, 12);
      P.cyl(s * 1.80, 0.45, -2.4, 0.15, 0.16, 0.6, "z", C.od, 12);
      P.box(s * 1.82, 0.42, -3.15, 0.30, 0.28, 0.26, C.coyote, 0, 0.1);
      P.box(s * 1.78, 0.37, -1.18, 0.16, 0.18, 0.28, C.jerry);
    });
    // rear of the rack and its load
    for (let x = -1.6; x <= 1.61; x += 0.4) K.box(x, 0.48, -3.45, 0.035, 0.46, 0.035, PD);
    K.box(0, 0.70, -3.45, 3.96, 0.035, 0.035, PD);
    K.box(0, 0.40, -3.45, 3.96, 0.035, 0.035, PD);
    K.box(0, 0.27, -3.30, 3.4, 0.025, 0.30, PDD);
    P.cyl(-0.6, 0.45, -3.30, 0.15, 0.15, 1.1, "x", C.canvasT, 12);
    P.box(0.55, 0.43, -3.30, 0.70, 0.30, 0.26, C.od);
    P.box(1.2, 0.40, -3.29, 0.30, 0.24, 0.18, C.jerry);
    // ---- gunner's primary sight: the armoured doghouse, right front
    K.loft([
      [[-1.20, 0.82, 1.28], [-0.70, 0.82, 1.28], [-0.70, 0.82, 0.48], [-1.20, 0.82, 0.48]],
      [[-1.19, 1.22, 1.16], [-0.71, 1.22, 1.16], [-0.71, 1.22, 0.50], [-1.19, 1.22, 0.50]],
    ], PW, false, true);
    G.box(-0.95, 1.05, 1.235, 0.36, 0.22, 0.02, [1, 1, 1], 0.29);
    K.box(-0.95, 1.18, 1.22, 0.48, 0.03, 0.10, PD, 0.29);      // the ballistic doors (open)
    K.box(-0.95, 1.235, 0.84, 0.36, 0.02, 0.5, PSEAM);
    // ---- CITV, left front: pedestal and rotating head with its window
    K.cyl(0.95, 0.94, 0.95, 0.19, 0.22, 0.24, "y", PW, 16);
    K.loft([
      [[0.74, 1.06, 1.15], [1.16, 1.06, 1.15], [1.16, 1.06, 0.76], [0.74, 1.06, 0.76]],
      [[0.75, 1.40, 1.08], [1.15, 1.40, 1.08], [1.15, 1.40, 0.77], [0.75, 1.40, 0.77]],
    ], PW, true, true);
    G.box(0.95, 1.24, 1.125, 0.28, 0.2, 0.02, [1, 1, 1], 0.2);
    K.box(0.95, 1.41, 0.92, 0.3, 0.02, 0.24, PSEAM);
    // ---- commander's cupola (ring + vision blocks); the hatch is its own part
    const cx = DM.cmdr[0], cz = DM.cmdr[2];
    K.cyl(cx, 0.88, cz, 0.47, 0.50, 0.12, "y", PW, 24);
    for (let i = 0; i < 6; i++) {
      const a = -1.2 + i * 0.48, vx = cx + Math.sin(a) * 0.47, vz = cz + Math.cos(a) * 0.47;
      G.box(vx, 0.90, vz, 0.12, 0.06, 0.012, [1, 1, 1], 0, a);
    }
    // ---- loader's hatch ring and the M240 on its skate mount
    K.cyl(DM.loader[0], 0.855, DM.loader[2], 0.40, 0.42, 0.06, "y", PW, 22);
    const lx = DM.loader[0] + 0.05, lz = DM.loader[2] + 0.42;
    K.cyl(lx, 0.98, lz, 0.025, 0.03, 0.30, "y", PD, 8);
    P.box(lx, 1.15, lz + 0.05, 0.07, 0.10, 0.55, C.steelD, -0.06);
    P.cyl(lx, 1.17, lz + 0.62, 0.015, 0.015, 0.62, "z", C.steelD, 8, false, -0.06);
    P.box(lx + 0.09, 1.10, lz - 0.02, 0.12, 0.10, 0.16, C.od);
    // ---- wind sensor mast, rear centre of the roof
    K.cyl(0, 1.08, -1.05, 0.025, 0.035, 0.52, "y", PD, 8);
    K.box(0, 1.34, -1.05, 0.36, 0.03, 0.03, PD);
    K.cyl(-0.17, 1.38, -1.05, 0.035, 0.035, 0.08, "y", PDD, 8);
    K.cyl(0.17, 1.38, -1.05, 0.035, 0.035, 0.08, "y", PDD, 8);
    // antenna bases (the whips are their own parts)
    [-1, 1].forEach(function (s) { K.cyl(s * 1.15, 0.88, -2.95, 0.06, 0.08, 0.12, "y", PD, 10); });
    // the coax M240 port, right of the main gun, and the gunner's aux sight
    P.cyl(-0.42, 0.40, 1.765, 0.035, 0.035, 0.03, "z", C.black, 10);
    G.box(0.42, 0.52, 1.765, 0.08, 0.08, 0.012, [1, 1, 1]);
    return { paint: K.toGeo(), plain: P.toGeo(), glass: G.toGeo() };
  }

  // ================================================================ THE GUN
  function buildMantlet(T) {
    const K = new Buf(T, function (x, y, z, nx, ny) { return ny < -0.4 ? 0.6 : 0.95; });
    K.loft([
      [[-0.48, -0.30, -0.05], [0.48, -0.30, -0.05], [0.48, 0.24, -0.05], [-0.48, 0.24, -0.05]],
      [[-0.48, -0.30, 0.20], [0.48, -0.30, 0.20], [0.48, 0.24, 0.20], [-0.48, 0.24, 0.20]],
      [[-0.40, -0.24, 0.34], [0.40, -0.24, 0.34], [0.40, 0.18, 0.34], [-0.40, 0.18, 0.34]],
    ], PW, true, true);
    K.cyl(0, 0, 0.36, 0.17, 0.19, 0.06, "z", PD, 18);
    K.box(0, 0.25, 0.10, 0.6, 0.02, 0.2, PSEAM);
    return K.toGeo();
  }
  function buildTube(T) {
    const K = new Buf(T, function () { return 1; });
    // the M256: thermal sleeve sections with clamping collars, bore evacuator,
    // the plain muzzle and its reference sensor
    const segs = [[0.34, 1.40, 0.125, 0.12], [1.45, 1.82, 0.118, 0.116], [2.52, 3.30, 0.106, 0.102], [3.36, 3.90, 0.100, 0.097]];
    segs.forEach(function (s) { K.cyl(0, 0, (s[0] + s[1]) / 2, s[3], s[2], s[1] - s[0], "z", PW, 18); });
    [1.425, 3.33].forEach(function (z) { K.cyl(0, 0, z, 0.135, 0.135, 0.05, "z", PD, 18); });
    K.cyl(0, 0, 2.17, 0.158, 0.158, 0.56, "z", PW, 20);
    K.cyl(0, 0, 1.855, 0.158, 0.118, 0.07, "z", PW, 20);
    K.cyl(0, 0, 2.485, 0.106, 0.158, 0.07, "z", PW, 20);
    K.cyl(0, 0, 3.93, 0.094, 0.097, 0.06, "z", PD, 18);
    K.cyl(0, 0, 3.962, 0.060, 0.060, 0.004, "z", [0.02, 0.02, 0.02], 16);
    K.box(0, 0.125, 3.80, 0.06, 0.055, 0.12, PD);
    K.box(0, 0.11, 3.70, 0.02, 0.03, 0.10, PD);
    return K.toGeo();
  }

  // ================================================================ SMALL PARTS
  function buildLid(T, r) {
    const K = new Buf(T, function () { return 1; });
    K.cyl(0, 0.025, r, r, r * 1.02, 0.05, "y", PW, 20, true);
    K.box(0, 0.06, r * 1.1, 0.24, 0.03, 0.04, PD);
    K.box(0, 0.035, 0.02, r * 1.4, 0.04, 0.06, PD);
    return K.toGeo();
  }
  function buildCrows(T) {
    // CROWS: base turntable (yaw), and the cradle (elevation) with the sight
    // box, the M2's receiver and barrel, the ammunition can
    const B = new Buf(T, function () { return 1; });
    B.cyl(0, 0.06, 0, 0.24, 0.27, 0.12, "y", PW, 16);
    B.box(0, 0.24, -0.02, 0.10, 0.26, 0.24, PW);
    const E = new Buf(T, function () { return 1; }), P = new Buf(T), G = new Buf(T);
    E.box(0.17, 0.02, 0.04, 0.14, 0.24, 0.34, PW);               // sight
    G.box(0.17, 0.02, 0.215, 0.10, 0.16, 0.01, [1, 1, 1]);
    E.box(-0.17, -0.02, -0.02, 0.18, 0.26, 0.30, PW);            // ammunition can
    P.box(0, 0.0, 0.05, 0.12, 0.15, 0.62, C.steelD);             // receiver
    P.cyl(0, 0.01, 0.92, 0.032, 0.032, 1.14, "z", C.steelD, 10); // barrel
    P.cyl(0, 0.01, 0.50, 0.04, 0.04, 0.22, "z", C.steelD, 10);   // barrel support
    P.cyl(0, 0.01, 1.50, 0.026, 0.028, 0.06, "z", C.black, 10);
    return { base: B.toGeo(), cradle: E.toGeo(), plain: P.toGeo(), glass: G.toGeo() };
  }
  // the commander, head out of his hatch: CVC helmet, goggles, boom mike,
  // body armour, forearms on the cupola rim
  function buildFigure(T) {
    const P = new Buf(T);
    const torso = [[0.0, -0.75], [0.20, -0.75], [0.22, -0.40], [0.235, -0.10], [0.225, 0.05], [0.17, 0.12], [0.06, 0.15], [0.0, 0.15]];
    const lg = new T.LatheGeometry(torso.map(function (p) { return new T.Vector2(p[0], p[1]); }), 14);
    P.geo(lg, M4(T, 0, 0, 0, 0, 0, 0, 1.12, 1, 0.82), C.ocp);
    P.box(0, -0.12, 0.17, 0.30, 0.22, 0.06, C.ocp);                 // armour plate carrier pouches
    P.box(0.14, -0.06, 0.15, 0.08, 0.10, 0.06, C.coyote);
    P.cyl(0, 0.19, 0.0, 0.055, 0.06, 0.08, "y", C.skin, 10);        // neck
    P.geo(new T.SphereGeometry(0.108, 14, 10), M4(T, 0, 0.30, 0.01, 0, 0, 0, 0.95, 1.08, 1.0), C.skin);
    P.geo(new T.SphereGeometry(0.128, 14, 10, 0, TAU, 0, PI * 0.55), M4(T, 0, 0.31, -0.01, -0.12, 0, 0, 1.02, 1.05, 1.1), C.cvc);
    [-1, 1].forEach(function (s) {
      P.cyl(s * 0.115, 0.29, -0.005, 0.045, 0.045, 0.04, "x", C.cvc, 12);       // ear cups
      P.cyl(s * 0.31, 0.02, 0.08, 0.055, 0.05, 0.26, "z", C.ocp, 10, false, 0.25, s * 0.35, 0);   // forearms on the rim
      P.geo(new T.SphereGeometry(0.075, 10, 8), M4(T, s * 0.24, 0.07, 0.0), C.ocp);       // shoulders
      P.geo(new T.SphereGeometry(0.04, 8, 6), M4(T, s * 0.36, -0.01, 0.22), C.goggle);   // gloves
    });
    P.box(0, 0.36, 0.105, 0.19, 0.045, 0.03, C.goggle);             // goggles up on the helmet
    P.cyl(-0.09, 0.24, 0.09, 0.008, 0.008, 0.14, "z", C.goggle, 6, false, 0, -0.5, 0);   // boom mike
    return P.toGeo();
  }
  function buildAntenna(T) {
    const P = new Buf(T);
    P.cyl(0, 0.08, 0, 0.03, 0.035, 0.16, "y", C.steelD, 8);
    P.cyl(0, 0.16 + 1.15, 0, 0.007, 0.012, 2.3, "y", C.black, 5);
    P.geo(new T.SphereGeometry(0.02, 6, 4), M4(T, 0, 2.47, 0), C.black);
    return P.toGeo();
  }

  // ================================================================ RUNNING GEAR
  function latheX(T, prof, seg) {
    const g = new T.LatheGeometry(prof.map(function (p) { return new T.Vector2(p[0], p[1]); }), seg);
    g.applyMatrix4(new T.Matrix4().makeRotationZ(-PI / 2));
    return g;
  }
  // one dual road wheel: two dished discs with bonded rubber tyres, the
  // guide-horn gap between them, hub and bolt ring
  function buildRoadWheel(T, R, rubber) {
    const K = new Buf(T, function () { return 1; });
    const k = R / 0.3175;
    const prof = [[0.0, -0.045], [0.09, -0.045], [0.12, -0.022], [0.235, -0.022], [0.245, -0.056], [0.300, -0.056], [0.3175, -0.042],
      [0.3175, 0.042], [0.300, 0.056], [0.245, 0.056], [0.235, 0.022], [0.12, 0.022], [0.09, 0.06], [0.0, 0.06]].map(function (p) { return [p[0] * k, p[1]]; });
    const col = function (x, y, z) { return Math.hypot(y, z) > 0.243 * k ? (rubber ? PRUB : PD) : PW; };
    [-0.135, 0.135].forEach(function (off) {
      const g = latheX(T, off < 0 ? prof.map(function (p) { return [p[0], -p[1]]; }) : prof, 18);
      K.geo(g, M4(T, off, 0, 0), col, false);
      for (let i = 0; i < 6; i++) {
        const a = i * TAU / 6;
        K.cyl(off + Math.sign(off) * 0.066, Math.cos(a) * 0.105 * k, Math.sin(a) * 0.105 * k, 0.014, 0.014, 0.025, "x", PDD, 6);
      }
    });
    K.cyl(0, 0, 0, 0.07, 0.07, 0.24, "x", PDD, 12);
    return K.toGeo();
  }
  // the double sprocket: two 11-tooth rings with lightening holes, the hub
  function buildSprocket(T) {
    const K = new Buf(T, function () { return 1; });
    const sh = new T.Shape(), n = 11, Ro = 0.385, Rr = 0.315;
    for (let i = 0; i < n; i++) {
      const a0 = i * TAU / n, w = TAU / n;
      const pts = [[a0, Rr], [a0 + w * 0.22, Rr], [a0 + w * 0.36, Ro], [a0 + w * 0.64, Ro], [a0 + w * 0.78, Rr]];
      pts.forEach(function (p, j) { const x = Math.cos(p[0]) * p[1], y = Math.sin(p[0]) * p[1]; if (i === 0 && j === 0) sh.moveTo(x, y); else sh.lineTo(x, y); });
    }
    sh.closePath();
    for (let i = 0; i < 6; i++) { const a = i * TAU / 6 + 0.26, h = new T.Path(); h.absarc(Math.cos(a) * 0.19, Math.sin(a) * 0.19, 0.045, 0, TAU, true); sh.holes.push(h); }
    [-0.17, 0.12].forEach(function (off) {
      const g = new T.ExtrudeGeometry(sh, { depth: 0.05, bevelEnabled: false, steps: 1, curveSegments: 6 });
      K.geo(g, M4(T, off, 0, 0, 0, PI / 2, 0), PD, true);
    });
    K.cyl(0, 0, 0, 0.13, 0.13, 0.40, "x", PW, 14);
    K.cyl(0.24, 0, 0, 0.10, 0.17, 0.10, "x", PW, 14);
    for (let i = 0; i < 10; i++) { const a = i * TAU / 10; K.cyl(0.29, Math.cos(a) * 0.075, Math.sin(a) * 0.075, 0.012, 0.012, 0.03, "x", PDD, 6); }
    return K.toGeo();
  }
  // one T-158 link: forged body, two rubber road pads outside, the centre
  // guide horn inside, end connectors over the pins. +Y is out of the loop.
  function buildLink(T) {
    const P = new Buf(T);
    P.box(0, 0, 0, 0.60, 0.05, 0.165, C.steel);
    [-1, 1].forEach(function (s) {
      P.box(s * 0.16, 0.042, 0.0, 0.245, 0.036, 0.135, C.rubber);
      P.box(s * 0.322, 0.0, 0.0, 0.045, 0.065, 0.20, C.steelD);            // end connector
    });
    P.loft([
      [[-0.045, -0.025, -0.05], [0.045, -0.025, -0.05], [0.045, -0.025, 0.05], [-0.045, -0.025, 0.05]],
      [[-0.03, -0.13, -0.03], [0.03, -0.13, -0.03], [0.03, -0.13, 0.03], [-0.03, -0.13, 0.03]],
    ], C.steel, false, true);
    return P.toGeo();
  }

  // ================================================================ THE BELT
  /* One side's track as a belt round its pulleys, in the (z, y) plane. The
     loop runs idler -> road wheels (under, front to rear) -> sprocket -> the
     two support rollers (over, rear to front), with every pulley inside it.
     Between consecutive pulleys the belt is their outer tangent; round each
     pulley it is the arc between the incoming and outgoing tangent points.
     The top run sags between its supports. */
  const NCIRC = 11;
  function Belt() {
    this.cz = new Float32Array(NCIRC); this.cy = new Float32Array(NCIRC); this.cr = new Float32Array(NCIRC);
    this.nz = new Float32Array(NCIRC); this.ny = new Float32Array(NCIRC);
    this.pz = new Float32Array(600); this.py = new Float32Array(600); this.sl = new Float32Array(600);
    this.n = 0; this.len = 0;
    const I = DM.idler, S = DM.sprocket;
    this.cz[0] = I.z; this.cy[0] = I.y; this.cr[0] = I.r + DM.linkC;
    for (let i = 0; i < 7; i++) { this.cz[1 + i] = DM.wheelZ[i]; this.cy[1 + i] = DM.wheelY; this.cr[1 + i] = DM.wheelR + DM.linkC; }
    this.cz[8] = S.z; this.cy[8] = S.y; this.cr[8] = S.r + 0.0;
    for (let i = 0; i < 2; i++) { const r = DM.rollers[i]; this.cz[9 + i] = r.z; this.cy[9 + i] = r.y; this.cr[9 + i] = r.r + DM.linkC; }
  }
  Belt.prototype.solve = function (wheelY) {
    const cz = this.cz, cy = this.cy, cr = this.cr, nz = this.nz, ny = this.ny;
    if (wheelY) for (let i = 0; i < 7; i++) cy[1 + i] = wheelY[i];
    // the outer tangent's normal for each segment i -> i+1
    for (let i = 0; i < NCIRC; i++) {
      const j = (i + 1) % NCIRC;
      let dz = cz[j] - cz[i], dy = cy[j] - cy[i];
      const L = Math.hypot(dz, dy) || 1e-6;
      dz /= L; dy /= L;
      const a = clamp((cr[i] - cr[j]) / L, -0.99, 0.99), b = Math.sqrt(1 - a * a);
      nz[i] = a * dz - b * dy; ny[i] = a * dy + b * dz;          // a*d + b*left(d), left(d) = (-dy, dz)
    }
    let n = 0;
    const pz = this.pz, py = this.py;
    for (let j = 0; j < NCIRC; j++) {
      const pi = (j + NCIRC - 1) % NCIRC;
      const tin = Math.atan2(ny[pi], nz[pi]), tout = Math.atan2(ny[j], nz[j]);
      let sw = tin - tout;
      while (sw < 0) sw += TAU; while (sw >= TAU) sw -= TAU;
      if (sw > PI * 1.5) sw = 0;                                   // the belt bridges a lifted wheel
      const steps = Math.max(1, Math.ceil(sw / 0.16));
      for (let k = 0; k <= steps; k++) {
        const t = sw === 0 ? (k === 0 ? tin : tout) : tin - sw * k / steps;
        pz[n] = cz[j] + Math.cos(t) * cr[j]; py[n] = cy[j] + Math.sin(t) * cr[j]; n++;
      }
      // the top run sags between sprocket, rollers and idler
      if (j >= 8) {
        const k2 = (j + 1) % NCIRC;
        const az = cz[j] + nz[j] * cr[j], ay = cy[j] + ny[j] * cr[j];
        const bz = cz[k2] + nz[j] * cr[k2], by = cy[k2] + ny[j] * cr[k2];
        const L = Math.hypot(bz - az, by - ay);
        for (let q = 1; q < 4; q++) {
          const f = q / 4;
          pz[n] = az + (bz - az) * f; py[n] = ay + (by - ay) * f - 0.10 * L * L * 0.06 * Math.sin(PI * f); n++;
        }
      }
    }
    // cumulative length (closed)
    const sl = this.sl;
    let s = 0;
    sl[0] = 0;
    for (let i = 1; i <= n; i++) {
      const a = i - 1, b = i % n;
      s += Math.hypot(pz[b] - pz[a], py[b] - py[a]);
      sl[i] = s;
    }
    this.n = n; this.len = s;
    return s;
  };
  // write `count` link matrices at x into arr (column-major 4x4), from belt offset off
  Belt.prototype.place = function (arr, base, count, x, off) {
    const n = this.n, L = this.len, pz = this.pz, py = this.py, sl = this.sl;
    const p = L / count;
    let s = off % L; if (s < 0) s += L;
    let seg = 0;
    while (seg < n - 1 && sl[seg + 1] <= s) seg++;
    for (let k = 0; k < count; k++) {
      if (s >= L) { s -= L; seg = 0; while (seg < n - 1 && sl[seg + 1] <= s) seg++; }
      while (seg < n - 1 && sl[seg + 1] <= s) seg++;
      const a = seg, b = (seg + 1) % n;
      const sg = sl[seg + 1] - sl[seg] || 1e-6, f = (s - sl[seg]) / sg;
      const tz = (pz[b] - pz[a]) / sg, ty = (py[b] - py[a]) / sg;
      const z = pz[a] + (pz[b] - pz[a]) * f, y = py[a] + (py[b] - py[a]) * f;
      // Y (out of the loop) = left of travel = (-ty, tz) in (z, y)
      const oy = tz, oz = -ty;
      const o = (base + k) * 16;
      arr[o] = 1; arr[o + 1] = 0; arr[o + 2] = 0; arr[o + 3] = 0;
      arr[o + 4] = 0; arr[o + 5] = oy; arr[o + 6] = oz; arr[o + 7] = 0;
      arr[o + 8] = 0; arr[o + 9] = ty; arr[o + 10] = tz; arr[o + 11] = 0;
      arr[o + 12] = x; arr[o + 13] = y; arr[o + 14] = z; arr[o + 15] = 1;
      s += p;
    }
  };

  // ================================================================ TEMPLATE
  let TPL = null;
  function template(T) {
    if (TPL && TPL.T === T) return TPL;
    const belt = new Belt();
    const L = belt.solve(null);
    TPL = {
      T: T,
      hull: buildHull(T), turret: buildTurret(T), mantlet: buildMantlet(T), tube: buildTube(T),
      lidC: buildLid(T, 0.40), lidL: buildLid(T, 0.36), crows: buildCrows(T), figure: buildFigure(T), antenna: buildAntenna(T),
      wheel: buildRoadWheel(T, DM.wheelR, true), idler: buildRoadWheel(T, DM.idler.r, false), sprocket: buildSprocket(T), link: buildLink(T),
      links: Math.round(L / DM.pitch),
    };
    // instanced parts are culled by the geometry's sphere in the ROOT's frame
    ["wheel", "idler", "sprocket", "link"].forEach(function (k) { TPL[k].boundingSphere = new T.Sphere(new T.Vector3(0, 0.7, -0.2), 4.6); });
    return TPL;
  }

  // ================================================================ DUST + HAZE
  /* One shared pool of soft sprites for every Abrams on the page (one draw
     call): track dust, turbine exhaust haze, the 120 mm's ground blast.
     World space, fogged, aged once per frame. */
  const FX = { pts: null, n: 768, head: 0, k: null, pos: null, size: null, alpha: null, col: null, vel: null, age: null, life: null, grow: null, a0: null };
  function fxInit(T) {
    if (FX.pts || !CBZ.scene) return !!FX.pts;
    const n = FX.n, g = new T.BufferGeometry();
    FX.pos = new Float32Array(n * 3); FX.size = new Float32Array(n); FX.alpha = new Float32Array(n); FX.col = new Float32Array(n * 3);
    FX.vel = new Float32Array(n * 3); FX.age = new Float32Array(n).fill(1e9); FX.life = new Float32Array(n).fill(1); FX.grow = new Float32Array(n); FX.a0 = new Float32Array(n); FX.s0 = new Float32Array(n);
    g.setAttribute("position", new T.BufferAttribute(FX.pos, 3).setUsage(T.DynamicDrawUsage));
    g.setAttribute("aSize", new T.BufferAttribute(FX.size, 1).setUsage(T.DynamicDrawUsage));
    g.setAttribute("aAlpha", new T.BufferAttribute(FX.alpha, 1).setUsage(T.DynamicDrawUsage));
    g.setAttribute("aCol", new T.BufferAttribute(FX.col, 3).setUsage(T.DynamicDrawUsage));
    const u = T.UniformsUtils.merge([T.UniformsLib.fog, { uScale: { value: 700 } }]);
    const m = new T.ShaderMaterial({
      uniforms: u, transparent: true, depthWrite: false, fog: true,
      vertexShader: [
        "attribute float aSize; attribute float aAlpha; attribute vec3 aCol;",
        "varying float vA; varying vec3 vC; uniform float uScale;",
        "#include <fog_pars_vertex>",
        "void main(){ vA = aAlpha; vC = aCol; vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);",
        " gl_PointSize = aAlpha > 0.001 ? aSize * uScale / max(0.5, -mvPosition.z) : 0.0;",
        " gl_Position = projectionMatrix * mvPosition;",
        "#include <fog_vertex>",
        "}"].join("\n"),
      fragmentShader: [
        "varying float vA; varying vec3 vC;",
        "#include <fog_pars_fragment>",
        "void main(){ vec2 q = gl_PointCoord - 0.5; float d = length(q) * 2.0; if (d > 1.0) discard;",
        " float a = (1.0 - d * d); a *= a; a *= 0.85 + 0.15 * sin(q.x * 17.0 + q.y * 11.0);",
        " gl_FragColor = vec4(vC, vA * a);",
        "#include <encodings_fragment>",
        "#include <fog_fragment>",
        "}"].join("\n"),
    });
    FX.pts = new T.Points(g, m);
    FX.pts.frustumCulled = false; FX.pts.renderOrder = 6; FX.pts.name = "abrams-dust";
    CBZ.scene.add(FX.pts);
    return true;
  }
  const DUST = lin(0xb8a888), EXH = lin(0x6e665c);
  function fxEmit(x, y, z, vx, vy, vz, s0, grow, a0, life, col) {
    if (!FX.pts) return;
    const i = FX.head; FX.head = (FX.head + 1) % FX.n;
    FX.pos[i * 3] = x; FX.pos[i * 3 + 1] = y; FX.pos[i * 3 + 2] = z;
    FX.vel[i * 3] = vx; FX.vel[i * 3 + 1] = vy; FX.vel[i * 3 + 2] = vz;
    FX.s0[i] = s0; FX.grow[i] = grow; FX.a0[i] = a0; FX.life[i] = life; FX.age[i] = 0;
    FX.col[i * 3] = col[0]; FX.col[i * 3 + 1] = col[1]; FX.col[i * 3 + 2] = col[2];
  }
  function fxStep(dt) {
    if (!FX.pts) return;
    const stamp = typeof CBZ.now === "number" ? CBZ.now : (typeof performance !== "undefined" ? performance.now() : Date.now());
    if (stamp === FX.k) return;
    FX.k = stamp;
    if (FX.pts.parent !== CBZ.scene && CBZ.scene) CBZ.scene.add(FX.pts);
    const n = FX.n, drag = Math.max(0, 1 - dt * 1.6);
    for (let i = 0; i < n; i++) {
      if (FX.age[i] >= FX.life[i]) { FX.alpha[i] = 0; continue; }
      FX.age[i] += dt;
      const t = FX.age[i] / FX.life[i];
      const i3 = i * 3;
      FX.vel[i3] *= drag; FX.vel[i3 + 1] = FX.vel[i3 + 1] * drag + 0.25 * dt; FX.vel[i3 + 2] *= drag;
      FX.pos[i3] += FX.vel[i3] * dt; FX.pos[i3 + 1] += FX.vel[i3 + 1] * dt; FX.pos[i3 + 2] += FX.vel[i3 + 2] * dt;
      FX.size[i] = FX.s0[i] + FX.grow[i] * Math.sqrt(t);
      FX.alpha[i] = t >= 1 ? 0 : FX.a0[i] * Math.min(1, t * 6) * (1 - t) * (1 - t);
    }
    const g = FX.pts.geometry;
    g.attributes.position.needsUpdate = true; g.attributes.aSize.needsUpdate = true; g.attributes.aAlpha.needsUpdate = true; g.attributes.aCol.needsUpdate = true;
  }

  // ================================================================ THE RIG
  const _v = { x: 0, y: 0, z: 0 };
  function Rig(T, parts) {
    Object.assign(this, parts);
    this.T = T;
    this.t = 0;
    this.sL = 0; this.sR = 0; this.aL = 0; this.aR = 0; this.aI = [0, 0]; this.aS = [0, 0];
    this.off = new Float32Array(14); this.offT = new Float32Array(14); this.wy = new Float32Array(7);
    this.groundT = 0; this.lastV = 0; this.acc = 0;
    this.pitchB = 0; this.rollB = 0; this.rockT = 9; this.rockYaw = 0; this.recoilT = 9;
    this.elRel = 0; this.elWant = 0; this.lastAim = -99; this.lastFire = -99; this.lastHurt = -99;
    this.up = 1; this.lidA = 1;
    this.antA = [0, 0]; this.antV = [0, 0];
    this.dustAcc = 0; this.exhAcc = 0; this.burnAcc = 0;
    this.vs = null; this.wrecked = false; this.scheme = "tan"; this.nation = null;
    this.cy = 0; this.cyEl = 0;
    this._belt = [new Belt(), new Belt()];
    this.layGear(true);
  }
  Rig.prototype.now = function () { return this.t; };
  // ---- the hull's tilt along an azimuth (gun stabilisation, deck clearance)
  Rig.prototype.tiltAlong = function (psi) {
    const rx = this.root.rotation.x + this.body.rotation.x, rz = this.root.rotation.z + this.body.rotation.z;
    const gx = Math.sin(psi), gz = Math.cos(psi);
    return Math.asin(clamp(Math.sin(rz) * gx * Math.cos(rx) - gz * Math.sin(rx), -1, 1));
  };
  Rig.prototype.layGun = function (dt) {
    const psi = this.turret.rotation.y;
    const lo = Math.abs(psi) > 2.15 ? TUR.deckMin : TUR.elevMin;
    const want = clamp(this.elWant - this.tiltAlong(psi), lo, TUR.elevMax);
    const s = TUR.elevRate * dt;
    this.elRel += clamp(want - this.elRel, -s, s);
    if (this.elRel < lo) this.elRel = Math.min(lo, this.elRel + 0.6 * dt);
    this.gun.rotation.x = -this.elRel;
  };
  Rig.prototype.aimTurret = function (wantYaw, wantElev, dt) {
    if (this.wrecked) return;
    dt = Math.max(0, dt || 0);
    const cur = this.turret.rotation.y, s = TUR.rate * dt;
    this.turret.rotation.y = wrap(cur + clamp(wrap(wantYaw - cur), -s, s));
    this.elWant = wantElev || 0;
    this.lastAim = this.t;
    this.layGun(dt);
    // the CROWS lays itself on the same mark, faster than the turret
    if (this.crows) {
      const rel = wrap(wantYaw - this.turret.rotation.y), cs = 1.05 * dt;
      this.crows.rotation.y = wrap(this.crows.rotation.y + clamp(wrap(rel - this.crows.rotation.y), -cs, cs));
      this.crowsEl.rotation.x = -clamp(this.crowsEl.rotation.x * -1 + clamp(wantElev - this.crowsEl.rotation.x * -1, -dt, dt), -0.35, 1.05);
    }
  };
  Rig.prototype.muzzleWorld = function (out) {
    this.root.updateWorldMatrix(true, true);
    return this.muzzle.getWorldPosition(out || new this.T.Vector3());
  };
  Rig.prototype.gunDirWorld = function (out) {
    out = out || new this.T.Vector3();
    this.root.updateWorldMatrix(true, true);
    return this.gun.getWorldDirection(out);
  };
  // the gun just fired: recoil and run-out, the hull rocks back on its
  // suspension against the shot, the blast, the ground dust it throws up
  Rig.prototype.fired = function (scale) {
    scale = scale == null ? 1 : scale;
    this.lastFire = this.t;
    if (scale < 0.5) {
      const p = this.muzzleWorld(new this.T.Vector3());
      if (CBZ.muzzleFlash) { try { CBZ.muzzleFlash(p, { scale: 1.2 }); } catch (e) {} }
      return;
    }
    this.recoilT = 0; this.rockT = 0; this.rockYaw = this.turret.rotation.y;
    const T = this.T, p = this.muzzleWorld(new T.Vector3()), d = this.gunDirWorld(new T.Vector3());
    if (CBZ.milArmor && CBZ.milArmor.blast) { try { CBZ.milArmor.blast(p, d, scale * 1.15); } catch (e) {} }
    else if (CBZ.muzzleFlash) { try { CBZ.muzzleFlash(p, { scale: 6 }); } catch (e) {} }
    if (fxInit(T)) {
      const gy = groundAt(p.x, p.z, this.root.position.y);
      // obturation blast: a ring of dust off the ground under and ahead of the muzzle
      for (let i = 0; i < 18; i++) {
        const a = i / 18 * TAU, sp = 5 + (i % 3) * 2;
        fxEmit(p.x + d.x * 1.5, gy + 0.4, p.z + d.z * 1.5, Math.cos(a) * sp + d.x * 6, 0.6 + (i % 4) * 0.3, Math.sin(a) * sp + d.z * 6, 1.4, 5.5, 0.42, 2.8 + (i % 5) * 0.3, DUST);
      }
      for (let i = 0; i < 6; i++) fxEmit(p.x + d.x * (2 + i * 1.6), p.y, p.z + d.z * (2 + i * 1.6), d.x * 4, 0.4, d.z * 4, 1.0, 3.5, 0.28, 2.2, EXH);
    }
  };
  // damage states while still fighting (the runtime may call this on a hit)
  Rig.prototype.damage = function (vs) {
    this.vs = vs || this.vs;
    this.lastHurt = this.t;
  };
  // paint scheme by ground and the nation's flag on the turret sides
  Rig.prototype.mark = function (nation, ground) {
    const T = this.T;
    const g = String(ground || "");
    const key = /snow|ice|arctic|winter|tundra/.test(g) ? "winter" : /grass|field|forest|island|wood|jungle|farm/.test(g) ? "green3" : "tan";
    this.setScheme(key);
    this.nation = nation || null;
    if (this.flags) { this.flags.forEach(function (f) { if (f.parent) f.parent.remove(f); }); this.flags = null; }
    if (!nation) return;
    const fm = flagMat(T, nation);
    if (!fm) return;
    let ratio = 0.62;
    try { const r = CBZ.flags.ratioOf ? CBZ.flags.ratioOf(nation) : null; if (r && r[1]) ratio = r[0] / r[1]; } catch (e) {}
    if (!TPL.flagGeo) TPL.flagGeo = new T.PlaneGeometry(1, 1);
    const self = this;
    this.flags = [-1, 1].map(function (s) {
      const m = new T.Mesh(TPL.flagGeo, fm);
      m.scale.set(0.42, 0.42 * ratio, 1);
      m.position.set(s * 1.855, 0.48, -0.95);
      m.rotation.set(0, s * PI / 2, s * 0.06, "YXZ");
      self.turret.add(m);
      return m;
    });
  };
  Rig.prototype.setScheme = function (key) {
    this.scheme = key;
    if (this.wrecked) return;
    const pm = paintMat(this.T, key);
    this.paintMeshes.forEach(function (m) { m.material = pm; });
    this._paint = pm;
  };
  Rig.prototype.settle = function () {
    this.body.rotation.set(0, 0, 0);
    this.tube.position.z = 0;
    this.recoilT = 9; this.rockT = 9; this.pitchB = 0; this.rollB = 0; this.lastV = 0; this.acc = 0;
    this.layGear(true);
  };

  // ---- the running gear: suspension over the ground, spinning wheels, belts
  function groundAt(x, z, dflt) {
    const f = CBZ.floorAt;
    if (typeof f !== "function") return dflt;
    const y = f(x, z);
    return Number.isFinite(y) ? y : dflt;
  }
  Rig.prototype.sampleGround = function () {
    const r = this.root, f = CBZ.floorAt;
    if (typeof f !== "function" || !r.parent) { this.offT.fill(0); return; }
    r.updateWorldMatrix(true, false);
    const e = r.matrixWorld.elements, cosk = Math.max(0.5, e[5]);
    for (let s = 0; s < 2; s++) {
      const x = s === 0 ? DM.trackX : -DM.trackX;
      for (let i = 0; i < 7; i++) {
        const z = DM.wheelZ[i], y = DM.wheelY;
        const wx = e[0] * x + e[4] * y + e[8] * z + e[12], wy = e[1] * x + e[5] * y + e[9] * z + e[13], wz = e[2] * x + e[6] * y + e[10] * z + e[14];
        const g = f(wx, wz);
        if (!Number.isFinite(g)) { this.offT[s * 7 + i] = 0; continue; }
        this.offT[s * 7 + i] = clamp((g + DM.wheelY - wy) / cosk, -0.10, 0.30);
      }
    }
  };
  Rig.prototype.layGear = function (force) {
    const T = this.T;
    // road wheels
    const wa = this.imW.instanceMatrix.array;
    for (let s = 0; s < 2; s++) {
      const x = s === 0 ? DM.trackX : -DM.trackX, ang = s === 0 ? this.aL : this.aR, c = Math.cos(ang), sn = Math.sin(ang);
      for (let i = 0; i < 7; i++) {
        const o = (s * 7 + i) * 16, y = DM.wheelY + this.off[s * 7 + i];
        wa[o] = 1; wa[o + 1] = 0; wa[o + 2] = 0; wa[o + 3] = 0;
        wa[o + 4] = 0; wa[o + 5] = c; wa[o + 6] = sn; wa[o + 7] = 0;
        wa[o + 8] = 0; wa[o + 9] = -sn; wa[o + 10] = c; wa[o + 11] = 0;
        wa[o + 12] = x; wa[o + 13] = y; wa[o + 14] = DM.wheelZ[i]; wa[o + 15] = 1;
        if (s === 0) this.wy[i] = y;
      }
    }
    this.imW.instanceMatrix.needsUpdate = true;
    // idlers + sprockets (the sprocket is mirrored outboard on the right)
    const ia = this.imI.instanceMatrix.array, sa = this.imS.instanceMatrix.array;
    for (let s = 0; s < 2; s++) {
      const x = s === 0 ? DM.trackX : -DM.trackX, sg = s === 0 ? 1 : -1;
      const belt = s === 0 ? this.sL : this.sR;
      const ai = belt / (DM.idler.r + DM.linkC), as = belt / DM.sprocket.r;
      let c = Math.cos(ai), sn = Math.sin(ai), o = s * 16;
      ia[o] = sg; ia[o + 1] = 0; ia[o + 2] = 0; ia[o + 3] = 0; ia[o + 4] = 0; ia[o + 5] = c; ia[o + 6] = sn; ia[o + 7] = 0;
      ia[o + 8] = 0; ia[o + 9] = -sn; ia[o + 10] = c; ia[o + 11] = 0; ia[o + 12] = x; ia[o + 13] = DM.idler.y; ia[o + 14] = DM.idler.z; ia[o + 15] = 1;
      c = Math.cos(as); sn = Math.sin(as);
      sa[o] = sg; sa[o + 1] = 0; sa[o + 2] = 0; sa[o + 3] = 0; sa[o + 4] = 0; sa[o + 5] = c; sa[o + 6] = sn; sa[o + 7] = 0;
      sa[o + 8] = 0; sa[o + 9] = -sn; sa[o + 10] = c; sa[o + 11] = 0; sa[o + 12] = x; sa[o + 13] = DM.sprocket.y; sa[o + 14] = DM.sprocket.z; sa[o + 15] = 1;
    }
    this.imI.instanceMatrix.needsUpdate = true; this.imS.instanceMatrix.needsUpdate = true;
    // the belts
    const N = this.links, la = this.imT.instanceMatrix.array;
    for (let s = 0; s < 2; s++) {
      const b = this._belt[s], wy = this._wyS || (this._wyS = new Float32Array(7));
      for (let i = 0; i < 7; i++) wy[i] = DM.wheelY + this.off[s * 7 + i];
      b.solve(wy);
      b.place(la, s * N, N, s === 0 ? DM.trackX : -DM.trackX, s === 0 ? this.sL : this.sR);
    }
    this.imT.instanceMatrix.needsUpdate = true;
  };

  Rig.prototype.update = function (dt, v, w) {
    if (this.wrecked) return;
    dt = Math.min(0.1, Math.max(0, dt || 0));
    if (!(dt > 0)) return;
    this.t += dt;
    v = v || 0; w = w || 0;
    fxInit(this.T);
    fxStep(dt);
    // ---- belts: the kit's skid steer split (left is +X)
    const half = DM.trackX, vL = v - w * half, vR = v + w * half;
    this.sL += vL * dt; this.sR += vR * dt;
    this.aL += vL * dt / DM.wheelR; this.aR += vR * dt / DM.wheelR;
    // ---- suspension: each wheel's arm follows the ground under it
    const moving = Math.abs(v) > 0.05 || Math.abs(w) > 0.02;
    this.groundT -= dt;
    if (this.groundT <= 0) { this.sampleGround(); this.groundT = moving ? 0 : 0.5; }
    let gearMoved = moving;
    const kk = Math.min(1, dt * 14);
    for (let i = 0; i < 14; i++) {
      const d = (this.offT[i] - this.off[i]) * kk;
      if (Math.abs(d) > 1e-5) { this.off[i] += d; gearMoved = true; }
    }
    if (gearMoved) this.layGear(false);
    // ---- the sprung hull: squat / dive, lean out of the turn, recoil rock
    const a = (v - this.lastV) / dt;
    this.lastV = v;
    this.acc += (clamp(a, -6, 6) - this.acc) * Math.min(1, dt * 5);
    this.pitchB += (clamp(-this.acc * 0.006, -0.028, 0.028) - this.pitchB) * Math.min(1, dt * 4);
    this.rollB += (clamp(v * w * 0.0045, -0.03, 0.03) - this.rollB) * Math.min(1, dt * 3);
    let rx = this.pitchB, rz = this.rollB;
    if (this.rockT < 2.5) {
      this.rockT += dt;
      const f = 0.034 * Math.exp(-3.2 * this.rockT) * Math.sin(Math.min(this.rockT * 26, PI * 0.5) + this.rockT * 7.5);
      rx -= f * Math.cos(this.rockYaw); rz += f * Math.sin(this.rockYaw);
    }
    this.body.rotation.set(rx, 0, rz);
    // ---- recoil and run-out
    if (this.recoilT < 1.0) {
      this.recoilT += dt;
      const t = this.recoilT, k = t < 0.035 ? t / 0.035 : Math.max(0, 1 - (t - 0.035) / 0.6);
      this.tube.position.z = -DM.recoil * k * k * (3 - 2 * k);
    } else if (this.tube.position.z !== 0) this.tube.position.z = 0;
    // ---- the turret when nothing is being engaged: guns to the front
    const calm = this.t - this.lastAim;
    if (calm > 5) {
      this.elWant += (0.02 - this.elWant) * Math.min(1, dt);
      if (calm > 7) {
        const cur = this.turret.rotation.y, s = 0.28 * dt;
        this.turret.rotation.y = wrap(cur + clamp(wrap(0 - cur), -s, s));
        if (this.crows) this.crows.rotation.y = wrap(this.crows.rotation.y + clamp(wrap(0 - this.crows.rotation.y), -s, s));
      }
    }
    this.layGun(dt);
    // ---- the commander: head out when calm, down and buttoned up in a fight
    const head = calm > 6 && this.t - this.lastFire > 10 && this.t - this.lastHurt > 20 && !(this.vs && this.vs.burning);
    const upT = head ? 1 : 0;
    this.up += clamp(upT - this.up, -dt * 2.2, dt * 0.8);
    this.lidA += clamp((this.up > 0.05 ? 1 : 0) - this.lidA, -dt * 3, dt * 1.5);
    this.cmdr.position.y = DM.cmdr[1] - 0.82 * (1 - this.up);
    this.cmdr.visible = this.up > 0.02;
    this.lidC.rotation.x = -1.9 * this.lidA;
    // ---- whip antennas: sprung, they swing on braking and turning
    for (let i = 0; i < 2; i++) {
      const f = this.acc * 0.05 + (i ? -1 : 1) * v * w * 0.004;
      this.antV[i] += (-60 * this.antA[i] - 2.2 * this.antV[i] + f * 60) * dt;
      this.antA[i] = clamp(this.antA[i] + this.antV[i] * dt, -0.5, 0.5);
      this.ant[i].rotation.x = this.antA[i];
      this.ant[i].rotation.z = this.rollB * 3;
    }
    // ---- dust off the belts, the turbine's exhaust
    if (FX.pts) {
      const sp = Math.abs(v) + Math.abs(w) * 1.6;
      const e = this.root.matrixWorld.elements, P = this.root.position;
      if (sp > 1.0) {
        this.dustAcc += dt * Math.min(16, 2 + sp * 1.4);
        while (this.dustAcc >= 1) {
          this.dustAcc -= 1;
          const s = Math.random() < 0.5 ? 1 : -1, lx = s * (DM.trackX + (Math.random() - 0.5) * 0.5);
          const lz = (v >= 0 ? -3.4 : 3.2) + (Math.random() - 0.5) * 0.6;
          const wx = e[0] * lx + e[8] * lz + P.x, wz = e[2] * lx + e[10] * lz + P.z;
          const fx = e[8], fz = e[10], back = v >= 0 ? -1 : 1;
          fxEmit(wx, P.y + 0.35, wz, fx * back * (1 + sp * 0.15) + (Math.random() - 0.5), 0.5 + Math.random() * 0.6, fz * back * (1 + sp * 0.15) + (Math.random() - 0.5),
            1.0, 2.2 + sp * 0.32, Math.min(0.42, 0.10 + sp * 0.025), 2.4 + Math.random() * 1.6, DUST);
        }
      }
      this.exhAcc += dt * (1.5 + Math.max(0, this.acc) * 3);
      while (this.exhAcc >= 1) {
        this.exhAcc -= 1;
        const lx = (Math.random() - 0.5) * 1.4, lz = DM.rear - 0.25;
        const wx = e[0] * lx + e[8] * lz + P.x, wz = e[2] * lx + e[10] * lz + P.z;
        fxEmit(wx, P.y + 1.05, wz, -e[8] * 3.5, 0.6, -e[10] * 3.5, 0.6, 1.8, 0.10 + Math.max(0, this.acc) * 0.06, 1.4, EXH);
      }
    }
    // ---- burning while still fighting (a fire in the engine compartment)
    if (this.vs && this.vs.burning) this.burn(dt, false);
  };
  Rig.prototype.burn = function (dt, cookoff) {
    this.burnAcc -= dt;
    if (this.burnAcc > 0) return;
    this.burnAcc = cookoff ? 0.12 : 0.7;
    this.root.updateWorldMatrix(true, false);
    const e = this.root.matrixWorld.elements;
    const lz = cookoff ? DM.turZ - 1.95 : -2.6, ly = cookoff ? DM.turY + 0.9 : 1.6;
    const x = e[4] * ly + e[8] * lz + e[12], y = e[5] * ly + e[9] * lz + e[13], z = e[6] * ly + e[10] * lz + e[14];
    if (cookoff && CBZ.muzzleFlash) {
      // the bustle's blow-off panels venting: two jets of flame straight up
      for (let s = -1; s <= 1; s += 2) {
        const ox = e[0] * s * 0.78, oz = e[2] * s * 0.78;
        try { CBZ.muzzleFlash({ x: x + ox, y: y + 1.2 + Math.random() * 2.5, z: z + oz }, { scale: 4 + Math.random() * 3, life: 0.2, color: 0xffa040 }); } catch (e2) {}
      }
    }
    if (CBZ.cityCrashSmoke) { try { CBZ.cityCrashSmoke(x, y, z, { count: cookoff ? 3 : 2, scale: cookoff ? 1.8 : 1.1, flame: true }); } catch (e3) {} }
  };

  // ---- KNOCKED OUT. The runtime darkens the hull's materials when it kills
  // it (src/battle/vehicles.js vehicleWrecked): that is the signal. From then
  // on this mesh's onBeforeRender drives the wreck, since rig.update stops.
  Rig.prototype.watchWreck = function (mesh) {
    const self = this;
    let last = 0;
    mesh.onBeforeRender = function () {
      const now = typeof performance !== "undefined" ? performance.now() : Date.now();
      const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
      if (now === last) return;
      last = now;
      if (!self.wrecked) {
        if (mesh.material === self._paint) return;
        const c = mesh.material && mesh.material.color;
        if (!c || c.r > 0.9) return;              // someone else's swap, not the runtime's blackening
        self.wreck(c.r < 0.4);
        return;
      }
      self.stepWreck(dt);
    };
  };
  Rig.prototype.wreck = function (catastrophic) {
    if (this.wrecked) return;
    this.wrecked = true;
    const T = this.T, burnt = paintMat(T, "burnt"), self = this;
    this._paint = burnt;
    const char = MATS.charPlain || (MATS.charPlain = (function () { const m = new T.MeshStandardMaterial({ color: new T.Color(0.035, 0.03, 0.028), roughness: 0.95 }); m._shared = true; return m; })());
    this.root.traverse(function (o) {
      if (!o.isMesh) return;
      if (self.flags && self.flags.indexOf(o) >= 0) { o.visible = false; return; }
      o.material = self.paintMeshes.indexOf(o) >= 0 ? burnt : char;
    });
    this.cmdr.visible = false;
    this.lidA = 1; this.lidC.rotation.x = -1.9; this.lidL.rotation.x = -1.9;      // the crew got out (or tried)
    this.cookT = catastrophic ? 6 + Math.random() * 6 : 0;
    this.fireT = catastrophic ? 60 : (Math.random() < 0.5 ? 30 : 0);
    this.toss = catastrophic && Math.random() < 0.2 ? { t: 0, vy: 11 + Math.random() * 5, vx: (Math.random() - 0.5) * 6, vz: (Math.random() - 0.5) * 6, spin: (Math.random() - 0.5) * 5, roll: (Math.random() - 0.5) * 3, done: false } : null;
    if (this.toss) this.cookT = 2;
  };
  Rig.prototype.stepWreck = function (dt) {
    if (!(dt > 0)) return;
    // hydraulics gone: the gun sinks onto its stop
    if (!this.toss) { this.elRel = Math.max(TUR.elevMin, this.elRel - dt * 0.05); this.gun.rotation.x = -this.elRel; }
    if (this.cookT > 0) { this.cookT -= dt; this.burn(dt, true); }
    else if (this.fireT > 0) { this.fireT -= dt; this.burn(dt, false); }
    const q = this.toss;
    if (q && !q.done) {
      q.t += dt;
      const tr = this.turret;
      tr.position.x += q.vx * dt; tr.position.z += q.vz * dt; tr.position.y += q.vy * dt;
      q.vy -= 9.8 * dt;
      tr.rotation.x += q.roll * dt; tr.rotation.z += q.spin * dt * 0.4; tr.rotation.y += q.spin * dt;
      const floor = -0.1 + (Math.abs(Math.cos(tr.rotation.x)) < 0.5 ? 0.4 : 0) - this.body.position.y;
      if (q.vy < 0 && tr.position.y <= floor) {
        tr.position.y = floor; q.done = true;
        tr.rotation.x = Math.abs(wrap(tr.rotation.x)) > PI / 2 ? PI * 0.97 : 0.12;
        tr.rotation.z = 0.08;
      }
    }
  };

  // ================================================================ BUILD
  function build(ctx) {
    const T = (ctx && ctx.THREE) || W.THREE;
    if (!T || !T.InstancedMesh || !T.ShapeUtils) return null;
    const P = template(T);
    const pm = paintMat(T, "tan"), plain = plainMat(T), glass = glassMat(T), track = trackMat(T);
    const paintMeshes = [], glassMeshes = [];
    function mesh(geo, mat, parent, name, shadow) {
      if (!geo || !geo.attributes.position || geo.attributes.position.count === 0) return null;
      const m = new T.Mesh(geo, mat);
      m.name = name || ""; m.castShadow = shadow !== false; m.receiveShadow = true;
      parent.add(m);
      if (mat === pm) paintMeshes.push(m);
      if (mat === glass) glassMeshes.push(m);
      return m;
    }
    const root = new T.Group(); root.name = "m1_abrams"; root.rotation.order = "YXZ";
    const body = new T.Group(); body.name = "body"; root.add(body);
    const hull = mesh(P.hull.paint, pm, body, "hull");
    mesh(P.hull.plain, plain, body, "hull-fit");
    mesh(P.hull.glass, glass, body, "hull-glass", false);
    const turret = new T.Group(); turret.name = "turret"; turret.position.set(0, DM.turY, DM.turZ); body.add(turret);
    mesh(P.turret.paint, pm, turret, "turret-armour");
    mesh(P.turret.plain, plain, turret, "turret-stowage");
    mesh(P.turret.glass, glass, turret, "turret-optics", false);
    const gun = new T.Group(); gun.name = "gun"; gun.position.set(0, DM.gunY, DM.gunZ); turret.add(gun);
    mesh(P.mantlet, pm, gun, "mantlet");
    const tube = new T.Group(); tube.name = "tube"; gun.add(tube);
    mesh(P.tube, pm, tube, "m256");
    const muzzle = new T.Object3D(); muzzle.name = "muzzle"; muzzle.position.set(0, 0, DM.muzzle); tube.add(muzzle);
    // hatches (hinged at the back edge)
    const lidC = new T.Group(); lidC.position.set(DM.cmdr[0], 0.95, DM.cmdr[2] - 0.40); turret.add(lidC);
    mesh(P.lidC, pm, lidC, "cmdr-hatch");
    const lidL = new T.Group(); lidL.position.set(DM.loader[0], 0.89, DM.loader[2] - 0.36); turret.add(lidL);
    mesh(P.lidL, pm, lidL, "loader-hatch");
    // the commander
    const cmdr = new T.Group(); cmdr.name = "commander"; cmdr.position.set(DM.cmdr[0], DM.cmdr[1], DM.cmdr[2] + 0.04); turret.add(cmdr);
    mesh(P.figure, plain, cmdr, "commander-body");
    // CROWS
    const crows = new T.Group(); crows.name = "crows"; crows.position.set(DM.crows[0], DM.crows[1], DM.crows[2]); turret.add(crows);
    mesh(P.crows.base, pm, crows, "crows-base");
    const crowsEl = new T.Group(); crowsEl.position.set(0, 0.42, 0); crows.add(crowsEl);
    mesh(P.crows.cradle, pm, crowsEl, "crows-cradle");
    mesh(P.crows.plain, plain, crowsEl, "m2");
    mesh(P.crows.glass, glass, crowsEl, "crows-glass", false);
    // antennas
    const ant = [-1, 1].map(function (s) {
      const a = new T.Group(); a.position.set(s * 1.15, 0.94, -2.95); turret.add(a);
      mesh(P.antenna, plain, a, "antenna", false);
      return a;
    });
    // running gear (instanced, in the root's frame: unsprung)
    function im(geo, mat, n, name) {
      const m = new T.InstancedMesh(geo, mat, n);
      m.name = name; m.castShadow = true; m.receiveShadow = true;
      if (m.instanceMatrix.setUsage) m.instanceMatrix.setUsage(T.DynamicDrawUsage);
      root.add(m);
      if (mat === pm) paintMeshes.push(m);
      return m;
    }
    const imW = im(P.wheel, pm, 14, "road-wheels"), imI = im(P.idler, pm, 2, "idlers"), imS = im(P.sprocket, pm, 2, "sprockets");
    const imT = im(P.link, track, P.links * 2, "track");
    const rig = new Rig(T, { root: root, body: body, turret: turret, gun: gun, tube: tube, muzzle: muzzle, lidC: lidC, lidL: lidL, cmdr: cmdr,
      crows: crows, crowsEl: crowsEl, ant: ant, imW: imW, imI: imI, imS: imS, imT: imT, links: P.links,
      paintMeshes: paintMeshes, glassMeshes: glassMeshes, _paint: pm });
    rig.watchWreck(hull);
    // the nation and the ground: the runtime calls rig.mark(nation, ground) after build
    Object.defineProperty(root.userData, "rig", { value: rig, enumerable: false, writable: true, configurable: true });
    return { group: root, rig: rig, footW: 3.66, footL: 7.93, height: 2.44 };
  }

  // ================================================================ REGISTER
  CBZ.unitKit.register("m1_abrams", {
    kind: "vehicle",
    domain: "ground",
    drive: "tracked",
    /* M1A2 SEP v2: 66.8 t, AGT1500 1,500 hp turbine, governed 67 km/h road,
       ~40 km/h reverse, 0-32 km/h in ~7 s, neutral pivot ~40 deg/s.
       Armour is kinetic (vs darts and ball) and chemical (armourCE: vs
       shaped charges, the kit's units/kit/vehicle.js reads it): the frontal
       arc defeats any RPG and most ATGMs, the side does not (the heavy
       forward skirts are counted), the rear and roof are thin. */
    stats: {
      hp: 1000, mass: 66800, speed: 18.6, reverse: 11.1, accel: 1.35, turn: 0.70,
      length: 7.93, width: 3.66, height: 2.44,
      armour: { front: 820, side: 110, rear: 50, top: 40 },
      armourCE: { front: 1150, side: 300, rear: 70, top: 60 },
      standoff: 260,
    },
    turret: { rate: TUR.rate, elevRate: TUR.elevRate, elevMin: TUR.elevMin, elevMax: TUR.elevMax },
    // right is -X: commander and gunner right of the gun, loader left, driver centre front
    crew: [
      { seat: "commander", pos: [DM.cmdr[0], DM.turY + 0.6, DM.turZ + DM.cmdr[2]] },
      { seat: "gunner", pos: [-0.62, DM.turY + 0.2, DM.turZ + 0.55] },
      { seat: "loader", pos: [DM.loader[0], DM.turY + 0.3, DM.turZ + DM.loader[2]] },
      { seat: "driver", pos: [0, 1.05, 2.92] },
    ],
    passengers: 0,
    weapons: [
      /* 120 mm M256 L/44: M829A3 APFSDS (1,555 m/s, ~750 mm RHA at 2 km) at
         armour, M830A1 MPAT HEAT-MP (1,410 m/s) at everything else; 42
         rounds, 36 of them in the bustle behind the blast doors; a good
         loader keeps ~6-7 s a round. */
      { id: "m256_120mm", seat: "gunner", kind: "cannon", turret: true, rof: 0.15, needs: "loader", pen: 750, beh: 900,
        he: { pen: 480, beh: 700, blast: 9, power: 2.4 }, speed: 1555, heSpeed: 1410, grav: 9.8, range: 4000, minRange: 15, ammo: 42 },
      // coaxial M240C 7.62 mm, 10,800 rounds
      { id: "m240_coax", seat: "gunner", kind: "mg", wid: "lmg", turret: true, rof: 12, burst: 12, pause: 1.2, dmg: 22, pen: 9, range: 900, ammo: 10800 },
      // M2HB .50 on the CROWS, the commander's
      { id: "m2_50cal", seat: "commander", kind: "mg", wid: "lmg", turret: true, rof: 9, burst: 8, pause: 1.6, dmg: 38, pen: 24, range: 1800, ammo: 900 },
      /* the loader's M240 is modelled on its skate mount but not listed: a
         loader at his breech is not on his machine gun in a fight (the
         runtime fires a weapon only from a crewed seat) */
    ],
    /* TACTICS: what an MBT is for, for the AI layer (src/battle/ai/*) to read.
       standoff/engage are metres; a target class list is in priority order. */
    tactics: {
      role: "mbt",
      engage: { armour: 2500, soft: 1200, close: 18 },
      priorities: ["atgm", "vehicle", "launcher", "mg", "men", "beast"],
      hullDown: true,           // fight from behind a crest: only the turret shows
      faceThreat: true,         // keep the frontal arc (820/1150 mm) toward the strongest threat
      reverseOut: true,         // back out of a position under fire, never turn the side
      screen: { need: "men", ahead: 60, spread: 40 },   // infantry ahead in close terrain: towns, woods
      crush: true,              // men and beasts in the way are run down at speed
      buttonUp: "contact",      // commander's head goes in at the first shot or mark
    },
    build: function (ctx) {
      let b = null;
      try { b = build(ctx); } catch (e) { if (W.console) console.warn("[m1_abrams] build failed, using mil_armor:", e); b = null; }
      if (b) return b;
      const a = CBZ.milArmor;
      if (!a || !a.tank) return null;
      const t = a.tank();
      return { group: t.group, rig: t.group.userData.rig || null, footW: t.footW, footL: t.footL, height: t.height };
    },
  });
})();
