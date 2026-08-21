#!/usr/bin/env node
/* tools/disaster-check.mjs — THE ORACLE for Natural Disaster Survival.

   One question, asked the same way every time: does the disaster island boot,
   stand up a match, run EVERY disaster in its roster, and never throw? The
   whole App Store wave is gated on this — the slice page, the bundle, the
   fixed-step sim — so it has to be honest about a page it has never seen
   before and cheap enough to run in a minimizer loop.

     node tools/disaster-check.mjs                      # index.html (baseline)
     node tools/disaster-check.mjs --url disaster.html  # the slice page
     node tools/disaster-check.mjs --quick              # skip the roster sweep
     node tools/disaster-check.mjs --json

   THREE THINGS IT ASSERTS, and they are different in kind:

   1. THE MATCH STANDS UP. Playable survival state, an arena with real ground
      under the spawn, a bot field, a live player, a running director.
   2. EVERY DISASTER RUNS. `CBZ.disasters.force(id)` for all eleven, each
      driven through warn → active → over, asserting it reached ACTIVE and
      that nothing threw. This is the assertion that makes the minimizer safe:
      a page missing world/volcanofx.js does not merely look worse, it fails
      here.
   3. THE FEATURES ARE STILL THERE. A census of the named systems this game
      is made of (wildlife, water, weather, trauma, killfeed, touch, gore,
      facades…). Dropping a script that no disaster happens to touch in 20
      seconds is exactly how a slice silently loses the sea life; the census
      is what stops it.

   MEASURED, never asserted (SwiftShader is not a phone — compare runs, don't
   quote one): requests, JS bytes, ms to playable, heap, scene objects. */
import { launch } from "./lib/cdp.mjs";

const argv = process.argv.slice(2);
const arg = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d; };
const has = (f) => argv.includes(f);

const URL_REL = arg("--url", "index.html");
const SEED = arg("--seed", "90210");
const BOTS = arg("--bots", "");          // fewer bots = a faster minimizer loop
const QUICK = has("--quick");
/* --fast: still every disaster, but only into the first seconds of its active
   phase instead of all the way through it. warn() and the opening of active()
   are where a def touches everything it owns, so this keeps the assertion that
   makes the minimizer safe while costing a quarter of the ticks. */
const FAST = has("--fast");
const HOLD = FAST ? 240 : 5400;
const JSON_OUT = has("--json");
const say = (m) => { if (!JSON_OUT) console.log(m); };

/* THE CENSUS. Every row is a system this game is actually made of, named by
   the symbol its file publishes. `soft` rows are reported but never fail the
   run — they are the ones a legitimately smaller page may drop. */
const CENSUS = [
  ["three", "window.THREE && THREE.REVISION"],
  ["arena", "CBZ.buildDisasterArena"],
  ["director", "CBZ.disasters && CBZ.disasters.force"],
  ["water", "CBZ.survSeaHeightAt && CBZ.waterSurgeSet"],
  ["swim", "CBZ.citySwimming"],
  ["weather", "CBZ.weatherDrive"],
  ["wildlife", "CBZ.cityWildlifeStock"],
  ["marine", "CBZ.WILDLIFE_SPECIES"],
  ["fx", "CBZ.fx && CBZ.fx.blast"],
  ["gore", "CBZ.gore"],
  ["trauma", "CBZ.trauma && CBZ.trauma.deathGore"],
  ["killfeed", "CBZ.cityLogDeath"],
  ["tornado", "CBZ.tornado && CBZ.tornado.spawn"],
  ["volcano", "CBZ.volcanoFx"],
  ["quake", "CBZ.quake"],
  ["shaft", "CBZ.groundShaft"],
  ["lightning", "CBZ.lightningStrike"],
  ["structure", "CBZ.structure"],
  ["detonate", "CBZ.detonate"],
  ["character", "CBZ.playerChar && CBZ.playerChar.group"],
  ["bots", "CBZ.spawnSurvivorBots"],
  ["physics", "CBZ.stepSim"],
  ["camera", "CBZ.cam"],
  ["touch", "CBZ.touchAudit"],
  ["audio", "CBZ.sfx || CBZ.audio || CBZ.playSound"],
  ["hud", "document.getElementById('survBars')"],
  ["interact", "CBZ._prisonPromptSites && CBZ._prisonPromptSites.length"],
  ["facades", "CBZ.dressFacade"],
  ["spectate", "CBZ.spectate || CBZ.clearSpectate"],
];

const ROSTER = ["quake", "storm", "flashflood", "flood", "wildfire", "tornado",
  "hurricane", "blizzard", "meteor", "sinkhole", "volcano"];

