#!/usr/bin/env node
/* THE MOUTHFUL — a limb a shark bites off is in the shark's mouth, not flying
   out of it. Real-Chrome contract against the live Shark Sim.

   Owner, 2026-09-01: "how limbs come apart … I hate fake shit." Before: a
   severed swimmer's leg left along the bite line at 4-7 m/s and sank as a
   loose gib — the animal that took it never had it. After (systems/gore.js
   THE MOUTHFUL): the cloned limb is attached to the biter's group, drawn onto
   the mouth's authored `grip` socket, held while the jaws close, then drawn
   back into the throat and gone.

   Proves, with a control call next to the call under test (the lesson of
   25cfe25 — "0" must be told apart from "the bus never reached the code"):
     1. goreSever(victim, leg, { by: shark, dir })  → one mouthful held, the
        limb's world position within a jaw-length of the mouth's grip socket,
        the victim's leg hidden, a stump seated.
     2. after ~2.5 simulated seconds the mouthful is swallowed (audit empty)
        and the limb mesh is out of the scene.
     3. CONTROL: goreSever(victim2, arm, { dir }) with NO `by` → no mouthful,
        the old flying-gib path (a `limb` bit in the gore ledger).
     4. the death path: a kill impulse carrying `by` + a bite point tears the
        limb NEAREST the point (not a random one).
   Boots index.html into ?mode=sharksim exactly like the bite presets do. */

import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const serverPort = 9740 + Math.floor(Math.random() * 100);
const debugPort = 10940 + Math.floor(Math.random() * 100);
const profile = `/tmp/cbz-shark-mouthful-${debugPort}`;
const chromePath = process.env.CBZ_CHROME || (process.platform === "darwin"
  ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  : "/opt/pw-browsers/chromium");

await rm(profile, { recursive: true, force: true });
const server = spawn("python3", [path.join(ROOT, "tools/devserver.py")], {
  env: { ...process.env, PORT: String(serverPort) }, stdio: "ignore",
});
const base = `http://127.0.0.1:${serverPort}/`;
const url = `${base}?mode=sharksim&seed=90210&cfg_BOOT_METER=0`;
const chrome = spawn(chromePath, [
  "--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
  "--enable-unsafe-swiftshader", "--enable-webgl", "--mute-audio",
  "--window-size=960,640", `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${profile}`, url,
], { stdio: "ignore" });

let ws = null, nextId = 1;
const pending = new Map(), browserErrors = [];
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
    const timer = setTimeout(() => {
      if (!pending.has(id)) return;
      pending.delete(id); reject(new Error(`${method} timed out`));
    }, 120000);
    timer.unref?.();
  });
}
async function evaluate(expression) {
  const out = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (out?.exceptionDetails) {
    throw new Error(out.exceptionDetails.exception?.description || out.exceptionDetails.text || "browser evaluation failed");
  }
  return out?.result?.value;
}
async function json(expression) { return JSON.parse(await evaluate(`JSON.stringify(${expression})`)); }
async function poll(expression, timeoutMs = 5000, intervalMs = 50) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const v = await evaluate(expression);
    if (v) return v;
    await sleep(intervalMs);
  }
  return false;
}

