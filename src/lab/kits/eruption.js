/* lab kit "eruption": the whole eruption sequence (world/eruption.js on
   world/volcanofx.js, the code the disaster island runs) on a small real
   stratovolcano: a concave cone with a crater and radial barrancos on a flat
   plain, a ring of houses, trees and parked cars round its foot and a few
   more houses downwind.

   script: 6 s of UNREST (steam + harmonic tremor), the PHREATIC blast at 6 s,
   then the eruption runs its own clock (plinian column, umbrella, bombs,
   lightning, lava, collapse + density current, lahar) for the magnitude's
   active window, the director ends it, and 8 s of aftermath.

   probe: the numbers a builder asks without looking.
     lava      each flow: where it started, where its nose is, metres run,
               metres descended, whether it ran in a valley (the nose's ground
               vs the mean ground at the same radius), its live front speed
     fire      the island's one fire (systems/wildfire.js as a service):
               ground fires the lava / bombs / density current lit, trees
               they lit directly and trees burnt in all (the bed carries it),
               m2 of bed ignited and burnt out, houses set alight and down,
               cars engulfed and burning, the fire's own ms per frame
     ash       peak deposit, the heaviest roof and car load, roofs failed
     bombs     lithics + juvenile bombs thrown, landed, max range and muzzle
               speed, craters, what they hit
     sky       column collapses, density currents, umbrella radius, base-surge
               reach, lightning in the plume and to the ground
     cost      CPU ms per sim step of the eruption (mean / p95 / max per phase)
               and the eruption's draw calls and instanced puffs at the peak

   params: mag (0..1, default 0.8), q (quality tier 0..4: 1 ~ a phone),
           bearing (collapse bearing, rad), wind (deg), ash=0, pdc=0
   ok = every phase ran, lava ran downhill, something burned, ash landed,
        bombs landed, and a sim step stays under 4 ms mean. */
