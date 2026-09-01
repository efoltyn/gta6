#!/usr/bin/env node
/* ============================================================
   tools/warlord-scale-check.mjs — HOW MANY MEN FIT IN ONE BATTLE.

   THE QUESTION NOBODY IN THIS REPO COULD ANSWER. battle.js caps a side at 300
   and the comment says why: "300 is battle.html's own measured neighbourhood
   (its saved `cbz-npcwar-max` is per side at 30 fps on the machine that ran
   it)". That is a number measured on a DIFFERENT PAGE, by a DIFFERENT tool, on
   an unnamed machine, at an unstated moment in the fight. It has never been
   re-measured against warlord's own battle — which is a different sim (morale,
   rout, four orders, sand.plant footprints, outfits.js bodies, ragdoll
   corpses) on different ground. So the cap was folklore.

   This file replaces the folklore with a sweep. It boots the real page at N v
   N, freezes the rAF clock, advances the fight to the beat where the two lines
   are actually shooting at each other (the expensive beat — not the walk-in,
   where nobody has a target and nobody is separating), and then times frames
   by hand.

   WHAT IT REPORTS AND WHY IT IS TWO NUMBERS, NOT ONE
   -------------------------------------------------
   Headless Chrome here runs ANGLE on SwiftShader — a software rasteriser. Its
   render time is not this machine's render time and is not any player's render
   time; on a real GPU the same frame is a small fraction of it. Its JAVASCRIPT
   time, however, is the same JavaScript on the same CPU, and that is what
   scales with the head count. So:

     SIM ms   the per-frame cost of battle.js's own simulation — think, morale,
              targeting, separation, the trigger, sand.plant. CPU-side. THIS
              NUMBER TRANSFERS to a real machine (a real machine's single-core
              JS throughput is within ~2x of this one, not 20x).
     DRAW ms  renderer.render(scene, camera), which on this rig is SwiftShader
              plus the scene-graph matrix walk. Only the matrix half transfers,
              so the matrix walk is timed SEPARATELY (scene.updateMatrixWorld)
              and reported as its own column.

   THE KNEE is therefore declared on the SIM budget, and stated as such: the
   largest N whose median simulated frame fits inside the CPU half of a 60 fps
   frame (16.7 ms) and inside a 30 fps frame (33.3 ms). Both are printed. A
   headline "max soldiers" that folded a software rasteriser into it would be a
   number about this laptop's lack of a GPU driver, not about the game.

     node tools/warlord-scale-check.mjs
     node tools/warlord-scale-check.mjs --sweep 100,200,300,500,800
     node tools/warlord-scale-check.mjs --n 600 --extra "squads=old"
     node tools/warlord-scale-check.mjs --n 600 --prof     (per-phase breakdown)
     node tools/warlord-scale-check.mjs --ab 600           (new vs ?squads=old)

   `--ab N` is the honest A/B: the same checkout, the same seed, the same N,
   twice — once as it ships and once with ?squads=old, battle.js's one-word
   revert of the formation/relevance layer. Two columns, one build.

   Exit 0 always unless --gate is passed, in which case a regression against
   --floor (default: 300 men per side inside the 30 fps CPU budget) fails.
============================================================ */
import { launch } from "./lib/cdp.mjs";

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d; };
const has = (n) => argv.includes(n);

const SEED = opt("--seed", "1337");
const EXTRA = opt("--extra", "");
const PROF = has("--prof");
const GATE = has("--gate");
const FLOOR = parseInt(opt("--floor", "300"), 10);
const AB = opt("--ab", null);
const ONE = opt("--n", null);
/* THE SWEEP LADDER. Geometric, because the thing being looked for is a knee
   and a knee is a slope change — an arithmetic ladder spends all its samples
   in the cheap half. 60 is "a real campaign skirmish", 300 is the shipped cap,
   and the top rungs exist to find where it actually breaks rather than to be
   playable. */
