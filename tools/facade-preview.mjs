#!/usr/bin/env node
/* ============================================================
   tools/facade-preview.mjs — render ONE facade that is not in index.html yet.

   WHY THIS EXISTS. tools/facade-catalog.mjs photographs the REGISTERED set:
   it reads CBZ.facadeList() and every grammar it draws had to be wired into
   index.html first. That is right for a catalogue and useless for authoring —
   eight agents writing new grammars in one working tree cannot all edit
   index.html at once without clobbering each other, and a facade you cannot
   look at is a facade you cannot finish.

   So this boots the same page and INJECTS the facade's source straight from
   disk over CDP, along with city/facade_moves.js if that is not wired either.
   Nothing has to be registered anywhere. Write the file, look at it, iterate.

   Usage:
     node tools/facade-preview.mjs mastaba
     node tools/facade-preview.mjs mastaba minoan --subject block
     node tools/facade-preview.mjs shikhara --subject tower --out /tmp/s.png

   Prints the same metrics the catalogue plates carry, plus SOLID — how many
   colliders THE FACADE ITSELF added, over a bare-shell baseline raised in the
   same session. The catalogue cannot show it (CBZ.facadeStudio unwinds
   colliders after every raise) and a raw count would be useless anyway: it is
   mostly the shell's own walls and panes. SOLID=0 means every column, post
   and pier that grammar draws is a ghost you walk through.

   KNOWN DUPLICATION: the studio harness and the corner-fit camera are also in
   tools/facade-catalog.mjs. They were copied rather than shared because that
   file was being run by other agents at the time this was written and could
   not be safely refactored underneath them. Fold both onto one module when
   the facade work settles — see CLAUDE.md on parallel systems.
============================================================ */

import { spawn } from "node:child_process";
import { rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CHROME = process.env.CBZ_CHROME
  || (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "/opt/pw-browsers/chromium");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const argv = process.argv.slice(2);
const ids = [], opt = {};
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith("--")) opt[a.slice(2)] = (argv[i + 1] && !argv[i + 1].startsWith("--")) ? argv[++i] : true;
  else ids.push(a);
}
if (!ids.length || opt.help) {
  console.log("usage: node tools/facade-preview.mjs <id> [<id>...] [--subject house|block|tower] [--out file.png]");
  console.log("  renders src/city/facades/<id>.js without it being wired into index.html");
  process.exit(ids.length ? 0 : 1);
}

const SUBJ = {
  tower: { w: 34, d: 28, storeys: 40, color: 0x8d97a6, doorSide: 1 },
  block: { w: 22, d: 16, storeys: 4, color: 0xb9b3a6, doorSide: 1 },
  house: { w: 15, d: 11, storeys: 2, color: 0xc8bfae, doorSide: 1 },
};
const famName = typeof opt.subject === "string" ? opt.subject : "block";
const subject = SUBJ[famName] || SUBJ.block;

// ---------- server ----------
let serverProc = null, baseUrl = typeof opt.url === "string" ? opt.url : null;
async function ensureServer() {
  if (baseUrl) return;
  const port = 8400 + Math.floor(Math.random() * 200);
  serverProc = spawn("python3", [path.join(ROOT, "tools/devserver.py")],
    { env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
  baseUrl = `http://127.0.0.1:${port}/`;
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(baseUrl + "index.html", { method: "HEAD" }); if (r.ok) return; } catch (_) {}
    await sleep(150);
  }
  throw new Error("dev server did not come up");
}

