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
   cap. Distances come from a seeded stream. `shotsRequested` is published as a
   metric for exactly one reason: if it differs between the columns the
   comparison is void, and you can see that at a glance instead of trusting a
   paragraph. `battleShots` publishes how many of those requests came from the
   real battle underneath rather than from the instrument, so the instrument is
   never quietly taking credit for the fight.

   EVERY CLOCK HERE IS A FRAME COUNT, NEVER A WALL SECOND. The first cut
   sampled fps by starting the rAF clock and waiting 2.2 s — and because
   headless runs at 12–18 fps, the two sides then simulated DIFFERENT amounts
   of battle and arrived at the next subject in different states, which showed
   up immediately as `shotsRequested` disagreeing by 25 shots. So the fps probe
   is now a fixed 45 stepSim+render frames timed with performance.now(): the
   number is still "how fast can this build produce a frame under this load",
   and both sides advance the identical simulation. The picture and the metrics
   are read at the same instant, after that probe.

   WHY NOT JUST LET THE BATTLE FIRE. Because how many rounds a battle fires in
   ten seconds depends on morale, terrain LOS, cover and combat_iq — four
   systems being written by other agents this same hour. A mixer comparison
   that moves because somebody retuned a break point is not a mixer comparison.
   The battle IS live underneath every gun subject (real men, real sand, real
   corpses, real camera): it is the picture, the load is the instrument.

   SIX SUBJECTS, IN TWO ACTS, and the order is campaign-then-battle because
   that is the direction the game itself moves. The first cut ran the guns
   first and then called battle.retreat() to get back to the island; retreat
   lands in army.js's aftermath roster, so all three ambience pages
   photographed a casualty list with a frozen ambience readout on it. */

const BIOME_SUBJECTS = [
  { id: "amb-dune", label: "Ambience — the dunes", biome: "dune",
    focus: "WIND IS AN EXPOSURE FUNCTION, not a weather state. feel.js takes eight height probes at 90 m (one dune wavelength on this island) off W.desert.heightAt and asks how much of the neighbourhood is BELOW you — so a crest sounds like a crest even in the middle of a flat province. On the dunes both `wind` and `sand` should read. These three pages are unchanged by ?mixer=old by construction (the mixer is a gun system); they are here because the only way to see that the ambience distinguishes the island at all is three biomes side by side." },
  { id: "amb-salt", label: "Ambience — the salt pan", biome: "salt",
    focus: "THE DEAD QUIET, AND IT IS THE POINT OF THE WHOLE AMBIENCE SYSTEM. A flat pan has no relief to make wind noise on and no dune faces to hiss, so the honest answer is near-silence: wind falls to about a fifth of the dune reading and sand goes to nothing. Everything else in the ambience layer exists so that riding onto the pan and having the sound DROP OUT means something. Compare the wind and sand bars against the dune page — if they are the same, the map is one texture and the system is decoration." },
  { id: "amb-oasis", label: "Ambience — an oasis", biome: "oasis",
    focus: "THE ONLY WATER ON A FOURTEEN-KILOMETRE ISLAND, and the only thing alive on it. `water` comes up — it fades in from 260 m out, so an oasis is audible before you are standing in it — and the wind drops, because a palm basin shelters. Birds are scheduled off that same water reading at one chirp every two to six seconds; a chirp a second reads as a ringtone, not as an oasis." },
];

