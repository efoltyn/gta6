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
     ended        the war reached a result inside the budget.

   Usage:
     node tools/battle-check.mjs                     the default sweep
     node tools/battle-check.mjs --map city --n 40   one map, one size
     node tools/battle-check.mjs --seconds 90        longer watch
     node tools/battle-check.mjs --keep              leave chrome up
     node tools/battle-check.mjs --url https://efoltyn.github.io/gta6/
                                                    check the DEPLOYED site
                                                    rather than this checkout,
                                                    which is the only way to
                                                    know a wave actually shipped
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

/* EVERY MAP THE PAGE OFFERS, OR THE SWEEP IS DECORATION.

   This list used to read "city,streets,dunes,arena". `streets` is not a map
   and never was — the sweep spent a quarter of its run booting a fallback and
   calling it a pass — while island and field, the two venues that were
   actually broken, were never checked at all. A checker whose map list can
   drift from the page's is a checker that certifies the maps nobody plays. */
const MAPS = arg("--map", "city,island,field,gov,harbor,marina,speedway,dunes,arena").split(",");
const N = parseInt(arg("--n", "26"), 10);
const SECONDS = parseInt(arg("--seconds", "70"), 10);
const SPEED = arg("--speed", "4");
/* --revert runs the SAME sweep with the old separation pass, the old fire
   discipline and transparent sand (?tlos=0) restored, and asserts the faults
   COME BACK. A fix nobody can turn off has not been measured. */
const REVERT = has("--revert");
/* --extra appends raw query params to every battle URL, so the sweep can put
   BEAST armies (or any roster the page's menu can) under the same counters:
     node tools/battle-check.mjs --map city --extra "ru=lion&bu=dog"
   URLSearchParams takes the FIRST occurrence, so --n keeps owning the counts. */
const EXTRAQ = arg("--extra", "");
const EXTRA = (REVERT ? "&sep=old&fire=old&tlos=0" : "") + (EXTRAQ ? "&" + EXTRAQ : "");

/* ---- one browser, one origin, every map through it ----------------------
   The origin is normally a devserver on this checkout. --url points the same
   sweep at a real host: "the bytes are on the server" and "the game runs on
   the server" are different claims, and only the second one is a deploy. */
