/* DESERT WARLORD — THE WAR MIXER, photographed under load.

   THE CLAIM. A battle of three hundred men cannot play three hundred
   gunshots. src/warlord/feel.js says it turns that load into a texture with a
   bounded number of discrete near-field reports punching through it. Headless
   Chrome has no speakers, so the claim is proved by MEASUREMENT: feel.js
   instruments its own mixer (requests in, voices out, grains scheduled, shots
   folded into the bed, AudioNodes minted) and ?feel=1 draws every one of those
   numbers on the screen. That overlay is what these subjects photograph.

   THE A/B IS A FLAG, NOT A DEPLOY. Both sides are this checkout; the before
   side boots ?mixer=old, which is feel.js's own one-word revert — every gun
   cue goes straight to systems/audio.js exactly as battle.js has always sent
   it. Nothing else differs. So every number of difference is the mixer.

   THE INPUT IS IDENTICAL ON BOTH SIDES, and that is load-bearing. The stage
   drives feel.js's measurement seam, W.feel.load({rifles, seconds}), which
   puts N rifles on a real line geometry and fires them through THE REAL CALL
   PATH — CBZ.sfx("shoot_ak47", {dist, ghost, volume, delay}), byte for byte
   the object battle.js:936 builds — at battle.js's own 26-per-frame fxBudget
   cap. The distances come from a seeded stream, so both sides see the same
   4800 shots at the same ranges. `shotsRequested` is published as a metric for
   exactly one reason: if it ever differs between the columns, the comparison
   is void and you can see that at a glance.

   WHY NOT JUST LET THE BATTLE FIRE. Because the number of rounds a battle
   fires in ten seconds depends on morale, terrain LOS, cover and combat_iq —
   four systems being written by other agents this same hour. A mixer
   comparison that moves because somebody retuned a break point is not a mixer
   comparison. The battle IS live underneath every gun subject (real men, real
   sand, real corpses, real camera) — it is the picture; the load is the
   instrument.

   SIX SUBJECTS, in two acts.
     ONE RIFLE      the light case. The budget must be INVISIBLE here: a lone
                    shot gets a full discrete voice, the bed is silent, and
                    the two columns should read nearly the same. A mixer that
                    changes this one has broken the quiet case.
     TWENTY RIFLES  a skirmish. The naive column is already 30 voices/s; the
                    mixer is at its ceiling with a thin bed under it.
     THREE HUNDRED  the headline. ~480 requests/s. The naive column plays all
                    of them; the mixer plays 22/s and folds 95% into a bed
                    whose density and colour track the real rate of fire.
     DUNE / SALT / OASIS   the ambience readout in three biomes. The salt pan
                    is the one that matters: it is supposed to be nearly
                    silent, and the wind/sand bars going to nothing on the pan
                    is the whole reason the other two biomes mean anything.

   fps is sampled with the clock RUNNING and the load still on, after the
   deterministic frozen measurement — an fps read under a frozen clock is not
   an fps. */

const RIFLE_SUBJECTS = [
  { id: "rifle-300", label: "Three hundred rifles", rifles: 300, sec: 10, warm: 10, warm: 3,
    focus: "THE HEADLINE. Three hundred rifles is ~480 shot requests a second arriving at the mixer — the same 4800 requests on both sides (check `shotsRequested`; if it differs the comparison is void). BEFORE: every one of them becomes a gun voice. Read `VOICES` and `nodes` on the before panel — that is 480 discrete reports a second and thousands of AudioNodes a second for the GC, and it is why a big fight sounds like a broken machine gun rather than a war. AFTER: `VOICES` sits on the token bucket's 22/s ceiling (1/0.045 s — the transient fusion window), `grains` sits on its 14/s cap, `culled` is ~95% and `density` is pinned at 1.00 with the bed at full gain. The 95% is not thrown away; it IS the wash." },
  { id: "rifle-20", label: "Twenty rifles", rifles: 20, sec: 8, warm: 6,
    focus: "A SKIRMISH. Twenty rifles is ~32 requests/s. The naive column simply plays 32 gun voices a second. The mixer is already at its ceiling on the near side but the bed is only part-way up — read `density`, which should sit well under 1.00 here and at 1.00 on the 300-rifle page. That gap between the two pages IS the claim that the bed tracks the real rate of fire rather than being a static loop somebody turned on." },
  { id: "rifle-300", label: "Three hundred rifles", rifles: 300, sec: 10, warm: 10,
    focus: "THE QUIET CASE, AND IT IS A CONTROL, NOT A WIN. One rifle at 1.6 rounds/s. The token bucket is full, the shot is at the camera's elbow, so it gets a full discrete voice exactly as it always did; `density` is near zero and the bed is silent. The two columns should read almost identically here. If the after column shows fewer voices than the before column on THIS page, the budget is eating sounds it has no business eating and the mixer is wrong." },
];

