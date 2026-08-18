#!/usr/bin/env node
/* tools/beast-death-check.mjs — DO THE ANIMALS DIE LIKE ANIMALS?

   OWNER, on games/battle.html: "it shows dead beasts sitting up on back and
   then they disappear. They should be real ragdoll and not disappear, and also
   real biting."

   Three claims, and every one of them is countable, so none of them has to be
   argued from a screenshot:

     noseUp       carcasses SITTING UP — a dead body whose nose vector points at
                  the sky. This is the reported pose and the gate holds it at 0.
                  It is measured off the group's real quaternion (both the up
                  AND the forward axis), because the two wrong poses — standing
                  on its feet, and hinged up onto its hindquarters — are
                  indistinguishable if you only look at one of them.
     ragdoll      deaths resolved by systems/quadruped_ragdoll.js rather than by
                  a canned rotation. A page that loads the beasts but not the
                  solver silently gets the old pose back, and this is what
                  notices.
     disappear    bodies deleted from the world while the camera is on them. The
                  budget still exists — it must — but past it the oldest body
                  now SINKS out of shot instead of popping, so `sinking` moves
                  and no corpse ever vanishes in frame.
     bites/blood  strikes that connected on real jaw contact, and blood actually
                  on the ground behind them. A war fought entirely with teeth
                  that leaves no blood is the bite doing nothing you can see.

   Usage:
     node tools/beast-death-check.mjs                 lions vs wolves, arena
     node tools/beast-death-check.mjs --ru brown_bear --bu wild_boar
     node tools/beast-death-check.mjs --map field --n 14 --seconds 40
     node tools/beast-death-check.mjs --revert        assert the faults COME BACK
     node tools/beast-death-check.mjs --url https://efoltyn.github.io/gta6/

   --revert boots the page's own one-switch revert (?death=old) and asserts the
   OLD code reproduces the reported pose and the bloodless bite. A fix nobody
   can turn off has not been measured.

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

const MAP = arg("--map", "arena");
const N = parseInt(arg("--n", "12"), 10);
const SECONDS = parseInt(arg("--seconds", "45"), 10);
const RU = arg("--ru", "lion");
const BU = arg("--bu", "gray_wolf");
const SPEED = arg("--speed", "4");
const REVERT = has("--revert");
// a budget small enough that a battle this size actually reaches it, so the
// retirement path is exercised rather than assumed. Well under the shipped
// default (420) — the point is to prove HOW a body leaves, not to starve one.
const BUDGET = parseInt(arg("--corpses", String(Math.max(4, Math.ceil(N * 0.6)))), 10);

async function claimPort(lo, n, probe) {
  for (let p = lo; p < lo + n; p++) { try { await probe(p); } catch (_) { return p; } }
  throw new Error("no free port");
}

const REMOTE = arg("--url", "");
let server = { kill() {} };
let origin;
if (REMOTE) {
  origin = REMOTE.endsWith("/") ? REMOTE : REMOTE + "/";
  try { await fetch(origin); } catch (e) { console.error("BEASTS: FAIL cannot reach " + origin); process.exit(1); }
} else {
  const port = await claimPort(9820, 150, (p) => fetch(`http://127.0.0.1:${p}/`));
  server = spawn("python3", [path.join(ROOT, "tools/devserver.py")],
    { env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
  origin = `http://127.0.0.1:${port}/`;
  let up = false;
  for (let i = 0; i < 40 && !up; i++) { try { await fetch(origin); up = true; } catch (_) { await sleep(100); } }
  if (!up) { console.error("BEASTS: FAIL devserver never came up"); process.exit(1); }
}

const dbg = await claimPort(11220, 200, (p) => fetch(`http://127.0.0.1:${p}/json/version`));
const profile = `/tmp/cbz-beastcheck-${dbg}`;
await rm(profile, { recursive: true, force: true });
const CHROME_BIN = process.env.CBZ_CHROME || (process.platform === "darwin"
  ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "/opt/pw-browsers/chromium");
const chrome = spawn(CHROME_BIN, [
  "--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
  "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
  "--enable-webgl", "--mute-audio", "--window-size=900,560",
  `--remote-debugging-port=${dbg}`, `--user-data-dir=${profile}`,
  "about:blank",
], { stdio: "ignore" });

let target = null;
for (let i = 0; i < 240 && !target; i++) {
  try {
    const ps = await (await fetch(`http://127.0.0.1:${dbg}/json/list`)).json();
    target = ps.find((p) => p.type === "page");
  } catch (_) {}
  if (!target) await sleep(100);
}
const bye = (code, msg) => {
  if (msg) console.log(msg);
  if (!has("--keep")) chrome.kill("SIGTERM");
  server.kill("SIGTERM");
  process.exit(code);
};
if (!target) bye(1, "BEASTS: FAIL no page");

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
let id = 1; const pend = new Map(); const errors = [];
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
const send = (method, params = {}) => new Promise((r) => { const i = id++; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evl = async (e) => {
  const r = await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true });
  if (r.result && r.result.exceptionDetails) return { __throw: r.result.exceptionDetails.text };
  return r.result && r.result.result && r.result.result.value;
};
await send("Runtime.enable");
await send("Page.enable");

const url = `${origin}games/battle.html?auto=1&probe=1&map=${MAP}&red=${N}&blue=${N}` +
  `&ru=${RU}&bu=${BU}&corpses=${BUDGET}` + (REVERT ? "&death=old" : "");
await send("Page.navigate", { url });

let started = false;
for (let i = 0; i < 400 && !started; i++) {
  started = await evl("!!(window.__battle && __battle.audit().started)");
  if (started !== true) { started = false; await sleep(250); }
}
if (!started) bye(1, "BEASTS: FAIL the war never started at " + url);
await evl(`__battle.speed(${SPEED})`);

/* WATCH IT, AND ACCUMULATE. `noseUp` and `sinking` are both TRANSIENT — a body
   is only mid-retirement for a couple of seconds, and a body is only mid-fall
   for one — so a single reading at the end can miss either. The gate is over
   the WORST thing seen, which is the only honest way to hold a claim about a
   pose that has to be true continuously. */
