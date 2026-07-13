/* ============================================================
   city/story.js

   Retired storyline milestone layer. The old chapter arc created an
   always-on objective bar and rewarded generic checklist beats that no
   longer match the city simulation.

   Keep the public hooks because careers/turf modules call them, but do
   not create HUD, scan milestones, or print fake objectives.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.game) return;
  const g = CBZ.game;

  function inertStory() {
    return { chapter: 0, done: {}, idx: 0, retired: true };
  }

  function ensure() {
    if (!g.cityStory || !g.cityStory.retired) g.cityStory = inertStory();
    return g.cityStory;
  }

  CBZ.cityStoryEnsure = ensure;

  CBZ.cityStoryReset = function () {
    g.cityStory = inertStory();
    g.cityWon = false;
  };

  CBZ.cityStoryChapter = function () {
    return { idx: 0, name: "" };
  };

  // WIN CONDITION: turf.js calls this once the player owns the map.
  CBZ.cityWin = function (how) {
    if (g.cityWon) return;
    g.cityWon = true;
    // The material rewards land unconditionally, up front.
    const tribute = 50000;
    if (CBZ.city && CBZ.city.addCash) CBZ.city.addCash(tribute);
    if (CBZ.city && CBZ.city.addRespect) CBZ.city.addRespect(150);
    if (CBZ.city && CBZ.city.note) CBZ.city.note("Every block flies your colors. +$" + tribute.toLocaleString() + " tribute, +150 respect.", 6);
    if (CBZ.cityEvent) {
      try { CBZ.cityEvent("story", { label: "TOOK THE CITY (" + (how || "takeover") + ")" }, { silent: true }); } catch (e) {}
    }
    // Campaign-aware ceremony: while the hitman campaign runs, city.big() is a
    // silent phone bulletin, which buried the entire gang-game ending. The
    // campaign owns the presentation instead — a full-screen CITY BOSS moment,
    // deferred past any scripted beat (campaign.js cityCampaignTakeover). The
    // legacy slow-mo + big-text path stays for campaign-off saves.
    if (CBZ.cityCampaignTakeover) {
      let handled = false;
      try { handled = !!CBZ.cityCampaignTakeover(how); } catch (e) { handled = false; }
      if (handled) { if (CBZ.cityHudDirty) CBZ.cityHudDirty(); return; }
    }
    if (CBZ.doSlowmo) { try { CBZ.doSlowmo(0.45); } catch (e) {} }
    if (CBZ.city && CBZ.city.big) CBZ.city.big("YOU OWN THE CITY");
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
  };
})();
