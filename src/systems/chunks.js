/* ============================================================
   systems/chunks.js — CBZ.chunks: a 16m spatial registry for player-
   placed pieces (F4, MASTER-PLAN Part IV.1). ADDITIVE / NEW INFRASTRUCTURE:
   nothing here runs at load beyond registering one debounced onUpdate
   drain. Zero existing call sites change; nothing else reads this yet
   except systems/pieces.js (loads right after this file, but either
   load order works — this file doesn't touch CBZ.pieces).

   WHY 16m: physics.js's own collider broadphase (systems/physics.js:30
   COL_CELL = 8) already grids the world at 8m. CHUNK = 16 is exactly
   2x that cell, so every chunk boundary lands ON a collider-grid
   boundary too — no piece straddles a half-cell seam between the two
   grids, which keeps future debugging (chunk vs. collider-bucket
   mismatches) simple.

   THIS WAVE ONLY builds the plumbing: chunk lookup/creation, a dirty
   flag, and a debounced drain that calls a STUB rebuildChunkBatch()
   which just counts pieces (no geometry merge yet). The real
   mergeGeometries() batching pass is a LATER stage (per the build plan,
   "B-stage lands the mergeGeometries path") — the debounce/queue is
   shipped now so systems/pieces.js has somewhere to call
   markChunkDirty() into, instead of retrofitting call sites later.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  if (CBZ.chunks) return; // idempotent (mirrors city/assets.js's own guard)

  const CHUNK = 16; // world meters per chunk edge — see file header for the 2x-COL_CELL reasoning
  CBZ.CHUNK_SIZE = CHUNK;

  const OFF = 32768, SPAN = 65536; // same recentre-for-positive-int-key idiom as spatialgrid.js
  function cx(x) { return Math.floor(x / CHUNK); }
  function cz(z) { return Math.floor(z / CHUNK); }
  function keyOf(gx, gz) { return (gx + OFF) * SPAN + (gz + OFF); }

  CBZ.chunkKeyAt = function (x, z) { return keyOf(cx(x), cz(z)); };

  CBZ.chunks = new Map(); // key(int) -> chunk record

  // getOrCreateChunk(cx,cz) -> {key, root, pieceIds, dirty, batched, _dirtyAt}
  // root is a THREE.Group, added to CBZ.scene LAZILY (only once, on first
  // creation) so an empty world never grows a forest of unused empty groups
  // beyond the ones actually touched by a placed piece.
  CBZ.getOrCreateChunk = function (gx, gz) {
    const key = keyOf(gx, gz);
    let c = CBZ.chunks.get(key);
    if (c) return c;
    const root = new window.THREE.Group();
    root.name = "chunk_" + gx + "_" + gz;
    root.matrixAutoUpdate = false;
    if (CBZ.scene) CBZ.scene.add(root);
    c = {
      key: key,
      cx: gx, cz: gz,
      root: root,
      pieceIds: new Set(),
      dirty: false,
      batched: null,   // future: merged-geometry mesh(es) once rebuildChunkBatch does real work
      _dirtyAt: 0,      // performance.now() timestamp of the most recent markChunkDirty (debounce anchor)
    };
    CBZ.chunks.set(key, c);
    return c;
  };

  // Convenience: resolve straight from world coords (pieces.js's main entry point).
  CBZ.chunkAt = function (x, z) { return CBZ.getOrCreateChunk(cx(x), cz(z)); };

  // markChunkDirty(key): flag a chunk (by its int key, as returned by
  // chunkKeyAt/chunk.key) for a future batch rebuild. Cheap — no work here,
  // just a flag + a debounce timestamp; the onUpdate drain below does the rest.
  CBZ.markChunkDirty = function (key) {
    const c = CBZ.chunks.get(key);
    if (!c) return;
    c.dirty = true;
    c._dirtyAt = performance.now();
  };

  const DEBOUNCE_MS = 300;   // let a burst of placements/despawns in one chunk settle before batching
  const MAX_PER_DRAIN = 2;   // bound the per-frame cost: at most 2 chunks processed per drain

  // STUB rebuildChunkBatch: this wave only COUNTS pieces in the chunk (proves
  // the plumbing end to end). A later stage swaps this for a real
  // THREE.BufferGeometryUtils.mergeGeometries() pass that replaces
  // chunk.root's per-piece children with a handful of merged draw calls
  // (chunk.batched), same spirit as city/assets.js's InstancedMesh pool but
  // for static, non-instanced piece geometry.
  function rebuildChunkBatch(chunk) {
    chunk._lastBatchCount = chunk.pieceIds.size;
    chunk.dirty = false;
    // chunk.batched intentionally left null this wave — no merge yet.
  }
  CBZ.rebuildChunkBatch = rebuildChunkBatch; // exposed for the self-test + future callers

  // Debounced drain, PRIO.LATE band (90) — after all gameplay ticks so a
  // burst of placements/cascaded despawns in one frame settles before we
  // spend time batching. Bounded to MAX_PER_DRAIN chunks/frame so a big
  // build session can't spike a frame.
  CBZ.onUpdate(CBZ.PRIO ? CBZ.PRIO.LATE : 90, function () {
    if (!CBZ.chunks.size) return;
    const now = performance.now();
    let processed = 0;
    for (const chunk of CBZ.chunks.values()) {
      if (processed >= MAX_PER_DRAIN) break;
      if (!chunk.dirty) continue;
      if (now - chunk._dirtyAt < DEBOUNCE_MS) continue; // still settling
      rebuildChunkBatch(chunk);
      processed++;
    }
  });
})();
