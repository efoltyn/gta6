/* lab kit "island": the Natural Disaster island, built whole
   (CBZ.buildDisasterArena: world/island_plan.js laid out, every building,
   street, tree, car, boat and the harbour built), then measured.

   lab.html?kit=island

   probe(): what a builder asks of the island without looking at it
     size        radius, diameter, land area, the town's extent
     built       buildings (by kind), towers, the helipad, cars, trees, boats,
                 signs, bridges, the plan's own lot audit
     overlaps    built footprints that overlap another (must be 0)
     lotLine     buildings whose DRAWN geometry (every visible mesh, facade
                 and all) stands past their lot line (must be 0)
     floating    buildings whose floor is off the ground under their
                 footprint by more than 0.2 m (must be 0)
     cars        every parked car on a carriageway, a car-park bay or a
                 driveway (offRoad must be 0)
     draws       visible meshes after the bake + instancing; tris
     ms          the build, in the page
   ok = 0 overlaps, 0 lot-line, 0 floating, 0 cars off road, a helipad. */
CBZ.lab.kit("island", {
  about: "the disaster island built whole: size, buildings, overlaps, lot lines, cars on roads, boot time",
  files: ["src/vendor/BufferGeometryUtils.js", "src/city/facade_openings.js", "src/city/facade_kit.js", "src/city/facades/*.js",
    "src/world/vegetation.js", "src/world/fuel_station.js", "src/world/hull_loft.js", "src/world/water_hulls.js",
    "src/systems/stairs.js", "src/world/island_roads.js", "src/world/island_plan.js", "src/world/instance_proxy.js",
    "src/world/disaster_arena.js", "src/world/island_dressing.js"],
  duration: 0.1,
  setup: function (W) {
    const t0 = performance.now();
    W.marks = { A: CBZ.buildDisasterArena() };
    W.marks.ms = performance.now() - t0;
  },
  probe: function (W) {
    const THREE = window.THREE;
    const A = W.marks.A, I = CBZ.island, P = A.plan;
    const r = { ms: Math.round(W.marks.ms) };
    r.size = { R: A.radius, across: 2 * A.radius, landHa: +(Math.PI * A.radius * A.radius / 1e4).toFixed(1) };
    const B = A.fragile;
    let tx0 = 1e9, tx1 = -1e9, tz0 = 1e9, tz1 = -1e9;
    const kinds = {};
    for (const b of B) { kinds[b.kind || "?"] = (kinds[b.kind || "?"] || 0) + 1; tx0 = Math.min(tx0, b.x - b.w / 2); tx1 = Math.max(tx1, b.x + b.w / 2); tz0 = Math.min(tz0, b.z - b.d / 2); tz1 = Math.max(tz1, b.z + b.d / 2); }
    r.size.town = [Math.round(tx1 - tx0), Math.round(tz1 - tz0)];
    // overlaps between built footprints
    let overlaps = 0;
    for (let i = 0; i < B.length; i++) for (let j = i + 1; j < B.length; j++) {
      const a = B[i], b = B[j];
      if (Math.abs(a.x - b.x) < (a.w + b.w) / 2 - 0.02 && Math.abs(a.z - b.z) < (a.d + b.d) / 2 - 0.02) overlaps++;
    }
    // drawn geometry past the lot line, and floors off the ground
    const bb = new THREE.Box3();
    let lotLine = 0, worstSpill = 0, floating = 0, worstFloat = 0;
    const spills = [];
    for (const b of B) {
      if (!b.lot) continue;
      b.group.updateMatrixWorld(true);
      let over = 0;
      b.group.traverse(function (o) {
        if (!o.isMesh || o.isInstancedMesh || !o.visible) return;
        for (let a = o; a && a !== b.group; a = a.parent) if (a.visible === false) return;
        const g = o.geometry; if (!g.boundingBox) g.computeBoundingBox();
        bb.copy(g.boundingBox).applyMatrix4(o.matrixWorld);
        over = Math.max(over, b.lot.x0 - bb.min.x, bb.max.x - b.lot.x1, b.lot.z0 - bb.min.z, bb.max.z - b.lot.z1);
      });
      if (over > 0.06) { lotLine++; spills.push((b.name || b.facadeStyle || b.kind) + " " + over.toFixed(2)); }
      worstSpill = Math.max(worstSpill, over);
      let dev = 0;
      for (const fx of [-0.45, 0, 0.45]) for (const fz of [-0.45, 0, 0.45]) {
        const y = A.plan ? A.plan.landAt(b.x + fx * b.w, b.z + fz * b.d) : 0;
        const m = A.plan ? A.plan.madeAt(b.x + fx * b.w, b.z + fz * b.d) : -Infinity;
        dev = Math.max(dev, Math.abs(Math.max(y, m) - b.gy));
      }
      if (dev > 0.2) floating++;
      worstFloat = Math.max(worstFloat, dev);
    }
    // cars: on a carriageway, in a bay, on a drive (the plan's audit)
    const pc = P ? CBZ.islandPlan.check(P) : null;
    // draws and triangles, as the renderer would see them
    let draws = 0, tris = 0;
    A.root.traverseVisible(function (o) {
      if (!o.isMesh || o.layers.mask !== 1) return;
      if (o.material && o.material.visible === false) return;
      draws++;
      const g = o.geometry;
      tris += (g.index ? g.index.count : g.attributes.position.count) / 3 * (o.isInstancedMesh ? o.count : 1);
    });
    const st = I && I.stats ? I.stats() : {};
    r.built = {
      buildings: B.length, kinds: kinds, towers: B.filter(function (b) { return b.kind === "tower"; }).length,
      helipads: I ? I.helipads.length : 0, cars: A.cars.length, trees: A.flammable.length, boats: I ? I.boats.length : 0,
      signs: I ? I.signs.length : 0, bridges: I ? I.bridges.length : 0, streets: I ? I.roads.pieces.length : 0,
      junctions: I ? I.roads.junctions.length : 0, lots: P ? P.lots.length : 0,
    };
    r.audit = { overlaps: overlaps, lotLine: lotLine, worstSpillM: +worstSpill.toFixed(2), floating: floating, worstFloorOffM: +worstFloat.toFixed(2),
      planOverlaps: pc ? pc.overlaps : null, planLotLine: pc ? pc.lotLine : null, spills: spills.slice(0, 8) };
    r.cars = pc ? { total: pc.carsTotal, kerb: pc.carsOnRoad, carPark: pc.carsInBays, driveway: pc.carsOnDrive, offRoad: pc.carsBad, stacked: pc.carsOverlap } : null;
    r.draws = { visible: draws, tris: Math.round(tris), bake: st.bake, trees: st.trees_draws, cars: st.cars_draws };
    const ok = overlaps === 0 && lotLine === 0 && floating === 0 && (!r.cars || r.cars.offRoad === 0) && r.built.helipads > 0;
    return {
      ok: ok,
      summary: "R " + A.radius + " m (" + r.size.across + " m across, " + r.size.landHa + " ha), built in " + r.ms + " ms: " +
        B.length + " buildings, " + A.cars.length + " cars, " + A.flammable.length + " trees, " + r.built.boats + " boats; overlaps " + overlaps +
        ", lot-line " + lotLine + ", floating " + floating + ", cars off road " + (r.cars ? r.cars.offRoad : "?") + "; " + draws + " draws, " + (tris / 1e6).toFixed(2) + "M tris",
      data: r,
    };
  },
});
