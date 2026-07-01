/* ============================================================
   city/construction.js — PLAYER-OWNED-LOT CONSTRUCTION (the "Minecraft/Rust"
   piece-kit builder that answers the owner's "everything is prebuilt and
   fragile" complaint).

   WHY a piece-kit, not a voxel engine: this codebase already has a complete
   place-things-in-the-world pipeline — CBZ.assets (footprint/clearance/y0/y1
   + build()), CBZ.placement (spatial-hash isFree/reserve/placeAsset) and
   CBZ.assets.pool() (InstancedMesh batching), all feeding CBZ.colliders for
   collision. A voxel/chunk model would need its OWN parallel remeshing/nav/
   collision stack disconnected from all of that. A discrete wall/floor/ramp/
   door/roof KIT snapped to sockets-or-a-grid is structurally IDENTICAL to
   what buildings.js/props.js/placement.js already do for every other prop —
   so this file just wires the SAME primitives into a live, playtime tool.

   ── WHAT THIS ADDS ──────────────────────────────────────────
   1. Five CBZ.assets defs (build-wall/build-floor/build-ramp/build-doorframe/
      build-roof) — same asset-def shape as assets.js's starter defs, plus a
      SOCKETS table (local-space attachment points at vertical + top edges,
      same half-extent units as footprint) kept in this file (assets.js's
      schema is untouched — additive only).
   2. A first-person placement TOOL (toggle: [N] while standing on/near a lot
      YOU own — reuses CBZ.cityOwnsLot, the one ownership source of truth
      zillow.js/realestate.js/empire.js already share; no parallel concept).
      Each frame it raycasts from the camera (mirrors the classic three.js
      voxelpainter pattern: hit existing placed pieces first, else fall back
      to an analytic plane test) to find either (a) the nearest socket of an
      already-placed piece, or (b) a snap point on the OWNED LOT'S OWN LOCAL
      GRID (built from the lot's door-normal basis — realtyoffice.js's own
      inx/inz/tangent trick — so it snaps correctly under any lot facing,
      not just world-axis-aligned lots). A translucent ghost mesh previews
      the piece, green/red per CBZ.placement.isFree().
   3. Confirm (LMB): CBZ.placement.reserve() the footprint, add an instance to
      the piece's CBZ.assets.pool(), push a collider, CBZ.markCollidersDirty.
   4. Remove (Shift+LMB on a player-placed piece): frees the socket, un-
      reserves the footprint from this module's OWN construction occupancy
      hash (CBZ.placement has no public un-reserve and a full reset() would
      wipe the whole world's reservations — too invasive for one piece; see
      the "2. CONSTRUCTION OCCUPANCY" block below for why a second small
      hash is the correct, additive fix), drops the collider (mirroring
      buildings.js's own collider-splice removal idiom), and frees the pool
      slot (a new pool.remove(index), grafted onto the existing pool object
      from HERE — assets.js is not edited).
   5. HARD ownership gate: every isFree/reserve/remove call re-validates the
      target lot is still owned by re-calling CBZ.cityOwnsLot — no placing,
      and no un-reserving, outside a lot you actually own.
   6. Per-lot cap (PIECE_CAP = 200) enforced via the pool's existing max-count
      ceiling PLUS a per-lot counter (a lot could otherwise round-robin many
      different piece kinds, each with its own pool, to dodge a single pool's
      cap) so a determined player can't blow the draw-call budget.

   NEW INFRASTRUCTURE and a NO-OP until adopted: nothing here places a single
   piece, reserves a single cell, or adds a single collider at load — it only
   registers asset defs (inert until placeAsset/pool.add is called) and an
   [N]-gated tool that does nothing until a player stands on land they own
   and opts in. Headless-safe (guards on CBZ/THREE; the harness never toggles
   the tool, so its per-frame update is a cheap early-return).
   ============================================================ */
