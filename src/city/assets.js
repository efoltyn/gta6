/* ============================================================
   city/assets.js — THE PREFAB CATALOG (CBZ.assets).

   A registry of reusable, PARAMETRIC builder functions. Each entry
   declares a FOOTPRINT (half-extents) so the placement layer can test
   whether a spot is free WITHOUT building any geometry — test-then-build.

   This file is NEW INFRASTRUCTURE. It is a NO-OP until adopted: nothing
   here runs at load except registering a handful of starter defs. A
   separate town-generator agent registers more defs and drives placement.

   DRAW-CALL DISCIPLINE (owner rule #4): the engine is draw-call bound.
   - Asset builders reuse SHARED materials via CBZ.cmat (label-cached).
   - Scatter (trees/rocks/bushes) goes through CBZ.assets.pool(): ONE
     THREE.InstancedMesh per asset key → thousands of props ≈ 1 draw call.
   - Built groups get matrixAutoUpdate=false (static world).

   DETERMINISM (owner rule): every build(ctx) receives ctx.rng (a seeded
   0..1 function supplied by the caller). NO Math.random in build paths.

   ── API ──────────────────────────────────────────────────────
   CBZ.assets.define(key, def)
       def = {
         footprint:{hx,hz},   // half-extents, WORLD units, pre-rotation
         clearance = 0.5,     // extra gap reserved around the footprint
         stackable = false,   // may share a cell (signs, awnings, decals)
         y0 = 0, y1 = 30,     // collider vertical band
         noCollide = false,   // footprint-only scatter (bushes) — no collider
         zone,                // optional tag for zone-scoped conflicts
         instanceable=false,  // single-mesh: eligible for the InstancedMesh pool
         geom(), material(),  // OPTIONAL: provide shared geo/mat for the pool
         build(ctx)           // ctx={ group, x, z, rot, rng, scale }
       }
   CBZ.assets.has(key) / .get(key) / .list()
   CBZ.assets.rotatedFootprint(def, rot) → {hx,hz}  (swaps on 90°/270°)
   CBZ.assets.pool(key, max) → { add(x,z,rot,scale), mesh|group, count }

   ============================================================ */
