#!/usr/bin/env node
/* ============================================================
   tools/warlord-speed.mjs — DOES THE WORLD ACTUALLY RUN AT 64x,
   AND IS IT STILL A WORLD WHEN IT DOES?

   OWNER, 2026-08-30:

       "ALSO A SLIDER TO SPEED UP AND SLOW DOWN GAME SPEED GOING UP TO
        INSANELY FAST SO YOU CAN BASICALLY NOT MOVE AND PEOPLE COME TO YOU
        WITHOUT EVEN HARDCODING THIS THIS REALLY MAKES TESTING FASTER"

   A speed slider is the easiest feature in games to FAKE and the hardest to
   be honest about, because every way of faking it looks right in a
   screenshot. The three lies this file exists to catch:

     1. THE SLIDER MOVES AND NOTHING ELSE DOES. campaign.js's worldTick,
        battle.js's frame and events.js's weather each read performance.now()
        directly and threw the loop's dt away — deliberately, so a slow
        machine would not run the world in slow motion. A time scale
        implemented as a dt multiplier moves the label and not the island.
        RULE A measures the DAY CLOCK and the BANDS, not the setting.

     2. IT "WORKS" BY BREAKING THE SIM. dt × 64 in one step is a party
        integrating 700 m and walking through a mesa on the way. RULE B
        samples every band four times a second at maximum speed and fails on
        any displacement a party could not physically have walked, on any
        band standing off the island, and on any band whose ground height is
        not the ground height under it.

     3. FAST-FORWARD IS A DIFFERENT GAME. RULE C runs the same seed twice —
        thirty game-seconds at 1x, then the same thirty at 16x — and requires
        the two worlds to be the same world: the same day and hour, a
        comparable population, and parties that walked a comparable distance.
        Not identical: band AI rolls a shared seeded stream and the number of
        draws depends on the step pattern. Comparable, and never nonsense.

     4. THE INTERFACE LIES. RULE D reads the chip, the slider and the HUD, and
        then starts a match — where the scale is PINNED at 1 because seven
        warlords share one wall clock — and requires the control to say so.

     node tools/warlord-speed.mjs
     node tools/warlord-speed.mjs --verbose
     node tools/warlord-speed.mjs --only A,D

   Exit 0 clean, 1 on any failure.
============================================================ */
import { launch, sleep } from "./lib/cdp.mjs";

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d; };
const VERBOSE = argv.includes("--verbose");
const ONLY = (opt("--only", "") || "").toUpperCase().split(",").filter(Boolean);
/* --params "a=1&b=2" — extra query on the page this gate boots.

   HARNESS TRAP: this gate had no way to change the URL, and the day-clock
   rules below are exactly the ones that fail first when the machine is loaded
   or when the world got bigger — so when it went red there was no way to ask
   "is it the change or is it the island?" without editing the file. It is one
   line, and the alternative was a hand-run Chrome that leaves no trace. Used
   as `--params "bands=40&smalls=56"` (the island as it was) or
   `--params "far=old"` (campaign.js's distance-stepped world clock off). */
const PARAMS = opt("--params", "");
const QS = "go=1&seed=1337&weather=off&sound=off" + (PARAMS ? "&" + PARAMS : "");
const want = (r) => !ONLY.length || ONLY.includes(r);

/* An hour of game time is 45 real seconds — campaign.js's HOUR_SECS, derived
   there from the island being a fourteen-minute ride across. It is repeated
   here because this file has to convert the day clock back into seconds to
   compare it against the slider, and a wrong constant would make every
   measurement wrong by the same factor and look perfectly consistent. If
   campaign.js ever retunes it this gate reads the live value instead. */
const HOUR_SECS_FALLBACK = 45;

const BOOT = `window.__warlordReady === true && !!(window.CBZ && CBZ.warlord &&
  CBZ.warlord.clock && CBZ.warlord.desert && CBZ.warlord.phase() === "campaign")`;

