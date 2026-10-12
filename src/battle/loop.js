"use strict";
/* src/battle/loop.js — NPC War: FRAME: the core loop.
   Split out of games/battle.html (docs/npcwar/ARCHITECTURE.md). Every
   src/battle file shares ONE script scope: top-level names here are visible
   to the other battle files. Anything that needs the loaded engine runs in
   CBZ.npcwar.onBoot(), in file order, once the armoury is in. */

/* ============================================================ FRAME */
let winCheckT = 0, lastWall = 0, whoT = 0;
/* THE PROBE'S CLOCK. The sim below reads performance.now() on purpose — the
   speed dial is a promise about REAL seconds and a render-time clock cannot
   keep it. That also means a headless tool cannot advance this battle by a
   stated amount: it can only wait, at whatever rate a software rasteriser
   manages, which is how a two-minute war becomes a two-hour probe and why in
   practice nobody photographed one. `injectDt` is the seam — set it and the
   next frame consumes exactly that many seconds instead of asking the wall.
   Read once and cleared, so a missed frame can never silently double a step.
   Driven only by __battle.advance(); play never touches it. */
let injectDt = 0;
let stepPulse = 0;             // one hand-cranked frame, from the `.` key
function frame(dt) {
  if (!started) return;
  // THE SIM CLOCK IS WALL TIME, NOT RENDER TIME. microboot clamps its dt
  // for animation stability, so on a struggling machine the battle would
  // quietly run at a fraction of the dial. The dial is a promise: SPEED 1
  // is one real second per second, and the sub-steps below keep the
  // integration solid however long the frame took.
  const wall = performance.now();
  let realDt = lastWall ? Math.min(0.25, (wall - lastWall) / 1000) : dt;
  lastWall = wall;
  if (injectDt > 0) { realDt = injectDt; injectDt = 0; }   // the probe's clock

  dt = realDt;                      // gait, camera and timers follow the same clock
  if (!firstFrameAt) firstFrameAt = Math.round(performance.now());
  dbgWall += realDt; dbgN++;
  fxBudget = 0;
  drainSpawns();

  // keys: the clock and the cameras
  const IN = CBZ.micro.input;
  if (IN) {
    if (IN.pressed("Space")) setSpeed(speed === 0 ? lastSpeed : 0);
    if (IN.pressed("Digit1")) setSpeed(1);
    if (IN.pressed("Digit2")) setSpeed(2);
    if (IN.pressed("Digit3")) setSpeed(4);
    if (IN.pressed("Digit4")) setSpeed(8);
    if (IN.pressed("Digit5")) setSpeed(0.25);
    // G: take a rifle / hand it back (the rifle button)
    if (IN.pressed("KeyG")) toggleRifle();
  }
  if (IN && cam.mode !== "you") {
    // F rides the front rank; pressing it again crosses to the other army
    if (IN.pressed("KeyF")) {
      setCamMode("follow", cam.mode === "follow" && cam.followTeam === "red" ? "blue" : "red");
    }
    if (IN.pressed("KeyC")) setCamMode(cam.mode === "auto" ? "free" : "auto");
    /* THE TEST BED'S OWN KEYS. V locks the lens on one animal, [ and ] walk
       the roster, U drops it under the swell and B sits it on the waterline.
       Each is a toggle back to FREE, so the same finger that took the shot
       gives the camera back. */
    if (IN.pressed("KeyV")) setCamMode(cam.mode === "study" ? "free" : "study");
    if (IN.pressed("KeyU")) setCamMode(cam.mode === "under" ? "free" : "under");
    if (IN.pressed("KeyB")) setCamMode(cam.mode === "surface" ? "free" : "surface");
    if (IN.pressed("BracketLeft")) { studyPick(-1); if (cam.mode === "free") setCamMode("study"); }
    if (IN.pressed("BracketRight")) { studyPick(1); if (cam.mode === "free") setCamMode("study"); }
    /* THE FRAME STEP. A quarter-speed clock is still a clock; "does the tail
       cross the centre line before the jaw opens" is a question you can only
       answer by stopping and nudging. `.` pauses if it has to and then hands
       the next frame exactly one thirtieth of a second — the same injected-dt
       seam the headless probe uses, so a person and a tool step this battle
       through the identical code path. */
    if (IN.pressed("Period")) { if (speed !== 0) setSpeed(0); stepPulse = 1 / 30; }
  }

  // ---- SIM at the dialled speed, sub-stepped so 8x stays solid. The
  // sub-step cap means a machine that cannot COMPUTE eight seconds per
  // second degrades to what it can.
  let simDt = realDt * speed;
  if (stepPulse > 0) { simDt = stepPulse; stepPulse = 0; }   // one frame, by hand
  const simBefore = simT;
  if (simDt > 0) {
    const sub = Math.min(8, Math.max(1, Math.ceil(simDt / 0.055)));
    const sdt = Math.min(0.055, simDt / sub);
    for (let s = 0; s < sub; s++) {
      simT += sdt;
      CBZ.now += sdt * 1000;             // combat_iq's clocks follow the dial
      simSubStep(sdt);                    // the sim itself (src/battle/tick.js)
    }
  }

  /* THE SOLVER'S OWN VERDICT, ONCE A FRAME. It has to sweep where the
     bodies ARE — a residual read off the pre-push grid silently
     under-reports and would have exonerated the pass. Once per FRAME
     rather than per sub-step, and never during a benchmark: the benchmark
     exists to report what this machine can really carry, and an audit that
     only runs while you are measuring is an audit that changes the answer. */
  if (PROBE && !bench && simDt > 0) { rebuildFine(); sepResid = sepResidual(); }

  // ---- render-side work at real time: gait, aim pose, camera ----
  // the retired bodies sink out on WALL time on purpose: they are no longer
  // part of the battle, and a paused page should still finish tidying up.
  if (sinking.length) stepSinking(realDt);
  /* THE SEA IS SCENERY AND MOVES ON THE SIM CLOCK. On the sim clock, because
     the swell is what the bodies float on and a paused battle with a heaving
     ocean under it is the page arguing with itself — the same argument the
     corpse solver settled. Once per FRAME, never per sub-step: 4 225 vertices
     times three sines is a real number and the swell does not need eight of
     them a frame to look like water. */
  if (SEA.on) seaStep(simT - simBefore);
  animFrame(dt, realDt);               // the rigs follow the sim (src/battle/tick.js)
  stepKill(realDt);                     // ...on WALL time: see THE KILL CAM
  stepCamera(dt);
  if (SEA.on) seaUnderwater();          // after the camera moved, before the draw
  stepRes(dt);

  if (bench && !bench.done) stepBench(dt);
  if (bannerT > 0 && (bannerT -= dt) <= 0) el("banner").classList.remove("on");

  // ---- chrome ----
  // the lens card at 10 Hz: a magazine draining and a reload filling are
  // the two things on it that MOVE
  whoT -= dt;
  if (whoT <= 0) { whoT = 0.1; if (started) stepWho(); }
  if (ctlIdleAt && performance.now() > ctlIdleAt) { ctlIdleAt = 0; el("ctl").classList.add("idle"); }
  winCheckT -= dt;
  if (winCheckT <= 0 && !over && !bench && spawnQueue.length === 0) {
    winCheckT = 0.5;
    // inFight: the living, or 0 once a broken army has had nobody fighting
    // for BREAK_GRACE seconds (MORALE) — a rout ends a war, not only a wipe
    const ar = inFight("red"), ab = inFight("blue");
    if (ar === 0 || ab === 0) endWar(ar > 0 ? "red" : ab > 0 ? "blue" : null);
    /* TWO HELD LINES ARE NOT A BATTLE. When both sides hold and nobody has
       fired for twenty seconds, the side the General is not commanding
       goes forward. */
    else if (ORDER.red === "hold" && ORDER.blue === "hold") {
      const last = shotsRing.length ? shotsRing[shotsRing.length - 1].t : 0;
      if (simT - last > 20) ORDER[SET.redN >= SET.blueN ? "red" : "blue"] = "advance";
    }
  }
}
