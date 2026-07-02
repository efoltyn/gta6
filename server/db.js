// server/db.js — Cell Block Z world database (node:sqlite). Zero dependencies.
//
// WHY: server.js used to hold the whole world as one in-memory JSON object
// flushed to one file, and the wire protocol self-capped a world save at
// 1.4MB (net/netpersist.js) to stay clear of wsmini.js's ~1.5MB hard socket
// kill. That "1.4MB cap" was real and it died with wsmini's frame limit
// (server/wsmini.js MAX_MSG) being raised — see that file's header. This
// module kills the OTHER half: server-side storage. Blobs are chunked into
// ~256KB rows so no single SQLite row, JS string, or JSON.stringify call
// ever has to hold "the whole world" as one unit on the storage side either.
//
// This is Stage S, step S1 (BUILD-PLAN.md) — the FOUNDATION. S2-S5 decompose
// these blobs into real tables (people, structures, econ, politics...); the
// API below is shaped so that migration is additive:
//   - open(path)              feature-detects node:sqlite, sets up pragmas
//                              tuned for a game server, runs migrations.
//   - blobPut/blobGet/blobDelete/blobList   the chunked blob store (S1..S4
//                              use this directly; S2+ ADD real tables
//                              alongside it via MIGRATIONS below — nothing
//                              here has to change shape when that happens).
//   - migrate(db, target)     schema_version tracked in PRAGMA user_version;
//                              MIGRATIONS is an ordered array of {version,up}
//                              — S2 appends { version: 2, up(db){ CREATE
//                              TABLE people... } } to this same array.
//   - close()                 checkpoints the WAL and closes cleanly; wire
//                              into the same SIGINT/SIGTERM hooks server.js
//                              already uses for flushWorld().
//
// FALLBACK: node:sqlite is experimental (stable enough here — Node v22.22.2
// prints one ExperimentalWarning on first use, harmless) but may not exist
// on older Node. isAvailable() feature-detects it; callers (server.js) must
// keep the legacy server/worlds/<name>.json path as the automatic fallback
// when it's false. Never assume node:sqlite is present.
"use strict";

const fs = require("fs");
const path = require("path");

let sqliteMod = null;
try { sqliteMod = require("node:sqlite"); } catch (e) { sqliteMod = null; }

function isAvailable() { return !!(sqliteMod && sqliteMod.DatabaseSync); }

// ~256KB chunks (per BUILD-PLAN S1): comfortably under any WS frame limit,
// small enough that a torn write only ever loses the chunk it was writing —
// never the whole blob (writes are transactional anyway, see blobPut).
const CHUNK_SIZE = 256 * 1024;

