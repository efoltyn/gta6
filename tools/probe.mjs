#!/usr/bin/env node
/* tools/probe.mjs — THE FAST LOOP. One live world, many queries.

   WHY THIS EXISTS
   ---------------
   The closed loop in CLAUDE.md is right — math over rendered frames — but its
   COST was wrong. Every probe in this repo boots its own Chromium, starts its
   own devserver, and rebuilds the whole world before it can ask one question.
   That is ~15-90 seconds of setup to answer something that takes 3 ms, and
   during one parallel wave of agents this tree paid it dozens of times over.
   Worse, every one of those probes re-typed the SAME ~60 lines of CDP
   boilerplate (claim a port, spawn the server, poll /json/list, open the
   socket, wait for the title, click Play, wait for the arena) — so the boot
   sequence had a dozen slightly-diverging copies and a bug in one was a bug
   nobody else got fixed.

   This is one tool with two modes:

     node tools/probe.mjs --serve [--seed 90210]
         Boot ONCE. Build the world ONCE. Hold it open and write the CDP
         endpoint to a lockfile. Prints READY and stays alive.

     node tools/probe.mjs 'CBZ.roadTrafficAudit()'
         Attach to that live world, evaluate, print JSON, exit. **Milliseconds**,
         not minutes. Falls back to booting its own throwaway world if no
         server is running, so a caller never has to care which mode it is in.

     node tools/probe.mjs --file probe.js       # evaluate a file instead
     node tools/probe.mjs --step 600            # advance the sim N ticks first
     node tools/probe.mjs --isolated '<expr>'    # never attach to a shared run
     node tools/probe.mjs --live-raf '<expr>'    # keep full rendering active
     node tools/probe.mjs --reset               # rebuild the world in place
     node tools/probe.mjs --stop

   THE POINT: a subagent iterating on a change runs the second form. It gets a
   real answer from the REAL game in about the time a unit test would take, and
   it never writes boot code again.

   The world is shared and mutable — `--step` advances it, and a probe that
   mutates state affects the next one. That is a FEATURE for iterating (set up
   a situation, then poke it), and the reason `--reset` exists for when you
   need a clean one. */
import { spawn } from "node:child_process";
import { readFile, writeFile, rm, mkdir } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const LOCK = "/tmp/cbz-probe-world.json";
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const argS = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- CDP client
function client(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 1; const pend = new Map(); const errors = [];
  const ready = new Promise((res, rej) => {
    ws.addEventListener("open", res, { once: true });
    ws.addEventListener("error", rej, { once: true });
  });
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
  const evl = async (expression, awaitPromise) => {
    const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: !!awaitPromise });
    const res = r.result && r.result.result;
    if (r.result && r.result.exceptionDetails) {
      const d = r.result.exceptionDetails;
      throw new Error((d.exception && d.exception.description) || d.text || "eval threw");
    }
    return res && res.value;
  };
  return { ws, ready, send, evl, errors };
}

async function claimPort(lo, span, probeFn) {
  for (let t = 0; t < 12; t++) {
    const p = lo + Math.floor(Math.random() * span);
    try { await probeFn(p); } catch (_) { return p; }
  }
  throw new Error("no free port near " + lo);
}

