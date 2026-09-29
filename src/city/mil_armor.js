/* ============================================================
   city/mil_armor.js — THE GROUND ARMOR, DRAWN FROM THE REAL THING.

   OWNER: "military equipment like tanks ... and rocket launchers ... It's all
   poorly drawn right now, but close. Just redraw it all, like you did with
   cars."

   What was here: island_military.js stacked BoxGeometry into a tank (a 5.6 m
   box hull, four fat wheels per side under a rubber brick, a stick barrel) and
   a truck (a cab box, a bed box, a canvas box). ~40 separate meshes each, every
   one a draw call, because the base keeps its boardable machines out of the
   static merger.

   What is here: six real vehicles at real dimensions, built from PLATES —
   side profiles and plan-view slices lofted into closed, flat-shaded solids
   (armour is plate, so hard edges are the truth for once) — and merged per
   material. Every type is built ONCE into a template; each placed vehicle is a
   clone that shares every geometry and material with its siblings.

     MBT      M1/Leopard-2 class. 7.93 x 3.66 x 2.44 m hull/turret roof, 7 dual
              road wheels a side on 0.635 m track, sprocket aft, idler forward,
              return rollers, skirts, 5.28 m 120 mm-class tube with bore
              evacuator, turret that traverses AND elevates, recoil, rock.
     IFV      Bradley/CV90 class. 6.55 x 3.28 m, 6 road wheels, front sprocket,
              offset two-man turret, 2.75 m autocannon, twin missile box.
     APC      8x8 wheeled (Stryker/Patria class). 6.95 x 2.72 m, faceted hull,
              front two axles steer, remote weapon station.
     TRUCK    6x6 medium cargo truck. 7.95 x 2.50 x 3.22 m (canvas), bonneted
              cab with tumblehome, canvas cover on bows, flatbed variant.
     LUV      HMMWV-class light vehicle. 4.57 x 2.16 x 1.83 m, ring mount.
     MLRS     6x6 rocket launcher: armoured cab, one six-round pod that
              traverses, elevates and ripple-fires.
     PATRIOT  the truck carrying a four-canister elevating launcher.

   WHAT MOVES, AND HOW IT STAYS CHEAP
     · wheels, road wheels, sprockets, idlers and return rollers are ONE
       InstancedMesh per part-material per vehicle; track shoes are ONE
       InstancedMesh for both sides. Their matrices are only rewritten for the
       machine somebody is DRIVING (Rig.update) — a parked tank costs nothing.
     · the hull sits on a `body` pivot (rock on firing, squat under throttle)
       while the running gear stays on the ground, like a suspension.
     · turret → gun (elevation pivot, mantlet) → tube (recoil slide) → muzzle.
     · launchers: launchYaw → launchElev → pod; the hydraulic rams are re-aimed
       from the live elevation so they always meet the cradle.

   Every Object3D reference on userData is NON-ENUMERABLE: Object3D.copy()
   deep-copies userData through JSON, and a rig pointing at its own meshes
   would make any later clone() of a placed vehicle throw.

   Loaded before island_military.js (whose makeTank/makeTruck/makePatriot are
   one-line delegates to this, so CBZ.milModels keeps its keys). THREE r128,
   plain IIFE, no build step, no Math.random.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const PI = Math.PI;

  // ---------------------------------------------------------------- palette
  const HEX = {
    olive: 0x4a5238, oliveD: 0x3a4230, oliveL: 0x5c6648, canvas: 0x646b4b,
    track: 0x2f2d2a, dark: 0x202327, tire: 0x14161a, glass: 0x223044,
    lamp: 0xffe9b0, tail: 0x8a2018, pale: 0xb7b596,
  };
  function cm(hex, o) { return CBZ.cmat ? CBZ.cmat(hex, o) : new THREE.MeshLambertMaterial({ color: hex }); }
  function vm(role, hex) {
    if (CBZ.vehicleMat) { try { const m = CBZ.vehicleMat(role, hex); if (m && m.isMaterial) return m; } catch (e) {} }
    return cm(hex);
  }
  let MT = null;
  function mats() {
    if (MT) return MT;
    MT = {
      olive: cm(HEX.olive), oliveD: cm(HEX.oliveD), oliveL: cm(HEX.oliveL), canvas: cm(HEX.canvas),
      track: cm(HEX.track), pale: cm(HEX.pale),
      gun: vm("plastic", HEX.dark), rubber: vm("tire", HEX.tire), glass: vm("glass", HEX.glass),
      lamp: cm(HEX.lamp, { emissive: HEX.lamp, ei: 0.35 }),
      tail: cm(HEX.tail, { emissive: 0x4a0a06, ei: 0.6 }),
    };
    return MT;
  }

  // ---------------------------------------------------------------- scratch
  const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4();
  const _q = new THREE.Quaternion(), _e = new THREE.Euler();
  const _p = new THREE.Vector3(), _s = new THREE.Vector3();
  function M4(x, y, z, rx, ry, rz, sx, sy, sz, order) {
    _e.set(rx || 0, ry || 0, rz || 0, order || "XYZ");
    _q.setFromEuler(_e);
    _p.set(x || 0, y || 0, z || 0);
    _s.set(sx == null ? 1 : sx, sy == null ? 1 : sy, sz == null ? 1 : sz);
    return _m.compose(_p, _q, _s);
  }
  function hide(obj, key, val) {
    Object.defineProperty(obj, key, { value: val, enumerable: false, writable: true, configurable: true });
    return val;
  }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function wrap(a) { while (a > PI) a -= 2 * PI; while (a < -PI) a += 2 * PI; return a; }

  // ============================================================ GEOMETRY KIT
  // A Kit collects transformed, non-indexed pieces per MATERIAL and merges
  // each bucket into one mesh. That is the whole draw-call discipline.
  function Kit() { this.b = new Map(); }
  Kit.prototype.add = function (mat, geo, m4) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (geo !== g) geo.dispose();
    if (m4) g.applyMatrix4(m4);
    let list = this.b.get(mat);
    if (!list) { list = []; this.b.set(mat, list); }
    list.push(g);
    return this;
  };
  Kit.prototype.into = function (parent, tag) {
    const out = [];
    this.b.forEach(function (geos, mat) {
      const mesh = new THREE.Mesh(merge(geos), mat);
      mesh.castShadow = true; mesh.receiveShadow = true;
      if (tag) mesh.name = tag;
      parent.add(mesh); out.push(mesh);
    });
    this.b.clear();
    return out;
  };
  // one merged geometry out of everything added (materials ignored)
  Kit.prototype.geo = function () {
    const all = [];
    this.b.forEach(function (geos) { for (let i = 0; i < geos.length; i++) all.push(geos[i]); });
    this.b.clear();
    return merge(all);
  };
  function merge(list) {
    let n = 0;
    for (let i = 0; i < list.length; i++) n += list[i].attributes.position.count;
    const P = new Float32Array(n * 3), N = new Float32Array(n * 3), U = new Float32Array(n * 2);
    let o = 0;
    for (let i = 0; i < list.length; i++) {
      const g = list[i], p = g.attributes.position, nn = g.attributes.normal, uv = g.attributes.uv;
      P.set(p.array.subarray(0, p.count * 3), o * 3);
      if (nn) N.set(nn.array.subarray(0, p.count * 3), o * 3);
      if (uv) U.set(uv.array.subarray(0, p.count * 2), o * 2);
      o += p.count;
      g.dispose();
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute("position", new THREE.BufferAttribute(P, 3));
    out.setAttribute("normal", new THREE.BufferAttribute(N, 3));
    out.setAttribute("uv", new THREE.BufferAttribute(U, 2));
    out.computeBoundingBox(); out.computeBoundingSphere();
    return out;
  }

  // LOFT — closed, flat-shaded solid through ordered slices along one axis.
  // Each slice is a convex polygon (same point count on every slice). Face
  // orientation is decided geometrically (away from the local slab centre),
  // so no caller ever has to get a winding right.
  //   axis 'x': pts are [z, y] (a SIDE PROFILE)   → prof()
  //   axis 'y': pts are [x, z] (a PLAN)           → plan()
  //   axis 'z': pts are [x, y] (a CROSS-SECTION)  → sect()
  function loft(axis, slices) {
    const V = axis === "z" ? function (a, p, q) { return [p, q, a]; }
      : axis === "y" ? function (a, p, q) { return [p, a, q]; }
        : function (a, p, q) { return [a, q, p]; };
    const rings = slices.map(function (s) { return s.pts.map(function (pt) { return V(s.a, pt[0], pt[1]); }); });
    const cents = rings.map(function (r) {
      const c = [0, 0, 0];
      for (let i = 0; i < r.length; i++) { c[0] += r[i][0]; c[1] += r[i][1]; c[2] += r[i][2]; }
      return [c[0] / r.length, c[1] / r.length, c[2] / r.length];
    });
    const pos = [], nor = [];
    function tri(A, B, C, ref) {
      const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2];
      const vx = C[0] - A[0], vy = C[1] - A[1], vz = C[2] - A[2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (l < 1e-9) return;
      nx /= l; ny /= l; nz /= l;
      const mx = (A[0] + B[0] + C[0]) / 3 - ref[0], my = (A[1] + B[1] + C[1]) / 3 - ref[1], mz = (A[2] + B[2] + C[2]) / 3 - ref[2];
      if (nx * mx + ny * my + nz * mz < 0) { const t = B; B = C; C = t; nx = -nx; ny = -ny; nz = -nz; }
      pos.push(A[0], A[1], A[2], B[0], B[1], B[2], C[0], C[1], C[2]);
      nor.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
    }
    for (let i = 0; i < rings.length - 1; i++) {
      const r0 = rings[i], r1 = rings[i + 1], n = r0.length;
      const ref = [(cents[i][0] + cents[i + 1][0]) / 2, (cents[i][1] + cents[i + 1][1]) / 2, (cents[i][2] + cents[i + 1][2]) / 2];
      for (let j = 0; j < n; j++) {
        const k = (j + 1) % n;
        tri(r0[j], r0[k], r1[k], ref);
        tri(r0[j], r1[k], r1[j], ref);
      }
    }
    const last = rings.length - 1;
    [[0, 1], [last, last - 1]].forEach(function (pr) {
      const r = rings[pr[0]], c = cents[pr[0]], ref = cents[pr[1]];
      for (let j = 0; j < r.length; j++) tri(c, r[j], r[(j + 1) % r.length], ref);
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pos), 3));
    g.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(nor), 3));
    return g;
  }
  function prof(K, mat, x0, x1, pts, pts1) { K.add(mat, loft("x", [{ a: x0, pts: pts }, { a: x1, pts: pts1 || pts }])); }
  function plan(K, mat, slices) { K.add(mat, loft("y", slices.map(function (s) { return { a: s[0], pts: s[1] }; }))); }
  function sect(K, mat, slices) { K.add(mat, loft("z", slices.map(function (s) { return { a: s[0], pts: s[1] }; }))); }
  // a symmetric cross-section from its +x half, listed bottom → top
  function sym(half) {
    const out = half.slice();
    for (let i = half.length - 1; i >= 0; i--) out.push([-half[i][0], half[i][1]]);
    return out;
  }
  function mirrorX(pts) { return pts.map(function (p) { return [-p[0], p[1]]; }); }
  function bx(K, mat, x, y, z, w, h, d, rx, ry, rz) {
    K.add(mat, new THREE.BoxGeometry(w, h, d), M4(x, y, z, rx, ry, rz));
  }
  // cylinder along an axis; rTop sits at the +axis end
  const AXR = { x: [0, 0, -PI / 2], y: [0, 0, 0], z: [PI / 2, 0, 0] };
  function cy(K, mat, x, y, z, rTop, rBot, len, axis, seg, rx, ry, rz, open) {
    const g = new THREE.CylinderGeometry(rTop, rBot, len, seg || 12, 1, !!open);
    const a = AXR[axis || "y"];
    g.applyMatrix4(M4(0, 0, 0, a[0], a[1], a[2]));
    K.add(mat, g, M4(x, y, z, rx, ry, rz));
  }
  function cone(K, mat, x, y, z, r, len, axis, seg) { cy(K, mat, x, y, z, 0.001, r, len, axis, seg); }

  // ============================================================ RUNNING GEAR
  // TRACK BELT: the loop a track makes around its circles (listed CCW in the
  // (z, y) side view: rear-low → front-low → front-high → rear-high). Outer
  // common tangents between neighbours + arcs on each circle. Returns an
  // evaluator: s (metres along the belt) → position + travel direction.
  function belt(circles) {
    const n = circles.length, nrm = [];
    for (let i = 0; i < n; i++) {
      const c1 = circles[i], c2 = circles[(i + 1) % n];
      const Dz = c2.z - c1.z, Dy = c2.y - c1.y, L = Math.hypot(Dz, Dy);
      const dz = Dz / L, dy = Dy / L, a = (c1.r - c2.r) / L, b = Math.sqrt(Math.max(0, 1 - a * a));
      nrm.push([a * dz + b * dy, a * dy - b * dz]);        // outward normal of edge i
    }
    const segs = [];
    let total = 0;
    for (let i = 0; i < n; i++) {
      const c1 = circles[i], c2 = circles[(i + 1) % n], nv = nrm[i];
      const p1 = [c1.z + c1.r * nv[0], c1.y + c1.r * nv[1]], p2 = [c2.z + c2.r * nv[0], c2.y + c2.r * nv[1]];
      const L = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
      segs.push({ line: true, z0: p1[0], y0: p1[1], dz: (p2[0] - p1[0]) / L, dy: (p2[1] - p1[1]) / L, len: L, s0: total });
      total += L;
      const nn = nrm[(i + 1) % n];
      const a0 = Math.atan2(nv[1], nv[0]);
      let da = Math.atan2(nn[1], nn[0]) - a0;
      while (da <= 0) da += 2 * PI;
      while (da > 2 * PI) da -= 2 * PI;
      segs.push({ line: false, cz: c2.z, cy: c2.y, r: c2.r, a0: a0, da: da, len: c2.r * da, s0: total });
      total += c2.r * da;
    }
    function at(s, out) {
      s = ((s % total) + total) % total;
      let k = segs.length - 1;
      for (let i = 0; i < segs.length; i++) { if (s < segs[i].s0 + segs[i].len) { k = i; break; } }
      const g = segs[k], t = s - g.s0;
      if (g.line) { out.z = g.z0 + g.dz * t; out.y = g.y0 + g.dy * t; out.tz = g.dz; out.ty = g.dy; }
      else {
        const a = g.a0 + t / g.r;
        out.z = g.cz + g.r * Math.cos(a); out.y = g.cy + g.r * Math.sin(a);
        out.tz = -Math.sin(a); out.ty = Math.cos(a);
      }
      return out;
    }
    return { at: at, length: total, segs: segs };
  }

  // tracked road wheel: a DUAL disc (the centre guide horn runs in the gap),
  // rubber tyres on each, a hub and six bolt bosses so a spin reads.
  function roadWheelGeos(r) {
    const M = mats(), K = new Kit(), T = new Kit();
    [-1, 1].forEach(function (s) {
      cy(T, M.rubber, s * 0.165, 0, 0, r, r, 0.22, "x", 16);
      cy(K, M.olive, s * 0.165, 0, 0, r * 0.80, r * 0.80, 0.236, "x", 16);
    });
    // hub + bolt bosses on BOTH outer faces only (the wheel is symmetric so
    // either side can face out; the faces toward the hull are never seen)
    [-1, 1].forEach(function (s) {
      cy(K, M.olive, s * 0.285, 0, 0, r * 0.30, r * 0.34, 0.03, "x", 10);
      for (let i = 0; i < 6; i++) {
        const a = i * PI / 3;
        bx(K, M.olive, s * 0.295, Math.sin(a) * r * 0.52, Math.cos(a) * r * 0.52, 0.03, 0.06, 0.06, a);
      }
    });
    return { tyre: T.geo(), disc: K.geo() };
  }
  function sprocketGeo(r, teeth) {
    const M = mats(), K = new Kit();
    [-1, 1].forEach(function (s) {
      cy(K, M.oliveD, s * 0.16, 0, 0, r * 0.88, r * 0.88, 0.07, "x", 22);
      for (let i = 0; i < teeth; i++) {
        const a = i * 2 * PI / teeth;
        bx(K, M.oliveD, s * 0.16, Math.sin(a) * r * 0.95, Math.cos(a) * r * 0.95, 0.07, r * 0.26, r * 0.22, PI / 2 - a);
      }
    });
    cy(K, M.oliveD, 0, 0, 0, r * 0.42, r * 0.42, 0.40, "x", 14);
    for (let i = 0; i < 8; i++) {
      const a = i * PI / 4;
      [-1, 1].forEach(function (s) { bx(K, M.oliveD, s * 0.21, Math.sin(a) * r * 0.30, Math.cos(a) * r * 0.30, 0.03, 0.05, 0.05, a); });
    }
    return K.geo();
  }
  // one track shoe: local length along Z, +Y is INSIDE the loop (centre guide
  // horn), -Y is the ground side (rubber pads), end connectors at the joint.
  function shoeGeo(width, pitch, thick) {
    const M = mats(), K = new Kit();
    // plate + end connectors as one piece (the connectors are the plate's
    // ends standing proud), ground pads, the centre guide horn
    bx(K, M.track, 0, 0, 0, width + 0.07, thick, pitch * 0.86);
    [-1, 1].forEach(function (s) {
      bx(K, M.track, s * width * 0.27, -thick * 0.62, 0, width * 0.38, thick * 0.3, pitch * 0.62);
    });
    bx(K, M.track, 0, thick * 1.2, 0, 0.05, thick * 1.5, pitch * 0.45);
    return K.geo();
  }
  // road wheel for a WHEELED vehicle: tyre with a chevron tread (the spin
  // reads from any side), rim + hub + nuts on the OUTER (+x) face.
  function wheelGeos(r, w) {
    const M = mats(), T = new Kit(), H = new Kit();
    cy(T, M.rubber, 0, 0, 0, r, r, w, "x", 22);
    const lugs = 18;
    for (let i = 0; i < lugs; i++) {
      const a = i * 2 * PI / lugs;
      [-1, 1].forEach(function (s) {
        const aa = a + (s > 0 ? PI / lugs : 0);
        bx(T, M.rubber, s * w * 0.22, Math.sin(aa) * (r + 0.012), Math.cos(aa) * (r + 0.012), w * 0.42, 0.03, r * 0.16, PI / 2 - aa, s * 0.35, 0);
      });
    }
    cy(H, M.olive, w / 2 + 0.004, 0, 0, r * 0.60, r * 0.60, 0.02, "x", 18);
    // hub dome and nuts stay inside the sidewall bulge (the reference
    // widths are measured over the tyres)
    cy(H, M.olive, w / 2 - 0.005, 0, 0, r * 0.20, r * 0.26, 0.05, "x", 12);
    for (let i = 0; i < 8; i++) {
      const a = i * PI / 4;
      bx(H, M.olive, w / 2 + 0.004, Math.sin(a) * r * 0.36, Math.cos(a) * r * 0.36, 0.03, 0.045, 0.045, a);
    }
    cy(H, M.olive, -w / 2 - 0.004, 0, 0, r * 0.55, r * 0.55, 0.02, "x", 18);
    return { tyre: T.geo(), hub: H.geo() };
  }

  // InstancedMesh with its bounds set to the WHOLE running-gear envelope: r128
  // builds InstancedMesh with frustumCulled=false and bounds from the one
  // instance geometry, so without this a parked tank's tracks would draw from
  // anywhere in the world and Box3.setFromObject would read a wheel at y=0.
  function gearIM(geo, mat, count, env, name) {
    geo.boundingBox = env.clone();
    geo.boundingSphere = new THREE.Sphere();
    env.getBoundingSphere(geo.boundingSphere);
    const im = new THREE.InstancedMesh(geo, mat, count);
    im.name = name; im.frustumCulled = true;
    im.castShadow = true; im.receiveShadow = true;
    return im;
  }

  // Write every running-gear matrix for (dist, yawAcc, steer). dist(x) is how
  // far the ground has rolled under a wheel at lateral offset x: the centre
  // distance minus the accumulated heading change times x (the inside track
  // runs slower in a turn, and backwards in a pivot).
  const _tr = {};
  function poseGear(ims, spec, dist, yawAcc, steer) {
    const sets = spec.wheelSets;
    for (let si = 0; si < sets.length; si++) {
      const ws = sets[si], list = ims.sets[si];
      for (let i = 0; i < ws.items.length; i++) {
        const it = ws.items[i];
        const ang = (dist - yawAcc * it.x) / it.r;
        const flip = ws.handed && it.x < 0;
        M4(it.x, it.y, it.z, flip ? -ang : ang, (it.steer ? steer * it.steer : 0) + (flip ? PI : 0), 0, it.s, it.s, it.s, "YXZ");
        for (let k = 0; k < list.length; k++) list[k].setMatrixAt(i, _m);
      }
      for (let k = 0; k < list.length; k++) list[k].instanceMatrix.needsUpdate = true;
    }
    const tr = spec.track;
    if (tr && ims.track) {
      for (let side = 0; side < tr.xs.length; side++) {
        const x = tr.xs[side], ph = -(dist - yawAcc * x);
        for (let i = 0; i < tr.n; i++) {
          tr.belt.at(ph + i * tr.pitch, _tr);
          M4(x, _tr.y, _tr.z, Math.atan2(-_tr.ty, _tr.tz), 0, 0);
          ims.track.setMatrixAt(side * tr.n + i, _m);
        }
      }
      ims.track.instanceMatrix.needsUpdate = true;
    }
  }

  // Build the gear for a template: wheel sets + optional track, posed at rest.
  function buildGear(root, spec, parts) {
    const env = new THREE.Box3();
    spec.wheelSets.forEach(function (ws) {
      ws.items.forEach(function (it) {
        const R = it.r * it.s + 0.1;
        env.expandByPoint(_p.set(it.x - 0.45, it.y - R, it.z - R));
        env.expandByPoint(_p.set(it.x + 0.45, it.y + R, it.z + R));
      });
    });
    if (spec.track) {
      const tr = spec.track;
      for (let i = 0; i < tr.xs.length; i++) {
        env.expandByPoint(_p.set(tr.xs[i] - tr.w, -0.05, tr.zMin));
        env.expandByPoint(_p.set(tr.xs[i] + tr.w, tr.yMax, tr.zMax));
      }
    }
    env.min.y = 0;                               // the gear stands ON the ground
    const ims = { sets: [], track: null };
    spec.wheelSets.forEach(function (ws, si) {
      const list = [];
      ws.names.forEach(function (nm, k) {
        const im = gearIM(parts[si][k].geo, parts[si][k].mat, ws.items.length, env, nm);
        root.add(im); list.push(im);
      });
      ims.sets.push(list);
    });
    if (spec.track) {
      ims.track = gearIM(parts.track.geo, parts.track.mat, spec.track.n * spec.track.xs.length, env, "track");
      root.add(ims.track);
    }
    poseGear(ims, spec, 0, 0, 0);
    return ims;
  }

  // Tracked running gear spec from real numbers.
  //   o: { xs:[±track centre], w: track width, wheelR, wheelY, wheelZ:[...],
  //        drive:{z,y,r} (sprocket), idler:{z,y,r}, rollers:[z...], rollerR,
  //        pitch, thick, teeth }
  function trackedSpec(o) {
    const off = o.thick / 2;
    // the shoe's pads hang 0.77 t below its centre: that is what meets the
    // ground, so the road-wheel axle height follows from wheel + shoe + pad
    o.wheelY = o.wheelR + o.thick * 1.27;
    const wz = o.wheelZ.slice().sort(function (a, b) { return a - b; });
    const rear = wz[0], front = wz[wz.length - 1];
    const aft = o.drive.z < o.idler.z ? o.drive : o.idler;
    const fore = o.drive.z < o.idler.z ? o.idler : o.drive;
    const circles = [
      { z: rear, y: o.wheelY, r: o.wheelR + off },
      { z: front, y: o.wheelY, r: o.wheelR + off },
      { z: fore.z, y: fore.y, r: fore.r + off },
      { z: aft.z, y: aft.y, r: aft.r + off },
    ];
    const B = belt(circles);
    const n = Math.round(B.length / o.pitch);
    // top run height under the return rollers (the longest upper segment)
    let top = null;
    B.segs.forEach(function (s) { if (s.line && s.y0 > o.wheelY + 0.2 && (!top || s.len > top.len)) top = s; });
    function topY(z) { if (!top) return o.wheelY + o.wheelR; const t = (z - top.z0) / top.dz; return top.y0 + top.dy * t; }
    const wheels = [], sprock = [];
    o.xs.forEach(function (x) {
      o.wheelZ.forEach(function (z) { wheels.push({ x: x, y: o.wheelY, z: z, r: o.wheelR, s: 1 }); });
      wheels.push({ x: x, y: o.idler.y, z: o.idler.z, r: o.idler.r, s: o.idler.r / o.wheelR });
      (o.rollers || []).forEach(function (z) {
        const rr = o.rollerR || 0.12;
        wheels.push({ x: x, y: topY(z) - off - rr, z: z, r: rr, s: rr / o.wheelR });
      });
      sprock.push({ x: x, y: o.drive.y, z: o.drive.z, r: o.drive.r, s: 1 });
    });
    return {
      wheelSets: [
        { names: ["rw:tyre", "rw:disc"], items: wheels, handed: false },
        { names: ["sprocket"], items: sprock, handed: false },
      ],
      track: {
        belt: B, n: n, pitch: B.length / n, xs: o.xs, w: o.w,
        zMin: Math.min(aft.z - aft.r, rear - o.wheelR) - 0.2, zMax: Math.max(fore.z + fore.r, front + o.wheelR) + 0.2,
        yMax: Math.max(aft.y + aft.r, fore.y + fore.r) + 0.2,
      },
      trackWidth: o.w, wheelR: o.wheelR, shoes: n,
    };
  }
  function trackedParts(o) {
    const M = mats(), rw = roadWheelGeos(o.wheelR);
    const parts = [
      [{ geo: rw.tyre, mat: M.rubber }, { geo: rw.disc, mat: M.olive }],
      [{ geo: sprocketGeo(o.drive.r, o.teeth || 11), mat: M.oliveD }],
    ];
    parts.track = { geo: shoeGeo(o.w, o.pitch, o.thick), mat: M.track };
    return parts;
  }
  // Wheeled running gear: axles [{z, steer}] at ±x.
  function wheeledSpec(o) {
    const items = [];
    o.axles.forEach(function (ax) {
      [1, -1].forEach(function (s) { items.push({ x: s * o.x, y: o.r + 0.027, z: ax.z, r: o.r, s: 1, steer: ax.steer || 0 }); });
    });
    return { wheelSets: [{ names: ["wh:tyre", "wh:hub"], items: items, handed: true }], track: null, wheelR: o.r };
  }
  function wheeledParts(o) {
    const M = mats(), g = wheelGeos(o.r, o.w);
    return [[{ geo: g.tyre, mat: M.rubber }, { geo: g.hub, mat: M.olive }]];
  }

  // ============================================================ SHARED BITS
  function headlight(K, x, y, z, r) {
    const M = mats();
    cy(K, M.oliveD, x, y, z - 0.03, r * 1.2, r * 1.2, 0.08, "z", 10);
    cy(K, M.lamp, x, y, z + 0.015, r, r, 0.02, "z", 10);
  }
  function smokeBank(K, s, x, y, z, rows, cols) {
    const M = mats();
    bx(K, M.oliveD, x, y, z + (cols - 1) * 0.08, 0.10, rows * 0.13 + 0.04, cols * 0.16 + 0.04, 0, 0, 0);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        cy(K, M.oliveD, x + s * 0.08, y + (r - (rows - 1) / 2) * 0.13, z + c * 0.16, 0.05, 0.05, 0.20, "x", 8, 0, 0, s * 0.45);
      }
    }
  }
  function periscope(K, x, y, z, ry) {
    const M = mats();
    bx(K, M.oliveD, x, y, z, 0.20, 0.10, 0.14, 0, ry || 0, 0);
    bx(K, M.glass, x + Math.sin(ry || 0) * 0.071, y + 0.01, z + Math.cos(ry || 0) * 0.071, 0.15, 0.05, 0.01, 0, ry || 0, 0);
  }
  function antenna(K, x, y, z, len, lean) {
    const M = mats();
    cy(K, M.oliveD, x, y + 0.05, z, 0.05, 0.06, 0.10, "y", 8);
    const dy = Math.cos(lean), dz = -Math.sin(lean);
    cy(K, M.gun, x, y + 0.10 + dy * len / 2, z + dz * len / 2, 0.006, 0.012, len, "y", 5, -lean, 0, 0);
  }
  function mg(K, x, y, z, len, heavy) {
    const M = mats(), k = heavy ? 1 : 0.75;
    bx(K, M.gun, x, y, z, 0.13 * k, 0.16 * k, 0.60 * k);
    cy(K, M.gun, x, y + 0.02 * k, z + 0.3 * k + len / 2, 0.022 * k, 0.03 * k, len, "z", 8);
    bx(K, M.olive, x + 0.13 * k, y - 0.03, z - 0.05, 0.12 * k, 0.15 * k, 0.26 * k);
    cy(K, M.oliveD, x, y - 0.20 * k, z - 0.1, 0.035, 0.04, 0.30 * k, "y", 6);
  }

  // A template is a Group + the plain-data spec its rig reads. Instances are
  // clones that share every geometry/material; the rig is created per clone.
  const TPL = {};
  function instance(key, build) {
    let t = TPL[key];
    if (!t) { t = TPL[key] = build(); }
    const g = t.group.clone();
    g.name = t.group.name;
    const ud = g.userData;
    const rig = new Rig(g, t.spec);
    hide(ud, "rig", rig);
    if (rig.turret) hide(ud, "turret", rig.turret);
    if (rig.lYaw) hide(ud, "patriotLauncher", rig.lYaw);
    if (rig.muzzles.length) hide(ud, "patriotMuzzles", rig.muzzles);
    ud.armorType = t.spec.type;
    if (t.spec.launcher) ud.patriotAmmo = t.spec.launcher.n;
    return { group: g, footW: t.spec.footW, footL: t.spec.footL, height: t.spec.height };
  }
  function shell(name) {
    const root = new THREE.Group(); root.name = name;
    const body = new THREE.Group(); body.name = "body"; body.position.y = 0.9;
    const hull = new THREE.Group(); hull.name = "hull"; hull.position.y = -0.9;
    body.add(hull); root.add(body);
    return { root: root, hull: hull };
  }

  // ============================================================ THE MBT
  // Numbers: hull 7.93 m, width over skirts 3.66 m, turret roof 2.44 m,
  // ground clearance 0.48 m, 7 road wheels (0.635 m) a side, 0.635 m track,
  // 120 mm L/44 tube = 5.28 m breech-to-muzzle, gun -10°/+20°.
  const MBT = {
    L: 7.93, W: 3.66, roof: 2.42, deck: 1.72, belly: 0.48, trackW: 0.635, trackX: 1.44,
    ringZ: 0.30, pivot: { y: 0.36, z: 1.00 }, tube: 5.28, breech: 0.73,
  };
  function buildMBT() {
    const M = mats(), S = shell("mbt"), K = new Kit();
    const D = MBT.deck, HL = MBT.L / 2;
    // ---- hull tub between the tracks: belly, lower nose plate, long shallow
    // glacis (≈ 18° off horizontal), deck, near-vertical rear plate
    const glacisTopZ = 2.05, noseY = 1.08;
    const tub = [[-3.62, MBT.belly], [3.25, MBT.belly], [3.92, 1.00], [HL - 0.015, noseY], [glacisTopZ, D], [-HL + 0.03, D], [-HL, 0.86]];
    prof(K, M.olive, -1.11, 1.11, tub);
    const gy = function (z) { return noseY + (HL - z) * (D - noseY) / (HL - glacisTopZ); };
    // ---- sponsons over the tracks, their front on the glacis line
    [-1, 1].forEach(function (s) {
      const zf = HL - (1.20 - noseY) * (HL - glacisTopZ) / (D - noseY);
      prof(K, M.olive, s > 0 ? 1.11 : -1.77, s > 0 ? 1.77 : -1.11, [[-HL + 0.05, 1.20], [zf, 1.20], [glacisTopZ, D], [-HL + 0.05, D]]);
      // front fender over the idler + mud flap
      bx(K, M.olive, s * 1.44, 1.19, (zf + HL) / 2, 0.66, 0.04, HL - zf);
      bx(K, M.oliveD, s * 1.44, 1.05, HL - 0.03, 0.62, 0.28, 0.02);
      // SIDE SKIRT: armoured plate with a stepped front panel, panel seams
      const skirt = [[-3.72, 0.60], [3.10, 0.60], [3.62, 0.96], [3.62, 1.30], [-3.72, 1.30]];
      prof(K, M.olive, s > 0 ? 1.77 : -1.83, s > 0 ? 1.83 : -1.77, skirt);
      for (let z = -3.1; z < 3.2; z += 0.88) bx(K, M.oliveD, s * 1.834, 0.95, z, 0.012, 0.68, 0.035);
      bx(K, M.oliveD, s * 1.834, 1.26, -0.3, 0.012, 0.04, 6.8);
      // headlight cluster on the fender, behind a guard
      headlight(K, s * 1.50, 1.33, HL - 0.10, 0.07);
      bx(K, M.oliveD, s * 1.50, 1.38, HL - 0.01, 0.30, 0.03, 0.03);
      bx(K, M.tail, s * 1.52, 1.62, -HL - 0.005, 0.12, 0.08, 0.02);
      // tow shackles on the nose and the rear plate
      bx(K, M.oliveD, s * 0.78, 0.96, HL + 0.03, 0.10, 0.16, 0.10);
      bx(K, M.oliveD, s * 0.78, 0.98, -HL - 0.04, 0.10, 0.16, 0.10);
      // engine-deck grille panels with louvre slats
      bx(K, M.gun, s * 0.58, D + 0.012, -2.75, 0.92, 0.02, 1.70);
      for (let i = 0; i < 10; i++) bx(K, M.olive, s * 0.58, D + 0.03, -3.55 + i * 0.18, 0.96, 0.03, 0.05);
      // deck hatches over the fuel cells, and a stowage box on the sponson
      bx(K, M.oliveD, s * 1.40, D + 0.02, -1.40, 0.62, 0.04, 1.20);
      bx(K, M.olive, s * 1.50, D + 0.16, 1.2, 0.40, 0.30, 0.9);
    });
    // driver's hatch + three periscopes at the glacis crest
    const hz = 2.45;
    bx(K, M.oliveD, 0, gy(hz) + 0.03, hz, 0.90, 0.05, 0.70, Math.atan((D - noseY) / (HL - glacisTopZ)), 0, 0);
    [-0.26, 0, 0.26].forEach(function (x) { periscope(K, x, D + 0.05, glacisTopZ - 0.10, 0); });
    // rear: exhaust grille + louvres, pintle
    bx(K, M.gun, 0, 1.40, -HL - 0.01, 1.70, 0.46, 0.03);
    for (let i = 0; i < 5; i++) bx(K, M.olive, 0, 1.22 + i * 0.09, -HL - 0.035, 1.74, 0.025, 0.04);
    bx(K, M.oliveD, 0, 0.78, -HL - 0.08, 0.22, 0.14, 0.18);
    // turret ring collar
    cy(K, M.oliveD, 0, D + 0.03, MBT.ringZ, 1.12, 1.16, 0.06, "y", 24);
    K.into(S.hull, "hull");

    // ---- TURRET: angled cheeks either side of the gun slot, flat-sided body
    // with a long bustle; roof at 2.42.
    const turret = new THREE.Group(); turret.name = "turret";
    turret.position.set(0, D, MBT.ringZ); S.hull.add(turret);
    const T = new Kit();
    const TH = MBT.roof - D;                                  // 0.70
    plan(T, M.olive, [
      [0.00, [[-1.56, 0.90], [1.56, 0.90], [1.64, -1.20], [1.50, -2.60], [-1.50, -2.60], [-1.64, -1.20]]],
      [TH, [[-1.40, 0.80], [1.40, 0.80], [1.49, -1.20], [1.36, -2.50], [-1.36, -2.50], [-1.49, -1.20]]],
    ]);
    [-1, 1].forEach(function (s) {
      const ch = function (fz, fo, w) { return [[s * 0.40, fz], [s * w, fo], [s * w, 0.86], [s * 0.40, 0.86]]; };
      plan(T, M.olive, [[0.04, ch(1.84, 1.46, 1.54)], [0.30, ch(2.02, 1.58, 1.58)], [TH, ch(1.86, 1.46, 1.42)]]);
      // side bustle boxes, smoke dischargers on the cheek sides
      bx(T, M.olive, s * 1.66, 0.34, -1.75, 0.16, 0.46, 1.30);
      smokeBank(T, s, s * 1.60, 0.42, 0.62, 2, 3);
    });
    // commander's cupola (right): ring, vision blocks, hatch, heavy MG
    const cx = 0.74, cz = -0.55;
    cy(T, M.oliveD, cx, TH + 0.07, cz, 0.40, 0.43, 0.14, "y", 16);
    for (let i = 0; i < 6; i++) {
      const a = i * PI / 3 + 0.3;
      bx(T, M.glass, cx + Math.sin(a) * 0.40, TH + 0.09, cz + Math.cos(a) * 0.40, 0.14, 0.06, 0.02, 0, a, 0);
    }
    cy(T, M.olive, cx, TH + 0.165, cz, 0.33, 0.34, 0.05, "y", 14);
    mg(T, cx - 0.05, TH + 0.42, cz + 0.28, 0.95, true);
    // loader's hatch (left) + skate-mounted MG
    cy(T, M.oliveD, -0.70, TH + 0.015, -0.40, 0.44, 0.44, 0.03, "y", 16);
    cy(T, M.olive, -0.70, TH + 0.045, -0.40, 0.33, 0.33, 0.05, "y", 14);
    mg(T, -0.70, TH + 0.33, -0.02, 0.60, false);
    // gunner's primary sight "doghouse" + its window, commander's viewer
    bx(T, M.olive, 0.62, TH + 0.16, 0.45, 0.50, 0.32, 0.70);
    bx(T, M.glass, 0.62, TH + 0.18, 0.805, 0.38, 0.18, 0.012);
    bx(T, M.oliveD, 0.62, TH + 0.33, 0.45, 0.54, 0.03, 0.74);
    cy(T, M.oliveD, -0.18, TH + 0.12, -0.05, 0.12, 0.14, 0.24, "y", 10);
    bx(T, M.olive, -0.18, TH + 0.33, -0.05, 0.34, 0.22, 0.34);
    bx(T, M.glass, -0.18, TH + 0.33, 0.125, 0.24, 0.12, 0.012);
    // wind sensor mast, two tied-down antennas
    cy(T, M.oliveD, 0.05, TH + 0.22, -1.30, 0.02, 0.025, 0.44, "y", 6);
    bx(T, M.oliveD, 0.05, TH + 0.44, -1.30, 0.26, 0.02, 0.02);
    antenna(T, 1.18, TH, -2.25, 1.05, 1.2);
    antenna(T, -1.18, TH, -2.25, 1.05, 1.2);
    // BUSTLE RACK: a steel basket round the rear with the crew's kit in it
    const rz0 = -2.55, rz1 = -3.08;
    bx(T, M.oliveD, 0, 0.62, rz1, 2.92, 0.04, 0.04);
    bx(T, M.oliveD, 0, 0.12, rz1, 2.92, 0.04, 0.04);
    [-1, 1].forEach(function (s) {
      bx(T, M.oliveD, s * 1.46, 0.62, (rz0 + rz1) / 2, 0.04, 0.04, rz0 - rz1 + 0.1);
      bx(T, M.oliveD, s * 1.46, 0.12, (rz0 + rz1) / 2, 0.04, 0.04, rz0 - rz1 + 0.1);
    });
    [-1.46, -0.73, 0, 0.73, 1.46].forEach(function (x) { bx(T, M.oliveD, x, 0.37, rz1, 0.04, 0.54, 0.04); });
    bx(T, M.oliveD, 0, 0.10, (rz0 + rz1) / 2, 2.9, 0.02, 0.5);
    bx(T, M.canvas, -0.95, 0.33, -2.82, 0.95, 0.42, 0.42);
    bx(T, M.oliveL, 0.12, 0.29, -2.83, 0.80, 0.34, 0.40);
    bx(T, M.canvas, 0.98, 0.36, -2.81, 0.66, 0.46, 0.42);
    cy(T, M.oliveL, 0, 0.58, -2.80, 0.13, 0.13, 2.4, "x", 10);
    T.into(turret, "turret-plate");

    // ---- GUN: trunnion pivot, mantlet, then the recoiling tube
    const gun = new THREE.Group(); gun.name = "gun";
    gun.position.set(0, MBT.pivot.y, MBT.pivot.z); turret.add(gun);
    const G = new Kit();
    bx(G, M.olive, 0, 0, 0.50, 0.78, 0.52, 0.96);
    bx(G, M.olive, 0, 0, 1.00, 0.62, 0.42, 0.08);
    cy(G, M.olive, 0, 0, 1.10, 0.23, 0.26, 0.14, "z", 16);
    G.into(gun, "mantlet");
    const tube = new THREE.Group(); tube.name = "tube"; gun.add(tube);
    const U = new Kit(), muz = MBT.tube - MBT.breech;         // 4.55 m pivot → muzzle
    const rAt = function (z) { return 0.155 - (z + MBT.breech) / MBT.tube * 0.035; };
    cy(U, M.olive, 0, 0, (muz - MBT.breech) / 2, rAt(muz), rAt(-MBT.breech), MBT.tube, "z", 16);
    [1.40, 2.10, 3.85, 4.20].forEach(function (z) { cy(U, M.olive, 0, 0, z, rAt(z) + 0.014, rAt(z) + 0.014, 0.05, "z", 16); });
    // bore evacuator: the bulge 55% out, tapered both ends
    cy(U, M.olive, 0, 0, 2.85, 0.172, 0.172, 0.60, "z", 18);
    cy(U, M.olive, 0, 0, 3.225, rAt(3.3), 0.172, 0.15, "z", 18);
    cy(U, M.olive, 0, 0, 2.475, 0.172, rAt(2.4), 0.15, "z", 18);
    cy(U, M.olive, 0, 0, muz - 0.06, 0.128, 0.128, 0.12, "z", 16);
    cy(U, M.gun, 0, 0, muz + 0.004, 0.060, 0.060, 0.01, "z", 14);
    bx(U, M.olive, 0, 0.155, muz - 0.14, 0.07, 0.06, 0.12);
    U.into(tube, "tube-steel");
    const muzzle = new THREE.Object3D(); muzzle.name = "muzzle"; muzzle.position.set(0, 0, muz + 0.05); tube.add(muzzle);

    // ---- running gear
    const go = {
      xs: [MBT.trackX, -MBT.trackX], w: MBT.trackW, wheelR: 0.3175, wheelY: 0.3175 + 0.06,
      wheelZ: [-2.55, -1.65, -0.75, 0.15, 1.05, 1.95, 2.85],
      drive: { z: -3.55, y: 0.80, r: 0.33 }, idler: { z: 3.52, y: 0.70, r: 0.30 },
      rollers: [-2.1, -0.3, 1.5], rollerR: 0.11, pitch: 0.19, thick: 0.06, teeth: 11,
    };
    const spec = trackedSpec(go);
    buildGear(S.root, spec, trackedParts(go));
    Object.assign(spec, {
      type: "mbt", footW: MBT.W, footL: MBT.L, height: 2.90,
      turret: { rate: 0.75, elevMin: -0.17, elevMax: 0.35, elevRate: 0.45 },
      recoil: 0.46, rock: 0.028, squat: 0.0045, maxSteer: 0,
      weapon: "cannon", tune: { top: 14, rev: 6, accel: 8, turn: 0.9 },
      dims: {
        length: MBT.L, width: MBT.W, roof: MBT.roof, belly: MBT.belly, trackW: MBT.trackW,
        barrel: MBT.tube, gunOverhang: MBT.ringZ + MBT.pivot.z + muz + 0.05 - MBT.L / 2, roadWheels: go.wheelZ.length,
      },
    });
    return { group: S.root, spec: spec };
  }

  // ============================================================ THE IFV
  // Bradley/CV90 class: 6.55 m, 3.28 m over skirts, hull roof 1.95, turret
  // roof 2.70, 6 road wheels a side, FRONT drive sprocket, 0.53 m track.
  function buildIFV() {
    const M = mats(), S = shell("ifv"), K = new Kit();
    const L = 6.55, HL = L / 2, D = 1.95, belly = 0.45;
    prof(K, M.olive, -1.07, 1.07, [[-3.16, belly], [2.55, belly], [3.25, 0.98], [HL, 1.12], [2.05, D], [-HL, D], [-HL, 0.70]]);
    const gly = function (z) { return 1.12 + (HL - z) * (D - 1.12) / (HL - 2.05); };
    [-1, 1].forEach(function (s) {
      const zf = HL - (1.16 - 1.12) * (HL - 2.05) / (D - 1.12);
      prof(K, M.olive, s > 0 ? 1.07 : -1.60, s > 0 ? 1.60 : -1.07, [[-HL, 1.16], [zf, 1.16], [2.05, D], [-HL, D]]);
      prof(K, M.olive, s > 0 ? 1.60 : -1.64, s > 0 ? 1.64 : -1.60, [[-3.05, 0.56], [2.55, 0.56], [3.00, 0.92], [3.00, 1.16], [-3.05, 1.16]]);
      // bolted applique tiles on the upper hull side
      for (let i = 0; i < 5; i++) bx(K, M.oliveD, s * 1.63, 1.56, -2.55 + i * 1.08, 0.04, 0.62, 1.0);
      for (let i = 0; i < 20; i++) bx(K, M.oliveL, s * 1.655, 1.30 + (i % 2) * 0.52, -2.95 + Math.floor(i / 2) * 0.54, 0.02, 0.03, 0.03);
      headlight(K, s * 1.25, gly(3.05) + 0.05, 3.08, 0.07);
      bx(K, M.tail, s * 1.35, 1.75, -HL - 0.005, 0.10, 0.08, 0.02);
      bx(K, M.oliveD, s * 0.70, 0.98, HL + 0.02, 0.10, 0.16, 0.10);
      bx(K, M.olive, s * 1.30, 1.17, 2.95, 0.56, 0.03, 0.45);
    });
    // engine grille front-right, driver's hatch + periscopes front-left
    bx(K, M.gun, 0.62, D + 0.012, 1.35, 0.80, 0.02, 1.10);
    for (let i = 0; i < 7; i++) bx(K, M.olive, 0.62, D + 0.03, 0.87 + i * 0.16, 0.84, 0.025, 0.04);
    cy(K, M.oliveD, -0.62, D + 0.05, 1.45, 0.34, 0.36, 0.10, "y", 14);
    [-0.2, 0, 0.2].forEach(function (a) { periscope(K, -0.62 + Math.sin(a) * 0.30, D + 0.13, 1.45 + Math.cos(a) * 0.30, a); });
    // rear troop ramp: frame, hinge line, the door in it
    bx(K, M.oliveD, 0, 1.22, -HL - 0.02, 1.90, 1.30, 0.03);
    bx(K, M.olive, 0.35, 1.25, -HL - 0.04, 0.62, 1.05, 0.02);
    bx(K, M.oliveD, 0, 0.58, -HL - 0.06, 1.90, 0.08, 0.08);
    // roof cargo hatch
    bx(K, M.oliveD, 0, D + 0.02, -2.30, 1.30, 0.04, 1.10);
    K.into(S.hull, "hull");

    // turret: offset right like the real one
    const turret = new THREE.Group(); turret.name = "turret";
    turret.position.set(0.22, D, 0.05); S.hull.add(turret);
    const T = new Kit(), TH = 0.72;
    plan(T, M.olive, [
      [0, [[-1.05, 0.98], [1.05, 0.98], [1.14, -0.85], [0.95, -1.32], [-0.95, -1.32], [-1.14, -0.85]]],
      [0.30, [[-1.05, 1.02], [1.05, 1.02], [1.14, -0.85], [0.95, -1.32], [-0.95, -1.32], [-1.14, -0.85]]],
      [TH, [[-0.86, 0.62], [0.86, 0.62], [0.96, -0.80], [0.82, -1.20], [-0.82, -1.20], [-0.96, -0.80]]],
    ]);
    // twin missile launcher box stowed against the left side
    bx(T, M.olive, -1.38, 0.46, -0.05, 0.44, 0.42, 1.30);
    [-0.1, 0.1].forEach(function (dx) { cy(T, M.gun, -1.38 + dx, 0.46, 0.605, 0.08, 0.08, 0.02, "z", 10); });
    bx(T, M.oliveD, -1.17, 0.46, -0.05, 0.04, 0.10, 0.8);
    // commander hatch (right rear), gunner's sight (left front), smoke banks
    cy(T, M.oliveD, 0.45, TH + 0.05, -0.55, 0.34, 0.36, 0.10, "y", 14);
    cy(T, M.olive, 0.45, TH + 0.12, -0.55, 0.28, 0.28, 0.04, "y", 12);
    for (let i = 0; i < 5; i++) { const a = -0.9 + i * 0.45; periscope(T, 0.45 + Math.sin(a) * 0.36, TH + 0.08, -0.55 + Math.cos(a) * 0.36, a); }
    bx(T, M.olive, -0.35, TH + 0.14, 0.22, 0.42, 0.28, 0.48);
    bx(T, M.glass, -0.35, TH + 0.16, 0.465, 0.30, 0.14, 0.012);
    [-1, 1].forEach(function (s) { smokeBank(T, s, s * 1.08, 0.50, 0.38, 2, 2); });
    antenna(T, 0.80, TH, -1.05, 0.75, 1.35);
    antenna(T, -0.80, TH, -1.05, 0.75, 1.35);
    // bustle stowage
    bx(T, M.canvas, 0, 0.35, -1.52, 1.5, 0.40, 0.36);
    T.into(turret, "turret-plate");

    const gun = new THREE.Group(); gun.name = "gun"; gun.position.set(0.10, 0.40, 0.98); turret.add(gun);
    const G = new Kit();
    bx(G, M.olive, 0, 0, 0.14, 0.46, 0.38, 0.34);
    bx(G, M.gun, 0.28, -0.04, 0.26, 0.06, 0.06, 0.20);
    G.into(gun, "mantlet");
    const tube = new THREE.Group(); tube.name = "tube"; gun.add(tube);
    const U = new Kit(), bl = 2.75, back = 0.2, muz = bl - back;
    cy(U, M.gun, 0, 0, (muz - back) / 2, 0.042, 0.048, bl, "z", 10);
    cy(U, M.gun, 0, 0, 0.55, 0.07, 0.075, 0.60, "z", 12);
    cy(U, M.gun, 0, 0, muz - 0.09, 0.062, 0.062, 0.18, "z", 10);
    cy(U, M.gun, 0.28, -0.04, 0.60, 0.018, 0.018, 0.45, "z", 6);
    U.into(tube, "tube-steel");
    const muzzle = new THREE.Object3D(); muzzle.name = "muzzle"; muzzle.position.set(0, 0, muz + 0.03); tube.add(muzzle);

    const go = {
      xs: [1.33, -1.33], w: 0.53, wheelR: 0.305, wheelY: 0.305 + 0.055,
      wheelZ: [-2.15, -1.30, -0.45, 0.40, 1.25, 2.10],
      drive: { z: 2.92, y: 0.82, r: 0.30 }, idler: { z: -2.92, y: 0.66, r: 0.29 },
      rollers: [-1.4, 0.2, 1.8], rollerR: 0.10, pitch: 0.155, thick: 0.055, teeth: 12,
    };
    const spec = trackedSpec(go);
    buildGear(S.root, spec, trackedParts(go));
    Object.assign(spec, {
      type: "ifv", footW: 3.28, footL: L, height: 2.95,
      turret: { rate: 1.1, elevMin: -0.16, elevMax: 0.95, elevRate: 0.9 },
      recoil: 0.07, rock: 0.004, squat: 0.004, maxSteer: 0,
      weapon: "autocannon", tune: { top: 17, rev: 7, accel: 9, turn: 1.0 },
      dims: { length: L, width: 3.28, roof: D + TH, belly: belly, trackW: go.w, barrel: bl, roadWheels: go.wheelZ.length },
    });
    return { group: S.root, spec: spec };
  }

  // ============================================================ THE 8x8 APC
  // Stryker/Patria class: 6.95 x 2.72 m, hull roof 2.10, RWS to ~2.65,
  // 1.12 m wheels, front two axles steer.
  function apcSec(bw, by, cw, cyy, sw, sy, rw, ry) { return sym([[bw, by], [cw, cyy], [sw, sy], [rw, ry]]); }
  function buildAPC() {
    const M = mats(), S = shell("apc"), K = new Kit();
    const L = 6.95, HL = L / 2, W = 2.72, R = 0.56;
    sect(K, M.olive, [
      [-HL, apcSec(0.88, 0.62, 1.27, 0.98, 1.27, 1.60, 1.10, 2.06)],
      [-HL + 0.18, apcSec(0.93, 0.56, 1.32, 0.95, 1.32, 1.62, 1.14, 2.10)],
      [2.05, apcSec(0.93, 0.56, 1.32, 0.95, 1.32, 1.62, 1.14, 2.10)],
      [3.05, apcSec(0.90, 0.62, 1.29, 0.98, 1.26, 1.42, 1.03, 1.62)],
      [HL, apcSec(0.78, 0.92, 1.15, 1.05, 1.09, 1.28, 0.88, 1.36)],
    ]);
    // wheel-arch lips (the wheels run up inside the flare)
    [2.35, 1.10, -0.85, -2.10].forEach(function (z) {
      [-1, 1].forEach(function (s) { bx(K, M.oliveD, s * 1.33, 0.97, z, 0.05, 0.05, 1.30); });
    });
    [-1, 1].forEach(function (s) {
      // side stowage bins, an exhaust louvre (right), headlights, tail lights
      bx(K, M.olive, s * 1.35, 1.35, -0.1, 0.05, 0.42, 1.10);
      bx(K, M.olive, s * 1.35, 1.35, -1.55, 0.05, 0.42, 1.10);
      headlight(K, s * 0.95, 1.33, HL - 0.01, 0.07);
      bx(K, M.tail, s * 1.10, 1.85, -HL - 0.005, 0.10, 0.08, 0.02);
      bx(K, M.oliveD, s * 0.62, 0.95, HL + 0.04, 0.12, 0.16, 0.12);
      // vision blocks round the troop compartment
      periscope(K, s * 1.05, 2.12, -1.6, s * PI / 2);
      periscope(K, s * 1.05, 2.12, -0.6, s * PI / 2);
    });
    bx(K, M.gun, 1.33, 1.30, 1.65, 0.03, 0.40, 0.80);
    for (let i = 0; i < 5; i++) bx(K, M.olive, 1.35, 1.14 + i * 0.08, 1.65, 0.02, 0.025, 0.84);
    // driver's hatch front-left with periscopes on the glacis crest
    cy(K, M.oliveD, -0.55, 2.02, 1.70, 0.34, 0.36, 0.10, "y", 14);
    [-0.25, 0, 0.25].forEach(function (a) { periscope(K, -0.55 + Math.sin(a) * 0.30, 2.10, 1.70 + Math.cos(a) * 0.30, a); });
    // commander hatch, rear ramp outline, roof hatches
    cy(K, M.oliveD, 0.55, 2.13, 0.95, 0.36, 0.38, 0.08, "y", 14);
    bx(K, M.oliveD, 0, 1.32, -HL - 0.01, 1.70, 1.25, 0.03);
    bx(K, M.olive, -0.40, 1.35, -HL - 0.03, 0.55, 0.95, 0.02);
    bx(K, M.oliveD, 0, 2.11, -2.2, 1.6, 0.03, 1.4);
    antenna(K, 1.05, 2.10, -2.9, 1.0, 1.2);
    antenna(K, -1.05, 2.10, -2.9, 1.0, 1.2);
    K.into(S.hull, "hull");

    // remote weapon station: traverses + elevates like a turret
    const turret = new THREE.Group(); turret.name = "turret"; turret.position.set(0.15, 2.10, 0.25); S.hull.add(turret);
    const T = new Kit();
    cy(T, M.oliveD, 0, 0.06, 0, 0.34, 0.38, 0.12, "y", 14);
    bx(T, M.olive, 0, 0.30, -0.05, 0.46, 0.34, 0.55);
    bx(T, M.olive, 0.30, 0.42, 0.02, 0.18, 0.22, 0.30);
    bx(T, M.glass, 0.30, 0.42, 0.175, 0.13, 0.12, 0.012);
    T.into(turret, "turret-plate");
    const gun = new THREE.Group(); gun.name = "gun"; gun.position.set(-0.05, 0.36, 0.10); turret.add(gun);
    const G = new Kit();
    bx(G, M.gun, 0, 0, 0.15, 0.16, 0.18, 0.62);
    bx(G, M.olive, -0.17, -0.02, 0.05, 0.14, 0.18, 0.34);
    G.into(gun, "mantlet");
    const tube = new THREE.Group(); tube.name = "tube"; gun.add(tube);
    const U = new Kit();
    cy(U, M.gun, 0, 0.02, 1.02, 0.028, 0.034, 1.14, "z", 8);
    cy(U, M.gun, 0, 0.02, 1.55, 0.04, 0.04, 0.10, "z", 8);
    U.into(tube, "tube-steel");
    const muzzle = new THREE.Object3D(); muzzle.name = "muzzle"; muzzle.position.set(0, 0.02, 1.62); tube.add(muzzle);

    const wo = { r: R, w: 0.38, x: 1.10, axles: [{ z: 2.35, steer: 1 }, { z: 1.10, steer: 0.6 }, { z: -0.85 }, { z: -2.10 }] };
    const spec = wheeledSpec(wo);
    buildGear(S.root, spec, wheeledParts(wo));
    Object.assign(spec, {
      type: "apc", footW: W, footL: L, height: 2.66,
      turret: { rate: 1.4, elevMin: -0.2, elevMax: 1.0, elevRate: 1.2 },
      recoil: 0.03, rock: 0.002, squat: 0.006, maxSteer: 0.42,
      weapon: "hmg", tune: { top: 24, rev: 8, accel: 9, turn: 1.05 },
      dims: { length: L, width: W, roof: 2.10, belly: 0.56, wheelR: R, axles: 4 },
    });
    return { group: S.root, spec: spec };
  }

  // ============================================================ THE 6x6 TRUCK
  // Medium tactical cargo truck: 7.95 x 2.50 m, cab roof 2.85, canvas 3.22,
  // 1.14 m tyres on 3 axles (front + rear tandem).
  const TRK = { L: 7.95, W: 2.50, R: 0.57, axles: [2.70, -1.45, -2.85], cabZ0: 1.20, cabZ1: 2.95, bedZ0: -3.90, bedZ1: 1.05 };
  function truckChassis(K, opt) {
    const M = mats(), HL = TRK.L / 2;
    const armored = !!opt.armored;
    // frame rails + crossmembers
    [-1, 1].forEach(function (s) { bx(K, M.oliveD, s * 0.46, 1.02, -0.05, 0.16, 0.26, 7.7); });
    [-3.6, -2.2, -0.8, 0.6, 2.0, 3.3].forEach(function (z) { bx(K, M.oliveD, 0, 1.02, z, 0.80, 0.18, 0.12); });
    // CAB: tumblehome section, raked windscreen between z 2.62 → 2.95
    const cab = function (top, rw) { return sym([[1.20, 1.16], [1.23, 1.96], [rw, top]]); };
    const roof = armored ? 2.75 : 2.85, wsZ = armored ? 2.72 : 2.62;
    sect(K, armored ? M.oliveD : M.olive, [
      [TRK.cabZ0, cab(roof, 1.10)], [wsZ, cab(roof, 1.10)], [TRK.cabZ1, cab(2.02, 1.21)],
    ]);
    const rake = Math.atan2(TRK.cabZ1 - wsZ, roof - 2.0);
    const wsY = (roof + 2.0) / 2, wsZc = (TRK.cabZ1 + wsZ) / 2 + 0.012;
    const paneH = (roof - 2.06) / Math.cos(rake);
    [-1, 1].forEach(function (s) {
      bx(K, M.glass, s * 0.52, wsY, wsZc, armored ? 0.78 : 0.96, paneH * (armored ? 0.62 : 0.86), 0.02, -rake, 0, 0);
      // door window, leaning in with the tumblehome
      bx(K, M.glass, s * 1.18, 2.36, 2.02, 0.02, armored ? 0.34 : 0.55, armored ? 0.60 : 0.92, 0, 0, s * 0.133);
      // door seam + handle + step
      bx(K, M.oliveD, s * 1.225, 1.60, 1.40, 0.012, 0.80, 0.03);
      bx(K, M.gun, s * 1.23, 1.82, 1.55, 0.02, 0.04, 0.16);
      bx(K, M.oliveD, s * 1.18, 0.88, 2.0, 0.20, 0.04, 0.60);
      // mirror on its arm
      bx(K, M.gun, s * 1.40, 2.30, 2.86, 0.34, 0.03, 0.03);
      bx(K, M.gun, s * 1.58, 2.22, 2.86, 0.05, 0.38, 0.22);
      // front fender over the steer axle, rear fenders under the bed
      bx(K, M.olive, s * 1.04, 1.44, TRK.axles[0], 0.46, 0.05, 1.36);
      bx(K, M.olive, s * 1.04, 1.30, TRK.axles[0] + 0.72, 0.46, 0.30, 0.05, -0.5, 0, 0);
      bx(K, M.olive, s * 1.04, 1.28, -2.15, 0.46, 0.04, 2.70);
      bx(K, M.rubber, s * 1.04, 0.82, -3.55, 0.42, 0.44, 0.02);
      // headlights in the grille shell, tail lights on the rear crossmember
      headlight(K, s * 0.80, 1.46, 3.885, 0.085);
      bx(K, M.tail, s * 0.95, 1.10, -HL + 0.02, 0.14, 0.08, 0.03);
    });
    if (armored) {
      // armour frames round the reduced glass
      bx(K, M.olive, 0, roof - 0.07, TRK.cabZ0 + (wsZ - TRK.cabZ0) / 2, 2.30, 0.06, wsZ - TRK.cabZ0 - 0.1);
      bx(K, M.olive, 0, wsY, wsZc + 0.01, 0.16, paneH, 0.02, -rake, 0, 0);
    }
    // cab rear window
    bx(K, M.glass, 0, 2.40, TRK.cabZ0 - 0.005, 1.30, 0.34, 0.012);
    // HOOD: short square nose with a vertical grille, hood top falling forward
    prof(K, M.olive, -1.03, 1.03, [[TRK.cabZ1 - 0.02, 1.16], [3.82, 1.16], [3.89, 1.30], [3.86, 1.86], [TRK.cabZ1 - 0.02, 1.99]]);
    bx(K, M.gun, 0, 1.58, 3.875, 1.20, 0.46, 0.02);
    for (let i = 0; i < 7; i++) bx(K, M.olive, -0.51 + i * 0.17, 1.58, 3.89, 0.04, 0.46, 0.03);
    // bumper, tow hooks, snorkel (right A-pillar), exhaust stack behind cab
    bx(K, M.oliveD, 0, 1.02, 3.98, 2.40, 0.28, 0.20);
    [-1, 1].forEach(function (s) { bx(K, M.gun, s * 0.62, 0.98, 4.10, 0.08, 0.14, 0.10); });
    cy(K, M.gun, 1.16, 2.35, 2.78, 0.07, 0.07, 1.4, "y", 8);
    cy(K, M.gun, 1.16, 3.07, 2.78, 0.10, 0.08, 0.10, "y", 8);
    cy(K, M.gun, -1.02, 2.25, TRK.cabZ0 - 0.18, 0.065, 0.065, 1.9, "y", 8);
    // fuel tank (left) + battery box (right) between the axles
    cy(K, M.oliveD, -0.92, 0.98, 0.45, 0.28, 0.28, 1.10, "z", 14);
    bx(K, M.oliveD, 0.92, 0.98, 0.45, 0.42, 0.46, 0.90);
    // cab roof hatch (both variants carry one)
    cy(K, M.oliveD, 0.45, roof + 0.03, 1.85, 0.34, 0.34, 0.06, "y", 14);
  }
  function truckBed(K, kind) {
    const M = mats(), z0 = TRK.bedZ0, z1 = TRK.bedZ1, len = z1 - z0, zc = (z0 + z1) / 2;
    bx(K, M.olive, 0, 1.36, zc, 2.46, 0.12, len);
    if (kind === "flat") {
      // deck plating seams + tie-down rails for a launcher module
      for (let z = z0 + 0.5; z < z1; z += 0.9) bx(K, M.oliveD, 0, 1.425, z, 2.40, 0.012, 0.04);
      [-1, 1].forEach(function (s) { bx(K, M.oliveD, s * 1.20, 1.47, zc, 0.06, 0.10, len); });
      return;
    }
    [-1, 1].forEach(function (s) {
      bx(K, M.olive, s * 1.21, 1.72, zc, 0.05, 0.62, len);
      for (let z = z0 + 0.3; z < z1; z += 0.60) bx(K, M.oliveD, s * 1.24, 1.72, z, 0.03, 0.62, 0.06);
      bx(K, M.oliveD, s * 1.245, 1.40, zc, 0.03, 0.10, len);
    });
    bx(K, M.olive, 0, 1.72, z1 - 0.02, 2.46, 0.62, 0.05);
    bx(K, M.olive, 0, 1.72, z0 + 0.03, 2.46, 0.62, 0.06);
    [-0.8, 0.8].forEach(function (x) { bx(K, M.oliveD, x, 1.44, z0 - 0.01, 0.16, 0.06, 0.06); });
    // CANVAS COVER on its bows: an arched section, eaves at 1.98, crown 3.22
    const arch = [[1.25, 1.98], [1.25, 2.72], [1.14, 3.00], [0.84, 3.16], [0.42, 3.22]];
    const archS = function (k) { return sym(arch.map(function (p) { return [p[0] * k, 1.98 + (p[1] - 1.98) * k]; })); };
    sect(K, M.canvas, [[z0, archS(1)], [z1, archS(1)]]);
    for (let i = 0; i < 5; i++) {
      const z = z0 + 0.35 + i * (len - 0.7) / 4;
      sect(K, M.oliveL, [[z - 0.035, archS(1.012)], [z + 0.035, archS(1.012)]]);
    }
    // the rolled rear flap
    cy(K, M.oliveL, 0, 3.02, z0 - 0.06, 0.09, 0.09, 1.9, "x", 10);
  }
  function truckGearSpec() { return { r: TRK.R, w: 0.40, x: 1.03, axles: [{ z: TRK.axles[0], steer: 1 }, { z: TRK.axles[1] }, { z: TRK.axles[2] }] }; }
  function buildTruck(bed) {
    const M = mats(), S = shell(bed === "cargo" ? "truck" : "truck-flat"), K = new Kit();
    truckChassis(K, {});
    truckBed(K, bed);
    K.into(S.hull, "hull");
    const wo = truckGearSpec(), spec = wheeledSpec(wo);
    buildGear(S.root, spec, wheeledParts(wo));
    Object.assign(spec, {
      type: bed === "cargo" ? "truck" : "truck-flat", footW: TRK.W, footL: TRK.L, height: bed === "cargo" ? 3.22 : 2.9,
      rock: 0, squat: 0.006, maxSteer: 0.5, tune: { top: 20, rev: 9, accel: 9, turn: 1.05 },
      dims: { length: TRK.L, width: TRK.W, roof: 2.85, canvas: 3.22, wheelR: TRK.R, axles: 3 },
    });
    return { group: S.root, spec: spec, K: K };
  }

  // ============================================================ LAUNCHERS
  // turntable → launchYaw (mouths at +Z) → launchElev (pivot at the CLOSED
  // end) → pod / canisters. Stowed: yaw π (mouths aft), elevation 0.
  function launcherRig(S, o) {
    const M = mats();
    const K = new Kit();
    cy(K, M.oliveD, 0, 1.52, o.z, o.ringR, o.ringR + 0.06, 0.18, "y", 20);
    K.into(S.hull, "launcher-base");
    const yaw = new THREE.Group(); yaw.name = "launchYaw"; yaw.position.set(0, 1.61, o.z); yaw.rotation.y = PI; S.hull.add(yaw);
    const Y = new Kit();
    // cradle base: side beams + the pivot brackets at the closed end
    [-1, 1].forEach(function (s) {
      bx(Y, M.oliveD, s * (o.podW / 2 - 0.08), 0.10, o.zPivot + o.podL / 2 - 0.2, 0.14, 0.18, o.podL - 0.6);
      bx(Y, M.oliveD, s * (o.podW / 2 - 0.02), 0.26, o.zPivot, 0.12, 0.44, 0.34);
    });
    bx(Y, M.olive, 0, 0.06, 0, o.podW * 0.8, 0.12, 1.2);
    Y.into(yaw, "launcher-cradle");
    const elev = new THREE.Group(); elev.name = "launchElev"; elev.position.set(0, o.pivotY, o.zPivot); yaw.add(elev);
    // hydraulic rams: yaw-space base → a point on the pod; re-aimed live
    const R = new Kit();
    [-1, 1].forEach(function (s) {
      cy(R, M.gun, s * o.ramX, 0.5, 0, 0.07, 0.07, 1.0, "y", 8);
      cy(R, M.olive, s * o.ramX, 0.18, 0, 0.09, 0.09, 0.36, "y", 8);
    });
    const ram = new THREE.Mesh(R.geo(), M.gun); ram.name = "ram";
    ram.castShadow = true; ram.position.set(0, o.ramBase[1], o.ramBase[2]); yaw.add(ram);
    return { yaw: yaw, elev: elev, ram: ram };
  }
  function roundsIM(geo, mat, slots) {
    const b = new THREE.Box3();
    slots.forEach(function (sl) { b.expandByPoint(_p.set(sl[0] - 0.5, sl[1] - 0.5, sl[2] - 0.5)); b.expandByPoint(_p.set(sl[0] + 0.5, sl[1] + 0.5, sl[2] + 0.5)); });
    geo.boundingBox = b; geo.boundingSphere = new THREE.Sphere(); b.getBoundingSphere(geo.boundingSphere);
    const im = new THREE.InstancedMesh(geo, mat, slots.length);
    im.name = "rounds"; im.frustumCulled = true; im.castShadow = true;
    slots.forEach(function (sl, i) { im.setMatrixAt(i, M4(sl[0], sl[1], sl[2])); });
    im.instanceMatrix.needsUpdate = true;
    return im;
  }

  // HIMARS-class: armoured-cab 6x6, one 6-round pod (1.05 x 0.84 x 4.10 m)
  function buildMLRS() {
    const M = mats(), S = shell("mlrs"), K = new Kit();
    truckChassis(K, { armored: true });
    truckBed(K, "flat");
    K.into(S.hull, "hull");
    const podW = 1.05, podH = 0.84, podL = 4.10;
    const L = launcherRig(S, { z: -1.90, ringR: 0.70, podW: podW + 0.2, podL: podL, zPivot: -2.02, pivotY: 0.30, ramX: 0.36, ramBase: [0, 0.10, -0.20] });
    const P = new Kit();
    // pod: box with a stiffened frame, lifting lugs, face plate
    bx(P, M.olive, 0, podH / 2 + 0.02, podL / 2, podW, podH, podL);
    for (let z = 0.2; z < podL; z += 0.97) bx(P, M.oliveD, 0, podH / 2 + 0.02, z, podW + 0.04, podH + 0.04, 0.07);
    [-1, 1].forEach(function (s) { bx(P, M.oliveD, s * 0.40, podH + 0.07, 0.4, 0.08, 0.08, 0.12); bx(P, M.oliveD, s * 0.40, podH + 0.07, podL - 0.4, 0.08, 0.08, 0.12); });
    const slots = [], muzzles = [];
    [0.24, 0.62].forEach(function (y) {
      [-0.34, 0, 0.34].forEach(function (x) {
        cy(P, M.gun, x, y, podL + 0.004, 0.14, 0.14, 0.01, "z", 14);
        slots.push([x, y, podL + 0.012]);
      });
    });
    P.into(L.elev, "pod");
    // frangible tube covers: pale while the round is in; blown = hidden
    const coverK = new Kit();
    cy(coverK, M.pale, 0, 0, 0, 0.125, 0.125, 0.012, "z", 14);
    L.elev.add(roundsIM(coverK.geo(), M.pale, slots));
    slots.forEach(function (sl, i) {
      const m = new THREE.Object3D(); m.name = "lm" + i; m.position.set(sl[0], sl[1], sl[2] + 0.35); L.elev.add(m); muzzles.push(m);
    });
    const wo = truckGearSpec(), spec = wheeledSpec(wo);
    buildGear(S.root, spec, wheeledParts(wo));
    Object.assign(spec, {
      type: "mlrs", footW: TRK.W, footL: TRK.L, height: 3.2,
      rock: 0.006, squat: 0.006, maxSteer: 0.5, tune: { top: 20, rev: 8, accel: 8, turn: 1.0 },
      weapon: "mlrs",
      launcher: { n: slots.length, slots: slots, rate: 0.55, elevRate: 0.35, elevMin: 0, elevMax: 1.05, attach: [0, 0.02, 1.70], ripple: 0.4, reload: 24 },
      dims: { length: TRK.L, width: TRK.W, pod: [podW, podH, podL], tubes: slots.length },
    });
    return { group: S.root, spec: spec };
  }

  // Patriot-class: four 0.92 m canisters, 5.3 m long, fixed 38° launch angle
  function buildPatriot() {
    const M = mats(), S = shell("patriot"), K = new Kit();
    truckChassis(K, {});
    truckBed(K, "flat");
    // generator set + cable reel behind the cab
    bx(K, M.olive, 0.62, 1.78, 0.65, 0.95, 0.72, 0.70);
    bx(K, M.gun, 0.62, 1.78, 0.995, 0.70, 0.42, 0.012);
    cy(K, M.oliveD, -0.70, 1.80, 0.65, 0.34, 0.34, 0.40, "x", 14);
    K.into(S.hull, "hull");
    const cw = 0.92, cl = 5.30;
    const L = launcherRig(S, { z: -1.95, ringR: 0.85, podW: 2 * cw + 0.25, podL: cl, zPivot: -2.55, pivotY: 0.34, ramX: 0.70, ramBase: [0, 0.10, -0.40] });
    const P = new Kit();
    const slots = [], muzzles = [];
    [[-1, 0], [1, 0], [-1, 1], [1, 1]].forEach(function (c) {
      const x = c[0] * (cw / 2 + 0.01), y = 0.05 + cw / 2 + c[1] * (cw + 0.02);
      bx(P, M.oliveL, x, y, cl / 2, cw, cw, cl);
      [0.12, cl / 2, cl - 0.12].forEach(function (z) { bx(P, M.oliveD, x, y, z, cw + 0.04, cw + 0.04, 0.10); });
      bx(P, M.gun, x, y, cl + 0.006, cw - 0.12, cw - 0.12, 0.01);
      slots.push([x, y, cl + 0.02]);
    });
    // launcher frame round the stack
    [-1, 1].forEach(function (s) { bx(P, M.oliveD, s * (cw + 0.06), cw + 0.05, cl / 2, 0.08, 0.10, cl - 0.4); });
    P.into(L.elev, "canisters");
    const noseK = new Kit();
    cone(noseK, M.pale, 0, 0, 0.16, 0.20, 0.34, "z", 12);
    cy(noseK, M.pale, 0, 0, -0.02, 0.20, 0.20, 0.04, "z", 12);
    L.elev.add(roundsIM(noseK.geo(), M.pale, slots));
    slots.forEach(function (sl, i) {
      const m = new THREE.Object3D(); m.name = "lm" + i; m.position.set(sl[0], sl[1], sl[2] + 0.4); L.elev.add(m); muzzles.push(m);
    });
    const wo = truckGearSpec(), spec = wheeledSpec(wo);
    buildGear(S.root, spec, wheeledParts(wo));
    Object.assign(spec, {
      type: "patriot", footW: TRK.W, footL: TRK.L + 0.9, height: 3.95,
      rock: 0.004, squat: 0.006, maxSteer: 0.5, tune: { top: 18, rev: 8, accel: 8, turn: 1.0 },
      weapon: "patriot",
      launcher: { n: 4, slots: slots, rate: 0.75, elevRate: 0.30, elevMin: 0, elevMax: 38 * PI / 180, attach: [0, 0.05, 2.30] },
      dims: { length: TRK.L, width: TRK.W, canister: [cw, cw, cl] },
    });
    return { group: S.root, spec: spec };
  }

  // ============================================================ THE LUV
  // HMMWV class: 4.57 x 2.16 x 1.83 m, 3.30 m wheelbase, 1.81 m track,
  // 0.93 m tyres, 0.41 m clearance, gunner's ring on the roof.
  function buildLUV() {
    const M = mats(), S = shell("luv"), K = new Kit();
    const HL = 2.285, W = 2.16;
    // body: full-width fender deck, hood falling to a vertical grille
    prof(K, M.olive, -W / 2, W / 2, [[-HL, 0.66], [2.20, 0.66], [HL, 0.78], [HL, 1.08], [0.98, 1.20], [-HL, 1.12]]);
    // centre tub between the wheels down to the belly
    prof(K, M.olive, -0.62, 0.62, [[-2.0, 0.41], [2.0, 0.41], [2.2, 0.70], [-2.2, 0.70]]);
    // raised hood panel over the engine + the grille slots + headlights
    prof(K, M.olive, -0.80, 0.80, [[0.98, 1.20], [2.25, 1.085], [2.25, 1.13], [0.98, 1.26]]);
    bx(K, M.gun, 0, 0.93, HL + 0.005, 1.25, 0.26, 0.012);
    for (let i = 0; i < 11; i++) bx(K, M.olive, -0.55 + i * 0.11, 0.93, HL + 0.012, 0.035, 0.26, 0.02);
    [-1, 1].forEach(function (s) {
      headlight(K, s * 0.74, 0.96, HL + 0.01, 0.075);
      bx(K, M.tail, s * 0.95, 0.98, -HL - 0.005, 0.10, 0.10, 0.02);
      // mirror, door seams, door handles, fender-top blackout light
      bx(K, M.gun, s * 1.17, 1.48, 0.92, 0.22, 0.03, 0.03);
      bx(K, M.gun, s * 1.28, 1.44, 0.92, 0.04, 0.24, 0.16);
      [-0.98, -0.02].forEach(function (z) { bx(K, M.oliveD, s * 1.035, 1.20, z, 0.012, 0.95, 0.025); });
      [0.25, -0.70].forEach(function (z) { bx(K, M.gun, s * 1.04, 1.34, z, 0.02, 0.035, 0.14); });
      bx(K, M.lamp, s * 0.95, 1.13, 2.12, 0.08, 0.04, 0.06);
    });
    // CABIN + rear shell: near-vertical sides, raked-back tail
    const cs = function (roof, rw) { return sym([[1.04, 1.12], [1.02, 1.36], [rw, roof]]); };
    sect(K, M.olive, [[-HL + 0.02, cs(1.62, 0.88)], [-1.95, cs(1.83, 0.92)], [0.90, cs(1.83, 0.92)], [1.02, cs(1.30, 1.0)]]);
    // glass: split windscreen, four door windows, rear shell window
    const rake = Math.atan2(0.12, 0.47);
    [-1, 1].forEach(function (s) {
      bx(K, M.glass, s * 0.47, 1.57, 0.975, 0.84, 0.40, 0.02, -rake, 0, 0);
      bx(K, M.glass, s * 1.00, 1.58, 0.45, 0.02, 0.34, 0.76, 0, 0, s * 0.10);
      bx(K, M.glass, s * 1.00, 1.58, -0.52, 0.02, 0.34, 0.76, 0, 0, s * 0.10);
      bx(K, M.glass, s * 0.98, 1.52, -1.55, 0.02, 0.22, 0.50, 0, 0, s * 0.10);
    });
    bx(K, M.olive, 0, 1.57, 0.985, 0.08, 0.44, 0.03, -rake, 0, 0);
    // bumpers, tow shackles, pintle, antennas
    bx(K, M.oliveD, 0, 0.62, HL + 0.06, 2.0, 0.18, 0.12);
    bx(K, M.oliveD, 0, 0.66, -HL - 0.05, 1.9, 0.16, 0.10);
    [-1, 1].forEach(function (s) { bx(K, M.gun, s * 0.55, 0.62, HL + 0.14, 0.07, 0.12, 0.06); });
    antenna(K, 0.85, 1.12, -2.1, 1.1, 0.9);
    antenna(K, -0.85, 1.12, -2.1, 1.1, 0.9);
    K.into(S.hull, "hull");

    // gunner's ring mount with a three-plate shield: a light "turret"
    const turret = new THREE.Group(); turret.name = "turret"; turret.position.set(0, 1.83, -0.40); S.hull.add(turret);
    const T = new Kit();
    cy(T, M.oliveD, 0, 0.05, 0, 0.56, 0.58, 0.10, "y", 20);
    bx(T, M.oliveD, 0, 0.36, 0.55, 0.80, 0.48, 0.05);
    [-1, 1].forEach(function (s) { bx(T, M.oliveD, s * 0.50, 0.33, 0.38, 0.05, 0.42, 0.40, 0, s * 0.6, 0); });
    T.into(turret, "turret-plate");
    const gun = new THREE.Group(); gun.name = "gun"; gun.position.set(0, 0.42, 0.20); turret.add(gun);
    const G = new Kit();
    bx(G, M.gun, 0, 0, 0.10, 0.14, 0.17, 0.62);
    bx(G, M.olive, 0.15, -0.03, 0.02, 0.12, 0.16, 0.28);
    G.into(gun, "mantlet");
    const tube = new THREE.Group(); tube.name = "tube"; gun.add(tube);
    const U = new Kit();
    cy(U, M.gun, 0, 0.02, 0.95, 0.026, 0.032, 1.10, "z", 8);
    U.into(tube, "tube-steel");
    const muzzle = new THREE.Object3D(); muzzle.name = "muzzle"; muzzle.position.set(0, 0.02, 1.52); tube.add(muzzle);

    const wo = { r: 0.465, w: 0.32, x: 0.905, axles: [{ z: 1.62, steer: 1 }, { z: -1.68 }] };
    const spec = wheeledSpec(wo);
    buildGear(S.root, spec, wheeledParts(wo));
    Object.assign(spec, {
      type: "luv", footW: W, footL: 2 * HL, height: 2.45,
      turret: { rate: 1.8, elevMin: -0.25, elevMax: 0.9, elevRate: 1.4 },
      recoil: 0.03, rock: 0.002, squat: 0.008, maxSteer: 0.55,
      weapon: "hmg", tune: { top: 28, rev: 9, accel: 11, turn: 1.25 },
      dims: { length: 2 * HL, width: W, roof: 1.83, belly: 0.41, wheelR: wo.r, wheelbase: 3.30, track: 2 * wo.x },
    });
    return { group: S.root, spec: spec };
  }

  // ============================================================ THE RIG
  // Per-vehicle controller. Everything it animates is a named node of its own
  // clone; the spec is shared plain data.
  const _v = new THREE.Vector3(), _d = new THREE.Vector3(), _a = new THREE.Vector3();
  function Rig(root, spec) {
    this.spec = spec;
    this.root = root;
    this.body = root.getObjectByName("body");
    this.turret = root.getObjectByName("turret") || null;
    this.gun = root.getObjectByName("gun") || null;
    this.tube = root.getObjectByName("tube") || null;
    this.muzzle = root.getObjectByName("muzzle") || null;
    this.lYaw = root.getObjectByName("launchYaw") || null;
    this.lElev = root.getObjectByName("launchElev") || null;
    this.ram = root.getObjectByName("ram") || null;
    this.rounds = root.getObjectByName("rounds") || null;
    this.muzzles = [];
    const n = spec.launcher ? spec.launcher.n : 0;
    for (let i = 0; i < n; i++) this.muzzles.push(root.getObjectByName("lm" + i));
    this.loaded = n;
    const ims = { sets: [], track: root.getObjectByName("track") || null };
    spec.wheelSets.forEach(function (ws) { ims.sets.push(ws.names.map(function (nm) { return root.getObjectByName(nm); })); });
    this.ims = ims;
    this.dist = 0; this.yawAcc = 0; this.steer = 0; this.lastV = 0; this.pitch = 0;
    this.recoilT = 9; this.rockT = 9; this.rockYaw = 0;
  }
  Rig.prototype.update = function (dt, v, omega, steerIn) {
    const sp = this.spec;
    dt = Math.min(0.1, Math.max(0, dt || 0));
    const dd = v * dt, dy = omega * dt;
    this.dist += dd; this.yawAcc += dy;
    const st = (steerIn || 0) * (sp.maxSteer || 0);
    const ds = (st - this.steer) * Math.min(1, dt * 6);
    this.steer += ds;
    if (Math.abs(dd) > 1e-6 || Math.abs(dy) > 1e-7 || Math.abs(ds) > 1e-5) poseGear(this.ims, sp, this.dist, this.yawAcc, this.steer);
    // squat under throttle, dive under braking
    const acc = dt > 0 ? (v - this.lastV) / dt : 0;
    this.lastV = v;
    this.pitch += (clamp(-acc * (sp.squat || 0), -0.03, 0.03) - this.pitch) * Math.min(1, dt * 4);
    let rx = this.pitch, rz = 0;
    if (this.rockT < 2.5) {
      this.rockT += dt;
      const a = (sp.rock || 0) * Math.exp(-4.2 * this.rockT) * Math.cos(10 * this.rockT);
      rx -= a * Math.cos(this.rockYaw); rz += a * Math.sin(this.rockYaw);
    }
    if (this.body) this.body.rotation.set(rx, 0, rz);
    if (this.tube && this.recoilT < 1.2) {
      this.recoilT += dt;
      const t = this.recoilT;
      const k = t < 0.04 ? t / 0.04 : Math.max(0, 1 - (t - 0.04) / 0.75);
      this.tube.position.z = -(sp.recoil || 0) * k * k * (3 - 2 * k);
    }
  };
  Rig.prototype.settle = function () {
    if (this.body) this.body.rotation.set(0, 0, 0);
    if (this.tube) this.tube.position.z = 0;
    this.recoilT = 9; this.rockT = 9; this.pitch = 0; this.lastV = 0;
  };
  Rig.prototype.aimTurret = function (wantYaw, wantElev, dt) {
    const t = this.spec.turret;
    if (!t || !this.turret) return;
    let d = wrap(wantYaw - this.turret.rotation.y);
    const s = t.rate * dt;
    this.turret.rotation.y = wrap(this.turret.rotation.y + clamp(d, -s, s));
    if (this.gun) {
      const cur = -this.gun.rotation.x, want = clamp(wantElev, t.elevMin, t.elevMax), se = t.elevRate * dt;
      this.gun.rotation.x = -(cur + clamp(want - cur, -se, se));
    }
  };
  Rig.prototype.aimLauncher = function (wantYaw, wantElev, dt) {
    const L = this.spec.launcher;
    if (!L || !this.lYaw) return;
    if (wantYaw != null) {
      const s = L.rate * dt;
      this.lYaw.rotation.y = wrap(this.lYaw.rotation.y + clamp(wrap(wantYaw - this.lYaw.rotation.y), -s, s));
    }
    const cur = -this.lElev.rotation.x, want = clamp(wantElev, L.elevMin, L.elevMax), se = L.elevRate * dt;
    this.lElev.rotation.x = -(cur + clamp(want - cur, -se, se));
    this.poseRam();
  };
  Rig.prototype.launcherElev = function () { return this.lElev ? -this.lElev.rotation.x : 0; };
  // stood up far enough to fire: default = 90% of the rack's launch angle
  Rig.prototype.launcherReady = function (minElev) {
    const L = this.spec.launcher;
    return !!L && this.launcherElev() >= (minElev != null ? minElev : L.elevMax * 0.9);
  };
  // re-aim the hydraulic ram from its base to the attach point on the pod
  Rig.prototype.poseRam = function () {
    if (!this.ram || !this.lElev) return;
    const at = this.spec.launcher.attach, e = -this.lElev.rotation.x;
    const ay = this.lElev.position.y + at[1] * Math.cos(e) + at[2] * Math.sin(e);
    const az = this.lElev.position.z - at[1] * Math.sin(e) + at[2] * Math.cos(e);
    const by = this.ram.position.y, bz = this.ram.position.z;
    const ly = ay - by, lz = az - bz, len = Math.max(0.3, Math.hypot(ly, lz));
    this.ram.rotation.x = Math.atan2(lz, ly);
    this.ram.scale.set(1, len, 1);
  };
  Rig.prototype.muzzleWorld = function (out) {
    if (!this.muzzle) return null;
    this.root.updateWorldMatrix(true, true);
    return this.muzzle.getWorldPosition(out || new THREE.Vector3());
  };
  Rig.prototype.gunDirWorld = function (out) {
    out = out || new THREE.Vector3();
    if (!this.gun) return out.set(0, 0, 1);
    this.root.updateWorldMatrix(true, true);
    return this.gun.getWorldDirection(out);
  };
  // The gun just fired: recoil, hull rock against the shot, muzzle FX.
  Rig.prototype.fired = function (scale) {
    this.recoilT = 0;
    this.rockT = 0;
    this.rockYaw = this.turret ? this.turret.rotation.y : 0;
    const p = this.muzzleWorld(_v);
    if (p) blast(p, this.gunDirWorld(_d), scale == null ? 1 : scale);
  };
  Rig.prototype.launcherMuzzle = function (i, out) {
    const m = this.muzzles[i];
    if (!m) return null;
    this.root.updateWorldMatrix(true, true);
    return m.getWorldPosition(out || new THREE.Vector3());
  };
  // one round leaves tube i: its cover/nose goes, a back-blast puff at the mouth
  Rig.prototype.spend = function (i) {
    if (this.rounds && i >= 0 && i < this.rounds.count) {
      this.rounds.setMatrixAt(i, _m.makeScale(0, 0, 0));
      this.rounds.instanceMatrix.needsUpdate = true;
    }
    this.loaded = Math.max(0, this.loaded - 1);
    this.rockT = 0; this.rockYaw = this.lYaw ? this.lYaw.rotation.y : 0;
    const p = this.launcherMuzzle(i, _a);
    if (p && this.lElev) { this.lElev.getWorldDirection(_d); blast(p, _d, 0.55); }
  };
  Rig.prototype.reload = function () {
    const L = this.spec.launcher;
    if (!L) return;
    this.loaded = L.n;
    if (!this.rounds) return;
    for (let i = 0; i < L.slots.length; i++) { const sl = L.slots[i]; this.rounds.setMatrixAt(i, M4(sl[0], sl[1], sl[2])); }
    this.rounds.instanceMatrix.needsUpdate = true;
  };
  Rig.prototype.roundLoaded = function (i) {
    if (!this.rounds || i < 0 || i >= this.rounds.count) return false;
    this.rounds.getMatrixAt(i, _m2);
    return _m2.elements[0] !== 0;
  };

  // ============================================================ FX
  // Muzzle blast: the shared flash sprite, the shared smoke puffs, and a
  // pooled SMOKE RING blown down the line of fire (the look of a big gun).
  const RING_N = 4, rings = [];
  let ringGeo = null;
  function ringTake() {
    for (let i = 0; i < rings.length; i++) if (!rings[i].live) return rings[i];
    if (rings.length >= RING_N) { let o = rings[0]; for (let i = 1; i < rings.length; i++) if (rings[i].t > o.t) o = rings[i]; return o; }
    if (!ringGeo) ringGeo = new THREE.TorusGeometry(1, 0.32, 6, 18);
    const mat = new THREE.MeshLambertMaterial({ color: 0xb9b4aa, transparent: true, opacity: 0, depthWrite: false });
    const mesh = new THREE.Mesh(ringGeo, mat);
    mesh.visible = false; mesh.frustumCulled = false; mesh.renderOrder = 7;
    const r = { mesh: mesh, live: false, t: 0, life: 1.6, v: 0, dir: new THREE.Vector3(), s0: 1 };
    rings.push(r);
    return r;
  }
  const _Z = new THREE.Vector3(0, 0, 1);
  function blast(pos, dir, scale) {
    if (CBZ.muzzleFlash) { try { CBZ.muzzleFlash(pos, { scale: 5.5 * scale, life: 0.10, color: 0xffe0a0 }); } catch (e) {} }
    if (scale < 0.4) return;                     // a machine gun flashes; it does not blow smoke rings
    if (CBZ.cityCrashSmoke) {
      try { CBZ.cityCrashSmoke(pos.x + dir.x * 1.5 * scale, pos.y, pos.z + dir.z * 1.5 * scale, { count: scale > 0.8 ? 4 : 2, scale: 0.75 * scale }); } catch (e) {}
    }
    if (!CBZ.scene) return;
    const r = ringTake();
    if (!r.mesh.parent) CBZ.scene.add(r.mesh);
    r.live = true; r.t = 0; r.life = 1.3 + 0.5 * scale; r.v = 9 * scale; r.s0 = 0.35 * scale;
    r.dir.copy(dir).normalize();
    r.mesh.position.copy(pos).addScaledVector(r.dir, 0.4);
    r.mesh.quaternion.setFromUnitVectors(_Z, r.dir);
    r.mesh.scale.setScalar(r.s0);
    r.mesh.material.opacity = 0.62;
    r.mesh.visible = true;
  }
  if (CBZ.onUpdate) CBZ.onUpdate(61.3, function (dt) {
    for (let i = 0; i < rings.length; i++) {
      const r = rings[i];
      if (!r.live) continue;
      r.t += dt;
      const k = r.t / r.life;
      if (k >= 1) { r.live = false; r.mesh.visible = false; continue; }
      r.mesh.position.addScaledVector(r.dir, r.v * (1 - k) * (1 - k) * dt);
      r.mesh.position.y += 0.6 * dt;
      r.mesh.scale.setScalar(r.s0 * (1 + 5.5 * Math.sqrt(k)));
      r.mesh.material.opacity = 0.62 * (1 - k) * (1 - k);
    }
  });

  // ============================================================ PUBLISH
  CBZ.milArmor = {
    tank: function () { return instance("mbt", buildMBT); },
    ifv: function () { return instance("ifv", buildIFV); },
    apc: function () { return instance("apc", buildAPC); },
    truck: function (opts) { return (opts && opts.flatbed) ? instance("truck-flat", function () { return buildTruck("flat"); }) : instance("truck", function () { return buildTruck("cargo"); }); },
    luv: function () { return instance("luv", buildLUV); },
    mlrs: function () { return instance("mlrs", buildMLRS); },
    patriot: function () { return instance("patriot", buildPatriot); },
    blast: blast,
    // plain census for tools/mil-armor-check.mjs and the console
    audit: function () {
      const out = {};
      Object.keys(TPL).forEach(function (k) {
        const t = TPL[k];
        let meshes = 0, tris = 0, inst = 0;
        t.group.traverse(function (o) {
          if (!o.isMesh) return;
          meshes++;
          const n = o.geometry.attributes.position.count / 3 * (o.isInstancedMesh ? o.count : 1);
          tris += n; if (o.isInstancedMesh) inst += o.count;
        });
        out[k] = { meshes: meshes, tris: Math.round(tris), instances: inst, dims: t.spec.dims, footW: t.spec.footW, footL: t.spec.footL, height: t.spec.height, shoes: t.spec.shoes || 0 };
      });
      return out;
    },
  };
})();
