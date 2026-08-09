#!/usr/bin/env node
/* tools/sound-census.mjs — WHICH SOUND IS REPEATING, AND WHO ASKED FOR IT.

   The owner's report was "the prison game spams one very annoying sound", and
   that is not a bug you can find by reading 264k lines: `punch` alone has 21
   call sites. So measure it. This boots the real page headless straight into a
   run, lets the world play with the PLAYER DOING NOTHING, and counts every
   sound request the engine makes. Idle is the whole trick — with no input,
   every sound that happens is somebody else's, so anything repeating is by
   definition the world talking over the game.

   THREE FEEDS, because they answer different questions:

     CENSUS     CBZ.soundAudit() — always-on counters inside systems/audio.js.
                Per cue: req / global (no dist = no place in the world) /
                spatial / world (through CBZ.worldSfx) / gated / sent.
                THIS IS THE AUTHORITY: it counts what the engine decided,
                independent of whether the file could be decoded.
     CALLER     CBZ.soundDebug.history() — the F8 sound-review feed, which
                already records cue + chosen asset + ORIGINAL CALLER. This is
                what turns a cue name into a file:line.
     REQUESTED  a wrapper over CBZ.sfx/sfxAt/worldSfx, which also catches the
                caller of requests the cooldown throws away — a call site with
                900 requests and 60 plays is spamming blind, and the cooldown
                is the only thing between it and the ear.

   HEADLESS CODEC FACT (verification.md's "headless facts"): the bank is .m4a
   (AAC) and Playwright's Chromium is the OSS build with no proprietary codecs,
   so decodeAudioData fails and NOTHING actually plays. The CALLER feed reports
   at playback start, so it stays near-empty headless — that is a property of
   the browser, not of the game. The CENSUS feed is measured before the decoder
   is ever involved, which is why the ratchet is pinned on it.

   Usage:
     node tools/sound-census.mjs                          # 45 s idle in escape
     node tools/sound-census.mjs --mode city --seconds 60
     node tools/sound-census.mjs --gate                   # pass/fail, for CI
     node tools/sound-census.mjs --walk                   # hold W while measuring
     node tools/sound-census.mjs --json out.json

   THE GATE (--gate), the ratchet this wave earned:
     1. NO CUE IS SENT MORE THAN `--cap` TIMES PER MINUTE WHILE IDLE (default
        20 = one every three seconds). A sound the player cannot tell apart
        from the last one is not information.
     2. ZERO GLOBAL SENDS WHILE IDLE. A sound the player did not cause must
        carry a distance; global belongs to what YOU do and what happens TO you.

   Boot boilerplate copied from tools/prison-polish-check.mjs (math-gate's),
   including the macOS Chrome fallback. */
