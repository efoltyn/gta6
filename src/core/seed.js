/* ============================================================
   core/seed.js — THE METHOD BEHIND THE RANDOMNESS.

   One world seed; everything derives from it. Three tools:

   1. CBZ.WORLD_SEED — the single knob (CBZ.CONFIG.WORLD_SEED or the
      classic 90210). Change it → a different, fully coherent world.

   2. CBZ.seedStream(name) — a named, isolated, deterministic stream
      (mulberry32 seeded by hash(WORLD_SEED, name)). Replaces the ten+
      magic literal seeds scattered across biome/island files
      (0x51420, 0x5dec7, 990217, …). Each subsystem gets its own
      stream, so adding a draw in one file can never shift another
      file's layout — the fragility every "preserve RNG order"
      comment in this codebase is straining against.

   3. CBZ.hash01(x, z, salt) / CBZ.hashN(...ints) — ORDER-INDEPENDENT
      position-hash randomness (Squirrel3-style avalanche, per
      Eiserloh's GDC "Noise-Based RNG"). The value AT a place, not
      the Nth value of a sequence: lot #23's building can be decided
      without generating lots 0–22, in any order, lazily, forever
      reproducibly. Use this for anything keyed to a location.

   Multiplayer note: world builds must stay byte-identical across
   clients. They are — everything still derives deterministically
   from WORLD_SEED, which defaults to a constant.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ = window.CBZ || {};

  // ---- Squirrel3-style integer avalanche hash ----
  const N1 = 0xb5297a4d, N2 = 0x68e31da4, N3 = 0x1b56c4e9;
  function squirrel(n, seed) {
    let m = n >>> 0;
    m = Math.imul(m, N1) >>> 0;
    m = (m + (seed >>> 0)) >>> 0;
    m ^= m >>> 8;
    m = (m + N2) >>> 0;
    m ^= (m << 8) >>> 0;
    m = Math.imul(m, N3) >>> 0;
    m ^= m >>> 8;
    return m >>> 0;
  }
  // fold arbitrarily many integers into one hash (order matters, as it should)
  function hashN() {
    let h = CBZ.WORLD_SEED >>> 0;
    for (let i = 0; i < arguments.length; i++) h = squirrel(arguments[i] | 0, h);
    return h;
  }
  // string → int (for named streams)
  function strHash(s) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h >>> 0;
  }

  // ---- the world seed (one knob) ----
  // priority: ?seed=N in the URL (shareable worlds, seed farming) →
  // CBZ.CONFIG.WORLD_SEED → the classic 90210.
  const cfg = CBZ.CONFIG || {};
  let seed = cfg.WORLD_SEED != null ? cfg.WORLD_SEED : 90210;
  try {
    const q = new URLSearchParams(location.search).get("seed");
    if (q != null && q !== "" && isFinite(+q)) seed = +q;
  } catch (e) {}
  CBZ.WORLD_SEED = seed >>> 0;

  // ---- named deterministic stream (mulberry32) ----
  CBZ.seedStream = function (name) {
    let a = squirrel(strHash(String(name)), CBZ.WORLD_SEED);
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  // ---- position-hash randomness (order-independent) ----
  // hash01(x, z, salt) → [0,1). Quantizes world coords to decimetres so
  // float dust can't flip a value; distinct salts give independent channels.
  CBZ.hashN = hashN;
  CBZ.hash01 = function (x, z, salt) {
    return hashN(Math.round(x * 10), Math.round(z * 10), salt | 0) / 4294967296;
  };
  // hashPick(list, x, z, salt) — order-independent weighted/plain pick
  CBZ.hashPick = function (list, x, z, salt) {
    if (!list || !list.length) return null;
    return list[(CBZ.hash01(x, z, salt) * list.length) | 0];
  };
})();
