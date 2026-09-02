#!/usr/bin/env node
/* tools/shark-sim-check.mjs — THE ORACLE for Shark Sim.

   Boots index.html?mode=sharksim exactly like the Shark Sim tile does,
   then plays the whole game the way a player would — pilot with the
   move keys, let the automatic bite feed, climb every rung of the ladder,
   eat an orca as the megalodon — asserting each stage against the live engine.

   DRIVEN BY CBZ.stepSim, NOT BY FRAMES. Under SwiftShader this page paints
   ~2 fps, which starves every real-time assertion (and is exactly the
   stalled-frame regime the mount bite's crossing-window fix exists for).
   Menu/boot run on real frames; once the match is up, game time advances in
   explicit 30 Hz stepSim bursts, so a wait is a number of GAME seconds and
   the tool is as fast as the CPU, not the rasterizer.

     node tools/shark-sim-check.mjs            # full ladder + orca + death run
     node tools/shark-sim-check.mjs --quick    # boot + mount + pilot + one meal
     node tools/shark-sim-check.mjs --json

   WHAT IT ASSERTS, in play order:
     1. THE GAME STANDS UP: sim on, a bull shark claimed+tamed+huntable, the
        player mounted with the rider hidden, water under the body, the
        crowd on the shore ring, an orca in the sea, the island nav wrap in.
     2. IT PILOTS: the move keys translate the mount through the water.
     3. IT EATS ON ITS OWN: survivors in front of the mouth die with no
        attack input, and mass is credited.
     4. IT EVOLVES: bull → hammerhead → great white → megalodon, each swap
        leaving the player mounted on the new body.
     5. IT DOES NOT END: as the megalodon, eating an orca is a MEAL, not a
        victory — the round stays "playing", no card comes up, the mass is
        credited and the pod restocks. (This game used to hand you a VICTORY
        screen for the one kill the whole climb aims at, which is the reward
        for winning being ejected from the water. Guarding the removal.)
     6. IT LOSES: on a fresh boot, the shark dying plays the death replay on
        the CORPSE — the rider is never killed and never reappears — and
        resolves to shark sim's own card, not survival's ELIMINATED.

   Screenshots land in artifacts/shark-sim/ (one frame rendered on demand —
   the RAF loop is not what advances this test). */
import { launch, sleep, ROOT } from "./lib/cdp.mjs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const arg = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d; };
const QUICK = has("--quick");
const JSON_OUT = has("--json");
const SEED = arg("--seed", "90210");
const BOTS = +arg("--bots", "60");
const say = (m) => { if (!JSON_OUT) console.log(m); };

const report = { ok: false, fails: [], stages: {}, errors: [], shots: [] };
const fail = (m) => { report.fails.push(m); say("  ✗ " + m); };
const pass = (m) => { say("  ✓ " + m); };

const SHOTS = path.join(ROOT, "artifacts", "shark-sim");
await mkdir(SHOTS, { recursive: true });

const rig = await launch({ rafBudget: 0 });

/* advance GAME time: n seconds of 30 Hz sim ticks in one evaluation */
const burst = (sec) => rig.evl(
  `(() => { for (let i = 0, n = ${Math.max(1, Math.round(sec * 30))}; i < n; i++) CBZ.stepSim(1/30); return true; })()`);
/* The same, with the LENS HELD SEAWARD every tick. The mount steers relative
   to the camera and the aquatic camera swings to follow the mount
   (systems/camera.js AQ_FOLLOW), so a hands-off "W" is a feedback loop whose
   final bearing depends on whatever nudged the shark that run — a bite-assist
   tug toward a swimmer, a hit-stop. Measured 2026-09-02: eight identical
   boots ended a 3.5 s sprint at headings spread across the whole circle, and
   several drove the shark straight up the beach. A player holding the stick
   keeps the lens where they put it; this does the same, re-aiming outward
   from the island centre each tick so the pilot stages assert steering, not
   the camera's drift. */
const burstSeaward = (sec) => rig.evl(
  `(() => { const A = CBZ.surv.arena, P = CBZ.player;
     for (let i = 0, n = ${Math.max(1, Math.round(sec * 30))}; i < n; i++) {
       if (CBZ.cam && A && P) { const dx = P.pos.x - A.center.x, dz = P.pos.z - A.center.z; CBZ.cam.yaw = Math.atan2(-dx, -dz); }
       CBZ.stepSim(1/30);
     } return true; })()`);
