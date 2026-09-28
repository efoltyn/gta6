/* ============================================================
   entities/footwear.js — SHOES AS REAL OBJECTS, and the ANKLE they hang on.

   Owner, 2026-09-28: "shoes and where they meet with legs. When a guy is on
   the ground and his feet are up, his heels show his legs, so his legs go
   through his shoes." And overall: "it's like a little kid drew everything
   and you're redrawing it."

   WHAT WAS WRONG. Every body in every game wore ONE shoe: a rounded box
   squeezed at the top, rigidly parented to the SHIN at a fixed offset (there
   was no ankle), with the lower-leg tube running on INSIDE it all the way
   down to the sole line. Measured in plain node: the trouser tube's end dome
   came out 0.04 of a shoe-height THROUGH THE SOLE and its back ran within a
   few mm of the rounded heel; a bare shin's dome sat exactly on the sole's
   bottom face. Stood up, the sole hides it. Lie the man on his back with his
   feet toward the camera and you are looking at the bottom of the heel, and
   what you see there is his trouser leg. That is the owner's picture.

   WHAT IT IS NOW.
     · THE ANKLE IS A JOINT. character.js hangs a `foot` group (rig
       leg.userData.foot) at the ankle pivot inside the knee group; the shoe
       lives in it and rotates with it. The shin ENDS at that pivot (bare) or
       at the trouser hem (clothed), so the leg always ends INSIDE the shoe:
       nothing runs past the collar to the sole any more.
     · THE LEG IS SHORTENED TO THE SHOE, not the shoe fitted round the leg:
       the lower-leg loft is re-baked to end at the pivot (bare skin) or at
       this style's hem: a trouser breaks OVER a low shoe's collar, and tucks
       INTO a boot's shaft (a boot is built wide enough to take it).
     · THE FOOT POSES. character.js's ankle solve keeps the sole flat on the
       floor while a body is upright (stand, walk, sit, crouch, kneel), lets a
       swinging foot hang, and lets a lying body's feet fall into relaxed
       plantar flexion (toes pointing away) instead of standing straight up.
       Each style clamps the range (a cowboy boot barely flexes).
     · SHOES BY ROLE, as objects: every style is a lofted upper, a separate
       sole unit (welt, midsole, heel block, toe spring) in the sole's own
       material, laces or pull tabs or straps, and for the open styles a real
       bare foot with five toes.
         sneaker   cupsole with toe spring, padded collar + heel tab, tongue, laces
         combat    8-inch lace-up shaft, lug sole, trousers bloused into it
         work      6-inch lace-up, round toe, dark lug sole
         cowboy    tall scalloped shaft, pull tabs, pointed toe, underslung heel
         oxford    sleek closed lacing, thin welted sole, a real stacked heel
         loafer    low vamp, penny strap, moc-toe seam, thin sole + heel
         slipon    prison-issue canvas slip-on, white rubber sole
         sandal    a bare foot on a footbed, two straps + a heel strap
         flipflop  a bare foot on a thin sole, a Y strap round the big toe
         bare      the swimmers' bare foot (a "shoe" the colour of the skin)

   SLOTS (unchanged contract). leg.userData.cap and skinSlots.shoes are the
   UPPER mesh (the part outfits paint); the sole unit and a sandal's bare foot
   are its CHILDREN (so hiding the slot hides the shoe), in their own shared
   materials. Unit space: x -0.5..0.5 (x W), y 0 = sole bottom .. 1 = a low
   shoe's collar (x H), z -0.5 heel .. 0.5 toe (x D); the ankle pivot sits at
   (0, ANKLE_Y, ANKLE_Z). Geometry is shared per (style, lod, side).

   API (CBZ.footwear):
     fit(leg, style, color, skin, side)   dress a leg built by character.js
     restyle(rig, rec, colors)            the wardrobe dressed this body
     styleFor(c, rec, rig)                the style a person wears, by role
     lod(rig, lod)                        near (1) / far (2) geometry
     geometry(style, lod, side)           {upper, trim, skin} (tools)
     STYLES, ANKLE_Y, ANKLE_Z
   tools/shoe-check.mjs sweeps every style x body x pose.
============================================================ */
(function () {
  "use strict";
  const root = typeof window !== "undefined" ? window : globalThis;
  const CBZ = root.CBZ = root.CBZ || {};
  const THREE = root.THREE;
  if (!THREE) return;

  const ANKLE_Y = 0.52;     // the pivot, in shoe heights above the sole's bottom
  const ANKLE_Z = -0.20;    // the pivot along the shoe (the leg's axis)

  // ------------------------------------------------------------ helpers
  const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
  const lerp = (a, b, t) => a + (b - a) * t;
  const sstep = (t) => { t = clamp01(t); return t * t * (3 - 2 * t); };
  const spow = (v, e) => (v < 0 ? -Math.pow(-v, e) : Math.pow(v, e));
  function curve(keys, z) {
    if (z <= keys[0][0]) return keys[0][1];
    for (let i = 0; i < keys.length - 1; i++) {
      const a = keys[i], b = keys[i + 1];
      if (z <= b[0]) return lerp(a[1], b[1], sstep((z - a[0]) / (b[0] - a[0])));
    }
    return keys[keys.length - 1][1];
  }

  /* A little mesh kit: positions + index. Every triangle is emitted with a
     point known to be INSIDE its solid and flipped if it faces that point,
     so winding is right by construction whatever the parameterisation. */
  function Kit() { this.P = []; this.I = []; }
  Kit.prototype.v = function (x, y, z) { this.P.push(x, y, z); return this.P.length / 3 - 1; };
  Kit.prototype.tri = function (a, b, c, ix, iy, iz) {
    const P = this.P;
    const ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2];
    const ux = P[b * 3] - ax, uy = P[b * 3 + 1] - ay, uz = P[b * 3 + 2] - az;
    const vx = P[c * 3] - ax, vy = P[c * 3 + 1] - ay, vz = P[c * 3 + 2] - az;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (nx * nx + ny * ny + nz * nz < 1e-16) return;           // degenerate (a collapsed end ring)
    const cx = (ax + P[b * 3] + P[c * 3]) / 3 - ix, cy = (ay + P[b * 3 + 1] + P[c * 3 + 1]) / 3 - iy, cz = (az + P[b * 3 + 2] + P[c * 3 + 2]) / 3 - iz;
    if (nx * cx + ny * cy + nz * cz >= 0) this.I.push(a, b, c); else this.I.push(a, c, b);
  };
  Kit.prototype.append = function (g) {           // an indexed BufferGeometry, already outward
    const o = this.P.length / 3, p = g.attributes.position.array;
    for (let i = 0; i < p.length; i++) this.P.push(p[i]);
    const idx = g.index.array;
    for (let i = 0; i < idx.length; i++) this.I.push(idx[i] + o);
    g.dispose();
  };
  Kit.prototype.geo = function (name) {
    const g = new THREE.BufferGeometry();
    const n = this.P.length / 3;
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(this.P), 3));
    const uv = new Float32Array(n * 2).fill(0.5);
    g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    g.setIndex(new THREE.BufferAttribute(n > 65535 ? new Uint32Array(this.I) : new Uint16Array(this.I), 1));
    g.computeVertexNormals();
    g.computeBoundingBox(); g.computeBoundingSphere();
    g.name = name;
    g._shared = true; g.userData._shared = true;
    return g;
  }

  /* A SECTION across the foot at z: a flat-bottomed, round-shouldered outline
     whose half-width is x0 up to the widest line ym and draws in to xt at the
     top (a collar hugging an ankle, an instep under laces). */
  function secPt(S, th, out) {
    const c = Math.cos(th), s = Math.sin(th);
    let y, e;
    if (s >= 0) { e = 2 / S.nt; y = S.ym + (S.yt - S.ym) * Math.pow(s, e); }
    else { e = 2 / S.nb; y = S.ym - (S.ym - S.yb) * Math.pow(-s, e); }
    let hw = S.x0;
    if (y > S.ym && S.yt > S.ym + 1e-6) hw = S.x0 + (S.xt - S.x0) * Math.pow((y - S.ym) / (S.yt - S.ym), 1.4);
    out[0] = S.cx + hw * spow(c, e); out[1] = y; out[2] = S.z;
    return out;
  }
  // loft sections (heel -> toe) into the kit; the end sections collapse to points
  function loftZ(kit, secs, M) {
    const base = kit.P.length / 3, pt = [0, 0, 0];
    for (let i = 0; i < secs.length; i++) {
      for (let k = 0; k < M; k++) { secPt(secs[i], (k / M) * Math.PI * 2, pt); kit.v(pt[0], pt[1], pt[2]); }
    }
    for (let i = 0; i < secs.length - 1; i++) {
      const S = secs[i], T = secs[i + 1];
      const ix = (S.cx + T.cx) / 2, iy = (S.ym + T.ym) / 2, iz = (S.z + T.z) / 2;
      for (let k = 0; k < M; k++) {
        const a = base + i * M + k, b = base + i * M + (k + 1) % M, c = a + M, d = b + M;
        kit.tri(a, b, c, ix, iy, iz); kit.tri(b, d, c, ix, iy, iz);
      }
    }
  }
  /* A vertical tube (a boot shaft) round the leg's axis: rows {y, hx, hz},
     capped top and bottom. `dip(th)` lowers the top row (a cowboy scallop). */
  function tubeY(kit, rows, M, cz, dip) {
    const base = kit.P.length / 3;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      for (let k = 0; k < M; k++) {
        const th = (k / M) * Math.PI * 2;
        const y = r[0] - (i === rows.length - 1 && dip ? dip(th) : 0);
        kit.v(r[1] * spow(Math.sin(th), 0.8), y, cz + r[2] * spow(Math.cos(th), 0.8));
      }
    }
    const bot = kit.v(0, rows[0][0], cz), top = kit.v(0, rows[rows.length - 1][0] - (dip ? dip(Math.PI / 2) * 0.5 : 0), cz);
    for (let i = 0; i < rows.length - 1; i++) {
      const iy = (rows[i][0] + rows[i + 1][0]) / 2;
      for (let k = 0; k < M; k++) {
        const a = base + i * M + k, b = base + i * M + (k + 1) % M, c = a + M, d = b + M;
        kit.tri(a, b, c, 0, iy, cz); kit.tri(b, d, c, 0, iy, cz);
      }
    }
    const L = base + (rows.length - 1) * M, y0 = rows[0][0], y1 = rows[rows.length - 1][0];
    for (let k = 0; k < M; k++) {
      kit.tri(bot, base + (k + 1) % M, base + k, 0, y0 + 0.05, cz);
      kit.tri(top, L + k, L + (k + 1) % M, 0, y1 - 0.08, cz);
    }
  }
  /* A strap / lace / tab: a flat rectangular band swept through pts, lying
     ON a surface (normals ns point out of it), `w` half-width along dirs ws,
     `t` its thickness. Closed at both ends. */
  function band(kit, pts, ns, ws, w, t) {
    const base = kit.P.length / 3, n = pts.length;
    for (let j = 0; j < n; j++) {
      const p = pts[j], nn = ns[j];
      let ww = ws && ws[j];
      if (!ww) {
        const a = pts[Math.max(0, j - 1)], b = pts[Math.min(n - 1, j + 1)];
        const t = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        ww = nrm([nn[1] * t[2] - nn[2] * t[1], nn[2] * t[0] - nn[0] * t[2], nn[0] * t[1] - nn[1] * t[0]]);
      }
      const lo = -0.35 * t, hi = t;
      for (const [sw, sn] of [[-1, lo], [1, lo], [1, hi], [-1, hi]]) {
        kit.v(p[0] + ww[0] * w * sw + nn[0] * sn, p[1] + ww[1] * w * sw + nn[1] * sn, p[2] + ww[2] * w * sw + nn[2] * sn);
      }
    }
    const mid = (j) => { const p = pts[j], nn = ns[j]; return [p[0] + nn[0] * t * 0.3, p[1] + nn[1] * t * 0.3, p[2] + nn[2] * t * 0.3]; };
    for (let j = 0; j < n - 1; j++) {
      const m0 = mid(j), m1 = mid(j + 1), ix = (m0[0] + m1[0]) / 2, iy = (m0[1] + m1[1]) / 2, iz = (m0[2] + m1[2]) / 2;
      for (let k = 0; k < 4; k++) {
        const a = base + j * 4 + k, b = base + j * 4 + (k + 1) % 4, c = a + 4, d = b + 4;
        kit.tri(a, b, c, ix, iy, iz); kit.tri(b, d, c, ix, iy, iz);
      }
    }
    for (const j of [0, n - 1]) {
      const m = mid(j), o = base + j * 4, dj = j === 0 ? 1 : -1;
      const q = mid(j + dj), ix = m[0] + (q[0] - m[0]) * 0.1, iy = m[1] + (q[1] - m[1]) * 0.1, iz = m[2] + (q[2] - m[2]) * 0.1;
      kit.tri(o, o + 1, o + 2, ix, iy, iz); kit.tri(o, o + 2, o + 3, ix, iy, iz);
    }
  }
  function blob(kit, x, y, z, rx, ry, rz, seg) {
    const g = new THREE.SphereGeometry(1, seg, Math.max(3, seg - 2));
    g.scale(rx, ry, rz); g.translate(x, y, z);
    kit.append(g);
  }
  // a normalised copy
  const nrm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

  // ------------------------------------------------------------ the styles
  // The foot's plan (half-width at the widest line, unit): heel, waist, ball, toe.
  const PLAN = [[-0.5, 0.34], [-0.38, 0.40], [-0.2, 0.405], [0.02, 0.38], [0.22, 0.47], [0.36, 0.455], [0.5, 0.40]];
  /* Per style:
       top      the upper's top line along z (the collar / tongue / instep / toe)
       topW     half-width of the top (the collar hugging the ankle)
       wide     plan multiplier;   heelR/toeR, heelP/toeP  end rounding (length, squareness)
       sole     {heel, fore, spring, welt, arch, color, n} thicknesses in shoe heights
       laces    z list along the instep (and shaft heights)
       shaft    [top, hx, hz] a boot shaft round the leg; scallop / tabs
       hem      where a trouser leg ends (unit y); tuck = inside the shaft
       flex     [dorsi, plantar] the ankle's range in this shoe (radians) */
  const STYLES = {
    sneaker: {
      top: [[-0.5, 0.90], [-0.46, 1.0], [-0.41, 0.95], [-0.25, 0.92], [-0.08, 0.95], [0.02, 1.04], [0.10, 0.92], [0.22, 0.72], [0.34, 0.52], [0.42, 0.45], [0.5, 0.40]],
      topW: [[-0.5, 0.25], [-0.3, 0.30], [-0.1, 0.30], [0.05, 0.25], [0.2, 0.31], [0.4, 0.30], [0.5, 0.26]],
      wide: 1.0, heelR: 0.09, heelP: 2.6, toeR: 0.17, toeP: 2.0,
      sole: { heel: 0.25, fore: 0.16, spring: 0.10, welt: 0.035, arch: 0, color: 0xeeebe3, n: 5 },
      laces: { z: [0.05, 0.12, 0.19, 0.26], w: 0.020, color: 0xeeebe3 },
      hem: 0.84, flex: [-0.35, 0.70],
    },
    combat: {
      top: [[-0.5, 1.0], [-0.1, 1.02], [0.06, 1.0], [0.16, 0.86], [0.28, 0.64], [0.40, 0.52], [0.5, 0.46]],
      topW: [[-0.5, 0.30], [0.05, 0.32], [0.3, 0.32], [0.5, 0.28]],
      wide: 1.02, heelR: 0.08, heelP: 2.8, toeR: 0.18, toeP: 2.2,
      sole: { heel: 0.26, fore: 0.18, spring: 0.05, welt: 0.04, arch: 0.03, color: 0x151618, n: 7 },
      shaft: [1.45, 0.47, 0.34], laces: { z: [0.10, 0.19], y: [0.72, 0.88, 1.04, 1.20, 1.34], w: 0.022, color: 0x141416 },
      hem: 1.12, tuck: true, flex: [-0.10, 0.16],
    },
    work: {
      top: [[-0.5, 1.0], [-0.1, 1.0], [0.06, 0.98], [0.16, 0.86], [0.28, 0.68], [0.40, 0.58], [0.5, 0.52]],
      topW: [[-0.5, 0.30], [0.05, 0.32], [0.3, 0.34], [0.5, 0.30]],
      wide: 1.04, heelR: 0.08, heelP: 2.6, toeR: 0.20, toeP: 2.0,
      sole: { heel: 0.24, fore: 0.17, spring: 0.05, welt: 0.05, arch: 0.02, color: 0x2a2019, n: 7 },
      shaft: [1.22, 0.46, 0.33], laces: { z: [0.10, 0.19], y: [0.76, 0.94, 1.10], w: 0.022, color: 0x3a2a1c },
      hem: 0.90, tuck: true, flex: [-0.14, 0.24],
    },
    cowboy: {
      top: [[-0.5, 1.0], [0.0, 1.0], [0.12, 0.82], [0.28, 0.56], [0.42, 0.40], [0.5, 0.32]],
      topW: [[-0.5, 0.30], [0.05, 0.32], [0.3, 0.26], [0.5, 0.14]],
      wide: 0.94, heelR: 0.07, heelP: 2.8, toeR: 0.30, toeP: 1.35,
      sole: { heel: 0.36, fore: 0.07, spring: 0.03, welt: 0.03, arch: 0.13, color: 0x3a2616, n: 7 },
      shaft: [1.72, 0.50, 0.36], scallop: 0.14, tabs: true,
      hem: 1.38, tuck: true, flex: [-0.08, 0.14],
    },
    oxford: {
      top: [[-0.5, 0.74], [-0.3, 0.78], [-0.1, 0.80], [0.04, 0.84], [0.14, 0.74], [0.26, 0.56], [0.38, 0.40], [0.5, 0.33]],
      topW: [[-0.5, 0.24], [-0.3, 0.29], [-0.1, 0.29], [0.1, 0.26], [0.3, 0.27], [0.5, 0.20]],
      wide: 0.93, heelR: 0.08, heelP: 2.4, toeR: 0.22, toeP: 1.9,
      sole: { heel: 0.21, fore: 0.07, spring: 0.05, welt: 0.035, arch: 0.10, color: 0x17110d, n: 9 },
      laces: { z: [0.04, 0.09, 0.14], w: 0.012, color: 0x120d0a },
      hem: 0.70, flex: [-0.30, 0.60],
    },
    loafer: {
      top: [[-0.5, 0.70], [-0.3, 0.74], [-0.1, 0.78], [0.0, 0.76], [0.06, 0.68], [0.2, 0.56], [0.36, 0.40], [0.5, 0.32]],
      topW: [[-0.5, 0.24], [-0.3, 0.29], [-0.05, 0.28], [0.1, 0.27], [0.3, 0.27], [0.5, 0.20]],
      wide: 0.93, heelR: 0.08, heelP: 2.4, toeR: 0.21, toeP: 2.0,
      sole: { heel: 0.19, fore: 0.07, spring: 0.04, welt: 0.03, arch: 0.09, color: 0x1d1510, n: 9 },
      strap: 0.08, moc: true,
      hem: 0.66, flex: [-0.30, 0.60],
    },
    slipon: {
      top: [[-0.5, 0.80], [-0.3, 0.80], [-0.1, 0.80], [0.02, 0.83], [0.12, 0.72], [0.25, 0.56], [0.38, 0.46], [0.5, 0.40]],
      topW: [[-0.5, 0.26], [-0.3, 0.30], [0.0, 0.29], [0.3, 0.30], [0.5, 0.26]],
      wide: 0.98, heelR: 0.10, heelP: 2.2, toeR: 0.20, toeP: 2.0,
      sole: { heel: 0.21, fore: 0.21, spring: 0.04, welt: 0.02, arch: 0, color: 0xe7e3d8, n: 6 },
      gore: true,
      hem: 0.72, flex: [-0.35, 0.70],
    },
    sandal: { foot: 0.13, footbed: 0x5c4130, straps: "sandal", hem: 0.86, flex: [-0.35, 0.85] },
    flipflop: { foot: 0.08, footbed: 0x26272b, straps: "thong", hem: 0.84, flex: [-0.35, 0.85] },
    bare: { foot: 0, hem: 0.80, flex: [-0.35, 0.85] },
  };
  for (const k in STYLES) STYLES[k].id = k;

  // the sole's top line (unit y) along z, for a style
  function soleLine(st, z) {
    const s = st.sole;
    const heelK = 1 - sstep((z + 0.20) / 0.26);                       // 1 under the heel .. 0 by the ball
    const spring = s.spring * Math.pow(sstep((z - 0.26) / 0.24), 1.6);
    const arch = s.arch * Math.sin(Math.PI * clamp01((z + 0.20) / 0.40)) * (z > -0.2 && z < 0.2 ? 1 : 0);
    const yb = spring + arch;
    const thick = Math.max(0.05, lerp(s.fore, s.heel, heelK) - arch * 0.85);
    return { yb, yt: yb + thick };
  }
  function endG(z, z0, z1, hr, hp, tr, tp) {
    let g = 1;
    const dh = z - z0, dt = z1 - z;
    if (dh < hr) { const u = 1 - dh / hr; g = Math.min(g, Math.pow(Math.max(0, 1 - Math.pow(u, hp)), 1 / hp)); }
    if (dt < tr) { const u = 1 - dt / tr; g = Math.min(g, Math.pow(Math.max(0, 1 - Math.pow(u, tp)), 1 / tp)); }
    return g;
  }
  // z samples heel -> toe, denser at both ends
  function zSamples(z0, z1, n) {
    const out = [];
    for (let i = 0; i < n; i++) out.push(z0 + (z1 - z0) * (1 - Math.cos(Math.PI * i / (n - 1))) / 2);
    return out;
  }

  // the upper's section at z (null style fields = foot)
  function upperSec(st, z) {
    const g = endG(z, -0.5, 0.5, st.heelR, st.heelP, st.toeR, st.toeP);
    const sl = soleLine(st, z);
    const yb0 = sl.yt - 0.035, yt0 = Math.max(yb0 + 0.12, curve(st.top, z));
    const ym0 = yb0 + (yt0 - yb0) * (z > 0.25 ? 0.45 : 0.36);
    const heel = z < 0;
    const gy = heel ? Math.pow(g, 0.35) : Math.pow(g, 0.8);
    const x0 = curve(PLAN, z) * st.wide;
    return {
      z, cx: 0, nb: 5, nt: 2.4,
      x0: x0 * g, xt: Math.min(x0, curve(st.topW, z)) * g,
      ym: ym0, yt: ym0 + (yt0 - ym0) * gy, yb: ym0 - (ym0 - yb0) * Math.pow(gy, 0.25),
    };
  }
  function soleSec(st, z, g) {
    const sl = soleLine(st, z);
    const x0 = (curve(PLAN, z) * st.wide + st.sole.welt) * g;
    const ym = (sl.yb + sl.yt) / 2, gy = Math.pow(g, 0.5);
    return { z, cx: 0, nb: 7, nt: 7, x0, xt: x0 * 0.97, ym, yt: ym + (sl.yt - ym) * gy, yb: ym - (ym - sl.yb) * gy };
  }

  // ---- the bare foot (skin): heel, arch, instep, ball, five toes ----------
  const FOOT_TOP = [[-0.5, 0.46], [-0.40, 0.72], [-0.26, 0.88], [-0.10, 0.90], [0.03, 0.76], [0.16, 0.54], [0.28, 0.39], [0.40, 0.30]];
  const FOOT_TOPW = [[-0.5, 0.24], [-0.35, 0.34], [-0.05, 0.35], [0.2, 0.32], [0.4, 0.33]];
  function footSec(lift, z) {
    const g = endG(z, -0.5, 0.40, 0.16, 2.0, 0.10, 2.0);
    const yb0 = lift, yt0 = lift + curve(FOOT_TOP, z);
    const ym0 = yb0 + (yt0 - yb0) * 0.34;
    const x0 = curve(PLAN, z) * (z < 0.05 ? 0.95 : 0.90);
    const gy = z < 0 ? Math.pow(g, 0.5) : Math.pow(g, 0.9);
    return { z, cx: 0, nb: 3.2, nt: 2.2, x0: x0 * g, xt: Math.min(x0, curve(FOOT_TOPW, z)) * g,
             ym: ym0, yt: ym0 + (yt0 - ym0) * gy, yb: ym0 - (ym0 - yb0) * Math.pow(gy, 0.3) };
  }
  // side: +1 = the big toe on +x (the body's right leg, which hangs at -x)
  const TOES = [[0.20, 0.435, 0.100, 0.125, 0.115], [0.05, 0.450, 0.072, 0.100, 0.095], [-0.07, 0.435, 0.066, 0.092, 0.088],
                [-0.18, 0.410, 0.061, 0.086, 0.082], [-0.28, 0.370, 0.056, 0.080, 0.074]];
  function footKit(kit, lift, side, lod) {
    const zs = zSamples(-0.5, 0.40, lod >= 2 ? 7 : 11);
    loftZ(kit, zs.map((z) => footSec(lift, z)), lod >= 2 ? 8 : 12);
    const seg = lod >= 2 ? 4 : 5;
    for (const t of (lod >= 2 ? [TOES[0], TOES[2], TOES[4]] : TOES)) {
      const k = lod >= 2 && t !== TOES[0] ? 1.35 : 1;
      blob(kit, side * (t[0] + 0.02), lift + t[3] * 0.92, t[1], t[2] * k, t[3], t[4], seg);
    }
  }

  // ------------------------------------------------------------ builders
  function buildShoe(st, lod) {
    const far = lod >= 2;
    const M = far ? 8 : 12, N = far ? 7 : 12;
    const up = new Kit(), tr = new Kit();
    const zs = zSamples(-0.5, 0.5, N);
    const secs = zs.map((z) => upperSec(st, z));
    loftZ(up, secs, M);
    // the sole unit: welt + midsole/outsole + heel, flat underneath, toe spring
    const soleZ = zSamples(-0.515, 0.515, far ? 7 : 11);
    loftZ(tr, soleZ.map((z) => soleSec(st, z, endG(z, -0.515, 0.515, st.heelR, st.heelP, st.toeR + 0.01, st.toeP))), far ? 8 : 12);
    const cz = ANKLE_Z;
    if (st.shaft) {
      const [top, hx, hz] = st.shaft, s = st.scallop || 0;
      // the shaft rises out of the foot slim at the ankle and opens toward
      // the top, where the tucked trouser leg has to fit inside it
      const rows = [[0.55, hx * 0.80, hz * 0.84], [0.85, hx * 0.86, hz * 0.90], [Math.min(top - 0.3, st.hem + 0.02), hx * 0.97, hz * 0.98], [top - 0.12, hx * 1.01, hz], [top - 0.04, hx * 1.05, hz * 1.04], [top, hx * 1.03, hz * 1.02]];
      tubeY(up, far ? [rows[0], rows[2], rows[4]] : rows, M, cz, s ? (th) => s * Math.pow(Math.abs(Math.cos(th)), 3) : null);
      if (st.tabs && !far) {
        for (const sx of [-1, 1]) {
          const x = sx * (hx * 1.03 + 0.012);
          band(tr, [[x, top - 0.28, cz], [x, top + 0.10, cz]], [[sx, 0, 0], [sx, 0, 0]], [[0, 0, 1], [0, 0, 1]], 0.05, 0.025);
        }
      }
    }
    const pt = [0, 0, 0];
    if (st.laces && !far) {
      const L = st.laces;
      // across the instep: each rung follows the section's top curve
      for (const z of L.z) {
        const S = upperSec(st, z), Sb = upperSec(st, z + 0.02);
        const slope = (Sb.yt - S.yt) / 0.02;
        const wv = nrm([0, slope, 1]);
        const pts = [], ns = [], ws = [];
        for (const th of [Math.PI / 2 - 0.62, Math.PI / 2 - 0.22, Math.PI / 2 + 0.22, Math.PI / 2 + 0.62]) {
          secPt(S, th, pt);
          const q = secPt(S, th + 0.01, [0, 0, 0]);
          const tx = q[0] - pt[0], ty = q[1] - pt[1];
          const n = nrm([ty, -tx, 0]);
          if (n[1] < 0) { n[0] = -n[0]; n[1] = -n[1]; }
          const nn = nrm([n[0], n[1] - slope * 0.4 * n[1], -slope * 0.3]);
          pts.push([pt[0], pt[1], pt[2]]); ns.push(nn); ws.push(wv);
        }
        band(tr, pts, ns, ws, L.w, 0.03);
      }
      // up the shaft front
      if (L.y && st.shaft) {
        const [, hx, hz] = st.shaft;
        const top = st.shaft[0], y2 = Math.min(top - 0.3, st.hem + 0.02);
        for (const y of L.y) {
          const kx = y < 0.85 ? lerp(0.80, 0.86, (y - 0.55) / 0.30) : y < y2 ? lerp(0.86, 0.97, (y - 0.85) / (y2 - 0.85)) : lerp(0.97, 1.01, clamp01((y - y2) / (top - 0.12 - y2)));
          const kz = kx + 0.03 * (1 - kx) / 0.2;
          const pts = [], ns = [], ws = [];
          for (const th of [-0.55, -0.18, 0.18, 0.55]) {
            const sx = Math.sin(th), cc = Math.cos(th);
            pts.push([hx * kx * spow(sx, 0.8), y, cz + hz * kz * spow(cc, 0.8)]);
            ns.push(nrm([sx / hx, 0, cc / hz])); ws.push([0, 1, 0]);
          }
          band(tr, pts, ns, ws, L.w * 0.9, 0.028);
        }
      }
    }
    // a loafer's penny strap and moc-toe seam; a slip-on's elastic gore
    if (st.strap && !far) {
      const S = upperSec(st, st.strap), pts = [], ns = [], ws = [];
      for (let i = 0; i <= 6; i++) {
        const th = 0.15 + (Math.PI - 0.30) * i / 6;
        secPt(S, th, pt);
        pts.push([pt[0], pt[1], pt[2]]); ns.push(nrm([Math.cos(th) / Math.max(0.05, S.x0), Math.sin(th) / Math.max(0.05, S.yt - S.ym), 0])); ws.push([0, 0, 1]);
      }
      band(up, pts, ns, ws, 0.035, 0.03);
    }
    if (st.moc && !far) {
      // a U of raised seam over the toe box: down each side, round the front
      const pts = [], ns = [];
      const path = [[0.62, 0.12], [0.62, 0.24], [0.58, 0.33], [0.42, 0.40], [0.0, 0.435], [-0.42, 0.40], [-0.58, 0.33], [-0.62, 0.24], [-0.62, 0.12]];
      for (const [da, z] of path) {
        const S = upperSec(st, z), th = Math.PI / 2 - da;
        secPt(S, th, pt);
        pts.push([pt[0], pt[1], pt[2]]);
        ns.push(nrm([Math.cos(th) / Math.max(0.05, S.x0), Math.sin(th) / Math.max(0.05, S.yt - S.ym), 0.25 * Math.max(0, z - 0.3) / 0.1]));
      }
      band(up, pts, ns, null, 0.012, 0.022);
    }
    if (st.gore && !far) {
      for (const sx of [-1, 1]) {
        const S = upperSec(st, 0.02), pts = [], ns = [], ws = [];
        for (const th of [Math.PI / 2 - sx * 0.95, Math.PI / 2 - sx * 0.55]) { secPt(S, th, pt); pts.push([pt[0], pt[1], pt[2]]); ns.push(nrm([Math.cos(th), Math.sin(th) * 0.5, 0])); ws.push([0, 0, 1]); }
        band(up, pts, ns, ws, 0.03, 0.015);
      }
    }
    return {
      upper: up.geo("shoe~" + st.id + "~" + lod),
      trim: tr.I.length ? tr.geo("shoe-sole~" + st.id + "~" + lod) : null,
      trimColor: st.sole.color,
      skin: null,
    };
  }
  // open styles: the slot (painted) is the straps; the sole is trim; the foot is skin
  function buildOpen(st, lod, side) {
    const far = lod >= 2;
    const lift = st.foot;
    const foot = new Kit();
    footKit(foot, lift, side, lod);
    if (st.id === "bare") return { upper: foot.geo("foot~" + side + "~" + lod), trim: null, trimColor: 0, skin: null };
    const bed = new Kit();
    const zs = zSamples(-0.52, 0.56, far ? 7 : 11);
    loftZ(bed, zs.map((z) => {
      const g = endG(z, -0.52, 0.56, 0.16, 2.0, 0.20, 2.0);
      const x0 = (curve(PLAN, z) * 0.90 + 0.05) * g, ym = lift * 0.5;
      return { z, cx: 0, nb: 8, nt: 8, x0, xt: x0, ym, yt: ym + lift * 0.5 * Math.pow(g, 0.5), yb: ym - lift * 0.5 * Math.pow(g, 0.5) };
    }), far ? 8 : 12);
    const straps = new Kit();
    const pt = [0, 0, 0];
    const over = (z, a0, a1, n, off) => {
      const S = footSec(lift, z), pts = [], ns = [], ws = [];
      for (let i = 0; i <= n; i++) {
        const th = a0 + (a1 - a0) * i / n;
        secPt(S, th, pt);
        const q = secPt(S, th + 0.01, [0, 0, 0]);
        const nn = nrm([q[1] - pt[1], -(q[0] - pt[0]), 0]);
        if (nn[0] * Math.cos(th) + nn[1] * Math.sin(th) < 0) { nn[0] = -nn[0]; nn[1] = -nn[1]; }
        pts.push([pt[0] + nn[0] * off, pt[1] + nn[1] * off, z]); ns.push(nn); ws.push([0, 0, 1]);
      }
      return [pts, ns, ws];
    };
    const n = far ? 3 : 5;
    if (st.straps === "sandal") {
      for (const z of [0.22, 0.08]) { const b = over(z, 0.02, Math.PI - 0.02, n, 0.012); band(straps, b[0], b[1], b[2], 0.05, 0.04); }
      // the heel strap: round the back at ankle-bone height
      const pts = [], ns = [], ws = [];
      const yh = lift + 0.40;
      for (let i = 0; i <= n + 2; i++) {
        const ph = -Math.PI / 2 + Math.PI * i / (n + 2);
        const S = footSec(lift, -0.30);
        const ax = S.x0 * 0.98 + 0.03, az = 0.22;
        pts.push([ax * Math.sin(ph) * -1, yh, -0.30 - az * Math.cos(ph) * 1]);
        ns.push(nrm([-Math.sin(ph) / ax, 0, -Math.cos(ph) / az])); ws.push([0, 1, 0]);
      }
      band(straps, pts, ns, ws, 0.05, 0.035);
    } else {
      // the thong: a post between the big and second toe, a strap to each side
      const px = side * 0.13, pz = 0.37;
      const top = [px, lift + 0.20, pz - 0.02];
      band(straps, [[px, lift + 0.004, pz], [px, lift + 0.21, pz - 0.021]], [[0, 0, 1], [0, 0, 1]], [[1, 0, 0], [1, 0, 0]], 0.02, 0.03);
      for (const sx of [-1, 1]) {
        const S = footSec(lift, 0.02), pts = [[top[0] + sx * 0.006, top[1], top[2]]], ns = [[0, 1, 0]], ws = [[0, 0, 1]];
        for (let i = 1; i <= (far ? 2 : 4); i++) {
          const k = i / (far ? 2 : 4);
          const z = lerp(pz - 0.02, 0.0, k);
          const Sz = footSec(lift, z);
          const th = Math.PI / 2 - sx * lerp(0.2, 1.45, k);
          secPt(Sz, th, pt);
          const nn = nrm([Math.cos(th), Math.sin(th), 0]);
          pts.push([pt[0] + nn[0] * 0.015, pt[1] + nn[1] * 0.015, z]); ns.push(nn); ws.push(nrm([0.4 * sx, 0, 1]));
        }
        void S;
        band(straps, pts, ns, ws, 0.03, 0.035);
      }
    }
    return {
      upper: straps.geo("strap~" + st.id + "~" + side + "~" + lod),
      trim: bed.geo("footbed~" + st.id + "~" + lod),
      trimColor: st.footbed,
      skin: foot.geo("foot~" + side + "~" + lod + "~" + lift),
    };
  }
  const GEO = Object.create(null);
  function geometry(style, lod, side) {
    const st = STYLES[style] || STYLES.sneaker;
    lod = lod >= 2 ? 2 : 1;
    side = st.foot != null ? (side < 0 ? -1 : 1) : 0;
    const key = st.id + "|" + lod + "|" + side;
    return GEO[key] || (GEO[key] = st.foot != null ? buildOpen(st, lod, side) : buildShoe(st, lod));
  }

  // ------------------------------------------------------------ materials
  function trimMat(hex) { return CBZ.cmat ? CBZ.cmat(hex) : new THREE.MeshLambertMaterial({ color: hex }); }

  // ------------------------------------------------------------ fitting
  /* Put `style` on a leg character.js built (leg.userData.foot is the ankle
     pivot group, foot.userData.dims its size). Reuses the slot mesh if there
     is one, so skinSlots.shoes / leg.userData.cap keep their identity. */
  function fit(leg, style, color, skin, side) {
    const foot = leg && leg.userData && leg.userData.foot;
    if (!foot) return null;
    const st = STYLES[style] || STYLES.sneaker;
    const d = foot.userData.dims;
    const lod = foot.userData.lod || 1;
    const G = geometry(st.id, lod, side);
    let m = leg.userData.cap && leg.userData.cap.name === "shoe" ? leg.userData.cap : null;
    if (!m) {
      m = new THREE.Mesh(G.upper, CBZ.cmat ? CBZ.cmat(color) : new THREE.MeshLambertMaterial({ color }));
      m.name = "shoe";
      m.castShadow = true; m.receiveShadow = true;
      foot.add(m);
      leg.userData.cap = m;
    } else m.geometry = G.upper;
    m.scale.set(d.W, d.H, d.D);
    m.position.set(0, -ANKLE_Y * d.H, -ANKLE_Z * d.D);
    m.userData.shoeStyle = st.id;
    m.userData.shoeSide = side;
    // children: the sole unit (its own colour) and a sandal's bare foot (skin)
    let tr = m.userData.trim, sk = m.userData.skinFoot;
    if (G.trim) {
      if (!tr) { tr = new THREE.Mesh(G.trim, trimMat(G.trimColor)); tr.name = "shoe_sole"; tr.castShadow = true; tr.receiveShadow = true; m.add(tr); m.userData.trim = tr; }
      tr.geometry = G.trim; tr.material = trimMat(G.trimColor); tr.visible = true;
    } else if (tr) tr.visible = false;
    if (G.skin) {
      if (!sk) { sk = new THREE.Mesh(G.skin, trimMat(skin)); sk.name = "shoe_foot"; sk.castShadow = true; sk.receiveShadow = true; m.add(sk); m.userData.skinFoot = sk; }
      sk.geometry = G.skin; sk.material = trimMat(skin); sk.visible = true;
    } else if (sk) sk.visible = false;
    foot.userData.flex = st.flex.slice();
    foot.userData.style = st.id;
    // THE LEG ENDS INSIDE THE SHOE: bare skin at the ankle pivot, a trouser
    // leg at this style's hem (over a low shoe's collar, inside a boot)
    if (CBZ.humanSetShinEnd) {
      const lower = leg.userData.lower, spec = lower && lower.userData.limb;
      if (spec) {
        const endY = spec.variant === "bare" ? ANKLE_Y : st.hem;          // unit y above the sole
        CBZ.humanSetShinEnd(leg, -(d.sole + endY * d.H));
      }
    }
    return m;
  }

  /* WHO WEARS WHAT. `rec` = an outfit record (city/outfits.js CAT, the prison
     fits, a warlord kit) when the wardrobe dressed them; else the build
     colours. Deterministic per body (the rig's own phase seeds the roll). */
  function hash01(n, salt) {
    let h = ((n | 0) ^ Math.imul(salt + 1, 0x9e3779b1)) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  const BY_ID = {
    inmate: "slipon", inmate_cap: "slipon", inmate_tank: "slipon", inmate_orderly: "slipon", inmate_chapel: "slipon",
    corrections: "combat", warden: "oxford", swat: "combat", soldier: "combat", tactical: "combat", ski_patrol: "combat",
    firefighter: "combat", hunter: "work", ranger: "work", sheriff: "cowboy",
    construction: "work", hivis: "work", farmer: "cowboy", coveralls: "work", groundcrew: "work", pitcrew: "sneaker",
    fisherman: "work", janitor: "work", hiker: "work", marshal: "work", security: "combat", police: "combat",
    suit: "oxford", detail: "oxford", tuxedo: "oxford", office: "oxford", pilot: "oxford", waiter: "oxford",
    bartender: "oxford", driver: "oxford", cabincrew: "loafer", doctor: "loafer", mariner: "loafer", valet: "oxford",
    mailman: "sneaker", busdriver: "oxford", chef: "slipon", housekeeping: "slipon", scrubs: "sneaker", ems: "combat",
    lifeguard: "flipflop", athletic: "sneaker", racer: "sneaker", ski: "work", vendor: "sneaker",
    dress: "loafer", sundress: "sandal", blouse: "loafer", designer: "sneaker", leather: "combat",
    street: "sneaker", hoodie: "sneaker", tracksuit: "sneaker", wifebeater: "sneaker", puffer: "sneaker",
    denim_jacket: "work", varsity: "sneaker",
    onesie: "sneaker", pyjamas: "sneaker", romper: "sneaker", kidtee: "sneaker", kidhoodie: "sneaker",
    school: "oxford", schoolgirl: "loafer", pinafore: "loafer",
  };
  function styleFor(c, rec, rig) {
    c = c || {};
    const skin = rig && rig._fw ? rig._fw.skin : c.skin;
    if (c.shoes != null && skin != null && c.shoes === skin) return "bare";
    if (c.footwear && STYLES[c.footwear]) return c.footwear;
    // same person, same shoes: seeded by what they are wearing, not by chance
    const seed = ((c.shoes | 0) * 31 + (c.legs | 0) * 7 + (c.torso | 0) + (c.skin | 0) * 3) | 0;
    const R = (s) => hash01(seed, s);
    if (rec) {
      if (rec.footwear && STYLES[rec.footwear]) return rec.footwear;
      const id = String(rec.id || "");
      if (/^gang:/.test(id)) return R(3) < 0.8 ? "sneaker" : "work";
      if (/^biz:/.test(id)) return R(3) < 0.75 ? "oxford" : "loafer";
      if (BY_ID[id]) {
        const s = BY_ID[id];
        if (s === "oxford" && rec.tier === "money" && R(4) < 0.35) return "loafer";
        if (s === "combat" && id === "police" && R(4) < 0.35) return "oxford";
        return s;
      }
      if (rec.camo || rec.kit || rec.belt) return "combat";
      if (rec.formal) return "oxford";
      if (rec.tier === "institution") return "slipon";
      if (rec.tier === "law") return "combat";
      if (rec.tier === "money" || rec.tier === "apex") return R(4) < 0.6 ? "oxford" : "loafer";
      if (rec.tier === "work") return R(4) < 0.6 ? "work" : "sneaker";
      if (rec.tier === "kid") return "sneaker";
      if (rec.tier === "fit") return R(4) < 0.5 ? "sneaker" : R(6) < 0.5 ? "loafer" : "oxford";
      return R(4) < 0.7 ? "sneaker" : "work";          // street, gang, a kit nobody named
    }
    if (c.stripes) return "slipon";
    if (c.badge) return "combat";
    if (c.gloss) return "oxford";
    if (rig && (rig.child || (rig.ageYears != null && rig.ageYears < 14))) return "sneaker";
    const r = R(5);
    return r < 0.55 ? "sneaker" : r < 0.75 ? "work" : r < 0.9 ? "oxford" : "loafer";
  }

  function sideOf(leg) { return leg && leg.position && leg.position.x < 0 ? 1 : -1; }   // the big toe points to the body's midline
  // build-time: character.js calls this per rig
  function dress(rig, c) {
    if (!rig || !rig.parts) return;
    const skin = c.skin != null ? c.skin : 0xcf9a72;
    rig._fw = { skin, style: null, lod: 1 };
    if (c.shoes == null) return;
    const style = styleFor(c, null, rig);
    rig._fw.style = style;
    for (const leg of [rig.parts.ll, rig.parts.rl]) fit(leg, style, c.shoes, skin, sideOf(leg));
    rig.skinSlots.shoes = [rig.parts.ll.userData.cap, rig.parts.rl.userData.cap].filter(Boolean);
  }
  // the wardrobe dressed this body: the right shoe for the job
  function restyle(rig, rec, colors) {
    if (!rig || !rig.parts || !rig._fw) return false;
    const c = colors || (rec && rec.colors) || {};
    const style = styleFor(c, rec, rig);
    if (style === rig._fw.style) return false;
    rig._fw.style = style;
    for (const leg of [rig.parts.ll, rig.parts.rl]) {
      const cap = leg.userData.cap;
      fit(leg, style, c.shoes != null ? c.shoes : 0x2b2b2b, rig._fw.skin, sideOf(leg));
      void cap;
    }
    return true;
  }
  function setLod(rig, lod) {
    if (!rig || !rig._fw || !rig._fw.style) return;
    lod = lod >= 2 ? 2 : 1;
    if (rig._fw.lod === lod) return;
    rig._fw.lod = lod;
    for (const leg of [rig.parts.ll, rig.parts.rl]) {
      const foot = leg.userData.foot, m = leg.userData.cap;
      if (!foot || !m) continue;
      foot.userData.lod = lod;
      const G = geometry(rig._fw.style, lod, sideOf(leg));
      m.geometry = G.upper;
      if (m.userData.trim && G.trim) m.userData.trim.geometry = G.trim;
      if (m.userData.skinFoot && G.skin) m.userData.skinFoot.geometry = G.skin;
    }
  }

  CBZ.footwear = {
    version: 1,
    STYLES, ANKLE_Y, ANKLE_Z,
    geometry, fit, dress, restyle, styleFor, lod: setLod,
    styles: function () { return Object.keys(STYLES); },
  };
})();
