/* ============================================================
   city/wildlife/snow_ungulates.js — snow-biome ungulates batch.
   Moose, Caribou, Mountain Goat, Bison. Low-poly, blocky
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
  //  MOOSE — huge, near-black brown (winter). Long horse-like
  //  snout w/ overhanging lip, a dewlap ("bell") under the throat,
  //  tall shoulder hump, very long legs, and enormous PALMATE
  //  (broad flat shovel) antlers edged with small tine cones.
  // ============================================================
  S({
    id: "moose", name: "Moose", biome: "snow", rarity: "rare",
    hp: 180, fur: "Moose Hide", furValue: 220, meat: "Moose Meat", meatValue: 20, meatYield: 3,
    scale: 1.4, herd: [1, 2], packs: 2, spd: 2.2, danger: 0.4, bite: 16, spook: 26, color: 0x40301f,
    build: function (ctx) {
      const T = ctx.THREE, m = ctx.mat, r = ctx.rng;
      const hide = m(0x40301f), dark = m(0x2b2014), leg = m(0x746758), palm = m(0x3a2b1a);
      const g = new T.Group();
      function box(w, h, d, mm) { return new T.Mesh(CBZ.boxGeom(w, h, d), mm); }
      // massive torso
      const body = box(2.3, 1.25, 1.05, hide); body.position.set(0, 2.0, 0); g.add(body);
      // tall shoulder hump over the front shoulders
      const hump = box(1.0, 0.55, 0.95, hide); hump.position.set(0.55, 2.75, 0); g.add(hump);
      // thick neck sloping up to the head
      const neck = box(0.62, 0.85, 0.6, hide); neck.position.set(1.15, 2.45, 0); neck.rotation.z = -0.35; g.add(neck);
      // long horse-like head + drooping snout with overhanging lip
      const head = box(0.78, 0.55, 0.5, hide); head.position.set(1.7, 2.55, 0); g.add(head);
      const snout = box(0.6, 0.5, 0.42, dark); snout.position.set(2.15, 2.3, 0); g.add(snout);
      const lip = box(0.28, 0.22, 0.4, dark); lip.position.set(2.34, 2.06, 0); g.add(lip);
      // ears
      [0.24, -0.24].forEach(function (z) { const e = box(0.12, 0.3, 0.1, hide); e.position.set(1.5, 2.9, z); g.add(e); });
      // dewlap / bell hanging under the throat
      const bell = box(0.24, 0.55, 0.26, dark); bell.position.set(1.55, 1.95, 0); g.add(bell);
      // very long legs
      [[0.82, 0.36], [0.82, -0.36], [-0.82, 0.36], [-0.82, -0.36]].forEach(function (o) {
        const l = box(0.26, 1.8, 0.26, leg); l.position.set(o[0], 0.9, o[1]); g.add(l);
      });
      // enormous PALMATE antlers — two wide flat shovels edged with tines
      [-1, 1].forEach(function (s) {
        const pad = box(0.12, 0.5, 0.9, palm); pad.position.set(1.55, 3.15, s * 0.55); pad.rotation.x = s * 0.35; g.add(pad);
        // small tine cones along the outer edge of each palm
        [-0.3, 0.0, 0.3].forEach(function (dz) {
          const tine = new T.Mesh(new T.ConeGeometry(0.07, 0.32, 5), palm);
          tine.position.set(1.55, 3.45, s * (0.9 + dz * 0.0) + dz); tine.rotation.x = s * -0.4; g.add(tine);
        });
      });
      const tail = box(0.14, 0.28, 0.12, dark); tail.position.set(-1.2, 1.9, 0); g.add(tail);
      return g;
    },
  });

  // ============================================================
  //  CARIBOU — grey-brown body with a pale/white neck & rump,
  //  broad muzzle, and large asymmetric branching antlers that
  //  sweep forward (present in both sexes).
  // ============================================================
  S({
    id: "caribou", name: "Caribou", biome: "snow", rarity: "uncommon",
    hp: 70, fur: "Caribou Pelt", furValue: 110, meat: "Venison", meatValue: 12,
    scale: 1.05, herd: [10, 20], packs: 2, spd: 2.8, danger: 0, spook: 28, color: 0x8a7256,
    build: function (ctx) {
      const T = ctx.THREE, m = ctx.mat, r = ctx.rng;
      const body2 = m(0x8a7256), pale = m(0xd8cdba), dark = m(0x4a3c2a), antler = m(0x6b5233);
      const g = new T.Group();
      function box(w, h, d, mm) { return new T.Mesh(CBZ.boxGeom(w, h, d), mm); }
      // torso
      const torso = box(1.9, 0.95, 0.82, body2); torso.position.set(0, 1.5, 0); g.add(torso);
      // pale/white rump patch
      const rump = box(0.3, 0.85, 0.78, pale); rump.position.set(-0.9, 1.5, 0); g.add(rump);
      // pale/white maned neck rising to the head
      const neck = box(0.55, 0.9, 0.55, pale); neck.position.set(0.95, 1.9, 0); neck.rotation.z = -0.4; g.add(neck);
      // head + broad muzzle
      const head = box(0.6, 0.46, 0.44, body2); head.position.set(1.42, 2.25, 0); g.add(head);
      const muzzle = box(0.4, 0.34, 0.4, dark); muzzle.position.set(1.74, 2.12, 0); g.add(muzzle);
      // ears
      [0.18, -0.18].forEach(function (z) { const e = box(0.1, 0.24, 0.08, body2); e.position.set(1.28, 2.5, z); g.add(e); });
      // legs
      [[0.7, 0.3], [0.7, -0.3], [-0.72, 0.3], [-0.72, -0.3]].forEach(function (o) {
        const l = box(0.2, 1.1, 0.2, body2); l.position.set(o[0], 0.55, o[1]); g.add(l);
      });
      // large asymmetric branching antlers sweeping FORWARD (both sexes)
      [-1, 1].forEach(function (s) {
        const beam = box(0.08, 1.0, 0.08, antler); beam.position.set(1.3, 2.85, s * 0.18); beam.rotation.z = 0.4; g.add(beam);
        // forward-sweeping main branch
        const fwd = box(0.06, 0.6, 0.06, antler); fwd.position.set(1.75, 3.1, s * 0.2); fwd.rotation.z = 1.0; g.add(fwd);
        // forward brow shovel (asymmetric — bigger on one side)
        const brow = box(0.06, 0.4 + (s > 0 ? 0.12 : 0), 0.06, antler); brow.position.set(1.85, 2.5, s * 0.12); brow.rotation.z = 1.2; g.add(brow);
        // upper tines
        const t1 = box(0.05, 0.4, 0.05, antler); t1.position.set(1.1, 3.4, s * 0.24); t1.rotation.z = -0.2; g.add(t1);
        const t2 = box(0.05, 0.34, 0.05, antler); t2.position.set(0.85, 3.35, s * 0.26); t2.rotation.z = -0.5; g.add(t2);
      });
      const tail = box(0.14, 0.24, 0.1, pale); tail.position.set(-1.02, 1.45, 0); g.add(tail);
      return g;
    },
  });

  // ============================================================
  //  MOUNTAIN GOAT — shaggy WHITE woolly coat (chunky body), a
  //  fur shoulder hump, chin BEARD, short black backward-curving
  //  horns (cones), and black hooves.
  // ============================================================
  S({
    id: "mountain_goat", name: "Mountain Goat", biome: "snow", rarity: "uncommon",
    hp: 50, fur: "Mountain Goat Hide", furValue: 140,
    scale: 0.85, herd: [3, 8], packs: 2, spd: 2.4, danger: 0.1, spook: 24, color: 0xf2f0ea,
    build: function (ctx) {
      const T = ctx.THREE, m = ctx.mat, r = ctx.rng;
      const wool = m(0xf2f0ea), wool2 = m(0xe2ded2), black = m(0x171512), horn = m(0x201d18);
      const g = new T.Group();
      function box(w, h, d, mm) { return new T.Mesh(CBZ.boxGeom(w, h, d), mm); }
      // chunky woolly torso
      const body = box(1.3, 0.95, 0.85, wool); body.position.set(0, 1.15, 0); g.add(body);
      // woolly underbelly skirt
      const skirt = box(1.25, 0.35, 0.78, wool2); skirt.position.set(0, 0.78, 0); g.add(skirt);
      // slight fur shoulder hump
      const hump = box(0.55, 0.35, 0.8, wool); hump.position.set(0.4, 1.75, 0); g.add(hump);
      // short thick neck
      const neck = box(0.42, 0.5, 0.45, wool); neck.position.set(0.72, 1.55, 0); g.add(neck);
      // head
      const head = box(0.5, 0.42, 0.4, wool); head.position.set(1.05, 1.6, 0); g.add(head);
      const snout = box(0.24, 0.24, 0.28, wool2); snout.position.set(1.32, 1.52, 0); g.add(snout);
      const nose = box(0.1, 0.12, 0.16, black); nose.position.set(1.46, 1.5, 0); g.add(nose);
      // chin beard
      const beard = box(0.14, 0.3, 0.16, wool2); beard.position.set(1.18, 1.32, 0); g.add(beard);
      // ears
      [0.16, -0.16].forEach(function (z) { const e = box(0.1, 0.16, 0.07, wool); e.position.set(0.92, 1.82, z); g.add(e); });
      // short black backward-curving horns (cones)
      [0.11, -0.11].forEach(function (z) {
        const hn = new T.Mesh(new T.ConeGeometry(0.06, 0.3, 5), horn);
        hn.position.set(0.98, 1.94, z); hn.rotation.z = 0.5; g.add(hn);
      });
      // short legs with black hooves
      [[0.45, 0.28], [0.45, -0.28], [-0.45, 0.28], [-0.45, -0.28]].forEach(function (o) {
        const l = box(0.18, 0.7, 0.18, wool); l.position.set(o[0], 0.45, o[1]); g.add(l);
        const hoof = box(0.19, 0.14, 0.19, black); hoof.position.set(o[0], 0.07, o[1]); g.add(hoof);
      });
      return g;
    },
  });

  // ============================================================
  //  BISON — massive dark brown. Enormous SHOULDER HUMP, a big
  //  shaggy dark mane/beard over the head & front (front third
  //  bulky & darker), short curved black HORNS on a low broad
  //  head, small hindquarters. Iconic silhouette.
  // ============================================================
  S({
    id: "bison", name: "Bison", biome: "snow", rarity: "uncommon",
    hp: 200, fur: "Bison Pelt", furValue: 190, meat: "Beef", meatValue: 18, meatYield: 3,
    scale: 1.3, herd: [12, 24], packs: 2, spd: 2.4, danger: 0.5, bite: 20, spook: 22, color: 0x4a3323,
    build: function (ctx) {
      const T = ctx.THREE, m = ctx.mat, r = ctx.rng;
      const hair = m(0x4a3323), mane = m(0x2e2012), dark = m(0x1e150c), horn = m(0x14110c);
      const g = new T.Group();
      function box(w, h, d, mm) { return new T.Mesh(CBZ.boxGeom(w, h, d), mm); }
      // smaller hindquarters (rear third)
      const rear = box(1.0, 0.9, 0.85, hair); rear.position.set(-0.85, 1.55, 0); g.add(rear);
      // bulky, darker, shaggy front third
      const front = box(1.1, 1.15, 1.0, mane); front.position.set(0.55, 1.6, 0); g.add(front);
      // enormous shoulder hump
      const hump = box(0.85, 0.7, 0.95, mane); hump.position.set(0.35, 2.4, 0); g.add(hump);
      // shaggy dark mane/head at the very front, low-set
      const head = box(0.75, 0.85, 0.7, mane); head.position.set(1.35, 1.4, 0); g.add(head);
      // broad forehead / bonnet of shaggy hair
      const bonnet = box(0.35, 0.4, 0.72, dark); bonnet.position.set(1.5, 1.85, 0); g.add(bonnet);
      // muzzle
      const muzzle = box(0.34, 0.36, 0.44, dark); muzzle.position.set(1.72, 1.2, 0); g.add(muzzle);
      // big shaggy beard hanging under the chin
      const beard = box(0.22, 0.45, 0.3, mane); beard.position.set(1.5, 0.95, 0); g.add(beard);
      // short curved black horns on the low broad head
      [0.28, -0.28].forEach(function (z) {
        const hn = new T.Mesh(new T.ConeGeometry(0.08, 0.32, 5), horn);
        hn.position.set(1.45, 1.9, z); hn.rotation.z = -0.3; hn.rotation.x = (z > 0 ? -0.6 : 0.6); g.add(hn);
      });
      // sturdy legs — front legs heavier
      [[0.6, 0.34], [0.6, -0.34]].forEach(function (o) {
        const l = box(0.26, 1.0, 0.26, dark); l.position.set(o[0], 0.5, o[1]); g.add(l);
      });
      [[-0.7, 0.32], [-0.7, -0.32]].forEach(function (o) {
        const l = box(0.22, 0.95, 0.22, dark); l.position.set(o[0], 0.47, o[1]); g.add(l);
      });
      const tail = box(0.12, 0.5, 0.12, dark); tail.position.set(-1.35, 1.35, 0); g.add(tail);
      return g;
    },
  });
})();
