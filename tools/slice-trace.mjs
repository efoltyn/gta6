#!/usr/bin/env node
/* tools/slice-trace.mjs — WHICH FILES DOES THE DISASTER GAME ACTUALLY USE?

   index.html ships 553 script tags and 25 MB of JavaScript because it is the
   whole release: the prison, the city, the campaign, six games. Natural
   Disaster Survival is ONE of them, and on a phone it pays for all six before
   it can draw a frame. The App Store build needs the subset — and the subset
   has to be MEASURED, because guessing it from filenames is how you ship an
   island with no sharks.

   THE INSTRUMENT. Every module in this repo hangs off one object, `window.CBZ`,
   and every module publishes what it owns onto it. So before a single game
   script runs, this tool replaces CBZ with a Proxy that answers two questions:

     WHO PUBLISHED THIS?  the `set` trap stamps document.currentScript.src on
                          every symbol as it is written — a live, exact
                          file→symbol map, with no static analysis to be wrong.
     WHO IS READ?         the `get` trap records the symbol names something
                          actually looked at, across a boot and a full sweep of
                          the disaster roster.

   Plus the two registrations a file can make where the symbol never gets read
   again: CBZ.onUpdate / CBZ.onAlways. Those are wrapped so the tool knows both
   which file registered a per-frame pass and whether that pass DID anything
   (called once with dt > 0 counts as used).

   A file is USED if something read a symbol it published, or a pass it
   registered ran, or it is one of the roots. Everything else is a candidate to
   drop — a candidate, not a verdict: tools/disaster-check.mjs is what decides,
   and tools/build-disaster-page.mjs is what builds the page.

     node tools/slice-trace.mjs                    # writes tools/disaster-slice.json
     node tools/slice-trace.mjs --print            # ... and prints the drop list

   COST: the hottest object in the engine behind a Proxy. Expect the sim to run
   several times slower than normal. That is fine; nothing here is a benchmark. */
import { writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { launch, ROOT } from "./lib/cdp.mjs";

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const arg = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d; };
const OUT = path.join(ROOT, "tools/disaster-slice.json");

/* THE TRACER. Runs before any game script. Everything it needs must be inline —
   this string is injected, it cannot import. */
const TRACER = `(() => {
  const target = {};
  const owner = Object.create(null);     // symbol -> script src that wrote it
  const read = Object.create(null);      // symbol -> times read
  const passes = [];                     // { file, ran }
  const here = () => {
    const s = document.currentScript;
    return (s && s.src) ? s.src.split("?")[0].split("/src/").pop() : null;
  };
  function wrapReg(fn, kind) {
    return function (order, cb) {
      const file = here();
      const rec = { file, kind, order, ran: 0 };
      passes.push(rec);
      const wrapped = typeof cb === "function" ? function (dt) {
        if (dt > 0) rec.ran++;
        return cb.apply(this, arguments);
      } : cb;
      return fn.call(this, order, wrapped);
    };
  }
  const proxy = new Proxy(target, {
    get(t, k) {
      if (typeof k === "string") read[k] = (read[k] || 0) + 1;
      return t[k];
    },
    set(t, k, v) {
      if (typeof k === "string") {
        const f = here();
        if (f && !owner[k]) owner[k] = f;
        if ((k === "onUpdate" || k === "onAlways") && typeof v === "function") {
          t[k] = wrapReg(v, k);
          return true;
        }
      }
      t[k] = v;
      return true;
    },
  });
  window.CBZ = proxy;
  // Nothing else may replace it: config.js does \`window.CBZ = window.CBZ || {}\`,
  // which keeps ours, but a stray assignment elsewhere would blind the tool.
  try {
    Object.defineProperty(window, "CBZ", {
      get() { return proxy; }, set() { return true; }, configurable: false,
    });
  } catch (e) {}
  window.__slice = () => ({ owner, read, passes });
})();`;

