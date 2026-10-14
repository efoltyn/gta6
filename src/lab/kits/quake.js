/* lab kit "quake": a street of real buildings of different structural types
   and real parked cars, put through ONE earthquake by the game's own core
   (systems/quake.js CBZ.quake.eventStart / eventTick: the same entry the
   disaster island's round and the city event drive).

   lab.html?kit=quake&M=7&dist=12&depth=10&soil=firm
     M       moment magnitude (4..8.6)
     dist    epicentral distance, km (default 12)
     depth   hypocentral depth, km (default 10)
     soil    rock | firm | soft (soft = low fill by the water: amplifies and
             liquefies)
     row     the buildings, comma list of style:storeys[:retail]
             (default brick:3,stone:4,victorian:3,brutalist:6:retail,hightech:10,intl:12)
     secs    sim seconds to run (default: the event's own length)
     seed    the draw (default 1)

   The street is one long city block (city/streetkit.js) cut into 16 m
   parcels, each building a real cityMakeBuilding shell in its facade
   grammar (so its structural system is the grammar's own `structure:`
   field), three cars parked at the kerb in front of three of them and one in
   the open across the road as the control.

   probe(): the earthquake as the street lived it.
     motion    the source (M, depth, distance, offshore), the site's peak
               ground acceleration, MMI, the P->S gap and the strong-motion
               duration; the phases the synthesizer actually went through
     buildings per building: type (structural system), storeys, period T,
               the damage state it reached (none / slight / moderate /
               extensive / complete), soft storey, panes broken, pieces shed,
               parapet down
     byType    damage grouped by structural system
     debris    pieces the quake put in the air (its own shed + glass), live +
               frozen debris bodies at the end
     cars      hit by debris, crushed, max bounce (cm), max roll (deg),
               metres walked by the shaking
     ground    road cracks (count, total length, widest opening), sand boils,
               broken mains
     frame     the sim's cost per frame while the ground moved: mean and
               worst ms of the whole stepSim (that includes city/collapse.js
               cutting a complete-damage building into its fall, a cost of
               its own), and the quake core's share (motion, buildings, the
               work queue, strikes, ground, cars, people)
     jobs      the core's work queue by kind: count, mean and worst ms
     ok        the ground moved, no job threw, and the core's own worst
               frame stayed under 50 ms (which building falls is a lognormal
               draw per building, so no damage pattern is asserted) */
