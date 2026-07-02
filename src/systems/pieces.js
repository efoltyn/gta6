/* ============================================================
   systems/pieces.js — the ENABLING ENGINE for player building (F4,
   MASTER-PLAN Part IV.1). ADDITIVE / NEW INFRASTRUCTURE: this file is
   a no-op until something calls CBZ.spawnPiece — zero existing call
   sites change. Nothing in the city/world today spawns a Piece; a
   later wave (B1+) wires a build-mode UI to this API.

   Loads AFTER systems/chunks.js (chunk registry) and AFTER
   city/assets.js + systems/physics.js (index.html script order) so it
   can lean on CBZ.assets.get, CBZ.colliders/platforms + markCollidersDirty,
   and CBZ.groundAt/queryCollidersNear — see core/interfaces.js entries
   #3 (colliders), #4 (platforms/groundAt) and #12 (assets.define) for
   those contracts. This file does NOT modify physics.js or assets.js.

   ------------------------------------------------------------------
   THE CANONICAL PIECE SCHEMA (indexed at core/interfaces.js — grep
   "Piece schema" there once this lands; this comment is the OWNER):

     {
       id,            // "pc_" + base36 counter, e.g. "pc_a3"
       ownerId,       // player/faction id, or null (unclaimed/world piece)
       baseId,        // the assets.js key this was built from, or null
                      // for an inline def with no catalog key
       kind,          // caller-facing category (opts.kind, else baseId)
       tier,          // material tier (wood/stone/metal...), null this wave
       pos: {x,y,z},  // world position (the piece's local origin)
       rot,           // 0-3 quarter turns (0,90,180,270°) — NOT radians
       gridPos,       // {gx,gy,gz} snap-grid coords; null for free placement
       sockets,       // null this wave — B3 lands socket snap
       supportedBy,   // [] pieceIds this piece rests on (structural graph)
       supports,      // [] pieceIds resting on this piece
       hp, maxHp,     // damage model scaffolding (B5 wires real damage)
       weightClass,   // load this piece exerts on what it rests on
       maxLoad,       // load this piece can carry before B4's integrity math
       colliders,     // [] the actual CBZ.colliders entries this piece owns
       platforms,     // [] the actual CBZ.platforms entries this piece owns
       meshRef,       // the THREE.Object3D actually in the scene graph
       chunkKey,      // int key into CBZ.chunks (systems/chunks.js)
       sealed,        // false — future: base/room enclosure test
       alive,         // false once despawned (reaped lazily, see below)
       seq,           // bumped by future mutators; 0 at spawn, unused this wave
       createdAt,     // CBZ.game.elapsed at spawn time
     }
   ------------------------------------------------------------------ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  if (CBZ.pieces) return; // idempotent (same guard idiom as city/assets.js)
  const THREE = window.THREE;

  CBZ.pieces = new Map();      // id -> Piece
  CBZ.pieceIndex = new Map();  // id -> { colliderRefs:[], platformRefs:[] } (same objects as Piece.colliders/platforms — kept as a separate lookup per the spec so callers don't have to reach through CBZ.pieces for this)

  let pieceSeq = 0;

  // ---- def resolution: catalog key (string) OR an inline def object ----
  function resolveDef(assetKeyOrDef) {
    if (typeof assetKeyOrDef === "string") {
      if (CBZ.assets && CBZ.assets.get) {
        const d = CBZ.assets.get(assetKeyOrDef);
        if (d) return { def: d, baseId: assetKeyOrDef };
      }
      return { def: null, baseId: assetKeyOrDef };
    }
    return { def: assetKeyOrDef, baseId: (assetKeyOrDef && assetKeyOrDef.key) || null };
  }

  // Quarter-turn footprint swap (same math as city/assets.js's
  // rotatedFootprint, reimplemented locally so an inline def works even
  // when CBZ.assets hasn't loaded — this file must handle either order).
  function rotateFootprint(fp, quarterTurns) {
    fp = fp || { hx: 0.5, hz: 0.5 };
    const q = ((quarterTurns % 4) + 4) % 4;
    return (q === 1 || q === 3) ? { hx: fp.hz, hz: fp.hx } : { hx: fp.hx, hz: fp.hz };
  }

  // ============================================================
  // CBZ.spawnPiece(assetKeyOrDef, opts) -> Piece | null
  //   opts: { pos:{x,y,z}, rot(0-3), ownerId, hp, solid=true, walkTop=false, parent }
  //   def MAY also supply colliders(ctx)->specs[] for a multi-AABB piece
  //   (B1, systems/building.js's doorframe) — see the collider block below.
  // ============================================================
  CBZ.spawnPiece = function (assetKeyOrDef, opts) {
    opts = opts || {};
    const resolved = resolveDef(assetKeyOrDef);
    const def = resolved.def;
    if (!def || typeof def.build !== "function") {
      console.warn("[pieces] spawnPiece: no usable def for", assetKeyOrDef);
      return null;
    }

    const oPos = opts.pos || {};
    const pos = { x: oPos.x || 0, y: oPos.y || 0, z: oPos.z || 0 };
    const rot = ((opts.rot | 0) % 4 + 4) % 4;         // normalize to 0-3 quarter turns
    const rotRad = rot * (Math.PI / 2);

    const fp = rotateFootprint(def.footprint, rot);
    const hx = fp.hx != null ? fp.hx : 0.5;
    const hz = fp.hz != null ? fp.hz : 0.5;
    const y0 = def.y0 == null ? 0 : def.y0;
    const y1 = def.y1 == null ? 1 : def.y1;

    const id = "pc_" + (++pieceSeq).toString(36);

    // ---- build + place the mesh -----------------------------------
    // ctx follows the CBZ.assets.build(ctx) contract (interfaces.js #12:
    // {group,x,z,rot,rng,scale}) so a catalog def works unmodified. An
    // inline def MAY instead return its own Object3D from build() (task
    // spec: "build(ctx)->mesh/group") — we accept either shape.
    const group = new THREE.Group();
    const built = def.build({ group: group, x: pos.x, y: pos.y, z: pos.z, rot: rotRad, rng: Math.random, scale: opts.scale || 1 });
    const mesh = (built && built.isObject3D) ? built : group;
    mesh.position.set(pos.x, pos.y, pos.z);
    mesh.rotation.y = rotRad;
    mesh.updateMatrix();
    mesh.matrixAutoUpdate = false;
    mesh.userData.pieceId = id;   // batch.js opt-out: non-empty userData => skipped
                                   // from the static merge (core/batch.js:219,227)

    // ---- chunk registration (systems/chunks.js) --------------------
    // Always index the piece into its natural chunk (for bookkeeping/
    // reap/dirty-marking) even when an explicit parent is given; only the
    // MESH's actual scene-graph parent is conditional on opts.parent.
    const chunk = CBZ.chunkAt ? CBZ.chunkAt(pos.x, pos.z) : null;
    const parent = opts.parent || (chunk && chunk.root) || CBZ.scene;
    if (parent) parent.add(mesh);

    // ---- collider (footprint+pos AABB) ------------------------------
    const pieceColliders = [];
    const solid = opts.solid !== false && !def.noCollide;
    if (solid && typeof def.colliders === "function") {
      // ---- MULTI-COLLIDER PATH (B1 addition) -------------------------
      // A def that needs more than one AABB per piece (e.g. a doorframe's
      // two side posts + a height-gated header, so the gap between them
      // stays walkable) supplies colliders(ctx) -> [{dx=0,dz=0,hx,hz,
      // y0,y1}, ...]. Each spec is a LOCAL offset (dx/dz) from the piece's
      // world pos, with its own half-extents (hx/hz — default to the
      // piece's already-rotated footprint) and its own vertical band
      // (y0/y1 — default to def.y0/def.y1). This is ADDITIVE: every
      // existing def (none define colliders()) takes the single-AABB
      // branch in the `else` below, byte-identical to before this change.
      const specs = def.colliders({ pos: pos, hx: hx, hz: hz, y0: y0, y1: y1, rot: rot, rotRad: rotRad, def: def }) || [];
      for (let i = 0; i < specs.length; i++) {
        const s = specs[i];
        const sdx = s.dx || 0, sdz = s.dz || 0;
        const shx = s.hx != null ? s.hx : hx, shz = s.hz != null ? s.hz : hz;
        const sy0 = s.y0 != null ? s.y0 : y0, sy1 = s.y1 != null ? s.y1 : y1;
        const c = {
          minX: pos.x + sdx - shx, maxX: pos.x + sdx + shx,
          minZ: pos.z + sdz - shz, maxZ: pos.z + sdz + shz,
          y0: pos.y + sy0, y1: pos.y + sy1,
          pieceId: id, ref: mesh,
        };
        CBZ.colliders.push(c);
        pieceColliders.push(c);
      }
      if (pieceColliders.length) mesh.userData.collider = pieceColliders[0]; // convention parity w/ addBox (first collider is "the" one)
      if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
    } else if (solid) {
      const c = {
        minX: pos.x - hx, maxX: pos.x + hx,
        minZ: pos.z - hz, maxZ: pos.z + hz,
        y0: pos.y + y0, y1: pos.y + y1,
        pieceId: id, ref: mesh,
      };
      CBZ.colliders.push(c);
      pieceColliders.push(c);
      mesh.userData.collider = c;   // matches world/materials.js's addBox convention
      if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
    }

    // ---- optional LOS blocking (F7 addition) -------------------------
    // world/materials.js's addBox has long supported opts.blockLOS: push
    // the just-built Mesh into the flat CBZ.losBlockers array, which every
    // raycast consumer (guards.js, detection.js, fpsmode.js, camera.js...)
    // tests via raycaster.intersectObjects(CBZ.losBlockers, false) — NON-
    // recursive, so only the pushed object itself is hit-tested, never its
    // children. Pieces needed the identical capability so compound cover
    // objects (crates, walls, ...) migrated onto spawnPiece keep blocking
    // guard/camera sightlines exactly as before (F7, world/crates.js).
    // NOTE: if `mesh` resolves to a Group (the common case when build()
    // just fills ctx.group and returns nothing), pushing it here is a
    // no-op for raycasting — THREE.Group has no geometry of its own, so
    // Group.raycast() never reports a hit. A def that needs REAL LOS
    // blocking must instead return an actual Mesh from build() (attach any
    // cosmetic detail meshes to THAT mesh, not to ctx.group) so a single
    // real hit-testable surface gets registered here, matching addBox's
    // one-mesh-per-blocker convention.
    if (opts.blockLOS) {
      CBZ.losBlockers.push(mesh);
    }

    // ---- optional walkable top (stacking support) -------------------
    const piecePlatforms = [];
    if (opts.walkTop) {
      const p = {
        minX: pos.x - hx, maxX: pos.x + hx,
        minZ: pos.z - hz, maxZ: pos.z + hz,
        top: pos.y + y1,
        pieceId: id,
      };
      CBZ.platforms.push(p);
      piecePlatforms.push(p);
    }

    if (chunk) { chunk.pieceIds.add(id); if (CBZ.markChunkDirty) CBZ.markChunkDirty(chunk.key); }

    const piece = {
      id: id,
      ownerId: opts.ownerId != null ? opts.ownerId : null,
      baseId: resolved.baseId,
      kind: opts.kind || resolved.baseId || (def.zone || "piece"),
      tier: opts.tier != null ? opts.tier : null,
      pos: pos,
      rot: rot,
      gridPos: opts.gridPos || null,
      sockets: null,                 // not this wave — B3 lands socket snap
      supportedBy: [],
      supports: [],
      hp: opts.hp != null ? opts.hp : 100,
      maxHp: opts.maxHp != null ? opts.maxHp : (opts.hp != null ? opts.hp : 100),
      weightClass: opts.weightClass != null ? opts.weightClass : 1,
      maxLoad: opts.maxLoad != null ? opts.maxLoad : Infinity,
      colliders: pieceColliders,
      platforms: piecePlatforms,
      // B-stage TODO: instanceable piece kinds swap this per-piece mesh for
      // CBZ.assets.poolAcquire(baseId)/poolRelease(baseId, index) (F6, city/assets.js).
      meshRef: mesh,
      chunkKey: chunk ? chunk.key : null,
      sealed: false,
      alive: true,
      seq: 0,
      createdAt: (CBZ.game && CBZ.game.elapsed) || 0,
    };
    CBZ.pieces.set(id, piece);
    CBZ.pieceIndex.set(id, { colliderRefs: pieceColliders, platformRefs: piecePlatforms });
    return piece;
  };

  // ============================================================
  // CBZ.findSupport(x, z, yMin, yMax) -> {y, kind, pieceId?} | null
  //   Composes the EXISTING CBZ.groundAt (terrain + CBZ.platforms — which
  //   now transparently includes any piece's walkTop platform, so stacking
  //   rides the same walk-surface code the player already uses) with a
  //   direct scan of piece COLLIDER tops via CBZ.queryCollidersNear, which
  //   catches a piece that's solid but wasn't given walkTop (e.g. a wall a
  //   builder still wants a placement snap onto). Returns whichever
  //   candidate is higher, since "support" means "what would you land on."
  // ============================================================
  const supportScratch = [];
  CBZ.findSupport = function (x, z, yMin, yMax) {
    let a = null, b = null;

    // (a) terrain + platforms, via the SAME function the player's vertical
    // physics uses (systems/physics.js:230-247) — untouched, read-only.
    if (CBZ.groundAt) {
      const g = CBZ.groundAt(x, z, yMin);
      if (g >= yMin - 1e-6 && g <= yMax) {
        let kind = "ground", pieceId = null;
        const plats = CBZ.platforms;
        for (let i = 0; i < plats.length; i++) {
          const p = plats[i];
          if (x < p.minX || x > p.maxX || z < p.minZ || z > p.maxZ) continue;
          let top = p.top;
          // B3: kept in lockstep with physics.js:241's x-axis ramp branch —
          // same optional r.axis:"x" data-shape extension, same z-default.
          if (p.ramp) { const r = p.ramp; let t = (r.axis === "x") ? (x - r.x0) / (r.x1 - r.x0) : (z - r.z0) / (r.z1 - r.z0); t = t < 0 ? 0 : t > 1 ? 1 : t; top = r.y0 + t * (r.y1 - r.y0); }
          if (Math.abs(top - g) < 1e-3) { kind = "platform"; if (p.pieceId != null) pieceId = p.pieceId; break; }
        }
        a = { y: g, kind: kind, pieceId: pieceId };
      }
    }

    // (b) piece colliders directly (covers solid-but-not-walkTop pieces).
    if (CBZ.queryCollidersNear) {
      const near = CBZ.queryCollidersNear(x, z, 1.5, supportScratch);
      for (let i = 0; i < near.length; i++) {
        const c = near[i];
        if (c.pieceId == null) continue;
        if (x < c.minX || x > c.maxX || z < c.minZ || z > c.maxZ) continue;
        if (c.y1 == null || c.y1 < yMin - 1e-6 || c.y1 > yMax) continue;
        if (!b || c.y1 > b.y) b = { y: c.y1, kind: "piece", pieceId: c.pieceId };
      }
    }

    if (!a) return b;
    if (!b) return a;
    return b.y > a.y ? b : a;
  };

  // ============================================================
  // CBZ.despawnPiece(id, opts) -> boolean
  //   Marks the piece (and, with cascade, its now-unsupported dependents)
  //   !alive IMMEDIATELY, then queues the actual array/mesh cleanup for the
  //   reap tick below. Cascade is a bounded BFS over the supports/
  //   supportedBy graph with a visited set (toKill), so cycles can't loop.
  // ============================================================
  const reapQueue = new Set();  // pieceIds marked dead, pending the drain below
  CBZ.despawnPiece = function (id, opts) {
    const root = CBZ.pieces.get(id);
    if (!root || !root.alive) return false;
    opts = opts || {};
    const cascade = opts.cascade !== false;

    const toKill = new Set([id]);
    if (cascade) {
      const queue = [id];
      while (queue.length) {
        const cur = queue.shift();
        const curPiece = CBZ.pieces.get(cur);
        if (!curPiece || !curPiece.supports) continue;
        for (let i = 0; i < curPiece.supports.length; i++) {
          const depId = curPiece.supports[i];
          if (toKill.has(depId)) continue;
          const dep = CBZ.pieces.get(depId);
          if (!dep || !dep.alive) continue;
          // still supported if ANY of its remaining supportedBy entries is a
          // LIVE piece not already slated for this same despawn batch.
          let stillSupported = false;
          const sb = dep.supportedBy || [];
          for (let j = 0; j < sb.length; j++) {
            const sid = sb[j];
            if (toKill.has(sid)) continue;
            const sp = CBZ.pieces.get(sid);
            if (sp && sp.alive) { stillSupported = true; break; }
          }
          if (!stillSupported) { toKill.add(depId); queue.push(depId); }
        }
      }
    }

    toKill.forEach(function (kid) {
      const kp = CBZ.pieces.get(kid);
      if (!kp || !kp.alive) return;
      kp.alive = false;
      reapQueue.add(kid);
      // debris hook: only for pieces that fell as CASCADE collateral (the
      // explicit target's own destruction FX is the caller's job).
      if (kid !== id && CBZ.fx && CBZ.fx.dropDebris) {
        CBZ.fx.dropDebris({ x: kp.pos.x, z: kp.pos.z, fromY: kp.pos.y + (kp.platforms[0] ? (kp.platforms[0].top - kp.pos.y) : 1) + 1, size: 0.4 + Math.random() * 0.5 });
      }
    });
    return true;
  };

  // ============================================================
  // Reap drain — deferred cleanup for everything despawnPiece queued.
  // Batches ALL reaped ids into one Set, then does exactly ONE filter pass
  // over CBZ.colliders and ONE over CBZ.platforms (not one pass per piece),
  // followed by O(reaped) per-piece mesh/chunk/index teardown.
  // ============================================================
  function reapDrain() {
    if (!reapQueue.size) return;
    const ids = new Set(reapQueue);
    reapQueue.clear();

    let touchedColliders = false;
    if (CBZ.colliders.length) {
      const next = [];
      for (let i = 0; i < CBZ.colliders.length; i++) {
        const c = CBZ.colliders[i];
        if (c.pieceId != null && ids.has(c.pieceId)) { touchedColliders = true; continue; }
        next.push(c);
      }
      if (touchedColliders) CBZ.colliders = next;
    }
    if (touchedColliders && CBZ.markCollidersDirty) CBZ.markCollidersDirty();

    if (CBZ.platforms.length) {
      const next = [];
      let touchedPlatforms = false;
      for (let i = 0; i < CBZ.platforms.length; i++) {
        const p = CBZ.platforms[i];
        if (p.pieceId != null && ids.has(p.pieceId)) { touchedPlatforms = true; continue; }
        next.push(p);
      }
      if (touchedPlatforms) CBZ.platforms = next;
    }

    // F7 addition: mirror the same one-filter-pass reap for losBlockers.
    // Entries there are raw Meshes (not {pieceId,...} records like
    // colliders/platforms), so identify a piece's own blocker via the
    // userData.pieceId tag spawnPiece already stamps on every mesh it builds.
    if (CBZ.losBlockers && CBZ.losBlockers.length) {
      const next = [];
      let touchedLos = false;
      for (let i = 0; i < CBZ.losBlockers.length; i++) {
        const m = CBZ.losBlockers[i];
        if (m && m.userData && m.userData.pieceId != null && ids.has(m.userData.pieceId)) { touchedLos = true; continue; }
        next.push(m);
      }
      if (touchedLos) CBZ.losBlockers = next;
    }

    const dirtyChunks = new Set();
    ids.forEach(function (id) {
      const p = CBZ.pieces.get(id);
      if (!p) return;
      if (p.meshRef) {
        if (p.meshRef.parent) p.meshRef.parent.remove(p.meshRef);
        p.meshRef.traverse(function (o) {
          if (o.geometry && !o.geometry._shared && o.geometry.dispose) o.geometry.dispose();
          if (o.material && !o.material._shared && o.material.dispose) o.material.dispose();
        });
      }
      if (p.chunkKey != null && CBZ.chunks) {
        const chunk = CBZ.chunks.get(p.chunkKey);
        if (chunk) { chunk.pieceIds.delete(id); dirtyChunks.add(p.chunkKey); }
      }
      // detach from any surviving neighbour's graph so a later despawn's BFS
      // never trips over a dangling id.
      (p.supportedBy || []).forEach(function (sid) {
        const sp = CBZ.pieces.get(sid);
        if (sp && sp.supports) { const i = sp.supports.indexOf(id); if (i >= 0) sp.supports.splice(i, 1); }
      });
      (p.supports || []).forEach(function (did) {
        const dp = CBZ.pieces.get(did);
        if (dp && dp.supportedBy) { const i = dp.supportedBy.indexOf(id); if (i >= 0) dp.supportedBy.splice(i, 1); }
      });
      CBZ.pieces.delete(id);
      CBZ.pieceIndex.delete(id);
    });
    if (CBZ.markChunkDirty) dirtyChunks.forEach(function (k) { CBZ.markChunkDirty(k); });
  }
  CBZ._piecesReapDrain = reapDrain; // internal hook: CBZ.piecesSelfTest calls this directly for a synchronous result

  // LATE band, one tick before systems/chunks.js's own drain (CBZ.PRIO.LATE
  // == 90): reaping runs at 89 so a burst of despawns this frame (e.g. a
  // raid's cascade collapse) finishes and marks its chunks dirty BEFORE the
  // chunk-batch drain looks at which chunks need rebuilding, same frame.
  CBZ.onUpdate(CBZ.PRIO ? CBZ.PRIO.LATE - 1 : 89, reapDrain);

  // ============================================================
  // CBZ.piecesSelfTest() — dev console sanity check (NOT auto-run).
  // Spawns 3 inline-def boxes stacked via findSupport, checks the
  // collider/platform arrays actually grew, cascade-despawns the bottom
  // one, and checks the arrays (and CBZ.pieces) are back to baseline.
  // ============================================================
  CBZ.piecesSelfTest = function () {
    const result = { ok: true, steps: [], errors: [] };
    function log(msg) { result.steps.push(msg); }

    const boxDef = {
      footprint: { hx: 1, hz: 1 }, y0: 0, y1: 1,
      build: function (ctx) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 2), new THREE.MeshBasicMaterial({ color: 0x8899aa }));
        ctx.group.add(m);
        return ctx.group;
      },
    };

    const collidersBefore = CBZ.colliders.length;
    const platformsBefore = CBZ.platforms.length;
    const losBefore = (CBZ.losBlockers || []).length;
    const testX = 100000, testZ = 100000; // far out in empty space, away from any real geometry

    const base = CBZ.spawnPiece(boxDef, { pos: { x: testX, y: 0, z: testZ }, walkTop: true });
    if (!base) { result.ok = false; result.errors.push("base spawn failed"); return result; }
    log("spawned base " + base.id + " (top=" + (base.pos.y + boxDef.y1) + ")");

    const sup1 = CBZ.findSupport(testX, testZ, base.pos.y, base.pos.y + 10);
    const midY = sup1 ? sup1.y : (base.pos.y + boxDef.y1);
    // F7: also exercise the new blockLOS path on this spawn — checked below
    // alongside the collider/platform counts, then torn down by the same
    // cascade despawn so the array is restored to baseline like everything else.
    const mid = CBZ.spawnPiece(boxDef, { pos: { x: testX, y: midY, z: testZ }, walkTop: true, blockLOS: true });
    mid.supportedBy.push(base.id); base.supports.push(mid.id);
    log("findSupport -> " + JSON.stringify(sup1) + "; spawned mid " + mid.id + " @y=" + midY);

    const sup2 = CBZ.findSupport(testX, testZ, mid.pos.y, mid.pos.y + 10);
    const topY = sup2 ? sup2.y : (mid.pos.y + boxDef.y1);
    const top = CBZ.spawnPiece(boxDef, { pos: { x: testX, y: topY, z: testZ } });
    top.supportedBy.push(mid.id); mid.supports.push(top.id);
    log("findSupport -> " + JSON.stringify(sup2) + "; spawned top " + top.id + " @y=" + topY);

    const collidersAfterSpawn = CBZ.colliders.length;
    const platformsAfterSpawn = CBZ.platforms.length;
    const losAfterSpawn = (CBZ.losBlockers || []).length;
    if (collidersAfterSpawn !== collidersBefore + 3) { result.ok = false; result.errors.push("expected +3 colliders, got " + (collidersAfterSpawn - collidersBefore)); }
    if (platformsAfterSpawn !== platformsBefore + 2) { result.ok = false; result.errors.push("expected +2 platforms, got " + (platformsAfterSpawn - platformsBefore)); }
    if (losAfterSpawn !== losBefore + 1) { result.ok = false; result.errors.push("expected +1 losBlockers, got " + (losAfterSpawn - losBefore)); }
    log("after spawn: colliders " + collidersBefore + "->" + collidersAfterSpawn + ", platforms " + platformsBefore + "->" + platformsAfterSpawn + ", losBlockers " + losBefore + "->" + losAfterSpawn);

    CBZ.despawnPiece(base.id, { cascade: true });
    reapDrain(); // synchronous drain for an immediate console result (normally runs on the next onUpdate(89) tick)

    const collidersAfter = CBZ.colliders.length;
    const platformsAfter = CBZ.platforms.length;
    const losAfter = (CBZ.losBlockers || []).length;
    if (collidersAfter !== collidersBefore) { result.ok = false; result.errors.push("colliders not restored: " + collidersAfter + " vs baseline " + collidersBefore); }
    if (platformsAfter !== platformsBefore) { result.ok = false; result.errors.push("platforms not restored: " + platformsAfter + " vs baseline " + platformsBefore); }
    if (losAfter !== losBefore) { result.ok = false; result.errors.push("losBlockers not restored: " + losAfter + " vs baseline " + losBefore); }
    if (CBZ.pieces.has(base.id) || CBZ.pieces.has(mid.id) || CBZ.pieces.has(top.id)) { result.ok = false; result.errors.push("cascade did not remove all 3 pieces from CBZ.pieces"); }
    log("after cascade despawn: colliders " + collidersAfter + " (baseline " + collidersBefore + "), platforms " + platformsAfter + " (baseline " + platformsBefore + "), losBlockers " + losAfter + " (baseline " + losBefore + ")");

    result.ok ? log("PASS") : log("FAIL: " + result.errors.join("; "));
    if (window.console) console.log("[piecesSelfTest]", result.ok ? "PASS" : "FAIL", result);
    return result;
  };
})();
