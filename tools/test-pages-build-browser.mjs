#!/usr/bin/env node
// Boot the production artifact at the same /gta6/ subpath used by a project
// GitHub Pages site. Root-only preview cannot catch leading-slash asset URLs.

import { spawn } from "node:child_process";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const webPort = 9720 + Math.floor(Math.random() * 100);
const debugPort = 11220 + Math.floor(Math.random() * 100);
const profile = path.join(os.tmpdir(), `cbz-pages-profile-${debugPort}`);
const siteRoot = await mkdtemp(path.join(os.tmpdir(), "cbz-pages-site-"));
const chromePath = process.env.CBZ_CHROME || (process.platform === "darwin"
  ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  : "/opt/pw-browsers/chromium");

await symlink(path.join(ROOT, "dist"), path.join(siteRoot, "gta6"), "dir");
await rm(profile, { recursive: true, force: true });
const server = spawn("python3", ["-m", "http.server", String(webPort), "--bind", "127.0.0.1", "--directory", siteRoot], {
  cwd: ROOT, stdio: "ignore",
});
const base = `http://127.0.0.1:${webPort}/gta6/`;
const chrome = spawn(chromePath, [
  "--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
  "--enable-unsafe-swiftshader", "--enable-webgl", "--mute-audio",
  "--window-size=1280,800", `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${profile}`, `${base}?seed=90210`,
], { cwd: ROOT, stdio: "ignore" });

let ws = null, nextId = 1;
const pending = new Map(), browserErrors = [];
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => {
      if (!pending.has(id)) return;
      pending.delete(id);
      reject(new Error(`${method} timed out`));
    }, 60000);
    pending.set(id, { resolve, reject, timer });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const out = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (out?.exceptionDetails) throw new Error(out.exceptionDetails.exception?.description || out.exceptionDetails.text || "browser evaluation failed");
  return out?.result?.value;
}

try {
  let page = null;
  for (let i = 0; i < 160 && !page; i++) {
    try {
      const pages = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
      page = pages.find((p) => p.type === "page" && p.url.startsWith(base));
    } catch (_) {}
    if (!page) await sleep(250);
  }
  if (!page) throw new Error("Chrome page did not become available");
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);
    if (msg.method === "Runtime.exceptionThrown") {
      browserErrors.push(msg.params?.exceptionDetails?.exception?.description || msg.params?.exceptionDetails?.text || "runtime exception");
      return;
    }
    if (msg.method === "Runtime.consoleAPICalled" && msg.params?.type === "error") {
      browserErrors.push(msg.params.args.map((a) => a.value || a.description || "").join(" "));
      return;
    }
    if (!msg.id || !pending.has(msg.id)) return;
    const p = pending.get(msg.id); pending.delete(msg.id); clearTimeout(p.timer);
    if (msg.error) p.reject(new Error(msg.error.message)); else p.resolve(msg.result);
  });
  await send("Runtime.enable");

  let ready = false;
  for (let i = 0; i < 260; i++) {
    ready = !!(await evaluate("document.readyState==='complete' && !!(window.CBZ && CBZ.bootComplete && CBZ.game && CBZ.game.state==='title')"));
    if (ready) break;
    await sleep(250);
  }
  if (!ready) throw new Error("production game did not boot at /gta6/");

  const result = JSON.parse(await evaluate(`(async function(){
    const expected=new URL('assets/bootstrap.js',location.href);
    const probes=await Promise.all(['assets/bootstrap.js','src/config.js','css/screens.css'].map(async function(url){
      const response=await fetch(url,{cache:'no-store'});return {url:url,status:response.status};
    }));
    const bridge=await import('./assets/bootstrap.js');
    await new Promise(function(resolve){setTimeout(resolve,100);});
    return JSON.stringify({path:location.pathname,expectedBootstrapPath:expected.pathname,probes:probes,
      bridgeReady:typeof bridge.adoptScene==='function'&&bridge.adoptScene().CBZ===window.CBZ,
      integrationReady:!!(CBZ.grass&&Array.isArray(CBZ.grass.patches)&&typeof CBZ.grass.setEnabled==='function'),
      titleVisible:!document.getElementById('title').classList.contains('hidden')});
  })()`));

  const failures = [];
  if (result.path !== "/gta6/") failures.push(`unexpected path ${result.path}`);
  if (result.expectedBootstrapPath !== "/gta6/assets/bootstrap.js") failures.push("bootstrap URL escaped the repository subpath");
  if (result.probes.some((p) => p.status !== 200)) failures.push(`asset probe failed: ${JSON.stringify(result.probes)}`);
  if (!result.bridgeReady || !result.integrationReady) failures.push("Vite module bridge did not fully load");
  if (!result.titleVisible) failures.push("playable title was not visible");
  if (browserErrors.length) failures.push(`browser runtime errors: ${browserErrors.slice(0, 3).join(" | ")}`);
  console.log(JSON.stringify({ result, browserErrors, failures }, null, 2));
  if (failures.length) process.exitCode = 1;
} finally {
  try { if (ws && ws.readyState === WebSocket.OPEN) await send("Browser.close"); } catch (_) {}
  if (!chrome.killed) chrome.kill("SIGTERM");
  if (!server.killed) server.kill("SIGTERM");
  await rm(profile, { recursive: true, force: true }).catch(() => {});
  await rm(siteRoot, { recursive: true, force: true }).catch(() => {});
}
