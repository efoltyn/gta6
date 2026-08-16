#!/usr/bin/env node
/* tools/nuke-sortie-check.mjs — THE ORDERED NUCLEAR SORTIE, END TO END.

   Orders a strike through CBZ.strategicNuclearSortie and reads the whole arc
   off CBZ.strategicSortieState() while bursting CBZ.stepSim — no frame waits,
   no screenshots. Asserts what the feature actually promises:

     · the order is ACCEPTED and claims the real parked B-2 (bomber -> false)
       with a real named garrison pilot
     · the aircraft ingresses from ~SORTIE_INGRESS out and closes on the mark
     · it RELEASES at the SOLVED point (a small residual distance = the solved
       throw), not at a hand-picked range
     · the weapon falls under the RETARDED laydown, not free fall — the check
       is arithmetic: free fall from the release altitude is sqrt(2h/GRAV), and
       a real canopy makes the measured fall meaningfully longer
     · it DETONATES, and the bomber is clear when it does
     · the nuclear channel latches busy, and the console stays clean

   WHY THE DETONATION IS DETECTED BY ITS CONSEQUENCES. The obvious probe wraps
   CBZ.strategicNukeDetonate — and it never fires. strategic.js's
   resolveImpact() calls the MODULE-LOCAL nukeDetonate, so the CBZ.* handle is
   not on the path; a wrapper on an exported name only ever sees calls from
   OUTSIDE that file. The 5th wanted star is the honest signal instead: it is
   owner-reserved and cityAddStars(5, "Nuclear detonation — military response")
   is reachable from nowhere else in the game.

   Usage: node tools/nuke-sortie-check.mjs [--seed N] [--ticks N]
   Exit 0 = SORTIE: ok. Anything else = FAIL (exit 1).                       */
import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const argv = process.argv.slice(2);
const argS = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d; };
const SEED = argS("--seed", "90210");
const TICKS = +argS("--ticks", 3000);          // 50 sim-seconds; the arc is ~17
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (m) => { console.error("SORTIE: FAIL " + m); process.exitCode = 1; };

// macOS has no /opt/pw-browsers/chromium — same resolution every tool here uses
const CHROME_BIN = process.env.CBZ_CHROME ||
  (process.platform === "darwin"
    ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    : "/opt/pw-browsers/chromium");

