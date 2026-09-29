/* ============================================================
   race/race_car.js — THE CUP CAR. Body, wheels, suspension, cockpit,
   crumple, falling parts, and the shared FX pool for the whole field.

   WHAT IT IS: a modern "next gen" stock car of an invented series, at
   real scale. 4.92 m long body (4.97 with the splitter lip), 2.02 m over
   the fender flares, 1.29 m roof, 2.794 m wheelbase, 1.68 m track (wheel
   centres; tyre outer faces sit 7 mm inside the flares), 18 in single-lug
   wheels on 0.70 m slicks. The body is ONE lofted, welded shell built from
   station sections (profile functions of z: belt line, top line, plan
   width with fender flares, greenhouse tumblehome), not boxes. Wheel
   arches are cut by snapping the loft's vertices onto the arch circle;
   the side windows are real openings (no side glass, window net on the
   driver's LEFT); the windshield and rear window are faces of the same
   shell moved into a Lexan-tinted glass mesh, so they sit exactly flush.
   Headlights/taillights/grille are decals on the livery (stock cars run
   stickers, not lamps).

   COORDINATES (car local, same as the contract):
     origin on the ground between the axles on the centreline,
     +z forward, +y up, +x = the car's LEFT, -x = the car's RIGHT.
     Wheels FL, FR, RL, RR at (+-TRACK/2, R, +-WB/2): FL = (+0.84, 0.35, +1.397).

   POSE (handle.update applies it; the orchestrator never touches rotation):
     group.position    = car.pos
     group.rotation.order = 'YXZ'
     group.rotation.y  = car.yaw           (forward = (sin yaw, cos yaw))
     group.rotation.x  = -car.pitch        (car.pitch + = NOSE UP)
     group.rotation.z  = car.roll          (car.roll  + = LEFT side (+x) UP)
   The group must be a direct child of an untransformed scene/root (FX
   emission uses group.matrix as the world matrix).

   WHEELS (from car.wheels[i], i = FL, FR, RL, RR):
     spin     rad, rotation about the axle; increases rolling FORWARD
     steer    rad, + = toe to the LEFT (rotation.y), applied to every wheel
              (physics leaves rears at 0)
     compress m, + = wheel moved UP into the arch relative to the static
              ride (0 = static ride height, wheel centre y = 0.35)
     slip     0..1 tyre smoke; onGrass -> dust instead of smoke
     brakeHeat 0..1 disc glow (emissive only on the disc, per wheel)

   FX / DAMAGE READ FROM THE CAR:
     fx.backfire 0..1  flames out of the RIGHT-side exhaust (two pipes ahead of
                       the right rear wheel). A rising edge fires a burst.
     fx.sparks   0..1  spark rate; at the fresh impact point, else under the right sill
     fx.impact   {x,y,z,nx,nz,mag,part} WORLD point; mag = closing speed m/s.
                       A new object (or new values) = a new hit: spark burst,
                       and it picks WHERE the next crumple goes.
     damage.front/rear/left/right 0..1  crumple depth per zone (vertex
                       displacement of the shell, ~0.22 m at 1.0).
                       Parts fall off: splitter front>0.5, front bumper cover
                       front>0.8, spoiler rear>0.55 or aero>0.85, rear
                       bumper cover rear>0.8. They tumble in the world,
                       settle, fade after ~5 s.
     damage.engine 0..1  smoke from under the hood past 0.25.

   API (CBZ.race.car, and module.exports in node):
     build(THREE, {number, livery, player, quality:'low'|'high', fx, redline}) -> handle
       handle.group      THREE.Group (add it to the scene)
       handle.update(car, dt, camera, cockpitMode)   call every frame
       handle.eye        Object3D at the driver's eye (player only, else null)
       handle.setCockpit(bool)   lazily builds the cockpit; hides the lite
                         interior + driver; update() calls it from cockpitMode
       handle.setVisible(bool)
       handle.reset()    pristine car: un-crumple, reattach parts, clear timers
       handle.dispose()
       handle.livery     the descriptor used
       handle.stats()    {near:{meshes,tris}, far:{meshes,tris}}
     liveries(n)          -> n distinct livery descriptors (12 hand-made teams,
                             then deterministic variants)
     liveryFor(number, seed) -> descriptor, deterministic
     createFx(THREE, scene, {max}) -> fx   ONE shared pool for ALL cars:
       one THREE.Points, one draw call, premultiplied blending so smoke
       (alpha) and flames/sparks (additive) share it.
       fx.update(dt, camera, viewportHeightPx)   once per frame after the cars
       fx.clear(), fx.dispose(), fx.scene (falling parts are added here)
       Pass it to every build(): build(THREE, {..., fx}).
     DIMS                  the car's numbers.

   BUDGET: near car 16 meshes (player in cockpit 18), ~19k tris; far LOD
   (past ~60 m, hysteresis) 3 meshes, ~2.5k tris. Materials shared across
   the field except the per-car body material (livery atlas, <= 1024^2)
   and 4 tiny per-wheel disc-glow materials that share one program.
   update() allocates nothing (events like a part falling off clone one
   material, once).
============================================================ */
(function (root) {
  "use strict";

  // ---- the car's numbers -----------------------------------------------------
  const WB = 2.794, AXLE = WB / 2, TRACK = 1.68, R = 0.35, TYRE_W = 0.33;
  const Z_NOSE = 2.46, Z_TAIL = -2.46;
  const EYE = { x: 0.25, y: 0.975, z: -0.30 };
  const REDLINE = 9500;
  const ARCH_R = 0.415, ARCH_Y = R;
  const DIMS = { wheelbase: WB, track: TRACK, tyreR: R, tyreW: TYRE_W, length: 4.97, bodyLength: 4.92,
    width: 2.024, height: 1.29, eye: EYE, seatX: 0.25, exhaust: { x: -1.0, y: 0.2, z: -0.68 } };

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const sstep = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
  function hash(n) { n = (n ^ 61) ^ (n >>> 16); n = n + (n << 3); n = n ^ (n >>> 4); n = Math.imul(n, 0x27d4eb2d); n = n ^ (n >>> 15); return (n >>> 0) / 4294967296; }

  /* Hermite through knots [[z,v],...] ascending z (Catmull-Rom tangents). */
  function spline(kn) {
    const n = kn.length;
    return function (z) {
      if (z <= kn[0][0]) return kn[0][1];
      if (z >= kn[n - 1][0]) return kn[n - 1][1];
      let i = 0; while (z > kn[i + 1][0]) i++;
      const p0 = kn[Math.max(0, i - 1)], p1 = kn[i], p2 = kn[i + 1], p3 = kn[Math.min(n - 1, i + 2)];
      const h = p2[0] - p1[0], t = (z - p1[0]) / h;
      const m1 = (p2[1] - p0[1]) / (p2[0] - p0[0]) * h, m2 = (p3[1] - p1[1]) / (p3[0] - p1[0]) * h;
      const t2 = t * t, t3 = t2 * t;
      return (2 * t3 - 3 * t2 + 1) * p1[1] + (t3 - 2 * t2 + t) * m1 + (-2 * t3 + 3 * t2) * p2[1] + (t3 - t2) * m2;
    };
  }

  // ---- the body lines (side view, metres) -----------------------------------
  // belt / shoulder crown height
  const beltY = spline([[-2.46, 0.99], [-1.8, 0.985], [-1.4, 0.955], [-0.9, 0.905], [0.0, 0.875], [0.72, 0.855],
    [1.4, 0.82], [2.0, 0.745], [2.3, 0.668], [2.46, 0.60]]);
  // top centreline: nose, hood, windshield, roof, fastback, deck
  const topY = spline([[-2.46, 1.012], [-2.1, 1.005], [-1.78, 1.008], [-1.5, 1.07], [-1.2, 1.17], [-0.92, 1.262],
    [-0.35, 1.29], [0.02, 1.274], [0.12, 1.238], [0.40, 1.06], [0.72, 0.88], [0.9, 0.868], [1.4, 0.843],
    [2.0, 0.772], [2.3, 0.692], [2.46, 0.625]]);
  function floorY(z) {
    if (z < -1.9) return 0.10 + (-1.9 - z) / 0.56 * 0.14;           // diffuser ramp
    if (z > 2.2) return 0.10 + (z - 2.2) * 0.1;
    return 0.10;
  }
  function bump(d) { return Math.abs(d) < 0.6 ? Math.pow(Math.cos(Math.PI * d / 1.2), 2) : 0; }
  function cornerInset(z) {
    if (z > 2.12) { const rc = 0.34, d = z - 2.12; return rc - Math.sqrt(Math.max(0, rc * rc - d * d)); }
    if (z < -2.26) { const rc = 0.20, d = -2.26 - z; return rc - Math.sqrt(Math.max(0, rc * rc - d * d)); }
    return 0;
  }
  function heightScale(z) {
    if (z > 2.30) return 1 - 0.55 * Math.pow((z - 2.30) / 0.16, 1.6);
    if (z < -2.36) return 1 - 0.08 * ((-2.36 - z) / 0.10);
    return 1;
  }
  function greenT(z) { return sstep((topY(z) - beltY(z) - 0.03) / 0.33); }

  const K = 12, RING = 2 * K;       // half profile p0..p12, full ring 24 unique points

  /* Half section at station z: 13 [x,y] from the bottom centre round the
     LEFT side to the top centre. Bands (quad between p[b] and p[b+1]):
     0-2 floor/sill, 3 skirt, 4-6 flank, 7 shoulder, 8 side glass (the
     opening), 9 roof rail / A-pillar, 10-11 roof, hood, windshield. */
  function profile(z) {
    const bF = bump(z - AXLE), bR = bump(z + AXLE);
    const Ws = 0.972 + 0.040 * (bF + bR);
    const Wsh = Ws - 0.055 + 0.015 * (bF + bR);
    const Wb = Ws - 0.03;
    const F = floorY(z), B = beltY(z), T = topY(z), t = greenT(z);
    const p = [
      [0, F], [Wb - 0.12, F], [Wb - 0.03, F + 0.012], [Wb, F + 0.06],
      [Ws - 0.004, Math.max(0.28, F + 0.10)], [Ws, Math.max(0.46, F + 0.24)],
      [lerp(Ws, Wsh, 0.55), lerp(Math.max(0.46, F + 0.24), B, 0.62)], [Wsh, B - 0.004],
      [lerp(Wsh - 0.07, 0.845, t), lerp(B + 0.004, B + 0.015, t)],
      [lerp(Wsh - 0.14, 0.635, t), lerp(B + 0.010, T - 0.075, t)],
      [lerp(Wsh - 0.24, 0.585, t), lerp(lerp(B, T, 0.5), T - 0.018, t)],
      [lerp(Wsh * 0.42, 0.31, t), lerp(lerp(B, T, 0.88), T - 0.004, t)],
      [0, T],
    ];
    const ins = cornerInset(z), sc = (Ws - ins) / Ws, h = heightScale(z);
    for (let i = 0; i < p.length; i++) {
      p[i][0] *= sc;
      if (i > 1) p[i][1] = F + (p[i][1] - F) * h;
    }
    return p;
  }

  function stationZs(step) {
    const zs = [-2.46, -2.43, -2.40, -2.36];
    const n = Math.round(4.6 / step);
    for (let i = 0; i <= n; i++) zs.push(+(-2.30 + i * 4.6 / n).toFixed(4));
    zs.push(2.34, 2.38, 2.42, 2.46);
    return zs;
  }

  // ---- UV atlas (1024 logical px; see drawLivery) -----------------------------
  // rows: left side 0-266, right side 266-532, top 532-940, dark 940-950,
  // front 950-1022 (x 0-512), rear 950-1022 (x 512-1024)
  const A = 1024;
  function uvFor(region, x, y, z, out) {
    let px, py;
    switch (region) {
      case 0: px = (2.5 - z) / 5 * A; py = (1.3 - y) / 1.3 * 266; break;                 // left side
      case 1: px = (z + 2.5) / 5 * A; py = 266 + (1.3 - y) / 1.3 * 266; break;           // right side
      case 2: px = (z + 2.5) / 5 * A; py = 532 + (1.02 - x) / 2.04 * 408; break;         // top
      case 3: px = (x + 1.02) / 2.04 * 512; py = 950 + clamp((0.75 - y) / 0.75, 0, 1) * 72; break; // front
      case 4: px = 512 + (1.02 - x) / 2.04 * 512; py = 950 + clamp((1.1 - y) / 1.1, 0, 1) * 72; break; // rear
      default: px = 512; py = 945;                                                          // dark patch
    }
    out[0] = px / A; out[1] = 1 - py / A;
  }

  // ---- shared caches per THREE instance ------------------------------------------
  function shared(THREE) {
    if (THREE.__raceCar) return THREE.__raceCar;
    const S = THREE.__raceCar = { geos: {}, mats: {} };
    S.mats.trim = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.25, side: THREE.DoubleSide });
    S.mats.wheel = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0.2, side: THREE.DoubleSide });
    S.mats.glass = new THREE.MeshStandardMaterial({ color: col(THREE, 0x10161d), roughness: 0.04, metalness: 0.7,
      transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide });
    S.mats.glass.userData.shared = true;
    return S;
  }
  function col(THREE, hex) { return new THREE.Color(hex).convertSRGBToLinear(); }

  // ---- a tiny merge accumulator (vertex colours, optional glow attribute) ------------
  function Acc(THREE, glow) {
    this.T = THREE; this.p = []; this.n = []; this.c = []; this.i = []; this.g = glow ? [] : null;
    this._v = new THREE.Vector3(); this._nm = new THREE.Matrix3(); this._c = new THREE.Color();
  }
  Acc.prototype.add = function (geo, m, hex, glow) {
    const P = geo.attributes.position, N = geo.attributes.normal, base = this.p.length / 3, v = this._v;
    this._nm.getNormalMatrix(m);
    const c = this._c.setHex(hex).convertSRGBToLinear();
    for (let k = 0; k < P.count; k++) {
      v.fromBufferAttribute(P, k).applyMatrix4(m); this.p.push(v.x, v.y, v.z);
      v.fromBufferAttribute(N, k).applyMatrix3(this._nm).normalize(); this.n.push(v.x, v.y, v.z);
      this.c.push(c.r, c.g, c.b);
      if (this.g) this.g.push(glow ? 1 : 0);
    }
    const flip = m.determinant() < 0;
    const idx = geo.index ? geo.index.array : null, cnt = idx ? idx.length : P.count;
    for (let k = 0; k < cnt; k += 3) {
      const a = idx ? idx[k] : k, b = idx ? idx[k + 1] : k + 1, d = idx ? idx[k + 2] : k + 2;
      if (flip) this.i.push(base + a, base + d, base + b); else this.i.push(base + a, base + b, base + d);
    }
    return this;
  };
  Acc.prototype.build = function () {
    const T = this.T, g = new T.BufferGeometry();
    g.setAttribute("position", new T.Float32BufferAttribute(this.p, 3));
    g.setAttribute("normal", new T.Float32BufferAttribute(this.n, 3));
    g.setAttribute("color", new T.Float32BufferAttribute(this.c, 3));
    if (this.g) g.setAttribute("glow", new T.Float32BufferAttribute(this.g, 1));
    g.setIndex(this.i);
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  };

  /* primitive kit bound to one Acc */
  function Kit(THREE, acc) {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(),
      s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), d = new THREE.Vector3();
    const prim = (THREE.__raceCarPrim = THREE.__raceCarPrim || {});
    const get = (key, mk) => prim[key] || (prim[key] = mk());
    const kit = {
      acc, m,
      mat(px, py, pz, rx, ry, rz, sx, sy, sz) {
        e.set(rx || 0, ry || 0, rz || 0, "YXZ"); q.setFromEuler(e); p.set(px, py, pz); s.set(sx == null ? 1 : sx, sy == null ? 1 : sy, sz == null ? 1 : sz);
        return m.compose(p, q, s);
      },
      box(cx, cy, cz, sx, sy, sz, hex, rx, ry, rz, glow) {
        acc.add(get("box", () => new THREE.BoxGeometry(1, 1, 1)), kit.mat(cx, cy, cz, rx, ry, rz, sx, sy, sz), hex, glow);
      },
      cylX(cx, cy, cz, r, len, hex, seg, glow) {    // axis along x
        const g = get("cyl" + (seg || 12), () => new THREE.CylinderGeometry(1, 1, 1, seg || 12, 1, false));
        acc.add(g, kit.mat(cx, cy, cz, 0, 0, Math.PI / 2, r, len, r), hex, glow);
      },
      cyl(cx, cy, cz, r, len, hex, seg, rx, ry, rz) {
        const g = get("cyl" + (seg || 12), () => new THREE.CylinderGeometry(1, 1, 1, seg || 12, 1, false));
        acc.add(g, kit.mat(cx, cy, cz, rx, ry, rz, r, len, r), hex);
      },
      sphere(cx, cy, cz, rx_, ry_, rz_, hex, seg) {
        const g = get("sph" + (seg || 8), () => new THREE.SphereGeometry(1, seg || 8, Math.max(4, (seg || 8) >> 1)));
        acc.add(g, kit.mat(cx, cy, cz, 0, 0, 0, rx_, ry_, rz_), hex);
      },
      tube(a, b, r, hex, seg) {
        d.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]); const len = d.length(); if (len < 1e-5) return;
        d.multiplyScalar(1 / len); q.setFromUnitVectors(up, d);
        p.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2); s.set(r, len, r);
        const g = get("tube" + (seg || 6), () => new THREE.CylinderGeometry(1, 1, 1, seg || 6, 1, true));
        acc.add(g, m.compose(p, q, s), hex);
      },
      poly(pts, r, hex, seg, joints) {
        for (let k = 0; k + 1 < pts.length; k++) kit.tube(pts[k], pts[k + 1], r, hex, seg);
        if (joints !== false) for (let k = 1; k + 1 < pts.length; k++) kit.sphere(pts[k][0], pts[k][1], pts[k][2], r, r, r, hex, 6);
      },
      /* a flat polygon in the (a,b) plane extruded along the third axis.
         plane: 'zy' = side-view shape extruded along x; 'xz' = plan shape extruded along y */
      slab(poly, plane, c0, c1, hex) {
        const shape = new THREE.Shape(); poly.forEach((pt, k) => (k ? shape.lineTo(pt[0], pt[1]) : shape.moveTo(pt[0], pt[1])));
        const g = new THREE.ExtrudeGeometry(shape, { depth: c1 - c0, bevelEnabled: false, curveSegments: 4 });
        // shape x->a, y->b, depth->+z
        if (plane === "zy") acc.add(g, m.set(0, 0, 1, c0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1), hex);          // x=depth, y=b, z=a
        else acc.add(g, m.set(1, 0, 0, 0, 0, 0, 1, c0, 0, 1, 0, 0, 0, 0, 0, 1), hex);                       // x=a, y=depth, z=b
        g.dispose();
      },
    };
    return kit;
  }

  /* mirror a geometry across x = 0 (right-side copies of left-side parts) */
  function mirrorX(THREE, geo) {
    const g = geo.clone(), P = g.attributes.position, N = g.attributes.normal;
    for (let k = 0; k < P.count; k++) { P.setX(k, -P.getX(k)); N.setX(k, -N.getX(k)); }
    const I = g.index.array;
    for (let k = 0; k < I.length; k += 3) { const t = I[k + 1]; I[k + 1] = I[k + 2]; I[k + 2] = t; }
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }

  // ---- THE SHELL: grid + classified quads ----------------------------------------------
  /* Returns the loft grid (rest positions, snapped arches) and a quad list.
     Grid index = i*RING + j; two extra slots for the nose and tail cap centres. */
  function loftGrid(step) {
    const zs = stationZs(step), NS = zs.length, NG = NS * RING + 2;
    const P = new Float32Array(NG * 3), band = new Int8Array(NG);
    for (let i = 0; i < NS; i++) {
      const z = zs[i], pr = profile(z);
      for (let j = 0; j < RING; j++) {
        const h = j <= K ? j : RING - j, sgn = j <= K ? 1 : -1, g = (i * RING + j) * 3;
        P[g] = pr[h][0] * sgn; P[g + 1] = pr[h][1]; P[g + 2] = z; band[i * RING + j] = h;
      }
    }
    // wheel arches: side vertices inside the arch circle move onto it
    for (let gi = 0; gi < NS * RING; gi++) {
      const g = gi * 3, x = P[g], y = P[g + 1], z = P[g + 2], h = band[gi];
      if (Math.abs(x) < 0.55 || h < 2 || h > 7) continue;
      for (const ax of [AXLE, -AXLE]) {
        const dz = z - ax, dy = y - ARCH_Y, d = Math.hypot(dz, dy);
        if (d >= ARCH_R) continue;
        if (dy < 0) {                       // below the axle line: push fore/aft
          const zz = Math.sqrt(Math.max(0, ARCH_R * ARCH_R - dy * dy));
          P[g + 2] = ax + (dz >= 0 ? zz : -zz);
        } else {                            // radial onto the arch
          const k = ARCH_R / Math.max(d, 1e-4);
          P[g + 1] = ARCH_Y + dy * k; P[g + 2] = ax + dz * k;
        }
      }
    }
    // cap centres
    for (const [slot, i] of [[NS * RING, NS - 1], [NS * RING + 1, 0]]) {
      let sx = 0, sy = 0, sz = 0;
      for (let j = 0; j < RING; j++) { const g = (i * RING + j) * 3; sx += P[g]; sy += P[g + 1]; sz += P[g + 2]; }
      P[slot * 3] = sx / RING * 0; P[slot * 3 + 1] = sy / RING; P[slot * 3 + 2] = sz / RING;
    }
    return { zs, NS, NG, P, band };
  }

  function inArch(x, y, z) {
    if (Math.abs(x) < 0.5) return false;
    for (const ax of [AXLE, -AXLE]) if (Math.hypot(z - ax, y - ARCH_Y) < ARCH_R - 0.004) return true;
    return false;
  }

  /* Build quad list for a given set of stations/ring indices (full: all; far: subsampled).
     kind: 0 body, 1 front cover, 2 rear cover, 3 glass, 4 opening (skip in near, dark in far), -1 drop */
  function quads(G, sts, ringKeep, far) {
    const out = [], P = G.P;
    const rk = ringKeep, nr = rk.length;
    const v = (i, j) => (i * RING + j);
    const cx = (a) => P[a * 3], cy = (a) => P[a * 3 + 1], cz = (a) => P[a * 3 + 2];
    for (let si = 0; si + 1 < sts.length; si++) {
      const i0 = sts[si], i1 = sts[si + 1];
      for (let r = 0; r < nr; r++) {
        const j0 = rk[r], j1 = rk[(r + 1) % nr];
        const a = v(i0, j0), b = v(i0, j1), c = v(i1, j1), d = v(i1, j0);
        const mx = (cx(a) + cx(b) + cx(c) + cx(d)) / 4, my = (cy(a) + cy(b) + cy(c) + cy(d)) / 4, mz = (cz(a) + cz(b) + cz(c) + cz(d)) / 4;
        const bnd = j0 < K ? G.band[a] : G.band[b]; // lower profile index of the pair
        let kind = 0;
        // area check (collapsed arch quads)
        const e1x = cx(c) - cx(a), e1y = cy(c) - cy(a), e1z = cz(c) - cz(a), e2x = cx(b) - cx(d), e2y = cy(b) - cy(d), e2z = cz(b) - cz(d);
        const nx = e2y * e1z - e2z * e1y, ny = e2z * e1x - e2x * e1z, nz = e2x * e1y - e2y * e1x;
        const area = Math.hypot(nx, ny, nz);
        if (area < 1e-6) continue;
        if (inArch(mx, my, mz)) continue;
        const nearAxle = Math.abs(Math.abs(mz) - AXLE) < ARCH_R;
        if (bnd <= 2 && nearAxle && Math.abs(mx) > 0.5) continue;       // floor under the tyre
        const tz = greenT(mz);
        if (bnd >= 10 && ((mz > 0.10 && mz < 0.70) || (mz > -1.74 && mz < -0.98)) && tz > 0.08) kind = 3;
        else if (bnd === 8 && mz > -0.84 && mz < 0.50 && tz > 0.3) kind = 4;
        else if (mz > 1.98 && my < 0.60) kind = 1;
        else if (mz < -2.0 && my < 0.95) kind = 2;
        let region;
        const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
        if (ay > Math.max(ax, az) * 0.9) region = ny > 0 ? 2 : 5;
        else if (ax >= az) region = nx > 0 ? 0 : 1;
        else region = nz > 0 ? 3 : 4;
        if (far && (kind === 3 || kind === 4)) region = 5;
        out.push({ a, b, c, d, kind, region });
      }
    }
    return out;
  }

  /* Body mesh set: geometry per kind with gidx maps for deformation. */
  function buildShell(THREE, G, step, far) {
    const NS = G.NS;
    let sts = [], ring = [];
    if (!far) { for (let i = 0; i < NS; i++) sts.push(i); for (let j = 0; j < RING; j++) ring.push(j); }
    else {
      for (let i = 0; i < NS; i += 3) sts.push(i); if (sts[sts.length - 1] !== NS - 1) sts.push(NS - 1);
      const keep = [0, 2, 3, 5, 7, 8, 9, 10, 12];
      for (const h of keep) ring.push(h);
      for (let k = keep.length - 2; k >= 1; k--) ring.push(RING - keep[k]);
    }
    const Q = quads(G, sts, ring, far);
    const kinds = far ? [0] : [0, 1, 2, 3];
    const bufs = {}; kinds.forEach((k) => (bufs[k] = { p: [], uv: [], g: [], fixed: [], i: [], n: [] }));
    const uv = [0, 0], P = G.P;
    function vert(B, gi, region, fixedN) {
      const x = P[gi * 3], y = P[gi * 3 + 1], z = P[gi * 3 + 2];
      B.p.push(x, y, z); uvFor(region, x, y, z, uv); B.uv.push(uv[0], uv[1]); B.g.push(gi);
      B.fixed.push(fixedN ? 1 : 0); B.n.push(0, fixedN || 0, 0);
      return B.p.length / 3 - 1;
    }
    for (const q of Q) {
      if (!far && q.kind === 4) continue;
      const B = bufs[far ? 0 : q.kind];
      const va = vert(B, q.a, q.region), vb = vert(B, q.b, q.region), vc = vert(B, q.c, q.region), vd = vert(B, q.d, q.region);
      B.i.push(va, vb, vc, va, vc, vd);
    }
    // caps: nose (last station, faces +z) and tail (first station, faces -z)
    for (const [ci, st, dir] of [[NS * RING, NS - 1, 1], [NS * RING + 1, 0, -1]]) {
      const B = bufs[far ? 0 : dir > 0 ? 1 : 2], region = dir > 0 ? 3 : 4;
      const c0 = vert(B, ci, region, dir);
      const ringSt = far ? ring : ring;
      const vs = ringSt.map((j) => vert(B, st * RING + j, region, dir));
      for (let k = 0; k < vs.length; k++) {
        const k1 = (k + 1) % vs.length;
        if (dir > 0) B.i.push(c0, vs[k], vs[k1]); else B.i.push(c0, vs[k1], vs[k]);
      }
    }
    const out = {};
    for (const k of kinds) {
      const B = bufs[k], g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(B.p, 3));
      g.setAttribute("normal", new THREE.Float32BufferAttribute(B.n, 3));
      g.setAttribute("uv", new THREE.Float32BufferAttribute(B.uv, 2));
      g.setIndex(B.i);
      g.userData.gidx = Uint32Array.from(B.g);
      g.userData.fixed = Int8Array.from(B.n.filter((_, n) => n % 3 === 1));
      out[k] = g;
    }
    return out;
  }

  /* Grid normals by central differences (ring wraps, stations clamp). */
  function gridNormals(G, pos, N) {
    const NS = G.NS;
    for (let i = 0; i < NS; i++) {
      const ip = Math.min(NS - 1, i + 1), im = Math.max(0, i - 1);
      for (let j = 0; j < RING; j++) {
        const jp = (j + 1) % RING, jm = (j + RING - 1) % RING;
        const a = (i * RING + jp) * 3, b = (i * RING + jm) * 3, c = (ip * RING + j) * 3, d = (im * RING + j) * 3;
        const ux = pos[a] - pos[b], uy = pos[a + 1] - pos[b + 1], uz = pos[a + 2] - pos[b + 2];
        const vx = pos[c] - pos[d], vy = pos[c + 1] - pos[d + 1], vz = pos[c + 2] - pos[d + 2];
        let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const l = Math.hypot(nx, ny, nz) || 1;
        const g = (i * RING + j) * 3; N[g] = nx / l; N[g + 1] = ny / l; N[g + 2] = nz / l;
      }
    }
  }

  function writeShell(geo, pos, N) {
    const gidx = geo.userData.gidx, fixed = geo.userData.fixed;
    const P = geo.attributes.position.array, NN = geo.attributes.normal.array;
    for (let k = 0; k < gidx.length; k++) {
      const g = gidx[k] * 3, o = k * 3;
      P[o] = pos[g]; P[o + 1] = pos[g + 1]; P[o + 2] = pos[g + 2];
      if (fixed[k]) { NN[o] = 0; NN[o + 1] = 0.24; NN[o + 2] = 0.97 * fixed[k]; }
      else { NN[o] = N[g]; NN[o + 1] = N[g + 1]; NN[o + 2] = N[g + 2]; }
    }
    geo.attributes.position.needsUpdate = true; geo.attributes.normal.needsUpdate = true;
  }

  // ---- wheels, hubs, suspension (shared) -------------------------------------------------
  function tyreProfile(lo) {
    const pts = lo
      ? [[0.232, -0.13], [0.30, -0.165], [0.35, -0.13], [0.35, 0.13], [0.30, 0.165], [0.232, 0.13]]
      : [[0.232, -0.128], [0.258, -0.152], [0.285, -0.163], [0.312, -0.165], [0.333, -0.160], [0.345, -0.148],
        [0.350, -0.125], [0.3505, -0.06], [0.3505, 0.06], [0.350, 0.125], [0.345, 0.148], [0.333, 0.160],
        [0.312, 0.165], [0.285, 0.163], [0.258, 0.152], [0.232, 0.128]];
    return pts;
  }
  /* left wheel: axle along x, outer face +x. Tyre + rim + nut, vertex coloured. */
  function wheelGeo(THREE, lo) {
    const acc = new Acc(THREE), kit = Kit(THREE, acc);
    const lathe = new THREE.LatheGeometry(tyreProfile(lo).map((p) => new THREE.Vector2(p[0], p[1])), lo ? 12 : 36);
    // lathe axis y -> x (rotation z by -90: y->x)
    acc.add(lathe, kit.mat(0, 0, 0, 0, 0, -Math.PI / 2), 0x2b2b2d); lathe.dispose();
    if (lo) {
      const disc = new THREE.CircleGeometry(0.232, 10);
      acc.add(disc, kit.mat(0.11, 0, 0, 0, Math.PI / 2, 0), 0x25272b); disc.dispose();
      return acc.build();
    }
    const barrel = new THREE.CylinderGeometry(0.226, 0.226, 0.25, 32, 1, true);
    acc.add(barrel, kit.mat(-0.005, 0, 0, 0, 0, Math.PI / 2), 0x303338); barrel.dispose();
    const lip = new THREE.TorusGeometry(0.229, 0.009, 4, 32);
    acc.add(lip, kit.mat(0.122, 0, 0, 0, Math.PI / 2, 0), 0x3a3d43); lip.dispose();
    // dish: a cone from the spoke roots to the lip
    const dish = new THREE.CylinderGeometry(0.075, 0.222, 0.05, 20, 1, true);
    acc.add(dish, kit.mat(0.1, 0, 0, 0, 0, -Math.PI / 2), 0x26282c); dish.dispose();
    for (let s = 0; s < 5; s++) {
      const a = s * Math.PI * 2 / 5;
      const r0 = 0.145, y = Math.cos(a) * r0, z = Math.sin(a) * r0;
      kit.box(0.098, y, z, 0.028, 0.155, 0.05, 0x2d3035, a, 0, 0);
      kit.box(0.10, Math.cos(a) * 0.145, Math.sin(a) * 0.145, 0.03, 0.15, 0.016, 0x3a3e45, a, 0, 0);
    }
    kit.cylX(0.105, 0, 0, 0.075, 0.03, 0x2a2c30, 20);
    kit.cylX(0.132, 0, 0, 0.045, 0.045, 0xd6a21a, 6);          // single centre lug nut
    kit.cylX(0.157, 0, 0, 0.018, 0.012, 0x8a8f96, 8);
    return acc.build();
  }
  /* upright + brake disc (glow attr) + caliper. Left side. */
  function hubGeo(THREE) {
    const acc = new Acc(THREE, true), kit = Kit(THREE, acc);
    kit.cylX(-0.02, 0, 0, 0.19, 0.032, 0x55575c, 28, true);          // disc
    kit.cylX(-0.02, 0, 0, 0.11, 0.05, 0x2c2e31, 16);                  // hat
    // caliper at the rear-top of the disc
    const ang = Math.PI * 0.75, cy = Math.sin(ang) * 0.172, cz = Math.cos(ang) * 0.172;
    kit.box(-0.02, cy, cz, 0.075, 0.075, 0.17, 0xb8321f, -(ang - Math.PI / 2), 0, 0);
    kit.box(-0.02, cy * 1.08, cz * 1.08, 0.08, 0.02, 0.12, 0xe5e5e5, -(ang - Math.PI / 2), 0, 0);
    kit.box(-0.095, 0.02, 0, 0.05, 0.36, 0.08, 0x3b3e43);             // upright
    kit.cylX(-0.05, 0, 0, 0.045, 0.06, 0x6c7077, 10);                 // stub
    return acc.build();
  }
  function suspGeo(THREE) {
    const acc = new Acc(THREE), kit = Kit(THREE, acc);
    for (const sx of [1, -1]) for (const sz of [1, -1]) {
      const wx = sx * TRACK / 2, wz = sz * AXLE, ix = sx * 0.40, ox = sx * 0.74;
      const armC = 0x1d1f22;
      kit.poly([[ix, 0.17, wz + 0.2], [ox, 0.18, wz], [ix, 0.17, wz - 0.2]], 0.016, armC, 6);          // lower A-arm
      kit.poly([[ix + sx * 0.06, 0.52, wz + 0.16], [ox - sx * 0.02, 0.53, wz], [ix + sx * 0.06, 0.52, wz - 0.16]], 0.013, armC, 6); // upper
      kit.tube([ix + sx * 0.02, 0.26, wz - 0.12], [ox - sx * 0.04, 0.26, wz - 0.11], 0.01, 0x55585e, 5); // toe link
      // coilover: lower arm -> chassis tower
      const a = [wx - sx * 0.22, 0.2, wz + sz * 0.03], b = [wx - sx * 0.36, 0.7, wz + sz * 0.03];
      kit.tube(a, [lerp(a[0], b[0], 0.55), lerp(a[1], b[1], 0.55), a[2]], 0.022, 0xa8adb4, 8);
      kit.tube([lerp(a[0], b[0], 0.5), lerp(a[1], b[1], 0.5), a[2]], b, 0.012, 0xd8dbe0, 6);
      const turns = 7, segs = 42, pts = [];
      for (let k = 0; k <= segs; k++) {
        const t = k / segs, th = t * turns * Math.PI * 2, rr = 0.042;
        const cx = lerp(a[0], b[0], 0.1 + t * 0.8), cy = lerp(a[1], b[1], 0.1 + t * 0.8);
        // coil around the (tilted) damper axis: approximate with x/z offsets
        pts.push([cx + Math.cos(th) * rr, cy + Math.cos(th) * rr * 0.28, a[2] + Math.sin(th) * rr]);
      }
      kit.poly(pts, 0.0075, 0xe0a81c, 5, false);
      kit.box(wx - sx * 0.36, 0.72, wz + sz * 0.03, 0.08, 0.02, 0.08, 0x2a2c30);    // tower cap
    }
    // sway bar front
    kit.poly([[0.55, 0.3, AXLE + 0.28], [0.3, 0.3, AXLE + 0.34], [-0.3, 0.3, AXLE + 0.34], [-0.55, 0.3, AXLE + 0.28]], 0.012, 0x1a1c1f, 6);
    return acc.build();
  }

  /* trim: everything dark/grey that neither moves nor falls off */
  function trimGeo(THREE, lo) {
    const acc = new Acc(THREE), kit = Kit(THREE, acc), T = THREE;
    const liner = 0x121314;
    // wheel well liners + inner walls
    for (const sx of [1, -1]) for (const sz of [1, -1]) {
      const cylg = new T.CylinderGeometry(ARCH_R + 0.01, ARCH_R + 0.01, 0.40, lo ? 8 : 16, 1, true, -0.25, Math.PI + 0.5);
      acc.add(cylg, kit.mat(sx * 0.80, ARCH_Y, sz * AXLE, 0, 0, Math.PI / 2), liner); cylg.dispose();
      const wall = new T.CircleGeometry(ARCH_R + 0.01, lo ? 8 : 16, -0.25, Math.PI + 0.5);
      acc.add(wall, kit.mat(sx * 0.60, ARCH_Y, sz * AXLE, 0, Math.PI / 2, 0), liner); wall.dispose();
    }
    // crash structure + radiator behind the front cover, fuel cell box behind the rear cover
    kit.box(0, 0.33, 2.12, 1.3, 0.38, 0.14, 0x1b1d20);
    kit.box(0, 0.36, 2.02, 1.1, 0.42, 0.06, 0x3a3f46);
    kit.box(0, 0.45, -2.05, 1.2, 0.4, 0.5, 0x202225);
    if (!lo) {
      // diffuser strakes
      for (const x of [-0.62, -0.31, 0, 0.31, 0.62]) {
        kit.slab([[-2.47, 0.24], [-1.92, 0.10], [-1.92, 0.085], [-2.47, 0.085]], "zy", x - 0.006, x + 0.006, 0x111214);
      }
      // exhaust: two pipes out of the RIGHT sill ahead of the right rear wheel
      for (const z of [-0.62, -0.75]) {
        kit.cylX(-0.95, 0.21, z, 0.048, 0.11, 0x3d3f43, 14);
        kit.cylX(-1.0, 0.21, z, 0.052, 0.012, 0x7a6a58, 14);
        kit.cylX(-1.0, 0.21, z, 0.036, 0.016, 0x050505, 10);
      }
      // hood pins + deck pins (steel), tow hooks (orange)
      for (const [x, z] of [[0.52, 2.1], [-0.52, 2.1], [0.58, -2.28], [-0.58, -2.28]]) {
        const y = topY(z) + (z > 0 ? -0.008 : -0.006) - 0.01 * Math.abs(x);
        kit.cyl(x, y + 0.004, z, 0.022, 0.012, 0xc9ccd1, 10);
        kit.cyl(x, y + 0.012, z, 0.006, 0.02, 0xe8e8e8, 6);
      }
      const hook = new T.TorusGeometry(0.035, 0.009, 5, 10, Math.PI);
      acc.add(hook, kit.mat(-0.32, 0.17, 2.475, 0, 0, Math.PI), 0xff6a13);
      acc.add(hook, kit.mat(-0.42, 0.3, -2.475, 0, 0, Math.PI), 0xff6a13); hook.dispose();
      // NACA duct lips on the roof (driver side cool-air)
      kit.box(0.34, topY(-0.1) - 0.006, -0.1, 0.1, 0.012, 0.18, 0x0e0f10, 0.02, 0, 0);
    }
    return acc.build();
  }
  function splitterGeo(THREE) {
    const acc = new Acc(THREE), kit = Kit(THREE, acc);
    const plan = [[-0.90, 2.05], [0.90, 2.05], [0.90, 2.40], [0.78, 2.50], [-0.78, 2.50], [-0.90, 2.40]];
    kit.slab(plan.map((p) => [p[0], p[1]]), "xz", 0.062, 0.082, 0x141516);
    kit.box(0, 0.105, 2.435, 1.5, 0.05, 0.012, 0x0f1011);                    // air dam
    for (const x of [-0.5, 0.5]) kit.box(x, 0.1, 2.3, 0.012, 0.04, 0.3, 0x2a2c30);
    return acc.build();
  }
  function spoilerGeo(THREE) {
    const acc = new Acc(THREE), kit = Kit(THREE, acc);
    const y0 = topY(-2.4) - 0.01;
    kit.box(0, y0 + 0.055, -2.41, 1.84, 0.11, 0.012, 0x17181b, -0.18, 0, 0);    // blade, leans back
    for (const sx of [1, -1]) {
      kit.slab([[-2.46, y0 - 0.02], [-2.10, y0 - 0.02], [-2.44, y0 + 0.125]], "zy", sx * 0.925 - 0.005, sx * 0.925 + 0.005, 0x1d1e21);
    }
    for (const x of [-0.45, 0, 0.45]) kit.box(x, y0 + 0.03, -2.43, 0.012, 0.05, 0.05, 0x2a2c30);
    return acc.build();
  }
  function farWheelsGeo(THREE) {
    const one = wheelGeo(THREE, true), oneR = mirrorX(THREE, one), acc = new Acc(THREE), kit = Kit(THREE, acc);
    for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) acc.add(sx > 0 ? one : oneR, kit.mat(sx * TRACK / 2, R, sz * AXLE), 0xffffff);
    // vertex colours were already baked; Acc overwrote them with white -> rebuild colours from source
    const g = acc.build(), src = one.attributes.color.array, C = g.attributes.color.array, n = src.length;
    for (let k = 0; k < C.length; k++) C[k] = src[k % n];
    one.dispose(); oneR.dispose();
    return g;
  }
  function farTrimGeo(THREE) {
    const acc = new Acc(THREE), kit = Kit(THREE, acc);
    const y0 = topY(-2.4) - 0.01;
    kit.box(0, y0 + 0.055, -2.41, 1.84, 0.11, 0.015, 0x17181b, -0.18, 0, 0);
    kit.box(0, 0.072, 2.28, 1.8, 0.02, 0.44, 0x141516);
    for (const sx of [1, -1]) for (const sz of [1, -1]) {
      const cylg = new THREE.CylinderGeometry(ARCH_R, ARCH_R, 0.40, 6, 1, true, -0.25, Math.PI + 0.5);
      acc.add(cylg, kit.mat(sx * 0.80, ARCH_Y, sz * AXLE, 0, 0, Math.PI / 2), 0x121314); cylg.dispose();
    }
    return acc.build();
  }

  // ---- interiors ------------------------------------------------------------------------
  const CAGE = 0x6f7379, CAGE_D = 0x55595f;
  function cage(kit, dense) {
    const r = dense ? 0.021 : 0.024, seg = dense ? 8 : 5;
    const hz = -0.74, fz = 0.02;
    // main hoop
    kit.poly([[0.80, 0.16, hz], [0.72, 0.9, hz], [0.56, 1.22, hz], [-0.56, 1.22, hz], [-0.72, 0.9, hz], [-0.80, 0.16, hz]], r, CAGE, seg);
    // halo + A-pillars to the floor
    for (const sx of [1, -1]) {
      kit.poly([[sx * 0.56, 1.22, hz], [sx * 0.57, 1.235, fz], [sx * 0.76, 0.9, 0.66], [sx * 0.78, 0.18, 0.72]], r, CAGE, seg);
      kit.tube([sx * 0.72, 0.9, hz], [sx * 0.62, 0.3, -1.85], r * 0.9, CAGE_D, seg);            // rear stay
    }
    // front hoop across the dash + roof X + Earnhardt bar
    kit.tube([0.77, 0.76, 0.62], [-0.77, 0.76, 0.62], r, CAGE, seg);
    kit.tube([0.57, 1.235, fz], [-0.57, 1.235, fz], r, CAGE, seg);
    kit.tube([0.56, 1.225, hz], [-0.56, 1.235, fz], r * 0.9, CAGE_D, seg);
    kit.tube([0, 1.255, 0.03], [0, 0.88, 0.66], r * 0.9, CAGE, seg);                           // centre windshield bar
    // door bars: 4 left (driver), 3 right
    for (const y of [0.34, 0.47, 0.60, 0.73]) kit.tube([0.83, y, hz + 0.02], [0.84, y + 0.02, 0.66], r, CAGE, seg);
    for (const y of [0.38, 0.55, 0.72]) kit.tube([-0.83, y, hz + 0.02], [-0.84, y + 0.02, 0.66], r, CAGE, seg);
    if (dense) {
      kit.tube([0.83, 0.34, 0.0], [0.84, 0.73, -0.5], r * 0.85, CAGE_D, seg);
      kit.tube([0.72, 0.9, hz], [-0.80, 0.18, hz], r * 0.9, CAGE_D, seg);                     // hoop diagonal
      kit.tube([0.60, 0.95, hz + 0.01], [0.60, 1.2, hz], r * 0.8, CAGE_D, seg);
      kit.tube([0.42, 1.0, hz + 0.02], [0.42, 1.05, -0.48], r * 0.8, CAGE_D, seg);              // seat halo support
    }
  }
  function cabinShell(kit, lo) {
    const sx = EYE.x;
    kit.box(0, 0.13, -0.1, 1.64, 0.02, 1.9, 0x18191b);                                      // floor pan
    kit.box(0, 0.5, 0.78, 1.6, 0.7, 0.03, 0x1c1d20, 0.12, 0, 0);                             // firewall
    kit.box(0, 0.83, 0.52, 1.52, 0.03, 0.36, 0x121314, -0.1, 0, 0);                          // dash top
    kit.box(0, 0.62, -1.0, 1.55, 0.9, 0.02, 0x1a1b1d);                                        // rear bulkhead
    for (const s of [1, -1]) kit.box(s * 0.905, 0.52, -0.1, 0.012, 0.68, 1.5, 0x232427);        // inner door skins
    kit.box(0, 1.245, -0.44, 1.12, 0.012, 0.92, 0x1e1f22);                                    // headliner
    // containment seat: pan, back (reclined), rib + head surrounds
    kit.box(sx, 0.24, -0.42, 0.44, 0.07, 0.46, 0x141414, 0.12, 0, 0);
    kit.box(sx, 0.62, -0.66, 0.46, 0.78, 0.06, 0x141414, -0.26, 0, 0);
    for (const s of [1, -1]) {
      kit.box(sx + s * 0.235, 0.52, -0.54, 0.03, 0.5, 0.36, 0x9a9ea5, -0.26, 0, 0);         // shell sides (aluminium)
      kit.box(sx + s * 0.16, 1.0, -0.52, 0.04, 0.28, 0.24, 0x9a9ea5, -0.2, 0, 0);            // head surrounds
    }
    kit.box(sx - 0.2, 0.84, -0.46, 0.035, 0.30, 0.36, 0x9a9ea5, -0.2, 0, 0);                 // right shoulder support
    if (!lo) {
      // belts
      for (const s of [1, -1]) kit.box(sx + s * 0.09, 0.73, -0.55, 0.05, 0.5, 0.012, 0xc21f1f, -0.35, 0, 0);
      kit.box(sx, 0.35, -0.3, 0.07, 0.03, 0.2, 0xc21f1f, 0.3, 0, 0);
      // fire bottle, radio box, cool-suit hose
      kit.cyl(-0.1, 0.24, -0.25, 0.055, 0.34, 0xc4271c, 10, Math.PI / 2, 0, 0);
      kit.box(-0.45, 0.35, 0.55, 0.22, 0.14, 0.2, 0x2a2c2f);
      kit.poly([[-0.2, 0.3, -0.7], [-0.05, 0.55, -0.62], [0.06, 0.78, -0.52]], 0.018, 0x2f4f7a, 6);
    }
  }
  /* window net on the driver's (LEFT, +x) opening, following the tumblehome */
  function windowNet(kit) {
    const z0 = -0.72, z1 = 0.0, y0 = 0.9, y1 = 1.17;
    const xAt = (y) => 0.86 - (y - 0.88) * 0.62;
    const c = 0x0c0c0c;
    for (let k = 0; k <= 6; k++) { const z = lerp(z0, z1, k / 6); kit.tube([xAt(y0), y0, z], [xAt(y1), y1, z], 0.005, c, 4); }
    for (let k = 0; k <= 4; k++) { const y = lerp(y0, y1, k / 4); kit.tube([xAt(y), y, z0], [xAt(y), y, z1], 0.005, c, 4); }
    kit.tube([xAt(y1), y1 + 0.005, z0], [xAt(y1), y1 + 0.005, z1], 0.011, 0x2a2c30, 6);        // latch rod
  }
  function liteInteriorGeo(THREE, L) {
    const acc = new Acc(THREE), kit = Kit(THREE, acc);
    cage(kit, false); cabinShell(kit, true); windowNet(kit);
    kit.box(0.25, 0.8, 0.12, 0.3, 0.3, 0.02, 0x0e0e0e, -0.35, 0, 0);                         // wheel blob
    // the driver: firesuit torso, arms to the wheel, helmet with visor
    const suit = L.suitHex, helm = L.helmHex;
    kit.box(EYE.x, 0.62, -0.5, 0.40, 0.46, 0.24, suit, -0.26, 0, 0);
    for (const s of [1, -1]) kit.poly([[EYE.x + s * 0.19, 0.78, -0.48], [EYE.x + s * 0.2, 0.66, -0.15], [EYE.x + s * 0.13, 0.82, 0.08]], 0.045, suit, 5);
    kit.sphere(EYE.x, EYE.y - 0.02, -0.40, 0.13, 0.14, 0.15, helm, 10);
    kit.box(EYE.x, EYE.y - 0.01, -0.28, 0.2, 0.07, 0.05, 0x0a0c10);                           // visor
    kit.box(EYE.x, 0.86, -0.43, 0.3, 0.07, 0.24, 0x1a1a1a);                                     // HANS
    return acc.build();
  }
  function cockpitGeo(THREE) {
    const acc = new Acc(THREE), kit = Kit(THREE, acc);
    cage(kit, true); cabinShell(kit, false); windowNet(kit);
    // dash panel housing + switch panel + column + shifter + mirrors + pedal box cover
    kit.box(EYE.x, 0.84, 0.36, 0.36, 0.14, 0.05, 0x151618, -0.45, 0, 0);
    kit.box(-0.08, 0.78, 0.44, 0.34, 0.2, 0.04, 0x1d1f22, -0.35, 0, 0);
    const sw = [0xd22b2b, 0xe3b21a, 0x2f8f3a, 0xe8e8e8, 0x2f6fd2, 0xd22b2b];
    for (let k = 0; k < 12; k++) kit.box(-0.2 + (k % 6) * 0.045, 0.83 - Math.floor(k / 6) * 0.06, 0.415, 0.022, 0.022, 0.02, sw[k % 6], -0.35, 0, 0);
    kit.tube([EYE.x, 0.79, 0.14], [EYE.x, 0.66, 0.66], 0.022, 0x2a2c30, 8);
    kit.tube([0.03, 0.2, -0.08], [0.02, 0.58, -0.02], 0.012, 0x9a9da3, 6);
    kit.sphere(0.02, 0.6, -0.02, 0.028, 0.03, 0.028, 0x111111, 8);
    kit.box(0.02, 0.2, -0.08, 0.1, 0.05, 0.14, 0x202225);
    kit.box(0.0, 1.17, 0.1, 0.34, 0.07, 0.015, 0x0b0d10, 0.2, 0, 0);                             // centre mirror
    kit.box(0.0, 1.17, 0.108, 0.36, 0.08, 0.01, 0x2a2c30, 0.2, 0, 0);
    kit.box(-0.42, 1.14, 0.12, 0.2, 0.06, 0.015, 0x0b0d10, 0.2, -0.3, 0);                        // spotter mirror
    kit.box(0.30, 0.34, 0.62, 0.5, 0.18, 0.2, 0x1a1b1d, -0.5, 0, 0);                              // pedal box cover
    return acc.build();
  }
  /* flat-bottom quick-release wheel, built in the xy plane facing -z (toward the driver) */
  function steeringGeo(THREE) {
    const acc = new Acc(THREE), kit = Kit(THREE, acc);
    const pts = [], rr = 0.165, flat = -0.125, n = 28;
    const a0 = Math.acos(flat / -rr);    // angle from straight down where the rim meets the flat
    for (let k = 0; k <= n; k++) {
      const a = -Math.PI / 2 + a0 + (k / n) * (Math.PI * 2 - 2 * a0);
      pts.push([Math.cos(a) * rr, Math.sin(a) * rr, 0]);
    }
    pts.push(pts[0]);
    kit.poly(pts, 0.017, 0x151515, 8, true);
    kit.box(0.09, 0, 0.005, 0.15, 0.04, 0.012, 0x2c2e31);
    kit.box(-0.09, 0, 0.005, 0.15, 0.04, 0.012, 0x2c2e31);
    kit.box(0, -0.07, 0.005, 0.035, 0.11, 0.012, 0x2c2e31);
    kit.cyl(0, 0, 0.03, 0.035, 0.05, 0x8d9197, 12, Math.PI / 2, 0, 0);          // quick release hub
    const b = [0xd22b2b, 0x2f6fd2, 0xe3b21a, 0x2f8f3a];
    for (let k = 0; k < 4; k++) kit.box((k < 2 ? 1 : -1) * (0.06 + (k % 2) * 0.035), 0.012, -0.004, 0.022, 0.022, 0.01, b[k]);
    kit.box(0, 0.162, -0.004, 0.01, 0.02, 0.036, 0xe8e8e8);                         // top-centre marker
    return acc.build();
  }

  // ---- disc glow material (per wheel, one shared program) -------------------------------
  function glowMat(THREE) {
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.5 });
    m.emissive.setRGB(0, 0, 0);
    m.onBeforeCompile = glowPatch;
    m.customProgramCacheKey = glowKey;
    return m;
  }
  function glowPatch(sh) {
    sh.vertexShader = "attribute float glow;\nvarying float vGlow;\n" + sh.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\nvGlow = glow;");
    sh.fragmentShader = "varying float vGlow;\n" + sh.fragmentShader.replace("vec3 totalEmissiveRadiance = emissive;", "vec3 totalEmissiveRadiance = emissive * vGlow;");
  }
  function glowKey() { return "raceDiscGlow"; }

  // ---- LIVERIES -------------------------------------------------------------------------
  const TEAMS = [
    { sponsor: "HALVERSON", sub: "TOOLS", base: "#10306e", accent: "#f2c230", trim: "#ffffff", num: "#ffffff", numStroke: "#0a0a0a", scheme: 0 },
    { sponsor: "BRIGHTWATER", sub: "SPRINGS", base: "#e9eef2", accent: "#1a8fd6", trim: "#0b2a4a", num: "#0b2a4a", numStroke: "#ffffff", scheme: 1 },
    { sponsor: "KESTREL", sub: "FUELS", base: "#c8102e", accent: "#141414", trim: "#ffffff", num: "#ffffff", numStroke: "#141414", scheme: 2 },
    { sponsor: "NORTHLINE", sub: "FREIGHT", base: "#1b1b1d", accent: "#34c759", trim: "#e8e8e8", num: "#34c759", numStroke: "#000000", scheme: 3 },
    { sponsor: "RED CANYON", sub: "CHILI", base: "#f07c1b", accent: "#6b1d0f", trim: "#fff3d6", num: "#1b0b05", numStroke: "#fff3d6", scheme: 4 },
    { sponsor: "MAPLEFORD", sub: "LUMBER", base: "#2d5a27", accent: "#e7d7a8", trim: "#8a1c1c", num: "#e7d7a8", numStroke: "#1a1a1a", scheme: 5 },
    { sponsor: "VOLTAGRID", sub: "ENERGY", base: "#5b2a86", accent: "#39e0e0", trim: "#ffffff", num: "#ffffff", numStroke: "#1c0b30", scheme: 0 },
    { sponsor: "GRANITE PEAK", sub: "OUTFITTERS", base: "#8c9196", accent: "#d7261e", trim: "#111111", num: "#111111", numStroke: "#ffffff", scheme: 6 },
    { sponsor: "DUSKFIRE", sub: "COLA", base: "#ffd21f", accent: "#e0301e", trim: "#111111", num: "#e0301e", numStroke: "#111111", scheme: 3 },
    { sponsor: "TIDEMARK", sub: "MARINE", base: "#0a7c86", accent: "#ffffff", trim: "#0a2a33", num: "#ffffff", numStroke: "#0a2a33", scheme: 2 },
    { sponsor: "OXBOW", sub: "RANCH SUPPLY", base: "#6e2b16", accent: "#e8b04a", trim: "#ffffff", num: "#e8b04a", numStroke: "#2a0f06", scheme: 1 },
    { sponsor: "LARKSPUR", sub: "INSURANCE", base: "#f4f4f4", accent: "#e0457b", trim: "#262a58", num: "#262a58", numStroke: "#ffffff", scheme: 4 },
  ];
  const NUMBERS = [7, 24, 11, 48, 3, 88, 17, 42, 9, 31, 55, 68];
  const SMALL = ["TORQLINE", "APEX GRIP", "CORDOVA", "STEELHEAD", "QUICKLAP", "FLATOUT", "BOLTWORKS", "HIGHBANK"];
  const PAL = ["#10306e", "#c8102e", "#1b1b1d", "#f07c1b", "#2d5a27", "#5b2a86", "#ffd21f", "#0a7c86", "#e9eef2", "#6e2b16", "#8c9196", "#e0457b"];

  function hexToInt(h) { return parseInt(h.slice(1), 16); }
  function describe(team, number, seed) {
    const L = Object.assign({}, team, { number, seed });
    L.suitHex = hexToInt(team.base); L.helmHex = hexToInt(team.accent);
    return L;
  }
  function liveries(n) {
    const out = [];
    for (let i = 0; i < n; i++) {
      if (i < TEAMS.length) { out.push(describe(TEAMS[i], NUMBERS[i], i)); continue; }
      // variants: deterministic recolours of the base teams with new numbers
      const t = TEAMS[i % TEAMS.length], r = (k) => hash(i * 7919 + k);
      let base = PAL[Math.floor(r(1) * PAL.length)], accent = PAL[Math.floor(r(2) * PAL.length)];
      if (accent === base) accent = PAL[(PAL.indexOf(base) + 5) % PAL.length];
      const num = 10 + ((i * 37) % 89);
      out.push(describe(Object.assign({}, t, { base, accent, scheme: Math.floor(r(3) * 7), num: "#ffffff", numStroke: "#111111" }), num, i));
    }
    return out;
  }
  function liveryFor(number, seed) {
    const i = NUMBERS.indexOf(number);
    if (i >= 0 && !seed) return describe(TEAMS[i], number, i);
    const t = TEAMS[Math.floor(hash((number | 0) * 131 + (seed | 0)) * TEAMS.length)];
    return describe(t, number, seed | 0);
  }

  function numFont(px) { return "italic 900 " + px + "px 'Arial Black', 'Helvetica Neue', Arial, sans-serif"; }
  function txtFont(px, w) { return (w || 800) + " " + px + "px 'Helvetica Neue', Arial, sans-serif"; }

  /* Paint the whole atlas. Coordinates are car metres mapped through the
     same functions the UVs use, so decals land where the shell is. */
  function drawLivery(ctx, L, size) {
    const S = size / A;
    ctx.save(); ctx.scale(S, S);
    const sX = (side, z) => (side === 0 ? (2.5 - z) / 5 * A : (z + 2.5) / 5 * A);
    const sY = (side, y) => side * 266 + (1.3 - y) / 1.3 * 266;
    const tX = (z) => (z + 2.5) / 5 * A, tY = (x) => 532 + (1.02 - x) / 2.04 * 408;
    const fX = (x) => (x + 1.02) / 2.04 * 512, fY = (y) => 950 + (0.75 - y) / 0.75 * 72;
    const kX = (x) => 512 + (1.02 - x) / 2.04 * 512, kY = (y) => 950 + (1.1 - y) / 1.1 * 72;
    const poly = (pts, fx, fy, fill) => { ctx.beginPath(); pts.forEach((p, k) => (k ? ctx.lineTo(fx(p[0]), fy(p[1])) : ctx.moveTo(fx(p[0]), fy(p[1])))); ctx.closePath(); ctx.fillStyle = fill; ctx.fill(); };
    const clip = (x, y, w, h) => { ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip(); };
    const outlined = (text, x, y, px, fill, stroke, font) => {
      ctx.font = font(px); ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.lineJoin = "round"; ctx.lineWidth = px * 0.16; ctx.strokeStyle = stroke; ctx.strokeText(text, x, y);
      ctx.fillStyle = fill; ctx.fillText(text, x, y);
    };
    const fit = (text, px, maxW, font) => { ctx.font = font(px); const w = ctx.measureText(text).width; return w > maxW ? px * maxW / w : px; };

    ctx.fillStyle = L.base; ctx.fillRect(0, 0, A, A);
    ctx.fillStyle = "#050608"; ctx.fillRect(0, 940, A, 10);

    // ---- sides
    for (const side of [0, 1]) {
      clip(0, side * 266, A, 266);
      const fx = (z) => sX(side, z), fy = (y) => sY(side, y), P = (pts, c) => poly(pts, fx, fy, c);
      switch (L.scheme) {
        case 0: // swoosh
          P([[2.6, 0.2], [2.6, 0.53], [1.2, 0.49], [-0.2, 0.69], [-1.6, 0.87], [-2.6, 0.93], [-2.6, 0.66], [-1.4, 0.62], [-0.2, 0.44], [1.0, 0.24]], L.trim);
          P([[2.6, 0.18], [2.6, 0.5], [1.2, 0.46], [-0.2, 0.66], [-1.6, 0.84], [-2.6, 0.9], [-2.6, 0.63], [-1.4, 0.59], [-0.2, 0.41], [1.0, 0.21]], L.accent); break;
        case 1: // split
          P([[2.6, 0.62], [2.6, 1.4], [-2.6, 1.4], [-2.6, 0.62]], L.trim);
          P([[2.6, 0.645], [2.6, 1.4], [-2.6, 1.4], [-2.6, 0.645]], L.accent); break;
        case 2: // stripes
          P([[2.6, 0.22], [2.6, 0.31], [-2.6, 0.31], [-2.6, 0.22]], L.accent);
          P([[2.6, 0.32], [2.6, 0.34], [-2.6, 0.34], [-2.6, 0.32]], L.trim); break;
        case 3: // slash
          P([[1.5, 0.12], [0.8, 1.2], [0.64, 1.2], [1.34, 0.12]], L.trim);
          P([[1.25, 0.12], [0.55, 1.2], [-0.55, 1.2], [0.15, 0.12]], L.accent); break;
        case 4: { // fade
          const g = ctx.createLinearGradient(fx(1.2), 0, fx(-1.8), 0); g.addColorStop(0, L.base); g.addColorStop(1, L.accent);
          ctx.fillStyle = g; ctx.fillRect(0, side * 266, A, 266);
          P([[2.6, 0.64], [2.6, 0.665], [-2.6, 0.665], [-2.6, 0.64]], L.trim); break; }
        case 5: // chevron nose
          P([[2.6, 0.0], [2.6, 0.7], [1.5, 0.7], [0.75, 0.0]], L.trim);
          P([[2.6, 0.0], [2.6, 0.66], [1.55, 0.66], [0.9, 0.0]], L.accent); break;
        case 6: // rear half
          P([[0.36, 0], [-0.24, 1.4], [-0.3, 1.4], [0.3, 0]], L.trim);
          P([[0.3, 0], [-0.3, 1.4], [-2.6, 1.4], [-2.6, 0]], L.accent); break;
      }
      P([[2.6, -0.1], [2.6, 0.19], [-2.6, 0.19], [-2.6, -0.1]], "#0d0e10");                 // rocker/skirt
      // door number
      const nh = 0.47 / 1.3 * 266;
      outlined(String(L.number), fx(0.12), fy(0.52), fit(String(L.number), nh, 0.82 / 5 * A, numFont), L.num, L.numStroke, numFont);
      // rear-quarter sponsor + sub line
      outlined(L.sponsor, fx(-1.45), fy(0.86), fit(L.sponsor, 26, 0.95 / 5 * A, txtFont), L.trim, L.numStroke, txtFont);
      // contingency stack on the front fender
      for (let k = 0; k < 4; k++) {
        const y = 0.28 + k * 0.085, name = SMALL[(k + L.seed * 3) % SMALL.length];
        const x0 = Math.min(fx(0.58), fx(0.93)), w = Math.abs(fx(0.93) - fx(0.58));
        ctx.fillStyle = k % 2 ? "#f2f2f2" : "#1a1a1a"; ctx.fillRect(x0, fy(y + 0.07), w, (0.065 / 1.3) * 266);
        ctx.font = txtFont(9, 900); ctx.fillStyle = k % 2 ? "#1a1a1a" : "#f2f2f2"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(name, x0 + w / 2, fy(y + 0.037));
      }
      // headlight + taillight wraps
      P([[2.47, 0.40], [2.47, 0.52], [2.24, 0.53], [2.2, 0.46]], "#1a1a1a");
      P([[2.47, 0.415], [2.47, 0.505], [2.26, 0.515], [2.23, 0.465]], "#e9edf0");
      P([[-2.47, 0.82], [-2.47, 0.905], [-2.28, 0.905], [-2.3, 0.83]], "#b3121b");
      if (side === 0) { ctx.beginPath(); ctx.arc(fx(-2.02), fy(0.84), 0.05 / 5 * A, 0, Math.PI * 2); ctx.fillStyle = "#1c1c1c"; ctx.fill(); }
      ctx.restore();
    }

    // ---- top (roof reads from the RIGHT side; hood sponsor reads from behind)
    clip(0, 532, A, 408);
    {
      const P = (pts, c) => poly(pts, tX, tY, c);   // pts [z, x]
      switch (L.scheme) {
        case 0: P([[2.6, -1.1], [2.6, 1.1], [2.2, 1.1], [1.85, 0.45], [1.85, -0.45], [2.2, -1.1]], L.accent); break;
        case 1: P([[2.6, -1.1], [2.6, 1.1], [-2.6, 1.1], [-2.6, -1.1]], L.accent); break;
        case 2: for (const s of [1, -1]) {
          P([[2.6, s * 0.06], [2.6, s * 0.29], [-2.6, s * 0.29], [-2.6, s * 0.06]], L.trim);
          P([[2.6, s * 0.08], [2.6, s * 0.27], [-2.6, s * 0.27], [-2.6, s * 0.08]], L.accent);
        } break;
        case 3: P([[0.12, -1.1], [0.12, 1.1], [-0.98, 1.1], [-0.98, -1.1]], L.accent); break;
        case 4: { const g = ctx.createLinearGradient(tX(1.2), 0, tX(-1.8), 0); g.addColorStop(0, L.base); g.addColorStop(1, L.accent); ctx.fillStyle = g; ctx.fillRect(0, 532, A, 408); break; }
        case 5: P([[2.6, -1.1], [2.6, 1.1], [1.55, 1.1], [0.75, 0], [1.55, -1.1]], L.accent); break;
        case 6: P([[-0.2, -1.1], [-0.2, 1.1], [-2.6, 1.1], [-2.6, -1.1]], L.accent); break;
      }
      P([[0.79, -0.9], [0.79, 0.9], [0.70, 0.9], [0.70, -0.9]], "#0f1012");                   // cowl
      for (const s of [1, -1]) {                                                                // hood louvers
        P([[1.85, s * 0.24], [1.85, s * 0.6], [1.45, s * 0.6], [1.45, s * 0.24]], "#121315");
        for (let k = 0; k < 6; k++) { const z = 1.49 + k * 0.06; P([[z + 0.012, s * 0.27], [z + 0.012, s * 0.57], [z, s * 0.57], [z, s * 0.27]], "#2c2e32"); }
      }
      for (const s of [1, -1]) {                                                                // roof flaps
        ctx.strokeStyle = "#0e0e0e"; ctx.lineWidth = 2.5; ctx.strokeRect(tX(-0.84), tY(s > 0 ? 0.30 : -0.06), tX(-0.62) - tX(-0.84), tY(0.06) - tY(0.30));
      }
      // windshield banner (reads from the front)
      P([[0.11, -0.62], [0.11, 0.62], [0.02, 0.62], [0.02, -0.62]], "#0c0c0e");
      ctx.save(); ctx.translate(tX(0.065), tY(0)); ctx.rotate(-Math.PI / 2);
      ctx.font = txtFont(13, 900); ctx.fillStyle = "#f2f2f2"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(L.sponsor, 0, 0); ctx.restore();
      // roof number (reads from the right side)
      const rn = String(L.number);
      outlined(rn, tX(-0.30), tY(0), fit(rn, 0.52 / 2.04 * 408, 0.86 / 5 * A, numFont), L.num, L.numStroke, numFont);
      // hood sponsor (reads from behind: chase cam and cockpit)
      ctx.save(); ctx.translate(tX(1.12), tY(0)); ctx.rotate(Math.PI / 2);
      outlined(L.sponsor, 0, 0, fit(L.sponsor, 40, 1.35 / 2.04 * 408, txtFont), L.trim, L.numStroke, txtFont);
      ctx.font = txtFont(16, 700); ctx.fillStyle = L.trim; ctx.fillText(L.sub, 0, 30); ctx.restore();
      // nose number (reads from the front)
      ctx.save(); ctx.translate(tX(2.2), tY(0)); ctx.rotate(-Math.PI / 2);
      outlined(rn, 0, 0, 26, L.num, L.numStroke, numFont); ctx.restore();
      // deck lid sponsor (reads from behind)
      ctx.save(); ctx.translate(tX(-2.02), tY(0)); ctx.rotate(Math.PI / 2);
      outlined(L.sponsor, 0, 0, fit(L.sponsor, 20, 1.1 / 2.04 * 408, txtFont), L.trim, L.numStroke, txtFont); ctx.restore();
      ctx.restore();
    }

    // ---- front fascia decals: grille, headlights
    clip(0, 950, 512, 72);
    {
      const P = (pts, c) => poly(pts, fX, fY, c);
      P([[-0.62, 0.14], [0.62, 0.14], [0.56, 0.36], [-0.56, 0.36]], "#0b0b0c");
      ctx.strokeStyle = "#26282c"; ctx.lineWidth = 1;
      for (let k = -12; k <= 12; k++) { ctx.beginPath(); ctx.moveTo(fX(k * 0.05), fY(0.14)); ctx.lineTo(fX(k * 0.05 + 0.06), fY(0.36)); ctx.stroke(); }
      for (const s of [1, -1]) {
        P([[s * 0.28, 0.40], [s * 0.66, 0.40], [s * 0.70, 0.53], [s * 0.34, 0.54]], "#1a1a1a");
        P([[s * 0.30, 0.415], [s * 0.64, 0.415], [s * 0.675, 0.52], [s * 0.35, 0.525]], "#e9edf0");
        P([[s * 0.36, 0.43], [s * 0.47, 0.43], [s * 0.48, 0.505], [s * 0.37, 0.51]], "#f3e7b0");
      }
      ctx.restore();
    }
    // ---- rear fascia decals: taillights, bumper
    clip(512, 950, 512, 72);
    {
      const P = (pts, c) => poly(pts, kX, kY, c);
      for (const s of [1, -1]) {
        P([[s * 0.24, 0.79], [s * 0.86, 0.80], [s * 0.86, 0.92], [s * 0.24, 0.915]], "#1a1a1a");
        P([[s * 0.26, 0.80], [s * 0.84, 0.81], [s * 0.84, 0.905], [s * 0.26, 0.90]], "#b3121b");
        P([[s * 0.60, 0.82], [s * 0.82, 0.825], [s * 0.82, 0.89], [s * 0.60, 0.885]], "#ff3a2f");
      }
      P([[-0.7, 0.26], [0.7, 0.26], [0.7, 0.4], [-0.7, 0.4]], "#101012");
      ctx.font = numFont(22); ctx.fillStyle = L.num; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(String(L.number), kX(0), kY(0.6));
      ctx.restore();
    }
    ctx.restore();
  }

  function makeCanvas(w, h) {
    if (typeof document === "undefined" || !document.createElement) return null;
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const ctx = c.getContext && c.getContext("2d");
    return ctx ? { c, ctx } : null;
  }

  // ---- dash display --------------------------------------------------------------------------
  function drawDash(ctx, car, redline) {
    const W = 256, H = 128;
    ctx.fillStyle = "#040506"; ctx.fillRect(0, 0, W, H);
    const rpm = car.rpm || 0, f = clamp((rpm / redline - 0.55) / 0.43, 0, 1), lit = Math.round(f * 12);
    const flash = rpm > redline * 0.975 && ((Date.now() / 90) | 0) % 2 === 0;
    for (let k = 0; k < 12; k++) {
      ctx.fillStyle = k < lit ? (flash ? "#3a7bff" : k < 5 ? "#27d34a" : k < 9 ? "#ffcc1a" : "#ff2a1a") : "#16181b";
      ctx.fillRect(10 + k * 20, 8, 15, 12);
    }
    // rpm bar
    ctx.fillStyle = "#16181b"; ctx.fillRect(10, 28, 236, 10);
    ctx.fillStyle = rpm > redline * 0.9 ? "#ff2a1a" : "#e8e8e8"; ctx.fillRect(10, 28, 236 * clamp(rpm / redline, 0, 1), 10);
    ctx.fillStyle = "#f2f2f2"; ctx.textBaseline = "middle"; ctx.textAlign = "center";
    ctx.font = "900 64px 'Helvetica Neue', Arial, sans-serif"; ctx.fillText(car.gear === 0 ? "N" : car.gear < 0 ? "R" : String(car.gear | 0), 128, 86);
    ctx.font = "700 30px 'Helvetica Neue', Arial, sans-serif";
    ctx.textAlign = "left"; ctx.fillText(String(Math.round(Math.abs(car.speed || 0) * 2.23694)), 12, 86);
    ctx.textAlign = "right"; ctx.fillText(String(Math.round(rpm / 10) * 10), 246, 86);
    ctx.font = "600 12px Arial, sans-serif"; ctx.fillStyle = "#8a8f96";
    ctx.textAlign = "left"; ctx.fillText("MPH", 12, 114); ctx.textAlign = "right"; ctx.fillText("RPM", 246, 114);
  }

  // ---- BUILD ---------------------------------------------------------------------------------
  function build(THREE, o) {
    o = o || {};
    const S = shared(THREE), lo = o.quality === "low", player = !!o.player;
    const L = o.livery && typeof o.livery === "object" ? Object.assign({}, o.livery) : liveryFor(o.number != null ? o.number : 7, typeof o.livery === "number" ? o.livery : 0);
    if (o.number != null && L.number !== o.number) L.number = o.number;
    const fx = o.fx || null, redline = o.redline || REDLINE;
    const step = lo ? 0.09 : 0.06;

    const group = new THREE.Group(); group.name = "raceCar" + L.number; group.rotation.order = "YXZ";
    const near = new THREE.Group(), farG = new THREE.Group(); farG.visible = false;
    group.add(near, farG);

    // livery texture + body material
    const tsz = lo ? 512 : 1024, cv = makeCanvas(tsz, tsz);
    let tex = null;
    if (cv) {
      drawLivery(cv.ctx, L, tsz);
      tex = new THREE.CanvasTexture(cv.c); tex.encoding = THREE.sRGBEncoding; tex.anisotropy = 4;
    }
    const bodyMat = new THREE.MeshStandardMaterial({ map: tex, color: tex ? 0xffffff : col(THREE, hexToInt(L.base)),
      roughness: player ? 0.26 : 0.32, metalness: 0.12, side: THREE.DoubleSide });

    // shell
    const G = loftGrid(step);
    const rest = G.P, pos = Float32Array.from(rest), nrm = new Float32Array(rest.length), disp = new Float32Array(rest.length);
    const shells = buildShell(THREE, G, step, false), farShell = buildShell(THREE, G, step, true)[0];
    const shellGeos = [shells[0], shells[1], shells[2], shells[3], farShell];
    gridNormals(G, pos, nrm); shellGeos.forEach((g) => { writeShell(g, pos, nrm); g.computeBoundingSphere(); });

    const bodyMesh = new THREE.Mesh(shells[0], bodyMat);
    const glassMesh = new THREE.Mesh(shells[3], S.mats.glass); glassMesh.renderOrder = 2;
    near.add(bodyMesh, glassMesh);

    // shared parts
    const gs = S.geos;
    if (!gs.trim) {
      gs.trim = trimGeo(THREE, false); gs.trimLo = trimGeo(THREE, true);
      gs.wheelL = wheelGeo(THREE, false); gs.wheelR = mirrorX(THREE, gs.wheelL);
      gs.wheelLoL = wheelGeo(THREE, true); gs.wheelLoR = mirrorX(THREE, gs.wheelLoL);
      gs.hubL = hubGeo(THREE); gs.hubR = mirrorX(THREE, gs.hubL);
      gs.susp = suspGeo(THREE); gs.splitter = splitterGeo(THREE); gs.spoiler = spoilerGeo(THREE);
      gs.farWheels = farWheelsGeo(THREE); gs.farTrim = farTrimGeo(THREE);
    }
    const trimMesh = new THREE.Mesh(lo ? gs.trimLo : gs.trim, S.mats.trim);
    const suspMesh = new THREE.Mesh(gs.susp, S.mats.trim);
    near.add(trimMesh, suspMesh);

    // detachable parts ride in pivots centred on their own bbox
    function part(key, geo, mat, when) {
      geo.computeBoundingBox();
      const c = new THREE.Vector3(); geo.boundingBox.getCenter(c);
      const pivot = new THREE.Group(); pivot.position.copy(c);
      const mesh = new THREE.Mesh(geo, mat); mesh.position.copy(c).negate(); pivot.add(mesh);
      near.add(pivot);
      return { key, pivot, mesh, mat, center: c, when, off: false, vel: new THREE.Vector3(), spin: new THREE.Vector3(), gy: 0, t: 0, still: 0, fade: null };
    }
    const parts = [
      part("splitter", gs.splitter, S.mats.trim, (d) => d.front > 0.5),
      part("frontCover", shells[1], bodyMat, (d) => d.front > 0.8),
      part("spoiler", gs.spoiler, S.mats.trim, (d) => d.rear > 0.55 || d.aero > 0.85),
      part("rearCover", shells[2], bodyMat, (d) => d.rear > 0.8),
    ];

    // wheels
    const hubMats = [], corners = [], wheelMeshes = [];
    const wl = lo ? gs.wheelLoL : gs.wheelL, wr = lo ? gs.wheelLoR : gs.wheelR;
    [[1, 1], [-1, 1], [1, -1], [-1, -1]].forEach(([sx, sz], i) => {
      const c = new THREE.Group(); c.position.set(sx * TRACK / 2, R, sz * AXLE);
      const hm = glowMat(THREE); hubMats.push(hm);
      const hub = new THREE.Mesh(sx > 0 ? gs.hubL : gs.hubR, hm);
      const wm = new THREE.Mesh(sx > 0 ? wl : wr, S.mats.wheel);
      c.add(hub, wm); near.add(c); corners.push(c); wheelMeshes.push(wm);
    });

    // interior (lite, with the driver)
    const liteGeo = liteInteriorGeo(THREE, L);
    const liteMesh = new THREE.Mesh(liteGeo, S.mats.trim);
    near.add(liteMesh);

    // far LOD: body (glass/openings painted dark), wheels, trim
    const farBody = new THREE.Mesh(farShell, bodyMat);
    farG.add(farBody, new THREE.Mesh(gs.farWheels, S.mats.wheel), new THREE.Mesh(gs.farTrim, S.mats.trim));

    // eye + cockpit (player)
    let eye = null, cockpit = null, cockpitOn = false;
    if (player) { eye = new THREE.Object3D(); eye.name = "driverEye"; eye.position.set(EYE.x, EYE.y, EYE.z); near.add(eye); }
    function buildCockpit() {
      if (cockpit) return cockpit;
      const grp = new THREE.Group();
      const inner = new THREE.Mesh(cockpitGeo(THREE), S.mats.trim);
      const col_ = new THREE.Group(); col_.position.set(EYE.x, 0.79, 0.12); col_.rotation.x = -0.36;
      const wheel = new THREE.Mesh(steeringGeo(THREE), S.mats.trim); col_.add(wheel);
      const dc = makeCanvas(256, 128);
      let dtex = null;
      if (dc) { dtex = new THREE.CanvasTexture(dc.c); dtex.encoding = THREE.sRGBEncoding; }
      const dmat = new THREE.MeshBasicMaterial({ map: dtex, color: dtex ? 0xffffff : 0x0a0b0c, toneMapped: false });
      const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.19, 0.095), dmat);
      screen.position.set(EYE.x, 0.868, 0.335); screen.rotation.set(-0.45, Math.PI, 0, "YXZ");
      grp.add(inner, col_, screen);
      near.add(grp);
      cockpit = { grp, inner, wheel, screen, dc, dtex, dmat, t: 1 };
      return cockpit;
    }
    function setCockpit(on) {
      on = !!on && player;
      if (on) buildCockpit();
      cockpitOn = on;
      liteMesh.visible = !on;
      if (cockpit) cockpit.grp.visible = on;
    }

    // ---- damage state
    const applied = { front: 0, rear: 0, left: 0, right: 0 };
    let impactSig = 0, impactAge = 9, impactPart = "", hits = 0, shellDirty = false;
    const impL = new THREE.Vector3();
    const zoneDir = { front: [0, 0, -1], rear: [0, 0, 1], left: [-1, 0, 0], right: [1, 0, 0] };
    function deformAt(lx, ly, lz, dir, depth) {
      const rad = 0.5 + depth * 1.2;
      hits++;
      for (let g = 0; g < G.NG; g++) {
        const o3 = g * 3, dx = rest[o3] - lx, dy = rest[o3 + 1] - ly, dz = rest[o3 + 2] - lz;
        const d = Math.sqrt(dx * dx + dy * dy * 1.6 + dz * dz);
        if (d >= rad) continue;
        const f = sstep(1 - d / rad) * (0.6 + 0.8 * hash(g * 131 + hits * 7));
        const a = depth * f;
        disp[o3] += dir[0] * a; disp[o3 + 2] += dir[2] * a;
        disp[o3 + 1] += (hash(g * 17 + hits) - 0.55) * a * 0.5;       // buckle
        for (let k = 0; k < 3; k++) disp[o3 + k] = clamp(disp[o3 + k], -0.24, 0.24);
      }
      shellDirty = true;
    }
    function flushShell() {
      for (let k = 0; k < pos.length; k++) pos[k] = rest[k] + disp[k];
      gridNormals(G, pos, nrm);
      for (let k = 0; k < shellGeos.length; k++) writeShell(shellGeos[k], pos, nrm);
      shellDirty = false;
    }
    const zoneHits = { front: 0, rear: 0, left: 0, right: 0 }, ZI = { front: 1, rear: 2, left: 3, right: 4 };
    /* a crumple without a fresh impact keeps hitting the same spot of its zone
       (the spot moves only when a real impact on that zone arrives) */
    function zonePoint(zone, out) {
      const j = hash(ZI[zone] * 977 + L.number * 13 + zoneHits[zone] * 31) - 0.5;
      if (zone === "front") out.set(j * 1.3, 0.45, 2.42);
      else if (zone === "rear") out.set(j * 1.3, 0.62, -2.42);
      else if (zone === "left") out.set(1.0, 0.5, j * 3.2);
      else out.set(-1.0, 0.5, j * 3.2);
      return out;
    }
    const tmpP = new THREE.Vector3();

    // ---- parts physics
    const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3();
    function detach(pt, car) {
      if (pt.off || !fx || !fx.scene) { if (!pt.off) { pt.off = true; pt.pivot.visible = false; } return; }
      pt.off = true;
      group.updateMatrixWorld(true);
      pt.pivot.getWorldPosition(_v); pt.pivot.getWorldQuaternion(_q);
      near.remove(pt.pivot); fx.scene.add(pt.pivot);
      pt.pivot.position.copy(_v); pt.pivot.quaternion.copy(_q);
      const vx = car.vel ? car.vel.x : 0, vz = car.vel ? car.vel.z : 0;
      pt.vel.set(vx * 0.85 + (hash(hits * 3 + 1) - 0.5) * 3, 2 + hash(hits * 5) * 3, vz * 0.85 + (hash(hits * 11) - 0.5) * 3);
      pt.spin.set((hash(hits + 2) - 0.5) * 12, (hash(hits + 4) - 0.5) * 12, (hash(hits + 6) - 0.5) * 12);
      pt.gy = (car.pos ? car.pos.y : 0) + 0.04; pt.t = 0; pt.still = 0;
      pt.fade = pt.mat.clone(); pt.fade.transparent = true; pt.mesh.material = pt.fade;
      if (fx) fx.burst(_v.x, _v.y, _v.z, vx, vz, 18);
    }
    function stepParts(dt) {
      for (let k = 0; k < parts.length; k++) {
        const pt = parts[k];
        if (!pt.off || !pt.fade || !pt.pivot.visible) continue;
        pt.t += dt;
        const p = pt.pivot.position;
        if (pt.still < 0.5) {
          pt.vel.y -= 9.81 * dt;
          p.addScaledVector(pt.vel, dt);
          _e.set(pt.spin.x * dt, pt.spin.y * dt, pt.spin.z * dt); _q.setFromEuler(_e); pt.pivot.quaternion.multiply(_q);
          if (p.y < pt.gy) {
            p.y = pt.gy; pt.vel.y = Math.abs(pt.vel.y) * 0.3; pt.vel.x *= 0.55; pt.vel.z *= 0.55; pt.spin.multiplyScalar(0.5);
            if (pt.vel.lengthSq() < 0.5) pt.still += dt * 4; else pt.vel.y = Math.max(pt.vel.y, 0);
          }
          // slide friction on the ground
          if (p.y <= pt.gy + 0.01) { const fr = Math.max(0, 1 - 3 * dt); pt.vel.x *= fr; pt.vel.z *= fr; pt.spin.multiplyScalar(fr); }
        } else pt.still += dt;
        if (pt.still > 5) {
          const a = 1 - (pt.still - 5) / 2;
          pt.fade.opacity = clamp(a, 0, 1);
          if (a <= 0) { pt.pivot.visible = false; }
        }
      }
    }
    function reattach(pt) {
      if (pt.pivot.parent && pt.pivot.parent !== near) pt.pivot.parent.remove(pt.pivot);
      if (pt.pivot.parent !== near) near.add(pt.pivot);
      pt.pivot.position.copy(pt.center); pt.pivot.quaternion.set(0, 0, 0, 1); pt.pivot.visible = true;
      if (pt.fade) { pt.fade.dispose(); pt.fade = null; }
      pt.mesh.material = pt.mat; pt.off = false; pt.t = 0; pt.still = 0;
    }

    // ---- fx emission state
    const smokeAcc = new Float32Array(4); let flameAcc = 0, sparkAcc = 0, engAcc = 0, lastBackfire = 0;
    const Mw = group.matrix.elements;
    function wx(x, y, z) { return Mw[0] * x + Mw[4] * y + Mw[8] * z + Mw[12]; }
    function wy(x, y, z) { return Mw[1] * x + Mw[5] * y + Mw[9] * z + Mw[13]; }
    function wz(x, y, z) { return Mw[2] * x + Mw[6] * y + Mw[10] * z + Mw[14]; }

    let far = false, dashT = 0;
    const handle = {
      group, eye, livery: L, dims: DIMS, parts,
      setCockpit,
      setVisible(v) { group.visible = !!v; },
      update(car, dt, camera, cockpitMode) {
        dt = Math.min(dt || 0, 0.1);
        // pose
        const p = car.pos || { x: 0, y: 0, z: 0 };
        group.position.set(p.x, p.y, p.z);
        group.rotation.set(-(car.pitch || 0), car.yaw || 0, car.roll || 0, "YXZ");
        group.updateMatrix();
        if (!!cockpitMode !== cockpitOn && player) setCockpit(cockpitMode);
        // LOD
        if (cockpitOn || !camera) far = false;
        else {
          const cp = camera.position, dx = cp.x - p.x, dy = cp.y - p.y, dz = cp.z - p.z, d2 = dx * dx + dy * dy + dz * dz;
          far = far ? d2 > 55 * 55 : d2 > 65 * 65;
        }
        near.visible = !far; farG.visible = far;
        const W = car.wheels;
        if (!far && W) {
          for (let i = 0; i < 4; i++) {
            const w = W[i]; if (!w) continue;
            corners[i].position.y = R + (w.compress || 0);
            corners[i].rotation.y = w.steer || 0;
            wheelMeshes[i].rotation.x = w.spin || 0;
            const h = clamp(w.brakeHeat || 0, 0, 1), h2 = h * h;
            hubMats[i].emissive.setRGB(2.6 * h2, 0.55 * h2 * h, 0.08 * h2 * h2);
          }
        }
        if (cockpitOn && cockpit) {
          cockpit.wheel.rotation.z = -(car.steer || 0) * 1.6;
          dashT += dt;
          if (dashT >= 1 / 15 && cockpit.dc) { dashT = 0; drawDash(cockpit.dc.ctx, car, redline); cockpit.dtex.needsUpdate = true; }
        }
        // damage
        const D = car.damage, F = car.fx;
        impactAge += dt;
        if (F && F.impact) {
          const im = F.impact, sig = im.x * 1.3 + im.y * 7.1 + im.z * 3.7 + (im.mag || 0) * 11.3;
          if (sig !== impactSig) {
            impactSig = sig; impactAge = 0; impactPart = im.part || "";
            if (impactPart in zoneHits) zoneHits[impactPart]++;
            const dx = im.x - p.x, dz = im.z - p.z, cy = Math.cos(car.yaw || 0), sy = Math.sin(car.yaw || 0);
            impL.set(dx * cy - dz * sy, clamp(im.y - p.y, 0.2, 1.0), dx * sy + dz * cy);
            if (fx) fx.burst(im.x, im.y, im.z, car.vel ? car.vel.x : 0, car.vel ? car.vel.z : 0, 10 + Math.min(30, (im.mag || 0) * 2) | 0);
          }
        }
        if (D) {
          for (const zone in applied) {
            const v = D[zone] || 0;
            if (v < applied[zone] - 0.2) { handle.reset(); break; }
            if (v > applied[zone] + 0.015) {
              const pt = impactAge < 0.6 && impactPart === zone ? tmpP.copy(impL) : zonePoint(zone, tmpP);
              deformAt(pt.x, pt.y, pt.z, zoneDir[zone], (v - applied[zone]) * 0.22);
              applied[zone] = v;
            }
          }
          for (let k = 0; k < parts.length; k++) if (!parts[k].off && parts[k].when(D)) detach(parts[k], car);
        }
        if (shellDirty) flushShell();
        stepParts(dt);
        // fx
        if (fx && dt > 0) {
          const vx = car.vel ? car.vel.x : 0, vz = car.vel ? car.vel.z : 0, spd = Math.abs(car.speed || 0);
          if (W) for (let i = 0; i < 4; i++) {
            const w = W[i]; if (!w) continue;
            const s = w.slip || 0;
            const grass = w.onGrass && spd > 3;
            const rate = grass ? 30 * Math.min(1, spd / 20) : s > 0.12 ? 70 * s * s : 0;
            smokeAcc[i] += rate * dt;
            const lx = (i & 1 ? -1 : 1) * TRACK / 2, lz = i < 2 ? AXLE : -AXLE;
            while (smokeAcc[i] >= 1) {
              smokeAcc[i] -= 1;
              const x = wx(lx, 0.1, lz - 0.2), y = wy(lx, 0.1, lz - 0.2), z = wz(lx, 0.1, lz - 0.2);
              if (grass) fx.dust(x, y, z, vx * 0.4, vz * 0.4);
              else fx.smoke(x, y, z, vx * 0.25, vz * 0.25, 0.5 + s * 0.6, 0.75);
            }
          }
          const bf = F ? F.backfire || 0 : 0;
          if (bf > lastBackfire + 0.25) flameAcc += 8;
          flameAcc += bf * 60 * dt; lastBackfire = bf;
          while (flameAcc >= 1) {
            flameAcc -= 1;
            const z0 = hash(((flameAcc * 997) | 0) + hits) > 0.5 ? -0.62 : -0.75;
            const x = wx(-1.02, 0.21, z0), y = wy(-1.02, 0.21, z0), z = wz(-1.02, 0.21, z0);
            // out of the right side: local -x in world
            fx.flame(x, y, z, vx - Mw[0] * 5, vz - Mw[2] * 5);
          }
          const sp = F ? F.sparks || 0 : 0;
          sparkAcc += sp * 260 * dt;
          while (sparkAcc >= 1) {
            sparkAcc -= 1;
            let lx, ly, lz;
            if (impactAge < 0.4) { lx = impL.x; ly = Math.min(impL.y, 0.5); lz = impL.z; }
            else { lx = -0.95; ly = 0.1; lz = (fx.rand() - 0.5) * 3.6; }
            fx.spark(wx(lx, ly, lz), wy(lx, ly, lz), wz(lx, ly, lz), vx * 0.6, vz * 0.6, p.y);
          }
          const eng = D ? D.engine || 0 : 0;
          if (eng > 0.25) {
            engAcc += (eng - 0.2) * 40 * dt;
            while (engAcc >= 1) {
              engAcc -= 1;
              const lx = (fx.rand() - 0.5) * 0.6;
              fx.smoke(wx(lx, 0.86, 1.5), wy(lx, 0.86, 1.5), wz(lx, 0.86, 1.5), vx * 0.5, vz * 0.5, 0.35 + eng * 0.5, eng > 0.7 ? 0.18 : 0.42);
            }
          }
        }
      },
      reset() {
        disp.fill(0); for (const z in applied) { applied[z] = 0; zoneHits[z] = 0; }
        flushShell();
        for (const pt of parts) reattach(pt);
        impactAge = 9; impactSig = 0; hits = 0; smokeAcc.fill(0); flameAcc = sparkAcc = engAcc = lastBackfire = 0;
        for (const m of hubMats) m.emissive.setRGB(0, 0, 0);
      },
      stats() {
        const count = (root_) => { let meshes = 0, tris = 0; root_.traverse((o_) => { if (o_.isMesh && o_.visible && visibleChain(o_, root_)) { meshes++; const g = o_.geometry; tris += (g.index ? g.index.count : g.attributes.position.count) / 3; } }); return { meshes, tris: Math.round(tris) }; };
        return { near: count(near), far: count(farG) };
      },
      dispose() {
        if (group.parent) group.parent.remove(group);
        for (const pt of parts) { if (pt.pivot.parent && pt.pivot.parent !== near) pt.pivot.parent.remove(pt.pivot); if (pt.fade) pt.fade.dispose(); }
        [shells[0], shells[1], shells[2], shells[3], farShell, liteGeo].forEach((g) => g.dispose());
        bodyMat.dispose(); if (tex) tex.dispose(); hubMats.forEach((m) => m.dispose());
        if (cockpit) { cockpit.inner.geometry.dispose(); cockpit.wheel.geometry.dispose(); cockpit.screen.geometry.dispose(); cockpit.dmat.dispose(); if (cockpit.dtex) cockpit.dtex.dispose(); }
      },
    };
    function visibleChain(o_, top) { for (let q = o_; q && q !== top; q = q.parent) if (!q.visible) return false; return true; }
    setCockpit(false);
    return handle;
  }

  // ---- SHARED FX POOL -------------------------------------------------------------------------
  const FX_VS = [
    "attribute float size; attribute vec4 rgba; varying vec4 vC; uniform float uScale;",
    "void main(){ vC = rgba; vec4 mv = modelViewMatrix * vec4(position, 1.0);",
    " gl_PointSize = size * uScale / max(0.2, -mv.z); gl_Position = projectionMatrix * mv; }",
  ].join("\n");
  const FX_FS = [
    "varying vec4 vC;",
    "void main(){ vec2 d = gl_PointCoord - 0.5; float r = dot(d, d) * 4.0; if (r > 1.0) discard;",
    " float a = 1.0 - r; a *= a; gl_FragColor = vec4(vC.rgb * a, vC.a * a); }",
  ].join("\n");

  function createFx(THREE, scene, opts) {
    opts = opts || {};
    const MAX = opts.max || 1600;
    const geo = new THREE.BufferGeometry();
    const P = new Float32Array(MAX * 3), C = new Float32Array(MAX * 4), SZ = new Float32Array(MAX);
    geo.setAttribute("position", new THREE.BufferAttribute(P, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute("rgba", new THREE.BufferAttribute(C, 4).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute("size", new THREE.BufferAttribute(SZ, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 700 } }, vertexShader: FX_VS, fragmentShader: FX_FS,
      transparent: true, depthWrite: false, blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    const points = new THREE.Points(geo, mat); points.frustumCulled = false; points.renderOrder = 20;
    if (scene) scene.add(points);
    // per particle: vel, age, life, size0/1, kind, colour, alpha, ground
    const V = new Float32Array(MAX * 3), AGE = new Float32Array(MAX), LIFE = new Float32Array(MAX), S0 = new Float32Array(MAX),
      S1 = new Float32Array(MAX), KIND = new Uint8Array(MAX), RGB = new Float32Array(MAX * 3), A0 = new Float32Array(MAX), GY = new Float32Array(MAX);
    let cur = 0, seed = 12345, live = 0;
    function rand() { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; }
    function spawn(kind, x, y, z, vx, vy, vz, s0, s1, life, r, g, b, a, gy) {
      const i = cur; cur = (cur + 1) % MAX;
      if (KIND[i] === 0) live++;
      P[i * 3] = x; P[i * 3 + 1] = y; P[i * 3 + 2] = z; V[i * 3] = vx; V[i * 3 + 1] = vy; V[i * 3 + 2] = vz;
      AGE[i] = 0; LIFE[i] = life; S0[i] = s0; S1[i] = s1; KIND[i] = kind; RGB[i * 3] = r; RGB[i * 3 + 1] = g; RGB[i * 3 + 2] = b; A0[i] = a; GY[i] = gy || 0;
    }
    const fx = {
      points, scene, rand,
      /* tyre / engine smoke; a = opacity, tone = grey level (0 black .. 1 white) */
      smoke(x, y, z, vx, vz, a, tone) {
        const t = tone == null ? 0.75 : tone;
        spawn(1, x + (rand() - 0.5) * 0.2, y, z + (rand() - 0.5) * 0.2, vx + (rand() - 0.5) * 1.2, 0.4 + rand() * 0.6, vz + (rand() - 0.5) * 1.2,
          0.6, 3.4 + rand() * 1.5, 1.6 + rand() * 1.4, t, t, t * 1.02, clamp(a, 0, 1) * 0.55, 0);
      },
      dust(x, y, z, vx, vz) {
        spawn(1, x, y, z, vx + (rand() - 0.5), 0.6 + rand() * 0.5, vz + (rand() - 0.5), 0.4, 2.2, 1.0 + rand() * 0.6, 0.45, 0.38, 0.27, 0.45, 0);
      },
      flame(x, y, z, vx, vz) {
        spawn(2, x, y, z, vx + (rand() - 0.5) * 0.8, (rand() - 0.3) * 0.8, vz + (rand() - 0.5) * 0.8, 0.22, 0.05, 0.07 + rand() * 0.08, 1.0, 0.55, 0.18, 1.6, 0);
      },
      spark(x, y, z, vx, vz, gy) {
        const s = 3 + rand() * 6;
        spawn(3, x, y, z, vx + (rand() - 0.5) * s, rand() * s * 0.6, vz + (rand() - 0.5) * s, 0.06, 0.03, 0.3 + rand() * 0.45, 1.0, 0.62, 0.22, 1.8, gy == null ? y - 0.1 : gy);
      },
      burst(x, y, z, vx, vz, n) {
        for (let k = 0; k < n; k++) fx.spark(x, y, z, vx * 0.5, vz * 0.5, y - 0.4);
        for (let k = 0; k < (n >> 2); k++) fx.smoke(x, y, z, vx * 0.3, vz * 0.3, 0.6, 0.55);
      },
      update(dt, camera, viewportH) {
        dt = Math.min(dt || 0, 0.1);
        if (camera && camera.isPerspectiveCamera) mat.uniforms.uScale.value = (viewportH || 800) * 0.5 / Math.tan(camera.fov * Math.PI / 360);
        if (live === 0) return;
        let n = 0;
        for (let i = 0; i < MAX; i++) {
          const k = KIND[i]; if (!k) continue;
          AGE[i] += dt;
          const t = AGE[i] / LIFE[i], o3 = i * 3;
          if (t >= 1) { KIND[i] = 0; SZ[i] = 0; C[i * 4 + 3] = 0; C[i * 4] = C[i * 4 + 1] = C[i * 4 + 2] = 0; live--; continue; }
          n++;
          if (k === 1) { const d = Math.max(0, 1 - 1.4 * dt); V[o3] *= d; V[o3 + 2] *= d; V[o3 + 1] = V[o3 + 1] * d + 0.35 * dt; }
          else if (k === 2) { const d = Math.max(0, 1 - 5 * dt); V[o3] *= d; V[o3 + 1] *= d; V[o3 + 2] *= d; }
          else { V[o3 + 1] -= 9.81 * dt; }
          P[o3] += V[o3] * dt; P[o3 + 1] += V[o3 + 1] * dt; P[o3 + 2] += V[o3 + 2] * dt;
          if (k === 3 && P[o3 + 1] < GY[i]) { P[o3 + 1] = GY[i]; V[o3 + 1] = -V[o3 + 1] * 0.35; V[o3] *= 0.6; V[o3 + 2] *= 0.6; }
          SZ[i] = lerp(S0[i], S1[i], k === 1 ? Math.sqrt(t) : t);
          const c4 = i * 4;
          if (k === 1) {                            // alpha-blended smoke, premultiplied
            const a = A0[i] * Math.pow(1 - t, 1.5) * Math.min(1, AGE[i] * 10);
            C[c4] = RGB[o3] * a; C[c4 + 1] = RGB[o3 + 1] * a; C[c4 + 2] = RGB[o3 + 2] * a; C[c4 + 3] = a;
          } else if (k === 2) {                     // flame: white-yellow core to orange to red, additive
            const e = A0[i] * (1 - t);
            C[c4] = e; C[c4 + 1] = e * lerp(0.85, 0.3, t); C[c4 + 2] = e * lerp(0.5, 0.05, t); C[c4 + 3] = 0;
          } else {                                  // spark, additive
            const e = A0[i] * (1 - t * t);
            C[c4] = e; C[c4 + 1] = e * lerp(0.8, 0.4, t); C[c4 + 2] = e * 0.25; C[c4 + 3] = 0;
          }
        }
        geo.attributes.position.needsUpdate = true; geo.attributes.rgba.needsUpdate = true; geo.attributes.size.needsUpdate = true;
        fx.live = n;
      },
      clear() { KIND.fill(0); SZ.fill(0); C.fill(0); live = 0; geo.attributes.size.needsUpdate = true; geo.attributes.rgba.needsUpdate = true; },
      dispose() { if (points.parent) points.parent.remove(points); geo.dispose(); mat.dispose(); },
      live: 0,
    };
    return fx;
  }

  const api = { build, liveries, liveryFor, createFx, DIMS, TEAMS, _profile: profile };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) {
    const CBZ = root.CBZ = root.CBZ || {};
    CBZ.race = CBZ.race || {};
    CBZ.race.car = api;
  }
})(typeof window !== "undefined" ? window : null);
