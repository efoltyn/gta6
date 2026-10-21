/* lab kit "tsunami": a coast, a slope, a street of real buildings and real
   cars, and the island tsunami's water run on it — the sea draws back, the
   bore comes in over the shelf, the sea holds high, falls, and the land's
   water runs back out.

   WHAT IS REAL
     the run-up       world/tsunami_runup.js: the shallow-water field over
                      this kit's ground, its buildings porous blocks, its open
                      sea forced to the published sea (exactly as
                      systems/disasters.js attaches it on the island)
     the sea          world/water_spec.js: CBZ.waterSurgeSet (the one sea
                      level), CBZ.waterEventSet (the straight front), and
                      the field-aware waterFrontDropAt / waterEventSample /
                      waterDisasterSurfaceY; the disaster sea material
                      (makeDisasterWaterMaterial) on the shared radial sheet,
                      driven by waterDriveDisasterSurface, when frames are shot
     the wreckage     world/tsunami_debris.js's field with the run-up's own
                      flowAt / blockedAt (CBZ.tsuRunup.debrisFlow), the bore's
                      churn load (lumber, pallets, roof sections, shipping
                      containers), the real parked cars (city/vehicles.js via
                      the car ingredient) lifted at CBZ.tsuDebrisDraft.car,
                      and two dinghies off the beach (CBZ.tsunamiScene
                      .makeDinghy, the island's own hulls)
     the buildings    the building ingredient (cityMakeBuilding shells), their
                      footprints measured off their drawn bounds

   WHAT IS THE LAB'S
     the ground       one function: a shelf down to 14 m, a beach, a flat
                      town, a hollow of low ground west of it, a ridge east
                      of it, a hill behind it; drawn as one displaced plane
     the director     the event's clock below (drawdown 6 s, bore over the
                      shelf 4 s, the sea held high `hold` s, falling 5 s),
                      the same beats as systems/disasters.js TSUNAMI_V2

   lab.html?kit=tsunami&wave=6&draw=5&hold=12&style=brick
     wave   metres the sea stands over rest behind the bore (default 6)
     draw   metres the sea draws back first (default 5)
     hold   seconds the sea holds high (default 12)
     style  facade grammar for the six shells (none = bare shells)
     sea    0 = no sea sheet (numbers only, skips the texture)

   probe(): run-up distance (m inland of the rest waterline) and elevation,
   the deepest water on the land, the hollow vs the street, every building's
   outside waterline and inside (ground-floor) water, the wreckage moved /
   cars carried / boats carried / piled against walls / dragged back by the
   backwash, the land's water left at the end, and the frame cost (the
   solver + the wreckage + the texture upload, ms per 60 Hz frame).        */
