#!/usr/bin/env node
/* tools/c4-touch-check.mjs — CAN A THUMB USE THE C4? (owner, 2026-08-16:
   "I can't use c4 on touch — prison game, prob can't in gang city either")

   He couldn't, anywhere: plant AND detonate lived on keyboard [B] alone
   (city/explosives.js), and no touch file ever drew a control for either —
   the exact "keyboard verb with no thumb" failure touch.js's verb ledger was
   built to catch, except these two verbs were never even declared into it.

   The fix is one button and one pill, both of which drive explosives.js's OWN
   key handler by synthesizing its [B] edges (CBZ.touchKeyHold — the
   gamepad.js / touchKeyTap pattern), so this check measures CONSEQUENCES
   through that same seam, in the live game, in both games:

     1. #tbomb exists on a touch session, and hides until the verb can act.
     2. CITY: a tap PLANTS exactly one charge and spends exactly one brick.
     3. The 0.5 s arm is real: 0.33 s of hold detonates NOTHING (a brush of
        the glass must never send the street up), 0.7 s detonates ALL of it.
     4. THE GETAWAY BOOM: with a charge out, the DRIVE context builds the
        DETONATE pill and the same hold fires from the driver's seat.
     5. ESCAPE (the prison — where there is no phone and hold-[B] is the ONLY
        detonator): the same tap plants and the same hold detonates.
     6. touchAudit reports c4-plant / c4-detonate covered.

   Usage: node tools/c4-touch-check.mjs      Exit 0 = ok.                    */
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
const profile = `/tmp/cbz-c4touch-${dbg}`;
await rm(profile, { recursive: true, force: true });
const CHROME_BIN = process.env.CBZ_CHROME || (process.platform === "darwin"
  ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "/opt/pw-browsers/chromium");
const chrome = spawn(CHROME_BIN, ["--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
  "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--enable-webgl",
  "--mute-audio", "--touch-events=enabled", "--window-size=480,300", `--remote-debugging-port=${dbg}`,
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
for (let i = 0; i < 900; i++) { if (await evl("!!window.CBZ && !!CBZ.bootComplete")) break; await sleep(500); }

// ---- enable the touch layer with a REAL touch through the input pipeline
// (touch.js arms on the first touchstart; the in-page constructor is only the
// fallback for engines that refuse CDP touch).
await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 12, y: 12 }] });
await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
if (!(await evl("!!CBZ.touchMode"))) {
  await evl(`(() => { try { window.dispatchEvent(new TouchEvent("touchstart", { bubbles: true })); } catch (e) { return String(e); } })()`);
}

