#!/usr/bin/env node
/*
  tools/nuke-look.mjs — one real nuke, photographed and timed.

  Boots the city headless on the real GPU (ANGLE/Metal on a Mac), fires a
  nuke through the full game path, freezes the rAF loop so CBZ.stepSim is
  the only clock, and at each beat renders from a tripod, saving a PNG and
  the GPU cost of the frame with and without the cloud (readPixels sync).

  Usage: node tools/nuke-look.mjs [--out DIR] [--beats 1,3,8,20,34] [--url URL]
                                  [--w 1280 --h 720] [--quality 3] [--swiftshader]
*/
import { spawn } from "node:child_process";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const k = process.argv[i];
  if (k.startsWith("--")) args[k.slice(2)] = process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[++i] : true;
}
const OUT = path.resolve(String(args.out || path.join(tmpdir(), "nuke-look")));
const W = Number(args.w || 1280), H = Number(args.h || 720);
const BEATS = String(args.beats || "0.4,1.2,3,8,16,34,90").split(",").map(Number);
const Q = Number(args.quality == null ? 3 : args.quality);
await mkdir(OUT, { recursive: true });

const webPort = 8600 + Math.floor(Math.random() * 300);
const debugPort = 10100 + Math.floor(Math.random() * 300);
const url = args.url ? String(args.url) : `http://127.0.0.1:${webPort}/`;
const chromeBin = process.env.CBZ_CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const profileDir = await mkdtemp(path.join(tmpdir(), "cbz-nuke-look-"));
const children = [];
if (!args.url) {
  children.push(spawn("python3", [path.join(ROOT, "tools", "devserver.py")], {
    cwd: ROOT, env: { ...process.env, PORT: String(webPort) }, stdio: "ignore" }));
}
const gpuFlags = args.swiftshader
  ? ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"]
  : ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"];
children.push(spawn(chromeBin, [
  "--headless=new", "--no-sandbox", "--mute-audio", "--enable-webgl", ...gpuFlags,
  `--window-size=${W},${H}`, `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profileDir}`, "about:blank",
], { stdio: "ignore" }));

let ws; let seq = 1; const pending = new Map(); const logs = [];
function send(method, params = {}, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const id = seq++;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evl(expression, timeoutMs = 120000) {
  const m = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, timeoutMs);
  if (m.exceptionDetails) throw new Error(m.exceptionDetails.exception?.description || m.exceptionDetails.text);
  return m.result?.value;
}

