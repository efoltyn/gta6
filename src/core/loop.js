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

  // ---- FEEL-DT (the slow-motion-under-load fix) ---------------------------
  // The heavy WORLD sim uses one bounded delta (never a catch-up loop). The
  // former 0.05 ceiling made the entire jail run at 25% time at 5fps and split
  // it from the player/camera clock. A 0.10 ceiling remains stable without
  // multiplying callback work, while keeping world and feel motion aligned on
  // genuinely slow frames.
  //
  // The fix is NOT to sub-step the world (multiplying the 27ms sim by 4
  // would spiral the weak Mac). Instead we publish a SECOND, real-wall-clock
  // delta — CBZ.feelDt — clamped to a modest FEEL_MAX so only the present
  // path (player movement/gravity, camera follow, owned projectiles) can
  // catch up to real time. It is a single bounded value, NOT a loop, so it
  // adds zero spiral risk; FEEL_MAX caps tunnelling for the collider path.
  //
  // CONTRACT for consumers (physics.js player, camera.js, projectiles):
  //   const fdt = (CBZ.feelDt != null ? CBZ.feelDt : dt);
  // — i.e. read feelDt when present, else fall back to the passed dt. That
  // makes every consumer safe whether or not this code ran first, and makes
  // the whole feature reversible:
  //   • CBZ.feelMotion === false  → feelDt is set to the SAME clamped world
  //     dt, so consumers behave EXACTLY as today (graceful off).
  //   • this module not yet loaded → feelDt is undefined → consumers fall
  //     back to dt (exactly as today).
  // MP-SAFE: feelDt is a per-client LOCAL present value derived from this
  // client's own rAF. Nothing is networked as a timestep — every client
  // runs the same logic for its OWN avatar (authoritative), puppet interp
  // (networld INTERP_MS) is wall-clock and untouched. No net hook lives here.
  // The player path SUB-STEPS its own collision (physics.js feelSubsteps slices
  // each move to ≤0.35m and resolves every slice), so the cap no longer has to
  // stay tiny to avoid tunnelling — it only bounds worst-case present travel.
  // CITY gets the larger 0.12: at ~5fps the player/camera advance 0.12s of motion
  // per 0.2s wall-clock (60% real-time) instead of 50%, so the owner-reported
  // "ultra slow" wade is lighter. JAIL/SURVIVAL keep the ORIGINAL 0.10 verbatim so
  // those modes stay byte-identical (only the open-city path may change). OFF
  // (feelMotion===false) → feelDt = world dt = unchanged in every mode.
  const WORLD_MAX = 0.10;
  const FEEL_MAX_CITY = 0.12, FEEL_MAX_OTHER = 0.10;
  if (CBZ.feelMotion === undefined) CBZ.feelMotion = true;  // default ON;
                          // honour an owner-set value (don't clobber a toggle)

  function loop(t) {
    CBZ.now = t;
    let dt = (t - last) / 1000;
    let realDt = Math.max(0, dt); // untouched wall-clock delta (pre-clamp)
    last = t;
    dt = Math.min(realDt, WORLD_MAX); // bounded single-step world delta
    CBZ.wallDt = Math.min(realDt, 0.25);
    if (g.state === "playing") CBZ.droppedWorldTime = (CBZ.droppedWorldTime || 0) + Math.max(0, realDt - dt);

    CBZ.sampleFPS(CBZ.wallDt);

    // time dilation: hit-stop wins, then slow-mo. Timers tick in real time.
    let scale = 1;
    // Effect duration is wall time. The old capped decrement stretched a 0.5s
    // finisher to ~2s at 5fps and could make jail appear stuck in slow motion.
    if (CBZ.hitstop > 0) { CBZ.hitstop = Math.max(0, CBZ.hitstop - realDt); scale = 0.06; }
    else if (CBZ.slowmo > 0) { CBZ.slowmo = Math.max(0, CBZ.slowmo - realDt); scale = 0.32; }
    dt *= scale;

    // FEEL-DT: a real-wall-clock delta for the present path. Clamp to its own
    // (larger) FEEL_MAX, then apply the SAME hit-stop/slow-mo scale as the
    // world so a blast still reads as weight on the player/camera too. When
    // the flag is off we publish the world's `dt` verbatim → today's behaviour.
    const FEEL_MAX = (g.mode === "city") ? FEEL_MAX_CITY : FEEL_MAX_OTHER;
    CBZ.feelDt = CBZ.feelMotion
      ? Math.min(realDt, FEEL_MAX) * scale
      : dt;

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
