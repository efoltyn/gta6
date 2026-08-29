#!/usr/bin/env node
/* tools/boat-walk-check.mjs — THE WHEEL IS A PLACE YOU CAN LEAVE AND COME
   BACK TO, AND THE CAMERA KNOWS HOW BIG THE BOAT IS.

   OWNER (2026-08-19): "zoom out a [ton] when driving a Big Boat", "be able to
   do first person", "not drive and get up and walk around — jump button when
   seated is get up".

   One engine boot (captain origin, the trawler — a crewed hull with a real
   walkable deck), then the whole loop a player would drive, in order:

     1. CHASE FRAMING SCALES WITH LOA — systems/camera.js reads _hullSpec, so
        the 18 m trawler must frame at ~20.9 m back / ~10.7 m up (the runabout
        keeps the old 9.5/10 exactly — asserted statically off the formula's
        floors). Plus a registry-wide audit: every hull's helm station lands
        ON its own hull (the captainFitAudit lesson: eleven boats is eleven
        chances to put an eye in the sea).
     2. [V] AT THE WHEEL — carFpToggle answers a hull now; the camera must
        actually sit at the hull's helm station next frame.
     3. SPACE = GET UP — the jump key stands you up out of the seat onto the
        wheelhouse sole (driving false, feet at deck height, NOT swimming).
     4. STEP BACK TO THE WHEEL — the boatwalk zone's card offers "Take the
        helm" right where you stand, and pressing [E] seats you again.

   Usage: node tools/boat-walk-check.mjs            Exit 0 = ok.             */
import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const SEED = "talloran";

async function claimPort(lo, n, probe) {
  for (let p = lo; p < lo + n; p++) { try { await probe(p); } catch (_) { return p; } }
  throw new Error("no free port");
}
const port = await claimPort(9660, 150, (p) => fetch(`http://127.0.0.1:${p}/`));
const server = spawn("python3", [path.join(ROOT, "tools/devserver.py")],
  { env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
const origin = `http://127.0.0.1:${port}/`;
{
  let up = false;
  for (let i = 0; i < 40 && !up; i++) { try { await fetch(origin); up = true; } catch (_) { await sleep(100); } }
  if (!up) { console.error("BOATWALK: FAIL devserver never came up"); process.exit(1); }
}

const dbg = await claimPort(11360, 200, (p) => fetch(`http://127.0.0.1:${p}/json/version`));
const profile = `/tmp/cbz-boatwalk-${dbg}`;
await rm(profile, { recursive: true, force: true });
const CHROME_BIN = process.env.CBZ_CHROME || (process.platform === "darwin"
  ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "/opt/pw-browsers/chromium");
const chrome = spawn(CHROME_BIN, [
  "--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
  "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
  "--enable-webgl", "--mute-audio", "--window-size=1000,700",
  `--remote-debugging-port=${dbg}`, `--user-data-dir=${profile}`, "about:blank",
], { stdio: "ignore" });

let target = null;
for (let i = 0; i < 240 && !target; i++) {
  try { const ps = await (await fetch(`http://127.0.0.1:${dbg}/json/list`)).json(); target = ps.find((p) => p.type === "page"); } catch (_) {}
  if (!target) await sleep(100);
}
const bye = (code, msg) => {
  if (msg) console.log(msg);
  if (!has("--keep")) chrome.kill("SIGTERM");
  server.kill("SIGTERM");
  process.exit(code);
};
if (!target) bye(1, "BOATWALK: FAIL no page");

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
let id = 1; const pend = new Map(); let errors = [];
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); return; }
  if (m.method === "Runtime.exceptionThrown") {
    const d = m.params.exceptionDetails;
    errors.push(`${(d.url || "?").split("/").pop()}:${d.lineNumber} ${(d.exception && d.exception.description || d.text || "").split("\n")[0]}`);
  } else if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") {
    errors.push("console.error: " + m.params.args.map((a) => a.value || a.description || "").join(" ").slice(0, 200));
  }
});
let browserDead = false;
const CDP_MS = 180000;               // a Gang City build blocks the main thread for ~1 min on swiftshader
const send = (method, params = {}) => new Promise((resolve) => {
  const i = id++;
  const timer = setTimeout(() => {
    if (pend.delete(i)) { browserDead = true; resolve({ __dead: true }); }
  }, CDP_MS);
  pend.set(i, (m) => { clearTimeout(timer); resolve(m); });
  try { ws.send(JSON.stringify({ id: i, method, params })); }
  catch (e) { clearTimeout(timer); pend.delete(i); browserDead = true; resolve({ __dead: true }); }
});
const evl = async (e) => {
  const r = await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true });
  if (r.__dead) return { __dead: true };
  if (r.result && r.result.exceptionDetails) return { __throw: r.result.exceptionDetails.text };
  return r.result && r.result.result && r.result.result.value;
};
await send("Runtime.enable");
await send("Page.enable");

