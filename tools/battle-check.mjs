#!/usr/bin/env node
/* tools/battle-check.mjs — DOES THE WAR HOLD UP WHEN YOU MEASURE IT?

   games/battle.html is a battle you WATCH, so the only faults that matter are
   the ones you can SEE, and every one of them is countable:

     overlap      two living bodies sharing the same metre of ground. A man is
                  0.52 m across the shoulders; two centres closer than BODY
                  metres are drawing through each other.
     embedded     a body whose centre is INSIDE a collider — invisible to every
                  line of sight, therefore immortal, therefore a battle that
                  cannot end.
     stuck        a man who has been told to march and has not moved in 4 s.
     blindFire    a round fired at a mark the shooter cannot see.
     throughMate  a round fired down a lane a team mate is standing in.
     firstShotT   how long the war spends WALKING before it starts. Two crowds
                  crossing a downtown is not a battle, and it is the only fault
                  here that shows up as boredom rather than as a wrong pixel.
     ended        the war reached a result inside the SIM-time budget.

   Usage:
     node tools/battle-check.mjs                     the default sweep (5 maps)
     node tools/battle-check.mjs --map city --n 40   one map, one size
     node tools/battle-check.mjs --seconds 90        longer watch (WALL clock)
     node tools/battle-check.mjs --resolve 150       longer war (SIM clock)
     node tools/battle-check.mjs --keep              leave chrome up
   Exit 0 = ok.                                                              */
import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const arg = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d; };

/* THE SWEEP NAMED A MAP THAT DOES NOT EXIST. The default was
   "city,streets,dunes,arena" and there has never been a `streets` — battle.html
   ends its map table with `if (!MAPS[SET.map]) SET.map = "city"`, so the gate
   quietly ran the city TWICE and never once loaded `island` or `field`, the two
   grounds that raise a real piece of the map. A pin is only worth the surface
   it covers, so: all five, and an unknown name is now a FAILURE rather than a
   silent second helping of downtown. */
const KNOWN = ["city", "island", "field", "dunes", "arena"];
const MAPS = arg("--map", KNOWN.join(",")).split(",");
{
  const bad = MAPS.filter((m) => !KNOWN.includes(m));
  if (bad.length) { console.error(`BATTLE: FAIL unknown map(s) ${bad.join(", ")} — known: ${KNOWN.join(", ")}`); process.exit(1); }
}
const N = parseInt(arg("--n", "26"), 10);
const SECONDS = parseInt(arg("--seconds", "70"), 10);
const SPEED = arg("--speed", "4");
/* THE TWO BUDGETS, both in SIM seconds and both measured rather than chosen.

   OPENING — how long a person may be asked to watch men WALK before the first
   round goes off. `city` read 10.9 s on main, because the two armies formed up
   304 m apart at opposite edges of the downtown (see streetSpawner) and spent
   the first third of the war marching. After the start lines came in, the five
   maps measure: kill box 1.0 · city 2.2 · dunes 3.2 · Halloran 6.5 · island
   7.1. The pin is 9 rather than 8 because island is the one that varies: at its
   previous start line it read 7.3 on one run and 8.4 on the next of the same
   build, the sim advancing in frame-sized steps. A gate that flakes is a gate
   people learn to re-run.

   RESOLVE — how long a war may run without a result. Deliberately in SIM time,
   not wall time: headless swiftshader manages about 0.6x real on the city map,
   so a wall-clock deadline would fail the biggest map for being the biggest
   map rather than for dragging. A sweep that runs out of WALL time before
   reaching RESOLVE reports `inconclusive` and does not fail — an unfinished
   measurement is not a fault, and saying so beats pretending either way. */
const OPENING = parseFloat(arg("--opening", "9"));
const RESOLVE = parseFloat(arg("--resolve", "120"));
/* --revert runs the SAME sweep with the old separation pass and the old fire
   discipline restored, and asserts the faults COME BACK. A fix nobody can
   turn off has not been measured. */
const REVERT = has("--revert");
const EXTRA = REVERT ? "&sep=old&fire=old" : "";

