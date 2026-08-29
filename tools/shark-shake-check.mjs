#!/usr/bin/env node
/* tools/shark-shake-check.mjs — WHY DOES THE SHARK GAME SHAKE?

   The owner's complaint: "the shark game sometimes feels like there's an
   earthquake. I wanted it copying the world of the nat disaster but not
   having the disasters."

   So this tool answers exactly one question with numbers: over a real
   sharksim match, WHO calls CBZ.shake, how often, how hard, and what
   fraction of the match is the lens actually being jittered.

   It boots index.html?mode=sharksim the way the tile does, wraps CBZ.shake
   with a caller-attributing spy, samples the camera at onAlways(60) (after
   camera.js@50, the dive rig@50.4 and predator's post-pass@52.5, i.e. the
   final lens for the frame), then bursts game time through CBZ.stepSim.

   The headline metric is DUTY: the fraction of ticks on which the camera
   was displaced by shake. A one-off punch is a 0.4 s jolt; an earthquake is
   a duty cycle. Anything over ~10% reads as continuous shaking.

     node tools/shark-shake-check.mjs                 # 90 game-seconds
     node tools/shark-shake-check.mjs --sec 180
     node tools/shark-shake-check.mjs --json
     node tools/shark-shake-check.mjs --off SHARK_...  # ablate a config flag
*/
import { launch, sleep, ROOT } from "./lib/cdp.mjs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const arg = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d; };
const SEC = +arg("--sec", "90");
const SEED = arg("--seed", "90210");
const BOTS = +arg("--bots", "60");
const JSON_OUT = has("--json");
const OFF = argv.filter((a, i) => argv[i - 1] === "--off");
const FEAST = has("--feast");          // keep meat in front of the mouth: real play, not an empty sea
const TIER = +arg("--tier", "-1");     // force a rung of the ladder before measuring
const NOSHAKE = has("--noshake");      // ablation: stub CBZ.shake, leave everything else
const PREY = has("--prey");            // the other side of the game: the pod is on YOU
const say = (m) => { if (!JSON_OUT) console.log(m); };

const rig = await launch({ rafBudget: 0 });
const out = { sec: SEC, seed: SEED, off: OFF, errors: [] };

/* Pin live survivors just past the REAL jaw point so the automatic bite has
   something to land on — the shore buffet, staged. Runs inside the burst so
   no wall time ever enters the measurement (see the HARNESS TRAP below). */
