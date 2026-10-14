/* lab kit "tornado": a street of real houses, street trees and real parked
   cars, and ONE tornado (systems/tornado.js, the game's only vortex) driven
   down it at a chosen EF class.

   lab.html?kit=tornado&ef=3
     ef        EF class asked for (0..5): the vortex is built at mag = ef on
               the EF table, its gust rolled off the seeded stream and the
               class read back from it (the probe prints the class it GOT)
     speed     forward speed, m/s (default 14)
     heading   degrees off the street's axis (default 6: it crosses the
               street slowly, so one side takes the core and the other the rim)
     offset    lateral offset of the track at x = 0, m (default 0)
     houses    per side (default 8, 13 m apart)
     cars      parked along the kerbs (default 8)
     life      seconds the vortex lives (default 15; the last quarter ropes out)

   The street runs along x: the road at z = 0 (kerbs at z = +-4.5), parked
   cars at z = +-3.4, trees in the front yards at z = +-8, houses (8 x 10,
   ridge along x) centred at z = +-15. The vortex is handed the street as its
   world through the same bridge the island lends it (fragile / cars / trees /
   ground), so nothing here is a lab-only path.

   PROBE: roofs damaged / removed, wall panels down, houses swept, cars
   moved / rolled / thrown (max height, max throw), trees down, debris
   lofted and lying, the PATH WIDTH measured on a transect across the street
   at x = 0 (the span whose peak gust reached 29 m/s, the EF0 floor and the
   NWS definition of the damage path; and the span that reached 50 m/s), the
   scar and the suction marks, and FRAME COST: the tornado's own tick, ms
   per frame (CBZ.tornado.perf()), avg and max over the run. */