const port = 8830 + Math.floor(Math.random() * 40);
const server = spawn("python3", [path.join(ROOT, "tools/devserver.py")], { env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
const base = `http://127.0.0.1:${port}/?seed=${SEED}`;
const dbg = 9830 + Math.floor(Math.random() * 40);
const profile = `/tmp/cbz-sortie-${dbg}`;
await rm(profile, { recursive: true, force: true });
await sleep(700);
const chrome = spawn(CHROME_BIN, [
  "--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--use-gl=angle", "--use-angle=swiftshader",
  "--enable-unsafe-swiftshader", "--enable-webgl", "--mute-audio", "--window-size=480,300",
  `--remote-debugging-port=${dbg}`, `--user-data-dir=${profile}`, base,
], { stdio: "ignore" });

function done(code) {
  try { chrome.kill(); } catch (e) {}
  try { server.kill(); } catch (e) {}
  rm(profile, { recursive: true, force: true }).catch(() => {});
  process.exit(code != null ? code : (process.exitCode | 0));
}

let pageInfo = null;
for (let i = 0; i < 120 && !pageInfo; i++) {
  try { const ps = await (await fetch(`http://127.0.0.1:${dbg}/json/list`)).json(); pageInfo = ps.find((p) => p.type === "page" && p.url.startsWith(`http://127.0.0.1:${port}/`)); } catch (_) {}
  if (!pageInfo) await sleep(250);
}
if (!pageInfo) { console.error("SORTIE: FAIL no page"); done(1); }
const ws = new WebSocket(pageInfo.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
let id = 1; const pending = new Map(); const errors = [];
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === "Runtime.exceptionThrown") {
    const d = m.params.exceptionDetails;
    errors.push(`${d.url || "?"}:${d.lineNumber} ${(d.exception && d.exception.description || d.text || "").split("\n")[0]}`);
  }
});
const send = (method, params = {}) => new Promise((r) => { const i = id++; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evl = async (expression) => { const r = await send("Runtime.evaluate", { expression, returnByValue: true }); return r.result && r.result.result && r.result.result.value; };
await send("Runtime.enable"); await send("Page.enable");

for (let i = 0; i < 400; i++) { if (await evl("!!(window.CBZ && CBZ.game && CBZ.stepSim && document.getElementById('playBtn'))")) break; await sleep(150); }
let playing = false;
for (let i = 0; i < 240 && !playing; i++) {
  playing = await evl("(() => { if (CBZ.game && CBZ.game.state === 'playing') return true; const b = document.getElementById('playBtn'); if (b) b.click(); return CBZ.game && CBZ.game.state === 'playing'; })()");
  if (!playing) await sleep(200);
}
if (!playing) { console.error("SORTIE: FAIL never reached play"); done(1); }
// free play, not the motel opening (see scrolls/claude/verification.md)
await evl(`(() => { try { if (CBZ.game.cityCampaign) CBZ.game.cityCampaign.phase = "endless_contracts"; } catch (e) {} return true; })()`);

if (!(await evl("typeof CBZ.strategicNuclearSortie === 'function' && typeof CBZ.strategicSortieState === 'function'"))) {
  console.error("SORTIE: FAIL strategicNuclearSortie / strategicSortieState missing");
  done(1);
}

/* STAND AT FORT BRANDT FIRST. The garrison is a LIVE ped roster streamed in
   with the region, so "no aircrew on the base" is a true refusal a long way
   away and a false negative for this probe. The release console is in the
   Fort Brandt shelter anyway, so this is also where a player would be. */
await evl(`(() => { const P = CBZ.player.pos; P.set(-600, P.y, -600); if (CBZ.player.group) CBZ.player.group.position.copy(P); return true; })()`);
let troops = 0;
for (let w = 0; w < 12 && !troops; w++) {
  troops = +(await evl(`(() => { for (let i = 0; i < 30; i++) CBZ.stepSim(1/60); return (CBZ.cityMilitaryPersonnel || []).length; })()`)) || 0;
}
if (!troops) fail("no garrison roster streamed in at Fort Brandt");

const order = JSON.parse(await evl(`(() => {
  const P = CBZ.player.pos, tx = P.x + 340, tz = P.z + 60;
  window.__T = { x: tx, z: tz };
  window.__L = { i: 0, released: null, det: null, minD: 1e9, maxEgress: 0 };
  const r = CBZ.strategicNuclearSortie({ x: tx, z: tz, byPlayer: true });
  const st = CBZ.strategicSortieState();
  return JSON.stringify({ r: r, st: st, tx: tx, tz: tz,
    ingress: st.active ? Math.round(Math.hypot(st.x - tx, st.z - tz)) : null });
})()`));
if (!order.r || !order.r.ok) fail("order refused: " + (order.r && order.r.why));
if (!order.st.active) fail("no sortie airborne after an accepted order");
if (order.st.bomber !== false) fail("the parked B-2 was not claimed (bomber still available)");
if (!order.st.pilot) fail("no aircrew seated");
console.log(`ordered: pilot=${order.st.pilot} ingress=${order.ingress}m alt=${Math.round(order.st.y)}m`);

/* THE ARC. Chunked so a slow SwiftShader boot cannot look like a hang, and so
   a stalled sortie reports where it stalled instead of timing out silently. */
let flight = null;
for (let c = 0; c < Math.ceil(TICKS / 300) && !flight; c++) {
  const r = JSON.parse(await evl(`(() => {
    const T = window.__T, L = window.__L;
    for (let k = 0; k < 300; k++) {
      CBZ.stepSim(1/60); L.i++;
      const st = CBZ.strategicSortieState();
      if (st.active) {
        const d = Math.hypot(st.x - T.x, st.z - T.z);
        if (st.phase === "inbound" && d < L.minD) L.minD = d;
        if (st.phase === "egress") {
          if (!L.released) L.released = { t: +(L.i/60).toFixed(2), d: Math.round(d), y: Math.round(st.y) };
          if (d > L.maxEgress) L.maxEgress = d;
        }
      }
      // the detonation, by its consequences — see the header note
      if (!L.det && (CBZ.game.wanted | 0) >= 5) {
        L.det = { t: +(L.i/60).toFixed(2), clear: Math.round(L.maxEgress),
                  busy: !!CBZ.strategicSortieState().channelBusy };
        break;
      }
    }
    return JSON.stringify({ i: L.i, released: L.released, det: L.det, minD: Math.round(L.minD) });
  })()`));
  if (r.det) flight = r;
  else if (r.i >= TICKS) flight = r;
}

if (!flight || !flight.released) { fail("the weapon was never released"); }
else {
  const rel = flight.released;
  console.log(`released: t=${rel.t}s  ${rel.d}m short of the mark  alt=${rel.y}m`);
  // THE RELEASE IS SOLVED, NOT TUNED: the residual distance at release is the
  // solved throw, so it must be a real lead (not zero) and must not be a
  // fly-past. 4..250 m brackets every profile this altitude band can produce.
  if (!(rel.d >= 4 && rel.d <= 250)) fail(`release ${rel.d}m from the mark — not a solved throw`);
  if (!(rel.y > 40)) fail(`released at ${rel.y}m — below a survivable delivery altitude`);
}
if (!flight || !flight.det) { fail("the weapon never detonated"); }
else if (flight.released) {
  const d = flight.det, rel = flight.released;
  const fall = +(d.t - rel.t).toFixed(2);
  const GRAV = 14;                                     // strategic.js's own constant
  const freeFall = +Math.sqrt(2 * rel.y / GRAV).toFixed(2);
  console.log(`detonated: t=${d.t}s  fall=${fall}s (free fall would be ${freeFall}s)  bomber ${d.clear}m clear`);
  // THE CANOPY IS THE POINT. A retarded laydown must take materially longer
  // than the ballistic fall from the same height; 1.4x is a wide floor that
  // still cannot be met by free fall plus solver noise.
  if (!(fall > freeFall * 1.4)) fail(`fall ${fall}s vs free fall ${freeFall}s — the canopy did not stream`);
  if (!(d.clear > 500)) fail(`bomber only ${d.clear}m clear at detonation`);
  if (!d.busy) fail("the nuclear channel did not latch busy");
}

// one known-baseline ProgressEvent is acceptable; anything else is ours
const real = errors.filter((e) => !/ProgressEvent/.test(e));
if (real.length) fail(`${real.length} console error(s): ${real.slice(0, 3).join(" | ")}`);

if (process.exitCode) done(1);
console.log("SORTIE: ok");
done(0);