const fails = [];
const notes = [];
const fail = (rule, what) => { fails.push(`${rule}  ${what}`); console.log(`  FAIL  ${what}`); };
const ok = (what) => console.log(`  ok    ${what}`);

/* ---- the page-side helpers, installed once ------------------------------
   Everything here READS. The only thing it writes is the speed and the band
   cooldowns, and the second one is stated: a party that walks into you opens
   the encounter rail and takes the campaign phase away mid-measurement, which
   is a different feature's behaviour landing in this feature's numbers. The
   parties keep roaming — mood, goal and gait are untouched — they just do not
   pick a fight with the instrument. */
const HELPERS = `(() => {
  const W = CBZ.warlord, D = W.desert, S = W.state;
  window.__wlSpeed = {
    hourSecs() {
      const a = W.campaign && W.campaign.audit ? W.campaign.audit() : null;
      return (a && a.hourSecs) || ${HOUR_SECS_FALLBACK};
    },
    calm() { for (let i = 0; i < S.bands.length; i++) S.bands[i].cooldown = 1e9; },
    /* THE CHEAP PROBE, AND IT EXISTS BECAUSE THE INSTRUMENT BECAME THE ERROR.
       sample() below walks every party and asks desert.js for onLand and
       heightAt at each one, then ships the whole array over CDP. At 96 parties
       that is a few milliseconds. At 677 it is a second or more of blocked
       main thread per call — and runFor() polls with it in a loop, so at 16x
       one poll was worth up to thirty game seconds and the run overshot its
       target fivefold. The overshoot then failed RULE C's "game hours elapsed"
       against a world that was behaving perfectly.
       Three numbers, no loop, no serialisation. Poll with this; take the full
       sample only at the two ends, where it is the measurement rather than the
       clock. */
    tick() { return { hours: S.day * 24 + S.hour, game: W.clock.now(), wall: performance.now() }; },
    /* THE SAMPLE. One object, every number a rule can want, taken in one
       evaluation so no two facts in it are from different moments. */
    sample() {
      const b = [];
      for (let i = 0; i < S.bands.length; i++) {
        const q = S.bands[i];
        b.push({ id: q.id, x: Math.round(q.x * 100) / 100, z: Math.round(q.z * 100) / 100,
                 y: q.y == null ? null : Math.round(q.y * 100) / 100,
                 land: !!D.onLand(q.x, q.z),
                 ground: Math.round(D.heightAt(q.x, q.z) * 100) / 100,
                 men: q.men ? q.men.length : 0, mood: q.mood });
      }
      return {
        wall: performance.now(),
        game: W.clock.now(),
        scale: W.clock.scale(),
        achieved: Math.round(W.clock.achieved() * 100) / 100,
        fps: CBZ.micro.fps,
        subs: CBZ.micro.subCount,
        day: S.day, hour: S.hour,
        hours: S.day * 24 + S.hour,
        you: { x: Math.round(S.you.x * 100) / 100, z: Math.round(S.you.z * 100) / 100 },
        phase: W.phase(),
        bands: b,
      };
    },
    ui() {
      const box = document.getElementById("wlSpeed");
      const r = document.getElementById("wlSpeedR");
      const v = document.getElementById("wlSpeedV");
      const t = document.getElementById("wlSpeedT");
      const hud = document.getElementById("hud");
      return {
        on: !!(box && box.classList.contains("on")),
        disabled: !!(r && r.disabled),
        value: r ? +r.value : -1,
        index: W.clock.index(),
        readout: v ? v.textContent : "",
        tag: t && t.classList.contains("on") ? t.textContent : "",
        hudText: hud ? (hud.textContent || "").replace(/\\s+/g, " ") : "",
        scale: W.clock.scale(),
        held: W.clock.heldFor(),
      };
    },
  };
  return true;
})()`;

