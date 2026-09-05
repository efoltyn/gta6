/* ============================================================
   entities/npc.js — non-guard actors: inmates that wander the prison.
   Roles:
     merchant  — the Old Timer, sells general contraband
     dealer    — sells "product" (drugs)
     thief     — shifty; lifts cigarettes off you and fences cheap loot
     inmate    — generic background convict (flavour + small deals)
   Each is interactable via systems/interact.js (Talk/Trade/Bribe/Steal).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const scene = CBZ.prisonRoot || CBZ.scene;
  const { makeCharacter, animChar, lerpAngle, econ } = CBZ;

  // ---- build & register one NPC ----
  function makeNpc(opts) {
    const lifeDef = CBZ.npcLife ? CBZ.npcLife.resolve("jailInmate") : { id: "jailInmate", actor: {}, life: { routine: true } };
    opts = Object.assign({}, lifeDef.actor, opts || {});
    const ch = makeCharacter(opts.skin);
    // WHO HE IS (entities/heritage.js): a rolled look carries heritage/ink/
    // beard/tank; stamp the head ink + the tags the wardrobe reads off the rig.
    if (opts.skin && opts.skin.heritage && CBZ.heritageApply) CBZ.heritageApply(ch, opts.skin);
    if (!opts.prisonOutfit && opts.skin && opts.skin.tank) opts.prisonOutfit = "tank";
    ch.group.position.set(opts.pos[0], 0, opts.pos[1]);
    ch.group.userData.dynamic = true;
    scene.add(ch.group);

    const n = {
      char: ch, group: ch.group, kind: "inmate", role: opts.role,
      // Outfit assignment is authored at the actor, while the actual garment
      // remains city/outfits.js + city/clothes.js's shared responsibility.
      prisonOutfit: opts.prisonOutfit || "inmate",
      gang: opts.gang == null ? null : opts.gang,
      crewRole: opts.crewRole || "",
      personality: opts.personality || null,
      ratings: opts.ratings || null,      // CAPABILITY (filled/merged by ai.js)
      behavior: opts.behavior || null,    // TEMPERAMENT (random if absent)
      forceNeutral: !!opts.forceNeutral,  // stay unaffiliated (a "loner")
      region: opts.region,            // [minX,maxX,minZ,maxZ] wander box
      target: new THREE.Vector3(opts.pos[0], 0, opts.pos[1]),
      pause: 0, speed: opts.speed || 2.2, bribed: 0,
      data: opts.data,
      _npcProfile: lifeDef.id,
      _npcLife: Object.assign({}, lifeDef.life),
      activityState: "idle",
      _tag: null,                      // identity lives in interaction dialogue/UI
      slice: CBZ.npcs.length & 15,     // round-robin phase for time-sliced AI
    };
    CBZ.npcs.push(n);
    return n;
  }

  // ---- wander AI ----
  function targetClear(x, z, pad) {
    const cols = CBZ.colliders;
    pad = pad || 0.65;
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i];
      if (x > c.minX - pad && x < c.maxX + pad && z > c.minZ - pad && z < c.maxZ + pad) return false;
    }
    return true;
  }
  function pickTarget(n) {
    const r = n.region;
    let x = n.group.position.x, z = n.group.position.z;
    // Random destinations inside walls make actors scrape in place. Reject
    // blocked samples up front; if a region is cramped, keep the current spot.
    for (let i = 0; i < 8; i++) {
      const nx = r[0] + econ.rng() * (r[1] - r[0]);
      const nz = r[2] + econ.rng() * (r[3] - r[2]);
      if (targetClear(nx, nz)) { x = nx; z = nz; break; }
    }
    n.target.set(x, 0, z);
  }
  // ---- LOD thresholds (squared distance from the CAMERA) ----
  //   near : full animation every frame + brain every ~3rd frame
  //   far  : frozen pose (no animChar) + brain crawls (~7th/16th frame)
  //   detail/tag: face quads, hair and the name tag shown only up close
  //   These ranges now ride the LIVE quality tier (CBZ.qScale, read at use
  //   time each frame — pause-menu perf/quality slider); mid-tier ≈ the old
  //   fixed radii (55/95/40/52).
  function ANIM2() { const d = CBZ.qScale ? CBZ.qScale(36, 77) : 55; return d * d; }    // animate within this; freeze beyond
  function FAR2() { const d = CBZ.qScale ? CBZ.qScale(62, 133) : 95; return d * d; }    // brain barely ticks beyond this
  function DETAIL2() { const d = CBZ.qScale ? CBZ.qScale(26, 56) : 40; return d * d; }  // show face/hair/name-tag within this (faces read across the yard, not just point-blank)
  function RIG2() { const d = CBZ.qScale ? CBZ.qScale(34, 73) : 52; return d * d; }     // hide the full mesh rig beyond this
  let frame = 0;

  // NPCs the player is actively engaged with stay FULL-detail at any range
  // (combat, gunpoint stand-off, hunts, approaches) — importance LOD.
  function important(n) {
    const s = n.aiState;
    return !!(n.intimidMode || n.huntPlayer > 0 ||
      s === "fight" || s === "approachPlayer" || s === "snitch" ||
      s === "pressurePlayer" || s === "tailPlayer" || s === "interceptThreat" || s === "diversion");
  }

  const ACCEL = 11;                      // m/s² to turn or stop: never a flip inside a frame
  const ACCEL_UP = 26;                   // m/s² along the way he is already facing: off in ~0.07 s
  /* What the body gained over the last frame once the wall resolver had
     spoken, in metres per second, smoothed. `_acX/_acZ` is the settled
     position systems/actorcollide.js stamps at the end of each frame; the
     difference between two of those is the achieved step, not the ordered
     one. The knockback slide (`_phys.kx/kz`, integrated by reactions.js) is
     ground moving under a body without its legs and is taken back out. */
  function groundSpeed(n, dt) {
    const ax = n._acX, az = n._acZ;
    let gs = n._gs || 0;
    if (ax != null && n._gsX != null && dt > 1e-4) {
      const ph = n._phys;
      const mx = (ax - n._gsX) / dt - (ph ? ph.kx || 0 : 0);
      const mz = (az - n._gsZ) / dt - (ph ? ph.kz || 0 : 0);
      gs = CBZ.damp(gs, Math.hypot(mx, mz), 14, dt);
    }
    n._gsX = ax; n._gsZ = az;
    n._gs = gs;
    return gs;
  }

  function recoverStuck(n, dt, speed, gp, routed) {
    /* NOT WHILE A ROUTE OWNS HIM. `pickTarget` samples his `region`, and at
       lights-out systems/prisonschedule.js pins that region to a 2.2 m box
       around the mattress — which is on the far side of a cell wall from a man
       still in the corridor, so the "recovery" aims him through it and undoes
       the leg he is walking. A man who is genuinely stuck on a route is caught
       by that file's own stall detector, which gives his rack away rather than
       jiggling him at a wall. */
    if (routed) { n._lastX = gp.x; n._lastZ = gp.z; n._stuckT = 0; return; }
    if (n._lastX != null) {
      const dx = gp.x - n._lastX, dz = gp.z - n._lastZ;
      const tx = n.target.x - gp.x, tz = n.target.z - gp.z;
      const trying = speed > 0.25 && tx * tx + tz * tz > 1;
      const roam = !n.aiState || n.aiState === "wander" || n.aiState === "socialize";
      if (trying && roam && dx * dx + dz * dz < 0.0009) n._stuckT = (n._stuckT || 0) + dt;
      else n._stuckT = Math.max(0, (n._stuckT || 0) - dt * 2);
      if (n._stuckT > 0.7) {
        pickTarget(n);
        n.pause = 0.05;
        n._stuckT = 0;
      }
    }
    n._lastX = gp.x; n._lastZ = gp.z;
  }

  // Purposeful calm-time routine for named/full-rig inmates. The combat brain
  // remains authoritative: the moment it chooses fight, flee, approach,
  // socialize, etc. this layer yields. While genuinely calm, actors alternate
  // between walking somewhere, holding a post, and a visible in-place task.
  function calmForRoutine(n, imp) {
    const s = n.aiState;
    return !imp && !n.dead && !(n.ko > 0) && !n.rage && !n.approach && !n.intimidMode &&
      (!s || s === "wander");
  }

  function chooseRoutine(n, gp) {
    const roll = econ.rng();
    const posted = n.role === "merchant" || n.role === "dealer" || n.crewRole === "lookout";
    const standCut = posted ? 0.50 : 0.28;
    const actionCut = posted ? 0.70 : 0.50;
    if (roll < standCut) {
      n._lifeActivity = "stand";
      n._lifeT = 4 + econ.rng() * (posted ? 10 : 6);
      n._lifeX = gp.x; n._lifeZ = gp.z;
      // Look toward the centre of the inmate's own patch while posted.
      const r = n.region;
      const tx = r ? (r[0] + r[1]) * 0.5 : 0, tz = r ? (r[2] + r[3]) * 0.5 : 35;
      n._lifeHeading = Math.atan2(tx - gp.x, tz - gp.z);
    } else if (roll < actionCut) {
      n._lifeActivity = "activity";       // stretch, shadow-box, work a bench
      n._lifeT = 3.5 + econ.rng() * 6.5;
      n._lifeX = gp.x; n._lifeZ = gp.z;
      n._lifeHeading = n.group.rotation.y;
    } else {
      n._lifeActivity = "walk";
      n._lifeT = 6 + econ.rng() * 10;
      pickTarget(n);
    }
  }

  function purposefulRoutine(n, dt, speed, gp, imp, curfew) {
    if (curfew || !calmForRoutine(n, imp)) {
      n._lifeActivity = null; n._lifeT = 0;
      n.activityState = n.aiState || "idle";
      return speed;
    }
    n._lifeT = Math.max(0, (n._lifeT || 0) - dt);
    // A ROUTE IS NOT AN ARRIVAL. systems/prisonnav.js hands this mover one
    // WAYPOINT at a time while it walks a man round a wall; reading a reached
    // waypoint as "the walk is done" would re-roll his destination every few
    // metres and he would never get anywhere on purpose.
    const routed = !!(CBZ.prisonNav && CBZ.prisonNav.owns(n));
    const close = routed ? false : (n.target ? Math.hypot(n.target.x - gp.x, n.target.z - gp.z) < 0.65 : true);
    if (!n._lifeActivity || n._lifeT <= 0 || (n._lifeActivity === "walk" && close)) chooseRoutine(n, gp);
    n.activityState = n._lifeActivity;
    if (n._lifeActivity === "stand" || n._lifeActivity === "activity") {
      n.target.set(n._lifeX, 0, n._lifeZ);
      n.group.rotation.y = lerpAngle(n.group.rotation.y, n._lifeHeading, 1 - Math.pow(0.001, dt));
      return 0;
    }
    return speed * 0.78;                   // calm transit, not perpetual sprinting
  }

  function poseRoutine(n, dt) {
    if (n.activityState !== "activity" || !n.char || !n.char.parts) return;
    n._lifePhase = (n._lifePhase || 0) + dt * 3.2;
    const sw = Math.sin(n._lifePhase) * 0.34;
    const la = n.char.parts.la, ra = n.char.parts.ra;
    if (la) la.rotation.x = CBZ.damp(la.rotation.x, -0.78 + sw, 10, dt);
    if (ra) ra.rotation.x = CBZ.damp(ra.rotation.x, -0.78 - sw, 10, dt);
  }

  function updateNpc(n, dt, cx, cz) {
    // crowd.js owns the mass-crowd's promoted face-rigs (movement + anim);
    // the prison brain loop must not also drive them.
    if (n._crowd) return;
    if (n.bribed > 0) n.bribed -= dt;

    // ---- distance LOD off the camera (+ importance override) ----
    const gp = n.group.position;
    const ddx = gp.x - cx, ddz = gp.z - cz, d2 = ddx * ddx + ddz * ddz;
    const imp = important(n);
    const wantRig = !n.escaped && (imp || d2 < RIG2());
    if (n._rigOn !== wantRig) { n._rigOn = wantRig; n.group.visible = wantRig; }
    const near = wantRig && (imp || d2 < ANIM2());       // animate this frame?
    const wantDetail = wantRig && (imp || d2 < DETAIL2());
    if (n._detailOn !== wantDetail) {       // toggle only on tier change
      n._detailOn = wantDetail;
      const det = n.char.detail;
      if (det) for (let k = 0; k < det.length; k++) {
        const part = det[k];
        part.visible = wantDetail && !(part.userData && part.userData._cbzDetailSuppressed);
      }
      if (n._tag) n._tag.visible = false;
    }

    // dead: stay sprawled forever. systems/prisoncorpse.js owns the corpse —
    // the clear lie direction, the wall depenetration, the sprawl — and this
    // legacy flop is only the PRISON_CORPSE_V1=false fallback.
    if (n.dead) {
      if (!(CBZ.prisonCorpseTick && CBZ.prisonCorpseTick(n, dt)))
        n.group.rotation.z = CBZ.damp(n.group.rotation.z, Math.PI / 2, 9, dt);
      return;
    }

    // ASLEEP IN A BUNK (systems/prisonrest.js → city/propuse.js). The same
    // shape as the KO branch below and for the same reason: another system
    // owns this transform for as long as the flag is set, so the mover must
    // not integrate and — the one that actually shows — the roll-recovery
    // damp two lines down must not spend every frame pulling a sleeping man
    // back upright against propuse's π/2 lie roll. The rig still animates,
    // which is what runs the breathing.
    if (n._propLie) { if (near) animChar(n.char, 0, dt); return; }

    // knocked out: topple to the floor, skip AI, then climb back up
    if (n.ko > 0) {
      n.ko -= dt;
      n.group.rotation.z = CBZ.damp(n.group.rotation.z, Math.PI / 2, 11, dt);
      if (near) animChar(n.char, 0, dt);
      return;
    } else if (n.group.rotation.z !== 0) {
      n.group.rotation.z = CBZ.damp(n.group.rotation.z, 0, 9, dt);
      if (Math.abs(n.group.rotation.z) < 0.02) n.group.rotation.z = 0;
    }

    // ---- BRAIN (time-sliced): the 4995-line brain runs every frame only for
    //      near/important NPCs; the rest re-decide on a round-robin so the
    //      crowd's per-frame brain cost stays flat. We pass ACCUMULATED dt so
    //      timers stay correct across the skipped frames. Movement still
    //      integrates every frame toward the last target (no stutter). ----
    let speed;
    if (CBZ.aiThink) {
      const stride = imp ? 1 : (near ? 3 : (d2 < FAR2() ? 7 : 16));
      n._aiAcc = (n._aiAcc || 0) + dt;
      if (stride === 1 || ((frame + n.slice) % stride === 0)) {
        speed = CBZ.aiThink(n, n._aiAcc) || n.speed;
        n._spd = speed; n._aiAcc = 0;
      } else {
        speed = n._spd != null ? n._spd : n.speed;
      }
    } else speed = n.speed;
    // NPC_SCHEDULES — jail nights: ordinary named inmates drift to the cell-
    // block side of their own patch after dark and post up there (long
    // pauses), so the yard reads asleep instead of pacing at 3am. The gang
    // crews used to be exempted here even after prisonschedule.js began
    // assigning every inmate a bed. That left assigned bodies awake in the
    // yard while their beds sat empty. A real brain state — fight, flee, hunt,
    // snitch — still outranks curfew; gang membership does not erase housing.
    // THE CLOCK IS NOW A SCHEDULE, NOT A BRIGHTNESS. `nightAmount > 0.72` was
    // this file's own guess at "is it late" — a lighting number standing in for
    // a prison timetable, which meant the yard emptied when the sky got dark
    // and for no other reason. systems/prisonschedule.js owns the real blocks
    // (evening return, secure, lights out) and hands each housed inmate a
    // patch of wing floor to stand count on (`_muster`); the brightness test
    // stays as the fallback for a build where that file is absent.
    const SCH = CBZ.prisonSchedule;
    const CFG2 = CBZ.CONFIG || {};
    const V2 = CFG2.PRISON_LIGHTSOUT_V2 !== false;
    const schedIn = SCH && SCH.enabled() ? SCH.indoors() : (CBZ.nightAmount || 0) > 0.72;
    const hasHousing = !!(n._muster || n._cellIdx != null);
    /* A BED IS OWED TO A MAN, NOT TO HIS TRADE — the third file to learn it.
       systems/prisonrest.js's §2 was widened to the factory predicate on
       2026-08-15 and this gate was not, so the wing's dealer, its merchants
       and its thieves were exempt from curfew and stood in the yard all night
       with racks reserved for them. `kind` is stamped at line 26 on every body
       this factory makes; the old `role` test stays as an OR. */
    const convict = V2 ? (n.kind === "inmate" || n.role === "inmate") : n.role === "inmate";
    const curfew = !!(CFG2.NPC_SCHEDULES && convict && hasHousing && !imp &&
        schedIn &&
        (!n.aiState || n.aiState === "wander" || n.aiState === "socialize"));
    if (curfew) {
      if (n._bedX == null) {          // one bunk spot per night, rolled once (runtime-only)
        const m = n._muster;          // the schedule's own muster patch, if it gave one
        const r = n.region;
        n._bedX = m ? m.x : (r ? r[0] + 0.5 + Math.random() * Math.max(1, r[1] - r[0] - 1) : gp.x);
        n._bedZ = m ? m.z : (r ? r[2] + 0.6 + Math.random() * 1.6 : gp.z);   // low-z edge = the cell-block side
      }
      /* A MAN WALKS THROUGH HIS UNIT'S DOOR, NOT THROUGH ITS WALL — and one
         door is not enough, because this mover is a straight line to `target`
         and systems/actorcollide.js is explicit that it will bump a wall the
         target is behind. systems/prisonschedule.js hands over an ORDERED
         ROUTE (`_muster.way`) authored off the wing's own records: the man's
         own lane across the throat, the cross-passage, his gallery or the
         centre hall, his own doorway, and only then the mattress. He walks the
         first leg he has not reached; the index is sticky so a body shoved
         backwards does not re-walk the compound. */
      const way = V2 && n._muster ? n._muster.way : null;
      if (way && way.length) {
        let wi = n._wayI | 0;
        if (wi >= way.length) wi = way.length - 1;
        while (wi < way.length - 1) {
          const w = way[wi];
          const wdx = w.x - gp.x, wdz = w.z - gp.z;
          if (wdx * wdx + wdz * wdz > 1.1 * 1.1) break;      // not on this leg yet
          wi++;
        }
        n._wayI = wi;
        const w = way[wi];
        n.target.set(w.x, 0, w.z);
        const ldx = w.x - gp.x, ldz = w.z - gp.z;
        // only the LAST leg settles him; pausing on a corridor leg is a plug
        if (wi === way.length - 1 && ldx * ldx + ldz * ldz < 1.2) n.pause = Math.max(n.pause || 0, 2.0);
      } else {
        const outside = n._muster && SCH && (SCH.inAssignedHousing
          ? !SCH.inAssignedHousing(n, gp.x, gp.z, -0.5)
          : !SCH.inBlock(gp.x, gp.z, -0.5));
        if (outside) {
          const route = n._muster.route;
          const rx = route ? route.x : 0, rz = route ? route.z : -9.8;
          const gate = CBZ.door;
          if (gate && !gate.open && !gate.blown) {
            /* LOCKED OUT. The block racked shut with him still in the yard —
               which a prison securing itself does — and the route home runs
               through a leaf that is not going to open for him. Walking at
               it put a dozen men on the throat every night, sliding along
               the gate and back into it until dawn (measured 23:00: 22 bodies
               grinding, 9% of the block's movement). He comes up to it,
               stops short, and waits for the screws like a man does. */
            const gd = Math.hypot(rx - gp.x, rz - gp.z);
            if (gd > 3.6) n.target.set(rx + (gp.x - rx) / gd * 3.0, 0, rz + (gp.z - rz) / gd * 3.0);
            else { n.target.set(gp.x, 0, gp.z); n.pause = Math.max(n.pause || 0, 2 + Math.random() * 3); }
          } else n.target.set(rx, 0, rz);
        }
        else n.target.set(n._bedX, 0, n._bedZ);
        const bdx = n.target.x - gp.x, bdz = n.target.z - gp.z;
        if (!outside && bdx * bdx + bdz * bdz < 1.2) n.pause = Math.max(n.pause || 0, 2.0); // settled in for the night
      }
    } else if (n._bedX != null && !schedIn) {
      n._bedX = n._bedZ = null;       // dawn — back to the day routine
    }

    speed = purposefulRoutine(n, dt, speed, gp, imp, curfew);
    // the stall recovery jiggles a man toward a fresh random spot; a body the
    // navigator is walking round a corner is not stuck, he is going the long way
    recoverStuck(n, dt, speed, gp, (curfew && V2 && !!(n._muster && n._muster.way))
      || !!(CBZ.prisonNav && CBZ.prisonNav.owns(n)));

    /* HOW TO GET THERE, asked once everybody has finished saying WHERE.
       The brain (order 18), the cell leash (21.9), the night muster and the bed
       above have all written `target` by this line; systems/prisonnav.js turns
       whatever it says into the next step of a walk that exists — round the
       wall, through the door — and leaves it alone when the straight line is
       already clear. It has to be called HERE and not from its own updater:
       the curfew branch twenty lines up writes `target` itself, so anything
       decided before this point is overwritten by the time we integrate. */
    // A man behind a SHUT cell leaf has his target clamped into his cell
    // first (world/cellblock.js npcConfine): the brain above may want the
    // hall, the navigator must be handed a point he can reach, or he runs on
    // the spot at the bars for as long as the brain wants out.
    if (CBZ.npcConfine) CBZ.npcConfine(n);
    if (CBZ.prisonNav) CBZ.prisonNav.step(n, dt);

    /* THE STEP. Two things this used to get wrong every frame, and both read
       as "glitchy" from the player's cell (owner, 2026-09-04: "fix glitchiness,
       there's a lot of glitchiness, getting stuck in cell"):

       · THE BODY HAD NO VELOCITY. Position moved `speed * dt` along whatever
         `target` said THIS frame, so a re-rolled target, a new waypoint or a
         pal's next step flipped a walking man's heading inside one frame and
         a body arriving at its goal went from full pace to a dead stop in
         one. Now the mover carries a velocity and turns it toward what the
         brain wants at a bounded rate (walking pace in about a quarter of a
         second), and a goal in plain sight is eased into over its last metre.
       · THE LEGS WERE FED THE ORDER, NOT THE GROUND. animChar got the speed
         the brain ASKED for, so a man held on a bunk frame, a jamb or another
         body by systems/actorcollide.js ran on the spot — the treadmill,
         wherever it happens. The walk cycle is now driven by what the body
         actually gained last frame after the wall resolver had its say
         (`_acX/_acZ`, stamped at order 25), less any knockback slide, so a
         body that is not going anywhere STANDS. */
    if (n.pause > 0) {
      n.pause -= dt;
      n._vx = n._vz = 0;
      if (near) animChar(n.char, 0, dt);
    } else {
      const dx = n.target.x - gp.x;
      const dz = n.target.z - gp.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.3) {
        if (!CBZ.aiThink) { n.pause = 0.8 + econ.rng() * 2.4; pickTarget(n); }
        else n.pause = 0.15;
        n._vx = n._vz = 0;
        if (near) animChar(n.char, 0, dt);
      } else {
        // a route leg or a muster leg is walked at full pace (the corner is
        // not the goal); a goal in plain sight is eased into over its last metre
        const leg = (n._muster && n._muster.way) || !!(CBZ.prisonNav && CBZ.prisonNav.owns(n));
        const want = (!leg && dist < 1.0) ? speed * Math.max(0.6, dist) : speed;
        const wx = (dx / dist) * want, wz = (dz / dist) * want;
        let vx = n._vx || 0, vz = n._vz || 0;
        let ex = wx - vx, ez = wz - vz;
        // getting going is quick (a man steps off in a tenth of a second);
        // turning and stopping are what the bound is for
        const along = (vx * wx + vz * wz) >= 0.6 * Math.hypot(vx, vz) * want;
        const el = Math.hypot(ex, ez), cap = (along ? ACCEL_UP : ACCEL) * dt;
        if (el > cap) { ex *= cap / el; ez *= cap / el; }
        vx += ex; vz += ez;
        n._vx = vx; n._vz = vz;
        gp.x += vx * dt;
        gp.z += vz * dt;
        const vl = Math.hypot(vx, vz);
        if (vl > 0.05) n.group.rotation.y = lerpAngle(n.group.rotation.y, Math.atan2(vx, vz), 1 - Math.pow(0.0001, dt));
        if (near) animChar(n.char, Math.min(vl, groundSpeed(n, dt) * 1.3 + 0.05), dt);
      }
    }
    if (near) poseRoutine(n, dt);

    // thieves still try to pickpocket the player when close (near only)
    if (n.role === "thief" && d2 < 400) {
      const d = Math.hypot(CBZ.player.pos.x - gp.x, CBZ.player.pos.z - gp.z);
      const msg = econ.thiefTick(n, dt, d);
      if (msg) CBZ.flashHint(msg, 1.8);
    }
  }
  CBZ.npcPickTarget = pickTarget;
  CBZ.spawnJailNpc = makeNpc;

  /* ---------- the cast ---------- */

  // The Old Timer — grey hair, hunched, general store on legs
  makeNpc({
    pos: [-22, 30], region: [-27, -15, 24, 40], role: "merchant", speed: 1.4,
    tagText: "Old Timer · shop", tagColor: "#ffd451",
    skin: jump("white", "the Old Timer", { hair: 0xdedede, hairStyle: "short", bald: false, beard: "full", ink: "", tank: false }),
    data: {
      name: "the Old Timer", pool: "goods", offer: econ.pickOffer("goods"),
      tip: "Psst, guards go blind in the searchlight glare. Use it.",
      talk: ["Been here 30 years, kid. I've got everything.",
             "Cigs talk. Everything else walks.",
             "Ramen's worth more than gold in here now, believe it."],
    },
  });

  // The Dealer — sells product (hangs out north of the armory)
  makeNpc({
    pos: [14, 18], region: [10, 17, 12, 24], role: "dealer", speed: 2.0,
    prisonOutfit: "cap",
    tagText: "Dealer · product", tagColor: "#b07aff",
    skin: jump("black", "the Dealer", { cap: 0x222222, shoes: 0x111111 }),
    data: {
      name: "the Dealer", pool: "drugs", offer: econ.pickOffer("drugs"),
      tip: "You didn't get it from me, yeah?",
      talk: ["I got the good stuff. Pills, powder, hooch.",
             "Keep it quiet and we both stay golden.",
             "Cigs up front. No tabs."],
    },
  });

  // A couple of thieves
  ["A", "B"].forEach((id, i) =>
    makeNpc({
      pos: [i ? -6 : 6, 38], region: [-14, 14, 26, 46], role: "thief", speed: 2.8,
      tagText: "Shifty Inmate", tagColor: "#ff7a7a",
      skin: jump(i ? "eastasian" : "white", "thief " + id, { legs: 0x3a3f47, torso: 0x3a3f47, collar: 0x2a2e34, arms: 0x3a3f47, shoes: 0x111111 }),
      data: { name: "a thief", pool: "fenced", offer: econ.pickOffer("fenced"),
        talk: ["Nice cigs. Be a shame if they vanished.", "Wanna buy? Fell off a truck, swear."] },
    })
  );

  // Background convicts (flavour + small deals) — kept in open yard, clear of rooms
  [[-8, 32], [6, 26], [-4, 44]].forEach((p, i) =>
    makeNpc({
      pos: p, region: [p[0] - 6, p[0] + 6, p[1] - 6, p[1] + 6], role: "inmate", speed: 1.8 + i * 0.3,
      tagText: "Inmate", tagColor: "#cfe9ff",
      skin: jump(["white", "black", "latino"][i], "convict " + i),
      data: { name: "an inmate", pool: "goods", offer: econ.pickOffer("goods"),
        talk: ["Yard time's the only time.", "Keep your head down out there.", "Heard the warden's got a key to the gun room."] },
    })
  );

  // Named gang crews. These give the social AI enough bodies to make
  // respect, debt, lookout cover, and retaliation feel like a block system.
  [
    { name: "Red Hook", tag: "Reds · shotcaller", gang: 0, crewRole: "shotcaller", pos: [-24, 28], region: [-30, -17, 22, 37], skin: 0xb84a36, speed: 2.0, personality: { greed: 0.42, nerve: 0.78, loyalty: 0.86, snitch: 0.18 },
      talk: ["Reds remember who pays and who bleeds.", "Respect opens doors. Debt closes fists."] },
    { name: "Mack", tag: "Reds · collector", gang: 0, crewRole: "collector", pos: [-19, 34], region: [-28, -12, 24, 43], skin: 0xc85c00, speed: 2.35, personality: { greed: 0.78, nerve: 0.64, loyalty: 0.62, snitch: 0.24 },
      talk: ["Tabs are not suggestions.", "You walk loud, you pay loud."] },
    { name: "Peep", tag: "Reds · lookout", gang: 0, crewRole: "lookout", pos: [-13, 23], region: [-24, -8, 18, 34], skin: 0xff7a1a, speed: 2.55, personality: { greed: 0.32, nerve: 0.48, loyalty: 0.78, snitch: 0.36 },
      talk: ["I see guards before guards see me.", "Move when the sweep looks away."] },
    { name: "Blue Ace", tag: "Blues · shotcaller", gang: 1, crewRole: "shotcaller", pos: [22, 17], region: [15, 30, 10, 27], skin: 0x3b7bff, speed: 2.05, personality: { greed: 0.48, nerve: 0.76, loyalty: 0.82, snitch: 0.22 },
      talk: ["Blues trade clean, fight dirty.", "Crew work buys crew cover."] },
    { name: "Dice", tag: "Blues · runner", gang: 1, crewRole: "runner", pos: [16, 25], region: [9, 27, 15, 34], skin: 0x2f65d9, speed: 2.75, personality: { greed: 0.68, nerve: 0.52, loyalty: 0.58, snitch: 0.28 },
      talk: ["I can move anything small enough to hide.", "Cigs turn rumors into routes."] },
    { name: "Stone", tag: "Blues · enforcer", gang: 1, crewRole: "enforcer", pos: [27, 13], region: [18, 32, 6, 24], skin: 0x254a9f, speed: 2.25, personality: { greed: 0.35, nerve: 0.86, loyalty: 0.74, snitch: 0.14 },
      talk: ["Some people need a wall in front of them.", "Disrespect travels. So do I."] },
  ].forEach((m) => makeNpc({
    pos: m.pos, region: m.region, role: m.crewRole === "runner" ? "thief" : "inmate", speed: m.speed,
    gang: m.gang, crewRole: m.crewRole, personality: m.personality,
    tagText: m.tag, tagColor: m.gang === 0 ? "#ff7979" : "#7aa6ff",
    // Everyone wears the SAME prison orange — you can't tell a gang by their
    // jumpsuit, only by who they run with (name tag / radar). Realistic.
    // The cars sort the way real yards do: the Reds run Latino, the Blues run
    // Black. Each man's own look (ink, beard, tank) is rolled off his name.
    skin: jump(m.gang === 0 ? "latino" : "black", m.name),
    data: {
      name: m.name, pool: m.crewRole === "runner" ? "fenced" : "goods", offer: econ.pickOffer(m.crewRole === "runner" ? "fenced" : "goods"),
      crewRole: m.crewRole,
      tip: m.talk[0],
      talk: m.talk,
    },
  }));

  /* ---------- the EXPANDED cast ----------
     A much bigger, more varied population spread across the original yard
     AND the new South Block. Every entry showcases that CAPABILITY (ratings)
     and TEMPERAMENT (behavior) are independent: gentle giants who'll wreck
     anyone who starts with them, weak hotheads who swing at the world,
     brilliant cowards, immovable walls. Most are loners (forceNeutral) so
     they stay in their district instead of marching to a gang turf. */

  // a standard prison-orange jumpsuit on a MAN OF A HERITAGE (entities/
  // heritage.js). jump("latino", "Hector") rolls Hector's look deterministically
  // off his name; `over` pins any field (hair, beard, ink, tank, hairStyle…).
  // The legacy jump(skinHex, hairHex, opts) form still works for a one-off.
  function jump(heritage, name, over) {
    const base = { legs: 0xff7a1a, torso: 0xff7a1a, collar: 0xff9747, arms: 0xff7a1a, stripes: 0xc85c00, shoes: 0x2b2b2b };
    if (typeof heritage === "number") return Object.assign(base, { skin: heritage, hair: name }, over || {});
    const look = CBZ.heritageRoll ? CBZ.heritageRoll(heritage, typeof name === "string" ? name : undefined, over)
      : Object.assign({ skin: 0xc08a5a, hair: 0x2a2018 }, over || {});
    return Object.assign(base, look);
  }
  // the crowd's roll: heritage by weight, then the look — one seeded stream
  function crowdLook(rr) {
    if (!CBZ.heritageRoll) return jump(0xc08a5a, 0x2a2018);
    return Object.assign({ legs: 0xff7a1a, torso: 0xff7a1a, collar: 0xff9747, arms: 0xff7a1a, stripes: 0xc85c00, shoes: 0x2b2b2b },
      CBZ.heritageRoll(null, rr));
  }

  const ROSTER = [
    // ===== showcase legends in the original north yard =====
    { name: "Tiny", tag: "Tiny", color: "#cfe9ff", pos: [-7, 18], box: [-14, 2, 10, 30], role: "inmate", neutral: true, speed: 1.6,
      behavior: "defensive", ratings: { fighting: 96, toughness: 99, speed: 28, cunning: 30 }, skin: jump("black", "Tiny", { beard: "full", collar: 0xff9747 }),
      talk: ["I don't start nothin'. I just finish it.", "Leave me be and we're fine, friend."] },
    { name: "Mad Dog Mickey", tag: "Mad Dog", color: "#ff9a7a", pos: [4, 30], box: [-12, 14, 22, 44], role: "inmate", neutral: true, speed: 2.7,
      behavior: "predator", ratings: { fighting: 34, toughness: 36, speed: 64, cunning: 22 }, skin: jump("white", "Mad Dog Mickey", { hairStyle: "buzz", ink: "web", tank: true }),
      talk: ["You wanna go?! HUH?!", "I'll take ALL of yas!"] },
    { name: "the Professor", tag: "the Professor", color: "#b9e6ff", pos: [-9, 40], box: [-16, -2, 32, 48], role: "inmate", neutral: true, speed: 1.5,
      behavior: "pacifist", ratings: { fighting: 16, toughness: 28, speed: 40, cunning: 97, stealth: 72 }, skin: jump("white", "the Professor", { hair: 0xb9b1a6, hairStyle: "short", beard: "full", bald: false, ink: "", tank: false }),
      talk: ["Violence is a failure of imagination.", "I can get you anything but a fistfight."] },

    // ===== extra north-yard background convicts (gang fodder) =====
    { name: "Vince", tag: "Inmate", color: "#cfe9ff", pos: [10, 36], box: [2, 16, 28, 46], role: "inmate", speed: 2.0,
      behavior: "hothead", skin: jump("latino", "Vince"), talk: ["Yard's mine when I say so.", "Don't crowd me."] },
    { name: "Lou", tag: "Inmate", color: "#cfe9ff", pos: [-13, 14], box: [-18, -6, 8, 26], role: "inmate", speed: 1.9,
      behavior: "opportunist", skin: jump("white", "Lou"), talk: ["Pick a winner, back a winner.", "I only fight what's already losin'."] },
    { name: "Hector", tag: "Inmate", color: "#cfe9ff", pos: [12, 44], box: [4, 18, 36, 48], role: "inmate", speed: 2.1,
      behavior: "defensive", skin: jump("latino", "Hector", { ink: "chicano", tank: true }), talk: ["Keep walkin'.", "I mind mine. You mind yours."] },

    // ===== WORKSHOP (south-west) — welders & grinders =====
    { name: "Rivet", tag: "Workshop", color: "#ffcf8a", pos: [-33, 68], box: [-41, -24, 60, 78], role: "inmate", neutral: true, speed: 1.7,
      behavior: "defensive", ratings: { fighting: 72, toughness: 84, speed: 34 }, skin: jump("latino", "Rivet", { collar: 0x6b4a2a }),
      talk: ["Mind the sparks.", "I bend steel, not the truth."] },
    { name: "Sparks", tag: "Workshop", color: "#ffcf8a", pos: [-28, 74], box: [-40, -22, 62, 80], role: "inmate", neutral: true, speed: 2.3,
      behavior: "hothead", ratings: { fighting: 46, toughness: 44, speed: 58 }, skin: jump("white", "Sparks", { hair: 0xa3401f, bald: false }),
      talk: ["Watch it, watch it!", "You lookin' at my bench?"] },
    { name: "Bolt", tag: "Workshop", color: "#ffcf8a", pos: [-36, 74], box: [-42, -26, 64, 80], role: "inmate", neutral: true, speed: 1.9,
      behavior: "protector", ratings: { fighting: 64, toughness: 70, speed: 44 }, skin: jump("black", "Bolt"),
      talk: ["Nobody gets jumped on my floor.", "We look out for our crew down here."] },

    // ===== CHAPEL (south-east) — the quiet wing =====
    { name: "Brother Amos", tag: "Chapel", outfit: "chapel", color: "#e7d8ff", pos: [33, 68], box: [25, 41, 60, 78], role: "inmate", neutral: true, speed: 1.3,
      behavior: "pacifist", ratings: { fighting: 22, toughness: 40, cunning: 86, stealth: 60 }, skin: jump("black", "Brother Amos", { hair: 0xdedede, beard: "full", ink: "", tank: false, torso: 0x4a4f57, legs: 0x4a4f57, arms: 0x4a4f57, stripes: 0x000000 }),
      talk: ["Peace, brother. Always peace.", "Even in here, grace finds a way."] },
    { name: "Deacon", tag: "Chapel", color: "#e7d8ff", pos: [37, 73], box: [28, 42, 62, 80], role: "inmate", neutral: true, speed: 1.7,
      behavior: "defensive", ratings: { fighting: 66, toughness: 72 }, skin: jump("black", "Deacon", { tank: false }),
      talk: ["I keep the peace in the pews.", "Turn the other cheek, once."] },
    { name: "Solomon", tag: "Chapel", color: "#e7d8ff", pos: [30, 76], box: [25, 40, 66, 80], role: "inmate", neutral: true, speed: 1.4,
      behavior: "pacifist", ratings: { fighting: 30, toughness: 50, cunning: 70 }, skin: jump("white", "Solomon", { beard: "full", tank: false }),
      talk: ["Let it go, son.", "Not here. Not in here."] },

    // ===== INFIRMARY (east) — the doc + the sick =====
    { name: "Doc Mercer", tag: "Infirmary · meds", outfit: "orderly", color: "#9fe6c0", pos: [33, 96], box: [26, 41, 88, 104], role: "merchant", neutral: true, speed: 1.4,
      behavior: "pacifist", ratings: { fighting: 28, toughness: 46, cunning: 90, stealth: 55 }, skin: jump("white", "Doc Mercer", { hair: 0xcfcfcf, bald: false, ink: "", tank: false, torso: 0xeef2f5, arms: 0xeef2f5, legs: 0xeef2f5, collar: 0xeef2f5, stripes: 0x000000 }),
      data: { name: "Doc Mercer", pool: "goods", tip: "Bad cut? I've patched worse for less.",
        talk: ["I keep folks breathing in here.", "Painkillers for cigs. Don't tell the Warden."] } },
    { name: "Patient Zero", tag: "Infirmary", color: "#9fe6c0", pos: [29, 100], box: [25, 40, 90, 104], role: "inmate", neutral: true, speed: 1.5,
      behavior: "unpredictable", ratings: { fighting: 22, toughness: 26, speed: 30 }, skin: jump("white", "Patient Zero", { skin: 0xfae0c8, hair: 0x6a6a6a, beard: "stubble", tank: false }),
      talk: ["...is it cold in here?", "They said I'd be out by spring. Which spring?"] },
    { name: "Orderly Pratt", tag: "Infirmary", outfit: "orderly", color: "#9fe6c0", pos: [37, 100], box: [28, 42, 90, 104], role: "inmate", neutral: true, speed: 1.9,
      behavior: "defensive", ratings: { fighting: 56, toughness: 64 }, skin: jump("latino", "Orderly Pratt", { ink: "", tank: false, torso: 0xeef2f5, arms: 0xeef2f5 }),
      talk: ["No rough stuff near the beds.", "I'll sedate the next one who swings."] },

    // ===== LAUNDRY (west) — steam, carts & sticky fingers =====
    { name: "Suds", tag: "Laundry", color: "#bfeaff", pos: [-33, 96], box: [-41, -26, 88, 104], role: "thief", neutral: true, speed: 2.6,
      behavior: "opportunist", ratings: { fighting: 48, speed: 72, stealth: 80, cunning: 64 }, skin: jump("white", "Suds"),
      data: { name: "Suds", pool: "fenced", talk: ["Pockets lighter than your laundry, huh?", "Everything comes out in the wash."] } },
    { name: "Wringer", tag: "Laundry", color: "#bfeaff", pos: [-37, 100], box: [-42, -27, 90, 104], role: "inmate", neutral: true, speed: 2.0,
      behavior: "bully", ratings: { fighting: 76, toughness: 66, speed: 50 }, skin: jump("black", "Wringer", { ink: "script", tank: true }),
      talk: ["Little guys do my folding.", "You got a problem? Didn't think so."] },

    // ===== LOWER EXERCISE YARD (center-south) — the real fighters =====
    { name: "Iron Mike", tag: "Yard Apex", color: "#ff7979", pos: [0, 92], box: [-14, 14, 80, 110], role: "inmate", neutral: true, speed: 2.2,
      behavior: "predator", ratings: { fighting: 93, toughness: 90, speed: 60, cunning: 55 }, skin: jump("black", "Iron Mike", { bald: true, beard: "goatee", ink: "chest", tank: true, collar: 0x222222 }),
      talk: ["Everybody bleeds. Step up.", "This whole yard's mine to take."] },
    { name: "Knuckles", tag: "Brawler", color: "#ffc07a", pos: [-8, 100], box: [-18, 8, 86, 116], role: "inmate", neutral: true, speed: 2.4,
      behavior: "hothead", ratings: { fighting: 88, toughness: 72, speed: 66 }, skin: jump("latino", "Knuckles", { ink: "chicano", tank: true }),
      talk: ["Put 'em up! Let's GO!", "I been waitin' all day for this."] },
    { name: "Glass Jaw", tag: "Brawler", color: "#ffc07a", pos: [8, 100], box: [-6, 18, 86, 116], role: "inmate", neutral: true, speed: 2.3,
      behavior: "bully", ratings: { fighting: 82, toughness: 28, speed: 58 }, skin: jump("white", "Glass Jaw"),
      talk: ["I hit like a truck, just don't hit back.", "Easy pickings, easy pickings."] },
    { name: "The Wall", tag: "Immovable", color: "#cfe9ff", pos: [-12, 110], box: [-20, 2, 100, 120], role: "inmate", neutral: true, speed: 1.3,
      behavior: "defensive", ratings: { fighting: 52, toughness: 98, speed: 22 }, skin: jump("islander", "The Wall", { ink: "tribal", tank: true }),
      talk: ["You'll tire before I move.", "Go around."] },
    { name: "Sprinter", tag: "Trackster", color: "#a6ffd0", pos: [10, 112], box: [-16, 16, 100, 122], role: "inmate", neutral: true, speed: 3.4,
      behavior: "pacifist", ratings: { fighting: 38, toughness: 40, speed: 98, stealth: 78 }, skin: jump("black", "Sprinter", { tank: true }),
      talk: ["Can't hit what you can't catch!", "I run laps, not my mouth."] },
    { name: "Boss Hask", tag: "South Yard Boss", color: "#ffd451", pos: [0, 116], box: [-16, 16, 106, 124], role: "inmate", neutral: true, speed: 1.8,
      behavior: "protector", ratings: { fighting: 85, toughness: 84, speed: 48, cunning: 78 }, skin: jump("black", "Boss Hask", { beard: "full", collar: 0x3a2a1a }),
      talk: ["Down here, you answer to me.", "I keep my people standing. Remember that."] },

    // ===== a few athletes jogging the lower track =====
    { name: "Jab", tag: "Trackster", color: "#a6ffd0", pos: [-4, 84], box: [-14, 14, 76, 100], role: "inmate", neutral: true, speed: 2.6,
      behavior: "unpredictable", ratings: { fighting: 58, speed: 80 }, skin: jump("white", "Jab"), talk: ["Lap forty. Who's counting.", "Footwork, baby."] },
    { name: "Cardio", tag: "Trackster", color: "#a6ffd0", pos: [5, 86], box: [-12, 16, 78, 102], role: "inmate", neutral: true, speed: 2.8,
      behavior: "pacifist", ratings: { fighting: 30, speed: 88 }, skin: jump("latino", "Cardio"), talk: ["No time to scrap, on a streak here.", "Keep movin'."] },

    // ===== sally-port loiterers near the new gate =====
    { name: "Lifer", tag: "Sally Port", color: "#d8d8d8", pos: [-10, 122], box: [-20, -2, 116, 126], role: "inmate", neutral: true, speed: 1.5,
      behavior: "defensive", ratings: { fighting: 78, toughness: 80, cunning: 70 }, skin: jump("native", "Lifer", { hair: 0xb9b1a6, hairStyle: "long", bald: false }),
      talk: ["Forty years. The gate stopped meaning anything.", "Run if you want. I'll watch."] },
    { name: "Twitch", tag: "Sally Port", color: "#d8d8d8", pos: [12, 122], box: [2, 20, 116, 126], role: "thief", neutral: true, speed: 2.9,
      behavior: "opportunist", ratings: { fighting: 40, speed: 84, stealth: 86 }, skin: jump("white", "Twitch", { hairStyle: "crop" }),
      data: { name: "Twitch", pool: "fenced", talk: ["So close to out, so much to lift.", "Nervous? Me? Nah. Nah nah nah."] } },
  ];

  ROSTER.forEach((m) => makeNpc({
    pos: m.pos, region: m.box, role: m.role, speed: m.speed,
    gang: m.gang == null ? null : m.gang, forceNeutral: !!m.neutral,
    behavior: m.behavior, ratings: m.ratings, prisonOutfit: m.outfit || "inmate",
    tagText: m.tag, tagColor: m.color, skin: m.skin,
    data: m.data || {
      name: m.name,
      pool: m.role === "thief" ? "fenced" : "goods",
      offer: econ.pickOffer(m.role === "thief" ? "fenced" : "goods"),
      talk: m.talk || ["...", "Yeah?"],
    },
  }));

  /* ---------- the CROWD ----------
     A big procedural population on top of the named cast so the yard reads
     as a PACKED prison, not a sparse one. Tunable via window.CBZ.JAIL_CROWD
     (set before load). The LOD + AI time-slicing in updateNpc + the O(n) grid
     separation keep it smooth; per-part InstancedMesh is the next step to
     push this into the thousands. */
  /* HOW MANY EXTRAS THE BUILDING CAN STILL SLEEP.

     JAIL_CROWD is the same kind of body as MASS_CROWD — an anonymous inmate
     with no name, no history and no part in the story — so it answers to the
     same fact, and for the same reason: the wing has twenty-five cells, and the
     count that put ~207 men in front of them could not see that. Load order
     makes it exact (index.html: cellblock 456 -> this file 535): the wing is
     built, the named ROSTER above is already on the floor, and what is left is
     arithmetic. See world/cellblock.js's prisonBeds block for the occupancy
     figures and their source.

     The NAMED cast is deliberately NOT trimmed here. Those men are the game —
     they have faces, tempers and grudges — and where they overshoot the wing,
     the honest answer is a bigger wing, not a shorter cast. CBZ.prisonPopulationAudit()
     prints that overshoot as a live number so it stays visible instead of
     becoming folklore. An explicit CBZ.JAIL_CROWD (someone typing a count on
     purpose) still wins. */
  const wing = CBZ.prisonBeds ? CBZ.prisonBeds() : null;
  const CROWD = (typeof CBZ.JAIL_CROWD === "number" && CBZ.JAIL_CROWD_EXPLICIT) ? CBZ.JAIL_CROWD
    : (wing ? Math.max(0, wing.houses - CBZ.npcs.length - wing.cells)
            : ((typeof CBZ.JAIL_CROWD === "number") ? CBZ.JAIL_CROWD : 26));
  (function spawnCrowd(count) {
    let s = 0x4a1f7b;
    const rr = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
    const BEH = ["defensive", "hothead", "opportunist", "pacifist", "predator", "bully", "protector", "unpredictable", "defensive", "pacifist"];
    // the crowd's faces come from the heritage catalogue (weighted), not from
    // two independent colour pools — see entities/heritage.js.
    // open spawn boxes: north yard + south block (avoid the cell block z<-8)
    // open spawn boxes: the two yards, and (2026-09-05) the ring's rooms and
    // corridors, so the half of the map that had no bodies has bodies
    const ZONES = [[-28, 28, -6, 50], [-42, 42, 56, 124],
      [-106, -52, -94, -18],        // the recreation yard
      [-110, -72, 0, 40],           // prison industries
      [62, 106, 64, 92],            // the kitchen
      [66, 106, 106, 124],          // visitation
      [-41.5, -38.5, -60, 40],      // the west spine
      [38.5, 41.5, -60, 40]];       // the east spine
    for (let i = 0; i < count; i++) {
      const z = ZONES[rr() < 0.42 ? 0 : 1];
      const x = z[0] + rr() * (z[1] - z[0]);
      const zz = z[2] + rr() * (z[3] - z[2]);
      makeNpc({
        pos: [x, zz], region: [x - 7, x + 7, zz - 7, zz + 7], role: "inmate",
        speed: 1.5 + rr() * 1.6, forceNeutral: rr() < 0.72, behavior: BEH[(rr() * BEH.length) | 0],
        tagText: "Inmate", tagColor: "#cfe9ff",
        skin: crowdLook(rr),
        data: { name: "an inmate", pool: "goods", talk: ["Yard time's all we got.", "Keep walkin'.", "Mind your business."] },
      });
    }
  })(CROWD);

  // make sure every vendor/thief has a tradeable offer for their pool
  for (const n of CBZ.npcs) {
    if (n.data && n.data.pool && !n.data.offer) n.data.offer = econ.pickOffer(n.data.pool);
  }

  CBZ.updateNpc = updateNpc;
  CBZ.onUpdate(22, function (dt) {
    if (CBZ.game.mode !== "escape") return;
    frame++;
    const cam = CBZ.camera.position, cx = cam.x, cz = cam.z;
    const npcs = CBZ.npcs;
    for (let i = 0; i < npcs.length; i++) updateNpc(npcs[i], dt, cx, cz);
  });
})();
