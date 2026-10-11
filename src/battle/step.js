"use strict";
/* src/battle/step.js — NPC War: SIM STEP: one man's body for one tick.
   Split out of games/battle.html (docs/npcwar/ARCHITECTURE.md). Every
   src/battle file shares ONE script scope: top-level names here are visible
   to the other battle files. Anything that needs the loaded engine runs in
   CBZ.npcwar.onBoot(), in file order, once the armoury is in. */

/* ============================================================ SIM STEP */
function stepMan(m, sdt) {
  // a vehicle is its own body, brain and guns (src/battle/vehicles.js)
  if (m.vehicle) { stepVehicle(m, sdt); return; }
  /* A BODY IN A GORILLA'S HAND IS NOT A MARCHER. systems/ape_combat.js owns
     this man's world transform outright while the flag is up — his position,
     his facing and his rig — exactly the way grapple.js's `heldBy` stands the
     player's own mover down. Everything below (think, locomotion, the fire
     solution) would be fighting it for the same three numbers. The flag is
     cleared by the hold itself, and by apeReset on a restart, so nothing can
     strand a man mid-air. Tested first, above the death branch, because a man
     who dies IN the hand is still in the hand until it lets go. */
  if (m._apeHeld || m._apeFlying) return;
  // AND A BODY AN ELEPHANT THREW is the throw's until it lands (player.js)
  if (m._tossed) { stepTossed(m, sdt); return; }
  if (m.dead) {
    // A SOLVED CORPSE HAS EXACTLY ONE WRITER. quadruped_ragdoll.js owns the
    // group's position and quaternion from the frame the animal died (this
    // page steps it on the sim clock — see the quadRagdollStep call in
    // frame()), and a second author here is precisely the double-write that
    // leaves a body latched half way through its own fall.
    if (m.ragdoll) return;
    // the shared tumble, when the mainland's wildlife.js is loaded and the
    // solver declined this body. Returns false once it has settled.
    if (m.tumble) {
      if (!CBZ.wildlifeDeathStep || !CBZ.wildlifeDeathStep(m, sdt)) m.tumble = false;
      return;
    }
    if (m.dieT > 0 && m.dieT < 1) {
      m.dieT = Math.min(1, m.dieT + sdt * 2.4);
      const k = 1 - (1 - m.dieT) * (1 - m.dieT);
      // A MAN topples over his own facing. A FOUR-LEGGED BODY falls onto its
      // flank, which is a roll about its own long axis — and on a body
      // authored nose-toward-+X that axis is rotation.x under the 'YXZ' order
      // beastDeathPhysics puts the corpse on, NOT rotation.z (which is the
      // model-local PITCH and was sitting every dead animal upright).
      if (m.beast && DEATH_OLD) m.group.rotation.z = m.dieDir * k * 1.45;   // the reverted pose
      else m.group.rotation.x = m.dieDir * k * (m.beast ? 1.45 : (Math.PI / 2 - 0.07));
    }
    return;
  }
  if (m.fled) return;              // off the field; updateMorale splices him out
  if (m.you) { stepYou(m, sdt); return; }
  if (simT >= m.thinkAt) think(m, simT);
  if (m.fled) return;
  if (m.supp > 0) m.supp = Math.max(0, m.supp - sdt * SUPP_DECAY);
  armsTick(m, sdt);                      // the magazine, the stoppage (src/battle/fire.js)
  m.cool -= sdt;
  // a man knocked down is not steered: the knockdown owns him (melee.js)
  if (knockedDown(m)) { m.speed = 0; return; }

  // ---- THE STRIKE BUBBLE. Inside claw range creature_combat owns the
  // whole beat — approach, facing, windup, the hit, the recover — through
  // the exact seams it published: opts.move walks on THIS map's walls and
  // ground, opts.onHit lands in THIS page's damage funnel. Outside the
  // bubble the beast is just another marcher below.
  if (m.beast) {
    /* A GORILLA MID-SWING IS NOT MARCHING ANYWHERE. Its own hold owns its
       position, its facing and its pitch (systems/ape_combat.js, ticked by
       apeStep above). Without this the branch below falls through the moment
       the man in its hand DIES — `bt.dead` — and the locomotion at the bottom
       of this function walks a spinning silverback across the map while the
       body on its arm stays welded to a hand that is no longer where the
       swing thinks it is. */
    if (CBZ.apeOwns && CBZ.apeOwns(m)) {
      m.resT = (m.resT || 0) - sdt;
      if (m.resT <= 0) { m.resT = 0.25; CBZ.micro.resolveCircle(m.pos, m.rad || 0.5, m.pos.y, 1.8); }
      return;
    }
    const bt = m.tgt;
    if (bt && !bt.dead && !bt.fled && !over) {
      const bd = Math.hypot(bt.pos.x - m.pos.x, bt.pos.z - m.pos.z);
      if (bd < m.reach + 2.6) {
        beastFight(m, bt, sdt);
        // a striking beast still answers to the walls: the separation pass
        // shoves bodies without asking the world, and this early return
        // used to skip the standing resolve for the whole swing — measured
        // as one gorilla probed inside an arena crate mid-maul
        m.resT = (m.resT || 0) - sdt;
        if (m.resT <= 0) { m.resT = 0.25; CBZ.micro.resolveCircle(m.pos, m.rad || 0.5, m.pos.y, 1.8); }
        return;
      }
    } else if (m._atkAnim != null && m._atkAnim >= 0 && CBZ.creatureEndAttack) {
      // the victim died under the swing: cancel it CLEANLY or the strike
      // pose stays latched on a living body forever — measured on the
      // probe as _atkAnim frozen at 0.94 on a gorilla marching victorious
      try { CBZ.creatureEndAttack(m); } catch (e) {}
    }
  }

  // ---- move toward the goal combat_iq (or the march) set. A man is not a
  // pathfinder: when a wall eats his progress he slides ALONG it for a
  // while instead of pressing his face into it — one distance test, no
  // graph, and a column flows around a tower like water instead of queueing
  // against the facade (the shipped city bug this block exists to fix). ----
  const dx = m.target.x - m.pos.x, dz = m.target.z - m.pos.z;
  const d = Math.hypot(dx, dz);
  const tgt0 = m.tgt;
  const tdist = tgt0 && !tgt0.dead
    ? Math.hypot(tgt0.pos.x - m.pos.x, tgt0.pos.z - m.pos.z) : 1e9;
  let spd = 0;
  if (d > 1.1) {
    const hurtish = m.hp < m.maxHp * 0.45;
    // a wounded man limps AWAY slower than a fresh man walks IN — the old
    // 7.0 fallback outran every pursuer and froze a whole battle behind
    // one unkillable runner. And an army that outnumbers the last few
    // holdouts eight to one smells blood and sprints.
    if (m.beast) {
      // the species' own legs: charge in, lope on the march, and a beaten
      // runner flees just under charge pace — catchable, like the men
      const tn = m.tn;
      spd = m.slot === "fallback" ? tn.chase * 0.92 :
            m.slot === "push" ? tn.chase : tn.march;
      if (m.hunt && tdist < 999) spd = Math.max(spd, tn.chase * 1.08);
    } else {
      // a ROUTING man runs a shade faster than a pursuer walks in (6.2) and
      // slower than a sweep (7.6-8.0): a broken line gets away from a line
      // that is still fighting, and is run down by one that has won
      spd = m.slot === "rout" ? (hurtish ? 5.4 : 6.6) :
            m.slot === "fallback" ? 5.2 :
            (m.slot === "push" || m.slot === "march" || m.slot === "flank") ? (m.hunt ? 7.6 : 6.2) :
            (m.slot === "cover" || m.slot === "hull" || hurtish) ? 7.0 : 4.6;
      // holding the fire token forty metres out of range is not holding
      // anything: closing to the band is a RUN, whatever the slot says
      if (tdist < 1e9 && tdist > 42 && spd < 6.2) spd = m.hunt ? 7.6 : 6.4;
      // and a mob eight-to-one over the last holdouts does not respect the
      // band at all — it runs them down. This rule is what ENDS a battle.
      if (m.hunt && tdist < 999) spd = Math.max(spd, 8.0);
    }
    let nx = dx / d, nz = dz / d;
    if (m.detourT > 0) {
      m.detourT -= sdt;
      const sw = m.detourDir || 1;
      const tx = nz * sw, tz = -nx * sw;      // 90 degrees off the blocked line
      nx = tx; nz = tz;
    }
    const ox = m.pos.x, oz = m.pos.z;
    m.pos.x += nx * spd * sdt;
    m.pos.z += nz * spd * sdt;
    CBZ.micro.resolveCircle(m.pos, m.rad || 0.5, m.pos.y, 1.8);
    const got = Math.hypot(m.pos.x - ox, m.pos.z - oz);
    const want = spd * sdt;
    if (want > 0.001 && got < want * 0.25) {
      m.stuckT = (m.stuckT || 0) + sdt;
      if (PROBE) QUAL.wallSeconds += sdt;      // the wall-running metric, held near zero
      if (m.stuckT > 0.8) {
        m.stuckT = 0;
        m.detourT = 1.5 + ((m.i % 5) * 0.35);
        m.detourDir = (m.i & 1) ? 1 : -1;
      }
    } else if (got > want * 0.6 && m.stuckT) m.stuckT = Math.max(0, m.stuckT - sdt * 2);
  } else {
    // STANDING MEN GET RESOLVED TOO. The separation pass and blast shoves
    // move bodies without asking the world, and a man embedded in a crate
    // is invisible to every line of sight — an immortal, and a battle that
    // cannot end. A slow timer keeps the cost of honesty near zero.
    m.resT = (m.resT || 0) - sdt;
    if (m.resT <= 0) {
      m.resT = 0.25;
      CBZ.micro.resolveCircle(m.pos, m.rad || 0.5, m.pos.y, 1.8);
    }
  }
  m.speed = spd;
  if (MAP.water) stepDepth(m, sdt);
  m.pos.y = MAP.bodyY(m, m.pos.x, m.pos.z);

  // face the fight when there is one, else the walk
  const tgt = m.tgt;
  if (m.beast) {
    // the animal convention: heading h faces (cos h, sin h), nose on +X.
    // Outside the strike bubble the beast faces its own travel; inside it
    // creature_combat turned the head already.
    if (spd > 0.1 && d > 0.05) {
      const want = Math.atan2(dz, dx);
      let dh = want - m.heading;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      m.heading += dh * Math.min(1, sdt * 6);
      m.faceH = m.heading;
      CBZ.faceAnimalHeading(m, m.heading);
    }
    return;                                    // no rifle on an animal
  }

  /* ---- STANCE. In a fold he works it (down, up to shoot, down to
     reload). In the open a man who has stopped and is pinned or badly hurt
     KNEELS — smaller, and the enemy's rounds pay CROUCH_HIT for it — and
     stands again to move or once the fire comes off him. A running man is
     always up. coverK is what fireShot multiplies a round's hit chance by. */
  m.up = true;
  // THE GUN'S OWN STANCE (src/battle/fire.js): a belt-fed gun or a sniper
  // rifle goes prone on its bipod, a rifleman shooting far takes a knee
  const ws = weaponStance(m, tgt, spd);
  if (m.routed || m.fists) { if (m.stance !== "stand") setStance(m, "stand"); }
  else if (m.slot === "hull" && m.hull) m.up = workHull(m, sdt);
  else if (ws) { if (m.stance !== ws) setStance(m, ws); }
  else if (m.stance === "prone") setStance(m, spd > 0.1 ? "stand" : "crouch");
  else if (m.stance === "crouch") {
    const kneel = holding(m);
    if (spd > 0.1 || (!kneel && (!tgt || tgt.dead || (m.supp < 0.12 && m.hp >= m.maxHp * 0.5)))) setStance(m, "stand");
  } else if (spd <= 0.1 && (holding(m) || (tgt && !tgt.dead && (m.supp > 0.35 || m.hp < m.maxHp * 0.5)))) {
    setStance(m, "crouch");
  }
  m.coverK = m.stance === "crouch" ? CROUCH_HIT
    : (m.slot === "hull" && m.hull && m.up) ? HULL_UP_HIT : 1;

  const engaged = tgt && !tgt.dead && m.sees;
  if (!engaged && spd > 0.1) {
    const want = Math.atan2(dx, dz);
    let dy = want - m.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    m.yaw += dy * Math.min(1, sdt * 7);
    m.group.rotation.y = m.yaw;
  }

  // ---- the trigger ----
  if (m.routed) return;                  // a broken man is not fighting
  if (!tgt || tgt.dead || tgt.fled || m.reloadT > 0) return;
  const dist = Math.hypot(tgt.pos.x - m.pos.x, tgt.pos.z - m.pos.z);
  if (m.fists) { stepFists(m, tgt, dist, sdt); return; }   // src/battle/melee.js
  if (m.launcher) { armsLauncher(m, tgt, dist); return; }   // src/battle/fire.js
  armsTrigger(m, tgt, dist, sdt);        // how he uses the gun: src/battle/fire.js
}
