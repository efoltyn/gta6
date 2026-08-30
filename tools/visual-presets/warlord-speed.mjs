/* DESERT WARLORD — STAND STILL AND LET THE ISLAND COME TO YOU.

   OWNER, 2026-08-30:

       "ALSO A SLIDER TO SPEED UP AND SLOW DOWN GAME SPEED GOING UP TO
        INSANELY FAST SO YOU CAN BASICALLY NOT MOVE AND PEOPLE COME TO YOU
        WITHOUT EVEN HARDCODING THIS THIS REALLY MAKES TESTING FASTER
        SPEEDMAXXING"

   THE THIRD SUBJECT IS THE WHOLE ASK, LITERALLY STAGED. Six war parties are
   placed on a 1200 m ring around a warlord who does not move a step, and both
   columns are then given the SAME NUMBER OF WALL SECONDS. That is the only
   variable in the pair: one side has a speed control and one does not.

   WHY THIS IS NOT A ONE-LINE MULTIPLY, which is what the first two subjects
   are photographs of:

     · THE WORLD DID NOT READ THE LOOP'S dt. campaign.js's worldTick — the
       day, the wages, and every party walking — read performance.now()
       itself and threw the frame's dt away, on purpose, so a slow machine
       would not run the island in slow motion. battle.js does the same. So
       does events.js's weather. Multiplying a dt that nobody reads moves the
       label and nothing else. All three now ask W.clock.now(), which is the
       same monotonic millisecond count with the speed in it, and core.js is
       the only place that number exists.

     · A BIG dt IS NOT MANY SMALL ONES. dt × 64 in one step is a party
       integrating 700 m and walking through a mesa on the way. microboot's
       tick() splits the frame into substeps of at most 1/30 s, which is
       finer than the clamp every integrator on this page already imposes on
       itself, so nothing downstream was told about the speed at all.

     · A LIVE MATCH REFUSES. Seven warlords ride one island against one wall
       clock and one of them cannot run time faster. match.js takes a hold on
       the clock and the control says MATCH.

   WHAT TO LOOK FOR
     · the-control / at-maximum — the pill under the FIT button on the left,
       and at anything but 1× a matching chip in the HUD strip, which is the
       one readout that follows you into a full screen.
     · they-come-to-you — BEFORE: six columns still sitting a kilometre out,
       the day clock barely moved. AFTER: they are on top of you and the day
       has turned. `nearest` and `dayHours` are the claim.

   THE BEFORE SIDE IS origin/main WITH ONE LINE DELETED, and that has to be
   said out loud: e8f2040 removed desert.js's scatter system and left
   `scCX = scCZ = NaN;` behind it. Both names went with the system, the file
   is "use strict", and a strict-mode assignment to an undeclared name THROWS
   — so build() dies on that line and origin/main raises no island at all.
   Without deleting it the BEFORE column is a boot screen and the pair says
   nothing about a speed slider. That deletion is in this branch too.
*/

/* HARNESS TRAP: `stage` is serialised into the page as a bare function
   expression, so NOTHING at module scope is visible inside it — a const up
   here reaches the subjects array (that is data, and it is serialised) and
   dies with a ReferenceError inside the stage. The staging numbers therefore
   ride ON the subject. */
const RING = 1200;      // metres. Far enough that 1x cannot close it in the
                        // wall budget, near enough that they are hunting.
const WALL_MS = 9000;   // the same nine seconds on both sides. THE variable.
const STOP_AT = 110;    // stop well before CONTACT (26 m) opens the encounter
                        // rail — this pair is about the approach, and a rail
                        // over a hidden island is not a picture of anything.