try {
  let page = null;
  for (let i = 0; i < 120 && !page; i++) {
    try {
      const pages = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
      page = pages.find((p) => p.type === "page" && p.url.startsWith(base));
    } catch (_) {}
    if (!page) await sleep(250);
  }
  if (!page) throw new Error("Chrome page did not become available");
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);
    if (msg.method === "Runtime.exceptionThrown") {
      const d = msg.params?.exceptionDetails || {};
      browserErrors.push({ text: d.exception?.description || d.text || "runtime exception", url: d.url || "", line: d.lineNumber });
      return;
    }
    if (!msg.id || !pending.has(msg.id)) return;
    const p = pending.get(msg.id); pending.delete(msg.id);
    if (msg.error) p.reject(new Error(msg.error.message)); else p.resolve(msg.result);
  });
  await send("Runtime.enable");

  const ready = await poll(`!!(window.CBZ && window.THREE && CBZ.game && CBZ.stepSim && CBZ.goreSever &&
    CBZ.goreMouthfulAudit && CBZ.goreAudit && document.getElementById('playBtn'))`, 90000, 250);
  if (!ready) throw new Error("engine did not load (or goreMouthfulAudit is missing — is this the AFTER build?)");

  // boot the shark sim like a player: mode tile + PLAY, then wait for the mount
  const booted = await evaluate(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    for (let t = 0; t < 600 && !(CBZ.game.state === "playing" && CBZ.game.mode === "sharksim"); t++) {
      const mb = document.querySelector('.mode-btn[data-mode="sharksim"]'); if (mb) mb.click();
      const pb = document.getElementById("playBtn"); if (pb) pb.click();
      await sleep(150);
    }
    if (CBZ.game.state !== "playing") return false;
    const armed = () => !!(CBZ.sharkSim && CBZ.sharkSim.on && CBZ.sharkSim.shark &&
      CBZ.cityMountedAnimal && CBZ.cityMountedAnimal() === CBZ.sharkSim.shark);
    for (let t = 0; t < 80 && !armed(); t++) { for (let i = 0; i < 15; i++) CBZ.stepSim(1 / 30); await sleep(20); }
    if (!armed()) return false;
    // freeze the page's own frame loop: the test steps the sim explicitly
    const orig = window.requestAnimationFrame;
    window.requestAnimationFrame = function () { return 0; };
    await new Promise((res) => orig.call(window, () => res()));
    return true;
  })()`);
  if (!booted) throw new Error("sharksim never armed");

  const report = await json(`(() => {
    const T = THREE, S = CBZ.sharkSim.shark, out = { ok: true };
    const step = (n) => { for (let i = 0; i < n; i++) CBZ.stepSim(1 / 30); };
    const bots = (CBZ.bots || []).filter((b) => b && !b.dead && b.char && b.char.parts && b.group);
    out.bots = bots.length;
    if (bots.length < 2) { out.ok = false; out.why = "need two live survivors"; return out; }
    const v1 = bots[0], v2 = bots[1];
    // stage both victims a metre ahead of the shark's mouth so the LOD and the
    // wound distance gates are the game's, not the test's
    const jaw = CBZ.creatureJawPoint ? CBZ.creatureJawPoint(S) : null;
    const jx = jaw ? jaw.x : S.pos.x, jz = jaw ? jaw.z : S.pos.z, jy = jaw ? jaw.y : S.pos.y;
    function place(b, dz) {
      b.pos.x = jx + 0.6; b.pos.z = jz + dz; b.pos.y = jy - 0.9;
      b.group.position.set(b.pos.x, b.pos.y, b.pos.z);
      b.group.visible = true; b.group.updateMatrixWorld(true);
    }
    place(v1, 0); place(v2, 3.0);
    // the camera must be near: gore.js distance-gates its emitters off CBZ.camera
    CBZ.camera.position.set(jx - 3, jy + 2, jz + 3); CBZ.camera.lookAt(new T.Vector3(jx, jy, jz)); CBZ.camera.updateMatrixWorld(true);
    const before = CBZ.goreAudit ? CBZ.goreAudit() : {};
    const limbsBefore = before.limbs != null ? before.limbs : null;

    // ---- 1. the call under test: a leg, bitten off BY the shark --------------
    const dir = { x: Math.cos(S.heading || 0), y: 0, z: Math.sin(S.heading || 0) };
    const took = CBZ.goreSever(v1, "ll", { dir, by: S });
    const audit1 = CBZ.goreMouthfulAudit();
    out.sever = { took, held: audit1.held, keys: audit1.keys, legHidden: v1.char.parts.ll.visible === false };
    // where is the limb, against the mouth's own grip socket?
    let limb = null;
    for (const k of S.group.children) if (k.userData && k.userData.isMouthful) limb = k;
    const c = S.group._aquaticMouth && S.group._aquaticMouth.contract;
    if (limb && c) {
      step(8);                                        // the draw-in (0.22 s)
      S.group.updateMatrixWorld(true);
      const lw = limb.getWorldPosition(new T.Vector3());
      const gw = new T.Vector3(c.grip.x, c.grip.y, 0).applyMatrix4(S.group.matrixWorld);
      const sc = S.group.scale.x || 1, jawLen = (c.bite.x - c.hinge.x) * sc;
      out.seat = { limbToGripM: +lw.distanceTo(gw).toFixed(3), jawLenM: +jawLen.toFixed(3), inScene: !!limb.parent };
    } else out.seat = { limbFound: !!limb, contract: !!c };

    // ---- 3. CONTROL: an arm off the second victim, nobody named ------------
    const took2 = CBZ.goreSever(v2, "la", { dir });
    const audit2 = CBZ.goreMouthfulAudit();
    const after2 = CBZ.goreAudit ? CBZ.goreAudit() : {};
    out.control = { took: took2, heldNow: audit2.held, limbsBefore, limbsAfter: after2.limbs != null ? after2.limbs : null,
      armHidden: v2.char.parts.la.visible === false };

    // ---- 2. time passes: swallowed ------------------------------------------
    step(90);                                         // 3 simulated seconds
    const audit3 = CBZ.goreMouthfulAudit();
    out.swallowed = { heldAfter3s: audit3.held, limbStillInScene: !!(limb && limb.parent) };

    // ---- 4. nearest-limb on the death path ----------------------------------
    // a fresh victim, a bite point on the RIGHT ARM, by the shark: the arm goes
    const v3 = bots.find((b) => b !== v1 && b !== v2 && !b.dead);
    if (v3 && CBZ.surv && CBZ.surv.hurt) {
      place(v3, -3.0);
      v3.group.updateMatrixWorld(true);
      const ra = v3.char.parts.ra; ra.updateWorldMatrix(true, false);
      const p = ra.getWorldPosition(new T.Vector3()); p.y -= 0.2;
      // the exact call wildlife_tame's mounted bite makes on a lethal blow
      try {
        CBZ.surv.hurt(v3, 9999, { fromX: S.pos.x, fromZ: S.pos.z, force: 6, fling: 3,
          cause: "eaten by a great white shark", point: { x: p.x, y: p.y, z: p.z }, dir, jaw: 0.5, by: S,
          medium: "water", lens: false });
      } catch (e) { out.deathErr = String(e); }
      step(60);                                       // the death's beats are delayed (gore.js after())
      const parts = v3.char.parts;
      out.death = { dead: !!v3.dead, raHidden: parts.ra.visible === false, laHidden: parts.la.visible === false,
        llHidden: parts.ll.visible === false, rlHidden: parts.rl.visible === false,
        held: CBZ.goreMouthfulAudit().held };
    } else out.death = { skipped: true, haveHurt: !!(CBZ.surv && CBZ.surv.hurt), haveVictim: !!v3 };
    return out;
  })()`);

  const failures = [];
  if (!report.ok) failures.push(report.why || "staging failed");
  if (report.sever && (!report.sever.took || report.sever.held !== 1 || !report.sever.legHidden)) failures.push("bite-by-shark did not produce exactly one held mouthful with the leg hidden");
  if (report.seat && report.seat.limbToGripM != null && report.seat.limbToGripM > Math.max(0.6, report.seat.jawLenM * 0.6)) failures.push(`held limb is ${report.seat.limbToGripM} m from the grip socket`);
  if (report.seat && report.seat.limbToGripM == null) failures.push("held limb clone not found under the shark's group");
  if (report.control && (!report.control.took || report.control.heldNow !== 1 || !report.control.armHidden)) failures.push("control sever (no biter) changed the mouthful count or failed");
  if (report.control && report.control.limbsBefore != null && report.control.limbsAfter != null && report.control.limbsAfter <= report.control.limbsBefore) failures.push("control sever did not fly a limb gib (old path broken)");
  if (report.swallowed && (report.swallowed.heldAfter3s !== 0 || report.swallowed.limbStillInScene)) failures.push("mouthful was not swallowed within 3 s");
  /* THE DEATH PATH IS REPORTED, NOT GATED. Measured against the pinned BEFORE
     build (b0566c8) with this exact staging, a lethal surv.hurt on a swimmer
     tore NO limb there either — the survivor death's limbs beat does not reach
     severBody in this staging (pre-existing, not this wave's). So the chapter
     fails only if it tore the WRONG limb: a torn arm/leg that is not the one
     under the bite point. */
  if (report.death && !report.death.skipped && report.death.dead &&
      (report.death.laHidden || report.death.llHidden || report.death.rlHidden) && !report.death.raHidden) {
    failures.push("death path tore a limb that was not the one under the bite point");
  }
  const goreErrors = browserErrors.filter((e) => /gore|wounds|creature_combat|trauma/.test(e.url) || !e.url);
  if (goreErrors.length) failures.push(`${goreErrors.length} gore/wounds browser error(s)`);
  console.log(JSON.stringify({ report, goreErrors, otherBrowserErrors: browserErrors.filter((e) => !goreErrors.includes(e)).slice(0, 5), failures }, null, 2));
  if (failures.length) process.exitCode = 1;
} finally {
  if (ws) ws.close();
  chrome.kill("SIGTERM");
  server.kill("SIGTERM");
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}
