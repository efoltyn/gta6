/* lab kit "sinkhole": a cover-collapse sinkhole opens in a real street
   (world/sinkhole.js on world/groundshaft.js, the same two files the disaster
   island runs) and takes what is standing on it.

   THE STREET: one city block (the street ingredient: real carriageway, kerb,
   footway, lot pad) with a real office shell on the lot (cityMakeBuilding),
   three parked city cars on the road (cityMakeCar), a fourth well clear, two
   cobra-head lamp posts on the footway — one as its own meshes the way the
   city builds one, one MERGED into a street-furniture geometry with a bench
   the way the island does (so the event has to lift its triangles out) —
   the player standing on the line the final rim will reach, and a passer-by
   just outside it with the shipped brain, who should see the ground going
   and run.

   The hole is placed off the building, not hand-typed: its centre sits on
   the road in front of the shell's front wall, so the final rim bites a
   quarter of the way into the footprint.

   lab.html?kit=sinkhole&r=10&warn=4&grow=6
     r      final radius (m)        depth  shaft depth (default 3.2 r)
     warn   warning seconds         grow   widening seconds
     bite   how far (m) the final rim reaches into the footprint (default 2.6)

   probe: radius / depth / water / sag every 0.5 s; cars that fell in; the
   lamp posts; the building (did it tilt, did it go); the player at the rim
   (did he reach the bottom — no invisible floor); the passer-by (did he
   run); frame cost (sim ms per frame, mean and worst, while the event runs). */
(function () {
"use strict";

function lampParts(THREE, x, z, faceX, faceZ) {
  const M = CBZ.lampMast ? CBZ.lampMast({}) : { poleH: 5.6, poleCY: 2.8, poleR: 0.11, armLen: 1.39, armRotX: Math.PI / 2 - Math.atan2(0.42, 1.395), armCY: 5.61, armCZ: 0.75, headY: 5.8, headZ: 1.45 };
  const steel = new THREE.MeshLambertMaterial({ color: 0x6d7378 });
  const head = new THREE.MeshLambertMaterial({ color: 0x2a2d30 });
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(M.poleR, M.poleR * 1.6, M.poleH, 10), steel);
  pole.position.y = M.poleCY;
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.3, 10), steel);
  foot.position.y = 0.15;
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, M.armLen, 8), steel);
  arm.rotation.x = M.armRotX; arm.position.set(0, M.armCY, M.armCZ);
  const lum = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.16, 0.78), head);
  lum.position.set(0, M.headY, M.headZ);
  g.add(pole, foot, arm, lum);
  g.position.set(x, 0, z);
  g.rotation.y = Math.atan2(faceX, faceZ);
  return g;
}

