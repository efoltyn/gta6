#!/usr/bin/env node
/* tools/ape-shot.mjs — SEE THE APE. tools/ape-check.mjs proves the moves fire;
   only a picture proves they LOOK like anything, and every animation note in
   this repo was written by somebody who went and looked.

   Boots the 100-men-v-gorilla matchup, freezes the sim at the exact frame of
   each move, parks the camera on the animal and writes one PNG per move:

     tools/shots/ape-rest.png      the control: the same animal, unposed
     tools/shots/ape-charge.png    the quadrupedal rush, mid-drive
     tools/shots/ape-smash.png     both forearms over, at the top of the raise
     tools/shots/ape-sweep.png     the backhand at full extension
     tools/shots/ape-drum.png      reared and planted, hands at the chest
     tools/shots/ape-bite.png      the canines, at contact
     tools/shots/ape-spin-1..6.png one real revolution of the flail, six frames
                                   from a FIXED camera with the ring left in —
                                   a still cannot show a spin, a strip can

   The poses are driven through the SHIPPING entry points — CBZ.predatorPose for
   the body and the real hold state for the flail — so a picture here is a
   picture of the game, not of a diagram.

   Usage: node tools/ape-shot.mjs [--out DIR] [--map arena] [--keep]          */
import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const arg = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d; };
const OUT = path.resolve(ROOT, arg("--out", "tools/shots"));
const MAP = arg("--map", "arena");
await mkdir(OUT, { recursive: true });

