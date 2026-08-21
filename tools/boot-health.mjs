#!/usr/bin/env node
/* ============================================================
   tools/boot-health.mjs — DOES THE GAME STILL BOOT? IN 30 SECONDS.

   WHY THIS EXISTS. Several agents working the same checkout in one afternoon
   all reported the same alarming thing: the visual harness had started dying
   on `Runtime.evaluate timed out`, and so had tools/boot-meter-check.mjs,
   which nobody had touched. The obvious reading is that one of the day's
   commits broke the boot. The actual answer was that the box was running
   forty-eight headless Chromes at load average seventeen, and a 25 km world
   cannot finish a synchronous build inside a CDP window on a machine like
   that. Two very different diagnoses, and every tool available took long
   enough to answer that the question stayed open for an hour.

   That is the gap. boot-meter-check.mjs is an excellent instrument for what
   it measures — whether the loading bar tells the truth — but it films a
   screencast, replays a checkpoint tape and prints nothing at all until it
   finishes, so a hang there tells you only that something hung. There was no
   cheap way to ask the one question that actually blocks everything:

       does the script chain load clean, and does the world build finish?

   This asks exactly that and nothing else. It prints as it goes, so a hang is
   attributable to a phase rather than to the tool, and it separates the two
   failure modes that get confused:

     · SCRIPT-CHAIN failure — a file throws while loading, so nothing
       downstream of it exists. Reported before PLAY is ever pressed, with the
       exception text, because this is nearly always the real regression.
     · BUILD failure — the chain is fine and the world build never completes.
       On a contended box that is the machine; on a quiet one it is a bug.

   It also carries the GL flags that actually work headless here
   (--enable-unsafe-swiftshader with ANGLE), which is worth writing down: the
   obvious --use-gl=swiftshader alone fails WebGL context creation on this
   Chromium, and the resulting cascade of null-renderer errors looks exactly
   like a broken engine.

     node tools/boot-health.mjs
     node tools/boot-health.mjs --page games/battle.html
     node tools/boot-health.mjs --page games/x.html --entry "#launch"
     node tools/boot-health.mjs --wait 180     # slower box, longer build budget

   Exit codes are meant for CI and agents: 0 boots, 1 the script chain is
   broken, 2 the build never finished. Run it before you go hunting for a
   regression that may not be there.
============================================================ */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d; };
const PAGE = opt("--page", "index.html");
/* WHICH CONTROL STARTS THIS PAGE. index.html boots through core/microboot.js
   behind #playBtn, but the games/ pages each have their own front door —
   battle.html's is #start ("START THE WAR"). Hard-coding #playBtn made this
   tool report a healthy page as a broken script chain, which is the one thing
   a health check must never do: a false FAIL sends someone hunting a bug that
   is in the checker. Default covers the common pages; --entry names anything
   else. */
const ENTRY = opt("--entry", "#playBtn, #start, #play, [data-boot-entry]");
const WAIT = Math.max(20, Number(opt("--wait", 120)) || 120);
const PORT = Number(opt("--port", 9788));
const DBG = PORT + 1;

const log = (s) => process.stdout.write(s + "\n");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = spawn("python3", [path.join(ROOT, "tools/devserver.py")],
  { env: { ...process.env, PORT: String(PORT) }, stdio: "ignore" });

/* The flags that make WebGL work in this headless Chromium. --use-gl=swiftshader
   on its own does NOT: context creation fails and every downstream null-renderer
   error reads like a broken engine. ANGLE-over-SwiftShader plus the explicit
   unsafe opt-in is the combination that renders. */
const CHROME = process.env.CBZ_CHROME ||
  (process.platform === "darwin"
    ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    : "/opt/pw-browsers/chromium");
const chrome = spawn(CHROME, [
  "--headless=new", `--remote-debugging-port=${DBG}`, "--no-sandbox",
  "--disable-dev-shm-usage", "--enable-webgl", "--enable-unsafe-swiftshader",
  "--use-gl=angle", "--use-angle=swiftshader", "--mute-audio",
  "--no-first-run", "--no-default-browser-check", "--hide-scrollbars",
  "--disable-background-timer-throttling", "--disable-renderer-backgrounding",
  "--window-size=1000,640", `--user-data-dir=/tmp/cbz-boot-health-${PORT}`, "about:blank",
], { stdio: "ignore" });

function finish(code, msg) {
  log(msg);
  try { chrome.kill("SIGKILL"); } catch (_) {}
  try { server.kill("SIGTERM"); } catch (_) {}
  process.exit(code);
}