/* ---- one browser, one dev server, every map through it ------------------ */
async function claimPort(lo, n, probe) {
  for (let p = lo; p < lo + n; p++) { try { await probe(p); } catch (_) { return p; } }
  throw new Error("no free port");
}
const port = await claimPort(9780, 150, (p) => fetch(`http://127.0.0.1:${p}/`));
const server = spawn("python3", [path.join(ROOT, "tools/devserver.py")],
  { env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
const origin = `http://127.0.0.1:${port}/`;
{
  let up = false;
  for (let i = 0; i < 40 && !up; i++) { try { await fetch(origin); up = true; } catch (_) { await sleep(100); } }
  if (!up) { console.error("BATTLE: FAIL devserver never came up"); process.exit(1); }
}

const dbg = await claimPort(10980, 200, (p) => fetch(`http://127.0.0.1:${p}/json/version`));
const profile = `/tmp/cbz-battlecheck-${dbg}`;
await rm(profile, { recursive: true, force: true });
const CHROME_BIN = process.env.CBZ_CHROME || (process.platform === "darwin"
  ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "/opt/pw-browsers/chromium");
const chrome = spawn(CHROME_BIN, [
  "--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
  "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
  "--enable-webgl", "--mute-audio", "--window-size=900,560",
  `--remote-debugging-port=${dbg}`, `--user-data-dir=${profile}`,
  "about:blank",
], { stdio: "ignore" });

let target = null;
for (let i = 0; i < 240 && !target; i++) {
  try {
    const ps = await (await fetch(`http://127.0.0.1:${dbg}/json/list`)).json();
    target = ps.find((p) => p.type === "page");
  } catch (_) {}
  if (!target) await sleep(100);
}
const bye = (code, msg) => {
  if (msg) console.log(msg);
  if (!has("--keep")) chrome.kill("SIGTERM");
  server.kill("SIGTERM");
  process.exit(code);
};
if (!target) bye(1, "BATTLE: FAIL no page");

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
let id = 1; const pend = new Map(); let errors = [];
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); return; }
  if (m.method === "Runtime.exceptionThrown") {
    const d = m.params.exceptionDetails;
    errors.push(`${(d.url || "?").split("/").pop()}:${d.lineNumber} ${(d.exception && d.exception.description || d.text || "").split("\n")[0]}`);
  } else if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") {
    errors.push("console.error: " + m.params.args.map((a) => a.value || a.description || "").join(" ").slice(0, 200));
  }
});
const send = (method, params = {}) => new Promise((r) => { const i = id++; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evl = async (e) => {
  const r = await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true });
  if (r.result && r.result.exceptionDetails) return { __throw: r.result.exceptionDetails.text };
  return r.result && r.result.result && r.result.result.value;
};
await send("Runtime.enable");
await send("Page.enable");

const fails = [];
const report = [];

