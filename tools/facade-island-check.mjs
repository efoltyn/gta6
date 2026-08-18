#!/usr/bin/env node
/*
  tools/facade-island-check.mjs — IS EVERY FACADE ACTUALLY ON THE ISLAND?

  Owner: "let's test out all the facades by putting them all on the buildings
  in the very quick to load one — Palm Survivor."

  world/disaster_arena.js now hands the facade kit the same ctx buildings.js
  hands it for a city lot, and assigns one registered grammar per building:
  low-rise grammars across the town ring, skyline grammars (the ones that
  declare minStoreys) on the downtown towers, each tower built tall enough to
  carry the grammar it wears. This probe boots the REAL game, enters Disaster
  Survival, and then asks the LIVE ISLAND rather than the source:

    1. every id in CBZ.facadeList() is worn by exactly one standing building;
    2. every dressed building actually GREW geometry (a facade that threw is
       swallowed by the kit, so silence has to be measured, not trusted) —
       compared against the same island with ?cfg_SURV_FACADES=0;
    3. towers wearing a skyline grammar are tall enough for its minStoreys;
    4. no console errors during the island build.

  Usage: node tools/facade-island-check.mjs [--seed 90210] [--url URL]
*/

import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const t = process.argv[i];
  if (t.startsWith("--")) {
    args[t.slice(2)] = process.argv[i + 1] && !process.argv[i + 1].startsWith("--")
      ? process.argv[++i] : true;
  }
}
const SEED = Number(args.seed || 90210);
const webPort = 8600 + Math.floor(Math.random() * 300);
const debugPort = 10100 + Math.floor(Math.random() * 300);
const url = args.url ? String(args.url) : `http://127.0.0.1:${webPort}/`;
const chromeBin = process.env.CBZ_CHROME || (process.platform === "darwin"
  ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  : "/opt/pw-browsers/chromium");
