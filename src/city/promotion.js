/* ============================================================
   city/promotion.js — the KILL BUS. (It is no longer a rank ladder.)

   WHAT THIS FILE IS NOW: one wrap on CBZ.city.addKill that turns every kill
   in the game into a CBZ.cityRankEvent, which playergang.js listens to in
   order to credit a body put in for the crew you ride with. That is the whole
   job. Nothing here holds progression state.

   WHAT WAS DELETED (2026-07-26, the ROLE LAYER wave):
   A complete, fully-written 7-tier street-XP ladder — RANKS (Nobody →
   Kingpin), rankIndex(), state(), and applyCrewPerks() (which handed out HP
   and weapon upgrades per tier) — had been RETIRED in an earlier wave but
   still shipped: `CBZ.cityStreetRank` was hard-wired to `return null`, grant()
   was a documented no-op, and every table and perk rule sat in the file
   unreferenced. The 2026-07-26 census counted it as rank ladder #6 of 6.

   It is gone rather than "kept for shape", per CLAUDE.md's ban on stat
   fictions: it claimed a progression that could not happen. The two functions
   other code actually calls (cityGrantStreetXp, cityStreetRank) survive as
   honest no-ops with the same return contract, so no caller changes.
   The one live ladder for the underworld is gangs.js's RANKS, declared once
   through CBZ.factions.declare("gang") — see city/factions.js.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const g = CBZ.game;

  if (CBZ.factionMigrated) CBZ.factionMigrated("ladder:promotion");

  // The street-rank chip null-guards and self-hides on null. Kept because the
  // HUD calls it; it will never return a rank again.
  CBZ.cityStreetRank = function () { return null; };

  // Retained no-op shim: any surviving caller/wrap gets a stable, honest
  // object back instead of a crash. It banks nothing and shows nothing.
  const NO_RANK = { xp: 0, index: 0, title: null, perk: null, nextTitle: null, nextXp: null, progress: 1 };
  CBZ.cityGrantStreetXp = function (amount, reason, data) {
    void amount; void reason; void data;
    return NO_RANK;
  };

  // cityRankEvent STILL FIRES on every kill — playergang.js wraps it to credit
  // gang-membership work (a body put in for the crew you ride with) — but it no
  // longer grants any STREET XP. Random violence (kills, cop kills, gang kills,
  // boss kills, armed marks, crashes, takeovers, turf, promotions) advances
  // NOTHING here; rank now comes from membership + completing gang tasks. We
  // keep the function defined and returning a stable object so wraps don't crash.
  CBZ.cityRankEvent = function (type, data) {
    data = data || {};
    // still tally boss kills (read elsewhere as a stat), just grant no XP for it.
    if (type === "kill" && data.boss) g.cityBossKills = (g.cityBossKills || 0) + 1;
    return NO_RANK;
  };

  function wrapAddKill() {
    if (!CBZ.city || !CBZ.city.addKill || CBZ.city._streetRankKillWrapped) return;
    const old = CBZ.city.addKill;
    CBZ.city.addKill = function () {
      const before = g.kills || 0;
      const r = old.apply(this, arguments);
      if ((g.kills || 0) > before) {
        const detail = g._cityKillDetail || {};
        g._cityKillDetail = null;
        if (CBZ.cityRankEvent) CBZ.cityRankEvent("kill", detail);
      }
      return r;
    };
    CBZ.city._streetRankKillWrapped = true;
  }
  wrapAddKill();

  CBZ.cityPromotionReset = function () {
    g.cityStreetXp = 0;
    g.cityStreetRankIdx = 0;
    g.cityBossKills = 0;
    g._cityKillDetail = null;
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
  };
})();