CBZ.lab.kit("sinkhole", {
  about: "a cover-collapse sinkhole opens in a real street: cracks, sag, collapse, calving; cars, lamp posts and a building go in; the player at the rim falls",
  uses: ["street", "building", "car", "player", "person"],
  files: ["src/systems/solidground.js", "src/systems/debris.js", "src/city/collapse.js", "src/world/groundshaft.js", "src/world/sinkhole.js"],
  mode: "lab",
  params: { r: 10, warn: 4, grow: 6, bite: 2.6 },
  duration: 26,
  setup: function (W, P) {
    const THREE = window.THREE;
    const S = W.add("street", { name: "street", at: [0, 0], lot: [30, 30] });
    const B = W.add("building", { name: "building", street: S, storeys: 5, doorSide: 0 });
    const b = B.b;
    const r = +P.r || 10;
    // THE SITE, from the building: on the road in front of its -z wall, the
    // final rim biting `bite` metres into the footprint, a quarter of its width
    // off its centre line so one corner goes first
    const front = b.oz - b.d / 2;
    const cx = b.ox + b.w * 0.22, cz = front - r + (+P.bite || 2.6);
    W.site = { x: cx, z: cz, r: r };
    // three parked cars on the carriageway, one well clear
    const roadZ = S.lot.z0 - 2 - 9;          // the -z street's centreline
    const mk = function (name, x, z, hd) { const c = W.add("car", { name: name, at: [x, z], heading: hd }); c.car.label = name; return c; };
    mk("carNose", cx - 2.0, cz - 2.5, 90);             // on the cover: goes with it
    mk("carEdge", cx + r * 0.78, roadZ + 2.6, 90);     // straddling the final rim: tips in
    mk("carRim", cx - r - 1.2, roadZ - 2.6, 270);      // just outside: should stay
    mk("carFar", cx + r + 16, roadZ, 90);              // well clear
    // two lamp posts on the footway: one as its own meshes, one merged
    const fwZ = S.lot.z0 - 1.0;
    const lampA = lampParts(THREE, cx - 4.5, fwZ, 0, -1);
    W.scene.add(lampA);
    const lampB = lampParts(THREE, cx + 6.0, fwZ, 0, -1);
    lampB.updateMatrixWorld(true);
    // the merged street furniture: lamp B and a bench in ONE geometry
    const parts = [];
    const bench = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.45, 0.5), new THREE.MeshLambertMaterial({ color: 0x6b4a2a }));
    bench.position.set(cx + 11.5, 0.45, fwZ + 0.3); bench.updateMatrixWorld(true);
    [lampB, bench].forEach(function (o) {
      o.traverse(function (m) {
        if (!m.isMesh) return;
        const g = m.geometry.clone().applyMatrix4(m.matrixWorld);
        const ng = g.index ? g.toNonIndexed() : g;
        const n = ng.attributes.position.count, col = new Float32Array(n * 3);
        const c = m.material.color;
        for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
        ng.setAttribute("color", new THREE.BufferAttribute(col, 3));
        ng.deleteAttribute("uv");
        parts.push(ng);
      });
    });
    let total = 0; parts.forEach(function (g) { total += g.attributes.position.count; });
    const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), col = new Float32Array(total * 3);
    let o = 0;
    parts.forEach(function (g) { pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); col.set(g.attributes.color.array, o * 3); o += g.attributes.position.count; });
    const mg = new THREE.BufferGeometry();
    mg.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    mg.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
    mg.setAttribute("color", new THREE.BufferAttribute(col, 3));
    const furniture = new THREE.Mesh(mg, new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true }));
    furniture.name = "streetFurniture";
    W.scene.add(furniture);
    W.lamps = { A: lampA, B: { x: cx + 6.0, z: fwZ } };
    // THE PLAYER, on the line the final rim reaches (west of the centre)
    const pl = W.add("player", { name: "player", at: [cx - r * 0.86, cz + 0.5], yaw: 90 });
    // a passer-by just outside, with the shipped brain
    const pb = W.add("person", { name: "passerby", at: [cx + r + 2.5, cz - 1.5], role: "civilian", yaw: 0 });
    W.track = { player: [], passerby: [], frame: [], yMinPlayer: 0, peakPB: 0, pb0: { x: cx + r + 2.5, z: cz - 1.5 } };
    W.building = B;
    W.building0 = { x: b.ox, z: b.oz, w: b.w, d: b.d, h: b.h };
    /* FRAME COST: the whole simulated frame (every updater the page runs,
       CBZ.stepSim), timed from outside it while the event is running, with
       the time and phase so a spike can be named. (Updaters registered at run
       time are appended, not sorted, so they cannot bracket the frame.) */
    const step0 = CBZ.stepSim;
    if (step0) {
      CBZ.stepSim = function (dt) {
        const t0 = performance.now();
        step0(dt);
        if (W.seq && W.seq.phase) W.track.frame.push([performance.now() - t0, +W.t().toFixed(2), W.seq.phase]);
      };
    }
    let next = 0, wasAir = false;
    W.track.landings = [];
    W.every(function () {
      const t = W.t();
      const pp = pl.actor.pos;
      if (pp.y < W.track.yMinPlayer) W.track.yMinPlayer = pp.y;
      // every landing below grade: where, and what he is standing ON
      const air = !pl.actor.grounded;
      if (wasAir && !air && pp.y < -0.5) {
        const s = W.seq && W.seq.shaft;
        const fl = CBZ.floorAt ? CBZ.floorAt(pp.x, pp.z, pp.y + 0.5) : null;
        let on = "?";
        if (s) {
          const d = Math.hypot(pp.x - s.x, pp.z - s.z);
          on = d >= s.mouth ? "outside the mouth" : (pp.y < s.bottom + s.coneH + 0.6 ? "the bottom (talus)" : (d >= s.stepIn ? "a slump ledge" : "mid-air?"));
        }
        W.track.landings.push({ t: +t.toFixed(2), y: +pp.y.toFixed(2), floorAt: fl != null ? +fl.toFixed(2) : null, on: on });
      }
      wasAir = air;
      const ap = pb.actor.group.position;
      const dPB = Math.hypot(ap.x - W.track.pb0.x, ap.z - W.track.pb0.z);
      if (dPB > W.track.peakPB) W.track.peakPB = dPB;
      if (t + 1e-6 < next) return;
      next = t + 0.5;
      W.track.player.push([+t.toFixed(1), +pp.y.toFixed(2)]);
      W.track.passerby.push([+t.toFixed(1), +dPB.toFixed(2), pb.actor.aiState || "-"]);
    });
  },
  frame: function (W) { return [W.get("building").root, W.get("street").obj].filter(Boolean); },
  script: function (W, P) {
    return [[0.5, function () {
      const s = W.site;
      const B = W.building, b = B.b;
      /* the player on the rim, on the SHEER side: the side opposite the
         one slump of ledges (CBZ.groundShaftStairArc), where the wall is a
         straight drop to the bottom — the place to prove there is no
         invisible floor under the lip */
      const arc = CBZ.groundShaftStairArc ? CBZ.groundShaftStairArc(s.x * 0.37 + s.z * 0.11) : { a0: 0, span: 0 };
      const away = arc.a0 + arc.span / 2 + Math.PI;
      const pl = W.get("player").actor;
      pl.pos.set(s.x + Math.cos(away) * s.r * 0.86, 0, s.z + Math.sin(away) * s.r * 0.86);
      W.track.playerAt = { bearingDeg: +(away * 180 / Math.PI % 360).toFixed(1), x: +pl.pos.x.toFixed(2), z: +pl.pos.z.toFixed(2) };
      W.seq = CBZ.groundShaftCollapse(s.x, s.z, {
        // `surface` is only the fallback for a page with no street records
        r: s.r, depth: +P.depth || s.r * 3.2, surface: "asphalt",
        warnSecs: +P.warn || 4, growSecs: +P.grow || 6,
        buildings: function () {
          return [{ x: b.ox, z: b.oz, w: b.w, d: b.d, h: b.h, gy: 0, storeys: b.storeys, group: B.root,
            colliders: B.colliders, platforms: B.platforms, color: 0x8a8f96, facadeStyle: b.dressStyle || null, rec: b }];
        },
        eachActor: function (fn) {
          const pl = W.get("player"), pb = W.get("passerby");
          if (pl) { const P2 = pl.actor; P2.isPlayer = true; fn(P2); }
          if (pb) { const a = pb.actor; if (!a.pos) a.pos = a.group.position; fn(a); }
        },
      });
    }, "the ground starts to go"]];
  },
  probe: function (W, P) {
    const s = W.seq;
    if (!s) return { ok: false, summary: "no sinkhole event (CBZ.groundShaftCollapse missing?)" };
    const R = s.report();
    const pl = W.get("player").actor, pb = W.get("passerby").actor;
    const bottom = R.bottom;
    // the player: did he reach the bottom, and is he standing on the real floor there
    const under = CBZ.floorAt ? CBZ.floorAt(pl.pos.x, pl.pos.z, pl.pos.y + 0.5) : null;
    const land = W.track.landings[0] || null;
    const playerFell = !!(land && bottom != null && land.y < bottom + 6);
    const onFloor = !!(land && land.floorAt != null && Math.abs(land.y - land.floorAt) < 0.25);
    const worstAt = W.track.frame.slice().sort(function (a, b) { return b[0] - a[0]; }).slice(0, 5).map(function (f) { return { ms: +f[0].toFixed(1), t: f[1], phase: f[2] }; });
    const F = W.track.frame.map(function (f) { return f[0]; }).sort(function (a, b) { return a - b; });
    const mean = F.length ? F.reduce(function (a, b) { return a + b; }, 0) / F.length : 0;
    const p95 = F.length ? F[Math.floor(F.length * 0.95)] : 0;
    const worst = F.length ? F[F.length - 1] : 0;
    const B = R.buildings[0] || { state: "none", maxTiltDeg: 0 };
    const ok = R.r >= W.site.r * 0.98 && R.carsIn >= 2 && playerFell && onFloor && B.maxTiltDeg > 5 && W.track.peakPB > 3;
    const summary = "r " + R.r.toFixed(1) + " m, depth " + R.depth.toFixed(1) + " m, water " + (R.water || 0).toFixed(2) + " m; cars in " + R.carsIn + "/" + R.cars.length +
      "; building " + B.state + " (tilt " + B.maxTiltDeg + " deg, via " + B.via + ")" +
      "; player " + (land ? "landed at y " + land.y + " on " + land.on + " (floorAt " + land.floorAt + ", bottom " + (bottom != null ? bottom.toFixed(1) : "-") + ") at " + land.t + " s" : "never fell (y " + pl.pos.y.toFixed(1) + ")") +
      "; passer-by ran " + W.track.peakPB.toFixed(1) + " m" +
      "; frame " + mean.toFixed(2) + " ms mean / " + p95.toFixed(2) + " p95 / " + worst.toFixed(1) + " worst";
    return {
      ok: ok, summary: summary,
      data: {
        site: W.site, building0: W.building0, report: R,
        player: { at: W.track.playerAt, landings: W.track.landings, end: [+pl.pos.x.toFixed(2), +pl.pos.y.toFixed(2), +pl.pos.z.toFixed(2)], yMin: +W.track.yMinPlayer.toFixed(2), floorUnderAtEnd: under, fell: playerFell, onFloor: onFloor, hp: pl.hp, track: W.track.player },
        passerby: { peakMoved: +W.track.peakPB.toFixed(2), y: +pb.group.position.y.toFixed(2), track: W.track.passerby },
        frameMs: { n: F.length, mean: +mean.toFixed(3), p95: +p95.toFixed(3), worst: +worst.toFixed(2), worstAt: worstAt },
        audit: CBZ.sinkholeAudit ? CBZ.sinkholeAudit() : null,
        shaft: CBZ.shaftAudit ? CBZ.shaftAudit() : null,
      },
    };
  },
});
})();