/* Physical ceiling on how far a party can move. HUNT_SPEED is 8.4 m/s in
   campaign.js — the fastest anything on the campaign map goes — and 1.35 is
   the slack for a turn-and-retry landing on a diagonal plus the sample
   straddling a frame boundary. Anything past that is a teleport. */
const MAX_BAND_SPEED = 8.4 * 1.35;

async function ruleA(rig) {
  console.log("\nRULE A — the world advances at the rate the slider says");
  const SETTINGS = [0.25, 1, 4, 16, 64];
  const rows = [];
  for (const s of SETTINGS) {
    await rig.evl(`(() => { CBZ.warlord.clock.setScale(${s}); window.__wlSpeed.calm(); return true; })()`);
    /* THE SETTLE IS NOT POLITENESS, IT IS THE FIRST BUG THIS GATE FOUND IN
       ITSELF. The clock is wall-derived and CATCHES UP: raising the island is
       a synchronous stall of a second or so, and the first worldTick after it
       correctly does a second of world in one call. Measured across the stall,
       the day clock read 1.19x at a setting of 1x — a real number describing a
       real thing, and not the thing being measured. 1.4 s of settle, and then
       the window is stall-free. */
    await sleep(1400);
    await rig.evl(`window.__wlSpeed.calm()`);
    const a = await rig.evl(`window.__wlSpeed.sample()`);
    await sleep(2600);
    await rig.evl(`window.__wlSpeed.calm()`);
    const b = await rig.evl(`window.__wlSpeed.sample()`);
    const wallSec = (b.wall - a.wall) / 1000;
    const hourSecs = await rig.evl(`window.__wlSpeed.hourSecs()`);
    const clockRate = (b.game - a.game) / 1000 / wallSec;
    const dayRate = (b.hours - a.hours) * hourSecs / wallSec;
    /* THE BANDS ARE THE THIRD WITNESS, and the only one that is downstream of
       an actual integrator: the clock could be right and the day clock could
       be right while nothing on the island moved. */
    const moved = bandTravel(a, b);
    const gameSec = (b.game - a.game) / 1000;
    rows.push({ s, clockRate, dayRate, moved, gameSec, fps: b.fps, subs: b.subs, ach: b.achieved });
    const cErr = Math.abs(clockRate / s - 1);
    const dErr = Math.abs(dayRate / s - 1);
    const line = `${String(s).padStart(5)}x  clock ${clockRate.toFixed(2)}x  day ${dayRate.toFixed(2)}x  ` +
      `bands moved ${moved.mean.toFixed(1)} m in ${gameSec.toFixed(1)} game s  fps ${b.fps}  subs ${b.subs}`;
    if (cErr > 0.03) fail("A", `${line}  — the CLOCK is off by ${(cErr * 100).toFixed(1)}%`);
    else if (dErr > 0.10) fail("A", `${line}  — the DAY CLOCK is off by ${(dErr * 100).toFixed(1)}%`);
    else if (s >= 1 && moved.mean < 0.5 * gameSec) {
      fail("A", `${line}  — the day ran but the island did not: ${moved.mean.toFixed(1)} m ` +
        `is less than half a walking pace over ${gameSec.toFixed(1)} game seconds`);
    } else ok(line);
  }
  notes.push(["RATE", rows.map((r) => `${r.s}x → day ${r.dayRate.toFixed(2)}x, ` +
    `achieved ${r.ach}x, ${r.fps} fps, ${r.subs} substeps`).join(" | ")]);
  await rig.evl(`CBZ.warlord.clock.setScale(1)`);
}

function bandTravel(a, b) {
  const at = new Map(a.bands.map((q) => [q.id, q]));
  let n = 0, sum = 0, max = 0;
  for (const q of b.bands) {
    const p = at.get(q.id);
    if (!p) continue;
    const d = Math.hypot(q.x - p.x, q.z - p.z);
    n++; sum += d; if (d > max) max = d;
  }
  return { n, mean: n ? sum / n : 0, max };
}

