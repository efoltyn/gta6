(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const S = CBZ.defineSpecies;
  if (!S) return;

  // A shark is a continuous hydrodynamic wedge, not a box with a pyramid glued
  // to its face. Build the torso/head from elliptical cross-sections so the
  // forehead flows into a BROAD, FLATTENED, BLUNT rostrum. The final ring keeps
  // substantial width (the key fact in the user's front/side references), and
  // the lower faces carry the countershaded belly in the SAME connected mesh.
  function addSharkHull(g, T, o) {
    const rings = o.rings || [], sides = Math.max(8, o.sides || 12);
    if (rings.length < 2) return null;
    const positions = [];
    for (let i = 0; i < rings.length; i++) {
      const r = rings[i];
      for (let j = 0; j < sides; j++) {
        const a = (j / sides) * Math.PI * 2;
        positions.push(r.x, r.y + Math.sin(a) * r.ry, Math.cos(a) * r.rz);
      }
    }
    const top = [], belly = [], bellyCut = o.bellyCut == null ? -0.16 : o.bellyCut;
    function bucket(j) {
      const a0 = (j / sides) * Math.PI * 2;
      const a1 = (((j + 1) % sides) / sides) * Math.PI * 2;
      let s = (Math.sin(a0) + Math.sin(a1)) * 0.5;
      if (j === sides - 1) s = (Math.sin(a0) + Math.sin(Math.PI * 2)) * 0.5;
      return s < bellyCut ? belly : top;
    }
    for (let i = 0; i < rings.length - 1; i++) {
      for (let j = 0; j < sides; j++) {
        const n = (j + 1) % sides;
        const a = i * sides + j, b = (i + 1) * sides + j;
        const c = (i + 1) * sides + n, d = i * sides + n;
        bucket(j).push(a, b, d, b, c, d);
      }
    }
    // Flat rear/front caps preserve the deliberately blunt nose instead of
    // quietly turning the last ring back into another cone.
    const rearCenter = positions.length / 3;
    positions.push(rings[0].x, rings[0].y, 0);
    const frontCenter = positions.length / 3;
    const fr = rings[rings.length - 1];
    positions.push(fr.x, fr.y, 0);
    for (let j = 0; j < sides; j++) {
      const n = (j + 1) % sides, dst = bucket(j);
      dst.push(rearCenter, j, n);
      const base = (rings.length - 1) * sides;
      dst.push(frontCenter, base + n, base + j);
    }
    const indices = top.concat(belly);
    const geom = new T.BufferGeometry();
    geom.setAttribute("position", new T.Float32BufferAttribute(positions, 3));
    geom.setIndex(indices);
    geom.addGroup(0, top.length, 0);
    geom.addGroup(top.length, belly.length, 1);
    geom.computeVertexNormals(); geom.computeBoundingBox(); geom.computeBoundingSphere();
    const hull = new T.Mesh(geom, [o.top, o.belly || o.top]);
    hull.name = "sharkHull"; g.add(hull);
    const maxWidth = rings.reduce(function (v, r) { return Math.max(v, r.rz * 2); }, 0);
    g.userData.sharkShape = {
      profile: o.profile || "broad-wedge",
      noseWidth: fr.rz * 2, noseHeight: fr.ry * 2, headWidth: maxWidth,
      noseWidthRatio: maxWidth > 0 ? (fr.rz * 2) / maxWidth : 0,
    };
    return hull;
  }

  // Eyes, nostrils, and vertical gill slots are tiny, but they are what turns a
  // generic low-poly fish hull into a readable shark face from the side/front.
  function addSharkFaceDetails(g, T, m, o) {
    const dark = m(o.dark || 0x10161a);
    const eyeGeom = o.eyeSize === 0 ? null : new T.SphereGeometry(o.eyeSize || 0.075, 7, 5);
    [-1, 1].forEach(function (side) {
      if (eyeGeom) {
        const eye = new T.Mesh(eyeGeom, dark); eye.name = "sharkEye";
        eye.position.set(o.eyeX, o.eyeY, side * o.eyeZ); eye.scale.z = 0.55; g.add(eye);
      }
      const nostril = new T.Mesh(new T.SphereGeometry(o.nostrilSize || 0.035, 6, 4), dark);
      nostril.name = "sharkNostril";
      nostril.position.set(o.noseX, o.noseY, side * o.noseZ); nostril.scale.set(1, 0.45, 0.55); g.add(nostril);
      for (let i = 0; i < (o.gills || 4); i++) {
        const slot = new T.Mesh(CBZ.boxGeom(o.gillWidth || 0.032, (o.gillHeight || 0.34) * (1 - i * 0.045), o.gillDepth || 0.025), dark);
        slot.name = "sharkGill";
        // gillZStep follows the hull's widening taper toward midships so every
        // slot sits proud of the surface instead of drowning inside the mesh
        slot.position.set(o.gillX - i * (o.gillStep || 0.09), o.gillY,
          side * (o.gillZ + i * (o.gillZStep || 0)));
        slot.rotation.z = -0.08; g.add(slot);
      }
    });
  }

  // One mouth grammar for every true shark in this catalogue. The jaw follows
  // an elliptical U around the underside of the broad rostrum: short overlapping
  // arc segments replace the old rectangular rails, while every segment and
  // tooth remains parented to one physical lower-jaw hinge.
  function addSharkMouth(g, T, m, o) {
    const hingeX = o.hingeX, hingeY = o.hingeY, len = o.length, width = o.width;
    const gap = o.gap, gumH = o.gumHeight || Math.max(0.05, gap * 0.17);
    const railW = o.railWidth || Math.max(0.07, width * 0.13);
    const toothH = o.toothHeight || gap * 0.48;
    const toothR = o.toothRadius || toothH * 0.34;
    const sideCount = o.sideTeeth || 5, frontCount = o.frontTeeth || 5;
    const gum = m(o.gum || 0x54242b), tooth = m(o.tooth || 0xf4f1df);
    const cavityMat = m(o.cavity || 0x10070a), skin = m(o.skin || 0xdfe4e6);
    const upperSkin = m(o.upperSkin || o.skin || 0x6b7880);
    function box(w, h, d, mm) { return new T.Mesh(CBZ.boxGeom(w, h, d), mm); }

    const cavity = new T.Mesh(new T.SphereGeometry(1, 10, 6), cavityMat);
    cavity.name = "sharkMouthCavity";
    cavity.position.set(hingeX + len * 0.58, hingeY, 0);
    cavity.scale.set(len * 0.58, gap * 0.06, width * 0.38);
    g.add(cavity);

    const upper = new T.Group(); upper.name = "sharkUpperJaw";
    const lower = new T.Group(); lower.name = "sharkLowerJaw";
    upper.position.set(hingeX, hingeY, 0);
    lower.position.set(hingeX, hingeY, 0); // this origin IS the physical hinge
    g.add(upper); g.add(lower);

    const upperY = gap * 0.27, lowerY = -gap * 0.27;
    const arcSteps = Math.max(10, sideCount * 2);
    const arc = [];
    for (let i = 0; i <= arcSteps; i++) {
      const a = -Math.PI * 0.48 + (i / arcSteps) * Math.PI * 0.96;
      arc.push({ x: len * (0.18 + 0.82 * Math.cos(a)), z: width * 0.5 * Math.sin(a) });
    }
    // A small shared bite preload seats the mandible against the lip. The
    // longer animation travel below preserves the authored full-open endpoint.
    const restClose = 0.04;
    lower.rotation.z = restClose;

    function arcBar(parent, p0, p1, y, h, d, mm, name, outward) {
      const dx = p1.x - p0.x, dz = p1.z - p0.z;
      const seg = box(Math.hypot(dx, dz) * 1.12, h, d, mm);
      const z0 = (p0.z + p1.z) * 0.5;
      seg.name = name;
      seg.position.set((p0.x + p1.x) * 0.5, y,
        z0 + (outward ? (z0 < 0 ? -1 : 1) * outward : 0));
      seg.rotation.y = Math.atan2(-dz, dx); parent.add(seg); return seg;
    }
    // The hull itself is the chin now: the mandible is a slim seat under the
    // lower gum arc, not a slab — a thick mandible is exactly what made the
    // old mouth read as a bolted-on box of dentures from the side.
    const lipH = gumH + gap * 0.09;
    for (let i = 0; i < arc.length - 1; i++) {
      const p0 = arc[i], p1 = arc[i + 1];
      arcBar(upper, p0, p1, upperY, gumH, railW, gum, "sharkUpperGum", 0);
      arcBar(lower, p0, p1, lowerY, gumH, railW, gum, "sharkLowerGum", 0);
      arcBar(lower, p0, p1, lowerY - gumH * 0.55, gumH * 0.95, railW * 1.15, skin, "sharkMandible", 0);
      arcBar(upper, p0, p1, upperY, lipH, railW * 0.20, upperSkin, "sharkUpperLip", railW * 0.52);
      arcBar(lower, p0, p1, lowerY, lipH, railW * 0.20, skin, "sharkLowerLip", railW * 0.52);
    }

    let upperTeeth = 0, lowerTeeth = 0;
    function toothPair(parent, x, z, top) {
      const t = new T.Mesh(new T.ConeGeometry(toothR, toothH, 3), tooth);
      t.position.set(x, top
        ? upperY - gumH * 0.5 - toothH * 0.10
        : lowerY + gumH * 0.5 + toothH * 0.10, z);
      if (top) t.rotation.x = Math.PI;
      t.name = top ? "sharkUpperTooth" : "sharkLowerTooth";
      parent.add(t);
      if (top) upperTeeth++; else lowerTeeth++;
    }
    const toothCount = sideCount * 2 + frontCount;
    for (let i = 0; i < toothCount; i++) {
      const t = toothCount === 1 ? 0.5 : i / (toothCount - 1);
      const a = -Math.PI * 0.43 + t * Math.PI * 0.86;
      const x = len * (0.18 + 0.82 * Math.cos(a));
      const z = width * 0.44 * Math.sin(a);
      toothPair(upper, x, z, true);
      toothPair(lower, x + len * 0.018, z, false);
    }

    const contract = {
      version: 2,
      shape: "arched-underside",
      hinge: { x: hingeX, y: hingeY, z: 0 },
      bite: { x: hingeX + len * 0.96, y: hingeY, z: 0 },
      maxOpen: o.maxOpen || 0.58,
      travel: (o.maxOpen || 0.58) + restClose,
      restClose: restClose,
      protrude: o.protrude == null ? len * 0.075 : o.protrude,
      upperDrop: o.upperDrop == null ? gap * 0.08 : o.upperDrop,
      upperTeeth: upperTeeth,
      lowerTeeth: lowerTeeth,
    };
    // userData stays JSON-safe for clone/export; live Object3D references do not.
    g.userData.aquaticMouth = contract;
    g._aquaticMouth = { lower: lower, upper: upper, cavity: cavity, contract: contract };
    return g._aquaticMouth;
  }

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
      const grey = m(0x6b7880), white = m(0xe8ebec);
      // One continuous countershaded hull: max girth at the pectoral line, the
      // forehead flowing into a broad, FLATTENED, blunt rostrum. The rostrum
      // rings ride high (small ry, raised y) so the mouth hangs BELOW the
      // underside of the snout instead of hiding inside it.
      addSharkHull(g, T, {
        top: grey, belly: white, sides: 14, bellyCut: -0.30,
        rings: [
          { x: -1.55, y: 0.86, ry: 0.22, rz: 0.15 },
          { x: -0.85, y: 0.85, ry: 0.44, rz: 0.32 },
          { x: 0.15, y: 0.85, ry: 0.60, rz: 0.47 },
          { x: 1.05, y: 0.87, ry: 0.56, rz: 0.45 },
          { x: 1.80, y: 0.92, ry: 0.44, rz: 0.40 },
          { x: 2.30, y: 1.00, ry: 0.24, rz: 0.30 },
          { x: 2.60, y: 1.02, ry: 0.12, rz: 0.19 },
        ],
      });
      // subterminal mouth tucked up under the rostrum overhang
      addSharkMouth(g, T, m, {
        hingeX: 1.90, hingeY: 0.72, length: 0.60, width: 0.64, gap: 0.28,
        toothHeight: 0.13, maxOpen: 0.62, skin: 0xe8ebec, upperSkin: 0x6b7880,
      });
      addSharkFaceDetails(g, T, m, {
        eyeX: 2.16, eyeY: 1.00, eyeZ: 0.31, eyeSize: 0.05,
        noseX: 2.50, noseY: 0.92, noseZ: 0.12,
        gillX: 1.62, gillY: 0.90, gillZ: 0.405, gills: 5,
        gillHeight: 0.30, gillStep: 0.095, gillDepth: 0.06, gillZStep: 0.012,
      });
      // big triangular first dorsal — a flattened blade, not a pyramid
      const dorsal = new T.Mesh(new T.ConeGeometry(0.5, 1.15, 4), grey);
      dorsal.position.set(0.1, 1.75, 0); dorsal.scale.z = 0.22; dorsal.rotation.z = 0.14; g.add(dorsal);
      const dorsal2 = new T.Mesh(new T.ConeGeometry(0.18, 0.35, 4), grey);
      dorsal2.position.set(-1.3, 1.32, 0); dorsal2.scale.z = 0.3; g.add(dorsal2);
      // crescent vertical tail at -X, thin blades
      const peduncle = box(0.5, 0.44, 0.26, grey); peduncle.position.set(-1.7, 0.85, 0); g.add(peduncle);
      const tailUp = box(0.30, 1.2, 0.14, grey); tailUp.position.set(-2.05, 1.35, 0); tailUp.rotation.z = 0.35; g.add(tailUp);
      const tailDn = box(0.26, 0.7, 0.13, grey); tailDn.position.set(-2.0, 0.45, 0); tailDn.rotation.z = -0.3; g.add(tailDn);
      // broad swept pectoral fins
      [0.6, -0.6].forEach(function (z) {
        const f = box(0.95, 0.09, 0.5, grey); f.position.set(0.95, 0.48, z); f.rotation.y = (z > 0 ? -0.62 : 0.62); f.rotation.x = (z > 0 ? 0.22 : -0.22); g.add(f);
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
      const dark = m(0x4a5560), white = m(0xdfe4e6);
      // Colossal continuous hull. Heavier proportions than the great white:
      // girth carried far forward, and the rostrum stays BROAD right to the
      // blunt tip (a megalodon head is a battering ram, not a point).
      addSharkHull(g, T, {
        top: dark, belly: white, sides: 14, bellyCut: -0.30,
        rings: [
          { x: -2.05, y: 0.98, ry: 0.34, rz: 0.24 },
          { x: -1.10, y: 0.95, ry: 0.72, rz: 0.55 },
          { x: 0.20, y: 0.95, ry: 0.98, rz: 0.80 },
          { x: 1.50, y: 0.98, ry: 0.92, rz: 0.76 },
          { x: 2.60, y: 1.05, ry: 0.72, rz: 0.64 },
          { x: 3.40, y: 1.18, ry: 0.36, rz: 0.48 },
          { x: 3.85, y: 1.20, ry: 0.18, rz: 0.32 },
        ],
      });
      // enormous subterminal jaws tucked up under the rostrum overhang
      addSharkMouth(g, T, m, {
        hingeX: 2.70, hingeY: 0.82, length: 1.02, width: 1.16, gap: 0.54,
        toothHeight: 0.28, toothRadius: 0.095,
        sideTeeth: 6, frontTeeth: 7, maxOpen: 0.60, skin: 0xdfe4e6, upperSkin: 0x4a5560,
      });
      addSharkFaceDetails(g, T, m, {
        eyeX: 3.30, eyeY: 1.20, eyeZ: 0.49, eyeSize: 0.075,
        noseX: 3.74, noseY: 1.10, noseZ: 0.18, nostrilSize: 0.05,
        gillX: 2.30, gillY: 0.98, gillZ: 0.69, gills: 5,
        gillHeight: 0.52, gillStep: 0.15, gillDepth: 0.07, gillWidth: 0.05, gillZStep: 0.017,
      });
      // towering dorsal fin — a flattened blade, not a pyramid
      const dorsal = new T.Mesh(new T.ConeGeometry(0.75, 1.9, 4), dark);
      dorsal.position.set(0.1, 2.55, 0); dorsal.scale.z = 0.22; dorsal.rotation.z = 0.14; g.add(dorsal);
      const dorsal2 = new T.Mesh(new T.ConeGeometry(0.28, 0.55, 4), dark);
      dorsal2.position.set(-1.9, 1.68, 0); dorsal2.scale.z = 0.3; g.add(dorsal2);
      // huge crescent vertical tail at -X, thin blades
      const pedun = box(0.8, 0.72, 0.4, dark); pedun.position.set(-2.4, 0.95, 0); g.add(pedun);
      const tailUp = box(0.48, 2.0, 0.24, dark); tailUp.position.set(-2.95, 1.75, 0); tailUp.rotation.z = 0.35; g.add(tailUp);
      const tailDn = box(0.42, 1.2, 0.22, dark); tailDn.position.set(-2.85, 0.35, 0); tailDn.rotation.z = -0.3; g.add(tailDn);
      // massive swept pectoral fins
      [0.9, -0.9].forEach(function (z) {
        const f = box(1.6, 0.14, 0.85, dark); f.position.set(1.35, 0.45, z); f.rotation.y = (z > 0 ? -0.6 : 0.6); f.rotation.x = (z > 0 ? 0.25 : -0.25); g.add(f);
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
        const tailward = i >= 3;
        const f = box(0.07, 0.09, 0.05, finlet); f.position.set(-0.72 - i * 0.16, tailward ? 0.94 : 1.18 - i * 0.03, 0); g.add(f);
        const fv = box(0.07, 0.09, 0.05, finlet); fv.position.set(-0.72 - i * 0.16, tailward ? 0.56 : 0.33 + i * 0.03, 0); g.add(fv);
      }
      // long sickle pectorals
      [0.38, -0.38].forEach(function (z) {
        const f = box(0.86, 0.08, 0.24, back); f.position.set(0.72, 0.62, z);
        f.rotation.y = (z > 0 ? -0.42 : 0.42); f.rotation.z = -0.24; g.add(f);
      });
      // thin keeled peduncle + a rigid crescent tail
      const ped = box(0.8, 0.4, 0.16, flank); ped.position.set(-1.36, 0.75, 0); g.add(ped);
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
      const ped = box(0.9, 0.26, 0.16, flank); ped.position.set(-1.65, 0.85, 0); g.add(ped);
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
      const grey = m(0x7d8a8f), pale = m(0xe3e7e6), eye = m(0x0f1215);
      // slimmer continuous hull that narrows into the neck of the cephalofoil
      addSharkHull(g, T, {
        top: grey, belly: pale, sides: 14, bellyCut: -0.30,
        rings: [
          { x: -1.50, y: 0.90, ry: 0.20, rz: 0.14 },
          { x: -0.75, y: 0.90, ry: 0.42, rz: 0.30 },
          { x: 0.20, y: 0.90, ry: 0.52, rz: 0.38 },
          { x: 1.00, y: 0.92, ry: 0.44, rz: 0.33 },
          { x: 1.70, y: 0.94, ry: 0.28, rz: 0.24 },
        ],
      });
      // THE CEPHALOFOIL: a wide flat bar athwart the body, eyes at the tips
      const foil = box(0.62, 0.30, 2.55, grey); foil.position.set(1.92, 0.94, 0); g.add(foil);
      const foilU = box(0.58, 0.10, 2.45, pale); foilU.position.set(1.92, 0.77, 0); g.add(foilU);
      [1.24, -1.24].forEach(function (z) {
        const e = new T.Mesh(new T.SphereGeometry(0.11, 7, 5), eye);
        e.name = "sharkEye"; e.position.set(2.02, 0.94, z); g.add(e);
      });
      addSharkFaceDetails(g, T, m, {
        eyeSize: 0, eyeX: 0, eyeY: 0, eyeZ: 0,
        noseX: 2.16, noseY: 0.84, noseZ: 0.85, nostrilSize: 0.045,
        gillX: 1.36, gillY: 0.92, gillZ: 0.30, gills: 5,
        gillHeight: 0.26, gillStep: 0.085, gillDepth: 0.06, gillZStep: 0.012,
      });
      // The mouth stays small and well back beneath the cephalofoil, but it is
      // the same physically hinged anatomy as every other authored shark.
      addSharkMouth(g, T, m, {
        hingeX: 1.42, hingeY: 0.65, length: 0.52, width: 0.62, gap: 0.23,
        toothHeight: 0.105, sideTeeth: 4, frontTeeth: 5,
        maxOpen: 0.50, skin: 0xe3e7e6, upperSkin: 0x7d8a8f,
      });
      // the scythe dorsal — taller and thinner than a great white's
      const dorsal = new T.Mesh(new T.ConeGeometry(0.34, 1.55, 4), grey);
      dorsal.position.set(0.20, 1.98, 0); dorsal.rotation.z = 0.18; dorsal.scale.z = 0.24; g.add(dorsal);
      const d2 = new T.Mesh(new T.ConeGeometry(0.14, 0.32, 4), grey);
      d2.position.set(-1.32, 1.30, 0); d2.scale.z = 0.3; g.add(d2);
      const ped = box(0.46, 0.40, 0.22, grey); ped.position.set(-1.70, 0.90, 0); g.add(ped);
      const tu2 = box(0.26, 1.30, 0.13, grey); tu2.position.set(-2.10, 1.46, 0); tu2.rotation.z = 0.34; g.add(tu2);
      const td2 = box(0.22, 0.62, 0.12, grey); td2.position.set(-2.02, 0.50, 0); td2.rotation.z = -0.30; g.add(td2);
      [0.56, -0.56].forEach(function (z) {
        const f = box(0.92, 0.09, 0.46, grey); f.position.set(0.86, 0.52, z);
        f.rotation.y = (z > 0 ? -0.56 : 0.56); f.rotation.x = (z > 0 ? 0.20 : -0.20); g.add(f);
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
      const grey = m(0x7f8a90), white = m(0xeceeee);
      // STOCKY continuous hull: deeper and shorter than a great white at the
      // same length, and the rostrum stays wide right to the tip — the blunt
      // rounded snout IS the field mark.
      addSharkHull(g, T, {
        top: grey, belly: white, sides: 14, bellyCut: -0.30,
        rings: [
          { x: -1.30, y: 0.88, ry: 0.22, rz: 0.16 },
          { x: -0.65, y: 0.87, ry: 0.48, rz: 0.38 },
          { x: 0.10, y: 0.88, ry: 0.62, rz: 0.50 },
          { x: 0.90, y: 0.90, ry: 0.56, rz: 0.47 },
          { x: 1.55, y: 0.96, ry: 0.40, rz: 0.40 },
          { x: 1.95, y: 1.02, ry: 0.22, rz: 0.30 },
          { x: 2.16, y: 1.02, ry: 0.13, rz: 0.23 },
        ],
      });
      addSharkMouth(g, T, m, {
        hingeX: 1.58, hingeY: 0.68, length: 0.55, width: 0.62, gap: 0.28,
        toothHeight: 0.13, sideTeeth: 5, frontTeeth: 5,
        maxOpen: 0.57, skin: 0xeceeee, upperSkin: 0x7f8a90,
      });
      addSharkFaceDetails(g, T, m, {
        eyeX: 1.80, eyeY: 1.04, eyeZ: 0.32, eyeSize: 0.048,
        noseX: 2.08, noseY: 0.94, noseZ: 0.10,
        gillX: 1.30, gillY: 0.90, gillZ: 0.44, gills: 5,
        gillHeight: 0.28, gillStep: 0.085, gillDepth: 0.06, gillZStep: 0.012,
      });
      const dorsal = new T.Mesh(new T.ConeGeometry(0.46, 0.95, 4), grey);
      dorsal.position.set(0.15, 1.62, 0); dorsal.scale.z = 0.24; dorsal.rotation.z = 0.13; g.add(dorsal);
      const d2 = new T.Mesh(new T.ConeGeometry(0.15, 0.30, 4), grey);
      d2.position.set(-1.05, 1.28, 0); d2.scale.z = 0.3; g.add(d2);
      const ped = box(0.44, 0.40, 0.24, grey); ped.position.set(-1.34, 0.88, 0); g.add(ped);
      const tu2 = box(0.26, 1.00, 0.13, grey); tu2.position.set(-1.66, 1.32, 0); tu2.rotation.z = 0.34; g.add(tu2);
      const td2 = box(0.22, 0.58, 0.12, grey); td2.position.set(-1.60, 0.48, 0); td2.rotation.z = -0.30; g.add(td2);
      [0.56, -0.56].forEach(function (z) {
        const f = box(0.80, 0.09, 0.44, grey); f.position.set(0.76, 0.48, z);
        f.rotation.y = (z > 0 ? -0.58 : 0.58); f.rotation.x = (z > 0 ? 0.20 : -0.20); g.add(f);
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
      const tail = box(0.24, 0.12, 0.12, skin); tail.position.set(-0.8, 0.44, 0); g.add(tail);
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
        const w3 = box(0.45, 0.09, 0.62, dark); w3.position.set(-0.62, 0.54, s2 * 2.5); w3.rotation.x = s2 * -0.26; g.add(w3);
        // gill slits, on the pale underside
        for (let i = 0; i < 4; i++) { const gs = box(0.06, 0.04, 0.26, m(0x171b1f)); gs.position.set(0.30 - i * 0.16, 0.39, s2 * 0.42); g.add(gs); }
      });
      // head bar + the two rolled cephalic lobes ("horns") + wide mouth
      const head = box(0.42, 0.30, 1.15, dark); head.position.set(0.92, 0.60, 0); g.add(head);
      const mouth = box(0.24, 0.14, 0.95, m(0x101317)); mouth.position.set(1.06, 0.50, 0); g.add(mouth);
      [0.52, -0.52].forEach(function (z) {
        const lobe = box(0.46, 0.16, 0.16, dark); lobe.position.set(1.28, 0.58, z); lobe.rotation.y = (z > 0 ? -0.22 : 0.22); g.add(lobe);
        const e = box(0.08, 0.09, 0.08, eye); e.position.set(1.00, 0.62, z * 1.18); g.add(e);
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
