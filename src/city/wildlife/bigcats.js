/* ============================================================
   city/wildlife/bigcats.js — the big cats (Panthera & friends).

   Five low-poly box-group predators, each defined as one
   CBZ.defineSpecies({...}). Built from reference photos so the
   silhouette + markings read even at ~12-20 blocky meshes:
   tiger stripes, lion mane, cheetah spots & tear-lines,
   snow-leopard rosettes + fat tail, white-lion pale mane.

   CONTRACT (per wildlife_species.js): metres, FEET AT y=0,
   NOSE toward +X, materials only via ctx.mat(0xRRGGBB), boxes via
   CBZ.boxGeom(w,h,d). No colliders / lights / per-frame work.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const S = CBZ.defineSpecies;
  if (!S) return;

  // ---- 1. BENGAL TIGER ----------------------------------------
  // Deep orange coat, bold black vertical stripes on body & legs,
  // white belly & cheeks, long black-ringed tail.
  S({
    id: "bengal_tiger", name: "Bengal Tiger", biome: "forest", rarity: "rare",
    hp: 150, fur: "Tiger Pelt", furValue: 400, meat: "Game Meat", meatValue: 12,
    packs: 1, spd: 3.2, danger: 0.8, bite: 26, scale: 1.1, color: 0xd98a2b,
    build: function (ctx) {
      const T = ctx.THREE, m = ctx.mat, g = new T.Group();
      function box(w, h, d, mm) { return new T.Mesh(CBZ.boxGeom(w, h, d), mm); }
      const c = m(0xd98a2b), belly = m(0xe8e0d2), dk = m(0x1c150e);
      const body = box(1.7, 0.62, 0.62, c); body.position.set(0, 0.82, 0); g.add(body);
      const under = box(1.6, 0.24, 0.52, belly); under.position.set(0, 0.56, 0); g.add(under);
      const head = box(0.52, 0.46, 0.5, c); head.position.set(1.0, 0.92, 0); g.add(head);
      const muzzle = box(0.22, 0.24, 0.34, belly); muzzle.position.set(1.34, 0.82, 0); g.add(muzzle);
      const nose = box(0.1, 0.1, 0.12, dk); nose.position.set(1.46, 0.9, 0); g.add(nose);
      [-1, 1].forEach(function (s) { const e = box(0.1, 0.16, 0.14, c); e.position.set(0.9, 1.2, s * 0.18); g.add(e); });
      [[0.55, 0.22], [0.55, -0.22], [-0.55, 0.22], [-0.55, -0.22]].forEach(function (o) {
        const l = box(0.19, 0.72, 0.19, c); l.position.set(o[0], 0.37, o[1]); g.add(l);
      });
      const tail = box(0.9, 0.13, 0.13, c); tail.position.set(-1.05, 0.9, 0); tail.rotation.z = 0.45; g.add(tail);
      const tip = box(0.18, 0.15, 0.15, dk); tip.position.set(-1.42, 1.06, 0); g.add(tip);
      // bold black vertical stripes across body & legs:
      [0.55, 0.28, 0.02, -0.24, -0.5].forEach(function (x) {
        const s = box(0.07, 0.64, 0.64, dk); s.position.set(x, 0.84, 0); g.add(s);
      });
      [[0.55, 0.22], [-0.55, -0.22]].forEach(function (o) {
        const ls = box(0.2, 0.16, 0.2, dk); ls.position.set(o[0], 0.5, o[1]); g.add(ls);
      });
      return g;
    },
  });

  // ---- 2. LION (male) -----------------------------------------
  // Tawny sand body, big dark-brown mane ring around head/neck,
  // dark tuft at tail tip.
  S({
    id: "lion", name: "Lion", biome: "desert", rarity: "rare",
    hp: 160, fur: "Lion Pelt", furValue: 380, meat: "Game Meat", meatValue: 12,
    herd: [1, 2], packs: 2, spd: 3.0, danger: 0.8, bite: 26, scale: 1.15, color: 0xc79a5b,
    build: function (ctx) {
      const T = ctx.THREE, m = ctx.mat, g = new T.Group();
      function box(w, h, d, mm) { return new T.Mesh(CBZ.boxGeom(w, h, d), mm); }
      const c = m(0xc79a5b), belly = m(0xd9c39a), mane = m(0x5a3a1c), dk = m(0x3a2410);
      const body = box(1.7, 0.64, 0.64, c); body.position.set(0, 0.88, 0); g.add(body);
      const under = box(1.6, 0.24, 0.54, belly); under.position.set(0, 0.62, 0); g.add(under);
      const head = box(0.52, 0.48, 0.5, c); head.position.set(1.02, 1.0, 0); g.add(head);
      const muzzle = box(0.24, 0.24, 0.34, belly); muzzle.position.set(1.36, 0.9, 0); g.add(muzzle);
      const nose = box(0.1, 0.1, 0.12, dk); nose.position.set(1.48, 0.98, 0); g.add(nose);
      [-1, 1].forEach(function (s) { const e = box(0.1, 0.14, 0.12, c); e.position.set(0.94, 1.26, s * 0.16); g.add(e); });
      // the big dark mane ring around head & neck (a shaggy box shell):
      const maneMain = box(0.72, 0.78, 0.78, mane); maneMain.position.set(0.72, 1.0, 0); g.add(maneMain);
      const maneChest = box(0.42, 0.5, 0.6, mane); maneChest.position.set(0.9, 0.6, 0); g.add(maneChest);
      [[0.55, 0.22], [0.55, -0.22], [-0.55, 0.22], [-0.55, -0.22]].forEach(function (o) {
        const l = box(0.2, 0.78, 0.2, c); l.position.set(o[0], 0.39, o[1]); g.add(l);
      });
      const tail = box(0.9, 0.12, 0.12, c); tail.position.set(-1.05, 0.96, 0); tail.rotation.z = 0.5; g.add(tail);
      const tuft = box(0.16, 0.22, 0.16, dk); tuft.position.set(-1.4, 1.16, 0); g.add(tuft);
      return g;
    },
  });

  // ---- 3. CHEETAH ---------------------------------------------
  // Slender pale-gold body, many small round black spots, black
  // tear-line stripes from eyes, small head, long thin tail.
  S({
    id: "cheetah", name: "Cheetah", biome: "desert", rarity: "rare",
    hp: 90, fur: "Cheetah Pelt", furValue: 340, meat: "Game Meat", meatValue: 12,
    packs: 2, spd: 4.0, danger: 0.6, bite: 18, scale: 0.95, color: 0xd8b56a,
    build: function (ctx) {
      const T = ctx.THREE, m = ctx.mat, g = new T.Group();
      function box(w, h, d, mm) { return new T.Mesh(CBZ.boxGeom(w, h, d), mm); }
      const c = m(0xd8b56a), belly = m(0xe9ddc2), dk = m(0x1a140c);
      const body = box(1.5, 0.46, 0.46, c); body.position.set(0, 0.9, 0); g.add(body);
      const under = box(1.4, 0.18, 0.38, belly); under.position.set(0, 0.72, 0); g.add(under);
      const neck = box(0.34, 0.4, 0.34, c); neck.position.set(0.82, 1.02, 0); neck.rotation.z = -0.35; g.add(neck);
      const head = box(0.36, 0.34, 0.36, c); head.position.set(1.06, 1.14, 0); g.add(head);
      const muzzle = box(0.16, 0.16, 0.24, belly); muzzle.position.set(1.28, 1.06, 0); g.add(muzzle);
      const nose = box(0.08, 0.08, 0.1, dk); nose.position.set(1.38, 1.1, 0); g.add(nose);
      [-1, 1].forEach(function (s) { const e = box(0.08, 0.1, 0.1, c); e.position.set(1.0, 1.34, s * 0.14); g.add(e); });
      // black tear-line stripes from eyes down the muzzle:
      [-1, 1].forEach(function (s) { const t = box(0.2, 0.1, 0.04, dk); t.position.set(1.18, 1.08, s * 0.15); t.rotation.z = 0.5; g.add(t); });
      [[0.52, 0.16], [0.52, -0.16], [-0.52, 0.16], [-0.52, -0.16]].forEach(function (o) {
        const l = box(0.14, 0.86, 0.14, c); l.position.set(o[0], 0.43, o[1]); g.add(l);
      });
      const tail = box(1.0, 0.11, 0.11, c); tail.position.set(-1.02, 0.94, 0); tail.rotation.z = 0.28; g.add(tail);
      const tip = box(0.16, 0.13, 0.13, dk); tip.position.set(-1.5, 1.08, 0); g.add(tip);
      // many small round black spots over the body:
      [[0.5, 0.24], [0.25, -0.2], [0.0, 0.24], [-0.25, -0.22], [-0.5, 0.2], [0.35, 0.0], [-0.15, 0.0]].forEach(function (o) {
        const sp = box(0.1, 0.1, 0.1, dk); sp.position.set(o[0], 1.0, o[1]); g.add(sp);
      });
      return g;
    },
  });

  // ---- 4. SNOW LEOPARD (legendary) ----------------------------
  // Pale smoky grey-white, dark-grey rosettes/spots, very thick
  // long fluffy tail, small rounded ears. High-mountain snow.
  S({
    id: "snow_leopard", name: "Snow Leopard", biome: "snow", rarity: "legendary",
    hp: 120, fur: "Legendary Snow Leopard Pelt", furValue: 2200, respawn: false,
    packs: 1, spd: 3.6, danger: 0.7, bite: 22, scale: 1.0, color: 0xd7d9dc,
    build: function (ctx) {
      const T = ctx.THREE, m = ctx.mat, g = new T.Group();
      function box(w, h, d, mm) { return new T.Mesh(CBZ.boxGeom(w, h, d), mm); }
      const c = m(0xd7d9dc), belly = m(0xf1f2f4), dk = m(0x585c62);
      const body = box(1.6, 0.6, 0.6, c); body.position.set(0, 0.82, 0); g.add(body);
      const under = box(1.5, 0.24, 0.5, belly); under.position.set(0, 0.58, 0); g.add(under);
      const head = box(0.5, 0.46, 0.5, c); head.position.set(0.98, 0.92, 0); g.add(head);
      const muzzle = box(0.22, 0.22, 0.34, belly); muzzle.position.set(1.3, 0.84, 0); g.add(muzzle);
      const nose = box(0.1, 0.1, 0.12, m(0x8a6a72)); nose.position.set(1.42, 0.9, 0); g.add(nose);
      [-1, 1].forEach(function (s) { const e = box(0.1, 0.12, 0.12, c); e.position.set(0.88, 1.2, s * 0.17); g.add(e); });
      [[0.55, 0.22], [0.55, -0.22], [-0.55, 0.22], [-0.55, -0.22]].forEach(function (o) {
        const l = box(0.2, 0.7, 0.2, c); l.position.set(o[0], 0.36, o[1]); g.add(l);
      });
      // very thick long fluffy tail, curling up at the tip:
      const tail = box(1.1, 0.24, 0.24, c); tail.position.set(-1.1, 0.86, 0); tail.rotation.z = 0.3; g.add(tail);
      const tailUp = box(0.3, 0.22, 0.22, c); tailUp.position.set(-1.62, 1.14, 0); g.add(tailUp);
      // dark-grey rosettes / spots over body, legs & tail:
      [[0.5, 0.26], [0.2, -0.24], [-0.1, 0.26], [-0.4, -0.22], [0.3, 0.0], [-0.55, 0.24]].forEach(function (o) {
        const sp = box(0.13, 0.62, 0.13, dk); sp.position.set(o[0], 0.84, o[1]); g.add(sp);
      });
      const trs = box(0.12, 0.12, 0.28, dk); trs.position.set(-1.0, 0.94, 0); g.add(trs);
      return g;
    },
  });

  // ---- 5. WHITE LION (legendary) ------------------------------
  // Huge cream/ivory lion with a pale blond-white mane, dark
  // eyeliner & nose leather against the pale coat.
  S({
    id: "white_lion", name: "White Lion", biome: "desert", rarity: "legendary",
    hp: 200, fur: "Legendary White Lion Pelt", furValue: 2000, respawn: false,
    packs: 1, spd: 3.0, danger: 0.85, bite: 28, scale: 1.2, color: 0xefe9dc,
    build: function (ctx) {
      const T = ctx.THREE, m = ctx.mat, g = new T.Group();
      function box(w, h, d, mm) { return new T.Mesh(CBZ.boxGeom(w, h, d), mm); }
      const c = m(0xefe9dc), belly = m(0xf7f3ea), mane = m(0xdcd0b6), dk = m(0x2a2018);
      const body = box(1.8, 0.68, 0.68, c); body.position.set(0, 0.92, 0); g.add(body);
      const under = box(1.7, 0.26, 0.58, belly); under.position.set(0, 0.64, 0); g.add(under);
      const head = box(0.56, 0.5, 0.54, c); head.position.set(1.06, 1.04, 0); g.add(head);
      const muzzle = box(0.26, 0.26, 0.36, belly); muzzle.position.set(1.42, 0.94, 0); g.add(muzzle);
      const nose = box(0.11, 0.11, 0.13, dk); nose.position.set(1.55, 1.02, 0); g.add(nose);
      // dark eyeliner markings against the pale face:
      [-1, 1].forEach(function (s) { const el = box(0.08, 0.05, 0.06, dk); el.position.set(1.2, 1.12, s * 0.16); g.add(el); });
      [-1, 1].forEach(function (s) { const e = box(0.1, 0.14, 0.12, c); e.position.set(0.98, 1.3, s * 0.17); g.add(e); });
      // big pale-blond mane ring around head & neck:
      const maneMain = box(0.78, 0.84, 0.84, mane); maneMain.position.set(0.76, 1.04, 0); g.add(maneMain);
      const maneChest = box(0.46, 0.54, 0.64, mane); maneChest.position.set(0.96, 0.62, 0); g.add(maneChest);
      [[0.58, 0.24], [0.58, -0.24], [-0.58, 0.24], [-0.58, -0.24]].forEach(function (o) {
        const l = box(0.22, 0.82, 0.22, c); l.position.set(o[0], 0.41, o[1]); g.add(l);
      });
      const tail = box(0.95, 0.13, 0.13, c); tail.position.set(-1.1, 1.0, 0); tail.rotation.z = 0.5; g.add(tail);
      const tuft = box(0.17, 0.22, 0.17, mane); tuft.position.set(-1.46, 1.2, 0); g.add(tuft);
      return g;
    },
  });
})();
