/* ============================================================
   systems/save.js — persists run stats to localStorage: total
   escapes and your best (fastest) escape time. Shown on the title.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const KEY = "cellblockz_stats";

  function load() {
    try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; }
  }
  function save(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) {} }

  let stats = load();

  function refreshTitle() {
    const el = document.getElementById("bestStat");
    if (!el) return;
    if (!stats.escapes) { el.textContent = ""; return; }
    el.textContent = `Escapes: ${stats.escapes}  ·  Best: ${stats.best ? CBZ.fmtTime(stats.best) : "--"}`;
  }

  // called from systems/state.js winGame()
  CBZ.recordWin = function () {
    stats.escapes = (stats.escapes || 0) + 1;
    const t = CBZ.game.elapsed;
    if (!stats.best || t < stats.best) stats.best = t;
    save(stats);
    refreshTitle();
  };

  refreshTitle();
})();