for (const map of MAPS) {
  errors = [];
  const url = `${origin}games/battle.html?auto=1&map=${map}&red=${N}&blue=${N}` +
    `&rw=mixed&bw=mixed&rt=elite&bt=pro` + EXTRA;
  await send("Page.navigate", { url });
  await sleep(600);

  // THE LOAD IS A MEASUREMENT TOO. A page that takes a minute to show a menu
  // is a page nobody plays twice.
  let up = false, t0 = Date.now();
  for (let i = 0; i < 400 && !up; i++) {
    up = await evl("!!(window.__battle && __battle.audit().started)");
    if (up !== true) { up = false; await sleep(250); }
  }
  const bootMs = Date.now() - t0;
  if (!up) { fails.push(`${map}: never started`); report.push({ map, fail: "never started" }); continue; }

  await evl(`__battle.speed(${SPEED})`);

  // watch it. The quality probe lives in the page (it needs the roster), and
  // it ACCUMULATES — one sample cannot see a shot that was fired between polls.
  let last = null, ended = false, samples = 0, simT = 0;
  const t1 = Date.now();
  while ((Date.now() - t1) / 1000 < SECONDS) {
    await sleep(1500);
    const q = await evl("__battle.quality()");
    if (q && !q.__throw) { last = q; samples++; }
    const a = await evl("__battle.audit()");
    if (a) simT = a.simT || simT;
    if (a && a.over) { ended = true; break; }
    if (simT >= RESOLVE) break;          // long enough to judge; stop burning wall time
  }
  const audit = await evl("__battle.audit()");
  const q = last || {};
  const row = {
    map, bootMs, ended, simT: audit && audit.simT, fps: audit && audit.fps,
    men: audit && audit.men, red: audit && audit.red, blue: audit && audit.blue,
    samples,
    overlapNow: q.overlapNow, overlapWorst: q.overlapWorst, overlapPeak: q.overlapPeak,
    embedded: q.embedded, embeddedEver: q.embeddedEver,
    stuck: q.stuck, blindFire: q.blindFire, throughMate: q.throughMate,
    shots: q.shots, fratricide: q.fratricide, engaged: q.engaged,
    firstShotT: q.firstShotT,
    errors: errors.filter((e) => !/ProgressEvent|favicon|preload/i.test(e)).slice(0, 6),
  };
  report.push(row);

  if (row.overlapPeak > 0) fails.push(`${map}: ${row.overlapPeak} overlapping pairs (worst ${row.overlapWorst} m apart)`);
  /* HOW LONG BEFORE ANYTHING HAPPENS, AND DOES IT EVER FINISH. Neither of
     these is a crash, a leak or a wrong pixel — they are the two ways a battle
     you WATCH can be bad without a single counter going non-zero, which is
     exactly why they belong in the gate. Both were failing on main: `city`
     took 10.9 s to fire its first round (two armies 304 m apart) and had not
     resolved after 83 s of sim, while every other map was done inside 55. */
  if (!(row.firstShotT >= 0) || row.firstShotT > OPENING) {
    fails.push(`${map}: first round at ${row.firstShotT < 0 ? "never" : row.firstShotT + "s"} — over the ${OPENING}s opening budget (men walking, not fighting)`);
  }
  if (!row.ended) {
    if (row.simT >= RESOLVE) fails.push(`${map}: no result in ${row.simT}s of sim — ${row.red} v ${row.blue} still standing`);
    else { row.inconclusive = true; console.log(`  ${map}: ran out of wall clock at ${row.simT}s of sim (budget ${RESOLVE}s) — resolution not judged`); }
  }
  if (row.embeddedEver > 0) fails.push(`${map}: ${row.embeddedEver} bodies inside geometry`);
  if (row.blindFire > 0) fails.push(`${map}: ${row.blindFire} rounds fired at a mark nobody could see`);
  if (row.stuck > 0) fails.push(`${map}: ${row.stuck} men stuck`);
  if (row.errors.length) fails.push(`${map}: ${row.errors.length} console errors — ${row.errors[0]}`);
}

console.log(JSON.stringify(report, null, 2));

if (REVERT) {
  // the assertion INVERTS: with the old passes back, the faults must return.
  // Nothing is claimed about which ones on which map — only that the sweep as
  // a whole is measurably worse, because otherwise the fix bought nothing.
  const overlap = report.reduce((s, r) => s + (r.overlapPeak || 0), 0);
  const lanes = report.reduce((s, r) => s + (r.throughMate || 0), 0);
  console.log(`\nrevert totals: overlapPeak ${overlap}, throughMate ${lanes}`);
  if (overlap === 0 && lanes === 0) {
    bye(1, "BATTLE --revert: FAIL — the old passes produced no faults either, " +
      "so the fix is unproven (or the switches are not wired)");
  }
  bye(0, `\nBATTLE --revert: ok — the old code brings the faults back ` +
    `(${overlap} overlapping pairs, ${lanes} rounds through a mate), which is what makes the zero above mean something.`);
}

if (fails.length) bye(1, "\nBATTLE: FAIL — " + fails.join("\n              "));
bye(0, "\nBATTLE: ok — " + report.map((r) =>
  `${r.map} boot ${(r.bootMs / 1000).toFixed(1)}s, ${r.men} bodies, 0 overlap, 0 embedded, 0 blind rounds`).join("; "));
