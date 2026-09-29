#!/usr/bin/env node
/*
  Nuke CPU-profile probe: WHICH FUNCTION is eating the frame after a blast.

  Boots the real city headless, freezes rAF, fires one real nuke at the
  lot centroid with the player parked at (+dx, +dz), steps the sim to
  --from, then records a V8 CPU profile while stepping to --to. Prints the
  worst tick plus the top functions by self and inclusive time.

  Found with it (2026-09-29): a single 79 s tick from debris.js supportUnder
  querying the collider grid with a 700 m radius (glass shards whose centroid
  had been computed from the world origin and lost to cancellation).

  Usage: node tools/probe-nuke-cpu.mjs [--from 1.5] [--to 4.2] [--top 30]
           [--dx 650 --dz 2600] [--pre JS] [--post JS] [--url URL]
*/

import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const token = process.argv[i];
  if (token.startsWith("--")) args[token.slice(2)] = process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[++i] : true;
}
const SEED = Number(args.seed || 90210);
const SECONDS = Number(args.seconds || 34);

const webPort = 8600 + Math.floor(Math.random() * 300);
const debugPort = 10100 + Math.floor(Math.random() * 300);
const url = args.url ? String(args.url) : `http://127.0.0.1:${webPort}/`;
const chromeBin = process.env.CBZ_CHROME || (process.platform === "darwin"
  ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  : "/opt/pw-browsers/chromium");
const profileDir = await mkdtemp(path.join(tmpdir(), "cbz-nuke-perf-"));
const children = [];
if (!args.url) {
  children.push(spawn("python3", [path.join(ROOT, "tools", "devserver.py")], {
    cwd: ROOT, env: { ...process.env, PORT: String(webPort) }, stdio: "ignore",
  }));
}
children.push(spawn(chromeBin, [
  "--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--mute-audio",
  "--enable-webgl", "--enable-unsafe-swiftshader", "--window-size=960,600",
  `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profileDir}`, "about:blank",
], { cwd: ROOT, stdio: "ignore" }));

let ws; let seq = 1; const pending = new Map();
function send(method, params = {}, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const id = seq++;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evl(expression, timeoutMs = 120000) {
  const message = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, timeoutMs);
  if (message.exceptionDetails) throw new Error(message.exceptionDetails.exception?.description || message.exceptionDetails.text);
  return message.result?.value;
}

