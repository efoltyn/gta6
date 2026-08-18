#!/usr/bin/env node
/* tools/prison-hud-bar-check.mjs — the ONE-BAR-ON-GLASS gate (2026-08-16).

   Two owner reports off one landscape-phone screenshot, both asserted as
   numbers against the live DOM, never as pixels:

     1. THE BAR IS THE INVENTORY. The touch BAG button is GONE — no
        #invBagBtn anywhere — and escape item cells surface on PICKUP
        instead of hiding behind a stash screen: an empty bar shows zero
        item cells, granting the Keycard surfaces exactly one (with the
        .filled stamp), spending it takes the cell back off the glass.
     2. NO BUTTON PRINTS ON ANOTHER. On a short viewport (the landscape
        phone regime, max-height:560px) the armed cluster wraps into a
        second column, and the .tslide absolute seat used to park AIM in
        that column's strip of glass — on the owner's iPhone, ON TOP of
        SWAP (WebKit never widens a wrapped column flex container's box,
        so the spill renders exactly where right:calc(100%+12px) points;
        Chromium widens the box and instead strands AIM out past the
        cluster). The fix rejoins AIM/SCOPE to the flow there, which no
        engine can misplace — so the gate asserts the invariant itself:
        computed position must be STATIC in the wrap regime, armed with
        enough guns that every situational button is up there must be zero
        overlap between any visible pair, and every control must be on the
        glass. (Headless Chromium cannot reproduce the WebKit print-through
        directly; static-in-flow is the property that makes both engines'
        geometry safe by construction.)

   Boot boilerplate from tools/prison-polish-check.mjs (itself math-gate's),
   plus CDP touch/metrics emulation so body.touch is stamped the way a real
   phone stamps it (pointer:coarse at load), not by poking classes in.
*/
import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 8930 + Math.floor(Math.random() * 40);
const server = spawn("python3", [path.join(ROOT, "tools/devserver.py")], { env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
const base = `http://127.0.0.1:${port}/`;
const dbg = 9930 + Math.floor(Math.random() * 40);
const profile = `/tmp/cbz-hudbar-${dbg}`;
await rm(profile, { recursive: true, force: true });
await sleep(700);
const CHROME_BIN = process.env.CBZ_CHROME || (process.platform === "darwin"
  ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  : "/opt/pw-browsers/chromium");
const chrome = spawn(CHROME_BIN, [
  "--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
  "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
  "--enable-webgl", "--mute-audio", "--window-size=820,380",
  `--remote-debugging-port=${dbg}`, `--user-data-dir=${profile}`, "about:blank",
], { stdio: "ignore" });

function done(code) { try { chrome.kill("SIGTERM"); } catch (_) {} try { server.kill("SIGTERM"); } catch (_) {} rm(profile, { recursive: true, force: true }).catch(() => {}); process.exit(code); }

let page = null;
for (let i = 0; i < 80 && !page; i++) {
  try { const ps = await (await fetch(`http://127.0.0.1:${dbg}/json/list`)).json(); page = ps.find((p) => p.type === "page"); } catch (_) {}
  if (!page) await sleep(250);
}
if (!page) { console.error("FAIL: no page"); done(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
let id = 1; const pending = new Map(); const errors = [];
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === "Runtime.exceptionThrown") { const d = m.params.exceptionDetails; errors.push(`${d.url || "?"}:${d.lineNumber} ${(d.exception && d.exception.description || d.text || "").split("\n")[0]}`); }
});
const send = (method, params = {}) => new Promise((r) => { const i = id++; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evl = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: `(function(){${expr}})()`, returnByValue: true });
  if (r.result && r.result.exceptionDetails) return { __err: r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description };
  return r.result && r.result.result && r.result.result.value;
};
await send("Runtime.enable"); await send("Page.enable");

// THE PHONE, BEFORE THE GAME: pointer:coarse and the 800x320 landscape glass
// (short enough that the wrap regime spills past SWAP — the collision-prone
// arrangement) must be true when touch.js loads; that is when it self-enables.
await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
await send("Emulation.setEmitTouchEventsForMouse", { enabled: true, configuration: "mobile" });
await send("Emulation.setDeviceMetricsOverride", { width: 800, height: 320, deviceScaleFactor: 2, mobile: true });
await send("Page.navigate", { url: base });

const results = [];
function check(name, ok, detail) { results.push({ name, ok }); console.log(`  ${ok ? "ok " : "FAIL"} ${name}${detail ? "  " + detail : ""}`); }
const bad = (r) => r && r.__err;
const why = (r) => (r && r.__err) || "";

for (let i = 0; i < 90; i++) { if (await evl("return !!(window.CBZ && CBZ.bootComplete && CBZ.game)")) break; await sleep(500); }
let playing = false;
for (let i = 0; i < 40 && !playing; i++) {
  await evl("try{CBZ.setMode('escape'); CBZ.startRun && CBZ.startRun();}catch(e){return String(e);} return true;");
  await sleep(400);
  playing = await evl("return !!(CBZ.game.state==='playing' && CBZ.game.mode==='escape');");
}
check("boot: escape runs on the emulated phone", playing);
if (!playing) done(1);
await sleep(800);

