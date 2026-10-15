/* lab kit "collapse": real buildings broken by the structural model
   (city/collapse.js): a low brick block, a concrete mid-rise and a glass
   tower, each on its own lot 90 m apart, two real cars parked against the
   struck face of each. One kind of hit on all three, or (hit=all, the
   default) every hit at once on three rows of the three buildings 100 m apart:

   lab.html?kit=collapse&hit=corner
     hit      all        corner / undermine / base, one row each (9 buildings)
              corner     a car bomb (25 MJ, r 4.5 m) at the ground-floor corner
              undermine  the ground goes from under the struck third (a sinkhole
                         4 m deep): CBZ.collapse.undermine
              base       a big charge (120 MJ, r 0.45 x width) at the base of the
                         struck face
              condemn    the condemned path (CBZ.collapse.play), as structural.js
                         calls it: wound on the struck face, ground storey
     only     low | mid | tower   (one building)
     e        energy multiplier (default 1)
     pre      1 = cut every building in setup (the cut time is reported); 0 =
              lazily, on the first hit, in frame slices, as the game does

   The struck face is +x (east); the cars stand 3.5 m east of it.

   probe(): per building: chunks (pieces of itself it was cut into), cut ms,
   blasted / crushed / detached chunks, rigid bodies made, debris pieces made,
   when the fall started and the last body settled (s after the hit), whether
   it TOPPLED (max tilt of a falling block, deg) or PANCAKED (storeys crushed
   by a falling block), what still stands, the rubble footprint (m^2 of 1 m
   cells under baked rubble, from the merged rubble meshes) and its extent
   east of the face, cars crushed. Whole run: bodies awake (avg / max), frame
   cost (whole sim step, avg / max ms) and the collapse module's share,
   geometry bytes held by the standing cuts, heap; and what is IN THE AIR at
   the end (settled bodies and pieces with nothing under them: must be 0). */
