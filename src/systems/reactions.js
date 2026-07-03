/* ============================================================
   systems/reactions.js — Hit reactions.

   Whenever an actor (guard / warden / npc) loses HP between frames we
   read it as "they just got hit" and fire a quick, cheap, eased recoil:

     • RECOIL  — pitch rig.body.rotation.x to lean AWAY from the player
                 (a flinch), then ease it back to neutral over ~0.25s.
     • FLASH   — briefly boost the head material's emissive so the actor
                 pops white/red on impact, then fade it back.
     • SHOVE   — a tiny CBZ.knockback away from the player on the hit
                 frame (the big juicy knockback lives in combat.js; this
                 is the light "everything that bleeds reacts" layer so
                 even gang-on-gang / stray hits feel physical).

   We also COWER fleeing npcs (aiState==="flee"): arms thrown up over the
   head and a hunched-forward body, so a panicking inmate reads as scared.

   CITY FIGHT READS (pass 2 only — jail/survival are byte-identical):
   melee is the most-watched animation in the game, so brawls must not
   look like mannequins bumping. Four additive layers, all fast-decay:
     • STAGGER  — a hit ped lurches AWAY from the real hit source
                  (grapple's _phys.fl/fdx/fdz carry the true world
                  direction + force), head whipping harder than torso.
                  WHY: directional reactions are how the watcher reads
                  WHO hit WHOM in a crowd brawl.
     • SWING    — an NPC's landed punch (peds.js npcAttack has no anim:
                  it just sets attackCD) gets a lean-in + jab follow-
                  through, plus a cock-back off combat.js's _windup
                  telegraph. WHY: a punch with no weight transfer reads
                  as a glitch, not a threat.
     • GUARD    — _blockT (combat.js) poses forearms up so "jab eaten,
                  throw the heavy" is taught by the pose, not the toast;
                  _broken drops the arms slack + a dazed sway so the
                  finisher window is visibly OPEN.
     • GET-UP   — knockdown recovery picks one of 3 variants (sit-up
                  push / roll to either knee) seeded per person, so two
                  peds dropped by the same sweep don't rise in lockstep.

   IMPLEMENTATION NOTES
   --------------------
   We run LATE (order 89, after animChar at 20/22 and facial.js at 88) so
   our pose sits on top of the fresh rig animChar already wrote this frame.
   But the two channels we touch behave DIFFERENTLY in animChar, so we
   layer them differently:

     • BODY pitch (body.rotation.x): animChar *assigns* it outright every
       frame ("ch.body.rotation.x = ch.lean", and again in the punch
       branch). It is not an accumulator, so there is nothing to feed
       back into — we just read that fresh base and ADD our offset on top.
       No back-out is needed (backing out would subtract an offset
       animChar already discarded and quietly cancel most of the flinch).

     • ARM pitch (parts.la/ra.rotation.x): animChar *damps* it from the
       previous value, so our cower offset WOULD feed back through that
       damp and drift. Exactly like facial.js does for the neck, we first
       SUBTRACT last frame's arm offset (revealing the clean damped base),
       then ADD this frame's offset back.

   Per-actor state is held in a plain Map keyed by the actor object
   (recoil timer / flash timer / our last additive arm offsets). Stale
   entries are pruned on a new run (we watch CBZ.game.elapsed drop), which
   also restores any head we left tinted mid-flash.

   Everything is sine/exp eased and allocation-free in the hot loop so it
   stays cheap on phones.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;

  const damp = CBZ.damp || function (c, t, r, dt) { return c + (t - c) * (1 - Math.exp(-r * dt)); };

  // --- tunables ---
  const RECOIL_DUR = 0.25;      // seconds for the flinch to ease back
  const RECOIL_AMP = 0.55;      // radians of body pitch at peak flinch
  const FLASH_DUR = 0.22;       // seconds for the emissive flash to fade
  const FLASH_EI = 1.6;         // peak emissive intensity boost
  const FLASH_HEX = 0xff6644;   // warm impact tint
  const SHOVE = 0.18;           // tiny extra knockback on the hit frame
  const COWER_ARM = -2.2;       // target arm pitch when cowering (overhead)
  const COWER_LEAN = 0.4;       // extra forward hunch when cowering
  const AIM_ARM = -1.45;        // gun-arm pitch when an armed inmate aims back
  const SURRENDER_ARM = -2.85;  // arms clearly OVERHEAD for a gunpoint surrender (upright, not the forward cower)

  // --- city fight-read tunables (only touched on the city pass) ---
  const STAG_DUR = 0.25;        // directional stagger length (matches the old flinch beat)
  const STAG_PITCH = 0.5;       // torso pitch along the push direction at peak
  const STAG_ROLL = 0.3;        // torso roll for a side hit
  const STAG_YAW = 0.35;        // shoulder twist away from the impact
  const STAG_HEAD = 0.5;        // the head whips harder than the torso (whiplash sells force)
  const STAG_KNEE = 0.55;       // both knees flex as the stepped-back leg absorbs the shove
  const STAG_WINDMILL = 0.7;    // arms flail for balance — scales with amp² (heavy hits only)
  const SWING_DUR = 0.3;        // lean-in/follow-through after an NPC punch lands
  const SWING_LEAN = 0.3;       // forward commit at the moment of impact
  const SWING_TWIST = 0.3;      // shoulder rotation behind the punching arm
  const SWING_ARM = -1.9;       // punching arm extended, snapping back over the swing
  const BLOCK_ARM = -1.15;      // shoulders raise the arms toward guard height (elbow does the rest)
  const BLOCK_ELBOW = -1.9;     // ELBOWS fold hard so the forearms actually cross the face (real cover)
  const BLOCK_HUNCH = 0.12;     // tucked-in crouch behind the guard
  const DAZE_ARM = 0.3;         // guard-broken arms hang slack behind the hips
  const DAZE_SWAY = 0.12;       // slow drunken sway while broken (the foe is OPEN — go)
  const DAZE_HEAD = 0.42;       // head sags when the guard shatters
  const FLIN_DUR = 0.22;        // bullet flinch: sharp jerk, dead in ~220ms
  const FLIN_PITCH = 0.3;       // upper-body jerk along the push
  const FLIN_HEAD = 0.65;       // the head snap is what reads the caliber
  const FLIN_YAW = 0.25;        // shoulders wrenched off the impact
  const CLUTCH_DUR = 0.6;       // wound-clutch: hand reaches to the hit for ~0.6s after a non-fatal shot
  const CLUTCH_ARM = -1.35;     // the clutching arm folds in across the wound (pitch up + across)

  // ---- HEAD SNAP (punch reactions, CBZ.reactPunch — jail AND city) ----
  // Every landed melee blow is read as a shot to the head (this rig has no
  // separate hit-location model, and in a fistfight that's where punches go).
  // headAmp is a single decaying magnitude (instant snap on trigger, eased
  // back to 0 via `damp` — fast-out, slow-return with zero extra state) that
  // headKind/headLf/headLs (fixed at the moment of impact) project onto the
  // neck's 3 axes so a jab/cross/hook/upper each read as a DIFFERENT whip.
  const HEAD_DECAY = 5.5;       // /sec: how fast the snap eases back to neutral
  const HEAD_HEAVY_MULT = 1.4;  // a heavy/finisher punch snaps the head harder
  const HEAD_PITCH = 0.65;      // jab/cross: straight back along the punch line
  const HEAD_HOOK_YAW = 0.6;    // hook: head turns AWAY from the fist
  const HEAD_HOOK_ROLL = 0.22;  // hook: a touch of tilt riding the same turn
  const HEAD_UPPER_UP = 0.5;    // uppercut: chin snapped UP first (look-up sign)
  const HEAD_UPPER_BACK = 0.55; // uppercut: ...then the head continues back (see the amp*(1-amp) hump below)
  const AIM_RANGE2 = 60 * 60;   // shooters visibly track a mark inside 60u
  const AIM_HEAD_YAW = 0.75;    // believable neck turn cap
  const AIM_HEAD_PIT = 0.38;
  const AIM_ELEV = 0.55;        // max gun-arm elevation correction (rad)

  // per-actor reaction record, keyed by the actor object.
  //   hp        : last frame's hp (to detect a drop)
  //   recoil    : remaining recoil time (s); peak at start, 0 = done
  //   dir       : sign of the flinch (+/- so they pitch away from player)
  //   flash     : remaining flash time (s)
  //   laOff/raOff : arm pitch we added last frame (cower, to back out)
  //   cowerLean : smoothed body-hunch accumulator (0..COWER_LEAN)
  //   savedEm   : original emissive color hex of the head (-1 = none saved)
  //   savedEi   : original emissive intensity of the head
  // city-pass extras (initialized for everyone, only ever WRITTEN on the
  // city pass, so jail/survival records carry them inert):
  //   nkOff/byOff       : neck-pitch / body-yaw added last frame (damped
  //                       channels — backed out like the arms)
  //   llOff/rlOff       : leg pitch added last frame (get-up poses)
  //   lowLaOff/lowRaOff/lowLlOff/lowRlOff : ELBOW/KNEE (rig.low) additive
  //                       offsets added last frame (guard elbow-fold, get-up
  //                       knee-bend) — damped channels, backed out like arms.
  //   gbx/gbz           : body pitch/roll we hold DURING a get-up (animChar
  //                       is skipped while the body is flat, so these need
  //                       their own back-out instead of riding its assign)
  //   headAmp/headKind/headLf/headLs/hsX/hsY/hsZ : HEAD SNAP (CBZ.reactPunch,
  //                       jail AND city) — headAmp is a decaying magnitude,
  //                       headKind/Lf/Ls are the direction fixed at impact,
  //                       hsX/Y/Z are last frame's neck offsets to back out.
  //   stagT/stagX/stagZ/stagAmp : directional stagger timer + world push
  //                       direction + force-scaled amplitude
  //   swingT/swingArm   : NPC punch follow-through timer + which arm (±1)
  //   dazeK             : eased 0..1 weight of the guard-broken sway
  //   lastFl/atkCd      : last seen _phys.fl / attackCD (edge detectors)
  const R = new Map();

  function rec(a) {
    let r = R.get(a);
    if (!r) {
      r = {
        hp: a.hp != null ? a.hp : null,
        recoil: 0, dir: 1, flash: 0,
        laOff: 0, raOff: 0, cowerLean: 0,
        savedEm: -1, savedEi: 1,
        nkOff: 0, byOff: 0, llOff: 0, rlOff: 0, gbx: 0, gbz: 0,
        lowLaOff: 0, lowRaOff: 0, lowLlOff: 0, lowRlOff: 0,   // low-joint (elbow/knee) additive offsets
        stagT: 0, stagX: 0, stagZ: 1, stagAmp: 0,
        flinT: 0, flinX: 0, flinZ: 1, flinAmp: 0,
        clutchT: 0, clutchSide: 0, clutchAmp: 0,   // wound-clutch (non-fatal): timer / which hand (±1) / caliber weight
        headAmp: 0, headKind: "cross", headLf: 1, headLs: 0, hsX: 0, hsY: 0, hsZ: 0,  // HEAD SNAP (CBZ.reactPunch)
        aimK: 0, aimY: 0, aimP: 0, aimA: 0, hyOff: 0,
        swingT: 0, swingArm: 1, dazeK: 0, guardK: 0,
        // seed the detectors from the CURRENT values so an actor first seen
        // mid-flinch / mid-cooldown doesn't fire a phantom stagger/swing.
        lastFl: a._phys ? (a._phys.fl || 0) : 0,
        atkCd: a.attackCD || 0,
      };
      R.set(a, r);
    }
    return r;
  }

  // grab the head material (each rig builds its own MeshLambertMaterial,
  // so mutating it never bleeds onto another actor — see character.js).
  function headMat(a) {
    const h = a.char && a.char.head;
    return h && h.material ? h.material : null;
  }

  // restore a head we left tinted (and forget we touched it).
  function restoreHead(r, a) {
    if (r.savedEm < 0) return;
    const m = headMat(a);
    if (m && m.emissive) { m.emissive.setHex(r.savedEm); m.emissiveIntensity = r.savedEi; }
    r.savedEm = -1;
  }

  // force a wide-eyed, open-mouthed FEAR face. We run after facial.js (88), so
  // for this frame we win; reacting actors hold a frozen terrified stare.
  // k 0..1 scales the gape (0.4 = tense stand-off, 1 = pure terror).
  function setFearFace(a, k) {
    const f = a.char && a.char.face;
    if (!f) return;
    if (f.eyeL) f.eyeL.scale.y = 1;          // override the blink — eyes wide
    if (f.eyeR) f.eyeR.scale.y = 1;
    if (f.mouth) {
      const o = 0.35 + 0.65 * k;
      f.mouth.scale.y = 1 + o * 1.8;
      f.mouth.position.y = 0.16 - o * 0.05;
    }
  }

  // fire a fresh recoil + flash for `a`, flinching away from the player.
  function trigger(a, r) {
    r.recoil = RECOIL_DUR;
    r.flash = FLASH_DUR;

    // direction: pitch the upper body AWAY from the player. The player
    // standing in front (+z relative to facing) should push them back
    // (positive pitch); behind → forward. Express the hit direction in
    // the actor's local frame using its facing.
    let dir = 1;
    const p = CBZ.player && CBZ.player.pos;
    if (p) {
      const g = a.group.position;
      const dx = p.x - g.x, dz = p.z - g.z;
      const facing = a.group.rotation.y || 0;
      // component of the player->actor direction along the actor's
      // forward axis (+z local). Hit from the front → lean back.
      const fwd = Math.cos(facing) * dz + Math.sin(facing) * dx;
      dir = fwd >= 0 ? 1 : -1;
      // tiny physical shove away from the player on this frame
      if (CBZ.knockback) CBZ.knockback(a, p.x, p.z, SHOVE);
    }
    r.dir = dir;
    // alertCrowd drives the JAIL ambient crowd; in city mode peds run their own
    // panic (cityPanic), so don't cross the wires here.
    if (CBZ.alertCrowd && a.group && CBZ.game && CBZ.game.mode !== "city") {
      const gp = a.group.position;
      CBZ.alertCrowd(gp.x, gp.z, 10, 1);
    }

    // prime the flash: remember the head's resting emissive so we can
    // restore it exactly, then push it bright. Only save once (a re-hit
    // mid-flash must not clobber the true resting value with the tint).
    const m = headMat(a);
    if (m && m.emissive) {
      if (r.savedEm < 0) { r.savedEm = m.emissive.getHex(); r.savedEi = m.emissiveIntensity; }
      m.emissive.setHex(FLASH_HEX);
      m.emissiveIntensity = FLASH_EI;
    }
  }

  function update(dt) {
    const game = CBZ.game;
    if (!game) return;

    // new-run reset: elapsed dropped → wipe held state so we don't
    // carry recoils/flashes (or saved emissives) across runs.
    if (game.elapsed != null) {
      if (update._lastElapsed != null && game.elapsed < update._lastElapsed - 0.001) {
        // restore any heads we left tinted, then clear.
        R.forEach(function (r, a) { restoreHead(r, a); });
        R.clear();
      }
      update._lastElapsed = game.elapsed;
    }

    const guards = CBZ.guards || [];
    const npcs = CBZ.npcs || [];
    // CITY peds get the SAME expressive arm reactions as the jail crowd: a third
    // pass, only while in city mode, over CBZ.cityPeds. They drive the identical
    // hands-up / cower / flinch / aim-back / flash code below via their own pose
    // flags (poseHandsUp/poseAimBack/poseCower, set in city/peds.js) and a "flee"
    // state. The jail/survival passes (guards/npcs) are untouched. ----
    const inCity = game.mode === "city";
    const cityPeds = inCity ? (CBZ.cityPeds || []) : null;
    const passes = cityPeds ? 3 : 2;
    // city LOD: only pose peds the camera can actually see — the pose work is
    // purely visual, so far rigs (already render-culled) just bleed their timers.
    const cam = CBZ.camera ? CBZ.camera.position : null;
    const CITY_LOD2 = 150 * 150;

    for (let pass = 0; pass < passes; pass++) {
      const list = pass === 0 ? guards : pass === 1 ? npcs : cityPeds;
      const isCity = pass === 2;
      for (let i = 0; i < list.length; i++) {
        const a = list[i];
        if (!a || !a.group || !a.char) continue;
        // city: skip pooled/off-map and player-driven rigs cheaply
        if (isCity) {
          if (a._parked || a.culled || a.controlled) {
            // neck yaw is the one channel nothing else damps — back it out or
            // a pooled/driven rig keeps a twisted head for the rest of its life
            const old = R.get(a);
            if (old && old.hyOff) { if (a.char.neck) a.char.neck.rotation.y -= old.hyOff; old.hyOff = 0; }
            continue;
          }
          // far + nothing animating to see → don't pay for the pose math. Clear any
          // stored additive offset (without allocating a record) so the ped doesn't
          // back out a phantom offset the frame it re-enters range.
          if (cam && !a.dead) {
            const ddx = a.pos.x - cam.x, ddz = a.pos.z - cam.z;
            if (ddx * ddx + ddz * ddz > CITY_LOD2) {
              const old = R.get(a);
              if (old) {
                if (old.hyOff && a.char.neck) a.char.neck.rotation.y -= old.hyOff; // un-bake the aim yaw
                old.laOff = 0; old.raOff = 0; old.cowerLean = 0;
                old.nkOff = 0; old.byOff = 0; old.llOff = 0; old.rlOff = 0;
                old.lowLaOff = 0; old.lowRaOff = 0; old.lowLlOff = 0; old.lowRlOff = 0;
                old.gbx = 0; old.gbz = 0; old.stagT = 0; old.swingT = 0; old.dazeK = 0;
                old.flinT = 0; old.clutchT = 0; old.aimK = 0; old.hyOff = 0;
                old.headAmp = 0; old.hsX = 0; old.hsY = 0; old.hsZ = 0;
                // park the edge detectors HIGH so the first frame back in range
                // can't read a stale value as a fresh hit / fresh swing.
                old.lastFl = 9; old.atkCd = 1e9;
              }
              continue;
            }
          }
        }

        // ---- velocity-based KNOCKBACK from the shared body layer: hits set
        //      a._phys.kx/kz (combat.js / fpsmode.js / grapple.js), and we
        //      slide + decay it here so a punch/shot shoves them back over a
        //      few frames instead of teleporting. ----
        //   CITY: grapple.js (order 24) ALREADY integrates kx/kz for every city
        //   ped/cop AND grounds them on the surface. Doing it AGAIN here (order 89)
        //   double-applies the slide — the body skids twice as far, decays twice as
        //   fast, and the second collide() can fight the first, producing the stiff,
        //   weightless shove the city had. So for the city pass we leave the
        //   knockback to grapple (single, weighty integrator) and only do the
        //   cosmetic recoil/flash/pose below. Jail (guards/npcs) aren't touched by
        //   grapple, so they keep integrating it here exactly as before — UNCHANGED.
        const pp = a._phys;
        if (!isCity && pp && (Math.abs(pp.kx) > 0.02 || Math.abs(pp.kz) > 0.02)) {
          a.group.position.x += pp.kx * dt; a.group.position.z += pp.kz * dt;
          const dec = Math.pow(0.0009, dt); pp.kx *= dec; pp.kz *= dec;
          if (CBZ.collide) CBZ.collide(a.group.position, 0.5);
        }

        const r = rec(a);
        const ch = a.char;
        const body = ch.body;
        const parts = ch.parts;
        const low = ch.low || null;      // elbow/knee pivots (rig.low.{ll,rl,la,ra})
        const neck = ch.neck;

        // ---- detect a hit: hp dropped since last frame ----
        const hp = a.hp;
        if (hp != null) {
          if (r.hp != null && hp < r.hp - 0.01 && !a.dead) trigger(a, r);
          r.hp = hp;
        }

        // ---- BACK OUT last frame's additive ARM offset so we read the
        //      clean damped base animChar wrote this frame (the body is
        //      assigned outright by animChar, so it needs no back-out). ----
        if (parts) {
          if (parts.la && r.laOff) parts.la.rotation.x -= r.laOff;
          if (parts.ra && r.raOff) parts.ra.rotation.x -= r.raOff;
        }
        r.laOff = 0; r.raOff = 0;

        // HEAD SNAP back-out: neck pitch/yaw/roll is a damped channel (animChar
        // re-damps it every frame — see the file header), same feedback risk as
        // the arms, so reveal the clean base before this frame's snap goes back
        // on. Runs for BOTH jail and city (head snap isn't isCity-gated).
        if (neck) {
          if (r.hsX) neck.rotation.x -= r.hsX;
          if (r.hsY) neck.rotation.y -= r.hsY;
          if (r.hsZ) neck.rotation.z -= r.hsZ;
        }
        r.hsX = 0; r.hsY = 0; r.hsZ = 0;

        // CITY fight-read channels share the same back-out dance: neck pitch +
        // body yaw + legs are all DAMPED by animChar (feedback if left in), so
        // reveal the clean base before this frame's offsets go back on.
        if (isCity) {
          if (neck && r.nkOff) neck.rotation.x -= r.nkOff;
          if (neck && r.hyOff) neck.rotation.y -= r.hyOff;   // aim head-track (own channel — facial backs out only its own)
          if (body && r.byOff) body.rotation.y -= r.byOff;
          if (parts) {
            if (parts.ll && r.llOff) parts.ll.rotation.x -= r.llOff;
            if (parts.rl && r.rlOff) parts.rl.rotation.x -= r.rlOff;
          }
          if (low) {
            if (low.la && r.lowLaOff) low.la.rotation.x -= r.lowLaOff;
            if (low.ra && r.lowRaOff) low.ra.rotation.x -= r.lowRaOff;
            if (low.ll && r.lowLlOff) low.ll.rotation.x -= r.lowLlOff;
            if (low.rl && r.lowRlOff) low.rl.rotation.x -= r.lowRlOff;
          }
          r.nkOff = 0; r.hyOff = 0; r.byOff = 0; r.llOff = 0; r.rlOff = 0;
          r.lowLaOff = 0; r.lowRaOff = 0; r.lowLlOff = 0; r.lowRlOff = 0;

          // ---- EDGE DETECTORS (city) ----
          // STAGGER: grapple's hit() bumps _phys.fl on every real blow and
          // carries the TRUE world push direction + shock energy — far better
          // than the hp-drop recoil, which can only guess "away from the
          // player" and points the wrong way in NPC-vs-NPC brawls.
          if (pp) {
            if (pp.fl > r.lastFl + 0.01) {
              r.stagT = STAG_DUR;
              r.stagX = pp.fdx; r.stagZ = pp.fdz;
              r.stagAmp = Math.min(1.2, 0.45 + (pp.shock || 0) * 0.5);   // force-scaled
              // BULLET FLINCH rides the same edge: a sharper, faster jerk on top
              // of the lurch — shock is force-scaled, so caliber sets the snap.
              r.flinT = FLIN_DUR;
              r.flinX = pp.fdx; r.flinZ = pp.fdz;
              r.flinAmp = Math.min(1.5, 0.45 + (pp.shock || 0) * 0.6);
              // WOUND-CLUTCH: a NON-fatal hit makes them clap a hand over the
              // wound + take half a step off it for ~0.6s — the long, readable
              // tell that a living body absorbed the round (the fast flinch above
              // is the impact, this is the recoil-from-pain after). Dead bodies
              // ragdoll, so gate it on still-alive; caliber scales the magnitude.
              if (!a.dead && (a.ko == null || a.ko <= 0)) {
                const ry0 = a.group.rotation.y || 0;
                // lateral component of the push in the actor's local frame → which
                // side took it → which hand reaches across to clutch.
                const lsr = Math.cos(ry0) * pp.fdx - Math.sin(ry0) * pp.fdz;
                r.clutchSide = lsr >= 0 ? -1 : 1;   // hit pushed right → wound on the left → left hand clutches
                r.clutchT = CLUTCH_DUR;
                r.clutchAmp = Math.min(1.2, 0.55 + (pp.shock || 0) * 0.5);
              }
            }
            r.lastFl = pp.fl;
          }
          // SWING: peds.js npcAttack's only tell is attackCD JUMPING up at the
          // instant the blow lands (melee sets 0.5..0.9). A jump while in fight
          // state with the victim at arm's length = a punch we should sell.
          // (range gate keeps point-blank GUNFIRE cadence from reading as a jab;
          // the _broken/stun gate keeps combat.js's guard-break — which jacks
          // attackCD up to freeze their offense — from reading as a swing)
          const cd = a.attackCD || 0;
          if (cd > r.atkCd + 0.12 && a.state === "fight" && a.rage && !a.rage.dead &&
              !(a.armed && a.ammo > 0) && !((a._broken || 0) > 0) && !((a.stun || 0) > 0) && a.rage.pos) {
            const tdx = a.rage.pos.x - a.pos.x, tdz = a.rage.pos.z - a.pos.z;
            if (tdx * tdx + tdz * tdz < 12) {            // ~3.4m: melee reach
              r.swingT = SWING_DUR;
              r.swingArm = -r.swingArm;                  // alternate hands, like a real flurry
            }
          }
          r.atkCd = cd;
        }

        // downed / dead actors: they lie flat (group.rotation.z ~ PI/2);
        // skip the live pose reactions but keep the flash fading out so a
        // KO'ing blow still pops, and keep timers bleeding down.
        const down = a.dead || (a.ko != null && a.ko > 0) || a.escaped;

        // the body offset is the SUM of the recoil flinch and the cower
        // hunch, applied once on top of animChar's fresh assignment.
        let bodyOff = 0;
        let bodyRoll = 0;   // city-only side lean (rotation.z is assigned by animChar, so pure additive)

        // ---- RECOIL: a flinch that eases back over RECOIL_DUR ----
        if (r.recoil > 0) {
          r.recoil = Math.max(0, r.recoil - dt);
          // city: when the DIRECTIONAL stagger fired for this same hit, it owns
          // the pose — stacking the player-relative recoil on top would double
          // the pitch and point the wrong way in NPC-vs-NPC fights. The timer
          // still bleeds so the flash/shove bookkeeping is unchanged.
          if (!down && !(isCity && r.stagT > 0)) {
            // ease-out: full at the moment of impact, smoothly to 0.
            const k = r.recoil / RECOIL_DUR;          // 1 → 0
            const ease = k * k;                        // quadratic ease-out
            bodyOff += r.dir * RECOIL_AMP * ease;
          }
          // (downed: just let the timer bleed out, no pose offset)
        }

        // ---- THREAT POSES: held at gunpoint or fleeing ----
        //   • AIM-BACK  (a.poseAimBack): an armed inmate points its gun arm
        //               forward at the player in a stand-off.
        //   • HANDS-UP  (a.poseHandsUp, or aiState "flee"): arms thrown up
        //               over the head + a hunch, reading as scared/cowering.
        // Both ease the ARM pitch via the back-out/re-add dance (animChar
        // damps that channel), so they sit cleanly on the fresh base.
        // a "fleeing/scared" signal covers both the jail npc (aiState) and the
        // city ped (state), plus the city's brief gunfire/blast cringe (poseCower).
        const scared = a.aiState === "flee" || (isCity && (a.state === "flee" || (a.poseCower || 0) > 0));
        const aimBack = !down && a.poseAimBack && parts && body;
        const handsUp = !down && !aimBack && (a.poseHandsUp || scared) && parts && body;
        if (aimBack) {
          // ONE ARM DRIVER for the gun arm: a CITY ped that is actually holding a
          // visible weapon already has its gun arm leveled FORWARD every frame by
          // systems/actorweapons.js (order 36, AFTER animChar). Adding our additive
          // AIM_ARM write on top (order 89) double-drives the same channel and can
          // fight/over-rotate the muzzle. So when the weapon system owns the arm,
          // SKIP the additive arm posing here (let actorweapons hold the level) and
          // only do the tense fear face below. An armed ped WITHOUT a built prop, or
          // a fearless-but-unarmed bruiser squaring up, still gets the arm pose from
          // this path. Gated to city; jail aim-back (guards/npcs) is UNCHANGED.
          const weaponOwnsArm = isCity && a.armed && a._weaponProp && a._weaponProp.visible;
          if (!weaponOwnsArm) {
            if (parts.ra) {
              const before = parts.ra.rotation.x;
              const want = damp(before, AIM_ARM, 14, dt);
              r.raOff = want - before; parts.ra.rotation.x = want;
            }
            if (parts.la) {
              const before = parts.la.rotation.x;
              const want = damp(before, AIM_ARM * 0.5, 13, dt);
              r.laOff = want - before; parts.la.rotation.x = want;
            }
          }
          setFearFace(a, 0.4);                    // tense, not full terror
        } else if (handsUp) {
          // A true gunpoint SURRENDER (poseHandsUp) stands UPRIGHT with both arms
          // thrown clearly OVERHEAD — NOT the hunched, arms-forward cower (that one
          // is for someone merely scared by nearby gunfire). Store the delta we add
          // so we can back it out of the damped base next frame.
          const surr = !!a.poseHandsUp;
          const armT = surr ? SURRENDER_ARM : COWER_ARM;
          // ONE ARM DRIVER: when animChar already HOLDS the overhead surrender pose
          // (city/peds.js sets char.handsUp so character.js hard-damps the arms to
          // -2.5 and keeps them there), our additive arm write would stack on top
          // and over-rotate the arms past vertical (the "bowing"/double-drive). So
          // if animChar owns the arms, SKIP the additive arm posing entirely (laOff/
          // raOff stay 0) and let animChar be the sole arm driver. We STILL do the
          // fear face + body lean-ease below, and the flash/recoil run regardless.
          // Jail (guards/npcs) never set char.handsUp here, so this never trips for
          // them — their hands-up keeps coming from this additive path, UNCHANGED.
          const animOwnsArms = !!(a.char && (a.char.handsUp || a.char.surrender));
          if (!animOwnsArms) {
            if (parts.la) {
              const before = parts.la.rotation.x;
              const want = damp(before, armT, 12, dt);
              r.laOff = want - before; parts.la.rotation.x = want;
            }
            if (parts.ra) {
              const before = parts.ra.rotation.x;
              const want = damp(before, armT, 12, dt);
              r.raOff = want - before; parts.ra.rotation.x = want;
            }
          }
          if (surr) {
            // hands high, head up — NO forward hunch. Ease any existing lean out.
            const next = damp(r.cowerLean, 0, 8, dt);
            r.cowerLean = next < 0.002 ? 0 : next;
            if (!down) bodyOff += r.cowerLean;
            setFearFace(a, 1);                       // gunpoint = pure terror
          } else {
            // a frightened cower hunches forward to protect.
            r.cowerLean = damp(r.cowerLean, COWER_LEAN, 8, dt);
            bodyOff += r.cowerLean;
          }
        } else if (r.cowerLean) {
          // ease the hunch back out when no longer fleeing
          const next = damp(r.cowerLean, 0, 8, dt);
          r.cowerLean = next < 0.002 ? 0 : next;
          if (!down) bodyOff += r.cowerLean;
        }

        // ============================================================
        //  CITY FIGHT READS — all additive, all fast-decay, all inside the
        //  isCity gate so jail/survival posing is byte-identical. Pose writes
        //  are ALSO gated on the body being upright (`flat` below): while the
        //  rig is laid out / mid-get-up, animChar is skipped (body.busy), so
        //  an un-stored add to an assigned channel would accumulate.
        // ============================================================
        if (isCity && parts && body) {
          const laidOut = pp && (pp.air || pp.down > 0);   // grapple owns flat bodies
          const flat = down || laidOut || Math.abs(a.group.rotation.x) > 0.05;
          // only pose a rig animChar actually refreshed this frame: between the
          // 58m anim gate and our 150m LOD, peds.js skips animChar for boring
          // peds, so a store-less add to body pitch/roll would ACCUMULATE with
          // nothing assigning the channel fresh. Mirror peds.js's
          // near-or-important animate condition (3364 = 58²).
          let animated = true;
          if (cam) {
            const adx = a.pos.x - cam.x, adz = a.pos.z - cam.z;
            animated = (adx * adx + adz * adz < 3364) ||
                       !!(a.rage || a.armed || a.guard || (a.npcWanted | 0) >= 1 || a.reportState || a.approach);
          }
          const live = !flat && animated;
          const ry = a.group.rotation.y || 0;
          const seed = a._deathSeed || 0;
          const gunArm = a.armed && a._weaponProp && a._weaponProp.visible; // actorweapons owns it

          // ---- (1) DIRECTIONAL STAGGER: lurch along the REAL push direction
          //      so a watcher reads who hit whom — head whipping harder than
          //      the torso is what sells the force. ----
          if (r.stagT > 0) {
            r.stagT = Math.max(0, r.stagT - dt);
            if (live) {
              const k = r.stagT / STAG_DUR;
              const amp = k * k * r.stagAmp;                 // peak at impact, force-scaled
              // express the world push in the actor's local frame (+z fwd, +x right)
              const lf = Math.cos(ry) * r.stagZ + Math.sin(ry) * r.stagX;
              const ls = Math.cos(ry) * r.stagX - Math.sin(ry) * r.stagZ;
              bodyOff += lf * STAG_PITCH * amp;              // front hit → reel back
              bodyRoll += -ls * STAG_ROLL * amp;             // side hit → keel sideways
              r.byOff += ls * STAG_YAW * amp;                // shoulders twist off it
              if (neck) r.nkOff += lf * STAG_HEAD * amp;     // head whips hardest
              // real KNEE flex (rig.low): the stepped-back leg absorbs the shove —
              // both knees dip, scaled by the SAME amp so a light tap barely
              // registers and a heavy blow reads as a real leg-buckling stagger.
              // CLAMP-AND-TRACK (>=0, and store the delta actually applied —
              // see the get-up branch for why a raw += can transiently go negative).
              if (low) {
                const kdip = STAG_KNEE * amp;
                if (low.ll) { const b0 = low.ll.rotation.x, w = Math.max(0, b0 + kdip); r.lowLlOff += w - b0; low.ll.rotation.x = w; }
                if (low.rl) { const b0 = low.rl.rotation.x, w = Math.max(0, b0 + kdip); r.lowRlOff += w - b0; low.rl.rotation.x = w; }
              }
              // ARMS WINDMILL for balance — amp² so it's near-silent on a light
              // flinch and only really kicks in once a hit is heavy enough that
              // stagAmp rides high (a big shove/knockdown-adjacent hit).
              const flail = amp * amp * STAG_WINDMILL;
              if (flail > 0.01) {
                const el = game.elapsed || 0;
                const wl = Math.sin(el * 15 + seed * 3.1) * flail;
                const wr = Math.sin(el * 15 + Math.PI + seed * 3.1) * flail;
                if (parts.la) { parts.la.rotation.x += wl; r.laOff += wl; }
                if (parts.ra && !gunArm) { parts.ra.rotation.x += wr; r.raOff += wr; }
              }
            }
          }

          // ---- (1b) BULLET FLINCH: a sharper jerk + head snap layered over the
          //      stagger — dies off exponentially in ~220ms, magnitude rides the
          //      round's force. A close shotgun hit pairs this snap WITH the big
          //      stagger lurch; a 9mm graze barely tics the head. ----
          if (r.flinT > 0) {
            r.flinT = Math.max(0, r.flinT - dt);
            if (live) {
              const e = r.flinT / FLIN_DUR;
              const k = e * e * e * r.flinAmp;               // sharp attack, exponential-feel die-off
              const lf = Math.cos(ry) * r.flinZ + Math.sin(ry) * r.flinX;
              const ls = Math.cos(ry) * r.flinX - Math.sin(ry) * r.flinZ;
              bodyOff += lf * FLIN_PITCH * k;                // torso jerked along the push
              bodyRoll += -ls * 0.18 * k;
              r.byOff += ls * FLIN_YAW * k;                  // shoulders wrenched off it
              if (neck) r.nkOff += lf * FLIN_HEAD * k;       // the head snap sells the round
            }
          }

          // ---- (1c) WOUND-CLUTCH: after a non-fatal shot the near hand claps
          //      over the wound and the torso curls protectively off it. Eases
          //      out over CLUTCH_DUR; the longer "he's hurt" read that sits under
          //      the sharp flinch above. Skips the gun arm (actorweapons owns it)
          //      and any frame an overriding pose (block/aim/surrender) is up. ----
          if (r.clutchT > 0) {
            r.clutchT = Math.max(0, r.clutchT - dt);
            if (live && !aimBack && !handsUp && !((a._broken || 0) > 0) && !((a._blockT || 0) > 0)) {
              const k = r.clutchT / CLUTCH_DUR;          // 1 → 0
              const ease = Math.sin(Math.min(1, k * 1.7) * 1.5708);  // quick reach, slow release
              const w = ease * r.clutchAmp;
              bodyOff += 0.18 * w;                        // curl forward, protecting the wound
              r.byOff += r.clutchSide * 0.18 * w;         // shoulder rolls in over it
              const arm = r.clutchSide > 0 ? parts.ra : parts.la;
              const isGun = gunArm && ((r.clutchSide > 0) === true); // ra is the usual gun arm
              if (arm && !isGun) {
                const off = (CLUTCH_ARM - 0) * w;
                arm.rotation.x += off;                    // fold the hand in across the body
                arm.rotation.z += -r.clutchSide * 0.5 * w;
                if (r.clutchSide > 0) r.raOff += off; else r.laOff += off;
              }
              if (neck) r.nkOff += 0.2 * w;               // head dips toward the wound
            }
          }

          // ---- (2) SWING LEAN-IN: weight committed behind an NPC punch
          //      (and a cock-back off combat.js's _windup telegraph first). ----
          if (r.swingT > 0) {
            r.swingT = Math.max(0, r.swingT - dt);
            if (live) {
              const k = r.swingT / SWING_DUR;                // 1 at impact → 0
              bodyOff += SWING_LEAN * k;                     // lean INTO the target
              r.byOff += r.swingArm * SWING_TWIST * k;       // hips behind the fist
              if (!gunArm) {
                const arm = r.swingArm > 0 ? parts.ra : parts.la;
                if (arm) {
                  const off = SWING_ARM * k * k;             // extended, snaps back
                  arm.rotation.x += off;
                  if (r.swingArm > 0) r.raOff += off; else r.laOff += off;
                }
              }
            }
          } else if ((a._windup || 0) > 0 && live && a.state === "fight") {
            // the swing alternates hands on detection, so wind up the NEXT fist
            const w = Math.min(1, a._windup / 0.25);
            bodyOff += -0.12 * w;                            // rock back to load it
            if (!gunArm) {
              const arm = r.swingArm > 0 ? parts.la : parts.ra;
              if (arm) {
                const off = 0.5 * w;                         // fist drawn behind the hip
                arm.rotation.x += off;
                if (r.swingArm > 0) r.laOff += off; else r.raOff += off;
              }
            }
          }

          // ---- (3) GUARD READ: _blockT poses the block, _broken shows the
          //      opening — the pose teaches "jab eaten → throw the heavy". ----
          const dazed = (a._broken || 0) > 0 && live;
          if (dazed) {
            // arms hang slack — visibly OPEN for the finisher
            if (parts.la) { const b0 = parts.la.rotation.x; const w = damp(b0, DAZE_ARM, 10, dt); r.laOff += w - b0; parts.la.rotation.x = w; }
            if (parts.ra && !gunArm) { const b0 = parts.ra.rotation.x; const w = damp(b0, DAZE_ARM * 0.8, 10, dt); r.raOff += w - b0; parts.ra.rotation.x = w; }
          } else if ((a._blockT || 0) > 0 && live && !aimBack && !handsUp) {
            // shoulders raise the arms toward guard height, then the ELBOWS fold
            // hard so the FOREARMS actually cross in front of the face — a real
            // cover, not the old straight-arm paddle (rig.low is the elbow pivot).
            // guardK is a CLEAN internal weight, damped independently of the bone
            // (not read back from parts.la/ra) and then HARD-ASSIGNED onto the
            // shoulder/elbow — a plain additive offset here decays back to 0
            // every frame (animChar's own idle arm-swing target IS 0, and it
            // re-damps toward that from whatever we left, so back-and-forth
            // subtraction can never actually HOLD a pose against it — only an
            // outright assign, like animChar's own aimingPose/handsUp branches
            // use, sticks).
            r.guardK = damp(r.guardK, 1, 18, dt);
            const gk = r.guardK;
            if (parts.la) parts.la.rotation.x = BLOCK_ARM * gk;
            if (parts.ra && !gunArm) parts.ra.rotation.x = BLOCK_ARM * 0.9 * gk;
            if (low && low.la) low.la.rotation.x = BLOCK_ELBOW * gk;
            if (low && low.ra && !gunArm) low.ra.rotation.x = BLOCK_ELBOW * 0.95 * gk;
            bodyOff += BLOCK_HUNCH * Math.min(1, (a._blockT || 0) / 0.15);  // ease out at expiry
          } else if (r.guardK > 0.001) {
            // guard just ended — ease the same hard-assigned pose back to 0
            // (which IS animChar's own idle/gait target, so the hand-off is seamless).
            r.guardK = damp(r.guardK, 0, 10, dt);
            const gk = r.guardK;
            if (parts.la) parts.la.rotation.x = BLOCK_ARM * gk;
            if (parts.ra && !gunArm) parts.ra.rotation.x = BLOCK_ARM * 0.9 * gk;
            if (low && low.la) low.la.rotation.x = BLOCK_ELBOW * gk;
            if (low && low.ra && !gunArm) low.ra.rotation.x = BLOCK_ELBOW * 0.95 * gk;
          }
          // ---- (3b) AIM PRESENCE: an armed shooter visibly TRACKS its mark —
          //      head turned to the target, shoulders opened, and the gun arm's
          //      ELEVATION corrected so the barrel line actually points where the
          //      bullets go (actorAimAt is yaw-only; pitch lived nowhere). The arm
          //      channel is hard-assigned by actorweapons (36) every frame the gun
          //      is out, so an add can't accumulate; the neck yaw gets its own
          //      stored offset (hyOff), backed out above. Blends in/out ~150ms. ----
          let aimT = null;
          if (live && gunArm && a.rage && !a.rage.dead && a.rage.pos &&
              !aimBack && !handsUp && !a.surrender && !(a.char.handsUp || a.char.surrender)) {
            const adx = a.rage.pos.x - a.pos.x, adz = a.rage.pos.z - a.pos.z;
            if (adx * adx + adz * adz < AIM_RANGE2) aimT = a.rage;
          }
          r.aimK = damp(r.aimK, aimT ? 1 : 0, 14, dt);
          if (aimT) {
            const tdx = aimT.pos.x - a.pos.x, tdz = aimT.pos.z - a.pos.z;
            const th = Math.hypot(tdx, tdz) || 0.001;
            const ty = (aimT.pos.y || 0) + (aimT.isPlayer ? 1.5 : 1.35);
            let relY = Math.atan2(tdx, tdz) - ry;
            relY = ((relY + Math.PI) % (Math.PI * 2)) - Math.PI;
            if (relY < -Math.PI) relY += Math.PI * 2;
            if (relY > AIM_HEAD_YAW) relY = AIM_HEAD_YAW; else if (relY < -AIM_HEAD_YAW) relY = -AIM_HEAD_YAW;
            const elev = Math.atan2(ty - ((a.pos.y || 0) + 1.84), th);  // shoulder → target
            let hp2 = -elev * 0.7;                                      // facial convention: -x looks up
            if (hp2 > AIM_HEAD_PIT) hp2 = AIM_HEAD_PIT; else if (hp2 < -AIM_HEAD_PIT) hp2 = -AIM_HEAD_PIT;
            let armC = -elev;                                           // more negative = barrel raised
            if (armC > AIM_ELEV) armC = AIM_ELEV; else if (armC < -AIM_ELEV) armC = -AIM_ELEV;
            r.aimY = relY; r.aimP = hp2; r.aimA = armC;
          }
          if (r.aimK > 0.02 && live) {
            r.hyOff = r.aimY * r.aimK;                                  // head turned onto the mark
            if (neck) r.nkOff += r.aimP * r.aimK;
            r.byOff += r.aimY * 0.3 * r.aimK;                           // shoulders open toward it
            if (gunArm) {                                               // only while actorweapons assigned the arm this frame
              if (parts.ra) parts.ra.rotation.x += r.aimA * r.aimK;
              if (parts.la && a._weaponProp.userData && a._weaponProp.userData.weaponSlot === "long")
                parts.la.rotation.x += r.aimA * r.aimK;                 // support hand rides the long gun up/down
            }
          }

          // the dazed SWAY eases in/out so the break (and recovery) never pops
          r.dazeK = damp(r.dazeK, dazed ? 1 : 0, 6, dt);
          if (r.dazeK > 0.01 && live) {
            const el = game.elapsed || 0;
            bodyOff += Math.sin(el * 2.3 + seed) * 0.1 * r.dazeK;
            bodyRoll += Math.sin(el * 1.7 + seed * 2.1) * DAZE_SWAY * r.dazeK;
            if (neck) r.nkOff += DAZE_HEAD * r.dazeK;        // head sags, out on his feet
          }

          // ---- (4) GET-UP VARIETY: while grapple eases group.rotation.x back
          //      upright (animChar is skipped — body.busy gates it), the rig
          //      otherwise rises as the same stiff plank every time. Blend one
          //      of 3 poses, weighted by remaining FLATNESS so it dissolves
          //      exactly at upright. Seeded by _deathSeed (every knockdown sets
          //      it) → stable per person, different across a dropped crowd. ----
          const rising = !down && pp && !pp.air && pp.down <= 0 &&
                         Math.abs(a.group.rotation.x) > 0.05;
          if (rising) {
            const k = Math.min(1, Math.abs(a.group.rotation.x) / 1.45);
            const v = Math.abs(Math.sin(seed * 3.1));
            // body pitch/roll have no animChar assign while flat → own back-out
            body.rotation.x -= r.gbx; body.rotation.z -= r.gbz;
            let gx = 0, gz = 0;
            if (v < 0.45) {
              // SIT-UP PUSH: arms drive forward, head curls in, knees pull up
              gx = 0.35 * k;
              if (parts.la) { parts.la.rotation.x += -1.25 * k; r.laOff += -1.25 * k; }
              if (parts.ra) { parts.ra.rotation.x += -1.1 * k; r.raOff += -1.1 * k; }
              if (parts.ll) { parts.ll.rotation.x += -0.55 * k; r.llOff += -0.55 * k; }
              if (parts.rl) { parts.rl.rotation.x += -0.4 * k; r.rlOff += -0.4 * k; }
              // real KNEE bend (rig.low): both legs pull up as the body curls in.
              // CLAMP-AND-TRACK: animChar's OWN setKnee damps rig.low from
              // whatever we leave it at toward ITS OWN (also clamped) target —
              // the same interaction that made the guard-arm damp-to-target
              // decay to 0 can, here, transiently drag an ADDITIVE knee offset
              // negative (breaking the knee>=0 convention) for a few frames.
              // Compute the final value, clamp it, then store the delta we
              // ACTUALLY applied (not the raw offset) so next frame's
              // back-out stays exact.
              if (low && low.ll) { const b0 = low.ll.rotation.x, w = Math.max(0, b0 + 1.1 * k); r.lowLlOff += w - b0; low.ll.rotation.x = w; }
              if (low && low.rl) { const b0 = low.rl.rotation.x, w = Math.max(0, b0 + 0.95 * k); r.lowRlOff += w - b0; low.rl.rotation.x = w; }
              if (neck) r.nkOff += 0.5 * k;
            } else {
              // ROLL TO A KNEE (either side): weight over one planted arm,
              // the opposite knee up — reads as pushing off the ground.
              const s = v < 0.72 ? 1 : -1;
              gx = 0.22 * k;
              gz = -0.42 * k * s;
              const plant = -0.85 * k, knee = -1.15 * k;
              // real KNEE bend (rig.low): the forward leg's knee folds as the
              // foot plants ahead to push off; the rear leg's knee folds DEEP —
              // it's the one still down, planted, taking the weight — so the
              // pose actually reads "one knee planted, push up", not a stiff-leg
              // hinge at the hip alone.
              const kneeFwd = 1.0 * k, kneePlant = 1.35 * k;
              // CLAMP-AND-TRACK (see the sit-up branch above for why): compute
              // the final knee value, clamp to >=0, store the delta actually
              // applied so next frame's back-out stays exact.
              if (s > 0) {
                if (parts.ra) { parts.ra.rotation.x += plant; r.raOff += plant; }
                if (parts.ll) { parts.ll.rotation.x += knee; r.llOff += knee; }
                if (low && low.ll) { const b0 = low.ll.rotation.x, w = Math.max(0, b0 + kneeFwd); r.lowLlOff += w - b0; low.ll.rotation.x = w; }
                if (low && low.rl) { const b0 = low.rl.rotation.x, w = Math.max(0, b0 + kneePlant); r.lowRlOff += w - b0; low.rl.rotation.x = w; }
              } else {
                if (parts.la) { parts.la.rotation.x += plant; r.laOff += plant; }
                if (parts.rl) { parts.rl.rotation.x += knee; r.rlOff += knee; }
                if (low && low.rl) { const b0 = low.rl.rotation.x, w = Math.max(0, b0 + kneeFwd); r.lowRlOff += w - b0; low.rl.rotation.x = w; }
                if (low && low.ll) { const b0 = low.ll.rotation.x, w = Math.max(0, b0 + kneePlant); r.lowLlOff += w - b0; low.ll.rotation.x = w; }
              }
              if (neck) r.nkOff += 0.3 * k;
            }
            body.rotation.x += gx; body.rotation.z += gz;
            r.gbx = gx; r.gbz = gz;
          } else if (r.gbx || r.gbz || r.llOff || r.rlOff || r.lowLlOff || r.lowRlOff) {
            // animChar's assign wiped any residual the moment it resumed — just
            // forget the stores (subtracting would dent the fresh base instead).
            // This MUST also forget the leg offsets (hip llOff/rlOff and the
            // real-knee lowLlOff/lowRlOff): the top-of-frame back-out already
            // undid last frame's write once this frame (rising just went
            // false), but nothing re-adds a fresh one — leaving the stale
            // value sitting in the record would make NEXT frame's back-out
            // subtract an offset that was never re-applied, dragging the knee
            // negative (breaking the knee>=0 convention) for a few frames.
            r.gbx = 0; r.gbz = 0;
            r.llOff = 0; r.rlOff = 0; r.lowLlOff = 0; r.lowRlOff = 0;
          }
        }

        // apply the combined body offset on top of animChar's fresh base
        if (body && bodyOff) body.rotation.x += bodyOff;
        // city extras land the same way: roll rides animChar's rotation.z assign;
        // yaw + neck are damped channels, already backed out at the top.
        if (isCity) {
          if (body && bodyRoll) body.rotation.z += bodyRoll;
          if (body && r.byOff) body.rotation.y += r.byOff;
          if (neck && r.nkOff) neck.rotation.x += r.nkOff;
          if (neck && r.hyOff) neck.rotation.y += r.hyOff;
        }

        // ---- HEAD SNAP (CBZ.reactPunch) — jail AND city, upright only. A single
        //      decaying magnitude (headAmp) projected onto the neck's 3 axes by
        //      the direction/kind fixed at the moment of impact:
        //        jab/cross → straight back along the punch line (pitch)
        //        hook      → turns AWAY from the fist (yaw + a touch of roll)
        //        upper     → chin snaps UP first, then the head continues back
        //                    (the amp*(1-amp) term is 0 at both ends of the decay
        //                    and peaks mid-decay, so it reads as a SECOND beat
        //                    after the initial upward snap, with no extra state)
        //      headAmp itself decays AFTER we read it, so this frame's pose uses
        //      the value the trigger (or last frame) actually left behind.
        if (neck && !down && r.headAmp > 0.001) {
          const amp = r.headAmp;
          let px, py = 0, pz = 0;
          if (r.headKind === "hook") {
            px = HEAD_PITCH * 0.2 * amp * r.headLf;
            py = HEAD_HOOK_YAW * amp * r.headLs;
            pz = -HEAD_HOOK_ROLL * amp * r.headLs;
          } else if (r.headKind === "upper") {
            // both terms share the jab's "snap back" sign (verified empirically:
            // positive neck.rotation.x whips the head backward/up) — the uppercut
            // is an instant up-snap PLUS a second, slightly bigger wave of the
            // same backward whip that crests mid-decay (the amp*(1-amp) hump).
            px = HEAD_UPPER_UP * amp + HEAD_UPPER_BACK * amp * (1 - amp) * 4;
          } else {   // jab / cross
            px = HEAD_PITCH * amp * r.headLf;
          }
          r.hsX = px; r.hsY = py; r.hsZ = pz;
          neck.rotation.x += px; neck.rotation.y += py; neck.rotation.z += pz;
        }
        r.headAmp = damp(r.headAmp, 0, HEAD_DECAY, dt);
        if (r.headAmp < 0.01) r.headAmp = 0;

        // ---- LOW-JOINT (knee/elbow) CONVENTION CLAMP ----
        // Every reaction layer above that touches rig.low (get-up knee-bend,
        // stagger knee-dip) is additive on top of a channel animChar ALSO
        // damps toward its own (separately clamped) target — the exact
        // feedback that made the guard-arm damp-to-target decay to 0 (see
        // that fix's comment) can, in the other direction, transiently
        // overshoot PAST 0 for a few frames right as a timed pose (get-up,
        // a stagger dip) ends. Rather than chase that transient in every
        // layer, enforce the rig's hard physical convention here ONCE, as a
        // final guarantee independent of any one layer's math — cheap, and
        // correct for jail AND city (the convention isn't isCity-specific):
        //   KNEE (low.ll/low.rl) folds BACKWARD only → rotation.x >= 0
        //   ELBOW (low.la/low.ra) folds FORWARD only  → rotation.x <= 0
        if (low) {
          if (low.ll && low.ll.rotation.x < 0) low.ll.rotation.x = 0;
          if (low.rl && low.rl.rotation.x < 0) low.rl.rotation.x = 0;
          if (low.la && low.la.rotation.x > 0) low.la.rotation.x = 0;
          if (low.ra && low.ra.rotation.x > 0) low.ra.rotation.x = 0;
        }

        // ---- BODY-PITCH SAFETY CLAMP (root-cause fix for the "walk folds the
        //      torso ~90°" bug) ----
        // Every CITY pose layer above adds to body.rotation.x INDEPENDENTLY and
        // none knew about the others, so on a busy frame they could sum without
        // bound — a fleeing/cowering ped that also takes a round stacks animChar's
        // lean + cower (0.4) + stagger forward pitch (≤0.6) + flinch (≤0.45) +
        // wound-clutch (0.18) and folds the upper body nearly flat mid-stride (the
        // owner-filmed "weirdly bent" walk). Each layer is legitimate in isolation;
        // only their unclamped SUM is wrong. Cap the final upper-body pitch to a
        // deep-but-human range so the heaviest flinch still reads as a person
        // reeling, never a 90° fold. This sits AFTER the get-up writes (≤0.35) and
        // bodyOff, so it bounds every contributor without changing any of them.
        //   CITY-ONLY (isCity): the jail/survival passes never stack the city fight
        //   layers — their only body-pitch sources are recoil + cower (max ~1.07,
        //   reached only when shot mid-cower) — and those modes must stay byte-
        //   identical, so the clamp must not touch them.
        //   LIVE, UPRIGHT rigs only: laid-out / mid-get-up bodies pitch via
        //   group.rotation (clamped via its own k) and animChar is skipped for them.
        //   The `flat` gate (computed above for the city pose block) excludes
        //   knocked-down and mid-get-up frames, where body.rotation.x/z carry the
        //   get-up branch's OWN backed-out writes (r.gbx) — clamping there would
        //   desync that back-out. On an upright walker both channels are freshly
        //   ASSIGNED by animChar, so the clamp is purely a ceiling with no feedback.
        const upright = isCity && body && !down &&
          !(pp && (pp.air || pp.down > 0)) && Math.abs(a.group.rotation.x) <= 0.05;
        if (upright) {
          const MAX_FWD = 0.95;   // deepest forward bend (matches the severed-leg crawl read)
          const MAX_BACK = -0.7;  // deepest backward reel
          if (body.rotation.x > MAX_FWD) body.rotation.x = MAX_FWD;
          else if (body.rotation.x < MAX_BACK) body.rotation.x = MAX_BACK;
          // side-keel (roll) sums the same independent layers (stagger + flinch +
          // daze) — bound it too so a busy frame can't tip the torso flat sideways.
          // SAFE to clamp here: animChar ASSIGNS body.rotation.z (= ch.sway) fresh
          // every frame, so a clamp can't feed back. (body.rotation.y / yaw is a
          // DAMPED, backed-out channel — clamping it post-add would desync r.byOff,
          // so it is deliberately left to its own already-modest sum.)
          const ROLL = 0.6;       // ~34°: a deep side-keel, still upright
          if (body.rotation.z > ROLL) body.rotation.z = ROLL;
          else if (body.rotation.z < -ROLL) body.rotation.z = -ROLL;
        }

        // ---- FLASH: fade the emissive boost back to rest ----
        if (r.flash > 0) {
          r.flash = Math.max(0, r.flash - dt);
          const m = headMat(a);
          if (m && m.emissive) {
            const t = r.flash / FLASH_DUR;            // 1 → 0
            if (t <= 0) {
              restoreHead(r, a);                       // fully back to rest
            } else {
              const baseEi = r.savedEm >= 0 ? r.savedEi : 1;
              m.emissiveIntensity = baseEi + (FLASH_EI - baseEi) * t;
              // blend the emissive color from FLASH_HEX back toward rest
              if (r.savedEm >= 0) {
                const rest = r.savedEm;
                const fr = (FLASH_HEX >> 16) & 255, fg = (FLASH_HEX >> 8) & 255, fb = FLASH_HEX & 255;
                const rr = (rest >> 16) & 255, rg = (rest >> 8) & 255, rb = rest & 255;
                const cr = (rr + (fr - rr) * t) | 0;
                const cg = (rg + (fg - rg) * t) | 0;
                const cb = (rb + (fb - rb) * t) | 0;
                m.emissive.setRGB(cr / 255, cg / 255, cb / 255);
              }
            }
          } else {
            // head/material vanished mid-flash: drop the flash and forget
            // we ever saved anything so we never try to restore it.
            r.flash = 0; r.savedEm = -1;
          }
        }
      }
    }
  }

  // ============================================================
  //  PUBLIC: CBZ.reactPunch(target, opts) — call this the INSTANT a melee
  //  punch actually connects (city/combat.js land(), city/peds.js hurtActor,
  //  systems/combat.js landPunch) so the head-snap/clutch reaction is driven
  //  by the real swing that landed, not guessed a frame later from an hp/fl
  //  edge. Safe to call for any actor rec() tracks (guards/npcs/cityPeds);
  //  a target with no .group is ignored.
  //    opts.kind   : "jab" | "cross" | "hook" | "upper" (default "cross")
  //    opts.heavy  : true for a heavy/finisher/counter blow — snaps harder
  //                  and, in the city, adds a beat of wound-clutch daze.
  //    opts.fromX/fromZ : the ATTACKER's world position (so the snap can
  //                  read "away from the fist" / "along the punch line").
  // ============================================================
  function reactPunch(target, opts) {
    if (!target || !target.group) return;
    opts = opts || {};
    const r = rec(target);
    const kind = opts.kind || "cross";
    const heavy = !!opts.heavy;

    // express the attacker->target push in the target's own local frame
    // (+z forward, +x right) — same lf/ls convention the city stagger uses,
    // so a jab (frontal) and a hook (lateral) read as genuinely different hits.
    let lf = 1, ls = 0;
    if (opts.fromX != null && opts.fromZ != null) {
      const gx = target.group.position.x, gz = target.group.position.z;
      let dx = gx - opts.fromX, dz = gz - opts.fromZ;
      const d = Math.hypot(dx, dz) || 1; dx /= d; dz /= d;
      const ry = target.group.rotation.y || 0;
      lf = Math.cos(ry) * dz + Math.sin(ry) * dx;
      ls = Math.cos(ry) * dx - Math.sin(ry) * dz;
    }

    r.headKind = kind;
    r.headLf = lf; r.headLs = ls;
    r.headAmp = Math.max(r.headAmp, heavy ? HEAD_HEAVY_MULT : 1);

    // a heavy punch to the head leaves them clutching it for a beat before
    // recovering — reuse the wound-clutch pose (already fully general; it
    // only needs clutchT/clutchSide/clutchAmp, no bullet-specific state).
    // City-only: jail/survival never read these fields (see the header note).
    if (heavy && CBZ.game && CBZ.game.mode === "city" && !target.dead) {
      r.clutchSide = ls >= 0 ? -1 : 1;
      r.clutchT = CLUTCH_DUR;
      r.clutchAmp = 0.75;
    }
  }
  CBZ.reactPunch = reactPunch;

  // LATE (89): after animChar (20/22) and facial.js (88) have posed the
  // rig this frame, so our additive offsets sit on a fresh base.
  CBZ.onUpdate(89, update);
})();
