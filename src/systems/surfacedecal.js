/* ============================================================
   systems/surfacedecal.js — PROJECTED DECALS THAT LIE ON THE MESH.

   OWNER: "BLOOD SPLATTERS ONTO VEHICLES LOOK FAKE AS FUCK. THEY TREAT THE
   VEHICLE AS FLAT SO FLOATING."

   A flat quad can only touch a curved panel at one point. Laid on a hood,
   a fender or a windscreen it hangs off the curve by centimetres at its
   edges (and by up to a metre when it was seated on the collider box round
   the car instead of the car). The only way blood can sit ON a curved body
   is to be cut out of that body's own triangles. This is the r128
   DecalGeometry idea written for this game:

     * a decal is a BOX in the host mesh's local space (unit cube, +z out of
       the surface toward whatever threw the blood);
     * every host triangle that faces the box's +z and touches the box is
       clipped to it (Sutherland-Hodgman, 6 planes), and the pieces are the
       decal: same surface, so zero gap by construction;
     * UV = the box's x/y, so a texture cell maps across the patch as if it
       had been projected straight down the box;
     * every output vertex REMEMBERS which host triangle it came from and its
       barycentric weights, so when the host's vertices move (a crash dent:
       city/crashdeform.js displaces them in place, or swaps in a per-car
       clone of the same layout) refit() puts the decal back on the new
       surface without projecting again.

   Pure geometry: no scene, no renderer. gore.js owns what blood looks like;
   this file owns where a patch of it lies. Headless check:
   tools/surface-decal-check.mjs.

   API (CBZ.surfaceDecal):
     project(geo, toBox, o) -> { n, src: Uint32Array(n*3), bary: Float32Array(n*3),
                                 uv: Float32Array(n*2) } | null
        geo    BufferGeometry (indexed or not, position itemSize 3)
        toBox  Matrix4 elements (column-major, 16): host-local -> box space
        o      { minFacing: 0.05, maxTris: 1200, dir: [x,y,z] box +z in
                 host-local (optional; derived from toBox when absent) }
     refit(d, geo, off, pos, nrm) -> writes n*3 positions (lifted `off`
        metres along the interpolated normal) and normals; returns false when
        geo's layout no longer matches the one projected on.
============================================================ */
(function () {
  "use strict";
  const CBZ = (window.CBZ = window.CBZ || {});

  // scratch polygon: up to 9 verts after 6 clips of a triangle; 6 floats each
  // (box x,y,z, bary 0,1,2)
  const PA = new Float64Array(16 * 6), PB = new Float64Array(16 * 6);

  function invert3x4(e, out) {
    // affine inverse of a column-major 4x4 (bottom row 0,0,0,1)
    const a = e[0], b = e[4], c = e[8], d = e[12];
    const f = e[1], g = e[5], h = e[9], k = e[13];
    const l = e[2], m = e[6], n = e[10], p = e[14];
    const A = g * n - h * m, B = h * l - f * n, C = f * m - g * l;
    const det = a * A + b * B + c * C;
    if (!det) return null;
    const id = 1 / det;
    out[0] = A * id; out[1] = B * id; out[2] = C * id; out[3] = 0;
    out[4] = (c * m - b * n) * id; out[5] = (a * n - c * l) * id; out[6] = (b * l - a * m) * id; out[7] = 0;
    out[8] = (b * h - c * g) * id; out[9] = (c * f - a * h) * id; out[10] = (a * g - b * f) * id; out[11] = 0;
    out[12] = -(out[0] * d + out[4] * k + out[8] * p);
    out[13] = -(out[1] * d + out[5] * k + out[9] * p);
    out[14] = -(out[2] * d + out[6] * k + out[10] * p);
    out[15] = 1;
    return out;
  }
  const _inv = new Float64Array(16);

  // clip polygon `src` (cnt verts) against plane  s * v[axis] <= 0.5 ; -> dst
  function clip(src, cnt, dst, axis, s) {
    let out = 0;
    if (!cnt) return 0;
    let pi = (cnt - 1) * 6;
    let pd = s * src[pi + axis] - 0.5;
    for (let i = 0; i < cnt; i++) {
      const ci = i * 6, cd = s * src[ci + axis] - 0.5;
      if (cd <= 0) {
        if (pd > 0) { lerpInto(src, pi, ci, pd / (pd - cd), dst, out++); }
        for (let k = 0; k < 6; k++) dst[out * 6 + k] = src[ci + k];
        out++;
      } else if (pd <= 0) {
        lerpInto(src, pi, ci, pd / (pd - cd), dst, out++);
      }
      pi = ci; pd = cd;
      if (out > 14) break;
    }
    return out;
  }
  function lerpInto(src, a, b, t, dst, j) {
    const o = j * 6;
    for (let k = 0; k < 6; k++) dst[o + k] = src[a + k] + (src[b + k] - src[a + k]) * t;
  }

  function project(geo, toBox, o) {
    o = o || {};
    const P = geo && geo.attributes && geo.attributes.position;
    if (!P || P.itemSize !== 3) return null;
    const N = geo.attributes.normal || null;
    const idx = geo.index ? geo.index.array : null;
    const triN = idx ? (idx.length / 3) | 0 : (P.count / 3) | 0;
    const flat = !P.isInterleavedBufferAttribute && P.array;
    const nflat = N && !N.isInterleavedBufferAttribute ? N.array : null;
    const e = toBox;
    const inv = invert3x4(e, _inv);
    if (!inv) return null;
    // the box's +z in host-local (the direction blood came FROM is -dir)
    let dx, dy, dz;
    if (o.dir) { dx = o.dir[0]; dy = o.dir[1]; dz = o.dir[2]; }
    else { dx = inv[8]; dy = inv[9]; dz = inv[10]; }
    const dl = Math.hypot(dx, dy, dz) || 1; dx /= dl; dy /= dl; dz /= dl;
    const minFacing = o.minFacing != null ? o.minFacing : 0.05;
    const maxTris = o.maxTris || 1200;
    // host-local AABB of the box: cheap reject before any transform
    let lx0 = Infinity, ly0 = Infinity, lz0 = Infinity, lx1 = -Infinity, ly1 = -Infinity, lz1 = -Infinity;
    for (let c = 0; c < 8; c++) {
      const bx = c & 1 ? 0.5 : -0.5, by = c & 2 ? 0.5 : -0.5, bz = c & 4 ? 0.5 : -0.5;
      const x = inv[0] * bx + inv[4] * by + inv[8] * bz + inv[12];
      const y = inv[1] * bx + inv[5] * by + inv[9] * bz + inv[13];
      const z = inv[2] * bx + inv[6] * by + inv[10] * bz + inv[14];
      if (x < lx0) lx0 = x; if (x > lx1) lx1 = x;
      if (y < ly0) ly0 = y; if (y > ly1) ly1 = y;
      if (z < lz0) lz0 = z; if (z > lz1) lz1 = z;
    }
    const src = [], bary = [], uv = [];
    let tris = 0;
    const V = [0, 0, 0, 0, 0, 0, 0, 0, 0], I = [0, 0, 0];
    for (let t = 0; t < triN && tris < maxTris; t++) {
      const i0 = idx ? idx[t * 3] : t * 3, i1 = idx ? idx[t * 3 + 1] : t * 3 + 1, i2 = idx ? idx[t * 3 + 2] : t * 3 + 2;
      I[0] = i0; I[1] = i1; I[2] = i2;
      for (let k = 0; k < 3; k++) {
        const vi = I[k];
        if (flat) { V[k * 3] = flat[vi * 3]; V[k * 3 + 1] = flat[vi * 3 + 1]; V[k * 3 + 2] = flat[vi * 3 + 2]; }
        else { V[k * 3] = P.getX(vi); V[k * 3 + 1] = P.getY(vi); V[k * 3 + 2] = P.getZ(vi); }
      }
      // all three outside one face of the box's local AABB -> nothing to cut
      if ((V[0] < lx0 && V[3] < lx0 && V[6] < lx0) || (V[0] > lx1 && V[3] > lx1 && V[6] > lx1) ||
          (V[1] < ly0 && V[4] < ly0 && V[7] < ly0) || (V[1] > ly1 && V[4] > ly1 && V[7] > ly1) ||
          (V[2] < lz0 && V[5] < lz0 && V[8] < lz0) || (V[2] > lz1 && V[5] > lz1 && V[8] > lz1)) continue;
      // FACING: blood lands on the side it came at. Vertex normals when the
      // mesh has them (a mirrored merge flips winding, never its normals),
      // the winding's normal otherwise.
      let fx, fy, fz;
      if (N) {
        if (nflat) {
          fx = nflat[i0 * 3] + nflat[i1 * 3] + nflat[i2 * 3];
          fy = nflat[i0 * 3 + 1] + nflat[i1 * 3 + 1] + nflat[i2 * 3 + 1];
          fz = nflat[i0 * 3 + 2] + nflat[i1 * 3 + 2] + nflat[i2 * 3 + 2];
        } else {
          fx = N.getX(i0) + N.getX(i1) + N.getX(i2); fy = N.getY(i0) + N.getY(i1) + N.getY(i2); fz = N.getZ(i0) + N.getZ(i1) + N.getZ(i2);
        }
      } else {
        const ax = V[3] - V[0], ay = V[4] - V[1], az = V[5] - V[2], bx = V[6] - V[0], by = V[7] - V[1], bz = V[8] - V[2];
        fx = ay * bz - az * by; fy = az * bx - ax * bz; fz = ax * by - ay * bx;
      }
      const fl = Math.hypot(fx, fy, fz);
      if (!(fl > 0) || (fx * dx + fy * dy + fz * dz) / fl < minFacing) continue;
      // into box space, with barycentric identity
      for (let k = 0; k < 3; k++) {
        const x = V[k * 3], y = V[k * 3 + 1], z = V[k * 3 + 2], q = k * 6;
        PA[q] = e[0] * x + e[4] * y + e[8] * z + e[12];
        PA[q + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
        PA[q + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
        PA[q + 3] = k === 0 ? 1 : 0; PA[q + 4] = k === 1 ? 1 : 0; PA[q + 5] = k === 2 ? 1 : 0;
      }
      let n = 3;
      n = clip(PA, n, PB, 0, 1); n = clip(PB, n, PA, 0, -1);
      n = clip(PA, n, PB, 1, 1); n = clip(PB, n, PA, 1, -1);
      n = clip(PA, n, PB, 2, 1); n = clip(PB, n, PA, 2, -1);
      if (n < 3) continue;
      for (let f = 1; f < n - 1 && tris < maxTris; f++) {
        const fan = [0, f, f + 1];
        for (let k = 0; k < 3; k++) {
          const q = fan[k] * 6;
          src.push(i0, i1, i2);
          bary.push(PA[q + 3], PA[q + 4], PA[q + 5]);
          uv.push(PA[q] + 0.5, PA[q + 1] + 0.5);
        }
        tris++;
      }
    }
    if (!tris) return null;
    return {
      n: tris * 3, tris,
      src: new Uint32Array(src), bary: new Float32Array(bary), uv: new Float32Array(uv),
      count: P.count, dir: [dx, dy, dz],
    };
  }

  // positions + normals of a projected decal on the host's CURRENT vertices
  function refit(d, geo, off, pos, nrm) {
    const P = geo && geo.attributes && geo.attributes.position;
    if (!P || P.count !== d.count) return false;
    const N = geo.attributes.normal || null;
    const pa = !P.isInterleavedBufferAttribute ? P.array : null;
    const na = N && !N.isInterleavedBufferAttribute ? N.array : null;
    const S = d.src, B = d.bary;
    for (let v = 0; v < d.n; v++) {
      const i0 = S[v * 3], i1 = S[v * 3 + 1], i2 = S[v * 3 + 2];
      const b0 = B[v * 3], b1 = B[v * 3 + 1], b2 = B[v * 3 + 2];
      let ax, ay, az, bx, by, bz, cx, cy, cz;
      if (pa) {
        ax = pa[i0 * 3]; ay = pa[i0 * 3 + 1]; az = pa[i0 * 3 + 2];
        bx = pa[i1 * 3]; by = pa[i1 * 3 + 1]; bz = pa[i1 * 3 + 2];
        cx = pa[i2 * 3]; cy = pa[i2 * 3 + 1]; cz = pa[i2 * 3 + 2];
      } else {
        ax = P.getX(i0); ay = P.getY(i0); az = P.getZ(i0);
        bx = P.getX(i1); by = P.getY(i1); bz = P.getZ(i1);
        cx = P.getX(i2); cy = P.getY(i2); cz = P.getZ(i2);
      }
      // the vertex normals interpolated (a curved panel lifts smoothly), the
      // face's own normal when the mesh carries none
      const ex = bx - ax, ey = by - ay, ez = bz - az, gx = cx - ax, gy = cy - ay, gz = cz - az;
      let nx = ey * gz - ez * gy, ny = ez * gx - ex * gz, nz = ex * gy - ey * gx;
      if (N) {
        if (na) {
          nx = na[i0 * 3] * b0 + na[i1 * 3] * b1 + na[i2 * 3] * b2;
          ny = na[i0 * 3 + 1] * b0 + na[i1 * 3 + 1] * b1 + na[i2 * 3 + 1] * b2;
          nz = na[i0 * 3 + 2] * b0 + na[i1 * 3 + 2] * b1 + na[i2 * 3 + 2] * b2;
        } else {
          nx = N.getX(i0) * b0 + N.getX(i1) * b1 + N.getX(i2) * b2;
          ny = N.getY(i0) * b0 + N.getY(i1) * b1 + N.getY(i2) * b2;
          nz = N.getZ(i0) * b0 + N.getZ(i1) * b1 + N.getZ(i2) * b2;
        }
      } else if (nx * d.dir[0] + ny * d.dir[1] + nz * d.dir[2] < 0) {
        // no normals: the winding decides, and a mirrored merge flips it.
        // The side the blood came from is the outside.
        nx = -nx; ny = -ny; nz = -nz;
      }
      const nl = Math.hypot(nx, ny, nz) || 1;
      nx /= nl; ny /= nl; nz /= nl;
      const o = v * 3;
      pos[o] = ax * b0 + bx * b1 + cx * b2 + nx * off;
      pos[o + 1] = ay * b0 + by * b1 + cy * b2 + ny * off;
      pos[o + 2] = az * b0 + bz * b1 + cz * b2 + nz * off;
      if (nrm) { nrm[o] = nx; nrm[o + 1] = ny; nrm[o + 2] = nz; }
    }
    return true;
  }

  CBZ.surfaceDecal = { project, refit };
})();
