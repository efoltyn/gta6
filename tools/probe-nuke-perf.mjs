#!/usr/bin/env node
/*
  Nuke sim-cost attribution probe.

  Boots the real city world headless, freezes the rAF loop, wraps every
  CBZ.updaters / CBZ.always entry with a timer, fires one real nuke through
  the full game path, then drives CBZ.stepSim(1/60) through the whole 34 s
  sequence. Reports, per simulated second, total tick cost and the top
  updaters by accumulated ms — the exact attribution needed to fix "the nuke
  freezes the game" without guessing.

  Usage: node tools/probe-nuke-perf.mjs [--seed 90210] [--seconds 34] [--url URL]
  (starts its own devserver when --url is omitted)
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

  const report = await evl(`(async () => {
    const CBZ = window.CBZ;
    if (CBZ.game.cityCampaign) CBZ.game.cityCampaign.phase = "endless_contracts";
    window.requestAnimationFrame = function () { return 0; };
    await new Promise((resolve) => setTimeout(resolve, 700));
    for (let i = 0; i < 120; i++) { CBZ.hitstop = 0; CBZ.slowmo = 0; CBZ.stepSim(1/60); }

    // wrap every updater with a timer keyed on its order number
    const acc = Object.create(null);
    const wrap = (list, tag) => {
      for (const entry of list) {
        const key = tag + ":" + entry.order;
        const original = entry.fn;
        if (original.__nukeWrapped) continue;
        const fn = function (dt) {
          const t0 = performance.now();
          original.call(this, dt);
          acc[key] = (acc[key] || 0) + (performance.now() - t0);
        };
        fn.__nukeWrapped = true;
        entry.fn = fn;
      }
    };
    wrap(CBZ.updaters, "u");
    wrap(CBZ.always, "a");

    // ground zero at the lot centroid, player parked far south + healed
    const lots = (CBZ.city && CBZ.city.arena && CBZ.city.arena.lots) || [];
    let gx = 0, gz = 0, n = 0;
    for (const lot of lots) {
      const x = Number(lot.x != null ? lot.x : lot.cx), z = Number(lot.z != null ? lot.z : lot.cz);
      if (Number.isFinite(x) && Number.isFinite(z)) { gx += x; gz += z; n++; }
    }
    gx = n ? gx / n : 0; gz = n ? gz / n : 0;
    if (CBZ.player && CBZ.player.pos && CBZ.player.pos.set) {
      const py = (CBZ.floorAt && CBZ.floorAt(gx, gz + 3000)) || 0;
      CBZ.player.pos.set(gx, py + 1.1, gz + 3000);
    }

    const baseline = { total: 0, ticks: 0 };
    for (let i = 0; i < 120; i++) {
      const t0 = performance.now(); CBZ.stepSim(1/60);
      baseline.total += performance.now() - t0; baseline.ticks++;
      if (CBZ.player) CBZ.player.hp = 100;
    }

    if (typeof CBZ.strategicNukeDetonate === "function") CBZ.strategicNukeDetonate(gx, gz, { byPlayer: false });
    else CBZ.detonate(gx, ((CBZ.floorAt && CBZ.floorAt(gx, gz)) || 0) + 1.2, gz, "nuke", { byPlayer: false });

    const seconds = [];
    const SECONDS = ${SECONDS};
    for (let s = 0; s < SECONDS; s++) {
      const before = Object.assign(Object.create(null), acc);
      let total = 0, worst = 0, over33 = 0;
      for (let i = 0; i < 60; i++) {
        CBZ.hitstop = 0; CBZ.slowmo = 0;
        const t0 = performance.now(); CBZ.stepSim(1/60);
        const ms = performance.now() - t0;
        total += ms; if (ms > worst) worst = ms; if (ms > 33) over33++;
        if (CBZ.player) CBZ.player.hp = 100;
      }
      const deltas = [];
      for (const key in acc) {
        const d = acc[key] - (before[key] || 0);
        if (d > 4) deltas.push([key, Math.round(d)]);
      }
      deltas.sort((a, b) => b[1] - a[1]);
      seconds.push({ s, totalMs: Math.round(total), worstMs: Math.round(worst), over33, top: deltas.slice(0, 8) });
    }
    const totals = Object.entries(acc).map(([key, ms]) => [key, Math.round(ms)]).sort((a, b) => b[1] - a[1]);
    return {
      baselinePerTickMs: Number((baseline.total / baseline.ticks).toFixed(2)),
      seconds,
      totalsTop: totals.slice(0, 24),
      cars: CBZ.cityCars ? CBZ.cityCars.length : 0,
      peds: CBZ.cityPeds ? CBZ.cityPeds.length : 0,
    };
  })()`, 480000);

  console.log(JSON.stringify(report, null, 1));
} finally {
  if (ws && ws.readyState <= 1) ws.close();
  for (const child of children.reverse()) if (!child.killed) child.kill("SIGTERM");
  await rm(profileDir, { recursive: true, force: true }).catch(() => {});
}
