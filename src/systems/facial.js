/* ============================================================
   systems/facial.js — EVERY HUMAN FACE ALIVE, AND CHEAP.

   The face itself (sockets, eyeballs, lids, lashes, lips, teeth, the far
   eye line) is built by entities/character.js and posed ONLY through
   CBZ.human.facePose(rig, pose) / CBZ.human.faceLod(rig, near). This file
   decides WHAT the face does:

     • TIER — every rig makeCharacter builds registers here
       (CBZ.faceRegister). Within ~16 m of the camera a face is NEAR (the
       socketed head, real eyes, animated every frame); past ~19 m it drops
       to the FAR tier (light skull, a flat eye line, face at rest) and gets
       NO per-frame work — its tier is re-checked every 4th frame, a
       distance compare, nothing else.
     • BLINKS at human intervals (~every 2.5-6 s; quicker while talking,
       rarer when staring in fear or anger), a fast close and a slower open,
       the occasional double blink, and a blink on a big gaze shift.
     • GAZE — the eyeballs turn to what the person is looking at: the man
       they are fighting, what they are running from, whoever is talking
       near them (over-head speech lines, systems/speech.js), the player when
       he walks up in front of them, else idle glances. Eyes lead, the head
       follows (an additive neck offset, backed out every frame so it never
       feeds animChar's damp), small micro-saccades keep a stare alive, the
       lids follow the eye up and down.
     • EXPRESSION — a mood read off the actor and the rig:
         dead / knocked out   eyes shut, jaw slack
         asleep               eyes shut, mouth closed
         hit / falling        a grimace: eyes squeezed, teeth clenched, brows down
         afraid / fleeing     eyes wide, brows up, lips pulled back, mouth open
         fighting / hunting   a squint, brows down, lips pressed (a snarl when
                              throwing a punch or shouting)
         friendly / chatting  a smile that reaches the eyes
     • MOUTH — shut by default. It opens in time with the words of the
       person's live speech line (vowels open, m/b/p close, pauses on
       punctuation); a socialising pair with no line on screen murmurs in
       bursts.

   CBZ.faceMood(rig, mood, k, ms) lets a system force a mood for a while
   (reactions.js: the terrified stare at gunpoint).

   Runs LATE (88) so animChar has posed the neck this frame. No per-frame
   allocation in the hot loop.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || typeof THREE === "undefined") return;

  const NEAR_IN2 = 16 * 16, NEAR_OUT2 = 19 * 19;   // tier hysteresis (m², camera to body)
  const FAR_EVERY = 4;                              // far rigs: tier check every Nth frame
  const TRACK_DIST = 8;                             // the player is "noticed" inside this
  const SPEAK_RATE = 14;                            // characters per second of a spoken line

  const rigs = [];
  let frame = 0;

  function damp(cur, target, rate, dt) { return cur + (target - cur) * (1 - Math.exp(-rate * dt)); }
  const HU = () => CBZ.human;

  // ---- registry -------------------------------------------------------------
  function register(rig) {
    if (!rig || rig._faceReg || !rig.faceRest || !rig.faceRest.v2) return;
    rig._faceReg = true;
    rig._faceOrphan = 0;
    rigs.push(rig);
  }
  CBZ.faceRegister = register;
  // rigs built before this file loaded, and the actor behind each rig
  function sweepActors() {
    const lists = [CBZ.guards, CBZ.npcs, CBZ.cityPeds, CBZ.cityCops, CBZ.bots];
    for (let l = 0; l < lists.length; l++) {
      const L = lists[l];
      if (!L) continue;
      for (let i = 0; i < L.length; i++) {
        const a = L[i], ch = a && a.char;
        if (!ch || !ch.faceRest) continue;
        if (ch._faceActor !== a) ch._faceActor = a;
        if (!ch._faceReg) register(ch);
      }
    }
    const pc = CBZ.playerChar;
    if (pc && pc.faceRest) { pc._faceActor = CBZ.player || null; pc._facePlayer = true; if (!pc._faceReg) register(pc); }
  }

  CBZ.faceMood = function (rig, mood, k, ms) {
    if (!rig) return false;
    const o = rig._faceOv || (rig._faceOv = { mood: "n", k: 1, until: 0 });
    o.mood = mood; o.k = k == null ? 1 : k; o.until = (CBZ.now || 0) + (ms || 250);
    return true;
  };

  // ---- the mood ---------------------------------------------------------------
  function moodOf(rig, a, now) {
    const ov = rig._faceOv;
    if (ov && now < ov.until) return ov.mood;
    if (a) {
      if (a.dead || a.health === 0) return "dead";
      if (a.ko > 0 || a.knockedOut || a.ragdoll === true || a.unconscious) return "out";
      if (a.asleep || a._propLie || a.sleeping) return "sleep";
    }
    if ((rig.fall && rig.fall.on) || (rig.hitReact && rig.hitReact.on)) return "hurt";
    if (a) {
      if (a.state === "flee" || a.aiState === "flee" || a.state === "surrender" || a.mood === "flee" ||
          a.panic > 0 || a.fear > 4 || a.fleeT > 0 || a.cowering) return "fear";
      if (a.state === "fight" || a.aiState === "fight" || a.aiState === "attack" || a.state === "confront" ||
          a.mood === "hunt" || a.rage || a.hunt > 0 || a.huntPlayer > 0) return "angry";
    }
    if (rig.punchT > 0 || rig.kickT > 0) return "angry";
    if (a && (a.aiState === "socialize" || a.state === "chat" || a.friendly === true)) return "smile";
    return "n";
  }
  // per mood: lidU (+ squint / - wide), lidL (+ raise), closed 0..1, brow key,
  // browY, mouth shape, resting lip gap, blink interval scale, can it look?
  const MOODS = {
    n:     { lidU: 0,     lidL: 0,     closed: 0, brow: "n", browY: 0,      mouth: "n",       open: 0,     blink: 1.0, look: true },
    smile: { lidU: 0.04,  lidL: 0.10,  closed: 0, brow: "n", browY: 0.003,  mouth: "smile",   open: 0,     blink: 1.0, look: true },
    angry: { lidU: 0.17,  lidL: 0.13,  closed: 0, brow: "a", browY: -0.010, mouth: "n",       open: 0,     blink: 1.6, look: true },
    fear:  { lidU: -0.22, lidL: -0.04, closed: 0, brow: "f", browY: 0.013,  mouth: "fear",    open: 0.012, blink: 2.0, look: true },
    hurt:  { lidU: 0.30,  lidL: 0.20,  closed: 0.7, brow: "a", browY: -0.009, mouth: "grimace", open: 0.007, blink: 9, look: false },
    dead:  { lidU: 0,     lidL: 0,     closed: 1, brow: "n", browY: -0.002, mouth: "n",       open: 0.014, blink: 99, look: false },
    out:   { lidU: 0,     lidL: 0,     closed: 1, brow: "n", browY: -0.003, mouth: "n",       open: 0.022, blink: 99, look: false },
    sleep: { lidU: 0,     lidL: 0,     closed: 1, brow: "n", browY: 0,      mouth: "n",       open: 0.003, blink: 99, look: false },
  };

  // ---- where things are ----------------------------------------------------------
  const _m = new THREE.Matrix4(), _v = new THREE.Vector3();
  // a world point for a look target (an actor, a rig, a point), written into out
  function headPoint(x, out) {
    if (!x) return false;
    // the player seen from his own eyes: look into the lens (eye contact)
    if (x === CBZ.player && CBZ.camera && x.pos) {
      const e = CBZ.camera.matrixWorld.elements, dx = e[12] - x.pos.x, dz = e[14] - x.pos.z;
      if (dx * dx + dz * dz < 0.8) { out.set(e[12], e[13], e[14]); return true; }
    }
    const ch = x.char || (x.faceRest ? x : null) || (x === CBZ.player ? CBZ.playerChar : null);
    const h = ch && ch.head;
    if (h && h.matrixWorld) {
      const e = h.matrixWorld.elements;
      if (e[15] === 1 && (e[12] !== 0 || e[13] !== 0 || e[14] !== 0)) { out.set(e[12], e[13], e[14]); return true; }
    }
    const p = (x.group && x.group.position) || x.pos || (x.isVector3 ? x : null);
    if (!p) return false;
    out.set(p.x, (p.y || 0) + 1.6, p.z);
    return true;
  }
  function rigPos(rig) { const e = rig.group.matrixWorld.elements; _v.set(e[12], e[13], e[14]); return _v; }

  // ---- speech ---------------------------------------------------------------------
  // how open the mouth is on the character being spoken right now (0..1), or -1
  // when the line has been said
  function speechOpen(say, now) {
    const t = (now - say.t0) / 1000;
    if (t < 0) return 0;
    const f = t * (say.rate || SPEAK_RATE), i = f | 0, txt = say.text;
    if (i >= txt.length) return -1;
    const k = txt.charCodeAt(i) | 32;
    let v;
    if (k === 97) v = 1;                                   // a
    else if (k === 111) v = 0.85;                          // o
    else if (k === 101) v = 0.7;                           // e
    else if (k === 117 || k === 119) v = 0.5;              // u w
    else if (k === 105 || k === 121) v = 0.55;             // i y
    else if (k === 109 || k === 98 || k === 112) v = 0;    // m b p: lips together
    else if (k === 102 || k === 118) v = 0.12;             // f v
    else if (k >= 97 && k <= 122) v = 0.3;                 // any other consonant
    else if (k === 32) v = 0.08;                           // a breath between words
    else v = 0;                                            // punctuation: a pause
    // shape inside the syllable so it is never a square wave
    return v * (0.75 + 0.25 * Math.sin((f - i) * Math.PI));
  }

  // ---- per-rig state -------------------------------------------------------------
  function stateOf(rig, now) {
    let s = rig._fa;
    if (s && s.v2) return s;
    s = rig._fa = {
      v2: true,
      blinkT: -1, blinkDur: 0.2, nextBlink: now + 500 + Math.random() * 3500,
      lidU: 0, lidL: 0, closed: 0, browY: 0, open: 0,
      yaw: 0, pitch: 0, verge: 0, sYaw: 0, sPitch: 0, nextSacc: now + Math.random() * 1500,
      tgt: new THREE.Vector3(), hasTgt: false, nextPick: 0, look: 0, lastMood: "n",
      idleYaw: 0, idlePitch: 0,
      addYaw: 0, addPitch: 0,
      murmur: Math.random() * 6.28, murOn: false, murT: now + Math.random() * 3000,
      pose: { blink: 0, lidU: 0, lidL: 0, yaw: 0, pitch: 0, verge: 0, open: 0, mouth: "n", brow: "n", browY: 0 },
    };
    return s;
  }

  function isSpeaking(rig, now) { const s = rig._say; return !!(s && now - s.t0 < s.text.length / (s.rate || SPEAK_RATE) * 1000 + 150); }

  // what is this person looking at? writes st.tgt, returns true, or false for "nothing"
  function pickTarget(rig, a, st, mood, now) {
    // the fight / the threat
    if (a && (mood === "angry" || mood === "fear")) {
      const foe = a.rage || a.foe || a.attacker || a.threat || a.mem;
      if (foe && typeof foe === "object" && headPoint(foe, st.tgt)) return true;
      if (a.hunt > 0 || a.huntPlayer > 0 || a.alarmed > 0 || mood === "fear") {
        if (CBZ.player && headPoint(CBZ.player, st.tgt)) return true;
      }
    }
    const me = rigPos(rig), mx = me.x, mz = me.z;
    // a voice nearby: people look at whoever is talking
    const sp = CBZ.speech && CBZ.speech.speakers ? CBZ.speech.speakers() : null;
    if (sp && sp.length) {
      let best = null, bd = 64;
      for (let i = 0; i < sp.length; i++) {
        const x = sp[i];
        if (!x || x === a || x === rig || x.char === rig) continue;
        const p = (x.group && x.group.position) || x.pos;
        if (!p) continue;
        const d = (p.x - mx) * (p.x - mx) + (p.z - mz) * (p.z - mz);
        if (d < bd) { bd = d; best = x; }
      }
      if (best && headPoint(best, st.tgt)) return true;
    }
    // the player, when he is near and in front (or is the one being talked to)
    const P = CBZ.player && CBZ.player.pos;
    if (P && !rig._facePlayer) {
      const dx = P.x - mx, dz = P.z - mz, d2 = dx * dx + dz * dz;
      if (d2 < TRACK_DIST * TRACK_DIST && d2 > 0.01) {
        const e = rig.group.matrixWorld.elements;
        // the body's forward (+z) in world
        const fx = e[8], fz = e[10], fl = Math.sqrt(fx * fx + fz * fz) || 1;
        const dot = (dx * fx + dz * fz) / (fl * Math.sqrt(d2));
        if (dot > 0.1 || isSpeaking(rig, now)) {
          if (headPoint(CBZ.player, st.tgt)) return true;
        }
      }
    }
    return false;
  }

  // the lids follow the head's tone (crowd.js re-skins pooled rigs, gore.js
  // greys the dead, warlord relinearises): a shared cached material per tone
  function syncLidTone(rig) {
    const f = rig.face, h = rig.head, H = HU();
    if (!f || !f.lidUp || !h || !h.material || !h.material.color || !CBZ.cmat || !H.lidTone) return;
    const hex = h.material.color.getHex();
    if (rig._lidFor === hex) return;
    rig._lidFor = hex;
    const m = CBZ.cmat(H.lidTone(hex));
    if (f.lidUp.material !== m) { f.lidUp.material = m; f.lidLow.material = m; }
  }

  function updateRig(rig, dt, now) {
    const H = HU();
    const st = stateOf(rig, now);
    const a = rig._faceActor || null;
    const mood = moodOf(rig, a, now);
    const M = MOODS[mood] || MOODS.n;
    const speaking = isSpeaking(rig, now);
    if (mood !== st.lastMood) { st.lastMood = mood; st.nextPick = 0; }
    if ((frame + (rig._faceIx | 0)) % 30 === 0) syncLidTone(rig);

    // ---- lids: mood + blink ----
    st.lidU = damp(st.lidU, M.lidU, 9, dt);
    st.lidL = damp(st.lidL, M.lidL, 9, dt);
    // dying eyes drift shut; a knockout snaps them; waking opens them slowly
    st.closed = damp(st.closed, M.closed, M.closed > st.closed ? (mood === "dead" ? 2.5 : 9) : 4, dt);
    let blink = 0;
    if (M.blink < 50) {
      if (st.blinkT < 0 && now >= st.nextBlink) { st.blinkT = 0; st.blinkDur = 0.17 + Math.random() * 0.08; }
      if (st.blinkT >= 0) {
        st.blinkT += dt;
        const t = st.blinkT, c = st.blinkDur * 0.38;
        blink = t < c ? t / c : Math.max(0, 1 - (t - c) / (st.blinkDur - c));
        blink = blink * blink * (3 - 2 * blink);
        if (t >= st.blinkDur) {
          st.blinkT = -1;
          const base = (speaking ? 1800 : 2600) * M.blink;
          st.nextBlink = now + base + Math.random() * base * 1.3;
          if (Math.random() < 0.12) st.nextBlink = now + 110 + Math.random() * 90;   // a double blink
        }
      }
    }

    // ---- gaze ----
    if (M.look) {
      if (now >= st.nextPick) {
        const had = st.hasTgt;
        st.hasTgt = pickTarget(rig, a, st, mood, now);
        st.nextPick = now + (mood === "fear" ? 180 : 300) + Math.random() * 500;
        if (!st.hasTgt && (had || Math.random() < 0.3)) {
          st.idleYaw = (Math.random() - 0.5) * 0.7;
          st.idlePitch = (Math.random() - 0.6) * 0.25;
          st.nextPick = now + 900 + Math.random() * 2400;
        }
      }
    } else st.hasTgt = false;
    let wantYaw = st.hasTgt ? 0 : (M.look ? st.idleYaw : 0), wantPitch = st.hasTgt ? 0 : (M.look ? st.idlePitch : 0), wantVerge = 0.012;
    const near = rig.faceNodes.near;
    if (st.hasTgt && near.matrixWorld) {
      _m.copy(near.matrixWorld).invert();
      _v.copy(st.tgt).applyMatrix4(_m);
      const R = rig.faceRest;
      const dx = _v.x, dy = _v.y - R.eyeY, dz = _v.z - R.eyeZ;
      const hz = Math.sqrt(dx * dx + dz * dz) || 1e-4;
      if (dz > 0.05) {
        wantYaw = Math.atan2(dx, dz);
        wantPitch = Math.atan2(dy, hz);
        wantVerge = Math.min(0.12, Math.atan2(R.eyeX, Math.sqrt(dx * dx + dy * dy + dz * dz)));
      } else st.hasTgt = false;                             // it went behind him
    }
    // micro-saccades: a live stare is never perfectly still
    if (now >= st.nextSacc) {
      const k = mood === "fear" ? 2.2 : 1;
      st.sYaw = (Math.random() - 0.5) * 0.07 * k; st.sPitch = (Math.random() - 0.5) * 0.045 * k;
      st.nextSacc = now + (mood === "fear" ? 250 : 600) + Math.random() * 1900;
    }
    const ty = wantYaw + st.sYaw, tp = wantPitch + st.sPitch;
    // a big jump of the eyes often carries a blink with it
    if (Math.abs(ty - st.yaw) > 0.3 && st.blinkT < 0 && Math.random() < 0.35 && M.blink < 50) st.nextBlink = now;
    st.yaw = damp(st.yaw, Math.max(-0.5, Math.min(0.5, ty)), 26, dt);
    st.pitch = damp(st.pitch, Math.max(-0.34, Math.min(0.34, tp)), 26, dt);
    st.verge = damp(st.verge, wantVerge, 8, dt);

    // ---- mouth ----
    let open = M.open;
    let shape = M.mouth;
    if (speaking && mood !== "dead" && mood !== "out" && mood !== "sleep") {
      const so = speechOpen(rig._say, now);
      if (so >= 0) {
        open = so > 0.02 ? Math.max(open * 0.5, 0.003 + so * (rig._say.loud ? 0.036 : 0.027)) : 0;
        if (mood === "angry") shape = so > 0.4 && rig._say.loud ? "snarl" : "n";
      }
    } else if (a && (a.aiState === "socialize" || a.state === "chat") && mood === "smile") {
      // a pair talking with no line on screen: murmur in bursts
      if (now >= st.murT) { st.murOn = !st.murOn; st.murT = now + (st.murOn ? 900 + Math.random() * 1800 : 1200 + Math.random() * 2600); }
      if (st.murOn) {
        st.murmur += dt * 11;
        open = 0.003 + 0.016 * Math.max(0, Math.sin(st.murmur) * Math.cos(st.murmur * 0.43 + 1.1));
        shape = "n";
      }
    }
    if (mood === "angry" && (rig.punchT > 0 || rig.kickT > 0)) { shape = "snarl"; open = Math.max(open, 0.006); }
    st.open = damp(st.open, open, speaking ? 45 : 12, dt);
    st.browY = damp(st.browY, M.browY + (speaking ? 0.002 * Math.sin(now * 0.004) : 0), 8, dt);

    const p = st.pose;
    p.blink = Math.max(st.closed, blink);
    p.lidU = st.lidU; p.lidL = st.lidL;
    p.yaw = st.yaw; p.pitch = st.pitch; p.verge = st.verge;
    p.open = st.open < 0.002 ? 0 : st.open;
    p.mouth = shape; p.brow = M.brow; p.browY = st.browY;
    H.facePose(rig, p);

    // ---- the head follows the eyes (additive neck offset, never the player's own) ----
    const neck = rig.neck;
    if (neck && !rig._facePlayer) {
      neck.rotation.x -= st.addPitch;
      neck.rotation.y -= st.addYaw;
      st.look = damp(st.look, st.hasTgt ? 1 : 0, 5, dt);
      let yawOff = 0, pitchOff = 0;
      if (st.look > 0.002 && neck.parent && neck.parent.matrixWorld) {
        _m.copy(neck.parent.matrixWorld).invert();
        _v.copy(st.tgt).applyMatrix4(_m);
        const dx = _v.x - neck.position.x, dz = _v.z - neck.position.z;
        const dy = _v.y - (neck.position.y + (rig.profile ? rig.profile.headSize * 0.55 : 0.33));
        const hz = Math.sqrt(dx * dx + dz * dz) || 1e-4;
        if (dz > -0.2) {
          yawOff = Math.max(-0.6, Math.min(0.6, Math.atan2(dx, dz) * 0.7)) * st.look;
          pitchOff = Math.max(-0.24, Math.min(0.24, -Math.atan2(dy, hz) * 0.55)) * st.look;
        }
      }
      st.addYaw = damp(st.addYaw, yawOff, 6, dt);
      st.addPitch = damp(st.addPitch, pitchOff, 6, dt);
      neck.rotation.x += st.addPitch;
      neck.rotation.y += st.addYaw;
    }
  }

  // leaving the near tier: hand the neck back clean
  function releaseNeck(rig) {
    const st = rig._fa;
    if (!st || !st.v2 || !rig.neck) return;
    rig.neck.rotation.x -= st.addPitch; rig.neck.rotation.y -= st.addYaw;
    st.addPitch = 0; st.addYaw = 0; st.look = 0;
  }

  function tick(dt) {
    const H = HU();
    if (!H || !H.facePose) return;
    frame++;
    if (frame % 30 === 1) sweepActors();
    const now = CBZ.now || 0;
    const cam = CBZ.camera;
    const ce = cam && cam.matrixWorld ? cam.matrixWorld.elements : null;
    const cx = ce ? ce[12] : 0, cy = ce ? ce[13] : 0, cz = ce ? ce[14] : 0;
    const prune = frame % 240 === 0;
    for (let i = rigs.length - 1; i >= 0; i--) {
      const rig = rigs[i], g = rig.group, R = rig.faceRest;
      if (!g || !g.parent) {
        // off the scene: forget it after a while, and leave it whole (near,
        // at rest) in case it comes back unregistered
        if (prune && ++rig._faceOrphan >= 2) {
          releaseNeck(rig); H.faceLod(rig, true); H.facePose(rig, H.faceRestPose);
          rig._faceReg = false; rig._fa = null;
          rigs[i] = rigs[rigs.length - 1]; rigs.pop();
        }
        continue;
      }
      rig._faceOrphan = 0;
      rig._faceIx = i;
      const isNear = R.near;
      if (!isNear && (i + frame) % FAR_EVERY) continue;     // far: nothing, most frames
      if (!g.visible) continue;
      let wantNear = true;
      if (ce) {
        const e = g.matrixWorld.elements;
        const dx = e[12] - cx, dy = e[13] - cy, dz = e[14] - cz, d2 = dx * dx + dy * dy + dz * dz;
        wantNear = isNear ? d2 < NEAR_OUT2 : d2 < NEAR_IN2;
      }
      if (wantNear !== isNear) {
        if (!wantNear) releaseNeck(rig);
        H.faceLod(rig, wantNear);
      }
      if (wantNear) updateRig(rig, Math.min(dt, 0.1), now);
    }
  }

  CBZ.faceAudit = function () {
    let near = 0, far = 0;
    for (let i = 0; i < rigs.length; i++) (rigs[i].faceRest.near ? near++ : far++);
    return { rigs: rigs.length, near: near, far: far };
  };

  // every frame (faces live on menus too), LATE (88): after animChar posed the neck
  if (typeof CBZ.onAlways === "function") CBZ.onAlways(88, tick);
})();
