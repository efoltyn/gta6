#!/usr/bin/env node
// Real-Chrome iPad contract for:
//   1. Prison/city interaction choices docked vertically beside Reload.
//   2. AIM -> short swipe-up FIRE, including the taught target geometry.
//   3. Authored campaign speech using one subtitle renderer, not two.

import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SHOTS = path.join(ROOT, "tools/shots");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const serverPort = 9740 + Math.floor(Math.random() * 80);
const debugPort = 11780 + Math.floor(Math.random() * 80);
const profile = `/tmp/cbz-ipad-interact-${debugPort}`;
const shotPath = path.join(SHOTS, "ipad-interactions-aim.png");
const chromePath = process.env.CBZ_CHROME || (process.platform === "darwin"
  ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  : "/opt/pw-browsers/chromium");

await mkdir(SHOTS, { recursive: true });
await rm(profile, { recursive: true, force: true });
const server = spawn("python3", [path.join(ROOT, "tools/devserver.py")], {
  env: { ...process.env, PORT: String(serverPort) }, stdio: "ignore",
});
const chrome = spawn(chromePath, [
  "--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
  "--enable-unsafe-swiftshader", "--enable-webgl", "--mute-audio",
  "--window-size=1180,820", `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${profile}`, "about:blank",
], { stdio: "ignore" });

let ws = null;
let nextId = 1;
const pending = new Map();
const runtimeErrors = [];
const failures = [];

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
  const out = await send("Runtime.evaluate", {
    expression, returnByValue: true, awaitPromise: true,
  });
  if (out && out.exceptionDetails) {
    throw new Error(out.exceptionDetails.exception?.description || out.exceptionDetails.text || "browser evaluation failed");
  }
  return out && out.result && out.result.value;
}
async function json(expression) {
  return JSON.parse(await evaluate(`(async()=>JSON.stringify(await (${expression})))()`));
}
function check(ok, label, detail = "") {
  if (!ok) failures.push(detail ? `${label}: ${detail}` : label);
}

