/* lab kit "meteor": systems/meteor.js on a small island of its own.

   A rolling terrain (flat basin in the middle, hills out past 70 m), ~800
   trees in rings out to 265 m, 18 two-storey houses glazed on all four faces
   at 35-240 m, 27 parked cars at 30-230 m, all in the SAME record shapes the
   survival island publishes (flammable / fragile / cars / glass), so the
   meteor reads this world through the same adapter it reads the island with.
   The ground is real: solidground.js's floorAt over this terrain, the crater
   is world/groundshaft.js through systems/craters.js, the glass shards and
   ejecta through debris.js / fx.js, the flames are the wildfire's.

   One body falls on ground zero (0, 0); the observer (the camera, which is
   the listener every bang is scheduled for) stands `obs` metres east.

   lab.html?kit=meteor&event=airburst
     event   airburst (Chelyabinsk-class, default) | tunguska (low airburst) |
             impact (iron, cratering) | shower (many small bodies)
     obs     observer distance from ground zero (m, default 150)
     alt     override the burst altitude (m)

   probe(): crater size, windows broken by distance band, trees flattened /
   leaning / stripped / burning, cars pushed (how far, rolled), buildings hit
   and gutted, the shock's arrival delay at the observer against slant/c, and
   the frame cost of the meteor's own tick and of the whole sim step. */
