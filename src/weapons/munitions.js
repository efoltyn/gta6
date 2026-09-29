/* ============================================================
   weapons/munitions.js — EVERY ROUND IN THE AIR, DRAWN ONCE.

   One file owns what a munition LOOKS like and what it leaves behind:

   1. THE SHAPES. One cached, merged, vertex-coloured geometry per type,
      lathed from real profiles at real dimensions (metres), nose along +Z,
      origin at mid-length. Every type is ONE draw call (one shared Phong
      material with vertex colours); moving parts that must animate (a fuze
      arming vane, pop-out wings) are one extra mesh each.

         type     reference class                   L (m)   D (m)
         aam      AIM-120-class air-to-air           3.65   0.178
         atgm     Hellfire-class ATGM                1.63   0.178
         hydra    Hydra-class 70 mm rocket           1.45   0.070
         mlrs     MLRS-class 227 mm rocket           3.94   0.227
         patriot  Patriot (PAC-2 class) interceptor  5.31   0.410
         shell    120 mm HEAT tank round             0.98   0.120
         mk82     Mk-82 low-drag 500 lb              2.22   0.273
         mk84     Mk-84 low-drag 2000 lb             3.28   0.458
         jdam     Mk-84 + JDAM tail kit (GBU-31)     3.88   0.458
         gbu28    GBU-28-class bunker buster         5.84   0.368
         pg7      PG-7V (RPG-7 round, 85 mm bulb)    0.90   0.085
         g40      40 mm grenade                      0.11   0.040

   2. THE POOLS. acquire(type) hands out a pooled Object3D of that type,
      release(obj) takes it back. Nothing is built per shot.

   3. THE SMOKE AND FIRE. Two GPU point clouds (one draw call each) carry
      every trail puff, booster kick, backblast and motor flare in the game:
      the RPG (systems/fpsmode.js), every pooled missile (city/aircraft.js).
      Smoke billows, drifts downwind, fades slowly; the oldest puff recycles
      when the cap is hit. The first FLARE_CAP fire slots are reserved motor
      flares a launcher claims once and rewrites every frame.

   4. THE ATTACHED PLUME. CBZ.createRocketPlume / CBZ.setRocketPlume, the
      afterburner/booster cone every propelled machine wears (jets, the
      chop-shop booster). It used to live in island_military.js.

   Zero per-frame allocation: all scratch is module-level.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ = window.CBZ || {};
  const THREE = window.THREE;
  if (!THREE || CBZ.munitions) return;

  // ---------------------------------------------------------------- kit ----
  // A lathe about +Z from [r, z] points ascending in z (outward faces).
  function latheZ(pts, segs) {
    const v = [];
    for (let i = 0; i < pts.length; i++) v.push(new THREE.Vector2(Math.max(0, pts[i][0]), pts[i][1]));
    const g = new THREE.LatheGeometry(v, segs || 16);
    g.rotateX(Math.PI / 2);                 // lathe +Y axis → +Z
    return g;
  }
  // A thin planform fin. `plan` is [[s, z], ...] with s = distance from the
  // body axis and z along it; extruded `thick` across; rolled to angle a.
  const _m4 = new THREE.Matrix4(), _ra = new THREE.Vector3(), _ax = new THREE.Vector3(0, 0, 1), _tg = new THREE.Vector3();
  function fin(plan, thick, a) {
    const sh = new THREE.Shape();
    sh.moveTo(plan[0][0], plan[0][1]);
    for (let i = 1; i < plan.length; i++) sh.lineTo(plan[i][0], plan[i][1]);
    sh.lineTo(plan[0][0], plan[0][1]);
    const g = new THREE.ExtrudeGeometry(sh, { depth: thick, bevelEnabled: false, steps: 1 });
    g.translate(0, 0, -thick / 2);
    _ra.set(Math.cos(a), Math.sin(a), 0);
    _tg.set(Math.sin(a), -Math.cos(a), 0);   // radial × axis: right-handed basis
    _m4.makeBasis(_ra, _ax, _tg);
    g.applyMatrix4(_m4);
    return g;
  }
  function fins(n, plan, thick, a0) {
    const out = [];
    for (let i = 0; i < n; i++) out.push(fin(plan, thick, (a0 || 0) + i * Math.PI * 2 / n));
    return out;
  }
  function box(w, h, d, x, y, z) {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(x || 0, y || 0, z || 0);
    return g;
  }
  // an applied band: a hair proud of the skin, with shoulders
  function band(R, z0, z1, k) {
    const r1 = R * (k || 1.012);
    return latheZ([[R * 0.99, z0], [r1, z0], [r1, z1], [R * 0.99, z1]], 18);
  }
  // tangent ogive from shoulder (z0, radius R) to tip (z0 + Ln, radius tipR)
  function ogive(R, Ln, z0, n, tipR) {
    const rho = (R * R + Ln * Ln) / (2 * R), out = [];
    for (let i = 0; i <= n; i++) {
      const x = Ln * (1 - i / n);          // distance from the tip
      const r = Math.sqrt(Math.max(0, rho * rho - (Ln - x) * (Ln - x))) + R - rho;
      out.push([Math.max(tipR || 0, r), z0 + Ln * i / n]);
    }
    return out;
  }
  // Merge [{g, c}] into one non-indexed geometry with a colour attribute.
  const _col = new THREE.Color();
  function merge(parts) {
    let n = 0;
    const gs = [];
    for (let i = 0; i < parts.length; i++) {
      let g = parts[i].g;
      if (g.index) g = g.toNonIndexed();
      if (!g.attributes.normal) g.computeVertexNormals();
      gs.push(g); n += g.attributes.position.count;
    }
    const P = new Float32Array(n * 3), N = new Float32Array(n * 3), C = new Float32Array(n * 3);
    let o = 0;
    for (let i = 0; i < gs.length; i++) {
      const p = gs[i].attributes.position, q = gs[i].attributes.normal;
      _col.setHex(parts[i].c);
      for (let k = 0; k < p.count; k++, o++) {
        P[o * 3] = p.getX(k); P[o * 3 + 1] = p.getY(k); P[o * 3 + 2] = p.getZ(k);
        N[o * 3] = q.getX(k); N[o * 3 + 1] = q.getY(k); N[o * 3 + 2] = q.getZ(k);
        C[o * 3] = _col.r; C[o * 3 + 1] = _col.g; C[o * 3 + 2] = _col.b;
      }
      if (gs[i] !== parts[i].g) gs[i].dispose();
      parts[i].g.dispose();
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute("position", new THREE.BufferAttribute(P, 3));
    out.setAttribute("normal", new THREE.BufferAttribute(N, 3));
    out.setAttribute("color", new THREE.BufferAttribute(C, 3));
    out.computeBoundingSphere();
    out.computeBoundingBox();
    out._shared = true;
    return out;
  }

  // ------------------------------------------------------------- palette ---
  const COL = {
    od: 0x4b5320, odD: 0x3a4020, odL: 0x5f6636, tan: 0xb9a878,
    grey: 0x9ea4a8, greyL: 0xc3c8cc, greyD: 0x5d6368, white: 0xe6e6e1, radome: 0xdcd6c6,
    steel: 0x7a7f84, dark: 0x1f2226, glass: 0x1a2630, yellow: 0xc9a414, brown: 0x6b4a2a, black: 0x16181a,
  };

  // ---------------------------------------------------------------- specs --
  // L, D in metres; burn = motor seconds (Infinity = burns the whole flight,
  // 0 = no motor); trail = smoke look; flare = motor flare size (m).
  const SPEC = {
    aam:     { L: 3.65, D: 0.178, burn: 2.8, flare: 0.55, trail: { s0: 0.35, s1: 2.2, life: 2.6, a0: 0.34, shade: 0.9, spacing: 2.4 } },
    atgm:    { L: 1.63, D: 0.178, burn: 2.6, flare: 0.45, trail: { s0: 0.3, s1: 1.8, life: 2.4, a0: 0.38, shade: 0.82, spacing: 2.0 } },
    hydra:   { L: 1.45, D: 0.070, burn: 1.1, flare: 0.40, trail: { s0: 0.3, s1: 2.4, life: 3.2, a0: 0.55, shade: 0.8, spacing: 1.6 } },
    mlrs:    { L: 3.94, D: 0.227, burn: 1.8, flare: 0.90, trail: { s0: 0.6, s1: 3.6, life: 4.0, a0: 0.6, shade: 0.78, spacing: 2.2 } },
    patriot: { L: 5.31, D: 0.410, burn: Infinity, flare: 1.30, trail: { s0: 0.9, s1: 5.0, life: 4.2, a0: 0.62, shade: 0.86, spacing: 2.2 } },
    shell:   { L: 0.98, D: 0.120, burn: Infinity, flare: 0.28, tracer: true, trail: null },
    mk82:    { L: 2.22, D: 0.273 },
    mk84:    { L: 3.28, D: 0.458 },
    jdam:    { L: 3.88, D: 0.458 },
    gbu28:   { L: 5.84, D: 0.368 },
    pg7:     { L: 0.90, D: 0.085 },
    g40:     { L: 0.11, D: 0.040 },
  };

  // ---- builders: each returns { body:[{g,c}], vane?, wings? } ----
  const BUILD = {
    // AIM-120-class: ogive radome, long wings mid-body, clipped-delta tail
    // controls, yellow warhead band, brown motor band, dark nozzle.
    aam: function (s) {
      const L = s.L, R = s.D / 2, zt = -L / 2, zn = L / 2, noseL = 0.56;
      const P = [];
      P.push({ g: latheZ([[0, zt], [R * 0.62, zt], [R * 0.9, zt + 0.06], [R, zt + 0.14]], 18), c: COL.dark });
      P.push({ g: latheZ([[R, zt + 0.14], [R, zn - noseL]], 18), c: COL.greyL });
      P.push({ g: latheZ(ogive(R, noseL, zn - noseL, 10, 0.004).concat([[0, zn]]), 18), c: COL.radome });
      P.push({ g: band(R, 0.72, 0.80), c: COL.yellow });
      P.push({ g: band(R, -0.30, -0.24), c: COL.brown });
      fins(4, [[R * 0.9, -0.28], [R * 0.9, 0.12], [R + 0.174, 0.02], [R + 0.174, -0.22]], 0.008, Math.PI / 4).forEach((g) => P.push({ g, c: COL.grey }));
      fins(4, [[R * 0.9, zt + 0.05], [R * 0.9, zt + 0.30], [R + 0.135, zt + 0.10], [R + 0.135, zt + 0.03]], 0.008, Math.PI / 4).forEach((g) => P.push({ g, c: COL.grey }));
      return { body: P };
    },
    // Hellfire-class: blunt faceted nose with the laser seeker's glass dome,
    // short cruciform wings, small tail controls, olive drab.
    atgm: function (s) {
      const L = s.L, R = s.D / 2, zt = -L / 2, zn = L / 2;
      const P = [];
      P.push({ g: latheZ([[0, zt], [R * 0.55, zt], [R * 0.85, zt + 0.03], [R, zt + 0.08]], 16), c: COL.dark });
      P.push({ g: latheZ([[R, zt + 0.08], [R, zn - 0.26]], 16), c: COL.od });
      P.push({ g: latheZ([[R, zn - 0.26], [R * 0.93, zn - 0.16], [R * 0.72, zn - 0.07]], 16), c: COL.od });
      P.push({ g: latheZ([[R * 0.72, zn - 0.07], [R * 0.66, zn - 0.045], [R * 0.5, zn - 0.02], [R * 0.28, zn - 0.004], [0, zn]], 16), c: COL.glass });
      P.push({ g: band(R, zn - 0.42, zn - 0.36), c: COL.yellow });
      P.push({ g: band(R, -0.22, -0.17), c: COL.brown });
      fins(4, [[R * 0.9, -0.12], [R * 0.9, 0.18], [R + 0.075, 0.08], [R + 0.075, -0.08]], 0.007, Math.PI / 4).forEach((g) => P.push({ g, c: COL.odD }));
      fins(4, [[R * 0.9, zt + 0.04], [R * 0.9, zt + 0.16], [R + 0.05, zt + 0.1], [R + 0.05, zt + 0.04]], 0.006, Math.PI / 4).forEach((g) => P.push({ g, c: COL.odD }));
      return { body: P };
    },
    // Hydra-class: slim grey motor tube, olive M151-style warhead with a
    // yellow HE band, point-detonating fuze, four wrap-around fins at the tail.
    hydra: function (s) {
      const L = s.L, R = s.D / 2, zt = -L / 2, zn = L / 2, whL = 0.42;
      const P = [];
      P.push({ g: latheZ([[0, zt], [R * 0.7, zt], [R, zt + 0.03]], 12), c: COL.dark });
      P.push({ g: latheZ([[R, zt + 0.03], [R, zn - whL]], 12), c: COL.greyL });
      P.push({ g: latheZ([[R, zn - whL], [R * 1.08, zn - whL + 0.02], [R * 1.08, zn - 0.24]].concat(ogive(R * 1.08, 0.2, zn - 0.24, 6, 0.012).slice(1)), 12), c: COL.od });
      P.push({ g: latheZ([[0.012, zn - 0.04], [0.009, zn - 0.01], [0, zn]], 8), c: COL.steel });
      P.push({ g: band(R * 1.08, zn - 0.36, zn - 0.33), c: COL.yellow });
      fins(4, [[R * 0.9, zt + 0.01], [R * 0.9, zt + 0.1], [R + 0.06, zt + 0.08], [R + 0.06, zt + 0.02]], 0.003, 0).forEach((g) => P.push({ g, c: COL.greyD }));
      return { body: P };
    },
    // MLRS-class 227 mm: long ogive, olive body, four tail fins.
    mlrs: function (s) {
      const L = s.L, R = s.D / 2, zt = -L / 2, zn = L / 2, noseL = 0.62;
      const P = [];
      P.push({ g: latheZ([[0, zt], [R * 0.72, zt], [R, zt + 0.06]], 16), c: COL.dark });
      P.push({ g: latheZ([[R, zt + 0.06], [R, zn - noseL]], 16), c: COL.odL });
      P.push({ g: latheZ(ogive(R, noseL, zn - noseL, 9, 0.006).concat([[0, zn]]), 16), c: COL.odL });
      P.push({ g: band(R, zn - noseL - 0.12, zn - noseL - 0.06), c: COL.yellow });
      fins(4, [[R * 0.9, zt + 0.02], [R * 0.9, zt + 0.34], [R + 0.16, zt + 0.22], [R + 0.16, zt + 0.04]], 0.006, Math.PI / 4).forEach((g) => P.push({ g, c: COL.odD }));
      return { body: P };
    },
    // Patriot (PAC-2 class): white airframe, off-white ogive radome, grey
    // clipped-delta tail fins, dark joint band behind the radome.
    patriot: function (s) {
      const L = s.L, R = s.D / 2, zt = -L / 2, zn = L / 2, noseL = 1.02;
      const P = [];
      P.push({ g: latheZ([[0, zt], [R * 0.6, zt], [R * 0.88, zt + 0.08], [R, zt + 0.2]], 20), c: COL.dark });
      P.push({ g: latheZ([[R, zt + 0.2], [R, zn - noseL]], 20), c: COL.white });
      P.push({ g: latheZ(ogive(R, noseL, zn - noseL, 12, 0.008).concat([[0, zn]]), 20), c: COL.radome });
      P.push({ g: band(R, zn - noseL - 0.06, zn - noseL), c: COL.greyD });
      P.push({ g: band(R, -0.4, -0.34), c: COL.greyD });
      fins(4, [[R * 0.9, zt + 0.06], [R * 0.9, zt + 1.0], [R + 0.23, zt + 0.42], [R + 0.23, zt + 0.08]], 0.014, Math.PI / 4).forEach((g) => P.push({ g, c: COL.grey }));
      return { body: P };
    },
    // 120 mm HEAT: standoff probe, cone, body, slim tail boom, four fins.
    shell: function (s) {
      const L = s.L, R = s.D / 2, zt = -L / 2, zn = L / 2;
      const P = [];
      P.push({ g: latheZ([[0, zt], [0.024, zt], [0.024, zt + 0.34], [0.034, zt + 0.40], [R, zt + 0.46], [R, zt + 0.62], [R * 0.9, zt + 0.66]], 14), c: COL.odD });
      P.push({ g: latheZ([[R * 0.9, zt + 0.66], [0.024, zn - 0.2], [0.013, zn - 0.19], [0.013, zn - 0.01], [0, zn]], 14), c: COL.odD });
      P.push({ g: band(R, zt + 0.50, zt + 0.54), c: COL.yellow });
      fins(4, [[0.02, zt], [0.02, zt + 0.12], [0.06, zt + 0.06], [0.06, zt]], 0.004, Math.PI / 4).forEach((g) => P.push({ g, c: COL.steel }));
      return { body: P };
    },
    mk82: function (s) { return lowDrag(s, 0.74, 0.55, 0.192, 0.40); },
    mk84: function (s) { return lowDrag(s, 1.10, 0.78, 0.320, 0.58); },
    // Mk-84 + JDAM: proximity-fuze nose, two lateral strakes, the tail kit's
    // cylindrical housing and four moving control fins in an X.
    jdam: function (s) {
      const L = s.L, R = s.D / 2, zt = -L / 2, zn = L / 2, kitL = 0.95, noseL = 1.08;
      const P = [];
      const zb = zt + kitL;                          // body/kit joint
      P.push({ g: latheZ([[0, zt], [R * 0.66, zt], [R * 0.74, zt + 0.06], [R * 0.74, zb - 0.30], [R * 0.86, zb - 0.12], [R * 0.94, zb]], 18), c: COL.grey });
      P.push({ g: latheZ([[R * 0.94, zb], [R, zb + 0.1], [R, zn - noseL]], 20), c: COL.od });
      P.push({ g: latheZ(ogive(R, noseL - 0.06, zn - noseL, 10, 0.05), 20), c: COL.od });
      P.push({ g: latheZ([[0.05, zn - 0.06], [0.046, zn - 0.03], [0.03, zn - 0.01], [0, zn]], 10), c: COL.greyD });   // proximity-sensor fuze dome
      P.push({ g: band(R, zn - noseL - 0.14, zn - noseL - 0.08), c: COL.yellow });
      P.push({ g: band(R, zn - noseL - 0.3, zn - noseL - 0.24), c: COL.yellow });
      // strake kit: two flat strakes along the flanks
      [0, Math.PI].forEach((a) => P.push({ g: fin([[R * 0.95, -0.5], [R * 0.95, 0.55], [R + 0.07, 0.45], [R + 0.07, -0.42]], 0.012, a), c: COL.grey }));
      fins(4, [[R * 0.7, zt + 0.02], [R * 0.7, zt + 0.52], [0.32, zt + 0.24], [0.32, zt + 0.04]], 0.012, Math.PI / 4).forEach((g) => P.push({ g, c: COL.grey }));
      return { body: P };
    },
    // GBU-28-class: long penetrator, Paveway-style seeker head with glass and
    // four canards; the tail wings are a SEPARATE mesh that pops out after
    // release (wings, below).
    gbu28: function (s) {
      const L = s.L, R = s.D / 2, zt = -L / 2, zn = L / 2;
      const P = [];
      const seekL = 0.62, zs = zn - seekL;
      P.push({ g: latheZ([[0, zt], [R * 0.82, zt], [R * 0.92, zt + 0.1], [R * 0.92, zt + 0.72], [R, zt + 0.8]], 18), c: COL.greyD });
      P.push({ g: latheZ([[R, zt + 0.8], [R, zs - 0.34]].concat(ogive(R, 0.34, zs - 0.34, 4, R * 0.62).slice(1)), 18), c: COL.odD });
      P.push({ g: latheZ([[R * 0.62, zs], [R * 0.62, zn - 0.12], [R * 0.55, zn - 0.06]], 16), c: COL.grey });
      P.push({ g: latheZ([[R * 0.55, zn - 0.06], [R * 0.4, zn - 0.02], [0, zn]], 16), c: COL.glass });
      P.push({ g: band(R, zs - 0.6, zs - 0.52), c: COL.yellow });
      P.push({ g: band(R, zs - 0.78, zs - 0.70), c: COL.yellow });
      fins(4, [[R * 0.55, zs + 0.08], [R * 0.55, zs + 0.42], [R * 0.62 + 0.16, zs + 0.18], [R * 0.62 + 0.16, zs + 0.10]], 0.01, Math.PI / 4).forEach((g) => P.push({ g, c: COL.grey }));
      const W = fins(4, [[R * 0.85, zt + 0.12], [R * 0.85, zt + 0.66], [0.8, zt + 0.38], [0.8, zt + 0.16]], 0.016, Math.PI / 4).map((g) => ({ g, c: COL.grey }));
      return { body: P, wings: W };
    },
    // PG-7V, from the launcher's own profile (weapons/appearances/bazooka.js)
    // so the round that flies IS the round that was seated.
    pg7: function (s) {
      const RR = CBZ.rpgRound;
      const prof = RR ? RR.flightProfile() : [[0, -0.9], [0.02, -0.9], [0.02, -0.4], [0.0425, -0.29], [0.0425, -0.195], [0, 0]];
      // profile is nose at y=0, tail at -0.90: centre it on z
      const P = [];
      const mid = -s.L / 2;
      const motor = [], war = [];
      for (let i = 0; i < prof.length; i++) (prof[i][1] < -0.4 + 1e-6 ? motor : war).push([prof[i][0], prof[i][1] - mid]);
      war.unshift(motor[motor.length - 1]);
      P.push({ g: latheZ(motor, 14), c: COL.greyD });
      P.push({ g: latheZ(war, 16), c: COL.od });
      P.push({ g: band(0.0425, 0.162, 0.174, 1.01), c: COL.black });   // stencil band at the back of the bulb
      return { body: P };
    },
    g40: function (s) {
      const pts = [[0, -0.11], [0.021, -0.11], [0.021, -0.045], [0.020, -0.036], [0.017, -0.020], [0.011, -0.007], [0.005, 0], [0, 0]];
      return { body: [{ g: latheZ(pts.map((p) => [p[0], p[1] + 0.055]), 12), c: 0x6b6f52 }, { g: band(0.021, -0.02, -0.005, 1.03), c: COL.yellow }] };
    },
  };
  // Low-drag general-purpose bomb (Mk-80 family): tangent-ogive nose with
  // a nose fuze (+ spinning arming vane), parallel body, yellow HE band,
  // boat-tail and a conical four-fin tail assembly.
  function lowDrag(s, noseL, tailL, finTip, finChord) {
    const L = s.L, R = s.D / 2, zt = -L / 2, zn = L / 2;
    const P = [];
    const fuzeR = R * 0.18, fuzeL = 0.08, zShoulder = zn - fuzeL - noseL;
    P.push({ g: latheZ([[0, zt], [R * 0.56, zt], [R * 0.6, zt + 0.04], [R * 0.8, zt + tailL * 0.55], [R, zt + tailL]], 18), c: COL.od });
    P.push({ g: latheZ([[R, zt + tailL], [R, zShoulder]].concat(ogive(R, noseL, zShoulder, 10, fuzeR).slice(1)), 20), c: COL.od });
    P.push({ g: latheZ([[fuzeR, zn - fuzeL], [fuzeR * 0.9, zn - 0.03], [fuzeR * 0.55, zn - 0.005], [0, zn]], 10), c: COL.steel });
    P.push({ g: band(R, zShoulder - 0.06, zShoulder - 0.02), c: COL.yellow });
    P.push({ g: band(R, zShoulder + noseL * 0.25, zShoulder + noseL * 0.25 + 0.035, 1.0), c: COL.yellow });
    // suspension lugs, 14 in apart (NATO), on top
    P.push({ g: box(0.04, 0.05, 0.07, 0, R + 0.02, 0.178), c: COL.steel });
    P.push({ g: box(0.04, 0.05, 0.07, 0, R + 0.02, -0.178), c: COL.steel });
    // conical fin assembly: fins root on the boat-tail, tips at finTip
    fins(4, [[R * 0.62, zt + 0.02], [R * 0.72, zt + finChord], [finTip, zt + finChord * 0.35], [finTip, zt + 0.02]], 0.01, Math.PI / 4).forEach((g) => P.push({ g, c: COL.odD }));
    // the conical fin can joining the tips
    P.push({ g: latheZ([[finTip * 0.98, zt + 0.02], [finTip, zt + 0.02], [finTip * 0.92, zt + finChord * 0.35], [finTip * 0.9, zt + finChord * 0.35]], 18), c: COL.odD });
    // arming vane: two little blades on the fuze tip, a separate mesh
    const V = [
      { g: box(fuzeR * 3.2, 0.004, 0.02, 0, 0, 0), c: COL.steel },
      { g: box(0.004, fuzeR * 3.2, 0.02, 0, 0, 0), c: COL.steel },
    ];
    V[0].g.rotateY(0.35); V[1].g.rotateX(0.35);
    return { body: P, vane: V, vaneZ: zn - 0.045 };
  }

  // -------------------------------------------------- cache + materials ----
  const GEO = Object.create(null);
  function geos(type) {
    let e = GEO[type];
    if (e) return e;
    const s = SPEC[type];
    if (!s) return null;
    const b = BUILD[type](s);
    e = { body: merge(b.body), vane: b.vane ? merge(b.vane) : null, vaneZ: b.vaneZ || 0,
      wings: b.wings ? merge(b.wings) : null };
    GEO[type] = e;
    return e;
  }
  let MAT = null;
  function mats() {
    if (MAT) return MAT;
    MAT = {
      body: new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 28, specular: 0x2a2c2e }),
      tracer: new THREE.MeshBasicMaterial({ color: 0xff5a2a }),
    };
    MAT.body._shared = true; MAT.tracer._shared = true;
    return MAT;
  }

  // ---------------------------------------------------------------- pools --
  const POOL = Object.create(null);
  const POOL_CAP = 24;                     // per type; more than that are built and freed
  let made = 0;
  function build(type) {
    const G = geos(type);
    if (!G) return null;
    const M = mats();
    const grp = new THREE.Group();
    grp.name = "munition:" + type;
    const body = new THREE.Mesh(G.body, M.body);
    body.castShadow = true;
    grp.add(body);
    grp.userData.munition = type;
    grp.userData.body = body;
    if (G.vane) {
      const v = new THREE.Mesh(G.vane, M.body);
      v.position.z = G.vaneZ;
      grp.add(v);
      grp.userData.vane = v;
    }
    if (G.wings) {
      const w = new THREE.Mesh(G.wings, M.body);
      grp.add(w);
      grp.userData.wings = w;
    }
    if (SPEC[type].tracer) {
      const t = new THREE.Mesh(tracerGeo(), M.tracer);
      t.position.z = -SPEC[type].L / 2 - 0.01;
      grp.add(t);
    }
    made++;
    return grp;
  }
  let _tracerGeo = null;
  function tracerGeo() {
    if (!_tracerGeo) { _tracerGeo = new THREE.CircleGeometry(0.02, 8); _tracerGeo.rotateY(Math.PI); _tracerGeo._shared = true; }
    return _tracerGeo;
  }
  function reset(o) {
    o.position.set(0, 0, 0); o.rotation.set(0, 0, 0); o.scale.set(1, 1, 1); o.visible = true;
    const u = o.userData;
    if (u.vane) u.vane.rotation.z = 0;
    if (u.wings) u.wings.scale.set(1, 1, 1);
  }
  function acquire(type) {
    const p = POOL[type];
    const o = p && p.length ? p.pop() : build(type);
    if (o) reset(o);
    return o;
  }
  function release(o) {
    if (!o) return;
    if (o.parent) o.parent.remove(o);
    const t = o.userData && o.userData.munition;
    if (!t) return;
    const p = POOL[t] || (POOL[t] = []);
    if (p.length < POOL_CAP) p.push(o);
  }
  // fall attitude dressing for a bomb: vane spins with airspeed, pop-out
  // wings deploy over the first `deploy` seconds after release
  function dressBomb(o, age, dt, speed) {
    const u = o && o.userData;
    if (!u) return;
    if (u.vane) u.vane.rotation.z += dt * Math.min(90, 0.8 * (speed || 0));
    if (u.wings) {
      const k = Math.max(0, Math.min(1, (age - 0.25) / 0.35));
      const e = 0.18 + 0.82 * (1 - (1 - k) * (1 - k));
      u.wings.scale.set(e, e, 1);
    }
  }

  // ======================================================= SMOKE & FIRE ====
  let _fxs = 0x2f6b9d1;
  function fxr() { _fxs = (_fxs * 1664525 + 1013904223) >>> 0; return _fxs / 4294967296; }
  let puffTex = null;
  function makePuffTex() {
    if (puffTex) return puffTex;
    if (typeof document === "undefined" || !document.createElement) return null;
    const c = document.createElement("canvas"); c.width = c.height = 64;
    const x = c.getContext("2d");
    const blob = (cx, cy, r, a) => {
      const g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, "rgba(255,255,255," + a + ")"); g.addColorStop(0.55, "rgba(255,255,255," + (a * 0.55) + ")");
      g.addColorStop(1, "rgba(255,255,255,0)");
      x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    };
    blob(32, 32, 26, 0.75);
    blob(22, 26, 14, 0.45); blob(42, 24, 13, 0.4); blob(38, 42, 15, 0.45); blob(24, 40, 12, 0.35);
    puffTex = new THREE.CanvasTexture(c);
    return puffTex;
  }
  const PUFF_VS = [
    "attribute float aSize; attribute float aAlpha; attribute float aRot; attribute vec3 aCol;",
    "uniform float uScale; varying float vA; varying float vR; varying vec3 vC;",
    "#include <fog_pars_vertex>",
    "void main() {",
    "  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);",
    "  gl_Position = projectionMatrix * mvPosition;",
    "  gl_PointSize = aAlpha > 0.001 ? aSize * uScale / max(0.05, -mvPosition.z) : 0.0;",
    "  vA = aAlpha; vR = aRot; vC = aCol;",
    "  #include <fog_vertex>",
    "}",
  ].join("\n");
  const PUFF_FS = [
    "uniform sampler2D map; uniform float uLight; varying float vA; varying float vR; varying vec3 vC;",
    "#include <fog_pars_fragment>",
    "void main() {",
    "  vec2 p = gl_PointCoord - 0.5; float c = cos(vR), s = sin(vR);",
    "  p = vec2(c * p.x - s * p.y, s * p.x + c * p.y) + 0.5;",
    "  vec4 t = texture2D(map, p);",
    "  gl_FragColor = vec4(vC * uLight, t.a * vA);",
    "  if (gl_FragColor.a < 0.004) discard;",
    "  #include <fog_fragment>",
    "}",
  ].join("\n");
  function makeCloud(n, additive, reserved) {
    const geo = new THREE.BufferGeometry();
    const A = {
      pos: new Float32Array(n * 3), col: new Float32Array(n * 3),
      size: new Float32Array(n), alpha: new Float32Array(n), rot: new Float32Array(n),
    };
    geo.setAttribute("position", new THREE.BufferAttribute(A.pos, 3));
    geo.setAttribute("aCol", new THREE.BufferAttribute(A.col, 3));
    geo.setAttribute("aSize", new THREE.BufferAttribute(A.size, 1));
    geo.setAttribute("aAlpha", new THREE.BufferAttribute(A.alpha, 1));
    geo.setAttribute("aRot", new THREE.BufferAttribute(A.rot, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uScale: { value: 500 }, uLight: { value: 1 }, map: { value: null } }]),
      vertexShader: PUFF_VS, fragmentShader: PUFF_FS,
      transparent: true, depthWrite: false, depthTest: true, fog: !additive,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    mat.uniforms.map.value = makePuffTex();
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    pts.renderOrder = additive ? 3 : 2;
    pts.name = additive ? "munitions:fire" : "munitions:smoke";
    return {
      n: n, A: A, geo: geo, mat: mat, pts: pts, reserved: reserved || 0, next: reserved || 0, live: 0, dirty: true,
      life: new Float32Array(n), max: new Float32Array(n),
      vel: new Float32Array(n * 3), s0: new Float32Array(n), s1: new Float32Array(n),
      a0: new Float32Array(n), drag: new Float32Array(n), rise: new Float32Array(n),
      spinV: new Float32Array(n), windK: new Float32Array(n), fadeIn: new Float32Array(n),
    };
  }
  const SMOKE_CAP = 420, FIRE_CAP = 96, FLARE_CAP = 32;
  let smoke = null, fire = null, flaresClaimed = 0;
  function clouds() {
    if (!smoke) {
      smoke = makeCloud(SMOKE_CAP, false, 0);
      fire = makeCloud(FIRE_CAP + FLARE_CAP, true, FLARE_CAP);
    }
    const sc = CBZ.scene;
    if (sc) {
      if (smoke.pts.parent !== sc) sc.add(smoke.pts);
      if (fire.pts.parent !== sc) sc.add(fire.pts);
    }
    return smoke;
  }
  const WIND_X = 0.9, WIND_Z = 0.45;          // a light breeze the smoke drifts on (m/s)
  function puff(C, x, y, z, vx, vy, vz, s0, s1, life, a0, r, g, b, o) {
    let i = C.next;
    C.next = i + 1 >= C.n ? C.reserved : i + 1;   // oldest recycled
    const A = C.A, i3 = i * 3;
    A.pos[i3] = x; A.pos[i3 + 1] = y; A.pos[i3 + 2] = z;
    A.col[i3] = r; A.col[i3 + 1] = g; A.col[i3 + 2] = b;
    A.size[i] = s0; A.alpha[i] = 0; A.rot[i] = fxr() * 6.283;
    C.vel[i3] = vx; C.vel[i3 + 1] = vy; C.vel[i3 + 2] = vz;
    C.s0[i] = s0; C.s1[i] = s1; C.a0[i] = a0; C.life[i] = C.max[i] = life;
    C.drag[i] = o && o.drag != null ? o.drag : 1.6;
    C.rise[i] = o && o.rise != null ? o.rise : 0.22;
    C.windK[i] = o && o.wind != null ? o.wind : 1;
    C.fadeIn[i] = o && o.fadeIn != null ? o.fadeIn : 0.06;
    C.spinV[i] = (fxr() - 0.5) * 0.8;
    C.dirty = true;
    return i;
  }
  function smokePuff(x, y, z, vx, vy, vz, s0, s1, life, a0, r, g, b, o) { clouds(); return puff(smoke, x, y, z, vx, vy, vz, s0, s1, life, a0, r, g, b, o); }
  function firePuff(x, y, z, vx, vy, vz, s0, s1, life, a0, r, g, b, o) { clouds(); return puff(fire, x, y, z, vx, vy, vz, s0, s1, life, a0, r, g, b, o); }
  function stepCloud(C, dt) {
    const A = C.A;
    let live = 0;
    for (let i = C.reserved; i < C.n; i++) {
      if (C.life[i] <= 0) { if (A.alpha[i] !== 0) A.alpha[i] = 0; continue; }
      live++;
      C.life[i] -= dt;
      const i3 = i * 3, k = 1 - Math.max(0, C.life[i]) / C.max[i];     // 0 → 1 over its life
      const dg = Math.max(0, 1 - C.drag[i] * dt);
      C.vel[i3] *= dg; C.vel[i3 + 1] = C.vel[i3 + 1] * dg + C.rise[i] * dt; C.vel[i3 + 2] *= dg;
      const wk = C.windK[i] * Math.min(1, k * 3);
      A.pos[i3] += (C.vel[i3] + WIND_X * wk) * dt;
      A.pos[i3 + 1] += C.vel[i3 + 1] * dt;
      A.pos[i3 + 2] += (C.vel[i3 + 2] + WIND_Z * wk) * dt;
      // grows fast then slows (a billow), fades in, holds, fades slowly out
      A.size[i] = C.s0[i] + (C.s1[i] - C.s0[i]) * (1 - (1 - k) * (1 - k));
      const fin = C.fadeIn[i] > 0 ? Math.min(1, k * C.max[i] / C.fadeIn[i]) : 1;
      A.alpha[i] = C.a0[i] * fin * (1 - k) * (1 - k * 0.35);
      A.rot[i] += C.spinV[i] * dt;
      if (C.life[i] <= 0) A.alpha[i] = 0;
    }
    C.live = live;
    return live;
  }
  function flushCloud(C) {
    const a = C.geo.attributes;
    a.position.needsUpdate = true; a.aSize.needsUpdate = true; a.aAlpha.needsUpdate = true;
    a.aRot.needsUpdate = true; a.aCol.needsUpdate = true;
  }
  function cloudScale() {
    const cam = CBZ.camera, r = CBZ.renderer;
    const h = r && r.domElement ? r.domElement.height : 900;
    const fov = cam && cam.fov ? cam.fov : 70;
    return h / (2 * Math.tan(fov * Math.PI / 360));
  }

  // ---- reserved motor flares --------------------------------------------
  // A launcher claims its slots ONCE (they are never given back: the whole
  // game has ~12 live launch records) and rewrites them every frame.
  function claimFlares(n) {
    clouds();
    if (flaresClaimed + n > FLARE_CAP) return -1;
    const base = flaresClaimed;
    flaresClaimed += n;
    return base;
  }
  function setFlare(i, x, y, z, size, alpha, r, g, b) {
    if (i < 0 || !fire) return;
    const A = fire.A, i3 = i * 3;
    A.pos[i3] = x; A.pos[i3 + 1] = y; A.pos[i3 + 2] = z;
    A.size[i] = size; A.alpha[i] = alpha;
    A.col[i3] = r; A.col[i3 + 1] = g; A.col[i3 + 2] = b;
    A.rot[i] = fxr() * 6.283;
    fire.dirty = true;
  }
  function flareOff(i, n) {
    if (i < 0 || !fire) return;
    for (let k = 0; k < (n || 1); k++) if (fire.A.alpha[i + k] !== 0) { fire.A.alpha[i + k] = 0; fire.dirty = true; }
  }
  // Two slots: a white-hot core at the nozzle and an orange halo just aft.
  function motorFlare(base, tx, ty, tz, dx, dy, dz, size) {
    if (base < 0) return;
    const fl = 0.78 + fxr() * 0.44;
    setFlare(base, tx, ty, tz, size * 0.42 * fl, 1, 1, 0.95, 0.82);
    const back = size * 0.25;
    setFlare(base + 1, tx - dx * back, ty - dy * back, tz - dz * back, size * fl, 0.72 * fl, 1, 0.55, 0.16);
  }

  // ---- a smoke trail laid BY DISTANCE ------------------------------------
  // `st` is the emitter's own record {x,y,z,on}. Puffs fill the segment from
  // the last puff to the nozzle now, so a fast round leaves no gaps; the
  // spacing widens when the round is so fast that `budget` puffs over its
  // trail's life would overrun the shared pool.
  function trail(st, tx, ty, tz, dx, dy, dz, spec, speed) {
    if (!spec) return;
    clouds();
    if (!st.on) { st.x = tx; st.y = ty; st.z = tz; st.on = true; return; }
    const sx = tx - st.x, sy = ty - st.y, sz = tz - st.z;
    const segLen = Math.sqrt(sx * sx + sy * sy + sz * sz);
    const spacing = Math.max(spec.spacing, (speed || 0) * spec.life / (spec.budget || 120));
    if (segLen < spacing) return;
    const n = Math.min(40, Math.floor(segLen / spacing));
    const ux = sx / segLen, uy = sy / segLen, uz = sz / segLen;
    for (let k = 1; k <= n; k++) {
      const px = st.x + ux * k * spacing, py = st.y + uy * k * spacing, pz = st.z + uz * k * spacing;
      const j = (fxr() - 0.5) * spec.s0 * 0.6;
      const sh = spec.shade + (fxr() - 0.5) * 0.1;
      puff(smoke, px + j, py + j * 0.5, pz - j,
        -dx * 1.2 + (fxr() - 0.5) * 0.7, -dy * 1.2 + (fxr() - 0.5) * 0.6, -dz * 1.2 + (fxr() - 0.5) * 0.7,
        spec.s0, spec.s1 * (0.8 + fxr() * 0.4), spec.life * (0.8 + fxr() * 0.4), spec.a0, sh, sh, sh * 0.97,
        { drag: 1.2, rise: 0.25 });
    }
    st.x += ux * n * spacing; st.y += uy * n * spacing; st.z += uz * n * spacing;
  }

  // ---- the one per-frame step (after fpsmode's rockets at 52) ------------
  function step(dt) {
    if (!smoke) return;
    clouds();
    const ls = smoke.live || smoke.dirty ? stepCloud(smoke, dt) : 0;
    const lf = fire.live || fire.dirty ? stepCloud(fire, dt) : 0;
    const sc = cloudScale();
    smoke.mat.uniforms.uScale.value = sc;
    fire.mat.uniforms.uScale.value = sc;
    // smoke is unlit paint: take the day/night rig's level
    const sun = CBZ.sun, hemi = CBZ.hemi;
    smoke.mat.uniforms.uLight.value = (sun || hemi)
      ? Math.max(0.3, Math.min(1.2, 0.25 + (sun ? sun.intensity : 0.6) * 0.45 + (hemi ? hemi.intensity : 0.5) * 0.6))
      : 1;
    if (ls || smoke.dirty) flushCloud(smoke);
    if (lf || fire.dirty) flushCloud(fire);
    smoke.dirty = ls > 0; fire.dirty = lf > 0;
  }
  if (CBZ.onAlways) CBZ.onAlways(52.3, step);

  // ======================================================= ATTACHED PLUME ===
  // ONE exhaust component for every propelled machine: hot white core,
  // translucent orange envelope, shock diamonds and a nozzle light. The
  // group's +Y extends aft along the parent's -Z. Geometry shared; each
  // plume owns its two materials (its own opacity).
  let PL = null;
  function plumeGeo() {
    if (PL) return PL;
    const outer = new THREE.ConeGeometry(0.34, 1, 12, 1, true); outer.translate(0, 0.5, 0);
    const core = new THREE.ConeGeometry(0.16, 0.72, 10, 1, true); core.translate(0, 0.36, 0);
    const dia = [];
    for (let i = 0; i < 3; i++) dia.push(new THREE.OctahedronGeometry(0.12 - i * 0.018, 0));
    PL = { outer, core, dia };
    outer._shared = core._shared = true; dia.forEach((d) => { d._shared = true; });
    return PL;
  }
  CBZ.createRocketPlume = function (opts) {
    opts = opts || {};
    const G = plumeGeo();
    const grp = new THREE.Group();
    grp.name = opts.name || "rocket-exhaust";
    grp.rotation.x = -Math.PI / 2;
    const outerMat = new THREE.MeshBasicMaterial({
      color: opts.outer == null ? 0xff7a24 : opts.outer,
      transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    const coreMat = new THREE.MeshBasicMaterial({
      color: opts.core == null ? 0xfff4c7 : opts.core,
      transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const outer = new THREE.Mesh(G.outer, outerMat), core = new THREE.Mesh(G.core, coreMat);
    grp.add(outer); grp.add(core);
    const diamonds = [];
    for (let i = 0; i < 3; i++) {
      const d = new THREE.Mesh(G.dia[i], coreMat);
      d.position.y = 0.24 + i * 0.23; d.scale.y = 1.7; grp.add(d); diamonds.push(d);
    }
    const light = new THREE.PointLight(opts.light == null ? 0xff8a35 : opts.light, 0, opts.lightRange || 9, 2);
    light.position.y = 0.08; grp.add(light);
    grp.visible = false;
    grp.userData.rocketPlume = true;
    grp.userData.outer = outer; grp.userData.core = core; grp.userData.diamonds = diamonds;
    grp.userData.outerMaterial = outerMat; grp.userData.coreMaterial = coreMat; grp.userData.light = light;
    return grp;
  };
  CBZ.setRocketPlume = function (grp, power, time, lengthMul, radiusMul) {
    if (!grp || !grp.userData || !grp.userData.rocketPlume) return false;
    power = Math.max(0, Math.min(1, +power || 0));
    grp.visible = power > 0.015;
    const u = grp.userData;
    if (!grp.visible) {
      u.outerMaterial.opacity = 0; u.coreMaterial.opacity = 0; u.light.intensity = 0;
      return true;
    }
    time = +time || 0;
    const flick = 0.94 + Math.sin(time * 37) * 0.045 + Math.sin(time * 71) * 0.018;
    const len = (0.42 + power * 1.58) * flick * (lengthMul || 1);
    const rad = (0.62 + power * 0.42) * (radiusMul || 1);
    grp.scale.set(rad, len, rad);
    u.outerMaterial.opacity = 0.18 + power * 0.48;
    u.coreMaterial.opacity = 0.34 + power * 0.62;
    for (let i = 0; i < u.diamonds.length; i++) {
      const d = u.diamonds[i];
      d.scale.x = d.scale.z = 0.82 + Math.sin(time * 46 + i * 1.7) * 0.12;
    }
    u.light.intensity = 0.35 + power * 2.8;
    return true;
  };

  // ================================================================ API ====
  CBZ.munitions = {
    SPEC: SPEC,
    spec: function (t) { return SPEC[t] || null; },
    geometry: function (t) { const e = geos(t); return e ? e.body : null; },
    parts: geos,
    material: function () { return mats().body; },
    acquire: acquire,
    release: release,
    build: build,                     // an unpooled copy (display racks)
    dressBomb: dressBomb,
    smoke: smokePuff,
    fire: firePuff,
    claimFlares: claimFlares,
    setFlare: setFlare,
    flareOff: flareOff,
    motorFlare: motorFlare,
    trail: trail,
    step: step,
    rand: fxr,
    kit: { latheZ: latheZ, fin: fin, fins: fins, box: box, band: band, ogive: ogive, merge: merge },
    stats: function () {
      return {
        smoke: smoke ? smoke.live : 0, smokeCap: SMOKE_CAP,
        fire: fire ? fire.live : 0, fireCap: FIRE_CAP, flaresClaimed: flaresClaimed, flareCap: FLARE_CAP,
        meshesBuilt: made, pooled: Object.keys(POOL).reduce(function (s, k) { return s + POOL[k].length; }, 0),
        geometries: Object.keys(GEO).length,
      };
    },
    _clouds: function () { clouds(); return { smoke: smoke, fire: fire }; },
  };
})();
