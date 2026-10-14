/* lab kit "hurricane": a small coast town in the path of a real
   systems/hurricane.js storm, at a chosen Saffir-Simpson category.

   lab.html?kit=hurricane&cat=3&offset=0&bearing=180
     cat      1..5 (fractional allowed) — vmax, gusts, eye, surge all follow it
     offset   the track's perpendicular offset from the town centre, m
              (0 = the eye passes over the observer)
     bearing  the storm's heading in degrees (180 = from the sea, due -x)
     style    the buildings' facade grammar (default brick)

   THE TOWN (everything the storm reads comes through its WORLD CONTRACT, the
   same one the island's def hands it — nothing here is a hurricane special):
     ground   a coastal profile: a town plateau rising gently inland (0.8 m at
              the back of the beach, ~4 m 60 m inland), a beach falling into
              the sea on +x; the sea rests at -0.6 m and rises with the surge
     buildings three REAL city shells (cityFitShell + cityMakeBuilding, the
              building ingredient), two on the waterfront, one inland
     trees    coconut palms on the beach and broadleaf trees inland, built
              from the game's own vegetation kit (world/vegetation.js palm,
              world/treeaudit.js trunk + leaf-card crown) in the arena's
              tree-record shape
     cars     real cars (city/vehicles.js cityMakeCar), parked: two at the
              harbour, three in town
     boats    real dinghies (world/water_hulls.js) moored off the pier
     signs    three street signs (post + panel)
     lamps    six street lamps; their lens material is put on the power grid
     pier     a timber deck out from the beach: the harbour the surf slams

   The observer stands at the town centre; the storm's gust cadence is the
   def's (1.0-2.6 s, faster at cat 4+).

   probe(): surge peak, the camera's sequence of phases (outer bands >
   eyewall > eye > back eyewall), wind reversal, trees bent/down, palms
   topped, roofs peeling/stripped, sheets, windows, debris launched / still
   flying / at rest, signs down, districts dark, boats loose/beached, cars
   rocking/shoved/floated, and the FRAME COST of the storm's tick (mean and
   worst ms per 1/60 s frame, the town included). */