import { spawn } from "node:child_process";
import { rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const argv = process.argv.slice(2);
const has = (name) => argv.includes("--" + name);
function arg(name, dflt) {
  const i = argv.indexOf("--" + name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
}
const MODE = arg("mode", "escape");
const SECONDS = Math.max(5, +arg("seconds", 45) || 45);
const CAP = +arg("cap", 20) || 20;
const GATE = has("gate");
const WALK = has("walk");
const JSON_OUT = arg("json", "");

const port = 8830 + Math.floor(Math.random() * 40);
const server = spawn("python3", [path.join(ROOT, "tools/devserver.py")], { env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
const base = `http://127.0.0.1:${port}/`;
const dbg = 9830 + Math.floor(Math.random() * 40);
const profile = `/tmp/cbz-sound-census-${dbg}`;
await rm(profile, { recursive: true, force: true });
await sleep(700);
const CHROME_BIN = process.env.CBZ_CHROME || (process.platform === "darwin"
  ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  : "/opt/pw-browsers/chromium");
const chrome = spawn(CHROME_BIN, [
  "--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
  "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
  "--enable-webgl", "--mute-audio", "--autoplay-policy=no-user-gesture-required",
  "--window-size=1280,720",
  `--remote-debugging-port=${dbg}`, `--user-data-dir=${profile}`, `${base}?soundDebug=1`,
], { stdio: "ignore" });

function done(code) {
  try { chrome.kill("SIGTERM"); } catch (_) {}
  try { server.kill("SIGTERM"); } catch (_) {}
  rm(profile, { recursive: true, force: true }).catch(() => {});
  process.exit(code);
}

let page = null;
for (let i = 0; i < 80 && !page; i++) {
  try { const ps = await (await fetch(`http://127.0.0.1:${dbg}/json/list`)).json(); page = ps.find((p) => p.type === "page" && p.url.startsWith(base)); } catch (_) {}
  if (!page) await sleep(250);
}
if (!page) { console.error("FAIL: no page"); done(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
let id = 1; const pending = new Map(); const errors = [];
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === "Runtime.exceptionThrown") { const d = m.params.exceptionDetails; errors.push(`${d.url || "?"}:${d.lineNumber} ${(d.exception && d.exception.description || d.text || "").split("\n")[0]}`); }
});
const send = (method, params = {}) => new Promise((r) => { const i = id++; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evl = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: `(function(){${expr}})()`, returnByValue: true, awaitPromise: true });
  if (r.result && r.result.exceptionDetails) return { __err: r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description };
  return r.result && r.result.result && r.result.result.value;
};
await send("Runtime.enable"); await send("Page.enable");

for (let i = 0; i < 90; i++) { if (await evl("return !!(window.CBZ && CBZ.bootComplete && CBZ.game)")) break; await sleep(500); }
let playing = false;
for (let i = 0; i < 40 && !playing; i++) {
  await evl(`try{CBZ.setMode(${JSON.stringify(MODE)}); CBZ.startRun && CBZ.startRun();}catch(e){return String(e);} return true;`);
  await sleep(500);
  playing = await evl(`return !!(CBZ.game && CBZ.game.state==='playing' && CBZ.game.mode===${JSON.stringify(MODE)});`);
}
if (!playing) { console.error(`FAIL: could not reach mode ${MODE}`); console.error(errors.slice(0, 6)); done(2); }

// Audio needs a context; headless Chrome is launched with autoplay allowed.
await evl("try{CBZ.initAudio();}catch(e){} return 1;");
for (let i = 0; i < 40; i++) {
  const st = await evl("var c=CBZ.getAudioCtx&&CBZ.getAudioCtx(); return c?c.state:null;");
  if (st === "running") break;
  await evl("var c=CBZ.getAudioCtx&&CBZ.getAudioCtx(); if(c&&c.resume)c.resume(); return 1;");
  await sleep(250);
}
const ctxState = await evl("var c=CBZ.getAudioCtx&&CBZ.getAudioCtx(); return c?c.state:'none';");
if (!(await evl("return !!CBZ.soundAudit;"))) { console.error("FAIL: CBZ.soundAudit missing (systems/audio.js too old)"); done(3); }

// REQUESTED feed: wrap the public request surface so cooldown-swallowed calls
// keep their caller. It reads the stack the way audio.js's debugger does, so
// both tables key on the same file:line.
await evl(`
  if (!window.__sndCensus) {
    window.__sndCensus = { req: {}, unmapped: {} };
    var pick = function () {
      try {
        var lines = String(new Error().stack || "").split("\\n");
        for (var i = 1; i < lines.length; i++) {
          if (/systems\\/audio\\.js|<anonymous>/.test(lines[i])) continue;
          var hit = lines[i].match(/((?:src|tools|games)\\/[^)\\s]+:\\d+):\\d+/);
          if (hit) return hit[1].replace(/\\?[^:]+(?=:\\d+$)/, "");
        }
      } catch (e) {}
      return "";
    };
    var note = function (name, how) {
      var k = String(name) + " [" + how + "] @ " + pick();
      window.__sndCensus.req[k] = (window.__sndCensus.req[k] || 0) + 1;
    };
    var sfx0 = CBZ.sfx, at0 = CBZ.sfxAt, world0 = CBZ.worldSfx, loop0 = CBZ.setAudioLoop;
    CBZ.sfx = function (n, o) { note(n, (o && o.dist != null) ? "sfx+dist" : "GLOBAL"); return sfx0.apply(this, arguments); };
    CBZ.sfxAt = function (n) { note(n, "sfxAt"); return at0.apply(this, arguments); };
    if (world0) CBZ.worldSfx = function (n) { note(n, "worldSfx"); return world0.apply(this, arguments); };
    if (loop0) CBZ.setAudioLoop = function (n, k) { note("loop:" + k, "loop"); return loop0.apply(this, arguments); };
    var warn0 = console.warn;
    console.warn = function () {
      try {
        if (String(arguments[0]).indexOf("[audio] unmapped") === 0) {
          var k = String(arguments[1]) + " @ " + pick();
          window.__sndCensus.unmapped[k] = (window.__sndCensus.unmapped[k] || 0) + 1;
        }
      } catch (e) {}
      return warn0.apply(console, arguments);
    };
  }
  return 1;
`);
// The wrappers above call through, so the engine census counts everything once.
// Zero it here: boot noise is not gameplay, and the window starts NOW.
await evl("CBZ.soundAuditReset(); return 1;");

// --at x,z: stand somewhere specific. The escape spawn is inside the cell
// block, and "I heard nothing from in here" is a different measurement from
// "I heard nothing standing in the middle of the yard" — the second is the one
// that proves world foley still reaches the player at all.
const AT = arg("at", "");
if (AT) {
  const [ax, az] = AT.split(",").map(Number);
  await evl(`CBZ.player.pos.x=${+ax}; CBZ.player.pos.z=${+az}; return 1;`);
  await evl("CBZ.soundAuditReset(); return 1;");
}
if (WALK) {
  const key = { key: "w", code: "KeyW", windowsVirtualKeyCode: 87, nativeVirtualKeyCode: 87 };
  await send("Input.dispatchKeyEvent", { type: "keyDown", ...key });
}

// CALLER feed: soundDebugHistory is a 200-row ring, so drain it on a short poll
// and merge on the monotonic timestamp — a spam run overflows the ring in
// seconds, which is exactly the case this tool exists for.
const playedCaller = new Map();
const detailByKey = new Map();
// WHY the cue repeats, sampled beside it. A sound that fires 90 times a minute
// is usually not an audio bug on its own — it is the audible symptom of a world
// that is doing that thing 90 times a minute. Counting the sound without
// counting its cause gets you a quieter bug.
const stateSamples = [];
let lastAt = -1;
process.stdout.write(`sound census: mode=${MODE} seconds=${SECONDS} idle=${WALK ? "no (walking)" : "yes"} audioCtx=${ctxState}\n`);
const t0 = Date.now();
while (Date.now() - t0 < SECONDS * 1000) {
  const rows = await evl("return JSON.stringify(CBZ.soundDebug.history());");
  let list = [];
  try { list = JSON.parse(rows || "[]"); } catch (_) {}
  for (const r of list) {
    if (!(r.at > lastAt)) continue;
    lastAt = r.at;
    const key = `${r.name} @ ${r.caller || "?"}`;
    playedCaller.set(key, (playedCaller.get(key) || 0) + 1);
    if (!detailByKey.has(key)) detailByKey.set(key, r.detail);
  }
  const st = await evl(`
    const list = (CBZ.npcs || []).concat(CBZ.guards || []);
    const by = {}; let alive = 0;
    for (const n of list) {
      if (!n || n.dead || n.escaped) continue;
      alive++;
      const s = n.aiState || "?";
      by[s] = (by[s] || 0) + 1;
    }
    return JSON.stringify({ alive: alive, by: by });
  `);
  try { stateSamples.push(JSON.parse(st)); } catch (_) {}
  await sleep(200);
}
const census = JSON.parse((await evl("return JSON.stringify(CBZ.soundAudit());")) || "{}");
const status = JSON.parse((await evl("return JSON.stringify(CBZ.audioStatus());")) || "{}");
const reqTable = JSON.parse((await evl("return JSON.stringify(window.__sndCensus.req);")) || "{}");
const unmappedTable = JSON.parse((await evl("return JSON.stringify(window.__sndCensus.unmapped);")) || "{}");
const elapsed = census.seconds || (Date.now() - t0) / 1000;
const perMin = (n) => (n * 60 / elapsed).toFixed(1);

const cues = Object.entries(census.cues || {}).sort((a, b) => b[1].sent - a[1].sent || b[1].req - a[1].req);
console.log(`\n== CENSUS — ${census.req || 0} requests, ${census.sent || 0} sent in ${elapsed.toFixed(1)}s ==`);
console.log("  sent/min   sent    req  global  world   gated  far  cue");
for (const [cue, r] of cues) {
  console.log(`  ${perMin(r.sent).padStart(8)}  ${String(r.sent).padStart(5)}  ${String(r.req).padStart(5)}  ${String(r.global).padStart(6)}  ${String(r.world).padStart(5)}  ${String(r.gated).padStart(6)}  ${String(r.far).padStart(3)}  ${cue}`);
}
if (!cues.length) console.log("  (silence)");

if (stateSamples.length) {
  const alive = stateSamples.reduce((s, x) => s + x.alive, 0) / stateSamples.length;
  const states = {};
  for (const s of stateSamples) for (const k of Object.keys(s.by)) states[k] = (states[k] || 0) + s.by[k];
  const rows = Object.entries(states).map(([k, v]) => [k, v / stateSamples.length]).sort((a, b) => b[1] - a[1]);
  const fighting = states.fight ? states.fight / stateSamples.length : 0;
  console.log(`\n== THE WORLD MAKING THE SOUND — ${alive.toFixed(0)} actors alive, averaged over ${stateSamples.length} samples ==`);
  console.log("  " + rows.map(([k, v]) => `${k} ${v.toFixed(1)}`).join("   "));
  console.log(`  ${(100 * fighting / Math.max(1, alive)).toFixed(0)}% of the yard is throwing punches at any given moment`);
}
const reqSorted = Object.entries(reqTable).sort((a, b) => b[1] - a[1]);
console.log(`\n== CALL SITES (every request, including the ones the cooldown discarded) ==`);
console.log("  per-min  count  cue [how] @ caller");
for (const [key, n] of reqSorted.slice(0, 20)) console.log(`  ${perMin(n).padStart(7)}  ${String(n).padStart(5)}  ${key}`);
if (!reqSorted.length) console.log("  (no requests)");

const playedSorted = [...playedCaller.entries()].sort((a, b) => b[1] - a[1]);
if (playedSorted.length) {
  console.log(`\n== REACHED PLAYBACK (F8 feed; empty headless is the AAC codec, not the game) ==`);
  for (const [key, n] of playedSorted.slice(0, 12)) {
    console.log(`  ${String(n).padStart(5)}  ${key}\n         ${detailByKey.get(key) || ""}`);
  }
}
const unSorted = Object.entries(unmappedTable).sort((a, b) => b[1] - a[1]);
if (unSorted.length) {
  console.log(`\n== UNMAPPED cue requests (console.warn, no sound at all) ==`);
  for (const [key, n] of unSorted) console.log(`  ${String(n).padStart(5)}  ${key}`);
}
console.log(`\naudio bank: loaded=${status.loaded} failed=${(status.failed || []).length} of ${status.total} files` +
  ((status.failed || []).length ? "  (headless AAC — expected)" : ""));

if (JSON_OUT) {
  await writeFile(path.resolve(ROOT, JSON_OUT), JSON.stringify({
    mode: MODE, seconds: elapsed, idle: !WALK, ctxState, census,
    callSites: reqTable, played: Object.fromEntries(playedCaller), unmapped: unmappedTable,
  }, null, 2));
  console.log(`wrote ${JSON_OUT}`);
}

if (!GATE) done(0);

// ---- the gate ------------------------------------------------------------
// POSITIVE CONTROL FIRST. Silence is trivially achievable by muting the world,
// and a ratchet that only counts sounds would happily ratchet the game to
// nothing. So before asserting quiet, prove CBZ.worldSfx still SPEAKS: a blow
// beside the player must be sent, the same blow across the yard must not, a
// second blow inside the gap must be swallowed, and a CLOSER one must take the
// voice off the far fight. All four are read off the engine's own counters,
// which are stamped before the decoder is involved (see the codec note above).
const control = JSON.parse((await evl(`
  var p = CBZ.player.pos;
  var n = function () { var c = CBZ.soundAudit().cues.punch; return c ? { sent: c.sent, far: c.far, gated: c.gated } : { sent: 0, far: 0, gated: 0 }; };
  var out = {};
  var a = n(); CBZ.worldSfx("punch", p.x + 3, p.z, { y: p.y });   var b = n();
  out.near = b.sent - a.sent;
  CBZ.worldSfx("punch", p.x + 300, p.z, { y: p.y });              var c = n();
  out.farSent = c.sent - b.sent; out.farCounted = c.far - b.far;
  CBZ.worldSfx("punch", p.x + 3.1, p.z, { y: p.y });              var d = n();
  out.repeatSent = d.sent - c.sent; out.repeatGated = d.gated - c.gated;
  CBZ.worldSfx("punch", p.x + 0.5, p.z, { y: p.y });              var e = n();
  out.closerSent = e.sent - d.sent;
  return JSON.stringify(out);
`)) || "{}");
const fails = [];
if (WALK) fails.push("--gate measures an IDLE run; drop --walk");
if (control.near !== 1) fails.push(`CONTROL: a punch 3 m away was not sent (${control.near}) — the world has been muted, not placed`);
if (control.farSent !== 0 || control.farCounted !== 1) fails.push(`CONTROL: a punch 300 m away was still sent (sent+${control.farSent})`);
if (control.repeatSent !== 0 || control.repeatGated !== 1) fails.push(`CONTROL: a second punch inside the ${0.3}s world gap was not swallowed (sent+${control.repeatSent})`);
if (control.closerSent !== 1) fails.push("CONTROL: a nearer punch did not take the voice from the one holding the gap");
for (const [cue, r] of cues) {
  const rate = r.sent * 60 / elapsed;
  if (rate > CAP) fails.push(`REPEAT: "${cue}" sent ${rate.toFixed(1)}/min idle (cap ${CAP})`);
  if (r.sent > 0 && r.global > 0 && r.global > r.gated) {
    fails.push(`GLOBAL: "${cue}" requested ${r.global}x with no distance while the player did nothing`);
  }
}
console.log("");
if (fails.length) {
  for (const f of fails) console.log("FAIL  " + f);
  console.log(`\nsound gate: ${fails.length} failure(s) in mode ${MODE}`);
  done(1);
}
console.log(`  ok  no cue repeats above ${CAP}/min idle`);
console.log(`  ok  every idle sound carries a distance`);
console.log(`\nsound gate: PASS (mode ${MODE}, ${elapsed.toFixed(1)}s idle)`);
done(0);