const RIFLE_SUBJECTS = [
  { id: "rifle-1", label: "One rifle", rifles: 1, sec: 6, warm: 4, dist: 46, pitch: -0.26,
    focus: "THE QUIET CASE, AND IT IS A CONTROL, NOT A WIN. One rifle at 1.6 rounds/s, fired at the camera's elbow. The token bucket is full, so it gets a full discrete voice exactly as it always did; density and bed gain sit near zero. THE TWO COLUMNS SHOULD READ ALMOST THE SAME HERE. If the after column shows meaningfully fewer voices than the before column on this page, the budget is eating sounds it has no business eating and the mixer is wrong. (The lines are still closing at this point in the storyboard, so `battleShots` is small and almost every request is the instrument's.)" },
  { id: "rifle-20", label: "Twenty rifles", rifles: 20, sec: 8, warm: 7, dist: 42, pitch: -0.24,
    focus: "A SKIRMISH — about 32 requests a second. The naive column simply plays all 32 as discrete gun voices. The mixer is already sitting on its near-field ceiling, but the bed is only part way up: read `density` here against the 300-rifle page. That GAP between the two pages is the claim that the crackle bed tracks the real rate of fire, rather than being a loop somebody switched on when a battle started." },
  { id: "rifle-300", label: "Three hundred rifles", rifles: 300, sec: 10, warm: 10, dist: 40, pitch: -0.22,
    focus: "THE HEADLINE. Three hundred rifles is ~480 shot requests a second arriving at the mixer, and it is the SAME ~4800 requests on both sides — check `shotsRequested` first; if it differs, everything else on this page is void. BEFORE: every one of them becomes a gun voice. Read `voices` and `nodes` on the before panel: hundreds of discrete reports a second and thousands of AudioNodes a second minted and thrown away, which is why a big fight sounds like a broken machine gun rather than a war. AFTER: `voices` sits on the token bucket's 22/s ceiling (1/0.045 s, the transient fusion window — two reports closer than that fuse into one percept, so the extra nodes buy nothing), `grains` sits on its 14/s cap, `folded->bed` is ~95% and `density` is pinned at 1.00 with the bed at full gain. That 95% is not thrown away. It IS the wash." },
];

const subjects = BIOME_SUBJECTS.concat(RIFLE_SUBJECTS);