try {
  let page = null;
  for (let i = 0; i < 120 && !page; i++) {
    try {
      const pages = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
      page = pages.find((candidate) => candidate.type === "page");
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
      runtimeErrors.push(`${d.url || "?"}:${d.lineNumber || 0} ${d.exception?.description || d.text || "runtime exception"}`);
      return;
    }
    if (!msg.id || !pending.has(msg.id)) return;
    const p = pending.get(msg.id);
    pending.delete(msg.id);
    clearTimeout(p.timer);
    if (msg.error) p.reject(new Error(msg.error.message)); else p.resolve(msg.result);
  });

  await send("Runtime.enable");
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1180, height: 820, deviceScaleFactor: 1, mobile: true,
    screenOrientation: { type: "landscapePrimary", angle: 90 },
  });
  await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await send("Page.navigate", { url: `http://127.0.0.1:${serverPort}/` });

  let ready = false;
  for (let i = 0; i < 240; i++) {
    ready = !!(await evaluate(
      "document.readyState==='complete' && !!(window.CBZ && CBZ.resetGame && CBZ.setMode && CBZ.touchInteractionDocked)"
    ));
    if (ready) break;
    await sleep(250);
  }
  if (!ready) throw new Error("game APIs did not become ready");

  const setup = await json(`(() => {
    CBZ.CONFIG.CITY_HITMAN_CAMPAIGN = false;
    CBZ.setMode("escape");
    CBZ.resetGame();
    CBZ.setState("playing");
    if (CBZ.controls && CBZ.controls.open()) CBZ.controls.hide();
    return {
      touch: !!CBZ.touchMode,
      docked: !!CBZ.touchInteractionDocked(),
      coarse: matchMedia("(pointer: coarse)").matches,
    };
  })()`);
  check(setup.touch && setup.docked && setup.coarse, "emulated iPad did not arm tablet touch mode", JSON.stringify(setup));

  let worldReady = false;
  for (let i = 0; i < 200; i++) {
    worldReady = !!(await evaluate(
      "CBZ.game.state==='playing' && !!(CBZ.player && CBZ.player.pos && CBZ.npcs && CBZ.npcs.length && document.getElementById('taim'))"
    ));
    if (worldReady) break;
    await sleep(250);
  }
  if (!worldReady) throw new Error("Prison world did not become ready");

  await evaluate(`(() => {
    const actor = (CBZ.npcs || []).find((n) => n && n.data && n.group);
    if (!actor) return false;
    const p = CBZ.player.pos;
    actor.group.position.set(p.x + 1.2, actor.group.position.y || 0, p.z);
    if (actor.pos && actor.pos.set) actor.pos.set(p.x + 1.2, actor.pos.y || 0, p.z);
    actor.pause = 999;
    window.__ipadQaActor = actor;
    CBZ.fps.active = true;
    window.__ipadOldCanScope = CBZ.fpsCanScope;
    CBZ.fpsCanScope = () => true;
    for (let i = 0; i < 8; i++) CBZ.stepSim(1 / 60);
    return true;
  })()`);
  await sleep(250);

  const layout = await json(`(() => {
    const rect = (el) => {
      const r = el.getBoundingClientRect();
      return { l:r.left, r:r.right, t:r.top, b:r.bottom, w:r.width, h:r.height };
    };
    const prisonPanel = document.querySelector("#pinteract.show");
    const panel = prisonPanel || document.getElementById("interact");
    const reload = document.getElementById("treload");
    const rows = prisonPanel
      ? Array.from(prisonPanel.querySelectorAll(".pi-choice"))
      : Array.from(document.querySelectorAll("#interactOpts .iopt.tverb"));
    const buttons = rows.map((row) => row.querySelector(prisonPanel ? ".pi-action" : ".itouch-act"));
    const copies = rows.map((row) => row.querySelector(prisonPanel ? ".pi-copy" : ".itouch-copy"));
    const rr = rect(reload);
    const br = buttons.map(rect);
    const cr = copies.map(rect);
    return {
      shown: panel.classList.contains("show"),
      rowCount: rows.length,
      labels: rows.map((row) => row.querySelector(prisonPanel ? ".pi-choice-label" : ".ilab")?.textContent.trim() || ""),
      actions: buttons.map((button) => button?.textContent.trim() || ""),
      reload: rr,
      buttons: br,
      copies: cr,
      firstTopDelta: br.length ? Math.abs(br[0].t - rr.t) : 999,
      reloadGap: br.length ? rr.l - br[0].r : -999,
      vertical: br.every((r, i) => i === 0 || r.t >= br[i - 1].b + 8),
      copyLeft: cr.every((r, i) => r.r <= br[i].l),
      tapSize: br.every((r) => r.w >= 52 && r.h >= 52),
      inBounds: br.every((r) => r.l >= 0 && r.r <= innerWidth && r.t >= 0 && r.b <= innerHeight),
    };
  })()`);
  check(layout.shown && layout.rowCount >= 2, "Prison interaction choices did not render", JSON.stringify(layout));
  check(layout.vertical && layout.copyLeft, "choices are not a vertical right-button/left-text stack", JSON.stringify(layout));
  check(layout.firstTopDelta <= 5, "first action is not aligned with Reload", JSON.stringify(layout));
  check(layout.reloadGap >= 8 && layout.reloadGap <= 36, "action rail is not beside Reload", JSON.stringify(layout));
  check(layout.tapSize && layout.inBounds, "interaction buttons are too small or outside the viewport", JSON.stringify(layout));
  check(layout.labels.every(Boolean) && layout.actions.every(Boolean), "an interaction row lost its explanatory or action text", JSON.stringify(layout));

  const aim = await json(`(() => {
    const b = document.getElementById("taim");
    const ghost = document.getElementById("tfireup");
    const scope = document.getElementById("tscope");
    const r = b.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    const oldAim = CBZ.fpsSetAim, oldFire = CBZ.fpsFire;
    const aimEdges = [], fireEdges = [];
    CBZ.fpsSetAim = (down) => aimEdges.push(!!down);
    CBZ.fpsFire = (down) => fireEdges.push(!!down);
    const touch = (cy) => ({
      identifier: 77, target: b, clientX: x, clientY: cy,
      pageX: x, pageY: cy, screenX: x, screenY: cy,
    });
    const emit = (type, cy, alive) => {
      const t = touch(cy);
      const e = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(e, "changedTouches", { value: [t] });
      Object.defineProperty(e, "touches", { value: alive ? [t] : [] });
      b.dispatchEvent(e);
    };
    const pitch0 = CBZ.cam.pitch;
    emit("touchstart", y, true);
    const gr = ghost.getBoundingClientRect();
    const sr = scope.getBoundingClientRect();
    const ar = b.getBoundingClientRect();
    const geometry = {
      ghostVisible: getComputedStyle(ghost).display !== "none",
      centreTravel: Math.abs((ar.top + ar.height / 2) - (gr.top + gr.height / 2)),
      ghostScopeGap: gr.top - sr.bottom,
      scopeAboveGhost: sr.bottom <= gr.top,
    };
    emit("touchmove", y - 17, true);
    const firedAt17 = fireEdges.includes(true);
    emit("touchmove", y - 19, true);
    const firedAt19 = fireEdges.includes(true);
    const pitchDelta = Math.abs(CBZ.cam.pitch - pitch0);
    emit("touchmove", y - 11, true);
    const edgeCountAt11 = fireEdges.length;
    emit("touchmove", y - 9, true);
    const releasedAt9 = fireEdges.length > edgeCountAt11 && fireEdges[fireEdges.length - 1] === false;
    emit("touchend", y - 9, false);
    CBZ.fpsSetAim = oldAim;
    CBZ.fpsFire = oldFire;
    return { aimEdges, fireEdges, firedAt17, firedAt19, releasedAt9, pitchDelta, geometry };
  })()`);
  check(!aim.firedAt17 && aim.firedAt19, "Aim up-shot did not use the 18px entry threshold", JSON.stringify(aim));
  check(aim.releasedAt9 && aim.fireEdges.join(",") === "true,false", "Aim up-shot hysteresis/release is unstable", JSON.stringify(aim));
  check(aim.aimEdges.join(",") === "true,false", "Aim hold did not survive through the shot gesture", JSON.stringify(aim));
  check(aim.pitchDelta > 0 && aim.pitchDelta <= 0.13, "short shot gesture moved the camera too far", JSON.stringify(aim));
  check(aim.geometry.ghostVisible && aim.geometry.centreTravel <= 38,
    "visual swipe-up target is still far from Aim", JSON.stringify(aim.geometry));
  check(aim.geometry.scopeAboveGhost && aim.geometry.ghostScopeGap >= 8,
    "Scope overlaps the closer swipe-up Fire target", JSON.stringify(aim.geometry));

  const subtitle = await json(`(() => {
    const oldCitySay = CBZ.citySay;
    let citySayCalls = 0;
    CBZ.citySay = function () {
      citySayCalls++;
      return oldCitySay && oldCitySay.apply(this, arguments);
    };
    CBZ.CONFIG.CITY_HITMAN_CAMPAIGN = true;
    CBZ.cityCampaignRestore({
      version: 1, chapter: 1, phase: "prison_arrival", branch: null,
      contractNo: 0, flags: {}, history: [],
    });
    const result = CBZ.cityCampaignPrisonAct("campaign-escape", { kind: "warden" });
    const campaign = document.getElementById("campaignDialogue");
    const city = document.getElementById("citySpeech");
    const campaignText = campaign?.querySelector(".campaign-dialogue-text")?.textContent || "";
    const cityText = city?.querySelector(".citySpeechLine")?.textContent || "";
    const campaignShown = !!(campaign && campaign.classList.contains("show"));
    const cityShown = !!(city && city.classList.contains("show"));
    CBZ.citySay = oldCitySay;
    if (CBZ.campaignUI && CBZ.campaignUI.clearDialogue) CBZ.campaignUI.clearDialogue();
    return {
      handled: !!(result && result.handled),
      citySayCalls,
      campaignShown,
      campaignText,
      cityText,
      duplicateVisible: cityShown && cityText === campaignText,
    };
  })()`);
  check(subtitle.handled && subtitle.campaignText.includes("Every camera outside"),
    "authored Prison Escape dialogue did not reach the campaign subtitle", JSON.stringify(subtitle));
  check(subtitle.citySayCalls === 0 && !subtitle.duplicateVisible,
    "authored dialogue still rendered through both subtitle owners", JSON.stringify(subtitle));

  const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  await writeFile(shotPath, Buffer.from(shot.data, "base64"));

  await evaluate(`(() => {
    CBZ.CONFIG.CITY_HITMAN_CAMPAIGN = false;
    CBZ.CONFIG.CITY_SCENE_DIRECTOR = false;
    CBZ.setMode("city");
    CBZ.resetGame();
    CBZ.setState("playing");
    return true;
  })()`);
  let cityReady = false;
  for (let i = 0; i < 200; i++) {
    cityReady = !!(await evaluate(
      "CBZ.game.mode==='city' && CBZ.game.state==='playing' && !!(CBZ.city && CBZ.city.arena && CBZ.interactions)"
    ));
    if (cityReady) break;
    await sleep(250);
  }
  if (!cityReady) throw new Error("City world did not become ready");

  await evaluate(`(() => {
    const p = CBZ.player.pos;
    window.__ipadCityTarget = {
      name: "Contract Civilian", kind: "civilian", char: {},
      pos: new THREE.Vector3(p.x, 0, p.z),
      relPlayer: { respect:0, loyalty:0, affection:0, fear:0, grudge:0 },
    };
    window.__ipadCityAction = false;
    CBZ.interactions.describe("ipad-contract-person", (target) => ({ label:target.name, note:"" }));
    CBZ.interactions.registerZone({
      id: "qa-ipad-choice", kind: "ipad-contract-person", prio: 100000, radius: 2,
      find: () => {
        const at = CBZ.player.pos;
        window.__ipadCityTarget.pos.set(at.x, 0, at.z);
        return window.__ipadCityTarget;
      },
      options: [{
        id:"qa-ipad-directions", slot:"e", prio:100000, label:"Ask for directions",
        onSelect:() => { window.__ipadCityAction = true; },
      }],
    });
    CBZ.fps.active = true;
    CBZ.interactions.refresh();
    for (let i = 0; i < 6; i++) CBZ.stepSim(1 / 60);
    return true;
  })()`);
  await sleep(350);

  const cityLayout = await json(`(() => {
    const row = document.querySelector("#interactOpts .iopt.tverb");
    const copy = row && row.querySelector(".itouch-copy");
    const button = row && row.querySelector(".itouch-act");
    const reload = document.getElementById("treload");
    const rect = (el) => { const r=el.getBoundingClientRect(); return {l:r.left,r:r.right,t:r.top,b:r.bottom,w:r.width,h:r.height}; };
    const out = {
      shown: document.getElementById("interact").classList.contains("show"),
      label: copy?.querySelector(".ilab")?.textContent.trim() || "",
      action: button?.textContent.trim() || "",
      copy: copy ? rect(copy) : null,
      button: button ? rect(button) : null,
      reload: reload ? rect(reload) : null,
    };
    if (button) button.click();
    out.selected = !!window.__ipadCityAction;
    return out;
  })()`);
  check(cityLayout.shown && cityLayout.label === "Ask for directions" && cityLayout.action === "YES",
    "city interaction renderer did not produce left explanation/right action", JSON.stringify(cityLayout));
  check(cityLayout.copy && cityLayout.button && cityLayout.copy.r <= cityLayout.button.l &&
      cityLayout.button.t === cityLayout.reload.t && cityLayout.reload.l - cityLayout.button.r >= 8,
    "city action rail is not vertically aligned beside Reload", JSON.stringify(cityLayout));
  check(cityLayout.selected, "city action button did not dispatch its canonical interaction", JSON.stringify(cityLayout));

  const relevantErrors = runtimeErrors.filter((line) =>
    /touch\.js|interact\.js|interactions\.js|campaign\.js/i.test(line)
  );
  check(relevantErrors.length === 0, "runtime exception in changed iPad paths", relevantErrors.join(" | "));

  console.log(JSON.stringify({ setup, layout, aim, subtitle, cityLayout, screenshot: shotPath, relevantErrors, failures }, null, 2));
  if (failures.length) process.exitCode = 1;
} finally {
  if (ws) try { ws.close(); } catch (_) {}
  chrome.kill("SIGTERM");
  server.kill("SIGTERM");
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}
