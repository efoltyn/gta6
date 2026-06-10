/* ============================================================
   systems/audio.js - local recorded-sample audio for every mode.

   The old version synthesized every effect from oscillators and
   generated noise. This keeps the small CBZ.sfx(name) API, but all
   audible output now comes from decoded local CC0 audio files.

   GUN VOICES: every class of gun has its own voice built from the
   same recordings (pitch/filter/decay layers — zero new files), so
   you can read a threat with your eyes closed: pistol = sharp crack,
   SMG = snappy ratatat, carbine = tight supersonic snap, AK-47 =
   deep heavy 7.62 bark (it's the status rifle — it must SOUND like
   money), shotgun = chest-thump boom with a rolling tail. Gunfire
   that's far away (>60u) routes through one shared muffle+slap-echo
   bus so distant gang wars read as city ambience, not as "incoming".

   ENGINE VOICE (CBZ.carAudio): the ONE deliberately-synthesized sound
   left — the player's own motor. WHY: a recording can't follow a
   throttle. Three cheap oscillators (saw fundamental + half-freq
   square thump + detuned saw shimmer through one lowpass) CAN: pitch
   rides the revs, gear-steps snap, the throttle opens the filter, and
   a sports car / truck / bike each get their own crank pitch. Plus a
   vibrato'd bandpass squeal for tyre screech under slides. Driven
   per-frame by city/vehicles.js; player-car only, watchdogged so it
   can never drone after you leave the wheel.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;

  const A = "assets/audio/";
  const K = A + "kenney/";
  const O = A + "oga/";
  const R = A + "rse/";
  const F = A + "firearms/";
  const W = A + "web/"; // real recordings pulled from Wikimedia Commons (PD/CC), encoded m4a for iOS

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
    // NPC/cop GUNFIRE. Was wired to UI click samples (switch/click) — that tinny
    // "ding" was the xylophone/bell heard every firefight. Now a real pistol crack,
    // a touch quieter + wider-pitched than the player's so it reads as "incoming".
    report: fx([F + "pistol-1.m4a", F + "pistol-2.m4a", F + "pistol-3.m4a"], 0.52, 0.07),

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

    // ---- gun voices: one recognizable voice per gun class (see header) ----
    shoot: fx([F + "pistol-1.m4a", F + "pistol-2.m4a", F + "pistol-3.m4a"], 0.78, 0.035),
    // pistol: SHARP CRACK — high-passed + clipped decay so it bites and stops dead.
    shoot_pistol: layers([
      part([F + "pistol-1.m4a", F + "pistol-2.m4a", F + "pistol-3.m4a"], 0.84, 1.02, 1.1, 0, { hp: 300, decay: 0.22 }),
    ], 0.035),
    // shotgun: CHEST-THUMP BOOM — full blast + a lowpassed thunder roll under it
    // (the long tail is what says "12 gauge" from a block away).
    shoot_shotgun: layers([
      part([F + "shotgun-1.m4a", F + "shotgun-2.m4a"], 1.0, 0.94, 1.0),
      part([O + "sfx100v2_thunder_01.m4a"], 0.3, 1.18, 1.32, 0.015, { lp: 400 }),
    ], 0.12),
    // carbine: TIGHT SUPERSONIC SNAP — clean body + a thin pitched-up crack layer
    // (the 5.56 "snap" overhead that the heavier guns don't have).
    shoot_carbine: layers([
      part([F + "carbine-1.m4a", F + "carbine-2.m4a"], 0.78, 0.98, 1.06),
      part([F + "pistol-2.m4a"], 0.22, 1.55, 1.75, 0, { hp: 2200, decay: 0.07 }),
    ], 0.045),
    // smg: SNAPPY RATATAT — pitched up + short decay so 15rps reads as a zipper,
    // not a wall of mud. Cooldown sits under the Uzi's 0.052s interval.
    shoot_smg: layers([
      part([F + "smg-1.m4a", F + "smg-2.m4a", F + "smg-3.m4a"], 0.62, 1.07, 1.16, 0, { hp: 480, decay: 0.13 }),
    ], 0.04),
    // AK-47: DEEP HEAVY BARK — the carbine recording dragged down to 7.62 weight
    // (slower rate = naturally longer decay) + a low-shelf bass push + a lowpassed
    // shotgun layer underneath for chest thump. The status rifle SOUNDS like status.
    shoot_ak47: layers([
      part([F + "carbine-1.m4a", F + "carbine-2.m4a"], 0.95, 0.72, 0.78, 0, { bass: 8 }),
      part([F + "shotgun-1.m4a"], 0.32, 0.58, 0.66, 0, { lp: 480 }),
    ], 0.05),
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
  // The only loops are diegetic, real recordings tied to a game state:
  //   wanted_siren-> real police siren while you have a wanted level (city)
  // (the old car_engine recording is retired — your motor is now the
  //  synthesized ENGINE VOICE below, which actually revs and shifts)
  const LOOPS = {
    wanted_siren: { file: W + "police_siren.m4a", volume: 0.5 },
    // (jail lockdown siren is now a BRIEF one-shot in BANK, not a sustained loop)
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
  // This is how one set of recordings becomes many distinct gun voices.
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

  // ============================================================
  //  PLAYER ENGINE VOICE + TYRE SCREECH (CBZ.carAudio)
  //  city/vehicles.js feeds update(rev, throttle, skid, flavor, shifted)
  //  every driven frame. One persistent oscillator rig (built on enter,
  //  torn down on exit) — never per-frame node churn. WHY each knob:
  //    idle/max = crank fundamental Hz — a truck IDLES lower than a
  //               superbike REVS, so you hear what you stole;
  //    sub      = half-frequency square weight (big-displacement thump);
  //    det      = detuned-saw weight (mechanical shimmer/rasp);
  //    lp*      = how much top-end the voice opens up as it revs;
  //    vol      = presence (muscle/truck LOUD and proud, sedan polite).
  // ============================================================
  const ENGINES = {
    sports: { idle: 92, max: 560, vol: 0.24, lpBase: 420, lpSpan: 2600, sub: 0.45, det: 0.55, q: 1.1 },
    muscle: { idle: 54, max: 310, vol: 0.30, lpBase: 280, lpSpan: 1500, sub: 0.95, det: 0.40, q: 1.4 },
    sedan:  { idle: 72, max: 390, vol: 0.19, lpBase: 320, lpSpan: 1800, sub: 0.60, det: 0.40, q: 1.0 },
    truck:  { idle: 42, max: 220, vol: 0.30, lpBase: 220, lpSpan: 1000, sub: 1.05, det: 0.35, q: 1.5 },
    bike:   { idle: 125, max: 900, vol: 0.21, lpBase: 520, lpSpan: 3400, sub: 0.30, det: 0.60, q: 1.0 },
  };
  let eng = null, engFed = 0, engFlavorKey = "";
  function engineStart() {
    if (eng || !ctx || !loopBus || !sfxBus) return;
    const e = {};
    // motor: oscA(saw) + oscB(square @ half) + oscC(detuned saw) -> lowpass -> gain
    e.gain = ctx.createGain(); e.gain.gain.value = 0.0001; e.gain.connect(loopBus);
    e.lp = ctx.createBiquadFilter(); e.lp.type = "lowpass"; e.lp.frequency.value = 600; e.lp.Q.value = 1.2; e.lp.connect(e.gain);
    e.oscA = ctx.createOscillator(); e.oscA.type = "sawtooth"; e.oscA.frequency.value = 70; e.oscA.connect(e.lp);
    e.subGain = ctx.createGain(); e.subGain.gain.value = 0.6; e.subGain.connect(e.lp);
    e.oscB = ctx.createOscillator(); e.oscB.type = "square"; e.oscB.frequency.value = 35; e.oscB.connect(e.subGain);
    e.detGain = ctx.createGain(); e.detGain.gain.value = 0.45; e.detGain.connect(e.lp);
    e.oscC = ctx.createOscillator(); e.oscC.type = "sawtooth"; e.oscC.frequency.value = 70; e.oscC.detune.value = 14; e.oscC.connect(e.detGain);
    e.oscA.start(); e.oscB.start(); e.oscC.start();
    // tyre screech: saw with a fast vibrato through a resonant bandpass = squeal
    e.skidGain = ctx.createGain(); e.skidGain.gain.value = 0.0001; e.skidGain.connect(sfxBus);
    e.skidBp = ctx.createBiquadFilter(); e.skidBp.type = "bandpass"; e.skidBp.frequency.value = 1280; e.skidBp.Q.value = 4.5; e.skidBp.connect(e.skidGain);
    e.skidOsc = ctx.createOscillator(); e.skidOsc.type = "sawtooth"; e.skidOsc.frequency.value = 1150; e.skidOsc.connect(e.skidBp);
    e.skidLfoGain = ctx.createGain(); e.skidLfoGain.gain.value = 130; e.skidLfoGain.connect(e.skidOsc.frequency);
    e.skidLfo = ctx.createOscillator(); e.skidLfo.type = "sine"; e.skidLfo.frequency.value = 29; e.skidLfo.connect(e.skidLfoGain);
    e.skidOsc.start(); e.skidLfo.start();
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
      e.skidGain.gain.cancelScheduledValues(t);
      e.skidGain.gain.setTargetAtTime(0.0001, t, 0.04);
      [e.oscA, e.oscB, e.oscC, e.skidOsc, e.skidLfo].forEach(function (o) { o.stop(t + 0.45); });
    } catch (err) {}
  }
  function engineUpdate(rev, throttle, skid, flavor, shifted) {
    if (!ctx || ctx.state === "suspended") return;
    if (!eng) engineStart();                                  // first frame at the wheel
    if (!eng) return;
    engFed = performance.now() * 0.001;
    const F = ENGINES[flavor] || ENGINES.sedan;
    const e = eng, t = ctx.currentTime;
    if (flavor !== engFlavorKey) {                            // retune the static voicing once per car class
      engFlavorKey = flavor;
      e.subGain.gain.setTargetAtTime(F.sub, t, 0.1);
      e.detGain.gain.setTargetAtTime(F.det, t, 0.1);
      e.lp.Q.value = F.q;
    }
    rev = Math.max(0, Math.min(1.15, rev || 0));
    const hz = F.idle + rev * (F.max - F.idle);
    // short time-constants: an upshift's rev DROP must read as a snap, not a glide
    e.oscA.frequency.setTargetAtTime(hz, t, 0.045);
    e.oscB.frequency.setTargetAtTime(hz * 0.5, t, 0.045);
    e.oscC.frequency.setTargetAtTime(hz, t, 0.055);
    e.lp.frequency.setTargetAtTime(F.lpBase + rev * F.lpSpan + (throttle ? 500 : 0), t, 0.07);
    const vol = F.vol * (0.36 + rev * 0.34 + (throttle ? 0.32 : 0));
    if (shifted) {
      // the gear change: a momentary throttle-cut dip while the "clutch" is in
      e.gain.gain.cancelScheduledValues(t);
      e.gain.gain.setTargetAtTime(vol * 0.3, t, 0.015);
      e.gain.gain.setTargetAtTime(vol, t + 0.08, 0.05);
    } else e.gain.gain.setTargetAtTime(vol, t, 0.07);
    // tyre screech scales with slip² (moderate slip whispers, a slide HOWLS)
    skid = Math.max(0, Math.min(1, skid || 0));
    e.skidGain.gain.setTargetAtTime(skid * skid * 0.5, t, skid > 0.05 ? 0.035 : 0.09);
    if (skid > 0.05) e.skidOsc.frequency.setTargetAtTime(1000 + skid * 320 + Math.random() * 160, t, 0.06);
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
    const entry = BANK[name];
    if (!entry) { console.warn("[audio] unmapped sfx:", name); return null; }
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
    if (!opts.force && now - prev < entry.cooldown) return null;
    // opts.ghost: play without stamping the cooldown — NPC fire must never
    // starve the player's own muzzle report out of the channel.
    if (!opts.ghost) last.set(name, now);
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
    if (w.indexOf("carbine") >= 0 || w.indexOf("rifle") >= 0 || w.indexOf("sniper") >= 0 || w.indexOf("lmg") >= 0 || w.indexOf("m4") >= 0 || w.indexOf("556") >= 0) return "shoot_carbine";
    if (w.indexOf("taser") >= 0) return "shoot_taser";
    if (w.indexOf("rpg") >= 0 || w.indexOf("bazooka") >= 0 || w.indexOf("rocket") >= 0) return "explosion";
    if (w.indexOf("pistol") >= 0 || w.indexOf("sidearm") >= 0 || w.indexOf("revolver") >= 0 || w.indexOf("deagle") >= 0 || w.indexOf("9mm") >= 0 || w.indexOf("gun") >= 0) return "shoot_pistol";
    return "report"; // unknown/empty hands-with-a-gun: the generic incoming crack
  }
  const npcLast = new Map();
  const npcOpts = { force: true, ghost: true, volume: 1, dist: null, far: false }; // reused: no per-shot allocation
  function gunVoice(weapon, dist) {
    if (!ctx || !sfxBus) return null;
    const name = voiceFor(weapon);
    const entry = BANK[name];
    if (!entry) return null;
    const now = performance.now() * 0.001;
    const prev = npcLast.get(name) || -1e9;
    if (now - prev < Math.max(entry.cooldown, 0.07)) return null;
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
    // (REMOVED per user request: the global "you're wanted" police-siren loop that
    // played + swelled as your stars rose. Always off now.)
    stopAudioLoop("wanted");
  }

  CBZ.initAudio = initAudio;
  CBZ.sfx = sfx;
  // your car's voice: start on enter, update every driven frame, stop on exit
  CBZ.carAudio = { start: engineStart, stop: engineStop, update: engineUpdate };
  CBZ.gunVoice = gunVoice;
  CBZ.gunVoiceName = voiceFor; // weapon name -> bank voice, for player-fired call sites (full volume via CBZ.sfx)
  CBZ.getAudioCtx = function () { return ctx; };
  CBZ.setAudioLoop = setAudioLoop;
  CBZ.stopAudioLoop = stopAudioLoop;
  CBZ.audioManifest = { effects: BANK, loops: LOOPS };
  CBZ.audioStatus = function () { return { loaded: buffers.size, loading: loading.size, failed: Array.from(failed), total: allFiles().length, loops: loopSlots.size }; };

  if (CBZ.onAlways) CBZ.onAlways(86, updateWorldLoops);
})();