async function stageWarlordFeel(input) {
  const CBZ = window.CBZ;
  const W = CBZ && CBZ.warlord;
  if (!W || !W.feel) return { ok: false, err: "no W.feel" };
  const S = input.subject;
  const micro = CBZ.micro;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const ST = (window.__feelStudio = window.__feelStudio || { battle: false });

  const render = () => {
    const R = CBZ.renderer || (micro && micro.renderer);
    if (R && CBZ.camera && CBZ.scene) { try { R.render(CBZ.scene, CBZ.camera); } catch (_) {} }
  };
  window.__cbzVisualCompare = window.__cbzVisualCompare || {};
  window.__cbzVisualCompare.render = render;

  // frames, not seconds. See the header: a wall-clock window desynchronised
  // the two sides' simulations and broke the shotsRequested control.
  const stepN = (n) => { for (let i = 0; i < n; i++) { try { micro.stepSim(1 / 60); } catch (_) {} } };
  const fpsProbe = (n) => {
    const t0 = performance.now();
    for (let i = 0; i < n; i++) { try { micro.stepSim(1 / 60); } catch (_) {} render(); }
    const ms = performance.now() - t0;
    return ms > 0 ? Math.round((n * 1000) / ms) : 0;
  };

  // the rAF clock is never allowed to run: it is the only source of
  // nondeterminism left on the page.
  try { if (micro && micro.stop) micro.stop(); } catch (_) {}
  try { if (CBZ.initAudio) CBZ.initAudio(); } catch (_) {}
  try { W.feel.unlock(); } catch (_) {}

  /* ================= ACT ONE — the island, three biomes ================= */
  if (S.biome) {
    const D = W.desert;
    if (!D || !D.heightAt) return { ok: false, err: "no desert" };
    /* A DETERMINISTIC STREAM OF MY OWN, not W.rnd(). The campaign's stream has
       been advanced a different number of times by the time each side gets
       here, and two sides standing on two different dunes is not a comparison.
       Seeded off the biome name so each subject has its own fixed spot. */
    let a = (0x9e3779b9 ^ Math.imul(S.biome.length + 7, 2654435761)) >>> 0;
    for (let i = 0; i < S.biome.length; i++) a = (Math.imul(a ^ S.biome.charCodeAt(i), 16777619)) >>> 0;
    const rnd = () => { a = (Math.imul(a, 1664525) + 1013904223) >>> 0; return a / 4294967296; };

    let spot = null;
    for (let k = 0; k < 900 && !spot; k++) {
      let p = null;
      try { p = D.landPoint(rnd, { biome: S.biome }); } catch (_) {}
      if (p && D.biomeAt && D.biomeAt(p.x, p.z) === S.biome) spot = { x: p.x, z: p.z };
    }
    // an oasis is a NAMED thing on this island; go to a real one rather than
    // rejection-sampling for a rare biome that covers a few hundred metres
    if (!spot && S.biome === "oasis" && D.oases && D.oases.length) {
      const o = D.oases[0];
      spot = { x: o.x + (o.r || 40) * 0.35, z: o.z + (o.r || 40) * 0.35 };
    }
    if (!spot) return { ok: false, err: "no " + S.biome + " found" };

    try { W.state.you.x = spot.x; W.state.you.z = spot.z; } catch (_) {}
    const gy = D.heightAt(spot.x, spot.z);
    const cam = { x: spot.x, y: gy + 26, z: spot.z + 78, ax: spot.x, ay: gy + 2, az: spot.z };
    const place = () => {
      const c = CBZ.camera;
      if (!c) return;
      c.position.set(cam.x, cam.y, cam.z);
      c.lookAt(cam.ax, cam.ay, cam.az);
      c.updateProjectionMatrix();
    };
    /* RE-ASSERT THE CAMERA EVERY FRAME. campaign.js drives the campaign camera
       from its own frame hook, and feel.js reads the LISTENER off CBZ.camera —
       so if the campaign puts the camera back, the ambience is measured
       somewhere other than where the picture was taken. */
    try { if (D.follow) D.follow(cam.x, cam.z); } catch (_) {}
    for (let i = 0; i < 30; i++) { place(); stepN(1); try { if (D.follow) D.follow(cam.x, cam.z); } catch (_) {} }
    // the ambience probes run at 4 Hz and the beds slew over ~0.5 s, so give
    // the system real simulated time to arrive at the new biome
    for (let i = 0; i < 240; i++) { place(); stepN(1); }
    place();
    const fps = (() => { const t0 = performance.now(); for (let i = 0; i < 45; i++) { place(); stepN(1); render(); } const ms = performance.now() - t0; return ms > 0 ? Math.round(45000 / ms) : 0; })();
    place();
    render();

    const f = W.feel.audit();
    return {
      ok: true,
      metrics: {
        wind: Math.round(f.wind * 1000) / 1000,
        sand: Math.round(f.sand * 1000) / 1000,
        water: Math.round(f.water * 1000) / 1000,
        exposure: Math.round(f.exposure * 100) / 100,
        biomeHit: f.biome === S.biome ? 1 : 0,
        fps: fps,
      },
    };
  }

  /* ================= ACT TWO — the guns, over a live battle ============== */
  if (!ST.battle) {
    ST.battle = true;
    // the same door battle.js's ?battle=1 opens, called directly so the stage
    // owns the moment instead of racing a 60 ms timer
    try {
      if (!W.battle.live()) {
        if (!W.state.army.length) for (let i = 0; i < 60; i++) W.addSoldier(W.makeSoldier("soldier", "ak47"));
        W.state.you.wid = "ak47";
        const b = W.makeBand({ size: 60, faction: "bandit" });
        b.x = W.state.you.x + 40; b.z = W.state.you.z;
        W.state.bands.push(b);
        W.battle.start({ band: b });
      }
    } catch (e) { return { ok: false, err: "battle.start: " + e }; }
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline && !(W.battle.live && W.battle.live())) await wait(250);
    if (!W.battle.live()) return { ok: false, err: "battle never went live" };
    try { W.battle.order("charge"); } catch (_) {}
    try { W.battle.freeze(); } catch (_) {}
  }

  // per-subject warm-up: let the lines close a little further before each shot
  try { W.battle.advance(S.warm || 4); } catch (_) {}

  // THE MEASUREMENT: frozen clock, known load, fixed simulated seconds.
  try { W.feel.loadOff(); W.feel.reset(); } catch (_) {}
  try { W.feel.load({ rifles: S.rifles, seconds: S.sec + 3 }); } catch (_) {}
  try { W.battle.advance(S.sec); } catch (_) {}
  // fps under the same load, as a fixed frame count (see header)
  const fps = fpsProbe(45);
  const f = W.feel.audit();
  try { W.feel.loadOff(); } catch (_) {}

  let cam = null;
  try {
    cam = W.battle.look(input.referenceStage && input.referenceStage.cam
      ? input.referenceStage.cam
      : { dist: S.dist || 44, pitch: S.pitch == null ? -0.24 : S.pitch });
  } catch (_) {}
  try { W.battle.advance(1 / 60); } catch (_) {}
  render();

  const bat = (() => { try { return W.battle.audit(); } catch (_) { return null; } })();
  return {
    ok: true,
    cam: cam ? { x: cam.x, z: cam.z, dist: cam.dist, yaw: cam.yaw, pitch: cam.pitch } : null,
    metrics: {
      shotsRequested: f.reqAll,
      battleShots: Math.max(0, f.reqAll - f.loadFired),
      requestHz: Math.round(f.reqHz * 10) / 10,
      voiceHz: Math.round(f.voiceHz * 10) / 10,
      peakVoiceHz: Math.round(f.peakVoiceHz * 10) / 10,
      grainHz: Math.round(f.grainHz * 10) / 10,
      foldedPct: f.foldedPct,
      nodeHz: Math.round(f.nodeHz * 10) / 10,
      nodesTotal: f.nodes,
      density: Math.round(f.density * 100) / 100,
      bedGain: Math.round(f.bedGain * 1000) / 1000,
      meanDist: Math.round(f.meanDist),
      aliveMine: bat && bat.mine ? bat.mine.alive : 0,
      fps: fps,
    },
  };
}

