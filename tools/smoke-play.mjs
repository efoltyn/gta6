#!/usr/bin/env node
/* tools/smoke-play.mjs — boot the game headless, press PLAY, run N seconds,
   collect every console error/page exception, take a gameplay screenshot.
   The pass/fail gate for rig/vehicle refactors: the city must come up clean.
   Usage: node tools/smoke-play.mjs [seconds=12] [out.png] */
import { spawn } from "node:child_process";
import { rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const RUN_S = +(process.argv[2] || 12);
const OUT = process.argv[3] || path.join(ROOT, "tools/shots/smoke-play.png");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T0 = Date.now();
const tmark = (label) => console.log(`[t+${((Date.now() - T0) / 1000).toFixed(1)}s] ${label}`);

// SwiftShader raster cost scales with pixels, and half this script's phases
// wait on FRAMES (menu boot, state flip, sim advance, screenshot) — a small
// viewport makes the whole gate proportionally faster while running the exact
// same code paths. Full-res is one env var away when you want a pretty shot.
const W = +(process.env.CBZ_SMOKE_W || 800), H = +(process.env.CBZ_SMOKE_H || 500);

// Port discipline: worktree agents may run OLDER tool copies concurrently
// (legacy windows: http 8700-8790/8950-8990, dbg 9700-9780/9950-9990), so
// these windows are fully DISJOINT from those — and each port is pre-flight
// checked: something already answering means the port is TAKEN and we'd
// silently attach to someone else's server/browser, so re-roll instead.
async function claimPort(lo, span, probe) {
  for (let tries = 0; tries < 6; tries++) {
    const p = lo + Math.floor(Math.random() * span);
    try { await probe(p); } catch (_) { return p; }   // nothing answered → free
  }
  console.error("FAIL: no free port near " + lo); process.exit(1);
}
const port = await claimPort(9050, 200, (p) => fetch(`http://127.0.0.1:${p}/`));
const server = spawn("python3", [path.join(ROOT, "tools/devserver.py")], {
  env: { ...process.env, PORT: String(port) }, stdio: "ignore",
});
const base = `http://127.0.0.1:${port}/`;
const dbg = await claimPort(10050, 250, (p) => fetch(`http://127.0.0.1:${p}/json/version`));
const profile = `/tmp/cbz-smoke-${dbg}`;
await rm(profile, { recursive: true, force: true });
// poll the devserver instead of a blind grace sleep
let up = false;
for (let i = 0; i < 40 && !up; i++) { try { await fetch(base); up = true; } catch (_) { await sleep(100); } }
if (!up) { console.error("FAIL: devserver never came up on :" + port); server.kill("SIGTERM"); process.exit(1); }
tmark("devserver up");
const chrome = spawn(process.env.CBZ_CHROME || (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "/opt/pw-browsers/chromium"), [
  "--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
  "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
  "--enable-webgl", "--mute-audio", `--window-size=${W},${H}`,
  `--remote-debugging-port=${dbg}`, `--user-data-dir=${profile}`, base,
], { stdio: "ignore" });

let page = null;
for (let i = 0; i < 150 && !page; i++) {
  try {
    const ps = await (await fetch(`http://127.0.0.1:${dbg}/json/list`)).json();
    page = ps.find((p) => p.type === "page" && p.url.startsWith(base));
  } catch (_) {}
  if (!page) await sleep(100);
}
if (!page) { console.error("FAIL: no page"); process.exit(1); }
tmark("page attached");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
let id = 1; const pending = new Map(); const errors = [];
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === "Runtime.exceptionThrown") {
    const d = m.params.exceptionDetails;
    errors.push(`${d.url || "?"}:${d.lineNumber} ${(d.exception && d.exception.description || d.text || "").split("\n")[0]}`);
  } else if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") {
    errors.push("console.error: " + m.params.args.map((a) => a.value || a.description || "").join(" ").slice(0, 200));
  }
});
const send = (method, params = {}) => new Promise((r) => { const i = id++; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evl = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true });
  return r.result && r.result.result && r.result.result.value;
};
await send("Runtime.enable");
await send("Page.enable");