(function () {
  const H = function (x, z) {
    // the terrain: a flat basin round ground zero, rolling hills beyond
    const r = Math.hypot(x, z);
    const k = r < 70 ? 0 : r > 150 ? 1 : (function (u) { return u * u * (3 - 2 * u); })((r - 70) / 80);
    const hills = 7 * Math.sin(x / 47 + 1.3) * Math.cos(z / 59 - 0.4) + 4 * Math.sin((x + z) / 33);
    const ripple = 0.25 * Math.sin(x / 13) * Math.cos(z / 17);
    return 2 + ripple + k * (hills + 6);
  };

  CBZ.lab.kit("meteor", {
    about: "a meteor on a tiny island (terrain, trees, glazed houses, cars): airburst / tunguska / impact / shower; probe = crater, glass by distance, trees, cars, shock delay, frame cost",
    uses: [],
    files: ["src/systems/solidground.js", "src/world/groundshaft.js", "src/systems/craters.js", "src/systems/debris.js",
      "src/systems/fx.js", "src/systems/wildfire.js", "src/systems/meteor.js"],
    mode: "survival",
    // the mode file is the real game's survival loop (bots, director, HUD);
    // the kit stands in its arena record instead (setup)
    skip: ["src/modes/survival.js"],
    params: { event: "airburst", obs: 150 },
    duration: 14,
    setup: function (W, P) {
      const THREE = window.THREE;
      const root = new THREE.Group(); root.name = "meteorIsland"; W.scene.add(root);
      if (window.CBZ.lab && W.scene) { const f = W.scene.getObjectByName("labFloor"); if (f) f.visible = false; }
      if (CBZ.registerGroundBase) CBZ.registerGroundBase("survival", H);

      // ---- terrain ----
      const S = 600, N = 120;
      const tg = new THREE.PlaneGeometry(S, S, N, N); tg.rotateX(-Math.PI / 2);
      const pa = tg.attributes.position.array, col = new Float32Array(pa.length);
      for (let i = 0; i < pa.length; i += 3) {
        const y = H(pa[i], pa[i + 2]); pa[i + 1] = y;
        const n = Math.sin(pa[i] * 0.31) * Math.cos(pa[i + 2] * 0.27) * 0.04;
        col[i] = 0.30 + n; col[i + 1] = 0.42 + n + (y - 2) * 0.004; col[i + 2] = 0.20 + n;
      }
      tg.setAttribute("color", new THREE.BufferAttribute(col, 3));
      tg.computeVertexNormals();
      const ground = new THREE.Mesh(tg, new THREE.MeshLambertMaterial({ vertexColors: true }));
      ground.receiveShadow = true; ground.name = "terrain";
      root.add(ground);

      const rand = CBZ.lab.rand;
      const fragile = [], flammable = [], cars = [], glass = [];
      const taken = [];
      const free = function (x, z, r) { for (const t of taken) if (Math.hypot(t.x - x, t.z - z) < t.r + r) return false; return true; };

      // ---- houses: three bearings per ring, glazed on all four faces ----
      const wallMat = new THREE.MeshLambertMaterial({ color: 0xb9ad98 });
      const roofMat = new THREE.MeshLambertMaterial({ color: 0x6b4a3a });
      const glassMat = new THREE.MeshLambertMaterial({ color: 0x9fc4d6, transparent: true, opacity: 0.55 });
      const paneGeo = new THREE.PlaneGeometry(1.2, 1.3);
      [35, 60, 90, 130, 180, 240].forEach(function (d, ri) {
        for (let k = 0; k < 3; k++) {
          const a = (k / 3) * Math.PI * 2 + ri * 0.7 + 0.35;
          const x = Math.cos(a) * d, z = Math.sin(a) * d, gy = H(x, z);
          const w = 10, dd = 8, h = 6.4, g = new THREE.Group();
          g.position.set(x, gy, z); root.add(g);
          const shell = new THREE.Mesh(new THREE.BoxGeometry(w, h, dd), wallMat); shell.position.y = h / 2; g.add(shell);
          const roof = new THREE.Mesh(new THREE.BoxGeometry(w + 0.6, 0.4, dd + 0.6), roofMat); roof.position.y = h + 0.2; g.add(roof);
          const b = { x, z, ox: x, oz: z, w, d: dd, h, gy, storeys: 2, group: g, fallen: false, colliders: [], platforms: [] };
          for (let s2 = 0; s2 < 2; s2++) for (let f = 0; f < 4; f++) for (let c = 0; c < 3; c++) {
            const along = (c - 1) * (f < 2 ? 3 : 2.4);
            const lx = f < 2 ? along : (f === 2 ? -w / 2 - 0.02 : w / 2 + 0.02);
            const lz = f < 2 ? (f === 0 ? -dd / 2 - 0.02 : dd / 2 + 0.02) : along;
            const m = new THREE.Mesh(paneGeo, glassMat);
            m.position.set(lx, 1.6 + s2 * 3.2, lz);
            m.rotation.y = f < 2 ? 0 : Math.PI / 2;
            g.add(m);
            glass.push({ mesh: m, x: x + lx, y: gy + m.position.y, z: z + lz, span: 0.6, shattered: false, house: fragile.length });
          }
          fragile.push(b);
          taken.push({ x, z, r: 9 });
        }
      });
      // ---- parked cars ----
      const bodyMat = new THREE.MeshLambertMaterial({ color: 0x8a2a2a });
      const cabMat = new THREE.MeshLambertMaterial({ color: 0x2a3036 });
      [30, 45, 60, 75, 90, 110, 140, 180, 230].forEach(function (d, ri) {
        for (let k = 0; k < 3; k++) {
          const a = (k / 3) * Math.PI * 2 + ri * 1.1 + 1.9;
          const x = Math.cos(a) * d, z = Math.sin(a) * d;
          if (!free(x, z, 3)) continue;
          const gy = H(x, z), g = new THREE.Group();
          g.position.set(x, gy + 0.045, z); g.rotation.y = rand() * Math.PI; root.add(g);
          const body = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.8, 4.4), bodyMat); body.position.y = 0.6; g.add(body);
          const cab = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.6, 2.2), cabMat); cab.position.y = 1.3; g.add(cab);
          const c = { minX: x - 1.6, maxX: x + 1.6, minZ: z - 1.6, maxZ: z + 1.6, ref: body, noCam: true };
          if (CBZ.colliders) CBZ.colliders.push(c);
          cars.push({ group: g, x, z, oy: g.position.y, rotY: g.rotation.y, collider: c, flung: false, ring: d });
          taken.push({ x, z, r: 3 });
        }
      });
      // ---- trees: rings out to 265 m (the island's broadleaf: trunk + crown) ----
      const trunkGeo = new THREE.CylinderGeometry(0.16, 0.26, 1, 6); trunkGeo.translate(0, 0.5, 0);
      const crownGeo = new THREE.IcosahedronGeometry(1.9, 1);
      for (let d = 22; d <= 265; d += 11) {
        const n = Math.round(2 * Math.PI * d / 22);
        for (let k = 0; k < n; k++) {
          const a = (k / n) * Math.PI * 2 + d * 0.13 + (rand() - 0.5) * 0.08;
          const x = Math.cos(a) * d, z = Math.sin(a) * d;
          if (!free(x, z, 2.2)) continue;
          const gy = H(x, z), th = 4 + rand() * 2.5;
          const trunk = new THREE.Mesh(trunkGeo, new THREE.MeshLambertMaterial({ color: 0x6e5a48 }));
          trunk.position.set(x, gy - 0.2, z); trunk.scale.set(1, th + 1.2, 1);
          const foliage = new THREE.Mesh(crownGeo, new THREE.MeshLambertMaterial({ color: 0x3f7a3a }));
          foliage.position.set(x, gy + th + 1.2, z);
          root.add(trunk); root.add(foliage);
          const tc = { minX: x - 0.25, maxX: x + 0.25, minZ: z - 0.25, maxZ: z + 0.25, ref: trunk, noCam: true };
          if (CBZ.colliders) CBZ.colliders.push(tc);
          flammable.push({ x, z, trunk, foliage, trunkCol: tc, leafHex: 0x3f7a3a, barkHex: 0x6e5a48, burning: 0, burnt: false, ring: d });
        }
      }

      const world = {
        root, groundHeightAt: H, fragile, flammable, cars, glass,
        center: { x: 0, z: 0 }, radius: 280,
        randomPoint: function (a, b) { const t = rand() * Math.PI * 2, r = a + rand() * (b - a); return { x: Math.cos(t) * r, z: Math.sin(t) * r }; },
      };
      W.island = world;
      // THE SURVIVAL STUB: groundshaft/craters/fx read the arena through
      // CBZ.surv; no actors here (the def prices those, not this file).
      // Assigned by computed key: a fallback, not a provision (see labworld).
      const SK = "surv";
      CBZ[SK] = { arena: world, forEachActor: function () {}, hurtRadius: function () {}, hurt: function () {}, actors: function () { return []; } };

      // the observer: the camera is the listener every bang is scheduled for
      const obs = +P.obs || 150;
      CBZ.camera.position.set(obs, H(obs, 0) + 1.7, 0);
      CBZ.camera.lookAt(0, 40, 0);
      W.obs = obs;

      // frame cost: the meteor's own tick, and the whole sim step
      W.cost = { meteor: [], step: [] };
      const orig = CBZ.stepSim;
      CBZ.stepSim = function (dt) { const t0 = performance.now(); orig(dt); W.cost.step.push(performance.now() - t0); };
      CBZ.onUpdate(27.4, function (dt) {
        if (!CBZ.meteor || !CBZ.meteor.live()) return;
        const t0 = performance.now(); CBZ.meteor.tick(dt); W.cost.meteor.push(performance.now() - t0);
      });
      W.totals = { panes: glass.length, trees: flammable.length, cars: cars.length, houses: fragile.length };
    },
    frame: function (W) { return [W.island.root]; },
    script: function (W, P) {
      const ev = String(P.event || "airburst");
      const cls = { airburst: "chelyabinsk", chelyabinsk: "chelyabinsk", tunguska: "tunguska", impact: "impact" }[ev];
      return [
        [0.1, function () {
          CBZ.meteor.begin({ root: W.island.root, floor: W.island.groundHeightAt, rnd: CBZ.lab.rand, cx: 0, cz: 0, R: 280, intensity: 0.6, world: W.island });
          if (ev === "shower") CBZ.meteor.shower({ rate: 6, pop: 0.18, ground: 0.07 });
        }, "the meteor event begins (radiant rolled)"],
        [0.4, function () {
          if (!cls) return;
          const s = { x: 0, z: 0, cls: cls, eta: 3 };
          if (P.alt != null) s.alt = +P.alt;
          CBZ.meteor.strike(s);
          W.flashAt = 3.4;
        }, cls ? cls + " body inbound, eta 3 s" : "shower running"],
      ];
    },
    probe: function (W, P) {
      const A = CBZ.meteorAudit ? CBZ.meteorAudit() : {};
      const I = W.island;
      const bands = [[0, 50], [50, 100], [100, 150], [150, 200], [200, 300]];
      const glass = {};
      bands.forEach(function (b) {
        let n = 0, k = 0;
        I.glass.forEach(function (g) { const d = Math.hypot(g.x, g.z); if (d >= b[0] && d < b[1]) { n++; if (g.shattered) k++; } });
        if (n) glass[b[0] + "-" + b[1] + "m"] = k + "/" + n;
      });
      const treeBands = {};
      bands.forEach(function (b) {
        let n = 0, down = 0, lean = 0, strip = 0;
        I.flammable.forEach(function (t) { const d = Math.hypot(t.x, t.z); if (d >= b[0] && d < b[1]) { n++; if (t._mDown === "down") down++; else if (t._mDown === "stripped") strip++; else if (t._mLean) lean++; } });
        if (n) treeBands[b[0] + "-" + b[1] + "m"] = "down " + down + " stripped " + strip + " lean " + lean + " /" + n;
      });
      const cars = I.cars.filter(function (c) { return c._mHome; }).map(function (c) {
        return { at: Math.round(c.ring), moved: c._mMoved != null ? c._mMoved : +Math.hypot(c.group.position.x - c._mHome.x, c.group.position.z - c._mHome.z).toFixed(2), rolled: !!c._mRolled };
      });
      const houses = I.fragile.map(function (b) { return { at: Math.round(Math.hypot(b.x, b.z)), kPa: b._meteorKPa || 0, gutted: !!b._meteorGutted }; }).filter(function (h) { return h.kPa > 0; });
      const pct = function (arr, q) { if (!arr.length) return 0; const s = arr.slice().sort(function (a, b) { return a - b; }); return +s[Math.min(s.length - 1, Math.floor(q * s.length))].toFixed(3); };
      const mean = function (arr) { return arr.length ? +(arr.reduce(function (a, b) { return a + b; }, 0) / arr.length).toFixed(3) : 0; };
      const cost = {
        meteorTick: { mean: mean(W.cost.meteor), p95: pct(W.cost.meteor, 0.95), max: pct(W.cost.meteor, 1) },
        simStep: { mean: mean(W.cost.step), p95: pct(W.cost.step, 0.95), max: pct(W.cost.step, 1) },
        frames: W.cost.step.length,
        simStepMaxAt: +((W.cost.step.indexOf(Math.max.apply(null, W.cost.step.length ? W.cost.step : [0])) + 1) / 60).toFixed(2),
        meteorTickMaxAt: W.cost.meteor.length ? +((W.cost.meteor.indexOf(Math.max.apply(null, W.cost.meteor)) + 1) / 60 + 0.1).toFixed(2) : 0,
        impactFrameParts: A.impactMs || null,
      };
      const law = CBZ.meteor.law;
      const arr = (A.arrivals || []).filter(function (x) { return x.big; })[0] || (A.arrivals || [])[0] || null;
      const crater = (A.craters || []).filter(function (c) { return c.r >= 5; })[0] || null;
      const shock = arr ? { observerAt: arr.d, burstAlt: arr.alt, kPaThere: arr.kPa, delay: arr.delay, predicted: arr.predicted, err: +(arr.delay - arr.predicted).toFixed(3), soundSpeed: law.SOUND_SPEED } : null;
      const ev = String(P.event || "airburst");
      const data = {
        event: ev, totals: W.totals,
        crater: crater, cratersAll: A.craters, craterAudit: CBZ.craterAudit ? CBZ.craterAudit() : null,
        glassBroken: A.panes, glassByDistance: glass,
        trees: { down: A.treesDown, stripped: A.treesStripped, leaning: A.treesLeaning, burning: A.treesBurning, furthestFelled: A.maxFellD, byDistance: treeBands },
        cars: { pushed: A.carsPushed, rolled: A.carsRolled, maxMove: A.carMaxMove, list: cars },
        houses: { hit: houses.length, gutted: A.bldgGutted, list: houses },
        shock: shock, bangs: { scheduled: A.bangsScheduled, heard: A.bangsHeard, flashToBangLast: A.flashToBangLast },
        sky: { bolides: A.bolidesSpawned, fragments: A.fragments, flares: A.flares, airbursts: A.airbursts, groundImpacts: A.groundImpacts, streaks: A.streaksSpawned, smokeLive: A.smokeLive },
        ejecta: { thrown: A.ejecta, landed: A.ejectaLanded, secondaries: A.secondaries, fires: A.fires },
        lastBurst: A.lastBurst, lastImpact: A.lastImpact, cost: cost,
      };
      let ok = !!shock || ev === "shower";
      if (shock) ok = ok && Math.abs(shock.err) < 0.05;
      if (ev === "airburst") ok = ok && A.panes > 0 && A.treesDown === 0;
      if (ev === "tunguska") ok = ok && A.treesDown > 0;
      if (ev === "impact") ok = ok && !!crater && crater.dug && A.treesDown > 0 && A.carsPushed > 0;
      if (ev === "shower") ok = A.bolidesSpawned > 10;
      const parts = [ev];
      if (crater) parts.push("crater R " + crater.r + " m (D " + crater.D + ", rim " + crater.rim + " m, dug " + crater.dug + ")");
      parts.push("glass " + A.panes + "/" + W.totals.panes, "trees down " + A.treesDown + " stripped " + A.treesStripped + " lean " + A.treesLeaning,
        "cars pushed " + A.carsPushed + " rolled " + A.carsRolled + " max " + A.carMaxMove + " m", "houses gutted " + A.bldgGutted);
      if (shock) parts.push("shock at " + shock.observerAt + " m: " + shock.delay + " s (slant/c " + shock.predicted + ")");
      parts.push("meteor tick " + cost.meteorTick.mean + "/" + cost.meteorTick.p95 + "/" + cost.meteorTick.max + " ms (mean/p95/max)");
      return { ok: ok, summary: parts.join(", "), data: data };
    },
  });
})();