/* burst game time until an expression goes true (checked once per game second) */
async function burstUntil(expr, maxSec) {
  for (let t = 0; t < maxSec; t++) {
    if (await rig.evl(`(()=>{try{return !!(${expr})}catch(e){return false}})()`)) return true;
    await burst(1);
  }
  return rig.evl(`(()=>{try{return !!(${expr})}catch(e){return false}})()`);
}
async function shot(name) {
  try {
    // the boot meter's finish easing is RAF-driven; stepSim-starved pages can
    // leave the card up over a fully playing match — drop it via its own API
    await rig.evl("CBZ.bootMeter && CBZ.bootMeter.hide && CBZ.bootMeter.hide()");
    await rig.evl("CBZ.renderer && CBZ.renderer.render(CBZ.scene, CBZ.camera)");
    // stepSim never presents — give the (SwiftShader-slow) compositor a
    // moment to composite the freshly rendered canvas, or the capture hands
    // back whatever frame last made it to the screen (seen: the boot bar)
    await sleep(1800);
    const r = await Promise.race([
      rig.send("Page.captureScreenshot", { format: "jpeg", quality: 80 }),
      new Promise((res) => setTimeout(() => res(null), 15000)),
    ]);
    const data = r && r.result && r.result.data;
    if (!data) return;
    const f = path.join(SHOTS, name + ".jpg");
    await writeFile(f, Buffer.from(data, "base64"));
    report.shots.push(f);
    say("  📷 " + path.relative(ROOT, f));
  } catch (_) {}
}

/* Bring the hunt to the shallows first. Bait bots stand on the SEABED, and
   over deep water the bed is honestly below jaw reach — the game feeds in
   the wading band, so the assertions stage there too. `extra` adds standoff
   for the bigger bodies (a megalodon in 1 m of water is beached, not
   hunting). */
const SHALLOW = (extra) => `(() => {
  const A = CBZ.surv.arena, P = CBZ.player, s = CBZ.sharkSim;
  const ang = Math.atan2(P.pos.z - A.center.z, P.pos.x - A.center.x) || 0;
  const r = s.waterline + 6 + ${extra || 0};
  P.pos.x = A.center.x + Math.cos(ang) * r;
  P.pos.z = A.center.z + Math.sin(ang) * r;
  return +r.toFixed(1);
})()`;

/* Put N live survivors straight in front of the mounted shark's mouth and
   pin them there, so the automatic bite has something honest to land on. */
const FEED = (n) => `(() => {
  const S = CBZ.sharkSim.shark; if (!S) return 0;
  const h = S.heading || 0, dx = Math.cos(h), dz = Math.sin(h);
  // ahead of the REAL mouth — creatureJawPoint, not a guess: the megalodon's
  // jaw sits ~9.9 m forward of its root, and bait placed by a 2.1×scale
  // estimate landed BEHIND it
  const jp = (CBZ.creatureJawPoint && CBZ.creatureJawPoint(S)) || { x: 2.1 };
  const jaw = jp.x * (S.species.scale || 1);
  let placed = 0;
  for (let i = 0; i < CBZ.bots.length && placed < ${n}; i++) {
    const b = CBZ.bots[i];
    if (!b || b.dead) continue;
    const d = jaw + 1.2 + placed * 1.0;
    b.pos.x = S.pos.x + dx * d; b.pos.z = S.pos.z + dz * d;
    b.pos.y = CBZ.surv.floorAt(b.pos.x, b.pos.z);
    b.target.set(b.pos.x, 0, b.pos.z);
    b.pause = 30;
    placed++;
  }
  return placed;
})()`;

/* Park the pod far away and heal the shark. The orcas hunting the player IS
   the game (it killed a great white mid-ladder in an earlier run of this
   tool — working as designed); but stages asserting movement/eating/evolution
   mechanics must not be decided by whether the pod got a grip that run. */
const PEACE = `(() => {
  // ALL the big hunters, not just the pod: a wild megalodon seizing the
  // player's great white mid-rung was measurably draining hp between heals
  for (const a of CBZ.cityWildlife) {
    if (a.dead || !a.species || a === CBZ.sharkSim.shark) continue;
    if (a.species.id === "orca" || (a.species.aquatic && (a.species.bite || 0) >= 24)) {
      a.pos.x += 500; a.hunger = 0;
      if (a._waterMove) { a._waterMove.x = a.pos.x; a._waterMove.z = a.pos.z; }
    }
  }
  const S = CBZ.sharkSim.shark; if (S) S.hp = S.maxHp;
  CBZ.sharkSim.podT = 45;
  return 1;
})()`;

