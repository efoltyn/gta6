/* ============================================================
   systems/basesave.js — B8: SINGLE-PLAYER PERSISTENCE BRIDGE for player
   building's piece GEOMETRY. systems/building.js's serialize()/apply()
   already rides net/netpersist.js's worldBlob (blob.bld, MULTIPLAYER
   path) exactly like systems/baseclaim.js's BaseRecords (blob.base) — but
   neither had a SINGLE-PLAYER (offline / localStorage ledger) channel for
   the pieces themselves. This file is that channel.

   ------------------------------------------------------------------
   WHY A SEPARATE BRIDGE FILE, NOT ANOTHER _xWrap INSIDE building.js:
   city/familytree.js and systems/baseclaim.js both wrap
   CBZ.cityWorldCommit/cityWorldCollect directly from inside themselves —
   a fine pattern for pure bookkeeping data (an edges array, a BaseRecord
   Map: apply() just repopulates a plain JS structure, nothing scene-
   dependent). systems/building.js's B.apply() is NOT that: it replays
   through B.place() -> CBZ.spawnPiece(), which builds real THREE meshes
   and pushes into CBZ.colliders/platforms — it needs the CITY ARENA to
   already exist (placing a wall's world position only makes sense once
   the ground/lots it sits on are actually built). Baking a scene-
   readiness gate into building.js itself would be exactly the kind of
   persistence dependency that file's own header says it was written to
   avoid ("ADDITIVE / NEW INFRASTRUCTURE... zero existing call sites
   change"). So: this thin sibling file owns the wrap AND the deferred-
   apply gate, and building.js never has to know a save system exists.

   BASECLAIM'S OWN SP WRAP IS LEFT ALONE: systems/baseclaim.js already
   ships (since B6) its own `_bcWrap` stamping `led.baseClaim` / hydrating
   on ledger-reference-change — that data (BaseRecord ids/radii/authorized
   lists/upkeep stamps) is pure Map bookkeeping, never touches the scene,
   so it never needed deferred timing and continues to hydrate IMMEDIATELY
   on a ledger swap, unchanged. This file's `w.playerBases.bld` channel is
   ADDITIVE, solely for the piece-geometry gap building.js was missing —
   duplicating base ownership data into a second key here would just be
   two copies of the same truth for no benefit, so it doesn't.

   THE DEFERRED-APPLY SEAM: mirrors net/netpersist.js's own
   pendingChar/pendingWorld "settle" pattern (netpersist.js's onAlways(62)
   gates a queued apply behind `g.mode==="city" && CBZ.city.arena`, plus a
   short settle timer so the apply lands after mode.reset's own spawn
   placement, netpersist.js:290-299) — same shape here, minus the
   multiplayer wire: a ledger-reference change stashes the saved blob in
   `pendingBld` instead of applying it inline; a recurring LOW-ORDER
   onUpdate tick (right beside familytree.js's 45.92 / baseclaim.js's
   45.93 own save-wrap installer ticks) checks every frame whether
   `CBZ.city && CBZ.city.arena` (+ CBZ.pieces/CBZ.building) exist yet, and
   the FIRST frame they do, replays the blob through CBZ.building.apply()
   ONCE and clears `pendingBld` — clearing it is itself the guard against
   re-applying a stale blob on a later frame (city.build() only ever runs
   once per page load, so "arena exists" never becomes newly-false again
   to re-arm this).
   ============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const g = CBZ.game;

  function stampBld() {
    const led = g.cityWorld;
    if (led && typeof led === "object" && CBZ.building && CBZ.building.serialize) {
      led.playerBases = led.playerBases || {};
      led.playerBases.bld = CBZ.building.serialize();
    }
  }
  let _ensureSaveWraps_done = false;
  function ensureSaveWraps() {
    // ONE-SHOT INSTALL (chain-growth fix): the old guard checked the
    // module flag on the CURRENT top-of-chain function, so once any
    // later module wrapped above us the flag vanished from the top and
    // we re-wrapped EVERY tick - ~20 such modules made the commit chain
    // grow unboundedly (stack overflow on save; found by the P5 full-
    // stack harness). A module-local boolean wraps exactly once, ever.
    if (_ensureSaveWraps_done) return;
    _ensureSaveWraps_done = true;
    const commit = CBZ.cityWorldCommit;
    if (typeof commit === "function" && !commit._bsWrap) {
      const w = function () { stampBld(); return commit.apply(this, arguments); };
      w._bsWrap = true; CBZ.cityWorldCommit = w;
      // cityWorldCollect (the MP/persistence collector) shares the same
      // inner commit in worldstate.js — re-point it too, same idiom as
      // city/familytree.js / systems/baseclaim.js's own wraps.
      if (CBZ.cityWorldCollect && !CBZ.cityWorldCollect._bsWrap) {
        const col = CBZ.cityWorldCollect;
        const wc = function () { stampBld(); return col.apply(this, arguments); };
        wc._bsWrap = true; CBZ.cityWorldCollect = wc;
      }
    }
  }

  let _hydratedLedger = null;
  let pendingBld = null;   // queued blob, waiting for the arena/scene gate below
  function hydrateFromLedger() {
    const led = g.cityWorld;
    if (!led || led === _hydratedLedger) return;
    _hydratedLedger = led;
    pendingBld = (led.playerBases && led.playerBases.bld) || null; // null: fresh ledger / nothing built yet
  }

  // The deferred-apply gate: only fires once pendingBld is non-null AND the
  // city arena + the piece systems it replays through all exist. Clearing
  // pendingBld BEFORE calling apply() (not after) means a throw inside
  // apply() can't leave this retrying forever against a half-applied blob.
  function tryApplyPending() {
    if (!pendingBld) return;
    if (g.mode !== "city" || !(CBZ.city && CBZ.city.arena) || !CBZ.pieces || !CBZ.building || !CBZ.building.apply) return;
    const blob = pendingBld;
    pendingBld = null;
    try { CBZ.building.apply(blob); } catch (e) { console.error("[basesave]", e); }
  }

  if (CBZ.onUpdate) {
    // Right beside familytree.js (45.92) / baseclaim.js (45.93)'s own
    // save-wrap install ticks — this one ALSO drives the deferred apply.
    // Persistence plumbing runs regardless of play-state (same rationale
    // as those two files' own ticks): the wraps must be installed and a
    // ledger swap must be noticed even if the player never enters city
    // mode this session, so a later entry still finds pendingBld queued.
    CBZ.onUpdate(45.94, function () {
      if (!g) return;
      ensureSaveWraps();
      hydrateFromLedger();
      tryApplyPending();
    });
  }

  // dev/harness accessor: force the pending-apply check outside the normal
  // onUpdate cadence (mirrors CBZ._piecesReapDrain's synchronous-drain idiom).
  CBZ._baseSaveTryApply = tryApplyPending;

  // ---- SURVIVAL MODE: no save channel (per-run, by design) -----------------
  // Building/baseclaim both work in survival too (systems/baseclaim.js's own
  // keydown fallback block), but grepping src/modes/survival.js turns up
  // zero cityWorld/localStorage/persist references — survival has no save
  // of its own to ride, and city/worldstate.js's ledger is a CITY-mode
  // concept end to end (g.cityWorld is only ever meaningfully populated/
  // read across a city run). So a base built in survival simply doesn't
  // survive a reload — consistent with survival already being "everything
  // resets, per run" for every other system in that mode. Nothing to wire.
})();