// ---------- CDP ----------
let ws, nextId = 1, chromeProc = null, profileDir = null;
const pending = new Map();
function send(method, params = {}, timeout = 120000) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => { if (!pending.has(id)) return; pending.delete(id); reject(new Error(method + " timed out")); }, timeout);
  });
}
async function evaluate(expression, timeout = 120000) {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, timeout);
  if (r.exceptionDetails) {
    const d = r.exceptionDetails;
    throw new Error("page: " + ((d.exception && d.exception.description) || d.text));
  }
  return r.result && r.result.value;
}
async function launchChrome() {
  const port = 9200 + Math.floor(Math.random() * 300);
  profileDir = `/tmp/cbz-facade-preview-${port}`;
  await rm(profileDir, { recursive: true, force: true });
  chromeProc = spawn(CHROME, [
    "--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
    "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
    "--enable-webgl", "--ignore-gpu-blocklist", "--disable-background-networking",
    "--disable-component-update", "--disable-extensions", "--hide-scrollbars",
    "--mute-audio", "--no-first-run", "--no-default-browser-check",
    "--window-size=1400,1000", `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`, baseUrl + "?seed=64321&cfg_FACADE_KIT=1",
  ], { stdio: "ignore" });
  const deadline = Date.now() + 40000;
  let page = null;
  while (Date.now() < deadline && !page) {
    try { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json())
      .find((p) => p.type === "page" && p.url.startsWith(baseUrl)); } catch (_) {}
    if (!page) await sleep(200);
  }
  if (!page) { chromeProc.kill("SIGKILL"); throw new Error("chrome page did not appear"); }
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener("open", res, { once: true });
    ws.addEventListener("error", rej, { once: true });
  });
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.method === "Runtime.exceptionThrown") {
      const d = msg.params.exceptionDetails;
      console.error("PAGE EXC:", ((d.exception && d.exception.description) || d.text || "").split("\n")[0]);
      return;
    }
    if (!msg.id || !pending.has(msg.id)) return;
    const p = pending.get(msg.id); pending.delete(msg.id);
    if (msg.error) p.reject(new Error(msg.error.message)); else p.resolve(msg.result);
  });
  await send("Runtime.enable");
}

