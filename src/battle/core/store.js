/* ============================================================
   battle/core/store.js — THE UNIT STORE. Every unit on the field is a ROW:
   a handful of numbers in typed arrays. Page-independent (no DOM, no THREE):
   it runs in the page, in node and in the sim worker.

   WHY. The goal is 100 000 men a side without losing quality, logic or
   looks. Objects with THREE groups cannot do that; rows can.
     FULL  near the lens / the player / anything a full unit is fighting:
           a full rig and the page's full brain (the objects in `men`, each
           pointing at its row through m.row)
     MID   core/tiersim.js: the same fire, damage and morale rules, an
           individual brain on a time-sliced think
     FAR   core/tiersim.js: decisions per squad (who to fight, where to
           stand, line of sight), every round still fired and landed per man
   Every tier is drawn from the same ledger (MID/FAR through
   entities/crowdgpu.js), so promotion/demotion is a change of `tier`, not a
   new object.

   COLUMNS (index = row)
     side u8 (0 = first slot "red", 1 = second "blue")   kind u8 (KIND)
     tier u8 (TIER)   life u8 (0 free, 1 alive, 2 routed, 3 fled, 4 dead)
     x y z heading vx vz hp maxHp morale   f32
     squad i32   crowdRow i32 (-1 = not instanced)   unit i32 (unit-type index)
   + any column a tier registers with S.col(name, Ctor) (grown with the rest).
   ref[] holds the FULL tier's object for a row (null for MID/FAR rows).

   SHARED MEMORY. create(cap, {shared:true}) puts every column on a
   SharedArrayBuffer when the page is cross-origin isolated, so the sim worker
   reads and writes the same rows the renderer draws. Otherwise the columns
   are plain and the worker trades snapshots (core/simlink.js).

   PUBLIC  CBZ.battleStore.create(cap?, opts?) -> S
     S.alloc(side, kind, unitIdx) -> row     S.free(row)
     S.sync(row, m)          copy a full unit's live state into its row
     S.count(side, life?)    S.rows (high-water mark)   S.cols (the arrays)
     S.col(name, Ctor, fill) register (or fetch) an extra column
     S.onGrow(fn)            told after a grow (fn(S)): re-read your columns
     S.buffers()             { name: ArrayBuffer|SharedArrayBuffer } (for the worker)
     S.adopt(bufs, cap, rows) wrap buffers handed over by another thread
   CBZ.battleStore.KIND / TIER / LIFE
============================================================ */
(function () {
  "use strict";
  const W = typeof window !== "undefined" ? window : (typeof self !== "undefined" ? self : globalThis);
  const CBZ = W.CBZ || (W.CBZ = {});
  const KIND = { man: 0, beast: 1, vehicle: 2 };
  const TIER = { full: 0, mid: 1, far: 2 };
  const LIFE = { free: 0, alive: 1, routed: 2, fled: 3, dead: 4 };
  const F32 = ["x", "y", "z", "heading", "vx", "vz", "hp", "maxHp", "morale"];
  const U8 = ["side", "kind", "tier", "life"];
  const I32 = ["squad", "crowdRow", "unit"];
  const canShare = typeof SharedArrayBuffer !== "undefined" &&
    (typeof W.crossOriginIsolated === "undefined" ? true : !!W.crossOriginIsolated);

  function create(cap, opts) {
    opts = opts || {};
    cap = Math.max(64, cap | 0 || 1024);
    const shared = !!opts.shared && canShare;
    const S = { cap: cap, rows: 0, cols: {}, ref: [], freeList: [], shared: shared, _extra: {}, _grow: [] };
    function mk(Ctor, n, fill) {
      const a = shared ? new Ctor(new SharedArrayBuffer(n * Ctor.BYTES_PER_ELEMENT)) : new Ctor(n);
      if (fill) a.fill(fill);
      return a;
    }
    function alloc(n) {
      const c = {};
      F32.forEach(function (k) { c[k] = mk(Float32Array, n, 0); });
      U8.forEach(function (k) { c[k] = mk(Uint8Array, n, 0); });
      I32.forEach(function (k) { c[k] = mk(Int32Array, n, -1); });
      for (const k in S._extra) { const e = S._extra[k]; c[k] = mk(e.Ctor, n, e.fill); }
      return c;
    }
    S.cols = alloc(cap);
    // grows by doubling: a battle never has to guess its size up front
    function grow(min) {
      let n = S.cap * 2;
      while (n < min) n *= 2;
      const c = alloc(n);
      for (const k in c) c[k].set(S.cols[k]);
      S.cols = c; S.cap = n;
      for (let i = 0; i < S._grow.length; i++) S._grow[i](S);
    }
    S.reserve = function (n) { if (n > S.cap) grow(n); };
    S.col = function (name, Ctor, fill) {
      if (S.cols[name]) return S.cols[name];
      S._extra[name] = { Ctor: Ctor, fill: fill || 0 };
      return (S.cols[name] = mk(Ctor, S.cap, fill || 0));
    };
    S.onGrow = function (fn) { S._grow.push(fn); };
    S.alloc = function (side, kind, unitIdx) {
      let r = S.freeList.length ? S.freeList.pop() : S.rows++;
      if (r >= S.cap) grow(r + 1);
      const C = S.cols;
      C.side[r] = side === "blue" || side === 1 ? 1 : 0;
      C.kind[r] = typeof kind === "number" ? kind : (KIND[kind] || 0);
      C.tier[r] = TIER.full; C.life[r] = LIFE.alive;
      C.squad[r] = -1; C.crowdRow[r] = -1; C.unit[r] = unitIdx == null ? -1 : unitIdx;
      for (let i = 0; i < F32.length; i++) C[F32[i]][r] = 0;
      S.ref[r] = null;
      return r;
    };
    S.free = function (r) {
      if (r == null || r < 0 || r >= S.rows || S.cols.life[r] === LIFE.free) return;
      S.cols.life[r] = LIFE.free; S.ref[r] = null; S.freeList.push(r);
    };
    // a FULL unit's object -> its row (cheap: called on a slow tick, not per frame)
    S.sync = function (r, m) {
      const C = S.cols;
      C.x[r] = m.pos.x; C.y[r] = m.pos.y; C.z[r] = m.pos.z;
      C.heading[r] = m.heading || m.yaw || 0;
      C.hp[r] = m.hp; C.maxHp[r] = m.maxHp;
      if (C.squad[r] < 0) C.squad[r] = m.sq == null ? -1 : m.sq;   // a tier owner may have named it already
      C.life[r] = m.dead ? LIFE.dead : m.fled ? LIFE.fled : m.routed ? LIFE.routed : LIFE.alive;
      S.ref[r] = m;
    };
    S.count = function (side, life) {
      const C = S.cols, sd = side === "blue" || side === 1 ? 1 : 0;
      let n = 0;
      for (let r = 0; r < S.rows; r++) {
        if (C.side[r] !== sd || C.life[r] === LIFE.free) continue;
        if (life == null ? C.life[r] !== LIFE.dead && C.life[r] !== LIFE.fled : C.life[r] === life) n++;
      }
      return n;
    };
    S.buffers = function () {
      const o = {};
      for (const k in S.cols) o[k] = S.cols[k].buffer;
      return o;
    };
    return S;
  }
  // the worker's side of a shared store: the same columns, wrapped, no copy
  const CTOR = { Float32Array: Float32Array, Uint8Array: Uint8Array, Int32Array: Int32Array, Int16Array: Int16Array, Uint16Array: Uint16Array };
  function adopt(bufs, types, cap, rows) {
    const S = create(64);
    S.cap = cap; S.rows = rows | 0; S.shared = true;
    S.cols = {};
    for (const k in bufs) S.cols[k] = new CTOR[types[k]](bufs[k]);
    return S;
  }
  function typesOf(S) {
    const o = {};
    for (const k in S.cols) o[k] = S.cols[k].constructor.name;
    return o;
  }
  CBZ.battleStore = { create: create, adopt: adopt, typesOf: typesOf, KIND: KIND, TIER: TIER, LIFE: LIFE, canShare: canShare };
  if (typeof module !== "undefined" && module.exports) module.exports = CBZ.battleStore;
})();