const report = { url: URL_REL, ok: false, fails: [], measures: {}, errors: [], census: {} };
const fail = (m) => { report.fails.push(m); };

const rig = await launch({ rafBudget: 1600 });
try {
  const t0 = Date.now();
  await rig.open(URL_REL, `seed=${SEED}` + (BOTS ? `&surv_bots=${BOTS}` : ""));

  if (!await rig.wait("window.CBZ && CBZ.game", 120000)) {
    fail("page never published window.CBZ"); throw new Error("no engine");
  }
  report.measures.msToEngine = Date.now() - t0;
  if (BOTS) await rig.evl(`CBZ.SURV_BOTS = ${+BOTS}`);

  const playing = await rig.wait(`(() => {
    if (CBZ.game.state === 'playing' && CBZ.game.mode === 'survival') return true;
    const mb = document.querySelector('.mode-btn[data-mode="survival"]'); if (mb) mb.click();
    const pb = document.getElementById('playBtn'); if (pb) pb.click();
    return CBZ.game.state === 'playing' && CBZ.game.mode === 'survival';
  })()`, 300000, 250);
  if (!playing) { fail("never entered a survival match"); throw new Error("no match"); }
  report.measures.msToPlayable = Date.now() - t0;
  say(`playable in ${report.measures.msToPlayable} ms`);

  // ---- 1. the match stands up --------------------------------------------
  const world = await rig.evl(`(() => {
    const A = CBZ.surv && CBZ.surv.arena, p = CBZ.player;
    let n = 0; if (CBZ.scene) CBZ.scene.traverse(() => n++);
    return { arena: !!A, radius: A ? A.radius : 0,
      ground: A && A.groundHeightAt ? A.groundHeightAt(p.pos.x, p.pos.z) : null,
      bots: CBZ.bots ? CBZ.bots.length : 0, hp: p.hp, dead: !!p.dead,
      py: p.pos.y, objects: n, dirState: CBZ.disasters ? CBZ.disasters.state() : null };
  })()`);
  report.measures.world = world;
  if (!world.arena) fail("no disaster arena after entering the match");
  if (!(world.radius > 50)) fail("arena radius looks wrong: " + world.radius);
  if (world.ground == null || !isFinite(world.ground)) fail("no ground height under the spawn");
  if (world.py < world.ground - 3) fail("player spawned below the ground");
  if (world.bots < 8) fail("bot field never spawned (" + world.bots + ")");
  if (world.dead || !(world.hp > 0)) fail("player starts dead");
  if (!world.dirState) fail("disaster director is not running");

  // ---- 3. the census (cheap, so take it before the long sweep) -------------
  report.census = await rig.evl("(" + JSON.stringify(CENSUS) + ").reduce((o, [k, e]) => {" +
    "try { o[k] = !!eval(e); } catch (_) { o[k] = false; } return o; }, {})");
  const missing = Object.keys(report.census).filter((k) => !report.census[k]);
  if (missing.length) fail("census missing: " + missing.join(", "));

  // ---- 2. every disaster runs ---------------------------------------------
  rig.clearErrors();
  const sweep = { ran: [], neverActive: [], ticks: 0 };
  if (!QUICK) {
    /* ONE FRESH MATCH PER DISASTER. force(id) only re-points the director at a
       slot in THIS run's shuffled order, so a hazard that outlives the tick
       budget (the tornado runs for a minute) leaves the ones behind it never
       reached — which is a fact about the harness, not about the game. A
       reset() before each force gives every def the same clean island, the
       same live bot field and a living player to threaten. */
    for (const id of ROSTER) {
      const r = await rig.evl(`(async () => {
        CBZ.modes.survival.reset(CBZ.game);
        if (!CBZ.disasters.force(${JSON.stringify(id)})) return { forced: false };
        let active = 0, ticks = 0, warned = 0, ended = false;
        for (let i = 0; i < 5400 && !ended; i++) {
          CBZ.stepSim(1 / 60); ticks++;
          const st = CBZ.disasters.state();
          if (st === 'warn') warned++;
          else if (st === 'active') { active++; if (active >= ${HOLD}) ended = true; }
          else if (active > 0) ended = true;              // it ran, and it is over
          if (i % 150 === 0) await new Promise(r => setTimeout(r, 0));
        }
        const p = CBZ.player;
        return { forced: true, active, warned, ticks, ended,
                 x: p.pos.x, y: p.pos.y, z: p.pos.z,
                 live: CBZ.bots ? CBZ.bots.filter(b => !b.dead).length : 0,
                 killed: CBZ.bots ? CBZ.bots.filter(b => b.dead).length : 0 };
      })()`, true);
      sweep.ticks += r.ticks || 0;
      sweep.ran.push({ id, ...r });
      if (!r.forced) fail(id + ": the director does not know this disaster");
      else if (!r.active) sweep.neverActive.push(id);
      if (r.x != null && !(isFinite(r.x) && isFinite(r.y) && isFinite(r.z))) fail(id + ": player position went NaN");
      say(`  ${id.padEnd(11)} ${r.active ? String(r.active).padStart(4) + " active ticks · killed " + r.killed : "NEVER ACTIVE"}`);
    }
    if (sweep.neverActive.length) fail("never reached active: " + sweep.neverActive.join(", "));
  } else {
    const r = await rig.evl(`(async () => { let active = 0;
      for (let i = 0; i < 1800; i++) { CBZ.stepSim(1/60); if (CBZ.disasters.state() === 'active') active++;
        if (i % 150 === 0) await new Promise(r => setTimeout(r, 0)); }
      return { active, cur: CBZ.disasters.current() }; })()`, true);
    sweep.quick = r;
    if (!r.active) fail("no disaster reached its active phase in 30 s");
  }
  report.measures.sweep = sweep;

  /* THE SHARK-BRAIN CHAIN. Two files capture-and-wrap CBZ.sharkBrain and both
     re-arm from a per-frame pass; when the re-arm test was "am I on top?" they
     wrapped each other forever — two links a frame — and a match died of a
     stack overflow inside the wildlife tick after about ninety seconds. The
     depth is a RATCHET: three links (shark + predation + orca) after tens of
     thousands of simulated ticks, and it may never grow. */
  const brainChain = await rig.evl("CBZ.marineAudit ? CBZ.marineAudit().brainChain : 0");
  report.measures.brainChain = brainChain;
  if (brainChain > 6) fail("shark brain wrapper chain is " + brainChain + " links deep — a per-frame re-wrap is back");

  report.measures.heapMB = await rig.evl("performance.memory ? Math.round(performance.memory.usedJSHeapSize/1048576) : null");

  // ---- what threw, and what never arrived ---------------------------------
  report.errors = rig.errors.slice(0, 20);
  const netErrors = rig.netErrors.filter((e) => !/favicon/i.test(e));
  if (netErrors.length) { report.netErrors = netErrors.slice(0, 20); fail(netErrors.length + " failed resource loads (" + netErrors[0] + ")"); }
  if (report.errors.length) fail(report.errors.length + " uncaught errors (" + report.errors[0] + ")");

  report.measures.net = {
    requests: await rig.evl("performance.getEntriesByType('resource').length"),
    scripts: await rig.evl("document.querySelectorAll('script[src]').length"),
    jsBytes: await rig.evl("performance.getEntriesByType('resource').filter(r=>/\\.js(\\?|$)/.test(r.name)).reduce((a,r)=>a+(r.decodedBodySize||0),0)"),
  };
} catch (e) {
  if (!report.fails.length) fail(String((e && e.message) || e));
  report.errors = rig.errors.slice(0, 20);
} finally {
  await rig.close();
}

