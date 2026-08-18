#!/usr/bin/env node
/*
  tools/survival-deathcam-check.mjs — DOES DYING ON THE ISLAND SHOW YOU YOUR DEATH?

  Owner (2026-08-16): in Gang City "when I'm killed, it goes to a third person
  and shows me my death, which is really cool. It should do that as well for
  natural disaster." The disaster game answered with a banner and a camera that
  drifted UP AND AWAY from the body — the one thing on screen it never looked
  at was your death. The fix gives survival the city's WASTED grammar: the
  ragdoll fling plays clean (banner held ~1.8s), the camera swoops into the
  city replay's close orbit of the fallen body, then hands its bearing to the
  original pulled-back chaos drift as one continuous move.

  This probe boots the REAL game, enters Disaster Survival, kills the player
  through the real damage path (CBZ.surv.hurt), then steps the sim in one
  synchronous burst (no RAF interleave) sampling the live camera. It asserts:

    1. death arms surv.deathCam + spectate the same frame;
    2. the ELIMINATED banner is HELD through the fling beat, then lands;
    3. the settled replay holds the city orbit's framing (planar ~5.5 m,
       lens ~3 m over the body) and LOOKS AT the body (dot >= 0.96);
    4. the orbit actually sweeps (not a static shot) and the fov eases to 48;
    5. the replay ends on its beat, the hand-off is continuous (no snap-cut),
       and the camera then pulls out to the high chaos framing;
    6. no console errors anywhere in the sequence.

  SURV_DEATHCAM=false reverts the feature; this gate then fails by design —
  drop it from the loop if the flag is ever flipped for good.

  Usage: node tools/survival-deathcam-check.mjs [--seed 90210] [--url URL]
                                                [--shots]
  (starts its own devserver when --url is omitted; --shots renders three real
  frames — pre-death / mid-replay / post-pullout — into tools/shots/)
*/

import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const token = process.argv[i];
  if (token.startsWith("--")) {
    args[token.slice(2)] = process.argv[i + 1] && !process.argv[i + 1].startsWith("--")
      ? process.argv[++i] : true;
  }
}
const SEED = Number(args.seed || 90210);
const SHOTS = !!args.shots;

const webPort = 8600 + Math.floor(Math.random() * 300);
const debugPort = 10100 + Math.floor(Math.random() * 300);
const url = args.url ? String(args.url) : `http://127.0.0.1:${webPort}/`;
const chromeBin = process.env.CBZ_CHROME || (process.platform === "darwin"
  ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  : "/opt/pw-browsers/chromium");
const profileDir = await mkdtemp(path.join(tmpdir(), "cbz-survdc-"));
const children = [];
if (!args.url) {
  children.push(spawn("python3", [path.join(ROOT, "tools", "devserver.py")], {
    cwd: ROOT, env: { ...process.env, PORT: String(webPort) }, stdio: "ignore",
  }));
}
children.push(spawn(chromeBin, [
  "--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--mute-audio",
  "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
  "--window-size=960,600",
  `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profileDir}`, "about:blank",
], { cwd: ROOT, stdio: "ignore" }));

