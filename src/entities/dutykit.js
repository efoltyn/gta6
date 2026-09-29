/* ============================================================
   entities/dutykit.js — CBZ.dutyKit: THE ONE OWNER OF POLICE KIT.

   Owner: "put one on cop uniforms. There's a weird mix of geometric and
   paint right now, and it was made for the old body type." What an officer
   wore was a painted duty jacket (an open box shell with a lighter shirt
   showing through it like a sports coat), a painted gold badge with a 16 cm
   gold CUBE stuck on the other side of the chest, a painted "holster block"
   rectangle, a painted radio rectangle, and — from entities/handcuffs.js — a
   real cuff case hung on the same rig by a separate roster sweep. Three
   systems, four ways of drawing one belt.

   NOW: the uniform SHIRT is paint (city/clothes.js: seams, pockets, flaps,
   placket, name tape, patch — cloth on the shaped torso), and everything HARD
   an officer carries is fitted geometry, here, in ONE merged mesh:

     • the DUTY BELT — a band that follows this body's real waist/pelvis
       section (entities/character.js torsoShape: the column and the pelvis
       rings, the belly and seat relief), stitched edges, buckle, keepers;
     • the HOLSTER with the pistol grip on the strong (right, -x) hip, butt
       to the rear (a taser holster, yellow grip, on a corrections officer —
       a CO inside the walls carries no firearm); a detective's pancake;
     • magazine pouch, RADIO with antenna, TORCH in its belt ring (hidden
       while a guard's torch is in his hand), the CUFF CASE (the case that
       used to be handcuffs.js's — it lives here now), a CO's key ring;
     • EPAULETTE straps laid along each shoulder crest, buttoned at the
       collar, their outer ends tucked under the sleeve head;
     • the BADGE: a thin metal shield (a six-point star for a sheriff) with an
       enamel seal, pinned ON the chest surface above the left pocket flap and
       tilted to the surface normal — so on a woman it sits on the upper slope
       of the bust, not in front of a box — or clipped to a detective's belt;
     • a shoulder MIC on the left front of the chest.

   ONE mesh per rig, vertex coloured, one shared Phong material; the geometry
   is cached per (body shape key, kit kind, shirt colour, gun, torch), so every
   average-man patrolman in the city shares ONE buffer — and, since the
   material draws its vertex colours (white base), entities/pedinstance.js
   pools it like any body part: every officer wearing the same cached kit is
   ONE instanced draw, not one draw each. castShadow off, no lights.

   API
     CBZ.dutyKit.wear(ch, rec)   dress/strip: rec.duty names the kit
                                 ("police" | "corrections" | "sheriff" |
                                 "security" | "swat" | "detective"); anything
                                 else strips it. city/outfits.js recolorRig
                                 calls it for every dress, so a corpse swap or
                                 a re-dress takes the belt with the shirt.
     CBZ.dutyKit.geometry(ch, kind, opts)   the cached kit geometry
     CBZ.dutyKit.material()      the shared material
     CBZ.dutyKit.CASE            the cuff case's real size (metres)
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  if (CBZ.dutyKit && CBZ.dutyKit.version) return;

  // ---- colours ------------------------------------------------------------
  const SILVER = 0xc4cad3, GOLD = 0xd3ae4a, NICKEL = 0xb6bdc6, GUNMETAL = 0x3c4046;
  const GRIP = 0x2b2d32, TASER = 0xd8b21e, RADIO = 0x1c1e22, AERIAL = 0x0e0f11, TORCH = 0x18191c;
  const ENAMEL = 0x1c2a4f;

  /* Each kind: belt colour + height (m), buckle metal, badge (shape + metal,
     on the chest or on the belt), and what hangs where. Angles in degrees
     round the waist from the front, +x = the wearer's LEFT (the rig faces +z,
     its right arm is at -x), so the gun side is negative. */
  const KINDS = {
    police: {
      belt: 0x111316, beltH: 0.057, buckle: SILVER, badge: { shape: "shield", metal: SILVER, enamel: ENAMEL },
      gun: "pistol", gunAt: -124, mags: [120], torch: 148, radio: 134, cuffs: 164, keepers: [180, -160, -145], straps: 1, mic: 1,
    },
    corrections: {
      belt: 0x111316, beltH: 0.057, buckle: SILVER, badge: { shape: "shield", metal: GOLD, enamel: 0x2a3b2c },
      gun: "taser", gunAt: -124, keys: -150, torch: 120, radio: 136, cuffs: 160, keepers: [180, -168, -138], straps: 1, mic: 1,
    },
    sheriff: {
      belt: 0x3a2617, beltH: 0.057, buckle: GOLD, badge: { shape: "star", metal: GOLD },
      gun: "pistol", gunAt: -124, mags: [120], torch: 148, radio: 134, cuffs: 164, keepers: [180, -160, -145], straps: 1, mic: 1,
    },
    security: {
      belt: 0x121417, beltH: 0.05, buckle: SILVER, badge: { shape: "shield", metal: SILVER, enamel: 0x2a2d33 },
      torch: 120, radio: 136, cuffs: 160, keepers: [180, -160, -145], straps: 1,
    },
    swat: {
      belt: 0x1b1e19, beltH: 0.06, buckle: GUNMETAL,
      gun: "pistol", gunAt: -124, mags: [120, 138], cuffs: 160, keepers: [180, -160, -145],
    },
    detective: {
      belt: 0x2a1c12, beltH: 0.034, buckle: SILVER, beltBadge: { shape: "shield", metal: GOLD, enamel: ENAMEL, at: 11 },
      gun: "pancake", gunAt: -122, keepers: [],
    },
  };

  let _mat = null;
  function material() {
    if (_mat) return _mat;
    // gloss leather and polished metal both want a small highlight; one Phong
    // with vertex colours carries both at the cost of one material
    _mat = new THREE.MeshPhongMaterial({ color: 0xffffff, vertexColors: true, specular: 0x2e2e2e, shininess: 36 });
    _mat._shared = true;
    _mat.name = "duty-kit";
    return _mat;
  }

  // ---- a small mesh builder (positions / normals / colours / index) --------
  function Builder() { this.p = []; this.n = []; this.c = []; this.i = []; }
  Builder.prototype.v = function (p, n, hex) {
    this.p.push(p[0], p[1], p[2]);
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    this.n.push(n[0] / l, n[1] / l, n[2] / l);
    this.c.push(((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255);
    return this.p.length / 3 - 1;
  };
  Builder.prototype.t = function (a, b, c) { this.i.push(a, b, c); };
  Builder.prototype.q = function (a, b, c, d) { this.i.push(a, b, c, a, c, d); };
  // every triangle is turned to face the way its vertex normals point, so no
  // caller can get a winding wrong
  Builder.prototype.geometry = function () {
    const P = this.p, N = this.n, I = this.i;
    for (let k = 0; k < I.length; k += 3) {
      const a = I[k] * 3, b = I[k + 1] * 3, c = I[k + 2] * 3;
      const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
      const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
      const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
      const d = fx * (N[a] + N[b] + N[c]) + fy * (N[a + 1] + N[b + 1] + N[c + 1]) + fz * (N[a + 2] + N[b + 2] + N[c + 2]);
      if (d < 0) { const s = I[k + 1]; I[k + 1] = I[k + 2]; I[k + 2] = s; }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(P), 3));
    g.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(N), 3));
    g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(this.c), 3));
    const nv = P.length / 3;
    g.setIndex(new THREE.BufferAttribute(nv > 65535 ? new Uint32Array(I) : new Uint16Array(I), 1));
    g.computeBoundingSphere(); g.computeBoundingBox();
    g._shared = true;
    return g;
  };
  // vector helpers on plain arrays
  const add = (a, b, k) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
  const neg = (a) => [-a[0], -a[1], -a[2]];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  // a frame: origin o, t (right), u (up), n (out); t x u = n
  function frame(o, n, up) {
    n = norm(n);
    let u = norm(add(up || [0, 1, 0], n, -((up || [0, 1, 0])[0] * n[0] + (up || [0, 1, 0])[1] * n[1] + (up || [0, 1, 0])[2] * n[2])));
    const t = cross(u, n);
    return { o, t, u, n };
  }
  function at(F, a, b, c) { return add(add(add(F.o, F.t, a), F.u, b), F.n, c); }
  // rotate the frame's t/u about n round the point at height y on its axis (a
  // positive angle leans u toward -t); positions in it are relative to y
  function lean(F, ang, y) {
    const c = Math.cos(ang), s = Math.sin(ang);
    return { o: add(F.o, F.u, y), n: F.n, t: add(F.t.map((x) => x * c), F.u, s), u: add(F.u.map((x) => x * c), F.t, -s) };
  }
  // a box in frame F: centre (a,b,c), size w (t) x h (u) x d (n)
  function box(B, F, a, b, c, w, h, d, hex) {
    const C = at(F, a, b, c), hw = w / 2, hh = h / 2, hd = d / 2;
    const faces = [[F.n, F.t, F.u, hd, hw, hh], [neg(F.n), F.t, F.u, hd, hw, hh], [F.t, F.u, F.n, hw, hh, hd],
      [neg(F.t), F.u, F.n, hw, hh, hd], [F.u, F.t, F.n, hh, hw, hd], [neg(F.u), F.t, F.n, hh, hw, hd]];
    for (const f of faces) {
      const N = f[0], A = f[1], Bv = f[2], o = add(C, N, f[3]);
      const i0 = B.v(add(add(o, A, -f[4]), Bv, -f[5]), N, hex), i1 = B.v(add(add(o, A, f[4]), Bv, -f[5]), N, hex);
      const i2 = B.v(add(add(o, A, f[4]), Bv, f[5]), N, hex), i3 = B.v(add(add(o, A, -f[4]), Bv, f[5]), N, hex);
      B.q(i0, i1, i2, i3);
    }
  }
  // a cylinder along F.u, centre (a, c) in the t/n plane, from b0 to b1
  function cyl(B, F, a, c, b0, b1, r, hex, seg) {
    seg = seg || 8;
    const ring = [];
    for (let k = 0; k <= seg; k++) {
      const ang = k / seg * Math.PI * 2, ca = Math.cos(ang), sa = Math.sin(ang);
      const dir = add(F.t.map((x) => x * ca), F.n, sa);
      ring.push([B.v(add(at(F, a, b0, c), dir, r), dir, hex), B.v(add(at(F, a, b1, c), dir, r), dir, hex)]);
    }
    for (let k = 0; k < seg; k++) B.q(ring[k][0], ring[k + 1][0], ring[k + 1][1], ring[k][1]);
    const top = B.v(at(F, a, b1, c), F.u, hex), bot = B.v(at(F, a, b0, c), neg(F.u), hex);
    const tr = [], br = [];
    for (let k = 0; k <= seg; k++) {
      const ang = k / seg * Math.PI * 2, dir = add(F.t.map((x) => x * Math.cos(ang)), F.n, Math.sin(ang));
      tr.push(B.v(add(at(F, a, b1, c), dir, r), F.u, hex)); br.push(B.v(add(at(F, a, b0, c), dir, r), neg(F.u), hex));
    }
    for (let k = 0; k < seg; k++) { B.t(top, tr[k], tr[k + 1]); B.t(bot, br[k + 1], br[k]); }
  }
  // a flat prism from a CCW polygon (frame-local t/u), back at c0, depth d
  function prism(B, F, pts, c0, d, hex) {
    const front = [], back = [];
    const cf = B.v(at(F, 0, 0, c0 + d), F.n, hex), cb = B.v(at(F, 0, 0, c0), neg(F.n), hex);
    for (const p of pts) { front.push(B.v(at(F, p[0], p[1], c0 + d), F.n, hex)); back.push(B.v(at(F, p[0], p[1], c0), neg(F.n), hex)); }
    const m = pts.length;
    for (let k = 0; k < m; k++) {
      const j = (k + 1) % m;
      B.t(cf, front[k], front[j]); B.t(cb, back[j], back[k]);
      const e = [pts[j][0] - pts[k][0], pts[j][1] - pts[k][1]];
      const on = norm(add(F.t.map((x) => x * e[1]), F.u, -e[0]));
      B.q(B.v(at(F, pts[k][0], pts[k][1], c0), on, hex), B.v(at(F, pts[j][0], pts[j][1], c0), on, hex),
        B.v(at(F, pts[j][0], pts[j][1], c0 + d), on, hex), B.v(at(F, pts[k][0], pts[k][1], c0 + d), on, hex));
    }
  }
  // badge outlines, CCW, unit height ~1.2 (shield) / 1.0 (star)
  const SHIELD = [[0, 0.62], [-0.26, 0.5], [-0.5, 0.58], [-0.5, 0.12], [-0.34, -0.32], [0, -0.62], [0.34, -0.32], [0.5, 0.12], [0.5, 0.58], [0.26, 0.5]];
  function starPts(n, ro, ri) {
    const out = [];
    for (let k = 0; k < n * 2; k++) { const r = k & 1 ? ri : ro, a = Math.PI / 2 + k * Math.PI / n; out.push([Math.cos(a) * r, Math.sin(a) * r]); }
    return out;
  }
  const STAR = starPts(6, 0.5, 0.29), SEAL = starPts(4, 0.2, 0.2);   // (an octagon: a 4-star with equal radii)
  function badge(B, F, spec, m, c0) {
    const shield = spec.shape !== "star";
    const w = (shield ? 0.052 : 0.062) * m, sc = shield ? w : 0.062 * m;
    const pts = (shield ? SHIELD : STAR).map((p) => [p[0] * sc, p[1] * sc]);
    prism(B, F, pts, c0, 0.0028 * m, spec.metal);
    const seal = SEAL.map((p) => [p[0] * sc * (shield ? 1.1 : 0.9), p[1] * sc * (shield ? 1.1 : 0.9) - (shield ? 0.04 * sc : 0)]);
    prism(B, F, seal, c0 + 0.0028 * m, 0.0012 * m, spec.enamel != null ? spec.enamel : spec.metal);
  }

  // ---- the body's real section --------------------------------------------
  const gss = (x, s) => Math.exp(-(x / s) * (x / s));
  // radius of a superellipse ring {a, zf, zb, zc, n} along direction (dx, dz)
  function ringRay(R, dx, dz) {
    const b = dz >= 0 ? R.zf : R.zb, n = R.n || 2.5;
    const t = Math.pow(Math.pow(Math.abs(dx / R.a), n) + Math.pow(Math.abs(dz / b), n), -1 / n);
    return [t * dx, (R.zc || 0) + t * dz];
  }
  /* The body's outline at height y: 48 points round the waist from the
     front, the outermost of the chest column (with its own front/back relief
     read off rig.torsoFrontZ/BackZ), the pelvis (with belly and seat) and,
     below the hips, the two thighs. Model units. */
  const NS = 48;
  function outline(ch, y) {
    const S = ch.torsoShape, P = ch.profile, out = [];
    for (let j = 0; j < NS; j++) {
      const th = j / NS * Math.PI * 2, dx = Math.sin(th), dz = Math.cos(th);
      let best = 0, bx = 0, bz = 0;
      const take = (x, z) => { const r = Math.hypot(x, z); if (r > best) { best = r; bx = x; bz = z; } };
      if (y >= S.base - 0.01 && y <= S.yN) {
        const p = ringRay(S.at(y), dx, dz);
        let z = p[1];
        if (dz > 0.05 && ch.torsoFrontZ) z = Math.max(z, ch.torsoFrontZ(p[0], y));
        else if (dz < -0.05 && ch.torsoBackZ) z = Math.min(z, ch.torsoBackZ(p[0], y));
        take(p[0], z);
      }
      if (y >= S.pBot && y <= S.pTop + 0.005) {
        const p = ringRay(S.pel(Math.min(y, S.pTop)), dx, dz);
        let z = p[1];
        if (dz < 0) z -= (S.glute || 0) * 0.16 * S.pd * gss(y - (S.hipY - 0.015 * S.pk), 0.055 * S.pk) * Math.pow(-dz, 0.8);
        else z += (S.belly || 0) * 0.05 * S.pd * gss(y - (S.pTop - 0.03 * S.pk), 0.05 * S.pk) * Math.pow(dz, 0.8);
        take(p[0], z);
      }
      if (y < S.hipY + 0.02 && P) {
        // the thighs: a circle round each hip joint (their outer extent does
        // not move when a leg swings — the swing is fore and aft)
        const r = P.legW / 2 + 0.01;
        for (const sx of [-1, 1]) {
          const cx = sx * P.hipX, px = cx * dx;                 // ray-circle, far root
          const disc = px * px - (cx * cx - r * r);
          if (disc >= 0) { const t = px + Math.sqrt(disc); if (t > 0) take(t * dx, t * dz); }
        }
      }
      out.push([bx, bz]);
    }
    return out;
  }
  // the outermost outline over [y0, y1]
  function span(ch, y0, y1, steps) {
    steps = steps || 4;
    let acc = null;
    for (let s = 0; s <= steps; s++) {
      const o = outline(ch, y0 + (y1 - y0) * s / steps);
      if (!acc) { acc = o; continue; }
      for (let j = 0; j < NS; j++) if (Math.hypot(o[j][0], o[j][1]) > Math.hypot(acc[j][0], acc[j][1])) acc[j] = o[j];
    }
    return acc;
  }
  function samplesAt(list, th) {                             // outline point at any angle
    const f = ((th / (Math.PI * 2)) % 1 + 1) % 1 * NS, j = Math.floor(f) % NS, k = (j + 1) % NS, w = f - Math.floor(f);
    return [list[j][0] * (1 - w) + list[k][0] * w, list[j][1] * (1 - w) + list[k][1] * w];
  }
  function outNormal(list, th) {
    const a = samplesAt(list, th - 0.06), b = samplesAt(list, th + 0.06);
    let nx = b[1] - a[1], nz = -(b[0] - a[0]);
    const p = samplesAt(list, th);
    if (nx * p[0] + nz * p[1] < 0) { nx = -nx; nz = -nz; }
    const l = Math.hypot(nx, nz) || 1;
    return [nx / l, 0, nz / l];
  }
  /* A frame for something hung at angle th over the height [y0, y1]: n is the
     real section's outward normal there, and the frame's origin is pushed out
     until the item's whole back face (width w) clears every outline given. */
  function hangFrame(th, y0, y1, w, outlines, clr) {
    const base = outlines[0];
    const p = samplesAt(base, th), n = outNormal(base, th);
    const F = frame([p[0], 0, p[1]], n);
    let s = 0;
    for (const ol of outlines) {
      if (!ol) continue;
      for (let j = 0; j < NS; j++) {
        const q = ol[j], dx = q[0] - p[0], dz = q[1] - p[1];
        if (Math.abs(dx * F.t[0] + dz * F.t[2]) > w / 2 + 0.01) continue;
        const dn = dx * n[0] + dz * n[2];
        if (dn > s) s = dn;
      }
    }
    F.o = [p[0] + n[0] * (s + clr), 0, p[1] + n[2] * (s + clr)];
    return F;
  }

  // ---- the kit geometry ------------------------------------------------------
  const GEO = Object.create(null);
  function scaleOf(ch) {
    const g = ch && ch.group, hs = g && g.userData && g.userData.humanScale;
    return hs > 0 ? hs : ((ch && ch.model && ch.model.scale && ch.model.scale.x) || 0.7);
  }
  function tone(hex, k) {
    let r = (hex >> 16) & 255, g = (hex >> 8) & 255, b = hex & 255;
    if (k > 0) { r += (255 - r) * k; g += (255 - g) * k; b += (255 - b) * k; } else { r *= 1 + k; g *= 1 + k; b *= 1 + k; }
    return ((r | 0) << 16) | ((g | 0) << 8) | (b | 0);
  }
  function geometry(ch, kind, opts) {
    const K = KINDS[kind], S = ch && ch.torsoShape, P = ch && ch.profile;
    if (!K || !S || !P || !S.at || !S.pel) return null;
    opts = opts || {};
    const m = 1 / scaleOf(ch);                                // metres -> model units
    const gun = opts.noGun ? null : K.gun, torch = K.torch != null && !opts.torchOut;
    const shirt = opts.shirt != null ? opts.shirt | 0 : 0x24407a;
    const collar = ch.skinSlots && ch.skinSlots.collar && ch.skinSlots.collar[0];
    const cw = collar && collar.geometry && collar.geometry.parameters ? collar.geometry.parameters.width / 2 : S.nRx + 0.05;
    const key = S.key + "|" + kind + "|" + (gun || "-") + "|" + (torch ? 1 : 0) + "|" + (K.straps ? shirt : 0) + "|" + m.toFixed(4) + "|" + cw.toFixed(3);
    if (GEO[key]) return GEO[key];
    const B = new Builder();
    const clr = 0.003 * m;
    // ---- THE BELT: the trousers' waistband is the pelvis top, and the belt
    // covers the shirt's tuck line there
    const bh = K.beltH * m, top = S.pTop + 0.005 * m, bot = top - bh, tB = 0.0045 * m;
    // the belt is cinched: ~1 mm off the shirt, so a seated thigh rising into
    // the crease meets it where it meets the body, not a centimetre proud
    const bclr = 0.0009 * m;
    // the body's outline at one height, held bclr off it, with the small dips
    // a soft section has bridged (a belt is stiff)
    const ringAt = (y) => {
      const r0 = span(ch, y - 0.002 * m, y + 0.002 * m, 1).map((p) => { const r = Math.hypot(p[0], p[1]) || 1; return [p[0] * (r + bclr) / r, p[1] * (r + bclr) / r]; });
      for (let j = 0; j < NS; j++) {
        const a = r0[(j + NS - 1) % NS], b = r0[j], c = r0[(j + 1) % NS];
        const ra = Math.hypot(a[0], a[1]), rb = Math.hypot(b[0], b[1]), rc = Math.hypot(c[0], c[1]);
        const want = (ra + rb + rc) / 3;
        if (want > rb) r0[j] = [b[0] * want / rb, b[1] * want / rb];
      }
      return r0;
    };
    /* THE BELT IS A CONE, NOT A CYLINDER: it follows the section at its top
       AND at its bottom (a belly slopes in toward the waistband, the pelvis
       flares out), so no part of it stands off the body. Held to the widest
       section over its height, a heavy man's belt stood 3 cm proud of his
       waistband under the belly. */
    const inB = ringAt(bot), inM = ringAt((bot + top) / 2), inT = ringAt(top);
    const inAt = (j, y) => {
      const k = Math.min(1, Math.max(0, (y - bot) / (top - bot))), jj = j % NS;
      const A = k < 0.5 ? inB[jj] : inM[jj], C = k < 0.5 ? inM[jj] : inT[jj], w = k < 0.5 ? k * 2 : k * 2 - 1;
      return [A[0] + (C[0] - A[0]) * w, A[1] + (C[1] - A[1]) * w];
    };
    // thinnest across the front, where a seated thigh comes up into the crease
    const tAt = (j) => { const a = Math.abs((((j / NS) * 360 + 180) % 360) - 180); return tB * (0.62 + 0.38 * Math.min(1, Math.max(0, (a - 45) / 45))); };
    // the belt's outer face at mid height, for everything hung on it; every
    // outline the hanging kit clears is the widest over the belt's height
    const outer = span(ch, bot, top).map((p, j) => { const r = Math.hypot(p[0], p[1]) || 1, t = bclr + tAt(j); return [p[0] * (r + t) / r, p[1] * (r + t) / r]; });
    const stitch = tone(K.belt, 0.22), edge = tone(K.belt, 0.08);
    /* THE BELT RIDES UP OVER THE FRONT OF THE HIPS: its lower edge lifts from
       beside the buckle round to the side (the thigh crease), the way a belt sits
       on a pelvis, so a thigh flexed to sit swings up under it instead of
       through it (tools/overlap-audit.mjs: seated thigh vs belt). */
    const lift = (j) => {
      const a = Math.abs((((j / NS) * 360 + 180) % 360) - 180);
      const s = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
      return Math.min(bh * 0.4, 0.021 * m) * s(8, 24, a) * (1 - s(100, 122, a));
    };
    // rows: [height above bot, colour, lifts with the lower edge, how far out
    // (0 = on the body, 1 = full thickness), edge tilt]. The edges are ROUNDED
    // back to the body: a leather belt's edge is a rolled, burnished curve,
    // and a square lip standing proud is what a seated thigh would catch.
    const rows = [[0, edge, 1, 0.2, -1], [0.004 * m, stitch, 1, 0.85, 0], [0.007 * m, K.belt, 1, 1, 0],
      [top - bot - 0.007 * m, K.belt, 0, 1, 0], [top - bot - 0.004 * m, stitch, 0, 0.85, 0], [top - bot, edge, 0, 0.2, 1]];
    const cols = [];
    for (let j = 0; j <= NS; j++) {
      const n = outNormal(inM, j / NS * Math.PI * 2), l = lift(j), t = tAt(j % NS);
      cols.push(rows.map((r) => {
        const y = bot + r[0] + (r[2] ? l : 0), a = inAt(j, y);
        return B.v([a[0] + n[0] * t * r[3], y, a[1] + n[2] * t * r[3]], r[4] ? [n[0], r[4] * 1.2, n[2]] : n, r[1]);
      }));
    }
    for (let j = 0; j < NS; j++) for (let r = 0; r < rows.length - 1; r++) B.q(cols[j][r], cols[j + 1][r], cols[j + 1][r + 1], cols[j][r + 1]);
    for (const [y, up] of [[top, 1], [bot, -1]]) {                // the lips back to the body
      const ring = [];
      for (let j = 0; j <= NS; j++) {
        const yy = up < 0 ? y + lift(j) : y, a = inAt(j, yy), n = outNormal(inM, j / NS * Math.PI * 2), t = tAt(j % NS) * 0.2;
        ring.push([B.v([a[0], yy, a[1]], [0, up, 0], edge), B.v([a[0] + n[0] * t, yy, a[1] + n[2] * t], [0, up, 0], edge)]);
      }
      for (let j = 0; j < NS; j++) B.q(ring[j][0], ring[j + 1][0], ring[j + 1][1], ring[j][1]);
    }
    const rad = (d) => d * Math.PI / 180;
    const beltF = (deg) => {                                    // a frame ON the belt's outer face
      const th = rad(deg), p = samplesAt(outer, th);
      return frame([p[0], 0, p[1]], outNormal(outer, th));
    };
    const ym = (bot + top) / 2;
    // buckle + keepers
    const bF = beltF(0);
    box(B, bF, 0, ym, 0.003 * m, (K.beltH > 0.04 ? 0.062 : 0.045) * m, bh * 0.82, 0.006 * m, K.buckle);
    for (const d of K.keepers) {
      const F = beltF(d);
      box(B, F, 0, ym, 0.003 * m, 0.02 * m, bh, 0.006 * m, K.belt);
      box(B, F, -0.005 * m, ym + bh * 0.2, 0.0065 * m, 0.006 * m, 0.006 * m, 0.0018 * m, NICKEL);
      box(B, F, -0.005 * m, ym - bh * 0.2, 0.0065 * m, 0.006 * m, 0.006 * m, 0.0018 * m, NICKEL);
    }
    // outlines the hanging kit must clear (body below the belt, and the belt)
    const lowBody = span(ch, top - 0.30 * m, top, 6);
    const hang = (deg, h, w) => hangFrame(rad(deg), top - h, top, w, [outer, lowBody], clr);
    // ---- THE GUN SIDE (-x, the wearer's right): holster, grip butt to the rear
    if (gun) {
      const F = hang(K.gunAt, 0.24 * m, 0.10 * m);
      const L = K.belt;
      if (gun === "pistol") {
        box(B, F, 0.004 * m, top + 0.012 * m - 0.045 * m, 0.025 * m, 0.092 * m, 0.09 * m, 0.05 * m, L);   // trigger-guard body
        box(B, F, 0.02 * m, top - 0.078 * m - 0.06 * m, 0.021 * m, 0.048 * m, 0.12 * m, 0.042 * m, L);    // slide / barrel
        box(B, F, 0.004 * m, top + 0.012 * m, 0.028 * m, 0.05 * m, 0.012 * m, 0.054 * m, tone(L, 0.12)); // welt at the mouth
        const G = lean(F, 0.34, top + 0.006 * m);
        box(B, G, -0.018 * m, 0.036 * m, 0.025 * m, 0.032 * m, 0.095 * m, 0.03 * m, GRIP);           // the pistol grip
        box(B, G, -0.018 * m, 0.064 * m, 0.025 * m, 0.036 * m, 0.012 * m, 0.036 * m, L);              // retention strap
      } else if (gun === "taser") {
        box(B, F, 0.006 * m, top - 0.055 * m, 0.024 * m, 0.075 * m, 0.13 * m, 0.048 * m, L);
        const G = lean(F, 0.3, top);
        box(B, G, -0.014 * m, 0.03 * m, 0.024 * m, 0.03 * m, 0.07 * m, 0.03 * m, TASER);
      } else {                                                 // a detective's pancake, high and tight
        const Fp = hang(K.gunAt, 0.12 * m, 0.09 * m);
        box(B, Fp, 0.006 * m, top - 0.045 * m, 0.018 * m, 0.088 * m, 0.11 * m, 0.036 * m, tone(L, 0.05));
        const G = lean(Fp, 0.36, top);
        box(B, G, -0.016 * m, 0.035 * m, 0.02 * m, 0.03 * m, 0.085 * m, 0.028 * m, GRIP);
      }
    }
    // ---- magazine pouches (double, flapped) on the support side
    for (const d of (K.mags || [])) {
      const F = hang(d, 0.085 * m, 0.08 * m);
      for (const s of [-1, 1]) {
        const a = s * 0.019 * m;
        box(B, F, a, top + 0.012 * m - 0.0425 * m, 0.015 * m, 0.034 * m, 0.085 * m, 0.03 * m, K.belt);
        box(B, F, a, top + 0.0 * m, 0.017 * m, 0.036 * m, 0.024 * m, 0.034 * m, tone(K.belt, 0.06));
        box(B, F, a, top - 0.006 * m, 0.0345 * m, 0.007 * m, 0.007 * m, 0.002 * m, NICKEL);
      }
    }
    // ---- the torch in its ring (hidden while it is in his hand)
    if (K.torch != null) {
      const F = hang(K.torch, 0.2 * m, 0.045 * m);
      box(B, F, 0, top - 0.01 * m, 0.012 * m, 0.036 * m, 0.03 * m, 0.024 * m, K.belt);   // the ring holder
      if (torch) {
        const c = 0.036 * m;
        cyl(B, F, 0, c, top - 0.012 * m, top + 0.032 * m, 0.019 * m, TORCH, 10);       // head, above the ring
        cyl(B, F, 0, c, top + 0.032 * m, top + 0.036 * m, 0.017 * m, NICKEL, 10);      // bezel
        cyl(B, F, 0, c, top - 0.18 * m, top - 0.012 * m, 0.0135 * m, TORCH, 8);        // body through the ring
      }
    }
    // ---- the radio on the belt (antenna up, clipped on)
    if (K.radio != null) {
      const F = hang(K.radio, 0.075 * m, 0.06 * m);
      box(B, F, 0, top + 0.045 * m - 0.06 * m, 0.017 * m, 0.058 * m, 0.12 * m, 0.034 * m, RADIO);
      box(B, F, 0, top + 0.035 * m - 0.06 * m, 0.0345 * m, 0.046 * m, 0.05 * m, 0.002 * m, tone(RADIO, 0.18));   // speaker grille
      cyl(B, F, -0.016 * m, 0.02 * m, top + 0.045 * m, top + 0.11 * m, 0.0055 * m, AERIAL, 6);
      cyl(B, F, 0.014 * m, 0.02 * m, top + 0.045 * m, top + 0.058 * m, 0.0075 * m, AERIAL, 6);
    }
    // ---- the cuff case: a closed black case, flap and snap (9.5 x 7.5 x 4 cm)
    if (K.cuffs != null) {
      const F = hang(K.cuffs, 0.1 * m, 0.08 * m);
      box(B, F, 0, top + 0.01 * m - 0.044 * m, 0.018 * m, CASE.w * m, CASE.h * m, CASE.d * m, 0x131518);
      box(B, F, 0, top + 0.01 * m - 0.012 * m, 0.02 * m, CASE.w * m + 0.004 * m, 0.03 * m, CASE.d * m + 0.004 * m, 0x16181c);
      box(B, F, 0, top + 0.01 * m - 0.022 * m, 0.0415 * m, 0.011 * m, 0.011 * m, 0.003 * m, NICKEL);
    }
    // ---- a CO's key ring on the right front
    if (K.keys != null) {
      const F = hang(K.keys, 0.08 * m, 0.04 * m);
      box(B, F, 0, top - 0.004 * m, 0.006 * m, 0.014 * m, 0.03 * m, 0.008 * m, NICKEL);            // the clip
      for (let k = 0; k < 4; k++) {
        const G = lean(F, (k - 1.5) * 0.22, top - 0.016 * m);
        box(B, G, (k - 1.5) * 0.005 * m, -0.026 * m, 0.012 * m + k * 0.002 * m, 0.009 * m, 0.048 * m, 0.0022 * m, k & 1 ? NICKEL : 0xb49a52);
      }
    }
    // ---- the detective's shield on his belt, just off the buckle
    if (K.beltBadge) {
      const F = beltF(K.beltBadge.at);
      box(B, F, 0, top - 0.004 * m, 0.0022 * m, 0.016 * m, 0.02 * m, 0.003 * m, 0x2a2016);           // the clip over the belt
      const Fb = frame(add(F.o, [0, 1, 0], top - 0.014 * m), F.n);   // rides high on the belt: a seated thigh comes up under it
      badge(B, Fb, K.beltBadge, m, 0.004 * m);
    }
    // ---- THE CHEST: badge over the left pocket, mic, epaulettes
    const colTop = S.base + P.torsoH;
    const f = (x, y) => ch.torsoFrontZ(x, y);
    const chestFrame = (x, y) => {
      const e = 0.01, fx = (f(x + e, y) - f(x - e, y)) / (2 * e), fy = (f(x, y + e) - f(x, y - e)) / (2 * e);
      return frame([x, y, f(x, y)], [-fx, -fy, 1]);
    };
    const onChest = (F, w, h) => {                              // lift a flat plate clear of the surface under it
      let s = 0;
      for (const a of [-w / 2, 0, w / 2]) for (const b of [-h / 2, 0, h / 2]) {
        const p = at(F, a, b, 0), zs = f(p[0], p[1]);
        s = Math.max(s, (zs - p[2]) * F.n[2]);
      }
      F.o = add(F.o, F.n, s + 0.0012 * m);
      return F;
    };
    if (K.badge && ch.torsoFrontZ) {
      const yB = colTop - 0.27 * P.torsoH, xB = 0.40 * S.at(yB).a;
      const F = onChest(chestFrame(xB, yB), 0.06 * m, 0.07 * m);
      badge(B, F, K.badge, m, 0);
    }
    if (K.mic && ch.torsoFrontZ) {
      const yM = S.shoulderY - 0.075 * S.vs, xM = 0.56 * S.at(yM).a;
      const F = onChest(chestFrame(xM, yM), 0.045 * m, 0.058 * m);
      box(B, F, 0, 0, 0.011 * m, 0.042 * m, 0.056 * m, 0.022 * m, RADIO);
      box(B, F, 0, 0.012 * m, 0.0225 * m, 0.03 * m, 0.022 * m, 0.002 * m, tone(RADIO, 0.18));
      box(B, F, 0, 0.034 * m, 0.006 * m, 0.012 * m, 0.014 * m, 0.012 * m, RADIO);   // the clip over the strap
    }
    if (K.straps) epaulettes(B, ch, m, cw, tone(shirt, -0.08), clr);
    const g = B.geometry();
    g.userData.dutyKit = { kind, gun: gun || null, torch, belt: { top, bot, ring: outer.length } };
    return (GEO[key] = g);
  }
  // the cuff case, real size (metres) — was entities/handcuffs.js buildPouch
  const CASE = { w: 0.074, h: 0.088, d: 0.036 };

  /* EPAULETTES: a cloth strap along each shoulder crest from under the collar
     band out to the sleeve head, laid on this body's trapezius. The crest at
     a given x is where the ring at height y is exactly that wide; the strap
     follows it and is held a hair off the surface along its normal. */
  function epaulettes(B, ch, m, collarHalf, hex, clr) {
    const S = ch.torsoShape;
    const width = (y, z) => {
      const R = S.at(y), b = z >= (R.zc || 0) ? R.zf : R.zb, q = Math.abs(z - (R.zc || 0)) / b;
      return q >= 1 ? 0 : R.a * Math.pow(1 - Math.pow(q, R.n), 1 / R.n);
    };
    const topY = (x, z) => {
      let lo = S.shoulderY - 0.02, hi = S.yN;
      if (width(lo, z) < x) return lo;
      for (let k = 0; k < 24; k++) { const mid = (lo + hi) / 2; if (width(mid, z) > x) lo = mid; else hi = mid; }
      return (lo + hi) / 2;
    };
    const hw = 0.024 * m, th = 0.003 * m, x0 = collarHalf * 0.92, x1 = S.AX - 0.72 * S.R, M = 6;
    if (!(x1 > x0 + 0.02)) return;
    for (const side of [1, -1]) {
      const grid = [], base = [];
      for (let i = 0; i <= M; i++) {
        const x = x0 + (x1 - x0) * i / M;
        const zc = S.at(topY(x, 0)).zc || 0;
        const rowT = [], rowB = [];
        for (const zo of [-hw, 0, hw]) {
          const z = zc + zo, y = topY(x, z), e = 0.01;
          const hx = (topY(x + e, z) - topY(x - e, z)) / (2 * e), hz = (topY(x, z + e) - topY(x, z - e)) / (2 * e);
          const n = norm([-hx * side, 1, -hz]);
          const p = [x * side, y, z];
          rowB.push([add(p, n, clr * 0.5), n]);
          rowT.push([add(p, n, clr + th), n]);
        }
        grid.push(rowT); base.push(rowB);
      }
      const T = grid.map((r) => r.map((v) => B.v(v[0], v[1], hex)));
      for (let i = 0; i < M; i++) for (let k = 0; k < 2; k++) B.q(T[i][k], T[i + 1][k], T[i + 1][k + 1], T[i][k + 1]);
      for (const k of [0, 2]) {                                 // the two long edges
        const s = k === 0 ? -1 : 1, en = [0, 0, s];
        for (let i = 0; i < M; i++) B.q(B.v(base[i][k][0], en, hex), B.v(base[i + 1][k][0], en, hex), B.v(grid[i + 1][k][0], en, hex), B.v(grid[i][k][0], en, hex));
      }
      const ex = [side, 0, 0];                                  // the outer end (under the sleeve head)
      B.q(B.v(base[M][0][0], ex, hex), B.v(base[M][2][0], ex, hex), B.v(grid[M][2][0], ex, hex), B.v(grid[M][0][0], ex, hex));
      // the button, near the collar
      const b = grid[1][1], F = frame(b[0], b[1], [side, 0, 0]);
      cyl(B, { o: F.o, t: F.t, u: F.n, n: neg(F.u) }, 0, 0, 0, 0.003 * m, 0.0065 * m, 0x9ea5ae, 8);
    }
  }

  // ---- wearing it ----------------------------------------------------------
  function kindOf(rec) {
    const k = rec && rec.duty;
    return k && KINDS[k] ? k : null;
  }
  function strip(ch) {
    const k = ch && ch._dutyKit;
    if (!k) return;
    if (k.parent) k.parent.remove(k);
    ch._dutyKit = null;
  }
  function wear(ch, rec) {
    if (!ch) return null;
    const kind = kindOf(rec);
    // no child is an officer: a costume on a kid gets no gun belt
    const young = ch.child || (ch.ageYears != null && ch.ageYears < 16);
    if (!kind || young || !ch.body || !ch.torsoShape) { strip(ch); return null; }
    const c = (rec && rec.colors) || {};
    let shirt = null;
    try { shirt = CBZ.cityPaintedBodyHex ? CBZ.cityPaintedBodyHex(rec, ch) : null; } catch (e) { shirt = null; }
    if (shirt == null) shirt = c.torso != null ? c.torso : 0x24407a;
    // the player's own pistol is systems/holsterprops.js's (it shows the gun he
    // actually owns); his uniform brings no second holster
    const opts = { shirt: shirt, noGun: ch === CBZ.playerChar, torchOut: false };
    const cur = ch._dutyKit;
    if (cur && cur.userData.kind === kind && cur.userData.shirt === shirt && cur.parent === ch.body) return cur;
    const g = geometry(ch, kind, opts);
    if (!g) { strip(ch); return null; }
    let mesh = cur;
    if (!mesh) {
      mesh = new THREE.Mesh(g, material());
      mesh.name = "duty-kit";
      mesh.castShadow = false; mesh.receiveShadow = false;
    } else mesh.geometry = g;
    mesh.userData.kind = kind; mesh.userData.shirt = shirt; mesh.userData.opts = opts; mesh.userData.torchOut = false;
    if (mesh.parent !== ch.body) ch.body.add(mesh);
    ch._dutyKit = mesh;
    return mesh;
  }
  // a guard's torch lives in ONE place: in his hand while it is out, else on
  // his belt (entities/guards.js flashlightOn drives the hand torch)
  let sweepT = 0;
  function sweep(dt) {
    sweepT -= dt || 0;
    if (sweepT > 0) return;
    sweepT = 0.2;
    const L = CBZ.guards;
    if (!L || !L.length) return;
    for (let i = 0; i < L.length; i++) {
      const gd = L[i], ch = gd && gd.char, k = ch && ch._dutyKit;
      if (!k || KINDS[k.userData.kind].torch == null) continue;
      const out = !!(gd.flashlightOn && gd.flashlight && gd.flashlight.group && gd.flashlight.group.visible !== false);
      if (out === k.userData.torchOut) continue;
      const o = Object.assign({}, k.userData.opts, { torchOut: out });
      const g = geometry(ch, k.userData.kind, o);
      if (g) { k.geometry = g; k.userData.torchOut = out; }
    }
  }
  if (typeof CBZ.onUpdate === "function") CBZ.onUpdate(92, sweep);

  CBZ.dutyKit = {
    version: 1,
    KINDS: KINDS, CASE: CASE,
    kindOf: kindOf,
    material: material,
    geometry: geometry,
    wear: wear,
    strip: strip,
    sweep: sweep,
  };
})();
