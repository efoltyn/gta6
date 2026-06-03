/* ============================================================
   core/loop.js — the master frame loop. Sorts the registered
   updaters/always-runners by order and drives them each frame.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const g = CBZ.game;

  // sort once so update order is deterministic
  CBZ.updaters.sort((a, b) => a.order - b.order);
  CBZ.always.sort((a, b) => a.order - b.order);

  let last = performance.now();
  let lastTimer = "";   // cache so the timer DOM only writes when it changes

  // HIT-STOP: brief near-freeze on impact for weight (the #1 juice trick).
  // SLOW-MO: a longer, gentler dilation used for execution/finisher moves.
  CBZ.hitstop = 0; CBZ.slowmo = 0;
  CBZ.doHitstop = function (s) { CBZ.hitstop = Math.max(CBZ.hitstop, s); };
  CBZ.doSlowmo = function (s) { CBZ.slowmo = Math.max(CBZ.slowmo, s); };

  function loop(t) {
    CBZ.now = t;
    let dt = (t - last) / 1000;
    last = t;
    dt = Math.min(dt, 0.05); // clamp big tab-switch gaps

    CBZ.sampleFPS(dt);

    // time dilation: hit-stop wins, then slow-mo. Timers tick in real time.
    let scale = 1;
    if (CBZ.hitstop > 0) { CBZ.hitstop -= dt; scale = 0.06; }
    else if (CBZ.slowmo > 0) { CBZ.slowmo -= dt; scale = 0.32; }
    dt *= scale;

    // updaters are wrapped so a single throw can NEVER freeze the loop
    if (g.state === "playing") {
      g.elapsed += dt;
      for (const u of CBZ.updaters) {
        try { u.fn(dt); } catch (err) { console.error("[updater]", err); }
      }
      // write the timer only when the displayed string changes (once/second),
      // not every frame — a per-frame textContent write forces a layout.
      const ts = CBZ.fmtTime(g.elapsed);
      if (ts !== lastTimer) { CBZ.el.timer.textContent = ts; lastTimer = ts; }
    }

    for (const a of CBZ.always) {
      try { a.fn(dt); } catch (err) { console.error("[always]", err); }
    }

    CBZ.renderer.render(CBZ.scene, CBZ.camera);
    requestAnimationFrame(loop);
  }

  CBZ.startLoop = function () { requestAnimationFrame(loop); };
})();
