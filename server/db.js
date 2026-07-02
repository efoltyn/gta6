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
// Stage S, step S1 (BUILD-PLAN.md) built the FOUNDATION (blob store). S2
// adds the FIRST real table on top of it — `people`, the population
// registry (migration v2 below) — with S3-S5 to follow (structures,
// econ/politics, sqlite-wasm parity). The API is shaped so each step is
// additive:
//   - open(path)              feature-detects node:sqlite, sets up pragmas
//                              tuned for a game server, runs migrations.
//   - blobPut/blobGet/blobDelete/blobList   the chunked blob store (still
//                              used for everything that ISN'T `people` —
//                              gangs/fracture/politics/econ/etc riders).
//   - peoplePut/peopleGet/peopleAll/peopleByChunk/peopleDelete/peopleCount
//                              the S2 population registry — see migration
//                              v2's own comment below for the shape and
//                              server.js for how the `blob.npc` worldBlob
//                              rider gets extracted into it / reassembled
//                              out of it (the wire protocol is unchanged).
//   - structPut/structGet/structAll/structByChunk/structDelete
//     basePut/baseGet/baseAll/baseByChunk/baseDelete
//     containerPut/containerGet/containerAll/containersByBase/containerDelete
//                              S3's three tables — player-built pieces,
//                              BaseRecords (+ruins), and container inventories.
//                              See migration v3's own comment below for the
//                              shape and server.js for how `blob.bld`/
//                              `blob.base` (net/netpersist.js worldBlob
//                              riders, fed by src/systems/building.js and
//                              src/systems/baseclaim.js) get extracted/
//                              reassembled. UNLIKE `people`, rows here are
//                              REALLY deleted when a piece/base/container
//                              stops existing — see that migration's
//                              comment for why (rubble doesn't stay in the
//                              books; only an event log would, and this
//                              wave doesn't add one).
//   - migrate(db, target)     schema_version tracked in PRAGMA user_version;
//                              MIGRATIONS is an ordered array of {version,up}
//                              — never edit a shipped migration, only append.
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
  // S2 (BUILD-PLAN.md Stage S): the population registry — the FIRST real
  // table alongside the blob store. src/city/schedule.js's client-side
  // ledger (CAP 900) still owns the live simulation and still rides the
  // `blob.npc` worldBlob rider on the wire (net/netpersist.js is untouched
  // — old clients keep working byte-for-byte); server.js now EXTRACTS that
  // rider into this table on every wsave and REASSEMBLES it on load. The
  // table exists so the server can (a) hold more people than the client
  // cap ever could (the cap dies HERE, server-side; the client cap is a
  // separate, still-standing concern — S4/S5's problem) and (b) answer
  // "who lives/works near chunk (cx,cz)" without walking a JS array — see
  // peopleByChunk below and the (cx,cz) index it hits. `data` keeps the
  // FULL ledger entry as JSON (the long tail of rider fields — rel/hh/act/
  // etc — stays schemaless this wave); the named columns are just an
  // indexed projection of it, derived from the entry's home anchor
  // (hx/hz in schedule.js) and work anchor (jx/jz) bucketed into 16m chunks.
  {
    version: 2,
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS people (
          sid TEXT PRIMARY KEY,
          name TEXT,
          sex INTEGER NOT NULL DEFAULT 0,
          x REAL NOT NULL DEFAULT 0,
          z REAL NOT NULL DEFAULT 0,
          cx INTEGER NOT NULL DEFAULT 0,
          cz INTEGER NOT NULL DEFAULT 0,
          workCx INTEGER NOT NULL DEFAULT 0,
          workCz INTEGER NOT NULL DEFAULT 0,
          cash REAL NOT NULL DEFAULT 0,
          alive INTEGER NOT NULL DEFAULT 1,
          data TEXT NOT NULL,
          updatedAt INTEGER NOT NULL
        );
      `);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_people_chunk ON people (cx, cz);`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_people_workchunk ON people (workCx, workCz);`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_people_alive ON people (alive);`);
    },
  },
  // S3 (BUILD-PLAN.md Stage S): player-building persistence — the SAME
  // chunk-indexed-table treatment S2 gave `people`, now for pieces/bases/
  // containers. Three tables:
  //
  //   structures — one row per placed piece (src/systems/building.js's
  //     `blob.bld.pieces[]`, net/netpersist.js's worldBlob rider). `pieceId`
  //     is NOT the client's ephemeral in-memory id (building.js hands out
  //     fresh "pc_"+seq ids every boot, see pieces.js's pieceSeq — those
  //     never survive a reload). Instead it's building.js's own occupancy
  //     key (`gx,gy,gz,slot` — building.js:292 occKey, slotFor:304), which
  //     IS already a stable, collision-free identity: building.js's own
  //     occupancy Map enforces at most one live piece per key, forever, by
  //     construction. server.js derives it the same way from the wire
  //     record (kind+gx+gy+gz+rot are all it has). `x/y/z` are the piece's
  //     world position (building.js's gridToWorld: x=gx*CELL, y=gy*WALL_H,
  //     z=gz*CELL — CELL=3, WALL_H=2.5, mirrored server-side since the
  //     server has no access to that client module); `cx/cz` are those
  //     bucketed into the SAME 16m chunk grid systems/chunks.js and S2's
  //     `people` table already use (chunkCoord below — one convention, one
  //     function). `baseId` is which BaseRecord's radius (if any) covers
  //     this piece's position at save time — nullable (unclaimed/wild
  //     piece). `material` has no source data yet (building.js's B.serialize
  //     doesn't carry piece.tier — B1-B8 shipped wood tier only) — server.js
  //     always writes "wood" today; the column exists so B5's future
  //     material×damage tiers have somewhere to land without another
  //     migration. `data` keeps the full wire record (kind/gx/gy/gz/rot/hp/
  //     ownerId/open/locked/contents) so reassembly is exact.
  //
  //   bases — one row per BaseRecord OR ruin (src/systems/baseclaim.js's
  //     `blob.base.bases[]`/`.ruins[]`). NOTE the client's own BaseRecord
  //     names its world-position fields `cx`/`cz` (baseclaim.js: "cx:
  //     piece.pos.x, cz: piece.pos.z") — those are NOT chunk coordinates,
  //     despite the name; a pre-existing naming quirk in that file, not
  //     this one. This table's `x`/`z` columns hold that world position;
  //     THIS table's own `cx`/`cz` columns are the real chunk bucket
  //     (chunkCoord(x), chunkCoord(z)), consistent with `structures` and
  //     `people`. `ruin` (0/1) distinguishes a live, owned BaseRecord from
  //     a cupboardless "ruins" shadow record (baseclaim.js's B8 RUINS
  //     paragraph) — folded into this one table rather than a 4th, since a
  //     ruin is structurally identical (position+radius, decays at 2x) and
  //     the task's own table list only names three. `upkeepUntil` is the
  //     B8 decay clock (0 for a ruin — always overdue, decayTick's own
  //     rule) — see server.js's mapping-comment for the full B8 field
  //     mapping and why the global `playClock` scalar (not per-base) rides
  //     in the un-extracted remainder of `blob.base` instead of a column
  //     here. `auth` is the authorized-pid JSON array (empty for a ruin).
  //
  //   containers — one row per container-KIND piece's inventory (a subset
  //     of `structures`; `containerId` == that piece's `pieceId`, kept as
  //     its own column per the task's schema rather than reusing the name,
  //     so a caller never has to remember which table's PK is aliased).
  //     `pieceId` is declared REFERENCES structures(pieceId) ON DELETE
  //     CASCADE — this is the cascade-semantics DECISION for S3: when a
  //     structure row is deleted (structDelete, or a save's diff removing
  //     a demolished/decayed piece), SQLite itself removes any orphaned
  //     container row in the SAME transaction, at the engine level, rather
  //     than server.js hand-rolling a second delete. `code` (a keypad
  //     code) has no source data yet either — src/systems/baseclaim.js's
  //     lock model is a plain boolean `locked`, no keycode string exists
  //     client-side this wave — the column is forward-compat scaffolding,
  //     always NULL today.
  //
  // DELETIONS ARE REAL (unlike `people`): a demolished/decayed/collapsed
  // piece is actually gone from the world — "rubble doesn't stay in the
  // books" the way a dead person's ledger row does (MASTER-PLAN Part V.0's
  // persistence principle is about PEOPLE; a destroyed structure has no
  // equivalent "stays in the books" requirement). If a future wave wants a
  // raid/demolition HISTORY, that's an EVENT LOG (a new table recording
  // "piece X destroyed by Y at time T"), not a tombstone flag on this row
  // — the row's job is "what currently exists", full stop. server.js's
  // extraction treats each save's full piece/base list as authoritative
  // (building.js's B.serialize() already re-walks CBZ.pieces and emits the
  // COMPLETE current set every time, same shape peopleAll's `data` already
  // assumed for people) and deletes whatever's no longer in it.
  {
    version: 3,
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS structures (
          pieceId TEXT PRIMARY KEY,
          baseId TEXT,
          kind TEXT NOT NULL,
          x REAL NOT NULL DEFAULT 0,
          y REAL NOT NULL DEFAULT 0,
          z REAL NOT NULL DEFAULT 0,
          cx INTEGER NOT NULL DEFAULT 0,
          cz INTEGER NOT NULL DEFAULT 0,
          rot INTEGER NOT NULL DEFAULT 0,
          hp REAL NOT NULL DEFAULT 0,
          material TEXT,
          data TEXT NOT NULL,
          updatedAt INTEGER NOT NULL
        );
      `);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_structures_chunk ON structures (cx, cz);`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_structures_base ON structures (baseId);`);

      db.exec(`
        CREATE TABLE IF NOT EXISTS bases (
          baseId TEXT PRIMARY KEY,
          ownerId TEXT,
          x REAL NOT NULL DEFAULT 0,
          z REAL NOT NULL DEFAULT 0,
          cx INTEGER NOT NULL DEFAULT 0,
          cz INTEGER NOT NULL DEFAULT 0,
          radius REAL NOT NULL DEFAULT 0,
          upkeepUntil REAL NOT NULL DEFAULT 0,
          ruin INTEGER NOT NULL DEFAULT 0,
          auth TEXT NOT NULL DEFAULT '[]',
          data TEXT NOT NULL,
          updatedAt INTEGER NOT NULL
        );
      `);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_bases_chunk ON bases (cx, cz);`);

      db.exec(`
        CREATE TABLE IF NOT EXISTS containers (
          containerId TEXT PRIMARY KEY,
          pieceId TEXT NOT NULL REFERENCES structures(pieceId) ON DELETE CASCADE,
          baseId TEXT,
          inventory TEXT NOT NULL DEFAULT '{}',
          locked INTEGER NOT NULL DEFAULT 0,
          code TEXT,
          updatedAt INTEGER NOT NULL
        );
      `);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_containers_base ON containers (baseId);`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_containers_piece ON containers (pieceId);`);
    },
  },
  // S4 (BUILD-PLAN.md Stage S): econ/political tables + the world-clock
  // bookkeeping the offline tick (server/ticks.js) reads and writes. THREE
  // tables:
  //
  //   worldmeta — a tiny generic key/value store (key TEXT PRIMARY KEY,
  //     value the JSON-encoded blob). One row this wave, key "world":
  //     { worldDay, lastTickAt, tickLog:[...] } — see server/ticks.js's own
  //     header for what each field means and how "no double-advance" is
  //     enforced (every real client wsave re-stamps lastTickAt to now,
  //     the offline tick only ever reads/advances it while the room is
  //     empty). A generic key/value shape (not a one-off `world_meta` table
  //     with named columns) because this is server-bookkeeping data, not a
  //     queryable game-entity registry the way econ/polity below are — no
  //     caller ever needs "every worldmeta row where X", just "the current
  //     value of key K".
  //
  //   econ — a MIRROR of sim/econstate.js's `blob.econ` rider (one row per
  //     jurisdiction id `blob.econ.reg` tracks — THIS wave that is exactly
  //     "libertyville", the one real economy econstate.js's own header says
  //     it ships) PLUS the one field that rider doesn't carry: `pi`,
  //     mirrored in from sim/inflation.js's OWN per-COUNTRY `blob.inf`
  //     rider (server/ticks.js's own header explains the hardcoded
  //     "libertyville" <-> "republic" id-space bridge, the same one
  //     inflation.js's own capIdFor("republic") special-cases client-side).
  //     MIRROR, not strip-and-reassemble (unlike people/structures/bases):
  //     `blob.econ`/`blob.pol` are never stripped out of the stored world
  //     blob — they keep riding it in full, exactly as before S2/S3, so a
  //     reconnecting client's applyWorld() needs zero new code. This table
  //     exists so (a) the econ state is queryable/uncapped outside a full
  //     blob deserialize and (b) the offline tick (which runs with NO
  //     client connected, nothing to apply() onto) has something to read
  //     and write. Every wsave re-mirrors the tables from the freshly
  //     stripped... no — freshly RECEIVED blob (extractEconFromWorld in
  //     server.js), so the table is never more than one autosave stale
  //     relative to a connected client's own live simulation. `data` keeps
  //     the jurisdiction's full econstate.js record shape (activity/
  //     employment/priceIndex/piYest/taxRate/treasury) so nothing is lost
  //     that a future column doesn't yet cover.
  //
  //   polity — a MIRROR of city/polity.js's `blob.pol` rider (one row per
  //     jurisdiction id `blob.pol.rec` carries — every country/state/city/
  //     federal-territory record the world has registered, X3-added
  //     countries included). Same mirror rationale as econ above. `kind`
  //     is NOT derivable from the rider (polity.js's serialize() only ever
  //     carries the MUTABLE fields — govType/treasury/taxRate/approval/
  //     office/currencyId — never `kind`, which is static geography
  //     rebuilt fresh by buildRecords() every run and never persisted) —
  //     left NULL; nothing this wave's tick logic reads needs it (the one
  //     govType check elections.js's own tickOffice() makes — "skip a
  //     monarchy" — is by govType, not kind). `termDay`/`officeHolder` are
  //     `office.termDay`/`office.holder` pulled up into named, queryable
  //     columns; `data` keeps the full per-id sub-object.
  {
    version: 4,
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS worldmeta (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
      `);
      db.exec(`
        CREATE TABLE IF NOT EXISTS econ (
          countryId TEXT PRIMARY KEY,
          activity REAL NOT NULL DEFAULT 1.0,
          employment REAL NOT NULL DEFAULT 0.92,
          priceIndex REAL NOT NULL DEFAULT 1.0,
          pi REAL NOT NULL DEFAULT 0.02,
          treasury REAL NOT NULL DEFAULT 0,
          data TEXT NOT NULL,
          updatedAt INTEGER NOT NULL
        );
      `);
      db.exec(`
        CREATE TABLE IF NOT EXISTS polity (
          id TEXT PRIMARY KEY,
          kind TEXT,
          govType TEXT,
          approval REAL NOT NULL DEFAULT 55,
          termDay REAL,
          officeHolder TEXT,
          data TEXT NOT NULL,
          updatedAt INTEGER NOT NULL
        );
      `);
    },
  },
];

// 16m-square chunks (matches F4's systems/chunks.js grid) — a person's
// home/work anchor bucketed the same way the world already buckets pieces.
const PEOPLE_CHUNK_M = 16;
function chunkCoord(v) { return Math.floor((+v || 0) / PEOPLE_CHUNK_M); }

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

  // ---- people table (S2): the population registry ------------------------
  const stPeopleUpsert = db.prepare(`
    INSERT INTO people (sid, name, sex, x, z, cx, cz, workCx, workCz, cash, alive, data, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(sid) DO UPDATE SET
      name = excluded.name, sex = excluded.sex, x = excluded.x, z = excluded.z,
      cx = excluded.cx, cz = excluded.cz, workCx = excluded.workCx, workCz = excluded.workCz,
      cash = excluded.cash, alive = excluded.alive, data = excluded.data, updatedAt = excluded.updatedAt
  `);
  const stPeopleGet = db.prepare("SELECT * FROM people WHERE sid = ?");
  const stPeopleDelete = db.prepare("DELETE FROM people WHERE sid = ?");
  const stPeopleCount = db.prepare("SELECT COUNT(*) AS n FROM people");
  const stPeopleAll = db.prepare("SELECT * FROM people ORDER BY sid ASC");
  const stPeopleAllAlive = db.prepare("SELECT * FROM people WHERE alive = 1 ORDER BY sid ASC");
  // INDEXED BY pins the query planner to idx_people_chunk explicitly — with
  // no ANALYZE stats and a table this narrow, SQLite's cost estimator can
  // otherwise prefer idx_people_alive (alive is nearly always 1, but on a
  // tiny/fresh table the planner doesn't know that) instead of the (cx,cz)
  // range index this query exists to hit. The hint makes "chunk-indexed"
  // a guarantee, not a heuristic that flips with table size.
  const stPeopleByChunk = db.prepare(
    "SELECT * FROM people INDEXED BY idx_people_chunk WHERE alive = 1 AND cx BETWEEN ? AND ? AND cz BETWEEN ? AND ? ORDER BY sid ASC"
  );

  // a DB row -> the shape callers want: named/indexed columns alongside the
  // full original ledger entry (parsed from `data`) so a consumer never has
  // to reconstruct rider fields (rel/hh/act/...) from the projection.
  function rowToEntry(row) {
    if (!row) return null;
    let data = null;
    try { data = JSON.parse(row.data); } catch (e) { data = null; }
    return {
      sid: row.sid, name: row.name, sex: row.sex | 0,
      x: row.x, z: row.z, cx: row.cx | 0, cz: row.cz | 0,
      workCx: row.workCx | 0, workCz: row.workCz | 0,
      cash: row.cash, alive: !!row.alive, updatedAt: row.updatedAt,
      data,
    };
  }

  // peoplePut: transactional upsert of ledger entries (schedule.js's `e`
  // shape — sid/name/sex/hx/hz/jx/jz/tx/tz/cash/alive/...). Idempotent by
  // sid — a person present in the batch inserts-or-overwrites; a person
  // NOT in the batch is left completely untouched (no delete, ever — the
  // persistence principle: the dead stay in the books, see MASTER-PLAN
  // Part V.0). x/z come from the entry's last-seen position (tx/tz,
  // falling back to the home anchor); cx/cz are the HOME anchor's chunk;
  // workCx/workCz are the WORK anchor's chunk (falls back to home if the
  // entry has no job/vendor/gang anchor). Returns the number of rows written.
  function peoplePut(entries) {
    if (!Array.isArray(entries) || !entries.length) return 0;
    let n = 0;
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const e of entries) {
        if (!e || !e.sid) continue;
        const homeX = e.hx != null ? e.hx : (e.tx != null ? e.tx : 0);
        const homeZ = e.hz != null ? e.hz : (e.tz != null ? e.tz : 0);
        const workX = e.jx != null ? e.jx : homeX;
        const workZ = e.jz != null ? e.jz : homeZ;
        const x = e.tx != null ? e.tx : homeX;
        const z = e.tz != null ? e.tz : homeZ;
        stPeopleUpsert.run(
          String(e.sid),
          e.name != null ? String(e.name) : null,
          e.sex ? 1 : 0,
          +x || 0, +z || 0,
          chunkCoord(homeX), chunkCoord(homeZ),
          chunkCoord(workX), chunkCoord(workZ),
          +e.cash || 0,
          e.alive === false ? 0 : 1,
          JSON.stringify(e),
          Date.now()
        );
        n++;
      }
      db.exec("COMMIT");
    } catch (err) {
      try { db.exec("ROLLBACK"); } catch (e2) {}
      throw err;
    }
    return n;
  }

  function peopleGet(sid) { return rowToEntry(stPeopleGet.get(sid)); }

  function peopleAll(opts) {
    const st = (opts && opts.aliveOnly) ? stPeopleAllAlive : stPeopleAll;
    return st.all().map(rowToEntry);
  }

  // peopleByChunk: everyone whose HOME anchor falls within `r` chunks of
  // (cx,cz) — a square (Chebyshev) radius, cheap and index-friendly (hits
  // idx_people_chunk's leading (cx,cz) columns via a BETWEEN range scan).
  // Dead (alive=0) rows never come back from a spawn query — they stay in
  // the books (peopleAll with no aliveOnly filter still sees them).
  function peopleByChunk(cx, cz, r) {
    cx = cx | 0; cz = cz | 0; r = Math.max(0, r | 0);
    return stPeopleByChunk.all(cx - r, cx + r, cz - r, cz + r).map(rowToEntry);
  }

  function peopleDelete(sid) {
    const existed = !!stPeopleGet.get(sid);
    if (existed) stPeopleDelete.run(sid);
    return existed;
  }

  function peopleCount() { return stPeopleCount.get().n | 0; }

  // ---- structures table (S3): player-placed pieces ------------------------
  const stStructUpsert = db.prepare(`
    INSERT INTO structures (pieceId, baseId, kind, x, y, z, cx, cz, rot, hp, material, data, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(pieceId) DO UPDATE SET
      baseId = excluded.baseId, kind = excluded.kind, x = excluded.x, y = excluded.y, z = excluded.z,
      cx = excluded.cx, cz = excluded.cz, rot = excluded.rot, hp = excluded.hp, material = excluded.material,
      data = excluded.data, updatedAt = excluded.updatedAt
  `);
  const stStructGet = db.prepare("SELECT * FROM structures WHERE pieceId = ?");
  const stStructDelete = db.prepare("DELETE FROM structures WHERE pieceId = ?");
  const stStructAll = db.prepare("SELECT * FROM structures ORDER BY pieceId ASC");
  const stStructByBase = db.prepare("SELECT * FROM structures WHERE baseId = ? ORDER BY pieceId ASC");
  // INDEXED BY pin — same rationale as idx_people_chunk (peopleByChunk's own
  // comment above): a tiny/fresh table can't be trusted to have ANALYZE
  // stats good enough for the planner to prefer this range index on its own.
  const stStructByChunk = db.prepare(
    "SELECT * FROM structures INDEXED BY idx_structures_chunk WHERE cx BETWEEN ? AND ? AND cz BETWEEN ? AND ? ORDER BY pieceId ASC"
  );

  function rowToStructEntry(row) {
    if (!row) return null;
    let data = null;
    try { data = JSON.parse(row.data); } catch (e) { data = null; }
    return {
      pieceId: row.pieceId, baseId: row.baseId || null, kind: row.kind,
      x: row.x, y: row.y, z: row.z, cx: row.cx | 0, cz: row.cz | 0,
      rot: row.rot | 0, hp: row.hp, material: row.material || null,
      updatedAt: row.updatedAt, data,
    };
  }

  // structPut: transactional upsert, idempotent by pieceId — mirrors
  // peoplePut's shape but this is the ONLY of the two families where the
  // CALLER (server.js) is expected to also call structDelete for ids that
  // dropped out of the latest save's full piece list (see migration v3's
  // header: deletions are real here). Returns rows written.
  function structPut(rows) {
    if (!Array.isArray(rows) || !rows.length) return 0;
    let n = 0;
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const r of rows) {
        if (!r || !r.pieceId) continue;
        stStructUpsert.run(
          String(r.pieceId), r.baseId != null ? String(r.baseId) : null, String(r.kind || "piece"),
          +r.x || 0, +r.y || 0, +r.z || 0, chunkCoord(r.x), chunkCoord(r.z),
          (r.rot | 0), +r.hp || 0, r.material != null ? String(r.material) : null,
          JSON.stringify(r.data !== undefined ? r.data : r), r.updatedAt || Date.now()
        );
        n++;
      }
      db.exec("COMMIT");
    } catch (err) {
      try { db.exec("ROLLBACK"); } catch (e2) {}
      throw err;
    }
    return n;
  }
  function structGet(pieceId) { return rowToStructEntry(stStructGet.get(pieceId)); }
  function structAll() { return stStructAll.all().map(rowToStructEntry); }
  function structByBase(baseId) { return stStructByBase.all(baseId).map(rowToStructEntry); }
  // structByChunk: square (Chebyshev) radius, same shape as peopleByChunk.
  function structByChunk(cx, cz, r) {
    cx = cx | 0; cz = cz | 0; r = Math.max(0, r | 0);
    return stStructByChunk.all(cx - r, cx + r, cz - r, cz + r).map(rowToStructEntry);
  }
  // structDelete: REAL delete (see migration v3 header) — cascades to any
  // container row referencing this pieceId via the FK's ON DELETE CASCADE
  // (containers.pieceId REFERENCES structures(pieceId)), enforced by
  // SQLite itself (open()'s `PRAGMA foreign_keys = ON`), not hand-rolled
  // here. Returns whether a row existed.
  function structDelete(pieceId) {
    const existed = !!stStructGet.get(pieceId);
    if (existed) stStructDelete.run(pieceId);
    return existed;
  }

  // ---- bases table (S3): BaseRecords + ruins (see migration v3 header) ---
  const stBaseUpsert = db.prepare(`
    INSERT INTO bases (baseId, ownerId, x, z, cx, cz, radius, upkeepUntil, ruin, auth, data, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(baseId) DO UPDATE SET
      ownerId = excluded.ownerId, x = excluded.x, z = excluded.z, cx = excluded.cx, cz = excluded.cz,
      radius = excluded.radius, upkeepUntil = excluded.upkeepUntil, ruin = excluded.ruin,
      auth = excluded.auth, data = excluded.data, updatedAt = excluded.updatedAt
  `);
  const stBaseGet = db.prepare("SELECT * FROM bases WHERE baseId = ?");
  const stBaseDelete = db.prepare("DELETE FROM bases WHERE baseId = ?");
  const stBaseAll = db.prepare("SELECT * FROM bases ORDER BY baseId ASC");
  const stBaseByChunk = db.prepare(
    "SELECT * FROM bases INDEXED BY idx_bases_chunk WHERE cx BETWEEN ? AND ? AND cz BETWEEN ? AND ? ORDER BY baseId ASC"
  );

  function rowToBaseEntry(row) {
    if (!row) return null;
    let data = null, auth = [];
    try { data = JSON.parse(row.data); } catch (e) { data = null; }
    try { auth = JSON.parse(row.auth); } catch (e) { auth = []; }
    return {
      baseId: row.baseId, ownerId: row.ownerId || null,
      x: row.x, z: row.z, cx: row.cx | 0, cz: row.cz | 0,
      radius: row.radius, upkeepUntil: row.upkeepUntil, ruin: !!row.ruin,
      authorized: auth, updatedAt: row.updatedAt, data,
    };
  }

  function basePut(rows) {
    if (!Array.isArray(rows) || !rows.length) return 0;
    let n = 0;
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const r of rows) {
        if (!r || !r.baseId) continue;
        stBaseUpsert.run(
          String(r.baseId), r.ownerId != null ? String(r.ownerId) : null,
          +r.x || 0, +r.z || 0, chunkCoord(r.x), chunkCoord(r.z),
          +r.radius || 0, +r.upkeepUntil || 0, r.ruin ? 1 : 0,
          JSON.stringify(r.authorized || []), JSON.stringify(r.data !== undefined ? r.data : r),
          r.updatedAt || Date.now()
        );
        n++;
      }
      db.exec("COMMIT");
    } catch (err) {
      try { db.exec("ROLLBACK"); } catch (e2) {}
      throw err;
    }
    return n;
  }
  function baseGet(baseId) { return rowToBaseEntry(stBaseGet.get(baseId)); }
  function baseAll() { return stBaseAll.all().map(rowToBaseEntry); }
  function baseByChunk(cx, cz, r) {
    cx = cx | 0; cz = cz | 0; r = Math.max(0, r | 0);
    return stBaseByChunk.all(cx - r, cx + r, cz - r, cz + r).map(rowToBaseEntry);
  }
  // baseDelete: REAL delete — does NOT cascade to structures (a base's
  // pieces outlive its BaseRecord, per baseclaim.js's own RUINS design;
  // the caller is expected to write a `ruin` row separately if that's the
  // desired shadow-record behavior, exactly as basePut's `ruin` rows do).
  function baseDelete(baseId) {
    const existed = !!stBaseGet.get(baseId);
    if (existed) stBaseDelete.run(baseId);
    return existed;
  }

  // ---- containers table (S3): container-piece inventories -----------------
  const stContUpsert = db.prepare(`
    INSERT INTO containers (containerId, pieceId, baseId, inventory, locked, code, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(containerId) DO UPDATE SET
      pieceId = excluded.pieceId, baseId = excluded.baseId, inventory = excluded.inventory,
      locked = excluded.locked, code = excluded.code, updatedAt = excluded.updatedAt
  `);
  const stContGet = db.prepare("SELECT * FROM containers WHERE containerId = ?");
  const stContDelete = db.prepare("DELETE FROM containers WHERE containerId = ?");
  const stContAll = db.prepare("SELECT * FROM containers ORDER BY containerId ASC");
  const stContByBase = db.prepare("SELECT * FROM containers WHERE baseId = ? ORDER BY containerId ASC");

  function rowToContEntry(row) {
    if (!row) return null;
    let inventory = {};
    try { inventory = JSON.parse(row.inventory); } catch (e) { inventory = {}; }
    return {
      containerId: row.containerId, pieceId: row.pieceId, baseId: row.baseId || null,
      inventory, locked: !!row.locked, code: row.code || null, updatedAt: row.updatedAt,
    };
  }

  // containerPut: transactional upsert. NOTE: the FK (pieceId REFERENCES
  // structures(pieceId)) means a container row can only be written for a
  // pieceId that ALREADY has a structures row — callers (server.js) must
  // structPut() the owning piece first, in an earlier transaction, same
  // save. Throws (surfaced to the caller, same as any other constraint
  // violation) if that invariant is broken.
  function containerPut(rows) {
    if (!Array.isArray(rows) || !rows.length) return 0;
    let n = 0;
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const r of rows) {
        if (!r || !r.containerId) continue;
        stContUpsert.run(
          String(r.containerId), String(r.pieceId || r.containerId), r.baseId != null ? String(r.baseId) : null,
          JSON.stringify(r.inventory || {}), r.locked ? 1 : 0, r.code != null ? String(r.code) : null,
          r.updatedAt || Date.now()
        );
        n++;
      }
      db.exec("COMMIT");
    } catch (err) {
      try { db.exec("ROLLBACK"); } catch (e2) {}
      throw err;
    }
    return n;
  }
  function containerGet(containerId) { return rowToContEntry(stContGet.get(containerId)); }
  function containerAll() { return stContAll.all().map(rowToContEntry); }
  function containersByBase(baseId) { return stContByBase.all(baseId).map(rowToContEntry); }
  function containerDelete(containerId) {
    const existed = !!stContGet.get(containerId);
    if (existed) stContDelete.run(containerId);
    return existed;
  }

  // ---- worldmeta table (S4): generic key/value store ----------------------
  const stMetaUpsert = db.prepare(
    "INSERT INTO worldmeta (key, value) VALUES (?, ?) " +
    "ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  );
  const stMetaGet = db.prepare("SELECT value FROM worldmeta WHERE key = ?");
  // metaGet(key) -> parsed JSON value, or null if the key was never set (or
  // its stored JSON is somehow corrupt — treated as absent, never thrown).
  function metaGet(key) {
    const row = stMetaGet.get(key);
    if (!row) return null;
    try { return JSON.parse(row.value); } catch (e) { return null; }
  }
  function metaSet(key, value) { stMetaUpsert.run(key, JSON.stringify(value)); }

  // ---- econ table (S4): a mirror of sim/econstate.js's blob.econ rider,
  // one row per tracked jurisdiction id, plus the `pi` mirror-in from
  // sim/inflation.js's own per-country rider (see migration v4's own
  // comment for the id-space bridge and the mirror-not-strip rationale).
  const stEconUpsert = db.prepare(`
    INSERT INTO econ (countryId, activity, employment, priceIndex, pi, treasury, data, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(countryId) DO UPDATE SET
      activity = excluded.activity, employment = excluded.employment, priceIndex = excluded.priceIndex,
      pi = excluded.pi, treasury = excluded.treasury, data = excluded.data, updatedAt = excluded.updatedAt
  `);
  const stEconGet = db.prepare("SELECT * FROM econ WHERE countryId = ?");
  const stEconAll = db.prepare("SELECT * FROM econ ORDER BY countryId ASC");

  function rowToEconEntry(row) {
    if (!row) return null;
    let data = null;
    try { data = JSON.parse(row.data); } catch (e) { data = null; }
    return {
      countryId: row.countryId, activity: row.activity, employment: row.employment,
      priceIndex: row.priceIndex, pi: row.pi, treasury: row.treasury,
      updatedAt: row.updatedAt, data,
    };
  }
  // econPut: transactional upsert, idempotent by countryId (mirrors
  // structPut's shape). Never deletes — a jurisdiction that stops appearing
  // in a save's blob.econ.reg (never happens this wave; the registry only
  // ever grows) simply stops being refreshed, same "no delete" posture
  // peoplePut takes for the population registry.
  function econPut(rows) {
    if (!Array.isArray(rows) || !rows.length) return 0;
    let n = 0;
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const r of rows) {
        if (!r || !r.countryId) continue;
        stEconUpsert.run(
          String(r.countryId), +r.activity || 0, +r.employment || 0, +r.priceIndex || 0,
          isFinite(r.pi) ? +r.pi : 0.02, +r.treasury || 0,
          JSON.stringify(r.data !== undefined ? r.data : r), r.updatedAt || Date.now()
        );
        n++;
      }
      db.exec("COMMIT");
    } catch (err) {
      try { db.exec("ROLLBACK"); } catch (e2) {}
      throw err;
    }
    return n;
  }
  function econGet(countryId) { return rowToEconEntry(stEconGet.get(countryId)); }
  function econAll() { return stEconAll.all().map(rowToEconEntry); }

  // ---- polity table (S4): a mirror of city/polity.js's blob.pol rider,
  // one row per registered jurisdiction id (see migration v4's own comment
  // for why `kind` is always NULL this wave).
  const stPolityUpsert = db.prepare(`
    INSERT INTO polity (id, kind, govType, approval, termDay, officeHolder, data, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      kind = excluded.kind, govType = excluded.govType, approval = excluded.approval,
      termDay = excluded.termDay, officeHolder = excluded.officeHolder, data = excluded.data, updatedAt = excluded.updatedAt
  `);
  const stPolityGet = db.prepare("SELECT * FROM polity WHERE id = ?");
  const stPolityAll = db.prepare("SELECT * FROM polity ORDER BY id ASC");

  function rowToPolityEntry(row) {
    if (!row) return null;
    let data = null;
    try { data = JSON.parse(row.data); } catch (e) { data = null; }
    return {
      id: row.id, kind: row.kind || null, govType: row.govType || null, approval: row.approval,
      termDay: row.termDay != null ? row.termDay : null, officeHolder: row.officeHolder || null,
      updatedAt: row.updatedAt, data,
    };
  }
  function polityPut(rows) {
    if (!Array.isArray(rows) || !rows.length) return 0;
    let n = 0;
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const r of rows) {
        if (!r || !r.id) continue;
        stPolityUpsert.run(
          String(r.id), r.kind != null ? String(r.kind) : null, r.govType != null ? String(r.govType) : null,
          isFinite(r.approval) ? +r.approval : 55,
          (r.termDay != null && isFinite(r.termDay)) ? +r.termDay : null,
          r.officeHolder != null ? String(r.officeHolder) : null,
          JSON.stringify(r.data !== undefined ? r.data : r), r.updatedAt || Date.now()
        );
        n++;
      }
      db.exec("COMMIT");
    } catch (err) {
      try { db.exec("ROLLBACK"); } catch (e2) {}
      throw err;
    }
    return n;
  }
  function polityGet(id) { return rowToPolityEntry(stPolityGet.get(id)); }
  function polityAll() { return stPolityAll.all().map(rowToPolityEntry); }

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
    peoplePut,
    peopleGet,
    peopleAll,
    peopleByChunk,
    peopleDelete,
    peopleCount,
    structPut,
    structGet,
    structAll,
    structByBase,
    structByChunk,
    structDelete,
    basePut,
    baseGet,
    baseAll,
    baseByChunk,
    baseDelete,
    containerPut,
    containerGet,
    containerAll,
    containersByBase,
    containerDelete,
    metaGet,
    metaSet,
    econPut,
    econGet,
    econAll,
    polityPut,
    polityGet,
    polityAll,
    close,
  };
}

module.exports = { open, isAvailable, CHUNK_SIZE, MIGRATIONS, PEOPLE_CHUNK_M, chunkCoord };