const subjects = [
  { id: "the-control", scale: 8,
    label: "The Control — A Pill Under The FIT Button",
    focus: "Riding at 8×. Every corner of this game was already spoken for — the HUD owns the top strip, wardrobe's FIT button the top left at +52, the MAP button and the zoom pair the top right, the compass the bottom centre, the match strip and the verb rail the bottom edge — so the pill takes the one free block, at the same 14 px inset off the same --wl-safe-* variables everything else here uses. BEFORE: no control, and no way to make the island hurry." },

  { id: "at-maximum", scale: 64,
    label: "64× — And The HUD Admits It",
    focus: "64× is derived, not chosen: 32 substeps of 1/30 s is 1.07 s of world per rendered frame, which at 60 fps is exactly 64 game-seconds per wall second. Note the second readout in the HUD strip — the slider is campaign furniture and hides under the armoury, but a day at 64× costs sixty-four days of wages while you read a roster, so the chip follows you in there." },

  { id: "they-come-to-you", scale: 32, ring: RING, wallMs: WALL_MS, stopAt: STOP_AT,
    label: "Stand Still And Let Them Come — Nine Seconds, Both Sides",
    focus: "Six war parties on a 1200 m ring around a warlord who does not move. Both columns get the same nine wall seconds. BEFORE: they are still a kilometre out and the hour has barely turned. AFTER: they are on top of him. `nearest` is the number the owner asked for." },
];