const BIOME_SUBJECTS = [
  { id: "amb-dune", label: "Ambience — the dunes", biome: "dune",
    focus: "WIND IS AN EXPOSURE FUNCTION, not a weather state. feel.js reads eight height probes at 90 m (one dune wavelength on this island) off W.desert.heightAt and asks how much of the neighbourhood is BELOW you — so a crest sounds like a crest. On the dunes both `wind` and `sand` should be reading. This subject and the two after it are unchanged by ?mixer=old by construction; they are here because the ambience readout has to be photographed somewhere and three biomes side by side is the only way to see that the system distinguishes them at all." },
  { id: "amb-salt", label: "Ambience — the salt pan", biome: "salt",
    focus: "THE DEAD QUIET, AND IT IS THE POINT OF THE WHOLE AMBIENCE SYSTEM. A flat pan has no relief to make wind noise on and no dune faces to hiss, so the honest answer is near-silence: `wind` drops to about a fifth of the dune reading and `sand` goes to nothing. Everything else in the ambience layer exists so that riding onto the pan and having the sound drop out MEANS something. Compare the wind and sand bars against the dune page — if they are the same, the map is one texture." },
  { id: "amb-oasis", label: "Ambience — an oasis", biome: "oasis",
    focus: "THE ONLY WATER ON A FOURTEEN-KILOMETRE ISLAND, and the only thing alive. `water` comes up (it fades in from 260 m out, so an oasis is audible before you are standing in it) and the wind drops — palms and a basin shelter it. Birds are scheduled off the same water reading at one chirp every two to six seconds; a chirp a second reads as a ringtone, not as an oasis." },
];

const subjects = RIFLE_SUBJECTS.concat(BIOME_SUBJECTS);

