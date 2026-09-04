#!/usr/bin/env node
/* ============================================================
   tools/appcache-check.mjs — IS THE RELOAD ACTUALLY FREE?

   sw.js claims three things; each is measured here against a real
   headless Chromium, on a hostname the worker does NOT skip (it refuses
   localhost on purpose, so this maps cbz.test → 127.0.0.1 and marks that
   origin secure for the browser):

     1. FIRST VISIT installs the worker; SECOND VISIT is served from it.
        Counted from the network log: how many of the page's script
        responses came from the service worker, and how long the page took
        to reach bootComplete each time.
     2. A DEPLOY IS NEVER MIXED. index.html is edited on disk between two
        loads; the load after the edit must fetch every script from the
        network again (the worker dropped its cache when the page changed),
        and the load after THAT is served from the cache again.
     3. ?nosw=1 unregisters.

   Usage: node tools/appcache-check.mjs
============================================================ */
import { spawn } from "node:child_process";
import { rm, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function claimPort(lo, span, probe) {
  for (let t = 0; t < 8; t++) {
    const p = lo + Math.floor(Math.random() * span);
    try { await probe(p); } catch (_) { return p; }
  }
  console.error("FAIL: no free port near " + lo); process.exit(1);
}
const httpPort = await claimPort(8900, 200, (p) => fetch(`http://127.0.0.1:${p}/`));
const server = spawn("python3", [path.join(ROOT, "tools/devserver.py")], { env: { ...process.env, PORT: String(httpPort) }, stdio: "ignore" });
let up = false;
for (let i = 0; i < 60 && !up; i++) { try { await fetch(`http://127.0.0.1:${httpPort}`); up = true; } catch (_) { await sleep(100); } }
if (!up) { console.error("FAIL: devserver never came up"); server.kill("SIGTERM"); process.exit(1); }
const HOST = "cbz.test";
const base = `http://${HOST}:${httpPort}`;

const dbg = await claimPort(11000, 250, (p) => fetch(`http://127.0.0.1:${p}/json/version`));
const profileDir = `/tmp/cbz-appcache-${dbg}`;
await rm(profileDir, { recursive: true, force: true });
const CHROME = process.env.CBZ_CHROME || (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "/opt/pw-browsers/chromium");
const chrome = spawn(CHROME, [
  "--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--mute-audio",
  "--disable-background-networking", "--disable-component-update", "--no-first-run", "--no-default-browser-check", "--disable-extensions",
  `--host-resolver-rules=MAP ${HOST} 127.0.0.1`, `--unsafely-treat-insecure-origin-as-secure=${base}`,
  `--remote-debugging-port=${dbg}`, `--user-data-dir=${profileDir}`, "about:blank",
], { stdio: "ignore" });
function bail(msg, code = 1) { if (msg) console.error(msg); try { chrome.kill("SIGKILL"); } catch (_) {} try { server.kill("SIGTERM"); } catch (_) {} process.exit(code); }
let target = null;
for (let i = 0; i < 100 && !target; i++) {
  try { target = (await (await fetch(`http://127.0.0.1:${dbg}/json/list`)).json()).find((t) => t.type === "page"); } catch (_) {}
  if (!target) await sleep(200);
}
if (!target) bail("FAIL: chromium never exposed a page target");
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let nextId = 1; const pending = new Map();
let log = { sw: 0, net: 0, scripts: 0 };
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
  if (msg.method === "Network.responseReceived") {
    const r = msg.params.response, u = r.url || "";
    if (!/\/src\/.*\.js/.test(u)) return;
    log.scripts++;
    if (r.fromServiceWorker) log.sw++; else log.net++;
  }
};
function send(method, params = {}) {
  const id = nextId++; ws.send(JSON.stringify({ id, method, params }));
  return new Promise((res, rej) => { pending.set(id, (m) => (m.error ? rej(new Error(method + ": " + m.error.message)) : res(m.result))); setTimeout(() => rej(new Error("timeout " + method)), 300000); });
}
async function evl(expression) {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true, timeout: 300000 });
  if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception || {}).description || r.exceptionDetails.text);
  return r.result.value;
}
await send("Network.enable"); await send("Page.enable"); await send("Runtime.enable");
await send("Network.setBlockedURLs", { urls: ["*fonts.googleapis.com*", "*fonts.gstatic.com*"] });

async function load(url) {
  log = { sw: 0, net: 0, scripts: 0 };
  const t0 = Date.now();
  await send("Page.navigate", { url });
  for (let i = 0; i < 900; i++) {
    try { if (await evl("!!(window.CBZ && CBZ.bootComplete)")) break; } catch (_) {}
    await sleep(100);
  }
  const ms = Date.now() - t0;
  const controlled = await evl("!!(navigator.serviceWorker && navigator.serviceWorker.controller)");
  if (/nosw=1/.test(url)) { try { await evl("CBZ.appCacheOff || Promise.resolve()"); } catch (_) {} }
  const registered = await evl("navigator.serviceWorker ? navigator.serviceWorker.getRegistrations().then(r => r.length) : -1");
  // what the worker itself says: cache hits vs network misses for this navigation
  let st = null;
  try { st = await evl("CBZ.appCacheStats ? CBZ.appCacheStats() : null"); } catch (_) {}
  return { ms, controlled, registered, hit: st ? st.hit : 0, miss: st ? st.miss : 0, ...log };
}
let ok = true;
const check = (k, cond, v) => { console.log("  " + k.padEnd(44) + (cond ? "ok" : "FAIL") + (v != null ? "  (" + v + ")" : "")); if (!cond) ok = false; };
const show = (k, r) => console.log("  " + k.padEnd(44) + `${r.ms} ms · ${r.sw}/${r.scripts} scripts via the worker · worker cache hits ${r.hit}, misses ${r.miss}`);

console.log("APPCACHE CHECK — " + base + "\n");
const a = await load(base + "/index.html");
show("1st visit (installing)", a);
await evl("navigator.serviceWorker.ready.then(() => true)");
await sleep(2500);   // the install precaches every script the page names
const b = await load(base + "/index.html");
show("2nd visit", b);
check("worker registered", b.registered > 0, b.registered);
check("2nd visit served from the cache", b.controlled && b.hit > b.scripts * 0.9 && b.miss < 12, `${b.hit} hits, ${b.miss} misses`);
check("2nd visit faster to bootComplete", b.ms < a.ms, `${a.ms} → ${b.ms} ms`);

// a deploy: index.html changes on disk
const idx = path.join(ROOT, "index.html");
const orig = await readFile(idx, "utf8");
await writeFile(idx, orig.replace("</head>", "<!-- appcache-check deploy marker -->\n</head>"));
let c, d;
try {
  c = await load(base + "/index.html");
  show("after a deploy (index.html changed)", c);
  check("deploy: every script refetched, none stale", c.miss > c.scripts * 0.9 && c.hit <= 2, `${c.miss} misses, ${c.hit} hits`);
  await sleep(1500);
  d = await load(base + "/index.html");
  show("next visit after the deploy", d);
  check("next visit back on the cache", d.hit > d.scripts * 0.9, `${d.hit} hits, ${d.miss} misses`);
} finally { await writeFile(idx, orig); }

const e = await load(base + "/index.html?nosw=1");
await sleep(800);
const regs = await evl("navigator.serviceWorker.getRegistrations().then(r => r.length)");
check("?nosw=1 unregisters", regs === 0, regs + " registrations left");

console.log("\nAPPCACHE CHECK: " + (ok ? "ok" : "FAIL"));
bail("", ok ? 0 : 1);