const HARNESS = String.raw`(() => {
  if (window.__fp) return "ready";
  const CBZ = window.CBZ, T = window.THREE;
  if (!CBZ || !T || !CBZ.renderer || !CBZ.facadeStudio || !CBZ.cityMakeBuilding) return null;
  const S = {};
  try { if (CBZ.game) CBZ.game.state = "studio"; } catch (e) {}
  S._render = CBZ.renderer.render.bind(CBZ.renderer);
  CBZ.renderer.render = function () {};
  const scene = new T.Scene();
  scene.background = new T.Color(0xbcd2e8);
  scene.fog = null;
  scene.add(new T.HemisphereLight(0xdfeaf7, 0x565d63, 0.44));
  const key = new T.DirectionalLight(0xfff3e2, 1.02);
  key.castShadow = true; key.shadow.mapSize.set(2048, 2048);
  key.target.position.set(0, 0, 0); scene.add(key.target); scene.add(key);
  const fill = new T.DirectionalLight(0xd8e6ff, 0.24);
  fill.position.set(140, 60, -120); scene.add(fill);
  const ground = new T.Mesh(new T.CircleGeometry(900, 72), new T.MeshLambertMaterial({ color: 0x53574f }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
  const holder = new T.Group(); scene.add(holder);
  const cam = new T.PerspectiveCamera(38, 1.4, 0.15, 9000);
  CBZ.scene = scene; CBZ.camera = cam;
  const r = CBZ.renderer;
  r.shadowMap.enabled = true; r.setPixelRatio(1);
  document.body.style.margin = "0";
  const cv = r.domElement;
  cv.style.position = "fixed"; cv.style.left = "0"; cv.style.top = "0"; cv.style.zIndex = "99999";
  document.body.appendChild(cv);
  for (const c of Array.from(document.body.children)) if (c !== cv) c.style.visibility = "hidden";

  S.light = (s, h) => {
    const reach = Math.max(s.w, s.d);
    const span = Math.max(reach * 1.15, h * 0.62) + 6;
    const dist = Math.max(h * 1.9, reach * 3.2);
    key.position.set(-dist * 0.60, dist * 0.62, dist * 0.72);
    key.target.position.set(0, h * 0.35, 0); key.target.updateMatrixWorld();
    const cs = key.shadow.camera;
    cs.left = -span; cs.right = span; cs.top = span; cs.bottom = -span;
    cs.near = 1; cs.far = dist * 3 + 200; cs.updateProjectionMatrix();
    key.shadow.bias = -0.00035 - (span / 2048) * 0.0008;
    key.shadow.normalBias = Math.max(0.02, span / 2048 * 1.6);
  };
  S.clear = () => {
    while (holder.children.length) {
      const c = holder.children[0]; holder.remove(c);
      c.traverse && c.traverse((o) => { if (o.geometry && o.geometry.dispose) o.geometry.dispose(); });
    }
  };
  S.raise = (style, subject) => {
    S.clear();
    // COUNT THE COLLIDERS. facadeStudio unwinds CBZ.colliders after every
    // raise (facade_demo.js), so the count cannot be read afterwards —
    // intercept the push instead. This is the number that says whether a
    // facade's ornament is solid or whether the player runs through it.
    let colliders = 0, platforms = 0;
    const cPush = CBZ.colliders.push.bind(CBZ.colliders);
    const pPush = CBZ.platforms.push.bind(CBZ.platforms);
    CBZ.colliders.push = function () { colliders += arguments.length; return cPush.apply(null, arguments); };
    CBZ.platforms.push = function () { platforms += arguments.length; return pPush.apply(null, arguments); };
    let err = null, g;
    try { g = CBZ.facadeStudio(style, { subject: subject }); }
    catch (e) { err = e.message; g = new T.Group(); }
    CBZ.colliders.push = cPush; CBZ.platforms.push = pPush;
    holder.add(g);
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    let pad = null;
    g.traverse((o) => { if (o.name === "facadePad") pad = o; });
    if (pad && pad.material) { pad.material.color.setHex(0x4e5249); pad.castShadow = false; }
    let decoBoxes = 0, realMeshes = 0, tris = 0;
    const heights = [];
    g.traverse((o) => {
      if (!o.isMesh || !o.geometry || o.name === "facadePad") return;
      const pos = o.geometry.attributes && o.geometry.attributes.position;
      if (!pos) return;
      const boxes = pos.count / 24;
      if (Number.isInteger(boxes) && boxes >= 1) decoBoxes += boxes; else realMeshes += 1;
      tris += (o.geometry.index ? o.geometry.index.count : pos.count) / 3;
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      const bb = o.geometry.boundingBox;
      if (bb && isFinite(bb.max.y)) heights.push(Math.round((bb.max.y + o.position.y) * 4) / 4);
    });
    const shellTop = subject.storeys * 3.2;
    const uniq = Array.from(new Set(heights.filter((h) => h > 1))).sort((a, b) => a - b);
    const top = uniq.length ? uniq[uniq.length - 1] : shellTop;
    S.light(subject, Math.max(top, shellTop));
    holder.updateMatrixWorld(true);
    if (pad) pad.visible = false;
    const box = new T.Box3();
    g.traverse((o) => {
      if (!o.isMesh || !o.visible || o.name === "facadePad" || !o.geometry) return;
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      box.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld));
    });
    if (pad) pad.visible = true;
    const c = box.getCenter(new T.Vector3()), sz = box.getSize(new T.Vector3());
    return { error: err, colliders: colliders, platforms: platforms,
      crownM: Math.round(Math.max(0, top - shellTop) * 10) / 10,
      roofTopM: Math.round(top * 10) / 10,
      decoBoxes: Math.round(decoBoxes), realMeshes: realMeshes, triangles: Math.round(tris),
      box: { cx: c.x, cy: c.y, cz: c.z, sx: sz.x, sy: sz.y, sz: sz.z, maxZ: box.max.z } };
  };
  S.shoot = (c) => {
    try { r.toneMappingExposure = 0.86; } catch (e) {}
    cam.aspect = c.w / c.h; cam.fov = c.fov || 38;
    cam.position.set(c.x, c.y, c.z); cam.lookAt(c.ax, c.ay, c.az);
    cam.updateProjectionMatrix();
    r.setSize(c.w, c.h, false);
    S._render(scene, cam);
    return r.domElement.toDataURL("image/jpeg", 0.92);
  };
  // three shots side by side, one PNG, so a run is one file to look at
  S.sheet = (urls, label) => {
    const CW = 900, CH = 700, pad = 10, top = 34;
    const cv2 = document.createElement("canvas");
    cv2.width = CW * urls.length + pad * (urls.length + 1);
    cv2.height = CH + pad * 2 + top;
    const g2 = cv2.getContext("2d");
    g2.fillStyle = "#ffffff"; g2.fillRect(0, 0, cv2.width, cv2.height);
    g2.fillStyle = "#17181a"; g2.font = "bold 20px Helvetica, Arial, sans-serif";
    g2.fillText(label, pad, 24);
    return new Promise((res) => {
      let n = 0;
      urls.forEach((u, i) => {
        const im = new Image();
        im.onload = () => {
          const x = pad + i * (CW + pad);
          const s = Math.min(CW / im.width, CH / im.height);
          g2.drawImage(im, x + (CW - im.width * s) / 2, top + pad + (CH - im.height * s) / 2,
            im.width * s, im.height * s);
          if (++n === urls.length) res(cv2.toDataURL("image/jpeg", 0.9));
        };
        im.src = u;
      });
    });
  };
  window.__fp = S;
  return "ready";
})()`;

