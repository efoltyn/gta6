/* ============================================================
   city/wildlife/small_game.js — desert & snow small-game batch.
   Jackrabbit, Rattlesnake, Snowshoe Hare, Bighorn Sheep.
   Low-poly, blocky (RDR2 / Minecraft style). Modelled in metres,
   feet at y=0, nose toward +X. Materials only via ctx.mat, boxes
   via CBZ.boxGeom. Silhouettes/colours matched to reference photos.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const S = CBZ.defineSpecies;
  if (!S) return;

  // ============================================================
  //  JACKRABBIT (black-tailed) — sandy tan-grey, dark-peppered coat,
  //  ENORMOUS long ears with black tips, long powerful hind legs,
  //  black-tipped tail. Bigger-eared than a cottontail. Hunched.
  // ============================================================
  S({
    id: "jackrabbit", name: "Jackrabbit", biome: "desert", rarity: "common",
    hp: 8, fur: "Jackrabbit Pelt", furValue: 10, meat: "Rabbit Meat", meatValue: 5,
    herd: [1, 3], packs: 4, spd: 3.6, danger: 0, spook: 22, scale: 0.55, color: 0xbfa377,
    build: function (ctx) {
      const T = ctx.THREE, m = ctx.mat;
      const g = new T.Group();
      function box(w, h, d, mm) { return new T.Mesh(CBZ.boxGeom(w, h, d), mm); }
      const tan = m(0xbfa377), pale = m(0xd8c9a8), black = m(0x1c1712);
      // hunched compact body + pale belly
      const body = box(0.5, 0.32, 0.28, tan); body.position.set(0, 0.3, 0); g.add(body);
      const belly = box(0.46, 0.12, 0.24, pale); belly.position.set(0, 0.16, 0); g.add(belly);
      // dark stripe peppered down the back
      const stripe = box(0.42, 0.06, 0.1, black); stripe.position.set(-0.02, 0.47, 0); g.add(stripe);
      // head + tiny dark nose (nose +X)
      const head = box(0.24, 0.22, 0.2, tan); head.position.set(0.32, 0.4, 0); g.add(head);
      const nose = box(0.1, 0.09, 0.11, black); nose.position.set(0.46, 0.36, 0); g.add(nose);
      // ENORMOUS upright ears, black-tipped
      [0.06, -0.06].forEach(function (z) {
        const e = box(0.06, 0.36, 0.04, tan); e.position.set(0.3, 0.78, z); g.add(e);
        const tip = box(0.06, 0.08, 0.04, black); tip.position.set(0.3, 0.98, z); g.add(tip);
      });
      // small front legs
      [[0.18, 0.1], [0.18, -0.1]].forEach(function (o) { const l = box(0.07, 0.2, 0.07, tan); l.position.set(o[0], 0.1, o[1]); g.add(l); });
      // long powerful hind legs
      [[-0.15, 0.12], [-0.15, -0.12]].forEach(function (o) { const l = box(0.13, 0.3, 0.16, tan); l.position.set(o[0], 0.15, o[1]); g.add(l); });
      // black-tipped short tail
      const tail = box(0.12, 0.14, 0.12, black); tail.position.set(-0.28, 0.28, 0); g.add(tail);
      return g;
    },
  });

  // ============================================================
  //  RATTLESNAKE (western diamondback) — coiled low on the ground,
  //  tan/brown body with dark DIAMOND blotches, raised S-curve neck
  //  & TRIANGULAR head at the front (+X), banded segmented RATTLE.
  // ============================================================
  S({
    id: "rattlesnake", name: "Rattlesnake", biome: "desert", rarity: "uncommon",
    hp: 12, fur: "Snakeskin", furValue: 34, packs: 3, spd: 1.2, danger: 0.4, bite: 12,
    scale: 0.7, color: 0xb59367,
    build: function (ctx) {
      const T = ctx.THREE, m = ctx.mat;
      const g = new T.Group();
      function box(w, h, d, mm) { return new T.Mesh(CBZ.boxGeom(w, h, d), mm); }
      const tan = m(0xb59367), dark = m(0x6b4d31), pale = m(0xe6d6b4), black = m(0x1a1712);
      // coiled body — two concentric flat tori laid on the ground
      const outer = new T.Mesh(new T.TorusGeometry(0.42, 0.12, 6, 14), tan);
      outer.rotation.x = Math.PI / 2; outer.position.set(-0.05, 0.13, 0); g.add(outer);
      const inner = new T.Mesh(new T.TorusGeometry(0.22, 0.11, 6, 12), tan);
      inner.rotation.x = Math.PI / 2; inner.position.set(0.02, 0.2, 0.06); g.add(inner);
      // dark diamond blotches along the top of the coil
      [[0.4, 0.14, 0.25], [0.0, 0.14, 0.45], [-0.4, 0.14, 0.1], [-0.15, 0.14, -0.4], [0.3, 0.2, -0.2]].forEach(function (o) {
        const d1 = box(0.12, 0.05, 0.12, dark); d1.position.set(o[0], o[1] + 0.1, o[2]); d1.rotation.y = 0.78; g.add(d1);
      });
      // raised S-curve neck lifting toward the front
      const neck1 = box(0.14, 0.14, 0.16, tan); neck1.position.set(0.36, 0.28, 0.2); g.add(neck1);
      const neck2 = box(0.13, 0.16, 0.14, tan); neck2.position.set(0.5, 0.42, 0.1); neck2.rotation.z = 0.4; g.add(neck2);
      const neck3 = box(0.12, 0.14, 0.13, tan); neck3.position.set(0.62, 0.54, 0.02); neck3.rotation.z = 0.2; g.add(neck3);
      // TRIANGULAR head at the front (+X), cone snout
      const head = box(0.18, 0.12, 0.2, tan); head.position.set(0.76, 0.56, 0); g.add(head);
      const snout = new T.Mesh(new T.ConeGeometry(0.09, 0.18, 4), tan); snout.rotation.z = -Math.PI / 2; snout.position.set(0.9, 0.55, 0); g.add(snout);
      // segmented banded RATTLE at the tail tip, held up
      let ry = 0.32;
      for (let i = 0; i < 4; i++) {
        const seg = new T.Mesh(new T.ConeGeometry(0.06 - i * 0.008, 0.07, 4), (i % 2 === 0) ? pale : black);
        seg.position.set(-0.55, ry, -0.02); g.add(seg); ry += 0.07;
      }
      return g;
    },
  });

  // ============================================================
  //  SNOWSHOE HARE — WHITE winter coat, medium ears with dark tips,
  //  oversized furry hind FEET (the "snowshoes"), compact body.
  // ============================================================
  S({
    id: "snowshoe_hare", name: "Snowshoe Hare", biome: "snow", rarity: "common",
    hp: 8, fur: "Hare Pelt", furValue: 12, meat: "Rabbit Meat", meatValue: 5,
    herd: [1, 3], packs: 3, spd: 3.6, danger: 0, spook: 22, scale: 0.5, color: 0xf3f3f3,
    build: function (ctx) {
      const T = ctx.THREE, m = ctx.mat;
      const g = new T.Group();
      function box(w, h, d, mm) { return new T.Mesh(CBZ.boxGeom(w, h, d), mm); }
      const white = m(0xf3f3f3), shade = m(0xdcdce2), dark = m(0x2a2622), pink = m(0x2a2622);
      // compact hunched body
      const body = box(0.44, 0.34, 0.3, white); body.position.set(0, 0.32, 0); g.add(body);
      const belly = box(0.4, 0.12, 0.26, shade); belly.position.set(0, 0.18, 0); g.add(belly);
      // head + tiny nose
      const head = box(0.24, 0.22, 0.22, white); head.position.set(0.3, 0.42, 0); g.add(head);
      const nose = box(0.1, 0.09, 0.11, pink); nose.position.set(0.44, 0.38, 0); g.add(nose);
      // medium upright ears with dark tips
      [0.07, -0.07].forEach(function (z) {
        const e = box(0.07, 0.24, 0.05, white); e.position.set(0.27, 0.66, z); g.add(e);
        const tip = box(0.07, 0.06, 0.05, dark); tip.position.set(0.27, 0.8, z); g.add(tip);
      });
      // small front legs
      [[0.16, 0.1], [0.16, -0.1]].forEach(function (o) { const l = box(0.08, 0.18, 0.08, white); l.position.set(o[0], 0.09, o[1]); g.add(l); });
      // hind legs + OVERSIZED furry snowshoe feet
      [[-0.14, 0.12], [-0.14, -0.12]].forEach(function (o) {
        const l = box(0.11, 0.2, 0.12, white); l.position.set(o[0], 0.12, o[1]); g.add(l);
        const foot = box(0.26, 0.08, 0.16, white); foot.position.set(o[0] + 0.04, 0.04, o[1]); g.add(foot);
      });
      // tiny puff tail
      const tail = new T.Mesh(new T.SphereGeometry(0.1, 6, 5), white); tail.position.set(-0.24, 0.32, 0); g.add(tail);
      return g;
    },
  });

  // ============================================================
  //  BIGHORN SHEEP (ram) — sturdy brown quadruped (~1m tall), pale
  //  WHITE rump patch & muzzle, huge CURLED (spiral) horns curling
  //  back around beside the head, built from angled cone segments.
  // ============================================================
  S({
    id: "bighorn_sheep", name: "Bighorn Sheep", biome: "desert", rarity: "uncommon",
    hp: 60, fur: "Bighorn Hide", furValue: 130, meat: "Mutton", meatValue: 12,
    herd: [3, 8], packs: 2, spd: 2.6, danger: 0.2, bite: 12, scale: 0.9, color: 0x8a6f4e,
    build: function (ctx) {
      const T = ctx.THREE, m = ctx.mat, r = ctx.rng;
      const g = new T.Group();
      function box(w, h, d, mm) { return new T.Mesh(CBZ.boxGeom(w, h, d), mm); }
      const brown = m(0x8a6f4e), dark = m(0x5f4a30), white = m(0xdfd6c2), horn = m(0x9c8a6a);
      // sturdy torso
      const torso = box(1.1, 0.6, 0.5, brown); torso.position.set(0, 0.78, 0); g.add(torso);
      const chest = box(0.4, 0.5, 0.46, brown); chest.position.set(0.5, 0.74, 0); g.add(chest);
      // pale white rump patch at the rear
      const rump = box(0.18, 0.5, 0.48, white); rump.position.set(-0.56, 0.78, 0); g.add(rump);
      // neck + head, pale muzzle (nose +X)
      const neck = box(0.34, 0.4, 0.34, brown); neck.position.set(0.72, 0.98, 0); neck.rotation.z = -0.3; g.add(neck);
      const head = box(0.38, 0.32, 0.3, brown); head.position.set(0.98, 1.14, 0); g.add(head);
      const muzzle = box(0.2, 0.18, 0.24, white); muzzle.position.set(1.18, 1.06, 0); g.add(muzzle);
      // ears
      [0.18, -0.18].forEach(function (z) { const e = box(0.08, 0.14, 0.06, brown); e.position.set(0.9, 1.24, z); g.add(e); });
      // huge CURLED spiral horns beside the head (angled cone segments forming a C)
      [0.2, -0.2].forEach(function (z) {
        const base = new T.Mesh(new T.CylinderGeometry(0.09, 0.11, 0.28, 6), horn);
        base.position.set(0.84, 1.34, z); base.rotation.z = 1.1; g.add(base);
        const c1 = new T.Mesh(new T.ConeGeometry(0.09, 0.3, 6), horn);
        c1.position.set(0.68, 1.28, z); c1.rotation.z = 2.2; g.add(c1);
        const c2 = new T.Mesh(new T.ConeGeometry(0.08, 0.3, 6), horn);
        c2.position.set(0.68, 1.02, z); c2.rotation.z = 3.4; g.add(c2);
        const c3 = new T.Mesh(new T.ConeGeometry(0.07, 0.26, 6), horn);
        c3.position.set(0.92, 0.98, z); c3.rotation.z = -1.3; g.add(c3);
      });
      // four sturdy legs, dark hooves
      [[0.44, 0.2], [0.44, -0.2], [-0.44, 0.2], [-0.44, -0.2]].forEach(function (o) {
        const l = box(0.15, 0.5, 0.15, brown); l.position.set(o[0], 0.25, o[1]); g.add(l);
        const h = box(0.15, 0.1, 0.15, dark); h.position.set(o[0], 0.05, o[1]); g.add(h);
      });
      // short tail
      const tail = box(0.1, 0.16, 0.1, dark); tail.position.set(-0.6, 0.72, 0); g.add(tail);
      return g;
    },
  });
})();
