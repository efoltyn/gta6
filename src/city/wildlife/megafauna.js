/* ============================================================
   city/wildlife/megafauna.js — SAVANNA MEGAFAUNA (big desert/savanna beasts).

   Four low-poly giants for the desert (savanna) biome, each a
   CBZ.defineSpecies({...}) call the wildlife engine stocks & hunts. Reference
   photos were consulted so every silhouette carries the RIGHT features:
     • african_elephant — grey wrinkled hulk, huge fan EARS, long TRUNK to the
       ground, two ivory TUSKS, columnar legs.               (0x8f8b86)
     • white_rhino      — grey barrel, shoulder HUMP, head slung LOW, TWO nose
       horns (long front + short rear).                       (0x9a9791)
     • giraffe          — towering sloping NECK to a ~5.5m head, two ossicones,
       tan coat blotched with brown PATCHES, stilt legs.      (0xd9b46a)
     • zebra            — horse build, cream coat banded with bold black
       STRIPES, erect mane, tufted tail.                      (0xf2f0ea)

   CONTRACT (per the engine): model in METRES, FEET at y=0, NOSE toward +X,
   materials only via ctx.mat(0xRRGGBB), boxes via CBZ.boxGeom(w,h,d), a few
   cones/cylinders for horns/tusks/trunk. Static posed group, low-poly.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const S = CBZ.defineSpecies;
  if (!S) return;

  // ------------------------------------------------------------------
  // 1. AFRICAN ELEPHANT — massive grey hulk, big ears, trunk, tusks.
  // ------------------------------------------------------------------
  S({
    id: "african_elephant", name: "African Elephant", biome: "desert", rarity: "rare",
    hp: 600, fur: "Elephant Hide", furValue: 500, meat: "Game Meat", meatValue: 12,
    scale: 1.0, herd: [2, 3], packs: 1, spd: 1.4, danger: 0.5, bite: 40, spook: 0,
    color: 0x8f8b86,
    build: function (ctx) {
      const T = ctx.THREE, m = ctx.mat;
      function box(w, h, d, mm) { return new T.Mesh(CBZ.boxGeom(w, h, d), mm); }
      const g = new T.Group();
      const grey = m(0x8f8b86), dark = m(0x726f6a), ivory = m(0xe8e2d0);

      const body = box(3.6, 2.0, 2.0, grey); body.position.set(0, 2.6, 0); g.add(body);
      const rump = box(1.8, 2.2, 2.0, grey); rump.position.set(-1.1, 2.5, 0); g.add(rump);
      const head = box(1.5, 1.5, 1.4, grey); head.position.set(2.2, 2.95, 0); g.add(head);

      // huge thin fan ears splayed off the head
      [1, -1].forEach(function (s) {
        const ear = box(0.16, 1.5, 1.3, dark);
        ear.position.set(1.95, 2.9, s * 0.98); ear.rotation.y = s * 0.35; g.add(ear);
      });

      // trunk — 4 tapering cylinder segments hanging to the ground, off head front
      const trunk = [[0.34, 0.30, 0.7, 2.35], [0.30, 0.25, 0.7, 1.65],
                     [0.25, 0.19, 0.7, 0.95], [0.19, 0.13, 0.6, 0.35]];
      trunk.forEach(function (t, i) {
        const seg = new T.Mesh(new T.CylinderGeometry(t[0], t[1], t[2], 7), grey);
        seg.position.set(2.95 + i * 0.03, t[3], 0); g.add(seg);
      });

      // two ivory tusks beside the trunk, curving forward & down
      [1, -1].forEach(function (s) {
        const tusk = new T.Mesh(new T.ConeGeometry(0.14, 1.2, 7), ivory);
        tusk.position.set(2.85, 2.1, s * 0.42);
        tusk.rotation.z = -Math.PI / 2 - 0.35; g.add(tusk);
      });

      // thick columnar legs
      [[1.25, 0.72], [1.25, -0.72], [-1.25, 0.72], [-1.25, -0.72]].forEach(function (o) {
        const l = box(0.62, 2.3, 0.62, grey); l.position.set(o[0], 1.15, o[1]); g.add(l);
      });

      const tail = box(0.14, 1.1, 0.14, dark); tail.position.set(-1.95, 1.9, 0); g.add(tail);
      return g;
    },
  });

  // ------------------------------------------------------------------
  // 2. WHITE RHINO — grey barrel, shoulder hump, low head, two nose horns.
  // ------------------------------------------------------------------
  S({
    id: "white_rhino", name: "White Rhino", biome: "desert", rarity: "rare",
    hp: 500, fur: "Rhino Hide", furValue: 460, packs: 1, herd: [1, 2],
    spd: 1.8, danger: 0.7, bite: 36, spook: 0, scale: 1.0, color: 0x9a9791,
    build: function (ctx) {
      const T = ctx.THREE, m = ctx.mat;
      function box(w, h, d, mm) { return new T.Mesh(CBZ.boxGeom(w, h, d), mm); }
      const g = new T.Group();
      const grey = m(0x9a9791), dark = m(0x7c7a74), horn = m(0xcfcabf);

      const body = box(3.4, 1.7, 1.6, grey); body.position.set(0, 1.85, 0); g.add(body);
      const hump = box(1.3, 0.75, 1.5, grey); hump.position.set(0.5, 2.55, 0); g.add(hump);   // shoulder hump
      const neck = box(1.1, 1.0, 1.1, grey); neck.position.set(1.65, 1.55, 0); neck.rotation.z = -0.25; g.add(neck);
      const head = box(1.5, 0.9, 0.85, grey); head.position.set(2.5, 1.15, 0); g.add(head);   // carried LOW
      const snout = box(0.75, 0.6, 0.75, grey); snout.position.set(3.1, 1.0, 0); g.add(snout);

      // two horns on the snout: big front cone + shorter rear cone
      const front = new T.Mesh(new T.ConeGeometry(0.24, 1.1, 7), horn);
      front.position.set(3.3, 1.65, 0); front.rotation.z = -0.28; g.add(front);
      const rear = new T.Mesh(new T.ConeGeometry(0.18, 0.55, 7), horn);
      rear.position.set(2.75, 1.75, 0); rear.rotation.z = -0.1; g.add(rear);

      // small ears atop the head
      [1, -1].forEach(function (s) {
        const ear = box(0.14, 0.36, 0.22, dark); ear.position.set(2.15, 1.9, s * 0.34); g.add(ear);
      });

      // thick short legs
      [[1.15, 0.55], [1.15, -0.55], [-1.15, 0.55], [-1.15, -0.55]].forEach(function (o) {
        const l = box(0.56, 1.4, 0.56, grey); l.position.set(o[0], 0.7, o[1]); g.add(l);
      });

      const tail = box(0.12, 0.9, 0.12, dark); tail.position.set(-1.85, 1.4, 0); g.add(tail);
      return g;
    },
  });

  // ------------------------------------------------------------------
  // 3. GIRAFFE — towering sloping neck, tan coat with brown patches.
  // ------------------------------------------------------------------
  S({
    id: "giraffe", name: "Giraffe", biome: "desert", rarity: "uncommon",
    hp: 220, fur: "Giraffe Hide", furValue: 260, herd: [3, 7], packs: 1,
    spd: 2.2, danger: 0, spook: 30, scale: 1.0, color: 0xd9b46a,
    build: function (ctx) {
      const T = ctx.THREE, m = ctx.mat;
      function box(w, h, d, mm) { return new T.Mesh(CBZ.boxGeom(w, h, d), mm); }
      const g = new T.Group();
      const tan = m(0xd9b46a), patch = m(0x8a5a2a), dark = m(0x5c3a1c);

      // long stilt legs
      [[0.85, 0.6], [0.85, -0.6], [-0.85, 0.6], [-0.85, -0.6]].forEach(function (o) {
        const l = box(0.4, 3.0, 0.4, tan); l.position.set(o[0], 1.5, o[1]); g.add(l);
      });

      const body = box(2.2, 1.5, 1.3, tan); body.position.set(0, 3.6, 0); body.rotation.z = 0.12; g.add(body);

      // very long neck sloping up toward the head (~5.5m)
      const neck = box(0.7, 2.9, 0.75, tan); neck.position.set(1.15, 4.9, 0); neck.rotation.z = -0.5; g.add(neck);
      const head = box(0.95, 0.55, 0.55, tan); head.position.set(2.0, 6.35, 0); g.add(head);
      const muzzle = box(0.55, 0.4, 0.45, dark); muzzle.position.set(2.45, 6.25, 0); g.add(muzzle);

      // two ossicone bumps
      [1, -1].forEach(function (s) {
        const oss = new T.Mesh(new T.ConeGeometry(0.08, 0.35, 6), dark);
        oss.position.set(1.95, 6.75, s * 0.15); g.add(oss);
      });
      // ears
      [1, -1].forEach(function (s) {
        const ear = box(0.3, 0.14, 0.09, tan); ear.position.set(1.78, 6.48, s * 0.34); g.add(ear);
      });

      // irregular brown patches laid over body & neck
      const patches = [[0.5, 3.8, 0.67], [-0.4, 3.5, 0.67], [0.1, 3.9, -0.67],
                       [-0.6, 3.55, -0.67], [1.05, 4.55, 0.34]];
      patches.forEach(function (p) {
        const w = Math.abs(p[2]) > 0.5 ? 0.55 : 0.05;
        const d = Math.abs(p[2]) > 0.5 ? 0.05 : 0.45;
        const pt = box(w, 0.45, d, patch); pt.position.set(p[0], p[1], p[2]); g.add(pt);
      });

      // short dark mane along the back of the neck
      [[0.75, 4.35], [1.55, 5.85]].forEach(function (o) {
        const mn = box(0.12, 0.3, 0.55, dark); mn.position.set(o[0], o[1], 0); mn.rotation.z = -0.5; g.add(mn);
      });

      const tail = box(0.1, 1.4, 0.1, tan); tail.position.set(-1.1, 3.0, 0); g.add(tail);
      const tuft = box(0.15, 0.4, 0.15, dark); tuft.position.set(-1.15, 2.25, 0); g.add(tuft);
      return g;
    },
  });

  // ------------------------------------------------------------------
  // 4. ZEBRA — horse build, cream coat with bold black stripes.
  // ------------------------------------------------------------------
  S({
    id: "zebra", name: "Zebra", biome: "desert", rarity: "common",
    hp: 90, fur: "Zebra Hide", furValue: 120, meat: "Game Meat", meatValue: 12,
    herd: [8, 18], packs: 2, spd: 3.0, danger: 0, spook: 28, scale: 1.0, color: 0xf2f0ea,
    build: function (ctx) {
      const T = ctx.THREE, m = ctx.mat;
      function box(w, h, d, mm) { return new T.Mesh(CBZ.boxGeom(w, h, d), mm); }
      const g = new T.Group();
      const cream = m(0xf2f0ea), black = m(0x1a1a1a);

      const body = box(1.9, 0.9, 0.7, cream); body.position.set(0, 1.35, 0); g.add(body);
      const neck = box(0.5, 0.85, 0.48, cream); neck.position.set(0.9, 1.85, 0); neck.rotation.z = -0.5; g.add(neck);
      const head = box(0.7, 0.42, 0.4, cream); head.position.set(1.35, 2.25, 0); g.add(head);
      const muzzle = box(0.4, 0.3, 0.34, black); muzzle.position.set(1.68, 2.12, 0); g.add(muzzle);
      [1, -1].forEach(function (s) {
        const ear = box(0.12, 0.22, 0.09, cream); ear.position.set(1.2, 2.5, s * 0.14); g.add(ear);
      });

      // legs
      [[0.68, 0.26], [0.68, -0.26], [-0.68, 0.26], [-0.68, -0.26]].forEach(function (o) {
        const l = box(0.2, 1.35, 0.2, cream); l.position.set(o[0], 0.675, o[1]); g.add(l);
      });

      // erect striped mane
      [[0.45, 2.0], [0.72, 2.18], [0.98, 2.36]].forEach(function (o) {
        const mn = box(0.1, 0.26, 0.4, black); mn.position.set(o[0], o[1], 0); mn.rotation.z = -0.5; g.add(mn);
      });

      // bold vertical black stripes wrapping the body
      [-0.75, -0.4, -0.05, 0.3, 0.65].forEach(function (x) {
        const st = box(0.07, 0.92, 0.73, black); st.position.set(x, 1.35, 0); g.add(st);
      });
      // stripes across the neck
      [[0.72, 1.68], [0.95, 2.0]].forEach(function (o) {
        const st = box(0.07, 0.5, 0.5, black); st.position.set(o[0], o[1], 0); st.rotation.z = -0.5; g.add(st);
      });

      const tail = box(0.08, 0.7, 0.08, cream); tail.position.set(-0.95, 1.4, 0); g.add(tail);
      const tuft = box(0.12, 0.32, 0.12, black); tuft.position.set(-0.98, 0.92, 0); g.add(tuft);
      return g;
    },
  });
})();
