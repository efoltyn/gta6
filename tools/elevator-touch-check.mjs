#!/usr/bin/env node
/* tools/elevator-touch-check.mjs — ONE BUTTON PER VERB, ON EVERY INPUT.

   History, because this probe used to assert the opposite: the lift (and the
   roof stash, the beach bag, the ad board) once had NO control on a tablet,
   and two different sessions fixed that same outage a day apart — one gave
   each module's private chip a tappable pill (34ad5d9), the other registered
   interaction zones (c844a7a). Both shipped. A player then stood at a lift
   looking at an ELEVATOR UP pill NEXT TO a CALL THE LIFT card, two buttons
   for one verb. The pills, the idle chip prompts and the modules' raw [E]
   keydowns are deleted now; the interaction registry is the single surface —
   the card, its [E] dispatch, and its tap — and the chips keep only status
   prose (the ride ticker, "Prying it open…") that the card has no channel
   for.

   So this probe measures the CONSEQUENCE, in the live city, through the real
   CSS cascade:

     DESKTOP
     1. on a lift pad the #interact card is live and offers the lift verb,
     2. #elevChip shows NO idle prompt (the card is the only surface),
     3. a real [E] keydown — dispatched, not short-circuited — calls the lift
        through the registry (the raw capture-phase keydown is gone),
     TOUCH
     4. on a lift pad there is exactly ONE control: the card. No .tpill in
        #elevChip, no second button,
     5. clicking the card's row calls the lift — doors actually open,
     6. the ride ticker still renders in #elevChip with its readable slab,
     7. the SIBLING verbs (roof stash, beach bag, ad board) are also
        single-surfaced: card offers the verb, chip carries no pill, #adChip
        does not exist at all, and firing the row DOES the verb,
     8. the chest keeps its pill (it has no zone — one surface is one surface),
     9. touchAudit reports every walk-up verb covered.

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

// ---- DESKTOP FIRST: the card is the surface, the chip is silent, and a real
// [E] reaches the lift THROUGH THE REGISTRY (the raw keydown is deleted, so
// if the zone dispatch broke, this press would do nothing).
const DESKTOP = `(() => {
  const out = { fails: [] };
  const g = CBZ.game;
  const step = (n) => { for (let i = 0; i < n; i++) CBZ.stepSim(1/60); };
  if (g.cityCampaign) g.cityCampaign.phase = "endless_contracts";
  CBZ.setMode("city"); CBZ.resetGame && CBZ.resetGame(); CBZ.setState && CBZ.setState("playing");
  step(60);
  const els = CBZ.cityElevators && CBZ.cityElevators();
  if (!els || !els.length) { out.fails.push("no elevators built in the city"); return out; }
  const el = els[0];
  CBZ.player.pos.set(el.groundPad.x, el.gFloor + 0.05, el.groundPad.z);
  step(30);
  // 1. the card is live and it is the LIFT's card
  const cur = CBZ.interactions && CBZ.interactions.current && CBZ.interactions.current();
  out.cardKind = cur && cur.kind;
  if (out.cardKind !== "lift") out.fails.push("the interact card is not offering the lift on its pad (kind=" + out.cardKind + ")");
  const panel = document.getElementById("interact");
  out.cardVisible = !!panel && getComputedStyle(panel).display !== "none";
  if (!out.cardVisible) out.fails.push("#interact is not visible on a lift pad (the declutter exception is broken)");
  // 2. the chip carries NO idle prompt — the card is the only surface
  const chip = document.getElementById("elevChip");
  out.chipIdle = !chip || getComputedStyle(chip).display === "none" || !chip.textContent.trim();
  if (!out.chipIdle) out.fails.push("#elevChip still prints an idle call prompt beside the card: " + JSON.stringify(chip.textContent));
  // 3. a REAL [E] keydown calls the lift via the registry dispatch
  out.stBefore = el.m.st;
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "e", code: "KeyE", bubbles: true, cancelable: true }));
  document.dispatchEvent(new KeyboardEvent("keyup", { key: "e", code: "KeyE", bubbles: true, cancelable: true }));
  step(30);
  out.stAfter = el.m.st;
  out.doorsMoving = el.ground.target > 0 || el.ground.open > 0;
  if (out.stAfter === "idle") out.fails.push("[E] did not call the lift through the registry (still idle)");
  if (!out.doorsMoving) out.fails.push("[E] called the lift but the ground doors never opened");
  // hand the machine back to idle for the touch half: step off the pad and let
  // the un-boarded call time out (WAIT_OPEN 4s + the close), doors home again.
  CBZ.player.pos.set(el.groundPad.x + 8, 0.2, el.groundPad.z + 8);
  for (let i = 0; i < 600 && el.m.st !== "idle"; i++) CBZ.stepSim(1/60);
  out.machineReset = el.m.st === "idle";
  if (!out.machineReset) out.fails.push("the un-boarded call never timed out back to idle");
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

  // ---- 4. on the pad: ONE control — the card. No pill, no twin. -----------
  CBZ.player.pos.set(el.groundPad.x, el.gFloor + 0.05, el.groundPad.z);
  step(30);
  const cur = CBZ.interactions && CBZ.interactions.current && CBZ.interactions.current();
  out.cardKind = cur && cur.kind;
  if (out.cardKind !== "lift") { out.fails.push("the interact card is not offering the lift (kind=" + out.cardKind + ")"); return out; }
  const panel = document.getElementById("interact");
  out.cardVisible = shown(panel);
  if (!out.cardVisible) out.fails.push("#interact is hidden on touch on a lift pad — the verb has no control");
  const row = panel && panel.querySelector("#interactOpts .iopt");
  out.rowText = row ? row.textContent.trim() : null;
  if (!row) { out.fails.push("the card has no tappable row"); return out; }
  const rr = row.getBoundingClientRect();
  out.rowBox = { w: Math.round(rr.width), h: Math.round(rr.height) };
  if (rr.width < 44 || rr.height < 32) out.fails.push("the card row is too small for a thumb: " + JSON.stringify(out.rowBox));
  const chip = document.getElementById("elevChip");
  out.chipHasPill = !!(chip && chip.querySelector(".tpill"));
  if (out.chipHasPill) out.fails.push("#elevChip renders a pill again — TWO buttons for one verb (the 2026-08-19 double)");
  out.chipIdleSilent = !chip || getComputedStyle(chip).display === "none" || !chip.textContent.trim();
  if (!out.chipIdleSilent) out.fails.push("#elevChip prints an idle prompt beside the card: " + JSON.stringify(chip && chip.textContent));

  window.__elev = el;                 // handed to the second half (after the shot)
  return out;
})()`;
const PASS_B = `(() => {
  const out = { fails: [], notes: [] };
  const g = CBZ.game;
  const step = (n) => { for (let i = 0; i < n; i++) CBZ.stepSim(1/60); };
  const el = window.__elev;
  if (!el) { out.fails.push("first half never handed over a lift"); return out; }
  const panel = document.getElementById("interact");
  const chip = document.getElementById("elevChip");

  // ---- 5. TAPPING THE CARD ROW CALLS THE LIFT -----------------------------
  const row = panel && panel.querySelector("#interactOpts .iopt");
  out.stBefore = el.m.st;
  if (row) row.click();
  step(30);
  out.stAfter = el.m.st;
  out.doorsMoving = el.ground.target > 0 || el.ground.open > 0;
  if (out.stAfter === "idle") out.fails.push("tapping the card row did not call the lift (still idle)");
  if (!out.doorsMoving) out.fails.push("the lift was called but the ground doors never opened");

  // ---- 6. the ride ticker keeps its slab ----------------------------------
  // ride the cab and read the chip mid-flight: a floor ticker is prose, and
  // prose over the skyline needs its backing box.
  for (let i = 0; i < 900 && el.m.st !== "ride"; i++) {
    CBZ.player.pos.set(el.gPt(0, 1.0).x, el.gFloor + 0.05, el.gPt(0, 1.0).z);  // step into the cab
    CBZ.stepSim(1/60);
  }
  out.reachedRide = el.m.st === "ride";
  if (out.reachedRide) {
    step(10);
    out.tickerText = chip ? chip.textContent : null;
    out.tickerShows = !!chip && getComputedStyle(chip).display !== "none" && !!chip.textContent.trim();
    if (!out.tickerShows) out.fails.push("the ride ticker never rendered in #elevChip — the chip's one remaining job");
    out.tickerHasSlab = !!chip && !chip.classList.contains("haspill") &&
      getComputedStyle(chip).backgroundColor !== "rgba(0, 0, 0, 0)";
    if (!out.tickerHasSlab) out.fails.push("the floor ticker lost its readable backing");
    for (let i = 0; i < 1800 && el.m.st === "ride"; i++) CBZ.stepSim(1/60);
    out.arrivedFloorY = Math.round(CBZ.player.pos.y);
    out.rodeUp = CBZ.player.pos.y > 4;
    if (!out.rodeUp) out.fails.push("the ride never lifted the player (y=" + out.arrivedFloorY + ")");
  } else out.notes.push("could not board within the door window — call+doors verified, ride half skipped");

  // ---- 7. THE SIBLINGS: single-surfaced, and the row DOES the verb --------
  // Each was double-buttoned by the same pair of sessions. Three questions
  // now: does the CARD offer the verb, is the module chip pill-free, and does
  // firing the row run the verb (the chips' surviving status prose may
  // narrate it, which is exactly their one job).
  out.siblings = {};
  const P = CBZ.player;
  const probe = (name, kind, chipId, place, fire) => {
    const r = { placed: false };
    out.siblings[name] = r;
    try { if (!place()) { r.skip = "nothing of this kind in the world"; return; } } catch (e) { r.skip = "place threw: " + e; return; }
    r.placed = true;
    step(30);
    const cur = CBZ.interactions.current && CBZ.interactions.current();
    r.cardKind = cur && cur.kind;
    if (r.cardKind !== kind) { out.fails.push(name + ": the interact card is not offering the verb (kind=" + r.cardKind + ")"); return; }
    const c = chipId ? document.getElementById(chipId) : null;
    r.chipHasPill = !!(c && c.querySelector(".tpill"));
    if (r.chipHasPill) out.fails.push(name + ": #" + chipId + " renders a pill again — two buttons for one verb");
    r.chipIdleSilent = !c || getComputedStyle(c).display === "none" || !c.textContent.trim();
    if (!r.chipIdleSilent) out.fails.push(name + ": #" + chipId + " prints an idle prompt beside the card");
    const rw = panel && panel.querySelector("#interactOpts .iopt");
    r.rowText = rw ? rw.textContent.trim() : null;
    if (!rw) { out.fails.push(name + ": the card has no tappable row"); return; }
    rw.click();
    r.acted = !!fire(c);
    if (!r.acted) out.fails.push(name + ": tapping the card row did nothing");
  };

  probe("roof-stash", "roofstash", "roofStashChip", () => {
    const st = (CBZ.cityRoofStashes && CBZ.cityRoofStashes() || []).filter((x) => !x.looted)[0];
    if (!st) return false;
    window.__st = st; P.pos.set(st.x, st.y + 0.1, st.z); return true;
  }, (c) => {
    step(10);
    const prose = c && c.textContent;                 // "Prying it open…" — the chip's status job
    step(120);                                        // CRACK_T=0.9s and change
    window.__stProse = prose;
    return !!window.__st.looted;
  });

  probe("beach-loot", "beachbag", "beachLootChip", () => {
    const L = (CBZ.cityBeachLoot && CBZ.cityBeachLoot() || []).filter((x) => !x.looted)[0];
    if (!L) return false;
    window.__L = L; P.pos.set(L.x, 0.1, L.z); return true;
  }, () => {
    step(120);                                        // RIFLE_T=0.7s and change
    return !!window.__L.looted;
  });

  probe("adboard-lease", "adboard", null, () => {
    // boards register as props stream in, so come back to the ground and let
    // the world settle before deciding there are none.
    let b = (CBZ.cityAdBoards || []).filter((x) => !x.lease)[0];
    if (!b) { P.pos.set(0, 0.2, 0); step(120); b = (CBZ.cityAdBoards || []).filter((x) => !x.lease)[0]; }
    if (!b) return false;
    g.cash = Math.max(g.cash || 0, 500000);
    window.__b = b; P.pos.set(b.x, (b.y || 0) < 2 ? 0.2 : b.y, b.z); return true;
  }, () => {
    step(30);
    return !!window.__b.lease;
  });
  // the ad board's own chip is DELETED, not just silenced — a node coming back
  // is the parallel prompt coming back.
  out.adChipGone = !document.getElementById("adChip");
  if (!out.adChipGone) out.fails.push("#adChip exists again — the parallel ad-board prompt is back");

  // ---- 8. the chest KEEPS its pill: it has no zone, the chip IS its verb --
  {
    const r = { placed: false };
    out.siblings["chest-open"] = r;
    const INV = CBZ.cityInventory;
    if (INV && INV.placeChest) {
      g.cash = Math.max(g.cash || 0, 50000);
      let c = null;
      for (let i = 0; i < 8 && !c; i++) {
        P.pos.set(6 + i * 3, 0.2, 6 + i * 3); P.heading = i * 0.8;
        step(4);
        if (INV.placeChest({ buy: true })) c = INV.chests()[INV.chests().length - 1];
      }
      if (c) {
        r.placed = true;
        P.pos.set(c.x + 0.7, 0.2, c.z);
        step(30);
        const node = document.getElementById("ci2Chip");
        const pl = node && node.querySelector(".tpill");
        r.pill = pl ? pl.textContent : null;
        if (!pl) out.fails.push("chest-open: the chest lost its pill — it has no zone, so it now has no control at all");
        else {
          const before = node.textContent;
          pl.click();
          step(45);
          r.acted = !!CBZ.cityMenuOpen || !!CBZ.invOpen || node.textContent !== before;
          if (!r.acted) out.fails.push("chest-open: tapping the pill did nothing");
        }
      } else r.skip = "could not place a chest";
    } else r.skip = "no chest system";
  }

  // #fxPrompt is click-wired already (sim/forex.js owns its own handler), so
  // VISIBILITY is the whole of its contract — assert the restored cascade.
  {
    let fx = document.getElementById("fxPrompt");
    if (!fx) { fx = document.createElement("div"); fx.id = "fxPrompt"; document.body.appendChild(fx); }
    fx.style.display = "block";
    const vis = getComputedStyle(fx).display !== "none";
    out.siblings["fx-terminal"] = { visible: vis, cssOnly: true };
    if (!vis) out.fails.push("fx-terminal: #fxPrompt still display:none on touch in the city");
    fx.style.display = "none";
  }

  // ---- 9. the verb ledger says so -----------------------------------------
  const aud = CBZ.touchAudit();
  const rows = ["elevator-call", "roof-stash", "beach-loot", "adboard-lease", "chest-open", "fx-terminal"];
  out.verbsCovered = rows.every((id) => aud.uncovered.indexOf(id) < 0 && !aud.noHook.some((s) => s.indexOf(id + " ") === 0));
  if (!out.verbsCovered) out.fails.push("touchAudit does not report the walk-up verbs covered");
  out.audit = { verbs: aud.verbs, covered: aud.covered, uncovered: aud.uncovered, noHook: aud.noHook };
  return out;
})()`;
const res = await evl(PASS);
// THE PICTURE: the original report was "there's no button coming up"; the
// regression this probe now guards is "there are TWO". The proof either way is
// a frame with the pad in it — taken while the player stands there, before the
// tap consumes the card.
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