const fails = [];
const report = {};

/* ---- BOOT, AS THE CAPTAIN ---------------------------------------------- */
await send("Page.navigate", { url: `${origin}?seed=${SEED}` });
{
  let up = false;
  for (let i = 0; i < 900 && !up; i++) {
    if (browserDead) bye(1, "BOATWALK: FAIL browser died during boot");
    if (await evl("!!(window.CBZ && CBZ.bootComplete && CBZ.setCityOrigin && CBZ.marineHulls)") === true) up = true;
    else await sleep(200);
  }
  if (!up) bye(1, "BOATWALK: FAIL never booted");
}

/* ---- 1a. THE REGISTRY-WIDE HELM AUDIT (no world needed) ----------------- */
report.helms = await evl(`(function () {
  var bad = [], n = 0;
  CBZ.marineHulls.list().forEach(function (r) {
    n++;
    var s = r.spec, h = s && s.helm;
    if (!h || !isFinite(h.x + h.y + h.z)) { bad.push(r.key + "/missing"); return; }
    if (Math.abs(h.x) > s.beam * 0.62) bad.push(r.key + "/x");
    if (Math.abs(h.z) > s.loa * 0.62) bad.push(r.key + "/z");
    if (!(h.y > 0 && h.y < 45)) bad.push(r.key + "/y");
  });
  return { hulls: n, offHull: bad, runaboutKeepsOldBoom: (function () {
    // the formula's floors ARE the old constants — the 6.2 m runabout must
    // still solve under them so small boats frame byte-identically
    var s = CBZ.marineHulls.spec("boat");
    return !!s && (s.loa * 1.05 + 2) < 9.5 && (s.loa * 0.40 + 3.5) < 10.0;
  })() };
})()`);
if (!report.helms || !report.helms.hulls) fails.push("helm audit could not read the registry");
else {
  if (report.helms.offHull.length) fails.push("helm stations off their hull: " + report.helms.offHull.join(", "));
  if (report.helms.runaboutKeepsOldBoom !== true) fails.push("the runabout no longer sits under the old 9.5/10 camera floors");
}

process.stdout.write("  sailing the trawler ... ");
const set = await evl(`(function(){
  if (!CBZ.setCityOriginBoat) return "no setter";
  CBZ.setCityOriginBoat("trawler");
  var b = document.querySelector('.origin-btn[data-origin="captain"]'); if (b) b.click();
  var p = document.getElementById("playBtn"); if (!p) return "no play button";
  p.click(); return "ok";
})()`);
if (set !== "ok") bye(1, `BOATWALK: FAIL could not start (${set})`);
for (let i = 0; i < 300 && !browserDead; i++) {
  if (await evl("!!(CBZ.city && CBZ.city.arena && CBZ.game.state === 'playing')") === true) break;
  await sleep(500);
}
// the origin launch defers until the fleet exists (START_SEC 14s ceiling)
let atHelm = false;
for (let i = 0; i < 60 && !browserDead; i++) {
  if (await evl("!!(CBZ.captainAudit && CBZ.captainAudit().atHelm)") === true) { atHelm = true; break; }
  await sleep(500);
}
if (!atHelm) bye(1, "BOATWALK: FAIL the captain never reached his own wheel");
console.log("at the wheel");

/* ---- 1b. THE CHASE FRAMES THE HULL -------------------------------------- */
await sleep(3000);                    // let the SmoothDamp boom settle on the moving hull
report.chase = await evl(`(function () {
  var P = CBZ.player, c = CBZ.camera, b = CBZ.captainBoat();
  var s = b && b._hullSpec;
  return {
    loa: s ? s.loa : null,
    back: +Math.hypot(c.position.x - P.pos.x, c.position.z - P.pos.z).toFixed(1),
    up: +(c.position.y - P.pos.y).toFixed(1),
  };
})()`);
// trawler (loa 18): back = 18*1.05+2 = 20.9, up = 18*0.40+3.5 = 10.7. The
// boom lags a moving target by ~smoothTime*speed, so the window is generous —
// what it must NOT be is the old 9.5/10 car boom.
if (!report.chase || report.chase.loa !== 18) fails.push("could not read the driven hull's spec for the chase check");
else {
  if (!(report.chase.back > 15 && report.chase.back < 28)) fails.push(`chase boom ${report.chase.back}m — expected ~20.9m for an 18m hull (old car boom was 9.5)`);
  if (!(report.chase.up > 7 && report.chase.up < 15)) fails.push(`chase height ${report.chase.up}m — expected ~10.7m`);
}