export default {
  id: "warlord-feel",
  title: "Desert Warlord: 300 Rifles Are a Texture, Not 300 Gunshots",
  description:
    "Both sides are this checkout; the before side boots ?mixer=old, src/warlord/feel.js's own one-word revert to one-sound-per-shot. The stage drives an identical seeded rifle load through the real CBZ.sfx call path on both columns and photographs feel.js's ?feel=1 instrument panel. Three biomes on the island, then three loads over a live battle: one rifle, twenty, three hundred.",
  page: "games/warlord.html",
  defaultBefore: "local",
  beforeParams: { mixer: "old" },
  beforeLabel: "BEFORE · one sound per shot (?mixer=old)",
  afterLabel: "AFTER · the war mixer",
  viewport: { width: 1180, height: 700 },
  urlParams: { go: 1, seed: 1337, feel: 1 },
  readyExpression:
    "!!(window.__warlordReady && window.CBZ && window.CBZ.warlord && window.CBZ.warlord.feel && window.CBZ.warlord.desert && window.CBZ.warlord.battle)",
  // the first gun subject raises the island, builds 120 men and runs a dozen
  // simulated seconds under software WebGL before it takes a picture
  stageTimeoutMs: 600000,
  pairNote:
    "Same checkout · same seed · the same seeded shot requests at the same ranges through the same CBZ.sfx — ?mixer=old is the only variable",
  method:
    "Both sides are this checkout served by the same local server; the before side adds ?mixer=old, feel.js's revert to the naive one-voice-per-shot path. The rAF clock is stopped on both sides for the whole run and micro.stepSim is the only time that passes, so every subject photographs the identical simulated moment. The ambience subjects teleport to a seeded point in each biome and re-assert the camera every frame (campaign.js drives that camera itself, and the ambience listener IS the camera). The gun subjects start a real battle through battle.js's published start(), then drive feel.js's measurement seam W.feel.load(), which fires a seeded rifle line through CBZ.sfx('shoot_ak47', {dist, ghost, volume, delay}) — the exact object battle.js:936 builds — at battle.js's own 26-per-frame fxBudget cap. fps is a fixed 45-frame stepSim+render probe timed with performance.now(), never a wall-clock wait, because a wall-clock wait desynchronises the two simulations.",
  metricsNote:
    "shotsRequested is the control: it must be identical in both columns or the page is void; battleShots says how much of it came from the real fight underneath rather than the instrument. voiceHz is the headline — discrete gun voices a second, which the mixer holds at the 22/s transient-fusion ceiling however many rifles are on the field. nodeHz is what that costs the audio graph: AudioNodes minted and thrown away per second. foldedPct is the share of shots that became texture instead of voices; high is the design working, not sounds going missing. density and bedGain are the crackle bed's own reading and should be near zero on the one-rifle page and pinned at 1.00 on the three-hundred page — that gap is the bed tracking the real rate of fire. wind/sand/water are the ambience beds; the salt pan reading against the dune reading is the claim that the island is not one texture.",
  metrics: {
    shotsRequested: { label: "Shot requests (must match)", unit: "shots" },
    battleShots: { label: "…of those, from the real battle", unit: "shots" },
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
    aliveMine: { label: "Your men still standing", unit: "men" },
    fps: { label: "Frames under the load", unit: "fps", better: "higher" },
    wind: { label: "Wind bed", unit: "0-1" },
    sand: { label: "Sand hiss bed", unit: "0-1" },
    water: { label: "Water bed", unit: "0-1" },
    exposure: { label: "Terrain exposure", unit: "0-1" },
    biomeHit: { label: "Landed in the intended biome", unit: "1=yes", better: "higher" },
  },
  subjects,
  stage: stageWarlordFeel,
};
