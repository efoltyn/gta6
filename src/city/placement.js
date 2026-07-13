/* ============================================================
   city/placement.js — THE OCCUPANCY / ANTI-OVERLAP LAYER (CBZ.placement).

   A uniform-grid SPATIAL HASH of reserved footprint AABBs. It lets a
   world generator ask "is this spot free?" cheaply, find a free spot near
   a target (spiral search), and Poisson-scatter props that dodge both the
   hand-built world AND each other — all DETERMINISTICALLY (caller's rng).

   This is NEW INFRASTRUCTURE and a NO-OP until adopted: nothing runs at
   load. The town-generator agent drives it.

   ── DESIGN ───────────────────────────────────────────────────
   • Spatial hash: cell = 8m. An AABB is hashed into every cell it
     overlaps; isFree() / reserve() touch ONLY those cells (not the world).
   • test-then-build: isFree() runs on PLAIN rects (no geometry). Geometry
     is built by placeAsset() ONLY after a free spot is found.
   • reserve INFLATED (footprint + clearance) so props keep a gap; the
     COLLIDER pushed to CBZ.colliders is UN-inflated (true geometry size).
   • stackable rects may overlap other stackable rects (signs, awnings).
   • zones: opts.zoneOnly → conflicts only count within the same zone tag.

   ── Y RANGE (F5) ─────────────────────────────────────────────
   • rects MAY carry minY/maxY (a vertical band) alongside the XZ footprint.
     A rect that omits them is treated as FULL-HEIGHT: overlaps() defaults
     a missing minY to -Infinity and a missing maxY to +Infinity, so a
     legacy XZ-only rect still blocks the entire vertical column — every
     call site that predates F5 passes XZ-only rects, so this is a NO-OP
     for existing behaviour (byte-identical).
   • intended users: systems/pieces.js and the building systems (player
     building, town-generator multi-storey lots, etc.) that need to stack
     things at different heights on the same XZ footprint without the
     lower piece blocking the upper one.

   ── API ──────────────────────────────────────────────────────
   reset()
   isFree(rect, opts) → bool         rect={minX,maxX,minZ,maxZ,minY,maxY,stackable,zone}
                                      (minY/maxY optional — default full-height)
   reserve(rect)
   placeAsset(name, near{x,z}, opts) → {group,x,z,rot,rect} | null
   scatter(name, regionRect, minDist, opts) → placed[]
   seedFromColliders()
   debugDraw(parent)
   ============================================================ */