async function stageSpeed(input) {
  const CBZ = window.CBZ, sub = input.subject;
  if (!CBZ || !CBZ.warlord) return { ok: false, missing: "warlord" };
  const W = CBZ.warlord, S = W.state;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  /* THE BEFORE COLUMN HAS NO CLOCK, and every reach into it is guarded for
     that reason: origin/main has no W.clock at all, so the whole point of the
     before side is that these calls do nothing. A preset that threw there
     would produce an error page instead of the comparison. */
  const C = W.clock || null;

  if (!window.__cbzVisualCompare) {
    window.__cbzVisualCompare = {
      async render() {
        if (CBZ.renderer && CBZ.camera) { try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (e) {} }
        await new Promise((r) => setTimeout(r, 800));
      },
      metrics() { return window.__wlSpeedM || {}; },
    };
  }

  for (let t = 0; t < 500 && (!W.phase() || W.phase() === "boot"); t++) await sleep(120);
  if (!W.phase() || W.phase() === "boot") return { ok: false, missing: "boot never finished" };
  if (W.phase() !== "campaign") { W.setPhase("campaign"); await sleep(200); }
  if (W.territory && W.territory.isOpen && W.territory.isOpen()) W.territory.toggle();

  const D = W.desert;
  const near = (b) => Math.hypot(b.x - S.you.x, b.z - S.you.z);
  /* THE TWO CONTROL SHOTS PUBLISH NO DISTANCE, and that is a correction: the
     first run reported `nearest` for them too, off whichever roaming party
     happened to be closest, and since the metric is declared better:lower it
     read as four regressions in a pair where nothing was being raced. A
     number that is not about the subject does not belong in the subject's
     row. They publish what they are about — the setting, what the loop
     delivered, and what that cost the frame. */
  const snapshot = function (wallSec, hours0, ring) {
    const m = {
      speed: C ? C.scale() : 1,
      achieved: C ? Math.round(C.achieved() * 10) / 10 : 1,
      fps: CBZ.micro.fps,
      substeps: CBZ.micro.subCount || 1,
    };
    if (!ring) return m;
    let nearest = Infinity, within = 0;
    for (let i = 0; i < S.bands.length; i++) {
      const d = near(S.bands[i]);
      if (d < nearest) nearest = d;
      if (d < 400) within++;
    }
    m.nearest = Math.round(nearest);
    m.within400 = within;
    m.dayHours = Math.round((S.day * 24 + S.hour - hours0) * 100) / 100;
    m.wallSec = Math.round(wallSec * 10) / 10;
    return m;
  };

  /* Every staging number comes off the subject — see the HARNESS TRAP note
     at the top of this file: module scope does not exist in here. */
  const RING = sub.ring || 1200, WALL_MS = sub.wallMs || 9000, STOP_AT = sub.stopAt || 70;

  if (!sub.ring) {
    /* THE TWO CONTROL SHOTS. Nothing is posed: the pill is drawn by the
       page's own CSS at this frame's real width, and the parties are calmed
       so nobody rides in and replaces the picture with an encounter rail. */
    for (let i = 0; i < S.bands.length; i++) S.bands[i].cooldown = 1e9;
    if (C) C.setScale(sub.scale);
    if (W.campaign && W.campaign.camDist) W.campaign.camDist(46);
    for (let i = 0; i < 40; i++) CBZ.stepSim(1 / 30);
    await sleep(500);
    window.__wlSpeedM = snapshot(0, S.day * 24 + S.hour);
    /* THE NUMBERS RIDE HOME ON THE STAGE'S RETURN VALUE, not only on the
       metrics() hook. HARNESS TRAP: ba samples __cbzVisualCompare.metrics()
       ONLY inside the film-strip branch (ba/adapters/web.mjs, after the strip
       loop), so a subject with no `strip:` declared its metrics, published a
       hook and reported nothing at all — the first run of this preset came
       back "0 better · 0 matched · 0 unchanged" with every stage green. The
       hook is kept because it is the documented seam; `metrics` on the return
       is what actually arrives. */
    return { ok: true, metrics: window.__wlSpeedM,
             control: !!document.querySelector("#wlSpeed.on"), scale: C ? C.scale() : 1 };
  }

  /* ---- THE MONEY SHOT ---------------------------------------------------
     The ring is built by hand rather than found, because "the nearest party
     happened to be closer on one side" is not a measurement of anything. Same
     six parties, same six bearings, same radius, same size, on both columns —
     built through W.makeBand so they are real rosters with real men in them,
     not markers. */
  S.bands.length = 0;
  const home = D.landPoint ? { x: 0, z: 0 } : { x: 0, z: 0 };
  S.you.x = home.x; S.you.z = home.z;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.4;
    let bx = S.you.x + Math.cos(a) * RING, bz = S.you.z + Math.sin(a) * RING;
    /* ON LAND OR NOT AT ALL. A party spawned in the sea is one that spends
       the whole shot turning against a coast, on both sides, and the pair
       then measures the coastline. Walk in toward the player until the
       ground is land — the same walk on both columns, same seed, same
       heightfield. */
    for (let k = 0; k < 40 && !D.onLand(bx, bz); k++) {
      bx = S.you.x + Math.cos(a) * (RING - k * 25);
      bz = S.you.z + Math.sin(a) * (RING - k * 25);
    }
    const b = W.makeBand({ size: 26, faction: "raider", x: bx, z: bz });
    b.cooldown = 0; b.mood = "hunt"; b.think = 0;
    S.bands.push(b);
  }
  const hours0 = S.day * 24 + S.hour;
  if (C) C.setScale(sub.scale);
  for (let i = 0; i < S.bands.length; i++) S.bands[i].mood = "hunt";

  /* THE WALL BUDGET IS THE EXPERIMENT. Not a step count, not a game-time
     target — nine real seconds of a real frame loop, identical on both sides,
     and whatever the world does with them is the answer. */
  const t0 = performance.now();
  while (performance.now() - t0 < WALL_MS) {
    await sleep(90);
    let nearest = Infinity;
    for (let i = 0; i < S.bands.length; i++) nearest = Math.min(nearest, near(S.bands[i]));
    if (nearest < STOP_AT) break;
    if (W.phase() !== "campaign") break;   // somebody arrived
  }
  const spent = (performance.now() - t0) / 1000;
  window.__wlSpeedM = snapshot(spent, hours0, true);
  window.__wlSpeedM.startedAt = RING;
  window.__wlSpeedM.closed = RING - window.__wlSpeedM.nearest;

  /* THE SHOT IS TAKEN WITH THE CLOCK BACK AT 1×, and the first run of this
     preset is why. It stopped the approach at 70 m, took the numbers, then
     slept 300 ms before the screenshot — 300 ms which at 32× is nine and a
     half game seconds, which is eighty more metres, which is contact. The
     encounter rail opened, campaign.js hid the island behind it because a
     phase that does not own the screen does not draw, and the AFTER column
     came back as a flat cream rectangle. A fast-forward that is still running
     while the shutter is open photographs whatever it ran into.

     Then the camera turns to face whoever got closest. Both columns do the
     same thing to their own nearest party, which is what a player looking for
     the men who are hunting him would do; on the before side that is still a
     speck a kilometre out, and that is the picture. */
  if (C) C.setScale(1);
  let best = null, bd = Infinity;
  for (let i = 0; i < S.bands.length; i++) {
    const d = near(S.bands[i]);
    if (d < bd) { bd = d; best = S.bands[i]; }
  }
  if (best && W.campaign) {
    if (W.campaign.camYaw) W.campaign.camYaw(Math.atan2(best.x - S.you.x, best.z - S.you.z));
    if (W.campaign.camDist) W.campaign.camDist(120);
  }
  for (let i = 0; i < 34; i++) CBZ.stepSim(1 / 30);
  /* AND THE SLIDER GOES BACK TO WHAT DID THIS. A photograph captioned "32×"
     showing a control that reads 1× argues against itself. So the parties are
     halted first — camped, and their cooldown parked, so nobody walks the
     last hundred metres into CONTACT while the shutter is open — and only
     then does the setting go back. The world is at 32× in the picture and
     nothing in it is moving, which is exactly what a still of a fast-forward
     honestly is. */
  for (let i = 0; i < S.bands.length; i++) {
    S.bands[i].mood = "camp"; S.bands[i].pause = 1e9; S.bands[i].cooldown = 1e9;
  }
  if (C) C.setScale(sub.scale);
  await sleep(300);
  return { ok: true, metrics: window.__wlSpeedM,
           nearest: window.__wlSpeedM.nearest, spent: Math.round(spent * 10) / 10 };
}

