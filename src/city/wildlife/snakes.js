/* ============================================================
   city/wildlife/snakes.js — slithering serpents.
   Garter, Rattlesnake, King Cobra, Black Mamba, Green Anaconda.
   NOT quadrupeds: each is a CHAIN of body segments the animation
   engine undulates every frame. build() only defines each segment's
   size/shape/colour + special parts (cobra hood, rattle). The engine
   positions every segment, so initial local layout does not matter.
   group.userData.segs = ordered meshes (0 = head, last = tail tip).
   Head reads facing +X. Low-poly, colours matched to reference photos.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const S = CBZ.defineSpecies;
  if (!S) return;

  // ============================================================
  //  GARTER SNAKE — slim; dark olive/black body with 3 yellow
  //  length stripes (1 dorsal + 2 lateral), small head, pale belly.
  // ============================================================
  S({
    id: "garter_snake", name: "Garter Snake", biome: "forest", rarity: "common",
    hp: 8, fur: "Garter Skin", furValue: 10, danger: 0, spook: 14, spd: 1.4,
    scale: 1, herd: [1, 1], snake: true, color: 0x2f3a24,
    build: function (ctx) {
      const T = ctx.THREE, m = ctx.mat, g = new T.Group();
      const body = m(0x2f3a24), stripe = m(0xd8c95a), belly = m(0xbfc07a), eye = m(0x12120c);
      const segs = [], N = 12, R = 0.055;
      // small head (segs[0]), faces +X
      const head = new T.Mesh(CBZ.boxGeom(0.14, 0.085, 0.10), body); g.add(head); segs[0] = head;
      const eL = new T.Mesh(new T.SphereGeometry(0.022, 5, 4), eye); eL.position.set(0.05, 0.03, 0.05); head.add(eL);
      const eR = eL.clone(); eR.position.z = -0.05; head.add(eR);
      // striped body segments (dorsal + 2 lateral yellow stripes track the body)
      function dress(seg) {
        const d = new T.Mesh(CBZ.boxGeom(0.19, 0.02, 0.03), stripe); d.position.y = 0.048; seg.add(d);
        const l = new T.Mesh(CBZ.boxGeom(0.19, 0.03, 0.02), stripe); l.position.set(0, -0.005, 0.048); seg.add(l);
        const r = l.clone(); r.position.z = -0.048; seg.add(r);
        const b = new T.Mesh(CBZ.boxGeom(0.19, 0.02, 0.06), belly); b.position.y = -0.045; seg.add(b);
      }
      dress(head);
      for (let i = 1; i < N; i++) {
        const r = Math.max(0.028, R * (1 - i / (N + 5)));
        const s = new T.Mesh(CBZ.boxGeom(0.18, r * 1.7, r * 1.7), body);
        g.add(s); segs.push(s); dress(s);
      }
      g.userData.segs = segs; g.userData.spacing = 0.16; g.userData.baseY = 0.06;
      return g;
    },
  });

  // ============================================================
  //  RATTLESNAKE — tan/brown with dark DIAMOND blotches down the
  //  back, thick TRIANGULAR head, banded segmented RATTLE at tail.
  // ============================================================
  S({
    id: "rattlesnake", name: "Rattlesnake", biome: "desert", rarity: "uncommon",
    hp: 14, fur: "Snakeskin", furValue: 34, danger: 0.4, venom: true, venomDps: 4,
    bite: 12, spook: 10, spd: 1.2, scale: 1, herd: [1, 1], snake: true, color: 0xb59367,
    build: function (ctx) {
      const T = ctx.THREE, m = ctx.mat, g = new T.Group();
      const tan = m(0xb59367), dark = m(0x6b4d31), pale = m(0xe6d6b4), black = m(0x1a1712), eye = m(0x120f0a);
      const segs = [], N = 12, R = 0.10;
      // thick triangular head (segs[0]) — wide at back, narrow snout
      const head = new T.Mesh(CBZ.boxGeom(0.20, 0.11, 0.20), tan); g.add(head); segs[0] = head;
      const snout = new T.Mesh(new T.ConeGeometry(0.08, 0.16, 4), tan);
      snout.rotation.z = -Math.PI / 2; snout.position.set(0.16, -0.01, 0); head.add(snout);
      const eL = new T.Mesh(new T.SphereGeometry(0.028, 5, 4), eye); eL.position.set(0.06, 0.04, 0.08); head.add(eL);
      const eR = eL.clone(); eR.position.z = -0.08; head.add(eR);
      // body segments with dark diamond blotch on the back (bordered pale)
      for (let i = 1; i < N; i++) {
        const r = Math.max(0.045, R * (1 - i / (N + 6)));
        const s = new T.Mesh(CBZ.boxGeom(0.22, r * 1.7, r * 1.9), tan);
        g.add(s); segs.push(s);
        if (i % 2 === 1) {
          const border = new T.Mesh(CBZ.boxGeom(0.13, 0.02, r * 1.7), pale); border.position.y = r * 0.85; border.rotation.y = 0.78; s.add(border);
          const dia = new T.Mesh(CBZ.boxGeom(0.10, 0.03, r * 1.3), dark); dia.position.y = r * 0.9; dia.rotation.y = 0.78; s.add(dia);
        }
      }
      // segmented RATTLE — stacked banded cones at the tail tip (last seg)
      const rattle = new T.Mesh(new T.ConeGeometry(0.055, 0.07, 5), pale);
      rattle.rotation.z = Math.PI / 2;
      for (let i = 1; i < 4; i++) {
        const seg = new T.Mesh(new T.ConeGeometry(0.055 - i * 0.01, 0.06, 5), (i % 2 === 0) ? pale : black);
        seg.rotation.z = Math.PI / 2; seg.position.x = -i * 0.055; rattle.add(seg);
      }
      g.add(rattle); segs.push(rattle);
      g.userData.rattle = rattle;
      g.userData.segs = segs; g.userData.spacing = 0.22; g.userData.baseY = 0.09;
      return g;
    },
  });

  // ============================================================
  //  KING COBRA — olive-brown with faint pale bands, big head,
  //  and the marquee HOOD (two flat wide flaps the engine flares).
  //  rear:4 front segments rear up when threatened.
  // ============================================================
  S({
    id: "king_cobra", name: "King Cobra", biome: "desert", rarity: "rare",
    hp: 24, fur: "Cobra Skin", furValue: 220, danger: 0.55, venom: true, venomDps: 7,
    bite: 16, spook: 8, spd: 1.6, scale: 1.05, herd: [1, 1], snake: true, color: 0x6b5a34,
    build: function (ctx) {
      const T = ctx.THREE, m = ctx.mat, g = new T.Group();
      const body = m(0x6b5a34), band = m(0xcabb85), hoodM = m(0x5a4b2c), belly = m(0xc9b98a), eye = m(0x100e08);
      const segs = [], N = 13, R = 0.115;
      // big head (segs[0])
      const head = new T.Mesh(CBZ.boxGeom(0.24, 0.13, 0.19), body); g.add(head); segs[0] = head;
      const snout = new T.Mesh(CBZ.boxGeom(0.10, 0.10, 0.15), body); snout.position.set(0.15, -0.01, 0); head.add(snout);
      const eL = new T.Mesh(new T.SphereGeometry(0.03, 5, 4), eye); eL.position.set(0.08, 0.05, 0.08); head.add(eL);
      const eR = eL.clone(); eR.position.z = -0.08; head.add(eR);
      // body segments with faint pale bands + pale belly
      for (let i = 1; i < N; i++) {
        const r = Math.max(0.05, R * (1 - i / (N + 6)));
        const s = new T.Mesh(CBZ.boxGeom(0.28, r * 1.7, r * 1.7), body);
        g.add(s); segs.push(s);
        if (i % 3 === 0) { const bd = new T.Mesh(CBZ.boxGeom(0.05, r * 1.72, r * 1.72), band); s.add(bd); }
        const bl = new T.Mesh(CBZ.boxGeom(0.28, 0.03, r * 1.1), belly); bl.position.y = -r * 0.8; s.add(bl);
      }
      // HOOD — two flat wide flaps on the neck (segs[1]); built flared, engine scales 0.15->1
      const neck = segs[1];
      const hoodL = new T.Mesh(CBZ.boxGeom(0.05, 0.30, 0.24), hoodM);
      hoodL.position.set(-0.04, 0.06, 0.15); hoodL.rotation.x = -0.35; neck.add(hoodL);
      const hoodR = new T.Mesh(CBZ.boxGeom(0.05, 0.30, 0.24), hoodM);
      hoodR.position.set(-0.04, 0.06, -0.15); hoodR.rotation.x = 0.35; neck.add(hoodR);
      g.userData.hood = [hoodL, hoodR];
      g.userData.rear = 4;
      g.userData.segs = segs; g.userData.spacing = 0.28; g.userData.baseY = 0.11;
      return g;
    },
  });

  // ============================================================
  //  BLACK MAMBA — very long & slender, gunmetal grey-brown,
  //  distinctive COFFIN-shaped head with inky-black mouth. Fastest.
  // ============================================================
  S({
    id: "black_mamba", name: "Black Mamba", biome: "desert", rarity: "rare",
    hp: 18, fur: "Mamba Skin", furValue: 240, danger: 0.6, venom: true, venomDps: 8,
    bite: 14, spook: 12, spd: 3.2, scale: 1, herd: [1, 1], snake: true, color: 0x4a4a44,
    build: function (ctx) {
      const T = ctx.THREE, m = ctx.mat, g = new T.Group();
      const body = m(0x4a4a44), mottle = m(0x3a3a34), inky = m(0x0a0a0c), eye = m(0x141410);
      const segs = [], N = 14, R = 0.075;
      // coffin head (segs[0]) — long, wider at the back, tapering to a narrow snout
      const head = new T.Mesh(CBZ.boxGeom(0.14, 0.09, 0.14), body); g.add(head); segs[0] = head;
      const brow = new T.Mesh(CBZ.boxGeom(0.06, 0.04, 0.15), body); brow.position.set(-0.03, 0.05, 0); head.add(brow);
      const snout = new T.Mesh(CBZ.boxGeom(0.12, 0.06, 0.08), body); snout.position.set(0.12, -0.01, 0); head.add(snout);
      const mouth = new T.Mesh(CBZ.boxGeom(0.08, 0.03, 0.09), inky); mouth.position.set(0.10, -0.045, 0); head.add(mouth);
      const eL = new T.Mesh(new T.SphereGeometry(0.024, 5, 4), eye); eL.position.set(0.03, 0.045, 0.065); head.add(eL);
      const eR = eL.clone(); eR.position.z = -0.065; head.add(eR);
      // slender body with faint oblique mottle bars
      for (let i = 1; i < N; i++) {
        const r = Math.max(0.03, R * (1 - i / (N + 6)));
        const s = new T.Mesh(CBZ.boxGeom(0.24, r * 1.6, r * 1.6), body);
        g.add(s); segs.push(s);
        if (i % 2 === 0) { const bar = new T.Mesh(CBZ.boxGeom(0.04, r * 1.62, r * 1.62), mottle); bar.rotation.y = 0.4; s.add(bar); }
      }
      g.userData.segs = segs; g.userData.spacing = 0.24; g.userData.baseY = 0.09;
      return g;
    },
  });

  // ============================================================
  //  GREEN ANACONDA — MASSIVE & thick, olive-green with black oval
  //  spots (yellow-centred along the flanks), broad blunt head with
  //  eyes set high on top. 16 fat segments.
  // ============================================================
  S({
    id: "green_anaconda", name: "Green Anaconda", biome: "forest", rarity: "rare",
    hp: 90, fur: "Anaconda Skin", furValue: 300, danger: 0.6, constrictor: true,
    bite: 20, spook: 0, spd: 1.4, scale: 1.3, herd: [1, 1], snake: true, color: 0x4d5a2e,
    build: function (ctx) {
      const T = ctx.THREE, m = ctx.mat, g = new T.Group();
      const body = m(0x4d5a2e), spot = m(0x14140e), sideSpot = m(0xb0a03a), eye = m(0x100f08);
      const segs = [], N = 16, R = 0.30;
      // broad blunt head (segs[0]) with eyes set high on top
      const head = new T.Mesh(CBZ.boxGeom(0.50, 0.26, 0.40), body); g.add(head); segs[0] = head;
      const snout = new T.Mesh(CBZ.boxGeom(0.16, 0.18, 0.34), body); snout.position.set(0.30, -0.02, 0); head.add(snout);
      const eL = new T.Mesh(new T.SphereGeometry(0.05, 6, 5), eye); eL.position.set(0.14, 0.15, 0.13); head.add(eL);
      const eR = eL.clone(); eR.position.z = -0.13; head.add(eR);
      // fat body segments with black oval dorsal spots + yellow-centred flank spots
      for (let i = 1; i < N; i++) {
        const r = Math.max(0.14, R * (1 - i / (N + 10)));
        const s = new T.Mesh(new T.SphereGeometry(r, 7, 6), body);
        g.add(s); segs.push(s);
        if (i % 2 === 1) {
          const ov = new T.Mesh(CBZ.boxGeom(r * 0.9, 0.04, r * 1.1), spot); ov.position.y = r * 0.85; s.add(ov);
        } else {
          const sp = new T.Mesh(CBZ.boxGeom(r * 0.6, r * 0.6, 0.04), sideSpot); sp.position.z = r * 0.92; s.add(sp);
          const sp2 = sp.clone(); sp2.position.z = -r * 0.92; s.add(sp2);
        }
      }
      g.userData.segs = segs; g.userData.spacing = 0.55; g.userData.baseY = 0.30;
      return g;
    },
  });
})();