// ------------------------------------------------------- boot a fresh world
async function boot(seed, quiet) {
  const log = quiet ? () => {} : (m) => console.error("[probe] " + m);
  const port = await claimPort(9200, 400, (p) => fetch(`http://127.0.0.1:${p}/`));
  const server = spawn("python3", [path.join(ROOT, "tools/devserver.py")],
    { env: { ...process.env, PORT: String(port) }, stdio: "ignore", detached: true });
  const origin = `http://127.0.0.1:${port}/`;
  for (let i = 0, up = false; i < 80 && !up; i++) { try { await fetch(origin); up = true; } catch (_) { await sleep(100); } }
  const dbg = await claimPort(12000, 400, (p) => fetch(`http://127.0.0.1:${p}/json/version`));
  // A dying chrome from an earlier run can still be flushing this dir; if the
  // stale profile won't delete (ENOTEMPTY race), mint a fresh path instead of
  // crashing the boot.
  let profile = `/tmp/cbz-probe-${dbg}`;
  try { await rm(profile, { recursive: true, force: true }); }
  catch (_) { profile = `/tmp/cbz-probe-${dbg}-${process.pid}`; await rm(profile, { recursive: true, force: true }).catch(() => {}); }
  const CHROME = process.env.CBZ_CHROME || (process.platform === "darwin"
    ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    : "/opt/pw-browsers/chromium");
  // CBZ_URL_EXTRA appends raw query params ("cfg_FLAG=0&cfg_OTHER=1") — the
  // only way to A/B one-shot build passes (batch/instancing) that read CONFIG
  // before boot; live toggling can't reach those.
  const extra = process.env.CBZ_URL_EXTRA ? `&${process.env.CBZ_URL_EXTRA.replace(/^[?&]/, "")}` : "";
  const target = `${origin}?seed=${seed}${extra}`;
  const chrome = spawn(CHROME, ["--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
    "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--enable-webgl",
    "--mute-audio", "--window-size=480,300", `--remote-debugging-port=${dbg}`,
    `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore", detached: true });

  let page = null;
  for (let i = 0; i < 300 && !page; i++) {
    try { const ps = await (await fetch(`http://127.0.0.1:${dbg}/json/list`)).json(); page = ps.find((p) => p.type === "page"); } catch (_) {}
    if (!page) await sleep(100);
  }
  if (!page) throw new Error("chromium never opened the page");
  const c = client(page.webSocketDebuggerUrl);
  await c.ready;
  await c.send("Runtime.enable"); await c.send("Page.enable");
  // Install the headless frame budget BEFORE any game script can capture rAF.
  // Six hundred title/world frames leave ample room for startup and one
  // settled view, but prevent SwiftShader from spending minutes redrawing the
  // city while the test waits to issue its first state query.
  if (!has("--live-raf")) await c.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `(() => {
      const nativeRAF = window.requestAnimationFrame.bind(window);
      let left = 600;
      window.requestAnimationFrame = function (cb) {
        return left-- > 0 ? nativeRAF(cb) : 0;
      };
      window.__probeStopRaf = function () { left = 0; window.__probeRafFrozen = true; };
    })();`,
  });
  // CBZ_PRELOAD runs a script in EVERY new document, before one line of game
  // code. CBZ_URL_EXTRA can only set CONFIG; this reaches the layer underneath
  // it — the environment the game feature-detects. The case it was built for:
  // systems/touch.js builds the whole iPad control layer only when
  // `(pointer: coarse)` matches, which no CONFIG flag and no headless Chrome
  // switch can make true, so every touch-layout question was previously
  // unaskable headless and any DOM assertion about a touch control was a false
  // negative dressed as a pass. CBZ_PRELOAD=tools/preload/ipad.js is that fix.
  // Value is a PATH when it resolves to a readable file, else raw JS.
  if (process.env.CBZ_PRELOAD) {
    const v = process.env.CBZ_PRELOAD;
    const p = path.isAbsolute(v) ? v : path.join(ROOT, v);
    const source = existsSync(p) ? readFileSync(p, "utf8") : v;
    await c.send("Page.addScriptToEvaluateOnNewDocument", { source });
  }
  await c.send("Page.navigate", { url: target });
  log("booted, starting the run…");
  for (let i = 0, r = false; i < 500 && !r; i++) { try { r = !!(await c.evl("!!(window.CBZ&&CBZ.game&&CBZ.stepSim&&document.getElementById('playBtn'))")); } catch (_) {} if (!r) await sleep(150); }
  for (let i = 0, p = false; i < 400 && !p; i++) { p = await c.evl("(()=>{if(CBZ.game&&CBZ.game.state==='playing')return true;const b=document.getElementById('playBtn');if(b)b.click();return CBZ.game&&CBZ.game.state==='playing';})()"); if (!p) await sleep(200); }
  for (let i = 0; i < 300; i++) { if (await c.evl("!!(CBZ.city&&CBZ.city.arena&&CBZ.city.arena.roads&&CBZ.city.arena.roads.length)")) break; await sleep(200); }
  // A full-city SwiftShader frame can consume every renderer core and starve
  // the CDP query that this tool exists to run. Once the real title-screen
  // world has finished building, allow one final frame and freeze rAF; callers
  // advance gameplay explicitly through --step. Visual/profile callers can
  // opt back into continuous rendering with --live-raf.
  if (!has("--live-raf")) {
    await c.evl("(()=>{if(window.__probeStopRaf)window.__probeStopRaf();window.__probeRafFrozen=true;return true;})()");
    await sleep(250);
  }
  log("world built.");
  return { c, page, port, dbg, seed, chrome, server, origin, profile };
}

// ------------------------------------------------------------------- modes
if (has("--stop")) {
  if (existsSync(LOCK)) {
    const L = JSON.parse(readFileSync(LOCK, "utf8"));
    try { process.kill(-L.chromePid); } catch (_) {}
    try { process.kill(-L.serverPid); } catch (_) {}
    await rm(LOCK, { force: true });
    console.log("stopped world on :" + L.port);
  } else console.log("no live world");
  process.exit(0);
}

