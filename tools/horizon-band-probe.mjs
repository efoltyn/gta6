/* ============================================================================
   tools/horizon-band-probe.mjs — WHO DRAWS THAT BAND, AND WHY IS IT NOT FOGGED?

   Written 2026-08-03 while hunting the owner's "fake horizon" from the B-2 at
   1,750 m. It earned its place on the shelf by answering, in one boot, the two
   questions a screenshot cannot:

     1. WHO draws the offending pixels — by hiding candidate meshes (selected by
        a predicate over the live scene, NOT by a fragile name list) and
        re-reading the same pixel rows.
     2. WHETHER THE FOG CAN REACH THEM AT ALL — by swapping scene.fog through a
        LADDER of new Fog objects. r128 only re-uploads fog uniforms when the
        fog OBJECT IDENTITY changes (WebGLRenderer's `n.fog && c.fog !== r`
        test), so mutating scene.fog.color in place proves NOTHING and will fool
        you. Every swap here allocates a new THREE.Fog.

   The ladder is the whole trick, and it separates three failure classes that
   look identical on screen:
       redFog     (red, LIVE near/far)  band unchanged -> fog never arrives here
       tinyFog    (real colour, 10/200) band == fog    -> the material CAN fog;
                                                          the RANGE is the fault
       redTinyFog (red, 10/200)         band == red    -> plumbing is perfect
   That triple is what proved terrain_overhaul.js's backdrop tiles were fogged
   to exactly 0% at every distance a camera can see (terrainFogScale's 0.12
   post-multiply puts a 4.4 km tile at 528 m, below fogNear 672), and that the
   melt meant to rescue them was itself a no-op because r128 never uploads
   `cameraPosition` to MeshLambertMaterial/MeshBasicMaterial programs.

   Staging is borrowed wholesale from tools/visual-presets/*.mjs, so the frame
   is the REAL one the visual report shoots: same seed, same spawn path, rAF
   frozen, stepSim as the only clock.

   USAGE
     node tools/horizon-band-probe.mjs [--preset b2-spawn] [--subject horizon-sea]
                                       [--rows 488,498,508,518] [--seed 90210]
   Pick the rows off a visual-compare PNG first (they are screen rows from the
   TOP); the probe prints a column scan when they look wrong.
============================================================================ */
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function arg(name, dflt) {
  const i = process.argv.indexOf("--" + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}
const PRESET = arg("preset", "b2-spawn");
const SUBJECT = arg("subject", "horizon-sea");
const SEED = arg("seed", "90210");
const ROWS = arg("rows", "488,498,508,518").split(",").map((n) => +n);
const width = +arg("width", 1100), height = +arg("height", 680);
const webPort = +arg("port", 8246), debugPort = webPort + 1000;

const preset = (await import(path.join(ROOT, "tools/visual-presets", PRESET + ".mjs"))).default;
const subject = preset.subjects.find((s) => s.id === SUBJECT);
if (!subject) {
  console.error(`no subject "${SUBJECT}" in preset ${PRESET}; have: ` +
    preset.subjects.map((s) => s.id).join(", "));
  process.exit(1);
}

const localUrl = `http://127.0.0.1:${webPort}/index.html`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// macOS has no /opt/pw-browsers — every tool that spawns Chrome must carry this
// fallback or it ENOENTs on the owner's machine.
const chromeBin = existsSync("/opt/pw-browsers/chromium")
  ? "/opt/pw-browsers/chromium"
  : (process.env.CBZ_CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");

const profileDir = await mkdtemp(path.join(tmpdir(), "cbz-hband-"));
const kids = [];
kids.push(spawn("python3", [path.join(ROOT, "tools", "devserver.py")], {
  cwd: ROOT, env: { ...process.env, PORT: String(webPort) }, stdio: "ignore",
}));
kids.push(spawn(chromeBin, [
  "--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--hide-scrollbars",
  "--mute-audio", "--no-first-run", "--no-default-browser-check", "--enable-webgl",
  "--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader",
  `--window-size=${width},${height}`, `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${profileDir}`, "about:blank",
], { cwd: ROOT, stdio: "ignore" }));

let cleaned = false;
async function cleanup() {
  if (cleaned) return; cleaned = true;
  for (const k of kids) { try { k.kill("SIGKILL"); } catch (_) {} }
  try { await rm(profileDir, { recursive: true, force: true }); } catch (_) {}
}
process.on("exit", () => { for (const k of kids) { try { k.kill("SIGKILL"); } catch (_) {} } });

for (let i = 0; i < 100; i++) {
  try { const r = await fetch(localUrl, { method: "HEAD" }); if (r.ok) break; } catch (_) {}
  await sleep(200);
}
let page = null;
for (let i = 0; i < 150; i++) {
  try {
    const l = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
    page = l.find((p) => p.type === "page"); if (page) break;
  } catch (_) {}
  await sleep(200);
}
if (!page) { console.error("no devtools page"); await cleanup(); process.exit(1); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.addEventListener("open", res, { once: true });
  ws.addEventListener("error", rej, { once: true });
});
let seq = 1; const pending = new Map();
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (!m.id || !pending.has(m.id)) return;
  const p = pending.get(m.id); pending.delete(m.id); clearTimeout(p.t);
  m.error ? p.rej(new Error(m.error.message)) : p.res(m.result);
});
function send(method, params = {}, ms = 120000) {
  return new Promise((res, rej) => {
    const id = seq++;
    const t = setTimeout(() => { pending.delete(id); rej(new Error(method + " timeout")); }, ms);
    pending.set(id, { res, rej, t });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evl(expr, ms = 120000) {
  const m = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }, ms);
  if (m.exceptionDetails) throw new Error(m.exceptionDetails.exception?.description || m.exceptionDetails.text);
  return m.result?.value;
}

await send("Page.navigate", { url: `${localUrl}?seed=${SEED}&probe=1` }, 90000);
for (let i = 0; i < 400; i++) {
  try {
    if (await evl("document.readyState") === "complete" &&
        await evl(`Boolean(${preset.readyExpression})`)) break;
  } catch (_) {}
  await sleep(250);
}

const staged = await evl(`(${preset.stage.toString()})(${JSON.stringify({
  subject, width, height, side: "after",
  sourceUrl: localUrl, beforeLabel: "B", afterLabel: "A",
})})`, preset.stageTimeoutMs || 480000);
console.log("STAGE:", JSON.stringify(staged));

const out = await evl(`(() => {
  const C = window.CBZ, T = window.THREE, W = ${width}, H = ${height};
  const gl = C.renderer.getContext(); const buf = new Uint8Array(W * H * 4);
  const ROWS = ${JSON.stringify(ROWS)};
  const COLS = [Math.round(W*0.11), Math.round(W*0.5), Math.round(W*0.91)];
  function shoot() {
    C.renderer.render(C.scene, C.camera);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    const s = [];
    for (const py of ROWS) for (const cx of COLS) {
      const q = ((H - 1 - py) * W + cx) * 4; s.push([buf[q], buf[q+1], buf[q+2]]);
    }
    return s;
  }
  function mean(s) {
    let r=0,g=0,b=0; for (const c of s) { r+=c[0]; g+=c[1]; b+=c[2]; }
    const n = s.length; return [Math.round(r/n), Math.round(g/n), Math.round(b/n)];
  }
  const R = { rows: ROWS, cols: COLS, base: mean(shoot()) };
  // A column scan, so a caller who guessed the rows wrong can see where the
  // band really is instead of chasing a null result.
  R.scan = [];
  for (let py = 260; py < H - 20; py += 10) {
    const q = ((H - 1 - py) * W + (W >> 1)) * 4;
    R.scan.push([py, buf[q], buf[q+1], buf[q+2]]);
  }
  function collect(pred) {
    const a = []; C.scene.traverse(function (o) { if (o.isMesh && o.visible && pred(o)) a.push(o); }); return a;
  }
  function hideTest(label, list) {
    if (!list.length) { R[label] = { count: 0 }; return; }
    for (const o of list) o.visible = false;
    const m = mean(shoot());
    for (const o of list) o.visible = true;
    R[label] = { count: list.length, band: m };
  }
  // Predicates over LIVE state, not names: a renamed mesh still gets caught.
  hideTest("hideBackdropTiles", collect(o => o.userData && o.userData.terrainBackdropTile));
  hideTest("hideFogScaled",     collect(o => o.material && o.material.userData && o.material.userData._cbzFogScaled));
  hideTest("hideWaterSurface",  collect(o => o.userData && o.userData.waterSurface));
  hideTest("hideBigLambert",    collect(o => o.material && o.material.isMeshLambertMaterial &&
                                             o.geometry && o.geometry.boundingSphere &&
                                             o.geometry.boundingSphere.radius > 900));
  // ---- the fog-reach ladder (each swap is a NEW Fog object; see header) ----
  const old = C.scene.fog;
  const near = old.near, far = old.far, hex = old.color.getHex();
  C.scene.fog = new T.Fog(0xff0000, near, far);   R.redFog     = mean(shoot());
  C.scene.fog = new T.Fog(hex, 10, 200);          R.tinyFog    = mean(shoot());
  C.scene.fog = new T.Fog(0xff0000, 10, 200);     R.redTinyFog = mean(shoot());
  C.scene.fog = old;                              R.restored   = mean(shoot());
  R.fog = { hex: "#" + old.color.getHexString(), near: near, far: far };
  R.cam = { y: +C.camera.position.y.toFixed(1), far: C.camera.far, fov: +C.camera.fov.toFixed(2) };
  R.flags = { melt: C.CONFIG.AERIAL_FOG_MELT, heightFog: C.CONFIG.RENDER_HEIGHT_FOG_V1,
              quality: C.qualityLevel };
  return R;
})()`, 900000);

console.log("BAND:", JSON.stringify(out, null, 1));
const eq = (a, b) => a && b && a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
console.log("\nVERDICT");
console.log("  fog reaches these pixels at the LIVE range:", eq(out.base, out.redFog) ? "NO" : "yes");
console.log("  fog CAN saturate them at 10/200         :", eq(out.tinyFog, out.base) ? "no" : "yes");
console.log("  fog colour is honoured when it saturates:", out.redTinyFog && out.redTinyFog[0] > 200 && out.redTinyFog[1] < 60 ? "yes" : "no");
await cleanup();
process.exit(0);