const rig = await launch({ rafBudget: 1600, preload: TRACER });
const out = { generatedAt: new Date().toISOString(), used: [], unused: [], readOnly: [], stats: {} };
try {
  await rig.open("index.html", `seed=${arg("--seed", "90210")}&mode=survival`);
  if (!await rig.wait("window.CBZ && CBZ.game && CBZ.stepSim", 180000)) throw new Error("engine never came up");
  await rig.evl(`CBZ.SURV_BOTS = ${+arg("--bots", "16")}`);
  const playing = await rig.wait(`(() => {
    if (CBZ.game.state === 'playing' && CBZ.game.mode === 'survival') return true;
    const mb = document.querySelector('.mode-btn[data-mode="survival"]'); if (mb) mb.click();
    const pb = document.getElementById('playBtn'); if (pb) pb.click();
    return CBZ.game.state === 'playing' && CBZ.game.mode === 'survival';
  })()`, 300000, 250);
  if (!playing) throw new Error("never entered a survival match");
  console.error("[slice] playing — sweeping the roster");

  /* SWEEP EVERY DISASTER. A file the volcano needs is invisible to a trace of
     a match that only ever rained. Each def is forced, driven into its active
     phase and held there a few seconds — long enough for warn() and the first
     seconds of active(), which is where a def touches everything it owns. */
  for (const id of ["quake", "storm", "flashflood", "flood", "wildfire", "tornado",
    "hurricane", "blizzard", "meteor", "sinkhole", "volcano"]) {
    const r = await rig.evl(`(async () => {
      CBZ.modes.survival.reset(CBZ.game);
      CBZ.disasters.force(${JSON.stringify(id)});
      let active = 0;
      for (let i = 0; i < 2600 && active < 420; i++) {
        CBZ.stepSim(1 / 60);
        if (CBZ.disasters.state() === 'active') active++;
        if (i % 120 === 0) await new Promise(r => setTimeout(r, 0));
      }
      return active;
    })()`, true);
    console.error(`[slice]   ${id} ${r} active ticks`);
  }

  /* THE THINGS A MATCH DOES BESIDES BEING RAINED ON. Swimming, dying, the
     death cam, the map, pausing — each is a file, and a trace that never
     does them drops them. */
  await rig.evl(`(async () => {
    const p = CBZ.player, A = CBZ.surv.arena;
    // walk into the sea until the swimmer takes over
    p.pos.set(A.center.x + A.radius * 1.25, 0, A.center.z);
    for (let i = 0; i < 420; i++) { CBZ.stepSim(1/60); if (i % 60 === 0) await new Promise(r=>setTimeout(r,0)); }
    // the map, the pause screen, the settings panel
    if (CBZ.toggleMap) { try { CBZ.toggleMap(); CBZ.toggleMap(); } catch (e) {} }
    // die, and watch the death play out
    p.hp = 1;
    if (CBZ.survKill) { try { CBZ.survKill(p, 'crushed by the disaster'); } catch (e) {} }
    else if (CBZ.surv && CBZ.surv.damage) { try { CBZ.surv.damage(CBZ.surv.playerActor || p, 999, 'crushed'); } catch (e) {} }
    for (let i = 0; i < 600; i++) { CBZ.stepSim(1/60); if (i % 60 === 0) await new Promise(r=>setTimeout(r,0)); }
    return true;
  })()`, true);

  const raw = await rig.evl("(() => { const s = window.__slice(); return { owner: s.owner, read: Object.keys(s.read), passes: s.passes }; })()");

  // ---- the verdict --------------------------------------------------------
  const html = readFileSync(path.join(ROOT, "index.html"), "utf8");
  const ORDER = [...html.matchAll(/<script(?: defer)? src="([^"]+)"/g)].map((m) => m[1].split("?")[0]);
  const key = (p) => p.replace(/^src\//, "");

  const readSet = new Set(raw.read);
  const usedFiles = new Set();
  for (const sym of raw.read) { const f = raw.owner[sym]; if (f) usedFiles.add(f); }
  const ranFiles = new Set(raw.passes.filter((p) => p.file && p.ran > 0).map((p) => p.file));
  for (const f of ranFiles) usedFiles.add(f);

  out.stats = {
    scripts: ORDER.length,
    symbolsPublished: Object.keys(raw.owner).length,
    symbolsRead: readSet.size,
    filesPublishingSomethingRead: usedFiles.size,
    passesRegistered: raw.passes.length,
    passesThatRan: raw.passes.filter((p) => p.ran > 0).length,
  };
  for (const p of ORDER) {
    const k = key(p);
    (usedFiles.has(k) ? out.used : out.unused).push(p);
  }
  out.owner = raw.owner;
  out.ranPasses = [...ranFiles].sort();
  writeFileSync(OUT, JSON.stringify(out, null, 1));
  console.error(`[slice] ${out.used.length} used · ${out.unused.length} unused → ${path.relative(ROOT, OUT)}`);
  if (has("--print")) {
    console.log("USED (" + out.used.length + "):"); for (const f of out.used) console.log("  " + f);
    console.log("UNUSED (" + out.unused.length + "):"); for (const f of out.unused) console.log("  " + f);
  }
  if (rig.errors.length) console.error("[slice] page errors: " + rig.errors.length + " (first: " + rig.errors[0] + ")");
} finally {
  await rig.close();
}
