#!/usr/bin/env node
/* tools/test-street-talk.mjs — headless probe: exec origin crash + YES/NO/PUNCH.
   Usage: node tools/test-street-talk.mjs */
import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const port = 8960 + Math.floor(Math.random() * 30);
const server = spawn("python3", [path.join(ROOT, "tools/devserver.py")], {
  env: { ...process.env, PORT: String(port) }, stdio: "ignore",
});
const base = `http://127.0.0.1:${port}/`;
const dbg = 9960 + Math.floor(Math.random() * 30);
const profile = `/tmp/cbz-street-${dbg}`;
await rm(profile, { recursive: true, force: true });
await sleep(700);

const chromeBin = process.env.CBZ_CHROME ||
  (process.platform === "darwin"
    ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    : "/opt/pw-browsers/chromium");
const chrome = spawn(chromeBin, [
  "--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
  "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
  "--enable-webgl", "--mute-audio", "--window-size=1440,900",
  `--remote-debugging-port=${dbg}`, `--user-data-dir=${profile}`,
  base + "?seed=7",
], { stdio: "ignore" });

let page = null;
for (let i = 0; i < 80 && !page; i++) {
  try {
    const ps = await (await fetch(`http://127.0.0.1:${dbg}/json/list`)).json();
    page = ps.find((p) => p.type === "page" && p.url.startsWith(base));
  } catch (_) {}
  if (!page) await sleep(250);
}
if (!page) { console.error("FAIL: no page"); process.exit(1); }

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
const evl = async (expression, awaitPromise = false) => {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise });
  return r.result && r.result.result && r.result.result.value;
};
await send("Runtime.enable");
await send("Page.enable");

for (let i = 0; i < 60; i++) {
  if (await evl("!!(window.CBZ && CBZ.game && document.getElementById('playBtn'))")) break;
  await sleep(500);
}

// Force a fresh exec origin ledger so the crash scene runs.
await evl(`(() => {
  try {
    localStorage.removeItem("CBZ_CITY_WORLD_V2");
    localStorage.removeItem("CBZ_CITY_CHARS_V1");
  } catch (e) {}
  if (CBZ.setCityOrigin) CBZ.setCityOrigin("exec");
  CBZ.game.cityOrigin = "exec";
  CBZ.game.mode = "city";
  return CBZ.game.cityOrigin;
})()`);

let playing = false;
for (let i = 0; i < 120 && !playing; i++) {
  await evl("(() => { const b = document.getElementById('playBtn'); if (b) b.click(); return true; })()");
  await sleep(700);
  playing = await evl("!!(window.CBZ && CBZ.game && CBZ.game.state === 'playing')");
}
console.log("playing:", playing);

// Wait for city + origin systems
for (let i = 0; i < 40; i++) {
  const ready = await evl("!!(CBZ.city && CBZ.city.arena && CBZ.streetTalkOffer && CBZ.bw)");
  if (ready) break;
  await sleep(500);
}

// Fast-forward exec laptop phase by advancing scene timers if present.
// Origins tick is real-time; jump state after a short wait.
await sleep(3500);
const mid = await evl(`(() => {
  const g = CBZ.game;
  const out = {
    origin: g.cityOrigin,
    cash: g.cash|0,
    bank: g.cityBank|0,
    debt: g.cityDebt|0,
    outfit: g.cityOutfitId || null,
    invWatch: !!(g.cityInv && (g.cityInv["Gold Watch"]|0)),
    invShades: !!(g.cityInv && ((g.cityInv["Designer Shades"]|0) || (g.cityInv["Sunglasses"]|0))),
    laptop: !!(document.getElementById("originLaptop") && document.getElementById("originLaptop").style.display !== "none"),
    streetTalk: !!(CBZ.streetTalkEnabled && CBZ.streetTalkEnabled()),
    bw: CBZ.bw ? CBZ.bw("{{F_WORD}} hello") : null,
    punchHook: typeof CBZ.streetTalkPunch === "function",
    peds: (CBZ.cityPeds && CBZ.cityPeds.length) || 0,
    playerY: CBZ.player && CBZ.player.pos ? +CBZ.player.pos.y.toFixed(2) : null,
  };
  // Offer math on nearest live ped
  let offer = null;
  if (CBZ.cityPeds && CBZ.streetTalkOffer) {
    const P = CBZ.player;
    let best = null, bd = 1e9;
    for (const p of CBZ.cityPeds) {
      if (!p || p.dead || p.vendor) continue;
      const d = Math.hypot(p.pos.x - P.pos.x, p.pos.z - P.pos.z);
      if (d < bd) { bd = d; best = p; }
    }
    if (best) {
      // clear done flags so offer can build
      best._streetDone = 0;
      const o = CBZ.streetTalkOffer(best);
      offer = o ? { kind: o.kind, amount: o.amount, max: o.max, gap: o.gap, label: o.label } : null;
    }
  }
  out.offer = offer;
  return out;
})()`);
console.log("mid:", JSON.stringify(mid, null, 2));

// Wait past crash beat
await sleep(4000);
const after = await evl(`(() => {
  const g = CBZ.game;
  return {
    cash: g.cash|0,
    bank: g.cityBank|0,
    debt: g.cityDebt|0,
    crashed: (g.cash|0) === 0 && (g.cityBank|0) === 0,
    phoneNotices: (CBZ.cityPhoneNews && CBZ.cityPhoneNews.length) || 0,
  };
})()`);
console.log("after:", JSON.stringify(after, null, 2));

const ok =
  playing &&
  mid && mid.streetTalk && mid.punchHook && mid.bw &&
  after && after.crashed;

// Filter baseline ProgressEvent noise
const realErr = errors.filter((e) => !/ProgressEvent/i.test(e));
console.log("ERRORS:", realErr.length ? realErr.slice(0, 8).join(" | ") : "none");
console.log(ok ? "street-talk probe: ok" : "street-talk probe: FAIL");

try { chrome.kill(); } catch (_) {}
try { server.kill(); } catch (_) {}
process.exit(ok && realErr.length === 0 ? 0 : 1);
