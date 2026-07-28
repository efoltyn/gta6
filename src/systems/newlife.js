/* ============================================================
   systems/newlife.js — title-screen NEW LIFE / clear-save action.

   A city "save" has three durable layers:
     1. CBZ_CITY_WORLD_V2 — the active character/world ledger,
     2. CBZ_CITY_CHARS_V1 — every parked story character,
     3. sqlitedb's OPFS/kvvfs mirror — primary when localStorage is too small.

   Venue packages also own cbzPkg:* progression bags. A real fresh life clears
   all four, but deliberately preserves preferences (quality, population,
   controls/help), the local multiplayer identity, and prison/survival records.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const btn = document.getElementById("newLifeBtn");
  if (!CBZ || !CBZ.game || !btn) return;
  const g = CBZ.game;
  const idleHTML = btn.innerHTML;
  let busy = false;

  function clearLocalProgress() {
    const keys = ["CBZ_CITY_WORLD_V2", "CBZ_CITY_CHARS_V1"];
    try {
      const store = window.localStorage;
      if (!store) return;
      // Collect before removing: localStorage indices collapse after each
      // removeItem, which otherwise skips every other package bag.
      for (let i = 0; i < store.length; i++) {
        const key = store.key(i);
        if (key && key.indexOf("cbzPkg:") === 0) keys.push(key);
      }
      for (let i = 0; i < keys.length; i++) store.removeItem(keys[i]);
    } catch (e) {
      // SQLite may still be the primary. Its clear is attempted below; if this
      // browser denied all storage, a clean reload is already the only state.
    }
  }

  function clearMemory() {
    // Stop worldstate's five-second autosave before deleting anything, or a
    // title-screen update can write the just-cleared ledger straight back.
    g._citySaveBlocked = true;
    g.cityWorld = null;
    g.cityCampaign = null;
    g.cityCampaignPending = null;
    g.cityOriginPicked = false;
  }

  function fail(err) {
    busy = false;
    btn.disabled = false;
    btn.removeAttribute("aria-busy");
    btn.innerHTML = idleHTML;
    try { console.error("[new life] save clear failed", err); } catch (e) {}
    try { window.alert("The browser database could not be cleared. Please try New Life again."); } catch (e) {}
  }

  btn.addEventListener("click", function () {
    if (busy) return;
    let agreed = true;
    try {
      agreed = !window.confirm || window.confirm(
        "Start a completely new life?\n\n" +
        "This permanently clears every saved city character and city progression. " +
        "Graphics, controls, and non-city records will stay unchanged."
      );
    } catch (e) {}
    if (!agreed) return;

    busy = true;
    btn.disabled = true;
    btn.setAttribute("aria-busy", "true");
    btn.textContent = "CLEARING SAVE…";
    clearMemory();
    clearLocalProgress();

    let dbClear = null;
    try {
      dbClear = CBZ.sqlitedb && CBZ.sqlitedb.clearWorld
        ? CBZ.sqlitedb.clearWorld()
        : null;
    } catch (e) {
      fail(e);
      return;
    }
    Promise.resolve(dbClear).then(function () {
      btn.textContent = "STARTING FRESH…";
      window.location.reload();
    }, fail);
  });
})();
