"use strict";
/* src/battle/tick.js — THE SIM, ONE STEP: what every host runs.
   Lifted out of loop.js's frame() (docs/npcwar/ARCHITECTURE.md §8): the
   sub-step every body, squad, round, hull and tier takes (simSubStep), and
   the per-frame pose pass that puts the sim on the rigs (animFrame). NPC
   War's frame() calls both, exactly where the code used to sit. Gang City
   (src/city/army.js, through core/realm.js) calls the same two functions
   from its own frame, so one sim runs on two hosts. Nothing here touches
   the DOM, the war room, the camera or the clock dial.
   Every src/battle file shares ONE script scope. */

/* one sub-step of the battle (the caller advanced simT and the clocks) */
function simSubStep(sdt) {
  if (simT - gridAt > 0.35) rebuildGrid();
  if (simT - comAt > 0.6) updateCOM();
  // the field is re-solved on a slow, STAGGERED tick: two solves in the
  // same sub-step is a visible hitch on a big battle and buys nothing
  if (NAV.on) {
    if (simT - NAV.at.red > 1.4) navSolve("red");
    else if (simT - NAV.at.blue > 1.4) navSolve("blue");
  }
  physPre(sdt);                         // how fast every body was going (src/battle/physics.js)
  tacticsStep(sdt);                    // the squads decide; grenades fly (ai/squad.js)
  for (let i = 0; i < men.length; i++) stepMan(men[i], sdt);
  if (MASS.on) MASS.step(sdt);          // the MID and FAR tiers (src/battle/mass.js)
  // the struck slide on their own momentum; hulls drive over what lies in their path
  if (PHYS.knock.length) stepKnock(sdt);
  physMid(sdt);
  if (PHYS.hulls.length) physPost(sdt);
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

/* the render-side pass at real time: gait, aim pose, the sling, the
   prisoners, and the tiers moving with the lens. dt follows the frame,
   realDt is the wall clock (promotion budgets). */
function animFrame(dt, realDt) {
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
    // a vehicle animates itself on the SIM clock, in stepVehicle (its unit
    // file's animate(veh, dt, ctx), src/battle/vehicles.js vehAnimate)
    if (m.vehicle) continue;
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
      // ...and now the whole soldier: carry, stance (prone behind the gun
      // included), cover peek / lean / blind fire as entities/soldier.js's
      // ch.soldier record (ai/squad.js)
      soldierRig(m);
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
    // the sling's free runs to the rifle's swivels (entities/combatkit.js), near the lens only
    if (m.char && m.char._kitSling && CBZ.combatKit) CBZ.combatKit.sling(m.char, m._weaponProp, d2 < 40 * 40);
  }
  if (TAC.captives.length) animCaptives(dt);   // the prisoners kneel, hands up
  if (MASS.on) MASS.frame(realDt);      // promotion, demotion, ghosts, the crowd draw
}
