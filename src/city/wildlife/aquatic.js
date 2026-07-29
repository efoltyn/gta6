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

  /* ==========================================================================
     THE OCEAN IS NOT FIVE FISH.

     OWNER: "make water absolutely massive and make fish and potential predator
     like shark spawn in like npc in that water".

     Five species over a 25 km sea is an empty sea, and the fix is the shape
     this file was built for: A SPECIES IS A ROW. Nothing below needs an edit
     anywhere else — wildlife.js's swim rig is GEOMETRIC (tail = children behind
     the origin, jaw = the lower-forward half of the head cluster), so every one
     of these animates for free; predator.js's ARCH table is keyed on a STYLE
     string, so the new sharks hunt without a name appearing anywhere; and
     city/fishing.js has no fish table at all, so every one of these is
     catchable on a rod the moment it exists.

     DEPTH IS DECLARED, NOT GUESSED. `clearance` is how far offshore this animal
     needs to be (wildlife.js converts it through the same bathymetry every
     spawn uses) and `swimDepth` is how far the model origin rides below the
     surface. Before these two fields, both were hard-coded name tables in
     wildlife.js — which is why a new species could not be honest about its own
     water. A bull shark hunts the surf at 12 u of clearance; a marlin needs
     150 u of blue water. That difference is the whole reason the sea reads as
     a place with regions in it.
     ========================================================================== */

  // ============================================================
  //  SARDINE — Sardina pilchardus. THE BAIT BALL.
  //  Tiny, in enormous shoals. Reference: bright silver flank, dark blue-green
  //  back, a single small dorsal, deeply forked tail. It exists to be eaten,
  //  and a shoal of eighty of them is what makes open water look ALIVE.
  // ============================================================
  S({
    id: "sardine", name: "Sardine", biome: "water", rarity: "common",
    hp: 3, fur: "Fresh Fish", furValue: 4, meat: "Fish Fillet", meatValue: 3,
    herd: [26, 60], spd: 2.3, danger: 0, aquatic: true,
    scale: 0.34, color: 0x9fb4c2, clearance: 14, swimDepth: 0.55,
    build: function (ctx) {
      const T = ctx.THREE, m = ctx.mat;
      const g = new T.Group();
      function box(w, h, d, mm) { return new T.Mesh(CBZ.boxGeom(w, h, d), mm); }
      const back = m(0x22525a), flank = m(0xb9c8d2), belly = m(0xeef1f2);
      const body = box(1.0, 0.34, 0.22, flank); body.position.set(0, 0.4, 0); g.add(body);
      const top = box(1.0, 0.11, 0.20, back); top.position.set(0, 0.55, 0); g.add(top);
      const bel = box(0.9, 0.10, 0.19, belly); bel.position.set(0, 0.26, 0); g.add(bel);
      const head = box(0.28, 0.28, 0.20, flank); head.position.set(0.58, 0.40, 0); g.add(head);
      const snout = box(0.13, 0.13, 0.13, back); snout.position.set(0.75, 0.40, 0); g.add(snout);
      const dorsal = new T.Mesh(new T.ConeGeometry(0.08, 0.18, 4), back); dorsal.position.set(0.04, 0.62, 0); g.add(dorsal);
      const ped = box(0.18, 0.14, 0.10, flank); ped.position.set(-0.56, 0.40, 0); g.add(ped);
      const tu = box(0.10, 0.26, 0.03, back); tu.position.set(-0.72, 0.52, 0); tu.rotation.z = 0.52; g.add(tu);
      const td = box(0.10, 0.26, 0.03, back); td.position.set(-0.72, 0.28, 0); td.rotation.z = -0.52; g.add(td);
      return g;
    },
  });

  // ============================================================
  //  ATLANTIC BLUEFIN TUNA — Thunnus thynnus. ~2.5 m, and FAST.
  //  Reference: a steel torpedo with a metallic blue-black back and a silver
  //  belly, a rigid CRESCENT tail on a thin keeled peduncle, a row of small
  //  yellow finlets running to the tail, long sickle pectorals, big eye.
  // ============================================================
  S({
    id: "tuna", name: "Bluefin Tuna", biome: "water", rarity: "uncommon",
    hp: 55, fur: "Fresh Fish", furValue: 90, meat: "Fish Fillet", meatValue: 26,
    herd: [3, 9], spd: 4.2, danger: 0, aquatic: true,
    scale: 0.85, color: 0x40566b, clearance: 90, swimDepth: 1.5,
    build: function (ctx) {
      const T = ctx.THREE, m = ctx.mat;
      const g = new T.Group();
      function box(w, h, d, mm) { return new T.Mesh(CBZ.boxGeom(w, h, d), mm); }
      const back = m(0x2b3d55), flank = m(0x8496a6), belly = m(0xdfe6ea);
      const finlet = m(0xd8b436), eye = m(0x101418);
      const body = box(2.0, 0.92, 0.72, flank); body.position.set(0, 0.75, 0); g.add(body);
      const top = box(2.0, 0.34, 0.70, back); top.position.set(0, 1.10, 0); g.add(top);
      const bel = box(1.8, 0.30, 0.66, belly); bel.position.set(0, 0.36, 0); g.add(bel);
      const head = box(0.62, 0.78, 0.62, flank); head.position.set(1.22, 0.78, 0); g.add(head);
      const snout = new T.Mesh(new T.ConeGeometry(0.30, 0.55, 4), back); snout.position.set(1.66, 0.86, 0); snout.rotation.z = -Math.PI / 2; g.add(snout);
      [0.26, -0.26].forEach(function (z) { const e = box(0.10, 0.12, 0.10, eye); e.position.set(1.30, 0.96, z); g.add(e); });
      // two dorsals: a tall spiny one, a low soft one
      const d1 = new T.Mesh(new T.ConeGeometry(0.24, 0.62, 4), back); d1.position.set(0.30, 1.48, 0); g.add(d1);
      const d2 = new T.Mesh(new T.ConeGeometry(0.14, 0.28, 4), back); d2.position.set(-0.42, 1.32, 0); g.add(d2);
      // the yellow finlet row — the one detail that says "tuna" and nothing else
      for (let i = 0; i < 5; i++) {
        const f = box(0.07, 0.09, 0.05, finlet); f.position.set(-0.72 - i * 0.16, 1.18 - i * 0.03, 0); g.add(f);
        const fv = box(0.07, 0.09, 0.05, finlet); fv.position.set(-0.72 - i * 0.16, 0.33 + i * 0.03, 0); g.add(fv);
      }
      // long sickle pectorals
      [0.38, -0.38].forEach(function (z) {
        const f = box(0.86, 0.08, 0.24, back); f.position.set(0.72, 0.62, z);
        f.rotation.y = (z > 0 ? -0.42 : 0.42); f.rotation.z = -0.24; g.add(f);
      });
      // thin keeled peduncle + a rigid crescent tail
      const ped = box(0.36, 0.24, 0.16, flank); ped.position.set(-1.48, 0.75, 0); g.add(ped);
      const tu = box(0.20, 0.80, 0.10, back); tu.position.set(-1.80, 1.10, 0); tu.rotation.z = 0.46; g.add(tu);
      const td = box(0.20, 0.80, 0.10, back); td.position.set(-1.80, 0.40, 0); td.rotation.z = -0.46; g.add(td);
      return g;
    },
  });

  // ============================================================
  //  BLUE MARLIN — Makaira nigricans. The trophy. ~3.5 m of billfish.
  //  Reference: a cobalt back over a silver-white belly, a long SPEAR bill, a
  //  tall sail-like front dorsal that folds back into a ridge, cobalt vertical
  //  stripes down the flank, a huge stiff crescent tail.
  // ============================================================
  S({
    id: "marlin", name: "Blue Marlin", biome: "water", rarity: "rare",
    hp: 130, fur: "Marlin Bill", furValue: 420, meat: "Fish Fillet", meatValue: 34,
    packs: 1, spd: 4.6, danger: 0.15, aquatic: true,
    scale: 1.05, color: 0x1f4e86, clearance: 150, swimDepth: 1.9,
    build: function (ctx) {
      const T = ctx.THREE, m = ctx.mat;
      const g = new T.Group();
      function box(w, h, d, mm) { return new T.Mesh(CBZ.boxGeom(w, h, d), mm); }
      const back = m(0x17386b), flank = m(0x5f7ea6), belly = m(0xe4eaee);
      const stripe = m(0x2f6fc4), eye = m(0x0d1014);
      const body = box(2.6, 1.05, 0.66, flank); body.position.set(0, 0.85, 0); g.add(body);
      const top = box(2.6, 0.40, 0.62, back); top.position.set(0, 1.28, 0); g.add(top);
      const bel = box(2.3, 0.34, 0.60, belly); bel.position.set(0, 0.40, 0); g.add(bel);
      // cobalt vertical stripes
      [0.9, 0.45, 0.0, -0.45, -0.9].forEach(function (x) {
        const b = box(0.08, 0.78, 0.67, stripe); b.position.set(x, 0.92, 0); g.add(b);
      });
      const head = box(0.66, 0.92, 0.56, flank); head.position.set(1.58, 0.92, 0); g.add(head);
      // THE BILL — long, round, and the whole silhouette
      const bill = new T.Mesh(new T.CylinderGeometry(0.045, 0.13, 1.30, 8), back);
      bill.position.set(2.55, 1.04, 0); bill.rotation.z = -Math.PI / 2; g.add(bill);
      [0.24, -0.24].forEach(function (z) { const e = box(0.12, 0.14, 0.11, eye); e.position.set(1.72, 1.16, z); g.add(e); });
      // the SAIL: a tall front dorsal falling away into a ridge
      const sail = new T.Mesh(new T.ConeGeometry(0.46, 0.95, 4), back); sail.position.set(0.86, 1.86, 0); g.add(sail);
      for (let i = 0; i < 4; i++) { const r = box(0.34, 0.24 - i * 0.04, 0.09, back); r.position.set(0.28 - i * 0.36, 1.56 - i * 0.05, 0); g.add(r); }
      // long thin pectorals held out like wings
      [0.34, -0.34].forEach(function (z) {
        const f = box(1.05, 0.07, 0.20, back); f.position.set(0.90, 0.62, z);
        f.rotation.y = (z > 0 ? -0.36 : 0.36); f.rotation.z = -0.20; g.add(f);
      });
      const ped = box(0.40, 0.26, 0.16, flank); ped.position.set(-1.78, 0.85, 0); g.add(ped);
      const tu = box(0.22, 1.05, 0.12, back); tu.position.set(-2.18, 1.34, 0); tu.rotation.z = 0.42; g.add(tu);
      const td = box(0.22, 1.05, 0.12, back); td.position.set(-2.18, 0.36, 0); td.rotation.z = -0.42; g.add(td);
      return g;
    },
  });

  // ============================================================
  //  GREAT HAMMERHEAD — Sphyrna mokarran. ~5 m.
  //  Reference: the CEPHALOFOIL — a wide flat T-shaped head with the eyes at
  //  its very tips — and a first dorsal so tall and scythe-like it is the other
  //  half of the silhouette. Grey-brown over a pale belly.
  //  danger 0.5 puts it on wildlife_shark.js's brain: it stalks, it circles,
  //  it smells blood, and it obeys the menace gauge like every other predator.
  // ============================================================
  S({
    id: "hammerhead_shark", name: "Great Hammerhead", biome: "water",
    rarity: "rare", hp: 150, fur: "Shark Fin", furValue: 300,
    meat: "Shark Meat", meatValue: 30, spd: 2.5, danger: 0.5,
    bite: 26, aquatic: true, scale: 1.25, color: 0x7d8a8f,
    clearance: 40, swimDepth: 2.5,
    build: function (ctx) {
      const T = ctx.THREE, m = ctx.mat;
      const g = new T.Group();
      function box(w, h, d, mm) { return new T.Mesh(CBZ.boxGeom(w, h, d), mm); }
      const grey = m(0x7d8a8f), pale = m(0xe3e7e6), gum = m(0x93999c), tooth = m(0xf3f5f4), eye = m(0x0f1215);
      const body = box(3.0, 1.00, 0.92, grey); body.position.set(0, 0.90, 0); g.add(body);
      const belly = box(2.7, 0.40, 0.86, pale); belly.position.set(0, 0.48, 0); g.add(belly);
      const mid = box(1.1, 0.92, 0.86, grey); mid.position.set(1.05, 0.90, 0); g.add(mid);
      // THE CEPHALOFOIL: a wide flat bar athwart the body, eyes at the tips
      const foil = box(0.62, 0.34, 2.55, grey); foil.position.set(1.92, 0.92, 0); g.add(foil);
      const foilU = box(0.58, 0.10, 2.45, pale); foilU.position.set(1.92, 0.74, 0); g.add(foilU);
      [1.24, -1.24].forEach(function (z) { const e = box(0.20, 0.22, 0.20, eye); e.position.set(1.98, 0.94, z); g.add(e); });
      // the mouth is UNDER the bar, well back — a hammerhead's is famously small
      const mouth = box(0.42, 0.20, 0.62, gum); mouth.position.set(1.72, 0.66, 0); g.add(mouth);
      [0.18, 0.0, -0.18].forEach(function (z) {
        const tu = new T.Mesh(new T.ConeGeometry(0.05, 0.13, 3), tooth); tu.position.set(1.76, 0.72, z); tu.rotation.x = Math.PI; g.add(tu);
        const td = new T.Mesh(new T.ConeGeometry(0.05, 0.13, 3), tooth); td.position.set(1.78, 0.58, z); g.add(td);
      });
      // the scythe dorsal — taller and thinner than a great white's
      const dorsal = new T.Mesh(new T.ConeGeometry(0.34, 1.55, 4), grey); dorsal.position.set(0.20, 1.98, 0); dorsal.rotation.z = -0.22; g.add(dorsal);
      const d2 = new T.Mesh(new T.ConeGeometry(0.14, 0.32, 4), grey); d2.position.set(-1.32, 1.50, 0); g.add(d2);
      const ped = box(0.46, 0.44, 0.34, grey); ped.position.set(-1.70, 0.90, 0); g.add(ped);
      const tu2 = box(0.28, 1.30, 0.34, grey); tu2.position.set(-2.10, 1.46, 0); tu2.rotation.z = 0.34; g.add(tu2);
      const td2 = box(0.24, 0.62, 0.32, grey); td2.position.set(-2.02, 0.50, 0); td2.rotation.z = -0.30; g.add(td2);
      [0.56, -0.56].forEach(function (z) {
        const f = box(0.92, 0.10, 0.50, grey); f.position.set(0.86, 0.54, z);
        f.rotation.y = (z > 0 ? -0.48 : 0.48); f.rotation.x = (z > 0 ? 0.20 : -0.20); g.add(f);
      });
      return g;
    },
  });

  // ============================================================
  //  BULL SHARK — Carcharhinus leucas. ~3 m, and THE ONE THAT COMES INSHORE.
  //  Reference: stocky, thick-bodied, blunt rounded snout, small eyes, grey
  //  over white with no markings. Its whole character is that its `clearance`
  //  is 12 — it hunts the SURF, where a great white cannot reach you and where
  //  the player actually swims. That is the difference between an animal you
  //  read about and an animal you meet.
  // ============================================================
  S({
    id: "bull_shark", name: "Bull Shark", biome: "water",
    rarity: "uncommon", hp: 110, fur: "Shark Fin", furValue: 190,
    meat: "Shark Meat", meatValue: 24, spd: 2.7, danger: 0.55,
    bite: 24, aquatic: true, scale: 0.95, color: 0x7f8a90,
    clearance: 12, swimDepth: 1.5,
    build: function (ctx) {
      const T = ctx.THREE, m = ctx.mat;
      const g = new T.Group();
      function box(w, h, d, mm) { return new T.Mesh(CBZ.boxGeom(w, h, d), mm); }
      const grey = m(0x7f8a90), white = m(0xeceeee), gum = m(0x9aa1a5), tooth = m(0xf4f6f6), eye = m(0x101317);
      // STOCKY: deeper and shorter than a great white at the same length
      const body = box(2.3, 1.05, 1.02, grey); body.position.set(0, 0.88, 0); g.add(body);
      const belly = box(2.1, 0.46, 0.96, white); belly.position.set(0, 0.42, 0); g.add(belly);
      const mid = box(0.95, 1.00, 0.98, grey); mid.position.set(0.92, 0.90, 0); g.add(mid);
      // BLUNT, ROUNDED snout — no cone; that is the field mark
      const head = box(0.80, 0.86, 0.84, grey); head.position.set(1.62, 0.92, 0); g.add(head);
      const nose = box(0.34, 0.56, 0.62, grey); nose.position.set(2.06, 1.02, 0); g.add(nose);
      const mouth = box(0.44, 0.26, 0.70, gum); mouth.position.set(1.94, 0.64, 0); g.add(mouth);
      [0.22, 0.04, -0.14, -0.30].forEach(function (z) {
        const tu = new T.Mesh(new T.ConeGeometry(0.055, 0.15, 3), tooth); tu.position.set(1.99, 0.72, z); g.add(tu);
        const td = new T.Mesh(new T.ConeGeometry(0.055, 0.15, 3), tooth); td.position.set(1.99, 0.57, z); td.rotation.x = Math.PI; g.add(td);
      });
      [0.28, -0.28].forEach(function (z) { const e = box(0.07, 0.08, 0.07, eye); e.position.set(1.82, 1.06, z); g.add(e); });
      const dorsal = new T.Mesh(new T.ConeGeometry(0.46, 0.95, 4), grey); dorsal.position.set(0.15, 1.62, 0); g.add(dorsal);
      const d2 = new T.Mesh(new T.ConeGeometry(0.15, 0.30, 4), grey); d2.position.set(-1.05, 1.42, 0); g.add(d2);
      const ped = box(0.44, 0.44, 0.36, grey); ped.position.set(-1.34, 0.88, 0); g.add(ped);
      const tu2 = box(0.28, 1.00, 0.36, grey); tu2.position.set(-1.66, 1.32, 0); tu2.rotation.z = 0.34; g.add(tu2);
      const td2 = box(0.24, 0.58, 0.34, grey); td2.position.set(-1.60, 0.48, 0); td2.rotation.z = -0.30; g.add(td2);
      [0.56, -0.56].forEach(function (z) {
        const f = box(0.80, 0.11, 0.48, grey); f.position.set(0.76, 0.50, z);
        f.rotation.y = (z > 0 ? -0.50 : 0.50); f.rotation.x = (z > 0 ? 0.20 : -0.20); g.add(f);
      });
      return g;
    },
  });

  // ============================================================
  //  ORCA — Orcinus orca. ~8 m. The apex animal in this water.
  //  Reference: gloss BLACK over a white chin/belly, a white eye patch behind
  //  the eye, a pale grey saddle behind the dorsal, and a towering triangular
  //  dorsal fin — on a bull it stands nearly two metres. Horizontal fluke.
  //  Pods of 3-6. danger 0.5 puts it on the hunting brain, which is correct:
  //  an orca is the only thing in this sea that hunts great whites.
  // ============================================================
  S({
    id: "orca", name: "Orca", biome: "water", rarity: "rare",
    hp: 620, fur: "Orca Hide", furValue: 520, meat: "Whale Meat", meatValue: 44,
    herd: [3, 6], spd: 3.4, danger: 0.5, bite: 42, aquatic: true,
    scale: 1.55, color: 0x14171b, clearance: 110, swimDepth: 2.6,
    build: function (ctx) {
      const T = ctx.THREE, m = ctx.mat;
      const g = new T.Group();
      function box(w, h, d, mm) { return new T.Mesh(CBZ.boxGeom(w, h, d), mm); }
      const black = m(0x14171b), white = m(0xf2f4f4), saddle = m(0x4b545c), eye = m(0x08090b);
      const body = box(4.2, 1.55, 1.45, black); body.position.set(0, 1.00, 0); g.add(body);
      const belly = box(3.6, 0.55, 1.35, white); belly.position.set(0.25, 0.42, 0); g.add(belly);
      const fore = box(1.3, 1.45, 1.35, black); fore.position.set(2.05, 1.02, 0); g.add(fore);
      // rounded melon head + white chin
      const melon = box(0.85, 1.05, 1.05, black); melon.position.set(2.75, 1.10, 0); g.add(melon);
      const chin = box(0.95, 0.34, 0.90, white); chin.position.set(2.72, 0.58, 0); g.add(chin);
      // the WHITE EYE PATCH, high and behind the eye — the field mark
      [0.62, -0.62].forEach(function (z) {
        const p = box(0.62, 0.26, 0.10, white); p.position.set(2.10, 1.42, z * 1.10); g.add(p);
        const e = box(0.12, 0.13, 0.09, eye); e.position.set(2.34, 1.20, z * 1.08); g.add(e);
      });
      // pale saddle behind the dorsal
      const sad = box(1.10, 0.26, 1.05, saddle); sad.position.set(-0.55, 1.72, 0); g.add(sad);
      // TOWERING triangular dorsal
      const dorsal = new T.Mesh(new T.ConeGeometry(0.52, 2.05, 4), black); dorsal.position.set(0.25, 2.72, 0); g.add(dorsal);
      // big paddle pectorals
      [0.78, -0.78].forEach(function (z) {
        const f = box(1.15, 0.16, 0.72, black); f.position.set(1.35, 0.58, z);
        f.rotation.y = (z > 0 ? -0.40 : 0.40); f.rotation.z = -0.26; g.add(f);
      });
      const ped = box(0.95, 0.62, 0.62, black); ped.position.set(-2.35, 1.00, 0); g.add(ped);
      const flukeL = box(0.75, 0.18, 1.15, black); flukeL.position.set(-3.05, 1.00, 0.72); flukeL.rotation.y = 0.26; g.add(flukeL);
      const flukeR = box(0.75, 0.18, 1.15, black); flukeR.position.set(-3.05, 1.00, -0.72); flukeR.rotation.y = -0.26; g.add(flukeR);
      return g;
    },
  });

  // ============================================================
  //  GREEN SEA TURTLE — Chelonia mydas.
  //  Reference: a low domed carapace in olive-brown with a mosaic of scutes, a
  //  cream plastron, a small scaly head on a short neck, and two long FLIPPERS
  //  forward that row rather than beat. Slow, harmless, and the animal that
  //  makes a reef feel like a reef.
  // ============================================================
  S({
    id: "sea_turtle", name: "Green Sea Turtle", biome: "water",
    rarity: "common", hp: 45, fur: "Turtle Shell", furValue: 65,
    meat: "Fish Fillet", meatValue: 12, herd: [1, 3], spd: 1.1, danger: 0,
    aquatic: true, scale: 0.7, color: 0x556b3a, clearance: 20, swimDepth: 1.1,
    build: function (ctx) {
      const T = ctx.THREE, m = ctx.mat;
      const g = new T.Group();
      function box(w, h, d, mm) { return new T.Mesh(CBZ.boxGeom(w, h, d), mm); }
      const shell = m(0x4f6535), scute = m(0x3c4e29), cream = m(0xd6cfa8), skin = m(0x6f7b53), eye = m(0x14161a);
      // low domed carapace + a plastron under it
      const car = box(1.35, 0.36, 1.10, shell); car.position.set(0, 0.50, 0); g.add(car);
      const dome = box(1.05, 0.22, 0.85, shell); dome.position.set(-0.02, 0.70, 0); g.add(dome);
      const pla = box(1.20, 0.16, 0.95, cream); pla.position.set(0, 0.28, 0); g.add(pla);
      // the scute mosaic — five down the midline, a ring around
      [0.42, 0.14, -0.14, -0.42].forEach(function (x) {
        const s2 = box(0.24, 0.06, 0.30, scute); s2.position.set(x, 0.82, 0); g.add(s2);
        [0.36, -0.36].forEach(function (z) { const q = box(0.24, 0.05, 0.24, scute); q.position.set(x, 0.72, z); g.add(q); });
      });
      // short neck, small scaly head, beak
      const neck = box(0.26, 0.22, 0.22, skin); neck.position.set(0.76, 0.52, 0); g.add(neck);
      const head = box(0.32, 0.28, 0.26, skin); head.position.set(1.02, 0.54, 0); g.add(head);
      const beak = box(0.12, 0.14, 0.16, cream); beak.position.set(1.22, 0.50, 0); g.add(beak);
      [0.11, -0.11].forEach(function (z) { const e = box(0.06, 0.07, 0.06, eye); e.position.set(1.10, 0.60, z); g.add(e); });
      // LONG forward flippers (they row) + short rear paddles
      [0.52, -0.52].forEach(function (z) {
        const f = box(0.95, 0.09, 0.30, skin); f.position.set(0.42, 0.42, z);
        f.rotation.y = (z > 0 ? -0.50 : 0.50); f.rotation.z = -0.16; g.add(f);
        const r = box(0.36, 0.08, 0.22, skin); r.position.set(-0.58, 0.38, z * 0.86);
        r.rotation.y = (z > 0 ? -0.36 : 0.36); g.add(r);
      });
      // a short pointed tail — the swim rig needs SOMETHING behind the origin
      const tail = box(0.24, 0.12, 0.12, skin); tail.position.set(-0.86, 0.44, 0); g.add(tail);
      return g;
    },
  });

  // ============================================================
  //  GIANT MANTA RAY — Mobula birostris. ~6 m across.
  //  Reference: an enormous flat diamond WING, dark charcoal above and white
  //  below, two forward cephalic lobes rolled like horns, a whip tail with no
  //  barb, and gill slits in rows on the pale underside. It flies rather than
  //  swims, and it is the most graceful thing that will ever cross the player's
  //  view underwater.
  // ============================================================
  S({
    id: "manta_ray", name: "Giant Manta Ray", biome: "water",
    rarity: "uncommon", hp: 90, fur: "Manta Hide", furValue: 210,
    meat: "Fish Fillet", meatValue: 18, herd: [1, 3], spd: 1.9, danger: 0,
    aquatic: true, scale: 1.1, color: 0x2b3138, clearance: 70, swimDepth: 2.2,
    build: function (ctx) {
      const T = ctx.THREE, m = ctx.mat;
      const g = new T.Group();
      function box(w, h, d, mm) { return new T.Mesh(CBZ.boxGeom(w, h, d), mm); }
      const dark = m(0x262c33), pale = m(0xe8ebec), eye = m(0x0c0e11);
      // the WING: a diamond built from three chords, thick at the spine and
      // tapering to a point at each tip
      const core = box(1.55, 0.34, 1.30, dark); core.position.set(0, 0.60, 0); g.add(core);
      const under = box(1.40, 0.14, 1.15, pale); under.position.set(0, 0.44, 0); g.add(under);
      [1, -1].forEach(function (s2) {
        const w1 = box(1.30, 0.22, 1.05, dark); w1.position.set(-0.12, 0.58, s2 * 1.15); w1.rotation.x = s2 * -0.10; g.add(w1);
        const u1 = box(1.15, 0.10, 0.95, pale); u1.position.set(-0.12, 0.46, s2 * 1.15); g.add(u1);
        const w2 = box(0.85, 0.14, 0.85, dark); w2.position.set(-0.36, 0.56, s2 * 2.00); w2.rotation.x = s2 * -0.18; g.add(w2);
        const w3 = box(0.45, 0.09, 0.62, dark); w3.position.set(-0.62, 0.54, s2 * 2.62); w3.rotation.x = s2 * -0.26; g.add(w3);
        // gill slits, on the pale underside
        for (let i = 0; i < 4; i++) { const gs = box(0.06, 0.04, 0.26, m(0x171b1f)); gs.position.set(0.30 - i * 0.16, 0.39, s2 * 0.42); g.add(gs); }
      });
      // head bar + the two rolled cephalic lobes ("horns") + wide mouth
      const head = box(0.42, 0.30, 1.15, dark); head.position.set(0.92, 0.60, 0); g.add(head);
      const mouth = box(0.24, 0.14, 0.95, m(0x101317)); mouth.position.set(1.06, 0.50, 0); g.add(mouth);
      [0.52, -0.52].forEach(function (z) {
        const lobe = box(0.46, 0.16, 0.16, dark); lobe.position.set(1.28, 0.58, z); lobe.rotation.y = (z > 0 ? -0.22 : 0.22); g.add(lobe);
        const e = box(0.08, 0.09, 0.08, eye); e.position.set(1.00, 0.62, z * 1.32); g.add(e);
      });
      // the whip tail — thin, long, and what the swim rig will undulate
      const t1 = box(0.55, 0.10, 0.10, dark); t1.position.set(-1.05, 0.58, 0); g.add(t1);
      const t2 = box(0.60, 0.07, 0.07, dark); t2.position.set(-1.62, 0.58, 0); g.add(t2);
      const t3 = box(0.60, 0.05, 0.05, dark); t3.position.set(-2.20, 0.58, 0); g.add(t3);
      return g;
    },
  });

  // ============================================================
  //  GREAT BARRACUDA — Sphyraena barracuda. ~1.8 m.
  //  Reference: a silver pike-shaped body with a long underslung jaw full of
  //  fangs, dark blotches scattered down the lower flank, two widely SEPARATED
  //  dorsals and a forked tail. Hangs motionless, then is somewhere else.
  //  danger 0.3 keeps it OFF the hunting brain deliberately: it is menacing to
  //  look at and it is not a shark, and pretending otherwise would cheapen the
  //  three animals that are.
  // ============================================================
  S({
    id: "barracuda", name: "Great Barracuda", biome: "water",
    rarity: "common", hp: 34, fur: "Fresh Fish", furValue: 46,
    meat: "Fish Fillet", meatValue: 14, herd: [1, 4], spd: 3.1, danger: 0.3,
    bite: 10, aquatic: true, scale: 0.6, color: 0xa9b6bd,
    clearance: 26, swimDepth: 1.2,
    build: function (ctx) {
      const T = ctx.THREE, m = ctx.mat;
      const g = new T.Group();
      function box(w, h, d, mm) { return new T.Mesh(CBZ.boxGeom(w, h, d), mm); }
      const silver = m(0xa9b6bd), back = m(0x4f5f6a), belly = m(0xeff2f3);
      const blotch = m(0x2c3740), tooth = m(0xf6f7f6), eye = m(0x101317);
      const body = box(2.1, 0.52, 0.40, silver); body.position.set(0, 0.55, 0); g.add(body);
      const top = box(2.1, 0.16, 0.38, back); top.position.set(0, 0.77, 0); g.add(top);
      const bel = box(1.9, 0.14, 0.36, belly); bel.position.set(0, 0.32, 0); g.add(bel);
      [0.7, 0.25, -0.2, -0.65].forEach(function (x) {
        const b = box(0.20, 0.16, 0.41, blotch); b.position.set(x, 0.42, 0); g.add(b);
      });
      // pike head with an UNDERSLUNG jaw
      const head = box(0.62, 0.44, 0.34, silver); head.position.set(1.36, 0.56, 0); g.add(head);
      const upper = box(0.52, 0.16, 0.26, back); upper.position.set(1.86, 0.62, 0); g.add(upper);
      const lower = box(0.58, 0.15, 0.26, silver); lower.position.set(1.90, 0.44, 0); g.add(lower);
      [0.09, -0.05, -0.19].forEach(function (x) {
        const t1 = new T.Mesh(new T.ConeGeometry(0.035, 0.12, 3), tooth); t1.position.set(1.90 + x, 0.55, 0.06); t1.rotation.x = Math.PI; g.add(t1);
        const t2 = new T.Mesh(new T.ConeGeometry(0.035, 0.12, 3), tooth); t2.position.set(1.92 + x, 0.51, -0.06); g.add(t2);
      });
      [0.14, -0.14].forEach(function (z) { const e = box(0.08, 0.09, 0.07, eye); e.position.set(1.54, 0.66, z); g.add(e); });
      // TWO widely separated dorsals — the field mark
      const d1 = new T.Mesh(new T.ConeGeometry(0.14, 0.32, 4), back); d1.position.set(0.42, 0.98, 0); g.add(d1);
      const d2 = new T.Mesh(new T.ConeGeometry(0.13, 0.28, 4), back); d2.position.set(-0.72, 0.95, 0); g.add(d2);
      [0.20, -0.20].forEach(function (z) {
        const f = box(0.34, 0.06, 0.18, silver); f.position.set(0.72, 0.44, z); f.rotation.y = (z > 0 ? -0.48 : 0.48); g.add(f);
      });
      const ped = box(0.28, 0.20, 0.14, silver); ped.position.set(-1.18, 0.55, 0); g.add(ped);
      const tu = box(0.16, 0.52, 0.06, back); tu.position.set(-1.46, 0.80, 0); tu.rotation.z = 0.48; g.add(tu);
      const td = box(0.16, 0.52, 0.06, back); td.position.set(-1.46, 0.30, 0); td.rotation.z = -0.48; g.add(td);
      return g;
    },
  });
})();
