#!/usr/bin/env node
/* tools/touch-keycap-check.mjs — NO KEYBOARD ⇒ NO KEY LEGEND, as a number.

   OWNER (2026-08-09, iPad, prison): the map "says keystrokes… like m to open
   map, space to clear way point. It's like what the fuck you're doing."

   Three sites shouted a key an iPad does not have, and two of them named the
   ONLY documented way to do the thing — so on a tablet they were not merely
   wrong, they were dead ends:

     index.html #fullMapClose      "Close [M]"
     index.html #fullMapClear      "[Space] clear waypoint"   ← only clear path
     index.html #fullMapPlaceHint  "Click or right-click to place a waypoint"
     index.html .waypoint-mapkey   "[M] map"                  ← only map path

   This gate boots the PRISON headless twice against the SAME page — once as a
   mouse, once as a finger — and scans the live DOM both times, because a
   keycap purge that also blanks the desktop legends is not a fix. It asserts:

     1. TOUCH: zero visible key legends across the map overlay + waypoint arrow.
        The scan is a regex over rendered text of every VISIBLE node, not a
        whitelist of the four ids above, so a fifth legend added later fails
        here instead of on an iPad.
     2. TOUCH: the clear-waypoint verb still EXISTS as a ≥44px tap target, and
        tapping it actually drops a live waypoint. Deleting the sentence without
        leaving a way to do the thing would pass rule 1 and be a worse bug.
     3. DESKTOP: the same four sites still read their key legends, and Space
        still clears — MAP_TOUCH_LABELS must not cost the keyboard anything.
     4. CBZ.CONFIG.MAP_TOUCH_LABELS = false restores the legends under touch,
        i.e. the flag is a real one-line revert.

   Numeric-only; never eyeball. Boot boilerplate from tools/prison-polish-check.mjs.
   Usage: node tools/touch-keycap-check.mjs
*/
import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 8830 + Math.floor(Math.random() * 40);
const server = spawn("python3", [path.join(ROOT, "tools/devserver.py")], { env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
const base = `http://127.0.0.1:${port}/`;
const dbg = 9830 + Math.floor(Math.random() * 40);
const profile = `/tmp/cbz-keycap-${dbg}`;
await rm(profile, { recursive: true, force: true });
await sleep(700);
const CHROME_BIN = process.env.CBZ_CHROME || (process.platform === "darwin"
  ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  : "/opt/pw-browsers/chromium");
const chrome = spawn(CHROME_BIN, [
  "--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
  "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
  "--enable-webgl", "--mute-audio", "--window-size=1440,900",
  `--remote-debugging-port=${dbg}`, `--user-data-dir=${profile}`, base,
], { stdio: "ignore" });

function done(code) { try { chrome.kill("SIGTERM"); } catch (_) {} try { server.kill("SIGTERM"); } catch (_) {} rm(profile, { recursive: true, force: true }).catch(() => {}); process.exit(code); }

let page = null;
for (let i = 0; i < 80 && !page; i++) {
  try { const ps = await (await fetch(`http://127.0.0.1:${dbg}/json/list`)).json(); page = ps.find((p) => p.type === "page" && p.url.startsWith(base)); } catch (_) {}
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
  else if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") { errors.push("console.error: " + m.params.args.map((a) => a.value || a.description || "").join(" ").slice(0, 200)); }
});
const send = (method, params = {}) => new Promise((r) => { const i = id++; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evl = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: `(function(){${expr}})()`, returnByValue: true });
  if (r.result && r.result.exceptionDetails) return { __err: r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description };
  return r.result && r.result.result && r.result.result.value;
};
await send("Runtime.enable"); await send("Page.enable");

for (let i = 0; i < 90; i++) { if (await evl("return !!(window.CBZ && CBZ.bootComplete && CBZ.game)")) break; await sleep(500); }
async function bootPrison(label) {
  for (let i = 0; i < 90; i++) { if (await evl("return !!(window.CBZ && CBZ.bootComplete && CBZ.game)")) break; await sleep(500); }
  let ok = false;
  for (let i = 0; i < 40 && !ok; i++) {
    await evl("try{CBZ.setMode('escape'); CBZ.startRun && CBZ.startRun();}catch(e){return String(e);} return true;");
    await sleep(500);
    ok = await evl("return !!(CBZ.game && CBZ.game.state==='playing' && CBZ.game.mode==='escape');");
  }
  console.log(`playing(escape, ${label}):`, ok);
  if (!ok) { console.log("ERRORS:", [...new Set(errors)].slice(0, 10)); done(2); }
}
await bootPrison("mouse");

