#!/usr/bin/env node
// Real-browser contract for modular world actors, bounded venue populations,
// wildlife facing, open-water exclusion, and purposeful jail activities.

import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const serverPort = 9300 + Math.floor(Math.random() * 120);
const debugPort = 10300 + Math.floor(Math.random() * 120);
const profile = `/tmp/cbz-npc-worldlife-${debugPort}`;
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
  "--window-size=1280,800", `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${profile}`, base,
], { stdio: "ignore" });

let ws = null, nextId = 1;
const pending = new Map(), browserErrors = [];
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
    const timeout = setTimeout(() => {
      if (!pending.has(id)) return;
      pending.delete(id); reject(new Error(`${method} timed out`));
    }, 45000);
    if (timeout.unref) timeout.unref();
  });
}
async function evaluate(expression) {
  const out = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (out && out.exceptionDetails) throw new Error(out.exceptionDetails.exception?.description || out.exceptionDetails.text || "browser evaluation failed");
  return out && out.result && out.result.value;
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
    const p = pending.get(msg.id); pending.delete(msg.id);
    if (msg.error) p.reject(new Error(msg.error.message)); else p.resolve(msg.result);
  });
  await send("Runtime.enable"); await send("Page.enable");
  for (let i = 0; i < 160; i++) {
    if (await evaluate("!!(window.CBZ && CBZ.resetGame && CBZ.setMode && CBZ.npcLife)")) break;
    await sleep(250);
  }
  // This contract inspects live scene objects and update-driven behaviour, but
  // never pixels. Keep the normal update loop while removing the expensive
  // SwiftShader draw call; otherwise repeated full-world rebuilds can wedge
  // headless Chrome's software GPU on large real-actor populations.
  await evaluate(`(function(){
    if(CBZ.renderer&&CBZ.renderer.render&&!CBZ.renderer.__worldlifeNoDraw){
      CBZ.renderer.render=function(){};
      CBZ.renderer.__worldlifeNoDraw=true;
    }
  })()`);
  await evaluate(`(function(){
    if(CBZ.CONFIG)CBZ.CONFIG.CITY_HITMAN_CAMPAIGN=false;
    if(CBZ.CONFIG)CBZ.CONFIG.CITY_SCENE_DIRECTOR=false;
    CBZ.setMode("city");CBZ.resetGame();CBZ.setState("playing");
  })()`);
  await sleep(8000);
  // Put the camera beside an actual land animal and force a normal locomotion
  // state, so the audit measures rendered motion instead of a far-cull sample.
  await evaluate(`(function(){
    const a=(CBZ.cityWildlife||[]).find(function(x){return x&&!x.dead&&!x.external&&x.species&&!x.species.aquatic&&x.gait;});
    if(!a)return false;
    window.__wlProbe={actor:a,x:a.group.position.x,z:a.group.position.z,step:a.gait.step||0};
    CBZ.player.pos.set(a.group.position.x+5,a.group.position.y||0,a.group.position.z+5);
    if(CBZ.playerChar&&CBZ.playerChar.group)CBZ.playerChar.group.position.copy(CBZ.player.pos);
    a.state="wander";a.stateT=8;a.heading=0.7;a.faceH=0.7;a.spd=Math.max(1.2,a.species.spd||0);
    a.group.visible=true;
    return true;
  })()`);
  await sleep(2200);

  const collectCity = async () => JSON.parse(await evaluate(`JSON.stringify((function(){
    const peds=CBZ.cityPeds||[], A=CBZ.city&&CBZ.city.arena;
    const cabins=Array.isArray(CBZ.aircraftPassengerCabins)?CBZ.aircraftPassengerCabins:[];
    let seats=0,occupied=0,badOccupants=0;
    cabins.forEach(function(c){
      const ss=c.passengerSeats||c.seats||[];seats+=ss.length;
      ss.forEach(function(s){if(!s.occupant)return;occupied++;if(peds.indexOf(s.occupant)<0||s.occupant.group.parent!==c.group)badOccupants++;});
    });
    const shore=A&&A.mapTerrain&&A.mapTerrain.shoreAt;
    const water=typeof shore!=="function"?[]:peds.filter(function(p){
      if(!p||!p.pos||p.dead||p._parked||p._npcAttached||(p.pos.y||0)>1.5)return false;
      try{return +shore(p.pos.x,p.pos.z)<-0.25;}catch(e){return false;}
    }).map(function(p){return p.name||p.job||"ped";});
    const roleCount=function(role){return peds.filter(function(p){return p&&p._venueRole===role;}).length;};
    const findPlaced=function(name){const p=peds.find(function(x){return x&&x.name===name;});return !!(p&&p.group&&p.group.parent);};
    const dryFailures=[];
    if(typeof shore==="function")(A.lots||[]).forEach(function(l){
      if(!l||!l.building||!/building|house|shop|tower|office|apartment/i.test((l.kind||"")+" "+(l.building.name||"building")))return;
      for(let iz=0;iz<3;iz++)for(let ix=0;ix<3;ix++){
        const x=l.cx-l.w/2+l.w*ix/2,z=l.cz-l.d/2+l.d*iz/2;
        try{if(+shore(x,z)<-0.25){dryFailures.push(l.building.name||l.kind||"building");ix=3;iz=3;}}catch(e){}
      }
    });
    const visibleTree=function(o){for(let n=o;n;n=n.parent)if(n.visible===false)return false;return true;};
    let visibleCrowdProxies=0;
    if(CBZ.scene&&CBZ.scene.traverse)CBZ.scene.traverse(function(o){
      if(!o||(!o.isInstancedMesh&&!o.isPoints)||!visibleTree(o))return;
      for(let n=o;n;n=n.parent)if(/crowd/i.test(n.name||"")){visibleCrowdProxies++;break;}
    });
    const crowdActors=peds.filter(function(p){return p&&p._crowd&&p.group&&visibleTree(p.group);});
    const badCrowdActors=crowdActors.filter(function(p){return peds.indexOf(p)<0||!p.char||p.group!==p.char.group;}).length;
    const wp=window.__wlProbe,wa=wp&&wp.actor;
    const wildlifeProbe=!wa?null:{distance:Math.hypot(wa.group.position.x-wp.x,wa.group.position.z-wp.z),
      gaitDelta:(wa.gait.step||0)-wp.step,moved:wa._motionMoved||0,alignment:wa._motionAlignment,
      facingError:Math.abs(wa.group.rotation.y+wa.faceH),visible:wa.group.visible!==false};
    return {
      roster:peds.length,npcLife:CBZ.npcLife.stats(),cabins:cabins.length,seats:seats,occupied:occupied,badOccupants:badOccupants,
      airportTravellers:peds.filter(function(p){return p&&p._airportRole==="traveller"&&p.group&&p.group.parent;}).length,
      groundCrew:peds.filter(function(p){return p&&p._airportRole==="ground-crew"&&p.group&&p.group.parent;}).length,
      soldiers:peds.filter(function(p){return p&&p._npcProfile&&/^military/.test(p._npcProfile)&&p.group&&p.group.parent;}).length,
      speedway:roleCount("speedway-spectator"),arena:roleCount("arena-spectator"),
      desertPlaced:findPlaced("Drifter")&&findPlaced("Mechanic"),
      snowHikers:peds.filter(function(p){return p&&p._npcPopulation==="snow-authored"&&p.group&&p.group.parent&&Number.isFinite(p.pos.x)&&Number.isFinite(p.pos.z);}).length,
      water:water,dryBuildingFailures:[...new Set(dryFailures)],wildlife:CBZ.cityWildlifeMotionStats?CBZ.cityWildlifeMotionStats():null,wildlifeProbe:wildlifeProbe,
      crowd:CBZ.cityCrowdRenderMode?CBZ.cityCrowdRenderMode():null,
      visibleCrowdActors:crowdActors.length,badCrowdActors:badCrowdActors,visibleCrowdProxies:visibleCrowdProxies
    };
  })())`));

  const first = await collectCity();
  await evaluate(`(function(){CBZ.resetGame();CBZ.setState("playing");})()`);
  await sleep(8000);
  const rebuilt = await collectCity();

  // Force three incident archetypes with a deterministic, genuinely offscreen
  // staging patch.  The director still drafts/recostumes the real registered
  // actors and its normal clear path must restore them without roster growth.
  const incidents = JSON.parse(await evaluate(`JSON.stringify((function(){
    const D=CBZ.citySceneDirector,A=CBZ.city&&CBZ.city.arena,P=CBZ.city&&CBZ.city.playerActor;
    if(!D||!A||!P)return {error:"director unavailable"};
    const before=(CBZ.cityPeds||[]).length,c=CBZ.camera.position,yaw=CBZ.cam?CBZ.cam.yaw:0;
    const fx=-Math.sin(yaw),fz=-Math.cos(yaw);
    const vx=P.pos.x-c.x,vz=P.pos.z-c.z,vl=Math.hypot(vx,vz);
    const ax=vl>1?vx/vl:-fx,az=vl>1?vz/vl:-fz;
    const sp={x:P.pos.x+ax*72,z:P.pos.z+az*72};
    const oldWeighted=A.weightedSidewalkPoint,oldRandom=A.randomSidewalkPoint;
    A.weightedSidewalkPoint=function(){return {x:sp.x,z:sp.z};};
    A.randomSidewalkPoint=function(){return {x:sp.x,z:sp.z};};
    const usable=(CBZ.cityPeds||[]).filter(function(p){return p&&!p.dead&&!p.isPlayer&&!p.vendor&&!p.gang&&p.kind==="civilian"&&!p.controlled&&!p.companion&&!p.recruited&&!p._crowd&&!p._parked&&!p.inCar&&!p.vip&&!p._vipGuard&&!p._milli&&!p._milliGuard&&!p.rampage&&!p._scene;});
    for(let i=0;i<Math.min(usable.length,80);i++){
      const p=usable[i],x=sp.x+(i%8-3.5)*1.7,z=sp.z+((i/8)|0)*1.6;
      p.pos.set(x,0,z);p.target.set(x,0,z);p.group.position.set(x,0,z);p.path=null;p.pause=0;
    }
    const proof={};
    function snap(kind,ok){
      const actors=(CBZ.cityPeds||[]).filter(function(p){return p&&p._sceneRole;});
      proof[kind]={ok:!!ok,status:D.status(),registered:actors.every(function(p){return CBZ.cityPeds.indexOf(p)>=0&&p.group&&p.group.parent;}),
        actors:actors.map(function(p){return {role:p._sceneRole,profile:p._npcProfile||null,armed:!!p.armed,weapon:p.weapon||null,
          aggression:p.aggr||0,state:p.state||null,hasTarget:!!(p.rage||(p.target&&Number.isFinite(p.target.x)))};})};
      D.clear();
      proof[kind].clean=!(CBZ.cityPeds||[]).some(function(p){return p&&p._sceneRole;});
    }
    CBZ.game.cityHour=2;
    let hobo=usable[0]||null,hoboRestore=null;
    if(hobo){
      const hx=c.x-fx*18,hz=c.z-fz*18;
      hobo.pos.set(hx,0,hz);hobo.target.set(hx,0,hz);hobo.group.position.set(hx,0,hz);
      hoboRestore={vagrant:true,role:"panhandler",beg:{x:hx,z:hz}};
      hobo.vagrant=true;hobo._role=hoboRestore.role;hobo._beg=hoboRestore.beg;
    }
    snap("hobo",D.stage("hobo"));
    proof.hobo.identityRestored=!!(!hobo||hobo.vagrant===true&&hobo._role==="panhandler"&&hobo._beg===hoboRestore.beg);
    snap("shooter",D.stage("shooter"));
    snap("hitman",D.stage("hitman"));
    A.weightedSidewalkPoint=oldWeighted;A.randomSidewalkPoint=oldRandom;
    proof.rosterStable=(CBZ.cityPeds||[]).length===before;
    return proof;
  })())`));

  await evaluate(`(function(){
    CBZ.setMode("escape");CBZ.sunAngle=((14-6)/24)*Math.PI*2;CBZ.resetGame();CBZ.setState("playing");
  })()`);
  await sleep(3500);
  await evaluate(`(function(){for(let i=0;i<24;i++)if(CBZ.jailCrowdStartScuffle&&CBZ.jailCrowdStartScuffle())break;})()`);
  await sleep(500);
  const jail = JSON.parse(await evaluate(`JSON.stringify(CBZ.jailCrowdActivityStats?CBZ.jailCrowdActivityStats():null)`));
  const jailRender = JSON.parse(await evaluate(`JSON.stringify((function(){
    const mode=CBZ.jailCrowdRenderMode?CBZ.jailCrowdRenderMode():null;
    const visibleTree=function(o){for(let n=o;n;n=n.parent)if(n.visible===false)return false;return true;};
    let visibleCrowdProxies=0;
    if(CBZ.scene&&CBZ.scene.traverse)CBZ.scene.traverse(function(o){
      if(!o||(!o.isInstancedMesh&&!o.isPoints)||!visibleTree(o))return;
      for(let n=o;n;n=n.parent)if(/crowd/i.test(n.name||"")){visibleCrowdProxies++;break;}
    });
    const actors=(CBZ.npcs||[]).filter(function(a){return a&&a._crowd&&!a.dead&&a.group&&visibleTree(a.group);});
    return {mode:mode,visibleRealActors:actors.length,badActors:actors.filter(function(a){return !a.char||a.group!==a.char.group||CBZ.npcs.indexOf(a)<0;}).length,visibleCrowdProxies:visibleCrowdProxies};
  })())`));

  const failures = [];
  for (const [label, city] of [["first", first], ["rebuilt", rebuilt]]) {
    if (!city.cabins || !city.occupied || city.badOccupants) failures.push(`${label}: aircraft seats were not populated by registered real actors`);
    if (city.airportTravellers < 14 || city.groundCrew < 6) failures.push(`${label}: airport authored actors were missing/unparented`);
    if (city.soldiers < 20) failures.push(`${label}: modular live military cast was missing`);
    if (!(city.speedway > 0 && city.speedway <= 48 && city.arena > 0 && city.arena <= 42)) failures.push(`${label}: venue casts were missing or unbounded`);
    if (!city.desertPlaced || city.snowHikers < 5) failures.push(`${label}: biome actors were registered but not positioned in the world`);
    if (city.water.length) failures.push(`${label}: ${city.water.length} ground peds spawned in open water`);
    if (city.dryBuildingFailures.length) failures.push(`${label}: building footprints crossed open water: ${city.dryBuildingFailures.slice(0, 4).join(", ")}`);
    if (city.wildlife && city.wildlife.sideways) failures.push(`${label}: wildlife motion audit found sideways sliding`);
    if (!city.crowd || city.crowd.mode !== "standard-actors" || city.crowd.activeReal < 1 || city.crowd.proxyVisible) failures.push(`${label}: city ambient population was not standard real actors`);
    if (city.visibleCrowdProxies || city.badCrowdActors) failures.push(`${label}: visible city crowd contained proxy or unregistered actors`);
  }
  if (!first.wildlifeProbe || !first.wildlifeProbe.visible || first.wildlifeProbe.distance <= 0.05 || first.wildlifeProbe.gaitDelta <= 0 || first.wildlifeProbe.alignment < 0.8 || first.wildlifeProbe.facingError > 0.05) {
    failures.push("visible wildlife did not turn, travel nose-first, and animate its gait");
  }
  if (!jail || jail.active < 1 || jail.stand + jail.socialize + jail.action < 1) failures.push("jail crowd had no purposeful stationary/social/activity states");
  if (jail && jail.fight < 1 && jail.down < 1) failures.push("forced jail scuffle did not produce NPC-vs-NPC action");
  if (!jailRender.mode || jailRender.mode.mode !== "standard-actors" || jailRender.mode.realActors !== jailRender.mode.active || jailRender.visibleRealActors !== jailRender.mode.active) failures.push("every active jail crowd row was not a registered standard actor");
  if (jailRender.visibleCrowdProxies || jailRender.badActors) failures.push("visible jail crowd contained box/point proxies or unregistered actors");
  for (const kind of ["hobo", "shooter", "hitman"]) {
    const p=incidents&&incidents[kind];
    if (!p||!p.ok||!p.registered||!p.clean||!p.actors.length) failures.push(`${kind} incident did not stage and clean real registered actors`);
  }
  if (incidents.hobo&&!incidents.hobo.identityRestored) failures.push("hobo incident did not restore its claimed resident identity");
  if (incidents.shooter&&(!incidents.shooter.actors.some((a)=>a.profile==="terrorAttacker"&&a.armed&&a.aggression>=0.8&&a.hasTarget))) failures.push("shooter incident lacked a profiled armed aggressive target-driven actor");
  if (incidents.hitman&&(!incidents.hitman.actors.some((a)=>a.profile==="hitman"&&a.armed&&a.aggression>=0.8&&a.hasTarget))) failures.push("hitman incident lacked a profiled armed aggressive target-driven actor");
  if (!incidents.rosterStable) failures.push("incident staging/cleanup changed the city roster size");
  if (browserErrors.length) failures.push(`browser runtime exceptions: ${browserErrors.slice(0, 3).join(" | ")}`);
  console.log(JSON.stringify({ first, rebuilt, incidents, jail, jailRender, browserErrors, failures }, null, 2));
  if (failures.length) process.exitCode = 1;
} finally {
  try { if (ws && ws.readyState === WebSocket.OPEN) await send("Browser.close"); } catch (_) {}
  if (!chrome.killed) chrome.kill("SIGTERM");
  if (!server.killed) server.kill("SIGTERM");
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}
