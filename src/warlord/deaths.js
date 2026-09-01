/* ============================================================
   warlord/deaths.js — A MAN DYING IS A SEQUENCE, NOT A BOOLEAN.

   THE REPORT (owner): "death isn't shown — look how cinematic death is in
   gang city. Death in warlord is instant, completely violates show don't
   tell."

   He is right, and this file exists because the reason is not "nobody wrote
   the effect". Every piece of gang city's death is already in this repo, most
   of it is already on this page, and warlord was skipping it for four
   separate, individually boring reasons. They are named here because a fix
   with no diagnosis in it is a fix nobody can check.

   ------------------------------------------------------------ WHAT GANG CITY
   DOES ON A DEATH, in call order (src/city/peds.js:2731, cityKillPed):

     1  the record dies            dead=true, deadT=0, hp=0
     2  the gun leaves the hand    cityDeathDrop  (morgue.js)
     3  THE BLOOD                  CBZ.gore(x, y+1, z, {dir, amount, cloth,
                                   skin})  — systems/gore.js:2447. A forward
                                   spray of droplets that each leave a splat
                                   where they land, an aerosol mist, a ground
                                   pool that GROWS and darkens, a wall splat
                                   on whatever is behind him, an entry wound
                                   stamped on the actual body (wounds.js), and
                                   in its tail a lens jolt + a red vignette.
     4  THE BODY                   CBZ.cityRagdoll(ped, point, dir, mag)
                                   — city/ragdoll.js:386. 13 verlet points,
                                   and crucially a DYING BEAT: 0.12–0.34 s
                                   where the knees buckle and the frame
                                   lurches a stagger-step along the round
                                   before it goes limp.
     5  the cheap path             only when 4 refuses: body.hit + a knockdown
     6  the world reacts           cityAlarm, cityPanic, the feed, the morgue
     7  and BEFORE all of it       fpsmode.js:2382 already spent
                                   CBZ.doHitstop(0.05 / 0.085 head) and
                                   CBZ.doSlowmo(0.18) on a fatal headshot.

   ------------------------------------------------------------ WHAT WARLORD
   WAS SKIPPING, and why each one. This is the actual bug list:

     A  NO BLOOD, AND IT IS A MISSING FILE. games/warlord.html asks
        studio.need() for ["caps","people","ragdoll","fx","damage","sound",
        "batch"]. systems/gore.js lives in the studio pack called "blood" and
        that pack is not in the list — deliberately, per studio.js's own
        comment ("a fair-weather pack … 2.5k lines should not ride along on a
        battle of riflemen"). Which was a fine call for a page of riflemen who
        never bleed and the wrong one for a page whose whole subject is men
        dying. So a warlord death produced literally zero pixels of blood, and
        no amount of tuning inside battle.js could have produced one.
        FIX: this file asks studio.need("blood") at battle time — by PACK NAME,
        through the loader the page already uses, which is the seam law
        (route the name, never fork the file). It is one HTTP request on the
        first battle of a session, and it is skipped entirely under ?blood=0.

     B  NO TIME. CBZ.doHitstop / CBZ.doSlowmo are declared in core/loop.js —
        THE CITY'S FRAME LOOP. This page runs core/microboot.js, which has no
        such thing. So systems/fpsmode.js, which is now the warlord's actual
        gun, has been calling doHitstop on every landed round and doSlowmo on
        every fatal headshot since the day gunplay.js mounted it, into
        `undefined`, silently, forever. A whole shipped feature was dead
        because of one file that is not on this page.
        FIX: declared here with core/loop.js's exact semantics (max-latch,
        real-time decay, hitstop 0.06 beats slowmo 0.32), and battle.js's
        frame multiplies its dt by warpDt(). Nothing in fpsmode changed.

     C  THE FALL WAS A PLANK, ON ONE AXIS, WITH NO BEAT IN FRONT OF IT.
        battle.js's own words for the cheap path were:

            m.dieT = Math.min(1, m.dieT + sdt * 2.4);
            m.group.rotation.x = m.dieDir * k * (PI/2 - 0.07);

        Three things wrong, and all three are visible in a still:
          · dieDir is a COIN FLIP (`lcg() < 0.5 ? -1 : 1`). The direction a man
            falls has nothing to do with where the round came from. A man shot
            in the back falls backwards half the time.
          · deathPose fires on frame ZERO, so the corpse SNAPS into its final
            face-down sprawl — arms flung, knees drawn up — while still
            standing bolt upright, and only then tips over. That single frame
            is the whole "instant" the owner is describing. You cannot show a
            man being hit if he is already dead-posed before he falls.
          · there is no beat between the round arriving and the body going
            limp. city/ragdoll.js has one and prices it off the round's own
            energy (ragdoll.js:350):
                 dyt = clamp(0.34 - (m-1)*0.012, 0.12, 0.34)
            A man shot with a pistol stumbles for a third of a second; a man
            hit by a shotgun does not. That is the difference between a death
            and a state flip and it costs nothing to reuse.
          · AND IT WENT PAST FLAT. This one was not known until this file was
            measured against it. The PI/2 - 0.07 cap is on `rotation.x`
            ALONE, and warlord/sand.js's plant() has already written a
            QUATERNION that leans the man into the slope he is standing on —
            so the composed tilt is the cap PLUS the lean. MEASURED on a dune
            at seed 1337: the old corpse settled at 129.3 degrees off
            vertical, i.e. 39 degrees PAST flat, head-and-shoulders down
            through the sand. That is exactly the "backwards body" failure
            systems/grapple.js:411 warns about in its own comment, arriving
            by a route grapple.js could not see. The fold here composes onto
            the planted stance instead of overwriting one axis of it, and the
            same corpse settles at 81.7 degrees.
        FIX: THE FOUR BEATS below. Every corpse gets them, including the ones
        that get nothing else, because they cost six floats a frame.

     D  NO SOUND, NO LENS, NO EVENT. battle.js emits none of the battle:*
        names warlord/feel.js has been listening for since it was written
        (feel.js:1476 says so in a comment: "None of them exist yet"). So the
        break shout, the rout shout and the morale voice — all built, all
        tested — have never once fired in a real battle. This file emits
        battle:kill / battle:break / battle:rout at the frame they happen.
        feel.js has no battle:kill row yet; that is feel.js's line to add, and
        it is in the report.

   ------------------------------------------------------------ THE HARD PART:
   WHO GETS THE CINEMATIC. 300 men a side. A volley kills forty in one
   sub-step. Gang city's full sequence forty times in one frame is not a
   feature, it is a hang. So there is a budget, and the budget is the design.

   FIRST, WHAT IS ACTUALLY SCARCE, measured off the engine rather than guessed:
     · city/ragdoll.js solves at most RAGDOLL_ACTIVE bodies at once — 28 on
       this page (games/warlord.html:462) — out of a pool of 110, and refuses
       past RAGDOLL_RANGE (170 m here, i.e. the whole field).
     · systems/gore.js refuses outright past 70 m (gore.js:2453) and halves
       its particle count past 40 m. So a gore() call at 90 m is already free
       AND already invisible: there is no budget to write for it, the engine
       has one.
   So the scarce thing is THE 28 SLOTS, and the ceiling is not mine to invent:
   it is `ragdollAudit().cap - .solving`, asked every frame.

   SECOND, AND THIS IS THE ACTUAL BUG IN THE OLD BUDGET: ragdoll.js spends
   those 28 slots in ARRIVAL ORDER. Whoever's killMan() ran first this frame
   gets a body; the rest get the plank. killMan runs from `for (i=0; i<men.
   length; i++) stepMan(men[i])`, so arrival order is SPAWN INDEX — a number
   with no relationship to the camera, to you, or to the battle. Measured on a
   300 v 300 opening volley: the man you shot in the face at four metres loses
   his body to a levy at 160 m who merely happens to sit earlier in the array.
   That is not a budget, it is a raffle.

   THIRD, THE RULE. Three questions, first YES wins, stated so it is arguable:

     TIER 2 — THE DEATH IS ABOUT YOU. Either you pulled the trigger, or the
       man's death decides the battle (he is the last man standing on his
       side, or his death crosses brokenSide()'s threshold — battle.js's own
       function, the same one checkEnd uses). NEVER budget-culled and never
       counted against the budget. This is warlord/feel.js's own law about
       audio, applied to the picture: "your own trigger is never a candidate.
       The one sound in the mix you caused must never be the one that got
       culled." It is bounded by fact rather than by a cap — you fire about
       ten rounds a second and a battle has a handful of decisive deaths.
       Tier 2 is also the only tier that spends TIME (hitstop) and the LENS.

     TIER 1 — YOU CAN SEE IT. Inside gore.js's own 70 m gate and in front of
       the camera (dot with the camera's forward > 0). Ranked NEAREST FIRST
       and spent against the solver's free slots. Gets blood and a body if a
       slot is left, and the four beats regardless.

     TIER 0 — EVERYTHING ELSE. A levy dying 180 m out on the far wing. He
       gets the four beats and nothing else: he falls away from the round that
       killed him, he takes his stagger, and he folds on his own clock. From
       180 m that is all you could resolve anyway, and it is six float writes.

   THE ONE-FRAME DEFERRAL, because it is the only unobvious thing in here. A
   death cannot wait — `dead = true` has to be now or the sim disagrees with
   itself. But RANKING can only happen once you have seen the whole frame's
   worth of deaths. So fell() flips the state and arms the beats immediately
   and puts the man on a queue; warpDt(), called once per frame at the top of
   battle.js's frame, drains the previous frame's queue in rank order. The
   ragdoll kick therefore lands one frame (≈16 ms) after the round. A verlet
   impulse arriving 16 ms late is not observable; a raffle is.

   ------------------------------------------------------------ SHOW DON'T
   TELL, THE REST OF IT. battle.js's kill feed printed "HAKIM DOWN" and
   "HAKIM BREAKS" into a five-line text box. Two problems: you do not know who
   Hakim is, and the line does not tell you the one thing you would actually
   act on — WHERE. So the words are gone and THE RIM answers instead: a short
   tick on the edge of the screen at the world bearing of the man, red when
   one of yours falls and amber when one of yours breaks. It carries strictly
   more than the sentence did (direction), and none of what the sentence
   carried was usable (a name you have not learned). Colours are battle.js's
   own HP-bar hexes, not new ones. The cap is 12, which is city/killfeed.js's
   own CAP for exactly the same quantity.

   ------------------------------------------------------------ FLAGS
     ?deaths=old   THE A/B. Every path in here reverts to what battle.js did
                   before this file existed: pose on frame zero, one-axis
                   coin-flip plank at 2.4/s, no blood, no time, no rim. It is
                   implemented HERE rather than left behind in battle.js so
                   there is one death path in the game and not two.
     ?deaths=1     log every tier decision to the console
     ?blood=0      do not fetch systems/gore.js (the studio "blood" pack)
     ?rim=old      no rim marks. The words are gone from battle.js for good
                   (deleting a redundant text panel is not a switchable
                   behaviour), so this reverts the PICTURE and nothing else.

   WHAT THIS FILE REUSES AND DOES NOT REIMPLEMENT: CBZ.gore, CBZ.cityRagdoll /
   ragdollStep / ragdollDrop / ragdollAudit, CBZ.deathPose, CBZ.bodyWound (via
   gore's own actor seam), CBZ.sfx, CBZ.shake (wrapped by feel.js, which owns
   the shake budget), W.feel.hitStop for the audio half of a hit-stop, and
   battle.js's brokenSide() for what "decisive" means. What is NEW here: the
   four beats, the tier rule, the frame drain, and the rim.
============================================================ */
(function () {
  "use strict";
  const G = (typeof window !== "undefined" ? window : globalThis);
  const CBZ = (G.CBZ = G.CBZ || {});
  const W = (CBZ.warlord = CBZ.warlord || {});
  const D = (W.deaths = W.deaths || {});

  const QP = (function () {
    try { return new URLSearchParams(G.location ? G.location.search : ""); }
    catch (e) { return { get: function () { return null; } }; }
  })();
  const OLD = QP.get("deaths") === "old" || QP.get("deaths") === "0";
  const DEBUG = QP.get("deaths") === "1";
  const NO_BLOOD = QP.get("blood") === "0";
  const RIM_OLD = QP.get("rim") === "old";

  /* EVERY SWALLOW LEAVES A RECEIPT. This file calls five engine services that
     are each allowed to be absent, so it has to catch — and a bare catch is
     exactly how the bug this file exists to fix survived for months. The last
     message is kept and reported in audit(), so "the blood ran and drew
     nothing" is one query away instead of a bisect. Measured: the first run of
     this file swallowed a TypeError out of CBZ.gore on every single death and
     the only symptom was `bloodEvents: 1` beside `bits: 0`. */
  let lastErr = null;
  function safe(fn) {
    try { return fn(); }
    catch (e) {
      lastErr = (e && e.message) ? e.message : String(e);
      if (DEBUG) console.warn("[deaths]", e);
      return null;
    }
  }
  const clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };

  /* ============================================================ THE NUMBERS
     Every one is read off something that already exists in the repo, and the
     something is named. Nothing here was chosen because it looked right.

     GORE_M      70 m. systems/gore.js:2453 returns immediately past 70 m.
                 Not a taste number and not a second opinion — it is the line
                 the blood system already draws, so asking for blood past it
                 is asking for nothing. Reading it rather than restating it is
                 not possible (it is a literal inside the IIFE), so it is
                 quoted here with its line number and that is the contract.
     OWN_M       6 m. warlord/feel.js:137's own constant, with its own
                 justification: "inside this it is you or the man at your
                 elbow". Used for the one thing it means here — whether a
                 death that is not YOURS is still close enough to move the
                 lens. THE LENS IS FOR WHAT IS DONE TO YOU.
     HIP_Y/KNEE_Y  0.95 / 0.475 m. city/ragdoll.js:118-127's own mass-point
                 table for this exact rig. The buckle dip below is derived
                 from them rather than typed: a knee folding through an angle
                 f drops the hips by thigh*(1-cos f), and thigh = HIP_Y-KNEE_Y.
     FOLD_K      7 per second. systems/grapple.js:414 damps a DEAD body's
                 topple at exactly 7 (a living one at 11). Same rate here, so
                 a warlord corpse and a city corpse fold at the same speed.
     FLAT        PI/2 - 0.07. battle.js's own topple ceiling, which is
                 grapple.js's law with a comment: a rig that pivots at its
                 FEET must never pass vertical or the torso swings down and
                 behind and sinks under the ground. Kept exactly.
     ROLL        0.6 rad (~34 deg) of shoulder roll, grapple.js:416's own
                 amplitude, applied only to the share of the fall the bullet
                 did not already decide (see foldTarget).
     RIM_CAP     12. city/killfeed.js:33's CAP for recent deaths — the same
                 quantity, so the same ceiling. */
  const GORE_M2 = 70 * 70;
  const OWN_M = 6;
  const HIP_Y = 0.95, KNEE_Y = 0.475;
  const FOLD_K = 7;
  const FLAT = Math.PI / 2 - 0.07;
  const ROLL = 0.6;
  const RIM_CAP = 12;

  /* THE BUCKLE DIP, derived. A stance collapsing through 40 degrees at the
     knee takes the hips down by thigh*(1-cos 40) = 0.475*0.234 = 0.111 m.
     40 degrees because that is where city/ragdoll.js's own buckle has the
     knee by the time its dying beat expires (it drags the feet 10% of the
     way under the hips per substep at k=1, which is the same order). The
     number is small on purpose: this is a knee giving, not a man kneeling. */
  const DIP = (HIP_Y - KNEE_Y) * (1 - Math.cos(40 * Math.PI / 180));

  /* ============================================================ STATE */
  let A = null;               // battle.js's side of the seam (see arm())
  let THREE = null;
  let bloodReady = false, bloodAsked = false;
  let rim = null;             // the rim overlay element
  let rimN = 0;
  /* THE GENERATION STAMP. Every mark schedules its own removal 1.45 s out, and
     a battle can end inside that window — disarm() then throws the whole
     overlay away while a dozen timers are still in flight, and each one still
     finds its (detached) parent and decrements the count. rimN went NEGATIVE
     across a teardown and carried into the next fight, which silently raised
     the cap by however many ticks had been pending. A timer that belongs to a
     dead generation does nothing. */
  let rimGen = 0;
  let pend = [];              // deaths waiting for this frame's ranking
  const stat = { fell: 0, tier2: 0, tier1: 0, tier0: 0, blood: 0, bodies: 0,
                 denied: 0, marks: 0, breaks: 0, warpS: 0 };

  const _q = { x: 0, y: 0, z: 0, w: 1 };     // scratch quaternion (plain, see tip())
  const _kpt = { x: 0, y: 0, z: 0 }, _kdir = { x: 0, y: 0, z: 0 };

  /* ============================================================ TIME
     core/loop.js:19-21 and :95, verbatim in behaviour. This page runs
     microboot, not loop.js, so these three names simply do not exist here and
     every fpsmode call into them has been a no-op. Declared `if absent` so
     that the day this page loads the city loop, the city loop wins.

     THE SCALES ARE loop.js'S: 0.06 under a hit-stop, 0.32 under slow-mo,
     hit-stop beats slow-mo. Both decay on REAL time (the dt handed in), not
     on the scaled time, or a hit-stop would extend itself.

     AND IT IS OFF ABOVE 2x, which is warlord/feel.js:1160's rule and its
     reasoning: "a fast-forward has no room for a beat" — 90 ms of hush at 8x
     is 0.7 s of world. A battle running at 8x on the campaign slider must not
     stutter every time somebody dies. */
  if (CBZ.hitstop == null) CBZ.hitstop = 0;
  if (CBZ.slowmo == null) CBZ.slowmo = 0;
  if (!CBZ.doHitstop) CBZ.doHitstop = function (s) { CBZ.hitstop = Math.max(CBZ.hitstop, +s || 0); };
  if (!CBZ.doSlowmo) CBZ.doSlowmo = function (s) { CBZ.slowmo = Math.max(CBZ.slowmo, +s || 0); };

  function fastForward() {
    return !!(W.clock && W.clock.scale && W.clock.scale() > 2);
  }

  /* ============================================================ THE LOAD
     studio.need("blood") — BY PACK NAME, through core/studio.js's own loader,
     which is what the repo's seam law asks for: route the name to the service
     that already exists, never stand up a second one. The pack pulls
     systems/gore.js (and its "fx" dependency, already on this page), which
     registers its own CBZ.onAlways(8) updater and its own pools and caps. We
     add no frame hook and manage no particles.

     Asked at BATTLE time rather than at page boot, for games/warlord.html's
     stated reason for every other deferred file: a campaign that never
     reaches a fight should not pay for the fight's files. It resolves during
     the first battle's opening walk, long before anybody dies. */
  function askBlood() {
    if (bloodAsked || NO_BLOOD || OLD) return;
    bloodAsked = true;
    if (CBZ.gore) { bloodReady = true; return; }
    if (!(CBZ.studio && CBZ.studio.need)) return;
    CBZ.studio.need("blood").then(function () {
      bloodReady = !!CBZ.gore;
      if (!bloodReady) console.warn("[warlord/deaths] the blood pack loaded but CBZ.gore is absent");
      if (DEBUG) console.log("[deaths] blood ready:", bloodReady);
    }, function (e) { console.warn("[warlord/deaths] blood pack:", e && e.message); });
  }

  /* ============================================================ THE SEAM
     battle.js hands over five functions and nothing else. Deliberately not a
     pile of state: this file must not be able to reach into the battle and
     change anything the battle did not open a door for.

       rand()          battle.js's SEEDED rng. Anything that varies per corpse
                       goes through it, so a seeded battle still dies the same
                       way twice — which is what the ba preset's A/B needs.
       you()           the warlord's man record, or null
       decisive(m)     does this death end it — battle.js's own brokenSide(),
                       the same rule checkEnd() runs. Asked, never re-derived.
       solving(delta)  battle.js owns deadSolving (it gates its ragdollStep
                       call inside the sub-step loop, which is where sim time
                       lives). We tell it when a body joins or leaves.
       ground(x,z)     MAP.groundAt — where the sand is under a falling man. */
  D.arm = function (o) {
    A = o || null;
    THREE = G.THREE || null;
    pend.length = 0;
    lastErr = null;
    for (const k in stat) stat[k] = 0;
    askBlood();
    ensureRim();
    if (DEBUG) console.log("[deaths] armed", { old: OLD, blood: bloodReady });
    return true;
  };
  D.disarm = function () {
    A = null;
    pend.length = 0;
    CBZ.hitstop = 0; CBZ.slowmo = 0;
    if (rim && rim.parentNode) rim.parentNode.removeChild(rim);
    rim = null; rimN = 0; rimGen++;
  };
  D.on = function () { return !OLD; };

  /* ============================================================ A MAN FALLS
     Called from battle.js's killMan the instant the record dies. Everything
     that MUST be synchronous happens here (the beats are armed, the rig is
     handed the shot line); everything expensive is queued for the rank.

     imp is battle.js's own impact record: { by, headshot, raw }. `by` is the
     killer's man record — it carries .pos and .wid, which is all the shot
     line needs. A death with no imp at all (attritionTick's clock-out kills,
     battle.js:1118) still falls properly: the direction falls back to the
     seeded random the old code used, which is the honest answer when nobody
     shot him. */
  D.fell = function (m, imp) {
    if (!m) return false;
    stat.fell++;
    /* A MAN WITH NO RIG STILL HAS TO BE MARKED AS FALLEN, and the deleted code
       knew that: manDeathPhysics's early-out was `{ m.dieT = 0.0001; return; }`
       — the flag, then the bail. battle.js's clock-out loop finds the men
       attrition emptied with `!u.fall`, so a bail that leaves `fall` unset
       feeds the same man back in on all 120 iterations of that loop and pushes
       him into `corpses` 120 times. The first draft of this file dropped the
       flag and kept the bail. */
    if (!m.group) { m.fall = { done: true, posed: true, tier: 0 }; return false; }

    /* THE SHOT LINE, in the world and then in HIS frame. dx/dz is the unit
       vector FROM the killer TO the victim, i.e. the direction the round was
       travelling. battle.js already computed this for the ragdoll kick and
       threw it away for the fall, which is why the fall was a coin flip. */
    let dx = 0, dz = 0;
    const by = imp && imp.by;
    if (by && by.pos) { dx = m.pos.x - by.pos.x; dz = m.pos.z - by.pos.z; }
    const dl = Math.hypot(dx, dz);
    if (dl > 0.01) { dx /= dl; dz /= dl; }
    else { const a = A.rand() * Math.PI * 2; dx = Math.cos(a); dz = Math.sin(a); }

    /* THE ROUND'S ENERGY, on battle.js's own scale (it is what
       manDeathPhysics fed cityRagdoll, so the plank and the body now agree
       about how hard he was hit): a shotgun is 15, a rifle lands 5..13 off
       weapon-data's own damage column, an unattributed death is 7. */
    const w = (by && by.wid && CBZ.weaponById) ? CBZ.weaponById(by.wid) : null;
    let energy = 7;
    if (w) energy = w.pellets ? 15 : Math.max(5, Math.min(13, (w.damage || 20) * 0.35));

    const f = m.fall = {
      t: 0,
      /* THE STAGGER WINDOW IS city/ragdoll.js:350's, to the coefficient. A
         pistol (energy 5) gives 0.29 s on his feet; a shotgun (15) gives
         0.17; nothing gives less than 0.12. The whole point of reusing the
         formula rather than picking one: a man who gets a verlet body and the
         man beside him who did not are hit for the same length of time. */
      struck: OLD ? 0 : clamp(0.34 - (energy - 1) * 0.012, 0.12, 0.34),
      dx: dx, dz: dz,
      energy: energy,
      head: !!(imp && imp.headshot),
      posed: false, done: false, ragdoll: false,
      /* HIS PLANTED STANCE IS THE BASE, NOT A ZERO. warlord/sand.js's plant()
         writes obj.QUATERNION (it slerps toward the ground normal so a man on
         a dune leans into the hill), and the old code wrote group.rotation.x
         on top of that — which works only because three.js keeps the Euler
         and the quaternion synced, and which throws the slope lean through an
         Euler decomposition on every corpse. Cache the stance he died in and
         multiply the fall onto it in HIS OWN frame instead. One quaternion
         multiply per corpse per frame, and a man shot on a slip face lands
         along the slope instead of standing out of it. */
      q0: null, y0: m.group.position.y,
      rx: 0, rz: 0, tx: 0, tz: 0,
    };
    if (THREE && m.group.quaternion) f.q0 = m.group.quaternion.clone();

    if (OLD) {
      /* ?deaths=old — battle.js's original two lines, byte for byte, so the
         A/B photographs the real before and not an approximation of it. */
      if (m.char && CBZ.deathPose) safe(function () { CBZ.deathPose(m.char, m.i * 3.7 + 1.3, A.rand()); });
      f.posed = true;
      f.old = true;
      f.dieDir = A.rand() < 0.5 ? -1 : 1;
      f.t = 0.0001;
      legacyBody(m, imp, energy);
      return true;
    }

    foldTarget(m, f);

    /* THE RANK. Computed now, spent next frame. */
    const tier = tierOf(m, imp);
    f.tier = tier;
    if (tier === 2) stat.tier2++; else if (tier === 1) stat.tier1++; else stat.tier0++;
    pend.push({ m: m, imp: imp, f: f, tier: tier, d2: A.camDist2(m.pos) });

    /* THE RIM, and the only thing about this death that is UI. Your men only:
       the old feed line was gated the same way (`m.team === "mine"`), and for
       the same reason — a rim full of enemy deaths is a rim that says nothing
       about whether you are losing. */
    if (m.team === "mine") mark(m.pos.x, m.pos.z, "down");

    /* THE EVENT feel.js HAS BEEN WAITING FOR (feel.js:1476: "None of them
       exist yet"). Cheap and unconditional — the bus is warlord/core.js's and
       a name with no listener costs one array read. */
    if (W.emit) W.emit("battle:kill", { team: m.team, by: (by && by.isYou) ? "you" : "npc",
                                        head: f.head, tier: tier });
    return true;
  };

  /* ---- the legacy body path, kept only for ?deaths=old --------------------
     battle.js's manDeathPhysics, moved here whole so battle.js carries ONE
     death path. It is dead unless the flag is set. */
  function legacyBody(m, imp, energy) {
    if (!m.char || !CBZ.cityRagdoll) return;
    const by = imp && imp.by;
    let dx = 0, dz = 0;
    if (by && by.pos) { dx = m.pos.x - by.pos.x; dz = m.pos.z - by.pos.z; }
    const dl = Math.hypot(dx, dz);
    if (dl > 0.01) { dx /= dl; dz /= dl; }
    else { const a = A.rand() * Math.PI * 2; dx = Math.cos(a); dz = Math.sin(a); }
    _kdir.x = dx; _kdir.y = 0; _kdir.z = dz;
    _kpt.x = m.pos.x - dx * 0.28; _kpt.y = m.pos.y + 1.28; _kpt.z = m.pos.z - dz * 0.28;
    const got = safe(function () { return CBZ.cityRagdoll(m, _kpt, _kdir, energy); });
    if (got) { m.ragdoll = true; m.fall.ragdoll = true; m.fall.t = 0; A.solving(1); }
  }

  /* ============================================================ THE TIER
     The rule from the header, in code, in the order it is argued.

     Note what is NOT here: a "visible" test that raycasts, and a "cost"
     estimate. Both were in the first draft and both were wrong. A raycast per
     death at 300 v 300 is more expensive than the effect it is gating, and a
     cost model is a second opinion about a budget the engine already owns —
     the honest ceiling is how many slots the solver has free, asked live. */
  function tierOf(m, imp) {
    const by = imp && imp.by;
    if (by && by.isYou) return 2;                 // you pulled the trigger
    if (A.decisive && safe(function () { return A.decisive(m); })) return 2;
    const you = A.you && A.you();
    if (you && !you.dead) {
      const ddx = m.pos.x - you.pos.x, ddz = m.pos.z - you.pos.z;
      if (ddx * ddx + ddz * ddz < OWN_M * OWN_M) return 2;   // the man at your elbow
    }
    const d2 = A.camDist2(m.pos);
    if (d2 > GORE_M2) return 0;                   // gore.js would refuse anyway
    if (!inFront(m.pos)) return 0;                // behind the lens is not a picture
    return 1;
  }

  const _fwd = { x: 0, y: 0, z: 0 };
  function inFront(p) {
    const c = CBZ.camera;
    if (!c) return true;
    /* The camera's forward is -Z of its world matrix; elements[8..10] is the
       Z basis column, so forward = -(e8, e9, e10). Read straight off the
       matrix rather than allocating a Vector3 per death. */
    const e = c.matrixWorld.elements;
    _fwd.x = -e[8]; _fwd.y = -e[9]; _fwd.z = -e[10];
    return (p.x - c.position.x) * _fwd.x + (p.z - c.position.z) * _fwd.z > 0;
  }

  /* ============================================================ THE DRAIN
     Once per frame, from battle.js's frame function, before anything else.
     Two jobs in one call because they are the same job — this is the only
     place in the file that sees a WHOLE frame:
       1. spend the previous frame's deaths in rank order
       2. advance the hit-stop / slow-mo clock and return the warped dt

     Returns the dt battle.js should actually step. Under ?deaths=old, and
     above 2x game speed, it returns dt untouched. */
  D.warpDt = function (dt) {
    drain();
    if (OLD || fastForward()) { CBZ.hitstop = 0; CBZ.slowmo = 0; return dt; }
    let scale = 1;
    if (CBZ.hitstop > 0) { CBZ.hitstop = Math.max(0, CBZ.hitstop - dt); scale = 0.06; }
    else if (CBZ.slowmo > 0) { CBZ.slowmo = Math.max(0, CBZ.slowmo - dt); scale = 0.32; }
    if (scale < 1) stat.warpS += dt;
    return dt * scale;
  };

  function drain() {
    if (!pend.length) return;
    if (!A) { pend.length = 0; return; }

    /* THE CEILING IS THE SOLVER'S, ASKED. Not a constant in this file: the
       page sets RAGDOLL_ACTIVE, the quality tier can move it, and a second
       copy of that number here would be a future contradiction. */
    let slots = 3;
    if (CBZ.ragdollAudit) {
      const ra = safe(function () { return CBZ.ragdollAudit(); });
      if (ra) slots = Math.max(0, (ra.cap | 0) - (ra.solving | 0));
    }

    /* RANK: tier descending, then NEAREST FIRST inside a tier. Sorting the
       queue rather than the men array — the queue is one frame's deaths,
       which on the worst measured volley is tens of entries, not hundreds. */
    pend.sort(function (a, b) { return (b.tier - a.tier) || (a.d2 - b.d2); });

    for (let i = 0; i < pend.length; i++) {
      const e = pend[i], m = e.m;
      if (!m.dead || m.retired || !m.group || !m.group.parent) continue;

      /* TIER 2 IS NEVER CULLED and never spends a slot from the pool the
         others are competing for — see the header. It is bounded by fact, not
         by a cap: you cannot pull the trigger more than your gun's rate of
         fire, and brokenSide() crosses once per side per battle. */
      const forced = e.tier === 2;
      const wantBody = forced || (e.tier === 1 && slots > 0);
      const wantBlood = (forced || e.tier === 1) && e.d2 <= GORE_M2;

      if (wantBlood) blood(m, e.f, forced);
      /* DENIED COUNTS BOTH WAYS A BODY CAN FAIL TO ARRIVE: losing the rank,
         and winning it and then being refused by the solver anyway (its own
         range gate, or a pool with nothing free that is not yet settling).
         The first draft only counted the first, so a page that had turned
         RAGDOLL_RANGE down reported a perfect budget while every man in it
         took the cheap path. */
      if (wantBody) {
        const got = body(m, e.f);
        if (got && !forced) slots--;
        if (!got) stat.denied++;
      } else if (e.tier >= 1) stat.denied++;

      /* TIME AND THE LENS ARE TIER 2 ONLY, and that is the memory this repo
         paid for twice already: THE LENS IS FOR WHAT IS DONE TO YOU. An AI
         killing an AI 40 m away is not allowed to touch your camera or your
         clock, however near it is — otherwise 300 v 300 is a permanent
         earthquake, which is exactly the bug the shark game shipped. */
      if (forced) lens(m, e.f, e.imp);
    }
    pend.length = 0;
  }

  /* ============================================================ THE BLOOD
     One call. gore.js does the spray, the mist, the pool, the wall splat and
     the entry wound on the body itself (it stamps CBZ.bodyWound off opts.actor
     — the seam systems/childsafe.js named, so a caller that knows its victim
     simply says so).

     opts.lens is FALSE except for a tier-2 death. gore.js's tail unconditionally
     spends CBZ.shake(0.26*amt) and a red vignette, which is correct for one
     murder on a street and catastrophic for a battle — and gore.js already
     ships the parameter for exactly this case, with a comment about a shark
     that shook the camera twice per mouthful. Reusing the parameter rather
     than working around the shake. */
  function blood(m, f, forced) {
    if (!bloodReady || !CBZ.gore) return false;
    stat.blood++;
    const side = m.side;
    safe(function () {
      CBZ.gore(m.pos.x, m.pos.y + (f.head ? 1.62 : 1.15), m.pos.z, {
        /* THIS IS A DESERT. Saying so outright skips gore.js's terrain query
           (it would answer "air" anyway — there is no citySeaHeightAt on this
           page) and, more usefully, it WRITES its `wetEvent` latch false on
           the way in. That latch is module state armed per call and cleared by
           gore.js's own onAlways(8); while it is stuck true, spawnBit turns
           every droplet into an underwater puff and returns null, so a leaked
           wet event on a page whose frame loop is not the one gore.js was
           written against is a silent, permanent blood outage. One word buys
           immunity to a whole failure mode this game can never legitimately
           enter. */
        medium: "air",
        dir: { x: f.dx, z: f.dz },
        /* cityKillPed's own amount for a gunshot is 1.0 and gore.js reads
           >= 1.3 as a headshot; we say `head` outright instead, which is the
           explicit half of the same switch. */
        amount: 1,
        head: f.head,
        /* THE CLOTH IS HIS SIDE'S. gore.js tints its shredded-cloth particles
           with it; the skin default (0xc98a5e) is left alone because
           studio.cast picks a skin per variant that this file has no honest
           read of, and a wrong skin is worse than the average one. */
        cloth: (side && side.colour) || undefined,
        /* THE VICTIM, so the wound lands on the body instead of in the air.
           This is what makes a warlord corpse carry the hole that killed it,
           the same as a city corpse. */
        actor: m,
        imp: { point: { x: m.pos.x, y: m.pos.y + (f.head ? 1.62 : 1.15), z: m.pos.z },
               cal: f.energy / 13 },
        lens: !!forced,
      });
    });
    return true;
  }

  /* ============================================================ THE BODY
     city/ragdoll.js, with the kick seated at the wound and aimed along the
     round — the same three arguments battle.js already built, now spent in
     rank order instead of array order. */
  function body(m, f) {
    if (!CBZ.cityRagdoll || !m.char) return false;
    _kdir.x = f.dx; _kdir.y = 0; _kdir.z = f.dz;
    /* THE HIT POINT IS THE WOUND, and its height is which wound. ragdoll.js
       decides `hs` (a head hit: whip the skull, snap it back, dump the head)
       by whether the point is within 0.6 m of the head mass point at 2.18 —
       so a headshot has to arrive at head height or the solver cannot know it
       was one. 1.28 is battle.js's own torso height and stays for body hits. */
    _kpt.x = m.pos.x - f.dx * 0.28;
    _kpt.y = m.pos.y + (f.head ? 2.05 : 1.28);
    _kpt.z = m.pos.z - f.dz * 0.28;
    const got = safe(function () { return CBZ.cityRagdoll(m, _kpt, _kdir, f.energy); });
    if (!got) return false;
    /* NOT `f.done`. done means the FOLD has stopped writing his transform;
       stepFall already returns the frame m.ragdoll is set, so the two are
       different facts and conflating them made a body-that-solves report as a
       fold-that-settled to every tool that asked. */
    m.ragdoll = true; f.ragdoll = true;
    A.solving(1);
    stat.bodies++;
    return true;
  }

  /* ============================================================ THE LENS
     Tier 2 only. Three separate services, none of them written here:
       · CBZ.doHitstop — fpsmode's own numbers for a kill (0.085 on a head,
         0.055 otherwise, fpsmode.js:2440). fpsmode already calls this on YOUR
         kills; the call here covers the decisive death you did not cause.
       · W.feel.hitStop — the AUDIO half of a hit-stop (audio.js's held hush,
         then a thump). feel.js says outright that it cannot freeze the sim
         and that "if the orchestrator wants a real sim freeze it belongs in
         battle.js's frame function". It does now, above; this is the other
         half arriving at the same frame.
       · CBZ.shake — wrapped by feel.js, which owns the shake budget (a
         recent-shake accumulator, so the first of a burst lands full and the
         tenth lands at a fifth). We never call the raw one. */
  function lens(m, f, imp) {
    if (fastForward()) return;
    const by = imp && imp.by;
    const yours = !!(by && by.isYou);
    if (CBZ.doHitstop) CBZ.doHitstop(f.head ? 0.085 : 0.055);
    if (f.head && CBZ.doSlowmo) CBZ.doSlowmo(0.18);
    if (W.feel && W.feel.hitStop && yours) safe(function () { W.feel.hitStop(f.head ? 0.10 : 0.07); });
    /* THE SHAKE IS SMALL ON PURPOSE. gore.js spends 0.26 for a murder you are
       standing over; a kill at range is a smaller event than that and the
       budget wrapper will shrink it further inside a burst. Scaled by how near
       it is, over the same 70 m the blood uses, so a decisive death across the
       field is a tap and one at your elbow is a jolt. */
    if (CBZ.shake) {
      const d2 = A.camDist2(m.pos);
      const near = 1 - clamp(Math.sqrt(d2) / 70, 0, 1);
      CBZ.shake(0.10 + 0.20 * near + (f.head ? 0.08 : 0));
    }
    /* AND HE MAKES A SOUND. city/crowd.js:2205's own line, byte for byte —
       "headshot" or "hit" out of systems/audio.js's bank, with the distance so
       audio.js attenuates and swaps to its far-field voice past FAR_DIST. NOT
       ghost:true: warlord/feel.js's entire header is about what ghost does to
       the per-cue cooldown, and a death cry is exactly the kind of cue that
       cooldown exists for. */
    if (CBZ.sfx) {
      const d = Math.sqrt(A.camDist2(m.pos));
      if (d < 70) safe(function () { CBZ.sfx(f.head ? "headshot" : "hit", { dist: d }); });
    }
  }

  /* ============================================================ THE FOUR BEATS
     Everybody gets these. They are the answer to "death is instant" for the
     280 men who will never be near enough for blood or a verlet body, and
     they cost one quaternion multiply and two float writes per corpse.

       STRUCK   (0 .. f.struck)  He is hit and he is still standing. The torso
                recoils along the round, the aim drops, and he takes a stagger
                STEP in the direction the bullet was travelling. No topple at
                all. This beat did not exist and its absence is the entire
                report: a man who is already dead-posed on the frame the round
                lands has not been shot, he has been switched off.
       BUCKLE   (f.struck .. +) The knees give. deathPose lands HERE — the
                first frame his legs stop holding him — not on frame zero, and
                the hips drop by DIP while the topple begins.
       TOPPLE   The body folds to flat, away from the round, damped at
                grapple.js's own dead-body rate, with a shoulder roll on the
                share of the fall the bullet did not decide.
       STILL    Within a degree of the target: stop writing. A settled corpse
                costs nothing.

     Called from battle.js's stepMan on SIM time (sub-steps), not on frame
     time, so a battle at 8x buries its dead 8x faster and a frozen studio
     clock advances them exactly as far as advance() asked for. */
  D.stepFall = function (m, sdt) {
    const f = m.fall;
    if (!A || !f || m.retired) return;    // A is null between battles
    if (m.ragdoll) return;              // the verlet solver owns the transform

    if (f.old) {                        // ?deaths=old — the original plank
      if (f.t > 0 && f.t < 1) {
        f.t = Math.min(1, f.t + sdt * 2.4);
        const k = 1 - (1 - f.t) * (1 - f.t);
        m.group.rotation.x = f.dieDir * k * FLAT;
      }
      return;
    }
    if (f.done) return;
    f.t += sdt;

    if (f.t < f.struck) {
      /* ---- STRUCK. He absorbs it on his feet. */
      const k = 1 - f.t / f.struck;               // 1 at impact -> 0
      /* THE STAGGER. city/ragdoll.js prices its own lurch at dyForce = m/6
         and applies it to the upper body; the same scalar here is a metres-
         per-second step for the whole man, easing out with k. At energy 7
         that is 1.17 m/s for a fifth of a second — about 20 cm, which is a
         step, not a shove. */
      const v = (f.energy / 6) * k * sdt;
      m.pos.x += f.dx * v; m.pos.z += f.dz * v;
      if (A.ground) m.pos.y = A.ground(m.pos.x, m.pos.z);
      m.group.position.set(m.pos.x, m.pos.y, m.pos.z);
      f.y0 = m.pos.y;
      /* THE RECOIL, on the TORSO only (ch.body), so his legs stay planted and
         his shoulders take the round. deathPose has not run yet, so nothing is
         fighting these writes: battle.js stops calling animChar the frame a
         man dies. Amplitudes are a fifth of a radian — a lurch, not a bow. */
      const ch = m.char;
      if (ch && ch.body) {
        const fwdA = f.dx * Math.sin(m.yaw) + f.dz * Math.cos(m.yaw);
        const sideA = f.dx * Math.cos(m.yaw) - f.dz * Math.sin(m.yaw);
        ch.body.rotation.x = fwdA * 0.22 * k;
        ch.body.rotation.z = -sideA * 0.18 * k;
      }
      return;
    }

    /* ---- BUCKLE: the pose arrives the frame his legs stop holding him. */
    if (!f.posed) {
      f.posed = true;
      if (m.char && CBZ.deathPose) {
        /* battle.js's own seed and its own `fall` argument (which biases
           which of deathPose's three templates he lands in). Kept identical
           so a seeded battle poses its dead the same way it always did — the
           A/B is about WHEN the pose arrives, not which one. */
        safe(function () { CBZ.deathPose(m.char, m.i * 3.7 + 1.3, f.poseRoll); });
      }
    }

    /* ---- TOPPLE, damped at grapple.js's dead-body rate. */
    const a = 1 - Math.exp(-FOLD_K * sdt);
    f.rx += (f.tx - f.rx) * a;
    f.rz += (f.tz - f.rz) * a;
    tip(m, f);

    /* THE HIPS DIP AND COME BACK. The dip peaks with the buckle and unwinds
       as the body reaches the ground, because by then the topple has taken
       over from the knees. Sin over the remaining fold gives that shape with
       no second timer. */
    const prog = clamp(Math.hypot(f.rx, f.rz) / (Math.hypot(f.tx, f.tz) || 1), 0, 1);
    m.group.position.y = f.y0 - DIP * Math.sin(prog * Math.PI);

    if (Math.abs(f.tx - f.rx) < 0.017 && Math.abs(f.tz - f.rz) < 0.017) {
      f.rx = f.tx; f.rz = f.tz;
      tip(m, f);
      m.group.position.y = f.y0;
      f.done = true;                    // settled: stop writing this corpse
    }
  };

  /* WHERE HE ENDS UP, in his own frame. The round's direction is resolved
     into HIS forward and HIS right (battle.js's men face local +Z — see
     fireShot's muzzle, `pos + (sin yaw, cos yaw)`), and the fold is that
     direction turned into two rotations:

       rotation.x = +FLAT  takes his head to local +Z  -> he falls FACE DOWN
       rotation.z = -FLAT  takes his head to local +X  -> he falls to his right

     so a man shot in the back (fwd = +1) goes face down, and a man shot from
     his left goes down to his right. That single sign relationship is the
     whole content of the fix: the old code rolled a coin.

     THE TOTAL NEVER PASSES FLAT. fwd^2 + side^2 = 1, so the worst case is one
     axis at FLAT and the other at zero; the composed tilt of the two is
     acos(cos rx * cos rz), which is largest when one of them is zero. This is
     grapple.js's law and it exists because the rig pivots at its FEET — past
     vertical the torso swings down and behind and sinks under the sand.

     THE ROLL gets what is left. A man who took the round dead astern has no
     sideways component to his fall, and that is exactly the man who reads as
     a plank; grapple.js's ±0.6 rad shoulder roll goes there, scaled by
     (1 - |side|) so it never fights a fall the bullet already decided. */
  function foldTarget(m, f) {
    const fwd = f.dx * Math.sin(m.yaw) + f.dz * Math.cos(m.yaw);
    const side = f.dx * Math.cos(m.yaw) - f.dz * Math.sin(m.yaw);
    f.poseRoll = A.rand();
    const roll = (A.rand() * 2 - 1) * ROLL * (1 - Math.abs(side));
    f.tx = fwd * FLAT;
    f.tz = clamp(-side * FLAT + roll, -FLAT, FLAT);
  }

  /* Apply the fold ON TOP of the stance he died in, in his own frame:
       q = q0 * qx(rx) * qz(rz)
     Post-multiplying is what makes it local — a man leaning into a dune folds
     along the dune instead of snapping to the world axes. Built by hand out of
     half-angle sines rather than allocating two THREE.Quaternions per corpse
     per frame; at 260 corpses that is 520 allocations a frame otherwise. */
  function tip(m, f) {
    const g = m.group;
    if (!f.q0 || !g.quaternion) { g.rotation.x = f.rx; g.rotation.z = f.rz; return; }
    const sx = Math.sin(f.rx * 0.5), cx = Math.cos(f.rx * 0.5);
    const sz = Math.sin(f.rz * 0.5), cz = Math.cos(f.rz * 0.5);
    /* a = qx * qz, expanded. THE MINUS ON ay IS LOAD-BEARING and the first
       draft had it as +: Hamilton's y term is pw*qy - px*qz + py*qw + pz*qx,
       and with qx = (sx,0,0,cx) and qz = (0,0,sz,cz) every term but -px*qz
       vanishes, leaving -sx*sz. Getting it wrong is invisible on a man shot
       dead astern (rz = 0) and yaws every other corpse the WRONG WAY as it
       folds — which is the exact class of bug this file exists to fix, so it
       is checked here against the matrix: at rx = rz = PI/2, Rx·Rz is
       [[0,-1,0],[0,0,-1],[1,0,0]], whose quaternion is (0.5,-0.5,0.5,0.5). */
    const ax = sx * cz, ay = -sx * sz, az = cx * sz, aw = cx * cz;
    const b = f.q0;
    // q0 * a, expanded (Hamilton product)
    _q.x = b.w * ax + b.x * aw + b.y * az - b.z * ay;
    _q.y = b.w * ay - b.x * az + b.y * aw + b.z * ax;
    _q.z = b.w * az + b.x * ay - b.y * ax + b.z * aw;
    _q.w = b.w * aw - b.x * ax - b.y * ay - b.z * az;
    g.quaternion.set(_q.x, _q.y, _q.z, _q.w);
  }

  /* battle.js retires a corpse (the budget, or the sink) — hand the slot back
     and stop owning the transform. Idempotent. */
  D.forget = function (m) {
    if (!m) return;
    if (m.fall) { m.fall.done = true; m.fall = null; }
  };

  /* ============================================================ THE RIM
     The kill feed, replaced by the thing the kill feed was standing in for.
     A short tick on the screen edge, at the world bearing of the man, fading
     over 1.4 s. Red when one of yours falls; amber when one of yours breaks.

     WHY A BEARING AND NOT A NAME. The line said "HAKIM DOWN". You do not know
     Hakim — the campaign gives him a name for the aftermath screen, which is
     where a name belongs, because that is where you have time to read one.
     What you would actually act on mid-fight is WHICH SIDE OF YOU your line is
     dying on, and the sentence never carried that. So the mark carries it and
     the sentence is deleted.

     THE COLOURS ARE battle.js'S OWN, off setW2's HP bar: #c4453a is what that
     bar goes when a man is nearly gone and #e2c14a is the middle of it. No new
     palette — the rim reads as the same instrument as the bars beside it.

     THE CAP IS 12, which is city/killfeed.js:33's CAP for recent deaths. Same
     quantity, same ceiling, and it is what stops a volley painting a solid
     ring. Oldest goes first. */
  const RIM_DOWN = "#c4453a", RIM_BREAK = "#e2c14a";
  function ensureRim() {
    if (RIM_OLD || OLD || typeof document === "undefined") return;
    if (rim && rim.parentNode) return;
    rim = null;                                   // detached: build a fresh one
    if (!document.getElementById("wbRimCss")) {
      const st = document.createElement("style");
      st.id = "wbRimCss";
      st.textContent =
        /* THE FIRST DRAFT WAS A 52x3 px BAR AND IT READ AS A SCRATCH ON THE
           LENS. Photographed at 1180x700 it was three pixels of dark red
           against sand at the top of the frame, and the eye did not resolve it
           as an INSTRUMENT — which is fatal for a mark whose whole job is to
           replace a sentence. So: longer, thicker, tapered at both ends with
           a gradient (a wedge points; a rectangle just sits there), a soft
           glow of its own colour so it separates from whatever is behind it,
           and a short scale-in so it ARRIVES rather than appearing. The
           `--c` custom property carries the colour into both the gradient and
           the glow, so a mark is one hex in one place. */
        "#wbRim{position:fixed;inset:0;pointer-events:none;z-index:44;overflow:hidden}" +
        "#wbRim i{position:absolute;left:50%;top:50%;width:74px;height:5px;margin:-2.5px 0 0 -37px;" +
          "border-radius:3px;transform-origin:50% 50%;opacity:0;" +
          "background:linear-gradient(90deg,transparent,var(--c) 22%,var(--c) 78%,transparent);" +
          "box-shadow:0 0 9px 1px var(--c);" +
          "animation:wbRimP 1.4s cubic-bezier(.15,.7,.3,1) forwards}" +
        "@keyframes wbRimP{0%{opacity:0;filter:blur(2px);transform:scale(.55) rotate(var(--r))}" +
          "14%{opacity:1;filter:blur(0);transform:scale(1) rotate(var(--r))}" +
          "100%{opacity:0;transform:scale(1) rotate(var(--r))}}";
      document.head.appendChild(st);
    }
    rim = document.createElement("div");
    rim.id = "wbRim";
    document.body.appendChild(rim);
  }

  /* THE BEARING. Where the man is, in the camera's own frame, flattened: 0 is
     dead ahead and +PI/2 is off the right of the screen. Taken off the camera
     matrix's basis columns (X at elements[0..2], Z at [8..10]) rather than
     through a Vector3 + applyQuaternion, because this runs on a death and a
     volley is a burst of them. */
  function mark(x, z, kind) {
    if (RIM_OLD || OLD) return;
    ensureRim();
    if (!rim || !CBZ.camera) return;
    if (rimN >= RIM_CAP && rim.firstChild) { rim.removeChild(rim.firstChild); rimN--; }
    const c = CBZ.camera, e = c.matrixWorld.elements;
    const ox = x - c.position.x, oz = z - c.position.z;
    const right = ox * e[0] + oz * e[2];
    const back = ox * e[8] + oz * e[10];          // +Z is BEHIND the camera
    const ang = Math.atan2(right, -back);         // 0 = ahead, +right
    /* THE INSET ELLIPSE. Not a circle: a 1180x700 viewport is not square, and
       a circular rim puts "straight ahead" a third of the way down the screen.
       88% of each half-axis leaves the tick clear of the HUD's own gutters. */
    const w = (G.innerWidth || 1180) * 0.44, h = (G.innerHeight || 700) * 0.44;
    const px = 50 + (Math.sin(ang) * w) / (G.innerWidth || 1180) * 100;
    const py = 50 - (Math.cos(ang) * h) / (G.innerHeight || 700) * 100;
    const n = document.createElement("i");
    n.style.left = px.toFixed(2) + "%";
    n.style.top = py.toFixed(2) + "%";
    /* THE ROTATION GOES IN A CUSTOM PROPERTY, NOT IN `transform`. The keyframes
       scale the mark in, and a keyframe that writes `transform` wins over an
       inline one for the whole animation — the first version set the angle
       inline and every mark drew at zero degrees for 1.4 s, i.e. every
       casualty in the battle reported as due east. */
    n.style.setProperty("--r", (ang * 180 / Math.PI + 90).toFixed(1) + "deg");
    n.style.setProperty("--c", kind === "break" ? RIM_BREAK : RIM_DOWN);
    /* A MAN RUNNING IS NOT A MAN DEAD and the two must not read alike: thinner,
       amber, and shorter, so a line coming apart looks different from a line
       being killed even at the edge of your attention. */
    if (kind === "break") { n.style.height = "3px"; n.style.width = "54px"; n.style.marginLeft = "-27px"; }
    rim.appendChild(n); rimN++; stat.marks++;
    const gen = rimGen;
    setTimeout(function () {
      if (gen !== rimGen) return;                 // a battle ended under it
      if (n.parentNode) { n.parentNode.removeChild(n); rimN--; }
    }, 1450);
  }
  D.mark = mark;

  /* A MAN OF YOURS BREAKS. Same rim, amber, thinner — a man running is not a
     man dead and the two must not read the same. Plus feel.js's break shout,
     which has been built and silent since the day it was written. */
  D.broke = function (m) {
    if (!m) return;
    stat.breaks++;
    if (m.team === "mine") mark(m.pos.x, m.pos.z, "break");
    if (W.emit) W.emit("battle:break", { side: m.team, one: true });
  };

  /* ============================================================ AUDIT
     Everything the ba preset gates on. `denied` is the honest one: how many
     deaths WANTED a body and did not get one because the solver was full —
     if that is zero at 300 v 300 the budget is not doing anything and if it
     is enormous the tiers are wrong. */
  D.audit = function () {
    const ra = (CBZ.ragdollAudit && safe(function () { return CBZ.ragdollAudit(); })) || null;
    return {
      on: !OLD, blood: bloodReady, rim: !RIM_OLD && !OLD,
      fell: stat.fell, tier2: stat.tier2, tier1: stat.tier1, tier0: stat.tier0,
      bloodEvents: stat.blood, bodies: stat.bodies, denied: stat.denied,
      marks: stat.marks, breaks: stat.breaks, warpS: Math.round(stat.warpS * 100) / 100,
      lastErr: lastErr,
      pending: pend.length,
      solving: ra ? ra.solving : 0, slotCap: ra ? ra.cap : 0,
      hitstop: Math.round(CBZ.hitstop * 1000) / 1000,
      slowmo: Math.round(CBZ.slowmo * 1000) / 1000,
      hooks: { gore: !!CBZ.gore, ragdoll: !!CBZ.cityRagdoll, pose: !!CBZ.deathPose,
               doHitstop: !!CBZ.doHitstop, feelHitStop: !!(W.feel && W.feel.hitStop),
               sfx: !!CBZ.sfx },
    };
  };

  G.__warlordDeaths = D;
})();