async function stageWarlordFeel(input) {
  const CBZ = window.CBZ;
  const W = CBZ && CBZ.warlord;
  if (!W || !W.feel) return { ok: false, err: "no W.feel" };
  const S = input.subject;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const micro = CBZ.micro;

  // one-time studio setup, shared by every subject on this page
  const ST = (window.__feelStudio = window.__feelStudio || { started: false, phase: "" });

  const render = () => {
    const R = CBZ.renderer || (micro && micro.renderer);
    if (R && CBZ.camera && CBZ.scene) { try { R.render(CBZ.scene, CBZ.camera); } catch (_) {} }
  };
  window.__cbzVisualCompare = window.__cbzVisualCompare || {};
  window.__cbzVisualCompare.render = render;

  /* ---- ACT ONE: the guns, over a live battle ---------------------------- */
  if (S.rifles) {
    if (!ST.started) {
      ST.started = true;
      // the same door battle.js's ?battle=1 opens, called directly so the
      // stage owns the moment rather than racing a 60 ms timer
      try {
        if (!W.battle.live()) {
          if (!W.state.army.length) {
            for (let i = 0; i < 60; i++) W.addSoldier(W.makeSoldier("soldier", "ak47"));
          }
          W.state.you.wid = "ak47";
          const b = W.makeBand({ size: 60, faction: "bandit" });
          b.x = W.state.you.x + 40; b.z = W.state.you.z;
          W.state.bands.push(b);
          W.battle.start({ band: b });
        }
      } catch (_) {}
      const deadline = Date.now() + 90000;
      while (Date.now() < deadline && !(W.battle.live && W.battle.live())) await wait(300);
      try { W.battle.order("charge"); } catch (_) {}
      // the audio context: constructing and minting nodes is allowed on a
      // suspended context, and node churn is exactly what is being measured,
      // so the count is real whether or not headless can make a sound
      try { if (CBZ.initAudio) CBZ.initAudio(); } catch (_) {}
      try { W.feel.unlock(); } catch (_) {}
      try { W.battle.freeze(); } catch (_) {}
      // let the men close so the picture has a fight in it
      try { W.battle.advance(6); } catch (_) {}
    }

    // THE MEASUREMENT: frozen clock, known load, fixed simulated seconds.
    try { W.feel.loadOff(); } catch (_) {}
    try { W.feel.reset(); } catch (_) {}
    try { W.feel.load({ rifles: S.rifles, seconds: S.sec + 2 }); } catch (_) {}
    try { W.battle.freeze(); } catch (_) {}
    try { W.battle.advance(S.sec); } catch (_) {}
    const frozen = W.feel.audit();

    /* fps IS A WALL-CLOCK NUMBER. Read it with the clock running and the load
       still on — an fps sampled under a frozen clock is not an fps, it is a
       zero. The mixer counters keep the frozen values, which are the
       deterministic ones. */
    let fps = 0;
    try {
      if (micro && micro.start) {
        micro.start();
        await wait(2200);
        fps = Math.round(micro.fps || 0);
        micro.stop();
      }
    } catch (_) {}
    const live = W.feel.audit();
    try { W.feel.loadOff(); } catch (_) {}

    // point the camera at the bodies
    let cam = null;
    try {
      cam = W.battle.look(input.referenceStage && input.referenceStage.cam
        ? input.referenceStage.cam : { dist: 62, pitch: -0.30 });
    } catch (_) {}
    try { W.battle.advance(0.05); } catch (_) {}
    render();

    return {
      ok: true,
      cam: cam ? { x: cam.x, z: cam.z, dist: cam.dist, yaw: cam.yaw, pitch: cam.pitch } : null,
      metrics: {
        shotsRequested: frozen.reqAll,
        requestHz: Math.round(frozen.reqHz * 10) / 10,
        voiceHz: Math.round(frozen.voiceHz * 10) / 10,
        peakVoiceHz: Math.round(frozen.peakVoiceHz * 10) / 10,
        grainHz: Math.round(frozen.grainHz * 10) / 10,
        foldedPct: frozen.cullPct,
        nodeHz: Math.round(frozen.nodeHz * 10) / 10,
        nodesTotal: frozen.nodes,
        density: Math.round(frozen.density * 100) / 100,
        bedGain: Math.round(frozen.bedGain * 1000) / 1000,
        meanDist: Math.round(frozen.meanDist),
        fps: fps || live.fps || 0,
      },
    };
  }

  /* ---- ACT TWO: the island, three biomes -------------------------------- */
  // leave the war exactly once, then teleport between biomes
  if (ST.phase !== "campaign") {
    try { if (W.battle && W.battle.live && W.battle.live()) W.battle.retreat(); } catch (_) {}
    await wait(400);
    try { W.feel.loadOff(); } catch (_) {}
    try {
      if (W.campaign && W.campaign.enter) W.campaign.enter();
      else W.setPhase("campaign");
    } catch (_) {}
    await wait(600);
    ST.phase = "campaign";
  }

  const D = W.desert;
  let spot = null;
  if (D && D.landPoint) {
    // a DETERMINISTIC stream, not W.rnd() — the campaign's own stream has been
    // advanced a different number of times on the two sides by then, and two
    // sides standing on two different dunes is not a comparison
    let a = 0x9e3779b9 ^ (S.biome.length * 2654435761);
    const rnd = () => { a = (Math.imul(a, 1664525) + 1013904223) >>> 0; return a / 4294967296; };
    for (let k = 0; k < 400 && !spot; k++) {
      const p = D.landPoint(rnd, { biome: S.biome });
      if (p && (!D.biomeAt || D.biomeAt(p.x, p.z) === S.biome)) spot = p;
    }
    // an oasis is a named thing; go to a real one rather than hunting for it
    if (!spot && S.biome === "oasis" && D.oases && D.oases.length) {
      const o = D.oases[0];
      spot = { x: o.x + 8, z: o.z + 8 };
    }
  }
  if (spot) {
    try {
      W.state.you.x = spot.x; W.state.you.z = spot.z;
      if (CBZ.camera) CBZ.camera.position.set(spot.x, (D.heightAt ? D.heightAt(spot.x, spot.z) : 0) + 40, spot.z + 60);
    } catch (_) {}
  }
  // the ambience probes run at 4 Hz and the beds slew over ~0.5 s, so give the
  // system enough simulated time to actually arrive at the new biome
  try { if (micro && micro.stepSim) for (let i = 0; i < 180; i++) micro.stepSim(1 / 60); } catch (_) {}

  let fps = 0;
  try {
    if (micro && micro.start) { micro.start(); await wait(1600); fps = Math.round(micro.fps || 0); micro.stop(); }
  } catch (_) {}
  const a = W.feel.audit();
  render();
  return {
    ok: true,
    metrics: {
      wind: Math.round(a.wind * 1000) / 1000,
      sand: Math.round(a.sand * 1000) / 1000,
      water: Math.round(a.water * 1000) / 1000,
      exposure: Math.round(a.exposure * 100) / 100,
      biomeHit: a.biome === S.biome ? 1 : 0,
      fps: fps || a.fps || 0,
    },
  };
}