(function () {
  'use strict';
  var THREE = window.THREE;
  var CBZ = (window.CBZ = window.CBZ || {});
  if (CBZ.assets) return;                       // idempotent

  // Shared-material helper (label-cached when CBZ.cmat exists).
  function cmat(hex, opts) {
    if (CBZ.cmat) return CBZ.cmat(hex, opts);
    if (CBZ.mat) return CBZ.mat(hex, opts);
    return new THREE.MeshLambertMaterial({ color: hex });
  }

  var A = (CBZ.assets = {});
  A._defs = {};

  /* ---- registry ------------------------------------------------ */
  A.define = function (key, def) {
    if (!key || !def || typeof def.build !== 'function') {
      console.warn('[assets] bad define:', key);
      return def;
    }
    var fp = def.footprint || { hx: 1, hz: 1 };
    var d = {
      key: key,
      footprint: { hx: +fp.hx || 0.5, hz: +fp.hz || 0.5 },
      clearance: def.clearance == null ? 0.5 : +def.clearance,
      stackable: !!def.stackable,
      y0: def.y0 == null ? 0 : +def.y0,
      y1: def.y1 == null ? 30 : +def.y1,
      noCollide: !!def.noCollide,
      zone: def.zone || null,
      instanceable: !!def.instanceable,
      geom: typeof def.geom === 'function' ? def.geom : null,
      material: typeof def.material === 'function' ? def.material : null,
      build: def.build
    };
    A._defs[key] = d;
    return d;
  };

  A.has = function (key) { return !!A._defs[key]; };
  A.get = function (key) { return A._defs[key] || null; };
  A.list = function () { return Object.keys(A._defs); };

  // Rotated footprint: only 90°/270° quarter-turns swap hx/hz. We snap
  // the rotation to the nearest quarter-turn to decide the swap (callers
  // that need exact AABBs of arbitrary rotations should over-reserve).
  A.rotatedFootprint = function (def, rot) {
    var fp = def && def.footprint ? def.footprint : { hx: 0.5, hz: 0.5 };
    var q = Math.round(((rot || 0) / (Math.PI / 2)));
    q = ((q % 4) + 4) % 4;
    if (q === 1 || q === 3) return { hx: fp.hz, hz: fp.hx };
    return { hx: fp.hx, hz: fp.hz };
  };

  /* ---- instanced pool (1 draw call per key) -------------------- *
     For SINGLE-MESH instanceable defs we build ONE InstancedMesh that
     shares geometry+material; .add() writes a transform matrix.
     LIMITATION: a def whose build() emits MULTIPLE meshes (or multiple
     materials) cannot be a single InstancedMesh — the pool then FALLS
     BACK to per-instance groups (one group per add, still sharing the
     def's shared materials). instanceable defs SHOULD supply geom() and
     material() so the pool can use the fast path.                       */
  var _pools = {};
  A.pool = function (key, max) {
    if (_pools[key]) return _pools[key];
    var def = A._defs[key];
    var cap = Math.max(1, max | 0) || 4096;
    var pool;

    if (def && def.instanceable && def.geom && def.material) {
      // FAST PATH — single shared InstancedMesh.
      var geo = def.geom();
      var matl = def.material();
      var im = new THREE.InstancedMesh(geo, matl, cap);
      im.count = 0;
      im.castShadow = false;
      im.receiveShadow = false;
      im.matrixAutoUpdate = false;
      im.frustumCulled = false;            // scatter spans the whole region
      var _m = new THREE.Matrix4();
      var _q = new THREE.Quaternion();
      var _v = new THREE.Vector3();
      var _s = new THREE.Vector3();
      var _ax = new THREE.Vector3(0, 1, 0);
      pool = {
        key: key, mesh: im, group: null, count: 0, cap: cap,
        add: function (x, z, rot, scale) {
          if (this.count >= cap) return false;
          var sc = scale || 1;
          _q.setFromAxisAngle(_ax, rot || 0);
          _v.set(x, def.y0 || 0, z);
          _s.set(sc, sc, sc);
          _m.compose(_v, _q, _s);
          im.setMatrixAt(this.count, _m);
          this.count = ++im.count;
          im.instanceMatrix.needsUpdate = true;
          return true;
        }
      };
    } else {
      // FALLBACK PATH — per-instance groups (shared mats via build()).
      var holder = new THREE.Group();
      holder.matrixAutoUpdate = false;
      pool = {
        key: key, mesh: null, group: holder, count: 0, cap: cap,
        add: function (x, z, rot, scale) {
          if (!def) return false;
          var g = new THREE.Group();
          def.build({ group: g, x: x, z: z, rot: rot || 0,
                      rng: Math.random, scale: scale || 1 });
          g.position.set(x, def.y0 || 0, z);
          g.rotation.y = rot || 0;
          var sc = scale || 1; g.scale.set(sc, sc, sc);
          g.updateMatrix(); g.matrixAutoUpdate = false;
          holder.add(g);
          this.count++;
          return true;
        }
      };
    }
    _pools[key] = pool;
    return pool;
  };

  // Reset pools (call alongside placement.reset on a fresh world build).
  A.resetPools = function () { _pools = {}; };

  /* ============================================================
     STARTER DEFS — generic, shared-material, deterministic.
     The town generator registers richer ones; these prove the API
     and give scatter something to place out of the box.
     ============================================================ */

  // tree-pine — trunk cylinder + cone canopy. Two meshes → fallback pool.
  A.define('tree-pine', {
    footprint: { hx: 1.1, hz: 1.1 }, clearance: 0.8, y1: 8, zone: 'nature',
    build: function (ctx) {
      var g = ctx.group, s = ctx.scale || 1;
      var h = (5 + ctx.rng() * 3) * s;
      var trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.18 * s, 0.26 * s, h * 0.4, 6),
        cmat(0x5a3d22));
      trunk.position.y = h * 0.2; g.add(trunk);
      var canopy = new THREE.Mesh(
        new THREE.ConeGeometry(1.0 * s, h * 0.8, 7),
        cmat(0x2f6b35));
      canopy.position.y = h * 0.55; g.add(canopy);
    }
  });

  // rock-boulder — single low-poly icosa. Instanceable (1 mesh, 1 mat).
  A.define('rock-boulder', {
    footprint: { hx: 0.9, hz: 0.9 }, clearance: 0.3, y1: 1.4, zone: 'nature',
    instanceable: true,
    geom: function () { return new THREE.IcosahedronGeometry(0.8, 0); },
    material: function () { return cmat(0x7c7a73); },
    build: function (ctx) {
      var m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.8 * (ctx.scale || 1), 0),
                             cmat(0x7c7a73));
      m.position.y = 0.4 * (ctx.scale || 1);
      m.rotation.set(ctx.rng() * 6.28, ctx.rng() * 6.28, ctx.rng() * 6.28);
      ctx.group.add(m);
    }
  });

  // bush — footprint-only scatter, NO collider (walk through). Instanceable.
  A.define('bush', {
    footprint: { hx: 0.7, hz: 0.7 }, clearance: 0.15, y1: 0.9,
    noCollide: true, zone: 'nature', instanceable: true,
    geom: function () { var g = new THREE.SphereGeometry(0.6, 6, 5); g.translate(0, 0.45, 0); return g; },
    material: function () { return cmat(0x3c7a3e); },
    build: function (ctx) {
      var s = ctx.scale || 1;
      var m = new THREE.Mesh(new THREE.SphereGeometry(0.6 * s, 6, 5), cmat(0x3c7a3e));
      m.position.y = 0.45 * s; ctx.group.add(m);
    }
  });

  // lamp — post + head. Two meshes → fallback pool.
  A.define('lamp', {
    footprint: { hx: 0.3, hz: 0.3 }, clearance: 0.4, y1: 5, zone: 'street',
    build: function (ctx) {
      var g = ctx.group;
      var post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 4.2, 6), cmat(0x2b2b2f));
      post.position.y = 2.1; g.add(post);
      var head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.22, 0.3), cmat(0xfff0c0));
      head.position.set(0, 4.2, 0.2); g.add(head);
    }
  });

  // bench — seat slab + two legs. Multi-mesh → fallback pool.
  A.define('bench', {
    footprint: { hx: 1.0, hz: 0.35 }, clearance: 0.4, y1: 1.0, zone: 'street',
    build: function (ctx) {
      var g = ctx.group, wood = cmat(0x6b4a2b), leg = cmat(0x3a3a3e);
      var seat = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.1, 0.5), wood);
      seat.position.y = 0.45; g.add(seat);
      var back = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.4, 0.08), wood);
      back.position.set(0, 0.7, -0.21); g.add(back);
      [-0.75, 0.75].forEach(function (dx) {
        var l = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.45, 0.45), leg);
        l.position.set(dx, 0.22, 0); g.add(l);
      });
    }
  });

  // fence-post — single small post. Instanceable.
  A.define('fence-post', {
    footprint: { hx: 0.12, hz: 0.12 }, clearance: 0.1, y1: 1.3, zone: 'fence',
    instanceable: true,
    geom: function () { var g = new THREE.BoxGeometry(0.16, 1.2, 0.16); g.translate(0, 0.6, 0); return g; },
    material: function () { return cmat(0x4a3520); },
    build: function (ctx) {
      var s = ctx.scale || 1;
      var m = new THREE.Mesh(new THREE.BoxGeometry(0.16 * s, 1.2 * s, 0.16 * s), cmat(0x4a3520));
      m.position.y = 0.6 * s; ctx.group.add(m);
    }
  });

})();