(function () {
"use strict";
CBZ.lab.kit("quake", {
  about: "a street of real buildings (masonry, timber, concrete, steel, curtain wall) and parked cars through one earthquake; probe: damage by type, debris, cars hit, ground effects, frame cost",
  uses: ["street", "building", "car"],
  files: ["src/systems/debris.js", "src/city/collapse.js", "src/systems/fx.js", "src/systems/quake.js"],
  params: { M: 7, dist: 12, depth: 10, soil: "firm", row: "brick:3,stone:4,victorian:3,brutalist:6:retail,hightech:10,intl:12" },
  duration: 40,
  setup: function (W, P) {
    const PARCEL = 16, DEPTH = 18;
    const row = String(P.row).split(",").map(function (s) {
      const a = s.split(":");
      return { style: a[0], storeys: +a[1] || 3, retail: a[2] === "retail" };
    });
    const at = [40, 60];
    const street = W.add("street", { name: "street", lot: [row.length * PARCEL, DEPTH], at: at });
    const L = street.lot;
    W.blds = [];
    row.forEach(function (r, i) {
      const x0 = L.x0 + i * PARCEL;
      const h = W.add("building", {
        name: "b" + i + "-" + r.style, lot: { x0: x0, x1: x0 + PARCEL, z0: L.z0, z1: L.z1 },
        style: r.style, storeys: r.storeys, doorSide: 1, retail: r.retail, setback: 1,
      });
      h.retail = r.retail;
      W.blds.push(h);
    });
    // the kerb lane of the +z carriageway: parked, nose along +x
    const kerbZ = L.z1 + street.footway + 1.6;
    const front = [0, 3, 5].filter(function (i) { return i < row.length; });
    W.cars = [];
    front.forEach(function (i, k) {
      const c = W.add("car", { name: "car" + k + "@" + row[i].style, at: [L.x0 + i * PARCEL + PARCEL / 2, kerbZ], heading: 90 });
      c.brake();
      W.cars.push(c);
    });
    // the control: the far kerb, nothing over it but sky
    const ctl = W.add("car", { name: "car-open", at: [L.x0 + 1.5 * PARCEL, L.z1 + street.footway + street.ROAD - 1.6], heading: -90 });
    ctl.brake();
    W.cars.push(ctl);
    W.street = street;

    /* FRAME COST: the whole stepSim, timed from outside, and the core's own
       tick (it keeps its own clock in the audit). */
    const step0 = CBZ.stepSim;
    W.frame = { n: 0, sum: 0, max: 0 };
    CBZ.stepSim = function (dt) {
      const t0 = performance.now();
      step0(dt);
      const ms = performance.now() - t0;
      if (W.quakeOn) { W.frame.n++; W.frame.sum += ms; if (ms > W.frame.max) W.frame.max = ms; }
    };
  },
  script: function (W, P) {
    return [[0.2, function () {
      const Q = CBZ.quake;
      if (!Q || !Q.eventStart) throw new Error("CBZ.quake.eventStart missing (systems/quake.js)");
      const S = W.street;
      const R = S.road, Lt = S.lot;
      W.ev = Q.eventStart({
        M: +P.M, epiKm: +P.dist, depthKm: +P.depth, soil: P.soil, selfTick: true,
        cx: (Lt.x0 + Lt.x1) / 2, cz: (Lt.z0 + Lt.z1) / 2, R: 120,
        structures: W.blds.map(function (h) { return { building: h.b, colliders: h.colliders, platforms: h.platforms, retail: h.retail }; }),
        cars: W.cars.map(function (c) { return c.car; }),
        // the carriageways round the block (cracks open in the asphalt)
        roads: [
          { x0: R.x0, x1: R.x1, z0: S.walk.z1, z1: R.z1 },
          { x0: R.x0, x1: R.x1, z0: R.z0, z1: S.walk.z0 },
        ],
        groundAt: function (x, z) { return S.heightAt(x, z); },
      });
      W.quakeOn = true;
      W.event("quake", "M" + P.M + " at " + P.dist + " km, depth " + P.depth + " km, " + P.soil + " ground");
    }, "the fault lets go"]];
  },
  frame: function (W) { return W.blds.map(function (h) { return h.root; }); },
  probe: function (W, P) {
    const Q = CBZ.quake;
    const a = CBZ.quakeAudit ? CBZ.quakeAudit() : {};
    const rep = Q && Q.eventReport ? Q.eventReport() : null;
    const dbs = CBZ.debris && CBZ.debris.stats ? CBZ.debris.stats() : {};
    const f = W.frame;
    const frame = { frames: f.n, meanMs: f.n ? +(f.sum / f.n).toFixed(2) : 0, worstMs: +f.max.toFixed(1), coreMeanMs: a.tickMsMean || 0, coreWorstMs: a.tickMsMax || 0 };
    const byType = {};
    const blds = rep ? rep.buildings : [];
    blds.forEach(function (b) {
      const t = byType[b.type] || (byType[b.type] = { n: 0, ds: [], panes: 0, shed: 0 });
      t.n++; t.ds.push(b.dsName); t.panes += b.panes; t.shed += b.shed;
    });
    const cars = rep ? rep.cars : [];
    const hit = cars.filter(function (c) { return c.hit; }).length, crushed = cars.filter(function (c) { return c.crushed; }).length;
    const data = {
      motion: rep ? rep.motion : null, buildings: blds, byType: byType,
      debris: { spawned: a.debrisSpawned || 0, panes: a.panesBroken || 0, live: dbs.live || 0, frozen: dbs.static || 0, grit: dbs.grit || 0 },
      cars: { list: cars, hit: hit, crushed: crushed },
      ground: rep ? rep.ground : null, frame: frame,
      people: rep ? rep.crowd : null, jobs: a.jobCost, jobErrors: a.jobErrors,
    };
    const moved = !!(rep && rep.motion && rep.motion.pgaPeak > 0);
    const ok = moved && !(a.jobErrors > 0) && (a.tickMsMax || 0) < 50 &&
      !W.log.some(function (e) { return /THREW/.test(e.what || e.text || ""); });
    const dsLine = blds.map(function (b) { return b.style + "(" + b.type + "," + b.storeys + "st)=" + b.dsName; }).join(" ");
    return {
      ok: ok,
      summary: (rep ? ("M" + rep.motion.M + " R" + rep.motion.hypoKm + "km PGA " + rep.motion.pgaPeak + "g MMI " + rep.motion.mmi + "; ") : "no event; ") +
        dsLine + "; debris " + data.debris.spawned + " pieces + " + data.debris.panes + " panes; cars hit " + hit + "/" + cars.length + " (crushed " + crushed + ")" +
        (rep ? "; cracks " + rep.ground.cracks + " (" + rep.ground.crackM + " m), boils " + rep.ground.boils + ", mains " + rep.ground.mains : "") +
        "; frame " + frame.meanMs + " ms mean / " + frame.worstMs + " worst, of it the quake core " + frame.coreMeanMs + " / " + frame.coreWorstMs + " ms",
      data: data,
    };
  },
});
})();