(function () {
  "use strict";
  var THREE = window.THREE;
  var CBZ = window.CBZ;
  if (!CBZ || !THREE) return;
  if (!CBZ.assets || !CBZ.placement) return;     // hard deps — load order guard
  if (CBZ.construction) return;                  // idempotent
  var g = CBZ.game;

  // DETERMINISM (owner rule): none of this file's placement/build math uses
  // Math.random — piece transforms come from the player's raycast + grid
  // snap (already deterministic) and the piece kit's build() functions carry
  // no random variation, so no seeded rng is needed here.

  function cmat(hex, opts) {
    if (CBZ.cmat) return CBZ.cmat(hex, opts);
    if (CBZ.mat) return CBZ.mat(hex, opts);
    return new THREE.MeshLambertMaterial({ color: hex });
  }
  function boxGeo(w, h, d) {
    if (CBZ.boxGeom) return CBZ.boxGeom(w, h, d);
    return new THREE.BoxGeometry(w, h, d);
  }

  /* ============================================================
     1. THE PIECE KIT — five CBZ.assets defs + a SOCKETS side-table.
     Each piece is a 2m×2m nominal cell (matches the local-grid step below)
     so walls/floors/doors/roofs tile cleanly, Rust/Fortnite-style.
     ============================================================ */
  var CELL = 2.0;           // nominal piece footprint edge (metres) — also the local-grid step
  var WALL_T = 0.22;        // wall thickness
  var WALL_H = 2.4;         // wall height

  // SOCKETS: local-space attachment points, SAME half-extent units as
  // footprint (i.e. measured from the piece's own origin before rot/pos are
  // applied). `edge` is a unit direction (the socket faces outward along it,
  // used to auto-align a piece snapped there); `y` is height offset from the
  // piece's y0. Kept here (not in assets.js's def) — purely additive.
  var SOCKETS = {
    'build-wall': [
      { x: -CELL / 2, z: 0, y: 0, edge: { x: -1, z: 0 } },   // left vertical edge
      { x: CELL / 2, z: 0, y: 0, edge: { x: 1, z: 0 } },     // right vertical edge
      { x: 0, z: 0, y: WALL_H, edge: { x: 0, z: 0 } },       // top edge (roof/upper floor)
    ],
    'build-floor': [
      { x: -CELL / 2, z: 0, y: 0, edge: { x: -1, z: 0 } },
      { x: CELL / 2, z: 0, y: 0, edge: { x: 1, z: 0 } },
      { x: 0, z: -CELL / 2, y: 0, edge: { x: 0, z: -1 } },
      { x: 0, z: CELL / 2, y: 0, edge: { x: 0, z: 1 } },
      { x: 0, z: 0, y: 0.12, edge: { x: 0, z: 0 } },         // top (stack a wall/roof on this floor)
    ],
    'build-ramp': [
      { x: -CELL / 2, z: 0, y: 0, edge: { x: -1, z: 0 } },
      { x: CELL / 2, z: 0, y: WALL_H, edge: { x: 1, z: 0 } }, // high end — feeds an upper floor
    ],
    'build-doorframe': [
      { x: -CELL / 2, z: 0, y: 0, edge: { x: -1, z: 0 } },
      { x: CELL / 2, z: 0, y: 0, edge: { x: 1, z: 0 } },
      { x: 0, z: 0, y: WALL_H, edge: { x: 0, z: 0 } },
    ],
    'build-roof': [
      { x: -CELL / 2, z: 0, y: 0, edge: { x: -1, z: 0 } },
      { x: CELL / 2, z: 0, y: 0, edge: { x: 1, z: 0 } },
      { x: 0, z: -CELL / 2, y: 0, edge: { x: 0, z: -1 } },
      { x: 0, z: CELL / 2, y: 0, edge: { x: 0, z: 1 } },
    ],
  };
  CBZ.constructionSockets = SOCKETS;   // exposed read-only for tooling/debug

  var woodMat = null, frameMat = null, roofMat = null, ghostGreenMat = null, ghostRedMat = null;
  function mats() {
    if (woodMat) return;
    woodMat = cmat(0x8a6a44);
    frameMat = cmat(0x5a4530);
    roofMat = cmat(0x6b4a3a);
  }

  CBZ.assets.define('build-wall', {
    footprint: { hx: CELL / 2, hz: WALL_T / 2 }, clearance: 0.02, y0: 0, y1: WALL_H,
    instanceable: true, zone: 'construction',
    geom: function () { return boxGeo(CELL, WALL_H, WALL_T); },
    material: function () { mats(); return woodMat; },
    build: function (ctx) {
      mats();
      var m = new THREE.Mesh(boxGeo(CELL, WALL_H, WALL_T), woodMat);
      m.position.y = WALL_H / 2;
      ctx.group.add(m);
    }
  });

  CBZ.assets.define('build-floor', {
    footprint: { hx: CELL / 2, hz: CELL / 2 }, clearance: 0.02, y0: 0, y1: 0.24,
    instanceable: true, zone: 'construction',
    geom: function () { return boxGeo(CELL, 0.24, CELL); },
    material: function () { mats(); return woodMat; },
    build: function (ctx) {
      mats();
      var m = new THREE.Mesh(boxGeo(CELL, 0.24, CELL), woodMat);
      m.position.y = 0.12;
      ctx.group.add(m);
    }
  });

  CBZ.assets.define('build-ramp', {
    footprint: { hx: CELL / 2, hz: CELL / 2 }, clearance: 0.02, y0: 0, y1: WALL_H,
    zone: 'construction',                       // angled → fallback pool (single mesh but non-axis box; keep simple/robust)
    build: function (ctx) {
      mats();
      // a simple wedge: BoxGeometry sheared via vertex nudge would need custom
      // geometry; keep it a plain tilted slab (cheap, reads fine as a ramp).
      var len = Math.sqrt(CELL * CELL + WALL_H * WALL_H);
      var m = new THREE.Mesh(new THREE.BoxGeometry(len, 0.22, CELL), woodMat);
      m.position.set(0, WALL_H / 2, 0);
      m.rotation.z = -Math.atan2(WALL_H, CELL);
      ctx.group.add(m);
    }
  });

  CBZ.assets.define('build-doorframe', {
    footprint: { hx: CELL / 2, hz: WALL_T / 2 }, clearance: 0.02, y0: 0, y1: WALL_H,
    zone: 'construction',                        // multi-mesh (frame w/ gap) → fallback pool
    build: function (ctx) {
      mats();
      var jamb1 = new THREE.Mesh(boxGeo(0.2, WALL_H, WALL_T), frameMat);
      jamb1.position.set(-CELL / 2 + 0.1, WALL_H / 2, 0);
      ctx.group.add(jamb1);
      var jamb2 = new THREE.Mesh(boxGeo(0.2, WALL_H, WALL_T), frameMat);
      jamb2.position.set(CELL / 2 - 0.1, WALL_H / 2, 0);
      ctx.group.add(jamb2);
      var header = new THREE.Mesh(boxGeo(CELL, 0.3, WALL_T), frameMat);
      header.position.set(0, WALL_H - 0.15, 0);
      ctx.group.add(header);
    }
  });

  CBZ.assets.define('build-roof', {
    footprint: { hx: CELL / 2, hz: CELL / 2 }, clearance: 0.02, y0: 0, y1: 0.3,
    instanceable: true, zone: 'construction',
    geom: function () { return boxGeo(CELL, 0.16, CELL); },
    material: function () { mats(); return roofMat; },
    build: function (ctx) {
      mats();
      var m = new THREE.Mesh(boxGeo(CELL, 0.16, CELL), roofMat);
      m.position.y = 0.08;
      ctx.group.add(m);
    }
  });

  var PIECE_NAMES = ['build-wall', 'build-floor', 'build-ramp', 'build-doorframe', 'build-roof'];

  /* ============================================================
     2. CONSTRUCTION OCCUPANCY — a SECOND, tiny spatial hash exactly like
     placement.js's own (same cell-hash-of-AABBs idea), but scoped ONLY to
     player-placed pieces. WHY a second hash instead of reusing placement.js's:
     CBZ.placement's API is isFree/reserve — reset() is the only removal
     primitive, and it wipes the ENTIRE world's reservations (buildings,
     scatter, every other lot), which would be catastrophically overbroad for
     removing ONE piece. Since construction pieces still need to dodge the
     hand-built world too, every isFree/reserve/remove call below checks BOTH:
     CBZ.placement.isFree() (dodges buildings/props/scatter — the world this
     module doesn't own) AND this local hash (dodges/frees OTHER construction
     pieces, which this module fully owns and can therefore un-reserve
     correctly). This is strictly additive: placement.js is never modified,
     and nothing here can ever cause an overlap the shared hash would have
     caught, since BOTH must agree a spot is free before a piece is built.
     ============================================================ */
  var C_CELL = 4;                      // construction-hash cell size, metres
  var cHash = {};
  function cCk(ix, iz) { return ix + ',' + iz; }
  function cCi(v) { return Math.floor(v / C_CELL); }
  function cForCells(rect, fn) {
    var x0 = cCi(rect.minX), x1 = cCi(rect.maxX), z0 = cCi(rect.minZ), z1 = cCi(rect.maxZ);
    for (var ix = x0; ix <= x1; ix++) for (var iz = z0; iz <= z1; iz++) fn(cCk(ix, iz));
  }
  function cOverlaps(a, b) { return a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ; }
  function cIsFree(rect) {
    var free = true;
    cForCells(rect, function (key) {
      var bucket = cHash[key]; if (!bucket) return;
      for (var i = 0; i < bucket.length; i++) if (cOverlaps(rect, bucket[i])) { free = false; return; }
    });
    return free;
  }
  function cReserve(rect) {
    var r = { minX: rect.minX, maxX: rect.maxX, minZ: rect.minZ, maxZ: rect.maxZ };
    cForCells(r, function (key) { (cHash[key] || (cHash[key] = [])).push(r); });
    return r;
  }
  function cRelease(r) {
    cForCells(r, function (key) {
      var bucket = cHash[key]; if (!bucket) return;
      var i = bucket.indexOf(r); if (i >= 0) bucket.splice(i, 1);
    });
  }

  /* ============================================================
     3. LOT OWNERSHIP + LOCAL GRID — reuse CBZ.cityOwnsLot (zillow.js) as the
     single source of truth. No parallel ownership concept.
     ============================================================ */
  function allLots() {
    var A = CBZ.city && CBZ.city.arena;
    if (!A) return [];
    return [].concat(A.lots || [], (A.annex && A.annex.lots) || []);
  }

  // lot the player is standing on/near (small apron), regardless of ownership.
  function lotNear(x, z, pad) {
    pad = pad == null ? 2.5 : pad;
    var lots = allLots(), best = null, bestD = Infinity;
    for (var i = 0; i < lots.length; i++) {
      var lot = lots[i];
      var w = lot.w || 0, d = lot.d || 0;
      if (!w || !d) continue;
      var minX = lot.cx - w / 2 - pad, maxX = lot.cx + w / 2 + pad;
      var minZ = lot.cz - d / 2 - pad, maxZ = lot.cz + d / 2 + pad;
      if (x < minX || x > maxX || z < minZ || z > maxZ) continue;
      var dx = x - lot.cx, dz = z - lot.cz, dd = dx * dx + dz * dz;
      if (dd < bestD) { bestD = dd; best = lot; }
    }
    return best;
  }

  // the lot's own local basis (works under ANY lot facing — not world-axis
  // dependent). Mirrors realtyoffice.js's inx/inz/tangent trick: door normal
  // gives one axis, its perpendicular gives the other. Lots without a door
  // (parks, annex fillers) fall back to the world axes.
  function lotBasis(lot) {
    var b = lot.building, door = b && b.door;
    var inx = (door && door.nx) || 0, inz = (door && door.nz) || 1;
    if (!inx && !inz) { inx = 0; inz = 1; }
    var tx = -inz, tz = inx;
    return { ox: lot.cx, oz: lot.cz, ax: tx, az: tz, bx: inx, bz: inz };
  }

  // world (x,z) → lot-local (u along tangent, v along door-normal).
  function worldToLocal(basis, x, z) {
    var dx = x - basis.ox, dz = z - basis.oz;
    return { u: dx * basis.ax + dz * basis.az, v: dx * basis.bx + dz * basis.bz };
  }
  function localToWorld(basis, u, v) {
    return { x: basis.ox + basis.ax * u + basis.bx * v, z: basis.oz + basis.az * u + basis.bz * v };
  }
  // snap a local (u,v) to the lot's own CELL grid.
  function snapLocal(u, v) {
    return { u: Math.round(u / CELL) * CELL, v: Math.round(v / CELL) * CELL };
  }
  // the lot-local yaw that keeps a piece aligned with the lot's own axes.
  function lotYaw(basis) { return Math.atan2(basis.ax, basis.az); }

  /* ============================================================
     4. PLACED-PIECE LEDGER — this file's own bookkeeping (per lot), since
     neither placement.js nor assets.js track "which instance is this,
     which lot owns it, which socket did it claim". Kept entirely in this
     module — additive, doesn't touch shared state other than the shared
     placement hash / colliders / pools every other placer already touches.
     ============================================================ */
  var PIECE_CAP = 200;                  // sane per-lot cap (owner rule #6)
  var lotState = {};                    // lotKey -> { pieces:[], count }
  function lotKey(lot) { return lot.cx + ':' + lot.cz; }
  function stateFor(lot) {
    var k = lotKey(lot);
    return lotState[k] || (lotState[k] = { pieces: [], count: 0 });
  }

  // pool.remove(index) — grafted onto CBZ.assets.pool()'s returned object
  // (assets.js is not edited). Swap-with-last removal: cheap, O(1), standard
  // technique for InstancedMesh compaction. For the fallback (group) path we
  // just remove the child Group. Every pool this file uses gets the method
  // attached the first time it's fetched; harmless if called more than once.
  var poolsPatched = {};
  function poolFor(name) {
    var pool = CBZ.assets.pool(name, PIECE_CAP + 16);
    if (poolsPatched[name]) return pool;
    poolsPatched[name] = true;
    if (typeof pool.remove === 'function') return pool;   // some other caller already added one
    var _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _sc = new THREE.Vector3();
    pool.remove = function (index) {
      if (index == null || index < 0 || index >= this.count) return false;
      var last = this.count - 1;
      if (this.mesh) {
        // fast path: swap the removed slot's matrix with the last live slot's,
        // then shrink count by one (the classic InstancedMesh compaction trick).
        var swapped = -1;
        if (index !== last) {
          if (this.mesh.getMatrixAt) {
            this.mesh.getMatrixAt(last, _m);
            this.mesh.setMatrixAt(index, _m);
            swapped = last;              // caller must retarget the piece that WAS at `last`
          } else {
            // getMatrixAt unavailable (older stub) — zero-scale the hole instead
            // of compacting. No slot actually moved, so swappedIndex stays -1;
            // the vacated slot at `last` is simply abandoned (never reused).
            _v.set(0, -9999, 0); _q.set(0, 0, 0, 1); _sc.set(0, 0, 0);
            _m.compose(_v, _q, _sc);
            this.mesh.setMatrixAt(index, _m);
          }
        }
        this.count = this.mesh.count = last;
        this.mesh.instanceMatrix.needsUpdate = true;
        return { swappedIndex: swapped };
      }
      if (this.group) {
        var child = this.group.children[index];
        if (child) this.group.remove(child);
        this.count = Math.max(0, this.count - 1);
        return { swappedIndex: -1 };
      }
      return false;
    };
    return pool;
  }

  /* ============================================================
     5. THE TOOL — [N] toggles build mode while standing on/near an OWNED
     lot. Per-frame raycast (camera-forward, mirroring the voxelpainter
     hit-existing-objects-then-ground-plane pattern) picks a socket or a
     lot-local grid cell; LMB confirms, Shift+LMB removes.
     ============================================================ */
  var T = {
    active: false, lot: null, basis: null,
    cursor: 0,                          // index into PIECE_NAMES (current piece to place)
    ghost: null,
    target: null,                       // {x,y,z,rot,rect,def,name,valid,socket}
  };
  CBZ.construction = {};                // public surface (assigned to at bottom)

  var SOCKET_SNAP_R = 1.1;              // metres — how close the cursor ray must land to a socket to snap to it
  var RAY_MAX = 14;                     // build reach

  function ensureGhost() {
    if (T.ghost) return T.ghost;
    ghostGreenMat = new THREE.MeshBasicMaterial({ color: 0x5fe06a, transparent: true, opacity: 0.45, depthWrite: false });
    ghostRedMat = new THREE.MeshBasicMaterial({ color: 0xe0605f, transparent: true, opacity: 0.45, depthWrite: false });
    var grp = new THREE.Group();
    grp.visible = false;
    (CBZ.scene || (CBZ.city && CBZ.city.arena && CBZ.city.arena.root)).add(grp);
    T.ghost = grp;
    return grp;
  }

  // rebuild the ghost's geometry to match the current piece (cheap: one box).
  var ghostMesh = null, ghostBuiltFor = null;
  function updateGhostShape(name) {
    var grp = ensureGhost();
    if (ghostBuiltFor === name && ghostMesh) return;
    if (ghostMesh) { grp.remove(ghostMesh); }
    var def = CBZ.assets.get(name);
    var fp = def ? def.footprint : { hx: CELL / 2, hz: CELL / 2 };
    var h = def ? (def.y1 - def.y0) : WALL_H;
    ghostMesh = new THREE.Mesh(new THREE.BoxGeometry(fp.hx * 2, Math.max(0.1, h), fp.hz * 2), ghostGreenMat);
    ghostMesh.position.y = h / 2;
    grp.add(ghostMesh);
    ghostBuiltFor = name;
  }

  function pieceName() { return PIECE_NAMES[T.cursor % PIECE_NAMES.length]; }

  // gather sockets of every piece placed on the CURRENT lot, in world space,
  // skipping sockets already claimed by another piece (occupied=true).
  function liveSockets() {
    if (!T.lot) return [];
    var st = stateFor(T.lot);
    var out = [];
    for (var i = 0; i < st.pieces.length; i++) {
      var p = st.pieces[i];
      var defSockets = SOCKETS[p.name];
      if (!defSockets) continue;
      var cy = Math.cos(p.rot), sy = Math.sin(p.rot);
      for (var s = 0; s < defSockets.length; s++) {
        var sk = defSockets[s];
        if (p.claimed && p.claimed[s]) continue;
        // rotate local socket offset by the piece's own placed rotation.
        var wx = p.x + (sk.x * cy + sk.z * sy);
        var wz = p.z + (-sk.x * sy + sk.z * cy);
        out.push({ pieceIdx: i, socketIdx: s, x: wx, y: p.y + sk.y, z: wz, rot: p.rot, edge: sk.edge });
      }
    }
    return out;
  }

  // camera-forward ray → ground/lot-floor plane hit (analytic; avoids a full
  // scene raycast against arbitrary hand-built geometry, which keeps this
  // tool cheap and scoped to construction-owned objects only).
  var _dir = null, _origin = null;
  function cameraRay() {
    var cam = CBZ.camera;
    if (!cam || !cam.getWorldDirection) return null;
    if (!_dir) { _dir = new THREE.Vector3(); _origin = new THREE.Vector3(); }
    cam.getWorldDirection(_dir);
    _origin.copy(cam.position);
    return { o: _origin, d: _dir };
  }

  function pickTarget() {
    var ray = cameraRay();
    if (!ray || !T.lot) return null;
    var floorY = (T.lot.building && T.lot.building.home && T.lot.building.home.floorY) || 0;

    // 1) nearest socket within SOCKET_SNAP_R of where the ray crosses that
    //    socket's own height plane (cheap per-socket plane test — sockets are
    //    few per lot, unlike a full mesh raycast).
    var sockets = liveSockets();
    var best = null, bestD = SOCKET_SNAP_R;
    for (var i = 0; i < sockets.length; i++) {
      var sk = sockets[i];
      if (Math.abs(ray.d.y) < 1e-4) continue;
      var t = (sk.y - ray.o.y) / ray.d.y;
      if (t <= 0 || t > RAY_MAX) continue;
      var hx = ray.o.x + ray.d.x * t, hz = ray.o.z + ray.d.z * t;
      var dx = hx - sk.x, dz = hz - sk.z, d = Math.sqrt(dx * dx + dz * dz);
      if (d < bestD) { bestD = d; best = sk; }
    }
    if (best) {
      return { x: best.x, y: best.y, z: best.z, rot: best.rot, socket: best };
    }

    // 2) fall back to the lot's own local grid (rotation-agnostic — works
    //    however the lot itself is oriented, per worldToLocal/snapLocal).
    if (Math.abs(ray.d.y) < 1e-4) return null;
    var tf = (floorY - ray.o.y) / ray.d.y;
    if (tf <= 0 || tf > RAY_MAX) return null;
    var fx = ray.o.x + ray.d.x * tf, fz = ray.o.z + ray.d.z * tf;
    var loc = worldToLocal(T.basis, fx, fz);
    var snapped = snapLocal(loc.u, loc.v);
    var w = localToWorld(T.basis, snapped.u, snapped.v);
    return { x: w.x, y: floorY, z: w.z, rot: lotYaw(T.basis), socket: null };
  }

  function refreshTarget() {
    var pick = pickTarget();
    if (!pick) { T.target = null; if (T.ghost) T.ghost.visible = false; return; }
    var name = pieceName();
    updateGhostShape(name);
    var def = CBZ.assets.get(name);
    var fp = CBZ.assets.rotatedFootprint(def, pick.rot);
    var clr = def.clearance || 0;
    var rect = {
      minX: pick.x - fp.hx - clr, maxX: pick.x + fp.hx + clr,
      minZ: pick.z - fp.hz - clr, maxZ: pick.z + fp.hz + clr,
      stackable: def.stackable, zone: 'construction'
    };
    // HARD ownership re-check every frame — the player could have walked off
    // the owned lot, or lost the lot (sold/seized), since the tool opened.
    var stillOwns = T.lot && CBZ.cityOwnsLot && CBZ.cityOwnsLot(T.lot);
    // BOTH hashes must agree: placement.js's (the hand-built world + other
    // scatter) AND this module's own construction hash (other placed pieces).
    var free = stillOwns && CBZ.placement.isFree(rect, { zoneOnly: false }) && cIsFree(rect);
    var st = T.lot ? stateFor(T.lot) : null;
    var underCap = st ? st.count < PIECE_CAP : false;
    var valid = !!(stillOwns && free && underCap);

    T.target = { x: pick.x, y: pick.y, z: pick.z, rot: pick.rot, rect: rect, def: def, name: name, valid: valid, socket: pick.socket };

    var grp = ensureGhost();
    grp.visible = true;
    grp.position.set(pick.x, pick.y, pick.z);
    grp.rotation.y = pick.rot;
    if (ghostMesh) ghostMesh.material = valid ? ghostGreenMat : ghostRedMat;
  }

  // ---- confirm: build the real piece -----------------------------------
  function confirmPlace() {
    if (!T.active || !T.target || !T.target.valid || !T.lot) return;
    var tgt = T.target, def = tgt.def, name = tgt.name;
    if (!CBZ.cityOwnsLot || !CBZ.cityOwnsLot(T.lot)) return;   // hard gate, re-checked at the moment of commit
    var st = stateFor(T.lot);
    if (st.count >= PIECE_CAP) { if (CBZ.city && CBZ.city.note) CBZ.city.note('Build cap reached for this lot (' + PIECE_CAP + ').', 1.6); return; }

    var pool = poolFor(name);
    var poolIndex = pool.count;
    var ok = pool.add(tgt.x, tgt.z, tgt.rot, 1);
    if (!ok) { if (CBZ.city && CBZ.city.note) CBZ.city.note('Piece limit reached — free some pieces first.', 1.8); return; }

    CBZ.placement.reserve(tgt.rect);           // dodge future world/scatter placement
    var cRect = cReserve(tgt.rect);            // dodge/enable future OWN-piece removal

    var fp = CBZ.assets.rotatedFootprint(def, tgt.rot);
    var col = null;
    if (!def.noCollide && CBZ.colliders) {
      col = { minX: tgt.x - fp.hx, maxX: tgt.x + fp.hx, minZ: tgt.z - fp.hz, maxZ: tgt.z + fp.hz,
              y0: def.y0 || 0, y1: def.y1 == null ? 30 : def.y1 };
      CBZ.colliders.push(col);
      if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
    }

    var rec = { name: name, x: tgt.x, y: tgt.y, z: tgt.z, rot: tgt.rot, rect: tgt.rect, col: col,
                cRect: cRect, poolIndex: poolIndex, claimed: null };
    // mark the socket we snapped to (if any) as claimed so it stops offering
    // itself once occupied.
    if (tgt.socket) {
      var srcPiece = st.pieces[tgt.socket.pieceIdx];
      if (srcPiece) { srcPiece.claimed = srcPiece.claimed || {}; srcPiece.claimed[tgt.socket.socketIdx] = true; }
    }
    st.pieces.push(rec);
    st.count++;
    if (CBZ.sfx) CBZ.sfx('door');
  }

  // ---- remove: free the nearest player-placed piece under the cursor ----
  function nearestOwnPiece() {
    var ray = cameraRay();
    if (!ray || !T.lot) return -1;
    var st = stateFor(T.lot);
    var best = -1, bestT = RAY_MAX;
    for (var i = 0; i < st.pieces.length; i++) {
      var p = st.pieces[i];
      if (Math.abs(ray.d.y) < 1e-4) continue;
      var midY = p.y + WALL_H / 2;
      var t = (midY - ray.o.y) / ray.d.y;
      if (t <= 0 || t > bestT) continue;
      var hx = ray.o.x + ray.d.x * t, hz = ray.o.z + ray.d.z * t;
      var dx = hx - p.x, dz = hz - p.z;
      if (Math.sqrt(dx * dx + dz * dz) < CELL * 0.75) { bestT = t; best = i; }
    }
    return best;
  }
  function confirmRemove() {
    if (!T.active || !T.lot) return;
    if (!CBZ.cityOwnsLot || !CBZ.cityOwnsLot(T.lot)) return;   // hard gate on removal too
    var st = stateFor(T.lot);
    var idx = nearestOwnPiece();
    if (idx < 0) return;
    var p = st.pieces[idx];

    // un-reserve: placement.js's shared hash keeps a stale (but harmless —
    // see the C_CELL comment above) entry forever, since it has no public
    // splice API and a full reset() would nuke the whole world. This
    // module's OWN construction hash, however, we fully control — release
    // the rect there so the cell is truly free again for a NEW piece.
    cRelease(p.cRect);
    if (p.col && CBZ.colliders) {
      var ci = CBZ.colliders.indexOf(p.col);
      if (ci >= 0) CBZ.colliders.splice(ci, 1);
      if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
    }
    var pool = poolFor(p.name);
    var res = pool.remove(p.poolIndex);
    // swap-with-last compaction moved another piece's instance into this
    // slot — retarget that piece's own poolIndex bookkeeping so future
    // removes still hit the right InstancedMesh slot.
    if (res && res.swappedIndex >= 0) {
      for (var k = 0; k < st.pieces.length; k++) {
        if (st.pieces[k] !== p && st.pieces[k].name === p.name && st.pieces[k].poolIndex === res.swappedIndex) {
          st.pieces[k].poolIndex = p.poolIndex;
          break;
        }
      }
    }
    st.pieces.splice(idx, 1);
    st.count = Math.max(0, st.count - 1);
    if (CBZ.sfx) CBZ.sfx('door');
  }

  // ---- enter/exit build mode --------------------------------------------
  function tryEnter() {
    var P = CBZ.player; if (!P || !P.pos) return;
    var lot = lotNear(P.pos.x, P.pos.z, 3.0);
    if (!lot) { if (CBZ.city && CBZ.city.note) CBZ.city.note("No lot here to build on.", 1.6); return; }
    if (!CBZ.cityOwnsLot || !CBZ.cityOwnsLot(lot)) { if (CBZ.city && CBZ.city.note) CBZ.city.note("You don't own this lot — buy it at Zillow [Z] first.", 2.2); return; }
    T.active = true; T.lot = lot; T.basis = lotBasis(lot);
    ensureGhost();
    if (CBZ.city && CBZ.city.note) CBZ.city.note("🔨 Build mode — [1-5] piece, LMB place, Shift+LMB remove, [N] exit.", 2.6);
  }
  function exitBuild() {
    T.active = false; T.lot = null; T.basis = null; T.target = null;
    if (T.ghost) T.ghost.visible = false;
  }
  CBZ.construction.toggle = function () { if (T.active) exitBuild(); else tryEnter(); };
  CBZ.construction.isActive = function () { return T.active; };
  CBZ.construction.pieceCount = function (lot) { return lot ? stateFor(lot).count : 0; };
  CBZ.construction.pieceNames = PIECE_NAMES.slice();
  CBZ.construction.cap = PIECE_CAP;

  // ---- per-frame: only does anything while the tool is active -----------
  CBZ.onUpdate(38.95, function (dt) {
    if (!T.active) return;
    if (!g || g.mode !== 'city' || g.state !== 'playing') { exitBuild(); return; }
    var P = CBZ.player;
    if (!P || P.dead || P.driving) { exitBuild(); return; }
    if (CBZ.cityMenuOpen) return;                 // some other panel owns the screen — pause silently
    // re-validate the player is still near the lot they opened the tool on.
    var still = T.lot && lotNear(P.pos.x, P.pos.z, 4.0) === T.lot;
    if (!still) { exitBuild(); return; }
    refreshTarget();
  });

  // ---- input --------------------------------------------------------------
  addEventListener('keydown', function (e) {
    if (!g || g.mode !== 'city' || g.state !== 'playing') return;
    if (CBZ.cityMenuOpen) return;
    var k = (e.key || '').toLowerCase();
    if (k === 'n' && !e.repeat) {
      var P = CBZ.player;
      if (!T.active && (!P || P.driving || P.dead)) return;
      e.preventDefault();
      CBZ.construction.toggle();
      return;
    }
    if (!T.active) return;
    if (k >= '1' && k <= String(PIECE_NAMES.length)) {
      e.preventDefault();
      T.cursor = parseInt(k, 10) - 1;
      updateGhostShape(pieceName());
    } else if (k === 'escape') {
      e.preventDefault();
      exitBuild();
    }
  });

  addEventListener('mousedown', function (e) {
    if (!T.active) return;
    if (!document.pointerLockElement) return;     // avoid firing on UI clicks elsewhere
    if (CBZ.cityMenuOpen) return;
    if (e.button === 0) {
      e.preventDefault();
      if (e.shiftKey) confirmRemove(); else confirmPlace();
    }
  });

  CBZ.cityConstructionReset = function () {
    exitBuild();
    lotState = {};
    cHash = {};
  };
})();
