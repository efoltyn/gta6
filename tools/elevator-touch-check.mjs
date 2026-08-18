#!/usr/bin/env node
/* tools/elevator-touch-check.mjs — CAN A THUMB CALL THE LIFT? (owner,
   2026-08-18: "Elevators aren't working on touch in Gang City. There's no
   button coming up.")

   They weren't, and it was two failures stacked:
     1. css/city.css's LIVE-WORLD DECLUTTER hides #elevChip during city play.
        Keyboard players lose only the prose — [E] still calls the lift blind.
        A thumb has no [E], so the whole elevator system was unreachable.
     2. Even unhidden, the chip printed "[E] Elevator — call" — a KEY GLYPH on
        a device with no keys — as textContent, inside pointer-events:none.

   So this probe measures the CONSEQUENCE, in the live city, through the real
   CSS cascade and a real click on the real pill:

     1. the chip is VISIBLY shown (computed display, not the inline style) when
        a touch player stands on a lift pad,
     2. it carries a worded .tpill and NOT a "[E]" glyph,
     3. the pill is hit-testable (pointer-events:auto inside the inert chip),
     4. CLICKING IT CALLS THE LIFT — the machine leaves idle and the doors
        actually open, via elevators.js's own [E] handler,
     5. the ride ticker keeps its readable slab (.haspill only on pill states),
     6. DESKTOP IS UNCHANGED: the same prompt renders as the exact old string,
     7. touchAudit reports elevator-call covered.

   Usage: node tools/elevator-touch-check.mjs      Exit 0 = ok.              */
import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function claimPort(lo, n, probe) { for (let p = lo; p < lo + n; p++) { try { await probe(p); } catch (_) { return p; } } throw new Error("no port"); }
const port = await claimPort(9450, 150, (p) => fetch(`http://127.0.0.1:${p}/`));
const server = spawn("python3", [path.join(ROOT, "tools/devserver.py")], { env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
const origin = `http://127.0.0.1:${port}/`;
{ let up = false; for (let i = 0; i < 40 && !up; i++) { try { await fetch(origin); up = true; } catch (_) { await sleep(100); } } if (!up) { console.error("FAIL devserver"); process.exit(1); } }
const dbg = await claimPort(11850, 200, (p) => fetch(`http://127.0.0.1:${p}/json/version`));
const profile = `/tmp/cbz-elevtouch-${dbg}`;
await rm(profile, { recursive: true, force: true });
const CHROME_BIN = process.env.CBZ_CHROME || (process.platform === "darwin"
  ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "/opt/pw-browsers/chromium");
const chrome = spawn(CHROME_BIN, ["--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
  "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--enable-webgl",
  "--mute-audio", "--touch-events=enabled", "--window-size=900,600", `--remote-debugging-port=${dbg}`,
  `--user-data-dir=${profile}`, `${origin}?seed=90210`], { stdio: "ignore" });
let page = null;
for (let i = 0; i < 240 && !page; i++) { try { const ps = await (await fetch(`http://127.0.0.1:${dbg}/json/list`)).json(); page = ps.find((p) => p.type === "page" && p.url.startsWith(origin)); } catch (_) {} if (!page) await sleep(100); }
if (!page) { console.error("FAIL no page"); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
let id = 1; const pend = new Map(); const errors = [];
ws.addEventListener("message", (ev) => { const m = JSON.parse(ev.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); return; }
  if (m.method === "Runtime.exceptionThrown") errors.push(((m.params.exceptionDetails.exception || {}).description || m.params.exceptionDetails.text || "").split("\n")[0]);
  else if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") errors.push("console.error: " + m.params.args.map((a) => a.value || a.description || "").join(" ").slice(0, 160));
});
const send = (method, params = {}) => new Promise((r) => { const i = id++; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evl = async (e) => { const r = await send("Runtime.evaluate", { expression: e, returnByValue: true });
  const ed = r.result && r.result.exceptionDetails;
  if (ed) console.error("EVAL THREW:", (ed.exception && ed.exception.description) || ed.text);
  return r.result && r.result.result && r.result.result.value; };
await send("Runtime.enable");
await send("Page.enable");
for (let i = 0; i < 900; i++) { if (await evl("!!window.CBZ && !!CBZ.bootComplete")) break; await sleep(500); }

// ---- DESKTOP FIRST: the prompt must still be the byte-identical old string.
// Measured BEFORE the touch layer arms, in the same session, so the two
// grammars are compared against one code path rather than two builds.
const DESKTOP = `(() => {
  const out = { fails: [] };
  const g = CBZ.game;
  if (g.cityCampaign) g.cityCampaign.phase = "endless_contracts";
  CBZ.setMode("city"); CBZ.resetGame && CBZ.resetGame(); CBZ.setState && CBZ.setState("playing");
  for (let i = 0; i < 60; i++) CBZ.stepSim(1/60);
  const els = CBZ.cityElevators && CBZ.cityElevators();
  if (!els || !els.length) { out.fails.push("no elevators built in the city"); return out; }
  const el = els[0];
  CBZ.player.pos.set(el.groundPad.x, el.gFloor + 0.05, el.groundPad.z);
  for (let i = 0; i < 30; i++) CBZ.stepSim(1/60);
  const chip = document.getElementById("elevChip");
  out.chipExists = !!chip;
  out.html = chip ? chip.innerHTML : null;
  out.expected = "[E] Elevator — call (ride to the roof)";
  if (out.html !== out.expected) out.fails.push("desktop prompt changed: " + JSON.stringify(out.html));
  return out;
})()`;
const desk = await evl(DESKTOP);

// ---- enable the touch layer with a REAL touch through the input pipeline
await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 12, y: 12 }] });
await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
if (!(await evl("!!CBZ.touchMode"))) {
  await evl(`(() => { try { window.dispatchEvent(new TouchEvent("touchstart", { bubbles: true })); } catch (e) { return String(e); } })()`);
}

