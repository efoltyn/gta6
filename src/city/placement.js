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
  function ck(ix, iz) { return ix + ',' + iz; }
  function ci(v) { return Math.floor(v / CELL); }

  P.cellSize = CELL;

  P.reset = function () { hash = {}; };

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
      stackable: !!rect.stackable, zone: rect.zone || null, ref: rect.ref || null
    };
    forCells(r, function (key) { (hash[key] || (hash[key] = [])).push(r); });
    return r;
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
      if (c.minX == null) continue;
      P.reserve({ minX: c.minX, maxX: c.maxX, minZ: c.minZ, maxZ: c.maxZ,
                  stackable: false, zone: 'world', ref: c });
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