const FEED_SRC = `(() => {
  const S = CBZ.sharkSim.shark; if (!S) return 0;
  const h = S.heading || 0, dx = Math.cos(h), dz = Math.sin(h);
  const jp = (CBZ.creatureJawPoint && CBZ.creatureJawPoint(S)) || { x: 2.1 };
  const jaw = jp.x * (S.species.scale || 1);
  let placed = 0;
  for (let i = 0; i < CBZ.bots.length && placed < 3; i++) {
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
/* THE POD IS ON YOU. Parks the orcas on top of the player's shark with full
   hunger and keeps the shark alive, so the run measures what the game does to
   the camera while something is EATING the player rather than the reverse. */
const PREY_SRC = `(() => {
  const S = CBZ.sharkSim.shark, P = CBZ.player; if (!S) return 0;
  let n = 0;
  for (const a of CBZ.cityWildlife) {
    if (a.dead || !a.species || a === S) continue;
    if (a.species.id !== "orca") continue;
    const ang = n * 2.1;
    a.pos.x = S.pos.x + Math.cos(ang) * 9; a.pos.z = S.pos.z + Math.sin(ang) * 9;
    if (a._waterMove) { a._waterMove.x = a.pos.x; a._waterMove.z = a.pos.z; }
    a.hunger = 1; a.target = S;
    n++;
  }
  // book the damage the pod actually landed, THEN heal, so the shark survives
  // the whole measurement window without hiding whether it was ever bitten
  if (window.__SHK) window.__SHK.dmg = (window.__SHK.dmg || 0) + Math.max(0, (S.maxHp || 0) - (S.hp || 0));
  S.hp = S.maxHp;
  return n;
})()`;
const burst = (sec) => rig.evl(
  `(() => { for (let i = 0, n = ${Math.max(1, Math.round(sec * 60))}; i < n; i++) {
      ${PREY ? `if (i % 45 === 0) { ${PREY_SRC}; }` : ""}
      ${FEAST ? `if (i % 45 === 0) { ${FEED_SRC}; }` : ""}
      CBZ.stepSim(1/60);
    } return true; })()`);

try {
  await rig.open("index.html", `mode=sharksim&seed=${SEED}`);
  if (!await rig.wait("window.CBZ && CBZ.game", 150000)) throw new Error("page never published CBZ");
  await rig.evl(`CBZ.SURV_BOTS = ${BOTS}`);
  for (const f of OFF) await rig.evl(`CBZ.CONFIG.${f} = false`);
  const playing = await rig.wait(`(() => {
    if (CBZ.game.state === 'playing' && CBZ.game.mode === 'sharksim') return true;
    if (!CBZ.cityWildlifeStock || !CBZ.spawnSurvivorBotAt || !CBZ.cityMountAnimal || !CBZ.stepSim) return false;
    const mb = document.querySelector('.mode-btn[data-mode="sharksim"]'); if (mb) mb.click();
    const pb = document.getElementById('playBtn'); if (pb) pb.click();
    return false;
  })()`, 240000, 300);
  if (!playing) throw new Error("never entered a match");
  const armed = await rig.wait(`(() => { for (let i=0;i<30;i++) CBZ.stepSim(1/60);
    return !!(CBZ.sharkSim && CBZ.sharkSim.on && CBZ.sharkSim.shark &&
      CBZ.cityMountedAnimal && CBZ.cityMountedAnimal() === CBZ.sharkSim.shark); })()`, 40000, 200);
  if (!armed) throw new Error("sim never mounted a shark");
  say("mounted. instrumenting…");
  // PILOT. An idle shark in an empty sea shakes at nothing; the complaint is
  // about PLAYING. Swim, and keep meat in front of the mouth.
  await rig.evl(`(CBZ.keys.w = true, CBZ.keys.shift = true)`);
  if (TIER >= 0) {
    // climb the ladder before measuring: the mount's bite shake scales with the
    // BODY, so a megalodon's mouthful is not a bull shark's
    await rig.evl(`(() => { const s = CBZ.sharkSim; s.mass = 999;
      for (let i = 0; i < ${TIER} && s.tier < 3; i++) { s.mass = 999; CBZ.sharkSimBite && 0; }
      return s.tier; })()`);
  }

  /* ---- THE SPY. Wraps CBZ.shake (caller attribution off the stack) and
     samples the FINAL camera position each tick at onAlways(60). */
  await rig.evl(`(() => {
    const S = { calls: [], by: {}, ticks: 0, moved: 0, jitter: 0, jmax: 0, hitstop: 0, slowmo: 0 };
    window.__SHK = S;
    const inner = CBZ.shake;
    CBZ.shake = function __shakeSpy(m) {
      let where = "?";
      try {
        const st = String(new Error().stack || "").split("\\n");
        for (let i = 1; i < st.length; i++) {
          if (/__shakeSpy/.test(st[i])) continue;
          where = st[i].trim().replace(/^at\\s+/, "").replace(/^.*\\/(src\\/)?/, "").replace(/\\)$/, "");
          break;
        }
      } catch (e) {}
      const b = S.by[where] || (S.by[where] = { n: 0, sum: 0, max: 0 });
      b.n++; b.sum += (+m || 0); b.max = Math.max(b.max, +m || 0);
      if (S.calls.length < 4000) S.calls.push([+(CBZ.game.elapsed || 0).toFixed(2), where, +(+m || 0).toFixed(3)]);
      return inner.apply(this, arguments);
    };
    /* The camera's own jitter, measured where the lens is finally left.
       Shake is Math.random per axis per frame, so it shows up as a large
       SECOND difference (a zig-zag) while real camera travel does not.
       We also snapshot the un-shaken reference: camera.js applies shake as
       the last thing it does, so p(t) - smooth(p) is the shake itself. */
    /* PER-STAGE JITTER. Four samplers straddle the writers that can move the
       lens in this mode, each keeping its OWN second-difference series.
       Jitter already present in stage 1 came out of camera.js (boom/shake);
       jitter that only appears in stage 2 came out of the dive rig; stage 3
       is predator.js's trauma post-pass. */
    S.stage = {};
    function sampler(name, order) {
      const st = S.stage[name] = { sum: 0, max: 0, over: 0, n: 0, worst: [], hist: [0,0,0,0,0,0,0] };
      let a = null, b = null;
      CBZ.onAlways(order, function () {
        const c = CBZ.camera; if (!c) return;
        const p = { x: c.position.x, y: c.position.y, z: c.position.z };
        if (a && b) {
          const j = Math.hypot(p.x - 2 * b.x + a.x, p.y - 2 * b.y + a.y, p.z - 2 * b.z + a.z);
          st.n++; st.sum += j; if (j > st.max) st.max = j;
          st.hist[j < 0.005 ? 0 : j < 0.01 ? 1 : j < 0.02 ? 2 : j < 0.05 ? 3 : j < 0.15 ? 4 : j < 0.5 ? 5 : 6]++;
          if (j > 0.02) st.over++;
          if (j > 0.05) { st.worst.push([+(CBZ.game.elapsed || 0).toFixed(2), +j.toFixed(3)]);
                          if (st.worst.length > 400) st.worst.shift(); }
        }
        a = b; b = p;
      });
    }
    /* WHAT THE LENS IS FOLLOWING. camera.js frames CBZ.player.pos — which,
       while mounted, is a SEAT the ride republishes off the animal every tick.
       If the seat jitters the lens must, and no amount of shake accounting
       will explain it. Same second-difference metric, same frame slot. */
    function posSampler(name, order, get) {
      const st = S.stage[name] = { sum: 0, max: 0, over: 0, n: 0, worst: [], hist: [0,0,0,0,0,0,0] };
      let a = null, b = null;
      CBZ.onAlways(order, function () {
        const q = get(); if (!q) { a = b = null; return; }
        const p = { x: q.x, y: q.y, z: q.z };
        if (a && b) {
          const j = Math.hypot(p.x - 2 * b.x + a.x, p.y - 2 * b.y + a.y, p.z - 2 * b.z + a.z);
          st.n++; st.sum += j; if (j > st.max) st.max = j;
          st.hist[j < 0.005 ? 0 : j < 0.01 ? 1 : j < 0.02 ? 2 : j < 0.05 ? 3 : j < 0.15 ? 4 : j < 0.5 ? 5 : 6]++;
          if (j > 0.02) st.over++;
          if (j > 0.05) { st.worst.push([+(CBZ.game.elapsed || 0).toFixed(2), +j.toFixed(3)]);
                          if (st.worst.length > 400) st.worst.shift(); }
        }
        a = b; b = p;
      });
    }
    /* THE POSE CHANNEL ITSELF. a.group.rotation.z is (swim pitch + the bite
       animation's attackPitch); a STEP here is an animation discontinuity and
       aquaticSeatY multiplies it by the seat's forward arm V.x before the
       camera ever sees it. Sampled as a scalar, same second difference. */
    (function () {
      const st = S.stage["0z_bodyPitchRad"] = { sum: 0, max: 0, over: 0, n: 0, worst: [], hist: [0,0,0,0,0,0,0] };
      let a = null, b = null;
      CBZ.onAlways(49.99, function () {
        const S2 = CBZ.sharkSim && CBZ.sharkSim.shark;
        const r = S2 && S2.group && S2.group.rotation; if (!r) { a = b = null; return; }
        const p = r.z;
        if (a != null && b != null) {
          const j = Math.abs(p - 2 * b + a);
          st.n++; st.sum += j; if (j > st.max) st.max = j;
          st.hist[j < 0.005 ? 0 : j < 0.01 ? 1 : j < 0.02 ? 2 : j < 0.05 ? 3 : j < 0.15 ? 4 : j < 0.5 ? 5 : 6]++;
          if (j > 0.02) st.over++;
          if (j > 0.05) { st.worst.push([+(CBZ.game.elapsed || 0).toFixed(2), +j.toFixed(3)]);
                          if (st.worst.length > 400) st.worst.shift(); }
        }
        a = b; b = p;
      });
    })();
    posSampler("0a_seat", 49.99, () => CBZ.player && CBZ.player.pos);
    posSampler("0b_body", 49.99, () => { const S2 = CBZ.sharkSim && CBZ.sharkSim.shark;
      return S2 && S2.group && S2.group.position; });
    /* WHEN THE LENS JUMPS, WHAT ELSE WAS TRUE. The stage samplers say WHERE
       the jitter enters; this says WHAT it was. Records the displacement axes
       and the camera/loop state on any tick the lens second-difference clears
       half a metre, which is far above anything a 0.2 shake can produce. */
    S.jumps = [];
    (function () {
      let a = null, b = null;
      CBZ.onAlways(50.011, function () {
        const c = CBZ.camera, P = CBZ.player; if (!c) return;
        const p = { x: c.position.x, y: c.position.y, z: c.position.z };
        if (a && b) {
          const jx = p.x - 2 * b.x + a.x, jy = p.y - 2 * b.y + a.y, jz = p.z - 2 * b.z + a.z;
          if (Math.hypot(jx, jy, jz) > 0.5 && S.jumps.length < 60) {
            S.jumps.push({
              t: +(CBZ.game.elapsed || 0).toFixed(2),
              d: [+jx.toFixed(2), +jy.toFixed(2), +jz.toFixed(2)],
              py: +P.pos.y.toFixed(2), cy: +c.position.y.toFixed(2),
              yaw: +(CBZ.cam.yaw || 0).toFixed(3), pitch: +(CBZ.cam.pitch || 0).toFixed(3),
              dist: +(CBZ.cam.dist || 0).toFixed(2), zoom: +(CBZ.cam.zoom || 0).toFixed(2),
              slow: +(CBZ.slowmo || 0).toFixed(3), stop: +(CBZ.hitstop || 0).toFixed(3),
              fdt: +(CBZ.feelDt || 0).toFixed(4),
              sea: CBZ.citySeaHeightAt ? +CBZ.citySeaHeightAt(c.position.x, c.position.z).toFixed(2) : null,
              scale: +((CBZ.sharkSim.shark && CBZ.sharkSim.shark.group.scale.x) || 0).toFixed(3),
            });
          }
        }
        a = b; b = p;
      });
    })();
    sampler("1_camera_js", 50.01);
    sampler("2_dive_rig", 50.45);
    sampler("3_predator", 52.9);
    sampler("4_final", 60);
    let p0 = null, p1 = null;
    CBZ.onAlways(60.1, function (dt) {
      const c = CBZ.camera; if (!c) return;
      const p = { x: c.position.x, y: c.position.y, z: c.position.z };
      S.ticks++;
      if (CBZ.hitstop > 0) S.hitstop++;
      if (CBZ.slowmo > 0) S.slowmo++;
      if (p0 && p1) {
        const j = Math.hypot(p.x - 2 * p1.x + p0.x, p.y - 2 * p1.y + p0.y, p.z - 2 * p1.z + p0.z);
        S.jitter += j; S.jmax = Math.max(S.jmax, j);
        if (j > 0.02) S.moved++;
      }
      p0 = p1; p1 = p;
    });
    return 1;
  })()`);
  if (NOSHAKE) await rig.evl(`(CBZ.shake = function(){}, 1)`);

  /* HARNESS TRAP: the whole run must be ONE evaluation. Chunking it into
     10-second bursts inserts a CDP round-trip (tens of ms of WALL time) into
     the middle of a sim that is advancing CBZ.now synthetically — and every
     wall-clock-driven term in the present path (the water clock, the camera's
     own feel-dt noise) then lurches. That showed up as a 4.7 m camera spike
     every 10.1 game-seconds, exactly on the chunk boundaries, and it is the
     tool's shadow, not the game's. Keep it one call. */
  say("running " + SEC + " game-seconds in one burst…");
  await burst(SEC);

  const S = await rig.evl(`(() => { const S = window.__SHK; return {
    ticks: S.ticks, moved: S.moved, jitter: S.jitter, jmax: S.jmax,
    hitstop: S.hitstop, slowmo: S.slowmo, by: S.by, calls: S.calls.slice(-60),
    n: S.calls.length,
    stage: S.stage, jumps: S.jumps,
    dmgTaken: +(S.dmg || 0).toFixed(0),
    sharkHp: CBZ.sharkSim.shark ? +(CBZ.sharkSim.shark.hp || 0).toFixed(0) : -1,
    seized: !!(CBZ.predatorDebug && CBZ.predatorDebug().seizes),
    hardHits: CBZ.humanContact ? CBZ.humanContact.stats().hardHits : -1,
    blocks: CBZ.humanContact ? CBZ.humanContact.stats().blocks : -1,
    pSpeed: +(CBZ.player.speed || 0).toFixed(2), pSprint: !!CBZ.player.sprint,
    mode: CBZ.game.mode, mounted: !!(CBZ.cityMountedAnimal && CBZ.cityMountedAnimal()),
    botsAlive: CBZ.bots.filter(b => !b.dead).length,
    botsDown: CBZ.bots.filter(b => !b.dead && (b.ko > 0 || (CBZ.body && CBZ.body.busy(b)))).length,
    tier: CBZ.sharkSim.tier, eaten: CBZ.sharkSim.eaten, mass: +CBZ.sharkSim.mass.toFixed(1),
  }; })()`);
  out.result = S;

  const dutyMove = S.ticks ? S.moved / S.ticks : 0;
  const rate = SEC ? Object.values(S.by).reduce((a, b) => a + b.n, 0) / SEC : 0;
  say("");
  say("  ticks " + S.ticks + "   game-seconds " + SEC + "   tier " + S.tier + "   eaten " + S.eaten);
  say("  SHAKE CALLS  " + Object.values(S.by).reduce((a, b) => a + b.n, 0) +
      "  (" + rate.toFixed(2) + "/s)");
  say("  CAMERA JITTER DUTY  " + (dutyMove * 100).toFixed(1) + "%  " +
      "(ticks with >2 cm of zig-zag)   mean " + (S.jitter / Math.max(1, S.ticks)).toFixed(3) +
      " m   max " + S.jmax.toFixed(2) + " m");
  say("  damage the pod landed on you: " + S.dmgTaken);
  say("  hardPlayerContact HITS " + S.hardHits + "   blocks " + S.blocks +
      "   |  player speed " + S.pSpeed + " sprint " + S.pSprint + " mode " + S.mode +
      " mounted " + S.mounted + "  |  bots alive " + S.botsAlive + " down " + S.botsDown);
  say("  HITSTOP duty " + (100 * S.hitstop / Math.max(1, S.ticks)).toFixed(1) +
      "%   SLOWMO duty " + (100 * S.slowmo / Math.max(1, S.ticks)).toFixed(1) + "%");
  say("");
  say("  WHERE THE JITTER ENTERS (second-difference of the lens, per stage)");
  for (const [name, st] of Object.entries(S.stage || {})) {
    say("   " + name.padEnd(12) + " duty " + (100 * st.over / Math.max(1, st.n)).toFixed(1).padStart(5) +
        "%  mean " + (st.sum / Math.max(1, st.n)).toFixed(4) + " m  max " + st.max.toFixed(2) + " m" +
        "   hist[<5mm|<1|<2|<5|<15|<50|50+cm] " + (st.hist || []).join("/"));
  }
  out.stage = S.stage;
  say("");
  say("  WHO SHAKES THE CAMERA");
  const rows = Object.entries(S.by).sort((a, b) => b[1].sum - a[1].sum);
  for (const [where, b] of rows) {
    say("   " + String(b.n).padStart(5) + "x  sum " + b.sum.toFixed(1).padStart(7) +
        "  max " + b.max.toFixed(2).padStart(5) + "  " + where);
  }
  out.rows = rows;
  out.duty = dutyMove;
  out.rate = rate;
} catch (e) {
  out.errors.push(String(e && e.message || e));
  say("FAIL: " + out.errors[out.errors.length - 1]);
} finally {
  out.pageErrors = (rig.errors || []).slice(0, 20);
  await mkdir(path.join(ROOT, "artifacts", "shark-shake"), { recursive: true });
  const f = path.join(ROOT, "artifacts", "shark-shake",
    "shake-" + (OFF.length ? "off-" + OFF.join("+") : "baseline") + ".json");
  await writeFile(f, JSON.stringify(out, null, 2));
  if (JSON_OUT) console.log(JSON.stringify(out, null, 2));
  else console.log("\n  → " + f);
  await rig.close();
}
