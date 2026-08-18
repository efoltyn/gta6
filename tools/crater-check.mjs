#!/usr/bin/env node
/* systems/craters.js — ordnance leaves the ground changed.
 *
 * The claim is simple and was not true before: a bomb from the air makes a hole
 * you can see, drive into and come back to. So this drives the REAL blast entry
 * point city/aircraft.js uses for an airstrike, and then asks the ground.
 *
 *   1. A BIG BLAST DIGS. floorAt at the impact drops by most of the crater's
 *      depth, and the surfaces over the mouth are discarded — a crater with the
 *      road still drawn across it is the ring-you-fall-through bug again.
 *   2. A SMALL BLAST DOES NOT. A grenade scorches. If every explosion cratered,
 *      the city would turn to gravel in one firefight.
 *   3. TWO BOMBS ON ONE SPOT MERGE. One wider hole, not two rims fighting over
 *      the same metre of ground and burning two mask slots.
 *   4. IT PERSISTS. Still there after seconds of real simulation.
 *   5. IT OBEYS THE PLACEMENT LAW. No crater through a building footprint.
 */
import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DUMP = false;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const serverPort = 9840 + Math.floor(Math.random() * 120);
const debugPort = 11400 + Math.floor(Math.random() * 120);
const profile = `/tmp/cbz-crater-${debugPort}`;
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
    if (await evaluate("document.readyState==='complete' && !!(window.CBZ && CBZ.setMode && CBZ.stepSim && CBZ.groundCrater)")) break;
    await sleep(250);
  }

  const failures = [];
  const boot = await json(`
    CBZ.setMode("city"); CBZ.resetGame(); CBZ.setState("playing");
    window.requestAnimationFrame = function () { return 0; };
    window.__c = {
      step: function (s) { var n = Math.round(s * 60); for (var i = 0; i < n; i++) { CBZ.hitstop = 0; CBZ.slowmo = 0; CBZ.stepSim(1/60); if (CBZ.player) { CBZ.player.hp = 100; CBZ.player.dead = false; } } },
      // flat ground clear of buildings, found the way the game finds it
      site: function () {
        var J = CBZ.roadJunctions ? (CBZ.roadJunctions() || []) : [];
        for (var i = 0; i < J.length; i++) {
          var can = CBZ.groundShaftCanOpen ? CBZ.groundShaftCanOpen(J[i].x, J[i].z, 9) : { ok: true };
          if (can.ok) return { x: J[i].x, z: J[i].z };
        }
        return null;
      },
      lid: function (h) {
        var box = new THREE.Box3(), n = 0;
        CBZ.scene.traverse(function (o) {
          if (!o.isMesh || !o.geometry || !o.material || Array.isArray(o.material)) return;
          for (var p = o; p; p = p.parent) if (p.userData && p.userData.groundShaft) return;
          var m = o.material;
          if (m.fog !== false && !(m.defines && m.defines.CBZ_NOMASK)) return;   // masked: fine
          if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
          box.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
          if (box.max.y - box.min.y > 3) return;
          if (box.max.y < h.gy - 3 || box.min.y > h.gy + 0.35) return;
          if (Math.max(box.max.x - box.min.x, box.max.z - box.min.z) < 1.5) return;
          if (box.max.x < h.x - h.mouth || box.min.x > h.x + h.mouth) return;
          if (box.max.z < h.z - h.mouth || box.min.z > h.z + h.mouth) return;
          n++;
        });
        return n;
      },
    };
    __c.step(3);
    return { mode: CBZ.game.mode, site: __c.site(), audit: CBZ.craterAudit() };`);
  if (!boot.site) failures.push("no legal bombing site found in the city — the check cannot run");

  const run = boot.site ? await json(`
    var s = ${JSON.stringify(boot.site)};
    var gy = CBZ.groundBaseAt(s.x, s.z);
    var before = CBZ.floorAt(s.x, s.z);

    // 2. a grenade must NOT dig
    CBZ.cityExplosion(s.x + 90, s.z + 90, { power: 0.9, radius: 4, y: gy + 1 });
    var smallDug = CBZ.craterAudit().dug;

    // 1. the real airstrike path city/aircraft.js uses
    CBZ.cityAirstrikeExplosion(s.x, s.z, { power: 3.0, radius: 16, byPlayer: true, y: gy });
    var a1 = CBZ.craterAudit();
    var S = CBZ.groundShafts || [];
    var h = null; for (var i = 0; i < S.length; i++) if (S[i].crater) h = S[i];
    var after = h ? CBZ.floorAt(h.x, h.z) : before;
    var lid = h ? __c.lid(h) : -1;
    var r1 = h ? h.r : 0;

    // 3. a second bomb on the same spot must WIDEN, not stack
    CBZ.cityAirstrikeExplosion(s.x + 3, s.z + 3, { power: 3.0, radius: 16, byPlayer: true, y: gy });
    var a2 = CBZ.craterAudit();
    var S2 = CBZ.groundShafts || []; var h2 = null;
    for (var j = 0; j < S2.length; j++) if (S2[j].crater) h2 = S2[j];
    var r2 = h2 ? h2.r : 0;

    // 4. it persists
    __c.step(4);
    var S3 = CBZ.groundShafts || []; var stillThere = 0;
    for (var k = 0; k < S3.length; k++) if (S3[k].crater) stillThere++;
    var floorAfterTime = h2 ? CBZ.floorAt(h2.x, h2.z) : 0;

    // 5. the placement law still refuses a building footprint
    var refusedBefore = CBZ.craterAudit().refused;
    /* FAR from the crater we just dug, or the hit MERGES into it instead of
       being refused, and the test measures the merge path by accident. */
    /* The lot has to be one the law refuses FOR BEING A BUILDING — some lots
       sit over water and would be refused for that instead, which would let a
       broken building test pass on the wrong reason. And it must be far from the
       crater we just dug, or the hit merges into it rather than being judged. */
    var L = (CBZ.city && CBZ.city.arena && CBZ.city.arena.lots) || [];
    var lot = null, lotWhy = null;
    for (var q = 0; q < L.length; q++) {
      var Lq = L[q];
      if (!Lq || !Lq.building) continue;
      /* A lot record carries cx/cz, NOT x/z — the same confusion that hid the
         building rule for a whole release, and which this check reproduced on
         its first attempt. Read it the way the law now reads it. */
      var lxq = Lq.cx != null ? Lq.cx : Lq.x, lzq = Lq.cz != null ? Lq.cz : Lq.z;
      if (lxq == null || lzq == null) continue;
      if (h2 && Math.hypot(lxq - h2.x, lzq - h2.z) < 140) continue;
      var cs = CBZ.groundShaftCanOpen ? CBZ.groundShaftCanOpen(lxq, lzq, 9) : null;
      if (!cs || cs.ok || cs.why !== "building") continue;
      lot = { x: lxq, z: lzq }; lotWhy = cs.why; break;
    }
    var dugBeforeLot = CBZ.craterAudit().dug;
    if (lot) CBZ.cityAirstrikeExplosion(lot.x, lot.z, { power: 3.0, radius: 16, y: CBZ.groundBaseAt(lot.x, lot.z) });
    var refusedAfter = CBZ.craterAudit().refused;
    var dugAfterLot = CBZ.craterAudit().dug;
    /* Isolate the wrapper from the law: call the primitive directly at the same
       spot and record BOTH the verdict and what canOpen says about it. */
    var directBefore = CBZ.craterAudit();
    var directRet = lot ? CBZ.groundCrater(lot.x, lot.z, { power: 3.0, radius: 16 }) : "noLot";
    var directAfter = CBZ.craterAudit();
    var canSay = lot && CBZ.groundShaftCanOpen ? CBZ.groundShaftCanOpen(lot.x, lot.z, 9) : null;

    // let the fireball and smoke clear: the record shot is of the GROUND, and a
    // photograph of a blast proves nothing about whether a hole is there
    __c.step(11);
    if (h2) {
      var c = CBZ.camera;
      c.aspect = 900/600; c.fov = 55; c.near = 0.4; c.far = 20000;
      c.position.set(h2.x + h2.r * 0.6, h2.gy + 46, h2.z + h2.r * 1.2);
      c.lookAt(h2.x, h2.gy - h2.depth * 0.5, h2.z);
      c.updateProjectionMatrix(); c.updateMatrixWorld(true);
      if (CBZ.skySync) CBZ.skySync();
      var cv = CBZ.renderer.domElement;
      for (var w = 0, ch = Array.prototype.slice.call(document.body.children); w < ch.length; w++) {
        if (ch[w] === cv || (cv && ch[w].contains && ch[w].contains(cv))) continue;
        ch[w].style.visibility = "hidden";
      }
      try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (e) {}
    }
    return { gy: gy, before: before, after: after, drop: +(before - after).toFixed(2),
             depth: h ? +h.depth.toFixed(2) : 0, lid: lid, r1: +r1.toFixed(2), r2: +r2.toFixed(2),
             smallDug: smallDug, a1: a1, a2: a2, stillThere: stillThere,
             floorAfterTime: floorAfterTime, lotTried: !!lot,
             refusedDelta: refusedAfter - refusedBefore,
             dugAtLot: dugAfterLot - dugBeforeLot,
             lotAt: lot ? [Math.round(lot.x), Math.round(lot.z)] : null, lotWhy: lotWhy,
             directRet: directRet === "noLot" ? "noLot" : (directRet ? "DUG" : "refused"),
             directRefusedDelta: directAfter.refused - directBefore.refused,
             directWhy: directAfter.refusedWhy, canSay: canSay };` ) : null;

  if (run) {
    if (run.smallDug !== 0) failures.push(`a grenade dug a crater (dug=${run.smallDug}) — the city will turn to gravel`);
    if (!(run.a1.dug >= 1)) failures.push("the airstrike path did not dig a crater at all");
    if (!(run.drop > run.depth * 0.4)) failures.push(`floorAt dropped only ${run.drop} m into a ${run.depth} m crater`);
    if (run.lid !== 0) failures.push(`${run.lid} ground surfaces still draw over the crater mouth — a crater you fall through`);
    if (!(run.a2.widened >= 1)) failures.push("a second bomb on the same spot did not widen the crater");
    if (!(run.r2 > run.r1)) failures.push(`the second bomb did not make it bigger (${run.r1} -> ${run.r2})`);
    if (run.a2.dug !== run.a1.dug) failures.push(`the second bomb added a SECOND crater instead of merging (dug ${run.a1.dug} -> ${run.a2.dug})`);
    if (!(run.stillThere >= 1)) failures.push("the crater did not survive four seconds of simulation");
    if (Math.abs(run.floorAfterTime - run.after) > 3) failures.push("the crater floor moved after the fact");
    if (!run.lotTried) failures.push("no building lot in the city is refused by the placement law — either the law is broken or this check cannot see it. Not skipping: that is how the rule hid before.");
    if (run.lotTried && run.dugAtLot !== 0) failures.push("a bomb on a building footprint DUG A CRATER — the placement law is not being applied, and a tower is now standing over a hole");
    if (run.lotTried && run.refusedDelta < 1) failures.push("a bomb on a building footprint was neither dug nor refused — the law never ran");
    if (run.lotTried && run.directRet === "DUG") failures.push("calling groundCrater directly on a building footprint DUG one — the law is bypassed");
  }
  if (browserErrors.length) failures.push(`browser errors: ${browserErrors.slice(0, 3).join(" | ")}`);

  if (run) {
    const png = await send("Page.captureScreenshot", { format: "png" });
    const { writeFile, mkdir: mk } = await import("node:fs/promises");
    await mk(path.join(ROOT, "tools/shots/crater-qa"), { recursive: true });
    await writeFile(path.join(ROOT, "tools/shots/crater-qa/crater.png"), Buffer.from(png.result.data, "base64"));
  }
  console.log(JSON.stringify({ boot: { site: boot.site }, run, browserErrors, failures }, null, 2));
  if (failures.length) {
    console.error(`\nCRATER CHECK FAILED (${failures.length}):`);
    for (const f of failures) console.error("  - " + f);
    process.exitCode = 2;
  } else console.error(`\nCRATER CHECK PASSED — an airstrike digs ${run.drop} m, a grenade does not, two bombs merge into one ${run.r2} m hole, and the ground over it is gone.`);
} finally {
  try { if (ws) ws.close(); } catch (_) {}
  try { chrome.kill("SIGTERM"); } catch (_) {}
  try { server.kill("SIGTERM"); } catch (_) {}
  await sleep(200);
  await rm(profile, { recursive: true, force: true });
}
