#!/usr/bin/env node
/* tools/test-campaign-contract.mjs — THE CONTRACT is a title-screen story,
   not a global takeover. Focused executable contract for the 2026-08-03
   run-scoping change (campaign.js/campaign_ui.js/origins.js/config.js):

     A. Fresh boot, flag at its default (true): the campaign is INERT —
        cityCampaignActive() false, sandbox origins untouched — and the
        "contract" story card is registered (DOM + origins registry).
     B. Picking The Contract and pressing Play stages the authored prologue
        (DROP phase, drop-point mission, player on the Spire helipad), the
        ledger records origin "contract" (resume path), and the scripted
        rooftop arrest hands off to the prison chapter with the campaign
        owning escape mode (g._campaignEscape).
     C. Standalone Prison Escape is never hijacked: with the ownership stamp
        down, escape mode reads campaign-inactive.

   No frames, no screenshots — CBZ.stepSim bursts + wall-clock waits only for
   the bust overlay's real setTimeout. Exit 0 = CONTRACT: ok. */
import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fails = [];
const T0 = Date.now();
const say = (l) => console.log(`[t+${((Date.now() - T0) / 1000).toFixed(1)}s] ${l}`);

async function claimPort(lo, span, probe) {
  for (let tries = 0; tries < 6; tries++) {
    const p = lo + Math.floor(Math.random() * span);
    try { await probe(p); } catch (_) { return p; }
  }
  console.error("CONTRACT: FAIL no free port near " + lo); process.exit(1);
}
const port = await claimPort(9550, 120, (p) => fetch(`http://127.0.0.1:${p}/`));
const server = spawn("python3", [path.join(ROOT, "tools/devserver.py")], { env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
const origin = `http://127.0.0.1:${port}/`;
{ let up = false;
  for (let i = 0; i < 40 && !up; i++) { try { await fetch(origin); up = true; } catch (_) { await sleep(100); } }
  if (!up) { console.error("CONTRACT: FAIL devserver never came up"); process.exit(1); } }
const dbg = await claimPort(10870, 120, (p) => fetch(`http://127.0.0.1:${p}/json/version`));
const profile = `/tmp/cbz-contract-${dbg}`;
await rm(profile, { recursive: true, force: true });
const CHROME_BIN = process.env.CBZ_CHROME ||
  (process.platform === "darwin"
    ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    : "/opt/pw-browsers/chromium");
const chrome = spawn(CHROME_BIN, [
  "--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
  "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
  "--enable-webgl", "--mute-audio", "--window-size=480,300",
  `--remote-debugging-port=${dbg}`, `--user-data-dir=${profile}`, `${origin}?seed=90210`,
], { stdio: "ignore" });

let page = null;
for (let i = 0; i < 150 && !page; i++) {
  try { const ps = await (await fetch(`http://127.0.0.1:${dbg}/json/list`)).json(); page = ps.find((p) => p.type === "page" && p.url.startsWith(origin)); } catch (_) {}
  if (!page) await sleep(100);
}
if (!page) { console.error("CONTRACT: FAIL no page"); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
let id = 1; const pend = new Map();
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
});
const send = (method, params = {}) => new Promise((r) => { const i = id++; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evl = async (expression) => { const r = await send("Runtime.evaluate", { expression, returnByValue: true }); return r.result && r.result.result && r.result.result.value; };
await send("Runtime.enable"); await send("Page.enable");

let ready = false;
for (let i = 0; i < 400 && !ready; i++) { try { ready = !!(await evl("!!(window.CBZ && CBZ.game && (CBZ.bootComplete || CBZ.game.state === 'title') && CBZ.stepSim && document.getElementById('playBtn'))")); } catch (_) {} if (!ready) await sleep(150); }
if (!ready) { console.error("CONTRACT: FAIL boot never reached title"); process.exit(1); }
say("title ready");

// ---- A: inert-by-default + card registered ----
const a = await evl(`(() => {
  const out = { fails: [] };
  if (CBZ.CONFIG.CITY_HITMAN_CAMPAIGN !== true) out.fails.push("flag default is not true");
  if (CBZ.cityCampaignActive()) out.fails.push("campaign active with no pick — run-scope broken");
  if (!document.querySelector('.origin-btn[data-origin="contract"]')) out.fails.push("no contract card in DOM");
  if (CBZ.cityOriginNormalize("contract") !== "contract") out.fails.push("registry does not know contract");
  if (CBZ.game.cityOrigin === "contract") out.fails.push("contract preselected on a fresh profile");
  return out;
})()`);
fails.push(...(a && a.fails || ["stage A eval failed"]));
say("A done: " + JSON.stringify(a));

// ---- B: pick the card, play, prologue → arrest → prison handoff ----
await evl(`document.querySelector('.origin-btn[data-origin="contract"]').click()`);
let playing = false;
for (let i = 0; i < 240 && !playing; i++) { playing = await evl("(() => { if (CBZ.game.state === 'playing') return true; const b = document.getElementById('playBtn'); if (b) b.click(); return CBZ.game.state === 'playing'; })()"); if (!playing) await sleep(200); }
if (!playing) { fails.push("contract run never reached playing"); finish(); }
say("contract run playing");

const b1 = await evl(`(() => {
  const out = { fails: [] }, g = CBZ.game;
  // settle the first frames so the reset wrap has staged the prologue
  for (let i = 0; i < 30; i++) CBZ.stepSim(1/60);
  if (g.cityOrigin !== "contract") out.fails.push("cityOrigin=" + g.cityOrigin);
  if (!CBZ.cityCampaignActive()) out.fails.push("campaign inactive on a contract run");
  const c = g.cityCampaign;
  out.phase = c && c.phase;
  if (!c || c.phase !== "prologue_drop") out.fails.push("phase=" + (c && c.phase));
  const m = CBZ.campaignUI && CBZ.campaignUI.state().mission;
  out.mission = m && m.id;
  if (!m || m.id !== "drop-point") out.fails.push("mission=" + (m && m.id));
  const P = CBZ.player;
  out.py = P && P.pos && Math.round(P.pos.y * 10) / 10;
  if (!P || !P.pos || P.pos.y < 6) out.fails.push("player not on a rooftop helipad (y=" + out.py + ")");
  let w = null;
  try { w = JSON.parse(localStorage.getItem("CBZ_CITY_WORLD_V2")); } catch (e) {}
  if (!w || w.origin !== "contract" || !w.originPlayed) out.fails.push("ledger origin not stamped contract");
  // drive the scripted rooftop beat well past the 9.4s arrest
  for (let i = 0; i < 720; i++) CBZ.stepSim(1/60);
  out.busted = !!g.busted;
  if (!g.busted) out.fails.push("rooftop arrest never landed after 12 sim-s");
  return out;
})()`);
fails.push(...(b1 && b1.fails || ["stage B1 eval failed"]));
say("B1 done: " + JSON.stringify(b1));

// the bust overlay's mode switch is a real 2.6s wall-clock setTimeout, and the
// prison world build takes a few seconds of real time after it fires
let inPrison = false;
for (let i = 0; i < 120 && !inPrison; i++) {
  inPrison = await evl("CBZ.game.mode === 'escape' && CBZ.game.state === 'playing'");
  if (!inPrison) await sleep(250);
}
if (!inPrison) fails.push("prison handoff never completed (mode=" + await evl("CBZ.game.mode") + ")");
else {
  const b2 = await evl(`(() => {
    const out = { fails: [] }, g = CBZ.game;
    for (let i = 0; i < 30; i++) CBZ.stepSim(1/60);
    if (!g._campaignEscape) out.fails.push("_campaignEscape not stamped");
    if (!CBZ.cityCampaignActive()) out.fails.push("campaign does not own its own prison chapter");
    const m = CBZ.campaignUI && CBZ.campaignUI.state().mission;
    out.mission = m && m.id;
    if (!m || m.id !== "the-offer") out.fails.push("prison mission=" + (m && m.id));
    return out;
  })()`);
  fails.push(...(b2 && b2.fails || ["stage B2 eval failed"]));
  say("B2 done: " + JSON.stringify(b2));
}

// ---- C: standalone Prison Escape is never hijacked ----
const c = await evl(`(() => {
  const out = { fails: [] }, g = CBZ.game;
  const hold = g._campaignEscape;
  g._campaignEscape = false;              // a run the campaign did not start
  if (CBZ.cityCampaignActive()) out.fails.push("campaign claims a standalone escape run");
  g._campaignEscape = hold;
  return out;
})()`);
fails.push(...(c && c.fails || ["stage C eval failed"]));
say("C done: " + JSON.stringify(c));

function finish() {
  try { chrome.kill(); } catch (_) {}
  try { server.kill(); } catch (_) {}
  if (fails.length) { console.error("CONTRACT: FAIL\n - " + fails.join("\n - ")); process.exit(1); }
  console.log("CONTRACT: ok");
  process.exit(0);
}
finish();
