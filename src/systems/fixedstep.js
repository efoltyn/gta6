/* ============================================================
   systems/fixedstep.js — THE SIM ADVANCES IN WHOLE TICKS.

   core/loop.js measures TIME: it takes the wall-clock delta between two
   animation frames, clamps it to 100 ms, and hands that number to every
   updater. For one player on one machine that is exactly right, and it is why
   this game feels the same at 144 fps and at 40.

   It is also the single reason two machines can never run the same match. A
   phone at 47 fps and a laptop at 60 take different numbers of steps of
   different sizes through the same second, so their integrations drift apart
   within a few seconds even from an identical seed — a hundred bots making
   slightly different decisions, a wave breaking a metre further up the beach,
   two players who each think the other is standing somewhere else. Every
   multiplayer design in existence — lockstep, rollback, server-authoritative
   with client prediction — assumes a tick that means the same thing on both
   ends. This file is that tick.

   HOW IT WORKS, and it is the oldest trick in the book (Fiedler's "Fix Your
   Timestep", 2004): the frame delta goes into an accumulator, and whole STEPs
   come out. A 16.7 ms frame runs one step. A 33 ms frame runs two. A 9 ms
   frame runs none and keeps the time for next frame. The sim only ever sees
   1/60 of a second, so the same tick number means the same world state on
   every machine that started from the same seed.

   THE SPIRAL OF DEATH is the one way this bites, and it is guarded: if a frame
   took long enough to owe six steps, running six makes the next frame slower
   still, which owes more. MAX_STEPS caps what one frame may run and the
   remainder is DROPPED (counted in `dropped`, so the cost is visible rather
   than mysterious) — the match runs slow for a moment instead of locking up.

   WHAT THIS IS NOT: it is not multiplayer, and it is not determinism on its
   own. Same tick count plus an unseeded Math.random still diverges — that is
   core/seed.js's law, and tools/determinism-check.mjs is what measures whether
   the two together actually hold. This file only removes the timing half of
   the problem.

   SCOPE: survival only, by default. The city and the prison are single-player
   worlds whose feel was tuned against the variable step, and changing how they
   integrate to buy a property they do not use would be a bad trade.

   Flags: FIXED_STEP_V1 = false → core/loop.js's original variable step
   everywhere (one line, and the loop reads it every frame so it can be flipped
   live). FIXED_STEP_MODES lists the modes it applies to. FIXED_STEP_HZ sets the
   rate. Audit: CBZ.fixedStepAudit().
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const C = (CBZ.CONFIG = CBZ.CONFIG || {});
  if (C.FIXED_STEP_V1 == null) C.FIXED_STEP_V1 = true;
  if (C.FIXED_STEP_HZ == null) C.FIXED_STEP_HZ = 60;
  if (C.FIXED_STEP_MODES == null) C.FIXED_STEP_MODES = "survival";
  if (C.FIXED_STEP_MAX == null) C.FIXED_STEP_MAX = 4;      // steps one frame may run

  const A = { steps: 0, frames: 0, dropped: 0, maxInFrame: 0, resets: 0 };
  let acc = 0;

  function step() { return 1 / (+C.FIXED_STEP_HZ || 60); }

  function on() {
    if (C.FIXED_STEP_V1 === false) return false;
    const modes = String(C.FIXED_STEP_MODES || "");
    return modes === "*" || modes.split(/[ ,]+/).indexOf(CBZ.game.mode) >= 0;
  }

  /* consume(realDt) → how many whole steps this frame owes.

     The accumulator is the state that makes the tick number mean something, so
     everything that could corrupt it is handled here rather than by callers:
     a NaN or negative delta is ignored, and a delta big enough to be a tab
     that was in the background (or a paused app) RESETS the accumulator
     instead of owing four hundred steps. */
  function consume(realDt) {
    const S = step();
    A.frames++;
    if (!(realDt > 0) || realDt !== realDt) return 0;
    if (realDt > 1.0) { acc = 0; A.resets++; return 1; }        // came back from somewhere
    acc += realDt;
    let n = Math.floor(acc / S);
    if (n > +C.FIXED_STEP_MAX) {
      A.dropped += n - C.FIXED_STEP_MAX;
      n = +C.FIXED_STEP_MAX;
      acc = 0;                                                  // do not owe the rest
    } else {
      acc -= n * S;
    }
    A.steps += n;
    if (n > A.maxInFrame) A.maxInFrame = n;
    return n;
  }

  /* alpha() — how far the sim is between the last tick and the next, 0..1.
     Nothing reads it yet. It is here because it is the OTHER half of a fixed
     step and the half people forget: with a 60 Hz sim on a 120 Hz screen, the
     render should interpolate by this much or the motion judders. When someone
     wires interpolation into the render path, this is the number. */
  function alpha() { return acc / step(); }

  CBZ.fixedStep = { STEP: step(), on, consume, alpha, tick: 0, hz: () => +C.FIXED_STEP_HZ || 60 };

  CBZ.fixedStepAudit = function () {
    return {
      on: on(), hz: +C.FIXED_STEP_HZ || 60, mode: CBZ.game.mode,
      modes: String(C.FIXED_STEP_MODES),
      tick: CBZ.fixedStep.tick,
      steps: A.steps, frames: A.frames,
      stepsPerFrame: A.frames ? Math.round((A.steps / A.frames) * 100) / 100 : 0,
      maxInFrame: A.maxInFrame,
      // RATCHET: steps the guard threw away because a frame ran long. On a
      // machine that holds frame rate this is 0 and must stay there.
      dropped: A.dropped,
      backgroundResets: A.resets,
      residual: Math.round(acc * 10000) / 10000,
    };
  };
})();