const peak = { noseUp: 0, noseWorst: 0, standing: 0, sinkSeen: 0, corpsesMax: 0 };
let last = null;
const t0 = Date.now();
while ((Date.now() - t0) / 1000 < SECONDS) {
  await sleep(1200);
  const a = await evl("__battle.audit()");
  if (!a || a.__throw) continue;
  last = a;
  const d = a.deaths || {};
  // a body mid-fall is legitimately not on its flank yet; only judge the pose
  // once the solver has stopped moving it (or, in revert mode, once the canned
  // topple has finished). `noseUp` is derived from the settled quaternion, so
  // a transient during the fall is real but brief — take the worst anyway and
  // let the threshold below carry the tolerance.
  if ((d.noseUp || 0) > peak.noseUp) peak.noseUp = d.noseUp;
  if ((d.noseWorst || 0) > peak.noseWorst) peak.noseWorst = d.noseWorst;
  if ((d.standing || 0) > peak.standing) peak.standing = d.standing;
  if ((a.sinking || 0) > peak.sinkSeen) peak.sinkSeen = a.sinking;
  if ((a.corpses || 0) > peak.corpsesMax) peak.corpsesMax = a.corpses;
  if (a.over && (a.simT || 0) > 12) break;
}
const audit = last || (await evl("__battle.audit()"));
const d = (audit && audit.deaths) || {};
const bites = (audit && audit.bites) || {};
const blood = (audit && audit.blood) || {};

