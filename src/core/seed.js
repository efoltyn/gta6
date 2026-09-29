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
  // Written in int32 space: every step is a 32-bit ring operation, so the bits
  // are the same whether the intermediate is read as int32 or uint32 — and
  // int32 stays a V8 small integer, where the old `>>> 0` after every step
  // pushed values above 2^31 into heap doubles. Callers that want the
  // unsigned value do the one `>>> 0` at the end. BIT-IDENTICAL to the
  // original (checked over 10M random inputs, tools/world-hash.mjs agrees).
  const N1 = 0xb5297a4d | 0, N2 = 0x68e31da4 | 0, N3 = 0x1b56c4e9 | 0;
  function sq(n, seed) {
    let m = (Math.imul(n, N1) + seed) | 0;
    m ^= m >>> 8;
    m = (m + N2) | 0;
    m ^= m << 8;
    m = Math.imul(m, N3);
    return m ^ (m >>> 8);
  }
  function squirrel(n, seed) { return sq(n | 0, seed | 0) >>> 0; }
  // fold arbitrarily many integers into one hash (order matters, as it should)
  function hashN() {
    let h = seedRaw >>> 0;
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
  // An accessor over a closure variable: CBZ carries hundreds of properties
  // (dictionary mode), so `CBZ.WORLD_SEED` inside the hash was a hash-table
  // lookup per call, millions of calls per build. The hash reads the local;
  // assigning CBZ.WORLD_SEED still works exactly as before.
  let seedRaw = seed >>> 0;
  Object.defineProperty(CBZ, "WORLD_SEED", {
    configurable: true, enumerable: true,
    get: function () { return seedRaw; },
    set: function (v) { if (v !== seedRaw) { seedRaw = v; noiseForget(); } },
  });

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
  // The three squirrel rounds are written out rather than routed through
  // hashN: this is the single hottest function in the world build (~6% of
  // the whole 20-30 s freeze is spent in this file), and the arguments-object
  // fold was pure overhead on a call with a fixed arity. BIT-IDENTICAL to
  // hashN(round(x*10), round(z*10), salt|0) — same rounds, same order, same
  // seed — so every world it generates is byte-for-byte the world it
  // generated before (the determinism gate agrees).
  CBZ.hash01 = function (x, z, salt) {
    const h = sq(salt | 0, sq(Math.round(z * 10) | 0, sq(Math.round(x * 10) | 0, seedRaw | 0)));
    return (h >>> 0) / 4294967296;
  };
  /* noise2(x, z, cell, salt) — THE value noise: four hash01 lattice corners
     (at world coords ix*cell, iz*cell), smoothstep-blended. Three files each
     had their own copy (world/mountain_detail.js n2, city/continent.js
     noise2, and every caller of CBZ.mtnNoise) and together they are most of
     the landmass build. Same corners, same arithmetic, same result to the
     bit — but the x-round of the hash is shared by the two corners in each
     column (10 squirrel rounds instead of 12) and there is no call through
     hash01 per corner. */
  function smooth(t) { return t * t * (3 - 2 * t); }
  // A small direct-mapped memo of lattice CELLS: slot = f(cell, salt), and a
  // slot remembers the last lattice cell it saw and its four corner values.
  // The fields ask the same cell over and over (mtnErode's three taps per
  // octave, the memo grids stepping 6 m through 100-1750 m cells), so most
  // calls skip the hashing. Corner values are exact hash outputs, a slot is
  // only reused on an exact (cell, salt, ix, iz) match: same bits out.
  const NSLOT = 256;
  const slotKey = new Float64Array(NSLOT * 4).fill(NaN);   // cell, salt, ix, iz
  const slotVal = new Float64Array(NSLOT * 4);             // a, b, c, d
  CBZ.noise2 = function (x, z, cell, salt) {
    const gx = x / cell, gz = z / cell;
    const ix = Math.floor(gx), iz = Math.floor(gz);
    const fx = smooth(gx - ix), fz = smooth(gz - iz);
    salt |= 0;
    const k = ((Math.imul(salt, 0x9e3779b1) + ((cell * 64) | 0) * 0x2545) >>> 24) << 2;
    let a, b, c, d;
    if (slotKey[k + 2] === ix && slotKey[k + 3] === iz && slotKey[k] === cell && slotKey[k + 1] === salt) {
      a = slotVal[k]; b = slotVal[k + 1]; c = slotVal[k + 2]; d = slotVal[k + 3];
    } else {
      const seed = seedRaw | 0;
      const hx0 = sq(Math.round(ix * cell * 10) | 0, seed);
      const hx1 = sq(Math.round((ix + 1) * cell * 10) | 0, seed);
      const zr0 = Math.round(iz * cell * 10) | 0, zr1 = Math.round((iz + 1) * cell * 10) | 0;
      a = (sq(salt, sq(zr0, hx0)) >>> 0) / 4294967296;
      b = (sq(salt, sq(zr0, hx1)) >>> 0) / 4294967296;
      c = (sq(salt, sq(zr1, hx0)) >>> 0) / 4294967296;
      d = (sq(salt, sq(zr1, hx1)) >>> 0) / 4294967296;
      slotKey[k] = cell; slotKey[k + 1] = salt; slotKey[k + 2] = ix; slotKey[k + 3] = iz;
      slotVal[k] = a; slotVal[k + 1] = b; slotVal[k + 2] = c; slotVal[k + 3] = d;
    }
    const ab = a + (b - a) * fx, cd = c + (d - c) * fx;
    return ab + (cd - ab) * fz;
  };
  // the seed is part of every corner: a new seed forgets the memo
  function noiseForget() { slotKey.fill(NaN); }
  // hashPick(list, x, z, salt) — order-independent weighted/plain pick
  CBZ.hashPick = function (list, x, z, salt) {
    if (!list || !list.length) return null;
    return list[(CBZ.hash01(x, z, salt) * list.length) | 0];
  };
})();
