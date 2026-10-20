/* lab kit "wildfire": systems/wildfire.js alone on a hillside.

   THE WORLD (all in this file; the island is another agent's and is not
   loaded): a 220 x 180 m grass field, flat in the west, then a RAMP rising
   east at `slope` degrees for 80 m, then a flat top. A grove of real island
   trees (world/treeaudit.js crowns + world/vegetation.js materials) on and
   below the ramp, two real Gang City houses (city/buildings.js through the
   "building" ingredient) on the flat downwind, two real cars beside them.
   The wind blows to +z (north) at `wind` m/s, ACROSS the slope, so the east
   (uphill) and west (downhill) flanks see the same wind and differ only by
   the slope. The fire is lit on the middle of the ramp.

   The run is the def's: 3 s warn (the seed creeps on the slowed clock),
   `active` s of fire, stop() (the bed starves), then `after` s while the
   houses and cars burn on.

   STAND-INS (the bridge the island's def lends, here the lab's):
     hitBuilding   the structural ledger: _dmg accrues, at 1 the house is
                   marked fallen and hidden (on the island this is
                   disasters.js structureHit -> city/collapse.js)
     blast         a car's tank: counted, no survival roster to hurt

   params: slope (deg, 20), wind (m/s, 6), mag (0..1, 0.5), active (s, 30),
           after (s, 12), trees (count, 46), storeys (2), seed
   probe: spread up vs down the slope (m reached, m/s), head and back rate,
          spot fires, houses caught/how/collapsed, cars burnt/exploded, the
          frame cost (the fire's own sim + fx ms per frame, avg and worst). */
