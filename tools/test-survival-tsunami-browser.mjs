#!/usr/bin/env node
// Focused real-Chrome regression for the Natural Disaster tsunami. Exercises
// the real Survival director, shared disaster-water shader, directional wet
// field, animated bore, drainage and cleanup without touching user Chrome.
//
// UPDATED 2026-08-02 (SURV_SHARED_WATER). The event no longer builds a private
// "tsunami-inundation-surface" plane: the ARENA OCEAN itself is raised through
// CBZ.waterSurgeSet, so one surface floods the island and every water consumer
// follows it. The assertions below therefore point at the ocean where they used
// to point at the sheet, and the leak check is inverted — the private sheet must
// not exist AT ALL, at any phase, and the surge must return to exactly zero.

import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(ROOT, "tools", "shots", "tsunami-qa");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const serverPort = 9340 + Math.floor(Math.random() * 120);
const debugPort = 10840 + Math.floor(Math.random() * 120);
const profile = `/tmp/cbz-tsunami-${debugPort}`;
const chromePath = process.env.CBZ_CHROME || (process.platform === "darwin"
  ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  : "/opt/pw-browsers/chromium");
const base = `http://127.0.0.1:${serverPort}/?seed=90210&cfg_SURV_TSUNAMI_V2=1`;

await mkdir(OUT, { recursive: true });
await rm(profile, { recursive: true, force: true });
const server = spawn("python3", [path.join(ROOT, "tools/devserver.py")], {
  cwd: ROOT, env: { ...process.env, PORT: String(serverPort) }, stdio: "ignore",
});
const chrome = spawn(chromePath, [
  "--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
  "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--enable-webgl",
  "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--mute-audio",
  "--window-size=1200,750", `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${profile}`, base,
], { cwd: ROOT, stdio: "ignore" });

let ws = null, nextId = 1;
const pending = new Map(), browserErrors = [];
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => {
      if (!pending.has(id)) return;
      pending.delete(id); reject(new Error(`${method} timed out`));
    }, 90000);
    pending.set(id, { resolve, reject, timer });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const msg = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  const r = msg && msg.result;
  if (r && r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text || "browser evaluation failed");
  return r && r.result && r.result.value;
}
async function shot(name) {
  const msg = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  const file = path.join(OUT, `${name}.png`);
  await writeFile(file, Buffer.from(msg.result.data, "base64"));
  return path.relative(ROOT, file);
}