CBZ.lab.kit("eruption", {
  about: "the volcano's eruption sequence on a slope with houses, trees and cars: lava path, fires, ash, bombs, frame cost",
  // systems/volfx.js: the shared Perlin-Worley atlas the plume volume marches
  files: ["src/systems/volfx.js", "src/systems/smoketrail.js", "src/world/volcanofx.js", "src/world/eruption.js", "src/systems/lightningfx.js", "src/systems/wildfire.js"],
  params: { mag: 0.8, q: 4, wind: 8 },
  duration: 48,
  setup: function (W, P) {
    const THREE = window.THREE;
    if (P.q != null) CBZ.qualityLevel = +P.q;
    // the game has a renderer before any eruption; make the lab's now, so the
    // first texture that asks it for anisotropy is not timed as eruption cost
    if (CBZ.labWorld && CBZ.labWorld.renderer) CBZ.labWorld.renderer();
    if (CBZ.labWorld && CBZ.labWorld.floor) CBZ.labWorld.floor.visible = false;
    // the game builds the shared noise atlas in idle slices long before any
    // eruption; the lab finishes it now so the plume is drawn as in play
    if (CBZ.volNoise && CBZ.volNoise.finish && P.atlas !== "0") CBZ.volNoise.finish();
    const VX = 0, VZ = 0, PEAK = 30, VR = 36, RIM = 6.2, BOWL = 3.6, REGION = 140;
    /* the cone: concave (peak * t^1.65), a crater bowl, six V-shaped radial
       barrancos born under the rim and fading out at the foot — the same
       anatomy as the island's volcano, so the fall lines have valleys to find */
    function groundAt(x, z) {
      const dx = x - VX, dz = z - VZ, d = Math.hypot(dx, dz);
      if (d >= VR) return 0;
      if (d < RIM) { const k = d / RIM; return PEAK - BOWL * (1 - k * k); }
      const t = 1 - (d - RIM) / (VR - RIM);
      const a = Math.atan2(dz, dx);
      const c = Math.sin(a * 6 + 0.4);
      const val = c < 0 ? -Math.pow(-c, 2.2) * 2.4 : c * 0.8;
      return PEAK * Math.pow(t, 1.65) + val * Math.sin(Math.PI * Math.min(1, t * 1.15));
    }
    CBZ.floorAt = groundAt;
    W.groundAt = groundAt;
    const host = new THREE.Group(); host.name = "eruptionLab"; W.scene.add(host);
    W.root = host;
    // the terrain mesh: a polar grid dense on the cone, sparse on the plain
    {
      const RS = [], AS = 72;
      for (let r = 0; r <= VR; r += 1.5) RS.push(r);
      for (let r = VR + 4; r <= REGION + 20; r += 6) RS.push(r);
      // and out to the horizon, coarser and coarser, so a camera on the plain
      // stands on ground and the far one sees land meet the haze
      for (let r = REGION + 40; r <= 2400; r *= 1.25) RS.push(r);
      const pos = [], col = [], idx = [];
      const cRock = new THREE.Color(0x4a3b30), cGrass = new THREE.Color(0x4c6b34), c = new THREE.Color();
      for (let i = 0; i < RS.length; i++) {
        for (let j = 0; j < AS; j++) {
          const a = (j / AS) * Math.PI * 2, x = VX + Math.cos(a) * RS[i], z = VZ + Math.sin(a) * RS[i];
          pos.push(x, groundAt(x, z), z);
          c.copy(cGrass).lerp(cRock, Math.max(0, Math.min(1, 1.25 - RS[i] / VR)));
          col.push(c.r, c.g, c.b);
        }
      }
      for (let i = 0; i < RS.length - 1; i++) for (let j = 0; j < AS; j++) {
        const a = i * AS + j, b = i * AS + (j + 1) % AS, d = (i + 1) * AS + j, e = (i + 1) * AS + (j + 1) % AS;
        idx.push(a, b, d, b, e, d);   // counter-clockwise from above: the ground faces UP
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
      g.setIndex(idx); g.computeVertexNormals();
      const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true }));
      m.receiveShadow = true; m.name = "terrain"; m.userData.lab = true;
      host.add(m);
    }
    // ---- the town: houses, trees, cars (the arena's own record shapes) ----
    const buildings = [], trees = [], cars = [];
    const wallMat = new THREE.MeshLambertMaterial({ color: 0xb8a58c }), roofMat = new THREE.MeshLambertMaterial({ color: 0x6e4a3a });
    function house(x, z, w, d, storeys, name) {
      const h = storeys * 3.1, gy = groundAt(x, z);
      const g = new THREE.Group(); g.position.set(x, gy, z);
      const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat); body.position.y = h / 2; g.add(body);
      const roof = new THREE.Mesh(new THREE.BoxGeometry(w + 0.4, 0.3, d + 0.4), roofMat); roof.position.y = h + 0.15; g.add(roof);
      g.userData.lab = true; host.add(g);
      const b = { name: name, x: x, z: z, w: w, d: d, h: h, gy: gy, storeys: storeys, group: g, fallen: false };
      buildings.push(b);
      return b;
    }
    const leaf = new THREE.MeshLambertMaterial({ color: 0x2f5a2a }), bark = new THREE.MeshLambertMaterial({ color: 0x4a3524 });
    function tree(x, z) {
      const gy = groundAt(x, z);
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.25, 2.4, 6), bark.clone()); trunk.position.set(x, gy + 1.2, z);
      const fol = new THREE.Mesh(new THREE.ConeGeometry(1.6, 4, 7), leaf.clone()); fol.position.set(x, gy + 4.2, z);
      trunk.userData.lab = fol.userData.lab = true;
      host.add(trunk); host.add(fol);
      const t = { x: x, z: z, trunk: trunk, foliage: fol, burning: 0, burnt: false };
      trees.push(t);
      return t;
    }
    const carMat = new THREE.MeshLambertMaterial({ color: 0x8a1f1f });
    function car(x, z, along) {
      const gy = groundAt(x, z);
      const g = new THREE.Group(); g.position.set(x, gy, z); g.rotation.y = along ? Math.PI / 2 : 0;
      const body = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.8, 4.2), carMat); body.position.y = 0.65; g.add(body);
      const cab = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.6, 2.2), carMat); cab.position.y = 1.35; g.add(cab);
      g.userData.lab = true; host.add(g);
      const c = { x: x, z: z, group: g, oy: gy, rotY: g.rotation.y, roofH: 1.65 };
      cars.push(c);
      return c;
    }
    // a ring of houses round the foot of the cone, trees between, cars at the kerb
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + 0.13;
      house(VX + Math.cos(a) * 50, VZ + Math.sin(a) * 50, 8, 7, 1 + (i % 3 === 0 ? 1 : 0), "ring" + i);
      tree(VX + Math.cos(a + 0.26) * 44, VZ + Math.sin(a + 0.26) * 44);
      tree(VX + Math.cos(a - 0.2) * 62, VZ + Math.sin(a - 0.2) * 62);
      car(VX + Math.cos(a + 0.12) * 57, VZ + Math.sin(a + 0.12) * 57, i % 2 === 0);
      // and one parked on the ring road at the very foot of the cone
      if (i % 2 === 1) car(VX + Math.cos(a + 0.3) * 43, VZ + Math.sin(a + 0.3) * 43, i % 4 === 1);
    }
    // the downwind town, where the umbrella's fall lands
    const wd = (+P.wind || 0) * Math.PI / 180;
    const ux = Math.cos(wd), uz = Math.sin(wd);
    for (let k = 0; k < 4; k++) {
      const d = 78 + k * 14, s = (k % 2 ? 1 : -1) * 9;
      house(VX + ux * d - uz * s, VZ + uz * d + ux * s, 9, 8, 2, "downwind" + k);
      car(VX + ux * (d + 5) + uz * s * 0.3, VZ + uz * (d + 5) - ux * s * 0.3, k % 2 === 1);
    }
    W.town = { buildings: buildings, trees: trees, cars: cars };
    // ---- the lab's hooks: the visible consequences, and a log of them ----
    const log = W.marks = { fires: [], falls: [], bombs: [], strikes: 0, trees: 0 };
    const wind = function () { return { x: ux, z: uz, speed: 6 }; };
    /* THE FIRE IS THE GAME'S: the town handed to systems/wildfire.js as a
       service, the way disasters.js hands it the island (the arena record
       shape; the bare upper cone carries no bed), and the eruption's hooks
       light it exactly as the island's do */
    W.fireArena = {
      lab: true, root: host, center: { x: VX, z: VZ }, radius: REGION, oceanY: -100,
      groundHeightAt: groundAt, volcano: { x: VX, z: VZ, r: VR * 0.7 },
      flammable: trees, fragile: buildings, cars: cars,
    };
    const WF = CBZ.wildfire;
    WF.attach(W.fireArena, {
      hitBuilding: function (b, amount) { return W.erHooks.damageBuilding(b, amount, "fire"); },
      blast: function (kind) { log.blasts = (log.blasts || 0) + 1; },
      wind: wind, mag: 0.3 + 0.3 * Math.min(1, +P.mag || 0.8),
    });
    W.erHooks = {
      wind: wind,
      night: function () { return 0; },
      shake: function () {},
      sound: function () {},
      igniteTree: function (t, why) { const ok = WF.igniteTree(t, why); if (ok) log.trees++; return ok; },
      igniteGround: function (x, z, r, why) { return WF.igniteAt(x, z, why, r); },
      burnBuilding: function (b, how) {
        if (!WF.igniteBuilding(b, how)) return false;
        log.fires.push({ b: b.name, by: how, t: +W.t().toFixed(2) });
        return true;
      },
      damageBuilding: function (b, amount, kind) {
        if (b.fallen) return 3;
        b._dmg = Math.min(1.2, (b._dmg || 0) + amount);
        if (b._dmg >= 1) {
          b.fallen = true; b.group.visible = false;
          log.falls.push({ b: b.name, by: kind, t: +W.t().toFixed(2) });
        }
        return b.fallen ? 3 : (b._dmg >= 0.5 ? 2 : (b._dmg >= 0.2 ? 1 : 0));
      },
      carFire: function (c, why) { WF.igniteCar(c, why); },
      bombLand: function (info) {
        log.bombs.push({ x: +info.x.toFixed(1), z: +info.z.toFixed(1), hot: info.hot, v: +info.speed.toFixed(1), m: Math.round(info.mass), hit: info.hit ? info.hit.kind : "ground" });
      },
      groundStrike: function (x, z) { log.strikes++; if (CBZ.lightningStrike) CBZ.lightningStrike(x, z, { y: groundAt(x, z), power: 1.2, sfx: false }); },
    };
    W.site = { x: VX, z: VZ, peak: PEAK, r: VR, rim: RIM };
    /* THE MOUNTAIN AT REST BREATHES, as the island's does (world/disaster_arena.js
       builds this same fumarole on the first island frame) — which also means
       the puff atlas is painted at world build, as in the game, and not inside
       the first step the kit times */
    W.restSteam = CBZ.volcanoFx.fumarole({ vents: [{ x: VX + 2.5, y: groundAt(VX + 2.5, VZ - 1) , z: VZ - 1 }, { x: VX - 2, y: groundAt(VX - 2, VZ + 2.4), z: VZ + 2.4 }], parent: host, salt: 0x5611 });
    W.cost = { unrest: [], phreatic: [], plinian: [], over: [] };
    W.peak = { draws: 0, puffs: 0, tris: 0 };
  },
  frame: function (W) { return [W.root]; },
  script: function (W, P) {
    const M = Math.max(0.04, Math.min(1, +P.mag));
    const WARN = 6, ACTIVE = 10 + Math.round(24 * M);
    W.marks.active = ACTIVE;
    let E = null, prog = 0;
    function measureDraws() {
      let draws = 0, puffs = 0, tris = 0;
      W.root.traverse(function (o) {
        if (!o.visible) return;
        for (let p = o.parent; p; p = p.parent) if (!p.visible) return;
        if (!(o.isMesh || o.isPoints || o.isLine || o.isSprite)) return;
        if (o.userData.lab || (o.parent && o.parent.userData.lab)) return;   // the set, not the eruption
        draws++;
        const g = o.geometry;
        if (g && g.isInstancedBufferGeometry) puffs += g.instanceCount || 0;
        const n = g ? (g.index ? g.index.count : (g.attributes.position ? g.attributes.position.count : 0)) / 3 : 0;
        tris += n * (o.isInstancedMesh ? o.count : (g && g.isInstancedBufferGeometry ? g.instanceCount : 1));
      });
      if (draws > W.peak.draws) W.peak.draws = draws;
      if (puffs > W.peak.puffs) W.peak.puffs = puffs;
      if (tris > W.peak.tris) W.peak.tris = Math.round(tris);
    }
    W.every(function (dt) {
      if (W.restSteam) W.restSteam.update(dt);
      if (!E) return;
      const t0 = performance.now();
      if (E.phase === "unrest") E.unrest(dt, Math.min(1, W.t() / WARN));
      else if (E.phase !== "over") { prog = Math.min(1, E.t / ACTIVE); E.update(dt, prog); }
      else if (W.scars) for (let i = 0; i < W.scars.length; i++) W.scars[i].update(dt, null);
      const ms = performance.now() - t0;
      if (ms > 4) (W.spikes || (W.spikes = [])).push([+W.t().toFixed(2), +ms.toFixed(1), E.phase]);
      const ph = E.phase === "over" ? "over" : (E.phase === "phreatic" ? "phreatic" : E.phase);
      (W.cost[ph] || (W.cost[ph] = [])).push(ms);
      if (((W.t() * 60) | 0) % 30 === 0) measureDraws();
    });
    return [
      [0, function () {
        E = W.E = CBZ.eruption.create({
          site: W.site, groundAt: W.groundAt, parent: W.root, mag: M, rnd: Math.random,
          region: { cx: 0, cz: 0, R: 140 }, world: W.town, hooks: W.erHooks,
          collapseBearing: P.bearing != null ? +P.bearing : undefined,
          ash: P.ash !== "0", pdc: P.pdc !== "0",
        });
      }, "unrest: the summit steams, the ground hums"],
      [WARN, function () { E.erupt(); }, "the phreatic blast"],
      [WARN + ACTIVE, function () { W.scars = E.end(); }, "the director ends it: quench, wane, drift"],
    ];
  },
  probe: function (W, P) {
    const E = W.E, S = W.site, st = E.stats, g = W.groundAt;
    const r1 = function (v) { return Math.round(v * 10) / 10; };
    // the lava: read off the live flows (or the quenched scars)
    const flows = [];
    const VF = CBZ.volcanoFx;
    const audit = CBZ.volcanoAudit ? CBZ.volcanoAudit() : {};
    const tips = (audit.lavaTips || []).concat(audit.lavaScarTips || []);
    // mean ground at a radius, to say whether a nose sits in a valley
    function meanAt(r) { let s = 0; for (let k = 0; k < 36; k++) { const a = k / 36 * Math.PI * 2; s += g(S.x + Math.cos(a) * r, S.z + Math.sin(a) * r); } return s / 36; }
    const stems = E.flows || [];
    for (let i = 0; i < stems.length; i++) {
      const f = stems[i], P = f.path.pts, tp = f.tip, r = Math.hypot(tp.x - S.x, tp.z - S.z);
      // how far BELOW the cone's mean surface (same radius) the flow ran: > 0 = in a barranco
      let vs = 0, vn = 0;
      for (let k = 0; k < P.length; k++) {
        const pr = Math.hypot(P[k].x - S.x, P[k].z - S.z);
        if (pr > S.rim + 3 && pr < S.r - 3) { vs += meanAt(pr) - g(P[k].x, P[k].z); vn++; }
      }
      flows.push({ from: [r1(P[0].x), r1(P[0].z)], tip: [r1(tp.x), r1(tp.z)], noseR: r1(r), ran: r1(f.length), of: r1(f.fullLength),
        drop: r1(S.peak - tp.y), valleyDepth: vn ? r1(vs / vn) : 0, frontV: r1(f.frontSpeed) });
    }
    // the density current's lane: how deep in the barrancos it runs, like the lava
    let laneValley = 0;
    if (E.lane) {
      let vs = 0, vn = 0;
      E.lane.pts.forEach(function (q) {
        const pr = Math.hypot(q.x - S.x, q.z - S.z);
        if (pr > S.rim + 3 && pr < S.r - 3) { vs += meanAt(pr) - g(q.x, q.z); vn++; }
      });
      laneValley = vn ? r1(vs / vn) : 0;
    }
    const T = W.town;
    const lit = W.marks.fires.map(function (f) { return f.b; });
    const FA = CBZ.wildfire.audit();
    const down = W.marks.falls;
    const bs = E.bombStats;
    const cost = {};
    let worst = 0;
    Object.keys(W.cost).forEach(function (k) {
      const a = W.cost[k].slice().sort(function (x, y) { return x - y; });
      if (!a.length) return;
      const mean = a.reduce(function (s, v) { return s + v; }, 0) / a.length;
      cost[k] = { steps: a.length, mean: +mean.toFixed(3), p95: +a[Math.floor(a.length * 0.95)].toFixed(3), max: +a[a.length - 1].toFixed(3) };
      if (k === "plinian") worst = mean;
    });
    const ashPeak = st.ashPeak;
    /* look=1: THE ASH'S HUE UNDER PLAIN DAYLIGHT (the iPad "purple-ish
       speckles" report). The drift mesh alone, top-down, under a white sun +
       neutral sky, read back as numbers: mean R,G,B of the ash pixels and
       B-R (> 0 = the blue/violet cast). Rendered twice on the same geometry:
       as shipped, and with the pre-fix blue-shifted stops (old/new ratio of
       the drift's top stop, 0x585d66 / 0x5c5953, applied to the colours). */
    let look = null;
    if (P.look === "1" && E.field && E.field.mesh && CBZ.renderer) {
      const THREE = window.THREE, R = CBZ.renderer, mesh = E.field.mesh, home = mesh.parent;
      const sc = new THREE.Scene();
      const sun = new THREE.DirectionalLight(0xffffff, 1.0); sun.position.set(30, 80, 20); sc.add(sun);
      sc.add(new THREE.HemisphereLight(0xdfe6ee, 0x6a6458, 0.55));
      const cam = new THREE.OrthographicCamera(-90, 90, 90, -90, 0.1, 500);
      cam.position.set(60, 200, 0); cam.lookAt(60, 0, 0);
      const rt = new THREE.WebGLRenderTarget(160, 160);
      const px = new Uint8Array(160 * 160 * 4);
      function shoot() {
        R.setRenderTarget(rt); R.setClearColor(0x000000, 0); R.clear(); R.render(sc, cam);
        R.readRenderTargetPixels(rt, 0, 0, 160, 160, px); R.setRenderTarget(null);
        let r = 0, g2 = 0, b = 0, n = 0;
        for (let i = 0; i < px.length; i += 4) if (px[i + 3] > 0 && (px[i] + px[i + 1] + px[i + 2]) > 6) { r += px[i]; g2 += px[i + 1]; b += px[i + 2]; n++; }
        return n ? { r: Math.round(r / n), g: Math.round(g2 / n), b: Math.round(b / n), bMinusR: Math.round((b - r) / n), pixels: n } : { pixels: 0 };
      }
      sc.add(mesh);
      const now = shoot();
      const ca = mesh.geometry.attributes.color, keep = ca.array.slice();
      const kr = 88 / 92, kg = 93 / 89, kb = 102 / 83;
      for (let i = 0; i < ca.array.length; i += 3) { ca.array[i] *= kr; ca.array[i + 1] *= kg; ca.array[i + 2] *= kb; }
      ca.needsUpdate = true;
      const old = shoot();
      ca.array.set(keep); ca.needsUpdate = true;
      home.add(mesh); rt.dispose();
      look = { shipped: now, preFix: old };
    }
    const data = {
      mag: st.mag, phases: st.phase, t: +W.t().toFixed(2),
      lava: { flows: flows, liveFlows: audit.lavaFlows, scars: audit.lavaScars, branches: audit.lavaBranches },
      fire: { housesLit: lit, housesInLava: st.buildingsInLava, housesDown: down, treesLit: st.treesLit,
        treesLitBy: st.treesBy, groundFires: st.groundFires, pdcHousesLit: st.pdcBuildingsLit,
        treesBurning: FA.treesBurning, treesBurnt: FA.treesBurnt, treesTotal: FA.treesTotal, treesTorched: FA.treesTorched,
        bedIgnitedM2: FA.ignitedM2, bedBurntM2: FA.scarM2, cellsIgnited: FA.cellsIgnited, spotFires: FA.spotFires,
        firesStillBurning: FA.serving, housesFloorsBurnt: FA.floorsBurnt, housesCollapsedByFire: FA.buildingsCollapsed,
        carsEngulfed: st.carsEngulfed, carsBurning: st.carsBurning, carsBurnt: FA.carsBurnt, carsExploded: FA.carsExploded,
        fireSimMsAvg: FA.simMsAvg, fireSimMsMax: FA.simMsMax, fireFxMsAvg: FA.fxMsAvg, fireFxMsMax: FA.fxMsMax },
      ash: { peakGround: ashPeak, roofMax: st.roofAshPeak, carMax: st.carAshPeak, roofsFailed: st.roofsFailed, left: audit.ashPeakDepth || 0 },
      bombs: { lithics: st.lithics, juvenile: st.bombs, thrown: bs ? bs.thrown : 0, landed: bs ? bs.landed : 0,
        maxRange: bs ? r1(bs.maxRange) : 0, maxMuzzle: bs ? r1(bs.maxSpeed) : 0, craters: bs ? bs.craters : 0,
        hits: st.bombHits },
      sky: { pdcLaneInBarranco: laneValley, collapses: st.columnCollapses, pdc: st.pdcRuns, lahar: st.laharRuns, umbrellaR: st.umbrellaR, surgeR: st.surgeR,
        lightningInPlume: st.lightningIC, lightningToGround: st.lightningCG },
      cost: cost, spikes: (W.spikes || []).slice(0, 12), peakDraws: W.peak.draws, peakPuffs: W.peak.puffs, peakTris: W.peak.tris,
      quality: CBZ.qualityLevel, ashLook: look,
    };
    const lavaDown = flows.length > 0 && flows.every(function (f) { return f.drop > 5; });
    void tips;
    // a burp is allowed to burn nothing; anything from M 0.5 up must set the town alight
    const ok = !!(E && E.phase === "over" && lavaDown && (st.mag < 0.5 || (st.treesLit + st.buildingsLit) > 0) &&
      (P.ash === "0" || ashPeak > 0.01) && bs && bs.landed > 0 && worst < 4);
    return {
      ok: ok,
      summary: "M" + st.mag + ": " + flows.length + " lava stems (noses at r " + flows.map(function (f) { return f.noseR; }).join("/") + " m, in barrancos " + flows.map(function (f) { return f.valleyDepth; }).join("/") + " m deep), " +
        lit.length + " houses alight, " + down.length + " down, " + st.treesLit + " trees lit (lava " + st.treesBy.lava + ", bomb " + st.treesBy.bomb + ", pdc " + st.treesBy.pdc + "), " +
        FA.treesBurnt + "/" + FA.treesTotal + " trees burnt + " + FA.treesBurning + " burning; bed fires lit lava " + st.groundFires.lava + " / bomb " + st.groundFires.bomb + " / pdc " + st.groundFires.pdc +
        ", " + FA.ignitedM2 + " m2 ignited, " + FA.scarM2 + " m2 burnt out (fire " + FA.simMsAvg + "+" + FA.fxMsAvg + " ms/frame); " + st.carsEngulfed + " cars engulfed; ash peak " + ashPeak +
        " m (roof " + data.ash.roofMax + ", car " + data.ash.carMax + ", " + st.roofsFailed + " roofs failed); bombs " + (bs ? bs.landed : 0) + " landed (" + st.lithics + " lithic, " + st.bombs +
        " juvenile, " + (bs ? bs.craters : 0) + " craters, max " + data.bombs.maxRange + " m); " + st.pdcRuns + " PDC, umbrella " + st.umbrellaR + " m, " + st.lightningIC + "+" + st.lightningCG +
        " bolts; plinian step " + (cost.plinian ? cost.plinian.mean + " ms mean / " + cost.plinian.p95 + " p95" : "?") + ", peak " + W.peak.draws + " draws",
      data: data,
    };
  },
});
