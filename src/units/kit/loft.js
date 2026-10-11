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

  function Geo() { this.p = []; this.c = []; this.si = []; this.sw = []; this.ix = []; this.n = 0; }
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
      const ks = [0.78, 0.48, 0.12], ds = [0.32, 0.66, 0.95];
      for (let k = 0; k < 3; k++) {
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
    for (let i = 0; i < rings.length; i++) {
      const R = rings[i];
      const t = tangentAt(rings, i);
      let up = cross3(side0, t);
      if (Math.hypot(up[0], up[1], up[2]) < 1e-4) up = [0, 1, 0];
      norm3(up);
      const sd = norm3(cross3(t, up));
      const e = R.sq || 1;
      base.push(G.n);
      for (let j = 0; j < S; j++) {
        const a = TAU * j / S, ca = Math.cos(a), sa = Math.sin(a);
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
      }
    }
    for (let i = 0; i < rings.length - 1; i++) {
      const A = base[i], Bb = base[i + 1];
      for (let j = 0; j < S; j++) {
        const j1 = (j + 1) % S;
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
    geo.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(G.si, 4));
    geo.setAttribute("skinWeight", new THREE.Float32BufferAttribute(G.sw, 4));
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

  const API = { geo: function () { return new Geo(); }, Geo: Geo, loft: loft, ellipsoid: ellipsoid,
    toGeometry: toGeometry, sharedSkinMaterial: sharedSkinMaterial, norm3: norm3, cross3: cross3 };
  CBZ.loftKit = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})();
