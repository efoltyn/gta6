/* ============================================================
   systems/facial.js — micro facial animation for EVERY rig.

   Brings the blocky faces to life with cheap, layered detail:
     • Blinks          — squash face.eyeL/R.scale.y to ~0.1 for a
                          few frames at random intervals (desynced).
     • Eye darts       — tiny face.eyeL/R.position.x offset that
                          flicks to a new spot now and then, eased.
     • Talking         — when an actor is socializing (npc.aiState===
                          "socialize") or fighting, the mouth opens /
                          closes (scale.y + a small position.y dip) on
                          a fast wobble so they look like they're
                          yapping at each other.
     • Head tracking   — when the player is within ~6 units AND
                          roughly in front of the actor's facing, the
                          neck gently yaws/pitches to glance at the
                          player. Eased; tiny angles only.

   Everything is additive on top of what entities/character.js's
   animChar() already wrote this frame, so we run LATE (order 88) and
   carefully remove last frame's contribution before re-reading the
   animChar base for neck.rotation.x — otherwise our offset would feed
   back into animChar's damp() and drift. (animChar runs via onUpdate
   only while playing; on menus it never touches the neck, but our
   back-out/re-add is self-consistent there too — we only ever undo and
   re-apply OUR OWN offset, so there is no drift in any state.)

   CHEAP-FOR-PHONES: we round-robin — only a handful of actors get a
   full update each frame; the rest just hold their current eased
   state. Blinks/darts are driven off CBZ.now so a skipped frame never
   freezes mid-blink. No per-frame allocation in the hot loop.

   Reset-safe: facial state lives on the rig as ._fa and is purely
   cosmetic + self-correcting (time-driven blinks, eased offsets that
   converge), so reusing rigs across runs needs no explicit reset. The
   round-robin cursor is bounded and re-clamped every frame.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;

  // resting local positions baked into the rig (see character.js):
  //   eyes  x = ±0.14   eyes y = 0.34   mouth y = 0.16
  const EYE_X = 0.14;       // rest |x| of each eye
  const EYE_Y = 0.34;       // rest y of each eye
  const MOUTH_Y = 0.16;     // rest y of the mouth
  const TRACK_DIST = 8;     // start glancing at the player within this ("noticed you" range)
  const TRACK_DIST2 = TRACK_DIST * TRACK_DIST;
  const NEAR_GLANCE2 = 12 * 12;   // within this, recompute the glance EVERY frame (responsive)
  const MAX_PER_FRAME = 4;  // round-robin budget (rest hold their ease)

  // frame-rate-independent approach toward a target (per-second rate)
  function damp(cur, target, rate, dt) {
    return cur + (target - cur) * (1 - Math.exp(-rate * dt));
  }
  // shortest-arc angle lerp, falls back to a local copy if the engine's
  // helper isn't present yet.
  const lerpAngle = CBZ.lerpAngle || function (a, b, t) {
    let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
    if (d < -Math.PI) d += Math.PI * 2;
    return a + d * t;
  };

  // is an actor down / gone? (skip facial work for these — they lie down)
  function downed(a) {
    return !a || a.dead || (a.ko > 0) || a.escaped;
  }

  // ---- per-rig facial state, stashed on the rig itself (._fa) ----
  function ensure(ch) {
    if (ch._fa) return ch._fa;
    const now = CBZ.now || 0;
    const fa = {
      // blink: closed amount 0..1, schedule next blink time
      blink: 0, blinkUntil: 0, nextBlink: now + 600 + Math.random() * 4000,
      blinking: false,
      // eye dart: current + target x/y offset, schedule next dart
      dartX: 0, dartXT: 0, dartY: 0, dartYT: 0, nextDart: now + Math.random() * 2500,
      // mouth: open amount 0..1 + a desynced talk phase
      mouth: 0, talkPh: Math.random() * 6.28,
      // head tracking: yaw/pitch offsets we ADDED last frame, so we can
      // back them out before reading animChar's fresh base.
      addYaw: 0, addPitch: 0, look: 0, // look = 0..1 blend of "glance"
    };
    ch._fa = fa;
    return fa;
  }

  // one actor's eased visual state. `talking`/`lookT` are computed by the
  // caller; we still ease toward existing targets even on frames where we
  // skip the actor, so motion never hitches.
  function updateRig(ch, dt, now, talking, lookT) {
    const face = ch && ch.face;
    if (!face) return;                 // guard for missing rig.face
    const fa = ensure(ch);

    // ---------- BLINK (time-driven; survives skipped frames) ----------
    if (!fa.blinking && now >= fa.nextBlink) {
      fa.blinking = true;
      // most blinks are a single quick close; occasionally a double.
      fa.blinkUntil = now + 90 + Math.random() * 70;
    }
    if (fa.blinking) {
      if (now >= fa.blinkUntil) {
        fa.blinking = false;
        // talkers / agitated actors blink a touch more often
        const base = talking ? 1400 : 2600;
        fa.nextBlink = now + base + Math.random() * (talking ? 2600 : 4500);
        // ~12% chance of an immediate second blink (natural double-blink)
        if (Math.random() < 0.12) fa.nextBlink = now + 120 + Math.random() * 90;
      }
    }
    // ease the lid: snap mostly-closed during a blink, spring open after
    const blinkTarget = fa.blinking ? 1 : 0;
    fa.blink = damp(fa.blink, blinkTarget, fa.blinking ? 34 : 22, dt);
    const eyeSy = 1 - fa.blink * 0.9;  // 1 → ~0.1 closed
    if (face.eyeL) face.eyeL.scale.y = eyeSy;
    if (face.eyeR) face.eyeR.scale.y = eyeSy;

    // ---------- EYE DART (tiny shared x/y offset, eased) ----------
    if (now >= fa.nextDart) {
      // pick a small new resting spot for the pupils
      fa.dartXT = (Math.random() - 0.5) * 0.05;   // ±0.025 local units
      fa.dartYT = (Math.random() - 0.5) * 0.03;
      // looking at the player biases the gaze toward them (forward, so
      // mostly a recentre) and darts settle for longer.
      if (lookT > 0.4) { fa.dartXT *= 0.4; fa.dartYT *= 0.4; }
      fa.nextDart = now + 500 + Math.random() * 2600;
    }
    fa.dartX = damp(fa.dartX, fa.dartXT, 16, dt);
    fa.dartY = damp(fa.dartY, fa.dartYT, 16, dt);
    if (face.eyeL) {
      face.eyeL.position.x = -EYE_X + fa.dartX;
      face.eyeL.position.y = EYE_Y + fa.dartY;
    }
    if (face.eyeR) {
      face.eyeR.position.x = EYE_X + fa.dartX;
      face.eyeR.position.y = EYE_Y + fa.dartY;
    }

    // ---------- MOUTH / TALKING ----------
    let mouthTarget = 0;
    if (talking) {
      // a fast, irregular flap: two sines beat against each other so the
      // jaw never looks metronomic, with a tiny floor so it stays parted.
      fa.talkPh += dt * 13;
      const flap = 0.5 + 0.5 * Math.sin(fa.talkPh) * Math.cos(fa.talkPh * 0.47 + 1.3);
      mouthTarget = 0.25 + Math.max(0, flap) * 0.75; // 0.25 .. 1
    }
    fa.mouth = damp(fa.mouth, mouthTarget, talking ? 24 : 14, dt);
    if (face.mouth) {
      // open = taller + dropped a hair so it reads as a moving jaw
      face.mouth.scale.y = 1 + fa.mouth * 1.8;
      face.mouth.position.y = MOUTH_Y - fa.mouth * 0.05;
    }

    // ---------- HEAD TRACKING (neck yaw/pitch toward player) ----------
    const neck = ch.neck;
    if (neck) {
      // back out last frame's additive contribution so we read the
      // *fresh* base that animChar wrote this frame (prevents feedback
      // through animChar's own damp on rotation.x). On menus animChar
      // doesn't run, but undoing then re-adding our own offset is still
      // exactly neutral, so there is no drift there either.
      neck.rotation.x -= fa.addPitch;
      neck.rotation.y -= fa.addYaw;

      // ease the glance blend toward the requested intensity
      fa.look = damp(fa.look, lookT, 7, dt);

      let yawOff = 0, pitchOff = 0;
      if (fa.look > 0.001 && CBZ.player && CBZ.player.pos && ch.group) {
        const gp = ch.group.position;
        const dx = CBZ.player.pos.x - gp.x;
        const dz = CBZ.player.pos.z - gp.z;
        // desired world yaw to face the player, then express it relative
        // to the actor's body facing (group.rotation.y).
        const facing = ch.group.rotation.y || 0;
        const want = Math.atan2(dx, dz);          // +z forward convention
        let rel = ((want - facing + Math.PI) % (Math.PI * 2)) - Math.PI;
        if (rel < -Math.PI) rel += Math.PI * 2;
        // clamp to a believable neck turn (~34°) and scale by the blend
        const cl = 0.6;
        if (rel > cl) rel = cl; else if (rel < -cl) rel = -cl;
        yawOff = rel * fa.look;
        // a gentle downward/upward tilt toward the player (head at ~y2.2)
        const dy = (CBZ.player.pos.y + 1.4) - (gp.y + 2.2);
        const horiz = Math.sqrt(dx * dx + dz * dz) || 0.001;
        let pitch = Math.atan2(-dy, horiz) * 0.5; // halve it, stays subtle
        if (pitch > 0.22) pitch = 0.22; else if (pitch < -0.22) pitch = -0.22;
        pitchOff = pitch * fa.look;
      }

      // smooth the offsets themselves so a sudden look doesn't snap
      fa.addYaw = lerpAngle(fa.addYaw, yawOff, 1 - Math.exp(-9 * dt));
      fa.addPitch = damp(fa.addPitch, pitchOff, 9, dt);

      neck.rotation.x += fa.addPitch;
      neck.rotation.y += fa.addYaw;
    }
  }

  // ---- decide whether an actor is "talking" right now ----
  function isTalking(a) {
    if (downed(a)) return false;
    // npcs socialising or anyone mid-fight runs their mouth
    if (a.aiState === "socialize" || a.aiState === "fight") return true;
    // guards barking while hunting / alerted (fields may be undefined on
    // some actor kinds — `undefined > 0` is false, so this stays safe)
    if (a.hunt > 0 || a.alert > 0 || a.huntPlayer > 0) return true;
    return false;
  }

  // ---- how strongly should this actor glance at the player (0..1)? ----
  // 0 if downed/out, or the player is behind / too far.
  function lookStrength(a) {
    if (downed(a)) return 0;
    if (!CBZ.player || !CBZ.player.pos || !a.group) return 0;
    const gp = a.group.position;
    const dx = CBZ.player.pos.x - gp.x;
    const dz = CBZ.player.pos.z - gp.z;
    const d2 = dx * dx + dz * dz;
    if (d2 > TRACK_DIST2 || d2 < 0.0004) return 0;
    // must be roughly in front: dot of body-forward with the to-player dir.
    const facing = a.group.rotation.y || 0;
    const fwdX = Math.sin(facing), fwdZ = Math.cos(facing);
    const inv = 1 / Math.sqrt(d2);
    const dot = (dx * inv) * fwdX + (dz * inv) * fwdZ;
    if (dot < 0.15) return 0;          // player is behind / hard to the side
    // closer + more head-on = a stronger glance
    const dist = Math.sqrt(d2);
    const near = 1 - dist / TRACK_DIST;            // 1 at touch → 0 at edge
    return Math.min(1, near * (0.4 + 0.6 * dot));
  }

  // round-robin cursor over the combined actor list (rebuilt cheaply)
  let cursor = 0;

  function tick(dt) {
    const now = CBZ.now || 0;

    // the player rig isn't in guards/npcs and is always on screen, so it
    // gets a full update EVERY frame (it's only one rig — cheap, and the
    // player's own face shouldn't visibly stutter).
    const pc = CBZ.playerChar;
    if (pc && pc.face) {
      // the player "talks" only when throwing hands (a punch is queued)
      const pTalk = pc.punchT > 0;
      // the player never glances at themselves
      updateRig(pc, dt, now, pTalk, 0);
    }

    // every interactable actor across the modes: jail guards/inmates AND city
    // pedestrians, so city folks glance at you too.
    const guards = CBZ.guards || [];
    const npcs = CBZ.npcs || [];
    const peds = CBZ.cityPeds || [];
    const gl = guards.length, nl = npcs.length, pl = peds.length, total = gl + nl + pl;
    if (total === 0) { cursor = 0; return; }
    const at = function (i) { return i < gl ? guards[i] : (i < gl + nl ? npcs[i - gl] : peds[i - gl - nl]); };

    // 1) NEAR pass — anyone you've walked up to glances at you PROMPTLY (every
    //    frame, not on the round-robin), so "they look when I approach" feels
    //    responsive. Still gated to roughly-in-front (lookStrength), so it
    //    reads as a natural glance, never a creepy locked stare.
    const pp = CBZ.player && CBZ.player.pos;
    if (pp) {
      for (let i = 0; i < total; i++) {
        const a = at(i);
        if (!a || !a.char || downed(a)) continue;
        const gp = a.group && a.group.position; if (!gp) continue;
        const dx = gp.x - pp.x, dz = gp.z - pp.z;
        if (dx * dx + dz * dz <= NEAR_GLANCE2) updateRig(a.char, dt, now, isTalking(a), lookStrength(a));
      }
    }

    // 2) ROUND-ROBIN — cheap idle blinks/talk/glance for everyone else.
    const n = Math.min(MAX_PER_FRAME, total);
    if (cursor >= total) cursor = 0;
    for (let k = 0; k < n; k++) {
      let i = cursor + k;
      if (i >= total) i -= total;
      const a = at(i);
      if (!a || !a.char) continue;
      if (downed(a)) continue;
      updateRig(a.char, dt, now, isTalking(a), lookStrength(a));
    }
    cursor += n;
    if (cursor >= total) cursor = 0;
  }

  // run on EVERY frame (faces should live on menus too, where rigs idle),
  // and LATE (88) so animChar has already posed the neck this frame.
  CBZ.onAlways(88, tick);
})();