/* ---- 2. [V] — FIRST PERSON AT THE WHEEL --------------------------------- */
report.fpToggle = await evl("CBZ.carFpToggle ? CBZ.carFpToggle() : 'missing'");
await sleep(400);
report.fp = await evl(`(function () {
  var b = CBZ.captainBoat(), s = b && b._hullSpec, cam = CBZ.camera;
  if (!b || !s || !s.helm) return null;
  var v = new THREE.Vector3(s.helm.x, s.helm.y, s.helm.z);
  b.group.updateWorldMatrix(true, false);
  v.applyMatrix4(b.group.matrixWorld);
  return {
    mounted: CBZ.carFpAudit ? CBZ.carFpAudit().fpMounted : null,
    offEye: +cam.position.distanceTo(v).toFixed(2),
  };
})()`);
if (report.fpToggle !== true) fails.push("[V] did not toggle the wheel view on a boat");
else if (!report.fp || report.fp.mounted !== 1) fails.push("the wheel view never mounted");
else if (!(report.fp.offEye < 1.6)) fails.push(`the first-person camera sits ${report.fp.offEye}m off the helm station`);
await evl("CBZ.carFpToggle && CBZ.carFpToggle()");   // back to the chase before standing up
await sleep(200);

/* ---- 3. SPACE — GET UP ONTO YOUR OWN DECK ------------------------------- */
// HOLD the key until the SIM has seen it: on swiftshader a frame can take
// 300ms+, so a fixed 150ms tap can land entirely between two frames and the
// helm never reads the press. Poll the outcome, then release.
await evl('CBZ.keys[" "] = true');
for (let i = 0; i < 24; i++) {
  if (await evl("!CBZ.player.driving") === true) break;
  await sleep(250);
}
await evl('CBZ.keys[" "] = false');
await sleep(600);
report.stood = await evl(`(function () {
  var P = CBZ.player, b = CBZ.captainBoat();
  if (!b || !b.group) return null;
  var s = b._hullSpec, v = new THREE.Vector3(s.helm.x, s.helm.y, s.helm.z);
  b.group.updateWorldMatrix(true, false);
  v.applyMatrix4(b.group.matrixWorld);
  return {
    driving: !!P.driving, swim: !!P._swim,
    overDeck: +(P.pos.y - b.group.position.y).toFixed(2),
    offWheel: +Math.hypot(P.pos.x - v.x, P.pos.z - v.z).toFixed(2),
  };
})()`);
if (!report.stood) fails.push("could not read the stand-up result");
else {
  if (report.stood.driving !== false) fails.push("Space at the wheel did not stand the captain up");
  if (report.stood.swim !== false) fails.push("getting up put the captain in the sea");
  // the trawler's wheelhouse sole rig sits 2.59 above the group origin
  if (!(report.stood.overDeck > 1.6 && report.stood.overDeck < 3.6)) fails.push(`stood at ${report.stood.overDeck}m over the hull origin — not the wheelhouse sole (~2.6)`);
  if (!(report.stood.offWheel < 4)) fails.push(`stood ${report.stood.offWheel}m from the wheel — "get up" means beside it`);
}

/* ---- 4. STEP BACK TO THE WHEEL ------------------------------------------ */
let card = null;
for (let i = 0; i < 12 && !card; i++) {
  card = await evl(`(function () {
    var o = document.getElementById("interactOpts");
    return o && /Take (the|her) helm/.test(o.textContent) ? o.textContent.slice(0, 80) : null;
  })()`);
  if (!card) await sleep(250);
}
report.card = card;
if (!card) fails.push('standing at the wheel offers no "Take the helm" card');
else {
  await evl('dispatchEvent(new KeyboardEvent("keydown", { key: "e" }))');
  await sleep(400);
  await evl('dispatchEvent(new KeyboardEvent("keyup", { key: "e" }))');
  await sleep(300);
  report.retaken = await evl("!!(CBZ.player.driving && CBZ.captainAudit().atHelm)");
  if (report.retaken !== true) fails.push("stepping to the wheel did not hand her back");
}

{
  const e = errors.filter((x) => !/ProgressEvent|favicon|preload|Audio/i.test(x));
  if (e.length) fails.push(`${e.length} console errors — ${e[0]}`);
}

console.log(JSON.stringify(report, null, 1));
if (fails.length) bye(1, "BOATWALK: FAIL\n - " + fails.join("\n - "));
bye(0, "BOATWALK: ok — the chase frames the hull, [V] sits at the wheel, Space stands you up on your own deck, and the wheel takes you back");
