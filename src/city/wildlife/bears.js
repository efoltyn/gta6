(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const S = CBZ.defineSpecies;
  if (!S) return;

  // ============================================================
  //  BLACK BEAR — Ursus americanus.
  //  Reference: near-black coat, pale tan/brown muzzle, tall oval rounded
  //  ears set well back, STRAIGHT/convex ("Roman") face profile, FLAT back
  //  (no shoulder hump — rump slightly higher than shoulders).
  // ============================================================
  S({
    id: "black_bear", name: "Black Bear", biome: "forest", rarity: "rare",
    hp: 170, fur: "Black Bear Pelt", furValue: 180, meat: "Bear Meat",
    meatValue: 20, meatYield: 2, packs: 2, spd: 2.0, danger: 0.6, bite: 18,
    scale: 1.25, color: 0x1b1712,
    build: function (ctx) {
      const T = ctx.THREE, m = ctx.mat;
      const g = new T.Group();
      function box(w, h, d, mm) { return new T.Mesh(CBZ.boxGeom(w, h, d), mm); }
      const coat = m(0x1b1712), muzzle = m(0x7a5638), claw = m(0x0d0b09);
      // broad barrel body, flat back (rump end lifted a touch)
      const body = box(1.9, 1.0, 1.05, coat); body.position.set(0, 1.02, 0); g.add(body);
      const rump = box(0.85, 1.05, 1.0, coat); rump.position.set(-0.78, 1.08, 0); g.add(rump);
      const chest = box(0.8, 0.95, 1.0, coat); chest.position.set(0.72, 0.98, 0); g.add(chest);
      // thick short neck + round head with straight muzzle
      const neck = box(0.55, 0.6, 0.7, coat); neck.position.set(1.12, 1.05, 0); g.add(neck);
      const head = box(0.62, 0.6, 0.6, coat); head.position.set(1.5, 1.1, 0); g.add(head);
      const snout = box(0.42, 0.34, 0.4, muzzle); snout.position.set(1.85, 1.0, 0); g.add(snout);
      const nose = box(0.14, 0.12, 0.16, claw); nose.position.set(2.07, 1.04, 0); g.add(nose);
      // tall oval rounded ears, set well back on head
      [0.22, -0.22].forEach(function (z) {
        const ear = box(0.16, 0.26, 0.12, coat); ear.position.set(1.34, 1.5, z); g.add(ear);
      });
      // short thick legs
      [[0.62, 0.34], [0.62, -0.34], [-0.62, 0.34], [-0.62, -0.34]].forEach(function (o) {
        const l = box(0.3, 0.85, 0.32, coat); l.position.set(o[0], 0.42, o[1]); g.add(l);
        const paw = box(0.34, 0.16, 0.4, claw); paw.position.set(o[0] + 0.04, 0.08, o[1]); g.add(paw);
      });
      const tail = box(0.16, 0.16, 0.16, coat); tail.position.set(-1.2, 1.0, 0); g.add(tail);
      return g;
    },
  });

  // ============================================================
  //  BROWN BEAR (Grizzly) — Ursus arctos.
  //  Reference: grizzled brown, silver-tipped shoulders, PRONOUNCED muscular
  //  shoulder hump (higher than rump), concave "dished" face, short round
  //  ears, massive build, long front claws.
  // ============================================================
  S({
    id: "brown_bear", name: "Brown Bear", biome: "forest", rarity: "rare",
    hp: 200, fur: "Brown Bear Pelt", furValue: 210, meat: "Bear Meat",
    meatValue: 20, meatYield: 3, packs: 2, spd: 2.1, danger: 0.7, bite: 22,
    scale: 1.35, color: 0x5a3d24,
    build: function (ctx) {
      const T = ctx.THREE, m = ctx.mat;
      const g = new T.Group();
      function box(w, h, d, mm) { return new T.Mesh(CBZ.boxGeom(w, h, d), mm); }
      const coat = m(0x5a3d24), grizzle = m(0x8a6a45), muzzle = m(0x6f5236), claw = m(0x1a120a);
      // huge barrel body
      const body = box(2.05, 1.1, 1.2, coat); body.position.set(0, 1.08, 0); g.add(body);
      const rump = box(0.9, 1.05, 1.15, coat); rump.position.set(-0.85, 1.02, 0); g.add(rump);
      // PRONOUNCED shoulder hump — silver-tipped, riding above the back
      const shoulder = box(0.95, 1.2, 1.18, coat); shoulder.position.set(0.55, 1.2, 0); g.add(shoulder);
      const hump = box(0.8, 0.5, 1.0, grizzle); hump.position.set(0.55, 1.85, 0); g.add(hump);
      // neck sloping down off the hump to a dished head
      const neck = box(0.6, 0.62, 0.75, coat); neck.position.set(1.15, 1.14, 0); g.add(neck);
      const head = box(0.66, 0.6, 0.62, coat); head.position.set(1.55, 1.08, 0); g.add(head);
      // dished (concave) face: brow block + dropped snout
      const brow = box(0.4, 0.24, 0.55, coat); brow.position.set(1.62, 1.32, 0); g.add(brow);
      const snout = box(0.46, 0.32, 0.42, muzzle); snout.position.set(1.92, 0.94, 0); g.add(snout);
      const nose = box(0.15, 0.13, 0.18, claw); nose.position.set(2.15, 0.98, 0); g.add(nose);
      // small round ears
      [0.24, -0.24].forEach(function (z) {
        const ear = box(0.15, 0.2, 0.12, coat); ear.position.set(1.42, 1.48, z); g.add(ear);
      });
      // short thick powerful legs, front legs beefier
      [[0.68, 0.38, 0.34], [0.68, -0.38, 0.34], [-0.68, 0.38, 0.3], [-0.68, -0.38, 0.3]].forEach(function (o) {
        const l = box(o[2], 0.9, o[2] + 0.02, coat); l.position.set(o[0], 0.45, o[1]); g.add(l);
        const paw = box(o[2] + 0.06, 0.16, 0.46, claw); paw.position.set(o[0] + 0.05, 0.08, o[1]); g.add(paw);
      });
      const tail = box(0.16, 0.16, 0.16, coat); tail.position.set(-1.28, 1.0, 0); g.add(tail);
      return g;
    },
  });

  // ============================================================
  //  POLAR BEAR — Ursus maritimus. Lives on the sea ice (biome: snow).
  //  Reference: cream-white / straw coat, LONG neck, narrow elongated skull,
  //  black nose & footpads, low shoulder hump, massive elongated body.
  // ============================================================
  S({
    id: "polar_bear", name: "Polar Bear", biome: "snow", rarity: "rare",
    hp: 240, fur: "Polar Bear Pelt", furValue: 320, meat: "Bear Meat",
    meatValue: 24, meatYield: 3, packs: 2, spd: 2.2, danger: 0.75, bite: 24,
    scale: 1.45, color: 0xeae6d8,
    build: function (ctx) {
      const T = ctx.THREE, m = ctx.mat;
      const g = new T.Group();
      function box(w, h, d, mm) { return new T.Mesh(CBZ.boxGeom(w, h, d), mm); }
      const coat = m(0xeae6d8), shade = m(0xd2ccbb), paw = m(0xdad4c4), black = m(0x111111);
      // long massive barrel body
      const body = box(2.2, 1.05, 1.15, coat); body.position.set(0, 1.1, 0); g.add(body);
      const rump = box(0.95, 1.1, 1.12, coat); rump.position.set(-0.95, 1.14, 0); g.add(rump);
      // low shoulder hump
      const shoulder = box(0.85, 1.1, 1.13, coat); shoulder.position.set(0.7, 1.16, 0); g.add(shoulder);
      const hump = box(0.7, 0.3, 0.95, coat); hump.position.set(0.7, 1.72, 0); g.add(hump);
      // LONG neck reaching forward + narrow elongated head
      const neck = box(0.75, 0.55, 0.62, coat); neck.position.set(1.25, 1.1, 0); g.add(neck);
      const head = box(0.55, 0.5, 0.5, coat); head.position.set(1.72, 1.02, 0); g.add(head);
      const snout = box(0.55, 0.32, 0.34, shade); snout.position.set(2.12, 0.94, 0); g.add(snout);
      const nose = box(0.16, 0.15, 0.2, black); nose.position.set(2.4, 0.96, 0); g.add(nose);
      // small round ears set back on the narrow skull
      [0.18, -0.18].forEach(function (z) {
        const ear = box(0.14, 0.16, 0.1, coat); ear.position.set(1.58, 1.36, z); g.add(ear);
      });
      // thick legs with black-padded paws
      [[0.72, 0.4], [0.72, -0.4], [-0.75, 0.4], [-0.75, -0.4]].forEach(function (o) {
        const l = box(0.34, 0.92, 0.36, coat); l.position.set(o[0], 0.46, o[1]); g.add(l);
        const p = box(0.4, 0.16, 0.5, paw); p.position.set(o[0] + 0.05, 0.08, o[1]); g.add(p);
      });
      const tail = box(0.16, 0.16, 0.16, coat); tail.position.set(-1.42, 1.05, 0); g.add(tail);
      return g;
    },
  });

  // ============================================================
  //  WHITE STAG — the legendary one. A pure-white leucistic red deer:
  //  elegant arched neck, wedge head, thin legs, and an ENORMOUS branching
  //  multi-point antler rack (always present). Faint grey shading only.
  // ============================================================
  S({
    id: "white_stag", name: "White Stag", biome: "forest", rarity: "legendary",
    hp: 60, fur: "Legendary White Stag Hide", furValue: 1500, respawn: false,
    packs: 1, spd: 3.0, danger: 0, spook: 34, scale: 1.25, color: 0xf2efe6,
    build: function (ctx) {
      const T = ctx.THREE, m = ctx.mat;
      const g = new T.Group();
      function box(w, h, d, mm) { return new T.Mesh(CBZ.boxGeom(w, h, d), mm); }
      const white = m(0xf2efe6), shade = m(0xdedbd2), antler = m(0xe6e0d2), eye = m(0x2a2a2a);
      // slender deer body
      const body = box(1.7, 0.8, 0.72, white); body.position.set(0, 1.28, 0); g.add(body);
      const under = box(1.6, 0.28, 0.64, shade); under.position.set(0, 0.98, 0); g.add(under);
      const rump = box(0.55, 0.82, 0.7, white); rump.position.set(-0.78, 1.3, 0); g.add(rump);
      // arched neck rising forward to a wedge head
      const neck = box(0.42, 0.95, 0.44, white); neck.position.set(0.9, 1.72, 0); neck.rotation.z = -0.55; g.add(neck);
      const head = box(0.5, 0.42, 0.4, white); head.position.set(1.34, 2.14, 0); g.add(head);
      const snout = box(0.34, 0.26, 0.3, shade); snout.position.set(1.64, 2.06, 0); g.add(snout);
      const nose = box(0.12, 0.1, 0.14, eye); nose.position.set(1.83, 2.04, 0); g.add(nose);
      [0.16, -0.16].forEach(function (z) {
        const ear = box(0.12, 0.24, 0.08, white); ear.position.set(1.24, 2.34, z); g.add(ear);
        const ey = box(0.06, 0.08, 0.06, eye); ey.position.set(1.5, 2.18, z * 1.2); g.add(ey);
      });
      // ENORMOUS branching multi-point antler rack (both sides)
      [-1, 1].forEach(function (s) {
        const beam = box(0.08, 0.9, 0.08, antler); beam.position.set(1.26, 2.66, s * 0.16);
        beam.rotation.z = 0.25; beam.rotation.x = s * 0.2; g.add(beam);
        const tine1 = box(0.06, 0.5, 0.06, antler); tine1.position.set(1.42, 2.9, s * 0.34);
        tine1.rotation.z = 0.7; tine1.rotation.x = s * 0.3; g.add(tine1);
        const tine2 = box(0.06, 0.44, 0.06, antler); tine2.position.set(1.12, 3.0, s * 0.32);
        tine2.rotation.z = -0.5; tine2.rotation.x = s * 0.2; g.add(tine2);
        const tine3 = box(0.06, 0.4, 0.06, antler); tine3.position.set(1.34, 3.24, s * 0.4);
        tine3.rotation.z = 0.4; tine3.rotation.x = s * 0.35; g.add(tine3);
        const tine4 = box(0.055, 0.34, 0.055, antler); tine4.position.set(0.98, 3.28, s * 0.28);
        tine4.rotation.z = -0.35; g.add(tine4);
      });
      // thin elegant legs
      [[0.6, 0.24], [0.6, -0.24], [-0.6, 0.24], [-0.6, -0.24]].forEach(function (o) {
        const l = box(0.13, 1.15, 0.13, white); l.position.set(o[0], 0.58, o[1]); g.add(l);
        const hoof = box(0.14, 0.14, 0.14, shade); hoof.position.set(o[0], 0.07, o[1]); g.add(hoof);
      });
      const tail = box(0.14, 0.3, 0.1, white); tail.position.set(-1.0, 1.4, 0); g.add(tail);
      return g;
    },
  });
})();
