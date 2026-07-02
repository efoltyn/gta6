#!/usr/bin/env node
// Cell Block Z — multiplayer game server. Zero dependencies.
//
//   node server/server.js            -> hosts the game + relay on :8000
//
// One process does everything a small RP server needs:
//   - serves the game files (so your server URL IS the join link)
//   - WebSocket relay at /ws (player state, world snapshots, events, chat)
//   - sim-host election: first player in becomes the world simulator;
//     if they leave, the next-oldest player is promoted automatically
//   - server identity from server/server.json (name, motd, password, rules)
//   - /api/info for server browsers / directory listings
//
// Share it beyond your LAN with a quick tunnel (one command, free):
//   cloudflared tunnel --url http://localhost:8000
// then send the printed https link to your players.
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const wsmini = require("./wsmini");
const cbzdb = require("./db");

const ROOT = path.dirname(__dirname); // repo root
const CFG_PATH = process.env.CBZ_CONFIG || path.join(__dirname, "server.json");

const DEFAULT_CFG = {
  name: "Cell Block Z RP",
  motd: "Welcome. Stay in character. /help for commands.",
  tags: ["rp", "casual"],
  password: "",
  adminPass: "",
  maxPlayers: 16,
  port: 8000,
  // RP roles players pick at the door — edit freely (DarkRP-style data, not code)
  roles: [
    { id: "civ", label: "Civilian" },
    { id: "police", label: "Police" },
    { id: "ems", label: "Paramedic" },
    { id: "taxi", label: "Taxi Driver" },
    { id: "crook", label: "Crook" },
  ],
  // Optional: extra ICE servers for proximity voice (your own TURN server, etc.)
  // Default is a public STUN server; most home/NAT setups work with just that.
  iceServers: [],
  // Optional: URL of a directory server to announce to (see server/directory.js)
  directory: "",
  // Optional: the public URL players use to reach this server (for directory listings)
  publicUrl: "",
  // Persistent world: server/worlds/<name>.json IS the world (back it up, share it).
  // name "" = use the server name. autosaveSec = how often the host uploads the world.
  world: { name: "", autosaveSec: 120 },
};

function loadConfig() {
  let cfg = { ...DEFAULT_CFG };
  try {
    cfg = { ...cfg, ...JSON.parse(fs.readFileSync(CFG_PATH, "utf8")) };
  } catch (e) {
    fs.writeFileSync(CFG_PATH, JSON.stringify(DEFAULT_CFG, null, 2) + "\n");
    console.log(`[server] wrote default config -> ${CFG_PATH} (edit it, then restart)`);
  }
  const envPort = Number(process.env.PORT);
  if (envPort) cfg.port = envPort;
  return cfg;
}

const cfg = loadConfig();

// ----------------------------------------------------- robustness knobs ---
// Demo-day hardening for a small (2-6) friend group joining over a tunnel.
// All default ON (they degrade a flaky connection toward "today"); each is
// reversible via env if it ever misbehaves, with NO wire-protocol change.
//   CBZ_NO_HEARTBEAT=1         -> never reap on missed pongs (old behavior:
//                                 a half-open/zombie socket lingers until TCP
//                                 eventually times out — minutes over a tunnel)
//   CBZ_NO_RECONNECT_DEDUPE=1  -> don't drop a prior same-pid session on rejoin
const HEARTBEAT = process.env.CBZ_NO_HEARTBEAT !== "1";
const DEDUPE_RECONNECT = process.env.CBZ_NO_RECONNECT_DEDUPE !== "1";
// ping cadence + how long silence before a socket is considered dead. 15s pings
// sit well under typical proxy/tunnel idle timeouts (~60-100s); ~50s of no pong
// = ~3 missed pings before we reap, so a momentarily slow-but-alive client is
// never wrongly kicked mid-demo.
const HEARTBEAT_MS = Number(process.env.CBZ_HEARTBEAT_MS) || 15000;
const HEARTBEAT_DEAD_MS = Number(process.env.CBZ_HEARTBEAT_DEAD_MS) || 50000;

// S2: chunk-indexed spawn query cooldown, per socket — a client asking
// "who lives/works near chunk (cx,cz)" (message {t:"pquery",cx,cz,r}) more
// often than this just gets silently dropped (no error frame; the client's
// own next tick tries again). Cheap enough at normal spawn-query rates that
// this is a safety rail, not a real throttle.
const PQUERY_COOLDOWN_MS = Number(process.env.CBZ_PQUERY_COOLDOWN_MS) || 500;
const PQUERY_MAX_R = 20; // chunks (320m at 16m/chunk) — plenty for a spawn radius

// S3: chunk-indexed structure/base query, same shape/cooldown idiom as
// pquery above — {t:"bquery",cx,cz,r} -> pieces+bases near (cx,cz). No
// client this wave actually sends one (S4's server tick is the intended
// first consumer, per BUILD-PLAN.md S3/S4) — it's wired and tested now so
// S4 has a ready-made read path instead of retrofitting one later.
const BQUERY_COOLDOWN_MS = Number(process.env.CBZ_BQUERY_COOLDOWN_MS) || 500;
const BQUERY_MAX_R = 20;