const results = [];
function check(name, cond, detail) { results.push({ name, ok: !!cond, detail }); console.log((cond ? "  ok  " : "FAIL  ") + name + (detail != null ? "  " + detail : "")); }
function bad(r) { return !r || typeof r !== "object" || r.__err != null; }
function why(r) { return (r && r.__err) ? ("threw: " + String(r.__err).split("\n")[0]) : JSON.stringify(r); }
const step = (n) => evl(`for(var i=0;i<${n | 0};i++) CBZ.stepSim(1/60); return true;`);

/* THE SCANNER, shared by both passes. Walks the map overlay and the waypoint
   arrow, keeps only nodes that actually RENDER (display/visibility/opacity and
   a non-zero box — a hidden legend is not a legend), and matches:
     - a bracketed key cap:      [M]  [Space]  [Esc]  [WASD]
     - a bare mouse instruction: "right-click", "click or"
   "Click" alone is not enough — a tap IS a click event, and plenty of touch
   copy legitimately says tap. right-click is the one no finger can produce. */
const SCAN = `
  var KEYCAP = /\\[(?:[A-Za-z]|Space|Spacebar|Esc|Escape|Tab|Shift|Ctrl|Alt|Enter|Backspace|Delete|WASD|F\\d)\\]/;
  var MOUSE  = /right[- ]click/i;
  function shown(el){
    var s = getComputedStyle(el);
    if (s.display === "none" || s.visibility === "hidden" || +s.opacity === 0) return false;
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }
  function scan(rootSel){
    var root = document.querySelector(rootSel);
    var hits = [];
    if (!root) return hits;
    if (!shown(root)) return hits;
    var all = [root].concat([].slice.call(root.querySelectorAll("*")));
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (!shown(el)) continue;
      // own text only, so a hit is reported once at the node that renders it
      var own = "";
      for (var j = 0; j < el.childNodes.length; j++)
        if (el.childNodes[j].nodeType === 3) own += el.childNodes[j].nodeValue;
      own = own.replace(/\\s+/g, " ").trim();
      if (!own) continue;
      if (KEYCAP.test(own) || MOUSE.test(own))
        hits.push((el.id ? "#" + el.id : el.tagName.toLowerCase() + (el.className ? "." + String(el.className).split(" ")[0] : "")) + ": " + own);
    }
    return hits;
  }
`;

// A waypoint has to exist for the arrow (and its "[M] map" tail) to render.
const SET_WP = `CBZ.fullMap.points.escape = { x: CBZ.player.pos.x + 30, z: CBZ.player.pos.z + 30, label: "probe" };`;

// ---- 3. DESKTOP FIRST — the legends must be THERE before we claim to hide them
{
  await evl(`CBZ.fullMap.open ? CBZ.fullMap.open() : CBZ.fullMap.toggle(); ${SET_WP} return true;`);
  await step(30);
  const r = await evl(`${SCAN}
    var wpVis = getComputedStyle(document.querySelector("#waypointGuide .waypoint-mapkey")).display;
    return {
      touchMode: !!CBZ.touchMode,
      close: (document.getElementById("fullMapClose")||{}).textContent,
      clear: (document.getElementById("fullMapClear")||{}).textContent,
      place: (document.getElementById("fullMapPlaceHint")||{}).textContent,
      tail: (document.querySelector("#waypointGuide .waypoint-mapkey")||{}).textContent,
      tailDisplay: wpVis,
      hits: scan("#fullMap").length,
    };`);
  if (bad(r)) check("desktop: map reads", false, why(r));
  else {
    check("desktop: is not in touch mode", r.touchMode === false, "touchMode=" + r.touchMode);
    check("desktop: keeps every key legend", /\[M\]/.test(r.close) && /\[Space\]/.test(r.clear) && /right-click/.test(r.place) && /\[M\]/.test(r.tail),
      JSON.stringify({ close: r.close, clear: r.clear, place: r.place, tail: r.tail }));
    check("desktop: the scanner can SEE them (guards a dead scan)", r.hits >= 2, "hits=" + r.hits);
  }
  // Space still clears, unchanged: the footer chip is an extra route, not a swap.
  const s = await evl(`
    ${SET_WP}
    var e = new KeyboardEvent("keydown", { key: " ", code: "Space", bubbles: true });
    window.dispatchEvent(e);
    return { wp: !!CBZ.fullMap.points.escape };`);
  check("desktop: Space still clears the waypoint", !bad(s) && s.wp === false, why(s));
  // ...and the title briefing is still the keyboard one. The touch twin must
  // never leak onto a mouse: two control grids on one card teaches nothing.
  const b = await evl(`
    var kbd = document.querySelector(".mode-escape-only .controls .keys-kbd");
    var tch = document.querySelector(".mode-escape-only .controls .keys-touch");
    return { kbd: getComputedStyle(kbd).display, tch: getComputedStyle(tch).display,
             caps: kbd.querySelectorAll(".kbd").length };`);
  // 10 caps across 9 rows — "F / R" is one row carrying two.
  check("desktop: the briefing is the keyboard grid, alone", !bad(b) && b.kbd !== "none" && b.tch === "none" && b.caps === 10, why(b));
}