async function claimPort(lo, n, probe) {
  for (let p = lo; p < lo + n; p++) { try { await probe(p); } catch (_) { return p; } }
  throw new Error("no free port");
}
const REMOTE = arg("--url", "");
let server = { kill() {} };
let origin;
if (REMOTE) {
  origin = REMOTE.endsWith("/") ? REMOTE : REMOTE + "/";
  try { await fetch(origin); } catch (e) { console.error("BATTLE: FAIL cannot reach " + origin); process.exit(1); }
} else {
  const port = await claimPort(9780, 150, (p) => fetch(`http://127.0.0.1:${p}/`));
  server = spawn("python3", [path.join(ROOT, "tools/devserver.py")],
    { env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
  origin = `http://127.0.0.1:${port}/`;
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
  let last = null, ended = false, samples = 0;
  const t1 = Date.now();
  while ((Date.now() - t1) / 1000 < SECONDS) {
    await sleep(1500);
    const q = await evl("__battle.quality()");
    if (q && !q.__throw) { last = q; samples++; }
    const a = await evl("__battle.audit()");
    if (a && a.over) { ended = true; break; }
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
    throughSand: q.throughSand,
    shots: q.shots, fratricide: q.fratricide, engaged: q.engaged,
    ground: audit && audit.ground, centre: audit && audit.centre, gap: audit && audit.gap,
    relief: audit && audit.relief, terrainLos: audit && audit.terrainLos,
    errors: errors.filter((e) => !/ProgressEvent|favicon|preload/i.test(e)).slice(0, 6),
  };
  report.push(row);

  /* IS THERE ANY GROUND UNDER THIS BATTLE?

     The fault this exists for makes NO noise: a venue whose builder returns
     early (an under-declared dependency, a site walk that finds no water) is
     raised into an empty group, the men stand on the fallback plane, and every
     other measurement here passes — nobody overlaps, nobody is embedded, and
     the war ends on schedule, on a featureless grey plate. It was found by
     looking at a screenshot, which is not a test.

     The heightfield reports what it measured, so a raised venue can be held to
     it: geometry has to exist, it has to be big enough to fight on, and the
     grid has to mostly HIT something. `miss` is grid points where a ray found
     nothing at all — a venue that misses everywhere did not get built. */
  const G = row.ground;
  if (audit && audit.raises) {
    if (!G) {
      fails.push(`${map}: declares a venue but NOTHING was raised — the men are standing on the fallback plane`);
    } else if (Math.min(G.spanX, G.spanZ) < 40) {
      fails.push(`${map}: venue measured only ${G.spanX}x${G.spanZ} m — it raised almost nothing`);
    }
    /* NOT a miss-fraction assertion. The marina's grid misses 92% of its own
       box and is completely correct to: a basin is mostly water, and a venue
       is not required to be dense. What is NOT allowed is measuring nothing
       at all, which is the failure that has no other symptom. */
  }

  if (row.overlapPeak > 0) fails.push(`${map}: ${row.overlapPeak} overlapping pairs (worst ${row.overlapWorst} m apart)`);
  if (row.embeddedEver > 0) fails.push(`${map}: ${row.embeddedEver} bodies inside geometry`);
  if (row.blindFire > 0) fails.push(`${map}: ${row.blindFire} rounds fired at a mark nobody could see`);
  if (row.throughSand > 0) fails.push(`${map}: ${row.throughSand} rounds fired through the terrain itself`);
  if (row.stuck > 0) fails.push(`${map}: ${row.stuck} men stuck`);
  if (row.errors.length) fails.push(`${map}: ${row.errors.length} console errors — ${row.errors[0]}`);

  /* THE MAP THAT PROMISES DUNES HAS TO MEASURE SOME. The old venue centred
     the war where the dune amplitude ramp had barely started: 7.6 m of
     relief across the whole field — a flat plate with "OPEN DUNES" on the
     menu row, and nothing but a screenshot could catch it. The audit now
     states the fight window's vertical span, so the checker can hold the
     ground to the label. */
  if (map === "dunes" && audit && !(audit.relief >= 12)) {
    fails.push(`dunes: the map promises dunes and measured ${audit.relief} m of relief — that is a flat plate`);
  }
}

console.log(JSON.stringify(report, null, 2));

if (REVERT) {
  // the assertion INVERTS: with the old passes back, the faults must return.
  // Nothing is claimed about which ones on which map — only that the sweep as
  // a whole is measurably worse, because otherwise the fix bought nothing.
  const overlap = report.reduce((s, r) => s + (r.overlapPeak || 0), 0);
  const lanes = report.reduce((s, r) => s + (r.throughMate || 0), 0);
  const sand = report.reduce((s, r) => s + (r.throughSand || 0), 0);
  console.log(`\nrevert totals: overlapPeak ${overlap}, throughMate ${lanes}, throughSand ${sand}`);
  if (overlap === 0 && lanes === 0 && sand === 0) {
    bye(1, "BATTLE --revert: FAIL — the old passes produced no faults either, " +
      "so the fix is unproven (or the switches are not wired)");
  }
  bye(0, `\nBATTLE --revert: ok — the old code brings the faults back ` +
    `(${overlap} overlapping pairs, ${lanes} rounds through a mate, ${sand} through the sand), ` +
    `which is what makes the zero above mean something.`);
}

if (fails.length) bye(1, "\nBATTLE: FAIL — " + fails.join("\n              "));
bye(0, "\nBATTLE: ok — " + report.map((r) =>
  `${r.map} boot ${(r.bootMs / 1000).toFixed(1)}s, ${r.men} bodies, 0 overlap, 0 embedded, 0 blind rounds`).join("; "));
