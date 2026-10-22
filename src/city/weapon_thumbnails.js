/* ============================================================
   city/weapon_thumbnails.js — the weapon-slot and torch faces.

   This file used to run its OWN offscreen WebGL context (a second one beside
   city/itemicons.js's) and paid a synchronous toDataURL per model on the path
   that asked. Both now go through the one icon studio (CBZ.iconStudio in
   city/itemicons.js): the same camera and lamps, photographed in idle time,
   "" until the photograph lands (the hotbar repaints on CBZ.itemIconVersion).
   Seams are resolved at call time, so load order between the two files does
   not matter.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  CBZ.weaponThumbnail = function (id) {
    id = String(id || "sidearm").toLowerCase();
    return CBZ.itemIconGun ? CBZ.itemIconGun(id) || "" : "";
  };
  CBZ.flashlightThumbnail = function () {
    const S = CBZ.iconStudio;
    if (!S || !CBZ.buildFlashlight) return "";
    return S.photo("guard-torch", function () { return CBZ.buildFlashlight({ lit: false }); });
  };
  CBZ.weaponThumbnailInvalidate = function (id) {
    if (CBZ.iconStudio) CBZ.iconStudio.forget(id == null ? null : "guard-torch");
  };
})();
