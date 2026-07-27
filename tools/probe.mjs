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
  const profile = `/tmp/cbz-probe-${dbg}`;
  await rm(profile, { recursive: true, force: true });
  const CHROME = process.env.CBZ_CHROME || (process.platform === "darwin"
    ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    : "/opt/pw-browsers/chromium");
  const chrome = spawn(CHROME, ["--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
    "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--enable-webgl",
    "--mute-audio", "--window-size=480,300", `--remote-debugging-port=${dbg}`,
    `--user-data-dir=${profile}`, `${origin}?seed=${seed}`], { stdio: "ignore", detached: true });

  let page = null;
  for (let i = 0; i < 300 && !page; i++) {
    try { const ps = await (await fetch(`http://127.0.0.1:${dbg}/json/list`)).json(); page = ps.find((p) => p.type === "page" && p.url.startsWith(origin)); } catch (_) {}
    if (!page) await sleep(100);
  }
  if (!page) throw new Error("chromium never opened the page");
  const c = client(page.webSocketDebuggerUrl);
  await c.ready;
  await c.send("Runtime.enable"); await c.send("Page.enable");
  log("booted, starting the run…");
  for (let i = 0, r = false; i < 500 && !r; i++) { try { r = !!(await c.evl("!!(window.CBZ&&CBZ.game&&CBZ.stepSim&&document.getElementById('playBtn'))")); } catch (_) {} if (!r) await sleep(150); }
  for (let i = 0, p = false; i < 400 && !p; i++) { p = await c.evl("(()=>{if(CBZ.game&&CBZ.game.state==='playing')return true;const b=document.getElementById('playBtn');if(b)b.click();return CBZ.game&&CBZ.game.state==='playing';})()"); if (!p) await sleep(200); }
  for (let i = 0; i < 300; i++) { if (await c.evl("!!(CBZ.city&&CBZ.city.arena&&CBZ.city.arena.roads&&CBZ.city.arena.roads.length)")) break; await sleep(200); }
  log("world built.");
  return { c, page, port, dbg, seed, chrome, server, origin };
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

// ---- one-shot query: attach to the live world if there is one --------------
const expr = has("--file")
  ? await readFile(argS("--file", ""), "utf8")
  : argv.filter((a) => !a.startsWith("--") && argv[argv.indexOf(a) - 1] !== "--seed" && argv[argv.indexOf(a) - 1] !== "--step" && argv[argv.indexOf(a) - 1] !== "--file").join(" ");
if (!expr && !has("--reset") && !has("--step")) {
  console.error("usage: probe.mjs '<expression>' | --file f.js | --serve | --stop | --step N | --reset");
  process.exit(2);
}

let attached = null, own = null;
if (existsSync(LOCK)) {
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
  try { out = await attached.evl(`(() => { const __r = (${expr}); return (typeof __r === 'undefined') ? null : __r; })()`, true); }
  catch (e) { console.error("EVAL THREW: " + e.message); process.exitCode = 1; }
  console.log(typeof out === "object" ? JSON.stringify(out, null, 1) : String(out));
}
if (attached.errors.length) console.error("[probe] console errors: " + attached.errors.slice(0, 6).join(" | "));

if (own) { try { process.kill(-own.chrome.pid); } catch (_) {} try { process.kill(-own.server.pid); } catch (_) {} }
process.exit(process.exitCode || 0);