// Wait for the BOOT TO FINISH, not for an early DOM fragment: CBZ.game and
// the PLAY button exist long before the last of ~241 script tags has parsed,
// and clicking in that window starts a PARTIAL world (late-tag landmasses
// missing — the 83-lot/57-lot anomalies) which main.js then stomps back to
// "title". bootComplete (or state 'title', which only main.js sets) is the
// ground truth that every module has registered.
for (let i = 0; i < 400; i++) {
  if (await evl("!!(window.CBZ && CBZ.game && (CBZ.bootComplete || CBZ.game.state === 'title') && document.getElementById('playBtn'))")) break;
  await sleep(150);
}
tmark("boot complete");
let playing = false;
for (let i = 0; i < 240 && !playing; i++) {
  // click-if-not-playing is ATOMIC in-page, so a queued duplicate activation
  // can never restart the run (startRun is a full world reset every call).
  playing = await evl("(() => { if (CBZ.game && CBZ.game.state === 'playing') return true; const b = document.getElementById('playBtn'); if (b) { b.click(); b.dispatchEvent(new MouseEvent('mousedown', {bubbles:true})); b.dispatchEvent(new MouseEvent('mouseup', {bubbles:true})); } return CBZ.game && CBZ.game.state === 'playing'; })()");
  if (!playing) await sleep(250);
}
console.log("playing:", playing);
tmark("world built, playing");
// simulate a run forward + a couple of punches so the anim paths execute.
// __smokeFrames: an rAF counter injected alongside — the run window below is
// gated on FRAMES, not wall time, because headless sim crawls (~60x): what
// the gate needs is that the update loop actually EXECUTED, and wall seconds
// wildly overshoot that on SwiftShader while proving nothing extra.
await evl(`(() => {
  window.__smokeFrames = 0;
  const loop = () => { window.__smokeFrames++; requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
  const kd = (code, key) => { const e = new KeyboardEvent("keydown", { code, key, bubbles: true }); document.dispatchEvent(e); window.dispatchEvent(e); };
  const ku = (code, key) => { const e = new KeyboardEvent("keyup", { code, key, bubbles: true }); document.dispatchEvent(e); window.dispatchEvent(e); };
  kd("KeyW", "w"); setTimeout(() => ku("KeyW", "w"), 2500);
  setTimeout(() => { if (CBZ.playerChar) { CBZ.playerChar.punchKind = "jab"; CBZ.playerChar.punchArm = "r"; CBZ.playerChar.punchDur = 0.34; CBZ.playerChar.punchT = 0.34; } }, 2800);
  return true;
})()`);
// run window: >=4s wall (the scripted W-run/punch timers fire at 2.5/2.8s)
// AND >=60 rendered frames, capped at RUN_S wall seconds (the old behavior).
// The cap is re-checked after the evl too — on a starved page each evl can
// block for seconds, and the loop used to overshoot the cap by that much.
const runStart = Date.now();
let frames = 0;
while (Date.now() - runStart < RUN_S * 1000) {
  await sleep(400);
  frames = (await evl("window.__smokeFrames || 0")) || 0;
  if (frames >= 60 && Date.now() - runStart >= 4000) break;
  if (Date.now() - runStart >= RUN_S * 1000) break;
}
tmark(`run window done (${frames} frames)`);
// ---- SETTLE + LIVENESS: never sample a world that isn't stable and live.
// Staged/deferred build passes settle across frames, and any bounce back to
// the title screen means the run is broken — a gate that prints "ok" over a
// dead world is worse than a slow gate.
let settled = null, prev = "";
for (let i = 0; i < 20; i++) {
  const s = await evl(`JSON.stringify([CBZ.game && CBZ.game.state, (CBZ.city && CBZ.city.arena && CBZ.city.arena.lots || []).length, (CBZ.city && CBZ.city.arena && CBZ.city.arena.shopLots || []).length, (CBZ.city && CBZ.city.arena && CBZ.city.arena.roads || []).length])`);
  if (s && s === prev && JSON.parse(s)[0] === "playing") { settled = JSON.parse(s); break; }
  prev = s; await sleep(800);
}
if (!settled) {
  console.log("invariants: FAIL — world never settled live (last sample: " + prev + ")");
  chrome.kill("SIGTERM"); server.kill("SIGTERM");
  process.exit(3);
}
tmark("world settled");
// ---- GENERATOR INVARIANTS (PROCGEN.md #8): cheap per-seed sanity ----
const inv = await evl(`(() => {
  if (!CBZ.game || CBZ.game.state !== "playing") return "FAIL: state=" + (CBZ.game && CBZ.game.state) + " — game not live at sample time";
  const A = CBZ.city && CBZ.city.arena;
  if (!A) return "no arena";
  const out = [];
  const lots = A.lots || [], shops = A.shopLots || [], roads = A.roads || [];
  if (!lots.length) out.push("FAIL: no lots");
  if (shops.length < 12) out.push("FAIL: only " + shops.length + " shops (essentials missing?)");
  // every shop door must sit near a road segment (reachability proxy)
  let orphans = 0;
  for (const l of shops) {
    const d = l.building && l.building.door; if (!d) { orphans++; continue; }
    let best = 1e9;
    for (const r of roads) {
      const dx = r.vertical ? Math.abs(d.x - r.x) : Math.max(0, Math.abs(d.x - r.x) - r.len / 2);
      const dz = r.vertical ? Math.max(0, Math.abs(d.z - r.z) - r.len / 2) : Math.abs(d.z - r.z);
      best = Math.min(best, Math.hypot(dx, dz));
    }
    if (best > 45) orphans++;
  }
  if (orphans) out.push("FAIL: " + orphans + " shop doors far from any road");
  // regions must all carry finite bounds
  let badR = 0;
  for (const r of (A.regions || [])) if (!isFinite(r.minX) || !isFinite(r.maxX)) badR++;
  if (badR) out.push("FAIL: " + badR + " regions with non-finite bounds");
  return out.length ? out.join(" | ") : "ok (" + lots.length + " lots, " + shops.length + " shops, " + roads.length + " roads)";
})()`);
console.log("invariants:", inv);
const state = await evl(`JSON.stringify({
  state: CBZ.game && CBZ.game.state,
  mode: CBZ.game && CBZ.game.mode,
  peds: (CBZ.cityPeds || []).length,
  playerY: CBZ.player && CBZ.player.pos && +CBZ.player.pos.y.toFixed(2),
  fps: CBZ.game && CBZ.game.fps,
})`);
console.log("state:", state);
const shot = await send("Page.captureScreenshot", { format: "png" });
await writeFile(OUT, Buffer.from(shot.result.data, "base64"));
console.log("shot:", OUT);
tmark("done");
const uniq = [...new Set(errors)];
console.log(uniq.length ? "ERRORS (" + uniq.length + "):\n" + uniq.slice(0, 25).join("\n") : "ERRORS: none");
chrome.kill("SIGTERM"); server.kill("SIGTERM");
await rm(profile, { recursive: true, force: true }).catch(() => {});
process.exit(uniq.length ? 2 : 0);