report.ok = report.fails.length === 0;
if (JSON_OUT) console.log(JSON.stringify(report, null, 1));
else {
  const m = report.measures;
  console.log("");
  console.log("  page            " + report.url);
  if (m.net) console.log("  requests / JS   " + m.net.requests + " / " + (m.net.jsBytes / 1048576).toFixed(2) + " MB  (" + m.net.scripts + " script tags)");
  if (m.msToPlayable) console.log("  time to play    " + m.msToPlayable + " ms  (engine at " + m.msToEngine + " ms)");
  if (m.world) console.log("  world           radius " + Math.round(m.world.radius) + " · " + m.world.bots + " bots · " + m.world.objects + " objects");
  if (m.sweep && m.sweep.ran.length) console.log("  roster          " + m.sweep.ran.length + " disasters · " + m.sweep.ticks + " ticks");
  if (m.heapMB) console.log("  heap            " + m.heapMB + " MB");
  console.log("");
  if (report.ok) console.log("  DISASTER-CHECK: ok");
  else { console.log("  DISASTER-CHECK: FAIL"); for (const f of report.fails) console.log("    - " + f); }
  if (report.errors.length) { console.log("  errors:"); for (const e of report.errors.slice(0, 8)) console.log("    ! " + e); }
}
process.exit(report.ok ? 0 : 1);