if (has("--serve")) {
  const seed = argS("--seed", "90210");
  const w = await boot(seed, false);
  await writeFile(LOCK, JSON.stringify({
    ws: w.page.webSocketDebuggerUrl, port: w.port, dbg: w.dbg, seed,
    chromePid: w.chrome.pid, serverPid: w.server.pid, started: new Date().toISOString(),
  }, null, 1));
  console.log("READY seed=" + seed + " dbg=" + w.dbg + "  (probe with: node tools/probe.mjs '<expr>')");
  // hold open
  await new Promise(() => {});
}

/* Flags that CONSUME the next argv entry. Declared once, because the bare
   expression is "everything left over" and a flag missing from this list has
   its VALUE silently joined into the expression instead. `--eval-timeout` was
   missing, so

       probe.mjs --eval-timeout 180000 'CBZ.foo()'

   evaluated the string "180000 CBZ.foo()" and failed with `SyntaxError:
   Unexpected identifier` or `TypeError: 180000 is not a function` — an error
   about the caller's code, pointing nowhere near the real cause. Adding a new
   value-taking flag means adding it here. */
const VALUED = new Set(["--seed", "--step", "--file", "--eval-timeout"]);

// ---- one-shot query: attach to the live world if there is one --------------
const expr = has("--file")
  ? await readFile(argS("--file", ""), "utf8")
  : argv.filter((a, i) => !a.startsWith("--") && !VALUED.has(argv[i - 1])).join(" ");
if (!expr && !has("--reset") && !has("--step")) {
  console.error("usage: probe.mjs '<expression>' | --file f.js | --serve | --stop | --step N | --reset | --isolated");
  process.exit(2);
}

let attached = null, own = null;
if (!has("--isolated") && existsSync(LOCK)) {
  try {
    const L = JSON.parse(readFileSync(LOCK, "utf8"));
    const c = client(L.ws);
    await c.ready;
    await c.send("Runtime.enable");
    const alive = await c.evl("!!(window.CBZ&&CBZ.city&&CBZ.city.arena)");
    if (alive) attached = c; else try { c.ws.close(); } catch (_) {}
  } catch (_) { attached = null; }
}
if (!attached) {
  console.error("[probe] no live world (run --serve for the fast path); booting a throwaway…");
  own = await boot(argS("--seed", "90210"), true);
  attached = own.c;
}

if (has("--reset")) {
  await attached.evl("(()=>{const b=document.getElementById('playBtn');if(CBZ.resetGame)CBZ.resetGame();else if(b)b.click();return true;})()");
  for (let i = 0; i < 200; i++) { if (await attached.evl("!!(CBZ.city&&CBZ.city.arena&&CBZ.city.arena.roads&&CBZ.city.arena.roads.length)")) break; await sleep(150); }
}
const steps = +argS("--step", 0);
if (steps > 0) {
  const ms = await attached.evl(`(()=>{const t=performance.now();for(let i=0;i<${steps};i++)CBZ.stepSim(1/60);return Math.round(performance.now()-t);})()`);
  console.error(`[probe] stepped ${steps} ticks in ${ms}ms`);
}

if (expr) {
  let out;
  const evalMs = Math.max(1000, +argS("--eval-timeout", 30000) || 30000);
  let timer = null;
  try {
    out = await Promise.race([
      attached.evl(`(() => { const __r = (${expr}); return (typeof __r === 'undefined') ? null : __r; })()`, true),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("evaluation timed out after " + evalMs + "ms")), evalMs);
      }),
    ]);
  }
  catch (e) { console.error("EVAL THREW: " + e.message); process.exitCode = 1; }
  finally { if (timer) clearTimeout(timer); }
  console.log(typeof out === "object" ? JSON.stringify(out, null, 1) : String(out));
}
if (attached.errors.length) console.error("[probe] console errors: " + attached.errors.slice(0, 6).join(" | "));

if (own) {
  try { process.kill(-own.chrome.pid); } catch (_) {}
  try { process.kill(-own.server.pid); } catch (_) {}
  await sleep(150);
  // Only the exact profile this boot minted is eligible for recursive cleanup.
  // Chrome can still be flushing its caches when the kill lands, and an rm
  // racing those writes throws ENOTEMPTY — which used to crash the probe
  // AFTER it had already printed its answer, making callers (the interior
  // containment test) read a healthy run as "could not run". Best-effort
  // only: retry once, then leave the dir for the next boot's sweep.
  if (own.profile && own.profile.startsWith("/tmp/cbz-probe-")) {
    try { await rm(own.profile, { recursive: true, force: true }); }
    catch (_) { await sleep(400); try { await rm(own.profile, { recursive: true, force: true }); } catch (_) {} }
  }
}
process.exit(process.exitCode || 0);