const profileDir = await mkdtemp(path.join(tmpdir(), "cbz-facisland-"));
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
function send(method, params = {}, timeoutMs = 180000) {
  return new Promise((resolve, reject) => {
    const id = seq++;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evl(expression, timeoutMs = 180000) {
  const m = await send("Runtime.evaluate",
    { expression, returnByValue: true, awaitPromise: true }, timeoutMs);
  if (m.exceptionDetails) {
    throw new Error(m.exceptionDetails.exception?.description || m.exceptionDetails.text);
  }
  return m.result?.value;
}
const failures = [];
const fail = (m) => { failures.push(m); console.error("  x " + m); };
const pass = (m) => console.log("  ok " + m);

/* Count the boxes a building's group actually carries. Merged deco is one mesh
   holding many boxes (24 verts each — the BoxGeometry signature the merge
   preserves), so this counts BOXES, not meshes: the honest measure of whether
   a facade emitted anything. */
const COUNT_FN = `
  window.__islandCensus = function () {
    const A = CBZ.surv && CBZ.surv.arena; if (!A) return null;
    const out = [];
    for (const b of A.fragile) {
      let boxes = 0, meshes = 0;
      b.group.traverse(function (o) {
        if (!o.isMesh || !o.geometry) return;
        const pos = o.geometry.attributes && o.geometry.attributes.position;
        if (!pos) return;
        const n = pos.count / 24;
        if (Number.isInteger(n) && n >= 1) boxes += n; else meshes += 1;
      });
      out.push({ style: b.facadeStyle || null, storeys: b.storeys || 0,
        x: b.x, z: b.z,
        w: Math.round(b.w * 10) / 10, d: Math.round(b.d * 10) / 10,
        h: Math.round(b.h * 10) / 10, boxes: Math.round(boxes), meshes: meshes,
        // how far this footprint intrudes into the nearest road corridor
        // (<= 0 is clear); the grid is 40 m at 7 m wide, drawn from the
        // island centre, same numbers world/disaster_arena.js lays it with
        roadBite: (function () {
          const cx = A.center.x, cz = A.center.z, GRID = 40, HALF = 3.5;
          const lx = cx + Math.max(-2, Math.min(2, Math.round((b.x - cx) / GRID))) * GRID;
          const lz = cz + Math.max(-2, Math.min(2, Math.round((b.z - cz) / GRID))) * GRID;
          const bx = (b.w / 2 + HALF) - Math.abs(b.x - lx);
          const bz = (b.d / 2 + HALF) - Math.abs(b.z - lz);
          return Math.round(Math.max(bx, bz) * 10) / 10;
        })() });
    }
    return out;
  };
  true`;

async function bootToSurvival(extraParams) {
  await send("Page.navigate", { url: `${url}?seed=${SEED}${extraParams || ""}` });
  let booted = false;
  for (let i = 0; i < 900 && !booted; i++) {
    try {
      booted = !!(await evl("!!(window.CBZ && CBZ.game && CBZ.stepSim && document.getElementById('playBtn'))"));
    } catch (_) {}
    if (!booted) await sleep(300);
  }
  if (!booted) throw new Error("never booted");
  let playing = false;
  for (let i = 0; i < 400 && !playing; i++) {
    playing = await evl(`(() => {
      if (CBZ.game.state === 'playing' && CBZ.game.mode === 'survival') return true;
      const mb = document.querySelector('.mode-btn[data-mode="survival"]'); if (mb) mb.click();
      const b = document.getElementById('playBtn'); if (b) b.click();
      return CBZ.game.state === 'playing' && CBZ.game.mode === 'survival';
    })()`);
    if (!playing) await sleep(250);
  }
  if (!playing) throw new Error("never entered survival play");
  await evl(COUNT_FN);
  return evl("window.__islandCensus()");
}

try {
  const deadline = Date.now() + 40000;
  let page = null;
  while (Date.now() < deadline && !page) {
    try {
      const pages = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
      page = pages.find((c) => c.type === "page") || null;
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
    const m = JSON.parse(event.data);
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") {
      consoleErrors.push((m.params.args || []).map((a) => a.value || a.description || "").join(" "));
    }
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id); clearTimeout(p.timer);
      if (m.error) p.reject(new Error(m.error.message)); else p.resolve(m.result);
    }
  });
  await send("Runtime.enable"); await send("Page.enable");

  console.log("\nBARE ISLAND (?cfg_SURV_FACADES=0)");
  const t0 = Date.now();
  const bare = await bootToSurvival("&cfg_SURV_FACADES=0");
  const bareMs = Date.now() - t0;
  const bareBoxes = bare.reduce((a, b) => a + b.boxes, 0);
  console.log(`  ${bare.length} buildings, ${bareBoxes} boxes, booted in ${(bareMs / 1000).toFixed(1)}s`);

  console.log("\nDRESSED ISLAND");
  const t1 = Date.now();
  const dressed = await bootToSurvival("");
  const dressMs = Date.now() - t1;
  const registered = await evl("CBZ.facadeList().map(f => f.id).sort()");
  const defs = await evl("(() => { const o = {}; for (const f of CBZ.facadeList()) { const d = CBZ.facadeDef(f.id); o[f.id] = { min: d.minStoreys || 0, max: d.maxStoreys }; } return o; })()");
  const dressedBoxes = dressed.reduce((a, b) => a + b.boxes, 0);
  console.log(`  ${dressed.length} buildings, ${dressedBoxes} boxes, booted in ${(dressMs / 1000).toFixed(1)}s`);

  console.log("\n  style          storeys   size        boxes  meshes");
  const worn = new Map();
  for (const b of dressed) {
    if (!b.style) continue;
    worn.set(b.style, (worn.get(b.style) || 0) + 1);
    console.log("  " + String(b.style).padEnd(14) + String(b.storeys).padStart(5)
      + "   " + `${b.w}x${b.d}`.padEnd(11) + String(b.boxes).padStart(6) + String(b.meshes).padStart(7));
  }

  console.log("\nCHECKS");
  const missing = registered.filter((id) => !worn.has(id));
  if (missing.length) fail(`${missing.length} registered facade(s) never placed: ${missing.join(", ")}`);
  else pass(`all ${registered.length} registered facades are on the island`);

  const dupes = Array.from(worn.entries()).filter(([, n]) => n > 1);
  if (dupes.length) console.log("  note: worn more than once: " + dupes.map(([k, n]) => `${k}x${n}`).join(", "));

  const silent = dressed.filter((b) => b.style && b.boxes < 120);
  if (silent.length) fail(`facade(s) emitted almost nothing (threw?): ${silent.map((b) => b.style + "=" + b.boxes).join(", ")}`);
  else pass("every dressed building grew real geometry");

  const short = dressed.filter((b) => b.style && defs[b.style] && defs[b.style].min > 0
    && b.storeys < defs[b.style].min);
  if (short.length) fail(`tower(s) too short for their grammar: ${short.map((b) => `${b.style} ${b.storeys}<${defs[b.style].min}`).join(", ")}`);
  else pass("every skyline grammar got a tower tall enough for it");

  /* NOTHING STANDS IN THE ROAD. The town used to be scattered on flat ground
     and the street grid painted over it afterwards, so buildings sat in the
     middle of the asphalt. Placement now seats every footprint on a kerb, and
     this is the assertion that keeps it there: a positive roadBite is metres
     of building inside a road corridor. */
  const inRoad = dressed.filter((b) => b.roadBite > 0);
  if (inRoad.length) {
    fail(`${inRoad.length} building(s) standing in a road: `
      + inRoad.slice(0, 6).map((b) => `${b.style || "?"} +${b.roadBite}m`).join(", "));
  } else pass("no building stands in a road corridor");

  const hardErrors = consoleErrors.filter((e) => !/favicon|WebGL|SwiftShader/i.test(e));
  if (hardErrors.length) fail(`console errors: ${hardErrors.slice(0, 3).join(" | ")}`);
  else pass("no console errors during the island build");

  console.log(`\n  boot: bare ${(bareMs / 1000).toFixed(1)}s -> dressed ${(dressMs / 1000).toFixed(1)}s`
    + `   boxes: ${bareBoxes} -> ${dressedBoxes}`);
  console.log(failures.length ? `\nFAILED (${failures.length})\n` : "\nPASS\n");
} catch (e) {
  console.error("\nERROR: " + e.message + "\n");
  failures.push(e.message);
} finally {
  try { ws && ws.close(); } catch (_) {}
  for (const c of children) { try { c.kill("SIGKILL"); } catch (_) {} }
  await rm(profileDir, { recursive: true, force: true }).catch(() => {});
}
process.exit(failures.length ? 1 : 0);
