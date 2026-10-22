/* ============================================================
   world/archipelago.js — ISLANDS, KILOMETRES APART, ON ONE SEA.

   Owner, 2026-10-22: "Gang City is stupidly sized. It should be built like
   the natural disaster game, as islands, each very far away from each
   other, so they load in when you get close, and by putting them far on the
   horizon the game can load ultra fast, and even fast planes can look good
   flying over."

   THE IDEA. The sea ends sightlines the way the jail's walls do. Only the
   island you are on (or flying to) exists in full; every other island is
   its own far form standing in the haze, one draw call each. The islands
   are the disaster island's package (world/disaster_arena.js islandSteps,
   the same builder, the same code path: CBZ.islandBuild with an offset, a
   style and a seed), laid out by world/archipelago_map.js, which is data.

   WHAT BUILDS AT LOAD (the boot path):
     the sea (one sheet, CBZ.islandMakeSea, sized to the haze) and the
     abyssal floor under it; for every island its TERRAIN PHASE (the plan and
     the ground function: no meshes, ~30 ms) and its far form from that; the
     spawn island IN FULL. Nothing else.

   AS YOU MOVE (a tick on the loop's always-chain, once per frame):
     * an island whose shore comes within view.build m of you, plus the
       ground you will cover in LEAD seconds at your speed if you are heading
       at it, starts building: in slices, a few milliseconds a frame (more as
       you close on it faster than it is building), hidden, out past the haze
       line where nothing can be seen to grow;
     * built, its programs are queued (core/fxwarm.js) and it is shown, and
       its far form DISSOLVES off it (core/sight.js's dithered crossfade,
       the far form over the near one): never a pop;
     * the nearest whole island is THE island: CBZ.surv.arena (what every
       island system reads, the machines world/island_vehicles.js stands, the
       people), the island the shared sea and ground answer for
       (CBZ.islandActivate), the shore field the sea is baked against;
     * an island past view.drop m behind you that is not the island fades its
       far form back in and is DISPOSED (CBZ.islandDispose: colliders,
       platforms, frame hooks, stairs, lifts, GPU buffers). One full island at
       a time, two during a handover.
     Its far form was drawn first from the plan; once it has been built it is
     redrawn from the real buildings it stood (their footprints, roofs and
     shell colours), so the copy on the horizon is that island's own.

   THE GROUND between and across the islands is one function (groundAt): the
   whole island where it stands built, its terrain phase where it does not
   yet, and the abyssal plain everywhere else.

   PEOPLE are the island's own (entities/survivorbot.js's crowd, the
   island's people), stood on the island in force at points nobody is
   looking at, and gone with it. They are the island's witnesses too (city/
   peds.js cityTagWitnesses asks them, city/law.js takes their calls).
   TRAFFIC, POLICE, WANTED: Gang City's own, on the island in force
   (world/island_town.js presents it as a town: city/vehicles.js drives its
   streets, city/traffic.js keeps its pool, city/police.js runs its force out
   of its station, world/island_police.js). An island dropped behind you takes
   its cars and officers with it (CBZ.islandTownDrop).

   API
     CBZ.archipelago.state()   what is standing, building, far; the island
     CBZ.archipelago.isles()   the live records
     CBZ.archipelago.groundAt(x, z)
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const g = CBZ.game;
  const MODE = "archipelago";
  const DEV = CBZ.deviceClass || "";
  const SMALL = DEV === "phone" || DEV === "tablet";

  const DEEP = 62;                 // the abyssal plain (disaster_arena.js's shelf stops there)
  const LEAD = 9;                  // s of travel an island is built ahead of
  const FADE_S = 1.2;              // the far/near crossfade
  const WARM_S = 0.35;             // a built island's programs link before it is drawn
  /* THE FRAME'S SHARE. Every piece of streaming work (the build, joining the
     physics, the people, the sea life moving over, the teardown) is a
     resumable step, and all of it together gets this many milliseconds a
     frame, measured, never a slice count: 4 on a phone or tablet, 6 on a
     desktop, rising to at most 8 / 12 only while an island would otherwise
     arrive before it is whole. The build starts early enough for that: the
     lead is learned from how long the last island actually took here. */
  const BUDGET_MS = SMALL ? 4 : 6;
  const BUDGET_MAX = SMALL ? 8 : 12;
  const SWITCH_HYST = 250;         // m nearer another whole island must be to become THE island
  const PEOPLE = SMALL ? 14 : 28;

  const ST = {
    built: false,
    map: null,
    root: null, sea: null, floor: null,
    isles: [],
    active: null,
    camSave: null,
    vel: { x: 0, z: 0, px: 0, pz: 0, has: false, t: 0 },
    chores: [],          // resumable work besides the build: { it, label }
    workMs: SMALL ? 9000 : 4000,   // what one island's build costs on this device (learned)
    lifeArena: null,     // the stand-in the sea life was stocked under
    lastT: 0,
  };
  // the far forms' crossfade: distance never decides it (a swap a world
  // away), the per-island ready uniform does
  const SWAP_NEVER = { value: 1e7 };

  /* ---- THE MAP ------------------------------------------------------------ */
  function readMap() {
    const M = CBZ.ARCHIPELAGO_MAP || { origin: { x: 0, z: 30000 }, islands: [] };
    const o = M.origin || { x: 0, z: 0 };
    const v = Object.assign({ fogNear: 420, fogFar: 5600, build: 2100, drop: 3300 }, M.view || {});
    let spawn = M.spawn;
    try { const q = new URLSearchParams(location.search).get("isles"); if (q) spawn = q; } catch (e) {}
    const isles = (M.islands || []).map(function (d) {
      return { def: d, id: d.id, name: d.name || d.id, x: o.x + (+d.x || 0), z: o.z + (+d.z || 0), R: +d.R || 240,
        terrain: null, far: null, farMat: null, ready: { value: 0 }, refined: false,
        job: null, arena: null, state: "far", t: 0 };
    });
    return { name: M.name || "", view: v, spawn: spawn, isles: isles };
  }
  function islandOpts(I, extra) {
    return Object.assign({ id: I.id, cx: I.x, cz: I.z, R: I.R, seed: I.def.seed | 0, style: I.def.style || "harbour",
      airstrip: !!I.def.airstrip, sea: ST.sea, world: MODE }, extra || {});
  }

  /* ---- THE GROUND, EVERYWHERE ------------------------------------------- */
  function groundAt(x, z) {
    const L = ST.isles;
    for (let i = 0; i < L.length; i++) {
      const I = L[i], reach = I.R + 760;
      const dx = x - I.x, dz = z - I.z;
      if (dx > reach || dx < -reach || dz > reach || dz < -reach) continue;
      if (I.arena) return I.arena.groundHeightAt(x, z);
      if (I.terrain) return I.terrain.groundAt(x, z);
    }
    return -DEEP;
  }
  CBZ.registerGroundBase(MODE, groundAt);

  /* ---- THE FAR FORM: THAT island, simplified -----------------------------
     One merged, vertex-coloured mesh: its land (the real ground function on
     a radial grid out through the beach, the same grass colour law, rock up
     the volcano), its quay, breakwater and runway, every building as its
     footprint to its roof in its own shell colour, every tree as a crown.
     `blocks` is [{x0, x1, z0, z1, y0, y1, wall, roof}] — the plan's lots at
     first, the built island's records once it has stood. */
  const _c = new THREE.Color();
  function lin(hex) { _c.setHex(hex); return [_c.r, _c.g, _c.b]; }
  function farGeometry(T, blocks, trees) {
    const pos = [], col = [], idx = [];
    const sea = T.oceanY, cx = T.cx, cz = T.cz, R = T.R;
    // the land: rings dense at the coast, 64 sectors
    const SECT = 64, rings = [];
    for (let i = 0; i <= 12; i++) rings.push(R * Math.pow(i / 12, 0.7));
    for (const o of [4, 10, 18, 26, 40]) rings.push(R + o);
    const c3 = [0, 0, 0], SAND = [0.40, 0.325, 0.205], ROCK = [0.075, 0.064, 0.052], WET = [0.18, 0.15, 0.10];
    const base = pos.length / 3;
    for (let i = 0; i < rings.length; i++) {
      const r = rings[i], n = i === 0 ? 1 : SECT;
      for (let j = 0; j < n; j++) {
        const a = j / SECT * Math.PI * 2;
        const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
        let y = T.groundAt(x, z);
        if (i === rings.length - 1) y = Math.min(y, sea - 3);    // the rim tucks under the sea
        pos.push(x, y, z);
        if (r <= R) {
          T.grassColorAt(x, z, c3);
          const k = Math.max(0, Math.min(1, (y - 10) / 22));      // grass gives out up the volcano
          for (let q = 0; q < 3; q++) c3[q] += (ROCK[q] - c3[q]) * k;
          col.push(c3[0], c3[1], c3[2]);
        } else {
          const w = y < sea + 0.1 ? 1 : 0;
          col.push(SAND[0] + (WET[0] - SAND[0]) * w, SAND[1] + (WET[1] - SAND[1]) * w, SAND[2] + (WET[2] - SAND[2]) * w);
        }
      }
    }
    // centre fan, then quads ring to ring
    for (let j = 0; j < SECT; j++) idx.push(base, base + 1 + ((j + 1) % SECT), base + 1 + j);
    for (let i = 1; i < rings.length - 1; i++) {
      const a0 = base + 1 + (i - 1) * SECT, b0 = a0 + SECT;
      for (let j = 0; j < SECT; j++) {
        const j1 = (j + 1) % SECT;
        idx.push(a0 + j, a0 + j1, b0 + j, a0 + j1, b0 + j1, b0 + j);
      }
    }
    // boxes: buildings, the quay, the breakwater, the runway
    // (each face its own four vertices: r128's Lambert lights per vertex, so a
    // box with shared corners would shade as a blob)
    const FACES = [[0, 4, 5, 1], [1, 5, 6, 2], [2, 6, 7, 3], [3, 7, 4, 0], [4, 7, 6, 5]];
    function box(x0, x1, y0, y1, z0, z1, wall, roof) {
      const V = [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]];
      for (let f = 0; f < FACES.length; f++) {
        const F = FACES[f], b = pos.length / 3, c = f === 4 ? roof : wall;
        for (let k = 0; k < 4; k++) { const v = V[F[k]]; pos.push(v[0], v[1], v[2]); col.push(c[0], c[1], c[2]); }
        idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
      }
    }
    for (const B of blocks) box(B.x0, B.x1, B.y0, B.y1, B.z0, B.z1, B.wall, B.roof);
    const P = T.plan;
    if (P && P.harbour) {
      const Q = P.harbour.quay, CON = [0.22, 0.21, 0.195];
      box(Q.x0, Q.x1, sea - 2, Q.top, Q.z0, Q.z1, CON, CON);
      const BW = P.harbour.breakwater || [], hw = P.harbour.half || 3, RK = [0.09, 0.085, 0.075];
      for (const s of BW) box(Math.min(s.ax, s.bx) - hw, Math.max(s.ax, s.bx) + hw, sea - 2, P.harbour.crest || 1.5,
        Math.min(s.az, s.bz) - hw, Math.max(s.az, s.bz) + hw, RK, RK);
    }
    if (P && P.airstrip) {
      const A = P.airstrip;
      box(A.x0, A.x1, sea - 3, A.deck, A.z0, A.z1, [0.20, 0.195, 0.18], [0.07, 0.07, 0.072]);
    }
    // trees: a squat crown on a stalk (an octahedron), canopy green
    const LEAF = [0.030, 0.065, 0.020];
    for (const t of trees) {
      const b = pos.length / 3, r = t.r, y = t.y;
      pos.push(t.x, y + r * 2.1, t.z, t.x + r, y + r, t.z, t.x, y + r, t.z + r, t.x - r, y + r, t.z, t.x, y + r, t.z - r, t.x, y, t.z);
      for (let k = 0; k < 6; k++) col.push(LEAF[0], LEAF[1], LEAF[2]);
      idx.push(b, b + 2, b + 1, b, b + 3, b + 2, b, b + 4, b + 3, b, b + 1, b + 4,
        b + 5, b + 1, b + 2, b + 5, b + 2, b + 3, b + 5, b + 3, b + 4, b + 5, b + 4, b + 1);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    return geo;
  }
  // the plan's version: every lot to its storeys, in the colour its shell will wear
  function planBlocks(T) {
    const out = [], P = T.plan;
    if (!P) return out;
    for (const l of P.lots) {
      const wall = lin(T.lotColor(l)), roof = [wall[0] * 0.62, wall[1] * 0.62, wall[2] * 0.62];
      const gy = l.gy != null ? l.gy : 0;
      const h = (l.kind === "station" ? 1 : Math.max(1, l.storeys || 1)) * T.FH + (l.kind === "tower" || l.kind === "hotel" ? 2.4 : 0.6);
      out.push({ x0: l.bx0, x1: l.bx1, z0: l.bz0, z1: l.bz1, y0: gy - 0.4, y1: gy + h, wall: wall, roof: roof });
    }
    return out;
  }
  function planTrees(T) {
    const out = [], P = T.plan;
    if (!P) return out;
    for (const t of P.trees) out.push({ x: t.x, z: t.z, y: T.groundAt(t.x, t.z) + 1.5, r: t.kind === "palm" ? 2.0 : 2.6 });
    return out;
  }
  // the built version: the records the island stood (footprint, roof, shell colour)
  function realBlocks(A) {
    const out = [];
    for (const b of A.fragile || []) {
      if (!b || b.fallen) continue;
      const wall = lin(b.color != null ? b.color : 0x9a948a), rf = b.roofHex != null ? lin(b.roofHex) : wall;
      const top = Math.max(b.roofY != null ? b.roofY : b.gy + b.h, b.liftTop != null ? b.gy + b.liftTop : -1e9, b.gy + b.h);
      out.push({ x0: b.x - b.w / 2, x1: b.x + b.w / 2, z0: b.z - b.d / 2, z1: b.z + b.d / 2, y0: b.gy - 0.4, y1: top + 0.5,
        wall: wall, roof: [rf[0] * 0.62, rf[1] * 0.62, rf[2] * 0.62] });
    }
    return out;
  }
  function realTrees(A) {
    const out = [];
    for (const t of A.flammable || []) {
      const y = t.trunk && t.trunk.position ? t.trunk.position.y : (A.groundHeightAt ? A.groundHeightAt(t.x, t.z) : 0);
      out.push({ x: t.x, z: t.z, y: y + 1.5, r: t.palm ? 2.0 : 2.6 });
    }
    return out;
  }
  function makeFar(I, geo) {
    if (I.far) {
      const old = I.far.geometry;
      I.far.geometry = geo;
      if (old) old.dispose();
      return;
    }
    const m = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true });
    m.name = "archipelago-far-" + I.id;
    // (no permanent polygon offset: it would lift the far form's drowned
    // beach through the sea; cover() pulls it forward only while the two
    // forms of one island overlap, during a crossfade)
    if (CBZ.sightFade) CBZ.sightFade(m, "far", { anchor: "world", swap: SWAP_NEVER, ready: I.ready });
    const mesh = new THREE.Mesh(geo, m);
    mesh.name = "archipelago-far-" + I.id;
    mesh.matrixAutoUpdate = false; mesh.updateMatrix();
    I.far = mesh; I.farMat = m;
    ST.root.add(mesh);
  }

  /* ---- THE SEA AND ITS FLOOR -------------------------------------------- */
  // (the sheet is made once a session: its material joins water_spec.js's
  // list of seas for good, so a second visit reuses it)
  let seaKeep = null, seaSpan = 0;
  function buildSea(view) {
    const span = Math.max(2048, (view.fogFar + 400) / 0.78);
    if (!seaKeep || seaSpan !== span) { seaKeep = CBZ.islandMakeSea ? CBZ.islandMakeSea(span) : null; seaSpan = span; }
    const sea = seaKeep;
    if (sea) ST.root.add(sea);
    ST.sea = sea;
    // the abyssal plain: one disc under the whole visible sea, on the camera
    const fg = new THREE.CircleGeometry(view.fogFar + 600, 48);
    fg.rotateX(-Math.PI / 2);
    const fm = new THREE.MeshLambertMaterial({ color: 0x060d15 });
    fm.name = "archipelago-abyss";      // never water/ocean/sea (test contract)
    const floor = new THREE.Mesh(fg, fm);
    floor.name = "archipelago-abyss";
    floor.position.y = -DEEP - 0.6;
    floor.frustumCulled = false;
    ST.root.add(floor);
    ST.floor = floor;
  }

  /* ---- BUILD / SHOW / DROP ---------------------------------------------- */
  function startJob(I) {
    if (I.job || I.arena) return;
    I.job = CBZ.islandBuild(islandOpts(I, { hidden: true }));
    I.state = "building"; I.t = 0;
  }
  function jobDone(I) {
    const job = I.job;
    if (!job.arena) {                    // a failed build stays a far form
      console.error("[archipelago] " + I.id + " did not build", job.failed);
      try { CBZ.islandDispose(job); } catch (e) {}
      I.job = null; I.state = "far"; I.failedAt = performance.now();
      return;
    }
    I.arena = job.arena;
    if (!I.terrain) I.terrain = job.terrain;
    ST.workMs = ST.workMs * 0.5 + job.ms * 0.5;
    // what is left before it can be shown, each its own step: its far form
    // redrawn from what it actually stood, its programs queued, its walls
    // joining the physics
    I.state = "warming"; I.t = 0; I.warmDone = false;
    chore(I.id + ":warm", (function* () {
      try { makeFar(I, farGeometry(I.terrain || job.terrain, realBlocks(I.arena), realTrees(I.arena))); I.refined = true; } catch (e) { console.error("[archipelago far]", e); }
      yield 0;
      try { if (CBZ.shaderQueue) CBZ.shaderQueue(I.arena.root, { full: true }); } catch (e) {}
      yield 0;
      if (job.attachSteps) yield* job.attachSteps(); else if (job.attach) job.attach();
      I.warmDone = true;
    })());
  }
  // resumable work, run under the frame's share (tick below)
  function chore(label, it) { ST.chores.push({ label: label, it: it }); }
  // the far form wins its ties with the near one while they dissolve into each other
  function cover(I, on) {
    const m = I.farMat;
    if (!m) return;
    m.polygonOffset = !!on;
    m.polygonOffsetFactor = on ? -1 : 0;
    m.polygonOffsetUnits = on ? -4 : 0;
  }
  function showNear(I) {
    // (its walls, floors and sight lines joined the world while it warmed)
    I.arena.root.visible = true;
    I.ready.value = 0;
    if (I.far) I.far.visible = true;
    cover(I, true);
    I.state = "fadeIn"; I.t = 0;
  }
  function beginDrop(I) {
    if (I.far) I.far.visible = true;
    cover(I, true);
    I.state = "fadeOut"; I.t = 0;
  }
  // what the player is in (a jet, a boat) is parented under the island it
  // came from: it leaves with the player, never with the island
  function rescue(root) {
    const P = CBZ.player, to = ST.active && ST.active.arena ? ST.active.arena.root : ST.root;
    if (!P || !root || to === root) return;
    for (const m of [P._aircraft, P.driving ? P._vehicle : null]) {
      const grp = m && m.group;
      if (!grp) continue;
      for (let p = grp.parent; p; p = p.parent) if (p === root) { to.add(grp); break; }
    }
  }
  function dropNear(I) {
    if (I === ST.active) return;
    if (I.arena) rescue(I.arena.root);
    // its traffic, its officers and its station's fittings go with it
    if (I.arena && CBZ.islandTownDrop) { try { CBZ.islandTownDrop(I.arena); } catch (e) { console.error("[archipelago town drop]", e); } }
    // taken down a frame's share at a time (registries first, then the GPU)
    const job = I.job;
    if (job) chore(I.id + ":drop", CBZ.islandDisposeSteps ? CBZ.islandDisposeSteps(job) : (function* () { CBZ.islandDispose(job); })());
    I.job = null; I.arena = null;
    I.ready.value = 0;
    cover(I, false);
    I.state = "far"; I.t = 0;
  }

  /* ---- THE ISLAND IN FORCE ---------------------------------------------- */
  function activate(I) {
    const prev = ST.active;
    ST.active = I;
    const A = I.arena;
    if (CBZ.surv) CBZ.surv.arena = A;
    if (CBZ.islandActivate) CBZ.islandActivate(A, groundAt);
    if (A.island) CBZ.island = A.island;
    // the sea learns this island's shore (a slice a frame, water_spec.js)
    if (ST.sea && CBZ.waterSetField && A.bakeShoreField) { const f = A.bakeShoreField(); if (f) CBZ.waterSetField(ST.sea, f); }
    // its people: the last island's leave with it, this one's are stood
    // where nobody is looking, one at a time; its sea fills from the last one's
    if (prev !== I) {
      if (CBZ.clearSurvivorBots) CBZ.clearSurvivorBots();
      chore(I.id + ":people", populate(A));
      if (prev) chore(I.id + ":sealife", migrateLife(A));
    }
  }
  const _v = new THREE.Vector3();
  function unseen(x, y, z) {
    const cam = CBZ.camera;
    if (!cam) return true;
    if (Math.hypot(cam.position.x - x, cam.position.z - z) < 90) return false;
    _v.set(x, y, z).project(cam);
    const onScreen = _v.z > -1 && _v.z < 1 && Math.abs(_v.x) < 1.25 && Math.abs(_v.y) < 1.25;
    return !onScreen || Math.hypot(cam.position.x - x, cam.position.z - z) > ST.map.view.fogFar;
  }
  function* populate(A) {
    if (!CBZ.spawnSurvivorBotAt || !A.randomPoint) return;
    const minD = A.hills && A.hills[0] ? 12 : 0;
    let placed = 0;
    for (let k = 0; k < PEOPLE * 6 && placed < PEOPLE; k++) {
      if (ST.active && ST.active.arena !== A) return;        // the island changed again
      const p = A.randomPoint(minD, A.radius * 0.82);
      const y = A.groundHeightAt(p.x, p.z);
      if (!unseen(p.x, y + 1, p.z)) continue;
      try { CBZ.spawnSurvivorBotAt(p.x, p.z); placed++; } catch (e) { return; }
      yield 0;
    }
  }
  /* THE SEA LIFE (city/wildlife.js, the shark sim's and the disaster island's
     own population) is stocked ONCE for the archipelago, round the spawn
     island, under the archipelago's own root. When another island takes
     over, every school still round the last one and out of anybody's sight
     is moved across to water round the new one, a few a step: the same
     animals, never a second stocking. */
  function stockLife(A) {
    if (!CBZ.cityWildlifeStock || !ST.root) return;
    ST.lifeArena = { root: ST.root, center: { x: A.center.x, z: A.center.z }, radius: A.radius, archipelago: true };
    try { CBZ.cityWildlifeStock(ST.lifeArena); } catch (e) { console.error("[archipelago sea life]", e); }
  }
  function* migrateLife(A) {
    const L = CBZ.cityWildlife, WF = CBZ.waterField;
    if (!L || !L.length || !WF || !WF.randomWaterPoint) return;
    const cam = CBZ.camera;
    const far = function (x, z) { return !cam || Math.hypot(cam.position.x - x, cam.position.z - z) > 1200; };
    const seen = new Set();
    let rs = 0x5eed;
    const rnd = function () { rs = (Math.imul(rs, 1103515245) + 12345) & 0x7fffffff; return rs / 0x7fffffff; };
    for (let i = 0; i < L.length; i++) {
      const a = L[i];
      if (!a || a.dead || !a.species || !a.species.aquatic || !a.pos) continue;
      const hr = a.herd;
      if (hr && seen.has(hr)) continue;
      if (hr) seen.add(hr);
      const members = hr ? hr.members : [a];
      // a school round the new island already, or one somebody can see, stays
      if (Math.hypot(a.pos.x - A.center.x, a.pos.z - A.center.z) < A.radius + 1800) continue;
      if (!members.every(function (m) { return far(m.pos.x, m.pos.z); })) continue;
      let to = null;
      for (let t = 0; t < 6 && !to; t++) {
        const q = WF.randomWaterPoint(rnd, { cx: A.center.x, cz: A.center.z, r0: A.radius + 60, r1: A.radius + 1400, clearance: 12 });
        if (q && far(q.x, q.z)) to = q;
      }
      if (!to) continue;
      const dx = to.x - a.pos.x, dz = to.z - a.pos.z;
      for (const m of members) {
        if (!m || !m.pos) continue;
        m.pos.x += dx; m.pos.z += dz;
        if (m.home) { m.home.x += dx; m.home.z += dz; }
      }
      if (hr) { hr.cx = (hr.cx || 0) + dx; hr.cz = (hr.cz || 0) + dz; }
      yield 0;
    }
  }

  /* ---- THE BOOT -------------------------------------------------------- */
  function boot() {
    if (ST.built) return;
    ST.map = readMap();
    ST.isles = ST.map.isles;
    ST.root = new THREE.Group();
    ST.root.name = "archipelago";
    CBZ.scene.add(ST.root);
    buildSea(ST.map.view);
    let spawnI = ST.isles.find(function (I) { return I.id === ST.map.spawn; }) || ST.isles[0];
    if (!spawnI) { ST.built = true; return; }
    // the spawn island, whole (its terrain phase comes with it)
    spawnI.job = CBZ.islandBuild(islandOpts(spawnI));
    spawnI.job.finish();
    if (spawnI.job.arena) {
      spawnI.job.attach();
      // what an island costs to build on THIS device, first measured here (a
      // first build pays for every cache, so a warm one is ~0.7 of it)
      ST.workMs = Math.max(1500, spawnI.job.ms * 0.7);
      spawnI.arena = spawnI.job.arena;
      spawnI.terrain = spawnI.job.terrain;
      spawnI.arena.root.visible = true;
      spawnI.state = "near";
    } else { spawnI.job = null; }
    // every other island as data, and every far form
    for (const I of ST.isles) {
      if (!I.terrain) { try { I.terrain = CBZ.islandTerrain(islandOpts(I)); } catch (e) { console.error("[archipelago terrain " + I.id + "]", e); } }
      if (!I.terrain) continue;
      try {
        const geo = I.arena ? farGeometry(I.terrain, realBlocks(I.arena), realTrees(I.arena)) : farGeometry(I.terrain, planBlocks(I.terrain), planTrees(I.terrain));
        makeFar(I, geo);
        I.refined = !!I.arena;
      } catch (e) { console.error("[archipelago far " + I.id + "]", e); }
      if (I.state === "near" && I.far) { I.far.visible = false; I.ready.value = 1; }
    }
    ST.built = true;
    if (spawnI.arena) { activate(spawnI); stockLife(spawnI.arena); }
    // the boot is behind the loading card: do its people now
    for (const c of ST.chores.splice(0)) { for (let r = c.it.next(); !r.done; r = c.it.next()) {} }
  }
  // leaving the mode takes the whole archipelago down (systems/state.js
  // setMode calls CBZ.archipelagoExit before the next mode builds, so the
  // island crowd is cleared before that mode stands its own)
  function mine(A) { return !!A && ST.isles.some(function (I) { return I.arena === A; }); }
  function teardown(clearPeople) {
    if (!ST.built) return;
    if (clearPeople && CBZ.clearSurvivorBots) { try { CBZ.clearSurvivorBots(); } catch (e) {} }
    const P = CBZ.player;
    if (P && P._aircraft && P._aircraft._world === MODE && CBZ.cityPlayerAircraftExit) { try { CBZ.cityPlayerAircraftExit(); } catch (e) {} }
    if (P && P.driving && P._vehicle && P._vehicle._world === MODE && CBZ.cityExitVehicle) { try { CBZ.cityExitVehicle(); } catch (e) {} }
    // the island force, the island traffic and the wanted state end with the islands
    if (CBZ.islandTownLeave) { try { CBZ.islandTownLeave(); } catch (e) { console.error("[archipelago town leave]", e); } }
    // the island machines (world/island_vehicles.js): the jet, the boat, the
    // cars, the helipad and its stair, if they stand on one of these islands
    const IV = CBZ.islandVehicles;
    if (IV && IV.leave && IV.arenaOf && mine(IV.arenaOf())) { try { IV.leave(); } catch (e) { console.error("[archipelago machines]", e); } }
    // (work that was mid-way finishes now: a half-taken-down island is not left behind)
    for (const c of ST.chores.splice(0)) { try { for (let r = c.it.next(); !r.done; r = c.it.next()) {} } catch (e) {} }
    const ownSurv = CBZ.surv && mine(CBZ.surv.arena);
    const ownActive = CBZ.islandActive && mine(CBZ.islandActive());
    for (const I of ST.isles) {
      if (I.job) { try { CBZ.islandDispose(I.job); } catch (e) {} }
      I.job = null; I.arena = null;
      if (I.far) { I.far.geometry.dispose(); if (I.farMat) I.farMat.dispose(); I.far = null; }
    }
    if (ST.root && ST.root.parent) ST.root.parent.remove(ST.root);
    if (ST.sea && ST.root) ST.root.remove(ST.sea);
    if (ST.floor) { ST.floor.geometry.dispose(); ST.floor.material.dispose(); }
    ST.root = ST.sea = ST.floor = null;
    ST.isles = []; ST.active = null; ST.built = false;
    if (ownSurv) CBZ.surv.arena = null;
    if (ownActive && CBZ.islandForget) CBZ.islandForget();
    if (ST.camSave && CBZ.camera) {
      CBZ.camera.far = ST.camSave.far; CBZ.camera.near = ST.camSave.near;
      CBZ.camera.updateProjectionMatrix();
    }
    ST.camSave = null;
  }

  /* ---- THE TICK: once a frame, on the always-chain ---------------------- */
  function tick(dt) {
    if (!ST.built) return;
    if (g.mode !== MODE) { teardown(false); return; }
    // the eye's reach, and the haze, are the archipelago's
    const cam = CBZ.camera, V = ST.map.view, P = CBZ.player;
    if (cam) {
      if (!ST.camSave) ST.camSave = { far: cam.far, near: cam.near };
      const air = !!(P && P._aircraft);
      // (the near plane buys depth precision at range: a waterline 2 km off
      // flickers on a 0.1 m plane; nothing in a seat or a cockpit is closer)
      const wantFar = V.fogFar + 700, wantNear = air ? 0.75 : (P && P.driving ? 0.5 : 0.2);
      if (cam.far !== wantFar || cam.near !== wantNear) { cam.far = wantFar; cam.near = wantNear; cam.updateProjectionMatrix(); }
    }
    if (ST.floor && cam) { ST.floor.position.x = cam.position.x; ST.floor.position.z = cam.position.z; }
    if (g.state !== "playing" || !P || !P.pos) return;
    // the body's ground velocity (smoothed), for building ahead of it
    const now = performance.now(), Vl = ST.vel;
    if (!Vl.has) { Vl.has = true; Vl.px = P.pos.x; Vl.pz = P.pos.z; Vl.t = now; }
    else if (now - Vl.t > 100) {
      const s = (now - Vl.t) / 1000, vx = (P.pos.x - Vl.px) / s, vz = (P.pos.z - Vl.pz) / s;
      if (Math.hypot(vx, vz) < 600) { const k = Math.min(1, s / 0.5); Vl.x += (vx - Vl.x) * k; Vl.z += (vz - Vl.z) * k; }
      Vl.px = P.pos.x; Vl.pz = P.pos.z; Vl.t = now;
    }
    const speed = Math.hypot(Vl.x, Vl.z);
    const px = P.pos.x, pz = P.pos.z;
    const fdt = Math.min(0.1, Math.max(0, dt || 0));

    let building = null;
    for (const I of ST.isles) if (I.state === "building") { building = I; break; }
    for (const I of ST.isles) {
      const d = Math.hypot(I.x - px, I.z - pz), shore = d - I.R;
      // heading at it: the ground the next LEAD seconds cover counts
      const toward = speed > 3 && d > 1 ? Math.max(0, (Vl.x * (I.x - px) + Vl.z * (I.z - pz)) / (speed * d)) : 0;
      // the lead: what the last island took here, at the frame's share, in seconds
      const leadS = Math.max(LEAD, ST.workMs / (BUDGET_MS * 60) * 1.15);
      const want = shore < V.build + Math.min(V.fogFar, speed * leadS * toward);
      I._shore = shore; I._closing = speed * toward;
      if (I.state === "far") {
        if (want && !(I.failedAt && now - I.failedAt < 20000)) { if (!building) { startJob(I); building = I; } }
        else if (I.far && !I.far.visible) I.far.visible = true;
      } else if (I.state === "warming") {
        I.t += fdt;
        if (I.t >= WARM_S && I.warmDone) showNear(I);
      } else if (I.state === "fadeIn") {
        I.t += fdt;
        I.ready.value = Math.min(1, I.t / FADE_S);
        if (I.ready.value >= 1) { I.state = "near"; if (I.far) I.far.visible = false; cover(I, false); }
      } else if (I.state === "near") {
        if (shore > V.drop && I !== ST.active) beginDrop(I);
      } else if (I.state === "fadeOut") {
        I.t += fdt;
        I.ready.value = Math.max(0, 1 - I.t / FADE_S);
        if (shore < V.drop * 0.9) { I.state = "fadeIn"; I.t = I.ready.value * FADE_S; }
        else if (I.ready.value <= 0) dropNear(I);
      }
    }
    // THE FRAME'S SHARE, measured: the chores, then the build in what is left
    let ms = BUDGET_MS;
    if (building && building.state === "building" && building._closing > 3) {
      const I = building, job = I.job;
      const eta = Math.max(0.5, (I._shore - 600) / I._closing);         // s until it is in plain view
      const left = Math.max(0, ST.workMs - job.ms);                     // ms of building left (learned)
      ms = Math.min(BUDGET_MAX, Math.max(ms, left / (eta * 60) * 1.25));
    }
    const until = now + ms;
    // (a teardown waits while a build is mid-building: it unregisters stair
    // links, and a half-built building turns its own by their index)
    const midBuild = !!(building && building.state === "building");
    while (performance.now() < until) {
      const k = ST.chores.findIndex(function (c) { return !(midBuild && /:drop$/.test(c.label)); });
      if (k < 0) break;
      const c = ST.chores[k];
      let r;
      try { r = c.it.next(); } catch (e) { console.error("[archipelago " + c.label + "]", e); r = { done: true }; }
      if (r.done) ST.chores.splice(k, 1);
    }
    if (building && building.state === "building") {
      const left = until - performance.now();
      if (left > 0.5) building.job.step(left);
      if (building.job.done) jobDone(building);
    }
    // the island in force: the nearest whole one
    let best = ST.active, bd = best && best.arena ? Math.hypot(best.x - px, best.z - pz) - best.R : 1e9;
    for (const I of ST.isles) {
      if (!I.arena || I === ST.active || (I.state !== "near" && I.state !== "fadeIn")) continue;
      const d = Math.hypot(I.x - px, I.z - pz) - I.R;
      if (d < bd - SWITCH_HYST) { best = I; bd = d; }
    }
    // (never while a build is mid-building: its records are turned to face
    // their streets when each building is finished, and the machines a new
    // island stands, its helipad stair among them, must not land in between)
    if (best && best !== ST.active && best.arena && !(building && building.state === "building")) activate(best);
  }
  CBZ.onAlways(4.5, tick);

  // the sea, for the island in force (where an island's own sheet would tick)
  CBZ.onUpdate(47.9, function () {
    if (!ST.built || g.mode !== MODE || !ST.sea) return;
    if (CBZ.islandDriveSea) CBZ.islandDriveSea(ST.sea, ST.active ? ST.active.arena : null);
  });
  // the haze is the archipelago's, and the sun stands over YOU (the shadow
  // box follows the body from island to island), after survival.js's island
  // sky (onAlways 93) has written its own
  CBZ.onAlways(93.5, function () {
    if (!ST.built || g.mode !== MODE) return;
    const V = ST.map.view;
    if (CBZ.scene.fog) { CBZ.scene.fog.near = V.fogNear; CBZ.scene.fog.far = V.fogFar; }
    const P = CBZ.player;
    if (P && P.pos && CBZ.sun) {
      CBZ.sun.position.set(P.pos.x + 70, P.pos.y + 140, P.pos.z - 50);
      if (CBZ.sunTarget) CBZ.sunTarget.position.set(P.pos.x, P.pos.y, P.pos.z);
    }
  });

  /* ---- THE MODE -------------------------------------------------------- */
  function spawnPoint(A) {
    const st = A.airstrip && A.airstrip.stand;
    if (st) return { x: st.x - 9, z: st.z + 2, face: Math.PI / 2 };
    const p = A.randomPoint ? A.randomPoint(12, A.radius * 0.7) : { x: A.center.x, z: A.center.z };
    return { x: p.x, z: p.z, face: 0 };
  }
  function build() {
    // the disaster island (if this session built it) is not part of this world
    const H = CBZ.disasterArenaBuilt ? CBZ.disasterArenaBuilt() : null;
    if (H && H.root) H.root.visible = false;
    boot();
  }
  CBZ.registerMode(MODE, {
    id: MODE,
    label: "Islands",
    objective: "",
    build: build,
    reset: function () {
      build();
      if (CBZ.fx) CBZ.fx.clear();
      if (CBZ.clearGore) CBZ.clearGore();
      const surv = CBZ.surv;
      // the island in force (the spawn island on a fresh world); a new
      // stats object is how the island machines know a run began
      const I = ST.active;
      if (!I || !I.arena) return;
      const A = I.arena;
      if (surv) {
        surv.arena = A;
        surv.spectating = false; surv.deathCam = null; surv.decided = null;
        surv._cause = null; surv._lastImp = null; surv._deathCause = null; surv._runRecorded = false;
        surv.stats = { total: 1, placement: 0, disastersSurvived: 0 };
      }
      if (CBZ.clearSpectate) CBZ.clearSpectate();
      // a run begins clean: no stars, no collar in progress
      if (CBZ.cityWantedReset) { try { CBZ.cityWantedReset(); } catch (e) {} }
      if (CBZ.survEnv && CBZ.SURV_CLEAR_SKY) Object.assign(CBZ.survEnv, CBZ.SURV_CLEAR_SKY, { flash: 0, flashColor: 0xffffff });
      const sp = spawnPoint(A);
      const P = CBZ.player, PC = CBZ.playerChar;
      const gy = A.groundHeightAt(sp.x, sp.z);
      P.pos.set(sp.x, gy, sp.z);
      P.vy = 0; P.grounded = true;
      P.hp = 100; P.dead = false; P.ko = 0; P.stun = 0; P._death = null;
      if (P._phys) { P._phys.air = false; P._phys.down = 0; P._phys.kx = P._phys.kz = 0; }
      if (CBZ.trauma && surv) CBZ.trauma.reset(surv.playerActor);
      if (CBZ.vitals) CBZ.vitals.reset(P);
      P.stamina = CBZ.SURV.staminaMax; P.sprint = false; P.crouch = false;
      P.captureState = "normal"; P.captureT = 0;
      if (PC) {
        if (PC.cuffed) PC.cuffed = false;
        PC.group.position.copy(P.pos);
        PC.group.rotation.set(0, sp.face, 0);
        PC.group.scale.y = 1;
      }
      if (CBZ.cam) { CBZ.cam.yaw = sp.face + Math.PI; CBZ.cam.pitch = 0.42; }
      if (CBZ.resetZoom) CBZ.resetZoom();
      if (!(CBZ.bots && CBZ.bots.length)) { const it = populate(A); for (let r = it.next(); !r.done; r = it.next()) {} }
      if (CBZ.killFeedReset) CBZ.killFeedReset();
    },
    // the island's own verbs and buses (survival's actor model: people are
    // the island's crowd, a death goes through surv.hurt)
    caps: { traverse: 1, stepLedge: 1, blast: 1, blastActors: 1, breach: 1 },
    actors: function (out) {
      const b = CBZ.bots || [];
      for (let i = 0; i < b.length; i++) out.push(b[i]);
      // the island's police (city/police.js runs its force here): a blast,
      // a car, a falling wall reaches an officer like anybody else
      const c = CBZ.cityCops || [];
      for (let i = 0; i < c.length; i++) if (c[i] && !c[i].dead && !c[i]._airPilot && !c[i]._swatPassenger) out.push(c[i]);
      return out;
    },
    hurt: function (a, dmg, imp) {
      if (a && a.kind === "cop" && CBZ.cityHurtCop) { CBZ.cityHurtCop(a, dmg, imp); return true; }
      if (!CBZ.surv || !CBZ.surv.hurt) return false;
      const was = !!(a && a.dead);
      CBZ.surv.hurt(a, dmg, imp);
      // THE PLAYER HURT SOMEBODY: that is a crime on the islands as in the city.
      // cityCrime tags the witnesses (the crowd that saw it, any officer who
      // did) and only their calls raise stars.
      const P = CBZ.player;
      const byP = !!(imp && (imp.byPlayer || imp.by === P || (imp.by && imp.by.isPlayer) || imp.attacker === P));
      if (byP && a && a !== (CBZ.surv && CBZ.surv.playerActor) && CBZ.cityCrime && a.pos) {
        const killed = !was && !!a.dead;
        try { CBZ.cityCrime(killed ? 250 : 50, { x: a.pos.x, z: a.pos.z, type: killed ? "murder" : "assault" }); } catch (e) {}
      }
      return true;
    },
    hurtPlayer: function (dmg, x, z, cause) {
      if (!CBZ.surv || !CBZ.surv.hurt) return false;
      CBZ.surv.hurt(CBZ.surv.playerActor, dmg, { fromX: x, fromZ: z, fling: 4, cause: cause });
      return true;
    },
    route: "surv.hurt (the island's buses)",
  });

  // a death on the islands: the body, a beat, then you are back on the island
  let deadT = 0;
  CBZ.onUpdate(31.5, function (dt) {
    if (g.mode !== MODE || !ST.built) return;
    const P = CBZ.player;
    if (!P || !P.dead) { deadT = 0; return; }
    deadT += Math.min(0.1, dt || 0);
    if (deadT > 5.5) {
      deadT = 0;
      const m = CBZ.modes[MODE];
      if (m && m.reset) m.reset(g);
    }
  });

  CBZ.archipelagoExit = function () { teardown(true); };
  CBZ.archipelago = {
    groundAt: groundAt,
    isles: function () { return ST.isles; },
    state: function () {
      const P = CBZ.player;
      return {
        built: ST.built, map: ST.map ? ST.map.name : null,
        active: ST.active ? ST.active.id : null,
        full: ST.isles.filter(function (I) { return !!I.arena; }).map(function (I) { return I.id; }),
        isles: ST.isles.map(function (I) {
          return { id: I.id, state: I.state, shore: Math.round(I._shore || 0), ready: +I.ready.value.toFixed(2),
            refined: I.refined, buildMs: I.job ? Math.round(I.job.ms) : 0, steps: I.job ? I.job.steps : 0,
            draws: I.far ? 1 : 0 };
        }),
        speed: Math.round(Math.hypot(ST.vel.x, ST.vel.z)),
        chores: ST.chores.map(function (c) { return c.label; }), workMs: Math.round(ST.workMs),
        at: P && P.pos ? [Math.round(P.pos.x), Math.round(P.pos.z)] : null,
      };
    },
  };
})();