// ---- the corner fit: bisect the closest distance that still holds every
// corner of the MEASURED box inside the frame. See facade-catalog.mjs.
const D2R = Math.PI / 180;
function fitDistance(b, dir, fovV, aspect, margin) {
  const corners = [];
  for (const i of [-0.5, 0.5]) for (const j of [-0.5, 0.5]) for (const k of [-0.5, 0.5])
    corners.push([b.cx + i * b.sx, b.cy + j * b.sy, b.cz + k * b.sz]);
  const tv = Math.tan(fovV / 2) * margin, th = Math.tan(fovV / 2) * aspect * margin;
  const fits = (D) => {
    const C = [b.cx + dir[0] * D, b.cy + dir[1] * D, b.cz + dir[2] * D];
    const f = [-dir[0], -dir[1], -dir[2]];
    let r = [f[2], 0, -f[0]];
    const rl = Math.hypot(r[0], r[2]) || 1;
    r = [r[0] / rl, 0, r[2] / rl];
    const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
    for (const p of corners) {
      const v = [p[0] - C[0], p[1] - C[1], p[2] - C[2]];
      const z = v[0] * f[0] + v[1] * f[1] + v[2] * f[2];
      if (z < 0.25) return false;
      const x = v[0] * r[0] + v[1] * r[1] + v[2] * r[2];
      const y = v[0] * u[0] + v[1] * u[1] + v[2] * u[2];
      if (Math.abs(x) > th * z || Math.abs(y) > tv * z) return false;
    }
    return true;
  };
  const R = 0.5 * Math.hypot(b.sx, b.sy, b.sz);
  let lo = R * 0.4, hi = R * 30;
  if (!fits(hi)) return hi;
  for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (fits(mid)) hi = mid; else lo = mid; }
  return hi;
}
function frame(b, o) {
  const fovV = (o.fov || 38) * D2R, aspect = o.w / o.hpx;
  const p = (o.pitch || 13) * D2R, a = (o.az || 45) * D2R;
  const dir = [Math.cos(p) * Math.sin(a), Math.sin(p), Math.cos(p) * Math.cos(a)];
  const D = fitDistance(b, dir, fovV, aspect, o.margin || 0.945);
  return { x: b.cx + dir[0] * D, y: b.cy + dir[1] * D, z: b.cz + dir[2] * D,
    ax: b.cx, ay: b.cy, az: b.cz, fov: o.fov || 38, w: o.w, h: o.hpx };
}
function streetCam(b, w, hpx) {
  const fovV = 55 * D2R, aspect = w / hpx;
  const seeH = Math.min(b.sy * 1.06, 30);
  const halfW = b.sx * 0.62 + 2.5;
  const dW = halfW / Math.tan(2 * Math.atan(Math.tan(fovV / 2) * aspect) / 2);
  const dH = (seeH * 0.55) / Math.tan(fovV / 2);
  return { x: b.cx + b.sx * 0.22, y: 1.7, z: b.maxZ + Math.max(dW, dH, 13),
    ax: b.cx, ay: Math.min(b.cy, seeH * 0.46), az: b.cz, fov: 55, w: w, h: hpx };
}