let ws; let seq = 1; const pending = new Map(); const consoleErrors = [];
function send(method, params = {}, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const id = seq++;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evl(expression, timeoutMs = 120000) {
  const message = await send("Runtime.evaluate",
    { expression, returnByValue: true, awaitPromise: true }, timeoutMs);
  if (message.exceptionDetails) {
    throw new Error(message.exceptionDetails.exception?.description || message.exceptionDetails.text);
  }
  return message.result?.value;
}
const failures = [];
const fail = (m) => { failures.push(m); console.error("  ✗ " + m); };
const pass = (m) => console.log("  ✓ " + m);

async function bootToSurvival() {
  await send("Page.navigate", { url: `${url}?seed=${SEED}` });
  let booted = false;
  for (let i = 0; i < 600 && !booted; i++) {
    try {
      booted = !!(await evl("!!(window.CBZ && CBZ.game && CBZ.stepSim && document.getElementById('playBtn'))"));
    } catch (_) {}
    if (!booted) await sleep(300);
  }
  if (!booted) throw new Error("never booted");
  let playing = false;
  for (let i = 0; i < 300 && !playing; i++) {
    playing = await evl(`(() => {
      if (CBZ.game.state === 'playing' && CBZ.game.mode === 'survival') return true;
      const mb = document.querySelector('.mode-btn[data-mode="survival"]'); if (mb) mb.click();
      const b = document.getElementById('playBtn'); if (b) b.click();
      return CBZ.game.state === 'playing' && CBZ.game.mode === 'survival';
    })()`);
    if (!playing) await sleep(250);
  }
  if (!playing) throw new Error("never entered survival play");
  // settle 10 sim-seconds so any intro / spawn grace is spent before the kill
  await evl("(() => { for (let i = 0; i < 600; i++) CBZ.stepSim(1/60); return true; })()");
}

try {
  const deadline = Date.now() + 30000;
  let page = null;
  while (Date.now() < deadline && !page) {
    try {
      const pages = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
      page = pages.find((candidate) => candidate.type === "page") || null;
    } catch (_) {}
    if (!page) await sleep(250);
  }
  if (!page) throw new Error("no debugger page");
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
      consoleErrors.push((message.params.args || [])
        .map((a) => String(a.value ?? a.description ?? "")).join(" "));
      return;
    }
    if (!message.id || !pending.has(message.id)) return;
    const op = pending.get(message.id);
    pending.delete(message.id); clearTimeout(op.timer);
    if (message.error) op.reject(new Error(message.error.message)); else op.resolve(message.result);
  });
  await send("Runtime.enable");
  await send("Page.enable");

  console.log("SURVIVAL DEATH-CAM — deterministic replay timeline (seed " + SEED + ")");
  await bootToSurvival();
  // one synchronous burst: RAF cannot interleave inside it, so the sampled
  // timeline is exact. dt=1/60 through the REAL stepSim (slow-mo included).
  const timeline = await evl(`(() => {
    const CBZ = window.CBZ, P = CBZ.player, cam = CBZ.camera;
    const e0 = CBZ.game.elapsed;
    CBZ.surv.hurt(CBZ.surv.playerActor, 1e6, { cause: "crushed by debris" });
    const armed = { dead: P.dead, spectating: CBZ.surv.spectating, deathCam: !!CBZ.surv.deathCam };
    const rows = [];
    const dirV = new THREE.Vector3(), toB = new THREE.Vector3();
    for (let i = 0; i < 1000; i++) {
      CBZ.stepSim(1/60);
      if (i % 5 !== 0) continue;
      const t = CBZ.game.elapsed - e0;
      const dx = cam.position.x - P.pos.x, dy = cam.position.y - P.pos.y, dz = cam.position.z - P.pos.z;
      cam.getWorldDirection(dirV);
      toB.set(P.pos.x - cam.position.x, (P.pos.y + 0.7) - cam.position.y, P.pos.z - cam.position.z).normalize();
      const ov = document.getElementById('spectate');
      rows.push({
        t: +t.toFixed(3),
        planar: +Math.hypot(dx, dz).toFixed(2),
        dy: +dy.toFixed(2),
        dist: +Math.hypot(dx, dy, dz).toFixed(2),
        ang: +Math.atan2(dz, dx).toFixed(3),
        lookDot: +(dirV.dot(toB)).toFixed(3),
        fov: +cam.fov.toFixed(1),
        pitch: CBZ.cam ? +CBZ.cam.pitch.toFixed(3) : null,
        dc: CBZ.surv.deathCam ? 1 : 0,
        ov: ov && ov.style.display === 'flex' ? 1 : 0,
        spec: CBZ.surv.spectating ? 1 : 0,
      });
    }
    return { armed, rows };
  })()`);

  const { armed, rows } = timeline;
  if (armed.dead && armed.spectating && armed.deathCam) {
    pass("death through surv.hurt -> dead + spectating + deathCam armed same frame");
  } else fail("arming wrong: " + JSON.stringify(armed));

  // settled replay = past the 1.1s swoop-in ease, still in beat one
  const during = rows.filter((r) => r.dc === 1 && r.t > 2.0 && r.spec === 1);
  const after = rows.filter((r) => r.dc === 0 && r.spec === 1);
  if (!during.length) fail("no settled replay samples captured");
  if (!after.length) fail("replay never ended / no post-replay samples");

  const heldEarly = rows.filter((r) => r.t < 1.6 && r.spec === 1).every((r) => r.ov === 0);
  const shownLate = rows.filter((r) => r.t > 2.2 && r.spec === 1).some((r) => r.ov === 1);
  if (heldEarly) pass("ELIMINATED banner held during the fling beat (<1.6s)");
  else fail("banner visible during the hold beat");
  if (shownLate) pass("ELIMINATED banner lands after the hold");
  else fail("banner never appeared");

  const badFrame = during.filter((r) => Math.abs(r.planar - 5.5) > 0.9 || r.dy < 1.6 || r.dy > 4.2);
  if (!badFrame.length) pass(`replay holds the city orbit framing (planar ~5.5 m, ${during.length} samples)`);
  else fail(`replay framing off in ${badFrame.length}/${during.length} samples, e.g. ${JSON.stringify(badFrame[0])}`);
  const badLook = during.filter((r) => r.lookDot < 0.96);
  if (!badLook.length) pass("camera looks at the fallen body throughout the replay");
  else fail(`camera not aimed at body in ${badLook.length} samples, e.g. ${JSON.stringify(badLook[0])}`);

  if (during.length >= 2) {
    let sweep = 0;
    for (let i = 1; i < during.length; i++) {
      let d = during[i].ang - during[i - 1].ang;
      while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
      sweep += d;
    }
    if (Math.abs(sweep) > 0.6) pass(`orbit sweeps ${(sweep * 57.3).toFixed(0)} deg across the replay`);
    else fail(`orbit barely moves (sweep ${(sweep * 57.3).toFixed(0)} deg — a static shot)`);
  }
  const lateReplay = during[during.length - 1];
  if (lateReplay && Math.abs(lateReplay.fov - 48) < 3) pass(`fov eased to ${lateReplay.fov} (target 48)`);
  else fail(`fov did not ease toward 48 (got ${lateReplay && lateReplay.fov})`);

  const endT = after[0] ? after[0].t : 0;
  if (endT > 4.5 && endT < 7.5) pass(`replay ended at t=${endT}s (5.2s of game time + slow-mo stretch)`);
  else fail(`replay ended at unexpected t=${endT}s`);
  const lastIn = during[during.length - 1], firstOut = after[0];
  if (lastIn && firstOut && Math.abs(firstOut.dist - lastIn.dist) < 2.5) {
    pass(`hand-off continuous (dist ${lastIn.dist} -> ${firstOut.dist})`);
  } else fail(`hand-off jumps: ${lastIn && lastIn.dist} -> ${firstOut && firstOut.dist}`);
  // THE PULL-OUT IS A RIG TARGET, NOT A GUARANTEED DISTANCE. The drift eases
  // pitch -> 0.52 / zoom -> 12.5, but the spring-arm collision clamp (correct,
  // pre-existing) keeps the REALIZED camera close when the body lies under a
  // roof or against walls — and the death spot varies run to run (spawn points
  // are not seed-bound). So the gate asserts the rig drifted; how far the arm
  // actually extended is reported, never failed on.
  const lateOut = after[after.length - 1];
  if (lateOut && lateOut.pitch != null && Math.abs(lateOut.pitch - 0.52) < 0.06) {
    pass(`chaos drift took the rig (pitch ${lateOut.pitch} -> 0.52)`);
  } else fail(`drift never eased the rig after the replay: ${JSON.stringify(lateOut)}`);
  const maxOut = after.reduce((m, r) => Math.max(m, r.dist), 0);
  if (maxOut > lastIn.dist + 2.5) pass(`camera pulled out to the chaos view (dist ${maxOut} by t=${lateOut.t}s)`);
  else console.log(`  · pull-out collision-limited at dist ${maxOut} (body under cover — the spring-arm is doing its job)`);
  if (after.every((r) => r.ov === 1)) pass("banner stays up through the pull-out");
  else fail("banner missing after the replay");

  if (SHOTS) {
    console.log("SHOTS — real-time frames into tools/shots/");
    const shotsDir = path.join(ROOT, "tools", "shots");
    await mkdir(shotsDir, { recursive: true });
    await bootToSurvival();
    const shot = async (name) => {
      await evl("(() => { CBZ.renderer.render(CBZ.scene, CBZ.camera); return true; })()");
      const s = await send("Page.captureScreenshot", { format: "png" });
      await writeFile(path.join(shotsDir, name), Buffer.from(s.data, "base64"));
      console.log("  wrote tools/shots/" + name);
    };
    await shot("surv-deathcam-1-pre.png");
    await evl("(() => { CBZ.surv.hurt(CBZ.surv.playerActor, 1e6, { cause: 'crushed by debris' }); return true; })()");
    await sleep(2600); await shot("surv-deathcam-2-replay.png");
    await sleep(5000); await shot("surv-deathcam-3-pullout.png");
  }

  const errs = consoleErrors.filter((e) => !/favicon|Autoplay|AudioContext|ProgressEvent/i.test(e));
  if (errs.length) fail("console errors: " + errs.slice(0, 5).join(" | "));
  else pass("no console errors");
} catch (e) {
  fail("harness: " + (e && e.message ? e.message : e));
} finally {
  for (const child of children) { try { child.kill("SIGKILL"); } catch (_) {} }
  try { await rm(profileDir, { recursive: true, force: true }); } catch (_) {}
}
console.log(failures.length ? `SURV-DEATHCAM: FAIL (${failures.length})` : "SURV-DEATHCAM: ok");
process.exit(failures.length ? 1 : 0);