(function () {
  'use strict';
  var THREE = window.THREE;
  var CBZ = (window.CBZ = window.CBZ || {});
  if (CBZ.placement) return;

  var CELL = 8;                                  // spatial-hash cell, metres
  var P = (CBZ.placement = {});

  // hash: "ix,iz" → array of reserved rects.
  var hash = {};
  // Canonical reservation list. The spatial hash stores the same rectangle in
  // every touched cell, which is ideal for collision queries but unusable for
  // diagnostics (a large runway can appear hundreds of times). Keep each
  // reservation exactly once so the world-audit tool can inspect the real
  // placement plan without reverse-engineering hash buckets.
  var reservations = [];
  // seedFromColliders() is called by several independently-authored biome
  // builders.  Re-inserting the same collider every time made the hash grow
  // with duplicate rectangles and, more importantly, meant generator order
  // changed the amount of work a later placement had to do.  Track the actual
  // collider objects so seeding is idempotent until an explicit reset.
  var seededColliders = new WeakSet();
  function ck(ix, iz) { return ix + ',' + iz; }
  function ci(v) { return Math.floor(v / CELL); }

  P.cellSize = CELL;

  P.reset = function () {
    hash = {};
    reservations = [];
    seededColliders = new WeakSet();
  };

  // Iterate every cell an AABB overlaps, calling fn(key). Returns early if
  // fn returns true (used for short-circuit overlap tests).
  function forCells(rect, fn) {
    var x0 = ci(rect.minX), x1 = ci(rect.maxX);
    var z0 = ci(rect.minZ), z1 = ci(rect.maxZ);
    for (var ix = x0; ix <= x1; ix++)
      for (var iz = z0; iz <= z1; iz++)
        if (fn(ck(ix, iz)) === true) return true;
    return false;
  }

  function overlaps(a, b) {
    if (!(a.minX < b.maxX && a.maxX > b.minX &&
          a.minZ < b.maxZ && a.maxZ > b.minZ)) return false;
    // F5: Y test. Missing minY/maxY default to -Infinity/+Infinity — a
    // legacy full-height rect always overlaps another full-height rect
    // vertically, so every pre-F5 caller (none of which set minY/maxY)
    // sees IDENTICAL results to before this test existed. Defaults are
    // computed inline (no mutation of the caller's rect objects).
    var aMinY = a.minY != null ? a.minY : -Infinity;
    var aMaxY = a.maxY != null ? a.maxY : Infinity;
    var bMinY = b.minY != null ? b.minY : -Infinity;
    var bMaxY = b.maxY != null ? b.maxY : Infinity;
    return aMinY < bMaxY && aMaxY > bMinY;
  }

  /* ---- isFree -------------------------------------------------- */
  P.isFree = function (rect, opts) {
    opts = opts || {};
    var stackable = !!rect.stackable;
    var zoneOnly = !!opts.zoneOnly;
    var zone = rect.zone || null;
    return !forCells(rect, function (key) {
      var bucket = hash[key];
      if (!bucket) return false;
      for (var i = 0; i < bucket.length; i++) {
        var r = bucket[i];
        // two stackables may share space. This unconditional allow is
        // still correct under F5's Y test, in every case:
        //  - either side lacks a Y range → legacy full-height rects, works
        //    exactly as it did before F5 (unchanged behaviour).
        //  - both sides have a Y range and they're Y-DISJOINT → they were
        //    never going to conflict anyway (overlaps()'s Y test below
        //    would say so too), so skipping here changes nothing.
        //  - both sides have a Y range and they OVERLAP in Y → this is the
        //    case the stackable escape hatch exists for (e.g. two signs on
        //    the same wall band) — keep allowing it.
        // So `continue` unconditionally is the right call in all three
        // sub-cases; nothing here needs to consult minY/maxY directly.
        if (stackable && r.stackable) continue;
        // zone-scoped test: ignore rects in other zones.
        if (zoneOnly && zone != null && r.zone != null && r.zone !== zone) continue;
        if (!overlaps(rect, r)) continue;
        // de-dupe (same rect can appear in several cells) — irrelevant for
        // a positive hit, so just report conflict.
        return true;                             // CONFLICT
      }
      return false;
    });
  };

  /* ---- reserve ------------------------------------------------- */
  P.reserve = function (rect) {
    var r = {
      minX: rect.minX, maxX: rect.maxX, minZ: rect.minZ, maxZ: rect.maxZ,
      minY: rect.minY, maxY: rect.maxY,              // F5: optional Y band, passed through as-is (undefined if absent — overlaps() defaults it)
      stackable: !!rect.stackable, zone: rect.zone || null, ref: rect.ref || null,
      id: rect.id || null, kind: rect.kind || null, source: rect.source || null
    };
    reservations.push(r);
    forCells(r, function (key) { (hash[key] || (hash[key] = [])).push(r); });
    return r;
  };

  // Read-only, serialisable placement snapshot for tools. References are
  // represented by a useful name only; callers cannot mutate the live hash.
  P.snapshot = function () {
    return reservations.map(function (r) {
      return {
        minX: r.minX, maxX: r.maxX, minZ: r.minZ, maxZ: r.maxZ,
        minY: r.minY, maxY: r.maxY, stackable: r.stackable,
        zone: r.zone, id: r.id, kind: r.kind, source: r.source,
        refName: r.ref && (r.ref.name || (r.ref.constructor && r.ref.constructor.name)) || null
      };
    });
  };

  /* ---- seedFromColliders --------------------------------------
     Reserve the current static colliders so a later-built town dodges the
     hand-built world. Call ONCE after static colliders exist.            */
  P.seedFromColliders = function () {
    var cols = CBZ.colliders;
    if (!cols || !cols.length) return 0;
    var n = 0;
    for (var i = 0; i < cols.length; i++) {
      var c = cols[i];
      if (c.minX == null || seededColliders.has(c)) continue;
      P.reserve({ minX: c.minX, maxX: c.maxX, minZ: c.minZ, maxZ: c.maxZ,
                  stackable: false, zone: 'world', ref: c });
      seededColliders.add(c);
      n++;
    }
    return n;
  };

  /* ---- placeAsset --------------------------------------------- *
     Spiral-search up to opts.tries spots around `near`, deterministic via
     opts.rng. First free spot → build geometry, reserve INFLATED footprint,
     push UN-inflated collider, return result. No free spot → null.       */
  P.placeAsset = function (name, near, opts) {
    opts = opts || {};
    var def = CBZ.assets && CBZ.assets.get(name);
    if (!def) { console.warn('[placement] unknown asset:', name); return null; }
    var rng = opts.rng || Math.random;
    var parent = opts.parent || null;
    var tries = opts.tries || 24;
    var spread = opts.spread == null ? 6 : opts.spread;
    var scale = opts.scale || 1;
    var snap = opts.snapRot || 0;                 // e.g. Math.PI/2 to grid-align
    var zone = opts.zone || def.zone || null;
    var cx = near.x, cz = near.z;

    // golden-angle spiral so candidates fan out evenly & deterministically.
    var GA = 2.39996323;
    for (var t = 0; t < tries; t++) {
      var x, z, rot;
      if (t === 0) { x = cx; z = cz; }
      else {
        var rad = spread * Math.sqrt(t / tries) + spread * 0.15 * rng();
        var ang = t * GA + rng() * 0.4;
        x = cx + Math.cos(ang) * rad;
        z = cz + Math.sin(ang) * rad;
      }
      rot = opts.rot != null ? opts.rot : rng() * Math.PI * 2;
      if (snap) rot = Math.round(rot / snap) * snap;

      var fp = CBZ.assets.rotatedFootprint(def, rot);
      var clr = (def.clearance || 0) + (opts.clearance || 0);
      var ihx = fp.hx + clr, ihz = fp.hz + clr;     // inflated (reserve)
      var rect = { minX: x - ihx, maxX: x + ihx, minZ: z - ihz, maxZ: z + ihz,
                   stackable: def.stackable, zone: zone };

      if (!P.isFree(rect, { zoneOnly: !!opts.zoneOnly })) continue;

      // BUILD geometry only now.
      var group = new THREE.Group();
      def.build({ group: group, x: x, z: z, rot: rot, rng: rng, scale: scale });
      group.position.set(x, def.y0 || 0, z);
      group.rotation.y = rot;
      group.scale.set(scale, scale, scale);
      group.updateMatrix();
      group.matrixAutoUpdate = false;
      if (parent) parent.add(group);

      P.reserve(rect);

      // UN-inflated collider (true footprint), unless footprint-only def.
      if (!def.noCollide && CBZ.colliders) {
        CBZ.colliders.push({
          minX: x - fp.hx, maxX: x + fp.hx, minZ: z - fp.hz, maxZ: z + fp.hz,
          y0: def.y0 || 0, y1: def.y1 == null ? 30 : def.y1, ref: group
        });
        if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
      }
      return { group: group, x: x, z: z, rot: rot, rect: rect };
    }
    return null;                                  // no room → caller skips
  };

  /* ---- scatter (Bridson Poisson-disk) ------------------------- *
     Poisson-disk sample over regionRect with min spacing minDist, seeded
     so points dodge ALREADY-RESERVED footprints AND each other. Accepted
     points route into the asset's InstancedMesh pool (≈1 draw call).
     Deterministic via opts.rng.                                          */
  P.scatter = function (name, region, minDist, opts) {
    opts = opts || {};
    var def = CBZ.assets && CBZ.assets.get(name);
    if (!def) { console.warn('[placement] unknown asset:', name); return []; }
    var rng = opts.rng || Math.random;
    var parent = opts.parent || null;
    var k = opts.k || 20;                          // candidate attempts/point
    var maxN = opts.max || 100000;
    var minD = Math.max(0.5, minDist || 2);

    var W = region.maxX - region.minX, H = region.maxZ - region.minZ;
    if (W <= 0 || H <= 0) return [];

    // Background grid: cell = minD/√2 so each cell holds ≤1 sample.
    var gcell = minD / Math.SQRT2;
    var gw = Math.max(1, Math.ceil(W / gcell));
    var gh = Math.max(1, Math.ceil(H / gcell));
    var grid = new Array(gw * gh);                 // index → point or undefined
    function gx(px) { return Math.min(gw - 1, Math.max(0, Math.floor((px - region.minX) / gcell))); }
    function gz(pz) { return Math.min(gh - 1, Math.max(0, Math.floor((pz - region.minZ) / gcell))); }

    // Does a candidate point clash with nearby accepted points (grid) OR
    // the reserved-footprint hash (buildings)? Returns false if clashing.
    var fp = def.footprint;
    var clr = (def.clearance || 0) + (opts.clearance || 0);
    var phx = fp.hx + clr, phz = fp.hz + clr;
    function ok(px, pz) {
      var cgx = gx(px), cgz = gz(pz), i, j;
      for (i = cgx - 2; i <= cgx + 2; i++) {
        if (i < 0 || i >= gw) continue;
        for (j = cgz - 2; j <= cgz + 2; j++) {
          if (j < 0 || j >= gh) continue;
          var p = grid[i + j * gw];
          if (!p) continue;
          var dx = p.x - px, dz = p.z - pz;
          if (dx * dx + dz * dz < minD * minD) return false;
        }
      }
      // Dodge buildings / existing reservations (footprint-sized probe).
      var rect = { minX: px - phx, maxX: px + phx, minZ: pz - phz, maxZ: pz + phz,
                   stackable: def.stackable, zone: opts.zone || def.zone || null };
      if (!P.isFree(rect, { zoneOnly: !!opts.zoneOnly })) return false;
      return true;
    }

    var active = [];
    var placed = [];
    var pool = CBZ.assets.pool(name, Math.min(maxN, gw * gh) + 16);
    if (pool.group && parent && !pool.group.parent) parent.add(pool.group);
    if (pool.mesh && parent && !pool.mesh.parent) parent.add(pool.mesh);

    function emit(px, pz) {
      grid[gx(px) + gz(pz) * gw] = { x: px, z: pz };
      var rot = opts.rot != null ? opts.rot : rng() * Math.PI * 2;
      var scl = opts.scale ? (typeof opts.scale === 'function' ? opts.scale(rng) : opts.scale)
                           : (opts.scaleMin ? opts.scaleMin + rng() * ((opts.scaleMax || opts.scaleMin) - opts.scaleMin) : 1);
      pool.add(px, pz, rot, scl);
      // Reserve so subsequent placeAsset/scatter calls also dodge these,
      // and (for solid scatter) drop a collider.
      var rfp = CBZ.assets.rotatedFootprint(def, rot);
      P.reserve({ minX: px - rfp.hx - clr, maxX: px + rfp.hx + clr,
                  minZ: pz - rfp.hz - clr, maxZ: pz + rfp.hz + clr,
                  stackable: def.stackable, zone: opts.zone || def.zone || null });
      if (!def.noCollide && CBZ.colliders) {
        CBZ.colliders.push({ minX: px - rfp.hx, maxX: px + rfp.hx,
                             minZ: pz - rfp.hz, maxZ: pz + rfp.hz,
                             y0: def.y0 || 0, y1: def.y1 == null ? 30 : def.y1 });
      }
      placed.push({ x: px, z: pz, rot: rot, scale: scl });
    }

    // Seed point — try a few starts so a crowded region still gets going.
    var seeded = false;
    for (var s = 0; s < 30 && !seeded; s++) {
      var sx = region.minX + rng() * W, sz = region.minZ + rng() * H;
      if (ok(sx, sz)) { emit(sx, sz); active.push({ x: sx, z: sz }); seeded = true; }
    }
    if (!seeded) return placed;

    while (active.length && placed.length < maxN) {
      var ai = (rng() * active.length) | 0;
      var a = active[ai];
      var found = false;
      for (var c = 0; c < k; c++) {
        var ang = rng() * Math.PI * 2;
        var r = minD + rng() * minD;              // ring [minD, 2*minD)
        var nx = a.x + Math.cos(ang) * r;
        var nz = a.z + Math.sin(ang) * r;
        if (nx < region.minX || nx > region.maxX || nz < region.minZ || nz > region.maxZ) continue;
        if (!ok(nx, nz)) continue;
        emit(nx, nz); active.push({ x: nx, z: nz }); found = true; break;
      }
      if (!found) active.splice(ai, 1);
    }
    if (!def.noCollide && placed.length && CBZ.markCollidersDirty) CBZ.markCollidersDirty();
    return placed;
  };

  /* ---- worldLayout -------------------------------------------------
     The old world generators had their own local keep-out rules: a forest
     knew about its lake, a desert knew about its town, but neither knew about
     roads, buildings, or another generator's claimed space.  This small layer
     gives all of them one authoritative reservation path on top of the same
     placement hash used by player construction.

     It deliberately reserves *features*, never an entire biome floor.  Land
     may contain nature; a road, town square, runway, lodge, or trail may not.
     `claimNature` also reserves accepted trunks/rocks so independently-built
     scatter passes cannot land on top of one another later in world build.
  ------------------------------------------------------------------- */
  var L = CBZ.worldLayout || (CBZ.worldLayout = {});
  var layoutIds = {};
  var layoutEntries = [];

  // ── MAP-LEVEL RESERVATION LEDGER (MAP_RESERVE_V1) ─────────────────
  // A SECOND, deliberately-separate ledger from the prop hash above. It records
  // the TRUE footprint of every hand-authored *landmass* (a biome floor, its
  // feather skirt, a mountain massif, an island POI) so the world build can
  // answer "do two peer landmasses interpenetrate?" — the overlap the owner
  // complained about. It is intentionally NOT wired into isFree()/scatter(): a
  // whole biome floor must never block that biome's own trees/props, so the map
  // ledger only feeds mapAudit()/mapConflict() and never the placement hash.
  // Result: adopting it is byte-identical for worldgen (pure bookkeeping).
  var mapEntries = [];
  // The fixed, constant-placed landmasses this guard governs. Procedural land
  // (countries/settlements/mini-cities that legitimately NEST inside a parent
  // country region, and the continent "wilds" underlay that overlaps everything
  // by design) is excluded — it manages its own spacing via CBZ.placement.
  var MAP_PEERS = { farmland: 1, desert: 1, forest: 1, snow: 1,
                    arena: 1, speedway: 1, airport: 1, military: 1 };
  function mapArea(r) { return Math.max(0, r.maxX - r.minX) * Math.max(0, r.maxZ - r.minZ); }
  function mapOverlapArea(a, b) {
    var ox = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
    var oz = Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ);
    return (ox > 0 && oz > 0) ? ox * oz : 0;
  }

  function copyRect(rect, extra) {
    var out = {
      minX: rect.minX, maxX: rect.maxX,
      minZ: rect.minZ, maxZ: rect.maxZ,
      minY: rect.minY, maxY: rect.maxY,
      stackable: false,
      zone: (extra && extra.zone) || rect.zone || 'world'
    };
    if (extra && extra.ref) out.ref = extra.ref;
    return out;
  }

  L.reset = function () { layoutIds = {}; layoutEntries = []; mapEntries = []; };

  /* ---- map-level landmass reservation + overlap audit ------------- *
     mapReserve(id, rect, opts): record a landmass footprint. opts.owner groups
       all layers of ONE feature (region + skirt + massif share an owner so they
       never flag against each other); opts.kind is descriptive ("region",
       "terrain", "massif"); opts.underlay marks intentional-overlap underlays.
     mapConflict(rect, opts): does `rect` (owner opts.owner) interpenetrate a
       DIFFERENT peer landmass beyond opts.minContain? Returns {entry,contain} or
       null — the query a future POI/biome placer runs before committing.
     mapAudit(): every peer-vs-peer interpenetration, ranked by containment of
       the smaller footprint (the metric the world-audit tool uses). Same-owner
       layers, non-peers and underlays are skipped, so legitimate nesting
       (country ⊃ settlement, skirt over own floor) never appears.            */
  L.mapReserve = function (id, rect, opts) {
    if (!rect || rect.minX == null || rect.maxX == null || rect.minZ == null || rect.maxZ == null) return null;
    if (!(rect.maxX > rect.minX && rect.maxZ > rect.minZ)) return null;
    opts = opts || {};
    var owner = opts.owner != null ? opts.owner : (id || null);
    var e = {
      id: id || ('map:' + mapEntries.length),
      minX: rect.minX, maxX: rect.maxX, minZ: rect.minZ, maxZ: rect.maxZ,
      owner: owner, kind: opts.kind || 'region',
      peer: opts.peer != null ? !!opts.peer : !!MAP_PEERS[owner],
      underlay: !!opts.underlay
    };
    mapEntries.push(e);
    return e;
  };

  L.mapConflict = function (rect, opts) {
    opts = opts || {};
    if (!rect) return null;
    var owner = opts.owner != null ? opts.owner : null;
    var lo = opts.minContain == null ? 0.08 : opts.minContain;
    var self = mapArea(rect);
    for (var i = 0; i < mapEntries.length; i++) {
      var e = mapEntries[i];
      if (!e.peer || e.underlay) continue;
      if (owner != null && e.owner === owner) continue;
      var ov = mapOverlapArea(rect, e); if (ov <= 0) continue;
      var C = ov / Math.max(1, Math.min(self, mapArea(e)));
      if (C >= lo) return { entry: e, overlap: ov, contain: C };
    }
    return null;
  };

  L.mapAudit = function (opts) {
    opts = opts || {};
    var lo = opts.minContain == null ? 0.08 : opts.minContain;  // < this = mere edge-graze
    var out = [];
    for (var i = 0; i < mapEntries.length; i++) {
      var a = mapEntries[i];
      if (!a.peer || a.underlay) continue;
      for (var j = i + 1; j < mapEntries.length; j++) {
        var b = mapEntries[j];
        if (!b.peer || b.underlay) continue;
        if (a.owner != null && a.owner === b.owner) continue;   // one feature's own layers
        var ov = mapOverlapArea(a, b); if (ov <= 0) continue;
        var C = ov / Math.max(1, Math.min(mapArea(a), mapArea(b)));
        if (C < lo) continue;
        out.push({
          a: a.owner, aKind: a.kind, b: b.owner, bKind: b.kind,
          area: Math.round(ov), contain: Math.round(C * 1000) / 10,
          tier: C > 0.5 ? 'ERROR' : 'WARN',
          at: { x: Math.round((Math.max(a.minX, b.minX) + Math.min(a.maxX, b.maxX)) / 2),
                z: Math.round((Math.max(a.minZ, b.minZ) + Math.min(a.maxZ, b.maxZ)) / 2) }
        });
      }
    }
    out.sort(function (p, q) { return q.contain - p.contain; });
    return out;
  };

  L.mapSnapshot = function () {
    return mapEntries.map(function (e) {
      return { id: e.id, owner: e.owner, kind: e.kind, peer: e.peer, underlay: e.underlay,
               minX: e.minX, maxX: e.maxX, minZ: e.minZ, maxZ: e.maxZ };
    });
  };

  // Named protected footprint. Repeating a declaration is harmless, which
  // lets a biome state its roads/landmarks beside the code that uses them.
  L.reserve = function (id, rect, opts) {
    if (!rect || rect.minX == null || rect.maxX == null || rect.minZ == null || rect.maxZ == null) return null;
    id = id || ('rect:' + rect.minX + ':' + rect.minZ + ':' + rect.maxX + ':' + rect.maxZ);
    if (layoutIds[id]) return layoutIds[id];
    var pad = opts && opts.pad ? opts.pad : 0;
    var r = copyRect({
      minX: rect.minX - pad, maxX: rect.maxX + pad,
      minZ: rect.minZ - pad, maxZ: rect.maxZ + pad,
      minY: rect.minY, maxY: rect.maxY,
      zone: (opts && opts.zone) || rect.zone
    }, opts);
    r.id = id;
    r.kind = (opts && opts.kind) || "feature";
    r.source = (opts && opts.source) || "worldLayout";
    layoutIds[id] = P.reserve(r);
    layoutEntries.push(layoutIds[id]);
    return layoutIds[id];
  };

  L.snapshot = function () {
    return layoutEntries.map(function (r) {
      return {
        id: r.id, kind: r.kind, source: r.source, zone: r.zone,
        minX: r.minX, maxX: r.maxX, minZ: r.minZ, maxZ: r.maxZ,
        minY: r.minY, maxY: r.maxY
      };
    });
  };

  L.reserveCircle = function (id, x, z, radius, opts) {
    radius = Math.max(0, radius || 0);
    return L.reserve(id, { minX: x - radius, maxX: x + radius, minZ: z - radius, maxZ: z + radius }, opts);
  };

  function naturalRect(x, z, radius, opts) {
    var r = Math.max(0.15, radius || 0.5);
    var pad = opts && opts.pad ? opts.pad : 0;
    return {
      minX: x - r - pad, maxX: x + r + pad,
      minZ: z - r - pad, maxZ: z + r + pad,
      stackable: false, zone: 'nature'
    };
  }

  L.canPlaceNature = function (x, z, radius, opts) {
    return P.isFree(naturalRect(x, z, radius, opts));
  };

  L.claimNature = function (x, z, radius, opts) {
    var r = naturalRect(x, z, radius, opts);
    if (!P.isFree(r)) return false;
    P.reserve(r);
    return true;
  };

  /* ---- debugDraw ---------------------------------------------- */
  P.debugDraw = function (parent) {
    if (!parent) return null;
    var grp = new THREE.Group();
    var mat = new THREE.LineBasicMaterial({ color: 0xff3366 });
    var seen = {};
    Object.keys(hash).forEach(function (key) {
      hash[key].forEach(function (r) {
        var id = r.minX + ':' + r.minZ + ':' + r.maxX + ':' + r.maxZ;
        if (seen[id]) return; seen[id] = 1;
        var w = r.maxX - r.minX, d = r.maxZ - r.minZ;
        var geo = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(r.minX, 0.1, r.minZ), new THREE.Vector3(r.maxX, 0.1, r.minZ),
          new THREE.Vector3(r.maxX, 0.1, r.maxZ), new THREE.Vector3(r.minX, 0.1, r.maxZ),
          new THREE.Vector3(r.minX, 0.1, r.minZ)
        ]);
        grp.add(new THREE.Line(geo, mat));
      });
    });
    parent.add(grp);
    return grp;
  };

})();
