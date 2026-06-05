/* ============================================================
   city/killfeed.js — central DEATH event bus + a Fortnite-style kill feed.

   Every death in the city (the player, a named ped, an ambient-crowd body)
   funnels through here with an ACCURATE cause ("airstrike", "car crash",
   "murder", "gunfire", "fall", "explosion", "police", ...) and the victim's
   real name, so the HUD can show "Dave Smith — airstrike". It works by
   wrapping the existing kill functions (cityKillPed / cityCrowdKill) + the
   player-death path rather than editing every kill site.

   (Filled by the killfeed agent. Stub keeps boot order + the public array
   stable so the HUD can read it regardless.)
   ============================================================ */
(function () {
  const CBZ = window.CBZ;
  if (!CBZ) return;
  CBZ.cityRecentDeaths = CBZ.cityRecentDeaths || []; // [{name, cause, t, you?}]
})();