export default {
  id: "warlord-speed",
  title: "Desert Warlord: A Game-Speed Slider That Moves The World",
  description:
    "BEFORE is origin/main served from its own worktree; AFTER is this tree. Same seed, same island, same device frame. The first two subjects are the control itself on a laptop and on a phone. The third is the owner's sentence staged as an experiment: six war parties on a 1200 m ring, a warlord who does not move, and the same nine wall seconds given to both columns.",
  page: "games/warlord.html",
  beforeLabel: "BEFORE · origin/main",
  afterLabel: "AFTER · one clock, substepped",
  viewport: { width: 1280, height: 800 },
  readyExpression:
    "window.__warlordReady === true && !!(window.CBZ && CBZ.warlord && CBZ.warlord.state && CBZ.warlord.desert)",
  urlParams: { go: 1, seed: 1337, weather: "off", sound: "off" },
  stageTimeoutMs: 420000,
  subjects,
  stage: stageSpeed,
  pairNote: "seed 1337 · the same six parties on the same ring · the same nine wall seconds on both sides",
  method:
    "Two servers, two checkouts, one seed. The preset boots straight onto the island, clears the roaming population, and builds six raider parties through W.makeBand at fixed bearings on a 1200 m ring around the player — real rosters, not markers — each walked inward until it stands on land so neither column is measuring a coastline. The player is placed at the island centre and never moves. Both sides then run their own real frame loop for nine wall seconds and stop early only if somebody gets within 70 m, which is short of the 26 m that would open the encounter rail. The AFTER side sets W.clock.setScale(32) first; the BEFORE side has no W.clock at all and the call is guarded, which is the entire difference between the columns.\n\nThe BEFORE checkout is origin/main with one line deleted: e8f2040 removed desert.js's scatter system and left `scCX = scCZ = NaN;` behind, both names went with the system, and a strict-mode assignment to an undeclared name throws — so build() dies there and origin/main raises no island at all. Without that deletion the BEFORE column is a boot screen. The same deletion is in this branch.",
  metrics: {
    nearest:   { label: "Metres to the closest war party at the end", unit: "m", better: "lower" },
    closed:    { label: "…metres they closed in those nine seconds", unit: "m", better: "higher" },
    within400: { label: "Parties inside 400 m", unit: "parties", better: "higher" },
    dayHours:  { label: "Game hours the island lived through", unit: "h", better: "higher" },
    wallSec:   { label: "Real seconds spent", unit: "s" },
    speed:     { label: "Speed setting", unit: "×" },
    achieved:  { label: "…and what the loop actually delivered", unit: "×" },
    substeps:  { label: "Sim substeps per rendered frame", unit: "steps" },
    fps:       { label: "Frames drawn per second", unit: "fps" },
  },
  metricsNote:
    "nearest and closed are the owner's sentence as a number: the same nine wall seconds buy 200-odd metres of approach at 1× and the whole ring at 32×. dayHours is the guard that says the WORLD moved rather than the animation — it comes from campaign.js's day clock, which is the thing that reads the game clock. speed against achieved is the honest pair: 64× is what the slider asks for, achieved is what this machine's frame loop delivered inside its 22 ms substep budget, and on a software rasteriser those are very different numbers. substeps is 1 at 1× on a healthy frame, which is why nothing changed for anyone who never touches the slider. wallSec should read the same on both columns; it is there so a reader can check that.",
};