// ----------------------------------------------------------------- world ---
// The world lives in server/worlds/<name>.sqlite (S1: node:sqlite, chunked
// blob storage — see server/db.js) — saved characters keyed by pid, turf,
// building damage. Ambient peds/traffic regenerate (never saved). The old
// server/worlds/<name>.json single-file store is kept as: (a) the automatic
// fallback when node:sqlite isn't available on this Node build, and (b) a
// one-time import source the FIRST time a SQLite DB boots empty next to an
// existing legacy file. Nothing here changes the wire protocol's shape —
// only where bytes land once they arrive.
const WORLD_DIR = (cfg.world && cfg.world.dir) ? path.resolve(cfg.world.dir) : path.join(__dirname, "worlds");
const worldName = (cfg.world && cfg.world.name) || cfg.name || "world";
const autosaveSec = (cfg.world && cfg.world.autosaveSec) || 120;
const sanitizeWorldName = (n) =>
  String(n || "").replace(/[^a-zA-Z0-9_\-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "world";
const WORLD_FILE = path.join(WORLD_DIR, sanitizeWorldName(worldName) + ".json");
const DB_FILE = path.join(WORLD_DIR, sanitizeWorldName(worldName) + ".sqlite");

// db is null when node:sqlite isn't available (older Node) — every read/
// write path below branches on it so the legacy file behavior is preserved
// byte-for-byte in that case.
let db = null;
try { db = cbzdb.open(DB_FILE); } catch (e) { console.error(`[server] SQLite open failed (${e.message}) — falling back to legacy JSON world file`); db = null; }

// S2/S3: advertised only when the relevant table actually exists to answer
// it — clients (and this codebase's OWN client, per BUILD-PLAN.md S2/S3)
// MAY use this to prefer a server-side chunk-indexed query over local-only
// data; a client that doesn't recognize "pquery"/"bquery" simply never
// sends one.
const FEAT = db ? ["to", "persist", "pquery", "bquery"] : ["to", "persist"];

// ---------------------------------------------------------------------
// S3 (BUILD-PLAN.md Stage S): structures/bases/containers extraction +
// reassembly helpers, following S2's extractPeopleFromWorld/
// assembleWorldForWire precedent for the OTHER two worldBlob riders
// src/net/netpersist.js already sends: `blob.bld` (src/systems/
// building.js's placed pieces) and `blob.base` (src/systems/
// baseclaim.js's BaseRecords + upkeep/decay ruins). Both riders already
// travel on the SAME "wsave" channel S2 hooked `npc` into — there is no
// separate bsave channel on the wire; "B8's bsave channel" is systems/
// basesave.js, a SINGLE-PLAYER bridge that stamps building.js's
// serialize() onto the local ledger (g.cityWorld) so single-player
// persistence keeps working untouched — the SERVER only ever sees
// `blob.bld`/`blob.base` inside a multiplayer wsave, exactly like
// `blob.npc`. Declared HERE (ahead of the world-load/first-boot-import
// code below, which calls buildStructureRows/buildBaseRows immediately at
// module-load time) rather than near their extract/assemble callers
// further down — a `const` referenced by top-level synchronous code
// before its own declaration line has run is a TDZ ReferenceError, not a
// hoisting no-op, so these have to sit above every caller that can fire
// during boot.
//
// PIECE IDENTITY: building.js hands out fresh, session-only "pc_"+seq ids
// (systems/pieces.js's pieceSeq resets every boot) — those never survive
// a save/reload and can't be a stable table key. Every placed piece DOES
// already have a genuinely stable identity, though: building.js's own
// occupancy key (occKey(gx,gy,gz,slot), building.js:292) — its own
// occupancy Map enforces at most one LIVE piece per key, forever, so it's
// already collision-free by construction. slotFor (building.js:304) is
// duplicated here in full (kind->slot is a 4-line, effectively-frozen
// mapping — B1's wood-tier catalog) rather than sharing code with a
// client-only file the server can't require().
const PIECE_CELL = 3;     // src/systems/building.js's own CELL (B.CELL) — mirrored, see file header
const PIECE_WALL_H = 2.5; // src/systems/building.js's own WALL_H (B.WALL_H) — mirrored, see file header
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
// coveringBase: mirrors src/systems/baseclaim.js's CBZ.baseAt exactly
// (nearest BaseRecord whose radius covers the point) — NOTE BaseRecord's
// own `cx`/`cz` fields are WORLD POSITION (piece.pos.x/z), not chunk
// coordinates, a naming quirk that file's own header now documents; this
// function reads them as the world position they actually are.
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
// buildStructureRows(pieces, basesArr) -> {structRows, containerRows} —
// pure transform from the wire shape to the two row-sets server/db.js's
// structPut/containerPut expect. Shared by both the first-boot import
// path below and extractStructuresFromWorld (further down) so there's one
// place that knows how a wire piece record becomes a row.
function buildStructureRows(pieces, basesArr) {
  const now = Date.now();
  const structRows = [], containerRows = [];
  for (const rec of pieces) {
    if (!rec || !rec.kind) continue;
    const slot = pieceSlot(rec.kind, rec.rot | 0);
    const pieceId = (rec.gx | 0) + "," + (rec.gy | 0) + "," + (rec.gz | 0) + "," + slot;
    const pos = pieceWorldPos(rec);
    const base = coveringBase(basesArr, pos.x, pos.z);
    structRows.push({
      pieceId, baseId: base ? base.id : null, kind: rec.kind,
      x: pos.x, y: pos.y, z: pos.z, rot: rec.rot | 0,
      hp: rec.hp != null ? rec.hp : 0,
      // material: no source field yet (building.js's B.serialize doesn't
      // carry piece.tier — see migration v3's own comment in server/db.js)
      // — B1-B8's catalog is wood tier only, so this is accurate today and
      // is where B5's future material tiers will land without a migration.
      material: "wood",
      data: rec, updatedAt: now,
    });
    if (rec.kind === "container") {
      containerRows.push({
        containerId: pieceId, pieceId, baseId: base ? base.id : null,
        inventory: rec.contents || {}, locked: !!rec.locked,
        code: null, // no keycode field exists client-side yet — forward-compat column, see migration v3
        updatedAt: now,
      });
    }
  }
  return { structRows, containerRows };
}
// buildBaseRows(bases, ruins) -> rows[] for basePut — a live BaseRecord and
// a ruins shadow record both become `bases` rows (ruin=1 for the latter);
// see migration v3's header for why ruins fold into this table instead of
// a 4th one.
function buildBaseRows(bases, ruins) {
  const now = Date.now();
  const rows = [];
  for (const rec of (bases || [])) {
    if (!rec || !rec.id) continue;
    rows.push({
      baseId: rec.id, ownerId: rec.ownerPid || null,
      x: rec.cx || 0, z: rec.cz || 0, // BaseRecord's own cx/cz ARE world position — see coveringBase's comment
      radius: rec.radius || 0, upkeepUntil: rec.upkeepUntil || 0, ruin: false,
      authorized: rec.authorized || [], data: rec, updatedAt: now,
    });
  }
  for (const rec of (ruins || [])) {
    if (!rec || !rec.id) continue;
    rows.push({
      baseId: rec.id, ownerId: null,
      x: rec.cx || 0, z: rec.cz || 0,
      radius: rec.radius || 0, upkeepUntil: 0, ruin: true, // always-overdue, decayTick's own rule
      authorized: [], data: { ruin: true, cx: rec.cx || 0, cz: rec.cz || 0, radius: rec.radius || 0 },
      updatedAt: now,
    });
  }
  return rows;
}

const world = { v: 1, name: worldName, savedAt: null, world: null, chars: {} };
let worldDirtyImportPending = false; // set below when a legacy file was just imported into a fresh DB

function loadLegacyFile() {
  try {
    const d = JSON.parse(fs.readFileSync(WORLD_FILE, "utf8"));
    if (d && d.v === 1) return d;
  } catch (e) { /* no save yet */ }
  return null;
}

if (db) {
  console.log(`[server] world "${worldName}" storage: SQLite (node:sqlite) <- ${DB_FILE}`);
  let worldBuf = null, charIds = [];
  try {
    worldBuf = db.blobGet("world", "world");
    charIds = db.blobList("char");
  } catch (e) { console.error(`[server] SQLite read failed: ${e.message}`); }

  if (worldBuf == null && charIds.length === 0) {
    // first boot against this DB: if a legacy blob-cap-era save exists,
    // import it once so nobody loses a world by upgrading the server.
    const legacy = loadLegacyFile();
    if (legacy) {
      world.world = legacy.world || null;
      world.chars = legacy.chars || {};
      world.savedAt = legacy.savedAt || null;
      console.log(`[server] first boot: imported legacy world file (${WORLD_FILE}, ${Object.keys(world.chars).length} characters) into SQLite`);
      worldDirtyImportPending = true; // written out below, once helpers exist
    }
  } else {
    try {
      if (worldBuf) {
        const parsed = JSON.parse(worldBuf.toString("utf8"));
        world.world = parsed && parsed.world !== undefined ? parsed.world : parsed;
        if (parsed && parsed.savedAt) world.savedAt = parsed.savedAt;
      }
    } catch (e) { console.error(`[server] world blob parse failed: ${e.message}`); }
    for (const pid of charIds) {
      try {
        const buf = db.blobGet("char", pid);
        if (buf) world.chars[pid] = JSON.parse(buf.toString("utf8"));
      } catch (e) { console.error(`[server] char blob "${pid}" parse failed: ${e.message}`); }
    }
    console.log(`[server] world "${worldName}" loaded <- SQLite (${Object.keys(world.chars).length} characters)`);
  }
} else {
  console.log(`[server] world "${worldName}" storage: legacy JSON file (node:sqlite unavailable)`);
  const legacy = loadLegacyFile();
  if (legacy) {
    world.world = legacy.world || null;
    world.chars = legacy.chars || {};
    world.savedAt = legacy.savedAt || null;
    console.log(`[server] world "${worldName}" loaded <- ${WORLD_FILE} (${Object.keys(world.chars).length} characters)`);
  }
}

// S2 (BUILD-PLAN.md Stage S): first-boot import of a legacy world blob that
// still carries the NPC ledger inline (`world.world.npc`, the pre-S2 shape
// — either loaded straight from SQLite's "world" blob above, or from the
// legacy-JSON-file fallback) — import it into the `people` table ONCE so no
// existing server loses its population by upgrading, then strip the rider
// from the in-memory/stored blob and mark it `peopleInDb:true` so every
// save from here on goes through extractPeopleFromWorld() below instead.
// Only runs when SQLite is actually available (people table requires it).
if (db && world.world && world.world.npc && Array.isArray(world.world.npc.ids) && !world.world.peopleInDb) {
  const importIds = world.world.npc.ids;
  try {
    const n = db.peoplePut(importIds);
    world.world = Object.assign({}, world.world, { peopleInDb: true });
    delete world.world.npc;
    console.log(`[server] first boot: imported ${n} ledger people (of ${importIds.length} in the blob) into the people table`);
    worldDirtyImportPending = true; // flushed below, once flush helpers exist
  } catch (e) { console.error(`[server] people-table first-boot import failed: ${e.message}`); }
}

// S3 (BUILD-PLAN.md Stage S): first-boot import of a legacy world blob that
// still carries player-building state inline (`world.world.bld.pieces`/
// `world.world.base.bases`/`.ruins`, the pre-S3 shape) — import it into the
// structures/bases/containers tables ONCE, then strip the arrays and mark
// `structuresInDb`/`basesInDb` so every save from here on goes through
// extractStructuresFromWorld()/extractBasesFromWorld() below instead.
// STRUCTURES import runs FIRST, while `world.world.base.bases` is still the
// raw array (buildStructureRows needs it to compute each piece's baseId —
// see that function's own comment) — BASES import runs second and strips it.
if (db && world.world && world.world.bld && Array.isArray(world.world.bld.pieces) && !world.world.structuresInDb) {
  try {
    const basesArr = (world.world.base && Array.isArray(world.world.base.bases)) ? world.world.base.bases : [];
    const { structRows, containerRows } = buildStructureRows(world.world.bld.pieces, basesArr);
    const n = db.structPut(structRows);
    const nc = containerRows.length ? db.containerPut(containerRows) : 0;
    world.world = Object.assign({}, world.world, { structuresInDb: true, bld: { v: world.world.bld.v || 1 } });
    console.log(`[server] first boot: imported ${n} structures (${nc} containers) into the structures table`);
    worldDirtyImportPending = true;
  } catch (e) { console.error(`[server] structures-table first-boot import failed: ${e.message}`); }
}
if (db && world.world && world.world.base && (Array.isArray(world.world.base.bases) || Array.isArray(world.world.base.ruins)) && !world.world.basesInDb) {
  try {
    const rows = buildBaseRows(world.world.base.bases, world.world.base.ruins);
    const n = db.basePut(rows);
    world.world = Object.assign({}, world.world, {
      basesInDb: true,
      base: { v: world.world.base.v || 1, playClock: world.world.base.playClock || 0 },
    });
    console.log(`[server] first boot: imported ${n} bases/ruins into the bases table`);
    worldDirtyImportPending = true;
  } catch (e) { console.error(`[server] bases-table first-boot import failed: ${e.message}`); }
}

// people-table extraction/reassembly (S2): the worldBlob's `npc` rider
// (net/netpersist.js worldBlob(), src/city/schedule.js's cityNpcLedger)
// is the ONLY thing that moves between the wire shape and this table —
// everything else in the blob (gangs/fracture/politics/econ/...) still
// rides in `world.world` completely untouched, exactly as S1 left it.
//
// extractPeopleFromWorld(w): called on every incoming wsave. If `w.npc`
// (the ledger rider, {v:1, ids:[...]}) is present, every entry is upserted
// into the people table (peoplePut is idempotent by sid — see db.js), and
// the STORED copy of the world blob has `npc` stripped and `peopleInDb`
// stamped true, so the table is the single source of truth for population
// going forward (the blob itself never re-accumulates it). If SQLite isn't
// available, this is a no-op and the ledger keeps riding inline exactly
// like it did before S2 — no behavior change without a people table.
function extractPeopleFromWorld(w) {
  if (!db || !w || !w.npc || !Array.isArray(w.npc.ids)) return w;
  try {
    db.peoplePut(w.npc.ids);
  } catch (e) {
    console.error(`[server] peoplePut failed (${e.message}) — keeping the ledger rider inline this save`);
    return w; // never silently drop people: on failure, leave npc in the stored blob
  }
  const stripped = Object.assign({}, w, { peopleInDb: true });
  delete stripped.npc;
  return stripped;
}

// assembleWorldForWire(w): called whenever `world.world` is about to be
// sent DOWN to a client (wload, on join). If the stored blob has people in
// the table (`peopleInDb`), reassemble a complete `npc` rider from the
// table's ALIVE rows so the client — old or new — receives a world blob
// that is shape-identical to what it always received (a full ledger rider
// living at `blob.npc`). The client stays completely protocol-compatible:
// it has no idea a table exists on the other end. Dead (alive=0) people
// never get reassembled onto the wire — they stay in the server's books
// (peopleAll with no filter still sees them) but are never resurrected
// into a client's live simulation.
function assembleWorldForWire(w) {
  if (!db || !w || !w.peopleInDb) return w;
  let ids = [];
  try { ids = db.peopleAll({ aliveOnly: true }).map((r) => r.data).filter(Boolean); }
  catch (e) { console.error(`[server] peopleAll failed: ${e.message}`); }
  return Object.assign({}, w, { npc: { v: 1, ids } });
}

// S3 (BUILD-PLAN.md Stage S): structures/bases/containers extraction +
// reassembly — the extract/assemble functions themselves (the pure row-
// building helpers they call are declared up near FEAT, see that block's
// own header comment for why).
//
// extractStructuresFromWorld(w): called on every incoming wsave, BEFORE
// extractBasesFromWorld (below) so `w.base.bases` is still the raw array
// buildStructureRows needs for baseId lookup. Each save's `w.bld.pieces`
// is building.js's own COMPLETE current set (B.serialize() re-walks
// CBZ.pieces fresh every call, not a delta) — so this function treats it
// as authoritative: anything in the table but NOT in this save's list is
// really gone (a demolished/decayed/collapsed piece), and is deleted —
// see migration v3's header for why that's different from `people`.
function extractStructuresFromWorld(w) {
  if (!db || !w || !w.bld || !Array.isArray(w.bld.pieces)) return w;
  const basesArr = (w.base && Array.isArray(w.base.bases)) ? w.base.bases : [];
  const { structRows, containerRows } = buildStructureRows(w.bld.pieces, basesArr);
  const keepIds = new Set(structRows.map((r) => r.pieceId));
  try {
    let existing = [];
    try { existing = db.structAll().map((r) => r.pieceId); } catch (e) { existing = []; }
    for (const id of existing) if (!keepIds.has(id)) db.structDelete(id); // real delete; cascades to its container row (FK)
    db.structPut(structRows);
    if (containerRows.length) db.containerPut(containerRows);
  } catch (e) {
    console.error(`[server] structure extraction failed (${e.message}) — keeping the bld rider inline this save`);
    return w; // never silently drop pieces: on failure, leave bld inline
  }
  return Object.assign({}, w, { structuresInDb: true, bld: { v: w.bld.v || 1 } });
}

// extractBasesFromWorld(w): called AFTER extractStructuresFromWorld above
// (so structures extraction still saw the raw bases array). Same
// authoritative-full-set-per-save treatment as structures: a dissolved
// BaseRecord (cupboard destroyed) or a fully-decayed ruin no longer in
// this save's arrays is deleted from the table.
function extractBasesFromWorld(w) {
  if (!db || !w || !w.base || (!Array.isArray(w.base.bases) && !Array.isArray(w.base.ruins))) return w;
  const rows = buildBaseRows(w.base.bases, w.base.ruins);
  const keepIds = new Set(rows.map((r) => r.baseId));
  try {
    let existing = [];
    try { existing = db.baseAll().map((r) => r.baseId); } catch (e) { existing = []; }
    for (const id of existing) if (!keepIds.has(id)) db.baseDelete(id);
    db.basePut(rows);
  } catch (e) {
    console.error(`[server] base extraction failed (${e.message}) — keeping the base rider inline this save`);
    return w;
  }
  return Object.assign({}, w, {
    basesInDb: true,
    base: { v: w.base.v || 1, playClock: w.base.playClock || 0 }, // B8's global play-clock: see the mapping note below
  });
}

// assembleStructuresForWire(w)/assembleBasesForWire(w): the reassembly
// half, called whenever `world.world` is about to be sent DOWN to a
// client (wload). Mirrors assembleWorldForWire above — a joining client,
// old or new, receives a world blob shape-identical to pre-S3, with zero
// idea a table exists on the other end.
function assembleStructuresForWire(w) {
  if (!db || !w || !w.structuresInDb) return w;
  let rows = [], containers = [];
  try { rows = db.structAll(); } catch (e) { console.error(`[server] structAll failed: ${e.message}`); }
  try { containers = db.containerAll(); } catch (e) { console.error(`[server] containerAll failed: ${e.message}`); }
  const contByPiece = new Map(containers.map((c) => [c.pieceId, c]));
  const pieces = rows.map((r) => {
    const rec = Object.assign({}, r.data);
    // The containers table is the live source of truth for contents/locked
    // (a future S4 server-side mutation to JUST that table — a loot
    // rebalance, a raid draining a box — must be visible here without
    // touching `structures.data`), so it wins over whatever's baked into
    // the structure row's own stored `data.contents`/`data.locked`.
    if (r.kind === "container") {
      const c = contByPiece.get(r.pieceId);
      if (c) { rec.contents = c.inventory; rec.locked = !!c.locked; }
    }
    return rec;
  });
  return Object.assign({}, w, { bld: { v: 1, pieces } });
}
function assembleBasesForWire(w) {
  if (!db || !w || !w.basesInDb) return w;
  let rows = [];
  try { rows = db.baseAll(); } catch (e) { console.error(`[server] baseAll failed: ${e.message}`); }
  const bases = [], ruinsOut = [];
  for (const r of rows) {
    if (r.ruin) ruinsOut.push({ id: r.baseId, cx: r.x, cz: r.z, radius: r.radius });
    else bases.push(Object.assign({}, r.data));
  }
  const playClock = (w.base && w.base.playClock) || 0;
  return Object.assign({}, w, { base: { v: 1, bases, ruins: ruinsOut, playClock } });
}
// B8 DECAY-SEAM FIELD MAPPING (S4's future server tick reads these — this
// wave only carries the data, per BUILD-PLAN.md S3's own scope: "don't
// implement the tick"):
//   BaseRecord.upkeepUntil  -> bases.upkeepUntil column (per-base decay
//     clock; a server tick can `SELECT * FROM bases WHERE upkeepUntil <
//     <play-clock-equivalent>` directly, no JSON parse needed).
//   BaseRecord.authorized[] -> bases.auth column (JSON) + rowToBaseEntry's
//     `.authorized` field.
//   ruins (position/radius only, always-overdue) -> bases rows with
//     ruin=1, upkeepUntil=0 (decayTick's own "ruins always overdue" rule,
//     baseclaim.js's B8 section — pre-computed here rather than re-derived
//     by every future reader).
//   playClock (global, NOT per-base — src/systems/baseclaim.js's
//     ACCUMULATED PLAY TIME accumulator) has no per-base column to live in
//     — it rides in the un-extracted remainder of `w.base` (`{v,
//     playClock}`, same "remaining channel data" treatment S2 gave
//     whatever isn't the `npc` rider). S4's tick, running server-side with
//     no client connected, will need its OWN clock source (this global
//     accumulator is fundamentally single-player-derived, measured in
//     CBZ.game.elapsed deltas) — left as that stage's problem; the
//     upkeepUntil COLUMN is what actually lets a tick decide "is this base
//     overdue" without a client in the loop, which is the seam this step
//     is scoped to build.

// ev subtypes the server consumes (or emits) itself — never relayed between clients
const RESERVED_EV = { to: 1, wsave: 1, csave: 1, wload: 1, cload: 1 };

let worldDirty = false, lastFlush = 0, flushTimer = null;

function flushWorldSqlite() {
  const prevStamp = world.savedAt;
  world.savedAt = Date.now();
  try {
    // Each blob is its own chunked row-set, written in its own transaction
    // (server/db.js blobPut) — this is exactly the "no single blob is
    // capped by transport or a single-row size" property S1 exists for.
    // A 3MB+ world blob (gangs/npc ledger/politics/econ/etc riders) round-
    // trips the same way a 3KB one does; see server/db.js's header.
    db.blobPut("world", "world", Buffer.from(JSON.stringify({ savedAt: world.savedAt, world: world.world || null })));
    for (const pid in world.chars) {
      db.blobPut("char", pid, Buffer.from(JSON.stringify(world.chars[pid])));
    }
    worldDirty = false;
  } catch (e) { world.savedAt = prevStamp; console.error(`[server] SQLite world save failed: ${e.message}`); } // stays dirty -> retried on the next save
}
function flushWorldLegacy() {
  const prevStamp = world.savedAt;
  world.savedAt = Date.now();
  try {
    fs.mkdirSync(WORLD_DIR, { recursive: true });
    const tmp = WORLD_FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(world));
    fs.renameSync(tmp, WORLD_FILE); // atomic: never a half-written world
    worldDirty = false;
  } catch (e) { world.savedAt = prevStamp; console.error(`[server] world save failed: ${e.message}`); } // stays dirty -> retried on the next save
}
function flushWorld() {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  if (!worldDirty) return;
  lastFlush = Date.now();
  if (db) flushWorldSqlite(); else flushWorldLegacy();
}
function queueFlush() { // disk writes >=5s apart
  worldDirty = true;
  const wait = 5000 - (Date.now() - lastFlush);
  if (wait <= 0) return flushWorld();
  if (!flushTimer) flushTimer = setTimeout(flushWorld, wait);
}
if (worldDirtyImportPending) queueFlush(); // persist the freshly-imported legacy save into the new DB right away
function shutdown() { flushWorld(); if (db) db.close(); process.exit(0); }
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// ---------------------------------------------------------------- static ---
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".svg": "image/svg+xml", ".ico": "image/x-icon",
  ".m4a": "audio/mp4", ".ogg": "audio/ogg", ".mp3": "audio/mpeg",
  ".wav": "audio/wav", ".glb": "model/gltf-binary", ".gltf": "model/gltf+json",
  ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf",
};

