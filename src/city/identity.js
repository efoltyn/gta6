/* ============================================================
   city/identity.js — the PERMANENT-DEATH REGISTRY. The owner's #1 ask this
   session: killing a named racer/gang leader/VIP/tycoon/company owner must
   STICK — not a respawned template wearing the same name tag, an actual
   individual whose death is permanent city history.

   Modeled directly on the two proven identity patterns already in this repo
   so it's a third leg of the same stool, not a new shape:
     • schedule.js's CBZ.cityNpcLedger — the offline-A-Life ledger for
       ORDINARY peds (ped._sid keys a plain JSON-able page; serialize()/
       apply() feed world persistence). This file is that same idea one
       level up: NAMED, ONE-OF-A-KIND identities (racers, gang bosses, VIPs,
       tycoons, company owners) instead of the rank-and-file crowd.
     • gangs.js's succeedBoss — proof that "kill the leader, a successor
       rises" already works for ONE domain (gangs). CBZ.cityIdentities
       generalizes the DEATH SIDE of that (permanent status + a death
       callback) so racing.js/vips.js/companies.js can each wire their own
       succeedBoss-shaped reaction without this file knowing any of their
       internals — see onDeathRegister below.

   PURE REGISTRY + CALLBACK DISPATCH. This file knows NOTHING about racing,
   gangs, VIPs or companies — exactly like cityNpcLedger knows nothing about
   vendors/dealers/gangsters, just the shape of an entry. Each consumer
   system calls register() to mint an identity, stamps the returned id onto
   its own object (gang.bossIdentityId, ped._identityId, etc. — THEIR job),
   and calls markDead() the moment that individual is confirmed dead. A
   system that cares what happens next (promote a successor, retire a
   storyline, mark a business for sale) calls onDeathRegister(kind, cb) once
   at load time; this file just dispatches, it never decides policy.

   PERSISTENCE: serialize()/apply() follow cityNpcLedger's exact contract
   shape (a versioned envelope wrapping a flat array) so the two existing
   persistence paths can wire it in with one line each, same as the NPC
   ledger:
     • src/net/netpersist.js  — host-autosave / multiplayer worldBlob/applyWorld
     • src/city/worldstate.js — singleplayer CBZ_CITY_WORLD_V2 localStorage record
   Dead records persist too (history must outlive a reload — a successor's
   claim and a corpse's name both have to survive a restart).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;

  function now() { return Date.now ? Date.now() : 0; }

  let reg = {};            // id -> record (plain JSON-able objects only, like schedule.js's `led`)
  let seq = 1;              // mirrors schedule.js's `seq` -> "p"+seq sid minting
  const deathCbs = {};      // kind -> [callback, ...], dispatched from markDead

  // ---- mint a fresh identity. extra is shallow-merged onto the record so
  //      callers can stash kind-specific fields (e.g. {gangId, archetype})
  //      without this file needing to know what they mean. ----
  function register(kind, name, extra) {
    const id = "id" + (seq++);
    const rec = {
      id, kind: kind || "npc", name: name || "Unknown",
      status: "alive",
      successorId: null,
      killedBy: null,
      killedAt: null,
      history: [],
    };
    if (extra) for (const k in extra) if (k !== "id" && k !== "history") rec[k] = extra[k];
    reg[id] = rec;
    return rec;
  }

  // ---- mark an identity permanently dead. Idempotent (a double-kill report
  //      — e.g. explosion + bleed-out both firing — never double-fires the
  //      death callback or stomps the original killedBy/killedAt). ----
  function markDead(id, opts) {
    const rec = reg[id];
    if (!rec || rec.status === "dead") return rec || null;
    opts = opts || {};
    rec.status = "dead";
    rec.killedAt = opts.at != null ? opts.at : now();
    rec.killedBy = opts.killedBy != null ? opts.killedBy : null;
    rec.history.push({ t: "death", at: rec.killedAt, by: rec.killedBy });
    const cbs = deathCbs[rec.kind];
    if (cbs) for (let i = 0; i < cbs.length; i++) {
      try { cbs[i](rec); } catch (e) { console.error("[cityIdentities] onDeath cb for kind " + rec.kind + " threw", e); }
    }
    return rec;
  }

  // ---- successor handoff bookkeeping — a consumer's death callback calls
  //      this once it has picked WHO inherits (its own policy, e.g. the
  //      gangs.js bench-rank sort); this file just records the fact and logs
  //      it onto the dead identity's history so the lineage is queryable. ----
  function setSuccessor(id, successorId) {
    const rec = reg[id];
    if (!rec) return;
    rec.successorId = successorId || null;
    rec.history.push({ t: "succession", at: now(), to: rec.successorId });
  }

  // ---- per-kind death-reaction hooks. Multiple systems may share a kind
  //      (unlikely but harmless) — all registered callbacks run. ----
  function onDeathRegister(kind, cb) {
    if (!kind || typeof cb !== "function") return;
    (deathCbs[kind] || (deathCbs[kind] = [])).push(cb);
  }

  function get(id) { return reg[id] || null; }
  function all() {
    const out = [];
    for (const id in reg) out.push(reg[id]);
    return out;
  }
  function byKind(kind) {
    const out = [];
    for (const id in reg) if (reg[id].kind === kind) out.push(reg[id]);
    return out;
  }

  // ============================================================
  //  world persistence surface — same envelope shape as cityNpcLedger:
  //  { v: 1, list: [...] }. Consumed by net/netpersist.js (host autosave /
  //  multiplayer) AND city/worldstate.js (singleplayer localStorage),
  //  both feature-detected so this module stays a leaf dependency.
  // ============================================================
  CBZ.cityIdentities = {
    register: register,
    markDead: markDead,
    setSuccessor: setSuccessor,
    onDeathRegister: onDeathRegister,
    get: get,
    all: all,
    byKind: byKind,
    serialize: function () {
      const list = [];
      for (const id in reg) list.push(reg[id]);          // alive AND dead — history must persist
      return { v: 1, list: list };
    },
    apply: function (obj) {
      if (!obj || obj.v !== 1 || !Array.isArray(obj.list)) return;
      reg = {};
      for (let i = 0; i < obj.list.length; i++) {
        const e = obj.list[i];
        if (!e || !e.id || reg[e.id]) continue;
        // re-shape defensively so a malformed/older record never crashes a load
        reg[e.id] = {
          id: e.id, kind: e.kind || "npc", name: e.name || "Unknown",
          status: e.status === "dead" ? "dead" : "alive",
          successorId: e.successorId || null,
          killedBy: e.killedBy != null ? e.killedBy : null,
          killedAt: e.killedAt != null ? e.killedAt : null,
          history: Array.isArray(e.history) ? e.history : [],
        };
        // carry through any extra kind-specific fields the original register()
        // extra payload stamped on, same forward-compat spirit as schedule.js's apply
        for (const k in e) if (!(k in reg[e.id])) reg[e.id][k] = e[k];
        const m = /^id(\d+)$/.exec(e.id);
        if (m) seq = Math.max(seq, (+m[1]) + 1);
      }
    },
  };
})();
