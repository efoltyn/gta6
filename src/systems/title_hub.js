/* ============================================================
   systems/title_hub.js — the front door's flow: in fast, out clean,
   and it remembers where you were.

   1. REMEMBERS. The game you last PLAYED (not merely clicked) is written
      to localStorage under "cbz.hub.last". src/config.js reads it at boot,
      so the menu reopens on that game and it is one tap from PLAY. The
      three games that live on their own pages (NPC War, Desert Warlord,
      Bomb Survivor) are recorded when their tile is pressed, and their
      tile wears the LAST PLAYED tag when you come back.
   2. WAY OUT. #pauseMenuBtn (pause card) and #escEndMenu (the prison's
      end screen) return to the menu. Before this the only road from a
      running game to any other game was reloading the page. PLAY from the
      menu is a normal start (startRunPresented resets the run), exactly
      what the disaster result cards' Main Menu has always done.
   3. ENTER PLAYS on the menu when nothing is focused.
   4. HERO SWAP. Picking a tile fades the new game's key art in instead of
      cutting to it (css/title_hub.css .hub-swap).
   5. PAUSE BUTTON. The one touch pause (#hudPauseBtn), top-left, in every
      game on this page. See the block at the bottom.

   Every hook is by id; nothing here moves DOM that other code addresses.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const g = CBZ.game;
  const KEY = "cbz.hub.last";

  function save(id) { try { if (id) localStorage.setItem(KEY, id); } catch (e) {} }
  function load() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }

  const title = document.getElementById("title");
  const rail = document.getElementById("modeSelect");

  function markLast() {
    if (!rail) return;
    const last = load();
    rail.querySelectorAll(".mode-btn").forEach((b) => b.classList.toggle("is-last", !!last && b.dataset.mode === last));
  }
  CBZ.titleHubLast = load;

  // PLAY — capture phase, so the record is written before startRun takes the
  // thread for a 30 s city build. state.js binds both click and pointerup.
  const play = document.getElementById("playBtn");
  if (play) {
    const rec = () => { if (g.state === "title") save(g.mode); };
    play.addEventListener("click", rec, true);
    play.addEventListener("pointerup", rec, true);
  }

  if (rail) {
    rail.addEventListener("click", (e) => {
      const b = e.target.closest ? e.target.closest(".mode-btn") : null;
      if (!b) return;
      // a launcher navigates away in state.js's own click handler; record first
      if (b.dataset.href) { save(b.dataset.mode); return; }
      // The tile that is ALREADY selected does nothing. Without this, tapping
      // the lit Gang Life tile ran setMode("city") again, and an unbuilt city
      // answers that with a 30 s world build behind the boot meter.
      if (b.dataset.mode === g.mode) { e.stopPropagation(); return; }
      if (!title) return;
      title.classList.remove("hub-swap");
      void title.offsetWidth;            // restart the fade
      title.classList.add("hub-swap");
    }, true);
  }
  markLast();

  // ENTER PLAYS. On the menu with nothing focused (a focused button already
  // activates itself on Enter), Enter is PLAY: remembered game, one key.
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.repeat || g.state !== "title") return;
    if (!title || title.classList.contains("hidden")) return;
    const a = document.activeElement;
    if (a && a !== document.body && /^(BUTTON|INPUT|TEXTAREA|SELECT|SUMMARY|A)$/.test(a.tagName)) return;
    if (play) { e.preventDefault(); play.click(); }
  });

  function toMenu(e) {
    if (e && e.preventDefault) e.preventDefault();
    if (!CBZ.setState) return;
    if (CBZ.settingsOpen) return;
    CBZ.setState("title");
    markLast();
  }
  ["pauseMenuBtn", "escEndMenu"].forEach((id) => {
    const b = document.getElementById(id);
    if (b) b.addEventListener("click", toMenu);
  });
  // the disaster result cards already had Main Menu; keep the tag fresh there too
  ["survMenuBtn", "loseMenuBtn"].forEach((id) => {
    const b = document.getElementById(id);
    if (b) b.addEventListener("click", markLast);
  });

  /* 5. THE PAUSE BUTTON. ONE button for every game on this page (Gang Life,
     prison, Survival, Gun Game, Shark Sim, and every city sub-mode), in ONE
     place: the TOP-LEFT corner, 12 px in, clear of the notch. It opens the
     ONE pause card above (#pause: Resume, Settings, Main Menu, plus whatever
     a mode slots in, like Shark Sim's Restart).

     Before this only Shark Sim had a touch pause (its own #sharkPauseBtn),
     the prison hid one inside the Plan panel, and Gang Life, Survival and
     Gun Game had none: on a phone they could not be stopped at all. Every
     mode's top-left HUD now starts BELOW or BESIDE this button (the jail
     minimap at top:64, the city radar moved to top:64 in css/mobile.css,
     the prison Plan chip and Gun Game's health plate step right of it).

     Touch only: a keyboard pauses with Esc, and on desktop the cursor is
     locked while playing, so a button there could never be clicked. The
     pause itself is setState("paused"), the same one Esc and the gamepad's
     START use, so each mode's freeze (core/loop.js's playing gate, audio,
     Shark Sim's clock) happens exactly as it always did. No pointer lock is
     touched here: on touch there is none, so nothing joins camera.js's
     exemption list. */
  function pauseGame() {
    if (g.state !== "playing" || !CBZ.setState) return false;
    if (CBZ.settingsOpen) return false;
    // a death / arrest cinematic owns the screen; camera.js's pointer-lock
    // pause skips these for the same reason
    if (g.busted || (CBZ.cityCam && CBZ.cityCam.death)) return false;
    if (g.mode === "city" && CBZ.player && CBZ.player.dead) return false;
    if (CBZ.surv && CBZ.surv.spectating) return false;
    CBZ.setState("paused");
    return true;
  }
  CBZ.pauseGame = pauseGame;

  function buildPauseBtn() {
    if (document.getElementById("hudPauseBtn")) return;
    const b = document.createElement("button");
    b.type = "button";
    b.id = "hudPauseBtn";
    b.setAttribute("aria-label", "Pause");
    b.innerHTML = "<i></i><i></i>";
    const go = function (e) {
      if (e) { e.preventDefault(); e.stopPropagation(); }
      pauseGame();
    };
    // touchstart, not click: touch.js owns window-level touches for the stick
    // and a click would arrive ~300 ms late (or never, after preventDefault)
    b.addEventListener("touchstart", go, { passive: false });
    b.addEventListener("click", go);
    document.body.appendChild(b);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", buildPauseBtn);
  else buildPauseBtn();
})();
