/* lab kit "strike": a downtown under attack, on the game's real ordnance path.

   A 3 x 3 grid of real Gang City blocks (city/streetkit.js carriageways,
   footways and kerbs) with a real cityMakeBuilding shell on every lot, in a
   spread of facade grammars and heights (a brick walk-up to a 22-storey glass
   tower), so the hits land on the same buildings the city is made of. Every
   detonation is CBZ.detonate -> systems/impactbus.js: the same FX composers,
   blast wave, structural ledger and collapse the game runs.

   lab.html?kit=strike&run=carpet
     run   carpet   a B-52H (units/vehicles/b52.js, the real airframe and bay)
                    flies the grid's long axis at `alt` m, opens the doors,
                    and walks a stick of Mk-82s down the street; each bomb is
                    the real pooled Mk-82 body, released off its bay station
                    with the aircraft's velocity, falling under g with drag
           b2       the same run in a B-2A with Mk-84s
           missile  a salvo of cruise missiles (CBZ.strikeFX.missile) comes in
                    low over the far blocks, pops up and dives into three
                    buildings
           nuke     the nuclear row on the far side of the river: the camera
                    is `obs` m out (default 6000)
           hit      one Mk-84 straight into the tower's roof (building impact)
     alt   release altitude for carpet / b2 (default 900 m)
     obs   observer distance for nuke (m)

   probe(): bombs released / landed, detonations by kind, buildings damaged /
   collapsed, the missile flight log, and the frame cost. */