async function bootIntoMatch(label) {
  const t0 = Date.now();
  await rig.open("index.html", `mode=sharksim&seed=${SEED}`);
  if (!await rig.wait("window.CBZ && CBZ.game", 150000)) { fail(label + ": page never published CBZ"); return false; }
  await rig.evl(`CBZ.SURV_BOTS = ${BOTS}`);
  const playing = await rig.wait(`(() => {
    if (CBZ.game.state === 'playing' && CBZ.game.mode === 'sharksim') return true;
    // don't press PLAY until the engine has fully streamed in — clicking
    // early is a legitimate user race (healed in survival.reset), but this
    // tool is asserting the game, not the race
    if (!CBZ.cityWildlifeStock || !CBZ.spawnSurvivorBotAt || !CBZ.cityMountAnimal || !CBZ.stepSim) return false;
    const mb = document.querySelector('.mode-btn[data-mode="sharksim"]'); if (mb) mb.click();
    const pb = document.getElementById('playBtn'); if (pb) pb.click();
    return false;
  })()`, 240000, 300);
  if (!playing) { fail(label + ": never entered a survival match"); return false; }
  say(label + ": playable in " + (Date.now() - t0) + " ms");
  const armed = await burstUntil(`CBZ.sharkSim && CBZ.sharkSim.on && CBZ.sharkSim.shark &&
    CBZ.cityMountedAnimal && CBZ.cityMountedAnimal() === CBZ.sharkSim.shark`, 20);
  if (!armed) { fail(label + ": sim never claimed + mounted a shark"); return false; }
  /* Let the match-start frame finish. When the sim arms during the boot's own
     rAF frames the first poll above lands at elapsed ~0.1 s, inside the frame
     where survival's placement re-shows the castaway and before shark_sim's
     step() has hidden him again — a one-frame read that says "rider visible"
     about a state no player ever sees. Measured 2026-09-02: every such failure
     reported elapsed 0.1; after any burst the rider is hidden. */
  await burst(0.5);
  return true;
}

