/* ============================================================
   city/inheritance.js — W9: DEATH TRANSFERS WEALTH.

   familytree.js (W6/W7) keeps kinship edges that survive death and already
   answers "who inherits?" via heirOf(sid) (living spouse → eldest living
   child → null). This module is the one that actually SPENDS that answer:
   it wraps the single death funnel (peds.js cityKillPed) and, once the
   original has run its course, hands the estate to the heir — cash first,
   then whatever property records already carry the victim's sid as owner
   (future-proofed for E8's billionaires, which mint sid owners), then the
   household lease if the heir was already living under the same roof.

   WRAP ORDER (this is the whole trick): killfeed.js, loyalty.js, social.js
   and schedule.js all wrap CBZ.cityKillPed already, and schedule.js's wrap
   calls dropSid(ped._sid) — which deletes the victim's OFFLINE LEDGER PAGE
   outright — from INSIDE the original chain. Whoever wraps LAST becomes the
   OUTERMOST call and runs first/last around everyone else, so by loading
   after familytree.js (itself last in the W-wave, after schedule.js/social.js/
   killfeed.js/loyalty.js — see index.html), we ARE outermost. But we don't
   even rely on being outermost: we capture ped.cash / ped._sid / ped._unit
   off the LIVE ped OBJECT at wrap-entry, BEFORE calling the original at all.
   The ledger page can vanish (dropSid) during the original call and it can't
   matter — we never read it for the victim's own money, only for the HEIR's.

   CASH: rollDeadLoot (peds.js, runs inside the original) has ALREADY rolled
   ped.deadLoot.cash = ped.cash + extra loot money for whoever loots the
   corpse. To avoid double-paying the same dollars (once to the heir, once
   to whoever loots the body), the estate transfer is only the SLICE of the
   captured cash that deadLoot did NOT already cover — see transferCash().

   PROPERTY: zillow.js listing records carry `ownerId` — today always a
   static string (a CORPS id, "city", "underworld", or a live gang id for
   illegal ops). No listing is ever owned by a ped's sid yet, so the loop
   below is a no-op in practice — it exists so E8 (billionaires as
   persistent shareholder NPCs) can mint sid owners and get succession for
   free. A dead GANG BOSS's illegal turf is untouched here on purpose:
   gangs.js's own succession machinery already re-points gang.bossName (and
   turf ownerId there is the GANG id, never the boss's personal sid).

   HOUSEHOLD: if the victim held the lease (occupants[0] of ped._unit) and
   the heir is a LIVE co-occupant of that SAME unit (a spouse/kid who
   already lived there), housing.js's cityHouseholdPromote reorders the
   unit so the heir leads it — the address survives the death exactly like
   a real household would. Otherwise release()'s normal vacancy path (called
   elsewhere on recycle) is left alone.

   citySocialDeath (social.js) already records the death in the family tree
   and severs the LIVE ped.partner ref (a live spouse must never point at a
   corpse) — that ordering is fine: heirOf() reads the TREE's edges/dead-set,
   not live ped refs, so it still resolves correctly however live objects
   get cleaned up.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;

  // ---- names -----------------------------------------------------------
  function nameOf(x) {
    if (!x) return null;
    if (typeof x === "object") return x.name || null;
    // x is a bare sid: check a live body first, then the offline page.
    const live = CBZ.cityLedgerLive && CBZ.cityLedgerLive(x);
    if (live && live.name) return live.name;
    const e = CBZ.cityLedgerEntry && CBZ.cityLedgerEntry(x);
    return (e && e.name) || null;
  }

  // ---- CASH: hand the estate (minus what the corpse loot already covers)
  //      to the heir — a LIVE body first (so it's visible immediately),
  //      else the heir's offline ledger page (if they even have one).
  function transferCash(ped, capturedCash, heirSid) {
    const deadLootCash = (ped.deadLoot && ped.deadLoot.cash) || 0;
    // NO-DOUBLE-PAY: deadLoot.cash was rolled from ped.cash (+ extra loot) —
    // whoever loots the corpse already gets at least the captured cash back.
    // Only the slice ABOVE that (today: never, since rollDeadLoot always adds
    // on top of ped.cash — see peds.js:1538) is left for the estate transfer.
    // This is deliberately conservative rather than double-paying; it also
    // means today's inheritance cash is usually 0 UNLESS a future change caps
    // or removes deadLoot's own cash roll.
    const estate = Math.max(0, capturedCash - deadLootCash);
    if (estate <= 0) return 0;
    const cut = Math.round(estate * 0.7);   // 30% "estate loss" — funeral costs, back taxes, a lawyer's cut
    if (cut <= 0) return 0;
    const heirLive = CBZ.cityLedgerLive && CBZ.cityLedgerLive(heirSid);
    if (heirLive) { heirLive.cash = (heirLive.cash || 0) + cut; return cut; }
    const entry = CBZ.cityLedgerEntry && CBZ.cityLedgerEntry(heirSid);
    if (entry) { entry.cash = (entry.cash | 0) + cut; return cut; }
    return 0;   // heir has neither a live body nor a ledger page — nothing to credit
  }

  // ---- PROPERTY: any zillow listing whose ownerId is literally this sid
  //      (nothing mints those yet — E8 will). Guarded no-op today, wired
  //      for tomorrow.
  function transferProperty(sid, heirSid) {
    const Z = CBZ.cityZillow;
    const listings = Z && Z.listings && Z.listings();
    if (!listings || !listings.length) return 0;
    let n = 0;
    for (let i = 0; i < listings.length; i++) {
      const rec = listings[i];
      if (rec && rec.ownerId === sid) { rec.ownerId = heirSid; n++; }
      // (a gang boss's illegal turf ownerId is the GANG id, never the boss's
      // personal sid, so it never matches here — gangs.js's own succession
      // already re-points gang.bossName on that death.)
    }
    return n;
  }

  // ---- HOUSEHOLD: promote a co-occupant heir to occupants[0] so the lease
  //      (and the address) survives the primary's death. Only fires when the
  //      VICTIM actually held the lease (occupants[0]) — a household member
  //      who was NOT the primary dying leaves the real leaseholder in place,
  //      nothing to promote.
  function transferHousehold(unit, wasPrimary, heirSid) {
    if (!unit || !wasPrimary || !CBZ.cityHouseholdPromote) return false;
    const heirLive = CBZ.cityLedgerLive && CBZ.cityLedgerLive(heirSid);
    if (!heirLive) return false;              // heir isn't a standing body — nothing to promote onto
    return CBZ.cityHouseholdPromote(unit, heirLive);
  }

  function settleEstate(ped, sid, capturedCash, capturedUnit, wasPrimary) {
    const FT = CBZ.cityFamilyTree;
    if (!FT) return;
    const heirSid = FT.heirOf(sid);
    if (!heirSid) return;                     // no living spouse or child — nobody to inherit

    const cashMoved = transferCash(ped, capturedCash, heirSid);
    const lotsMoved = transferProperty(sid, heirSid);
    const homeKept = transferHousehold(capturedUnit, wasPrimary, heirSid);

    if (cashMoved > 0 || lotsMoved > 0 || homeKept) {
      const victimName = ped.name || "Someone";
      const heirName = nameOf(heirSid) || "their heir";
      if (CBZ.city && CBZ.city.note) {
        CBZ.city.note("💀 Estate of " + victimName + " passes to " + heirName, 2.4);
      }
      // NOTE: no cityGossip seed here — the closest existing TOPIC is
      // "heroKilled" (grief/anger at the KILLER), which doesn't fit an estate
      // handoff; a proper "inheritance" topic would need a new TOPIC entry in
      // social.js (out of scope for this step — left for W12/the family panel).
    }
  }

  // ---- WRAP cityKillPed (idempotent) -----------------------------------
  if (typeof CBZ.cityKillPed === "function" && !CBZ.cityKillPed._inhWrap) {
    const orig = CBZ.cityKillPed;
    const wrapped = function (ped, imp, cause) {
      // capture off the LIVE object BEFORE the original runs — see header:
      // schedule.js's own wrap deletes the ledger page for this sid from
      // inside orig(), so anything we need must come from `ped` itself, now.
      const sid = ped && ped._sid;
      const capturedCash = ped ? (ped.cash || 0) : 0;
      const capturedUnit = ped ? (ped._unit || null) : null;
      const wasPrimary = !!(capturedUnit && capturedUnit.occupants && capturedUnit.occupants[0] === ped);
      const wasDead = !ped || ped.dead;
      const ret = orig.apply(this, arguments);
      if (!wasDead && ped && ped.dead && sid) {
        try { settleEstate(ped, sid, capturedCash, capturedUnit, wasPrimary); } catch (e) {}
      }
      return ret;
    };
    wrapped._inhWrap = true;
    CBZ.cityKillPed = wrapped;
  }
})();