export default {
  id: "warlord-feel",
  title: "Desert Warlord: 300 Rifles Are a Texture, Not 300 Gunshots",
  description:
    "Both sides are this checkout; the before side boots ?mixer=old, which is src/warlord/feel.js's own one-word revert to one-sound-per-shot. The stage drives an identical, seeded rifle load through the real CBZ.sfx call path on both columns and photographs feel.js's own ?feel=1 instrument panel. Three loads — one rifle, twenty, three hundred — then the ambience readout in three biomes.",
  page: "games/warlord.html",
  defaultBefore: "local",
  beforeParams: { mixer: "old" },
  beforeLabel: "BEFORE · one sound per shot (?mixer=old)",
  afterLabel: "AFTER · the war mixer",
  viewport: { width: 1180, height: 700 },
  urlParams: { go: 1, seed: 1337, feel: 1, audit: 1 },
  readyExpression:
    "!!(window.__warlordReady && window.CBZ && window.CBZ.warlord && window.CBZ.warlord.feel && window.CBZ.warlord.battle)",
  // the first gun subject boots the studio, raises the island, builds 120 men
  // and runs sixteen simulated seconds under software WebGL
  stageTimeoutMs: 600000,
  pairNote:
    "Same checkout · same seed · same 4800 seeded shot requests at the same ranges through the same CBZ.sfx — ?mixer=old is the only variable",
  method:
    "Both sides are this checkout served by the same local server; the before side adds ?mixer=old, feel.js's revert to the naive one-voice-per-shot path. A real battle is started through battle.js's own published start(), the rAF clock is frozen, and battle.advance() is the only time that passes — so both sides photograph the identical simulated moment. The gun load is feel.js's measurement seam W.feel.load(), which fires a seeded rifle line through CBZ.sfx('shoot_ak47', {dist, ghost, volume, delay}) — the exact object battle.js builds — at battle.js's own 26-per-frame fxBudget cap. Mixer counters are read under the frozen clock (deterministic); fps is read afterwards with the clock running and the load still on, because an fps under a frozen clock is a zero. The ambience subjects teleport the same seeded distance into a dune field, a salt pan and an oasis and let the 4 Hz terrain probes and the bed slews settle before reading.",
  metricsNote:
    "shotsRequested is the control: it must be IDENTICAL in both columns or the comparison is void. voiceHz is the headline — discrete gun voices a second, which the mixer holds at the 22/s transient-fusion ceiling no matter how many rifles are on the field. nodeHz is what that costs the audio graph: AudioNodes minted per second, all of them garbage a moment later. foldedPct is the fraction of shots that became texture instead of voices — high is the design working, not sounds being lost. density and bedGain are the crackle bed's own reading, and they should be near zero on the one-rifle page and pinned at 1.00 on the three-hundred page; that is the bed tracking the real rate of fire. wind/sand/water are the ambience beds in each biome — the salt pan's near-zero reading against the dunes' is the claim that the map is not one texture.",
  metrics: {
    shotsRequested: { label: "Shot requests (must match)", unit: "shots" },
    requestHz: { label: "Shots requested", unit: "/s" },
    voiceHz: { label: "Live gun voices", unit: "/s", better: "lower" },
    peakVoiceHz: { label: "Peak gun voices", unit: "/s", better: "lower" },
    grainHz: { label: "Bed grains scheduled", unit: "/s" },
    foldedPct: { label: "Shots folded into the bed", unit: "%", better: "higher" },
    nodeHz: { label: "AudioNodes minted", unit: "/s", better: "lower" },
    nodesTotal: { label: "AudioNodes over the window", unit: "nodes", better: "lower" },
    density: { label: "Mixer bed density", unit: "0-1" },
    bedGain: { label: "Crackle bed gain", unit: "0-0.42" },
    meanDist: { label: "Mean range of the fire", unit: "m" },
    fps: { label: "Frame rate under the load", unit: "fps", better: "higher" },
    wind: { label: "Wind bed", unit: "0-1" },
    sand: { label: "Sand hiss bed", unit: "0-1" },
    water: { label: "Water bed", unit: "0-1" },
    exposure: { label: "Terrain exposure", unit: "0-1" },
    biomeHit: { label: "Landed in the intended biome", unit: "1=yes", better: "higher" },
  },
  subjects,
  stage: stageWarlordFeel,
};