// ---- 1. THE BAR IS THE INVENTORY ------------------------------------------
{
  const r = await evl(`
    var vis = function(el){ return !!el && getComputedStyle(el).display !== "none"; };
    var bar = document.getElementById("hotbar");
    var cells = Array.prototype.slice.call(bar ? bar.querySelectorAll(":scope > .islot") : []);
    var count = function(){ var v=0,f=0; cells.forEach(function(c){ if (vis(c)) v++; if (c.classList.contains("filled")) f++; }); return {v:v,f:f}; };
    var out = { touch: document.body.classList.contains("touch"),
      unified: document.body.classList.contains("jail-hud-unified"),
      bag: !!document.getElementById("invBagBtn"),
      barShown: vis(bar), cells: cells.length, empty: count() };
    try { CBZ.econ.addItem("Keycard", 1); } catch (e) { out.grantErr = String(e); }
    out.afterGrant = count();
    var kc = cells.filter(function(c){ return vis(c) && c.textContent.indexOf("Keycard") >= 0; }).length;
    out.keycardCellShown = kc;
    try { CBZ.econ.takeItem("Keycard"); } catch (e) { out.takeErr = String(e); }
    out.afterSpend = count();
    return out;
  `);
  if (bad(r)) check("bar: probe evaluates", false, why(r));
  else {
    check("bar: this is a touch session on the unified jail bar", r.touch === true && r.unified === true, JSON.stringify({ touch: r.touch, unified: r.unified }));
    check("bar: the BAG button does not exist", r.bag === false);
    check("bar: hotbar is on the glass with its nine cells built", r.barShown === true && r.cells === 9, JSON.stringify({ shown: r.barShown, cells: r.cells }));
    check("bar: an empty bag shows ZERO item cells", r.empty && r.empty.v === 0, JSON.stringify(r.empty));
    check("bar: the keycard pickup SURFACES its cell", r.afterGrant && r.afterGrant.v === 1 && r.afterGrant.f === 1 && r.keycardCellShown === 1, JSON.stringify({ after: r.afterGrant, keycard: r.keycardCellShown }));
    check("bar: spending it takes the cell back off", r.afterSpend && r.afterSpend.v === 0, JSON.stringify(r.afterSpend));
  }
}

// ---- 2. NO BUTTON PRINTS ON ANOTHER ---------------------------------------
{
  // arm to the teeth so every situational control is up: swap/reload (any
  // gun), aim (fpsSetAim), scope (sniper). First person so the armed check
  // reads ownership the way the screenshot session did.
  const r = await evl(`
    ["sidearm","smg","shotgun","sniper"].forEach(function(w){ try { CBZ.unlockWeapon(w, { select: true }); } catch (e) {} });
    if (CBZ.fps && !CBZ.fps.active && CBZ.toggleFPS) { try { CBZ.toggleFPS(); } catch (e) {} }
    return { guns: (CBZ.weaponInventory||[]).length, fp: !!(CBZ.fps && CBZ.fps.active) };
  `);
  await sleep(700);   // two onAlways(98) passes so visibility settles
  const c = await evl(`
    var ids = ["tfire","tjump","tview","tswap","treload","taim","tscope","thoming","trecen"];
    var vis = [], hid = [];
    ids.forEach(function(i){ var el = document.getElementById(i); if (!el) { hid.push(i); return; }
      var cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") { hid.push(i); return; }
      var b = el.getBoundingClientRect();
      vis.push({ id: i, l: b.left, t: b.top, r: b.right, b2: b.bottom }); });
    var laps = [];
    for (var a = 0; a < vis.length; a++) for (var b = a + 1; b < vis.length; b++) {
      var A = vis[a], B = vis[b];
      var w = Math.min(A.r, B.r) - Math.max(A.l, B.l), h = Math.min(A.b2, B.b2) - Math.max(A.t, B.t);
      if (w > 1 && h > 1) laps.push(A.id + "+" + B.id + "=" + Math.round(w) + "x" + Math.round(h));
    }
    var off = vis.filter(function(v){ return v.l < 0 || v.t < 0 || v.r > innerWidth || v.b2 > innerHeight; }).map(function(v){ return v.id; });
    var aim = document.getElementById("taim");
    return { view: innerWidth + "x" + innerHeight, shown: vis.map(function(v){ return v.id; }), hidden: hid,
      overlaps: laps, offGlass: off,
      aimStatic: aim ? getComputedStyle(aim).position : null,
      wrapped: (function(){ var xs = {}; vis.forEach(function(v){ xs[Math.round(v.l/8)] = 1; }); return Object.keys(xs).length > 1; })() };
  `);
  if (bad(r) || bad(c)) check("cluster: probe evaluates", false, why(r) + why(c));
  else {
    check("cluster: armed with a scope rung, first person", r.guns >= 4 && r.fp === true, JSON.stringify(r));
    check("cluster: AIM and SWAP are both on the glass", c.shown.indexOf("taim") >= 0 && c.shown.indexOf("tswap") >= 0, JSON.stringify({ shown: c.shown, hidden: c.hidden }));
    check("cluster: short viewport wraps AND aim rejoins the flow", c.wrapped === true && c.aimStatic === "static", JSON.stringify({ wrapped: c.wrapped, aim: c.aimStatic }));
    check("cluster: ZERO overlapping button pairs", c.overlaps.length === 0, JSON.stringify(c.overlaps));
    check("cluster: every control fits the glass", c.offGlass.length === 0, JSON.stringify(c.offGlass));
  }
}

const failed = results.filter((r) => !r.ok);
console.log("");
console.log(`PRISON-HUD-BAR: ${results.length - failed.length}/${results.length} ok`);
if (failed.length) { console.log("FAILED: " + failed.map((f) => f.name).join(" | ")); done(1); }
console.log("PRISON-HUD-BAR: ok");
done(0);
