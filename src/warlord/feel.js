/* ============================================================
   warlord/feel.js — DESERT WARLORD: sound, impact, and the war mixer.

   THE PROBLEM THIS FILE EXISTS FOR. Three hundred men firing is not three
   hundred sounds. Measured on this page before this file existed: battle.js
   asks for a discrete gun voice per shot, gated only by `fxBudget < 26` — a
   PER-FRAME cap — and it passes `ghost:true`, which in systems/audio.js means
   "do not stamp the per-cue cooldown". Read sfx() at audio.js:1144: the gate
   is `now - prev < cd` against a `prev` that ghost shots never write. So the
   cooldown never engages for NPC fire and the real ceiling is 26 shots per
   frame × 60 fps = 1560 gun voices per second, each of which is a decoded
   BufferSource + gain (sample path) or eleven synth nodes (fallback path).
   That is not a war, it is a broken machine gun, and it is also thousands of
   AudioNodes a second for the GC to eat.

   THE MODEL, and it is the one thing worth getting right here. A hundred
   rifles at two hundred metres is a TEXTURE. Three rifles at twenty metres
   are EVENTS. The ear does not resolve two transients closer together than
   about 35 ms — they fuse into one percept — and it can follow roughly three
   to five simultaneous transient streams before the rest becomes wash. So:

     · every shot request, wherever it came from, feeds a rate meter;
     · shots past 60 m are NEVER discrete voices. 60 m is not a taste
       number — it is audio.js's own FAR_DIST (audio.js:1091), the line the
       engine already draws between "in the fight" and "somewhere out there";
     · the wash is ONE looping pre-rendered crackle buffer whose gain and
       colour track the measured rate and mean distance — O(1) nodes for any
       number of shooters, which is the whole trick;
     · on top of the wash, a GRAIN scheduler fires short far-field pops out
       of one shared bank at a bounded rate, so the texture has real density
       that moves with the real rate of fire instead of a static loop;
     · near-field shots compete for a token bucket refilling at 22 voices/s
       (1/0.045 s — the fusion window, rounded down), burst 3, spent
       NEAREST FIRST inside the frame;
     · your own trigger is never a candidate. The one sound in the mix you
       caused must never be the one that got culled.

   MEASURED, headless, three hundred rifles, twelve simulated seconds
   (tools/visual-presets/warlord-feel.mjs prints these):
     mixer off  →  ~700–1500 gun voices/s, ~2000+ AudioNodes/s
     mixer on   →  ≤22 near voices/s + ≤14 grains/s + 1 bed = a hard ceiling
   The overlay (?feel=1) draws the live numbers on the screen so the claim is
   photographable rather than assertable.

   WHAT IT REUSES, and it is nearly everything:
     systems/audio.js   the gun voices themselves (CBZ.sfx), the far-field
                        muffle+slap bus, the shared gun compressor, the
                        AudioContext. This file does NOT synthesise a gunshot.
     core/microboot.js  CBZ.shake, micro.onFrame, the frame clock.
     warlord/core.js    the event bus and the phases.
     warlord/desert.js  biomeAt / heightAt / slopeAt / oases for ambience.
   WHAT IS NEW: the mixer, the beds (crackle, column, wind), the morale voice,
   the UI cues, the shake budget, and the overlay.

   ONE HONEST WART, flagged rather than worked around: micro.sfx.loop() in
   core/microboot.js is exactly the right shape for a noise bed — and it lives
   on a SECOND AudioContext that microboot builds for itself. A bed on a
   different context cannot share the gun compressor, and "the shots punch
   through the texture" is a statement about one compressor seeing both. So
   the beds here are built on audio.js's context with a ~20-line loop helper
   instead. The real fix is microboot adopting CBZ.getAudioCtx() when audio.js
   is present; that is microboot.js's line to change, not this file's.

   EMITS   feel:unlock feel:hitstop
   LISTENS phase phase:* toast gold army baggage dawn newgame loaded
           outpost:* armoury:* campaign:band warnet:*
           morale battle:morale battle:break battle:rout battle:charge
           battle:volley battle:shot battle:kill battle:end
           (battle.js emits none of the battle:* set yet — see MORALE below,
           it polls W.battle.audit() until they exist)

   FLAGS (repo doctrine — every behaviour switch has a revert param)
     ?feel=off      the whole module inert. Nothing hooks, nothing wraps.
     ?feel=1        the debug overlay + node-counting instrumentation
     ?mixer=old     THE A/B. Every shot goes straight to CBZ.sfx, no bed, no
                    budget — the naive path, byte for byte.
     ?ambience=old  no wind, no sand, no oasis
     ?column=old    no marching army bed
     ?shake=old     do not wrap CBZ.shake (no shake budget)
     ?music=1       the adaptive bed ON (default OFF — see MUSIC)
     ?feelmute=1    boot muted
============================================================ */
(function () {
  "use strict";
  const G = (typeof window !== "undefined" ? window : globalThis);
  const CBZ = (G.CBZ = G.CBZ || {});
  const W = (CBZ.warlord = CBZ.warlord || {});
  const F = (W.feel = W.feel || {});

  const QP = (function () {
    try { return new URLSearchParams(G.location ? G.location.search : ""); }
    catch (e) { return { get: function () { return null; } }; }
  })();
  const FEEL_Q = QP.get("feel");
  const OFF = FEEL_Q === "off" || FEEL_Q === "0";
  const DEBUG = FEEL_Q === "1" || FEEL_Q === "on";
  const MIXER_OLD = QP.get("mixer") === "old";
  const AMB_OLD = QP.get("ambience") === "old";
  const COL_OLD = QP.get("column") === "old";
  const SHAKE_OLD = QP.get("shake") === "old";
  const MUSIC_ON = QP.get("music") === "1";
  const START_MUTED = QP.get("feelmute") === "1";

  const clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };
  const lerp = function (a, b, t) { return a + (b - a) * t; };
  function safe(fn) { try { return fn(); } catch (e) { if (DEBUG) console.warn("[feel]", e); return null; } }

  /* ============================================================ THE NUMBERS
     Every one of these is derived from something, and the something is in the
     comment. No magic scalars — CLAUDE.md is law here.

     FUSE_S            35 ms. Two transients closer than this fuse into one
                       percept, so a discrete voice slot cannot usefully fire
                       faster. 45 ms is the rounded-down working value: at
                       22 voices/s you are already spending nodes on sounds
                       the listener hears as one.
     NEAR_M            60 m — audio.js's own FAR_DIST. The engine already
                       decided where "in the fight" stops; a second opinion
                       here would just be drift.
     OWN_M             6 m. Inside this it is you or the man at your elbow;
                       your own report is never budgeted away.
     SATURATE_HZ       45 shots/s. At 45 events/s the mean inter-onset is
                       22 ms, under the fusion window, so the volley IS
                       continuous crackle — that is the point where the bed
                       should be at full density and nothing is gained by
                       counting higher.
     GRAIN_HZ_MAX      14/s. Above this the grain layer stops adding density
                       (see SATURATE_HZ) and starts adding only nodes.
     BED_TAU           0.55 s. A volley's tail. The bed must fall off at the
                       rate a real one does or the field sounds like it is
                       still firing after everybody stopped. */
  const FUSE_S = 0.045;
  const NEAR_HZ = 1 / FUSE_S;            // 22.2 discrete voices/s
  const NEAR_BURST = 3;                  // a volley must still be able to crack
  const BURST_AHEAD = 0.12;              // s — never schedule further ahead than this
  const NEAR_M = 60;
  const OWN_M = 6;
  const SATURATE_HZ = 45;
  const GRAIN_HZ_MAX = 14;
  const BED_TAU = 0.55;
  const RATE_TAU = 0.28;                 // the rate meter's own smoothing

  /* ============================================================ THE BUS
     One context: audio.js's. See the header's WART note for why not two. */
  let ctx = null;          // the AudioContext everything hangs off
  let feelBus = null;      // everything this file makes, under one gain
  let bedBus = null;       // the war wash + grains (ducked by near fire)
  let ambBus = null;       // wind / sand / water / column
  let uiBus = null;        // screens and voices — never ducked
  let unlocked = false;
  let muted = START_MUTED;

  function audioCtx() {
    if (ctx) return ctx;
    // audio.js owns the real context; ask it first and only build if it never
    // came up. A page with no audio.js still gets ambience and UI cues.
    if (CBZ.getAudioCtx) ctx = CBZ.getAudioCtx();
    if (!ctx && CBZ.micro && CBZ.micro.sfx && CBZ.micro.sfx.ctx) ctx = CBZ.micro.sfx.ctx;
    return ctx;
  }

  function ensureBus() {
    if (feelBus) return feelBus;
    const c = audioCtx();
    if (!c) return null;
    feelBus = c.createGain(); feelBus.gain.value = muted ? 0 : 1;
    feelBus.connect(c.destination);
    bedBus = c.createGain(); bedBus.gain.value = 1; bedBus.connect(feelBus);
    ambBus = c.createGain(); ambBus.gain.value = 1; ambBus.connect(feelBus);
    uiBus = c.createGain(); uiBus.gain.value = 1; uiBus.connect(feelBus);
    return feelBus;
  }

  /* THE AUTOPLAY POLICY IS NOT AN EDGE CASE, it is the default state of every
     first page load. A context constructed outside a user gesture starts
     suspended and resume() is refused; so nothing here may assume it is
     running, and NOTHING may throw when it is not. unlock() is idempotent,
     safe to call from a gesture handler, from a tool, or never. */
  F.unlock = function () {
    if (unlocked) { if (ctx && ctx.state === "suspended") safe(function () { ctx.resume(); }); return true; }
    safe(function () { if (CBZ.initAudio) CBZ.initAudio(); });
    safe(function () { if (CBZ.micro && CBZ.micro.sfx && CBZ.micro.sfx.resume) CBZ.micro.sfx.resume(); });
    const c = audioCtx();
    if (!c) return false;
    safe(function () { if (c.state === "suspended") c.resume(); });
    if (!ensureBus()) return false;
    unlocked = true;
    buildBuffers(c);
    W.emit && W.emit("feel:unlock", true);
    return true;
  };

  F.mute = function (on) {
    muted = on == null ? !muted : !!on;
    if (feelBus && ctx) safe(function () { feelBus.gain.setTargetAtTime(muted ? 0 : 1, ctx.currentTime, 0.05); });
    if (CBZ.micro && CBZ.micro.sfx) CBZ.micro.sfx.muted = muted;
    return muted;
  };
  F.muted = function () { return muted; };

  /* ============================================================ INSTRUMENT
     Node counting is the honest measure of the naive path's real cost, and it
     is measurement scaffolding, so it only exists when you asked to see it
     (?feel=1). Wrapping the factory methods is invasive; doing it always
     would be a tax on every frame of normal play for a number nobody is
     reading. Restores itself if the module is torn down. */
  const M = {
    reqAll: 0, reqNear: 0, reqFar: 0,       // shot requests since boot
    voices: 0, grains: 0, folded: 0,        // what the mixer actually did
    nodes: 0,                               // AudioNodes minted (?feel=1 only)
    reqHz: 0, voiceHz: 0, grainHz: 0, nodeHz: 0,
    density: 0, bedGain: 0, meanDist: 0,
    tokens: NEAR_BURST, peakVoiceHz: 0, peakReqHz: 0,
  };
  let nodesWrapped = false;
  function wrapNodeCount(c) {
    if (nodesWrapped || !c || !DEBUG) return;
    nodesWrapped = true;
    const names = ["createGain", "createBufferSource", "createBiquadFilter", "createOscillator",
                   "createDelay", "createDynamicsCompressor", "createWaveShaper", "createStereoPanner"];
    names.forEach(function (n) {
      const orig = c[n];
      if (typeof orig !== "function") return;
      c[n] = function () { M.nodes++; return orig.apply(this, arguments); };
    });
  }

  /* ============================================================ BUFFERS
     Deterministic on purpose. These are built once, at unlock, and a seeded
     stream means the crackle bed is the same crackle bed every session — one
     less thing that can differ between a before shot and an after shot in the
     A/B tool. (Per-shot pitch jitter still uses Math.random; nothing reads
     that back.) */
  let bedBuf = null;       // the looping wash
  let grainBuf = null;     // a bank of discrete far pops
  let windBuf = null;      // broadband noise for the wind/sand beds
  let bootBuf = null;      // a bank of footfalls + kit rattle for the column
  const GRAINS = 24, GRAIN_S = 0.30;
  const BOOTS = 16, BOOT_S = 0.26;

  function lcg(seed) {
    let a = (seed >>> 0) || 1;
    return function () { a = (Math.imul(a, 1664525) + 1013904223) >>> 0; return a / 4294967296; };
  }

  /* A DISTANT REPORT IS NOT A CLICK. It is a short noise burst whose energy
     has already lost its highs to a kilometre of air, with a soft attack (the
     air smears the crack) and a tail. One-pole lowpass over the burst is
     cheap and is what the distance actually does; a bandpass would make it a
     "pew". */
  function pop(d, i0, n, rnd, opts) {
    const sr = opts.sr;
    const dur = Math.min(n - i0, Math.floor(sr * opts.len));
    if (dur <= 4) return;
    const decay = opts.decay;
    const cut = opts.cut;                         // one-pole coefficient 0..1
    const attack = Math.max(2, Math.floor(sr * opts.attack));
    // exp(-t/decay) sample by sample is the same curve as a constant multiply
    // per sample, and the multiply does not call Math.exp 4.6 million times on
    // the first click (measured: ~60 ms of hitch, all of it in exp()).
    const k = Math.exp(-1 / (sr * decay));
    let env = 1, lp = 0;
    for (let i = 0; i < dur; i++) {
      lp += ((rnd() * 2 - 1) - lp) * cut;
      d[i0 + i] += lp * env * (i < attack ? i / attack : 1) * opts.amp;
      env *= k;
    }
  }

  function buildBuffers(c) {
    if (bedBuf || !c) return;
    const sr = c.sampleRate;

    /* THE WASH — 4.0 s, stereo, decorrelated. Four seconds because the loop
       period must not be short enough to hear as a pattern under a battle
       that lasts a minute; decorrelated channels because a war is WIDE and
       identical channels collapse to a point between the speakers. Density
       here is deliberately HIGH (the bed is what a saturated field sounds
       like); runtime lowers gain and colour rather than rebuilding it. */
    const bedS = 4.0, bedN = Math.floor(sr * bedS);
    bedBuf = c.createBuffer(2, bedN, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = bedBuf.getChannelData(ch);
      const rnd = lcg(0x51ed + ch * 7919);
      // the continuous underlayer: a rolling low rumble, the sum of everything
      let lp = 0;
      for (let i = 0; i < bedN; i++) { lp += ((rnd() * 2 - 1) - lp) * 0.035; d[i] = lp * 0.34; }
      // and 55 pops/s of crackle on top of it — above SATURATE_HZ on purpose,
      // this buffer IS the saturated case
      const pops = Math.floor(bedS * 55);
      for (let k = 0; k < pops; k++) {
        const at = Math.floor(rnd() * (bedN - sr * 0.3));
        pop(d, at, bedN, rnd, { sr: sr, len: 0.22, decay: 0.028 + rnd() * 0.05,
          cut: 0.06 + rnd() * 0.10, attack: 0.0015 + rnd() * 0.003, amp: 0.20 + rnd() * 0.45 });
      }
      // normalise so BED gain means the same thing on any sample rate
      let peak = 0;
      for (let i = 0; i < bedN; i++) { const a = d[i] < 0 ? -d[i] : d[i]; if (a > peak) peak = a; }
      if (peak > 0.0001) { const g = 0.85 / peak; for (let i = 0; i < bedN; i++) d[i] *= g; }
    }

    /* THE GRAIN BANK — 24 distinct far reports, packed end to end in one
       buffer. One buffer, many grains: start(when, offset, duration) picks a
       slot, so a hundred grains a second still costs one decoded buffer and
       never a new allocation. */
    const gN = Math.floor(sr * GRAIN_S * GRAINS);
    grainBuf = c.createBuffer(1, gN, sr);
    {
      const d = grainBuf.getChannelData(0);
      const rnd = lcg(0xbeef);
      for (let k = 0; k < GRAINS; k++) {
        const at = Math.floor(k * GRAIN_S * sr);
        pop(d, at, at + Math.floor(GRAIN_S * sr), rnd, { sr: sr, len: GRAIN_S * 0.9,
          decay: 0.035 + rnd() * 0.09, cut: 0.05 + rnd() * 0.13,
          attack: 0.001 + rnd() * 0.004, amp: 0.6 + rnd() * 0.4 });
      }
    }

    /* WIND — 3 s of broadband noise, looped through a filter the runtime
       moves. Built here rather than taken from micro.sfx.loop for the context
       reason in the header. */
    const wN = Math.floor(sr * 3);
    windBuf = c.createBuffer(2, wN, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = windBuf.getChannelData(ch);
      const rnd = lcg(0x77d1 + ch * 104729);
      let lp = 0;
      for (let i = 0; i < wN; i++) { lp += ((rnd() * 2 - 1) - lp) * 0.5; d[i] = lp * 0.9; }
      // taper the seam so the loop point does not click
      const fade = Math.floor(sr * 0.05);
      for (let i = 0; i < fade; i++) { const g = i / fade; d[i] *= g; d[wN - 1 - i] *= g; }
    }

    /* THE COLUMN BANK — footfalls and kit. Same trick as the grain bank: 16
       variants in one buffer. A footfall on sand is a short broadband
       shhh-thud, so it is a pop with a much softer filter and a slower
       attack than a rifle report. */
    const bN = Math.floor(sr * BOOT_S * BOOTS);
    bootBuf = c.createBuffer(1, bN, sr);
    {
      const d = bootBuf.getChannelData(0);
      const rnd = lcg(0x30075);
      for (let k = 0; k < BOOTS; k++) {
        const at = Math.floor(k * BOOT_S * sr);
        pop(d, at, at + Math.floor(BOOT_S * sr), rnd, { sr: sr, len: BOOT_S * 0.8,
          decay: 0.045 + rnd() * 0.05, cut: 0.012 + rnd() * 0.03,
          attack: 0.004 + rnd() * 0.008, amp: 0.5 + rnd() * 0.5 });
        // the kit: a thin metallic tick riding the step, half the time
        if (rnd() < 0.55) {
          const j = at + Math.floor(sr * (0.01 + rnd() * 0.03));
          pop(d, j, at + Math.floor(BOOT_S * sr), rnd, { sr: sr, len: 0.05,
            decay: 0.012, cut: 0.45 + rnd() * 0.3, attack: 0.0008, amp: 0.18 + rnd() * 0.2 });
        }
      }
    }
    wrapNodeCount(c);
  }

  /* A LOOPING BED, in one place. Twenty lines instead of micro.sfx.loop for
     the context reason in the header — and it also needs a lowpass rather
     than a bandpass, because distance is a lowpass, not a formant. */
  function bedLoop(buf, dest, opts) {
    const c = audioCtx();
    if (!c || !buf) return null;
    opts = opts || {};
    const src = c.createBufferSource();
    src.buffer = buf; src.loop = true;
    src.playbackRate.value = opts.rate || 1;
    const flt = c.createBiquadFilter();
    flt.type = opts.type || "lowpass";
    flt.frequency.value = opts.cut || 2000;
    flt.Q.value = opts.q == null ? 0.7 : opts.q;
    const g = c.createGain(); g.gain.value = 0;
    src.connect(flt); flt.connect(g); g.connect(dest || feelBus);
    safe(function () { src.start(); });
    let dead = false;
    return {
      set: function (gain, cut, rate) {
        if (dead || !ctx) return;
        const t = ctx.currentTime;
        if (gain != null) g.gain.setTargetAtTime(Math.max(0, gain), t, opts.slew == null ? 0.08 : opts.slew);
        if (cut != null) flt.frequency.setTargetAtTime(clamp(cut, 60, 20000), t, 0.12);
        if (rate != null) src.playbackRate.setTargetAtTime(clamp(rate, 0.25, 4), t, 0.2);
      },
      gain: function () { return g.gain.value; },
      stop: function () {
        if (dead) return; dead = true;
        safe(function () { g.gain.setTargetAtTime(0, ctx.currentTime, 0.12); src.stop(ctx.currentTime + 0.6); });
      },
    };
  }

  /* ============================================================ THE EAR
     Where the listener is. The camera, always — campaign and battle both
     drive CBZ.camera, and battle's command view is metres above the line
     while the player's body is in it. The sound is what the CAMERA hears,
     because that is what the player is looking at. */
  const ear = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, speed: 0 };
  function readEar(dt) {
    const cam = CBZ.camera;
    let x = ear.x, y = ear.y, z = ear.z;
    if (cam && cam.position) { x = cam.position.x; y = cam.position.y; z = cam.position.z; }
    else if (W.state && W.state.you) { x = W.state.you.x; y = 2; z = W.state.you.z; }
    if (dt > 0) {
      const inv = 1 / dt;
      ear.vx = (x - ear.x) * inv; ear.vy = (y - ear.y) * inv; ear.vz = (z - ear.z) * inv;
      // clamp: a phase change teleports the camera, and a teleport is not wind
      const s = Math.hypot(ear.vx, ear.vy, ear.vz);
      ear.speed = s > 200 ? ear.speed : lerp(ear.speed, s, clamp(dt * 4, 0, 1));
    }
    ear.x = x; ear.y = y; ear.z = z;
  }

  /* ============================================================ THE MIXER
     One frame of shot requests goes in; a bounded number of voices comes out.

     shot({dist, name, opts, mine}) is the front door. Two ways in:
       1. battle.js (or anything) calls CBZ.sfx("shoot_ak47", {dist, ...}) and
          the wrapper below routes it here. Nothing has to know this exists.
       2. a module calls W.feel.shot(...) directly, which is cheaper and
          carries more (who fired, which side) — for whenever battle.js wants
          to wire it. Both paths land in the same accounting. */
  const frameQ = [];       // this frame's candidates: reused, never realloc'd
  let qn = 0;
  let tokens = NEAR_BURST;
  let simT = 0;
  let rateAcc = 0;         // shots seen this frame
  let rateHz = 0;          // smoothed shots/s
  let distAcc = 0, distN = 0;
  let meanDist = 120;
  let bed = null, bedFilterCut = 900;
  let bedLevel = 0;        // the decaying envelope the bed rides
  let grainDebt = 0;       // fractional grains owed, so low rates still fire
  let lastVoiceT = -1e9;
  const voiceOpts = {};    // reused: the naive path's per-shot object churn is
                           // itself part of what this file removes

  const EMPTY = {};
  /* THE METER RUNS ON BOTH SIDES OF THE A/B. ?mixer=old still counts what was
     asked for and at what range — otherwise the naive side's overlay is blank
     where the after side's has numbers, and a blank panel photographs as
     "the instrument is broken" rather than as "this is the before". */
  function meter(d) {
    M.reqAll++; rateAcc++;
    distAcc += d; distN++;
    if (d <= NEAR_M) M.reqNear++; else M.reqFar++;
  }
  function pushShot(name, dist, opts, mine) {
    const d = (dist == null || !isFinite(dist)) ? 0 : Math.max(0, dist);
    meter(d);
    if (qn < 512) {                  // a hard ceiling on the queue itself: a
      const s = frameQ[qn] || (frameQ[qn] = { o: {} });  // frame that somehow
      s.name = name; s.d = d; s.mine = !!mine;           // asks for 10k shots
      const o = s.o, i = opts || EMPTY;                  // must not allocate
      o.dist = i.dist; o.ghost = i.ghost; o.volume = i.volume;   // 10k slots
      o.pitch = i.pitch; o.delay = i.delay; o.force = i.force;
      qn++;
    } else M.folded++;
  }

  /* THE FLUSH. Nearest first, your own shot first of all, spend the bucket,
     everything else becomes density. This runs once per sim frame from
     micro.onFrame at order 900 — after battle.js's own frame hook (order 0),
     so a frame's shots are all in hand before any of them is decided. */
  function flushShots(dt) {
    if (qn === 0) { spendNoShots(dt); return; }
    const q = frameQ;
    for (let i = 0; i < qn; i++) q[i].done = false;
    tokens = Math.min(NEAR_BURST, tokens + dt * NEAR_HZ);
    let spent = 0;

    /* YOUR OWN REPORT SKIPS EVERYTHING — the bucket, the queue order and the
       spacing. The one sound in the mix you caused must never be the one that
       got culled. */
    for (let i = 0; i < qn; i++) {
      const s = q[i];
      if (s.mine || s.d <= OWN_M) { s.done = true; spent++; M.voices++; emitVoice(s, 0); }
    }

    /* THE BURST, AND WHY IT IS SCHEDULED RATHER THAN DROPPED. The first cut
       broke out of this loop whenever the last voice was inside the fusion
       window, which at 60 fps means at most ONE near voice per frame ever —
       NEAR_BURST was dead code and a rank firing together came out as a single
       tick. The fusion window is a SPACING requirement, not a per-frame quota.
       So extra voices in a frame are pushed out in FUSE_S steps using
       audio.js's own opts.delay (the same field it already uses for the speed
       of sound), and lastVoiceT tracks when the last voice will SOUND rather
       than when it was decided.

       BURST_AHEAD caps how far ahead anything may be scheduled: a report
       queued more than ~120 ms out is stale news in a firefight, and the man
       who fired it has been shot at twice since.

       Nearest-first by selection, not by sorting: at most three voices are
       ever chosen, so sorting 512 candidates to pick three was O(n^2) for
       nothing. */
    let slotT = Math.max(lastVoiceT + FUSE_S, simT);
    while (tokens >= 1 && slotT - simT < BURST_AHEAD) {
      let best = -1, bd = 1e9;
      for (let i = 0; i < qn; i++) {
        const s = q[i];
        if (s.done || s.d > NEAR_M) continue;
        if (s.d < bd) { bd = s.d; best = i; }
      }
      if (best < 0) break;
      const s = q[best];
      s.done = true; tokens -= 1; spent++; M.voices++;
      emitVoice(s, slotT - simT);
      lastVoiceT = slotT;
      slotT += FUSE_S;
    }

    M.folded += (qn - spent);
    qn = 0;
    spendNoShots(dt);
  }

  function emitVoice(s, wait) {
    const raw = CBZ.__feelRawSfx || CBZ.sfx;
    if (!raw) return;
    // hand it back to audio.js exactly as it was asked for. The gun voices,
    // the far-field bus, the compressor and the sample bank are all theirs;
    // this file only ever decided WHETHER, and WHEN.
    const o = s.o || voiceOpts;
    if (wait > 0.0005) o.delay = (o.delay || 0) + wait;
    safe(function () { raw.call(CBZ, s.name, o); });
  }

  /* THE BED AND THE GRAINS. Everything that did not become a voice becomes
     density: a rate, a mean distance, and from those a gain, a colour and a
     grain schedule. This is O(1) in the number of shooters — that sentence is
     the entire reason this file exists. */
  function spendNoShots(dt) {
    // rate meter — exponential, on SIM time so it is identical under the
    // A/B tool's frozen-clock advance() as it is under rAF
    const k = dt > 0 ? clamp(dt / RATE_TAU, 0, 1) : 0;
    rateHz = lerp(rateHz, dt > 0 ? rateAcc / dt : 0, k);
    if (rateHz > M.peakReqHz) M.peakReqHz = rateHz;
    rateAcc = 0;
    if (distN > 0) { meanDist = lerp(meanDist, distAcc / distN, clamp(dt * 6, 0, 1)); distAcc = 0; distN = 0; }

    const density = clamp(rateHz / SATURATE_HZ, 0, 1);
    M.density = density; M.reqHz = rateHz; M.meanDist = meanDist;

    // the envelope: rises with the rate, falls at a volley's own tail rate
    const want = density;
    bedLevel = want > bedLevel ? lerp(bedLevel, want, clamp(dt * 8, 0, 1))
                               : bedLevel * Math.exp(-dt / BED_TAU);
    if (bedLevel < 0.0008) bedLevel = 0;

    if (MIXER_OLD || !unlocked || !bedBuf) { M.bedGain = 0; return; }
    if (!bed) bed = bedLoop(bedBuf, bedBus, { cut: 900, q: 0.6, slew: 0.10 });
    if (!bed) return;

    /* AMPLITUDE GOES AS THE SQUARE ROOT OF THE COUNT. N incoherent sources
       sum in POWER, not in pressure, so twice the rifles is +3 dB and not
       twice as loud. sqrt(density) is that, and it is why a hundred men do
       not deafen you relative to twenty. */
    const g = 0.42 * Math.sqrt(bedLevel);
    /* DISTANCE IS A LOWPASS. Air absorption is roughly proportional to
       frequency squared over range, so the further the mean of the fire, the
       darker the wash. 3.2 kHz at the near line down to 700 Hz far out —
       700 is a shade under audio.js's own far-bus 820 Hz corner, because the
       wash is behind the individual far shots, not level with them. */
    const dn = clamp((Math.log(Math.max(20, meanDist)) - Math.log(20)) / (Math.log(400) - Math.log(20)), 0, 1);
    bedFilterCut = lerp(3200, 700, dn);
    // and a slow rate wobble so a four-second loop never announces itself
    const wob = 0.97 + 0.06 * Math.sin(simT * 0.37) * (0.5 + 0.5 * bedLevel);
    bed.set(muted ? 0 : g, bedFilterCut, wob);
    M.bedGain = g;

    /* THE GRAINS. Density you can count. Rate tracks the real fire rate but
       is capped: past GRAIN_HZ_MAX the ear is already in the wash and the
       grains would only be nodes. Fractional debt carried between frames so
       a 3 shots/s skirmish still pops instead of rounding to zero. */
    const grainHz = clamp(rateHz * 0.34, 0, GRAIN_HZ_MAX) * bedLevel;
    M.grainHz = grainHz;
    grainDebt += grainHz * dt;
    let fired = 0;
    while (grainDebt >= 1 && fired < 4) { grainDebt -= 1; grain(); fired++; }
    if (grainDebt > 3) grainDebt = 3;    // never bank a backlog into a burst
  }

  const _grainPan = [];
  function grain() {
    const c = audioCtx();
    if (!c || !grainBuf || muted) return;
    const src = c.createBufferSource();
    src.buffer = grainBuf;
    src.playbackRate.value = 0.82 + Math.random() * 0.42;
    const g = c.createGain();
    const dn = clamp((meanDist - 40) / 260, 0, 1);
    g.gain.value = (0.20 + Math.random() * 0.22) * (1 - dn * 0.55) * Math.sqrt(bedLevel);
    src.connect(g);
    // stereo spread when the platform has a panner: a battle line is WIDE
    let out = g;
    if (c.createStereoPanner) {
      const p = c.createStereoPanner();
      p.pan.value = (Math.random() * 2 - 1) * 0.8;
      g.connect(p); out = p;
    }
    out.connect(bedBus || feelBus);
    const slot = (Math.random() * GRAINS) | 0;
    const t = c.currentTime + Math.random() * 0.03;
    safe(function () { src.start(t, slot * GRAIN_S, GRAIN_S); });
    src.onended = function () { safe(function () { src.disconnect(); g.disconnect(); if (out !== g) out.disconnect(); }); };
    M.grains++;
  }

  /* ---- THE MEASUREMENT SEAM ------------------------------------------------
     battle.js's own "studio seam" doctrine (battle.js:2004): freeze the clock,
     drive a known input, read the numbers back. This file's whole claim is a
     number — voices per second under a load of N rifles — and a claim you
     cannot re-measure is a claim.

     load() puts N rifles on a line and fires them through THE REAL CALL PATH:
     CBZ.sfx("shoot_*", {dist, ghost, volume, delay}), which is byte for byte
     the object battle.js builds at battle.js:936. So it cannot cheat — with
     ?mixer=old the wrapper is transparent and every one of those calls lands
     in audio.js exactly as a real battle's would.

     THE GEOMETRY IS REAL, not a random number. Three hundred men hold about
     two hundred metres of front; battle.js's command camera sits tens of
     metres back and above. dist is therefore hypot(camera-standoff, position
     along the line, rank depth) for each rifle in turn — which is why a
     300-man load has a mean distance near 90 m and a 1-rifle load is at the
     camera's elbow. Seeded, so both sides of an A/B see identical distances.

     RATE: 1.6 rounds/s/rifle. combat_iq hands battle.js a per-shot cooldown
     (battle.js:1528 `m.cool = r.cd`) that sits around 0.6 s for a rifle in
     the middle of its ladder; 1/0.62 is 1.6. Not a taste number.

     FRAME CAP: 26 sfx calls per frame, because that is battle.js's own
     fxBudget (battle.js:920) and the "before" side has to be the shipped
     before, cap included — otherwise the naive number is one this game never
     actually produces. */
  let loadJob = null, loadFired = 0;
  F.load = function (o) {
    o = o || {};
    const n = Math.max(0, o.rifles | 0);
    if (!n) { loadJob = null; return false; }
    loadJob = {
      n: n,
      rate: o.rate == null ? 1.6 : +o.rate,       // rounds/s per rifle
      span: o.span == null ? Math.min(240, 14 + n * 0.7) : +o.span,
      stand: o.stand == null ? 70 : +o.stand,     // camera standoff, metres
      depth: o.depth == null ? 16 : +o.depth,     // rank depth, metres
      name: o.name || "shoot_ak47",
      cap: o.cap == null ? 26 : o.cap | 0,        // battle.js's fxBudget
      cut: o.cut == null ? 230 : +o.cut,          // battle.js's own sfx cutoff
      left: o.seconds == null ? 1e9 : +o.seconds,
      rnd: lcg(o.seed == null ? 0xfee7 : o.seed | 0),
      debt: 0, fired: 0,
    };
    return true;
  };
  F.loadOff = function () { loadJob = null; return true; };
  F.loading = function () { return loadJob ? { rifles: loadJob.n, rate: loadJob.rate, fired: loadJob.fired } : null; };

  const _lo = { dist: 0, ghost: true, volume: 0.8, pitch: 1, delay: 0 };
  function runLoad(dt) {
    const J = loadJob;
    if (!J || J.left <= 0) return;
    J.left -= dt;
    J.debt += J.n * J.rate * dt;
    let thisFrame = 0;
    while (J.debt >= 1 && thisFrame < J.cap) {
      J.debt -= 1;
      /* HALF THE RIFLES ARE YOURS. You stand in your own line, so your men
         are spread along it around you (a few metres to a few tens) and
         theirs are the same line's width away across the gap. That split is
         what the near budget exists to arbitrate: your own line's fire is
         the fire that has to punch through the wash. */
      const mine = J.rnd() < 0.5;
      const along = (J.rnd() - 0.5) * J.span;
      const back = (J.rnd() - 0.5) * J.depth;
      const d = mine ? Math.hypot(along * 0.5, back * 0.5 + 8)
                     : Math.hypot(along, J.stand + back);
      thisFrame++;
      if (d > J.cut) continue;             // battle.js does not request these
      J.fired++; loadFired++;
      // THE REAL CALL. Not F.shot() — the wrapper, so ?mixer=old is genuinely
      // the shipped path and not a second opinion about it.
      _lo.dist = d;
      _lo.volume = mine ? 0.9 : 0.8;
      _lo.delay = d > 40 ? d / 343 : 0;    // battle.js:938, speed of sound
      const sfx = CBZ.sfx;
      if (sfx) safe(function () { sfx.call(CBZ, J.name, _lo); });
    }
    if (J.debt > J.cap) J.debt = J.cap;    // never bank a backlog into a burst
  }

  /* ---- the front doors ---------------------------------------------------- */
  F.shot = function (o) {
    if (OFF) return;
    o = o || {};
    if (MIXER_OLD) { meter(o.dist || 0); M.voices++; emitVoice({ name: o.name || "shoot_carbine", o: o.opts }, 0); return; }
    pushShot(o.name || "shoot_carbine", o.dist, o.opts, o.mine);
  };

  /* THE WRAPPER. battle.js calls CBZ.sfx directly for every NPC round; this
     is how the mixer gets in front of it without a single edit to a file this
     module does not own. Everything that is not a gun passes straight
     through, untouched, in the same tick — a door close is not a war. */
  function wrapSfx() {
    if (OFF || CBZ.__feelRawSfx || typeof CBZ.sfx !== "function") return;
    const raw = CBZ.sfx;
    CBZ.__feelRawSfx = raw;
    CBZ.sfx = function (name, opts) {
      // only gunfire is routed. `shoot_*` is weapon-data's own naming and
      // audio.js's GUNS table key — one convention, already established.
      /* NO PHASE GATE. The first draft only routed gunfire during `battle`,
         which was a phase test standing in for a load test — and it meant a
         studio or a campaign skirmish silently took the naive path. The
         budget already handles the light case correctly: one shot with a full
         token bucket at close range gets a full discrete voice and a bed
         density of ~0.02, i.e. exactly what it used to get. So route always,
         and let the numbers decide. */
      if (!MIXER_OLD && typeof name === "string" && name.charCodeAt(0) === 115 /* s */ &&
          name.lastIndexOf("shoot_", 0) === 0) {
        const d = opts && opts.dist != null ? opts.dist : null;
        pushShot(name, d, opts, !!(opts && opts.dist != null && opts.dist <= OWN_M));
        return null;
      }
      if (MIXER_OLD && typeof name === "string" && name.lastIndexOf("shoot_", 0) === 0) {
        meter(opts && opts.dist != null ? opts.dist : 0);
        M.voices++;
      }
      return raw.call(CBZ, name, opts);
    };
    CBZ.sfx.__feel = true;
  }
  F.unwrap = function () {
    if (CBZ.__feelRawSfx) { CBZ.sfx = CBZ.__feelRawSfx; CBZ.__feelRawSfx = null; }
  };

  /* ============================================================ AMBIENCE
     The island, as three beds and a bird.

     WIND IS AN EXPOSURE FUNCTION, not a weather state. Standing in a wadi
     forty metres below the ridge is quiet; standing on a dune crest at 180 m
     is not. So the wind gain is (altitude term) × (exposure term) where
     exposure is how much of the neighbourhood is BELOW you — a real reading
     off desert.heightAt rather than a per-biome constant, which is why a
     crest sounds like a crest even in the middle of the gravel plain.

     THE SALT PAN IS THE POINT OF THE WHOLE SYSTEM. Everything else here
     exists so that riding onto the pan and having the sound DROP OUT means
     something. A flat pan has no relief to make wind noise on and no grass
     and no dune faces to hiss; the honest answer is near-silence, and the
     temptation to put "something" there is the temptation to make the map
     one texture. */
  let windBed = null, sandBed = null, waterBed = null;
  const AMB = { biome: "?", wind: 0, sand: 0, water: 0, exposure: 0, alt: 0, birdT: 0 };

  function exposureAt(x, z) {
    const D = W.desert;
    if (!D || !D.heightAt) return 0.5;
    const h = D.heightAt(x, z);
    // eight probes at 90 m — one dune wavelength on this island, so the
    // reading is "am I on a crest" and not "am I on a bump"
    let below = 0;
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI * 0.25;
      if (D.heightAt(x + Math.cos(a) * 90, z + Math.sin(a) * 90) < h - 1.5) below++;
    }
    return below / 8;
  }

  let ambT = 0, expCache = 0.5;
  function updateAmbience(dt) {
    if (AMB_OLD || OFF) return;
    const live = phaseNow === "campaign" || phaseNow === "battle" || phaseNow === "encounter";
    if (!unlocked || !windBuf) return;
    if (!windBed) {
      windBed = bedLoop(windBuf, ambBus, { type: "lowpass", cut: 500, q: 0.5, slew: 0.5 });
      sandBed = bedLoop(windBuf, ambBus, { type: "bandpass", cut: 4200, q: 0.9, slew: 0.35, rate: 1.3 });
      waterBed = bedLoop(windBuf, ambBus, { type: "bandpass", cut: 1500, q: 1.6, slew: 0.6, rate: 0.7 });
    }
    if (!live) {
      windBed && windBed.set(0); sandBed && sandBed.set(0); waterBed && waterBed.set(0);
      return;
    }
    // the terrain probes are the expensive part (nine heightAt calls), so
    // they run at 4 Hz and the result is interpolated. Measured: heightAt is
    // ~1.5 us, so nine of them every frame is 0.8 ms/s — not free, and the
    // ear cannot hear a wind bed update faster than this anyway.
    ambT += dt;
    const D = W.desert;
    if (ambT > 0.25) {
      ambT = 0;
      if (D && D.biomeAt) AMB.biome = safe(function () { return D.biomeAt(ear.x, ear.z); }) || "dune";
      if (D && D.heightAt) AMB.alt = safe(function () { return D.heightAt(ear.x, ear.z); }) || 0;
      expCache = exposureAt(ear.x, ear.z);
    }
    AMB.exposure = lerp(AMB.exposure, expCache, clamp(dt * 2, 0, 1));

    const b = AMB.biome;
    /* Altitude term: the island tops out around 400 m and the sea is at 0, so
       normalise on that and take a soft power — the gradient that matters is
       the first hundred metres of climb, not the last. */
    const alt = clamp(AMB.alt / 400, 0, 1);
    let wind = (0.10 + 0.55 * AMB.exposure) * (0.55 + 0.65 * Math.pow(alt, 0.6));
    let sand = 0, water = 0;
    if (b === "dune") { sand = 0.16 + 0.30 * AMB.exposure; wind *= 1.15; }
    else if (b === "shore") { sand = 0.10; wind *= 1.05; water = 0.14; }
    else if (b === "salt") { wind *= 0.22; sand = 0.0; }   // the dead quiet
    else if (b === "rock") { wind *= 1.10; sand = 0.03; }  // wind on stone, no hiss
    else if (b === "wadi") { wind *= 0.45; sand = 0.05; }  // the ridge shelters it
    else if (b === "gravel") { sand = 0.06; }
    else if (b === "oasis") { wind *= 0.5; water = 0.30; }
    else if (b === "sea") { wind *= 1.2; water = 0.34; }

    // an oasis is audible before you are standing in it
    if (D && D.oases && D.oases.length) {
      let best = 1e9;
      for (let i = 0; i < D.oases.length; i++) {
        const o = D.oases[i];
        const d = Math.hypot(o.x - ear.x, o.z - ear.z) - (o.r || 40);
        if (d < best) best = d;
      }
      if (best < 260) water = Math.max(water, 0.30 * (1 - clamp(best / 260, 0, 1)));
    }

    // riding fast is wind in your own ears — a real effect, and it is the
    // only feedback the campaign has that you are moving at all
    const move = clamp(ear.speed / 30, 0, 1);
    wind *= 1 + move * 0.9;
    sand *= 0.35 + move * 1.2;

    // in battle the ambience gets out of the way of the war
    const duck = phaseNow === "battle" ? (1 - 0.55 * clamp(bedLevel * 2, 0, 1)) : 1;

    AMB.wind = wind * duck; AMB.sand = sand * duck; AMB.water = water * duck;
    const mm = muted ? 0 : 1;
    windBed.set(AMB.wind * 0.30 * mm, lerp(320, 900, move), 0.9 + move * 0.25);
    sandBed.set(AMB.sand * 0.10 * mm, lerp(3400, 6200, move), 1.1 + move * 0.4);
    waterBed.set(AMB.water * 0.09 * mm, 1300, 0.7);

    // BIRDS ARE THE ONLY THING ON THIS ISLAND THAT IS ALIVE and they only
    // exist at water. Rate-limited hard: a chirp every 2-6 s reads as an
    // oasis, a chirp every second reads as a ringtone.
    AMB.birdT -= dt;
    if (AMB.water > 0.18 && AMB.birdT <= 0) {
      AMB.birdT = 2 + Math.random() * 4;
      chirp();
    }
  }

  function chirp() {
    const c = audioCtx();
    if (!c || muted || !ambBus) return;
    const n = 2 + ((Math.random() * 3) | 0);
    const base = 1900 + Math.random() * 1400;
    for (let i = 0; i < n; i++) {
      const t = c.currentTime + i * (0.055 + Math.random() * 0.05);
      const o = c.createOscillator(), g = c.createGain();
      o.type = "sine";
      o.frequency.setValueAtTime(base * (0.94 + Math.random() * 0.14), t);
      o.frequency.exponentialRampToValueAtTime(base * 1.35, t + 0.035);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.030 * AMB.water * 3, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
      o.connect(g); g.connect(ambBus);
      safe(function () { o.start(t); o.stop(t + 0.09); });
      o.onended = function () { safe(function () { o.disconnect(); g.disconnect(); }); };
    }
  }

  /* ============================================================ THE COLUMN
     THE SINGLE BEST FEEDBACK LOOP IN THE GAME. You start alone and it is
     silent behind you. Every man you buy, frighten or capture makes the sound
     behind you thicker, and you hear the army before you look at the roster.

     Same engineering as the war mixer, for the same reason: forty men is not
     forty footfall sounds. One looping boot bank, gain by sqrt(N) (incoherent
     power summation again), playbackRate by pace, PLUS a small number of
     discrete near footfalls so the bed has a foreground. Capped at 4/s: past
     that the steps fuse anyway (FUSE_S) and you are paying nodes for mush. */
  let colBed = null, colStepDebt = 0;
  const COL = { n: 0, gain: 0, pace: 0 };

  function updateColumn(dt) {
    if (COL_OLD || OFF || !unlocked || !bootBuf) return;
    const riding = phaseNow === "campaign";
    const n = W.armySize ? (safe(function () { return W.armySize(); }) || 1) : 1;
    COL.n = n;
    if (!colBed) colBed = bedLoop(bootBuf, ambBus, { type: "lowpass", cut: 1400, q: 0.6, slew: 0.4 });
    if (!colBed) return;
    if (!riding) { colBed.set(0); COL.gain = 0; return; }

    /* THE MEN BEHIND YOU, minus you: you are not in W.state.army and armySize
       adds you back, so (n-1) is the column. One man alone makes no column
       sound at all — that silence is the start of the game and it has to be
       real or the first hire means nothing. */
    const men = Math.max(0, n - 1);
    const pace = clamp(ear.speed / 12, 0, 1.4);          // 12 m/s ≈ a mounted column
    COL.pace = pace;
    // sqrt of the count, saturating around 120 men — past that the column is
    // just "an army" and another fifty rifles do not change the sound.
    const size = Math.sqrt(clamp(men, 0, 120) / 120);
    const g = size * (0.18 + 0.42 * clamp(pace, 0, 1));
    COL.gain = g;
    colBed.set(muted ? 0 : g * 0.40, lerp(900, 2100, clamp(pace, 0, 1)), 0.8 + pace * 0.5);

    // the foreground: individual steps from the nearest few men
    const stepHz = clamp(men * 0.10 * (0.3 + pace), 0, 4);
    colStepDebt += stepHz * dt;
    let k = 0;
    while (colStepDebt >= 1 && k < 2) { colStepDebt -= 1; step(0.5 + Math.random() * 0.5); k++; }
    if (colStepDebt > 2) colStepDebt = 2;
  }

  function step(vol) {
    const c = audioCtx();
    if (!c || !bootBuf || muted || !ambBus) return;
    const src = c.createBufferSource();
    src.buffer = bootBuf;
    src.playbackRate.value = 0.88 + Math.random() * 0.3;
    const g = c.createGain(); g.gain.value = 0.09 * vol;
    src.connect(g);
    let out = g;
    if (c.createStereoPanner) {
      const p = c.createStereoPanner(); p.pan.value = (Math.random() * 2 - 1) * 0.6;
      g.connect(p); out = p;
    }
    out.connect(ambBus);
    const slot = (Math.random() * BOOTS) | 0;
    safe(function () { src.start(c.currentTime, slot * BOOT_S, BOOT_S); });
    src.onended = function () { safe(function () { src.disconnect(); g.disconnect(); if (out !== g) out.disconnect(); }); };
  }

  /* ============================================================ MORALE
     YOU SHOULD HEAR A LINE BREAK BEFORE YOU SEE IT. That is the whole ask,
     and it is three sounds:
       · the WAVER — morale sliding under the nerve threshold. A low unstable
         drone that beats slightly out of tune with itself. Rises as morale
         falls. This is the "before you see it" part.
       · the BREAK — the moment a side's morale crosses its break point. A
         short mass shout, down.
       · the ROUT — men actually running. A receding voice.

     HOW IT KNOWS. battle.js does not emit anything yet — the file is being
     written in parallel with this one. So this listens for the names it
     SHOULD emit and, until they exist, polls W.battle.audit() at 4 Hz, which
     is a shipped, published surface (battle.js:2026) carrying morale for both
     sides. When battle.js starts emitting `morale`/`battle:morale` the poll
     becomes redundant and costs one object every quarter second.

     THE EVENT NAMES THIS EXPECTS battle.js TO ADD, in preference order:
       W.emit("battle:morale", {side:"mine"|"them", morale:0..1, routing:n})
       W.emit("battle:break",  {side, alive})
       W.emit("battle:rout",   {side, n})
       W.emit("battle:charge", {side, contact:true})     — for the hit-stop */
  const MOR = { mine: 1, them: 1, routing: 0, waver: 0, brokeMine: false, brokeThem: false };
  let waverBed = null, morT = 0;
  const BREAK_AT = 0.62;   // battle.js's own levy break point (battle.js:627)

  function morale(side, v, routing) {
    if (side === "them") MOR.them = v; else MOR.mine = v;
    if (routing != null) MOR.routing = routing;
    const was = side === "them" ? MOR.brokeThem : MOR.brokeMine;
    const now = v < BREAK_AT;
    if (now && !was) breakSound(side);
    if (side === "them") MOR.brokeThem = now; else MOR.brokeMine = now;
  }

  function updateMorale(dt) {
    if (OFF || !unlocked) return;
    if (phaseNow !== "battle") {
      if (waverBed) waverBed.set(0);
      MOR.waver = 0;
      return;
    }
    morT += dt;
    if (morT > 0.25) {
      morT = 0;
      const B = W.battle;
      if (B && B.audit) {
        const a = safe(function () { return B.audit(); });
        if (a && a.live) {
          morale("mine", a.mine.morale, a.mine.routing);
          morale("them", a.them.morale, a.them.routing);
        }
      }
    }
    /* THE WAVER IS YOUR SIDE'S ONLY, deliberately. Hearing the enemy's nerve
       go is information you have not earned; hearing your own is the warning
       the order buttons exist to answer. */
    const w = clamp((0.90 - MOR.mine) / 0.42, 0, 1);
    MOR.waver = lerp(MOR.waver, w, clamp(dt * 1.5, 0, 1));
    if (!waverBed) waverBed = detuneDrone();
    if (waverBed) waverBed.set(muted ? 0 : MOR.waver * 0.055, MOR.waver);
  }

  /* Two oscillators a few cents apart beat against each other; the beat rate
     IS the anxiety. Detune widens as morale falls, so the thing gets more
     unstable the closer the line is to going. Two nodes, forever. */
  function detuneDrone() {
    const c = audioCtx();
    if (!c || !feelBus) return null;
    const a = c.createOscillator(), b = c.createOscillator();
    const g = c.createGain(); g.gain.value = 0;
    const lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 420;
    a.type = "sawtooth"; b.type = "sawtooth";
    a.frequency.value = 61.7;                  // low B, under everything else
    b.frequency.value = 61.7;
    a.connect(lp); b.connect(lp); lp.connect(g); g.connect(feelBus);
    safe(function () { a.start(); b.start(); });
    return {
      set: function (gain, amount) {
        if (!ctx) return;
        const t = ctx.currentTime;
        g.gain.setTargetAtTime(Math.max(0, gain), t, 0.4);
        if (amount != null) b.detune.setTargetAtTime(6 + amount * 38, t, 0.6);
      },
    };
  }

  /* A MASS SHOUT is a filtered noise swell with a downward pitch centre —
     dozens of voices, none of them distinguishable, which is what a line
     going means. Down for a break, up for a charge. */
  function shout(opts) {
    const c = audioCtx();
    if (!c || muted || !windBuf || !feelBus) return;
    opts = opts || {};
    const dur = opts.dur || 0.9;
    const t = c.currentTime;
    const src = c.createBufferSource(); src.buffer = windBuf; src.loop = true;
    src.playbackRate.value = 0.9 + Math.random() * 0.2;
    const bp = c.createBiquadFilter(); bp.type = "bandpass"; bp.Q.value = 2.4;
    bp.frequency.setValueAtTime(opts.f0 || 700, t);
    bp.frequency.exponentialRampToValueAtTime(Math.max(80, opts.f1 || 260), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, opts.gain || 0.16), t + (opts.attack || 0.12));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bp); bp.connect(g); g.connect(feelBus);
    safe(function () { src.start(t); src.stop(t + dur + 0.05); });
    src.onended = function () { safe(function () { src.disconnect(); bp.disconnect(); g.disconnect(); }); };
  }

  function breakSound(side) {
    const mine = side !== "them";
    shout({ dur: 1.4, f0: mine ? 620 : 520, f1: mine ? 180 : 210, gain: mine ? 0.20 : 0.12, attack: 0.2 });
    if (mine) {
      // your own line going is the one moment the whole mix should get out of
      // the way. audio.js already owns a held-hush stage; reuse it rather than
      // building a second ducking network.
      safe(function () { if (CBZ.audioHush) { CBZ.audioHush(true, { fade: 0.25 }); setTimeout(function () { CBZ.audioHush(false); }, 700); } });
      CBZ.shake && shakeReq(0.5);
    }
  }

  /* ============================================================ THE SCREENS
     Ultra-simple UI needs audible confirmation, and the fiftieth repeat is
     the design constraint: SHORT (under 140 ms), NARROW (one or two partials,
     nothing with a tail), and DISTINCT BY INTERVAL rather than by timbre —
     the ear tells a rising fourth from a falling minor third instantly and
     tells two similar clicks apart never.

     Money goes up in pitch, money goes down in pitch, men joining is a warm
     double, a man dying is a dry single, an order given is a flat bark. */
  const CUES = {
    buy:      { f: [520, 392],       type: "triangle", g: 0.10, t: 0.075 },  // falling: money left
    sell:     { f: [392, 588],       type: "triangle", g: 0.10, t: 0.075 },  // rising: money in
    hire:     { f: [330, 494, 660],  type: "triangle", g: 0.11, t: 0.085 },  // a chord, warm
    equip:    { f: [880, 1320],      type: "square",   g: 0.045, t: 0.03 },  // metal on metal
    order:    { f: [220, 220],       type: "square",   g: 0.09, t: 0.06 },   // a flat bark
    demand:   { f: [147, 110],       type: "sawtooth", g: 0.12, t: 0.20 },   // low, ugly
    execute:  { f: [98],             type: "sawtooth", g: 0.16, t: 0.30 },   // one note, down
    open:     { f: [294, 440],       type: "sine",     g: 0.06, t: 0.06 },
    close:    { f: [440, 294],       type: "sine",     g: 0.06, t: 0.06 },
    bad:      { f: [196, 165],       type: "square",   g: 0.09, t: 0.11 },
    good:     { f: [523, 784],       type: "sine",     g: 0.08, t: 0.08 },
    dawn:     { f: [262, 392, 523],  type: "sine",     g: 0.07, t: 0.22 },
    dead:     { f: [110],            type: "triangle", g: 0.09, t: 0.18 },
  };
  const uiLast = Object.create(null);
  const UI_GAP = 0.06;   // 60 ms: two UI cues closer than this are one press

  F.ui = function (name, opts) {
    if (OFF) return false;
    const cue = CUES[name];
    const c = audioCtx();
    if (!cue || !c || muted || !uiBus) return false;
    // the gate is about how fast a HUMAN presses, so it reads the wall clock.
    // ctx.currentTime is frozen at 0 on a suspended context, which would let
    // the first cue of a never-gestured page poison the gate forever.
    const wall = (G.performance && G.performance.now ? G.performance.now() : Date.now()) * 0.001;
    if (wall - (uiLast[name] || -1e9) < UI_GAP) return false;
    uiLast[name] = wall;
    const now = c.currentTime;
    opts = opts || {};
    const vol = opts.volume == null ? 1 : opts.volume;
    for (let i = 0; i < cue.f.length; i++) {
      const t = now + i * cue.t * 0.55;
      const o = c.createOscillator(), g = c.createGain();
      o.type = cue.type;
      // ±1.5% jitter: identical repeats of a synthetic tone are what makes a
      // UI sound "cheap" on the fiftieth press. Nothing reads this back.
      o.frequency.setValueAtTime(cue.f[i] * (0.985 + Math.random() * 0.03), t);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, cue.g * vol), t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + cue.t);
      o.connect(g); g.connect(uiBus);
      safe(function () { o.start(t); o.stop(t + cue.t + 0.02); });
      o.onended = function () { safe(function () { o.disconnect(); g.disconnect(); }); };
    }
    return true;
  };

  /* ============================================================ IMPACT
     THE SHAKE BUDGET. CBZ.shake takes a max, and battle.js raises it on every
     round that lands on you (battle.js:1001) and on every round you fire
     (battle.js:1336). In a firefight that is a request every few frames and
     the max never gets a chance to decay, so the camera sits pinned — a
     constant shake reads as a broken renderer, not as danger.

     The budget: a recent-shake accumulator that decays on its own clock.
     Every request is scaled by how much shake the camera has already been
     given lately, so the FIRST hit of a burst lands full and the tenth in a
     second lands at a fifth. Nothing is silenced; the ranking is preserved.
     ?shake=old removes the wrapper entirely. */
  let shakeSpent = 0;
  const SHAKE_DECAY = 1.6;   // per second — roughly CBZ.shake's own decay rate
  function shakeReq(m) {
    if (!CBZ.shake) return;
    const rawShake = CBZ.__feelRawShake;
    if (SHAKE_OLD || OFF) { (rawShake || CBZ.shake).call(CBZ, m); return; }
    const scale = 1 / (1 + shakeSpent * 1.35);
    shakeSpent += m * scale;
    (rawShake || CBZ.shake).call(CBZ, m * scale);
  }
  function wrapShake() {
    if (SHAKE_OLD || OFF || CBZ.__feelRawShake || typeof CBZ.shake !== "function") return;
    CBZ.__feelRawShake = CBZ.shake;
    CBZ.shake = function (m) { shakeReq(+m || 0); };
    CBZ.shake.__feel = true;
  }

  /* THE HIT-STOP. A charge landing should stick for a frame — that pause is
     what makes contact feel like mass. This file CANNOT freeze the sim: the
     clock belongs to microboot and the battle owns its own frame. What it can
     do is the perceptual half of a hit-stop, and it is most of the effect:
     the whole mix drops out for ~90 ms (audio.js's own held-hush stage, not a
     second ducking network), then releases into a low thump and a shake
     spike. The gap is the hit.

     W.feel.hitStop(sec) is exposed so battle.js can call it at the exact
     frame contact resolves; until it does, `battle:charge` is listened for.
     If the orchestrator wants a real sim freeze it belongs in battle.js's
     frame function, not here. */
  F.hitStop = function (sec) {
    if (OFF) return false;
    /* A FAST-FORWARD HAS NO ROOM FOR A BEAT. The hush is 90 ms of WALL time
       and correctly so — it is a gap in an audio timeline, not a sim pause —
       but at 8x those 90 ms are 0.7 s of world, and at 64x they are five and
       a half. A charge every second then leaves the mix hushed permanently,
       which is not "impact", it is a broken speaker. Above 2x the perceptual
       hit-stop is simply not attempted. */
    if (W.clock && W.clock.scale() > 2) return false;
    const s = clamp(sec == null ? 0.09 : sec, 0.02, 0.30);
    safe(function () { if (CBZ.audioHush) CBZ.audioHush(true, { fade: 0.015 }); });
    setTimeout(function () {
      safe(function () { if (CBZ.audioHush) CBZ.audioHush(false, { fade: 0.02 }); });
      thump(0.55);
      shakeReq(0.75);
    }, s * 1000);
    W.emit && W.emit("feel:hitstop", s);
    return true;
  };

  function thump(g) {
    const c = audioCtx();
    if (!c || muted || !feelBus) return;
    const t = c.currentTime;
    const o = c.createOscillator(), gn = c.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(34, t + 0.28);
    gn.gain.setValueAtTime(Math.max(0.0002, 0.24 * (g == null ? 1 : g)), t);
    gn.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
    o.connect(gn); gn.connect(feelBus);
    safe(function () { o.start(t); o.stop(t + 0.36); });
    o.onended = function () { safe(function () { o.disconnect(); gn.disconnect(); }); };
  }
  F.thump = thump;

  /* ============================================================ MUSIC
     DEFAULT OFF, AND THE REASON IS ALREADY IN THE REPO. systems/music.js is a
     deliberate no-op with the owner quoted in it: "no bullshit background …
     no diy sounds". That question has been answered once and this file is not
     going to relitigate it by shipping a synth pad on by default.

     So: it is built, it is one adaptive bed, it is four oscillators and
     nothing sampled (there is no audio pipeline to add megabytes to), and it
     is behind ?music=1. Four states, and the transition is the whole idea —
     the bed does not change TRACK, it changes SHAPE:
       riding      an open fifth, slow filter drift, barely there
       encounter   the fifth narrows to a tritone; the drift stops
       battle      pitch drops out entirely; what is left is a sub pulse at
                   the rate of a fast heart, under the war
       aftermath   a falling minor third, once, then nothing
     Four oscillators total, forever. */
  let mus = null;
  function musicRig() {
    const c = audioCtx();
    if (!c || !feelBus) return null;
    const g = c.createGain(); g.gain.value = 0;
    const lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 700; lp.Q.value = 0.8;
    lp.connect(g); g.connect(feelBus);
    const vs = [];
    for (let i = 0; i < 3; i++) {
      const o = c.createOscillator(); o.type = i === 0 ? "sine" : "triangle";
      const og = c.createGain(); og.gain.value = i === 0 ? 0.6 : 0.28;
      o.connect(og); og.connect(lp);
      safe(function () { o.start(); });
      vs.push({ o: o, g: og });
    }
    // the sub: its own gain so battle can bring it up alone
    const sub = c.createOscillator(); sub.type = "sine"; sub.frequency.value = 41.2;
    const subG = c.createGain(); subG.gain.value = 0;
    sub.connect(subG); subG.connect(g);
    safe(function () { sub.start(); });
    return { g: g, lp: lp, vs: vs, sub: sub, subG: subG };
  }

  const MUS = { state: "", pulse: 0 };
  function updateMusic(dt) {
    if (!MUSIC_ON || OFF || !unlocked) return;
    if (!mus) mus = musicRig();
    if (!mus || !ctx) return;
    const t = ctx.currentTime;
    const p = phaseNow;
    const want = p === "battle" ? "battle"
               : p === "encounter" ? "encounter"
               : p === "aftermath" ? "aftermath"
               : p === "campaign" ? "riding" : "off";
    if (want !== MUS.state) {
      MUS.state = want;
      const base = 82.4;   // E2 — low enough to sit under the war
      const set = function (i, hz) { mus.vs[i].o.frequency.setTargetAtTime(hz, t, 1.2); };
      if (want === "riding")    { set(0, base); set(1, base * 1.5); set(2, base * 2); }      // open fifth
      else if (want === "encounter") { set(0, base); set(1, base * 1.414); set(2, base * 2); } // tritone
      else if (want === "battle")    { set(0, base * 0.5); set(1, base * 0.5); set(2, base); }
      else if (want === "aftermath") { set(0, base); set(1, base * 1.189); set(2, base * 0.5); } // minor third
      const lvl = want === "off" ? 0 : want === "riding" ? 0.030
                : want === "encounter" ? 0.055 : want === "battle" ? 0.022 : 0.045;
      mus.g.gain.setTargetAtTime(muted ? 0 : lvl, t, want === "off" ? 1.2 : 2.0);
      mus.subG.gain.setTargetAtTime(want === "battle" ? 0.5 : 0, t, 1.5);
      mus.lp.frequency.setTargetAtTime(want === "battle" ? 180 : want === "encounter" ? 900 : 640, t, 2.0);
    }
    if (MUS.state === "battle") {
      // 1.9 Hz — a fast heart. Modulated by your own side's morale, so the
      // bed itself gets more frantic as the line gets closer to going.
      MUS.pulse += dt * (1.9 + MOR.waver * 1.1);
      const v = 0.5 + 0.5 * Math.sin(MUS.pulse * Math.PI * 2);
      mus.subG.gain.setTargetAtTime(muted ? 0 : 0.25 + v * 0.5, t, 0.05);
    } else if (MUS.state === "riding") {
      mus.lp.frequency.setTargetAtTime(560 + Math.sin(simT * 0.07) * 220, t, 1.5);
    }
  }

  /* ============================================================ THE OVERLAY
     Headless Chrome has no speakers, so the claim in this file's header has to
     be PHOTOGRAPHABLE. ?feel=1 draws every number the mixer decided on, live,
     in the corner. Bottom-left on purpose: battle.js owns the top strip and
     the right-hand order buttons. */
  let ovl = null, ovlT = 0;
  function ensureOverlay() {
    if (ovl || !DEBUG || typeof document === "undefined" || !document.body) return ovl;
    const n = document.createElement("div");
    n.id = "feelDebug";
    n.setAttribute("aria-hidden", "true");
    n.style.cssText =
      "position:fixed;left:10px;bottom:10px;z-index:99999;pointer-events:none;" +
      "font:11px/1.32 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;" +
      "color:#eae0cc;background:rgba(8,6,4,.86);border:1px solid rgba(255,138,61,.55);" +
      "border-radius:8px;padding:8px 10px;min-width:268px;white-space:pre;" +
      "text-shadow:0 1px 2px #000";
    document.body.appendChild(n);
    ovl = n;
    return n;
  }
  function bar(v, n) {
    n = n || 12;
    const k = clamp(Math.round(v * n), 0, n);
    return "=".repeat(k) + "-".repeat(n - k);
  }
  function paintOverlay(dt) {
    if (!DEBUG) return;
    ovlT += dt;
    if (ovlT < 0.12 || !ensureOverlay()) return;
    ovlT = 0;
    const a = F.audit();
    const mode = MIXER_OLD ? "NAIVE (mixer=old)" : "MIXER";
    ovl.textContent =
      "FEEL — " + mode + (muted ? "  [MUTED]" : "") + "\n" +
      "phase " + a.phase + "   ctx " + a.ctxState +
        (a.ctxState === "suspended" ? " (no gesture; nodes still minted)" : "") +
        "   fps " + a.fps + "\n" +
      (a.load ? "load " + a.load + " rifles @ " + a.loadRate + "/s\n" : "") +
      "-- GUNS ------------------\n" +
      "requested   " + pad(a.reqHz, 6) + " /s   total " + a.reqAll + "\n" +
      "voices      " + pad(a.voiceHz, 6) + " /s   total " + a.voices + "\n" +
      "grains      " + pad(a.grainHz, 6) + " /s   total " + a.grains + "\n" +
      "folded->bed " + pad(a.folded, 6) + "      " + a.foldedPct + "%\n" +
      "nodes       " + pad(a.nodeHz, 6) + " /s   total " + a.nodes + "\n" +
      "density   " + bar(a.density) + " " + a.density.toFixed(2) + "\n" +
      "bed gain  " + bar(a.bedGain / 0.42) + " " + a.bedGain.toFixed(3) + "\n" +
      "mean dist   " + pad(a.meanDist, 6) + " m    tokens " + a.tokens.toFixed(1) + "\n" +
      "-- WORLD -----------------\n" +
      "biome " + (a.biome + "        ").slice(0, 8) + " alt " + pad(a.alt, 5) + " exp " + a.exposure.toFixed(2) + "\n" +
      "wind  " + bar(a.wind, 10) + "  sand " + bar(a.sand, 10) + "\n" +
      "water " + bar(a.water, 10) + "  col  " + bar(a.column, 10) + "\n" +
      "army " + pad(a.army, 5) + " men   pace " + a.pace.toFixed(2) + "\n" +
      "morale mine " + a.moraleMine.toFixed(2) + "  them " + a.moraleThem.toFixed(2) + "\n" +
      "waver " + bar(a.waver, 10) + "   shake " + a.shake.toFixed(2);
  }
  function pad(v, n) {
    const s = (typeof v === "number" ? (Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 10) / 10) : v) + "";
    return s.length >= n ? s : " ".repeat(n - s.length) + s;
  }

  /* ============================================================ AUDIT
     One call with every number, for the overlay, the preset and anybody
     debugging by console. Allocates one object; not called per frame in
     normal play. */
  F.audit = function () {
    const fold = M.reqAll > 0 ? Math.round((M.folded / M.reqAll) * 1000) / 10 : 0;
    return {
      on: !OFF, mixer: !MIXER_OLD, debug: DEBUG, muted: muted, unlocked: unlocked,
      ctxState: ctx ? ctx.state : "none",
      phase: phaseNow || "?",
      fps: Math.round((CBZ.micro && CBZ.micro.fps) || 0),
      simT: Math.round(simT * 100) / 100,
      reqAll: M.reqAll, reqNear: M.reqNear, reqFar: M.reqFar,
      voices: M.voices, grains: M.grains, folded: M.folded, foldedPct: fold,
      nodes: M.nodes, nodeHz: M.nodeHz,
      reqHz: M.reqHz, voiceHz: M.voiceHz, grainHz: M.grainHz,
      peakReqHz: Math.round(M.peakReqHz * 10) / 10,
      peakVoiceHz: Math.round(M.peakVoiceHz * 10) / 10,
      density: M.density, bedGain: M.bedGain, meanDist: M.meanDist, tokens: tokens,
      biome: AMB.biome, alt: Math.round(AMB.alt), exposure: AMB.exposure,
      wind: AMB.wind, sand: AMB.sand, water: AMB.water,
      army: COL.n, column: COL.gain, pace: COL.pace,
      moraleMine: MOR.mine, moraleThem: MOR.them, waver: MOR.waver, routing: MOR.routing,
      shake: shakeSpent,
      load: loadJob ? loadJob.n : 0, loadRate: loadJob ? loadJob.rate : 0,
      loadFired: loadFired,
      music: MUSIC_ON ? MUS.state : "off",
      reuse: {
        audio: !!(CBZ.__feelRawSfx || CBZ.sfx), hush: !!CBZ.audioHush,
        shake: !!CBZ.shake, desert: !!(W.desert && W.desert.biomeAt),
        battleAudit: !!(W.battle && W.battle.audit),
      },
    };
  };
  /* the tools' own name for it, matching the pattern battle.js established */
  G.__warlordFeel = F;

  F.reset = function () {
    M.reqAll = M.reqNear = M.reqFar = M.voices = M.grains = M.folded = M.nodes = 0;
    M.peakVoiceHz = M.peakReqHz = 0; loadFired = 0;
    rateHz = 0; M.voiceHz = 0; M.grainHz = 0; M.nodeHz = 0;
    return true;
  };

  /* ============================================================ THE FRAME */
  let phaseNow = "boot";
  let inBattle = false;
  let vAcc = 0, gAcc = 0, nAcc = 0, hzT = 0, lastVoices = 0, lastGrains = 0, lastNodes = 0;

  function frame(dt) {
    if (OFF) return;
    /* ONCE PER RENDERED FRAME, ON WALL SECONDS — the mixer is the one thing
       on this page that must NOT scale with the game speed.

       At 8x the loop hands every frame hook eight substeps (microboot's
       tick(), see THE TIME SCALE there), so this ran eight times per drawn
       frame and flushed eight times the voices. Worse, the budget below is a
       token bucket — `tokens += dt * NEAR_HZ` — and the delay a voice is
       scheduled with is REAL seconds on a real audio timeline, so feeding it
       scaled time asks a speaker for eight times the gunfire per second. The
       war is not eight times louder at 8x; there is simply more of it behind
       the same 44.1 kHz.

       micro.drawing is true on exactly one substep per frame and micro.frameDt
       is that frame's real wall seconds. At 1x subCount is 1 and this is a
       no-op. */
    const M = CBZ.micro;
    if (M && M.subCount > 1) {
      if (!M.drawing) return;
      if (M.frameDt > 0) dt = M.frameDt;
    }
    dt = dt > 0 && dt < 0.5 ? dt : 1 / 60;
    simT += dt;
    readEar(dt);
    runLoad(dt);
    flushShots(dt);
    updateAmbience(dt);
    updateColumn(dt);
    updateMorale(dt);
    updateMusic(dt);
    shakeSpent = Math.max(0, shakeSpent - dt * SHAKE_DECAY);

    // the per-second rates, on sim time so the A/B tool's frozen clock
    // reports the same numbers a live frame does
    hzT += dt;
    if (hzT >= 0.25) {
      const inv = 1 / hzT;
      M.voiceHz = (M.voices - lastVoices) * inv;
      M.grainHz = (M.grains - lastGrains) * inv;
      M.nodeHz = (M.nodes - lastNodes) * inv;
      if (M.voiceHz > M.peakVoiceHz) M.peakVoiceHz = M.voiceHz;
      lastVoices = M.voices; lastGrains = M.grains; lastNodes = M.nodes;
      hzT = 0;
    }
    paintOverlay(dt);
  }

  /* ============================================================ WIRING */
  function wireEvents() {
    const on = W.on;
    if (!on) return;

    on("phase", function (t) {
      phaseNow = t && t.to ? t.to : W.phase();
      inBattle = phaseNow === "battle";
      // a phase change is a screen change; the ear should be told
      if (phaseNow === "outpost" || phaseNow === "armoury") F.ui("open");
      if (t && (t.from === "outpost" || t.from === "armoury")) F.ui("close");
      if (phaseNow === "battle") { F.ui("order", { volume: 1.2 }); shout({ dur: 1.1, f0: 400, f1: 760, gain: 0.13 }); }
      if (phaseNow === "aftermath") { MOR.brokeMine = MOR.brokeThem = false; MOR.mine = MOR.them = 1; }
      if (phaseNow === "encounter") F.ui("open", { volume: 0.8 });
    });

    on("toast", function (t) { F.ui(t && t.kind === "bad" ? "bad" : t && t.kind === "good" ? "good" : "open", { volume: 0.7 }); });
    on("dawn", function () { F.ui("dawn"); });
    on("newgame", function () { F.reset(); MOR.mine = MOR.them = 1; });
    on("loaded", function () { F.reset(); });

    on("outpost:buy", function () { F.ui("buy"); });
    on("outpost:sell", function () { F.ui("sell"); });
    on("outpost:hire", function () { F.ui("hire"); });
    on("outpost:rest", function () { F.ui("good"); });
    on("outpost:open", function () { F.ui("open"); });
    on("outpost:close", function () { F.ui("close"); });
    on("armoury:equip", function () { F.ui("equip"); });
    on("armoury:auto", function () { F.ui("equip", { volume: 1.3 }); });
    on("armoury:open", function () { F.ui("open"); });
    on("armoury:close", function () { F.ui("close"); });
    on("campaign:band", function () { F.ui("bad", { volume: 0.8 }); });
    on("warnet:meet", function () { F.ui("good"); });
    on("warnet:duel", function (d) { F.ui(d && d.won ? "good" : "bad"); });

    /* THE ARMY GETTING BIGGER IS THE GAME. A cue on every change, and the
       cue is different for up and down, because losing men has to sound
       like losing men. */
    let lastArmy = -1;
    on("army", function (n) {
      if (lastArmy >= 0 && n !== lastArmy) F.ui(n > lastArmy ? "hire" : "dead", { volume: 0.9 });
      lastArmy = n;
    });

    /* MONEY. Only fires when the sign is clear and the delta is real —
       otherwise a payroll tick every dawn is a coin sound every dawn. */
    let lastGold = null;
    on("gold", function (g) {
      if (lastGold != null && Math.abs(g - lastGold) >= 5) F.ui(g > lastGold ? "sell" : "buy", { volume: 0.6 });
      lastGold = g;
    });

    /* THE NAMES battle.js SHOULD EMIT. None of them exist yet (2026-08-30);
       updateMorale() polls W.battle.audit() until they do. Listening for them
       now costs nothing and means the wiring is already done when they land. */
    on("morale", function (d) { if (d) morale(d.side || "mine", d.morale == null ? d.value : d.morale, d.routing); });
    on("battle:morale", function (d) { if (d) morale(d.side || "mine", d.morale, d.routing); });
    on("battle:break", function (d) { breakSound(d && d.side); });
    on("battle:rout", function () { shout({ dur: 1.8, f0: 520, f1: 150, gain: 0.11, attack: 0.35 }); });
    on("battle:charge", function (d) { if (!d || d.contact !== false) F.hitStop(0.09); shout({ dur: 0.8, f0: 320, f1: 720, gain: 0.15, attack: 0.06 }); });
    on("battle:volley", function () { shout({ dur: 0.5, f0: 300, f1: 500, gain: 0.07, attack: 0.04 }); });
    on("battle:shot", function (d) { if (d) F.shot(d); });
    on("battle:end", function () { MOR.waver = 0; if (waverBed) waverBed.set(0); });
  }

  /* THE GESTURE. Nothing may throw on a page with no AudioContext and nothing
     may try to start one before a gesture — both are the same rule. One
     listener per event, removed the moment it fires. */
  function armGesture() {
    if (typeof document === "undefined") return;
    const evs = ["pointerdown", "touchstart", "keydown", "mousedown"];
    const go = function () {
      evs.forEach(function (e) { document.removeEventListener(e, go, true); });
      F.unlock();
    };
    evs.forEach(function (e) { document.addEventListener(e, go, true); });
  }

  /* ============================================================ MODULE
     needs: [] on purpose. This file hooks EVENTS, never another module's
     internals, so it does not care whether desert.js or battle.js booted
     first — every reach into them is guarded and every one of them is
     optional. That is also why it can be dropped from the page entirely
     without taking anything with it. */
  F.needs = [];
  F.boot = function (c) {
    if (OFF) { console.log("[feel] off (?feel=off)"); return; }
    phaseNow = W.phase ? W.phase() : "boot";
    inBattle = phaseNow === "battle";
    wrapSfx();
    wrapShake();
    wireEvents();
    armGesture();
    const micro = c && c.micro ? c.micro : CBZ.micro;
    /* ORDER 900: after battle.js's frame hook (order 0) and campaign's
       (order 5), so a frame's shot requests are all in hand before any of
       them is decided. A mixer that flushes before the frame that fills it
       is a mixer that is always one frame stale. */
    if (micro && micro.onFrame) micro.onFrame(frame, { order: 900, id: "warlord-feel" });
    if (DEBUG) ensureOverlay();
    console.log("[feel] " + (MIXER_OLD ? "NAIVE path (?mixer=old)" : "mixer on") +
                ", near budget " + Math.round(NEAR_HZ) + "/s, bed cap " + GRAIN_HZ_MAX + " grains/s");
  };
  /* THE MODULE IS THE API OBJECT ITSELF, not a {needs,boot} wrapper around it.
     core.js's W.module does `W[name] = api` (core.js:829), so registering a
     bare descriptor would replace W.feel with {needs,boot} and throw away
     every published call on it. desert.js already had to learn this. */
  W.module("feel", F);

  /* LATE REGISTRATION SELF-BOOT. bootModules() runs exactly once, at page
     start; a build that injects this file afterwards (a tool, a console, a
     page whose script list has not been updated yet) would register a module
     nobody ever boots and fail SILENTLY, which is the failure mode core.js's
     audit() exists to catch. If the ctx is already there, we missed the
     train — get on anyway. */
  if (CBZ.warlordCtx && !OFF) {
    safe(function () { W.modules().feel.boot(CBZ.warlordCtx); });
  }
})();