async function ruleB(rig) {
  console.log("\nRULE B — at maximum the world is still a world");
  await rig.evl(`(() => { CBZ.warlord.clock.setScale(64); window.__wlSpeed.calm(); return true; })()`);
  await sleep(400);
  const shots = [];
  for (let i = 0; i < 17; i++) {
    await rig.evl(`window.__wlSpeed.calm()`);
    shots.push(await rig.evl(`window.__wlSpeed.sample()`));
    await sleep(250);
  }
  await rig.evl(`CBZ.warlord.clock.setScale(1)`);

  const hourSecs = await rig.evl(`window.__wlSpeed.hourSecs()`);
  let worstJump = 0, worstAt = "", offLand = 0, sunk = 0, gameSec = 0, moved = 0;
  for (let i = 1; i < shots.length; i++) {
    const a = shots[i - 1], b = shots[i];
    /* THE INTERVAL COMES OFF THE DAY CLOCK, NOT OFF W.clock.now(), and that
       distinction is the difference between this rule working and this rule
       inventing teleports. Both the band positions and S.hour are written by
       campaign.js's worldTick, in the same call; W.clock.now() is a free wall
       clock that keeps running between ticks. Sampling a position against the
       free clock therefore measures the position from the LAST tick against a
       time that has moved on since — up to a frame of slack, which at 64x is
       six game seconds, which on a sixteen-second window is a 40% error. It
       reported a party walking at 12.5 m/s against a ceiling of 8.4 and the
       party had done nothing wrong. Two numbers from the same writer. */
    const dg = (b.hours - a.hours) * hourSecs;
    gameSec += dg;
    const t = bandTravel(a, b);
    moved += t.mean;
    /* THE TUNNEL TEST. Not "did anything move a long way" — at 64x everything
       moves a long way — but "did anything move further than it could have
       walked in the game time that passed". That ratio is the whole check and
       it is scale-free, which is why it is the one that catches a dt × 64. */
    const ceiling = MAX_BAND_SPEED * dg;
    if (ceiling > 0 && t.max / ceiling > worstJump) {
      worstJump = t.max / ceiling;
      worstAt = `${t.max.toFixed(1)} m in ${dg.toFixed(2)} game s (ceiling ${ceiling.toFixed(1)} m)`;
    }
    for (const q of b.bands) {
      if (!q.land) offLand++;
      // b.y is what campaign.js wrote after the step; ground is heightAt now.
      if (q.y != null && Math.abs(q.y - q.ground) > 0.6) sunk++;
    }
  }
  const last = shots[shots.length - 1];
  if (worstJump > 1) fail("B", `a party teleported: ${worstAt} — ${worstJump.toFixed(2)}x what it could walk`);
  else ok(`no party outran its own legs — worst step was ${(worstJump * 100).toFixed(0)}% of the physical ceiling`);
  if (offLand) fail("B", `${offLand} band-samples standing off the island`);
  else ok(`every party on land across ${shots.length} samples × ${last.bands.length} parties`);
  if (sunk) fail("B", `${sunk} band-samples sitting more than 0.6 m off the terrain under them`);
  else ok("no party under the ground");
  if (moved < 0.5 * gameSec) fail("B", `the island froze at 64x: ${moved.toFixed(0)} m over ${gameSec.toFixed(0)} game s`);
  else ok(`the island walked ${moved.toFixed(0)} m per party over ${gameSec.toFixed(0)} game seconds`);
  if (last.phase !== "campaign" && last.phase !== "encounter") {
    fail("B", `the game left the island at 64x and ended in phase "${last.phase}"`);
  } else ok(`still riding after ${gameSec.toFixed(0)} game seconds of fast-forward`);
  notes.push(["MAX", `64x delivered ${(gameSec / ((shots[shots.length - 1].wall - shots[0].wall) / 1000)).toFixed(1)}x ` +
    `on this machine at ${last.fps} fps, ${last.subs} substeps/frame`]);
}

