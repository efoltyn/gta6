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

  // per-actor reaction record, keyed by the actor object.
  //   hp        : last frame's hp (to detect a drop)
  //   recoil    : remaining recoil time (s); peak at start, 0 = done
  //   dir       : sign of the flinch (+/- so they pitch away from player)
  //   flash     : remaining flash time (s)
  //   laOff/raOff : arm pitch we added last frame (cower, to back out)
  //   cowerLean : smoothed body-hunch accumulator (0..COWER_LEAN)
  //   savedEm   : original emissive color hex of the head (-1 = none saved)
  //   savedEi   : original emissive intensity of the head
  const R = new Map();

  function rec(a) {
    let r = R.get(a);
    if (!r) {
      r = {
        hp: a.hp != null ? a.hp : null,
        recoil: 0, dir: 1, flash: 0,
        laOff: 0, raOff: 0, cowerLean: 0,
        savedEm: -1, savedEi: 1,
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
          if (a._parked || a.culled || a.controlled) continue;
          // far + nothing animating to see → don't pay for the pose math. Clear any
          // stored additive offset (without allocating a record) so the ped doesn't
          // back out a phantom offset the frame it re-enters range.
          if (cam && !a.dead) {
            const ddx = a.pos.x - cam.x, ddz = a.pos.z - cam.z;
            if (ddx * ddx + ddz * ddz > CITY_LOD2) {
              const old = R.get(a);
              if (old) { old.laOff = 0; old.raOff = 0; old.cowerLean = 0; }
              continue;
            }
          }
        }

        // ---- velocity-based KNOCKBACK from the shared body layer: hits set
        //      a._phys.kx/kz (combat.js / fpsmode.js / grapple.js), and we
        //      slide + decay it here so a punch/shot shoves them back over a
        //      few frames instead of teleporting. ----
        const pp = a._phys;
        if (pp && (Math.abs(pp.kx) > 0.02 || Math.abs(pp.kz) > 0.02)) {
          a.group.position.x += pp.kx * dt; a.group.position.z += pp.kz * dt;
          const dec = Math.pow(0.0009, dt); pp.kx *= dec; pp.kz *= dec;
          if (CBZ.collide) CBZ.collide(a.group.position, 0.5);
        }

        const r = rec(a);
        const ch = a.char;
        const body = ch.body;
        const parts = ch.parts;

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

        // downed / dead actors: they lie flat (group.rotation.z ~ PI/2);
        // skip the live pose reactions but keep the flash fading out so a
        // KO'ing blow still pops, and keep timers bleeding down.
        const down = a.dead || (a.ko != null && a.ko > 0) || a.escaped;

        // the body offset is the SUM of the recoil flinch and the cower
        // hunch, applied once on top of animChar's fresh assignment.
        let bodyOff = 0;

        // ---- RECOIL: a flinch that eases back over RECOIL_DUR ----
        if (r.recoil > 0) {
          r.recoil = Math.max(0, r.recoil - dt);
          if (!down) {
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
          setFearFace(a, 0.4);                    // tense, not full terror
        } else if (handsUp) {
          // A true gunpoint SURRENDER (poseHandsUp) stands UPRIGHT with both arms
          // thrown clearly OVERHEAD — NOT the hunched, arms-forward cower (that one
          // is for someone merely scared by nearby gunfire). Store the delta we add
          // so we can back it out of the damped base next frame.
          const surr = !!a.poseHandsUp;
          const armT = surr ? SURRENDER_ARM : COWER_ARM;
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

        // apply the combined body offset on top of animChar's fresh base
        if (body && bodyOff) body.rotation.x += bodyOff;

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

  // LATE (89): after animChar (20/22) and facial.js (88) have posed the
  // rig this frame, so our additive offsets sit on a fresh base.
  CBZ.onUpdate(89, update);
})();
