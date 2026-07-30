#!/usr/bin/env node
// Real-Chrome iPad contract for road-car buttons, optional tilt steering,
// boat/aircraft joystick routing, and race-prepped crash durability.

import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SHOTS = path.join(ROOT, "tools/shots");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const serverPort = 9680 + Math.floor(Math.random() * 80);
const debugPort = 11680 + Math.floor(Math.random() * 80);
const profile = `/tmp/cbz-touch-car-${debugPort}`;
const shotPath = path.join(SHOTS, "touch-car-controls.png");
const chromePath = process.env.CBZ_CHROME || (process.platform === "darwin"
  ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  : "/opt/pw-browsers/chromium");

await mkdir(SHOTS, { recursive: true });
await rm(profile, { recursive: true, force: true });
const server = spawn("python3", [path.join(ROOT, "tools/devserver.py")], {
  env: { ...process.env, PORT: String(serverPort) }, stdio: "ignore",
});
const base = `http://127.0.0.1:${serverPort}/`;
const chrome = spawn(chromePath, [
  "--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
  "--enable-unsafe-swiftshader", "--enable-webgl", "--mute-audio",
  "--window-size=1180,820", `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${profile}`, "about:blank",
], { stdio: "ignore" });

let ws = null, nextId = 1;
const pending = new Map(), runtimeErrors = [], failures = [];
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => {
      if (!pending.has(id)) return;
      pending.delete(id); reject(new Error(`${method} timed out`));
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
      page = pages.find((p) => p.type === "page");
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
    const p = pending.get(msg.id); pending.delete(msg.id); clearTimeout(p.timer);
    if (msg.error) p.reject(new Error(msg.error.message)); else p.resolve(msg.result);
  });
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1180, height: 820, deviceScaleFactor: 1, mobile: true,
    screenOrientation: { type: "landscapePrimary", angle: 90 },
  });
  await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await send("Page.navigate", { url: base });

  let ready = false;
  for (let i = 0; i < 240; i++) {
    ready = !!(await evaluate("document.readyState==='complete' && !!(window.CBZ && CBZ.resetGame && CBZ.setMode && CBZ.touchVehicleAudit && CBZ.citySpawnOwnedCar)"));
    if (ready) break;
    await sleep(250);
  }
  if (!ready) throw new Error("game APIs did not become ready");
  await evaluate(`(() => {
    if (CBZ.CONFIG) {
      CBZ.CONFIG.CITY_HITMAN_CAMPAIGN=false;
      CBZ.CONFIG.CITY_SCENE_DIRECTOR=false;
    }
    CBZ.setMode("city"); CBZ.resetGame(); CBZ.setState("playing");
    return true;
  })()`);
  for (let i = 0; i < 180; i++) {
    if (await evaluate("!!(CBZ.city && CBZ.city.arena && document.getElementById('tstick'))")) break;
    await sleep(250);
  }
  await sleep(1200);

  const setup = await json(`(() => {
    CBZ.setState("playing");
    if (CBZ.player.driving && CBZ.cityExitVehicle) CBZ.cityExitVehicle();
    const P=CBZ.player, car=CBZ.citySpawnOwnedCar(P.pos.x+1.5,P.pos.z,"Dodge Charger");
    if(!car)return {ok:false};
    P.pos.set(car.pos.x,0,car.pos.z);
    if(CBZ.playerChar&&CBZ.playerChar.group)CBZ.playerChar.group.position.copy(P.pos);
    CBZ.cityEnterVehicle(car); window.__touchQaCar=car;
    for(let i=0;i<3;i++)CBZ.stepSim(1/60);
    if(CBZ.controls&&CBZ.controls.open())CBZ.controls.hide();
    return {ok:true,coarse:matchMedia("(pointer: coarse)").matches,touch:!!CBZ.touchMode};
  })()`);
  check(setup.ok, "road car spawned and entered");
  check(setup.coarse && setup.touch, "emulated iPad did not arm touch mode", JSON.stringify(setup));

  const road = await json(`(() => {
    const vis=(e)=>!!e&&getComputedStyle(e).display!=="none"&&e.getBoundingClientRect().width>0;
    const rect=(id)=>{const e=document.getElementById(id);if(!e)return null;const r=e.getBoundingClientRect();return {l:r.left,r:r.right,t:r.top,b:r.bottom,w:r.width,h:r.height};};
    const overlap=(a,b)=>!!a&&!!b&&Math.max(0,Math.min(a.r,b.r)-Math.max(a.l,b.l))*Math.max(0,Math.min(a.b,b.b)-Math.max(a.t,b.t));
    const a=CBZ.touchVehicleAudit(), ids=["tvLeft","tvRight","tvCarBrake","tvGas","tvTilt"], rs={};
    ids.forEach(id=>rs[id]=rect(id)); const dial=rect("tvDial");
    const hotbar=rect("cWpn");
    return {
      audit:a,bodyCar:document.body.classList.contains("tveh-car"),
      stickDisplay:getComputedStyle(document.getElementById("tstick")).display,
      visible:ids.every(id=>vis(document.getElementById(id))),
      inBounds:Object.values(rs).every(r=>r&&r.l>=0&&r.r<=innerWidth&&r.t>=0&&r.b<=innerHeight),
      overlap:{steer:overlap(rs.tvLeft,rs.tvRight),pedals:overlap(rs.tvCarBrake,rs.tvGas),dialPedals:overlap(dial,rs.tvCarBrake)+overlap(dial,rs.tvGas),dialHotbar:overlap(dial,hotbar)},
      rects:rs,dial,hotbar,
    };
  })()`);
  check(road.audit.mode === "drive" && road.audit.carControls, "road car did not select four-button mode", JSON.stringify(road.audit));
  check(road.bodyCar && road.stickDisplay === "none", "road-car joystick remained visible");
  check(road.visible && road.inBounds, "road-car controls are hidden or outside the iPad viewport", JSON.stringify(road.rects));
  check(!road.overlap.steer && !road.overlap.pedals && !road.overlap.dialPedals && !road.overlap.dialHotbar,
    "road-car controls overlap", JSON.stringify(road.overlap));
  const guide = await json(`(() => {
    CBZ.controls.show("drive");
    const text=(document.getElementById("cCtrl")||{}).innerText||"";
    CBZ.controls.hide();
    return {text,hasTouch:/GAS[\\s\\S]*BRAKE/.test(text)&&/LEFT[\\s\\S]*RIGHT/.test(text)&&/TILT/.test(text),hasKeyboard:/\\bW\\b|\\bA\\b|Space/.test(text)};
  })()`);
  check(guide.hasTouch && !guide.hasKeyboard, "iPad driving guide still teaches keyboard controls", guide.text);
  const roadShot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  await writeFile(shotPath, Buffer.from(roadShot.data, "base64"));

  const held = await json(`(() => {
    const out={};
    for(const [id,key] of [["tvLeft","a"],["tvRight","d"],["tvGas","w"],["tvCarBrake","s"]]){
      const b=document.getElementById(id);
      b.dispatchEvent(new MouseEvent("mousedown",{bubbles:true}));
      out[id]={down:!!CBZ.keys[key]};
      b.dispatchEvent(new MouseEvent("mouseup",{bubbles:true}));
      out[id].up=!CBZ.keys[key];
    }
    const c=window.__touchQaCar;c.v=0;c.vx=c.vz=0;
    document.getElementById("tvGas").dispatchEvent(new MouseEvent("mousedown",{bubbles:true}));
    for(let i=0;i<24;i++)CBZ.stepSim(1/60);
    out.speedAfterGas=c.v;
    document.getElementById("tvGas").dispatchEvent(new MouseEvent("mouseup",{bubbles:true}));
    document.getElementById("tvCarBrake").dispatchEvent(new MouseEvent("mousedown",{bubbles:true}));
    for(let i=0;i<12;i++)CBZ.stepSim(1/60);
    out.speedAfterBrake=c.v;
    document.getElementById("tvCarBrake").dispatchEvent(new MouseEvent("mouseup",{bubbles:true}));
    return out;
  })()`);
  check(["tvLeft", "tvRight", "tvGas", "tvCarBrake"].every((id) => held[id]?.down && held[id]?.up),
    "a car button did not press/release its canonical key", JSON.stringify(held));
  check(held.speedAfterGas > 0.1 && held.speedAfterBrake < held.speedAfterGas,
    "gas/brake did not drive the real car physics", JSON.stringify(held));

  const tilt = await json(`(async() => {
    const c=window.__touchQaCar;
    const enabled=await CBZ.touchCarTiltSet(true);
    const emit=(v)=>{
      const a=((screen.orientation&&screen.orientation.angle)||0)+360;
      const angle=a%360,e=new Event("deviceorientation");
      let beta=0,gamma=0;
      if(angle===90)beta=v;else if(angle===270)beta=-v;else if(angle===180)gamma=-v;else gamma=v;
      Object.defineProperties(e,{beta:{value:beta},gamma:{value:gamma},absolute:{value:false}});
      window.dispatchEvent(e);
    };
    emit(0);
    for(let i=0;i<14;i++){emit(18);await new Promise(r=>setTimeout(r,18));}
    emit(18); // final synchronous sample: SwiftShader can delay a timer >800 ms
    const state=CBZ.touchCarTiltState(),analog=CBZ.touchCarSteerValue(c);
    for(let i=0;i<8;i++)CBZ.stepSim(1/60);
    const smoothed=c._steerInput;
    const left=document.getElementById("tvLeft");
    left.dispatchEvent(new MouseEvent("mousedown",{bubbles:true}));
    const manualWins=CBZ.touchCarSteerValue(c)===null&&CBZ.keys.a===true;
    left.dispatchEvent(new MouseEvent("mouseup",{bubbles:true}));
    await CBZ.touchCarTiltSet(false);
    return {enabled,state,analog,smoothed,manualWins,button:document.getElementById("tvTilt").textContent};
  })()`);
  check(tilt.enabled && tilt.state.calibrated && tilt.analog < -0.05 && tilt.analog >= -0.88,
    "tilt did not produce a bounded, calibrated analog steer", JSON.stringify(tilt));
  check(tilt.smoothed < 0 && tilt.manualWins && tilt.button === "TILT OFF",
    "tilt did not use the car smoother or yield to manual steering", JSON.stringify(tilt));

  const routing = await json(`(() => {
    const road=window.__touchQaCar;
    const pure={
      car:CBZ.touchVehicleModeFor({driving:true,_vehicle:road}),
      boat:CBZ.touchVehicleModeFor({driving:true,_vehicle:{model:{body:"boat"}}}),
      heli:CBZ.touchVehicleModeFor({_aircraft:{kind:"heli"}}),
      plane:CBZ.touchVehicleModeFor({_aircraft:{kind:"jet"}}),
    };
    road._playerCarFeel={marine:true};
    for(let i=0;i<3;i++)CBZ.stepSim(1/60);
    const actual={
      mode:CBZ.touchVehicleMode(),audit:CBZ.touchVehicleAudit(),
      stickDisplay:getComputedStyle(document.getElementById("tstick")).display,
      astern:(document.getElementById("tvBrake")||{}).textContent||"",
    };
    road._playerCarFeel={marine:false};
    return {pure,actual};
  })()`);
  check(routing.pure.car === "drive" && routing.pure.boat === "boat" && routing.pure.heli === "heli" && routing.pure.plane === "wing",
    "vehicle type routing regressed", JSON.stringify(routing.pure));
  check(routing.actual.mode === "boat" && routing.actual.audit.joystick && routing.actual.stickDisplay !== "none" && routing.actual.astern === "ASTERN",
    "boat did not retain its joystick helm", JSON.stringify(routing.actual));

  const race = await json(`(() => {
    if(CBZ.player.driving&&CBZ.cityExitVehicle)CBZ.cityExitVehicle();
    CBZ.clearCityCars();
    const A=CBZ.city.arena,model=CBZ.cityEcon.carByName("Dodge Charger")||CBZ.cityEcon.CARS[0];
    const x=A.minX+120,z=A.minZ+120;
    const mk=(px,pz,vx,race)=>{
      const c=CBZ.cityMakeCar(px,pz,vx>0?Math.PI/2:-Math.PI/2,false,model,.2);
      c.ai=false;c.road=null;c.mass=1;c.engineHp=100;c.v=Math.abs(vx);c.vx=vx;c.vz=0;c._raceCar=!!race;c._crashCD=0;
      return c;
    };
    const r1=mk(x,z,30,true),r2=mk(x+3,z,-30,true);
    const n1=mk(x,z+30,30,false),n2=mk(x+3,z+30,-30,false);
    CBZ.setState("playing");CBZ.stepSim(1/60);
    return {
      tune:CBZ.cityCrashTune,
      raceHp:[r1.engineHp,r2.engineHp],normalHp:[n1.engineHp,n2.engineHp],
      raceTagged:r1._raceCar&&r2._raceCar,
    };
  })()`);
  const minRace = Math.min(...race.raceHp), maxNormal = Math.max(...race.normalHp);
  check(race.raceTagged && race.tune.raceCrashDamageMul === 0.72 && race.tune.raceForceFire === 44,
    "Racer crash tune/tag is missing", JSON.stringify(race));
  check(minRace > maxNormal + 15, "race-prepped cars did not survive the same collision better", JSON.stringify(race));

  const relevantErrors = runtimeErrors.filter((e) => /touch_vehicle\.js|touch\.js|vehicles\.js/.test(e));
  check(!relevantErrors.length, "relevant browser runtime exception", relevantErrors.slice(0, 3).join(" | "));
  console.log(JSON.stringify({ setup, road, guide, held, tilt, routing, race, screenshot: shotPath, relevantErrors, failures }, null, 2));
  if (failures.length) process.exitCode = 1;
} finally {
  if (ws) try { ws.close(); } catch (_) {}
  if (chrome) chrome.kill("SIGTERM");
  if (server) server.kill("SIGTERM");
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}
