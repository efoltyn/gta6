/* ============================================================
   city/wildlife/forest_deer.js — forest cervids & critters batch.
   Elk, Red Fox, Raccoon, Cottontail Rabbit. Low-poly, blocky
   (RDR2 / Minecraft style). Modelled in metres, feet at y=0,
   nose toward +X. Materials only via ctx.mat, boxes via CBZ.boxGeom.
   Silhouettes/colours matched to reference photos of each animal.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const S = CBZ.defineSpecies;
  if (!S) return;

  // ============================================================
  //  ELK — big cervid: reddish-tan body, dark shaggy neck mane,
  //  buff/cream rump patch, huge sweeping antlers on the bulls.
  // ============================================================
  S({
    id: "elk", name: "Elk", biome: "forest", rarity: "uncommon",
    hp: 75, fur: "Elk Pelt", furValue: 95, meat: "Elk Meat", meatValue: 16, meatYield: 2,
    scale: 1.15, herd: [4, 9], packs: 3, spd: 2.4, danger: 0, spook: 30, color: 0x6b4a2c,
    build: function (ctx) {
      const T = ctx.THREE, m = ctx.mat, r = ctx.rng;
      const tan = m(0x8a5f34), body2 = m(0x6b4a2c), mane = m(0x3a2716), rump = m(0xd8c79a), dark = m(0x2c1c10);
      const g = new T.Group();
      function box(w, h, d, mm) { return new T.Mesh(CBZ.boxGeom(w, h, d), mm); }
      // torso + belly
      const torso = box(1.9, 0.95, 0.82, tan); torso.position.set(0, 1.55, 0); g.add(torso);
      const under = box(1.8, 0.32, 0.72, body2); under.position.set(0, 1.14, 0); g.add(under);
      // pale rump patch at the rear
      const patch = box(0.24, 0.7, 0.7, rump); patch.position.set(-0.95, 1.6, 0); g.add(patch);
      // dark shaggy neck + mane rising to the head
      const neck = box(0.5, 1.05, 0.5, mane); neck.position.set(0.95, 2.05, 0); neck.rotation.z = -0.45; g.add(neck);
      const throat = box(0.34, 0.75, 0.42, mane); throat.position.set(1.02, 1.7, 0); g.add(throat);
      // head + muzzle
      const head = box(0.62, 0.46, 0.44, tan); head.position.set(1.42, 2.5, 0); g.add(head);
      const snout = box(0.36, 0.3, 0.3, dark); snout.position.set(1.74, 2.42, 0); g.add(snout);
      // ears
      [0.18, -0.18].forEach(function (z) { const e = box(0.12, 0.28, 0.08, tan); e.position.set(1.28, 2.76, z); g.add(e); });
      // legs
      [[0.7, 0.28], [0.7, -0.28], [-0.72, 0.28], [-0.72, -0.28]].forEach(function (o) {
        const l = box(0.18, 1.12, 0.18, body2); l.position.set(o[0], 0.56, o[1]); g.add(l);
      });
      // big sweeping 6-point antlers (bulls only)
      if (r() < 0.55) {
        [-1, 1].forEach(function (s) {
          const beam = box(0.08, 0.95, 0.08, dark); beam.position.set(1.28, 3.0, s * 0.16); beam.rotation.z = 0.55; g.add(beam);
          const t1 = box(0.06, 0.4, 0.06, dark); t1.position.set(1.55, 3.15, s * 0.22); t1.rotation.z = 0.3; g.add(t1);
          const t2 = box(0.06, 0.4, 0.06, dark); t2.position.set(1.2, 3.45, s * 0.24); t2.rotation.z = -0.15; g.add(t2);
          const t3 = box(0.06, 0.34, 0.06, dark); t3.position.set(0.95, 3.35, s * 0.26); t3.rotation.z = -0.5; g.add(t3);
        });
      }
      const tail = box(0.16, 0.3, 0.12, rump); tail.position.set(-1.02, 1.5, 0); g.add(tail);
      return g;
    },
  });

  // ============================================================
  //  RED FOX — rusty-orange, white chest/throat & tail tip,
  //  black lower legs, big pointed ears, long bushy tail.
  // ============================================================
  S({
    id: "red_fox", name: "Red Fox", biome: "forest", rarity: "common",
    hp: 16, fur: "Fox Pelt", furValue: 42, packs: 4, spd: 3.0, danger: 0, spook: 26,
    scale: 0.8, color: 0xc0552a,
    build: function (ctx) {
      const T = ctx.THREE, m = ctx.mat, r = ctx.rng;
      const rust = m(0xc0552a), deep = m(0xa8431f), white = m(0xe8e3d8), black = m(0x1c1712);
      const g = new T.Group();
      function box(w, h, d, mm) { return new T.Mesh(CBZ.boxGeom(w, h, d), mm); }
      // low-slung body + white belly/chest
      const body = box(0.92, 0.34, 0.32, rust); body.position.set(0, 0.56, 0); g.add(body);
      const belly = box(0.86, 0.14, 0.28, white); belly.position.set(0, 0.4, 0); g.add(belly);
      const chest = box(0.16, 0.34, 0.3, white); chest.position.set(0.46, 0.54, 0); g.add(chest);
      // neck + wedge head + pointed snout
      const neck = box(0.28, 0.3, 0.28, rust); neck.position.set(0.5, 0.66, 0); g.add(neck);
      const head = box(0.32, 0.28, 0.3, rust); head.position.set(0.66, 0.82, 0); g.add(head);
      const snout = box(0.26, 0.14, 0.14, black); snout.position.set(0.9, 0.76, 0); g.add(snout);
      const cheek = box(0.12, 0.18, 0.16, white); cheek.position.set(0.74, 0.72, 0); g.add(cheek);
      // big pointed ears
      [0.11, -0.11].forEach(function (z) {
        const e = new T.Mesh(new T.ConeGeometry(0.09, 0.24, 4), rust); e.position.set(0.6, 1.06, z); g.add(e);
      });
      // legs — rust upper, black feet
      [[0.34, 0.13], [0.34, -0.13], [-0.34, 0.13], [-0.34, -0.13]].forEach(function (o) {
        const l = box(0.1, 0.38, 0.1, rust); l.position.set(o[0], 0.31, o[1]); g.add(l);
        const f = box(0.1, 0.16, 0.1, black); f.position.set(o[0], 0.08, o[1]); g.add(f);
      });
      // long bushy tail sweeping down-back, white tip
      const tail = box(0.7, 0.24, 0.24, deep); tail.position.set(-0.62, 0.5, 0); tail.rotation.z = 0.35; g.add(tail);
      const tip = box(0.18, 0.2, 0.2, white); tip.position.set(-0.96, 0.34, 0); g.add(tip);
      return g;
    },
  });

  // ============================================================
  //  RACCOON — grey body, black eye-mask on a pale face, small
  //  rounded ears, ringed (grey/black banded) bushy tail. Hunched.
  // ============================================================
  S({
    id: "raccoon", name: "Raccoon", biome: "forest", rarity: "common",
    hp: 14, fur: "Raccoon Pelt", furValue: 20, packs: 4, spd: 2.2, danger: 0, spook: 20,
    scale: 0.55, color: 0x6d6a63,
    build: function (ctx) {
      const T = ctx.THREE, m = ctx.mat, r = ctx.rng;
      const grey = m(0x6d6a63), dark = m(0x39362f), pale = m(0xc8c2b4), black = m(0x1a1712);
      const g = new T.Group();
      function box(w, h, d, mm) { return new T.Mesh(CBZ.boxGeom(w, h, d), mm); }
      // hunched rounded body
      const body = box(0.62, 0.42, 0.4, grey); body.position.set(0, 0.5, 0); g.add(body);
      const hump = box(0.4, 0.2, 0.4, grey); hump.position.set(-0.14, 0.68, 0); g.add(hump);
      // short neck + head, pale face
      const head = box(0.34, 0.3, 0.32, pale); head.position.set(0.42, 0.52, 0); g.add(head);
      // black eye-mask across the face
      const mask = box(0.14, 0.12, 0.34, black); mask.position.set(0.5, 0.56, 0); g.add(mask);
      const snout = box(0.16, 0.12, 0.16, dark); snout.position.set(0.62, 0.46, 0); g.add(snout);
      // small rounded ears
      [0.12, -0.12].forEach(function (z) { const e = box(0.1, 0.1, 0.06, grey); e.position.set(0.36, 0.72, z); g.add(e); });
      // short legs
      [[0.22, 0.15], [0.22, -0.15], [-0.22, 0.15], [-0.22, -0.15]].forEach(function (o) {
        const l = box(0.11, 0.3, 0.11, dark); l.position.set(o[0], 0.15, o[1]); g.add(l);
      });
      // ringed tail — alternating grey/black bands, angled up-back
      let x = -0.38, y = 0.5;
      for (let i = 0; i < 5; i++) {
        const seg = box(0.16, 0.16, 0.16, (i % 2 === 0) ? dark : grey);
        seg.position.set(x, y, 0); g.add(seg);
        x -= 0.13; y += 0.05;
      }
      return g;
    },
  });

  // ============================================================
  //  COTTONTAIL RABBIT — small brown-grey, tall ears, tiny white
  //  puff tail, hunched with big hind legs.
  // ============================================================
  S({
    id: "cottontail_rabbit", name: "Cottontail Rabbit", biome: "forest", rarity: "common",
    hp: 8, fur: "Rabbit Pelt", furValue: 9, meat: "Rabbit Meat", meatValue: 5,
    herd: [2, 3], packs: 4, spd: 3.4, danger: 0, spook: 22, scale: 0.5, color: 0x8a7350,
    build: function (ctx) {
      const T = ctx.THREE, m = ctx.mat, r = ctx.rng;
      const fur = m(0x8a7350), pale = m(0xbcae92), white = m(0xeee9dc), dark = m(0x4a3c28);
      const g = new T.Group();
      function box(w, h, d, mm) { return new T.Mesh(CBZ.boxGeom(w, h, d), mm); }
      // hunched compact body
      const body = box(0.42, 0.34, 0.3, fur); body.position.set(0, 0.34, 0); g.add(body);
      const belly = box(0.4, 0.12, 0.26, pale); belly.position.set(0, 0.2, 0); g.add(belly);
      // head + tiny snout
      const head = box(0.24, 0.24, 0.24, fur); head.position.set(0.3, 0.42, 0); g.add(head);
      const snout = box(0.1, 0.1, 0.12, dark); snout.position.set(0.44, 0.38, 0); g.add(snout);
      // tall upright ears
      [0.07, -0.07].forEach(function (z) { const e = box(0.08, 0.32, 0.05, fur); e.position.set(0.26, 0.72, z); g.add(e); });
      // legs — small front, chunky hind
      [[0.16, 0.11], [0.16, -0.11]].forEach(function (o) { const l = box(0.08, 0.2, 0.08, fur); l.position.set(o[0], 0.1, o[1]); g.add(l); });
      [[-0.14, 0.12], [-0.14, -0.12]].forEach(function (o) { const l = box(0.12, 0.24, 0.14, fur); l.position.set(o[0], 0.12, o[1]); g.add(l); });
      // tiny white puff tail
      const tail = new T.Mesh(new T.SphereGeometry(0.1, 6, 5), white); tail.position.set(-0.24, 0.34, 0); g.add(tail);
      return g;
    },
  });
})();
