#!/usr/bin/env node
/* systems/solidground.js — the ground model's ratchet.
 *
 * This file exists for ONE reason: solidground.js took ownership of CBZ.floorAt
 * away from five separate assignment sites across three modes, and the ground
 * is what every other system stands on. The swap is only safe if a world with
 * no holes in it answers EXACTLY as it did before, so that is the first and
 * loudest assertion here.
 *
 *   --dump   print a golden grid of floorAt samples as JSON and exit. Sample
 *            the tree before a change and after it and diff: identical output
 *            is the proof, and it is how the M2 landing was verified.
 *
 * The four claims:
 *   1. ONE OWNER. CBZ.floorAt is solidground's, in every mode, after any number
 *      of mode switches. The old chain re-captured itself on reset and recursed
 *      to a stack overflow (city/mode.js records the crash: "the prison leg
 *      after a city visit crashed the update loop every frame").
 *   2. THE FAST PATH IS THE OLD PATH. With zero carvings, floorAt(x,z) is
 *      bit-equal to the mode's own base field. Not close — equal.
 *   3. fromY SELECTS. With a lid, the same (x,z) answers the street from above
 *      and the room from below; omitting fromY answers the topmost solid, which
 *      is what every 2-arg caller (wheels, spawns, nav) wants.
 *   4. THE CEILING EXISTS. ceilAt is Infinity in open air and the lid's
 *      underside beneath one — physics.js has never clamped ascent, so a lid
 *      without this is a roof you can jump through.
 */