function serveStatic(req, res) {
  let urlPath;
  try {
    urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
  } catch (e) {
    res.writeHead(400); res.end("bad url"); return;
  }
  if (urlPath === "/") urlPath = "/index.html";
  const file = path.normalize(path.join(ROOT, urlPath));
  if (!file.startsWith(ROOT + path.sep)) { res.writeHead(403); res.end(); return; }
  // never serve server config (it holds passwords)
  if (file.startsWith(path.join(ROOT, "server") + path.sep) && file.endsWith(".json")) {
    res.writeHead(403); res.end(); return;
  }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end("not found"); return; }
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream",
      "Content-Length": data.length,
      "Cache-Control": "no-store, must-revalidate",
    });
    res.end(data);
  });
}

// ------------------------------------------------------------------ room ---
let nextId = 1;
const players = new Map(); // id -> {id, name, conn, admin, joinedAt}
let hostId = null;

const sanitizeName = (n) =>
  String(n || "").replace(/[^\w \-'.]/g, "").trim().slice(0, 20) || "Stranger";

function info() {
  return {
    game: "cell-block-z",
    name: cfg.name,
    motd: cfg.motd,
    tags: cfg.tags,
    roles: cfg.roles,
    players: players.size,
    maxPlayers: cfg.maxPlayers,
    passworded: !!cfg.password,
    version: 1,
    feat: FEAT,
    world: { name: worldName, savedAt: world.savedAt, autosaveSec },
  };
}

// BACKPRESSURE (CBZ_NO_BACKPRESSURE=1 to disable; CBZ_BP_LIMIT overrides bytes).
// The relay forwards the host's world/state snapshots to every guest; a slow
// guest's outbound write buffer would grow unbounded and the socket dies at
// multi-MB → that guest desyncs. We instead DROP high-frequency IDEMPOTENT
// snapshots to a guest whose write buffer is already deep (the next snapshot
// supersedes a dropped one). Reliable traffic (join/leave/ev/chat/host/deny/…)
// is NEVER dropped. Inert under normal load (writableLength stays ~0).
const NET_BP = process.env.CBZ_NO_BACKPRESSURE !== "1";
const BP_LIMIT = process.env.CBZ_BP_LIMIT != null ? Number(process.env.CBZ_BP_LIMIT) : 512 * 1024;
let bpDropped = 0;
function connBuffered(p) {
  const s = p.conn && p.conn.socket;          // wsmini WSConn wraps a node net.Socket
  return s && typeof s.writableLength === "number" ? s.writableLength : 0;
}
function bpShedable(msg) {
  if (msg.t === "world" || msg.t === "state") return true;            // a raw snapshot
  return msg.t === "ev" && msg.e === "to" && msg.d &&                 // a "to"-wrapped per-guest snapshot
    (msg.d.t === "world" || msg.d.t === "state");
}

function send(p, msg) {
  if (NET_BP && bpShedable(msg) && connBuffered(p) > BP_LIMIT) { bpDropped++; return; }
  p.conn.send(JSON.stringify(msg));
}

function broadcast(msg, exceptId) {
  const str = JSON.stringify(msg);
  const shed = NET_BP && bpShedable(msg);
  for (const p of players.values()) {
    if (p.id === exceptId) continue;
    if (shed && connBuffered(p) > BP_LIMIT) { bpDropped++; continue; }
    p.conn.send(str);
  }
}

function pickHost() {
  let oldest = null;
  for (const p of players.values()) if (!oldest || p.joinedAt < oldest.joinedAt) oldest = p;
  return oldest ? oldest.id : null;
}

function setHost(id) {
  if (hostId === id) return;
  hostId = id;
  if (id != null) {
    const h = players.get(id);
    console.log(`[server] sim host -> #${id} ${h ? h.name : "?"}`);
    broadcast({ t: "host", id });
  }
}

function onLeave(p, reason) {
  if (!players.has(p.id)) return;
  players.delete(p.id);
  console.log(`[server] leave #${p.id} ${p.name}${reason ? " (" + reason + ")" : ""} (${players.size} online)`);
  broadcast({ t: "leave", id: p.id });
  if (hostId === p.id) setHost(pickHost());
  if (players.size === 0) flushWorld(); // nobody simulating: the file is the world now
}

// --------------------------------------------------------------- commands ---
function handleChat(p, text) {
  text = String(text || "").slice(0, 300).trim();
  if (!text) return;
  if (text[0] === "/") return handleCommand(p, text);
  broadcast({ t: "chat", id: p.id, name: p.name, kind: "say", text });
}

function handleCommand(p, text) {
  const [cmd, ...rest] = text.slice(1).split(" ");
  const arg = rest.join(" ").trim();
  switch (cmd.toLowerCase()) {
    case "me": // emote: "* Dex lights a cigarette"
      if (arg) broadcast({ t: "chat", id: p.id, name: p.name, kind: "me", text: arg });
      break;
    case "do": // scene description: "** The door is locked (Dex)"
      if (arg) broadcast({ t: "chat", id: p.id, name: p.name, kind: "do", text: arg });
      break;
    case "ooc": // out of character
      if (arg) broadcast({ t: "chat", id: p.id, name: p.name, kind: "ooc", text: arg });
      break;
    case "help":
      send(p, { t: "sys", text: "/me <action>, /do <scene>, /ooc <text>, /players" + (p.admin ? ", /kick <name>, /announce <text>" : cfg.adminPass ? ", /admin <pass>" : "") });
      break;
    case "players": {
      const list = [...players.values()].map((q) => q.name + (q.id === hostId ? " (host)" : "")).join(", ");
      send(p, { t: "sys", text: `${players.size}/${cfg.maxPlayers}: ${list}` });
      break;
    }
    case "admin":
      if (cfg.adminPass && arg === cfg.adminPass) {
        p.admin = true;
        send(p, { t: "sys", text: "You are now an admin." });
      } else send(p, { t: "sys", text: "Nope." });
      break;
    case "kick": {
      if (!p.admin) return send(p, { t: "sys", text: "Admins only." });
      const target = [...players.values()].find((q) => q.name.toLowerCase() === arg.toLowerCase());
      if (!target) return send(p, { t: "sys", text: `No player named "${arg}".` });
      if (target.id === p.id) return send(p, { t: "sys", text: "That's you." });
      send(target, { t: "deny", reason: "Kicked by admin." });
      target.conn.close();
      onLeave(target, "kicked");
      break;
    }
    case "announce":
      if (!p.admin) return send(p, { t: "sys", text: "Admins only." });
      if (arg) broadcast({ t: "sys", text: `[SERVER] ${arg}` });
      break;
    default:
      send(p, { t: "sys", text: `Unknown command /${cmd}. Try /help.` });
  }
}

// --------------------------------------------------------------- protocol ---
function onConnection(conn, req) {
  let p = null; // set after hello
  let saidHello = false;
  // seed liveness so the heartbeat reaper gives a fresh socket a full grace
  // window before its first pong (wsmini stamps conn.lastPong on every pong)
  conn.lastPong = Date.now();

  conn.onmessage = (str) => {
    let m;
    try { m = JSON.parse(str); } catch (e) { return; }
    if (!m || typeof m.t !== "string") return;

    if (!saidHello) {
      if (m.t !== "hello") { conn.close(); return; }
      saidHello = true;
      if (cfg.password && m.pass !== cfg.password) {
        conn.send(JSON.stringify({ t: "deny", reason: "Wrong password." }));
        conn.close();
        return;
      }
      if (players.size >= cfg.maxPlayers) {
        conn.send(JSON.stringify({ t: "deny", reason: "Server is full." }));
        conn.close();
        return;
      }
      const role = (cfg.roles || []).some((r) => r.id === m.role) ? m.role : ((cfg.roles && cfg.roles[0] && cfg.roles[0].id) || "civ");
      const pid = (typeof m.pid === "string" && m.pid) ? m.pid.slice(0, 64) : null;
      // RECONNECT / stale-socket cleanup: a friend whose tunnel blipped (or who
      // refreshed the tab) comes back with the SAME stable pid (netpersist.js)
      // before the old TCP socket has finished dying — over a tunnel that lag
      // can run minutes. Without this the old session lingers as a ghost (a
      // phantom avatar the host keeps syncing, and the name picks up a "_").
      // Drop the prior session for this pid first, so the reconnect is clean and
      // — crucially — if that ghost was the SIM HOST, migration runs now instead
      // of the world staying frozen behind a dead host. Reuses the normal
      // leave/host-migration path; no wire change. Off with CBZ_NO_RECONNECT_DEDUPE=1.
      if (DEDUPE_RECONNECT && pid) {
        for (const q of [...players.values()]) {
          if (q.pid !== pid || q.conn === conn) continue;
          console.log(`[server] reconnect: dropping stale session #${q.id} ${q.name} (pid match)`);
          try { q.conn.close(); } catch (e) {}
          onLeave(q, "reconnect");
        }
      }
      let name = sanitizeName(m.name);
      while ([...players.values()].some((q) => q.name === name)) name += "_";
      p = { id: nextId++, name, role, pid, conn, admin: false, joinedAt: Date.now() };
      players.set(p.id, p);
      // first player into an empty room becomes the world simulator
      const firstIn = hostId == null;
      if (firstIn) hostId = p.id;
      const worldInfo = { name: worldName, savedAt: world.savedAt, autosaveSec };
      send(p, {
        t: "welcome",
        id: p.id,
        hostId,
        feat: FEAT,
        world: worldInfo,
        server: { name: cfg.name, motd: cfg.motd, tags: cfg.tags, maxPlayers: cfg.maxPlayers, iceServers: cfg.iceServers || [], feat: FEAT, world: worldInfo },
        players: [...players.values()].filter((q) => q.id !== p.id).map((q) => ({ id: q.id, name: q.name, role: q.role })),
      });
      // the host is an admin on their own server
      if (p.id === hostId) p.admin = true;
      broadcast({ t: "join", id: p.id, name: p.name, role: p.role }, p.id);
      console.log(`[server] join #${p.id} ${p.name} (${players.size} online)`);
      // resume: an empty room's new simulator gets the saved world; a saved
      // character follows its pid anywhere. Mid-session host migrations never
      // reload from disk — the live sim stays authoritative.
      // S2/S3: reassemble the ledger/structure/base riders from their
      // tables (each a no-op, byte-identical to pre-S2/S3 behavior, if its
      // own …InDb flag was never stamped).
      if (firstIn && world.world) {
        let wire = assembleWorldForWire(world.world);
        wire = assembleBasesForWire(wire);
        wire = assembleStructuresForWire(wire);
        send(p, { t: "ev", e: "wload", world: wire });
      }
      if (p.pid && world.chars[p.pid]) send(p, { t: "ev", e: "cload", char: world.chars[p.pid] });
      return;
    }
    if (!p) return;

    switch (m.t) {
      case "state": // own avatar state, high-frequency -> relay to everyone else
        m.id = p.id;
        broadcast(m, p.id);
        break;
      case "world": // NPC/world snapshot -> only the sim host may publish
        if (p.id === hostId) broadcast(m, p.id);
        break;
      case "ev": // reliable game events (shots, damage, enter/exit vehicle...)
        if (m.e === "to") { // point-to-point relay: deliver d to one client, stamped as the sender
          const tgt = players.get(m.id), d = m.d;
          // only game payloads pass: evs (minus the persistence verbs) from anyone,
          // world rows from the sim host — never core protocol frames (welcome/host/deny...)
          const okT = d && typeof d === "object" &&
            (d.t === "ev" ? !RESERVED_EV[d.e] : (d.t === "world" && p.id === hostId));
          if (tgt && okT) { d.id = p.id; send(tgt, d); }
          break;
        }
        if (m.e === "wsave") { // only the sim host writes the world
          if (p.id === hostId && m.world && typeof m.world === "object") {
            // S2/S3: extract the ledger/structure/base riders into their
            // tables before storing — structures BEFORE bases (structure
            // extraction needs the raw bases array for baseId lookup; see
            // extractStructuresFromWorld's own comment). No-op fallthrough
            // (unstripped blob) for any of the three when SQLite is absent.
            let w = extractPeopleFromWorld(m.world);
            w = extractStructuresFromWorld(w);
            w = extractBasesFromWorld(w);
            world.world = w;
            queueFlush();
          }
          break;
        }
        if (m.e === "csave") { // per-character save keyed by the player's pid
          if (p.pid && m.char && typeof m.char === "object" && JSON.stringify(m.char).length <= 64 * 1024) {
            if (!world.chars[p.pid]) { // roster cap: oldest insertion drops first
              const keys = Object.keys(world.chars);
              if (keys.length >= 256) delete world.chars[keys[0]];
            }
            world.chars[p.pid] = m.char; queueFlush();
          }
          break;
        }
        if (m.e === "wload" || m.e === "cload") break; // server->client only, never relayed
        m.id = p.id;
        if (m.to != null) {
          const target = players.get(m.to);
          if (target) send(target, m);
        } else broadcast(m, p.id);
        break;
      case "chat":
        handleChat(p, m.text);
        break;
      // S2: chunk-indexed spawn query — {t:"pquery", cx, cz, r} -> everyone
      // whose home anchor falls within r chunks of (cx,cz), stripped down to
      // spawn-relevant fields (sid/name/x/z/cash/alive — never the full
      // `data` JSON; a client has no business seeing another person's whole
      // ledger page over the wire). Answerable by ANY player, not just the
      // host — it's a read-only query against server storage, not sim state.
      // Rate-limited per socket (see PQUERY_COOLDOWN_MS); over-limit requests
      // are just dropped, no error frame (the client's own next tick retries).
      case "pquery": {
        if (!db) { send(p, { t: "presult", cx: m.cx | 0, cz: m.cz | 0, people: [] }); break; }
        const now = Date.now();
        if (p._pqCooldown && now < p._pqCooldown) break;
        p._pqCooldown = now + PQUERY_COOLDOWN_MS;
        const cx = m.cx | 0, cz = m.cz | 0;
        const r = Math.max(0, Math.min(PQUERY_MAX_R, m.r | 0 || 3));
        let rows = [];
        try { rows = db.peopleByChunk(cx, cz, r); } catch (e) { console.error(`[server] peopleByChunk failed: ${e.message}`); }
        const people = rows.map((row) => ({ sid: row.sid, name: row.name, x: row.x, z: row.z, cash: row.cash, alive: row.alive }));
        send(p, { t: "presult", cx, cz, people });
        break;
      }
      // S3: chunk-indexed structure/base query — {t:"bquery", cx, cz, r} ->
      // every piece/base within r chunks of (cx,cz), stripped to light
      // fields (never the full `data` JSON — same "no full row over the
      // wire" convention as pquery/presult above). SERVER-ONLY consumer
      // for now (no client sends this yet — it's the read path S4's
      // server-side tick is expected to use); answerable by any player,
      // same rate-limit idiom as pquery.
      case "bquery": {
        if (!db) { send(p, { t: "bresult", cx: m.cx | 0, cz: m.cz | 0, structures: [], bases: [] }); break; }
        const now2 = Date.now();
        if (p._bqCooldown && now2 < p._bqCooldown) break;
        p._bqCooldown = now2 + BQUERY_COOLDOWN_MS;
        const bcx = m.cx | 0, bcz = m.cz | 0;
        // NOTE: `m.r | 0 || 3` (pquery's own existing idiom above) would
        // silently treat an explicit r:0 as "unset" (0 is falsy) and widen
        // it to 3 — kept correct here instead: only fall back to 3 when r
        // truly wasn't sent.
        const br = Math.max(0, Math.min(BQUERY_MAX_R, m.r != null ? (m.r | 0) : 3));
        let structRows = [], baseRows = [];
        try { structRows = db.structByChunk(bcx, bcz, br); } catch (e) { console.error(`[server] structByChunk failed: ${e.message}`); }
        try { baseRows = db.baseByChunk(bcx, bcz, br); } catch (e) { console.error(`[server] baseByChunk failed: ${e.message}`); }
        const structures = structRows.map((row) => ({ pieceId: row.pieceId, kind: row.kind, x: row.x, y: row.y, z: row.z, hp: row.hp, baseId: row.baseId }));
        const bases = baseRows.map((row) => ({ baseId: row.baseId, ownerId: row.ownerId, x: row.x, z: row.z, radius: row.radius, ruin: row.ruin }));
        send(p, { t: "bresult", cx: bcx, cz: bcz, structures, bases });
        break;
      }
    }
  };

  conn.onclose = () => { if (p) onLeave(p); };
}

// ------------------------------------------------------------------- boot ---
const server = http.createServer((req, res) => {
  const urlPath = (req.url || "/").split("?")[0];
  if (urlPath === "/api/info") {
    const body = JSON.stringify(info());
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store",
    });
    res.end(body);
    return;
  }
  serveStatic(req, res);
});

