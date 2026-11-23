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

   SHIPPED BAKES (2026-11-22, Gang City on a phone): a FIRST visit had nothing
   in IndexedDB and paid the whole terrain build (~9 s of a phone-profile
   boot). The default world is the same for every player of a device class, so
   tools/ship-bakes.mjs boots it headless once and writes the records into the
   repo (assets/bakes/city-<device>.json + one gzip binary). This file fetches
   them while the title is up and serves them through the SAME key check: an
   entry is used only when its signature equals the one the builder computes
   on this device, this version, this seed, this config, so a stale or foreign
   file is a miss and the world builds as it always did. A hit is also written
   to IndexedDB, so the next visit is local and downloads nothing. The PLAY
   path waits for the download (core: systems/state.js, CBZ.bakeShipReady,
   capped) because the city build is one synchronous task: a file that lands
   after it starts cannot help it.
     ?cfg_SHIPPED_BAKES=0   never fetch them (build as before)
     ?bake=fresh            IndexedDB only, no shipped file (the generator)
     ?bake=verify           build everything and compare each fresh result
                            byte for byte with the stored or shipped record
============================================================ */
(function () {
  "use strict";
  const CBZ = (window.CBZ = window.CBZ || {});
  let q = null;
  try { q = new URLSearchParams(location.search); } catch (e) { q = null; }
  const mode = q ? q.get("bake") : null;
  const OFF = mode === "0" || mode === "off";
  const NO_IDB = OFF || typeof indexedDB === "undefined";
  const DB = "cbz-bake", STORE = "bake", VER = 1;
  const mem = new Map();          // key -> { sig, arrays }
  const ship = new Map();         // key -> { sig, arrays }   (the shipped file's records)
  const verifyMem = new Map();
  const VERIFY = mode === "verify";
  const stats = { log: [], loaded: 0, hits: 0, misses: 0, puts: 0, ready: false, ms: 0, bytes: 0, err: null, shipHits: 0, ship: { state: "off" } };
  CBZ.bakeStats = stats;

  function open() {
    return new Promise(function (res, rej) {
      const r = indexedDB.open(DB, VER);
      r.onupgradeneeded = function () { try { r.result.createObjectStore(STORE); } catch (e) {} };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
    });
  }
  let dbp = null, dbOpen = null, idbDone = null;
  if (!NO_IDB) {
    const t0 = performance.now();
    dbp = open();
    dbp.then(function (db) { dbOpen = db; }, function () {});
    idbDone = dbp.then(function (db) {
      return new Promise(function (done) {
        if (mode === "clear") { try { db.transaction(STORE, "readwrite").objectStore(STORE).clear(); } catch (e) {} stats.ready = true; done(); return; }
        const tx = db.transaction(STORE, "readonly"), st = tx.objectStore(STORE);
        const cur = st.openCursor();
        cur.onsuccess = function () {
          const c = cur.result;
          if (!c) { stats.ready = true; stats.ms = +(performance.now() - t0).toFixed(1); done(); return; }
          const v = c.value;
          if (v && v.sig && v.arrays) {
            mem.set(c.key, v); stats.loaded++;
            for (const k in v.arrays) if (v.arrays[k] && v.arrays[k].byteLength) stats.bytes += v.arrays[k].byteLength;
          }
          c.continue();
        };
        cur.onerror = function () { stats.ready = true; stats.err = String(cur.error); done(); };
      });
    }).catch(function (e) { stats.ready = true; stats.err = String(e); });
  } else { stats.ready = true; idbDone = Promise.resolve(); }

  /* The shared half of every signature: the world seed and the version key of
     every script whose code shapes terrain. (A script without ?v= contributes
     its bare name, so an unversioned edit on a dev box is not caught; the
     release flow bumps ?v= on every change.)
     worldplan (reliefAt, macroAt), forestlook (the plate's wood floor and the
     backcountry stands) and textures_surface (groundLinear, the plate's
     colour decode) feed baked arrays too and were missing: an edit to any of
     them served the old arrays. A shipped bake lives for a whole release, so
     every input it reads has to be in here. */
  let _sigBase = null;
  const TERRAIN_FILES = /\/(continent|river|waterfield|worldmap|worldplan|forestlook|textures_surface|biome_[a-z]+|terrain[a-z_]*|mountain_detail|alpine_skin|rockscliffs|layout|seed|cityground|highwaynet|highways|settlements|landscape[a-z_]*|water_survival|config|beach)\.js/;   // beach: city/beach.js shapes the south shoreline (CBZ.cityBeachBulge)
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
  /* CONFIG keys that cannot shape terrain but differ by device class or by
     run. Builders hash the whole of CBZ.CONFIG (cfg: CFG); these made a
     phone's key differ from a tablet's (light and crowd budgets) and the
     shipped-bake switch made an A/B its own key. Left out of every hash. */
  // (tools/ship-bakes.mjs prints the CONFIG keys that still differ between
  // phone and tablet; each one is a second shipped file instead of one)
  const NOT_TERRAIN = { SHIPPED_BAKES: 1, SHIPPED_BAKES_WAIT_MS: 1, LIGHT_BUDGET_POINT: 1, LIGHT_BUDGET_SPOT: 1,
    PHONE_PED_BUDGET: 1, PED_SIM_BUDGET_MS: 1, PHONE_PERSON_RECORD: 1,
    STATIC_MATRIX_FREEZE: 1, MATRIX_SKIP_HIDDEN: 1 };
  // a compact, order-sensitive fingerprint of plain data (regions, bodies)
  CBZ.bakeHash = function (v) {
    let h = 2166136261 >>> 0;
    const str = typeof v === "string" ? v : JSON.stringify(v, function (k, x) {
      if (k && k.charCodeAt(0) === 95) return undefined;          // _caches are not inputs
      if (this === CBZ.CONFIG && NOT_TERRAIN[k]) return undefined;
      if (x && (x.isObject3D || x.isMaterial || x.isBufferGeometry)) return undefined;
      return typeof x === "number" ? Math.round(x * 1000) / 1000 : x;
    }) || "";
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h.toString(36) + ":" + str.length;
  };

  // the same for a typed array (every byte; four at a time where the array
  // allows: the continent's built-ground grids are 320 KB, hashed per boot)
  CBZ.bakeHashArr = function (ta) {
    if (!ta) return "-";
    let h = 2166136261 >>> 0, h2 = 5381;
    const n = ta.byteLength;
    if ((ta.byteOffset & 3) === 0 && (n & 3) === 0) {
      const w = new Uint32Array(ta.buffer, ta.byteOffset, n >> 2);
      for (let i = 0; i < w.length; i++) { const x = w[i]; h ^= x; h = Math.imul(h, 16777619) >>> 0; h2 = (Math.imul(h2, 33) + x) | 0; }
    } else {
      const u = new Uint8Array(ta.buffer, ta.byteOffset, n);
      for (let i = 0; i < u.length; i++) { h ^= u[i]; h = Math.imul(h, 16777619) >>> 0; h2 = ((h2 << 5) + h2 + u[i]) | 0; }
    }
    return h.toString(36) + (h2 >>> 0).toString(36) + ":" + n;
  };

  // a hit from the shipped file becomes this device's own record
  function keepLocal(key, e) {
    if (!dbOpen) return;
    try { dbOpen.transaction(STORE, "readwrite").objectStore(STORE).put({ sig: e.sig, arrays: e.arrays, at: Date.now(), shipped: 1 }, key); }
    catch (err) { stats.err = String(err); }
  }

  CBZ.bakeGet = function (key, sig) {
    if (OFF) return null;
    const e = mem.get(key);
    // one use per load: the builder owns the arrays from here, and nothing
    // stays resident twice
    // ?bake=verify: never serve the cache; bakePut compares the fresh result
    // with the stored one byte for byte (stats.verified / stats.mismatch)
    if (e && e.sig === sig && VERIFY) { verifyMem.set(key, e); stats.log.push("verify " + key); return null; }
    if (e && e.sig === sig) { stats.hits++; stats.log.push("hit " + key); mem.delete(key); return e.arrays; }
    const s = ship.get(key);
    if (s && s.sig === sig && VERIFY) { verifyMem.set(key, s); ship.delete(key); stats.log.push("verify shipped " + key); return null; }
    if (s && s.sig === sig) {
      stats.hits++; stats.shipHits++; stats.log.push("hit shipped " + key); ship.delete(key);
      // (put snapshots the arrays now, before the builder owns them)
      keepLocal(key, s);
      shipUseful();
      return s.arrays;
    }
    stats.misses++; stats.log.push("miss " + key + (e ? " (stale)" : "") + (s ? " (shipped stale)" : ""));
    if (s) { ship.delete(key); shipStale(); }
    // THE BUILD STARTED WITHOUT THE FILE (it is one synchronous task, so the
    // download cannot land inside it): stop the download, it can only cost.
    if (shipBusy()) shipAbort("late: the build started first");
    // A STALE ENTRY CAN NEVER BE SERVED THIS LOAD (the signature is fixed for
    // the page's life), yet it was read into memory at parse and sat there
    // for the whole session: after every update, the old terrain bake (the
    // continent plate, the ranges, the erg: tens of MB) rode along beside the
    // fresh one. Drop it the moment it misses; bakePut replaces it on disk.
    if (e) mem.delete(key);
    return null;
  };
  CBZ.bakePut = function (key, sig, arrays) {
    if (OFF) return;
    const v = verifyMem.get(key);
    if (v) {
      verifyMem.delete(key);
      // every array the stored record holds must match (a shipped record
      // leaves out what is cheaper to recompute than to download)
      let bad = 0;
      for (const k in v.arrays) {
        const a = arrays[k], b = v.arrays[k];
        if (!a || !b || a.length !== b.length) { bad++; stats.log.push("MISMATCH " + key + "." + k + " (length)"); continue; }
        const ua = new Uint8Array(a.buffer, a.byteOffset, a.byteLength), ub = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
        for (let i = 0; i < ua.length; i++) if (ua[i] !== ub[i]) { bad++; stats.log.push("MISMATCH " + key + "." + k + " at byte " + i); break; }
      }
      if (bad) { stats.mismatch = (stats.mismatch || 0) + 1; stats.log.push("MISMATCH " + key); } else { stats.verified = (stats.verified || 0) + 1; }
      return;
    }
    if (!dbp) return;
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

  /* ---- SHIPPED BAKES: the loader -------------------------------------------
     FORMAT (tools/ship-bakes.mjs writes it):
       city-<device>.json  { v, id, seed, file, raw, gz, entries: [{ key, sig, bytes }] }
       <file>              gzip of: "CBZB" u32 version u32 headerLen, header
                           JSON (the entries with their arrays: name, type,
                           length, offset, byte-plane shuffle), then the
                           arrays, each at an 8-byte aligned offset. A smooth
                           float array is stored BYTE-SHUFFLED (every
                           element's byte 0, then every byte 1, ...): the
                           same bytes, in an order gzip packs ~15-30%
                           tighter (the generator keeps whichever is smaller).
     The json is a few KB; the binary is fetched only when IndexedDB does not
     already hold every one of its records. */
  const SHIP_ON = !OFF && mode !== "fresh" && !(CBZ.CONFIG && CBZ.CONFIG.SHIPPED_BAKES === false)
    && typeof fetch === "function" && typeof Response === "function" && typeof DecompressionStream === "function";
  const SS = stats.ship;
  SS.state = SHIP_ON ? "idle" : "off";
  let shipP = null, shipCtl = null, shipMan = null;
  // where the repo root is, from this file's own tag (pages under games/ too)
  let ROOT = "";
  try {
    const cs = document.currentScript && document.currentScript.src;
    ROOT = cs ? cs.replace(/src\/core\/bakecache\.js(?:[?#].*)?$/, "") : "";
    if (ROOT === cs) ROOT = "";
  } catch (e) { ROOT = ""; }
  // (joined, not one literal: tools/build-ios.mjs copies every assets folder
  // a quoted path names into the disaster app, which builds no city)
  const SHIP_DIR = ["assets", "bakes", ""].join("/");
  function shipUrl(name) { try { return new URL(SHIP_DIR + name, ROOT || document.baseURI).href; } catch (e) { return SHIP_DIR + name; } }
  function shipBusy() { return !!shipP && (SS.state === "manifest" || SS.state === "fetch" || SS.state === "decode"); }
  function shipAbort(why) {
    SS.state = "aborted"; SS.err = why;
    try { if (shipCtl) shipCtl.abort(); } catch (e) {}
    ship.clear();
  }
  // a file whose records never match this device (its config, a setting, an
  // old file) is remembered, so a returning player stops downloading it
  const STALE_KEY = "cbz.bakeship.stale";
  let staleNoted = false, usefulNoted = false;
  function shipStale() {
    if (staleNoted || usefulNoted || !shipMan) return;
    staleNoted = true;
    try { localStorage.setItem(STALE_KEY, JSON.stringify({ id: shipMan.id, q: location.search })); } catch (e) {}
  }
  function shipUseful() {
    if (usefulNoted) return;
    usefulNoted = true;
    try { localStorage.removeItem(STALE_KEY); } catch (e) {}
  }
  function seedNow() {
    let s = CBZ.CONFIG && CBZ.CONFIG.WORLD_SEED != null ? CBZ.CONFIG.WORLD_SEED : 90210;   // mirrors core/seed.js
    const v = q ? q.get("seed") : null;
    if (v != null && v !== "" && isFinite(+v)) s = +v;
    return s >>> 0;
  }
  const ARR = { Float32Array: Float32Array, Float64Array: Float64Array, Uint32Array: Uint32Array, Int32Array: Int32Array,
    Uint16Array: Uint16Array, Int16Array: Int16Array, Uint8Array: Uint8Array, Int8Array: Int8Array };
  function decode(buf, want) {
    const u8 = new Uint8Array(buf);
    if (!(u8[0] === 67 && u8[1] === 66 && u8[2] === 90 && u8[3] === 66)) throw new Error("not a CBZB file");
    const dv = new DataView(buf);
    const hl = dv.getUint32(8, true);
    const head = JSON.parse(new TextDecoder().decode(u8.subarray(12, 12 + hl)));
    const base = (12 + hl + 7) & ~7;
    let n = 0;
    for (const e of head.entries) {
      if (!want.has(e.key)) continue;
      const arrays = {};
      for (const a of e.arrays) {
        const T = ARR[a.type];
        if (!T) throw new Error("array type " + a.type);
        const bpe = T.BYTES_PER_ELEMENT, nb = a.length * bpe, src = base + a.offset;
        if (src + nb > u8.length) throw new Error("truncated at " + e.key);
        const out = new Uint8Array(nb), L = a.length;
        if (a.shuffle > 1 && (bpe === 4 || bpe === 8)) {
          // byte plane b of element i sits at b * length + i; whole 32-bit
          // words are rebuilt at once (every engine this runs on is
          // little-endian, as is the machine that wrote the file)
          const w = new Uint32Array(out.buffer), half = bpe === 8 ? 2 : 1;
          for (let k = 0; k < half; k++) {
            const p0 = src + (k * 4) * L, p1 = p0 + L, p2 = p1 + L, p3 = p2 + L;
            for (let i = 0, o = k; i < L; i++, o += half) w[o] = u8[p0 + i] | (u8[p1 + i] << 8) | (u8[p2 + i] << 16) | (u8[p3 + i] << 24);
          }
        } else if (a.shuffle > 1) {
          for (let b = 0; b < bpe; b++) {
            const p = src + b * L;
            for (let i = 0, o = b; i < L; i++, o += bpe) out[o] = u8[p + i];
          }
        } else out.set(u8.subarray(src, src + nb));
        arrays[a.name] = new T(out.buffer);
      }
      ship.set(e.key, { sig: e.sig, arrays: arrays }); n++;
    }
    return n;
  }
  function shipStart() {
    if (shipP || !SHIP_ON) return shipP || Promise.resolve(false);
    const t0 = performance.now();
    const dev = CBZ.deviceClass || "desktop";
    SS.state = "manifest"; SS.device = dev;
    try { shipCtl = typeof AbortController === "function" ? new AbortController() : null; } catch (e) { shipCtl = null; }
    const sig = shipCtl ? shipCtl.signal : undefined;
    shipP = fetch(shipUrl("city-" + dev + ".json"), { signal: sig }).then(function (r) {
      if (!r.ok) throw new Error("no shipped bakes for " + dev + " (" + r.status + ")");
      return r.json();
    }).then(function (man) {
      if (SS.state === "aborted") return false;
      if (!man || man.v !== 1 || !Array.isArray(man.entries)) throw new Error("bad manifest");
      shipMan = man;
      SS.id = man.id; SS.file = man.file; SS.gz = man.gz; SS.raw = man.raw;
      // a device class nothing was shipped for says so (no 404 per start)
      if (!man.file || !man.entries.length) { SS.state = "none"; return false; }
      if ((man.seed >>> 0) !== seedNow()) { SS.state = "skip"; SS.err = "seed " + seedNow() + " is not the shipped " + man.seed; return false; }
      try {
        const st = JSON.parse(localStorage.getItem(STALE_KEY) || "null");
        if (st && st.id === man.id && st.q === location.search) { SS.state = "skip"; SS.err = "known stale here"; return false; }
      } catch (e) {}
      // IndexedDB first: whatever it already holds is not downloaded again
      return Promise.resolve(idbDone).then(function () {
        if (SS.state === "aborted") return false;
        const want = new Set();
        for (const e of man.entries) { const m = mem.get(e.key); if (!(m && m.sig === e.sig)) want.add(e.key); }
        SS.want = want.size;
        if (!want.size) { SS.state = "local"; return false; }
        SS.state = "fetch";
        return fetch(shipUrl(man.file), { signal: sig, priority: "low" }).then(function (r) {
          if (!r.ok) throw new Error("shipped bake file " + r.status);
          return r.arrayBuffer();
        }).then(function (buf) {
          if (SS.state === "aborted") return false;
          SS.fetchMs = +(performance.now() - t0).toFixed(0);
          SS.state = "decode";
          const h = new Uint8Array(buf, 0, 2);
          // a host that already sent it Content-Encoding: gzip hands over raw bytes
          if (h[0] === 0x1f && h[1] === 0x8b) {
            return new Response(new Response(buf).body.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
          }
          return buf;
        }).then(function (raw) {
          if (!raw || SS.state === "aborted") return false;
          const n = decode(raw, want);
          SS.state = "ready"; SS.records = n; SS.ms = +(performance.now() - t0).toFixed(0);
          return true;
        });
      });
    }).catch(function (e) {
      if (SS.state !== "aborted") { SS.state = "failed"; SS.err = String(e && e.message || e); }
      ship.clear();
      return false;
    });
    return shipP;
  }
  /* CBZ.bakeShipReady(capMs) -> Promise: resolves when the shipped records
     are in memory, or known absent, or after capMs (default 10 s): the PLAY
     path awaits it before the city build. Starts the download if the page
     did not open on the city. */
  CBZ.bakeShipReady = function (capMs) {
    if (!SHIP_ON) return Promise.resolve(false);
    const p = shipStart();
    if (!shipBusy()) return p;
    const cap = capMs != null ? capMs : (+(CBZ.CONFIG && CBZ.CONFIG.SHIPPED_BAKES_WAIT_MS) || 10000);
    return Promise.race([p, new Promise(function (r) { setTimeout(function () { r(false); }, cap); })]);
  };
  // a page that opens on Gang City starts the download now, behind the title
  if (SHIP_ON && CBZ.game && CBZ.game.mode === "city") shipStart();
})();
