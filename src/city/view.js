/* ============================================================
   city/view.js — the CITY view controller. First-person by DEFAULT
   (camera.js reads CBZ.cityCam), a [V] toggle to third-person, and the
   rig-visibility rule that fixes "seeing inside your own face": in
   first-person the whole player rig is hidden, so the camera never sits
   inside the head mesh. On death the camera flips to a third-person
   cinematic orbit (CBZ.cityCam.death, set by city/death.js).

   Also owns THE CITY AT NIGHT pass: at dusk every storefront sign, neon
   trim, window band and lit interior gets ONE emissive lift (and ONE
   restore at dawn) — a flip on a threshold, never per-frame material
   churn. WHY: night is when money shows off — lit glass and neon are the
   skyline's scoreboard, so the rich blocks must visibly switch ON.
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

  // ===================================================================
  //  THE CITY AT NIGHT — dusk/dawn EMISSIVE FLIP for the built city.
  //  core/daynight.js publishes CBZ.nightAmount (0 day → 1 deep night);
  //  when it crosses dusk we lift the emissive intensity of every lit
  //  building material ONCE (shop signs, neon trim, awning bands, the
  //  shared window glass, interior light fixtures) and restore the day
  //  values at dawn. Billboards/ad panels are NOT touched here — they
  //  already ride props.js's _nightAds ramp (m._ad guard below); shared
  //  cross-mode cmat() materials (m._shared) are skipped so the jail
  //  never inherits the city's night look. Collection is one traversal
  //  of the building groups, done lazily on the FIRST dusk.
  // ===================================================================
  let nightMats = null, nightOn = false, lastArena = null;
  function collectNightMats(A) {
    const set = new Set();
    const lots = (A.lots || []).slice();
    if (A.annex && A.annex.lots) lots.push.apply(lots, A.annex.lots);
    for (const lot of lots) {
      const b = lot.building;
      if (!b || !b.group) continue;
      b.group.traverse(function (o) {
        const m = o.material;
        if (!m || !m.emissive || m._ad || m._shared) return;
        if (m.emissiveIntensity > 0.05 && (m.emissive.r + m.emissive.g + m.emissive.b) > 0.02) {
          if (m._dayEi == null) m._dayEi = m.emissiveIntensity;   // remember the day look once
          set.add(m);
        }
      });
    }
    return set;
  }
  CBZ.onAlways(48, function () {
    const A = CBZ.city && CBZ.city.arena;
    if (g.mode !== "city" || !A) {
      // leaving the city un-flips, so no material carries night elsewhere
      if (nightOn && nightMats) { for (const m of nightMats) m.emissiveIntensity = m._dayEi; nightOn = false; }
      return;
    }
    if (A !== lastArena) { lastArena = A; nightMats = null; nightOn = false; }   // fresh build → recollect
    const n = CBZ.nightAmount == null ? 0 : CBZ.nightAmount;
    const want = nightOn ? n > 0.45 : n > 0.6;     // hysteresis — no thrash at the threshold
    if (want === nightOn) return;
    if (!nightMats) nightMats = collectNightMats(A);
    // windows go from "tinted" to LIT, neon goes hot; capped so nothing blows out
    for (const m of nightMats) m.emissiveIntensity = want ? Math.min(1.45, m._dayEi + 0.5) : m._dayEi;
    nightOn = want;
  });
})();
