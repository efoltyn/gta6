#!/usr/bin/env node
/* tools/city-atlas.mjs — THE PROCGEN FEEDBACK LOOP.
   Boots the game at a given world seed (?seed=N), presses Play, freezes the
   loop once the city is built, and renders the WHOLE world top-down with an
   orthographic camera. One PNG per seed. Look at layouts, judge coherence,
   diff seeds — the city equivalent of studio.mjs.
   Usage: node tools/city-atlas.mjs [seed ...]     (default: 90210 1 2 3) */
import { spawn } from "node:child_process";
import { rm, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const seeds = process.argv.slice(2).length ? process.argv.slice(2).map(Number) : [90210, 1, 2, 3];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const port = 8850 + Math.floor(Math.random() * 40);
const server = spawn("python3", [path.join(ROOT, "tools/devserver.py")], { env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
await sleep(700);
await mkdir(path.join(ROOT, "tools/shots"), { recursive: true });

for (const seed of seeds) {
  const dbg = 9850 + Math.floor(Math.random() * 100);
  const profile = `/tmp/cbz-atlas-${dbg}`;
  await rm(profile, { recursive: true, force: true });
  const chrome = spawn(process.env.CBZ_CHROME || (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "/opt/pw-browsers/chromium"), [
    "--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
    "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
    "--enable-webgl", "--mute-audio", "--window-size=1400,1400",
    `--remote-debugging-port=${dbg}`, `--user-data-dir=${profile}`,
    `http://127.0.0.1:${port}/?seed=${seed}`,
  ], { stdio: "ignore" });
  let page = null;
  for (let i = 0; i < 80 && !page; i++) {
    try { const ps = await (await fetch(`http://127.0.0.1:${dbg}/json/list`)).json(); page = ps.find((p) => p.type === "page" && p.url.includes("seed=")); } catch (_) {}
    if (!page) await sleep(250);
  }
  if (!page) { console.error(`seed ${seed}: no page`); chrome.kill("SIGKILL"); continue; }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
  let id = 1; const pending = new Map();
  ws.addEventListener("message", (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
  const send = (method, params = {}) => new Promise((r) => { const i = id++; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const evl = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, returnByValue: true });
    if (r.result && r.result.exceptionDetails) console.error("EXC:", JSON.stringify(r.result.exceptionDetails).slice(0, 200));
    return r.result && r.result.result && r.result.result.value;
  };
  await send("Runtime.enable"); await send("Page.enable");
  for (let i = 0; i < 60; i++) { if (await evl("!!(window.CBZ && CBZ.game && document.getElementById('playBtn'))")) break; await sleep(500); }
  let playing = false;
  for (let i = 0; i < 120 && !playing; i++) {
    await evl("(() => { const b = document.getElementById('playBtn'); if (b) b.click(); return true; })()");
    await sleep(600);
    playing = await evl("!!(CBZ.game && CBZ.game.state === 'playing')");
  }
  await sleep(2500);
  const info = await evl(`(() => {
    if (!CBZ.city || !CBZ.city.arena) return null;
    const A = CBZ.city.arena;
    // freeze the game loop's rendering interest, then render the built world
    // ourselves with a top-down ortho camera sized to ALL registered regions.
    CBZ.game.state = "atlas";
    let minX = A.minX, maxX = A.maxX, minZ = A.minZ, maxZ = A.maxZ;
    (A.regions || []).forEach((r) => {
      // every region carries derived minX/maxX/minZ/maxZ (worldmap.js) —
      // guard with isFinite so one malformed record can't NaN the bounds
      if (isFinite(r.minX)) minX = Math.min(minX, r.minX);
      if (isFinite(r.maxX)) maxX = Math.max(maxX, r.maxX);
      if (isFinite(r.minZ)) minZ = Math.min(minZ, r.minZ);
      if (isFinite(r.maxZ)) maxZ = Math.max(maxZ, r.maxZ);
    });
    if (!isFinite(minX) || maxX - minX < 10) { minX = -1000; maxX = 1600; minZ = -1800; maxZ = 300; }
    const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
    const span = Math.max(maxX - minX, maxZ - minZ) * 0.54;
    const cam = new THREE.OrthographicCamera(-span, span, span, -span, 1, 2000);
    cam.position.set(cx, 900, cz);
    cam.up.set(0, 0, -1);
    cam.lookAt(cx, 0, cz);
    cam.updateMatrixWorld(); cam.updateProjectionMatrix();
    // REPLACE the camera the game loop renders with, AND re-assert its pose
    // inside render() itself — systems/camera.js rewrites CBZ.camera's
    // position/quaternion every frame, so a pose set once gets stomped
    // (atlas-orbit diagnosed: orthographic projection survived, pose didn't).
    cam.__atlas = { cx, cz };
    CBZ.camera = cam;
    // the whole world sits ~900m below the atlas camera — way past the
    // gameplay fog, which painted the entire frame sky-blue. No fog on maps.
    if (CBZ.scene) CBZ.scene.fog = null;
    if (!CBZ.renderer.__atlasWrap) {
      const orig = CBZ.renderer.render.bind(CBZ.renderer);
      CBZ.renderer.render = function (scene, camera) {
        if (camera && camera.__atlas) {
          const a = camera.__atlas;
          camera.position.set(a.cx, 900, a.cz);
          camera.up.set(0, 0, -1);
          camera.lookAt(a.cx, 0, a.cz);
          camera.updateMatrixWorld(true);
        }
        return orig(scene, camera);
      };
      CBZ.renderer.__atlasWrap = true;
    }
    CBZ.renderer.setSize(1400, 1400, false);
    // clean map: a stylesheet !important rule beats the HUD's later inline
    // style.display writes (plain element.style hiding got re-shown per frame)
    const st = document.createElement("style");
    st.textContent = "body > :not(#game) { display: none !important; }";
    document.head.appendChild(st);
    return { seed: ${seed}, lots: (A.lots || []).length, regions: (A.regions || []).length, span: span | 0 };
  })()`);
  console.log(`seed ${seed}:`, JSON.stringify(info));
  await sleep(800);   // let the loop render a frame through the new camera
  const shot = await send("Page.captureScreenshot", { format: "png" });
  await writeFile(path.join(ROOT, `tools/shots/atlas-${seed}.png`), Buffer.from(shot.result.data, "base64"));
  console.log(`tools/shots/atlas-${seed}.png`);
  chrome.kill("SIGTERM");
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}
server.kill("SIGTERM");
