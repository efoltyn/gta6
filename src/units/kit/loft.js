/* ============================================================
   units/kit/loft.js — CBZ.loftKit: LOFTED, VERTEX-COLOURED, SKINNED SHELLS.

   Lifted out of city/dogmodel.js, where the smooth dog replaced nineteen
   boxes: an animal body is a few LOFTS (rings swept along a curved line —
   rump, waist, ribcage, neck; skull, stop, muzzle; each leg segment) plus a
   few ellipsoids (eyes, paws). Each vertex carries its colour (the coat is
   baked into vertex colours, so ONE material serves every animal) and up to
   four bone weights, so the whole body is ONE SkinnedMesh, one draw call.

   API (the maths half loads in node: no THREE needed until toGeometry)
     const G = CBZ.loftKit.geo()                     an empty shell
     G.vert(x, y, z, hex, wts) -> index              wts = [bone, weight, bone, weight, ...]
                                                     (normalized, up to 4 pairs)
     CBZ.loftKit.loft(G, stations, segments, colour, opts)
         stations: [{ x, y, z?, rt, rb, w, sq?, wts, hk?, hkBone?, tag?, ... }]
           rt radius toward "up", rb away from it, w sideways, sq superellipse
           exponent (1 = ellipse, < 1 boxier), wts the ring's bone weights.
           hk (0..1) blends the TOP of the ring (ca > 0.5) toward an extra
           bone — a hackle ridge, a hump, a mane — named per station
           (hkBone) or once in opts.hkBone.
         colour(x, y, z, ca, sa, R, t) -> hex   ca/sa = cos/sin round the ring
           (ca = 1 is "up"), R the station, t 0..1 along the loft.
         opts: { side: [0,0,1] the sideways reference, capA/capB (false = open
                 end), capLen (end-cap length x the end's smallest radius),
                 hkBone }
     CBZ.loftKit.ellipsoid(G, cx, cy, cz, rx, ry, rz, segments, colour, wts)
     CBZ.loftKit.toGeometry(G, { boundingSphere: [x, y, z, r] }) -> THREE.BufferGeometry
         (position, color, skinIndex, skinWeight, index, normals)
     CBZ.loftKit.sharedSkinMaterial(name?) -> one MeshLambertMaterial
         { vertexColors, skinning } shared by every body of that name

   HOW AN ANIMAL FILE USES IT: build dims, then for the torso / neck / head /
   jaw / ears / tail / each leg segment call loft() with stations that carry
   the bone ids from CBZ.quadRig.bones(); toGeometry() once per variant (cache
   it: geometry is shared, skeletons are per animal); CBZ.quadRig.skinnedMesh()
   binds it. city/dogmodel.js is the worked example.
============================================================ */
(function () {
  "use strict";
  const W = typeof window !== "undefined" ? window : globalThis;
  const CBZ = W.CBZ || (W.CBZ = {});
  const TAU = Math.PI * 2;

  // uvOn (set by the caller before lofting) makes every ring carry S+1 verts
  // with its seam under the BELLY and a uv of (arc length along the loft x
  // opts.uScale, 0..1 round the ring) — what a coat-pattern texture needs (the
  // bestiary's beast kit). Off, the shell is byte-identical to before.
  function Geo() { this.p = []; this.c = []; this.si = []; this.sw = []; this.ix = []; this.uv = []; this.uvOn = false; this.n = 0; }
  // hex -> linear 0..1 exactly as THREE r128's Color.setHex (no colour-space conversion)
  Geo.prototype.vert = function (x, y, z, hex, wts) {
    this.p.push(x, y, z);
    hex = Math.floor(hex);
    this.c.push((hex >> 16 & 255) / 255, (hex >> 8 & 255) / 255, (hex & 255) / 255);
    let s = 0; for (let k = 1; k < wts.length; k += 2) s += wts[k];
    s = s || 1;
    for (let k = 0; k < 4; k++) {
      const bi = k * 2 < wts.length ? wts[k * 2] : 0, bw = k * 2 < wts.length ? wts[k * 2 + 1] / s : 0;
      this.si.push(bi); this.sw.push(bw);
    }
    return this.n++;
  };
  function norm3(v) { const l = Math.hypot(v[0], v[1], v[2]) || 1; v[0] /= l; v[1] /= l; v[2] /= l; return v; }
  function cross3(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }

  function loft(G, st, S, colour, opts) {
    opts = opts || {};
    const side0 = opts.side || [0, 0, 1];
    const list = st.slice();
    function tangentAt(arr, i) {
      const a = arr[Math.max(0, i - 1)], b = arr[Math.min(arr.length - 1, i + 1)];
      return norm3([b.x - a.x, b.y - a.y, (b.z || 0) - (a.z || 0)]);
    }
    function capRings(endIdx, dir) {
      const s0 = list[endIdx], t = tangentAt(list, endIdx);
      const len = Math.min(s0.rt, s0.rb, s0.w) * (opts.capLen || 1.0);
      const out = [];
      // opts.capN (1..3, default 3): fewer cap rings for small parts
      const cn = opts.capN || 3;
      const ks = cn === 1 ? [0.4] : cn === 2 ? [0.7, 0.2] : [0.78, 0.48, 0.12], ds = cn === 1 ? [0.8] : cn === 2 ? [0.45, 0.92] : [0.32, 0.66, 0.95];
      for (let k = 0; k < cn; k++) {
        out.push(Object.assign({}, s0, {
          x: s0.x + t[0] * len * ds[k] * dir, y: s0.y + t[1] * len * ds[k] * dir, z: (s0.z || 0) + t[2] * len * ds[k] * dir,
          rt: s0.rt * ks[k], rb: s0.rb * ks[k], w: s0.w * ks[k], cap: k + 1,
        }));
      }
      return out;
    }
    let rings = list;
    if (opts.capA !== false) rings = capRings(0, -1).reverse().concat(rings);
    if (opts.capB !== false) rings = rings.concat(capRings(list.length - 1, 1));
    const base = [];
    const UV = !!G.uvOn, SV = UV ? S + 1 : S, a0 = UV ? Math.PI : 0, uK = opts.uScale || 1;
    let arc = 0;
    for (let i = 0; i < rings.length; i++) {
      if (i > 0) { const q = rings[i - 1], R1 = rings[i]; arc += Math.hypot(R1.x - q.x, R1.y - q.y, (R1.z || 0) - (q.z || 0)); }
      const R = rings[i];
      const t = tangentAt(rings, i);
      let up = cross3(side0, t);
      if (Math.hypot(up[0], up[1], up[2]) < 1e-4) up = [0, 1, 0];
      norm3(up);
      const sd = norm3(cross3(t, up));
      const e = R.sq || 1;
      base.push(G.n);
      for (let j = 0; j < SV; j++) {
        const a = a0 + TAU * j / S, ca = Math.cos(a), sa = Math.sin(a);
        const pc = Math.sign(ca) * Math.pow(Math.abs(ca), e), ps = Math.sign(sa) * Math.pow(Math.abs(sa), e);
        const r = ca >= 0 ? R.rt : R.rb;
        const x = R.x + up[0] * pc * r + sd[0] * ps * R.w;
        const y = R.y + up[1] * pc * r + sd[1] * ps * R.w;
        const z = (R.z || 0) + up[2] * pc * r + sd[2] * ps * R.w;
        let wts = R.wts;
        const hb = R.hkBone != null ? R.hkBone : opts.hkBone;
        if (R.hk && hb != null && ca > 0.5) {
          const hw = R.hk * (ca - 0.5) / 0.5 * 0.85, ow = [];
          for (let k = 0; k < wts.length; k += 2) ow.push(wts[k], wts[k + 1] * (1 - hw));
          ow.push(hb, hw); wts = ow;
        }
        G.vert(x, y, z, colour(x, y, z, ca, sa, R, i / (rings.length - 1)), wts);
        if (UV) G.uv.push(arc * uK, j / S);
      }
    }
    for (let i = 0; i < rings.length - 1; i++) {
      const A = base[i], Bb = base[i + 1];
      for (let j = 0; j < S; j++) {
        const j1 = UV ? j + 1 : (j + 1) % S;
        G.ix.push(A + j, A + j1, Bb + j);
        G.ix.push(A + j1, Bb + j1, Bb + j);
      }
    }
  }
  function ellipsoid(G, cx, cy, cz, rx, ry, rz, S, colour, wts) {
    const st = [], n = 5;
    for (let i = 0; i < n; i++) {
      const t = -0.86 + 1.72 * i / (n - 1), k = Math.sqrt(1 - t * t);
      st.push({ x: cx + t * rx, y: cy, z: cz, rt: ry * k, rb: ry * k, w: rz * k, wts: wts });
    }
    loft(G, st, S, colour, { capLen: 0.55 });
  }

  function toGeometry(G, o) {
    const THREE = W.THREE;
    if (!THREE) throw new Error("loftKit.toGeometry needs THREE");
    o = o || {};
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(G.p, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(G.c, 3));
    // o.static: a plain (unskinned) mesh — the bestiary's posed bodies
    if (!o.static) {
      geo.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(G.si, 4));
      geo.setAttribute("skinWeight", new THREE.Float32BufferAttribute(G.sw, 4));
    }
    if (G.uv.length) geo.setAttribute("uv", new THREE.Float32BufferAttribute(G.uv, 2));
    geo.setIndex(G.ix);
    geo.computeVertexNormals();
    const bs = o.boundingSphere;
    if (bs) geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(bs[0], bs[1], bs[2]), bs[3]);
    geo._shared = true;
    return geo;
  }
  const _mats = new Map();
  function sharedSkinMaterial(name) {
    const THREE = W.THREE;
    name = name || "loft-coat";
    let m = _mats.get(name);
    if (!m) { m = new THREE.MeshLambertMaterial({ vertexColors: true, skinning: true }); m._shared = true; m.name = name; _mats.set(name, m); }
    return m;
  }

  // ==========================================================================
  //  V2 — everything below is ADDITIVE: loft / ellipsoid / toGeometry above
  //  are unchanged for every animal that already uses them.
  //
  //  sweep()     a loft through KEY stations resampled on a Catmull-Rom spline
  //              (smooth curves from a handful of anatomical keys), with any
  //              cross-section (opts.prof), explicit ring frames (key.up),
  //              closed pole caps, a FUR FLOW per vertex and a colour CONTEXT
  //              per vertex, so one shape is recoloured for every coat
  //              without being lofted again.
  //  blob()      an ellipsoid on the same terms (eyes, toes, pads).
  //  spike()     a tapered cone along a curve (teeth, claws, tufts of hair).
  //  tufts()     a fringe of fur spikes rooted on the shell (ruff, brush).
  //  build()     -> { geo, shape }: the BufferGeometry plus the arrays a coat
  //  variant()   needs; variant(shape, fn) makes another geometry SHARING
  //              every attribute but colour (one GPU copy of the body).
  //  furMaterial() one Lambert material that reads the per-vertex fur flow
  //              and draws strands (normal + colour detail, faded out where a
  //              strand is under a pixel). Unskinned meshes work too.
  // ==========================================================================
  const PI = Math.PI;
  function cr1(p0, p1, p2, p3, t) {
    const t2 = t * t, t3 = t2 * t;
    return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
  }
  // extras live beside the base arrays; a vertex added by the v1 calls gets
  // neutral extras so the arrays never fall out of step
  Geo.prototype.extras = function (on) {
    on = on || {};
    if (on.fur && !this.fu) this.fu = [];
    if (on.ctx && !this.cx) { this.cx = []; this.partIds = Object.create(null); this.partNames = []; this.tagIds = Object.create(null); this.tagNames = [""]; this.tagIds[""] = 0; }
    this.sync();
    return this;
  };
  Geo.prototype.sync = function () {
    if (this.fu) while (this.fu.length < this.n * 4) this.fu.push(0, 0, 0, 0.01);
    if (this.cx) while (this.cx.length < this.n * 6) this.cx.push(this.partId("x"), 0, 0, 0, 0, 0);
  };
  Geo.prototype.partId = function (name) {
    let i = this.partIds[name];
    if (i == null) { i = this.partNames.length; this.partNames.push(name); this.partIds[name] = i; }
    return i;
  };
  Geo.prototype.tagId = function (name) {
    if (!name) return 0;
    let i = this.tagIds[name];
    if (i == null) { i = this.tagNames.length; this.tagNames.push(name); this.tagIds[name] = i; }
    return i;
  };
  // one vertex with its extras. ctx = [part, tag, ca, sa, t, aux]; fur = [dx, dy, dz, k, scale]
  Geo.prototype.vx = function (x, y, z, hex, wts, ctx, fur) {
    const i = this.vert(x, y, z, hex == null ? 0x808080 : hex, wts);
    if (this.cx) {
      if (ctx) this.cx.push(this.partId(ctx[0] || "x"), this.tagId(ctx[1] || ""), ctx[2] || 0, ctx[3] || 0, ctx[4] || 0, ctx[5] || 0);
      else this.cx.push(this.partId("x"), 0, 0, 0, 0, 0);
    }
    if (this.fu) {
      if (fur) this.fu.push(fur[0] * fur[3], fur[1] * fur[3], fur[2] * fur[3], fur[4] || 0.004);
      else this.fu.push(0, 0, 0, 0.004);
    }
    return i;
  };
  // a normal set by hand (tufts are lit like the coat they grow from)
  Geo.prototype.normalAt = function (i, nx, ny, nz) { (this.nov || (this.nov = [])).push(i, nx, ny, nz); };

  // ---- weights: [b, w, b, w ...] blended linearly, top four kept -----------
  function mixWts(A, B, f) {
    const acc = {};
    for (let k = 0; k < A.length; k += 2) acc[A[k]] = (acc[A[k]] || 0) + A[k + 1] * (1 - f);
    for (let k = 0; k < B.length; k += 2) acc[B[k]] = (acc[B[k]] || 0) + B[k + 1] * f;
    const out = [];
    for (const b in acc) if (acc[b] > 1e-4) out.push(+b, acc[b]);
    if (out.length > 8) {
      const pairs = []; for (let k = 0; k < out.length; k += 2) pairs.push([out[k], out[k + 1]]);
      pairs.sort(function (p, q) { return q[1] - p[1]; });
      out.length = 0; for (let k = 0; k < 4; k++) out.push(pairs[k][0], pairs[k][1]);
    }
    return out;
  }

  // ---- the spline through the keys ----------------------------------------
  // numbers interpolate (Catmull-Rom, clamped between the two keys so a radius
  // never overshoots into a pinch), wts blend linearly, everything else comes
  // from the nearer key
  function resample(keys, step, nPer) {
    const n = keys.length, out = [];
    function at(i) { return keys[Math.max(0, Math.min(n - 1, i))]; }
    for (let i = 0; i < n - 1; i++) {
      const a = keys[i], b = keys[i + 1];
      const len = Math.hypot(b.x - a.x, b.y - a.y, (b.z || 0) - (a.z || 0));
      const m = nPer ? nPer : Math.max(1, Math.round(step > 0 ? len / step : 1));
      const lim = (i === n - 2) ? m : m - 1;
      for (let s = 0; s <= lim; s++) {
        const f = s / m;
        const k0 = at(i - 1), k1 = a, k2 = b, k3 = at(i + 2);
        const R = {};
        const near = f < 0.5 ? k1 : k2;
        for (const key in near) if (typeof near[key] !== "number") R[key] = near[key];
        const nums = {};
        for (const key in k1) if (typeof k1[key] === "number") nums[key] = 1;
        for (const key in k2) if (typeof k2[key] === "number") nums[key] = 1;
        for (const key in nums) {
          if (key === "x" || key === "y" || key === "z") continue;
          // a number one key leaves out is 0 there (hk, a bump, a flag)
          const v1 = typeof k1[key] === "number" ? k1[key] : 0, v2 = typeof k2[key] === "number" ? k2[key] : 0;
          const v0 = typeof k0[key] === "number" ? k0[key] : v1, v3 = typeof k3[key] === "number" ? k3[key] : v2;
          let v = cr1(v0, v1, v2, v3, f);
          const lo = Math.min(v1, v2), hi = Math.max(v1, v2);
          R[key] = v < lo ? lo : (v > hi ? hi : v);
        }
        R.x = cr1(k0.x, k1.x, k2.x, k3.x, f); R.y = cr1(k0.y, k1.y, k2.y, k3.y, f);
        R.z = cr1(k0.z || 0, k1.z || 0, k2.z || 0, k3.z || 0, f);
        R.wts = mixWts(k1.wts, k2.wts, f);
        if (k1.up || k2.up) {
          const u1 = k1.up || k2.up, u2 = k2.up || k1.up;
          R.up = norm3([u1[0] + (u2[0] - u1[0]) * f, u1[1] + (u2[1] - u1[1]) * f, u1[2] + (u2[2] - u1[2]) * f]);
        }
        R.u = i + f;
        out.push(R);
      }
    }
    if (n === 1) out.push(Object.assign({}, keys[0]));
    return out;
  }

  const _po = { u: 0, s: 0, f: 0 };
  // default cross-section: loft()'s superellipse (rt up, rb down, w sideways)
  function profDefault(R, ca, sa, out) {
    const e = R.sq || 1;
    const pc = Math.sign(ca) * Math.pow(Math.abs(ca), e), ps = Math.sign(sa) * Math.pow(Math.abs(sa), e);
    out.u = pc * (ca >= 0 ? R.rt : R.rb); out.s = ps * R.w; out.f = 0;
  }

  /* sweep(G, keys, o)
       keys  [{ x, y, z?, rt, rb, w, sq?, wts, hk?, up?, tag?, ...numbers }]
       o.S        ring segments (16)          o.step   ring spacing, m
       o.n        rings per key span instead of o.step
       o.side     the sideways reference ([0,0,1]); ring "up" = side x tangent
       o.prof(R, ca, sa, out) -> out.{u, s, f}: the ring point in (up, side,
                  forward) metres; default the superellipse
       o.capA / o.capB  "pole" (default) | "open"; o.capLen x the end radius
       o.part     the colour context's part name; o.colour(x,y,z,ca,sa,R,t)
                  for a fixed colour (else the coat fills it in later)
       o.fur      { sign, down, k, len } or a function(R, ca, sa, t) -> that:
                  hair runs along sign x tangent, bent down by `down`
       o.tufts    function(R, ca, sa, t) -> null | { len, w, k } : a fringe
                  root here (collected on G.tuftRoots for tufts())
       o.hkBone   the bone the TOP of a ring with R.hk blends toward       */
  function sweep(G, keys, o) {
    o = o || {};
    G.extras({ fur: !!G.fu, ctx: !!G.cx });
    const S = o.S || 16;
    const side0 = o.side || [0, 0, 1];
    const prof = o.prof || profDefault;
    const rings = resample(keys, o.step || 0, o.n || 0);
    const N = rings.length;
    // frames
    const T = [], U = [], Sd = [];
    for (let i = 0; i < N; i++) {
      const a = rings[Math.max(0, i - 1)], b = rings[Math.min(N - 1, i + 1)];
      let t = norm3([b.x - a.x, b.y - a.y, (b.z || 0) - (a.z || 0)]);
      if (!isFinite(t[0])) t = [1, 0, 0];
      let up;
      if (rings[i].up) {
        const r = rings[i].up, d = r[0] * t[0] + r[1] * t[1] + r[2] * t[2];
        up = [r[0] - t[0] * d, r[1] - t[1] * d, r[2] - t[2] * d];
      } else up = cross3(side0, t);
      if (Math.hypot(up[0], up[1], up[2]) < 1e-5) up = Math.abs(t[1]) < 0.9 ? cross3([0, 1, 0], t) : cross3([1, 0, 0], t);
      norm3(up);
      const sd = norm3(cross3(t, up));
      T.push(t); U.push(up); Sd.push(sd);
    }
    // total length for t
    const arcs = [0];
    for (let i = 1; i < N; i++) arcs.push(arcs[i - 1] + Math.hypot(rings[i].x - rings[i - 1].x, rings[i].y - rings[i - 1].y, (rings[i].z || 0) - (rings[i - 1].z || 0)));
    const L = arcs[N - 1] || 1;
    const part = o.part || "x";
    const hb0 = o.hkBone;
    const base = [];
    const furOf = typeof o.fur === "function" ? o.fur : null;
    function wtsOf(R, ca) {
      let wts = R.wts;
      const hb = R.hkBone != null ? R.hkBone : hb0;
      if (R.hk && hb != null && ca > 0.5) {
        const hw = R.hk * (ca - 0.5) / 0.5 * 0.85, ow = [];
        for (let k = 0; k < wts.length; k += 2) ow.push(wts[k], wts[k + 1] * (1 - hw));
        ow.push(hb, hw); wts = ow;
      }
      return wts;
    }
    const fur4 = [0, 0, 0, 0, 0];
    function furAt(R, ca, sa, tt, t, rx, ry, rz) {
      const F = furOf ? furOf(R, ca, sa, tt) : o.fur;
      if (!F || !(F.k > 0)) { fur4[3] = 0; fur4[4] = 0.004; return fur4; }
      // the flow: along the tangent, bent toward the ground, off the radial
      const sg = F.sign == null ? -1 : F.sign, dn = F.down || 0;
      let dx = t[0] * sg, dy = t[1] * sg - dn, dz = t[2] * sg;
      const rl = Math.hypot(rx, ry, rz) || 1, nx = rx / rl, ny = ry / rl, nz = rz / rl;
      const d = dx * nx + dy * ny + dz * nz;
      dx -= nx * d; dy -= ny * d; dz -= nz * d;
      const l = Math.hypot(dx, dy, dz);
      if (l < 1e-5) { dx = t[0] * sg; dy = t[1] * sg; dz = t[2] * sg; } else { dx /= l; dy /= l; dz /= l; }
      fur4[0] = dx; fur4[1] = dy; fur4[2] = dz; fur4[3] = F.k; fur4[4] = F.len || 0.004;
      return fur4;
    }
    const ctx = [part, "", 0, 0, 0, 0];
    function ring(R, i, scale, push, tt, fwd) {
      const t = T[i], up = U[i], sd = Sd[i];
      const start = G.n;
      for (let j = 0; j < S; j++) {
        const a = TAU * j / S + (o.a0 || 0), ca = Math.cos(a), sa = Math.sin(a);
        prof(R, ca, sa, _po);
        const pu = _po.u * scale, ps = _po.s * scale, pf = (_po.f || 0) * scale + (fwd || 0);
        const rx = up[0] * pu + sd[0] * ps, ry = up[1] * pu + sd[1] * ps, rz = up[2] * pu + sd[2] * ps;
        const x = R.x + rx + t[0] * pf, y = R.y + ry + t[1] * pf, z = (R.z || 0) + rz + t[2] * pf;
        ctx[1] = R.tag || o.tag || ""; ctx[2] = ca; ctx[3] = sa; ctx[4] = tt; ctx[5] = R.aux || 0;
        const hex = o.colour ? o.colour(x, y, z, ca, sa, R, tt) : 0x808080;
        G.vx(x, y, z, hex, wtsOf(R, ca), ctx, G.fu ? furAt(R, ca, sa, tt, t, rx, ry, rz) : null);
        if (push && o.tufts) {
          const q = o.tufts(R, ca, sa, tt);
          if (q) (G.tuftRoots || (G.tuftRoots = [])).push({ i: G.n - 1, x: x, y: y, z: z, rx: rx, ry: ry, rz: rz,
            tx: t[0], ty: t[1], tz: t[2], len: q.len, w: q.w, k: q.k == null ? 0.6 : q.k, wts: wtsOf(R, ca), part: part,
            tag: q.tag || ctx[1], ca: ca, sa: sa, t: tt, up: q.up || 0, sign: q.sign == null ? -1 : q.sign, down: q.down || 0 });
        }
      }
      return start;
    }
    for (let i = 0; i < N; i++) base.push(ring(rings[i], i, 1, true, arcs[i] / L));
    for (let i = 0; i < N - 1; i++) {
      const A = base[i], B = base[i + 1];
      for (let j = 0; j < S; j++) {
        const j1 = (j + 1) % S;
        G.ix.push(A + j, A + j1, B + j);
        G.ix.push(A + j1, B + j1, B + j);
      }
    }
    // pole caps: two shrinking rings and a point on the axis
    function cap(endI, dir) {
      if ((dir < 0 ? o.capA : o.capB) === "open") return;
      const R = rings[endI];
      const rr = Math.min(R.rt || 0.01, R.rb || 0.01, R.w || 0.01);
      const len = rr * (o.capLen == null ? 0.8 : o.capLen);
      const ks = [0.78, 0.42], ds = [0.42, 0.8];
      let prev = base[endI];
      const nCap = o.capRings == null ? 2 : o.capRings;     // 0 = straight to the pole
      for (let k = 0; k < nCap; k++) {
        const st = ring(R, endI, ks[k], false, dir < 0 ? 0 : 1, len * ds[k] * dir);
        for (let j = 0; j < S; j++) {
          const j1 = (j + 1) % S;
          if (dir > 0) { G.ix.push(prev + j, prev + j1, st + j); G.ix.push(prev + j1, st + j1, st + j); }
          else { G.ix.push(st + j, st + j1, prev + j); G.ix.push(st + j1, prev + j1, prev + j); }
        }
        prev = st;
      }
      const t = T[endI];
      ctx[1] = R.tag || o.tag || ""; ctx[2] = dir; ctx[3] = 0; ctx[4] = dir < 0 ? 0 : 1; ctx[5] = R.aux || 0;
      const px = R.x + t[0] * len * dir, py = R.y + t[1] * len * dir, pz = (R.z || 0) + t[2] * len * dir;
      const pole = G.vx(px, py, pz, o.colour ? o.colour(px, py, pz, dir, 0, R, ctx[4]) : 0x808080, wtsOf(R, 0), ctx,
        G.fu ? furAt(R, 0, 0, ctx[4], t, t[0] * dir, t[1] * dir, t[2] * dir) : null);
      for (let j = 0; j < S; j++) {
        const j1 = (j + 1) % S;
        if (dir > 0) G.ix.push(prev + j, prev + j1, pole);
        else G.ix.push(prev + j1, prev + j, pole);
      }
    }
    cap(0, -1); cap(N - 1, 1);
    return { rings: rings, T: T, U: U, Sd: Sd, base: base, S: S };
  }

  // an ellipsoid with an optional axis frame (fwd = the rx axis), on sweep's
  // terms: `rings` latitude rings and a pole at each end
  function blob(G, c, r, o) {
    o = o || {};
    const f = o.fwd ? norm3(o.fwd.slice()) : [1, 0, 0];
    let up = o.up ? o.up.slice() : (Math.abs(f[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]);
    const d = up[0] * f[0] + up[1] * f[1] + up[2] * f[2];
    up = norm3([up[0] - f[0] * d, up[1] - f[1] * d, up[2] - f[2] * d]);
    const n = o.rings || 4, keys = [];
    for (let i = 0; i < n; i++) {
      // latitudes spaced evenly in angle, the poles left to the caps
      const a = -PI / 2 + PI * (i + 1) / (n + 1), t = Math.sin(a), k = Math.cos(a);
      keys.push({ x: c[0] + f[0] * t * r[0], y: c[1] + f[1] * t * r[0], z: c[2] + f[2] * t * r[0], rt: r[1] * k, rb: r[1] * k, w: r[2] * k,
        wts: o.wts, up: up, tag: o.tag, aux: o.aux || 0 });
    }
    const kEnd = Math.cos(-PI / 2 + PI / (n + 1));
    return sweep(G, keys, { S: o.S || 10, n: 1, part: o.part, tag: o.tag, colour: o.colour, capRings: 0,
      capLen: (1 - Math.sin(PI / 2 - PI / (n + 1))) * r[0] / Math.max(1e-6, Math.min(r[1], r[2]) * kEnd), fur: o.fur, side: cross3(f, up) });
  }
  // a cone from a base ring to a point, base left open (it sits inside a gum,
  // a toe): S triangles. For teeth and claws.
  function cone(G, base, tip, r, o) {
    o = o || {};
    const S = o.S || 5;
    const ax = norm3([tip[0] - base[0], tip[1] - base[1], tip[2] - base[2]]);
    let u = Math.abs(ax[1]) < 0.9 ? cross3(ax, [0, 1, 0]) : cross3(ax, [1, 0, 0]);
    norm3(u);
    const v = norm3(cross3(ax, u));
    const ctx = [o.part || "x", o.tag || "", 0, 0, 0, o.aux || 0];
    const fur = null, start = G.n;
    for (let j = 0; j < S; j++) {
      const a = TAU * j / S, ca = Math.cos(a), sa = Math.sin(a);
      ctx[2] = ca; ctx[3] = sa;
      G.vx(base[0] + (u[0] * ca + v[0] * sa) * r, base[1] + (u[1] * ca + v[1] * sa) * r, base[2] + (u[2] * ca + v[2] * sa) * r, o.hex, o.wts, ctx, fur);
    }
    ctx[2] = 1; ctx[3] = 0; ctx[4] = 1;
    const apex = G.vx(tip[0], tip[1], tip[2], o.hex, o.wts, ctx, fur);
    for (let j = 0; j < S; j++) G.ix.push(start + j, start + (j + 1) % S, apex);
    return apex;
  }

  // a tapered cone along a point list (tooth, claw, spine of a tuft)
  function spike(G, pts, r0, r1, o) {
    o = o || {};
    const keys = [];
    for (let i = 0; i < pts.length; i++) {
      const t = i / (pts.length - 1), r = r0 + (r1 - r0) * t;
      keys.push({ x: pts[i][0], y: pts[i][1], z: pts[i][2], rt: r * (o.ft || 1), rb: r * (o.fb || 1), w: r * (o.fw || 1), wts: o.wts, tag: o.tag, aux: o.aux || 0, up: o.up });
    }
    return sweep(G, keys, { S: o.S || 5, n: 1, part: o.part, tag: o.tag, colour: o.colour, capA: o.capA || "pole", capLen: o.capLenA || 0.5, side: o.side, fur: o.fur });
  }

  /* tufts(G, o): a three-sided spike of hair at every root sweep() collected.
     Rooted a little under the skin, leaning along the flow and out by
     `lift`, lit with the surface normal (so a fringe shades as coat, not as
     a forest of facets). The root and tip carry their own colour context
     (aux 1 / 2) so a coat can paint black-tipped guard hair.             */
  function tufts(G, o) {
    o = o || {};
    const roots = G.tuftRoots || [];
    G.tuftRoots = [];
    let seed = (o.seed | 0) || 7;
    function rnd() { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }
    const lift = o.lift == null ? 0.42 : o.lift;
    for (let q = 0; q < roots.length; q++) {
      const r = roots[q];
      const rl = Math.hypot(r.rx, r.ry, r.rz) || 1;
      const nx = r.rx / rl, ny = r.ry / rl, nz = r.rz / rl;
      // flow (as sweep's fur): along the tangent, bent down, off the radial
      let dx = r.tx * r.sign, dy = r.ty * r.sign - r.down, dz = r.tz * r.sign;
      const d = dx * nx + dy * ny + dz * nz;
      dx -= nx * d; dy -= ny * d; dz -= nz * d;
      let dl = Math.hypot(dx, dy, dz) || 1; dx /= dl; dy /= dl; dz /= dl;
      const lf = lift + (r.up || 0) + (rnd() - 0.5) * 0.25;
      const cl = Math.cos(lf), sl = Math.sin(lf);
      let ax = dx * cl + nx * sl, ay = dy * cl + ny * sl, az = dz * cl + nz * sl;
      // a little scatter so the fringe is not a comb
      ax += (rnd() - 0.5) * 0.25; ay += (rnd() - 0.5) * 0.25; az += (rnd() - 0.5) * 0.25;
      const al = Math.hypot(ax, ay, az) || 1; ax /= al; ay /= al; az /= al;
      const len = r.len * (0.75 + rnd() * 0.5), w = r.w * (0.8 + rnd() * 0.4);
      // base triangle in the plane across the spike, sunk under the skin
      let e1 = cross3([ax, ay, az], [nx, ny, nz]);
      if (Math.hypot(e1[0], e1[1], e1[2]) < 1e-4) e1 = cross3([ax, ay, az], [0, 1, 0]);
      norm3(e1);
      const e2 = norm3(cross3([ax, ay, az], e1));
      const sink = w * 0.9;
      const bx = r.x - nx * sink, by = r.y - ny * sink, bz = r.z - nz * sink;
      const ph = rnd() * TAU, ids = [];
      for (let k = 0; k < 3; k++) {
        const a = ph + TAU * k / 3, c = Math.cos(a) * w, s = Math.sin(a) * w;
        ids.push(G.vx(bx + e1[0] * c + e2[0] * s, by + e1[1] * c + e2[1] * s, bz + e1[2] * c + e2[2] * s, 0x808080, r.wts,
          [r.part, r.tag, r.ca, r.sa, r.t, 1], [ax, ay, az, r.k * 0.6, 0.003]));
      }
      const bend = (rnd() - 0.5) * 0.3;
      const tip = G.vx(r.x + (ax + nx * bend) * len, r.y + (ay + ny * bend) * len, r.z + (az + nz * bend) * len, 0x808080, r.wts,
        [r.part, r.tag, r.ca, r.sa, r.t, 2], [ax, ay, az, r.k * 0.6, 0.003]);
      ids.push(tip);
      for (let k = 0; k < 3; k++) {
        const a = ids[k], b = ids[(k + 1) % 3];
        G.ix.push(a, b, tip);
      }
      for (let k = 0; k < 4; k++) G.normalAt(ids[k], nx, ny, nz);
    }
    return roots.length;
  }

  /* build(G, o) -> { geo, shape }
       o.static          no skin attributes
       o.colour(part, x, y, z, ca, sa, tag, t, aux) -> hex   (needs the ctx)
       o.boundingSphere  [x, y, z, r]
     shape = what variant() needs: the geometry's attributes and the colour
     context, kept so a new coat is one pass over the vertices.          */
  function build(G, o) {
    const THREE = W.THREE;
    o = o || {};
    G.sync && G.sync();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(G.p, 3));
    if (!o.static) {
      geo.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(G.si, 4));
      geo.setAttribute("skinWeight", new THREE.Float32BufferAttribute(G.sw, 4));
    }
    if (G.fu) geo.setAttribute("fur", new THREE.Float32BufferAttribute(G.fu, 4));
    geo.setIndex(G.ix);
    geo.computeVertexNormals();
    if (G.nov) {
      const N = geo.attributes.normal.array;
      for (let k = 0; k < G.nov.length; k += 4) { const i = G.nov[k] * 3; N[i] = G.nov[k + 1]; N[i + 1] = G.nov[k + 2]; N[i + 2] = G.nov[k + 3]; }
    }
    const shape = {
      p: geo.attributes.position.array, n: G.n,
      cx: G.cx ? new Float32Array(G.cx) : null, partNames: G.partNames || ["x"], tagNames: G.tagNames || [""],
      base: geo, colours: G.c,
    };
    const col = o.colour && shape.cx ? colourise(shape, o.colour) : new Float32Array(G.c);
    geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    const bs = o.boundingSphere;
    if (bs) geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(bs[0], bs[1], bs[2]), bs[3]);
    else geo.computeBoundingSphere();
    geo._shared = true;
    return { geo: geo, shape: shape };
  }
  function colourise(shape, fn) {
    const n = shape.n, P = shape.p, C = shape.cx, out = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const c = i * 6;
      const hex = Math.floor(fn(shape.partNames[C[c]], P[i * 3], P[i * 3 + 1], P[i * 3 + 2], C[c + 2], C[c + 3], shape.tagNames[C[c + 1]], C[c + 4], C[c + 5], i)) || 0;
      out[i * 3] = (hex >> 16 & 255) / 255; out[i * 3 + 1] = (hex >> 8 & 255) / 255; out[i * 3 + 2] = (hex & 255) / 255;
    }
    return out;
  }
  // another coat on the same body: every attribute shared but colour
  function variant(shape, fn, bs) {
    const THREE = W.THREE, src = shape.base;
    const geo = new THREE.BufferGeometry();
    for (const k in src.attributes) if (k !== "color") geo.setAttribute(k, src.attributes[k]);
    geo.setIndex(src.index);
    geo.setAttribute("color", new THREE.Float32BufferAttribute(colourise(shape, fn), 3));
    geo.boundingSphere = src.boundingSphere ? src.boundingSphere.clone() : null;
    if (bs) geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(bs[0], bs[1], bs[2]), bs[3]);
    geo._shared = true;
    return geo;
  }

  /* furMaterial(name, o): ONE shared Lambert (vertex colours) whose shader
     reads the per-vertex `fur` attribute (flow xyz x strength, w = strand
     width in model metres) and draws strands from the bind-pose position:
     value noise squashed along the flow, tilting the normal across the
     strands and darkening the grooves. It fades to the plain coat where a
     strand is smaller than a pixel, so far bodies cost nothing extra and
     never shimmer. o.gain scales the effect (birds use a finer, flatter one). */
  const _furMats = new Map();
  function furMaterial(name, o) {
    const THREE = W.THREE;
    name = name || "fur-coat";
    let m = _furMats.get(name);
    if (m) return m;
    o = o || {};
    m = new THREE.MeshLambertMaterial({ vertexColors: true });
    m.name = name; m._shared = true;
    const gain = o.gain == null ? 1 : o.gain, groove = o.groove == null ? 0.34 : o.groove;
    m.onBeforeCompile = function (sh) {
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nattribute vec4 fur;\nvarying vec3 vFurP;\nvarying vec3 vFurD;\nvarying vec3 vFurT;\nvarying vec2 vFurK;")
        .replace("#include <skinnormal_vertex>", "#include <skinnormal_vertex>\n" +
          "  vec3 cbzFt = fur.xyz;\n" +
          "  #ifdef USE_SKINNING\n  cbzFt = ( skinMatrix * vec4( cbzFt, 0.0 ) ).xyz;\n  #endif\n" +
          "  vFurT = ( modelViewMatrix * vec4( cbzFt, 0.0 ) ).xyz;\n" +
          "  float cbzFk = length( fur.xyz );\n" +
          "  vFurD = cbzFk > 1e-5 ? fur.xyz / cbzFk : vec3( 1.0, 0.0, 0.0 );\n" +
          "  vFurK = vec2( cbzFk, max( fur.w, 1e-4 ) );\n" +
          "  vFurP = position;");
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vFurP;\nvarying vec3 vFurD;\nvarying vec3 vFurT;\nvarying vec2 vFurK;\n" +
          "float cbzH3( vec3 p ) { p = fract( p * 0.3183099 + 0.1 ); p *= 17.0; return fract( p.x * p.y * p.z * ( p.x + p.y + p.z ) ); }\n" +
          "float cbzN3( vec3 x ) { vec3 i = floor( x ); vec3 f = fract( x ); f = f * f * ( 3.0 - 2.0 * f );\n" +
          "  return mix( mix( mix( cbzH3( i ), cbzH3( i + vec3( 1, 0, 0 ) ), f.x ), mix( cbzH3( i + vec3( 0, 1, 0 ) ), cbzH3( i + vec3( 1, 1, 0 ) ), f.x ), f.y ),\n" +
          "              mix( mix( cbzH3( i + vec3( 0, 0, 1 ) ), cbzH3( i + vec3( 1, 0, 1 ) ), f.x ), mix( cbzH3( i + vec3( 0, 1, 1 ) ), cbzH3( i + vec3( 1, 1, 1 ) ), f.x ), f.y ), f.z ); }")
        .replace("#include <normal_fragment_maps>", "#include <normal_fragment_maps>\n" +
          "  {\n" +
          "    float fk = vFurK.x;\n" +
          "    float fade = 1.0 - smoothstep( 0.25, 0.9, length( fwidth( vFurP ) ) / vFurK.y );\n" +
          "    float amp = fk * fade * " + gain.toFixed(3) + ";\n" +
          "    if ( amp > 0.004 ) {\n" +
          "      vec3 D = normalize( vFurD );\n" +
          "      vec3 q = ( vFurP - D * dot( vFurP, D ) * 0.86 ) / vFurK.y;\n" +
          "      float n1 = cbzN3( q );\n" +
          "      float n2 = cbzN3( q * 2.07 + vec3( 3.1, 7.7, 1.3 ) );\n" +
          "      float st = n1 * 0.62 + n2 * 0.38;\n" +
          "      vec3 T = vFurT - normal * dot( vFurT, normal );\n" +
          "      float tl = length( T );\n" +
          "      if ( tl > 1e-5 ) {\n" +
          "        T /= tl;\n" +
          "        vec3 B = cross( normal, T );\n" +
          "        normal = normalize( normal + B * ( st - 0.5 ) * 1.1 * amp + T * ( n2 - 0.5 ) * 0.35 * amp );\n" +
          "      }\n" +
          "      diffuseColor.rgb *= 1.0 + ( st - 0.55 ) * " + (groove * 2).toFixed(3) + " * amp;\n" +
          "    }\n" +
          "  }");
    };
    m.customProgramCacheKey = function () { return "cbzFur|" + gain + "|" + groove; };
    _furMats.set(name, m);
    return m;
  }

  const API = { geo: function () { return new Geo(); }, Geo: Geo, loft: loft, ellipsoid: ellipsoid,
    toGeometry: toGeometry, sharedSkinMaterial: sharedSkinMaterial, norm3: norm3, cross3: cross3,
    sweep: sweep, blob: blob, spike: spike, cone: cone, tufts: tufts, build: build, variant: variant, colourise: colourise,
    furMaterial: furMaterial, resample: resample };
  CBZ.loftKit = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})();
