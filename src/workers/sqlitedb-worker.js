/* ============================================================
   workers/sqlitedb-worker.js — S5 (BUILD-PLAN.md Stage S): the
   opfs-sahpool backend for src/net/sqlitedb.js. Runs the vendored
   sqlite-wasm build (src/vendor/sqlite-wasm/, see that dir's
   VENDORED.txt) inside a Worker because OPFS's synchronous access
   handles (createSyncAccessHandle) are a Worker-only API — see
   sqlitedb.js's own header for the doc citations behind that choice
   and why this is the "opfs-sahpool" VFS specifically (no COOP/COEP
   headers needed, unlike the plain "opfs" VFS).

   PROTOCOL: a tiny request/response postMessage protocol, NOT the
   vendored jswasm/sqlite3-worker1*.js convenience wrapper (that
   wrapper's `open` message assumes the VFS you name is ALREADY
   registered — it never calls installOpfsSAHPoolVfs() itself, so
   using it here would just move the same amount of glue code
   elsewhere without buying anything). Messages IN:
     {id, op:"init", dbName, vendorDir}   — one-time bring-up + schema
     {id, op:"batch", statements:[{sql,params}]}  — one transaction
     {id, op:"query", sql, params}        — SELECT, returns rows
   Messages OUT (always carry the same id): {id, ok:true, ...} or
   {id, ok:false, error}.

   SCHEMA: duplicated from sqlitedb.js's SCHEMA_STATEMENTS (a Worker
   has its own global scope — it cannot see that file's module-local
   const even though both are loaded by the same page). Keep these
   two arrays identical; sqlitedb.js's own header explains why the
   canonical source of truth for the TABLE SHAPES is server/db.js,
   not either of these two copies.
============================================================ */
"use strict";

// vendorDir defaults to the repo's own convention (src/vendor/sqlite-wasm/
// jswasm/, resolved relative to the PAGE — see src/entities/crowd.js's
// `new Worker("src/workers/crowd-worker.js?v=...")` for the same root-
// relative-path convention this repo already uses for worker scripts);
// the init message can override it (kept configurable, not hardcoded
// twice, in case a future path change only needs to edit sqlitedb.js).
var VENDOR_DIR = "../vendor/sqlite-wasm/jswasm/";

// The vendored sqlite3.js Module.instantiateWasm hook calls
// WebAssembly.instantiateStreaming with NO catch/fallback, so any server
// that serves .wasm without the application/wasm MIME type kills init with
// an unhandled "Incorrect response MIME type" rejection. The vendor file is
// do-not-hand-edit, so wrap instantiateStreaming here (worker-global scope,
// before importScripts) to fall back to arrayBuffer instantiation, which
// ignores MIME entirely. devserver.py now pins the MIME too; this keeps db
// init working behind any other host/tunnel.
if (typeof WebAssembly !== "undefined" && WebAssembly.instantiateStreaming) {
  const origInstantiateStreaming = WebAssembly.instantiateStreaming.bind(WebAssembly);
  WebAssembly.instantiateStreaming = function (source, imports) {
    return Promise.resolve(source).then(function (resp) {
      // clone(): the streaming attempt consumes the body; the fallback
      // needs a fresh one.
      return origInstantiateStreaming(resp.clone(), imports).catch(function () {
        return resp.arrayBuffer().then(function (bytes) {
          return WebAssembly.instantiate(bytes, imports);
        });
      });
    });
  };
}

const SCHEMA_STATEMENTS = [
  "CREATE TABLE IF NOT EXISTS blobs (" +
    "kind TEXT NOT NULL, id TEXT NOT NULL, seq INTEGER NOT NULL, chunk BLOB NOT NULL, " +
    "PRIMARY KEY (kind, id, seq))",
  "CREATE TABLE IF NOT EXISTS blob_meta (" +
    "kind TEXT NOT NULL, id TEXT NOT NULL, size INTEGER NOT NULL, chunks INTEGER NOT NULL, " +
    "updatedAt INTEGER NOT NULL, PRIMARY KEY (kind, id))",
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
  "CREATE TABLE IF NOT EXISTS worldmeta (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS econ (" +
    "countryId TEXT PRIMARY KEY, activity REAL NOT NULL DEFAULT 1.0, employment REAL NOT NULL DEFAULT 0.92, " +
    "priceIndex REAL NOT NULL DEFAULT 1.0, pi REAL NOT NULL DEFAULT 0.02, treasury REAL NOT NULL DEFAULT 0, " +
    "data TEXT NOT NULL, updatedAt INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS polity (" +
    "id TEXT PRIMARY KEY, kind TEXT, govType TEXT, approval REAL NOT NULL DEFAULT 55, " +
    "termDay REAL, officeHolder TEXT, data TEXT NOT NULL, updatedAt INTEGER NOT NULL)",
];

let db = null;

function reply(id, payload) {
  postMessage(Object.assign({ id: id }, payload));
}

function handleInit(m) {
  // NOTE: VENDOR_DIR is intentionally hardcoded relative to THIS worker
  // script's own location (src/workers/), not to sqlitedb.js's page-root-
  // relative VENDOR_DIR constant — importScripts()/fetch() inside a Worker
  // resolve relative to the worker's own URL, not the document's, so the
  // two constants are correctly different strings pointing at the same
  // real directory. m.vendorDir is accepted but ignored on purpose: there
  // is no page-relative-to-worker-relative path transform worth trusting
  // over just hardcoding the one relative path that is actually correct.
  importScripts(VENDOR_DIR + "sqlite3.js");
  return self.sqlite3InitModule({
    locateFile: function (path) { return VENDOR_DIR + path; },
  }).then(function (sqlite3) {
    return sqlite3.installOpfsSAHPoolVfs({ name: "cbz-sqlitedb-sahpool" });
  }).then(function (poolUtil) {
    db = new poolUtil.OpfsSAHPoolDb("/" + (m.dbName || "cbz-cityworld") + ".sqlite3");
    db.transaction(function () {
      for (const sql of SCHEMA_STATEMENTS) db.exec(sql);
    });
    return { ok: true };
  });
}

function handleBatch(m) {
  db.transaction(function () {
    for (const st of m.statements) db.exec({ sql: st.sql, bind: st.params || [] });
  });
  return { ok: true };
}

function handleQuery(m) {
  const rows = db.selectObjects(m.sql, m.params || []);
  return { ok: true, rows: rows };
}

self.onmessage = function (ev) {
  const m = ev.data || {};
  if (m.op === "init") {
    handleInit(m).then(function (r) { reply(m.id, r); }).catch(function (e) {
      reply(m.id, { ok: false, error: String((e && e.message) || e) });
    });
    return;
  }
  if (!db) { reply(m.id, { ok: false, error: "db not ready" }); return; }
  try {
    let result;
    if (m.op === "batch") result = handleBatch(m);
    else if (m.op === "query") result = handleQuery(m);
    else result = { ok: false, error: "unknown op " + m.op };
    reply(m.id, result);
  } catch (e) {
    reply(m.id, { ok: false, error: String((e && e.message) || e) });
  }
};
