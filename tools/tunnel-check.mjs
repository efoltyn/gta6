#!/usr/bin/env node
/* systems/tunnels.js — a tunnel is a hole lying down.
 *
 * The prison's "alternate routes" were trigger pairs and dressed corridors,
 * because until the ground had an inside there was nowhere under the yard to put
 * a tunnel. The claim now is that you can go under something and come up the
 * other side, on foot, continuously.
 *
 *   1. THE MIDDLE KEEPS ITS LID. From the sky, floorAt over the tunnel answers
 *      the SURFACE — otherwise it is a trench, not a tunnel, and the yard has a
 *      slot cut through it.
 *   2. THE INSIDE IS WALKABLE. Asked from inside, floorAt answers a floor below
 *      grade, and it is LEVEL along the run rather than a pipe you slide down.
 *   3. THE ROOF IS OVERHEAD. ceilAt reports the crown, so the M4 ceiling clamp
 *      keeps a head out of it.
 *   4. IT IS CONTINUOUS. Walking the length never surfaces and never teleports:
 *      every sample stays below grade, and the step between samples is small.
 *   5. THE ENDS ARE OPEN. You can get in and out.
 */
import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DUMP = false;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const serverPort = 10120 + Math.floor(Math.random() * 120);
const debugPort = 11800 + Math.floor(Math.random() * 120);
const profile = `/tmp/cbz-tunnel-${debugPort}`;
function findChrome() {
  if (process.env.CBZ_CHROME) return process.env.CBZ_CHROME;
  for (const c of ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
                   "/opt/pw-browsers/chromium/chrome-linux/chrome",
                   "/usr/bin/chromium", "/usr/bin/google-chrome"]) if (existsSync(c)) return c;
  const pw = "/opt/pw-browsers";
  if (existsSync(pw)) for (const d of readdirSync(pw).filter((x) => x.startsWith("chromium")).sort().reverse()) {
    for (const leaf of ["chrome-linux/chrome", "chrome-linux/headless_shell"]) {
      const c = path.join(pw, d, leaf); if (existsSync(c)) return c;
    }
  }
  return "chromium";
}
const base = `http://127.0.0.1:${serverPort}/?seed=90210`;
await rm(profile, { recursive: true, force: true });
await mkdir(profile, { recursive: true });
const server = spawn("python3", [path.join(ROOT, "tools/devserver.py")],
  { cwd: ROOT, env: { ...process.env, PORT: String(serverPort) }, stdio: "ignore" });
const chrome = spawn(findChrome(), ["--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
  "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--enable-webgl",
  "--mute-audio", "--window-size=900,600", `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${profile}`, base], { cwd: ROOT, stdio: "ignore" });

let ws = null, nextId = 1;
const pending = new Map(), browserErrors = [];
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const t = setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(method + " timed out")); } }, 300000);
    pending.set(id, { resolve, reject, timer: t });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expr) {
  const m = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  const r = m && m.result;
  if (r && r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text || "eval failed");
  return r && r.result && r.result.value;
}
const json = async (e) => JSON.parse(await evaluate(`JSON.stringify((function(){${e}})())`));

