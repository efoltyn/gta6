#!/usr/bin/env node
// Runs the query-gated in-game profiler in an isolated headless Chrome and
// prints the resulting JSON. Requires a local server, by default:
//   python3 -m http.server 8765 --bind 127.0.0.1
// Usage:
//   node tools/run-city-browser-profile.mjs calm 90
//   node tools/run-city-browser-profile.mjs wanted5 90
//   node tools/run-city-browser-profile.mjs calm 90 3   # pin quality tier 3

import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";

const scenario = process.argv[2] || "calm";
const frames = Math.max(30, Number(process.argv[3]) || 90);
const forcedQuality = process.argv[4] == null ? null : Math.max(0, Math.min(4, Number(process.argv[4]) | 0));
const server = process.env.CBZ_PROFILE_URL || "http://127.0.0.1:8765/";
const commandTimeout = Math.max(10000, Number(process.env.CBZ_CDP_TIMEOUT_MS) || 60000);
const port = 9300 + Math.floor(Math.random() * 500);
const profileDir = `/tmp/cbz-browser-profile-${port}`;
const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const forceQuery = forcedQuality == null ? "" : `&qforce=${forcedQuality}`;
const url = `${server}?profile=1&scenario=${encodeURIComponent(scenario)}&frames=${frames}&seconds=120${forceQuery}`;

await rm(profileDir, { recursive: true, force: true });
const chrome = spawn(chromePath, [
  "--headless=new",
  "--enable-unsafe-swiftshader",
  "--disable-background-networking",
  "--disable-component-update",
  "--disable-default-apps",
  "--disable-extensions",
  "--no-default-browser-check",
  "--no-first-run",
  "--ignore-certificate-errors",
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profileDir}`,
  url,
], { stdio: "ignore" });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let ws, nextId = 1;
const pending = new Map();
const browserErrors = [];

async function json(path) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`);
  if (!res.ok) throw new Error(`DevTools HTTP ${res.status}`);
  return res.json();
}

async function waitForPage() {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const pages = await json("/json/list");
      const page = pages.find((p) => p.type === "page" && p.url.includes("profile=1"));
      if (page) return page;
    } catch (_) {}
    await sleep(250);
  }
  throw new Error("Chrome DevTools page did not become available");
}

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const request = { resolve, reject, timer: null };
    pending.set(id, request);
    ws.send(JSON.stringify({ id, method, params }));
    request.timer = setTimeout(() => {
      if (!pending.has(id)) return;
      pending.delete(id);
      reject(new Error(`${method} timed out`));
    }, commandTimeout);
  });
}

async function connect(page) {
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id); pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error) p.reject(new Error(msg.error.message)); else p.resolve(msg.result);
      return;
    }
    if (msg.method === "Runtime.exceptionThrown") {
      const d = msg.params && msg.params.exceptionDetails;
      browserErrors.push(d && (d.exception && d.exception.description || d.text) || "browser exception");
    }
    if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
      browserErrors.push((msg.params.args || []).map((a) => a.value || a.description || "").join(" "));
    }
  });
  await send("Runtime.enable");
}

async function evaluate(expression) {
  const out = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  return out && out.result && out.result.value;
}

try {
  const page = await waitForPage();
  await connect(page);
  let report = null;
  let polls = 0, forced = false;
  while (polls++ < 180) {
    const value = await evaluate("window.CBZ && window.CBZ.perfReport ? JSON.stringify(window.CBZ.perfReport) : null");
    if (value) { report = JSON.parse(value); break; }
    // Headless Chrome can throttle requestAnimationFrame aggressively. Force a
    // partial but still authoritative snapshot after ~30s instead of hanging.
    if (!forced && polls >= 30) {
      forced = true;
      await evaluate("window.CBZ && CBZ.finishPerfProfile && CBZ.finishPerfProfile()");
    }
    await sleep(1000);
  }
  if (!report) {
    const state = await evaluate("JSON.stringify({ready:!!window.CBZ,state:window.CBZ&&CBZ.game&&CBZ.game.state,mode:window.CBZ&&CBZ.game&&CBZ.game.mode,peds:window.CBZ&&CBZ.cityPeds&&CBZ.cityPeds.length,cars:window.CBZ&&CBZ.cityCars&&CBZ.cityCars.length})");
    throw new Error(`profile did not finish; live state=${state}`);
  }
  report.browserErrors = browserErrors.slice(0, 30);
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
} finally {
  try { if (ws && ws.readyState === WebSocket.OPEN) await send("Browser.close"); } catch (_) {}
  if (!chrome.killed) chrome.kill("SIGTERM");
  await rm(profileDir, { recursive: true, force: true }).catch(() => {});
}
