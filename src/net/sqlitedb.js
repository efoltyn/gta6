/* ============================================================
   net/sqlitedb.js — S5 (BUILD-PLAN.md Stage S): sqlite-wasm single-player
   parity. "math and SQLite make the game smart" (MASTER-PLAN Part VII)
   without a server: this file gives single-player the SAME chunked-blob +
   people/structures table layout server/db.js built in S1-S4, so the
   5-8MB-a-full-world math in that file's own header (VII.1) stops being
   bounded by localStorage's ~5MB-ish quota the way it's bounded by
   wsmini.js's old 1.5MB socket cap server-side.

   REALITY CHECK FIRST (what single-player persistence actually is today,
   BEFORE this file existed): city/worldstate.js owns ONE object
   (`g.cityWorld`, STORE_KEY "CBZ_CITY_WORLD_V2") holding cash/bank/
   inventory/records/politics/factions — and roughly twenty OTHER files
   (familytree.js, baseclaim.js, basesave.js/building.js's pieces, bank.js,
   pawnshop.js, every sim/* money module, every P-wave political module…)
   each wrap CBZ.cityWorldCommit/cityWorldCollect to stamp their OWN
   serialize() output onto that SAME object before worldstate.js's private
   save() JSON.stringifies the WHOLE thing into ONE localStorage key. That
   is exactly VII.1's blob model, single-player edition: one growing JSON
   object, one storage write, one quota. Two things follow from actually
   reading that code (city/worldstate.js, systems/basesave.js):
     (1) the population ledger (city/schedule.js's CBZ.cityNpcLedger) is
         NOT part of this blob — its own header says it "feeds world
         persistence (src/net/netpersist.js consumes it, guarded)" i.e.
         the MULTIPLAYER worldBlob only. Single-player has no persisted
         population registry today, so this file's `people` table has
         no live single-player producer yet — it exists for SCHEMA PARITY
         and as the seam a future wave wires a producer into (Build step 4).
     (2) player-built pieces (systems/building.js, via systems/basesave.js's
         `led.playerBases.bld.pieces[]`) and BaseRecords (systems/
         baseclaim.js's `led.baseClaim.{bases,ruins}`) DO already ride this
         blob, and DO grow with play — this is the one part of single-
         player state that genuinely mirrors server S3's structures/bases
         tables, so it is extracted into real chunk-indexed tables here,
         not just chunked-and-reassembled as an opaque blob.

   THE PLAN (VII.2's "one schema, two hosts", browser side): the WHOLE
   `g.cityWorld` blob still gets chunked into a `blobs`/`blob_meta` pair —
   byte-identical table shape to server/db.js migration v1 — so it is never
   again one untouchable JSON.stringify. `structures`/`bases`/`containers`
   mirror migration v3 and get a REAL extraction (pieces/bases pulled out
   of the blob into rows, same field names/chunk math as server/server.js's
   buildStructureRows/buildBaseRows) so CBZ.sqlitedb.structByChunk/
   baseByChunk answer "what's near (x,z)" without walking the whole blob —
   the offline half of VII.3/VII.4's spatial-query promise. `people`/
   `worldmeta`/`econ`/`polity` mirror migrations v2/v4 for LAYOUT parity
   (same CREATE TABLE column lists server/db.js runs — this file's own
   SCHEMA_STATEMENTS below is a hand-kept duplicate, commented at each
   table with the server/db.js line range it mirrors, exactly like
   server/server.js already duplicates client-only constants such as
   PIECE_CELL/pieceSlot for the reverse direction) even though nothing
   populates `people` yet.

   HARD CONSTRAINTS THIS FILE HONORS (see BUILD-PLAN.md S5 for the full
   list): (a) NO build step — sqlite-wasm ships as vendored static files
   (src/vendor/sqlite-wasm/, see that dir's VENDORED.txt for exactly what
   was downloaded, from where, and its verified hash) loaded lazily via
   `new Worker(...)`/a dynamically-injected <script> tag, NEVER a blocking
   <script> in index.html. (b) Boot never blocks on wasm: init() below is
   fire-and-forget, kicked off once this script parses, and every public
   entry point silently no-ops until it resolves. (c) A bulletproof
   fallback: if sqlite-wasm fails to load/init for ANY reason (no Worker,
   no OPFS, no fetch from file://, an exception mid-init…) the existing
   localStorage path in city/worldstate.js keeps working BYTE-IDENTICAL —
   see that file's save()/load(), which only ever ask this module for a
   cached copy / a mirror write and treat "not ready" as "do nothing".

   BACKEND CHOICE (docs read: https://sqlite.org/wasm/doc/trunk/
   persistence.md, vendored jswasm/sqlite3.js source read directly for the
   opfs-sahpool/kvvfs VFS install paths — see src/vendor/sqlite-wasm/
   VENDORED.txt for the exact quotes/citations):
     - "opfs" (the plain OPFS VFS) needs COOP/COEP response headers (it
       coordinates over a SharedArrayBuffer) — this game is "static-file
       servable" with no guarantee ANY particular headers are set, so this
       file never uses it.
     - "opfs-sahpool" (OPFS SyncAccessHandle pool) needs NEITHER COOP/COEP
       NOR any special headers, but DOES need to run inside a Worker
       (createSyncAccessHandle is a Worker-only API in the spec this build
       targets) — this is the PRIMARY backend (src/workers/
       sqlitedb-worker.js), picked whenever Worker + the OPFS sync-access
       API + a way to fetch the .wasm file (i.e. not file://) all exist.
     - "kvvfs" (localStorage/sessionStorage-backed pages) is MAIN-THREAD
       ONLY and — the honest caveat — does NOT lift the quota ceiling
       (it's still writing into the same localStorage the legacy path
       uses, just page-split across many keys instead of one). It exists
       purely as the next-best rung when Worker/OPFS aren't available but
       the page IS served over http(s): still gets the real schema/chunk-
       query wins, just not the size win.
     - Neither backend can load from a file:// URL — sqlite3.js's own wasm
       fetch requires http(s) (browsers don't serve `fetch()`/XHR to
       file://). detectBackend() below returns null for that case, and the
       legacy path runs completely unchanged, exactly as it always has.

   TESTABILITY: everything above the "---- browser wiring ----" marker is
   PURE (no DOM/Worker/fetch/localStorage touched) so a Node harness can
   require() this file directly and exercise schema/chunking/row-transform/
   backend-selection logic without a browser — see BUILD-PLAN.md S5's own
   verification step and /tmp/.../scratchpad/s5harness.js.
============================================================ */
(function () {
  "use strict";

  // ============================================================
  // ---- PURE LOGIC (Node- and browser-safe; zero global touches) ----
  // ============================================================

  // ~256KB chunks — byte-identical to server/db.js's CHUNK_SIZE (S1).
  const CHUNK_SIZE = 256 * 1024;
  // 16m chunk grid — byte-identical to server/db.js's PEOPLE_CHUNK_M (S2),
  // itself matching F4's systems/chunks.js grid.
  const PEOPLE_CHUNK_M = 16;
  function chunkCoord(v) { return Math.floor((+v || 0) / PEOPLE_CHUNK_M); }

  // ---- cross-env byte<->string helpers (no Buffer dependency — Node has
  // TextEncoder/TextDecoder globally since Node 11, and so does every
  // browser this game targets; one code path, not a Node/browser fork). ----
  function toBytes(str) { return new TextEncoder().encode(String(str == null ? "" : str)); }
  function fromBytes(bytes) { return new TextDecoder().decode(bytes); }

  // chunkBytes/reassembleBytes: the SAME chunking rule as server/db.js's
  // blobPut/blobGet (server/db.js:463-494) — total===0 still produces
  // exactly one (empty) chunk, otherwise ceil(total/chunkSize) chunks, so
  // a round trip through either implementation on the same bytes produces
  // the same chunk COUNT (verified by the harness against the real
  // server/db.js via node:sqlite — see BUILD-PLAN.md S5's verify step).
  function chunkBytes(bytes, chunkSize) {
    chunkSize = chunkSize || CHUNK_SIZE;
    const total = bytes.length;
    const nChunks = total === 0 ? 1 : Math.ceil(total / chunkSize);
    const out = [];
    for (let seq = 0; seq < nChunks; seq++) {
      const start = seq * chunkSize;
      const end = total === 0 ? 0 : Math.min(total, start + chunkSize);
      out.push(bytes.subarray(start, end));
    }
    return out;
  }
  function reassembleBytes(chunks) {
    if (!chunks || !chunks.length) return new Uint8Array(0);
    let total = 0;
    for (const c of chunks) total += c.length;
    const out = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) { out.set(c, off); off += c.length; }
    return out;
  }

  // ---- schema: hand-kept mirror of server/db.js's MIGRATIONS (v1-v4,
  // server/db.js:74-356) — same table/column names, so a future wave's
  // smart queries work identically whichever host they run against. Kept
  // as flat "IF NOT EXISTS" statements rather than server/db.js's
  // PRAGMA-user_version-gated migration array: this file has exactly one
  // writer (the local player, never a concurrent second host), so there is
  // no cross-version-skew hazard server.js has to guard against — running
  // every CREATE TABLE/INDEX IF NOT EXISTS on every init is sufficient and
  // simpler, and additive future columns just append one more statement.
  const SCHEMA_STATEMENTS = [
    // v1 (server/db.js:76-97): the chunked blob store — this is what makes
    // the WHOLE g.cityWorld object no longer one untouchable JSON string.
    "CREATE TABLE IF NOT EXISTS blobs (" +
      "kind TEXT NOT NULL, id TEXT NOT NULL, seq INTEGER NOT NULL, chunk BLOB NOT NULL, " +
      "PRIMARY KEY (kind, id, seq))",
    "CREATE TABLE IF NOT EXISTS blob_meta (" +
      "kind TEXT NOT NULL, id TEXT NOT NULL, size INTEGER NOT NULL, chunks INTEGER NOT NULL, " +
      "updatedAt INTEGER NOT NULL, PRIMARY KEY (kind, id))",
    // v2 (server/db.js:116-137): the population registry. No single-player
    // producer exists yet (see this file's header) — schema parity only.
    "CREATE TABLE IF NOT EXISTS people (" +
      "sid TEXT PRIMARY KEY, name TEXT, sex INTEGER NOT NULL DEFAULT 0, " +
      "x REAL NOT NULL DEFAULT 0, z REAL NOT NULL DEFAULT 0, " +
      "cx INTEGER NOT NULL DEFAULT 0, cz INTEGER NOT NULL DEFAULT 0, " +
      "workCx INTEGER NOT NULL DEFAULT 0, workCz INTEGER NOT NULL DEFAULT 0, " +
      "cash REAL NOT NULL DEFAULT 0, alive INTEGER NOT NULL DEFAULT 1, " +
      "data TEXT NOT NULL, updatedAt INTEGER NOT NULL)",
    "CREATE INDEX IF NOT EXISTS idx_people_chunk ON people (cx, cz)",
    "CREATE INDEX IF NOT EXISTS idx_people_workchunk ON people (workCx, workCz)",
    "CREATE INDEX IF NOT EXISTS idx_people_alive ON people (alive)",
    // v3 (server/db.js:216-266): structures/bases/containers — the tables
    // THIS file actually populates (systems/building.js pieces + systems/
    // baseclaim.js BaseRecords/ruins already ride the single-player blob;
    // see saveWorld() below).
    "CREATE TABLE IF NOT EXISTS structures (" +
      "pieceId TEXT PRIMARY KEY, baseId TEXT, kind TEXT NOT NULL, " +
      "x REAL NOT NULL DEFAULT 0, y REAL NOT NULL DEFAULT 0, z REAL NOT NULL DEFAULT 0, " +
      "cx INTEGER NOT NULL DEFAULT 0, cz INTEGER NOT NULL DEFAULT 0, rot INTEGER NOT NULL DEFAULT 0, " +
      "hp REAL NOT NULL DEFAULT 0, material TEXT, data TEXT NOT NULL, updatedAt INTEGER NOT NULL)",
    "CREATE INDEX IF NOT EXISTS idx_structures_chunk ON structures (cx, cz)",
    "CREATE INDEX IF NOT EXISTS idx_structures_base ON structures (baseId)",
    "CREATE TABLE IF NOT EXISTS bases (" +
      "baseId TEXT PRIMARY KEY, ownerId TEXT, x REAL NOT NULL DEFAULT 0, z REAL NOT NULL DEFAULT 0, " +
      "cx INTEGER NOT NULL DEFAULT 0, cz INTEGER NOT NULL DEFAULT 0, radius REAL NOT NULL DEFAULT 0, " +
      "upkeepUntil REAL NOT NULL DEFAULT 0, ruin INTEGER NOT NULL DEFAULT 0, " +
      "auth TEXT NOT NULL DEFAULT '[]', data TEXT NOT NULL, updatedAt INTEGER NOT NULL)",
    "CREATE INDEX IF NOT EXISTS idx_bases_chunk ON bases (cx, cz)",
    "CREATE TABLE IF NOT EXISTS containers (" +
      "containerId TEXT PRIMARY KEY, pieceId TEXT NOT NULL REFERENCES structures(pieceId) ON DELETE CASCADE, " +
      "baseId TEXT, inventory TEXT NOT NULL DEFAULT '{}', locked INTEGER NOT NULL DEFAULT 0, " +
      "code TEXT, updatedAt INTEGER NOT NULL)",
    "CREATE INDEX IF NOT EXISTS idx_containers_base ON containers (baseId)",
    "CREATE INDEX IF NOT EXISTS idx_containers_piece ON containers (pieceId)",
    // v4 (server/db.js:325-354): worldmeta/econ/polity mirrors — schema
    // parity only this wave (single-player's econ/politics fields still
    // ride inline inside the blob via the same cityWorldCommit wraps every
    // sim/* file already installs; no extraction wired yet, same "seam for
    // a future wave" status as `people` above).
    "CREATE TABLE IF NOT EXISTS worldmeta (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
    "CREATE TABLE IF NOT EXISTS econ (" +
      "countryId TEXT PRIMARY KEY, activity REAL NOT NULL DEFAULT 1.0, employment REAL NOT NULL DEFAULT 0.92, " +
      "priceIndex REAL NOT NULL DEFAULT 1.0, pi REAL NOT NULL DEFAULT 0.02, treasury REAL NOT NULL DEFAULT 0, " +
      "data TEXT NOT NULL, updatedAt INTEGER NOT NULL)",
    "CREATE TABLE IF NOT EXISTS polity (" +
      "id TEXT PRIMARY KEY, kind TEXT, govType TEXT, approval REAL NOT NULL DEFAULT 55, " +
      "termDay REAL, officeHolder TEXT, data TEXT NOT NULL, updatedAt INTEGER NOT NULL)",
  ];

  // tableColumns(sql) -> {name, columns:[...]} | null — a tiny programmatic
  // parser used ONLY by the test harness to diff this file's SCHEMA_STATEMENTS
  // against server/db.js's real MIGRATIONS output (both run through this
  // SAME parser, so "do the two schemas match" is a real structural diff,
  // not a hand-eyeballed one).
  function tableColumns(sql) {
    const m = /CREATE TABLE(?:\s+IF NOT EXISTS)?\s+(\w+)\s*\(([\s\S]+)\)\s*;?\s*$/i.exec(sql.trim());
    if (!m) return null;
    const name = m[1];
    const body = m[2];
    // split on top-level commas only (none of this schema nests parens
    // inside a column def, so a simple depth counter is sufficient)
    const parts = [];
    let depth = 0, cur = "";
    for (const ch of body) {
      if (ch === "(") depth++;
      if (ch === ")") depth--;
      if (ch === "," && depth === 0) { parts.push(cur); cur = ""; } else cur += ch;
    }
    if (cur.trim()) parts.push(cur);
    const columns = [];
    for (let p of parts) {
      p = p.trim();
      const up = p.toUpperCase();
      if (up.startsWith("PRIMARY KEY") || up.startsWith("FOREIGN KEY") || up.startsWith("UNIQUE") || up.startsWith("CHECK")) continue;
      const cm = /^(\w+)/.exec(p);
      if (cm) columns.push(cm[1]);
    }
    return { name, columns };
  }
  // schemaTableMap(statements) -> { tableName: [columns...] }
  function schemaTableMap(statements) {
    const out = {};
    for (const sql of statements) {
      const t = tableColumns(sql);
      if (t) out[t.name] = t.columns;
    }
    return out;
  }

  // ---- structures/bases row transforms — DUPLICATED from server/server.js
  // (PIECE_CELL/PIECE_WALL_H/pieceSlot/pieceWorldPos/coveringBase/
  // buildStructureRows/buildBaseRows, server/server.js:166-256) rather than
  // shared by reference, per that file's own header rationale: "kind->slot
  // is a 4-line, effectively-frozen mapping... duplicated here in full...
  // rather than sharing code with a client-only file the server can't
  // require()" — the SAME reasoning applies in reverse here (this browser
  // file can't require() a server/ file either). Keep these two copies in
  // sync by hand if B5 ever adds real piece tiers/materials.
  const PIECE_CELL = 3;     // src/systems/building.js's own CELL (B.CELL)
  const PIECE_WALL_H = 2.5; // src/systems/building.js's own WALL_H (B.WALL_H)
  function pieceSlot(kind, rot) {
    if (kind === "wall" || kind === "doorframe") return "e" + (rot | 0);
    if (kind === "door") return "dr" + (rot | 0);
    if (kind === "cupboard") return "tc";
    if (kind === "container") return "box";
    return "fill";
  }
  function pieceWorldPos(rec) {
    return { x: (rec.gx || 0) * PIECE_CELL, y: (rec.gy || 0) * PIECE_WALL_H, z: (rec.gz || 0) * PIECE_CELL };
  }
  function coveringBase(basesArr, x, z) {
    let best = null, bd = Infinity;
    for (const rec of (basesArr || [])) {
      if (!rec || rec.cx == null || rec.cz == null) continue;
      const dx = rec.cx - x, dz = rec.cz - z, dd = dx * dx + dz * dz;
      const r = rec.radius || 0;
      if (dd <= r * r && dd < bd) { bd = dd; best = rec; }
    }
    return best;
  }
  function structRowsFromPieces(pieces, basesArr) {
    const now = Date.now();
    const structRows = [], containerRows = [];
    for (const rec of (pieces || [])) {
      if (!rec || !rec.kind) continue;
      const slot = pieceSlot(rec.kind, rec.rot | 0);
      const pieceId = (rec.gx | 0) + "," + (rec.gy | 0) + "," + (rec.gz | 0) + "," + slot;
      const pos = pieceWorldPos(rec);
      const base = coveringBase(basesArr, pos.x, pos.z);
      structRows.push({
        pieceId, baseId: base ? base.id : null, kind: rec.kind,
        x: pos.x, y: pos.y, z: pos.z, rot: rec.rot | 0,
        hp: rec.hp != null ? rec.hp : 0,
        material: "wood", // B1-B8 wood tier only — see server/server.js's own note
        data: rec, updatedAt: now,
      });
      if (rec.kind === "container") {
        containerRows.push({
          containerId: pieceId, pieceId, baseId: base ? base.id : null,
          inventory: rec.contents || {}, locked: !!rec.locked, code: null, updatedAt: now,
        });
      }
    }
    return { structRows, containerRows };
  }
  function baseRowsFromBases(bases, ruins) {
    const now = Date.now();
    const rows = [];
    for (const rec of (bases || [])) {
      if (!rec || !rec.id) continue;
      rows.push({
        baseId: rec.id, ownerId: rec.ownerPid || null,
        x: rec.cx || 0, z: rec.cz || 0,
        radius: rec.radius || 0, upkeepUntil: rec.upkeepUntil || 0, ruin: false,
        authorized: rec.authorized || [], data: rec, updatedAt: now,
      });
    }
    for (const rec of (ruins || [])) {
      if (!rec || !rec.id) continue;
      rows.push({
        baseId: rec.id, ownerId: null, x: rec.cx || 0, z: rec.cz || 0,
        radius: rec.radius || 0, upkeepUntil: 0, ruin: true,
        authorized: [], data: { ruin: true, cx: rec.cx || 0, cz: rec.cz || 0, radius: rec.radius || 0 },
        updatedAt: now,
      });
    }
    return rows;
  }

  // ---- people row transform — DUPLICATED from server/db.js's peoplePut
  // per-entry mapping (server/db.js:564-597). No single-player caller yet
  // (see file header); exposed so a future ledger producer, and the
  // harness's parity check against the real server/db.js, both have it.
  function personRowFromEntry(e) {
    if (!e || !e.sid) return null;
    const homeX = e.hx != null ? e.hx : (e.tx != null ? e.tx : 0);
    const homeZ = e.hz != null ? e.hz : (e.tz != null ? e.tz : 0);
    const workX = e.jx != null ? e.jx : homeX;
    const workZ = e.jz != null ? e.jz : homeZ;
    const x = e.tx != null ? e.tx : homeX;
    const z = e.tz != null ? e.tz : homeZ;
    return {
      sid: String(e.sid), name: e.name != null ? String(e.name) : null, sex: e.sex ? 1 : 0,
      x: +x || 0, z: +z || 0,
      cx: chunkCoord(homeX), cz: chunkCoord(homeZ),
      workCx: chunkCoord(workX), workCz: chunkCoord(workZ),
      cash: +e.cash || 0, alive: e.alive === false ? 0 : 1,
      data: e, updatedAt: Date.now(),
    };
  }
  function peopleRowsFromEntries(entries) {
    const out = [];
    for (const e of (entries || [])) { const r = personRowFromEntry(e); if (r) out.push(r); }
    return out;
  }

  // ---- extractRowsFromWorld: the ONE function both the ongoing-save path
  // and the one-shot legacy-localStorage import (Build step 3) share, so
  // "extract structures/bases out of a g.cityWorld-shaped blob" has exactly
  // one implementation. Mirrors server.js's own extractStructuresFromWorld/
  // extractBasesFromWorld intent, adapted to the single-player blob's
  // actual field names (systems/basesave.js's `w.playerBases.bld.pieces`,
  // systems/baseclaim.js's `w.baseClaim.{bases,ruins}` — see this file's
  // header for why those two, and not `w.npc`, are what single-player
  // actually has to extract).
  function extractRowsFromWorld(w) {
    w = w || {};
    const pieces = (w.playerBases && w.playerBases.bld && Array.isArray(w.playerBases.bld.pieces)) ? w.playerBases.bld.pieces : [];
    const basesArr = (w.baseClaim && Array.isArray(w.baseClaim.bases)) ? w.baseClaim.bases : [];
    const ruinsArr = (w.baseClaim && Array.isArray(w.baseClaim.ruins)) ? w.baseClaim.ruins : [];
    const { structRows, containerRows } = structRowsFromPieces(pieces, basesArr);
    const baseRows = baseRowsFromBases(basesArr, ruinsArr);
    return { structRows, containerRows, baseRows };
  }

  // ---- feature-detect matrix: PURE decision function — env is a plain
  // object of booleans so the harness can enumerate every combination
  // without touching a real browser. Priority: opfs-sahpool (the only
  // backend that actually lifts the quota) > kvvfs (schema/query parity,
  // same quota) > null (today's localStorage-only path, unchanged).
  function detectBackend(env) {
    env = env || {};
    if (env.isFileProtocol) return null;         // sqlite3.wasm can't be fetched from file://
    if (!env.canFetchWasm) return null;           // no way to load the wasm binary at all
    if (env.hasWorker && env.hasOPFS) return "opfs-sahpool";
    if (env.hasLocalStorage) return "kvvfs";
    return null;
  }

  // real (browser-only) environment probe -> the env object detectBackend
  // expects. Kept tiny and side-effect-free (just reads globals) so the
  // "decision" logic above stays the fully-tested part.
  //
  // hasOPFS is deliberately checked WITHOUT
  // `FileSystemFileHandle.prototype.createSyncAccessHandle` — that method
  // is a WORKER-ONLY API by spec (the vendored jswasm/sqlite3.js's own
  // apiVersionCheck(), which this file's makeWorkerBackend ultimately
  // calls, does the SAME createSyncAccessHandle probe but from INSIDE the
  // Worker, where it actually exists). Checking for it from the MAIN
  // thread here would always read `undefined` on every browser, real
  // support or not (caught by this file's own real-Chromium harness run —
  // the very first version of this probe made detectBackend() silently
  // fall through to kvvfs on a browser that, inside a Worker, actually
  // supports opfs-sahpool fine). `navigator.storage.getDirectory` is the
  // correct MAIN-thread-visible proxy for "this browser has OPFS at all";
  // the worker's own install (installOpfsSAHPoolVfs) does the definitive
  // check and this file's init() falls back to kvvfs if THAT rejects
  // (see the fallback chain below realEnv()).
  function realEnv() {
    const hasWindow = typeof window !== "undefined";
    const isFileProtocol = hasWindow && !!window.location && window.location.protocol === "file:";
    const canFetchWasm = hasWindow && !isFileProtocol && typeof fetch === "function";
    const hasWorker = typeof Worker === "function";
    let hasOPFS = false;
    try {
      hasOPFS = !!(hasWindow && navigator && navigator.storage && typeof navigator.storage.getDirectory === "function");
    } catch (e) { hasOPFS = false; }
    let hasLocalStorage = false;
    try { hasLocalStorage = hasWindow && !!window.localStorage; } catch (e) { hasLocalStorage = false; }
    return { isFileProtocol, canFetchWasm, hasWorker, hasOPFS, hasLocalStorage };
  }

  // ---- one-shot legacy-localStorage migration plan (Build step 3): pure
  // transform from "the exact object worldstate.js's load() would have
  // returned" to the rows/blob a fresh sqlite backend should be seeded
  // with. Never mutates or deletes the input — the caller (browser wiring,
  // below) is responsible for "keep the localStorage copy as backup".
  function planMigration(legacyWorld) {
    if (!legacyWorld || legacyWorld.version !== 2) return null;
    const { structRows, containerRows, baseRows } = extractRowsFromWorld(legacyWorld);
    return {
      worldJson: JSON.stringify(legacyWorld),
      structRows, containerRows, baseRows,
      counts: { structures: structRows.length, containers: containerRows.length, bases: baseRows.length },
    };
  }

  // ============================================================
  // ---- one-shot guard helper (matches the repo's `_xWrap` idiom used by
  // systems/basesave.js/city/familytree.js/systems/baseclaim.js — "a
  // module-local boolean [that] wraps exactly once, ever", basesave.js's
  // own comment) — used below to make init()/the async bring-up idempotent
  // no matter how many times something calls it. ----
  // ============================================================
  function makeOnce(fn) {
    let done = false, result;
    const wrapped = function () {
      if (done) return result;
      done = true;
      result = fn.apply(this, arguments);
      return result;
    };
    wrapped.isDone = function () { return done; };
    return wrapped;
  }

  const pureApi = {
    CHUNK_SIZE, PEOPLE_CHUNK_M, chunkCoord,
    toBytes, fromBytes, chunkBytes, reassembleBytes,
    SCHEMA_STATEMENTS, tableColumns, schemaTableMap,
    PIECE_CELL, PIECE_WALL_H, pieceSlot, pieceWorldPos, coveringBase,
    structRowsFromPieces, baseRowsFromBases,
    personRowFromEntry, peopleRowsFromEntries,
    extractRowsFromWorld, planMigration,
    detectBackend, realEnv,
    makeOnce,
  };

  // Node/harness path: no window at all -> export the pure API and stop.
  // This is what BUILD-PLAN.md S5's own verify step requires ("the
  // module's pure logic must be testable without a browser").
  if (typeof window === "undefined") {
    if (typeof module !== "undefined" && module.exports) module.exports = pureApi;
    return;
  }

  // ============================================================
  // ---- BROWSER WIRING (everything below touches window/Worker/fetch/
  // localStorage; none of it runs under `node --check`'s Node harness) ----
  // ============================================================
  const CBZ = window.CBZ;
  if (!CBZ) return;

  const VENDOR_DIR = "src/vendor/sqlite-wasm/jswasm/";
  const WORKER_URL = "src/workers/sqlitedb-worker.js?v=sql1";
  const DB_NAME = "cbz-cityworld";
  const WORLD_BLOB_KIND = "world", WORLD_BLOB_ID = "cityworld";
  const LEGACY_STORE_KEY = "CBZ_CITY_WORLD_V2"; // city/worldstate.js's own STORE_KEY

  let backendKind = null;   // "opfs-sahpool" | "kvvfs" | null, once decided
  let cache = null;         // in-memory copy of the last known-good world object
  let warnedMirrorSkip = false;
  let warnedBackend = false;
  let worker = null, msgSeq = 0;
  const pending = Object.create(null);
  let inFlight = false, queuedWrite = null; // simple one-writer-at-a-time coalescing

  function logBackendOnce() {
    if (warnedBackend) return;
    warnedBackend = true;
    console.log("[sqlitedb] backend: " + (backendKind || "none (legacy localStorage path only)"));
  }

  // ---- generic backend interface: { run(statements[]) -> Promise,
  // query(sql, params) -> Promise<rows[]> }. Both concrete backends
  // implement exactly this, so everything above this line (saveWorld,
  // loadWorld, structByChunk, ...) doesn't care which one is live.
  let backend = null;

  function makeWorkerBackend() {
    worker = new Worker(WORKER_URL);
    worker.onmessage = function (ev) {
      const m = ev.data || {};
      const p = pending[m.id];
      if (!p) return;
      delete pending[m.id];
      if (m.ok) p.resolve(m); else p.reject(new Error(m.error || "sqlitedb worker error"));
    };
    worker.onerror = function (ev) {
      // a late worker-level error (e.g. the wasm 404s) rejects every
      // still-pending call rather than hanging them forever.
      for (const id in pending) { pending[id].reject(new Error("sqlitedb worker error")); delete pending[id]; }
    };
    function send(msg) {
      return new Promise(function (resolve, reject) {
        const id = ++msgSeq;
        pending[id] = { resolve, reject };
        msg.id = id;
        worker.postMessage(msg);
      });
    }
    return {
      init: function () { return send({ op: "init", dbName: DB_NAME, vendorDir: VENDOR_DIR }); },
      run: function (statements) { return send({ op: "batch", statements: statements }); },
      query: function (sql, params) { return send({ op: "query", sql: sql, params: params || [] }); },
    };
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      const s = document.createElement("script");
      s.src = src;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error("failed to load " + src)); };
      document.head.appendChild(s);
    });
  }

  function makeKvvfsBackend() {
    let db = null;
    return {
      init: function () {
        return loadScript(VENDOR_DIR + "sqlite3.js").then(function () {
          return window.sqlite3InitModule({ locateFile: function (path) { return VENDOR_DIR + path; } });
        }).then(function (sqlite3) {
          db = new sqlite3.oo1.JsStorageDb("local");
          db.transaction(function () {
            for (const sql of SCHEMA_STATEMENTS) db.exec(sql);
          });
          return { ok: true };
        });
      },
      run: function (statements) {
        return Promise.resolve().then(function () {
          db.transaction(function () {
            for (const st of statements) db.exec({ sql: st.sql, bind: st.params || [] });
          });
          return { ok: true };
        });
      },
      query: function (sql, params) {
        return Promise.resolve().then(function () { return { rows: db.selectObjects(sql, params || []) }; });
      },
    };
  }

  // ---- init(): the one-shot async bring-up. Never throws, never rejects
  // its own promise — every failure resolves to backendKind=null so the
  // legacy path is guaranteed to be the caller's fallback, not an
  // exception it has to catch.
  const ready = (function () {
    // tryBackend(kind): brings up ONE concrete backend and resolves true/
    // false — never rejects, so the fallback chain below can just chain
    // .then()s without a .catch() at every step.
    function tryBackend(kind) {
      backend = kind === "opfs-sahpool" ? makeWorkerBackend() : makeKvvfsBackend();
      return backend.init().then(function () { return true; }).catch(function (e) {
        console.warn("[sqlitedb] " + kind + " backend init failed (" + (e && e.message) + ")");
        backend = null;
        return false;
      });
    }

    const runInit = makeOnce(function () {
      const env = realEnv();
      const firstChoice = detectBackend(env);
      if (!firstChoice) { backendKind = null; logBackendOnce(); return Promise.resolve(null); }
      // detectBackend() is a pure, single-answer decision (see its own
      // header/the harness's feature-detect-matrix test) — but the REAL
      // capability check for opfs-sahpool only happens inside the Worker
      // (installOpfsSAHPoolVfs's own apiVersionCheck, see src/workers/
      // sqlitedb-worker.js), so a main-thread-only probe can still pick
      // "opfs-sahpool" for a browser that turns out not to truly support
      // it. If THAT init rejects, fall through to kvvfs (still correct
      // per env — a page served over http(s) with localStorage) rather
      // than giving up straight to null; only if kvvfs ALSO fails (or
      // isn't feasible per env) does this resolve to no backend at all.
      return tryBackend(firstChoice).then(function (okFirst) {
        if (okFirst) { backendKind = firstChoice; return true; }
        if (firstChoice === "opfs-sahpool" && env.hasLocalStorage) {
          return tryBackend("kvvfs").then(function (okSecond) {
            if (okSecond) { backendKind = "kvvfs"; return true; }
            backendKind = null;
            return false;
          });
        }
        backendKind = null;
        return false;
      }).then(function (haveBackend) {
        logBackendOnce();
        if (!haveBackend) return null;
        return loadWorldAndMaybeMigrate();
      });
    });
    return runInit;
  })();

  function blobPutStatements(kind, id, jsonStr) {
    const bytes = toBytes(jsonStr);
    const chunks = chunkBytes(bytes);
    const stmts = [
      { sql: "DELETE FROM blobs WHERE kind = ? AND id = ?", params: [kind, id] },
      { sql: "DELETE FROM blob_meta WHERE kind = ? AND id = ?", params: [kind, id] },
    ];
    for (let seq = 0; seq < chunks.length; seq++) {
      stmts.push({ sql: "INSERT INTO blobs (kind, id, seq, chunk) VALUES (?, ?, ?, ?)", params: [kind, id, seq, chunks[seq]] });
    }
    stmts.push({
      sql: "INSERT INTO blob_meta (kind, id, size, chunks, updatedAt) VALUES (?, ?, ?, ?, ?) " +
        "ON CONFLICT(kind, id) DO UPDATE SET size=excluded.size, chunks=excluded.chunks, updatedAt=excluded.updatedAt",
      params: [kind, id, bytes.length, chunks.length, Date.now()],
    });
    return stmts;
  }

  function blobGet(kind, id) {
    return backend.query("SELECT size, chunks FROM blob_meta WHERE kind = ? AND id = ?", [kind, id]).then(function (r) {
      const meta = r.rows && r.rows[0];
      if (!meta) return null;
      if (meta.size === 0) return "";
      return backend.query("SELECT chunk FROM blobs WHERE kind = ? AND id = ? ORDER BY seq ASC", [kind, id]).then(function (r2) {
        if (!r2.rows || !r2.rows.length) return null;
        const chunks = r2.rows.map(function (row) { return row.chunk instanceof Uint8Array ? row.chunk : new Uint8Array(row.chunk); });
        return fromBytes(reassembleBytes(chunks));
      });
    });
  }

  function rowStatements(rows, table, cols, upsertKey, mapRow) {
    const stmts = [];
    const colNames = cols.join(", ");
    const qs = cols.map(function () { return "?"; }).join(", ");
    const updateSet = cols.filter(function (c) { return c !== upsertKey; })
      .map(function (c) { return c + " = excluded." + c; }).join(", ");
    for (const r of rows) {
      stmts.push({
        sql: "INSERT INTO " + table + " (" + colNames + ") VALUES (" + qs + ") " +
          "ON CONFLICT(" + upsertKey + ") DO UPDATE SET " + updateSet,
        params: mapRow(r),
      });
    }
    return stmts;
  }

  function structStatements(structRows) {
    return rowStatements(structRows, "structures",
      ["pieceId", "baseId", "kind", "x", "y", "z", "cx", "cz", "rot", "hp", "material", "data", "updatedAt"],
      "pieceId",
      function (r) { return [r.pieceId, r.baseId, r.kind, r.x, r.y, r.z, chunkCoord(r.x), chunkCoord(r.z), r.rot, r.hp, r.material, JSON.stringify(r.data), r.updatedAt]; });
  }
  function containerStatements(containerRows) {
    return rowStatements(containerRows, "containers",
      ["containerId", "pieceId", "baseId", "inventory", "locked", "code", "updatedAt"],
      "containerId",
      function (r) { return [r.containerId, r.pieceId, r.baseId, JSON.stringify(r.inventory || {}), r.locked ? 1 : 0, r.code, r.updatedAt]; });
  }
  function baseStatements(baseRows) {
    return rowStatements(baseRows, "bases",
      ["baseId", "ownerId", "x", "z", "cx", "cz", "radius", "upkeepUntil", "ruin", "auth", "data", "updatedAt"],
      "baseId",
      function (r) { return [r.baseId, r.ownerId, r.x, r.z, chunkCoord(r.x), chunkCoord(r.z), r.radius, r.upkeepUntil, r.ruin ? 1 : 0, JSON.stringify(r.authorized || []), JSON.stringify(r.data), r.updatedAt]; });
  }

  // loadWorldAndMaybeMigrate: runs ONCE right after a fresh backend is
  // ready. If sqlite already has a stored world blob, that becomes the
  // cache (a returning player whose backend survived a previous session).
  // Otherwise (fresh/empty backend) — Build step 3's one-shot migration:
  // if worldstate.js's OWN localStorage key already holds a v2 save,
  // import it once, log counts, and NEVER delete the localStorage copy.
  function loadWorldAndMaybeMigrate() {
    return blobGet(WORLD_BLOB_KIND, WORLD_BLOB_ID).then(function (json) {
      if (json != null) {
        try { cache = JSON.parse(json); } catch (e) { cache = null; }
        return backendKind;
      }
      // fresh backend: is there a legacy save to import, one time only?
      let legacy = null;
      try {
        const raw = window.localStorage && localStorage.getItem(LEGACY_STORE_KEY);
        legacy = raw ? JSON.parse(raw) : null;
      } catch (e) { legacy = null; }
      const plan = planMigration(legacy);
      if (!plan) return backendKind;
      const stmts = [].concat(
        blobPutStatements(WORLD_BLOB_KIND, WORLD_BLOB_ID, plan.worldJson),
        structStatements(plan.structRows),
        containerStatements(plan.containerRows),
        baseStatements(plan.baseRows)
      );
      return backend.run(stmts).then(function () {
        cache = legacy;
        console.log("[sqlitedb] migrated legacy localStorage save: " +
          plan.counts.structures + " structures, " + plan.counts.containers + " containers, " +
          plan.counts.bases + " bases (localStorage copy kept as backup)");
        return backendKind;
      });
    }).catch(function (e) {
      console.warn("[sqlitedb] load/migrate failed (" + (e && e.message) + ")");
      return backendKind;
    });
  }

  // ---- public write path: called from city/worldstate.js's save(w). Pure
  // fire-and-forget — never throws, never awaited by the caller. A single
  // in-flight write at a time (single-player has exactly one writer, the
  // 5-second autosave/event tick); a write that lands while another is
  // still flushing is coalesced into "run once more after this one" rather
  // than piling up an unbounded queue.
  function flushWrite(w, jsonStr) {
    if (inFlight) { queuedWrite = { w, jsonStr }; return; }
    inFlight = true;
    const { structRows, containerRows, baseRows } = extractRowsFromWorld(w);
    const stmts = [].concat(
      blobPutStatements(WORLD_BLOB_KIND, WORLD_BLOB_ID, jsonStr),
      structStatements(structRows), containerStatements(containerRows), baseStatements(baseRows)
    );
    backend.run(stmts).then(function () {
      cache = w;
    }).catch(function (e) {
      console.warn("[sqlitedb] save failed (" + (e && e.message) + ")");
    }).then(function () {
      inFlight = false;
      if (queuedWrite) { const q = queuedWrite; queuedWrite = null; flushWrite(q.w, q.jsonStr); }
    });
  }

  const api = Object.assign({}, pureApi, {
    ready: ready,                       // call CBZ.sqlitedb.ready() to (re)kick off init; resolves to backendKind|null
    isAvailable: function () { return !!backendKind; },
    backend: function () { return backendKind; },
    cachedWorld: function () { return cache; },
    // saveWorld: city/worldstate.js's save() calls this on every write. A
    // no-op (returns false) until the backend is ready — the caller must
    // NOT depend on this for durability until then; localStorage is still
    // the source of truth in that window, exactly as before this file existed.
    saveWorld: function (w, jsonStr) {
      if (!backendKind || !backend) return false;
      try { flushWrite(w, jsonStr != null ? jsonStr : JSON.stringify(w)); return true; } catch (e) { return false; }
    },
    // warnMirrorSkipOnce: city/worldstate.js's save() calls this instead of
    // silently swallowing a localStorage QuotaExceededError once sqlite is
    // primary — "this is exactly the cap dying" (BUILD-PLAN.md S5's own words).
    warnMirrorSkipOnce: function (e) {
      if (warnedMirrorSkip) return;
      warnedMirrorSkip = true;
      console.log("[sqlitedb] localStorage safety-mirror skipped (" + (e && e.message) + ") — sqlite is primary now, this save is not lost");
    },
    // ---- smart-query seam (Build step 4): parity with server/server.js's
    // pquery/bquery over the SAME chunk grid. No gameplay consumer this
    // wave (single-player has no per-frame need to query "who/what is near
    // (x,z)" outside the already-loaded scene) — exposed for a future wave,
    // exactly like CBZ.sqlitedb.peopleByChunk has no producer yet either.
    structByChunk: function (cx, cz, r) {
      if (!backendKind) return Promise.resolve([]);
      cx |= 0; cz |= 0; r = Math.max(0, r | 0);
      return backend.query(
        "SELECT * FROM structures WHERE cx BETWEEN ? AND ? AND cz BETWEEN ? AND ? ORDER BY pieceId ASC",
        [cx - r, cx + r, cz - r, cz + r]
      ).then(function (res) { return (res.rows || []).map(function (row) { return Object.assign({}, row, { data: JSON.parse(row.data) }); }); });
    },
    baseByChunk: function (cx, cz, r) {
      if (!backendKind) return Promise.resolve([]);
      cx |= 0; cz |= 0; r = Math.max(0, r | 0);
      return backend.query(
        "SELECT * FROM bases WHERE cx BETWEEN ? AND ? AND cz BETWEEN ? AND ? ORDER BY baseId ASC",
        [cx - r, cx + r, cz - r, cz + r]
      ).then(function (res) { return (res.rows || []).map(function (row) { return Object.assign({}, row, { data: JSON.parse(row.data), authorized: JSON.parse(row.auth || "[]") }); }); });
    },
    peopleByChunk: function (cx, cz, r) {
      if (!backendKind) return Promise.resolve([]);
      cx |= 0; cz |= 0; r = Math.max(0, r | 0);
      return backend.query(
        "SELECT * FROM people WHERE alive = 1 AND cx BETWEEN ? AND ? AND cz BETWEEN ? AND ? ORDER BY sid ASC",
        [cx - r, cx + r, cz - r, cz + r]
      ).then(function (res) { return (res.rows || []).map(function (row) { return Object.assign({}, row, { data: JSON.parse(row.data) }); }); });
    },
  });

  CBZ.sqlitedb = api;

  // Kick off init at parse time — fire-and-forget, never blocks boot (the
  // returned promise is intentionally not awaited here; city/worldstate.js
  // only ever reads CBZ.sqlitedb.cachedWorld()/isAvailable() synchronously).
  try { ready(); } catch (e) { /* never let init throw onto the boot path */ }
})();
