#!/usr/bin/env node
// Focused real-Chrome contract for the title quality presets and invisible NPC
// transition gate. It exercises the actual DOM, renderer settings, city ped
// updater and jail face-rig pool; source-text assertions cannot catch a body
// becoming visible one frame after construction.

import { spawn } from "node:child_process";
import { rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const serverPort = 9640 + Math.floor(Math.random() * 100);
const debugPort = 10920 + Math.floor(Math.random() * 100);
const profile = `/tmp/cbz-spawn-quality-${debugPort}`;
const screenshotPath = `/tmp/cbz-spawn-quality-title-${debugPort}.png`;
const chromePath = process.env.CBZ_CHROME || (process.platform === "darwin"
  ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  : "/opt/pw-browsers/chromium");

await rm(profile, { recursive: true, force: true });
const server = spawn("python3", [path.join(ROOT, "tools/devserver.py")], {
  env: { ...process.env, PORT: String(serverPort) }, stdio: "ignore",
});
const base = `http://127.0.0.1:${serverPort}/`;
const chrome = spawn(chromePath, [
  "--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
  "--enable-unsafe-swiftshader", "--enable-webgl", "--mute-audio",
  "--window-size=1440,1000", `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${profile}`, base,
], { stdio: "ignore" });

let ws = null, nextId = 1;
const pending = new Map(), browserErrors = [];
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => {
      if (!pending.has(id)) return;
      pending.delete(id);
      reject(new Error(`${method} timed out`));
    }, 60000);
    pending.set(id, { resolve, reject, timer });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const out = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (out?.exceptionDetails) throw new Error(out.exceptionDetails.exception?.description || out.exceptionDetails.text || "browser evaluation failed");
  return out?.result?.value;
}
async function json(expression) { return JSON.parse(await evaluate(`JSON.stringify(${expression})`)); }
async function waitGameReady() {
  for (let i = 0; i < 220; i++) {
    const ready = !!(await evaluate("document.readyState==='complete' && !!(window.CBZ && CBZ.bootComplete && CBZ.setQualityPreset && CBZ.cityMakePed && CBZ.resetGame && CBZ.jailCrowdRenderMode)"));
    if (ready) return true;
    await sleep(250);
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
      browserErrors.push(msg.params?.exceptionDetails?.exception?.description || msg.params?.exceptionDetails?.text || "runtime exception");
      return;
    }
    if (!msg.id || !pending.has(msg.id)) return;
    const p = pending.get(msg.id); pending.delete(msg.id); clearTimeout(p.timer);
    if (msg.error) p.reject(new Error(msg.error.message)); else p.resolve(msg.result);
  });
  await send("Runtime.enable");
  await send("Page.enable");

  if (!(await waitGameReady())) throw new Error("game APIs did not become ready");

  const title = await json(`(function(){
    const active=Array.from(document.querySelectorAll('[data-quality-preset].active')).map(function(b){return b.dataset.qualityPreset;});
    const card=document.querySelector('#title .card-box');
    return {level:CBZ.getQualityLevel(),locked:CBZ.qualityLocked,active:active,
      buttons:Array.from(document.querySelectorAll('[data-quality-preset]')).map(function(b){return b.innerText.trim();}),
      card:{client:card.clientHeight,scroll:card.scrollHeight},viewport:innerHeight};
  })()`);
  const shot = await send("Page.captureScreenshot", { format: "png", fromSurface: true });
  await writeFile(screenshotPath, Buffer.from(shot.data, "base64"));

  const presets = {};
  for (const id of ["fast", "medium", "best"]) {
    await evaluate(`CBZ.setQualityPreset(${JSON.stringify(id)})`);
    await sleep(120);
    presets[id] = await json(`(function(){return {
      level:CBZ.getQualityLevel(),locked:CBZ.qualityLocked,pixelRatio:CBZ.renderer.getPixelRatio(),
      fog:CBZ.cityFogFar,cull:CBZ.cityCullRadius,sunShadow:CBZ.sun.castShadow,
      stored:localStorage.getItem('cbz_qualityPreset'),active:document.querySelector('[data-quality-preset].active').dataset.qualityPreset
    };})()`);
  }
  await evaluate("CBZ.setQualityPreset('medium')");
  const settingsMirror = await json(`(function(){try{return JSON.parse(localStorage.getItem('CBZ_SETTINGS_V1')||'{}');}catch(e){return {};}})()`);

  // A newer title choice wins over stale Settings state on reload; conversely,
  // an explicit Settings Auto choice is restored when no title preset exists.
  await evaluate(`(function(){localStorage.setItem('cbz_qualityPreset','fast');localStorage.setItem('CBZ_SETTINGS_V1',JSON.stringify({auto:false,qLevel:4}));})()`);
  await send("Page.reload", { ignoreCache: true });
  if (!(await waitGameReady())) throw new Error("game APIs did not return after preset reload");
  const presetReload = await json(`(function(){const p=JSON.parse(localStorage.getItem('CBZ_SETTINGS_V1')||'{}');return {
    level:CBZ.getQualityLevel(),locked:CBZ.qualityLocked,active:Array.from(document.querySelectorAll('[data-quality-preset].active')).map(function(b){return b.dataset.qualityPreset;}),prefs:p
  };})()`);
  await evaluate(`(function(){localStorage.removeItem('cbz_qualityPreset');localStorage.setItem('CBZ_SETTINGS_V1',JSON.stringify({auto:true,qLevel:4}));})()`);
  await send("Page.reload", { ignoreCache: true });
  if (!(await waitGameReady())) throw new Error("game APIs did not return after Auto reload");
  const autoReload = await json(`(function(){return {level:CBZ.getQualityLevel(),locked:CBZ.qualityLocked,auto:CBZ.qualityAuto,
    active:Array.from(document.querySelectorAll('[data-quality-preset].active')).map(function(b){return b.dataset.qualityPreset;})};})()`);
  await evaluate("CBZ.setQualityPreset('medium')");

  await evaluate(`(function(){
    if(CBZ.CONFIG){CBZ.CONFIG.CITY_HITMAN_CAMPAIGN=false;CBZ.CONFIG.CITY_SCENE_DIRECTOR=false;}
    if(CBZ.renderer&&CBZ.renderer.render&&!CBZ.renderer.__spawnQualityNoDraw){CBZ.renderer.render=function(){};CBZ.renderer.__spawnQualityNoDraw=true;}
    CBZ.setMode('city');CBZ.resetGame();CBZ.setState('playing');
  })()`);
  await sleep(500);
  const cityBefore = await json(`(function(){
    const P=CBZ.player.pos,r=function(){return .5;};
    const ped=CBZ.cityMakePed(P.x+1,P.z,r,{name:'Spawn Gate Probe'});
    CBZ.city.arena.root.add(ped.group);CBZ.cityPeds.push(ped);window.__spawnGatePed=ped;
    return {unsafe:!CBZ.npcTransitionSafe(ped.pos.x,ped.pos.z),hidden:!!ped._spawnHidden,visible:ped.group.visible};
  })()`);
  await evaluate(`(function(){const p=window.__spawnGatePed,P=CBZ.player.pos;p.pos.set(P.x+190,0,P.z+190);p.target.copy(p.pos);})()`);
  await sleep(350);
  const cityAfter = await json(`(function(){const p=window.__spawnGatePed;return {hidden:!!p._spawnHidden,visible:p.group.visible,guard:Object.assign({},CBZ.npcSpawnGuardStats)};})()`);

  await evaluate("CBZ.setMode('escape');CBZ.resetGame();CBZ.setState('playing')");
  await sleep(1300);
  const jail = await json(`(function(){
    const actors=CBZ.npcs.filter(function(n){return n&&n._crowd&&n._id>=0&&!n.dead;});
    const ids=actors.map(function(n){return n._id;});
    return {render:CBZ.jailCrowdRenderMode(),actors:actors.length,unique:new Set(ids).size,
      placed:actors.filter(function(n){return n.group.position.y>-100;}).length,
      guard:Object.assign({},CBZ.npcSpawnGuardStats)};
  })()`);

  const failures = [];
  if (title.level !== 2 || !title.locked || title.active.join() !== "medium") failures.push("fresh title did not default to locked Medium");
  if (title.buttons.length !== 3 || !title.buttons[0].includes("HD")) failures.push("three labeled title presets were not rendered");
  if (title.card.client > title.viewport) failures.push("title card exceeded the viewport without containment");
  if (presets.fast.level !== 0 || presets.fast.pixelRatio < 0.89 || presets.fast.fog !== 380 || presets.fast.sunShadow) failures.push("Fast did not apply the crisp short-horizon/no-sun-shadow contract");
  if (presets.medium.level !== 2 || presets.medium.fog !== 760 || !presets.medium.sunShadow) failures.push("Medium did not apply tier 2");
  if (presets.best.level !== 4 || presets.best.fog !== 1400 || presets.best.cull !== 700 || !presets.best.sunShadow) failures.push("Best did not apply the full-distance tier");
  if (settingsMirror.auto !== false || settingsMirror.qLevel !== 2) failures.push("title preset did not replace stale Settings quality state");
  if (presetReload.level !== 0 || !presetReload.locked || presetReload.active.join() !== "fast" || presetReload.prefs.qLevel !== 0) failures.push("saved title preset did not win over an older manual Settings tier");
  if (autoReload.locked || !autoReload.auto || autoReload.active.length) failures.push("saved Settings Auto choice did not release the title preset lock");
  if (!cityBefore.unsafe || !cityBefore.hidden || cityBefore.visible) failures.push("a live city ped was visible at an unsafe spawn point");
  if (cityAfter.hidden) failures.push("a staged city ped did not release after moving safely off camera");
  if (!jail.render || jail.render.realActors !== jail.render.active || jail.actors !== jail.unique || jail.placed !== jail.actors) failures.push("jail reset did not pre-place one real rig per selected actor");
  if (!jail.guard || jail.guard.blocked < 1) failures.push("shared transition guard never rejected an on-camera placement");
  if (browserErrors.length) failures.push(`browser runtime exceptions: ${browserErrors.slice(0, 3).join(" | ")}`);

  console.log(JSON.stringify({ title, presets, settingsMirror, presetReload, autoReload, cityBefore, cityAfter, jail, screenshotPath, browserErrors, failures }, null, 2));
  if (failures.length) process.exitCode = 1;
} finally {
  try { if (ws && ws.readyState === WebSocket.OPEN) await send("Browser.close"); } catch (_) {}
  if (!chrome.killed) chrome.kill("SIGTERM");
  if (!server.killed) server.kill("SIGTERM");
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}
