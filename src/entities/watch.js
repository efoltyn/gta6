/* ============================================================
   entities/watch.js — THE WRISTWATCH. One real watch, every wrist, every game.

   OWNER: "improve the watches, make them more realistic." What shipped was
   bling.js's parts list: a torus band, an 8-sided puck, a torus "bezel", a
   disc and four boxes, 12 o'clock pointing up the forearm (so the lugs stuck
   out sideways into nothing), no hands, no time, no crystal, no buckle — and
   only people carrying a looted Rolex wore one at all.

   Now a watch is built the way a watch is built:
     · a CASE turned on a lathe (round, cushion, squircle, tonneau), with a
       chamfered back, lugs at 12 and 6, and a crown at 3 pointing at the hand
       (or pushers on a digital, a crown and button on a smartwatch);
     · a BEZEL: polished, fluted (Day-Date), coin-edged dive insert with a pip
       at 12, the Royal Oak octagon with its eight screws, or pavé;
     · a DIAL recessed under the bezel with real indices (batons, lume dots,
       a minute track, a tapisserie grid, an LCD window);
     · HANDS that show THE IN-GAME TIME (CBZ.dayPhase: phase 0 = 06:00), the
       seconds hand stepping once a real second on a quartz and sweeping on an
       automatic; a digital shows HH:MM on a seven-segment LCD with a blinking
       colon; lume and LCD glow come up at night;
     · a domed CRYSTAL that catches the light;
     · a STRAP swept round the MEASURED wrist: leather/rubber/nylon/resin
       tapering to a buckle and keeper on the inner wrist, or a link bracelet
       with grooved links, a raised centre row (gold on a two-tone) and a clasp.

   WHO WEARS WHAT (by role, rolled per body, never a menu): inmates a clear
   commissary digital (the only case a prison sells — nothing hides in it) or
   a black resin one; cops and guards a steel diver on rubber; SWAT, soldiers
   and athletes a chunky tactical digital; the protective detail black-dial
   steel; the warden a thin gold dress watch; money a two-tone or gold; old
   money a gold Day-Date, a Calatrava, a dress watch; civilians a mix of
   resin digitals, smartwatches, field watches and steel — or nothing. The
   bling watches (a Rolex / Patek / AP / RM in ped.valuables or your stash)
   OVERRIDE the role watch through CBZ.wristwatch.attach, the same wrist.

   WHERE IT SITS. Nothing is typed against one body: the forearm's real cross
   section is MEASURED at the watch line (whatever mesh character.js draws
   there — box or tube), the strap is swept round it with 1.5 mm of clearance.
   The HEAD is sized by the HAND, not by the arm (a 40 mm case is 40 mm at
   the scale the hand beside it is drawn): sized off the measured section it
   grew with every chunky forearm and every sleeve, to a dial as wide as the
   forearm. The head sits on the BACK of the wrist (outboard on a hanging
   arm), crown to the hand, and above the wrist crease so no hand pose ever
   reaches it. UNDER A SLEEVE the watch is worn on the wrist, not over the
   cloth: the strap wraps the real wrist inside the sleeve (hidden), and the
   head sits at the hem, sunk under the fabric's surface, so the lower part
   of the dial peeks out past the cuff and nothing floats over the fabric.
   First person: fpHands.poseArm is wrapped, so every FP arm in the game (the
   fists, the gun arms, the car cabin, the pickup lens) carries the PLAYER's
   watch on its left forearm, riding the pose it was just given.

   COST. Geometry is shared (head per style, strap per style x wrist fit),
   materials are shared, a watch is two meshes (strap + head) using material
   groups — which also keeps pedinstance.js from pooling it (a multi-material
   mesh is an "attachment that draws itself", so a rare watch combo can never
   knock a whole body out of instancing). Mounted only within VIS_D of the
   camera, hands/crystal/LCD only within NEAR_D (or on you), the roster
   time-sliced. Past ~12 m a watch is under two pixels; it is not drawn.

   HOOK: character.js makeCharacter calls CBZ.wristwatch.fit(rig, c) once
   (the only line this file needs there). Everything else feature-detects.
   Pure geometry + slicing are exported on CBZ.wristwatch._test for
   tools/watch-check.mjs (plain node, no browser).
============================================================ */
(function () {
  "use strict";
  const root = typeof window !== "undefined" ? window : globalThis;
  const CBZ = root.CBZ = root.CBZ || {};
  const THREE = root.THREE;
  if (!THREE) return;
  if (CBZ.wristwatch && CBZ.wristwatch.version) return;

  const PI = Math.PI, TAU = PI * 2;
  const VIS_D = 12, NEAR_D = 2.4;             // metres from the camera
  const SLICE = 48;                            // roster records examined per frame
  const REF_HALF_WRIST = 0.030;                // the head is authored for a 60 mm wrist
  const CLEAR = 0.0015;                        // strap clearance off the skin, metres (x s)

  /* ------------------------------------------------------------ materials */
  let _M = null;
  function phong(color, o) {
    o = o || {};
    const m = new THREE.MeshPhongMaterial({
      color: color, specular: o.spec != null ? o.spec : 0x222222, shininess: o.shin != null ? o.shin : 30,
      emissive: o.em != null ? o.em : 0x000000, emissiveIntensity: o.ei != null ? o.ei : 1,
    });
    if (o.opacity != null) { m.transparent = true; m.opacity = o.opacity; m.depthWrite = !!o.dw; }
    m._shared = true;
    return m;
  }
  function lambert(color, o) {
    o = o || {};
    const m = new THREE.MeshLambertMaterial({ color: color, emissive: o.em != null ? o.em : 0x000000, emissiveIntensity: o.ei != null ? o.ei : 1 });
    m._shared = true;
    return m;
  }
  function mats() {
    if (_M) return _M;
    _M = {
      steel: phong(0xa9b0b8, { spec: 0xffffff, shin: 90 }),
      steelBrushed: phong(0x8e959d, { spec: 0x9aa0a8, shin: 40 }),
      gold: phong(0xc9a04a, { spec: 0xfff0c0, shin: 90, em: 0x3a2a08, ei: 0.25 }),
      rose: phong(0xc48a72, { spec: 0xffe0d0, shin: 80, em: 0x2a140c, ei: 0.2 }),
      iced: phong(0xeef6ff, { spec: 0xffffff, shin: 160, em: 0x6a8aa8, ei: 0.25 }),
      glint: phong(0xffffff, { spec: 0xffffff, shin: 200, em: 0x9fb8d0, ei: 0.35 }),
      resin: phong(0x1b1c1f, { spec: 0x2c2c2c, shin: 20 }),
      clear: phong(0xdce6ec, { spec: 0xffffff, shin: 70, opacity: 0.42 }),
      kid: phong(0xc23b32, { spec: 0x553333, shin: 25 }),
      alu: phong(0x3a3d42, { spec: 0x888888, shin: 50 }),
      carbon: phong(0x202226, { spec: 0x555555, shin: 40 }),
      bezelDark: phong(0x121821, { spec: 0x666666, shin: 60 }),
      dialBlack: phong(0x121418, { spec: 0x333333, shin: 40 }),
      dialWhite: phong(0xe9ebe6, { spec: 0x666666, shin: 30 }),
      dialBlue: phong(0x1f3f78, { spec: 0x5a7aa8, shin: 70 }),
      dialChamp: phong(0xcdb68a, { spec: 0xfff0c8, shin: 60 }),
      dialGreen: phong(0x2f3b2c, { spec: 0x333333, shin: 30 }),
      lcd: lambert(0x9da58e),
      lcdSeg: lambert(0x1a1f1a),
      screen: phong(0x050607, { spec: 0x888888, shin: 140 }),
      screenSeg: lambert(0xffffff, { em: 0xdff4ff, ei: 1 }),
      lume: lambert(0xeef3e6, { em: 0x7dffb2, ei: 0.08 }),
      leatherBrown: lambert(0x4a2c1a),
      leatherBlack: lambert(0x171313),
      leatherTan: lambert(0x8a5a32),
      rubber: lambert(0x141516),
      nylon: lambert(0x4b5238),
      secRed: lambert(0xc0392b),
      secOrange: lambert(0xe07020),
      crystal: phong(0xffffff, { spec: 0xffffff, shin: 220, opacity: 0.13 }),
    };
    return _M;
  }

  /* ------------------------------------------------------------ styles
     R case radius, hc case height, hb bezel height (metres, real size);
     m = [strap, case, bezel, dial, marks, accent] material names;
     hand/sec = hand + seconds-hand materials. */
  const STYLES = {
    clear:      { shape: "cushion", R: 0.0175, hc: 0.0075, hb: 0.0022, bezel: "flat", dialR: 0.72, marks: "none", digital: true, strap: "resin", strapW: 0.018, lugs: "block", crown: "buttons", m: ["clear", "clear", "clear", "lcd", "lcdSeg", "steel"] },
    resin:      { shape: "cushion", R: 0.0175, hc: 0.0075, hb: 0.0022, bezel: "flat", dialR: 0.72, marks: "none", digital: true, strap: "resin", strapW: 0.018, lugs: "block", crown: "buttons", m: ["resin", "resin", "resin", "lcd", "lcdSeg", "steel"] },
    kid:        { shape: "cushion", R: 0.0155, hc: 0.0070, hb: 0.0020, bezel: "flat", dialR: 0.72, marks: "none", digital: true, strap: "resin", strapW: 0.016, lugs: "block", crown: "buttons", m: ["kid", "kid", "kid", "lcd", "lcdSeg", "steel"] },
    tactical:   { shape: "cushion", R: 0.0235, hc: 0.0105, hb: 0.0040, bezel: "chunky", dialR: 0.66, marks: "none", digital: true, strap: "rubber", strapW: 0.022, lugs: "block", crown: "buttons", m: ["rubber", "resin", "resin", "lcd", "lcdSeg", "resin"] },
    smart:      { shape: "squircle", R: 0.0200, hc: 0.0092, hb: 0.0012, bezel: "none", dialR: 0.90, marks: "none", digital: true, glow: true, strap: "rubber", strapW: 0.021, lugs: "block", crown: "smart", m: ["rubber", "alu", "alu", "screen", "screenSeg", "alu"] },
    field:      { shape: "round", R: 0.0190, hc: 0.0080, hb: 0.0018, bezel: "smooth", dialR: 0.84, marks: "field", strap: "nylon", strapW: 0.020, lugs: "pair", crown: "crown", hand: "lume", sec: "secOrange", m: ["nylon", "steelBrushed", "steelBrushed", "dialBlack", "lume", "steel"] },
    pilot:      { shape: "round", R: 0.0210, hc: 0.0085, hb: 0.0018, bezel: "smooth", dialR: 0.86, marks: "field", strap: "leather", strapW: 0.021, lugs: "pair", crown: "crown", hand: "lume", sec: "lume", sweep: true, m: ["leatherBrown", "steel", "steel", "dialBlack", "lume", "steel"] },
    steel:      { shape: "round", R: 0.0200, hc: 0.0085, hb: 0.0024, bezel: "smooth", dialR: 0.80, marks: "baton", strap: "bracelet", strapW: 0.020, lugs: "pair", crown: "crown", hand: "steel", sec: "steel", sweep: true, m: ["steel", "steel", "steel", "dialWhite", "steel", "steel"] },
    steelBlack: { shape: "round", R: 0.0200, hc: 0.0085, hb: 0.0024, bezel: "smooth", dialR: 0.80, marks: "baton", strap: "bracelet", strapW: 0.020, lugs: "pair", crown: "crown", hand: "steel", sec: "secRed", sweep: true, m: ["steel", "steel", "steel", "dialBlack", "lume", "steel"] },
    diver:      { shape: "round", R: 0.0205, hc: 0.0090, hb: 0.0030, bezel: "dive", dialR: 0.76, marks: "dots", strap: "bracelet", strapW: 0.020, lugs: "pair", crown: "crown", hand: "lume", sec: "secRed", sweep: true, m: ["steel", "steel", "bezelDark", "dialBlue", "lume", "steel"] },
    police:     { shape: "round", R: 0.0205, hc: 0.0090, hb: 0.0030, bezel: "dive", dialR: 0.76, marks: "dots", strap: "rubber", strapW: 0.020, lugs: "pair", crown: "crown", hand: "lume", sec: "lume", m: ["rubber", "steelBrushed", "bezelDark", "dialBlack", "lume", "steel"] },
    twoTone:    { shape: "round", R: 0.0200, hc: 0.0085, hb: 0.0026, bezel: "fluted", dialR: 0.80, marks: "baton", strap: "bracelet", strapW: 0.020, lugs: "pair", crown: "crown", hand: "gold", sec: "gold", sweep: true, m: ["steel", "steel", "gold", "dialChamp", "gold", "gold"] },
    gold:       { shape: "round", R: 0.0200, hc: 0.0088, hb: 0.0026, bezel: "fluted", dialR: 0.80, marks: "baton", strap: "president", strapW: 0.020, lugs: "pair", crown: "crown", hand: "gold", sec: "gold", sweep: true, m: ["gold", "gold", "gold", "dialChamp", "gold", "gold"] },
    goldDress:  { shape: "round", R: 0.0190, hc: 0.0058, hb: 0.0012, bezel: "thin", dialR: 0.88, marks: "baton", strap: "leather", strapW: 0.019, lugs: "pair", crown: "crown", hand: "gold", sec: "gold", sweep: true, m: ["leatherBlack", "gold", "gold", "dialWhite", "gold", "gold"] },
    patek:      { shape: "round", R: 0.0195, hc: 0.0060, hb: 0.0012, bezel: "thin", dialR: 0.88, marks: "baton", strap: "leather", strapW: 0.019, lugs: "pair", crown: "crown", hand: "gold", sec: "gold", sweep: true, m: ["leatherBrown", "gold", "gold", "dialWhite", "gold", "gold"] },
    iced:       { shape: "round", R: 0.0210, hc: 0.0090, hb: 0.0030, bezel: "pave", dialR: 0.74, marks: "pave", strap: "bracelet", strapW: 0.021, lugs: "pair", crown: "crown", hand: "iced", sec: "iced", sweep: true, m: ["iced", "iced", "iced", "glint", "glint", "glint"] },
    ap:         { shape: "round", R: 0.0205, hc: 0.0080, hb: 0.0020, bezel: "octagon", dialR: 0.78, marks: "tapisserie", strap: "bracelet", strapW: 0.022, lugs: "block", crown: "crown", hand: "lume", sec: "steel", sweep: true, m: ["steel", "steel", "steel", "dialBlue", "steel", "steel"] },
    rm:         { shape: "tonneau", R: 0.0210, hc: 0.0100, hb: 0.0022, bezel: "screws", dialR: 0.80, marks: "skeleton", strap: "rubber", strapW: 0.022, lugs: "block", crown: "crown", hand: "rose", sec: "rose", sweep: true, m: ["rubber", "carbon", "rose", "carbon", "rose", "rose"] },
  };
  // bling.js look key -> style
  const LOOK_STYLE = {
    watchSteel: "steel", watchSilver: "steel", watchGold: "gold", watchIced: "iced",
    watchDiver: "diver", watchAP: "ap", watchPatek: "patek", watchRM: "rm",
  };
  function styleKey(k) { return STYLES[k] ? k : (LOOK_STYLE[k] || null); }

  /* ------------------------------------------------------------ geometry kit */
  function Kit() { this.p = []; this.slots = []; }
  Kit.prototype.v = function (x, y, z) { this.p.push(x, y, z); return this.p.length / 3 - 1; };
  Kit.prototype.list = function (slot) { return this.slots[slot] || (this.slots[slot] = []); };
  // a quad a-b-c-d wound so its face normal agrees with (nx,ny,nz)
  Kit.prototype.quad = function (slot, a, b, c, d, nx, ny, nz) {
    const P = this.p;
    const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2];
    const vx = P[c * 3] - P[a * 3], vy = P[c * 3 + 1] - P[a * 3 + 1], vz = P[c * 3 + 2] - P[a * 3 + 2];
    let fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
    if (fx * fx + fy * fy + fz * fz < 1e-30) {           // a-b-c degenerate: judge by a-c-d
      const wx = P[d * 3] - P[a * 3], wy = P[d * 3 + 1] - P[a * 3 + 1], wz = P[d * 3 + 2] - P[a * 3 + 2];
      fx = vy * wz - vz * wy; fy = vz * wx - vx * wz; fz = vx * wy - vy * wx;
    }
    const L = this.list(slot);
    if (fx * nx + fy * ny + fz * nz >= 0) L.push(a, b, c, a, c, d);
    else L.push(a, d, c, a, c, b);
  };
  // box on an arbitrary right-handed basis: centre c, unit axes u v w, half sizes
  Kit.prototype.box = function (slot, c, u, v, w, hu, hv, hw) {
    const self = this;
    const face = function (n, hn, t1, h1, t2, h2) {
      const q = [];
      const sg = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
      for (let i = 0; i < 4; i++) {
        q.push(self.v(
          c[0] + n[0] * hn + t1[0] * h1 * sg[i][0] + t2[0] * h2 * sg[i][1],
          c[1] + n[1] * hn + t1[1] * h1 * sg[i][0] + t2[1] * h2 * sg[i][1],
          c[2] + n[2] * hn + t1[2] * h1 * sg[i][0] + t2[2] * h2 * sg[i][1]));
      }
      self.quad(slot, q[0], q[1], q[2], q[3], n[0], n[1], n[2]);
    };
    const neg = function (a) { return [-a[0], -a[1], -a[2]]; };
    face(u, hu, v, hv, w, hw); face(neg(u), hu, v, hv, w, hw);
    face(v, hv, u, hu, w, hw); face(neg(v), hv, u, hu, w, hw);
    face(w, hw, u, hu, v, hv); face(neg(w), hw, u, hu, v, hv);
  };
  const EX = [1, 0, 0], EY = [0, 1, 0], EZ = [0, 0, 1];
  // a box lying on the dial plane pointing radially at clock angle th (12 = +X,
  // clockwise seen from +Z): radial half hr, tangential half ht, height half hz
  Kit.prototype.radialBox = function (slot, th, rMid, z, hr, ht, hz) {
    const u = [Math.cos(th), -Math.sin(th), 0], v = [Math.sin(th), Math.cos(th), 0];
    this.box(slot, [u[0] * rMid, u[1] * rMid, z], u, v, EZ, hr, ht, hz);
  };
  // cylinder along an axis (unit a, with a perpendicular basis p q), closed
  Kit.prototype.cyl = function (slot, c, a, p, q, r, hl, seg) {
    seg = seg || 10;
    const ring = function (self, sgn) {
      const ids = [];
      for (let k = 0; k < seg; k++) {
        const t = k / seg * TAU, cs = Math.cos(t) * r, sn = Math.sin(t) * r;
        ids.push(self.v(c[0] + a[0] * hl * sgn + p[0] * cs + q[0] * sn,
                        c[1] + a[1] * hl * sgn + p[1] * cs + q[1] * sn,
                        c[2] + a[2] * hl * sgn + p[2] * cs + q[2] * sn));
      }
      return ids;
    };
    const s0 = ring(this, -1), s1 = ring(this, 1), c0 = ring(this, -1), c1 = ring(this, 1);
    for (let k = 0; k < seg; k++) {
      const k1 = (k + 1) % seg, t = (k + 0.5) / seg * TAU;
      const n = [p[0] * Math.cos(t) + q[0] * Math.sin(t), p[1] * Math.cos(t) + q[1] * Math.sin(t), p[2] * Math.cos(t) + q[2] * Math.sin(t)];
      this.quad(slot, s0[k], s0[k1], s1[k1], s1[k], n[0], n[1], n[2]);
    }
    const m0 = this.v(c[0] - a[0] * hl, c[1] - a[1] * hl, c[2] - a[2] * hl);
    const m1 = this.v(c[0] + a[0] * hl, c[1] + a[1] * hl, c[2] + a[2] * hl);
    for (let k = 0; k < seg; k++) {
      const k1 = (k + 1) % seg;
      this.quad(slot, m0, c0[k], c0[k1], m0, -a[0], -a[1], -a[2]);
      this.quad(slot, m1, c1[k], c1[k1], m1, a[0], a[1], a[2]);
    }
  };
  /* LATHE about +Z. profile = [[r, z, ripple?], ...] walked bottom-centre ->
     outward -> up -> inward (outward-facing by construction). shape(th) scales
     the radius per angle (cushion / tonneau / octagon). A repeated profile
     point makes a hard edge. flat: faceted columns (the octagon). */
  Kit.prototype.lathe = function (slot, profile, seg, shape, opts) {
    opts = opts || {};
    const phase = opts.phase || 0, flat = !!opts.flat, ripN = opts.ripN || 0;
    const rad = function (th, pr) {
      let f = shape ? shape(th) : 1;
      if (pr[2] && ripN) f *= 1 + pr[2] * Math.cos(th * ripN);
      return pr[0] * f;
    };
    const cols = flat ? seg * 2 : seg;
    const angle = function (col) { return phase + (flat ? (((col >> 1) + (col & 1)) / seg) : (col / seg)) * TAU; };
    const rings = [];
    for (let j = 0; j < profile.length; j++) {
      const pr = profile[j], ids = [];
      for (let col = 0; col < cols; col++) {
        const th = angle(col), r = rad(th, pr);
        ids.push(this.v(Math.cos(th) * r, -Math.sin(th) * r, pr[1]));
      }
      rings.push(ids);
    }
    for (let j = 0; j + 1 < profile.length; j++) {
      const A = rings[j], B = rings[j + 1];
      const dr = profile[j + 1][0] - profile[j][0], dz = profile[j + 1][1] - profile[j][1];
      if (Math.abs(dr) < 1e-12 && Math.abs(dz) < 1e-12) continue;   // the hard-edge duplicate
      for (let k = 0; k < seg; k++) {
        const c0 = flat ? 2 * k : k, c1 = flat ? 2 * k + 1 : (k + 1) % seg;
        const th = phase + (k + 0.5) / seg * TAU;
        // intended normal: rotate the profile tangent (dr, dz) by -90° in (r, z)
        const nr = dz, nz = -dr;
        const rx = Math.cos(th), ry = -Math.sin(th);
        this.quad(slot, A[c0], A[c1], B[c1], B[c0], rx * nr, ry * nr, nz);
      }
    }
  };
  function finish(kit) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(kit.p, 3));
    const idx = [];
    for (let s = 0; s < kit.slots.length; s++) {
      const L = kit.slots[s];
      if (!L || !L.length) continue;
      g.addGroup(idx.length, L.length, s);
      for (let i = 0; i < L.length; i++) idx.push(L[i]);
    }
    g.setIndex(idx);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    g._shared = true;
    return g;
  }

  // case outline scalers (radius multiplier per clock angle, 12 = +X)
  function superEllipse(n, sx, sy) {
    return function (th) {
      const c = Math.abs(Math.cos(th)) / (sx || 1), s = Math.abs(Math.sin(th)) / (sy || 1);
      return 1 / Math.pow(Math.pow(c, n) + Math.pow(s, n), 1 / n);
    };
  }
  const SHAPES = {
    round: null,
    cushion: superEllipse(4.2),
    squircle: superEllipse(5.0, 1.0, 0.86),        // taller along 12-6, like the real thing
    tonneau: superEllipse(3.0, 1.12, 0.86),
  };

  /* ------------------------------------------------------------ the head */
  const SL = { strap: 0, case: 1, bezel: 2, dial: 3, marks: 4, accent: 5 };
  const _headGeo = Object.create(null);
  function dialZ(S) { return S.hc + S.hb - (S.bezel === "none" ? 0.0004 : 0.0020); }
  function dialRad(S) { return S.R * S.dialR; }
  function headGeometry(style) {
    if (_headGeo[style]) return _headGeo[style];
    const S = STYLES[style], k = new Kit();
    const R = S.R, hc = S.hc, hb = S.hb, shape = SHAPES[S.shape];
    const seg = 40, zD = dialZ(S), Rd = dialRad(S);
    // CASE: chamfered back, straight band, a soft shoulder into the bezel
    k.lathe(SL.case, [[0, 0], [0.86 * R, 0], [0.86 * R, 0], [0.97 * R, 0.0012], [R, 0.0028], [R, 0.0028], [R, hc - 0.0010], [0.975 * R, hc], [0.975 * R, hc]], seg, shape);
    // BEZEL
    const inner = S.digital ? S.R * S.dialR : S.R * Math.min(0.9, S.dialR + 0.06);
    const top = hc + hb;
    if (S.bezel === "fluted") {
      k.lathe(SL.bezel, [[0.975 * R, hc], [0.975 * R, hc + hb * 0.55, 0.03], [0.90 * R, top, 0.03], [0.84 * R, top], [inner, zD + 0.0003], [inner, zD]], 60, shape, { ripN: 36 });
    } else if (S.bezel === "dive") {
      k.lathe(SL.bezel, [[1.0 * R, hc], [1.02 * R, hc + hb * 0.25, 0.012], [1.02 * R, hc + hb * 0.8, 0.012], [0.98 * R, top], [0.98 * R, top], [0.82 * R, top], [0.82 * R, top], [inner, zD]], 60, shape, { ripN: 60 });
      // the pip at 12 and the minute dots on the insert
      k.radialBox(SL.marks, 0, 0.90 * R, top + 0.0002, 0.0022, 0.0016, 0.0003);
      for (let i = 1; i < 12; i++) k.radialBox(SL.marks, i / 12 * TAU, 0.90 * R, top + 0.0001, 0.0009, 0.0006, 0.0002);
    } else if (S.bezel === "octagon") {
      const oc = 1 / Math.cos(PI / 8);
      k.lathe(SL.bezel, [[0.975 * R, hc], [0.96 * R * oc, hc + 0.0004], [0.96 * R * oc, hc + hb * 0.6], [0.90 * R * oc, top], [0.90 * R * oc, top], [inner * 1.05, top], [inner, zD]], 8, null, { flat: true, phase: PI / 8 });
      for (let i = 0; i < 8; i++) {           // the eight hexagon screws, in the flats' corners
        const th = PI / 8 + i / 8 * TAU, r = 0.84 * R * oc;
        k.cyl(SL.accent, [Math.cos(th) * r, -Math.sin(th) * r, top + 0.0002], EZ, EX, EY, 0.0011, 0.0003, 6);
      }
    } else if (S.bezel === "screws") {
      k.lathe(SL.bezel, [[0.975 * R, hc], [0.975 * R, top], [0.975 * R, top], [inner, top], [inner, zD]], seg, shape);
      for (let i = 0; i < 8; i++) {
        const th = PI / 8 + i / 8 * TAU, f = shape ? shape(th) : 1, r = 0.89 * R * f;
        k.cyl(SL.accent, [Math.cos(th) * r, -Math.sin(th) * r, top + 0.0002], EZ, EX, EY, 0.0009, 0.0003, 6);
      }
    } else if (S.bezel === "pave") {
      k.lathe(SL.bezel, [[0.975 * R, hc], [0.975 * R, top], [0.975 * R, top], [inner, top], [inner, zD]], seg, shape);
      for (let i = 0; i < 24; i++) {
        const th = i / 24 * TAU, r = (0.975 * R + inner) / 2, c = [Math.cos(th) * r, -Math.sin(th) * r, top + 0.0006];
        const a = [Math.cos(th + PI / 4), -Math.sin(th + PI / 4), 0], b = [-a[1], a[0], 0];
        k.box(SL.accent, c, a, b, EZ, 0.0011, 0.0011, 0.0007);
      }
    } else if (S.bezel === "none") {
      // a smartwatch: the glass runs to the edge — a thin black lip, no bezel
      k.lathe(SL.dial, [[0.975 * R, hc], [0.95 * R, top], [0.95 * R, top], [inner, zD]], seg, shape);
    } else if (S.bezel === "chunky") {
      k.lathe(SL.bezel, [[0.975 * R, hc], [1.03 * R, hc + hb * 0.4], [1.0 * R, top], [0.86 * R, top], [inner, zD]], seg, shape);
    } else {
      const lo = S.bezel === "thin" ? 0.4 : (S.bezel === "flat" ? 0.9 : 0.7);
      k.lathe(SL.bezel, [[0.975 * R, hc], [0.965 * R, hc + hb * lo], [0.93 * R, top], [0.88 * R, top], [inner, zD + 0.0004], [inner, zD]], seg, shape);
    }
    // DIAL (or the LCD window / black screen)
    const dialShape = S.digital ? shape : null;
    k.lathe(SL.dial, [[inner, zD], [0, zD]], seg, dialShape);   // walked inward: faces up
    // INDICES
    const zm = zD + 0.00025;
    if (S.marks === "baton") {
      for (let i = 0; i < 12; i++) {
        const th = i / 12 * TAU, len = Rd * (i % 3 === 0 ? 0.20 : 0.15), rm = Rd * 0.90 - len;
        if (i === 0) { k.radialBox(SL.marks, -0.035, rm, zm, len, 0.0006, 0.00025); k.radialBox(SL.marks, 0.035, rm, zm, len, 0.0006, 0.00025); }
        else k.radialBox(SL.marks, th, rm, zm, len, 0.00065, 0.00025);
      }
    } else if (S.marks === "dots") {
      for (let i = 0; i < 12; i++) {
        const th = i / 12 * TAU;
        if (i === 0) k.radialBox(SL.marks, 0, Rd * 0.80, zm, 0.0021, 0.0017, 0.0003);
        else if (i % 3 === 0) k.radialBox(SL.marks, th, Rd * 0.80, zm, 0.0021, 0.0008, 0.0003);
        else k.cyl(SL.marks, [Math.cos(th) * Rd * 0.83, -Math.sin(th) * Rd * 0.83, zm], EZ, EX, EY, 0.0012, 0.00025, 8);
      }
    } else if (S.marks === "field") {
      for (let i = 0; i < 60; i++) {
        const th = i / 60 * TAU, hour = i % 5 === 0;
        k.radialBox(SL.marks, th, Rd * (hour ? 0.84 : 0.925), zm, Rd * (hour ? 0.11 : 0.035), hour ? 0.0006 : 0.00018, 0.0002);
      }
    } else if (S.marks === "tapisserie") {
      // the Royal Oak's waffle: a grid of raised squares, then applied batons
      const n = 7, step = Rd * 1.3 / n;
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        const x = (i - (n - 1) / 2) * step, y = (j - (n - 1) / 2) * step;
        if (x * x + y * y > Rd * Rd * 0.55) continue;
        k.box(SL.dial, [x, y, zD + 0.00012], EX, EY, EZ, step * 0.36, step * 0.36, 0.00012);
      }
      for (let i = 0; i < 12; i++) k.radialBox(SL.marks, i / 12 * TAU, Rd * 0.80, zm + 0.0001, Rd * 0.10, 0.0006, 0.0003);
    } else if (S.marks === "skeleton") {
      // an open movement: bridges across a dark void, hour dots on the rehaut
      for (let i = 0; i < 3; i++) k.radialBox(SL.marks, PI / 6 + i * PI / 3, 0, zD + 0.0003, Rd * 0.85, 0.0007, 0.0003);
      for (let i = 0; i < 12; i++) k.radialBox(SL.marks, i / 12 * TAU, Rd * 0.88, zm, Rd * 0.07, 0.0005, 0.0002);
    } else if (S.marks === "pave") {
      for (let i = 0; i < 12; i++) {
        const th = i / 12 * TAU, r = Rd * 0.80, c = [Math.cos(th) * r, -Math.sin(th) * r, zm + 0.0004];
        const a = [Math.cos(th + PI / 4), -Math.sin(th + PI / 4), 0], b = [-a[1], a[0], 0];
        k.box(SL.marks, c, a, b, EZ, 0.0014, 0.0014, 0.0008);
      }
    }
    // LUGS at 12 and 6 (+X / -X). Pair: two horns each side of the strap;
    // block: one integrated end (resin digitals, the Royal Oak, the RM).
    const sw = S.strapW / 2;
    for (let sgn = -1; sgn <= 1; sgn += 2) {
      const x0 = R * 0.78, x1 = R + 0.0058, cx = sgn * (x0 + x1) / 2, hx = (x1 - x0) / 2;
      if (S.lugs === "pair") {
        for (let side = -1; side <= 1; side += 2) {
          k.box(SL.case, [cx, side * (sw + 0.0012), (hc - 0.0008) / 2 + 0.0012], EX, EY, EZ, hx, 0.0012, (hc - 0.0008) / 2 - 0.0006);
        }
      } else {
        k.box(SL.case, [cx, 0, (hc * 0.7) / 2 + 0.0008], EX, EY, EZ, hx, sw + 0.0014, hc * 0.35 - 0.0004);
      }
    }
    // CROWN at 3 (toward the hand, -Y), or pushers / a smartwatch's crown + button
    if (S.crown === "crown") {
      const big = S.bezel === "dive" ? 0.0030 : 0.0024;
      k.cyl(SL.case, [0, -(R * (shape ? shape(-PI / 2) : 1) + 0.0016), hc * 0.5], [0, -1, 0], EX, EZ, big, 0.0016, 12);
      if (S.bezel === "dive") {   // crown guards
        for (let s2 = -1; s2 <= 1; s2 += 2) k.box(SL.case, [s2 * 0.0042, -(R + 0.0010), hc * 0.5], EX, EY, EZ, 0.0011, 0.0014, hc * 0.32);
      }
    } else if (S.crown === "buttons") {
      for (let sx = -1; sx <= 1; sx += 2) for (let sy = -1; sy <= 1; sy += 2) {
        const yy = sy * (R * (shape ? shape(PI / 2) : 1) + 0.0010);
        k.box(SL.case, [sx * R * 0.45, yy, hc * 0.5], EX, EY, EZ, 0.0016, 0.0012, 0.0012);
      }
    } else if (S.crown === "smart") {
      const ry = R * shape(-PI / 2) * 0.86;
      k.cyl(SL.accent, [R * 0.25, -(ry + 0.0015), hc * 0.55], [0, -1, 0], EX, EZ, 0.0028, 0.0015, 14);
      k.box(SL.accent, [-R * 0.30, -(ry + 0.0005), hc * 0.55], EX, EY, EZ, 0.0038, 0.0008, 0.0013);
    }
    return (_headGeo[style] = finish(k));
  }

  /* ------------------------------------------------------------ the strap
     Swept round a rounded rectangle of half extents A (across, wrist X) and
     B (depth, wrist Z: dorsal +B, palm -B) with corner radius rc, in the
     wrist frame's XZ plane; width along Y (the forearm). Frame units. */
  function loopPath(A, B, rc, N) {
    rc = Math.max(1e-6, Math.min(rc, A, B));
    const ax = A - rc, bz = B - rc;
    const segs = [
      { t: "l", x0: A, z0: 0, x1: A, z1: bz, nx: 1, nz: 0 },
      { t: "a", cx: ax, cz: bz, a0: 0, a1: PI / 2 },
      { t: "l", x0: ax, z0: B, x1: -ax, z1: B, nx: 0, nz: 1 },
      { t: "a", cx: -ax, cz: bz, a0: PI / 2, a1: PI },
      { t: "l", x0: -A, z0: bz, x1: -A, z1: -bz, nx: -1, nz: 0 },
      { t: "a", cx: -ax, cz: -bz, a0: PI, a1: 1.5 * PI },
      { t: "l", x0: -ax, z0: -B, x1: ax, z1: -B, nx: 0, nz: -1 },
      { t: "a", cx: ax, cz: -bz, a0: 1.5 * PI, a1: TAU },
      { t: "l", x0: A, z0: -bz, x1: A, z1: 0, nx: 1, nz: 0 },
    ];
    let L = 0;
    for (const s of segs) { s.len = s.t === "l" ? Math.hypot(s.x1 - s.x0, s.z1 - s.z0) : rc * (s.a1 - s.a0); L += s.len; }
    const px = [], pz = [], nx = [], nz = [];
    for (let i = 0; i < N; i++) {
      let u = i / N * L, j = 0;
      while (j < segs.length - 1 && u > segs[j].len) { u -= segs[j].len; j++; }
      const s = segs[j], f = s.len > 0 ? Math.min(1, u / s.len) : 0;
      if (s.t === "l") { px.push(s.x0 + (s.x1 - s.x0) * f); pz.push(s.z0 + (s.z1 - s.z0) * f); nx.push(s.nx); nz.push(s.nz); }
      else { const a = s.a0 + (s.a1 - s.a0) * f; px.push(s.cx + Math.cos(a) * rc); pz.push(s.cz + Math.sin(a) * rc); nx.push(Math.cos(a)); nz.push(Math.sin(a)); }
    }
    return { px, pz, nx, nz, N, L };
  }
  // one closed band: inner at the path, outer at +t; width w(i) along Y
  function sweepBand(k, slot, P, yOff, lift, tFn, wFn) {
    const N = P.N, ids = [[], [], [], [], [], [], [], []];
    for (let i = 0; i < N; i++) {
      const t = tFn(i), w = wFn(i) / 2;
      const ix = P.px[i] + P.nx[i] * lift, iz = P.pz[i] + P.nz[i] * lift;
      const ox = ix + P.nx[i] * t, oz = iz + P.nz[i] * t;
      ids[0].push(k.v(ox, yOff - w, oz)); ids[1].push(k.v(ox, yOff + w, oz));   // outer face
      ids[2].push(k.v(ix, yOff - w, iz)); ids[3].push(k.v(ix, yOff + w, iz));   // inner face
      ids[4].push(k.v(ix, yOff + w, iz)); ids[5].push(k.v(ox, yOff + w, oz));   // +Y edge
      ids[6].push(k.v(ix, yOff - w, iz)); ids[7].push(k.v(ox, yOff - w, oz));   // -Y edge
    }
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N, mx = P.nx[i] + P.nx[j], mz = P.nz[i] + P.nz[j];
      k.quad(slot, ids[0][i], ids[0][j], ids[1][j], ids[1][i], mx, 0, mz);
      k.quad(slot, ids[2][i], ids[2][j], ids[3][j], ids[3][i], -mx, 0, -mz);
      k.quad(slot, ids[4][i], ids[4][j], ids[5][j], ids[5][i], 0, 1, 0);
      k.quad(slot, ids[6][i], ids[6][j], ids[7][j], ids[7][i], 0, -1, 0);
    }
  }
  const _strapGeo = Object.create(null);
  function q4(x) { return Math.round(x * 1e4) / 1e4; }
  function strapGeometry(style, fit) {
    const S = STYLES[style], kind = S.strap;
    const key = kind + "|" + S.strapW + "|" + q4(fit.a) + "|" + q4(fit.b) + "|" + q4(fit.rc) + "|" + q4(fit.s);
    if (_strapGeo[key]) return _strapGeo[key];
    const s = fit.s, k = new Kit();
    const A = fit.a + CLEAR * s, B = fit.b + CLEAR * s;
    const metal = kind === "bracelet" || kind === "president";
    const N = metal ? 96 : 64;
    const P = loopPath(A, B, fit.rc + CLEAR * s, N);
    const W = S.strapW * s;
    const t = (metal ? 0.0034 : (kind === "nylon" ? 0.0016 : (kind === "leather" ? 0.0030 : 0.0034))) * s;
    // a strap tapers from the lugs (dorsal) toward the buckle (palm)
    const taper = function (i) { const zn = P.pz[i] / B; return W * (1 - 0.16 * (1 - zn) / 2); };
    if (metal) {
      // grooved links; centre row raised (and gold on a two-tone / president)
      const every = kind === "president" ? 3 : 4;
      sweepBand(k, SL.strap, P, 0, 0, function (i) { return i % every === 0 ? t * 0.55 : t; }, taper);
      sweepBand(k, SL.accent, P, 0, t * 0.9, function (i) { return i % every === 0 ? t * 0.08 : t * 0.22; }, function (i) { return taper(i) * (kind === "president" ? 0.36 : 0.30); });
      // the clasp on the inner wrist
      k.box(SL.strap, [0, 0, -(B + t + 0.0006 * s)], EX, EY, EZ, 0.013 * s, W * 0.40, 0.0007 * s);
      // end links filling the lugs
      for (let sg = -1; sg <= 1; sg += 2) k.box(SL.strap, [sg * (0.0205 * s), 0, B + 0.0022 * s], EX, EY, EZ, 0.004 * s, W * 0.49, 0.0021 * s);
    } else {
      sweepBand(k, SL.strap, P, 0, 0, function () { return t; }, taper);
      // the buckle: a frame on the inner wrist, its tongue, and the keeper loop
      const zb = -(B + t + 0.0007 * s), bw = W * 0.92 / 2 + 0.0012 * s, bl = 0.0075 * s, bt = 0.0008 * s;
      const acc = kind === "resin" && style !== "clear" ? SL.strap : SL.accent;
      k.box(acc, [bl, 0, zb], EX, EY, EZ, 0.0009 * s, bw, bt);
      k.box(acc, [-bl, 0, zb], EX, EY, EZ, 0.0009 * s, bw, bt);
      k.box(acc, [0, bw - 0.0009 * s, zb], EX, EY, EZ, bl, 0.0009 * s, bt);
      k.box(acc, [0, -bw + 0.0009 * s, zb], EX, EY, EZ, bl, 0.0009 * s, bt);
      k.box(acc, [0, 0, zb], EX, EY, EZ, bl * 0.9, 0.0005 * s, bt * 0.7);
      k.box(SL.strap, [-0.013 * s, 0, zb + 0.0002 * s], EX, EY, EZ, 0.0022 * s, W * 0.47, 0.0012 * s);   // keeper
    }
    return (_strapGeo[key] = finish(k));
  }

  /* ------------------------------------------------------------ near detail */
  const _handGeo = Object.create(null);
  function handGeometries(style) {
    if (_handGeo[style]) return _handGeo[style];
    const S = STYLES[style], Rd = dialRad(S), zD = dialZ(S), ks = Rd / 0.016;
    const mk = function (fn) { const k = new Kit(); fn(k); return finish(k); };
    const out = {
      hour: mk(function (k) {
        k.box(0, [Rd * 0.26, 0, zD + 0.0006], EX, EY, EZ, Rd * 0.30, 0.0010 * ks, 0.00015);
        k.cyl(0, [0, 0, zD + 0.0006], EZ, EX, EY, 0.0016 * ks, 0.00018, 12);
      }),
      minute: mk(function (k) {
        k.box(0, [Rd * 0.40, 0, zD + 0.0010], EX, EY, EZ, Rd * 0.46, 0.0007 * ks, 0.00015);
      }),
      second: mk(function (k) {
        k.box(0, [Rd * 0.34, 0, zD + 0.0014], EX, EY, EZ, Rd * 0.58, 0.00025 * ks, 0.0001);
        k.cyl(0, [0, 0, zD + 0.0014], EZ, EX, EY, 0.0010 * ks, 0.00015, 10);
        if (S.bezel === "dive") k.cyl(0, [Rd * 0.66, 0, zD + 0.0014], EZ, EX, EY, 0.0010 * ks, 0.0001, 10);   // the lollipop
      }),
      crystal: mk(function (k) {
        const Rc = S.bezel === "none" ? S.R * 0.95 : S.R * Math.min(0.92, S.dialR + 0.08), top = S.hc + S.hb;
        const dome = S.bezel === "none" ? 0.0010 : 0.0008;
        k.lathe(0, [[Rc, top - 0.0002], [Rc * 0.75, top + dome * 0.7], [0, top + dome]], 32, S.bezel === "none" || S.digital ? SHAPES[S.shape] : null);
      }),
    };
    return (_handGeo[style] = out);
  }
  /* SEVEN SEGMENTS. Text reads with 12 o'clock up: text-right = -Y, text-up
     = +X. 4 digits + a colon = 30 quads; an unlit quad collapses to its centre. */
  const SEG = { 0: "abcdef", 1: "bc", 2: "abged", 3: "abgcd", 4: "fgbc", 5: "afgcd", 6: "afgedc", 7: "abc", 8: "abcdefg", 9: "abcdfg" };
  function lcdLayout(S) {
    const kk = (S.R * S.dialR) / 0.0126, dh = 0.0068 * kk, dw = 0.0036 * kk, st = 0.0008 * kk, pitch = 0.0047 * kk;
    const quads = [];   // {cx, cy, hx, hy} in text space, grouped per digit
    const segs = { a: [0, dh / 2, 1], g: [0, 0, 1], d: [0, -dh / 2, 1], f: [-dw / 2, dh / 4, 0], b: [dw / 2, dh / 4, 0], e: [-dw / 2, -dh / 4, 0], c: [dw / 2, -dh / 4, 0] };
    const xs = [-1.5 * pitch - 0.0006 * kk, -0.5 * pitch - 0.0006 * kk, 0.5 * pitch + 0.0006 * kk, 1.5 * pitch + 0.0006 * kk];
    for (let d = 0; d < 4; d++) for (const name of "abcdefg") {
      const sgm = segs[name];
      quads.push({ d: d, name: name, cx: xs[d] + sgm[0], cy: sgm[1], hx: sgm[2] ? dw / 2 - st * 0.35 : st / 2, hy: sgm[2] ? st / 2 : dh / 4 - st * 0.35 });
    }
    quads.push({ d: 4, name: ":", cx: 0, cy: dh / 5, hx: st / 2, hy: st / 2 });
    quads.push({ d: 4, name: ":", cx: 0, cy: -dh / 5, hx: st / 2, hy: st / 2 });
    return quads;
  }
  function makeLcd(S, material) {
    const quads = lcdLayout(S), n = quads.length, z = dialZ(S) + 0.00015;
    const lit = new Float32Array(n * 12), pos = new Float32Array(n * 12), nrm = new Float32Array(n * 12), idx = [];
    const shear = 0.12;
    for (let q = 0; q < n; q++) {
      const Q = quads[q], cs = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
      for (let c = 0; c < 4; c++) {
        const ty = Q.cy + Q.hy * cs[c][1], tx = Q.cx + Q.hx * cs[c][0] + ty * shear;
        lit[q * 12 + c * 3] = ty; lit[q * 12 + c * 3 + 1] = -tx; lit[q * 12 + c * 3 + 2] = z;
        nrm[q * 12 + c * 3 + 2] = 1;
      }
      // text (x right, y up) -> (X = ty, Y = -tx): that map is a proper rotation, so
      // the text-space CCW order stays CCW seen from +Z
      idx.push(q * 4, q * 4 + 1, q * 4 + 2, q * 4, q * 4 + 2, q * 4 + 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
    g.setIndex(idx);
    g.addGroup(0, idx.length, 0);
    g.computeBoundingSphere = function () { this.boundingSphere = new THREE.Sphere(new THREE.Vector3(), S.R); };
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, [material]);
    mesh.userData.lcd = { quads: quads, lit: lit, shown: "" };
    return mesh;
  }
  function setLcd(mesh, text, colon) {
    const L = mesh.userData.lcd, key = text + (colon ? ":" : " ");
    if (L.shown === key) return;
    L.shown = key;
    const pos = mesh.geometry.attributes.position, a = pos.array, lit = L.lit;
    for (let q = 0; q < L.quads.length; q++) {
      const Q = L.quads[q];
      let on;
      if (Q.d === 4) on = colon;
      else { const ch = text[Q.d]; on = ch !== " " && SEG[ch] && SEG[ch].indexOf(Q.name) >= 0; }
      const o = q * 12;
      if (on) for (let i = 0; i < 12; i++) a[o + i] = lit[o + i];
      else {
        const cx = (lit[o] + lit[o + 6]) / 2, cy = (lit[o + 1] + lit[o + 7]) / 2, cz = lit[o + 2];
        for (let c = 0; c < 4; c++) { a[o + c * 3] = cx; a[o + c * 3 + 1] = cy; a[o + c * 3 + 2] = cz; }
      }
    }
    pos.needsUpdate = true;
  }

  /* ------------------------------------------------------------ materials per style */
  const _fpMat = new Map();
  function fpVariant(m) {
    let v = _fpMat.get(m);
    if (!v) {
      v = m.clone();
      v.transparent = true; v.depthTest = true;
      if (!m.transparent) { v.opacity = 1; v.depthWrite = true; }
      v._shared = true;
      _fpMat.set(m, v);
    }
    return v;
  }
  const _styleMats = Object.create(null);
  function styleMats(style, fp) {
    const key = style + (fp ? "|fp" : "");
    if (_styleMats[key]) return _styleMats[key];
    const M = mats(), S = STYLES[style];
    const arr = S.m.map(function (n) { const m = M[n] || M.steel; return fp ? fpVariant(m) : m; });
    const pick = function (n, d) { const m = M[n] || M[d]; return fp ? fpVariant(m) : m; };
    const out = {
      arr: arr,
      hand: [pick(S.hand, "steel")],
      sec: [pick(S.sec, "secRed")],
      crystal: [fp ? fpVariant(M.crystal) : M.crystal],
      seg: pick(S.m[4], "lcdSeg"),
    };
    return (_styleMats[key] = out);
  }

  /* ------------------------------------------------------------ an instance */
  function buildInstance(style, fit, fp) {
    const S = STYLES[style], Mt = styleMats(style, fp);
    const g = new THREE.Group();
    g.name = "wristwatch";
    g.userData.wristwatch = style;
    const strap = new THREE.Mesh(strapGeometry(style, fit), Mt.arr);
    const head = new THREE.Mesh(headGeometry(style), Mt.arr);
    head.position.set(0, 0, fit.b + CLEAR * fit.s);
    head.scale.setScalar(fit.s);
    strap.castShadow = head.castShadow = false;
    strap.receiveShadow = head.receiveShadow = false;
    g.add(strap, head);
    g.userData.ww = { style: style, S: S, head: head, near: null, fp: !!fp, fitKey: fit.key };
    return g;
  }
  function setNear(inst, on) {
    const W = inst.userData.ww;
    if (!!W.near === !!on) return;
    if (!on) {
      W.head.remove(W.near.group);
      if (W.near.lcd) W.near.lcd.geometry.dispose();
      W.near = null;
      return;
    }
    const S = W.S, Mt = styleMats(W.style, W.fp), grp = new THREE.Group();
    const n = { group: grp, hour: null, minute: null, second: null, lcd: null, sweep: !!S.sweep };
    if (S.digital) {
      n.lcd = makeLcd(S, Mt.seg);
      grp.add(n.lcd);
    } else {
      const H = handGeometries(W.style);
      n.hour = new THREE.Mesh(H.hour, Mt.hand);
      n.minute = new THREE.Mesh(H.minute, Mt.hand);
      n.second = new THREE.Mesh(H.second, Mt.sec);
      grp.add(n.hour, n.minute, n.second);
    }
    const cr = new THREE.Mesh(handGeometries(W.style).crystal, Mt.crystal);
    grp.add(cr);
    grp.traverse(function (o) { o.castShadow = false; o.receiveShadow = false; });
    if (W.fp) grp.traverse(function (o) { o.renderOrder = inst.renderOrder; o.frustumCulled = false; });
    cr.renderOrder = (W.fp ? inst.renderOrder : 0) + 1;
    W.head.add(grp);
    W.near = n;
    tickInstance(inst, clockNow());
  }

  /* ------------------------------------------------------------ the time */
  const _clock = { h: 10, m: 10, s: 0, real: 0, frame: -1 };
  let _frame = 0;
  function nowReal() { return (root.performance && root.performance.now ? root.performance.now() : Date.now()) / 1000; }
  // phase 0 of the day clock is 06:00 (core/daynight.js; every hourNow in the game agrees)
  function gameHours() {
    if (typeof CBZ.dayPhase === "function") return ((CBZ.dayPhase() * 24 + 6) % 24 + 24) % 24;
    if (typeof CBZ.dayTime === "function") return (((CBZ.dayTime() % 1) * 24 + 6) % 24 + 24) % 24;
    return 10 + 10 / 60;
  }
  function clockNow() {
    if (_clock.frame === _frame) return _clock;
    const hrs = gameHours();
    _clock.h = hrs; _clock.m = (hrs % 1) * 60; _clock.real = nowReal(); _clock.frame = _frame;
    return _clock;
  }
  function tickInstance(inst, t) {
    const n = inst.userData.ww.near;
    if (!n) return;
    if (n.lcd) {
      const h24 = Math.floor(t.h), mm = Math.floor(t.m), h12 = h24 % 12 === 0 ? 12 : h24 % 12;
      const txt = (h12 < 10 ? " " + h12 : "" + h12) + (mm < 10 ? "0" + mm : "" + mm);
      setLcd(n.lcd, txt, Math.floor(t.real) % 2 === 0);
      return;
    }
    n.hour.rotation.z = -((t.h % 12) / 12) * TAU;
    n.minute.rotation.z = -(t.m / 60) * TAU;
    const sec = n.sweep ? Math.floor(t.real * 8) / 8 : Math.floor(t.real);
    n.second.rotation.z = -((sec % 60) / 60) * TAU;
  }
  // lume + LCD backglow come up after dark
  let _lumeT = 0;
  function tickLume(dt) {
    _lumeT -= dt;
    if (_lumeT > 0 || !_M) return;
    _lumeT = 1;
    const h = gameHours(), night = h >= 20 || h < 6 ? 1 : (h >= 18.5 ? (h - 18.5) / 1.5 : (h < 7 ? 1 - (h - 6) : 0));
    const ei = 0.08 + 0.85 * Math.max(0, Math.min(1, night));
    _M.lume.emissiveIntensity = ei;
    _fpMat.forEach(function (v, m) { if (m === _M.lume) v.emissiveIntensity = ei; });
  }

  /* ------------------------------------------------------------ measuring a wrist
     Cross-section of a mesh (its geometry transformed by M into the anchor
     frame) at `value` along axis ax. Returns the half extents along the two
     other axes (u = (ax+1)%3, w = (ax+2)%3), their centres, and squareness
     (1 = box corners, ~0.7 = round). Works for a box (two vertex levels) and
     a tube (a ring per level) alike: levels are bracketed and interpolated. */
  const _v = new THREE.Vector3();
  function sliceSection(geometry, M, ax, value) {
    const pos = geometry && geometry.attributes && geometry.attributes.position;
    if (!pos) return null;
    const u = (ax + 1) % 3, w = (ax + 2) % 3;
    const lv = new Map();
    for (let i = 0; i < pos.count; i++) {
      _v.fromBufferAttribute(pos, i);
      if (M) _v.applyMatrix4(M);
      const c = [_v.x, _v.y, _v.z], key = Math.round(c[ax] * 1e5);
      let L = lv.get(key);
      if (!L) { L = { at: c[ax], pts: [] }; lv.set(key, L); }
      L.pts.push(c[u], c[w]);
    }
    const levels = Array.from(lv.values()).sort(function (a, b) { return a.at - b.at; });
    for (const L of levels) {
      let u0 = Infinity, u1 = -Infinity, w0 = Infinity, w1 = -Infinity;
      for (let i = 0; i < L.pts.length; i += 2) {
        u0 = Math.min(u0, L.pts[i]); u1 = Math.max(u1, L.pts[i]);
        w0 = Math.min(w0, L.pts[i + 1]); w1 = Math.max(w1, L.pts[i + 1]);
      }
      L.hu = (u1 - u0) / 2; L.hw = (w1 - w0) / 2; L.cu = (u1 + u0) / 2; L.cw = (w1 + w0) / 2;
      let sq = 0;
      for (let i = 0; i < L.pts.length; i += 2) {
        const a = L.hu > 1e-9 ? Math.abs(L.pts[i] - L.cu) / L.hu : 0, b = L.hw > 1e-9 ? Math.abs(L.pts[i + 1] - L.cw) / L.hw : 0;
        sq = Math.max(sq, Math.min(a, b));
      }
      L.sq = sq;
    }
    // drop degenerate levels (a closed tube's cap centre)
    const good = levels.filter(function (L) { return L.hu > 1e-6 && L.hw > 1e-6; });
    if (!good.length) return null;
    let lo = good[0], hi = good[good.length - 1];
    for (let i = 0; i < good.length; i++) {
      if (good[i].at <= value) lo = good[i];
      if (good[i].at >= value) { hi = good[i]; break; }
    }
    if (value < good[0].at) lo = hi = good[0];
    if (value > good[good.length - 1].at) lo = hi = good[good.length - 1];
    const f = hi.at > lo.at ? (value - lo.at) / (hi.at - lo.at) : 0;
    const mix = function (a, b) { return a + (b - a) * f; };
    return { hu: mix(lo.hu, hi.hu), hw: mix(lo.hw, hi.hw), cu: mix(lo.cu, hi.cu), cw: mix(lo.cw, hi.cw), sq: Math.max(lo.sq, hi.sq), min: good[0].at, max: good[good.length - 1].at };
  }
  // a fit record from a section: a = across (wrist X), b = depth (wrist Z)
  // a, b: the wrist's half-extents the strap wraps; hs: the head's scale (the
  // hand's: rig units per real metre) — omitted, the old wrist-derived guess
  function makeFit(a, b, square, hs) {
    const s = hs > 0 ? hs : a / REF_HALF_WRIST;
    const rc = square > 0.9 ? Math.min(a, b) * 0.18 : Math.min(a, b) * 0.92;
    return { a: a, b: b, rc: rc, s: s, key: q4(a) + "|" + q4(b) + "|" + q4(rc) + "|" + q4(s) };
  }
  // the head's resting place on its instance: `drop` toward the hand, `sink` into the wrist
  function seatHead(inst, fit, drop, sink) {
    inst.userData.ww.head.position.set(0, -(drop || 0), fit.b + CLEAR * fit.s - (sink || 0));
  }
  function caseHeight(style) { const S = STYLES[style]; return S ? S.hc + S.hb : 0.01; }

  /* ------------------------------------------------------------ third person */
  const _m4 = new THREE.Matrix4();
  function matrixTo(mesh, anchor) {
    const M = new THREE.Matrix4();
    let o = mesh;
    while (o && o !== anchor) {
      o.updateMatrix();
      M.premultiply(o.matrix);
      o = o.parent;
    }
    return o === anchor ? M : null;
  }
  function anchorOf(rig) { return rig && ((rig.low && rig.low.la) || (rig.parts && rig.parts.la && rig.parts.la.userData && rig.parts.la.userData.low)) || null; }
  function sideOf(anchor) {
    const own = anchor && anchor.position ? anchor.position.x : 0;
    const up = anchor && anchor.parent && anchor.parent.position ? anchor.parent.position.x : 0;
    return (own || up) < 0 ? -1 : 1;
  }
  /* Where the watch sits on this rig's LEFT forearm, in the elbow group's
     frame: the forearm mesh is sliced at the watch line and the head is
     lifted clear of the wrist crease by its own radius. Measured with the
     forearm UNtwisted (character.js wristTwist turns it with a gun hand;
     sync() turns the watch with it). Sleeved: see WHERE IT SITS. */
  function rigPlacement(rig) {
    const anchor = anchorOf(rig);
    const fore = rig && rig.skinSlots && rig.skinSlots.armsLower && rig.skinSlots.armsLower[0];
    if (!anchor || !fore || !fore.geometry) return null;
    const tw = fore.rotation.y;
    fore.rotation.y = 0;
    try {
      const M = matrixTo(fore, anchor);
      if (!M) return null;
      const lm = CBZ.charArmLandmarks ? CBZ.charArmLandmarks(rig) : null;
      // the crease: the landmark, else the forearm mesh's own bottom
      let crease = lm && isFinite(lm.handTop) ? lm.handTop : null;
      const probe = sliceSection(fore.geometry, M, 1, crease != null ? crease + 0.05 : -1e9);
      if (!probe) return null;
      if (crease == null) crease = probe.min;
      // the head's scale: the hand's (rig units per metre, as drawn)
      const hand = rig.parts && rig.parts.la && rig.parts.la.userData && rig.parts.la.userData.cap;
      const sec0 = sliceSection(fore.geometry, M, 1, crease + 0.05);
      const hs = hand && hand.scale && hand.scale.x > 0 ? hand.scale.x : sec0.hu / REF_HALF_WRIST;
      const side = sideOf(anchor);
      // wrist frame: X = 12 o'clock, Y = toward the elbow, Z = dorsal (outboard)
      const q = new THREE.Quaternion().setFromRotationMatrix(_m4.makeBasis(
        new THREE.Vector3(0, 0, -side), new THREE.Vector3(0, 1, 0), new THREE.Vector3(side, 0, 0)));
      const sig = fore.geometry.uuid + "|" + q4(fore.scale.x) + "|" + q4(fore.scale.z);
      const spec = fore.userData && fore.userData.limb;
      if (spec && spec.variant === "cloth") {
        // UNDER THE SLEEVE: the real wrist (the hand's own, a little up the
        // arm) inside the cloth, the strap 2-4 cm (hand) above the hem,
        // the head dropped to the hem and sunk under the fabric (sync)
        const WR = CBZ.fpHands && CBZ.fpHands.WRIST;
        const y = crease + 0.030 * hs;
        // the cloth's narrowest inside over the strap's width, less the strap's own build
        let cu = Infinity, cw = Infinity;
        for (let dy = -0.012; dy <= 0.0121; dy += 0.004) {
          const c = sliceSection(fore.geometry, M, 1, y + dy * hs);
          cu = Math.min(cu, c.hu); cw = Math.min(cw, c.hw);
        }
        const room = (CLEAR + 0.0090) * hs;               // clearance + strap + buckle
        const a0 = WR ? WR.hw * 0.9 * hs : sec0.hu * 0.6, b0 = WR ? WR.ht * 0.95 * hs : sec0.hw * 0.6;   // a strap cinches the wrist a little
        const a = Math.max(a0, Math.min(a0 * 1.15, cu * 0.96 - room)), b = Math.max(b0, Math.min(b0 * 1.2, cw * 0.96 - room));
        const at = sliceSection(fore.geometry, M, 1, y);
        return { anchor: anchor, fit: makeFit(a, b, 0.7, hs), pos: new THREE.Vector3(at.cw, y, at.cu), quat: q, sig: sig,
          sleeve: true, drop: 0.030 * hs, crease: crease, foreGeo: fore.geometry, foreInv: M.clone().invert() };
      }
      const y = Math.min(probe.max - 0.02, crease + (0.0215 + 0.0045) * hs);
      const sec = sliceSection(fore.geometry, M, 1, y);
      return { anchor: anchor, fit: makeFit(sec.hu, sec.hw, sec.sq, hs), pos: new THREE.Vector3(sec.cw, y, sec.cu), quat: q, sig: sig, sleeve: false, drop: 0, crease: crease };
    } finally {
      fore.rotation.y = tw;
      fore.updateMatrix();
    }
  }
  /* How far a head sinks toward the arm so nothing of it above the hem is
     outside the sleeve: measured against the cloth loft itself
     (CBZ.humanLimbHalfAt, flats 3.4% in), by bisection, once per mount. */
  const _sv = new THREE.Vector3(), _sq = new THREE.Quaternion();
  function sleeveSink(place, style) {
    if (!place.sleeve || !CBZ.humanLimbHalfAt) return 0;
    const f = place.fit, pos = headGeometry(style).attributes.position;
    const out = function (sink) {
      for (let i = 0; i < pos.count; i++) {
        _sv.fromBufferAttribute(pos, i).multiplyScalar(f.s);
        _sv.y -= place.drop; _sv.z += f.b + CLEAR * f.s - sink;
        _sv.applyQuaternion(place.quat).add(place.pos);
        if (_sv.y <= place.crease + 0.001) continue;
        _sv.applyMatrix4(place.foreInv);
        const h = CBZ.humanLimbHalfAt(place.foreGeo, _sv.y);
        if (h && Math.hypot(_sv.x / (h.hx * 0.96), (_sv.z - h.cz) / (h.hz * 0.96)) > 1) return true;
      }
      return false;
    };
    if (!out(0)) return 0;
    let lo = 0, hi = 0.04 * f.s;
    for (let k = 0; k < 14; k++) { const m = (lo + hi) / 2; if (out(m)) lo = m; else hi = m; }
    return hi;
  }

  /* ------------------------------------------------------------ roles */
  function rnd(seed, salt) {
    let h = (seed ^ Math.imul(salt + 1, 0x9e3779b1)) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  function pickOf(list, r) { return list[Math.min(list.length - 1, Math.floor(r * list.length))]; }
  /* What this person wears on their wrist. `rec` = an outfit catalog record
     (city/outfits.js) when the wardrobe dressed them; else the build colours. */
  function roleFor(rig, c, rec, R) {
    const age = rig.ageYears;
    if (rig.child || (age != null && age < 16)) {
      return { tier: "kid", style: (age != null && age >= 7 && R(1) < 0.3) ? "kid" : null };
    }
    if (rec) {
      const id = rec.id || "", tier = rec.tier || "", nm = rec.name || "";
      if (tier === "kid" || rec.kid) return { tier: "kid", style: R(1) < 0.3 ? "kid" : null };
      if (tier === "institution") return { tier: "institution", style: R(2) < 0.55 ? "clear" : (R(3) < 0.45 ? "resin" : null) };
      if (id === "warden") return { tier: "law", style: "goldDress" };
      if (id === "swat" || id === "soldier" || id === "ski_patrol" || id === "tactical") return { tier: "law", style: "tactical" };
      if (rec.kit || /protective/i.test(nm)) return { tier: "law", style: "steelBlack" };
      if (rec.cop || tier === "law") return { tier: "law", style: R(2) < 0.8 ? "police" : "tactical" };
      if (id === "pilot") return { tier: "work", style: "pilot" };
      if (id === "doctor") return { tier: "work", style: R(2) < 0.7 ? "steel" : "smart" };
      if (id === "athletic" || id === "racer" || id === "lifeguard") return { tier: "work", style: R(2) < 0.5 ? "smart" : "tactical" };
      if (tier === "apex") return { tier: "apex", style: pickOf(["gold", "patek", "goldDress", "gold"], R(2)) };
      if (tier === "money") return { tier: "money", style: pickOf(["gold", "twoTone", "twoTone", "steel", "steelBlack"], R(2)) };
      if (tier === "fit") return { tier: "fit", style: R(2) < 0.35 ? null : pickOf(["steel", "smart", "steelBlack", "field"], R(3)) };
      if (tier === "work") return { tier: "work", style: R(2) < 0.45 ? null : pickOf(["field", "resin", "smart", "steel"], R(3)) };
      return { tier: "street", style: R(2) < 0.5 ? null : pickOf(["resin", "smart", "field", "resin"], R(3)) };
    }
    if (c && c.stripes) return { tier: "institution", style: R(2) < 0.55 ? "clear" : (R(3) < 0.45 ? "resin" : null) };
    if (c && c.badge) return { tier: "law", style: "police" };
    return { tier: "street", style: R(2) < 0.5 ? null : pickOf(["resin", "smart", "field", "steel"], R(3)) };
  }
  // the protagonist always has a watch (and in first person it is the clock)
  const PLAYER_DEFAULT = { institution: "clear", law: "police", kid: "kid", apex: "gold", money: "twoTone" };

  /* ------------------------------------------------------------ the roster */
  const reg = [];
  const anchorRig = new WeakMap();
  const mounted = new Set();
  let cursor = 0;
  function recOf(rig) { return rig && rig._ww || null; }
  function fit(rig, c) {
    if (!rig || !rig.group || rig._ww) return rig ? rig._ww : null;
    const seed = ((rig.phase || Math.random() * 6.28) * 1e6) | 0;
    const R = function (s) { return rnd(seed, s); };
    const role = roleFor(rig, c || null, null, R);
    const r = { rig: rig, seed: seed, R: R, tier: role.tier, role: role.style, over: null, overMark: null, inst: null, place: null, near: false, detachedT: 0 };
    rig._ww = r;
    const an = anchorOf(rig);
    if (an) anchorRig.set(an, rig);
    reg.push(r);
    return r;
  }
  // the wardrobe dressed this body: re-roll the role watch against the record
  function restyle(rig, rec) {
    const r = recOf(rig) || fit(rig, null);
    if (!r || !rec) return;
    const role = roleFor(rig, null, rec, r.R);
    r.tier = role.tier; r.role = role.style;
  }
  function styleOf(r) {
    if (!r) return null;
    if (r.over) return r.over;
    if (r.role) return r.role;
    if (r.rig === CBZ.playerChar && !r.rig.child) return PLAYER_DEFAULT[r.tier] || "field";
    return null;
  }
  // where a rig lives: "world" (CBZ.scene), "studio" (another scene: a portrait), or null
  function placeOf(rig) {
    let o = rig.group, top = null;
    for (let i = 0; o && i < 24; i++) { if (o.visible === false) return null; top = o; o = o.parent; }
    if (!top || top === rig.group) return null;
    if (CBZ.scene && top === CBZ.scene) return "world";
    return top.isScene ? "studio" : null;
  }
  function unmount(r) {
    if (r.inst) {
      if (r.inst.userData.ww.near) setNear(r.inst, false);
      if (r.inst.parent) r.inst.parent.remove(r.inst);
      r.inst = null;
    }
    mounted.delete(r);
  }
  const _twq = new THREE.Quaternion(), _twY = new THREE.Vector3(0, 1, 0);
  function sync(r, cam) {
    const rig = r.rig;
    if (r.overMark && r.overMark.parent !== r.place_anchor) { r.over = null; r.overMark = null; }
    const style = styleOf(r);
    const where = style ? placeOf(rig) : null;
    if (!where) {
      unmount(r);
      if (!rig.group.parent) { r.detachedT = r.detachedT || nowReal(); }
      return;
    }
    r.detachedT = 0;
    let near = where === "studio" || rig === CBZ.playerChar;
    if (!near) {
      const e = rig.group.matrixWorld.elements;
      if (!cam) { unmount(r); return; }
      const dx = e[12] - cam.x, dy = e[13] - cam.y, dz = e[14] - cam.z, d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > VIS_D * VIS_D) { unmount(r); return; }
      near = d2 < NEAR_D * NEAR_D;
    }
    // measure (once per forearm shape)
    const fore = rig.skinSlots && rig.skinSlots.armsLower && rig.skinSlots.armsLower[0];
    const sig = fore && fore.geometry ? fore.geometry.uuid + "|" + q4(fore.scale.x) + "|" + q4(fore.scale.z) : "";
    if (!r.place || r.place.sig !== sig) {
      r.place = rigPlacement(rig);
      if (r.inst) unmount(r);
      if (!r.place) return;
    }
    if (r.inst && (r.inst.userData.ww.style !== style || r.inst.parent !== r.place.anchor)) unmount(r);
    if (!r.inst) {
      r.inst = buildInstance(style, r.place.fit, false);
      seatHead(r.inst, r.place.fit, r.place.drop, sleeveSink(r.place, style));
      r.place.anchor.add(r.inst);
      r.tw = null;
    }
    // the forearm pronates with a gun hand (character.js wristTwist): so does the watch on it
    const tw = fore ? fore.rotation.y : 0;
    if (r.tw !== tw) {
      r.tw = tw;
      _twq.setFromAxisAngle(_twY, tw);
      r.inst.position.copy(r.place.pos).applyQuaternion(_twq);
      r.inst.quaternion.copy(r.place.quat).premultiply(_twq);
    }
    r.place_anchor = r.place.anchor;
    setNear(r.inst, near);
    mounted.add(r);
  }

  /* ------------------------------------------------------------ overrides (bling)
     attach(anchor, look) puts THAT watch on the rig owning `anchor` in place
     of its role watch; the returned marker is the handle — detach(marker), or
     simply removing it from the anchor (the portrait's strip), gives the wrist
     back to the role watch. Null if the anchor is no known wrist. */
  function attach(anchor, look) {
    const style = styleKey(look);
    const rig = anchor && anchorRig.get(anchor);
    if (!style || !rig) return null;
    const r = recOf(rig) || fit(rig, null);
    const mark = new THREE.Object3D();
    mark.name = "wristwatch-override";
    mark.userData.wristwatch = style;
    mark.userData.wwRig = rig;
    anchor.add(mark);
    r.over = style; r.overMark = mark; r.place_anchor = anchor;
    sync(r, camPos());
    return mark;
  }
  function detach(mark) {
    if (!mark) return;
    const rig = mark.userData && mark.userData.wwRig, r = recOf(rig);
    if (mark.parent) mark.parent.remove(mark);
    if (r && r.overMark === mark) { r.over = null; r.overMark = null; sync(r, camPos()); }
  }

  /* ------------------------------------------------------------ first person
     Every FP arm is laid by fpHands.poseArm; wrapping it puts the player's
     watch on the LEFT forearm, in the frame poseArm just wrote. Fore frame:
     +Z wrist->elbow, +Y the back of the hand; the watch frame maps X = -Xf,
     Y = Zf, Z = Yf (a proper rotation). */
  const FP_BASIS = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(
    new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0)));
  const _fq = new THREE.Quaternion(), _fp = new THREE.Vector3();
  /* The FP head under a sleeve: sunk until nothing of it up the arm from the
     cuff's lip stands outside the cuff's outer band (fphands foreHalf + the
     band's 3.5 mm), by bisection; cached per shape. Inst frame -> fore frame:
     x = -xf, y = zf, z = yf (FP_BASIS). */
  const _fpSink = new Map();
  function fpCuffSink(style, sec, kk, lf, zAlong, cx, cy, drop) {
    const H = CBZ.fpHands;
    if (!H || !H.math || !H.math.foreHalf) return 0;
    const key = style + "|" + q4(kk) + "|" + q4(lf / kk) + "|" + q4(sec.hw);
    if (_fpSink.has(key)) return _fpSink.get(key);
    const pos = headGeometry(style).attributes.position, band = 0.0035;
    const b = sec.hw * kk;
    const out = function (sink) {
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i) * kk, y = pos.getY(i) * kk - drop, z = pos.getZ(i) * kk + b + CLEAR * kk - sink;
        const xf = cx - x, zf = zAlong + y, yf = cy + z;
        if (zf <= 0.003 * kk) continue;
        const s = H.math.foreHalf(zf / lf);
        if (Math.hypot(xf / ((s.rx + band) * kk), yf / ((s.ry + band) * kk)) > 1) return true;
      }
      return false;
    };
    let sink = 0;
    if (out(0)) {
      let lo = 0, hi = 0.04 * kk;
      for (let k = 0; k < 14; k++) { const m = (lo + hi) / 2; if (out(m)) lo = m; else hi = m; }
      sink = hi;
    }
    _fpSink.set(key, sink);
    return sink;
  }
  function fpPlace(arm, wrist, elbow, shoulder, handQ, k, sleeved) {
    const P = arm && arm.userData && arm.userData.parts;
    if (!P || !P.fore) return;
    let st = arm.userData.ww;
    const lx = shoulder ? shoulder.x : (elbow.x - wrist.x);
    const style = lx < 0 ? styleOf(recOf(CBZ.playerChar)) : null;
    if (!style || arm.visible === false) { if (st && st.inst) st.inst.visible = false; return; }
    if (!st) st = arm.userData.ww = { inst: null, key: "" };
    const lf = Math.max(1e-4, P.fore.scale.z);
    const kk = k || 1;
    let a, b, zAlong, cx = 0, cy = 0, drop = 0, sink = 0;
    const R0 = 0.0215 + 0.0045;
    if (sleeved) {
      // under the cuff: the strap on the forearm's skin 3 cm up (inside the
      // sleeve cuff, which covers 0..5.9 cm), the head dropped to the cuff's
      // lip and sunk under its surface, so the dial peeks out past the cuff
      zAlong = 0.030 * kk;
      const sec = sliceSection(P.fore.geometry, null, 2, zAlong / lf);
      a = sec.hu * kk; b = sec.hw * kk; cx = sec.cu * kk; cy = sec.cw * kk;
      drop = 0.030 * kk;
      sink = fpCuffSink(style, sec, kk, lf, zAlong, cx, cy, drop);
    } else {
      zAlong = R0;
      const sec = sliceSection(P.fore.geometry, null, 2, zAlong * kk / lf);
      a = sec.hu * kk; b = sec.hw * kk; cx = sec.cu * kk; cy = sec.cw * kk;
      zAlong *= kk;
    }
    const fitR = makeFit(a, b, 0.7, kk);          // the head at the hand's scale
    const key = style + "|" + fitR.key;
    if (!st.inst || st.key !== key) {
      if (st.inst) { if (st.inst.userData.ww.near) setNear(st.inst, false); arm.remove(st.inst); }
      const fore = P.fore;
      const inst = buildInstance(style, fitR, !!(fore.material && fore.material.transparent));
      inst.renderOrder = fore.renderOrder || 0;
      inst.traverse(function (o) { o.renderOrder = inst.renderOrder; o.frustumCulled = false; });
      arm.add(inst);
      st.inst = inst; st.key = key;
      setNear(inst, true);
    }
    const inst = st.inst;
    inst.visible = true;
    seatHead(inst, fitR, drop, sink);
    // fore frame: x across, y dorsal, z along; the section centre is (cx, cy)
    _fp.set(-0 + cx, cy, zAlong).applyQuaternion(P.fore.quaternion).add(P.fore.position);
    inst.position.copy(_fp);
    _fq.copy(P.fore.quaternion).multiply(FP_BASIS);
    inst.quaternion.copy(_fq);
    tickInstance(inst, clockNow());
  }
  function wrapPoseArm() {
    const H = CBZ.fpHands;
    if (!H || typeof H.poseArm !== "function") return false;
    if (H.poseArm._ww) return true;
    const orig = H.poseArm;
    const w = function (arm, wrist, elbow, shoulder, handQ, k, sleeved) {
      const ret = orig.apply(this, arguments);
      try { fpPlace(arm, wrist, elbow, shoulder, handQ, k, sleeved); } catch (e) { /* a watch never breaks an arm */ }
      return ret;
    };
    w._ww = true; w._wwOrig = orig;
    H.poseArm = w;
    return true;
  }

  /* ------------------------------------------------------------ the wardrobe seam
     city/outfits.js's recolorRig IS the dressing (CBZ.human.dress delegates to
     it); wrap it lazily, as armor.js / pelts.js already do, so the role watch
     follows the record the body was dressed in. */
  function wrapRecolor() {
    const orig = CBZ.cityRecolorRig;
    if (typeof orig !== "function") return false;
    if (orig._wwWrapped) return true;
    const w = function (ch, colors, rec) {
      const ret = orig.apply(this, arguments);
      try { if (rec && ch && ch.skinSlots) restyle(ch, rec); } catch (e) { /* never break dressing */ }
      return ret;
    };
    w._wwWrapped = true; w._wwOrig = orig;
    CBZ.cityRecolorRig = w;
    return true;
  }

  /* ------------------------------------------------------------ per frame */
  const _cam = new THREE.Vector3();
  function camPos() {
    const c = CBZ.camera;
    if (!c || !c.matrixWorld) return null;
    const e = c.matrixWorld.elements;
    return _cam.set(e[12], e[13], e[14]);
  }
  let _wrappedArm = false, _wrappedDress = false;
  function update(dt) {
    _frame++;
    if (!_wrappedArm) _wrappedArm = wrapPoseArm();
    if (!_wrappedDress) _wrappedDress = wrapRecolor();
    tickLume(dt || 0.016);
    const cam = camPos();
    // what is mounted: re-judged every frame (it is a short list)
    mounted.forEach(function (r) { sync(r, cam); });
    // the roster, a slice at a time; long-detached bodies are forgotten
    const n = reg.length;
    if (n) {
      const now = nowReal();
      for (let i = 0; i < Math.min(SLICE, n); i++) {
        cursor = (cursor + 1) % reg.length;
        const r = reg[cursor];
        if (!r) continue;
        // bodies detached for a while are forgotten, but only once the roster
        // is big: pooled crowds park bodies off-graph and bring them back
        if (reg.length > 2000 && r.detachedT && now - r.detachedT > 15) {
          unmount(r); reg.splice(cursor, 1); cursor--; if (r.rig) r.rig._ww = null;
          if (!reg.length) break;
          continue;
        }
        if (!mounted.has(r)) sync(r, cam);
      }
    }
    const pr = recOf(CBZ.playerChar);
    if (pr && !mounted.has(pr)) sync(pr, cam);
    const t = clockNow();
    mounted.forEach(function (r) { if (r.inst) tickInstance(r.inst, t); });
  }
  if (typeof CBZ.onUpdate === "function") CBZ.onUpdate(36.2, update);
  else if (typeof CBZ.onAlways === "function") CBZ.onAlways(36.2, update);
  wrapPoseArm();

  /* ------------------------------------------------------------ a display piece
     A watch on a shop pillow (city/jewelry.js): wrapped round a cylinder of
     radius `radius` whose axis is +X, dial tilted `tilt` rad up from +Z, hands
     at 10:10 like every watch in every shop window. Real metres. */
  function display(look, radius, tilt) {
    const style = styleKey(look) || "steel";
    const f = makeFit(radius, radius, 0.7);
    const inst = buildInstance(style, f, false);
    setNear(inst, true);
    tickInstance(inst, { h: 10 + 10 / 60, m: 10, real: 38 });
    inst.userData.ww.near.sweep = false;
    const t = tilt || 0, c = Math.cos(t), s = Math.sin(t);
    inst.quaternion.setFromRotationMatrix(_m4.makeBasis(
      new THREE.Vector3(0, -c, s), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, s, c)));
    return inst;
  }

  CBZ.wristwatch = {
    version: 1,
    STYLES: STYLES,
    LOOK_STYLE: LOOK_STYLE,
    fit: fit,                       // character.js: every body built
    restyle: restyle,               // (rig, outfitRecord) — the wardrobe wrapper calls it
    wear: function (rig, style) {   // force a role watch (null = bare wrist)
      const r = recOf(rig) || fit(rig, null);
      if (r) { r.role = style ? styleKey(style) : null; sync(r, camPos()); }
      return r ? r.role : null;
    },
    styleOf: function (rig) { return styleOf(recOf(rig)); },
    attach: attach, detach: detach, display: display,
    count: function () { return mounted.size; },
    _test: { sliceSection, makeFit, rigPlacement, buildInstance, setNear, tickInstance, headGeometry, strapGeometry, loopPath, fpPlace, sync, recOf, lcdLayout, setLcd, SEG, gameHours, update },
  };
})();
