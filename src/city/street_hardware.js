/* ============================================================
   city/street_hardware.js — THE STEEL ON THE CORNER, AND THE LIGHT IT
   THROWS ON THE ROAD.

   Owner's complaint class: traffic signals were a 0.6 m black box on a
   5 m stick with three spheres stuck to it, street lamps were a box on a
   bent pipe, and at night nothing lit the road. Real US street hardware is
   a small, very standard vocabulary, so this file builds exactly that
   vocabulary as a handful of vertex-coloured prototypes and hands them to
   city/props.js, which places them (it owns the layout, the traffic handles
   and the shoot/break records):

     • MAST POLE        tapered galvanised shaft on a concrete footing, top
                        cap; carries the mast arms, a luminaire, the ped heads
     • MAST ARM         tapered tube, unit length along +Z (instance-scaled
                        in Z only, so its radius and 0.35 m rise never stretch)
     • VEHICLE HEAD     12-inch 3-section head: black housing, tunnel visor
                        over every lens (open at the bottom), black backplate
                        with the 3-inch retroreflective yellow border. Two
                        mounts: TOP bracket (hung under a mast arm) and SIDE
                        brackets (bolted to a pole).
     • PEDESTAL POLE    the slimmer aluminium pole on the far-left corners
     • PED HEAD         2-section pedestrian head (hand over walking person)
                        with hoods, plus the push-button housing below it
     • COBRA LUMINAIRE  a davit arm that bends out of the shaft and a real
                        cobra-head body (domed shell, flat underside) with a
                        drop lens facing the road. With or without its pole.

   Everything is generated here as raw triangle arrays (no THREE geometry
   helpers, no BufferGeometryUtils) so it is exact, cheap, and builds under
   the headless harness stub too. Every triangle is wound by its intended
   normal (triN), so a winding mistake cannot silently cull a face.

   THE LIGHT ON THE ROAD. A lamp that lights nothing is a prop. Instanced
   additive ground decals (the city/carlamps.js idea, no dynamic lights:
   r128 recompiles every lit shader when the light count moves) paint a warm
   elliptical pool under every cobra head, and a faint coloured wash in front
   of every signal approach. A per-instance tint attribute carries the
   colour, so a shot-out lamp simply zero-scales its instance and a signal
   pool retints on the phase change.

   EVERYTHING is chunked (chunked()): one InstancedMesh per 200 m cell per
   part, each with a real world-space bounding sphere, so r128 frustum-culls
   whole cells instead of shading every lamp on the map every frame.

   Exports CBZ.streetHW. Nothing here places anything or owns state.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ, THREE = window.THREE;
  if (!CBZ || !THREE) return;

  // ---------------------------------------------------------------------
  //  tiny linear algebra (Euler XYZ, three.js's default order: R = Rx Ry Rz)
  // ---------------------------------------------------------------------
  function rotM(rx, ry, rz) {
    const a = Math.cos(rx), b = Math.sin(rx), c = Math.cos(ry), d = Math.sin(ry), e = Math.cos(rz), f = Math.sin(rz);
    const ae = a * e, af = a * f, be = b * e, bf = b * f;
    // row-major 3x3 (same numbers as Matrix4.makeRotationFromEuler, order XYZ)
    return [c * e, -c * f, d, af + be * d, ae - bf * d, -b * c, bf - ae * d, be + af * d, a * c];
  }
  function hexRGB(hex) { return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255]; }
  function norm3(v) { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }

  // ---------------------------------------------------------------------
  //  PROTO — a vertex-coloured triangle soup with a movable local frame
  // ---------------------------------------------------------------------
  function Proto(opts) {
    this.P = []; this.N = []; this.C = []; this.U = (opts && opts.uv) ? [] : null;
    this.R = null; this.T = [0, 0, 0];
  }
  // place subsequent parts at (x,y,z) rotated by Euler XYZ (rx,ry,rz)
  Proto.prototype.at = function (x, y, z, rx, ry, rz) {
    this.T = [x || 0, y || 0, z || 0];
    this.R = (rx || ry || rz) ? rotM(rx || 0, ry || 0, rz || 0) : null;
    return this;
  };
  Proto.prototype._xp = function (v) {
    const R = this.R, T = this.T;
    if (!R) return [v[0] + T[0], v[1] + T[1], v[2] + T[2]];
    return [R[0] * v[0] + R[1] * v[1] + R[2] * v[2] + T[0], R[3] * v[0] + R[4] * v[1] + R[5] * v[2] + T[1], R[6] * v[0] + R[7] * v[1] + R[8] * v[2] + T[2]];
  };
  Proto.prototype._xn = function (n) {
    const R = this.R;
    if (!R) return n;
    return [R[0] * n[0] + R[1] * n[1] + R[2] * n[2], R[3] * n[0] + R[4] * n[1] + R[5] * n[2], R[6] * n[0] + R[7] * n[1] + R[8] * n[2]];
  };
  // one triangle, wound so its face normal agrees with the intended normals
  Proto.prototype.triN = function (a, b, c, na, nb, nc, col, ua, ub, uc) {
    const f = cross(sub(b, a), sub(c, a));
    const want = [na[0] + nb[0] + nc[0], na[1] + nb[1] + nc[1], na[2] + nb[2] + nc[2]];
    if (dot(f, want) < 0) { let t = b; b = c; c = t; t = nb; nb = nc; nc = t; t = ub; ub = uc; uc = t; }
    const vs = [a, b, c], ns = [na, nb, nc], us = [ua, ub, uc];
    for (let i = 0; i < 3; i++) {
      const p = this._xp(vs[i]), n = this._xn(ns[i]);
      this.P.push(p[0], p[1], p[2]); this.N.push(n[0], n[1], n[2]);
      this.C.push(col[0], col[1], col[2]);
      if (this.U) { const u = us[i] || [0, 0]; this.U.push(u[0], u[1]); }
    }
  };
  // flat quad: centre c, half-axis u, outward normal n (v = n x u)
  Proto.prototype.quad = function (c, u, n, hv, colHex, uvr) {
    const col = hexRGB(colHex);
    n = norm3(n);
    const vv = cross(n, norm3(u));
    const U = [u[0], u[1], u[2]], V = [vv[0] * hv, vv[1] * hv, vv[2] * hv];
    const p = function (su, sv) { return [c[0] + U[0] * su + V[0] * sv, c[1] + U[1] * su + V[1] * sv, c[2] + U[2] * su + V[2] * sv]; };
    const a = p(-1, -1), b = p(1, -1), cc = p(1, 1), d = p(-1, 1);
    const r = uvr || { u0: 0, v0: 0, u1: 1, v1: 1 };
    const ua = [r.u0, r.v0], ub = [r.u1, r.v0], uc = [r.u1, r.v1], ud = [r.u0, r.v1];
    this.triN(a, b, cc, n, n, n, col, ua, ub, uc);
    this.triN(a, cc, d, n, n, n, col, ua, uc, ud);
    return this;
  };
  Proto.prototype.box = function (w, h, d, colHex, x, y, z) {
    const hw = w / 2, hh = h / 2, hd = d / 2;
    x = x || 0; y = y || 0; z = z || 0;
    this.quad([x + hw, y, z], [0, 0, -hd], [1, 0, 0], hh, colHex);
    this.quad([x - hw, y, z], [0, 0, hd], [-1, 0, 0], hh, colHex);
    this.quad([x, y + hh, z], [hw, 0, 0], [0, 1, 0], hd, colHex);
    this.quad([x, y - hh, z], [hw, 0, 0], [0, -1, 0], hd, colHex);
    this.quad([x, y, z + hd], [hw, 0, 0], [0, 0, 1], hh, colHex);
    this.quad([x, y, z - hd], [-hw, 0, 0], [0, 0, -1], hh, colHex);
    return this;
  };
  // SWEEP: a tube along a polyline [{x,y,z,r}], parallel-transported frame.
  // th0/th1 cut a partial arc (visors); cap0/cap1 close the ends.
  Proto.prototype.sweep = function (path, seg, colHex, o) {
    o = o || {};
    const col = hexRGB(colHex);
    const th0 = o.th0 != null ? o.th0 : 0, th1 = o.th1 != null ? o.th1 : Math.PI * 2;
    const full = Math.abs(th1 - th0 - Math.PI * 2) < 1e-6;
    const n = path.length, rings = [];
    let nrm = null;
    for (let i = 0; i < n; i++) {
      const p0 = path[Math.max(0, i - 1)], p1 = path[Math.min(n - 1, i + 1)];
      const t = norm3([p1.x - p0.x, p1.y - p0.y, p1.z - p0.z]);
      if (!nrm) {
        const ref = o.up || (Math.abs(t[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]);
        const k = dot(ref, t);
        nrm = norm3([ref[0] - t[0] * k, ref[1] - t[1] * k, ref[2] - t[2] * k]);
      } else {
        const k = dot(nrm, t);
        nrm = norm3([nrm[0] - t[0] * k, nrm[1] - t[1] * k, nrm[2] - t[2] * k]);
      }
      const bin = cross(t, nrm);
      const ring = [];
      for (let s = 0; s <= seg; s++) {
        const th = th0 + (th1 - th0) * (s / seg);
        const dx = Math.cos(th) * nrm[0] + Math.sin(th) * bin[0];
        const dy = Math.cos(th) * nrm[1] + Math.sin(th) * bin[1];
        const dz = Math.cos(th) * nrm[2] + Math.sin(th) * bin[2];
        const r = path[i].r;
        ring.push({ p: [path[i].x + dx * r, path[i].y + dy * r, path[i].z + dz * r], n: [dx, dy, dz] });
      }
      rings.push({ ring, t, c: [path[i].x, path[i].y, path[i].z] });
    }
    for (let i = 0; i < n - 1; i++) {
      const A = rings[i].ring, B = rings[i + 1].ring;
      for (let s = 0; s < seg; s++) {
        this.triN(A[s].p, A[s + 1].p, B[s + 1].p, A[s].n, A[s + 1].n, B[s + 1].n, col);
        this.triN(A[s].p, B[s + 1].p, B[s].p, A[s].n, B[s + 1].n, B[s].n, col);
      }
    }
    const cap = (R, sign) => {
      const tn = [R.t[0] * sign, R.t[1] * sign, R.t[2] * sign];
      for (let s = 0; s < seg; s++) this.triN(R.c, R.ring[s].p, R.ring[s + 1].p, tn, tn, tn, col);
    };
    if (full && o.cap0) cap(rings[0], -1);
    if (full && o.cap1) cap(rings[n - 1], 1);
    return this;
  };
  // straight tapered tube between two points
  Proto.prototype.tube = function (a, b, r0, r1, seg, colHex, o) {
    return this.sweep([{ x: a[0], y: a[1], z: a[2], r: r0 }, { x: b[0], y: b[1], z: b[2], r: r1 }], seg, colHex, o);
  };
  // half-ellipsoid dome over (cx,cy,cz); dir +1 bulges up, -1 down; closed
  // by a flat ellipse on its base plane when `base` is a colour
  Proto.prototype.dome = function (rx, ry, rz, segU, segV, colHex, cx, cy, cz, dir, baseHex) {
    const col = hexRGB(colHex);
    dir = dir || 1;
    const pt = (phi, lam) => {
      const s = Math.sin(phi), c = Math.cos(phi);
      const x = rx * s * Math.cos(lam), y = dir * ry * c, z = rz * s * Math.sin(lam);
      return { p: [cx + x, cy + y, cz + z], n: norm3([x / (rx * rx), y / (ry * ry), z / (rz * rz)]) };
    };
    for (let v = 0; v < segV; v++) {
      const p0 = (v / segV) * Math.PI / 2, p1 = ((v + 1) / segV) * Math.PI / 2;
      for (let u = 0; u < segU; u++) {
        const l0 = (u / segU) * Math.PI * 2, l1 = ((u + 1) / segU) * Math.PI * 2;
        const a = pt(p0, l0), b = pt(p0, l1), c = pt(p1, l1), d = pt(p1, l0);
        if (v > 0) this.triN(a.p, b.p, c.p, a.n, b.n, c.n, col);
        this.triN(a.p, c.p, d.p, a.n, c.n, d.n, col);
      }
    }
    if (baseHex != null) {
      const bc = hexRGB(baseHex), bn = [0, -dir, 0], ctr = [cx, cy, cz];
      for (let u = 0; u < segU; u++) {
        const l0 = (u / segU) * Math.PI * 2, l1 = ((u + 1) / segU) * Math.PI * 2;
        this.triN(ctr, [cx + rx * Math.cos(l0), cy, cz + rz * Math.sin(l0)], [cx + rx * Math.cos(l1), cy, cz + rz * Math.sin(l1)], bn, bn, bn, bc);
      }
    }
    return this;
  };
  Proto.prototype.geometry = function () {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(this.P), 3));
    g.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(this.N), 3));
    if (!this.noColor) g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(this.C), 3));
    if (this.U) g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(this.U), 2));
    if (g.computeBoundingSphere) g.computeBoundingSphere();
    return g;
  };

  // ---------------------------------------------------------------------
  //  PALETTE (Lambert .color is linear in this repo — the house look)
  // ---------------------------------------------------------------------
  const GALV = 0x9aa0a4, GALV_DK = 0x7c8286, CONCRETE = 0x8f8b84, HOUSING = 0x16181b,
    BACKPLATE = 0x121417, SIG_YELLOW = 0xe3b81c, ALU = 0x8e9499, LUM_BODY = 0x8a9096, LUM_BELLY = 0x5e6368,
    BUTTON = 0xb8bdc1;

  // ---------------------------------------------------------------------
  //  DIMENSIONS the placer needs (single source: the prototypes read them)
  // ---------------------------------------------------------------------
  const D = {
    MAST_TOP: 7.7,          // top of the mast / lamp shaft (the luminaire davit rises out of it)
    MAST_R0: 0.21, MAST_R1: 0.13,
    ARM_Y: 6.25,            // mast-arm root height on the pole axis
    ARM_RISE: 0.35,         // the arm climbs this much root -> tip (absolute, never scaled)
    ARM_R0: 0.12, ARM_R1: 0.075,
    HEAD_HALF_H: 0.54,      // vehicle head housing half-height
    HEAD_HANG: 0.76,        // head centre sits this far below the arm's underside
    LENS_Z: 0.135,          // lens plane in front of the head centre
    LENS_DY: 0.355,         // red / amber / green spacing
    LENS_R: 0.152,
    SIDE_BACK: 0.46,        // side-mount head centre sits this far off the pole surface
    PED_POLE_TOP: 4.9, PED_R0: 0.115, PED_R1: 0.085,
    PED_Y: 2.72,            // pedestrian head centre
    PED_LENS_DY: 0.19, PED_LENS: 0.3, PED_OUT: 0.35,   // PED_OUT: lens plane off the pole surface
    SIDE_HEAD_Y: 3.95,      // pole-mounted vehicle head centre (clears the ped head below)
  };
  // radius of a tapered pole at height y (placement: heads bolt to the SURFACE)
  D.mastRAt = function (y) { const t = Math.max(0, Math.min(1, (y - 0.3) / (D.MAST_TOP - 0.3))); return D.MAST_R0 + (D.MAST_R1 - D.MAST_R0) * t; };
  D.pedRAt = function (y) { const t = Math.max(0, Math.min(1, (y - 0.2) / (D.PED_POLE_TOP - 0.2))); return D.PED_R0 + (D.PED_R1 - D.PED_R0) * t; };
  D.armYAt = function (s, L) { return D.ARM_Y + D.ARM_RISE * Math.max(0, Math.min(1, s / (L || 1))); };
  D.armRAt = function (s, L) { return D.ARM_R0 + (D.ARM_R1 - D.ARM_R0) * Math.max(0, Math.min(1, s / (L || 1))); };

  // ---------------------------------------------------------------------
  //  PROTOTYPES
  // ---------------------------------------------------------------------
  const cache = {};
  function once(key, make) { return cache[key] || (cache[key] = make()); }

  function footing(p, r, h) {
    p.at(0, 0, 0);
    p.tube([0, -0.1, 0], [0, h, 0], r, r * 0.96, 10, CONCRETE, { cap1: true });
  }
  function mastPole() {
    return once("mastPole", function () {
      const p = new Proto();
      footing(p, 0.42, 0.24);
      p.box(0.56, 0.05, 0.56, GALV_DK, 0, 0.265, 0);                  // anchor base plate
      for (let i = 0; i < 4; i++) {                                     // anchor nuts
        const a = Math.PI / 4 + i * Math.PI / 2;
        p.box(0.07, 0.07, 0.07, 0x55595d, Math.cos(a) * 0.22, 0.32, Math.sin(a) * 0.22);
      }
      p.tube([0, 0.25, 0], [0, D.MAST_TOP, 0], D.MAST_R0, D.MAST_R1, 14, GALV, { cap1: true });
      // arm-root clamp band at the mast-arm height (both arms bolt through it)
      p.tube([0, D.ARM_Y - 0.28, 0], [0, D.ARM_Y + 0.28, 0], D.mastRAt(D.ARM_Y) + 0.035, D.mastRAt(D.ARM_Y) + 0.03, 14, GALV_DK, { cap0: true, cap1: true });
      // handhole cover near the base
      p.box(0.14, 0.26, 0.03, GALV_DK, 0, 0.75, D.mastRAt(0.75) + 0.005);
      return p.geometry();
    });
  }
  function mastArm() {
    return once("mastArm", function () {
      // unit length along +Z; the instance scales Z only
      const p = new Proto();
      p.tube([0, 0, 0], [0, D.ARM_RISE, 1], D.ARM_R0, D.ARM_R1, 10, GALV, { cap1: true });
      return p.geometry();
    });
  }
  function pedPole() {
    return once("pedPole", function () {
      const p = new Proto();
      footing(p, 0.26, 0.2);
      p.tube([0, 0.18, 0], [0, 0.55, 0], 0.17, 0.13, 10, ALU, { cap0: true });   // cast base collar
      p.tube([0, 0.2, 0], [0, D.PED_POLE_TOP, 0], D.PED_R0, D.PED_R1, 12, ALU, { cap1: true });
      p.dome(D.PED_R1 + 0.01, 0.06, D.PED_R1 + 0.01, 10, 3, ALU, 0, D.PED_POLE_TOP, 0, 1);
      return p.geometry();
    });
  }
  // 12-inch three-section vehicle head, face on +Z, origin at the head centre
  function vehicleHead(mount) {
    return once("vehHead:" + mount, function () {
      const p = new Proto();
      p.box(0.37, D.HEAD_HALF_H * 2, 0.26, HOUSING, 0, 0, 0);                   // housing
      // backplate: yellow border behind a black field, real depth apart
      p.box(0.71, 1.44, 0.02, SIG_YELLOW, 0, 0, -0.155);
      p.box(0.56, 1.29, 0.022, BACKPLATE, 0, 0, -0.143);
      // a tunnel visor over every lens, open underneath (the lens itself is
      // the instanced pool the traffic phase drives)
      for (let k = -1; k <= 1; k++) {
        const y = k * D.LENS_DY;
        p.tube([0, y, 0.13], [0, y, 0.39], D.LENS_R + 0.03, D.LENS_R + 0.045, 12, HOUSING,
          { th0: -Math.PI * 0.74, th1: Math.PI * 0.74, up: [0, 1, 0] });
      }
      if (mount === "top") {
        p.box(0.08, 0.24, 0.08, HOUSING, 0, D.HEAD_HALF_H + 0.12, 0);         // span-wire / arm bracket
        p.box(0.2, 0.04, 0.12, GALV_DK, 0, D.HEAD_HALF_H + 0.24, 0);          // arm clamp saddle
      } else {
        for (let k = -1; k <= 1; k += 2) {                                       // two pole brackets
          p.box(0.06, 0.06, D.SIDE_BACK - 0.16, GALV_DK, 0, k * 0.36, -0.16 - (D.SIDE_BACK - 0.16) / 2);
          p.box(0.14, 0.14, 0.03, GALV_DK, 0, k * 0.36, -D.SIDE_BACK + 0.015);
        }
      }
      return p.geometry();
    });
  }
  // pedestrian head (hand over person) + push-button housing, origin on the
  // POLE SURFACE at the head's centre height, face on +Z
  function pedHead() {
    return once("pedHead", function () {
      const p = new Proto();
      const zc = D.PED_OUT - 0.1;
      p.box(0.44, 0.8, 0.2, HOUSING, 0, 0, zc);
      for (let k = -1; k <= 1; k += 2) p.box(0.06, 0.06, zc - 0.1, GALV_DK, 0, k * 0.27, (zc - 0.1) / 2);   // clamp arms
      for (let k = -1; k <= 1; k += 2) {                                         // hoods: top + sides per section
        const y = k * D.PED_LENS_DY;
        p.box(0.42, 0.02, 0.16, HOUSING, 0, y + 0.17, D.PED_OUT + 0.08);
        p.box(0.02, 0.34, 0.16, HOUSING, -0.2, y, D.PED_OUT + 0.08);
        p.box(0.02, 0.34, 0.16, HOUSING, 0.2, y, D.PED_OUT + 0.08);
      }
      // push button at 1.05 m above the footway
      const by = 1.05 - D.PED_Y;
      p.box(0.12, 0.18, 0.07, 0x23262a, 0, by, 0.035);
      p.tube([0, by + 0.01, 0.07], [0, by + 0.01, 0.085], 0.032, 0.03, 12, BUTTON, { cap1: true });
      return p.geometry();
    });
  }
  // COBRA LUMINAIRE on the CBZ.lampMast solve LM. withPole=false builds the
  // davit + head only (it rises out of a mast pole's top instead).
  function lumOffsets(LM) {
    const bellyY = LM.tipY - 0.04;
    return { bellyY: bellyY, bulbY: bellyY - 0.035, bulbZ: LM.tipZ + 0.33, headZ: LM.tipZ + 0.33 };
  }
  function luminaire(LM, withPole, key) {
    return once("lum:" + key + ":" + (withPole ? 1 : 0), function () {
      const p = new Proto();
      const top = LM.poleH - 0.3;
      if (withPole) {
        footing(p, 0.3, 0.2);
        p.tube([0, 0.18, 0], [0, 0.62, 0], 0.2, 0.16, 12, 0x3b3f44, { cap1: true });   // anchor-base shroud
        p.tube([0, 0.2, 0], [0, top, 0], 0.155, LM.poleR, 12, GALV, { cap1: true });
      }
      // DAVIT: rises vertically out of the shaft top and bends out over the
      // road to the solved tip — one sweep, so pole, arm and head cannot part.
      const y0 = top - 0.25, yT = LM.tipY, bend = Math.min(1.1, LM.tipZ * 0.45);
      const path = [];
      const N = 8;
      for (let i = 0; i <= N; i++) {            // quadratic bezier (0,y0,0) -> ctrl (0,yT,0) -> (0,yT,bend)
        const t = i / N, a = (1 - t) * (1 - t), b = 2 * (1 - t) * t, c = t * t;
        path.push({ x: 0, y: a * y0 + b * yT + c * yT, z: c * bend, r: 0.085 - 0.012 * t });
      }
      path.push({ x: 0, y: yT, z: LM.tipZ, r: 0.06 });
      p.sweep(path, 9, GALV, {});
      const o = lumOffsets(LM);
      // slip fitter + the head: a domed shell with a flat belly the lens hangs from
      p.tube([0, yT, LM.tipZ - 0.14], [0, yT, LM.tipZ + 0.02], 0.075, 0.08, 10, LUM_BODY, {});
      p.dome(0.26, 0.2, 0.5, 14, 5, LUM_BODY, 0, o.bellyY, o.headZ, 1, null);
      // the belly is an open SKIRT: a shallow elliptical rim hangs 4 cm below
      // the shell, and the flat glass lens sits recessed inside it, so from
      // the side by day you see a grey housing edge, not a glowing disc
      const skirt = [];
      for (let i = 0; i <= 16; i++) {
        const a = i / 16 * Math.PI * 2;
        skirt.push([Math.cos(a) * 0.25, Math.sin(a) * 0.49]);
      }
      for (let i = 0; i < 16; i++) {
        const a0 = skirt[i], a1 = skirt[i + 1];
        const n0 = [a0[0] / 0.25, 0, a0[1] / 0.49], n1 = [a1[0] / 0.25, 0, a1[1] / 0.49];
        const col = hexRGB(LUM_BODY);
        const P0 = [a0[0], o.bellyY + 0.005, o.headZ + a0[1]], P1 = [a1[0], o.bellyY + 0.005, o.headZ + a1[1]];
        const Q0 = [a0[0], o.bellyY - 0.04, o.headZ + a0[1]], Q1 = [a1[0], o.bellyY - 0.04, o.headZ + a1[1]];
        p.triN(P0, P1, Q1, n0, n1, n1, col); p.triN(P0, Q1, Q0, n0, n1, n0, col);
        const m0 = [-n0[0], 0, -n0[2]], m1 = [-n1[0], 0, -n1[2]];   // inner face of the rim
        p.triN(P0, Q1, P1, m0, m1, m1, hexRGB(LUM_BELLY)); p.triN(P0, Q0, Q1, m0, m0, m1, hexRGB(LUM_BELLY));
      }
      return p.geometry();
    });
  }
  // lens-only geometries (no vertex colour: tint lives in instanceColor)
  function discZ(r, seg) {
    const p = new Proto(); p.noColor = true;
    const n = [0, 0, 1];
    for (let s = 0; s < seg; s++) {
      const a0 = s / seg * Math.PI * 2, a1 = (s + 1) / seg * Math.PI * 2;
      p.triN([0, 0, 0], [Math.cos(a0) * r, Math.sin(a0) * r, 0], [Math.cos(a1) * r, Math.sin(a1) * r, 0], n, n, n, [1, 1, 1]);
    }
    return p.geometry();
  }
  function signalLens() { return once("sigLens", function () { return discZ(D.LENS_R, 16); }); }
  function pedLens(which) {
    // one shared icon texture: hand in the left half, walking person in the right
    return once("pedLens:" + which, function () {
      const p = new Proto({ uv: true }); p.noColor = true;
      const h = D.PED_LENS / 2;
      const r = which === "hand" ? { u0: 0, v0: 0, u1: 0.5, v1: 1 } : { u0: 0.5, v0: 0, u1: 1, v1: 1 };
      p.quad([0, 0, 0], [h, 0, 0], [0, 0, 1], h, 0xffffff, r);
      return p.geometry();
    });
  }
  function lampLens() {
    // FLAT glass lens facing straight down (a flat ellipse, normal -Y),
    // recessed inside the head's skirt: edge-on by day, a bright oval from
    // below at night. Never a bowl or a sphere (those read as a white ball).
    return once("lampLens", function () {
      const p = new Proto(); p.noColor = true;
      const n = [0, -1, 0], seg = 16;
      for (let s2 = 0; s2 < seg; s2++) {
        const a0 = s2 / seg * Math.PI * 2, a1 = (s2 + 1) / seg * Math.PI * 2;
        p.triN([0, 0, 0], [Math.cos(a0) * 0.22, 0, Math.sin(a0) * 0.44], [Math.cos(a1) * 0.22, 0, Math.sin(a1) * 0.44], n, n, n, [1, 1, 1]);
      }
      return p.geometry();
    });
  }

  // ---------------------------------------------------------------------
  //  TEXTURES
  // ---------------------------------------------------------------------
  let _pedTex = null;
  function canvas(w, h) {
    if (typeof document === "undefined" || !document.createElement) return null;
    const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
    return cv;
  }
  function finishTex(cv) {
    const t = new THREE.CanvasTexture(cv);
    if (THREE.sRGBEncoding) t.encoding = THREE.sRGBEncoding;
    t.anisotropy = 4;
    return t;
  }
  // MUTCD pedestrian symbols, white on black (instance colour tints them)
  function pedTexture() {
    if (_pedTex) return _pedTex;
    const W = 128, H = 64, cv = canvas(W, H); if (!cv) return null;
    const g = cv.getContext("2d");
    g.fillStyle = "#000"; g.fillRect(0, 0, W, H);
    g.fillStyle = "#fff"; g.strokeStyle = "#fff"; g.lineCap = "round";
    // raised hand (left half)
    const hx = 32, hy = 34;
    g.fillRect(hx - 11, hy - 4, 22, 20);                      // palm
    for (let i = 0; i < 4; i++) g.fillRect(hx - 11 + i * 5.8, hy - 22 + (i === 0 || i === 3 ? 4 : 0), 4.4, 20);   // fingers
    g.beginPath(); g.moveTo(hx + 11, hy + 6); g.lineTo(hx + 20, hy - 4); g.lineWidth = 5; g.stroke();          // thumb
    g.beginPath(); g.arc(hx, hy + 14, 11, 0, Math.PI); g.fill();                                              // heel of the hand
    // walking person (right half)
    const px = 96, py = 32;
    g.beginPath(); g.arc(px + 2, py - 20, 5.5, 0, Math.PI * 2); g.fill();          // head
    g.lineWidth = 6;
    g.beginPath(); g.moveTo(px + 1, py - 12); g.lineTo(px - 1, py + 6); g.stroke(); // torso
    g.lineWidth = 4.5;
    g.beginPath(); g.moveTo(px, py - 9); g.lineTo(px - 9, py); g.stroke();         // back arm
    g.beginPath(); g.moveTo(px, py - 9); g.lineTo(px + 9, py - 2); g.stroke();     // front arm
    g.lineWidth = 5.5;
    g.beginPath(); g.moveTo(px - 1, py + 6); g.lineTo(px - 10, py + 26); g.stroke(); // back leg
    g.beginPath(); g.moveTo(px - 1, py + 6); g.lineTo(px + 6, py + 16); g.lineTo(px + 9, py + 27); g.stroke(); // front leg
    _pedTex = finishTex(cv);
    return _pedTex;
  }

  // ---------------------------------------------------------------------
  //  CHUNKED INSTANCING — one InstancedMesh per (cell, part), frustum-culled
  // ---------------------------------------------------------------------
  // A city-wide InstancedMesh must be frustumCulled=false (r128 culls it by
  // the PROTOTYPE's bounding sphere, which sits at the origin), and then every
  // lamp in the world is vertex-shaded every frame, even from a highway 2 km
  // away. So each part is split into CELL x CELL m cells; each cell gets its
  // own mesh on a geometry that SHARES the prototype's attribute buffers but
  // carries its own boundingSphere, enclosing that cell's instances in world
  // space. r128 then culls whole cells like any mesh (camera AND shadow).
  //
  // chunked() returns a SET that also behaves like one big InstancedMesh for
  // callers that address instances by their GLOBAL index (city/props.js's
  // hitProp zero-scales a shot lamp through lampPools.bulb/glow by lampIdx):
  // set.setMatrixAt(i, m) / set.setColorAt(i, c) route to (mesh, local) and
  // flag that mesh's buffer; set.instanceMatrix / set.instanceColor are inert
  // stand-ins so `x.instanceMatrix.needsUpdate = true` stays harmless.
  // 550 m cells: big enough that a far camera sees a handful of cells per
  // part (draw calls), small enough that the frustum still drops most tris.
  const CELL = 550;
  // DISTANCE GATE (invisible-distance only): every set registers here and a
  // 2 Hz tick hides any cell whose nearest point is beyond its set's maxDist:
  // hardware 700 m (a lamp post there is a few pixels), lenses 600, pools
  // 420, signal halos 350. resetSets() at the start of each world build.
  const HW_DIST = 700;
  let live = [], tickOn = false;
  function resetSets() { live = []; }
  function register(set) {
    live.push(set);
    if (!tickOn && CBZ.onAlways) {
      tickOn = true;
      let acc = 1;
      CBZ.onAlways(7.35, function (dt) {
        const g = CBZ.game;
        if (!g || g.mode !== "city") return;
        acc += (dt || 0.016);
        if (acc < 0.5) return; acc = 0;
        cullSets(live, CBZ.camera && CBZ.camera.position);
      });
    }
    return set;
  }
  // plain meshes (e.g. props.js's glow-shell pools) joining the gate
  function registerMeshes(meshes, maxDist) {
    const ms = meshes.filter(function (m) { return m && m.geometry && m.geometry.boundingSphere; });
    for (const m of ms) { const b = m.geometry.boundingSphere; m._cellC = { x: b.center.x, z: b.center.z, r: b.radius }; }
    return register({ meshes: ms, enabled: true, maxDist: maxDist });
  }
  // items: [{x,y,z,ry,sx,sy,sz}]
  const _m4 = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(1, 1, 1);
  const _Y = new THREE.Vector3(0, 1, 0);
  function setInst(im, i, it) {
    _p.set(it.x, it.y, it.z);
    if (_q.setFromAxisAngle) _q.setFromAxisAngle(_Y, it.ry || 0);
    _s.set(it.sx == null ? 1 : it.sx, it.sy == null ? 1 : it.sy, it.sz == null ? 1 : it.sz);
    _m4.compose(_p, _q, _s);
    im.setMatrixAt(i, _m4);
  }
  let _litVC = null;
  function hardwareMaterial(doubleSide) {
    if (doubleSide) {
      if (!cache._matDS) { cache._matDS = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true, side: THREE.DoubleSide }); cache._matDS._shared = true; }
      return cache._matDS;
    }
    if (!_litVC) { _litVC = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true }); _litVC._shared = true; }
    return _litVC;
  }
  // a geometry that shares every attribute buffer with `geo` (no copy)
  function shareGeo(geo) {
    const g = new THREE.BufferGeometry();
    for (const k in geo.attributes) g.setAttribute(k, geo.attributes[k]);
    if (geo.index && g.setIndex) g.setIndex(geo.index);
    return g;
  }
  function protoRadius(geo) {
    if (!geo.boundingSphere && geo.computeBoundingSphere) geo.computeBoundingSphere();
    const s = geo.boundingSphere;
    if (!s || !s.center) return 12;
    return Math.hypot(s.center.x, s.center.y, s.center.z) + s.radius;
  }
  function cellOf(x, z) { return Math.floor(x / CELL) + "," + Math.floor(z / CELL); }
  // o: {cast, receive, order, userData, perMesh(im, count)}
  function chunked(name, geo, mat, items, o) {
    o = o || {};
    const n = items.length;
    const set = {
      isChunkSet: true, name: name, meshes: [], count: n, material: mat,
      map: new Int32Array(n).fill(-1), local: new Int32Array(n),
      instanceMatrix: { needsUpdate: false }, instanceColor: { needsUpdate: false },
      enabled: true, maxDist: o.maxDist != null ? o.maxDist : HW_DIST,
      setMatrixAt: function (i, m) {
        const mi = this.map[i]; if (mi < 0) return;
        const im = this.meshes[mi]; im.setMatrixAt(this.local[i], m); im.instanceMatrix.needsUpdate = true;
      },
      setColorAt: function (i, c) {
        const mi = this.map[i]; if (mi < 0) return;
        const im = this.meshes[mi]; im.setColorAt(this.local[i], c);
        if (im.instanceColor) im.instanceColor.needsUpdate = true;
      },
      meshOf: function (i) { const mi = this.map[i]; return mi < 0 ? null : this.meshes[mi]; },
      addTo: function (root) { for (const m of this.meshes) root.add(m); return this; },
    };
    if (!n || !geo || !THREE.InstancedMesh) return set;
    register(set);
    const cells = new Map();
    for (let i = 0; i < n; i++) {
      const k = cellOf(items[i].x, items[i].z);
      let c = cells.get(k); if (!c) { c = []; cells.set(k, c); }
      c.push(i);
    }
    const pr = protoRadius(geo);
    cells.forEach(function (idx) {
      const im = new THREE.InstancedMesh(shareGeo(geo), mat, idx.length);
      im.name = "street-hw-" + name;
      let cx = 0, cy = 0, cz = 0, sMax = 1;
      for (let j = 0; j < idx.length; j++) {
        const it = items[idx[j]];
        setInst(im, j, it);
        set.map[idx[j]] = set.meshes.length; set.local[idx[j]] = j;
        cx += it.x; cy += it.y; cz += it.z;
        sMax = Math.max(sMax, it.sx || 1, it.sy || 1, it.sz || 1);
      }
      cx /= idx.length; cy /= idx.length; cz /= idx.length;
      let r = 0;
      for (let j = 0; j < idx.length; j++) {
        const it = items[idx[j]];
        r = Math.max(r, Math.hypot(it.x - cx, it.y - cy, it.z - cz));
      }
      r += pr * sMax;
      if (THREE.Sphere && THREE.Vector3) im.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(cx, cy, cz), r);
      im._cellC = { x: cx, z: cz, r: r };
      im.instanceMatrix.needsUpdate = true;
      im.castShadow = !!o.cast; im.receiveShadow = o.receive !== false;
      im.frustumCulled = true;
      if (o.order != null) im.renderOrder = o.order;
      // userData: batch.js skips it, farcull leaves it to the frustum
      im.userData.terrain = true;
      im.userData.streetHardware = name;
      if (o.userData) for (const k in o.userData) im.userData[k] = o.userData[k];
      if (o.perMesh) o.perMesh(im, idx.length);
      set.meshes.push(im);
    });
    return set;
  }
  // distance gate for sets that are pointless far away (lenses, light pools):
  // a cell draws only when set.enabled and its sphere is within maxDist.
  function cullSets(sets, cam) {
    for (let s = 0; s < sets.length; s++) {
      const set = sets[s];
      for (let i = 0; i < set.meshes.length; i++) {
        const m = set.meshes[i], c = m._cellC;
        let vis = set.enabled;
        if (vis && set.maxDist && c && cam) vis = Math.hypot(c.x - cam.x, c.z - cam.z) - c.r < set.maxDist;
        if (m.visible !== vis) m.visible = vis;
      }
    }
  }

  // ---------------------------------------------------------------------
  //  GROUND LIGHT POOLS — additive decals, chunked like the hardware
  // ---------------------------------------------------------------------
  // items: [{x,y,z,ry,sx,sz,color:hex,k}] ; sx across local X, sz along local Z
  // The falloff is computed in the fragment shader (no texture, no encoding
  // or alpha-premultiply question) and the tint is a per-instance attribute
  // (aTint), so a pool is exactly: tint * falloff(r) * uI, added to the
  // surface under it. uI is the night ramp (setPoolIntensity).
  function poolGeometry() {
    return once("poolGeo", function () {
      const p = new Proto({ uv: true }); p.noColor = true;
      p.quad([0, 0, 0], [0.5, 0, 0], [0, 1, 0], 0.5, 0xffffff, { u0: 0, v0: 0, u1: 1, v1: 1 });
      return p.geometry();
    });
  }
  function poolMaterial() {
    const m = new THREE.ShaderMaterial({
      uniforms: { uI: { value: 0 } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      vertexShader: [
        "attribute vec3 aTint;",
        "varying vec3 vTint;",
        "varying vec2 vUv;",
        "void main() {",
        "  vTint = aTint;",
        "  vUv = uv;",
        "  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);",
        "}",
      ].join("\n"),
      fragmentShader: [
        "uniform float uI;",
        "varying vec3 vTint;",
        "varying vec2 vUv;",
        "void main() {",
        "  vec2 d = vUv * 2.0 - 1.0;",
        "  float r2 = dot(d, d);",
        "  if (r2 >= 1.0) discard;",
        "  float r = sqrt(r2);",
        // hot spot under the head + a soft shoulder that reaches 0 at the rim
        "  float a = 0.62 * exp(-r2 * 9.0) + 0.38 * pow(1.0 - r, 2.0);",
        "  gl_FragColor = vec4(vTint * (a * uI), 1.0);",
        "}",
      ].join("\n"),
    });
    m._shared = true;
    return m;
  }
  function setPoolColor(set, i, hex, k) {
    const im = set.meshOf ? set.meshOf(i) : null;
    if (!im) return;
    const a = im.geometry.attributes.aTint;
    if (!a) return;
    const rgb = hexRGB(hex), s = k == null ? 1 : k, j = set.local[i] * 3;
    a.array[j] = rgb[0] * s; a.array[j + 1] = rgb[1] * s; a.array[j + 2] = rgb[2] * s;
    a.needsUpdate = true;
  }
  function lightPools(items) {
    if (!items.length || !THREE.InstancedMesh || !THREE.ShaderMaterial || !THREE.InstancedBufferAttribute) return null;
    const mat = poolMaterial();
    const set = chunked("light-pools", poolGeometry(), mat, items.map(function (it) {
      return { x: it.x, y: it.y, z: it.z, ry: it.ry, sx: it.sx, sy: 1, sz: it.sz };
    }), {
      cast: false, receive: false, order: 3, maxDist: 420,
      // batch-exempt (batch.js would drop polygonOffset)
      userData: { roadPaint: true },
      perMesh: function (im, count) {
        im.geometry.setAttribute("aTint", new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3));
      },
    });
    for (let i = 0; i < items.length; i++) setPoolColor(set, i, items[i].color, items[i].k);
    set.enabled = false;              // the night driver turns it on at dusk
    for (const m of set.meshes) m.visible = false;
    return set;
  }
  function setPoolIntensity(set, v) {
    if (!set) return;
    set.material.uniforms.uI.value = v;
    set.enabled = v > 0.02;
  }
  // seat a decal footprint on the DRAWN ground stack (world.js's groundDecalY):
  // the highest surface anywhere under the ellipse, so a raised footway never
  // swallows the part of the pool that falls on it.
  function seatY(city, x, z, ry, sx, sz) {
    const f = city && city.groundDecalY;
    if (typeof f !== "function") return 0.1;
    const c = Math.cos(ry || 0), s = Math.sin(ry || 0);
    let y = -Infinity;
    const pts = [[0, 0], [0.3, 0], [-0.3, 0], [0, 0.3], [0, -0.3]];
    for (const q of pts) {
      const lx = q[0] * sx, lz = q[1] * sz;
      const wx = x + lx * c + lz * s, wz = z - lx * s + lz * c;
      const h = +f(wx, wz);
      if (Number.isFinite(h) && h > y) y = h;
    }
    return (Number.isFinite(y) ? y : 0) + 0.02;
  }

  CBZ.streetHW = {
    D: D,
    Proto: Proto,
    mastPole: mastPole, mastArm: mastArm, pedPole: pedPole,
    vehicleHead: vehicleHead, pedHead: pedHead,
    luminaire: luminaire, lumOffsets: lumOffsets,
    signalLens: signalLens, pedLens: pedLens, lampLens: lampLens,
    pedTexture: pedTexture,
    hardwareMaterial: hardwareMaterial, chunked: chunked, cullSets: cullSets, resetSets: resetSets, registerMeshes: registerMeshes, setInst: setInst, CELL: CELL,
    lightPools: lightPools, setPoolColor: setPoolColor, setPoolIntensity: setPoolIntensity, seatY: seatY,
  };
})();