CBZ.lab.kit("wildfire", {
  about: "grass + trees on a slope, two houses and two cars, wind across the slope; the real wildfire runs and the probe reports spread up/down slope, spotting, houses, cars and frame cost",
  uses: ["building", "car"],
  files: ["src/world/treeaudit.js", "src/world/vegetation.js", "src/systems/wildfire.js"],
  params: { slope: 20, wind: 6, mag: 0.5, active: 30, after: 12, trees: 46, storeys: 2 },
  duration: 45,
  setup: function (W, P) {
    const THREE = window.THREE;
    const L = CBZ.lab;
    if (L.floor) L.floor.visible = false;
    const slope = (+P.slope || 0) * Math.PI / 180, tanS = Math.tan(slope);
    const RX0 = -10, RX1 = 70, ZB0 = -8, ZB1 = 12;    // the ramp, and where it eases out
    // the ramp runs the south half; it eases out to a flat bench in the
    // north where the houses stand (a house wants level ground)
    const groundAt = function (x, z) {
      const rx = x <= RX0 ? 0 : (x >= RX1 ? (RX1 - RX0) * tanS : (x - RX0) * tanS);
      const u = Math.max(0, Math.min(1, (z - ZB0) / (ZB1 - ZB0)));
      return rx * (1 - u * u * (3 - 2 * u));
    };
    const root = new THREE.Group(); root.name = "wildfireLab"; W.scene.add(root);

    // the ground: a displaced grid, grass-green with a little mottle
    const G = new THREE.PlaneGeometry(220, 180, 110, 90);
    G.rotateX(-Math.PI / 2);
    const pa = G.attributes.position, col = new Float32Array(pa.count * 3);
    for (let i = 0; i < pa.count; i++) {
      const x = pa.getX(i), z = pa.getZ(i);
      pa.setY(i, groundAt(x, z));
      const m = 0.85 + 0.15 * Math.sin(x * 0.37 + z * 0.21) * Math.sin(z * 0.29 - x * 0.13);
      col[i * 3] = 0.30 * m; col[i * 3 + 1] = 0.46 * m; col[i * 3 + 2] = 0.18 * m;
    }
    G.setAttribute("color", new THREE.BufferAttribute(col, 3));
    G.computeVertexNormals();
    const terrain = new THREE.Mesh(G, new THREE.MeshLambertMaterial({ vertexColors: true }));
    terrain.receiveShadow = true; terrain.name = "wildfireLabGround";
    root.add(terrain);

    // the trees: the island's own parts where they are loaded
    const VK = CBZ.vegetationKit;
    const leafBase = VK ? VK.material("foliage") : new THREE.MeshLambertMaterial({ color: 0x3b7a2a });
    const woodBase = VK ? VK.material("wood") : new THREE.MeshLambertMaterial({ color: 0x6e5a48 });
    const crowns = [0, 1, 2].map(function (v) {
      const spec = [[2.2, 2.9, 5], [2.5, 2.5, 4], [1.9, 3.2, 3]][v];
      let g = CBZ.treeCrownGeo && VK
        ? CBZ.treeCrownGeo({ tiers: 2, r: spec[0], h: spec[1], n: spec[2], cards: 12, site: "island", leaf: true, seed: 11 + v * 7 })
        : new THREE.IcosahedronGeometry(spec[0], 1);
      g = g.clone(); g.computeBoundingBox();
      g.translate(0, -(g.boundingBox.min.y + g.boundingBox.max.y) / 2, 0);
      if (!g.attributes.color) {
        const c = new Float32Array(g.attributes.position.count * 3).fill(1);
        g.setAttribute("color", new THREE.BufferAttribute(c, 3));
      }
      g.computeBoundingSphere();
      return g;
    });
    const trunkGeo = CBZ.treeTrunkGeo
      ? CBZ.treeTrunkGeo({ rTop: 0.12, rBase: 0.22, h: 1, seg: 7, roots: 4, spread: 2.3, flare: 1.5, site: "island", uvRepeat: 1.4 })
      : new THREE.CylinderGeometry(0.12, 0.22, 1, 7).translate(0, 0.5, 0);
    if (!trunkGeo.attributes.color) trunkGeo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(trunkGeo.attributes.position.count * 3).fill(1), 3));
    const houses = [{ x: 24, z: 26 }, { x: 47, z: 38 }];
    const carsAt = [{ x: 34, z: 19, h: 0 }, { x: 12, z: 33, h: 90 }];
    const trees = [];
    let s = 1234 + (L.seed | 0);
    const r01 = function () { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return s / 4294967296; };
    const n = +P.trees || 0;
    for (let k = 0, tries = 0; k < n && tries < n * 20; tries++) {
      // a grove on the ramp round the ignition, a scatter across the field
      const grove = k < n * 0.55;
      const x = grove ? 5 + r01() * 55 : -70 + r01() * 130;
      const z = grove ? -60 + r01() * 70 : -70 + r01() * 130;
      if (houses.some(function (h) { return Math.abs(h.x - x) < 11 && Math.abs(h.z - z) < 11; })) continue;
      if (carsAt.some(function (c) { return Math.hypot(c.x - x, c.z - z) < 5; })) continue;
      if (Math.hypot(x - 30, z + 45) < 6) continue;      // keep the ignition point open
      const gy = groundAt(x, z), th = 2 + r01() * 1.5;
      const trunk = new THREE.Mesh(trunkGeo, woodBase.clone());
      trunk.material.color.setHex(0x6e5a48);
      trunk.position.set(x, gy - 0.25, z); trunk.scale.set(1.15, th + 1.15, 1.15);
      trunk.castShadow = true; root.add(trunk);
      const leafHex = [0x2f6a26, 0x3b7a2a, 0x2a5e2a, 0x48802e][k % 4];
      const foliage = new THREE.Mesh(crowns[k % 3], leafBase.clone());
      foliage.material.color.setHex(leafHex);
      foliage.position.set(x, gy + th + 1.25, z); foliage.rotation.y = r01() * 6.28;
      foliage.castShadow = true; root.add(foliage);
      trees.push({ x: x, z: z, trunk: trunk, foliage: foliage, leafHex: leafHex, barkHex: 0x6e5a48, burning: 0, burnt: false });
      k++;
    }

    // the houses: real city shells on the flat, downwind
    const fragile = houses.map(function (h, i) {
      const H = W.add("building", { name: "house" + i, lot: { x0: h.x - 8, x1: h.x + 8, z0: h.z - 7, z1: h.z + 7 }, storeys: +P.storeys || 2, doorSide: 0, color: i ? 0xb8a58a : 0xc9c2b4 });
      const b = H.b;
      return { group: H.root, x: h.x, z: h.z, w: H.fit.w, d: H.fit.d, h: b.h || (+P.storeys || 2) * 3.2, storeys: b.storeys || +P.storeys || 2, gy: 0, fallen: false, name: "house" + i };
    });
    // the cars
    const cars = carsAt.map(function (c, i) {
      const H = W.add("car", { name: "car" + i, at: [c.x, c.z], heading: c.h });
      return { group: H.car.group, x: c.x, z: c.z, name: "car" + i, car: H.car };   // car: the vehicle the fire hands to vehicles.js
    });

    const arena = {
      lab: true, root: root, center: { x: 0, z: 0 }, radius: 100, oceanY: -100,
      groundHeightAt: groundAt,
      flammable: trees, fragile: fragile, cars: cars,
    };
    const ev = { collapsed: [], blasts: [] };
    const bridge = {
      hitBuilding: function (b, amount) {
        b._dmg = (b._dmg || 0) + amount;
        if (b._dmg >= 1 && !b.fallen) { b.fallen = true; if (b.group) b.group.visible = false; ev.collapsed.push(b.name); W.event(b.name, "collapsed"); }
        return b.fallen ? 3 : 0;
      },
      blast: function (kind, x, z) { ev.blasts.push(kind); W.event("fire", kind + " at " + Math.round(x) + "," + Math.round(z)); },
    };
    const ctx = { arena: arena, intensity: 0.6, wind: { x: 0, z: 1, speed: +P.wind }, seed: { x: 30, z: -45 } };
    const st = { phase: "idle", t: 0, frameMs: [], ignite: { x: 30, z: -45 } };
    W.fire = { arena: arena, ctx: ctx, bridge: bridge, ev: ev, st: st, groundAt: groundAt, terrain: terrain };
    CBZ.wildfire.setMagnitude(+P.mag);
    const WARN = 3, ACT = +P.active || 30;
    W.every(function (dt) {
      const t0 = performance.now();
      st.t += dt;
      if (st.phase === "idle") { CBZ.wildfire.beginWarn(ctx, bridge); st.phase = "warn"; W.event("fire", "warn: the seed torches"); }
      else if (st.phase === "warn") {
        CBZ.wildfire.tick(dt, ctx, true);
        if (st.t >= WARN) { CBZ.wildfire.begin(ctx); st.phase = "active"; st.activeAt = st.t; W.event("fire", "active"); }
      } else if (st.phase === "active") {
        CBZ.wildfire.tick(dt, ctx, false);
        if (st.t >= WARN + ACT) { CBZ.wildfire.stop(); st.phase = "after"; st.audit = CBZ.wildfire.audit(); W.event("fire", "stopped"); }
      }
      st.frameMs.push(performance.now() - t0);
    });
  },
  frame: function (W) { return [W.fire.terrain]; },
  probe: function (W, P) {
    const F = W.fire, A = CBZ.wildfire.audit(), g = CBZ.wildfire.grid();
    const st = F.st;
    // spread along the line through the ignition: east = uphill, west =
    // downhill (both flanks to the north wind), north = head, south = back
    function reach(dx, dz) {
      // a 50-degree SECTOR about the direction, not one line of cells (a
      // single row can be cut by a bare mosaic cell). Rate = the 90th-
      // percentile reach past the seed's established 8 m disc, over the time
      // it took from that disc's edge.
      if (!g) return { m: 0, s: 0, ros: 0 };
      const cos25 = Math.cos(25 * Math.PI / 180), pts = [];
      let t8 = Infinity;
      for (let i = 0; i < g.st.length; i++) {
        const t = g.tIgn[i]; if (t < 0) continue;
        const x = g.x0 + (i % g.n + 0.5) * g.cs - st.ignite.x, z = g.z0 + (((i / g.n) | 0) + 0.5) * g.cs - st.ignite.z;
        const d = Math.hypot(x, z); if (d < 1) continue;
        if ((x * dx + z * dz) / d < cos25) continue;
        if (d >= 7 && d <= 10) t8 = Math.min(t8, t);
        pts.push({ d: d, t: t });
      }
      if (!pts.length) return { m: 0, s: 0, ros: 0 };
      pts.sort(function (a, b) { return a.d - b.d; });
      const far = pts[Math.min(pts.length - 1, Math.floor(pts.length * 0.9))];
      const ros = isFinite(t8) && far.d > 9 ? (far.d - 8) / Math.max(0.1, far.t - t8) : 0;
      return { m: Math.round(far.d), s: isFinite(t8) ? +(far.t - t8).toFixed(1) : 0, ros: +ros.toFixed(2) };
    }
    const up = reach(1, 0), down = reach(-1, 0), head = reach(0, 1), back = reach(0, -1);
    const fm = st.frameMs.slice().sort(function (a, b) { return a - b; });
    const avg = fm.length ? fm.reduce(function (a, b) { return a + b; }, 0) / fm.length : 0;
    const p95 = fm.length ? fm[Math.floor(fm.length * 0.95)] : 0;
    const AA = st.audit || A;
    const data = {
      slopeDeg: +P.slope, windMs: +P.wind, mag: +P.mag,
      upslope: up, downslope: down, head: head, back: back,
      upDownRatio: down.ros > 0 ? +(up.ros / down.ros).toFixed(2) : null,
      burntHa: A.burntHa, cellsIgnited: A.cellsIgnited, cellM: A.cellM, gridN: A.gridN,
      treesTorched: A.treesTorched, treesScorched: A.treesScorched, treesBurnt: A.treesBurnt, treesTotal: A.treesTotal,
      spotLaunched: AA.spotLaunched, spotFires: A.spotFires, spotMaxM: A.spotMaxM, spotFizzled: A.spotFizzled,
      housesIgnited: A.buildingsIgnited, byVent: A.ignitedByVent, byWindow: A.ignitedByWindow, byHeat: A.ignitedByHeat,
      floorsBurnt: A.floorsBurnt, housesCollapsed: A.buildingsCollapsed, housesGutted: A.buildingsGutted,
      carsBurnt: A.carsBurnt, carsExploded: A.carsExploded, blasts: F.ev.blasts.length,
      frameMsAvg: +avg.toFixed(3), frameMsP95: +p95.toFixed(3), frameMsMax: +(fm[fm.length - 1] || 0).toFixed(2),
      simMsAvg: A.simMsAvg, simMsMax: A.simMsMax, fxMsAvg: A.fxMsAvg, fxMsMax: A.fxMsMax,
      peakSources: AA.sources, smokePuffs: AA.smokePuffsLive, ashLive: AA.ashLive, flameSprites: AA.flameSprites, burnTiles: A.burnTiles,
    };
    const ok = up.ros > down.ros && head.ros > back.ros && A.cellsIgnited > 50;
    return {
      ok: ok,
      summary: "slope " + P.slope + " deg, wind " + P.wind + " m/s across it, mag " + P.mag + ": UPSLOPE " + up.ros + " m/s (" + up.m + " m) vs DOWNSLOPE " + down.ros +
        " m/s (" + down.m + " m) = x" + data.upDownRatio + "; head " + head.ros + " m/s (" + head.m + " m), back " + back.ros + " m/s; " + data.burntHa + " ha burnt; trees torched " + data.treesTorched +
        "/" + data.treesTotal + " (" + data.treesScorched + " scorched); spots " + data.spotFires + " of " + data.spotLaunched + " (max " + data.spotMaxM + " m); houses caught " + data.housesIgnited +
        " (vent " + data.byVent + ", window " + data.byWindow + ", heat " + data.byHeat + "), collapsed " + data.housesCollapsed + "; cars burnt " + data.carsBurnt + ", exploded " + data.carsExploded +
        "; fire frame " + data.frameMsAvg + " ms avg / " + data.frameMsP95 + " p95 (sim " + data.simMsAvg + ", fx " + data.fxMsAvg + ")",
      data: data,
    };
  },
});
