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
    /* WHO OWNS THE CLOCK. Under the variable step, CBZ.now IS the rAF
       timestamp — unchanged, and right for a single player. Under the fixed
       step it is advanced one whole tick at a time down in the update block,
       so that every client's cooldowns and phases move by the same amount per
       tick instead of by however long that machine's last frame took. */
    const fixed = (CBZ.fixedStep && CBZ.fixedStep.on()) ? CBZ.fixedStep : null;
    if (!fixed) CBZ.now = t;
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

    // MATRIX-HOLD FRAME COUNTER: systems that provably left a subtree's world
    // matrices correct this frame (pedinstance's rig walk, vehicles' strided
    // far cars) stamp the subtree root with this value and core/matrixskip.js
    // skips recomposing it. Bumped here so a stamp is only ever good for ONE
    // frame — any system that stops stamping hands its subtrees straight back.
    CBZ._matrixOwnStamp = (CBZ._matrixOwnStamp || 0) + 1;
    /* THE FIXED STEP (systems/fixedstep.js, survival only by default).

       Everything above measures TIME, which is right for one player on one
       machine and is the reason two machines can never run the same match: a
       phone at 47 fps and a laptop at 60 take different numbers of steps of
       different sizes through the same second, and their integrations drift
       apart within seconds of an identical seed. When the fixed step is on,
       the frame's real delta goes into an accumulator and whole 1/60 ticks
       come out — so tick N means the same world state everywhere.

       The variable path below is untouched and is still what the city and the
       prison run. FIXED_STEP_V1=false puts survival back on it too, live. */
    // updaters are wrapped so a single throw can NEVER freeze the loop
    if (g.state === "playing" && fixed) {
      const n = fixed.consume(realDt);
      const step = 1 / fixed.hz();
      const fdt = step * scale;
      for (let k = 0; k < n; k++) {
        if (k) CBZ._matrixOwnStamp++;      // each tick is its own frame to the skip cache
        g.elapsed += fdt;
        fixed.tick++;
        CBZ.survNetTick = fixed.tick;      // what a snapshot is stamped with
        /* THE CLOCK ADVANCES BY THE TICK, NOT BY THE WALL. CBZ.now was the rAF
           timestamp, so every cooldown and phase in the game moved by however
           long the last frame happened to take — the same drift the step itself
           was fixed to remove, one level down. It stays MONOTONIC (it advances
           from wherever it already was, never jumps back, so nothing holding a
           deadline sees time reverse); what is now identical between clients is
           the INCREMENT, which is what a deadline is measured in. */
        CBZ.now += step * 1000;
        for (const u of CBZ.updaters) {
          try { u.fn(fdt); } catch (err) { console.error("[updater]", err); }
        }
      }
      const ts0 = CBZ.fmtTime(g.elapsed);
      if (ts0 !== lastTimer) { CBZ.el.timer.textContent = ts0; lastTimer = ts0; }
    } else if (g.state === "playing") {
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

    /* ---- THE ONE DRAW, AND THE ONE WAY TO TURN IT OFF -------------------
       RENDER_FRAMES=false (?cfg_RENDER_FRAMES=0) runs the whole game with no
       draw call: same updater chain, same always chain, same clock, nothing
       handed to the rasterizer.

       WHY THIS EXISTS. Measured with tools/boot-trace.mjs, which beacons every
       boot checkpoint out through the browser process so a frozen main thread
       can still be watched: Gang City's CPU build is ~30 s and completes
       cleanly. What made the mode untestable headless is everything AFTER it —
       the first frames, where three.js compiles a program per material the
       first time it is drawn, across a 25 km scene, on a software rasterizer.
       Prison Escape builds in ~1 s and then draws steadily at ~3 fps on the
       same box, which is exactly why every gate aimed at that mode works and
       the Gang City ones time out. This switch removes the drawing from any
       tool that does not actually need pixels.

       WHO SHOULD USE IT: every headless gate that asserts on WORLD STATE —
       counts, records, positions, audits.
       WHO SHOULD NOT: anything that photographs the game. Those want frames
       and should pay for them — or call CBZ.renderFrame() to draw exactly
       one, which is the supported way to take a picture from a page booted
       with drawing off. */
    const drawing = !CBZ.CONFIG || CBZ.CONFIG.RENDER_FRAMES !== false;
    if (drawing) CBZ.renderer.render(CBZ.scene, CBZ.camera);
    schedule();
  }

  /* ---- WHAT PUMPS THE LOOP, AND WHY IT IS NOT ALWAYS rAF ------------------
     MEASURED THE HARD WAY. The first version of the no-draw switch above kept
     `requestAnimationFrame(loop)` as the pump and the game stopped dead: the
     boot trace showed the build finishing in 27.5 s and then TWO loop passes
     in the next five minutes. requestAnimationFrame is not a timer — the
     browser schedules it against frame PRODUCTION, and a page that never
     draws anything gives the compositor no reason to produce a frame, so the
     callbacks simply stop arriving. Turning the renderer off had turned the
     clock off with it, which looks identical from the outside to the hang it
     was meant to cure.

     So the pump follows the drawing: rAF while there are frames (correct for
     players — vsync-aligned, throttled in background tabs), a timer when
     there are not. `performance.now()` is passed by hand because rAF supplies
     the timestamp and setTimeout does not; without it `t` is undefined and
     every dt in the engine becomes NaN. */
  function schedule() {
    if (!CBZ.CONFIG || CBZ.CONFIG.RENDER_FRAMES !== false) { requestAnimationFrame(loop); return; }
    setTimeout(function () { loop(performance.now()); }, 0);
  }

  // Draw exactly one frame, whatever RENDER_FRAMES says. The seam a probe or
  // a screenshot tool uses on a page that is otherwise not drawing.
  CBZ.renderFrame = function () {
    try { CBZ.renderer.render(CBZ.scene, CBZ.camera); return true; }
    catch (e) { console.error("[renderFrame]", e); return false; }
  };

  CBZ.startLoop = function () { schedule(); };

  // ---- HEADLESS SIM STEP (tools only — inert in normal play) --------------
  // Drives ONE update tick with a fixed dt and NO render: the whole updater +
  // always chain runs exactly like loop() (same order, same per-updater
  // try/catch so a throw surfaces as a console error without killing the
  // burst), but nothing touches the renderer. This is what lets the math
  // gate step thousands of sim ticks in seconds of CPU instead of waiting on
  // software-rasterized frames — update-path crashes surface at full speed.
  // CBZ.now advances synthetically so time-stamped systems (cooldowns,
  // phases) actually progress across a burst.
  CBZ.stepSim = function (dt) {
    dt = dt || 1 / 60;
    CBZ._matrixOwnStamp = (CBZ._matrixOwnStamp || 0) + 1;   // same contract as loop()
    CBZ.now = (CBZ.now || performance.now()) + dt * 1000;
    CBZ.wallDt = dt;
    let scale = 1;
    if (CBZ.hitstop > 0) { CBZ.hitstop = Math.max(0, CBZ.hitstop - dt); scale = 0.06; }
    else if (CBZ.slowmo > 0) { CBZ.slowmo = Math.max(0, CBZ.slowmo - dt); scale = 0.32; }
    const sdt = Math.min(dt, WORLD_MAX) * scale;
    CBZ.feelDt = CBZ.feelMotion ? Math.min(dt, (g.mode === "city") ? FEEL_MAX_CITY : FEEL_MAX_OTHER) * scale : sdt;
    if (g.state === "playing") {
      g.elapsed += sdt;
      if (CBZ.fixedStep) { CBZ.fixedStep.tick++; CBZ.survNetTick = CBZ.fixedStep.tick; }
      for (const u of CBZ.updaters) {
        try { u.fn(sdt); } catch (err) { console.error("[updater]", err); }
      }
    }
    for (const a of CBZ.always) {
      try { a.fn(sdt); } catch (err) { console.error("[always]", err); }
    }
  };
})();
