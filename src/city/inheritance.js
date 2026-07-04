/* ============================================================
   city/inheritance.js — W9: DEATH TRANSFERS WEALTH. W10 (see the
   "GENERATIONAL GRUDGE" section below, near the bottom) extends the same
   wrap so death also transfers a GRUDGE, one hop through the family tree.

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

  /* ============================================================
     GENERATIONAL GRUDGE (W10) — a player kill doesn't just end at the body;
     the victim's FAMILY remembers, and that memory outlives the session.

     social.js already runs a grudge ripple of its own the instant someone
     dies: citySocialWitnessKill (social.js ~809-832), reached either via
     peds.js's citySocialDeath (peds.js:1525, fires when ped.partner was set)
     or social.js's own cityKillPed wrap's proximity fallback (social.js
     ~1159-1165, for a partnerless victim's nearby .friends clique). That
     ripple ONLY ever touches two live-object arrays: victim.partner and
     victim.friends (a friend CLIQUE, unrelated to kinship). It never walks
     the persistent family TREE (familytree.js), so:
       - a KID or PARENT (kidsOf/parentsOf) is NEVER covered by it — they
         aren't in .friends and aren't victim.partner — even when they're a
         standing body clear across town (the "kid at school" case).
       - a SPOUSE *can* be double-covered, because familytree.js's spouseOf
         and social.js's live victim.partner ref are normally the same
         person (social.js calls FT.marry() at the moment it sets
         head.partner/spouse.partner — see social.js:405/412, :464/472-473).
     So below we walk spouse+kids+parents (one hop) and SKIP the spouse only
     when it's provably the same live partner social.js's ripple already hit.

     PERSISTENCE is the actual point: a relative who is a LIVE ped right now
     gets the standard behavioural event (cityRelShift feeds peds.js's fear/
     rage/ambush reads immediately); a relative who is currently off-map
     (only an offline ledger page, no standing body) gets the grudge written
     straight into that page's e.rel — schedule.js's cityPedDeal/vendorSweep
     already restore e.rel -> ped.relPlayer with the exact same axis mapping
     (r/f/l/a/g/s -> respect/fear/loyalty/affection/grudge/seen — verified at
     schedule.js:352 and :432) the moment that identity walks back on-screen,
     so the grudge is WAITING for them, exactly like a real vendetta.

     DEATH OF THE GRUDGE HOLDER: nothing to do here on purpose. If a grudge-
     holding relative is later killed themselves, that is its own, independent
     cityKillPed call — this same section runs again for THAT death, walking
     THEIR spouse/kids/parents. The grudge we just wrote doesn't need active
     upkeep or transfer; it simply stops mattering when the page holding it is
     dropped (dropSid, schedule.js:391), the same as any other rel data.

     NPC-vs-NPC SCOPE: aigoals.js's cityNpcFriendDeath (~1706-1738) already
     gives an NPC witness a short (60-120s) transient _grudgeT for an ATTACKER
     that isn't the player. That is deliberately NOT extended into a
     persistent store here — ped.relPlayer / the ledger's e.rel are BOTH
     specifically "how this person feels about the PLAYER"; there is no axis
     for "how ped X feels about ped Y". Building that parallel store is out of
     scope for W10 — persistent NPC<->NPC vendettas are noted (BUILD-PLAN) as
     riding the SQLite relationships table in a later S-stage pass instead.
  ============================================================ */
  const GRUDGE_G = 40, GRUDGE_F = 12;   // == REL_EVENTS.friendKilled's grudge/fear in social.js — same event, same weight
  const NO_SIDS = [];

  // stamp a read-side hook: a flag future ai/social code can check to gate
  // ambush behaviour ("this person has an open vendetta") without re-deriving
  // it from the rel axes each time. Grepped today (2026-07-01) and nothing
  // reads `.vendetta` off a ledger entry yet — peds.js's unrelated ped._vendetta
  // (a LIVE ped's police-witness-report flag, gated on rel.grudge>40) is a
  // different field on a different object; this is a fresh hook for later waves.
  function stampVendettaFlag(relSid) {
    const e = CBZ.cityLedgerEntry && CBZ.cityLedgerEntry(relSid);
    if (e) e.vendetta = 1;
  }

  // apply the grudge to ONE relative sid: a standing live body gets the real
  // behavioural event; an off-map identity gets it written straight onto its
  // offline ledger page so it's there the moment they deal back in.
  function applyGrudgeTo(relSid) {
    if (!relSid) return;
    const livePed = CBZ.cityLedgerLive && CBZ.cityLedgerLive(relSid);
    if (livePed && !livePed.dead && CBZ.cityRelShift) {
      // identical event/amount to social.js's own friendKilled ripple — a
      // relative beyond the live circle feels exactly what a nearby friend
      // would, not a bespoke weaker/stronger echo.
      CBZ.cityRelShift(livePed, "friendKilled", 1);
    } else {
      const e = CBZ.cityLedgerEntry && CBZ.cityLedgerEntry(relSid);
      // no live body AND no ledger page: this sid isn't trackable right now.
      // A genuinely-dead relative always lands here too (by design, not by
      // accident) — dropSid (schedule.js:391) deletes a dead sid's page
      // outright and no live ped exists for a corpse, so there is nothing to
      // stamp; the earlier "living only" requirement falls out of this check
      // for free without needing a separate isLiving() query.
      if (!e) return;
      e.rel = e.rel || { r: 0, f: 0, l: 0, a: 0, g: 0, s: 0 };
      e.rel.g = Math.min(100, (e.rel.g || 0) + GRUDGE_G);
      e.rel.f = Math.min(100, (e.rel.f || 0) + GRUDGE_F);
      // mark this rel record "seen" (matches relPlayer.seen's role — schedule.js
      // gates worth()/restore on it) so the grudge reads as real once dealt in,
      // and refresh the page's recency stamp so the normal LRU trim() (CAP=900,
      // schedule.js:196-208) doesn't evict the very page we just gave a reason
      // to matter.
      e.rel.s = 1;
      e.seen = Date.now();
    }
    stampVendettaFlag(relSid);
  }

  // sid            — the victim's own sid (never grudge their own page).
  // spouseSid      — FT.spouseOf(sid), captured BEFORE orig() ran (see wrap
  //                  below for why: markDeath ends the marriage edge).
  // kidSids/parentSids — FT.kidsOf(sid)/FT.parentsOf(sid), one hop only.
  // capturedPartnerObj — the victim's LIVE ped.partner ref at the moment of
  //                  death (or null), used ONLY to decide whether social.js's
  //                  own ripple already covered the spouse slot.
  function seedGenerationalGrudge(sid, spouseSid, kidSids, parentSids, capturedPartnerObj) {
    const done = Object.create(null);
    done[sid] = true;   // never grudge the victim's own page
    if (spouseSid && !done[spouseSid]) {
      // DEDUP: social.js's citySocialWitnessKill already ran (inside orig(),
      // via peds.js:1525's ped.partner gate) and hit this exact live object
      // when the tree's spouse IS that live partner. Only in that exact case
      // do we skip — if the tree resolves someone else (no live .partner at
      // death, e.g. an already-widowed remarriage edge case), nobody has
      // applied it yet and we must.
      const alreadyCovered = !!(capturedPartnerObj && !capturedPartnerObj.dead && capturedPartnerObj._sid === spouseSid);
      if (!alreadyCovered) applyGrudgeTo(spouseSid);
      done[spouseSid] = true;
    }
    // KIDS + PARENTS: zero overlap with social.js's ripple (see section header
    // — neither lives in victim.partner nor victim.friends) — always apply.
    for (let i = 0; i < kidSids.length; i++) { const k = kidSids[i]; if (k && !done[k]) { applyGrudgeTo(k); done[k] = true; } }
    for (let i = 0; i < parentSids.length; i++) { const p = parentSids[i]; if (p && !done[p]) { applyGrudgeTo(p); done[p] = true; } }
    // ONE HOP ONLY for W10 (spouse/kids/parents). Grandkids and deeper kin
    // come with actual multi-generation dynasties (later wave) — walking
    // further today would mostly hit nobody (kidsOf a kid is still usually
    // empty) for real added cost every single player kill.
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
      // GENERATIONAL GRUDGE capture — same "before orig() runs" discipline as
      // the cash/unit capture above, for a sharper reason here: orig() calls
      // citySocialDeath (peds.js:1525) when ped.partner was set, which calls
      // FT.markDeath(sid) (social.js:672), which ENDS this sid's spouse edge
      // (why:"death") right then. familytree.js's spouseOf() only returns a
      // *live* marriage (e.end==null — familytree.js:184), so calling it
      // AFTER orig() runs would already see the just-ended edge and return
      // null — the surviving spouse must be read NOW, before that happens.
      const FT = CBZ.cityFamilyTree;
      const capturedSpouseSid = (FT && sid) ? FT.spouseOf(sid) : null;
      const capturedKidSids = (FT && sid) ? FT.kidsOf(sid) : NO_SIDS;
      const capturedParentSids = (FT && sid) ? FT.parentsOf(sid) : NO_SIDS;
      const capturedPartnerObj = ped ? (ped.partner || null) : null;
      const capturedByPlayer = !imp || imp.byPlayer !== false;   // same convention as social.js's own wrap
      const ret = orig.apply(this, arguments);
      if (!wasDead && ped && ped.dead && sid) {
        try { settleEstate(ped, sid, capturedCash, capturedUnit, wasPrimary); } catch (e) {}
        try {
          if (capturedByPlayer) seedGenerationalGrudge(sid, capturedSpouseSid, capturedKidSids, capturedParentSids, capturedPartnerObj);
        } catch (e) {}
      }
      return ret;
    };
    wrapped._inhWrap = true;
    CBZ.cityKillPed = wrapped;
  }
})();
