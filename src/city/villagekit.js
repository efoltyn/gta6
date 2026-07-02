/* ============================================================
   city/villagekit.js — Stage X, step X5: THE VILLAGE HUT/SHACK KIT.

   WHY THIS EXISTS (owner's why-first law): countries.js (X3) shipped
   kesh/mbeya's "village" settlements as small low-rise clones of the
   farm-county template (harvestmarket) — every comment in that file
   flags the spot with "X5 upgrades this to the real village/hut kit".
   A poor rural settlement built from the SAME glass-office box shells
   as a finance district reads wrong: a village needs mud-brick
   rondavels, adobe huts, corrugated lean-tos, a well, a market stall —
   NOT a shrunken downtown. This file is that kit.

   ── FINDING (read towngen.js/assets.js/placement.js before editing
   anything downstream of this comment) ──────────────────────────────
   towngen.js's per-lot FILL step supports two prefab shapes:
     { name, storeys, color, shopKind, lotKind, opts }  → cityMakeBuilding
       (the "isBuilding" path: a real, ENTERABLE glass/office shell —
       every existing citytemplates.js recipe uses ONLY this path, and
       cityMakeBuilding always normalizes facade to "retail"/"office"
       (buildings.js:1896 exterminates "residential"/"fortified"), so
       there is NO way to make this shell look like a hut. It is,
       however, the ONLY path that registers a lot into the arena
       (A.lots/shopLots) and stamps shop.kind/vendorSpot — i.e. the
       ONLY path an economy/vendor can attach to.
     { asset, scale }                                    → CBZ.assets
       a NON-standard structure: any CBZ.assets.define()'d prefab (see
       assets.js's contract) gets built via its own build(ctx) — this
       is the hut path. It is NEVER used by an existing recipe today
       (grep citytemplates.js: zero `asset:` prefab entries), and it
       turned out to be BROKEN for exactly this use: towngen's step 3
       (LOTS) reserves every subdivided lot's full rect with
       CBZ.placement BEFORE step 4 (FILL) ever runs, so an asset
       prefab routed through P.placeAsset() self-conflicts with its
       OWN lot's reservation (every candidate point, including the lot
       centre, reads as already-occupied) and silently places nothing,
       every time. Fixed in towngen.js (see the comment there, same
       X5 pass): the asset branch now builds directly (real geometry +
       a real collider), mirroring what placeAsset would have done
       minus the redundant occupancy re-check — the lot is, by
       construction (non-overlapping recursive subdivision), already
       this prop's exclusive ground.
   Consequence for this file's design: huts/well/market-stall are
   `asset` prefabs (real non-standard geometry, real colliders, NO
   economy attach — decoration); the one prefab that must carry the
   village's economy (a food vendor) stays a `name/shopKind` BUILDING
   entry so shops.js/vendor-staffing/Zillow see it — it just LOOKS
   like every other small shop shell in the game (earthy-tinted), the
   same tradeoff every existing citytemplates.js recipe already makes.

   ── ZONE FINDING (small grids) ───────────────────────────────────────
   towngen's zoneForRing() buckets a lot's ring into civic/commercial/
   residential — but a 2x2 grid (today's kesh_north/kesh_east/mbeya_*
   village footprint) produces ONE constant ring value for every
   buildable lot (the square eats the true centre), which always
   resolves to "commercial" by the DEFAULT rule. A `cfg.zoning` override
   array can't fix this either: zoneForRing indexes it by the RAW
   (often fractional, for even grids) ring number, so anything but a
   1-length override silently falls through to the same default. Rather
   than depend on grid dimensions lining up with towngen's ring math
   (fragile, and NOT ours to retune — countries.js pins cols/rows per
   settlement), every zone key below carries the SAME full village mix.
   Whichever zone a given grid's ring math actually selects, the result
   reads as the same village: mostly huts, a well/stall here and there,
   an occasional food stall keeping the lights on.

   API: CBZ.CITY_TEMPLATES.village (consumed via CBZ.cityTemplate/
   countrySettlementTemplate, same as every other recipe) and the
   convenience CBZ.villageTemplate(overrides).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const cmat = CBZ.cmat || CBZ.mat || function (c) { return new THREE.MeshLambertMaterial({ color: c }); };
  if (!CBZ.assets || typeof CBZ.assets.define !== "function") return;   // needs assets.js
  if (CBZ.assets.has("hut_round")) return;                              // idempotent (re-load safety)

  // ---- earth-tone palettes (rng-picked per placement for variety; the
  //      shared instanceable geom()/material() pair below bakes ONE flat
  //      tone per part — see the "INSTANCING" note further down). --------
  const MUD    = [0xab7f4e, 0x9c7245, 0xb98c58, 0x8f6a42];
  const ADOBE  = [0xc9a97a, 0xbd9a6c, 0xd1ab7e];
  const THATCH = [0xcaa956, 0xb08a45, 0xc2984e];
  const CORR   = [0x8a8a86, 0x9c6b4a, 0x7a4f34, 0x8f8f89];   // rusted/corrugated roof tones
  const WOODW  = [0x6b5d4a, 0x5f5340, 0x77664e];             // weathered shack timber
  const STONE  = 0x9a8d72;
  const WELLWOOD = 0x6e5132;
  const CANOPY = [0xc23b3b, 0xb5542a, 0xcf6a2e, 0xd8a23a];   // bright market-stall fabric

  function pick(arr, r) { return arr[(r() * arr.length) | 0]; }

  // ============================================================
  //  ASSETS — real geometry, real colliders, modest poly counts, all
  //  build(ctx) deterministic off ctx.rng (owner rule #5 — no
  //  Math.random in a build path). Footprints sized 3-5m, matching a
  //  real rural hut/shack/stall — not a full building lot.
  // ============================================================

  // hut_round — the classic rondavel: cylinder mud-brick wall + cone
  // thatch roof. ~4m footprint.
  CBZ.assets.define("hut_round", {
    footprint: { hx: 2.1, hz: 2.1 }, clearance: 0.4, y1: 4.3, zone: "village",
    instanceable: true,
    geom: function () {
      const wallH = 2.3, roofH = 1.7;
      const wall = new THREE.CylinderGeometry(1.55, 1.8, wallH, 10); wall.translate(0, wallH / 2, 0);
      const roof = new THREE.ConeGeometry(2.15, roofH, 10); roof.translate(0, wallH + roofH / 2 - 0.05, 0);
      return paintMerge([{ geo: wall, color: MUD[0] }, { geo: roof, color: THATCH[0] }]);
    },
    material: function () { return vcMat(); },
    build: function (ctx) {
      const r = ctx.rng || Math.random, s = ctx.scale || 1, g = ctx.group;
      const wallH = 2.3 * s;
      const wall = new THREE.Mesh(new THREE.CylinderGeometry(1.55 * s, 1.8 * s, wallH, 10), cmat(pick(MUD, r)));
      wall.position.y = wallH / 2; wall.castShadow = true; wall.receiveShadow = true; g.add(wall);
      const roofH = 1.7 * s;
      const roof = new THREE.Mesh(new THREE.ConeGeometry(2.15 * s, roofH, 10), cmat(pick(THATCH, r)));
      roof.position.y = wallH + roofH / 2 - 0.05; roof.castShadow = true; g.add(roof);
    },
  });

  // hut_square — small adobe box + a slight-overhang flat/corrugated
  // slab roof (rusted tint). ~3.8m footprint.
  CBZ.assets.define("hut_square", {
    footprint: { hx: 2.0, hz: 2.0 }, clearance: 0.4, y1: 2.6, zone: "village",
    instanceable: true,
    geom: function () {
      const wall = new THREE.BoxGeometry(3.3, 2.1, 3.3); wall.translate(0, 1.05, 0);
      const roof = new THREE.BoxGeometry(3.8, 0.22, 3.8); roof.translate(0, 2.1 + 0.11, 0);
      return paintMerge([{ geo: wall, color: ADOBE[0] }, { geo: roof, color: CORR[0] }]);
    },
    material: function () { return vcMat(); },
    build: function (ctx) {
      const r = ctx.rng || Math.random, s = ctx.scale || 1, g = ctx.group;
      const wallH = 2.1 * s;
      const wall = new THREE.Mesh(new THREE.BoxGeometry(3.3 * s, wallH, 3.3 * s), cmat(pick(ADOBE, r)));
      wall.position.y = wallH / 2; wall.castShadow = true; wall.receiveShadow = true; g.add(wall);
      const roof = new THREE.Mesh(new THREE.BoxGeometry(3.8 * s, 0.22 * s, 3.8 * s), cmat(pick(CORR, r)));
      roof.position.y = wallH + 0.11 * s; roof.castShadow = true; g.add(roof);
    },
  });

  // shack_lean — a lean-to shack: box + single-slope corrugated roof.
  // ~3.4m footprint.
  CBZ.assets.define("shack_lean", {
    footprint: { hx: 1.8, hz: 1.8 }, clearance: 0.35, y1: 2.5, zone: "village",
    instanceable: true,
    geom: function () {
      const wall = new THREE.BoxGeometry(3.0, 2.0, 3.0); wall.translate(0, 1.0, 0);
      const roof = new THREE.BoxGeometry(3.4, 0.16, 3.4); roof.rotateX(0.16); roof.translate(0, 2.15, 0);
      return paintMerge([{ geo: wall, color: WOODW[0] }, { geo: roof, color: CORR[1] }]);
    },
    material: function () { return vcMat(); },
    build: function (ctx) {
      const r = ctx.rng || Math.random, s = ctx.scale || 1, g = ctx.group;
      const wallH = 2.0 * s;
      const wall = new THREE.Mesh(new THREE.BoxGeometry(3.0 * s, wallH, 3.0 * s), cmat(pick(WOODW, r)));
      wall.position.y = wallH / 2; wall.castShadow = true; wall.receiveShadow = true; g.add(wall);
      // single-slope (lean-to) roof: tilt one axis so it reads high-to-low.
      const roof = new THREE.Mesh(new THREE.BoxGeometry(3.4 * s, 0.16 * s, 3.4 * s), cmat(pick(CORR, r)));
      roof.position.y = wallH + 0.15 * s; roof.rotation.x = 0.16; roof.castShadow = true; g.add(roof);
    },
  });

  // well — low stone ring + two posts + a crossbar. ~2m footprint (a
  // village utility piece, not a full hut).
  CBZ.assets.define("well", {
    footprint: { hx: 1.1, hz: 1.1 }, clearance: 0.3, y1: 1.9, zone: "village",
    instanceable: true,
    geom: function () {
      const ring = new THREE.CylinderGeometry(0.95, 1.05, 0.85, 12); ring.translate(0, 0.425, 0);
      const post1 = new THREE.BoxGeometry(0.12, 1.5, 0.12); post1.translate(-0.65, 0.425 + 0.75, 0);
      const post2 = new THREE.BoxGeometry(0.12, 1.5, 0.12); post2.translate(0.65, 0.425 + 0.75, 0);
      const bar = new THREE.BoxGeometry(1.5, 0.12, 0.12); bar.translate(0, 0.425 + 1.44, 0);
      return paintMerge([{ geo: ring, color: STONE }, { geo: post1, color: WELLWOOD }, { geo: post2, color: WELLWOOD }, { geo: bar, color: WELLWOOD }]);
    },
    material: function () { return vcMat(); },
    build: function (ctx) {
      const s = ctx.scale || 1, g = ctx.group;
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.95 * s, 1.05 * s, 0.85 * s, 12), cmat(STONE));
      ring.position.y = 0.425 * s; ring.castShadow = true; ring.receiveShadow = true; g.add(ring);
      const wood = cmat(WELLWOOD);
      const post1 = new THREE.Mesh(new THREE.BoxGeometry(0.12 * s, 1.5 * s, 0.12 * s), wood);
      post1.position.set(-0.65 * s, 0.425 * s + 0.75 * s, 0); post1.castShadow = true; g.add(post1);
      const post2 = new THREE.Mesh(new THREE.BoxGeometry(0.12 * s, 1.5 * s, 0.12 * s), wood);
      post2.position.set(0.65 * s, 0.425 * s + 0.75 * s, 0); post2.castShadow = true; g.add(post2);
      const bar = new THREE.Mesh(new THREE.BoxGeometry(1.5 * s, 0.12 * s, 0.12 * s), wood);
      bar.position.y = 0.425 * s + 1.44 * s; bar.castShadow = true; g.add(bar);
    },
  });

  // stall_market — 4 posts + a bright fabric canopy: the village market.
  // ~3.4m footprint.
  CBZ.assets.define("stall_market", {
    footprint: { hx: 1.7, hz: 1.7 }, clearance: 0.35, y1: 2.2, zone: "village",
    instanceable: true,
    geom: function () {
      const parts = [];
      for (const [px, pz] of [[-1.3, -1.3], [1.3, -1.3], [-1.3, 1.3], [1.3, 1.3]]) {
        const post = new THREE.BoxGeometry(0.12, 2.0, 0.12); post.translate(px, 1.0, pz);
        parts.push({ geo: post, color: WELLWOOD });
      }
      const canopy = new THREE.BoxGeometry(3.0, 0.14, 3.0); canopy.translate(0, 2.07, 0);
      parts.push({ geo: canopy, color: CANOPY[0] });
      return paintMerge(parts);
    },
    material: function () { return vcMat(); },
    build: function (ctx) {
      const r = ctx.rng || Math.random, s = ctx.scale || 1, g = ctx.group;
      const wood = cmat(WELLWOOD);
      for (const [px, pz] of [[-1.3, -1.3], [1.3, -1.3], [-1.3, 1.3], [1.3, 1.3]]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.12 * s, 2.0 * s, 0.12 * s), wood);
        post.position.set(px * s, 1.0 * s, pz * s); post.castShadow = true; g.add(post);
      }
      const canopy = new THREE.Mesh(new THREE.BoxGeometry(3.0 * s, 0.14 * s, 3.0 * s), cmat(pick(CANOPY, r)));
      canopy.position.y = 2.07 * s; canopy.castShadow = true; g.add(canopy);
    },
  });

  // ---- INSTANCING NOTE ------------------------------------------------
  // "instanceable where possible": CBZ.assets.pool()'s FAST path (a single
  // shared InstancedMesh — the real draw-call win) requires ONE geometry +
  // ONE material per def; every hut/well/stall here is naturally 2+ parts
  // (wall+roof, ring+posts+bar, posts+canopy) in 2+ tones. geom()/material()
  // above satisfy the fast path by MERGING those parts into one
  // vertex-coloured BufferGeometry (paintMerge, below) behind ONE shared
  // MeshLambertMaterial({vertexColors:true}) — a real single mesh, single
  // draw call, eligible for CBZ.assets.pool()/scatter() if a future biome
  // pass wants to Poisson-scatter these (uniform baked tone, no per-instance
  // rng variety — that trade only applies to the pool path).
  // build(ctx) — what towngen's village prefab fill (and any direct
  // placeAsset caller) ACTUALLY uses today — stays per-instance groups so
  // each hut still rolls its own colour off ctx.rng (the variety a real
  // village reads with). Neither path is dead: pool()/scatter() readers get
  // the fast geometry; per-lot village fill gets the varied one.
  const BGU = THREE.BufferGeometryUtils;
  function paintGeo(geo, hex) {
    const col = new THREE.Color(hex);
    const n = (geo.attributes && geo.attributes.position && geo.attributes.position.count) || 0;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { arr[i * 3] = col.r; arr[i * 3 + 1] = col.g; arr[i * 3 + 2] = col.b; }
    geo.setAttribute("color", new THREE.BufferAttribute(arr, 3));
    return geo;
  }
  function paintMerge(parts) {
    const geoms = parts.map(function (p) { return paintGeo(p.geo, p.color); });
    if (BGU && typeof BGU.mergeBufferGeometries === "function") {
      try { return BGU.mergeBufferGeometries(geoms); } catch (e) { /* fall through */ }
    }
    return geoms[0];   // defensive fallback — BGU is always vendored (index.html), never hit live
  }
  function vcMat() { return new THREE.MeshLambertMaterial({ vertexColors: true }); }

  // ============================================================
  //  VILLAGE TEMPLATE — a CBZ.CITY_TEMPLATES entry, same shape every
  //  other citytemplates.js recipe uses (id/name/pattern/density/cols/
  //  rows/block*/roadW/palette/skyline/squarePrefab/prefabs), so
  //  countries.js's existing countrySettlementTemplate() clone-and-
  //  wealth-scale pipeline (CBZ.cityTemplate(id)) picks it up with ZERO
  //  new plumbing — a village settlement just points baseTemplate at
  //  "village" instead of "harvestmarket".
  // ============================================================
  const RET = { retail: true };

  // civic: the well + a market stall (decorative asset props — real
  // colliders, no economy attach; see the file-header FINDING).
  const CIVIC_ITEMS = [
    { asset: "well", w: 2 },
    { asset: "stall_market", w: 2 },
  ];
  // commercial: another market stall (decor) + the ONE building prefab
  // that carries real economy — a small food vendor shopfront (shop.kind
  // 'food' so shops.js/vendor-staffing/Zillow attach exactly like every
  // other citytemplates.js shop entry).
  const COMMERCIAL_ITEMS = [
    { asset: "stall_market", w: 3 },
    { name: "VILLAGE MARKET", storeys: 1, color: 0xa3653a, shopKind: "food", opts: RET, lotKind: "shop", w: 2 },
  ];
  // residential: mostly huts — hut_round the common home (double weight),
  // hut_square and shack_lean filling the rest.
  const RESIDENTIAL_ITEMS = [
    { asset: "hut_round", w: 6 },
    { asset: "hut_square", w: 3 },
    { asset: "shack_lean", w: 3 },
  ];
  // VILLAGE_MIX — see the file-header ZONE FINDING: a small (2x2-ish)
  // village grid's ring math resolves every buildable lot to ONE zone
  // key (usually "commercial"), so every key below carries the SAME full
  // mix rather than betting on ring math lining up with grid dimensions.
  const VILLAGE_MIX = CIVIC_ITEMS.concat(COMMERCIAL_ITEMS, RESIDENTIAL_ITEMS);

  CBZ.CITY_TEMPLATES = CBZ.CITY_TEMPLATES || {};
  CBZ.CITY_TEMPLATES.village = {
    id: "village", name: "Village", subtitle: "Rural Settlement", biome: "village",
    pattern: "organic", density: 0.8, cols: 2, rows: 2, blockW: 34, blockD: 30, roadW: 10,
    minFrontage: 9, minLotArea: 90, squarePrefab: "well",
    // dirt palette: sidewalk == ground so towngen's sidewalk slab reads as
    // continuous swept dirt, not a paved curb (towngen has no explicit
    // "no sidewalks" flag — matching the colour is the honest workaround).
    palette: {
      ground: 0x8a6b45, sidewalk: 0x8a6b45, road: 0x6b5236, line: 0x8a6b45,
      wood: 0x6b5d4a, accent: 0x8a5a3a, stone: 0x9a8d72, sign: "#f4e7c2",
      signBoard: 0x2a2015, plaza: 0x8a6b45, lamp: 0xd9b46a,
    },
    skyline: { minStoreys: 1, maxStoreys: 1, towerFrac: 0, megaChance: false, townMax: 1 },
    prefabs: { civic: VILLAGE_MIX, commercial: VILLAGE_MIX, residential: VILLAGE_MIX, default: VILLAGE_MIX },
  };

  // convenience mirroring CBZ.cityTemplate's clone-with-overrides contract.
  CBZ.villageTemplate = function (over) {
    return CBZ.cityTemplate ? CBZ.cityTemplate("village", over) : null;
  };
})();
