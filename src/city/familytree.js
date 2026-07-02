/* ============================================================
   city/familytree.js — THE FAMILY TREE: persistent kinship edges that
   SURVIVE DEATH. This is the whole point of the module: every other city
   system (schedule.js's ledger, social.js's pairing, family.js's houses)
   treats a person as a LIVE BODY that can despawn or die; this module is
   the one place that keeps remembering who was married to whom and whose
   child is whose, forever, so later waves can answer "who inherits?"
   (W9), "does the son remember?" (W10) and "who's born next?" (W11)
   without re-deriving lineage from scratch.

   RUNTIME-ONLY DEPENDENCY: this module calls CBZ.cityPedStash (schedule.js)
   at pairing time to force-mint a sid for a ped that doesn't have one yet.
   It does NOT need schedule.js to exist at LOAD time (every call here is
   deferred to whenever marry/bearChild/markDeath actually run), so the
   <script> tag only needs CBZ to be defined — load position in the wave
   is not load-bearing, unlike most modules that read another's exports
   at IIFE-run time.

   DATA MODEL: `edges` is a flat array of compact records (JSON-budget
   matters — this rides every save):
     { k: "sp"|"pc", a: sid, b: sid, since: t, end: null|t, why: null|"death"|"divorce" }
   sp  = spouse (a<->b, symmetric)
   pc  = parent->child (a = parent, b = child; a pc edge NEVER ends — see
         markDeath below: parentage is forever, only marriages end)
   An index Map (sid -> edge[]) is rebuilt lazily off a dirty flag so
   repeated queries in a frame don't re-scan the whole array.

   LIVENESS: schedule.js's cityNpcLedger only exposes serialize()/apply()
   — a killed identity's ledger PAGE is deleted outright (schedule.js
   dropSid), it isn't kept around flagged alive:false. So there is no
   external "is this sid alive" oracle to defer to; this module owns a
   small `dead` sid set as the SOLE authority for liveness queries here
   (markDeath is the only writer). If a later wave adds a real alive
   query to the ledger, heirOf/isLiving below is the one place to widen.

   TIME: no world-day counter exists yet (polity.js, later, will add one
   — grep found only CBZ.dayPhase, which is a 0..1 fraction of the CURRENT
   day, not a monotonic counter). Stamps use CBZ.game.elapsed (seconds
   since the current run started) as a placeholder ordering key — good
   enough for "since"/"end" ordering within a run; P1 should upgrade these
   stamps to a real worldDay once one exists.

   PERSISTENCE (two paths, both guarded/defensive, matching the fracture.js
   / cityNpcLedger precedent):
     - MULTIPLAYER: src/net/netpersist.js worldBlob()/applyWorld() pick up
       serialize()/apply() beside the npc ledger line (edited there).
     - SINGLE-PLAYER: this file wraps CBZ.cityWorldCommit/cityWorldCollect
       exactly like bank.js's loan ledger (own guard flag _ftWrap) so
       g.cityWorld.familyTree rides the SAME localStorage ledger, and
       hydrates back out on any g.cityWorld reference change (fresh load /
       respawn / MP adopt).

   NOT WIRED YET (by design — W7): nothing calls marry()/bearChild() from
   social.js or family.js in this step. This ships the module + its
   persistence only.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const g = CBZ.game;

  // ---- STATE -------------------------------------------------------------
  let edges = [];              // { k, a, b, since, end, why }
  let dead = Object.create(null); // sid -> true (the sole liveness authority — see header)
  let idx = null;               // sid -> edge[] (lazy, rebuilt on dirty)
  let idxDirty = true;

  function now() {
    // P1 will upgrade this to a real worldDay once polity.js lands one.
    return (g && g.elapsed) | 0;
  }

  function markDirty() { idxDirty = true; }

  function ensureIdx() {
    if (!idxDirty && idx) return idx;
    idx = new Map();
    for (let i = 0; i < edges.length; i++) {
      const e = edges[i];
      addIdx(e.a, e); addIdx(e.b, e);
    }
    idxDirty = false;
    return idx;
  }
  function addIdx(sid, e) {
    let list = idx.get(sid);
    if (!list) { list = []; idx.set(sid, list); }
    list.push(e);
  }

  // force-mint a sid for a live ped (schedule.js's cityPedStash); pass
  // through strings/numbers untouched so callers can also hand in a raw sid.
  function sidOf(x) {
    if (x == null) return null;
    if (typeof x === "string" || typeof x === "number") return String(x);
    if (x._sid) return x._sid;
    if (CBZ.cityPedStash) CBZ.cityPedStash(x);
    return x._sid || null;
  }

  function liveSpEdge(a, b) {
    const list = ensureIdx().get(a) || [];
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e.k === "sp" && e.end == null && ((e.a === a && e.b === b) || (e.a === b && e.b === a))) return e;
    }
    return null;
  }

  // ============================================================
  //  WRITE API
  // ============================================================

  // marry(pedA, pedB) — idempotent: returns the existing live sp edge for
  // the pair if one already exists instead of duplicating it.
  function marry(pedA, pedB) {
    const a = sidOf(pedA), b = sidOf(pedB);
    if (!a || !b || a === b) return null;
    const existing = liveSpEdge(a, b);
    if (existing) return existing;
    const e = { k: "sp", a: a, b: b, since: now(), end: null, why: null };
    edges.push(e); markDirty();
    return e;
  }

  // bearChild(parentA, parentB, childPed) — pc edges from each given parent
  // to the child (either parent may be null/omitted for a single-parent
  // record). Idempotent per parent->child pair.
  function bearChild(parentA, parentB, childPed) {
    const c = sidOf(childPed);
    const out = [];
    if (!c) return out;
    const pa = parentA != null ? sidOf(parentA) : null;
    const pb = parentB != null ? sidOf(parentB) : null;
    if (pa) out.push(addPc(pa, c));
    if (pb && pb !== pa) out.push(addPc(pb, c));
    return out;
  }
  function addPc(parentSid, childSid) {
    const list = ensureIdx().get(parentSid) || [];
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e.k === "pc" && e.a === parentSid && e.b === childSid) return e;
    }
    const e = { k: "pc", a: parentSid, b: childSid, since: now(), end: null, why: null };
    edges.push(e); markDirty();
    return e;
  }

  // endMarriage(sidA, sidB, why) — stamp end/why on the live sp edge; the
  // edge itself is NEVER deleted (the history is the point).
  function endMarriage(sidA, sidB, why) {
    const e = liveSpEdge(sidA, sidB);
    if (!e) return null;
    e.end = now();
    e.why = why || "divorce";
    return e;
  }

  // markDeath(sid, t) — ends this sid's live spouse edge(s) (why:"death")
  // and marks the sid dead for liveness queries below. Parent/child (pc)
  // edges are NEVER ended here: parentage outlives the person by design
  // (a dead parent is still a parent — inheritance/lineage need that).
  function markDeath(sid, t) {
    if (!sid) return;
    dead[sid] = true;
    const stamp = t != null ? t : now();
    const list = ensureIdx().get(sid) || [];
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e.k === "sp" && e.end == null) { e.end = stamp; e.why = "death"; }
    }
  }

  // ============================================================
  //  QUERY API
  // ============================================================
  function spouseOf(sid) {
    if (!sid) return null;
    const list = ensureIdx().get(sid) || [];
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e.k === "sp" && e.end == null) return e.a === sid ? e.b : e.a;
    }
    return null;
  }
  function exSpousesOf(sid) {
    const out = [];
    if (!sid) return out;
    const list = ensureIdx().get(sid) || [];
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e.k === "sp" && e.end != null) out.push(e.a === sid ? e.b : e.a);
    }
    return out;
  }
  // kidsOf(sid) — child sids where this sid is the parent, oldest first.
  function kidsOf(sid) {
    if (!sid) return [];
    const list = (ensureIdx().get(sid) || []).filter(function (e) { return e.k === "pc" && e.a === sid; });
    list.sort(function (x, y) { return x.since - y.since; });
    return list.map(function (e) { return e.b; });
  }
  // parentsOf(sid) — parent sids where this sid is the child.
  function parentsOf(sid) {
    const out = [];
    if (!sid) return out;
    const list = ensureIdx().get(sid) || [];
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e.k === "pc" && e.b === sid) out.push(e.a);
    }
    return out;
  }
  function isLiving(sid) { return !!sid && !dead[sid]; }

  // heirOf(sid) — living spouse first, else the eldest LIVING child, else
  // null. "Living" = not in the dead set (see header: the sole authority
  // this module has — schedule.js's ledger doesn't expose one).
  function heirOf(sid) {
    if (!sid) return null;
    const sp = spouseOf(sid);
    if (sp && isLiving(sp)) return sp;
    const kids = kidsOf(sid);
    for (let i = 0; i < kids.length; i++) if (isLiving(kids[i])) return kids[i];
    return null;
  }
  function edgesOf(sid) {
    if (!sid) return [];
    return (ensureIdx().get(sid) || []).slice();
  }
  function count() { return edges.length; }

  // ============================================================
  //  PERSISTENCE (consumed by src/net/netpersist.js, guarded; and the
  //  single-player wrap below)
  // ============================================================
  function serialize() {
    return { v: 1, edges: edges.slice(), dead: Object.keys(dead) };
  }
  function apply(obj) {
    if (!obj || obj.v !== 1) return;
    const clean = [];
    if (Array.isArray(obj.edges)) {
      for (let i = 0; i < obj.edges.length; i++) {
        const e = obj.edges[i];
        if (!e || (e.k !== "sp" && e.k !== "pc") || !e.a || !e.b) continue;
        clean.push({ k: e.k, a: e.a, b: e.b, since: e.since || 0, end: e.end != null ? e.end : null, why: e.why || null });
      }
    }
    edges = clean;
    dead = Object.create(null);
    if (Array.isArray(obj.dead)) for (let i = 0; i < obj.dead.length; i++) dead[obj.dead[i]] = true;
    markDirty();
  }
  function reset() {
    edges = []; dead = Object.create(null); markDirty();
  }

  CBZ.cityFamilyTree = {
    marry: marry, bearChild: bearChild, endMarriage: endMarriage, markDeath: markDeath,
    spouseOf: spouseOf, exSpousesOf: exSpousesOf, kidsOf: kidsOf, parentsOf: parentsOf,
    heirOf: heirOf, edgesOf: edgesOf, count: count,
    serialize: serialize, apply: apply, reset: reset,
  };
  // top-level guard-call convention (cityGangsReset/citySocialReset/
  // cityFamilyReset in mode.js's fresh-run sequence) — wired there too.
  CBZ.cityFamilyTreeReset = reset;

  // ============================================================
  //  SINGLE-PLAYER PERSIST — the bank.js g.cityLoans pattern, verbatim:
  //  stamp the live tree onto g.cityWorld right before the existing
  //  commit/collect save hooks run, and hydrate back out whenever that
  //  ledger object's REFERENCE changes (fresh load / respawn / MP adopt).
  //  Own idempotence flag (_ftWrap) so this only wraps each fn once and
  //  carries forward whatever bank.js/others already wrapped.
  // ------------------------------------------------------------
  function stampFamilyTree() {
    const led = g.cityWorld;
    if (led && typeof led === "object") led.familyTree = serialize();
  }
  let _ensureFamilyTreeSaveWraps_done = false;
  function ensureFamilyTreeSaveWraps() {
    // ONE-SHOT INSTALL (chain-growth fix): the old guard checked the
    // module flag on the CURRENT top-of-chain function, so once any
    // later module wrapped above us the flag vanished from the top and
    // we re-wrapped EVERY tick - ~20 such modules made the commit chain
    // grow unboundedly (stack overflow on save; found by the P5 full-
    // stack harness). A module-local boolean wraps exactly once, ever.
    if (_ensureFamilyTreeSaveWraps_done) return;
    _ensureFamilyTreeSaveWraps_done = true;
    const commit = CBZ.cityWorldCommit;
    if (typeof commit === "function" && !commit._ftWrap) {
      const w = function () { stampFamilyTree(); return commit.apply(this, arguments); };
      w._ftWrap = true; CBZ.cityWorldCommit = w;
      // cityWorldCollect (the MP/persistence collector) shares the same inner
      // commit in worldstate.js — re-point it to the stamping wrap so the
      // server-bound blob carries the family tree too.
      if (CBZ.cityWorldCollect && !CBZ.cityWorldCollect._ftWrap) {
        const col = CBZ.cityWorldCollect;
        const wc = function () { stampFamilyTree(); return col.apply(this, arguments); };
        wc._ftWrap = true; CBZ.cityWorldCollect = wc;
      }
    }
  }
  let _hydratedLedger = null;
  function hydrateFromLedger() {
    const led = g.cityWorld;
    if (!led || led === _hydratedLedger) return;
    _hydratedLedger = led;
    if (led.familyTree) apply(led.familyTree);
  }
  if (CBZ.onUpdate) {
    CBZ.onUpdate(45.92, function () {
      if (!g) return;
      // persistence plumbing runs regardless of play-state (and headless):
      // the wraps must be installed so any commit stamps the tree, and a
      // ledger swap must rehydrate it — both unconditional, like bank.js's.
      ensureFamilyTreeSaveWraps();
      hydrateFromLedger();
    });
  }
})();