/* RULE C — the same run, twice. */
async function ruleC(rig) {
  console.log("\nRULE C — a fast-forwarded run is the same world as a real-time one");
  const GAME_SEC = 30;
  const A = await runFor(rig, 1, GAME_SEC);
  const B = await runFor(rig, 16, GAME_SEC);
  const dh = Math.abs(A.hours - B.hours);
  const line = (k, a, b) => `${k}: 1x ${a}  16x ${b}`;
  /* 0.45 h of slack, and it is the POLL that needs it, not the clock. Both
     runs stop on the first sample past the same day-clock target, and one
     sample at 16x is worth sixteen times as much world as at 1x — more when
     the software rasteriser stalls for half a second mid-poll, which it does.
     The sharp check is `metres walked per game hour` below, which divides the
     overshoot out; this one only has to catch a run that stopped somewhere
     else entirely. */
  if (dh > 0.45) fail("C", line("game hours elapsed", A.hours.toFixed(3), B.hours.toFixed(3)) +
    ` — ${dh.toFixed(3)} h apart, and both were told to run ${GAME_SEC} game seconds`);
  else ok(line("game hours elapsed", A.hours.toFixed(3), B.hours.toFixed(3)));

  if (A.day !== B.day) fail("C", line("day", A.day, B.day));
  else ok(line("day", A.day, B.day));

  if (Math.abs(A.bands - B.bands) > 3) fail("C", line("parties on the island", A.bands, B.bands));
  else ok(line("parties on the island", A.bands, B.bands));

  const menRatio = B.men / Math.max(1, A.men);
  if (menRatio < 0.6 || menRatio > 1.6) fail("C", line("men in those parties", A.men, B.men) +
    ` — ${(menRatio * 100).toFixed(0)}% of real time`);
  else ok(line("men in those parties", A.men, B.men));

  /* PER GAME HOUR, not per run: the two runs stop on the same day-clock
     target but each overshoots it by one poll, and at 16x one poll is worth
     sixteen times as much world as at 1x. Dividing by the hours each one
     actually took compares walking PACE, which is the thing that must not
     change, instead of total distance, which depends on where the poll landed. */
  const paceA = A.travel / Math.max(1e-6, A.hours), paceB = B.travel / Math.max(1e-6, B.hours);
  const travelRatio = paceB / Math.max(0.01, paceA);
  if (travelRatio < 0.7 || travelRatio > 1.45) {
    fail("C", line("metres walked per game hour", paceA.toFixed(0), paceB.toFixed(0)) +
      ` — ${(travelRatio * 100).toFixed(0)}% of real time`);
  } else ok(line("metres walked per game hour", paceA.toFixed(0), paceB.toFixed(0)));

  if (A.offLand || B.offLand) fail("C", `parties off the island: 1x ${A.offLand}, 16x ${B.offLand}`);
  else ok("no party off the island on either run");
  notes.push(["A/B", `${GAME_SEC} game seconds cost ${A.wall.toFixed(1)} wall s at 1x and ` +
    `${B.wall.toFixed(1)} wall s at 16x — a ${(A.wall / B.wall).toFixed(1)}x saving`]);
}

/* THE STOP CONDITION IS THE WORLD'S OWN CLOCK, NOT THE WALL AND NOT THE
   SPEED CLOCK. The first draft stopped when W.clock.now() had advanced 30
   game seconds and then sampled immediately — and at 16x that took 1.9 wall
   seconds, which on this software rasteriser is barely more than the island's
   own build stall. The clock had advanced 30 s and worldTick had not run
   once, so the fast run's world was still at hour zero and the comparison
   read "the fast-forward did nothing". Which was true of the instant it
   sampled and false of the run.

   Waiting a fixed extra beat is the wrong fix too: at 16x a 900 ms grace is
   fourteen more game seconds, so the two runs would stop at different world
   times and every number downstream would be comparing different moments.
   Both runs therefore stop when the DAY CLOCK — the thing the world actually
   moves on — has advanced the same amount. Then the two snapshots are of the
   same instant in two worlds, and the only variable left is how long the wall
   clock took to get there. */