const row = {
  mode: audit && audit.deathMode, map: MAP, matchup: `${RU} vs ${BU}`, n: N,
  simT: audit && audit.simT, fps: audit && audit.fps,
  corpses: audit && audit.corpses, corpseBudget: audit && audit.corpseMax,
  corpsesPeak: peak.corpsesMax, retiredSeen: peak.sinkSeen,
  beastCorpses: d.beast, ragdoll: d.ragdoll, tumble: d.tumble, topple: d.topple,
  flank: d.flank, standing: d.standing, noseUp: d.noseUp,
  noseUpPeak: peak.noseUp, noseWorstPeak: peak.noseWorst,
  bitesLanded: bites.landed, bitesMissed: bites.missed,
  bloodPools: blood && blood.pools,
  solver: audit && audit.solver,
  errors: errors.filter((e) => !/ProgressEvent|favicon|preload/i.test(e)).slice(0, 6),
};
console.log(JSON.stringify(row, null, 2));

if (row.errors.length) bye(1, "BEASTS: FAIL page errors — " + row.errors.join(" | "));
if (!(d.beast > 0)) bye(1, "BEASTS: FAIL nothing died — the matchup never fought (check the species ids)");

if (REVERT) {
  /* THE REVERT MUST BRING THE FAULTS BACK, or the switch is not wired to
     anything and every "after" number above is unearned. */
  const faults = [];
  if (peak.noseUp > 0) faults.push(`${peak.noseUp} carcasses sitting up (worst nose ${peak.noseWorst})`);
  if ((d.ragdoll || 0) === 0) faults.push("no ragdolls (canned topple only)");
  if (!(blood && blood.pools > 0)) faults.push("no blood from any bite");
  if (faults.length < 2) {
    bye(1, "BEASTS --revert: FAIL — the old code did not reproduce the reported faults " +
      `(saw: ${faults.join("; ") || "none"}), so the fix is unproven or ?death=old is not wired`);
  }
  bye(0, `\nBEASTS --revert: ok — the old code brings the faults back (${faults.join("; ")}), ` +
    "which is what makes the default build's zeros mean something.");
}

const fails = [];
// THE POSE. Zero carcasses sitting up, at any point, ever.
if (peak.noseUp > 0) {
  fails.push(`${peak.noseUp} carcass(es) sitting up with the nose at the sky ` +
    `(worst nose height ${peak.noseWorst}) — the reported pose is back`);
}
// THE SOLVER. Some of these deaths must be real ragdolls, not the fallback.
if (!(d.ragdoll > 0)) {
  fails.push("no death was solved as a ragdoll — quadruped_ragdoll.js is not " +
    "loaded, refused every body, or the page is not asking it");
}
// A settled field must read as dead: most bodies on their flank.
if (d.beast >= 4 && (d.flank || 0) < Math.ceil(d.beast * 0.6)) {
  fails.push(`only ${d.flank}/${d.beast} carcasses are lying on their flank`);
}
// THE BITE. It has to land, and it has to draw blood.
if (!(bites.landed > 0)) fails.push("no bite ever connected — the jaw-contact gate is refusing every strike");
if (!(blood && blood.pools > 0)) fails.push("a war fought entirely with teeth left no blood on the ground");
// DISAPPEARING. The budget was set low enough to be reached; if it was, at
// least one body must have left through the sink rather than by deletion.
if (peak.corpsesMax > BUDGET && peak.sinkSeen === 0) {
  fails.push(`the corpse budget (${BUDGET}) was exceeded but no body was ever seen sinking — ` +
    "bodies are still being deleted where they lie");
}

if (fails.length) bye(1, "\nBEASTS: FAIL — " + fails.join("\n              "));
bye(0, `\nBEASTS: ok — ${row.matchup} on ${MAP}: ${d.beast} carcasses, ${d.ragdoll} ragdolled, ` +
  `${d.flank} on their flank, 0 sitting up (worst nose ${peak.noseWorst}); ` +
  `${bites.landed} bites landed / ${bites.missed} closed short; ${blood.pools} blood pools; ` +
  `${peak.corpsesMax} bodies held, ${peak.sinkSeen ? "retirement seen" : "budget never reached"}.`);