const PASS = `(() => {
  const out = { fails: [], notes: [] };
  const g = CBZ.game;
  const q = (i) => document.getElementById(i);
  const vis = (el) => !!el && el.style.display !== "none";
  const step = (n) => { for (let i = 0; i < n; i++) CBZ.stepSim(1/60); };
  const bag = () => CBZ.econ.itemStore();
  const kd = (d) => CBZ.touchKeyHold("b", d);
  const tap = () => { kd(true); kd(false); };

  out.touchMode = !!CBZ.touchMode;
  if (!out.touchMode) { out.fails.push("touch layer never enabled"); return out; }
  if (!CBZ.touchKeyHold) { out.fails.push("CBZ.touchKeyHold missing"); return out; }
  if (!CBZ.cityC4Planted || !CBZ.cityC4Count) { out.fails.push("explosives.js handles missing"); return out; }

  // ---- 1+2+3. CITY: button, tap-plants, armed hold ------------------------
  if (g.cityCampaign) g.cityCampaign.phase = "endless_contracts";
  CBZ.setMode("city"); CBZ.resetGame && CBZ.resetGame(); CBZ.setState && CBZ.setState("playing");
  step(40);
  if (g.mode !== "city") { out.fails.push("not in city"); return out; }

  const bomb = q("tbomb");
  out.buttonBuilt = !!bomb;
  if (!bomb) { out.fails.push("#tbomb was never built"); return out; }
  step(3);
  out.hiddenWithoutBricks = !vis(bomb);
  if (!out.hiddenWithoutBricks) out.fails.push("#tbomb visible with no bricks and nothing planted");

  bag().add("C4 Charge", 3);
  step(3);
  out.shownWithBricks = vis(bomb);
  if (!out.shownWithBricks) out.fails.push("#tbomb hidden while carrying bricks");

  tap(); step(6);
  out.cityPlanted = CBZ.cityC4Planted();
  if (out.cityPlanted !== 1) out.fails.push("city: a tap did not plant exactly one charge (" + out.cityPlanted + ")");
  out.cityBricksAfterPlant = CBZ.cityC4Count();
  if (out.cityBricksAfterPlant !== 2) out.fails.push("city: the plant did not spend exactly one brick (" + out.cityBricksAfterPlant + ")");
  step(3);
  out.armedTell = bomb.classList.contains("tarmed");
  if (!out.armedTell) out.fails.push("#tbomb not red (.tarmed) while a charge is out");

  kd(true); step(20);                      // 0.33 s held — must NOT have fired
  out.earlyStillOut = CBZ.cityC4Planted() === 1;
  if (!out.earlyStillOut) out.fails.push("city: detonated before the 0.5 s arm — a brush of the glass would send the street up");
  step(22); kd(false);                     // ~0.70 s total held
  step(30);                                // det-cord ripple
  out.cityDetonated = CBZ.cityC4Planted() === 0;
  if (!out.cityDetonated) out.fails.push("city: hold did not detonate (" + CBZ.cityC4Planted() + " still out)");
  out.cityBricksAfterBoom = CBZ.cityC4Count();
  if (out.cityBricksAfterBoom !== 2) out.fails.push("city: detonating spent a brick it should not have (" + out.cityBricksAfterBoom + ")");

  // ---- 4. THE GETAWAY BOOM ------------------------------------------------
  tap(); step(6);
  if (CBZ.cityC4Planted() !== 1) out.fails.push("city: second tap-plant failed");
  let car = null;
  for (const c of (CBZ.cityCars || [])) { if (c && !c.dead && !c.player && c.group && c.pos) { car = c; break; } }
  out.carFound = !!car;
  if (car && CBZ.cityEnterVehicle) {
    CBZ.player.pos.x = car.pos.x + 1.6; CBZ.player.pos.z = car.pos.z;
    // boarding.js wraps entry in a real walk-to-the-door arc — give it sim
    // time to play out. If SwiftShader physics wedges the walk, retry once
    // with the arc off (CAR_DOOR_ARC is boarding.js's own one-line revert):
    // the SEAT is what this probe needs, not the doorway choreography.
    CBZ.cityEnterVehicle(car);
    for (let w = 0; w < 480 && !CBZ.player.driving; w++) CBZ.stepSim(1/60);
    if (!CBZ.player.driving) {
      CBZ.CONFIG.CAR_DOOR_ARC = false;
      CBZ.player.pos.x = car.pos.x + 1.6; CBZ.player.pos.z = car.pos.z;
      CBZ.cityEnterVehicle(car);
      step(20);
      out.notes.push("boarding arc never seated — retried with CAR_DOOR_ARC=0");
    }
    out.driving = !!CBZ.player.driving;
    out.bombHiddenDriving = !vis(bomb);
    const vb = q("tvBoom");
    out.tvBoomBuilt = !!vb;
    out.tvBoomShown = vis(vb);
    if (out.driving) {
      if (!vb) out.fails.push("drive: #tvBoom never built");
      else if (!out.tvBoomShown) out.fails.push("drive: DETONATE pill hidden with a charge out");
      if (!out.bombHiddenDriving) out.fails.push("drive: on-foot #tbomb should stand down in the seat");
    } else out.notes.push("could not take the car — getaway pill only DOM-checked");
    kd(true); step(45); kd(false); step(30);
    out.getawayDetonated = CBZ.cityC4Planted() === 0;
    if (out.driving && !out.getawayDetonated) out.fails.push("drive: hold did not detonate from the driver's seat");
    if (CBZ.cityExitVehicle && CBZ.player.driving) CBZ.cityExitVehicle();
    step(4);
  } else {
    out.notes.push("no live car — getaway half skipped");
    kd(true); step(45); kd(false); step(30);   // clean the field either way
  }

  // ---- 5. ESCAPE — the prison, where hold-[B] is the ONLY detonator -------
  CBZ.setMode("escape"); CBZ.resetGame && CBZ.resetGame(); CBZ.setState && CBZ.setState("playing");
  step(40);
  if (g.mode !== "escape") { out.fails.push("not in escape"); return out; }
  out.escStartPlanted = CBZ.cityC4Planted();
  bag().add("C4 Charge", 2);
  step(3);
  out.escShown = vis(bomb);
  if (!out.escShown) out.fails.push("escape: #tbomb hidden while carrying a brick IN THE PRISON");
  tap(); step(6);
  out.escPlanted = CBZ.cityC4Planted();
  if (out.escPlanted !== 1) out.fails.push("escape: tap did not plant (" + out.escPlanted + ")");
  kd(true); step(45); kd(false); step(30);
  out.escDetonated = CBZ.cityC4Planted() === 0;
  if (!out.escDetonated) out.fails.push("escape: hold did not detonate in the pen (" + CBZ.cityC4Planted() + " still out)");

  // ---- 6. the verb ledger says so -----------------------------------------
  const aud = CBZ.touchAudit();
  out.c4Covered = aud.uncovered.indexOf("c4-plant") < 0 && aud.uncovered.indexOf("c4-detonate") < 0 &&
    !aud.noHook.some((s) => s.indexOf("c4-") === 0);
  if (!out.c4Covered) out.fails.push("touchAudit does not report the c4 verbs covered");
  out.audit = { verbs: aud.verbs, covered: aud.covered, uncovered: aud.uncovered, noHook: aud.noHook };
  return out;
})()`;
const res = await evl(PASS);
console.log("C4-TOUCH:");
console.log(JSON.stringify(res, null, 2));
console.log("errors:", errors.slice(0, 8));
chrome.kill("SIGTERM"); server.kill("SIGTERM");
const bad = !res || !res.fails || res.fails.length;
console.log(bad ? "C4-TOUCH-CHECK: FAIL" : "C4-TOUCH-CHECK: ok");
process.exit(bad ? 1 : 0);