const SWEEP = (opt("--sweep", "") || "").split(",").map((s) => parseInt(s, 10)).filter(Boolean);

/* WHERE IN THE FIGHT TO MEASURE, and this is the single most important choice
   in the file. A battle is not one cost: at t=0 nobody has a target, nobody is
   inside separation range and nothing is dead, and a frame there is roughly
   half the cost of the same battle at contact.

   45 SECONDS IS MEASURED, NOT GUESSED, AND THE FIRST GUESS WAS WRONG. The
   arithmetic said contact at t=13: the lines start GAP()=160 m apart and march
   at 6.2 m/s each, so 160 / 12.4 = 13 s. Wrong, because they never march — the
   target grid's SIGHT is 175 m, so every man ACQUIRES a mark before he takes a
   step, and from then on it is combat_iq's posture() holding a weapon's
   preferred distance rather than marchGoal driving him at the enemy. MEASURED
   at 60 v 60, seed 1337: t=30 had 10 shots fired in the whole battle and zero
   dead — the "grind" was still a staring contest. t=45 had 265 shots and four
   bodies on the sand. So 45. */
const WARM_S = parseFloat(opt("--warm", "45"));
/* THE WARM-UP RUNS AT 1/30 AND THE MEASUREMENT AT 1/60. Warm-up is wall-clock
   expensive and its only job is to put the men where they belong; the step
   only has to be small enough that the sim stays legal (battle.js sub-steps at
   0.055 s internally, so 1/30 is one sub-step and 1/60 is one sub-step — the
   integration is identical, only the schedule of think()s differs). */
const WARM_STEP = 1 / 30;
const FRAMES = parseInt(opt("--frames", "70"), 10);

const BUDGET60 = 1000 / 60;      // 16.67 ms — a whole 60 fps frame
const BUDGET30 = 1000 / 30;      // 33.33 ms

/* ---- the page-side instrument -------------------------------------------
   Installed once per page. Everything here is timed IN the page, because a
   CDP round trip is ~1-3 ms and would be a third of the measurement. Medians,
   not means: a GC pause in the middle of seventy frames is a real cost but it
   is not the frame cost, and the p90 column is where it shows up honestly. */
const INSTRUMENT = `(() => {
  const B = window.__warlordBattle;
  const stat = (t) => {
    const s = t.slice().sort((a, b) => a - b);
    const sum = s.reduce((a, v) => a + v, 0);
    return { med: +s[s.length >> 1].toFixed(3),
             p90: +s[Math.min(s.length - 1, Math.floor(s.length * 0.9))].toFixed(3),
             mean: +(sum / s.length).toFixed(3),
             min: +s[0].toFixed(3) };
  };
  window.__wlScale = {
    /* SIM ONLY. advance(dt, dt) is exactly one battle.js frame() with injectDt
       set, so the wall-clock/substep logic is bypassed and one call is one
       simulated frame — the same code path the game runs, minus the draw. */
    sim(frames, dt) {
      const t = [];
      for (let i = 0; i < frames; i++) {
        const a = performance.now();
        B.advance(dt, dt);
        t.push(performance.now() - a);
      }
      return stat(t);
    },
    /* DRAW ONLY, on a scene the sim has already moved. Called back-to-back
       without a sim step in between on purpose: three.js re-walks the whole
       matrix tree on every render regardless (scene.autoUpdate), so this is
       not measuring a cached frame. */
    draw(frames) {
      const t = [];
      for (let i = 0; i < frames; i++) {
        const a = performance.now();
        B.render();
        t.push(performance.now() - a);
      }
      return stat(t);
    },
    /* THE MATRIX WALK ALONE — the half of DRAW that is real CPU work and
       therefore the half that transfers off SwiftShader. force=true so it is
       the same full-tree walk renderer.render triggers. */
    matrix(frames) {
      const S = CBZ.scene, t = [];
      for (let i = 0; i < frames; i++) {
        const a = performance.now();
        S.updateMatrixWorld(true);
        t.push(performance.now() - a);
      }
      return stat(t);
    },
    /* A REAL FRAME: sim then draw, which is what the browser does. Reported so
       nobody has to trust that SIM + DRAW adds up. */
    frame(frames, dt) {
      const t = [];
      for (let i = 0; i < frames; i++) {
        const a = performance.now();
        B.advance(dt, dt);
        B.render();
        t.push(performance.now() - a);
      }
      return stat(t);
    },
    /* HOW BIG THE SCENE GRAPH IS. The matrix walk is O(nodes), not O(men), and
       a rigged man is ~30 nodes — which is the whole reason the matrix column
       exists. Counted, not assumed. */
    graph() {
      let n = 0, vis = 0;
      CBZ.scene.traverse((o) => { n++; if (o.visible) vis++; });
      return { nodes: n, visible: vis,
               calls: (CBZ.renderer && CBZ.renderer.info && CBZ.renderer.info.render.calls) || 0,
               tris: (CBZ.renderer && CBZ.renderer.info && CBZ.renderer.info.render.triangles) || 0 };
    },
    warm(sec, step) {
      B.freeze();
      return B.advance(sec, step);
    },
  };
  return true;
})()`;

