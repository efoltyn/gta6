/* ============================================================
   battle/core/store.js — THE UNIT STORE. Every unit on the field is a ROW:
   a handful of numbers in typed arrays. Page-independent (no DOM, no THREE).

   WHY. The goal is 100 000 men a side without losing quality, logic or
   looks. Objects with THREE groups cannot do that; rows can. The rule the
   scale agent builds on (docs/npcwar/ARCHITECTURE.md, "Scale"):
     FULL  near the lens / the player / anything a full unit is fighting:
           a full rig and the full brain (the per-unit objects in `men`
           today, each pointing at its row through m.row)
     MID   a cheaper but faithful individual sim: same rules, coarser tick
     FAR   squad/formation sim, statistically equivalent (same kill rates,
           same morale outcomes), drawn through entities/crowdgpu.js (the
           real CBZ.human, GPU-instanced with baked animation) via a row in
           entities/crowdstore.js (`crowdRow`), impostors beyond that
   The store does not draw and does not think; it is the ledger every tier
   shares, so promotion/demotion is a change of `tier`, not a new object.

   COLUMNS (index = row)
     side u8 (0 = first slot "red", 1 = second "blue")   kind u8 (KIND)
     tier u8 (TIER)   life u8 (0 free, 1 alive, 2 routed, 3 fled, 4 dead)
     x y z heading vx vz hp maxHp morale   f32
     squad i32   crowdRow i32 (-1 = not instanced)   unit i32 (unit-type index)
   ref[] holds the FULL tier's object for a row (null for MID/FAR rows).

   PUBLIC  CBZ.battleStore.create(cap?) -> S
     S.alloc(side, kind, unitIdx) -> row     S.free(row)
     S.sync(row, m)          copy a full unit's live state into its row
     S.count(side, life?)    S.rows (high-water mark)   S.cols (the arrays)
   CBZ.battleStore.KIND / TIER / LIFE
============================================================ */
(function () {
  "use strict";
  const W = typeof window !== "undefined" ? window : globalThis;
  const CBZ = W.CBZ || (W.CBZ = {});
  const KIND = { man: 0, beast: 1, vehicle: 2 };
  const TIER = { full: 0, mid: 1, far: 2 };
  const LIFE = { free: 0, alive: 1, routed: 2, fled: 3, dead: 4 };
  const F32 = ["x", "y", "z", "heading", "vx", "vz", "hp", "maxHp", "morale"];
  const U8 = ["side", "kind", "tier", "life"];
  const I32 = ["squad", "crowdRow", "unit"];

  function create(cap) {
    cap = Math.max(64, cap | 0 || 1024);
    const S = { cap: cap, rows: 0, cols: {}, ref: [], freeList: [] };
    function alloc(n) {
      const c = {};
      F32.forEach(function (k) { c[k] = new Float32Array(n); });
      U8.forEach(function (k) { c[k] = new Uint8Array(n); });
      I32.forEach(function (k) { c[k] = new Int32Array(n).fill(-1); });
      return c;
    }
    S.cols = alloc(cap);
    // grows by doubling: a battle never has to guess its size up front
    function grow() {
      const n = S.cap * 2, c = alloc(n);
      for (const k in c) c[k].set(S.cols[k]);
      S.cols = c; S.cap = n;
    }
    S.alloc = function (side, kind, unitIdx) {
      let r = S.freeList.length ? S.freeList.pop() : S.rows++;
      if (r >= S.cap) grow();
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
      C.squad[r] = m.sq == null ? -1 : m.sq;
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
    return S;
  }
  CBZ.battleStore = { create: create, KIND: KIND, TIER: TIER, LIFE: LIFE };
  if (typeof module !== "undefined" && module.exports) module.exports = CBZ.battleStore;
})();
