/* ============================================================
   systems/audio.js - local recorded-sample audio for every mode.

   The old version synthesized every effect from oscillators and
   generated noise. This keeps the small CBZ.sfx(name) API, but all
   audible output now comes from decoded local CC0 audio files.
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

    shoot: fx([F + "pistol-1.m4a", F + "pistol-2.m4a", F + "pistol-3.m4a"], 0.78, 0.035),
    shoot_pistol: fx([F + "pistol-1.m4a", F + "pistol-2.m4a", F + "pistol-3.m4a"], 0.82, 0.035),
    shoot_shotgun: fx([F + "shotgun-1.m4a", F + "shotgun-2.m4a"], 0.98, 0.12),
    shoot_carbine: fx([F + "carbine-1.m4a", F + "carbine-2.m4a"], 0.8, 0.045),
    shoot_smg: fx([F + "smg-1.m4a", F + "smg-2.m4a", F + "smg-3.m4a"], 0.68, 0.055),
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
  //   car_engine  -> while you're actually driving
  //   wanted_siren-> real police siren while you have a wanted level (city)
  //   lockdown    -> real klaxon while the prison is on lockdown
  const LOOPS = {
    car_engine: { file: O + "car-engine-mid.m4a", volume: 0.22 },
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

  function part(files, volume, pitchMin, pitchMax, delay) {
    return { files, volume, pitchMin: pitchMin || 0.96, pitchMax: pitchMax || 1.04, delay: delay || 0 };
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

  function playLoaded(file, buffer, p, opts) {
    const src = ctx.createBufferSource();
    const gain = ctx.createGain();
    src.buffer = buffer;
    src.playbackRate.value = opts.pitch || (p.pitchMin + Math.random() * (p.pitchMax - p.pitchMin));
    gain.gain.value = p.volume * (opts.volume == null ? 1 : opts.volume);
    src.connect(gain); gain.connect(sfxBus);
    src.start(ctx.currentTime + (opts.delay || 0) + p.delay);
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

  function sfx(name, opts) {
    if (!ctx || !sfxBus) return null;
    if (ctx.state === "suspended") ctx.resume();
    const entry = BANK[name];
    if (!entry) { console.warn("[audio] unmapped sfx:", name); return null; }
    opts = opts || {};
    const now = performance.now() * 0.001;
    const prev = last.get(name) || -1e9;
    if (!opts.force && now - prev < entry.cooldown) return null;
    last.set(name, now);
    let first = null;
    entry.parts.forEach(function (p) { const src = playPart(p, opts); if (!first) first = src; });
    return first;
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
      stopAudioLoop("engine");
      stopAudioLoop("wanted");
      return;
    }
    // NO background bed/music — only diegetic, real loops tied to game state.
    const P = CBZ.player;
    // car engine while actually driving
    if (g.mode === "city" && P && P.driving && P._vehicle) {
      const speed = Math.abs(P._vehicle.v || 0);
      setAudioLoop("engine", "car_engine", 0.11 + Math.min(0.17, speed * 0.008), 0.72 + Math.min(0.8, speed * 0.035));
    } else stopAudioLoop("engine");
    // (REMOVED per user request: the global "you're wanted" police-siren loop that
    // played + swelled as your stars rose. Always off now.)
    stopAudioLoop("wanted");
  }

  CBZ.initAudio = initAudio;
  CBZ.sfx = sfx;
  CBZ.getAudioCtx = function () { return ctx; };
  CBZ.setAudioLoop = setAudioLoop;
  CBZ.stopAudioLoop = stopAudioLoop;
  CBZ.audioManifest = { effects: BANK, loops: LOOPS };
  CBZ.audioStatus = function () { return { loaded: buffers.size, loading: loading.size, failed: Array.from(failed), total: allFiles().length, loops: loopSlots.size }; };

  if (CBZ.onAlways) CBZ.onAlways(86, updateWorldLoops);
})();
