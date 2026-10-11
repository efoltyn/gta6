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
      if (simT - gridAt > 0.35) rebuildGrid();
      if (simT - comAt > 0.6) updateCOM();
      // the field is re-solved on a slow, STAGGERED tick: two solves in the
      // same sub-step is a visible hitch on a big battle and buys nothing
      if (NAV.on) {
        if (simT - NAV.at.red > 1.4) navSolve("red");
        else if (simT - NAV.at.blue > 1.4) navSolve("blue");
      }
      for (let i = 0; i < men.length; i++) stepMan(men[i], sdt);
      if (MASS.on) MASS.step(sdt);          // the MID and FAR tiers (src/battle/mass.js)
      /* THE HOLD AND EVERYTHING IN THE AIR. This has to be its own call and
         not a seam inside beastFight: the strike bubble above only runs while
         the gorilla has a LIVING target inside reach, and a man being swung
         around by the ankle is usually dead before the second revolution —
         the moment his corpse stopped qualifying, the swing would freeze
         mid-air with him welded to a fist. Driven here, on the sim clock, it
         also runs at the dialled battle speed like everything else.

         GATED ON THE ROSTER for the same measured reason the corpse solver
         below is, and it is worth stating rather than copying: a war of
         riflemen is held to `overlapPeak === 0` by tools/battle-check.mjs,
         and that is a knife-edge which ANY added work in this innermost
         sub-step can push over (the solver's own note records 0 pairs on
         three runs ungated versus 1-2 with). There is no ape in a men-only
         battle, so there is nothing here for it to step. */
      if (HAS_BEASTS && CBZ.apeStep) { try { CBZ.apeStep(sdt); } catch (e) {} }
      /* THE DEAD RUN ON THE SAME CLOCK AS THE LIVING. quadruped_ragdoll.js
         normally ticks itself off the frame hook, which would leave the
         corpses folding at wall speed while the battle ran at quarter speed
         — and still folding while SPACE says the war is paused. The page
         claimed the solver (CBZ.quadRagdollDriven, set at the top) precisely
         so it could be stepped HERE, inside the sub-step, with the sim's own
         dt. Nothing else on this page has to know.

         GATED ON THE ROSTER, and the gate is not an optimisation — it is the
         proof. tools/battle-check.mjs holds a battle of RIFLEMEN to
         `overlapPeak === 0`, a knife-edge that a man's shoulder either
         crosses or does not, and adding any work to the innermost loop of
         that battle moved it (measured: 0 overlapping pairs on three runs of
         the old code, 1-2 on three runs with this call ungated). A war
         between men has no quadruped to solve, so it should not enter the
         solver at all — and now the men-only sub-step is the one it always
         was, which is the only way that check keeps meaning what it says. */
      if (deadSolving > 0) {
        if (HAS_BEASTS && CBZ.quadRagdollStep) CBZ.quadRagdollStep(sdt);
        if (CBZ.ragdollStep) CBZ.ragdollStep(sdt);
      }
      rebuildFine();                       // bodies moved: the body grid is stale
      separateSolve(Math.min(0.9, sdt * 26));
      if (!SEP_OLD) { rebuildFine(); pinnedPass(); }   // and what no sweep can fix: a wall
      stepRockets(sdt);
      if (AIR.on) {
        if (simT - airAimT > 3) {
          airAimT = simT;
          airAim.red = densestCellOf("blue");   // red's air looks at blue mass
          airAim.blue = densestCellOf("red");
        }
        if (CBZ.ordnance && CBZ.ordnance.step) CBZ.ordnance.step(sdt);
        stepPlanes(sdt);
      }
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
  const camP = CBZ.camera.position;
  for (let i = 0; i < men.length; i++) {
    const m = men[i];
    /* A MAN IN A FIST STILL HAS TO LOOK LIKE A MAN IN A FIST. animChar runs
       AFTER the sim (that ordering is the whole reason grapple.js has a
       late-write pass at order 90), so a hold pose written in the step would
       be stomped here every frame and the body would ride round the swing in
       a walk cycle. Held and airborne bodies get their own rig write instead
       — arms and legs fighting the grip, not strolling. */
    if (m._apeHeld || m._apeFlying) {
      if (CBZ.apePoseVictim) { try { CBZ.apePoseVictim(m, dt); } catch (e) {} }
      continue;
    }
    if (m.dead) continue;
    const d2 = (m.pos.x - camP.x) * (m.pos.x - camP.x) + (m.pos.z - camP.z) * (m.pos.z - camP.z);
    m.animF = (m.animF + 1) & 1023;
    const every = CBZ.battleLod.animEvery(d2);      // battle/core/lod.js: the one tier table
    if (m.vehicle) {                     // tracks, wheels, rotors (src/battle/vehicles.js)
      if ((m.animF % every) === 0) animateVehicle(m, dt * every);
      continue;
    }
    if (m.beast) {
      // the species walks on the shared rig — legs swing by distance
      // actually moved, so the charge, the march and the rout all animate
      // off the same law. LOD-skipped exactly like the men's gait.
      /* ...and a body that SWIMS beats its tail instead. Same LOD skip,
         same distance-moved law; the rig picked itself at spawn (buildSwimRig
         on an aquatic species, buildGait on anything with legs), so this is
         one test and not a species table. */
      if ((m.animF % every) === 0) animateBeast(m, dt * every);   // beasts.js: the species file's own, or the shared rig
      continue;
    }
    if ((m.animF % every) === 0 && CBZ.animChar && m.char) {
      // A MAN IN COVER GETS SMALL. `ch.crouch` is the rig's own flag —
      // animChar damps `_cb` and folds the thighs off it, and nothing here
      // had ever set it, so combat_iq could send a soldier to a real piece
      // of cover and he would stand up straight behind it. One boolean, and
      // the posture the fight brain already chose is finally visible.
      m.char.crouch = crouchPose(m);     // the stance the fight uses (THE MEN: STANCE)
      try { CBZ.animChar(m.char, m.speed * speed, dt * every); } catch (e) {}
    }
    const engaged = m.tgt && !m.tgt.dead && m.sees;
    if (engaged && d2 < 190 * 190) {
      if (m.fists) {
        // a brawler squares up by turning his whole body — there is no
        // weapon arm for actorAimAt to lay on the line
        const want = Math.atan2(m.tgt.pos.x - m.pos.x, m.tgt.pos.z - m.pos.z);
        let dy = want - m.yaw;
        while (dy > Math.PI) dy -= Math.PI * 2;
        while (dy < -Math.PI) dy += Math.PI * 2;
        m.yaw += dy * Math.min(1, dt * 9);
        m.group.rotation.y = m.yaw;
      } else if (CBZ.actorAimAt) {
        CBZ.actorAimAt(m, m.tgt, dt);
        m.yaw = m.group.rotation.y;
      }
    }
    if (m._weaponProp) {
      const showGun = d2 < 130 * 130;
      if (m._weaponProp.visible !== showGun) m._weaponProp.visible = showGun;
    }
  }
  if (MASS.on) MASS.frame(realDt);      // promotion, demotion, ghosts, the crowd draw
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
      if (simT - last > 20) ORDER[FRONT ? "blue" : (SET.redN >= SET.blueN ? "red" : "blue")] = "advance";
    }
  }
}
