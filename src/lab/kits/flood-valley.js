/* lab kit "flood-valley": the flash flood (systems/flashflood.js) on a small
   real valley: a river channel down a 2% slope to the sea, a floodplain with a
   street, four houses (porous ground floors), parked cars at three heights, a
   road underpass (a dip), manholes along the street and a road bridge over
   the river. The flood is the shipped solve, started the way the disaster
   def starts it (warning first, then the event), with the river's catchment
   inflow at the upstream end plus the storm's rain.

   lab.html?kit=flood-valley&volume=6000&cap=0
     volume   m3 the storm delivers (rain + river), default 6000
     inflow   share of it entering by the river (default 0.7)
     cap      bridge capacity in kN (0 = the engine's own default)
     warn     warning seconds (4), active seconds `active` (30)

   probe: front speed (stations down the river: when the water first stood
   10 cm deep at each, and the solver's own leading-edge celerity), max depth,
   cars stalled / floated / swept and the high-ground car that must stay put,
   bridge state (jam pieces, blockage, head, load vs capacity, failure time),
   rooms flooded, lids blown, silt left, and the frame cost (ms per frame of
   solve / bodies / surface). */
(function () {
  // THE VALLEY, analytic (the kit's terrain; the flood reads it as any
  // island would hand it over): x across, z downstream (+z), sea at the foot
  const SEA = -1.0;
  const BRIDGE_HALF = 12, BRIDGE_Z = -45;
  const CH_HALF = 5, CH_DEPTH = 1.6;
  function base(z) { return 4.4 - 0.02 * (z + 110); }          // 2 % down-valley
  function ground(x, z) {
    const ax = Math.abs(x);
    let y = base(z);
    // the channel: a rounded trapezoid 10 m wide, 1.6 m deep
    if (ax < CH_HALF + 2) { const t = Math.max(0, Math.min(1, (CH_HALF + 2 - ax) / 2)); y -= CH_DEPTH * t * t * (3 - 2 * t); }
    // the floodplain rises gently, then the valley walls
    y += 0.012 * Math.max(0, ax - CH_HALF - 2);
    if (ax > 44) y += 0.32 * (ax - 44);
    // the road underpass: a 1.2 m dip crossing the floodplain at z = 40
    if (x > 14 && x < 42) { const dz = Math.abs(z - 40); if (dz < 6) y -= 1.2 * (1 - (dz / 6) * (dz / 6)); }
    // the sea at the foot of the valley
    if (z > 96) y -= (z - 96) * 0.25;
    // THE ROAD EMBANKMENT carrying the cross road to the bridge: across the
    // whole floodplain, deck-high, so every drop of the flood has to go
    // through the bridge's opening (what makes a real bridge a dam)
    if (ax > BRIDGE_HALF - 0.5 && ax < 47) {
      const dz = Math.abs(z - BRIDGE_Z), top = 1.15 + 0.012 * (BRIDGE_HALF + 9 - ax > 0 ? 0 : 0);
      const lift = dz < 3.5 ? 1 : dz < 8 ? 1 - (dz - 3.5) / 4.5 : 0;
      if (lift > 0) { const want = base(BRIDGE_Z) + 0.012 * 2 + top; if (want > y) y += (want - y) * lift; }
    }
    return y;
  }
  const STREET_X = 22, STREET_HALF = 4;
  function onRoad(x, z) { return Math.abs(x - STREET_X) < STREET_HALF && z > -95 && z < 92; }
  const HOUSES = [[34, -20], [34, 8], [34, 62], [-30, 15]];
  const BRIDGE = { x: 0, z: BRIDGE_Z, len: 24, width: 6 };

  CBZ.lab.kit("flood-valley", {
    about: "the flash flood on a sloped valley: river, floodplain street, houses, cars, underpass, manholes and a road bridge",
    uses: [],
    files: ["src/systems/flashflood.js", "src/city/waterfield.js", "src/world/water_spec.js"],
    depth: 0,
    params: { volume: 8000, inflow: 0.7, cap: 0, warn: 4, active: 34 },
    duration: 47,
    setup: function (W, P) {
      const THREE = window.THREE;
      if (CBZ.labWorld && CBZ.labWorld.floor) CBZ.labWorld.floor.visible = false;
      CBZ.floorAt = function (x, z) { return ground(x, z); };
      const root = new THREE.Group(); root.name = "floodValley"; W.scene.add(root);
      W.root = root;
      // ---- the terrain, the street, the underpass ----
      // the whole flood domain (the solve's square grid), so no water is ever
      // drawn over ground the kit forgot to draw
      const tg = new THREE.PlaneGeometry(240, 240, 120, 120); tg.rotateX(-Math.PI / 2); tg.translate(0, 0, 3);
      const tp = tg.attributes.position, tc = new Float32Array(tp.count * 3);
      for (let i = 0; i < tp.count; i++) {
        const x = tp.getX(i), z = tp.getZ(i), y = ground(x, z);
        tp.setY(i, y);
        const road = onRoad(x, z), bed = Math.abs(x) < CH_HALF + 1;
        const c = road ? [0.09, 0.09, 0.095] : bed ? [0.16, 0.13, 0.09] : y < SEA + 0.4 ? [0.35, 0.31, 0.22] : [0.07, 0.13, 0.04];
        tc[i * 3] = c[0]; tc[i * 3 + 1] = c[1]; tc[i * 3 + 2] = c[2];
      }
      tg.setAttribute("color", new THREE.BufferAttribute(tc, 3)); tg.computeVertexNormals();
      const terrain = new THREE.Mesh(tg, new THREE.MeshLambertMaterial({ vertexColors: true }));
      terrain.receiveShadow = true; root.add(terrain);
      const sea = new THREE.Mesh(new THREE.PlaneGeometry(160, 60), new THREE.MeshLambertMaterial({ color: 0x1d3b4a }));
      sea.rotation.x = -Math.PI / 2; sea.position.set(0, SEA, 135); root.add(sea);
      // ---- houses: ground-floor slab 25 cm proud, walls, a door on -x ----
      const buildings = [];
      const wallM = new THREE.MeshLambertMaterial({ color: 0xb9ab94 });
      HOUSES.forEach(function (h) {
        const gy = ground(h[0], h[1]);
        const g = new THREE.Group(); g.position.set(h[0], gy, h[1]); root.add(g);
        const w = 9, d = 11, H = 3.2, T = 0.25;
        const slab = new THREE.Mesh(new THREE.BoxGeometry(w, 0.25, d), new THREE.MeshLambertMaterial({ color: 0x8c8378 })); slab.position.y = 0.125; g.add(slab);
        [[0, -d / 2, w, T], [0, d / 2, w, T], [w / 2, 0, T, d]].forEach(function (s) {
          const m = new THREE.Mesh(new THREE.BoxGeometry(s[2], H, s[3]), wallM); m.position.set(s[0], H / 2, s[1]); g.add(m);
        });
        // the street side, with a doorway
        [[-w / 2, -d / 2 + 2.25, 4.5], [-w / 2, d / 2 - 2.25, 4.5]].forEach(function (s) {
          const m = new THREE.Mesh(new THREE.BoxGeometry(T, H, s[2]), wallM); m.position.set(s[0], H / 2, s[1]); g.add(m);
        });
        const roof = new THREE.Mesh(new THREE.BoxGeometry(w + 0.4, 0.3, d + 0.4), new THREE.MeshLambertMaterial({ color: 0x5a3b2e })); roof.position.y = H + 0.15; g.add(roof);
        buildings.push({ x: h[0], z: h[1], w: w, d: d, floorY: gy + 0.25, door: "-x" });
      });
      // ---- the bridge: deck, parapets, two piers; its group IS the deck ----
      const bgY = ground(BRIDGE.x + 9, BRIDGE.z);                 // the bank
      const deckY = bgY + 1.15, soffitY = deckY - 0.55;
      const bg = new THREE.Group(); bg.position.set(BRIDGE.x, deckY, BRIDGE.z); root.add(bg);
      const conc = new THREE.MeshLambertMaterial({ color: 0x9a978f });
      const deck = new THREE.Mesh(new THREE.BoxGeometry(BRIDGE.len, 0.55, BRIDGE.width), conc); deck.position.y = -0.275; bg.add(deck);
      [-1, 1].forEach(function (s) { const p = new THREE.Mesh(new THREE.BoxGeometry(BRIDGE.len, 0.9, 0.25), conc); p.position.set(0, 0.45, s * (BRIDGE.width / 2 - 0.12)); bg.add(p); });
      [-3.5, 3.5].forEach(function (px) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.8, 3, BRIDGE.width - 1), conc); p.position.set(px, -0.55 - 1.5, 0); bg.add(p); });
      const deckPlat = { minX: -BRIDGE.len / 2, maxX: BRIDGE.len / 2, minZ: BRIDGE.z - BRIDGE.width / 2, maxZ: BRIDGE.z + BRIDGE.width / 2, y: deckY };
      if (CBZ.platforms) CBZ.platforms.push(deckPlat);
      const bridges = [{ x: BRIDGE.x, z: BRIDGE.z, len: BRIDGE.len, width: BRIDGE.width, ax: 1, az: 0, deckY: deckY, soffitY: soffitY,
        group: bg, platforms: [deckPlat], colliders: [], cap: (+P.cap || 0) * 1000 }];
      // ---- cars: on the street (floodplain), on the river bank, on the hill ----
      const cars = [];
      const carGeo = new THREE.BoxGeometry(1.9, 1.3, 4.3); carGeo.translate(0, 0.75, 0);
      const spots = [
        ["street-up", STREET_X - 2, -70], ["street-mid", STREET_X + 2, -10], ["street-low", STREET_X - 2, 50],
        ["bank-a", 9.5, -62], ["bank-b", -9.5, 25],
        ["hill", -52, 0],
      ];
      spots.forEach(function (s, i) {
        const y = ground(s[1], s[2]) + 0.045;
        const g = new THREE.Group(); g.position.set(s[1], y, s[2]); root.add(g);
        g.add(new THREE.Mesh(carGeo, new THREE.MeshLambertMaterial({ color: [0xb8bcc0, 0x8a1c1c, 0x1d2f4a, 0xd8d8d0, 0x222222, 0x556b2f][i % 6] })));
        const c = { minX: s[1] - 1.1, maxX: s[1] + 1.1, minZ: s[2] - 2.2, maxZ: s[2] + 2.2, noCam: true };
        if (CBZ.colliders) CBZ.colliders.push(c);
        cars.push({ name: s[0], group: g, x: s[1], z: s[2], oy: y, rotY: 0, collider: c, flung: false });
      });
      // ---- manholes every ~30 m down the street ----
      const manholes = [];
      for (let z = -80; z <= 80; z += 30) manholes.push({ x: STREET_X, z: z });
      // ---- the flood ----
      const world = {
        ground: ground, x0: -65, x1: 65, z0: -112, z1: 118, seaY: SEA,
        rivers: [{ pts: [{ x: 0, z: -108 }, { x: 0, z: 110 }], width: 10 }],
        sources: [{ x: 0, z: -104, share: 1, width: 10 }],
        bridges: bridges, buildings: buildings, cars: cars, manholes: manholes, onRoad: onRoad, parent: root,
        // the cloudburst sits over the head of the valley
        storm: { x: 0, z: -95, r: 45 },
      };
      const FF = CBZ.flashflood;
      if (!FF) throw new Error("CBZ.flashflood missing (systems/flashflood.js not loaded)");
      const t0 = performance.now();
      FF.start(world, { warnSecs: +P.warn || 4, activeSecs: +P.active || 34, volume: +P.volume || 8000, inflowShare: +P.inflow, sync: true });
      const setupMs = performance.now() - t0;
      // ---- stations down the river: when did 10 cm first stand there ----
      const stations = [-80, -40, 0, 40, 80].map(function (z) { return { z: z, x: 0, t: null }; });
      const plainSt = [-60, -20, 20, 60].map(function (z) { return { z: z, x: STREET_X, t: null }; });
      const rec = { horn: (+P.warn || 4) + (+P.active || 34), cleared: false, setupMs: setupMs, stations: stations, plain: plainSt, underpassMax: 0, wall: 0, frames: 0 };
      W.flood = rec;
      W.every(function (dt) {
        const t = W.t();
        const tw = performance.now();
        // the def's shape: tick through warning + event, then clear at the
        // horn (the flood drains itself out over its aftermath phase)
        if (!rec.cleared) {
          FF.tick(dt);
          rec.wall += performance.now() - tw; rec.frames++;
          if (t >= rec.horn) { rec.cleared = true; FF.clear({ keepSilt: true }); W.event("flood", "horn: clear (aftermath drains)"); }
        }
        if (!FF.live) return;
        // the WAVE, not the rain trickle ahead of it: a station is reached
        // when the water stands 40 cm over what it had before the front
        stations.concat(plainSt).forEach(function (s) {
          const d = FF.depthAt(s.x, s.z);
          if (s.base == null && t >= 0.5) s.base = d;
          if (s.t == null && s.base != null && d > s.base + 0.4) { s.t = t; W.event("flood", "front at (" + s.x + ", " + s.z + ") t=" + t.toFixed(2) + " depth " + d.toFixed(2)); }
        });
        const du = FF.depthAt(28, 40);
        if (du > rec.underpassMax) rec.underpassMax = du;
        if (FF.ready && CBZ.groundWaterAt) {
          const a = CBZ.groundWaterAt(0, -60), b = FF.depthAt(0, -60);
          rec.fieldAgrees = rec.fieldAgrees !== false && Math.abs(a - (b > 0.002 ? b : 0)) < 1e-6;
        }
        rec.siltAfter = FF.audit().siltLeft;
      });
    },
    frame: function (W) { return [W.root]; },
    probe: function (W, P) {
      const FF = CBZ.flashflood, r = W.flood;
      const S = FF.stats() || {};
      const st = r.stations.filter(function (s) { return s.t != null; });
      let frontSpeed = null;
      if (st.length >= 2) {
        const a = st[0], b = st[st.length - 1];
        frontSpeed = b.t > a.t ? (b.z - a.z) / (b.t - a.t) : null;
      }
      const legs = [];
      for (let i = 1; i < st.length; i++) legs.push(+((st[i].z - st[i - 1].z) / Math.max(1e-3, st[i].t - st[i - 1].t)).toFixed(2));
      const br = (S.bridges || [])[0] || {};
      const cars = S.cars || [];
      const hill = cars[5] || {};
      const msPerFrame = r.frames ? r.wall / r.frames : 0;
      const ok = st.length >= 3 && S.maxDepth > 0.8 && S.carsSwept >= 1 && !hill.swept && !hill.stalled && r.fieldAgrees !== false;
      const f2 = function (v) { return v == null ? "-" : (+v).toFixed(2); };
      const summary = "front " + f2(frontSpeed) + " m/s down the river (legs " + legs.join("/") + "; leading-edge celerity peak " + f2(S.frontSpeed) + ", mean " + f2(S.frontSpeedMean) + ")" +
        ", max depth " + f2(S.maxDepth) + " m (underpass " + f2(r.underpassMax) + ")" +
        ", cars stalled " + S.carsStalled + " / floated " + S.carsFloated + " / swept " + S.carsSwept + " of " + cars.length + (hill.swept || hill.stalled ? " (HILL CAR MOVED)" : ", hill car dry") +
        ", bridge " + (br.state || "-") + (br.failT != null ? " at " + br.failT + " s" : "") + " (jam " + br.jamPieces + ", block " + br.maxBlock + ", peak " + br.peakLoadKN + "/" + br.capKN + " kN)" +
        ", rooms flooded " + S.roomsFlooded + ", lids " + S.lidsPopped + ", silt " + (S.siltArea || 0) + " m2, tide marks " + (S.marks || 0) +
        ", frame " + msPerFrame.toFixed(2) + " ms (solve " + S.solveMsPerFrame + ", bodies " + S.bodyMsPerFrame + ", surface " + S.renderMsPerFrame + "; worst " + f2(S.worstFrameMs) + ")";
      return {
        ok: ok, summary: summary,
        data: {
          frontSpeedStations: frontSpeed, legs: legs, stations: r.stations, plain: r.plain, underpassMax: r.underpassMax,
          msPerFrame: msPerFrame, setupMs: r.setupMs, fieldAgrees: r.fieldAgrees, stats: S, events: FF.events().slice(0, 60),
        },
      };
    },
  });
})();
