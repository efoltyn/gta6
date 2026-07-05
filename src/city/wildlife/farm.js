/* ============================================================
   city/wildlife/farm.js — farmland livestock batch.
   Cow (Holstein), Pig, Sheep, Goat, Horse (mustang), Chicken.
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
  //  COW — Holstein Friesian. Reference: white body with irregular
  //  hard-edged BLACK PATCHES (piebald), pink udder underneath, small
  //  pale horns, big square muzzle, ears out to the sides, tufted tail.
  // ============================================================
  S({
    id: "cow", name: "Cow", biome: "farmland", rarity: "common",
    hp: 80, fur: "Cowhide", furValue: 40, meat: "Beef", meatValue: 18, meatYield: 3,
    scale: 1.1, herd: [4, 9], packs: 3, spd: 1.6, danger: 0, spook: 18, color: 0xffffff,
    build: function (ctx) {
      const T = ctx.THREE, m = ctx.mat, r = ctx.rng;
      const white = m(0xffffff), black = m(0x1c1c1a), pink = m(0xe8a0a0), horn = m(0xd8cba0), dark = m(0x2a241c);
      const g = new T.Group();
      function box(w, h, d, mm) { return new T.Mesh(CBZ.boxGeom(w, h, d), mm); }
      // barrel body
      const body = box(1.7, 0.9, 0.82, white); body.position.set(0, 1.05, 0); g.add(body);
      const rump = box(0.5, 0.86, 0.8, white); rump.position.set(-0.82, 1.05, 0); g.add(rump);
      // irregular black piebald patches — randomized count & placement via rng
      const spots = [[0.4, 1.25, 0.42], [-0.3, 1.2, -0.42], [-0.65, 1.1, 0.3], [0.15, 0.85, 0.44], [0.6, 1.05, -0.44]];
      spots.forEach(function (s) {
        if (r() < 0.6) {
          const pw = 0.3 + r() * 0.35, ph = 0.25 + r() * 0.3;
          const p = box(pw, ph, 0.04, black); p.position.set(s[0], s[1], s[2]); g.add(p);
        }
      });
      // pink udder slung underneath the rear belly
      const udder = box(0.34, 0.24, 0.34, pink); udder.position.set(-0.4, 0.62, 0); g.add(udder);
      [[-0.32, 0.1], [-0.32, -0.1], [-0.48, 0.1], [-0.48, -0.1]].forEach(function (o) {
        const t = box(0.06, 0.1, 0.06, pink); t.position.set(o[0], 0.5, o[1]); g.add(t);
      });
      // neck + head + big square muzzle
      const neck = box(0.42, 0.5, 0.5, white); neck.position.set(0.9, 1.1, 0); g.add(neck);
      const head = box(0.5, 0.5, 0.5, white); head.position.set(1.28, 1.15, 0); g.add(head);
      const muzzle = box(0.34, 0.34, 0.42, pink); muzzle.position.set(1.6, 1.02, 0); g.add(muzzle);
      // ears sticking out to the sides
      [0.32, -0.32].forEach(function (z) { const e = box(0.12, 0.14, 0.22, white); e.position.set(1.24, 1.2, z); g.add(e); });
      // small pale horns
      [0.14, -0.14].forEach(function (z) {
        const hn = new T.Mesh(new T.ConeGeometry(0.06, 0.2, 6), horn); hn.position.set(1.18, 1.48, z); g.add(hn);
      });
      // four sturdy legs
      [[0.6, 0.3], [0.6, -0.3], [-0.7, 0.3], [-0.7, -0.3]].forEach(function (o) {
        const l = box(0.2, 0.62, 0.2, white); l.position.set(o[0], 0.31, o[1]); g.add(l);
        const hoof = box(0.22, 0.14, 0.22, dark); hoof.position.set(o[0], 0.07, o[1]); g.add(hoof);
      });
      // tufted tail
      const tail = box(0.1, 0.5, 0.1, white); tail.position.set(-1.05, 0.9, 0); tail.rotation.z = 0.3; g.add(tail);
      const tuft = box(0.12, 0.16, 0.12, black); tuft.position.set(-1.16, 0.55, 0); g.add(tuft);
      return g;
    },
  });

  // ============================================================
  //  PIG — domestic pink hog. Reference: plump rounded pink body low
  //  to the ground, flat SNOUT disc, floppy triangular ears, short
  //  legs, little curly tail.
  // ============================================================
  S({
    id: "pig", name: "Pig", biome: "farmland", rarity: "common",
    hp: 45, fur: "Pigskin", furValue: 22, meat: "Pork", meatValue: 14, meatYield: 2,
    herd: [2, 4], packs: 3, spd: 1.8, danger: 0, scale: 0.8, color: 0xe7a6a0,
    build: function (ctx) {
      const T = ctx.THREE, m = ctx.mat, r = ctx.rng;
      const pink = m(0xe7a6a0), snoutC = m(0xd98d88), dark = m(0x3a2a28);
      const g = new T.Group();
      function box(w, h, d, mm) { return new T.Mesh(CBZ.boxGeom(w, h, d), mm); }
      // plump rounded barrel body, low-slung
      const body = box(1.2, 0.72, 0.78, pink); body.position.set(0, 0.62, 0); g.add(body);
      const belly = box(1.1, 0.34, 0.82, pink); belly.position.set(0, 0.4, 0); g.add(belly);
      const rump = box(0.44, 0.68, 0.74, pink); rump.position.set(-0.6, 0.64, 0); g.add(rump);
      // short thick neck blending into a blocky head
      const head = box(0.5, 0.5, 0.52, pink); head.position.set(0.72, 0.6, 0); g.add(head);
      // flat snout disc at the front
      const snout = box(0.14, 0.28, 0.32, snoutC); snout.position.set(1.02, 0.52, 0); g.add(snout);
      const nostril = box(0.04, 0.2, 0.24, dark); nostril.position.set(1.09, 0.52, 0); g.add(nostril);
      // floppy triangular ears flopping forward
      [0.18, -0.18].forEach(function (z) {
        const e = new T.Mesh(new T.ConeGeometry(0.12, 0.24, 4), pink);
        e.position.set(0.66, 0.86, z); e.rotation.z = 0.6; g.add(e);
      });
      // short stubby legs
      [[0.42, 0.26], [0.42, -0.26], [-0.42, 0.26], [-0.42, -0.26]].forEach(function (o) {
        const l = box(0.16, 0.3, 0.16, pink); l.position.set(o[0], 0.15, o[1]); g.add(l);
        const hoof = box(0.16, 0.08, 0.16, dark); hoof.position.set(o[0], 0.04, o[1]); g.add(hoof);
      });
      // little curly tail (small stacked boxes)
      const t1 = box(0.1, 0.12, 0.1, pink); t1.position.set(-0.82, 0.72, 0); g.add(t1);
      const t2 = box(0.1, 0.1, 0.1, pink); t2.position.set(-0.9, 0.66, 0.06); g.add(t2);
      return g;
    },
  });

  // ============================================================
  //  SHEEP — domestic wool sheep (Valais-style dark face). Reference:
  //  fat FLUFFY cream WOOL body (tall & rounded), small dark face,
  //  dark thin legs, tiny ears.
  // ============================================================
  S({
    id: "sheep", name: "Sheep", biome: "farmland", rarity: "common",
    hp: 35, fur: "Wool", furValue: 30, meat: "Mutton", meatValue: 12,
    herd: [8, 16], packs: 3, spd: 1.8, danger: 0, spook: 20, scale: 0.8, color: 0xf0ece2,
    build: function (ctx) {
      const T = ctx.THREE, m = ctx.mat, r = ctx.rng;
      const wool = m(0xf0ece2), wool2 = m(0xe4dfd2), face = m(0x2c2822), leg = m(0x35302a);
      const g = new T.Group();
      function box(w, h, d, mm) { return new T.Mesh(CBZ.boxGeom(w, h, d), mm); }
      // fat fluffy rounded wool body — big and tall
      const body = box(1.2, 1.0, 0.92, wool); body.position.set(0, 0.95, 0); g.add(body);
      const back = box(1.05, 0.4, 0.94, wool2); back.position.set(-0.05, 1.35, 0); g.add(back);
      const rump = box(0.4, 0.9, 0.86, wool); rump.position.set(-0.6, 0.95, 0); g.add(rump);
      // small dark face on a short woolly neck
      const neckWool = box(0.42, 0.5, 0.48, wool); neckWool.position.set(0.62, 1.0, 0); g.add(neckWool);
      const head = box(0.3, 0.42, 0.34, face); head.position.set(0.86, 0.92, 0); g.add(head);
      const nose = box(0.14, 0.16, 0.2, face); nose.position.set(1.02, 0.82, 0); g.add(nose);
      // tiny ears drooping to the sides
      [0.2, -0.2].forEach(function (z) { const e = box(0.08, 0.08, 0.16, face); e.position.set(0.8, 1.02, z); g.add(e); });
      // thin dark legs
      [[0.4, 0.28], [0.4, -0.28], [-0.44, 0.28], [-0.44, -0.28]].forEach(function (o) {
        const l = box(0.1, 0.5, 0.1, leg); l.position.set(o[0], 0.25, o[1]); g.add(l);
      });
      // stubby wool tail
      const tail = box(0.14, 0.2, 0.14, wool); tail.position.set(-0.82, 0.9, 0); g.add(tail);
      return g;
    },
  });

  // ============================================================
  //  GOAT — domestic goat. Reference: white/tan body, backward-curving
  //  HORNS (cones), a chin BEARD, narrow face, short upright tail.
  // ============================================================
  S({
    id: "goat", name: "Goat", biome: "farmland", rarity: "common",
    hp: 35, fur: "Goat Hide", furValue: 26, meat: "Mutton", meatValue: 12,
    herd: [4, 8], packs: 2, spd: 2.2, danger: 0.1, scale: 0.75, color: 0xd8cdbb,
    build: function (ctx) {
      const T = ctx.THREE, m = ctx.mat, r = ctx.rng;
      // white or tan coat, chosen per-animal
      const tan = (r() < 0.5) ? 0xe8e2d4 : 0xcbb894;
      const coat = m(tan), dark = m(0x4a3f30), horn = m(0x6b5c46), beardC = m(0xbcae94);
      const g = new T.Group();
      function box(w, h, d, mm) { return new T.Mesh(CBZ.boxGeom(w, h, d), mm); }
      // compact body
      const body = box(1.1, 0.6, 0.56, coat); body.position.set(0, 0.82, 0); g.add(body);
      const rump = box(0.36, 0.58, 0.54, coat); rump.position.set(-0.56, 0.82, 0); g.add(rump);
      // neck rising to a narrow face
      const neck = box(0.32, 0.44, 0.34, coat); neck.position.set(0.6, 0.98, 0); neck.rotation.z = -0.3; g.add(neck);
      const head = box(0.3, 0.34, 0.3, coat); head.position.set(0.84, 1.12, 0); g.add(head);
      const muzzle = box(0.24, 0.2, 0.22, coat); muzzle.position.set(1.04, 1.02, 0); g.add(muzzle);
      const nose = box(0.08, 0.1, 0.16, dark); nose.position.set(1.18, 1.0, 0); g.add(nose);
      // ears out to the sides
      [0.18, -0.18].forEach(function (z) { const e = box(0.08, 0.1, 0.2, coat); e.position.set(0.78, 1.16, z); g.add(e); });
      // backward-curving horns (cones angled back)
      [0.09, -0.09].forEach(function (z) {
        const hn = new T.Mesh(new T.ConeGeometry(0.05, 0.34, 6), horn);
        hn.position.set(0.74, 1.4, z); hn.rotation.z = 1.5; g.add(hn);
      });
      // chin beard hanging under the jaw
      const beard = box(0.1, 0.2, 0.1, beardC); beard.position.set(0.98, 0.86, 0); g.add(beard);
      // thin legs
      [[0.42, 0.2], [0.42, -0.2], [-0.44, 0.2], [-0.44, -0.2]].forEach(function (o) {
        const l = box(0.1, 0.52, 0.1, coat); l.position.set(o[0], 0.26, o[1]); g.add(l);
        const hoof = box(0.11, 0.08, 0.11, dark); hoof.position.set(o[0], 0.04, o[1]); g.add(hoof);
      });
      // short tail flicked up
      const tail = box(0.1, 0.16, 0.1, coat); tail.position.set(-0.74, 0.98, 0); tail.rotation.z = 0.7; g.add(tail);
      return g;
    },
  });

  // ============================================================
  //  HORSE — wild mustang. Reference: bay/brown sleek body, long neck,
  //  long head/muzzle, black upright/flowing MANE along the neck, long
  //  black TAIL, tall legs, dark hooves.
  // ============================================================
  S({
    id: "horse", name: "Horse", biome: "farmland", rarity: "uncommon",
    hp: 120, fur: "Horsehide", furValue: 90, herd: [4, 9], packs: 2,
    spd: 3.4, danger: 0, spook: 24, scale: 1.1, color: 0x6e4326,
    build: function (ctx) {
      const T = ctx.THREE, m = ctx.mat, r = ctx.rng;
      const bay = m(0x6e4326), bay2 = m(0x5c3720), black = m(0x1a130c);
      const g = new T.Group();
      function box(w, h, d, mm) { return new T.Mesh(CBZ.boxGeom(w, h, d), mm); }
      // sleek deep body
      const body = box(1.8, 0.85, 0.72, bay); body.position.set(0, 1.55, 0); g.add(body);
      const under = box(1.7, 0.28, 0.66, bay2); under.position.set(0, 1.18, 0); g.add(under);
      const chest = box(0.5, 0.8, 0.7, bay); chest.position.set(0.82, 1.5, 0); g.add(chest);
      const rump = box(0.5, 0.82, 0.7, bay); rump.position.set(-0.82, 1.55, 0); g.add(rump);
      // long neck sloping up to a long head
      const neck = box(0.42, 0.95, 0.5, bay); neck.position.set(1.12, 1.95, 0); neck.rotation.z = -0.55; g.add(neck);
      const head = box(0.38, 0.42, 0.36, bay); head.position.set(1.5, 2.35, 0); g.add(head);
      const muzzle = box(0.42, 0.3, 0.3, bay2); muzzle.position.set(1.82, 2.22, 0); g.add(muzzle);
      const nose = box(0.1, 0.14, 0.24, black); nose.position.set(2.02, 2.16, 0); g.add(nose);
      // ears
      [0.13, -0.13].forEach(function (z) {
        const e = new T.Mesh(new T.ConeGeometry(0.06, 0.18, 4), bay); e.position.set(1.42, 2.62, z); g.add(e);
      });
      // black mane running along the crest of the neck
      let mx = 1.02, my = 2.42;
      for (let i = 0; i < 5; i++) {
        const seg = box(0.16, 0.26, 0.14, black); seg.position.set(mx, my, 0); seg.rotation.z = -0.55; g.add(seg);
        mx += 0.11; my -= 0.13;
      }
      const forelock = box(0.12, 0.18, 0.1, black); forelock.position.set(1.44, 2.62, 0); g.add(forelock);
      // tall legs with dark hooves
      [[0.68, 0.26], [0.68, -0.26], [-0.72, 0.26], [-0.72, -0.26]].forEach(function (o) {
        const l = box(0.16, 1.2, 0.16, bay); l.position.set(o[0], 0.6, o[1]); g.add(l);
        const hoof = box(0.18, 0.14, 0.18, black); hoof.position.set(o[0], 0.07, o[1]); g.add(hoof);
      });
      // long flowing black tail
      const tail = box(0.18, 0.9, 0.18, black); tail.position.set(-1.02, 1.25, 0); tail.rotation.z = 0.35; g.add(tail);
      return g;
    },
  });

  // ============================================================
  //  CHICKEN — domestic hen. Reference: small plump white/brown body,
  //  red COMB + red wattle, orange/yellow BEAK & legs, little wing
  //  boxes, tail feathers up. Two legs only.
  // ============================================================
  S({
    id: "chicken", name: "Chicken", biome: "farmland", rarity: "common",
    hp: 6, fur: "Feathers", furValue: 6, meat: "Chicken", meatValue: 6,
    herd: [4, 9], packs: 3, spd: 1.6, danger: 0, scale: 0.35, color: 0xf2f2f2,
    build: function (ctx) {
      const T = ctx.THREE, m = ctx.mat, r = ctx.rng;
      // white or light-brown plumage per-bird
      const plume = (r() < 0.5) ? 0xf2f2f2 : 0xc98f56;
      const feather = m(plume), red = m(0xcf2b22), beakC = m(0xe89a30), leg = m(0xe0a030);
      const g = new T.Group();
      function box(w, h, d, mm) { return new T.Mesh(CBZ.boxGeom(w, h, d), mm); }
      // plump rounded body
      const body = box(0.5, 0.46, 0.4, feather); body.position.set(0, 0.42, 0); g.add(body);
      // head on a short neck
      const head = box(0.26, 0.28, 0.24, feather); head.position.set(0.32, 0.66, 0); g.add(head);
      // red comb on top + wattle under the beak
      const comb = box(0.16, 0.1, 0.06, red); comb.position.set(0.32, 0.84, 0); g.add(comb);
      const wattle = box(0.06, 0.12, 0.06, red); wattle.position.set(0.44, 0.54, 0); g.add(wattle);
      // orange beak (small cone) pointing forward
      const beak = new T.Mesh(new T.ConeGeometry(0.06, 0.16, 4), beakC);
      beak.position.set(0.48, 0.66, 0); beak.rotation.z = -Math.PI / 2; g.add(beak);
      // little wing boxes on the sides
      [0.22, -0.22].forEach(function (z) { const w = box(0.32, 0.28, 0.06, feather); w.position.set(-0.02, 0.44, z); g.add(w); });
      // tail feathers angled up at the back
      const tail = box(0.22, 0.3, 0.28, feather); tail.position.set(-0.3, 0.56, 0); tail.rotation.z = 0.6; g.add(tail);
      // two orange legs
      [0.1, -0.1].forEach(function (z) {
        const l = box(0.05, 0.24, 0.05, leg); l.position.set(0.02, 0.12, z); g.add(l);
        const foot = box(0.14, 0.04, 0.12, leg); foot.position.set(0.05, 0.02, z); g.add(foot);
      });
      return g;
    },
  });
})();
