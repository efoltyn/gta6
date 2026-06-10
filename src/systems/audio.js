/* ============================================================
   systems/audio.js - local recorded-sample audio for every mode.

   Non-combat foley (steps, doors, impacts, UI) stays the BANK of
   decoded local CC0 recordings. GUNS and the CAR ENGINE were redone
   from scratch (the old gun voices were pitch-shifted re-uses of two
   recordings = toy pops; the old engine was a 3-saw drone = lawnmower).

   SAMPLE-FIRST: at init we try-load an optional manifest of dedicated
   recordings (assets/audio/guns/*.m4a + assets/audio/car/*.m4a). Every
   file is OPTIONAL — a missing file silently falls back, per-sound, to
   the synthesis below. A separate pipeline drops the files in; the code
   only knows the names.

   GUNSHOT SYNTHESIS V2 (the fallback voice): per shot we layer what a
   real report is made of —
     CRACK  2-4ms highpassed noise click           (the mechanical snap)
     BODY   noise through a bandpass whose center  (the blast itself —
            SWEEPS DOWN fast ~1.4kHz -> ~300Hz      the downward sweep is
            with an exponential decay)              what reads "gunshot")
     THUMP  a sine pitch-drop 150 -> 40Hz           (the chest hit)
     TAIL   0.4-1.4s of quiet lowpassed noise       (the city-canyon echo)
   Each gun class gets its own table (crack/body/thump/tail/jitter) so
   you can threat-read by ear: pistol=sharp+short, deagle=deeper thump,
   SMG=short body almost no tail (18rps must not smear), carbine=cracky
   high sweep, AK-47=deepest body+thump+longest tail, shotgun=DOUBLE
   body burst+biggest thump, sniper=max everything+pre-crack, LMG=AK
   body with a short tail. ALL gunfire (sample or synth) runs through
   one shared soft compressor bus so auto fire can't phase or clip.
   Distant fire (>60u) prefers guns/distant.m4a through the far-field
   muffle+slap-echo bus, so far gang wars read as ambience.

   CAR ENGINE V2 (CBZ.carAudio): when car/idle.m4a + car/rev.m4a are
   loaded, the motor is a TWO-LOOP CROSSFADER — both loops always
   running, playbackRate riding the revs (~±20%), an equal-power
   crossfade between them by RPM, plus a filtered-noise intake layer on
   throttle (how real racing games fake engines; works with any decent
   loop). Synth fallback is a PULSE-TRAIN engine: a pulse oscillator at
   the actual cylinder-firing rate (RPM/60 * cyl/2 Hz) shaped through
   two resonant bandpass formants (exhaust ~90-180Hz, body ~300-600Hz)
   + intake noise — combustion is PULSES, not tones, which is why this
   reads as an engine where the saw stack never did. Five flavors kept
   (sports=higher formants/faster response, truck=lower/slower, bike=
   single-cylinder thump at half rate). Gear-step pitch drops + the
   clutch-cut dip kept; update() signature + the 0.4s watchdog kept.
   Screech prefers car/screech.m4a (rate tracks slip); the synth
   fallback is gated to CHIRP at slip onset instead of droning.
   Ignition = car/start.m4a (synth starter-whirr fallback). Horn =
   car/horn.m4a (else a dual-tone 440+554Hz square — real horns are
   two notes) via sfx("horn").
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;

  const A = "assets/audio/";
  const K = A + "kenney/";
  const O = A + "oga/";
  const R = A + "rse/";
  const W = A + "web/"; // real recordings pulled from Wikimedia Commons (PD/CC), encoded m4a for iOS

  // ---- OPTIONAL dedicated gun/car recordings (the sample-first layer) ----
  // Every entry may 404 — loadSamples() swallows failures and the per-sound
  // code checks S(key) before falling back to synthesis. Never assume presence.
  const SAMPLES = {
    "gun.pistol":   A + "guns/pistol.m4a",
    "gun.smg":      A + "guns/smg.m4a",
    "gun.rifle":    A + "guns/rifle.m4a",     // carbine class
    "gun.ak47":     A + "guns/ak47.m4a",
    "gun.shotgun":  A + "guns/shotgun.m4a",
    "gun.sniper":   A + "guns/sniper.m4a",
    "gun.deagle":   A + "guns/deagle.m4a",
    "gun.lmg":      A + "guns/lmg.m4a",
    "gun.distant":  A + "guns/distant.m4a",   // far muffled gunfire (far-field bus)
    "gun.tail":     A + "guns/tail.m4a",      // urban gunshot echo tail
    "car.idle":     A + "car/idle.m4a",       // loopable engine idle
    "car.rev":      A + "car/rev.m4a",        // loopable mid-high RPM
    "car.start":    A + "car/start.m4a",      // ignition
    "car.screech":  A + "car/screech.m4a",    // tire squeal (loop)
    "car.horn":     A + "car/horn.m4a",
    "car.skid_stop": A + "car/skid_stop.m4a",
  };
  const samples = new Map(); // short key -> AudioBuffer (only successful loads)
  function S(key) { return samples.get(key) || null; }

  // Each effect can contain multiple recorded layers. Files within a layer
  // are variants; one is picked per play so repeated footsteps and hits vary.
  const BANK = {
    coin: fx([K + "handleCoins.m4a", K + "handleCoins2.m4a"], 0.42, 0.06),
    key: fx([O + "sfx100v2_lock_open_01.m4a", K + "metalClick.m4a"], 0.48, 0.06),
    loot: fx([K + "beltHandle1.m4a", K + "beltHandle2.m4a", K + "drop_001.m4a"], 0.52, 0.08),
    pickup: fx([K + "cloth1.m4a", K + "cloth2.m4a", K + "beltHandle1.m4a"], 0.42, 0.06),
    equip: fx([K + "clothBelt.m4a", K + "beltHandle2.m4a"], 0.45, 0.08),

    door: fx([O + "sfx100v2_door_01.m4a", O + "sfx100v2_door_03.m4a", K + "doorClose_1.m4a", K + "doorOpen_1.m4a"], 0.64, 0.1),
    clank: fx([O + "sfx100v2_metal_hit_01.m4a", K + "impactMetal_heavy_000.m4a", K + "impactMetal_heavy_001.m4a"], 0.54, 0.14),
    glass: fx([O + "sfx100v2_glass_03.m4a", O + "sfx100v2_glass_05.m4a", K + "impactGlass_heavy_000.m4a", K + "impactGlass_heavy_001.m4a"], 0.66, 0.08),
    alarm: fx([R + "alarm1.mp3", R + "alarm4.mp3"], 0.58, 0.48),
    siren: fx([W + "disaster_siren.m4a"], 0.62, 1.8),
    lockdown: fx([W + "lockdown_brief.m4a"], 0.6, 1.0),   // BRIEF jail-lockdown siren (one-shot, not a loop)

    step: fx([
      K + "footstep_concrete_000.m4a", K + "footstep_concrete_001.m4a",
      K + "footstep_concrete_002.m4a", K + "footstep_concrete_003.m4a",
      K + "footstep_concrete_004.m4a",
    ], 0.22, 0.045),
    // jumping is near-silent in reality — just a soft cloth/effort, NO arcade
    // whoosh (that cartoon swoosh was the "retarded" jump sound).
    jump: fx([K + "cloth1.m4a", K + "cloth2.m4a"], 0.2, 0.08),
    // fists: a REAL recorded punch + Kenney's real impact foley. Dropped the
    // cartoony rse "punch" pack and the synthy oga "hit" tones.
    punch: fx([
      W + "punch_real.m4a", K + "impactPunch_medium_000.m4a",
      K + "impactPunch_medium_001.m4a", K + "impactPunch_medium_002.m4a",
    ], 0.6, 0.045),
    hit: fx([W + "thud_real.m4a", K + "impactPunch_medium_000.m4a", K + "impactPunch_medium_002.m4a"], 0.46, 0.035),
    ko: layers([
      part([K + "impactPunch_heavy_000.m4a", K + "impactPunch_heavy_001.m4a", K + "impactPunch_heavy_002.m4a"], 0.8, 0.92, 1.04),
      part([W + "thud_real.m4a"], 0.42, 0.84, 0.96, 0.03),
    ], 0.09),
    whoosh: fx([O + "sfx100v2_air_02.m4a", O + "sfx100v2_air_03.m4a"], 0.4, 0.05),
    headshot: layers([
      part([K + "impactPunch_heavy_001.m4a", K + "impactPunch_heavy_002.m4a"], 0.66, 1.08, 1.18),
      part([O + "sfx100v2_misc_04.m4a", K + "impactMetal_light_001.m4a"], 0.26, 1.1, 1.24, 0.012),
    ], 0.07),

    // (gun voices moved OUT of the recording bank — see GUNS below; the taser
    // is the one "shoot_" that stays a recording: it's an electric zap, not
    // a ballistic report, and the resonance+click pair already reads right)
    shoot_taser: layers([
      part([R + "resonance2.mp3"], 0.5, 1.55, 1.75),
      part([R + "click6.mp3", R + "click7.mp3"], 0.34, 1.0, 1.12),
    ], 0.1),
    tase: layers([
      part([R + "resonance2.mp3"], 0.58, 1.32, 1.5),
      part([R + "click6.mp3", R + "click7.mp3"], 0.38, 0.94, 1.08),
    ], 0.12),
    empty: fx([R + "click3.mp3", R + "click4.mp3", K + "metalClick.m4a"], 0.36, 0.09),
    reload: layers([
      part([K + "metalLatch.m4a", K + "metalClick.m4a"], 0.52, 0.92, 1.06),
      part([K + "clothBelt.m4a", K + "beltHandle1.m4a"], 0.25, 0.94, 1.06, 0.08),
    ], 0.26),
    rack: fx([K + "metalLatch.m4a", O + "sfx100v2_metal_04.m4a", O + "sfx100v2_switch_02.m4a"], 0.5, 0.15),
    shell: fx([K + "impactMetal_light_000.m4a", K + "impactMetal_light_001.m4a", O + "sfx100v2_metal_03.m4a"], 0.28, 0.035),
    switch: layers([
      part([K + "switch_001.m4a", K + "switch_002.m4a", K + "switch_003.m4a"], 0.34, 0.96, 1.08),
      part([K + "cloth1.m4a", K + "cloth2.m4a"], 0.2, 0.98, 1.06),
    ], 0.12),
    win: fx([R + "jingle3.mp3", R + "chime1.mp3", R + "chime2.mp3"], 0.58, 0.5),

    thunder: fx([O + "sfx100v2_thunder_01.m4a"], 0.86, 0.8),
    rumble: fx([O + "sfx100v2_loop_machine_02.m4a", O + "sfx100v2_stones_01.m4a"], 0.58, 0.5),
    collapse: layers([
      part([R + "cannon1.mp3"], 0.62, 0.72, 0.86),
      part([O + "sfx100v2_stones_01.m4a", O + "sfx100v2_stones_02.m4a"], 0.6, 0.76, 0.92, 0.05),
    ], 0.25),
    explosion: layers([
      part([R + "cannon1.mp3"], 0.98, 0.82, 0.94),
      part([O + "sfx100v2_stones_03.m4a"], 0.5, 0.72, 0.86, 0.08),
    ], 0.18),
    water: fx([O + "sfx100v2_loop_water_02.m4a", O + "sfx100v2_loop_water_03.m4a", R + "splash1.mp3"], 0.52, 0.36),
    wind: fx([O + "sfx100v2_air_01.m4a", O + "sfx100v2_air_02.m4a", O + "sfx100v2_air_03.m4a"], 0.42, 0.26),
    fire: fx([O + "sfx100v2_misc_37.m4a", O + "sfx100v2_loop_ambient_03.m4a"], 0.38, 0.28),
  };

  // Looping beds. Per user direction: NO bullshit background drone / music.
  // The only loops are diegetic, real recordings tied to a game state.
  const LOOPS = {
    wanted_siren: { file: W + "police_siren.m4a", volume: 0.5 },
  };

  let ctx = null;
  let master = null;
  let sfxBus = null;
  let loopBus = null;
  const buffers = new Map();
  const loading = new Map();
  const failed = new Set();
  const last = new Map();
  const loopSlots = new Map();

  // tone = optional per-layer voicing: { hp, lp: filter cutoffs Hz,
  // bass: low-shelf dB at 240Hz, decay: clip the sample to this many seconds }.
  function part(files, volume, pitchMin, pitchMax, delay, tone) {
    return { files, volume, pitchMin: pitchMin || 0.96, pitchMax: pitchMax || 1.04, delay: delay || 0, tone: tone || null };
  }
  function layers(parts, cooldown) { return { parts, cooldown: cooldown || 0 }; }
  function fx(files, volume, cooldown) { return layers([part(files, volume)], cooldown); }
  function choose(a) { return a[(Math.random() * a.length) | 0]; }

  function decode(arrayBuffer) {
    return new Promise(function (resolve, reject) {
      const p = ctx.decodeAudioData(arrayBuffer, resolve, reject);
      if (p && typeof p.then === "function") p.then(resolve, reject);
    });
  }
  function load(file, attempt) {
    attempt = attempt || 0;
    if (buffers.has(file)) return Promise.resolve(buffers.get(file));
    if (loading.has(file)) return loading.get(file);
    const p = fetch(file).then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status + " loading " + file);
      return res.arrayBuffer();
    }).then(decode).then(function (buffer) {
      buffers.set(file, buffer);
      failed.delete(file);
      loading.delete(file);
      return buffer;
    }).catch(function (err) {
      loading.delete(file);
      if (attempt < 2) {
        return new Promise(function (resolve) {
          setTimeout(function () { resolve(load(file, attempt + 1)); }, 120 * (attempt + 1));
        });
      }
      failed.add(file);
      console.warn("[audio sample]", err.message || err);
      return null;
    });
    loading.set(file, p);
    return p;
  }
  function allFiles() {
    const files = [];
    Object.keys(BANK).forEach(function (name) {
      BANK[name].parts.forEach(function (p) { p.files.forEach(function (f) { if (files.indexOf(f) < 0) files.push(f); }); });
    });
    Object.keys(LOOPS).forEach(function (name) { const f = LOOPS[name].file; if (files.indexOf(f) < 0) files.push(f); });
    return files;
  }
  function preloadAll() { allFiles().forEach(load); }
  // The optional gun/car recordings: one quiet attempt each, no retries, no
  // failure bookkeeping — absence is an expected state, synthesis covers it.
  function loadSamples() {
    Object.keys(SAMPLES).forEach(function (key) {
      if (samples.has(key)) return;
      fetch(SAMPLES[key]).then(function (res) {
        if (!res.ok) throw new Error("missing");
        return res.arrayBuffer();
      }).then(decode).then(function (buffer) {
        if (buffer) samples.set(key, buffer);
      }).catch(function () { /* optional file — synth fallback owns this sound */ });
    });
  }

  function initAudio() {
    if (ctx) {
      if (ctx.state === "suspended") ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createDynamicsCompressor();
    master.threshold.value = -12;
    master.knee.value = 12;
    master.ratio.value = 5;
    master.attack.value = 0.003;
    master.release.value = 0.28;
    master.connect(ctx.destination);
    sfxBus = ctx.createGain(); sfxBus.gain.value = 0.84; sfxBus.connect(master);
    loopBus = ctx.createGain(); loopBus.gain.value = 0.72; loopBus.connect(master);
    preloadAll();
    loadSamples();
    updateWorldLoops();
  }

  // far-field gunfire bus, built ONCE (5 nodes shared by every distant shot):
  // lowpass = air swallows the highs, slap delay = the report bouncing off the
  // blocks between you and the fight. Distant gunfire becomes ambience you can
  // still threat-read by voice, instead of sounding like it's in your ear.
  let farIn = null;
  function ensureFarBus() {
    if (farIn || !ctx || !sfxBus) return;
    farIn = ctx.createGain(); farIn.gain.value = 0.8;
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 820; lp.Q.value = 0.4;
    farIn.connect(lp); lp.connect(sfxBus);
    const dl = ctx.createDelay(0.5); dl.delayTime.value = 0.17;
    const fb = ctx.createGain(); fb.gain.value = 0.32;
    const wet = ctx.createGain(); wet.gain.value = 0.5;
    farIn.connect(dl); dl.connect(fb); fb.connect(dl); dl.connect(wet); wet.connect(lp);
  }

  // ---- shared one-time DSP resources (lazy; never rebuilt) -----------------
  let _noiseBuf = null;
  function noiseBuf() {
    if (_noiseBuf) return _noiseBuf;
    const len = (ctx.sampleRate * 1.5) | 0;
    _noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = _noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return _noiseBuf;
  }
  // noise one-shot: random offset into the shared buffer so overlapping shots
  // never correlate (correlated noise layers = audible phasing on auto fire)
  function nsrc(t0, dur) {
    const s = ctx.createBufferSource();
    s.buffer = noiseBuf();
    s.loop = true;
    s.start(t0, Math.random() * 1.2);
    s.stop(t0 + dur);
    return s;
  }
  // generic one-shot sample player (guns, ignition, horn, skid-stop)
  function playSample(buffer, out, vol, rate, t0) {
    const src = ctx.createBufferSource();
    const gain = ctx.createGain();
    src.buffer = buffer;
    src.playbackRate.value = rate || 1;
    gain.gain.value = vol;
    src.connect(gain); gain.connect(out);
    src.start(t0 == null ? ctx.currentTime : t0);
    return src;
  }

  // ============================================================
  //  GUNSHOT ENGINE V2 (sample-first, layered synthesis fallback)
  // ============================================================
  // Per-class voice tables. Fields:
  //   sample = SAMPLES key (minus "gun.") tried first
  //   cd     = per-voice cooldown (must sit UNDER the gun's fire interval)
  //   jit    = random pitch jitter per shot (so bursts aren't machine-stamped)
  //   crack  = { g gain, hp highpass Hz, t decay s }      — the 2-4ms snap
  //   body   = { g, f0 -> f1 bandpass sweep over `sweep` s, t total decay, q }
  //   thump  = { g, f0 -> f1 sine drop over t }           — the chest hit
  //   tail   = { g, t }                                    — city-canyon noise
  //   dbl    = shotgun: second staggered body burst
  //   pre    = sniper: tiny pre-crack 14ms before the main report
  const GUNS = {
    shoot_pistol: { sample: "pistol", cd: 0.035, jit: 0.05, vol: 1,
      crack: { g: 0.85, hp: 3400, t: 0.02 },
      body: { g: 0.65, f0: 1500, f1: 400, sweep: 0.04, t: 0.08, q: 1.3 },
      thump: { g: 0.5, f0: 140, f1: 55, t: 0.08 },
      tail: { g: 0.07, t: 0.45 } },
    shoot_deagle: { sample: "deagle", cd: 0.07, jit: 0.05, vol: 1,
      crack: { g: 0.9, hp: 3200, t: 0.022 },
      body: { g: 0.75, f0: 1300, f1: 330, sweep: 0.05, t: 0.1, q: 1.3 },
      thump: { g: 0.9, f0: 165, f1: 42, t: 0.13 },
      tail: { g: 0.09, t: 0.6 } },
    shoot_smg: { sample: "smg", cd: 0.026, jit: 0.07, vol: 1,
      crack: { g: 0.75, hp: 3000, t: 0.018 },
      body: { g: 0.55, f0: 1600, f1: 480, sweep: 0.03, t: 0.05, q: 1.4 },
      thump: { g: 0.35, f0: 130, f1: 60, t: 0.055 },
      tail: { g: 0.03, t: 0.12 } },
    shoot_carbine: { sample: "rifle", cd: 0.04, jit: 0.05, vol: 1,
      crack: { g: 1.0, hp: 3800, t: 0.022 },
      body: { g: 0.6, f0: 1800, f1: 420, sweep: 0.045, t: 0.09, q: 1.5 },
      thump: { g: 0.45, f0: 135, f1: 52, t: 0.09 },
      tail: { g: 0.07, t: 0.55 } },
    shoot_ak47: { sample: "ak47", cd: 0.055, jit: 0.04, vol: 1,
      crack: { g: 0.8, hp: 2600, t: 0.025 },
      body: { g: 0.8, f0: 1000, f1: 240, sweep: 0.07, t: 0.16, q: 1.2 },
      thump: { g: 1.0, f0: 150, f1: 40, t: 0.14 },
      tail: { g: 0.11, t: 1.2 } },
    shoot_shotgun: { sample: "shotgun", cd: 0.12, jit: 0.04, vol: 1, dbl: true,
      crack: { g: 0.7, hp: 2400, t: 0.025 },
      body: { g: 0.9, f0: 900, f1: 220, sweep: 0.06, t: 0.14, q: 1.1 },
      thump: { g: 1.15, f0: 150, f1: 35, t: 0.16 },
      tail: { g: 0.13, t: 1.3 } },
    shoot_sniper: { sample: "sniper", cd: 0.3, jit: 0.03, vol: 1, pre: true,
      crack: { g: 1.1, hp: 3600, t: 0.025 },
      body: { g: 0.95, f0: 1400, f1: 260, sweep: 0.08, t: 0.18, q: 1.2 },
      thump: { g: 1.1, f0: 160, f1: 38, t: 0.16 },
      tail: { g: 0.14, t: 1.4 } },
    shoot_lmg: { sample: "lmg", cd: 0.04, jit: 0.06, vol: 1,
      crack: { g: 0.8, hp: 2700, t: 0.022 },
      body: { g: 0.78, f0: 1050, f1: 260, sweep: 0.06, t: 0.13, q: 1.2 },
      thump: { g: 0.85, f0: 145, f1: 44, t: 0.11 },
      tail: { g: 0.06, t: 0.4 } },
    // generic incoming crack for unknown shooters — a quieter, looser pistol
    report: { sample: "pistol", cd: 0.05, jit: 0.1, vol: 0.78,
      crack: { g: 0.8, hp: 3300, t: 0.02 },
      body: { g: 0.6, f0: 1450, f1: 390, sweep: 0.04, t: 0.08, q: 1.3 },
      thump: { g: 0.45, f0: 138, f1: 55, t: 0.08 },
      tail: { g: 0.06, t: 0.4 } },
  };
  GUNS.shoot = GUNS.shoot_pistol; // bare sfx("shoot") = sidearm default

  // every shot — recorded or synthesized, every gun, NPC or player — passes
  // through ONE soft compressor so sustained auto fire stacks without clipping
  let gunIn = null;
  function ensureGunBus() {
    if (gunIn || !ctx || !sfxBus) return;
    gunIn = ctx.createGain(); gunIn.gain.value = 0.6;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 10;
    comp.ratio.value = 6;
    comp.attack.value = 0.002;
    comp.release.value = 0.12;
    gunIn.connect(comp); comp.connect(sfxBus);
  }

  // INDOOR HOOK: interiors can call CBZ.setGunIndoor(true) to choke the echo
  // tail (a hallway doesn't ring like a street canyon). Synth tails only.
  let gunTailScale = 1;

  function gunCrack(t0, out, c, vol, j) {
    const s = nsrc(t0, c.t + 0.02);
    const f = ctx.createBiquadFilter(); f.type = "highpass"; f.frequency.value = c.hp * j;
    const gn = ctx.createGain();
    gn.gain.setValueAtTime(c.g * vol, t0);
    gn.gain.linearRampToValueAtTime(0.0001, t0 + c.t);
    s.connect(f); f.connect(gn); gn.connect(out);
    return s;
  }
  function gunBody(t0, out, b, vol, j, f0Mul, gMul) {
    const s = nsrc(t0, b.t + 0.03);
    const f = ctx.createBiquadFilter(); f.type = "bandpass"; f.Q.value = b.q;
    f.frequency.setValueAtTime(b.f0 * j * f0Mul, t0);
    // THE gunshot signature: the blast center falls fast — sweep, not static
    f.frequency.exponentialRampToValueAtTime(Math.max(60, b.f1 * j * f0Mul), t0 + b.sweep);
    const gn = ctx.createGain();
    gn.gain.setValueAtTime(0.0001, t0);
    gn.gain.linearRampToValueAtTime(b.g * vol * gMul, t0 + 0.005);
    gn.gain.exponentialRampToValueAtTime(0.0001, t0 + b.t);
    s.connect(f); f.connect(gn); gn.connect(out);
  }
  function gunThump(t0, out, th, vol, j) {
    const o = ctx.createOscillator(); o.type = "sine";
    o.frequency.setValueAtTime(th.f0 * j, t0);
    o.frequency.exponentialRampToValueAtTime(Math.max(28, th.f1 * j), t0 + th.t);
    const gn = ctx.createGain();
    gn.gain.setValueAtTime(0.0001, t0);
    gn.gain.linearRampToValueAtTime(th.g * vol, t0 + 0.004);
    gn.gain.exponentialRampToValueAtTime(0.0001, t0 + th.t * 1.35);
    o.connect(gn); gn.connect(out);
    o.start(t0); o.stop(t0 + th.t * 1.35 + 0.05);
  }
  function gunTailNoise(t0, out, dur, gain) {
    const s = nsrc(t0 + 0.01, dur + 0.05);
    const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 900; f.Q.value = 0.5;
    const gn = ctx.createGain();
    gn.gain.setValueAtTime(0.0001, t0);
    gn.gain.linearRampToValueAtTime(gain, t0 + 0.03);
    gn.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(f); f.connect(gn); gn.connect(out);
  }
  function synthShot(g, t0, out, vol, j, far) {
    let first = null;
    const tm = g.pre ? t0 + 0.014 : t0; // sniper: main report lands after the pre-crack
    if (g.pre) first = gunCrack(t0, out, { g: 0.5, hp: 4200, t: 0.012 }, vol, j);
    const c = gunCrack(tm, out, g.crack, vol, j);
    if (!first) first = c;
    gunBody(tm, out, g.body, vol, j, 1, 1);
    if (g.dbl) gunBody(tm + 0.028, out, g.body, vol, j, 0.75, 0.8); // shotgun's second barrel-burst
    gunThump(tm, out, g.thump, vol, j);
    const tl = g.tail.t * gunTailScale;
    if (tl > 0.05) {
      const tb = !far && tl > 0.3 ? S("gun.tail") : null; // recorded urban echo when we have it
      if (tb) playSample(tb, out, g.tail.g * vol * 2.2, j * (0.95 + Math.random() * 0.1), tm + 0.015);
      else gunTailNoise(tm, out, tl, g.tail.g * vol);
    }
    return first;
  }
  function playGun(name, g, opts) {
    ensureGunBus();
    const t0 = ctx.currentTime + (opts.delay || 0);
    const vol = g.vol * (opts.volume == null ? 1 : opts.volume);
    // opts.pitch keeps the old weapon-data sfxPitch contract; jit is per-shot
    const j = (opts.pitch || 1) * (1 + (Math.random() * 2 - 1) * g.jit);
    const far = !!(opts.far && farIn);
    const out = far ? farIn : gunIn;
    if (far) {
      // far fire prefers the dedicated distant-gunfire recording through the
      // muffle+echo bus; missing file = the synth voice takes the same path
      const db = S("gun.distant");
      if (db) return playSample(db, out, vol, j * (0.92 + Math.random() * 0.16), t0);
    } else {
      const sb = S("gun." + g.sample);
      if (sb) return playSample(sb, out, vol, j, t0);
    }
    return synthShot(g, t0, out, vol, j, far);
  }

  // ============================================================
  //  CAR ENGINE V2 + TYRE SCREECH (CBZ.carAudio)
  //  city/vehicles.js feeds update(rev, throttle, skid, flavor, shifted)
  //  every driven frame. One persistent rig (built on enter, torn down on
  //  exit/watchdog) — never per-frame node churn.
  //  Two builds, chosen at key-on by what loaded:
  //   sample = idle+rev loop crossfader (see header)  |  synth = pulse-train
  // ============================================================
  // Per-flavor voicing:
  //   idleRPM/maxRPM = the rev band rev∈[0..1.15] maps onto
  //   cyl   = cylinders; synth firing rate = RPM/60 * cyl/2 (4-stroke).
  //           bike cyl=1 -> the half-rate single-cylinder potato-potato
  //   ex/body = exhaust + body formant centers (Hz); q1/q2 their resonance
  //   resp  = response time-constant (sports snaps, truck lumbers)
  //   rate  = sample-mode base playbackRate (bike spins the loops up,
  //           truck drags them down — one pair of loops, five motors)
  //   intake= throttle-gated filtered-noise level; vol = presence
  const ENGINES = {
    sports: { idleRPM: 950, maxRPM: 8400, cyl: 8, vol: 0.26, ex: 165, body: 560, q1: 3.2, q2: 2.4, resp: 0.035, rate: 1.16, intake: 0.5 },
    muscle: { idleRPM: 720, maxRPM: 6200, cyl: 8, vol: 0.32, ex: 105, body: 360, q1: 3.6, q2: 2.2, resp: 0.06, rate: 0.92, intake: 0.4 },
    sedan:  { idleRPM: 820, maxRPM: 6000, cyl: 4, vol: 0.2, ex: 130, body: 430, q1: 3.0, q2: 2.0, resp: 0.05, rate: 1.0, intake: 0.35 },
    truck:  { idleRPM: 620, maxRPM: 4200, cyl: 8, vol: 0.32, ex: 88, body: 300, q1: 3.8, q2: 2.2, resp: 0.085, rate: 0.8, intake: 0.45 },
    bike:   { idleRPM: 1150, maxRPM: 9800, cyl: 1, vol: 0.24, ex: 175, body: 600, q1: 3.0, q2: 2.0, resp: 0.03, rate: 1.34, intake: 0.55 },
  };
  // pulse-train waveshaper curve, built once: a saw in, a ~9%-duty pulse out
  // (mostly -0.1 so the cycle is near zero-mean -> no DC thud into the filters)
  let _pulseCurve = null;
  function pulseCurve() {
    if (_pulseCurve) return _pulseCurve;
    const N = 2048;
    _pulseCurve = new Float32Array(N);
    for (let i = 0; i < N; i++) _pulseCurve[i] = i / (N - 1) > 0.91 ? 1 : -0.1;
    return _pulseCurve;
  }
  let eng = null, engFed = 0, engFlavorKey = "";
  function ignition(t) {
    const sb = S("car.start");
    if (sb) { playSample(sb, loopBus, 0.5, 0.96 + Math.random() * 0.08, t); return; }
    // fallback: a brief starter-motor whirr — a fluttering saw cranking up
    const o = ctx.createOscillator(); o.type = "sawtooth";
    o.frequency.setValueAtTime(55, t);
    o.frequency.linearRampToValueAtTime(95, t + 0.38);
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 420;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.13, t + 0.05);
    g.gain.setTargetAtTime(0.0001, t + 0.34, 0.05);
    const lfo = ctx.createOscillator(); lfo.frequency.value = 13;
    const lg = ctx.createGain(); lg.gain.value = 0.055;
    lfo.connect(lg); lg.connect(g.gain);
    o.connect(lp); lp.connect(g); g.connect(loopBus);
    o.start(t); lfo.start(t); o.stop(t + 0.5); lfo.stop(t + 0.5);
  }
  function engineStart() {
    if (eng || !ctx || !loopBus || !sfxBus) return;
    const e = { stops: [] };
    e.gain = ctx.createGain(); e.gain.gain.value = 0.0001; e.gain.connect(loopBus);
    e.mix = ctx.createGain(); e.mix.gain.value = 1; e.mix.connect(e.gain);
    const idleB = S("car.idle"), revB = S("car.rev");
    if (idleB && revB) {
      // ---- TWO-LOOP CROSSFADER: both loops always run; RPM rides the rates
      //      and the equal-power mix — the racing-game trick ----
      e.kind = "sample";
      e.gIdle = ctx.createGain(); e.gIdle.gain.value = 0.0001; e.gIdle.connect(e.mix);
      e.srcIdle = ctx.createBufferSource(); e.srcIdle.buffer = idleB; e.srcIdle.loop = true; e.srcIdle.connect(e.gIdle); e.srcIdle.start();
      e.gRev = ctx.createGain(); e.gRev.gain.value = 0.0001; e.gRev.connect(e.mix);
      e.srcRev = ctx.createBufferSource(); e.srcRev.buffer = revB; e.srcRev.loop = true; e.srcRev.connect(e.gRev); e.srcRev.start();
      e.stops.push(e.srcIdle, e.srcRev);
    } else {
      // ---- PULSE-TRAIN: saw at the cylinder-firing rate -> pulse shaper ->
      //      exhaust + body formants + a lowpassed fundamental for weight ----
      e.kind = "synth";
      e.osc = ctx.createOscillator(); e.osc.type = "sawtooth"; e.osc.frequency.value = 55;
      e.shaper = ctx.createWaveShaper(); e.shaper.curve = pulseCurve(); e.shaper.oversample = "2x";
      e.osc.connect(e.shaper);
      e.f1 = ctx.createBiquadFilter(); e.f1.type = "bandpass"; e.f1.frequency.value = 120; e.f1.Q.value = 3.2;
      e.g1 = ctx.createGain(); e.g1.gain.value = 0.9;
      e.shaper.connect(e.f1); e.f1.connect(e.g1); e.g1.connect(e.mix);
      e.f2 = ctx.createBiquadFilter(); e.f2.type = "bandpass"; e.f2.frequency.value = 420; e.f2.Q.value = 2.2;
      e.g2 = ctx.createGain(); e.g2.gain.value = 0.55;
      e.shaper.connect(e.f2); e.f2.connect(e.g2); e.g2.connect(e.mix);
      e.fLo = ctx.createBiquadFilter(); e.fLo.type = "lowpass"; e.fLo.frequency.value = 140;
      e.gLo = ctx.createGain(); e.gLo.gain.value = 0.8;
      e.shaper.connect(e.fLo); e.fLo.connect(e.gLo); e.gLo.connect(e.mix);
      e.osc.start();
      e.stops.push(e.osc);
    }
    // intake hiss: throttle-gated filtered noise — both builds breathe
    e.nz = ctx.createBufferSource(); e.nz.buffer = noiseBuf(); e.nz.loop = true;
    e.nbp = ctx.createBiquadFilter(); e.nbp.type = "bandpass"; e.nbp.frequency.value = 950; e.nbp.Q.value = 0.7;
    e.ng = ctx.createGain(); e.ng.gain.value = 0.0001;
    e.nz.connect(e.nbp); e.nbp.connect(e.ng); e.ng.connect(e.mix);
    e.nz.start();
    e.stops.push(e.nz);
    // tyre screech
    e.skGain = ctx.createGain(); e.skGain.gain.value = 0.0001; e.skGain.connect(sfxBus);
    const scrB = S("car.screech");
    if (scrB) {
      e.skKind = "sample";
      e.skSrc = ctx.createBufferSource(); e.skSrc.buffer = scrB; e.skSrc.loop = true;
      e.skSrc.connect(e.skGain); e.skSrc.start();
      e.stops.push(e.skSrc);
    } else {
      // synth fallback: vibrato saw through a NARROW bandpass, gated so it
      // CHIRPS at slip onset (see engineUpdate) instead of droning
      e.skKind = "synth";
      e.skBp = ctx.createBiquadFilter(); e.skBp.type = "bandpass"; e.skBp.frequency.value = 1500; e.skBp.Q.value = 8;
      e.skBp.connect(e.skGain);
      e.skOsc = ctx.createOscillator(); e.skOsc.type = "sawtooth"; e.skOsc.frequency.value = 1250; e.skOsc.connect(e.skBp);
      e.skLfoGain = ctx.createGain(); e.skLfoGain.gain.value = 90; e.skLfoGain.connect(e.skOsc.frequency);
      e.skLfo = ctx.createOscillator(); e.skLfo.type = "sine"; e.skLfo.frequency.value = 31; e.skLfo.connect(e.skLfoGain);
      e.skOsc.start(); e.skLfo.start();
      e.stops.push(e.skOsc, e.skLfo);
    }
    e.skPrev = 0; e.skChirpAt = 0; e.skidStopAt = 0;
    ignition(ctx.currentTime);
    engFed = performance.now() * 0.001;
    engFlavorKey = "";
    eng = e;
  }
  function engineStop() {
    if (!eng) return;
    const e = eng; eng = null;
    if (!ctx) return;
    const t = ctx.currentTime;
    try {
      e.gain.gain.cancelScheduledValues(t);
      e.gain.gain.setTargetAtTime(0.0001, t, 0.07);          // key-off, not a click
      e.skGain.gain.cancelScheduledValues(t);
      e.skGain.gain.setTargetAtTime(0.0001, t, 0.04);
      e.stops.forEach(function (o) { o.stop(t + 0.45); });   // everything dies with the rig
    } catch (err) {}
  }
  function engineUpdate(rev, throttle, skid, flavor, shifted) {
    if (!ctx || ctx.state === "suspended") return;
    if (!eng) engineStart();                                  // first frame at the wheel
    if (!eng) return;
    engFed = performance.now() * 0.001;
    const F = ENGINES[flavor] || ENGINES.sedan;
    const e = eng, t = ctx.currentTime;
    if (flavor !== engFlavorKey) {                            // retune static voicing once per car class
      engFlavorKey = flavor;
      if (e.kind === "synth") { e.f1.Q.value = F.q1; e.f2.Q.value = F.q2; }
    }
    rev = Math.max(0, Math.min(1.15, rev || 0));
    if (e.kind === "sample") {
      // equal-power crossfade idle<->rev + both loops' rates riding the revs
      const x = Math.min(1, rev) * Math.PI * 0.5;
      e.gIdle.gain.setTargetAtTime(Math.cos(x), t, F.resp);
      e.gRev.gain.setTargetAtTime(Math.sin(x), t, F.resp);
      e.srcIdle.playbackRate.setTargetAtTime(F.rate * (0.82 + rev * 0.38 + (throttle ? 0.03 : 0)), t, F.resp);
      e.srcRev.playbackRate.setTargetAtTime(F.rate * (0.8 + rev * 0.4 + (throttle ? 0.05 : 0)), t, F.resp);
    } else {
      // cylinder firing rate: RPM/60 * cyl/2 (4-stroke). The gear-step rev
      // DROP must read as a snap, so the rate constant is clamped tight.
      const rpm = F.idleRPM + rev * (F.maxRPM - F.idleRPM);
      e.osc.frequency.setTargetAtTime((rpm / 60) * F.cyl * 0.5, t, Math.min(F.resp, 0.05));
      e.f1.frequency.setTargetAtTime(F.ex * (1 + rev * 0.45), t, 0.07);
      e.f2.frequency.setTargetAtTime(F.body * (1 + rev * 0.55) + (throttle ? 120 : 0), t, 0.07);
    }
    e.ng.gain.setTargetAtTime((throttle ? 1 : 0) * F.intake * (0.35 + rev * 0.65), t, 0.06);
    const vol = F.vol * (0.4 + rev * 0.34 + (throttle ? 0.28 : 0));
    if (shifted) {
      // the gear change: a momentary throttle-cut dip while the "clutch" is in
      e.gain.gain.cancelScheduledValues(t);
      e.gain.gain.setTargetAtTime(vol * 0.3, t, 0.015);
      e.gain.gain.setTargetAtTime(vol, t + 0.08, 0.05);
    } else e.gain.gain.setTargetAtTime(vol, t, 0.07);
    // ---- tyre screech ----
    skid = Math.max(0, Math.min(1, skid || 0));
    if (e.skKind === "sample") {
      e.skGain.gain.setTargetAtTime(skid * skid * 0.55, t, skid > 0.05 ? 0.03 : 0.09);
      e.skSrc.playbackRate.setTargetAtTime(0.9 + skid * 0.35, t, 0.06);
    } else {
      // CHIRP, don't drone: a burst at slip onset, occasional re-chirps under
      // a sustained slide, and only a faint bed in between
      const onset = skid >= 0.14 && e.skPrev < 0.14;
      const rechirp = skid > 0.3 && engFed > e.skChirpAt + 0.42 && Math.random() < 0.25;
      if (onset || rechirp) {
        e.skChirpAt = engFed;
        e.skBp.frequency.setValueAtTime(1400 + Math.random() * 500 + skid * 300, t);
        e.skGain.gain.cancelScheduledValues(t);
        e.skGain.gain.setValueAtTime(Math.max(0.0001, e.skGain.gain.value), t);
        e.skGain.gain.linearRampToValueAtTime(0.1 + skid * 0.3, t + 0.03);
        e.skGain.gain.setTargetAtTime(skid * skid * 0.05, t + 0.1, 0.09);
      } else {
        e.skGain.gain.setTargetAtTime(skid * skid * 0.05, t, 0.12);
      }
      if (skid > 0.05) e.skOsc.frequency.setTargetAtTime(1250 + skid * 420, t, 0.07);
    }
    // slide released hard -> the recorded "skid to a stop" cap (if we have it)
    if (e.skPrev > 0.45 && skid < 0.1 && engFed > e.skidStopAt + 1.2) {
      e.skidStopAt = engFed;
      const b = S("car.skid_stop");
      if (b) playSample(b, sfxBus, 0.4, 0.96 + Math.random() * 0.08, t);
    }
    e.skPrev = skid;
  }

  // ---- HORN: car/horn.m4a, else the two-note synth (real horns are 2 notes)
  function playHorn(opts) {
    const t0 = ctx.currentTime + (opts.delay || 0);
    const vol = opts.volume == null ? 1 : opts.volume; // dist attenuation already applied by sfx()
    const out = opts.far && farIn ? farIn : sfxBus;
    const hb = S("car.horn");
    if (hb) return playSample(hb, out, 0.55 * vol, 0.94 + Math.random() * 0.12, t0);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(0.2 * vol, t0 + 0.02);
    g.gain.setValueAtTime(0.2 * vol, t0 + 0.34);
    g.gain.linearRampToValueAtTime(0.0001, t0 + 0.44);
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 1400;
    lp.connect(g); g.connect(out);
    const det = 0.97 + Math.random() * 0.06; // every car's horn is a touch off
    const o1 = ctx.createOscillator(); o1.type = "square"; o1.frequency.value = 440 * det;
    const o2 = ctx.createOscillator(); o2.type = "square"; o2.frequency.value = 554 * det;
    o1.connect(lp); o2.connect(lp);
    o1.start(t0); o2.start(t0); o1.stop(t0 + 0.5); o2.stop(t0 + 0.5);
    return o1;
  }

  function playLoaded(file, buffer, p, opts) {
    const src = ctx.createBufferSource();
    const gain = ctx.createGain();
    src.buffer = buffer;
    src.playbackRate.value = opts.pitch || (p.pitchMin + Math.random() * (p.pitchMax - p.pitchMin));
    // optional voicing chain (1-2 biquads only on parts that ask for them)
    let head = src;
    const tone = p.tone;
    if (tone) {
      if (tone.hp) { const f = ctx.createBiquadFilter(); f.type = "highpass"; f.frequency.value = tone.hp; head.connect(f); head = f; }
      if (tone.lp) { const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = tone.lp; head.connect(f); head = f; }
      if (tone.bass) { const f = ctx.createBiquadFilter(); f.type = "lowshelf"; f.frequency.value = 240; f.gain.value = tone.bass; head.connect(f); head = f; }
    }
    const v = p.volume * (opts.volume == null ? 1 : opts.volume);
    gain.gain.value = v;
    head.connect(gain);
    gain.connect(opts.far && farIn ? farIn : sfxBus);
    const t0 = ctx.currentTime + (opts.delay || 0) + p.delay;
    if (tone && tone.decay) {
      // clipped decay: ramp to silence and stop the source — a crack, not a wash
      gain.gain.setValueAtTime(Math.max(0.0001, v), t0);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + tone.decay);
      src.start(t0); src.stop(t0 + tone.decay + 0.05);
    } else src.start(t0);
    return src;
  }
  function playPart(p, opts) {
    const file = choose(p.files);
    const buffer = buffers.get(file);
    if (!buffer) {
      load(file).then(function (ready) { if (ready && ctx) playLoaded(file, ready, p, opts); });
      return null;
    }
    return playLoaded(file, buffer, p, opts);
  }

  const FAR_DIST = 60; // beyond this, gunfire goes through the muffle+echo bus

  function sfx(name, opts) {
    if (!ctx || !sfxBus) return null;
    if (ctx.state === "suspended") ctx.resume();
    const gun = GUNS[name] || null;
    const horn = name === "horn";
    const entry = gun || horn ? null : BANK[name];
    if (!gun && !horn && !entry) { console.warn("[audio] unmapped sfx:", name); return null; }
    opts = opts || {};
    // opts.dist (world units from the player): attenuate with range, and past
    // FAR_DIST swap to the muffled far-field voice — distance IS information.
    if (opts.dist != null) {
      const d = opts.dist;
      const att = d <= 16 ? 1 : Math.max(0.12, 1 - (d - 16) / 150);
      opts.volume = (opts.volume == null ? 1 : opts.volume) * att;
      if (d > FAR_DIST) { ensureFarBus(); opts.far = true; }
    }
    const now = performance.now() * 0.001;
    const prev = last.get(name) || -1e9;
    const cd = gun ? gun.cd : horn ? 0.15 : entry.cooldown;
    if (!opts.force && now - prev < cd) return null;
    // opts.ghost: play without stamping the cooldown — NPC fire must never
    // starve the player's own muzzle report out of the channel.
    if (!opts.ghost) last.set(name, now);
    if (gun) return playGun(name, gun, opts);
    if (horn) return playHorn(opts);
    let first = null;
    entry.parts.forEach(function (p) { const src = playPart(p, opts); if (!first) first = src; });
    return first;
  }

  // ---- per-weapon voice for NPC/remote gunfire ------------------------------
  // CBZ.gunVoice(weaponName, dist): plays the right gun voice for whatever the
  // shooter is actually holding (names are the loose actor strings — "Pistol",
  // "AK-47", "smg" — so match by substring). WHY: incoming fire you can classify
  // by EAR is a survival read — an AK bark says "armored money", a pistol crack
  // says "street beef". Slightly quieter than your own muzzle so it reads as
  // incoming, gated on its own cooldown map so a 10-man firefight can't spam.
  function voiceFor(weapon) {
    const w = String(weapon || "").toLowerCase();
    if (w.indexOf("ak") >= 0 || w.indexOf("762") >= 0) return "shoot_ak47";
    if (w.indexOf("shotgun") >= 0 || w.indexOf("12g") >= 0 || w.indexOf("pump") >= 0) return "shoot_shotgun";
    if (w.indexOf("smg") >= 0 || w.indexOf("uzi") >= 0 || w.indexOf("mac1") >= 0 || w.indexOf("mac-1") >= 0) return "shoot_smg";
    if (w.indexOf("sniper") >= 0 || w.indexOf("awp") >= 0 || w.indexOf("50cal") >= 0) return "shoot_sniper";
    if (w.indexOf("lmg") >= 0 || w.indexOf("m249") >= 0 || w.indexOf("minigun") >= 0) return "shoot_lmg";
    if (w.indexOf("deagle") >= 0 || w.indexOf("desert") >= 0 || w.indexOf("magnum") >= 0 || w.indexOf("revolver") >= 0) return "shoot_deagle";
    if (w.indexOf("carbine") >= 0 || w.indexOf("rifle") >= 0 || w.indexOf("m4") >= 0 || w.indexOf("556") >= 0) return "shoot_carbine";
    if (w.indexOf("taser") >= 0) return "shoot_taser";
    if (w.indexOf("rpg") >= 0 || w.indexOf("bazooka") >= 0 || w.indexOf("rocket") >= 0) return "explosion";
    if (w.indexOf("pistol") >= 0 || w.indexOf("sidearm") >= 0 || w.indexOf("9mm") >= 0 || w.indexOf("gun") >= 0) return "shoot_pistol";
    return "report"; // unknown/empty hands-with-a-gun: the generic incoming crack
  }
  const npcLast = new Map();
  const npcOpts = { force: true, ghost: true, volume: 1, dist: null, far: false }; // reused: no per-shot allocation
  function gunVoice(weapon, dist) {
    if (!ctx || !sfxBus) return null;
    const name = voiceFor(weapon);
    const gun = GUNS[name];
    const entry = gun || BANK[name];
    if (!entry) return null;
    const now = performance.now() * 0.001;
    const prev = npcLast.get(name) || -1e9;
    if (now - prev < Math.max(gun ? gun.cd : entry.cooldown, 0.07)) return null;
    npcLast.set(name, now);
    npcOpts.volume = 0.72;
    npcOpts.dist = dist == null ? null : dist;
    npcOpts.far = false;
    return sfx(name, npcOpts);
  }

  function slot(name) {
    let s = loopSlots.get(name);
    if (!s) { s = { desired: null, key: null, source: null, gain: null }; loopSlots.set(name, s); }
    return s;
  }
  function stopAudioLoop(name, fade, keepDesired) {
    const s = slot(name);
    if (!keepDesired) s.desired = null;
    if (!s.source) { s.key = null; return; }
    const source = s.source, gain = s.gain;
    s.source = null; s.gain = null; s.key = null;
    const t = ctx ? ctx.currentTime : 0;
    const f = fade == null ? 0.35 : fade;
    try {
      gain.gain.cancelScheduledValues(t);
      gain.gain.setValueAtTime(Math.max(0.0001, gain.gain.value), t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + f);
      source.stop(t + f + 0.03);
    } catch (e) {}
  }
  function setAudioLoop(name, key, volume, rate) {
    if (!ctx || !loopBus || !LOOPS[key]) return;
    const s = slot(name), cfg = LOOPS[key];
    s.desired = key;
    if (s.source && s.key === key) {
      const t = ctx.currentTime;
      s.gain.gain.setTargetAtTime(volume == null ? cfg.volume : volume, t, 0.18);
      s.source.playbackRate.setTargetAtTime(rate || 1, t, 0.12);
      return;
    }
    stopAudioLoop(name, 0.3, true);
    load(cfg.file).then(function (buffer) {
      if (!buffer || s.desired !== key || s.source || !ctx) return;
      const src = ctx.createBufferSource(), gain = ctx.createGain();
      src.buffer = buffer; src.loop = true; src.playbackRate.value = rate || 1;
      gain.gain.value = 0.0001;
      src.connect(gain); gain.connect(loopBus); src.start();
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume == null ? cfg.volume : volume), ctx.currentTime + 0.45);
      s.key = key; s.source = src; s.gain = gain;
    });
  }

  function updateWorldLoops() {
    if (!ctx) return;
    const g = CBZ.game || {};
    const playing = g.state === "playing";
    if (!playing) {
      engineStop();
      stopAudioLoop("wanted");
      return;
    }
    // NO background bed/music — only diegetic, real loops tied to game state.
    // ENGINE VOICE watchdog: city/vehicles.js feeds carAudio.update() every
    // driven frame. If the feed stops for any reason (left the car, died,
    // busted, a mode switch ate the exit hook) the motor must not drone on.
    if (eng && performance.now() * 0.001 - engFed > 0.4) engineStop();
  }

  CBZ.initAudio = initAudio;
  CBZ.sfx = sfx;
  // your car's voice: start on enter, update every driven frame, stop on exit
  CBZ.carAudio = { start: engineStart, stop: engineStop, update: engineUpdate };
  CBZ.gunVoice = gunVoice;
  CBZ.gunVoiceName = voiceFor; // weapon name -> bank voice, for player-fired call sites (full volume via CBZ.sfx)
  CBZ.setGunIndoor = function (v) { gunTailScale = v ? 0.35 : 1; }; // interiors choke the echo tail
  CBZ.getAudioCtx = function () { return ctx; };
  CBZ.setAudioLoop = setAudioLoop;
  CBZ.stopAudioLoop = stopAudioLoop;
  CBZ.audioManifest = { effects: BANK, loops: LOOPS, guns: GUNS, samples: SAMPLES };
  CBZ.audioStatus = function () {
    return {
      loaded: buffers.size, loading: loading.size, failed: Array.from(failed),
      total: allFiles().length, loops: loopSlots.size,
      samples: samples.size, samplesTotal: Object.keys(SAMPLES).length,
      engine: eng ? eng.kind : null,
    };
  };

  if (CBZ.onAlways) CBZ.onAlways(86, updateWorldLoops);
})();