try {
  let page = null;
  for (let i = 0; i < 160 && !page; i++) {
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
    if (msg.method === "Runtime.consoleAPICalled" && msg.params?.type === "error") {
      browserErrors.push(msg.params.args.map((a) => a.value || a.description || "").join(" "));
      return;
    }
    if (!msg.id || !pending.has(msg.id)) return;
    const p = pending.get(msg.id); pending.delete(msg.id); clearTimeout(p.timer);
    if (msg.error) p.reject(new Error(msg.error.message)); else p.resolve(msg);
  });
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 750, deviceScaleFactor: 1, mobile: false });

  for (let i = 0; i < 180; i++) {
    if (await evaluate("document.readyState==='complete' && !!(window.CBZ && CBZ.setMode && CBZ.stepSim && CBZ.waterSpecReady && CBZ.disasters && CBZ.disasters.tsunamiAudit)")) break;
    await sleep(250);
  }

  const boot = JSON.parse(await evaluate(`JSON.stringify((function(){
    CBZ.setMode("survival");CBZ.resetGame();CBZ.setState("playing");
    // Let the currently queued frame finish, then prevent a concurrent rAF
    // loop from racing the deterministic fixed-dt burst below.
    window.requestAnimationFrame=function(){return 0;};
    const ok=CBZ.disasters.force("flood");
    return {ok:ok,arena:!!(CBZ.surv&&CBZ.surv.arena),mode:CBZ.game.mode};
  })())`));
  await sleep(150);

  // Enter warning and advance 3 seconds into the drawdown.
  const warning = JSON.parse(await evaluate(`JSON.stringify((function(){
    for(let i=0;i<181;i++)CBZ.stepSim(1/60);
    const A=CBZ.surv.arena,a=CBZ.disasters.tsunamiAudit();
    // Read the exposed shelf tangentially from seaward. Looking straight at
    // the island centre puts the arena's mountain behind the warning title and
    // hides the actual drawdown under one dark silhouette.
    CBZ.camera.position.set(A.center.x+252,30,A.center.z+126);
    CBZ.camera.lookAt(A.center.x+112,-1,A.center.z+24);CBZ.camera.updateMatrixWorld(true);
    const skyRig=CBZ.skyDome&&CBZ.skyDome.parent;if(skyRig){skyRig.position.copy(CBZ.camera.position);skyRig.updateMatrixWorld(true);}
    CBZ.renderer.render(CBZ.scene,CBZ.camera);
    return {audit:a,oceanY:A.ocean.position.y,baseline:A.oceanY,material:A.ocean.material.type};
  })())`));
  const warningShot = await shot("drawdown");

  // Finish warning, then move to the middle of the directional crossing.
  const middle = JSON.parse(await evaluate(`JSON.stringify((function(){
    let guard=0;
    while((CBZ.disasters.state()!=="active"||CBZ.disasters.tsunamiAudit().phase!=="sweep")&&guard++<900)CBZ.stepSim(1/60);
    for(let i=0;i<330;i++)CBZ.stepSim(1/60);
    const A=CBZ.surv.arena,a=CBZ.disasters.tsunamiAudit(),e=CBZ.waterEventGet();
    const fx=A.center.x+e.dx*e.frontS,fz=A.center.z+e.dz*e.frontS,px=-e.dz,pz=e.dx;
    CBZ.camera.position.set(fx-e.dx*64+px*70,34,fz-e.dz*64+pz*70);
    CBZ.camera.lookAt(fx,10,fz);CBZ.camera.updateMatrixWorld(true);
    CBZ.renderer.render(CBZ.scene,CBZ.camera);
    const U=A.ocean.material.userData&&A.ocean.material.userData.waterUniforms;
    // ONE WATER: the flooding surface is the ocean, and it is visibly standing
    // over the STREETS behind the front.
    //
    // Sample LOW GROUND, not "14 m back along the travel axis" — mid-crossing
    // that axis runs straight up the central refuge mountain, and the mountain
    // staying dry is the design, not a bug. Scan a ring, keep only points that
    // are behind the front AND on ground under 1 m, and take the deepest.
    let behindDepth=-99,behindAt=null;
    for(let k=0;k<24;k++){
      const th=k/24*Math.PI*2;
      for(let rr=30;rr<=110;rr+=16){
        const sx=A.center.x+Math.cos(th)*rr,sz=A.center.z+Math.sin(th)*rr;
        if(((sx-A.center.x)*e.dx+(sz-A.center.z)*e.dz)>e.frontS-4)continue; // ahead of the wall
        if(A.groundHeightAt(sx,sz)>1)continue;                              // high ground is meant to be dry
        const d=CBZ.survFloodDepthAt(sx,sz);
        if(d>behindDepth){behindDepth=d;behindAt=[sx,sz];}
      }
    }
    return {audit:a,event:e,uniforms:U&&{amp:U.uDisasterAmp.value,chop:U.uDisasterChop.value,time:U.uSeaTime.value},
      surge:CBZ.waterSurge(),oceanVisible:!!A.ocean.visible,
      behindDepth:behindDepth,behindAt:behindAt,
      // the refuge invariant, asserted alongside it: the summit stays dry
      summitDepth:CBZ.survFloodDepthAt(A.center.x,A.center.z),
      privateSheet:!!A.root.getObjectByName("tsunami-inundation-surface")};
  })())`));
  const middleShot = await shot("landfall");

  // Run through flood/drain until cleanup returns the director to idle.
  const finish = JSON.parse(await evaluate(`JSON.stringify((function(){
    /* 4800 ticks = 80 simulated seconds. The event is a WAVE TRAIN now
       (sweep -> flooded -> drawback -> surge2 -> drain, 50 s of active plus
       its warning), and the old 2400-tick cap ran out mid-drain — which
       surfaced not as "the guard was too small" but as "the director did not
       cleanly return idle", three assertions further down. */
    const phases={},A=CBZ.surv.arena;let guard=0;
    while(CBZ.disasters.state()==="active"&&guard++<4800){const p=CBZ.disasters.tsunamiAudit().phase;phases[p]=(phases[p]||0)+1;CBZ.stepSim(1/60);}
    const event=CBZ.waterEventGet();
    return {guard:guard,state:CBZ.disasters.state(),phases:phases,event:event,
      oceanY:A.ocean.position.y,baseline:A.oceanY,surge:CBZ.waterSurge(),
      audit:CBZ.disasterAudit(),
      floodPresent:!!A.root.getObjectByName("tsunami-inundation-surface"),
      wavePresent:!!(A.root.getObjectByName("tsunami-inundation-surface")||A.root.getObjectByName("tsunami-wave"))};
  })())`));

  const failures = [];
  if (!boot.ok || !boot.arena || boot.mode !== "survival") failures.push("Survival tsunami did not boot through CBZ.disasters.force('flood')");
  if (warning.audit?.phase !== "warn") failures.push(`warning phase was ${warning.audit?.phase}`);
  if (!(warning.oceanY < warning.baseline - 0.8)) failures.push("warning did not visibly draw the ocean down");
  if (warning.audit?.oceanMode !== "shared-disaster-fresnel") failures.push(`arena ocean used ${warning.audit?.oceanMode}`);
  if (!(warning.audit?.oceanGrid?.segments >= 64)) failures.push("arena ocean remained an unsegmented plane");
  if (middle.audit?.phase !== "sweep") failures.push(`middle phase was ${middle.audit?.phase}`);
  if (middle.audit?.eventOwner !== "survival-tsunami") failures.push("shared water event owner was missing");
  if (middle.audit?.aheadWet !== false || middle.audit?.behindWet !== true) failures.push("directional wet field was not dry ahead / wet behind");
  if (middle.audit?.floodMode !== "shared-disaster-fresnel") failures.push(`flood surface used ${middle.audit?.floodMode}`);
  if (middle.audit?.floodIsOcean !== true) failures.push("the flooding surface was not the arena ocean");
  if (!middle.audit?.waveAnimated) failures.push("curling front did not expose animated vertex state");
  if (middle.privateSheet) failures.push("a private inundation mesh was built");
  if (!middle.oceanVisible) failures.push("the arena ocean was not visible mid-sweep");
  if (!(middle.surge > 0)) failures.push("the sweep did not raise the shared sea (waterSurge)");
  if (!(middle.behindDepth > 0.3)) failures.push(`no standing water on low ground behind the front (depth ${middle.behindDepth})`);
  if (!(middle.summitDepth < 0)) failures.push("the refuge mountain flooded — high ground must stay dry");
  if (!(middle.uniforms?.time > 0 && middle.uniforms?.amp > 1 && middle.uniforms?.chop > middle.uniforms?.amp)) failures.push("shared water uniforms were not driven into storm state");
  if (!(finish.phases?.flooded > 0 && finish.phases?.drain > 0)) failures.push("event did not traverse flooded and drain phases");
  // THE WAVE TRAIN. The first wave is frequently not the largest, so the event
  // must draw the sea back out and bring a second, bigger one in behind it.
  if (!(finish.phases?.drawback > 0)) failures.push("the sea never drew back between waves");
  if (!(finish.phases?.surge2 > 0)) failures.push("there was no second wave");
  if (finish.state !== "idle") failures.push(`director did not cleanly return idle (${finish.state})`);
  if (finish.event != null) failures.push("survival water event leaked after cleanup");
  if (Math.abs(finish.oceanY - finish.baseline) > 1e-6) failures.push("arena ocean did not restore its baseline level");
  if (Math.abs(finish.surge) > 1e-6) failures.push(`shared sea surge leaked after cleanup (${finish.surge})`);
  if (finish.floodPresent) failures.push("inundation mesh leaked after cleanup");
  // the wave's own ratchet, read on the same run
  if (finish.audit?.privateWater !== 0) failures.push(`disasterAudit.privateWater = ${finish.audit?.privateWater}`);
  if (finish.audit?.privateSwim !== 0) failures.push(`disasterAudit.privateSwim = ${finish.audit?.privateSwim}`);
  if (finish.audit?.banners || finish.audit?.hints || finish.audit?.toasts) failures.push("the disaster narrated itself (banners/hints/toasts > 0)");
  if (finish.audit?.surgeDriven !== true) failures.push("the tsunami never drove CBZ.waterSurgeSet");
  if (browserErrors.length) failures.push(`browser errors: ${browserErrors.join(" | ")}`);

  const report = { boot, warning, middle, finish, shots: [warningShot, middleShot], browserErrors, failures };
  console.log(JSON.stringify(report, null, 2));
  if (failures.length) process.exitCode = 2;
} finally {
  try { if (ws) ws.close(); } catch (_) {}
  try { chrome.kill("SIGTERM"); } catch (_) {}
  try { server.kill("SIGTERM"); } catch (_) {}
  await sleep(250);
  await rm(profile, { recursive: true, force: true });
}