wsmini.attach(server, "/ws", onConnection);

// keep connections honest — and reap the dead. wsmini already records
// conn.lastPong on every pong; here we finally READ it. A socket that has
// stopped ponging for HEARTBEAT_DEAD_MS is half-open (tunnel/NAT/Wi-Fi drop
// that never sent a TCP FIN) — we close + onLeave it on the SERVER's clock
// instead of waiting minutes for the OS to notice. This is the single most
// important demo fix: if a ZOMBIE socket is the sim host, the world is frozen
// for everyone until migration; onLeave(pickHost) re-elects a live host now.
// With CBZ_NO_HEARTBEAT=1 it falls back to the old ping-only behavior exactly.
setInterval(() => {
  const now = Date.now();
  for (const p of [...players.values()]) {
    if (HEARTBEAT && p.conn.lastPong && (now - p.conn.lastPong) > HEARTBEAT_DEAD_MS) {
      console.log(`[server] heartbeat: reaping #${p.id} ${p.name} (no pong ${Math.round((now - p.conn.lastPong) / 1000)}s)`);
      try { p.conn.close(); } catch (e) {}
      onLeave(p, "timeout"); // same path as a clean disconnect: re-elects host, broadcasts leave
      continue;
    }
    try { p.conn.ping(); } catch (e) {}
  }
}, HEARTBEAT ? HEARTBEAT_MS : 20000);