async function main() {
  await ensureServer();
  await launchChrome();
  const deadline = Date.now() + 180000;
  let ready = null;
  while (Date.now() < deadline && ready !== "ready") {
    ready = await evaluate(HARNESS).catch(() => null);
    if (ready !== "ready") await sleep(500);
  }
  if (ready !== "ready") throw new Error("page never exposed CBZ.facadeStudio");

  // INJECT FROM DISK. The move library first (a facade written against a move
  // that is not loaded is a crash, not a bad-looking building), then each
  // requested facade. Re-injecting one that index.html already loaded is
  // harmless: registerFacade overwrites its own key in the registry.
  const inject = async (file) => {
    if (!existsSync(file)) return false;
    const src = await readFile(file, "utf8");
    await send("Runtime.evaluate", { expression: src, returnByValue: false });
    return true;
  };
  const moves = path.join(ROOT, "src/city/facade_moves.js");
  console.log(await inject(moves) ? "injected facade_moves.js" : "no facade_moves.js on disk yet");

  const outDir = path.join(ROOT, "tools/shots");
  await mkdir(outDir, { recursive: true });
  let bad = 0;
  for (const id of ids) {
    const file = path.join(ROOT, "src/city/facades", id + ".js");
    if (!await inject(file)) { console.error(`!! ${file} does not exist`); bad++; continue; }
    const known = await evaluate(`!!CBZ.facadeDef(${JSON.stringify(id)})`);
    if (!known) { console.error(`!! ${id} did not register — check the registerFacade id`); bad++; continue; }

    /* THE NUMBER THAT ANSWERS "CAN YOU RUN THROUGH IT". A raw collider count
       is mostly the SHELL's — its walls and its glass panes, which have
       always been solid. What matters is what the FACADE added on top. So
       raise the bare shell first (FACADE_KIT_CITY off, or an undressed
       building gets handed a grammar by position hash and the baseline is
       somebody else's facade), then the dressed one, and subtract. */
    await evaluate(`CBZ.CONFIG.FACADE_KIT_CITY = false`);
    const bare = JSON.parse(await evaluate(
      `JSON.stringify(window.__fp.raise(null, ${JSON.stringify(subject)}))`));
    await evaluate(`CBZ.CONFIG.FACADE_KIT_CITY = true`);
    const m = JSON.parse(await evaluate(
      `JSON.stringify(window.__fp.raise(${JSON.stringify(id)}, ${JSON.stringify(subject)}))`));
    m.facadeColliders = m.colliders - bare.colliders;
    m.facadePlats = m.platforms - bare.platforms;
    if (m.error) { console.error(`!! ${id} THREW: ${m.error}`); bad++; }
    const B = m.box;
    const cams = [
      frame(B, { az: 45, pitch: 13, fov: 38, w: 1000, hpx: 780 }),
      streetCam(B, 1000, 780),
      frame(B, { az: 225, pitch: 12, fov: 38, w: 1000, hpx: 780 }),
    ];
    const urls = [];
    for (const c of cams) urls.push(await evaluate(`window.__fp.shoot(${JSON.stringify(c)})`));
    await evaluate(`window.__fp._u = ${JSON.stringify(urls)}`);
    const sheet = await evaluate(
      `window.__fp.sheet(window.__fp._u, ${JSON.stringify(id + "  —  three-quarter · pavement · rear")})`);
    const out = typeof opt.out === "string" ? opt.out : path.join(outDir, `preview-${id}.jpg`);
    await writeFile(out, Buffer.from(sheet.split(",")[1], "base64"));
    console.log(`${id.padEnd(14)} ${famName.padEnd(6)} SOLID=${String(m.facadeColliders).padStart(3)} walk=${String(m.facadePlats).padStart(2)}` +
      `  crown=+${m.crownM}m top=${m.roofTopM}m  deco=${m.decoBoxes} minted=${m.realMeshes} tris=${m.triangles}`);
    console.log(`  -> ${out}`);
    if (m.realMeshes > 40) console.error(`  !! ${m.realMeshes} minted meshes — the kit's budget is about 40. Use boxes.`);
    if (m.facadeColliders === 0) console.error(
      `  !! this facade added 0 colliders — every column, post and pier it draws can be walked through.` +
      ` Emit load-bearing masses with ctx.sbox (falls back to ctx.dbox).`);
  }
  if (bad) process.exitCode = 1;
}

main().then(async () => {
  if (chromeProc) chromeProc.kill("SIGKILL");
  if (serverProc) serverProc.kill("SIGKILL");
  if (profileDir) await rm(profileDir, { recursive: true, force: true }).catch(() => {});
  process.exit(process.exitCode || 0);
}).catch(async (e) => {
  console.error(e.message);
  if (chromeProc) chromeProc.kill("SIGKILL");
  if (serverProc) serverProc.kill("SIGKILL");
  process.exit(1);
});