// ---- 1+2. TOUCH ------------------------------------------------------------
/* A REAL iPad, not a stamped flag. touch.js's enable() is closed over, and
   half of what we are checking (the 44 px tap target) lives in an
   `@media (pointer: coarse)` block that no amount of CBZ.touchMode reaches.
   So: emulate the device and RELOAD, which makes touch.js's own
   `matchMedia("(pointer: coarse)")` line fire enable() for real, exactly as it
   does on the owner's iPad. 1180x820 is the iPad Air landscape viewport. */
await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
await send("Emulation.setDeviceMetricsOverride", { width: 1180, height: 820, deviceScaleFactor: 2, mobile: true });
await send("Page.reload", { ignoreCache: false });
await sleep(1500);
await bootPrison("iPad");
{
  const coarse = await evl(`return { coarse: matchMedia("(pointer: coarse)").matches, touchMode: !!CBZ.touchMode, cls: document.body.classList.contains("touch") };`);
  check("touch: the page really is a coarse-pointer device", !bad(coarse) && coarse.coarse === true && coarse.touchMode === true && coarse.cls === true, why(coarse));
}
{
  await evl(`if (!CBZ.fullMap.active) CBZ.fullMap.toggle(); ${SET_WP} return true;`);
  await step(30);
  const r = await evl(`${SCAN}
    return {
      close: (document.getElementById("fullMapClose")||{}).textContent,
      clear: (document.getElementById("fullMapClear")||{}).textContent,
      place: (document.getElementById("fullMapPlaceHint")||{}).textContent,
      tailShown: getComputedStyle(document.querySelector("#waypointGuide .waypoint-mapkey")).display !== "none",
      mapHits: scan("#fullMap"),
      guideHits: scan("#waypointGuide"),
    };`);
  if (bad(r)) check("touch: map reads", false, why(r));
  else {
    check("touch: ZERO key legends on the map overlay", r.mapHits.length === 0, JSON.stringify(r.mapHits));
    check("touch: ZERO key legends on the waypoint arrow", r.guideHits.length === 0 && r.tailShown === false, JSON.stringify({ hits: r.guideHits, tailShown: r.tailShown }));
    check("touch: the three map sites carry WORDS", /Close/.test(r.close) && /Clear waypoint/.test(r.clear) && /Tap the map/.test(r.place),
      JSON.stringify({ close: r.close, clear: r.clear, place: r.place }));
  }
  // The verb has to survive the purge, as a real tap target on a real handler.
  const t = await evl(`
    ${SET_WP}
    CBZ.fullMap.clearWaypoint && CBZ.fullMap.keycaps && CBZ.fullMap.keycaps();
    var b = document.getElementById("fullMapClear");
    var box = b ? b.getBoundingClientRect() : { width: 0, height: 0 };
    var before = !!CBZ.fullMap.points.escape;
    if (b) b.click();
    return { w: +box.width.toFixed(1), h: +box.height.toFixed(1), before: before, after: !!CBZ.fullMap.points.escape };`);
  if (bad(t)) check("touch: clear chip reads", false, why(t));
  else {
    check("touch: tapping the chip clears the waypoint", t.before === true && t.after === false, JSON.stringify(t));
    // 44px is Apple's HIG minimum and the number mobile.css already uses for
    // #fullMapClose / #interactOpts .iopt — same bar, not a new one.
    check("touch: the chip is a 44px tap target", t.h >= 44 && t.w >= 44, `${t.w}x${t.h}`);
  }
}