async function bootBattle(rig, n, extra) {
  const q = [
    "battle=1", "frozen=1", `seed=${SEED}`,
    `mine=${n}`, `them=${n}`, `men=${n}`,
    "gun=ak47", "weather=off", "sound=off",
  ];
  if (extra) q.push(extra);
  const url = await rig.open("games/warlord.html", q.join("&"));
  const up = await rig.wait(
    `!!(window.__warlordBattle && window.__warlordBattle.live && window.__warlordBattle.live())`,
    420000);
  if (!up) throw new Error(`the battle never started at n=${n}`);
  await rig.evl(INSTRUMENT);
  return url;
}

async function measure(rig, n, extra, label) {
  const t0 = Date.now();
  await bootBattle(rig, n, extra);
  const warm = await rig.evl(`window.__wlScale.warm(${WARM_S}, ${WARM_STEP})`);
  if (PROF) await rig.evl(`window.__warlordBattle.profile && window.__warlordBattle.profile(true)`);
  const audit = await rig.evl(`window.__warlordBattle.audit()`);
  const graph = await rig.evl(`window.__wlScale.graph()`);
  const sim = await rig.evl(`window.__wlScale.sim(${FRAMES}, ${1 / 60})`);
  const matrix = await rig.evl(`window.__wlScale.matrix(12)`);
  const draw = await rig.evl(`window.__wlScale.draw(12)`);
  const frame = await rig.evl(`window.__wlScale.frame(20, ${1 / 60})`);
  let prof = null;
  if (PROF) prof = await rig.evl(`window.__warlordBattle.profile && window.__warlordBattle.profile()`);
  const bodies = audit && audit.bodies || 0;
  const alive = audit ? (audit.mine.alive + audit.them.alive) : 0;
  const row = {
    label: label || (extra || "new"),
    n, bodies, alive, corpses: audit && audit.corpses, solving: audit && audit.solving,
    simT: audit && audit.simT, over: audit && audit.over,
    shots: audit ? (audit.mine.shots + audit.them.shots) : 0,
    routing: audit ? (audit.mine.routing + audit.them.routing) : 0,
    sim, draw, matrix, frame, graph, prof,
    wallS: Math.round((Date.now() - t0) / 100) / 10,
  };
  return row;
}

