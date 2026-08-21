/* ============================================================
   net/survnet.js — THE SEAM A TRANSPORT PLUGS INTO.

   Natural Disaster Survival is a hundred players on an island, and it is
   single-player. This file does NOT make it multiplayer. It is the three
   things that have to be true BEFORE a transport is worth writing, made
   explicit and testable so the day someone opens a socket, the work is
   plumbing rather than a rewrite:

     1. EVERY ACTOR HAS A STABLE ID. A snapshot addresses bodies by number, so
        the numbers have to survive a frame, a death and a reset. Bots had no
        identity at all — they were an array, and their index was their name.
     2. THE MATCH IS ONE STRUCT. snapshot() writes the whole live match into a
        compact ArrayBuffer and apply() puts it back. That is the payload a
        server sends and a client eats, and it is testable TODAY without a
        network: snapshot, disturb the world, apply, compare fingerprints.
     3. THE MATCH IS DETERMINISTIC. Same seed + same tick sequence ⇒ same match
        on two machines. That is core/seed.js's law and it is measured by
        tools/determinism-check.mjs; this file's fingerprint() is what that
        tool compares.

   WHAT IS DELIBERATELY NOT HERE, and why. No socket, no lobby, no prediction,
   no interpolation, no remote-player actor, no protocol negotiation. Every one
   of those is a decision that depends on the transport (peer-to-peer vs
   authoritative server, lockstep vs snapshot), and writing them now would be
   guessing in public. What is here is what every one of those designs needs
   identically, and nothing else.

   THE FORMAT, once, because a wire format written twice is a bug:

     header  magic "NDS1" (u32) · version (u16) · flags (u16) · tick (u32)
             seed (u32) · elapsed (f32)
     round   disasterIdx (u8) · phase (u8: 0 idle 1 warn 2 active) ·
             timeLeft (f32) · intensity (f32) · surge (f32)
     player  x y z (f32) · yaw (f32) · hp (f32) · flags (u8)
     actors  count (u16), then per actor:
             id (u16) · x y z (f32) · yaw (f32) · hp (f32) ·
             flags (u8: 1 dead) · state (u8)

   100 bots is 2.5 KB — a size a 20 Hz server tick can carry without thinking
   about it. Positions are f32 because this world is 240 m across and a
   millimetre does not matter; the fingerprint quantises to a millimetre anyway
   so the codec cannot introduce a false divergence.

   Flags: CBZ.CONFIG.SURVNET_V1 = false makes the whole file inert.
   Audit: CBZ.survNet.audit().
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  CBZ.CONFIG = CBZ.CONFIG || {};
  if (CBZ.CONFIG.SURVNET_V1 == null) CBZ.CONFIG.SURVNET_V1 = true;
  if (CBZ.CONFIG.SURVNET_V1 === false) return;

  const MAGIC = 0x4e445331;              // "NDS1"
  const VERSION = 1;
  const HEAD = 4 + 2 + 2 + 4 + 4 + 4;    // magic, version, flags, tick, seed, elapsed
  const ROUND = 1 + 1 + 4 + 4 + 4;
  const PLAYER = 4 * 5 + 1;
  const ACTOR = 2 + 4 * 5 + 1 + 1;

  const STATES = ["wander", "move", "flee", "shelter", "climb", "dead"];
  const stateId = (s) => { const i = STATES.indexOf(s); return i < 0 ? 0 : i; };

  /* ---- 1. IDENTITY --------------------------------------------------------
     Assigned lazily and never reused inside a match, so a body that dies and a
     body that spawns can never be confused for each other by a peer that
     missed a snapshot. entities/survivorbot.js does not have to know: the ids
     are stamped on demand, here, which is also what makes this file removable
     in one line. */
  let nextId = 1;
  function idOf(a) {
    if (!a) return 0;
    if (!a._netId) a._netId = nextId++;
    return a._netId;
  }
  CBZ.survNetId = idOf;

  function actors() {
    const out = [];
    const b = CBZ.bots || [];
    for (let i = 0; i < b.length; i++) if (b[i]) out.push(b[i]);
    return out;
  }

  /* ---- round state, read through the director's public surface only ------- */
  const PHASE = { idle: 0, warn: 1, active: 2 };
  function round() {
    const D = CBZ.disasters;
    if (!D) return { idx: 0, phase: 0, t: 0, intensity: 0, surge: 0 };
    return {
      idx: Math.max(0, ROSTER.indexOf(D.currentId ? D.currentId() : null)) & 255,
      phase: PHASE[D.state()] || 0,
      t: D.timeLeft ? D.timeLeft() : 0,
      intensity: D.intensity ? D.intensity() : 0,
      surge: CBZ.waterSurge ? CBZ.waterSurge() : 0,
    };
  }
  const ROSTER = ["quake", "storm", "flashflood", "flood", "wildfire", "tornado",
    "hurricane", "blizzard", "meteor", "sinkhole", "volcano", "nuke"];

  /* ---- 2. THE MATCH AS ONE STRUCT ---------------------------------------- */
  function snapshot() {
    const list = actors();
    const buf = new ArrayBuffer(HEAD + ROUND + PLAYER + 2 + list.length * ACTOR);
    const v = new DataView(buf);
    let o = 0;
    v.setUint32(o, MAGIC); o += 4;
    v.setUint16(o, VERSION); o += 2;
    v.setUint16(o, 0); o += 2;                                   // flags, reserved
    v.setUint32(o, CBZ.survNetTick >>> 0); o += 4;
    v.setUint32(o, CBZ.WORLD_SEED >>> 0); o += 4;
    v.setFloat32(o, (CBZ.game && CBZ.game.elapsed) || 0); o += 4;

    const r = round();
    v.setUint8(o, r.idx); o += 1;
    v.setUint8(o, r.phase); o += 1;
    v.setFloat32(o, r.t); o += 4;
    v.setFloat32(o, r.intensity); o += 4;
    v.setFloat32(o, r.surge); o += 4;

    const p = CBZ.player, pc = CBZ.playerChar;
    v.setFloat32(o, p.pos.x); o += 4;
    v.setFloat32(o, p.pos.y); o += 4;
    v.setFloat32(o, p.pos.z); o += 4;
    v.setFloat32(o, pc && pc.group ? pc.group.rotation.y : 0); o += 4;
    v.setFloat32(o, p.hp); o += 4;
    v.setUint8(o, (p.dead ? 1 : 0) | (p.crouch ? 2 : 0) | (p.sprint ? 4 : 0)); o += 1;

    v.setUint16(o, list.length); o += 2;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      v.setUint16(o, idOf(a)); o += 2;
      v.setFloat32(o, a.pos.x); o += 4;
      v.setFloat32(o, a.pos.y); o += 4;
      v.setFloat32(o, a.pos.z); o += 4;
      v.setFloat32(o, a.group ? a.group.rotation.y : 0); o += 4;
      v.setFloat32(o, a.hp); o += 4;
      v.setUint8(o, a.dead ? 1 : 0); o += 1;
      v.setUint8(o, stateId(a.state)); o += 1;
    }
    return buf;
  }

  /* apply(buf) — put a snapshot back into this world.

     Bodies are matched BY ID, never by index: a peer that spawned its bots in
     a different order, or lost one, still lands every body on the right one.
     An id this client has never seen is skipped rather than guessed at —
     spawning is a decision for the transport, not for a codec. */
  function apply(buf) {
    const v = new DataView(buf);
    let o = 0;
    if (v.getUint32(o) !== MAGIC) throw new Error("survNet.apply: not a snapshot");
    o += 4;
    const version = v.getUint16(o); o += 2;
    if (version !== VERSION) throw new Error("survNet.apply: version " + version + ", expected " + VERSION);
    o += 2;                                                       // flags
    const tick = v.getUint32(o); o += 4;
    const seed = v.getUint32(o); o += 4;
    const elapsed = v.getFloat32(o); o += 4;

    const idx = v.getUint8(o); o += 1;
    const phase = v.getUint8(o); o += 1;
    const t = v.getFloat32(o); o += 4;
    const intensity = v.getFloat32(o); o += 4;
    const surge = v.getFloat32(o); o += 4;
    if (CBZ.waterSurgeSet) CBZ.waterSurgeSet(surge);

    const p = CBZ.player, pc = CBZ.playerChar;
    p.pos.x = v.getFloat32(o); o += 4;
    p.pos.y = v.getFloat32(o); o += 4;
    p.pos.z = v.getFloat32(o); o += 4;
    const pyaw = v.getFloat32(o); o += 4;
    if (pc && pc.group) { pc.group.position.copy(p.pos); pc.group.rotation.y = pyaw; }
    p.hp = v.getFloat32(o); o += 4;
    const pf = v.getUint8(o); o += 1;
    p.dead = !!(pf & 1);

    const byId = Object.create(null);
    const list = actors();
    for (let i = 0; i < list.length; i++) byId[idOf(list[i])] = list[i];

    const n = v.getUint16(o); o += 2;
    let landed = 0, unknown = 0;
    for (let i = 0; i < n; i++) {
      const id = v.getUint16(o); o += 2;
      const x = v.getFloat32(o); o += 4;
      const y = v.getFloat32(o); o += 4;
      const z = v.getFloat32(o); o += 4;
      const yaw = v.getFloat32(o); o += 4;
      const hp = v.getFloat32(o); o += 4;
      const fl = v.getUint8(o); o += 1;
      const st = v.getUint8(o); o += 1;
      const a = byId[id];
      if (!a) { unknown++; continue; }
      a.pos.set(x, y, z);
      if (a.group) { a.group.position.copy(a.pos); a.group.rotation.y = yaw; }
      a.hp = hp;
      a.dead = !!(fl & 1);
      a.state = STATES[st] || "wander";
      landed++;
    }
    return { tick, seed, elapsed, round: { idx: ROSTER[idx] || null, phase, t, intensity, surge }, landed, unknown };
  }

  /* ---- 3. THE FINGERPRINT -------------------------------------------------
     One number for "is this the same match?". Quantised to a millimetre so
     float dust and the f32 wire format cannot produce a false divergence, and
     ORDER-DEPENDENT on the actor id (not the array index) so two clients that
     spawned in a different order still agree. This is what
     tools/determinism-check.mjs compares between two browsers, and what a
     server would compare against a client's reported state. */
  function fingerprint() {
    let h = 2166136261 >>> 0;
    const mix = (val) => {
      const n = (Math.round((val || 0) * 1000) | 0) >>> 0;
      h = Math.imul(h ^ (n & 255), 16777619) >>> 0;
      h = Math.imul(h ^ ((n >>> 8) & 255), 16777619) >>> 0;
      h = Math.imul(h ^ ((n >>> 16) & 255), 16777619) >>> 0;
    };
    const p = CBZ.player;
    mix(p.pos.x); mix(p.pos.y); mix(p.pos.z); mix(p.hp); mix(p.dead ? 1 : 0);
    const list = actors().slice().sort((a, b) => idOf(a) - idOf(b));
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      mix(idOf(a)); mix(a.pos.x); mix(a.pos.y); mix(a.pos.z); mix(a.hp); mix(a.dead ? 1 : 0);
    }
    const r = round();
    mix(r.idx); mix(r.phase); mix(r.t); mix(r.intensity); mix(r.surge);
    return h >>> 0;
  }

  /* ---- the tick counter ---------------------------------------------------
     A snapshot without a tick number is unorderable, and the engine has no
     concept of one — core/loop.js measures TIME, which is the right thing for
     a single player and the wrong thing for a shared match. systems/fixedstep.js
     owns the real counter when it is loaded; this is the fallback so a
     snapshot is never stamped with nothing. */
  if (CBZ.survNetTick == null) CBZ.survNetTick = 0;
  if (CBZ.onAlways) {
    CBZ.onAlways(28.07, function () {
      if (CBZ.fixedStep) return;                    // the real counter is elsewhere
      if (CBZ.game && CBZ.game.state === "playing") CBZ.survNetTick++;
    });
  }

  CBZ.survNet = {
    VERSION, snapshot, apply, fingerprint, id: idOf,
    /* bytes(n) — what a snapshot of n actors costs on the wire. Here so a
       transport design argues with a number instead of a feeling. */
    bytes(n) { return HEAD + ROUND + PLAYER + 2 + (n | 0) * ACTOR; },
    audit() {
      const list = actors();
      return {
        version: VERSION, tick: CBZ.survNetTick,
        actors: list.length, ided: list.filter((a) => a._netId).length,
        snapshotBytes: HEAD + ROUND + PLAYER + 2 + list.length * ACTOR,
        atTwentyHzKbps: Math.round((HEAD + ROUND + PLAYER + 2 + list.length * ACTOR) * 20 * 8 / 1000),
        fingerprint: fingerprint(),
        fixedStep: !!CBZ.fixedStep,
      };
    },
  };
})();
