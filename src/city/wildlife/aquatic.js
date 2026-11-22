(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const S = CBZ.defineSpecies;
  if (!S) return;
  const T = window.THREE;

  /* ==========================================================================
     THE MARINE BODY KIT.

     Every sea animal here is ONE SkinnedMesh on ONE shared material: one draw
     call per animal. The hull is a single continuous loft from the snout tip
     to the tail stock (no head shell, no tail sleeve, so no rings or seams);
     the mouth is a cut in that same skin with a cavity (palate, floor,
     pharynx), gums and rows of teeth inside it; the eyes sit in the head on
     their own bones so they can roll; gill slits are grooves in the skin; the
     fins are tapered foil sections grown out of the hull with their roots
     buried in it. Colour is baked per vertex, and colour boundaries
     (countershading, fin tips, orca patches, stripes) are CUT through the
     triangles, so a line is a crisp irregular line, not a staircase of faces.

     The skeleton is a spine chain (head, neck, root, tail bones) plus a lower
     jaw, an upper jaw that protrudes, eyes, pectorals, and whatever a body
     plan adds (manta wing bones, turtle flipper bones). city/wildlife_rig.js
     drives it from group.userData.marineBody.

     Units: model units, nose toward +X, up +Y. A species declares its length
     L and every other measurement as a fraction of L (how morphometric tables
     for sharks and fish are written), so proportions read straight off the
     literature. Geometry is built once per species and LOD and shared by every
     individual; the skeleton is per animal. No Math.random anywhere: skin
     noise is a hash of position, so a species always looks the same.
     ========================================================================== */
  const MB = (function () {
    const TAU = Math.PI * 2;
    function cl(v, a, b) { return v < a ? a : (v > b ? b : v); }
    function sm(t) { t = cl(t, 0, 1); return t * t * (3 - 2 * t); }
    function mix(a, b, t) { return a + (b - a) * t; }
    function hexc(h) { return [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255]; }
    function mixc(a, b, t) { return [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)]; }
    function mulc(c, k) { return [c[0] * k, c[1] * k, c[2] * k]; }
    function nrm3(v) { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }
    function crs(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
    function dt3(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
    function sub3(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }

    /* A profile is a few [s, value] control points read as a monotone cubic
       (Fritsch-Carlson): smooth, and it never overshoots between points, so a
       silhouette has no bumps the table did not ask for. */
    function curve(pts) {
      if (typeof pts === "number") { const k = pts; return function () { return k; }; }
      const n = pts.length, X = [], Y = [], D = [], M = [];
      for (let i = 0; i < n; i++) { X.push(pts[i][0]); Y.push(pts[i][1]); }
      if (n === 1) return function () { return Y[0]; };
      for (let i = 0; i < n - 1; i++) D.push((Y[i + 1] - Y[i]) / (X[i + 1] - X[i]));
      M[0] = D[0]; M[n - 1] = D[n - 2];
      for (let i = 1; i < n - 1; i++) M[i] = D[i - 1] * D[i] <= 0 ? 0 : (D[i - 1] + D[i]) / 2;
      for (let i = 0; i < n - 1; i++) {
        if (D[i] === 0) { M[i] = 0; M[i + 1] = 0; continue; }
        const a = M[i] / D[i], b = M[i + 1] / D[i], h = a * a + b * b;
        if (h > 9) { const t = 3 / Math.sqrt(h); M[i] = t * a * D[i]; M[i + 1] = t * b * D[i]; }
      }
      return function (s) {
        if (s <= X[0]) return Y[0];
        if (s >= X[n - 1]) return Y[n - 1];
        let i = 0;
        while (i < n - 2 && s > X[i + 1]) i++;
        const h = X[i + 1] - X[i], t = (s - X[i]) / h, t2 = t * t, t3 = t2 * t;
        return (2 * t3 - 3 * t2 + 1) * Y[i] + (t3 - 2 * t2 + t) * h * M[i] +
          (-2 * t3 + 3 * t2) * Y[i + 1] + (t3 - t2) * h * M[i + 1];
      };
    }

    // ---- deterministic value noise (skin mottling, ragged colour lines) ----
    // a fixed permutation and value table (built from an integer hash, once),
    // so a lattice lookup is three array reads, not a multiply chain
    const PERM = new Uint8Array(512), VAL = new Float32Array(256);
    (function () {
      const p = [];
      for (let i = 0; i < 256; i++) p.push(i);
      let h = 0x9e3779b9;
      const rnd = function () { h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d); h = Math.imul(h ^ (h >>> 12), 0x297a2d39); h ^= h >>> 15; return (h >>> 0) / 4294967296; };
      for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = p[i]; p[i] = p[j]; p[j] = t; }
      for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
      for (let i = 0; i < 256; i++) VAL[i] = rnd();
    })();
    function hh(i, j, k, s) {
      return VAL[PERM[PERM[PERM[(i + s * 17) & 255] + (j & 255)] + (k & 255)]];
    }
    function vn(x, y, z, s) {
      const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
      let fx = x - xi, fy = y - yi, fz = z - zi;
      fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); fz = fz * fz * (3 - 2 * fz);
      const a = mix(hh(xi, yi, zi, s), hh(xi + 1, yi, zi, s), fx);
      const b = mix(hh(xi, yi + 1, zi, s), hh(xi + 1, yi + 1, zi, s), fx);
      const c = mix(hh(xi, yi, zi + 1, s), hh(xi + 1, yi, zi + 1, s), fx);
      const d = mix(hh(xi, yi + 1, zi + 1, s), hh(xi + 1, yi + 1, zi + 1, s), fx);
      return mix(mix(a, b, fy), mix(c, d, fy), fz);
    }
    // cellular noise: distance to the nearest and second-nearest cell point
    // (scales with pale edges, a turtle's head plates)
    function worley(x, y, z, s) {
      const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
      let f1 = 9, f2 = 9;
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
        const cx = xi + a, cy = yi + b, cz = zi + c;
        const px = cx + hh(cx, cy, cz, s), py = cy + hh(cx, cy, cz, s + 1), pz = cz + hh(cx, cy, cz, s + 2);
        const d = Math.hypot(px - x, py - y, pz - z);
        if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d;
      }
      return [f1, f2];
    }
    function fbm(x, y, z, s, oct) {
      let v = 0, a = 1, n = 0, f = 1;
      for (let o = 0; o < (oct || 3); o++) { v += a * vn(x * f, y * f, z * f, s + o * 31); n += a; a *= 0.5; f *= 2.07; }
      return v / n;
    }

    /* ---- THE VERTEX STORE ---------------------------------------------------
       Positions, bone weights ([bone, w, bone, w, ...]), a region tag and a
       small lerpable meta array per vertex (the paint and the colour-line
       fields read it). Colours are not stored: they are evaluated at the end,
       after the colour lines have been cut. */
    const TAG = { SKIN: 1, CHIN: 2, PALATE: 3, FLOOR: 4, TOOTH: 5, EYE: 6, FIN: 7, BALEEN: 8 };
    function Store() { this.p = []; this.w = []; this.tag = []; this.m = []; this.ix = []; this.n = 0; this.forced = new Map(); }
    Store.prototype.v = function (P, w, tag, m) {
      this.p.push(P[0], P[1], P[2]); this.w.push(w); this.tag.push(tag); this.m.push(m || ZM);
      return this.n++;
    };
    Store.prototype.pos = function (i) { return [this.p[i * 3], this.p[i * 3 + 1], this.p[i * 3 + 2]]; };
    Store.prototype.t = function (a, b, c) { if (a !== b && b !== c && a !== c) this.ix.push(a, b, c); };
    // quad of known winding
    Store.prototype.qr = function (a, b, c, d) { this.t(a, b, c); this.t(a, c, d); };
    // a quad wound so its face normal agrees with `out`
    Store.prototype.q = function (a, b, c, d, out) {
      const A = this.pos(a), B = this.pos(b), C = this.pos(c), D = this.pos(d);
      let n = crs(sub3(C, A), sub3(D, B));
      if (Math.abs(n[0]) + Math.abs(n[1]) + Math.abs(n[2]) < 1e-16) n = crs(sub3(B, A), sub3(C, A));
      if (dt3(n, out) < 0) { this.t(a, d, c); this.t(a, c, b); } else { this.t(a, b, c); this.t(a, c, d); }
    };
    const ZM = [0, 0, 0, 0];

    /* ---- CUTTING A COLOUR LINE THROUGH THE MESH ---------------------------
       field(ctx) is a signed value per vertex (negative on one side of the
       line, positive on the other, NaN = no line here). Every triangle the
       zero crossing passes through is split along it, and each crossing point
       becomes TWO vertices at the same position — one for each side — so the
       paint can give the two sides different colours with a hard edge
       between them. Normals and bone weights are interpolated, so the split
       is invisible except as the colour line. Shared edges share their
       crossing vertices: no cracks. */
    function lerpW(wa, wb, t) {
      const acc = new Map();
      for (let k = 0; k < wa.length; k += 2) acc.set(wa[k], (acc.get(wa[k]) || 0) + wa[k + 1] * (1 - t));
      for (let k = 0; k < wb.length; k += 2) acc.set(wb[k], (acc.get(wb[k]) || 0) + wb[k + 1] * t);
      const out = [];
      acc.forEach(function (v, b) { if (v > 1e-5) out.push(b, v); });
      return out;
    }
    // one context per vertex for the whole finalize: field values are
    // computed once and remembered (the paint asks for them again)
    function ctxOf(S, N, i, fields) {
      const CT = S._ctx || (S._ctx = []);
      let c = CT[i];
      if (c) return c;
      const fv = new Array(fields.length);
      c = CT[i] = {
        i: i, p: S.pos(i), n: [N[i * 3], N[i * 3 + 1], N[i * 3 + 2]], tag: S.tag[i], m: S.m[i], memo: {}, lod: S.lod || 0,
        f: function (k) {
          const fo = S.forced.get(i);
          if (fo && fo[k] != null) return fo[k];
          if (fv[k] === undefined) {
            const v = fields[k] ? fields[k](this) : NaN;
            fv[k] = (v == null || !isFinite(v)) ? NaN : v;
          }
          return fv[k];
        },
      };
      return c;
    }
    function splitPass(S, N, fields, k) {
      const n = S.n, f = new Float64Array(n);
      for (let i = 0; i < n; i++) f[i] = ctxOf(S, N, i, fields).f(k);
      const I = S.ix, out = [], E = new Map();
      function crossing(a, b) {
        const key = a < b ? a * 16777216 + b : b * 16777216 + a;
        let X = E.get(key);
        if (X) return a < b ? X : [X[0], X[1]];
        const t = f[a] / (f[a] - f[b]);
        const P = [mix(S.p[a * 3], S.p[b * 3], t), mix(S.p[a * 3 + 1], S.p[b * 3 + 1], t), mix(S.p[a * 3 + 2], S.p[b * 3 + 2], t)];
        const nn = nrm3([mix(N[a * 3], N[b * 3], t), mix(N[a * 3 + 1], N[b * 3 + 1], t), mix(N[a * 3 + 2], N[b * 3 + 2], t)]);
        const ma = S.m[a], mb = S.m[b], mm = [];
        for (let q = 0; q < ma.length; q++) mm.push(mix(ma[q], mb[q] == null ? ma[q] : mb[q], t));
        const w = lerpW(S.w[a], S.w[b], t);
        const fa = S.forced.get(a), fb = S.forced.get(b);
        const ids = [];
        for (let side = 0; side < 2; side++) {
          const id = S.v(P, w, S.tag[a], mm);
          N.push(nn[0], nn[1], nn[2]);
          const fo = Object.assign({}, fb || {}, fa || {});
          fo[k] = side === 0 ? -1e-9 : 1e-9;
          S.forced.set(id, fo);
          ids.push(id);
        }
        X = ids;               // [negative side, positive side]
        E.set(key, X);
        return X;
      }
      for (let t = 0; t < I.length; t += 3) {
        const a = I[t], b = I[t + 1], c = I[t + 2];
        const fa = f[a], fb = f[b], fc = f[c];
        if (!(isFinite(fa) && isFinite(fb) && isFinite(fc))) { out.push(a, b, c); continue; }
        const sa = fa >= 0, sb = fb >= 0, sc = fc >= 0;
        if (sa === sb && sb === sc) { out.push(a, b, c); continue; }
        let l, m2, n2;
        if (sb === sc) { l = a; m2 = b; n2 = c; } else if (sa === sc) { l = b; m2 = c; n2 = a; } else { l = c; m2 = a; n2 = b; }
        const ls = f[l] >= 0 ? 1 : 0;
        const X1 = crossing(l, m2), X2 = crossing(l, n2);
        out.push(l, X1[ls], X2[ls]);
        out.push(X1[1 - ls], m2, n2);
        out.push(X1[1 - ls], n2, X2[1 - ls]);
      }
      S.ix = out;
    }

    // smooth vertex normals (area weighted) over the shared index buffer
    function normalsOf(S) {
      const P = S.p, I = S.ix, N = new Array(S.n * 3).fill(0);
      for (let t = 0; t < I.length; t += 3) {
        const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
        const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
        const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        N[a] += nx; N[a + 1] += ny; N[a + 2] += nz;
        N[b] += nx; N[b + 1] += ny; N[b + 2] += nz;
        N[c] += nx; N[c + 1] += ny; N[c + 2] += nz;
      }
      for (let i = 0; i < S.n; i++) {
        const x = N[i * 3], y = N[i * 3 + 1], z = N[i * 3 + 2], l = Math.hypot(x, y, z);
        if (l > 1e-20) { N[i * 3] = x / l; N[i * 3 + 1] = y / l; N[i * 3 + 2] = z / l; }
        else { N[i * 3] = 0; N[i * 3 + 1] = 1; N[i * 3 + 2] = 0; }
      }
      return N;
    }

    /* Normals first (on the welded mesh, so a cut line does not crease the
       shading), then the colour lines, then the paint, then the buffers. */
    function finalize(S, paint, fields) {
      const N = normalsOf(S);
      for (let k = 0; k < fields.length; k++) splitPass(S, N, fields, k);
      const n = S.n;
      const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3);
      const spe = new Float32Array(n * 3), mk = new Float32Array(n * 3), si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) {
        pos[i * 3] = S.p[i * 3]; pos[i * 3 + 1] = S.p[i * 3 + 1]; pos[i * 3 + 2] = S.p[i * 3 + 2];
        nor[i * 3] = N[i * 3]; nor[i * 3 + 1] = N[i * 3 + 1]; nor[i * 3 + 2] = N[i * 3 + 2];
        const c = paint(ctxOf(S, N, i, fields));
        col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
        // specular strength, then a fish's scale size and the arc coordinate
        // its scale rows are laid along (0 = no scales)
        spe[i * 3] = c[3] == null ? 0.3 : c[3]; spe[i * 3 + 1] = c[4] || 0; spe[i * 3 + 2] = c[5] || 0;
        // a fine marking the shader draws: its kind, strength and period
        mk[i * 3] = c[6] || 0; mk[i * 3 + 1] = c[7] || 0; mk[i * 3 + 2] = c[8] || 0;
        // four strongest influences, normalised
        const w = S.w[i], pairs = [];
        for (let k = 0; k < w.length; k += 2) {
          let found = false;
          for (let q = 0; q < pairs.length; q++) if (pairs[q][0] === w[k]) { pairs[q][1] += w[k + 1]; found = true; }
          if (!found) pairs.push([w[k], w[k + 1]]);
        }
        pairs.sort(function (A, B) { return B[1] - A[1]; });
        let s = 0;
        for (let q = 0; q < 4 && q < pairs.length; q++) s += pairs[q][1];
        s = s > 1e-9 ? s : 1;
        for (let q = 0; q < 4; q++) {
          si[i * 4 + q] = q < pairs.length ? pairs[q][0] : 0;
          sw[i * 4 + q] = q < pairs.length ? pairs[q][1] / s : 0;
        }
        if (!(pairs.length)) { si[i * 4] = 0; sw[i * 4] = 1; }
      }
      const geo = new T.BufferGeometry();
      geo.setAttribute("position", new T.BufferAttribute(pos, 3));
      geo.setAttribute("normal", new T.BufferAttribute(nor, 3));
      geo.setAttribute("color", new T.BufferAttribute(col, 3));
      geo.setAttribute("mbSpec", new T.BufferAttribute(spe, 3));
      geo.setAttribute("mbMark", new T.BufferAttribute(mk, 3));
      geo.setAttribute("skinIndex", new T.BufferAttribute(si, 4));
      geo.setAttribute("skinWeight", new T.BufferAttribute(sw, 4));
      geo.setIndex(S.ix);
      geo.computeBoundingBox(); geo.computeBoundingSphere();
      // which part each vertex is (skin, chin, palate, tooth, eye, fin...):
      // what a probe or a wound asks of the mesh
      geo.userData.mbTag = Uint8Array.from(S.tag);
      geo._shared = true;
      return geo;
    }

    /* ---- THE SHARED MATERIAL ---------------------------------------------
       Phong, so wet skin and eyes catch a highlight. Two additions through
       onBeforeCompile, one program for every marine body:
         mbSpec  per vertex: specular strength (a shark's skin is matte next
                 to an orca's, a tuna's flank is a mirror, an eye is wet), a
                 bony fish's scale size, and the arc coordinate round the body
                 its scale rows are laid along
         a fine object-space noise on the diffuse (the dermal grain of a
                 shark, the glitter of a fish) so a hand's breadth of skin is
                 never one flat colour
         the scales: overlapping discs in staggered rows, each disc's free
                 margin a dark arc toward the tail and its exposed face a
                 little brighter; they fade out before they shrink below a
                 pixel. All of it reads the REST position, so the pattern is
                 fixed to the animal and swims with it. */
    let MAT = null;
    function material() {
      if (MAT) return MAT;
      MAT = new T.MeshPhongMaterial({ vertexColors: true, shininess: 38, specular: new T.Color(0.34, 0.35, 0.36) });
      MAT.name = "marineBody";
      MAT.onBeforeCompile = function (sh) {
        sh.vertexShader = sh.vertexShader
          .replace("#include <common>", "#include <common>\nattribute vec3 mbSpec;\nattribute vec3 mbMark;\nvarying float vMbSpec;\nvarying vec2 vMbSc;\nvarying vec3 vMbP;\nvarying vec3 vMbMark;")
          .replace("#include <begin_vertex>", "#include <begin_vertex>\nvMbSpec = mbSpec.x;\nvMbSc = mbSpec.yz;\nvMbP = position;\nvMbMark = mbMark;");
        sh.fragmentShader = sh.fragmentShader
          .replace("#include <common>", "#include <common>\nvarying float vMbSpec;\nvarying vec2 vMbSc;\nvarying vec3 vMbP;\nvarying vec3 vMbMark;\n" +
            "float mbH(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }\n" +
            "float mbN(vec3 x){ vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);\n" +
            "  return mix(mix(mix(mbH(i), mbH(i + vec3(1,0,0)), f.x), mix(mbH(i + vec3(0,1,0)), mbH(i + vec3(1,1,0)), f.x), f.y),\n" +
            "             mix(mix(mbH(i + vec3(0,0,1)), mbH(i + vec3(1,0,1)), f.x), mix(mbH(i + vec3(0,1,1)), mbH(i + vec3(1,1,1)), f.x), f.y), f.z); }")
          .replace("#include <color_fragment>", "#include <color_fragment>\n" +
            "diffuseColor.rgb *= 0.94 + 0.08 * mbN(vMbP * 21.0) + 0.04 * mbN(vMbP * 67.0);\n" +
            // no branch: derivatives must be taken on every fragment
            "vec2 mbQ = vec2(-vMbP.x, vMbSc.y) / max(vMbSc.x, 1e-3);\n" +
            "float mbFade = step(1e-5, vMbSc.x) * (1.0 - smoothstep(0.18, 0.5, max(fwidth(mbQ.x), fwidth(mbQ.y))));\n" +
            "mbQ.y += 0.5 * mod(floor(mbQ.x), 2.0);\n" +
            "vec2 mbF = fract(mbQ);\n" +
            "float mbD = length(vec2(mbF.x, (mbF.y - 0.5) * 1.15));\n" +
            "float mbRim = smoothstep(0.80, 0.95, mbD) * (1.0 - 0.5 * smoothstep(1.0, 1.12, mbD)) * mbFade;\n" +
            "float mbFace = (1.0 - smoothstep(0.3, 0.9, mbD)) * mbFade;\n" +
            "diffuseColor.rgb *= (1.0 - 0.18 * mbRim) * (1.0 + 0.06 * mbFace);\n" +
            // the fine markings, in units of their period along the body (X)
            // and round it (A): 1 a mackerel's wavy bars, 2 a marlin's bars
            // of pale dots, 3 a tuna's rows of pale dots and lines, 4 a
            // barracuda's oblique bars, 5 its blotches. They fade before
            // they alias.
            "vec2 mbPU = vec2(-vMbP.x, vMbSc.y) / max(vMbMark.z, 1e-3);\n" +
            "float mbPF = max(fwidth(mbPU.x), fwidth(mbPU.y)) + 1e-4;\n" +
            "float mbPS = vMbMark.y * (1.0 - smoothstep(0.22, 0.55, mbPF));\n" +
            "if (mbPS > 0.002) {\n" +
            "  float X = mbPU.x, A = mbPU.y, m;\n" +
            "  if (vMbMark.x < 1.5) {\n" +
            "    float b = X + 0.30 * sin(A * 2.1 + X * 0.6) + 0.12 * sin(A * 5.3 + X * 2.1);\n" +
            "    m = 1.0 - smoothstep(0.2 - mbPF, 0.2 + mbPF, abs(fract(b) - 0.5));\n" +
            "    diffuseColor.rgb *= 1.0 - 0.68 * m * mbPS;\n" +
            "  } else if (vMbMark.x < 2.5) {\n" +
            "    vec2 cc = vec2(fract(X) - 0.5, fract(A * 1.6) - 0.5);\n" +
            "    m = 1.0 - smoothstep(0.2 - mbPF, 0.2 + mbPF, length(cc * vec2(1.0, 0.75)));\n" +
            "    m = max(m, 0.55 * (1.0 - smoothstep(0.05 - mbPF, 0.05 + mbPF, abs(fract(X) - 0.5))));\n" +
            "    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.40, 0.60, 0.92), 0.8 * m * mbPS);\n" +
            "  } else if (vMbMark.x < 3.5) {\n" +
            "    vec2 cc = vec2(fract(X) - 0.5, fract(A * 2.4) - 0.5);\n" +
            "    m = 1.0 - smoothstep(0.16 - mbPF, 0.16 + mbPF, length(cc));\n" +
            "    m = max(m, 1.0 - smoothstep(0.04 - mbPF, 0.04 + mbPF, abs(fract(X + 0.5) - 0.5)));\n" +
            "    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.82, 0.86, 0.90), 0.4 * m * mbPS);\n" +
            "  } else if (vMbMark.x < 4.5) {\n" +
            "    float b = X + 0.55 * A + 0.15 * sin(A * 1.7);\n" +
            "    m = 1.0 - smoothstep(0.17 - mbPF, 0.17 + mbPF, abs(fract(b) - 0.5));\n" +
            "    diffuseColor.rgb *= 1.0 - 0.45 * m * mbPS;\n" +
            "  } else {\n" +
            "    m = smoothstep(0.70 - mbPF, 0.70 + mbPF, mbN(vec3(X * 1.3, A * 1.3, 7.1)));\n" +
            "    diffuseColor.rgb *= 1.0 - 0.85 * m * mbPS;\n" +
            "  }\n" +
            "}")
          .replace("#include <specularmap_fragment>", "#include <specularmap_fragment>\nspecularStrength = vMbSpec * (1.0 + 0.35 * mbFace);");
      };
      MAT.customProgramCacheKey = function () { return "marineBody4"; };
      MAT._shared = true;
      return MAT;
    }

    /* ==================================================================
       THE SWIMMER BODY — sharks, bony fish, cetaceans.

       s runs from 0 at the snout tip to 1 at the tip of the tail (total
       length L). A station's cross-section is a superellipse with separate
       half-heights above (top) and below (bot) its centre line and a
       half-width (half); exponents shape it (2 = ellipse, higher = boxier,
       lower = keeled). Ring vertices are indexed so the lower arc between
       the two mouth corners is a fixed index range [0, mL]: that is what
       lets the mouth be a CUT in the skin — the chin is the lower arc of the
       head rings, the upper lip the rest — with one topology for every ring.
       ================================================================== */
    function stationsOf(spec, lv) {
      const out = [];
      const sb = spec.noseRound;
      const K = lv.noseRings;
      for (let k = 1; k <= K; k++) out.push({ s: sb * (1 - Math.cos(Math.PI * 0.5 * k / K)), key: k === K });
      const s1 = spec.tubeEnd;
      let s = sb;
      while (s < s1 - 1e-6) {
        const step = s < spec.headEnd ? lv.ds * lv.headK : lv.ds;
        s = Math.min(s1, s + step);
        out.push({ s: s });
      }
      const keep = (spec.keys || []).slice();
      if (spec.mouth) keep.push({ s: spec.mouth.front, key: "mf" }, { s: spec.mouth.corner, key: "mc" });
      if (spec.eye && spec.eye.s != null && lv.eyeRings) {
        const r = spec.eye.r;
        keep.push({ s: spec.eye.s - r * 1.6, key: 1 }, { s: spec.eye.s, key: 1 }, { s: spec.eye.s + r * 1.6, key: 1 });
      }
      if (spec.gills && lv.gills) {
        const G = spec.gills;
        for (let k = 0; k < G.n; k++) {
          const sg = G.n > 1 ? mix(G.s0, G.s1, k / (G.n - 1)) : G.s0;
          keep.push({ s: sg - G.gap, key: "g0", gi: k }, { s: sg, key: "g1", gi: k }, { s: sg + G.gap * 0.8, key: "g2", gi: k });
        }
      }
      // specials win; a plain station closer than a third of a step to one goes
      const minGap = lv.ds * 0.34;
      const all = out.filter(function (o) {
        if (o.key) return true;
        for (let q = 0; q < keep.length; q++) if (Math.abs(keep[q].s - o.s) < minGap) return false;
        return true;
      }).concat(keep);
      all.sort(function (a, b) { return a.s - b.s; });
      const res = [];
      for (let i = 0; i < all.length; i++) {
        if (res.length && Math.abs(all[i].s - res[res.length - 1].s) < 1e-5) {
          if (all[i].key) Object.assign(res[res.length - 1], all[i]);
          continue;
        }
        res.push(Object.assign({}, all[i]));
      }
      return res;
    }

    function makeProfile(spec) {
      const P = spec.profile;
      return {
        top: curve(P.top), bot: curve(P.bot), half: curve(P.half), yo: curve(P.yo || 0),
        nT: curve(P.nT || 2), nB: curve(P.nB || 2), nS: curve(P.nS || 2),
        keel: curve(P.keel || 0),
      };
    }
    // the cross-section at s, in model units
    function sectionAt(spec, PF, s) {
      const L = spec.L;
      const sb = spec.noseRound;
      // the snout tip is rounded (an elliptic cap), not a cone point
      const rk = s < sb ? Math.sqrt(Math.max(0, 1 - Math.pow(1 - s / sb, 2))) : 1;
      const tail = spec.tubeEnd;
      const tk = s > tail - 0.012 ? Math.sqrt(Math.max(0.02, 1 - Math.pow((s - (tail - 0.012)) / 0.012, 2))) : 1;
      return {
        s: s, x: spec.xNose - s * L, yc: spec.axisY + PF.yo(s) * L,
        top: Math.max(1e-4, PF.top(s) * L * rk * tk), bot: Math.max(1e-4, PF.bot(s) * L * rk * tk),
        half: Math.max(1e-4, PF.half(s) * L * rk * tk),
        eT: 2 / PF.nT(s), eB: 2 / PF.nB(s), eS: 2 / PF.nS(s),
        keel: PF.keel(s) * L,
      };
    }
    // a point on a section at ring angle phi (0 = ventral midline, pi/2 = +z
    // flank, pi = dorsal midline, 3pi/2 = -z flank)
    function ringPoint(R, phi) {
      const cy = -Math.cos(phi), sz = Math.sin(phi);
      const yy = cy >= 0 ? R.top * Math.pow(cy, R.eT) : -R.bot * Math.pow(-cy, R.eB);
      const az = Math.abs(sz);
      let zz = R.half * Math.pow(az, R.eS) * (sz < 0 ? -1 : 1);
      if (R.keel > 0) zz += (sz < 0 ? -1 : 1) * R.keel * Math.exp(-(cy * cy) / 0.010) * az;
      return [R.x, R.yc + yy, zz];
    }
    function ringNormal(R, phi) {
      const e = 1e-3;
      const a = ringPoint(R, phi - e), b = ringPoint(R, phi + e);
      const tng = sub3(b, a);
      // outward in the ring's plane: +x cross the tangent of increasing phi
      return nrm3(crs([1, 0, 0], tng));
    }

    /* ---- the skeleton's spine: which bone owns which stretch of body ----
       chain = { b: [bone ids front to back], J: [x of the boundary between
       b[k] and b[k+1]] (descending), hw: [half width of each blend] }. A bone
       owns the stretch between its two boundaries, and every boundary is a
       linear blend across 2*hw, so the body bends as one smooth curve instead
       of hinging at the joints. */
    function chainWeights(C, x) {
      const J = C.J, n = C.b.length;
      let r = 0;
      while (r < n - 1 && x < J[r]) r++;
      // nearest boundary: the one above (r-1) or below (r)
      let q = -1, best = Infinity;
      if (r - 1 >= 0 && Math.abs(x - J[r - 1]) < best) { best = Math.abs(x - J[r - 1]); q = r - 1; }
      if (r < n - 1 && Math.abs(x - J[r]) < best) { best = Math.abs(x - J[r]); q = r; }
      if (q >= 0 && best < C.hw[q]) {
        const t = sm((J[q] + C.hw[q] - x) / (2 * C.hw[q]));
        return [C.b[q], 1 - t, C.b[q + 1], t];
      }
      return [C.b[r], 1];
    }

    function buildSwimmer(spec, lod) {
      const lv = spec.lod[lod];
      const L = spec.L;
      const PF = makeProfile(spec);
      const st = stationsOf(spec, lv);
      const M = lv.M;
      const mo = spec.mouth;
      const mL = mo ? Math.max(2, 2 * Math.round(M * mo.alphaC / TAU)) : 2 * Math.round(M * 0.2);
      const aU = Math.PI * mL / M;
      const S = new Store();
      const B = spec.boneIx;

      // stations -> sections
      const R = st.map(function (o) { const r = sectionAt(spec, PF, o.s); r.key = o.key; r.gi = o.gi; return r; });
      const nR = R.length;
      let iF = -1, iC = -1;
      for (let i = 0; i < nR; i++) { if (R[i].key === "mf") iF = i; if (R[i].key === "mc") iC = i; }
      const hasMouth = !!(mo && iF >= 0 && iC > iF);

      // the lower-arc half-angle per ring (the mouth's plan shape lives here)
      function alphaAt(s) {
        if (!hasMouth) return aU;
        const sF = mo.front, sC = mo.corner;
        if (s >= sC) return mix(mo.alphaC, aU, sm((s - sC) / 0.05));
        if (s >= sF) return mo.alphaF + (mo.alphaC - mo.alphaF) * Math.pow((s - sF) / (sC - sF), mo.shape || 0.6);
        return mix(aU, mo.alphaF, sm(1 - (sF - s) / Math.max(1e-4, mo.snoutBlend || 0.03)));
      }
      function phiOf(j, a) {
        if (j <= mL) return -a + 2 * a * j / mL;
        return a + (TAU - 2 * a) * (j - mL) / (M - mL);
      }

      // the spine chain and the jaw/eye/gill/fin weight rules
      const chain = spec.chain;   // built by the template (x positions in model units)
      const xC = hasMouth ? R[iC].x : 0, xFm = hasMouth ? R[iF].x : 0;
      const mouthLen = hasMouth ? xFm - xC : 0;
      function bodyW(P, j, i) {
        let w = chainWeights(chain, P[0]);
        if (!hasMouth) return w;
        // the throat skin behind the mouth corners stretches with the jaw
        const behind = xC - P[0];
        if (behind >= 0 && behind < mouthLen * (spec.mouth.throat || 0.8)) {
          const phi = phiOf(j, alphaAt(R[i].s));
          const low = sm((Math.cos(phi) - 0.15) / 0.6);       // 1 on the ventral midline
          const k = low * (1 - sm(behind / (mouthLen * (spec.mouth.throat || 0.8)))) * 0.85;
          if (k > 0.001) w = scaleW(w, 1 - k).concat([B.jaw, k]);
        }
        return w;
      }
      function scaleW(w, k) { const o = []; for (let q = 0; q < w.length; q += 2) o.push(w[q], w[q + 1] * k); return o; }

      // ---- eyes: the socket depression -----------------------------------
      const EY = spec.eye ? eyeCentres(spec, PF) : null;
      function eyeDeform(P, N) {
        if (!EY) return P;
        for (let e = 0; e < 2; e++) {
          const E = EY[e], dx = P[0] - E.skin[0], dy = P[1] - E.skin[1], dz = P[2] - E.skin[2];
          const d2 = dx * dx + dy * dy + dz * dz, R2 = E.r * E.r * 5.2;
          if (d2 < R2) {
            const k = Math.pow(1 - d2 / R2, 2) * E.r * (spec.eye.socket == null ? 0.30 : spec.eye.socket);
            P = [P[0] - N[0] * k, P[1] - N[1] * k, P[2] - N[2] * k];
          }
        }
        return P;
      }
      // ---- gill slits: a groove ring and a flap ring per slit --------------
      const G = spec.gills;
      function gillDeform(Ri, phi, P, N) {
        if (!G || !lv.gills || Ri.gi == null || (Ri.key !== "g1" && Ri.key !== "g2")) return { P: P, g: 0 };
        // elevation above the lateral midline, either flank
        const el = Math.asin(cl(-Math.cos(phi), -1, 1));            // -pi/2 bottom .. +pi/2 top
        const k = Ri.gi, frac = G.n > 1 ? k / (G.n - 1) : 0;
        const lo = mix(G.lo0, G.lo1, frac), hi = mix(G.hi0, G.hi1, frac);
        if (el < lo || el > hi) return { P: P, g: 0 };
        const u = (el - lo) / (hi - lo);
        const bump = Math.pow(Math.sin(Math.PI * u), 0.55);
        const d = (Ri.key === "g1" ? -G.depth : G.flap) * L * bump;
        // the slit leans: its top sits further back than its foot
        const slant = G.slant * L * (u - 0.5);
        return { P: [P[0] + N[0] * d - slant, P[1] + N[1] * d, P[2] + N[2] * d], g: Ri.key === "g1" ? bump : -bump };
      }

      // ---- the hull rings -----------------------------------------------
      const up = [], lo = [];
      const lipDrop = hasMouth ? (mo.lipDrop || 0.0012) * L : 0;
      const chinIn = hasMouth ? (mo.chinInset || 0.0035) * L : 0;
      for (let i = 0; i < nR; i++) {
        const Ri = R[i], a = alphaAt(Ri.s);
        const U = new Array(M), D = new Array(M);
        for (let j = 0; j < M; j++) {
          const phi = phiOf(j, a);
          let P = ringPoint(Ri, phi);
          const N = ringNormal(Ri, phi);
          P = eyeDeform(P, N);
          const gd = gillDeform(Ri, phi, P, N);
          P = gd.P;
          // meta: [s, cos phi, sin phi, gill]
          const meta = [Ri.s, Math.cos(phi), Math.sin(phi), gd.g];
          const cut = hasMouth && ((i > iF && i < iC && (j === 0 || j === mL)) || (i === iF && j <= mL));
          if (!cut) {
            const w = (hasMouth && i >= iF && i < iC && j > 0 && j < mL) ? [B.jaw, 1] : bodyW(P, j, i);
            const id = S.v(P, w, (hasMouth && i >= iF && i <= iC && j >= 0 && j <= mL) ? TAG.CHIN : TAG.SKIN, meta);
            U[j] = D[j] = id;
          } else {
            // upper lip: a hair lower and proud, so it overhangs the chin's
            const side = j === 0 ? -1 : (j === mL ? 1 : 0);
            const Pu = [P[0], P[1] - lipDrop, P[2] + side * lipDrop * 0.6];
            const wU = i === iF && side === 0
              ? chainWeights(chain, P[0]).map(function (v, q) { return q % 2 ? v * 0.5 : v; }).concat([B.upperJaw, 0.5])
              : chainWeights(chain, P[0]).map(function (v, q) { return q % 2 ? v * 0.55 : v; }).concat([B.upperJaw, 0.45]);
            U[j] = S.v(Pu, wU, TAG.SKIN, [Ri.s, meta[1], meta[2], -2]);
            // lower lip: inset, so the upper teeth close OUTSIDE it
            let Pd;
            if (side !== 0) Pd = ringPoint(Ri, phi - side * chinIn / Math.max(1e-3, Ri.half));
            else Pd = [P[0] - chinIn, P[1], P[2]];
            D[j] = S.v(Pd, [B.jaw, 1], TAG.CHIN, [Ri.s, meta[1], meta[2], -3]);
          }
        }
        up.push(U); lo.push(D);
      }
      // the corner ring's lips are shared skin: half head, half jaw
      if (hasMouth) {
        [0, mL].forEach(function (j) {
          const id = up[iC][j];
          S.w[id] = chainWeights(chain, S.p[id * 3]).map(function (v, q) { return q % 2 ? v * 0.5 : v; }).concat([B.jaw, 0.5]);
        });
      }
      for (let i = 0; i < nR - 1; i++) {
        for (let j = 0; j < M; j++) {
          const j2 = (j + 1) % M;
          const chinQuad = hasMouth && j < mL && i >= iF && i + 1 <= iC;
          const A = chinQuad ? lo : up;
          S.qr(A[i][j], A[i][j2], A[i + 1][j2], A[i + 1][j]);
        }
      }
      // snout tip and tail end: rounded caps to a point
      {
        const R0 = R[0];
        const tipP = [spec.xNose, spec.axisY + PF.yo(0) * L, 0];
        const tip = S.v(tipP, chainWeights(chain, tipP[0]), TAG.SKIN, [0, -1, 0, 0]);
        for (let j = 0; j < M; j++) {
          const j2 = (j + 1) % M;
          S.q(tip, up[0][j2], up[0][j], up[0][j], [1, 0, 0]);
          void R0;
        }
        const RL = R[nR - 1];
        const endP = [RL.x - Math.min(RL.half, RL.top) * 0.6, RL.yc, 0];
        const end = S.v(endP, chainWeights(chain, endP[0]), TAG.SKIN, [RL.s, -1, 0, 0]);
        for (let j = 0; j < M; j++) {
          const j2 = (j + 1) % M;
          S.q(end, up[nR - 1][j], up[nR - 1][j2], up[nR - 1][j2], [-1, 0, 0]);
        }
      }

      // ---- the mouth: cavity, gums, teeth ----------------------------------
      let mouthInfo = null;
      if (hasMouth) mouthInfo = buildMouth(S, spec, lv, R, up, lo, iF, iC, mL, chain);
      // ---- eyes -------------------------------------------------------------
      if (EY) for (let e = 0; e < 2; e++) buildEye(S, spec, EY[e], spec.eye.fixed ? B.head : (e === 0 ? B.eyeR : B.eyeL), lv);
      // ---- fins -------------------------------------------------------------
      const finInfo = {};
      const fins = spec.fins || [];
      for (let f = 0; f < fins.length; f++) {
        if (fins[f].lodMax != null && lod > fins[f].lodMax) continue;     // finlets: near only
        const fi = buildFin(S, spec, PF, fins[f], lv, chain, f + 1);
        if (fi) finInfo[fins[f].name] = fi;
      }
      // ---- species extras (tubercles, baleen, ...) ---------------------------
      if (spec.extras) spec.extras(S, { spec: spec, lv: lv, R: R, PF: PF, chain: chain, sectionAt: function (s) { return sectionAt(spec, PF, s); }, ringPoint: ringPoint, ringNormal: ringNormal, mouth: mouthInfo, TAG: TAG, dome: dome, chainWeights: chainWeights, B: spec.boneIx });

      S.lod = lod;
      const geo = finalize(S, spec.paint, spec.fields || []);
      return { geo: geo, mouth: mouthInfo, fins: finInfo, eyes: EY, stations: R.length, M: M };
    }

    // where the two eyes sit: on the skin at (s, elevation), and the centre
    // of the eyeball a fraction of its radius inside it
    function eyeCentres(spec, PF) {
      const E = spec.eye, L = spec.L;
      if (E.pos) {
        // an eye the hull grammar cannot reach (a hammerhead's on the end of
        // its cephalofoil): placed directly, [s, dy, dz] as fractions of L
        return [1, -1].map(function (side) {
          const r = E.r * L;
          const C = [spec.xNose - E.pos[0] * L, spec.axisY + E.pos[1] * L, E.pos[2] * L * side];
          const look = nrm3([E.look[0], E.look[1], E.look[2] * side]);
          const skin = [C[0] + look[0] * r * 0.6, C[1] + look[1] * r * 0.6, C[2] + look[2] * r * 0.6];
          return { side: side, skin: skin, n: look, c: C, r: r, look: look };
        });
      }
      const R = sectionAt(spec, PF, E.s);
      const out = [];
      [1, -1].forEach(function (side) {
        // elevation above the lateral midline -> ring angle
        const phi = side > 0 ? Math.PI / 2 + E.up : 1.5 * Math.PI - E.up;
        const P = ringPoint(R, phi), N = ringNormal(R, phi);
        const r = E.r * L;
        const look = nrm3([N[0] + (E.fwd || 0.12), N[1] + (E.lookUp || 0), N[2]]);
        // a flattened eye (a bony fish's: E.flat of its radius deep along the
        // line of sight) is sunk so only E.out of r stands proud of the skin
        const sink = (E.flat || 1) - (E.out == null ? 0.42 : E.out);
        const C = [P[0] - N[0] * r * sink, P[1] - N[1] * r * sink, P[2] - N[2] * r * sink];
        out.push({ side: side, skin: P, n: N, c: C, r: r, look: look });
      });
      return out;
    }

    /* An eyeball: a sphere about its own centre, coloured by the angle from
       the line of sight — pupil, iris, a dark limbal ring, then the white
       of the eye on the back half. The roll (city/wildlife_rig.js) turns the
       back half out: a great white's eye rolling white at the bite. */
    function buildEye(S, spec, E, bone, lv) {
      const nU = lv.eyeSeg || 12, nV = lv.eyeRing || 8;
      const f = E.look, fl = spec.eye.flat || 1;
      let upv = [0, 1, 0];
      const rgt = nrm3(crs(f, upv));
      upv = nrm3(crs(rgt, f));
      const rows = [];
      for (let v = 0; v <= nV; v++) {
        const th = Math.PI * v / nV;                // 0 = pupil centre, pi = back pole
        const row = [];
        const ringN = v === 0 || v === nV ? 1 : nU;
        for (let u = 0; u < ringN; u++) {
          const ps = TAU * u / nU;
          const dir = [f[0] * Math.cos(th) * fl + (rgt[0] * Math.cos(ps) + upv[0] * Math.sin(ps)) * Math.sin(th),
            f[1] * Math.cos(th) * fl + (rgt[1] * Math.cos(ps) + upv[1] * Math.sin(ps)) * Math.sin(th),
            f[2] * Math.cos(th) * fl + (rgt[2] * Math.cos(ps) + upv[2] * Math.sin(ps)) * Math.sin(th)];
          const P = [E.c[0] + dir[0] * E.r, E.c[1] + dir[1] * E.r, E.c[2] + dir[2] * E.r];
          row.push(S.v(P, [bone, 1], TAG.EYE, [th, ps, E.side, 0]));
        }
        rows.push(row);
      }
      for (let v = 0; v < nV; v++) {
        const A = rows[v], Bv = rows[v + 1];
        for (let u = 0; u < nU; u++) {
          const u2 = (u + 1) % nU;
          const a = A[A.length === 1 ? 0 : u], b = A[A.length === 1 ? 0 : u2];
          const c = Bv[Bv.length === 1 ? 0 : u2], d = Bv[Bv.length === 1 ? 0 : u];
          const mid = S.pos(c);
          S.q(a, b, c, d, sub3(mid, E.c));
        }
      }
    }

    /* ---- THE MOUTH ---------------------------------------------------------
       The lips are already cut into the hull (up[] = the head's side of the
       cut, lo[] = the chin's). This hangs the inside on them: a palate from
       the upper lip up into the head, a floor from the lower lip over the
       chin, the two joining at the corners and running back as the pharynx,
       which closes blind inside the body. Gum bands along both lips carry the
       rows of teeth. The palate and the upper teeth ride the upper jaw bone
       (it protrudes), the floor and lower teeth ride the lower jaw. */
    function buildMouth(S, spec, lv, R, up, lo, iF, iC, mL, chain) {
      const mo = spec.mouth, L = spec.L, B = spec.boneIx;
      const rows = iC - iF;
      const pal = [], flo = [];
      const cavCentre = [];
      for (let i = iF; i <= iC; i++) {
        const Ri = R[i];
        const lipL = S.pos(up[i][0]), lipR = S.pos(up[i][mL]);
        const yLip = (lipL[1] + lipR[1]) * 0.5;
        const yBot = Ri.yc - Ri.bot;
        cavCentre.push([Ri.x, yLip, 0]);
        const rowP = [], rowF = [];
        const front = i === iF, corner = i === iC;
        const ti = (i - iF) / Math.max(1, rows);
        for (let k = 0; k <= mL; k++) {
          const t = k / mL;
          // ---- palate
          let ip;
          if (front) ip = up[i][k];
          else if (k === 0 || k === mL) ip = up[i][k];
          else {
            const hP = Math.max(0.002 * L, (Ri.yc - yLip) * (mo.palate == null ? 0.55 : mo.palate)) * sm(ti * 3.2 + 0.15);
            const P = [Ri.x, yLip + hP * Math.pow(Math.sin(Math.PI * t), 0.6), mix(lipL[2], lipR[2], t) * (1 - 0.06 * Math.sin(Math.PI * t))];
            // the gum band nearest the lips protrudes with the upper jaw
            const gum = Math.min(t, 1 - t) < 0.2 || ti < 0.25;
            const w = gum ? [B.upperJaw, 0.8].concat(scale(chainWeights(chain, P[0]), 0.2))
              : [B.upperJaw, 0.25].concat(scale(chainWeights(chain, P[0]), 0.75));
            ip = S.v(P, w, TAG.PALATE, [ti, t, 0, 0]);
          }
          rowP.push(ip);
          // ---- floor
          let iflo;
          if (front) iflo = lo[i][k];
          else if (k === 0 || k === mL) iflo = lo[i][k];
          else {
            const skin = S.pos(lo[i][k]);
            const lipLL = S.pos(lo[i][0]), lipRR = S.pos(lo[i][mL]);
            const yL = (lipLL[1] + lipRR[1]) * 0.5;
            const tJ = Math.max(0.0015 * L, (yL - yBot) * 0.16);
            const yF = Math.max(skin[1] + tJ, yL - (yL - yBot) * (mo.floor == null ? 0.45 : mo.floor) * Math.pow(Math.sin(Math.PI * t), 0.8));
            const P = [Ri.x, Math.min(yF, yL + 0.0005 * L), mix(lipLL[2], lipRR[2], t) * 0.97];
            iflo = S.v(P, [B.jaw, 1], TAG.FLOOR, [ti, t, 0, 0]);
          }
          rowF.push(iflo);
          if (corner && (k === 0 || k === mL)) { /* shared corner */ }
        }
        pal.push(rowP); flo.push(rowF);
      }
      // the pharynx: behind the corners the roof and floor close into a tube
      const iCr = iC;
      const RC = R[iCr];
      const cornerL = S.pos(up[iCr][0]), cornerR = S.pos(up[iCr][mL]);
      const yLipC = (cornerL[1] + cornerR[1]) * 0.5;
      const phLen = (mo.pharynx || 0.07) * L;
      const nPh = lv.pharynx || 4;
      let prevP = pal[pal.length - 1], prevF = flo[flo.length - 1];
      for (let q = 1; q <= nPh; q++) {
        const tau = q / nPh;
        const x = RC.x - phLen * tau;
        const yc = mix(yLipC, RC.yc - RC.bot * 0.25, tau * 0.5);
        const zH = Math.abs(cornerR[2]) * (1 - 0.55 * tau) * (q === nPh ? 0.02 : 1);
        const hR = Math.max(0.001 * L, (RC.yc - yLipC) * 0.45 * (1 - 0.6 * tau)) * (q === nPh ? 0.05 : 1);
        const hF = Math.max(0.001 * L, (yLipC - (RC.yc - RC.bot)) * 0.38 * (1 - 0.6 * tau)) * (q === nPh ? 0.05 : 1);
        const rowP = [], rowF = [];
        let eL = -1, eR = -1;
        for (let k = 0; k <= mL; k++) {
          const t = k / mL;
          const z = mix(-zH, zH, t);
          if (k === 0 || k === mL) {
            const P = [x, yc, z];
            // the side walls hang half off the jaw at the corners and none at
            // the blind end, so the throat opens with the jaw and tapers shut
            const jw = 0.4 * (1 - tau);
            const w = [B.jaw, jw].concat(scale(chainWeights(chain, x), 1 - jw));
            const id = S.v(P, w, TAG.PALATE, [1 + tau, t, 1, 0]);
            if (k === 0) eL = id; else eR = id;
            rowP.push(id); rowF.push(id);
            continue;
          }
          const sn = Math.pow(Math.sin(Math.PI * t), 0.6);
          rowP.push(S.v([x, yc + hR * sn, z], chainWeights(chain, x), TAG.PALATE, [1 + tau, t, 1, 0]));
          const wF = [B.jaw, 0.8 * (1 - tau)].concat(scale(chainWeights(chain, x), 1 - 0.8 * (1 - tau)));
          rowF.push(S.v([x, yc - hF * sn, z], wF, TAG.FLOOR, [1 + tau, t, 1, 0]));
        }
        void eL; void eR;
        pal.push(rowP); flo.push(rowF);
        cavCentre.push([x, yc, 0]);
        prevP = rowP; prevF = rowF;
      }
      void prevP; void prevF;
      // quads: palate faces down into the cavity, floor faces up into it
      for (let r = 0; r < pal.length - 1; r++) {
        const cc = cavCentre[r], cn = cavCentre[r + 1];
        for (let k = 0; k < mL; k++) {
          const a = pal[r][k], b = pal[r][k + 1], c = pal[r + 1][k + 1], d = pal[r + 1][k];
          const mid = S.pos(c), mp = S.pos(a);
          const ctr = [(cc[0] + cn[0]) * 0.5, (cc[1] + cn[1]) * 0.5 - 0.004 * L, 0];
          S.q(a, b, c, d, sub3(ctr, [(mid[0] + mp[0]) * 0.5, (mid[1] + mp[1]) * 0.5, (mid[2] + mp[2]) * 0.5]));
          const fa = flo[r][k], fb = flo[r][k + 1], fc = flo[r + 1][k + 1], fd = flo[r + 1][k];
          const m1 = S.pos(fc), m0 = S.pos(fa);
          const ctr2 = [(cc[0] + cn[0]) * 0.5, (cc[1] + cn[1]) * 0.5 + 0.004 * L, 0];
          S.q(fa, fb, fc, fd, sub3(ctr2, [(m1[0] + m0[0]) * 0.5, (m1[1] + m0[1]) * 0.5, (m1[2] + m0[2]) * 0.5]));
        }
      }

      // ---- teeth along both lips -----------------------------------------------
      const TT = mo.teeth;
      let upperN = 0, lowerN = 0;
      const lipPolyU = [], lipPolyD = [];
      for (let i = iC; i > iF; i--) { lipPolyU.push(S.pos(up[i][0])); lipPolyD.push(S.pos(lo[i][0])); }
      for (let k = 0; k <= mL; k++) { lipPolyU.push(S.pos(up[iF][k])); lipPolyD.push(S.pos(lo[iF][k])); }
      for (let i = iF + 1; i <= iC; i++) { lipPolyU.push(S.pos(up[i][mL])); lipPolyD.push(S.pos(lo[i][mL])); }
      const ctrMouth = [mix(R[iF].x, R[iC].x, 0.55), 0, 0];
      if (TT && lv.teeth) {
        const rowsU = TT.upper || [], rowsD = TT.lower || [];
        for (let r = 0; r < rowsU.length; r++) upperN += teethRow(S, spec, lipPolyU, rowsU[r], 1, B.upperJaw, ctrMouth);
        for (let r = 0; r < rowsD.length; r++) lowerN += teethRow(S, spec, lipPolyD, rowsD[r], -1, B.jaw, ctrMouth);
      }
      if (mo.baleen && lv.teeth) baleenRow(S, spec, lipPolyU, mo.baleen, B.upperJaw, ctrMouth);
      const front = S.pos(up[iF][mL >> 1]);
      return {
        hingeX: R[iC].x, hingeY: yLipC, frontX: R[iF].x, frontY: front[1],
        width: Math.abs(cornerR[2] - cornerL[2]), upperTeeth: upperN, lowerTeeth: lowerN,
        lipY: front[1],
      };
    }
    function scale(w, k) { const o = []; for (let q = 0; q < w.length; q += 2) o.push(w[q], w[q + 1] * k); return o; }

    // resample a polyline to n points by arc length, with tangents
    function resample(poly, n, u0, u1) {
      const cum = [0];
      for (let i = 1; i < poly.length; i++) cum.push(cum[i - 1] + Math.hypot(poly[i][0] - poly[i - 1][0], poly[i][1] - poly[i - 1][1], poly[i][2] - poly[i - 1][2]));
      const tot = cum[cum.length - 1] || 1;
      const out = [];
      for (let k = 0; k < n; k++) {
        const u = n > 1 ? mix(u0, u1, k / (n - 1)) : (u0 + u1) * 0.5;
        const d = u * tot;
        let i = 1;
        while (i < cum.length - 1 && cum[i] < d) i++;
        const t = (d - cum[i - 1]) / Math.max(1e-9, cum[i] - cum[i - 1]);
        const a = poly[i - 1], b = poly[i];
        out.push({ u: u, p: [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)], tg: nrm3(sub3(b, a)) });
      }
      return out;
    }
    /* One row of teeth: flat blades on the gum, crowns pointing across the
       gape, tallest in front and smaller and more raked toward the corners.
       `dir` +1 = upper (crowns down), -1 = lower (crowns up). */
    function teethRow(S, spec, poly, row, dir, bone, ctr) {
      const L = spec.L;
      // a row may stop short of the corners (row.span of the jaw's U)
      const sp = row.span == null ? 0.93 : row.span;
      const pts = resample(poly, row.n, 0.5 - sp * 0.5, 0.5 + sp * 0.5);
      for (let k = 0; k < pts.length; k++) {
        const P = pts[k], u = P.u;
        const centre = 1 - Math.abs(u - 0.5) * 2;           // 1 at the front, 0 at the corners
        // row.jag: teeth of unequal height (a barracuda's), fixed per tooth
        const jag = row.jag ? 1 - row.jag * VAL[(k * 37 + (dir > 0 ? 11 : 53)) & 255] : 1;
        const h = jag * (row.h * L * (row.cornerK == null ? 0.42 : row.cornerK) + row.h * L * (1 - (row.cornerK == null ? 0.42 : row.cornerK)) * Math.pow(centre, 0.55));
        const bw = Math.min(row.w * L * (0.55 + 0.45 * Math.pow(centre, 0.5)), h * 1.1);
        // inward (toward the mouth's middle, in plan) and the crown direction
        const inw = nrm3([ctr[0] - P.p[0], 0, ctr[2] - P.p[2]]);
        const rake = (row.rake || 0) + (row.rakeCorner || 0.35) * (1 - centre);
        const tilt = row.tilt || 0;
        let crown = [inw[0] * (Math.sin(rake) + tilt), -dir * Math.cos(rake), inw[2] * (Math.sin(rake) + tilt)];
        crown = nrm3(crown);
        const base = [P.p[0] + inw[0] * row.inset * L, P.p[1] + dir * row.sink * L, P.p[2] + inw[2] * row.inset * L];
        const wdir = P.tg;
        const thk = nrm3(crs(wdir, crown));
        const th = bw * (row.thick || 0.18);
        const tip = [base[0] + crown[0] * h, base[1] + crown[1] * h, base[2] + crown[2] * h];
        const bl = [base[0] - wdir[0] * bw * 0.5, base[1] - wdir[1] * bw * 0.5, base[2] - wdir[2] * bw * 0.5];
        const br = [base[0] + wdir[0] * bw * 0.5, base[1] + wdir[1] * bw * 0.5, base[2] + wdir[2] * bw * 0.5];
        // a shoulder at 40% height gives the blade its triangle-with-shoulders shape
        const sh = 0.38;
        const ml = [mix(bl[0], tip[0], sh) + wdir[0] * bw * 0.06, mix(bl[1], tip[1], sh), mix(bl[2], tip[2], sh) + wdir[2] * bw * 0.06];
        const mr = [mix(br[0], tip[0], sh) - wdir[0] * bw * 0.06, mix(br[1], tip[1], sh), mix(br[2], tip[2], sh) - wdir[2] * bw * 0.06];
        const outline = [bl, ml, tip, mr, br];
        const fr = [], bk = [];
        for (let q = 0; q < outline.length; q++) {
          const o = outline[q], tq = q === 2 ? 0.25 : 1;
          const along = q === 0 || q === 4 ? 0 : (q === 2 ? 1 : sh);
          fr.push(S.v([o[0] + thk[0] * th * tq, o[1] + thk[1] * th * tq, o[2] + thk[2] * th * tq], [bone, 1], TAG.TOOTH, [along, row.age || 0, 0, 0]));
          bk.push(S.v([o[0] - thk[0] * th * tq, o[1] - thk[1] * th * tq, o[2] - thk[2] * th * tq], [bone, 1], TAG.TOOTH, [along, row.age || 0, 0, 0]));
        }
        const cen = [mix(base[0], tip[0], 0.35), mix(base[1], tip[1], 0.35), mix(base[2], tip[2], 0.35)];
        // two faces fanned from a base corner, and the edges around (the base
        // edge itself is buried in the gum)
        S.q(fr[0], fr[1], fr[2], fr[2], thk); S.q(fr[0], fr[2], fr[3], fr[4], thk);
        S.q(bk[0], bk[1], bk[2], bk[2], [-thk[0], -thk[1], -thk[2]]); S.q(bk[0], bk[2], bk[3], bk[4], [-thk[0], -thk[1], -thk[2]]);
        for (let q = 0; q < 4; q++) {
          const mid = S.pos(fr[q]), mid2 = S.pos(fr[q + 1]);
          S.q(fr[q], bk[q], bk[q + 1], fr[q + 1], sub3([(mid[0] + mid2[0]) * 0.5, (mid[1] + mid2[1]) * 0.5, (mid[2] + mid2[2]) * 0.5], cen));
        }
      }
      return pts.length;
    }
    // baleen: a fringe of dark plates hanging inside the upper lip
    function baleenRow(S, spec, poly, b, bone, ctr) {
      const L = spec.L;
      const pts = resample(poly, b.n, 0.08, 0.92);
      for (let k = 0; k < pts.length; k++) {
        const P = pts[k], centre = 1 - Math.abs(P.u - 0.5) * 2;
        const h = b.h * L * (0.5 + 0.5 * (1 - centre));
        const inw = nrm3([ctr[0] - P.p[0], 0, ctr[2] - P.p[2]]);
        const base = [P.p[0] + inw[0] * b.inset * L, P.p[1] + 0.002 * L, P.p[2] + inw[2] * b.inset * L];
        const wdir = P.tg, wd = b.w * L;
        const a = S.v([base[0] - wdir[0] * wd, base[1], base[2] - wdir[2] * wd], [bone, 1], TAG.BALEEN, [0, 0, 0, 0]);
        const c = S.v([base[0] + wdir[0] * wd, base[1], base[2] + wdir[2] * wd], [bone, 1], TAG.BALEEN, [0, 0, 0, 0]);
        const tip = S.v([base[0] + inw[0] * h * 0.3, base[1] - h, base[2] + inw[2] * h * 0.3], [bone, 1], TAG.BALEEN, [1, 0, 0, 0]);
        S.t(a, c, tip); S.t(a, tip, c);
      }
    }

    /* ---- A FIN ---------------------------------------------------------------
       A planform in its own (chord u, span v) plane: a bowed leading edge
       swept back by `sweep`, a trailing edge that runs from the base back to
       the free rear tip and then concave up to the apex, a rounded or pointed
       tip. Every section is a NACA 00xx foil (closed trailing edge) whose
       thickness tapers from tc at the root to tcTip, so the blade is thick and
       round at the leading edge and knife-thin at the trailing edge and tip.
       The root section is pushed `embed` into the body along -span, so the
       fin comes OUT of the skin with no visible join. Bone weights: median
       fins and the caudal follow the spine chain at their own x; a paired fin
       ramps from the body's weights at its root to its own bone. */
    function naca(x) { return 5 * (0.2969 * Math.sqrt(x) - 0.1260 * x - 0.3516 * x * x + 0.2843 * x * x * x - 0.1036 * x * x * x * x); }
    /* A low knob raised off the skin (a humpback's tubercle, a barnacle, a
       knuckle on a flipper's leading edge): a six-sided base sunk a little
       into the surface, a shoulder and a cap. c = base centre, n = outward
       normal, r = base radius, h = height. */
    function dome(S, c, n, r, h, w, tag, meta) {
      const t1 = nrm3(Math.abs(n[0]) < 0.9 ? crs(n, [1, 0, 0]) : crs(n, [0, 1, 0]));
      const t2 = nrm3(crs(n, t1));
      const base = [], mid = [];
      for (let k = 0; k < 6; k++) {
        const a = k / 6 * TAU, ca = Math.cos(a), sa = Math.sin(a);
        base.push(S.v([c[0] + (t1[0] * ca + t2[0] * sa) * r - n[0] * r * 0.25, c[1] + (t1[1] * ca + t2[1] * sa) * r - n[1] * r * 0.25,
          c[2] + (t1[2] * ca + t2[2] * sa) * r - n[2] * r * 0.25], w, tag, meta));
        mid.push(S.v([c[0] + (t1[0] * ca + t2[0] * sa) * r * 0.62 + n[0] * h * 0.72, c[1] + (t1[1] * ca + t2[1] * sa) * r * 0.62 + n[1] * h * 0.72,
          c[2] + (t1[2] * ca + t2[2] * sa) * r * 0.62 + n[2] * h * 0.72], w, tag, meta));
      }
      const top = S.v([c[0] + n[0] * h, c[1] + n[1] * h, c[2] + n[2] * h], w, tag, meta);
      for (let k = 0; k < 6; k++) {
        const k2 = (k + 1) % 6, pa = S.pos(base[k]), pb = S.pos(mid[k2]);
        S.q(base[k], base[k2], mid[k2], mid[k], [(pa[0] + pb[0]) * 0.5 - c[0], (pa[1] + pb[1]) * 0.5 - c[1], (pa[2] + pb[2]) * 0.5 - c[2]]);
        S.q(mid[k], mid[k2], top, top, n);
      }
    }
    function buildFin(S, spec, PF, F, lv, chain, finId) {
      const L = spec.L;
      const span = F.span * L, root = F.root * L;
      const v = nrm3(F.dir);
      let u = [1 - v[0] * v[0], -v[0] * v[1], -v[0] * v[2]];
      if (F.chordDir) u = F.chordDir;
      const ud = dt3(u, v);
      u = nrm3([u[0] - v[0] * ud, u[1] - v[1] * ud, u[2] - v[2] * ud]);
      const w = nrm3(crs(u, v));
      // which face is "up": + for the sky-facing face of a flat fin (or the
      // +z face of an upright one), whichever way w happens to point
      const faceSgn = Math.abs(w[1]) > 0.2 ? Math.sign(w[1]) : (Math.sign(w[2]) || 1);
      // the root point: on the body at station F.at, at ring angle F.phi
      const O = finOrigin(spec, PF, F);
      const tanS = Math.tan(F.sweep || 0);
      const LE0 = root * 0.5;
      const conc = F.conc || 0, rear = F.rear || 0, rearH = F.rearH == null ? 0.1 : F.rearH;
      const tipC = (F.tipC == null ? 0.12 : F.tipC) * root;
      const bow = (F.bow || 0) * span, round = F.round == null ? 0.12 : F.round;
      function LE(vv) { return LE0 - vv * tanS + bow * Math.sin(Math.PI * cl(vv / span, 0, 1)); }
      function TE(vv) {
        const vr = rearH * span, ute = LE0 - root, urt = ute - rear * root;
        if (vv <= vr) return vr > 0 ? mix(ute, urt, sm(vv / vr)) : urt;
        const t = (vv - vr) / Math.max(1e-6, span - vr);
        let te = mix(urt, LE(span) - tipC, t) + conc * root * Math.sin(Math.PI * t);
        if (F.notch) {
          // a subterminal notch: a short step in the trailing edge near the tip
          const d = (t - F.notch.t) / F.notch.w;
          if (Math.abs(d) < 1) te += F.notch.d * root * (1 - d * d) * (1 - d * d);
        }
        // a scalloped trailing edge (a humpback's flukes): irregular bites
        if (F.scallop) te += F.scallop.d * root * Math.abs(Math.sin(t * Math.PI * F.scallop.n + 0.7 * Math.sin(t * 9.1))) * Math.sin(Math.PI * t);
        return te;
      }
      // F.res caps a small fin's resolution (a finlet needs a handful of quads)
      const nS = Math.min(lv.finSpan || 7, F.res ? F.res[0] : 99), nC = Math.min(lv.finChord || 6, F.res ? F.res[1] : 99);
      const emb = (F.embed == null ? 0.25 : F.embed) * Math.max(span, root) * 0.4;
      const secs = [];
      const vs = [-emb, 0];
      for (let m = 1; m <= nS; m++) vs.push(span * Math.sin(Math.PI * 0.5 * m / nS));
      const xc = [];
      for (let k = 0; k <= nC; k++) xc.push((1 - Math.cos(Math.PI * k / nC)) * 0.5);
      const tc0 = F.tc == null ? 0.12 : F.tc, tc1 = F.tcTip == null ? 0.05 : F.tcTip;
      const pec = F.bone != null;
      for (let m = 0; m < vs.length; m++) {
        const vv = vs[m], vc = Math.max(0, vv);
        let le = LE(vc), te = TE(vc);
        const hf = vc / span;
        // round the apex: the chord collapses on an ellipse over the last `round`
        if (hf > 1 - round && round > 0) {
          const q = (hf - (1 - round)) / round, k = Math.sqrt(Math.max(0, 1 - q * q));
          const mid = (le + te) * 0.5;
          le = mid + (le - mid) * Math.max(0.04, k); te = mid + (te - mid) * Math.max(0.04, k);
        }
        const chord = Math.max(1e-4, le - te);
        const tc = m === vs.length - 1 ? 0 : mix(tc0, tc1, hf);
        const ring = [];
        // LE, upper surface aft, TE, lower surface forward
        for (let k = 0; k <= nC; k++) ring.push([le - xc[k] * chord, tc * chord * naca(xc[k]), k]);
        for (let k = nC - 1; k >= 1; k--) ring.push([le - xc[k] * chord, -tc * chord * naca(xc[k]), k]);
        const ids = [];
        for (let q = 0; q < ring.length; q++) {
          const uu = ring[q][0], ww = ring[q][1];
          const P = [O[0] + u[0] * uu + v[0] * vv + w[0] * ww, O[1] + u[1] * uu + v[1] * vv + w[1] * ww, O[2] + u[2] * uu + v[2] * vv + w[2] * ww];
          let wt = chainWeights(chain, P[0]);
          if (F.bones) {
            // a wing or flipper with a chain of bones out along its span
            // (root, middle, tip): blended between the two around this span
            const bk = F.boneAt, nb = F.bones.length;
            let wb;
            if (hf <= bk[0]) wb = [F.bones[0], 1];
            else if (hf >= bk[nb - 1]) wb = [F.bones[nb - 1], 1];
            else {
              let q = 0;
              while (q < nb - 2 && hf > bk[q + 1]) q++;
              const t = sm((hf - bk[q]) / (bk[q + 1] - bk[q]));
              wb = [F.bones[q], 1 - t, F.bones[q + 1], t];
            }
            const k = sm((hf - 0.01) / Math.max(0.02, bk[0] + 0.12));
            wt = scale(chainWeights(chain, O[0]), 1 - k).concat(scale(wb, k));
          } else if (pec) {
            const k = sm((hf - 0.02) / 0.32);
            const base = chainWeights(chain, O[0]);
            wt = scale(base, 1 - k).concat([F.bone, k]);
          }
          if (F.extraW) wt = F.extraW(P, wt, hf);
          ids.push(S.v(P, wt, TAG.FIN, [hf, xc[ring[q][2]], faceSgn * ww / Math.max(1e-6, chord), finId]));
        }
        secs.push({ ids: ids, mid: [O[0] + u[0] * (le + te) * 0.5 + v[0] * vv, O[1] + u[1] * (le + te) * 0.5 + v[1] * vv, O[2] + u[2] * (le + te) * 0.5 + v[2] * vv] });
      }
      const nRing = secs[0].ids.length;
      for (let m = 0; m < secs.length - 1; m++) {
        const A = secs[m].ids, Bs = secs[m + 1].ids;
        const ctr = [(secs[m].mid[0] + secs[m + 1].mid[0]) * 0.5, (secs[m].mid[1] + secs[m + 1].mid[1]) * 0.5, (secs[m].mid[2] + secs[m + 1].mid[2]) * 0.5];
        for (let q = 0; q < nRing; q++) {
          const q2 = (q + 1) % nRing;
          const pa = S.pos(A[q]), pb = S.pos(Bs[q2]);
          S.q(A[q], A[q2], Bs[q2], Bs[q], sub3([(pa[0] + pb[0]) * 0.5, (pa[1] + pb[1]) * 0.5, (pa[2] + pb[2]) * 0.5], ctr));
        }
      }
      // root cap (buried in the body) so the blade is a closed solid
      const r0 = secs[0].ids, c0 = S.v(secs[0].mid, chainWeights(chain, secs[0].mid[0]), TAG.FIN, [0, 0.5, 0, finId]);
      for (let q = 0; q < nRing; q++) S.q(c0, r0[(q + 1) % nRing], r0[q], r0[q], [-v[0], -v[1], -v[2]]);
      // knuckles along the leading edge (a humpback flipper's tubercles)
      if (F.knobs && lv.teeth) {
        const K = F.knobs;
        for (let k = 0; k < K.n; k++) {
          const hf = mix(K.from, K.to, K.n > 1 ? k / (K.n - 1) : 0.5), vv = hf * span;
          const le = LE(vv), P = [O[0] + u[0] * le + v[0] * vv, O[1] + u[1] * le + v[1] * vv, O[2] + u[2] * le + v[2] * vv];
          const r = K.r * L * (1 - 0.45 * hf);
          let wt = chainWeights(chain, P[0]);
          if (pec) { const kk = sm((hf - 0.02) / 0.32); wt = scale(chainWeights(chain, O[0]), 1 - kk).concat([F.bone, kk]); }
          dome(S, [P[0] - u[0] * r * 0.4, P[1] - u[1] * r * 0.4, P[2] - u[2] * r * 0.4], u, r, r * 0.9, wt, TAG.FIN, [hf, 0, 0.01, finId]);
        }
      }
      const apex = secs[secs.length - 1].mid;
      return { origin: O, span: span, root: root, apex: apex, u: u, v: v, w: w, le0: LE(0), te0: TE(0) };
    }

    // where a fin's root sits on the body (shared by the fin and its bone)
    function finOrigin(spec, PF, F) {
      if (F.origin) return [F.origin[0], F.origin[1], F.origin[2]];
      if (F.originS != null) {
        const R = sectionAt(spec, PF, F.originS);
        return [R.x, R.yc + (F.originDy || 0) * spec.L, (F.originDz || 0) * spec.L];
      }
      const L = spec.L, root = F.root * L;
      const Rs = sectionAt(spec, PF, F.at + F.root * 0.5);
      const O = ringPoint(Rs, F.phi == null ? Math.PI : F.phi);
      O[0] = spec.xNose - F.at * L - root * 0.5;
      return O;
    }

    /* ---- A SPECIES TEMPLATE: skeleton, geometry per LOD, the published
       measurements. Built once per species spec and shared by every animal. */
    function template(spec) {
      if (spec._tpl) return spec._tpl;
      const L = spec.L, PF = makeProfile(spec);
      const sec = function (s) { return sectionAt(spec, PF, s); };
      const axis = function (s) { const R = sec(s); return [R.x, R.yc, 0]; };
      const bones = [], ix = {};
      function add(name, parent, p) { ix[name] = bones.length; bones.push({ name: name, parent: parent == null ? -1 : ix[parent], p: p }); return ix[name]; }
      const bs = spec.bones;
      add("root", null, axis(bs.root));
      add("neck", "root", axis(bs.neck));
      add("head", "neck", axis(bs.head));
      const mo = spec.mouth;
      let hinge = axis(bs.head), front = axis(0.02);
      if (mo) {
        const Rc = sec(mo.corner), Rf = sec(mo.front);
        const pc = ringPoint(Rc, mo.alphaC), pf = ringPoint(Rf, 0);
        hinge = [pc[0], pc[1], 0]; front = [pf[0], pf[1], 0];
      }
      // jaws, rolling eyes and trimming pectorals only where the body has
      // them: a sardine in a school of seventy pays for its spine alone
      if (mo) { add("upperJaw", "head", front); add("jaw", "neck", hinge); }
      const EY = spec.eye ? eyeCentres(spec, PF) : null;
      if (EY && !spec.eye.fixed) { add("eyeR", "head", EY[0].c); add("eyeL", "head", EY[1].c); }
      const pecR = (spec.fins || []).filter(function (f) { return f.boneName === "pecR"; })[0];
      const pecL = (spec.fins || []).filter(function (f) { return f.boneName === "pecL"; })[0];
      if (pecR) add("pecR", "root", finOrigin(spec, PF, pecR));
      if (pecL) add("pecL", "root", finOrigin(spec, PF, pecL));
      const tailNames = [];
      let prev = "root";
      for (let k = 0; k < bs.tail.length; k++) { const nm = "t" + (k + 1); add(nm, prev, axis(bs.tail[k])); tailNames.push(nm); prev = nm; }
      // a point a fraction hf out along a fin's span from its root (a wing's
      // or a flipper's bone pivots)
      const finPoint = function (name, hf) {
        const F = (spec.fins || []).filter(function (f) { return f.name === name; })[0];
        const O = finOrigin(spec, PF, F), v = nrm3(F.dir), d = hf * F.span * L;
        return [O[0] + v[0] * d, O[1] + v[1] * d, O[2] + v[2] * d];
      };
      if (spec.extraBones) spec.extraBones(add, { sec: sec, axis: axis, ix: ix, PF: PF, finPoint: finPoint });
      (spec.fins || []).forEach(function (f) {
        if (f.boneName) f.bone = ix[f.boneName];
        if (f.boneNames) f.bones = f.boneNames.map(function (n) { return ix[n]; });
      });
      spec.boneIx = ix;
      // the spine chain: head, neck, root, then the tail bones
      const cb = [ix.head, ix.neck, ix.root].concat(tailNames.map(function (n) { return ix[n]; }));
      const J = [bones[ix.head].p[0], bones[ix.neck].p[0]].concat(tailNames.map(function (n) { return bones[ix[n]].p[0]; }));
      const xEnds = [spec.xNose].concat(J).concat([spec.xNose - (spec.chainEnd || 1) * L]);
      const hw = J.map(function (x, q) { return 0.45 * Math.min(xEnds[q] - x, x - xEnds[q + 2]); });
      spec.chain = { b: cb, J: J, hw: hw };
      // the paint needs the eyes (the dark orbit), so it is made here
      if (spec.makePaint) { const pk = spec.makePaint(EY); spec.paint = pk.paint; spec.fields = pk.fields; }
      // geometry, one per LOD
      const geo = [], info = [];
      for (let l = 0; l < spec.lod.length; l++) {
        const r = buildSwimmer(spec, l);
        geo.push(r.geo); info.push(r);
      }
      const hi = info[0];
      // the trunk alone (no fins): what contact, beam and saddle questions want
      let ymin = Infinity, ymax = -Infinity, zmax = 0, xmin = spec.xNose - spec.tubeEnd * L;
      for (let k = 0; k <= 60; k++) {
        const s = spec.tubeEnd * k / 60, R = sec(s);
        ymin = Math.min(ymin, R.yc - R.bot); ymax = Math.max(ymax, R.yc + R.top); zmax = Math.max(zmax, R.half + R.keel);
      }
      const trunk = new T.Box3(new T.Vector3(xmin, ymin, -zmax), new T.Vector3(spec.xNose, ymax, zmax));
      const box = geo[0].boundingBox.clone();
      const pad = (box.max.x - box.min.x) * 0.06;
      box.expandByScalar(pad);
      const sphere = new T.Sphere(); box.getBoundingSphere(sphere);
      // the dorsal (the blade a surface proxy has to match) and the tail tip
      const dors = hi.fins[spec.dorsalName || "dorsal1"];
      let finDesc = null;
      if (dors) {
        const backY = sec(spec.fins.filter(function (f) { return f.name === (spec.dorsalName || "dorsal1"); })[0].at + 0.04).yc +
          sec(spec.fins.filter(function (f) { return f.name === (spec.dorsalName || "dorsal1"); })[0].at + 0.04).top;
        const cu = hi.fins[spec.caudalName || "caudalU"];
        finDesc = {
          height: Math.max(0.05, dors.apex[1] - backY), base: dors.root, x: dors.origin[0], backY: backY,
          color: spec.finColor || 0x50585e, thickness: 0.5, planLength: box.max.x - box.min.x - 2 * pad,
          planBeam: zmax * 2, tailHeight: cu ? Math.max(0, cu.apex[1] - backY) : 0, tailX: cu ? cu.apex[0] : xmin,
        };
      }
      let contract = null;
      if (hi.mouth) {
        const m = hi.mouth;
        const mLen = m.frontX - m.hingeX;
        const gap = Math.max(0.01 * L, (spec.jaw ? spec.jaw.gap : 0.05) * L);
        contract = {
          version: 6, shape: "skinned-body",
          hinge: { x: m.hingeX, y: m.hingeY, z: 0 },
          bite: { x: m.frontX - mLen * 0.12, y: m.lipY - gap * 0.35, z: 0 },
          grip: { x: m.frontX - mLen * 0.45, y: m.lipY - gap * 0.45, z: 0 },
          maxOpen: spec.jaw ? spec.jaw.drop + spec.jaw.lift : 1,
          travel: spec.jaw ? spec.jaw.drop : 1, restClose: 0,
          protrude: spec.jaw ? spec.jaw.protrude[0] * L : 0, upperDrop: spec.jaw ? -spec.jaw.protrude[1] * L : 0,
          width: m.width, length: mLen, gap: gap,
          upperTeeth: m.upperTeeth, lowerTeeth: m.lowerTeeth, toothRows: spec.mouth.teeth ? (spec.mouth.teeth.upper || []).length : 0,
          bodySplit: true, articulatedEnvelope: true, lowerShell: "marineBody",
          upperReachX: m.frontX + (spec.jaw ? spec.jaw.protrude[0] * L : 0),
        };
      }
      // where a rider sits: on the back line just ahead of the dorsal fin
      const dorsalSpec = (spec.fins || []).filter(function (f) { return f.name === (spec.dorsalName || "dorsal1"); })[0];
      const sS = spec.saddleS != null ? spec.saddleS : (dorsalSpec && dorsalSpec.at != null ? Math.max(0.1, dorsalSpec.at - 0.05) : 0.32);
      const Rs = sec(sS);
      const saddle = { x: Rs.x, y: Rs.yc + Rs.top, width: Rs.half * 2 };
      const tpl = spec._tpl = {
        spec: spec, bones: bones, ix: ix, geo: geo, box: box, sphere: sphere, trunk: trunk, saddle: saddle,
        beam: zmax * 2, height: ymax - ymin, len: box.max.x - box.min.x - 2 * pad, backY: finDesc ? finDesc.backY : ymax,
        sharkFin: finDesc, contract: contract, mouth: hi.mouth, fins: hi.fins, eyes: EY,
        tris: geo.map(function (g) { return g.index.count / 3; }),
      };
      return tpl;
    }

    /* ---- ONE ANIMAL: its own skeleton on the species' shared geometry ---- */
    function instance(tpl) {
      const g = new T.Group();
      const bones = tpl.bones.map(function (b) { const o = new T.Bone(); o.name = b.name; return o; });
      for (let i = 0; i < bones.length; i++) {
        const b = tpl.bones[i], P = b.parent >= 0 ? tpl.bones[b.parent].p : [0, 0, 0];
        bones[i].position.set(b.p[0] - P[0], b.p[1] - P[1], b.p[2] - P[2]);
        if (b.parent >= 0) bones[b.parent].add(bones[i]);
      }
      const mesh = new T.SkinnedMesh(tpl.geo[0], material());
      mesh.name = "marineBody";
      mesh.add(bones[0]);
      mesh.updateMatrixWorld(true);
      const sk = new T.Skeleton(bones);
      mesh.bind(sk);
      sk.update();                         // valid matrices before anything measures it
      // a skinned mesh measures itself by skinning every vertex on first ask;
      // hand it the rest-pose answer (padded for the swimming bend) instead
      mesh.boundingBox = tpl.box.clone();
      mesh.boundingSphere = tpl.sphere.clone();
      mesh.castShadow = true;
      g.add(mesh);
      const sp = tpl.spec;
      g.userData.marineBody = {
        mesh: mesh, bones: bones, ix: tpl.ix, tpl: tpl, lod: 0, plan: sp.plan || "lateral",
        len: tpl.len, beam: tpl.beam, height: tpl.height, backY: tpl.backY, trunk: tpl.trunk,
        jaw: sp.jaw || null, wave: sp.wave || null, eye: sp.eye || null,
      };
      if (tpl.contract) {
        const c = JSON.parse(JSON.stringify(tpl.contract));
        g.userData.aquaticMouth = c;
        g._aquaticMouth = { contract: c, applyGape: null };
      }
      if (tpl.sharkFin) g.userData.sharkFin = Object.assign({}, tpl.sharkFin);
      if (tpl.saddle) g.userData.saddle = Object.assign({}, tpl.saddle);
      if (sp.sharkLike) {
        g.userData.sharkShape = {
          profile: sp.profileName || "torpedo", hullLength: tpl.len, hullWidth: tpl.beam, hullHeight: tpl.height,
          planRatio: tpl.beam / Math.max(1e-3, tpl.len),
        };
      }
      return g;
    }

    /* Swap an animal onto another variant of its species (an orca bull's
       blade and paddles against a cow's): same skeleton, different geometry.
       The variants must share every bone position. */
    function retemplate(g, spec) {
      const mb = g && g.userData && g.userData.marineBody;
      if (!mb) return false;
      const tpl = template(spec);
      if (tpl.bones.length !== mb.tpl.bones.length) return false;
      for (let i = 0; i < tpl.bones.length; i++) {
        const a = tpl.bones[i].p, b = mb.tpl.bones[i].p;
        if (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) > 1e-6) return false;
      }
      mb.tpl = tpl;
      mb.mesh.geometry = tpl.geo[Math.min(mb.lod || 0, tpl.geo.length - 1)];
      mb.mesh.boundingBox = tpl.box.clone(); mb.mesh.boundingSphere = tpl.sphere.clone();
      mb.len = tpl.len; mb.beam = tpl.beam; mb.height = tpl.height; mb.backY = tpl.backY; mb.trunk = tpl.trunk;
      if (tpl.sharkFin) g.userData.sharkFin = Object.assign({}, tpl.sharkFin);
      return true;
    }
    /* One fin on its own, unskinned, with its root at the origin: for a
       surface proxy that has to draw the very blade the body carries. */
    function finGeometry(spec, name, colour) {
      const PF = makeProfile(spec);
      const F = (spec.fins || []).filter(function (f) { return f.name === name; })[0];
      if (!F) return null;
      const S = new Store();
      buildFin(S, spec, PF, Object.assign({}, F, { bone: null }), spec.lod[0], { b: [0], J: [], hw: [] }, 1);
      const O = finOrigin(spec, PF, F);
      for (let i = 0; i < S.n; i++) { S.p[i * 3] -= O[0]; S.p[i * 3 + 1] -= O[1]; S.p[i * 3 + 2] -= O[2]; }
      const geo = finalize(S, colour || function () { return [1, 1, 1, 0.3]; }, []);
      geo.deleteAttribute("skinIndex"); geo.deleteAttribute("skinWeight");
      return geo;
    }

    return {
      TAG: TAG, curve: curve, fbm: fbm, vn: vn, worley: worley, hexc: hexc, mixc: mixc, mulc: mulc, mix: mix, sm: sm, cl: cl,
      nrm3: nrm3, crs: crs, sub3: sub3, dt3: dt3, Store: Store, finalize: finalize, material: material,
      buildSwimmer: buildSwimmer, sectionAt: sectionAt, ringPoint: ringPoint, ringNormal: ringNormal,
      makeProfile: makeProfile, chainWeights: chainWeights, buildFin: buildFin, buildEye: buildEye,
      eyeCentres: eyeCentres, scaleW: scale, finOrigin: finOrigin, template: template, instance: instance,
      retemplate: retemplate, finGeometry: finGeometry,
    };
  })();

  /* ---- THE PAINT. One factory for every swimmer: countershading with a
     ragged, irregular line (cut through the mesh, so it is crisp), the back
     darkest along the spine, a fine mottle, gill grooves, a dark ring round
     the eye, lips, a wet mouth that goes from gum pink to black down the
     throat, teeth, eyes, and fins by role and face. A species passes its
     colours and line, and optional hooks for its own markings. ------------ */
  function paintKit(o) {
    const H = MB.hexc, TAG = MB.TAG;
    const back = H(o.back), belly = H(o.belly), fin = H(o.fin || o.back);
    const line = MB.curve(o.line);                 // countershade line, -1 belly .. +1 spine
    const rag = o.rag == null ? 0.10 : o.rag;
    const L = o.L;
    const gum = H(o.gum || 0x8a3a3c), gumDeep = H(o.gumDeep || 0x4a1518), throat = H(o.throat || 0x120405);
    const enamel = H(o.tooth || 0xf0eadb), root = H(o.toothRoot || 0xc99f94);
    const pupil = H(o.pupil || 0x010203), iris = H(o.iris || 0x0d171c), sclera = H(o.sclera || 0xc8cfcf), orbit = H(o.orbit || 0x14191c);
    const EY = o.eyes || null;
    /* a bony fish's scales (drawn by the shader): their size, faded in over
       the trunk between s0 and s1, and the arc coordinate round the body
       (distance from the spine along the skin, the same on both flanks) */
    const SC = o.scales || null, PT = o.pattern || null;
    let PFs = null;
    function scalesOf(c) {
      if ((!SC && !PT) || c.tag !== TAG.SKIN) return [0, 0];
      const s = c.m[0];
      PFs = PFs || MB.makeProfile(o.spec);
      const R = MB.sectionAt(o.spec, PFs, s);
      const th = Math.acos(MB.cl(-c.m[1], -1, 1));
      const r = Math.sqrt(0.5 * (0.25 * (R.top + R.bot) * (R.top + R.bot) + R.half * R.half));
      const k = SC ? MB.sm((s - SC.s0) / 0.04) * (1 - MB.sm((s - SC.s1 + 0.04) / 0.04)) : 0;
      return [k > 0.01 ? SC.size * L * k : 0, th * r];
    }
    // a fine marking drawn by the shader (see material()): kind, strength here, period
    function patternOf(c) {
      if (!PT || c.tag !== TAG.SKIN) return [0, 0, 0];
      const k = PT.strength(c), kind = typeof PT.kind === "function" ? PT.kind(c) : PT.kind;
      return [kind, k > 0 ? Math.min(1, k) : 0, PT.unit * L];
    }
    function lineAt(m, c) {
      if (c && c.memo.line != null) return c.memo.line;
      // the line wanders with two noises along the body and a finer tooth
      const s = m[0], side = m[2] >= 0 ? 1 : -1;
      const n1 = MB.vn(s * 34, side * 3.1, 0.5, 11) - 0.5, n2 = MB.vn(s * 140, side * 5.7, 1.5, 12) - 0.5;
      const v = line(s) + rag * (n1 * 1.2 + n2 * 0.55);
      if (c) c.memo.line = v;
      return v;
    }
    function relH(m) { return -m[1]; }                  // -1 ventral .. +1 dorsal (ring meta)
    const fields = [
      // 0: the countershade line on the skin and the chin; fin faces
      function (c) {
        if (c.tag === TAG.SKIN || c.tag === TAG.CHIN) return (relH(c.m) - lineAt(c.m, c)) * 4;
        if (c.tag === TAG.FIN) {
          const role = (o.finRole && o.finRole[c.m[3]]) || "median";
          if (role === "paired") return c.m[2] * 40;     // upper face grey, lower face white
          return NaN;
        }
        return NaN;
      },
      // 1: species markings (fin tips, bars...) through a hook
      function (c) { return o.mark ? o.mark(c) : NaN; },
    ];
    function skin(c) {
      const m = c.m, rh = relH(m), s = m[0];
      const up = c.f(0) >= 0;
      let col;
      if (up) {
        // darkest along the spine, lighter toward the line
        const k = 0.80 + 0.30 * MB.sm((1 - rh) / 1.6);
        col = MB.mulc(back, k);
        if (o.tint) col = [col[0] * o.tint[0], col[1] * o.tint[1], col[2] * o.tint[2]];
      } else {
        col = belly.slice();
        // a little grey creeps into the white just under the line
        const d = lineAt(m, c) - rh;
        if (d < 0.12) col = MB.mixc(col, MB.mulc(back, 1.35), 0.18 * (1 - d / 0.12));
      }
      // mottle
      const n = MB.fbm(c.p[0] * (9 / L) * 4, c.p[1] * (9 / L) * 4, c.p[2] * (9 / L) * 4, 3, 3);
      col = MB.mulc(col, 0.93 + 0.14 * n);
      // gill grooves and flaps
      if (m[3] > 0) col = MB.mulc(col, 1 - 0.62 * m[3]);
      else if (m[3] < 0 && m[3] > -1.5) col = MB.mulc(col, 1 + 0.06 * -m[3]);
      // lips: the upper lip edge darkens into the mouth line
      if (m[3] === -2) col = MB.mulc(col, 0.55);
      // the orbit
      if (EY) for (let e = 0; e < EY.length; e++) {
        const E = EY[e], dx = c.p[0] - E.skin[0], dy = c.p[1] - E.skin[1], dz = c.p[2] - E.skin[2];
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz) / E.r;
        if (d < 2.6) col = MB.mixc(col, orbit, 0.75 * (1 - MB.sm((d - 1.1) / 1.5)));
      }
      if (o.skin) col = o.skin(c, col, up);
      return col;
    }
    return {
      fields: fields,
      paint: function (c) {
        const t = c.tag, m = c.m;
        if (t === TAG.SKIN || t === TAG.CHIN) return skin(c).concat([up01(c) ? (o.specBack == null ? 0.25 : o.specBack) : (o.specBelly == null ? 0.18 : o.specBelly)], scalesOf(c), patternOf(c));
        if (t === TAG.PALATE || t === TAG.FLOOR) {
          // gum pink at the lips, darker inside, black down the throat
          const depth = m[0] >= 1 ? 1 : Math.max(m[0], 1 - Math.min(m[1], 1 - m[1]) * 4);
          const edge = Math.min(m[1], 1 - m[1]);
          let col = MB.mixc(gum, gumDeep, MB.sm(depth * 1.6 + (edge > 0.18 ? 0.35 : 0)));
          if (m[0] >= 1) col = MB.mixc(gumDeep, throat, MB.sm((m[0] - 1) * 1.5));
          if (m[0] < 1 && m[0] > 0.6) col = MB.mixc(col, throat, (m[0] - 0.6) * 1.6);
          return col.concat([0.55]);
        }
        if (t === TAG.TOOTH) {
          const k = MB.sm(m[0] / 0.35);
          let col = MB.mixc(root, enamel, k);
          if (m[1] > 0) col = MB.mulc(col, 0.92);
          return col.concat([0.6]);
        }
        if (t === TAG.BALEEN) return [0.06, 0.055, 0.05, 0.2];
        if (t === TAG.EYE) {
          const th = m[0];
          let col;
          if (th < 0.30) col = pupil;
          else if (th < 0.62) col = MB.mixc(iris, MB.mulc(iris, 0.6), MB.sm((th - 0.30) / 0.32));
          else if (th < 0.85) col = MB.mixc(MB.mulc(iris, 0.5), MB.mulc(sclera, 0.25), MB.sm((th - 0.62) / 0.23));
          else col = MB.mixc(MB.mulc(sclera, 0.35), sclera, MB.sm((th - 0.85) / 0.9));
          if (o.eye) col = o.eye(c, col);
          return col.concat([1.0]);
        }
        if (t === TAG.FIN) {
          const role = (o.finRole && o.finRole[m[3]]) || "median";
          let col;
          if (role === "paired") col = c.f(0) >= 0 ? MB.mulc(fin, 0.95) : belly.slice();
          else col = MB.mulc(fin, 0.92 + 0.10 * (1 - m[0]));
          const n = MB.fbm(c.p[0] * 30 / L, c.p[1] * 30 / L, c.p[2] * 30 / L, 5, 2);
          col = MB.mulc(col, 0.95 + 0.10 * n);
          if (o.finHook) col = o.finHook(c, col, role);
          return col.concat([o.specFin == null ? 0.25 : o.specFin]);
        }
        return [1, 0, 1, 0];
      },
    };
    function up01(c) { return c.f(0) >= 0; }
  }

  /* ---- the species' body, as built for every individual ------------------ */
  function marineBuild(spec) {
    const tpl = MB.template(spec);
    return MB.instance(tpl);
  }
  CBZ.marineBodyKit = MB;

  /* ============================================================
     GREAT WHITE SHARK — Carcharodon carcharias.
     Proportions are fractions of total length (TL), from white shark
     morphometrics (adult females): preoral length 5% TL, eye at 7% (about
     1.2% TL across), mouth corners at 11%, five gill slits from 17% to 23%
     (the first ~7% TL tall), pectoral origin 23.5% (anterior margin ~19%),
     first dorsal origin 34.5% (base 11.5%, height 10%), pelvics at 55%, the
     second dorsal and anal tiny at 65-67%, precaudal pit at 74%, a nearly
     lunate caudal (upper lobe ~25% TL, lower ~19%) on a depressed tail stock
     with a lateral keel. Deepest (~20% TL) and widest (~17%) at the first
     dorsal. 4.35 model units at scale 1.08 is a 4.7 m adult.
     ============================================================ */
  const GW_SPEC = {
    id: "great_white_shark", plan: "lateral", sharkLike: true, profileName: "torpedo-wedge",
    L: 4.35, xNose: 1.83, axisY: 0.86, noseRound: 0.024, tubeEnd: 0.778, headEnd: 0.27,
    profile: {
      top: [[0, 0], [0.02, 0.017], [0.05, 0.034], [0.09, 0.050], [0.14, 0.066], [0.20, 0.081], [0.27, 0.094], [0.34, 0.101], [0.42, 0.099], [0.50, 0.089], [0.58, 0.071], [0.65, 0.051], [0.70, 0.037], [0.735, 0.029], [0.778, 0.023]],
      bot: [[0, 0], [0.02, 0.013], [0.05, 0.027], [0.09, 0.040], [0.14, 0.054], [0.20, 0.070], [0.27, 0.086], [0.34, 0.095], [0.42, 0.095], [0.50, 0.085], [0.58, 0.066], [0.65, 0.045], [0.70, 0.031], [0.735, 0.024], [0.778, 0.019]],
      half: [[0, 0], [0.02, 0.019], [0.05, 0.036], [0.09, 0.049], [0.14, 0.061], [0.20, 0.072], [0.27, 0.081], [0.34, 0.085], [0.42, 0.082], [0.50, 0.072], [0.58, 0.056], [0.65, 0.039], [0.70, 0.027], [0.735, 0.021], [0.778, 0.016]],
      yo: [[0, -0.004], [0.10, 0], [0.62, 0], [0.74, 0.005], [0.78, 0.008]],
      nB: [[0, 2.5], [0.15, 2.3], [0.30, 2.1], [0.7, 2.0]],
      nT: 2.0,
      keel: [[0.66, 0], [0.70, 0.005], [0.74, 0.008], [0.778, 0.006]],
    },
    mouth: {
      front: 0.050, corner: 0.110, alphaF: 0.32, alphaC: 1.18, shape: 0.55, snoutBlend: 0.03,
      palate: 0.55, floor: 0.45, throat: 0.8, pharynx: 0.07, lipDrop: 0.0012, chinInset: 0.0034,
      teeth: {
        upper: [
          { n: 24, h: 0.0115, w: 0.0072, inset: 0.0012, sink: 0.0052, rake: 0.04, rakeCorner: 0.5, tilt: 0.12, thick: 0.2, cornerK: 0.42 },
          { n: 22, h: 0.0062, w: 0.0050, inset: 0.0058, sink: 0.0015, rake: 1.05, rakeCorner: 0.2, thick: 0.2, age: 1 },
        ],
        lower: [
          { n: 22, h: 0.0098, w: 0.0050, inset: 0.0014, sink: 0.0040, rake: 0.06, rakeCorner: 0.45, tilt: -0.05, thick: 0.22, cornerK: 0.40 },
          { n: 20, h: 0.0052, w: 0.0038, inset: 0.0055, sink: 0.0012, rake: 1.05, rakeCorner: 0.2, thick: 0.2, age: 1 },
        ],
      },
    },
    eye: { s: 0.071, up: 0.30, r: 0.0062, out: 0.40, socket: 0.28, fwd: 0.10 },
    gills: { n: 5, s0: 0.172, s1: 0.230, lo0: -0.58, hi0: 0.58, lo1: -0.46, hi1: 0.46, depth: 0.0042, flap: 0.0010, gap: 0.0034, slant: 0.010 },
    bones: { head: 0.165, neck: 0.245, root: 0.40, tail: [0.52, 0.615, 0.695, 0.760, 0.86] },
    fins: [
      { name: "dorsal1", role: "median", at: 0.345, root: 0.115, span: 0.100, dir: [0, 1, 0], phi: Math.PI, sweep: 0.66, bow: 0.05, tipC: 0.10, conc: 0.10, rear: 0.10, rearH: 0.06, round: 0.20, tc: 0.13, tcTip: 0.05, embed: 0.4 },
      { name: "dorsal2", role: "median", at: 0.653, root: 0.030, span: 0.021, dir: [0, 1, 0], phi: Math.PI, sweep: 0.55, tipC: 0.18, conc: 0.08, rear: 0.30, rearH: 0.25, round: 0.3, tc: 0.10, embed: 0.4 },
      { name: "anal", role: "median", at: 0.672, root: 0.028, span: 0.020, dir: [0, -1, 0], phi: 0, sweep: 0.55, tipC: 0.18, conc: 0.08, rear: 0.30, rearH: 0.25, round: 0.3, tc: 0.10, embed: 0.4 },
      { name: "pecR", role: "paired", boneName: "pecR", at: 0.235, root: 0.072, span: 0.185, dir: [-0.30, -0.42, 0.86], phi: 0.95, sweep: 0.42, bow: 0.04, tipC: 0.05, conc: 0.14, rear: 0.12, rearH: 0.12, round: 0.06, tc: 0.12, tcTip: 0.05, embed: 0.3 },
      { name: "pecL", role: "paired", boneName: "pecL", at: 0.235, root: 0.072, span: 0.185, dir: [-0.30, -0.42, -0.86], phi: 2 * Math.PI - 0.95, sweep: 0.42, bow: 0.04, tipC: 0.05, conc: 0.14, rear: 0.12, rearH: 0.12, round: 0.06, tc: 0.12, tcTip: 0.05, embed: 0.3 },
      { name: "pelvR", role: "paired", at: 0.552, root: 0.042, span: 0.052, dir: [-0.40, -0.80, 0.45], phi: 0.42, sweep: 0.5, tipC: 0.12, conc: 0.10, rear: 0.25, rearH: 0.18, round: 0.12, tc: 0.10, embed: 0.4 },
      { name: "pelvL", role: "paired", at: 0.552, root: 0.042, span: 0.052, dir: [-0.40, -0.80, -0.45], phi: 2 * Math.PI - 0.42, sweep: 0.5, tipC: 0.12, conc: 0.10, rear: 0.25, rearH: 0.18, round: 0.12, tc: 0.10, embed: 0.4 },
      { name: "caudalU", role: "median", originS: 0.765, originDy: 0.002, root: 0.100, span: 0.278, dir: [-0.80, 0.60, 0], sweep: 0.10, bow: 0.05, tipC: 0.05, conc: 0.16, rear: 0, rearH: 0, round: 0.05, tc: 0.12, tcTip: 0.06, embed: 0.5 },
      { name: "caudalL", role: "median", originS: 0.765, originDy: -0.002, root: 0.088, span: 0.190, dir: [-0.74, -0.67, 0], sweep: 0.08, bow: 0.05, tipC: 0.06, conc: 0.14, rear: 0, rearH: 0, round: 0.06, tc: 0.11, tcTip: 0.06, embed: 0.5 },
    ],
    // the bite: the snout lifts, the lower jaw drops, the upper jaw slides
    // out of the head, the eyes roll back white
    jaw: { lift: 0.20, drop: 0.82, protrude: [0.022, -0.016], gap: 0.05, eyeRoll: "back", rollMax: 2.05 },
    // thunniform-ish: the head barely yaws, the swing lives in the tail stock
    wave: { lambda: 0.95, amp: 0.085, env: [0.035, 0.0, 1.0], f0: 0.30, fK: 0.80, fMax: 2.4 },
    finColor: 0x2a3135,
    lod: [
      { M: 32, ds: 0.020, headK: 0.55, noseRings: 5, eyeRings: true, gills: true, teeth: true, finSpan: 8, finChord: 7, eyeSeg: 14, eyeRing: 9, pharynx: 4 },
      { M: 14, ds: 0.060, headK: 0.6, noseRings: 2, eyeRings: false, gills: false, teeth: false, finSpan: 4, finChord: 3, eyeSeg: 6, eyeRing: 4, pharynx: 2 },
    ],
  };
  // the black underside tips of the pectorals
  GW_SPEC.fins[3].tip = GW_SPEC.fins[4].tip = { from: 0.80, under: 0x08090a, top: 0.62 };
  GW_SPEC.makePaint = sharkPaint(GW_SPEC, {
    back: 0x2c3338, belly: 0xe3e7e6, fin: 0x2a3135, tint: [0.97, 1.0, 1.04],
    // the white runs up under the eye, drops to the mouth corner, stays
    // under the gills, kicks up behind the pectoral and slopes away to the tail
    line: [[0, -0.55], [0.03, -0.30], [0.07, -0.16], [0.105, -0.36], [0.15, -0.30], [0.20, -0.22], [0.25, 0.04], [0.29, 0.14], [0.34, 0.0], [0.44, -0.06], [0.55, -0.12], [0.64, -0.18], [0.72, -0.24], [0.78, -0.28]],
    rag: 0.10, specBack: 0.22, specBelly: 0.16, specFin: 0.22, iris: 0x0a1216, sclera: 0xbfc6c6, finEdge: 0.82,
  });

  S({
    id: "great_white_shark", name: "Great White Shark", biome: "water",
    rarity: "rare", hp: 140, fur: "Shark Fin", furValue: 260,
    meat: "Shark Meat", meatValue: 30, packs: 3, spd: 2.6, danger: 0.6,
    // 4.35 model units x 1.08 = 4.7 m (adult females 4.5-5 m); sizeVary
    // spreads individuals ~4.2-5.2 m
    bite: 30, aquatic: true, scale: 1.08, sizeVary: 0.10, color: 0x2c3338,
    // the origin rides this far under the surface: the dorsal tip just
    // breaks it on a surface cruise, as it did on the old, bigger model
    swimDepth: 1.6,
    build: function () { return marineBuild(GW_SPEC); },
  });

  /* ---- the shark paint, shared: roles from the fin list, optional dusky
     or black fin tips (a field cut through the fin, so the tip edge is crisp) */
  function sharkPaint(spec, o) {
    return function (EY) {
      const roles = {}, tipIds = [];
      spec.fins.forEach(function (f, i) {
        roles[i + 1] = f.role;
        if (f.tip) tipIds.push(i + 1);
      });
      const tipAt = {};
      spec.fins.forEach(function (f, i) { if (f.tip) tipAt[i + 1] = f.tip; });
      return paintKit(Object.assign({
        L: spec.L, eyes: EY, finRole: roles,
        mark: function (c) {
          if (c.tag !== MB.TAG.FIN || tipIds.indexOf(c.m[3]) < 0) return NaN;
          const tp = tipAt[c.m[3]];
          return c.m[0] - (tp.from + (MB.vn(c.m[1] * 6, c.m[3], 0, 21) - 0.5) * 0.08);
        },
        finHook: function (c, col) {
          const tp = tipAt[c.m[3]];
          if (tp && c.f(1) >= 0) {
            const under = c.f(0) < 0;
            return under ? MB.mixc(col, MB.hexc(tp.under || 0x08090a), tp.k == null ? 1 : tp.k) : MB.mulc(col, tp.top || 0.62);
          }
          if (o.finEdge && c.m[1] > 0.8) return MB.mulc(col, o.finEdge);
          return col;
        },
      }, o));
    };
  }

  /* ============================================================
     MEGALODON — Otodus megalodon, as the lamnid it was: the great white's
     body plan, heavier. The 2022 three-dimensional reconstruction scaled
     from lamnid proportions gives a 16 m animal, deepest (~22% TL) behind
     a short blunt snout, a wider head and mouth than a white shark, larger
     pectorals (~20% TL) and the same near-lunate keeled tail. Teeth are the
     white shark's shape at 1.1x the relative height. Eyes are relatively
     smaller, as they are on bigger sharks. 6.5 model units at scale 2.6 is
     a 16.5 m adult.
     ============================================================ */
  const MEG_SPEC = {
    id: "megalodon", plan: "lateral", sharkLike: true, profileName: "battering-ram",
    L: 6.5, xNose: 2.73, axisY: 0.98, noseRound: 0.032, tubeEnd: 0.778, headEnd: 0.27,
    profile: {
      top: [[0, 0], [0.02, 0.019], [0.05, 0.038], [0.09, 0.055], [0.14, 0.072], [0.20, 0.088], [0.27, 0.100], [0.34, 0.108], [0.42, 0.106], [0.50, 0.095], [0.58, 0.076], [0.65, 0.054], [0.70, 0.039], [0.735, 0.031], [0.778, 0.024]],
      bot: [[0, 0], [0.02, 0.015], [0.05, 0.031], [0.09, 0.046], [0.14, 0.061], [0.20, 0.077], [0.27, 0.093], [0.34, 0.102], [0.42, 0.101], [0.50, 0.090], [0.58, 0.070], [0.65, 0.048], [0.70, 0.033], [0.735, 0.026], [0.778, 0.020]],
      half: [[0, 0], [0.02, 0.022], [0.05, 0.041], [0.09, 0.055], [0.14, 0.067], [0.20, 0.078], [0.27, 0.087], [0.34, 0.091], [0.42, 0.088], [0.50, 0.077], [0.58, 0.060], [0.65, 0.042], [0.70, 0.029], [0.735, 0.022], [0.778, 0.017]],
      yo: [[0, -0.004], [0.10, 0], [0.62, 0], [0.74, 0.005], [0.78, 0.008]],
      nB: [[0, 2.5], [0.15, 2.3], [0.30, 2.1], [0.7, 2.0]],
      keel: [[0.66, 0], [0.70, 0.006], [0.74, 0.009], [0.778, 0.007]],
    },
    mouth: {
      front: 0.046, corner: 0.112, alphaF: 0.34, alphaC: 1.20, shape: 0.55, snoutBlend: 0.03,
      palate: 0.55, floor: 0.45, throat: 0.85, pharynx: 0.08, lipDrop: 0.0012, chinInset: 0.0034,
      teeth: {
        upper: [
          { n: 24, h: 0.0125, w: 0.0080, inset: 0.0012, sink: 0.0056, rake: 0.04, rakeCorner: 0.5, tilt: 0.12, thick: 0.2, cornerK: 0.42 },
          { n: 22, h: 0.0068, w: 0.0055, inset: 0.0060, sink: 0.0015, rake: 1.05, rakeCorner: 0.2, thick: 0.2, age: 1 },
        ],
        lower: [
          { n: 22, h: 0.0110, w: 0.0060, inset: 0.0014, sink: 0.0044, rake: 0.06, rakeCorner: 0.45, tilt: -0.05, thick: 0.22, cornerK: 0.40 },
          { n: 20, h: 0.0058, w: 0.0042, inset: 0.0056, sink: 0.0012, rake: 1.05, rakeCorner: 0.2, thick: 0.2, age: 1 },
        ],
      },
    },
    eye: { s: 0.068, up: 0.30, r: 0.0046, out: 0.40, socket: 0.28, fwd: 0.10 },
    gills: { n: 5, s0: 0.170, s1: 0.232, lo0: -0.60, hi0: 0.60, lo1: -0.48, hi1: 0.48, depth: 0.0040, flap: 0.0010, gap: 0.0030, slant: 0.010 },
    bones: { head: 0.165, neck: 0.245, root: 0.40, tail: [0.52, 0.615, 0.695, 0.760, 0.86] },
    fins: [
      { name: "dorsal1", role: "median", at: 0.340, root: 0.120, span: 0.106, dir: [0, 1, 0], phi: Math.PI, sweep: 0.66, bow: 0.05, tipC: 0.11, conc: 0.10, rear: 0.10, rearH: 0.06, round: 0.22, tc: 0.13, tcTip: 0.05, embed: 0.4 },
      { name: "dorsal2", role: "median", at: 0.652, root: 0.032, span: 0.022, dir: [0, 1, 0], phi: Math.PI, sweep: 0.55, tipC: 0.18, conc: 0.08, rear: 0.30, rearH: 0.25, round: 0.3, tc: 0.10, embed: 0.4 },
      { name: "anal", role: "median", at: 0.670, root: 0.030, span: 0.021, dir: [0, -1, 0], phi: 0, sweep: 0.55, tipC: 0.18, conc: 0.08, rear: 0.30, rearH: 0.25, round: 0.3, tc: 0.10, embed: 0.4 },
      { name: "pecR", role: "paired", boneName: "pecR", at: 0.232, root: 0.080, span: 0.200, dir: [-0.30, -0.42, 0.86], phi: 0.95, sweep: 0.42, bow: 0.04, tipC: 0.06, conc: 0.14, rear: 0.12, rearH: 0.12, round: 0.07, tc: 0.12, tcTip: 0.05, embed: 0.3, tip: { from: 0.84, under: 0x0c0e10, top: 0.7 } },
      { name: "pecL", role: "paired", boneName: "pecL", at: 0.232, root: 0.080, span: 0.200, dir: [-0.30, -0.42, -0.86], phi: 2 * Math.PI - 0.95, sweep: 0.42, bow: 0.04, tipC: 0.06, conc: 0.14, rear: 0.12, rearH: 0.12, round: 0.07, tc: 0.12, tcTip: 0.05, embed: 0.3, tip: { from: 0.84, under: 0x0c0e10, top: 0.7 } },
      { name: "pelvR", role: "paired", at: 0.552, root: 0.045, span: 0.055, dir: [-0.40, -0.80, 0.45], phi: 0.42, sweep: 0.5, tipC: 0.12, conc: 0.10, rear: 0.25, rearH: 0.18, round: 0.12, tc: 0.10, embed: 0.4 },
      { name: "pelvL", role: "paired", at: 0.552, root: 0.045, span: 0.055, dir: [-0.40, -0.80, -0.45], phi: 2 * Math.PI - 0.42, sweep: 0.5, tipC: 0.12, conc: 0.10, rear: 0.25, rearH: 0.18, round: 0.12, tc: 0.10, embed: 0.4 },
      { name: "caudalU", role: "median", originS: 0.765, originDy: 0.002, root: 0.105, span: 0.275, dir: [-0.80, 0.60, 0], sweep: 0.10, bow: 0.05, tipC: 0.05, conc: 0.16, rear: 0, rearH: 0, round: 0.05, tc: 0.12, tcTip: 0.06, embed: 0.5 },
      { name: "caudalL", role: "median", originS: 0.765, originDy: -0.002, root: 0.092, span: 0.195, dir: [-0.74, -0.67, 0], sweep: 0.08, bow: 0.05, tipC: 0.06, conc: 0.14, rear: 0, rearH: 0, round: 0.06, tc: 0.11, tcTip: 0.06, embed: 0.5 },
    ],
    jaw: { lift: 0.22, drop: 0.95, protrude: [0.022, -0.018], gap: 0.06, eyeRoll: "back", rollMax: 2.05 },
    wave: { lambda: 1.0, amp: 0.075, env: [0.03, 0.0, 1.0], f0: 0.16, fK: 0.55, fMax: 1.3 },
    finColor: 0x1f2428,
    lod: [
      { M: 32, ds: 0.020, headK: 0.55, noseRings: 5, eyeRings: true, gills: true, teeth: true, finSpan: 8, finChord: 7, eyeSeg: 14, eyeRing: 9, pharynx: 4 },
      { M: 14, ds: 0.060, headK: 0.6, noseRings: 2, eyeRings: false, gills: false, teeth: false, finSpan: 4, finChord: 3, eyeSeg: 6, eyeRing: 4, pharynx: 2 },
    ],
  };
  MEG_SPEC.makePaint = sharkPaint(MEG_SPEC, {
    back: 0x22282c, belly: 0xdcdfde, fin: 0x1f2428, tint: [0.96, 0.99, 1.04],
    line: [[0, -0.55], [0.03, -0.32], [0.07, -0.18], [0.105, -0.38], [0.15, -0.32], [0.20, -0.24], [0.25, 0.0], [0.29, 0.10], [0.34, -0.02], [0.44, -0.08], [0.55, -0.14], [0.64, -0.20], [0.72, -0.26], [0.78, -0.30]],
    rag: 0.11, specBack: 0.20, specBelly: 0.15, specFin: 0.2, iris: 0x0a1114, sclera: 0xbcc3c3, finEdge: 0.82,
  });
  S({
    id: "megalodon", name: "Megalodon", biome: "water", rarity: "legendary",
    hp: 1200, fur: "Legendary Megalodon Tooth", furValue: 3000, respawn: false,
    packs: 1, spd: 2.4, danger: 0.8, bite: 60, aquatic: true,
    // 6.5 model units x 2.6 = a 16.5 m animal
    scale: 2.6, color: 0x22282c,
    swimDepth: 5.0,
    build: function () { return marineBuild(MEG_SPEC); },
  });

  /* ============================================================
     GREAT HAMMERHEAD — Sphyrna mokarran. A slender carcharhiniform body
     (deepest ~14% TL) behind a cephalofoil a quarter of the body long
     across, with a nearly straight front margin, the eyes on its tips and
     the small crescent mouth under its centre. A very tall sickle first
     dorsal (~17% TL) over the pectoral insertion, a large second dorsal and
     anal with deeply notched rear margins, falcate pelvics, a strongly
     heterocercal tail (upper lobe ~29% TL with a subterminal notch, lower
     lobe ~11%). Grey-brown above, off-white below. 4.5 model units at
     scale 0.95 is a 4.2 m adult.
     ============================================================ */
  const HH_SPEC = {
    id: "hammerhead_shark", plan: "lateral", sharkLike: true, profileName: "cephalofoil",
    L: 4.5, xNose: 1.85, axisY: 0.90, noseRound: 0.03, tubeEnd: 0.77, headEnd: 0.24,
    profile: {
      top: [[0, 0], [0.02, 0.014], [0.05, 0.020], [0.09, 0.034], [0.14, 0.048], [0.20, 0.060], [0.27, 0.070], [0.34, 0.074], [0.42, 0.071], [0.50, 0.062], [0.58, 0.049], [0.65, 0.036], [0.70, 0.027], [0.735, 0.021], [0.77, 0.017]],
      bot: [[0, 0], [0.02, 0.011], [0.05, 0.016], [0.09, 0.028], [0.14, 0.043], [0.20, 0.055], [0.27, 0.064], [0.34, 0.068], [0.42, 0.065], [0.50, 0.057], [0.58, 0.044], [0.65, 0.031], [0.70, 0.023], [0.735, 0.018], [0.77, 0.014]],
      half: [[0, 0], [0.02, 0.026], [0.05, 0.036], [0.09, 0.038], [0.14, 0.044], [0.20, 0.052], [0.27, 0.058], [0.34, 0.060], [0.42, 0.056], [0.50, 0.049], [0.58, 0.039], [0.65, 0.028], [0.70, 0.020], [0.735, 0.016], [0.77, 0.012]],
      nT: [[0, 2.6], [0.10, 2.2], [0.25, 2.0]], nB: [[0, 2.6], [0.12, 2.2], [0.25, 2.0]],
    },
    mouth: {
      front: 0.078, corner: 0.104, alphaF: 0.30, alphaC: 1.05, shape: 0.6, snoutBlend: 0.025,
      palate: 0.5, floor: 0.42, throat: 0.7, pharynx: 0.05, lipDrop: 0.0010, chinInset: 0.0028,
      teeth: {
        upper: [{ n: 30, h: 0.0052, w: 0.0034, inset: 0.0010, sink: 0.0024, rake: 0.10, rakeCorner: 0.6, tilt: 0.10, thick: 0.2, cornerK: 0.45 }],
        lower: [{ n: 30, h: 0.0046, w: 0.0026, inset: 0.0012, sink: 0.0020, rake: 0.08, rakeCorner: 0.5, thick: 0.22, cornerK: 0.45 }],
      },
    },
    // on the ends of the cephalofoil, looking out and a little forward
    eye: { pos: [0.020, 0.002, 0.124], look: [0.35, 0.10, 1], r: 0.0042 },
    gills: { n: 5, s0: 0.150, s1: 0.200, lo0: -0.55, hi0: 0.40, lo1: -0.45, hi1: 0.32, depth: 0.0035, flap: 0.0009, gap: 0.0028, slant: 0.008 },
    bones: { head: 0.13, neck: 0.215, root: 0.38, tail: [0.50, 0.60, 0.68, 0.745, 0.85] },
    fins: [
      // the cephalofoil: a thick hydrofoil out of each side of the head, its
      // front margin straight across, its rear margin swept forward to the
      // blunt tips the eyes sit in
      { name: "hammerR", role: "paired", originS: 0.032, originDz: 0.018, root: 0.068, span: 0.112, dir: [0.0, 0.0, 1], chordDir: [1, 0, 0], sweep: -0.04, bow: 0.02, tipC: 0.62, conc: 0.0, rear: 0, rearH: 0, round: 0.22, tc: 0.30, tcTip: 0.34, embed: 0.2 },
      { name: "hammerL", role: "paired", originS: 0.032, originDz: -0.018, root: 0.068, span: 0.112, dir: [0.0, 0.0, -1], chordDir: [1, 0, 0], sweep: -0.04, bow: 0.02, tipC: 0.62, conc: 0.0, rear: 0, rearH: 0, round: 0.22, tc: 0.30, tcTip: 0.34, embed: 0.2 },
      { name: "dorsal1", role: "median", at: 0.265, root: 0.110, span: 0.170, dir: [0, 1, 0], phi: Math.PI, sweep: 0.46, bow: 0.06, tipC: 0.06, conc: 0.26, rear: 0.16, rearH: 0.05, round: 0.05, tc: 0.12, tcTip: 0.05, embed: 0.4 },
      { name: "dorsal2", role: "median", at: 0.605, root: 0.040, span: 0.048, dir: [0, 1, 0], phi: Math.PI, sweep: 0.4, tipC: 0.12, conc: 0.30, rear: 0.55, rearH: 0.15, round: 0.1, tc: 0.10, embed: 0.4 },
      { name: "anal", role: "median", at: 0.585, root: 0.048, span: 0.046, dir: [0, -1, 0], phi: 0, sweep: 0.42, tipC: 0.12, conc: 0.36, rear: 0.5, rearH: 0.12, round: 0.1, tc: 0.10, embed: 0.4 },
      { name: "pecR", role: "paired", boneName: "pecR", at: 0.190, root: 0.072, span: 0.140, dir: [-0.32, -0.40, 0.86], phi: 0.95, sweep: 0.52, bow: 0.04, tipC: 0.05, conc: 0.20, rear: 0.12, rearH: 0.12, round: 0.05, tc: 0.11, tcTip: 0.05, embed: 0.3, tip: { from: 0.86, under: 0x2b2a25, k: 0.6, top: 0.8 } },
      { name: "pecL", role: "paired", boneName: "pecL", at: 0.190, root: 0.072, span: 0.140, dir: [-0.32, -0.40, -0.86], phi: 2 * Math.PI - 0.95, sweep: 0.52, bow: 0.04, tipC: 0.05, conc: 0.20, rear: 0.12, rearH: 0.12, round: 0.05, tc: 0.11, tcTip: 0.05, embed: 0.3, tip: { from: 0.86, under: 0x2b2a25, k: 0.6, top: 0.8 } },
      { name: "pelvR", role: "paired", at: 0.455, root: 0.045, span: 0.062, dir: [-0.40, -0.82, 0.42], phi: 0.40, sweep: 0.55, tipC: 0.08, conc: 0.26, rear: 0.3, rearH: 0.15, round: 0.06, tc: 0.10, embed: 0.4 },
      { name: "pelvL", role: "paired", at: 0.455, root: 0.045, span: 0.062, dir: [-0.40, -0.82, -0.42], phi: 2 * Math.PI - 0.40, sweep: 0.55, tipC: 0.08, conc: 0.26, rear: 0.3, rearH: 0.15, round: 0.06, tc: 0.10, embed: 0.4 },
      { name: "caudalU", role: "median", originS: 0.745, originDy: 0.002, root: 0.085, span: 0.300, dir: [-0.82, 0.57, 0], sweep: 0.10, bow: 0.04, tipC: 0.05, conc: 0.10, rear: 0, rearH: 0, round: 0.05, tc: 0.11, tcTip: 0.06, embed: 0.5, notch: { t: 0.78, w: 0.07, d: 0.10 } },
      { name: "caudalL", role: "median", originS: 0.745, originDy: -0.004, root: 0.070, span: 0.110, dir: [-0.62, -0.78, 0], sweep: 0.12, bow: 0.05, tipC: 0.10, conc: 0.14, rear: 0, rearH: 0, round: 0.12, tc: 0.10, tcTip: 0.06, embed: 0.5 },
    ],
    jaw: { lift: 0.08, drop: 0.80, protrude: [0.006, -0.004], gap: 0.03, eyeRoll: "membrane", rollMax: 1.25 },
    // a hammerhead swims with a lot of head: it sweeps its cephalofoil
    wave: { lambda: 0.90, amp: 0.095, env: [0.08, 0.10, 1.0], f0: 0.40, fK: 0.90, fMax: 2.8 },
    finColor: 0x34332d,
    lod: [
      { M: 32, ds: 0.020, headK: 0.6, noseRings: 4, eyeRings: true, gills: true, teeth: true, finSpan: 8, finChord: 7, eyeSeg: 12, eyeRing: 8, pharynx: 3 },
      { M: 14, ds: 0.060, headK: 0.6, noseRings: 2, eyeRings: false, gills: false, teeth: false, finSpan: 4, finChord: 3, eyeSeg: 6, eyeRing: 4, pharynx: 2 },
    ],
  };
  HH_SPEC.makePaint = sharkPaint(HH_SPEC, {
    back: 0x312f29, belly: 0xe3e0d6, fin: 0x34332d, tint: [1.04, 1.0, 0.92],
    line: [[0, -0.10], [0.05, -0.05], [0.10, -0.30], [0.15, -0.30], [0.20, -0.20], [0.27, -0.05], [0.34, -0.10], [0.45, -0.14], [0.60, -0.20], [0.72, -0.26], [0.78, -0.30]],
    rag: 0.06, specBack: 0.22, specBelly: 0.15, specFin: 0.22, iris: 0x2a2416, sclera: 0xb9b8ae, finEdge: 0.85,
  });
  S({
    id: "hammerhead_shark", name: "Great Hammerhead", biome: "water",
    rarity: "rare", hp: 150, fur: "Shark Fin", furValue: 300,
    meat: "Shark Meat", meatValue: 30, spd: 2.5, danger: 0.5,
    // 4.5 model units x 0.95 = a 4.2 m adult (great hammerheads run 3.5-5 m)
    bite: 26, aquatic: true, scale: 0.95, sizeVary: 0.10, color: 0x312f29,
    clearance: 40, swimDepth: 1.75,
    build: function () { return marineBuild(HH_SPEC); },
  });

  /* ============================================================
     BULL SHARK — Carcharhinus leucas. The stockiest requiem shark: deepest
     ~19% TL, a short, broad, bluntly rounded snout (preoral length less than
     the mouth's width), small eyes with a nictitating membrane, a broad
     triangular first dorsal (~10% TL) starting over the pectoral insertion,
     a sizeable second dorsal and anal, broad falcate pectorals (~19% TL), a
     heterocercal tail with a subterminal notch (upper lobe ~27% TL, lower
     ~12%), no keels. Grey above with a brownish cast, white below, dusky
     fin tips. 3.5 model units at scale 0.76 is a 2.6 m adult — the shark
     that comes into the surf.
     ============================================================ */
  const BULL_SPEC = {
    id: "bull_shark", plan: "lateral", sharkLike: true, profileName: "stocky-blunt",
    L: 3.5, xNose: 1.45, axisY: 0.88, noseRound: 0.034, tubeEnd: 0.775, headEnd: 0.25,
    profile: {
      top: [[0, 0], [0.02, 0.020], [0.05, 0.040], [0.09, 0.056], [0.14, 0.072], [0.20, 0.086], [0.27, 0.096], [0.34, 0.098], [0.42, 0.094], [0.50, 0.083], [0.58, 0.066], [0.65, 0.048], [0.70, 0.035], [0.73, 0.028], [0.775, 0.022]],
      bot: [[0, 0], [0.02, 0.016], [0.05, 0.032], [0.09, 0.044], [0.14, 0.058], [0.20, 0.074], [0.27, 0.086], [0.34, 0.091], [0.42, 0.088], [0.50, 0.076], [0.58, 0.058], [0.65, 0.040], [0.70, 0.029], [0.73, 0.023], [0.775, 0.018]],
      half: [[0, 0], [0.02, 0.027], [0.05, 0.046], [0.09, 0.058], [0.14, 0.066], [0.20, 0.075], [0.27, 0.081], [0.34, 0.082], [0.42, 0.078], [0.50, 0.068], [0.58, 0.052], [0.65, 0.036], [0.70, 0.025], [0.73, 0.020], [0.775, 0.015]],
      yo: [[0, -0.006], [0.10, 0], [0.62, 0], [0.74, 0.004], [0.775, 0.006]],
      nB: [[0, 2.6], [0.15, 2.3], [0.30, 2.1], [0.7, 2.0]],
    },
    mouth: {
      front: 0.058, corner: 0.106, alphaF: 0.36, alphaC: 1.15, shape: 0.55, snoutBlend: 0.03,
      palate: 0.55, floor: 0.45, throat: 0.8, pharynx: 0.06, lipDrop: 0.0012, chinInset: 0.0032,
      teeth: {
        upper: [
          { n: 26, h: 0.0082, w: 0.0062, inset: 0.0012, sink: 0.0038, rake: 0.08, rakeCorner: 0.6, tilt: 0.12, thick: 0.2, cornerK: 0.42 },
          { n: 24, h: 0.0045, w: 0.0042, inset: 0.0050, sink: 0.0012, rake: 1.05, rakeCorner: 0.2, thick: 0.2, age: 1 },
        ],
        // the lower teeth are narrow spikes: the bull shark's fork and knife
        lower: [
          { n: 24, h: 0.0074, w: 0.0030, inset: 0.0014, sink: 0.0032, rake: 0.04, rakeCorner: 0.4, tilt: -0.05, thick: 0.25, cornerK: 0.45 },
          { n: 22, h: 0.0040, w: 0.0024, inset: 0.0048, sink: 0.0010, rake: 1.05, rakeCorner: 0.2, thick: 0.25, age: 1 },
        ],
      },
    },
    eye: { s: 0.066, up: 0.26, r: 0.0052, out: 0.40, socket: 0.26, fwd: 0.10 },
    gills: { n: 5, s0: 0.168, s1: 0.224, lo0: -0.50, hi0: 0.46, lo1: -0.40, hi1: 0.38, depth: 0.0040, flap: 0.0010, gap: 0.0032, slant: 0.009 },
    bones: { head: 0.16, neck: 0.24, root: 0.39, tail: [0.51, 0.605, 0.685, 0.745, 0.85] },
    fins: [
      { name: "dorsal1", role: "median", at: 0.285, root: 0.120, span: 0.104, dir: [0, 1, 0], phi: Math.PI, sweep: 0.58, bow: 0.05, tipC: 0.09, conc: 0.14, rear: 0.12, rearH: 0.06, round: 0.12, tc: 0.13, tcTip: 0.05, embed: 0.4, tip: { from: 0.84, under: 0x1c1e1f, k: 0.55, top: 0.75 } },
      { name: "dorsal2", role: "median", at: 0.612, root: 0.046, span: 0.036, dir: [0, 1, 0], phi: Math.PI, sweep: 0.5, tipC: 0.12, conc: 0.18, rear: 0.40, rearH: 0.15, round: 0.15, tc: 0.10, embed: 0.4 },
      { name: "anal", role: "median", at: 0.622, root: 0.046, span: 0.032, dir: [0, -1, 0], phi: 0, sweep: 0.5, tipC: 0.12, conc: 0.24, rear: 0.40, rearH: 0.15, round: 0.15, tc: 0.10, embed: 0.4 },
      { name: "pecR", role: "paired", boneName: "pecR", at: 0.205, root: 0.088, span: 0.185, dir: [-0.30, -0.42, 0.86], phi: 0.95, sweep: 0.40, bow: 0.04, tipC: 0.10, conc: 0.12, rear: 0.12, rearH: 0.12, round: 0.10, tc: 0.12, tcTip: 0.05, embed: 0.3, tip: { from: 0.84, under: 0x1c1e1f, k: 0.7, top: 0.7 } },
      { name: "pecL", role: "paired", boneName: "pecL", at: 0.205, root: 0.088, span: 0.185, dir: [-0.30, -0.42, -0.86], phi: 2 * Math.PI - 0.95, sweep: 0.40, bow: 0.04, tipC: 0.10, conc: 0.12, rear: 0.12, rearH: 0.12, round: 0.10, tc: 0.12, tcTip: 0.05, embed: 0.3, tip: { from: 0.84, under: 0x1c1e1f, k: 0.7, top: 0.7 } },
      { name: "pelvR", role: "paired", at: 0.500, root: 0.046, span: 0.052, dir: [-0.40, -0.80, 0.45], phi: 0.42, sweep: 0.5, tipC: 0.12, conc: 0.10, rear: 0.25, rearH: 0.18, round: 0.12, tc: 0.10, embed: 0.4 },
      { name: "pelvL", role: "paired", at: 0.500, root: 0.046, span: 0.052, dir: [-0.40, -0.80, -0.45], phi: 2 * Math.PI - 0.42, sweep: 0.5, tipC: 0.12, conc: 0.10, rear: 0.25, rearH: 0.18, round: 0.12, tc: 0.10, embed: 0.4 },
      { name: "caudalU", role: "median", originS: 0.748, originDy: 0.002, root: 0.090, span: 0.282, dir: [-0.84, 0.54, 0], sweep: 0.10, bow: 0.04, tipC: 0.05, conc: 0.10, rear: 0, rearH: 0, round: 0.05, tc: 0.11, tcTip: 0.06, embed: 0.5, notch: { t: 0.78, w: 0.07, d: 0.10 }, tip: { from: 0.90, under: 0x1c1e1f, k: 0.45, top: 0.8 } },
      { name: "caudalL", role: "median", originS: 0.748, originDy: -0.004, root: 0.075, span: 0.122, dir: [-0.62, -0.78, 0], sweep: 0.12, bow: 0.05, tipC: 0.10, conc: 0.14, rear: 0, rearH: 0, round: 0.12, tc: 0.10, tcTip: 0.06, embed: 0.5 },
    ],
    jaw: { lift: 0.15, drop: 0.90, protrude: [0.012, -0.010], gap: 0.05, eyeRoll: "membrane", rollMax: 1.25 },
    // subcarangiform: more of the body takes part in the beat than a white shark's
    wave: { lambda: 0.90, amp: 0.10, env: [0.05, 0.20, 1.0], f0: 0.45, fK: 1.0, fMax: 3.2 },
    finColor: 0x2f3335,
    lod: [
      { M: 32, ds: 0.022, headK: 0.55, noseRings: 5, eyeRings: true, gills: true, teeth: true, finSpan: 8, finChord: 7, eyeSeg: 12, eyeRing: 8, pharynx: 4 },
      { M: 14, ds: 0.060, headK: 0.6, noseRings: 2, eyeRings: false, gills: false, teeth: false, finSpan: 4, finChord: 3, eyeSeg: 6, eyeRing: 4, pharynx: 2 },
    ],
  };
  BULL_SPEC.makePaint = sharkPaint(BULL_SPEC, {
    back: 0x2f3335, belly: 0xe6e7e4, fin: 0x2f3335, tint: [1.05, 1.0, 0.93],
    line: [[0, -0.30], [0.04, -0.25], [0.07, -0.18], [0.105, -0.34], [0.16, -0.28], [0.22, -0.20], [0.28, -0.12], [0.36, -0.16], [0.46, -0.20], [0.58, -0.24], [0.70, -0.30], [0.775, -0.32]],
    rag: 0.06, specBack: 0.24, specBelly: 0.16, specFin: 0.24, iris: 0x2b2a1c, sclera: 0xb7bbb6, finEdge: 0.86,
  });
  S({
    id: "bull_shark", name: "Bull Shark", biome: "water",
    rarity: "uncommon", hp: 110, fur: "Shark Fin", furValue: 190,
    meat: "Shark Meat", meatValue: 24, spd: 2.7, danger: 0.55,
    // 3.5 model units x 0.76 = a 2.6 m adult (2.4-3.5 m)
    bite: 24, aquatic: true, scale: 0.76, sizeVary: 0.10, color: 0x2f3335,
    clearance: 12, swimDepth: 1.2,
    build: function () { return marineBuild(BULL_SPEC); },
  });

  /* ==========================================================================
     THE BONY FISH. The same body kit as the sharks: one skinned mesh per
     fish, a mouth that opens, eyes in the head, foil fins. What makes them
     bony fish: a terminal mouth whose jaw drops and premaxilla slides out,
     a gill cover (a crisp paler plate whose rear margin curves round behind
     the head, a soft shadow behind it), big flat eyes with a dark pupil in a
     metallic iris, scales drawn by the shader at their real size, and the
     fine markings (a mackerel's wavy bars, a marlin's bars of pale dots, a
     tuna's rows of pale dots, a barracuda's oblique bars and blotches)
     drawn there too, so a fish in a school of seventy costs a few hundred
     triangles and still carries its pattern up close.
     ========================================================================== */
  function fishPaint(spec, o) {
    return function (EY) {
      const roles = {}, names = {};
      spec.fins.forEach(function (f, i) { roles[i + 1] = f.role; names[i + 1] = f.name; });
      const op = o.opercle;
      const cheek = MB.hexc(o.cheek || 0xb9c2c6), iris = MB.hexc(o.iris || 0xb8b49a);
      const pupil = MB.hexc(0x020304), irisDark = MB.hexc(0x1a2224);
      // the gill cover's rear margin: s as a function of height on the head
      function opS(h) { return op.s - op.k * (h - op.h) * (h - op.h); }
      function opField(c) {
        if (c.tag !== MB.TAG.SKIN) return NaN;
        const s = c.m[0], h = -c.m[1];
        if (s > op.s + 0.03 || h > op.top) return -1;
        return (opS(h) - s) * 60;
      }
      return paintKit(Object.assign({
        gum: 0xcfc4ba, gumDeep: 0x6d625a, throat: 0x161412, orbit: o.back,
      }, o, {
        L: spec.L, eyes: EY, finRole: roles, spec: spec,
        mark: function (c) {
          const a = opField(c), b = o.mark ? o.mark(c) : NaN;
          if (isNaN(a)) return b;
          return isNaN(b) ? a : Math.max(a, b);
        },
        skin: function (c, col, up) {
          const s = c.m[0], h = -c.m[1];
          if (s < op.s + 0.03) {
            const d = s - opS(h);
            if (d < 0 && h < op.top && c.f(1) >= 0) col = MB.mixc(col, up ? MB.mulc(col, 1.15) : cheek, (o.cheekK || 0.35) * (1 - MB.sm((h - op.top + 0.3) / 0.3)));
            else if (d >= 0 && d < 0.02) col = MB.mulc(col, 1 - 0.18 * (1 - d / 0.02));
          }
          return o.skin ? o.skin(c, col, up) : col;
        },
        eye: function (c) {
          const th = c.m[0];
          if (th < 0.38) return pupil;
          if (th < 0.90) return MB.mixc(MB.mulc(iris, 0.7), iris, MB.sm((th - 0.38) / 0.25));
          return MB.mixc(iris, irisDark, MB.sm((th - 0.90) / 0.12));
        },
        finHook: o.finHook ? function (c, col, role) { return o.finHook(c, col, role, names[c.m[3]]); } : null,
      }));
    };
  }
  // a run of finlets along the back or the belly behind the soft fins
  function finlets(name, from, to, n, down) {
    const out = [];
    for (let k = 0; k < n; k++) {
      out.push({
        name: name + (k + 1), role: "median", at: from + (to - from) * k / Math.max(1, n - 1), root: 0.018, span: 0.021,
        dir: [0, down ? -1 : 1, 0], phi: down ? 0 : Math.PI, sweep: 0.85, tipC: 0.12, conc: 0.05, rear: 0.25, rearH: 0.3,
        round: 0.3, tc: 0.10, tcTip: 0.08, embed: 0.5, res: [2, 2], lodMax: 0,
      });
    }
    return out;
  }
  // the near and far bodies of a fish that comes in schools
  const SCHOOL_LOD = [
    { M: 20, ds: 0.022, headK: 0.6, noseRings: 3, eyeRings: true, gills: false, teeth: false, finSpan: 5, finChord: 4, eyeSeg: 10, eyeRing: 6, pharynx: 2 },
    { M: 8, ds: 0.090, headK: 0.8, noseRings: 2, eyeRings: false, gills: false, teeth: false, finSpan: 2, finChord: 2, eyeSeg: 5, eyeRing: 3, pharynx: 2 },
  ];
  const BIG_FISH_LOD = [
    { M: 28, ds: 0.018, headK: 0.6, noseRings: 4, eyeRings: true, gills: false, teeth: true, finSpan: 7, finChord: 6, eyeSeg: 12, eyeRing: 7, pharynx: 3 },
    { M: 12, ds: 0.060, headK: 0.7, noseRings: 2, eyeRings: false, gills: false, teeth: false, finSpan: 3, finChord: 3, eyeSeg: 6, eyeRing: 4, pharynx: 2 },
  ];

  /* ---- ATLANTIC MACKEREL — Scomber scombrus. 40 cm. Fusiform and nearly
     round (deepest ~16% TL at a third of the way back, width 0.7 of the
     depth), a pointed snout, the big terminal mouth reaching under the eye,
     the eye ~4% TL across. Two well separated dorsals (the first a
     triangle of spines over the pectoral tip), five finlets above and five
     below on the slender tail stock, two small keels each side at the tail
     base, short high pectorals, a deeply forked caudal. Blue-green back
     crossed by 23-33 dark wavy bars down to mid-flank; silver-white below.
     1.82 model units at scale 0.22. */
  const MACKEREL_SPEC = {
    id: "fish", plan: "lateral", profileName: "mackerel",
    L: 1.82, xNose: 0.82, axisY: 0.50, noseRound: 0.006, tubeEnd: 0.86, headEnd: 0.24,
    profile: {
      top: [[0, 0], [0.01, 0.008], [0.03, 0.018], [0.06, 0.030], [0.10, 0.042], [0.15, 0.054], [0.20, 0.064], [0.26, 0.072], [0.33, 0.077], [0.40, 0.077], [0.48, 0.071], [0.56, 0.060], [0.64, 0.046], [0.72, 0.031], [0.78, 0.020], [0.83, 0.013], [0.86, 0.011]],
      bot: [[0, 0], [0.01, 0.007], [0.03, 0.015], [0.06, 0.026], [0.10, 0.038], [0.15, 0.050], [0.20, 0.060], [0.26, 0.068], [0.33, 0.072], [0.40, 0.071], [0.48, 0.064], [0.56, 0.053], [0.64, 0.040], [0.72, 0.027], [0.78, 0.017], [0.83, 0.011], [0.86, 0.010]],
      half: [[0, 0], [0.01, 0.006], [0.03, 0.014], [0.06, 0.022], [0.10, 0.031], [0.15, 0.038], [0.20, 0.044], [0.26, 0.049], [0.33, 0.052], [0.40, 0.051], [0.48, 0.047], [0.56, 0.040], [0.64, 0.031], [0.72, 0.021], [0.78, 0.014], [0.83, 0.010], [0.86, 0.010]],
      yo: [[0, -0.004], [0.08, -0.002], [0.2, 0], [0.86, 0]],
      keel: [[0.78, 0], [0.82, 0.003], [0.85, 0.004], [0.86, 0.003]],
    },
    mouth: {
      front: 0.006, corner: 0.085, alphaF: 1.55, alphaC: 1.30, shape: 0.6, snoutBlend: 0.006,
      palate: 0.4, floor: 0.4, throat: 0.6, pharynx: 0.05, lipDrop: 0.0006, chinInset: 0.0008,
    },
    eye: { s: 0.075, up: 0.30, r: 0.024, flat: 0.55, out: 0.25, socket: 0.06, fwd: 0.05, fixed: true },
    bones: { head: 0.10, neck: 0.22, root: 0.38, tail: [0.52, 0.64, 0.75, 0.86] },
    fins: [
      { name: "dorsal1", role: "median", at: 0.31, root: 0.115, span: 0.072, dir: [0, 1, 0], phi: Math.PI, sweep: 0.42, bow: 0.02, tipC: 0.06, conc: 0.05, rear: 0, rearH: 0, round: 0.15, tc: 0.06, tcTip: 0.03, embed: 0.4 },
      { name: "dorsal2", role: "median", at: 0.58, root: 0.055, span: 0.048, dir: [0, 1, 0], phi: Math.PI, sweep: 0.55, bow: 0.02, tipC: 0.12, conc: 0.22, rear: 0.12, rearH: 0.25, round: 0.2, tc: 0.07, embed: 0.4 },
      { name: "anal", role: "median", at: 0.60, root: 0.050, span: 0.040, dir: [0, -1, 0], phi: 0, sweep: 0.55, tipC: 0.12, conc: 0.22, rear: 0.12, rearH: 0.25, round: 0.2, tc: 0.07, embed: 0.4 },
      { name: "pecR", role: "paired", at: 0.25, root: 0.035, span: 0.10, dir: [-0.62, 0.05, 0.78], phi: 1.75, sweep: 0.35, tipC: 0.12, conc: 0.08, rear: 0.1, rearH: 0.12, round: 0.3, tc: 0.08, embed: 0.3 },
      { name: "pecL", role: "paired", at: 0.25, root: 0.035, span: 0.10, dir: [-0.62, 0.05, -0.78], phi: 2 * Math.PI - 1.75, sweep: 0.35, tipC: 0.12, conc: 0.08, rear: 0.1, rearH: 0.12, round: 0.3, tc: 0.08, embed: 0.3 },
      { name: "pelvR", role: "paired", at: 0.30, root: 0.030, span: 0.045, dir: [-0.5, -0.7, 0.35], phi: 0.30, sweep: 0.4, tipC: 0.15, conc: 0.05, rear: 0.1, rearH: 0.15, round: 0.3, tc: 0.08, embed: 0.4 },
      { name: "pelvL", role: "paired", at: 0.30, root: 0.030, span: 0.045, dir: [-0.5, -0.7, -0.35], phi: 2 * Math.PI - 0.30, sweep: 0.4, tipC: 0.15, conc: 0.05, rear: 0.1, rearH: 0.15, round: 0.3, tc: 0.08, embed: 0.4 },
      { name: "caudalU", role: "median", originS: 0.855, originDy: 0.002, root: 0.05, span: 0.17, dir: [-0.60, 0.80, 0], sweep: 0.30, bow: 0.05, tipC: 0.06, conc: 0.10, rear: 0, rearH: 0, round: 0.05, tc: 0.07, tcTip: 0.04, embed: 0.5 },
      { name: "caudalL", role: "median", originS: 0.855, originDy: -0.002, root: 0.05, span: 0.17, dir: [-0.60, -0.80, 0], sweep: 0.30, bow: 0.05, tipC: 0.06, conc: 0.10, rear: 0, rearH: 0, round: 0.05, tc: 0.07, tcTip: 0.04, embed: 0.5 },
    ].concat(finlets("dfin", 0.655, 0.790, 5, false), finlets("afin", 0.670, 0.795, 5, true)),
    // a fish opens by dropping the lower jaw, lifting the head a little and
    // sliding the upper jaw out and down
    jaw: { lift: 0.10, drop: 0.55, protrude: [0.008, -0.004], gap: 0.02 },
    wave: { lambda: 1.0, amp: 0.095, env: [0.03, 0.0, 1.0], f0: 0.6, fK: 1.4, fMax: 8 },
    finColor: 0x26403f,
    lod: SCHOOL_LOD,
  };
  MACKEREL_SPEC.makePaint = fishPaint(MACKEREL_SPEC, {
    back: 0x123c44, belly: 0xd8dde0, fin: 0x2a3a3c, cheek: 0xb4bcc0, iris: 0xa8b0a0,
    line: [[0, 0.20], [0.10, 0.12], [0.25, 0.10], [0.50, 0.04], [0.75, 0.0], [0.86, 0.0]],
    rag: 0.04, specBack: 0.45, specBelly: 0.7, specFin: 0.3,
    opercle: { s: 0.255, h: -0.05, k: 0.030, top: 0.62 },
    scales: { size: 0.006, s0: 0.24, s1: 0.86 },
    // the wavy bars: on the back above mid-flank, faded into the line
    pattern: { kind: 1, unit: 0.024, strength: function (c) {
      const s = c.m[0];
      return MB.sm((c.f(0) / 4 - 0.02) / 0.12) * MB.sm((s - 0.22) / 0.04) * (1 - MB.sm((s - 0.80) / 0.05));
    } },
    skin: function (c, col, up) {
      // a pearly band along the silver just under the bars
      if (!up) { const d = -c.f(0) / 4; if (d < 0.25) col = MB.mixc(col, MB.hexc(0xc9c2b4), 0.25 * (1 - d / 0.25)); }
      return col;
    },
  });
  S({
    id: "fish", name: "Mackerel", biome: "water", rarity: "common",
    hp: 5, fur: "Fresh Fish", furValue: 8, meat: "Fish Fillet", meatValue: 5,
    herd: [12, 30], packs: 4, spd: 1.1, danger: 0, aquatic: true,
    scale: 0.22, color: 0x2b6a63, swimDepth: 1.7,
    build: function () { return marineBuild(MACKEREL_SPEC); },
  });

  /* ---- EUROPEAN PILCHARD (SARDINE) — Sardina pilchardus. 22 cm. A round,
     slightly compressed body (deepest ~16% TL, width 0.6 of the depth) with
     a keel of scutes along the belly, a short snout and a small upturned
     mouth, a big eye; one dorsal fin at mid-body over the pelvics, low
     pectorals, a long low anal fin far back, a forked caudal. Big scales
     (about 28 down the side), a green-blue back over bright silver, a row
     of dark spots along the upper flank. 1.10 model units at scale 0.2. */
  const SARDINE_SPEC = {
    id: "sardine", plan: "lateral", profileName: "sardine",
    L: 1.10, xNose: 0.50, axisY: 0.40, noseRound: 0.008, tubeEnd: 0.84, headEnd: 0.22,
    profile: {
      top: [[0, 0], [0.01, 0.010], [0.03, 0.020], [0.06, 0.032], [0.10, 0.044], [0.15, 0.056], [0.21, 0.066], [0.28, 0.074], [0.36, 0.077], [0.44, 0.075], [0.52, 0.068], [0.60, 0.057], [0.68, 0.043], [0.75, 0.030], [0.80, 0.020], [0.84, 0.016]],
      bot: [[0, 0], [0.01, 0.010], [0.03, 0.020], [0.06, 0.032], [0.10, 0.045], [0.15, 0.058], [0.21, 0.070], [0.28, 0.078], [0.36, 0.081], [0.44, 0.078], [0.52, 0.070], [0.60, 0.058], [0.68, 0.044], [0.75, 0.030], [0.80, 0.020], [0.84, 0.016]],
      half: [[0, 0], [0.01, 0.008], [0.03, 0.016], [0.06, 0.024], [0.10, 0.032], [0.15, 0.039], [0.21, 0.044], [0.28, 0.047], [0.36, 0.048], [0.44, 0.046], [0.52, 0.042], [0.60, 0.036], [0.68, 0.028], [0.75, 0.020], [0.80, 0.014], [0.84, 0.011]],
      yo: [[0, 0.004], [0.06, 0.002], [0.15, 0], [0.84, 0]],
      nB: [[0, 2.0], [0.2, 1.7], [0.7, 1.8], [0.84, 2.0]],
    },
    mouth: {
      front: 0.004, corner: 0.065, alphaF: 1.75, alphaC: 1.45, shape: 0.6, snoutBlend: 0.004,
      palate: 0.4, floor: 0.4, throat: 0.6, pharynx: 0.05, lipDrop: 0.0005, chinInset: 0.0007,
    },
    eye: { s: 0.080, up: 0.25, r: 0.027, flat: 0.55, out: 0.25, socket: 0.06, fwd: 0.05, fixed: true },
    bones: { head: 0.10, neck: 0.22, root: 0.40, tail: [0.54, 0.66, 0.76, 0.85] },
    fins: [
      { name: "dorsal1", role: "median", at: 0.40, root: 0.11, span: 0.075, dir: [0, 1, 0], phi: Math.PI, sweep: 0.30, bow: 0.04, tipC: 0.12, conc: 0.05, rear: 0.05, rearH: 0.1, round: 0.3, tc: 0.06, embed: 0.4 },
      { name: "anal", role: "median", at: 0.70, root: 0.095, span: 0.025, dir: [0, -1, 0], phi: 0, sweep: 0.3, tipC: 0.5, conc: 0, rear: 0.1, rearH: 0.3, round: 0.3, tc: 0.06, embed: 0.4 },
      { name: "pecR", role: "paired", at: 0.215, root: 0.030, span: 0.10, dir: [-0.80, -0.25, 0.55], phi: 0.60, sweep: 0.45, tipC: 0.12, conc: 0.05, rear: 0.05, rearH: 0.1, round: 0.3, tc: 0.06, embed: 0.3 },
      { name: "pecL", role: "paired", at: 0.215, root: 0.030, span: 0.10, dir: [-0.80, -0.25, -0.55], phi: 2 * Math.PI - 0.60, sweep: 0.45, tipC: 0.12, conc: 0.05, rear: 0.05, rearH: 0.1, round: 0.3, tc: 0.06, embed: 0.3 },
      { name: "pelvR", role: "paired", at: 0.47, root: 0.025, span: 0.05, dir: [-0.6, -0.65, 0.4], phi: 0.25, sweep: 0.4, tipC: 0.15, round: 0.3, tc: 0.06, embed: 0.4 },
      { name: "pelvL", role: "paired", at: 0.47, root: 0.025, span: 0.05, dir: [-0.6, -0.65, -0.4], phi: 2 * Math.PI - 0.25, sweep: 0.4, tipC: 0.15, round: 0.3, tc: 0.06, embed: 0.4 },
      { name: "caudalU", role: "median", originS: 0.835, originDy: 0.002, root: 0.045, span: 0.16, dir: [-0.62, 0.78, 0], sweep: 0.3, bow: 0.04, tipC: 0.06, conc: 0.12, rear: 0, rearH: 0, round: 0.05, tc: 0.06, tcTip: 0.04, embed: 0.5 },
      { name: "caudalL", role: "median", originS: 0.835, originDy: -0.002, root: 0.045, span: 0.16, dir: [-0.62, -0.78, 0], sweep: 0.3, bow: 0.04, tipC: 0.06, conc: 0.12, rear: 0, rearH: 0, round: 0.05, tc: 0.06, tcTip: 0.04, embed: 0.5 },
    ],
    jaw: { lift: 0.08, drop: 0.50, protrude: [0.006, -0.002], gap: 0.02 },
    wave: { lambda: 0.95, amp: 0.10, env: [0.03, 0.0, 1.0], f0: 0.7, fK: 1.4, fMax: 9 },
    finColor: 0x5a6a6c,
    lod: SCHOOL_LOD,
  };
  // the row of dark spots behind the gill cover
  const SARDINE_SPOTS = [[0.255, 0.26], [0.300, 0.24], [0.345, 0.25], [0.392, 0.22], [0.440, 0.23]];
  SARDINE_SPEC.makePaint = fishPaint(SARDINE_SPEC, {
    back: 0x154048, belly: 0xdfe4e6, fin: 0x5a6a6c, cheek: 0xd2d8da, cheekK: 0.25, iris: 0xbfc2b8,
    line: [[0, 0.40], [0.2, 0.36], [0.5, 0.34], [0.84, 0.36]],
    rag: 0.03, specBack: 0.5, specBelly: 0.85, specFin: 0.3,
    opercle: { s: 0.215, h: 0.0, k: 0.030, top: 0.55 },
    scales: { size: 0.030, s0: 0.22, s1: 0.82 },
    mark: function (c) {
      if (c.tag !== MB.TAG.SKIN || c.lod > 0) return NaN;
      const s = c.m[0], h = -c.m[1];
      let best = -1;
      for (let k = 0; k < SARDINE_SPOTS.length; k++) {
        const ds = (s - SARDINE_SPOTS[k][0]) / 0.014, dh = (h - SARDINE_SPOTS[k][1]) / 0.16;
        best = Math.max(best, 1 - ds * ds - dh * dh);
      }
      return best;
    },
    skin: function (c, col) {
      if (c.f(1) >= 0 && c.m[0] > 0.24) return MB.hexc(0x10181c);
      return col;
    },
  });
  S({
    id: "sardine", name: "Sardine", biome: "water", rarity: "common",
    hp: 3, fur: "Fresh Fish", furValue: 4, meat: "Fish Fillet", meatValue: 3,
    herd: [25, 70], spd: 0.95, danger: 0, aquatic: true,
    scale: 0.2, color: 0x9fb4c2, clearance: 14, swimDepth: 1.3,
    build: function () { return marineBuild(SARDINE_SPEC); },
  });

  /* ---- ATLANTIC BLUEFIN TUNA — Thunnus thynnus. 2.4 m. A torpedo of
     muscle: deepest ~25% TL at the first dorsal, nearly round (width 0.77
     of the depth), a conical head with a small mouth and a small eye. The
     spiny first dorsal folds back into a groove; the falcate second dorsal
     and anal fins; eight to nine yellow finlets above and below, edged
     black; short high pectorals (a fifth of the length) and small pelvics;
     a stiff lunate tail on a pencil-thin tail stock with a strong black
     keel between two small ones. Deep metallic navy above with an
     iridescent blue band, silver below crossed by rows of pale dots and
     lines. 2.64 model units (3.0 to the lobe tips) at scale 0.85. */
  const TUNA_SPEC = {
    id: "tuna", plan: "lateral", profileName: "tuna",
    L: 2.64, xNose: 1.22, axisY: 0.78, noseRound: 0.006, tubeEnd: 0.875, headEnd: 0.24,
    profile: {
      top: [[0, 0], [0.01, 0.012], [0.03, 0.026], [0.06, 0.044], [0.10, 0.064], [0.15, 0.084], [0.21, 0.104], [0.28, 0.120], [0.35, 0.128], [0.42, 0.126], [0.50, 0.114], [0.58, 0.094], [0.66, 0.068], [0.73, 0.044], [0.78, 0.028], [0.82, 0.018], [0.85, 0.014], [0.875, 0.012]],
      bot: [[0, 0], [0.01, 0.012], [0.03, 0.024], [0.06, 0.040], [0.10, 0.058], [0.15, 0.078], [0.21, 0.098], [0.28, 0.114], [0.35, 0.122], [0.42, 0.120], [0.50, 0.106], [0.58, 0.084], [0.66, 0.058], [0.73, 0.036], [0.78, 0.022], [0.82, 0.014], [0.85, 0.011], [0.875, 0.010]],
      half: [[0, 0], [0.01, 0.010], [0.03, 0.022], [0.06, 0.036], [0.10, 0.052], [0.15, 0.068], [0.21, 0.082], [0.28, 0.092], [0.35, 0.096], [0.42, 0.093], [0.50, 0.084], [0.58, 0.069], [0.66, 0.050], [0.73, 0.032], [0.78, 0.021], [0.82, 0.015], [0.85, 0.014], [0.875, 0.014]],
      yo: [[0, -0.004], [0.06, -0.002], [0.15, 0], [0.875, 0]],
      keel: [[0.76, 0], [0.80, 0.008], [0.84, 0.016], [0.875, 0.012]],
    },
    mouth: {
      front: 0.006, corner: 0.075, alphaF: 1.45, alphaC: 1.20, shape: 0.6, snoutBlend: 0.006,
      palate: 0.4, floor: 0.4, throat: 0.6, pharynx: 0.05, lipDrop: 0.0006, chinInset: 0.0010,
    },
    eye: { s: 0.088, up: 0.28, r: 0.015, flat: 0.55, out: 0.25, socket: 0.08, fwd: 0.05, fixed: true },
    bones: { head: 0.10, neck: 0.24, root: 0.40, tail: [0.56, 0.68, 0.78, 0.86, 0.94] },
    fins: [
      { name: "dorsal1", role: "median", at: 0.315, root: 0.17, span: 0.10, dir: [0, 1, 0], phi: Math.PI, sweep: 0.75, bow: 0.02, tipC: 0.03, conc: 0.30, rear: 0, rearH: 0, round: 0.08, tc: 0.05, tcTip: 0.03, embed: 0.4 },
      { name: "dorsal2", role: "median", at: 0.52, root: 0.075, span: 0.11, dir: [0, 1, 0], phi: Math.PI, sweep: 0.62, bow: 0.08, tipC: 0.06, conc: 0.40, rear: 0.10, rearH: 0.06, round: 0.06, tc: 0.08, tcTip: 0.03, embed: 0.4 },
      { name: "anal", role: "median", at: 0.56, root: 0.065, span: 0.10, dir: [0, -1, 0], phi: 0, sweep: 0.62, bow: 0.08, tipC: 0.06, conc: 0.40, rear: 0.10, rearH: 0.06, round: 0.06, tc: 0.08, tcTip: 0.03, embed: 0.4 },
      { name: "pecR", role: "paired", boneName: "pecR", at: 0.255, root: 0.045, span: 0.20, dir: [-0.62, -0.18, 0.76], phi: 1.85, sweep: 0.45, bow: 0.05, tipC: 0.06, conc: 0.18, rear: 0.08, rearH: 0.12, round: 0.05, tc: 0.08, tcTip: 0.04, embed: 0.3 },
      { name: "pecL", role: "paired", boneName: "pecL", at: 0.255, root: 0.045, span: 0.20, dir: [-0.62, -0.18, -0.76], phi: 2 * Math.PI - 1.85, sweep: 0.45, bow: 0.05, tipC: 0.06, conc: 0.18, rear: 0.08, rearH: 0.12, round: 0.05, tc: 0.08, tcTip: 0.04, embed: 0.3 },
      { name: "pelvR", role: "paired", at: 0.30, root: 0.030, span: 0.06, dir: [-0.55, -0.70, 0.45], phi: 0.35, sweep: 0.4, tipC: 0.15, round: 0.2, tc: 0.08, embed: 0.4 },
      { name: "pelvL", role: "paired", at: 0.30, root: 0.030, span: 0.06, dir: [-0.55, -0.70, -0.45], phi: 2 * Math.PI - 0.35, sweep: 0.4, tipC: 0.15, round: 0.2, tc: 0.08, embed: 0.4 },
      { name: "caudalU", role: "median", originS: 0.870, originDy: 0.002, root: 0.06, span: 0.20, dir: [-0.52, 0.85, 0], sweep: 0.62, bow: 0.06, tipC: 0.03, conc: 0.10, rear: 0, rearH: 0, round: 0.03, tc: 0.10, tcTip: 0.05, embed: 0.5 },
      { name: "caudalL", role: "median", originS: 0.870, originDy: -0.002, root: 0.06, span: 0.20, dir: [-0.52, -0.85, 0], sweep: 0.62, bow: 0.06, tipC: 0.03, conc: 0.10, rear: 0, rearH: 0, round: 0.03, tc: 0.10, tcTip: 0.05, embed: 0.5 },
    ].concat(finlets("dfin", 0.615, 0.825, 9, false), finlets("afin", 0.645, 0.825, 8, true)),
    jaw: { lift: 0.06, drop: 0.45, protrude: [0.003, -0.002], gap: 0.02 },
    // thunniform: the front two-thirds hardly bend, the tail stock swings
    wave: { lambda: 1.3, amp: 0.085, env: [0.012, 0.0, 1.0], f0: 0.4, fK: 1.3, fMax: 5 },
    finColor: 0x101c2c,
    lod: BIG_FISH_LOD,
  };
  TUNA_SPEC.makePaint = fishPaint(TUNA_SPEC, {
    back: 0x08142a, belly: 0xd2d9de, fin: 0x101c2c, cheek: 0xc4ccd2, iris: 0x2a2e2c,
    line: [[0, -0.05], [0.1, 0.0], [0.3, -0.05], [0.6, 0.0], [0.875, 0.05]],
    rag: 0.03, specBack: 0.55, specBelly: 0.9, specFin: 0.4,
    opercle: { s: 0.255, h: -0.10, k: 0.035, top: 0.55 },
    scales: { size: 0.005, s0: 0.12, s1: 0.86 },
    // rows of pale dots and lines down the silver flank
    pattern: { kind: 3, unit: 0.022, strength: function (c) {
      const s = c.m[0], h = -c.m[1];
      return MB.sm((-c.f(0) / 4 - 0.03) / 0.1) * MB.sm((h + 0.75) / 0.15) * MB.sm((s - 0.28) / 0.04) * (1 - MB.sm((s - 0.78) / 0.05));
    } },
    skin: function (c, col, up) {
      const s = c.m[0], h = -c.m[1];
      // the iridescent blue band along the upper flank
      if (up) {
        const d = c.f(0) / 4;
        const k = MB.sm(d / 0.08) * (1 - MB.sm((d - 0.30) / 0.12)) * MB.sm((s - 0.12) / 0.06) * (1 - MB.sm((s - 0.66) / 0.08));
        if (k > 0) col = MB.mixc(col, MB.hexc(0x1d5d96), 0.42 * k);
      } else if (-c.f(0) / 4 < 0.15) col = MB.mixc(col, MB.hexc(0xbfb68a), 0.22);
      // the black central keel on the tail stock
      if (s > 0.79 && Math.abs(h) < 0.35) col = MB.mixc(col, MB.hexc(0x06080a), MB.sm((s - 0.79) / 0.03) * (1 - MB.sm((Math.abs(h) - 0.2) / 0.15)));
      return col;
    },
    finHook: function (c, col, role, name) {
      if (/^[da]fin/.test(name)) return c.m[1] > 0.72 || c.m[0] > 0.85 ? MB.hexc(0x0a0c0c) : MB.hexc(0xc89a18);
      if (name === "dorsal1") return MB.mixc(col, MB.hexc(0x5a5230), 0.45);
      if (name === "dorsal2" || name === "anal") return MB.mixc(col, MB.hexc(0x6a5426), 0.55);
      return col;
    },
  });
  S({
    id: "tuna", name: "Bluefin Tuna", biome: "water", rarity: "uncommon",
    hp: 55, fur: "Fresh Fish", furValue: 90, meat: "Fish Fillet", meatValue: 26,
    herd: [3, 9], spd: 2.0, danger: 0, aquatic: true,
    scale: 0.85, color: 0x35506b, clearance: 90, swimDepth: 2.4,
    build: function () { return marineBuild(TUNA_SPEC); },
  });

  /* ---- BLUE MARLIN — Makaira nigricans. 3.6 m with the bill. The upper jaw
     runs out into a round spear (~13% TL beyond the lower jaw), the forehead
     rises steeply behind it; a deep, compressed body (~17% TL deep, width
     0.6 of the depth); the first dorsal a high pointed lobe (lower than the
     body is deep) falling at once into a long low crest; two small rear
     dorsal and anal fins and a triangular first anal; long sickle pectorals
     that fold flat, long ribbon pelvics; a huge stiff lunate tail on a
     double-keeled stock. Blue-black above, silver-white below, about
     fifteen bars of pale cobalt dots. 3.23 model units (3.4 to the lobe
     tips) at scale 1.05. */
  const MARLIN_SPEC = {
    id: "marlin", plan: "lateral", profileName: "marlin",
    L: 3.23, xNose: 1.45, axisY: 0.88, noseRound: 0.002, tubeEnd: 0.86, headEnd: 0.26,
    profile: {
      top: [[0, 0], [0.01, 0.0018], [0.05, 0.0040], [0.09, 0.0062], [0.13, 0.0085], [0.16, 0.026], [0.19, 0.046], [0.23, 0.066], [0.28, 0.082], [0.34, 0.090], [0.40, 0.090], [0.47, 0.085], [0.55, 0.074], [0.63, 0.058], [0.70, 0.042], [0.76, 0.028], [0.80, 0.019], [0.83, 0.014], [0.86, 0.012]],
      bot: [[0, 0], [0.01, 0.0018], [0.05, 0.0040], [0.09, 0.0062], [0.13, 0.0110], [0.16, 0.024], [0.19, 0.040], [0.23, 0.056], [0.28, 0.070], [0.34, 0.078], [0.40, 0.080], [0.47, 0.076], [0.55, 0.064], [0.63, 0.050], [0.70, 0.036], [0.76, 0.024], [0.80, 0.016], [0.83, 0.012], [0.86, 0.011]],
      half: [[0, 0], [0.01, 0.0018], [0.05, 0.0040], [0.09, 0.0062], [0.13, 0.0090], [0.16, 0.018], [0.19, 0.028], [0.23, 0.038], [0.28, 0.046], [0.34, 0.050], [0.40, 0.050], [0.47, 0.047], [0.55, 0.041], [0.63, 0.033], [0.70, 0.025], [0.76, 0.017], [0.80, 0.012], [0.83, 0.010], [0.86, 0.010]],
      yo: [[0, 0.012], [0.13, 0.010], [0.18, 0.004], [0.25, 0], [0.86, 0]],
      keel: [[0.76, 0], [0.80, 0.006], [0.84, 0.010], [0.86, 0.008]],
    },
    mouth: {
      front: 0.130, corner: 0.195, alphaF: 0.55, alphaC: 1.25, shape: 0.6, snoutBlend: 0.01,
      palate: 0.4, floor: 0.4, throat: 0.6, pharynx: 0.05, lipDrop: 0.0008, chinInset: 0.0012,
    },
    eye: { s: 0.200, up: 0.30, r: 0.0095, flat: 0.55, out: 0.25, socket: 0.08, fwd: 0.05, fixed: true },
    bones: { head: 0.16, neck: 0.27, root: 0.42, tail: [0.56, 0.67, 0.76, 0.84, 0.93] },
    fins: [
      { name: "dorsal1", role: "median", at: 0.225, root: 0.10, span: 0.13, dir: [0, 1, 0], phi: Math.PI, sweep: 0.25, bow: 0.05, tipC: 0.15, conc: 0.45, rear: 0, rearH: 0, round: 0.15, tc: 0.05, tcTip: 0.03, embed: 0.4 },
      { name: "crest", role: "median", at: 0.32, root: 0.30, span: 0.028, dir: [0, 1, 0], phi: Math.PI, sweep: 0.05, tipC: 0.85, conc: 0, rear: 0.02, rearH: 0.3, round: 0.3, tc: 0.04, embed: 0.4 },
      { name: "dorsal2", role: "median", at: 0.715, root: 0.035, span: 0.030, dir: [0, 1, 0], phi: Math.PI, sweep: 0.5, tipC: 0.2, conc: 0.2, rear: 0.15, rearH: 0.25, round: 0.2, tc: 0.08, embed: 0.4 },
      { name: "anal", role: "median", at: 0.53, root: 0.075, span: 0.065, dir: [0, -1, 0], phi: 0, sweep: 0.5, tipC: 0.1, conc: 0.3, rear: 0.05, rearH: 0.1, round: 0.1, tc: 0.06, embed: 0.4 },
      { name: "anal2", role: "median", at: 0.725, root: 0.030, span: 0.025, dir: [0, -1, 0], phi: 0, sweep: 0.5, tipC: 0.2, conc: 0.2, rear: 0.15, rearH: 0.25, round: 0.2, tc: 0.08, embed: 0.4 },
      { name: "pecR", role: "paired", boneName: "pecR", at: 0.245, root: 0.035, span: 0.17, dir: [-0.70, -0.35, 0.62], phi: 0.75, sweep: 0.40, bow: 0.04, tipC: 0.06, conc: 0.15, rear: 0.06, rearH: 0.12, round: 0.05, tc: 0.08, tcTip: 0.03, embed: 0.3 },
      { name: "pecL", role: "paired", boneName: "pecL", at: 0.245, root: 0.035, span: 0.17, dir: [-0.70, -0.35, -0.62], phi: 2 * Math.PI - 0.75, sweep: 0.40, bow: 0.04, tipC: 0.06, conc: 0.15, rear: 0.06, rearH: 0.12, round: 0.05, tc: 0.08, tcTip: 0.03, embed: 0.3 },
      { name: "pelvR", role: "paired", at: 0.265, root: 0.012, span: 0.12, dir: [-0.55, -0.82, 0.12], phi: 0.15, sweep: 0.2, tipC: 0.5, conc: 0, rear: 0.05, round: 0.4, tc: 0.10, embed: 0.4 },
      { name: "pelvL", role: "paired", at: 0.265, root: 0.012, span: 0.12, dir: [-0.55, -0.82, -0.12], phi: 2 * Math.PI - 0.15, sweep: 0.2, tipC: 0.5, conc: 0, rear: 0.05, round: 0.4, tc: 0.10, embed: 0.4 },
      { name: "caudalU", role: "median", originS: 0.855, originDy: 0.002, root: 0.055, span: 0.20, dir: [-0.48, 0.88, 0], sweep: 0.65, bow: 0.06, tipC: 0.03, conc: 0.10, rear: 0, rearH: 0, round: 0.03, tc: 0.09, tcTip: 0.04, embed: 0.5 },
      { name: "caudalL", role: "median", originS: 0.855, originDy: -0.002, root: 0.055, span: 0.20, dir: [-0.48, -0.88, 0], sweep: 0.65, bow: 0.06, tipC: 0.03, conc: 0.10, rear: 0, rearH: 0, round: 0.03, tc: 0.09, tcTip: 0.04, embed: 0.5 },
    ],
    jaw: { lift: 0.08, drop: 0.40, protrude: [0, 0], gap: 0.015 },
    wave: { lambda: 1.25, amp: 0.085, env: [0.012, 0.0, 1.0], f0: 0.3, fK: 1.2, fMax: 3.5 },
    finColor: 0x0a1530,
    lod: BIG_FISH_LOD,
  };
  MARLIN_SPEC.makePaint = fishPaint(MARLIN_SPEC, {
    back: 0x051330, belly: 0xdfe5e9, fin: 0x0a1530, cheek: 0xc8d0d6, iris: 0x2a3036,
    line: [[0, 0.2], [0.13, 0.15], [0.20, -0.05], [0.40, -0.10], [0.70, -0.05], [0.86, 0]],
    rag: 0.04, specBack: 0.45, specBelly: 0.8, specFin: 0.35,
    opercle: { s: 0.265, h: -0.15, k: 0.030, top: 0.5 },
    // the bars of pale cobalt dots, spine to lower flank
    pattern: { kind: 2, unit: 0.040, strength: function (c) {
      const s = c.m[0], h = -c.m[1];
      return MB.sm((s - 0.25) / 0.03) * (1 - MB.sm((s - 0.70) / 0.05)) * MB.sm((h + 0.45) / 0.15) * (1 - MB.sm((h - 0.75) / 0.12));
    } },
    skin: function (c, col) {
      // the spear is dark and rough, the same blue-black on both faces
      if (c.m[0] < 0.135) return MB.mixc(MB.hexc(0x0c1626), col, MB.sm((c.m[0] - 0.12) / 0.015));
      return col;
    },
  });
  S({
    id: "marlin", name: "Blue Marlin", biome: "water", rarity: "rare",
    hp: 130, fur: "Marlin Bill", furValue: 420, meat: "Fish Fillet", meatValue: 34,
    packs: 1, spd: 2.1, danger: 0.15, aquatic: true,
    scale: 1.05, color: 0x1c3f6d, clearance: 150, swimDepth: 3.2,
    build: function () { return marineBuild(MARLIN_SPEC); },
  });

  /* ---- GREAT BARRACUDA — Sphyraena barracuda. 1.3 m. Long and nearly
     round (~13% TL deep), a long pointed head (~27% TL) with the lower jaw
     jutting past the upper and a big mouth set with fangs of unequal size
     (a pair of long canines at the front of each jaw); the eye big and
     high; two widely separated dorsals (five spines over the pelvics, a
     falcate second over the anal), small low pectorals, a forked tail with
     a concave margin and pale lobe tips. Grey-green back over silver, faint
     oblique bars above mid-flank, scattered black blotches low on the rear
     half. 2.89 model units at scale 0.45. */
  const CUDA_SPEC = {
    id: "barracuda", plan: "lateral", profileName: "barracuda",
    L: 2.89, xNose: 1.40, axisY: 0.55, noseRound: 0.006, tubeEnd: 0.875, headEnd: 0.28,
    profile: {
      top: [[0, 0], [0.01, 0.006], [0.04, 0.016], [0.08, 0.026], [0.12, 0.034], [0.17, 0.042], [0.23, 0.050], [0.30, 0.058], [0.38, 0.064], [0.46, 0.065], [0.54, 0.062], [0.62, 0.055], [0.70, 0.044], [0.76, 0.033], [0.81, 0.024], [0.85, 0.018], [0.875, 0.016]],
      bot: [[0, 0], [0.01, 0.008], [0.04, 0.018], [0.08, 0.028], [0.12, 0.036], [0.17, 0.043], [0.23, 0.050], [0.30, 0.056], [0.38, 0.062], [0.46, 0.064], [0.54, 0.061], [0.62, 0.054], [0.70, 0.043], [0.76, 0.032], [0.81, 0.023], [0.85, 0.017], [0.875, 0.015]],
      half: [[0, 0], [0.01, 0.006], [0.04, 0.014], [0.08, 0.022], [0.12, 0.028], [0.17, 0.034], [0.23, 0.040], [0.30, 0.045], [0.38, 0.049], [0.46, 0.050], [0.54, 0.048], [0.62, 0.043], [0.70, 0.035], [0.76, 0.027], [0.81, 0.020], [0.85, 0.015], [0.875, 0.014]],
      yo: [[0, -0.008], [0.06, -0.005], [0.15, -0.002], [0.25, 0], [0.875, 0]],
    },
    mouth: {
      front: 0.004, corner: 0.115, alphaF: 1.95, alphaC: 1.45, shape: 0.5, snoutBlend: 0.005,
      palate: 0.5, floor: 0.45, throat: 0.7, pharynx: 0.06, lipDrop: 0.0008, chinInset: 0.0010,
      teeth: {
        upper: [
          { n: 4, h: 0.016, w: 0.0060, inset: 0.0035, sink: 0.0020, rake: 0.05, rakeCorner: 0.1, tilt: 0.0, thick: 0.35, cornerK: 0.9, span: 0.10 },
          { n: 26, h: 0.0062, w: 0.0035, inset: 0.0030, sink: 0.0015, rake: 0.25, rakeCorner: 0.3, tilt: 0.05, thick: 0.3, cornerK: 0.6, jag: 0.55, span: 0.86 },
        ],
        lower: [
          { n: 2, h: 0.018, w: 0.0065, inset: 0.0030, sink: 0.0020, rake: 0.0, rakeCorner: 0.1, thick: 0.35, cornerK: 0.9, span: 0.06 },
          { n: 24, h: 0.0068, w: 0.0036, inset: 0.0030, sink: 0.0015, rake: 0.2, rakeCorner: 0.3, tilt: -0.05, thick: 0.3, cornerK: 0.6, jag: 0.55, span: 0.86 },
        ],
      },
    },
    eye: { s: 0.135, up: 0.42, r: 0.018, flat: 0.55, out: 0.25, socket: 0.08, fwd: 0.05, fixed: true },
    bones: { head: 0.12, neck: 0.25, root: 0.42, tail: [0.56, 0.67, 0.77, 0.86, 0.94] },
    fins: [
      { name: "dorsal1", role: "median", at: 0.37, root: 0.065, span: 0.065, dir: [0, 1, 0], phi: Math.PI, sweep: 0.45, bow: 0.03, tipC: 0.08, conc: 0.12, rear: 0, rearH: 0, round: 0.15, tc: 0.06, embed: 0.4 },
      { name: "dorsal2", role: "median", at: 0.645, root: 0.060, span: 0.055, dir: [0, 1, 0], phi: Math.PI, sweep: 0.60, bow: 0.05, tipC: 0.06, conc: 0.35, rear: 0.15, rearH: 0.08, round: 0.06, tc: 0.07, embed: 0.4 },
      { name: "anal", role: "median", at: 0.665, root: 0.058, span: 0.050, dir: [0, -1, 0], phi: 0, sweep: 0.60, bow: 0.05, tipC: 0.06, conc: 0.35, rear: 0.15, rearH: 0.08, round: 0.06, tc: 0.07, embed: 0.4 },
      { name: "pecR", role: "paired", boneName: "pecR", at: 0.265, root: 0.030, span: 0.085, dir: [-0.80, -0.15, 0.58], phi: 0.95, sweep: 0.4, tipC: 0.15, conc: 0.05, rear: 0.1, rearH: 0.15, round: 0.3, tc: 0.07, embed: 0.3 },
      { name: "pecL", role: "paired", boneName: "pecL", at: 0.265, root: 0.030, span: 0.085, dir: [-0.80, -0.15, -0.58], phi: 2 * Math.PI - 0.95, sweep: 0.4, tipC: 0.15, conc: 0.05, rear: 0.1, rearH: 0.15, round: 0.3, tc: 0.07, embed: 0.3 },
      { name: "pelvR", role: "paired", at: 0.37, root: 0.025, span: 0.05, dir: [-0.55, -0.72, 0.42], phi: 0.30, sweep: 0.4, tipC: 0.15, round: 0.3, tc: 0.07, embed: 0.4 },
      { name: "pelvL", role: "paired", at: 0.37, root: 0.025, span: 0.05, dir: [-0.55, -0.72, -0.42], phi: 2 * Math.PI - 0.30, sweep: 0.4, tipC: 0.15, round: 0.3, tc: 0.07, embed: 0.4 },
      { name: "caudalU", role: "median", originS: 0.870, originDy: 0.002, root: 0.06, span: 0.15, dir: [-0.62, 0.78, 0], sweep: 0.45, bow: 0.05, tipC: 0.05, conc: 0.18, rear: 0, rearH: 0, round: 0.04, tc: 0.08, tcTip: 0.04, embed: 0.5 },
      { name: "caudalL", role: "median", originS: 0.870, originDy: -0.002, root: 0.06, span: 0.15, dir: [-0.62, -0.78, 0], sweep: 0.45, bow: 0.05, tipC: 0.05, conc: 0.18, rear: 0, rearH: 0, round: 0.04, tc: 0.08, tcTip: 0.04, embed: 0.5 },
    ],
    jaw: { lift: 0.15, drop: 0.65, protrude: [0.004, 0], gap: 0.02 },
    wave: { lambda: 0.95, amp: 0.09, env: [0.025, 0.0, 1.0], f0: 0.5, fK: 1.3, fMax: 6 },
    finColor: 0x1c2428,
    lod: BIG_FISH_LOD,
  };
  CUDA_SPEC.makePaint = fishPaint(CUDA_SPEC, {
    back: 0x1e2e34, belly: 0xe8eced, fin: 0x1c2428, cheek: 0xc2cacc, iris: 0xb8b48c,
    line: [[0, 0.25], [0.15, 0.15], [0.30, 0.12], [0.60, 0.10], [0.875, 0.10]],
    rag: 0.03, specBack: 0.4, specBelly: 0.75, specFin: 0.3,
    opercle: { s: 0.275, h: -0.05, k: 0.030, top: 0.6 },
    scales: { size: 0.011, s0: 0.24, s1: 0.86 },
    // faint oblique bars above mid-flank (kind 4); black blotches low on the
    // rear half (kind 5): one kind per side of the line, faded to nothing
    // across it so the switch never shows
    pattern: { kind: function (c) { return c.f(0) >= 0 ? 4 : 5; }, unit: 0.040, strength: function (c) {
      const s = c.m[0], d = c.f(0) / 4;
      if (d >= 0) return 0.75 * MB.sm((d - 0.03) / 0.1) * MB.sm((s - 0.24) / 0.04) * (1 - MB.sm((s - 0.78) / 0.05));
      return MB.sm((-d - 0.05) / 0.1) * MB.sm((s - 0.45) / 0.06) * (1 - MB.sm((s - 0.84) / 0.03));
    } },
    finHook: function (c, col, role, name) {
      // the forked tail's pale lobe tips; the soft fins' pale tips
      if (name === "caudalU" || name === "caudalL") return c.m[0] > 0.80 ? MB.mixc(col, MB.hexc(0xd6dadb), MB.sm((c.m[0] - 0.80) / 0.06)) : col;
      if (name === "dorsal2" || name === "anal") return c.m[0] > 0.82 ? MB.mixc(col, MB.hexc(0xc8cccc), 0.7) : col;
      return col;
    },
  });
  S({
    id: "barracuda", name: "Great Barracuda", biome: "water",
    rarity: "common", hp: 34, fur: "Fresh Fish", furValue: 46,
    meat: "Fish Fillet", meatValue: 14, herd: [1, 2], spd: 3.1, danger: 0.3,
    bite: 10, aquatic: true, scale: 0.45, color: 0xa9b6bd,
    clearance: 26, swimDepth: 1.6,
    build: function () { return marineBuild(CUDA_SPEC); },
  });

  /* ==========================================================================
     THE CETACEANS. Same hull and blade grammar; the difference that matters is
     the tail, which is a HORIZONTAL fluke. wildlife.js decides fish-vs-whale
     from the proportions of the rear-most child, so the fluke is built as one
     merged two-lobed mesh — two separate lobes would each read as a tall
     narrow caudal blade and the whale would swim like a shark.
     ========================================================================== */

  /* ============================================================
     ORCA — Orcinus orca. A robust dolphin: deepest ~20% TL and a little
     narrower than deep, a short blunt conical head with no beak, the mouth
     line running from the snout tip back to just under the eye, 10-12
     conical interlocking teeth per jaw side, the eye small and set just
     above and behind the mouth corner, the blowhole a sixth of the way back
     on top, a laterally compressed keeled tail stock, broad notched flukes
     with white undersides, and large rounded paddle flippers. Sexually
     dimorphic: a cow's dorsal is falcate and ~14% TL tall; a bull's is an
     erect triangle ~21% TL tall, and his flippers and flukes are bigger.
     The markings that name the animal: jet black over crisp white, the
     white chin and throat, the white post-ocular eye patch (a teardrop
     three times as long as it is tall, its narrow end just behind the eye),
     the white flank lobe sweeping up behind the dorsal, and the grey saddle
     behind the fin. 6.85 model units at scale 0.95 is a 6.5 m adult.
     The two sexes share one skeleton; city/wildlife_orca.js picks one per
     individual (CBZ.marineOrca.retemplate).
     ============================================================ */
  function orcaSpec(bull) {
    const sp = {
      id: bull ? "orca_bull" : "orca_cow", plan: "vertical", profileName: "orca",
      L: 6.85, xNose: 3.25, axisY: 1.05, noseRound: 0.045, tubeEnd: 0.90, headEnd: 0.22,
      profile: {
        top: [[0, 0], [0.02, 0.024], [0.05, 0.046], [0.09, 0.066], [0.14, 0.083], [0.20, 0.095], [0.28, 0.103], [0.36, 0.106], [0.45, 0.103], [0.55, 0.094], [0.65, 0.078], [0.74, 0.058], [0.80, 0.044], [0.86, 0.032], [0.90, 0.022]],
        bot: [[0, 0], [0.02, 0.020], [0.05, 0.038], [0.09, 0.056], [0.14, 0.072], [0.20, 0.086], [0.28, 0.094], [0.36, 0.096], [0.45, 0.092], [0.55, 0.082], [0.65, 0.066], [0.74, 0.048], [0.80, 0.036], [0.86, 0.026], [0.90, 0.018]],
        half: [[0, 0], [0.02, 0.022], [0.05, 0.042], [0.09, 0.058], [0.14, 0.070], [0.20, 0.078], [0.28, 0.082], [0.36, 0.083], [0.45, 0.079], [0.55, 0.068], [0.65, 0.050], [0.74, 0.032], [0.80, 0.022], [0.86, 0.015], [0.90, 0.011]],
        yo: [[0, -0.010], [0.08, -0.004], [0.16, 0], [0.9, 0]],
        nT: [[0, 2.0], [0.70, 2.0], [0.84, 1.55], [0.90, 1.45]],
        nB: [[0, 2.2], [0.20, 2.0], [0.70, 2.0], [0.84, 1.6], [0.90, 1.5]],
      },
      mouth: {
        front: 0.008, corner: 0.118, alphaF: 0.95, alphaC: 1.42, shape: 0.7, snoutBlend: 0.01,
        palate: 0.5, floor: 0.45, throat: 0.6, pharynx: 0.05, lipDrop: 0.0006, chinInset: 0.0012,
        teeth: {
          upper: [{ n: 24, h: 0.0070, w: 0.0044, inset: 0.0048, sink: 0.0022, rake: 0.10, rakeCorner: 0.25, tilt: 0.06, thick: 0.85, cornerK: 0.6 }],
          lower: [{ n: 24, h: 0.0066, w: 0.0042, inset: 0.0048, sink: 0.0020, rake: 0.10, rakeCorner: 0.25, tilt: 0.06, thick: 0.85, cornerK: 0.6 }],
        },
      },
      eye: { s: 0.138, up: 0.10, r: 0.0026, out: 0.36, socket: 0.2, fwd: 0.05 },
      bones: { head: 0.11, neck: 0.20, root: 0.42, tail: [0.56, 0.68, 0.78, 0.86, 0.94] },
      fins: [
        bull
          ? { name: "dorsal1", role: "median", at: 0.350, root: 0.150, span: 0.210, dir: [0, 1, 0], phi: Math.PI, sweep: 0.10, bow: 0.02, tipC: 0.08, conc: 0.03, rear: 0.22, rearH: 0.06, round: 0.10, tc: 0.16, tcTip: 0.06, embed: 0.4 }
          : { name: "dorsal1", role: "median", at: 0.360, root: 0.135, span: 0.135, dir: [0, 1, 0], phi: Math.PI, sweep: 0.58, bow: 0.07, tipC: 0.06, conc: 0.36, rear: 0.20, rearH: 0.07, round: 0.16, tc: 0.14, tcTip: 0.05, embed: 0.4 },
        { name: "pecR", role: "median", boneName: "pecR", at: 0.225, root: 0.075, span: bull ? 0.190 : 0.125, dir: [-0.28, -0.45, 0.85], phi: 0.78, sweep: 0.22, bow: 0.10, tipC: bull ? 0.66 : 0.62, conc: 0.02, rear: 0.08, rearH: 0.2, round: bull ? 0.60 : 0.55, tc: 0.16, tcTip: 0.10, embed: 0.3 },
        { name: "pecL", role: "median", boneName: "pecL", at: 0.225, root: 0.075, span: bull ? 0.190 : 0.125, dir: [-0.28, -0.45, -0.85], phi: 2 * Math.PI - 0.78, sweep: 0.22, bow: 0.10, tipC: bull ? 0.66 : 0.62, conc: 0.02, rear: 0.08, rearH: 0.2, round: bull ? 0.60 : 0.55, tc: 0.16, tcTip: 0.10, embed: 0.3 },
        { name: "flukeR", role: "paired", originS: 0.90, originDz: 0.010, root: 0.13, span: bull ? 0.140 : 0.120, dir: [0, 0, 1], chordDir: [1, 0, 0], sweep: 0.52, bow: 0.06, tipC: 0.06, conc: 0.20, rear: 0.10, rearH: 0.12, round: 0.06, tc: 0.12, tcTip: 0.05, embed: 0.3 },
        { name: "flukeL", role: "paired", originS: 0.90, originDz: -0.010, root: 0.13, span: bull ? 0.140 : 0.120, dir: [0, 0, -1], chordDir: [1, 0, 0], sweep: 0.52, bow: 0.06, tipC: 0.06, conc: 0.20, rear: 0.10, rearH: 0.12, round: 0.06, tc: 0.12, tcTip: 0.05, embed: 0.3 },
      ],
      // a whale opens the lower jaw; nothing lifts and nothing protrudes
      jaw: { lift: 0, drop: 0.55, protrude: [0, 0], gap: 0.04 },
      // the flukes beat up and down; the front of the body barely moves
      wave: { lambda: 1.1, amp: 0.070, env: [0.02, 0.0, 1.0], f0: 0.35, fK: 0.80, fMax: 2.0 },
      finColor: 0x06080a, saddleS: 0.30,
      lod: [
        { M: 32, ds: 0.020, headK: 0.6, noseRings: 6, eyeRings: true, gills: false, teeth: true, finSpan: 8, finChord: 7, eyeSeg: 10, eyeRing: 7, pharynx: 3 },
        { M: 14, ds: 0.060, headK: 0.6, noseRings: 3, eyeRings: false, gills: false, teeth: false, finSpan: 4, finChord: 3, eyeSeg: 6, eyeRing: 4, pharynx: 2 },
      ],
    };
    sp.makePaint = function (EY) {
      const roles = {};
      sp.fins.forEach(function (f, i) { roles[i + 1] = f.role; });
      return paintKit({
        L: sp.L, eyes: EY, finRole: roles,
        back: 0x06080a, belly: 0xf1f3f1, fin: 0x06080a,
        // upper jaw black to the lip; the white chin and throat; the band of
        // black between the flippers; the white flank lobe behind the dorsal
        line: [[0, -0.66], [0.01, -0.60], [0.03, -0.47], [0.06, -0.34], [0.09, -0.24], [0.118, -0.18], [0.15, -0.30], [0.20, -0.50], [0.26, -0.62], [0.34, -0.58], [0.42, -0.45], [0.50, -0.25], [0.57, 0.08], [0.63, 0.18], [0.69, -0.05], [0.76, -0.42], [0.84, -0.60], [0.90, -0.66]],
        rag: 0.025, specBack: 0.75, specBelly: 0.55, specFin: 0.75, iris: 0x1a1208, sclera: 0x2a2620,
        orbit: 0x06080a,
        // the eye patch: a teardrop, narrow end just behind the eye, rising back
        mark: function (c) {
          if (c.tag !== MB.TAG.SKIN) return NaN;
          const s = c.m[0], h = -c.m[1];
          const u = (s - 0.172) / 0.052;
          if (u < -1.4 || u > 1.4) return -1;
          const h0 = 0.26 + 0.09 * u, w = 0.105 * (0.50 + 0.50 * MB.sm((u + 1) / 2));
          return 1 - u * u - ((h - h0) / w) * ((h - h0) / w);
        },
        skin: function (c, col, up) {
          if (!up) return col;
          if (c.f(1) >= 0) return MB.hexc(0xf1f3f1);
          // the saddle: a soft grey crescent behind the dorsal
          const s = c.m[0], h = -c.m[1];
          const d = ((s - 0.53) / 0.07) * ((s - 0.53) / 0.07) + ((h - 0.86) / 0.26) * ((h - 0.86) / 0.26);
          if (d < 1.6) col = MB.mixc(col, MB.hexc(0x5a6670), 0.85 * MB.sm((1.6 - d) / 1.2));
          return col;
        },
        finHook: function (c, col, role) {
          // the flukes' white undersides keep a black trailing margin
          if (role === "paired" && c.f(0) < 0 && c.m[1] > 0.82) return MB.hexc(0x06080a);
          return col;
        },
      });
    };
    return sp;
  }
  const ORCA_COW = orcaSpec(false), ORCA_BULL = orcaSpec(true);
  /* What city/wildlife_orca.js needs of the body: a builder per sex, the
     swap between them, the blade on its own for the surface proxy, and the
     measurements its acts and proxies are placed by. */
  CBZ.marineOrca = {
    cow: ORCA_COW, bull: ORCA_BULL,
    build: function (sex) {
      const spec = sex === "bull" ? ORCA_BULL : ORCA_COW;
      const g = marineBuild(spec);
      const d = CBZ.marineOrca.dims();
      g.userData.orca = {
        len: d.x1 - d.x0, y: d.y, x0: d.x0, x1: d.x1,
        blow: { x: d.blowX, y: d.blowY, z: 0 }, dorsal: { x: d.dorsalX, y: d.backY },
        bullSpan: d.bullSpan, cowSpan: d.cowSpan,
        marks: { eyePatch: true, saddle: true, flankFlare: true, whiteChin: true, flukeUnder: true },
        dimorphic: true, blowhole: true, horizontalFlukes: true,
      };
      return g;
    },
    retemplate: function (g, sex) { return MB.retemplate(g, sex === "bull" ? ORCA_BULL : ORCA_COW); },
    finGeometry: function (sex) {
      return MB.finGeometry(sex === "bull" ? ORCA_BULL : ORCA_COW, "dorsal1", function () { return [1, 1, 1, 0.5]; });
    },
    dims: function () {
      if (this._dims) return this._dims;
      const cow = MB.template(ORCA_COW), bull = MB.template(ORCA_BULL);
      const PF = MB.makeProfile(ORCA_COW), L = ORCA_COW.L;
      const blowS = 0.175, Rb = MB.sectionAt(ORCA_COW, PF, blowS);
      let top = 0;
      for (let k = 0; k <= 40; k++) { const R = MB.sectionAt(ORCA_COW, PF, 0.9 * k / 40); top = Math.max(top, R.yc + R.top - ORCA_COW.axisY); }
      return (this._dims = {
        x1: ORCA_COW.xNose, x0: ORCA_COW.xNose - ORCA_COW.tubeEnd * L, y: ORCA_COW.axisY, top: top,
        len: cow.len, blowX: Rb.x, blowY: Rb.yc + Rb.top,
        dorsalX: cow.fins.dorsal1.origin[0], backY: cow.sharkFin ? cow.sharkFin.backY : ORCA_COW.axisY + top,
        cowSpan: cow.sharkFin ? cow.sharkFin.height : 0.9, bullSpan: bull.sharkFin ? bull.sharkFin.height : 1.4,
        planBeam: cow.box.max.z - cow.box.min.z,
      });
    },
  };
  S({
    id: "orca", name: "Orca", biome: "water", rarity: "rare",
    hp: 620, fur: "Orca Hide", furValue: 520, meat: "Whale Meat", meatValue: 44,
    // transient pods run 2-7, residents 5-50; [3,8] is the game-scaled band
    // (city/wildlife_orca.js re-registers this species with the pod, the
    // acts and the sexes; it builds this same body)
    herd: [3, 8], spd: 3.4, danger: 0.5, bite: 33, aquatic: true,
    scale: 0.95, color: 0x06080a, clearance: 110, swimDepth: 2.4,
    build: function () { return CBZ.marineOrca.build("cow"); },
  });

  /* ============================================================
     BOTTLENOSE DOLPHIN — Tursiops truncatus. A short thick beak (~6% TL)
     under a domed melon that drops onto it in a clean crease, the mouth line
     along the beak curving up at the corner (the "smile"), 20-26 small
     conical teeth per jaw side, the eye just behind and above the corner, the
     blowhole on top behind the melon, deepest (~19% TL) at 40% of the body,
     a tall falcate dorsal (~9% TL) at mid-body, pointed flippers (~15% TL),
     notched flukes (~25% TL across) on a keeled tail stock. Three tones: a
     dark cape over the back, mid-grey flanks, a pale belly. 4.4 model units
     at scale 0.66 is a 2.9 m adult.
     ============================================================ */
  const DOLPHIN_SPEC = {
    id: "dolphin", plan: "vertical", profileName: "dolphin",
    L: 4.4, xNose: 1.98, axisY: 0.82, noseRound: 0.010, tubeEnd: 0.90, headEnd: 0.18,
    profile: {
      top: [[0, 0], [0.012, 0.007], [0.04, 0.011], [0.060, 0.014], [0.070, 0.028], [0.085, 0.050], [0.11, 0.068], [0.15, 0.082], [0.22, 0.094], [0.30, 0.100], [0.40, 0.099], [0.50, 0.090], [0.60, 0.074], [0.70, 0.053], [0.78, 0.036], [0.85, 0.024], [0.90, 0.017]],
      bot: [[0, 0], [0.012, 0.007], [0.04, 0.012], [0.060, 0.016], [0.070, 0.022], [0.085, 0.034], [0.11, 0.050], [0.15, 0.064], [0.22, 0.078], [0.30, 0.087], [0.40, 0.087], [0.50, 0.079], [0.60, 0.063], [0.70, 0.044], [0.78, 0.030], [0.85, 0.020], [0.90, 0.014]],
      half: [[0, 0], [0.012, 0.008], [0.04, 0.013], [0.060, 0.017], [0.070, 0.024], [0.085, 0.040], [0.11, 0.054], [0.15, 0.066], [0.22, 0.076], [0.30, 0.080], [0.40, 0.079], [0.50, 0.070], [0.60, 0.054], [0.70, 0.036], [0.78, 0.024], [0.85, 0.016], [0.90, 0.011]],
      yo: [[0, -0.028], [0.05, -0.024], [0.068, -0.018], [0.085, -0.008], [0.12, -0.002], [0.18, 0], [0.9, 0]],
      nT: [[0, 2.0], [0.75, 2.0], [0.86, 1.55], [0.90, 1.45]],
      nB: [[0, 2.0], [0.75, 2.0], [0.86, 1.6], [0.90, 1.5]],
    },
    mouth: {
      front: 0.003, corner: 0.078, alphaF: 1.05, alphaC: 1.52, shape: 0.85, snoutBlend: 0.004,
      palate: 0.45, floor: 0.4, throat: 0.5, pharynx: 0.04, lipDrop: 0.0004, chinInset: 0.0008,
      teeth: {
        upper: [{ n: 40, h: 0.0028, w: 0.0021, inset: 0.0036, sink: 0.0012, rake: 0.05, rakeCorner: 0.2, tilt: 0.08, thick: 0.8, cornerK: 0.7, span: 0.68 }],
        lower: [{ n: 40, h: 0.0028, w: 0.0021, inset: 0.0036, sink: 0.0012, rake: 0.05, rakeCorner: 0.2, tilt: 0.08, thick: 0.8, cornerK: 0.7, span: 0.68 }],
      },
    },
    eye: { s: 0.095, up: 0.05, r: 0.0034, out: 0.36, socket: 0.2, fwd: 0.06 },
    bones: { head: 0.10, neck: 0.18, root: 0.42, tail: [0.55, 0.67, 0.77, 0.86, 0.95] },
    fins: [
      { name: "dorsal1", role: "median", at: 0.420, root: 0.130, span: 0.090, dir: [0, 1, 0], phi: Math.PI, sweep: 0.75, bow: 0.08, tipC: 0.05, conc: 0.38, rear: 0.24, rearH: 0.07, round: 0.10, tc: 0.13, tcTip: 0.05, embed: 0.4 },
      { name: "pecR", role: "paired", boneName: "pecR", at: 0.195, root: 0.060, span: 0.145, dir: [-0.38, -0.42, 0.82], phi: 0.80, sweep: 0.55, bow: 0.06, tipC: 0.20, conc: 0.10, rear: 0.10, rearH: 0.15, round: 0.22, tc: 0.14, tcTip: 0.07, embed: 0.3 },
      { name: "pecL", role: "paired", boneName: "pecL", at: 0.195, root: 0.060, span: 0.145, dir: [-0.38, -0.42, -0.82], phi: 2 * Math.PI - 0.80, sweep: 0.55, bow: 0.06, tipC: 0.20, conc: 0.10, rear: 0.10, rearH: 0.15, round: 0.22, tc: 0.14, tcTip: 0.07, embed: 0.3 },
      { name: "flukeR", role: "paired", originS: 0.90, originDz: 0.008, root: 0.110, span: 0.118, dir: [0, 0, 1], chordDir: [1, 0, 0], sweep: 0.62, bow: 0.06, tipC: 0.05, conc: 0.26, rear: 0.10, rearH: 0.12, round: 0.06, tc: 0.12, tcTip: 0.05, embed: 0.3 },
      { name: "flukeL", role: "paired", originS: 0.90, originDz: -0.008, root: 0.110, span: 0.118, dir: [0, 0, -1], chordDir: [1, 0, 0], sweep: 0.62, bow: 0.06, tipC: 0.05, conc: 0.26, rear: 0.10, rearH: 0.12, round: 0.06, tc: 0.12, tcTip: 0.05, embed: 0.3 },
    ],
    jaw: { lift: 0, drop: 0.50, protrude: [0, 0], gap: 0.02 },
    wave: { lambda: 1.1, amp: 0.095, env: [0.02, 0.0, 1.0], f0: 0.8, fK: 1.1, fMax: 3.2 },
    finColor: 0x2c343a, saddleS: 0.36,
    lod: [
      { M: 28, ds: 0.022, headK: 0.6, noseRings: 5, eyeRings: true, gills: false, teeth: true, finSpan: 7, finChord: 6, eyeSeg: 10, eyeRing: 7, pharynx: 3 },
      { M: 12, ds: 0.065, headK: 0.6, noseRings: 3, eyeRings: false, gills: false, teeth: false, finSpan: 4, finChord: 3, eyeSeg: 6, eyeRing: 4, pharynx: 2 },
    ],
  };
  DOLPHIN_SPEC.makePaint = function (EY) {
    const roles = {};
    DOLPHIN_SPEC.fins.forEach(function (f, i) { roles[i + 1] = f.role; });
    const cape = MB.curve([[0, 0.70], [0.08, 0.55], [0.15, 0.40], [0.30, 0.30], [0.40, 0.22], [0.50, 0.45], [0.65, 0.40], [0.80, 0.20], [0.90, 0.0]]);
    const capeC = MB.hexc(0x232a30);
    return paintKit({
      L: DOLPHIN_SPEC.L, eyes: EY, finRole: roles,
      back: 0x4c565e, belly: 0xdde2e2, fin: 0x2c343a,
      line: [[0, -0.55], [0.04, -0.45], [0.078, -0.20], [0.12, -0.35], [0.20, -0.36], [0.30, -0.30], [0.40, -0.26], [0.55, -0.30], [0.70, -0.40], [0.85, -0.55], [0.90, -0.60]],
      rag: 0.03, specBack: 0.5, specBelly: 0.38, specFin: 0.5, iris: 0x1b140c, sclera: 0x3a342c, orbit: 0x2a3136,
      // the cape: a soft darker saddle over the back, dipping in front of the dorsal
      skin: function (c, col, up) {
        if (!up) return col;
        const h = -c.m[1], k = MB.sm((h - cape(c.m[0]) + 0.10) / 0.20);
        return MB.mixc(col, capeC, k * 0.85);
      },
    });
  };
  S({
    id: "dolphin", name: "Dolphin", biome: "water", rarity: "common",
    // coastal bottlenose pods are 2-15
    hp: 40, fur: "Dolphin Hide", furValue: 70, packs: 3, herd: [4, 12],
    // 4.4 model units x 0.66 = a 2.9 m adult (2-4 m)
    spd: 3.0, danger: 0, aquatic: true, scale: 0.66, color: 0x4c565e, swimDepth: 1.4,
    build: function () { return marineBuild(DOLPHIN_SPEC); },
  });

  /* ============================================================
     HUMPBACK WHALE — Megaptera novaeangliae. A robust body deepest (~22%
     TL) at 35-40% of its length behind a flat, broad rostrum studded with
     tubercles; the lower jaw runs to the tip and carries its own knobs; the
     mouth line arches back to below the eye at a quarter of the body, with a
     fringe of baleen inside; the white throat carries ventral pleats from the
     chin to the navel; two blowholes on top; a small dorsal on a hump at 62%;
     the flippers are a third of the body long, white, knuckled along the
     leading edge; the flukes are broad with a scalloped trailing edge on a
     keeled tail stock. 8.75 model units at scale 1.6 is a 14 m adult.
     ============================================================ */
  const HUMPBACK_SPEC = {
    id: "humpback_whale", plan: "vertical", profileName: "humpback",
    L: 8.75, xNose: 3.50, axisY: 0.95, noseRound: 0.020, tubeEnd: 0.92, headEnd: 0.30,
    profile: {
      top: [[0, 0], [0.02, 0.012], [0.06, 0.022], [0.12, 0.036], [0.18, 0.052], [0.24, 0.072], [0.30, 0.090], [0.38, 0.100], [0.46, 0.100], [0.55, 0.092], [0.64, 0.080], [0.72, 0.062], [0.80, 0.044], [0.86, 0.032], [0.92, 0.020]],
      bot: [[0, 0], [0.02, 0.018], [0.06, 0.040], [0.12, 0.060], [0.18, 0.080], [0.24, 0.096], [0.30, 0.108], [0.38, 0.112], [0.46, 0.106], [0.55, 0.090], [0.64, 0.070], [0.72, 0.050], [0.80, 0.034], [0.86, 0.024], [0.92, 0.014]],
      half: [[0, 0], [0.02, 0.030], [0.06, 0.048], [0.12, 0.062], [0.18, 0.074], [0.24, 0.086], [0.30, 0.096], [0.38, 0.100], [0.46, 0.096], [0.55, 0.084], [0.64, 0.066], [0.72, 0.046], [0.80, 0.030], [0.86, 0.020], [0.92, 0.012]],
      nT: [[0, 3.0], [0.18, 2.4], [0.34, 2.0], [0.74, 2.0], [0.86, 1.55], [0.92, 1.45]],
      nB: [[0, 2.2], [0.30, 2.0], [0.74, 2.0], [0.86, 1.6], [0.92, 1.5]],
    },
    mouth: {
      front: 0.006, corner: 0.26, alphaF: 1.0, alphaC: 1.38, shape: 0.75, snoutBlend: 0.006,
      palate: 0.45, floor: 0.55, throat: 0.7, pharynx: 0.05, lipDrop: 0.0005, chinInset: 0.0010,
      baleen: { n: 70, h: 0.030, w: 0.0035, inset: 0.004 },
    },
    eye: { s: 0.272, up: 0.12, r: 0.0024, out: 0.35, socket: 0.15, fwd: 0.05 },
    bones: { head: 0.20, neck: 0.30, root: 0.45, tail: [0.60, 0.72, 0.82, 0.90, 0.97] },
    fins: [
      { name: "dorsal1", role: "median", at: 0.620, root: 0.075, span: 0.032, dir: [0, 1, 0], phi: Math.PI, sweep: 0.95, bow: 0.25, tipC: 0.20, conc: 0.10, rear: 0.20, rearH: 0.2, round: 0.35, tc: 0.20, embed: 0.5 },
      { name: "pecR", role: "white", boneName: "pecR", at: 0.270, root: 0.075, span: 0.300, dir: [-0.30, -0.50, 0.81], phi: 0.85, sweep: 0.12, bow: 0.05, tipC: 0.28, conc: 0.06, rear: 0.06, rearH: 0.12, round: 0.30, tc: 0.17, tcTip: 0.10, embed: 0.3, knobs: { n: 9, r: 0.0055, from: 0.08, to: 0.92 } },
      { name: "pecL", role: "white", boneName: "pecL", at: 0.270, root: 0.075, span: 0.300, dir: [-0.30, -0.50, -0.81], phi: 2 * Math.PI - 0.85, sweep: 0.12, bow: 0.05, tipC: 0.28, conc: 0.06, rear: 0.06, rearH: 0.12, round: 0.30, tc: 0.17, tcTip: 0.10, embed: 0.3, knobs: { n: 9, r: 0.0055, from: 0.08, to: 0.92 } },
      { name: "flukeR", role: "paired", originS: 0.92, originDz: 0.008, root: 0.100, span: 0.145, dir: [0, 0, 1], chordDir: [1, 0, 0], sweep: 0.45, bow: 0.05, tipC: 0.06, conc: 0.12, rear: 0.08, rearH: 0.10, round: 0.05, tc: 0.12, tcTip: 0.05, embed: 0.3, scallop: { n: 7, d: 0.06 } },
      { name: "flukeL", role: "paired", originS: 0.92, originDz: -0.008, root: 0.100, span: 0.145, dir: [0, 0, -1], chordDir: [1, 0, 0], sweep: 0.45, bow: 0.05, tipC: 0.06, conc: 0.12, rear: 0.08, rearH: 0.10, round: 0.05, tc: 0.12, tcTip: 0.05, embed: 0.3, scallop: { n: 7, d: 0.06 } },
    ],
    jaw: { lift: 0, drop: 0.45, protrude: [0, 0], gap: 0.05 },
    wave: { lambda: 1.2, amp: 0.075, env: [0.01, 0.0, 1.0], f0: 0.12, fK: 0.5, fMax: 0.6 },
    finColor: 0x161b1f,
    // tubercles on the rostrum and the lower jaw, barnacles on the chin
    extras: function (S, k) {
      if (!k.lv.teeth) return;
      const sp = k.spec, L = sp.L;
      const knob = function (s, phi, r, h, flag, jaw) {
        const R = k.sectionAt(s), P = k.ringPoint(R, phi), N = k.ringNormal(R, phi);
        const w = jaw ? [k.B.jaw, 1] : k.chainWeights(k.chain, P[0]);
        k.dome(S, P, N, r * L, h * L, w, k.TAG.SKIN, [s, Math.cos(phi), Math.sin(phi), flag]);
      };
      for (let row = -1; row <= 1; row++) {
        for (let q = 0; q < 8; q++) {
          const s = 0.022 + q * 0.024 + (CBZ.hash01 ? CBZ.hash01(q, row, 0x7B) - 0.5 : 0) * 0.006;
          knob(s, Math.PI + row * 0.42, 0.0042, 0.0035, -5, false);
        }
      }
      [1, -1].forEach(function (sd) {
        for (let q = 0; q < 7; q++) {
          const s = 0.03 + q * 0.03;
          knob(s, sd * 0.62, 0.0036, 0.0030, -5, true);
        }
        for (let q = 0; q < 5; q++) {
          const s = 0.012 + (CBZ.hash01 ? CBZ.hash01(q, sd, 0x7C) : 0.5) * 0.05;
          knob(s, sd * (0.15 + 0.3 * (CBZ.hash01 ? CBZ.hash01(q, sd, 0x7D) : 0.5)), 0.0028, 0.0024, -6, true);
        }
      });
    },
    lod: [
      { M: 32, ds: 0.020, headK: 0.6, noseRings: 5, eyeRings: true, gills: false, teeth: true, finSpan: 9, finChord: 7, eyeSeg: 10, eyeRing: 7, pharynx: 3 },
      { M: 14, ds: 0.060, headK: 0.6, noseRings: 3, eyeRings: false, gills: false, teeth: false, finSpan: 4, finChord: 3, eyeSeg: 6, eyeRing: 4, pharynx: 2 },
    ],
  };
  HUMPBACK_SPEC.makePaint = function (EY) {
    const roles = {};
    HUMPBACK_SPEC.fins.forEach(function (f, i) { roles[i + 1] = f.role; });
    const white = MB.hexc(0xd9dddd), knobC = MB.hexc(0x2a3136), barn = MB.hexc(0xcfc9b8);
    return paintKit({
      L: HUMPBACK_SPEC.L, eyes: EY, finRole: roles,
      back: 0x161b1f, belly: 0xd9dddd, fin: 0x161b1f,
      line: [[0, -0.30], [0.10, -0.22], [0.26, -0.12], [0.30, -0.40], [0.40, -0.46], [0.55, -0.55], [0.70, -0.60], [0.85, -0.70], [0.92, -0.75]],
      rag: 0.08, specBack: 0.42, specBelly: 0.3, specFin: 0.35, iris: 0x1b140c, sclera: 0x2a241c, orbit: 0x161b1f,
      // the ventral pleats: thin dark grooves chin to navel
      mark: function (c) {
        if (c.tag !== MB.TAG.SKIN && c.tag !== MB.TAG.CHIN) return NaN;
        const s = c.m[0];
        if (s < 0.015 || s > 0.48 || c.m[1] < 0.15) return -1;
        const phi = Math.atan2(c.m[2], c.m[1]);
        return (Math.cos(phi * 24) - 0.86) * MB.sm((0.48 - s) / 0.05) * MB.sm((s - 0.015) / 0.02);
      },
      skin: function (c, col) {
        if (c.m[3] === -5) return MB.mixc(col, knobC, 0.35);
        if (c.m[3] === -6) return barn;
        if (c.f(1) >= 0) return MB.mulc(col, 0.55);
        return col;
      },
      finHook: function (c, col, role) {
        if (role === "white") return MB.mulc(white, 0.96 + 0.06 * (1 - c.m[0]));
        return col;
      },
    });
  };
  S({
    id: "humpback_whale", name: "Humpback Whale", biome: "water",
    rarity: "rare", hp: 900, fur: "Whale Blubber", furValue: 600,
    meat: "Whale Meat", meatValue: 50, packs: 2, herd: [1, 2], spd: 1.6, danger: 0.1,
    // 8.75 model units x 1.6 = a 14 m adult
    aquatic: true, scale: 1.6, color: 0x161b1f, swimDepth: 2.8,
    build: function () { return marineBuild(HUMPBACK_SPEC); },
  });

  /* ---- GIANT MANTA RAY — Mobula birostris. A disc about twice as wide as
     it is long: the body is a thick flat central lens with the wide terminal
     mouth at its front between the two cephalic lobes; the wings are the
     pectoral fins, thin hydrofoils with convex leading edges swept back to
     pointed tips and concave trailing edges; five gill slits each side on
     the underside; a small dorsal fin at the base of a whip tail about as
     long as the body. Black above with the white shoulder chevrons, white
     below with dark spots and a dark trailing margin. The wings fly: a wave
     runs out along each from root to tip (city/wildlife_rig.js). 4.4 model
     units long at scale 1.1 is a 5.1 m disc width. */
  const MANTA_SPEC = {
    id: "manta_ray", plan: "flap", profileName: "manta",
    L: 4.4, xNose: 1.10, axisY: 0.58, noseRound: 0.006, tubeEnd: 0.995, headEnd: 0.20,
    profile: {
      half: [[0, 0], [0.004, 0.060], [0.02, 0.085], [0.06, 0.095], [0.12, 0.105], [0.20, 0.110], [0.28, 0.105], [0.36, 0.085], [0.44, 0.055], [0.50, 0.030], [0.54, 0.014], [0.60, 0.008], [0.80, 0.005], [1.0, 0.002]],
      top: [[0, 0], [0.004, 0.022], [0.02, 0.030], [0.06, 0.042], [0.12, 0.054], [0.20, 0.058], [0.28, 0.055], [0.36, 0.045], [0.44, 0.032], [0.50, 0.020], [0.54, 0.011], [0.60, 0.007], [0.80, 0.004], [1.0, 0.0015]],
      bot: [[0, 0], [0.004, 0.018], [0.02, 0.024], [0.06, 0.032], [0.12, 0.040], [0.20, 0.044], [0.28, 0.042], [0.36, 0.034], [0.44, 0.024], [0.50, 0.016], [0.54, 0.009], [0.60, 0.006], [0.80, 0.004], [1.0, 0.0015]],
      nS: [[0, 2.8], [0.10, 2.2], [0.5, 2.0]],
    },
    mouth: {
      front: 0.003, corner: 0.05, alphaF: 1.30, alphaC: 1.50, shape: 0.8, snoutBlend: 0.003,
      palate: 0.4, floor: 0.4, throat: 0.4, pharynx: 0.04, lipDrop: 0.0005, chinInset: 0.0008,
    },
    eye: { s: 0.045, up: 0.10, r: 0.0060, out: 0.45, socket: 0.25, fwd: 0.05 },
    gills: { n: 5, s0: 0.105, s1: 0.185, lo0: -1.40, hi0: -0.95, lo1: -1.40, hi1: -0.98, depth: 0.0040, flap: 0.0010, gap: 0.0040, slant: 0 },
    bones: { head: 0.04, neck: 0.10, root: 0.24, tail: [0.45, 0.60, 0.75, 0.90] },
    extraBones: function (add, k) {
      add("wR1", "root", k.finPoint("wingR", 0.04)); add("wR2", "wR1", k.finPoint("wingR", 0.40)); add("wR3", "wR2", k.finPoint("wingR", 0.74));
      add("wL1", "root", k.finPoint("wingL", 0.04)); add("wL2", "wL1", k.finPoint("wingL", 0.40)); add("wL3", "wL2", k.finPoint("wingL", 0.74));
    },
    fins: [
      { name: "wingR", role: "paired", boneNames: ["wR1", "wR2", "wR3"], boneAt: [0.06, 0.42, 0.76], at: 0.06, root: 0.36, span: 0.42, dir: [0, -0.04, 1], chordDir: [1, 0, 0], phi: Math.PI / 2, sweep: 0.40, bow: 0.06, tipC: 0.04, conc: 0.30, rear: 0, rearH: 0, round: 0.04, tc: 0.11, tcTip: 0.06, embed: 0.3 },
      { name: "wingL", role: "paired", boneNames: ["wL1", "wL2", "wL3"], boneAt: [0.06, 0.42, 0.76], at: 0.06, root: 0.36, span: 0.42, dir: [0, -0.04, -1], chordDir: [1, 0, 0], phi: 1.5 * Math.PI, sweep: 0.40, bow: 0.06, tipC: 0.04, conc: 0.30, rear: 0, rearH: 0, round: 0.04, tc: 0.11, tcTip: 0.06, embed: 0.3 },
      // the cephalic lobes, unrolled: paddles out of the front corners of the head
      { name: "lobeR", role: "median", originS: 0.006, originDy: -0.004, originDz: 0.072, root: 0.040, span: 0.070, dir: [1, -0.25, 0.10], chordDir: [0, 1, 0], sweep: 0.0, tipC: 0.7, conc: 0, rear: 0, rearH: 0, round: 0.5, tc: 0.25, tcTip: 0.2, embed: 0.3 },
      { name: "lobeL", role: "median", originS: 0.006, originDy: -0.004, originDz: -0.072, root: 0.040, span: 0.070, dir: [1, -0.25, -0.10], chordDir: [0, 1, 0], sweep: 0.0, tipC: 0.7, conc: 0, rear: 0, rearH: 0, round: 0.5, tc: 0.25, tcTip: 0.2, embed: 0.3 },
      { name: "dorsal1", role: "median", at: 0.48, root: 0.040, span: 0.025, dir: [0, 1, 0], phi: Math.PI, sweep: 0.6, tipC: 0.15, conc: 0.1, rear: 0.2, rearH: 0.2, round: 0.3, tc: 0.12, embed: 0.4 },
    ],
    jaw: { lift: 0, drop: 0.35, protrude: [0, 0], gap: 0.02 },
    wave: { lambda: 0.8, amp: 0.05, env: [0.0, 0.0, 1.0], f0: 0.3, fK: 0.5, fMax: 1.0 },
    finColor: 0x0d1012,
    lod: [
      { M: 24, ds: 0.022, headK: 0.7, noseRings: 3, eyeRings: true, gills: true, teeth: true, finSpan: 10, finChord: 8, eyeSeg: 10, eyeRing: 7, pharynx: 3 },
      { M: 10, ds: 0.070, headK: 0.7, noseRings: 2, eyeRings: false, gills: false, teeth: false, finSpan: 5, finChord: 4, eyeSeg: 6, eyeRing: 4, pharynx: 2 },
    ],
  };
  MANTA_SPEC.makePaint = function (EY) {
    const roles = {};
    MANTA_SPEC.fins.forEach(function (f, i) { roles[i + 1] = f.role; });
    const white = MB.hexc(0xd6dad8), spot = MB.hexc(0x2a2f33), edge = MB.hexc(0x3c4246);
    return paintKit({
      L: MANTA_SPEC.L, eyes: EY, finRole: roles,
      back: 0x0d1012, belly: 0xe6e9e8, fin: 0x0d1012, gum: 0x6f7270, gumDeep: 0x3a3c3b, throat: 0x101112,
      line: [[0, -0.05], [1, -0.05]], rag: 0.02, specBack: 0.3, specBelly: 0.22, specFin: 0.3,
      iris: 0x1b1a14, sclera: 0x2c2a24, orbit: 0x0d1012,
      // the white shoulder chevrons on the wings' upper faces
      mark: function (c) {
        if (c.tag !== MB.TAG.FIN || (c.m[3] !== 1 && c.m[3] !== 2)) return NaN;
        const h = c.m[0], x = c.m[1];
        const d = ((h - 0.30) / 0.20) * ((h - 0.30) / 0.20) + ((x - 0.34 + 0.25 * (h - 0.3)) / 0.22) * ((x - 0.34 + 0.25 * (h - 0.3)) / 0.22);
        return 1 - d;
      },
      finHook: function (c, col, role) {
        if (role !== "paired") return col;
        if (c.f(0) >= 0) return c.f(1) >= 0 ? white : col;
        // the underside: dark trailing margin and a few dark spots
        if (c.m[1] > 0.86) return MB.mixc(col, edge, 0.75);
        const n = MB.vn(c.p[0] * 3.1, c.p[2] * 3.1, 0.5, 41);
        return n > 0.78 ? MB.mixc(col, spot, MB.sm((n - 0.78) / 0.05)) : col;
      },
    });
  };
  S({
    id: "manta_ray", name: "Giant Manta Ray", biome: "water",
    rarity: "uncommon", hp: 90, fur: "Manta Hide", furValue: 210,
    meat: "Fish Fillet", meatValue: 18, herd: [1, 3], spd: 1.1, danger: 0,
    aquatic: true, scale: 1.1, color: 0x0d1012, clearance: 70, swimDepth: 2.2,
    swimStyle: "flap",
    build: function () { return marineBuild(MANTA_SPEC); },
  });

  /* ---- GREEN SEA TURTLE — Chelonia mydas. A low teardrop carapace about
     four-fifths as wide as it is long and a third as high, its margin a
     sharp edge; a flat cream plastron; a small blunt head with a horny beak
     (serrated lower jaw), one pair of prefrontal scales and big eyes, on a
     short neck that tucks under the shell's front; long paddle fore
     flippers (~0.4 of the length) with one claw, short rear paddles, a
     stub tail. The carapace is plates: five vertebrals down the crown, four
     costals each side, the ring of marginals, every seam cut as a dark line,
     each plate olive-brown with radiating streaks. It flies with its fore
     flippers (down and back square, up and forward feathered) and steers
     with the rear ones (city/wildlife_rig.js). 1.85 model units at scale 0.7
     is a 1.3 m adult, carapace ~0.85 m. */
  const TURTLE_SPEC = {
    id: "sea_turtle", plan: "flipper", profileName: "turtle",
    L: 1.85, xNose: 0.95, axisY: 0.50, noseRound: 0.02, tubeEnd: 0.995, headEnd: 0.22,
    profile: {
      half: [[0, 0], [0.01, 0.030], [0.04, 0.050], [0.08, 0.058], [0.12, 0.055], [0.17, 0.050], [0.21, 0.10], [0.26, 0.22], [0.34, 0.27], [0.45, 0.29], [0.56, 0.28], [0.66, 0.25], [0.75, 0.19], [0.82, 0.12], [0.86, 0.06], [0.90, 0.030], [0.96, 0.015], [1.0, 0.005]],
      top: [[0, 0], [0.01, 0.028], [0.04, 0.045], [0.08, 0.052], [0.12, 0.050], [0.17, 0.042], [0.21, 0.07], [0.26, 0.11], [0.34, 0.135], [0.45, 0.145], [0.56, 0.140], [0.66, 0.125], [0.75, 0.095], [0.82, 0.060], [0.86, 0.035], [0.90, 0.020], [0.96, 0.010], [1.0, 0.004]],
      bot: [[0, 0], [0.01, 0.022], [0.04, 0.035], [0.08, 0.042], [0.12, 0.040], [0.17, 0.036], [0.21, 0.045], [0.26, 0.060], [0.34, 0.068], [0.45, 0.070], [0.56, 0.068], [0.66, 0.062], [0.75, 0.050], [0.82, 0.035], [0.86, 0.022], [0.90, 0.015], [0.96, 0.008], [1.0, 0.003]],
      yo: [[0, -0.02], [0.12, -0.02], [0.21, -0.005], [0.30, 0], [0.86, 0], [1.0, -0.01]],
      nS: [[0, 2.0], [0.18, 2.0], [0.24, 1.35], [0.80, 1.35], [0.88, 2.0]],
      nT: [[0, 2.0], [0.2, 2.0], [0.3, 2.2], [0.8, 2.2], [0.9, 2.0]],
      nB: [[0, 2.0], [0.2, 2.6], [0.8, 2.6], [0.9, 2.0]],
    },
    mouth: {
      front: 0.004, corner: 0.055, alphaF: 1.0, alphaC: 1.30, shape: 0.8, snoutBlend: 0.004,
      palate: 0.4, floor: 0.4, throat: 0.5, pharynx: 0.03, lipDrop: 0.0010, chinInset: 0.0020,
    },
    eye: { s: 0.045, up: 0.25, r: 0.0100, out: 0.42, socket: 0.25, fwd: 0.12 },
    bones: { head: 0.07, neck: 0.17, root: 0.50, tail: [0.88, 0.95] },
    extraBones: function (add, k) {
      add("fR1", "root", k.finPoint("flipR", 0.04)); add("fR2", "fR1", k.finPoint("flipR", 0.50));
      add("fL1", "root", k.finPoint("flipL", 0.04)); add("fL2", "fL1", k.finPoint("flipL", 0.50));
      add("hR", "root", k.finPoint("hindR", 0.05)); add("hL", "root", k.finPoint("hindL", 0.05));
    },
    fins: [
      { name: "flipR", role: "paired", boneNames: ["fR1", "fR2"], boneAt: [0.06, 0.52], at: 0.25, root: 0.080, span: 0.42, dir: [-0.20, -0.10, 0.97], chordDir: [1, 0, 0], phi: 0.95, sweep: 0.35, bow: 0.08, tipC: 0.30, conc: 0.04, rear: 0.05, rearH: 0.1, round: 0.45, tc: 0.14, tcTip: 0.10, embed: 0.25 },
      { name: "flipL", role: "paired", boneNames: ["fL1", "fL2"], boneAt: [0.06, 0.52], at: 0.25, root: 0.080, span: 0.42, dir: [-0.20, -0.10, -0.97], chordDir: [1, 0, 0], phi: 2 * Math.PI - 0.95, sweep: 0.35, bow: 0.08, tipC: 0.30, conc: 0.04, rear: 0.05, rearH: 0.1, round: 0.45, tc: 0.14, tcTip: 0.10, embed: 0.25 },
      { name: "hindR", role: "paired", boneNames: ["hR"], boneAt: [0.08], at: 0.74, root: 0.070, span: 0.17, dir: [-0.75, -0.10, 0.65], chordDir: [0.6, 0, 0.8], phi: 0.95, sweep: 0.2, tipC: 0.6, conc: 0.04, rear: 0, rearH: 0, round: 0.5, tc: 0.14, tcTip: 0.10, embed: 0.3 },
      { name: "hindL", role: "paired", boneNames: ["hL"], boneAt: [0.08], at: 0.74, root: 0.070, span: 0.17, dir: [-0.75, -0.10, -0.65], chordDir: [0.6, 0, -0.8], phi: 2 * Math.PI - 0.95, sweep: 0.2, tipC: 0.6, conc: 0.04, rear: 0, rearH: 0, round: 0.5, tc: 0.14, tcTip: 0.10, embed: 0.3 },
    ],
    jaw: { lift: 0, drop: 0.35, protrude: [0, 0], gap: 0.02 },
    wave: { lambda: 1.0, amp: 0.02, env: [0.0, 0.0, 1.0], f0: 0.3, fK: 0.5, fMax: 1.0 },
    finColor: 0x3a3822,
    lod: [
      { M: 32, ds: 0.022, headK: 0.6, noseRings: 4, eyeRings: true, gills: false, teeth: true, finSpan: 8, finChord: 6, eyeSeg: 10, eyeRing: 7, pharynx: 2 },
      { M: 14, ds: 0.065, headK: 0.6, noseRings: 2, eyeRings: false, gills: false, teeth: false, finSpan: 4, finChord: 3, eyeSeg: 6, eyeRing: 4, pharynx: 2 },
    ],
  };
  TURTLE_SPEC.makePaint = function (EY) {
    const roles = {};
    TURTLE_SPEC.fins.forEach(function (f, i) { roles[i + 1] = f.role; });
    const L = TURTLE_SPEC.L, PF = MB.makeProfile(TURTLE_SPEC);
    const shellA = MB.hexc(0x4a4426), shellB = MB.hexc(0x5e4a22), streak = MB.hexc(0x2e2a16), seam = MB.hexc(0x1c1a0e);
    const skinC = MB.hexc(0x3a3822), scaleEdge = MB.hexc(0xb8ad84), beak = MB.hexc(0x24201a);
    const VS = [0.21, 0.335, 0.455, 0.575, 0.695, 0.86], CS = [0.25, 0.42, 0.56, 0.70, 0.82];
    function onShell(m) { return m[0] > 0.205 && m[0] < 0.865; }
    // distance (in L) from the nearest scute seam, on the carapace only
    function seamDist(c) {
      const m = c.m, s = m[0];
      const th = Math.abs(Math.PI - Math.acos(Math.max(-1, Math.min(1, m[1]))));   // 0 at the crown
      const R = MB.sectionAt(TURTLE_SPEC, PF, s);
      const arc = R.half / L;                             // radians of ring -> L, roughly
      let d = 9;
      if (th < 0.38) for (let k = 1; k < VS.length - 1; k++) d = Math.min(d, Math.abs(s - VS[k]));
      else if (th < 1.22) for (let k = 1; k < CS.length - 1; k++) d = Math.min(d, Math.abs(s - CS[k]));
      else { const ms = (s - 0.21) / 0.0595; d = Math.min(d, Math.abs(ms - Math.round(ms)) * 0.0595); }
      d = Math.min(d, Math.abs(th - 0.38) * arc, Math.abs(th - 1.22) * arc);
      return d;
    }
    return paintKit({
      L: L, eyes: EY, finRole: roles,
      back: 0x4a4426, belly: 0xcdbd8c, fin: 0x3a3822, gum: 0x8a6a58, gumDeep: 0x4a3328, throat: 0x14100c,
      line: [[0, -0.30], [0.12, -0.30], [0.19, -0.25], [0.23, -0.10], [0.85, -0.10], [0.90, -0.30], [1, -0.3]],
      rag: 0.01, specBack: 0.35, specBelly: 0.2, specFin: 0.22, iris: 0x2b2210, sclera: 0x3a3424, orbit: 0x2a2616,
      mark: function (c) {
        if (c.tag !== MB.TAG.SKIN || !onShell(c.m) || c.m[1] > 0.05) return NaN;
        return 0.0055 - seamDist(c);
      },
      skin: function (c, col, up) {
        const m = c.m;
        if (m[3] === -2 || m[3] === -3) return beak;       // the horny beak at the lips
        if (up && onShell(m) && m[1] <= 0.05) {
          if (c.f(1) >= 0) return seam;
          // each plate its own tone, streaked out from its growth centre
          const th = Math.abs(Math.PI - Math.acos(Math.max(-1, Math.min(1, m[1]))));
          const cell = th < 0.38 ? Math.floor((m[0] - 0.21) / 0.12) : (th < 1.22 ? 10 + Math.floor((m[0] - 0.25) / 0.14) : 20 + Math.floor((m[0] - 0.21) / 0.0595));
          let base = MB.mixc(shellA, shellB, MB.vn(cell * 1.7, 0.3, th < 0.38 ? 0 : 1, 51));
          const ang = Math.atan2(m[2], m[1]) * 3 + m[0] * 40;
          const st = Math.pow(0.5 + 0.5 * Math.sin(ang * 2.3 + MB.vn(m[0] * 30, ang, 0, 52) * 6), 3);
          return MB.mixc(base, streak, st * 0.45);
        }
        if (m[0] < 0.22 || m[0] > 0.86) {
          // the head, neck and tail: scales with pale edges
          const w = MB.worley(c.p[0] * 28 / L, c.p[1] * 28 / L, c.p[2] * 28 / L, 61);
          const e = MB.sm(1 - (w[1] - w[0]) / 0.12);
          return MB.mixc(up ? skinC : MB.mulc(skinC, 1.4), scaleEdge, e * 0.55);
        }
        return col;
      },
      finHook: function (c, col) {
        const w = MB.worley(c.p[0] * 22 / L, c.p[1] * 22 / L, c.p[2] * 22 / L, 62);
        const e = MB.sm(1 - (w[1] - w[0]) / 0.14);
        const base = c.f(0) >= 0 ? skinC : MB.mulc(skinC, 1.5);
        return MB.mixc(base, scaleEdge, e * 0.6);
      },
    });
  };
  S({
    id: "sea_turtle", name: "Green Sea Turtle", biome: "water",
    rarity: "common", hp: 45, fur: "Turtle Shell", furValue: 65,
    meat: "Fish Fillet", meatValue: 12, herd: [1, 3], spd: 0.8, danger: 0,
    aquatic: true, scale: 0.7, color: 0x4a4426,
    clearance: 20, swimDepth: 1.1,
    swimStyle: "flipper",
    build: function () { return marineBuild(TURTLE_SPEC); },
  });

  /* ---- HARBOUR SEAL — Phoca vitulina. Not a registered species (the city
     sea does not spawn seals, and a defineSpecies() here would shift every
     seeded spawn after it); the Ocean game (games/ocean.js) builds its seals
     here. 1.75 m nose to hind-flipper tips: a fat spindle, widest (~25% of
     the length) behind the shoulders; a round earless head with a short
     dog-like muzzle, a small mouth with conical teeth and big dark eyes;
     short clawed fore flippers held low against the chest; the two hind
     flippers are fans held sole to sole and swept side to side, the stroke
     the lateral swimmer already makes. Blue-grey over a pale belly, dark
     irregular spots all over. */
  const SEAL_SPEC = {
    id: "harbor_seal", plan: "lateral", profileName: "seal",
    L: 1.75, xNose: 0.90, axisY: 0.0, noseRound: 0.02, tubeEnd: 0.83, headEnd: 0.22,
    profile: {
      top: [[0, 0], [0.02, 0.022], [0.05, 0.040], [0.09, 0.060], [0.13, 0.068], [0.17, 0.070], [0.21, 0.075], [0.27, 0.090], [0.35, 0.110], [0.45, 0.118], [0.55, 0.112], [0.65, 0.090], [0.73, 0.060], [0.79, 0.035], [0.83, 0.022]],
      bot: [[0, 0], [0.02, 0.020], [0.05, 0.038], [0.09, 0.056], [0.13, 0.064], [0.17, 0.068], [0.21, 0.074], [0.27, 0.092], [0.35, 0.114], [0.45, 0.122], [0.55, 0.114], [0.65, 0.090], [0.73, 0.058], [0.79, 0.034], [0.83, 0.020]],
      half: [[0, 0], [0.02, 0.022], [0.05, 0.040], [0.09, 0.062], [0.13, 0.070], [0.17, 0.068], [0.21, 0.072], [0.27, 0.095], [0.35, 0.118], [0.45, 0.125], [0.55, 0.118], [0.65, 0.094], [0.73, 0.062], [0.79, 0.036], [0.83, 0.022]],
      yo: [[0, 0.020], [0.15, 0.012], [0.25, 0], [0.83, 0]],
    },
    mouth: {
      front: 0.012, corner: 0.045, alphaF: 1.20, alphaC: 1.45, shape: 0.7, snoutBlend: 0.01,
      palate: 0.45, floor: 0.4, throat: 0.6, pharynx: 0.05, lipDrop: 0.0010, chinInset: 0.0015,
      teeth: {
        upper: [{ n: 16, h: 0.0060, w: 0.0040, inset: 0.0030, sink: 0.0015, rake: 0.05, rakeCorner: 0.2, thick: 0.6, cornerK: 0.6, span: 0.85 }],
        lower: [{ n: 16, h: 0.0055, w: 0.0038, inset: 0.0030, sink: 0.0015, rake: 0.05, rakeCorner: 0.2, thick: 0.6, cornerK: 0.6, span: 0.85 }],
      },
    },
    eye: { s: 0.085, up: 0.45, r: 0.017, out: 0.40, socket: 0.15, fwd: 0.25, fixed: true },
    bones: { head: 0.08, neck: 0.20, root: 0.42, tail: [0.58, 0.70, 0.80, 0.90] },
    fins: [
      { name: "foreR", role: "paired", at: 0.27, root: 0.05, span: 0.13, dir: [-0.75, -0.45, 0.48], phi: 0.55, sweep: 0.2, tipC: 0.6, conc: 0, rear: 0.05, rearH: 0.2, round: 0.45, tc: 0.22, tcTip: 0.15, embed: 0.3 },
      { name: "foreL", role: "paired", at: 0.27, root: 0.05, span: 0.13, dir: [-0.75, -0.45, -0.48], phi: 2 * Math.PI - 0.55, sweep: 0.2, tipC: 0.6, conc: 0, rear: 0.05, rearH: 0.2, round: 0.45, tc: 0.22, tcTip: 0.15, embed: 0.3 },
      // the hind flippers: fans pointing back, soles facing each other
      { name: "hindR", role: "median", originS: 0.81, originDz: 0.012, root: 0.07, span: 0.18, dir: [-0.97, 0, 0.24], chordDir: [0, 1, 0], sweep: -0.12, tipC: 1.6, conc: 0.06, rear: 0, rearH: 0, round: 0.3, tc: 0.12, tcTip: 0.06, embed: 0.4 },
      { name: "hindL", role: "median", originS: 0.81, originDz: -0.012, root: 0.07, span: 0.18, dir: [-0.97, 0, -0.24], chordDir: [0, 1, 0], sweep: -0.12, tipC: 1.6, conc: 0.06, rear: 0, rearH: 0, round: 0.3, tc: 0.12, tcTip: 0.06, embed: 0.4 },
    ],
    jaw: { lift: 0.10, drop: 0.50, protrude: [0, 0], gap: 0.02 },
    wave: { lambda: 1.0, amp: 0.10, env: [0.02, 0.0, 1.0], f0: 0.4, fK: 0.9, fMax: 2.5 },
    finColor: 0x34373b, dorsalName: "none", caudalName: "hindR",
    lod: [
      { M: 24, ds: 0.022, headK: 0.6, noseRings: 4, eyeRings: true, gills: false, teeth: true, finSpan: 6, finChord: 5, eyeSeg: 10, eyeRing: 7, pharynx: 3 },
      { M: 12, ds: 0.060, headK: 0.7, noseRings: 2, eyeRings: false, gills: false, teeth: false, finSpan: 3, finChord: 3, eyeSeg: 6, eyeRing: 4, pharynx: 2 },
    ],
  };
  SEAL_SPEC.makePaint = function (EY) {
    const roles = {};
    SEAL_SPEC.fins.forEach(function (f, i) { roles[i + 1] = f.role; });
    const L = SEAL_SPEC.L, spot = MB.hexc(0x1e2124), nose = MB.hexc(0x161718);
    return paintKit({
      L: L, eyes: EY, finRole: roles,
      back: 0x3c4246, belly: 0x9c978c, fin: 0x34373b, gum: 0x8a4a4c, gumDeep: 0x4a2022, throat: 0x140608,
      line: [[0, -0.40], [0.10, -0.20], [0.30, -0.25], [0.83, -0.30]],
      rag: 0.08, specBack: 0.38, specBelly: 0.3, specFin: 0.3, iris: 0x0a0806, sclera: 0x1a1412, orbit: 0x26292c,
      // the spots: cells of irregular size, everywhere but the muzzle
      mark: function (c) {
        if (c.tag !== MB.TAG.SKIN || c.lod > 0 || c.m[0] < 0.05) return NaN;
        const w = MB.worley(c.p[0] * 16 / L, c.p[1] * 16 / L, c.p[2] * 16 / L, 71);
        return 0.32 - w[0] - 0.12 * MB.vn(c.p[0] * 40 / L, c.p[1] * 40 / L, c.p[2] * 40 / L, 72);
      },
      skin: function (c, col, up) {
        if (c.m[0] < 0.02) return nose;
        if (c.f(1) >= 0) return MB.mixc(col, spot, up ? 0.85 : 0.6);
        return col;
      },
    });
  };
  CBZ.buildHarborSeal = function () { return marineBuild(SEAL_SPEC); };

  /* ONE GEOMETRY PER SPECIES, for instanced crowds (games/ocean.js draws a
     bait ball as one InstancedMesh): the species' far body in its rest pose,
     vertex-coloured, scaled to the species' real size and turned so its nose
     points along opts.nose ("z" for the Ocean game's +Z forward). */
  const BAKED = new Map();
  CBZ.aquaticBakedGeometry = function (id, opts) {
    const nose = (opts && opts.nose) || "x", lod = opts && opts.lod != null ? opts.lod : 1;
    const key = id + "|" + nose + "|" + lod;
    if (BAKED.has(key)) return BAKED.get(key);
    const sp = CBZ.WILDLIFE_SPECIES && CBZ.WILDLIFE_SPECIES[id];
    const g = sp && sp.build ? sp.build({}) : null;
    const mb = g && g.userData && g.userData.marineBody;
    if (!mb) return null;
    const src = mb.tpl.geo[Math.min(lod, mb.tpl.geo.length - 1)];
    const geo = new T.BufferGeometry();
    geo.setAttribute("position", src.attributes.position.clone());
    geo.setAttribute("normal", src.attributes.normal.clone());
    geo.setAttribute("color", src.attributes.color.clone());
    geo.setIndex(src.index.clone());
    const k = sp.scale || 1;
    geo.scale(k, k, k);
    if (nose === "z") geo.rotateY(-Math.PI / 2);
    geo.computeBoundingBox(); geo.computeBoundingSphere();
    geo._shared = true;
    BAKED.set(key, geo);
    return geo;
  };
})();