(function () {
"use strict";
const SPECS = {
  low:   { style: "brick",     storeys: 3,  lot: [22, 18], x: -90 },
  mid:   { style: "brutalist", storeys: 8,  lot: [26, 22], x: 0 },
  tower: { style: "intl",      storeys: 22, lot: [26, 26], x: 90 },
};
CBZ.lab.kit("collapse", {
  about: "a low brick block, a concrete mid-rise and a glass tower hit at a corner / undermined / blasted at the base / condemned; probe reports chunks, fall, topple vs pancake, rubble footprint, cars crushed, bodies awake, frame cost",
  uses: ["building", "car"],
  files: ["src/systems/debris.js", "src/city/collapse.js", "src/city/crashdeform.js"],
  params: { hit: "all", e: 1, pre: 1 },
  duration: 22,
  setup: function (W, P) {
    const names = P.only ? [P.only] : Object.keys(SPECS);
    const hits = P.hit === "all" ? ["corner", "undermine", "base"] : [P.hit];
    W.blds = [];
    hits.forEach(function (hit, row) {
    const zc = hits.length > 1 ? (row - 1) * 100 : 0;
    for (const n0 of names) {
      const sp = SPECS[n0];
      if (!sp) throw new Error("only: low | mid | tower");
      const n = hits.length > 1 ? n0 + "-" + hit : n0;
      const lot = { x0: sp.x - sp.lot[0] / 2, x1: sp.x + sp.lot[0] / 2, z0: zc - sp.lot[1] / 2, z1: zc + sp.lot[1] / 2 };
      const h = W.add("building", { name: n, lot: lot, style: sp.style, storeys: sp.storeys, doorSide: 0 });
      const b = h.b;
      const t0 = performance.now();
      if (P.pre !== "0" && P.pre !== 0) CBZ.collapse.fracture(b, { sync: true });
      const cut = performance.now() - t0;
      // two cars against the struck (east) face
      const cx = b.ox + b.w / 2 + 3.5;
      W.add("car", { name: n + "CarA", at: [cx, b.oz - b.d * 0.22], heading: 0 });
      W.add("car", { name: n + "CarB", at: [cx, b.oz + b.d * 0.22], heading: 0 });
      W.blds.push({ n: n, hit: hit, h: h, b: b, cutWall: cut });
    }
    });
    // frame cost: one whole sim step (every system on the page), timed around
    // CBZ.stepSim so a frame capture never counts
    W.cost = { sum: 0, max: 0, n: 0, heap0: performance.memory ? performance.memory.usedJSHeapSize : 0 };
    const step0 = CBZ.stepSim;
    CBZ.stepSim = function (dt) {
      const t0 = performance.now();
      const r = step0.apply(this, arguments);
      if (W.cost.armed) { const d = performance.now() - t0; W.cost.sum += d; W.cost.n++; if (d > W.cost.max) W.cost.max = d; }
      return r;
    };
  },
  frame: function (W) { return W.blds.map(function (x) { return x.h.root; }); },
  script: function (W, P) {
    const k = +P.e || 1;
    return [[0.5, function () {
      W.cost.armed = true;
      if (CBZ.collapse.resetStats) CBZ.collapse.resetStats();
      for (const x of W.blds) {
        const b = x.b, east = b.ox + b.w / 2;
        x.hitAt = 0.5;
        const hit = x.hit;
        if (hit === "corner") {
          x.res = CBZ.collapse.damage(b, { x: east - 0.6, y: 1.6, z: b.oz - b.d / 2 + 0.6 }, 4.5, 25 * k, { x: -1, y: 0, z: 1 });
        } else if (hit === "undermine") {
          x.res = CBZ.collapse.undermine(b, { minX: b.ox + b.w * 0.18, maxX: east + 6, minZ: b.oz - b.d / 2 - 6, maxZ: b.oz + b.d / 2 + 6 }, { depth: 4 });
        } else if (hit === "base") {
          x.res = CBZ.collapse.damage(b, { x: east + 0.5, y: 1.5, z: b.oz }, Math.max(6, b.w * 0.45), 120 * k, { x: -1, y: 0, z: 0 });
        } else if (hit === "condemn") {
          x.res = !!CBZ.collapse.play({ group: b.group, ox: b.ox, oz: b.oz, w: b.w, d: b.d, h: b.h, storeys: b.storeys, FH: b.FH, style: b.dressStyle, key: x.n },
            { wound: { nx: 1, nz: 0, floor: 0 }, preShudder: 0.3 });
        } else throw new Error("hit: corner | undermine | base | condemn");
      }
    }, P.hit + " on every building"]];
  },
  probe: function (W, P) {
    const C = CBZ.collapse;
    const G = C.stats();
    // the rubble on the ground: every merged rubble mesh's vertices, on a 1 m grid, filed to the nearest building
    const cells = W.blds.map(function () { return new Set(); });
    const east = W.blds.map(function () { return -Infinity; });
    const v = new THREE.Vector3();
    CBZ.scene.updateMatrixWorld(true);
    CBZ.scene.traverse(function (o) {
      if (!o.isMesh || !o.userData || !o.userData.debrisRubble) return;
      const a = o.geometry.attributes.position.array, M = o.matrixWorld;
      for (let i = 0; i < a.length; i += 9) {
        v.set(a[i], a[i + 1], a[i + 2]).applyMatrix4(M);
        const x = v.x, z = v.z;
        let bi = 0, bd = Infinity;
        W.blds.forEach(function (B, j) { const d = Math.abs(x - B.b.ox) + Math.abs(z - B.b.oz); if (d < bd) { bd = d; bi = j; } });
        cells[bi].add(Math.floor(x) + "," + Math.floor(z));
        const b = W.blds[bi].b, ex = x - (b.ox + b.w / 2);
        if (ex > east[bi]) east[bi] = ex;
      }
    });
    let lines = [], ok = true;
    const per = W.blds.map(function (x, i) {
      const s = C.stats(x.b) || {};
      const crushed = [W.get(x.n + "CarA"), W.get(x.n + "CarB")].filter(function (h) { return h && h.car && h.car._cbzCrushed; }).length;
      const fall = s.firstFall != null ? s.firstFall : null;
      const r = {
        building: x.n, style: x.b.dressStyle, storeys: x.b.storeys, material: s.material, rigid: s.rigid,
        chunks: s.chunks, tris: s.tris, cutMs: s.cutMs, cutWallMs: Math.round(x.cutWall),
        blasted: s.blasted, crushed: s.crushed, detached: s.detached, bodies: s.bodies, debrisPieces: s.pieces, baked: s.baked,
        fallStart: fall, settledAt: s.lastSettle, maxTiltDeg: s.maxTiltDeg, pancakedStoreys: s.pancaked, tipped: s.tipped,
        outcome: s.outcome, standingChunks: s.standing, standingLevels: s.standingLevels, standingMass: s.standingMass,
        rubbleArea: cells[i].size, rubbleEastOfFace: isFinite(east[i]) ? +east[i].toFixed(1) : null,
        carsCrushed: crushed, standingGeoBytes: s.memBytes, drawCalls: s.drawCalls, softStorey: s.soft, sf: s.sf,
      };
      lines.push(x.n + " (" + r.style + ", " + r.storeys + " st, " + r.material + (r.rigid ? ", rigid" : "") + "): cut into " + r.chunks + " chunks (" + r.tris + " tris, " + r.cutMs + " ms)" +
        " | blasted " + r.blasted + ", crushed " + r.crushed + ", detached " + r.detached + " -> " + r.bodies + " bodies, " + r.debrisPieces + " debris pieces, " + r.baked + " baked" +
        " | fall " + r.fallStart + " s -> settled " + r.settledAt + " s, tilt " + r.maxTiltDeg + " deg, pancaked " + r.pancakedStoreys + " => " + String(r.outcome).toUpperCase() +
        " | standing " + r.standingChunks + " chunks / " + r.standingLevels + " levels (" + Math.round(r.standingMass * 100) + "% mass)" +
        " | rubble " + r.rubbleArea + " m2, reaches " + r.rubbleEastOfFace + " m past the face | cars crushed " + r.carsCrushed);
      return r;
    });
    const cost = W.cost;
    const heap = performance.memory ? Math.round((performance.memory.usedJSHeapSize - cost.heap0) / 1048576) : null;
    const pf = G.prof || {};
    lines.push("collapse.js per frame (avg/max ms): " + Object.keys(pf).map(function (k) { return k + " " + pf[k].avg + "/" + pf[k].max; }).join(", "));
    lines.push("run: bodies awake avg " + G.awakeAvg + " / max " + G.maxAwake + " (cap " + G.cap + ", hard: " + G.capSettled + " settled + " + G.capShattered + " broken up to make room), bodies made " + G.bodiesMade +
      " | frame " + (cost.n ? (cost.sum / cost.n).toFixed(2) : "?") + " ms avg / " + cost.max.toFixed(1) + " ms max (collapse.js " + G.msAvg + " / " + G.msMax + ") | heap +" + heap + " MB");
    /* NOTHING IN THE AIR: settled bodies (kept rubble) and settled pieces
       (frozen rubble, sleepers) more than 0.5 m over everything that could
       hold them. Bodies still awake or dropping are falling, not resting. */
    const airB = C.unsupported ? C.unsupported({ gap: 0.5 }) : { air: 0, kept: 0, worst: 0, falling: 0, list: [] };
    const airP = CBZ.debris && CBZ.debris.unsupported ? CBZ.debris.unsupported({ gap: 0.5 }) : { air: 0, frozen: 0, asleep: 0, worst: 0, list: [] };
    const inAir = airB.air + airP.air;
    lines.push("in the air: " + inAir + " (bodies " + airB.air + " of " + airB.kept + " kept, worst " + airB.worst + " m; pieces " + airP.air + " of " + (airP.frozen + airP.asleep) + " settled, worst " + airP.worst + " m)" +
      " | still falling " + airB.falling + " | dropped to support " + G.drops + " (re-woken off lost support " + G.rewoken + ")" +
      (inAir ? " | " + JSON.stringify(airB.list.concat(airP.list).slice(0, 6)) : ""));
    if (inAir > 0) ok = false;
    per.forEach(function (r) { if (r.chunks == null || r.chunks < 8) ok = false; });
    return { ok: ok, summary: P.hit + "\n      " + lines.join("\n      "), data: { per: per, run: G, frameMs: cost.n ? cost.sum / cost.n : null, frameMaxMs: cost.max, heapMB: heap, peakAwake: G.maxAwake, inAir: inAir, airBodies: airB, airPieces: airP } };
  },
});
})();