CBZ.lab.kit("tornado", {
  about: "a street of houses, trees and parked cars; one tornado at a chosen EF class tears down it",
  uses: ["car", "house", "tree"],
  files: ["src/systems/tornado.js"],
  params: { ef: 3, speed: 14, heading: 6, offset: 0, houses: 8, cars: 8, life: 15 },
  duration: 23,
  depth: 0,
  setup: function (W, P) {
    const THREE = window.THREE;
    const nH = Math.max(1, +P.houses || 8), nC = Math.max(0, +P.cars | 0);
    const host = W.root || (W.root = (function () { const g = new THREE.Group(); g.name = "labHost"; W.scene.add(g); return g; })());
    // the carriageway
    const road = new THREE.Mesh(new THREE.PlaneGeometry(nH * 13 + 40, 9), new THREE.MeshLambertMaterial({ color: 0x3a3c3f }));
    road.rotation.x = -Math.PI / 2; road.position.y = 0.01; road.name = "road";
    host.add(road);
    const houses = [], trees = [], cars = [];
    const x0 = -((nH - 1) * 13) / 2;
    for (let i = 0; i < nH; i++) for (const s of [-1, 1]) {
      const x = x0 + i * 13;
      houses.push(W.add("house", { name: "house" + (s < 0 ? "S" : "N") + i, at: [x, s * 15],
        wall: [0xd9d4c7, 0xb9c4c9, 0xd8c39a, 0xc9b8a8][(i + (s > 0 ? 1 : 0)) % 4], roof: [0x3c3a3a, 0x4a3b33, 0x34383d][i % 3] }));
      trees.push(W.add("tree", { name: "tree" + (s < 0 ? "S" : "N") + i, at: [x + 5.5, s * 8], h: 3 + (i % 3) * 0.4 }));
    }
    const models = ["Bison Vista", "Bison Vista"];
    for (let i = 0; i < nC; i++) {
      const s = i % 2 ? 1 : -1;
      const x = x0 + 4 + Math.floor(i / 2) * (13 * nH / Math.max(1, Math.ceil(nC / 2)));
      cars.push(W.add("car", { name: "car" + i, at: [x, s * 3.4], heading: 90, model: models[i % models.length] }));
    }
    W.tw = { houses: houses, trees: trees, cars: cars, transect: null, spawned: null,
      carStart: cars.map(function (h) { return [h.car.group.position.x, h.car.group.position.z]; }) };
    // THE BRIDGE — the same five closures the island lends
    W.tw.bridge = {
      fragile: function () { return houses.map(function (h) { return h.rec; }); },
      cars: function () { return cars.map(function (h) { return h.car; }); },
      trees: function () { return trees.map(function (h) { return h.rec; }); },
      ground: function () { return 0; },
    };
    // the transect across the street at x = 0: the peak gust at each metre
    const Z0 = -150, N = 301;
    const peak = new Float32Array(N);
    W.tw.transect = { z0: Z0, peak: peak };
    W.every(function () {
      const T = CBZ.tornado;
      if (!T || !T.count()) return;
      for (let i = 0; i < N; i++) { const g = T.at(0, Z0 + i, 1).gust; if (g > peak[i]) peak[i] = g; }
    });
  },
  script: function (W, P) {
    return [[0.2, function () {
      const T = CBZ.tornado;
      const a = (+P.heading || 0) * Math.PI / 180, X0 = -95;
      W.tw.spawned = T.spawn({ x: X0, z: (+P.offset || 0) + Math.tan(a) * X0, heading: a, mag: Math.max(0, Math.min(5, +P.ef)),
        speed: +P.speed || 14, life: +P.life || 15, arena: W.tw.bridge });
      const t = W.tw.spawned;
      W.event("tornado", "EF" + t.ef + " spawned: vmax " + t.vmax.toFixed(1) + " m/s, core R " + t.R.toFixed(1) + " m" + (t.sv ? ", " + t.sv.length + " suction vortices" : ""));
    }, "spawn the tornado"]];
  },
  frame: function (W) { return W.tw.houses.slice(0, 6).map(function (h) { return h.obj; }); },
  probe: function (W, P) {
    const T = CBZ.tornado;
    const a = T.audit(), pf = T.perf();
    const t = W.tw.spawned;
    const tr = W.tw.transect;
    const width = function (bar) {
      let lo = null, hi = null;
      for (let i = 0; i < tr.peak.length; i++) if (tr.peak[i] >= bar) { if (lo == null) lo = i; hi = i; }
      return lo == null ? 0 : hi - lo + 1;
    };
    const w0 = width(29), w2 = width(50), w4 = width(74);
    let peakGust = 0;
    for (let i = 0; i < tr.peak.length; i++) if (tr.peak[i] > peakGust) peakGust = tr.peak[i];
    const hs = W.tw.houses.map(function (h) { return h.state(); });
    const dodHist = [0, 0, 0, 0, 0, 0, 0];
    hs.forEach(function (s) { dodHist[s.dod]++; });
    const ef = t ? t.ef : -1;
    const asked = Math.round(+P.ef);
    // the verdict: the EF damage descriptors, class by class
    let ok = !!t && a.roofsDamaged > 0 && W.tw.spawned != null;
    if (ef <= 1) ok = ok && a.housesSwept === 0 && a.carsThrown === 0;
    if (ef >= 3) ok = ok && a.roofsRemoved > 0 && a.carsMoved > 0;
    if (ef >= 5) ok = ok && a.housesSwept > 0 && a.carsThrown > 0;
    const summary = "asked EF" + asked + ", got EF" + ef + " (vmax " + (t ? t.vmax.toFixed(1) : "-") + " m/s, R " + (t ? t.R.toFixed(1) : "-") + " m)" +
      " | roofs damaged " + a.roofsDamaged + ", REMOVED " + a.roofsRemoved + " (" + a.roofParts + " roof parts thrown), walls down " + a.wallsDown +
      ", houses swept " + a.housesSwept + " of " + hs.length +
      " | cars moved " + a.carsMoved + ", rolled " + a.carsRolled + ", THROWN " + a.carsThrown + " (max " + a.maxCarHeight + " m up)" +
      " | trees down " + a.treesDown +
      " | debris lofted " + a.debrisLofted + " (lying " + a.debrisOnGround + ", airborne " + a.debrisAirborne + ", max " + a.maxDebrisHeight + " m up)" +
      " | parts carried up to " + a.maxThrow + " m" +
      " | path width " + w0 + " m (>=29 m/s), " + w2 + " m (>=50), " + w4 + " m (>=74); peak gust " + peakGust.toFixed(1) + " m/s" +
      " | frame cost avg " + pf.avgMs + " ms, max " + pf.maxMs + " ms over " + pf.frames + " frames";
    return {
      ok: ok, summary: summary,
      data: {
        askedEF: asked, ef: ef, vmax: t ? +t.vmax.toFixed(1) : null, R: t ? +t.R.toFixed(1) : null, suction: t && t.sv ? t.sv.length : 0,
        roofsDamaged: a.roofsDamaged, roofsRemoved: a.roofsRemoved, roofParts: a.roofParts, wallsDown: a.wallsDown, housesSwept: a.housesSwept,
        houses: hs.length, dodHistogram: dodHist,
        carsMoved: a.carsMoved, carsRolled: a.carsRolled, carsThrown: a.carsThrown, maxCarHeight: a.maxCarHeight, maxThrow: a.maxThrow,
        treesDown: a.treesDown, treesStripped: a.treesStripped,
        debrisLofted: a.debrisLofted, debrisOnGround: a.debrisOnGround, debrisAirborne: a.debrisAirborne, maxDebrisHeight: a.maxDebrisHeight,
        flyersLaunched: a.flyersLaunched,
        peakGust: +peakGust.toFixed(1), pathWidth29: w0, pathWidth50: w2, pathWidth74: w4,
        scarSections: a.scarSections, suctionMarks: a.suctionMarks,
        frameCost: pf,
        perHouse: hs,
        perCar: W.tw.cars.map(function (h, i) {
          const c = h.car, p = c.group.position, s0 = W.tw.carStart[i];
          const up = new window.THREE.Vector3(0, 1, 0).applyQuaternion(c.group.quaternion).y;
          return { name: h.name, at: [Math.round(s0[0]), Math.round(s0[1])], movedM: +Math.hypot(p.x - s0[0], p.z - s0[1]).toFixed(1),
            maxUpM: +(c._twMaxH || 0).toFixed(1), rolled: !!c._twRolled, thrown: !!c._twThrown, lying: up > 0.7 ? "wheels" : up < -0.7 ? "roof" : "side", flying: !!c._twLift };
        }),
        perTree: W.tw.trees.map(function (h) { return h.state(); }).reduce(function (m, s) { const k = "stage" + s.stage; m[k] = (m[k] || 0) + 1; return m; }, {}),
      },
    };
  },
});
