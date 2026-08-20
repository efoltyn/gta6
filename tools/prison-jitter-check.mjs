#!/usr/bin/env node
/* tools/prison-jitter-check.mjs — NOBODY VIBRATES. The numeric gate for the
   cell-block flicker.

   OWNER (verbatim): "In prison game ai is flickering like moving super fast
   front back while trying to run while in cell."

   A body that flickers is a body two systems are writing in the same frame
   with different answers, or one system whose answer flips sign every frame.
   Either way the signature is the same and it is measurable: the frame-to-
   frame displacement REVERSES while staying large. This probe steps the sim a
   frame at a time, samples every actor's rendered position, and scores each
   one on

     jitter = Σ min(|d_i|, |d_i+1|) over frames where d_i · d_i+1 < 0

   metres of back-and-forth per second of sim. A man walking across the wing
   scores ~0; a man ping-ponging between a mover and a leash scores his whole
   travel distance. Reported per actor with the state that produced it.

   Boot boilerplate: tools/prison-sit-check.mjs.
*/
import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const HOUR = parseFloat(arg("--hour", "9"));
const REVERT = process.argv.includes("--revert");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 8880 + Math.floor(Math.random() * 40);
const server = spawn("python3", [path.join(ROOT, "tools/devserver.py")], { env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
const base = `http://127.0.0.1:${port}/`;
const target = base + (REVERT ? "?cfg_CELL_POST_V2=0" : "");
const dbg = 9880 + Math.floor(Math.random() * 40);
const profile = `/tmp/cbz-jit-${dbg}`;
await rm(profile, { recursive: true, force: true });
// wait for the static server BEFORE the browser starts: a browser that beats
// it to the port gets a connection-refused page and never retries on its own.
for (let i = 0; i < 60; i++) {
  try { const r = await fetch(base); if (r.ok) break; } catch (_) {}
  await sleep(250);
}
const CHROME_BIN = process.env.CBZ_CHROME || (process.platform === "darwin"
  ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  : "/opt/pw-browsers/chromium");
const chrome = spawn(CHROME_BIN, [
  "--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
  "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
  "--enable-webgl", "--mute-audio", "--window-size=1280,800",
  `--remote-debugging-port=${dbg}`, `--user-data-dir=${profile}`, target,
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
  const r = await send("Runtime.evaluate", { expression: `(function(){${expr}})()`, returnByValue: true, awaitPromise: true });
  if (r.result && r.result.exceptionDetails) return { __err: r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description };
  return r.result && r.result.result && r.result.result.value;
};
await send("Runtime.enable"); await send("Page.enable");

// the browser can beat the static server to the punch — reload until the game
// is actually served (a failed load leaves a page whose title is the host).
let booted = false;
for (let i = 0; i < 90 && !booted; i++) {
  const v = await evl("return !!(window.CBZ && CBZ.bootComplete && CBZ.game)");
  booted = v === true;
  if (booted) break;
  if (i % 12 === 11) await send("Page.navigate", { url: target });
  await sleep(500);
}
let playing = false;
for (let i = 0; i < 40 && !playing; i++) {
  await evl("try{CBZ.setMode('escape'); CBZ.startRun && CBZ.startRun();}catch(e){return String(e);} return true;");
  await sleep(500);
  playing = await evl("return !!(CBZ.game && CBZ.game.state==='playing' && CBZ.game.mode==='escape');");
}
console.log(`playing(escape): ${playing}  hour=${HOUR}${REVERT ? "  [revert]" : ""}`);
if (!playing) { console.log("ERRORS:", [...new Set(errors)].slice(0, 10)); done(2); }

const phaseOf = (hour) => ((hour - 6) / 24).toFixed(5);
// settle the world into the requested block first (leash/route state converges)
await evl(`var ph=${phaseOf(HOUR)};
  for (var c = 0; c < 20; c++) { if (CBZ.dayPhase) CBZ.dayPhase(ph); for (var k = 0; k < 30; k++) CBZ.stepSim(1/60); }
  return true;`);
const block = await evl("return CBZ.prisonSchedule ? CBZ.prisonSchedule.id() : null;");

// ---- the sample: 300 frames, every actor, every frame ---------------------
const S = await evl(`
  var ph = ${phaseOf(HOUR)};
  var roster = [];
  function add(list, kind) {
    for (var i = 0; i < list.length; i++) {
      var a = list[i];
      if (!a || !a.group || a.dead) continue;
      roster.push({ a: a, kind: kind, i: i, jit: 0, trav: 0, px: 0, pz: 0, ldx: 0, ldz: 0, first: true });
    }
  }
  add(CBZ.npcs || [], "npc");
  add(CBZ.guards || [], "guard");
  var FR = 300;
  for (var f = 0; f < FR; f++) {
    if (CBZ.dayPhase) CBZ.dayPhase(ph);
    CBZ.stepSim(1 / 60);
    for (var r = 0; r < roster.length; r++) {
      var e = roster[r], p = e.a.group.position;
      if (e.first) { e.px = p.x; e.pz = p.z; e.first = false; continue; }
      var dx = p.x - e.px, dz = p.z - e.pz;
      e.px = p.x; e.pz = p.z;
      var m = Math.hypot(dx, dz);
      e.trav += m;
      var lm = Math.hypot(e.ldx, e.ldz);
      if (lm > 1e-5 && m > 1e-5 && (dx * e.ldx + dz * e.ldz) < 0) e.jit += Math.min(m, lm);
      e.ldx = dx; e.ldz = dz;
    }
  }
  roster.sort(function (x, y) { return y.jit - x.jit; });
  // the residents are the population this gate is about — reported separately
  // so a quiet yard can never hide a vibrating cell.
  var resWorst = 0, resBad = 0, resSeen = 0, resTop = null;
  for (var r = 0; r < roster.length; r++) {
    var e = roster[r];
    if (e.a._cellIdx == null || e.a._cellIdx < 0) continue;
    resSeen++;
    var j = e.jit / (FR / 60);
    if (j > 0.35) resBad++;
    if (j > resWorst) { resWorst = j; resTop = { i: e.i, pose: e.a._cellPose, state: e.a.aiState || "", jps: Math.round(j * 1000) / 1000 }; }
  }
  var out = [], worst = 0, bad = 0;
  for (var r = 0; r < roster.length; r++) {
    var e = roster[r], a = e.a, p = a.group.position;
    var jps = e.jit / (FR / 60);
    if (jps > worst) worst = jps;
    if (jps > 0.35) bad++;
    if (r < 8) out.push({
      kind: e.kind, i: e.i, role: a.role || "", state: a.aiState || "", act: a.activityState || "",
      jps: Math.round(jps * 1000) / 1000, travps: Math.round((e.trav / (FR / 60)) * 100) / 100,
      x: Math.round(p.x * 10) / 10, z: Math.round(p.z * 10) / 10,
      cell: a._cellIdx == null ? null : a._cellIdx, pose: a._cellPose || null,
      sit: !!(a.char && a.char.sitting), lie: !!a._propLie, seat: !!a._propSeat,
      inRoom: !!(CBZ.pointInRoom && CBZ.pointInRoom(p.x, p.z)),
      tx: a.target ? Math.round(a.target.x * 10) / 10 : null,
      tz: a.target ? Math.round(a.target.z * 10) / 10 : null,
    });
  }
  var A = CBZ.cellblockAudit ? CBZ.cellblockAudit() : {};
  return { n: roster.length, worst: Math.round(worst * 1000) / 1000, bad: bad, top: out,
           postDrift: A.postDrift, seatDrift: A.seatDrift, occupied: A.occupied,
           resSeen: resSeen, resBad: resBad, resWorst: Math.round(resWorst * 1000) / 1000, resTop: resTop };`);

console.log("block:", block, " actors:", S.n, " residents:", S.occupied,
  " worstJitter:", S.worst, "m/s", " jittering(>0.35):", S.bad,
  " postDrift:", S.postDrift, " seatDrift:", S.seatDrift);
console.log("cell residents sampled:", S.resSeen, " vibrating:", S.resBad, " worst:", S.resWorst, "m/s",
  S.resTop ? JSON.stringify(S.resTop) : "");
for (const t of S.top) console.log("  ", JSON.stringify(t));
const uniqErrors = [...new Set(errors)].filter((e) => !/ProgressEvent/.test(e));
if (uniqErrors.length) console.log("page errors:", uniqErrors.slice(0, 8));

// A probe that passes before AND after proves nothing (mode-engine-check's
// law): --revert boots the same wing with the fix off and demands the fault
// back — residents posted outside their own box, and somebody vibrating.
const ok = REVERT
  ? (S.postDrift >= 1 && S.resBad >= 1)
  : (S.bad === 0 && S.worst <= 0.35 && S.resBad === 0 && S.postDrift === 0 && S.seatDrift === 0
     && S.occupied >= 1 && S.resSeen >= 1);
if (REVERT) {
  console.log(ok
    ? `PRISON-JITTER: ok — REVERT reproduces the fault (postDrift ${S.postDrift}, ${S.resBad} residents vibrating, worst ${S.resWorst} m/s)`
    : `PRISON-JITTER: FAIL — REVERT did not reproduce the fault (postDrift ${S.postDrift}, ${S.resBad} residents vibrating)`);
} else {
  console.log(ok
    ? `PRISON-JITTER: ok (${S.n} actors, ${S.occupied} cell residents, worst ${S.worst} m/s, postDrift 0)`
    : `PRISON-JITTER: FAIL (${S.bad} actors vibrating, worst ${S.worst} m/s, postDrift ${S.postDrift}, seatDrift ${S.seatDrift})`);
}
done(ok ? 0 : 1);