try {
  let page = null;
  for (let i = 0; i < 120 && !page; i++) {
    try { page = (await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()).find((p) => p.type === "page"); } catch (_) {}
    if (!page) await sleep(250);
  }
  if (!page) throw new Error("no debugger page");
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data);
    if (m.method === "Runtime.consoleAPICalled" && (m.params.type === "error" || m.params.type === "warning")) {
      const text = m.params.args.map((a) => a.value ?? a.description ?? "").join(" ");
      if (/shader|WebGL|nuke|THREE/i.test(text)) logs.push(text.slice(0, 600));
    }
    if (m.method === "Runtime.exceptionThrown") logs.push("EXC " + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 400));
    if (!m.id || !pending.has(m.id)) return;
    const op = pending.get(m.id); pending.delete(m.id); clearTimeout(op.timer);
    if (m.error) op.reject(new Error(m.error.message)); else op.resolve(m.result);
  });
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: `${url}?seed=90210&cfg_GFX_SHADER_DIAGNOSTICS=1` });

  let booted = false;
  for (let i = 0; i < 900 && !booted; i++) {
    try { booted = !!(await evl("!!(window.CBZ && CBZ.game && (CBZ.bootComplete || CBZ.game.state === 'title') && CBZ.stepSim && document.getElementById('playBtn'))")); } catch (_) {}
    if (!booted) await sleep(300);
  }
  if (!booted) throw new Error("never booted");
  await evl("(() => { CBZ.CONFIG.CITY_HITMAN_CAMPAIGN = false; return true; })()");
  let playing = false;
  for (let i = 0; i < 400 && !playing; i++) {
    playing = await evl("(() => { if (CBZ.game.state === 'playing') return true; const b = document.getElementById('playBtn'); if (b) b.click(); return CBZ.game.state === 'playing'; })()");
    if (!playing) await sleep(250);
  }
  if (!playing) throw new Error("never playing");
  const gpu = await evl(`(() => { const gl = CBZ.renderer.getContext(); const e = gl.getExtension('WEBGL_debug_renderer_info');
    return { webgl2: CBZ.renderer.capabilities.isWebGL2, renderer: e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) }; })()`);

  const setup = await evl(`(async () => {
    const CBZ = window.CBZ;
    if (CBZ.game.cityCampaign) CBZ.game.cityCampaign.phase = "endless_contracts";
    try { if (CBZ.setQualityLevel) CBZ.setQualityLevel(${Q}); } catch (_) {}
    window.requestAnimationFrame = function () { return 0; };
    await new Promise((r) => setTimeout(r, 700));
    for (let i = 0; i < 90; i++) { CBZ.hitstop = 0; CBZ.slowmo = 0; CBZ.stepSim(1/60); }
    const lots = (CBZ.city && CBZ.city.arena && CBZ.city.arena.lots) || [];
    let gx = 0, gz = 0, n = 0;
    for (const lot of lots) { const x = +(lot.x ?? lot.cx), z = +(lot.z ?? lot.cz); if (isFinite(x) && isFinite(z)) { gx += x; gz += z; n++; } }
    gx = n ? gx / n : 0; gz = n ? gz / n : 0;
    const gy = (CBZ.floorAt && CBZ.floorAt(gx, gz)) || 0;
    CBZ.renderer.debug.checkShaderErrors = true;
    window.__nl = { t: 0, gx, gz, gy };
    for (const c of Array.from(document.body.children)) {
      const cv = CBZ.renderer.domElement;
      if (c === cv || c.contains(cv) || c.id === "nukeFlash") continue;
      c.style.visibility = "hidden";
    }
    if (typeof CBZ.strategicNukeDetonate === "function") CBZ.strategicNukeDetonate(gx, gz, { byPlayer: false });
    else CBZ.detonate(gx, gy + 1.2, gz, "nuke", { byPlayer: false });
    return { gx, gz, gy, dbg: CBZ.nukeFxDebug ? CBZ.nukeFxDebug() : null };
  })()`, 300000);

  const tripods = {
    street: { dist: 2600, alt: 25, aimK: 0.45, fov: 60 },
    bomber: { dist: 3200, alt: 1000, aimK: 0.35, fov: 55 },
    far: { dist: 9000, alt: 150, aimK: 0.5, fov: 45 },
  };
  const want = String(args.tripods || "street,bomber").split(",");
  const results = [];
  for (const beat of BEATS) {
    const r = await evl(`(async () => {
      const CBZ = window.CBZ, S = window.__nl;
      let simMs = 0, ticks = 0, worst = 0;
      while (S.t < ${beat} - 1e-6) {
        CBZ.hitstop = 0; CBZ.slowmo = 0;
        const dt = S.t > 40 ? 1/15 : 1/60;
        const t0 = performance.now(); CBZ.stepSim(dt); const ms = performance.now() - t0;
        simMs += ms; ticks++; if (ms > worst) worst = ms; S.t += dt;
        if (CBZ.player) { CBZ.player.hp = 100; if (CBZ.player.dead) CBZ.player.dead = false; }
      }
      const d = CBZ.nukeFxDebug ? CBZ.nukeFxDebug() : null;
      return { t: +S.t.toFixed(2), simAvg: ticks ? +(simMs / ticks).toFixed(1) : 0, simWorst: +worst.toFixed(0), live: d && d.live, flash: d && d.flash };
    })()`, 600000);
    for (const tp of want) {
      const T = tripods[tp];
      const shot = await evl(`(() => {
        const CBZ = window.CBZ, S = window.__nl, cam = CBZ.camera;
        const live = CBZ.nukeFxDebug().live;
        const h = live ? Math.max(300, live.capYNow - S.gy + live.capWNow * 0.3) : 800;
        cam.aspect = ${W} / ${H}; cam.fov = ${T.fov}; cam.near = 1; cam.far = ${T.alt > 500 ? 7000 : 1400};
        const cz = S.gz + ${T.dist};
        const fy = (CBZ.floorAt && CBZ.floorAt(S.gx, cz)) || 0;
        cam.position.set(S.gx + ${T.dist} * 0.25, fy + ${T.alt} + 2, cz);
        cam.lookAt(S.gx, S.gy + h * ${T.aimK}, S.gz);
        cam.updateProjectionMatrix(); cam.updateMatrixWorld();
        if (CBZ.player && CBZ.player.pos) CBZ.player.pos.set(cam.position.x, fy + 1.1, cam.position.z);
        if (CBZ.skySync) CBZ.skySync();
        const gl = CBZ.renderer.getContext(); const px = new Uint8Array(4);
        const time = (n) => { let best = 1e9; for (let i = 0; i < n; i++) { const t0 = performance.now(); CBZ.renderer.render(CBZ.scene, cam); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); best = Math.min(best, performance.now() - t0); } return +best.toFixed(1); };
        const vol = CBZ.scene.getObjectByName("nukeCloudVolume");
        let without = null;
        if (vol && vol.visible) { vol.visible = false; time(1); without = time(2); vol.visible = true; }
        time(1);
        const withCloud = time(3);
        return { withCloud, without, calls: CBZ.renderer.info.render.calls };
      })()`);
      const png = await send("Page.captureScreenshot", { format: "png" });
      const file = path.join(OUT, `t${String(beat).padStart(5, "0")}-${tp}.png`);
      await writeFile(file, Buffer.from(png.data, "base64"));
      results.push({ beat, tripod: tp, ...r, ...shot, file });
      console.error(`t=${beat} ${tp} gpu ${shot.withCloud}ms (w/o ${shot.without}) sim avg ${r.simAvg} worst ${r.simWorst}`);
    }
  }
  const report = { gpu, setup, results, logs };
  await writeFile(path.join(OUT, "report.json"), JSON.stringify(report, null, 1));
  console.log(JSON.stringify({ gpu, logs: logs.slice(0, 20), out: OUT }, null, 1));
} finally {
  if (ws && ws.readyState <= 1) ws.close();
  for (const c of children.reverse()) if (!c.killed) c.kill("SIGTERM");
  await rm(profileDir, { recursive: true, force: true }).catch(() => {});
}