const pad = (s, w) => String(s).padStart(w);
function printRow(r) {
  console.log(
    `  ${pad(r.n, 5)} ${pad(r.bodies, 6)} ${pad(r.alive, 6)} ${pad(r.corpses, 5)}  ` +
    `${pad(r.sim.med.toFixed(2), 8)} ${pad(r.sim.p90.toFixed(2), 8)}  ` +
    `${pad(r.matrix.med.toFixed(2), 8)}  ${pad(r.draw.med.toFixed(1), 8)}  ` +
    `${pad(r.frame.med.toFixed(1), 8)}  ${pad(r.graph.nodes, 7)}  ${pad(r.wallS + "s", 7)}  ` +
    `t=${r.simT} shots=${r.shots} rout=${r.routing}${r.over ? " OVER" : ""}`);
}
function header() {
  console.log(`      N  bodies  alive   cps    SIM med   SIM p90    MATRIX     DRAW*    FRAME*    nodes     wall`);
  console.log(`  ${"-".repeat(96)}`);
}

/* THE KNEE, stated as an interpolation rather than as "the last rung that
   passed". The ladder is geometric, so the last passing rung understates the
   answer by up to the rung spacing — which at the top of the ladder is
   hundreds of men. Linear interpolation on (men, ms) between the last pass and
   the first fail is the honest reading of a sweep this coarse, and it is
   labelled as an interpolation everywhere it is printed. */
function knee(rows, budgetMs) {
  const pts = rows.map((r) => ({ men: r.bodies, ms: r.sim.med })).sort((a, b) => a.men - b.men);
  let last = null;
  for (let i = 0; i < pts.length; i++) {
    if (pts[i].ms <= budgetMs) { last = pts[i]; continue; }
    if (!last) return { men: 0, exact: true };
    const f = (budgetMs - last.ms) / (pts[i].ms - last.ms);
    return { men: Math.round(last.men + f * (pts[i].men - last.men)), exact: false,
             between: [last.men, pts[i].men] };
  }
  return { men: last ? last.men : 0, exact: true, off: true };
}

/* ---- THE OTHER SCALE QUESTION: HOW MANY ARMIES FIT ON THE ISLAND --------
   The battle sweep above answers "how many men in one fight". The owner's ask
   had a second half — "way more total armies" — and that is a different cost
   in a different file: campaign.js integrates every party on the map every
   frame, and the integration is ~5 desert.heightAt calls, which desert.js's
   own comment calls the hot path in that file.

   THIS MEASURES THE CAMPAIGN FRAME, not a battle: boot with ?bands=N, ride
   nothing, and time micro.stepSim — which runs worldTick (the parties) and
   step (the draw) exactly as the game does. Three columns, because there are
   three different ceilings and only one of them is the frame:

     STEP ms   the campaign frame. CPU-side, transfers.
     SAVE KB   JSON.stringify of W.state. localStorage is 5 MB in every
               browser that matters and W.save() FAILS SILENTLY past it
               (`catch (e) { return false; }` and nobody checks), so a
               population that does not fit is a game that stops saving and
               never says so. This is the ceiling nobody would have found by
               looking at a frame rate.
     souls     every soldier object in the world. What the save is made of.

     node tools/warlord-scale-check.mjs --island
     node tools/warlord-scale-check.mjs --island --extra far=old   (the A/B) */
const ISLAND_INSTRUMENT = `(() => {
  window.__wlIsle = {
    stat(t) {
      const s = t.slice().sort((a, b) => a - b);
      return { med: +s[s.length >> 1].toFixed(3),
               p90: +s[Math.min(s.length - 1, Math.floor(s.length * 0.9))].toFixed(3) };
    },
    frame(n) {
      const M = CBZ.micro, t = [];
      for (let i = 0; i < n; i++) {
        const a = performance.now();
        M.stepSim(1 / 60);
        t.push(performance.now() - a);
      }
      return window.__wlIsle.stat(t);
    },
    draw(n) {
      const R = CBZ.renderer, t = [];
      for (let i = 0; i < n; i++) {
        const a = performance.now();
        R.render(CBZ.scene, CBZ.camera);
        t.push(performance.now() - a);
      }
      return window.__wlIsle.stat(t);
    },
    saveKB() {
      try { return Math.round(JSON.stringify(CBZ.warlord.state).length / 1024); }
      catch (e) { return -1; }
    },
    warm(n) { const M = CBZ.micro; M.stop && M.stop(); for (let i = 0; i < n; i++) M.stepSim(1 / 60); return true; },
  };
  return true;
})()`;

