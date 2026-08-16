#!/usr/bin/env node
/* tools/boat-origin-check.mjs — CAN THE CAPTAIN PICK HIS BOAT, AND DOES THE
   BOAT HE PICKS HOLD HIS CREW?

   OWNER (2026-08-12): "captain like pilot should let me select any boat in
   start menu."

   Two things are checked, and they are different kinds of thing:

     1. THE PICKER, driven the way a person drives it — click the Captain card,
        read the strip, click a hull, ask the engine what it resolved to. The
        PILOT's own list is read in the same pass, because a shared renderer
        (systems/state.js renderSub) is exactly the kind of change that fixes
        one story by breaking the other.

     2. THE FITTINGS, for EVERY hull in the registry rather than the one being
        sailed. city/captain.js used to type the trawler's own measurements as
        literals — the hold at deck 2.43, the chart table at (0.95, 2.59,
        2.35), three crew stations — so offering eleven boats is eleven chances
        to stand a deckhand in the sea. `offHull` is that fault counted, and it
        is answerable at the TITLE SCREEN with no world built, because
        world/water_hulls.js registers its fleet at parse time.

   And optionally (--sail) the whole arc: start a run as the Captain on a named
   hull and assert a boat was actually found, crewed and put to sea — the half
   no static check can reach.

   Usage:
     node tools/boat-origin-check.mjs
     node tools/boat-origin-check.mjs --sail            trawler + tender + a superyacht
     node tools/boat-origin-check.mjs --sail --hull sloop
   Exit 0 = ok.                                                              */
import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const arg = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d; };
/* The sail list is deliberately the two ENDS and the middle: the smallest hull
   in the game (a 4.5 m tender — the one the old literals would have drowned a
   crew on), the authored default, and the 156 m flagship, which is the only
   one that can never be delivered to a marina berth and has to be adopted at
   her outer roadstead. */
const HULLS = arg("--hull", "trawler,dinghy,yacht156").split(",");
const SEED = arg("--seed", "talloran");

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
  if (!up) { console.error("BOAT: FAIL devserver never came up"); process.exit(1); }
}

const dbg = await claimPort(11360, 200, (p) => fetch(`http://127.0.0.1:${p}/json/version`));
const profile = `/tmp/cbz-boatorigin-${dbg}`;
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
if (!target) bye(1, "BOAT: FAIL no page");

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
/* A DEAD BROWSER MUST FAIL, NOT HANG. Three full engine boots in one session
   is enough to lose the renderer (measured: chromium gone, node still waiting),
   and a CDP round-trip that never resolves turns a 6-minute tool into a
   40-minute wait for the outer `timeout` to shoot it. Every call is bounded,
   and a lapsed call marks the browser dead so the run reports which leg it got
   to instead of dying silent.

   THE BOUND HAS TO CLEAR A WORLD BUILD, though, and that is the trap: building
   Gang City blocks the page's main thread for the better part of a minute on
   swiftshader, so Runtime.evaluate legitimately does not answer for that whole
   time. A 45 s bound called that a dead browser and reported a launch failure
   for a captain who was, in fact, at his own wheel. Three minutes is longer
   than any honest block and far shorter than the outer timeout. */
let browserDead = false;
const CDP_MS = 180000;
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

/* THE BOOT SIGNAL IS `bootComplete`, NOT A GLOBAL AND A BUTTON. index.html
   carries 471 script tags; `window.CBZ` and #playBtn both exist long before
   city/origins.js has parsed, and waiting on those reports an empty registry
   as a missing feature. */
async function boot(url, fresh) {
  errors = [];
  if (browserDead) return false;
  /* EACH SAIL LEG IS A NEW PLAYER. Without this the second leg inherits the
     first one's saved character — origins.js does not replay a story's opening
     verb for a captain who has already sailed, so the boat never launches and
     the tool reports a game fault that is really a dirty profile. Measured:
     `dinghy` read NO BOAT as leg 2 and launched fine as leg 1. */
  if (fresh) {
    await send("Page.navigate", { url: `${origin}favicon.ico` });   // same origin, no engine
    await evl("try{localStorage.clear();sessionStorage.clear()}catch(e){}");
  }
  await send("Page.navigate", { url });
  for (let i = 0; i < 900; i++) {
    if (browserDead) return false;
    if (await evl("!!(window.CBZ && CBZ.bootComplete && CBZ.setCityOrigin && CBZ.marineHulls)") === true) return true;
    await sleep(200);
  }
  return false;
}

const fails = [];
const report = {};

/* ---- 1. THE PICKER ------------------------------------------------------ */
if (!await boot(`${origin}?seed=${SEED}`)) bye(1, "BOAT: FAIL never booted");

report.hulls = await evl("(CBZ.cityOriginBoats?CBZ.cityOriginBoats():[]).map(function(b){return b.label})");
report.defaultKey = await evl("CBZ.cityOriginBoatKey && CBZ.cityOriginBoatKey()");
await evl(`document.querySelector('.origin-btn[data-origin="captain"]').click()`);
await sleep(150);
report.shown = await evl(`(function(){var w=document.getElementById("originBoatWrap");return !!w && w.style.display!=="none"})()`);
report.buttons = await evl(`document.querySelectorAll("#originBoatSelect button").length`);
report.lit = await evl(`(function(){var a=document.querySelector("#originBoatSelect button.active");return a?a.textContent:null})()`);
// a person clicks the last one in the strip; the engine must resolve to it
await evl(`(function(){var b=document.querySelectorAll("#originBoatSelect button");b[b.length-1].click()})()`);
report.picked = await evl("CBZ.cityOriginBoat()");
report.resolved = await evl("CBZ.cityOriginBoatKey()");
// THE PILOT MUST BE UNTOUCHED — both stories share one renderer now
await evl(`document.querySelector('.origin-btn[data-origin="pilot"]').click()`);
await sleep(150);
report.planeButtons = await evl(`document.querySelectorAll("#originPlaneSelect button").length`);
report.boatHiddenForPilot = await evl(`document.getElementById("originBoatWrap").style.display==="none"`);
report.fit = await evl("CBZ.captainFitAudit && CBZ.captainFitAudit()");

