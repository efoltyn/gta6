#!/usr/bin/env node
/* tools/touch-hud-check.mjs — force touch mode and verify the keyboard-only
   HUD clutter is hidden: player-card "[I] Inventory [O] Hide" caption, hotbar
   slot digits, and interact .ikey badges. Screenshots the touch HUD.
   Usage: node tools/touch-hud-check.mjs [out.png] */
import { spawn } from "node:child_process";
import { rm, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = process.argv[2] || path.join(ROOT, "tools/shots/touch-hud.png");
await mkdir(path.join(ROOT, "tools/shots"), { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 8950 + Math.floor(Math.random() * 40);
const server = spawn("python3", [path.join(ROOT, "tools/devserver.py")], { env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
const base = `http://127.0.0.1:${port}/`;
const dbg = 9950 + Math.floor(Math.random() * 40);
const profile = `/tmp/cbz-touch-${dbg}`;
await rm(profile, { recursive: true, force: true });
await sleep(700);
const chrome = spawn(process.env.CBZ_CHROME || "/opt/pw-browsers/chromium", [
  "--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
  "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
  "--enable-webgl", "--mute-audio", "--window-size=1180,820",
  `--remote-debugging-port=${dbg}`, `--user-data-dir=${profile}`, base,
], { stdio: "ignore" });
let pageInfo = null;
for (let i = 0; i < 80 && !pageInfo; i++) { try { const ps = await (await fetch(`http://127.0.0.1:${dbg}/json/list`)).json(); pageInfo = ps.find((p) => p.type === "page" && p.url.startsWith(base)); } catch (_) {} if (!pageInfo) await sleep(250); }
if (!pageInfo) { console.error("FAIL: no page"); process.exit(1); }
const ws = new WebSocket(pageInfo.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
let id = 1; const pending = new Map(); const errors = [];
ws.addEventListener("message", (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; } if (m.method === "Runtime.exceptionThrown") { const d = m.params.exceptionDetails; errors.push(`${d.url || "?"}:${d.lineNumber} ${(d.exception && d.exception.description || d.text || "").split("\n")[0]}`); } });
const send = (method, params = {}) => new Promise((r) => { const i = id++; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evl = async (expression) => { const r = await send("Runtime.evaluate", { expression, returnByValue: true }); return r.result && r.result.result && r.result.result.value; };
await send("Runtime.enable"); await send("Page.enable");
// force touch mode BEFORE play so the touch layer + body.touch engage
for (let i = 0; i < 60; i++) { if (await evl("!!(window.CBZ && CBZ.game && document.getElementById('playBtn'))")) break; await sleep(500); }
await evl("(() => { document.body.classList.add('touch'); window.CBZ.touchMode = true; if (window.CBZ.touchEnable) try{CBZ.touchEnable();}catch(e){} return true; })()");
let playing = false;
for (let i = 0; i < 120 && !playing; i++) { await evl("(() => { const b = document.getElementById('playBtn'); if (b) b.click(); return true; })()"); await sleep(600); playing = await evl("!!(window.CBZ && CBZ.game && CBZ.game.state === 'playing')"); }
await evl("(() => { document.body.classList.add('touch'); window.CBZ.touchMode = true; return true; })()");
console.log("playing:", playing);
await sleep(3000);
// measure the offending elements
const check = await evl(`(() => {
  const vis = (el) => { if (!el) return "absent"; const s = getComputedStyle(el); return (s.display !== "none" && el.offsetParent !== null) ? "SHOWN" : "hidden"; };
  const hint = document.querySelector("#cpPanel .cpHint");
  const slotKey = document.querySelector("#cHud .cSlot .key");
  const ikey = document.querySelector(".ikey");
  return JSON.stringify({
    bodyTouch: document.body.classList.contains("touch"),
    cpHint: vis(hint), hotbarDigit: vis(slotKey),
    ikeyPresent: !!ikey, ikey: vis(ikey),
  });
})()`);
console.log("check:", check);
// tap the portrait card → inventory must open (the touch affordance replacing [I])
const invTap = await evl(`(() => {
  const panel = document.getElementById("cpPanel"); if (!panel) return { panel: false };
  const pe = getComputedStyle(panel).pointerEvents;
  panel.click();
  const open1 = !!(CBZ.cityCharPanel && CBZ.cityCharPanel.isOpen());
  panel.click();   // second tap toggles closed
  const open2 = !!(CBZ.cityCharPanel && CBZ.cityCharPanel.isOpen());
  return { panel: true, pointerEvents: pe, opensOnTap: open1, closesOnTap: !open2 };
})()`);
console.log("invTap:", JSON.stringify(invTap));
const shot = await send("Page.captureScreenshot", { format: "png" });
await writeFile(OUT, Buffer.from(shot.result.data, "base64"));
console.log("shot:", OUT);
console.log(errors.length ? "ERRORS:\n" + [...new Set(errors)].slice(0, 10).join("\n") : "ERRORS: none");
chrome.kill("SIGTERM"); server.kill("SIGTERM");
await rm(profile, { recursive: true, force: true }).catch(() => {});
process.exit(0);
