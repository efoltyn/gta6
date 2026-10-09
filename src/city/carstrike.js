/* ============================================================
   city/carstrike.js — A CAR HITS A PERSON. The car's real shape against
   the struck body, every ragdoll substep, until the body is off the car.

   WHY THIS EXISTS (owner: "it does run them over, but it looks like they go
   through the car"). Two faults, both in the old run-over:
     1. THE HIT WAS A CIRCLE. vehicles.js runOver fired when a person's
        centre came within 1.79 m of the car's CENTRE. A saloon is 4.4-4.6 m
        long, so the nose is 2.2-2.3 m out: by the time the circle fired the
        person was already 0.4-0.6 m inside the bonnet, and a person beside
        the front wheel was never inside it at all.
     2. NOTHING KNEW THE CAR WAS SOLID. The kill seeded a verlet body where
        the person stood (inside the hull) and kicked it radially away from
        the car's centre. city/ragdoll.js collides with the static world
        (queryCollidersNear) and the street; a car is in neither, so the body
        flew through the hull and the car drove on through the body.

   WHAT A STRIKE IS NOW:
     · DETECTION is the car's own footprint (vehicleDims, the same numbers
       every other system reads), swept over the frame's travel, so a 70 km/h
       car cannot step over a person between frames.
     · THE SHAPE is the car's real side profile: its meshes are sampled ONCE
       (on its first strike) into a (z, y) outline — bumper face, bonnet
       leading edge, bonnet, windscreen rake, roof, tail — extruded across
       the body's width. Exact signed distance to that extrusion gives depth
       and normal. Every outline edge is labelled (bumper / bonnet / screen /
       roof / rear / underside) so blood, dents and the screen crack land on
       the panel that was actually hit. No mesh (a proxy, a headless test):
       a per-body-kind outline fitted to the car's dims.
     · CONTACT, every ragdoll substep while the body is engaged: each of the
       13 points (its own radius) and the long bones' midpoints are swept
       from where they were, in the car's frame at the start of the substep,
       to where they are at its end. A point that entered is put back on
       the face it came through; its velocity RELATIVE TO THE CAR loses its
       normal part (a little restitution) and some of its slide (friction),
       so the bumper drives the shins at the car's speed and the rest of the
       body is pulled after them by its own bones. Nothing is scripted: the
       wrap onto the bonnet, the head into the screen, the roof vault, the
       throw when the car brakes all fall out of a moving solid shape.
     · MOMENTUM goes both ways: every contact impulse the body takes, the car
       gives up along its travel (car mass ~1.35 t x its profile factor).
     · UNDER THE CAR: the underside clamps a body under it (squashed, dragged
       along); a tyre that reaches a body climbs it — the car's own springs
       (cardyn.suspKick) take the bump, front axle then rear.
     · Only the struck bodies run any of this. Everything else is untouched.

   The PURE core (CORE) touches no THREE / CBZ / scene, so
   tools/test-car-strike.mjs drives the real ragdoll against it in node.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;

  /* ==CARSTRIKE CORE== ------------------------------------------------- */
  const CORE = (function () {
    // ---- side outlines per body kind, metres, nose (+z) to tail. Reference
    //      L x H; scaled to the car's own dims. First and last points sit on
    //      the underside line yb; the closing edge back to the front is the
    //      underside.
    const PROFILES = {
      sedan: { L: 4.6, H: 1.45, yb: 0.2, z: [2.30, 2.32, 2.22, 1.95, 0.95, 0.05, -0.95, -1.55, -2.20, -2.30, -2.28],
                                          y: [0.20, 0.50, 0.72, 0.80, 0.92, 1.42, 1.45, 1.05, 1.00, 0.55, 0.20] },
      hatch: { L: 4.2, H: 1.48, yb: 0.2, z: [2.10, 2.12, 2.00, 1.75, 0.95, 0.10, -1.60, -2.05, -2.10],
                                          y: [0.20, 0.50, 0.72, 0.80, 0.92, 1.45, 1.48, 1.20, 0.22] },
      coupe: { L: 4.4, H: 1.25, yb: 0.16, z: [2.20, 2.24, 2.12, 1.85, 0.75, -0.05, -0.75, -1.70, -2.15, -2.20, -2.18],
                                           y: [0.16, 0.42, 0.60, 0.68, 0.82, 1.22, 1.25, 0.95, 0.90, 0.50, 0.18] },
      muscle: { L: 4.9, H: 1.35, yb: 0.2, z: [2.45, 2.47, 2.36, 2.05, 0.85, 0.05, -0.95, -1.65, -2.35, -2.45, -2.43],
                                           y: [0.20, 0.52, 0.76, 0.85, 0.95, 1.32, 1.35, 1.02, 0.98, 0.55, 0.20] },
      suv: { L: 4.8, H: 1.8, yb: 0.3, z: [2.40, 2.42, 2.35, 2.05, 1.10, 0.45, -1.90, -2.35, -2.40],
                                       y: [0.30, 0.75, 1.00, 1.08, 1.15, 1.75, 1.80, 1.60, 0.35] },
      pickup: { L: 5.4, H: 1.85, yb: 0.32, z: [2.70, 2.72, 2.62, 2.30, 1.35, 0.75, -0.30, -0.45, -2.65, -2.70],
                                           y: [0.32, 0.80, 1.05, 1.12, 1.18, 1.80, 1.85, 1.15, 1.15, 0.40] },
      van: { L: 5.2, H: 2.1, yb: 0.3, z: [2.60, 2.62, 2.50, 2.20, 1.85, 1.20, -2.55, -2.60],
                                       y: [0.30, 0.70, 0.98, 1.05, 1.15, 2.00, 2.05, 0.35] },
      semi: { L: 7.0, H: 3.4, yb: 0.45, z: [3.50, 3.55, 3.50, 3.25, 3.10, -3.50, -3.50],
                                        y: [0.45, 1.10, 2.40, 2.75, 3.40, 3.40, 0.90] },
      bike: { L: 2.1, H: 1.1, yb: 0.3, z: [1.00, 1.05, 0.60, 0.20, -0.95, -1.05],
                                        y: [0.30, 0.75, 0.90, 1.10, 1.00, 0.30] },
    };
    const LAB = { UNDER: 0, FRONT: 1, BONNET: 2, SCREEN: 3, ROOF: 4, REAR: 5, SIDE: 6 };
    const LAB_NAME = ["under", "bumper", "bonnet", "screen", "roof", "rear", "side"];

    /* the polygon (z, y) closed by the underside; edges labelled from the
       geometry itself, so a mesh-derived outline classifies the same way */
    function makeShape(zs, ys, hw, kind, wb, wr) {
      const n = zs.length;
      const pz = new Float32Array(n), py = new Float32Array(n), lab = new Uint8Array(n);
      let zf = -Infinity, zr = Infinity, top = -Infinity, yb = Infinity;
      for (let i = 0; i < n; i++) {
        pz[i] = zs[i]; py[i] = ys[i];
        if (zs[i] > zf) zf = zs[i];
        if (zs[i] < zr) zr = zs[i];
        if (ys[i] > top) top = ys[i];
      }
      yb = Math.min(ys[0], ys[n - 1]);
      // the roof: every vertex within 8 cm of the top
      let roofF = -Infinity, roofR = Infinity;
      for (let i = 0; i < n; i++) if (ys[i] > top - 0.08) { if (zs[i] > roofF) roofF = zs[i]; if (zs[i] < roofR) roofR = zs[i]; }
      // bonnet line: the highest point of the outline in the front 30% that is
      // still well under the roof (the leading edge region)
      let bonnetY = 0;
      for (let i = 0; i < n; i++) if (zs[i] > roofF + 0.2 && ys[i] < top - 0.25 && ys[i] > bonnetY && zs[i] > zf - (zf - roofF) * 0.6) bonnetY = ys[i];
      if (!(bonnetY > 0)) bonnetY = top * 0.55;
      let bumperY = yb;
      // edge i joins vertex i to vertex i+1 (the last closes along the underside)
      let wsZ0 = 0, wsY0 = 0, wsZ1 = 0, wsY1 = 0, wsN = 0;
      for (let i = 0; i < n; i++) {
        if (i === n - 1) { lab[i] = LAB.UNDER; continue; }
        const za = zs[i], ya = ys[i], zb = zs[i + 1], yb2 = ys[i + 1];
        const mz = (za + zb) * 0.5, my = (ya + yb2) * 0.5;
        const dz = za - zb, dy = yb2 - ya;          // dz > 0 going rearward; dy > 0 rising rearward
        let L;
        if (mz >= roofR - 0.01 && mz <= roofF + 0.01 && Math.min(ya, yb2) > top - 0.12) L = LAB.ROOF;
        else if (mz < roofR) L = LAB.REAR;
        else if (Math.abs(dy) > 1.4 * Math.abs(dz) && my < bonnetY + 0.05 && mz > zf - 0.35) L = LAB.FRONT;
        else if (dy > 0.5 * Math.abs(dz) && my > bonnetY - 0.02) L = LAB.SCREEN;
        else L = LAB.BONNET;
        lab[i] = L;
        if (L === LAB.FRONT) bumperY = Math.max(bumperY, Math.min(ya, yb2) + Math.abs(dy) * 0.5);
        if (L === LAB.SCREEN) {
          if (!wsN) { wsZ0 = za; wsY0 = ya; }
          wsZ1 = zb; wsY1 = yb2; wsN++;
        }
      }
      return {
        kind: kind || "sedan", n, pz, py, lab, hw, yb, zf, zr, top, bonnetY, bumperY,
        roofF, roofR,
        ws: wsN ? { z0: wsZ0, y0: wsY0, z1: wsZ1, y1: wsY1 } : null,
        wb: wb || (zf - zr) * 0.6, wr: wr || Math.max(0.28, Math.min(0.55, top * 0.23)),
        wx: Math.max(0.3, hw - 0.2),
      };
    }
    function kindOf(k) { return PROFILES[k] ? k : (k === "box" || k === "truck" ? "van" : "sedan"); }
    function fromTable(kind, dims) {
      const P = PROFILES[kindOf(kind)];
      const L = (dims && dims.length) || P.L, H = (dims && dims.height) || P.H;
      const W = (dims && dims.width) || (kind === "bike" ? 0.8 : 2);
      const sz = L / P.L, sy = H / P.H;
      const zs = P.z.map((v) => v * sz), ys = P.y.map((v) => v * sy);
      return makeShape(zs, ys, W * 0.5 * 0.97, kindOf(kind), dims && dims.wheelbase, null);
    }
    /* THE OUTLINE OFF THE REAL MESH. xyz: car-local vertex positions (x right,
       y up off the road, z forward), from the triangles that reach the
       middle of the car (no mirrors, no wheels): the highest surface at each 8 cm slice;
       the nose and tail are where the band ends. Simplified to ~12 vertices
       (Douglas-Peucker, 2.5 cm), never inside its own underside. */
    function fromVerts(xyz, count, dims, kind) {
      const W = (dims && dims.width) || 2, hw = W * 0.5;
      const band = hw * 1.05;                       // the caller already kept what reaches the middle
      let zmin = Infinity, zmax = -Infinity, ymax = -Infinity;
      for (let i = 0; i < count; i++) {
        const x = xyz[i * 3], y = xyz[i * 3 + 1], z = xyz[i * 3 + 2];
        if (Math.abs(x) > band || y < 0.12) continue;
        if (z < zmin) zmin = z; if (z > zmax) zmax = z; if (y > ymax) ymax = y;
      }
      if (!(zmax - zmin > 0.8) || !(ymax > 0.4)) return null;
      const BIN = 0.08, nb = Math.min(400, Math.ceil((zmax - zmin) / BIN) + 1);
      const top = new Float32Array(nb).fill(-1);
      for (let i = 0; i < count; i++) {
        const x = xyz[i * 3], y = xyz[i * 3 + 1], z = xyz[i * 3 + 2];
        if (Math.abs(x) > band || y < 0.12) continue;
        const b = Math.min(nb - 1, Math.max(0, Math.floor((zmax - z) / BIN)));
        if (y > top[b]) top[b] = y;
      }
      // fill gaps (a slice with no vertex in the band) from its neighbours
      for (let b = 0; b < nb; b++) if (top[b] < 0) {
        let l = b - 1, r = b + 1;
        while (l >= 0 && top[l] < 0) l--; while (r < nb && top[r] < 0) r++;
        top[b] = Math.max(l >= 0 ? top[l] : 0, r < nb ? top[r] : 0);
      }
      const yb = Math.max(0.12, Math.min(0.45, ymax * 0.13));
      const zs = [zmax], ys = [yb];
      for (let b = 0; b < nb; b++) { zs.push(zmax - (b + 0.5) * BIN); ys.push(Math.max(yb + 0.08, top[b])); }
      zs[1] = zmax;                                  // the nose face is vertical up to the first slice
      zs.push(zmin); ys.push(yb);
      // Douglas-Peucker
      const keep = new Uint8Array(zs.length); keep[0] = keep[zs.length - 1] = 1; keep[1] = 1; keep[zs.length - 2] = 1;
      (function dp(a, b) {
        let worst = -1, wi = -1;
        const ez = zs[b] - zs[a], ey = ys[b] - ys[a], el = Math.hypot(ez, ey) || 1e-6;
        for (let i = a + 1; i < b; i++) {
          const d = Math.abs((zs[i] - zs[a]) * ey - (ys[i] - ys[a]) * ez) / el;
          if (d > worst) { worst = d; wi = i; }
        }
        if (worst > 0.025 && wi > 0) { keep[wi] = 1; dp(a, wi); dp(wi, b); }
      })(1, zs.length - 2);
      const oz = [], oy = [];
      for (let i = 0; i < zs.length; i++) if (keep[i]) { oz.push(zs[i]); oy.push(ys[i]); }
      return makeShape(oz, oy, hw * 0.97, kind || "mesh", dims && dims.wheelbase, null);
    }

    /* signed distance from (u=z, v=y) to the outline polygon; Q gets the
       outward normal (nz, ny) and the label of the nearest edge */
    function sdPoly(S, u, v, Q) {
      const pz = S.pz, py = S.py, n = S.n;
      let best = Infinity, bi = 0, bu = 0, bv = 0, sgn = 1;
      for (let i = 0, j = n - 1; i < n; j = i, i++) {
        // edge j -> i (edge index j: vertex j to vertex j+1 == i, with wrap)
        const ez = pz[i] - pz[j], ey = py[i] - py[j];
        const wz = u - pz[j], wy = v - py[j];
        const ee = ez * ez + ey * ey;
        let t = ee > 0 ? (wz * ez + wy * ey) / ee : 0;
        t = t < 0 ? 0 : (t > 1 ? 1 : t);
        const bz = wz - ez * t, by = wy - ey * t;
        const d = bz * bz + by * by;
        if (d < best) { best = d; bi = j; bu = bz; bv = by; }
        const c1 = v >= py[j], c2 = v < py[i], c3 = ez * wy > ey * wz;
        if ((c1 && c2 && c3) || (!c1 && !c2 && !c3)) sgn = -sgn;
      }
      const d = Math.sqrt(best);
      Q.lab = S.lab[bi];
      if (d > 1e-6) {
        // outside: from the nearest point out to p; inside: from p out to the nearest point
        const k = (sgn > 0 ? 1 : -1) / d;
        Q.nz = bu * k; Q.ny = bv * k;
      } else {
        const j = bi, i = (bi + 1) % n;
        let ez = pz[i] - pz[j], ey = py[i] - py[j];
        const l = Math.hypot(ez, ey) || 1;
        Q.nz = ey / l; Q.ny = -ez / l;
      }
      return sgn > 0 ? d : -d;
    }
    // the polygon is wound front-bottom -> over the top -> rear-bottom; the
    // even-odd test above gives sgn = -1 inside regardless of winding.

    /* exact signed distance to the extrusion (polygon x [-hw, hw]) */
    function query(S, x, y, z, Q) {
      const d2 = sdPoly(S, z, y, Q);
      const ax = x < 0 ? -x : x, sx = x < 0 ? -1 : 1;
      const dx = ax - S.hw;
      if (d2 < 0 && dx < 0) {
        if (dx > d2) { Q.d = dx; Q.nx = sx; Q.ny = 0; Q.nz = 0; Q.lab = LAB.SIDE; }
        else { Q.d = d2; Q.nx = 0; }
      } else if (dx <= 0) { Q.d = d2; Q.nx = 0; }
      else if (d2 <= 0) { Q.d = dx; Q.nx = sx; Q.ny = 0; Q.nz = 0; Q.lab = LAB.SIDE; }
      else {
        const L = Math.sqrt(dx * dx + d2 * d2);
        Q.d = L; Q.nx = sx * dx / L; Q.ny *= d2 / L; Q.nz *= d2 / L;
        if (dx > d2) Q.lab = LAB.SIDE;
      }
      return Q.d;
    }

    // ---- poses: {x, y, z, s, c, vx, vz} — s/c = sin/cos(heading); car local
    //      +x = (c, -s), +z = (s, c) in world xz (THREE's rotation.y frame)
    function setPose(P, x, y, z, heading, vx, vz) {
      P.x = x; P.y = y; P.z = z; P.s = Math.sin(heading || 0); P.c = Math.cos(heading || 0);
      P.h = heading || 0; P.vx = vx || 0; P.vz = vz || 0; return P;
    }
    function lerpPose(O, A, B, t) {
      O.x = A.x + (B.x - A.x) * t; O.y = A.y + (B.y - A.y) * t; O.z = A.z + (B.z - A.z) * t;
      let dh = B.h - A.h; while (dh > Math.PI) dh -= 2 * Math.PI; while (dh < -Math.PI) dh += 2 * Math.PI;
      O.h = A.h + dh * t; O.s = Math.sin(O.h); O.c = Math.cos(O.h);
      O.vx = A.vx + (B.vx - A.vx) * t; O.vz = A.vz + (B.vz - A.vz) * t;
      return O;
    }
    function toLocal(P, wx, wy, wz, out) {
      const dx = wx - P.x, dz = wz - P.z;
      out.x = dx * P.c - dz * P.s; out.y = wy - P.y; out.z = dx * P.s + dz * P.c;
      return out;
    }
    function toWorld(P, lx, ly, lz, out) {
      out.x = P.x + lx * P.c + lz * P.s; out.y = P.y + ly; out.z = P.z - lx * P.s + lz * P.c;
      return out;
    }
    function dirToWorld(P, nx, ny, nz, out) {
      out.x = nx * P.c + nz * P.s; out.y = ny; out.z = -nx * P.s + nz * P.c;
      return out;
    }

    // body mass per point (kg) — head, shoulders, hips, elbows, hands, knees, feet
    const MASS = [5, 8, 8, 11, 11, 2.5, 2.5, 1, 1, 6, 6, 3, 3];
    // long bones whose MIDDLE also meets the car: thighs, shins, the torso
    // sides, the upper arms (a point-only test lets a shin straddle a bumper)
    const BONES = [3, 9, 4, 10, 9, 11, 10, 12, 1, 3, 2, 4, 1, 5, 2, 6];
    const REST = 0.12, MU = 0.45;

    const _Q = { d: 0, nx: 0, ny: 0, nz: 0, lab: 0 }, _Qa = { d: 0, nx: 0, ny: 0, nz: 0, lab: 0 };
    const _a = { x: 0, y: 0, z: 0 }, _b = { x: 0, y: 0, z: 0 }, _m = { x: 0, y: 0, z: 0 }, _w = { x: 0, y: 0, z: 0 }, _n = { x: 0, y: 0, z: 0 };

    /* one point's (or one bone's) contact response. p/q: world verlet
       arrays; idx: the point indices to move (1 or 2); push in world;
       n: world normal; carV: car velocity per substep. */
    function respond(p, q, i, push, n, cvx, cvz, R, mass, h) {
      const ix = i * 3;
      const vx0 = p[ix] - q[ix], vy0 = p[ix + 1] - q[ix + 1], vz0 = p[ix + 2] - q[ix + 2];
      p[ix] += push.x; p[ix + 1] += push.y; p[ix + 2] += push.z;
      let rx = vx0 - cvx, ry = vy0, rz = vz0 - cvz;
      const vn = rx * n.x + ry * n.y + rz * n.z;
      let close = 0;
      if (vn < 0) {
        close = -vn / h;
        const dn = -vn * (1 + REST);
        rx += n.x * dn; ry += n.y * dn; rz += n.z * dn;
        // friction: take up to MU x the normal change off the slide
        const vn2 = rx * n.x + ry * n.y + rz * n.z;
        let tx = rx - n.x * vn2, ty = ry - n.y * vn2, tz = rz - n.z * vn2;
        const tl = Math.sqrt(tx * tx + ty * ty + tz * tz);
        if (tl > 1e-9) {
          const k = Math.max(0, 1 - MU * dn / tl);
          rx = n.x * vn2 + tx * k; ry = n.y * vn2 + ty * k; rz = n.z * vn2 + tz * k;
        }
      }
      const vx1 = rx + cvx, vy1 = ry, vz1 = rz + cvz;
      q[ix] = p[ix] - vx1; q[ix + 1] = p[ix + 1] - vy1; q[ix + 2] = p[ix + 2] - vz1;
      R.jx += mass * (vx1 - vx0) / h; R.jy += mass * (vy1 - vy0) / h; R.jz += mass * (vz1 - vz0) / h;
      return close;
    }

    /* THE PASS. S shape, A/B car pose at the substep's start/end, p/q/p0
       the body (p0 = positions at the substep's start), rad per point,
       sk body scale, h substep seconds, ground(x, z, y) the street.
       R accumulates: impulse on the body (jx,jy,jz, N s), contacts, the
       hardest closing speed per label, tyre lifts, and up to 4 events. */
    function pass(S, A, B, p, q, p0, rad, sk, h, ground, R) {
      const cvx = B.vx * h, cvz = B.vz * h;
      let n = 0;
      // ---- the bones' middles first (a shin across the bumper, a thigh on the
      //      bonnet edge); the points after them have the last word
      for (let k = 0; k < BONES.length; k += 2) {
        const i = BONES[k] * 3, j = BONES[k + 1] * 3;
        const r = Math.min(rad[BONES[k]], rad[BONES[k + 1]]) * sk;
        toLocal(B, (p[i] + p[j]) * 0.5, (p[i + 1] + p[j + 1]) * 0.5, (p[i + 2] + p[j + 2]) * 0.5, _b);
        if (_b.x > S.hw + r || _b.x < -S.hw - r || _b.z > S.zf + r || _b.z < S.zr - r || _b.y > S.top + r) continue;
        if (_b.y < S.yb + r * 0.5) continue;                 // the underside is the points' business
        const d = query(S, _b.x, _b.y, _b.z, _Q);
        if (d >= r || _Q.lab === LAB.UNDER) continue;
        const s = r - d + 0.002;
        dirToWorld(B, _Q.nx, _Q.ny, _Q.nz, _n);
        _m.x = _n.x * s; _m.y = _n.y * s; _m.z = _n.z * s;
        const c1 = respond(p, q, BONES[k], _m, _n, cvx, cvz, R, MASS[BONES[k]] * 0.5, h);
        const c2 = respond(p, q, BONES[k + 1], _m, _n, cvx, cvz, R, MASS[BONES[k + 1]] * 0.5, h);
        const lab = _Q.lab, c = Math.max(c1, c2);
        R.touch |= 1 << lab;
        if (c > (R.close[lab] || 0)) R.close[lab] = c;
        n++;
      }
      for (let i = 0; i < 13; i++) {
        const ix = i * 3;
        const r = rad[i] * sk;
        toLocal(B, p[ix], p[ix + 1], p[ix + 2], _b);
        // cheap reject: well clear of the footprint
        if (_b.x > S.hw + r + 0.05 || _b.x < -S.hw - r - 0.05 || _b.z > S.zf + r + 0.4 || _b.z < S.zr - r - 0.4 || _b.y > S.top + r + 0.05) continue;
        let d = query(S, _b.x, _b.y, _b.z, _Q);
        // ---- under the chassis: squashed, dragged, and a tyre climbs it
        // (under = the centre is inside the footprint and low; a point in
        //  front of the nose whose nearest edge is the underside's corner
        //  is NOT under the car: it leaves by the nose face, horizontally)
        // (a centre within half its radius of the underside line, inside a
        //  radius of the footprint, is a foot the bumper sweeps over or a
        //  body lying in the road: it goes under, squashed, and the tyres
        //  climb it; it is not bulldozed by the bumper face)
        const ax = Math.abs(_b.x);
        const inFoot = _b.z < S.zf && _b.z > S.zr && ax < S.hw;
        const nearFoot = _b.z < S.zf + r && _b.z > S.zr - r && ax < S.hw + r;
        const under = (nearFoot && _b.y < S.yb + r * 0.5) || (inFoot && d < r && _Q.lab === LAB.UNDER);
        if (under) {
          underBody(S, B, p, q, i, r, _b, cvx, cvz, ground, R, h);
          continue;
        }
        if (d < r && _Q.lab === LAB.UNDER) cornerOut(S, _b, _Q);
        let nlx, nly, nlz, lab;
        if (d >= r) {
          // TUNNEL CHECK: clear at both ends, but did the path cross the car?
          toLocal(A, p0[ix], p0[ix + 1], p0[ix + 2], _a);
          let hit = false;
          for (let k = 1; k <= 3 && !hit; k++) {
            const t = k / 4;
            if (query(S, _a.x + (_b.x - _a.x) * t, _a.y + (_b.y - _a.y) * t, _a.z + (_b.z - _a.z) * t, _Qa) < r) hit = true;
          }
          if (!hit) continue;
          // it went through: put it back on the face it entered by
          if (_Qa.lab === LAB.UNDER) cornerOut(S, _b, _Qa);
          nlx = _Qa.nx; nly = _Qa.ny; nlz = _Qa.nz; lab = _Qa.lab;
        } else {
          toLocal(A, p0[ix], p0[ix + 1], p0[ix + 2], _a);
          const da = query(S, _a.x, _a.y, _a.z, _Qa);
          if (da >= r) {
            // ENTERED THIS SUBSTEP: bisect the path for the first touch; its
            // normal is the face it came through (never the far side)
            let lo = 0, hi = 1;
            for (let it = 0; it < 7; it++) {
              const t = (lo + hi) * 0.5;
              if (query(S, _a.x + (_b.x - _a.x) * t, _a.y + (_b.y - _a.y) * t, _a.z + (_b.z - _a.z) * t, _Qa) < r) hi = t; else lo = t;
            }
            query(S, _a.x + (_b.x - _a.x) * hi, _a.y + (_b.y - _a.y) * hi, _a.z + (_b.z - _a.z) * hi, _Qa);
            if (_Qa.lab === LAB.UNDER) cornerOut(S, _b, _Qa);
            nlx = _Qa.nx; nly = _Qa.ny; nlz = _Qa.nz; lab = _Qa.lab;
          } else { nlx = _Q.nx; nly = _Q.ny; nlz = _Q.nz; lab = _Q.lab; }
        }
        if (lab === LAB.UNDER) { underBody(S, B, p, q, i, r, _b, cvx, cvz, ground, R, h); continue; }
        // walk out along the entry normal until clear (the outline is not
        // convex at the cowl: re-measure, keep the direction)
        let mx = _b.x, my = _b.y, mz = _b.z;
        for (let it = 0; it < 8; it++) {
          const dd = query(S, mx, my, mz, _Q);
          if (dd >= r - 1e-4) break;
          const s = (r - dd) * (it < 3 ? 1 : 1.6) + 0.002;     // a corner gives back less than the step: lengthen
          mx += nlx * s; my += nly * s; mz += nlz * s;
        }
        toWorld(B, mx, my, mz, _w);
        _m.x = _w.x - p[ix]; _m.y = _w.y - p[ix + 1]; _m.z = _w.z - p[ix + 2];
        dirToWorld(B, nlx, nly, nlz, _n);
        const close = respond(p, q, i, _m, _n, cvx, cvz, R, MASS[i], h);
        n++; R.touch |= 1 << lab;
        if (close > (R.close[lab] || 0)) R.close[lab] = close;
        if (close > 1.5 && R.ev.length < 6 && (i <= 4)) {
          R.ev.push({ i, lab, close, x: p[ix] - _n.x * r, y: p[ix + 1] - _n.y * r, z: p[ix + 2] - _n.z * r,
            nx: _n.x, ny: _n.y, nz: _n.z, lx: mx - nlx * r, ly: my - nly * r, lz: mz - nlz * r, lnx: nlx, lny: nly, lnz: nlz });
        }
      }
      R.contacts += n;
      return n;
    }

    // the underside's corners: out by the nose / tail / flank, never down into the road
    function cornerOut(S, L, Q) {
      const ax = Math.abs(L.x) - S.hw, fz = L.z - S.zf, rz = S.zr - L.z;
      if (ax > fz && ax > rz) { Q.nx = L.x < 0 ? -1 : 1; Q.nz = 0; Q.lab = LAB.SIDE; }
      else if (fz >= rz) { Q.nx = 0; Q.nz = 1; Q.lab = LAB.FRONT; }
      else { Q.nx = 0; Q.nz = -1; Q.lab = LAB.REAR; }
      Q.ny = 0;
    }
    function underBody(S, B, p, q, i, r, L, cvx, cvz, ground, R, h) {
      const ix = i * 3;
      const gw = ground ? ground(p[ix], p[ix + 2], p[ix + 1]) : 0;
      const gl = gw - B.y;
      const ymin = gl + r * 0.5;                    // a body squashes to half its thickness, no further
      const ymax = S.yb - r * 0.5;
      // is a tyre on it?
      const tyreX = Math.abs(Math.abs(L.x) - S.wx) < 0.16 + r;
      const wz = S.wb * 0.5;
      const front = Math.abs(L.z - wz) < S.wr * 0.9, rear = Math.abs(L.z + wz) < S.wr * 0.9;
      if (tyreX && (front || rear)) {
        // the tyre climbs the body: its squashed thickness
        if (front) R.liftF = Math.max(R.liftF, r); else R.liftR = Math.max(R.liftR, r);
      }
      let y = L.y;
      if (y > ymax) y = Math.max(ymax, ymin);
      if (ymin > ymax) R.lift = Math.max(R.lift, ymin - ymax);
      const dy = (y - L.y);
      const vx0 = p[ix] - q[ix], vy0 = p[ix + 1] - q[ix + 1], vz0 = p[ix + 2] - q[ix + 2];
      p[ix + 1] += dy;
      // dragged along by the chassis. In the strike itself the feet under
      // the bumper are swept with it (bumper lip, undertray, the legs it is
      // taking); a body the car is only driving over is pressed, not
      // carried: a little drag where the underside actually bears on him
      const k = R.sweep ? 0.18 : (dy < -1e-4 ? 0.05 : 0);
      const vx1 = vx0 + (cvx - vx0) * k, vz1 = vz0 + (cvz - vz0) * k, vy1 = (R.sweep || dy < -1e-4) ? Math.min(vy0, 0) : vy0;
      q[ix] = p[ix] - vx1; q[ix + 1] = p[ix + 1] - vy1; q[ix + 2] = p[ix + 2] - vz1;
      R.jx += MASS[i] * (vx1 - vx0) / h; R.jz += MASS[i] * (vz1 - vz0) / h;
      R.under++; R.touch |= 1;
    }

    /* RIDE-UP: a body under the car that cannot squash thin enough lifts
       the car (its springs compress, the body rides up on him). How high
       the underside must ride, in this pose, for every point under it or
       at the nose's lower edge to fit at half its thickness. */
    function needLift(S, P, p, rad, sk, ground) {
      let need = 0;
      for (let i = 0; i < 13; i++) {
        const ix = i * 3, r = rad[i] * sk;
        toLocal(P, p[ix], p[ix + 1], p[ix + 2], _b);
        if (_b.z > S.zf + r || _b.z < S.zr - r || Math.abs(_b.x) > S.hw + r || _b.y > S.yb + r * 0.5) continue;
        const gl = (ground ? ground(p[ix], p[ix + 2], p[ix + 1]) : 0) - P.y;
        const n = gl + r - S.yb;                       // squashed top (gl + r) against the underside
        if (n > need) need = n;
      }
      return need;
    }

    /* how deep is the body in the car right now (metres, 0 = clear): the
       points with their radii and the bones' middles, the underside zone
       measured by its squash allowance instead (a body under a car is
       squashed against the road; that is not "in" the car) */
    function depth(S, P, p, rad, sk) {
      let worst = 0;
      for (let i = 0; i < 13; i++) {
        const ix = i * 3, r = rad[i] * sk;
        toLocal(P, p[ix], p[ix + 1], p[ix + 2], _b);
        if (_b.x > S.hw + r || _b.x < -S.hw - r || _b.z > S.zf + r || _b.z < S.zr - r || _b.y > S.top + r) continue;
        const d = query(S, _b.x, _b.y, _b.z, _Q);
        const ax = Math.abs(_b.x);
        const inFoot = _b.z < S.zf && _b.z > S.zr && ax < S.hw;
        const fringe = !inFoot && _b.z < S.zf + r && _b.z > S.zr - r && ax < S.hw + r && _b.y < S.yb + r * 0.5;
        const under = inFoot && (_b.y < S.yb + r * 0.5 || _Q.lab === LAB.UNDER);
        // under the chassis the body may be squashed to half its thickness
        // against the road; deeper than that is in the car. At the fringe
        // (a body the bumper is arriving over) the same half-thickness squash
        // against the nose's lower edge.
        const pen = under ? _b.y - Math.max(S.yb - r * 0.5, r * 0.5) : (fringe ? r * 0.5 - d : r - d);
        if (pen > worst) { worst = pen; depth.who = i; depth.lab = under ? 0 : _Q.lab; depth.ly = _b.y; depth.lz = _b.z; }
      }
      for (let k = 0; k < BONES.length; k += 2) {
        const i = BONES[k] * 3, j = BONES[k + 1] * 3;
        const r = Math.min(rad[BONES[k]], rad[BONES[k + 1]]) * sk;
        toLocal(P, (p[i] + p[j]) * 0.5, (p[i + 1] + p[j + 1]) * 0.5, (p[i + 2] + p[j + 2]) * 0.5, _b);
        if (_b.y < S.yb + r * 0.5) continue;
        const d = query(S, _b.x, _b.y, _b.z, _Q);
        if (_Q.lab === LAB.UNDER) continue;
        if (r - d > worst) { worst = r - d; depth.who = 100 + k; depth.lab = _Q.lab; depth.ly = _b.y; depth.lz = _b.z; }
      }
      return worst;
    }

    /* the footprint swept over the frame: does a person standing at (wx,wz)
       with radius r meet this car? travel = how far the car moved along its
       own z this frame (signed). Returns the local contact or null. */
    function sweptHit(S, P, wx, wy, wz, r, travel, out) {
      toLocal(P, wx, wy, wz, _b);
      if (_b.y < -1.2 || _b.y > S.top + 0.4) return null;
      if (Math.abs(_b.x) > S.hw + r) return null;
      const z1 = _b.z, z0 = _b.z + travel;           // where he was in the car's frame a frame ago
      const lo = Math.min(z0, z1), hi = Math.max(z0, z1);
      if (hi < S.zr - r || lo > S.zf + r) return null;
      out.lx = _b.x; out.lz = _b.z; out.ly = _b.y;
      out.end = z0 >= S.zf ? "front" : (z0 <= S.zr ? "rear" : "side");
      // where on the car he was met: the face his path crossed
      const fz = out.end === "front" ? S.zf : (out.end === "rear" ? S.zr : Math.max(S.zr, Math.min(S.zf, _b.z)));
      const fx = out.end === "side" ? (_b.x >= 0 ? S.hw : -S.hw) : Math.max(-S.hw, Math.min(S.hw, _b.x));
      const fy = Math.min(S.bumperY, Math.max(S.yb, S.bumperY * 0.8));
      toWorld(P, fx, fy, fz, _w);
      out.x = _w.x; out.y = _w.y; out.z = _w.z;
      return out;
    }

    return { PROFILES, LAB, LAB_NAME, MASS, makeShape, fromTable, fromVerts, query, setPose, lerpPose, toLocal, toWorld, dirToWorld, pass, depth, needLift, sweptHit };
  })();
  /* ==CARSTRIKE CORE END== --------------------------------------------- */

  const CS = CBZ.carStrike = { core: CORE };
  const THREE = window.THREE || null;

  // ---- car mass: vehicleProfile's factor (0.9 coupe .. 1.5 van, 4.2 semi)
  //      x a 1.35 t saloon. A few systems scale car.mass up for armour;
  //      those cars are heavier still.
  function carMass(car) {
    const m = car && car.mass > 0 ? car.mass : 1.05;
    return 1350 * Math.max(0.5, Math.min(12, m));
  }
  CS.carMass = carMass;
  function bodyKindOf(car) {
    const st = car && car.group && car.group.userData && car.group.userData.carStyle;
    if (st && /motorcycle/.test(st)) return "bike";
    return (car && (car._bk || (car.group && car.group.userData && car.group.userData.bodyKind))) ||
      (car && car.model && car.model.body) || "sedan";
  }
  function dimsOf(car) {
    return (car && (car._visualDims || car.dims)) ||
      (car && car.group && car.group.userData && car.group.userData.vehicleDims) ||
      { width: 2, length: 4.4, height: 1.5, wheelbase: 2.7 };
  }

  /* THE SHAPE, once per car visual. The real meshes in the car group's own
     frame; a car with nothing to sample (a proxy, a box test) keeps the
     table outline. Cached on the record and rebuilt only when the visual
     is swapped (the [C] style cycler, a respray rebuild). */
  const _v = THREE ? new THREE.Vector3() : null, _inv = THREE ? new THREE.Matrix4() : null, _mm = THREE ? new THREE.Matrix4() : null;
  let _buf = new Float32Array(3 * 4096);
  /* every triangle of the car that reaches into the middle 80 % of its
     width gives its three corners: a bonnet panel that is one quad spanning
     the car counts (its corners sit at the flanks), a door mirror or a
     wheel face that never reaches the middle does not. */
  let _tmp = new Float32Array(3 * 4096);
  function sampleMeshes(car, hw) {
    const g = car.group;
    if (!THREE || !g || !g.traverse || !g.updateMatrixWorld) return null;
    g.updateMatrixWorld(true);
    _inv.copy(g.matrixWorld).invert();
    const band = hw * 0.8;
    let n = 0;
    const stack = [g];
    while (stack.length) {
      const o = stack.pop();
      if (o !== g && o.userData && (o.userData.humanScale != null || o.userData.isCharacter || o.userData.playerWheel)) continue;   // a driver, a wheel: not the body
      if (o.visible === false) continue;
      const geo = o.isMesh && !o.isInstancedMesh ? o.geometry : null;
      const pa = geo && geo.attributes && geo.attributes.position;
      if (pa && pa.count >= 3) {
        const cnt = pa.count;
        if (_tmp.length < cnt * 3) _tmp = new Float32Array(cnt * 3);
        _mm.multiplyMatrices(_inv, o.matrixWorld);
        for (let k = 0; k < cnt; k++) {
          _v.fromBufferAttribute(pa, k).applyMatrix4(_mm);
          _tmp[k * 3] = _v.x; _tmp[k * 3 + 1] = _v.y; _tmp[k * 3 + 2] = _v.z;
        }
        const idx = geo.index ? geo.index.array : null;
        const nt = idx ? (idx.length / 3) | 0 : (cnt / 3) | 0;
        const stride = nt > 20000 ? Math.ceil(nt / 20000) : 1;
        for (let t = 0; t < nt; t += stride) {
          const i0 = idx ? idx[t * 3] : t * 3, i1 = idx ? idx[t * 3 + 1] : t * 3 + 1, i2 = idx ? idx[t * 3 + 2] : t * 3 + 2;
          const x0 = _tmp[i0 * 3], x1 = _tmp[i1 * 3], x2 = _tmp[i2 * 3];
          const lo = Math.min(x0, x1, x2), hi = Math.max(x0, x1, x2);
          if (lo > band || hi < -band) continue;
          if ((n + 3) * 3 > _buf.length) { if (_buf.length >= 3 * 300000) break; const nb = new Float32Array(_buf.length * 2); nb.set(_buf); _buf = nb; }
          for (const k of [i0, i1, i2]) { _buf[n * 3] = _tmp[k * 3]; _buf[n * 3 + 1] = _tmp[k * 3 + 1]; _buf[n * 3 + 2] = _tmp[k * 3 + 2]; n++; }
        }
      }
      const ch = o.children;
      if (ch) for (let k = 0; k < ch.length; k++) stack.push(ch[k]);
    }
    return n > 40 ? n : 0;
  }

  function shapeOf(car) {
    const vis = car.group && car.group.userData && car.group.userData.carVisual;
    const key = vis || car.group || car;
    if (car._csShape && car._csShapeKey === key) return car._csShape;
    if (car._proxy && CBZ.cityWakeCar) { try { CBZ.cityWakeCar(car); } catch (e) {} }
    const dims = dimsOf(car), kind = bodyKindOf(car);
    let S = null;
    try { const n = sampleMeshes(car, (dims.width || 2) * 0.5); if (n) S = CORE.fromVerts(_buf, n, dims, kind); } catch (e) { S = null; }
    // a mesh outline that is nothing like the car it claims to be (a box
    // body, a stray child) loses to the table
    if (S && (S.zf - S.zr < (dims.length || 4.4) * 0.6 || S.top < 0.5)) S = null;
    if (!S) S = CORE.fromTable(kind, dims);
    if (dims.wheelbase) S.wb = dims.wheelbase;
    car._csShape = S; car._csShapeKey = key;
    return S;
  }
  CS.shapeOf = shapeOf;

  function carVel(car, out) {
    let vx = car.vx, vz = car.vz;
    if (vx == null && vz == null) {
      const h = car.heading != null ? car.heading : (car.group ? car.group.rotation.y : 0);
      vx = Math.sin(h) * (car.v || 0); vz = Math.cos(h) * (car.v || 0);
    }
    out.vx = vx || 0; out.vz = vz || 0;
    return out;
  }
  const _cv = { vx: 0, vz: 0 };
  function poseOf(car, P, lead) {
    carVel(car, _cv);
    const pos = car.pos || (car.group && car.group.position);
    const y = car.group ? car.group.position.y : (pos.y || 0);
    const h = car.heading != null ? car.heading : (car.group ? car.group.rotation.y : 0);
    return CORE.setPose(P, pos.x + _cv.vx * (lead || 0), y, pos.z + _cv.vz * (lead || 0), h, _cv.vx, _cv.vz);
  }
  CS.poseOf = poseOf;

  /* ---- DETECTION: replaces runOver's 1.79 m circle round the car centre.
     The footprint, swept by this frame's travel. Returns a hit record (the
     world point where the car met him, which end) or null. */
  const _hp = CORE.setPose({}, 0, 0, 0, 0, 0, 0);
  // the outline detection reads: the sampled one once a car has struck
  // somebody, else the body kind's table outline (cached per car and dims)
  function quickShape(car) {
    if (car._csShape) return car._csShape;
    const d = dimsOf(car), k = bodyKindOf(car);
    const T = car._csTable;
    if (T && T._dl === d.length && T._dw === d.width && T._dk === k) return T;
    const S = CORE.fromTable(k, d);
    S._dl = d.length; S._dw = d.width; S._dk = k;
    car._csTable = S;
    return S;
  }
  const _hit = {};
  CS.hit = function (car, actor, vmag) {
    if (!car || !actor || !actor.pos) return null;
    const S = quickShape(car);                     // detection never pays for mesh sampling
    poseOf(car, _hp, 0);
    const dt = Math.min(0.05, CBZ.feelDt || 1 / 60);
    const sgn = (car.v || 0) < 0 ? -1 : 1;
    const travel = sgn * Math.max(Math.abs(vmag || 0), Math.hypot(_hp.vx, _hp.vz)) * dt;
    const r = actor.radius || 0.3;
    if (!CORE.sweptHit(S, _hp, actor.pos.x, actor.pos.y || 0, actor.pos.z, r, travel, _hit)) return null;
    return { x: _hit.x, y: _hit.y, z: _hit.z, lx: _hit.lx, ly: _hit.ly, lz: _hit.lz, end: _hit.end };   // a hit is rare: it gets its own record
  };

  /* ---- ENGAGE: the ragdoll slot now belongs to this car until it is off it.
     Called by ragdoll.js's CBZ.ragdollStrike once the slot exists. The kick
     the kill path banked (a radial throw from the car's centre) is dropped:
     the car's own moving shape is the impulse now. The body keeps the speed
     it was walking at. If the seed has it inside the hull (detection lags a
     frame), the whole body is put back where the car's face met it. */
  const _Q = { d: 0, nx: 0, ny: 0, nz: 0, lab: 0 }, _L = { x: 0, y: 0, z: 0 };
  CS.engage = function (s, car, info, RAD, quiet) {
    if (!s || !car) return false;
    const S = shapeOf(car);
    const P1 = poseOf(car, {}, 0);
    CS.audit.rad = RAD; CS.audit.k = s.k;
    const dt = Math.min(0.05, CBZ.feelDt || 1 / 60);
    const P0 = CORE.setPose({}, P1.x - P1.vx * dt, P1.y, P1.z - P1.vz * dt, P1.h, P1.vx, P1.vz);
    if (!quiet) { s.kv.fill(0); s.kicked = false; s.dyt = 0; s.noBeat = true; }
    // put him back on the face: march the whole body along the car's travel
    // until no point is in the shape (the underside zone excepted)
    const p = s.p, q = s.q, sk = s.k;
    let vdx = P1.vx, vdz = P1.vz;
    const vl = Math.hypot(vdx, vdz);
    if (vl > 0.3) { vdx /= vl; vdz /= vl; } else { vdx = P1.s; vdz = P1.c; }
    let need = 0;
    if (!quiet) for (let i = 0; i < 13; i++) {
      const ix = i * 3, r = RAD[i] * sk;
      CORE.toLocal(P1, p[ix], p[ix + 1], p[ix + 2], _L);
      if (_L.y < S.yb) continue;
      if (CORE.query(S, _L.x, _L.y, _L.z, _Q) >= r || _Q.lab === 0) continue;
      let lo = 0, hi = S.zf - S.zr + 1;
      for (let it = 0; it < 12; it++) {
        const m = (lo + hi) * 0.5;
        CORE.toLocal(P1, p[ix] + vdx * m, p[ix + 1], p[ix + 2] + vdz * m, _L);
        if (CORE.query(S, _L.x, _L.y, _L.z, _Q) >= r) hi = m; else lo = m;
      }
      if (hi > need) need = hi;
    }
    if (need > 0) {
      need += 0.01;
      for (let i = 0; i < 39; i += 3) { p[i] += vdx * need; q[i] += vdx * need; p[i + 2] += vdz * need; q[i + 2] += vdz * need; }
    }
    s.strike = {
      car, S, pose: P0, cur: P1, a: CORE.setPose({}, 0, 0, 0, 0, 0, 0), b: CORE.setPose({}, 0, 0, 0, 0, 0, 0),
      t: 0, lastContact: 0, v0: Math.hypot(P1.vx, P1.vz), dents: 0, cracks: 0, blood: 0, headHit: false,
      ride: 0, ride0: 0, axT: [0, 0], player: !!car.player, R: newR(), maxDepth: 0, regions: 0, touched: 0, quiet: !!quiet,
    };
    // the bumper paints where it met him
    if (quiet) return true;
    if (info && info.x != null && CBZ.goreCarStrike && Math.hypot(P1.vx, P1.vz) > 3) {
      try { CBZ.goreCarStrike(car, info.x, info.y + 0.1, info.z, -(info.x - P1.x), 0, -(info.z - P1.z), 0.7); } catch (e) {}
    }
    // a driver who hits somebody stands on the brakes (unless he meant it)
    if (!car.player && !car.reckless && car.pullover !== 4 && !car.roadRageTarget) car._csBrakeT = 1.6;
    return true;
  };
  /* the car rides up on a body under it (CORE.needLift), at once — a tyre
     on a man lifts the car the moment it is on him — and settles back at
     the springs' pace when it is off. The springs get the heave too. */
  const RIDE_MAX = 0.24;
  function rideUp(st, P, p, RAD, sk, h) {
    st.ride0 = st.ride;
    const need = Math.min(RIDE_MAX, CORE.needLift(st.S, P, p, RAD, sk, groundFn));
    const sp = st.car && st.car._susp;
    if (need > st.ride) {
      if (sp && need - st.ride > 0.01) sp.hv += (need - st.ride) * 6;
      st.ride = need;
    } else st.ride = Math.max(need, st.ride - 0.9 * h);
    // the drawn body sits up on him too (the springs' heave travel, 10 cm)
    if (sp && st.ride > 0.005 && sp.h < Math.min(0.1, st.ride)) sp.h = Math.min(0.1, st.ride);
  }
  function newR() { return { sweep: false, touch: 0, jx: 0, jy: 0, jz: 0, contacts: 0, under: 0, lift: 0, liftF: 0, liftR: 0, close: [0, 0, 0, 0, 0, 0, 0], ev: [] }; }
  function clearR(R) { R.touch = 0; R.jx = R.jy = R.jz = 0; R.contacts = 0; R.under = 0; R.lift = R.liftF = R.liftR = 0; for (let i = 0; i < 7; i++) R.close[i] = 0; R.ev.length = 0; }

  function groundFn(x, z, y) {
    if (CBZ.groundAt) { const g = CBZ.groundAt(x, z, y); if (Number.isFinite(g)) return g; }
    return CBZ.floorAt ? CBZ.floorAt(x, z) : 0;
  }

  /* ---- ONE SUBSTEP of contact (ragdoll.js solve, after the ground clamp).
     The car is interpolated between where this body last saw it and where
     it is by the end of the frame (an AI car moves AFTER the solver, so its
     end is extrapolated by its velocity; the driven car already moved). */
  CS.substep = function (s, p, q, p0, h, sub, dt, RAD) {
    const st = s.strike; if (!st) return;
    const car = st.car;
    if (!car || car.dead && !car.group) { s.strike = null; return; }
    if (sub === 0) poseOf(car, st.cur, car.player ? 0 : dt);
    CORE.lerpPose(st.a, st.pose, st.cur, sub / 2);
    CORE.lerpPose(st.b, st.pose, st.cur, (sub + 1) / 2);
    rideUp(st, st.b, p, RAD, s.k, h);
    st.a.y += st.ride0; st.b.y += st.ride;
    const R = st.R; clearR(R);
    R.sweep = !st.quiet && st.t < 0.6;               // the strike's first beat: the bumper sweeps the feet
    CORE.pass(st.S, st.a, st.b, p, q, p0, RAD, s.k, h, groundFn, R);
    if (R.contacts || R.under) { st.lastContact = st.t; s.wallT = 0.5; }
    consequences(s, st, R, h);
  };
  CS.measure = function (s, RAD) {
    const st = s.strike; if (!st) return 0;
    const d = CORE.depth(st.S, st.b, s.p, RAD, s.k);
    if (d > st.maxDepth) { st.maxDepth = d; if (CS.debug && d > 0.02) console.log("DEPTH", d.toFixed(3), JSON.stringify({ who: CORE.depth.who, lab: CORE.depth.lab, ly: +CORE.depth.ly.toFixed(3), lz: +CORE.depth.lz.toFixed(3), t: +st.t.toFixed(2), quiet: st.quiet, v: +Math.hypot(st.cur.vx, st.cur.vz).toFixed(2) })); }
    if (d > CS.audit.maxDepth) CS.audit.maxDepth = d;
    return d;
  };
  CS.audit = { touched: 0, headPanel: 0, strikes: 0, maxDepth: 0, dents: 0, cracks: 0, bumps: 0, lastV0: 0, lastLoss: 0 };

  /* ---- AFTER EVERY CAR HAS MOVED (ragdoll.js, order 37.9): the frame's
     real end pose. Whatever the extrapolation missed (a car that turned, a
     shove from resolveCars) is taken out here, so the drawn body is never
     in the drawn car. Then the pose is banked for the next frame's sweep. */
  CS.post = function (s, dt, RAD) {
    const st = s.strike; if (!st) return false;
    const car = st.car;
    st.t += dt;
    poseOf(car, st.cur, 0);
    const R = st.R; clearR(R);
    R.sweep = !st.quiet && st.t < 0.6;
    const h = Math.max(1e-3, dt * 0.5);
    const B = st.b;
    B.x = st.cur.x; B.y = st.cur.y; B.z = st.cur.z; B.h = st.cur.h; B.s = st.cur.s; B.c = st.cur.c; B.vx = st.cur.vx; B.vz = st.cur.vz;
    rideUp(st, B, s.p, RAD, s.k, h);
    B.y += st.ride;
    CORE.pass(st.S, B, B, s.p, s.q, s.p, RAD, s.k, h, groundFn, R);
    if (R.contacts || R.under) {
      st.lastContact = st.t; s.wallT = 0.5;
      // a car still moving into him wakes him; a stopped car only fits the
      // pose it froze in (a knee under the bumper lip goes under it)
      if (s.asleep && Math.hypot(st.cur.vx, st.cur.vz) > 0.3) { s.asleep = false; s.still = 0; }
    }
    consequences(s, st, R, h);
    st.pose.x = st.cur.x; st.pose.y = st.cur.y; st.pose.z = st.cur.z; st.pose.h = st.cur.h; st.pose.s = st.cur.s; st.pose.c = st.cur.c;
    st.pose.vx = st.cur.vx; st.pose.vz = st.cur.vz;
    // a body asleep on a bonnet wakes when the car moves off under it
    if (s.asleep && Math.hypot(st.cur.vx, st.cur.vz) > 0.4) {
      const S = st.S, p = s.p;
      for (let i = 0; i < 13; i++) {
        CORE.toLocal(st.cur, p[i * 3], p[i * 3 + 1], p[i * 3 + 2], _L);
        if (Math.abs(_L.x) < S.hw + 0.3 && _L.z < S.zf + 0.3 && _L.z > S.zr - 0.3 && _L.y < S.top + 0.4) { s.asleep = false; s.still = 0; break; }
      }
    }
    // done: off the car for a second, or long past the strike
    // (no clock cap: a car parked on a body keeps riding on it)
    if (st.t - st.lastContact > 1.2 && st.t > 0.6) { s.strike = null; }
    return R.contacts > 0;
  };

  function consequences(s, st, R, h) {
    const car = st.car;
    st.touched |= R.touch; CS.audit.touched |= R.touch;
    // ---- the car pays for every newton the body took (along its travel)
    const M = carMass(car);
    const v = car.v || 0;
    if (Math.abs(v) > 0.05 && (R.jx || R.jz)) {
      const fx = st.cur.s, fz = st.cur.c;                     // the car's nose, as the contact saw it
      const jf = R.jx * fx + R.jz * fz;                        // N s the body took along the car's nose
      let dv = jf / M;
      if (v > 0 && dv < 0) dv = 0; else if (v < 0 && dv > 0) dv = 0;
      if (Math.abs(dv) > Math.abs(v)) dv = v;
      car.v = v - dv;
      if (car.vx != null) { car.vx -= fx * dv; car.vz -= fz * dv; }
      CS.audit.lastLoss += dv;
    }
    // ---- a tyre went over him: the springs take the bump
    if (R.liftF > 0 || R.liftR > 0) {
      const sp = car._susp, CD = CBZ.carDyn;
      for (let ax = 0; ax < 2; ax++) {
        const lift = ax === 0 ? R.liftF : R.liftR;
        if (!(lift > 0) || st.t - st.axT[ax] < 0.35) continue;
        st.axT[ax] = st.t;
        CS.audit.bumps++;
        if (sp && CD && CD.suspKick) {
          const spd = Math.min(1, Math.abs(v) / 6 + 0.35);
          CD.suspKick(sp, lift * 9 * spd);                     // up: the body rides over him
          sp.pv += (ax === 0 ? -1 : 1) * lift * 5 * spd;       // nose up on the front axle, down on the rear
        }
        if (car.player) {
          if (CBZ.shake) CBZ.shake(0.18 + lift * 0.6);
          if (CBZ.sfx) CBZ.sfx("hit", { volume: 0.55, pitch: 0.7 });
        }
      }
    }
    // ---- where the head and the chest met metal and glass
    for (let k = 0; k < R.ev.length; k++) {
      const e = R.ev[k];
      const head = e.i === 0;
      if (head) CS.audit.headPanel |= 1 << e.lab;
      const panel = e.lab === 2 || e.lab === 3 || e.lab === 4;   // bonnet, screen, roof
      if (!panel) continue;
      const bit = 1 << (e.lab * 2 + (head ? 1 : 0));
      if (st.regions & bit) continue;
      if (e.close < (head ? 2.2 : 3.2)) continue;
      st.regions |= bit;
      if (head) st.headHit = true;
      const P = { x: e.x, y: e.y, z: e.z };
      // the dent (crashdeform owns denting; a head is a small hard crater)
      if (CBZ.cityCarImpact) {
        const en = Math.min(head ? 5 : 7, e.close * (head ? 0.55 : 0.5));
        if (en >= 1.2) { try { CBZ.cityCarImpact(car, P, { x: -e.nx, y: -e.ny, z: -e.nz }, en, { r: head ? 0.3 : 0.45 }); st.dents++; CS.audit.dents++; } catch (err) {} }
      }
      // the screen stars where a head (or a shoulder, harder) went into it
      if (e.lab === 3 && st.cracks < 2) { if (crackScreen(car, e, head)) { st.cracks++; CS.audit.cracks++; } }
      // and the blood is where he hit, not where a guess said
      if (CBZ.goreCarStrike && st.blood < 3) {
        try { CBZ.goreCarStrike(car, e.x, e.y, e.z, -e.nx, -e.ny, -e.nz, head ? 0.9 : 0.6); st.blood++; } catch (err) {}
      }
      if (head && car.player && CBZ.sfx) CBZ.sfx(e.lab === 3 ? "glass" : "hit", { volume: Math.min(1, 0.4 + e.close * 0.06) });
    }
  }

  /* ---- A BODY ALREADY LYING IN A CAR'S PATH. A corpse (or a man the car
     put down a second ago, disengaged) is still solid: a moving car that
     reaches one is engaged with it quietly (no new strike, no paint), so
     the bumper shoves it, the underside drags it and the tyres climb it.
     One list of moving cars near the camera per frame; the slot test is a
     distance check against each. */
  let _mvFrame = -1;
  const _moving = [];
  function movingCars() {
    const f = CBZ.now || 0;
    if (f === _mvFrame) return _moving;
    _mvFrame = f; _moving.length = 0;
    const L = CBZ.cityCars;
    if (!L) return _moving;
    const cam = CBZ.camera && CBZ.camera.position;
    for (let i = 0; i < L.length; i++) {
      const c = L[i];
      if (!c || c.dead || !c.pos || !(Math.abs(c.v || 0) > 0.3)) continue;
      if (c.group && c.group.visible === false) continue;
      if (cam) { const dx = c.pos.x - cam.x, dz = c.pos.z - cam.z; if (dx * dx + dz * dz > 90 * 90) continue; }
      _moving.push(c);
    }
    return _moving;
  }
  const _lp = CORE.setPose({}, 0, 0, 0, 0, 0, 0);
  CS.lyingInPath = function (s, RAD) {
    if (!s || s.strike || s.pin) return false;
    const M = movingCars();
    if (!M.length) return false;
    for (let k = 0; k < M.length; k++) {
      const car = M[k];
      const S = car._csShape || null;
      const d = dimsOf(car), half = (d.length || 4.4) * 0.5 + 1.6;
      const dx = s.cx - car.pos.x, dz = s.cz - car.pos.z;
      if (dx * dx + dz * dz > half * half + 4) continue;
      const SS = S || quickShape(car);
      poseOf(car, _lp, 0);
      const p = s.p;
      let near = false;
      for (let i = 0; i < 13 && !near; i++) {
        CORE.toLocal(_lp, p[i * 3], p[i * 3 + 1], p[i * 3 + 2], _L);
        if (Math.abs(_L.x) < SS.hw + 0.5 && _L.z < SS.zf + 0.6 && _L.z > SS.zr - 0.6 && _L.y < SS.top + 0.3) near = true;
      }
      if (!near) continue;
      return CS.engage(s, car, null, RAD, true);
    }
    return false;
  };

  /* ---- THE SCREEN CRACK: a star of fractures on the glass, parented to the
     car (so it drives away with it), on the screen plane at the point the
     head hit. One canvas, one material, at most two per car, twelve live. */
  let _crackTex = null, _crackMat = null;
  const _cracks = [];
  function crackTexture() {
    if (_crackTex) return _crackTex;
    const c = document.createElement("canvas"); c.width = 128; c.height = 128;
    const x = c.getContext && c.getContext("2d");
    if (!x) return null;
    x.clearRect(0, 0, 128, 128);
    x.strokeStyle = "rgba(235,245,255,0.9)"; x.lineCap = "round";
    const N = 13;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2 + (i * 0.41) % 0.6;
      const len = 34 + ((i * 17) % 28);
      x.lineWidth = 1.8 - (i % 3) * 0.45;
      x.beginPath(); x.moveTo(64, 64);
      const k1 = 0.45 + (i % 4) * 0.08;
      x.lineTo(64 + Math.cos(a + 0.12) * len * k1, 64 + Math.sin(a + 0.12) * len * k1);
      x.lineTo(64 + Math.cos(a) * len, 64 + Math.sin(a) * len);
      x.stroke();
    }
    x.lineWidth = 0.9;
    for (const rr of [9, 18, 29]) {
      x.beginPath();
      for (let i = 0; i <= N; i++) {
        const a = (i / N) * Math.PI * 2 + (i * 0.41) % 0.6;
        const px = 64 + Math.cos(a) * (rr + (i % 2) * 3), py = 64 + Math.sin(a) * (rr + (i % 2) * 3);
        if (i === 0) x.moveTo(px, py); else x.lineTo(px, py);
      }
      x.stroke();
    }
    x.fillStyle = "rgba(240,248,255,0.85)"; x.beginPath(); x.arc(64, 64, 5, 0, 7); x.fill();
    _crackTex = new THREE.CanvasTexture(c);
    return _crackTex;
  }
  const _nrm = THREE ? new THREE.Vector3() : null, _z = THREE ? new THREE.Vector3(0, 0, 1) : null;
  function crackScreen(car, e, head) {
    if (!THREE || !car.group || !car.group.add || typeof document === "undefined") return false;
    const tex = crackTexture(); if (!tex) return false;
    if (!_crackMat) _crackMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, opacity: 0.92 });
    const size = head ? 0.62 : 0.85;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), _crackMat);
    // the group's frame IS the car-local frame the contact was measured in
    m.position.set(e.lx + e.lnx * 0.012, e.ly + e.lny * 0.012, e.lz + e.lnz * 0.012);
    _nrm.set(e.lnx, e.lny, e.lnz).normalize();
    m.quaternion.setFromUnitVectors(_z, _nrm);
    m.rotation.z += (e.lx * 7.3) % 3.14;
    m.renderOrder = 3;
    m.name = "screen-crack";
    m.userData.noMerge = true;
    car.group.add(m);
    _cracks.push(m);
    while (_cracks.length > 12) { const o = _cracks.shift(); if (o.parent) o.parent.remove(o); if (o.geometry) o.geometry.dispose(); }
    return true;
  }
  CS.clearCracks = function (car) {
    for (let i = _cracks.length - 1; i >= 0; i--) {
      const o = _cracks[i];
      if (!car || o.parent === car.group) { if (o.parent) o.parent.remove(o); if (o.geometry) o.geometry.dispose(); _cracks.splice(i, 1); }
    }
  };

  /* ---- THE DRIVER BRAKES. A traffic driver who hits somebody stops: this
     is the "thrown forward as the car brakes" half of a real strike. Runs
     after traffic (37) so it is the last word on the speed this frame. */
  if (CBZ.onUpdate) CBZ.onUpdate(37.55, function (dt) {
    const L = CBZ.cityCars;
    if (!L || !L.length) return;
    for (let i = 0; i < L.length; i++) {
      const c = L[i];
      if (!c || !(c._csBrakeT > 0)) continue;
      c._csBrakeT -= dt;
      if (c.player || c.dead) { c._csBrakeT = 0; continue; }
      const v = c.v || 0, dv = 8.5 * dt;
      c.v = v > 0 ? Math.max(0, v - dv) : Math.min(0, v + dv);
      if (c.vx != null && Math.abs(v) > 1e-3) { const k = c.v / v; c.vx *= k; c.vz *= k; }
    }
  });

  /* ---- THE STRIKE (vehicles.js runOver / creepInto call this): the
     person meets the car's real shape. Dead or alive, near the camera, a
     full rig: the ragdoll takes him and this car is engaged with it. False
     = nothing took him (far away, over budget, no rig): the caller keeps its
     cheap path. The hook's signature (runOver(car, vmag)) is unchanged. */
  CS.strike = function (actor, car, info, vmag) {
    if (!CBZ.ragdollStrike || !actor || !car) return false;
    let ok = false;
    try { ok = !!CBZ.ragdollStrike(actor, car, info || null); } catch (e) { ok = false; }
    if (ok) { CS.audit.strikes++; CS.audit.lastV0 = Math.abs(vmag || car.v || 0); CS.audit.lastLoss = 0; }
    return ok;
  };
  // the momentum a person takes off a car that hit him and did NOT get the
  // full contact (far bodies, the cheap path): a perfectly plastic hit on
  // ~70 kg — a few percent, not the old fixed 10-28 %
  CS.cheapLoss = function (car, mass) {
    const M = carMass(car), m = mass || 70;
    car.v = (car.v || 0) * (M / (M + m));
  };
})();