// ---- 5. THE OTHER THREE PRISON SITES ---------------------------------------
/* Found by sweeping the escape-mode HUD for the same fault, not by the owner
   hitting each one: the map was simply the one he was looking at. */
{
  // (a) THE YARD RANKINGS panel. #dashBtn is a tap target and city.css only
  //     hides it in the CITY, so a finger opens this in the prison — where its
  //     header named Tab, L and Esc, and Esc was the only close it offered.
  const r = await evl(`${SCAN}
    CBZ.ui.dashboard = true; CBZ.ui.dashTab = 0;
    CBZ.renderDashboard();
    return true;`);
  await step(30);
  const d = await evl(`${SCAN}
    var close = document.querySelector("#dashboard .dclose");
    var box = close ? close.getBoundingClientRect() : { width: 0, height: 0 };
    // read the OPEN state and scan BEFORE the click — the click is the last
    // thing this eval does, and it is what the next field asserts.
    var out = { shown: document.getElementById("dashboard").classList.contains("show"),
                hits: scan("#dashboard"), hasClose: !!close, wasOpen: !!CBZ.ui.dashboard,
                w: +box.width.toFixed(1), h: +box.height.toFixed(1) };
    if (close) close.click();
    out.closed = !CBZ.ui.dashboard;
    return out;`);
  if (bad(d)) check("rankings: panel reads", false, why(d));
  else {
    check("rankings: the panel is actually up", d.shown === true && d.wasOpen === true, JSON.stringify({ shown: d.shown, open: d.wasOpen }));
    check("rankings: ZERO key legends in the header", d.hits.length === 0, JSON.stringify(d.hits));
    check("rankings: a ✕ closes it, 44px", d.hasClose === true && d.h >= 44 && d.w >= 44 && d.closed === true, JSON.stringify({ close: d.hasClose, size: d.w + "x" + d.h, closed: d.closed }));
  }
}
{
  /* (b) THE ARMORY CAGE padlock. The pill raised right above it already says
     "Saw the padlock"; the sentence beside it said "Hold [E]", so on touch you
     got the words AND the key cap. Reaching that hint live would mean putting a
     Hacksaw Blade in the yard, walking the player to the inner cage and holding
     a poll for a frame — so this one is asserted STATICALLY, and says so: the
     claim is that no "[E]" reaches tellHint on a path where the pill is up. */
  const src = await (await import("node:fs/promises")).readFile(path.join(ROOT, "src/world/gunroom.js"), "utf8");
  const guarded = /const pilled = saw && CBZ\.touchMode && CBZ\.prisonPrompt;[\s\S]{0,400}?pilled \?[\s\S]{0,120}?: "Padlocked\. Hold \[E\]/.test(src);
  // Every UNCONDITIONAL hint in the file — first argument a plain literal, so
  // the guarded ternary above is skipped by construction — must be key-free.
  const flat = (src.match(/(?:tellHint|flashHint)\(\s*"([^"]*)"/g) || []).map((s) => s.slice(s.indexOf('"') + 1, -1));
  const strays = flat.filter((s) => /\[[A-Za-z]+\]|\bQ\/wheel\b|\bWASD\b|\bpress [A-Z]\b/.test(s));
  check("cage (static): the [E] sentence is behind the pill guard", guarded, "guarded=" + guarded);
  check("cage (static): no unconditional hint carries a key cap", strays.length === 0, JSON.stringify(strays) + ` of ${flat.length}`);
}
{
  // (c) THE TITLE BRIEFING. Back to the title so the card is on screen.
  await evl(`CBZ.setMode && CBZ.setMode("escape"); CBZ.game.state = "title";
    document.body.classList.remove("state-playing"); return true;`);
  const c = await evl(`${SCAN}
    var wrap = document.querySelector(".mode-escape-only .controls");
    var det = wrap ? wrap.querySelector("details") || wrap : null;
    if (wrap && wrap.tagName === "DETAILS") wrap.open = true;
    var kbd = document.querySelector(".mode-escape-only .controls .keys-kbd");
    var tch = document.querySelector(".mode-escape-only .controls .keys-touch");
    return {
      kbdShown: kbd ? getComputedStyle(kbd).display !== "none" : null,
      tchShown: tch ? getComputedStyle(tch).display !== "none" : null,
      caps: tch ? [].slice.call(tch.querySelectorAll(".tcap")).map(function(e){ return e.textContent; }) : null,
      hits: scan(".mode-escape-only .controls"),
    };`);
  if (bad(c)) check("briefing: card reads", false, why(c));
  else {
    check("briefing: the keyboard grid is gone on touch", c.kbdShown === false, "kbdShown=" + c.kbdShown);
    check("briefing: the touch grid is up instead", c.tchShown === true && c.caps && c.caps.length >= 6, JSON.stringify(c.caps));
    check("briefing: ZERO key legends on the card", c.hits.length === 0, JSON.stringify(c.hits));
  }
}

// ---- 4. THE FLAG IS A REAL REVERT ------------------------------------------
{
  const r = await evl(`
    CBZ.CONFIG.MAP_TOUCH_LABELS = false;
    CBZ.fullMap.keycaps();
    var out = {
      close: (document.getElementById("fullMapClose")||{}).textContent,
      clear: (document.getElementById("fullMapClear")||{}).textContent,
    };
    CBZ.CONFIG.MAP_TOUCH_LABELS = true;   // leave the page as we found it
    return out;`);
  // keycaps() yields entirely when off, so whatever the page last wrote stands —
  // the assertion is that it stops REWRITING, i.e. no touch text is forced back.
  check("flag: MAP_TOUCH_LABELS=false stops the rewrite", !bad(r) && !/Tap the map/.test(String(r.clear)), why(r));
}

const failed = results.filter((r) => !r.ok);
console.log("\n" + (results.length - failed.length) + "/" + results.length + " checks passed");
if (errors.length) console.log("page errors:", [...new Set(errors)].slice(0, 6));
done(failed.length ? 1 : 0);