async function runFor(rig, scale, gameSec) {
  await rig.open("games/warlord.html", QS);
  if (!await rig.wait(BOOT, 120000)) throw new Error("never reached the campaign");
  await rig.evl(HELPERS);
  await rig.evl(`window.__wlSpeed.calm()`);
  await sleep(2500);                             // the build stall, spent
  await rig.evl(`(() => { window.__wlSpeed.calm(); CBZ.warlord.clock.setScale(${scale}); return true; })()`);
  /* THE SETTLE, AND RULE A ALREADY LEARNED THIS LESSON — see its own comment.
     The first worldTick after a scale change catches up whatever wall time has
     passed since the last one, warped by the NEW scale, and that is a
     legitimate jump in the world that is not the rate being measured. RULE A
     spends 1.4 s on it and this function spent none, so at 16x on a page
     running at 13 fps the jump landed INSIDE the measurement window and the
     run overshot its thirty game seconds by six times — which then failed
     "game hours elapsed" against a world that was behaving perfectly. Same
     stall, same 1.4 s, same reason. */
  await sleep(1400);
  await rig.evl(`window.__wlSpeed.calm()`);
  const a = await rig.evl(`window.__wlSpeed.sample()`);
  const hourSecs = await rig.evl(`window.__wlSpeed.hourSecs()`);
  const untilHours = a.hours + gameSec / hourSecs;
  const wall0 = Date.now();
  /* POLL CHEAP, SAMPLE ONCE. See __wlSpeed.tick: the full sample is what was
     overshooting the target, not the world. */
  for (let i = 0; i < 20000; i++) {
    await rig.evl(`window.__wlSpeed.calm()`);
    const t = await rig.evl(`window.__wlSpeed.tick()`);
    if (t.hours >= untilHours) break;
    await sleep(scale >= 8 ? 20 : 220);
    if (Date.now() - wall0 > 200000) break;
  }
  const b = await rig.evl(`window.__wlSpeed.sample()`);
  const t = bandTravel(a, b);
  return {
    hours: b.hours - a.hours, day: b.day,
    bands: b.bands.length, men: b.bands.reduce((n, q) => n + q.men, 0),
    travel: t.mean, offLand: b.bands.filter((q) => !q.land).length,
    wall: (b.wall - a.wall) / 1000,
    gameSec: (b.game - a.game) / 1000,
  };
}