CBZ.lab.kit("tsunami", {
  about: "a coast, a slope, a street of buildings and cars: the tsunami's run-up, wreckage and backwash, measured",
  uses: ["building", "car"],
  files: ["src/vendor/BufferGeometryUtils.js", "src/world/water_spec.js", "src/world/tsunami_runup.js", "src/world/tsunami_silt.js", "src/world/tsunami_debris.js", "src/world/tsunami_scene.js"],
  params: { wave: 6, draw: 5, hold: 12, style: "brick", sea: 1 },
  depth: 0,
  duration: 70,
  setup: function (W, P) {
    const THREE = window.THREE;
    const REST = -1;
    CBZ.SEA_Y = REST;                      // the lab's rest sea (city/world.js owns this in the game)
    if (CBZ.waterSurgeSet) CBZ.waterSurgeSet(0);
    const L = CBZ.labWorld;
    if (L && L.floor) L.floor.visible = false;

    // ---- THE GROUND ------------------------------------------------------
    const sm = function (a, b, x) { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
    function ground(x, z) {
      let g;
      if (z < -12) g = REST - Math.min(13, (-12 - z) * 0.16);       // the shelf
      else if (z < 0) g = REST + (z + 12) / 12;                      // the beach
      else if (z < 95) g = 0;                                         // the town
      else g = (z - 95) * 0.14;                                       // the hill behind it
      if (z > -2) {
        const lx = (x + 64) / 24, lz = (z - 48) / 32;
        g -= 1.4 * Math.max(0, 1 - lx * lx - lz * lz);               // the hollow (old marsh)
        g += Math.max(0, x - 44) * 0.12 * sm(-2, 12, z);              // the east ridge
      }
      return g;
    }
    W.ground = ground;
    const SPAN = 300, SEG = 150, CZ = 60;
    const tg = new THREE.PlaneGeometry(SPAN, SPAN, SEG, SEG);
    tg.rotateX(-Math.PI / 2);
    const tp = tg.attributes.position, col = new Float32Array(tp.count * 3);
    const cSand = new THREE.Color(0xb9a77f), cMud = new THREE.Color(0x5d5444), cGrass = new THREE.Color(0x6f7d4a), cPave = new THREE.Color(0x8b8b86);
    const c = new THREE.Color();
    for (let i = 0; i < tp.count; i++) {
      const x = tp.getX(i), z = tp.getZ(i) + CZ, y = ground(x, z);
      tp.setY(i, y); tp.setZ(i, z);
      if (y < REST - 0.3) c.copy(cMud); else if (z < 2) c.copy(cSand); else if (Math.abs(x) < 7 || (z > 2 && z < 9)) c.copy(cPave); else c.copy(cGrass);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    tg.setAttribute("color", new THREE.BufferAttribute(col, 3));
    tg.computeVertexNormals();
    const terrain = new THREE.Mesh(tg, new THREE.MeshLambertMaterial({ vertexColors: true }));
    terrain.name = "labCoast"; terrain.receiveShadow = true;
    W.scene.add(terrain);

    // ---- THE STREET: six real shells either side of a road to the sea ------
    const style = P.style && P.style !== "none" ? P.style : null;
    const blocks = [];
    const rows = [[12, 32], [40, 60], [68, 88]];
    rows.forEach(function (r, k) {
      [[-28, -8, 3], [8, 28, 2]].forEach(function (side, s) {
        const name = "house" + (k * 2 + s + 1);
        const B = W.add("building", { name: name, lot: { x0: side[0], x1: side[1], z0: r[0], z1: r[1] }, style: style, storeys: 2 + ((k + s) % 2), doorSide: side[2], setback: 1.5 });
        // the shell's own footprint, off cityMakeBuilding's record
        const rec = { name: name, x: B.b.ox, z: B.b.oz, w: B.b.w, d: B.b.d, gy: 0, h: B.b.h || 7, ref: B.b };
        blocks.push(rec);
      });
    });
    W.blocks = blocks;

    // ---- THE CARS: parked down the street and on the beach road -------------
    const parked = [[-3.2, 20, 0], [3.2, 36, 180], [-3.2, 52, 0], [3.2, 70, 180], [-3.2, 86, 0], [-36, 5, 90], [34, 5, 270]];
    W.cars = parked.map(function (p, i) { return W.add("car", { name: "car" + (i + 1), at: [p[0], p[1]], heading: p[2] }); });

    // ---- THE BOATS: two dinghies pulled up on the beach ---------------------
    W.boats = [];
    if (CBZ.tsunamiScene && CBZ.tsunamiScene.makeDinghy) {
      [[-20, -9.5, 0.9, [0.34, 0.33, 0.30]], [26, -10.5, -1.0, [0.03, 0.09, 0.20]]].forEach(function (b, i) {
        const m = CBZ.tsunamiScene.makeDinghy({ L: 3.6 + i * 0.5, paint: b[3] });
        m.rotation.set(0, 0.4 + i * 2.2, b[2]);
        m.position.set(b[0], ground(b[0], b[1]) + 0.18, b[1]);
        W.scene.add(m);
        W.boats.push(m);
      });
    }

    // ---- THE RUN-UP FIELD ---------------------------------------------------
    const F = CBZ.tsuRunup.create({ cx: 0, cz: CZ, half: 140, cell: 2.5, maxN: 160, groundAt: ground, restY: REST, blocks: blocks });
    W.field = F;
    W.ev = { t: 0, phase: "idle", ended: false };
    CBZ.tsuRunup.attach(F, {
      forcing: function (x, z) { return CBZ.waterSeaY() - CBZ.waterFrontFormulaDrop(x, z); },
      until: function (f) {
        const e = CBZ.waterEventGet();
        if (e && e.owner !== "lab-tsunami") return true;
        if (e || f._endT == null) return false;
        return f.t - f._endT > 40 || f.landVol < Math.max(40, f.peakLandVol * 0.015);
      },
    });

    // ---- THE SEA SHEET (frames only need it; the numbers never read it) -----
    const wave = { amp: 0.86, chop: 0.72, foam: 0.34, sediment: 0 };
    W.wave = wave;
    if (+P.sea !== 0 && CBZ.makeDisasterWaterMaterial && CBZ.waterBuildDisasterGeometry) {
      const mat = CBZ.makeDisasterWaterMaterial({ name: "Lab Tsunami Sea", color: 0x155878, shallowColor: 0x3195a7, amp: 0.86, chop: 0.72, foam: 0.34 });
      const sea = new THREE.Mesh(CBZ.waterBuildDisasterGeometry(2048), mat);
      sea.frustumCulled = false; sea.renderOrder = -1; sea.name = "labSea";
      W.scene.add(sea);
      W.sea = sea;
    }
    const seaSurface = function (x, z) {
      const m = CBZ.waterSeaY() - CBZ.waterFrontDropAt(x, z);
      return CBZ.waterDisasterSurfaceY(x, z, m, wave.amp, wave.chop);
    };

    // ---- THE WRECKAGE -------------------------------------------------------
    const host = new THREE.Group(); host.name = "labDebris"; W.scene.add(host);
    const D = CBZ.tsuDebrisField({
      root: host, seaY: seaSurface, groundY: ground,
      flowAt: CBZ.tsuRunup.debrisFlow(F, seaSurface, ground),
      blockedAt: function (x, z) { return !!F.blockAt(x, z); },
    });
    W.debris = D;
    W.boats.forEach(function (m) { D.takeWorld(m, "boat"); });
    // the bore's scoured load rides its toe from the moment it is in shot
    // (the director builds its field on first contact, in the sweep)
    let churned = false;

    // ---- THE CLOCK (the director's beats) -----------------------------------
    const wv = +P.wave || 6, dr = +P.draw || 5, hold = +P.hold || 12;
    const ease = function (k) { k = Math.max(0, Math.min(1, k)); return k * k * (3 - 2 * k); };
    const T_SWEEP = 6, T_LAND = 10, T_FLOOD = 12, T_DRAIN = 12 + hold, T_END = 12 + hold + 12;
    W.T = { sweep: T_SWEEP, land: T_LAND, flood: T_FLOOD, drain: T_DRAIN, end: T_END };
    const M = W.metrics = {
      frames: 0, debrisMs: 0, texMs: 0, frameMs: [], peakFrameMs: 0, maxInside: {}, carsLifted: 0,
      itemMaxZ: new Map(), atPeak: null, hollowMax: 0, streetMax: 0,
    };
    let lastFieldMs = 0;
    function publish(phase, frontS, behind, ahead, flow, sed) {
      CBZ.waterSurgeSet(behind);
      CBZ.waterEventSet({
        owner: "lab-tsunami", kind: "tsunami", phase: phase, cx: 0, cz: 0, dx: 0, dz: 1,
        frontS: frontS, frontWet: -2, frontWidth: 20, aheadDrop: Math.max(0, behind - ahead),
        level: CBZ.waterSeaY(), waveAmp: wave.amp, chopAmp: wave.chop, sediment: sed, flow: flow,
      });
      W.ev.phase = phase; W.ev.frontS = frontS;
      wave.sediment = sed;
    }
    W.every(function (dt) {
      const t = W.t();
      let front = null;
      if (t < T_SWEEP) publish("warn", -1e4, -dr * ease(t / T_SWEEP), -dr * ease(t / T_SWEEP), -0.5 * (t / T_SWEEP), 0);
      else if (t < T_LAND) {
        const u = (t - T_SWEEP) / (T_LAND - T_SWEEP), fS = -150 + 138 * u;
        if (!churned) { churned = true; D.churn({ cars: [], halfW: 90, nBoards: 14, nPallets: 7, nRoofs: 3, nContainers: 3 }); }
        publish("sweep", fS, wv, -dr, 4.2, 0.62 * u);
        front = { x: 0, z: fS, dx: 0, dz: 1, H: wv + dr + 2, seaY: REST - dr, turbid: 0.62 * u, t: t, v: 34, land: u * 0.8 };
      } else if (t < T_FLOOD) {
        const u = (t - T_LAND) / (T_FLOOD - T_LAND);
        publish("sweep", -12 + 320 * u, wv, -dr + (wv + dr) * ease(u), 4.2, 0.9);
      } else if (t < T_DRAIN) publish("flooded", 1e4, wv, wv, 1.6, 0.95);
      else if (t < T_END) {
        // the sea falls in 5 s past rest to the next trough (half the
        // drawdown), and eases back to rest over the last 4 s (the director's
        // drain, systems/disasters.js)
        const a = t - T_DRAIN, left = T_END - t;
        const trough = -0.5 * dr * Math.min(1, Math.max(0, (left - 0.3) / 4));
        const lv = a < 5 ? wv + (trough - wv) * ease(a / 5) : trough;
        const k = Math.max(0, lv) / wv;
        publish("drain", 1e4, lv, lv, -(1.8 + 7.4 * k), 0.55 + 0.45 * k);
      } else if (!W.ev.ended) {
        W.ev.ended = true;
        CBZ.waterSurgeSet(0); CBZ.waterEventClear("lab-tsunami");
        F._endT = F.t;
        F.after.push(function () { F.seep = Math.min(0.08, 0.006 * (F.t - F._endT)); });
        W.event("tsunami", "event over: the sea is back, the land drains on its own");
      }
      // the wreckage, on the water as it is now
      let t0 = performance.now();
      const live = CBZ.tsuRunup.current() === F;
      // cars: lifted off the street at the published draft
      for (let i = 0; i < W.cars.length; i++) {
        const h = W.cars[i];
        if (h.lifted || !live) continue;
        const r = F.sample(h.car.pos.x, h.car.pos.z, {});
        if (r.in > 0 && r.depth >= CBZ.tsuDebrisDraft.car) {
          h.lifted = true; h.car.dead = true; M.carsLifted++;
          const ci = CBZ.colliders.indexOf(h.car.collider); if (ci >= 0) CBZ.colliders.splice(ci, 1);
          const it = D.takeWorld(h.obj, "car");
          if (it) { it.vx = r.u * 0.4; it.vz = r.v * 0.4; it.labName = h.name; }
          W.event(h.name, "afloat in " + r.depth.toFixed(2) + " m of water");
        }
      }
      if (live || t < T_END + 40) D.step(dt, { dx: 0, dz: 1, flow: 0, sediment: wave.sediment, front: front });
      const debMs = performance.now() - t0;
      t0 = performance.now();
      if (W.sea && live) {
        W.sea.position.y = CBZ.waterSeaY();
        CBZ.waterDriveDisasterSurface(W.sea, { amp: wave.amp, chop: wave.chop, foam: wave.foam, sediment: wave.sediment, frontC: [0, 0], frontDir: [0, 1], frontS: W.ev.frontS || -1e4, aheadDrop: (CBZ.waterEventGet() || {}).aheadDrop || 0, flowSpeed: 1.5 });
      } else if (W.sea) {
        W.sea.position.y = CBZ.waterSeaY();
        CBZ.waterDriveDisasterSurface(W.sea, { amp: wave.amp, chop: wave.chop, sediment: 0, aheadDrop: 0 });
      }
      const texMs = performance.now() - t0;
      // the solver ran inside stepSim (order 28.3); its own clock
      const st = F.stats();
      const fieldTotal = st.msTotal;
      const fieldMs = fieldTotal - lastFieldMs; lastFieldMs = fieldTotal;
      const fm = fieldMs + debMs + texMs;
      M.frames++; M.debrisMs += debMs; M.texMs += texMs; M.frameMs.push(fm);
      if (fm > M.peakFrameMs) M.peakFrameMs = fm;
      // the books
      for (let b = 0; b < F.blocks.length; b++) {
        const B = F.blocks[b];
        if (B.inLvl > (M.maxInside[b] != null ? M.maxInside[b] : -99)) M.maxInside[b] = B.inLvl;
      }
      const its = D.items();
      for (let i = 0; i < its.length; i++) {
        const it = its[i]; if (!it.obj || it.churn) continue;
        const z = M.itemMaxZ.get(it);
        if (z == null || it.z > z) M.itemMaxZ.set(it, it.z);
      }
      const hk = F.sample(-64, 48, {}), sk = F.sample(0, 48, {});
      if (hk.depth > M.hollowMax) M.hollowMax = hk.depth;
      if (sk.depth > M.streetMax) M.streetMax = sk.depth;
      if (!M.atPeak || F.landVol >= M.atPeak.landVolM3) M.atPeak = Object.assign({ t: +t.toFixed(2) }, { landVolM3: Math.round(F.landVol) });
    });
    W.watch("tsunami", "phase", function () { return W.ev.phase; });
  },
  frame: function (W) { return W.blocks ? W.get("house1") ? [W.get("house1").root, W.get("house6").root] : [] : []; },
  probe: function (W, P) {
    const F = W.field, D = W.debris, M = W.metrics;
    const S = F.stats(), ds = D.stats();
    const r1 = function (v) { return Math.round(v * 10) / 10; }, r2 = function (v) { return Math.round(v * 100) / 100; };
    // the facade waterlines (outside) and the ground floors (inside)
    const houses = F.blocks.map(function (B, i) {
      const rec = W.blocks[i] || {};
      return { name: rec.name, waterlineM: B.rimLvl > -90 ? r2(B.rimLvl - (rec.gy || 0)) : 0, insideM: M.maxInside[i] != null && M.maxInside[i] > -90 ? r2(M.maxInside[i] - (rec.gy || 0)) : 0, peakHV2: r1(B.maxHV2) };
    });
    // the backwash: pieces whose last position is well seaward of the
    // farthest inland they got
    let draggedBack = 0, toSea = 0, maxBack = 0;
    D.items().forEach(function (it) {
      if (!it.obj || it.churn) return;
      const z = M.itemMaxZ.get(it);
      if (z == null) return;
      const back = z - it.z;
      if (back > 3) draggedBack++;
      if (back > maxBack) maxBack = back;
      if (it.z < -12) toSea++;
    });
    const fm = M.frameMs.slice().sort(function (a, b) { return a - b; });
    const mean = fm.reduce(function (a, b) { return a + b; }, 0) / Math.max(1, fm.length);
    const p95 = fm.length ? fm[Math.floor(fm.length * 0.95)] : 0;
    const frame = { meanMs: r2(mean), p95Ms: r2(p95), peakMs: r2(M.peakFrameMs), solverMsPerStep: S.msMean, solverPeakMs: S.msMax, debrisMsPerFrame: r2(M.debrisMs / Math.max(1, M.frames)), textureMsPerFrame: r2(M.texMs / Math.max(1, M.frames)), grid: S.n + "x" + S.n + " @ " + S.cell + " m" };
    // the backwash is real when the land has given a good share of its peak
    // back to the sea and wreckage went seaward with it
    const ok = S.runupDistM > 30 && S.maxDepthM > 1 && ds.carsCarried >= 1 && ds.moved >= 5 && F.landVol < F.peakLandVol * 0.7 && draggedBack >= 1 && mean < 4;
    const summary = "run-up " + S.runupDistM + " m inland, " + S.runupElevM + " m up; deepest " + S.maxDepthM + " m (hollow " + r2(M.hollowMax) + " m vs street " + r2(M.streetMax) + " m); " +
      S.buildingsWet + "/" + S.buildings + " buildings wet; debris moved " + ds.moved + ", cars carried " + ds.carsCarried + "/" + W.cars.length + ", boats " + ds.boatsCarried + "/" + W.boats.length +
      ", piled " + ds.piled + ", dragged back " + draggedBack + " (" + toSea + " to the sea); land water " + Math.round(F.landVol) + "/" + Math.round(F.peakLandVol) + " m3 left; frame " + frame.meanMs + " ms mean, " + frame.p95Ms + " p95";
    return {
      ok: ok, summary: summary,
      data: { runup: S, debris: ds, houses: houses, backwash: { draggedBack: draggedBack, toSea: toSea, maxBackM: r1(maxBack) }, frame: frame,
        hollowMaxM: r2(M.hollowMax), streetMaxM: r2(M.streetMax), carsLifted: M.carsLifted, peak: M.atPeak, beats: W.T },
    };
  },
});
