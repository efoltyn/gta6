/* ============================================================
   city/wildlife/canines.js — Canids + one compact hog.

   Low-poly builds posed from reference photos: grizzled gray wolf
   (dark saddle, pale face/underside, bushy tail), creamy arctic wolf
   (thick coat, short muzzle, small ears), slender rusty-legged coyote
   (black-tipped low tail), and a humped-shouldered wild boar with
   upward ivory tusks. Metres, feet at y=0, nose toward +X.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const S = CBZ.defineSpecies;
  if (!S) return;

  // ============================================================
  //  Gray Wolf — grizzled gray coat, darker saddle over the back &
  //  shoulders, paler cream face/muzzle/underside, erect triangular
  //  ears, sleek level body, bushy low-slung tail.
  // ============================================================
  S({
    id: "gray_wolf", name: "Gray Wolf", biome: "forest", rarity: "uncommon",
    hp: 55, fur: "Wolf Pelt", furValue: 80, meat: "Game Meat", meatValue: 10,
    scale: 0.95, herd: [2, 4], packs: 3, spd: 2.8, danger: 0.55, bite: 14,
    color: 0x7d7b78,
    build: function (ctx) {
      const T = ctx.THREE, m = ctx.mat, r = ctx.rng;
      function box(w, h, d, mm) { return new T.Mesh(CBZ.boxGeom(w, h, d), mm); }
      const g = new T.Group();
      const grey = m(0x7d7b78), saddle = m(0x565452), pale = m(0xbdb6aa), dark = m(0x36322c);
      const body = box(1.25, 0.56, 0.5, grey); body.position.set(0, 0.72, 0); g.add(body);
      const saddleTop = box(1.15, 0.2, 0.46, saddle); saddleTop.position.set(-0.05, 0.98, 0); g.add(saddleTop);
      const belly = box(1.1, 0.22, 0.44, pale); belly.position.set(0, 0.5, 0); g.add(belly);
      const neck = box(0.42, 0.44, 0.42, saddle); neck.position.set(0.62, 0.86, 0); g.add(neck);
      const head = box(0.42, 0.4, 0.4, grey); head.position.set(0.9, 0.92, 0); g.add(head);
      const cheek = box(0.3, 0.24, 0.42, pale); cheek.position.set(0.98, 0.78, 0); g.add(cheek);
      const snout = box(0.3, 0.2, 0.22, pale); snout.position.set(1.15, 0.82, 0); g.add(snout);
      const nose = box(0.1, 0.1, 0.14, dark); nose.position.set(1.32, 0.82, 0); g.add(nose);
      [-1, 1].forEach(function (s) {
        const ear = new T.Mesh(new T.ConeGeometry(0.11, 0.24, 6), grey);
        ear.position.set(0.82, 1.2, s * 0.14); g.add(ear);
      });
      [[0.42, 0.19], [0.42, -0.19], [-0.42, 0.19], [-0.42, -0.19]].forEach(function (o) {
        const l = box(0.15, 0.56, 0.15, grey); l.position.set(o[0], 0.28, o[1]); g.add(l);
        const paw = box(0.16, 0.1, 0.17, dark); paw.position.set(o[0], 0.05, o[1]); g.add(paw);
      });
      const tail = box(0.55, 0.24, 0.24, saddle); tail.position.set(-0.82, 0.6, 0); tail.rotation.z = 0.35; g.add(tail);
      const tailTip = box(0.16, 0.18, 0.18, dark); tailTip.position.set(-1.06, 0.44, 0); g.add(tailTip);
      g.rotation.y = (r() - 0.5) * 0.1;
      return g;
    },
  });

  // ============================================================
  //  Arctic Wolf — pure creamy-white throughout, thick fluffy double
  //  coat (bulkier body & tail), short muzzle, small rounded ears.
  //  Ranges the ice.
  // ============================================================
  S({
    id: "arctic_wolf", name: "Arctic Wolf", biome: "snow", rarity: "uncommon",
    hp: 60, fur: "Arctic Wolf Pelt", furValue: 130, meat: "Game Meat", meatValue: 10,
    scale: 1.0, herd: [2, 4], packs: 2, spd: 2.8, danger: 0.55, bite: 14,
    color: 0xf0f0ee,
    build: function (ctx) {
      const T = ctx.THREE, m = ctx.mat, r = ctx.rng;
      function box(w, h, d, mm) { return new T.Mesh(CBZ.boxGeom(w, h, d), mm); }
      const g = new T.Group();
      const white = m(0xf0f0ee), shade = m(0xdad8d2), noseC = m(0x3a3a3a);
      const body = box(1.3, 0.68, 0.62, white); body.position.set(0, 0.78, 0); g.add(body);
      const ruff = box(0.55, 0.62, 0.62, white); ruff.position.set(0.5, 0.82, 0); g.add(ruff);
      const back = box(1.2, 0.2, 0.58, shade); back.position.set(-0.05, 1.06, 0); g.add(back);
      const neck = box(0.46, 0.46, 0.5, white); neck.position.set(0.66, 0.92, 0); g.add(neck);
      const head = box(0.44, 0.42, 0.44, white); head.position.set(0.92, 0.98, 0); g.add(head);
      const snout = box(0.24, 0.2, 0.24, white); snout.position.set(1.12, 0.9, 0); g.add(snout);
      const nose = box(0.1, 0.1, 0.14, noseC); nose.position.set(1.26, 0.9, 0); g.add(nose);
      [-1, 1].forEach(function (s) {
        const ear = new T.Mesh(new T.ConeGeometry(0.1, 0.18, 6), white);
        ear.position.set(0.86, 1.24, s * 0.15); g.add(ear);
      });
      [[0.44, 0.21], [0.44, -0.21], [-0.44, 0.21], [-0.44, -0.21]].forEach(function (o) {
        const l = box(0.18, 0.6, 0.18, white); l.position.set(o[0], 0.3, o[1]); g.add(l);
      });
      const tail = box(0.6, 0.32, 0.32, white); tail.position.set(-0.84, 0.66, 0); tail.rotation.z = 0.25; g.add(tail);
      g.rotation.y = (r() - 0.5) * 0.1;
      return g;
    },
  });

  // ============================================================
  //  Coyote — slender build, tan-grey coat with rusty-red legs, ears
  //  & face, narrow pointed muzzle, large erect ears, bushy tail with
  //  black tip carried low behind the hocks.
  // ============================================================
  S({
    id: "coyote", name: "Coyote", biome: "desert", rarity: "common",
    hp: 30, fur: "Coyote Pelt", furValue: 35, meat: "Game Meat", meatValue: 10,
    scale: 0.78, herd: [1, 2], packs: 3, spd: 3.0, danger: 0.3, bite: 10, spook: 24,
    color: 0xa98c63,
    build: function (ctx) {
      const T = ctx.THREE, m = ctx.mat, r = ctx.rng;
      function box(w, h, d, mm) { return new T.Mesh(CBZ.boxGeom(w, h, d), mm); }
      const g = new T.Group();
      const tan = m(0xa98c63), rust = m(0xa9662f), pale = m(0xcbb894), tip = m(0x2a241e);
      const body = box(1.15, 0.44, 0.4, tan); body.position.set(0, 0.66, 0); g.add(body);
      const belly = box(1.0, 0.16, 0.36, pale); belly.position.set(0, 0.48, 0); g.add(belly);
      const neck = box(0.34, 0.36, 0.34, tan); neck.position.set(0.6, 0.78, 0); g.add(neck);
      const head = box(0.34, 0.32, 0.34, tan); head.position.set(0.86, 0.82, 0); g.add(head);
      const snout = box(0.32, 0.16, 0.16, tan); snout.position.set(1.12, 0.76, 0); g.add(snout);
      const nose = box(0.08, 0.08, 0.1, tip); nose.position.set(1.3, 0.76, 0); g.add(nose);
      [-1, 1].forEach(function (s) {
        const ear = new T.Mesh(new T.ConeGeometry(0.09, 0.26, 6), rust);
        ear.position.set(0.78, 1.12, s * 0.13); g.add(ear);
      });
      [[0.4, 0.15], [0.4, -0.15], [-0.4, 0.15], [-0.4, -0.15]].forEach(function (o) {
        const l = box(0.12, 0.5, 0.12, rust); l.position.set(o[0], 0.25, o[1]); g.add(l);
      });
      const tail = box(0.5, 0.2, 0.2, tan); tail.position.set(-0.72, 0.44, 0); tail.rotation.z = -0.35; g.add(tail);
      const tailTip = box(0.16, 0.18, 0.18, tip); tailTip.position.set(-0.96, 0.28, 0); g.add(tailTip);
      g.rotation.y = (r() - 0.5) * 0.12;
      return g;
    },
  });

  // ============================================================
  //  Wild Boar — compact bristly hog, dark brown-black coat, muscular
  //  HUMPED shoulders rising above a low-carried wedge head, long flat
  //  rooting snout, small upward-curving ivory TUSKS, short stout legs,
  //  small tufted tail. Not a canine — built as a hog.
  // ============================================================
  S({
    id: "wild_boar", name: "Wild Boar", biome: "forest", rarity: "uncommon",
    hp: 65, fur: "Boar Hide", furValue: 55, meat: "Pork", meatValue: 14, meatYield: 2,
    scale: 0.9, herd: [2, 4], packs: 2, spd: 2.6, danger: 0.5, bite: 14,
    color: 0x3a2c22,
    build: function (ctx) {
      const T = ctx.THREE, m = ctx.mat, r = ctx.rng;
      function box(w, h, d, mm) { return new T.Mesh(CBZ.boxGeom(w, h, d), mm); }
      const g = new T.Group();
      const dark = m(0x3a2c22), hump = m(0x2a1f18), snoutC = m(0x4a382c), ivory = m(0xe6ddc4), hoof = m(0x1a140f);
      const body = box(1.2, 0.62, 0.56, dark); body.position.set(0, 0.62, 0); g.add(body);
      // muscular humped shoulders rising above the back
      const shoulder = box(0.55, 0.5, 0.58, hump); shoulder.position.set(0.42, 0.86, 0); g.add(shoulder);
      const crest = box(0.85, 0.16, 0.2, hump); crest.position.set(0.15, 1.06, 0); g.add(crest); // bristly mane ridge
      // low-carried wedge head
      const head = box(0.42, 0.42, 0.42, dark); head.position.set(0.78, 0.62, 0); g.add(head);
      const snout = box(0.46, 0.22, 0.26, snoutC); snout.position.set(1.12, 0.52, 0); g.add(snout);
      const nose = box(0.1, 0.14, 0.24, hoof); nose.position.set(1.34, 0.52, 0); g.add(nose);
      // small upward-curving tusks
      [-1, 1].forEach(function (s) {
        const tusk = new T.Mesh(new T.ConeGeometry(0.05, 0.22, 6), ivory);
        tusk.position.set(1.18, 0.5, s * 0.13); tusk.rotation.z = 0.9; tusk.rotation.x = s * -0.2; g.add(tusk);
      });
      [-1, 1].forEach(function (s) {
        const ear = new T.Mesh(new T.ConeGeometry(0.08, 0.2, 6), dark);
        ear.position.set(0.66, 0.86, s * 0.16); ear.rotation.z = -0.3; g.add(ear);
      });
      // short stout legs
      [[0.4, 0.19], [0.4, -0.19], [-0.42, 0.19], [-0.42, -0.19]].forEach(function (o) {
        const l = box(0.15, 0.34, 0.15, hump); l.position.set(o[0], 0.17, o[1]); g.add(l);
        const foot = box(0.16, 0.08, 0.16, hoof); foot.position.set(o[0], 0.04, o[1]); g.add(foot);
      });
      const tail = box(0.24, 0.1, 0.1, dark); tail.position.set(-0.72, 0.66, 0); tail.rotation.z = 0.5; g.add(tail);
      g.rotation.y = (r() - 0.5) * 0.1;
      return g;
    },
  });
})();