try {
  const deadline = Date.now() + 30000;
  let page = null;
  while (Date.now() < deadline && !page) {
    try {
      const pages = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
      page = pages.find((candidate) => candidate.type === "page") || null;
    } catch (_) {}
    if (!page) await sleep(250);
  }
  if (!page) throw new Error("no debugger page");
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const op = pending.get(message.id);
    pending.delete(message.id); clearTimeout(op.timer);
    if (message.error) op.reject(new Error(message.error.message)); else op.resolve(message.result);
  });
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Page.navigate", { url: `${url}?seed=${SEED}` });

  let booted = false;
  for (let i = 0; i < 600 && !booted; i++) {
    try { booted = !!(await evl("!!(window.CBZ && CBZ.game && (CBZ.bootComplete || CBZ.game.state === 'title') && CBZ.stepSim && document.getElementById('playBtn'))")); } catch (_) {}
    if (!booted) await sleep(300);
  }
  if (!booted) throw new Error("never booted");
  await evl("(() => { if (CBZ.CONFIG) CBZ.CONFIG.CITY_HITMAN_CAMPAIGN = false; return true; })()");
  let playing = false;
  for (let i = 0; i < 300 && !playing; i++) {
    playing = await evl("(() => { if (CBZ.game.state === 'playing') return true; const b = document.getElementById('playBtn'); if (b) b.click(); return CBZ.game.state === 'playing'; })()");
    if (!playing) await sleep(250);
  }
  if (!playing) throw new Error("never playing");

  await evl(`(async () => {
    const CBZ = window.CBZ;
    if (CBZ.game.cityCampaign) CBZ.game.cityCampaign.phase = "endless_contracts";
    window.requestAnimationFrame = function () { return 0; };
    await new Promise((r) => setTimeout(r, 700));
    for (let i = 0; i < 120; i++) { CBZ.hitstop = 0; CBZ.slowmo = 0; CBZ.stepSim(1/60); }
    const lots = (CBZ.city && CBZ.city.arena && CBZ.city.arena.lots) || [];
    let gx = 0, gz = 0, n = 0;
    for (const lot of lots) { const x = +(lot.x ?? lot.cx), z = +(lot.z ?? lot.cz); if (isFinite(x) && isFinite(z)) { gx += x; gz += z; n++; } }
    gx /= n || 1; gz /= n || 1;
    const px = gx + ${Number(args.dx || 650)}, pz = gz + ${Number(args.dz || 2600)};
    const py = (CBZ.floorAt && CBZ.floorAt(px, pz)) || 0;
    CBZ.player.pos.set(px, py + 1.1, pz);
    CBZ.strategicNukeDetonate(gx, gz, { byPlayer: false });
    window.__t = 0;
    return true;
  })()`);
  const FROM = Number(args.from || 0), TO = Number(args.to || 20);
  const stepTo = (t) => evl(`(() => { const CBZ = window.CBZ; let worst = 0, tot = 0, k = 0;
    while (window.__t < ${t}) { CBZ.hitstop = 0; CBZ.slowmo = 0; const t0 = performance.now(); CBZ.stepSim(1/60); const ms = performance.now() - t0; tot += ms; k++; if (ms > worst) worst = ms; window.__t += 1/60; if (CBZ.player) CBZ.player.hp = 100; }
    return { avg: k ? tot / k : 0, worst }; })()`, 600000);
  if (args.pre) await evl(String(args.pre));
  if (FROM > 0) console.error("pre", await stepTo(FROM));
  await send("Profiler.enable");
  await send("Profiler.setSamplingInterval", { interval: 200 });
  await send("Profiler.start");
  const st = await stepTo(TO);
  const prof = (await send("Profiler.stop")).profile;
  const self = new Map(); const byId = new Map();
  for (const nd of prof.nodes) byId.set(nd.id, nd);
  const dtus = prof.timeDeltas; const counts = new Map();
  for (let i = 0; i < prof.samples.length; i++) counts.set(prof.samples[i], (counts.get(prof.samples[i]) || 0) + (dtus[i] || 0));
  for (const [id, us] of counts) {
    const cf = byId.get(id).callFrame;
    const key = (cf.functionName || "(anon)") + " " + (cf.url || "").split("/").slice(-2).join("/").split("?")[0] + ":" + (cf.lineNumber + 1);
    self.set(key, (self.get(key) || 0) + us);
  }
  const top = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, Number(args.top || 40)).map(([k, us]) => [k, Math.round(us / 1000)]);
  // inclusive time by frame key
  const parent = new Map(); for (const nd of prof.nodes) for (const c of (nd.children || [])) parent.set(c, nd.id);
  const incl = new Map();
  for (const [id, us] of counts) { const seen = new Set(); let cur = id; while (cur != null) { const cf = byId.get(cur).callFrame; const key = (cf.functionName || "(anon)") + " " + (cf.url || "").split("/").slice(-2).join("/").split("?")[0] + ":" + (cf.lineNumber + 1); if (!seen.has(key)) { seen.add(key); incl.set(key, (incl.get(key) || 0) + us); } cur = parent.get(cur); } }
  const topIncl = [...incl.entries()].filter(([k]) => /\.js/.test(k)).sort((a, b) => b[1] - a[1]).slice(0, Number(args.top || 40)).map(([k, us]) => [k, Math.round(us / 1000)]);
  const post = args.post ? await evl(String(args.post)) : null;
  console.log(JSON.stringify({ window: [FROM, TO], tick: st, post, self: top, inclusive: topIncl }, null, 1));
} finally {
  if (ws && ws.readyState <= 1) ws.close();
  for (const child of children.reverse()) if (!child.killed) child.kill("SIGTERM");
  await rm(profileDir, { recursive: true, force: true }).catch(() => {});
}