const nHulls = (report.hulls || []).length;
if (nHulls < 4) fails.push(`only ${nHulls} boats offered — the registry should list every hull`);
if (report.shown !== true) fails.push("the boat strip does not appear when the Captain is chosen");
if (report.buttons !== nHulls) fails.push(`${report.buttons} buttons for ${nHulls} hulls`);
if (!report.lit) fails.push("no boat is lit when the picker opens");
if (report.lit && report.defaultKey !== "trawler") fails.push(`default is ${report.defaultKey}, not the trawler the Captain card describes`);
if (report.picked !== report.resolved) fails.push(`picked ${report.picked} but the engine resolves ${report.resolved}`);
if (!report.planeButtons) fails.push("the PILOT's aircraft strip regressed to empty");
if (report.boatHiddenForPilot !== true) fails.push("the boat strip shows for the Pilot");
if (!report.fit) fails.push("CBZ.captainFitAudit() is missing");
else if (report.fit.offHull !== 0) fails.push(`${report.fit.offHull} fittings land off their hull: ${(report.fit.where || []).join(", ")}`);
else if (report.fit.hulls !== nHulls) fails.push(`the fit audit checked ${report.fit.hulls} hulls, the picker offers ${nHulls}`);
{
  const e = errors.filter((x) => !/ProgressEvent|favicon|preload/i.test(x));
  if (e.length) fails.push(`title screen: ${e.length} console errors — ${e[0]}`);
}

/* ---- 2. AND SHE ACTUALLY SAILS ------------------------------------------ */
report.sailed = {};
if (has("--sail")) {
  for (const hull of HULLS) {
    // index.html is 471 script tags and a headless boot of it is the expensive
    // part of this tool by a wide margin — say where we are, or a slow machine
    // looks like a hang
    process.stdout.write(`  ${hull}: booting ... `);
    const bt = Date.now();
    if (!await boot(`${origin}?seed=${SEED}`, true)) {
      const why = browserDead ? "the browser died" : "never booted";
      console.log(why); fails.push(`${hull}: ${why}`);
      if (browserDead) break;              // every later leg would say the same
      continue;
    }
    process.stdout.write(`${((Date.now() - bt) / 1000).toFixed(0)}s, sailing ... `);
    const set = await evl(`(function(){
      if (!CBZ.setCityOriginBoat) return "no setter";
      CBZ.setCityOriginBoat(${JSON.stringify(hull)});
      var b = document.querySelector('.origin-btn[data-origin="captain"]'); if (b) b.click();
      var p = document.getElementById("playBtn"); if (!p) return "no play button";
      p.click(); return "ok";
    })()`);
    if (set !== "ok") { fails.push(`${hull}: could not start (${set})`); continue; }
    /* WAIT FOR THE RUN TO EXIST BEFORE ASKING IT ANYTHING. The world build is
       one long synchronous block; polling captainAudit() through it just
       queues calls behind it and reads nothing. */
    for (let i = 0; i < 300 && !browserDead; i++) {
      if (await evl("!!(CBZ.city && CBZ.city.arena && CBZ.game.state === 'playing')") === true) break;
      await sleep(500);
    }
    // captain.js arms a PENDING launch and fires the moment the fleet exists
    // (START_SEC 14 in sim time); give it real wall time on swiftshader
    let a = null;
    for (let i = 0; i < 150 && !browserDead; i++) {
      a = await evl("CBZ.captainAudit && CBZ.captainAudit()");
      if (a && a.__dead) { a = null; break; }
      if (a && a.boat) break;
      await sleep(400);
    }
    const e = errors.filter((x) => !/ProgressEvent|favicon|preload/i.test(x));
    console.log(a && a.boat ? `${a.flagLabel} under way, ${a.crew}/${a.crewPlanned} crew aboard` : "NO BOAT");
    report.sailed[hull] = a ? {
      boat: !!a.boat, flag: a.flag, label: a.flagLabel, crew: a.crew,
      crewPlanned: a.crewPlanned, holds: a.holds, chart: a.chartTable,
      errors: e.slice(0, 3),
    } : { boat: false, errors: e.slice(0, 3) };
    if (!a || !a.boat) fails.push(`${hull}: the captain never got a boat`);
    else {
      if (a.flag !== hull) fails.push(`${hull}: sailing ${a.flag} instead`);
      if (!a.chartTable) fails.push(`${hull}: no chart table — there is no way to take a voyage`);
      // the crew arrive through citystaff posts and can take a beat; what must
      // never happen is a hull that PLANS nobody
      if (!a.crewPlanned) fails.push(`${hull}: no crew stations planned`);
    }
    if (e.length) fails.push(`${hull}: ${e.length} console errors — ${e[0]}`);
  }
}

console.log(JSON.stringify(report, null, 1));
if (fails.length) bye(1, "\nBOAT: FAIL — " + fails.join("\n            "));
bye(0, `\nBOAT: ok — ${nHulls} hulls in the start menu (${report.hulls[0]} .. ${report.hulls[nHulls - 1]}), ` +
  `0 fittings off a hull across all ${report.fit.hulls}, ${report.fit.crewSeats} crew stations, ` +
  `the Pilot's ${report.planeButtons} airframes untouched` +
  (has("--sail") ? `; sailed ${Object.keys(report.sailed).filter((k) => report.sailed[k].boat).join(", ")}` : ""));
