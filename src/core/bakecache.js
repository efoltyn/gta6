/* ============================================================
   core/bakecache.js — THE WORLD IS BAKED ONCE PER VERSION, NOT ONCE PER VISIT.

   Owner, 2026-09-29: the jail opens on his phone in ~4 s and Gang City took
   16. Most of the difference is TERRAIN: the continent plate (224k vertices,
   ~20 field evaluations each), the Greater Mercy range and the desert erg are
   pure functions of the seed, the code and what the builders registered, and
   every visit recomputed them from scratch.

   This file keeps those results in IndexedDB. A builder asks
       const hit = CBZ.bakeGet("continent-plate", sig);   // sync, or null
   and on a miss computes as always, then
       CBZ.bakePut("continent-plate", sig, { y: Float32Array, ... });
   The signature is the builder's own statement of its inputs (the counts and
   bounds of what it read, its segment counts), and CBZ.bakeSig() mixes in the
   seed and the ?v= of every script that shapes terrain. Change any of them and
   the entry is simply a miss: never stale, only recomputed.

   The read is ASYNC, so it starts the moment this file parses and finishes
   long before PLAY (a few MB from disk). A build that starts before it lands
   computes, exactly as before. ?bake=0 turns it off; ?bake=clear empties it.
   Nothing here changes a single value: a hit returns the arrays the same code
   produced last time.
============================================================ */
(function () {
  "use strict";
  const CBZ = (window.CBZ = window.CBZ || {});
  let q = null;
  try { q = new URLSearchParams(location.search); } catch (e) { q = null; }
  const mode = q ? q.get("bake") : null;
  const OFF = mode === "0" || mode === "off" || typeof indexedDB === "undefined";
  const DB = "cbz-bake", STORE = "bake", VER = 1;
  const mem = new Map();          // key -> { sig, arrays }
  const verifyMem = new Map();
  const VERIFY = mode === "verify";
  const stats = { log: [], loaded: 0, hits: 0, misses: 0, puts: 0, ready: false, ms: 0, bytes: 0, err: null };
  CBZ.bakeStats = stats;

  function open() {
    return new Promise(function (res, rej) {
      const r = indexedDB.open(DB, VER);
      r.onupgradeneeded = function () { try { r.result.createObjectStore(STORE); } catch (e) {} };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
    });
  }
  let dbp = null, dbOpen = null;
  if (!OFF) {
    const t0 = performance.now();
    dbp = open();
    dbp.then(function (db) { dbOpen = db; }, function () {});
    dbp.then(function (db) {
      if (mode === "clear") { try { db.transaction(STORE, "readwrite").objectStore(STORE).clear(); } catch (e) {} stats.ready = true; return; }
      const tx = db.transaction(STORE, "readonly"), st = tx.objectStore(STORE);
      const cur = st.openCursor();
      cur.onsuccess = function () {
        const c = cur.result;
        if (!c) { stats.ready = true; stats.ms = +(performance.now() - t0).toFixed(1); return; }
        const v = c.value;
        if (v && v.sig && v.arrays) {
          mem.set(c.key, v); stats.loaded++;
          for (const k in v.arrays) if (v.arrays[k] && v.arrays[k].byteLength) stats.bytes += v.arrays[k].byteLength;
        }
        c.continue();
      };
      cur.onerror = function () { stats.ready = true; stats.err = String(cur.error); };
    }).catch(function (e) { stats.ready = true; stats.err = String(e); });
  } else stats.ready = true;

  /* The shared half of every signature: the world seed and the version key of
     every script whose code shapes terrain. (A script without ?v= contributes
     its bare name, so an unversioned edit on a dev box is not caught; the
     release flow bumps ?v= on every change.) */
  let _sigBase = null;
  const TERRAIN_FILES = /\/(continent|river|waterfield|worldmap|biome_[a-z]+|terrain[a-z_]*|mountain_detail|alpine_skin|rockscliffs|layout|seed|cityground|highwaynet|highways|settlements|landscape[a-z_]*|water_survival|config)\.js/;
  CBZ.bakeSig = function (own) {
    if (_sigBase == null) {
      let s = "seed:" + (CBZ.WORLD_SEED != null ? CBZ.WORLD_SEED : (CBZ.CONFIG && CBZ.CONFIG.WORLD_SEED));
      const tags = document.getElementsByTagName("script");
      for (let i = 0; i < tags.length; i++) {
        const src = tags[i].getAttribute("src") || "";
        if (TERRAIN_FILES.test(src)) s += "|" + src.replace(/^.*\/src\//, "");
      }
      _sigBase = s;
    }
    return _sigBase + "||" + own;
  };
  // a compact, order-sensitive fingerprint of plain data (regions, bodies)
  CBZ.bakeHash = function (v) {
    let h = 2166136261 >>> 0;
    const str = typeof v === "string" ? v : JSON.stringify(v, function (k, x) {
      if (k && k.charCodeAt(0) === 95) return undefined;          // _caches are not inputs
      if (x && (x.isObject3D || x.isMaterial || x.isBufferGeometry)) return undefined;
      return typeof x === "number" ? Math.round(x * 1000) / 1000 : x;
    }) || "";
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h.toString(36) + ":" + str.length;
  };

  // the same for a typed array (every byte)
  CBZ.bakeHashArr = function (ta) {
    if (!ta) return "-";
    const u = new Uint8Array(ta.buffer, ta.byteOffset, ta.byteLength);
    let h = 2166136261 >>> 0, h2 = 5381;
    for (let i = 0; i < u.length; i++) { h ^= u[i]; h = Math.imul(h, 16777619) >>> 0; h2 = ((h2 << 5) + h2 + u[i]) | 0; }
    return h.toString(36) + (h2 >>> 0).toString(36) + ":" + u.length;
  };

  CBZ.bakeGet = function (key, sig) {
    if (OFF) return null;
    const e = mem.get(key);
    // one use per load: the builder owns the arrays from here, and nothing
    // stays resident twice
    // ?bake=verify: never serve the cache; bakePut compares the fresh result
    // with the stored one byte for byte (stats.verified / stats.mismatch)
    if (e && e.sig === sig && VERIFY) { verifyMem.set(key, e); stats.log.push("verify " + key); return null; }
    if (e && e.sig === sig) { stats.hits++; stats.log.push("hit " + key); mem.delete(key); return e.arrays; }
    stats.misses++; stats.log.push("miss " + key + (e ? " (stale)" : ""));
    return null;
  };
  CBZ.bakePut = function (key, sig, arrays) {
    if (OFF || !dbp) return;
    const v = verifyMem.get(key);
    if (v) {
      verifyMem.delete(key);
      let bad = 0;
      for (const k in arrays) {
        const a = arrays[k], b = v.arrays[k];
        if (!a || !b || a.length !== b.length) { bad++; continue; }
        const ua = new Uint8Array(a.buffer, a.byteOffset, a.byteLength), ub = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
        for (let i = 0; i < ua.length; i++) if (ua[i] !== ub[i]) { bad++; break; }
      }
      if (bad) { stats.mismatch = (stats.mismatch || 0) + 1; stats.log.push("MISMATCH " + key); } else { stats.verified = (stats.verified || 0) + 1; }
      return;
    }
    stats.puts++;
    /* The database is open (it opens at parse, long before any build): put
       NOW. IndexedDB's structured clone snapshots the arrays synchronously
       inside put(), so the builder may edit its arrays afterwards, and no
       second copy of 15 MB terrain arrays sits in the heap for 3 s at the
       build's peak (first visit). */
    if (dbOpen) {
      try { dbOpen.transaction(STORE, "readwrite").objectStore(STORE).put({ sig: sig, arrays: arrays, at: Date.now() }, key); return; }
      catch (e) { stats.err = String(e); }
    }
    // not open yet: own copies (the builder keeps, and may later edit, its arrays)
    const copy = {};
    for (const k in arrays) copy[k] = arrays[k] && arrays[k].slice ? arrays[k].slice() : arrays[k];
    const rec = { sig: sig, arrays: copy, at: Date.now() };
    // written after the frame that needs the CPU: never inside the build
    setTimeout(function () {
      dbp.then(function (db) {
        try { db.transaction(STORE, "readwrite").objectStore(STORE).put(rec, key); } catch (e) { stats.err = String(e); }
      }).catch(function () {});
    }, 3000);
  };
})();
