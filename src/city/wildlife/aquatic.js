(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const S = CBZ.defineSpecies;
  if (!S) return;

  // ============================================================
  //  MACKEREL — Scomber scombrus.
  //  Reference: iridescent blue-green back, silvery-white belly, 20-30 wavy
  //  dark bars across the upper flank, a deeply FORKED vertical tail, small
  //  triangular dorsal fins, small pectorals. Little streamlined fish.
  //  Modeled compact, body mass around y~0.45.
  // ============================================================
  S({
    id: "fish", name: "Mackerel", biome: "water", rarity: "common",
    hp: 5, fur: "Fresh Fish", furValue: 8, meat: "Fish Fillet", meatValue: 5,
    herd: [10, 20], packs: 4, spd: 2.0, danger: 0, aquatic: true,
    scale: 0.5, color: 0x6a8fa8,
    build: function (ctx) {
      const T = ctx.THREE, m = ctx.mat;
      const g = new T.Group();
      function box(w, h, d, mm) { return new T.Mesh(CBZ.boxGeom(w, h, d), mm); }
      const back = m(0x2f6b6a), flank = m(0x6a8fa8), belly = m(0xd9e0e2), bar = m(0x1c3540);
      // streamlined body: silvery flank with a green-blue back cap and white belly
      const body = box(1.5, 0.55, 0.4, flank); body.position.set(0, 0.5, 0); g.add(body);
      const topline = box(1.5, 0.16, 0.38, back); topline.position.set(0, 0.72, 0); g.add(topline);
      const ventral = box(1.3, 0.16, 0.34, belly); ventral.position.set(0, 0.26, 0); g.add(ventral);
      // wavy dark bars across the upper flank
      [0.45, 0.1, -0.25, -0.55].forEach(function (x) {
        const b = box(0.09, 0.42, 0.41, bar); b.position.set(x, 0.58, 0); g.add(b);
      });
      // pointed head + snout toward +X
      const head = box(0.45, 0.46, 0.36, flank); head.position.set(0.85, 0.5, 0); g.add(head);
      const snout = box(0.22, 0.22, 0.22, back); snout.position.set(1.14, 0.5, 0); g.add(snout);
      // small triangular dorsal fin poking up
      const dorsal = new T.Mesh(new T.ConeGeometry(0.16, 0.34, 4), back); dorsal.position.set(0.1, 0.94, 0); g.add(dorsal);
      // deeply forked vertical tail fin at -X
      const peduncle = box(0.3, 0.24, 0.18, flank); peduncle.position.set(-0.82, 0.5, 0); g.add(peduncle);
      const tailUp = box(0.14, 0.4, 0.05, back); tailUp.position.set(-1.05, 0.68, 0); tailUp.rotation.z = 0.5; g.add(tailUp);
      const tailDn = box(0.14, 0.4, 0.05, back); tailDn.position.set(-1.05, 0.32, 0); tailDn.rotation.z = -0.5; g.add(tailDn);
      // small pectoral fins
      [0.22, -0.22].forEach(function (z) {
        const f = box(0.3, 0.06, 0.16, flank); f.position.set(0.4, 0.44, z); f.rotation.y = (z > 0 ? -0.5 : 0.5); g.add(f);
      });
      return g;
    },
  });

  // ============================================================
  //  GREAT WHITE SHARK — Carcharodon carcharias. ~4m.
  //  Reference: slate-grey torpedo top, abrupt WHITE belly (countershading),
  //  short conical snout, big triangular first dorsal, crescent vertical tail,
  //  broad pectoral fins, gaping mouth with rows of white triangular teeth.
  // ============================================================
  S({
    id: "great_white_shark", name: "Great White Shark", biome: "water",
    rarity: "rare", hp: 140, fur: "Shark Fin", furValue: 260,
    meat: "Shark Meat", meatValue: 30, packs: 3, spd: 2.6, danger: 0.6,
    bite: 30, aquatic: true, scale: 1.2, color: 0x6b7880,
    build: function (ctx) {
      const T = ctx.THREE, m = ctx.mat;
      const g = new T.Group();
      function box(w, h, d, mm) { return new T.Mesh(CBZ.boxGeom(w, h, d), mm); }
      const grey = m(0x6b7880), white = m(0xe8ebec), gum = m(0x9aa4ac), tooth = m(0xf4f6f6), eye = m(0x14181c);
      // torpedo body with abrupt white belly
      const body = box(3.2, 1.05, 1.0, grey); body.position.set(0, 0.85, 0); g.add(body);
      const belly = box(2.9, 0.42, 0.92, white); belly.position.set(0, 0.42, 0); g.add(belly);
      const mid = box(1.2, 0.95, 0.92, grey); mid.position.set(1.1, 0.85, 0); g.add(mid);
      // short conical snout above a gaping mouth
      const head = box(0.9, 0.85, 0.8, grey); head.position.set(1.85, 0.9, 0); g.add(head);
      const snout = new T.Mesh(new T.ConeGeometry(0.42, 0.7, 4), grey); snout.position.set(2.35, 1.05, 0); snout.rotation.z = -Math.PI / 2; g.add(snout);
      const mouth = box(0.5, 0.3, 0.72, gum); mouth.position.set(2.2, 0.62, 0); g.add(mouth);
      // rows of white triangular teeth, top and bottom
      [0.24, 0.06, -0.12, -0.3].forEach(function (z) {
        const tu = new T.Mesh(new T.ConeGeometry(0.06, 0.16, 3), tooth); tu.position.set(2.28, 0.7, z); g.add(tu);
        const td = new T.Mesh(new T.ConeGeometry(0.06, 0.16, 3), tooth); td.position.set(2.28, 0.56, z); td.rotation.x = Math.PI; g.add(td);
      });
      [0.3, -0.3].forEach(function (z) {
        const ey = box(0.09, 0.11, 0.09, eye); ey.position.set(2.05, 1.05, z); g.add(ey);
      });
      // big triangular first dorsal fin breaching upward
      const dorsal = new T.Mesh(new T.ConeGeometry(0.5, 1.15, 4), grey); dorsal.position.set(0.1, 1.75, 0); g.add(dorsal);
      const dorsal2 = new T.Mesh(new T.ConeGeometry(0.18, 0.35, 4), grey); dorsal2.position.set(-1.3, 1.45, 0); g.add(dorsal2);
      // crescent vertical tail at -X
      const peduncle = box(0.5, 0.5, 0.4, grey); peduncle.position.set(-1.7, 0.85, 0); g.add(peduncle);
      const tailUp = box(0.32, 1.2, 0.4, grey); tailUp.position.set(-2.05, 1.35, 0); tailUp.rotation.z = 0.35; g.add(tailUp);
      const tailDn = box(0.28, 0.7, 0.38, grey); tailDn.position.set(-2.0, 0.45, 0); tailDn.rotation.z = -0.3; g.add(tailDn);
      // broad pectoral fins
      [0.6, -0.6].forEach(function (z) {
        const f = box(0.9, 0.12, 0.55, grey); f.position.set(0.9, 0.5, z); f.rotation.y = (z > 0 ? -0.5 : 0.5); f.rotation.x = (z > 0 ? 0.2 : -0.2); g.add(f);
      });
      return g;
    },
  });

  // ============================================================
  //  HUMPBACK WHALE — Megaptera novaeangliae. Enormous.
  //  Reference: dark grey-blue body, WHITE grooved throat/underside, very long
  //  knobbly PECTORAL fins (~1/3 body length), broad HORIZONTAL tail fluke,
  //  knobbly tubercled head. Built big and long.
  // ============================================================
  S({
    id: "humpback_whale", name: "Humpback Whale", biome: "water",
    rarity: "rare", hp: 900, fur: "Whale Blubber", furValue: 600,
    meat: "Whale Meat", meatValue: 50, packs: 2, spd: 1.6, danger: 0.1,
    aquatic: true, scale: 1.6, color: 0x33414a,
    build: function (ctx) {
      const T = ctx.THREE, m = ctx.mat;
      const g = new T.Group();
      function box(w, h, d, mm) { return new T.Mesh(CBZ.boxGeom(w, h, d), mm); }
      const dark = m(0x33414a), white = m(0xd8dee0), knob = m(0x2a353c);
      // enormous long body with white grooved underside
      const body = box(5.2, 1.7, 1.9, dark); body.position.set(0, 0.9, 0); g.add(body);
      const throat = box(3.6, 0.7, 1.7, white); throat.position.set(0.8, 0.15, 0); g.add(throat);
      // grooves along the white throat
      [0.55, 0.2, -0.15, -0.5].forEach(function (z) {
        const gr = box(2.8, 0.12, 0.08, knob); gr.position.set(0.8, 0.02, z); g.add(gr);
      });
      // knobbly tubercled head toward +X
      const head = box(1.6, 1.4, 1.75, dark); head.position.set(2.8, 0.85, 0); g.add(head);
      const jaw = box(1.2, 0.5, 1.6, white); jaw.position.set(3.2, 0.2, 0); g.add(jaw);
      [[3.5, 0.4], [3.5, -0.4], [3.1, 0.5], [3.1, -0.5], [2.7, 0.55]].forEach(function (o) {
        const t = box(0.18, 0.16, 0.18, knob); t.position.set(o[0], 1.5, o[1]); g.add(t);
      });
      // small low dorsal hump ridge
      const dorsal = box(0.6, 0.4, 0.7, dark); dorsal.position.set(-0.6, 1.85, 0); g.add(dorsal);
      // very long knobbly pectoral fins off the sides
      [0.95, -0.95].forEach(function (z) {
        const fin = box(2.6, 0.25, 0.6, white); fin.position.set(1.2, 0.5, z * 1.4);
        fin.rotation.y = (z > 0 ? -0.4 : 0.4); fin.rotation.z = -0.25; g.add(fin);
      });
      // tail peduncle and broad HORIZONTAL fluke at -X
      const pedun = box(1.4, 0.7, 0.8, dark); pedun.position.set(-2.9, 0.95, 0); g.add(pedun);
      const fluke = box(0.7, 0.2, 3.4, dark); fluke.position.set(-3.7, 1.0, 0); g.add(fluke);
      return g;
    },
  });

  // ============================================================
  //  BOTTLENOSE DOLPHIN — Tursiops truncatus.
  //  Reference: smooth grey back fading to a lighter belly, tall FALCATE
  //  (curved-back) dorsal fin mid-back, short thick BEAK/rostrum, HORIZONTAL
  //  notched tail fluke, small curved pectoral fins.
  // ============================================================
  S({
    id: "dolphin", name: "Dolphin", biome: "water", rarity: "common",
    hp: 40, fur: "Dolphin Hide", furValue: 70, packs: 3, herd: [4, 8],
    spd: 3.0, danger: 0, aquatic: true, scale: 0.9, color: 0x8b98a3,
    build: function (ctx) {
      const T = ctx.THREE, m = ctx.mat;
      const g = new T.Group();
      function box(w, h, d, mm) { return new T.Mesh(CBZ.boxGeom(w, h, d), mm); }
      const grey = m(0x8b98a3), pale = m(0xccd4d9), eye = m(0x15181b);
      // smooth streamlined body, lighter belly
      const body = box(2.6, 0.9, 0.8, grey); body.position.set(0, 0.8, 0); g.add(body);
      const belly = box(2.2, 0.34, 0.72, pale); belly.position.set(0.1, 0.45, 0); g.add(belly);
      const fore = box(0.9, 0.8, 0.72, grey); fore.position.set(1.3, 0.82, 0); g.add(fore);
      // melon forehead + short thick beak/rostrum toward +X
      const melon = box(0.5, 0.5, 0.5, grey); melon.position.set(1.75, 0.9, 0); g.add(melon);
      const beak = box(0.55, 0.28, 0.3, grey); beak.position.set(2.15, 0.78, 0); g.add(beak);
      const beakTip = box(0.18, 0.2, 0.22, pale); beakTip.position.set(2.45, 0.76, 0); g.add(beakTip);
      [0.22, -0.22].forEach(function (z) {
        const ey = box(0.07, 0.09, 0.07, eye); ey.position.set(1.85, 0.92, z); g.add(ey);
      });
      // tall FALCATE dorsal fin (curved back) mid-body
      const dorsal = new T.Mesh(new T.ConeGeometry(0.32, 0.85, 4), grey); dorsal.position.set(-0.05, 1.55, 0); dorsal.rotation.z = -0.35; g.add(dorsal);
      // small curved pectoral fins
      [0.42, -0.42].forEach(function (z) {
        const f = box(0.5, 0.09, 0.28, grey); f.position.set(0.85, 0.5, z); f.rotation.y = (z > 0 ? -0.5 : 0.5); f.rotation.z = -0.3; g.add(f);
      });
      // tail peduncle + HORIZONTAL notched fluke at -X
      const pedun = box(0.5, 0.4, 0.34, grey); pedun.position.set(-1.4, 0.82, 0); g.add(pedun);
      const flukeL = box(0.5, 0.14, 0.65, grey); flukeL.position.set(-1.85, 0.82, 0.42); flukeL.rotation.y = 0.3; g.add(flukeL);
      const flukeR = box(0.5, 0.14, 0.65, grey); flukeR.position.set(-1.85, 0.82, -0.42); flukeR.rotation.y = -0.3; g.add(flukeR);
      return g;
    },
  });

  // ============================================================
  //  MEGALODON — Otodus megalodon. Colossal prehistoric shark, LEGENDARY.
  //  Like the great white but MASSIVE and heavier: enormous gaping JAWS lined
  //  with rows of big white teeth (top & bottom), towering dorsal fin, huge
  //  crescent tail, dark slate top with a white belly. Terrifying scale.
  // ============================================================
  S({
    id: "megalodon", name: "Megalodon", biome: "water", rarity: "legendary",
    hp: 1200, fur: "Legendary Megalodon Tooth", furValue: 3000, respawn: false,
    packs: 1, spd: 2.4, danger: 0.8, bite: 60, aquatic: true,
    scale: 2.6, color: 0x4a5560,
    build: function (ctx) {
      const T = ctx.THREE, m = ctx.mat;
      const g = new T.Group();
      function box(w, h, d, mm) { return new T.Mesh(CBZ.boxGeom(w, h, d), mm); }
      const dark = m(0x4a5560), white = m(0xdfe4e6), gum = m(0x8b3a3a), tooth = m(0xf5f7f6), eye = m(0x0c0e10);
      // colossal heavy body with abrupt white belly
      const body = box(4.4, 1.7, 1.6, dark); body.position.set(0, 0.95, 0); g.add(body);
      const belly = box(4.0, 0.7, 1.5, white); belly.position.set(0, 0.35, 0); g.add(belly);
      const mid = box(1.7, 1.55, 1.5, dark); mid.position.set(1.6, 0.95, 0); g.add(mid);
      // huge blunt head
      const head = box(1.5, 1.5, 1.35, dark); head.position.set(2.7, 1.0, 0); g.add(head);
      const snout = new T.Mesh(new T.ConeGeometry(0.7, 1.0, 4), dark); snout.position.set(3.4, 1.35, 0); snout.rotation.z = -Math.PI / 2; g.add(snout);
      // enormous gaping jaws lined with big teeth top & bottom
      const upperJaw = box(0.9, 0.4, 1.25, gum); upperJaw.position.set(3.25, 0.95, 0); g.add(upperJaw);
      const lowerJaw = box(0.9, 0.4, 1.25, gum); lowerJaw.position.set(3.3, 0.3, 0); g.add(lowerJaw);
      [0.5, 0.28, 0.06, -0.16, -0.38, -0.6].forEach(function (z) {
        const tu = new T.Mesh(new T.ConeGeometry(0.11, 0.34, 3), tooth); tu.position.set(3.25, 0.72, z); tu.rotation.x = Math.PI; g.add(tu);
        const td = new T.Mesh(new T.ConeGeometry(0.11, 0.34, 3), tooth); td.position.set(3.3, 0.52, z); g.add(td);
      });
      [0.52, -0.52].forEach(function (z) {
        const ey = box(0.14, 0.16, 0.14, eye); ey.position.set(2.95, 1.35, z); g.add(ey);
      });
      // towering dorsal fin
      const dorsal = new T.Mesh(new T.ConeGeometry(0.75, 1.9, 4), dark); dorsal.position.set(0.1, 2.35, 0); g.add(dorsal);
      const dorsal2 = new T.Mesh(new T.ConeGeometry(0.28, 0.55, 4), dark); dorsal2.position.set(-1.9, 1.75, 0); g.add(dorsal2);
      // huge crescent vertical tail at -X
      const pedun = box(0.8, 0.8, 0.6, dark); pedun.position.set(-2.4, 0.95, 0); g.add(pedun);
      const tailUp = box(0.5, 2.0, 0.6, dark); tailUp.position.set(-2.95, 1.75, 0); tailUp.rotation.z = 0.35; g.add(tailUp);
      const tailDn = box(0.45, 1.2, 0.55, dark); tailDn.position.set(-2.85, 0.35, 0); tailDn.rotation.z = -0.3; g.add(tailDn);
      // massive pectoral fins
      [0.9, -0.9].forEach(function (z) {
        const f = box(1.5, 0.2, 0.9, dark); f.position.set(1.3, 0.5, z); f.rotation.y = (z > 0 ? -0.5 : 0.5); f.rotation.x = (z > 0 ? 0.25 : -0.25); g.add(f);
      });
      return g;
    },
  });
})();
