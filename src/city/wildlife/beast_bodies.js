/* ============================================================
   city/wildlife/beast_bodies.js — EVERY LAND ANIMAL'S BODY, drawn on the
   beast kit (city/wildlife/beast_kit.js, on CBZ.loftKit).

   The species ROWS (stats, herds, pelts, biome) stay in the batch files
   (wildlife_species.js, wildlife/forest_deer.js ... small_game.js); each
   row's build(ctx) is one line into CBZ.beastBodies.build(id, ctx). This
   file is the geometry: real adult proportions in metres from field-guide
   numbers (shoulder height, body length, head length), the silhouette each
   animal is known by, its coat.

   A variant (sex, rack, coat) is picked off ctx.rng; each variant's
   geometry is built once and shared by every animal that rolls it.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const K = CBZ.beastKit;
  if (!K) return;      // CBZ.loftKit is read at build time (index.html loads it after the bestiary)
  const mix = K.mix, shade = K.shade, smooth = K.smooth;
  const D2R = Math.PI / 180;

  function pick(r, list) { return list[Math.floor(r() * list.length) % list.length]; }
  function lerp(a, b, t) { return a + (b - a) * t; }

  // ---------------------------------------------------------------- tubes
  // relative control points (x fwd, y up, z out), scaled + mirrored
  function rel(base, s, pts, k, r0, r1) {
    return pts.map(function (p, i) {
      const t = i / (pts.length - 1);
      return [base[0] + p[0] * k, base[1] + p[1] * k, base[2] + s * p[2] * k, lerp(r0, r1, Math.pow(t, 0.9))];
    });
  }
  function along(pts, t) {
    const f = t * (pts.length - 1), i = Math.min(pts.length - 2, Math.floor(f)), u = f - i;
    return [lerp(pts[i][0], pts[i + 1][0], u), lerp(pts[i][1], pts[i + 1][1], u), lerp(pts[i][2], pts[i + 1][2], u), lerp(pts[i][3], pts[i + 1][3], u)];
  }
  function antlerCol(base, tip) {
    return function (x, y, z, ca, sa, R) { const t = R.t != null ? R.t : 0; return t > 0.85 ? tip : mix(base, shade(base, 1.15), t); };
  }
  // a cervid rack: beam path + tines [t on beam, length, dx, dy, dz]
  function rack(E, s, o) {
    const base = E.hp(o.at != null ? o.at : 0.02, E.H.D * 0.42, s * E.H.Wd * 0.55);
    const beam = rel(base, s, o.beam, o.len, o.r, o.r * 0.35);
    const col = antlerCol(o.col || 0x6b4f33, o.tip || 0xe9e0c8);
    E.head.tube(beam, 8, 6, col, true);
    // the burr
    E.head.ellipsoid(base[0], base[1], base[2], o.r * 1.5, o.r * 0.7, o.r * 1.5, 6, shade(o.col || 0x6b4f33, 0.8), true, 3);
    (o.tines || []).forEach(function (tn) {
      const p = along(beam, tn[0]);
      const tip = [p[0] + tn[2] * tn[1], p[1] + tn[3] * tn[1], p[2] + s * tn[4] * tn[1], p[3] * 0.2];
      const mid = [(p[0] + tip[0]) / 2 + (tn[5] || 0) * tn[1], (p[1] + tip[1]) / 2, (p[2] + tip[2]) / 2, p[3] * 0.62];
      E.head.tube([[p[0], p[1], p[2], p[3] * 0.85], mid, tip], 4, 5, col, true);
    });
  }
  function hornTube(E, s, pts, k, r0, r1, col, tipCol, at) {
    const base = at || E.hp(0.04, E.H.D * 0.45, s * E.H.Wd * 0.6);
    const p = rel(base, s, pts, k, r0, r1);
    E.head.tube(p, 12, 9, function (x, y, z, ca, sa, R) { const t = R.t != null ? R.t : 0; return mix(col, tipCol || col, smooth(0.5, 1, t)); }, true);
  }
  // a mane strip following the neck's real crest line (E.crestAt)
  function crestLine(E, part, t0, t1, h0, h1, w, col, plain, lift) {
    const st = [], n = 8;
    for (let i = 0; i <= n; i++) {
      const t = lerp(t0, t1, i / n), p = E.crestAt(t, lift);
      st.push({ x: p[0], y: p[1], z: 0, rt: lerp(h0, h1, i / n), rb: w * 0.6, w: w, sq: 1, wts: [0, 1], t: i / n });
    }
    part.loft(st, 8, function (x, y, z, ca, sa, R) { return shade(typeof col === "function" ? col(R.t) : col, K.grain(x * 5, y * 5, z * 5) * (ca > 0.5 ? 1.06 : 0.94)); }, { capLen: 0.5 }, plain);
  }


  // ================================================================ HOOFED
  const HORSE_COATS = {
    bay: { body: 0x7b4527, back: 0x6a391f, belly: 0x8e5838, leg: 0x1d1917, face: 0x763f22, muzzle: 0x2e2420, mane: 0x16120f, tailTip: 0x16120f, tail: 0x16120f, sockH: 0.5 },
    chestnut: { body: 0x9a5426, back: 0x8a4a20, belly: 0xa8622f, leg: 0x8f4c22, face: 0x9a5426, muzzle: 0x5a3a2a, mane: 0x8a3f18, tail: 0x8a3f18, tailTip: 0x7a3714 },
    black: { body: 0x1f1c1b, back: 0x191716, belly: 0x2a2523, leg: 0x161413, face: 0x1f1c1b, muzzle: 0x2a2523, mane: 0x101010, tail: 0x101010, tailTip: 0x101010 },
    grey: { body: 0xb8b4ae, back: 0xa9a59f, belly: 0xc8c4be, leg: 0x7e7a76, face: 0xc4c0ba, muzzle: 0x4a4644, mane: 0xd8d4ce, tail: 0xd8d4ce, tailTip: 0xc8c4be },
    palomino: { body: 0xc89a52, back: 0xbb8d48, belly: 0xd6ad6a, leg: 0xc08f4a, face: 0xc89a52, muzzle: 0x6a5446, mane: 0xf0e4c8, tail: 0xf0e4c8, tailTip: 0xe8dcc0 },
    buckskin: { body: 0xc8a06a, back: 0xb89060, belly: 0xd8b47e, leg: 0x1e1a18, face: 0xc09866, muzzle: 0x3a2e28, mane: 0x16120f, tail: 0x16120f, tailTip: 0x16120f, sockH: 0.5 },
  };
  function horse(coatName, blaze, socks) {
    const c = HORSE_COATS[coatName];
    const coat = Object.assign({ hoof: 0x2b2622, nose: 0x232020, earIn: 0x3a302c, chin: c.muzzle }, c);
    if (socks) { coat.sock = 0xece6dc; coat.sockH = 0.28; }
    return K.quad({
      fam: "hoof", L: 1.58, WH: 1.52, HH: 1.5, chest: 0.7, belly: 0.82, W: 0.29, sag: 0.05, barrel: 1.08,
      grazer: true, coat: coat,
      neck: { len: 0.8, ang: 52, r0: 0.3, r1: 0.16, w0: 0.21, w1: 0.12, crest: 1.0, dewlap: 0.9, arch: 0.07 },
      head: { len: 0.62, D: 0.28, Wd: 0.11, ang: 58, muzzleAt: 0.66 },
      ear: { len: 0.16, w: 0.08, kind: "point", up: 72, out: 20, back: 8, s: 0.55, u: 0.85 },
      eye: { r: 0.024, t: 0.24, up: 0.32, side: 0.93 },
      leg: { f: 0.09, c: 0.042, h: 0.16 }, legZ: 0.17, hoofH: 0.07,
      tail: { len: 0.32, r: 0.05, droop: 62, switch: 0.075, hairTo: 0.55 },
      paint: function (part, x, y, z, ca, sa, t, col) {
        if (blaze && part === "head" && ca > 0.45 && Math.abs(sa) < 0.35 && t > 0.1 && t < 0.97) return 0xf2eee6;
        return col;
      },
      extra: function (E) {
        // the mane: an arched crest of hair down the neck, the forelock between the ears
        crestLine(E, E.neck, 0.12, 1.0, 0.06, 0.1, 0.045, coat.mane, true, 0.85);
        const f = E.hp(0.02, E.H.D * 0.55, 0);
        E.head.tube([[f[0], f[1], 0, 0.035], [f[0] + 0.1, f[1] - 0.06, 0, 0.03], [f[0] + 0.16, f[1] - 0.16, 0, 0.012]], 5, 6, coat.mane, true, { flat: 1.6 });
      },
    });
  }

  function cow(dark) {
    const coat = { back: 0xf4f2ee, body: 0xf1efea, belly: 0xf6f4f0, leg: 0xeeeae4, face: 0xf1efea, muzzle: 0xe8b8b0, nose: 0xd89a94, hoof: 0x37302a, earIn: 0xe0b0a8, tail: 0xf1efea, tailTip: 0x1e1b1a, chin: 0xe8dcd4 };
    return K.quad({
      fam: "hoof", L: 1.75, WH: 1.42, HH: 1.46, chest: 0.76, belly: 0.62, W: 0.33, sag: 0.03, barrel: 1.12, sq: 0.85,
      grazer: true, coat: coat, pattern: "holstein", uScale: 0.75,
      torsoKeys: [
        [-0.92, 1.24, 0.82, 0.18], [-0.84, 1.44, 0.6, 0.27], [-0.55, 1.47, 0.62, 0.32], [-0.1, 1.42, 0.6, 0.37],
        [0.35, 1.41, 0.66, 0.33], [0.6, 1.4, 0.68, 0.28], [0.86, 1.18, 0.74, 0.2], [0.92, 1.08, 0.8, 0.14],
      ],
      neck: { len: 0.5, ang: 18, r0: 0.34, r1: 0.22, w0: 0.24, w1: 0.15, crest: 0.8, dewlap: 1.45 },
      head: { len: 0.52, D: 0.26, Wd: 0.13, ang: 62, muzzleAt: 0.8, prof: [[-0.04, 0.4, 0.42, 0.44], [0.12, 0.5, 0.48, 0.52], [0.35, 0.44, 0.48, 0.42], [0.62, 0.36, 0.42, 0.36], [0.85, 0.36, 0.4, 0.4], [0.97, 0.38, 0.4, 0.44], [1.0, 0.3, 0.32, 0.38]] },
      ear: { len: 0.17, w: 0.1, kind: "round", up: 5, out: 80, back: 15, s: 0.95, u: 0.5, t: 0.08 },
      eye: { r: 0.026, t: 0.22, up: 0.25, side: 0.95 },
      leg: { f: 0.1, c: 0.05, h: 0.15 }, legZ: 0.2, hoofH: 0.07,
      tail: { len: 0.75, r: 0.04, droop: 82, taper: 0.4, tuft: 0.07, tipAt: 0.85 },
      paint: function (part, x, y, z, ca, sa, t, col) {
        if (dark && part === "head" && t < 0.75) return 0x1e1b1a;
        if ((part === "legF" || part === "legH") && y < 0.5 && y > 0.075) return 0xf3f1ec;
        return col;
      },
      extra: function (E) {
        // the udder, slung under the rear belly
        E.torso.ellipsoid(-0.45, 0.58, 0, 0.2, 0.13, 0.17, 12, 0xe7aaa2);
        [[-0.38, 0.06], [-0.38, -0.06], [-0.52, 0.06], [-0.52, -0.06]].forEach(function (q) {
          E.torso.tube([[q[0], 0.5, q[1], 0.02], [q[0], 0.43, q[1], 0.015]], 3, 6, 0xd8908a, true);
        });
        // short pale horns curving forward-up
        [-1, 1].forEach(function (s) {
          hornTube(E, s, [[0, 0, 0], [0.0, 0.03, 0.08], [0.05, 0.08, 0.13]], 1, 0.025, 0.008, 0xe2d6b6, 0x6a5a44, E.hp(0.03, E.H.D * 0.42, s * E.H.Wd * 0.85));
        });
      },
    });
  }

  // ================================================================ CATS
  // the cat's torso: high shoulder blades over a deep narrow chest, the
  // belly tucked up hard toward the flank, rounded thighs (x / L, y / WH, w / W)
  const CAT_TORSO = [[-0.51, 0.82, 0.62, 0.45], [-0.47, 0.96, 0.5, 0.75], [-0.34, 0.99, 0.5, 0.92], [-0.16, 0.93, 0.58, 0.95], [0.03, 0.95, 0.47, 1.0], [0.21, 1.02, 0.43, 0.92], [0.34, 0.96, 0.5, 0.72], [0.40, 0.82, 0.6, 0.48]];
  function scaleKeys(T, L, WH, W, tuck) {
    return T.map(function (r) { const b = r[2] + (tuck || 0) * Math.max(0, 1 - Math.abs(r[0] + 0.16) / 0.2) ; return [r[0] * L, r[1] * WH, b * WH, r[3] * W]; });
  }
  function bigcat(o) {
    if (!o.torsoKeys) o.torsoKeys = scaleKeys(CAT_TORSO, o.L, o.WH, o.W, o.catTuck);
    if (o.frontX == null) o.frontX = 0.25 * o.L;
    return K.quad(Object.assign({
      fam: "cat", jaw: true, sq: 1,
      neck: { len: 0.32, ang: 22, r0: 0.25, r1: 0.18, crest: 0.95, dewlap: 1.05 },
      ear: { len: 0.075, w: 0.08, kind: "round", up: 70, out: 25, back: 12, s: 0.7, u: 0.82, t: 0.12 },
      eye: { r: 0.02, t: 0.38, up: 0.3, side: 0.82 },
      claws: 0, legZ: 0.13,
    }, o));
  }
  function lion(white, male) {
    const coat = white
      ? { body: 0xe6d8bc, back: 0xdccca8, belly: 0xf2ead8, leg: 0xe2d2b4, face: 0xe8dcc2, muzzle: 0xf4ecdc, nose: 0xc89a8a, mane: 0xd8c49c, tail: 0xe0d0b0, tailTip: 0xb8a078, earIn: 0xf0e4d0, chin: 0xf6f0e4, pad: 0x6a5a50, eye: 0x6a7a5a }
      : { body: 0xc69a5c, back: 0xb88a4e, belly: 0xe2c89c, leg: 0xc29658, face: 0xc2955a, muzzle: 0xe8d6b4, nose: 0x5a3a30, mane: 0x6e4422, tail: 0xc29658, tailTip: 0x2a1c14, earIn: 0xe0caa4, chin: 0xf0e4cc, pad: 0x2a2220, eye: 0x7a5a1a };
    const k = male ? 1 : 0.88;
    return bigcat({
      L: 1.7 * k, WH: 1.15 * k, HH: 1.08 * k, chest: 0.56 * k, belly: 0.56 * k, W: 0.23 * k, sag: 0.04, tuck: 0.06,
      coat: coat,
      head: { len: 0.42 * k, D: 0.3 * k, Wd: 0.17 * k, ang: 14, muzzleAt: 0.6 },
      neck: { len: 0.34 * k, ang: 30, r0: 0.26 * k, r1: 0.2 * k, crest: 0.95, dewlap: 1.05 },
      ear: { len: 0.09 * k, w: 0.095 * k, kind: "round", up: 70, out: 25, back: 12, s: 0.7, u: 0.82, t: 0.12 },
      leg: { f: 0.085 * k, c: 0.05, h: 0.12 * k }, paw: 0.07 * k,
      tail: { len: 0.95 * k, r: 0.035, droop: 70, curl: -1.4, taper: 0.4, tuft: 0.06, tipAt: 0.9 },
      extra: male ? function (E) {
        // the mane: a shaggy hood from the brow back over the shoulders and
        // down the chest; the face stands out of it, the tips run darker
        const m = E.head, H = E.H;
        const back = E.nx0 - 0.28 * k, poll = E.hp(0.0, 0, 0), front = E.hp(0.14, 0, 0);
        const st = [];
        const n = 8;
        for (let i = 0; i <= n; i++) {
          const t = i / n;
          const x = lerp(back, front[0], t), y = lerp(E.ny0 + 0.1 * k, poll[1] + 0.02 * k, Math.min(1, t * 1.3));
          const swell = Math.sin(lerp(0.3, 2.5, t));
          st.push({ x: x, y: y, z: 0, rt: (0.17 + 0.1 * swell) * k, rb: (0.2 + 0.2 * swell) * k, w: (0.18 + 0.1 * swell) * k, sq: 1.1, wts: [0, 1], t: t });
        }
        m.loft(st, 16, function (x, y, z, ca, sa, R) {
          const t = R.t != null ? R.t : 0;
          const tip = 0.5 + 0.5 * Math.sin(x * 61 + y * 37 + z * 53);
          return shade(mix(mix(coat.body, coat.mane, 0.55 + 0.45 * smooth(0.0, 0.6, t)), shade(coat.mane, 0.7), tip * 0.5), 1.0);
        }, { capLen: 0.9 }, false);
      } : null,
    });
  }
  function tiger() {
    const coat = { body: 0xd9782c, back: 0xcf6e26, belly: 0xf4efe6, leg: 0xd9782c, face: 0xdc7c30, muzzle: 0xf4efe6, nose: 0xc87a74, tail: 0xd9782c, tailTip: 0x161010, earIn: 0xf4efe6, chin: 0xf6f2ea, pad: 0x2a2220, eye: 0xb88a28 };
    return bigcat({
      L: 1.8, WH: 1.0, HH: 0.98, chest: 0.52, belly: 0.48, W: 0.24, sag: 0.03, tuck: 0.05,
      coat: coat, pattern: "tiger", uScale: 1.25,
      head: { len: 0.42, D: 0.31, Wd: 0.19, ang: 12, muzzleAt: 0.62 },
      neck: { len: 0.34, ang: 30, r0: 0.26, r1: 0.2, crest: 0.95, dewlap: 1.05 },
      leg: { f: 0.095, c: 0.05, h: 0.14 }, paw: 0.08,
      tail: { len: 0.95, r: 0.04, droop: 60, curl: -1.2, taper: 0.45, tipAt: 0.92 },
      ear: { len: 0.11, w: 0.11, kind: "round", up: 70, out: 30, back: 12, s: 0.72, u: 0.82, t: 0.12, back_c: 0x1a1414 },
      paint: function (part, x, y, z, ca, sa, t, col) {
        if (part === "head" && t > 0.3 && t < 0.55 && ca > 0.1 && ca < 0.6 && Math.abs(sa) > 0.55) return 0xf6f2ea;   // the white cheek ruff
        if (part === "head" && t > 0.2 && t < 0.42 && ca > 0.7) return mix(col, 0xf6f2ea, 0.75);               // the brow spots
        return col;
      },
    });
  }
  function cheetah() {
    const coat = { body: 0xd8b070, back: 0xcca262, belly: 0xf2e6cc, leg: 0xd6ae6e, face: 0xd6ad6c, muzzle: 0xeee0c4, nose: 0x2a2220, tail: 0xd8b070, tailTip: 0xf4ece0, earIn: 0xeee0c4, chin: 0xf4ecdc, pad: 0x2a2220, eye: 0xa07a22 };
    return bigcat({
      L: 1.25, WH: 0.82, HH: 0.8, chest: 0.4, belly: 0.5, W: 0.15, sag: 0.0, tuck: 0.09,
      coat: coat, pattern: "cheetah", uScale: 1.6,
      neck: { len: 0.28, ang: 28, r0: 0.17, r1: 0.11, crest: 0.95, dewlap: 1.0 },
      head: { len: 0.22, D: 0.15, Wd: 0.085, ang: 15, muzzleAt: 0.62, prof: [[-0.05, 0.42, 0.4, 0.42], [0.15, 0.52, 0.5, 0.52], [0.45, 0.46, 0.48, 0.48], [0.7, 0.36, 0.42, 0.38], [0.9, 0.34, 0.38, 0.32], [1.0, 0.24, 0.26, 0.24]] },
      ear: { len: 0.05, w: 0.06, kind: "round", up: 65, out: 35, back: 12, s: 0.75, u: 0.8, t: 0.12, back_c: 0x2a2018 },
      eye: { r: 0.016, t: 0.38, up: 0.32, side: 0.82 },
      leg: { f: 0.055, c: 0.03, h: 0.085 }, paw: 0.045, legZ: 0.09,
      tail: { len: 0.75, r: 0.03, droop: 72, curl: -1.6, taper: 0.3, tipAt: 0.85 },
      paint: function (part, x, y, z, ca, sa, t, col) {
        // the tear line: black from the inner eye down to the mouth corner
        if (part === "head" && t > 0.4 && t < 0.92 && Math.abs(sa) > 0.45 && Math.abs(sa) < 0.75 && ca > -0.2 && ca < 0.35 && Math.abs(ca - lerp(0.25, -0.15, (t - 0.4) / 0.52)) < 0.12) return 0x15100c;
        return col;
      },
    });
  }
  function snowLeopard() {
    const coat = { body: 0xcfcbc4, back: 0xc2beb6, belly: 0xf2f0ec, leg: 0xd2cec8, face: 0xd2cdc4, muzzle: 0xeeeae4, nose: 0xc8a8a4, tail: 0xcfcbc4, tailTip: 0x3a3a3c, earIn: 0xeeeae4, chin: 0xf4f2ee, pad: 0x4a4444, eye: 0x8a9a8a };
    return bigcat({
      L: 1.15, WH: 0.6, HH: 0.62, chest: 0.34, belly: 0.3, W: 0.17, sag: 0.0, tuck: 0.03,
      coat: coat, pattern: "snow_leopard", uScale: 1.5,
      neck: { len: 0.22, ang: 20, r0: 0.17, r1: 0.13, crest: 0.95, dewlap: 1.0 },
      head: { len: 0.22, D: 0.17, Wd: 0.1, ang: 15, muzzleAt: 0.66, prof: [[-0.05, 0.42, 0.4, 0.42], [0.15, 0.52, 0.5, 0.54], [0.45, 0.48, 0.5, 0.5], [0.72, 0.36, 0.42, 0.36], [0.92, 0.32, 0.36, 0.3], [1.0, 0.22, 0.24, 0.22]] },
      ear: { len: 0.045, w: 0.06, kind: "round", up: 55, out: 40, back: 12, s: 0.75, u: 0.8, t: 0.12 },
      eye: { r: 0.017, t: 0.4, up: 0.3, side: 0.82 },
      leg: { f: 0.07, c: 0.04, h: 0.1 }, paw: 0.065, legZ: 0.1,
      // the tail nearly as long as the body and as thick as a forearm
      tail: { len: 0.95, r: 0.06, droop: 40, curl: -1.0, taper: 0.1, bush: 0.15, tipAt: 0.88 },
    });
  }

  // ================================================================ CERVIDS
  function deer(o) {
    return K.quad(Object.assign({ fam: "hoof", grazer: true, sq: 0.95, hoofH: 0.045, throatPale: 0.9 }, o));
  }
  function whitetail(buck, white) {
    const coat = white
      ? { body: 0xf2f0ea, back: 0xe8e6e0, belly: 0xfaf8f4, leg: 0xeceae4, face: 0xf0eee8, muzzle: 0xe6e2da, nose: 0x3a3030, hoof: 0x4a4440, earIn: 0xe8c8c0, tail: 0xf2f0ea, tailTip: 0xfaf8f4, chin: 0xfaf8f4, eye: 0x6a2a24 }
      : { body: 0x9c6a3e, back: 0x8a5a34, belly: 0xf2ece2, leg: 0x946540, face: 0x8e623c, muzzle: 0x5a4434, nose: 0x161414, hoof: 0x2a2420, earIn: 0xe6dccc, tail: 0x8a5a34, tailTip: 0xf4f0ea, chin: 0xf4f0ea };
    const k = white ? 1.22 : (buck ? 1 : 0.92);
    return deer({
      L: 1.12 * k, WH: 1.0 * k, HH: 1.04 * k, chest: 0.44 * k, belly: 0.56 * k, W: 0.17 * k, sag: 0.02, tuck: 0.07 * k,
      coat: coat,
      neck: { len: 0.45 * k, ang: 58, r0: 0.17 * k, r1: 0.09 * k, w0: 0.12 * k, w1: 0.07 * k, crest: 0.95, dewlap: 1.05, arch: 0.05 },
      head: { len: 0.3 * k, D: 0.14 * k, Wd: 0.065 * k, ang: 48, muzzleAt: 0.78, prof: [[-0.04, 0.4, 0.44, 0.44], [0.15, 0.52, 0.5, 0.56], [0.38, 0.44, 0.46, 0.44], [0.62, 0.32, 0.38, 0.3], [0.86, 0.26, 0.32, 0.24], [0.97, 0.26, 0.3, 0.25], [1.0, 0.18, 0.2, 0.18]] },
      ear: { len: 0.16 * k, w: 0.095 * k, kind: "long", up: 35, out: 50, back: 15, s: 0.75, u: 0.75, t: 0.06 },
      eye: { r: 0.02 * k, t: 0.3, up: 0.3, side: 0.95, lid: white ? 0xd8c0bc : 0xf0ece4 },
      leg: { f: 0.05 * k, c: 0.022 * k, h: 0.08 * k }, legZ: 0.1 * k,
      tail: { len: 0.24 * k, r: 0.05 * k, droop: 50, taper: 0.4, flat: 1.4, tipAt: 0.3 },
      paint: function (part, x, y, z, ca, sa, t, col) {
        if (white) return col;
        if (part === "neck" && t > 0.75 && ca < -0.4) return 0xf4f0ea;                 // throat patch
        if (part === "head" && t > 0.72 && t < 0.9 && ca < 0.2) return 0xf0ebe2;       // the white band behind the nose
        if (part === "tail" && ca < 0) return 0xf6f2ec;                               // the white flag underneath
        return col;
      },
      extra: buck ? function (E) {
        [-1, 1].forEach(function (s) {
          rack(E, s, {
            len: white ? 0.55 : 0.42, r: 0.022 * k, col: white ? 0xd8ccb4 : 0x7a5e40, tip: 0xeee6d2,
            beam: [[0, 0, 0], [-0.12, 0.3, 0.22], [-0.02, 0.55, 0.42], [0.25, 0.68, 0.45], [0.5, 0.66, 0.3], [0.62, 0.6, 0.18]],
            tines: white
              ? [[0.12, 0.12, 0.5, 0.8, 0], [0.42, 0.28, 0.1, 1, 0.05], [0.6, 0.27, 0.3, 1, 0], [0.78, 0.22, 0.4, 1, -0.1], [0.92, 0.16, 0.5, 0.9, -0.1]]
              : [[0.12, 0.09, 0.5, 0.8, 0], [0.45, 0.22, 0.1, 1, 0.05], [0.65, 0.2, 0.25, 1, 0], [0.85, 0.15, 0.4, 1, -0.1]],
          });
        });
      } : null,
    });
  }

  // ================================================================ MEGAFAUNA
  function elephant(bull) {
    const k = bull ? 1 : 0.84;
    const grey = 0x7f7a74;
    const coat = { body: grey, back: 0x75706a, belly: 0x8a857e, leg: 0x7a756f, face: 0x7c7771, muzzle: 0x77726c, nose: 0x6a655f, hoof: 0x625e58, earIn: 0x8e8178, tail: 0x6e6a64, tailTip: 0x2a2624, chin: 0x8a857e, eye: 0x2a1c14 };
    const legP = function (front) {
      const x = front ? 0.95 * k : -0.95 * k;
      return front
        ? [[x - 0.05, 2.45 * k, 0.3 * k, 0.3 * k, 0.26 * k], [x - 0.1, 1.5 * k, 0.26 * k, 0.26 * k, 0.24 * k], [x - 0.04, 0.8 * k, 0.21 * k, 0.21 * k, 0.21 * k], [x, 0.18 * k, 0.21 * k, 0.21 * k, 0.21 * k], [x + 0.02, 0.004, 0.24 * k, 0.24 * k, 0.24 * k]]
        : [[x + 0.05, 2.25 * k, 0.33 * k, 0.32 * k, 0.26 * k], [x + 0.12, 1.3 * k, 0.25 * k, 0.26 * k, 0.22 * k], [x, 0.7 * k, 0.2 * k, 0.21 * k, 0.2 * k], [x - 0.02, 0.16 * k, 0.2 * k, 0.2 * k, 0.2 * k], [x - 0.02, 0.004, 0.22 * k, 0.22 * k, 0.22 * k]];
    };
    return K.quad({
      fam: "hoof", L: 2.9 * k, WH: 3.05 * k, HH: 2.8 * k, chest: 1.6 * k, belly: 1.3 * k, W: 0.72 * k, sag: 0.18 * k, sq: 0.95,
      grazer: false, coat: coat, hoofH: 0.07,
      torsoKeys: [
        [-1.52 * k, 2.25 * k, 1.75 * k, 0.4 * k], [-1.4 * k, 2.72 * k, 1.35 * k, 0.6 * k], [-0.9 * k, 2.82 * k, 1.28 * k, 0.72 * k], [-0.1 * k, 2.72 * k, 1.25 * k, 0.8 * k],
        [0.6 * k, 3.0 * k, 1.35 * k, 0.76 * k], [1.15 * k, 3.02 * k, 1.42 * k, 0.66 * k], [1.45 * k, 2.75 * k, 1.6 * k, 0.5 * k], [1.6 * k, 2.5 * k, 1.85 * k, 0.36 * k],
      ],
      neck: { len: 0.62 * k, ang: 12, r0: 0.62 * k, r1: 0.55 * k, w0: 0.5 * k, w1: 0.45 * k, crest: 0.9, dewlap: 1.0 },
      head: { len: 0.95 * k, D: 0.9 * k, Wd: 0.42 * k, ang: 68, dy: 0.25 * k, muzzleAt: 0.9, nosePad: false, sq: 0.9,
        prof: [[-0.1, 0.42, 0.42, 0.42], [0.1, 0.55, 0.5, 0.52], [0.4, 0.5, 0.48, 0.5], [0.7, 0.36, 0.38, 0.38], [0.95, 0.24, 0.24, 0.26], [1.0, 0.2, 0.2, 0.22]] },
      eye: { r: 0.035 * k, t: 0.42, up: 0.0, side: 0.97, shine: true },
      legPts: legP, legZ: 0.5 * k,
      tail: { len: 1.1 * k, r: 0.06 * k, droop: 82, taper: 0.7, tuft: 0.07 * k, tipAt: 0.9 },
      extra: function (E) {
        const H = E.H;
        // the trunk: from the face down, hanging in a gentle S to a hand's
        // breadth above the ground, the tip curled forward
        const t0 = E.hp(0.92, 0, 0);
        const drop = t0[1] - 0.55;    // the tip hangs a hand's breadth over the ground
        const pts = [[t0[0], t0[1], 0, 0.26 * k], [t0[0] + 0.12 * k, t0[1] - 0.27 * drop, 0, 0.2 * k], [t0[0] + 0.1 * k, t0[1] - 0.6 * drop, 0, 0.14 * k], [t0[0] + 0.02 * k, t0[1] - 0.86 * drop, 0, 0.1 * k], [t0[0] + 0.12 * k, t0[1] - drop, 0, 0.08 * k]];
        E.head.tube(pts, 14, 12, function (x, y, z, ca, sa, R) {
          // wrinkle rings round the trunk
          const t = R.t != null ? R.t : 0;
          return shade(coat.face, 0.92 + 0.12 * Math.abs(Math.sin(t * 60)) * (ca > -0.5 ? 1 : 0.4));
        }, false);
        // the ears: huge, flat, Africa-shaped, laid back along the neck
        [-1, 1].forEach(function (s) {
          const b = E.hp(0.12, H.D * 0.2, s * H.Wd * 0.85);
          const st = [];
          const ew = [0.2, 0.55, 0.72, 0.7, 0.55, 0.25];
          const eh = [0.35, 0.65, 0.78, 0.8, 0.66, 0.3];
          for (let i = 0; i < ew.length; i++) {
            const t = i / (ew.length - 1);
            st.push({ x: b[0] - t * 0.95 * k, y: b[1] - 0.18 * k - t * 0.1 * k, z: s * (H.Wd * 1.2 + t * 0.32 * k), rt: eh[i] * 0.62 * k, rb: eh[i] * 0.82 * k, w: 0.035 * k, sq: 0.9, wts: [0, 1], t: t });
          }
          E.head.loft(st, 14, function (x, y, z, ca, sa, R) {
            const inner = (sa * -s) > 0.1;
            return shade(inner ? coat.earIn : coat.body, K.grain(x * 4, y * 4, z));
          }, { side: [0, 0, 1], capLen: 1.2 }, true);
        });
        // tusks: ivory, from the lip forward and up
        [-1, 1].forEach(function (s) {
          const b = E.hp(0.75, -H.D * 0.12, s * H.Wd * 0.45);
          const L2 = bull ? 1.1 : 0.55;
          E.head.tube([[b[0], b[1], b[2], 0.075 * k], [b[0] + 0.12 * L2, b[1] - 0.32 * L2, b[2] + s * 0.06, 0.07 * k], [b[0] + 0.4 * L2, b[1] - 0.5 * L2, b[2] + s * 0.1, 0.05 * k], [b[0] + 0.72 * L2, b[1] - 0.38 * L2, b[2] + s * 0.06, 0.02 * k]], 10, 9, function (x, y, z, ca, sa, R) { return mix(0xe8dcc0, 0xd8c8a4, R.t || 0); }, true);
        });
      },
    });
  }

  // ================================================================ FARM
  function pig() {
    const coat = { body: 0xeab0a6, back: 0xe2a49a, belly: 0xf0beb4, leg: 0xe6aaa0, face: 0xeab0a6, muzzle: 0xe29a92, nose: 0xd8868a, hoof: 0x6a4a44, earIn: 0xe89a96, tail: 0xe6aaa0, chin: 0xf0bcb2 };
    return K.quad({
      fam: "pig", L: 1.12, WH: 0.74, HH: 0.78, chest: 0.48, belly: 0.3, W: 0.28, sag: -0.01, barrel: 1.1, sq: 0.9, coat: coat,
      torsoKeys: [[-0.6, 0.6, 0.38, 0.16], [-0.54, 0.76, 0.3, 0.25], [-0.3, 0.8, 0.27, 0.3], [0.0, 0.79, 0.25, 0.32], [0.28, 0.76, 0.27, 0.29], [0.48, 0.72, 0.3, 0.24], [0.6, 0.62, 0.36, 0.18]],
      neck: { len: 0.14, ang: 0, r0: 0.25, r1: 0.22, w0: 0.22, w1: 0.19 },
      head: { len: 0.38, D: 0.3, Wd: 0.14, ang: 28, dx: -0.05, muzzleAt: 0.85, noseUp: 0, prof: [[-0.04, 0.42, 0.46, 0.46], [0.18, 0.5, 0.5, 0.52], [0.45, 0.38, 0.42, 0.36], [0.75, 0.28, 0.3, 0.26], [0.96, 0.26, 0.26, 0.27], [1.0, 0.26, 0.26, 0.27]] },
      ear: { len: 0.2, w: 0.17, kind: "floppy", up: 35, out: 35, back: -45, s: 0.6, u: 0.8, t: 0.1 },
      eye: { r: 0.016, t: 0.3, up: 0.35, side: 0.85 },
      leg: { f: 0.065, c: 0.038, h: 0.085 }, legZ: 0.15, hoofH: 0.04,
      tail: { len: 0.2, r: 0.016, droop: 10, curl: 7, taper: 0.3, dy: 0.05 },
      extra: function (E) {
        // the snout disc and its two nostrils
        const n = E.hp(1.0, 0, 0);
        E.head.ellipsoid(n[0] + 0.005, n[1], 0, 0.016, 0.075, 0.08, 12, 0xe4949a, true, 3);
        [-1, 1].forEach(function (s) { E.head.ellipsoid(n[0] + 0.02, n[1] - 0.005, s * 0.03, 0.006, 0.018, 0.012, 6, 0x5a2a2c, true, 3); });
      },
    });
  }
  function sheep(black) {
    const wool = 0xe9e1cf;
    const fc = black ? 0x1c1818 : 0xe6dccc;
    const coat = { body: wool, back: 0xf0e8d6, belly: 0xd4c8b0, leg: fc, face: fc, muzzle: black ? 0x2a2424 : 0xd8c4b8, nose: black ? 0x141010 : 0xc8a0a0, hoof: 0x2e2824, earIn: black ? 0x3a2e2e : 0xe0b8b0, tail: wool, chin: fc };
    return K.quad({
      fam: "hoof", L: 1.05, WH: 0.78, HH: 0.8, chest: 0.48, belly: 0.33, W: 0.29, sag: 0, barrel: 1.05, sq: 0.8, coat: coat, grazer: true, hoofH: 0.035,
      torsoKeys: [[-0.58, 0.62, 0.42, 0.18], [-0.52, 0.8, 0.32, 0.27], [-0.25, 0.84, 0.3, 0.3], [0.05, 0.84, 0.3, 0.31], [0.3, 0.82, 0.32, 0.29], [0.48, 0.76, 0.38, 0.24], [0.58, 0.66, 0.44, 0.16]],
      neck: { len: 0.28, ang: 42, r0: 0.18, r1: 0.11, w0: 0.16, w1: 0.09 },
      head: { len: 0.3, D: 0.17, Wd: 0.08, ang: 55, muzzleAt: 0.75 },
      ear: { len: 0.12, w: 0.065, kind: "long", up: -5, out: 85, back: 10, s: 0.9, u: 0.6, t: 0.12 },
      eye: { r: 0.015, t: 0.32, up: 0.28, side: 0.95 },
      leg: { f: 0.045, c: 0.022, h: 0.06 }, legZ: 0.13,
      tail: { len: 0.14, r: 0.045, droop: 80, taper: 0.3 },
      paint: function (part, x, y, z, ca, sa, t, col) {
        if (part === "torso" || part === "neck") return shade(col, 0.9 + 0.2 * Math.abs(Math.sin(x * 37 + z * 23) * Math.cos(y * 41 - x * 17)));
        if ((part === "legF" || part === "legH") && y > 0.38) return mix(fc, wool, smooth(0.38, 0.5, y));
        return col;
      },
      extra: function (E) {
        // a cap of fleece on the poll
        const p = E.hp(0.0, E.H.D * 0.35, 0);
        E.head.ellipsoid(p[0], p[1], 0, 0.07, 0.06, 0.07, 10, wool, true, 3);
      },
    });
  }
  function goat(coatName) {
    const C = {
      white: { body: 0xece6da, back: 0xe2dccf, belly: 0xf2ece2, face: 0xece6da, muzzle: 0xd8ccc0 },
      brown: { body: 0x6e4a30, back: 0x5a3a24, belly: 0x8a6a50, face: 0x5a3a24, muzzle: 0x2a201a },
      pied: { body: 0xece6da, back: 0x2a2220, belly: 0xece6da, face: 0x2a2220, muzzle: 0xd8ccc0 },
    }[coatName];
    const coat = Object.assign({ leg: C.body, nose: 0x2a2220, hoof: 0x2e2824, earIn: 0xd8b8a8, tail: C.back, chin: C.body }, C);
    return K.quad({
      fam: "hoof", L: 0.85, WH: 0.7, HH: 0.73, chest: 0.37, belly: 0.38, W: 0.17, sag: 0.02, barrel: 1.1, coat: coat, grazer: true, hoofH: 0.03,
      neck: { len: 0.3, ang: 55, r0: 0.12, r1: 0.07, w0: 0.09, w1: 0.06 },
      head: { len: 0.24, D: 0.12, Wd: 0.055, ang: 55, muzzleAt: 0.75 },
      ear: { len: 0.11, w: 0.05, kind: "long", up: 0, out: 80, back: 20, s: 0.9, u: 0.6, t: 0.12 },
      eye: { r: 0.014, t: 0.3, up: 0.3, side: 0.95, lid: 0xc8b48a },
      leg: { f: 0.038, c: 0.018, h: 0.05 }, legZ: 0.08,
      tail: { len: 0.12, r: 0.025, droop: -40, taper: 0.5, flat: 1.4 },
      extra: function (E) {
        [-1, 1].forEach(function (s) {
          hornTube(E, s, [[0, 0, 0], [-0.02, 0.08, 0.02], [-0.09, 0.15, 0.04], [-0.17, 0.17, 0.06]], 1, 0.022, 0.006, 0x8a7e6a, 0x4a4238);
        });
        const c = E.hp(0.85, -E.H.D * 0.32, 0);    // the beard
        E.head.tube([[c[0], c[1], 0, 0.02], [c[0] - 0.02, c[1] - 0.06, 0, 0.022], [c[0] - 0.01, c[1] - 0.12, 0, 0.008]], 5, 6, shade(coat.chin, 0.85), true, { flat: 0.6 });
      },
    });
  }
  function chicken(hen) {
    const P = { parts: {}, order: ["body", "head", "legL", "legR"] };
    const body = P.parts.body = new K.Part("body");
    const feather = hen ? 0xb4682e : 0xc8521e, dark = hen ? 0x7a4420 : 0x1e3a2a;
    const col = function (x, y, z, ca) { return shade(ca > 0.3 ? shade(feather, 1.05) : shade(feather, 0.9), K.grain(x * 20, y * 20, z * 20)); };
    // the body: a teardrop, breast forward, rump up into the tail
    body.loft([
      { x: -0.17, y: 0.33, rt: 0.04, rb: 0.04, w: 0.05, wts: [0, 1] }, { x: -0.12, y: 0.3, rt: 0.08, rb: 0.08, w: 0.085, wts: [0, 1] },
      { x: -0.02, y: 0.29, rt: 0.1, rb: 0.1, w: 0.1, wts: [0, 1] }, { x: 0.07, y: 0.3, rt: 0.095, rb: 0.1, w: 0.09, wts: [0, 1] },
      { x: 0.13, y: 0.34, rt: 0.065, rb: 0.07, w: 0.065, wts: [0, 1] },
    ], 12, col, { capLen: 0.8 });
    // the tail fan and (the rooster's) sickle feathers, the folded wings
    body.tube([[-0.14, 0.33, 0, 0.03], [-0.2, 0.42, 0, 0.05], [-0.2, 0.5, 0, 0.02]], 5, 8, hen ? feather : dark, true, { flat: 0.35, side: [0, 0, 1] });
    if (!hen) body.tube([[-0.16, 0.36, 0, 0.02], [-0.25, 0.47, 0, 0.03], [-0.3, 0.42, 0, 0.012]], 5, 6, dark, true, { flat: 0.4, side: [0, 0, 1] });
    [-1, 1].forEach(function (s) { body.ellipsoid(-0.02, 0.31, s * 0.085, 0.09, 0.05, 0.022, 10, shade(feather, 0.82), true, 3); });
    const head = P.parts.head = new K.Part("head");
    head.tube([[0.11, 0.35, 0, 0.045], [0.15, 0.42, 0, 0.032], [0.16, 0.46, 0, 0.03]], 5, 10, col, true);
    head.ellipsoid(0.165, 0.475, 0, 0.035, 0.032, 0.03, 10, col, true, 3);
    head.tube([[0.19, 0.48, 0, 0.012], [0.225, 0.47, 0, 0.002]], 3, 6, 0xd8a84a, true);                   // the beak
    head.tube([[0.14, 0.5, 0, 0.012], [0.165, 0.525, 0, 0.018], [0.19, 0.505, 0, 0.008]], 5, 6, 0xc8241c, true, { flat: 0.4, side: [0, 0, 1] });   // the comb
    head.ellipsoid(0.185, 0.445, 0, 0.012, 0.02, 0.008, 6, 0xc8241c, true, 3);                         // the wattle
    [-1, 1].forEach(function (s) { head.ellipsoid(0.175, 0.485, s * 0.026, 0.006, 0.006, 0.004, 5, 0x1a0e08, true, 3); });
    head.ud.eyes = [[0.175, 0.485, 0.026, 0.006], [0.175, 0.485, -0.026, 0.006]];
    [-1, 1].forEach(function (s) {
      const leg = P.parts[s > 0 ? "legL" : "legR"] = new K.Part("leg");
      leg.ud.leg = s > 0 ? "L" : "R";
      leg.tube([[0.0, 0.23, s * 0.04, 0.02], [-0.01, 0.13, s * 0.04, 0.009], [0.0, 0.01, s * 0.04, 0.008]], 5, 6, 0xd8b04a, true);
      [-0.5, 0, 0.5].forEach(function (a) { leg.tube([[0.0, 0.008, s * 0.04, 0.005], [0.05 * Math.cos(a), 0.004, s * 0.04 + 0.05 * Math.sin(a), 0.003]], 3, 4, 0xd8b04a, true); });
    });
    P.saddle = { x: 0, y: 0.38, width: 0.18 };
    return P;
  }

  // ================================================================ WILD UNGULATES
  function elk(bull) {
    const k = bull ? 1 : 0.9;
    const coat = { body: 0xb38b5c, back: 0xa47c4e, belly: 0x3d2b20, leg: 0x3e2b1e, face: 0x6b4b33, muzzle: 0x3a2c22, nose: 0x1e1814, hoof: 0x1e1a17, earIn: 0xc0aa8a, tail: 0xe2cf9f, tailTip: 0xe2cf9f, mane: 0x4a3222, chin: 0x4a3222 };
    return deer({
      L: 1.75 * k, WH: 1.48 * k, HH: 1.42 * k, chest: 0.68 * k, belly: 0.82 * k, W: 0.27 * k, sag: 0.03, tuck: 0.06,
      coat: coat, throatPale: 0,
      neck: { len: 0.72 * k, ang: 50, r0: 0.27 * k, r1: 0.14 * k, w0: 0.2 * k, w1: 0.1 * k, crest: 1.0, dewlap: 1.25, arch: 0.05 },
      head: { len: 0.52 * k, D: 0.22 * k, Wd: 0.09 * k, ang: 50, muzzleAt: 0.72 },
      ear: { len: 0.18 * k, w: 0.09 * k, kind: "long", up: 45, out: 40, back: 15, s: 0.7, u: 0.8, t: 0.06 },
      eye: { r: 0.022 * k, t: 0.3, up: 0.3, side: 0.95 },
      leg: { f: 0.075 * k, c: 0.034 * k, h: 0.12 * k }, legZ: 0.15 * k, hoofH: 0.06,
      tail: { len: 0.14, r: 0.04, droop: 70, taper: 0.4 },
      paint: function (part, x, y, z, ca, sa, t, col) {
        // the chocolate mane over the neck, and the buff rump patch rimmed dark
        if (part === "neck") return mix(coat.mane, coat.face, t * 0.3);
        if (part === "torso") {
          const r = -0.62 * k;
          if (x < r && ca > -0.6) return x < r - 0.06 || ca > 0.2 ? 0xe2cf9f : 0x3a2a1c;
          if (x > 0.45 * k) return mix(col, coat.mane, smooth(0.45 * k, 0.75 * k, x));
        }
        return col;
      },
      extra: bull ? function (E) {
        [-1, 1].forEach(function (s) {
          rack(E, s, {
            len: 0.98, r: 0.03, col: 0x6e5236, tip: 0xece3cc,
            beam: [[0, 0, 0], [-0.12, 0.25, 0.18], [-0.32, 0.5, 0.3], [-0.55, 0.72, 0.34], [-0.72, 0.88, 0.3], [-0.8, 0.97, 0.24]],
            tines: [[0.06, 0.32, 1, 0.35, 0.05], [0.16, 0.28, 1, 0.45, 0.05], [0.38, 0.26, 0.8, 0.7, 0.0], [0.6, 0.42, 0.7, 0.75, -0.05], [0.82, 0.3, 0.55, 0.85, -0.1]],
          });
        });
      } : null,
    });
  }
  function moose(bull) {
    const k = bull ? 1 : 0.92;
    const coat = { body: 0x3b2a1e, back: 0x2e2018, belly: 0x2a1e16, leg: 0x9a8a76, face: 0x3e2c20, muzzle: 0x4a3626, nose: 0x241a14, hoof: 0x2a2420, earIn: 0x6a5444, tail: 0x2e2018, chin: 0x2e2018 };
    return deer({
      L: 2.0 * k, WH: 1.9 * k, HH: 1.75 * k, chest: 0.85 * k, belly: 1.02 * k, W: 0.34 * k, hump: 0.14 * k, sag: 0.04, tuck: 0.02,
      coat: coat, throatPale: 0, hoofH: 0.075,
      neck: { len: 0.6 * k, ang: 30, r0: 0.34 * k, r1: 0.22 * k, w0: 0.24 * k, w1: 0.15 * k, crest: 1.1, dewlap: 1.1 },
      head: { len: 0.72 * k, D: 0.28 * k, Wd: 0.12 * k, ang: 60, muzzleAt: 0.7, prof: [[-0.04, 0.4, 0.42, 0.44], [0.15, 0.5, 0.48, 0.5], [0.4, 0.44, 0.46, 0.42], [0.6, 0.4, 0.42, 0.36], [0.82, 0.46, 0.44, 0.44], [0.97, 0.42, 0.42, 0.42], [1.0, 0.32, 0.34, 0.36]] },
      ear: { len: 0.24 * k, w: 0.11 * k, kind: "long", up: 25, out: 55, back: 15, s: 0.7, u: 0.8, t: 0.06 },
      eye: { r: 0.024 * k, t: 0.28, up: 0.32, side: 0.95 },
      leg: { f: 0.085 * k, c: 0.042 * k, h: 0.14 * k }, legZ: 0.19 * k,
      tail: { len: 0.1, r: 0.04, droop: 75, taper: 0.4 },
      extra: function (E) {
        // the bell: a flap of hair-covered skin hanging under the throat
        const b = E.hp(0.2, -E.H.D * 0.5, 0);
        E.head.tube([[b[0], b[1], 0, 0.06], [b[0] - 0.02, b[1] - 0.16, 0, 0.05], [b[0] - 0.01, b[1] - 0.3, 0, 0.02]], 5, 8, 0x2a1e16, true, { flat: 0.5 });
        if (!bull) return;
        // palmate antlers: a beam out sideways into a broad, cupped palm, tines on its rim
        [-1, 1].forEach(function (s) {
          const base = E.hp(0.04, E.H.D * 0.4, s * E.H.Wd * 0.6);
          const pal = 0x7a654a;
          // the beam runs out sideways, then opens into a broad flat palm tilted up and out
          E.head.tube([[base[0], base[1], base[2], 0.045], [base[0] - 0.02, base[1] + 0.04, base[2] + s * 0.2, 0.04], [base[0] - 0.04, base[1] + 0.1, base[2] + s * 0.4, 0.035], [base[0] - 0.06, base[1] + 0.2, base[2] + s * 0.6, 0.04], [base[0] - 0.06, base[1] + 0.3, base[2] + s * 0.76, 0.02]], 8, 8, pal, true, { flat: 6.5, side: [1, 0, 0] });
          for (let i = 0; i < 6; i++) {
            const t = i / 5, px = base[0] - 0.3 + t * 0.48, pz = base[2] + s * (0.62 + Math.sin(t * Math.PI) * 0.18), py = base[1] + 0.22 + Math.sin(t * Math.PI) * 0.08;
            E.head.tube([[px, py, pz, 0.028], [px + (t - 0.5) * 0.08, py + 0.14, pz + s * 0.08, 0.008]], 3, 5, mix(pal, 0xe6dcc4, 0.5), true);
          }
        });
      },
    });
  }
  function caribou(bull) {
    const k = bull ? 1 : 0.85;
    const coat = { body: 0x7a6650, back: 0x6a5642, belly: 0xe6e0d4, leg: 0x4a3c30, face: 0x5a4838, muzzle: 0xa49888, nose: 0x3a3430, hoof: 0x2a2420, earIn: 0xc8bcac, tail: 0xf0ece4, chin: 0xe6e0d4, sock: 0xe6e0d4, sockH: 0.12 };
    return deer({
      L: 1.55 * k, WH: 1.2 * k, HH: 1.2 * k, chest: 0.58 * k, belly: 0.62 * k, W: 0.24 * k, sag: 0.02, tuck: 0.04,
      coat: coat, throatPale: 1, hoofH: 0.05,
      neck: { len: 0.55 * k, ang: 40, r0: 0.24 * k, r1: 0.13 * k, w0: 0.17 * k, w1: 0.09 * k, crest: 1.0, dewlap: 1.35 },
      head: { len: 0.42 * k, D: 0.19 * k, Wd: 0.085 * k, ang: 52, muzzleAt: 0.72 },
      ear: { len: 0.12 * k, w: 0.07 * k, kind: "point", up: 40, out: 40, back: 15, s: 0.7, u: 0.8, t: 0.06 },
      eye: { r: 0.02 * k, t: 0.3, up: 0.3, side: 0.95 },
      leg: { f: 0.065 * k, c: 0.032 * k, h: 0.1 * k }, legZ: 0.13 * k,
      tail: { len: 0.14, r: 0.045, droop: 60, taper: 0.4, flat: 1.4 },
      paint: function (part, x, y, z, ca, sa, t, col) {
        if (part === "neck") return ca < 0.1 ? 0xeee8dc : mix(0xd8d0c2, col, smooth(0.1, 0.7, ca));      // the white neck mane
        if (part === "torso" && x < -0.6 * k && ca > -0.5) return 0xece6da;
        if (part === "torso" && Math.abs(ca) < 0.25 && x > -0.4 * k && x < 0.4 * k) return mix(col, 0xd8d0c2, 0.4);   // the pale flank stripe
        return col;
      },
      extra: function (E) {
        // the white mane fringe hanging under the neck
        const a = E.crestAt(0.3, -1.25), b = E.crestAt(0.85, -1.2);
        E.neck.tube([[a[0], a[1], 0, 0.05], [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - 0.08, 0, 0.07], [b[0], b[1], 0, 0.03]], 6, 8, 0xf2eee6, true, { flat: 0.55 });
        const L2 = bull ? 1.0 : 0.6;
        [-1, 1].forEach(function (s) {
          rack(E, s, {
            len: L2, r: 0.026 * L2 + 0.006, col: 0x8a7458, tip: 0xeee6d4,
            beam: [[0, 0, 0], [-0.15, 0.3, 0.2], [-0.28, 0.6, 0.3], [-0.18, 0.88, 0.32], [0.05, 1.02, 0.26], [0.2, 1.0, 0.18]],
            tines: [[0.05, 0.35, 1, -0.1, -0.15], [0.3, 0.3, 0.9, 0.5, 0.05], [0.75, 0.2, 0.2, 1, 0.1], [0.88, 0.2, 0.6, 0.8, -0.1], [0.97, 0.16, 0.8, 0.4, 0]],
          });
          // the brow shovel over the face (one, flattened)
          if (bull && s > 0) {
            const b0 = E.hp(0.04, E.H.D * 0.42, E.H.Wd * 0.4);
            E.head.tube([[b0[0], b0[1], b0[2], 0.02], [b0[0] + 0.15, b0[1] + 0.05, b0[2] - 0.03, 0.04], [b0[0] + 0.3, b0[1] - 0.02, b0[2] - 0.05, 0.05]], 5, 7, 0x8a7458, true, { flat: 0.3, side: [0, 0, 1] });
          }
        });
      },
    });
  }
  function mountainGoat() {
    const coat = { body: 0xf2eee4, back: 0xf6f2ea, belly: 0xe2dcd0, leg: 0xece6da, face: 0xf2eee4, muzzle: 0xe8e2d6, nose: 0x1a1816, hoof: 0x1e1c1a, earIn: 0xd8d0c4, tail: 0xf2eee4, chin: 0xf2eee4 };
    return K.quad({
      fam: "hoof", L: 1.2, WH: 0.98, HH: 0.92, chest: 0.52, belly: 0.46, W: 0.21, hump: 0.08, sag: 0.03, coat: coat, grazer: true, hoofH: 0.04, sq: 0.85,
      neck: { len: 0.32, ang: 40, r0: 0.18, r1: 0.11, w0: 0.14, w1: 0.08, crest: 1.15, dewlap: 1.2 },
      head: { len: 0.3, D: 0.14, Wd: 0.06, ang: 55, muzzleAt: 0.8 },
      ear: { len: 0.1, w: 0.05, kind: "point", up: 35, out: 50, back: 15, s: 0.75, u: 0.8, t: 0.05 },
      eye: { r: 0.016, t: 0.3, up: 0.3, side: 0.95 },
      leg: { f: 0.065, c: 0.034, h: 0.085 }, legZ: 0.11,
      tail: { len: 0.1, r: 0.04, droop: 70, taper: 0.4 },
      paint: function (part, x, y, z, ca, sa, t, col) { return shade(col, 0.93 + 0.12 * Math.abs(Math.sin(x * 51 + z * 29 + y * 13))); },
      extra: function (E) {
        [-1, 1].forEach(function (s) { hornTube(E, s, [[0, 0, 0], [-0.02, 0.1, 0.01], [-0.07, 0.19, 0.015], [-0.12, 0.22, 0.02]], 1, 0.018, 0.004, 0x161412, 0x0e0c0a); });
        const c = E.hp(0.75, -E.H.D * 0.35, 0);           // the beard
        E.head.tube([[c[0], c[1], 0, 0.03], [c[0] - 0.02, c[1] - 0.1, 0, 0.035], [c[0] - 0.01, c[1] - 0.18, 0, 0.01]], 5, 6, 0xeeeae0, true, { flat: 0.6 });
      },
    });
  }
  function bighorn(ram) {
    const coat = { body: 0x7a5e44, back: 0x6e543c, belly: 0xece6da, leg: 0x6a5240, face: 0x7a5e44, muzzle: 0xe8e2d6, nose: 0x2a2420, hoof: 0x2a2420, earIn: 0xc8b8a4, tail: 0x3a2e24, chin: 0xe8e2d6, sock: 0x3a3028, sockH: 0.25 };
    return K.quad({
      fam: "hoof", L: 1.35, WH: 0.95, HH: 0.97, chest: 0.48, belly: 0.5, W: 0.2, sag: 0.02, coat: coat, grazer: true, hoofH: 0.04, sq: 1, tuck: 0.08,
      neck: { len: 0.34, ang: 40, r0: 0.17, r1: 0.11, w0: 0.13, w1: 0.08 },
      head: { len: 0.3, D: 0.15, Wd: 0.07, ang: 55, muzzleAt: 0.78 },
      ear: { len: 0.1, w: 0.05, kind: "point", up: 10, out: 70, back: 15, s: 0.85, u: 0.6, t: 0.12 },
      eye: { r: 0.017, t: 0.3, up: 0.3, side: 0.95, lid: 0xd8c8a8 },
      leg: { f: 0.055, c: 0.026, h: 0.08 }, legZ: 0.11,
      tail: { len: 0.1, r: 0.035, droop: 70, taper: 0.4 },
      paint: function (part, x, y, z, ca, sa, t, col) { return part === "torso" && x < -0.55 && ca > -0.5 ? 0xece6da : col; },
      extra: function (E) {
        [-1, 1].forEach(function (s) {
          // the curl: up and back from the poll, round past the ear, down and forward under the eye
          const base = E.hp(0.06, E.H.D * 0.4, s * E.H.Wd * 0.55), pts = [];
          const R0 = ram ? 0.15 : 0.07, turns = ram ? 1.25 : 0.45, n = 12;
          for (let i = 0; i <= n; i++) {
            const t = i / n, a = Math.PI * 0.45 + t * turns * Math.PI * 2, R = R0 * (1 - 0.35 * t);
            pts.push([base[0] - 0.06 - R0 * 0.3 + Math.cos(a) * R * (ram ? 1 : 0.6) - (ram ? 0 : t * 0.08), base[1] - R0 * 0.25 + Math.sin(a) * R + (ram ? 0 : t * 0.1), base[2] + s * (0.02 + t * (ram ? 0.12 : 0.04)), (ram ? 0.06 : 0.02) * (1 - 0.8 * t) + 0.006]);
          }
          E.head.tube(pts, 16, 9, function (x, y, z, ca, sa, R) { return shade(0xa08a68, 0.88 + 0.16 * Math.abs(Math.sin((R.t || 0) * 70))); }, true);
        });
      },
    });
  }
  function bison(bull) {
    const k = bull ? 1 : 0.88;
    const coat = { body: 0x4a3222, back: 0x3c2818, belly: 0x2e2018, leg: 0x2a1e16, face: 0x22180f, muzzle: 0x1e1612, nose: 0x161210, hoof: 0x1a1612, earIn: 0x3a2a1e, tail: 0x3a2a1e, tailTip: 0x1e1612, chin: 0x22180f, mane: 0x6a4a2c };
    return K.quad({
      fam: "hoof", L: 2.45 * k, WH: 1.55 * k, HH: 1.42 * k, chest: 0.98 * k, belly: 0.62 * k, W: 0.4 * k, hump: 0.32 * k, sag: 0.08, coat: coat, grazer: true, hoofH: 0.06, sq: 0.88,
      torsoKeys: [[-1.25 * k, 1.2 * k, 0.86 * k, 0.2 * k], [-1.15 * k, 1.4 * k, 0.66 * k, 0.32 * k], [-0.8 * k, 1.44 * k, 0.66 * k, 0.37 * k], [-0.3 * k, 1.5 * k, 0.6 * k, 0.42 * k], [0.25 * k, 1.8 * k, 0.56 * k, 0.48 * k], [0.62 * k, 1.85 * k, 0.56 * k, 0.46 * k], [1.05 * k, 1.55 * k, 0.62 * k, 0.36 * k], [1.2 * k, 1.25 * k, 0.75 * k, 0.26 * k]],
      neck: { len: 0.32 * k, ang: -18, r0: 0.42 * k, r1: 0.36 * k, w0: 0.34 * k, w1: 0.3 * k, crest: 1.1, dewlap: 1.2 },
      head: { len: 0.58 * k, D: 0.42 * k, Wd: 0.2 * k, ang: 78, dy: 0.06, muzzleAt: 0.78, prof: [[-0.06, 0.46, 0.46, 0.48], [0.15, 0.55, 0.52, 0.56], [0.45, 0.42, 0.44, 0.42], [0.75, 0.32, 0.34, 0.3], [0.96, 0.3, 0.3, 0.3], [1.0, 0.22, 0.22, 0.24]] },
      ear: { len: 0.1, w: 0.07, kind: "round", up: -10, out: 80, back: 10, s: 0.95, u: 0.3, t: 0.2 },
      eye: { r: 0.022, t: 0.38, up: 0.15, side: 0.96 },
      leg: { f: 0.1 * k, c: 0.05 * k, h: 0.15 * k }, legZ: 0.24 * k,
      tail: { len: 0.5, r: 0.035, droop: 80, taper: 0.4, tuft: 0.06, tipAt: 0.8 },
      paint: function (part, x, y, z, ca, sa, t, col) {
        // the cape: long golden-brown wool over hump, shoulders and forelegs; the rear is short and dark
        if (part === "torso") return mix(col, coat.mane, smooth(-0.1 * k, 0.3 * k, x) * (ca > -0.4 ? 0.85 : 0.5));
        if (part === "legF" && y > 0.5) return mix(col, coat.mane, 0.5);
        return col;
      },
      extra: function (E) {
        [-1, 1].forEach(function (s) { hornTube(E, s, [[0, 0, 0], [0, 0.0, 0.1], [0.02, 0.1, 0.16], [0.0, 0.17, 0.15]], 1, 0.035, 0.008, 0x2a2420, 0x161210, E.hp(0.12, E.H.D * 0.35, s * E.H.Wd * 0.9)); });
        // the woolly crown over the brow and the beard
        const p = E.hp(0.1, E.H.D * 0.3, 0);
        E.head.ellipsoid(p[0], p[1], 0, 0.2, 0.18, 0.22, 12, 0x4a3420, true, 3);
        const c = E.hp(0.7, -E.H.D * 0.3, 0);
        E.head.tube([[c[0] - 0.05, c[1], 0, 0.06], [c[0] - 0.08, c[1] - 0.15, 0, 0.07], [c[0] - 0.06, c[1] - 0.3, 0, 0.02]], 5, 8, 0x2a1e14, true, { flat: 0.6 });
      },
    });
  }
  function boar() {
    const coat = { body: 0x4a3e34, back: 0x3a3028, belly: 0x5a4c40, leg: 0x2e2620, face: 0x4a3e34, muzzle: 0x3a302a, nose: 0x2a2220, hoof: 0x1e1a18, earIn: 0x5a4a40, tail: 0x3a3028, tailTip: 0x1e1a18, chin: 0x6a5a4c };
    return K.quad({
      fam: "pig", L: 1.3, WH: 0.88, HH: 0.78, chest: 0.58, belly: 0.33, W: 0.24, coat: coat, sq: 0.9,
      torsoKeys: [[-0.68, 0.6, 0.44, 0.13], [-0.6, 0.76, 0.34, 0.2], [-0.35, 0.8, 0.32, 0.24], [-0.05, 0.84, 0.33, 0.26], [0.25, 0.9, 0.3, 0.26], [0.5, 0.86, 0.32, 0.22], [0.66, 0.74, 0.38, 0.16]],
      neck: { len: 0.14, ang: -10, r0: 0.27, r1: 0.23, w0: 0.21, w1: 0.17 },
      head: { len: 0.48, D: 0.3, Wd: 0.12, ang: 32, dx: -0.06, muzzleAt: 0.85, noseUp: 0, prof: [[-0.04, 0.42, 0.42, 0.46], [0.18, 0.52, 0.48, 0.5], [0.45, 0.36, 0.38, 0.34], [0.75, 0.24, 0.26, 0.22], [0.97, 0.2, 0.2, 0.22], [1.0, 0.2, 0.2, 0.22]] },
      ear: { len: 0.1, w: 0.07, kind: "point", up: 60, out: 35, back: 20, s: 0.6, u: 0.8, t: 0.1 },
      eye: { r: 0.014, t: 0.32, up: 0.35, side: 0.85 },
      leg: { f: 0.06, c: 0.03, h: 0.08 }, legZ: 0.13, hoofH: 0.035,
      tail: { len: 0.28, r: 0.015, droop: 82, taper: 0.4, tuft: 0.02, tipAt: 0.8 },
      paint: function (part, x, y, z, ca, sa, t, col) { return shade(col, 0.9 + 0.18 * Math.abs(Math.sin(x * 61 + z * 37 + y * 23))); },
      extra: function (E) {
        // the bristle ridge down the spine, tallest over the shoulders
        const st = [];
        for (let i = 0; i <= 8; i++) { const t = i / 8, x = lerp(-0.45, 0.6, t); st.push({ x: x, y: E.topAt(x) - 0.03, z: 0, rt: 0.03 + 0.07 * Math.sin(t * Math.PI * 0.85), rb: 0.02, w: 0.03, wts: [0, 1], t: t }); }
        E.torso.loft(st, 6, function (x, y, z) { return shade(0x1e1814, K.grain(x * 9, y * 9, z * 9)); }, { capLen: 0.6 }, true);
        const n = E.hp(1.0, 0, 0);
        E.head.ellipsoid(n[0] + 0.004, n[1], 0, 0.012, 0.05, 0.055, 10, 0x3a2e2a, true, 3);
        // the tusks: up and back out of the lower lip
        [-1, 1].forEach(function (s) {
          const b = E.hp(0.82, -E.H.D * 0.15, s * E.H.Wd * 0.45);
          E.head.tube([[b[0], b[1], b[2], 0.012], [b[0] + 0.02, b[1] + 0.05, b[2] + s * 0.02, 0.01], [b[0] - 0.02, b[1] + 0.09, b[2] + s * 0.03, 0.003]], 4, 6, 0xeee6d2, true);
        });
      },
    });
  }

  // ================================================================ SAVANNA
  function zebra() {
    const coat = { body: 0xf2f0ea, back: 0xeeebe4, belly: 0xf6f4ef, leg: 0xf2f0ea, face: 0xf2f0ea, muzzle: 0x1e1c1c, nose: 0x141212, hoof: 0x1e1a18, earIn: 0xf2f0ea, tail: 0xf2f0ea, tailTip: 0x141212, chin: 0x2a2626 };
    return K.quad({
      fam: "hoof", L: 1.45, WH: 1.3, HH: 1.3, chest: 0.6, belly: 0.72, W: 0.27, sag: 0.03, barrel: 1.1, coat: coat, grazer: true, pattern: "zebra", uScale: 1.1, hoofH: 0.06,
      neck: { len: 0.62, ang: 45, r0: 0.27, r1: 0.15, w0: 0.19, w1: 0.11, crest: 1.0 },
      head: { len: 0.55, D: 0.25, Wd: 0.1, ang: 58, muzzleAt: 0.78 },
      ear: { len: 0.17, w: 0.1, kind: "long", up: 65, out: 30, back: 10, s: 0.55, u: 0.85, t: 0.04, tip: 0x1e1c1c },
      eye: { r: 0.022, t: 0.25, up: 0.32, side: 0.93 },
      leg: { f: 0.08, c: 0.038, h: 0.14 }, legZ: 0.15,
      tail: { len: 0.45, r: 0.035, droop: 72, taper: 0.5, tuft: 0.045, tipAt: 0.8 },
      extra: function (E) {
        // the upright mane: stiff, striped black and white like the neck
        crestLine(E, E.neck, 0.08, 1.02, 0.09, 0.07, 0.03, function (t) { return Math.sin(t * 40) > 0 ? 0x161414 : 0xeeeae2; }, true, 0.88);
      },
    });
  }
  function giraffe() {
    const coat = { body: 0xf0e2c4, back: 0xead8b8, belly: 0xf4ead4, leg: 0xf2e6cc, face: 0xe8d4b0, muzzle: 0xe2ceac, nose: 0x3a2a20, hoof: 0x2a2420, earIn: 0xf4ead4, tail: 0xe8d4b0, tailTip: 0x1e1612, chin: 0xf4ead4, mane: 0x6a3e1c };
    return K.quad({
      fam: "hoof", L: 2.1, WH: 3.0, HH: 2.35, chest: 1.2, belly: 1.62, W: 0.42, coat: coat, grazer: true, pattern: "giraffe", uScale: 0.9, hoofH: 0.09,
      torsoKeys: [[-1.1, 2.15, 1.85, 0.2], [-1.0, 2.35, 1.66, 0.32], [-0.65, 2.42, 1.6, 0.4], [-0.15, 2.62, 1.55, 0.44], [0.35, 2.95, 1.6, 0.44], [0.7, 3.02, 1.72, 0.38], [0.98, 2.85, 1.95, 0.27], [1.08, 2.7, 2.12, 0.18]],
      neck: { len: 1.95, ang: 60, r0: 0.38, r1: 0.13, w0: 0.27, w1: 0.1, crest: 0.95, dewlap: 1.05, arch: 0.02 },
      head: { len: 0.6, D: 0.24, Wd: 0.1, ang: 55, muzzleAt: 0.8 },
      ear: { len: 0.17, w: 0.08, kind: "long", up: 5, out: 80, back: 15, s: 0.9, u: 0.6, t: 0.12 },
      eye: { r: 0.03, t: 0.3, up: 0.32, side: 0.95 },
      legZ: 0.19,
      tail: { len: 0.9, r: 0.03, droop: 84, taper: 0.5, tuft: 0.06, tipAt: 0.85 },
      legPts: function (front) {
        const x = front ? 0.72 : -0.78;
        return front
          ? [[x - 0.03, 2.35, 0.16, 0.15, 0.12], [x - 0.07, 1.65, 0.13, 0.12, 0.1], [x - 0.04, 1.05, 0.08, 0.08, 0.07], [x - 0.03, 0.85, 0.06, 0.065, 0.06], [x - 0.02, 0.45, 0.05, 0.05, 0.045], [x - 0.01, 0.18, 0.055, 0.055, 0.05], [x + 0.03, 0.09, 0.05, 0.045, 0.048], [x + 0.05, 0.004, 0.07, 0.06, 0.065]]
          : [[x + 0.04, 2.05, 0.2, 0.18, 0.13], [x + 0.14, 1.55, 0.15, 0.15, 0.11], [x + 0.02, 1.1, 0.09, 0.1, 0.07], [x - 0.08, 0.85, 0.06, 0.08, 0.055], [x - 0.07, 0.45, 0.05, 0.05, 0.045], [x - 0.05, 0.18, 0.055, 0.055, 0.05], [x - 0.02, 0.09, 0.05, 0.045, 0.048], [x, 0.004, 0.07, 0.06, 0.065]];
      },
      extra: function (E) {
        crestLine(E, E.neck, 0.05, 0.98, 0.07, 0.05, 0.03, coat.mane, true, 0.9);
        // ossicones: two skin-covered horns with black tufts
        [-1, 1].forEach(function (s) {
          const b = E.hp(0.08, E.H.D * 0.42, s * E.H.Wd * 0.45);
          E.head.tube([[b[0], b[1], b[2], 0.028], [b[0] - 0.02, b[1] + 0.13, b[2] + s * 0.01, 0.022]], 3, 7, 0xd8c09a, true);
          E.head.ellipsoid(b[0] - 0.02, b[1] + 0.15, b[2] + s * 0.01, 0.03, 0.03, 0.03, 7, 0x1e1612, true, 3);
        });
      },
    });
  }
  function rhino() {
    const grey = 0x8e887e;
    const coat = { body: grey, back: 0x858077, belly: 0x9a948a, leg: 0x88827a, face: 0x8a847b, muzzle: 0x8e887e, nose: 0x6a655e, hoof: 0x6e6a62, earIn: 0x6e6a62, tail: grey, tailTip: 0x2a2624, chin: 0x9a948a };
    return K.quad({
      fam: "hoof", L: 2.6, WH: 1.75, HH: 1.68, chest: 0.98, belly: 0.62, W: 0.55, hump: 0.12, sag: 0.08, coat: coat, grazer: true, hoofH: 0.07, sq: 0.88,
      torsoKeys: [[-1.35, 1.4, 1.0, 0.3], [-1.25, 1.65, 0.75, 0.46], [-0.85, 1.7, 0.66, 0.54], [-0.25, 1.66, 0.6, 0.58], [0.35, 1.82, 0.62, 0.56], [0.75, 1.85, 0.7, 0.5], [1.1, 1.65, 0.8, 0.4], [1.28, 1.42, 0.92, 0.3]],
      neck: { len: 0.45, ang: -12, r0: 0.42, r1: 0.38, w0: 0.36, w1: 0.31, crest: 1.0, dewlap: 1.1 },
      head: { len: 0.8, D: 0.48, Wd: 0.2, ang: 60, dy: 0.05, muzzleAt: 0.85, noseUp: 0.1, prof: [[-0.05, 0.4, 0.42, 0.44], [0.15, 0.48, 0.48, 0.5], [0.45, 0.38, 0.42, 0.4], [0.75, 0.3, 0.34, 0.36], [0.96, 0.32, 0.32, 0.44], [1.0, 0.26, 0.26, 0.38]] },
      ear: { len: 0.2, w: 0.1, kind: "long", up: 60, out: 30, back: 25, s: 0.75, u: 0.85, t: 0.05 },
      eye: { r: 0.022, t: 0.45, up: 0.0, side: 0.97 },
      leg: { f: 0.14, c: 0.085, h: 0.2 }, legZ: 0.32, frontX: 0.72, hindX: -0.85,
      tail: { len: 0.55, r: 0.04, droop: 82, taper: 0.5, tuft: 0.04, tipAt: 0.85 },
      paint: function (part, x, y, z, ca, sa, t, col) {
        // skin folds: darker creases behind the shoulder and round the neck
        if (part === "torso" && (Math.abs(x - 0.35) < 0.04 || Math.abs(x + 0.75) < 0.035)) return shade(col, 0.75);
        if (part === "neck" && Math.abs(Math.sin(t * 9)) > 0.93) return shade(col, 0.78);
        return shade(col, 0.95 + 0.08 * Math.sin(x * 23 + y * 31 + z * 19));
      },
      extra: function (E) {
        // two horns on the nose: the long front one, a short one behind
        const f = E.hp(0.88, E.H.D * 0.28, 0), r = E.hp(0.62, E.H.D * 0.36, 0);
        E.head.tube([[f[0] - 0.05, f[1] - 0.03, 0, 0.11], [f[0] + 0.04, f[1] + 0.25, 0, 0.075], [f[0] + 0.02, f[1] + 0.55, 0, 0.012]], 8, 10, function (x, y, z, ca, sa, R) { return mix(0x8a8276, 0x4a443c, R.t || 0); }, true);
        E.head.tube([[r[0], r[1] - 0.03, 0, 0.075], [r[0] + 0.02, r[1] + 0.12, 0, 0.04], [r[0] + 0.0, r[1] + 0.22, 0, 0.01]], 5, 8, 0x6a645a, true);
        // the wide, square grazing lip
        const l = E.hp(1.0, -E.H.D * 0.1, 0);
        E.head.ellipsoid(l[0] - 0.03, l[1], 0, 0.06, 0.08, 0.17, 10, 0x7a746c, true, 3);
      },
    });
  }

  // ================================================================ BEARS
  function bear(kind) {
    const C = {
      brown: { body: 0x6a4a30, back: 0x8a6a48, belly: 0x4a3222, leg: 0x3e2a1c, face: 0x7a5a3a, muzzle: 0x8a6c4c, nose: 0x1a1412, earIn: 0x4a3426, tail: 0x5a3e28, chin: 0x6a4e34 },
      black: { body: 0x1e1b1a, back: 0x191716, belly: 0x242020, leg: 0x161413, face: 0x221e1d, muzzle: 0xa88a68, nose: 0x161212, earIn: 0x2a2626, tail: 0x1e1b1a, chin: 0x2a2624 },
      polar: { body: 0xece4d0, back: 0xf2ecdc, belly: 0xe0d6c0, leg: 0xe6dcc6, face: 0xf0e8d6, muzzle: 0xeee6d4, nose: 0x141212, earIn: 0xd8ccb8, tail: 0xece4d0, chin: 0xece4d0, pad: 0x2a2626 },
    }[kind];
    const D = {
      brown: { L: 1.85, WH: 1.02, HH: 1.0, chest: 0.6, belly: 0.42, W: 0.36, hump: 0.2, head: { len: 0.44, D: 0.3, Wd: 0.2, ang: 22, muzzleAt: 0.55, prof: [[-0.05, 0.42, 0.42, 0.44], [0.15, 0.55, 0.5, 0.56], [0.4, 0.46, 0.48, 0.48], [0.52, 0.32, 0.4, 0.32], [0.8, 0.27, 0.32, 0.25], [0.97, 0.26, 0.28, 0.23], [1.0, 0.18, 0.2, 0.18]] }, neck: { len: 0.3, ang: 18, r0: 0.34, r1: 0.26 } },
      black: { L: 1.5, WH: 0.85, HH: 0.88, chest: 0.48, belly: 0.37, W: 0.28, hump: 0.0, head: { len: 0.36, D: 0.24, Wd: 0.15, ang: 18, muzzleAt: 0.55 }, neck: { len: 0.24, ang: 20, r0: 0.26, r1: 0.2 } },
      polar: { L: 2.15, WH: 1.25, HH: 1.32, chest: 0.66, belly: 0.55, W: 0.37, hump: 0.0, head: { len: 0.45, D: 0.26, Wd: 0.15, ang: 15, muzzleAt: 0.55, prof: [[-0.05, 0.42, 0.42, 0.42], [0.15, 0.52, 0.5, 0.5], [0.42, 0.46, 0.46, 0.44], [0.6, 0.34, 0.4, 0.3], [0.85, 0.27, 0.32, 0.24], [0.97, 0.26, 0.28, 0.23], [1.0, 0.18, 0.2, 0.18]] }, neck: { len: 0.55, ang: 18, r0: 0.34, r1: 0.22 } },
    }[kind];
    const coat = Object.assign({ pad: 0x1e1a18, claw: kind === "brown" ? 0xc8bca8 : 0x2a2622 }, C);
    return K.quad({
      fam: "bear", L: D.L, WH: D.WH, HH: D.HH, chest: D.chest, belly: D.belly, W: D.W, hump: D.hump, sag: 0.02, sq: 0.9, jaw: true,
      coat: coat, claws: kind === "brown" ? 0.016 : 0.01, legZ: D.W * 0.55,
      neck: Object.assign({ crest: 1.0, dewlap: 1.0 }, D.neck),
      head: D.head,
      ear: { len: D.head.len * 0.2, w: D.head.len * 0.22, kind: "round", up: 75, out: 35, back: 10, s: 0.8, u: 0.88, t: 0.12 },
      eye: { r: D.head.len * 0.045, t: 0.42, up: 0.35, side: 0.78 },
      leg: { f: D.W * 0.36, c: D.W * 0.2, h: D.W * 0.44 },
      tail: { len: 0.1, r: 0.05, droop: 50, taper: 0.4 },
      paint: function (part, x, y, z, ca, sa, t, col) {
        // guard hairs: a grizzled frost on the brown bear's hump and back
        if (kind === "brown" && part === "torso" && ca > 0.45) return mix(col, 0xb8946a, smooth(0.45, 0.95, ca) * smooth(-0.3 * D.L, 0.3 * D.L, x) * 0.6);
        return shade(col, 0.94 + 0.12 * Math.abs(Math.sin(x * 47 + z * 31 + y * 19)));
      },
    });
  }
  function gorilla(silver) {
    const coat = { body: 0x1e1c1c, back: 0x262424, belly: 0x2a2626, leg: 0x1a1818, face: 0x141212, muzzle: 0x161414, nose: 0x0e0c0c, earIn: 0x1a1818, eye: 0x3a2214, chin: 0x161414, pad: 0x161414, claw: 0x161414 };
    return K.quad({
      fam: "bear", L: 0.95, WH: 1.3, HH: 0.86, chest: 0.62, belly: 0.5, W: 0.34, coat: coat, jaw: true, sq: 0.9,
      torsoKeys: [[-0.48, 0.8, 0.6, 0.18], [-0.4, 0.9, 0.5, 0.25], [-0.2, 1.0, 0.5, 0.29], [0.05, 1.16, 0.55, 0.34], [0.25, 1.32, 0.68, 0.4], [0.4, 1.32, 0.84, 0.34], [0.48, 1.2, 0.96, 0.22]],
      neck: { len: 0.2, ang: 38, r0: 0.22, r1: 0.18 },
      head: { len: 0.3, D: 0.36, Wd: 0.15, ang: 8, dx: 0.06, dy: 0.02, muzzleAt: 0.6, prof: [[-0.1, 0.62, 0.36, 0.42], [0.1, 0.62, 0.46, 0.52], [0.4, 0.42, 0.5, 0.52], [0.7, 0.24, 0.42, 0.42], [0.92, 0.22, 0.34, 0.36], [1.0, 0.16, 0.24, 0.26]] },
      ear: { len: 0.04, w: 0.045, kind: "round", up: 0, out: 85, back: 0, s: 0.98, u: 0.0, t: 0.32 },
      eye: { r: 0.017, t: 0.5, up: 0.12, side: 0.72, lid: 0x0e0c0c },
      legZ: 0.3, claws: 0,
      legPts: function (front) {
        return front
          ? [[0.32, 1.2, 0.16, 0.16, 0.13], [0.36, 0.95, 0.13, 0.13, 0.11], [0.34, 0.66, 0.1, 0.1, 0.09], [0.36, 0.38, 0.1, 0.1, 0.09], [0.38, 0.12, 0.075, 0.075, 0.075], [0.42, 0.03, 0.07, 0.06, 0.08], [0.43, 0.004, 0.05, 0.05, 0.065]]
          : [[-0.32, 0.8, 0.14, 0.14, 0.11], [-0.18, 0.55, 0.12, 0.12, 0.1], [-0.12, 0.38, 0.1, 0.1, 0.085], [-0.22, 0.12, 0.075, 0.075, 0.07], [-0.2, 0.03, 0.06, 0.06, 0.07], [-0.08, 0.004, 0.05, 0.04, 0.07]];
      },
      paint: function (part, x, y, z, ca, sa, t, col) {
        if (silver && part === "torso" && ca > 0.2 && x < 0.15 && x > -0.5) return mix(col, 0x7e7c78, smooth(0.2, 0.7, ca) * (1 - smooth(-0.05, 0.15, x)));
        if (part === "torso" && ca < -0.4 && x > 0.1) return 0x2a2626;     // the bare leathery chest
        return shade(col, 0.92 + 0.14 * Math.abs(Math.sin(x * 53 + z * 31 + y * 23)));
      },
      extra: function (E) {
        // the sagittal crest: the domed cone on top of the skull
        const p = E.hp(0.05, E.H.D * 0.55, 0);
        E.head.ellipsoid(p[0] - 0.02, p[1] + 0.02, 0, 0.12, 0.1, 0.07, 9, 0x1e1c1c, true, 3);
        // the heavy brow ridge
        const b = E.hp(0.42, E.H.D * 0.25, 0);
        E.head.ellipsoid(b[0], b[1], 0, 0.04, 0.035, 0.13, 9, 0x121010, true, 3);
      },
    });
  }

  // ================================================================ DOGS
  // the dog's torso: a deep keel of a chest between the elbows, the loin
  // tucked up hard, a short sloping croup (x / L, y / WH, w / W)
  const DOG_TORSO = [[-0.51, 0.84, 0.62, 0.5], [-0.46, 0.97, 0.56, 0.78], [-0.32, 0.97, 0.6, 0.85], [-0.12, 0.96, 0.66, 0.88], [0.08, 0.98, 0.52, 1.0], [0.24, 1.02, 0.45, 0.95], [0.36, 0.98, 0.48, 0.78], [0.43, 0.84, 0.58, 0.5]];
  function canid(o) {
    if (!o.torsoKeys && !o.noKeys) o.torsoKeys = scaleKeys(DOG_TORSO, o.L, o.WH, o.W, 0);
    if (o.frontX == null) o.frontX = 0.26 * o.L;
    return K.quad(Object.assign({ fam: "dog", jaw: true, sq: 1, tuck: 0.06 }, o));
  }
  function wolf(arctic) {
    const coat = arctic
      ? { body: 0xece8e0, back: 0xe2ddd2, belly: 0xf4f2ec, leg: 0xeeeae2, face: 0xeeeae2, muzzle: 0xf2f0ea, nose: 0x141212, earIn: 0xe2dcd2, tail: 0xe8e4dc, tailTip: 0xe0dad0, chin: 0xf4f2ec, pad: 0x2a2626, eye: 0x9a7a2a }
      : { body: 0x8a8276, back: 0x4e4740, belly: 0xd8d0c2, leg: 0x9c8a72, face: 0x7a7266, muzzle: 0xd2c8b8, nose: 0x141212, earIn: 0xc8beb0, tail: 0x6e665c, tailTip: 0x1e1c1a, chin: 0xe2dacc, pad: 0x2a2626, eye: 0xa8862a };
    const k = arctic ? 0.96 : 1;
    return canid({
      L: 1.12 * k, WH: 0.8 * k, HH: 0.78 * k, chest: 0.38 * k, belly: 0.44 * k, W: 0.14 * k, sag: 0.0, coat: coat,
      neck: { len: 0.32 * k, ang: 32, r0: 0.17 * k, r1: 0.12 * k, crest: 1.15, dewlap: 1.2 },
      head: { len: 0.3 * k, D: 0.16 * k, Wd: 0.085 * k, ang: 14, muzzleAt: 0.5 },
      ear: { len: 0.1 * k, w: 0.07 * k, kind: "point", up: 78, out: 15, back: 10, s: 0.62, u: 0.85, t: 0.14 },
      eye: { r: 0.014, t: 0.38, up: 0.4, side: 0.82 },
      leg: { f: 0.045 * k, c: 0.025, h: 0.07 * k }, paw: 0.04 * k, legZ: 0.08 * k,
      tail: { len: 0.48 * k, r: 0.04 * k, droop: 72, taper: 0.1, bush: 0.6, tipAt: 0.82 },
      paint: function (part, x, y, z, ca, sa, t, col) {
        if (arctic) return col;
        if (part === "head" && t > 0.25 && t < 0.6 && ca < 0.35 && ca > -0.4 && Math.abs(sa) > 0.6) return 0xd8d0c2;     // the pale cheeks
        if (part === "torso" && ca > 0.6) return mix(col, 0x2e2a26, smooth(0.6, 0.95, ca) * 0.6);                      // the dark saddle
        return col;
      },
    });
  }
  function coyote() {
    const coat = { body: 0xa08a6a, back: 0x6e5e4a, belly: 0xe2d6c0, leg: 0xb48a5a, face: 0xa8865c, muzzle: 0xd8c8ac, nose: 0x161212, earIn: 0xe2d2b8, tail: 0x8a7658, tailTip: 0x1e1a16, chin: 0xeee4d2, pad: 0x2a2626, eye: 0xb08a2a };
    return canid({
      L: 0.88, WH: 0.6, HH: 0.6, chest: 0.28, belly: 0.34, W: 0.1, coat: coat,
      neck: { len: 0.24, ang: 30, r0: 0.12, r1: 0.085, crest: 1.1, dewlap: 1.15 },
      head: { len: 0.24, D: 0.12, Wd: 0.065, ang: 14, muzzleAt: 0.48 },
      ear: { len: 0.1, w: 0.065, kind: "point", up: 78, out: 15, back: 8, s: 0.62, u: 0.85, t: 0.14 },
      eye: { r: 0.012, t: 0.38, up: 0.4, side: 0.82 },
      leg: { f: 0.034, c: 0.018, h: 0.055 }, paw: 0.03, legZ: 0.06,
      tail: { len: 0.4, r: 0.035, droop: 78, taper: 0.1, bush: 0.5, tipAt: 0.85 },
    });
  }
  function redFox() {
    const coat = { body: 0xc8622a, back: 0xb85622, belly: 0xf2ece2, leg: 0x1e1a18, face: 0xcc6a30, muzzle: 0xf2ece2, nose: 0x141212, earIn: 0xf2e6d8, tail: 0xc05c26, tailTip: 0xf6f2ec, chin: 0xf6f2ec, pad: 0x1e1a18, eye: 0xc89a2a };
    return canid({
      L: 0.62, WH: 0.38, HH: 0.38, chest: 0.19, belly: 0.21, W: 0.075, coat: coat,
      neck: { len: 0.16, ang: 35, r0: 0.08, r1: 0.055, crest: 1.05, dewlap: 1.1 },
      head: { len: 0.17, D: 0.08, Wd: 0.048, ang: 12, muzzleAt: 0.48, prof: [[-0.05, 0.4, 0.38, 0.42], [0.15, 0.5, 0.46, 0.55], [0.38, 0.44, 0.44, 0.5], [0.5, 0.3, 0.36, 0.3], [0.78, 0.2, 0.26, 0.17], [0.97, 0.18, 0.2, 0.14], [1.0, 0.12, 0.14, 0.1]] },
      ear: { len: 0.085, w: 0.06, kind: "point", up: 75, out: 18, back: 8, s: 0.62, u: 0.85, t: 0.14, back_c: 0x1e1a18 },
      eye: { r: 0.009, t: 0.38, up: 0.4, side: 0.82 },
      leg: { f: 0.022, c: 0.012, h: 0.036 }, paw: 0.02, legZ: 0.066,
      tail: { len: 0.4, r: 0.04, droop: 42, curl: 0.5, taper: 0.1, bush: 0.75, tipAt: 0.85 },
      paint: function (part, x, y, z, ca, sa, t, col) {
        if ((part === "legF" || part === "legH") && y > 0.2) return mix(0x1e1a18, coat.body, smooth(0.2, 0.3, y));
        if (part === "neck" && ca < -0.2) return 0xf6f2ec;
        return col;
      },
    });
  }
  function raccoon() {
    const coat = { body: 0x7e7870, back: 0x5e5852, belly: 0xa49c92, leg: 0x3a3634, face: 0xd8d4cc, muzzle: 0xe8e4dc, nose: 0x141212, earIn: 0xe8e4dc, tail: 0x8a847c, tailTip: 0x1e1c1c, chin: 0xe8e4dc, pad: 0x2a2626, eye: 0x1a1210 };
    return canid({
      L: 0.5, WH: 0.27, HH: 0.33, chest: 0.17, belly: 0.1, W: 0.1, sag: -0.02, coat: coat, tuck: 0.0,
      neck: { len: 0.1, ang: 10, r0: 0.08, r1: 0.07 },
      head: { len: 0.14, D: 0.09, Wd: 0.06, ang: 15, muzzleAt: 0.6, prof: [[-0.05, 0.42, 0.4, 0.44], [0.15, 0.52, 0.48, 0.58], [0.42, 0.44, 0.44, 0.5], [0.62, 0.28, 0.32, 0.26], [0.9, 0.18, 0.22, 0.14], [1.0, 0.12, 0.14, 0.1]] },
      ear: { len: 0.04, w: 0.04, kind: "round", up: 70, out: 25, back: 10, s: 0.7, u: 0.8, t: 0.1 },
      eye: { r: 0.009, t: 0.45, up: 0.35, side: 0.8 },
      leg: { f: 0.025, c: 0.014, h: 0.035 }, paw: 0.022, legZ: 0.06,
      tail: { len: 0.25, r: 0.035, droop: 55, taper: 0.2, bush: 0.2, tipAt: 0.92 },
      paint: function (part, x, y, z, ca, sa, t, col) {
        if (part === "head" && t > 0.35 && t < 0.62 && ca > -0.2 && ca < 0.55) return 0x161414;         // the bandit mask
        if (part === "head" && t < 0.35 && ca > 0.3) return 0x6e6862;
        if (part === "tail" && t < 0.92) return Math.sin(t * 30) > 0.2 ? 0x1e1c1c : 0xa8a298;          // the rings
        return col;
      },
    });
  }
  // ================================================================ HARES
  function hare(kind) {
    const C = {
      cottontail: { body: 0x8a7258, back: 0x6e5a44, belly: 0xece4d8, leg: 0x9a8064, face: 0x8a7258, muzzle: 0xa48c70, nose: 0xb88a84, earIn: 0xc8a8a0, tail: 0xf6f2ec, chin: 0xe2d8c8, pad: 0x6a5a48, eye: 0x1a120c },
      jack: { body: 0x9a8668, back: 0x7e6a50, belly: 0xece6da, leg: 0xa89070, face: 0x9a8668, muzzle: 0xb8a284, nose: 0xb88a84, earIn: 0xd8c4b4, tail: 0x1e1a16, chin: 0xece6da, pad: 0x7a6a58, eye: 0x2a1a0c },
      snowshoe: { body: 0xf2f0ec, back: 0xeceae4, belly: 0xf6f4f0, leg: 0xf2f0ec, face: 0xf2f0ec, muzzle: 0xeeeae4, nose: 0xc8a0a0, earIn: 0xe8d8d4, tail: 0xf6f4f0, chin: 0xf6f4f0, pad: 0xd8d0c8, eye: 0x1a120c },
    }[kind];
    const D = { cottontail: [0.3, 0.17, 0.22, 0.09, 0.08], jack: [0.44, 0.27, 0.3, 0.17, 0.12], snowshoe: [0.36, 0.2, 0.25, 0.11, 0.1] }[kind];
    const L = D[0], WH = D[1], HH = D[2];
    return K.quad({
      fam: "hare", L: L, WH: WH, HH: HH, chest: WH * 0.6, belly: WH * 0.38, W: L * 0.2, sq: 1, coat: C,
      torsoKeys: [[-0.52 * L, HH * 0.75, HH * 0.42, L * 0.12], [-0.42 * L, HH * 1.0, HH * 0.25, L * 0.2], [-0.15 * L, HH * 0.98, HH * 0.32, L * 0.21], [0.15 * L, WH * 1.0, WH * 0.4, L * 0.18], [0.38 * L, WH * 0.96, WH * 0.42, L * 0.15], [0.5 * L, WH * 0.82, WH * 0.5, L * 0.1]],
      neck: { len: L * 0.18, ang: 50, r0: L * 0.13, r1: L * 0.1 },
      head: { len: L * 0.3, D: L * 0.26, Wd: L * 0.11, ang: 38, muzzleAt: 0.7, prof: [[-0.05, 0.42, 0.42, 0.44], [0.2, 0.5, 0.5, 0.52], [0.5, 0.44, 0.46, 0.44], [0.8, 0.32, 0.36, 0.32], [0.97, 0.26, 0.28, 0.24], [1.0, 0.18, 0.2, 0.16]] },
      ear: { len: D[3], w: D[3] * 0.36, kind: "long", up: 70, out: 14, back: 32, s: 0.45, u: 0.9, t: 0.05, face: "side", tip: kind === "cottontail" ? null : 0x1a1614 },
      eye: { r: L * 0.04, t: 0.38, up: 0.3, side: 0.9, lid: shade(C.face, 1.2) },
      leg: { f: L * 0.05, c: L * 0.035, h: L * 0.09 }, legZ: Math.max(L * 0.11, 0.04), frontX: 0.32 * L, hindX: -0.25 * L,
      tail: { len: 0.02, r: 0.02, droop: -30, taper: 0, tuft: D[4] * 0.3 },
    });
  }

  // ================================================================ SNAKES
  // A snake is a CHAIN (wildlife.js snakeAnimate places every segment each
  // frame, nose +X, segments trailing down -X at userData.spacing): segment
  // 0 is the head, the last is the tail tip. Each segment here is a lofted
  // spindle a little longer than the spacing, so neighbours overlap into one
  // smooth body as the wave runs down it; its radius runs from this
  // segment's girth to the next one's so the taper is continuous. The coat
  // pattern is painted per vertex from the segment index and the angle round
  // the body (stripes, diamonds, bands, ovals) and cached per species.
  function snake(o) {
    const P = { parts: {}, order: [] };
    const N = o.N, sp = o.spacing, L = sp * 1.4;
    const rAt = function (i) { return Math.max(o.rMin, o.R * (1 - Math.pow(i / (N - 1), 1.6) * (1 - o.rMin / o.R)) * (i < 2 ? 0.82 + 0.09 * i : 1)); };
    // the head: a lofted wedge, the jaw line dark, eyes, nostrils
    const head = P.parts.seg0 = new K.Part("head");
    P.order.push("seg0");
    const H = o.head, hst = [];
    const prof = H.prof || [[-0.35, 0.42, 0.42, 0.48], [-0.1, 0.5, 0.5, 0.62], [0.25, 0.48, 0.46, 0.56], [0.6, 0.36, 0.34, 0.42], [0.9, 0.24, 0.22, 0.26], [1.0, 0.14, 0.12, 0.16]];
    for (let i = 0; i < prof.length; i++) hst.push({ x: prof[i][0] * H.len, y: 0, z: 0, rt: prof[i][1] * H.h, rb: prof[i][2] * H.h, w: prof[i][3] * H.w, sq: 0.85, wts: [0, 1], t: i / (prof.length - 1) });
    head.loft(hst, 12, function (x, y, z, ca, sa, R) {
      let c = ca < -0.35 ? o.belly : o.head_c || o.body;
      if (Math.abs(ca + 0.2) < 0.12 && x > 0) c = shade(c, 0.45);       // the mouth line
      if (H.paint) c = H.paint(x, y, z, ca, sa, c);
      return shade(c, K.grain(x * 30, y * 30, z * 30));
    }, { capLen: 0.7, capN: 2 });
    head.ud.eyes = [];
    [-1, 1].forEach(function (s) {
      const ex = H.len * (H.eyeT != null ? H.eyeT : 0.42), ey = H.h * (H.eyeUp != null ? H.eyeUp : 0.22), ez = s * H.w * 0.5;
      head.ellipsoid(ex, ey, ez, H.h * 0.13, H.h * 0.12, H.h * 0.09, 6, function (x, y, z, ca, sa) { return (s * sa) > 0.3 ? (o.eye || 0x16120a) : shade(o.head_c || o.body, 0.7); }, true, 3);
      head.ellipsoid(ex + H.h * 0.05, ey + H.h * 0.04, ez + s * H.h * 0.08, H.h * 0.03, H.h * 0.03, H.h * 0.02, 4, 0xeeeae0, true, 1);
      head.ud.eyes.push([ex, ey, ez + s * H.h * 0.05, H.h * 0.12]);
      head.ellipsoid(H.len * 0.92, H.h * 0.08, s * H.w * 0.13, H.h * 0.04, H.h * 0.04, H.h * 0.03, 4, 0x0e0c0a, true, 1);   // nostril
    });
    if (H.extra) H.extra(head);
    // the body
    for (let i = 1; i < N; i++) {
      const seg = P.parts["seg" + i] = new K.Part("seg" + i);
      P.order.push("seg" + i);
      const r0 = rAt(i - 1 + 0.5), r1 = rAt(i), r2 = rAt(Math.min(N - 1, i + 0.5));
      const last = i === N - 1;
      const st = [];
      const n = 6;
      // lofted tail-to-head (+X) so the ring's "up" is the spine, not the belly
      for (let kk = 0; kk <= n; kk++) {
        const k = n - kk, u = k / n, x = L / 2 - u * L;
        const r = u < 0.5 ? lerp(r0, r1, u * 2) : lerp(r1, last ? r1 * 0.25 : r2, (u - 0.5) * 2);
        st.push({ x: x, y: 0, z: 0, rt: r * (o.flatTop || 0.92), rb: r * 0.86, w: r * (o.wide || 1.06), sq: 1, wts: [0, 1], t: u });
      }
      seg.loft(st, 10, function (x, y, z, ca, sa, R) {
        const u = R.t != null ? R.t : 0;
        let c = ca < -0.45 ? o.belly : o.body;
        if (o.paint) c = o.paint(i + u, ca, sa, c, x, y, z);
        return shade(c, K.grain(x * 25 + i, y * 25, z * 25));
      }, { capLen: 0.5, capN: 1 });
    }
    if (o.extra) o.extra(P);
    return P;
  }
  // build the group by hand: snakes are not bbox-centred parts on a rig, the
  // engine owns every segment's position
  function snakeGroup(id, key, make, ctx) {
    const sp = CBZ.WILDLIFE_SPECIES[id], sc = (sp && sp.scale) || 1;
    const ck = id + "|" + key;
    let B = SNAKE_CACHE.get(ck);
    if (!B) {
      const P = make(), parts = [];
      P.order.forEach(function (nm) {
        const part = P.parts[nm]; if (!part) return;
        const p = part.G.p; for (let i = 0; i < p.length; i++) p[i] /= sc;
        const geo = CBZ.loftKit.toGeometry(part.G, { static: true });
        geo.computeBoundingBox(); geo.computeBoundingSphere(); geo._shared = true; geo.userData = { _shared: true };
        const ud = Object.assign({}, part.ud);
        if (ud.eyes) ud.eyes = ud.eyes.map(function (e) { return [e[0] / sc, e[1] / sc, e[2] / sc, e[3] / sc]; });
        parts.push({ name: nm, geo: geo, ud: ud, kids: part.kids || null });
      });
      B = { parts: parts, ud: P.ud || {}, sc: sc };
      SNAKE_CACHE.set(ck, B);
    }
    const T = window.THREE, g = new T.Group();
    g.name = "beast:" + id;
    const mat = K.coatMat ? K.coatMat() : new T.MeshLambertMaterial({ vertexColors: true });
    const segs = [];
    B.parts.forEach(function (q, i) {
      const m = new T.Mesh(q.geo, mat);
      m.name = id + ":" + q.name;
      for (const u in q.ud) m.userData[u] = q.ud[u];
      m.position.x = -i * (B.ud.spacing || 0.2) / sc;
      m.position.y = (B.ud.baseY || 0.08) / sc;
      g.add(m); segs.push(m);
    });
    g.userData.segs = segs;
    // the engine reads both in the group's own (scaled) frame
    g.userData.spacing = B.ud.spacing / sc; g.userData.baseY = B.ud.baseY / sc;
    if (B.ud.rear) g.userData.rear = B.ud.rear;
    // the cobra's hood: two flat lofted flaps riding the neck segment (the
    // engine scales them 0.12 -> 1 as it rears)
    if (B.ud.hoodGeo) {
      const hood = [];
      B.ud.hoodGeo.forEach(function (hg) { const h = new T.Mesh(hg, mat); h.name = id + ":hood"; segs[1].add(h); hood.push(h); });
      g.userData.hood = hood;
    }
    if (B.ud.rattle) g.userData.rattle = segs[segs.length - 1];
    return g;
  }
  const SNAKE_CACHE = new Map();
  function geoOf(part, sc) {
    const p = part.G.p; for (let i = 0; i < p.length; i++) p[i] /= sc;
    const geo = CBZ.loftKit.toGeometry(part.G, { static: true });
    geo.computeBoundingBox(); geo.computeBoundingSphere(); geo._shared = true; geo.userData = { _shared: true };
    return geo;
  }

  function garter() {
    const P = snake({
      N: 12, spacing: 0.1, R: 0.024, rMin: 0.008, body: 0x2c3524, belly: 0xc4c48a, eye: 0x120e08,
      head: { len: 0.075, h: 0.045, w: 0.05, eyeT: 0.45 },
      paint: function (f, ca, sa, c) {
        // three yellow stripes: one down the spine, one low on each flank
        if (ca > 0.86) return 0xd8c85a;
        if (Math.abs(ca + 0.15) < 0.14) return 0xc8bc56;
        if (ca > 0.2 && Math.abs(Math.sin(f * 9)) > 0.9) return shade(c, 0.6);     // the checker between
        return c;
      },
    });
    P.ud = { spacing: 0.1, baseY: 0.022 };
    return P;
  }
  function rattlesnake() {
    const P = snake({
      N: 12, spacing: 0.14, R: 0.055, rMin: 0.022, body: 0xb89a6c, belly: 0xe6d8b6, head_c: 0xa88a5e, eye: 0x2a1a08,
      head: {
        len: 0.13, h: 0.065, w: 0.12, eyeT: 0.42, eyeUp: 0.3,
        // the pit viper's wide triangular head, the dark stripe through the eye
        prof: [[-0.3, 0.38, 0.36, 0.38], [-0.05, 0.5, 0.48, 0.66], [0.3, 0.46, 0.44, 0.56], [0.65, 0.34, 0.32, 0.34], [0.92, 0.24, 0.22, 0.2], [1.0, 0.14, 0.12, 0.12]],
        paint: function (x, y, z, ca, sa, c) { return Math.abs(ca - 0.15) < 0.12 && x > -0.02 && x < 0.09 ? 0x3a2a1a : c; },
      },
      paint: function (f, ca, sa, c) {
        // the diamond row down the back: dark brown, rimmed cream
        if (ca > -0.1) {
          const ph = (f * 1.3) % 1, d = Math.abs(ph - 0.5) * 2;           // 0 at a diamond's middle
          const across = Math.acos(Math.max(-1, Math.min(1, ca))) / 1.4;   // 0 on the spine
          const q = d + across;
          if (q < 0.55) return 0x5a3e24;
          if (q < 0.72) return 0xeee2c2;
        }
        if (f > 10.6) return Math.sin(f * 30) > 0 ? 0x1a1610 : 0xe6dcc4;   // black and white tail bands
        return c;
      },
      extra: function (Pp) {
        // the rattle: a stack of bony buttons on the tail tip
        const last = Pp.parts["seg11"];
        for (let k = 0; k < 4; k++) last.ellipsoid(-0.11 - k * 0.028, 0, 0, 0.018, 0.024 - k * 0.003, 0.016 - k * 0.002, 7, k % 2 ? 0xc8b48c : 0xe2d2ac, false, 2);
      },
    });
    P.ud = { spacing: 0.14, baseY: 0.05, rattle: true };
    return P;
  }
  function cobra() {
    const sc = (CBZ.WILDLIFE_SPECIES.king_cobra && CBZ.WILDLIFE_SPECIES.king_cobra.scale) || 1;
    const P = snake({
      N: 13, spacing: 0.28, R: 0.075, rMin: 0.022, body: 0x5e5230, belly: 0xd8c896, head_c: 0x6a5c34, eye: 0x100c06,
      head: { len: 0.16, h: 0.07, w: 0.1, eyeT: 0.48 },
      paint: function (f, ca, sa, c) { return Math.abs(Math.sin(f * 2.2)) > 0.92 ? 0xd2c48e : c; },      // the pale chevron bands
    });
    // the hood: two broad, thin flaps off the neck, cream underneath
    const hoodGeo = [];
    [-1, 1].forEach(function (s) {
      // a broad thin flap standing beside the neck, its face turned forward:
      // cream throat-side in front, olive behind
      const hp = new K.Part("hood"), cx = -0.02;
      hp.ellipsoid(cx, 0.05, s * 0.11, 0.014, 0.17, 0.11, 10, function (x) { return x > cx ? 0xd8c896 : 0x54482a; }, true, 4);
      hoodGeo.push(geoOf(hp, sc));
    });
    P.ud = { spacing: 0.28, baseY: 0.068, rear: 4, hoodGeo: hoodGeo };
    return P;
  }
  function mamba() {
    const P = snake({
      N: 14, spacing: 0.24, R: 0.045, rMin: 0.012, body: 0x5a5a52, belly: 0xb8b8a4, head_c: 0x56564e, eye: 0x141410,
      head: {
        len: 0.12, h: 0.05, w: 0.065, eyeT: 0.4, eyeUp: 0.3,
        // the coffin head: long, square-browed, a narrow snout; the inky mouth
        prof: [[-0.3, 0.4, 0.4, 0.46], [-0.05, 0.5, 0.5, 0.58], [0.4, 0.5, 0.48, 0.54], [0.75, 0.38, 0.36, 0.36], [0.95, 0.28, 0.26, 0.24], [1.0, 0.18, 0.16, 0.16]],
        paint: function (x, y, z, ca, sa, c) { return ca < -0.15 && ca > -0.45 && x > 0.02 ? 0x0a0a0c : c; },
      },
      paint: function (f, ca, sa, c) { return ca > -0.2 && Math.sin(f * 4.2 + sa * 2) > 0.75 ? shade(c, 0.82) : c; },
    });
    P.ud = { spacing: 0.24, baseY: 0.04 };
    return P;
  }
  function anaconda() {
    const P = snake({
      N: 16, spacing: 0.42, R: 0.15, rMin: 0.04, body: 0x56622e, belly: 0xc8c070, head_c: 0x5a662e, eye: 0x18160a, wide: 1.12,
      head: {
        len: 0.26, h: 0.12, w: 0.17, eyeT: 0.5, eyeUp: 0.42,
        prof: [[-0.3, 0.42, 0.42, 0.5], [-0.05, 0.5, 0.5, 0.6], [0.35, 0.46, 0.44, 0.52], [0.7, 0.4, 0.36, 0.42], [0.95, 0.32, 0.28, 0.32], [1.0, 0.2, 0.18, 0.2]],
        paint: function (x, y, z, ca, sa, c) { return ca > 0.1 && ca < 0.5 && Math.abs(sa) > 0.7 && x > -0.05 ? 0xd8a040 : c; },   // the orange stripe behind the eye
      },
      paint: function (f, ca, sa, c) {
        // big black ovals in two staggered rows down the back; ringed spots
        // with yellow centres along the flanks
        const row = Math.sign(sa) || 1, ph = (f * 0.9 + (row > 0 ? 0 : 0.5)) % 1;
        if (ca > 0.35) { const d = Math.hypot((ph - 0.5) * 2.2, (Math.abs(sa) - 0.45) * 3); if (d < 0.75) return 0x16160e; }
        if (ca > -0.45 && ca < 0.2) {
          const p2 = (f * 1.3 + 0.25) % 1, d2 = Math.hypot((p2 - 0.5) * 2.4, (ca + 0.12) * 4.5);
          if (d2 < 0.45) return 0xc8a83a; if (d2 < 0.7) return 0x16160e;
        }
        return c;
      },
    });
    P.ud = { spacing: 0.42, baseY: 0.135 };
    return P;
  }

  // ================================================================ REGISTRY
  const BODIES = {
    horse: function (r) {
      const c = pick(r, ["bay", "bay", "chestnut", "black", "grey", "palomino", "buckskin"]);
      const blaze = r() < 0.35, socks = r() < 0.3;
      return { key: c + blaze + socks, make: function () { return horse(c, blaze, socks); } };
    },
    cow: function (r) { const d = r() < 0.4; return { key: "c" + d, make: function () { return cow(d); } }; },
    lion: function (r) { const m = r() < 0.5; return { key: "l" + m, make: function () { return lion(false, m); } }; },
    white_lion: function (r) { const m = r() < 0.55; return { key: "w" + m, make: function () { return lion(true, m); } }; },
    bengal_tiger: function () { return { key: "t", make: tiger }; },
    cheetah: function () { return { key: "c", make: cheetah }; },
    snow_leopard: function () { return { key: "s", make: snowLeopard }; },
    whitetail_deer: function (r) { const b = r() < 0.5; return { key: "d" + b, make: function () { return whitetail(b, false); } }; },
    white_stag: function () { return { key: "w", make: function () { return whitetail(true, true); } }; },
    african_elephant: function (r) { const b = r() < 0.5; return { key: "e" + b, make: function () { return elephant(b); } }; },
    pig: function () { return { key: "p", make: pig }; },
    sheep: function (r) { const b = r() < 0.5; return { key: "s" + b, make: function () { return sheep(b); } }; },
    goat: function (r) { const c = pick(r, ["white", "brown", "pied"]); return { key: c, make: function () { return goat(c); } }; },
    chicken: function (r) { const h = r() < 0.75; return { key: "c" + h, make: function () { return chicken(h); } }; },
    elk: function (r) { const b = r() < 0.5; return { key: "e" + b, make: function () { return elk(b); } }; },
    moose: function (r) { const b = r() < 0.5; return { key: "m" + b, make: function () { return moose(b); } }; },
    caribou: function (r) { const b = r() < 0.5; return { key: "c" + b, make: function () { return caribou(b); } }; },
    mountain_goat: function () { return { key: "g", make: mountainGoat }; },
    bighorn_sheep: function (r) { const b = r() < 0.55; return { key: "b" + b, make: function () { return bighorn(b); } }; },
    bison: function (r) { const b = r() < 0.5; return { key: "b" + b, make: function () { return bison(b); } }; },
    wild_boar: function () { return { key: "b", make: boar }; },
    zebra: function () { return { key: "z", make: zebra }; },
    giraffe: function () { return { key: "g", make: giraffe }; },
    white_rhino: function () { return { key: "r", make: rhino }; },
    brown_bear: function () { return { key: "b", make: function () { return bear("brown"); } }; },
    black_bear: function () { return { key: "b", make: function () { return bear("black"); } }; },
    polar_bear: function () { return { key: "p", make: function () { return bear("polar"); } }; },
    gorilla: function (r) { const s = r() < 0.6; return { key: "g" + s, make: function () { return gorilla(s); } }; },
    gray_wolf: function () { return { key: "w", make: function () { return wolf(false); } }; },
    arctic_wolf: function () { return { key: "a", make: function () { return wolf(true); } }; },
    coyote: function () { return { key: "c", make: coyote }; },
    red_fox: function () { return { key: "f", make: redFox }; },
    raccoon: function () { return { key: "r", make: raccoon }; },
    cottontail_rabbit: function () { return { key: "c", make: function () { return hare("cottontail"); } }; },
    jackrabbit: function () { return { key: "j", make: function () { return hare("jack"); } }; },
    snowshoe_hare: function () { return { key: "s", make: function () { return hare("snowshoe"); } }; },
  };

  const SNAKES = {
    garter_snake: garter, rattlesnake: rattlesnake, king_cobra: cobra, black_mamba: mamba, green_anaconda: anaconda,
  };
  function build(id, ctx) {
    if (SNAKES[id]) return snakeGroup(id, "s", SNAKES[id], ctx);
    const f = BODIES[id];
    if (!f) return null;
    const v = f((ctx && ctx.rng) || Math.random);
    return K.build(id, v.key, v.make, ctx);
  }
  CBZ.beastBodies = { build: build, has: function (id) { return !!(BODIES[id] || SNAKES[id]); }, BODIES: BODIES };
})();