try {
  let page = null;
  for (let i = 0; i < 200 && !page; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
      page = list.find((p) => p.type === "page" && p.url.startsWith(`http://127.0.0.1:${serverPort}/`));
    } catch (_) {}
    if (!page) await sleep(250);
  }
  if (!page) throw new Error("no page");
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data);
    if (m.method === "Runtime.exceptionThrown") {
      const t = m.params?.exceptionDetails?.exception?.description || m.params?.exceptionDetails?.text || "";
      if (!/ProgressEvent/.test(t)) browserErrors.push(t.slice(0, 200));
      return;
    }
    if (!m.id || !pending.has(m.id)) return;
    const p = pending.get(m.id); pending.delete(m.id); clearTimeout(p.timer);
    if (m.error) p.reject(new Error(m.error.message)); else p.resolve(m);
  });
  await send("Runtime.enable"); await send("Page.enable");
  for (let i = 0; i < 220; i++) {
    if (await evaluate("document.readyState==='complete' && !!(window.CBZ && CBZ.setMode && CBZ.stepSim && CBZ.buildTunnel)")) break;
    await sleep(250);
  }

  const failures = [];
  const r = await json(`
    CBZ.setMode("prison"); CBZ.resetGame(); CBZ.setState("playing");
    window.requestAnimationFrame = function () { return 0; };
    var step = function (s) { var n = Math.round(s * 60); for (var i = 0; i < n; i++) { CBZ.hitstop = 0; CBZ.slowmo = 0; CBZ.stepSim(1/60); if (CBZ.player) { CBZ.player.hp = 100; CBZ.player.dead = false; } } };
    step(2);
    // a 46 m run under the yard, dog-legged so the polyline is exercised
    var A = { x: -18, z: 0 }, B = { x: 6, z: 0 }, C = { x: 22, z: 16 };
    var t = CBZ.buildTunnel([A, B, C], { r: 1.7, depth: 4.2, name: "yard-culvert" });
    if (!t) return { err: "buildTunnel refused: " + JSON.stringify(CBZ.tunnelAudit().why) };

    var surfMid = CBZ.groundBaseAt(B.x, B.z);
    var lidAbove = CBZ.floorAt(B.x, B.z);                 // 2-arg from the sky
    var inside   = CBZ.floorAt(B.x, B.z, t.pts[1].y);     // stood in the tunnel
    var ceil     = CBZ.ceilAt(B.x, B.z, t.pts[1].y);

    // 4: walk it. Sample along the axis and demand it stays under, smoothly.
    var samples = [], worstStep = 0, surfaced = 0, prev = null;
    for (var s = 0; s <= 120; s++) {
      var u = s / 120, px, pz;
      if (u < 0.5) { var v = u / 0.5; px = A.x + (B.x - A.x) * v; pz = A.z + (B.z - A.z) * v; }
      else { var v2 = (u - 0.5) / 0.5; px = B.x + (C.x - B.x) * v2; pz = B.z + (C.z - B.z) * v2; }
      var g = CBZ.groundBaseAt(px, pz);
      var f = CBZ.floorAt(px, pz, g - 4.2);
      samples.push(+f.toFixed(3));
      if (f > g - 1.0) surfaced++;
      if (prev !== null) worstStep = Math.max(worstStep, Math.abs(f - prev));
      prev = f;
    }
    // 2b: LEVEL, not a pipe — the floor across the tube's width must not dish
    var acrossA = CBZ.floorAt(B.x, B.z - 0.9, t.pts[1].y);
    var acrossB = CBZ.floorAt(B.x, B.z + 0.9, t.pts[1].y);

    // 5: the ends are open — from the sky, a mouth reaches the tunnel floor
    var endOpen = CBZ.floorAt(A.x, A.z);
    var endSurf = CBZ.groundBaseAt(A.x, A.z);

    return { surfMid: surfMid, lidAbove: lidAbove, inside: inside, ceil: ceil,
             axisY: t.pts[1].y, r: t.r, samples: samples.length, worstStep: +worstStep.toFixed(3),
             surfaced: surfaced, minSample: Math.min.apply(null, samples), maxSample: Math.max.apply(null, samples),
             acrossA: acrossA, acrossB: acrossB, endOpen: endOpen, endSurf: endSurf,
             mouths: t.mouths ? t.mouths.length : 0, audit: CBZ.tunnelAudit() };`);

  if (r.err) failures.push(r.err);
  else {
    const near = (a, b2, e) => Math.abs(a - b2) < (e || 1e-6);
    if (!near(r.lidAbove, r.surfMid, 0.01)) failures.push(`from the sky the tunnel's middle answers ${r.lidAbove}, not the surface ${r.surfMid} — that is a trench, not a tunnel`);
    if (!(r.inside < r.surfMid - 1.0)) failures.push(`inside, floorAt answered ${r.inside} with the surface at ${r.surfMid} — there is no tunnel to stand in`);
    if (!(r.ceil > r.inside && r.ceil < r.surfMid)) failures.push(`the crown read ${r.ceil}; it must be above the invert ${r.inside} and below the surface ${r.surfMid}`);
    if (r.surfaced !== 0) failures.push(`${r.surfaced}/${r.samples} samples along the run were at or above grade — the tunnel breaks the surface`);
    if (!(r.worstStep < 1.2)) failures.push(`the floor jumps ${r.worstStep} m between adjacent samples — that is a teleport, not a walk`);
    if (!near(r.acrossA, r.acrossB, 0.05)) failures.push(`the floor is not level across the tube (${r.acrossA} vs ${r.acrossB}) — it is a pipe you slide down`);
    if (!(r.mouths >= 2)) failures.push(`only ${r.mouths} mouths were cut — a tunnel with no ends is a sealed void`);
    if (!(r.endOpen < r.endSurf - 1.0)) failures.push(`the mouth does not reach down: floorAt from the sky answers ${r.endOpen} with the surface at ${r.endSurf}`);
  }
  if (browserErrors.length) failures.push(`browser errors: ${browserErrors.slice(0, 3).join(" | ")}`);

  console.log(JSON.stringify({ r, failures }, null, 2));
  if (failures.length) {
    console.error(`\nTUNNEL CHECK FAILED (${failures.length}):`);
    for (const f of failures) console.error("  - " + f);
    process.exitCode = 2;
  } else console.error(`\nTUNNEL CHECK PASSED — ${r.audit.metres} m under the yard with its lid intact, a level invert, a crown overhead, ${r.samples} continuous samples and two open ends.`);
} finally {
  try { if (ws) ws.close(); } catch (_) {}
  try { chrome.kill("SIGTERM"); } catch (_) {}
  try { server.kill("SIGTERM"); } catch (_) {}
  await sleep(200);
  await rm(profile, { recursive: true, force: true });
}