async function island(rig, n, extra) {
  const q = [`go=1`, `seed=${SEED}`, `bands=${n}`, "weather=off", "sound=off"];
  if (extra) q.push(extra);
  await rig.open("games/warlord.html", q.join("&"));
  const up = await rig.wait(
    `window.__warlordReady === true && CBZ.warlord.phase && CBZ.warlord.phase() === "campaign"`, 420000);
  if (!up) throw new Error(`the campaign never came up at bands=${n}`);
  await rig.evl(ISLAND_INSTRUMENT);
  // let the parties pick goals and start walking before timing them
  await rig.evl(`window.__wlIsle.warm(120)`);
  const frame = await rig.evl(`window.__wlIsle.frame(90)`);
  const draw = await rig.evl(`window.__wlIsle.draw(10)`);
  const saveKB = await rig.evl(`window.__wlIsle.saveKB()`);
  const a = await rig.evl(`CBZ.warlord.campaign.audit()`);
  return { n, frame, draw, saveKB, world: a.world, drawnMen: a.drawnMen,
           rigs: a.men && a.men.rigs, calls: a.calls };
}

const run = async () => {
  const rig = await launch({ rafBudget: 0 });
  const rows = [];
  const fails = [];
  try {
    if (has("--island")) {
      const ladder = ONE ? [parseInt(ONE, 10)]
        : (SWEEP.length ? SWEEP : [40, 100, 200, 400, 700, 1000]);
      console.log(`\nwarlord island scale — seed ${SEED}` + (EXTRA ? `, ${EXTRA}` : "") + `\n` +
        `  ?bands=N sets the BIG parties; the small ones ride on top at W.SMALL_PER_BIG.\n` +
        `  DRAW* is SwiftShader and does not transfer. STEP is CPU and does.\n`);
      console.log(`  bands  parties    big  small    far   souls   STEP med   STEP p90     DRAW*   SAVE KB   drawn`);
      console.log(`  ${"-".repeat(103)}`);
      for (const n of ladder) {
        let r = null;
        try { r = await island(rig, n, EXTRA || null); }
        catch (e) { console.log(`  ${pad(n, 5)}  FAILED: ${String(e.message || e).slice(0, 70)}`); continue; }
        const w = r.world || {};
        console.log(`  ${pad(n, 5)}  ${pad(w.parties, 7)} ${pad(w.big, 6)} ${pad(w.small, 6)} ` +
          `${pad(w.far, 6)}  ${pad(w.souls, 6)}   ${pad(r.frame.med.toFixed(2), 8)}   ` +
          `${pad(r.frame.p90.toFixed(2), 8)}  ${pad(r.draw.med.toFixed(1), 8)}  ${pad(r.saveKB, 8)}  ${pad(r.drawnMen, 6)}`);
        rows.push(r);
        if (r.frame.med > 60) { console.log(`  (stopping: campaign frame past 60 ms)`); break; }
      }
      console.log(`\n  localStorage is 5 MB (5120 KB) in every browser that matters, and\n` +
                  `  W.save() swallows the quota error — a SAVE KB near that is a game that\n` +
                  `  silently stops saving, which is a harder failure than a slow frame.`);
    } else if (AB) {
      const n = parseInt(AB, 10);
      console.log(`\nA/B at ${n} v ${n} — same checkout, same seed, one flag apart\n`);
      header();
      const a = await measure(rig, n, EXTRA || null, "new");
      printRow(a); rows.push(a);
      /* THE "OLD" COLUMN IS EVERY REVERT AT ONCE, and it has to be: the
         formation layer and the height field are two halves of one rewrite
         (the field is what made a sight line cheap enough for a squad to test
         contact with), and a column that reverted one of them would be a
         build nobody ever shipped. The spawn frontage and the freeSpot hash
         are NOT reverted — see battle.js's flag block for why. */
      const b = await measure(rig, n, (EXTRA ? EXTRA + "&" : "") + "squads=old&field=old", "old");
      printRow(b); rows.push(b);
      const d = (x, y) => `${x.toFixed(2)} -> ${y.toFixed(2)} ms  (${(((y - x) / x) * 100).toFixed(0)}%)`;
      console.log(`\n  old = ?squads=old&field=old on this same checkout`);
      console.log(`\n  SIM      ${d(b.sim.med, a.sim.med)}`);
      console.log(`  MATRIX   ${d(b.matrix.med, a.matrix.med)}`);
      console.log(`  FRAME*   ${d(b.frame.med, a.frame.med)}`);
      console.log(`  nodes    ${b.graph.nodes} -> ${a.graph.nodes}`);
      if (a.prof || b.prof) {
        console.log(`\n  per-phase ms/frame (old | new)`);
        const keys = new Set([...Object.keys(b.prof || {}), ...Object.keys(a.prof || {})]);
        for (const k of keys) {
          if (k === "frames") continue;
          console.log(`    ${k.padEnd(12)} ${pad(((b.prof || {})[k] || 0).toFixed(3), 8)} | ${pad(((a.prof || {})[k] || 0).toFixed(3), 8)}`);
        }
      }
    } else {
      const ladder = ONE ? [parseInt(ONE, 10)] : (SWEEP.length ? SWEEP : [60, 150, 300, 500, 800, 1200]);
      console.log(`\nwarlord battle scale — seed ${SEED}, measured at t=${WARM_S}s of fight` +
                  (EXTRA ? `, ${EXTRA}` : "") + `\n` +
                  `DRAW* and FRAME* include SwiftShader and DO NOT transfer to a real GPU.\n`);
      header();
      for (const n of ladder) {
        let r = null;
        try { r = await measure(rig, n, EXTRA || null); }
        catch (e) { console.log(`  ${pad(n, 5)}  FAILED: ${String(e.message || e).slice(0, 70)}`); continue; }
        printRow(r);
        rows.push(r);
        if (r.prof) {
          const p = r.prof;
          console.log(`         phases: ` + Object.keys(p).filter((k) => k !== "frames")
            .map((k) => `${k} ${p[k].toFixed(2)}`).join("  "));
        }
        // stop climbing once a frame costs more than a quarter second of CPU:
        // past that the sweep is only measuring how patient the tool is.
        if (r.sim.med > 250) { console.log(`  (stopping: sim frame past 250 ms)`); break; }
      }
      if (rows.length > 1) {
        const k60 = knee(rows, BUDGET60), k30 = knee(rows, BUDGET30);
        console.log(`\n  THE NUMBER (CPU-side, SwiftShader excluded):`);
        console.log(`    60 fps CPU budget (16.7 ms/frame): ~${k60.men} bodies` +
          (k60.exact ? "" : ` (interpolated between ${k60.between.join(" and ")})`) +
          `  = ${Math.floor(k60.men / 2)} a side`);
        console.log(`    30 fps CPU budget (33.3 ms/frame): ~${k30.men} bodies` +
          (k30.exact ? "" : ` (interpolated between ${k30.between.join(" and ")})`) +
          `  = ${Math.floor(k30.men / 2)} a side`);
        if (GATE && k30.men < FLOOR * 2) {
          fails.push(`the 30 fps knee is ${k30.men} bodies, under the ${FLOOR * 2} floor`);
        }
      }
    }
    for (const e of (rig.errors || [])) console.log(`  console error: ${String(e).slice(0, 160)}`);
  } finally {
    await rig.close();
  }
  if (fails.length) {
    console.log(`\nWARLORD SCALE: FAIL`);
    for (const f of fails) console.log("  " + f);
    process.exit(1);
  }
  console.log(`\nWARLORD SCALE: done`);
};

run().catch((e) => { console.error(e); process.exit(1); });