import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DUMP = process.argv.includes("--dump");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const serverPort = 9700 + Math.floor(Math.random() * 120);
const debugPort = 11200 + Math.floor(Math.random() * 120);
const profile = `/tmp/cbz-ground-${debugPort}`;
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
    if (await evaluate("document.readyState==='complete' && !!(window.CBZ && CBZ.setMode && CBZ.stepSim && CBZ.floorAt)")) break;
    await sleep(250);
  }

  await evaluate(`window.__g = {
    grid: function (cx, cz, span, n) {
      var out = [];
      for (var i = 0; i < n; i++) for (var j = 0; j < n; j++) {
        var x = cx - span + (2 * span * i) / (n - 1), z = cz - span + (2 * span * j) / (n - 1);
        out.push(+CBZ.floorAt(x, z).toFixed(6));
      }
      return out;
    },
    enter: function (m) { CBZ.setMode(m); CBZ.resetGame(); CBZ.setState("playing"); },
  }; true;`);

  const failures = [];
  const report = { modes: {}, dump: {} };

  for (const m of ["city", "survival", "prison"]) {
    const r = await json(`
      try { __g.enter("${m}"); } catch (e) { return { err: String(e).slice(0,180) }; }
      var A = (CBZ.game.mode === "survival" && CBZ.surv) ? CBZ.surv.arena
            : (CBZ.city && CBZ.city.arena) ? CBZ.city.arena : null;
      var cx = A && A.center ? A.center.x : 0, cz = A && A.center ? A.center.z : 0;
      // CLAIM 2: with zero carvings the owner must return the base field EXACTLY
      /* --dump must also run on a build that PREDATES solidground.js — that is
         the whole point of a golden grid — so nothing here may assume it. */
      var GB = CBZ.groundBaseAt || null;
      var drift = 0, worst = 0, n = 0;
      if (GB) for (var i = -8; i <= 8; i++) for (var j = -8; j <= 8; j++) {
        var x = cx + i * 11.5, z = cz + j * 11.5;
        var f = CBZ.floorAt(x, z), b = GB(x, z);
        n++; if (f !== b) { drift++; var d = Math.abs(f - b); if (d > worst) worst = d; }
      }
      return {
        mode: CBZ.game.mode, owner: !!(CBZ.floorAt && CBZ.floorAt._solid),
        carvings: (CBZ.carvings || []).length, samples: n, drift: drift, worst: worst,
        audit: CBZ.solidAudit ? CBZ.solidAudit() : null,
        grid: __g.grid(cx, cz, 90, 9),
        ceilOpen: CBZ.ceilAt ? CBZ.ceilAt(cx, cz, 1) : null,
      };`);
    report.modes[m] = r;
    report.dump[m] = r.grid;
    if (r.err) { failures.push(`${m}: could not enter the mode (${r.err})`); continue; }
    if (!DUMP && !r.owner) failures.push(`${m}: CBZ.floorAt is not solidground's — something re-assigned it`);
    if (!DUMP && r.hasBase && r.carvings === 0 && r.drift !== 0) {
      failures.push(`${m}: floorAt differs from the base field at ${r.drift}/${r.samples} samples (worst ${r.worst}) with ZERO carvings — the fast path is not byte-identical`);
    }
    if (r.ceilOpen !== null && r.ceilOpen !== Infinity && r.ceilOpen !== null) {
      // JSON has no Infinity; it arrives as null. Anything numeric is a bug.
      if (typeof r.ceilOpen === "number") failures.push(`${m}: ceilAt reports a ceiling (${r.ceilOpen}) in open air`);
    }
  }

  if (DUMP) { console.log(JSON.stringify(report.dump)); process.exit(0); }

  // CLAIM 1: survive the mode churn that used to recurse to a stack overflow
  const churn = await json(`
    var seq = ["city", "prison", "city", "survival", "prison", "city"], ok = [];
    for (var i = 0; i < seq.length; i++) {
      try { __g.enter(seq[i]); ok.push(CBZ.floorAt(3, 3)); }
      catch (e) { return { crashed: seq[i], err: String(e).slice(0, 180) }; }
    }
    return { crashed: null, answers: ok, owner: !!(CBZ.floorAt && CBZ.floorAt._solid) };`);
  report.churn = churn;
  if (churn.crashed) failures.push(`mode churn crashed entering ${churn.crashed}: ${churn.err} — the recursion is back`);
  if (!churn.crashed && !churn.owner) failures.push("after six mode switches CBZ.floorAt is no longer solidground's");

  // CLAIMS 3 + 4: a lid, from both sides, plus the ceiling
  const lid = await json(`
    __g.enter("city");
    var x = 40, z = 40, surf = CBZ.groundBaseAt(x, z);
    var c = CBZ.addCarving({ kind: "box", cx: x, cz: z, hw: 6, hd: 6, yaw: 0,
                             y0: surf - 9, y1: surf - 3, open: false });
    var fromSky   = CBZ.floorAt(x, z);            // 2-arg: the topmost solid = the street
    var fromAbove = CBZ.floorAt(x, z, surf + 1);  // standing on the lid
    var fromBelow = CBZ.floorAt(x, z, surf - 8);  // standing in the room
    var ceilInside = CBZ.ceilAt(x, z, surf - 8);  // the lid's underside
    var ceilOutside = CBZ.ceilAt(x + 40, z + 40, surf + 1);
    var inside = !!CBZ.carvingAt(x, z, surf - 8), under = !!CBZ.underLid(x, z, surf - 8);
    CBZ.removeCarving(c);
    var after = CBZ.floorAt(x, z);
    return { surf: surf, fromSky: fromSky, fromAbove: fromAbove, fromBelow: fromBelow,
             ceilInside: ceilInside, ceilOutside: ceilOutside, inside: inside, under: under,
             after: after, carvingsAfter: (CBZ.carvings || []).length };`);
  report.lid = lid;
  const near = (a, b) => Math.abs(a - b) < 1e-6;
  if (!near(lid.fromSky, lid.surf)) failures.push(`a 2-arg floorAt over a lid answered ${lid.fromSky}, not the street ${lid.surf} — a car would drive into the bunker`);
  if (!near(lid.fromAbove, lid.surf)) failures.push(`standing on the lid, floorAt answered ${lid.fromAbove}, not the street ${lid.surf}`);
  if (!near(lid.fromBelow, lid.surf - 9)) failures.push(`standing in the room, floorAt answered ${lid.fromBelow}, not the room floor ${lid.surf - 9}`);
  if (!near(lid.ceilInside, lid.surf - 3)) failures.push(`the lid's underside read ${lid.ceilInside}, not ${lid.surf - 3} — a jump would go through the street`);
  if (lid.ceilOutside !== null) failures.push(`ceilAt found a ceiling in open air beside the lid (${lid.ceilOutside})`);
  if (!lid.inside) failures.push("carvingAt does not report a point inside the room");
  if (!lid.under) failures.push("underLid does not report a point beneath an intact lid");
  if (!near(lid.after, lid.surf)) failures.push(`removing the carving did not restore the ground (${lid.after} vs ${lid.surf})`);
  if (lid.carvingsAfter !== 0) failures.push("removeCarving left the record behind");

  if (browserErrors.length) failures.push(`browser errors: ${browserErrors.slice(0, 3).join(" | ")}`);

  if (DUMP) { console.log(JSON.stringify(report.dump)); }
  else {
    console.log(JSON.stringify(report, null, 2));
    if (failures.length) {
      console.error(`\nGROUND CHECK FAILED (${failures.length}):`);
      for (const f of failures) console.error("  - " + f);
      process.exitCode = 2;
    } else {
      console.error("\nGROUND CHECK PASSED — one owner across six mode switches, the zero-carving path is bit-equal to the base field, and a lid answers street from above and room from below.");
    }
  }
} finally {
  try { if (ws) ws.close(); } catch (_) {}
  try { chrome.kill("SIGTERM"); } catch (_) {}
  try { server.kill("SIGTERM"); } catch (_) {}
  await sleep(200);
  await rm(profile, { recursive: true, force: true });
}
