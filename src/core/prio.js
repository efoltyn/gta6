/* ============================================================
   core/prio.js — the frame-order MAP for CBZ.onUpdate/onAlways.

   HOW THE LOOP ORDERS WORK (see core/loop.js:11-12 + config.js:470-471):
   every CBZ.onUpdate(order, fn) / CBZ.onAlways(order, fn) call just pushes
   {order, fn, source} onto CBZ.updaters / CBZ.always. core/loop.js SORTS
   each array ONCE at boot by `order` (ascending) and then walks it every
   frame in that fixed sequence. There is no scheduler, no priority queue,
   no re-sort at runtime — "order" is nothing but a plain number chosen by
   whoever wrote the call, and the WHOLE 200+ callsite space in this repo
   has grown, file by file, into a de-facto convention rather than a
   designed one.

   THIS FILE DOES NOT CHANGE THAT ORDER. It only NAMES the bands that
   already exist so new code can slot in sanely instead of guessing a
   number. CBZ.PRIO.X below is a real, grepped number pulled from an
   ANCHOR file (cited per entry) — not a plan for where things "should"
   go. Renumbering any of these would change execution order and is
   explicitly out of scope for this file.

   DECIMAL-SLOTTING CONVENTION (already in wide use — see economy.js's
   30/30.2/30.4/30.6/30.8 ladder, or gigfleet.js's 41.5 comment "just
   after wealth.js's faucet (41)"): once a whole-number band is claimed,
   later systems that need to run just after it add a small decimal
   (+0.1, +0.2, +0.01 for a razor-thin nudge) rather than picking a new
   integer. CBZ.PRIO.after(base, n) below returns base + (n||1)*0.01 as a
   tiny default nudge — for a bigger, more readable gap follow the
   existing convention and just add "+ 0.1" / "+ 0.5" by hand as the
   codebase already does everywhere.

   RULE FOR NEW CODE: don't hardcode a bare number. Write
     CBZ.onUpdate(CBZ.PRIO.PED_BRAIN, fn)                  // same band
     CBZ.onUpdate(CBZ.PRIO.after(CBZ.PRIO.PED_BRAIN, 2), fn) // just after
   and leave a one-line comment saying WHY (what you must run before/after).
   If two systems truly need the exact same instant, that's fine — see the
   COLLISION WARNING below, which is a dev aid, not an error: this codebase
   already has several exact-order ties in the wild (documented per band)
   and they work fine because each fn already guards on its own state.

   VERIFIED BAND TABLE — every number below was grep-confirmed against the
   cited anchor file at the time this was written. Where more than one
   system shares the EXACT same order (a real, pre-existing tie — not a
   hypothetical), that is called out so the collision warning below isn't
   a surprise the first time it fires.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;

  CBZ.PRIO = {
    // INPUT — NOT actually scheduled. systems/input.js only attaches raw
    // keydown/keyup listeners onto CBZ.keys; it never calls onUpdate/onAlways.
    // Kept here as a RESERVED low-end marker (nothing anchors it) so future
    // input-adjacent code has a name to slot before PHYSICS, which is the
    // first real consumer of CBZ.keys (systems/physics.js:570, order 10).
    INPUT: 5,

    // PHYSICS — systems/physics.js:570  CBZ.onUpdate(10, updatePlayer)
    PHYSICS: 10,

    // DISASTERS — systems/disasters.js:834  CBZ.onUpdate(28, ...)
    DISASTERS: 28,

    // ECON — city/economy.js:665  CBZ.onUpdate(30, ...) — the ledger tick
    // that anchors the whole 30/30.2/30.4/30.6/30.8 decimal ladder (see
    // economy.js:1102/1110/1131/1229) plus city/adboard.js:188 at 30.8.
    ECON: 30,

    // AI_GOALS — city/aigoals.js:1756  CBZ.onUpdate(33, ...) (crowd goal
    // slicing). REAL TRIPLE TIE at exactly 33: systems/combat.js:72
    // (launched-body physics) and city/wanted.js:286 (heat decay) both
    // also register onUpdate(33, ...) — three unrelated systems, same tick.
    AI_GOALS: 33,

    // PANIC — city/cityevents.js:141  CBZ.onUpdate(33.5, ...) (panic decay +
    // contagion). Shares its literal number with SOCIAL below (real tie,
    // see there) — kept as a distinct named band since the two are
    // conceptually unrelated even though the number matches today.
    PANIC: 33.5,

    // PED_BRAIN — city/peds.js:3765  CBZ.onUpdate(34, ...)
    PED_BRAIN: 34,

    // SOCIAL — city/social.js:1307  CBZ.onUpdate(34.5, ...) (bubbles/gossip/
    // routines). REAL TRIPLE TIE at exactly 34.5: city/gangs.js:1667
    // (drive-by/attack routing upkeep) and city/island_speedway.js:827
    // (live race tick) also register onUpdate(34.5, ...).
    SOCIAL: 34.5,

    // GANGS — city/gangs.js:1016  CBZ.onUpdate(34.6, ...) (per-gang
    // provoke/hostility/war-timer upkeep). NOTE: gangs.js ALSO registers a
    // second tick at 34.5 (see SOCIAL's tie above) — the gang system
    // straddles two slots; 34.6 is its "own" band away from the collision.
    GANGS: 34.6,

    // POLICE — city/police.js:1582  CBZ.onUpdate(35, ...) (per-frame cop
    // maintain). police.js also uses 40 for an unrelated tick (see GAMEPLAY).
    POLICE: 35,

    // SCHEDULE — city/schedule.js:453  CBZ.onUpdate(35.8, ...)
    SCHEDULE: 35.8,

    // INTERACT — city/interactions.js:226  CBZ.onUpdate(39, ...). REAL TIE
    // at exactly 39: city/pawnshop.js:521 also registers onUpdate(39, ...).
    // (Distinct from systems/interactions.js:199, which runs at 40 — see
    // GAMEPLAY — and from city/interact.js:940, which runs at 38.)
    INTERACT: 39,

    // GAMEPLAY — city/heists.js:716  CBZ.onUpdate(40, ...). REAL 5-WAY TIE
    // at exactly 40: city/police.js:543, city/island_airport.js:480,
    // city/leaderboard.js:391 and systems/interactions.js:199 ALL also
    // register onUpdate(40, ...). This is the single most-shared exact
    // order number found in the whole codebase.
    GAMEPLAY: 40,

    // WEALTH — city/wealth.js:589  CBZ.onUpdate(41, ...) (the money faucet).
    // city/gigfleet.js:217 already documents slotting after it in a comment:
    // "just after wealth.js's faucet (41)" at onUpdate(41.5, ...) — the
    // clearest in-repo confirmation of the decimal-slotting convention.
    WEALTH: 41,

    // VEHICLES — city/aircraft.js:801  CBZ.onUpdate(42, ...). NOTE: ground
    // vehicles (city/vehicles.js) do NOT live here — they run earlier, at
    // 11 (vehicles.js:1551), 37 (vehicles.js:2217) and 37.6/38
    // (vehicles.js:1999/1129). city/playerair.js:451 slots just after this
    // band at 42.5. Documented as-found even though the name undersells it.
    VEHICLES: 42,

    // PRESENTATION — systems/markers.js:187  CBZ.onAlways(60, tick). REAL
    // TIE at exactly 60: net/net.js:206 also registers onAlways(60, ...);
    // net.js additionally slots 60.1 (net.js:275) and netvoice.js slots
    // 60.2 (netvoice.js:114) right after.
    PRESENTATION: 60,

    // PERSIST — net/netpersist.js:278  CBZ.onAlways(62, ...) (character
    // save-settle). NOTE: the bare number 62 is ALSO reused for onUpdate
    // (a different array, so no real collision) by systems/difficulty.js:237
    // and city/regionlife.js:319 — a naming trap, not a bug: onUpdate and
    // onAlways are tracked as separate kinds by the collision warning below.
    PERSIST: 62,

    // LATE — systems/weather.js:212  CBZ.onAlways(90, ...). REAL TIE at
    // exactly 90: systems/dashboard.js:185 also registers onAlways(90, ...).
    // systems/grapple.js:599 reuses the bare number 90 for onUpdate (again a
    // different kind, not a real tie). city/world.js:123 and
    // modes/survival.js:238 have their own exact tie one step later, at 93.
    LATE: 90,

    // HUD — systems/hud.js:64  CBZ.onAlways(94, ...). REAL TRIPLE TIE at
    // exactly 94: city/mode.js:179 and systems/killstreaks.js:180 also
    // register onAlways(94, ...). (Correction: order 80 — an earlier guess
    // for this band — actually belongs to systems/ambient.js:13, the
    // footstep/audio tick, not HUD; it is NOT part of this band.)
    HUD: 94,
  };

  // Slot just after a band: base + (n||1) * 0.01 by default (a razor-thin
  // nudge). For a wider, more readable gap, follow the existing convention
  // and add "+ 0.1" / "+ 0.5" by hand, same as economy.js / gigfleet.js do.
  CBZ.PRIO.after = function (base, n) { return base + (n || 1) * 0.01; };

  // ------------------------------------------------------------------
  // COLLISION WARNING (dev aid only — never changes execution order).
  // Wrapping is idempotent (guarded by the _prioWrap flag on CBZ.onUpdate/
  // CBZ.onAlways themselves, same pattern used elsewhere in this repo, e.g.
  // city/marriage.js's _marWrap) so re-loading this file twice is harmless.
  // ------------------------------------------------------------------
  if (CBZ.CONFIG.PRIO_WARN == null) CBZ.CONFIG.PRIO_WARN = false; // quiet by default

  function warnEnabled() {
    if (CBZ.CONFIG && CBZ.CONFIG.PRIO_WARN) return true;
    return typeof location !== "undefined" && /(?:\?|&)prio=1(?:&|$)/.test(location.search || "");
  }

  function wrapRegistrar(fnName, arr) {
    const orig = CBZ[fnName];
    if (typeof orig !== "function" || orig._prioWrap) return; // already wrapped / not present
    const seenOrders = new Set();     // per-kind: orders already registered
    const warnedOrders = new Set();   // per-kind: orders already warned about (once each)

    const wrapped = function (order, fn) {
      orig(order, fn);
      if (!warnEnabled()) return;
      if (seenOrders.has(order)) {
        if (!warnedOrders.has(order)) {
          warnedOrders.add(order);
          const entry = arr[arr.length - 1]; // the registration we just pushed
          const hint = entry && entry.source ? " (" + entry.source + ")" : "";
          console.warn("[prio] " + fnName + " order " + order +
            " registered by multiple systems" + hint);
        }
      } else {
        seenOrders.add(order);
      }
    };
    wrapped._prioWrap = true;
    CBZ[fnName] = wrapped;
  }

  wrapRegistrar("onUpdate", CBZ.updaters);
  wrapRegistrar("onAlways", CBZ.always);
})();