(function () {
"use strict";
const KIT_R = 70;
function groundAt(x, z) {
  void z;
  // plateau rising inland, beach falling to the sea on +x
  const g = x <= 30 ? 0.8 + (30 - x) * 0.035 : 0.8 - (x - 30) * 0.13;
  return Math.max(-6, g);
}
const SEA_REST = -0.6;

CBZ.lab.kit("hurricane", {
  about: "a coast town (real shells, palms + broadleaf, cars, dinghies, signs, lamps, a pier) under a systems/hurricane.js storm at cat N; probe reports surge, damage tally and frame cost",
  uses: ["building"],
  files: ["src/systems/hurricane.js", "src/world/treeaudit.js", "src/world/vegetation.js",
    "src/world/carfx.js", "src/city/economy.js", "src/city/carbody.js", "src/city/carwheels.js", "src/city/carparts.js",
    "src/city/playercars.js", "src/city/vehicles.js", "src/world/hull_loft.js", "src/world/water_hulls.js"],
  depth: 0,
  params: { cat: 3, offset: 0, bearing: 180, style: "brick" },
  duration: 52,
  setup: function (W, P) {
    const THREE = window.THREE;
    const cat = Math.max(1, Math.min(5, +P.cat || 3));
    if (CBZ.labWorld && CBZ.labWorld.floor) CBZ.labWorld.floor.visible = false;
    const root = new THREE.Group(); root.name = "hurricaneTown"; W.scene.add(root);
    const T = W.town = { root: root, trees: [], buildings: [], cars: [], boats: [], signs: [], lampMats: [], panes: 0, ledger: 0, actors: [], hits: 0, crushed: 0, released: 0 };

    // ---- ground + sea --------------------------------------------------------
    {
      const g = new THREE.PlaneGeometry(260, 200, 130, 4);
      g.rotateX(-Math.PI / 2);
      const p = g.attributes.position, col = new Float32Array(p.count * 3);
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = groundAt(x, p.getZ(i));
        p.setY(i, y);
        const sand = x > 26 ? Math.min(1, (x - 26) / 6) : 0;
        col[i * 3] = 0.24 + 0.42 * sand; col[i * 3 + 1] = 0.36 + 0.24 * sand; col[i * 3 + 2] = 0.16 + 0.3 * sand;
      }
      g.setAttribute("color", new THREE.BufferAttribute(col, 3));
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true }));
      m.receiveShadow = true; m.name = "labCoast";
      root.add(m);
      const sea = new THREE.Mesh(new THREE.PlaneGeometry(400, 260).rotateX(-Math.PI / 2),
        new THREE.MeshLambertMaterial({ color: 0x1d5a72, transparent: true, opacity: 0.88 }));
      sea.position.set(60, SEA_REST, 0); sea.name = "labSea";
      root.add(sea);
      T.sea = sea;
    }

    // ---- buildings (real city shells) ---------------------------------------
    const lots = [[16, -16, 3], [16, 16, 2], [-18, 0, 3]];
    lots.forEach(function (L, i) {
      const lot = { x0: L[0] - 7, x1: L[0] + 7, z0: L[1] - 6, z1: L[1] + 6 };
      const h = W.add("building", { name: "b" + i, lot: lot, style: P.style && P.style !== "none" ? P.style : null, storeys: L[2], doorSide: 2 });
      const gy = groundAt(L[0] + 7, L[1]) - 0.05;          // set on its low side
      h.root.position.y = gy;
      const b = h.b;
      const w = h.fit.w, d = h.fit.d, hh = b.h || L[2] * 3.2;
      T.buildings.push({ x: L[0], z: L[1], w: w, d: d, h: hh, gy: gy, group: h.root, roofY: gy + hh, rec: b, panes: 0, _dmg: 0 });
    });

    // ---- trees: the game's own palm + broadleaf -------------------------------
    const VK = CBZ.vegetationKit;
    const wood = VK ? VK.material("wood") : new THREE.MeshLambertMaterial({ color: 0x6e5a48 });
    const leaf = VK ? VK.material("foliage") : new THREE.MeshLambertMaterial({ color: 0x3b7a2a });
    const frond = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true, side: THREE.DoubleSide });
    frond.name = "survival-palm-frond";
    const own = function (base, hex) { const m = base.clone(); if (m.color) m.color.setHex(hex); return m; };
    function palm(x, z, H, v) {
      const gy = groundAt(x, z);
      const tg = VK.palmTrunk(v);
      const trunk = new THREE.Mesh(tg, own(wood, 0x8a7a66));
      const sy = H + 0.3, yaw = (x * 0.37 + z * 0.11) % 6.28;
      trunk.position.set(x, gy - 0.3, z); trunk.scale.set(1, sy, 1); trunk.rotation.y = yaw; trunk.castShadow = true;
      root.add(trunk);
      const tp = tg.userData.top, bx = tp.x * sy;
      const foliage = new THREE.Mesh(VK.palmCrown(v), own(frond, 0x234c12));
      foliage.position.set(x + bx * Math.cos(yaw), gy - 0.3 + sy * tp.y - 0.05, z - bx * Math.sin(yaw));
      foliage.rotation.y = (x * 0.91) % 6.28; foliage.castShadow = true;
      root.add(foliage);
      T.trees.push({ x: x, z: z, trunk: trunk, foliage: foliage, trunkCol: null, palm: true, leafHex: 0x234c12, barkHex: 0x8a7a66 });
    }
    function broad(x, z, th) {
      const gy = groundAt(x, z);
      const tg = CBZ.treeTrunkGeo ? CBZ.treeTrunkGeo({ rTop: 0.12, rBase: 0.22, h: 1, seg: 7, roots: 4, spread: 2.3, flare: 1.5, site: "island", uvRepeat: 1.4 })
        : new THREE.CylinderGeometry(0.12, 0.22, 1, 7).translate(0, 0.5, 0);
      const trunk = new THREE.Mesh(tg, own(wood, 0x6e5a48));
      const top = gy + th;
      trunk.position.set(x, gy, z); trunk.scale.set(1.15, top + 0.9 - gy, 1.15); trunk.castShadow = true;
      root.add(trunk);
      let cg = CBZ.treeCrownGeo ? CBZ.treeCrownGeo({ tiers: 2, r: 2.3, h: 2.8, n: 4, cards: 12, site: "island", leaf: true, seed: 11 }) : new THREE.IcosahedronGeometry(2.2, 1);
      cg = cg.clone(); cg.computeBoundingBox();
      cg.translate(0, -(cg.boundingBox.min.y + cg.boundingBox.max.y) / 2, 0);
      const foliage = new THREE.Mesh(cg, own(leaf, 0x3b7a2a));
      foliage.position.set(x, top + 1.25, z); foliage.castShadow = true;
      root.add(foliage);
      T.trees.push({ x: x, z: z, trunk: trunk, foliage: foliage, trunkCol: null, palm: false, leafHex: 0x3b7a2a, barkHex: 0x6e5a48 });
    }
    if (VK) for (let i = 0; i < 10; i++) palm(30 + (i % 3) * 3.2, -30 + i * 6.4, 6.5 + (i % 4) * 0.8, i % 3);
    for (let i = 0; i < 9; i++) broad(-40 + (i % 3) * 14 + (i * 7 % 5), -28 + ((i / 3) | 0) * 26, 2.4 + (i % 3) * 0.6);

    // ---- cars: real, parked ---------------------------------------------------
    if (CBZ.cityMakeCar) {
      const city = CBZ.city || (CBZ.city = {});
      if (!city.arena) city.arena = { root: root, roads: [], lab: true };
      const spots = [[34, -6, 0.2], [34, 6, 3.3], [4, -6, 1.57], [4, 6, 1.57], [-30, -10, 0]];
      spots.forEach(function (s) {
        const car = CBZ.cityMakeCar(s[0], s[1], s[2], false, null, 0.3);
        car.ai = false;
        const gy = groundAt(s[0], s[1]);
        car.group.position.y = gy;
        const col = { minX: s[0] - 1, maxX: s[0] + 1, minZ: s[1] - 2.3, maxZ: s[1] + 2.3, lab: true };
        T.cars.push({ x: s[0], z: s[1], group: car.group, collider: col, flung: false, rotY: s[2], oy: gy, rec: car });
      });
    }

    // ---- the pier + moored dinghies -----------------------------------------
    {
      const deckY = SEA_REST + 1.6;
      const pier = new THREE.Mesh(new THREE.BoxGeometry(20, 0.3, 3), new THREE.MeshLambertMaterial({ color: 0x7a6a58 }));
      pier.position.set(46, deckY, 0); root.add(pier);
      T.harbour = [{ x: 55, z: 0 }, { x: 46, z: 0 }];
      if (CBZ.marineHulls && CBZ.marineHulls.buildable && CBZ.marineHulls.buildable("dinghy")) {
        [[52, -6], [54, 5], [58, -3]].forEach(function (s, i) {
          let g = null;
          try { g = CBZ.marineHulls.build("dinghy"); } catch (e) { g = null; }
          if (!g) return;
          g.position.set(s[0], SEA_REST - 0.2, s[1]); g.rotation.y = i * 1.1;
          root.add(g);
          T.boats.push({ group: g, x: s[0], z: s[1], yaw: g.rotation.y, len: 4.5, draft: 0.4 });
        });
      }
    }

    // ---- signs + lamps --------------------------------------------------------
    const postMat = new THREE.MeshLambertMaterial({ color: 0x8a8f94 });
    [[24, -4, 0x2d6b3c], [0, 14, 0x1f4f8a], [-6, -14, 0xb8b0a0]].forEach(function (s) {
      const gy = groundAt(s[0], s[1]);
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.4, 6), postMat);
      post.position.set(s[0], gy + 1.2, s[1]); root.add(post);
      const pivot = new THREE.Group(); pivot.position.set(s[0], gy + 2.0, s[1]); root.add(pivot);
      const panel = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.8, 0.05), new THREE.MeshLambertMaterial({ color: s[2] }));
      panel.position.y = 0.4; pivot.add(panel);
      T.signs.push({ x: s[0], z: s[1], y: gy + 2.4, w: 1.2, h: 0.8, mesh: pivot, hex: s[2] });
    });
    const lensMat = new THREE.MeshBasicMaterial({ color: 0xfff0c8 });
    lensMat.name = "lab-lamp-lens";
    T.lampMats.push(lensMat);
    [[20, 0], [0, -20], [0, 20], [-25, -20], [-25, 20], [32, 20]].forEach(function (s) {
      const gy = groundAt(s[0], s[1]);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 6, 6), postMat);
      pole.position.set(s[0], gy + 3, s[1]); root.add(pole);
      const lens = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08, 0.3), lensMat);
      lens.position.set(s[0], gy + 6, s[1]); lens.name = "lab-lamp-lens"; root.add(lens);
    });
    // people standing in the open (positions only: what the debris can hit)
    for (let i = 0; i < 6; i++) T.actors.push({ pos: new THREE.Vector3(-10 + i * 6, 0, (i % 2 ? 8 : -8)), dead: false, hits: 0 });
    T.actors.forEach(function (a) { a.pos.y = groundAt(a.pos.x, a.pos.z); });

    // ---- the world the storm reads ------------------------------------------
    T.world = {
      cx: 0, cz: 0, R: KIT_R, root: root,
      groundAt: groundAt, seaRest: SEA_REST,
      trees: function () { return T.trees; },
      buildings: function () { return T.buildings; },
      cars: function () { return T.cars; },
      boats: function () { return T.boats; },
      signs: function () { return T.signs; },
      harbour: function () { return T.harbour; },
      powerMaterials: function () { return T.lampMats; },
      // the lab's stand-in for the island's shatterGlass: the building's REAL
      // glass records (CBZ.cityGlassRecs) inside r of the point, counted once
      shatter: function (x, z, r) {
        const G = CBZ.cityGlassRecs || [];
        let n = 0;
        for (let i = 0; i < G.length; i++) {
          const gp = G[i]; if (gp._hurBlown) continue;
          if ((gp.x - x) * (gp.x - x) + (gp.z - z) * (gp.z - z) <= r * r) { gp._hurBlown = 1; n++; }
        }
        T.panes += n;
        return n;
      },
      structure: function (b, amount) { b._dmg = (b._dmg || 0) + amount; T.ledger += amount; },
      release: function (c) { void c; T.released++; },
      actors: function (fn) { T.actors.forEach(fn); },
      hit: function (a) { a.hits++; T.hits++; },
      hurtLine: function (x0, z0, x1, z1, w) {
        const dx = x1 - x0, dz = z1 - z0, L2 = dx * dx + dz * dz || 1;
        T.actors.forEach(function (a) {
          const u = Math.max(0, Math.min(1, ((a.pos.x - x0) * dx + (a.pos.z - z0) * dz) / L2));
          const ex = a.pos.x - (x0 + dx * u), ez = a.pos.z - (z0 + dz * u);
          if (ex * ex + ez * ez <= w * w) T.crushed++;
        });
      },
    };

    // ---- the storm: the def's own numbers ------------------------------------
    const warn = 5, active = Math.round(19 + 3.2 * cat);
    T.cat = cat; T.dur = warn + active;
    CBZ.hurricane.begin({
      cx: 0, cz: 0, R: KIT_R, catF: cat, duration: T.dur,
      bearing: (+P.bearing || 0) * Math.PI / 180, offset: +P.offset || 0, world: T.world,
    });
    T.gustCd = 2; T.camX = 0; T.camZ = 0;
    T.tick = { n: 0, sum: 0, max: 0 };
    T.windPeak = 0;
    W.every(function (dt) {
      const H = CBZ.hurricane;
      if (!H.active()) return;
      if (W.t() > T.dur + 1) { H.end(); W.event("storm", "passed"); return; }
      // the def's gust cadence
      T.gustCd -= dt;
      if (T.gustCd <= 0) {
        T.gustCd = (1.0 + Math.random() * 1.6) * (cat >= 4 ? 0.75 : 1);
        H.gustBurst(0.2 + 0.06 * cat + Math.random() * 0.2);
        H.count("gusts", 1);
      }
      const t0 = performance.now();
      H.tick(dt, T.camX, T.camZ);
      const ms = performance.now() - t0;
      T.tick.n++; T.tick.sum += ms; if (ms > T.tick.max) T.tick.max = ms;
      const s = H.state();
      if (s) T.sea.position.y = SEA_REST + s.surge;
      const w = H.windAt(T.camX, T.camZ);
      if (w.speed > T.windPeak) T.windPeak = w.speed;
    });
    W.watch("storm", "phase", function () { return CBZ.hurricane.active() ? CBZ.hurricane.cameraPhase(T.camX, T.camZ) : "gone"; });
    W.watch("town", "trees down", function () { const t = CBZ.hurricane.town(); return t.treesDown ? t.treesDown + " down" : null; });
    W.watch("town", "districts dark", function () { const t = CBZ.hurricane.town(); return t.districtsOut ? t.districtsOut + " dark" : null; });
  },
  frame: function (W) { return [W.town.root]; },
  probe: function (W) {
    const T = W.town, A = CBZ.hurricaneAudit(), t = A.town;
    const r1 = function (v) { return Math.round(v * 10) / 10; };
    const mean = T.tick.n ? T.tick.sum / T.tick.n : 0;
    const nBroad = T.trees.filter(function (x) { return !x.palm; }).length, nPalm = T.trees.length - nBroad;
    const data = {
      category: T.cat, vmax: A.vmax, peakWindAtObserver: r1(T.windPeak),
      surgePeak: A.surgePeak, phases: A.camPhases, phaseSecs: A.camPhaseSecs, windReversed: A.windReversed, eyeCalmMin: A.eyeCalmMin,
      trees: { broadleaf: nBroad, palms: nPalm, bent: t.treesBent, down: t.treesDown, palmsTopped: t.palmsTopped, fronds: t.frondsStripped, branches: t.branchesStripped },
      roofs: { buildings: T.buildings.length, peeling: t.roofsPeeling, stripped: t.roofsStripped, sheets: t.roofSheets, frameLoad: t.frameLoad,
        ledger: T.buildings.map(function (b) { return r1(b._dmg * 100) / 100; }) },
      windows: { faces: t.facesBlown, panes: t.windowsBlown },
      debris: { launched: t.debrisLaunched, flying: t.debrisFlying, resting: t.debrisResting, hitsOnPeople: t.debrisHits, crushedByTrees: T.crushed },
      signs: { total: T.signs.length, down: t.signsDown },
      power: { districts: t.districts, dark: t.districtsOut, lampMaterialsOnGrid: A.powerPatched },
      boats: { total: T.boats.length, loose: t.boatsLoose, beached: t.boatsBeached },
      cars: { total: T.cars.length, rockingPeak: t.carsRocking, shoved: t.carsPushed, floated: t.carsFloated, flipped: A.carsFlung },
      surf: { bursts: t.surfBursts, harbour: t.harbourBursts },
      frameCost: { meanMs: +mean.toFixed(3), worstMs: +T.tick.max.toFixed(3), frames: T.tick.n, auditMeanMs: A.tickMs },
    };
    const seq = A.camPhases || "";
    const sawEye = /eyewall>eye>back-eyewall/.test(seq);
    const ok = A.surgePeak > 0 && t.treesBent > 0 && (T.cat < 3 || (sawEye && A.windReversed === 1));
    const summary = "cat " + T.cat + " (vmax " + A.vmax + " m/s, peak at observer " + r1(T.windPeak) + "): surge " + A.surgePeak + " m; " +
      "sequence " + seq + (A.windReversed ? " (wind reversed)" : "") + "; trees bent " + t.treesBent + "/" + T.trees.length +
      ", down " + t.treesDown + "/" + nBroad + ", palms topped " + t.palmsTopped + "/" + nPalm + "; roofs peeling " + t.roofsPeeling + "/" + T.buildings.length +
      " (stripped " + t.roofsStripped + ", " + t.roofSheets + " sheets), windows " + t.windowsBlown + " panes on " + t.facesBlown + " faces; debris " + t.debrisLaunched +
      " launched (" + t.debrisFlying + " flying, " + t.debrisResting + " down); signs " + t.signsDown + "/" + T.signs.length + "; districts dark " + t.districtsOut + "/" + t.districts +
      "; boats loose " + t.boatsLoose + "/" + T.boats.length + " (beached " + t.boatsBeached + "); cars shoved " + t.carsPushed + ", floated " + t.carsFloated + "/" + T.cars.length +
      "; storm tick " + mean.toFixed(3) + " ms mean, " + T.tick.max.toFixed(2) + " ms worst";
    return { ok: ok, summary: summary, data: data };
  },
});
})();