async function claimPort(lo, n, probe) {
  for (let p = lo; p < lo + n; p++) { try { await probe(p); } catch (_) { return p; } }
  throw new Error("no free port");
}
const port = await claimPort(9880, 120, (p) => fetch(`http://127.0.0.1:${p}/`));
const server = spawn("python3", [path.join(ROOT, "tools/devserver.py")], { env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
const origin = `http://127.0.0.1:${port}/`;
let up = false;
for (let i = 0; i < 40 && !up; i++) { try { await fetch(origin); up = true; } catch (_) { await sleep(100); } }

const dbg = await claimPort(11180, 120, (p) => fetch(`http://127.0.0.1:${p}/json/version`));
const profile = `/tmp/cbz-apeshot-${dbg}`;
await rm(profile, { recursive: true, force: true });
const CHROME_BIN = process.env.CBZ_CHROME || (process.platform === "darwin"
  ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "/opt/pw-browsers/chromium");
const chrome = spawn(CHROME_BIN, [
  "--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
  "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
  "--enable-webgl", "--mute-audio", "--window-size=1100,700", "--hide-scrollbars",
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
if (!target) bye(1, "APE-SHOT: no page");

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
let id = 1; const pend = new Map();
ws.addEventListener("message", (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
const send = (method, params = {}) => new Promise((r) => { const i = id++; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evl = async (e) => {
  const r = await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true });
  if (r.result && r.result.exceptionDetails) return { __throw: r.result.exceptionDetails.text };
  return r.result && r.result.result && r.result.result.value;
};
await send("Runtime.enable"); await send("Page.enable");

await send("Page.navigate", { url: `${origin}games/battle.html?auto=1&map=${MAP}&red=40&blue=1&ru=men&bu=gorilla&rw=fists&rt=civ` });
let started = false;
for (let i = 0; i < 400 && !started; i++) {
  started = await evl("!!(window.__battle && __battle.audit().started)");
  if (started !== true) { started = false; await sleep(250); }
}
if (!started) bye(1, "APE-SHOT: the battle never started");

// let the armies actually meet, so there are bodies around the ape to pose against
await evl("__battle.speed(8)");
for (let i = 0; i < 90; i++) {
  const near = await evl(`(function () {
    var men = __battle.roster(), ape = null;
    for (var i = 0; i < men.length; i++) if (men[i].beast && !men[i].dead) ape = men[i];
    if (!ape) return -1;
    var n = 0;
    for (var j = 0; j < men.length; j++) {
      var m = men[j];
      if (m === ape || m.dead) continue;
      if (Math.hypot(m.pos.x - ape.pos.x, m.pos.z - ape.pos.z) < 7) n++;
    }
    return n;
  })()`);
  if (near >= 4) break;
  await sleep(400);
}
await evl("__battle.speed(0)");   // freeze: every shot below is a chosen frame

const shot = async (name) => {
  const r = await send("Page.captureScreenshot", { format: "png" });
  if (r.result && r.result.data) {
    await writeFile(path.join(OUT, name), Buffer.from(r.result.data, "base64"));
    console.log("  " + path.relative(ROOT, path.join(OUT, name)));
  }
};

/* POSE, THEN LOOK. The sim is frozen, so predatorPose is the only thing moving
   the animal and the frame it paints is exactly the frame `p` names. The camera
   is parked through the page's own director seam (__battle.look). */
const stage = async (style, p, file, dist, pitch) => {
  const ok = await evl(`(function () {
    var men = __battle.roster(), ape = null;
    for (var i = 0; i < men.length; i++) if (men[i].beast && !men[i].dead) ape = men[i];
    if (!ape) return false;
    /* CLEAR THE RING FOR THE PORTRAIT. At six metres the camera is standing
       inside a crowd of forty and every shot is somebody's back. Hiding the
       men changes NOTHING about the pose — the rig is posed and measured
       identically either way — it just lets the picture answer the question it
       was taken to answer. The held body stays visible; it is half the shot. */
    for (var v = 0; v < men.length; v++) {
      var mm = men[v];
      if (mm !== ape && mm.group && !mm._apeHeld) mm.group.visible = false;
    }
    ape._apeSide = 1;
    // rest first, so the pose below is a clean absolute write and not a
    // composition on top of whatever the previous shot left latched
    try { CBZ.predatorPose(ape, "ape_flail", 1, 0, 0); } catch (e) {}
    if (${JSON.stringify(style)} !== "rest") {
      try { CBZ.predatorPose(ape, ${JSON.stringify(style)}, ${p}, 1, 0.016); } catch (e) { return String(e); }
    }
    // SIDE ON. A knuckle-walker's whole silhouette is its arms, and arms read
    // from the side; every one of these poses is invisible head-on.
    var h = (typeof ape.heading === "number") ? ape.heading : -ape.group.rotation.y;
    __battle.look(${dist}, ${pitch}, h + Math.PI / 2, { x: ape.pos.x, z: ape.pos.z });
    return true;
  })()`);
  if (ok !== true) console.log("  ! " + style + ": " + ok);
  await sleep(450);
  await shot(file);
};

console.log("APE-SHOT: writing to " + path.relative(ROOT, OUT));
// THE CONTROL. Without it, "the arms are up" is an assertion about a picture
// with nothing to compare it to.
await stage("rest", 0, "ape-rest.png", 6, 0.22);
await stage("ape_charge", 0.62, "ape-charge.png", 6, 0.22);
await stage("ape_smash", 0.45, "ape-smash.png", 6, 0.22);
await stage("ape_sweep", 0.50, "ape-sweep.png", 6, 0.22);
await stage("ape_drum", 0.45, "ape-drum.png", 6, 0.22);
await stage("ape_bite", 0.45, "ape-bite.png", 6, 0.22);

/* THE FLAIL, THROUGH THE REAL HOLD. Nothing is faked: apeStrike is asked for a
   grab exactly the way creature_combat asks for one, and then apeStep is run in
   small slices with the sim still frozen, so the frames below are the actual
   swing. */
const grabbed = await evl(`(function () {
  var men = __battle.roster(), ape = null, victim = null;
  for (var i = 0; i < men.length; i++) if (men[i].beast && !men[i].dead) ape = men[i];
  if (!ape) return "no ape";
  var best = 1e9;
  for (var j = 0; j < men.length; j++) {
    var m = men[j];
    if (m === ape || m.dead || m.beast) continue;
    var d = Math.hypot(m.pos.x - ape.pos.x, m.pos.z - ape.pos.z);
    if (d < best) { best = d; victim = m; }
  }
  if (!victim) return "no victim";
  ape._apeSwings = 5;
  var r = CBZ.apeStrike(ape, victim, "ape_grab", { reach: ape.reach, dmg: 40 }, 40);
  return CBZ.apeAudit().holds > 0 ? true : ("grab refused (" + r + ")");
})()`);
if (grabbed !== true) console.log("  ! flail: " + grabbed);
else {
  /* THE SPIN, AS A SEQUENCE. One still cannot show a rotation — the owner's
     report was literally "I didn't see the gorilla spinning around" — so this
     walks ONE real revolution in six frames from a fixed camera, with the ring
     of men LEFT VISIBLE so the club landing on them is part of the picture.
     The sim stays frozen; only apeStep advances, so the frames are the swing. */
  const spin = async (secs, file) => {
    await evl(`(function () {
      var n = Math.round(${secs} / 0.016);
      for (var i = 0; i < n; i++) CBZ.apeStep(0.016);
      var men = __battle.roster(), ape = null;
      for (var j = 0; j < men.length; j++) {
        if (men[j]._apeHeld || men[j]._apeFlying) CBZ.apePoseVictim(men[j], 0.016);
        if (men[j].beast && !men[j].dead) ape = men[j];
        if (men[j].group) men[j].group.visible = true;   // give the ring back
      }
      if (!ape) return false;
      // a FIXED camera for the whole strip: if it tracked the ape's heading the
      // spin would be the one thing the shot could not show
      if (!window.__spinCam) window.__spinCam = { x: ape.pos.x, z: ape.pos.z };
      __battle.look(13, 0.95, 2.2, window.__spinCam);   // steep: a rotation reads from above
      return true;
    })()`);
    await sleep(420);
    await shot(file);
  };
  await spin(0.55, "ape-spin-1.png");
  for (let i = 2; i <= 6; i++) await spin(0.13, "ape-spin-" + i + ".png");
}

bye(0, "APE-SHOT: ok");