let wsUrl = null;
for (let i = 0; i < 40; i++) {
  await sleep(500);
  try {
    const tabs = await (await fetch(`http://127.0.0.1:${DBG}/json/list`)).json();
    const t = tabs.find((x) => x.webSocketDebuggerUrl);
    if (t) { wsUrl = t.webSocketDebuggerUrl; break; }
  } catch (_) {}
}
if (!wsUrl) finish(1, "FAIL: no CDP target (chromium never came up)");

const sock = new WebSocket(wsUrl);
let msgId = 0;
const pending = new Map();
const errors = [];
sock.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === "Runtime.exceptionThrown") {
    const d = m.params.exceptionDetails;
    errors.push((d.exception && (d.exception.description || d.exception.value)) || d.text);
  } else if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") {
    errors.push(m.params.args.map((a) => a.value || a.description || "").join(" "));
  }
});
const send = (method, params) => new Promise((res, rej) => {
  const id = ++msgId;
  pending.set(id, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)));
  sock.send(JSON.stringify({ id, method, params: params || {} }));
  setTimeout(() => { if (pending.delete(id)) rej(new Error(`CDP timeout: ${method}`)); }, 60000);
});
const ev = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true });
  return r.result && r.result.value;
};
const dump = (label) => {
  log(`  ${label} (${errors.length}):`);
  for (const e of errors.slice(0, 15)) log("     " + String(e).split("\n")[0].slice(0, 190));
};

await new Promise((r) => sock.addEventListener("open", r));
await send("Runtime.enable");
await send("Page.enable");

log(`boot-health → http://127.0.0.1:${PORT}/${PAGE}`);
await send("Page.navigate", { url: `http://127.0.0.1:${PORT}/${PAGE}` });
await sleep(9000);

/* PHASE 1 — the script chain. index.html boots through core/microboot.js, so
   most of the engine is injected on PLAY rather than present in the markup;
   the honest pre-PLAY test is therefore "is the entry point there and did
   nothing throw", not a count of <script> tags. */
const entrySel = JSON.stringify(ENTRY);
const entry = await ev(`!!document.querySelector(${entrySel})`);
const entryWhich = entry ? await ev(`(function(){var e=document.querySelector(${entrySel});return e.id||e.tagName.toLowerCase();})()`) : null;
log(`  entry point: ${entry ? "present (" + entryWhich + ")" : "MISSING — try --entry '<css selector>'"}`);
dump("script-chain errors");
if (!entry || errors.some((e) => /SyntaxError|is not defined|Unexpected token/i.test(String(e)))) {
  finish(1, "FAIL: script chain is broken — fix this before looking anywhere else");
}

/* PHASE 2 — the world build. One synchronous 20-30 s task; nothing repaints
   during it, which is why this polls rather than awaits. */
errors.length = 0;
log(`  pressing PLAY (build budget ${WAIT}s)…`);
const t0 = Date.now();
await ev(`document.querySelector(${entrySel}).click()`);
let booted = false;
for (let i = 0; i < Math.ceil(WAIT / 2); i++) {
  await sleep(2000);
  try {
    if (await ev("!!(window.CBZ && (CBZ.bootComplete || (CBZ.game && CBZ.game.state === 'playing')))")) { booted = true; break; }
  } catch (_) { /* the main thread is frozen mid-build; that is expected */ }
}
const secs = ((Date.now() - t0) / 1000).toFixed(1);
log(`  world build: ${booted ? "COMPLETE" : "DID NOT FINISH"} in ${secs}s`);

if (booted) {
  const species = await ev("window.CBZ && CBZ.WILDLIFE_SPECIES ? Object.keys(CBZ.WILDLIFE_SPECIES).length : -1");
  const water = await ev("window.CBZ && CBZ.WILDLIFE_SPECIES ? Object.keys(CBZ.WILDLIFE_SPECIES).filter(k=>CBZ.WILDLIFE_SPECIES[k].biome==='water').length : -1");
  log(`  species registered: ${species} (water: ${water})`);
}
dump("post-PLAY errors");
if (!booted) {
  finish(2, "FAIL: the world build never finished.\n" +
    "  Before blaming a commit, check the machine: this is what a contended box\n" +
    "  looks like too. `uptime` and a count of running chrome processes decide it.");
}
finish(errors.length ? 0 : 0, errors.length ? "BOOT OK (with console errors above)" : "BOOT OK — clean");