// Ordered schema migrations. version 1 is S1's own blob store. S2 appends
// { version: 2, up(db) { db.exec("CREATE TABLE people (...)"); } } etc —
// never edit a shipped migration, only append.
const MIGRATIONS = [
  {
    version: 1,
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS blobs (
          kind TEXT NOT NULL,
          id   TEXT NOT NULL,
          seq  INTEGER NOT NULL,
          chunk BLOB NOT NULL,
          PRIMARY KEY (kind, id, seq)
        );
      `);
      db.exec(`
        CREATE TABLE IF NOT EXISTS blob_meta (
          kind TEXT NOT NULL,
          id   TEXT NOT NULL,
          size INTEGER NOT NULL,
          chunks INTEGER NOT NULL,
          updatedAt INTEGER NOT NULL,
          PRIMARY KEY (kind, id)
        );
      `);
    },
  },
];

function currentVersion(db) {
  return db.prepare("PRAGMA user_version").get().user_version | 0;
}
function setVersion(db, v) {
  // PRAGMA doesn't take bound params; v is always our own integer, never
  // user input, so string-interpolating it here is safe.
  db.exec("PRAGMA user_version = " + (v | 0));
}

function migrate(db, target) {
  target = target == null ? MIGRATIONS[MIGRATIONS.length - 1].version : target;
  let v = currentVersion(db);
  const pending = MIGRATIONS.filter((m) => m.version > v && m.version <= target)
    .sort((a, b) => a.version - b.version);
  for (const m of pending) {
    db.exec("BEGIN IMMEDIATE");
    try {
      m.up(db);
      setVersion(db, m.version);
      db.exec("COMMIT");
      v = m.version;
    } catch (e) {
      try { db.exec("ROLLBACK"); } catch (e2) {}
      throw e;
    }
  }
  return v;
}

// Rename a file (and its -wal/-shm siblings, if any) aside so open() can
// start fresh. Used both for "not a database" corruption and (defensively)
// if migration itself throws on an already-open handle.
function quarantine(file) {
  const stamp = Date.now();
  for (const suffix of ["", "-wal", "-shm", "-journal"]) {
    const src = file + suffix;
    if (!fs.existsSync(src)) continue;
    const dst = `${src}.corrupt-${stamp}`;
    try { fs.renameSync(src, dst); } catch (e) { /* best effort */ }
  }
}

function toBuffer(u8) {
  if (Buffer.isBuffer(u8)) return u8;
  return Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength);
}

// open(file) -> handle | null (null only if node:sqlite truly unavailable —
// corruption is handled by quarantining and retrying ONCE, never by
// returning null, so callers can treat "handle returned" as "DB is good").
function open(file) {
  if (!isAvailable()) return null;
  const { DatabaseSync } = sqliteMod;
  fs.mkdirSync(path.dirname(file), { recursive: true });

  let db = null;
  let attempted = false;
  for (;;) {
    try {
      db = new DatabaseSync(file);
      // pragmas tuned for a game server: WAL for concurrent read-while-write
      // (a debounced save shouldn't block reads), NORMAL sync (fsync on
      // checkpoint, not every commit — safe under WAL, much faster), a busy
      // timeout so a brief writer overlap blocks instead of erroring.
      db.exec("PRAGMA journal_mode = WAL");
      db.exec("PRAGMA synchronous = NORMAL");
      db.exec("PRAGMA busy_timeout = 5000");
      db.exec("PRAGMA foreign_keys = ON");
      migrate(db);
      break;
    } catch (e) {
      try { if (db) db.close(); } catch (e2) {}
      db = null;
      if (attempted) throw e; // quarantined once already and STILL broken -> give up loudly
      attempted = true;
      console.error(`[db] open/migrate failed on ${file} (${e.message}) — quarantining and starting fresh`);
      quarantine(file);
    }
  }

  // ---- prepared statements (reused; node:sqlite statements are cheap to
  // keep around and this avoids re-parsing SQL on every call) --------------
  const stDelChunks = db.prepare("DELETE FROM blobs WHERE kind = ? AND id = ?");
  const stDelMeta = db.prepare("DELETE FROM blob_meta WHERE kind = ? AND id = ?");
  const stInsChunk = db.prepare("INSERT INTO blobs (kind, id, seq, chunk) VALUES (?, ?, ?, ?)");
  const stUpsertMeta = db.prepare(
    "INSERT INTO blob_meta (kind, id, size, chunks, updatedAt) VALUES (?, ?, ?, ?, ?) " +
    "ON CONFLICT(kind, id) DO UPDATE SET size = excluded.size, chunks = excluded.chunks, updatedAt = excluded.updatedAt"
  );
  const stGetMeta = db.prepare("SELECT size, chunks FROM blob_meta WHERE kind = ? AND id = ?");
  const stGetChunks = db.prepare("SELECT chunk FROM blobs WHERE kind = ? AND id = ? ORDER BY seq ASC");
  const stListIds = db.prepare("SELECT id FROM blob_meta WHERE kind = ? ORDER BY id ASC");

  // blobPut: chunk `buffer` under (kind,id), replacing whatever was there,
  // in ONE transaction. If it throws partway (including via the optional
  // testHook, used by the harness to inject a torn write) the transaction
  // rolls back and the PREVIOUS complete blob (if any) is left untouched —
  // this is the safety property S1 requires, and it falls straight out of
  // SQLite's transaction atomicity: the DELETE of the old chunks and the
  // INSERT of the new ones are the same all-or-nothing unit.
  function blobPut(kind, id, buffer, opts) {
    if (!Buffer.isBuffer(buffer)) buffer = Buffer.from(buffer);
    opts = opts || {};
    const chunkSize = opts.chunkSize || CHUNK_SIZE;
    const total = buffer.length;
    const nChunks = total === 0 ? 1 : Math.ceil(total / chunkSize);
    db.exec("BEGIN IMMEDIATE");
    try {
      stDelChunks.run(kind, id);
      for (let seq = 0; seq < nChunks; seq++) {
        if (opts.testHook) opts.testHook(seq, nChunks); // fault injection point (tests only)
        const start = seq * chunkSize;
        const end = total === 0 ? 0 : Math.min(total, start + chunkSize);
        const slice = total === 0 ? Buffer.alloc(0) : buffer.subarray(start, end);
        stInsChunk.run(kind, id, seq, slice);
      }
      stUpsertMeta.run(kind, id, total, nChunks, Date.now());
      db.exec("COMMIT");
    } catch (e) {
      try { db.exec("ROLLBACK"); } catch (e2) {}
      throw e;
    }
  }

  function blobGet(kind, id) {
    const meta = stGetMeta.get(kind, id);
    if (!meta) return null;
    if (meta.size === 0) return Buffer.alloc(0);
    const rows = stGetChunks.all(kind, id);
    if (!rows.length) return null; // meta says it exists but chunks are gone — treat as absent
    return Buffer.concat(rows.map((r) => toBuffer(r.chunk)));
  }

  function blobDelete(kind, id) {
    const meta = stGetMeta.get(kind, id);
    if (!meta) return false;
    db.exec("BEGIN IMMEDIATE");
    try {
      stDelChunks.run(kind, id);
      stDelMeta.run(kind, id);
      db.exec("COMMIT");
    } catch (e) {
      try { db.exec("ROLLBACK"); } catch (e2) {}
      throw e;
    }
    return true;
  }

  function blobList(kind) {
    return stListIds.all(kind).map((r) => r.id);
  }

  function close() {
    try { db.exec("PRAGMA wal_checkpoint(TRUNCATE)"); } catch (e) {}
    try { db.close(); } catch (e) {}
  }

  return {
    file,
    raw: db, // escape hatch for S2+ migrations that need direct SQL access
    migrate: (target) => migrate(db, target),
    version: () => currentVersion(db),
    blobPut,
    blobGet,
    blobDelete,
    blobList,
    close,
  };
}

module.exports = { open, isAvailable, CHUNK_SIZE, MIGRATIONS };