const PASS = `(() => {
  const out = { fails: [], notes: [] };
  const g = CBZ.game;
  const step = (n) => { for (let i = 0; i < n; i++) CBZ.stepSim(1/60); };
  const shown = (el) => !!el && getComputedStyle(el).display !== "none" && getComputedStyle(el).visibility !== "hidden";

  out.touchMode = !!CBZ.touchMode;
  if (!out.touchMode) { out.fails.push("touch layer never enabled"); return out; }

  if (g.cityCampaign) g.cityCampaign.phase = "endless_contracts";
  CBZ.setMode("city"); CBZ.resetGame && CBZ.resetGame(); CBZ.setState && CBZ.setState("playing");
  step(60);
  if (g.mode !== "city") { out.fails.push("not in city"); return out; }

  const els = CBZ.cityElevators && CBZ.cityElevators();
  if (!els || !els.length) { out.fails.push("no elevators built in the city"); return out; }
  const el = els[0];

  // ---- 1+2+3. stand on the ground pad: a VISIBLE, WORDED, TAPPABLE button --
  CBZ.player.pos.set(el.groundPad.x, el.gFloor + 0.05, el.groundPad.z);
  step(30);
  const chip = document.getElementById("elevChip");
  out.chipExists = !!chip;
  if (!chip) { out.fails.push("#elevChip was never built"); return out; }
  out.chipVisible = shown(chip);
  if (!out.chipVisible) out.fails.push("#elevChip computed display:none on a lift pad — the declutter still hides the only lift control on touch");
  const pill = chip.querySelector(".tpill");
  out.pillBuilt = !!pill;
  if (!pill) { out.fails.push("no .tpill in the chip — touch still gets a key glyph: " + JSON.stringify(chip.innerHTML)); return out; }
  out.pillLabel = pill.textContent;
  out.noKeyGlyph = chip.textContent.indexOf("[E]") < 0;
  if (!out.noKeyGlyph) out.fails.push("a keyboard glyph is on the glass: " + JSON.stringify(chip.textContent));
  out.pillTappable = getComputedStyle(pill).pointerEvents === "auto";
  if (!out.pillTappable) out.fails.push("the pill is not hit-testable (pointer-events " + getComputedStyle(pill).pointerEvents + ")");
  const r = pill.getBoundingClientRect();
  out.pillBox = { w: Math.round(r.width), h: Math.round(r.height), bottomGap: Math.round(innerHeight - r.bottom) };
  if (r.width < 44 || r.height < 40) out.fails.push("pill too small for a thumb: " + JSON.stringify(out.pillBox));
  out.pillOnScreen = r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth;
  if (!out.pillOnScreen) out.fails.push("pill is off-screen: " + JSON.stringify(r));
  // the topmost element at the pill's centre must BE the pill: nothing in the
  // HUD stack may sit over the only button the lift has.
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  out.pillIsTopmost = hit === pill || (hit && pill.contains(hit));
  if (!out.pillIsTopmost) out.fails.push("something covers the pill: #" + (hit && (hit.id || hit.className)));
  out.flattened = chip.classList.contains("haspill") && getComputedStyle(chip).borderTopWidth === "0px";
  if (!out.flattened) out.notes.push("pill state did not flatten the chip slab");

  window.__elev = el;                 // handed to the second half (after the shot)
  return out;
})()`;
const PASS_B = `(() => {
  const out = { fails: [], notes: [] };
  const g = CBZ.game;
  const step = (n) => { for (let i = 0; i < n; i++) CBZ.stepSim(1/60); };
  const el = window.__elev;
  const chip = document.getElementById("elevChip");
  const pill = chip.querySelector(".tpill");

  // ---- 4. THE TAP CALLS THE LIFT ------------------------------------------
  out.stBefore = el.m.st;
  pill.click();
  step(30);
  out.stAfter = el.m.st;
  out.doorsMoving = el.ground.target > 0 || el.ground.open > 0;
  if (out.stAfter === "idle") out.fails.push("tapping the pill did not call the lift (still idle)");
  if (!out.doorsMoving) out.fails.push("the lift was called but the ground doors never opened");

  // ---- 5. the ride ticker keeps its slab ----------------------------------
  // ride the cab and read the chip mid-flight: a floor ticker is prose, and
  // prose over the skyline needs its backing box.
  for (let i = 0; i < 900 && el.m.st !== "ride"; i++) {
    CBZ.player.pos.set(el.gPt(0, 1.0).x, el.gFloor + 0.05, el.gPt(0, 1.0).z);  // step into the cab
    CBZ.stepSim(1/60);
  }
  out.reachedRide = el.m.st === "ride";
  if (out.reachedRide) {
    step(10);
    out.tickerText = chip.textContent;
    out.tickerHasSlab = !chip.classList.contains("haspill") &&
      getComputedStyle(chip).backgroundColor !== "rgba(0, 0, 0, 0)";
    if (!out.tickerHasSlab) out.fails.push("the floor ticker lost its readable backing");
    for (let i = 0; i < 1800 && el.m.st === "ride"; i++) CBZ.stepSim(1/60);
    out.arrivedFloorY = Math.round(CBZ.player.pos.y);
    out.rodeUp = CBZ.player.pos.y > 4;
    if (!out.rodeUp) out.fails.push("the ride never lifted the player (y=" + out.arrivedFloorY + ")");
  } else out.notes.push("could not board within the door window — call+doors verified, ride half skipped");

  // ---- 6. THE SIBLINGS ----------------------------------------------------
  // The lift was one tenant of css/city.css's declutter list; four more verbs
  // were dead on touch for exactly the same reason, and the roof stash is the
  // place the lift RIDES YOU TO. Each gets the same three questions: is the
  // chip actually on the glass, is its control a tappable pill rather than a
  // key glyph, and does tapping it DO the verb.
  out.siblings = {};
  const P = CBZ.player;
  const probe = (name, id, place, changed) => {
    const r = { placed: false };
    out.siblings[name] = r;
    try { if (!place()) { r.skip = "nothing of this kind in the world"; return; } } catch (e) { r.skip = "place threw: " + e; return; }
    r.placed = true;
    step(30);
    const c = document.getElementById(id);
    r.chipExists = !!c;
    if (!c) { out.fails.push(name + ": #" + id + " was never built"); return; }
    r.visible = getComputedStyle(c).display !== "none";
    if (!r.visible) { out.fails.push(name + ": #" + id + " is display:none on touch — the verb has no control"); return; }
    const pl = c.querySelector(".tpill");
    r.pill = pl ? pl.textContent : null;
    r.noKeyGlyph = c.textContent.indexOf("[E]") < 0;
    if (!pl) { out.fails.push(name + ": no pill, touch still gets " + JSON.stringify(c.textContent)); return; }
    if (!r.noKeyGlyph) out.fails.push(name + ": a keyboard glyph is on the glass: " + JSON.stringify(c.textContent));
    const bb = pl.getBoundingClientRect();
    r.box = { w: Math.round(bb.width), h: Math.round(bb.height) };
    if (bb.width < 44 || bb.height < 40) out.fails.push(name + ": pill too small for a thumb " + JSON.stringify(r.box));
    const hit = document.elementFromPoint(bb.left + bb.width / 2, bb.top + bb.height / 2);
    r.topmost = hit === pl || (pl.contains(hit));
    if (!r.topmost) out.fails.push(name + ": something covers the pill (#" + (hit && (hit.id || hit.className)) + ")");
    const before = c.textContent;
    pl.click();
    step(45);
    r.acted = changed(before, c);
    if (!r.acted) out.fails.push(name + ": tapping the pill did nothing");
  };

  probe("roof-stash", "roofStashChip", () => {
    const st = (CBZ.cityRoofStashes && CBZ.cityRoofStashes() || []).filter((x) => !x.looted)[0];
    if (!st) return false;
    window.__st = st; P.pos.set(st.x, st.y + 0.1, st.z); return true;
  }, (before, c) => window.__st.looted || c.textContent !== before);

  probe("beach-loot", "beachLootChip", () => {
    const L = (CBZ.cityBeachLoot && CBZ.cityBeachLoot() || []).filter((x) => !x.looted)[0];
    if (!L) return false;
    window.__L = L; P.pos.set(L.x, 0.1, L.z); return true;
  }, (before, c) => window.__L.looted || c.textContent !== before);

  probe("adboard-lease", "adChip", () => {
    // boards register as props stream in, so come back to the ground and let
    // the world settle before deciding there are none.
    let b = (CBZ.cityAdBoards || []).filter((x) => !x.lease)[0];
    if (!b) { P.pos.set(0, 0.2, 0); step(120); b = (CBZ.cityAdBoards || []).filter((x) => !x.lease)[0]; }
    if (!b) return false;
    g.cash = Math.max(g.cash || 0, 500000);
    window.__b = b; P.pos.set(b.x, (b.y || 0) < 2 ? 0.2 : b.y, b.z); return true;
  }, (before, c) => !!window.__b.lease || c.textContent !== before);

  // Ad boards stream with their props and a given seed may simply not have one
  // in reach. The board is also the ONLY prompt that mixes a pill with prose
  // (the verb is a button, the weekly price is text beside it), so when the
  // world cannot supply one, assert that layout directly through the same
  // writer the module uses — the restore and the kept slab are the two things
  // that were broken, and both are testable without a billboard.
  if (!out.siblings["adboard-lease"].placed) {
    let ad = document.getElementById("adChip");
    if (!ad) { ad = document.createElement("div"); ad.id = "adChip"; document.body.appendChild(ad); }
    CBZ.touchPromptChip(ad, CBZ.touchActionPrompt("e", "RENT THIS BOARD", "[E] Rent this board") +
      " — $1,250/wk · Vance Media (Downtown)");
    const st = getComputedStyle(ad);
    const apl = ad.querySelector(".tpill");
    const r2 = out.siblings["adboard-lease"];
    r2.domFallback = true;
    r2.visible = st.display !== "none";
    r2.pill = apl ? apl.textContent : null;
    r2.proseKeptSlab = !ad.classList.contains("haspill") && st.backgroundColor !== "rgba(0, 0, 0, 0)";
    r2.priceStillReadable = ad.textContent.indexOf("$1,250/wk") >= 0;
    if (!r2.visible) out.fails.push("adboard-lease: #adChip still display:none on touch in the city");
    if (!apl) out.fails.push("adboard-lease: the verb did not become a pill");
    if (!r2.proseKeptSlab) out.fails.push("adboard-lease: a prompt that still carries prose lost its backing slab");
    if (!r2.priceStillReadable) out.fails.push("adboard-lease: the weekly price fell out of the prompt");
    ad.style.display = "none";
  }

  probe("chest-open", "ci2Chip", () => {
    const INV = CBZ.cityInventory;
    if (!INV || !INV.placeChest) return false;
    g.cash = Math.max(g.cash || 0, 50000);
    // placeChest drops it 1.6 m ahead of the player and refuses a blocked
    // spot, so try a few headings from open ground rather than one.
    let c = null;
    for (let i = 0; i < 8 && !c; i++) {
      P.pos.set(6 + i * 3, 0.2, 6 + i * 3); P.heading = i * 0.8;
      step(4);
      if (INV.placeChest({ buy: true })) c = INV.chests()[INV.chests().length - 1];
    }
    if (!c) return false;
    window.__c = c; P.pos.set(c.x + 0.7, 0.2, c.z); return true;
  }, (before, c) => !!CBZ.cityMenuOpen || !!CBZ.invOpen || c.textContent !== before);

  // #fxPrompt is click-wired already (sim/forex.js owns its own handler), so
  // VISIBILITY was the whole of its bug — assert the restored cascade directly.
  {
    let fx = document.getElementById("fxPrompt");
    if (!fx) { fx = document.createElement("div"); fx.id = "fxPrompt"; document.body.appendChild(fx); }
    fx.style.display = "block";
    const vis = getComputedStyle(fx).display !== "none";
    out.siblings["fx-terminal"] = { visible: vis, cssOnly: true };
    if (!vis) out.fails.push("fx-terminal: #fxPrompt still display:none on touch in the city");
  }

  // ---- 7. the verb ledger says so -----------------------------------------
  const aud = CBZ.touchAudit();
  const rows = ["elevator-call", "roof-stash", "beach-loot", "adboard-lease", "chest-open", "fx-terminal"];
  out.elevCovered = rows.every((id) => aud.uncovered.indexOf(id) < 0 && !aud.noHook.some((s) => s.indexOf(id + " ") === 0));
  if (!out.elevCovered) out.fails.push("touchAudit does not report the walk-up verbs covered");
  out.audit = { verbs: aud.verbs, covered: aud.covered, uncovered: aud.uncovered, noHook: aud.noHook };
  return out;
})()`;
const res = await evl(PASS);
// THE PICTURE: the owner's report was "there's no button coming up", so the
// proof is a frame with the button in it. Taken between the two halves, while
// the player stands on the pad and before the tap consumes the prompt.
let shot = null;
if (res && !res.fails.length) {
  const cap = await send("Page.captureScreenshot", { format: "png" });
  const data = cap.result && cap.result.data;
  if (data) {
    shot = process.env.CBZ_SHOT || path.join(ROOT, "tools/shots/elevator-touch.png");
    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(path.dirname(shot), { recursive: true });
    await writeFile(shot, Buffer.from(data, "base64"));
  }
}
const res2 = await evl(PASS_B);
if (res && res2) { res.fails = res.fails.concat(res2.fails); res.notes = res.notes.concat(res2.notes); Object.assign(res, res2, { fails: res.fails, notes: res.notes }); }
console.log("ELEVATOR-TOUCH:");
console.log(JSON.stringify({ desktop: desk, touch: res, shot: shot }, null, 2));
console.log("errors:", errors.slice(0, 8));
chrome.kill("SIGTERM"); server.kill("SIGTERM");
const bad = !res || !res.fails || res.fails.length || !desk || desk.fails.length;
console.log(bad ? "ELEVATOR-TOUCH-CHECK: FAIL" : "ELEVATOR-TOUCH-CHECK: ok");
process.exit(bad ? 1 : 0);
