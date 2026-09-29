/* ============================================================
   systems/glcontext.js — THE APP CAN BE INTERRUPTED.

   A browser tab is left alone. An app is not: iOS backgrounds it for a phone
   call, drops its WebGL context under memory pressure, and hands it back
   whenever it feels like it. Nothing in this engine had an opinion about any of
   that, and the two failures that follows are exactly the two that get an App
   Store build one-starred:

     1. THE BLACK SCREEN. WKWebView throws away the WebGL context when the app
        is backgrounded for long enough. three.js handles its own side (r128
        catches `webglcontextlost`, stops rendering, and rebuilds every GL
        resource on `webglcontextrestored`) — but nobody told the GAME. So the
        match kept running, blind and unrendered: a hundred survivors, eleven
        disasters and a drowning player, all advancing behind a black screen,
        and the player came back to a death they never saw.

     2. THE AMBUSH ON RETURN. Coming back from the home screen dropped you
        straight back into a live match, mid-tsunami, with no frame of warning.
        (The frame delta is already clamped in core/loop.js, so the sim does not
        JUMP — it just never stopped being deadly while you were in Messages.)

   THE RULE THIS FILE APPLIES: an interruption pauses the match, and only the
   player un-pauses it. Losing the context, losing the foreground and losing
   pointer lock are all the same event as far as a running match is concerned.

   WHAT IT OWNS
     · `webglcontextlost`     → preventDefault (without it the context is gone
                                for good, not restorable), pause, say so on screen
     · `webglcontextrestored` → clear the notice, stay paused, let the player back in
     · `visibilitychange`     → hidden pauses a live match; visible resumes the
                                audio graph, which iOS suspends with the app
     · a watchdog             → if a lost context has not come back after
                                RESTORE_WAIT seconds, ask for it
                                (renderer.forceContextRestore) instead of
                                sitting on a black screen forever

   Everything is feature-detected and every hook is a no-op with no renderer, so
   this file is inert on a tools page and harmless in a desktop browser that
   never loses anything. Revert: ?cfg_GL_CONTEXT_GUARD=0.
   Audit: CBZ.glContextAudit().
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  CBZ.CONFIG = CBZ.CONFIG || {};
  if (CBZ.CONFIG.GL_CONTEXT_GUARD == null) CBZ.CONFIG.GL_CONTEXT_GUARD = true;
  if (CBZ.CONFIG.GL_CONTEXT_GUARD === false) return;
  /* PAUSE_ON_HIDDEN is separate because it is a GAME DESIGN call, not a
     correctness one: a tools page that steps the sim with the tab in the
     background must not have its match paused underneath it. Tools set it
     false; the app leaves it on. */
  if (CBZ.CONFIG.PAUSE_ON_HIDDEN == null) CBZ.CONFIG.PAUSE_ON_HIDDEN = true;

  const RESTORE_WAIT = 4.0;        // seconds of black before we ask for it back
  const A = { lost: 0, restored: 0, forced: 0, hiddenPauses: 0, audioResumes: 0 };
  let contextLost = false, lostAt = 0, wasPlaying = false, bound = null;

  /* ---- the notice ---------------------------------------------------------
     Deliberately NOT a flashToast or a HUD panel: those live in the DOM the
     rest of the HUD lives in, and this has to be readable when the renderer
     has nothing to draw. One fixed element, its own text, no dependencies. */
  let notice = null;
  function say(msg) {
    if (!msg) { if (notice) notice.style.display = "none"; return; }
    if (!notice) {
      notice = document.createElement("div");
      notice.id = "glNotice";
      notice.style.cssText = "position:fixed; inset:auto 0 0 0; z-index:9999; margin:0 auto 22vh;" +
        "max-width:22em; padding:14px 18px; border-radius:12px; text-align:center;" +
        "background:rgba(9,14,24,.92); color:#e6ecf5; font:600 15px/1.35 Fredoka,system-ui,sans-serif;" +
        "box-shadow:0 10px 30px rgba(0,0,0,.5); pointer-events:none;";
      document.body.appendChild(notice);
    }
    notice.textContent = msg;
    notice.style.display = "block";
  }

  /* ---- pausing ------------------------------------------------------------
     Through CBZ.setState, so the pause SCREEN, the pointer-lock release and
     every listener that already watches game state all behave exactly as they
     do when the player presses Escape. Nothing here invents a second kind of
     paused. */
  function pauseForInterruption() {
    const g = CBZ.game;
    if (!g || g.state !== "playing") return false;
    wasPlaying = true;
    if (CBZ.setState) CBZ.setState("paused"); else g.state = "paused";
    return true;
  }

  /* ---- the canvas ---------------------------------------------------------
     Bound lazily: this file loads before core/renderer.js has made one on some
     pages, and a slice page may never make one at all. */
  function canvas() {
    const r = CBZ.renderer;
    return (r && r.domElement) || document.querySelector("#game canvas") || null;
  }

  function onLost(e) {
    /* WITHOUT THIS LINE THE CONTEXT NEVER COMES BACK. preventDefault on the
       lost event is what tells the browser a restore is wanted; three.js's own
       handler already calls it, and so does this one, because the order the two
       listeners run in is not ours to depend on. */
    if (e && e.preventDefault) e.preventDefault();
    if (contextLost) return;
    contextLost = true; lostAt = nowS(); asked = false; A.lost++;
    pauseForInterruption();
    say("Graphics interrupted — restoring…");
  }

  /* A geometry whose CPU arrays were dropped after upload (metro far tiles,
     facade cells) cannot be re-uploaded: three would throw on it every frame
     and the screen would stay navy even with the context back. Hide those and
     let their owners rebuild them. */
  function dropFreedGeometry() {
    if (CBZ.metroGpuLost) { try { CBZ.metroGpuLost(); } catch (e) {} }
    const S = CBZ.scene; if (!S) return 0;
    let n = 0;
    S.traverse(function (o) {
      const g = o.geometry; if (!g || !g.attributes) return;
      let freed = !!(g.index && !g.index.array);
      if (!freed) for (const k in g.attributes) { const a = g.attributes[k]; if (a && !a.array && !(a.data && a.data.array)) { freed = true; break; } }
      if (freed && o.visible) { o.visible = false; n++; }
    });
    A.freedHidden = (A.freedHidden || 0) + n;
    return n;
  }

  function onRestored() {
    contextLost = false; A.restored++;
    // the world's static surfaces gave their CPU copies away (core/
    // citystream.js): they cannot be re-uploaded, so come back by reload,
    // at the same spot, instead of with holes in the ground
    if (CBZ.freedStaticArrays) { reloadHere(); return; }
    dropFreedGeometry();
    say(wasPlaying ? "Ready. Tap to continue." : "");
    /* STAY PAUSED. The world is intact and three has rebuilt every GL resource,
       but the player has been looking at a black rectangle for some seconds and
       the island does not care. They come back when they say so. */
    setTimeout(function () { if (!contextLost) say(""); }, 2600);
  }

  function bind() {
    const c = canvas();
    if (!c || c === bound) return;
    bound = c;
    c.addEventListener("webglcontextlost", onLost, false);
    c.addEventListener("webglcontextrestored", onRestored, false);
  }

  /* ---- the late bind, on the always band (two comparisons a frame) ------- */
  if (CBZ.onAlways) CBZ.onAlways(28.06, function () { if (!bound) bind(); });

  /* ---- THE WATCHDOG RUNS ON A TIMER, NOT THE FRAME LOOP ---------------------
     Owner, 2026-09-29, on the phone: "when I drive the car ... the screen just
     goes to dark navy" (the page background through a canvas that stopped
     drawing). iOS drops the context under memory pressure and, when memory was
     the reason, often never hands it back. The old watchdog lived on the frame
     loop, so it could only ever ask once and then sat on the navy screen.
       · after RESTORE_WAIT s: ask for the context back (works when the loss was
         a forced one; harmless otherwise);
       · after GIVE_UP s: the context is not coming back. Commit the city
         character (lastPos included), leave a one-shot resume note, and reload:
         the page comes back into the same game at the same spot, instead of a
         dead screen. */
  const GIVE_UP = 9.0;
  let asked = false;
  function nowS() { return (typeof performance !== "undefined" ? performance.now() : Date.now()) / 1000; }
  setInterval(function () {
    if (!bound) bind();
    if (!contextLost) return;
    const t = nowS() - lostAt;
    if (t >= RESTORE_WAIT && !asked) {
      asked = true;
      const r = CBZ.renderer;
      if (r && typeof r.forceContextRestore === "function") { A.forced++; try { r.forceContextRestore(); } catch (e) {} }
    }
    if (t >= GIVE_UP) { contextLost = false; reloadHere(); }
  }, 1000);

  let reloading = false;
  function reloadHere() {
    if (reloading) return; reloading = true;
    say("Reloading where you were…");
    try { if (CBZ.game && CBZ.game.mode === "city" && CBZ.cityWorldCommit) CBZ.cityWorldCommit(); } catch (e) {}
    try { sessionStorage.setItem("cbz.resume", (CBZ.game && CBZ.game.mode) || ""); } catch (e) {}
    setTimeout(function () { try { location.reload(); } catch (e) {} }, 400);
  }

  /* ---- the resume after that reload: straight back into the game ---------- */
  (function resume() {
    let want = null;
    try { want = sessionStorage.getItem("cbz.resume"); if (want) sessionStorage.removeItem("cbz.resume"); } catch (e) { want = null; }
    if (!want) return;
    const t0 = Date.now();
    const poll = setInterval(function () {
      if (Date.now() - t0 > 60000) { clearInterval(poll); return; }
      const g = CBZ.game, play = document.getElementById("playBtn");
      if (!CBZ.bootComplete || !g || g.state !== "title" || !play) return;
      clearInterval(poll);
      if (g.mode !== want && CBZ.setMode) { try { CBZ.setMode(want); } catch (e) {} }
      play.click();
    }, 250);
  })();

  /* ---- the foreground ----------------------------------------------------- */
  if (typeof document !== "undefined" && document.addEventListener) {
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) {
        if (CBZ.CONFIG.PAUSE_ON_HIDDEN !== false && pauseForInterruption()) A.hiddenPauses++;
        return;
      }
      /* iOS suspends the WebAudio graph with the app. systems/audio.js resumes
         on the next sound it plays, which is a frame too late and only if a
         sound happens — so resume it here, on the way back in. */
      const ctx = CBZ.getAudioCtx ? CBZ.getAudioCtx() : null;
      if (ctx && ctx.state === "suspended" && ctx.resume) {
        A.audioResumes++;
        try { ctx.resume(); } catch (e) {}
      }
    });
  }

  CBZ.glContextAudit = function () {
    return {
      bound: !!bound, lost: contextLost,
      lostCount: A.lost, restoredCount: A.restored, forcedRestores: A.forced,
      hiddenPauses: A.hiddenPauses, audioResumes: A.audioResumes,
      pauseOnHidden: CBZ.CONFIG.PAUSE_ON_HIDDEN !== false,
    };
  };
})();
