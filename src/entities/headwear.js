/* ============================================================
   entities/headwear.js — EVERY HAT AND HELMET, ON EVERY HEAD, IN EVERY GAME.

   Owner (2026-09-28): "hats and helmets need to be worked on ... like a
   little kid drew everything that was there and you're redrawing stuff."

   WHAT IT WAS: five separate systems, all boxes. character.js's c.cap was a
   0.66 cube lid plus a 0.66 x 0.10 x 0.30 plank (every cop, guard, soldier,
   pilot, construction worker and ranger wore the SAME box, only the colour
   changed, and the hair under it was deleted so a policewoman went bald);
   c.hat (beach) was a box crown with a flat box brim; city/armor.js's SWAT
   helmet was a 0.70 x 0.46 x 0.70 box with box "rails"; warlord/outfits.js
   drew its rag / shemagh / cap / beret / helmet as boxes; clothes.js and
   bling.js each drew a gang rag as a box ring; player.js had its own box cap.

   WHAT IT IS: ONE library of real headwear, FITTED to the real head.
   character.js's head is a rounded box skull (per form m / f / c) with a
   forehead that leans back, a jaw that tapers, ears and a neck, authored at
   the adult 0.60 skull and scaled by headSize/0.60. This file carries the
   same surface as a signed distance field (skullSdf + ears + neck) and every
   hat is BUILT ONTO IT: a crown is the scalp surface offset outward along
   its own normal (a ball cap is 4 mm of hair allowance plus cloth, a
   ballistic helmet stands off on its pads), a band follows a real band line
   (above the brows at the front, over the ears at the side, on the occiput
   at the back), brims and peaks are thick slabs with rolled edges hung off
   that band, chinstraps are ribbons projected onto the jaw. So a hat sits
   ON the skull at the right height, by construction, on every form and size.

   HAIR UNDER A HAT is compressed, not deleted: compressHair() pulls every
   hair vertex the hat covers in to just outside the scalp (smoothly, over a
   blend under the band) so nothing pokes through a crown, and whatever
   hangs below the band (a ponytail through a cap's strap opening, long hair
   under a helmet) still falls out from under it.

   COST: every geometry is shared and cached per (kind, form, variant, lod);
   materials are the shared cmat/pbrMat caches; a hat is 2-5 meshes, all
   poolable by entities/pedinstance.js (no vertex colours, no transparency —
   except the see-through glass: the riot shield's clear visor and the moto /
   race tinted visors, which stay real meshes by design).
   A far LOD (fewer segments, no small furniture) swaps in with the body's.

   API (CBZ.headwear):
     wear(rig, kind|null, {owner, color, accent, variant, backward})
         put a hat on (or take the owner's off). Owners stack by priority —
         armor > warlord > outfit/player role > shop (a hat the player bought
         and wears, city/bling.js) > bandana — and only the top one shows, so
         a SWAT helmet over a patrol cap never double-draws. Returns the group.
     setHidden(rig, why, on)  hide all headwear for a reason (swimming).
     setLod(rig, lod)         the body's LOD (1 near, 2 far) — swaps hat + hair.
     build(kind, opts)        a standalone hat Group for props / vehicles
                              (adult 0.60 head frame, same geometry).
     kindFor(text)            a role/job string -> the kind that role wears.
     kinds                    every kind this file draws.
   ============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ, THREE = window.THREE;
  if (!CBZ || !THREE) return;

  const PI = Math.PI, TAU = PI * 2;
  const cl01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
  const sm01 = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
  const lerp = (a, b, t) => a + (b - a) * t;
  const wrapA = (a) => { a = (a + PI) % TAU; if (a < 0) a += TAU; return a - PI; };

  /* ---- THE HEAD WE FIT -------------------------------------------------
     Neck frame at k = 1 (the adult 0.60 skull): the skull spans y 0..0.60,
     centred on x = z = 0, face toward +z. character.js exports its live
     HEAD_FORMS + jawMul through CBZ.human; this fallback is a copy for pages
     that load this file first. HC is the skull centre every ray starts at. */
  const FORMS_FALLBACK = {
    m: { jaw: 0.60, brow: 0.026, round: 0.150, neck: [0.140, 0.158], nose: 1.00, ear: 1.00, chin: 0.012 },
    f: { jaw: 0.52, brow: 0.014, round: 0.165, neck: [0.118, 0.132], nose: 0.84, ear: 0.90, chin: 0.004 },
    c: { jaw: 0.72, brow: 0.004, round: 0.195, neck: [0.132, 0.142], nose: 0.70, ear: 0.95, chin: 0.000 },
  };
  function formOf(form) {
    const T = (CBZ.human && CBZ.human.headForms) || FORMS_FALLBACK;
    return T[form] || T.m || FORMS_FALLBACK.m;
  }
  function jawMul(F, u, z) {
    const front = cl01((z + 0.05) / 0.30);
    const jw = lerp(1 - (1 - F.jaw) * 0.55, F.jaw, front);
    return lerp(jw, 1, sm01(u / 0.32));
  }
  const HC = [0, 0.30, 0];
  const HA = 0.005;          // compressed hair under a hat (3.5 mm at HUMAN_SCALE)
  const CLOTH = 0.0045;      // soft cloth thickness
  const O_SOFT = HA + CLOTH; // a soft crown's outer surface off the scalp
  // where the compressed hair is allowed to reach under a hat: well inside the
  // crown's inner face, so tessellation and oblique rays never let it through
  const HA_HAIR = 0.0025;
  // hair stays this far inside a hat's real inner surface (2.5 mm at HUMAN_SCALE)
  const HAIR_M = 0.0035;

  function boxSdf(qx, qy, qz, bx, by, bz, r) {
    const dx = Math.abs(qx) - bx, dy = Math.abs(qy) - by, dz = Math.abs(qz) - bz;
    const ox = Math.max(dx, 0), oy = Math.max(dy, 0), oz = Math.max(dz, 0);
    return Math.sqrt(ox * ox + oy * oy + oz * oz) + Math.min(Math.max(dx, dy, dz), 0) - r;
  }
  // character.js headGeometry's sculpt, inverted point-wise (base lift, jaw
  // taper, chin, forehead lean), then the rounded-box skull it started from.
  function skullSdf(F, x, y, z) {
    let u = y;
    const back = cl01(-z / 0.30), B = back * back;
    if (u < 0.24 && B > 0) u = (u - 0.12 * B) / (1 - 0.5 * B);
    const xx = x / jawMul(F, u, z);
    let zz = z;
    if (zz > 0.1 && u < 0.12) zz -= F.chin * (1 - u / 0.12);
    if (zz > 0) zz += F.brow * sm01((u - 0.40) / 0.20) * cl01(zz / 0.30);
    const b = 0.30 - F.round;
    return boxSdf(xx, u - 0.30, zz, b, b, b, F.round);
  }
  // the ears: character.js earGeometry / EAR_SPEC — an ear plane (a up, b to
  // the face, w out) at x0 0.290, centre y 0.305 z -0.035, tilted back 0.20
  // rad and swung out 0.35 rad about its front edge (b = 0.040*ear). Undo
  // both turns, then a rounded slab round the ear's relief (w 0..0.035*ear)
  function earSdf(F, x, y, z) {
    const s = F.ear || 1, ca = 0.9394, sa = 0.3429, cb = 0.9801, sb = 0.1987;
    const w2 = Math.abs(x) - 0.290, db2 = z + 0.035 - 0.040 * s;
    const db = db2 * ca - w2 * sa, w = db2 * sa + w2 * ca;
    const b1 = db + 0.040 * s, a1 = y - 0.305;
    const b = b1 * cb + a1 * sb, a = a1 * cb - b1 * sb;
    const r = 0.012;
    return boxSdf(w - 0.0175 * s, a, b, 0.0192 * s - r, 0.076 * s - r, 0.0540 * s - r, r);
  }
  function neckSdf(F, x, y, z) {
    const r = lerp(F.neck[1], F.neck[0], cl01((y + 0.14) / 0.30));
    const zz = (z + 0.025) / 0.95;
    return Math.max(Math.sqrt(x * x + zz * zz) - r, y - 0.16, -0.16 - y);
  }
  // the nose, as a bounding wedge, for the things that pass in front of it
  function noseSdf(F, x, y, z) {
    return boxSdf(x, y - 0.29, z - 0.335, 0.05 * F.nose + 0.01, 0.085, 0.05, 0.02);
  }
  function smin(a, b, k) { const h = cl01(0.5 + 0.5 * (b - a) / k); return lerp(b, a, h) - k * h * (1 - h); }

  /* A head context: the sdf this hat fits against, ray casts from HC, the
     surface normal, band elevations, horizontal cross-section radii. */
  function Head(form, o) {
    o = o || {};
    const F = formOf(form);
    const ears = !!o.ears, neck = !!o.neck, nose = !!o.nose;
    function sdf(x, y, z) {
      let d = skullSdf(F, x, y, z);
      if (ears) d = smin(d, earSdf(F, x, y, z), 0.03);
      if (neck) d = Math.min(d, neckSdf(F, x, y, z));
      if (nose) d = smin(d, noseSdf(F, x, y, z), 0.02);
      return d;
    }
    function normal(p) {
      const e = 0.0015;
      const nx = sdf(p[0] + e, p[1], p[2]) - sdf(p[0] - e, p[1], p[2]);
      const ny = sdf(p[0], p[1] + e, p[2]) - sdf(p[0], p[1] - e, p[2]);
      const nz = sdf(p[0], p[1], p[2] + e) - sdf(p[0], p[1], p[2] - e);
      const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      return [nx / l, ny / l, nz / l];
    }
    // distance from `o3` along unit `d` to the surface (o3 inside)
    function cast(o3, d, maxT) {
      let lo = 0, hi = maxT || 0.9;
      for (let i = 0; i < 30; i++) {
        const m = (lo + hi) * 0.5;
        if (sdf(o3[0] + d[0] * m, o3[1] + d[1] * m, o3[2] + d[2] * m) < 0) lo = m; else hi = m;
      }
      return hi;
    }
    function dirAE(a, e) { const ce = Math.cos(e); return [Math.sin(a) * ce, Math.sin(e), Math.cos(a) * ce]; }
    function hitAE(a, e) {
      const d = dirAE(a, e), t = cast(HC, d);
      return [HC[0] + d[0] * t, HC[1] + d[1] * t, HC[2] + d[2] * t];
    }
    function hitDir(d) { return cast(HC, d); }
    // elevation (from HC) of the surface point at azimuth a whose height is y
    function bandE(a, y) {
      let lo = -1.45, hi = 1.5;
      for (let i = 0; i < 26; i++) {
        const m = (lo + hi) * 0.5;
        if (hitAE(a, m)[1] < y) lo = m; else hi = m;
      }
      return (lo + hi) * 0.5;
    }
    // horizontal cross-section: distance from the vertical axis at height y
    function ring(a, y) {
      const d = [Math.sin(a), 0, Math.cos(a)];
      if (sdf(0, y, 0) >= 0) return 0;
      return cast([0, y, 0], d, 0.8);
    }
    // project an aim point onto the surface (ray from HC through it), + off
    function project(aim, off) {
      let d = [aim[0] - HC[0], aim[1] - HC[1], aim[2] - HC[2]];
      const l = Math.sqrt(d[0] * d[0] + d[1] * d[1] + d[2] * d[2]) || 1;
      d = [d[0] / l, d[1] / l, d[2] / l];
      const t = cast(HC, d), p = [HC[0] + d[0] * t, HC[1] + d[1] * t, HC[2] + d[2] * t];
      const n = normal(p);
      return { p: [p[0] + n[0] * off, p[1] + n[1] * off, p[2] + n[2] * off], n: n };
    }
    return { F, form, sdf, normal, cast, dirAE, hitAE, hitDir, bandE, ring, project };
  }

  /* A band line: keys [[a, y], ...] for a in [0, PI] (front to back),
     mirrored left/right, Catmull-Rom through the keys. */
  function band(keys) {
    return function (a) {
      const x = Math.abs(wrapA(a));
      let i = 1;
      while (i < keys.length - 1 && x > keys[i][0]) i++;
      const k1 = keys[i - 1], k2 = keys[i];
      const k0 = keys[i - 2] || [-k2[0], k2[1]], k3 = keys[i + 1] || [2 * k2[0] - k1[0], k1[1]];
      const t = cl01((x - k1[0]) / ((k2[0] - k1[0]) || 1));
      const m1 = (k2[1] - k0[1]) / ((k2[0] - k0[0]) || 1) * (k2[0] - k1[0]);
      const m2 = (k3[1] - k1[1]) / ((k3[0] - k1[0]) || 1) * (k2[0] - k1[0]);
      const t2 = t * t, t3 = t2 * t;
      return (2 * t3 - 3 * t2 + 1) * k1[1] + (t3 - 2 * t2 + t) * m1 + (-2 * t3 + 3 * t2) * k2[1] + (t3 - t2) * m2;
    };
  }

  /* ---- MESH ASSEMBLY ---------------------------------------------------
     A Part accumulates one material role's triangles. Grids are emitted with
     their OWN vertices, so each grid is smooth inside and creased where it
     meets the next (a brim's edge, a band's seam). */
  const V = {
    add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
    sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
    mul: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
    dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
    cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
    len: (a) => Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]),
    norm: (a) => { const l = Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
    lerp: (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
  };
  function Part() { return { p: [], uv: [], ix: [] }; }
  function parts() {
    const P = {};
    const fn = function (role) { return P[role] || (P[role] = Part()); };
    fn.map = P;
    return fn;
  }

  /* ---- THE REAL HEAD, AS A SPHERICAL DEPTH MAP -------------------------
     Owner 2026-09-28: "the helmet overlaps with the head weirdly". The hats
     were fitted to skullSdf, an analytic copy of the head sculpt, and only
     their VERTICES were kept off it. Three things got through that:
       - the triangles BETWEEN those vertices: a far-LOD crown (20-24 columns,
         4-5 rows) chords up to 12 mm into the skull between its vertices;
       - the face: the brows stand proud of the forehead (and rise 13 mm in a
         fear face) right under every peak and bill, and they are not in
         skullSdf at all;
       - the hair: compressHair squeezed it under a BAND LINE, so anything the
         hat covers below that line (a bill's drooping sides over the temple
         hair, a reversed bill over long hair, a riot helmet's neck curtain
         over a ponytail) went straight through.
     The fix measures instead of guessing. From the skull centre HC, a grid of
     directions (azimuth x elevation) stores:
       BODY map  the FARTHEST point of the real head along each direction: the
                 near AND far head meshes (every nose), both ears, the neck,
                 the brows at rest and fully raised, the lips — whatever
                 character.js builds today, read through CBZ.human.geometry.
       SHELL map the NEAREST hat surface along each direction (per hat).
     Every hat is pushed out until each of its triangles (sampled inside, not
     just at the corners) clears the BODY map, and every hair vertex is pulled
     in until it is under the SHELL map. One measurement, both directions. */
  const SA = 256, SE = 128;                  // 1.4 degrees a cell
  const SDIR = new Float32Array(SA * SE * 3);
  for (let j = 0; j < SE; j++) for (let i = 0; i < SA; i++) {
    const a = (i + 0.5) / SA * TAU - PI, e = (j + 0.5) / SE * PI - PI / 2, ce = Math.cos(e), k = (j * SA + i) * 3;
    SDIR[k] = Math.sin(a) * ce; SDIR[k + 1] = Math.sin(e); SDIR[k + 2] = Math.cos(a) * ce;
  }
  // ray from HC along cell direction (dx,dy,dz) against triangle abc: t or -1
  function rayTri(dx, dy, dz, a, b, c) {
    const e1x = b[0] - a[0], e1y = b[1] - a[1], e1z = b[2] - a[2];
    const e2x = c[0] - a[0], e2y = c[1] - a[1], e2z = c[2] - a[2];
    const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (det > -1e-12 && det < 1e-12) return -1;
    const inv = 1 / det;
    const tx = HC[0] - a[0], ty = HC[1] - a[1], tz = HC[2] - a[2];
    const u = (tx * px + ty * py + tz * pz) * inv;
    if (u < -1e-6 || u > 1 + 1e-6) return -1;
    const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
    const v = (dx * qx + dy * qy + dz * qz) * inv;
    if (v < -1e-6 || u + v > 1 + 1e-6) return -1;
    const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
    return t > 1e-6 ? t : -1;
  }
  function cellOf(x, y, z) {
    const dx = x - HC[0], dy = y - HC[1], dz = z - HC[2], r = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-9;
    const a = Math.atan2(dx, dz), e = Math.asin(Math.max(-1, Math.min(1, dy / r)));
    return [(a + PI) / TAU * SA, (e + PI / 2) / PI * SE, r];
  }
  /* Rasterize triangles (flat xyz array + index) into map M: max (body) or
     min (shell) hit distance per cell. Vertices are splatted too, so a sliver
     thinner than a cell still counts. */
  function sphRaster(M, pos, ix, isMax, ox, oy, oz) {
    ox = ox || 0; oy = oy || 0; oz = oz || 0;
    const put = (k, t) => { if (isMax ? t > M[k] : t < M[k]) M[k] = t; };
    const n = ix ? ix.length : pos.length / 3;
    const A = [0, 0, 0], B = [0, 0, 0], C = [0, 0, 0], T3 = [A, B, C];
    for (let f = 0; f < n; f += 3) {
      const cs = [];
      for (let q = 0; q < 3; q++) {
        const vi = ix ? ix[f + q] : f + q, P3 = T3[q];
        P3[0] = pos[vi * 3] + ox; P3[1] = pos[vi * 3 + 1] + oy; P3[2] = pos[vi * 3 + 2] + oz;
        const c = cellOf(P3[0], P3[1], P3[2]);
        cs.push(c);
        const ia = Math.min(SA - 1, c[0] | 0), ie = Math.min(SE - 1, Math.max(0, c[1] | 0));
        put(ie * SA + ia, c[2]);
      }
      if (!isMax) {
        // a SHELL seen edge-on from HC (a helmet's under-lip at eye height is a
        // sliver thinner than a cell): splat points along its edges too, so a
        // ray that crosses it still finds it
        for (let q = 0; q < 3; q++) {
          const P0 = T3[q], P1 = T3[(q + 1) % 3];
          const len = Math.hypot(P1[0] - P0[0], P1[1] - P0[1], P1[2] - P0[2]), ns = Math.min(16, Math.ceil(len / 0.007));
          for (let s = 1; s < ns; s++) {
            const t = s / ns, c = cellOf(P0[0] + (P1[0] - P0[0]) * t, P0[1] + (P1[1] - P0[1]) * t, P0[2] + (P1[2] - P0[2]) * t);
            put(Math.min(SE - 1, Math.max(0, c[1] | 0)) * SA + Math.min(SA - 1, c[0] | 0), c[2]);
          }
        }
      }
      let a0 = Math.min(cs[0][0], cs[1][0], cs[2][0]), a1 = Math.max(cs[0][0], cs[1][0], cs[2][0]);
      if (a1 - a0 > SA / 2) {                        // straddles the back seam
        const u = cs.map((c) => (c[0] < SA / 2 ? c[0] + SA : c[0]));
        a0 = Math.min(u[0], u[1], u[2]); a1 = Math.max(u[0], u[1], u[2]);
      }
      let e0 = Math.min(cs[0][1], cs[1][1], cs[2][1]), e1 = Math.max(cs[0][1], cs[1][1], cs[2][1]);
      if (a1 - a0 > SA / 2) {                        // it goes round a pole
        a0 = 0; a1 = SA - 1;
        if (e0 + e1 > SE) e1 = SE - 1; else e0 = 0;
      }
      const i0 = Math.floor(a0) - 1, i1 = Math.floor(a1) + 1;
      const j0 = Math.max(0, Math.floor(e0) - 1), j1 = Math.min(SE - 1, Math.floor(e1) + 1);
      for (let j = j0; j <= j1; j++) for (let ii = i0; ii <= i1; ii++) {
        const i = ((ii % SA) + SA) % SA, k = j * SA + i, d = k * 3;
        const t = rayTri(SDIR[d], SDIR[d + 1], SDIR[d + 2], A, B, C);
        if (t > 0) put(k, t);
      }
    }
  }
  // the map at a direction: the worst of the 2 x 2 cells round it
  function sphGet(M, x, y, z, isMax) {
    const dx = x - HC[0], dy = y - HC[1], dz = z - HC[2], r = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-9;
    const q = dy / r;
    const u = (Math.atan2(dx, dz) + PI) * (SA / TAU) - 0.5, v = (Math.asin(q < -1 ? -1 : q > 1 ? 1 : q) + PI / 2) * (SE / PI) - 0.5;
    const i0 = Math.floor(u), j0 = Math.floor(v);
    let best = isMax ? 0 : Infinity;
    for (let dj = 0; dj < 2; dj++) {
      const j = Math.max(0, Math.min(SE - 1, j0 + dj));
      for (let di = 0; di < 2; di++) {
        const i = (((i0 + di) % SA) + SA) % SA, t = M[j * SA + i];
        if (isMax ? t > best : t < best) best = t;
      }
    }
    return best;
  }
  // the one cell a direction falls in (no neighbours: at a silhouette — the
  // top edge of a brow seen from HC — the 2 x 2 worst case would read the
  // brow's FRONT and throw a brim centimetres off it)
  function sphCell(M, x, y, z) {
    const dx = x - HC[0], dy = y - HC[1], dz = z - HC[2], r = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-9;
    const q = dy / r;
    const i = Math.min(SA - 1, ((Math.atan2(dx, dz) + PI) * (SA / TAU)) | 0);
    const j = Math.max(0, Math.min(SE - 1, ((Math.asin(q < -1 ? -1 : q > 1 ? 1 : q) + PI / 2) * (SE / PI)) | 0));
    return M[j * SA + i];
  }
  function geoArrays(g) {
    const p = g.attributes.position.array;
    return { pos: p, ix: g.index ? g.index.array : null };
  }
  const BODY = Object.create(null);
  /* The BODY map for a head form. Built from character.js's own geometry
     (CBZ.human.geometry) laid out exactly as makeCharacter lays it out in the
     neck frame (head at +0.30, brow at y 0.448 z 0.303 hanging below its
     origin, lips at y 0.16), falling back to the analytic head when the body
     file is not loaded (a props-only page). */
  const BROW_Y = 0.448, BROW_Z = 0.303, BROW_RAISE = 0.013, LIP_Y = 0.16;
  // BODY_PTS: the same body as points (xyz, hat frame) for the exact pass below
  const BODY_PTS = new WeakMap(), BODY_RAW = new WeakMap();
  function bodyMap(form, beardGeo) {
    const bkey = form + (beardGeo ? "|" + beardGeo.uuid : "");
    if (BODY[bkey]) return BODY[bkey];
    const pts = [];
    const ras = (M, pos, ix, ox, oy, oz) => {
      sphRaster(M, pos, ix, true, ox, oy, oz);
      for (let i = 0; i < pos.length; i += 3) pts.push(pos[i] + (ox || 0), pos[i + 1] + (oy || 0), pos[i + 2] + (oz || 0));
    };
    if (beardGeo) {
      // the wearer's beard on top of the bare head: a chin cup rides ON it
      const base = bodyMap(form), M = Float32Array.from(base), a = geoArrays(beardGeo);
      const bp = BODY_RAW.get(base);
      if (bp) for (let i = 0; i < bp.length; i++) pts.push(bp[i]);
      ras(M, a.pos, a.ix);
      BODY_RAW.set(M, pts); BODY_PTS.set(M, outerPts(M, pts));
      return (BODY[bkey] = M);
    }
    const M = new Float32Array(SA * SE);
    const G = CBZ.human && CBZ.human.geometry;
    if (G && G.head) {
      for (const far of [false, true]) for (let n = 0; n < 3; n++) {
        const a = geoArrays(G.head(form, n, far));
        ras(M, a.pos, a.ix, 0, 0.30, 0);
      }
      if (G.brow) for (const ex of ["n", "a", "f"]) for (const dy of [0, BROW_RAISE]) {
        try { const a = geoArrays(G.brow(form, ex)); ras(M, a.pos, a.ix, 0, BROW_Y + dy, BROW_Z); } catch (e) { /* older body file */ }
      }
      if (G.lip) for (const w of ["U", "L"]) {
        try {
          const g = G.lip(w, "n"), p = g.attributes.position.array, q = new Float32Array(p.length);
          // the fullest lips any face wears (f form x heritage 'lips')
          for (let i = 0; i < p.length; i += 3) { q[i] = p[i]; q[i + 1] = p[i + 1] * 1.4; q[i + 2] = p[i + 2]; }
          ras(M, q, g.index ? g.index.array : null, 0, LIP_Y, 0);
        } catch (e) { /* older body file */ }
      }
    }
    else {
      // no body file on this page (props only): the analytic head the hats were built on
      const H = Head(form, { ears: true, neck: true, nose: true });
      for (let k = 0; k < SA * SE; k++) M[k] = H.cast(HC, [SDIR[k * 3], SDIR[k * 3 + 1], SDIR[k * 3 + 2]], 0.9);
    }
    BODY_RAW.set(M, pts); BODY_PTS.set(M, outerPts(M, pts));
    return (BODY[bkey] = M);
  }
  /* THE EXACT PASS, after the map passes: every real body VERTEX (an ear's
     corner, a brow's tip, the nose) against the hat's actual triangles, binned
     by direction. Any triangle that crosses the ray from HC to a body vertex
     short of it (+ margin) is pushed out by the difference. The map passes do
     the bulk; this catches what falls between their cells. */
  const XA = 128, XE = 64;                   // the exact pass's direction bins
  /* The body points worth testing: only the OUTERMOST along their direction
     (a far-LOD skull vertex inside the near skull, an eye socket's floor can
     never touch a hat), deduplicated, with their direction and bin. */
  function outerPts(M, pts) {
    const seen = new Set(), out = [];
    for (let i = 0; i < pts.length; i += 3) {
      const x = pts[i], y = pts[i + 1], z = pts[i + 2];
      const kk = Math.round(x * 5e3) + "," + Math.round(y * 5e3) + "," + Math.round(z * 5e3);
      if (seen.has(kk)) continue;
      seen.add(kk);
      const c = cellOf(x, y, z), r = c[2];
      if (r < sphCell(M, x, y, z) - 0.006) continue;
      const k = Math.min(XE - 1, Math.max(0, (c[1] / SE * XE) | 0)) * XA + Math.min(XA - 1, (c[0] / SA * XA) | 0);
      out.push((x - HC[0]) / r, (y - HC[1]) / r, (z - HC[2]) / r, r, k);
    }
    return Float32Array.from(out);
  }
  function exactPass(P, form, margin, beardGeo) {
    const M = bodyMap(form, beardGeo), pts = BODY_PTS.get(M), C0 = coarseOf(M);
    if (!pts || !pts.length) return;
    const roles = Object.keys(P.map);
    const key = (x, y, z) => (Math.round(x * 2e4) + 50000) * 1e10 + (Math.round(y * 2e4) + 50000) * 1e5 + (Math.round(z * 2e4) + 50000);
    const BA = XA, BE = XE;
    for (let pass = 0; pass < 3; pass++) {
      // bin every hat triangle that could reach the head by the directions it spans
      const bins = new Map(), tris = [];
      for (const role of roles) {
        const part = P.map[role], p = part.p, ix = part.ix, nv = p.length / 3;
        const U = new Float32Array(nv), W = new Float32Array(nv), R = new Float32Array(nv), CB = new Float32Array(nv);
        for (let v = 0; v < nv; v++) {
          const c = cellOf(p[v * 3], p[v * 3 + 1], p[v * 3 + 2]);
          U[v] = c[0] / SA * BA; W[v] = c[1] / SE * BE; R[v] = c[2];
          CB[v] = C0[Math.min(CE - 1, Math.max(0, (c[1] / SE * CE) | 0)) * CA + Math.min(CA - 1, (c[0] / SA * CA) | 0)];
        }
        for (let f = 0; f < ix.length; f += 3) {
          const va = ix[f], vb = ix[f + 1], vc = ix[f + 2];
          const r0 = Math.min(R[va], R[vb], R[vc]);
          const ed = Math.max(Math.abs(R[va] - R[vb]), Math.abs(R[vb] - R[vc]), Math.abs(R[vc] - R[va]),
            Math.hypot(p[va * 3] - p[vb * 3], p[va * 3 + 1] - p[vb * 3 + 1], p[va * 3 + 2] - p[vb * 3 + 2]));
          if (ed < 0.06 && r0 - ed * ed / (4 * Math.max(0.1, r0)) > Math.max(CB[va], CB[vb], CB[vc]) + margin) continue;
          const id = tris.length;
          tris.push(part, va * 3, vb * 3, vc * 3);
          const us = [U[va], U[vb], U[vc]];
          let e0 = Math.min(W[va], W[vb], W[vc]), e1 = Math.max(W[va], W[vb], W[vc]);
          let a0 = Math.min(us[0], us[1], us[2]), a1 = Math.max(us[0], us[1], us[2]);
          if (a1 - a0 > BA / 2) { const w = us.map((u) => (u < BA / 2 ? u + BA : u)); a0 = Math.min(w[0], w[1], w[2]); a1 = Math.max(w[0], w[1], w[2]); }
          if (a1 - a0 > BA / 2) { a0 = 0; a1 = BA - 1; if (e0 + e1 > BE) e1 = BE - 1; else e0 = 0; }
          for (let j = Math.max(0, Math.floor(e0) - 1); j <= Math.min(BE - 1, Math.floor(e1) + 1); j++)
            for (let ii = Math.floor(a0) - 1; ii <= Math.floor(a1) + 1; ii++) {
              const k = j * BA + ((ii % BA) + BA) % BA;
              let L = bins.get(k); if (!L) bins.set(k, L = []);
              L.push(id);
            }
        }
      }
      if (!tris.length) break;
      const push = new Map();
      const A = [0, 0, 0], B = [0, 0, 0], C = [0, 0, 0];
      for (let i = 0; i < pts.length; i += 5) {
        const L = bins.get(pts[i + 4]);
        if (!L) continue;
        const dx = pts[i], dy = pts[i + 1], dz = pts[i + 2], r = pts[i + 3];
        for (const id of L) {
          const part = tris[id], p = part.p, ia = tris[id + 1], ib = tris[id + 2], ic = tris[id + 3];
          A[0] = p[ia]; A[1] = p[ia + 1]; A[2] = p[ia + 2]; B[0] = p[ib]; B[1] = p[ib + 1]; B[2] = p[ib + 2]; C[0] = p[ic]; C[1] = p[ic + 1]; C[2] = p[ic + 2];
          const t = rayTri(dx, dy, dz, A, B, C);
          if (t <= 0 || t >= r + margin) continue;
          const need = r + margin - t;
          for (const i3 of [ia, ib, ic]) {
            const kk = key(p[i3], p[i3 + 1], p[i3 + 2]);
            if (!(push.get(kk) >= need)) push.set(kk, need);
          }
        }
      }
      if (!push.size) break;
      for (const role of roles) {
        const p = P.map[role].p;
        for (let i = 0; i < p.length; i += 3) {
          const D = push.get(key(p[i], p[i + 1], p[i + 2]));
          if (!D) continue;
          const dx = p[i] - HC[0], dy = p[i + 1] - HC[1], dz = p[i + 2] - HC[2], r = Math.hypot(dx, dy, dz) || 1;
          const s = (r + D * 1.1) / r;
          p[i] = HC[0] + dx * s; p[i + 1] = HC[1] + dy * s; p[i + 2] = HC[2] + dz * s;
        }
      }
    }
  }
  // a coarse, dilated copy of a BODY map (11 degree cells, each the max of
  // itself and its neighbours): a cheap upper bound, so the hat triangles
  // nowhere near the head (a brim's rim, a helmet's crown) cost nothing
  const CA = 32, CE = 16, COARSE = new WeakMap();
  function coarseOf(M) {
    let C = COARSE.get(M);
    if (C) return C;
    const raw = new Float32Array(CA * CE);
    for (let j = 0; j < SE; j++) for (let i = 0; i < SA; i++) {
      const k = ((j * CE / SE) | 0) * CA + ((i * CA / SA) | 0);
      if (M[j * SA + i] > raw[k]) raw[k] = M[j * SA + i];
    }
    C = new Float32Array(CA * CE);
    for (let j = 0; j < CE; j++) for (let i = 0; i < CA; i++) {
      let m = 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const jj = Math.max(0, Math.min(CE - 1, j + dj)), ii = (i + di + CA) % CA;
        if (raw[jj * CA + ii] > m) m = raw[jj * CA + ii];
      }
      // a cell touching a pole sees every azimuth round it
      if (j <= 1 || j >= CE - 2) for (let ii = 0; ii < CA; ii++) {
        const jj = j <= 1 ? 0 : CE - 1;
        if (raw[jj * CA + ii] > m) m = raw[jj * CA + ii];
      }
      C[j * CA + i] = m;
    }
    COARSE.set(M, C);
    return C;
  }
  /* PUSH THE HAT OFF THE HEAD: every triangle of every role is sampled on a
     barycentric grid (denser on big triangles: an ear's corner can poke
     between the corners of a drape triangle 4 cm across); wherever a sample
     sits inside the body map (+ margin) all three corners move out along their
     own rays from HC by the deficit. Vertices at the same spot in different
     grids (a crown and its lip, a brim and its edge roll) get the same push,
     so no seam opens. A few passes, re-checking only what moved. */
  function clearHead(P, form, margin, beardGeo) {
    const M = bodyMap(form, beardGeo), C = coarseOf(M);
    const roles = Object.keys(P.map);
    const key = (x, y, z) => (Math.round(x * 2e4) + 50000) * 1e10 + (Math.round(y * 2e4) + 50000) * 1e5 + (Math.round(z * 2e4) + 50000);
    const coarseAt = (x, y, z) => {
      const dx = x - HC[0], dy = y - HC[1], dz = z - HC[2], r = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-9;
      const i = Math.min(CA - 1, ((Math.atan2(dx, dz) + PI) / TAU * CA) | 0);
      const j = Math.max(0, Math.min(CE - 1, ((Math.asin(Math.max(-1, Math.min(1, dy / r))) + PI / 2) / PI * CE) | 0));
      return C[j * CA + i];
    };
    let moved = null;                          // the spots pushed last pass
    for (let pass = 0; pass < 6; pass++) {
      const push = new Map();
      for (const role of roles) {
        const part = P.map[role], p = part.p, ix = part.ix, nv = p.length / 3;
        const m = role === "strap" ? margin + 0.001 : margin;
        // per vertex, once a pass: its distance, the body under it, the coarse bound
        const Rv = new Float32Array(nv), Bv = new Float32Array(nv), Cv = new Float32Array(nv);
        for (let v = 0; v < nv; v++) {
          const x = p[v * 3], y = p[v * 3 + 1], z = p[v * 3 + 2];
          Rv[v] = Math.hypot(x - HC[0], y - HC[1], z - HC[2]);
          Cv[v] = coarseAt(x, y, z);
          Bv[v] = -1;                                  // looked up lazily
        }
        const bAt = (v) => (Bv[v] >= 0 ? Bv[v] : (Bv[v] = sphCell(M, p[v * 3], p[v * 3 + 1], p[v * 3 + 2])));
        for (let f = 0; f < ix.length; f += 3) {
          const va = ix[f], vb = ix[f + 1], vc = ix[f + 2], ia = va * 3, ib = vb * 3, ic = vc * 3;
          if (moved && !moved.has(key(p[ia], p[ia + 1], p[ia + 2])) && !moved.has(key(p[ib], p[ib + 1], p[ib + 2])) && !moved.has(key(p[ic], p[ic + 1], p[ic + 2]))) continue;
          const ed = Math.max(Math.hypot(p[ia] - p[ib], p[ia + 1] - p[ib + 1], p[ia + 2] - p[ib + 2]),
            Math.hypot(p[ib] - p[ic], p[ib + 1] - p[ic + 1], p[ib + 2] - p[ic + 2]),
            Math.hypot(p[ic] - p[ia], p[ic + 1] - p[ia + 1], p[ic + 2] - p[ia + 2]));
          // cheap reject: a small triangle whose corners are all well clear of the coarse bound
          const r0 = Math.min(Rv[va], Rv[vb], Rv[vc]);
          if (ed < 0.06 && r0 - ed * ed / (4 * Math.max(0.1, r0)) > Math.max(Cv[va], Cv[vb], Cv[vc]) + m) continue;
          // the corners (cached), then the inside on a barycentric grid (the
          // cell itself: the exact pass after this one catches an ear corner
          // between cells; a 2 x 2 worst case here would throw a brim off a
          // brow's front and a liner off the skull it should touch)
          let need = Math.max(bAt(va) + m - Rv[va], bAt(vb) + m - Rv[vb], bAt(vc) + m - Rv[vc], 0);
          const n = Math.min(8, Math.ceil(ed / 0.016));
          if (n >= 2) for (let si = 0; si <= n; si++) for (let sj = 0; si + sj <= n; sj++) {
            if (si === n || sj === n || si + sj === 0) continue;       // a corner
            const w0 = si / n, w1 = sj / n, w2 = 1 - w0 - w1;
            const x = p[ia] * w0 + p[ib] * w1 + p[ic] * w2;
            const y = p[ia + 1] * w0 + p[ib + 1] * w1 + p[ic + 1] * w2;
            const z = p[ia + 2] * w0 + p[ib + 2] * w1 + p[ic + 2] * w2;
            const r = Math.hypot(x - HC[0], y - HC[1], z - HC[2]);
            const b = sphCell(M, x, y, z);
            if (b > 0 && b + m - r > need) need = b + m - r;
          }
          if (need > 1e-5) {
            for (const i3 of [ia, ib, ic]) {
              const kk = key(p[i3], p[i3 + 1], p[i3 + 2]);
              if (!(push.get(kk) >= need)) push.set(kk, need);
            }
          }
        }
      }
      if (!push.size) break;
      moved = new Set();
      for (const role of roles) {
        const p = P.map[role].p;
        for (let i = 0; i < p.length; i += 3) {
          const D = push.get(key(p[i], p[i + 1], p[i + 2]));
          if (!D) continue;
          const dx = p[i] - HC[0], dy = p[i + 1] - HC[1], dz = p[i + 2] - HC[2], r = Math.hypot(dx, dy, dz) || 1;
          // a touch over, so the next pass converges instead of creeping
          const s = (r + D * 1.15) / r;
          p[i] = HC[0] + dx * s; p[i + 1] = HC[1] + dy * s; p[i + 2] = HC[2] + dz * s;
          moved.add(key(p[i], p[i + 1], p[i + 2]));
        }
      }
    }
  }
  // the SHELL map of a built hat: nearest surface per direction. Straps (they
  // lie on the skin by design), the riot's clear visor and hanging tails (they
  // hang BEHIND long hair, see fitHair) do not cover anything.
  const NO_COVER = { strap: 1, clear: 1 };
  function shellMap(geos, tails) {
    const M = new Float32Array(SA * SE).fill(Infinity);
    for (const role in geos) {
      if (NO_COVER[role] || (role === "tail" && !tails)) continue;
      const a = geoArrays(geos[role]);
      sphRaster(M, a.pos, a.ix, false);
    }
    return M;
  }
  /* G[j][i] (rows j, cols i). closedU wraps i. hint(i, j, p) -> the way the
     face should look; checked on a middle quad and the grid flipped to it.
     skip(i, j) -> true leaves quad (i, j) out. */
  function addGrid(part, G, closedU, hint, skip) {
    const rows = G.length, cols = G[0].length;
    if (rows < 2 || cols < 2) return;
    const base = part.p.length / 3;
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const v = G[j][i];
      part.p.push(v[0], v[1], v[2]);
      part.uv.push(i / (closedU ? cols : cols - 1), j / (rows - 1));
    }
    const qi = closedU ? cols : cols - 1;
    let flip = false;
    if (hint) {
      let vote = 0;
      for (const jj of [0, (rows - 1) >> 1, rows - 2]) for (const ii of [0, qi >> 1, qi - 1]) {
        const a = G[jj][ii], b = G[jj][(ii + 1) % cols], d = G[jj + 1][ii], c = G[jj + 1][(ii + 1) % cols];
        let n = V.cross(V.sub(b, a), V.sub(d, a));
        if (V.len(n) < 1e-10) n = V.cross(V.sub(c, b), V.sub(d, b));
        if (V.len(n) < 1e-10) n = V.cross(V.sub(b, a), V.sub(c, a));
        vote += V.dot(n, hint(ii, jj, a)) < 0 ? -1 : 1;
      }
      flip = vote < 0;
    }
    for (let j = 0; j < rows - 1; j++) for (let i = 0; i < qi; i++) {
      if (skip && skip(i, j)) continue;               // a hole (a helmet's eye port)
      const i2 = (i + 1) % cols;
      const a = base + j * cols + i, b = base + j * cols + i2, c = base + (j + 1) * cols + i2, d = base + (j + 1) * cols + i;
      if (flip) part.ix.push(a, c, b, a, d, c); else part.ix.push(a, b, c, a, c, d);
    }
  }
  const _m4 = () => new THREE.Matrix4();
  // any THREE BufferGeometry, transformed by m, into a part
  function addGeo(part, geo, m) {
    const g = geo.index ? geo : geo;
    const pos = g.attributes.position, base = part.p.length / 3, v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(m);
      part.p.push(v.x, v.y, v.z); part.uv.push(0.5, 0.5);
    }
    const flip = m.determinant() < 0;
    if (g.index) {
      for (let i = 0; i < g.index.count; i += 3) {
        const a = g.index.getX(i) + base, b = g.index.getX(i + 1) + base, c = g.index.getX(i + 2) + base;
        if (flip) part.ix.push(a, c, b); else part.ix.push(a, b, c);
      }
    } else {
      for (let i = 0; i < pos.count; i += 3) {
        if (flip) part.ix.push(base + i, base + i + 2, base + i + 1); else part.ix.push(base + i, base + i + 1, base + i + 2);
      }
    }
    geo.dispose();
  }
  // a matrix that puts local +z along n, local +y along up-ish, at p
  function frameAt(p, n, up, sx, sy, sz) {
    const z = V.norm(n);
    let x = V.cross(up || [0, 1, 0], z);
    if (V.len(x) < 1e-6) x = V.cross([1, 0, 0], z);
    x = V.norm(x);
    const y = V.cross(z, x);
    const m = _m4();
    m.makeBasis(new THREE.Vector3(x[0], x[1], x[2]), new THREE.Vector3(y[0], y[1], y[2]), new THREE.Vector3(z[0], z[1], z[2]));
    m.scale(new THREE.Vector3(sx || 1, sy || 1, sz || 1));
    m.setPosition(p[0], p[1], p[2]);
    return m;
  }
  function toGeometry(part) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(part.p, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(part.uv, 2));
    const n = part.p.length / 3;
    g.setIndex(n > 65535 ? new THREE.Uint32BufferAttribute(part.ix, 1) : new THREE.Uint16BufferAttribute(part.ix, 1));
    g.computeVertexNormals();
    g.computeBoundingBox(); g.computeBoundingSphere();
    g._shared = true;
    return g;
  }

  /* A thick slab from a mid-surface grid M[j][i]: top (facing `up`), bottom,
     a rolled outer edge (the last row) and, if open, the two side edges.
     roles: {top, bottom, edge}. th = thickness (number or fn(i, j)). */
  function slab(P, M, closedU, th, upHint, roles, o) {
    o = o || {};
    const rows = M.length, cols = M[0].length;
    const N = [];
    for (let j = 0; j < rows; j++) {
      const row = [];
      for (let i = 0; i < cols; i++) {
        const iP = closedU ? (i + 1) % cols : Math.min(cols - 1, i + 1), iM = closedU ? (i - 1 + cols) % cols : Math.max(0, i - 1);
        const jP = Math.min(rows - 1, j + 1), jM = Math.max(0, j - 1);
        const du = V.sub(M[j][iP], M[j][iM]), dv = V.sub(M[jP][i], M[jM][i]);
        let n = V.norm(V.cross(du, dv));
        const h = upHint(i, j, M[j][i]);
        if (V.dot(n, h) < 0) n = V.mul(n, -1);
        row.push(n);
      }
      N.push(row);
    }
    const T = (i, j) => (typeof th === "function" ? th(i, j) : th) * 0.5;
    const top = M.map((r, j) => r.map((p, i) => V.add(p, V.mul(N[j][i], T(i, j)))));
    const bot = M.map((r, j) => r.map((p, i) => V.sub(p, V.mul(N[j][i], T(i, j)))));
    addGrid(P(roles.top), top, closedU, (i, j) => N[j][i]);
    addGrid(P(roles.bottom || roles.top), bot, closedU, (i, j) => V.mul(N[j][i], -1));
    // the rolled outer edge: top -> proud middle -> bottom
    const edgeRow = (j, outSign) => {
      const G = [[], [], []];
      for (let i = 0; i < cols; i++) {
        const jn = outSign > 0 ? Math.max(0, j - 1) : Math.min(rows - 1, j + 1);
        let out = V.norm(V.sub(M[j][i], M[jn][i]));
        // keep it perpendicular to the normal
        out = V.norm(V.sub(out, V.mul(N[j][i], V.dot(out, N[j][i]))));
        G[0].push(top[j][i]);
        G[1].push(V.add(M[j][i], V.mul(out, T(i, j) * 0.9)));
        G[2].push(bot[j][i]);
      }
      return G;
    };
    const eo = edgeRow(rows - 1, 1);
    addGrid(P(roles.edge || roles.top), eo, closedU, (i) => V.sub(eo[1][i], V.lerp(eo[0][i], eo[2][i], 0.5)));
    if (o.innerEdge) {
      const ei = edgeRow(0, -1);
      addGrid(P(roles.edge || roles.top), ei, closedU, (i) => V.sub(ei[1][i], V.lerp(ei[0][i], ei[2][i], 0.5)));
    }
    if (!closedU) {
      for (const side of [0, cols - 1]) {
        const G = [[], [], []];
        const sn = side === 0 ? 1 : cols - 2;
        for (let j = 0; j < rows; j++) {
          let out = V.norm(V.sub(M[j][side], M[j][sn]));
          out = V.norm(V.sub(out, V.mul(N[j][side], V.dot(out, N[j][side]))));
          G[0].push(top[j][side]); G[1].push(V.add(M[j][side], V.mul(out, T(side, j) * 0.9))); G[2].push(bot[j][side]);
        }
        // transpose so rows are the 3 layers along j
        addGrid(P(roles.edge || roles.top), G, false, (i2, j2) => V.sub(G[1][i2], V.lerp(G[0][i2], G[2][i2], 0.5)));
      }
    }
    return N;
  }

  /* A tube along a path of points with a guide normal per point (the surface
     it lies on). Cross-section: an ellipse w (along the surface) x h (off
     it), sitting ON the surface (its inner face at the path). */
  function tube(part, pts, nrm, w, h, closed, sides) {
    sides = sides || 6;
    const n = pts.length, G = [];
    for (let k = 0; k < n; k++) {
      const kp = closed ? (k + 1) % n : Math.min(n - 1, k + 1), km = closed ? (k - 1 + n) % n : Math.max(0, k - 1);
      const T = V.norm(V.sub(pts[kp], pts[km]));
      const N0 = V.norm(V.sub(nrm[k], V.mul(T, V.dot(nrm[k], T))));
      const S = V.norm(V.cross(T, N0));
      const ww = typeof w === "function" ? w(k / (n - 1)) : w, hh = typeof h === "function" ? h(k / (n - 1)) : h;
      const ring = [];
      for (let s = 0; s < sides; s++) {
        const t = s / sides * TAU;
        const c = V.add(pts[k], V.mul(N0, hh * 0.5));
        ring.push(V.add(c, V.add(V.mul(S, Math.cos(t) * ww * 0.5), V.mul(N0, Math.sin(t) * hh * 0.5))));
      }
      G.push(ring);
    }
    // rows = along the path, cols = around
    const centre = (k) => V.add(pts[k], V.mul(V.norm(nrm[k]), (typeof h === "function" ? h(k / (n - 1)) : h) * 0.5));
    if (closed) G.push(G[0]);
    addGrid(part, G, true, (i, j, p) => V.sub(p, centre(Math.min(n - 1, j))));
    if (!closed) {
      for (const k of [0, n - 1]) {
        const c = centre(k);
        const fan = [G[k].map(() => c), G[k]];
        const dir = V.sub(pts[k], pts[k === 0 ? 1 : n - 2]);
        addGrid(part, fan, true, () => dir);
      }
    }
  }

  function ellipsoidPart(part, p, n, up, rx, ry, rz, seg) {
    addGeo(part, new THREE.SphereGeometry(1, seg || 8, Math.max(4, (seg || 8) - 2)), frameAt(p, n, up, rx, ry, rz));
  }
  function boxPart(part, p, n, up, w, h, d, r) {
    const g = new THREE.BoxGeometry(w, h, d, 1, 1, 1);
    addGeo(part, g, frameAt(V.add(p, V.mul(V.norm(n), d * 0.5)), n, up, 1, 1, 1));
  }
  const SHAPES = {};
  function shapeGeo(kind) {
    const s = new THREE.Shape();
    if (kind === "star") {
      for (let i = 0; i < 14; i++) {
        const r = i % 2 ? 0.42 : 1, a = i / 14 * TAU;
        if (i) s.lineTo(Math.sin(a) * r, Math.cos(a) * r); else s.moveTo(0, r);
      }
    } else if (kind === "shield") {
      s.moveTo(0, 1); s.bezierCurveTo(0.35, 0.95, 0.7, 1.0, 0.85, 0.8); s.lineTo(0.8, 0.05);
      s.bezierCurveTo(0.7, -0.5, 0.25, -0.85, 0, -1); s.bezierCurveTo(-0.25, -0.85, -0.7, -0.5, -0.8, 0.05);
      s.lineTo(-0.85, 0.8); s.bezierCurveTo(-0.7, 1.0, -0.35, 0.95, 0, 1);
    } else {                                     // an oval crest
      for (let i = 0; i <= 16; i++) { const a = i / 16 * TAU; if (i) s.lineTo(Math.sin(a) * 0.8, Math.cos(a)); else s.moveTo(0, 1); }
    }
    return new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false, curveSegments: 6 });
  }
  function emblem(part, kind, p, n, size, depth) {
    addGeo(part, shapeGeo(kind), frameAt(p, n, [0, 1, 0], size, size, depth));
  }

  /* ---- THE CROWN SHELL -------------------------------------------------
     Rows from the band line (t = 0) to the crown pole (t = 1), columns round
     the head. Each point: the scalp point at (azimuth, elevation) pushed out
     along the scalp normal by off(a, t, p, n) — or, if o.radial is given,
     placed at radial distance radial(a, t, dir, R) from HC along the ray. */
  function crownGrid(H, o) {
    const seg = o.seg, rowsT = o.rowsT;
    const eb = [];
    for (let i = 0; i < seg; i++) eb.push(H.bandE(i / seg * TAU, o.band(i / seg * TAU)));
    const G = [];
    for (let j = 0; j < rowsT.length; j++) {
      const t = rowsT[j], row = [];
      for (let i = 0; i < seg; i++) {
        const a = i / seg * TAU;
        const e = eb[i] + (PI / 2 - 0.002 - eb[i]) * t;
        const d = H.dirAE(a, e), R = H.hitDir(d);
        if (o.radial) {
          const r = o.radial(a, t, d, R);
          row.push([HC[0] + d[0] * r, HC[1] + d[1] * r, HC[2] + d[2] * r]);
        } else {
          const p = [HC[0] + d[0] * R, HC[1] + d[1] * R, HC[2] + d[2] * R];
          const n = H.normal(p), off = o.off(a, t, p, n);
          row.push(V.add(p, V.mul(n, off)));
        }
      }
      G.push(row);
    }
    return G;
  }
  function linRows(n, bias) { const r = []; for (let j = 0; j <= n; j++) r.push(Math.pow(j / n, bias || 1)); return r; }
  // the rim under a crown: from its band row in to the scalp (+ inset)
  function lipUnder(part, H, G, inset) {
    const row0 = G[0], inner = [];
    const M = H.form && CBZ.human && CBZ.human.geometry ? bodyMap(H.form) : null;
    for (let i = 0; i < row0.length; i++) {
      // the inner edge lands on the REAL head (character.js's skull and ears,
      // via the body map), not the analytic one: the analytic ear is a
      // smoothed box 8 mm proud of the real one, and a helmet skirt closed
      // onto it stood off the real ear
      const q = row0[i], dx = q[0] - HC[0], dy = q[1] - HC[1], dz = q[2] - HC[2], r = Math.hypot(dx, dy, dz) || 1;
      const b = M ? sphCell(M, q[0], q[1], q[2]) : 0;
      if (b > 0 && b + inset < r) inner.push([HC[0] + dx / r * (b + inset), HC[1] + dy / r * (b + inset), HC[2] + dz / r * (b + inset)]);
      else inner.push(H.project(q, inset).p);
    }
    addGrid(part, [row0, inner], true, () => [0, -1, 0]);
  }
  const outFrom = (c) => (i, j, p) => V.sub(p, c);
  const HINT_OUT = outFrom(HC);

  /* ---- LATHE CROWNS (a fedora / peaked cap / campaign hat crown is its
     own shape, not the skull's): rings round the vertical axis. */
  function ringPts(H, seg, yFn, pad) {
    const R = [];
    for (let i = 0; i < seg; i++) {
      const a = i / seg * TAU, y = yFn(a), r = H.ring(a, y) + pad;
      R.push([Math.sin(a) * r, y, Math.cos(a) * r]);
    }
    return R;
  }

  // push a point out along the ray from the skull centre until it clears the
  // scalp by `off` — a lathe crown can never dip into the head it sits on
  function clearOut(H, p, off) {
    const d = [p[0] - HC[0], p[1] - HC[1], p[2] - HC[2]], r = V.len(d);
    if (r < 1e-6) return p;
    const u = [d[0] / r, d[1] / r, d[2] / r], R = H.hitDir(u) + off;
    return r >= R ? p : [HC[0] + u[0] * R, HC[1] + u[1] * R, HC[2] + u[2] * R];
  }

  /* ---- A BRIM ----------------------------------------------------------
     Mid-surface from an inner loop (the band) out to an outer rim. For a
     closed brim cols = seg round the head; for a bill, an arc. */
  function brim(P, inner, outerFn, rows, closedU, th, roles, yFn) {
    const M = [];
    for (let j = 0; j < rows; j++) {
      const v = j / (rows - 1), row = [];
      for (let i = 0; i < inner.length; i++) {
        const o = outerFn(i, v);
        const p = V.lerp(inner[i], o, v);
        if (yFn) p[1] = yFn(i, v, inner[i], o);
        row.push(p);
      }
      M.push(row);
    }
    return slab(P, M, closedU, th, () => [0, 1, 0], roles);
  }

  /* =====================================================================
     THE KINDS. Each builder: (lod, form, variant) -> { P, cover }.
     Roles: main (the hat's colour), under (underbrim / a darker shade of
     main), accent (band / ribbon / stripe), trim (black edging / cord),
     hard (polymer furniture), strap (webbing), metal (badge, buttons),
     peak (a glossy black visor), smoke (a tinted helmet visor), clear (a
     transparent face shield).
     cover: what the hat does to hair under it — band(a) the band line,
     room(a, y) the hair allowed above the scalp under it, or slice / hide.
     ===================================================================== */
  const Q = (lod, near, far) => (lod ? far : near);
  const CAP_BAND = band([[0, 0.495], [0.9, 0.472], [1.57, 0.425], [2.3, 0.39], [PI, 0.37]]);

  function buildBallcap(lod, form, v) {
    const H = Head(form), P = parts();
    const rot = v === "back" ? PI : 0;              // worn backward: every feature turns, the band does not
    const snap = v === "snap";                       // a snapback: high structured front, FLAT brim
    const seg = Q(lod, 48, 24);
    const openW = 0.40;                              // the snapback opening, half-width (rad)
    const arch = (ac) => sm01(1 - Math.abs(wrapA(ac - PI)) / openW);
    const bandY = (a) => CAP_BAND(a) + 0.075 * arch(a - rot);
    const G = crownGrid(H, {
      seg, rowsT: Q(lod, [0, 0.06, 0.16, 0.28, 0.4, 0.52, 0.64, 0.76, 0.88, 1], [0, 0.2, 0.45, 0.7, 1]), band: bandY,
      off(a, t) {
        const ac = a - rot;
        const fw = Math.pow(Math.max(0, Math.cos(ac)), 1.5);
        let o = O_SOFT + 0.02 * sm01(t * 1.3) + (snap ? 0.05 : 0.036) * fw * Math.sin(PI * Math.min(1, t * 1.15)) * (1 - 0.3 * t);
        if (!lod) for (let s = 0; s < 6; s++) {          // six panels: a groove on every seam
          const dd = wrapA(ac - s * PI / 3);
          o -= 0.0024 * Math.exp(-(dd / 0.05) * (dd / 0.05)) * sm01(t * 5) * (1 - sm01((t - 0.92) * 14));
        }
        return o;
      },
    });
    addGrid(P("main"), G, true, HINT_OUT);
    lipUnder(P("under"), H, G, 0.0012);
    // the bill: an arc of the band, curved across, pitched down a touch
    const cols = Q(lod, 15, 7), inner = [];
    for (let i = 0; i < cols; i++) {
      const u = i / (cols - 1) * 2 - 1, a = u * 1.12 + rot;
      const e = H.bandE(a, CAP_BAND(a)), p = H.hitAE(a, e), n = H.normal(p);
      inner.push(V.add(V.add(p, V.mul(n, O_SOFT - 0.002)), [0, 0.002, 0]));
    }
    const yC = inner[(cols - 1) >> 1][1];
    brim(P, inner, function (i, vv) {
      const u = i / (cols - 1) * 2 - 1, phi = u * PI / 2 * 0.97;
      let x = 0.36 * Math.sin(phi), z = 0.115 + 0.43 * Math.cos(phi);
      if (rot) { x = -x; z = -z; }
      return [x, 0, z];
    }, Q(lod, 5, 3), false, 0.011, { top: "main", bottom: "under", edge: "main" }, function (i, vv, pi) {
      const u = i / (cols - 1) * 2 - 1;
      // worn backward the bill rides up off the nape and the hair, its sides barely curled
      if (snap) return lerp(pi[1], yC - 0.02 - 0.01 * u * u, vv);
      const yo = yC - (rot ? -0.02 : 0.042) - (rot ? 0.03 : 0.085) * u * u;
      return lerp(pi[1], yo, vv) - 0.006 * Math.sin(PI * vv) * (1 - u * u);
    });
    if (!lod) {
      // the top button where the six panels meet
      const top = G[G.length - 1][0], n = H.normal(H.hitAE(0, PI / 2 - 0.01));
      ellipsoidPart(P("main"), V.add(top, V.mul(n, 0.004)), n, [0, 0, 1], 0.022, 0.022, 0.010, 8);
      // the snapback strap across the opening, on the unraised band line
      const pts = [], nr = [];
      for (let k = 0; k <= 8; k++) {
        const ac = PI - openW * 1.05 + (k / 8) * openW * 2.1, a = ac + rot;
        const pr = H.project(H.hitAE(a, H.bandE(a, CAP_BAND(a) + 0.009)), O_SOFT - 0.001);
        pts.push(pr.p); nr.push(pr.n);
      }
      tube(P("under"), pts, nr, 0.022, 0.007, false, 4);
    }
    return { P, cover: { band: CAP_BAND, room: (a, y) => HA_HAIR + 0.03 * arch(a - rot) * sm01((y - CAP_BAND(a) - 0.026) / 0.012) * (1 - sm01((y - (CAP_BAND(a) + 0.075 * arch(a - rot) - 0.02)) / 0.012)) } };
  }

  const PEAK_BAND = band([[0, 0.472], [1.57, 0.448], [PI, 0.43]]);
  function buildPeaked(lod, form, v) {
    // v: "police" (black band, silver), "captain" (black band, gold cord, crest),
    //    "chauffeur" (all one colour), "officer" (army: accent band, gold)
    const H = Head(form), P = parts(), seg = Q(lod, 40, 20);
    const bandH = 0.075, gold = v === "captain" || v === "officer";
    const bot = ringPts(H, seg, PEAK_BAND, O_SOFT);
    const topB = bot.map((p, i) => {
      const a = i / seg * TAU, y = p[1] + bandH, r = Math.max(Math.hypot(p[0], p[2]), H.ring(a, y) + O_SOFT);
      return [Math.sin(a) * r, y, Math.cos(a) * r];
    });
    addGrid(P(v === "chauffeur" ? "main" : "accent"), [bot, topB], true, (i, j, p) => [p[0], 0, p[2]]);
    // the crown: flares from the band to a stiff oval top, raised at the front (the saddle)
    const rows = Q(lod, 5, 3), wall = [];
    const edge = (a) => {
      const rx = 0.385, rz = 0.415, c = Math.cos(a), s = Math.sin(a);
      const r = 1 / Math.sqrt((s * s) / (rx * rx) + (c * c) / (rz * rz));
      return [s * r, 0.705 + 0.062 * Math.pow(Math.max(0, c), 1.3) - 0.012 * Math.max(0, -c), c * r + 0.028];
    };
    for (let j = 0; j <= rows; j++) {
      const s = j / rows, row = [];
      for (let i = 0; i < seg; i++) {
        const a = i / seg * TAU, e = edge(a), b = topB[i];
        const k = Math.pow(s, 0.55);
        row.push([lerp(b[0], e[0], k), lerp(b[1], e[1], s), lerp(b[2], e[2], k)]);
      }
      wall.push(row);
    }
    for (const row of wall) for (let i = 0; i < row.length; i++) row[i] = clearOut(H, row[i], O_SOFT + 0.004);
    addGrid(P("main"), wall, true, (i, j, p) => [p[0], 0.4, p[2]]);
    const top = [];
    const tr = Q(lod, 4, 2);
    for (let j = 0; j <= tr; j++) {
      const q = 1 - j / tr, row = [];
      for (let i = 0; i < seg; i++) {
        const e = edge(i / seg * TAU), cy = 0.71 + 0.03;
        row.push([e[0] * q, lerp(cy + 0.012, e[1], q * q), lerp(0.03, e[2], q)]);
      }
      top.push(row);
    }
    for (const row of top) for (let i = 0; i < row.length; i++) row[i] = clearOut(H, row[i], O_SOFT + 0.004);
    addGrid(P("main"), top, true, () => [0, 1, 0]);
    lipUnder(P("accent"), H, [bot], 0.0012);
    // the peak: short, steep, glossy
    const cols = Q(lod, 13, 7), inner = [];
    for (let i = 0; i < cols; i++) {
      const u = i / (cols - 1) * 2 - 1, a = u * 1.2, r = H.ring(a, PEAK_BAND(a)) + O_SOFT - 0.003;
      inner.push([Math.sin(a) * r, PEAK_BAND(a) + 0.004, Math.cos(a) * r]);
    }
    brim(P, inner, function (i) {
      const u = i / (cols - 1) * 2 - 1, phi = u * PI / 2 * 0.96;
      return [0.325 * Math.sin(phi), 0, 0.125 + 0.335 * Math.cos(phi)];
    }, Q(lod, 4, 3), false, 0.010, { top: "peak", bottom: "peak", edge: "peak" }, function (i, vv, pi) {
      const u = i / (cols - 1) * 2 - 1;
      return pi[1] - vv * 0.095 - 0.02 * u * u * vv - 0.01 * vv * vv;
    });
    if (!lod) {
      // chin cord across the band over the peak, a button at each end
      const pts = [], nr = [];
      for (let k = 0; k <= 12; k++) {
        const a = -1.3 + k / 12 * 2.6, y = PEAK_BAND(a) + 0.02, r = H.ring(a, y) + O_SOFT + 0.001;
        pts.push([Math.sin(a) * r, y, Math.cos(a) * r]); nr.push([Math.sin(a), 0, Math.cos(a)]);
      }
      tube(P(gold ? "metal" : "trim"), pts, nr, 0.016, 0.007, false, 5);
      for (const a of [-1.3, 1.3]) {
        const y = PEAK_BAND(a) + 0.02, r = H.ring(a, y) + O_SOFT + 0.004;
        ellipsoidPart(P("metal"), [Math.sin(a) * r, y + 0.008, Math.cos(a) * r], [Math.sin(a), 0, Math.cos(a)], [0, 1, 0], 0.014, 0.014, 0.008, 8);
      }
      // the cap badge on the crown front, pitched with the wall
      const w0 = wall[1][0], w1 = wall[2][0];
      const n = V.norm(V.cross(V.sub(w1, w0), [1, 0, 0]));
      const nn = n[2] < 0 ? V.mul(n, -1) : n;
      emblem(P("metal"), v === "police" ? "shield" : (gold ? "crest" : "shield"), V.add(V.lerp(w0, w1, 0.3), V.mul(nn, 0.002)), nn, 0.042, 0.008);
    }
    return { P, cover: { band: PEAK_BAND, room: () => HA_HAIR } };
  }

  function buildMilcap(lod, form) {
    // the army patrol cap: stiff straight sides, a flat top, a short bill
    const H = Head(form), P = parts(), seg = Q(lod, 40, 20);
    const bot = ringPts(H, seg, PEAK_BAND, O_SOFT);
    const rows = Q(lod, 3, 2), wall = [bot];
    const topY = (a) => 0.665 + 0.035 * Math.cos(a);
    for (let j = 1; j <= rows; j++) {
      const s = j / rows;
      wall.push(bot.map((p, i) => {
        const a = i / seg * TAU, r = Math.max(Math.hypot(p[0], p[2]) * (1 + 0.035 * s), H.ring(a, lerp(p[1], topY(a), s)) + O_SOFT);
        return [Math.sin(a) * r, lerp(p[1], topY(a), s), Math.cos(a) * r + 0.012 * s];
      }));
    }
    for (const row of wall) for (let i = 0; i < row.length; i++) row[i] = clearOut(H, row[i], O_SOFT + 0.004);
    addGrid(P("main"), wall, true, (i, j, p) => [p[0], 0, p[2]]);
    const last = wall[wall.length - 1], top = [];
    for (let j = 0; j <= 2; j++) { const q = 1 - j / 2; top.push(last.map((p) => [p[0] * q, lerp(0.675, p[1], q) + (1 - q) * 0.004, p[2] * q + (1 - q) * 0.012])); }
    for (const row of top) for (let i = 0; i < row.length; i++) row[i] = clearOut(H, row[i], O_SOFT + 0.004);
    addGrid(P("main"), top, true, () => [0, 1, 0]);
    lipUnder(P("under"), H, [bot], 0.0012);
    const cols = Q(lod, 11, 6), inner = [];
    for (let i = 0; i < cols; i++) {
      const u = i / (cols - 1) * 2 - 1, a = u * 1.1, r = H.ring(a, PEAK_BAND(a)) + O_SOFT - 0.003;
      inner.push([Math.sin(a) * r, PEAK_BAND(a) + 0.004, Math.cos(a) * r]);
    }
    brim(P, inner, function (i) {
      const u = i / (cols - 1) * 2 - 1, phi = u * PI / 2 * 0.95;
      return [0.31 * Math.sin(phi), 0, 0.13 + 0.30 * Math.cos(phi)];
    }, 3, false, 0.011, { top: "main", bottom: "under", edge: "main" }, (i, vv, pi) => pi[1] - vv * 0.05);
    return { P, cover: { band: PEAK_BAND, room: () => HA_HAIR } };
  }

  // lathe-crowned brimmed hats: fedora, trilby, cowboy, bucket, sun, campaign
  const HAT_BAND = band([[0, 0.488], [1.57, 0.458], [PI, 0.452]]);
  function buildBrimmed(lod, form, kind, v) {
    const H = Head(form), P = parts(), seg = Q(lod, 44, 22);
    const S = {
      fedora:   { hc: 0.205, taper: 0.06, pinch: 0.05, crease: 0.05, reach: 0.135, snap: 1, ribbon: 0.042 },
      trilby:   { hc: 0.18, taper: 0.08, pinch: 0.045, crease: 0.04, reach: 0.078, snap: 1.6, ribbon: 0.034 },
      cowboy:   { hc: 0.245, taper: 0.04, pinch: 0.03, crease: 0.065, side: 0.04, reach: 0.21, curl: 0.14, ribbon: 0.03 },
      bucket:   { hc: 0.165, taper: 0.10, round: 1, reach: 0.12, slope: 0.058 },
      sun:      { hc: 0.175, dome: 1, reach: 0.30, droop: 0.075, wave: 0.012, ribbon: 0.036 },
      campaign: { hc: 0.26, montana: 1, reach: 0.21, flat: 1, ribbon: 0.03 },
    }[kind];
    const bandY = kind === "bucket" || kind === "sun" ? band([[0, 0.478], [1.57, 0.452], [PI, 0.44]]) : HAT_BAND;
    const base = ringPts(H, seg, bandY, 0.012);
    const rows = Q(lod, 7, 4), wall = [];
    for (let j = 0; j <= rows; j++) {
      const s = j / rows;
      wall.push(base.map((p, i) => {
        const a = i / seg * TAU, r0 = Math.hypot(p[0], p[2]);
        let r, y;
        if (S.dome) { r = r0 * Math.sqrt(Math.max(0, 1 - Math.pow(s, 2.4))); y = p[1] + S.hc * Math.pow(s, 0.75); }
        else if (S.montana) {
          // four dents between four ridges: front, back and the two sides
          r = lerp(r0 * 1.02, 0.07, Math.pow(s, 1.25)) * (1 - 0.2 * sm01(s * 1.6) * (1 - Math.cos(4 * a)) / 2);
          y = p[1] + S.hc * Math.pow(s, 0.9);
        } else {
          r = r0 * (1 - S.taper * s);
          if (S.pinch) r -= S.pinch * Math.exp(-Math.pow((Math.abs(wrapA(a)) - 0.55) / 0.28, 2)) * sm01((s - 0.35) / 0.65);
          if (S.side) r -= S.side * Math.exp(-Math.pow((Math.abs(wrapA(a)) - 1.35) / 0.4, 2)) * sm01((s - 0.45) / 0.55);
          if (S.round) r -= 0.03 * sm01((s - 0.7) / 0.3);
          y = p[1] + S.hc * s - (S.round ? 0.012 * sm01((s - 0.8) / 0.2) : 0);
        }
        return [Math.sin(a) * r, y, Math.cos(a) * r];
      }));
    }
    for (const row of wall) for (let i = 0; i < row.length; i++) row[i] = clearOut(H, row[i], O_SOFT + 0.004);
    addGrid(P("main"), wall, true, (i, j, p) => [p[0], 0.3, p[2]]);
    if (!S.dome && !S.montana) {
      // the top, with the crease: a teardrop groove running front to back
      const last = wall[wall.length - 1], tr = Q(lod, 5, 3), top = [];
      for (let j = 0; j <= tr; j++) {
        const q = 1 - j / tr;
        top.push(last.map((p) => {
          const x = p[0] * q, z = p[2] * q - (1 - q) * 0.01;
          let y = lerp(p[1] + 0.012, p[1], q * q);
          if (S.crease) {
            const w = 0.055 + 0.035 * sm01((-z + 0.1) / 0.3);
            y -= S.crease * Math.exp(-(x / w) * (x / w)) * sm01((0.34 - Math.abs(z + 0.02)) / 0.14) * sm01((1 - q) / 0.3);
          }
          return [x, y, z];
        }));
      }
      for (const row of top) for (let i = 0; i < row.length; i++) row[i] = clearOut(H, row[i], O_SOFT + 0.004);
      addGrid(P("main"), top, true, () => [0, 1, 0]);
    }
    lipUnder(P("under"), H, [base], 0.0012);
    // ribbon / band on the crown base
    if (S.ribbon) {
      const lo = wall[0], hiRow = [];
      const sR = S.ribbon / S.hc;
      for (let i = 0; i < seg; i++) {
        const j = Math.min(wall.length - 1, Math.max(1, Math.round(sR * rows)));
        const f = Math.min(1, sR * rows / j);
        hiRow.push(V.lerp(lo[i], wall[j][i], f));
      }
      const push = (row) => row.map((p) => { const r = Math.hypot(p[0], p[2]) + 0.004; const a = Math.atan2(p[0], p[2]); return [Math.sin(a) * r, p[1], Math.cos(a) * r]; });
      addGrid(P("accent"), [push(lo), push(hiRow)], true, (i, j, p) => [p[0], 0, p[2]]);
      if (!lod && (kind === "fedora" || kind === "trilby")) {
        const a = PI / 2 + 0.25, p = push([lo[Math.round(a / TAU * seg) % seg]])[0];
        boxPart(P("accent"), V.add(p, [0, S.ribbon * 0.5, 0]), [Math.sin(a), 0, Math.cos(a)], [0, 1, 0], 0.05, S.ribbon * 0.9, 0.008);
      }
    }
    // the brim
    const inner = base.map((p) => { const r = Math.hypot(p[0], p[2]) - 0.004, a = Math.atan2(p[0], p[2]); return [Math.sin(a) * r, p[1], Math.cos(a) * r]; });
    const yAvg = inner.reduce((s, p) => s + p[1], 0) / inner.length;
    brim(P, inner, function (i, vv) {
      const a = i / seg * TAU, r = Math.hypot(inner[i][0], inner[i][2]);
      const reach = S.reach * (S.flat ? 1 : (1 - 0.1 * Math.pow(Math.sin(a), 2)));
      return [Math.sin(a) * (r + reach), 0, Math.cos(a) * (r + reach) + (S.flat ? 0.01 : 0)];
    }, Q(lod, 5, 3), true, S.flat ? 0.014 : 0.010, { top: "main", bottom: "under", edge: "main" }, function (i, vv, pi) {
      const a = i / seg * TAU, c = Math.cos(a), sn = Math.sin(a);
      if (S.flat) return lerp(pi[1], yAvg - 0.004, vv);
      let y = pi[1];
      if (S.snap) y += vv * S.reach * (-0.28 * S.snap * Math.pow(Math.max(0, c), 1.5) + 0.3 * S.snap * Math.max(0, -c)) + vv * vv * 0.018 * sn * sn;
      if (S.curl) y += S.curl * Math.pow(vv, 1.8) * sn * sn - 0.03 * vv * c * c;
      if (S.slope) y -= S.slope * vv + 0.012 * vv * vv;
      if (S.droop) y -= S.droop * Math.pow(vv, 1.6) - S.wave * Math.sin(7 * a) * vv * vv;
      return y;
    });
    if (!lod && kind === "campaign" && v === "sheriff") {
      const p = wall[2][0], n = V.norm([0, 0.25, 1]);
      emblem(P("metal"), "star", V.add(p, [0, 0, 0.004]), n, 0.045, 0.007);
    }
    return { P, cover: { band: bandY, room: () => HA_HAIR } };
  }

  function buildHardhat(lod, form) {
    const H = Head(form), P = parts(), seg = Q(lod, 40, 20);
    const B = band([[0, 0.49], [1.57, 0.462], [PI, 0.44]]);
    const G = crownGrid(H, {
      seg, rowsT: Q(lod, [0, 0.08, 0.2, 0.34, 0.48, 0.62, 0.76, 0.88, 1], [0, 0.3, 0.6, 1]), band: B,
      off(a, t, p) {
        let o = 0.046 + 0.014 * sm01(t * 1.4);
        o += 0.017 * Math.exp(-(p[0] / 0.055) * (p[0] / 0.055)) * sm01(t * 2.5);               // the crown ridge
        o += 0.007 * Math.exp(-Math.pow((Math.abs(p[0]) - 0.15) / 0.035, 2)) * sm01((t - 0.2) * 3); // side ribs
        return o;
      },
    });
    addGrid(P("main"), G, true, HINT_OUT);
    // the brim: a peak at the front, a narrow lip all round
    const inner = G[0].map((p, i) => V.add(p, [0, 0.003, 0]));
    brim(P, inner, function (i) {
      const a = i / seg * TAU, c = Math.cos(a), p = inner[i], r = Math.hypot(p[0], p[2]);
      const reach = 0.026 + 0.1 * Math.pow(Math.max(0, c), 2.2);
      return [Math.sin(a) * (r + reach), 0, Math.cos(a) * (r + reach)];
    }, Q(lod, 4, 3), true, 0.012, { top: "main", bottom: "under", edge: "main" }, function (i, vv, pi) {
      const c = Math.cos(i / seg * TAU);
      return pi[1] - vv * (0.018 * Math.max(0, c) + 0.006);
    });
    // the suspension headband you see under the rim
    const pts = [], nr = [];
    for (let i = 0; i < seg; i++) {
      const a = i / seg * TAU, y = B(a) - 0.004, r = H.ring(a, y) + HA;
      pts.push([Math.sin(a) * r, y, Math.cos(a) * r]); nr.push([Math.sin(a), 0, Math.cos(a)]);
    }
    tube(P("trim"), pts, nr, 0.032, 0.006, true, 4);
    return { P, cover: { band: B, room: () => HA + 0.02 } };
  }

  function buildBeanie(lod, form) {
    const H = Head(form, { ears: true }), P = parts();
    const seg = Q(lod, 56, 24), ribs = 28;
    const B = band([[0, 0.458], [1.1, 0.41], [1.6, 0.33], [2.3, 0.275], [PI, 0.258]]);
    const tc = 0.24;
    const G = crownGrid(H, {
      seg, rowsT: Q(lod, [0, 0.03, 0.1, 0.17, 0.225, tc, tc + 0.012, 0.34, 0.46, 0.58, 0.7, 0.8, 0.9, 1], [0, tc, tc + 0.02, 0.5, 0.75, 1]), band: B,
      off(a, t) {
        let o = O_SOFT + 0.003 + 0.006 * t;
        const rib = lod ? 0 : Math.cos(ribs * a);
        if (t <= tc + 1e-6) o += 0.012 + 0.0024 * rib + 0.004 * Math.sin(PI * t / tc);   // the folded, ribbed cuff
        else o += 0.0012 * rib * (1 - sm01((t - 0.8) * 5));
        o += 0.022 * sm01((t - 0.45) * 2) * Math.max(0, -Math.cos(a)) * 0.8;             // a little slouch at the back
        return o;
      },
    });
    addGrid(P("main"), G, true, HINT_OUT);
    lipUnder(P("main"), H, G, 0.0012);
    return { P, cover: { band: B, room: () => HA_HAIR } };
  }

  function buildBeret(lod, form, v) {
    const H = Head(form), P = parts(), seg = Q(lod, 44, 22);
    const B = band([[0, 0.492], [1.57, 0.44], [PI, 0.405]]);
    // the body: a flat soft disc pulled down over the wearer's right (-x)
    const E = [HC[0] - 0.085, HC[1] + 0.25, HC[2] - 0.01], ER = [0.42, 0.10, 0.39], tilt = 0.32;
    const ct = Math.cos(tilt), st = Math.sin(tilt);
    const exitE = (d) => {
      // ray HC + d t against the tilted ellipsoid: rotate into its frame (about z)
      const ox = HC[0] - E[0], oy = HC[1] - E[1], oz = HC[2] - E[2];
      const rx = (x, y) => [x * ct + y * st, -x * st + y * ct];
      const [ox2, oy2] = rx(ox, oy), [dx2, dy2] = rx(d[0], d[1]);
      const A = (dx2 / ER[0]) ** 2 + (dy2 / ER[1]) ** 2 + (d[2] / ER[2]) ** 2;
      const Bq = 2 * (ox2 * dx2 / ER[0] ** 2 + oy2 * dy2 / ER[1] ** 2 + oz * d[2] / ER[2] ** 2);
      const C = (ox2 / ER[0]) ** 2 + (oy2 / ER[1]) ** 2 + (oz / ER[2]) ** 2 - 1;
      const D = Bq * Bq - 4 * A * C;
      if (D < 0) return 0;
      return (-Bq + Math.sqrt(D)) / (2 * A);
    };
    const G = crownGrid(H, {
      seg, rowsT: Q(lod, [0, 0.05, 0.14, 0.26, 0.4, 0.55, 0.7, 0.85, 1], [0, 0.2, 0.5, 1]), band: B,
      radial(a, t, d, R) {
        const band0 = R + O_SOFT + 0.004;
        const body = exitE(d);
        const w = sm01(t / 0.16);
        return Math.max(band0, lerp(band0, body, w));
      },
    });
    addGrid(P("main"), G, true, HINT_OUT);
    lipUnder(P("trim"), H, G, 0.0012);
    // the leather edging round the head
    const pts = [], nr = [];
    for (let i = 0; i < seg; i++) {
      const a = i / seg * TAU, pr = H.project(H.hitAE(a, H.bandE(a, B(a) + 0.009)), O_SOFT);
      pts.push(pr.p); nr.push(pr.n);
    }
    tube(P("trim"), pts, nr, 0.024, 0.006, true, 4);
    if (!lod && v !== "plain") {
      // the cap badge over the left eye, on the stiffened front
      const a = 0.45, row = G[2], i = Math.round(a / TAU * seg);
      const p = row[i], n = V.norm(V.sub(p, HC));
      emblem(P("metal"), "crest", V.add(p, V.mul(n, 0.002)), n, 0.038, 0.008);
    }
    return { P, cover: { band: B, room: () => HA_HAIR } };
  }

  function buildDurag(lod, form) {
    const H = Head(form, { ears: true }), P = parts(), seg = Q(lod, 48, 24);
    const B = band([[0, 0.515], [1.0, 0.47], [1.57, 0.405], [2.4, 0.24], [PI, 0.175]]);
    const G = crownGrid(H, {
      seg, rowsT: Q(lod, linRows(15), linRows(6)), band: B,
      off(a, t, p) { return HA + 0.0028 + (lod ? 0 : 0.0022 * Math.exp(-(p[0] / 0.012) * (p[0] / 0.012)) * sm01(t * 3)); },
    });
    addGrid(P("main"), G, true, HINT_OUT);
    lipUnder(P("main"), H, G, 0.0012);
    // the ties: round the head over the forehead, crossing at the back
    const pts = [], nr = [];
    const TB = band([[0, 0.53], [1.57, 0.43], [PI, 0.3]]);
    for (let i = 0; i < seg; i++) {
      const a = i / seg * TAU, pr = H.project(H.hitAE(a, H.bandE(a, TB(a))), HA + 0.0055);
      pts.push(pr.p); nr.push(pr.n);
    }
    tube(P("main"), pts, nr, 0.034, 0.004, true, 4);
    // the flap down the back of the neck, and the two tie tails
    const Hn = Head(form, { neck: true });
    const flap = [];
    for (let j = 0; j < 5; j++) {
      const v = j / 4, y = lerp(0.2, -0.02, v), row = [];
      for (let i = 0; i < 7; i++) {
        const u = i / 6 * 2 - 1, a = PI + u * lerp(0.62, 0.42, v);
        const r = Math.max(Hn.ring(a, y), 0.14) + 0.012 + 0.012 * v;
        row.push([Math.sin(a) * r, y, Math.cos(a) * r]);
      }
      flap.push(row);
    }
    slab(P, flap, false, 0.006, (i, j, p) => [p[0], 0, p[2]], { top: "main", bottom: "main", edge: "main" });
    if (!lod) for (const s of [-1, 1]) {
      const tp = [], tn = [];
      for (let k = 0; k <= 5; k++) {
        const v = k / 5, a = PI + s * 0.12 + s * 0.1 * v, y = lerp(0.3, 0.06, v);
        const r = Math.max(Hn.ring(a, y), 0.14) + 0.03 + 0.01 * v;
        tp.push([Math.sin(a) * r, y, Math.cos(a) * r]); tn.push([Math.sin(a), 0, Math.cos(a)]);
      }
      tube(P("tail"), tp, tn, 0.032, 0.004, false, 4);
    }
    // a durag is worn over short hair, waves or braids: it takes all of it
    return { P, cover: { band: (a) => B(a) - 0.3, rim: B, room: () => HA_HAIR, hideLong: true } };
  }

  function buildBandana(lod, form) {
    // a square tied over the head: tight crown, a knot and two tails at the back
    const H = Head(form), P = parts(), seg = Q(lod, 44, 22);
    const B = band([[0, 0.505], [1.57, 0.418], [PI, 0.33]]);
    const G = crownGrid(H, {
      seg, rowsT: Q(lod, linRows(9), linRows(4)), band: B,
      off(a, t) { return O_SOFT - 0.001 + (lod ? 0 : 0.0018 * Math.sin(5 * a + 9 * t) * sm01(t * 3) * (1 - t)); },
    });
    addGrid(P("main"), G, true, HINT_OUT);
    lipUnder(P("main"), H, G, 0.0012);
    const kn = H.project([0, B(PI) + 0.01, -0.4], O_SOFT + 0.012);
    ellipsoidPart(P("main"), kn.p, kn.n, [0, 1, 0], 0.042, 0.03, 0.022, 8);
    const Hn = Head(form, { neck: true });
    for (const s of [-1, 1]) {
      const tp = [], tn = [];
      for (let k = 0; k <= 4; k++) {
        const v = k / 4, a = PI + s * (0.1 + 0.28 * v), y = lerp(kn.p[1], kn.p[1] - 0.14, v);
        const r = Math.max(Hn.ring(a, y), 0.15) + 0.03 + 0.012 * v;
        tp.push([Math.sin(a) * r, y, Math.cos(a) * r]); tn.push([Math.sin(a), 0, Math.cos(a)]);
      }
      tube(P("tail"), tp, tn, (u) => lerp(0.05, 0.03, u), 0.005, false, 4);
    }
    return { P, cover: { band: B, room: () => HA_HAIR } };
  }

  function buildHeadband(lod, form) {
    // a rolled bandana across the forehead: the hair shows above it
    const H = Head(form), P = parts(), seg = Q(lod, 40, 20);
    const B = band([[0, 0.49], [1.57, 0.445], [PI, 0.415]]);
    const pts = [], nr = [];
    for (let i = 0; i < seg; i++) {
      const a = i / seg * TAU, pr = H.project(H.hitAE(a, H.bandE(a, B(a))), HA + 0.006);
      pts.push(pr.p); nr.push(pr.n);
    }
    tube(P("main"), pts, nr, 0.05, 0.02, true, 8);
    const kn = H.project([0.08, B(PI - 0.3), -0.4], HA + 0.02);
    ellipsoidPart(P("main"), kn.p, kn.n, [0, 1, 0], 0.03, 0.026, 0.02, 8);
    const Hn = Head(form, { neck: true });
    for (const s of [-1, 1]) {
      const tp = [], tn = [];
      for (let k = 0; k <= 4; k++) {
        const v = k / 4, a = PI - 0.25 + s * 0.14 * v, y = lerp(kn.p[1], kn.p[1] - 0.15, v);
        const r = Math.max(Hn.ring(a, y), 0.15) + 0.04 + 0.01 * v;
        tp.push([Math.sin(a) * r, y, Math.cos(a) * r]); tn.push([Math.sin(a), 0, Math.cos(a)]);
      }
      tube(P("tail"), tp, tn, (u) => lerp(0.04, 0.026, u), 0.005, false, 4);
    }
    return { P, cover: { slice: [(a) => B(a) - 0.03, (a) => B(a) + 0.03], room: () => HA + 0.004 } };
  }

  /* THE TURBAN: a length of cloth WOUND round the head, not a cap. Under it a
     full body of cloth (the "under" shell, darker, which is all that shows in
     the creases between passes) standing well above the skull and peaking at
     the front; on it, the passes themselves: ribbons each laid a little
     proud of the one below (upper passes overlap lower ones like shingles),
     rising from the nape to the forehead, alternately crossing left and
     right across the front so they meet in the front V, and the last end
     run diagonally up the left side and tucked in. Each pass has a rounded,
     heavier lower edge (the fold) and a thin upper edge that runs under the
     next pass, so the shading reads as cloth. It sits low on the forehead
     and over the tops of the ears. */
  function buildTurban(lod, form) {
    const H = Head(form, { ears: true }), P = parts(), seg = Q(lod, 56, 24);
    const B = band([[0, 0.468], [1.0, 0.44], [1.6, 0.372], [2.3, 0.27], [PI, 0.22]]);
    // the cloth body's outer surface, as a radius from HC along (a, t)
    const bodyR = (a, t, R) => R + 0.02 + 0.046 * sm01(t * 1.3)
      + 0.036 * Math.pow(Math.max(0, Math.cos(a)), 1.5) * sm01((t - 0.1) * 2.2) * (1 - sm01((t - 0.72) * 3.5));
    const G = crownGrid(H, { seg, rowsT: Q(lod, linRows(14), linRows(6)), band: B, radial: (a, t, d, R) => bodyR(a, t, R) });
    addGrid(P("under"), G, true, HINT_OUT);
    lipUnder(P("under"), H, G, 0.0012);
    // a point on (or `off` proud of) the cloth body at azimuth a, row t
    const ebA = (a) => H.bandE(a, B(a));
    const eb = []; for (let i = 0; i < seg; i++) eb.push(ebA(i / seg * TAU));
    const at = (a, e0, t, off) => {
      t = cl01(t);
      const d = H.dirAE(a, e0 + (PI / 2 - 0.002 - e0) * t), r = bodyR(a, t, H.hitDir(d)) + off;
      return [HC[0] + d[0] * r, HC[1] + d[1] * r, HC[2] + d[2] * r];
    };
    // a pass's cross-section: heavy rounded fold below (u = -1), thin above;
    // both edges run just under the body so no raw edge ever shows
    const prof = (u, lift) => -0.003 + (0.0105 + lift) * Math.pow(Math.max(0, 1 - u * u), 0.5) * (1 - 0.45 * u);
    const NF = Q(lod, 7, 4), dc = Q(lod, 0.1, 0.17), wt = Q(lod, 0.075, 0.1);
    const across = Q(lod, [-1, -0.8, -0.45, 0, 0.5, 1], [-1, -0.3, 1]);
    for (let k = 0; k < NF; k++) {
      const sg = k % 2 ? -1 : 1, c0 = 0.1 + k * dc;
      // the centre line: level with the band, a touch higher over the brow,
      // and across the front it climbs to one side (alternating), so
      // neighbouring passes cross in an X and stack into the front V
      const tc = (a) => c0 + 0.06 * Math.cos(a) + sg * 0.28 * Math.sin(a) * Math.exp(-(a / 0.9) * (a / 0.9));
      const Gk = across.map((u) => {
        const row = [];
        for (let i = 0; i < seg; i++) {
          const a = wrapA(i / seg * TAU);
          row.push(at(a, eb[i], Math.min(0.93, Math.max(0.004, tc(a) + u * wt)), prof(u, k * 0.0022)));
        }
        return row;
      });
      addGrid(P("main"), Gk, true, HINT_OUT);
    }
    if (!lod) {
      // the tucked end: the last pass leaves the wrap on the left, runs up
      // across the others and is pushed in under them
      const cols = 10, T = [];
      for (const u of [-1, -0.4, 0.3, 1]) {
        const row = [];
        for (let s = 0; s < cols; s++) {
          const v = s / (cols - 1), a = lerp(-0.55, -1.75, v), t0 = lerp(0.42, 0.8, v);
          const w = 0.06 * lerp(1, 0.35, v), fade = Math.pow(Math.sin(PI * lerp(0.06, 1, v)), 0.6);
          row.push(at(a, ebA(a), t0 + u * w, -0.003 + (prof(u, NF * 0.0022) + 0.006) * fade));
        }
        T.push(row);
      }
      addGrid(P("main"), T, false, HINT_OUT);
    }
    return { P, cover: { band: B, room: () => HA + 0.01 } };
  }

  function buildShemagh(lod, form, v) {
    // the wrap over the crown, cloth hanging beside the face and down the
    // back of the neck; the agal cord when there is an accent; a face cloth
    // when v === "veil"
    const H = Head(form, { ears: true }), P = parts(), seg = Q(lod, 48, 24);
    const B = band([[0, 0.492], [1.2, 0.445], [1.57, 0.41], [PI, 0.37]]);
    const G = crownGrid(H, {
      seg, rowsT: Q(lod, linRows(10), linRows(4)), band: B,
      radial(a, t, d, R) {
        return R + 0.02 + 0.016 * sm01(t) + (lod ? 0 : 0.005 * Math.sin(7 * a + 11 * t) * sm01(t * 4) * (1 - t));
      },
    });
    addGrid(P("main"), G, true, HINT_OUT);
    lipUnder(P("main"), H, G, 0.0012);
    // the drape: from the band at the temples round the back, hanging
    const Hc = Head(form, { ears: true, neck: true });
    const i0 = Math.round(1.12 / TAU * seg), n = seg - 2 * i0 + 1;
    const rows = Q(lod, 6, 3), M = [];
    for (let j = 0; j < rows; j++) {
      const vv = j / (rows - 1), row = [];
      for (let k = 0; k < n; k++) {
        const i = (i0 + k) % seg, a = i / seg * TAU, top = G[0][i];
        const yb = lerp(0.08, -0.02, Math.max(0, -Math.cos(a)));
        const y = lerp(top[1] + 0.01, yb, vv);
        const r0 = Math.hypot(top[0], top[2]) + 0.004;
        let r = lerp(r0, r0 + 0.03 + 0.025 * Math.max(0, -Math.cos(a)), vv) + (lod ? 0 : 0.01 * Math.sin(9 * a) * vv * vv);
        r = Math.max(r, Hc.ring(a, y) + 0.016);
        row.push([Math.sin(a) * r, y, Math.cos(a) * r]);
      }
      M.push(row);
    }
    slab(P, M, false, 0.008, (i, j, p) => [p[0], 0, p[2]], { top: "main", bottom: "under", edge: "main" });
    if (v === "agal") {
      for (const dy of [0.02, 0.05]) {
        const pts = [], nr = [];
        for (let i = 0; i < seg; i++) {
          const a = i / seg * TAU, row = G[2][i], nn = V.norm(V.sub(row, HC));
          pts.push(V.add(row, [0, dy, 0])); nr.push(nn);
        }
        tube(P("trim"), pts, nr, 0.02, 0.016, true, 6);
      }
    }
    if (v === "veil") {
      const Hf = Head(form, { nose: true, neck: true }), cols = Q(lod, 17, 9), vr = Q(lod, 6, 3), F = [];
      for (let j = 0; j < vr; j++) {
        const y = lerp(0.275, -0.01, j / (vr - 1)), row = [];
        for (let i = 0; i < cols; i++) {
          const a = (i / (cols - 1) * 2 - 1) * 1.3;
          const r = Math.max(Hf.ring(a, y), 0.12) + 0.02 + 0.012 * (j / (vr - 1));
          row.push([Math.sin(a) * r, y, Math.cos(a) * r]);
        }
        F.push(row);
      }
      slab(P, F, false, 0.007, (i, j, p) => [p[0], 0, p[2]], { top: "under", bottom: "under", edge: "under" });
    }
    // the drape hangs over the sides and the nape: the hair there goes under it
    return { P, cover: { band: band([[0, 0.492], [0.95, 0.44], [1.2, 0.12], [PI, -0.02]]), rim: B, room: () => HA_HAIR + 0.004, hideBeard: v === "veil" } };
  }

  function buildHijab(lod, form) {
    // one shell round the whole head from the face opening back, over the
    // ears and under the chin, flaring over the neck onto the shoulders
    const F = formOf(form), P = parts();
    const C2 = [0, 0.25, -0.02];
    const sdf = (x, y, z) => {
      let d = skullSdf(F, x, y, z);
      d = smin(d, earSdf(F, x, y, z), 0.03);
      d = Math.min(d, neckSdf(F, x, y, z)) - 0.022;
      // the drape volume under the jaw, flaring to the shoulders
      const ry = 0.2 + Math.max(0, 0.06 - y) * 0.9;
      const cone = Math.max(Math.hypot(x, (z + 0.02) * 1.05) - ry, y - 0.06, -0.12 - y);
      return smin(d, cone, 0.05);
    };
    const cast = (d) => { let lo = 0, hi = 0.9; for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2; if (sdf(C2[0] + d[0] * m, C2[1] + d[1] * m, C2[2] + d[2] * m) < 0) lo = m; else hi = m; } return hi; };
    const dirTP = (th, ph) => [Math.sin(th) * Math.cos(ph), Math.sin(th) * Math.sin(ph), Math.cos(th)];
    const pt = (th, ph) => { const d = dirTP(th, ph), t = cast(d); return [C2[0] + d[0] * t, C2[1] + d[1] * t, C2[2] + d[2] * t]; };
    const inOpen = (p) => p[2] > 0 && (p[0] / 0.228) ** 2 + ((p[1] - 0.285) / 0.265) ** 2 < 1;
    const seg = Q(lod, 44, 22), rows = Q(lod, 16, 7), G = [];
    const th0 = [];
    for (let i = 0; i < seg; i++) {
      const ph = i / seg * TAU;
      let lo = 0.01, hi = PI / 2 + 0.3;
      for (let k = 0; k < 22; k++) { const m = (lo + hi) / 2; if (inOpen(pt(m, ph))) lo = m; else hi = m; }
      th0.push(hi);
    }
    for (let j = 0; j <= rows; j++) {
      const row = [];
      for (let i = 0; i < seg; i++) {
        const ph = i / seg * TAU, th = lerp(th0[i], PI - 0.002, j / rows);
        let p = pt(th, ph);
        // the hem: anything under the drape's bottom edge folds onto it
        if (p[1] < -0.115) { const r = 0.2 + 0.18 * 0.9, h = Math.atan2(p[0], p[2] + 0.02); p = [Math.sin(h) * r, -0.115, Math.cos(h) * r / 1.05 - 0.02]; }
        row.push(p);
      }
      G.push(row);
    }
    addGrid(P("main"), G, true, outFrom(C2));
    // the tucked edge round the face
    const H = Head(form, { ears: true, neck: true });
    addGrid(P("under"), [G[0], G[0].map((p) => H.project(p, 0.002).p)], true, () => [0, 0, 1]);
    return { P, cover: { hide: true, hideBeard: true } };
  }

  /* ---- HELMETS --------------------------------------------------------- */
  const MICH_RIM = band([[0, 0.474], [0.7, 0.458], [1.05, 0.432], [1.35, 0.418], [1.62, 0.425], [1.9, 0.392], [2.15, 0.31], [2.5, 0.245], [PI, 0.228]]);
  function chinstrap(P, H, rim, lod, o) {
    // a harness: a front and a rear strap from the rim down past the ear to a
    // buckle at the jaw angle, then under the jaw to a cup on the chin
    const Hs = Head(H.form, { neck: true, ears: true });
    const J = (s) => Hs.project([s * 0.3, 0.13, 0.02], 0.006);
    const cup = Hs.project([0, -0.015, 0.215], 0.006);
    for (const s of [-1, 1]) {
      const legs = [];
      const aF = s * (o && o.frontA || 1.3), aR = s * 2.25;
      legs.push([Hs.project(H.hitAE(aF, H.bandE(aF, rim(aF) + 0.012)), 0.006), Hs.project([s * 0.33, 0.27, 0.08], 0.006), J(s)]);
      if (!o || !o.single) legs.push([Hs.project(H.hitAE(aR, H.bandE(aR, rim(aR) + 0.012)), 0.006), Hs.project([s * 0.27, 0.17, -0.1], 0.006), J(s)]);
      legs.push([J(s), Hs.project([s * 0.24, 0.03, 0.13], 0.006), Hs.project([s * 0.1, -0.012, 0.2], 0.006), cup]);
      for (const L of legs) {
        const pts = [], nr = [];
        const steps = lod ? 4 : 8;
        for (let k = 0; k <= steps; k++) {
          const f = k / steps * (L.length - 1), i = Math.min(L.length - 2, Math.floor(f)), t = f - i;
          const aim = V.lerp(L[i].p, L[i + 1].p, t);
          const pr = Hs.project(aim, 0.005);
          pts.push(pr.p); nr.push(pr.n);
        }
        tube(P("strap"), pts, nr, 0.024, 0.005, false, 4);
      }
      if (!lod) { const j = J(s); boxPart(P("hard"), j.p, j.n, [0, 1, 0], 0.036, 0.03, 0.01); }
    }
    if (!lod) ellipsoidPart(P("strap"), V.add(cup.p, V.mul(cup.n, 0.009)), cup.n, [1, 0, 0], 0.05, 0.034, 0.011, 8);
  }
  function buildBallistic(lod, form, v) {
    // MICH / ACH high-cut: stands off on its pads, cut up over the ears,
    // rubber edging, ARC rails, the NVG shroud, a harness chinstrap
    const H = Head(form, { ears: true }), P = parts(), seg = Q(lod, 48, 24);
    H.form = form;
    const off = (t) => 0.058 + 0.014 * sm01(t * 1.4);
    const rowsT = Q(lod, [0, 0.035, 0.07, 0.16, 0.28, 0.42, 0.56, 0.7, 0.84, 1], [0, 0.07, 0.35, 0.7, 1]);
    const G = crownGrid(H, { seg, rowsT, band: MICH_RIM, off: (a, t) => off(t) });
    // edging: the first two rows, a hair proud
    const edge = G.slice(0, 3).map((r, j) => r.map((p) => j === 1 ? V.add(p, V.mul(V.norm(V.sub(p, HC)), 0.003)) : p));
    addGrid(P("trim"), edge, true, HINT_OUT);
    addGrid(P("main"), G.slice(2), true, HINT_OUT);
    lipUnder(P("trim"), H, G, 0.0045);
    if (!lod) {
      // ARC rails along each side
      for (const s of [-1, 1]) {
        const pts = [], nr = [];
        for (let k = 0; k <= 10; k++) {
          const a = s * lerp(0.95, 2.3, k / 10), e = H.bandE(a, MICH_RIM(a));
          const ee = e + (PI / 2 - e) * 0.13;
          const p = H.hitAE(a, ee), n = H.normal(p);
          pts.push(V.add(p, V.mul(n, off(0.13) + 0.002))); nr.push(n);
        }
        tube(P("hard"), pts, nr, 0.03, 0.016, false, 4);
      }
      // the NVG shroud: a conforming plate on the front, a mount block below
      const plate = [];
      for (let j = 0; j < 3; j++) {
        const row = [];
        for (let i = 0; i < 5; i++) {
          const a = (i / 4 * 2 - 1) * 0.24, e0 = H.bandE(a, MICH_RIM(a));
          const e = e0 + (PI / 2 - e0) * lerp(0.035, 0.2, j / 2);
          const p = H.hitAE(a, e), n = H.normal(p);
          row.push(V.add(p, V.mul(n, off(0.1) + 0.006)));
        }
        plate.push(row);
      }
      slab(P, plate, false, 0.008, (i, j, p) => V.sub(p, HC), { top: "hard", bottom: "hard", edge: "hard" });
      const mp = plate[0][2], mn = V.norm(V.sub(mp, HC));
      boxPart(P("hard"), V.add(mp, [0, 0.012, 0]), mn, [0, 1, 0], 0.07, 0.045, 0.036);
      // velcro patch up top
      const e1 = H.bandE(0, MICH_RIM(0)), vp = H.hitAE(0, e1 + (PI / 2 - e1) * 0.62), vn = H.normal(vp);
      boxPart(P("under"), V.add(vp, V.mul(vn, off(0.62) - 0.002)), vn, [0, 0, -1], 0.13, 0.07, 0.006);
      if (v === "swat") {
        const eb = H.bandE(PI, MICH_RIM(PI)), bp = H.hitAE(PI, eb + (PI / 2 - eb) * 0.2), bn = H.normal(bp);
        boxPart(P("hard"), V.add(bp, V.mul(bn, off(0.2) - 0.004)), bn, [0, 1, 0], 0.15, 0.1, 0.05);
      }
    }
    chinstrap(P, H, MICH_RIM, lod);
    return { P, cover: { band: MICH_RIM, room: () => HA + 0.035 } };
  }
  function buildPasgt(lod, form) {
    // the older full-cut "K-pot": low over the ears, a brow lip, a flared skirt
    const H = Head(form, { ears: true }), P = parts(), seg = Q(lod, 48, 24);
    H.form = form;
    const RIM = band([[0, 0.482], [0.55, 0.479], [0.95, 0.446], [1.57, 0.27], [2.3, 0.22], [PI, 0.2]]);
    const G = crownGrid(H, {
      seg, rowsT: Q(lod, [0, 0.05, 0.12, 0.24, 0.38, 0.52, 0.66, 0.8, 1], [0, 0.12, 0.45, 1]), band: RIM,
      off(a, t) {
        const brow = Math.pow(Math.max(0, Math.cos(a)), 3);
        return 0.062 + 0.012 * sm01(t * 1.4) + (0.03 - 0.018 * brow) * (1 - sm01(t * 4)) + 0.014 * brow * (1 - sm01(t * 5));
      },
    });
    addGrid(P("main"), G, true, HINT_OUT);
    lipUnder(P("under"), H, G, 0.0045);
    chinstrap(P, H, RIM, lod, { single: true, frontA: 1.45 });
    return { P, cover: { band: RIM, room: () => HA + 0.02 } };
  }
  let _clearMat = null;
  function clearMat() {
    if (_clearMat) return _clearMat;
    _clearMat = new THREE.MeshPhongMaterial({ color: 0xc8dde8, specular: 0xffffff, shininess: 90, transparent: true, opacity: 0.28, depthWrite: false });
    _clearMat._shared = true;
    return _clearMat;
  }
  /* A full-face visor is tinted glass, not paint: dark smoke (moto) or a blue
     iridium mirror (race), glossy, and see-through so the rider's face reads
     behind it. Only its outward face draws (FrontSide), so this opacity is
     the whole tint. Transparent, so the crowd instancer leaves it a real
     mesh (pedinstance poolable() refuses transparent) like the riot shield. */
  const _visor = {};
  function visorMat(kind) {
    if (_visor[kind]) return _visor[kind];
    const m = kind === "iridium"
      ? new THREE.MeshPhongMaterial({ color: 0x2a3f6e, specular: 0x9fc4ff, shininess: 120, transparent: true, opacity: 0.5, depthWrite: false })
      : new THREE.MeshPhongMaterial({ color: 0x0c0e12, specular: 0xffffff, shininess: 110, transparent: true, opacity: 0.42, depthWrite: false });
    m._shared = true;
    return (_visor[kind] = m);
  }
  const SEE_THROUGH = { smoke: 1, accent2: 1, clear: 1 };
  function buildRiot(lod, form) {
    const H = Head(form, { ears: true }), P = parts(), seg = Q(lod, 48, 24);
    const RIM = band([[0, 0.478], [1.0, 0.44], [1.5, 0.3], [2.1, 0.215], [PI, 0.195]]);
    const off = (t) => 0.062 + 0.012 * sm01(t * 1.4);
    const G = crownGrid(H, { seg, rowsT: Q(lod, [0, 0.05, 0.14, 0.26, 0.4, 0.55, 0.7, 0.85, 1], [0, 0.14, 0.5, 1]), band: RIM, off: (a, t) => off(t) });
    addGrid(P("main"), G, true, HINT_OUT);
    lipUnder(P("trim"), H, G, 0.0045);
    // the face shield: a clear sheet from the brow to below the chin
    const cols = Q(lod, 17, 9), rows = Q(lod, 7, 4), M = [];
    const vr = (a, y) => { const rx = 0.415, rz = 0.45 + 0.03 * cl01((0.45 - y) / 0.45), c = Math.cos(a), s = Math.sin(a); return 1 / Math.sqrt((s * s) / (rx * rx) + (c * c) / (rz * rz)); };
    for (let j = 0; j < rows; j++) {
      const y = lerp(0.515, -0.03, j / (rows - 1)), row = [];
      for (let i = 0; i < cols; i++) { const a = (i / (cols - 1) * 2 - 1) * 1.36, r = vr(a, y); row.push([Math.sin(a) * r, y, Math.cos(a) * r - 0.01]); }
      M.push(row);
    }
    slab(P, M, false, 0.006, (i, j, p) => [p[0], 0, p[2]], { top: "clear", bottom: "clear", edge: "hard" });
    // the brow seal from the shield's top edge back to the shell, and the pivots
    const seal = [M[0].map((p) => V.add(p, [0, 0.004, 0])), M[0].map((p) => {
      const a = Math.atan2(p[0], p[2]), r = H.ring(a, 0.52) + off(0.05);
      return [Math.sin(a) * r, 0.52, Math.cos(a) * r];
    })];
    addGrid(P("hard"), seal, false, () => [0, 1, 0]);
    for (const s of [-1, 1]) {
      const a = s * 1.36, p = [Math.sin(a) * vr(a, 0.44), 0.44, Math.cos(a) * vr(a, 0.44) - 0.01];
      addGeo(P("hard"), new THREE.CylinderGeometry(0.035, 0.035, 0.02, 10), frameAt(p, [Math.sin(a), 0, Math.cos(a)], [0, 1, 0], 1, 1, 1).multiply(new THREE.Matrix4().makeRotationX(PI / 2)));
    }
    // the neck curtain
    const Hn = Head(form, { neck: true }), NC = [];
    for (let j = 0; j < 3; j++) {
      const vv = j / 2, row = [];
      for (let i = 0; i < 11; i++) {
        const a = PI + (i / 10 * 2 - 1) * 1.1, top = G[0][Math.round(a / TAU * seg) % seg];
        const y = lerp(top[1] + 0.01, 0.03, vv), r = Math.max(Math.hypot(top[0], top[2]) - 0.01 + 0.03 * vv, Hn.ring(a, y) + 0.03);
        row.push([Math.sin(a) * r, y, Math.cos(a) * r]);
      }
      NC.push(row);
    }
    slab(P, NC, false, 0.008, (i, j, p) => [p[0], 0, p[2]], { top: "under", bottom: "under", edge: "under" });
    return { P, cover: { band: RIM, room: () => HA + 0.02 } };
  }
  function buildFullface(lod, form, kind) {
    // moto / race: a closed shell round the whole head with a chin bar, an
    // OPEN eye port (the shell is cut there and a rubber gasket lines the cut)
    // under a tinted see-through visor, a padded neck roll. The port used to be
    // solid shell under an opaque visor: a rider had no face.
    const P = parts(), seg = Q(lod, 48, 24), race = kind === "race";
    const Cm = [0, 0.29, 0.015], R3 = race ? [0.382, 0.402, 0.425] : [0.39, 0.41, 0.435], pw = 2.5;
    const rS = (d) => Math.pow(Math.pow(Math.abs(d[0] / R3[0]), pw) + Math.pow(Math.abs(d[1] / R3[1]), pw) + Math.pow(Math.abs(d[2] / R3[2]), pw), -1 / pw);
    const dirAE = (a, e) => { const ce = Math.cos(e); return [Math.sin(a) * ce, Math.sin(e), Math.cos(a) * ce]; };
    const at = (a, e, extra) => { const d = dirAE(a, e), r = rS(d) + (extra || 0); return [Cm[0] + d[0] * r, Cm[1] + d[1] * r, Cm[2] + d[2] * r]; };
    const RIM = band([[0, -0.045], [1.2, -0.005], [1.8, 0.03], [PI, 0.075]]);
    const eAt = (a, y) => { let lo = -1.5, hi = 1.4; for (let k = 0; k < 26; k++) { const m = (lo + hi) / 2; if (at(a, m)[1] < y) lo = m; else hi = m; } return (lo + hi) / 2; };
    // the port: azimuth -aw..aw, height y0..y1. Columns land exactly on its
    // sides and rows on its sill and brow, so the cut is clean and the visor
    // is the same lattice lifted off the shell.
    const aw = race ? 1.12 : 1.02, y0 = race ? 0.272 : 0.278, y1 = race ? 0.472 : 0.462;
    const np = Q(lod, 16, 8), vr = Q(lod, 5, 3), nLo = Q(lod, 4, 2), nHi = Q(lod, 6, 3);
    const A = [];
    for (let i = 0; i < seg; i++) A.push(i <= np ? -aw + i * 2 * aw / np : aw + (i - np) * (TAU - 2 * aw) / (seg - np));
    const eRim = A.map((a) => eAt(a, RIM(a))), eLo = A.map((a) => eAt(a, y0)), eHi = A.map((a) => eAt(a, y1));
    const G = [];
    for (let j = 0; j <= nLo; j++) G.push(A.map((a, i) => at(a, lerp(eRim[i], eLo[i], j / nLo))));
    for (let j = 1; j < vr; j++) G.push(A.map((a) => at(a, eAt(a, lerp(y0, y1, j / (vr - 1))))));
    for (let j = 1; j <= nHi; j++) G.push(A.map((a, i) => at(a, lerp(eHi[i], PI / 2 - 0.002, Math.pow(j / nHi, 0.85)))));
    const jP0 = nLo, jP1 = nLo + vr - 1;
    addGrid(P("main"), G, true, outFrom(Cm), (i, j) => i < np && j >= jP0 && j < jP1);
    // the gasket: the cut edge turned in toward the face, so the shell reads
    // as a shell (it has a thickness) and nothing is seen past its edge
    const edge = [];
    for (let i = 0; i <= np; i++) edge.push(G[jP0][i]);
    for (let j = jP0 + 1; j <= jP1; j++) edge.push(G[j][np]);
    for (let i = np - 1; i >= 0; i--) edge.push(G[jP1][i]);
    for (let j = jP1 - 1; j > jP0; j--) edge.push(G[j][0]);
    const pc = at(0, eAt(0, (y0 + y1) / 2), -0.08);
    const gIn = edge.map((p) => V.add(p, V.mul(V.norm(V.sub(Cm, p)), 0.026)));
    addGrid(P("trim"), [edge, gIn], true, (i, j, p) => V.sub(pc, p));
    // the neck roll: from the rim in to the padding round the neck
    const Hc = Head(form, { neck: true, ears: true });
    const inner = G[0].map((p, i) => {
      const a = A[i], y = p[1] + 0.012;
      const r = Math.max(Math.hypot(Math.sin(a) * 0.235, Math.cos(a) * 0.255 + 0.03), Hc.ring(a, y) + 0.012);
      return [Math.sin(a) * r, y, Math.cos(a) * r];
    });
    addGrid(P("trim"), [G[0], inner], true, () => [0, -1, 0]);
    // the visor over the port, a little bigger than the cut so its edge lies
    // on the shell: tinted, glossy and see-through (roleMat), the face behind it
    const cols = np + 1, M = [];
    for (let j = 0; j < vr; j++) {
      const y = lerp(y0 - 0.012, y1 + 0.012, j / (vr - 1)), row = [];
      for (let i = 0; i < cols; i++) { const a = (i / (cols - 1) * 2 - 1) * (aw + 0.05); row.push(at(a, eAt(a, y), 0.007)); }
      M.push(row);
    }
    slab(P, M, false, 0.006, (i, j, p) => V.sub(p, Cm), { top: race ? "accent2" : "smoke", bottom: race ? "accent2" : "smoke", edge: "hard" });
    if (!lod) {
      // visor pivots, a chin vent, a brow vent pair
      for (const s of [-1, 1]) {
        const a = s * (aw + 0.14), p = at(a, eAt(a, 0.4), 0.004), n = V.norm(V.sub(p, Cm));
        addGeo(P("hard"), new THREE.CylinderGeometry(0.04, 0.04, 0.012, 12), frameAt(p, n, [0, 1, 0], 1, 1, 1).multiply(new THREE.Matrix4().makeRotationX(PI / 2)));
      }
      const cv = at(0, eAt(0, 0.1), 0.001);
      boxPart(P("hard"), cv, V.norm(V.sub(cv, Cm)), [0, 1, 0], 0.12, 0.06, 0.008);
      for (const s of [-1, 1]) {
        const a = s * 0.22, p = at(a, eAt(a, 0.6), 0.001);
        boxPart(P("hard"), p, V.norm(V.sub(p, Cm)), [0, 0, 1], 0.035, 0.08, 0.012);
      }
      // twin stripes (moto) / a livery band and a spoiler (race)
      const stripe = (x0, x1) => {
        const S = [];
        for (let k = 0; k <= 12; k++) {
          const th = lerp(0.62, PI + 0.9, k / 12), row = [];
          for (const x of [x0, x1]) {
            const d = V.norm([x, Math.sin(th), Math.cos(th)]), r = rS(d) + 0.0025;
            row.push([Cm[0] + d[0] * r, Cm[1] + d[1] * r, Cm[2] + d[2] * r]);
          }
          S.push(row);
        }
        addGrid(P("accent"), S, false, outFrom(Cm));
      };
      if (race) { stripe(-0.2, -0.1); stripe(0.1, 0.2); } else { stripe(-0.095, -0.045); stripe(0.045, 0.095); }
      if (race) {
        const sp = at(PI, eAt(PI, 0.46), 0.0), sn = V.norm(V.sub(sp, Cm));
        boxPart(P("main"), sp, sn, [0, 1, 0], 0.22, 0.025, 0.06);
      }
    }
    return { P, cover: { band: RIM, room: () => HA_HAIR + 0.004 } };
  }

  const BUILDERS = {
    ballcap: (l, f, v) => buildBallcap(l, f, v),
    peaked: (l, f, v) => buildPeaked(l, f, v || "police"),
    milcap: (l, f) => buildMilcap(l, f),
    fedora: (l, f, v) => buildBrimmed(l, f, "fedora", v),
    trilby: (l, f, v) => buildBrimmed(l, f, "trilby", v),
    cowboy: (l, f, v) => buildBrimmed(l, f, "cowboy", v),
    bucket: (l, f, v) => buildBrimmed(l, f, "bucket", v),
    sun: (l, f, v) => buildBrimmed(l, f, "sun", v),
    campaign: (l, f, v) => buildBrimmed(l, f, "campaign", v),
    hardhat: (l, f) => buildHardhat(l, f),
    beanie: (l, f) => buildBeanie(l, f),
    beret: (l, f, v) => buildBeret(l, f, v),
    durag: (l, f) => buildDurag(l, f),
    bandana: (l, f) => buildBandana(l, f),
    headband: (l, f) => buildHeadband(l, f),
    turban: (l, f) => buildTurban(l, f),
    shemagh: (l, f, v) => buildShemagh(l, f, v),
    hijab: (l, f) => buildHijab(l, f),
    ballistic: (l, f, v) => buildBallistic(l, f, v),
    pasgt: (l, f) => buildPasgt(l, f),
    riot: (l, f) => buildRiot(l, f),
    moto: (l, f) => buildFullface(l, f, "moto"),
    race: (l, f) => buildFullface(l, f, "race"),
  };
  // legacy / role aliases
  const ALIAS = { cap: "ballcap", snapback: "ballcap", patrol: "peaked", police: "peaked", visor: "peaked", captain: "peaked",
    helmet: "ballistic", mich: "ballistic", swat: "ballistic", kpot: "pasgt", rag: "headband", sunhat: "sun", smokey: "campaign",
    stetson: "cowboy", scarf: "hijab", headscarf: "hijab", keffiyeh: "shemagh", fullface: "moto", motorcycle: "moto" };
  const VARIANT_OF = { captain: "captain", snapback: "snap" };
  function canon(kind) { return BUILDERS[kind] ? kind : (ALIAS[kind] || null); }

  // every geometry, cached: kind|form|variant|lod -> { geos: {role: geo}, cover }
  const CACHE = Object.create(null);
  // the kinds whose chinstrap runs under the jaw: built per beard, so the cup sits on it
  const STRAPPED = { ballistic: 1, pasgt: 1 };
  function geometry(kind, form, variant, lod, beardGeo) {
    const k = canon(kind);
    if (!k) return null;
    const f = form === "f" || form === "c" ? form : "m";
    const bg = STRAPPED[k] && beardGeo && beardGeo.attributes ? beardGeo : null;
    const key = k + "|" + f + "|" + (variant || "") + "|" + (lod ? 1 : 0) + (bg ? "|" + bg.uuid : "");
    let c = CACHE[key];
    if (c) return c;
    const out = BUILDERS[k](lod ? 1 : 0, f, variant || "");
    // off the REAL head: skull, ears, nose, neck, brows (raised too), lips
    clearHead(out.P, f, CLEAR_M, bg);
    exactPass(out.P, f, CLEAR_M * 0.5, bg);
    const geos = {};
    // a stable role order so a hat's meshes always come out the same way round
    const P = out.P;
    for (const role of ROLE_ORDER) {
      const part = P(role);
      if (part.p.length) geos[role] = toGeometry(part);
    }
    c = CACHE[key] = { kind: k, geos: geos, cover: out.cover };
    // the hair under it is pulled in under THIS geometry (lazily: a prop hat never needs it)
    // (tails: whether hanging tails show, i.e. over short hair; see fitHair)
    out.cover.shell = function (tails) {
      tails = !!(tails && geos.tail);
      return tails ? (c.shellT || (c.shellT = shellMap(geos, true))) : (c.shell || (c.shell = shellMap(geos, false)));
    };
    return c;
  }
  // how far every hat surface stays off the head (1 mm at HUMAN_SCALE)
  const CLEAR_M = 0.0015;
  const ROLE_ORDER = ["main", "under", "accent", "accent2", "trim", "hard", "strap", "metal", "peak", "smoke", "clear", "tail"];

  /* ---- MATERIALS: the shared caches, nothing per wearer ------------------ */
  function shade(hex, k) {
    const r = Math.round(((hex >> 16) & 255) * k), g = Math.round(((hex >> 8) & 255) * k), b = Math.round((hex & 255) * k);
    return (Math.min(255, r) << 16) | (Math.min(255, g) << 8) | Math.min(255, b);
  }
  const cm = (hex, o) => (CBZ.cmat ? CBZ.cmat(hex, o) : new THREE.MeshLambertMaterial({ color: hex }));
  const pm = (hex, o) => (CBZ.pbrMat ? CBZ.pbrMat(hex, o) : cm(hex));
  const GLOSSY = { hardhat: 1, ballistic: 0, riot: 1, moto: 1, race: 1, pasgt: 0 };
  const DEFAULTS = {
    ballcap: [0x22262e], peaked: [0x1b2233, 0x0e0f12], milcap: [0x44503a], fedora: [0x3b3a38, 0x151414], trilby: [0x5a5550, 0x1b1a19],
    cowboy: [0x8a6a44, 0x3a2615], bucket: [0x6b7152], sun: [0xe6d3a3, 0x3a2e24], campaign: [0x8a7752, 0x4a3218], hardhat: [0xe8c020],
    beanie: [0x2a2d33], beret: [0x6a1a1e], durag: [0x121316], bandana: [0xa0282a], headband: [0xa0282a], turban: [0x1f3a6b],
    shemagh: [0xd9d2c0, 0x121212], hijab: [0x2b2d3a], ballistic: [0x4a4d3a], pasgt: [0x4c5236], riot: [0x14161b], moto: [0x121417, 0xc02828], race: [0xe8e8e8, 0xc41e1e],
  };
  function roleMat(kind, role, color, accent) {
    const def = DEFAULTS[kind] || [0x333333];
    const main = color != null ? color : def[0];
    const acc = accent != null ? accent : (def[1] != null ? def[1] : shade(main, 0.55));
    switch (role) {
      case "main": return GLOSSY[kind] ? pm(main, { roughness: 0.38, metalness: 0.05 }) : cm(main);
      case "under": return cm(shade(main, 0.72));
      case "accent": return GLOSSY[kind] ? pm(acc, { roughness: 0.38, metalness: 0.05 }) : cm(acc);
      case "accent2": return visorMat("iridium");                                     // an iridium race visor
      case "trim": return cm(kind === "shemagh" ? acc : 0x121315);
      case "hard": return cm(0x1c1e21);
      case "strap": return cm(0x1a1b1d);
      case "metal": return cm(0xc9a44a, { emissive: 0x5a4210, ei: 0.35 });
      case "peak": return pm(0x0b0c0f, { roughness: 0.18, metalness: 0.1 });
      case "smoke": return visorMat("smoke");
      case "clear": return clearMat();
      case "tail": return cm(main);
    }
    return cm(main);
  }
  const SILVER = () => cm(0xb9c0c8, { emissive: 0x4e565f, ei: 0.3 });

  /* ---- HAIR UNDER THE HAT ---------------------------------------------- */
  const HAIR_CACHE = new WeakMap();
  function compressHair(geo, cover, form, k, tails) {
    if (!geo || !cover) return geo;
    let byCover = HAIR_CACHE.get(geo);
    if (!byCover) HAIR_CACHE.set(geo, byCover = new Map());
    const ck = form + "|" + k.toFixed(4) + (tails ? "|t" : "");
    let perForm = byCover.get(cover);
    if (!perForm) byCover.set(cover, perForm = Object.create(null));
    if (perForm[ck]) return perForm[ck];
    const H = Head(form);
    const shell = cover.shell ? cover.shell(tails) : null, body = shell ? bodyMap(form) : null;
    const out = geo.clone();
    // a hat holds the hair still: no follow morphs on the compressed copy
    // (character.js hairFollowSync then keeps every influence at 0)
    out.morphAttributes = {}; out.morphTargetsRelative = false;
    const pos = out.attributes.position;
    const BL = 0.045;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) / k, y = pos.getY(i) / k, z = pos.getZ(i) / k;
      const a = Math.atan2(x, z);
      let w = 0;
      if (cover.slice) {
        const y0 = cover.slice[0](a), y1 = cover.slice[1](a);
        w = y < y0 ? sm01((y - (y0 - BL * 0.6)) / (BL * 0.6)) : (y > y1 ? 1 - sm01((y - y1) / (BL * 0.6)) : 1);
      } else {
        const yb = cover.band(a);
        w = sm01((y - (yb - BL)) / BL);
      }
      const dx = x - HC[0], dy = y - HC[1], dz = z - HC[2], r = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (r < 1e-6) continue;
      const d = [dx / r, dy / r, dz / r];
      let nr = r;
      if (w > 0) {
        // 1. the smooth squeeze under the band (the shape of hair under a hat)
        const R = H.hitDir(d);
        let room = cover.room ? cover.room(a, y) : HA_HAIR;
        let allowed = R + room + (1 - w) * (1 - w) * 0.6;
        if (r > allowed) {
          // pulled in along the ray the vertex drops: the room where it LANDS
          // may be tighter (a strap under a cap's opening), so take the smaller
          if (cover.room) {
            const y1 = HC[1] + d[1] * allowed;
            const room1 = cover.room(a, y1);
            if (room1 < room) { room = room1; allowed = R + room + (1 - w) * (1 - w) * 0.6; }
          }
          nr = Math.max(R + 0.001, allowed);
        }
      }
      if (shell) {
        // 2. the guarantee: whatever the band says, no hair beyond the hat's
        // own inner surface (a bill's sides over the temples, a reversed
        // bill over long hair, a neck curtain over a ponytail)
        const s = sphGet(shell, x, y, z, false);
        if (s < Infinity && nr > s - HAIR_M) {
          const b = sphGet(body, x, y, z, true);
          nr = Math.max(Math.min(nr, s - HAIR_M), Math.min(b + 0.0005, (s + b) * 0.5));
        }
      }
      if (nr !== r) pos.setXYZ(i, (HC[0] + d[0] * nr) * k, (HC[1] + d[1] * nr) * k, (HC[2] + d[2] * nr) * k);
    }
    pos.needsUpdate = true;
    out.computeVertexNormals();
    out.computeBoundingBox(); out.computeBoundingSphere();
    out._shared = true;
    perForm[ck] = out;
    return out;
  }
  /* character.js keeps each hair mesh's near/far pair in userData.hairLods
     and its setHairLod swaps between them with the body's LOD. Under a hat
     this REPLACES the pair with compressed versions (keeping the originals
     in hairLods0) and puts the right one on now; taking the hat off puts the
     originals back. */
  function hairPair(m, styleOverride) {
    const ud = m.userData;
    if (!ud.hairLods0) ud.hairLods0 = ud.hairLods || { near: m.geometry, far: m.geometry };
    const hairFn = CBZ.human && CBZ.human.geometry && CBZ.human.geometry.hair;
    if (styleOverride && hairFn && ud.hairS > 0) {
      try { return { near: hairFn(styleOverride, ud.hairS, false, ud.hairYoke), far: hairFn(styleOverride, ud.hairS, true, ud.hairYoke) }; } catch (e) { /* fall through */ }
    }
    return ud.hairLods0;
  }
  // styles that hang or stand off the scalp: a durag goes over short hair
  // only (long hair is tied away under it), and hanging tails go behind them
  const LONG_HAIR = { bob: 1, long: 1, pony: 1, bun: 1, pigtail: 1, locs: 1, afro: 1 };
  // hide / show a mesh for the hat without fighting the NPC detail LOD, which
  // re-shows its members unless they carry _cbzDetailSuppressed
  function hwHide(m, on) {
    const ud = m.userData;
    if (on) { if (!ud._hwHid) { ud._hwHid = true; ud._hwSup = !!ud._cbzDetailSuppressed; } ud._cbzDetailSuppressed = true; m.visible = false; }
    else if (ud._hwHid) { ud._hwHid = false; ud._cbzDetailSuppressed = ud._hwSup; delete ud._hwSup; m.visible = true; }
  }
  /* Everything on the head that a hat changes: the hair (compressed under the
     crown and clamped under the hat's real inner surface at BOTH LODs, or
     hidden), the beard under a face veil, and the hanging tails of a bandana
     or headband (they fall behind long hair, not through it). */
  function fitHair(rig) {
    const st = rig._hw, S = rig.skinSlots || {}, hair = S.hair || [];
    const act = st && st.active, hidden = st && st.hidden && Object.keys(st.hidden).length;
    const cover = act && !hidden ? act.cover : null;
    const form = rig.headForm || "m";
    const k = ((rig.profile && rig.profile.headSize) || 0.6) / 0.6;
    const far = !!(st && st.lod);
    // the cover of each LOD's own geometry: near hair under the near hat, far under far
    const hides = (ud) => !!(cover && (cover.hide || (cover.hideLong && LONG_HAIR[ud.hairStyle])));
    let longShown = false;
    for (let i = 0; i < hair.length; i++) { const m = hair[i]; if (m && m.isMesh && !hides(m.userData) && LONG_HAIR[m.userData.hairStyle]) longShown = true; }
    for (let i = 0; i < hair.length; i++) {
      const m = hair[i];
      if (!m || !m.isMesh) continue;
      const ud = m.userData;
      const hide = hides(ud);
      hwHide(m, hide);
      if (hide) continue;
      if (!cover && !ud.hairLods0) continue;                 // never touched, nothing to undo
      // an afro stands through any crown: under a hat the base is the curly cut
      const base = hairPair(m, cover && ud.hairStyle === "afro" && !cover.slice ? "curly" : null);
      // Only the LOD on screen is compressed: character.js's setHairLod always
      // goes through headwear.setLod -> fitHair first, which fills the other
      // slot for real before it is ever shown (the hat's far geometry is not
      // even built for a body that never leaves the near tier).
      let pair = base;
      if (cover) {
        const cv = (geometry(act.kind, form, act.variant, far ? 1 : 0, act.beard) || {}).cover || cover;
        const g = compressHair(far ? base.far : base.near, cv, form, k, !longShown);
        pair = far ? { near: base.near, far: g } : { near: g, far: base.far };
      }
      ud.hairLods = pair;
      m.geometry = far ? pair.far : pair.near;
    }
    const beard = S.beard || [];
    for (let i = 0; i < beard.length; i++) if (beard[i] && beard[i].isMesh) hwHide(beard[i], !!(cover && cover.hideBeard));
    if (act) for (const m of act.meshes) if (m.userData.hatRole === "tail") m.visible = !longShown;
  }


  /* ---- WEARING --------------------------------------------------------- */
  let SEQ = 0;
  // shop: the hat the player chose to wear. Under any uniform / role hat (a
  // cop in his peaked cap stays a cop), over the gang rag (the chosen hat is
  // the look; the rag is the default when there is none).
  const PRIO = { armor: 4, warlord: 3, warlordKit: 3, outfit: 2, role: 2, beach: 2, player: 2, shop: 1.5, bandana: 1 };
  function detachLayer(L) { if (L && L.group && L.group.parent) L.group.parent.remove(L.group); }
  function syncCapSlot(rig) {
    // skinSlots.cap = the meshes of the ROLE headwear (outfit/player/beach
    // layer) — the array other systems hold a reference to, edited in place
    const s = rig.skinSlots;
    if (!s) return;
    const arr = s.cap || (s.cap = []);
    arr.length = 0;
    const st = rig._hw;
    if (!st) return;
    for (const o of ["outfit", "player", "beach", "role"]) {
      const L = st.layers[o];
      if (L) for (const m of L.meshes) arr.push(m);
    }
  }
  function resolve(rig) {
    const st = rig._hw;
    if (!st) return;
    let best = null;
    for (const o in st.layers) {
      const L = st.layers[o];
      // the higher owner wins; between equals, the one put on last
      if (!best || L.prio > best.prio || (L.prio === best.prio && L.seq > best.seq)) best = L;
    }
    st.active = best;
    const hidden = st.hidden && Object.keys(st.hidden).length > 0;
    for (const o in st.layers) {
      const L = st.layers[o];
      L.group.visible = L === best && !hidden;
    }
    fitHair(rig);
  }
  function makeMeshes(group, entry, kind, opts) {
    const meshes = [];
    for (const role of ROLE_ORDER) {
      const g = entry.geos[role];
      if (!g) continue;
      let mat = roleMat(entry.kind, role, opts.color, opts.accent);
      if (role === "metal" && opts.metal === "silver") mat = SILVER();
      const m = new THREE.Mesh(g, mat);
      m.name = "hat-" + role;
      m.castShadow = role === "main";
      m.receiveShadow = false;
      m.userData.hatRole = role;
      m.userData.clothingPart = "headwear";
      if (SEE_THROUGH[role]) { m.renderOrder = 2; m.castShadow = false; }   // glass after the head it shows
      group.add(m);
      meshes.push(m);
    }
    return meshes;
  }
  // the beard a rig wears (character.js skinSlots.beard: one merged mesh)
  function beardOf(rig) {
    const b = rig && rig.skinSlots && rig.skinSlots.beard;
    return b && b[0] && b[0].geometry && b[0].geometry.attributes ? b[0].geometry : null;
  }
  function wear(rig, kind, opts) {
    if (!rig) return null;
    opts = opts || {};
    const owner = opts.owner || "outfit";
    const st = rig._hw || (rig._hw = { layers: Object.create(null), active: null, lod: 0, hidden: null });
    const prev = st.layers[owner];
    const k = kind ? canon(kind) : null;
    if (!k) {
      if (prev) { detachLayer(prev); delete st.layers[owner]; syncCapSlot(rig); resolve(rig); }
      return null;
    }
    const variant = opts.variant != null ? opts.variant : (opts.backward ? "back" : (VARIANT_OF[kind] || ""));
    const key = k + "|" + variant;
    const host = rig.neck;
    if (!host) return null;
    if (prev && prev.key === key) {
      prev.seq = ++SEQ;
      if (prev.color !== opts.color || prev.accent !== opts.accent || prev.metal !== opts.metal) {
        for (const m of prev.meshes) {
          let mat = roleMat(k, m.userData.hatRole, opts.color, opts.accent);
          if (m.userData.hatRole === "metal" && opts.metal === "silver") mat = SILVER();
          m.material = mat;
        }
        prev.color = opts.color; prev.accent = opts.accent; prev.metal = opts.metal;
      }
      resolve(rig);
      return prev.group;
    }
    if (prev) detachLayer(prev);
    const form = rig.headForm || "m";
    const beardGeo = beardOf(rig);
    const entry = geometry(k, form, variant, st.lod, beardGeo);
    if (!entry) return null;
    const hs = (rig.profile && rig.profile.headSize) || 0.6;
    const group = new THREE.Group();
    group.name = "headwear-" + k;
    group.scale.setScalar(hs / 0.6);
    group.userData.headwear = k;
    const meshes = makeMeshes(group, entry, k, opts);
    host.add(group);
    st.layers[owner] = { owner, kind: k, variant, key, group, meshes, cover: entry.cover, beard: beardGeo, prio: PRIO[owner] != null ? PRIO[owner] : 2,
      color: opts.color, accent: opts.accent, metal: opts.metal, seq: ++SEQ };
    syncCapSlot(rig);
    resolve(rig);
    return group;
  }
  function setHidden(rig, why, on) {
    if (!rig) return;
    const st = rig._hw || (rig._hw = { layers: Object.create(null), active: null, lod: 0, hidden: null });
    st.hidden = st.hidden || {};
    if (on) st.hidden[why] = true; else delete st.hidden[why];
    resolve(rig);
  }
  function setLod(rig, lod) {
    const st = rig && rig._hw;
    lod = lod >= 2 ? 1 : 0;              // the body's LOD: 1 near, 2 far
    if (!st || st.lod === lod) return;
    st.lod = lod;
    const form = rig.headForm || "m";
    for (const o in st.layers) {
      const L = st.layers[o], entry = geometry(L.kind, form, L.variant, lod, L.beard);
      if (!entry) continue;
      for (const m of L.meshes) { const g = entry.geos[m.userData.hatRole]; if (g) { m.geometry = g; m.visible = true; } else m.visible = false; }
    }
    fitHair(rig);
  }
  function worn(rig) { const st = rig && rig._hw; return st && st.active ? st.active.kind : null; }

  let _liner = null;
  const linerGeo = () => _liner || (_liner = Object.assign(new THREE.SphereGeometry(1, 16, 12), { _shared: true }));
  // a standalone hat for props, racks and vehicle dummies (adult 0.60 head frame)
  function build(kind, opts) {
    opts = opts || {};
    const entry = geometry(kind, opts.form || "m", opts.variant || "", opts.lod || 0);
    if (!entry) return null;
    const g = new THREE.Group();
    g.name = "headwear-" + entry.kind;
    makeMeshes(g, entry, entry.kind, opts);
    // a prop full-face lid (a dummy rider) has no head inside to see through
    // the visor: fill it with the dark padded liner
    if (entry.kind === "moto" || entry.kind === "race") {
      const m = new THREE.Mesh(linerGeo(), cm(0x0b0c0e));
      m.name = "hat-liner"; m.position.set(0, 0.29, 0.015); m.scale.set(0.36, 0.38, 0.40);
      g.add(m);
    }
    return g;
  }

  /* ---- ROLE -> KIND: one table, so the same job always wears the same hat */
  const ROLE_KIND = [
    [/swat|tactical|counter.?sniper|breach/i, "ballistic"],
    [/riot/i, "riot"],
    [/soldier|army|infantry|marine|troop|militia|recruit/i, "milcap"],
    [/sheriff|deputy|ranger|trooper|warden'?s? deputy/i, "campaign"],
    [/construction|builder|hardhat|roadwork|quarry|miner|site/i, "hardhat"],
    [/pilot|captain|first officer|aviator|mariner|skipper|officer's|admiral/i, "peaked:captain"],
    [/chauffeur|limo|driver/i, "peaked:chauffeur"],
    [/police|cop|officer|patrol|guard|warden|corrections|security/i, "peaked:police"],
    [/lifeguard|fisher|angler/i, "bucket"],
    [/hunter|pit ?crew|marshal|ground ?crew|airside|delivery|courier|mechanic|farmer/i, "ballcap"],
    [/cowboy|rancher|wrangler/i, "cowboy"],
    [/biker|rider|motorcycl/i, "moto"],
    [/racer|race driver|nascar|f1/i, "race"],
  ];
  function kindFor(text) {
    if (!text) return null;
    for (const [re, k] of ROLE_KIND) if (re.test(text)) return k;
    return null;
  }
  // "peaked:police" -> { kind, variant }
  function parseKind(s) {
    if (!s) return { kind: null, variant: "" };
    const i = s.indexOf(":");
    return i < 0 ? { kind: s, variant: "" } : { kind: s.slice(0, i), variant: s.slice(i + 1) };
  }

  CBZ.headwear = {
    kinds: Object.keys(BUILDERS),
    wear: function (rig, kind, opts) {
      if (typeof kind === "string" && kind.indexOf(":") > 0) {
        const pk = parseKind(kind);
        opts = Object.assign({}, opts || {}, { variant: (opts && opts.variant) || pk.variant });
        kind = pk.kind;
      }
      return wear(rig, kind, opts);
    },
    setHidden, setLod, worn, build, kindFor, parseKind, canon,
    geometry, compressHair, fitHair,
    // for tools/headwear-check.mjs
    _fit: { Head, skullSdf, earSdf, HC, HA, O_SOFT, formOf },
  };
})();
