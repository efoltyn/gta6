/* ============================================================
   games/ocean.js — DEAD WATER, as a GAME PACKAGE.

   The open water becomes a visible FOOD CHAIN game on the shared engine
   (core/packages.js). Two ROLES on ONE sim (GAMES-FIRST "roles, not
   one-shots"):
     A) SALVAGE DIVER — swim the wreck field for REAL city cash on a real
        oxygen clock; great whites hunt you (patrol→circle→bump→strike),
        dolphin pods escort and DRIVE THE SHARKS OFF, orcas clear the
        water, the megalodon guards the deep-trench gold. Dragged ashore
        (real health) when the water takes you.
     B) THE SHARK — you ARE the great white: eat the bait balls and seals
        for score, dodge the orca pod, flee the harpoon. Same sim, the
        player is the predator instead of the prey.

   WHY per object (owner's law — a prop is a mechanic or it's cut):
     · DOCK KIOSK ...... the economy + the CHARTER BOARD (role select,
                         O2 tank / bolts / chum). Win/lose is measured from
                         here. Sell salvage here for REAL city money.
     · PIER + CHUM ..... the dive launch point; the chum bucket is the
                         chum mechanic's supply (C to lure sharks away).
     · WRECK BUOYS ..... navigation: five amber floats mark five wrecks.
                         Swim to a buoy to work it. Deeper = richer.
     · WRECKS .......... the salvage sites; each is a payout. The 5th sits
                         over the trench (the gold) — the meg's water.
     · OXYGEN .......... the dive clock: drain scales with local depth,
                         refills at the dock; tank tiers buy trench time.
     · GREAT WHITES .... the fear (FSM). Blood/night escalate them.
     · DOLPHINS ........ the allies: pods arc-jump and CHARGE sharks off.
     · ORCAS ........... the apex event: they hunt the whites on screen.
     · MEGALODON ....... the legend: never leaves the trench; you don't
                         kill it, you beat it by getting the gold OUT.
     · BAIT BALLS ...... the base of the chain — prey for sharks AND for
                         the player in the SHARK role.

   PORTED from games/ocean.html (the standalone design draft): the PURE
   ecology (simChain, blood escalation, shark FSM, dolphin repulsion,
   orca predation, megalodon lurk→run arc, steering) and the oxygen /
   economy math. REBUILT for the engine: renderer/input/audio/HUD/UI are
   the engine's (ctx); creatures are ONE parametric voxel builder here;
   the water is the engine's real ocean (waterField / swim.js); cash is
   real city money; the diver is the engine's real player + real health.

   Determinism: build paths use ctx.rand/ctx.stream only (multiplayer
   law). Runtime creature wandering may use Math.random (FX only).
   Revert: CBZ.CONFIG.PKG_OCEAN = false (or the master GAME_PACKAGES).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE || !CBZ.games) return;
  const THREE = window.THREE;

  CBZ.CONFIG = CBZ.CONFIG || {};
  if (CBZ.CONFIG.PKG_OCEAN == null) CBZ.CONFIG.PKG_OCEAN = true;

  /* ------------------------------------------------------------ helpers -- */
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const d2 = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);
  const d3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  function wrapA(a) { a = (a + Math.PI) % (Math.PI * 2); if (a < 0) a += Math.PI * 2; return a - Math.PI; }

  /* ------------------------------------------------------------ config -- */
  const O2_TIERS = [60, 100, 150, 210], O2_COST = [0, 350, 700, 1200];
  const BOLT_COST = 30, CHUM_COST = 40;
  const GOLD_VALUE = 2600;
  // wreck ring, measured offshore along the resolved open-sea bearing
  const WRECK_DEFS = [
    { name: "Reef Runner", dist: 130, crates: 3, val: 120 },
    { name: "Pelican",     dist: 250, crates: 3, val: 220 },
    { name: "Trawler 7",   dist: 380, crates: 4, val: 320 },
    { name: "Boxship",     dist: 520, crates: 4, val: 450 },
    { name: "The Aurora",  dist: 660, crates: 2, val: 500, gold: true },
  ];
  // SwiftShader-sane caps (≤ ~40 active creatures, pooled)
  const CAP = { sharks: 6, pods: 2, orcas: 3, schools: 4, seals: 3 };
  const NEAR = 340;            // run the full sim only within this of the field
  const o2Rate = (depth) => 1 + Math.max(0, depth) * 0.025;   // ported dive clock

  /* --------------------------------------------- voxel geometry helpers -- */
  const voxMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  voxMat._shared = true;
  function mergeBoxes(list) { // {w,h,d,x,y,z,c, rx?,ry?,rz?}
    const pos = [], nor = [], col = [], idx = []; let off = 0;
    const C = new THREE.Color();
    for (const b of list) {
      const g = new THREE.BoxGeometry(b.w, b.h, b.d);
      if (b.rx) g.rotateX(b.rx); if (b.ry) g.rotateY(b.ry); if (b.rz) g.rotateZ(b.rz);
      g.translate(b.x || 0, b.y || 0, b.z || 0);
      const p = g.attributes.position, n = g.attributes.normal, ix = g.index;
      C.setHex(b.c);
      for (let i = 0; i < p.count; i++) {
        pos.push(p.getX(i), p.getY(i), p.getZ(i));
        nor.push(n.getX(i), n.getY(i), n.getZ(i));
        col.push(C.r, C.g, C.b);
      }
      for (let i = 0; i < ix.count; i++) idx.push(ix.getX(i) + off);
      off += p.count; g.dispose();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    return geo;
  }
  function voxMesh(list) { return new THREE.Mesh(mergeBoxes(list), voxMat); }

  /* --------------------------------------- ONE parametric creature build -- */
  /* Same segmented voxel skeleton for every species (body segments, a tail
     pivot, fins, an optional jaw pivot) — only the proportions/colours and
     the tail axis change per species. Chunky voxels (≥0.3u members). */
  function sharkParts(topC, bellyC, meg) {
    const body = [
      { w: 0.62, h: 0.5, d: 0.75, x: 0, y: 0.04, z: 1.95, c: topC },
      { w: 0.86, h: 0.72, d: 1.05, x: 0, y: 0, z: 1.25, c: topC },
      { w: 1.05, h: 0.9, d: 1.6, x: 0, y: 0, z: 0.1, c: topC },
      { w: 0.8, h: 0.62, d: 1.05, x: 0, y: 0, z: -1.0, c: topC },
      { w: 0.88, h: 0.32, d: 1.02, x: 0, y: -0.34, z: 1.25, c: bellyC },
      { w: 1.07, h: 0.36, d: 1.55, x: 0, y: -0.42, z: 0.1, c: bellyC },
      { w: 0.3, h: 0.95, d: 0.72, x: 0, y: 0.75, z: 0.12, c: topC, rx: -0.34 },       // dorsal
      { w: 1.05, h: 0.3, d: 0.62, x: -0.75, y: -0.25, z: 0.72, c: topC, rz: 0.55, ry: 0.35 },  // pect L
      { w: 1.05, h: 0.3, d: 0.62, x: 0.75, y: -0.25, z: 0.72, c: topC, rz: -0.55, ry: -0.35 }, // pect R
      { w: 0.3, h: 0.3, d: 0.3, x: -0.4, y: 0.14, z: 1.62, c: 0x0a0a0a },
      { w: 0.3, h: 0.3, d: 0.3, x: 0.4, y: 0.14, z: 1.62, c: 0x0a0a0a },
    ];
    if (meg) body.push(
      { w: 1.1, h: 0.34, d: 0.9, x: 0, y: 0.42, z: 0.7, c: 0x3a4448 },
      { w: 0.34, h: 0.6, d: 1.3, x: 0.5, y: 0.1, z: -0.4, c: 0x3a4448 },
      { w: 0.55, h: 0.3, d: 0.32, x: 0, y: 0.2, z: 1.95, c: 0xd8d8d0 });
    return {
      body,
      tail: [
        { w: 0.55, h: 0.5, d: 1.0, x: 0, y: 0, z: -0.45, c: topC },
        { w: 0.3, h: 1.5, d: 0.6, x: 0, y: 0.3, z: -1.1, c: topC, rx: -0.5 },
        { w: 0.3, h: 0.8, d: 0.45, x: 0, y: -0.3, z: -1.0, c: topC, rx: 0.45 },
      ], tailZ: -1.5, tailAxis: "y",
      jaw: [
        { w: 0.6, h: 0.3, d: 0.7, x: 0, y: -0.08, z: 0.3, c: bellyC },
        { w: 0.55, h: meg ? 0.34 : 0.22, d: 0.3, x: 0, y: 0.08, z: 0.58, c: 0xfff8f0 },
      ], jawY: -0.24, jawZ: 1.55,
      scale: meg ? 3.4 : 1.18,
    };
  }
  function dolphinParts() {
    const top = 0x7d99ab, belly = 0xe8f2f5;
    return {
      body: [
        { w: 0.3, h: 0.26, d: 0.55, x: 0, y: -0.06, z: 1.28, c: top },
        { w: 0.55, h: 0.5, d: 0.6, x: 0, y: 0, z: 0.85, c: top },
        { w: 0.62, h: 0.56, d: 1.15, x: 0, y: 0, z: 0.05, c: top },
        { w: 0.44, h: 0.38, d: 0.7, x: 0, y: 0, z: -0.75, c: top },
        { w: 0.63, h: 0.24, d: 1.1, x: 0, y: -0.24, z: 0.05, c: belly },
        { w: 0.3, h: 0.5, d: 0.42, x: 0, y: 0.44, z: 0.02, c: top, rx: -0.45 },
        { w: 0.52, h: 0.22, d: 0.4, x: -0.4, y: -0.14, z: 0.5, c: top, rz: 0.5 },
        { w: 0.52, h: 0.22, d: 0.4, x: 0.4, y: -0.14, z: 0.5, c: top, rz: -0.5 },
        { w: 0.22, h: 0.22, d: 0.22, x: -0.24, y: 0.12, z: 1.05, c: 0x0a0a0a },
        { w: 0.22, h: 0.22, d: 0.22, x: 0.24, y: 0.12, z: 1.05, c: 0x0a0a0a },
      ],
      tail: [
        { w: 0.3, h: 0.26, d: 0.55, x: 0, y: 0, z: -0.22, c: top },
        { w: 1.05, h: 0.22, d: 0.5, x: 0, y: 0, z: -0.6, c: top },                     // horizontal flukes
      ], tailZ: -1.05, tailAxis: "x",
      jaw: null, scale: 0.95,
    };
  }
  function orcaParts() {
    const blk = 0x14181c, wht = 0xe8f0f2;
    return {
      body: [
        { w: 0.95, h: 0.8, d: 1.1, x: 0, y: 0, z: 1.35, c: blk },
        { w: 1.18, h: 1.02, d: 1.7, x: 0, y: 0, z: 0.1, c: blk },
        { w: 0.82, h: 0.7, d: 1.05, x: 0, y: 0, z: -1.15, c: blk },
        { w: 0.96, h: 0.32, d: 1.05, x: 0, y: -0.34, z: 1.35, c: wht },
        { w: 1.2, h: 0.36, d: 1.66, x: 0, y: -0.44, z: 0.1, c: wht },
        { w: 0.34, h: 0.34, d: 0.66, x: -0.52, y: 0.22, z: 1.5, c: wht },
        { w: 0.34, h: 0.34, d: 0.66, x: 0.52, y: 0.22, z: 1.5, c: wht },
        { w: 1.22, h: 0.3, d: 0.85, x: 0, y: 0.42, z: -0.55, c: 0xb8c4c8 },
        { w: 0.34, h: 1.7, d: 0.62, x: 0, y: 1.15, z: 0.05, c: blk, rx: -0.16 },        // tall dorsal
        { w: 0.95, h: 0.3, d: 0.72, x: -0.72, y: -0.3, z: 0.75, c: blk, rz: 0.5 },
        { w: 0.95, h: 0.3, d: 0.72, x: 0.72, y: -0.3, z: 0.75, c: blk, rz: -0.5 },
      ],
      tail: [
        { w: 0.55, h: 0.44, d: 0.7, x: 0, y: 0, z: -0.3, c: blk },
        { w: 1.5, h: 0.26, d: 0.6, x: 0, y: 0, z: -0.8, c: blk },
      ], tailZ: -1.75, tailAxis: "x",
      jaw: null, scale: 1.45,
    };
  }
  function sealParts() {
    const top = 0x4a4038, belly = 0x8a7a66;
    return {
      body: [
        { w: 0.5, h: 0.5, d: 1.4, x: 0, y: 0, z: 0, c: top },
        { w: 0.42, h: 0.42, d: 0.5, x: 0, y: 0.12, z: 0.8, c: top },
        { w: 0.5, h: 0.24, d: 1.3, x: 0, y: -0.2, z: 0, c: belly },
        { w: 0.22, h: 0.22, d: 0.22, x: -0.16, y: 0.2, z: 1.02, c: 0x0a0a0a },
        { w: 0.22, h: 0.22, d: 0.22, x: 0.16, y: 0.2, z: 1.02, c: 0x0a0a0a },
        { w: 0.6, h: 0.14, d: 0.4, x: -0.3, y: -0.16, z: 0.2, c: top, rz: 0.4 },
        { w: 0.6, h: 0.14, d: 0.4, x: 0.3, y: -0.16, z: 0.2, c: top, rz: -0.4 },
      ],
      tail: [{ w: 0.6, h: 0.14, d: 0.45, x: 0, y: -0.05, z: -0.2, c: top }],
      tailZ: -0.75, tailAxis: "x", jaw: null, scale: 0.7,
    };
  }
  function buildCreature(kind) {
    const p = kind === "meg" ? sharkParts(0x2e3a42, 0x6a7880, true)
      : kind === "shark" ? sharkParts(0x5a6c78, 0xdfe8ec, false)
      : kind === "dolphin" ? dolphinParts()
      : kind === "orca" ? orcaParts()
      : sealParts();
    const g = new THREE.Group();
    g.add(voxMesh(p.body));
    let tail = null, jaw = null;
    if (p.tail) { tail = new THREE.Group(); tail.position.set(0, 0, p.tailZ); tail.add(voxMesh(p.tail)); g.add(tail); }
    if (p.jaw) { jaw = new THREE.Group(); jaw.position.set(0, p.jawY, p.jawZ); jaw.add(voxMesh(p.jaw)); g.add(jaw); }
    g.scale.setScalar(p.scale);
    g.userData = { tail, jaw, tailAxis: p.tailAxis };
    return g;
  }
  // small parametric fish quad for the instanced bait balls
  const fishGeo = mergeBoxes([
    { w: 0.3, h: 0.22, d: 0.55, x: 0, y: 0, z: 0.08, c: 0xa8c8d8 },
    { w: 0.18, h: 0.3, d: 0.3, x: 0, y: 0, z: -0.32, c: 0x88a8b8 },
  ]);
  const fishMat = new THREE.MeshLambertMaterial({ color: 0xb8d8e8 }); fishMat._shared = true;

  /* --------------------------------------------------- module singletons -- */
  let C = null;          // ctx once mounted
  let V = null;          // venue refs: { venue, origin, bearing, deep, center, radius, bounds, wrecks[], creatureRoot }
  let state = null;      // persisted bag
  let simT = 0;
  const pool = { shark: [], dolphin: [], orca: [], meg: [], seal: [] };
  const chain = {
    sharks: [], pods: [], orcas: [], schools: [], seals: [], meg: null,
    blood: [],  // {x,z,amt,life}
    events: { orcaKills: 0, dolphinRepels: 0, sharkStrikes: 0, sharkBumps: 0, dolphinJumps: 0, orcaSpouts: 0, playerFed: 0 },
    orcaTimer: 70, sharkTimer: 14, orcaHere: false,
  };
  // runtime (not persisted)
  const RT = { role: "salvage", o2: 60, diving: false, warnCd: 0, drownT: 0, hurtCd: 0,
    playerShark: null, lastP: { x: 0, z: 0 }, sharkYaw: 0, score: 0, fedCd: 0, harpoonCd: 8,
    seeded: false, simDrive: false, simFocus: null, goldGrabbed: false };

  function bag() {
    if (state) return state;
    state = C.state(() => ({ role: "salvage", o2Tier: 0, bolts: 6, chum: 2, cargo: [],
      hiSalvage: 0, hiShark: 0, dives: 0 }));
    if (!state.cargo) state.cargo = [];
    RT.role = state.role || "salvage";
    return state;
  }
  const save = () => { try { C.saveState(); } catch (e) {} };
  const o2cap = () => O2_TIERS[bag().o2Tier] || 60;
  function cargoValue() { let v = 0; for (const c of bag().cargo) v += c.v; return v; }
  const isNight = () => (CBZ.nightAmount != null ? CBZ.nightAmount > 0.55 : false);

  /* ---------------------------------------- world water sampling (engine) -- */
  const SEA_Y = () => (CBZ.SEA_Y != null ? CBZ.SEA_Y : -0.48);
  function surfaceY(x, z) { return CBZ.citySeaHeightAt ? CBZ.citySeaHeightAt(x, z, simT) : SEA_Y(); }
  function depthAt(x, z) { return CBZ.cityWaterDepthAt ? CBZ.cityWaterDepthAt(x, z) : 30; }
  function floorY(x, z) { return SEA_Y() - depthAt(x, z); }

  /* ============================================================
     resolve() — find the REAL open water OUTSIDE the landmasses.
     Marches from the city centre along the bearing to the CLOSEST large
     open-sea expanse (past the whole continent, not the inner harbour
     ring), lands the dock on that outer coast, and returns the offshore
     bearing + a deep trench anchor for build() to lay the wreck line on.
     Returns null until the world (arena + waterField) exists — the engine
     retries every ~1.2s.
  ============================================================ */
  function resolve(CBZ) {
    try {
      const A = CBZ.city && CBZ.city.arena;
      if (!A || A.minX == null || !isFinite(A.minX) || !isFinite(A.maxX)) return null;
      const wf = CBZ.waterField;
      if (!wf || !wf.isNavigableWater) return null;
      const cx = (A.minX + A.maxX) / 2, cz = (A.minZ + A.maxZ) / 2;
      const R0 = Math.hypot(A.maxX - cx, A.maxZ - cz);
      // pick the bearing that reaches SUSTAINED open sea soonest (skips the
      // narrow harbour ring — that water can't hold a 660u wreck line)
      const step = 14, maxR = R0 + 6500, need = 460;
      function openSeaR(bear) {
        const c = Math.cos(bear), s = Math.sin(bear);
        let runStart = -1;
        for (let r = 0; r <= maxR; r += step) {
          const x = cx + c * r, z = cz + s * r;
          if (wf.isNavigableWater(x, z, 38)) { if (runStart < 0) runStart = r; if (r - runStart >= need) return runStart; }
          else runStart = -1;
        }
        return Infinity;
      }
      let bear = 0, best = Infinity;
      for (let i = 0; i < 32; i++) {
        const b = (i / 32) * Math.PI * 2;
        const r = openSeaR(b);
        if (r < best) { best = r; bear = b; }
      }
      if (!isFinite(best)) return null;
      const c = Math.cos(bear), s = Math.sin(bear);
      // waterline: last land point before the sustained open sea begins
      let landR = best;
      for (let r = best; r >= Math.max(0, best - 320); r -= 6) {
        if (!wf.isNavigableWater(cx + c * r, cz + s * r, 0)) { landR = r; break; }
      }
      const coast = { x: cx + c * landR, z: cz + s * landR };
      // deep trench anchor: far offshore, snapped to genuine open water
      let deep = wf.nearestWater ? wf.nearestWater(coast.x + c * 700, coast.z + s * 700, 40, 1600) : null;
      if (!deep) deep = { x: coast.x + c * 700, z: coast.z + s * 700 };
      // play bounds: AABB over the coast → far ring with lateral margin
      const far = { x: coast.x + c * 720, z: coast.z + s * 720 };
      const px = -s, pz = c, LAT = 420;
      const xs = [coast.x - c * 30, far.x, coast.x + px * LAT, coast.x - px * LAT, far.x + px * LAT, far.x - px * LAT];
      const zs = [coast.z - s * 30, far.z, coast.z + pz * LAT, coast.z - pz * LAT, far.z + pz * LAT, far.z - pz * LAT];
      let bounds = { minX: Math.min.apply(null, xs) - 40, maxX: Math.max.apply(null, xs) + 40,
        minZ: Math.min.apply(null, zs) - 40, maxZ: Math.max.apply(null, zs) + 40 };
      const sb = CBZ.SEA_WORLD_BOUNDS;
      if (sb && isFinite(sb.minX)) {
        bounds.minX = clamp(bounds.minX, sb.minX, sb.maxX); bounds.maxX = clamp(bounds.maxX, sb.minX, sb.maxX);
        bounds.minZ = clamp(bounds.minZ, sb.minZ, sb.maxZ); bounds.maxZ = clamp(bounds.maxZ, sb.minZ, sb.maxZ);
      }
      return { x: coast.x, z: coast.z, waterY: SEA_Y(), bounds, bearing: bear, deep };
    } catch (e) { return null; }
  }

  /* ================================ build ================================ */
  function build(ctx, venue) {
    C = ctx;
    const anchor = venue.anchor || {};
    const bear = anchor.bearing || 0;
    const ux = Math.cos(bear), uz = Math.sin(bear);   // offshore unit (local == world axes)
    const origin = venue.origin;
    const bounds = anchor.bounds || { minX: origin.x - 500, maxX: origin.x + 500, minZ: origin.z - 500, maxZ: origin.z + 500 };
    const center = { x: (bounds.minX + bounds.maxX) / 2, z: (bounds.minZ + bounds.maxZ) / 2 };
    const radius = Math.hypot(bounds.maxX - center.x, bounds.maxZ - center.z);
    V = { venue, origin, bearing: bear, ux, uz, deep: anchor.deep || { x: origin.x + ux * 700, z: origin.z + uz * 700 },
      bounds, center, radius, wrecks: [], creatureRoot: null };
    const g = venue.group;
    bag();

    // creatures live in WORLD coords under a counter-offset child of the
    // (batch-spared) venue group, so distance math needs no local↔world juggle
    const croot = new THREE.Group();
    croot.position.set(-origin.x, 0, -origin.z);
    croot.userData.gamePkg = "ocean";
    g.add(croot); V.creatureRoot = croot;

    // ground helpers keep every prop planted (no floating geometry): terrain
    // for the on-land kiosk, the analytic seafloor for the over-water posts.
    const terrainAt = (lx, lz) => (CBZ.floorAt ? (CBZ.floorAt(origin.x + lx, origin.z + lz) || 0) : 0);
    const seabedAt = (lx, lz) => floorY(origin.x + lx, origin.z + lz);
    const deckY = 0.7;

    // ---- DOCK KIOSK (on land, inland of the waterline): economy + charter ----
    const kx = -ux * 7, kz = -uz * 7;              // ~7u inland from the coast crossing
    const y0 = terrainAt(kx, kz);                  // seat the hut on real terrain
    g.add(voxMesh([
      { w: 3.4, h: 2.1, d: 2.6, x: kx, y: y0 + 1.05, z: kz, c: 0x7a4a34 },        // hut
      { w: 3.8, h: 0.3, d: 3.0, x: kx, y: y0 + 2.25, z: kz, c: 0xc8542e },        // roof
      { w: 3.0, h: 0.6, d: 0.5, x: kx + ux * 1.3, y: y0 + 0.95, z: kz + uz * 1.3, c: 0x9a7a50 }, // counter (seaward)
      { w: 0.4, h: 0.4, d: 0.4, x: kx + 1.4, y: y0 + 2.6, z: kz, c: 0xffd451 },   // lantern
    ]));
    ctx.solid(kx - 1.7, kz - 1.3, kx + 1.7, kz + 1.3);   // the hut is a wall
    ctx.light(kx + 1.4, y0 + 2.7, kz, 0xffc868, 0.9, 24);
    // sign
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 0.7),
      new THREE.MeshBasicMaterial({ map: ctx.canvasTex(256, 64, (x2) => {
        x2.fillStyle = "#241610"; x2.fillRect(0, 0, 256, 64);
        x2.fillStyle = "#f0a028"; x2.font = "bold 26px Trebuchet MS";
        x2.textAlign = "center"; x2.fillText("DEAD WATER — SALVAGE", 128, 42);
      }) }));
    sign.position.set(kx + ux * 1.4, y0 + 2.15, kz + uz * 1.4);
    sign.rotation.y = Math.atan2(ux, uz);
    g.add(sign);
    // the dock vendor — a REAL city ped (brain + wardrobe + death funnel),
    // pinned behind the counter. [E] Talk gives wreck/price flavour; the
    // Charter zone below is the actual economy panel.
    if (ctx.npc) ctx.npc({
      role: "vendor", name: "Mona", outfit: "vendor",
      at: [kx + ux * 1.1, kz + uz * 1.1], face: Math.atan2(-ux, -uz),
      post: "pinned", pose: "stand", sayColor: "#9adcb8",
      talkLabel: "Talk to Mona",
      dialogue: [
        "Follow an amber buoy, anchor your nerve, and dive. Deeper wrecks pay better.",
        "The Aurora's gold sits over the trench. Something down there guards it — I'd know.",
        "Night salvage pays double. So does a mistake after dark.",
        "Dolphins near you? Good. They run the whites off. Orcas run everything off.",
        "Air's your real problem. Sell here, buy a bigger tank, then chase the deep money.",
      ],
    });

    // ---- PIER + CHUM BUCKET: the dive launch + the chum supply ----
    // posts run from the analytic seabed up to the deck so the pier is
    // support-connected, not floating over the shallows.
    const post = (lx, lz) => { const sb = seabedAt(lx, lz); return { h: deckY - sb + 0.3, cy: (deckY + sb) / 2 }; };
    const pOut = post(ux * 8, uz * 8), pIn = post(ux * 1.5, uz * 1.5);
    g.add(voxMesh([
      { w: 3.2, h: 0.3, d: 10, x: ux * 4, y: deckY, z: uz * 4, c: 0x9a7a50, ry: Math.atan2(ux, uz) },  // deck
      { w: 0.45, h: pOut.h, d: 0.45, x: ux * 8, y: pOut.cy, z: uz * 8, c: 0x6a4a30 },   // outer post → seabed
      { w: 0.45, h: pIn.h, d: 0.45, x: ux * 1.5, y: pIn.cy, z: uz * 1.5, c: 0x6a4a30 }, // inner post → seabed
      { w: 0.62, h: 0.55, d: 0.62, x: ux * 6 + uz * 1.2, y: deckY + 0.5, z: uz * 6 - ux * 1.2, c: 0x8a2a20 }, // CHUM bucket
    ]));

    // ---- WRECK LINE: five buoys + sunken hulls out along the bearing ----
    const rng = ctx.stream("wrecks");
    for (let i = 0; i < WRECK_DEFS.length; i++) {
      const def = WRECK_DEFS[i];
      let wx, wz;
      if (def.gold) { wx = V.deep.x; wz = V.deep.z; }
      else {
        // offshore along the bearing, jittered along its perpendicular (-uz, ux)
        const lat = (rng() - 0.5) * 90;
        wx = origin.x + ux * def.dist - uz * lat;
        wz = origin.z + uz * def.dist + ux * lat;
      }
      // snap to genuine water so a wreck never lands on a shoal/island
      if (CBZ.waterField && CBZ.waterField.nearestWater) {
        const w = CBZ.waterField.nearestWater(wx, wz, 12, 260);
        if (w) { wx = w.x; wz = w.z; }
      }
      const lx = wx - origin.x, lz = wz - origin.z;
      const gy = floorY(wx, wz);
      const yaw = rng() * Math.PI * 2, tilt = 0.14 + rng() * 0.22;
      const L = 12 + i * 3, W = 3.6 + i * 0.5, H = 2.4 + i * 0.4;
      const hull = voxMesh([
        { w: W, h: H, d: L, x: 0, y: H / 2, z: 0, c: 0x4a5a62 },
        { w: W + 0.4, h: 0.4, d: L + 0.6, x: 0, y: H + 0.1, z: 0, c: 0x3a4a50 },
        { w: W - 1, h: H * 0.8, d: L * 0.28, x: 0, y: H * 1.4, z: -L * 0.24, c: 0x5a6a72 },
        { w: 0.5, h: H * 2.0, d: 0.5, x: 0.6, y: H * 1.6, z: L * 0.18, c: 0x3a4048, rz: 0.5 },
      ]);
      hull.position.set(lx, gy - 0.4, lz);
      hull.rotation.set(0, yaw, tilt * (i % 2 ? 1 : -1));
      g.add(hull);
      const buoy = voxMesh([
        { w: 1.2, h: 0.6, d: 1.2, x: 0, y: 0, z: 0, c: def.gold ? 0xd8a828 : 0xe06428 },
        { w: 0.3, h: 1.7, d: 0.3, x: 0, y: 1.1, z: 0, c: 0x2a3238 },
        { w: 0.85, h: 0.55, d: 0.3, x: 0.42, y: 1.6, z: 0, c: 0xf0a028 },
        { w: 0.36, h: 0.36, d: 0.36, x: 0, y: 2.1, z: 0, c: 0xfff0c8 },
      ]);
      buoy.position.set(lx, SEA_Y(), lz);
      g.add(buoy);
      V.wrecks.push({ name: def.name, wx, wz, lx, lz, val: def.val, crates: def.crates + (def.gold ? 1 : 0),
        gold: !!def.gold, buoy, workT: 0 });
    }

    // ---- ZONES: the charter board + sell salvage (at the kiosk) ----
    ctx.zone({ id: "charter", label: "Charter board — role & supply [DEAD WATER]",
      pos: [kx, kz], r: 2.4, onUse: openCharter });
    ctx.zone({ id: "sell", label: "Sell salvage [DEAD WATER]",
      pos: [kx + ux * 1.6, kz + uz * 1.6], r: 2.0,
      canShow: () => bag().cargo.length > 0, onUse: sellSalvage });
  }

  /* ============================ ecology sim ============================= */
  /* PORTED verbatim in behaviour from games/ocean.html: blood escalation,
     the great-white FSM (patrol→circle→bump→strike/flee), dolphin charge-
     repulsion, orca predation, and the megalodon lurk→run arc. Adapted to
     the engine's water sampling and the real player as the diver. */
  function addBlood(x, z, amt, life) { chain.blood.push({ x, z, amt, life: life || 40 }); }
  function bloodAt(x, z) {
    let b = 0;
    for (const s of chain.blood) b += s.amt * clamp(1 - d2(x, z, s.x, s.z) / 120, 0, 1);
    return b;
  }
  function predatorsNear(x, z, r) {
    const out = [];
    for (const sh of chain.sharks) if (sh.alive && d2(sh.pos.x, sh.pos.z, x, z) < r) out.push(sh);
    for (const p of chain.pods) for (const m of p.members) if (d2(m.pos.x, m.pos.z, x, z) < r) out.push(m);
    for (const o of chain.orcas) if (o.alive && d2(o.pos.x, o.pos.z, x, z) < r) out.push(o);
    if (chain.meg && d2(chain.meg.pos.x, chain.meg.pos.z, x, z) < r) out.push(chain.meg);
    return out;
  }
  // the reference the sim orbits: the live diver (SALVAGE) drives everything;
  // headless simChain drives a virtual focus; otherwise the dock.
  function refPos() {
    if (RT.diving && RT.role === "salvage" && CBZ.player) return CBZ.player.pos;
    if (RT.simDrive && RT.simFocus) return RT.simFocus;
    return { x: V.origin.x + V.ux * 60, y: SEA_Y() - 2, z: V.origin.z + V.uz * 60 };
  }
  // the PREY the great whites hunt: only the SALVAGE diver, or the virtual
  // focus in a headless sim. In the SHARK role the player is a peer — the
  // whites don't hunt him (the orcas do).
  function preyPos() {
    if (RT.diving && RT.role === "salvage" && CBZ.player) return CBZ.player.pos;
    if (RT.simDrive && RT.simFocus) return RT.simFocus;
    return null;
  }

  function acquire(kind) {
    const m = pool[kind].pop() || buildCreature(kind);
    m.visible = true;
    if (m.parent !== V.creatureRoot) V.creatureRoot.add(m);
    return m;
  }
  function release(kind, m) { if (!m) return; m.visible = false; pool[kind].push(m); }

  function steer(o, tx, ty, tz, spd, turn, dt) {
    const want = Math.atan2(tx - o.pos.x, tz - o.pos.z);
    o.yaw += clamp(wrapA(want - o.yaw), -turn * dt, turn * dt);
    o.pos.x += Math.sin(o.yaw) * spd * dt;
    o.pos.z += Math.cos(o.yaw) * spd * dt;
    const dy = ty - o.pos.y;
    o.pos.y += clamp(dy, -spd * 0.55 * dt, spd * 0.55 * dt);
    o.pitch = lerp(o.pitch || 0, clamp(dy * 0.22, -0.55, 0.55), Math.min(1, dt * 3));
  }
  function clampSwim(o) {
    const surf = surfaceY(o.pos.x, o.pos.z);
    if (o.pos.y > surf - 0.35) o.pos.y = surf - 0.35;
    const fl = floorY(o.pos.x, o.pos.z);
    if (o.pos.y < fl + 1.0) o.pos.y = fl + 1.0;
    const b = V.bounds;
    o.pos.x = clamp(o.pos.x, b.minX - 60, b.maxX + 60);
    o.pos.z = clamp(o.pos.z, b.minZ - 60, b.maxZ + 60);
  }
  function syncFish(o) {
    o.mesh.position.set(o.pos.x, o.pos.y, o.pos.z);
    o.mesh.rotation.set(0, o.yaw, 0);
    o.mesh.rotateX(-(o.pitch || 0));
    if (o.roll) o.mesh.rotateZ(o.roll);
  }

  /* ---- bait balls (the base of the chain) ---- */
  const dummy = new THREE.Object3D();
  function spawnSchool(x, z) {
    if (chain.schools.length >= CAP.schools) return null;
    const n = 22;
    const mesh = new THREE.InstancedMesh(fishGeo, fishMat, n);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false; V.creatureRoot.add(mesh);
    const fish = [];
    for (let i = 0; i < n; i++) fish.push({ ph: Math.random() * 6.28, r: 1.4 + Math.random() * 3, yo: (Math.random() - 0.5) * 2, sp: 0.7 + Math.random() * 0.9 });
    const s = { x, z, y: SEA_Y() - 2.2, wx: x, wz: z, scatter: 0, fish, mesh };
    chain.schools.push(s);
    return s;
  }
  function updateSchool(s, dt) {
    if (d2(s.x, s.z, s.wx, s.wz) < 8 || Math.random() < dt * 0.02) {
      const a = Math.random() * Math.PI * 2, dd = 60 + Math.random() * 120;
      s.wx = clamp(s.x + Math.sin(a) * dd, V.bounds.minX, V.bounds.maxX);
      s.wz = clamp(s.z + Math.cos(a) * dd, V.bounds.minZ, V.bounds.maxZ);
    }
    const spd = 1.1 + s.scatter * 2;
    const a = Math.atan2(s.wx - s.x, s.wz - s.z);
    s.x += Math.sin(a) * spd * dt; s.z += Math.cos(a) * spd * dt;
    s.scatter = Math.max(0, s.scatter - dt * 0.25);
    if (predatorsNear(s.x, s.z, 14).length) s.scatter = 1;
    for (let i = 0; i < s.fish.length; i++) {
      const f = s.fish[i];
      const ang = f.ph + simT * f.sp * (1 + s.scatter * 2.2);
      const r = f.r * (1 + s.scatter * 2.6);
      const fx = s.x + Math.sin(ang) * r, fz = s.z + Math.cos(ang) * r;
      const fy = s.y + f.yo * (1 + s.scatter) - s.scatter * 2.2;
      dummy.position.set(fx, Math.min(fy, surfaceY(fx, fz) - 0.4), fz);
      dummy.rotation.set(0, ang + Math.PI / 2, 0);
      const sh = 1 + 0.22 * Math.sin(simT * 7 + f.ph * 3);
      dummy.scale.set(sh, 1, 1); dummy.updateMatrix();
      s.mesh.setMatrixAt(i, dummy.matrix);
    }
    s.mesh.instanceMatrix.needsUpdate = true;
  }

  /* ---- GREAT WHITE ---- */
  function spawnShark(x, z) {
    if (chain.sharks.length >= CAP.sharks) return null;
    const s = { kind: "shark", mesh: acquire("shark"), pos: { x, y: SEA_Y() - 3, z }, yaw: Math.random() * 6.28, pitch: 0,
      state: "patrol", aggr: 0, stateT: 0, tailT: Math.random() * 6, hp: 3, alive: true,
      circleDir: Math.random() < 0.5 ? -1 : 1, bumpCd: 0, strikeCd: 0, calmT: 0, fleeFrom: null,
      wx: x, wz: z, sinkT: 0, claimed: false };
    chain.sharks.push(s); return s;
  }
  function killShark(s, by) {
    if (!s.alive) return;
    s.alive = false; s.sinkT = 0; s.state = "dead";
    addBlood(s.pos.x, s.pos.z, 5, 50);
    if (by === "orca") {
      chain.events.orcaKills++;
      if (!RT.simDrive) feedNear(s.pos, "AN ORCA JUST KILLED A GREAT WHITE", 200);
    }
  }
  function updateShark(s, dt) {
    if (!s.alive) {
      s.sinkT += dt; s.pos.y = Math.max(floorY(s.pos.x, s.pos.z) + 0.6, s.pos.y - dt * 0.8);
      s.roll = Math.min(2.6, s.sinkT * 0.5); syncFish(s);
      if (s.sinkT > 22) { release("shark", s.mesh); chain.sharks.splice(chain.sharks.indexOf(s), 1); }
      return;
    }
    s.bumpCd -= dt; s.strikeCd -= dt; s.stateT -= dt;
    const pl = preyPos();
    const bl = bloodAt(s.pos.x, s.pos.z);
    let orcaNear = null;
    for (const o of chain.orcas) if (o.alive && d3(o.pos, s.pos) < 75) { orcaNear = o; break; }
    if (orcaNear && s.state !== "flee") { s.state = "flee"; s.fleeFrom = orcaNear.pos; s.stateT = 5; }
    let rise = Math.min(0.3, 0.07 * bl);
    if (pl) { const dp = d3(s.pos, pl); if (dp < 60 + bl * 30) rise += 0.045; }
    if (isNight()) rise *= 1.6;
    if (s.calmT > 0) { s.calmT -= dt; rise = 0; s.aggr = Math.max(0, s.aggr - dt * 0.6); }
    s.aggr = clamp(s.aggr + rise * dt - 0.006 * dt, 0, 1);

    let spd = 4, turn = 1.4, ty = SEA_Y() - 2.5 + Math.sin(simT * 0.3 + s.tailT) * 1.4, tx = s.wx, tz = s.wz;
    switch (s.state) {
      case "patrol": {
        let best = null, bestW = 0.6;
        for (const b of chain.blood) { const w = b.amt * clamp(1 - d2(s.pos.x, s.pos.z, b.x, b.z) / 300, 0, 1); if (w > bestW) { bestW = w; best = b; } }
        if (best) { tx = best.x; tz = best.z; }
        else {
          let sc = null, sd = 200;
          for (const c of chain.schools) { const dd = d2(s.pos.x, s.pos.z, c.x, c.z); if (dd < sd) { sd = dd; sc = c; } }
          if (sc && Math.random() < 0.7) { tx = sc.x; tz = sc.z; }
          else if (d2(s.pos.x, s.pos.z, s.wx, s.wz) < 15) {
            const a = Math.random() * 6.28, dd = 70 + Math.random() * 150;
            s.wx = clamp(s.pos.x + Math.sin(a) * dd, V.bounds.minX, V.bounds.maxX);
            s.wz = clamp(s.pos.z + Math.cos(a) * dd, V.bounds.minZ, V.bounds.maxZ);
          }
        }
        if (pl && d3(s.pos, pl) < 60 + bl * 30 && s.aggr > 0.25) { s.state = "circle"; s.stateT = 99; }
        break;
      }
      case "circle": {
        if (!pl) { s.state = "patrol"; break; }
        const r = lerp(24, 8, s.aggr);
        const a = Math.atan2(s.pos.x - pl.x, s.pos.z - pl.z) + s.circleDir * (1.15 * dt);
        tx = pl.x + Math.sin(a) * r; tz = pl.z + Math.cos(a) * r; ty = pl.y + Math.sin(simT + s.tailT) * 1.2;
        spd = 6.5; turn = 2.4;
        if (s.aggr > 0.55 && s.bumpCd <= 0 && s.aggr <= 0.82) { s.state = "bump"; s.stateT = 5; }
        if (s.aggr > 0.82 && s.strikeCd <= 0) { s.state = "strike"; s.stateT = 6; }
        break;
      }
      case "bump": {
        if (!pl) { s.state = "patrol"; break; }
        tx = pl.x; tz = pl.z; ty = pl.y; spd = 9; turn = 2.6;
        if (d3(s.pos, pl) < 2.8) { chain.events.sharkBumps++; s.bumpCd = 6; s.state = "circle"; s.stateT = 99; warn("Something just brushed you", true); }
        if (s.stateT <= 0) { s.state = "circle"; s.bumpCd = 4; }
        break;
      }
      case "strike": {
        if (!pl) { s.state = "patrol"; break; }
        tx = pl.x; tz = pl.z; ty = pl.y; spd = 13; turn = 3.0;
        if (d3(s.pos, pl) < 2.0) {
          chain.events.sharkStrikes++;
          addBlood(pl.x, pl.z, 1.6, 30);
          if (!RT.simDrive) hurtDiver(16, s.pos, "mauled by a great white");
          s.strikeCd = 8; s.aggr *= 0.8; s.state = "circle"; s.stateT = 99;
        }
        if (s.stateT <= 0) { s.state = "circle"; s.strikeCd = 5; }
        break;
      }
      case "flee": {
        const f = s.fleeFrom || { x: 0, z: 0 };
        const a = Math.atan2(s.pos.x - f.x, s.pos.z - f.z);
        tx = s.pos.x + Math.sin(a) * 60; tz = s.pos.z + Math.cos(a) * 60; ty = SEA_Y() - 6;
        spd = 8.5; turn = 2.2;
        if (s.stateT <= 0) s.state = "patrol";
        break;
      }
    }
    steer(s, tx, ty, tz, spd, turn, dt); clampSwim(s);
    s.tailT += dt * (2.2 + spd * 0.9);
    if (s.mesh.userData.tail) s.mesh.userData.tail.rotation.y = Math.sin(s.tailT) * 0.5;
    if (s.mesh.userData.jaw) s.mesh.userData.jaw.rotation.x = s.state === "strike" ? 0.75 : (s.aggr > 0.7 ? 0.25 : 0.05);
    syncFish(s);
  }

  /* ---- DOLPHIN pods ---- */
  function spawnDolphins(x, z) {
    if (chain.pods.length >= CAP.pods) return null;
    const pod = { members: [], wx: x, wz: z, leaveT: 0, escorting: false };
    for (let i = 0; i < 5; i++) {
      pod.members.push({ kind: "dolphin", mesh: acquire("dolphin"), pod,
        pos: { x: x + (Math.random() - 0.5) * 8, y: SEA_Y() - 1.6, z: z + (Math.random() - 0.5) * 8 },
        yaw: Math.random() * 6.28, pitch: 0, tailT: Math.random() * 6, slot: i,
        jumping: false, jy: 0, jumpCd: 2 + Math.random() * 8, chargeCd: 0, charging: null });
    }
    chain.pods.push(pod); return pod;
  }
  function updatePod(pod, dt) {
    const ref = refPos();
    const nearP = d2(pod.members[0].pos.x, pod.members[0].pos.z, ref.x, ref.z) < 85 && pod.leaveT <= 0;
    if (pod.leaveT > 0) pod.leaveT -= dt;
    if (nearP && !pod.escorting) { pod.escorting = true; if (RT.diving && !RT.simDrive) C.hud.toast("A dolphin pod is escorting you"); }
    if (!nearP) pod.escorting = false;
    let cx, cz;
    if (pod.escorting) { cx = ref.x; cz = ref.z; }
    else {
      if (d2(pod.wx, pod.wz, pod.members[0].pos.x, pod.members[0].pos.z) < 20) {
        let sc = null, sd = 320;
        for (const c of chain.schools) { const dd = d2(pod.members[0].pos.x, pod.members[0].pos.z, c.x, c.z); if (dd < sd) { sd = dd; sc = c; } }
        if (sc && Math.random() < 0.6) { pod.wx = sc.x; pod.wz = sc.z; }
        else { const a = Math.random() * 6.28, dd = 120 + Math.random() * 200; pod.wx = clamp(pod.members[0].pos.x + Math.sin(a) * dd, V.bounds.minX, V.bounds.maxX); pod.wz = clamp(pod.members[0].pos.z + Math.cos(a) * dd, V.bounds.minZ, V.bounds.maxZ); }
      }
      cx = pod.wx; cz = pod.wz;
    }
    const protectee = pod.leaveT <= 0 ? ref : null;
    for (const m of pod.members) {
      m.jumpCd -= dt; m.chargeCd -= dt;
      if (protectee && !m.charging && m.chargeCd <= 0) {
        for (const s of chain.sharks) {
          if (s.alive && d2(s.pos.x, s.pos.z, protectee.x, protectee.z) < 46 && d3(m.pos, s.pos) < 90) { m.charging = s; break; }
        }
      }
      if (m.charging) {
        const s = m.charging;
        if (!s.alive || d2(s.pos.x, s.pos.z, protectee ? protectee.x : 0, protectee ? protectee.z : 0) > 90) { m.charging = null; }
        else {
          steer(m, s.pos.x, s.pos.y, s.pos.z, 11, 3.2, dt);
          if (d3(m.pos, s.pos) < 3.4) {
            s.aggr = 0; s.calmT = 7; s.state = "flee"; s.fleeFrom = { x: m.pos.x, z: m.pos.z }; s.stateT = 6;
            chain.events.dolphinRepels++;
            if (!RT.simDrive) feedNear(s.pos, "A dolphin drove the shark off!", 160);
            m.charging = null; m.chargeCd = 3;
          }
          clampSwim(m); m.tailT += dt * 9;
          if (m.mesh.userData.tail) m.mesh.userData.tail.rotation.x = Math.sin(m.tailT) * 0.5;
          syncFish(m); continue;
        }
      }
      const surf = surfaceY(m.pos.x, m.pos.z);
      if (m.jumping) {
        m.jy -= 10.5 * dt; m.pos.y += m.jy * dt;
        m.pos.x += Math.sin(m.yaw) * 7.5 * dt; m.pos.z += Math.cos(m.yaw) * 7.5 * dt;
        m.pitch = clamp(Math.atan2(m.jy, 7.5), -1.1, 1.1);
        if (m.jy < 0 && m.pos.y < surf - 0.4) { m.jumping = false; m.jumpCd = 5 + Math.random() * 9; chain.events.dolphinJumps++; }
        m.tailT += dt * 10; if (m.mesh.userData.tail) m.mesh.userData.tail.rotation.x = Math.sin(m.tailT) * 0.4;
        syncFish(m); continue;
      }
      const slotA = m.slot * 1.256 + simT * 0.15;
      const tx = cx + Math.sin(slotA) * (pod.escorting ? 10 : 5);
      const tz = cz + Math.cos(slotA) * (pod.escorting ? 10 : 5);
      const ty = SEA_Y() - 1.3 - Math.abs(Math.sin(simT * 0.7 + m.slot)) * 2.2;
      steer(m, tx, ty, tz, pod.escorting ? 8 : 6.5, 2.6, dt); clampSwim(m);
      if (m.jumpCd <= 0 && m.pos.y > surf - 2.4 && Math.random() < 0.5) { m.jumping = true; m.jy = 6.4; }
      m.tailT += dt * 7; if (m.mesh.userData.tail) m.mesh.userData.tail.rotation.x = Math.sin(m.tailT) * 0.45;
      syncFish(m);
    }
  }

  /* ---- ORCAS (the apex event) ---- */
  function spawnOrcas(x, z) {
    const arr = [];
    for (let i = 0; i < 3 && chain.orcas.length < CAP.orcas; i++) {
      const o = { kind: "orca", mesh: acquire("orca"), pos: { x: x + (Math.random() - 0.5) * 14, y: SEA_Y() - 2.5, z: z + (Math.random() - 0.5) * 14 },
        yaw: 0, pitch: 0, tailT: Math.random() * 6, alive: true, target: null, thrashT: 0, eatT: 0, spoutCd: 3 + Math.random() * 8, leaveT: 60 };
      chain.orcas.push(o); arr.push(o);
    }
    chain.orcaHere = true;
    if (!RT.simDrive) C.hud.toast("ORCA POD INBOUND");
    return arr;
  }
  function updateOrca(o, dt) {
    o.spoutCd -= dt;
    const surf = surfaceY(o.pos.x, o.pos.z);
    if (o.thrashT > 0) {
      o.thrashT -= dt; const s = o.target;
      o.pos.y = Math.min(surf - 0.5, o.pos.y + dt * 2);
      o.roll = Math.sin(o.thrashT * 12) * 0.7;
      if (s) { s.pos.x = o.pos.x + Math.sin(o.yaw) * 2.4; s.pos.z = o.pos.z + Math.cos(o.yaw) * 2.4; s.pos.y = o.pos.y + 0.3; s.roll = Math.sin(o.thrashT * 14) * 1.2; syncFish(s); }
      if (o.thrashT <= 0) { if (s) killShark(s, "orca"); o.target = null; o.eatT = 4; }
      o.tailT += dt * 14; if (o.mesh.userData.tail) o.mesh.userData.tail.rotation.x = Math.sin(o.tailT) * 0.7; syncFish(o); return;
    }
    o.roll = 0;
    if (o.eatT > 0) { o.eatT -= dt; o.tailT += dt * 3; if (o.mesh.userData.tail) o.mesh.userData.tail.rotation.x = Math.sin(o.tailT) * 0.3; syncFish(o); return; }
    if (!o.target || !o.target.alive) {
      o.target = null; let bd = 1e9;
      for (const s of chain.sharks) { if (!s.alive || s.claimed) continue; const dd = d3(o.pos, s.pos); if (dd < bd) { bd = dd; o.target = s; } }
      if (o.target) o.target.claimed = true;
    }
    if (o.target) {
      o.leaveT = 45;
      steer(o, o.target.pos.x, o.target.pos.y, o.target.pos.z, 12, 2.6, dt);
      if (d3(o.pos, o.target.pos) < 3.4) o.thrashT = 2.6;
    } else {
      o.leaveT -= dt;
      const a = simT * 0.2 + chain.orcas.indexOf(o) * 2.1;
      const cx = (chain.orcas[0] || o).pos.x, cz = (chain.orcas[0] || o).pos.z;
      steer(o, cx + Math.sin(a) * 18, o.spoutCd < 1.5 ? SEA_Y() - 1.2 : SEA_Y() - 4, cz + Math.cos(a) * 18, 5, 1.8, dt);
      if (o.spoutCd <= 0 && o.pos.y > surf - 2.6) { o.spoutCd = 9 + Math.random() * 7; chain.events.orcaSpouts++; }
      if (o.leaveT <= 0) {
        steer(o, o.pos.x + V.ux * 200, SEA_Y() - 3, o.pos.z + V.uz * 200, 9, 1.5, dt);
        if (d2(o.pos.x, o.pos.z, V.center.x, V.center.z) > V.radius + 120) {
          release("orca", o.mesh); o.alive = false; chain.orcas.splice(chain.orcas.indexOf(o), 1);
          if (!chain.orcas.length) chain.orcaHere = false;
        }
      }
    }
    clampSwim(o); o.tailT += dt * 6; if (o.mesh.userData.tail) o.mesh.userData.tail.rotation.x = Math.sin(o.tailT) * 0.45; syncFish(o);
  }

  /* ---- MEGALODON (the legend — owns the trench) ---- */
  function forceMeg() {
    if (chain.meg) return chain.meg;
    const T = V.deep;
    chain.meg = { kind: "meg", mesh: acquire("meg"), pos: { x: T.x + 85, y: floorY(T.x + 85, T.z) + 9, z: T.z },
      yaw: 0, pitch: 0, tailT: 0, phase: "lurk", lurkT: 0, runCd: 4, enraged: false, running: false, passHit: false, alive: true };
    if (!RT.simDrive) C.hud.toast("SOMETHING ENORMOUS IS MOVING BELOW");
    return chain.meg;
  }
  function updateMeg(m, dt) {
    const T = V.deep;
    const ref = refPos();
    const inTrench = (RT.diving || RT.simDrive) && d2(ref.x, ref.z, T.x, T.z) < 190;
    if (m.phase === "lurk") {
      m.lurkT += dt;
      const a = simT * 0.11, r = 85;
      steer(m, T.x + Math.sin(a) * r, floorY(T.x, T.z) + 11, T.z + Math.cos(a) * r, 6, 0.8, dt);
      if (inTrench && (RT.goldGrabbed || m.lurkT > 16)) { m.phase = "run"; m.runCd = 2.5; if (!RT.simDrive) C.hud.toast("IT HAS FOUND YOU"); }
    } else if (m.phase === "run") {
      m.runCd -= dt;
      if (!inTrench && d2(ref.x, ref.z, T.x, T.z) > 300) { m.phase = "lurk"; m.lurkT = 0; if (!RT.simDrive) C.hud.toast("It broke off. It does not leave the trench."); }
      else if (m.runCd <= 0 && !m.running) {
        const a = Math.random() * Math.PI * 2;
        m.pos.x = ref.x + Math.sin(a) * 70; m.pos.z = ref.z + Math.cos(a) * 70; m.pos.y = ref.y || SEA_Y() - 4;
        m.yaw = Math.atan2(ref.x - m.pos.x, ref.z - m.pos.z); m.running = true; m.passHit = false;
      }
      if (m.running) {
        const spd = 16;
        m.pos.x += Math.sin(m.yaw) * spd * dt; m.pos.z += Math.cos(m.yaw) * spd * dt;
        m.pos.y += clamp((ref.y || SEA_Y() - 2) - m.pos.y, -6 * dt, 6 * dt);
        const dd = d3(m.pos, ref);
        if (!m.passHit && dd < 4.6) { m.passHit = true; if (!RT.simDrive) hurtDiver(55, m.pos, "THE MEGALODON HIT YOU"); addBlood(ref.x, ref.z, 3, 30); }
        if (d2(m.pos.x, m.pos.z, ref.x, ref.z) > 85) { m.running = false; m.runCd = (m.enraged ? 3.5 : 7) + Math.random() * (m.enraged ? 3 : 6); }
      }
    }
    clampSwim(m); m.tailT += dt * 3.2;
    if (m.mesh.userData.tail) m.mesh.userData.tail.rotation.y = Math.sin(m.tailT) * 0.45;
    if (m.mesh.userData.jaw) m.mesh.userData.jaw.rotation.x = (m.running && d3(m.pos, ref) < 20) ? 0.8 : 0.12;
    syncFish(m);
  }

  /* ---- ambient population pressure + blood decay ---- */
  function updateChainSpawns(dt) {
    chain.sharkTimer -= dt;
    const alive = chain.sharks.filter((s) => s.alive).length;
    if (chain.sharkTimer <= 0 && alive < CAP.sharks && !chain.orcaHere) {
      chain.sharkTimer = 22 + Math.random() * 20;
      const a = Math.random() * 6.28, dd = 160 + Math.random() * 200;
      spawnShark(V.center.x + Math.sin(a) * dd, V.center.z + Math.cos(a) * dd);
    }
    chain.orcaTimer -= dt;
    if (chain.orcaTimer <= 0) {
      chain.orcaTimer = 140 + Math.random() * 90;
      if (!chain.orcaHere && alive >= 2) {
        const a = Math.random() * 6.28, ref = refPos();
        spawnOrcas(ref.x + Math.sin(a) * 200, ref.z + Math.cos(a) * 200);
      }
    }
    for (let i = chain.blood.length - 1; i >= 0; i--) { chain.blood[i].life -= dt; if (chain.blood[i].life <= 0) chain.blood.splice(i, 1); }
  }
  function tickChain(dt) {
    updateChainSpawns(dt);
    for (const s of chain.schools) updateSchool(s, dt);
    for (let i = chain.sharks.length - 1; i >= 0; i--) updateShark(chain.sharks[i], dt);
    for (const s of chain.sharks) s.claimed = false;
    for (const o of chain.orcas.slice()) { if (o.target && o.target.alive) o.target.claimed = true; }
    for (const o of chain.orcas.slice()) updateOrca(o, dt);
    for (const p of chain.pods) updatePod(p, dt);
    if (chain.meg) updateMeg(chain.meg, dt);
    // buoys ride the swell
    for (const w of V.wrecks) if (w.buoy) { w.buoy.position.y = surfaceY(w.wx, w.wz) + 0.1; w.buoy.rotation.x = Math.sin(simT * 1.1 + w.wx) * 0.08; w.buoy.rotation.z = Math.cos(simT * 0.9 + w.wz) * 0.08; }
  }
  function ensureSeeded() {
    if (RT.seeded) return; RT.seeded = true;
    for (let i = 0; i < CAP.schools; i++) { const a = i * 1.7, dd = 120 + i * 90; spawnSchool(V.center.x + Math.sin(a) * dd, V.center.z + Math.cos(a) * dd); }
    for (let i = 0; i < 4; i++) { const a = i * 1.9, dd = 150 + i * 60; spawnShark(V.center.x + Math.sin(a) * dd, V.center.z + Math.cos(a) * dd); }
    for (let i = 0; i < 2; i++) { const a = i * 3.1, dd = 120 + i * 90; spawnDolphins(V.center.x + Math.sin(a) * dd, V.center.z + Math.cos(a) * dd); }
    for (let i = 0; i < CAP.seals; i++) spawnSeal();
  }
  function despawnAll() {
    for (const s of chain.sharks) release("shark", s.mesh); chain.sharks.length = 0;
    for (const p of chain.pods) for (const m of p.members) release("dolphin", m.mesh); chain.pods.length = 0;
    for (const o of chain.orcas) release("orca", o.mesh); chain.orcas.length = 0;
    if (chain.meg) { release("meg", chain.meg.mesh); chain.meg = null; }
    for (const s of chain.seals) release("seal", s.mesh); chain.seals.length = 0;
    for (const s of chain.schools) if (s.mesh) { s.mesh.visible = false; V.creatureRoot.remove(s.mesh); s.mesh.geometry = null; }
    chain.schools.length = 0; chain.blood.length = 0; chain.orcaHere = false; RT.seeded = false;
  }

  /* ---- seals (SHARK-role prey worth more than a bait ball) ---- */
  function spawnSeal() {
    if (chain.seals.length >= CAP.seals) return null;
    const a = Math.random() * 6.28, dd = 90 + Math.random() * 130;
    const x = V.origin.x + V.ux * 40 + Math.sin(a) * dd, z = V.origin.z + V.uz * 40 + Math.cos(a) * dd;
    const s = { kind: "seal", mesh: acquire("seal"), pos: { x, y: SEA_Y() - 1.0, z }, yaw: Math.random() * 6.28, pitch: 0, tailT: 0, wx: x, wz: z, alive: true };
    chain.seals.push(s); return s;
  }
  function updateSeal(s, dt) {
    if (d2(s.pos.x, s.pos.z, s.wx, s.wz) < 6) { const a = Math.random() * 6.28, dd = 30 + Math.random() * 60; s.wx = clamp(s.pos.x + Math.sin(a) * dd, V.bounds.minX, V.bounds.maxX); s.wz = clamp(s.pos.z + Math.cos(a) * dd, V.bounds.minZ, V.bounds.maxZ); }
    const surf = surfaceY(s.pos.x, s.pos.z);
    steer(s, s.wx, surf - 0.8 - Math.abs(Math.sin(simT + s.tailT)) * 0.8, s.wz, 4.5, 2, dt); clampSwim(s);
    s.tailT += dt * 6; if (s.mesh.userData.tail) s.mesh.userData.tail.rotation.x = Math.sin(s.tailT) * 0.4; syncFish(s);
  }

  /* ============================ the two roles ============================ */
  function insideBounds(x, z) { const b = V.bounds; return x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ; }
  function playerInWater() {
    const P = CBZ.player;
    if (!P) return false;
    const swimming = CBZ.citySwimming ? CBZ.citySwimming() : (P._swim === true);
    return swimming && insideBounds(P.pos.x, P.pos.z);
  }
  function feedNear(p, msg, r) { const P = CBZ.player; if (P && d2(P.pos.x, P.pos.z, p.x, p.z) < (r || 180)) C.hud.toast(msg); }
  function warn(msg, scary) { C.hud.feed(msg, scary ? "#ff5a4a" : "#9adcb8"); }
  function hurtDiver(dmg, from, reason) {
    if (RT.hurtCd > 0) return; RT.hurtCd = 0.4;
    if (CBZ.cityHurtPlayer && CBZ.player) CBZ.cityHurtPlayer(dmg, from ? from.x : null, from ? from.z : null, reason, false, null, false);
    else warn(reason, true);
    C.hud.feed(reason, "#ff5a4a");
    if (CBZ.player && CBZ.player.hp != null && CBZ.player.hp < 22 && !CBZ.player.dead) dragAshore("Dragged ashore — the water nearly took you.");
  }
  function dragAshore(reason) {
    const P = CBZ.player; if (!P) return;
    const wx = V.origin.x - V.ux * 9, wz = V.origin.z - V.uz * 9;
    const y = (CBZ.floorAt ? (CBZ.floorAt(wx, wz) || 0) : 0);
    P.pos.set(wx, y + 1.0, wz); P.vy = 1.6; P.grounded = false; P._swim = false;
    if (CBZ.playerChar) CBZ.playerChar.swimming = false;
    if (P.stamina != null) P.stamina = (P.maxStamina != null ? P.maxStamina : 100);
    RT.o2 = o2cap(); RT.diving = false;
    C.hud.toast(reason);
  }

  function salvageTick(dt) {
    const P = CBZ.player;
    // oxygen: drain by LOCAL depth while diving; warn sparsely; drown at zero
    const depth = depthAt(P.pos.x, P.pos.z);
    RT.o2 -= o2Rate(depth) * dt;
    RT.warnCd -= dt;
    if (RT.o2 <= 0) {
      RT.o2 = 0; RT.drownT += dt;
      if (RT.drownT >= 1) { RT.drownT = 0; hurtDiver(6, null, "No air — you're drowning"); }
      if (RT.o2 <= 0 && RT.drownT === 0) {} // (hurtDiver may already drag ashore)
    } else {
      RT.drownT = 0;
      if (RT.o2 < 20 && RT.warnCd <= 0) { RT.warnCd = 4; C.hud.feed("Air low — " + Math.ceil(RT.o2) + "s. Head for the dock.", "#f0a028"); }
    }
    // salvage: work a buoy you're near that still has crates
    for (const w of V.wrecks) {
      if (w.crates <= 0) continue;
      if (d2(P.pos.x, P.pos.z, w.wx, w.wz) < 9) {
        w.workT += dt;
        if (w.workT >= 2.4) {
          w.workT = 0; w.crates--;
          const night = isNight();
          const gold = w.gold && w.crates === 0;
          const v = (gold ? GOLD_VALUE : w.val) * (night ? 2 : 1);
          bag().cargo.push({ v, gold, night }); save();
          if (gold) { RT.goldGrabbed = true; forceMeg(); C.hud.toast("THE AURORA GOLD IS YOURS — NOW SURVIVE"); }
          else C.hud.feed("+$" + v + " salvage in the hold" + (night ? " (night x2)" : ""), "#ffd166");
        }
      } else w.workT = 0;
    }
    // defence: F fires a harpoon at the nearest threatening shark (hitscan)
    if (CBZ.keys && CBZ.keys["f"] && !RT._fLatch) { RT._fLatch = true; fireHarpoon(); }
    if (CBZ.keys && !CBZ.keys["f"]) RT._fLatch = false;
    // C drops chum ahead of you (lures sharks THERE, away from you)
    if (CBZ.keys && CBZ.keys["c"] && !RT._cLatch) { RT._cLatch = true; throwChum(); }
    if (CBZ.keys && !CBZ.keys["c"]) RT._cLatch = false;
  }
  function fireHarpoon() {
    if (bag().bolts <= 0) { C.hud.feed("Out of harpoon bolts — buy more at the kiosk", "#f0a028"); return; }
    const P = CBZ.player; let best = null, bd = 26;
    for (const s of chain.sharks) { if (!s.alive) continue; const dd = d3(s.pos, P.pos); if (dd < bd) { bd = dd; best = s; } }
    if (!best) { C.hud.feed("Harpoon fired — nothing in range", "#9adcb8"); return; }
    bag().bolts--; save();
    best.hp--; best.state = "flee"; best.fleeFrom = { x: P.pos.x, z: P.pos.z }; best.stateT = 5;
    addBlood(best.pos.x, best.pos.z, 2, 35);
    if (best.hp <= 0) { killShark(best, "bolt"); chain.sharkTimer = Math.min(chain.sharkTimer, 8); C.hud.feed("Shark killed — the blood is calling MORE", "#ff5a4a"); }
    else C.hud.feed("Harpoon hit — it's bleeding and fleeing", "#9adcb8");
  }
  function throwChum() {
    if (bag().chum <= 0) { C.hud.feed("No chum left — buy at the kiosk", "#f0a028"); return; }
    bag().chum--; save();
    const P = CBZ.player, hx = Math.sin(RT.sharkYaw || 0), hz = Math.cos(RT.sharkYaw || 0);
    addBlood(P.pos.x + hx * 16, P.pos.z + hz * 16, 4, 70);
    C.hud.toast("Chum in the water — sharks will come THERE, not here");
  }

  function sharkRoleTick(dt) {
    const P = CBZ.player;
    // heading from movement (fall back to last yaw when stationary)
    const vx = P.pos.x - RT.lastP.x, vz = P.pos.z - RT.lastP.z;
    if (Math.hypot(vx, vz) > 0.02) RT.sharkYaw = Math.atan2(vx, vz);
    RT.lastP.x = P.pos.x; RT.lastP.z = P.pos.z;
    // the player IS a great white: attach the avatar, hide the human rig
    if (!RT.playerShark) { RT.playerShark = acquire("shark"); if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.visible = false; }
    const ps = RT.playerShark;
    ps.position.set(P.pos.x, surfaceY(P.pos.x, P.pos.z) - 1.4, P.pos.z);
    ps.rotation.set(0, RT.sharkYaw, 0);
    ps.userData._t = (ps.userData._t || 0) + dt * 8;
    if (ps.userData.tail) ps.userData.tail.rotation.y = Math.sin(ps.userData._t) * 0.5;
    // EAT: bait balls and seals within range → score
    RT.fedCd -= dt;
    for (const s of chain.schools) {
      if (d2(P.pos.x, P.pos.z, s.x, s.z) < 8 && RT.fedCd <= 0) { s.scatter = 1; RT.fedCd = 0.8; RT.score += 60; chain.events.playerFed++; C.hud.feed("Fed on the bait ball  +60", "#9adcb8"); }
    }
    for (let i = chain.seals.length - 1; i >= 0; i--) {
      const sl = chain.seals[i];
      if (d2(P.pos.x, P.pos.z, sl.pos.x, sl.pos.z) < 5) { release("seal", sl.mesh); chain.seals.splice(i, 1); RT.score += 220; addBlood(sl.pos.x, sl.pos.z, 2, 25); C.hud.toast("SEAL TAKEN  +220"); }
    }
    // ORCAS hunt YOU: caught → run ends, score banked
    for (const o of chain.orcas) { if (o.alive && d2(o.pos.x, o.pos.z, P.pos.x, P.pos.z) < 6) { endSharkRun("THE ORCA POD RAN YOU DOWN"); return; } }
    // HARPOON threat near the dock/surface: flee it
    RT.harpoonCd -= dt;
    if (d2(P.pos.x, P.pos.z, V.origin.x, V.origin.z) < 60 && RT.harpoonCd <= 0) {
      RT.harpoonCd = 6;
      if (CBZ.cityHurtPlayer && CBZ.player) CBZ.cityHurtPlayer(18, V.origin.x, V.origin.z, "the harpooner tagged you", false, null, false);
      C.hud.feed("HARPOON from the dock — get to deep water!", "#ff5a4a");
    }
  }
  function endSharkRun(reason) {
    if (RT.score > bag().hiShark) { bag().hiShark = RT.score; save(); }
    C.hud.toast(reason + " — score " + RT.score + (RT.score >= bag().hiShark ? " (BEST)" : ""));
    RT.score = 0;
    dragAshore("Washed up on the dock.");
  }
  function detachShark() { if (RT.playerShark) { release("shark", RT.playerShark); RT.playerShark = null; } if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.visible = true; }

  /* ============================== economy =============================== */
  function sellSalvage(ctx) {
    const cargo = bag().cargo;
    if (!cargo.length) { ctx.hud.feed("Nothing in the hold to sell", "#f0a028"); return; }
    const v = cargoValue(); const hadGold = cargo.some((c) => c.gold);
    ctx.wallet.give(v, "Salvage sold"); bag().cargo = []; if (v > bag().hiSalvage) bag().hiSalvage = v; save();
    if (hadGold) ctx.hud.toast("THE AURORA GOLD IS CASHED OUT — $" + v.toLocaleString());
    else ctx.hud.toast("Sold the hold for $" + v.toLocaleString());
  }

  /* ============================== the panel ============================= */
  const BTN = "display:inline-block;margin:4px 8px 4px 0;padding:9px 15px;border-radius:11px;cursor:pointer;font-weight:800;font-size:14px;user-select:none;";
  const on = "background:#2a8a9a;color:#04170a;", off = "background:rgba(255,255,255,.08);color:#e8f2f5;";
  function openCharter() {
    const s = bag();
    const nextO2 = O2_TIERS[s.o2Tier + 1], costO2 = O2_COST[s.o2Tier + 1];
    const canO2 = s.o2Tier < 3 && C.wallet.canAfford(costO2 || 1e9);
    const canBolt = C.wallet.canAfford(BOLT_COST) && s.bolts < 12;
    const canChum = C.wallet.canAfford(CHUM_COST) && s.chum < 5;
    const html =
      "<div style='display:flex;justify-content:space-between;align-items:center;margin-bottom:8px'>" +
        "<b style='letter-spacing:2px;color:#f0a028;font-size:17px'>DEAD WATER — CHARTER</b>" +
        "<span style='font-size:13px'>cash <b style='color:#ffd451'>$" + C.wallet.cash().toLocaleString() + "</b></span></div>" +
      "<div style='font-size:12px;opacity:.85;margin-bottom:6px'>Pick your role in the water:</div>" +
      "<div>" +
        "<span data-act='roleSalvage' style='" + BTN + (RT.role === "salvage" ? on : off) + "'>SALVAGE DIVER</span>" +
        "<span data-act='roleShark' style='" + BTN + (RT.role === "shark" ? on : off) + "'>THE SHARK</span>" +
      "</div>" +
      (RT.role === "salvage"
        ? "<div style='font-size:12px;opacity:.85;margin:8px 0 4px'>Swim the buoys for cash. Air drains with depth — surface at the dock. " +
          "F harpoon · C chum. Hold: <b>$" + cargoValue().toLocaleString() + "</b> · best haul <b>$" + s.hiSalvage.toLocaleString() + "</b></div>" +
          "<div>" +
          "<span data-act='buyO2' style='" + BTN + (canO2 ? on : off) + "'>O2 tank → " + (nextO2 ? nextO2 + "s ($" + costO2 + ")" : "MAX") + "</span>" +
          "<span data-act='buyBolt' style='" + BTN + (canBolt ? on : off) + "'>Harpoon x4 ($" + BOLT_COST + ") — have " + s.bolts + "</span>" +
          "<span data-act='buyChum' style='" + BTN + (canChum ? on : off) + "'>Chum x1 ($" + CHUM_COST + ") — have " + s.chum + "</span>" +
          "</div>"
        : "<div style='font-size:12px;opacity:.85;margin:8px 0 4px'>You ARE the great white. Eat bait balls and seals for score. " +
          "Dodge the orca pod. Flee the harpoon near the dock. Best score: <b>" + s.hiShark + "</b></div>") +
      "<div style='margin-top:8px'><span data-act='sell' style='" + BTN + off + "'>Sell salvage</span>" +
        "<span data-act='close' style='" + BTN + off + "'>Close (Esc)</span></div>";
    C.hud.panel(html, {
      roleSalvage() { setRole("salvage"); openCharter(); },
      roleShark() { setRole("shark"); openCharter(); },
      buyO2() { if (canO2 && C.wallet.spend(costO2, "O2 tank upgraded")) { s.o2Tier++; RT.o2 = o2cap(); save(); } openCharter(); },
      buyBolt() { if (canBolt && C.wallet.spend(BOLT_COST, "Harpoon bolts")) { s.bolts = Math.min(12, s.bolts + 4); save(); } openCharter(); },
      buyChum() { if (canChum && C.wallet.spend(CHUM_COST, "Chum bucket")) { s.chum = Math.min(5, s.chum + 1); save(); } openCharter(); },
      sell() { sellSalvage(C); openCharter(); },
      close() { C.hud.closePanel(); },
    });
  }
  function setRole(r) {
    if (RT.role === r) return;
    if (RT.role === "shark") detachShark();
    RT.role = r; bag().role = r; save();
    RT.score = 0; RT.o2 = o2cap();
    C.hud.toast(r === "shark" ? "Role: THE SHARK" : "Role: SALVAGE DIVER");
  }

  /* ============================== update ================================ */
  function update(ctx, dt) {
    if (!V) return;
    C = C || ctx;
    if (CBZ.game && CBZ.game.mode && CBZ.game.mode !== "city") { if (chain.sharks.length || chain.schools.length) despawnAll(); if (RT.playerShark) detachShark(); return; }
    dt = Math.min(0.05, dt || 0);
    simT += dt;
    const P = CBZ.player;
    const near = P && d2(P.pos.x, P.pos.z, V.center.x, V.center.z) < V.radius + NEAR;
    const inWater = playerInWater();

    if (!near && !inWater) { if (RT.seeded) despawnAll(); if (RT.playerShark) detachShark(); RT.diving = false; return; }

    ensureSeeded();
    tickChain(dt);
    for (const s of chain.seals) updateSeal(s, dt);

    // role state transitions on entering/leaving the water
    const wasDiving = RT.diving;
    RT.diving = inWater;
    if (RT.diving && !wasDiving) { if (RT.role === "salvage") { RT.o2 = RT.o2 || o2cap(); bag().dives++; save(); } RT.lastP.x = P.pos.x; RT.lastP.z = P.pos.z; }
    if (!RT.diving && wasDiving) { if (RT.role === "shark" && RT.playerShark) endSharkRun("You left the water"); RT.hurtCd = 0; }
    RT.hurtCd = Math.max(0, RT.hurtCd - dt);

    if (RT.diving) {
      if (RT.role === "salvage") salvageTick(dt);
      else sharkRoleTick(dt);
    } else {
      // refill air topside; keep the human rig if a role was left mid-water
      RT.o2 = Math.min(o2cap(), RT.o2 + 22 * dt);
      if (RT.role !== "shark" && RT.playerShark) detachShark();
    }
  }

  /* ============================ probe / api ============================= */
  // Headless full-chain stepper — PROVES dolphins repel and orcas kill.
  // Stages a deterministic scenario around a virtual focus, then steps the
  // real ecology at a fixed 30Hz and returns the event deltas.
  function simChain(seconds) {
    if (!V) return { error: "not mounted" };
    const before = JSON.parse(JSON.stringify(chain.events));
    // stage: focus in the deep field, sharks aggroed on it, dolphins to repel
    // them, blood to pull the sharks in, and an orca pod to make the kills.
    RT.simDrive = true;
    RT.simFocus = { x: V.center.x, y: SEA_Y() - 6, z: V.center.z };
    const F = RT.simFocus;
    despawnAll(); RT.seeded = true;
    for (let i = 0; i < CAP.schools; i++) spawnSchool(F.x + Math.sin(i) * 120, F.z + Math.cos(i) * 120);
    for (let i = 0; i < 5; i++) { const a = (i / 5) * 6.28; const s = spawnShark(F.x + Math.sin(a) * 24, F.z + Math.cos(a) * 24); if (s) { s.aggr = 0.85; s.state = "circle"; s.stateT = 99; } }
    for (let i = 0; i < 2; i++) spawnDolphins(F.x + Math.sin(i * 2) * 16, F.z + Math.cos(i * 2) * 16);
    addBlood(F.x, F.z, 4, seconds + 5);
    // orcas start well out so the pod's first dolphin repels land before the
    // apex closes in and starts killing — the probe wants BOTH counters > 0.
    spawnOrcas(F.x + 150, F.z + 95);
    const o2Before = o2cap();
    const steps = Math.min(30000, Math.round((seconds || 0) * 30));
    for (let i = 0; i < steps; i++) { simT += 1 / 30; tickChain(1 / 30); }
    RT.simDrive = false; RT.simFocus = null;
    const depth = depthAt(V.deep.x, V.deep.z);
    const rate = o2Rate(depth);
    const o2After = Math.max(0, o2Before - rate * (seconds || 0));
    const delta = {}; for (const k in chain.events) delta[k] = chain.events[k] - before[k];
    let aggrMax = 0; for (const s of chain.sharks) if (s.alive) aggrMax = Math.max(aggrMax, s.aggr);
    return {
      seconds, events: delta,
      sharksAlive: chain.sharks.filter((s) => s.alive).length,
      aggrMax: +aggrMax.toFixed(3),
      o2: { before: o2Before, after: +o2After.toFixed(2), rate: +rate.toFixed(4), depth: +depth.toFixed(2) },
    };
  }

  /* ============================== register ============================= */
  CBZ.games.register({
    id: "ocean", title: "DEAD WATER",
    venue: { site: "ocean", resolve },
    build,
    update,
    api: {
      simChain,
      o2Rate,
      O2_TIERS,
      chain: () => ({
        sharks: chain.sharks.filter((s) => s.alive).length,
        pods: chain.pods.length, dolphins: chain.pods.reduce((n, p) => n + p.members.length, 0),
        orcas: chain.orcas.length, schools: chain.schools.length, seals: chain.seals.length,
        meg: !!chain.meg, blood: chain.blood.length, events: Object.assign({}, chain.events),
      }),
      role: () => RT.role,
      setRole,
      forceMeg: () => (V ? forceMeg() && true : false),
      spawnShark: (x, z) => (V ? !!spawnShark(x == null ? V.center.x : x, z == null ? V.center.z : z) : false),
      spawnDolphins: (x, z) => (V ? !!spawnDolphins(x == null ? V.center.x : x, z == null ? V.center.z : z) : false),
      spawnOrcas: (x, z) => (V ? !!spawnOrcas(x == null ? V.center.x : x, z == null ? V.center.z : z) : false),
      state: () => (state ? JSON.parse(JSON.stringify(state)) : null),
      mounted: () => !!V,
      bounds: () => (V ? Object.assign({}, V.bounds) : null),
      anchor: () => (V ? { x: V.origin.x, z: V.origin.z, bearing: V.bearing, deep: V.deep } : null),
      o2: () => RT.o2,
      score: () => RT.score,
    },
  });
})();
