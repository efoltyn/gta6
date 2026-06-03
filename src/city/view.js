/* ============================================================
   city/view.js — the CITY view controller. First-person by DEFAULT
   (camera.js reads CBZ.cityCam), a [V] toggle to third-person, and the
   rig-visibility rule that fixes "seeing inside your own face": in
   first-person the whole player rig is hidden, so the camera never sits
   inside the head mesh. On death the camera flips to a third-person
   cinematic orbit (CBZ.cityCam.death, set by city/death.js).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const g = CBZ.game;

  // DEFAULT to third-person — the jail's SmoothDamp follow camera is the good
  // one, and camera.js runs that exact rig for the city when fp is off. [V]
  // toggles first-person.
  CBZ.cityCam = CBZ.cityCam || { fp: false, death: null };

  addEventListener("keydown", function (e) {
    if (g.mode !== "city" || g.state !== "playing") return;
    if (CBZ.cityMenuOpen) return;
    if (e.key.toLowerCase() === "v" && !e.repeat) {
      e.preventDefault();
      if (CBZ.player.driving) return;                    // can't go first-person mid-drive
      // Use the JAIL's real first-person system (systems/fpsmode.js) — the good
      // one: eye height 2.05, head-bob, full-range pitch, weapon viewmodel. The
      // old custom city FP camera (cam.pitch, eye 1.66) felt broken.
      if (CBZ.toggleFPS) CBZ.toggleFPS();
      CBZ.city && CBZ.city.note((CBZ.fps && CBZ.fps.active) ? "First-person" : "Third-person", 1.0);
    }
  });

  // own the player rig's visibility every frame (after movement @10, before the
  // camera @50). Hidden in first-person (fpsmode shows a viewmodel instead);
  // shown for 3rd-person + the death replay. FP is force-dropped when you get in
  // a car or die so fpsmode never fights the driving / death cameras.
  CBZ.onAlways(49, function () {
    if (g.mode !== "city") return;
    const cc = CBZ.cityCam, P = CBZ.player, ch = CBZ.playerChar;
    if (!ch || !ch.group) return;
    const fpsOn = !!(CBZ.fps && CBZ.fps.active);
    if (P.driving) { if (fpsOn && CBZ.setFPS) CBZ.setFPS(false); return; }       // car owns visibility
    if ((cc && cc.death) || P.dead) { if (fpsOn && CBZ.setFPS) CBZ.setFPS(false); ch.group.visible = true; return; }
    ch.group.visible = !fpsOn;             // FP → hidden body (no face-clip)
  });
})();