try {
  // ================= STAGE 1: THE GAME STANDS UP ==========================
  say("— stage 1: boot into the shark —");
  if (!await bootIntoMatch("boot")) throw new Error("no match");

  const s1 = await rig.evl(`(() => {
    const sim = CBZ.sharkSim, S = sim && sim.shark, P = CBZ.player, A = CBZ.surv.arena;
    if (!S) return { none: true };
    const ring = CBZ.sharkSimShoreRing;
    let shore = 0, live = 0, orcas = 0;
    for (const b of CBZ.bots) { if (b.dead) continue; live++;
      const r = Math.hypot(b.pos.x - A.center.x, b.pos.z - A.center.z);
      if (r > A.radius && r < A.radius + 40) shore++; }
    for (const a of CBZ.cityWildlife) if (!a.dead && a.species && a.species.id === "orca") orcas++;
    return {
      species: S.species.id, tamed: !!S.tamed, huntable: !!S.huntable,
      mounted: CBZ.cityMountedAnimal() === S, riderHidden: CBZ.playerChar.group.visible === false,
      aquaticMount: !!P._aquaticMount, ring: !!ring,
      depth: CBZ.survFloodDepthMeanAt ? CBZ.survFloodDepthMeanAt(P.pos.x, P.pos.z) : -1,
      py: +P.pos.y.toFixed(2), sea: +(CBZ.citySeaHeightAt(P.pos.x, P.pos.z)).toFixed(2),
      live, shore, orcas, hud: !!document.getElementById("sharkhud"),
      navWrapped: !!(CBZ.waterField && CBZ.waterField._survNavWrapped),
    };
  })()`);
  report.stages.boot = s1;
  if (s1.none) fail("no shark actor");
  else {
    if (s1.species !== "bull_shark") fail("start species is " + s1.species + ", wanted bull_shark");
    else pass("player IS a bull shark");
    if (!s1.tamed || !s1.huntable) fail("shark flags wrong (tamed=" + s1.tamed + " huntable=" + s1.huntable + ")");
    else pass("tamed + huntable (the pod may eat you)");
    if (!s1.mounted || !s1.aquaticMount) fail("not riding the shark");
    if (!s1.riderHidden) fail("the human rider is still visible on the shark's back");
    else pass("rider hidden — you are the shark, not a passenger");
    if (!s1.navWrapped) fail("island nav wrap missing — waterField.moveInWater is still city-only");
    if (!(s1.depth > 0.4)) fail("no water under the shark (depth " + s1.depth + ")");
    else pass("in the sea (depth " + s1.depth.toFixed(1) + " m, y " + s1.py + " vs surface " + s1.sea + ")");
    if (!s1.ring) fail("shore ring not published for the crowd");
    if (!(s1.shore >= Math.min(20, s1.live * 0.4))) fail("beach crowd thin: " + s1.shore + "/" + s1.live + " on the shore band");
    else pass(s1.shore + "/" + s1.live + " survivors on the beach/in the surf");
    if (!(s1.orcas >= 1)) fail("no orcas in the sea — no threat curve");
    else pass(s1.orcas + " orcas in the water");
    if (!s1.hud) fail("shark HUD missing");
  }
  await shot("1-bull-shark");

  // ================= STAGE 2: IT PILOTS ===================================
  say("— stage 2: pilot with the move keys —");
  await rig.evl(PEACE);
  // aim the camera SEAWARD so "W" is open water — pointed at the island the
  // shore-following nav legitimately trades distance for a turn along the bay
  await rig.evl(`(() => {
    const A = CBZ.surv.arena, P = CBZ.player;
    const dx = P.pos.x - A.center.x, dz = P.pos.z - A.center.z;
    if (CBZ.cam) CBZ.cam.yaw = Math.atan2(-dx, -dz);
    return 1;
  })()`);
  const p0 = await rig.evl(`({ x: CBZ.player.pos.x, z: CBZ.player.pos.z })`);
  await rig.evl(`(CBZ.keys.w = true, CBZ.keys.shift = true)`);
  await burstSeaward(3.5);
  const p1 = await rig.evl(`({ x: CBZ.player.pos.x, z: CBZ.player.pos.z, v: CBZ.player.speed })`);
  await rig.evl(`(CBZ.keys.a = true)`);
  await burstSeaward(1.6);
  const p2 = await rig.evl(`({ x: CBZ.player.pos.x, z: CBZ.player.pos.z })`);
  await rig.evl(`(CBZ.keys.w = false, CBZ.keys.a = false, CBZ.keys.shift = false)`);
  await burst(0.8);
  const moved = Math.hypot(p1.x - p0.x, p1.z - p0.z);
  const turned = Math.hypot(p2.x - p1.x, p2.z - p1.z);
  report.stages.pilot = { moved: +moved.toFixed(1), speed: p1.v, turnLeg: +turned.toFixed(1) };
  if (!(moved > 12)) fail("W+sprint moved the shark only " + moved.toFixed(1) + " m in 3.5 s");
  else pass("sprinted " + moved.toFixed(1) + " m (speed " + (p1.v || 0).toFixed(1) + " m/s)");
  if (!(turned > 3)) fail("steering leg barely moved (" + turned.toFixed(1) + " m)");

  // ================= STAGE 2.5: THE OPEN OCEAN ============================
  /* The sea used to end 150 m past the island's radius — an invisible wall
     (water_survival.js's nav fence) that a sprinting shark hit in about
     twenty seconds and then ground against: blocked steps, wall slides, the
     radial "safe direction" fighting the stick. The fence now tracks the
     drawn seabed's rim (arena.seaR, ~3 km). This stage drives straight out
     to sea for 75 game-seconds and asserts the world keeps being an ocean:
     the shark crosses the old fence line by a wide margin, its last leg
     covers water at the same stride as its first (no far-out movement rot),
     there is deep water under it, and the displaced water tile has followed
     the camera out instead of being left parked over the island. */
  say("— stage 2.5: the open ocean —");
  await rig.evl(PEACE);
  const homePos = await rig.evl(`({ x: CBZ.player.pos.x, z: CBZ.player.pos.z })`);
  await rig.evl(`(() => {
    const A = CBZ.surv.arena, P = CBZ.player;
    const dx = P.pos.x - A.center.x, dz = P.pos.z - A.center.z;
    if (CBZ.cam) CBZ.cam.yaw = Math.atan2(-dx, -dz);
    return 1;
  })()`);
  const radiusOf = `Math.hypot(CBZ.player.pos.x - CBZ.surv.arena.center.x, CBZ.player.pos.z - CBZ.surv.arena.center.z)`;
  await rig.evl(`(CBZ.keys.w = true, CBZ.keys.shift = true)`);
  const legs = [];
  for (let i = 0; i < 5; i++) {
    const a = await rig.evl(`({ x: CBZ.player.pos.x, z: CBZ.player.pos.z })`);
    await burstSeaward(15);
    const b = await rig.evl(`({ x: CBZ.player.pos.x, z: CBZ.player.pos.z, r: ${radiusOf} })`);
    legs.push({ m: +Math.hypot(b.x - a.x, b.z - a.z).toFixed(1), r: +b.r.toFixed(0) });
    await rig.evl(PEACE);   // hunters re-converge over a 75 s swim; this stage asserts the sea, not the pod
  }
  await rig.evl(`(CBZ.keys.w = false, CBZ.keys.shift = false)`);
  const far = await rig.evl(`(() => {
    const A = CBZ.surv.arena, P = CBZ.player, cam = CBZ.camera;
    const ring = CBZ.survNavRing ? CBZ.survNavRing(1.2) : null;
    return {
      r: +(${radiusOf}).toFixed(0),
      depth: +(CBZ.survFloodDepthMeanAt(P.pos.x, P.pos.z)).toFixed(1),
      seaR: A.seaR || 0,
      navR1: ring ? +ring.r1.toFixed(0) : 0,
      oceanDx: cam && A.ocean ? +Math.abs(A.ocean.position.x - cam.position.x).toFixed(0) : -1,
      oceanDz: cam && A.ocean ? +Math.abs(A.ocean.position.z - cam.position.z).toFixed(0) : -1,
    };
  })()`);
  report.stages.openOcean = { legs, far };
  const oldFence = await rig.evl(`CBZ.surv.arena.radius + 150`);
  if (!(far.r > oldFence + 120)) fail("open ocean: shark stopped at r=" + far.r + " m (old fence " + oldFence.toFixed(0) + ") — the wall is back");
  else pass("swam to r=" + far.r + " m — " + (far.r - oldFence).toFixed(0) + " m past the old fence");
  const firstLeg = legs[0].m, lastLeg = legs[legs.length - 1].m;
  if (!(lastLeg > firstLeg * 0.6)) fail("open ocean: stride collapsed far out (" + firstLeg + " m first 15 s vs " + lastLeg + " m last)");
  else pass("full stride far out (" + firstLeg + " m first 15 s leg, " + lastLeg + " m last)");
  if (!(far.depth > 5)) fail("open ocean: only " + far.depth + " m of water under the shark far out");
  if (!(far.navR1 > 1500)) fail("open ocean: survNavRing r1=" + far.navR1 + " m — the measured sea is still a pen");
  if (!(far.oceanDx >= 0 && far.oceanDx < 1100 && far.oceanDz < 1100)) fail("open ocean: water tile did not follow the camera (offset " + far.oceanDx + "/" + far.oceanDz + " m)");
  else pass("water tile riding with the camera (" + far.oceanDx + "/" + far.oceanDz + " m off), " + far.depth + " m of water below, navRing out to " + far.navR1 + " m");
  /* THE ARCHIPELAGO (owner: "make there be more islands like main island
     that just spawn past horizon"): islets scattered across the annulus,
     each a real shore (dry at its centre, open water past its foot), drawn
     by its own mesh, and invisible to the spawners — no fish may ever be
     dealt onto a cay's sand. All static evals, no sim time. */
  const arch = await rig.evl(`(() => {
    const A = CBZ.surv.arena, wf = CBZ.waterField;
    const isl = A.islets || [];
    let dry = 0, wet = 0, spawnBad = 0, spawnNull = 0, drawn = 0;
    CBZ.scene.traverse((o) => { if (o.material && o.material.name === "survival-islets") drawn++; });
    for (const it of isl) {
      if (!wf.isNavigableWater(it.x, it.z, 1.2)) dry++;
      if (wf.isNavigableWater(it.x + it.rw + 160, it.z, 8)) wet++;
    }
    for (let k = 0; k < 150; k++) {
      const p = wf.randomWaterPoint(Math.random, { clearance: 6 });
      if (!p) { spawnNull++; continue; }
      if (!wf.isNavigableWater(p.x, p.z, 3)) spawnBad++;
    }
    return { n: isl.length, dry, wet, drawn, spawnBad, spawnNull };
  })()`);
  report.stages.openOcean.archipelago = arch;
  if (!(arch.n >= 6)) fail("archipelago: only " + arch.n + " islets placed");
  else if (!(arch.dry === arch.n && arch.wet === arch.n)) fail("archipelago: " + arch.dry + "/" + arch.n + " dry at centre, " + arch.wet + "/" + arch.n + " open water past the foot");
  else pass(arch.n + " islets: every centre is dry land, every foot returns to open water");
  if (!(arch.drawn === 1)) fail("archipelago: islet mesh not in the scene (found " + arch.drawn + ")");
  if (!(arch.spawnBad === 0 && arch.spawnNull < 8)) fail("archipelago: " + arch.spawnBad + "/150 spawn points on land, " + arch.spawnNull + " refusals — fish will freeze on the cays");
  else pass("150 spawn draws, zero on land (" + arch.spawnNull + " honest refusals)");

  /* THE PEN IS SAND, NOT A FENCE (owner: "the pen should be land and beach
     like there is on the island"). Park just off the far coast, drive
     straight at it, and assert the shark runs AGROUND: it stops in the far
     surf in grounding-depth water — not fence-stopped in deep open water —
     with real drawn land rising beyond it. */
  await rig.evl(`(() => {
    const A = CBZ.surv.arena, P = CBZ.player;
    P.pos.x = A.center.x + (A.seaR - 90); P.pos.z = A.center.z;
    const dx = P.pos.x - A.center.x, dz = P.pos.z - A.center.z;
    if (CBZ.cam) CBZ.cam.yaw = Math.atan2(-dx, -dz);   // face the far beach
    return 1;
  })()`);
  await rig.evl(`(CBZ.keys.w = true, CBZ.keys.shift = true)`);
  await burstSeaward(14);
  await rig.evl(`(CBZ.keys.w = false, CBZ.keys.shift = false)`);
  const beach = await rig.evl(`(() => {
    const A = CBZ.surv.arena, P = CBZ.player;
    const g = A.groundHeightAt(A.center.x + A.seaR + 80, A.center.z);
    return {
      r: +(${radiusOf}).toFixed(0), seaR: A.seaR,
      depth: +(CBZ.survFloodDepthMeanAt(P.pos.x, P.pos.z)).toFixed(2),
      landBeyond: +g.toFixed(2),
    };
  })()`);
  report.stages.openOcean.beach = beach;
  if (!(beach.r > beach.seaR - 60 && beach.r < beach.seaR + 30)) fail("far coast: drove at the beach from 90 m out and stopped at r=" + beach.r + " (waterline " + beach.seaR + ") — that is a fence stop, not a grounding");
  else if (!(beach.depth < 1.3)) fail("far coast: stopped at the waterline but in " + beach.depth + " m of water — grounded on nothing");
  else pass("ran aground on the far coast at r=" + beach.r + " (waterline " + beach.seaR + "), " + beach.depth + " m of surf under the hull");
  if (!(beach.landBeyond > 1)) fail("far coast: no land beyond the waterline (ground at +80 m = " + beach.landBeyond + " m) — the beach is not drawn/walked");
  else pass("dry land rises beyond it (+" + beach.landBeyond + " m at 80 m inland)");
  await shot("2b-far-coast-aground");
  // Leave the world as stage 2 left it: a kilometre-plus commute back would
  // put stage 3's surf staging at the mercy of this stage's swim, and stages
  // must not decide each other. Position is player-authoritative on a ride
  // (wildlife_tame integrates from P.pos), so this teleports the mount too.
  await rig.evl(`(CBZ.player.pos.x = ${homePos.x}, CBZ.player.pos.z = ${homePos.z}, 1)`);
  await burst(1.2);

  // ================= STAGE 3: IT EATS ON ITS OWN ==========================
  say("— stage 3: automatic bite —");
  await rig.evl(PEACE);
  await rig.evl(SHALLOW(0));
  await burst(0.5);
  const fed = await rig.evl(FEED(3));
  if (!(fed >= 1)) fail("could not stage bait bots");
  const ate = await burstUntil("CBZ.sharkSim.eaten >= 1", 10);
  const s3 = await rig.evl(`(() => { const A = CBZ.aquaticMountAudit();
    return { eaten: CBZ.sharkSim.eaten, mass: CBZ.sharkSim.mass,
      fires: CBZ.sharkSim.fireN || 0, attacks: A.attacks, hits: A.hits,
      tgt: A.attackTarget, tgtD: A.attackTargetDistance }; })()`);
  report.stages.eat = s3;
  if (!ate) fail("no automatic bite landed in 10 game-seconds with prey at the mouth (" + JSON.stringify(s3) + ")");
  else pass("ate " + s3.eaten + " (mass " + s3.mass + ", " + s3.attacks + " attacks/" + s3.hits + " hits) with zero attack input");

  if (QUICK) {
    report.ok = report.fails.length === 0;
    say(report.ok ? "\nQUICK: ALL GOOD" : "\nQUICK: FAILS " + report.fails.length);
  } else {
    // ================= STAGE 4: THE LADDER ================================
    say("— stage 4: the evolution ladder —");
    const LADDER = [
      { tier: 1, id: "hammerhead_shark", massTo: 13 },
      { tier: 2, id: "great_white_shark", massTo: 33 },
      { tier: 3, id: "megalodon", massTo: 74 },
    ];
    for (const rung of LADDER) {
      /* staged in ROUNDS: by the later rungs the island's first disaster is
         live and can sweep the bait off the seabed mid-wait (seen: a rung
         starved while a tsunami cleared the wading band) — and a spontaneous
         wild meal during the settle burst can shift mass. Re-pin both each
         round; setting mass is idempotent because evolve() consumes the
         threshold via tier. */
      const cond = `CBZ.sharkSim.tier === ${rung.tier} &&
        CBZ.sharkSim.shark && CBZ.sharkSim.shark.species.id === "${rung.id}" &&
        CBZ.cityMountedAnimal() === CBZ.sharkSim.shark && !CBZ.sharkSim.shark.dead`;
      let up = false;
      for (let round = 0; round < 5 && !up; round++) {
        await rig.evl(PEACE);
        /* the SURF, not "kind of near shore": the shelf hits ~6.5 m depth by
           WL+30, where bed-standing bait is honestly below jaw reach — the
           bed-riding clamp fix lets even the megalodon hunt at WL+10 */
        await rig.evl(SHALLOW(4));
        await burst(0.4);
        await rig.evl(`(CBZ.sharkSim.mass = Math.max(CBZ.sharkSim.mass, ${rung.massTo}))`);
        await rig.evl(FEED(2));
        up = await burstUntil(cond, 4);
      }
      if (!up) {
        const why = await rig.evl(`(() => { const s = CBZ.sharkSim, S = s.shark;
          return { tier: s.tier, mass: s.mass, eaten: s.eaten, ended: s.ended,
            species: S ? S.species.id : null, dead: S ? S.dead : null,
            hp: S ? Math.round(S.hp) : null, pdead: CBZ.player.dead }; })()`);
        fail("never evolved into " + rung.id + " — " + JSON.stringify(why));
        break;
      }
      pass("evolved → " + rung.id + " (still mounted)");
      await shot((1 + rung.tier) + "-" + rung.id.replace(/_/g, "-"));
    }

    // ============ STAGE 5: THE ORCA IS A MEAL, NOT AN ENDING ==============
    say("— stage 5: eat an orca, keep swimming —");
    const tier = await rig.evl("CBZ.sharkSim.tier");
    if (tier === 3) {
      const STAGE_ORCA = `(() => {
        const S = CBZ.sharkSim.shark;
        let o = null;
        for (const a of CBZ.cityWildlife) if (!a.dead && a.species && a.species.id === "orca") { o = a; break; }
        if (!o) return false;
        const h = S.heading || 0;
        const jp = (CBZ.creatureJawPoint && CBZ.creatureJawPoint(S)) || { x: 2.1 };
        const jaw = jp.x * (S.species.scale || 1);
        o.hp = 40;                      // already mauled — one megalodon bite finishes it
        o.pos.x = S.pos.x + Math.cos(h) * (jaw + 1.5);
        o.pos.z = S.pos.z + Math.sin(h) * (jaw + 1.5);
        o.pos.y = S.pos.y;
        if (o._waterMove) { o._waterMove.x = o.pos.x; o._waterMove.z = o.pos.z; }
        return true;
      })()`;
      let staged = false, ate = false;
      for (let round = 0; round < 4 && !ate; round++) {
        staged = await rig.evl(STAGE_ORCA) || staged;
        ate = await burstUntil(`(CBZ.sharkSim.orcas || 0) > 0`, 4);
      }
      // ..and then keep playing. If anything still ends the run on that kill,
      // these extra seconds are where it shows up.
      await burst(6);
      const s5 = await rig.evl(`({ state: CBZ.game.state, orcas: CBZ.sharkSim.orcas || 0,
        ended: !!CBZ.sharkSim.ended, on: !!CBZ.sharkSim.on, mass: CBZ.sharkSim.mass,
        winShown: !document.getElementById("survwin").classList.contains("hidden"),
        loseShown: !document.getElementById("survlose").classList.contains("hidden"),
        apexProp: "apex" in CBZ.sharkSim,
        pod: CBZ.cityWildlife.filter(a => !a.dead && a.species && a.species.id === "orca").length })`);
      report.stages.orca = s5;
      if (!staged) fail("no orca available to stage the kill");
      if (!ate) fail("the megalodon never ate the staged orca");
      else if (s5.state !== "playing") fail("eating an orca ended the run — state " + s5.state);
      else if (s5.ended) fail("eating an orca set sim.ended (the run stopped driving)");
      else if (s5.winShown) fail("a victory card came up for eating an orca");
      else if (s5.loseShown) fail("a loss card came up for eating an orca");
      else if (s5.apexProp) fail("sim.apex is back — the win state was reintroduced");
      else pass("ate " + s5.orcas + " orca, still playing (mass " + s5.mass + ")");
      // THE POD RESTOCKS: the endgame is hunting it, so the sea must not run dry.
      if (s5.pod < 1) {
        const back = await burstUntil(`CBZ.cityWildlife.filter(a => !a.dead && a.species && a.species.id === "orca").length >= 3`, 20);
        if (!back) fail("the pod never restocked after the megalodon ate one");
        else pass("the pod restocked to 3");
      } else pass("pod still in the water (" + s5.pod + ")");
      await shot("5-orca-eaten-still-playing");
    }

    // ================= STAGE 6: THE DEATH =================================
    // A SHARK DIES HERE, NOT A MAN. The old flow flung the rider's body out of
    // the water in a ragdoll and showed survival's ELIMINATED · #14 of 100 ·
    // Disasters card; this stage exists to keep that from coming back, so it
    // asserts the two halves of the fix: the human is never killed and never
    // reappears, and the card that lands is the shark run's own.
    say("— stage 6: the pod wins (fresh boot) —");
    rig.clearErrors();
    if (await bootIntoMatch("reboot")) {
      await rig.evl(`(() => { const S = CBZ.sharkSim.shark; S.hp = 0; S.dead = true; })()`);
      // the replay beat first: dead shark, live (hidden) rider, camera orbiting
      const beat = await burstUntil(`!!CBZ.sharkSim.death`, 4);
      const s6a = await rig.evl(`({ beat: !!CBZ.sharkSim.death, pdead: CBZ.player.dead,
        rider: CBZ.playerChar.group.visible, spect: !!CBZ.surv.spectating,
        killer: CBZ.sharkSim.killer || "" })`);
      if (!beat) fail("shark death did not start the death replay (" + JSON.stringify(s6a) + ")");
      else if (s6a.pdead) fail("the RIDER was killed by the shark's death — that is the nat-disaster death flow");
      else if (s6a.rider) fail("the rider became visible over his own shark's corpse");
      else pass('shark died → death replay on the corpse, rider still hidden and alive (killer: "' + s6a.killer + '")');
      await shot("6-the-body-that-died");
      // ..then the card, which must be this game's and not the island's
      const carded = await burstUntil(`CBZ.game.state === "lost"`, 8);
      const s6 = await rig.evl(`(() => { const b = document.getElementById("survlose"); return {
        state: CBZ.game.state, pdead: CBZ.player.dead, rider: CBZ.playerChar.group.visible,
        spect: !!CBZ.surv.spectating,
        logo: (b.querySelector(".logo") || {}).textContent || "",
        sub: (b.querySelector(".sub") || {}).textContent || "",
        place: (document.getElementById("slPlace") || {}).textContent || "",
        placeL: (document.getElementById("slTotal") || {}).textContent || "",
        disL: ((document.getElementById("slDis") || {}).nextElementSibling || {}).textContent || "" }; })()`);
      report.stages.death = s6;
      if (!carded) fail("the death never resolved to a card (" + JSON.stringify(s6) + ")");
      else if (s6.pdead) fail("the rider was killed on the way to the card");
      else if (/ELIMINATED/i.test(s6.logo) || /of 100/.test(s6.placeL) || /Disaster/i.test(s6.disL))
        fail("the shark death is still wearing survival's card: " + JSON.stringify(s6));
      else pass('LOST — "' + s6.logo + " · " + s6.sub + '" (' + s6.place + " " + s6.placeL + ", " + s6.disL + ")");
      await shot("6-eaten-by-the-pod");
    }
  }

  // ---- uncaught errors are failures wherever they came from --------------
  const pageErrors = rig.errors.filter((e) => !/favicon/i.test(e));
  report.errors = pageErrors;
  if (pageErrors.length) fail(pageErrors.length + " uncaught page errors (first: " + pageErrors[0] + ")");
  else pass("zero uncaught page errors");

  report.ok = report.fails.length === 0;
  if (JSON_OUT) console.log(JSON.stringify(report, null, 2));
  else say(report.ok ? "\nSHARK SIM: ALL " + Object.keys(report.stages).length + " STAGES GOOD"
    : "\nSHARK SIM: " + report.fails.length + " FAILURES");
  process.exitCode = report.ok ? 0 : 1;
} catch (e) {
  fail("aborted: " + (e && e.message));
  if (JSON_OUT) console.log(JSON.stringify(report, null, 2));
  process.exitCode = 1;
} finally {
  await rig.close();
}
