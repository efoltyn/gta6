#!/usr/bin/env node
/* tools/site-probe.mjs — READ THE BUILT WORLD, one expression at a time.

   math-gate.mjs boots the world and asserts a fixed battery. When you are
   changing the SIZE of something the gate does not pin — a marina, a car park
   — you need the number the change produced, not a pass/fail, and you need it
   without editing the gate to print it. This boots the same headless Chrome
   the gate does and evaluates whatever expressions you name.

   Usage: node tools/site-probe.mjs "CBZ.cityMarinaSize()" "CBZ.govComplexAudit()"
          node tools/site-probe.mjs --seed 1337 "CBZ.cityBerth.count()"
*/
import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const argv = process.argv.slice(2);
const si = argv.indexOf("--seed");
const SEED = si >= 0 ? argv[si + 1] : "90210";
// Every flag here takes a value, so an argument is an EXPRESSION only when it
// is neither a flag nor the argument after one. (The first cut used
// `i !== si + 1` with si = -1 when --seed was absent, which silently ate
// argv[0] — the first expression asked for; the second cut fixed --seed and
// then read --shot's filename and --alt's number back as expressions.)
const VALUED = new Set(["--seed", "--shot", "--over", "--alt"]);
const EXPR = argv.filter((a, i) => !a.startsWith("--") && !VALUED.has(argv[i - 1]));
if (!EXPR.length) { console.error("site-probe: give at least one expression"); process.exit(2); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function claimPort(base, span, probe) {
  for (let p = base; p < base + span; p++) { try { await probe(p); } catch (_) { return p; } }
  throw new Error("no free port");
}

const port = await claimPort(9450, 150, (p) => fetch(`http://127.0.0.1:${p}/`));
const server = spawn("python3", [path.join(ROOT, "tools/devserver.py")],
  { env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
const origin = `http://127.0.0.1:${port}/`;
{ let up = false;
  for (let i = 0; i < 40 && !up; i++) { try { await fetch(origin); up = true; } catch (_) { await sleep(100); } }
  if (!up) { console.error("site-probe: devserver never came up"); process.exit(1); } }

const dbg = await claimPort(10850, 200, (p) => fetch(`http://127.0.0.1:${p}/json/version`));
const profile = `/tmp/cbz-siteprobe-${dbg}`;
await rm(profile, { recursive: true, force: true });
const CHROME_BIN = process.env.CBZ_CHROME ||
  (process.platform === "darwin"
    ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    : "/opt/pw-browsers/chromium");
const chrome = spawn(CHROME_BIN, [
  "--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
  "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
  // 1280x800: a proof frame of a 300 m harbour is worthless at 480x300, and
  // SwiftShader can still draw one still frame at this size in seconds.
  "--enable-webgl", "--mute-audio", "--window-size=1280,800",
  `--remote-debugging-port=${dbg}`, `--user-data-dir=${profile}`, `${origin}?seed=${SEED}`,
], { stdio: "ignore" });

function done(code) { chrome.kill("SIGTERM"); server.kill("SIGTERM"); process.exit(code); }

let page = null;
for (let i = 0; i < 150 && !page; i++) {
  try {
    const ps = await (await fetch(`http://127.0.0.1:${dbg}/json/list`)).json();
    page = ps.find((p) => p.type === "page" && p.url.startsWith(origin));
  } catch (_) {}
  if (!page) await sleep(100);
}
if (!page) { console.error("site-probe: no page"); done(1); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.addEventListener("open", res, { once: true });
  ws.addEventListener("error", rej, { once: true });
});
let id = 1; const pend = new Map();
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
});
const send = (method, params = {}) =>
  new Promise((r) => { const i = id++; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evl = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  const res = r.result && r.result.result;
  if (r.result && r.result.exceptionDetails) {
    return { __error: (r.result.exceptionDetails.exception || {}).description || r.result.exceptionDetails.text };
  }
  return res ? res.value : undefined;
};
await send("Runtime.enable");

// WAIT FOR THE WORLD, not for a clock — and the world is behind the PLAY
// button, exactly as math-gate.mjs finds it. Boot first, then click, then wait
// for the arena the city builder publishes.
let booted = false;
for (let i = 0; i < 400 && !booted; i++) {
  try { booted = !!(await evl("!!(window.CBZ && CBZ.game && (CBZ.bootComplete || CBZ.game.state === 'title') && CBZ.stepSim && document.getElementById('playBtn'))")); } catch (_) {}
  if (!booted) await sleep(150);
}
if (!booted) { console.error("site-probe: never booted"); done(1); }
let playing = false;
for (let i = 0; i < 240 && !playing; i++) {
  playing = await evl("(() => { if (CBZ.game && CBZ.game.state === 'playing') return true; const b = document.getElementById('playBtn'); if (b) b.click(); return CBZ.game && CBZ.game.state === 'playing'; })()");
  if (!playing) await sleep(200);
}
if (!playing) { console.error("site-probe: never entered play"); done(1); }
let ready = false;
for (let i = 0; i < 400 && !ready; i++) {
  ready = await evl("!!(window.CBZ && CBZ.city && CBZ.city.arena)");
  if (!ready) await sleep(200);
}
if (!ready) { console.error("site-probe: world never built"); done(1); }
// let the deferred passes (gov car park at 55.2, marina residents on the
// traffic wrap) actually fire
await evl("(function(){ if (CBZ.stepSim) for (var i=0;i<240;i++) CBZ.stepSim(1/60); return 1; })()");

let failed = 0;
for (const e of EXPR) {
  const v = await evl(`JSON.stringify(${e})`);
  // SURFACE THE THROW. evl() returns {__error} when the page raised, and the
  // old code fed that object straight into JSON.parse, which threw, which
  // left `out` as the object and printed "[object Object]" — so a probe that
  // died on a typo looked exactly like a probe that returned an object. Two
  // separate investigations were spent on that.
  if (v && typeof v === "object" && v.__error) {
    console.error(`${e}
  !! ${v.__error}`);
    failed++;
    continue;
  }
  if (v === undefined) { console.log(`${e} = undefined`); continue; }
  let out = v;
  try { out = JSON.stringify(JSON.parse(v)); } catch (_) {}
  console.log(`${e} = ${out}`);
}
if (failed) console.error(`site-probe: ${failed} expression(s) threw`);

/* ---- OPTIONAL AERIAL. `--shot <file> --over <x,z> [--alt 220]` parks the
   camera straight above a point and captures one frame. A number tells you a
   marina has 96 berths; only a picture tells you they are all in the water. */
const shi = argv.indexOf("--shot");
if (shi >= 0 && argv[shi + 1]) {
  const oi = argv.indexOf("--over"), ai = argv.indexOf("--alt");
  const over = oi >= 0 && argv[oi + 1] ? argv[oi + 1].split(",").map(Number) : null;
  const alt = ai >= 0 && argv[ai + 1] ? +argv[ai + 1] : 220;
  const at = over || (await evl("(function(){var s=CBZ.cityMarina&&CBZ.cityMarina.site();return s?[s.QX,s.BZ]:[0,0];})()"));
  // PATCH THE RENDERER, don't set the camera and hope. The game's own rig
  // rewrites camera.position every frame, so an override applied from outside
  // is gone before the compositor sees it — street-shot.mjs learned this and
  // this is the same patch: move the camera INSIDE render(), and carry the sky
  // dome with it or the proof frame is shot from outside the sky.
  await evl(`(function(){
    var x = ${at[0]}, z = ${at[1]};
    if (CBZ.setFPS) CBZ.setFPS(false);
    if (CBZ.player && CBZ.player.pos && CBZ.floorAt) CBZ.player.pos.set(x, CBZ.floorAt(x, z), z);
    window.__cam = [x, ${alt}, z + 0.1, x, 0, z];
    if (!CBZ.renderer.__probePatch) {
      var orig = CBZ.renderer.render.bind(CBZ.renderer);
      CBZ.renderer.render = function (s, cam) {
        var t = window.__cam;
        if (t && cam && cam.position) {
          cam.position.set(t[0], t[1], t[2]);
          cam.lookAt(t[3], t[4], t[5]);
          cam.updateMatrixWorld();
          var rig = CBZ.skyDome && CBZ.skyDome.parent;
          if (rig && rig.position) { rig.position.copy(cam.position); rig.updateMatrixWorld(); }
        }
        return orig(s, cam);
      };
      CBZ.renderer.__probePatch = true;
    }
    // Hide the HUD OVERLAYS ONLY. Blanking every non-canvas child of <body>
    // takes the canvas's own wrapper with it and the proof frame comes back
    // black — a picture of the DOM, which is not what we came for.
    var kill = document.querySelectorAll('#hud,#cityHud,#hudRoot,.hud,#minimap,#charPanel,#touchHud,#crosshair');
    for (var i = 0; i < kill.length; i++) kill[i].style.display = 'none';
    return true;
  })()`);
  await sleep(4000);
  const shot = await send("Page.captureScreenshot", { format: "png", fromSurface: true });
  const { writeFile } = await import("node:fs/promises");
  await writeFile(argv[shi + 1], Buffer.from(shot.result.data, "base64"));
  console.log("shot -> " + argv[shi + 1]);
}
done(0);