// optional directory announce
if (cfg.directory) {
  const announce = () => {
    const body = JSON.stringify({ ...info(), url: cfg.publicUrl || "" });
    try {
      const u = new URL("/announce", cfg.directory);
      const mod = u.protocol === "https:" ? require("https") : require("http");
      const req2 = mod.request(u, { method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } });
      req2.on("error", () => {});
      req2.end(body);
    } catch (e) { /* bad directory URL; ignore */ }
  };
  setInterval(announce, 60000);
  announce();
}

server.listen(cfg.port, () => {
  console.log("");
  console.log(`  ${cfg.name}`);
  console.log(`  ─ play/join link:  http://localhost:${cfg.port}`);
  console.log(`  ─ websocket:       ws://localhost:${cfg.port}/ws`);
  console.log(`  ─ server info:     http://localhost:${cfg.port}/api/info`);
  console.log(`  ─ config:          server/server.json  (name, motd, password, maxPlayers)`);
  console.log(`  ─ world save:      ${path.relative(ROOT, db ? DB_FILE : WORLD_FILE)}  (autosave ${autosaveSec}s${world.savedAt ? ", loaded" : ", new"}${db ? ", SQLite" : ", legacy JSON"})`);
  console.log("");
  console.log(`  To let friends join over the internet:`);
  console.log(`    cloudflared tunnel --url http://localhost:${cfg.port}`);
  console.log(`  ...then share the https link it prints. That link is your server.`);
  console.log("");
});