(function () {
"use strict";
const LOTS = [
  // [style, storeys, retail]
  ["brick", 4, 1], ["brutalist", 8, 0], ["intl", 22, 0],
  ["stone", 5, 1], ["artdeco", 12, 0], ["brick", 3, 1],
  ["postmodern", 16, 0], ["victorian", 4, 1], ["hightech", 10, 0],
];
const BLK = 34, ROAD = 18, LOT = 30;            // the downtown's numbers (config.js CITY)
const PITCH = BLK + ROAD;                       // centre to centre, block to block

CBZ.lab.kit("strike", {
  about: "a 3x3 downtown of real shells hit by a B-52 carpet run, a B-2 stick, a cruise missile salvo, a nuke or one Mk-84 into a tower, all through CBZ.detonate",
  uses: [],
  files: [
    "src/vendor/BufferGeometryUtils.js", "src/city/streetkit.js", "src/city/facade_openings.js", "src/city/buildings.js",
    "src/city/facade_kit.js", "src/city/facades/*.js",
    "src/systems/solidground.js", "src/systems/debris.js", "src/systems/fx.js", "src/systems/volfx.js", "src/systems/craters.js",
    "src/city/crashfx.js", "src/systems/impactbus.js", "src/city/structural.js", "src/city/fracture.js",
    "src/city/collapse.js", "src/city/crashdeform.js", "src/city/nukefx.js",
    "src/weapons/munitiontable.js", "src/systems/breach.js", "src/systems/spatialgrid.js", "src/weapons/munitions.js", "src/units/unitkit.js", "src/city/unitmodels.js",
    "src/units/vehicles/b52.js", "src/units/vehicles/b2_spirit.js", "src/units/vehicles/f35.js",
    "src/city/aircraft.js", "src/city/strategic.js", "src/city/playerair.js",
  ],
  mode: "city",
  params: { run: "carpet", alt: 900, obs: 6000, floor: 40000, sunAz: 145, sunEl: 32 },
  duration: 30,
  setup: function (W, P) {
    const THREE = window.THREE;
    const scene = W.scene;
    const f0 = scene.getObjectByName("labFloor");
    if (f0) {
      // the studio grid reads as a parking lot from 1 km up: dirt and grass instead
      f0.material = new THREE.MeshLambertMaterial({ color: 0x6f6a5c });
      f0.scale.setScalar(1);
    }
    // the shared 3D noise every volume marches: the game builds it in idle
    // slices once a city is playing; the lab finishes it now so frame one
    // is drawn as the game draws it
    if (CBZ.volNoise && CBZ.volNoise.finish) CBZ.volNoise.finish();
    // THE SUN: a morning sun, low enough to model a cloud (a high noon sun or
    // one behind the lens lights every billow flat). sunAz = the compass
    // direction it shines FROM (deg from +x toward +z), sunEl its elevation.
    if (CBZ.sun) {
      const az = (P.sunAz != null ? +P.sunAz : 145) * Math.PI / 180, el = (P.sunEl != null ? +P.sunEl : 32) * Math.PI / 180;
      const tp = CBZ.sun.target ? CBZ.sun.target.position : new THREE.Vector3();
      CBZ.sun.position.set(tp.x + Math.cos(az) * Math.cos(el) * 400, tp.y + Math.sin(el) * 400, tp.z + Math.sin(az) * Math.cos(el) * 400);
      if (CBZ.sun.shadow && CBZ.sun.shadow.camera) {
        const sc = CBZ.sun.shadow.camera; sc.left = -180; sc.right = 180; sc.top = 180; sc.bottom = -180; sc.near = 1; sc.far = 1200; sc.updateProjectionMatrix();
        CBZ.sun.shadow.mapSize.set(2048, 2048);
      }
    }
    // the far plane and the air: a city day, not a studio
    const cam = CBZ.camera;
    cam.far = 60000; cam.near = 0.5; cam.updateProjectionMatrix();
    if (scene.fog) { scene.fog.near = 900; scene.fog.far = 14000; }
    // THE DAY CYCLE'S REWRITE. In the game core/daynight.js (order 2) and
    // core/gfx.js's finalize rewrite the sun, sky light and fog every frame,
    // and the nuke and the blasts modulate those values on top, statelessly.
    // The lab has no day cycle, so without this their modulations compound
    // (a minute after a nuke the sun was overhead, orange, at 16 %).
    if (CBZ.onAlways && CBZ.sun) {
      const sun = CBZ.sun, hemi = CBZ.hemi, fog = scene.fog;
      const base = {
        sp: sun.position.clone(), si: sun.intensity, sc: sun.color.clone(),
        hi: hemi ? hemi.intensity : 0, hc: hemi ? hemi.color.clone() : null, hg: hemi && hemi.groundColor ? hemi.groundColor.clone() : null,
        fc: fog ? fog.color.clone() : null, fn: fog ? fog.near : 0, ff: fog ? fog.far : 0,
      };
      W.lightBase = base;
      CBZ.onAlways(2, function () {
        sun.position.copy(base.sp); sun.intensity = base.si; sun.color.copy(base.sc);
        if (hemi) { hemi.intensity = base.hi; hemi.color.copy(base.hc); if (base.hg) hemi.groundColor.copy(base.hg); }
        if (fog) { fog.color.copy(base.fc); fog.near = base.fn; fog.far = base.ff; }
      });
    }


    // ---- the streets: one streetkit grid, 3 x 3 blocks ----------------------
    const N = 3, half = (N * PITCH) / 2;
    const xL = [], zL = [];
    for (let i = 0; i <= N; i++) { xL.push(-half + i * PITCH); zL.push(-half + i * PITCH); }
    const root = new THREE.Group(); root.name = "strikeCity"; scene.add(root);
    W.root = root;
    let kit = null;
    if (CBZ.streetKit && CBZ.streetKit.build) {
      if (CBZ.streetKit.reset) CBZ.streetKit.reset();
      kit = CBZ.streetKit.build({
        root: root, name: "strike", surfaceName: "strike-street-surface",
        xLines: xL, zLines: zL, ROAD: ROAD, laneW: 3.6, lanesPerDir: 2, footway: 2,
        cornerR: 4.8, apron: 0, sharedMaterial: true, driveways: [],
      });
      const pad = new THREE.MeshLambertMaterial({ color: 0x8a8984 });
      const lots = [];
      for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) lots.push({ bi: i, bj: j });
      if (kit.lotMesh) kit.lotMesh("strike-lot-ground", lots, pad, 1 / 8);
    }
    // ---- the buildings ------------------------------------------------------
    W.blds = [];
    let k = 0;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const spec = LOTS[k++ % LOTS.length];
      const cx = -half + PITCH * (i + 0.5), cz = -half + PITCH * (j + 0.5);
      const opts = { district: spec[2] ? "commercial" : "core", facade: "office", dress: { style: spec[0] } };
      if (spec[2]) { opts.retail = true; opts.storefront = true; }
      const fit = CBZ.cityFitShell ? CBZ.cityFitShell(cx, cz, LOT, LOT, 1.5, spec[1], 1, opts) : { w: LOT - 3, d: LOT - 3 };
      const reach = Math.min(LOT - fit.w, LOT - fit.d) / 2;
      if (reach > 0.05) opts.reach = reach;
      let b = null;
      try { b = CBZ.cityMakeBuilding(root, cx, cz, fit.w, fit.d, spec[1], 0x8a8f96, 1, opts); } catch (e) { W.event("setup", "building " + spec[0] + " failed: " + e.message); }
      if (b) W.blds.push({ b: b, style: spec[0], storeys: spec[1], cx: cx, cz: cz, i: i, j: j });
    }
    if (CBZ.cityFlushPools) CBZ.cityFlushPools();
    // the record the city's systems read buildings from
    CBZ.city = CBZ.city || {};
    CBZ.city.buildings = W.blds.map(function (x) { return x.b; });
    W.half = half;
    W.cost = { sum: 0, max: 0, n: 0 };
    const step0 = CBZ.stepSim;
    CBZ.stepSim = function (dt) {
      const t0 = performance.now();
      const r = step0.apply(this, arguments);
      const d = performance.now() - t0; W.cost.sum += d; W.cost.n++; if (d > W.cost.max) W.cost.max = d;
      return r;
    };
    // every detonation, by kind (whoever fired it)
    W.slog = { det: {}, first: null };
    if (CBZ.detonate) {
      const det0 = CBZ.detonate;
      CBZ.detonate = function (x, y, z, kind) {
        W.slog.det[kind] = (W.slog.det[kind] || 0) + 1;
        if (W.slog.first == null) W.slog.first = +W.t().toFixed(2);
        return det0.apply(this, arguments);
      };
    }
    // the arena record playerair.js / strategic.js parent their aeroplanes and bombs to
    CBZ.city.arena = CBZ.city.arena || { root: root, center: { x: 0, z: 0 }, lots: [] };
    // the lots the structural ledger (city/structural.js) finds a hit building through
    W.blds.forEach(function (x) {
      x.lot = { x: x.cx, z: x.cz, cx: x.cx, cz: x.cz, w: LOT, d: LOT, building: x.b, i: x.i, j: x.j };
      CBZ.city.arena.lots.push(x.lot);
    });
    // WHAT THE STORYBOARD CAMERAS FOLLOW: the lead aeroplane, the lowest bomb
    // still falling, every missile in the air (tools/strike-look.mjs)
    W.camState = function () {
      const out = { bomber: null, lead: null, missiles: [] };
      const fl = CBZ.cityStrikeFlights ? CBZ.cityStrikeFlights() : [];
      for (const f of fl) for (const jt of f.jets) if (jt.pos && !out.bomber) out.bomber = { x: jt.pos.x, y: jt.pos.y, z: jt.pos.z, hx: jt.hx != null ? jt.hx : f.hx, hz: jt.hz != null ? jt.hz : f.hz };
      const bs = CBZ.strategicBombsInAir ? CBZ.strategicBombsInAir() : [];
      for (const b of bs) if (!out.lead || b.y < out.lead.y) out.lead = { x: b.x, y: b.y, z: b.z };
      const ms = CBZ.cityMissilesInAir ? CBZ.cityMissilesInAir() : [];
      for (const m of ms) out.missiles.push(m);
      return out;
    };
  },
  frame: function (W) { return [W.root]; },
  script: function (W, P) {
    const run = String(P.run || "carpet");
    const h = W.half;
    const street = -PITCH * 0.5;                 // the carriageway between the first and second rows
    if (run === "carpet" || run === "b2") {
      // THE RAID: playerair.js's strike flight (the one system for every
      // aeroplane that bombs), flown by heavies. The track runs the street
      // west to east; the stick is walked down the whole grid.
      return [[0.2, function () {
        const heavy = run === "b2" ? "b2" : "b52";
        W.flight = CBZ.cityStrikeFlight ? CBZ.cityStrikeFlight({
          x: 0, z: street, airframe: heavy, jets: run === "b2" ? 1 : 3,
          bombs: run === "b2" ? 16 : 27, kind: run === "b2" ? "bomb" : "mk82",
          from: { x: -h - 4000, z: street }, alt: +P.alt || 900, speed: 200,
          stick: (2 * h - 20), byPlayer: false, stateAct: true,
        }) : null;
        W.event("strike", W.flight ? "raid inbound: " + heavy : "no CBZ.cityStrikeFlight");
      }, "bombers inbound"]];
    }
    if (run === "called") {
      // THE CALL-IN (the bunker map table's "Call in", CBZ.strategicCallStrike):
      // twelve bombs walked north up the street through the grid's middle
      return [[0.2, function () {
        W.called = CBZ.strategicCallStrike ? CBZ.strategicCallStrike({ x: street, z: 0, count: 12, heading: 0, byPlayer: false, stateAct: true }) : null;
        W.event("strike", W.called ? "strike called" : "no CBZ.strategicCallStrike");
      }, "strike called in"]];
    }
    if (run === "missile") {
      // THREE CRUISE MISSILES, a few seconds apart, from the north-west: sea
      // skimming in, a pop-up over the last blocks, and a dive into a facade
      return [[0.2, function () {
        const tg = [W.blds[2], W.blds[4], W.blds[6]].filter(Boolean);
        W.salvo = tg.map(function (x, n) {
          return CBZ.cityCruiseMissile ? CBZ.cityCruiseMissile({
            type: "tomahawk", from: { x: -h - 3200 - n * 300, y: 40, z: h + 2200 + n * 200 },
            target: { x: x.cx, y: Math.min(x.b.h * 0.55, 36), z: x.cz }, delay: n * 2.2, byPlayer: false,
          }) : null;
        });
        W.event("strike", "salvo away: " + W.salvo.filter(Boolean).length);
      }, "salvo launched"]];
    }
    if (run === "ballistic") {
      return [[0.2, function () {
        const x = W.blds[4];
        W.salvo = [CBZ.cityBallisticMissile ? CBZ.cityBallisticMissile({ type: "iskander", target: { x: x.cx, y: x.b.h, z: x.cz }, from: { x: -60000, z: 30000 }, byPlayer: false }) : null];
        W.event("strike", W.salvo[0] ? "ballistic inbound" : "no CBZ.cityBallisticMissile");
      }, "ballistic inbound"]];
    }
    if (run === "hit") {
      // ONE Mk-84 off a rail 600 m up, through strategic.js's solved fall, onto the tower's roof
      return [[0.2, function () {
        const x = W.blds[2];
        W.bomb = CBZ.strategicRelease ? CBZ.strategicRelease("bomb", { x: x.cx - 40, y: x.b.h + 600, z: x.cz - 2 }, { vx: 3.4, vy: -2, vz: 0.1 }, { byPlayer: false, stateAct: true }) : null;
        W.event("strike", W.bomb ? "Mk-84 released" : "no CBZ.strategicRelease");
      }, "Mk-84 off the rail"]];
    }
    if (run === "det") {
      // the bus alone, no flight: one Mk-84 on the tower's face, one in the street
      return [[0.5, function () {
        const x = W.blds[2], b = x.b;
        CBZ.detonate(x.cx + b.w / 2 + 0.5, 14, x.cz, P.kind || "mk84", { byPlayer: false, dirx: -1, dirz: 0 });
      }, "Mk-84 on the tower"], [4, function () {
        CBZ.detonate(street, 0.6, street + 2, P.kind || "mk84", { byPlayer: false });
      }, "Mk-84 in the street"]];
    }
    if (run === "nuke") {
      return [[0.5, function () {
        if (CBZ.cityNukeFX) CBZ.cityNukeFX(0, 1.2, 0, { byPlayer: false, noDamage: P.dmg !== "1" });
        W.event("strike", "nuke");
      }, "detonation"]];
    }
    return [];
  },
  probe: function (W, P) {
    const blds = W.blds || [];
    let hit = 0, down = 0;
    const st = CBZ.structure;
    blds.forEach(function (x) {
      const b = x.b;
      const rec = st && st.state && x.lot ? st.state(x.lot) : null;
      x.stage = rec ? rec.stage : 0;
      if (rec && rec.stage > 0) hit++;
      if (b.fallen || b.collapsed || b.destroyed || x.lot.demolished || (rec && rec.stage >= 5)) down++;
    });
    const L = W.slog || {};
    const c = W.cost;
    const fl = CBZ.cityStrikeFlights ? CBZ.cityStrikeFlights() : [];
    const summary = (P.run || "carpet") + ": detonations " + JSON.stringify(L.det || {}) + " (first at " + L.first + " s)" +
      ", buildings hit " + hit + " / down " + down + " of " + blds.length + ", flights still up " + fl.length +
      " | frame " + (c.n ? (c.sum / c.n).toFixed(1) : "?") + " ms avg, " + c.max.toFixed(0) + " max";
    return { ok: true, summary: summary, data: { det: L.det, hit: hit, down: down } };
  },
});
})();
