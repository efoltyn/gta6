/* ============================================================
   systems/tornado.js — CBZ.tornado, THE ONE VORTEX.

   Every tornado in the game is this file: the Natural Disaster island
   (systems/disasters.js's `tornado` def only authors the sky, the siren and
   the island bridge, then calls spawn/stop), the city's weather director at
   the bottom, and the lab (src/lab/kits/tornado.js). CBZ.tornadoAudit() is
   the ratchet that keeps it that way.

   2026-10-14 REWRITE — "make it far more realistic". What a real tornado is,
   and where each part lives below:

   THE PARENT STORM. A tornado hangs from a supercell, it does not stand in a
   clear sky. buildStorm(): a broad storm base (a soft spiral-striated deck
   that turns), a lowered rotating WALL CLOUD under it, a RAIN-WRAP curtain on
   the rear flank (behind and to the right of the track, where the rear-flank
   downdraft wraps the hook), and the forward-flank precipitation core ahead
   and to the left, where the HAIL falls (hail below).

   THE FUNNEL is ONE deformable tube (plus a translucent veil), re-shaped on
   the CPU every frame along a curved SPINE from the ground to the cloud:
     touchdown  the CONDENSATION FUNNEL descends out of the wall cloud as a
                pointed tip while the DEBRIS CLOUD already whirls at the
                ground (the circulation reaches the ground before the
                condensation does: real, and the scariest frame of a video);
     mature     rope (EF0-1) ... wedge (EF4-5) proportions; the base LAGS the
                cloud (surface friction), so the column TILTS along the track;
     rope-out   the last quarter: the column thins to a rope, the tilt grows,
                it contorts, the wind weakens with it, and at the very end
                the condensation lifts from the bottom up.
   ~900 vertices total, two draws: cheaper than the old 10-ring stack.

   THE WIND FIELD (fieldInto) is a Rankine combined vortex with a height
   profile: corner-flow INFLOW strongest in the lowest tens of metres, an
   annular UPDRAFT, OUTFLOW at the top of the updraft (that is what throws
   debris out), the storm's own forward motion added (so the right side of
   the track is the strong side, the most-cited real asymmetry), an
   intensity ENVELOPE (spin-up, mature, rope-out), and for EF3+ SUCTION
   VORTICES: 3-5 small, violent sub-vortices orbiting inside the core that
   leave CYCLOIDAL marks on the ground and the narrow worst swaths of damage.

   DAMAGE IS THE EF SCALE, READ BACKWARDS. The EF scale rates a tornado from
   what it did to "damage indicators"; here the local gust at a house decides
   which DEGREE OF DAMAGE it reaches, using the EF scale's own one- and
   two-family-residence (FR12) expected wind speeds:
       35 m/s  roof covering lost (shingles fly)
       43 m/s  roof decking uplifted (the windward roof part goes)
       54 m/s  ROOF OFF (every roof part is lifted and thrown)
       59 m/s  exterior walls collapse (the two wind-facing walls go over)
       68 m/s  most walls down
       89 m/s  SWEPT OFF THE FOUNDATION (everything above the slab lofted)
   applied to the building's REAL PARTS: the roof meshes, the wall meshes,
   the slab. A building that publishes `b.parts = {roof, walls, slab}` is
   used as published; one that does not is read by geometry (deriveParts).
   A building whose walls are one merged shell (the island's walk-ups and
   towers) hands its structural failure to ONE ADAPTER, structDamage(),
   which calls CBZ.collapse.damage when that exists and the current ledger
   (the island bridge's hitBuilding / city/structural.js) otherwise. Trees
   use the hardwood/softwood indicators (twigs, limbs, snapped, uprooted,
   debarked). Cars use FORCES, not a table: drag, lift and the updraft
   against weight and friction make a car slide at ~EF2, roll at ~EF3 and
   fly at EF4-5, which is what the EF descriptions say.

   EVERY PIECE OF A BUILDING IS A BODY IN systems/debris.js (2026-10-15).
   The wind is a MEDIUM there (CBZ.debris.medium("tornado"), registered while
   a vortex lives): drag toward the local wind, the updraft as the vertical
   flow, under the debris sim's ceiling (no lift 30 m over the ground) and
   its speed caps. Roofs and walls are adopted whole (throwPart / fellWall:
   a felled wall is a body tipping over its own base edge, not a scripted
   hinge); shingles, boards, roof sheet, masonry and leaves are the debris
   sim's grit (CBZ.debris.bit). They ORBIT because the inflow holds them,
   CLIMB because the updraft lifts them, are THROWN OUT where the field
   turns to outflow, and come down, collide, pile and rest on what is under
   them like every other piece. Nothing here sets a piece's position.
   Cars (and torn tree crowns) keep the vehicle integrator (stepFlyer), held
   to the same limits; a car left on a roof falls again if the roof goes.

   THE PATH: one ground-scar ribbon laid along the track at the measured
   width where the gust scours the ground (narrow, sharp, offset to the
   strong side), plus the suction vortices' cycloidal marks.

   STORM EXTRAS: hail falling in the forward flank around the camera
   (instanced, bounces, lies, melts; sized by the storm), the civil-defence
   tornado siren (T.siren), dust points in the debris cloud.

   RESET: every change this file makes to the world off the city (a roof
   lifted, a wall felled, a tree blown over, a car thrown, a collider pulled)
   goes in a JOURNAL, and T.restoreWorld() puts it all back (the island's
   run reset calls it). PHONE: every count rides CBZ.qScale; the whole thing
   adds ~14 draws; the tick is measured (T.perf) and reported by the lab.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  if (CBZ.tornado) return;                       // idempotent family guard

  CBZ.CONFIG = CBZ.CONFIG || {};
  // TORNADO_CITY: the master switch (spawn() returns null when false).
  if (CBZ.CONFIG.TORNADO_CITY == null) CBZ.CONFIG.TORNADO_CITY = true;
  // TORNADO_STRUCTURAL: city lots are ground through city/structural.js.
  if (CBZ.CONFIG.TORNADO_STRUCTURAL == null) CBZ.CONFIG.TORNADO_STRUCTURAL = true;
  // TORNADO_LIFT: cars can be moved by the wind at all.
  if (CBZ.CONFIG.TORNADO_LIFT == null) CBZ.CONFIG.TORNADO_LIFT = true;
  // How many funnels may exist at once (every world query is per vortex).
  if (CBZ.CONFIG.TORNADO_MAX == null) CBZ.CONFIG.TORNADO_MAX = 1;

  const T = (CBZ.tornado = {});
  const q = function (lo, hi) { return CBZ.qScale ? CBZ.qScale(lo, hi) : (lo + hi) * 0.5; };
  const qi = function (lo, hi) { return Math.max(1, Math.round(q(lo, hi))); };

  /* ============================================================
     THE EF TABLE. vmax = peak 3-second gust at the core radius R (NWS band
     midpoints). R is the RADIUS OF MAXIMUM WIND, not the damage width: a
     real EF1 does its damage in a 30-60 m swath, an EF5 in a few hundred
     metres. (It was 26-140 m, which made every class a district-wide disc.)
     ============================================================ */
  const EF = [
    { vmax: 33,  R: 12, fwd: 11.0, life: 40 },   // EF0
    { vmax: 43,  R: 16, fwd: 12.6, life: 52 },   // EF1
    { vmax: 55,  R: 22, fwd: 14.2, life: 64 },   // EF2
    { vmax: 67,  R: 30, fwd: 15.8, life: 78 },   // EF3
    { vmax: 81,  R: 40, fwd: 17.4, life: 94 },   // EF4
    { vmax: 100, R: 55, fwd: 19.0, life: 112 },  // EF5
  ];
  const EF_EDGES = [38, 49.5, 60.5, 74, 89];      // 3-s gust band edges, m/s
  // Beyond OUTER_MUL * R the free-vortex tail is tapered to nothing, so every
  // query has a hard bound. With the square taper below, the EF0 gust (29 m/s)
  // ends ~1.2-1.6 R from the axis: a NARROW, SHARP path.
  const OUTER_MUL = 3.2;
  const LIFT_MUL = 0.5;                           // updraft / vmax (observed 0.3-0.6)
  const AIR_RHO = 1.225;
  const G = 9.81;
  const DPS0 = 0.85;                              // city ledger: damage/s at 33 m/s (v^3 law)

  /* DEGREES OF DAMAGE, m/s — the EF scale's FR12 (one- and two-family
     residence) expected wind speeds, mph converted. These are the house's
     numbers; a masonry walk-up is RES_MASONRY stronger, an engineered tower
     RES_ENGINEERED (whose structure then fails through the ledger). */
  const DOD = { cover: 35, deck: 43, roof: 54, walls: 59, most: 68, swept: 89 };
  const RES_MASONRY = 1.15, RES_ENGINEERED = 1.45;
  // trees (EF DI 27/28): small limbs, large limbs, snapped/uprooted, debarked
  const TREE = { twigs: 27, limbs: 33, down: 41, debark: 64 };

  /* ============================================================
     STATE
     ============================================================ */
  const live = [];
  let idSeq = 0;
  const stats = {
    roofsDamaged: 0,      // buildings that lost roof covering (DOD 2+)
    roofsRemoved: 0,      // buildings whose roof structure was lifted off
    roofParts: 0,         // roof meshes thrown
    wallsDown: 0,         // wall panels felled
    buildingsFailed: 0,   // whole-structure failures handed to the ledger/collapse
    housesSwept: 0,       // swept off the foundation
    treesDown: 0, treesStripped: 0,
    carsMoved: 0, carsRolled: 0, carsThrown: 0,
    debrisLofted: 0,      // small pieces ever put in the air
    flyersLaunched: 0,    // big parts (roofs/walls/cars/crowns) put in flight
    buildingHits: 0, buildingCollapses: 0,
    scarSections: 0, suctionMarks: 0,
    shelterSaves: 0, pathMeters: 0,
    hailStones: 0,
    maxDebrisHeight: 0, maxCarHeight: 0, maxThrow: 0,
  };
  // the tick's cost, and the worst frame of each stage (what a phone pays)
  const perf = { frames: 0, ms: 0, max: 0, last: 0, sec: {} };
  let _pt0 = 0;
  function lap(name) {
    const n = performance.now(), d = n - _pt0;
    _pt0 = n;
    const S = perf.sec;
    if (!(S[name] >= d)) S[name] = d;
  }
  let rngStream = null;
  function rng() {
    if (!rngStream) rngStream = CBZ.seedStream ? CBZ.seedStream("tornado") : Math.random;
    return rngStream();
  }
  function h01(x, z, salt) { return CBZ.hash01 ? CBZ.hash01(x, z, salt) : 0.5; }

  function arenaRoot() {
    const g = CBZ.game;
    if (g && g.mode === "city" && CBZ.city && CBZ.city.arena && CBZ.city.arena.root) return CBZ.city.arena.root;
    if (g && g.mode === "survival" && CBZ.surv && CBZ.surv.arena && CBZ.surv.arena.root) return CBZ.surv.arena.root;
    if (CBZ.LAB && CBZ.labWorld && CBZ.labWorld.W && CBZ.labWorld.W.root) return CBZ.labWorld.W.root;
    return CBZ.scene || null;
  }
  function inCity() { return CBZ.game && CBZ.game.mode === "city"; }
  function floorAt(x, z) { return CBZ.floorAt ? (+CBZ.floorAt(x, z) || 0) : 0; }
  function camPos() { return CBZ.camera ? CBZ.camera.position : null; }
  function camDist(x, z) {
    const c = camPos();
    return c ? Math.hypot(x - c.x, z - c.z) : 0;
  }

  /* THE WORLD THE VORTEX WORKS ON. Off the city it is a BRIDGE of closures:
     the island's (lent by systems/disasters.js), the lab's, or CBZ.island's
     own lists when it publishes them. Never hard-coded positions:
       fragile()   building records {group, x|ox, z|oz, w, d, h, storeys, gy,
                   colliders, platforms, fallen, parts?}
       cars()      car records (island {group, x, z, collider, flung} or a
                   city car {pos, group, mass, dims})
       trees()     {x, z, trunk, foliage}
       ground(x,z) the walkable surface height
       hitBuilding(b, amount, dirx, dirz)  the structural ledger
       carGlass(car, dirx, dirz)           the car's own windows break
       sheltered(actor)                    an interior room test           */
  function islandBridge() {
    const I = CBZ.island;
    if (!I || inCity()) return null;
    const list = function (k1, k2) { return function () { const v = I[k1] || (k2 && I[k2]); return Array.isArray(v) ? v : (typeof v === "function" ? v() : []); }; };
    return {
      fragile: list("buildings", "fragile"), cars: list("cars"), trees: list("trees", "flammable"),
      ground: typeof I.groundAt === "function" ? I.groundAt : (typeof I.groundHeightAt === "function" ? I.groundHeightAt : null),
    };
  }
  let lastWorld = null;
  function groundOf(W) {
    if (W && typeof W.ground === "function") return function (x, z) { let g; try { g = +W.ground(x, z); } catch (e) {} return Number.isFinite(g) ? g : floorAt(x, z); };
    if (!inCity() && CBZ.surv && CBZ.surv.arena && CBZ.surv.arena.groundHeightAt) return function (x, z) { return CBZ.surv.arena.groundHeightAt(x, z); };
    return floorAt;
  }

  /* ============================================================
     THE JOURNAL — everything this file changes in a non-city world, so
     T.restoreWorld() can put it back exactly.
     ============================================================ */
  const journal = [];
  const touched = new Set();          // records carrying our _tw state
  function jObj(o) {
    if (!o || o.userData._twJ || inCity()) return;
    o.userData._twJ = true;
    journal.push({ k: 0, o: o, parent: o.parent, p: o.position.clone(), q: o.quaternion.clone(), s: o.scale.clone(), v: o.visible });
  }
  function dropCollider(c) {
    const C = CBZ.colliders;
    if (!c || !C) return;
    const i = C.indexOf(c);
    if (i < 0) return;
    C.splice(i, 1);
    if (!inCity()) journal.push({ k: 1, c: c });
    if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
  }
  function addCollider(c) {
    if (!CBZ.colliders) return;
    CBZ.colliders.push(c);
    if (!inCity()) journal.push({ k: 2, c: c });
    if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
  }
  function dropPlatform(p) {
    const P = CBZ.platforms;
    if (!p || !P) return;
    const i = P.indexOf(p);
    if (i < 0) return;
    P.splice(i, 1);
    if (!inCity()) journal.push({ k: 3, p: p });
    if (CBZ.markPlatformsDirty) CBZ.markPlatformsDirty();
  }
  // move a mesh out of its building into the arena root, keeping where it is
  function liberate(o) {
    jObj(o);
    const root = arenaRoot();
    if (root && o.parent !== root) {
      if (o.parent) o.parent.updateMatrixWorld(true);
      root.updateMatrixWorld(true);
      root.attach(o);
    }
  }

  /* ============================================================
     TEXTURES — all built once per module, deterministic arithmetic, never
     Math.random (two clients build byte-identical storms).
     ============================================================ */
  let texCache = null;
  function textures() {
    if (texCache) return texCache;
    const canvas = function (w, h) { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; };
    const wrap = function (c) { const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t; };
    // the condensation funnel: a dense column with streak variation in it and
    // RAGGED alpha punched through so no grazing edge is a ruler line
    let c = canvas(64, 256), g = c.getContext("2d");
    g.fillStyle = "rgba(226,223,218,0.9)"; g.fillRect(0, 0, 64, 256);
    for (let i = 0; i < 200; i++) {
      const x = (i * 53) % 64, y = (i * 97) % 256, h = 14 + ((i * 29) % 52), a = 0.12 + ((i * 37) % 40) / 220;
      g.fillStyle = (i % 3) ? "rgba(255,253,248," + a.toFixed(3) + ")" : "rgba(112,106,98," + (a * 0.9).toFixed(3) + ")";
      g.fillRect(x, y, 1 + (i % 3), h);
    }
    g.globalCompositeOperation = "destination-out";
    for (let i = 0; i < 90; i++) {
      g.fillStyle = "rgba(0,0,0," + (0.22 + ((i * 31) % 45) / 110).toFixed(3) + ")";
      g.fillRect((i * 47) % 64, (i * 83) % 256, 1 + (i % 2), 10 + ((i * 23) % 34));
    }
    g.globalCompositeOperation = "source-over";
    const dense = c;
    // the veil: faint streaks on transparency
    c = canvas(64, 256); g = c.getContext("2d");
    for (let i = 0; i < 220; i++) {
      const a = 0.10 + ((i * 37) % 45) / 260;
      g.fillStyle = "rgba(214,210,200," + a.toFixed(3) + ")";
      g.fillRect((i * 53) % 64, (i * 97) % 256, 1 + (i % 3), 12 + ((i * 29) % 46));
    }
    for (let i = 0; i < 40; i++) { g.fillStyle = "rgba(58,54,48,0.30)"; g.fillRect((i * 41) % 64, (i * 61) % 256, 2, 26 + ((i * 17) % 40)); }
    const veil = c;
    // the storm base: a soft disc with LOG-SPIRAL striations (the inflow bands
    // a rotating mesocyclone base shows from underneath), dissolving at the rim
    c = canvas(256, 256); g = c.getContext("2d");
    const img = g.createImageData(256, 256), d = img.data;
    for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
      const dx = (x - 127.5) / 127.5, dy = (y - 127.5) / 127.5, r = Math.hypot(dx, dy);
      const i4 = (y * 256 + x) * 4;
      if (r >= 1) { d[i4 + 3] = 0; continue; }
      const th = Math.atan2(dy, dx);
      const band = 0.5 + 0.5 * Math.sin(th * 3 + Math.log(r + 0.04) * 7.5);
      const fall = r < 0.45 ? 1 : Math.max(0, 1 - (r - 0.45) / 0.55);
      const v = 200 + 50 * band;
      d[i4] = v; d[i4 + 1] = v; d[i4 + 2] = v + 4;
      d[i4 + 3] = Math.round(255 * fall * fall * (0.72 + 0.28 * band));
    }
    g.putImageData(img, 0, 0);
    const deck = new THREE.CanvasTexture(c);
    /* rain streaks: TILEABLE BOTH WAYS (the shader scrolls it down the shaft
       and around it, and the old top-to-bottom gradient tiled into a hard
       band sliding down the curtain). Only the alpha is read: thin falling
       streaks over a soft even haze, every streak drawn twice across the
       wrap so no row or column ever shows a seam. Mipmapped by default, so
       a curtain 300 m out averages to haze instead of shimmering. */
    c = canvas(64, 256); g = c.getContext("2d");
    g.fillStyle = "rgba(255,255,255,0.30)"; g.fillRect(0, 0, 64, 256);
    for (let i = 0; i < 230; i++) {
      const x = (i * 37 + ((i * 7) % 5)) % 64, y = (i * 71) % 256, len = 22 + ((i * 13) % 70);
      g.fillStyle = "rgba(255,255,255," + (0.25 + ((i * 29) % 50) / 100).toFixed(3) + ")";
      g.fillRect(x, y, 1, len);
      if (y + len > 256) g.fillRect(x, y - 256, 1, len);
    }
    g.globalCompositeOperation = "destination-out";
    for (let i = 0; i < 90; i++) {
      const x = (i * 23 + 11) % 64, y = (i * 53) % 256, len = 30 + ((i * 17) % 80);
      g.fillStyle = "rgba(0,0,0,0.35)";
      g.fillRect(x, y, 2, len);
      if (y + len > 256) g.fillRect(x, y - 256, 2, len);
    }
    g.globalCompositeOperation = "source-over";
    const rain = c;
    // the ground scar: torn earth with ragged edges across its width (u)
    c = canvas(64, 64); g = c.getContext("2d");
    for (let x = 0; x < 64; x++) {
      const e = Math.min(x, 63 - x) / 32;           // 0 at the edges, 1 mid
      for (let y = 0; y < 64; y++) {
        const n = ((x * 73 + y * 151) % 97) / 97, n2 = ((x * 31 + y * 17) % 53) / 53;
        const a = Math.max(0, Math.min(1, (e * 1.6 - 0.15 + (n - 0.5) * 0.6)));
        const v = 70 + Math.round(40 * n2);
        g.fillStyle = "rgba(" + v + "," + Math.round(v * 0.82) + "," + Math.round(v * 0.62) + "," + a.toFixed(3) + ")";
        g.fillRect(x, y, 1, 1);
      }
    }
    const scar = c;
    // a soft round sprite for the dust in the debris cloud
    c = canvas(64, 64); g = c.getContext("2d");
    const rg = g.createRadialGradient(32, 32, 2, 32, 32, 32);
    rg.addColorStop(0, "rgba(255,255,255,0.9)"); rg.addColorStop(0.5, "rgba(255,255,255,0.45)"); rg.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = rg; g.fillRect(0, 0, 64, 64);
    const dust = new THREE.CanvasTexture(c);
    texCache = { dense: wrap(dense), veil: wrap(veil), deck: deck, rain: wrap(rain), scar: wrap(scar), dust: dust };
    return texCache;
  }
  function cloneTex(t, rx, ry) {
    const c = t.clone();
    c.wrapS = c.wrapT = THREE.RepeatWrapping;
    c.needsUpdate = true;
    c.repeat.set(rx, ry);
    return c;
  }

  /* ============================================================
     THE STORM AND THE FUNNEL (one group per vortex)
     ============================================================ */
  function makeTube(nR, nS) {
    const g = new THREE.BufferGeometry();
    const n = (nR + 1) * (nS + 1);
    const pos = new Float32Array(n * 3), uv = new Float32Array(n * 2);
    for (let i = 0; i <= nR; i++) for (let j = 0; j <= nS; j++) {
      const k = i * (nS + 1) + j;
      uv[k * 2] = j / nS; uv[k * 2 + 1] = i / nR;
    }
    const idx = [];
    for (let i = 0; i < nR; i++) for (let j = 0; j < nS; j++) {
      const a = i * (nS + 1) + j, b = a + 1, c = a + nS + 1, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
    g.setIndex(idx);
    const pa = new THREE.BufferAttribute(pos, 3);
    if (pa.setUsage) pa.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute("position", pa);
    g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1);
    return g;
  }
  /* THE RAIN SHAFT. It used to be a streak texture on two open cylinders with
     MeshBasic alpha: an even see-through tube with a crisp silhouette, a
     ruled top and bottom, and a straight cut at each end of the arc (owner:
     "a see-through cylinder, looks fake"). A real shaft is a VOLUME: densest
     where you look through the most of it, nothing at its edge. So:
       - alpha follows |N.V|: through the middle of the shell (front and back
         face both) it is dense, at the silhouette it is gone;
       - the density is broken into SHAFTS round the circumference (a few
         periodic octaves of angle, drifting, also sheared with height so the
         shafts lean and braid instead of standing as stripes);
       - streaks fall through it on a tileable texture at two scales/speeds;
       - it dissolves into the cloud base at the top and into a ragged,
         uneven foot at the ground, and an arc fades out at both ends. */
  function rainShaftMat(map, arcLen) {
    const U = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uMap: { value: null }, uColor: { value: new THREE.Color(0x2c3035) },
      uOpacity: { value: 0 }, uTime: { value: 0 }, uArcLen: { value: arcLen },
    }]);
    U.uMap.value = map;
    const m = new THREE.ShaderMaterial({
      uniforms: U, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true,
      vertexShader: [
        "varying vec2 vUv;",
        "varying vec3 vN;",
        "varying vec3 vW;",
        "#include <fog_pars_vertex>",
        "void main() {",
        "  vUv = uv;",
        "  vec4 wp = modelMatrix * vec4(position, 1.0);",
        "  vW = wp.xyz;",
        "  vN = normalize(mat3(modelMatrix) * normal);",
        "  vec4 mvPosition = viewMatrix * wp;",
        "  gl_Position = projectionMatrix * mvPosition;",
        "  #include <fog_vertex>",
        "}",
      ].join("\n"),
      fragmentShader: [
        "uniform sampler2D uMap;",
        "uniform vec3 uColor;",
        "uniform float uOpacity;",
        "uniform float uTime;",
        "uniform float uArcLen;",
        "varying vec2 vUv;",
        "varying vec3 vN;",
        "varying vec3 vW;",
        "#include <fog_pars_fragment>",
        "void main() {",
        "  float th = vUv.x * uArcLen;",
        "  float y = vUv.y;",
        // shafts: integer frequencies round the full circle (seamless), each
        // sheared with height and drifting at its own rate
        "  float sh = 0.5 + 0.5 * (0.46 * sin(3.0 * th + 1.3 + 0.9 * y + 0.06 * uTime)",
        "                        + 0.32 * sin(7.0 * th + 0.4 - 1.7 * y - 0.10 * uTime)",
        "                        + 0.22 * sin(13.0 * th + 2.0 + 2.9 * y + 0.15 * uTime));",
        "  float shaft = smoothstep(0.22, 0.86, sh);",
        "  float rep = floor(uArcLen / 6.2832 * 6.0 + 0.5);",
        "  float s1 = texture2D(uMap, vec2(vUv.x * max(1.0, rep), y * 1.1 + uTime * 1.5)).a;",
        "  float s2 = texture2D(uMap, vec2(vUv.x * max(2.0, rep * 2.0) + 0.37, y * 2.1 + uTime * 2.4)).a;",
        "  float streak = 0.40 + 0.85 * (s1 * 0.55 + s2 * 0.45);",
        // a ragged foot (rain reaching the ground unevenly) and a top that
        // melts into the cloud base
        "  float foot = smoothstep(0.015, 0.05 + 0.10 * sh, y);",
        "  float top = 1.0 - smoothstep(0.62 + 0.14 * sh, 0.98, y);",
        "  vec3 V = normalize(cameraPosition - vW);",
        "  float facing = abs(dot(normalize(vN), V));",
        "  float edge = smoothstep(0.06, 0.70, facing);",
        "  edge *= edge;",
        "  float ends = uArcLen < 6.2 ? smoothstep(0.0, 0.28, min(vUv.x, 1.0 - vUv.x)) : 1.0;",
        "  float a = uOpacity * (0.18 + 0.82 * shaft) * streak * foot * top * edge * ends;",
        "  if (a < 0.004) discard;",
        "  vec3 col = uColor * (0.82 + 0.36 * (1.0 - shaft)) * (0.9 + 0.2 * y);",
        "  gl_FragColor = vec4(col, min(a, 0.9));",
        "  #include <tonemapping_fragment>",
        "  #include <encodings_fragment>",
        "  #include <fog_fragment>",
        "}",
      ].join("\n"),
    });
    m.name = "tornado-rain-shaft";
    return m;
  }
  function basicMat(o) {
    return new THREE.MeshBasicMaterial(Object.assign({ transparent: true, side: THREE.DoubleSide, depthWrite: false }, o));
  }

  function buildFunnel(t) {
    const root = arenaRoot();
    if (!root) return;
    const X = textures();
    const grp = new THREE.Group();
    grp.userData.dynamic = true;                    // batch.js / farcull.js keep off
    grp.name = "tornado-funnel";
    const wg = t.wedge;
    // cloud base height: a rope is tall and thin, a wedge broad and squat
    const H = 150 + 70 * wg + t.R * 0.6;
    const nR = qi(14, 26), nS = qi(12, 20);
    /* THE LINEAR-HEX TRAP: core/renderer.js runs sRGB output with r128 colour
       management off, so material hex is LINEAR and gamma-lifted on screen.
       These are authored in linear: 0x15171c reaches the screen ≈ #52565e. */
    const matIn = basicMat({ map: cloneTex(X.dense, 3, 1), color: 0x15171c, opacity: 0.84, fog: false });
    const matOut = basicMat({ map: cloneTex(X.veil, 2, 1), color: 0x3b3d42, opacity: 0.34 });
    const tubeIn = new THREE.Mesh(makeTube(nR, nS), matIn);
    const tubeOut = new THREE.Mesh(makeTube(nR, nS), matOut);
    tubeIn.name = "tw-funnel"; tubeOut.name = "tw-veil";
    for (const m of [tubeIn, tubeOut]) { m.renderOrder = 3; m.castShadow = m.receiveShadow = false; grp.add(m); }

    // THE DEBRIS CLOUD's shells: dirt, not more cloud
    const seg = qi(10, 16);
    const skirtH = Math.max(7, t.R * (0.7 + 0.9 * wg));
    const matSkirt = basicMat({ map: cloneTex(X.dense, 3, 1), color: 0x331d0c, opacity: 0.6, fog: false });
    const skirt = new THREE.Mesh(new THREE.CylinderGeometry(t.R * 1.1, t.R * 1.45, skirtH, seg, 1, true), matSkirt);
    skirt.position.y = skirtH * 0.45;
    const skirt2 = new THREE.Mesh(new THREE.CylinderGeometry(t.R * 0.7, t.R * 1.0, skirtH * 1.5, seg, 1, true), matSkirt);
    skirt2.position.y = skirtH * 0.7;
    for (const m of [skirt, skirt2]) { m.renderOrder = 3; m.castShadow = m.receiveShadow = false; grp.add(m); }

    // THE DUST in the debris cloud: one Points draw, CPU-orbited
    const nDust = qi(70, 240);
    const dpos = new Float32Array(nDust * 3);
    const dust = [];
    for (let i = 0; i < nDust; i++) {
      dust.push({ a: i * 2.399, r: t.R * (0.4 + ((i * 37) % 100) / 90), y: ((i * 53) % 100) / 100 * skirtH * 1.6,
        vy: 0.6 + ((i * 29) % 10) / 10, sv: -1 });
    }
    const dg = new THREE.BufferGeometry();
    const da = new THREE.BufferAttribute(dpos, 3);
    if (da.setUsage) da.setUsage(THREE.DynamicDrawUsage);
    dg.setAttribute("position", da);
    dg.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, skirtH, 0), t.R * 2 + skirtH);
    const matDust = new THREE.PointsMaterial({ map: X.dust, color: 0x3a2a1a, size: Math.max(4, t.R * 0.32), sizeAttenuation: true,
      transparent: true, opacity: 0.5, depthWrite: false });
    const dustPts = new THREE.Points(dg, matDust);
    dustPts.renderOrder = 4;
    grp.add(dustPts);

    /* THE PARENT STORM rides a sub-group at the top of the spine (the cloud
       end of the funnel), so the funnel's tilt reads as the base lagging the
       storm, which is what it is. */
    const cloud = new THREE.Group();
    grp.add(cloud);
    const rCl = Math.max(t.R * 2.2, 70);
    const matWall = basicMat({ map: cloneTex(X.dense, 4, 1), color: 0x0e0f13, opacity: 0.92, fog: false });
    const wall1 = new THREE.Mesh(new THREE.CylinderGeometry(rCl * 1.05, rCl * 0.8, H * 0.12, seg, 1, true), matWall);
    wall1.position.y = -H * 0.05;                   // the LOWERED wall cloud
    const wall2 = new THREE.Mesh(new THREE.CylinderGeometry(rCl * 2.4, rCl * 1.05, H * 0.08, seg, 1, true), matWall);
    wall2.position.y = H * 0.03;
    const matDeck = basicMat({ map: X.deck, color: 0x0b0d0c, opacity: 0.96, fog: false });
    const deck = new THREE.Mesh(new THREE.CircleGeometry(Math.min(rCl * 6, 640), Math.max(16, seg + 6)), matDeck);
    deck.rotation.x = Math.PI / 2;                   // faces down at the player
    deck.position.y = H * 0.07;
    // RAIN-WRAP on the rear flank and the precipitation core ahead-left: two
    // soft rain shafts (rainShaftMat), each the height of the storm, the core
    // widening toward the ground the way a precipitation shaft spreads
    const rainMap = cloneTex(X.rain, 1, 1);
    const matRain = rainShaftMat(rainMap, Math.PI * 1.15);
    const matRainCore = rainShaftMat(rainMap, Math.PI * 2);
    const rainR = rCl * 1.25;
    const rainWrap = new THREE.Mesh(new THREE.CylinderGeometry(rainR, rainR * 0.9, H * 1.05, seg + 14, 6, true, 0, Math.PI * 1.15), matRain);
    rainWrap.position.y = -H * 0.5;
    const ffdR = rCl * 1.4;
    const ffd = new THREE.Mesh(new THREE.CylinderGeometry(ffdR * 0.85, ffdR * 1.1, H * 1.05, seg + 14, 6, true, 0, Math.PI * 2), matRainCore);
    ffd.position.y = -H * 0.5;
    for (const m of [wall1, wall2, deck, rainWrap, ffd]) { m.renderOrder = 3; m.castShadow = m.receiveShadow = false; cloud.add(m); }

    grp.position.set(t.x, t.gfn(t.x, t.z), t.z);
    root.add(grp);
    // spine scratch: ring centres for the current frame
    const cen = new Float32Array((nR + 1) * 3);
    t.mesh = { grp, tubeIn, tubeOut, skirt, skirt2, dustPts, dust, cloud, wall1, wall2, deck, rainWrap, ffd,
      matIn, matOut, matSkirt, matDust, matWall, matDeck, matRain, matRainCore, rainMap, H, nR, nS, cen, skirtH, rCl, ffdR };
  }

  function disposeFunnel(t) {
    const M = t.mesh;
    if (!M) return;
    try {
      if (M.grp.parent) M.grp.parent.remove(M.grp);
      M.grp.traverse(function (o) { if (o.geometry) o.geometry.dispose(); });
      for (const m of [M.matIn, M.matOut, M.matSkirt, M.matWall, M.matRain, M.matRainCore]) { if (m.map) m.map.dispose(); m.dispose(); }
      if (M.rainMap) M.rainMap.dispose();
      M.matDust.dispose(); M.matDeck.dispose();
    } catch (e) {}
    t.mesh = null;
  }

  /* The funnel's life, as three numbers read by the shape AND the field:
       k     wind intensity envelope (spin-up, mature, rope-out decay)
       s0    where the visible condensation ends (1 = only at the cloud, 0 = on
             the ground): it DESCENDS at touchdown and LIFTS at the very end
       rope  0..1 through the rope-out stage */
  const TOUCH = 5.0;               // s for the condensation to reach the ground
  function lifecycle(t) {
    const a = t.age, L = t.life;
    const f = L > 0 ? a / L : 0;
    t.rope = Math.max(0, Math.min(1, (f - 0.72) / 0.28));
    const spin = Math.min(1, a / (TOUCH * 0.6));    // the ground whirl comes first
    const sm = spin * spin * (3 - 2 * spin);
    t.k = sm * (1 - 0.55 * t.rope) * (f > 0.94 ? Math.max(0, 1 - (f - 0.94) / 0.06) : 1);
    const desc = Math.min(1, a / TOUCH);
    const lift = f > 0.9 ? Math.min(1, (f - 0.9) / 0.1) : 0;
    t.s0 = Math.max(1 - desc * desc * (3 - 2 * desc), lift);
  }

  const _T = new THREE.Vector3(), _N = new THREE.Vector3(), _B = new THREE.Vector3(), _ref = new THREE.Vector3();
  function shapeTube(M, t, tube, radMul, s0, rB, rT, pw) {
    const nR = M.nR, nS = M.nS, cen = M.cen;
    const pos = tube.geometry.attributes.position.array;
    for (let i = 0; i <= nR; i++) {
      const s = s0 + (1 - s0) * (i / nR);
      let r = rB + (rT - rB) * Math.pow(s, pw);
      // the descending condensation TIP is pointed, not a cut-off pipe
      if (s0 > 0.02) { const k = (s - s0) / Math.max(0.05, (1 - s0) * 0.35); r *= k >= 1 ? 1 : Math.max(0.05, k * k * (3 - 2 * k)); }
      r *= radMul * (1 + 0.09 * Math.sin(t.age * 1.35 + i * 0.62) + 0.05 * Math.sin(t.age * 3.1 + i * 1.17));
      const cx = cen[i * 3], cy = cen[i * 3 + 1], cz = cen[i * 3 + 2];
      const i0 = Math.max(0, i - 1), i1 = Math.min(nR, i + 1);
      _T.set(cen[i1 * 3] - cen[i0 * 3], cen[i1 * 3 + 1] - cen[i0 * 3 + 1], cen[i1 * 3 + 2] - cen[i0 * 3 + 2]).normalize();
      _ref.set(0, 0, 1);
      if (Math.abs(_T.z) > 0.9) _ref.set(1, 0, 0);
      _N.copy(_ref).addScaledVector(_T, -_T.dot(_ref)).normalize();
      _B.crossVectors(_T, _N);
      for (let j = 0; j <= nS; j++) {
        const th = (j / nS) * Math.PI * 2, c = Math.cos(th) * r, sn = Math.sin(th) * r;
        const k = (i * (nS + 1) + j) * 3;
        pos[k] = cx + _N.x * c + _B.x * sn;
        pos[k + 1] = cy + _N.y * c + _B.y * sn;
        pos[k + 2] = cz + _N.z * c + _B.z * sn;
      }
    }
    tube.geometry.attributes.position.needsUpdate = true;
    const bs = tube.geometry.boundingSphere;
    bs.center.set(cen[(nR >> 1) * 3], cen[(nR >> 1) * 3 + 1], cen[(nR >> 1) * 3 + 2]);
    bs.radius = M.H * 0.75 + rT * 2;
  }

  function animateFunnel(t, dt) {
    const M = t.mesh;
    if (!M) return;
    const gy = t.gfn(t.x, t.z);
    M.grp.position.set(t.x, gy, t.z);
    const H = M.H, rope = t.rope, wg = t.wedge;
    const f = Math.hypot(t.fvx, t.fvz) || 1, dx = t.fvx / f, dz = t.fvz / f;
    /* THE SPINE. The cloud end LEADS along the track (the ground drags the
       base back), more so as it ropes out, when the parent storm moves away
       and the rope stretches into a long tilted, contorted tube. */
    const tilt = H * (0.10 + 0.08 * (1 - wg) + 0.55 * rope);
    const sway = t.R * (0.25 + 0.4 * (1 - wg)) * (1 + 3.5 * rope);
    const cx = dx * tilt + Math.sin(t.age * 0.21 + t.id) * t.R * 0.6;
    const cz = dz * tilt + Math.cos(t.age * 0.17 + t.id) * t.R * 0.6;
    const mx = cx * 0.12, mz = cz * 0.12, my = H * 0.42;
    const cen = M.cen, nR = M.nR;
    const freq = 5 + 6 * rope;
    for (let i = 0; i <= nR; i++) {
      const s = i / nR, u = 1 - s;
      const bx = 2 * s * u * mx + s * s * cx, by = 2 * s * u * my + s * s * H, bz = 2 * s * u * mz + s * s * cz;
      const env = Math.sin(Math.PI * Math.min(1, s * 1.15));
      cen[i * 3] = bx + Math.sin(t.age * 0.9 + s * freq + t.id) * sway * env;
      cen[i * 3 + 1] = by;
      cen[i * 3 + 2] = bz + Math.cos(t.age * 0.73 + s * freq * 0.8) * sway * env;
    }
    // ring centres follow s0 too: re-sample the spine at the visible span
    const s0 = t.s0;
    if (s0 > 0.001) {
      for (let i = nR; i >= 0; i--) {
        const s = s0 + (1 - s0) * (i / nR), fi = s * nR, a = Math.min(nR - 1, Math.floor(fi)), b = fi - a;
        for (let c = 0; c < 3; c++) cen[i * 3 + c] = cen[a * 3 + c] * (1 - b) + cen[(a + 1) * 3 + c] * b;
      }
    }
    // proportions: rope (thin trumpet) ... wedge (broad, near-straight sides)
    const thin = 1 - 0.82 * rope;
    const rB = t.R * (0.30 + 0.62 * wg) * thin, rT = Math.max(t.R * (1.0 + 0.5 * wg), 14) * (1 - 0.6 * rope);
    const pw = 0.55 + 0.4 * wg;
    shapeTube(M, t, M.tubeIn, 1, s0, rB, rT, pw);
    shapeTube(M, t, M.tubeOut, 1.35, Math.max(0, s0 - 0.04), rB + t.R * 0.12, rT * 1.15, pw);
    // the cloud rides the spine's top
    M.cloud.position.set(cen[nR * 3], H, cen[nR * 3 + 2]);
    const spin = (t.vmax / Math.max(1, t.R)) * 0.5;
    t.spin = (t.spin || 0) + spin * dt;
    M.wall1.rotation.y += spin * 0.18 * dt;
    M.wall2.rotation.y += spin * 0.10 * dt;
    M.deck.rotation.z += spin * 0.05 * dt;
    // the rain-wrap arc sits behind and to the RIGHT of the track (the rear
    // flank); the forward-flank core ahead and to the LEFT (where hail falls)
    const rx = -dx - dz * 0.8, rz = -dz + dx * 0.8;
    M.rainWrap.rotation.y = Math.atan2(rx, rz) - Math.PI * 0.575;
    const fx = dx * 1.0 + dz * 1.0, fz = dz * 1.0 - dx * 1.0, fl = Math.hypot(fx, fz) || 1;
    t.ffdX = t.x + cen[nR * 3] + fx / fl * M.rCl * 2.6;
    t.ffdZ = t.z + cen[nR * 3 + 2] + fz / fl * M.rCl * 2.6;
    M.ffd.position.set(fx / fl * M.rCl * 2.6, -H * 0.5, fz / fl * M.rCl * 2.6);
    // texture motion: up the column and round it
    const sc = 0.5 * dt * (t.vmax / 60);
    M.matIn.map.offset.y -= sc; M.matIn.map.offset.x -= spin * 0.12 * dt;
    M.matOut.map.offset.y -= sc * 0.6; M.matOut.map.offset.x -= spin * 0.07 * dt;
    M.matSkirt.map.offset.y -= sc * 0.8; M.matSkirt.map.offset.x -= spin * 0.2 * dt;
    M.matWall.map.offset.x += 0.02 * dt;
    M.matRain.uniforms.uTime.value += dt;
    M.matRainCore.uniforms.uTime.value += dt;
    // the debris-cloud shells and the dust live on the WIND's schedule
    const k = t.k;
    M.skirt.rotation.y -= spin * 0.7 * dt;
    M.skirt2.rotation.y += spin * 0.5 * dt;
    const sk = Math.max(0.001, k * (1 - 0.7 * rope));
    M.skirt.scale.set(sk * (1 + 0.14 * Math.sin(t.age * 1.9)), 0.3 + 0.7 * sk, sk);
    M.skirt2.scale.set(sk * (1 + 0.18 * Math.sin(t.age * 2.6 + 1.4)), 0.3 + 0.7 * sk, sk);
    stepDust(t, M, dt);
    // fades: in over the first second, out over the last 1.6 s
    const fade = Math.min(1, t.age / 1.0) * Math.min(1, Math.max(0, t.life - t.age) / 1.6);
    M.matIn.opacity = 0.84 * fade;
    M.matOut.opacity = 0.34 * fade;
    M.matSkirt.opacity = 0.6 * fade * Math.min(1, k * 1.3);
    M.matDust.opacity = 0.5 * fade * Math.min(1, k * 1.2);
    M.matWall.opacity = 0.92 * fade;
    M.matDeck.opacity = 0.96 * fade;
    const rainA = 0.5 * fade * Math.min(1, t.age / 3) * t.wrap;
    M.matRain.uniforms.uOpacity.value = rainA;
    M.matRainCore.uniforms.uOpacity.value = rainA;
  }

  function stepDust(t, M, dt) {
    const pos = M.dustPts.geometry.attributes.position.array;
    const D = M.dust, top = M.skirtH * 1.7, k = t.k, R = t.R;
    const sv = t.sv;
    for (let i = 0; i < D.length; i++) {
      const p = D[i];
      // a fifth of the dust rides the suction vortices on a strong tornado
      if (sv && i % 5 === 0) {
        const v = sv[(i / 5 | 0) % sv.length];
        p.a += 3.2 * dt; p.y += p.vy * 2.4 * k * dt;
        if (p.y > top * 0.6) p.y = 0.3;
        const rr = v.rs * (0.6 + (i % 7) * 0.2);
        pos[i * 3] = v.x - t.x + Math.cos(p.a) * rr; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = v.z - t.z + Math.sin(p.a) * rr;
        continue;
      }
      const r = Math.max(R * 0.25, p.r);
      const vt = r <= R ? t.vmax * r / R : t.vmax * R / r;
      p.a -= (vt * k / r) * 0.55 * dt;               // cyclonic (counter-clockwise from above)
      p.r -= p.r * 0.12 * k * dt;
      p.y += p.vy * (2 + 6 * k) * dt;
      if (p.y > top || p.r < R * 0.3) { p.y = 0.3 + (i % 5) * 0.3; p.r = R * (0.75 + ((i * 13) % 10) / 12); }
      pos[i * 3] = Math.cos(p.a) * p.r; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = Math.sin(p.a) * p.r;
    }
    M.dustPts.geometry.attributes.position.needsUpdate = true;
  }

  /* ============================================================
     THE WIND FIELD — CBZ.tornado.at(x, z[, y]).
     Returns {speed, gust, inflow, lift, vx, vz, r, ef, pressure}:
       speed   the vortex's rotating speed at that point (m/s)
       gust    the GROUND-RELATIVE horizontal wind incl. the storm's motion
               and the suction vortices: what a house actually feels
       vx, vz  that wind as a vector; lift the updraft (m/s, +y)
     ============================================================ */
  const _fieldOut = { speed: 0, gust: 0, inflow: 0, lift: 0, vx: 0, vz: 0, r: Infinity, ef: -1, pressure: 0 };
  const _s = { speed: 0, gust: 0, inflow: 0, lift: 0, vx: 0, vz: 0, r: 0, ef: -1, pressure: 0 };
  const _s2 = { speed: 0, gust: 0, inflow: 0, lift: 0, vx: 0, vz: 0, r: 0, ef: -1, pressure: 0 };
  function zero(out, r, ef) { out.speed = out.gust = out.inflow = out.lift = out.vx = out.vz = out.pressure = 0; out.r = r; out.ef = ef; return out; }
  function fieldInto(t, x, z, out, y) {
    y = y > 0 ? y : 0;
    const dx = x - t.x, dz = z - t.z;
    const r = Math.hypot(dx, dz);
    const k = t.k;
    if (r > t.outer || k <= 0) return zero(out, r, t.ef);
    const rr = r < 0.35 ? 0.35 : r;
    const ux = dx / rr, uz = dz / rr;
    let vt = rr <= t.R ? t.vrot * (rr / t.R) : t.vrot * (t.R / rr);
    let tail = 1;
    if (rr > t.R) { tail = 1 - (rr - t.R) / (t.outer - t.R); vt *= tail * tail; }
    const hz = y / t.Hup;
    vt *= k * (hz <= 1 ? 1 : Math.max(0.25, 1 - (hz - 1) * 1.5));
    // corner flow: inflow strongest near the ground; OUTFLOW above the updraft
    const inK = hz < 0.3 ? 1 : (hz < 1 ? 1 - (hz - 0.3) / 0.7 * 1.5 : -0.5);
    const vin = 0.5 * vt * inK;
    const u = (rr - 0.6 * t.R) / (0.7 * t.R);
    // the corner region: the updraft is already strong a few metres up (what
    // lifts a car); it is zero only at the ground itself
    let w = t.wmax * k * Math.exp(-u * u) * Math.min(1, (y + 3) / 6) * (hz <= 1 ? 1 : Math.max(0, 1 - (hz - 1) * 2));
    // CYCLONIC: counter-clockwise seen from above (+y), tangent = (uz, -ux)
    let vx = uz * vt - ux * vin;
    let vz = -ux * vt - uz * vin;
    let spd = vt;
    const sv = t.sv;
    if (sv && y < t.Hup * 0.4) {
      const kk = k * (1 - y / (t.Hup * 0.4));
      for (let i = 0; i < sv.length; i++) {
        const S = sv[i], sx = x - S.x, sz = z - S.z, d = Math.hypot(sx, sz);
        if (d > S.rs * 4) continue;
        const dd = d < 0.3 ? 0.3 : d;
        let v = dd <= S.rs ? S.v * dd / S.rs : S.v * S.rs / dd;
        if (dd > S.rs) { const tl = 1 - (dd - S.rs) / (3 * S.rs); v *= tl * tl; }
        v *= kk;
        vx += (sz / dd) * v; vz += (-sx / dd) * v;
        spd += v; w += v * 0.5;
      }
    }
    // the storm's own motion, felt within the circulation
    const tr = rr <= t.R ? 1 : tail;
    vx += t.fvx * tr; vz += t.fvz * tr;
    out.speed = spd; out.inflow = vin; out.lift = w;
    out.vx = vx; out.vz = vz;
    out.gust = Math.hypot(vx, vz);
    out.pressure = 0.5 * AIR_RHO * out.gust * out.gust;
    out.r = r; out.ef = t.ef;
    return out;
  }
  // the strongest live vortex's field at a point (they are capped at 1-2)
  function fieldAt(x, z, out, y) {
    if (!live.length) return zero(out, Infinity, -1);
    if (live.length === 1) return fieldInto(live[0], x, z, out, y);
    let best = null, bs = -1;
    for (let i = 0; i < live.length; i++) {
      fieldInto(live[i], x, z, _s2, y);
      if (_s2.gust > bs) { bs = _s2.gust; best = live[i]; }
    }
    return fieldInto(best, x, z, out, y);
  }
  T.at = function (x, z, y) { return fieldAt(x, z, _fieldOut, y); };

  T.threat = function (x, z) {
    let th = 0;
    for (let i = 0; i < live.length; i++) {
      const v = live[i];
      const d = Math.hypot(x - v.x, z - v.z);
      const reach = v.R * 3.0;
      if (d < reach) th = Math.max(th, (1 - d / reach) * Math.max(0.3, v.k));
    }
    return th;
  };
  T.safeDir = function (x, z) {
    if (!live.length) return null;
    /* Inside the funnel's reach the honest answer is a DOORWAY: you do not
       outrun a tornado on foot, you get inside something sturdy that is not
       itself in the path. Far away, run at right angles to the track. */
    for (let i = 0; i < live.length; i++) {
      const t = live[i], W = t.world;
      if (!W || !W.fragile) continue;
      const d0 = Math.hypot(x - t.x, z - t.z);
      if (d0 > t.R * 4 || d0 < t.R * 0.9) continue;
      let frag = null;
      try { frag = W.fragile(); } catch (e) {}
      if (!frag) continue;
      let best = null, bd = 1e9;
      for (let j = 0; j < frag.length; j++) {
        const b = frag[j];
        if (!b || b.fallen || (b._dmg || 0) > 0.6 || (b._tw && b._tw.dod >= 3)) continue;
        const bx = bxOf(b), bz = bzOf(b);
        // the island's buildings door on -z (disaster_arena.js's grammar)
        const doorX = bx, doorZ = bz - b.d * 0.5 - 1.2;
        const ad = Math.hypot(x - doorX, z - doorZ);
        if (ad > 34 || ad < 1.0) continue;
        if (Math.hypot(bx - t.x, bz - t.z) < t.R * 2 + 4) continue;   // it IS the path
        if (ad < bd) { bd = ad; best = { x: doorX - x, z: doorZ - z }; }
      }
      if (best) return best;
    }
    let bx = 0, bz = 0;
    for (let i = 0; i < live.length; i++) {
      const v = live[i];
      const dx = x - v.x, dz = z - v.z, d = Math.hypot(dx, dz) || 1;
      if (d > v.R * 4) continue;
      const f = Math.max(1, Math.hypot(v.fvx, v.fvz));
      bx += (dx / d) * 0.45 - v.fvz / f;
      bz += (dz / d) * 0.45 + v.fvx / f;
    }
    return (bx || bz) ? { x: bx, z: bz } : null;
  };
  function bxOf(b) { return b.x != null ? b.x : b.ox; }
  function bzOf(b) { return b.z != null ? b.z : b.oz; }

  /* ============================================================
     SMALL DEBRIS — shingles, boards, roof sheet, chunks, leaves. There used
     to be a private InstancedMesh pool here with its own integrator: no
     building collisions, no cap on height (a shingle rode the updraft as
     high as the field reached), resting only on the terrain. Every bit is
     now systems/debris.js's grit (CBZ.debris.bit): gravity, the floor and
     roofs, rest, the reset — and the wind is the "tornado" medium below,
     acting on it as a force with the debris sim's ceiling and caps.
     ============================================================ */
  // per kind: the grit shape it is, its size (m), how hard the wind grips it
  // (beta = 0.5 rho Cd A / m, 1/m), what it is made of
  const DK = [
    { name: "shingle", shape: "flake", size: 0.4, beta: 0.10, kind: "wood" },
    { name: "board",   shape: "plank", size: 1.6, beta: 0.012, kind: "wood" },
    { name: "sheet",   shape: "plate", size: 1.2, beta: 0.09, kind: "metal" },
    { name: "chunk",   shape: "stone", size: 0.3, beta: 0.006, kind: "concrete" },
  ];
  // spawn one piece; colorHex is the colour of the part it came off
  function spawnDebris(kind, x, y, z, vx, vy, vz, colorHex, scale, gfn, betaMul) {
    const D = CBZ.debris;
    if (!D || !D.bit) return -1;
    const K = DK[kind] || DK[3];
    let n = 0;
    try {
      n = D.bit(x, y, z, { shape: K.shape, kind: K.kind, color: colorHex == null ? 0x7a6a58 : colorHex,
        size: K.size * (scale || 1), vel: { x: vx, y: vy, z: vz }, beta: K.beta * (betaMul || 1), owner: "tornado" });
    } catch (e) { n = 0; }
    if (n) stats.debrisLofted++;
    return n ? 0 : -1;
  }
  function debrisCounts() {
    let aloft = 0, total = 0, maxH = 0;
    try {
      const D = CBZ.debris;
      if (D && D.audit) { const a = D.audit({}); aloft = a.gritAloft + a.live - a.asleep; maxH = a.maxHeight; }
      if (D && D.stats) total = D.stats().grit;
    } catch (e) {}
    if (maxH > stats.maxDebrisHeight) stats.maxDebrisHeight = maxH;
    return { airborne: aloft, onGround: Math.max(0, total - aloft), total: total };
  }
  function clearDebris() {
    if (CBZ.debris && CBZ.debris.clear) { try { CBZ.debris.clear("tornado"); } catch (e) {} }
  }

  /* THE WIND AS A MEDIUM (CBZ.debris.medium). While a vortex lives, every
     loose piece in the debris sim — the roofs and walls this file tears off,
     the bits, AND the rubble any other system left lying in the path — is
     pushed by the same field that does the damage: drag toward the local
     wind, the updraft as the vertical flow, under the debris sim's ceiling
     (no lift 30 m over the ground) and its speed caps. Nothing here sets a
     piece's position. */
  const _sm = { speed: 0, gust: 0, inflow: 0, lift: 0, vx: 0, vz: 0, r: 0, ef: -1, pressure: 0 };
  // scratch for the instanced scar marks and hail
  const _m4 = new THREE.Matrix4(), _p3 = new THREE.Vector3(), _q4 = new THREE.Quaternion(), _s3 = new THREE.Vector3();
  function windMedium(x, y, z, out) {
    if (!live.length) return false;
    let vx = 0, vy = 0, vz = 0, any = false, gy = 0;
    for (let i = 0; i < live.length; i++) {
      const t = live[i];
      const dx = x - t.x, dz = z - t.z;
      if (dx * dx + dz * dz > t.outer * t.outer || t.k <= 0) continue;
      const g = t.gfn(x, z);
      gy = g;
      fieldInto(t, x, z, _sm, y - g);
      vx += _sm.vx; vz += _sm.vz; vy += _sm.lift; any = true;
    }
    if (!any) return false;
    out.vx = vx; out.vy = vy; out.vz = vz; out.rho = AIR_RHO; out.ceil = gy + 30;
    return true;
  }
  function mediumOn(on) {
    const D = CBZ.debris;
    if (D && D.medium) { try { D.medium("tornado", on ? windMedium : null); } catch (e) {} }
  }

  /* ============================================================
     BIG FLYERS — CARS and torn-off tree crowns (never a piece of a
     building: roofs and walls are bodies in systems/debris.js now, see
     throwPart). A car is a vehicle record other systems read (car.pos, its
     collider, the island's flung flag), so it keeps this integrator, under
     the debris sim's limits: speed <= LIMITS.V_MAX, climb <= V_UP, no lift
     30 m over the ground, collision with every collider, and it lands on
     what is under it (a roof, a deck), never through it to the terrain.
     The body is its CENTRE + orientation; the object's origin is placed
     from it each frame (cOff).
     ============================================================ */
  const flyers = [];
  const _box = new THREE.Box3(), _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _qa = new THREE.Quaternion(), _up = new THREE.Vector3(0, 1, 0);
  // an object's own-frame bounds (scale included): centre + half extents
  function localBox(o) {
    const q0 = o.quaternion.clone(), p0 = o.position.clone(), par = o.parent;
    o.quaternion.identity(); o.position.set(0, 0, 0);
    if (par) par.remove(o);
    o.updateMatrixWorld(true);
    _box.setFromObject(o);
    if (par) par.add(o);
    o.quaternion.copy(q0); o.position.copy(p0);
    o.updateMatrixWorld(true);
    if (_box.isEmpty()) return { c: new THREE.Vector3(), h: new THREE.Vector3(0.5, 0.5, 0.5) };
    const c = new THREE.Vector3(), s = new THREE.Vector3();
    _box.getCenter(c); _box.getSize(s);
    return { c: c, h: s.multiplyScalar(0.5) };
  }
  /* launch(obj, o): o = {kind, mass, area, top (planform m^2), cd, cl, gfn,
     vx, vy, vz, spin, onImpact(f, speed), onRest(f), car}. The object must
     already be in the arena root (liberate) or be a root-level group. */
  function launch(obj, o) {
    if (!obj || obj.userData._twFly) return null;
    const lb = localBox(obj);
    obj.updateMatrixWorld(true);
    const c = lb.c.clone().applyQuaternion(obj.quaternion).add(obj.position);
    const f = {
      obj: obj, kind: o.kind || "part", cOff: lb.c, half: lb.h,
      x: c.x, y: c.y, z: c.z,
      vx: o.vx || 0, vy: o.vy || 0, vz: o.vz || 0,
      q: obj.quaternion.clone(),
      ax: new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.3, Math.random() - 0.5).normalize(), w: o.spin || 0,
      mass: o.mass || 500, area: o.area || 4, top: o.top || o.area || 4, cd: o.cd || 1.1, cl: o.cl || 0.3,
      gfn: o.gfn || floorAt, grounded: o.grounded !== false, rest: false, age: 0, restT: 0,
      onImpact: o.onImpact || null, onRest: o.onRest || null, car: o.car || null,
      x0: c.x, z0: c.z, gy0: (o.gfn || floorAt)(c.x, c.z), maxH: 0, tipped: false, aired: false, hits: 0,
    };
    obj.userData._twFly = f;
    flyers.push(f);
    stats.flyersLaunched++;
    return f;
  }
  function placeFlyer(f) {
    _v.copy(f.cOff).applyQuaternion(f.q);
    f.obj.position.set(f.x - _v.x, f.y - _v.y, f.z - _v.z);
    f.obj.quaternion.copy(f.q);
    if (f.car && f.car.pos) { f.car.pos.x = f.obj.position.x; f.car.pos.z = f.obj.position.z; }
  }
  // the half-height of the body along world up, for its current orientation
  function upHalf(f) {
    _v.set(1, 0, 0).applyQuaternion(f.q); const a = Math.abs(_v.y) * f.half.x;
    _v.set(0, 1, 0).applyQuaternion(f.q); const b = Math.abs(_v.y) * f.half.y;
    _v.set(0, 0, 1).applyQuaternion(f.q); const c = Math.abs(_v.y) * f.half.z;
    return a + b + c;
  }
  // what holds a flyer up at (x, z): the terrain, or a roof / deck / floor
  // (CBZ.groundAt reads the platforms) reached from `fromY` (its bottom)
  function supportY(f, x, z, fromY) {
    let g = f.gfn(x, z);
    if (CBZ.groundAt) {
      let p = null;
      try { p = +CBZ.groundAt(x, z, fromY); } catch (e) { p = null; }
      if (Number.isFinite(p) && p > g && p <= fromY + 0.5) g = p;
    }
    return g;
  }
  function LIM() { return (CBZ.debris && CBZ.debris.LIMITS) || { V_MAX: 40, V_UP: 16, CEIL: 30 }; }
  // come to rest on the face nearest down: wheels, a side, or its roof
  function settle(f) {
    let best = null, bd = -2;
    const axes = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    for (const a of axes) {
      _v.set(a[0], a[1], a[2]).applyQuaternion(f.q);
      if (_v.y > bd) { bd = _v.y; best = a; }
    }
    _v.set(best[0], best[1], best[2]).applyQuaternion(f.q);
    _qa.setFromUnitVectors(_v, _up);
    const bottom = f.y - upHalf(f);
    f.q.premultiply(_qa);
    f.y = supportY(f, f.x, f.z, bottom + 0.3) + upHalf(f);
  }
  const _hit = { t: 0, x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, c: null };
  const SWEEP_OPTS = { skip: function (c) { return !!c.debris || !!c._twOwn; } };
  function stepFlyer(f, dt) {
    f.age += dt;
    const L = LIM();
    fieldAt(f.x, f.z, _s, f.y);
    const rx = _s.vx - f.vx, ry = _s.lift - f.vy, rz = _s.vz - f.vz;
    const relH2 = rx * rx + rz * rz, rel = Math.sqrt(relH2 + ry * ry);
    // drag toward the wind: tumbling bodies average their faces
    const Aeff = f.grounded ? f.area : (f.area + f.top) * 0.5;
    const beta = 0.5 * AIR_RHO * f.cd * Aeff / f.mass;
    const k = 1 - Math.exp(-beta * rel * dt);
    let ay = 0;
    f.vx += rx * k; f.vz += rz * k;
    const hh = upHalf(f);
    const gy = supportY(f, f.x, f.z, f.y - hh + 0.3);
    // the updraft on the planform + aerodynamic lift of the horizontal flow,
    // and none of it over the ceiling: a car is thrown, it is not posted up
    let upA = 0.5 * AIR_RHO * (1.2 * f.top * Math.max(0, ry) * Math.abs(ry) + f.cl * f.top * relH2) / f.mass;
    if (f.y - hh - gy > (L.CEIL || 30)) upA = 0;
    upA = Math.min(upA, 3 * G);
    ay += upA - G;
    // what it stood on went (a roof lifted, a deck dropped): it falls
    if (f.grounded && f.y - hh - gy > 0.3) f.grounded = false;
    if (f.grounded) {
      // on the ground: weight, minus lift, presses it into friction
      const N = Math.max(0, G - upA);
      if (upA > G * 1.02) { f.grounded = false; f.vy = Math.max(f.vy, 1.5); if (!f.aired) { f.aired = true; } }
      else {
        f.vy = 0; f.y = gy + hh;
        const sp = Math.hypot(f.vx, f.vz);
        const dec = 0.7 * N * dt;
        if (sp <= dec) { f.vx = 0; f.vz = 0; } else { f.vx -= f.vx / sp * dec; f.vz -= f.vz / sp * dec; }
        /* OVERTURNING: drag x CG height beats (weight - lift) x half track,
           or the car is TRIPPED: sliding sideways faster than ~4 m/s, the
           tyres dig into a kerb or soft ground and roll it (how most cars in
           a tornado actually go over) */
        if (f.kind === "car" && !f.tipped) {
          const Fd = 0.5 * AIR_RHO * f.cd * f.area * relH2;
          const tripped = sp > 3.5 && relH2 > 400;
          if (tripped || Fd * 0.65 > Math.max(0, f.mass * G - upA * f.mass) * 0.8) {
            f.tipped = true; f.grounded = false;
            f.vy = 2 + Math.random() * 1.5;
            _v2.set(rx, 0, rz).normalize();
            f.ax.crossVectors(_up, _v2).normalize();
            f.w = 2.5 + Math.random() * 2;
            if (f.car && !f.car._twRolled) { f.car._twRolled = true; stats.carsRolled++; }
            if (f.onImpact) f.onImpact(f, 0, "tip");
          }
        }
      }
    }
    if (!f.grounded) {
      f.vy += ay * dt;
      // tumbling: the spin follows the relative wind
      const wTarget = Math.min(7, 0.5 + rel * 0.09);
      f.w += (wTarget - f.w) * Math.min(1, dt * 1.5);
    } else if (f.kind !== "car") f.w *= Math.max(0, 1 - dt * 4);
    else f.w *= Math.max(0, 1 - dt * 6);
    // THE LIMITS (systems/debris.js LIMITS): one set for every loose body
    {
      const s2 = f.vx * f.vx + f.vy * f.vy + f.vz * f.vz, vm = L.V_MAX || 40, vu = L.V_UP || 16;
      if (s2 > vm * vm) { const kk = vm / Math.sqrt(s2); f.vx *= kk; f.vy *= kk; f.vz *= kk; }
      if (f.vy > vu) f.vy = vu;
    }
    const px = f.x, py = f.y, pz = f.z;
    f.x += f.vx * dt; f.y += f.vy * dt; f.z += f.vz * dt;
    if (f.w > 0.01) { _qa.setFromAxisAngle(f.ax, f.w * dt); f.q.premultiply(_qa); }
    // the world's colliders, for every flyer in the air (a car into a wall is a hit)
    const LC = CBZ.looseContact;
    if (LC && LC.sweep && !f.grounded) {
      const pad = Math.min(1.2, Math.max(0.4, Math.min(f.half.x, f.half.z)));
      if (LC.sweep(px, py, pz, f.x, f.y, f.z, pad, _hit, SWEEP_OPTS)) {
        f.x = _hit.x; f.y = _hit.y; f.z = _hit.z;
        const vn = f.vx * _hit.nx + f.vy * _hit.ny + f.vz * _hit.nz;
        const sp = Math.hypot(f.vx, f.vy, f.vz);
        if (vn < 0) { f.vx -= 1.4 * vn * _hit.nx; f.vy -= 1.4 * vn * _hit.ny; f.vz -= 1.4 * vn * _hit.nz; }
        f.vx *= 0.5; f.vz *= 0.5;
        if (f.onImpact && sp > 8) f.onImpact(f, sp, "wall");
        f.hits++;
      }
    }
    const hh2 = upHalf(f);
    // support read from where its bottom WAS this step, so a fast fall onto
    // a roof meets the roof instead of passing it to the floor below
    const gy2 = supportY(f, f.x, f.z, Math.max(py, f.y) - hh2 + 0.3);
    const hNow = f.y - hh2 - f.gfn(f.x, f.z);
    if (hNow > f.maxH) {
      f.maxH = hNow;
      const c = f.car;
      if (c) {
        c._twMaxH = hNow;
        if (hNow > stats.maxCarHeight) stats.maxCarHeight = hNow;
        if (hNow > 1.5 && !c._twThrown) { c._twThrown = true; stats.carsThrown++; }
      }
    }
    if (!f.grounded && f.y - hh2 <= gy2) {
      const sp = Math.hypot(f.vx, f.vy, f.vz);
      f.y = gy2 + hh2;
      if (f.vy < -3.5) {
        // a landing: bounce, lose most of it, keep tumbling a little
        if (f.onImpact) f.onImpact(f, sp, "ground");
        f.hits++;
        f.vy = -f.vy * 0.28; f.vx *= 0.6; f.vz *= 0.6; f.w *= 0.6;
      } else {
        f.vy = 0; f.grounded = true;
      }
      f.tipped = false;                 // down again: the wind can roll it again
    }
    // rest: on the ground, slow, and the wind no longer moving it. (The age
    // cap only ever settles a body that is ON something: it used to fire
    // mid-air and teleport the body down to the terrain under it.)
    const sp2 = Math.hypot(f.vx, f.vz);
    if (f.grounded && sp2 < 0.25) { f.restT += dt; } else f.restT = 0;
    if (f.restT > 0.4 || (f.age > 40 && f.grounded)) {
      settle(f);
      f.rest = true; f.vx = f.vy = f.vz = 0; f.w = 0;
      const thrown = Math.hypot(f.x - f.x0, f.z - f.z0);
      if (thrown > stats.maxThrow) stats.maxThrow = thrown;
      if (f.onRest) f.onRest(f);
    }
    placeFlyer(f);
  }
  /* A RESTED FLYER IS HELD BY SOMETHING. A car left on a roof whose building
     then goes (the next disaster, or this tornado's own later damage) falls
     again: the parked list is re-read at 2 Hz. */
  const parked = [];
  let parkT = 0;
  function watchParked(dt) {
    parkT += dt;
    if (parkT < 0.5 || !parked.length) return;
    parkT = 0;
    for (let i = parked.length - 1; i >= 0; i--) {
      const f = parked[i];
      if (!f.obj || !f.obj.parent || f.obj.userData._twFly) { parked.splice(i, 1); continue; }
      const hh = upHalf(f), sup = supportY(f, f.x, f.z, f.y - hh + 0.3);
      if (f.y - hh - sup <= 0.4) continue;
      parked.splice(i, 1);
      if (f.car && f.car._twCol) { dropCollider(f.car._twCol); f.car._twCol = null; }
      if (f.car) f.car._twLift = true;
      f.rest = false; f.grounded = false; f.restT = 0; f.age = 0; f.vy = 0;
      f.obj.userData._twFly = f;
      flyers.push(f);
    }
  }
  function stepFlyers(dt) {
    for (let i = flyers.length - 1; i >= 0; i--) {
      const f = flyers[i];
      if (!f.obj || f.dead) { flyers.splice(i, 1); continue; }
      stepFlyer(f, dt);
      if (f.rest) { f.obj.userData._twFly = null; flyers.splice(i, 1); parked.push(f); }
    }
    watchParked(dt);
  }

  /* ============================================================
     THE STRUCTURAL ADAPTER — the ONE place whole-building failure leaves
     this file. CBZ.collapse.damage(building, point, radius, energy, dir) is
     the shared collapse system's entry when it exists; until then the
     current ledger: the island bridge's hitBuilding (systems/disasters.js's
     ledger -> city/collapse.js) or city/structural.js for a city lot.
     `energy` is the wind's work on the face in joules: 0.5 rho v^3 x area x s.
     CBZ.collapse.damage takes MEGAJOULES (an RPG ~3, a car bomb ~25). The
     joules used to go straight in: a 3 MJ gust arrived as 3,000,000 MJ and
     blew every chunk in the radius out at the blast cap, which is how a
     tornado threw whole storeys into the sky. Converted here, once.
     ============================================================ */
  function structDamage(t, b, x, y, z, radius, energy, dirx, dirz, ledgerAmount) {
    const C = CBZ.collapse;
    stats.buildingHits++;
    if (C && typeof C.damage === "function") {
      try { return C.damage(b, { x: x, y: y, z: z }, radius, energy / 1e6, { x: dirx, y: 0, z: dirz }); } catch (e) {}
    }
    const W = t && t.world;
    if (W && W.hitBuilding) {
      let st = 0;
      try { st = W.hitBuilding(b, ledgerAmount, dirx, dirz); } catch (e) {}
      if (b.fallen && !b._twFell) { b._twFell = true; stats.buildingCollapses++; }
      return st;
    }
    return 0;
  }

  /* ============================================================
     BUILDING PARTS — published (b.parts) or read off the geometry.
     ============================================================ */
  function matHex(o) {
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    return m && m.color ? m.color.getHex() : 0x8b9097;
  }
  const _bb = new THREE.Box3();
  function deriveParts(b) {
    const out = { roof: [], walls: [], other: [], slab: null, roofHex: 0x5a4a40, wallHex: 0x9a8f80, top: 0, rb: null };
    const gy = b.gy || 0;
    const top = gy + (b.h || 3);
    out.top = top;
    const P = b.parts;
    if (P) {
      out.roof = (P.roof || []).slice(); out.walls = (P.walls || []).slice(); out.other = (P.other || []).slice(); out.slab = P.slab || null;
    } else if (b.group) {
      b.group.updateWorldMatrix(true, true);
      b.group.traverse(function (o) {
        if (!o.isMesh || !o.visible || !o.geometry) return;
        // the island's merged shell is the WHOLE building (it fails through
        // the collapse system), and its rooms are inside it: neither is a part
        if (o.name === "island-shell" || (o.userData && o.userData.cbzInterior) || (o.name && o.name.indexOf("island-interior") === 0)) return;
        const m = Array.isArray(o.material) ? o.material[0] : o.material;
        if (m && m.transparent && m.opacity < 0.6) return;     // glass: the shatter path owns it
        _bb.setFromObject(o);
        if (_bb.isEmpty()) return;
        const h = _bb.max.y - _bb.min.y, w = _bb.max.x - _bb.min.x, d = _bb.max.z - _bb.min.z;
        if (_bb.min.y >= top - 1.2 && _bb.max.y <= top + 8) out.roof.push(o);
        else if (h >= (b.h || 3) * 0.55 && Math.min(w, d) < 1.0 && Math.max(w, d) > 2) out.walls.push(o);
        else if (_bb.max.y <= gy + 0.8 && w > b.w * 0.6 && d > b.d * 0.6 && !out.slab) out.slab = o;
        else out.other.push(o);
      });
    }
    if (out.roof.length) out.roofHex = matHex(out.roof[0]);
    if (out.walls.length) out.wallHex = matHex(out.walls[0]);
    else if (b.color != null) out.wallHex = b.color;
    // the roof's world extent (where shingles come off)
    if (out.roof.length) {
      out.rb = new THREE.Box3();
      for (const o of out.roof) { _bb.setFromObject(o); out.rb.union(_bb); }
    }
    return out;
  }
  function bState(b) {
    if (b._tw) return b._tw;
    const res = (b.storeys || 1) >= 4 || (b.h || 0) > 14 ? RES_ENGINEERED : ((b.storeys || 1) >= 2 ? RES_MASONRY : 1);
    /* An engineered tower is NOT walked mesh by mesh: its furnished floors
       are thousands of meshes (the walk measured 20+ ms in one frame on the
       island) and what the wind does to it, past the roof plant, is a
       structural load for the collapse system. Its roof sheds as debris in
       its own colour; a published b.parts is still honoured. */
    const parts = res === RES_ENGINEERED && !b.parts
      ? { roof: [], walls: [], other: [], slab: null, roofHex: b.color != null ? b.color : 0x8b9097, wallHex: b.color != null ? b.color : 0x8b9097, top: (b.gy || 0) + (b.h || 30), rb: null }
      : deriveParts(b);
    const st = { dod: 0, lp: 0, peak: 0, parts: parts, shed: 0 };
    st.res = res;
    st.engineered = st.res === RES_ENGINEERED;
    // SEPARABLE = real wall panels that actually enclose the plan; a trim
    // strip or two does not make a merged shell into four walls
    let run = 0;
    for (const o of st.parts.walls) { _bb.setFromObject(o); run += Math.max(_bb.max.x - _bb.min.x, _bb.max.z - _bb.min.z); }
    // A WOOD-FRAME HOME comes apart panel by panel; a masonry walk-up or an
    // engineered tower fails as a STRUCTURE, which is the collapse system's
    // business (structDamage), never a wall panel tipping over
    st.separable = st.res === 1 && st.parts.walls.length >= 3 && run >= 1.4 * ((b.w || 8) + (b.d || 8));
    b._tw = st;
    touched.add(b);
    return st;
  }
  function roofPoint(st, b, out) {
    const rb = st.parts.rb;
    if (rb) { out.set(rb.min.x + Math.random() * (rb.max.x - rb.min.x), rb.max.y - Math.random() * 0.6, rb.min.z + Math.random() * (rb.max.z - rb.min.z)); }
    else out.set(bxOf(b) + (Math.random() - 0.5) * b.w, (b.gy || 0) + (b.h || 3) + 0.2, bzOf(b) + (Math.random() - 0.5) * b.d);
    return out;
  }
  function areaOf(o) {
    _bb.setFromObject(o);
    const w = _bb.max.x - _bb.min.x, h = _bb.max.y - _bb.min.y, d = _bb.max.z - _bb.min.z;
    return { w: w, h: h, d: d, plan: Math.max(0.5, w * d), face: Math.max(0.5, Math.max(w, d) * h) };
  }
  // what a part is made of, for the debris sim (density, how it breaks)
  function kindOfPart(o) {
    const D = CBZ.debris;
    if (D && D.kindOf) { try { return D.kindOf(Array.isArray(o.material) ? o.material[0] : o.material, o) || "wood"; } catch (e) {} }
    return "wood";
  }
  /* THROW A BUILDING PART. It used to become a private "flyer": lift on its
     whole planform at the relative wind squared with no ceiling (a roof sheet
     climbed as long as the wind outran it), terrain-only landings, no wall
     collisions for a wall panel, a forced teleport to the ground at 40 s.
     Now the part is handed to systems/debris.js whole (CBZ.debris.adopt,
     "all" = every mesh of it one rigid body) with its real kilos and area,
     and the "tornado" medium carries it: one physics with every other piece.
     The original is hidden by the adopt (and folded out of a merged shell);
     the journal shows it again on restoreWorld. */
  function throwPart(t, o, kind, dirx, dirz, uplift, angular) {
    const D = CBZ.debris;
    if (!D || !D.adopt || !o || o.userData._twThrown) return null;
    jObj(o);
    const A = areaOf(o);
    const plan = kind === "roof" ? A.plan : A.face;
    const mass = kind === "roof" ? A.plan * 28 : A.face * 45;
    let out = null;
    try {
      out = D.adopt(o, { whole: "all", owner: "tornado", kind: kindOfPart(o), mass: mass, area: plan * 0.85, cd: 1.2, maxLife: 60,
        velocity: { x: dirx * 6, y: Math.min(10, uplift || 4), z: dirz * 6 },
        angular: angular || { x: (Math.random() - 0.5) * 2, y: (Math.random() - 0.5) * 1.5, z: (Math.random() - 0.5) * 2 } });
    } catch (e) { out = null; }
    if (!out || !out.pieces) return null;
    o.userData._twThrown = true;
    stats.flyersLaunched++;
    if (kind === "roof") stats.roofParts++;
    return out.live && out.live[0] || null;
  }
  // a handful of debris pieces in a part's colour (kind 1 boards / 3 chunks / 0 shingles)
  function burst(x, y, z, hex, n, kind, gfn, vx, vz) {
    for (let i = 0; i < n; i++) {
      spawnDebris(kind, x + (Math.random() - 0.5) * 2, y + Math.random(), z + (Math.random() - 0.5) * 2,
        (vx || 0) * 0.5 + (Math.random() - 0.5) * 6, 2 + Math.random() * 4, (vz || 0) * 0.5 + (Math.random() - 0.5) * 6, hex, 0.7 + Math.random() * 0.6, gfn);
    }
  }
  /* FELL A WALL PANEL. This was a kinematic hinge: the panel was rotated
     about its base edge by a scripted angle to 88 degrees and left there
     whatever was (or was not) under it. Now it is a rigid body in the debris
     sim, started rotating about its downwind base edge with a shove from the
     wind; its own hull contacts tip it over that edge and lay it on whatever
     it lands on — the ground, rubble, another wall. */
  function fellWall(t, b, o, wx, wz) {
    if (!o || o.userData._twThrown) return;
    _bb.setFromObject(o);
    const w = _bb.max.x - _bb.min.x, d = _bb.max.z - _bb.min.z;
    let fx = 0, fz = 0;
    if (w < d) fx = wx >= 0 ? 1 : -1;
    else fz = wz >= 0 ? 1 : -1;
    // the panel's colliders go with it (a fallen wall is not a wall)
    if (b.colliders) for (const c of b.colliders.slice()) {
      if (c.maxX >= _bb.min.x - 0.3 && c.minX <= _bb.max.x + 0.3 && c.maxZ >= _bb.min.z - 0.3 && c.minZ <= _bb.max.z + 0.3) dropCollider(c);
    }
    const axis = new THREE.Vector3(fx, 0, fz).cross(_up).negate().normalize();   // up x fall
    const wr = 1.2;
    const f = throwPart(t, o, "wall", fx * 0.25, fz * 0.25, 0.3, { x: axis.x * wr, y: 0, z: axis.z * wr });
    if (!f) return;
    burst((_bb.min.x + _bb.max.x) / 2, _bb.min.y + 0.3, (_bb.min.z + _bb.max.z) / 2, matHex(o), 2, 3, t.gfn);
    if (CBZ.shake && camDist(_bb.min.x, _bb.min.z) < 40) CBZ.shake(0.12);
    stats.wallsDown++;
  }
  /* TREES ONLY: an uprooted tree pivots about its root plate and a snapped
     trunk leans about its break. A tree is not a piece of a building and its
     trunk is still rooted at the pivot, so this stays a hinge (it never
     carries a building part: fellWall above is a body now). */
  /* AN UPROOTED TREE FALLS UNTIL IT MEETS THE GROUND (2026-10-19). The
     fall was a fixed 78 degrees from vertical, whatever the ground did: on a
     slope falling downhill the tree stopped short with its whole length
     hanging over the hillside, and its crown (a hinge of its own) had no idea
     where the trunk had stopped. Now the trunk's own reach (`reach`, metres
     from the root plate) is tested against the ground as it goes: it stops
     on the slope uphill, lies past horizontal downhill, and the crown rides
     the trunk's angle (`lead`). */
  const hinges = [];
  const _hv = new THREE.Vector3();
  function stepHinges(dt) {
    for (let i = hinges.length - 1; i >= 0; i--) {
      const H = hinges[i];
      if (H.lead) {
        // the crown: wherever its trunk is (the trunk is stepped after it,
        // so this is the trunk's angle as of its last step, final included)
        H.a = H.lead.a;
        _qa.setFromAxisAngle(H.axis, H.a);
        H.o.quaternion.copy(_qa).multiply(H.q0);
        _v.copy(H.p0).sub(H.base).applyQuaternion(_qa).add(H.base);
        H.o.position.copy(_v);
        if (H.lead.done) { H.done = true; hinges.splice(i, 1); }
        continue;
      }
      if (H.a >= H.max) { H.done = true; hinges.splice(i, 1); continue; }
      H.w += (3.5 * Math.sin(H.a + 0.15) + 0.6) * dt;   // gravity's moment grows as it leans
      H.a = Math.min(H.max, H.a + H.w * dt);
      if (H.reach > 0 && H.a > 0.35) {
        // the trunk's reach point, this angle: on (or in) the ground = down
        _hv.set(0, H.reach, 0).applyAxisAngle(H.axis, H.a).add(H.base);
        const gfn = H.t ? H.t.gfn : floorAt;
        if (_hv.y <= gfn(_hv.x, _hv.z) + 0.3) H.max = H.a;
      }
      _qa.setFromAxisAngle(H.axis, H.a);
      H.o.quaternion.copy(_qa).multiply(H.q0);
      _v.copy(H.p0).sub(H.base).applyQuaternion(_qa).add(H.base);
      H.o.position.copy(_v);
      if (H.a >= H.max) {
        burst(H.base.x, H.base.y + 0.3, H.base.z, matHex(H.o), 3, 3, H.t ? H.t.gfn : floorAt);
        if (CBZ.shake && camDist(H.base.x, H.base.z) < 40) CBZ.shake(0.12);
      }
    }
  }

  /* ============================================================
     WIND DAMAGE — buildings, trees, cars (off the city; the city's lots go
     through city/structural.js further down).
     ============================================================ */
  const WD_TICK = 0.1;
  let shedBudget = 0;
  const _pt = new THREE.Vector3();
  function windDamage(t, dt) {
    const W = t.world;
    if (!W) return;
    t.tWd += dt;
    if (t.tWd < WD_TICK) return;
    const step = t.tWd; t.tWd = 0;
    const lp = 1 - Math.exp(-step / 0.25);           // the "3-second gust", fast
    // per-tick budgets: reading a building's parts walks its meshes once, and
    // a street of roofs shedding at once is a storm of spawns; both are
    // spread over ticks instead of landing in one frame
    let newStates = 2;
    shedBudget = qi(3, 10);
    let list = null;
    try { list = W.fragile ? W.fragile() : null; } catch (e) {}
    if (list) for (let i = 0; i < list.length; i++) {
      const b = list[i];
      if (!b || b.fallen || b._twSwept) continue;
      const bx = bxOf(b), bz = bzOf(b), hw = (b.w || 8) * 0.5, hd = (b.d || 8) * 0.5;
      if (Math.abs(bx - t.x) > t.outer + hw || Math.abs(bz - t.z) > t.outer + hd) continue;
      // the worst of the centre and the four corners
      let g = 0, wx = 0, wz = 0, wl = 0;
      for (let s = 0; s < 5; s++) {
        const sx = s === 0 ? bx : bx + (s & 1 ? hw : -hw), sz = s === 0 ? bz : bz + (s & 2 ? hd : -hd);
        fieldInto(t, sx, sz, _s, (b.gy || 0) + Math.min(8, (b.h || 3) * 0.6));
        if (_s.gust > g) { g = _s.gust; wx = _s.vx; wz = _s.vz; wl = _s.lift; }
      }
      const st = b._tw || (g > DOD.cover * 0.85 && newStates-- > 0 ? bState(b) : null);
      if (!st) continue;
      st.lp += (g - st.lp) * lp;
      if (st.lp > st.peak) st.peak = st.lp;
      const v = st.peak / st.res;
      const n = Math.hypot(wx, wz) || 1; wx /= n; wz /= n;
      damageBuilding(t, b, st, v, st.lp / st.res, wx, wz, wl, step);
    }
    let trees = null;
    try { trees = W.trees ? W.trees() : null; } catch (e) {}
    if (trees) for (let i = 0; i < trees.length; i++) {
      const tr = trees[i];
      if (!tr || (tr._tw && tr._tw.done)) continue;
      if (Math.abs(tr.x - t.x) > t.outer || Math.abs(tr.z - t.z) > t.outer) continue;
      fieldInto(t, tr.x, tr.z, _s, 4);
      if (_s.gust < TREE.twigs * 0.9 && !tr._tw) continue;
      damageTree(t, tr, _s.gust, _s.vx, _s.vz, step);
    }
    if (CBZ.CONFIG.TORNADO_LIFT) {
      let cars = null;
      try { cars = W.cars ? W.cars() : null; } catch (e) {}
      if (cars) for (let i = 0; i < cars.length; i++) {
        const c = cars[i];
        if (!c || (c.flung && !c._twOwned) || c._twLift || c.dead || c.player) continue;
        const p = c.pos || (c.group && c.group.position);
        if (!p || Math.abs(p.x - t.x) > t.outer || Math.abs(p.z - t.z) > t.outer) continue;
        windCar(t, c, p, false);
      }
    }
  }

  function damageBuilding(t, b, st, v, vNow, wx, wz, wl, step) {
    const P = st.parts, gfn = t.gfn;
    const bx = bxOf(b), bz = bzOf(b);
    // DOD 2: the covering goes — shingles off the roof, continuously, while
    // the gust holds over the bar (scaled by how far over it is)
    if (vNow >= DOD.cover && st.dod < 3) {
      if (st.dod < 1) { st.dod = 1; stats.roofsDamaged++; }
      const nShed = Math.min(shedBudget, Math.min(6, Math.max(1, Math.round((vNow - DOD.cover) / 5))));
      shedBudget -= nShed;
      for (let i = 0; i < nShed; i++) {
        roofPoint(st, b, _pt);
        spawnDebris(0, _pt.x, _pt.y + 0.1, _pt.z, wx * 8, 3 + Math.random() * 4 + wl * 0.2, wz * 8, P.roofHex, 0.8 + Math.random() * 0.4, gfn);
        st.shed++;
      }
    }
    // DOD 4: the decking lifts — the most windward roof part goes first
    if (v >= DOD.deck && st.dod < 2) {
      st.dod = 2;
      if (P.roof.length >= 2) {
        let bi = -1, bd = Infinity;
        for (let i = 0; i < P.roof.length; i++) {
          _bb.setFromObject(P.roof[i]);
          const cx = (_bb.min.x + _bb.max.x) * 0.5 - bx, cz = (_bb.min.z + _bb.max.z) * 0.5 - bz;
          const dd = cx * wx + cz * wz;
          if (dd < bd) { bd = dd; bi = i; }
        }
        const o = P.roof.splice(bi, 1)[0];
        throwPart(t, o, "roof", wx, wz, 6 + wl * 0.3);
        st.dod2Threw = true;
      } else {
        for (let i = 0; i < 4; i++) { roofPoint(st, b, _pt); spawnDebris(2, _pt.x, _pt.y + 0.2, _pt.z, wx * 10, 6, wz * 10, P.roofHex, 1, gfn); }
      }
    }
    // DOD 6: ROOF OFF
    if (v >= DOD.roof && st.dod < 3) {
      st.dod = 3;
      // counted, and the deck you could stand on dropped, only where a real
      // roof came off (an engineered roof slab stays; its plant sheds)
      const hadRoof = P.roof.length > 0 || st.dod2Threw;
      if (hadRoof) stats.roofsRemoved++;
      for (const o of P.roof.splice(0)) throwPart(t, o, "roof", wx, wz, 8 + wl * 0.35);
      if (hadRoof && !st.engineered && b.platforms) for (const p of b.platforms.slice()) if (p.top != null && p.top >= P.top - 0.6) dropPlatform(p);
      for (let i = 0; i < 6; i++) { roofPoint(st, b, _pt); spawnDebris(1, _pt.x, _pt.y, _pt.z, wx * 12, 7, wz * 12, 0x8f6e4a, 1, gfn); }
      if (CBZ.shatterGlass) { try { CBZ.shatterGlass(bx, bz, Math.max(b.w, b.d) * 0.7); } catch (e) {} }
      if (T.onDamage) fireHook(T.onDamage, { id: t.id, x: bx, z: bz, stage: "roof", lot: null, amount: 0 });
    }
    // DOD 7: exterior walls collapse
    if (v >= DOD.walls && st.dod < 4) {
      st.dod = 4;
      if (st.separable) {
        // the two walls FACING the wind (windward caves in, leeward blows out)
        P.walls.sort(function (a, c) { return wallFacing(c, wx, wz) - wallFacing(a, wx, wz); });
        for (const o of P.walls.splice(0, 2)) fellWall(t, b, o, wx, wz);
      } else {
        // one merged shell: the structure goes through the ledger/collapse
        const E = 0.5 * AIR_RHO * Math.pow(v, 3) * (b.w || 8) * (b.h || 3);
        structDamage(t, b, bx, (b.gy || 0) + (b.h || 3) * 0.5, bz, Math.max(b.w || 8, b.d || 8), E, wx, wz, st.engineered ? 0.5 : 0.75);
        stats.buildingsFailed++;
      }
    }
    // DOD 9: most walls down
    if (v >= DOD.most && st.dod < 5) {
      st.dod = 5;
      if (st.separable) {
        for (const o of P.walls.splice(0)) fellWall(t, b, o, wx, wz);
        for (const o of P.other) { jObj(o); o.visible = false; _bb.setFromObject(o); burst((_bb.min.x + _bb.max.x) / 2, (_bb.min.y + _bb.max.y) / 2, (_bb.min.z + _bb.max.z) / 2, matHex(o), 2, 1, gfn, wx * 10, wz * 10); }
        // nothing left to stand in: the building's colliders go
        if (b.colliders) for (const c of b.colliders.slice()) dropCollider(c);
        if (b.platforms) for (const p of b.platforms.slice()) if (p.top != null && p.top > (b.gy || 0) + 0.6) dropPlatform(p);
      } else {
        const E = 0.5 * AIR_RHO * Math.pow(v, 3) * (b.w || 8) * (b.h || 3) * 2;
        structDamage(t, b, bx, (b.gy || 0) + (b.h || 3) * 0.5, bz, Math.max(b.w || 8, b.d || 8), E, wx, wz, st.engineered ? 0.7 : 1.2);
      }
    }
    // DOD 10: SWEPT CLEAN — everything above the slab lofted and carried off
    if (v >= DOD.swept && st.dod < 6 && st.separable) {
      st.dod = 6;
      b._twSwept = true;
      // the felled walls are bodies in the wind already: the gust that
      // sweeps the slab picks them up off the ground (a shove through the
      // debris sim, capped like every other), and any wall still standing goes
      for (const o of P.walls.splice(0)) fellWall(t, b, o, wx, wz);
      if (CBZ.debris && CBZ.debris.impulse) { try { CBZ.debris.impulse(bx, (b.gy || 0) + 1, bz, Math.max(b.w || 8, b.d || 8) * 0.8 + 2, 6); } catch (e) {} }
      b.fallen = true;
      stats.housesSwept++;
    }
    // ENGINEERED: past its roof, the structure is ground by the ledger while
    // the gust holds over the wall bar (a sustained load, never a strike)
    if (st.engineered && vNow >= DOD.walls) {
      const amt = 0.85 * Math.pow(vNow * st.res / 33, 3) * step * 0.016;
      const E = 0.5 * AIR_RHO * Math.pow(vNow * st.res, 3) * (b.w || 10) * Math.min(30, b.h || 10) * step;
      structDamage(t, b, bx, (b.gy || 0) + Math.min(b.h || 10, 30) * 0.8, bz, Math.max(b.w || 10, b.d || 10), E, wx, wz, amt);
    }
  }
  function wallFacing(o, wx, wz) {
    _bb.setFromObject(o);
    const w = _bb.max.x - _bb.min.x, d = _bb.max.z - _bb.min.z;
    return w < d ? Math.abs(wx) : Math.abs(wz);
  }

  // trees: twigs and leaves, limbs, then down (snapped or uprooted), debarked
  function damageTree(t, tr, g, wx, wz, step) {
    const s = tr._tw || (tr._tw = { stage: 0 });
    touched.add(tr);
    const n = Math.hypot(wx, wz) || 1; wx /= n; wz /= n;
    const gfn = t.gfn, gy = gfn(tr.x, tr.z);
    const leaf = tr.leafHex != null ? tr.leafHex : (tr.foliage ? matHex(tr.foliage) : 0x3f7a3f);
    const top = tr.foliage ? (function () { _bb.setFromObject(tr.foliage); return _bb.max.y; })() : gy + 6;
    if (g >= TREE.twigs && s.stage < 3) {
      const nL = Math.min(shedBudget, Math.min(4, Math.max(1, Math.round((g - TREE.twigs) / 8))));
      shedBudget -= nL;
      for (let i = 0; i < nL; i++) spawnDebris(0, tr.x + (Math.random() - 0.5) * 3, top - Math.random() * 2.5, tr.z + (Math.random() - 0.5) * 3,
        wx * 6, 2 + Math.random() * 3, wz * 6, leaf, 0.45 + Math.random() * 0.3, gfn, 2.5);
      if (s.stage < 1) s.stage = 1;
    }
    if (g >= TREE.limbs && s.stage < 2) {
      s.stage = 2;
      for (let i = 0; i < 2; i++) spawnDebris(1, tr.x, top - 1.5, tr.z, wx * 8, 4, wz * 8, tr.barkHex != null ? tr.barkHex : 0x4d3a28, 0.6, gfn);
    }
    const palm = !!tr.palm;
    if (g >= TREE.down * (palm ? 1.15 : 1) && s.stage < 3) {
      s.stage = 3;
      stats.treesDown++;
      const uproot = h01(tr.x, tr.z, 0x7e3) < 0.45;
      const base = new THREE.Vector3(tr.x, gy, tr.z);
      const axis = new THREE.Vector3(wx, 0, wz).cross(_up).negate().normalize();
      if (uproot) {
        // how far up the trunk reaches (its top, less the crown's spread)
        let reach = 0;
        if (tr.trunk) { _bb.setFromObject(tr.trunk); if (!_bb.isEmpty()) reach = Math.max(0, (_bb.max.y - gy) * 0.85); }
        let lead = null;
        for (const o of [tr.trunk, tr.foliage]) if (o) {
          liberate(o);
          const H = { o: o, base: base, axis: axis, a: 0, w: 0.4, max: reach > 0 ? Math.PI / 2 + 0.45 : Math.PI / 2 - 0.12, q0: o.quaternion.clone(), p0: o.position.clone(), b: null, t: t,
            reach: lead ? 0 : reach, lead: lead, done: false };
          hinges.push(H);
          if (!lead && o === tr.trunk) lead = H;
        }
        burst(tr.x, gy + 0.3, tr.z, 0x4a3828, 3, 3, gfn);                      // the root ball tears the ground
      } else {
        // SNAPPED: the crown is torn off and flies; the trunk is left leaning
        if (tr.foliage) {
          liberate(tr.foliage);
          launch(tr.foliage, { kind: "crown", mass: 120, area: 10, top: 10, cd: 0.8, cl: 0.2, gfn: gfn, grounded: false,
            vx: wx * 8, vy: 4, vz: wz * 8, spin: 1 });
        }
        if (tr.trunk) { liberate(tr.trunk); hinges.push({ o: tr.trunk, base: base, axis: axis, a: 0, w: 0.2, max: 0.35, q0: tr.trunk.quaternion.clone(), p0: tr.trunk.position.clone(), b: null, t: t }); }
      }
    }
    if (g >= TREE.debark && s.stage < 4) {
      s.stage = 4; s.done = true;
      stats.treesStripped++;
      if (tr.foliage && !tr.foliage.userData._twFly) { jObj(tr.foliage); tr.foliage.visible = false; }
      for (let i = 0; i < 6; i++) spawnDebris(0, tr.x, top - 2, tr.z, wx * 10, 5, wz * 10, leaf, 0.5, gfn, 2.5);
    }
  }

  /* CARS, BY FORCE. Side drag, lift over the body and the updraft under it,
     against the car's weight and the tyres' friction: slides at ~EF2
     (~50 m/s), rolls at ~EF3, flies at EF4-5. The flyer owns it after that. */
  const CAR_SIDE = 4.2, CAR_TOP = 8.0, CAR_CD = 1.1, CAR_CL = 0.4;
  // a car's mass in kg. city/vehicles.js's `mass` is a PROFILE MULTIPLIER
  // (1.0 = a 1400 kg sedan, the bus/truck rows are bigger), not kilograms:
  // read raw, a 1.05 "kg" sedan went into orbit at EF1.
  function carKg(c) {
    const m = +c.mass;
    if (!(m > 0)) return 1400;
    return m < 30 ? m * 1400 : m;
  }
  function windCar(t, c, p, city) {
    const y = (p.y || 0) + 0.8;
    fieldInto(t, p.x, p.z, _s, y);
    const g = _s.gust;
    if (g < 30) return;
    const m = carKg(c);
    const Fd = 0.5 * AIR_RHO * CAR_CD * CAR_SIDE * g * g;
    const L = 0.5 * AIR_RHO * (CAR_CL * CAR_TOP * g * g + 1.2 * CAR_TOP * Math.max(0, _s.lift) * _s.lift);
    const N = m * G - L;
    if (Fd <= 0.7 * Math.max(0, N) && L < m * G) return;            // the tyres hold
    seizeCar(t, c, city);
  }
  function seizeCar(t, c, city) {
    const grp = c.group;
    if (!grp) return;
    c._twLift = true; c._twOwned = true; c._twWreck = true;
    if (c._twCol) { dropCollider(c._twCol); c._twCol = null; }
    if (c.pos || city) { c._twAi = c.ai; c.ai = false; c.road = null; c.v = 0; c.vx = 0; c.vz = 0; }
    if (!inCity()) { jObj(grp); touched.add(c); }
    if (c.collider) dropCollider(c.collider);
    if (c.flung === false) c.flung = true;          // the island's own tickers skip it now
    const root = arenaRoot();
    if (root && grp.parent !== root) liberate(grp);
    const f = launch(grp, { kind: "car", mass: carKg(c), area: CAR_SIDE, top: CAR_TOP, cd: CAR_CD, cl: CAR_CL, gfn: t.gfn,
      grounded: true, car: c,
      onImpact: function (ff, sp, why) { carImpact(t, c, ff, sp, why); },
      onRest: function (ff) { carRest(t, c, ff); } });
    if (f && !c._twMoved) { c._twMoved = true; stats.carsMoved++; }
  }
  function carImpact(t, c, f, sp, why) {
    if (!c._twGlass && (why === "tip" || sp > 9)) {
      c._twGlass = true;
      const W = t.world;
      const n = Math.hypot(f.vx, f.vz) || 1;
      if (W && W.carGlass) { try { W.carGlass(c, f.vx / n, f.vz / n); } catch (e) {} }
    }
    if (why === "tip" || sp < 9) return;
    if (inCity()) {
      try {
        if (CBZ.detonate) CBZ.detonate(f.x, f.y, f.z, "kinetic", { mass: f.mass, speed: sp, dirx: f.vx / (Math.hypot(f.vx, f.vz) || 1), dirz: f.vz / (Math.hypot(f.vx, f.vz) || 1), by: t.by, byPlayer: false });
        if (c.npcDriver && !c.npcDriver.dead && CBZ.cityKillPed) CBZ.cityKillPed(c.npcDriver, { fromX: t.x, fromZ: t.z, force: 8, fling: 5, byPlayer: false }, "thrown by the tornado");
        if (CBZ.cityDamageCar) CBZ.cityDamageCar(c, 300 + sp * 12, {});
        if (sp > 26 && CBZ.cityCarIgnite) CBZ.cityCarIgnite(c, false);
      } catch (e) {}
    } else {
      if (f.hits < 2) burst(f.x, f.y, f.z, 0x8a8f96, 2, 3, f.gfn, f.vx, f.vz);
    }
    if (CBZ.shake) { const d = camDist(f.x, f.z); if (d < 80) CBZ.shake(Math.min(1.2, sp * 0.03) * (1 - d / 80)); }
    crushUnder(t, f, sp);
  }
  function carRest(t, c, f) {
    c._twLift = false;
    if (f.maxH > stats.maxCarHeight) stats.maxCarHeight = f.maxH;
    if (!c._twThrown && (f.maxH > 1.5 || Math.hypot(f.x - f.x0, f.z - f.z0) > 12)) { c._twThrown = true; stats.carsThrown++; }
    if (inCity()) {
      c.ai = false; c.road = null; c.abandoned = true; c.wreckT = 0; c.v = 0; c.vx = 0; c.vz = 0;
    } else {
      // a wreck where it lies is solid again
      const hx = Math.max(f.half.x, f.half.z) * 0.8, col = { minX: f.x - hx, maxX: f.x + hx, minZ: f.z - hx, maxZ: f.z + hx, _twOwn: true, noCam: true };
      addCollider(col);
      c._twCol = col;
    }
  }
  // a thrown body landing on someone
  function crushUnder(t, f, sp) {
    if (sp < 10) return;
    const P = CBZ.player, r = Math.max(f.half.x, f.half.z) + 0.5;
    if (P && !P.dead && P.pos && Math.hypot(P.pos.x - f.x, P.pos.z - f.z) < r && Math.abs((P.pos.y || 0) + 0.9 - f.y) < 2.2) {
      try {
        if (inCity() && CBZ.cityHurtPlayer) CBZ.cityHurtPlayer(Math.round(sp * 2), f.x, f.z, CAUSE, false, null, false);
        else if (CBZ.surv && CBZ.surv.hurt && CBZ.surv.player) CBZ.surv.hurt(CBZ.surv.player, sp * 2, { fromX: f.x, fromZ: f.z });
      } catch (e) {}
    }
  }

  /* ============================================================
     THE PATH — the ground scar ribbon + suction marks (module-level: the
     track outlives the vortex).
     ============================================================ */
  const SCAR_MAX = 520;
  let scar = null;
  function scarMesh() {
    if (scar) return scar;
    const root = arenaRoot();
    if (!root) return null;
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(SCAR_MAX * 2 * 3), uv = new Float32Array(SCAR_MAX * 2 * 2), col = new Float32Array(SCAR_MAX * 2 * 3);
    const pa = new THREE.BufferAttribute(pos, 3), ca = new THREE.BufferAttribute(col, 3);
    if (pa.setUsage) { pa.setUsage(THREE.DynamicDrawUsage); ca.setUsage(THREE.DynamicDrawUsage); }
    g.setAttribute("position", pa); g.setAttribute("uv", new THREE.BufferAttribute(uv, 2)); g.setAttribute("color", ca);
    g.setIndex(new THREE.BufferAttribute(new Uint16Array(SCAR_MAX * 6), 1));
    g.setDrawRange(0, 0);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    const mat = new THREE.MeshBasicMaterial({ map: cloneTex(textures().scar, 1, 1), vertexColors: true, transparent: true, opacity: 0.85,
      depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(g, mat);
    mesh.name = "tw-scar"; mesh.renderOrder = 2; mesh.frustumCulled = false;
    mesh.userData.dynamic = true;
    root.add(mesh);
    // suction marks: one instanced draw
    const markCap = qi(120, 300);
    const mg = new THREE.CircleGeometry(1, 10); mg.rotateX(-Math.PI / 2);
    const marks = new THREE.InstancedMesh(mg, new THREE.MeshBasicMaterial({ color: 0x1d160f, transparent: true, opacity: 0.55, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }), markCap);
    marks.count = 0; marks.frustumCulled = false; marks.renderOrder = 2; marks.name = "tw-suction";
    root.add(marks);
    scar = { mesh, g, pos, uv, col, n: 0, head: 0, conn: new Uint8Array(SCAR_MAX), len: new Float32Array(SCAR_MAX), marks, markCap, markN: 0, markHi: 0 };
    return scar;
  }
  // append a cross-section; `join` = connect to the previous one
  function scarSection(t, x, z, nx, nz, wl, wr, strength, join) {
    const S = scarMesh();
    if (!S) return;
    const i = S.head;
    S.head = (S.head + 1) % SCAR_MAX;
    if (S.n < SCAR_MAX) S.n++;
    const prev = (i + SCAR_MAX - 1) % SCAR_MAX;
    S.conn[i] = join ? 1 : 0;
    S.len[i] = join ? S.len[prev] + Math.hypot(x - S._lx, z - S._lz) : 0;
    S._lx = x; S._lz = z;
    const jit = 0.85 + 0.3 * h01(x, z, 0x5c1);
    const lx = x + nx * wl * jit, lz = z + nz * wl * jit, rx = x - nx * wr * jit, rz = z - nz * wr * jit;
    S.pos[i * 6] = lx; S.pos[i * 6 + 1] = t.gfn(lx, lz) + 0.06; S.pos[i * 6 + 2] = lz;
    S.pos[i * 6 + 3] = rx; S.pos[i * 6 + 4] = t.gfn(rx, rz) + 0.06; S.pos[i * 6 + 5] = rz;
    S.uv[i * 4] = 0; S.uv[i * 4 + 1] = S.len[i] / 10; S.uv[i * 4 + 2] = 1; S.uv[i * 4 + 3] = S.len[i] / 10;
    // a weak tornado's scar is a pale scuff; a violent one's is bare dark earth
    const k = Math.max(0, Math.min(1, strength));
    const cr = 0.55 - 0.35 * k, cg = 0.50 - 0.33 * k, cb = 0.40 - 0.28 * k;
    for (let s = 0; s < 2; s++) { S.col[i * 6 + s * 3] = cr; S.col[i * 6 + s * 3 + 1] = cg; S.col[i * 6 + s * 3 + 2] = cb; }
    // indices: every connected pair in ring order
    const idx = S.g.index.array;
    let m = 0;
    const start = (S.head + SCAR_MAX - S.n) % SCAR_MAX;
    for (let c = 1; c < S.n; c++) {
      const b = (start + c) % SCAR_MAX, a = (b + SCAR_MAX - 1) % SCAR_MAX;
      if (!S.conn[b]) continue;
      idx[m++] = a * 2; idx[m++] = b * 2; idx[m++] = a * 2 + 1;
      idx[m++] = a * 2 + 1; idx[m++] = b * 2; idx[m++] = b * 2 + 1;
    }
    S.g.index.needsUpdate = true;
    S.g.attributes.position.needsUpdate = true; S.g.attributes.uv.needsUpdate = true; S.g.attributes.color.needsUpdate = true;
    S.g.setDrawRange(0, m);
    stats.scarSections++;
  }
  function suctionMark(t, x, z, dx, dz, rs) {
    const S = scarMesh();
    if (!S) return;
    const i = S.markN % S.markCap;
    S.markN++;
    if (i + 1 > S.markHi) { S.markHi = i + 1; S.marks.count = S.markHi; }
    _p3.set(x, t.gfn(x, z) + 0.08, z);
    _q4.setFromAxisAngle(_up, Math.atan2(-dz, dx));
    _s3.set(rs * 1.1, 1, rs * 0.35);
    _m4.compose(_p3, _q4, _s3);
    S.marks.setMatrixAt(i, _m4);
    S.marks.instanceMatrix.needsUpdate = true;
    stats.suctionMarks++;
  }
  function clearScar() {
    if (!scar) return;
    scar.n = 0; scar.head = 0; scar.g.setDrawRange(0, 0);
    scar.markN = 0; scar.markHi = 0; scar.marks.count = 0;
  }
  // measure, across the track, how far the gust scours the ground (>= 50
  // m/s) on each side, and lay the section there: narrow, offset to the
  // strong side, exactly as wide as the wind made it
  function pathTrail(t, dt) {
    const f = Math.hypot(t.fvx, t.fvz);
    stats.pathMeters += f * dt;
    t._scarD = (t._scarD || 0) + f * dt;
    if (t._scarD >= 2.5 && t.k > 0.15) {
      t._scarD = 0;
      const nx = -t.fvz / (f || 1), nz = t.fvx / (f || 1);   // left of the track
      const reach = function (side) {
        let w = 0;
        for (let s = 1; s <= 14; s++) {
          const d = s * t.outer / 14 * 0.6;
          fieldInto(t, t.x + nx * d * side, t.z + nz * d * side, _s, 0.5);
          if (_s.gust >= 50) w = d; else if (w > 0) break;
        }
        return w;
      };
      let wl = reach(1), wr = reach(-1);
      const strength = Math.min(1, (t.vmax * t.k - 30) / 50);
      if (wl + wr < 1) { wl = wr = Math.max(1.2, t.R * 0.25); }                  // a weak one scuffs
      if (strength > -0.2) { scarSection(t, t.x, t.z, nx, nz, wl, wr, strength, !!t._scarJoin); t._scarJoin = true; }
    }
    // the suction vortices' cycloids
    if (t.sv && t.k > 0.5) for (const S of t.sv) {
      const d = Math.hypot(S.x - (S.lx != null ? S.lx : S.x), S.z - (S.lz != null ? S.lz : S.z));
      S.acc = (S.acc || 0) + d;
      if (S.lx == null || S.acc >= 2.2) {
        if (S.lx != null) suctionMark(t, S.x, S.z, S.x - S.lx, S.z - S.lz, S.rs);
        S.acc = 0; S.lx = S.x; S.lz = S.z;
      }
    }
  }

  /* ============================================================
     HAIL — the forward flank, around the camera.
     ============================================================ */
  let hail = null;
  function hailPool() {
    if (hail) return hail;
    const root = arenaRoot();
    if (!root) return null;
    const cap = qi(70, 240);
    const mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshLambertMaterial({ color: 0xe8eef2 }), cap);
    mesh.count = 0; mesh.frustumCulled = false; mesh.name = "tw-hail";
    if (mesh.instanceMatrix.setUsage) mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    root.add(mesh);
    hail = { mesh, cap, p: new Float32Array(cap * 3), v: new Float32Array(cap * 3), r: new Float32Array(cap), st: new Uint8Array(cap), life: new Float32Array(cap), ptr: 0, hi: 0, acc: 0, sndT: 0, landed: 0 };
    return hail;
  }
  function stepHail(dt) {
    const t = live[0];
    const c = camPos();
    if (!hail && (!t || !c)) return;
    const Hp = hailPool();
    if (!Hp) return;
    let rate = 0, size = 0.012;
    if (t && c && t.ffdX != null && t.k > 0.2) {
      const zoneR = (t.mesh ? t.mesh.ffdR : 80) * 1.6;
      const d = Math.hypot(c.x - t.ffdX, c.z - t.ffdZ);
      const inside = Math.max(0, Math.min(1, 1.25 - d / zoneR));
      rate = inside * q(40, 130) * Math.min(1, t.age / 4);
      size = 0.008 + 0.006 * t.ef;                    // radius: 1.6 cm (EF0) .. 4.6 cm (EF5)
    }
    Hp.acc += rate * dt;
    while (Hp.acc >= 1 && c) {
      Hp.acc -= 1;
      const i = Hp.ptr; Hp.ptr = (Hp.ptr + 1) % Hp.cap;
      const x = c.x + (Math.random() - 0.5) * 50, z = c.z + (Math.random() - 0.5) * 50;
      const gy = t ? t.gfn(x, z) : floorAt(x, z);
      Hp.p[i * 3] = x; Hp.p[i * 3 + 1] = Math.max(c.y, gy) + 18 + Math.random() * 14; Hp.p[i * 3 + 2] = z;
      const sz = size * (0.6 + Math.random() * 0.8);
      const vt = 9 * Math.sqrt(sz * 200);             // terminal fall speed ~ sqrt(diameter)
      Hp.v[i * 3] = t ? (t.x - x) * 0.02 : 0; Hp.v[i * 3 + 1] = -vt; Hp.v[i * 3 + 2] = t ? (t.z - z) * 0.02 : 0;
      Hp.r[i] = sz; Hp.st[i] = 1; Hp.life[i] = 0;
      if (i + 1 > Hp.hi) { Hp.hi = i + 1; Hp.mesh.count = Hp.hi; }
      stats.hailStones++;
    }
    let landed = 0, any = false;
    for (let i = 0; i < Hp.hi; i++) {
      const st = Hp.st[i];
      if (!st) continue;
      any = true;
      const ix = i * 3;
      if (st === 3) {                                  // lying, melting
        Hp.life[i] += dt;
        if (Hp.life[i] > 5) { Hp.st[i] = 0; _m4.makeScale(0, 0, 0); Hp.mesh.setMatrixAt(i, _m4); }
        continue;
      }
      Hp.v[ix + 1] -= (st === 2 ? G : 0) * dt;
      Hp.p[ix] += Hp.v[ix] * dt; Hp.p[ix + 1] += Hp.v[ix + 1] * dt; Hp.p[ix + 2] += Hp.v[ix + 2] * dt;
      const gy = t ? t.gfn(Hp.p[ix], Hp.p[ix + 2]) : floorAt(Hp.p[ix], Hp.p[ix + 2]);
      if (Hp.p[ix + 1] <= gy + Hp.r[i]) {
        Hp.p[ix + 1] = gy + Hp.r[i];
        if (st === 1) { Hp.st[i] = 2; Hp.v[ix + 1] = -Hp.v[ix + 1] * 0.3; Hp.v[ix] = (Math.random() - 0.5) * 2; Hp.v[ix + 2] = (Math.random() - 0.5) * 2; landed++; }
        else { Hp.st[i] = 3; Hp.life[i] = 0; }
      }
      _p3.set(Hp.p[ix], Hp.p[ix + 1], Hp.p[ix + 2]);
      _s3.setScalar(Hp.r[i]);
      _m4.compose(_p3, _q4.identity(), _s3);
      Hp.mesh.setMatrixAt(i, _m4);
    }
    if (any) Hp.mesh.instanceMatrix.needsUpdate = true;
    else if (rate <= 0) { Hp.hi = 0; Hp.mesh.count = 0; }
    // the rattle of it on the ground and the roofs
    Hp.landed += landed;
    Hp.sndT += dt;
    if (Hp.sndT > 0.14) {
      if (Hp.landed > 0 && CBZ.sfx) { try { CBZ.sfx("hail", { volume: Math.min(1, 0.2 + Hp.landed * 0.06) }); } catch (e) {} }
      Hp.sndT = 0; Hp.landed = 0;
    }
  }
  function clearHail() {
    if (!hail) return;
    hail.st.fill(0); hail.hi = 0; hail.mesh.count = 0; hail.acc = 0;
  }

  /* ============================================================
     THE SIREN — the civil-defence tornado siren (assets/audio/oga/
     storm-siren.m4a, a real one), started once, stopped when it is over.
     ============================================================ */
  let sirenSrc = null, sirenOn = false;
  T.siren = function (on) {
    if (on && !sirenOn) {
      sirenOn = true;
      try {
        if (CBZ.sfx) {
          const s = CBZ.sfx("storm_siren", { volume: 0.75, force: true, onSource: function (src) { if (sirenOn) sirenSrc = src; else { try { src.stop(); } catch (e) {} } } });
          if (s) sirenSrc = s;
        }
      } catch (e) {}
    } else if (!on && sirenOn) {
      sirenOn = false;
      try { if (sirenSrc) sirenSrc.stop(); } catch (e) {}
      sirenSrc = null;
    }
    return sirenOn;
  };

  /* ============================================================
     SPAWN / STOP
     DETERMINISM: the spawn point, the class and the heading come from
     CBZ.seedStream("tornado") when the caller does not supply them; the
     per-step wobble is hashed off the current position. Math.random is only
     cosmetic (which way a shingle tumbles).
     ============================================================ */
  T.spawn = function (opts) {
    opts = opts || {};
    if (!CBZ.CONFIG.TORNADO_CITY) return null;
    const cap = Math.max(1, Math.min(2, CBZ.CONFIG.TORNADO_MAX | 0));
    while (live.length >= cap) retire(live[0], true);
    /* A MAGNITUDE, NOT A CLASS ROW: built at a continuous point `mag` (0..5)
       on the EF table with independently jittered axes, the class read BACK
       from the rolled gust. opts.ef = legacy class request (mag = ef ± 0.45). */
    let mag;
    if (opts.mag != null) mag = Math.max(0, Math.min(5, +opts.mag));
    else if (opts.ef != null) mag = Math.max(0, Math.min(5, (opts.ef | 0) + (rng() - 0.5) * 0.9));
    else mag = 5 * Math.pow(rng(), 1.5);
    const iLo = Math.min(4, Math.floor(mag)), fRow = mag - iLo;
    const rLo = EF[iLo], rHi = EF[iLo + 1];
    const lerpRow = function (k) { return rLo[k] + (rHi[k] - rLo[k]) * fRow; };
    const vmaxR = lerpRow("vmax") * (0.95 + rng() * 0.10);
    const coreR = lerpRow("R")    * (0.80 + rng() * 0.45);
    const fwdR  = lerpRow("fwd")  * (0.78 + rng() * 0.50);
    let   lifeR = lerpRow("life") * (0.70 + rng() * 0.75);
    if (opts.capLife != null) lifeR = (+opts.capLife) * (0.55 + 0.45 * Math.min(1, lifeR / 94));
    let ef = 0;
    while (ef < 5 && vmaxR >= EF_EDGES[ef]) ef++;
    let x = opts.x, z = opts.z;
    if (x == null || z == null) {
      const A = CBZ.city && CBZ.city.arena;
      if (A && A.lots && A.lots.length) { const lot = A.lots[(rng() * A.lots.length) | 0]; x = lot.cx; z = lot.cz; }
      else { x = (rng() - 0.5) * 400; z = (rng() - 0.5) * 400; }
    }
    const heading = opts.heading != null ? opts.heading : rng() * 6.2832;
    const fwd = opts.speed != null ? +opts.speed : fwdR;
    const world = opts.arena || islandBridge();
    if (world) lastWorld = world;
    const t = {
      id: ++idSeq,
      x: +x, z: +z, ef: ef, mag: +mag.toFixed(2),
      wedge: Math.max(0, Math.min(1, (mag - 1.2) / 2.8)),
      R: coreR, vmax: vmaxR, wmax: vmaxR * LIFT_MUL,
      outer: coreR * OUTER_MUL,
      Hup: 90 + 60 * Math.min(1, mag / 4),             // depth of the low-level updraft
      heading: heading, fwd: fwd,
      fvx: Math.cos(heading) * fwd, fvz: Math.sin(heading) * fwd,
      life: opts.life != null ? +opts.life : lifeR,
      age: 0, spin: 0, k: 0, s0: 1, rope: 0,
      wrap: 0.55 + 0.45 * rng(),                       // how rain-wrapped this storm is
      // nobody is to blame for the weather (a non-null `by` makes the
      // structural ledger credit the player with every collapse)
      by: opts.by || null,
      bounds: opts.bounds || null,
      world: world, arena: world,                      // `arena`: the old name, kept for readers
      gfn: groundOf(world),
      x0: +x, z0: +z,
      dps: DPS0 * Math.pow(vmaxR / 33, 3),
      tStruct: 0, tCars: 0, tPeople: 0, tFx: 0, tSfx: 0, tShake: 0, tGlass: 0, tProp: 0, tEvent: 0, tWd: 0,
      roofs: new Map(),
      dead: false,
    };
    // SUCTION VORTICES: EF3+ (3, 4 at EF4, 5 at EF5), orbiting inside the core
    if (ef >= 3) {
      const n = ef === 3 ? 3 : (ef === 4 ? 4 : 5);
      t.sv = [];
      for (let i = 0; i < n; i++) t.sv.push({ ang: i * 6.2832 / n, orb: coreR * 0.72, rs: Math.max(2.5, coreR * 0.12), v: vmaxR * 0.2, x: +x, z: +z });
    }
    /* THE RATING IS THE PEAK GUST. vmax is what the EF class means: the
       strongest ground-relative 3-second gust anywhere in the path. That
       peak is the rotation PLUS the storm's own motion (the right side) PLUS
       a suction vortex passing over, so the rotation alone is built smaller
       by those parts (forward speed surges to 1.35x; measured in the lab kit,
       src/lab/kits/tornado.js, the transect's peak gust lands on vmax). */
    t.vrot = Math.max(vmaxR * 0.55, vmaxR - 1.2 * fwd - (t.sv ? 0.7 * t.sv[0].v : 0));
    live.push(t);
    buildFunnel(t);
    // the pools are built on the spawn frame (already the heavy one), not
    // mid-storm the first time a hailstone or a scar needs one; the wind
    // starts acting on every loose piece in the debris sim
    scarMesh(); hailPool(); mediumOn(true);
    try {
      if (CBZ.sfx) { CBZ.sfx("wind"); CBZ.sfx("rumble", { delay: 0.4 }); }
      if (inCity()) T.siren(true);
    } catch (e) {}
    fireHook(T.onSpawn, snapshot(t));
    return t;
  };

  function snapshot(t) {
    return { id: t.id, x: +t.x.toFixed(2), z: +t.z.toFixed(2), ef: t.ef, mag: t.mag,
      r: +t.R.toFixed(1), vmax: +t.vmax.toFixed(1), h: t.mesh ? +t.mesh.H.toFixed(0) : 0,
      age: +t.age.toFixed(2), life: +t.life.toFixed(2), k: +t.k.toFixed(2), rope: +t.rope.toFixed(2) };
  }
  T.active = function () { return live.map(snapshot); };
  T.count = function () { return live.length; };
  T.stop = function (handle) {
    if (handle && handle.id != null) { retire(handle, false); return true; }
    if (!live.length) return false;
    while (live.length) retire(live[live.length - 1], false);
    return true;
  };
  T.clear = function () { while (live.length) retire(live[live.length - 1], true); };

  function retire(t, hard) {
    const i = live.indexOf(t);
    if (i >= 0) live.splice(i, 1);
    t.dead = true;
    t.roofs.clear();
    disposeFunnel(t);
    // the last vortex gone: the wind lets go of every piece (they fall)
    if (!live.length) mediumOn(false);
    if (!live.length && inCity()) T.siren(false);
    if (!hard) { try { if (CBZ.sfx) CBZ.sfx("wind", { volume: 0.5 }); } catch (e) {} }
    fireHook(T.onEnd, snapshot(t));
  }

  /* SEAMS: T.onSpawn / onPath / onDamage / onEnd  fn(snapshot | {id,x,z,stage,...}) */
  T.onSpawn = null; T.onPath = null; T.onDamage = null; T.onEnd = null;
  let lastPath = null;
  function fireHook(fn, arg) { if (typeof fn === "function") { try { fn(arg); } catch (e) {} } }

  /* ============================================================
     MOVEMENT: forward at `fwd`, a hashed wobble, a surging pace, bounced
     off an optional bounding circle, clamped to the city otherwise.
     ============================================================ */
  function move(t, dt) {
    const w = h01(t.x, t.z, 0x7043);
    t.heading += (w - 0.5) * 0.55 * dt;
    t.trav = (t.trav || 0) + t.fwd * dt;
    const surge = 1 + 0.35 * Math.sin(t.trav * 0.045 + t.id * 2.1) * Math.sin(t.trav * 0.011 + 1.3);
    const fvNow = t.fwd * surge;
    t.fvx = Math.cos(t.heading) * fvNow;
    t.fvz = Math.sin(t.heading) * fvNow;
    t.x += t.fvx * dt;
    t.z += t.fvz * dt;
    if (t.bounds) {
      const dx = t.x - t.bounds.x, dz = t.z - t.bounds.z, d = Math.hypot(dx, dz);
      if (d > t.bounds.r) {
        t.heading = Math.atan2(t.bounds.z - t.z, t.bounds.x - t.x) + (w - 0.5) * 0.8;
        t.fvx = Math.cos(t.heading) * fvNow; t.fvz = Math.sin(t.heading) * fvNow;
        t._scarJoin = false;
      }
    } else if (inCity() && CBZ.city && CBZ.city.arena && CBZ.city.arena.clampToCity) {
      const p = { x: t.x, z: t.z };
      try {
        CBZ.city.arena.clampToCity(p, t.R * 0.5);
        if (Math.abs(p.x - t.x) > 0.01 || Math.abs(p.z - t.z) > 0.01) {
          t.x = p.x; t.z = p.z;
          t.heading += Math.PI * 0.55;
          t.fvx = Math.cos(t.heading) * fvNow; t.fvz = Math.sin(t.heading) * fvNow;
          t._scarJoin = false;
        }
      } catch (e) {}
    }
    // the suction vortices orbit the axis (cyclonic), faster as it tightens
    if (t.sv) {
      const rate = (t.vmax / t.R) * 0.45 * Math.max(0.3, t.k);
      for (const S of t.sv) {
        S.ang += rate * dt;
        const orb = S.orb * (1 - 0.4 * t.rope);
        S.x = t.x + Math.cos(-S.ang) * orb; S.z = t.z + Math.sin(-S.ang) * orb;
      }
    }
  }

  /* ============================================================
     CITY LOTS — roof-first, sustained, through city/structural.js, sized by
     the LOCAL gust (v^3 power flux) at the footprint.
     ============================================================ */
  const STRUCT_TICK = 0.2;
  const _lotHits = [];
  function hitCityLots(t, dt) {
    if (!inCity() || !CBZ.CONFIG.TORNADO_STRUCTURAL || !CBZ.structure || !CBZ.structure.hit) return;
    t.tStruct += dt;
    if (t.tStruct < STRUCT_TICK) return;
    const step = t.tStruct; t.tStruct = 0;
    const A = CBZ.city && CBZ.city.arena;
    if (!A || !A.lots) return;
    _lotHits.length = 0;
    for (let i = 0; i < A.lots.length; i++) {
      const lot = A.lots[i], b = lot.building;
      if (!b || lot.demolished) continue;
      const dx = Math.max(0, Math.abs(b.ox - t.x) - b.w * 0.5);
      const dz = Math.max(0, Math.abs(b.oz - t.z) - b.d * 0.5);
      const d = Math.hypot(dx, dz);
      if (d >= t.outer) continue;
      _lotHits.push(lot, d);
    }
    if (!_lotHits.length) return;
    const cap = Math.max(3, Math.round(q(6, 18))) * 2;
    if (_lotHits.length > cap) {
      for (let a = 0; a < cap; a += 2) {
        let bi = a;
        for (let c = a + 2; c < _lotHits.length; c += 2) if (_lotHits[c + 1] < _lotHits[bi + 1]) bi = c;
        if (bi !== a) { const l0 = _lotHits[a], d0 = _lotHits[a + 1]; _lotHits[a] = _lotHits[bi]; _lotHits[a + 1] = _lotHits[bi + 1]; _lotHits[bi] = l0; _lotHits[bi + 1] = d0; }
      }
      _lotHits.length = cap;
    }
    for (let i = 0; i < _lotHits.length; i += 2) {
      const lot = _lotHits[i], d = _lotHits[i + 1], b = lot.building;
      // the gust at the footprint's nearest point to the axis
      const px = Math.max(b.ox - b.w * 0.5, Math.min(b.ox + b.w * 0.5, t.x));
      const pz = Math.max(b.oz - b.d * 0.5, Math.min(b.oz + b.d * 0.5, t.z));
      fieldInto(t, px, pz, _s, 6);
      if (_s.gust < DOD.cover) continue;
      const amount = DPS0 * Math.pow(_s.gust / 33, 3) * step * 0.5;
      const info = roofInfo(t, lot, b);
      if (info.doomed) continue;
      let nx = _s.vx, nz = _s.vz;
      const nl = Math.hypot(nx, nz) || 1; nx /= nl; nz /= nl;
      let stage = 0;
      try {
        const rec = CBZ.structure.hit(b.ox, info.y, b.oz, amount, { kind: "tornado", pen: 0, fire: 0, dirx: nx, dirz: nz, by: t.by, lot: lot });
        stage = (rec && rec.stage) || 0;
      } catch (e) {}
      stats.buildingHits++;
      if (T.onDamage) fireHook(T.onDamage, { id: t.id, x: b.ox, z: b.oz, lot: lot, amount: +amount.toFixed(3), stage: stage });
      // the roof coming off, visibly: its covering, lofted into the field
      if (camDist(b.ox, b.oz) < (CBZ.cityCullRadius || 320)) {
        const n = Math.min(4, Math.round((_s.gust - DOD.cover) / 10) + 1);
        for (let k = 0; k < n; k++) spawnDebris(k & 1 ? 0 : 3, b.ox + (Math.random() - 0.5) * b.w * 0.8, info.y + 1, b.oz + (Math.random() - 0.5) * b.d * 0.8,
          nx * 8, 5, nz * 8, b.color != null ? b.color : 0x7d7468, 1, floorAt);
      }
    }
  }
  const _roofOut = { y: 1, doomed: false };
  function roofInfo(t, lot, b) {
    const FH = b.FH || 3.2;
    const roofY = Math.max(1, (b.h || b.storeys * FH) - FH * 0.35);
    let rec = t.roofs.get(lot);
    if (rec && CBZ.now - rec.t < 500) { _roofOut.y = rec.y; _roofOut.doomed = rec.doomed; return _roofOut; }
    let y = roofY, doomed = false;
    try {
      const st = CBZ.structure.state ? CBZ.structure.state(lot) : null;
      if (st) {
        doomed = (st.doomedIn != null && st.doomedIn >= 0) || (st.stage || 0) >= 5;
        if (st.floors && st.floors.length) {
          let top = -1;
          for (let i = st.floors.length - 1; i >= 0; i--) if (st.floors[i] > 0.2) { top = i; break; }
          y = top < 0 ? Math.max(1, FH * 0.5) : Math.max(1, (top + 0.85) * FH);
        }
      }
    } catch (e) {}
    if (!rec) { rec = { y: y, doomed: doomed, t: 0 }; t.roofs.set(lot, rec); }
    rec.y = y; rec.doomed = doomed; rec.t = CBZ.now;
    if (t.roofs.size > 64) t.roofs.clear();
    _roofOut.y = y; _roofOut.doomed = doomed;
    return _roofOut;
  }
  // city traffic: the same force test, the same flyer
  function scanCityCars(t, dt) {
    if (!CBZ.CONFIG.TORNADO_LIFT || !inCity() || !CBZ.cityCars) return;
    t.tCars += dt;
    if (t.tCars < 0.2) return;
    t.tCars = 0;
    const cars = CBZ.cityCars;
    let owned = 0;
    for (const f of flyers) if (f.kind === "car") owned++;
    const cap = qi(3, 10);
    for (let i = 0; i < cars.length && owned < cap; i++) {
      const c = cars[i];
      if (!c || c.dead || c._twLift || c.player || !c.pos) continue;
      if (Math.abs(c.pos.x - t.x) > t.outer || Math.abs(c.pos.z - t.z) > t.outer) continue;
      const before = flyers.length;
      windCar(t, c, c.pos, true);
      if (flyers.length > before) owned++;
    }
  }

  /* ============================================================
     PEOPLE. Every death goes through the shared kill bus.
     ============================================================ */
  const PEOPLE_TICK = 0.2;
  const CAUSE = "torn apart by the tornado";
  function hitPeople(t, dt) {
    t.tPeople += dt;
    const tick = t.tPeople >= PEOPLE_TICK;
    const step = t.tPeople;
    if (tick) t.tPeople = 0;
    if (!inCity()) {
      if (CBZ.surv && CBZ.surv.forEachActor) {
        const W = t.world;
        CBZ.surv.forEachActor(function (a) {
          if (!a || !a.pos) return;
          const d = Math.hypot(a.pos.x - t.x, a.pos.z - t.z);
          if (d > t.outer) { a._twSafe = false; return; }
          fieldInto(t, a.pos.x, a.pos.z, _s, 1);
          /* AN INTERIOR ROOM IS THE ANSWER: shelter spares the drag and the
             core — until the building itself fails (its roof gone, its walls
             down), which is the real bargain. */
          if (W && W.sheltered) {
            let inside = false;
            try { inside = !!W.sheltered(a); } catch (e) {}
            // a room holds until the gust is past what takes its walls down
            if (inside && _s.gust < DOD.most) {
              if (_s.gust > 30 && !a._twSafe) { a._twSafe = true; stats.shelterSaves++; }
              if (_s.gust > 55) { try { CBZ.surv.hurt(a, _s.gust * 0.04 * dt); } catch (e) {} }
              return;
            }
            a._twSafe = false;
          }
          if (_s.gust > 60 && d < t.R * 0.9) { try { CBZ.surv.hurt(a, 1e6, { fromX: t.x, fromZ: t.z, fling: 8 }); } catch (e) {} return; }   // only a >60 m/s (EF2+) core kills outright, and disasterhurt.js warns first
          const drag = Math.min(9, _s.gust * 0.10);
          if (a.isPlayer) dragPlayer(t, dt, drag);
          else {
            const inv = 1 / Math.max(1, _s.gust);
            a.pos.x += _s.vx * inv * drag * dt;
            a.pos.z += _s.vz * inv * drag * dt;
            if (CBZ.collide) { try { CBZ.collide(a.pos, 0.5); } catch (e) {} }
          }
          if (_s.gust > 30) { try { CBZ.surv.hurt(a, (_s.gust - 24) * 0.25 * dt); } catch (e) {} }
        });
      }
      return;
    }
    if (tick) {
      const kill = t.R * 0.7;
      if (CBZ.crowds && CBZ.crowds.crush && t.k > 0.5) { try { CBZ.crowds.crush(t.x, t.z, kill, { cause: "tornado" }); } catch (e) {} }
      const peds = CBZ.cityPeds;
      if (peds && peds.length) {
        for (let i = 0; i < peds.length; i++) {
          const p = peds[i];
          if (!p || p.dead || !p.pos) continue;
          const dx = p.pos.x - t.x, dz = p.pos.z - t.z;
          if (Math.abs(dx) > t.outer || Math.abs(dz) > t.outer) continue;
          const d = Math.hypot(dx, dz);
          if (d > t.outer) continue;
          fieldInto(t, p.pos.x, p.pos.z, _s, 1);
          if (d < kill && _s.gust > 55) {
            try { CBZ.cityKillPed(p, { fromX: t.x, fromZ: t.z, force: 16, fling: 12, byPlayer: false }, CAUSE); } catch (e) {}
            continue;
          }
          const drag = Math.min(10, _s.gust * 0.12);
          const inv = 1 / Math.max(1, _s.gust);
          p.pos.x += _s.vx * inv * drag * step;
          p.pos.z += _s.vz * inv * drag * step;
          if (CBZ.collideSlide) { try { CBZ.collideSlide(p.pos, 0.4, p.pos.y, p.pos.y + 1.7); } catch (e) {} }
        }
      }
    }
    hitPlayer(t, dt);
  }
  // drag toward the axis, thrown at the core: systems/physics.js's `_phys.air`
  function hitPlayer(t, dt) {
    const P = CBZ.player;
    if (!P || P.dead || !P.pos) return;
    if (P.driving) { shovePlayerCar(t, dt); return; }
    const d = Math.hypot(P.pos.x - t.x, P.pos.z - t.z);
    if (d > t.outer) return;
    fieldInto(t, P.pos.x, P.pos.z, _s, 1);
    const ph = P._phys;
    if (ph && ph.air) return;
    if (d < t.R * 0.85 && _s.gust > 45) {
      const inv = 1 / Math.max(1, _s.gust);
      const p2 = P._phys = P._phys || {};
      p2.air = true; p2.down = 0; p2.kx = p2.kz = 0;
      p2.vx = _s.vx * inv * Math.min(26, _s.gust * 0.45);
      p2.vz = _s.vz * inv * Math.min(26, _s.gust * 0.45);
      p2.vy = Math.min(20, 6 + _s.lift * 0.5);
      p2.spin = (Math.random() < 0.5 ? -1 : 1) * 5.5;
      P.grounded = false;
      try {
        if (CBZ.cityHurtPlayer) CBZ.cityHurtPlayer(Math.round(18 + t.ef * 9), t.x, t.z, CAUSE, false, null, false);
        if (CBZ.shake) CBZ.shake(2.0);
      } catch (e) {}
      return;
    }
    dragPlayer(t, dt, Math.min(7, _s.gust * 0.075));
    if (_s.gust > 32) {
      t.tHurt = (t.tHurt || 0) + dt;
      if (t.tHurt >= 0.5) {
        t.tHurt = 0;
        try { if (CBZ.cityHurtPlayer) CBZ.cityHurtPlayer(Math.round(_s.gust * 0.12), t.x, t.z, "battered by the tornado", false, null, false); } catch (e) {}
      }
    }
  }
  function dragPlayer(t, dt, drag) {
    const P = CBZ.player;
    if (!P || !P.pos) return;
    fieldInto(t, P.pos.x, P.pos.z, _s2, 1);
    const inv = 1 / Math.max(1, _s2.gust);
    P.pos.x += _s2.vx * inv * drag * dt;
    P.pos.z += _s2.vz * inv * drag * dt;
    if (CBZ.collideSlide) { try { CBZ.collideSlide(P.pos, 0.45, P.pos.y, P.pos.y + 1.8); } catch (e) {} }
    else if (CBZ.collide) { try { CBZ.collide(P.pos, 0.45); } catch (e) {} }
  }
  function shovePlayerCar(t, dt) {
    const car = CBZ.player && CBZ.player._vehicle;
    if (!car || !car.pos) return;
    const d = Math.hypot(car.pos.x - t.x, car.pos.z - t.z);
    if (d > t.outer) return;
    fieldInto(t, car.pos.x, car.pos.z, _s, 1);
    const inv = 1 / Math.max(1, _s.gust);
    const push = Math.min(14, _s.gust * 0.12);
    car.pos.x += _s.vx * inv * push * dt;
    car.pos.z += _s.vz * inv * push * dt;
    if (_s.gust > 50) {
      try {
        if (CBZ.cityDamageCar) CBZ.cityDamageCar(car, _s.gust * 0.35 * dt, {});
        if (CBZ.shake) CBZ.shake(Math.min(1.2, _s.gust * 0.012));
      } catch (e) {}
    }
  }

  /* ============================================================
     AMBIENCE: shake, roar, ground debris pulled into the cloud; the city's
     glass, street props and alarm.
     ============================================================ */
  function worldFx(t, dt) {
    const near = camDist(t.x, t.z);
    t.tShake += dt;
    if (t.tShake > 0.14) {
      t.tShake = 0;
      if (near < 260 && CBZ.shake) { const k = 1 - near / 260; try { CBZ.shake((0.25 + t.ef * 0.16) * k * k * t.k); } catch (e) {} }
    }
    t.tSfx += dt;
    if (t.tSfx > (near < 120 ? 0.8 : 2.2)) {
      t.tSfx = 0;
      try {
        if (CBZ.sfx && near < 300) {
          CBZ.sfx("wind", { volume: Math.max(0.25, 1 - near / 300) });
          if (t.ef >= 2 && near < 180) CBZ.sfx("rumble", { delay: 0.25, volume: 0.6 });
        }
      } catch (e) {}
    }
    // the ground itself feeds the debris cloud at EF2+: dirt and chips
    t.tFx += dt;
    if (t.tFx > q(0.35, 0.12) && t.k > 0.4 && t.ef >= 2) {
      t.tFx = 0;
      const a = Math.random() * 6.2832, rr = t.R * (0.4 + Math.random() * 0.7);
      const x = t.x + Math.cos(a) * rr, z = t.z + Math.sin(a) * rr;
      spawnDebris(3, x, t.gfn(x, z) + 0.3, z, 0, 3, 0, 0x4a3a2a, 0.6 + Math.random() * 0.5, t.gfn);
    }
    if (!inCity()) return;
    t.tGlass += dt;
    if (t.tGlass > 0.55) {
      t.tGlass = 0;
      try { if (CBZ.cityShatter) CBZ.cityShatter(t.x, t.z, t.R * 1.4); } catch (e) {}
    }
    t.tProp += dt;
    if (t.tProp > 0.35 && CBZ.cityShootProp) {
      t.tProp = 0;
      const a = Math.random() * 6.2832, L = t.R * 1.1;
      const gy = floorAt(t.x, t.z);
      // props.js reports a cooked-off propane tank as the PLAYER's crime; a
      // storm is not something you did, so the reporter is suspended for
      // this one call (restored in `finally`)
      const crime = CBZ.cityCrime;
      try {
        CBZ.cityCrime = null;
        CBZ.cityShootProp({ x: t.x - Math.cos(a) * L, y: gy + 0.9, z: t.z - Math.sin(a) * L }, { x: t.x + Math.cos(a) * L, y: gy + 0.9, z: t.z + Math.sin(a) * L });
      } catch (e) {}
      finally { CBZ.cityCrime = crime; }
    }
    t.tEvent += dt;
    if (t.tEvent > 1.0) {
      t.tEvent = 0;
      try { if (CBZ.cityPostEvent) CBZ.cityPostEvent({ type: "explosion", pos: { x: t.x, z: t.z }, radius: t.outer, intensity: 1.4 + t.ef * 0.3 }); } catch (e) {}
    }
  }

  /* ============================================================
     THE WEATHER DIRECTOR — a city tornado forms out of a severe storm
     (systems/weather.js's intensity), one hashed roll per in-game day.
     ============================================================ */
  if (CBZ.CONFIG.TORNADO_WEATHER == null) CBZ.CONFIG.TORNADO_WEATHER = true;
  const STORM_MIN = 0.82, DAY_CHANCE = 0.22;
  let lastDay = -1;
  function director() {
    if (!CBZ.CONFIG.TORNADO_CITY || !CBZ.CONFIG.TORNADO_WEATHER) return;
    if (live.length) return;
    if (!CBZ.game || CBZ.game.mode !== "city") return;
    const w = CBZ.weather;
    if (!w || !(w.intensity >= STORM_MIN)) return;
    const day = CBZ.dayCount ? (CBZ.dayCount() | 0) : 0;
    if (day === lastDay) return;
    lastDay = day;
    if (!CBZ.hash01) return;
    if (CBZ.hash01(day, 0, 0x7075a) >= DAY_CHANCE) return;
    const bias = (w.intensity - STORM_MIN) / (1 - STORM_MIN);
    const roll = CBZ.hash01(day, 1, 0x7075b);
    const mag = Math.max(0.6, Math.min(4.6, 0.8 + bias * 2.2 + (roll - 0.5) * 2.4));
    try { T.spawn({ mag: mag, by: null }); } catch (e) {}
  }

  /* ============================================================
     TICK — order 34.35 (after the ped brains at 34, before the impact bus
     at 34.4 and the ledger at 34.45, before vehicles.js at 37).
     ============================================================ */
  function tick(dt) {
    if (!CBZ.CONFIG.TORNADO_CITY) { if (live.length) T.clear(); return; }
    director();
    if (!live.length && !flyers.length && !hinges.length && !parked.length && !(hail && hail.hi)) return;
    const t0 = performance.now();
    const d = dt > 0.25 ? 0.25 : dt;
    for (let i = live.length - 1; i >= 0; i--) {
      const t = live[i];
      t.age += d;
      if (t.age >= t.life) { retire(t, false); continue; }
      _pt0 = performance.now();
      lifecycle(t);
      move(t, d);
      animateFunnel(t, d); lap("funnel");
      worldFx(t, d); lap("fx");
      pathTrail(t, d); lap("path");
      windDamage(t, d); lap("damage");
      hitCityLots(t, d);
      scanCityCars(t, d); lap("city");
      hitPeople(t, d); lap("people");
      lastPath = { x0: t.x0, z0: t.z0, x1: t.x, z1: t.z, ef: t.ef };
      if (T.onPath) {
        t.tPath = (t.tPath || 0) + d;
        if (t.tPath >= 0.2) { t.tPath = 0; fireHook(T.onPath, snapshot(t)); }
      }
    }
    _pt0 = performance.now();
    stepFlyers(d); lap("flyers");
    stepHinges(d); lap("debris");
    stepHail(d); lap("hail");
    const ms = performance.now() - t0;
    perf.frames++; perf.ms += ms; perf.last = ms;
    if (ms > perf.max) perf.max = ms;
  }
  if (CBZ.onUpdate) CBZ.onUpdate(34.35, tick);

  /* ============================================================
     RESET — T.restoreWorld() puts back everything the journal recorded,
     clears the debris, the hail and the scar. The island's run reset calls
     it; the city's reset chokepoint (cityGlassReset) clears the vortex.
     ============================================================ */
  T.restoreWorld = function () {
    T.clear();
    mediumOn(false);
    for (let i = flyers.length - 1; i >= 0; i--) { const f = flyers[i]; if (f.obj) f.obj.userData._twFly = null; }
    flyers.length = 0;
    parked.length = 0;
    hinges.length = 0;
    // every roof, wall and bit this storm put into the debris sim goes (the
    // originals it hid come back through the journal below)
    clearDebris();
    for (let i = journal.length - 1; i >= 0; i--) {
      const J = journal[i];
      try {
        if (J.k === 0) {
          const o = J.o;
          if (J.parent && o.parent !== J.parent) { if (o.parent) o.parent.remove(o); J.parent.add(o); }
          o.position.copy(J.p); o.quaternion.copy(J.q); o.scale.copy(J.s); o.visible = J.v;
          o.userData._twJ = false; o.userData._twFly = null; o.userData._twThrown = false;
        } else if (J.k === 1) { if (CBZ.colliders && CBZ.colliders.indexOf(J.c) < 0) CBZ.colliders.push(J.c); }
        else if (J.k === 2) { const k = CBZ.colliders ? CBZ.colliders.indexOf(J.c) : -1; if (k >= 0) CBZ.colliders.splice(k, 1); }
        else if (J.k === 3) { if (CBZ.platforms && CBZ.platforms.indexOf(J.p) < 0) CBZ.platforms.push(J.p); }
      } catch (e) {}
    }
    journal.length = 0;
    if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
    if (CBZ.markPlatformsDirty) CBZ.markPlatformsDirty();
    touched.forEach(function (r) {
      r._tw = null; r._twSwept = false; r._twFell = false; r._twLift = false; r._twGlass = false;
      r._twOwned = false; r._twWreck = false; r._twCol = null; r._twMoved = false; r._twRolled = false; r._twThrown = false;
      if (r.flung === true && r.group && r.collider) r.flung = false;
    });
    touched.clear();
    clearDebris(); clearHail(); clearScar();
    T.siren(false);
    for (const k in stats) stats[k] = 0;
    perf.frames = perf.ms = perf.max = perf.last = 0; perf.sec = {};
    lastPath = null;
  };
  if (CBZ.onUpdate) CBZ.onUpdate(0.03, function () {
    const orig = CBZ.cityGlassReset;
    if (typeof orig !== "function" || orig._tornadoResetWrapped) return;
    const wrapped = function () { try { T.clear(); mediumOn(false); flyers.length = 0; parked.length = 0; clearScar(); clearDebris(); clearHail(); } catch (e) {} return orig.apply(this, arguments); };
    for (const k in orig) if (k.endsWith("Wrapped")) wrapped[k] = orig[k];
    wrapped._tornadoResetWrapped = true;
    CBZ.cityGlassReset = wrapped;
  });

  /* THE PIECES THIS FILE STILL MOVES ITSELF (cars, crowns), for
     CBZ.debrisAudit(): resting with nothing under them, too fast, too high.
     Roofs, walls and bits are the debris sim's own and are audited there. */
  (CBZ.debrisAuditSources || (CBZ.debrisAuditSources = {})).tornado = function (o) {
    o = o || {};
    const fastV = o.fast || 30, high = o.high || 120;
    const r = { floating: 0, fast: 0, high: 0, maxSpeed: 0, maxHeight: 0, flyers: flyers.length, parked: parked.length, list: [] };
    const look = function (f, resting) {
      const sp = resting ? 0 : Math.hypot(f.vx, f.vy, f.vz);
      if (sp > r.maxSpeed) r.maxSpeed = +sp.toFixed(1);
      if (sp > fastV) r.fast++;
      const hh = upHalf(f), bottom = f.y - hh;
      const h = bottom - f.gfn(f.x, f.z);
      if (h > r.maxHeight) r.maxHeight = +h.toFixed(1);
      if (h > high) r.high++;
      if (resting || f.grounded) {
        const gap = bottom - supportY(f, f.x, f.z, bottom + 0.3);
        if (gap > 0.5) { r.floating++; if (r.list.length < 6) r.list.push({ kind: f.kind, x: +f.x.toFixed(1), y: +bottom.toFixed(1), z: +f.z.toFixed(1), gap: +gap.toFixed(2) }); }
      }
    };
    for (const f of flyers) look(f, false);
    for (const f of parked) if (f.obj && f.obj.parent) look(f, true);
    return r;
  };

  /* CBZ.tornadoAudit() — THE RATCHET: vortex implementations that are not
     this one. Baseline 1 (the old survival funnel), now 0; may only fall. */
  CBZ.tornadoAudit = function () {
    let n = 0;
    if (CBZ.disasters && !CBZ.disasters._tornadoDelegated) n++;
    return n;
  };

  /* What the tornado DID (counters of things that happened) + perf. */
  T.audit = function () {
    const a = live[0] || null;
    const dc = debrisCounts();
    return Object.assign({
      live: live.length, ef: a ? a.ef : -1, mag: a ? a.mag : null,
      x: a ? +a.x.toFixed(1) : null, z: a ? +a.z.toFixed(1) : null, age: a ? +a.age.toFixed(2) : 0,
      debrisAirborne: dc.airborne, debrisOnGround: dc.onGround, debrisNow: dc.total,
      flyersNow: flyers.length,
      carsFlung: stats.carsThrown, scarMarks: stats.scarSections, debrisKept: dc.onGround,
      path: lastPath ? { x0: +lastPath.x0.toFixed(1), z0: +lastPath.z0.toFixed(1), x1: +lastPath.x1.toFixed(1), z1: +lastPath.z1.toFixed(1), ef: lastPath.ef } : null,
    }, stats, { pathMeters: Math.round(stats.pathMeters), maxDebrisHeight: +stats.maxDebrisHeight.toFixed(1), maxCarHeight: +stats.maxCarHeight.toFixed(1), maxThrow: +stats.maxThrow.toFixed(1) });
  };
  T.perf = function () {
    const worst = {};
    for (const k in perf.sec) worst[k] = +perf.sec[k].toFixed(2);
    return { frames: perf.frames, avgMs: perf.frames ? +(perf.ms / perf.frames).toFixed(3) : 0, maxMs: +perf.max.toFixed(3), lastMs: +perf.last.toFixed(3), worstByStage: worst };
  };
  T.debug = function () {
    return {
      live: live.length, cap: Math.max(1, Math.min(2, CBZ.CONFIG.TORNADO_MAX | 0)),
      vortices: live.map(function (t) {
        return { id: t.id, ef: t.ef, mag: t.mag, wedge: +t.wedge.toFixed(2), x: +t.x.toFixed(1), z: +t.z.toFixed(1),
          R: +t.R.toFixed(1), vmax: +t.vmax.toFixed(1), k: +t.k.toFixed(2), s0: +t.s0.toFixed(2), rope: +t.rope.toFixed(2),
          age: +t.age.toFixed(1), life: +t.life.toFixed(1), suction: t.sv ? t.sv.length : 0 };
      }),
      flyers: flyers.length, parked: parked.length, hinges: hinges.length, journal: journal.length,
      audit: CBZ.tornadoAudit(), perf: T.perf(),
      flags: { city: !!CBZ.CONFIG.TORNADO_CITY, structural: !!CBZ.CONFIG.TORNADO_STRUCTURAL, lift: !!CBZ.CONFIG.TORNADO_LIFT },
    };
  };
  /* How this file reads a building's parts (for the island's author and the
     checks): roof meshes, separate wall panels, the rest, the slab, whether
     its walls fall panel by panel or the structure goes to the ledger. */
  T.partsOf = function (b) {
    if (!b) return null;
    const had = b._tw, st = bState(b);
    const r = { roof: st.parts.roof.length, walls: st.parts.walls.length, other: st.parts.other.length, slab: !!st.parts.slab,
      separable: st.separable, resistance: st.res, published: !!b.parts };
    if (!had) { b._tw = null; touched.delete(b); }
    return r;
  };
  // the EF/damage tables, for tools and the HUD
  T.EF = EF; T.DOD = DOD; T.TREE = TREE;
})();
