/* ============================================================
   entities/eyewear.js — SUNGLASSES THAT ARE WORN, NOT STUCK ON.

   OWNER (on an iPad): "The sunglasses look terrible. The side frames of the
   sunglasses go into the head."

   WHY THEY DID. There were four separate pairs of sunglasses in this repo and
   none of them knew what a head was:
     · city/bling.js (every street pair: gang, exec, the player) — five BOXES
       at typed neck-local spots, never scaled to the head. Its temple was a
       0.035 x 0.045 x 0.30 bar centred at x 0.27: the skull is 0.30 wide at
       the eye line, so the whole arm ran 1.3-4.8 cm INSIDE the head, and on a
       bigger head (hk > 1) deeper still.
     · city/charpanel.js — the same five boxes copied "1:1" for the portrait.
     · city/outfits.js's detail kit (Secret Service, the president's detail) —
       bars typed against one measured head, flaring 7 cm off the skull.
     · warlord/wardrobe.js — a slab and ONE 0.62 bar straight through the skull
       whose ends poked out either side.
   Lenses were flat black boxes in all four.

   WHAT A PAIR IS NOW. One builder, every body. The frame is FITTED to the head
   it is going on, read off the head character.js actually drew
   (CBZ.charHeadSurface: the skull's signed distance, the near head's nose
   vertices, the ear's own vertices), once per (style, head form, nose) and
   cached; the mesh is scaled by hk = headSize/0.60 exactly like the head:
     · THE FRONT is a curved sheet (a base curve across, a little vertical
       curve) pushed forward until every brow, cheek, lash and nose point under
       the lenses is LENS_GAP behind it: lenses proud of the eyes, never into
       the brow or cheek.
     · THE BRIDGE arches over the nose it measured; wire frames stand on NOSE
       PADS on the sides of that nose.
     · THE TEMPLES leave the rim's outer edge, wrap the head's corner and run
       back TEMPLE_GAP outside the skin (a ray off the skull per station), rise
       just enough to clear the ear's top, and bend down behind the ear.
   Styles are real eyewear: AVIATOR (thin gold wire, teardrop lenses, double
   bridge, nose pads, dark tips), NAVIGATOR (squared gold wire, mirror),
   WAYFARER (thick black acetate), ROUND (tortoise acetate, amber), SPORT and
   AGENT (half-rim wraparounds). Lenses are glass: a dark tint with a polished
   surface reflecting the street (CBZ.jewel's environment) and its fresnel.

   COST. One mesh per wearer (2-4 material groups). Geometry shared per
   (shape, form, nose): at most 5 x 3 x 3 builds, ~1.5k triangles each.
   Materials shared per finish.

   API (CBZ.eyewear):
     make(rig, style)        -> Mesh to add to rig.neck (null if no head)
     styleFor(nameOrLook)    -> style for an item name / bling look
     geometry(shape, form, nose), fit(shape, form, nose) (fit data, for checks)
     STYLES, SHAPES
============================================================ */
(function () {
  "use strict";
  const root = typeof window !== "undefined" ? window : globalThis;
  const CBZ = root.CBZ = root.CBZ || {};
  const THREE = root.THREE;
  if (!THREE) return;
  if (CBZ.eyewear && CBZ.eyewear.version) return;

  // clearances in UNIT FACE units (x hk x humanScale 0.70 = metres; 0.0035
  // is 2.5 mm on an adult head)
  const TEMPLE_GAP = 0.0035;     // temple inner face to skin
  const LENS_GAP = 0.014;        // lens back to lash / brow / cheek / nose
  const EAR_GAP = 0.004;         // temple to the ear it passes over/behind
  const NOSE_GAP = 0.006;        // bridge to the nose it arches over

  /* ---- SHAPES. Outline = the RIGHT lens (+x), a outward from the lens
     centre, b up, in face units; the left lens is its mirror. */
  const SHAPES = {
    aviator: {
      outline: [[-0.080, 0.058], [-0.020, 0.072], [0.050, 0.070], [0.092, 0.050], [0.104, 0.005], [0.094, -0.045],
                [0.064, -0.084], [0.020, -0.100], [-0.030, -0.088], [-0.066, -0.050], [-0.086, 0.000]],
      lu: -0.005, kH: 0.35, kV: 0.40,
      rim: { wire: 0.0052 }, temple: { wire: 0.0052, tip: 1.7 }, hingeB: 0.052,
      bridge: "double", pads: true,
    },
    navigator: {
      outline: [[-0.084, 0.056], [0.000, 0.062], [0.084, 0.060], [0.100, 0.040], [0.102, -0.028], [0.084, -0.064],
                [0.000, -0.072], [-0.068, -0.062], [-0.088, -0.020]],
      lu: 0.0, kH: 0.32, kV: 0.35,
      rim: { wire: 0.0058 }, temple: { wire: 0.0055, tip: 1.7 }, hingeB: 0.046,
      bridge: "double", pads: true,
    },
    wayfarer: {
      outline: [[-0.084, 0.050], [-0.020, 0.058], [0.050, 0.064], [0.094, 0.066], [0.106, 0.040], [0.100, -0.010],
                [0.080, -0.050], [0.040, -0.066], [-0.020, -0.064], [-0.066, -0.046], [-0.088, 0.000]],
      lu: 0.004, kH: 0.30, kV: 0.30,
      rim: { slab: [0.022, 0.017], topHeavy: 0.45 }, temple: { slab: [0.0105, 0.024] }, hingeB: 0.044,
      bridge: "keyhole",
    },
    round: {
      outline: (function () { const o = []; for (let i = 0; i < 12; i++) { const t = i / 12 * Math.PI * 2; o.push([0.004 + 0.070 * Math.cos(t), 0.068 * Math.sin(t)]); } return o; })(),
      lu: 0.004, kH: 0.25, kV: 0.30,
      rim: { slab: [0.016, 0.014] }, temple: { slab: [0.0085, 0.017] }, hingeB: 0.030,
      bridge: "keyhole", tortoise: true,
    },
    wrap: {
      outline: [[-0.082, 0.046], [0.000, 0.056], [0.090, 0.054], [0.140, 0.036], [0.158, 0.000], [0.148, -0.030],
                [0.100, -0.050], [0.030, -0.058], [-0.040, -0.052], [-0.076, -0.030], [-0.088, 0.005]],
      lu: 0.004, kH: 1.05, kV: 0.55,
      rim: { top: [0.016, 0.014] }, temple: { slab: [0.0095, 0.020] }, hingeB: 0.030,
      bridge: "bar",
    },
  };
  const STYLES = {
    wayfarer: { shape: "wayfarer", frame: "acetate", lens: "smoke" },
    aviator: { shape: "aviator", frame: "gold", lens: "g15", tip: "tip", pad: "pad" },
    navigator: { shape: "navigator", frame: "gold", lens: "mirror", tip: "tip", pad: "pad" },
    round: { shape: "round", frame: "tortoise", lens: "amber" },
    sport: { shape: "wrap", frame: "matte", lens: "sportMirror" },
    agent: { shape: "wrap", frame: "matte", lens: "smoke" },
  };
  // bling looks + item names -> style
  const LOOK_STYLE = { shades: "wayfarer", shadesDesigner: "navigator", shadesAviator: "aviator", shadesSport: "sport", shadesRetro: "round" };
  function styleFor(name) {
    if (!name) return null;
    if (STYLES[name]) return name;
    if (LOOK_STYLE[name]) return LOOK_STYLE[name];
    const it = CBZ.cityEcon && CBZ.cityEcon.ITEMS && CBZ.cityEcon.ITEMS[name];
    if (it && it.blingLook && LOOK_STYLE[it.blingLook]) return LOOK_STYLE[it.blingLook];
    const s = ("" + name).toLowerCase();
    if (s.indexOf("grill") >= 0) return null;
    if (s.indexOf("aviator") >= 0) return "aviator";
    if (s.indexOf("designer") >= 0) return "navigator";
    if (s.indexOf("retro") >= 0 || s.indexOf("round") >= 0) return "round";
    if (s.indexOf("sport") >= 0 || s.indexOf("wrap") >= 0) return "sport";
    if (s.indexOf("shades") >= 0 || s.indexOf("sunglass") >= 0) return "wayfarer";
    return null;
  }

  /* ---- small vector helpers ---- */
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const add3 = (a, b, k) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const lerp = (a, b, t) => a + (b - a) * t;
  const sm = (t) => { t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); };

  // closed uniform Catmull-Rom through 2D control points, n samples
  function closedCR(P, n) {
    const out = [], m = P.length;
    for (let i = 0; i < n; i++) {
      const f = i / n * m, k = Math.floor(f), t = f - k;
      const p0 = P[(k - 1 + m) % m], p1 = P[k % m], p2 = P[(k + 1) % m], p3 = P[(k + 2) % m];
      const t2 = t * t, t3 = t2 * t;
      const c = (a, b, c2, d) => 0.5 * (2 * b + (-a + c2) * t + (2 * a - 5 * b + 4 * c2 - d) * t2 + (-a + 3 * b - 3 * c2 + d) * t3);
      out.push([c(p0[0], p1[0], p2[0], p3[0]), c(p0[1], p1[1], p2[1], p3[1])]);
    }
    return out;
  }

  /* ---- geometry accumulator with material groups ---- */
  function Acc() { this.p = []; this.i = []; this.c = null; }
  Acc.prototype.v = function (q) { this.p.push(q[0], q[1], q[2]); return this.p.length / 3 - 1; };
  Acc.prototype.tri = function (a, b, c) { this.i.push(a, b, c); };
  // mirror everything in x (left side), winding flipped
  Acc.prototype.mirror = function () {
    const n = this.p.length / 3, P = this.p, I = this.i, ni = I.length;
    for (let k = 0; k < n; k++) P.push(-P[k * 3], P[k * 3 + 1], P[k * 3 + 2]);
    for (let k = 0; k < ni; k += 3) I.push(I[k] + n, I[k + 2] + n, I[k + 1] + n);
    if (this.c) { const C = this.c, cn = C.length; for (let k = 0; k < cn; k++) C.push(C[k]); }
  };

  /* sweep a section along a path. frames[k] = {p, a, b} (point + two section
     axes); sec = [[s, t], ...] in (a, b). closed: path loops. caps: fan the
     open ends (start/end flags). */
  function sweep(acc, frames, sec, closed, capStart, capEnd) {
    const ns = sec.length, base = acc.p.length / 3, nf = frames.length;
    for (let k = 0; k < nf; k++) {
      const F = frames[k], sc = F.s == null ? 1 : F.s;
      for (let j = 0; j < ns; j++) acc.v(add3(add3(F.p, F.a, sec[j][0] * sc), F.b, sec[j][1] * sc));
    }
    const segs = closed ? nf : nf - 1;
    for (let k = 0; k < segs; k++) {
      const k2 = (k + 1) % nf;
      for (let j = 0; j < ns; j++) {
        const j2 = (j + 1) % ns;
        const a = base + k * ns + j, b = base + k * ns + j2, c = base + k2 * ns + j, d = base + k2 * ns + j2;
        acc.tri(a, d, c); acc.tri(a, b, d);   // (a, b, T) right-handed + CCW section: this faces OUT
      }
    }
    const cap = function (k, flip) {
      const ctr = acc.v(frames[k].p);
      for (let j = 0; j < ns; j++) {
        const a = base + k * ns + j, b = base + k * ns + (j + 1) % ns;
        if (flip) acc.tri(ctr, a, b); else acc.tri(ctr, b, a);
      }
    };
    if (!closed && capStart) cap(0, false);
    if (!closed && capEnd) cap(nf - 1, true);
  }
  // frames along an open/closed polyline: a = the section's "out" axis (as
  // close to `outOf(k)` as the tangent allows), b = tangent x a
  function framesAlong(pts, closed, outOf, scaleOf) {
    const n = pts.length, F = [];
    for (let k = 0; k < n; k++) {
      const p0 = pts[closed ? (k - 1 + n) % n : Math.max(0, k - 1)], p1 = pts[closed ? (k + 1) % n : Math.min(n - 1, k + 1)];
      const T = norm(sub(p1, p0));
      let o = outOf(k, pts[k]);
      o = norm(add3(o, T, -dot(o, T)));
      F.push({ p: pts[k], a: o, b: norm(cross(T, o)), s: scaleOf ? scaleOf(k) : 1 });
    }
    return F;
  }
  const circleSec = (r, n) => { const s = []; for (let j = 0; j < n; j++) { const t = j / n * Math.PI * 2; s.push([r * Math.cos(t), r * Math.sin(t)]); } return s; };
  // a rounded rectangle section (acetate): half-extents w (a axis), h (b axis)
  const slabSec = (w, h) => { const c = Math.min(w, h) * 0.45; return [[w, h - c], [w - c, h], [-w + c, h], [-w, h - c], [-w, -h + c], [-w + c, -h], [w - c, -h], [w, -h + c]]; };

  /* ---- the nose, as rows of the drawn vertices ---- */
  function noseRows(S) {
    const P = S.nosePts || [], rows = new Map();
    for (let i = 0; i < P.length; i += 3) {
      const key = Math.round(P[i + 1] * 400);
      const r = rows.get(key) || { u: 0, n: 0, z: -1, hw: 0 };
      r.u += P[i + 1]; r.n++; r.z = Math.max(r.z, P[i + 2]); r.hw = Math.max(r.hw, Math.abs(P[i]));
      rows.set(key, r);
    }
    const out = [];
    rows.forEach(function (r) { out.push({ u: r.u / r.n, z: r.z, hw: r.hw }); });
    out.sort((a, b) => a.u - b.u);
    return out;
  }
  function noseAt(rows, u) {
    if (!rows.length || u < rows[0].u || u > rows[rows.length - 1].u) return null;
    for (let i = 0; i < rows.length - 1; i++) {
      const A = rows[i], B = rows[i + 1];
      if (u >= A.u && u <= B.u) { const t = (u - A.u) / Math.max(1e-6, B.u - A.u); return { z: lerp(A.z, B.z, t), hw: lerp(A.hw, B.hw, t) }; }
    }
    return { z: rows[rows.length - 1].z, hw: rows[rows.length - 1].hw };
  }

  /* ================================================================ THE FIT
     Everything a pair needs to know about one head, in the face frame. */
  const _fits = Object.create(null);
  function fit(shapeKey, form, nose) {
    const SH = SHAPES[shapeKey] || SHAPES.wayfarer;
    const surfFn = CBZ.charHeadSurface;
    if (typeof surfFn !== "function") return null;
    const S = surfFn(form || "m", nose == null ? 1 : nose);
    const key = shapeKey + "|" + S.form + "|" + S.nose;
    if (_fits[key]) return _fits[key];
    const E = S.eye, Lx = E.x, Lu = E.y + SH.lu, kH = SH.kH, kV = SH.kV;
    const rows = noseRows(S);
    const hitP = { p: [0, 0, 0], n: [0, 0, 0] };
    const skinZ = (x, u) => S.hit([x, u, 0], [0, 0, 1], hitP).p[2];
    const skinX = (u, z) => S.hit([0, u, z], [1, 0, 0], hitP).p[0];
    let outline = closedCR(SH.outline, 28);
    { let ar = 0; for (let i = 0; i < outline.length; i++) { const p = outline[i], q = outline[(i + 1) % outline.length]; ar += p[0] * q[1] - q[0] * p[1]; } if (ar < 0) outline = outline.reverse(); }
    const rimW = SH.rim.wire ? SH.rim.wire * 2 : (SH.rim.slab || SH.rim.top)[0];
    // 1. the front sheet: z(x,u) = Z0 - kH x^2 - kV (u - Lu)^2 (lens BACK)
    let Z0 = 0;
    const need = function (x, u, z, gap) { Z0 = Math.max(Z0, z + gap + kH * x * x + kV * (u - Lu) * (u - Lu)); };
    let a0 = 1, a1 = -1, b0 = 1, b1 = -1;
    for (const q of SH.outline) { a0 = Math.min(a0, q[0]); a1 = Math.max(a1, q[0]); b0 = Math.min(b0, q[1]); b1 = Math.max(b1, q[1]); }
    const m = rimW + 0.004;
    for (let i = 0; i <= 10; i++) for (let j = 0; j <= 8; j++) {
      const x = Lx + lerp(a0 - m, a1 + m, i / 10), u = Lu + lerp(b0 - m, b1 + m, j / 8);
      need(x, u, skinZ(x, u), LENS_GAP);
    }
    need(Lx, E.y, E.front + 0.006, LENS_GAP);                       // the lashes
    for (let i = 0; i < (S.nosePts || []).length; i += 3) {          // the nose under the lens / rim
      const x = S.nosePts[i], u = S.nosePts[i + 1], z = S.nosePts[i + 2];
      if (Math.abs(x) >= Lx + a0 - m && u >= Lu + b0 - m && u <= Lu + b1 + m) need(Math.abs(x), u, z, LENS_GAP * 0.6);
    }
    const zf = (x, u) => Z0 - kH * x * x - kV * (u - Lu) * (u - Lu);
    const nrm = (x, u) => norm([2 * kH * x, 2 * kV * (u - Lu), 1]);
    const onFront = (a, b, lift) => { const x = Lx + a, u = Lu + b, n = nrm(x, u); return add3([x, u, zf(x, u)], n, lift); };
    // 2. temples (right side): leave the rim's outer edge at hingeB, wrap the
    //    corner TEMPLE_GAP off the skin, clear the ear, bend down behind it
    const T = SH.temple, tA = T.wire || T.slab[0], tB = T.wire || T.slab[1];   // half-thickness across / half-height
    let rimOut = null;
    for (let i = 0; i < outline.length; i++) {
      const p = outline[i], q = outline[(i + 1) % outline.length];
      if (p[0] > 0 && (p[1] - SH.hingeB) * (q[1] - SH.hingeB) <= 0) { const t = (SH.hingeB - p[1]) / ((q[1] - p[1]) || 1e-6); rimOut = [lerp(p[0], q[0], t), SH.hingeB]; break; }
    }
    if (!rimOut) rimOut = [a1, 0];
    const ear = S.earPts || [];
    const earTopAt = function (z, x) {   // highest ear point within reach of a temple at (x, z)
      let top = -1;
      for (let i = 0; i < ear.length; i += 3) if (Math.abs(ear[i + 2] - z) < tA + EAR_GAP + 0.012 && ear[i] > x - 0.03) top = Math.max(top, ear[i + 1]);
      return top;
    };
    const earBackAt = function (u) {      // rearmost ear point near height u
      let zb = 1;
      for (let i = 0; i < ear.length; i += 3) if (Math.abs(ear[i + 1] - u) < tB + EAR_GAP + 0.012) zb = Math.min(zb, ear[i + 2]);
      return zb;
    };
    const off = TEMPLE_GAP + tA;
    const start = onFront(rimOut[0] + rimW * 0.3, rimOut[1], rimW * 0.15);
    const uH = start[1];
    let earZmin = 1, earZmax = -1;
    for (let i = 0; i < ear.length; i += 3) { earZmin = Math.min(earZmin, ear[i + 2]); earZmax = Math.max(earZmax, ear[i + 2]); }
    if (!ear.length) { earZmin = -0.08; earZmax = 0.015; }
    // the height over the ear
    let uTop = uH;
    for (let z = earZmax + 0.02; z >= earZmin - 0.01; z -= 0.005) uTop = Math.max(uTop, earTopAt(z, 0.30) + EAR_GAP + tB);
    const path = [start];
    const zEarFront = earZmax + 0.03;
    for (let z = start[2] - 0.012; z > zEarFront - 0.06; z -= 0.018) {
      const t = sm((start[2] - z) / Math.max(0.05, start[2] - zEarFront));
      const u = lerp(uH, uTop, t);
      const x = Math.max(skinX(u, z) + off, start[0] + (start[2] - z) * 0.05);
      path.push([x, u, z]);
    }
    // bend down behind the ear
    const zBend = Math.min(path[path.length - 1][2] - 0.01, earZmin + 0.035);
    const Rb = 0.05, cz = zBend, cu = uTop - Rb;
    const tipLen = 0.05;
    let last = path[path.length - 1];
    for (let th = 0; th <= 1.25; th += 0.25) {
      let z = cz - Rb * Math.sin(th), u = cu + Rb * Math.cos(th);
      const zb = earBackAt(u) - EAR_GAP - tA;
      if (u < earTopAt(z, 0.30) + EAR_GAP + tB && z > zb) z = zb;
      z = Math.min(z, last[2] - 0.004);
      last = [skinX(u, z) + off, u, z];
      path.push(last);
    }
    { // the tip runs on, down and back, along the bend's last heading
      const p0 = path[path.length - 2], p1 = path[path.length - 1], d = norm(sub(p1, p0));
      for (let s = 1; s <= 3; s++) {
        let u = p1[1] + d[1] * tipLen * s / 3, z = p1[2] + d[2] * tipLen * s / 3;
        z = Math.min(z, earBackAt(u) - EAR_GAP - tA);
        path.push([skinX(u, z) + off, u, z]);
      }
    }
    // smooth x, then push any station still closer than `off` out along the
    // skull's normal (a ray along +x is not the nearest skin on the head's
    // rounded front corner)
    for (let it = 0; it < 3; it++) for (let k = 2; k < path.length - 1; k++) {
      const p = path[k];
      p[0] = Math.max(skinX(p[1], p[2]) + off, (path[k - 1][0] + p[0] * 2 + path[k + 1][0]) / 4);
    }
    const e = 0.0015;
    for (let k = 1; k < path.length; k++) {
      const p = path[k];
      for (let it = 0; it < 6; it++) {
        const d = S.sdf(p[0], p[1], p[2]);
        if (d >= off - 0.0001) break;
        const g = norm([S.sdf(p[0] + e, p[1], p[2]) - S.sdf(p[0] - e, p[1], p[2]), S.sdf(p[0], p[1] + e, p[2]) - S.sdf(p[0], p[1] - e, p[2]), S.sdf(p[0], p[1], p[2] + e) - S.sdf(p[0], p[1], p[2] - e)]);
        p[0] += g[0] * (off - d); p[1] += g[1] * (off - d); p[2] += g[2] * (off - d);
      }
    }
    // 3. nose: bridge height + pads
    const noseZ = (u) => { const n = noseAt(rows, u); return n ? n.z : -1; };
    const padU = Lu - 0.012, nP = noseAt(rows, padU) || { z: E.front + 0.01, hw: 0.025 };
    // the pad lies on the side of the nose, never sunk into the cheek/face plane
    // (a child's nose barely stands proud at pad height)
    const padX = nP.hw + NOSE_GAP + 0.004;
    const padAt = { u: padU, x: padX, z: Math.max(nP.z - 0.012, skinZ(padX, padU) + 0.012) };
    const F = {
      shape: shapeKey, form: S.form, nose: S.nose, S: S, Lx: Lx, Lu: Lu, Z0: Z0, kH: kH, kV: kV,
      zf: zf, nrm: nrm, onFront: onFront, outline: outline, rimW: rimW, temple: path, tA: tA, tB: tB,
      noseZ: noseZ, pad: padAt, rows: rows,
    };
    return (_fits[key] = F);
  }

  /* ================================================================ GEOMETRY */
  const _geos = Object.create(null);
  function geometry(shapeKey, form, nose) {
    const Fi = fit(shapeKey, form, nose);
    if (!Fi) return null;
    const key = shapeKey + "|" + Fi.form + "|" + Fi.nose;
    if (_geos[key]) return _geos[key];
    const SH = SHAPES[shapeKey];
    const frame = new Acc(), lens = new Acc(), tip = new Acc(), pad = new Acc();
    const O = Fi.outline, n = O.length, Lx = Fi.Lx, Lu = Fi.Lu;
    // ---- LENS: a curved glass sheet with thickness (front + back + edge)
    {
      const th = 0.0045;
      let ca = 0, cb = 0; for (const q of O) { ca += q[0]; cb += q[1]; } ca /= n; cb /= n;
      const rings = [0.55, 1];
      const vid = [[], []], ctr = [];
      for (let side = 0; side < 2; side++) {
        const lift = side === 0 ? th : 0;
        ctr.push(lens.v(Fi.onFront(ca, cb, lift)));
        for (let r = 0; r < rings.length; r++) {
          const row = [];
          for (let k = 0; k < n; k++) row.push(lens.v(Fi.onFront(ca + (O[k][0] - ca) * rings[r], cb + (O[k][1] - cb) * rings[r], lift)));
          vid[side].push(row);
        }
        // the outline is counter-clockwise seen from the front: the front sheet faces +z, the back one -z
        const V = vid[side], f = side === 0;
        for (let k = 0; k < n; k++) { const k2 = (k + 1) % n; if (f) lens.tri(ctr[side], V[0][k], V[0][k2]); else lens.tri(ctr[side], V[0][k2], V[0][k]); }
        for (let r = 0; r < rings.length - 1; r++) for (let k = 0; k < n; k++) {
          const k2 = (k + 1) % n, a = V[r][k], b = V[r][k2], c = V[r + 1][k], d = V[r + 1][k2];
          if (f) { lens.tri(a, c, d); lens.tri(a, d, b); } else { lens.tri(a, d, c); lens.tri(a, b, d); }
        }
      }
      const Fr = vid[0][rings.length - 1], Bk = vid[1][rings.length - 1];
      for (let k = 0; k < n; k++) { const k2 = (k + 1) % n; lens.tri(Fr[k], Bk[k], Bk[k2]); lens.tri(Fr[k], Bk[k2], Fr[k2]); }
    }
    // ---- RIM: around the outline (wire / acetate), or a top bar only (wrap)
    const rimPts = [], rimOut = [];
    {
      let ca = 0, cb = 0; for (const q of O) { ca += q[0]; cb += q[1]; } ca /= n; cb /= n;
      for (let k = 0; k < n; k++) {
        const q = O[k], dA = q[0] - ca, dB = q[1] - cb, l = Math.hypot(dA, dB) || 1;
        const push = SH.rim.wire ? SH.rim.wire * 0.55 : (SH.rim.slab || SH.rim.top)[0] * 0.30;
        const a = q[0] + dA / l * push, b = q[1] + dB / l * push;
        rimPts.push(Fi.onFront(a, b, 0.002));
        rimOut.push([dA / l, dB / l]);
      }
    }
    const radialOut = (k) => { const d = rimOut[k], x = Lx + O[k][0], u = Lu + O[k][1], nn = Fi.nrm(x, u); const v = [d[0], d[1], 0]; return add3(v, nn, -dot(v, nn)); };
    if (SH.rim.wire) {
      sweep(frame, framesAlong(rimPts, true, radialOut), circleSec(SH.rim.wire, 6), true);
    } else if (SH.rim.slab) {
      const w = SH.rim.slab[0] / 2, h = SH.rim.slab[1] / 2, top = SH.rim.topHeavy || 0;
      const fr = framesAlong(rimPts, true, radialOut, (k) => 1 + top * sm((O[k][1] - 0.02) / 0.04));
      sweep(frame, fr, slabSec(w, h), true);
    } else if (SH.rim.top) {
      // half-rim: the bar runs along the top of the lens from the nose to the hinge
      const pts = [];
      for (let k = 0; k < n; k++) if (O[k][1] > 0.012) pts.push(k);
      pts.sort((p, q) => O[p][0] - O[q][0]);
      const P = pts.map((k) => Fi.onFront(O[k][0], O[k][1] + SH.rim.top[0] * 0.25, 0.002));
      sweep(frame, framesAlong(P, false, (k) => [0, 1, 0]), slabSec(SH.rim.top[1] / 2, SH.rim.top[0] / 2), false, false, true);
    }
    // ---- BRIDGE (right half; the mirror makes the other)
    const inner = (bWant) => {
      let best = 0, bd = 1e9;
      for (let k = 0; k < n; k++) if (O[k][0] < 0) { const d = Math.abs(O[k][1] - bWant) - O[k][0] * 0.01; if (d < bd) { bd = d; best = k; } }
      return best;
    };
    const arch = function (bAt, uApex, r, sec) {
      const k = inner(bAt), A = rimPts[k];
      const pts = [];
      for (let s = 0; s <= 6; s++) {
        const t = s / 6, x = lerp(0, A[0], t);
        const u = lerp(uApex, A[1], sm(t));
        const zMin = Fi.noseZ(u) + NOSE_GAP + r;
        pts.push([x, u, Math.max(Fi.zf(x, u) + 0.002, zMin)]);
      }
      sweep(frame, framesAlong(pts, false, () => [0, 1, 0]), sec, false, false, false);
    };
    if (SH.bridge === "double") {
      const r = SH.rim.wire;
      // the upper bar: straight across between the lens tops
      const kt = inner(0.052), A = rimPts[kt];
      const bar = [];
      for (let s = 0; s <= 4; s++) { const x = A[0] * s / 4, u = A[1]; bar.push([x, u, Math.max(Fi.zf(x, u) + 0.003, Fi.noseZ(u) + NOSE_GAP + r)]); }
      sweep(frame, framesAlong(bar, false, () => [0, 1, 0]), circleSec(r, 6), false);
      arch(0.022, Lu + 0.034, r, circleSec(r, 6));
    } else if (SH.bridge === "keyhole") {
      const w = (SH.rim.slab[0] / 2) * 0.8, h = SH.rim.slab[1] / 2;
      arch(0.020, Lu + 0.040, h, slabSec(h, w));
    } else if (SH.bridge === "bar") {
      const h = SH.rim.top[1] / 2, k = inner(0.04), A = rimPts[k];
      const pts = [];
      for (let s = 0; s <= 4; s++) { const x = A[0] * s / 4, u = lerp(Lu + 0.050, A[1], s / 4); pts.push([x, u, Math.max(Fi.zf(x, u) + 0.002, Fi.noseZ(u) + NOSE_GAP + h)]); }
      sweep(frame, framesAlong(pts, false, () => [0, 1, 0]), slabSec(h, SH.rim.top[0] / 2), false);
    }
    // ---- NOSE PADS on arms (wire frames)
    if (SH.pads) {
      const k = inner(-0.012), A = rimPts[k], P = Fi.pad;
      const pc = [P.x, P.u, P.z];
      const arm = [A, [lerp(A[0], pc[0], 0.5), lerp(A[1], pc[1], 0.5), Math.max(A[2], pc[2]) + 0.006], add3(pc, [1, 0, 0.3], 0.006)];
      sweep(frame, framesAlong(arm, false, () => [0, 1, 0]), circleSec(SH.rim.wire * 0.6, 5), false, false, true);
      // the pad: a flattened ellipsoid lying on the side of the nose
      const NR = 6, NS = 8, base = pad.p.length / 3;
      const nx = norm([-1, 0, 0.35]), up = [0, 1, 0], side = norm(cross(up, nx));
      for (let i = 0; i <= NR; i++) {
        const ph = -Math.PI / 2 + Math.PI * i / NR;
        for (let j = 0; j < NS; j++) {
          const t = j / NS * Math.PI * 2;
          const ea = 0.0045 * Math.cos(ph) * Math.cos(t), eb = 0.016 * Math.sin(ph), ec = 0.009 * Math.cos(ph) * Math.sin(t);
          pad.v([pc[0] + nx[0] * ea + side[0] * ec, pc[1] + eb, pc[2] + nx[2] * ea + side[2] * ec]);
        }
      }
      for (let i = 0; i < NR; i++) for (let j = 0; j < NS; j++) {
        const a = base + i * NS + j, b = base + i * NS + (j + 1) % NS, c = a + NS, d = b + NS;
        pad.tri(a, b, d); pad.tri(a, d, c);
      }
    }
    // ---- TEMPLE: endpiece + arm (+ dark tip on wire frames)
    {
      const path = Fi.temple, T = SH.temple;
      const outOf = (k, p) => { const S = Fi.S, h = S.hit([0, p[1], p[2]], [1, 0, 0]); return h.n; };
      const sec = T.wire ? circleSec(T.wire, 6) : slabSec(T.slab[0], T.slab[1]);
      if (T.wire && T.tip) {
        const cut = Math.floor(path.length * 0.62);
        sweep(frame, framesAlong(path.slice(0, cut + 1), false, outOf), sec, false, true, false);
        const tp = path.slice(cut);
        const tfr = framesAlong(tp, false, outOf, (k) => lerp(1, T.tip, sm(k / 2)));
        // keep the thicker tip off the skin: pull each station out by the extra radius
        for (let k = 0; k < tfr.length; k++) tfr[k].p = add3(tfr[k].p, tfr[k].a, T.wire * (tfr[k].s - 1));
        sweep(tip, tfr, sec, false, false, true);
      } else {
        sweep(frame, framesAlong(path, false, outOf), sec, false, true, true);
      }
    }
    // ---- mirror to the left side; tortoise mottling
    for (const A of [frame, lens, tip, pad]) A.mirror();
    if (SH.tortoise) {
      const P = frame.p, C = [];
      for (let i = 0; i < P.length; i += 3) {
        const x = P[i], y = P[i + 1], z = P[i + 2];
        const nz = Math.sin(x * 97 + y * 41) * Math.sin(y * 113 - z * 57) + 0.5 * Math.sin((x + z) * 211 + y * 23);
        const k = sm((nz + 0.6) / 1.4);
        C.push(lerp(0.11, 0.42, k), lerp(0.045, 0.20, k), lerp(0.02, 0.05, k));
      }
      frame.c = C;
    }
    // ---- bake: groups 0 frame, 1 lens, 2 tip, 3 pad
    const parts = [frame, lens, tip, pad];
    let nv = 0, ni = 0;
    for (const A of parts) { nv += A.p.length; ni += A.i.length; }
    const pos = new Float32Array(nv), idx = (nv / 3 > 65535 ? new Uint32Array(ni) : new Uint16Array(ni));
    const col = SH.tortoise ? new Float32Array(nv) : null;
    const g = new THREE.BufferGeometry();
    let vo = 0, io = 0;
    for (let pi = 0; pi < parts.length; pi++) {
      const A = parts[pi], b = vo / 3;
      pos.set(A.p, vo);
      if (col) { if (A.c) col.set(A.c, vo); else for (let i = 0; i < A.p.length; i++) col[vo + i] = 1; }
      for (let i = 0; i < A.i.length; i++) idx[io + i] = A.i[i] + b;
      if (A.i.length) g.addGroup(io, A.i.length, pi);
      vo += A.p.length; io += A.i.length;
    }
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    if (col) g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    g._shared = true;
    g.userData = { eyewear: shapeKey };
    return (_geos[key] = g);
  }

  /* ================================================================ MATERIALS */
  const FIN = {
    smoke: { color: 0x14171b, metalness: 0.25, roughness: 0.05, env: 1.8 },
    g15: { color: 0x1c2a1f, metalness: 0.25, roughness: 0.05, env: 1.8 },
    mirror: { color: 0x5d82b8, metalness: 0.92, roughness: 0.07, env: 1.3 },
    amber: { color: 0x4a2a0c, metalness: 0.18, roughness: 0.06, env: 1.6 },
    sportMirror: { color: 0x2f8f94, metalness: 0.88, roughness: 0.08, env: 1.3 },
    acetate: { color: 0x0b0b0d, metalness: 0.0, roughness: 0.22, env: 1.0 },
    matte: { color: 0x121316, metalness: 0.0, roughness: 0.55, env: 0.5 },
    tortoise: { color: 0xffffff, metalness: 0.0, roughness: 0.24, env: 1.0, vertexColors: true },
    tip: { color: 0x1d1a18, metalness: 0.0, roughness: 0.35, env: 0.6 },
    pad: { color: 0xcfc9bb, metalness: 0.0, roughness: 0.3, env: 0.8 },
  };
  const _mats = Object.create(null);
  function finish(name) {
    if (_mats[name]) return _mats[name];
    let m;
    if (name === "gold" && CBZ.jewel && CBZ.jewel.mat) m = CBZ.jewel.mat("gold");
    else {
      const f = FIN[name] || (name === "gold" ? { color: 0xd8b25a, metalness: 1, roughness: 0.22, env: 1.2 } : FIN.acetate);
      const env = CBZ.jewel && CBZ.jewel.env ? CBZ.jewel.env() : null;
      m = new THREE.MeshStandardMaterial({ color: f.color, metalness: f.metalness, roughness: f.roughness, vertexColors: !!f.vertexColors });
      if (env) m.envMap = env;
      m.envMapIntensity = f.env;
      m._shared = true;
      m.name = "eyewear-" + name;
      if (CBZ.jewel && CBZ.jewel.adopt) CBZ.jewel.adopt(m);
    }
    return (_mats[name] = m);
  }
  function materials(style) {
    const st = STYLES[style] || STYLES.wayfarer;
    const fr = finish(st.frame);
    return [fr, finish(st.lens), st.tip ? finish(st.tip) : fr, st.pad ? finish(st.pad) : fr];
  }

  /* ================================================================ MOUNT */
  function make(rig, style) {
    const st = STYLES[style] ? style : styleFor(style);
    if (!st || !rig || typeof CBZ.charHeadSurface !== "function") return null;
    const S = CBZ.charHeadSurface(rig);
    if (!S) return null;
    const geo = geometry(STYLES[st].shape, S.form, S.nose);
    if (!geo) return null;
    const m = new THREE.Mesh(geo, materials(st));
    m.scale.setScalar(S.hk || 1);
    m.name = "eyewear";
    m.castShadow = false; m.receiveShadow = false;
    m.userData.eyewear = st;
    m.userData.clothingPart = "eyewear";
    m.userData.pedInstSkip = true;
    return m;
  }

  CBZ.eyewear = {
    version: 1,
    STYLES: STYLES, SHAPES: SHAPES,
    styleFor: styleFor, make: make, geometry: geometry, materials: materials, fit: fit,
    GAP: { temple: TEMPLE_GAP, lens: LENS_GAP, ear: EAR_GAP, nose: NOSE_GAP },
  };
})();