async function ruleD(rig) {
  console.log("\nRULE D — the interface reports the true speed");
  for (const s of [0.5, 1, 8, 64]) {
    await rig.evl(`CBZ.warlord.clock.setScale(${s})`);
    await sleep(320);
    const u = await rig.evl(`window.__wlSpeed.ui()`);
    const wantTxt = (s < 1 ? String(s) : String(s)) + "×";
    if (!u.on) fail("D", `the control is not on screen while riding (scale ${s})`);
    else if (u.readout !== wantTxt) fail("D", `the readout says "${u.readout}" at ${s}x`);
    else if (u.value !== u.index) fail("D", `the slider sits at ${u.value} while the clock is at index ${u.index}`);
    else if (u.scale !== s) fail("D", `asked for ${s}x, the clock is at ${u.scale}x`);
    else if (s !== 1 && !u.hudText.includes(wantTxt)) {
      fail("D", `the HUD strip does not carry the speed at ${s}x: "${u.hudText}"`);
    } else if (s === 1 && u.hudText.includes("×")) {
      fail("D", `the HUD carries a speed chip at 1x, which is furniture: "${u.hudText}"`);
    } else ok(`${wantTxt}: readout "${u.readout}", slider ${u.value}/${u.index}, HUD carries it`);
  }

  /* THE HOLD USED TO BE TESTED THROUGH A LIVE MATCH, and it cannot be any
     more: the match layer was deleted 2026-09-01 (src/warlord/match.js's
     tombstone says why) and with it the only thing in the game that took a
     clock hold called "MATCH". Deleting the assertion outright would have
     been the dishonest fix — the MECHANISM it was really guarding is
     core.js's clock hold, which is still there, still the thing that stops a
     future feature being fast-forwarded past, and still the half of this
     feature most likely to rot.

     So the assertion is repointed at the mechanism instead of at its one
     vanished caller: take a hold by hand, check the clock actually refuses,
     check the control says WHY, and release it. That is exactly what the
     match test proved, minus the match. If some future feature wants to pin
     the clock again it inherits a gate that already works. */
  await rig.evl(`CBZ.warlord.clock.setScale(16)`);
  await rig.evl(`CBZ.warlord.clock.hold("BATTLE")`);
  await sleep(700);
  {
    const u = await rig.evl(`window.__wlSpeed.ui()`);
    if (u.scale !== 1) fail("D", `a held clock did not pin at 1x: it is at ${u.scale}x`);
    else if (!u.disabled) fail("D", "a held clock left the slider enabled");
    else if (u.held !== "BATTLE") fail("D", `the clock is held for "${u.held}", not the holder that took it`);
    else if (!/BATTLE/.test(u.tag)) fail("D", `the control does not say why it is pinned: tag "${u.tag}"`);
    else ok(`a held clock pins at 1x and the control says "${u.tag}"`);
    // and it must not be a one-way door
    const after = await rig.evl(`(() => {
      CBZ.warlord.clock.setScale(32);
      return { scale: CBZ.warlord.clock.scale(), want: CBZ.warlord.clock.want() };
    })()`);
    if (after.scale !== 1) fail("D", `the hold was overridable from script: setScale(32) gave ${after.scale}x`);
    else ok("setScale is refused while something holds the clock, not merely greyed out");
    await rig.evl(`CBZ.warlord.clock.release("BATTLE")`);
    const back = await rig.evl(`CBZ.warlord.clock.heldFor()`);
    if (back) fail("D", `the hold did not release: still held for "${back}"`);
    else ok("the hold releases and the slider is the player's again");
  }
}

const run = async () => {
  /* rafBudget 0 — this gate is entirely about how much world a real frame
     loop delivers per real second, so capping rAF would measure the cap. */
  const rig = await launch({ rafBudget: 0 });
  try {
    if (want("A") || want("B") || want("D")) {
      await rig.open("games/warlord.html", QS);
      if (!await rig.wait(BOOT, 120000)) {
        fail("boot", "the island never came up");
      } else {
        await rig.evl(HELPERS);
        // one settle for the whole run: the island's first build is a stall
        // and the clock catches up across it (see ruleA's settle).
        await rig.evl(`window.__wlSpeed.calm()`);
        await sleep(2500);
        if (want("A")) await ruleA(rig);
        if (want("B")) await ruleB(rig);
        if (want("D")) await ruleD(rig);
      }
    }
    if (want("C")) await ruleC(rig);

    const errs = rig.errors.filter((e) => !/favicon|ERR_/.test(e));
    if (errs.length) {
      console.log("\npage errors:");
      for (const e of errs.slice(0, 12)) console.log("  " + e);
      fail("errors", `${errs.length} uncaught error${errs.length === 1 ? "" : "s"} on the page`);
    }
  } finally {
    await rig.close();
  }

  if (notes.length) {
    console.log("\nmeasured:");
    for (const [k, v] of notes) console.log(`  ${k.padEnd(5)} ${v}`);
  }
  if (fails.length) {
    console.log(`\nWARLORD SPEED: FAIL — ${fails.length} problem${fails.length === 1 ? "" : "s"}\n`);
    for (const f of fails) console.log("  " + f);
    process.exit(1);
  }
  console.log("\nWARLORD SPEED OK — the island runs at the rate the slider says, " +
    "it is still an island at 64x, and the control tells the truth.");
};

run().catch((e) => { console.error(e); process.exit(1); });
