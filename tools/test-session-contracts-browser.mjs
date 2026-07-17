#!/usr/bin/env node
// Real-Chrome gameplay contract for the July world/response pass. This probes
// the actual update loop instead of merely searching source: binary interaction
// UI, gunpoint reads, bison launch physics, procedural weapon UI/models,
// controller Y enter/exit, precinct-driven SWAT, Fort Brandt crews physically
// claiming parked aircraft, threat markers, and the visible cuffing phase.

import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const serverPort = 9560 + Math.floor(Math.random() * 100);
const debugPort = 10800 + Math.floor(Math.random() * 100);
const profile = `/tmp/cbz-session-contracts-${debugPort}`;
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
  "--window-size=1600,1000", `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${profile}`, base,
], { stdio: "ignore" });

let ws = null, nextId = 1;
const pending = new Map(), browserErrors = [];
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
  const out = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (out && out.exceptionDetails) throw new Error(out.exceptionDetails.exception?.description || out.exceptionDetails.text || "browser evaluation failed");
  return out && out.result && out.result.value;
}
async function json(expression) { return JSON.parse(await evaluate(`JSON.stringify(${expression})`)); }

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
  await send("Runtime.enable"); await send("Page.enable");

  let ready = false;
  for (let i = 0; i < 200; i++) {
    ready = !!(await evaluate("document.readyState==='complete' && !!(window.CBZ && CBZ.resetGame && CBZ.setMode && CBZ.cityTryNearestRide && CBZ.cityAnimalStrikePlayer && CBZ.cityMilitaryAirResponse && CBZ._landmassBuilders && CBZ._landmassBuilders.length>15)"));
    if (ready) break;
    await sleep(250);
  }
  if (!ready) throw new Error("game APIs did not become ready");
  await evaluate(`(function(){
    if(CBZ.CONFIG){
      CBZ.CONFIG.CITY_HITMAN_CAMPAIGN=false; CBZ.CONFIG.CITY_SCENE_DIRECTOR=false;
      CBZ.CONFIG.CITY_SWAT_VAN=true;
    }
    if(CBZ.renderer&&CBZ.renderer.render&&!CBZ.renderer.__contractNoDraw){
      CBZ.renderer.__contractDraw=CBZ.renderer.render.bind(CBZ.renderer);
      CBZ.renderer.render=function(){}; CBZ.renderer.__contractNoDraw=true;
    }
    CBZ.setMode("city"); CBZ.resetGame(); CBZ.setState("playing");
  })()`);
  await sleep(9000);

  // Install one deterministic interaction target at the player's feet. The
  // registry still performs its normal candidate resolution and DOM render.
  await evaluate(`(function(){
    const P=CBZ.player;
    window.__contractTarget={name:"Contract Civilian",kind:"civilian",char:{},pos:new THREE.Vector3(P.pos.x,0,P.pos.z),relPlayer:{respect:0,loyalty:0,affection:0,fear:0,grudge:0}};
    CBZ.interactions.describe("contract-person",function(t){return {label:t.name,note:""};});
    window.__contractZoneId=CBZ.interactions.registerZone({
      id:"qa-binary-contract",kind:"contract-person",prio:100000,radius:2,
      find:function(){const p=CBZ.player.pos;window.__contractTarget.pos.set(p.x,0,p.z);return window.__contractTarget;},
      options:[{id:"qa-ask-directions",slot:"e",prio:100000,label:"Ask for directions",onSelect:function(){window.__contractYes=true;}}]
    });
    CBZ.interactions.refresh();
  })()`);
  await sleep(450);

  const baseline = await json(`(function(){
    const labels=Array.from(document.querySelectorAll("#interactOpts .iopt .ilab")).map(function(e){return e.textContent.trim();});
    const body=document.body.innerText||"";
    const peds=(CBZ.cityPeds||[]).filter(function(p){return p&&!p.dead&&p.group&&p.group.visible;});
    const high=peds.slice().sort(function(a,b){return (CBZ.cityLevel?CBZ.cityLevel(b):1)-(CBZ.cityLevel?CBZ.cityLevel(a):1);})[0];
    const standing=high&&CBZ.cityInteractionStanding?CBZ.cityInteractionStanding(high):null;
    const pa=CBZ.city&&CBZ.city.playerActor;
    const threatPed=peds[0]||null,animal=(CBZ.cityWildlife||[]).find(function(a){return a&&!a.dead;})||null;
    let pedThreat=false,animalThreat=false;
    if(threatPed){const old=threatPed.rage;threatPed.rage=pa;pedThreat=CBZ.cityTargetsPlayer(threatPed);threatPed.rage=old;}
    if(animal){const old=animal.state;animal.state="charge";animalThreat=CBZ.cityTargetsPlayer(animal);animal.state=old;}
    const bison=(CBZ.cityWildlife||[]).find(function(a){return a&&!a.dead&&/bison|buffalo/i.test((a.species&&a.species.id)||"");});
    let ram=null;
    if(bison){
      const P=CBZ.player,oldHp=P.hp,oldPos=P.pos.clone();P.hp=Math.max(P.hp||100,1000);P.pos.set(bison.pos.x+0.7,Math.max(0,bison.pos.y),bison.pos.z+0.2);
      CBZ.cityAnimalStrikePlayer(bison,1,"ram");
      const ph=P._phys||{};ram={air:!!ph.air,vy:ph.vy||0,horizontal:Math.hypot(ph.vx||0,ph.vz||0),spin:Math.abs(ph.spin||0)};P.hp=oldHp;
      P.pos.copy(oldPos);ph.air=false;ph.down=0;ph.vx=ph.vy=ph.vz=0;ph.kx=ph.kz=0;ph.spin=ph.spin2=0;P.grounded=true;
      if(CBZ.playerChar&&CBZ.playerChar.group)CBZ.playerChar.group.position.copy(P.pos);
    }
    const lmg=(CBZ.FPS_WEAPONS||[]).find(function(w){return w&&w.key==="lmg";});
    const li=lmg?(CBZ.FPS_WEAPONS||[]).indexOf(lmg):-1;
    if(li>=0){CBZ.fps.weapon=li;CBZ.currentWeaponId=lmg.id||lmg.key;CBZ.player.crouch=true;CBZ.player.grounded=true;CBZ.player.speed=0;CBZ.fpsSetAim(true);}
    let lmgModel=CBZ.buildActorWeapon&&CBZ.buildActorWeapon("lmg"),bipodMeta=null;
    if(lmgModel)lmgModel.traverse(function(o){if(o.userData&&o.userData.bipod)bipodMeta=o.userData.bipod;});
    let sniper=CBZ.buildActorWeapon&&CBZ.buildActorWeapon("sniper"),optic=null;
    if(sniper)sniper.traverse(function(o){if(o.userData&&o.userData.isWeaponOptic)optic={name:o.name,children:o.children.length,real:true};});
    const thumb=CBZ.weaponThumbnail&&CBZ.weaponThumbnail("lmg");
    return {binaryLabels:labels,proposal:(document.getElementById("interactNote")||{}).textContent||"",lockEmoji:body.indexOf("🔒")>=0,
      fourthWall:/PERSON DOSSIER/i.test(body),standing:standing,pedThreat:pedThreat,animalThreat:animalThreat,
      ram:ram,bipodActive:CBZ.fpsBipodActive&&CBZ.fpsBipodActive(),bipodMeta:bipodMeta?{attached:bipodMeta.attached,functional:bipodMeta.functional,hinges:bipodMeta.hinges.length,feet:bipodMeta.feet.length}:null,
      sniperOptic:optic,thumbnail:typeof thumb==="string"&&thumb.indexOf("data:image/png")===0};
  })()`);
  await evaluate(`(function(){CBZ.fpsSetAim(false);CBZ.player.crouch=false;if(window.__contractZoneId)CBZ.interactions.unregister(window.__contractZoneId);CBZ.interactions.refresh();})()`);

  // Feed a human and animal through the live aimedActor channel so the real
  // gunpoint UI proves it can render both complete categories.
  const aimCards = {};
  await evaluate(`(function(){
    window.__savedAim={aimed:CBZ.aimedActor,aiming:CBZ.isAimingWeapon};
    const h=(CBZ.cityPeds||[]).find(function(p){return p&&!p.dead&&p.group&&p.group.visible;});
    window.__aimHuman=h;CBZ.isAimingWeapon=function(){return true;};CBZ.aimedActor=function(){return h?{actor:h,dist:8.5}:null;};
  })()`);
  await sleep(260);
  aimCards.human = await json(`(function(){const e=document.getElementById("cityAimDossier");return {shown:!!e&&e.style.display==="block",text:e?e.innerText:""};})()`);
  await evaluate(`(function(){const a=(CBZ.cityWildlife||[]).find(function(x){return x&&!x.dead;});window.__aimAnimal=a;CBZ.aimedActor=function(){return a?{actor:a,dist:11.2}:null;};})()`);
  await sleep(260);
  aimCards.animal = await json(`(function(){const e=document.getElementById("cityAimDossier");return {shown:!!e&&e.style.display==="block",text:e?e.innerText:""};})()`);
  await evaluate(`(function(){CBZ.aimedActor=window.__savedAim.aimed;CBZ.isAimingWeapon=window.__savedAim.aiming;})()`);

  // Standard-mapping Xbox Y must use the same physical seat lifecycle in both
  // directions. The gamepad poll itself owns these presses.
  const padSetup = await json(`(function(){
    CBZ.cityWantedReset();
    const car=(CBZ.cityCars||[]).find(function(c){return c&&!c.dead&&!c.player&&!c.npcDriver;});
    if(!car)return {ok:false};
    car.ai=false;car.v=0;CBZ.player.dead=false;CBZ.player.driving=false;CBZ.player._vehicle=null;
    CBZ.player.pos.set(car.pos.x+0.8,0,car.pos.z+0.3);if(CBZ.playerChar&&CBZ.playerChar.group){CBZ.playerChar.group.visible=true;CBZ.playerChar.group.position.copy(CBZ.player.pos);}
    const buttons=Array.from({length:16},function(){return {pressed:false,touched:false,value:0};});
    window.__qaPad={id:"QA Xbox Controller",index:0,connected:true,mapping:"standard",timestamp:1,axes:[0,0,0,0],buttons:buttons};
    try{Object.defineProperty(navigator,"getGamepads",{configurable:true,value:function(){return [window.__qaPad];}});}catch(e){return {ok:false,error:String(e)};}
    window.__qaPadCar=car;return {ok:true};
  })()`);
  let controller = { setup: padSetup };
  if (padSetup.ok) {
    await evaluate(`(function(){const b=window.__qaPad.buttons[3];b.pressed=true;b.value=1;window.__qaPad.timestamp++;})()`); await sleep(180);
    await evaluate(`(function(){const b=window.__qaPad.buttons[3];b.pressed=false;b.value=0;window.__qaPad.timestamp++;})()`); await sleep(180);
    controller.entered = await json(`(function(){return {driving:!!CBZ.player.driving,same:CBZ.player._vehicle===window.__qaPadCar};})()`);
    // The chop-shop booster must be actual reusable propulsion, not a cosmetic
    // attachment. Fit it to the boarded car, press the public Shift control and
    // observe both speed gain and the same rocket-plume contract as the jets.
    await evaluate(`(function(){const c=window.__qaPadCar;c.mods=c.mods||{};c.mods.booster=true;c._boostReady=1;c._boostT=0;if(CBZ.cityApplyCarModsRebuild)CBZ.cityApplyCarModsRebuild(c);window.__boostV0=Math.abs(c.v||0);window.dispatchEvent(new KeyboardEvent("keydown",{key:"Shift",code:"ShiftLeft",bubbles:true}));})()`);
    await sleep(260);
    controller.booster = await json(`(function(){const c=window.__qaPadCar,fx=c._modFx&&c._modFx.booster,fl=(fx&&fx.userData.flames)||[];return {speedGain:Math.abs(c.v||0)-(window.__boostV0||0),active:(c._boostT||0)>0,plumes:fl.length,reusable:fl.length===2&&fl.every(function(p){return !!(p.userData&&p.userData.rocketPlume);}),visible:fl.every(function(p){return p.visible;})};})()`);
    controller.jump = await json(`(function(){const r=(CBZ.cityStuntJumps||[])[0];if(!r)return {ramps:0};const speed=20,c={heading:Math.atan2(r.fx,r.fz),vx:r.fx*speed,vz:r.fz*speed};const hit=CBZ.cityStuntRampHit(c,r.x-r.fx*1.2,r.z-r.fz*1.2,r.x+r.fx*.25,r.z+r.fz*.25,speed);return {ramps:CBZ.cityStuntJumps.length,hit:!!hit,vy:hit&&hit.vy,rise:r.rise};})()`);
    await evaluate(`(function(){const b=window.__qaPad.buttons[3];b.pressed=true;b.value=1;window.__qaPad.timestamp++;})()`); await sleep(180);
    await evaluate(`(function(){const b=window.__qaPad.buttons[3];b.pressed=false;b.value=0;window.__qaPad.timestamp++;})()`); await sleep(180);
    controller.exited = await json(`(function(){return {driving:!!CBZ.player.driving,vehicle:!!CBZ.player._vehicle};})()`);
  }

  // Keep the response test non-lethal without changing targeting/movement.
  await evaluate(`(function(){
    window.__savedResponse={hurt:CBZ.cityHurtPlayer,bust:CBZ.cityBust};
    CBZ.cityHurtPlayer=function(){};CBZ.cityBust=function(){};
    const A=CBZ.city.arena,s=CBZ.cityPoliceStation();
    const corners=[[A.minX+80,A.minZ+80],[A.maxX-80,A.minZ+80],[A.minX+80,A.maxZ-80],[A.maxX-80,A.maxZ-80]];
    corners.sort(function(a,b){return Math.hypot(b[0]-s.x,b[1]-s.z)-Math.hypot(a[0]-s.x,a[1]-s.z);});
    const p=corners.find(function(q){const m=CBZ._militaryBase;return !m||q[0]<m.minX-20||q[0]>m.maxX+20||q[1]<m.minZ-20||q[1]>m.maxZ+20;})||corners[0];
    CBZ.player.pos.set(p[0],Math.max(0,CBZ.floorAt?CBZ.floorAt(p[0],p[1]):0),p[1]);if(CBZ.playerChar&&CBZ.playerChar.group)CBZ.playerChar.group.position.copy(CBZ.player.pos);
    window.__holdWanted=setInterval(function(){CBZ.game.heat=CBZ.CITY.starHeat[4]+20;CBZ.game.wanted=4;CBZ.game.cityCopTarget=12;CBZ.game.cityLastKnown={x:CBZ.player.pos.x,z:CBZ.player.pos.z,t:CBZ.now};},80);
  })()`);
  await sleep(1800);
  const fourEarly = await json(`(function(){return {swat:CBZ.citySwatResponse&&CBZ.citySwatResponse(),air:CBZ.cityMilitaryAirResponse(),responders:(CBZ.cityMilitaryPersonnel||[]).filter(function(t){return t&&t._milResponding;}).length};})()`);
  await sleep(5200);
  const fourLate = await json(`(function(){return {swat:CBZ.citySwatResponse&&CBZ.citySwatResponse(),air:CBZ.cityMilitaryAirResponse(),responders:(CBZ.cityMilitaryPersonnel||[]).filter(function(t){return t&&t._milResponding;}).length};})()`);

  await evaluate(`(function(){clearInterval(window.__holdWanted);window.__holdWanted=setInterval(function(){CBZ.game.heat=CBZ.CITY.starHeat[5]+40;CBZ.game.wanted=5;CBZ.game.cityCopTarget=20;CBZ.game.cityLastKnown={x:CBZ.player.pos.x,z:CBZ.player.pos.z,t:CBZ.now};},80);})()`);
  await sleep(2200);
  const fiveEarly = await json(`(function(){
    const active=(CBZ.cityMilitaryVehicles||[]).filter(function(v){return v&&v._aiActive;});
    return {air:CBZ.cityMilitaryAirResponse(),responders:(CBZ.cityMilitaryPersonnel||[]).filter(function(t){return t&&t._milResponding;}).length,
      active:active.map(function(v){return {kind:v.kind,name:v.model&&v.model.name,pilot:!!v._aiPilot,x:v.group.position.x,y:v.group.position.y,z:v.group.position.z};})};
  })()`);
  // A fighter first waits for dispatch, spools, taxis out, turns onto the
  // runway and only then accelerates. Give that physical sequence its time.
  await sleep(17500);
  const fiveLate = await json(`(function(){
    const active=(CBZ.cityMilitaryVehicles||[]).filter(function(v){return v&&v._aiActive;});
    return {air:CBZ.cityMilitaryAirResponse(),responders:(CBZ.cityMilitaryPersonnel||[]).filter(function(t){return t&&t._milResponding;}).length,
      active:active.map(function(v){return {kind:v.kind,name:v.model&&v.model.name,pilot:!!v._aiPilot,x:v.group.position.x,y:v.group.position.y,z:v.group.position.z};})};
  })()`);

  // Capture the actual response frame before renderer suppression is lifted;
  // force one draw only for this screenshot.
  await evaluate(`(function(){if(CBZ.renderer&&CBZ.scene&&CBZ.camera){
    const active=(CBZ.cityMilitaryVehicles||[]).filter(function(v){return v&&v._aiActive&&v.group;});
    if(active.length){
      const c=new THREE.Vector3();active.forEach(function(v){c.add(v.group.position);});c.multiplyScalar(1/active.length);
      CBZ.camera.position.set(c.x+105,c.y+70,c.z+125);CBZ.camera.lookAt(c.x,c.y+8,c.z);
    }
    try{CBZ.renderer.__contractDraw(CBZ.scene,CBZ.camera);}catch(e){}
  }})()`);
  const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  const shotDir = path.join(ROOT, "tools", "shots"); await mkdir(shotDir, { recursive: true });
  const shotPath = path.join(shotDir, "session-contracts.png"); await writeFile(shotPath, Buffer.from(shot.data, "base64"));

  await evaluate(`(function(){clearInterval(window.__holdWanted);CBZ.cityWantedReset();CBZ.cityHurtPlayer=window.__savedResponse.hurt;CBZ.cityBust=window.__savedResponse.bust;})()`);
  await sleep(300);

  // The bust must visibly enter the hands-up/cuff phase with a real officer,
  // then the test cancels before the mode handoff to jail.
  const bustSetup = await json(`(function(){
    const cop=(CBZ.cityCops||[]).find(function(c){return c&&!c.dead&&!c._swatPassenger;});if(!cop)return {ok:false};
    cop.pos.set(CBZ.player.pos.x+1.2,0,CBZ.player.pos.z);cop.group.visible=true;CBZ.cityBust({cop:cop});window.__bustCop=cop;return {ok:true};
  })()`);
  // Wait on simulation time rather than assuming 850 ms of loaded headless
  // wall-clock time equals 850 ms of game updates. The intended sequence is
  // hands up first, cuffs at t=.62, jail handoff at t=3.0.
  let arrest = null;
  for (let i = 0; i < 18; i++) {
    await sleep(150);
    arrest = await json(`(function(){const c=window.__bustCop;return {setup:${JSON.stringify(true)},arrested:!!CBZ.player._cityArrested,handsUp:!!(CBZ.playerChar&&CBZ.playerChar.handsUp),cuffed:!!(CBZ.playerChar&&CBZ.playerChar.cuffed),realCop:!!(c&&c._arrestingPlayer),copState:c&&c.state};})()`);
    if (arrest.cuffed) break;
  }
  arrest.setup = bustSetup.ok;
  await evaluate(`(function(){CBZ.cityWantedReset();})()`);

  const failures = [];
  if (baseline.binaryLabels.length !== 2 || baseline.binaryLabels.join("/") !== "YES/NO") failures.push(`interaction choices were ${baseline.binaryLabels.join("/") || "missing"}, not YES/NO`);
  if (!/Ask for directions\?/.test(baseline.proposal)) failures.push("binary panel did not name its proposition");
  if (baseline.lockEmoji) failures.push("lock emoji remained in live HUD");
  if (baseline.fourthWall) failures.push("PERSON DOSSIER fourth-wall label remained in live UI");
  if (!baseline.standing || baseline.standing.playerLevel == null || baseline.standing.targetLevel == null) failures.push("player/target level standing was unavailable");
  if (!baseline.pedThreat || !baseline.animalThreat) failures.push("human/animal targeting did not share the threat contract");
  if (!baseline.ram || !baseline.ram.air || baseline.ram.vy < 6.5 || baseline.ram.horizontal < 7) failures.push("bison ram did not launch through player physics");
  if (!baseline.bipodActive || !baseline.bipodMeta || !baseline.bipodMeta.attached || !baseline.bipodMeta.functional) failures.push("LMG bipod was not attached and mechanically active");
  if (!baseline.sniperOptic || baseline.sniperOptic.children < 12) failures.push("sniper did not use the complete physical optic");
  if (!baseline.thumbnail) failures.push("inventory weapon thumbnail was not rendered from the procedural model");
  if (!aimCards.human.shown || !/Street read[\s\S]*Condition[\s\S]*Who they are/i.test(aimCards.human.text)) failures.push("human gunpoint read was incomplete");
  if (!aimCards.animal.shown || !/Animal[\s\S]*Condition[\s\S]*Behavior/i.test(aimCards.animal.text)) failures.push("animal gunpoint read was incomplete");
  if (!controller.setup.ok || !controller.entered?.driving || !controller.entered?.same || controller.exited?.driving || controller.exited?.vehicle) failures.push("Xbox Y did not enter and exit the same car");
  if (!controller.booster?.active || controller.booster.speedGain <= 0 || !controller.booster.reusable || !controller.booster.visible) failures.push("chop-shop booster did not add speed through the reusable live rocket plume");
  if (controller.jump?.ramps !== 18 || !controller.jump?.hit || controller.jump.vy < 6.8) failures.push("world stunt ramps did not produce a physical airborne launch");
  if (!fourEarly.swat || !fourEarly.swat.driver || fourEarly.swat.seated < 2) failures.push("4-star SWAT did not leave the precinct as a real seated team");
  if (!fourLate.swat || fourLate.swat.distanceDriven < 0.5) failures.push("SWAT van did not physically drive from its dispatch origin");
  if (fourEarly.responders || fourLate.responders || fourEarly.air.helicopter || fourLate.air.helicopter || fourLate.air.jets.length) failures.push("military responded below five stars");
  if (!(fiveEarly.responders > 0 && fiveEarly.responders <= 8)) failures.push("five-star ground response was not a bounded real squad");
  if (!fiveEarly.air.helicopter || !fiveEarly.air.helicopter.pilot || !fiveEarly.air.helicopter.source || !fiveEarly.active.some((v)=>v.kind==="heli"&&v.pilot)) failures.push("five-star helicopter was not claimed by a named base pilot");
  if (!fiveLate.air.jets.length || !fiveLate.air.jets.some((j)=>j.pilot&&j.source&&/takeoff|inbound|attack|egress/.test(j.phase)) || !fiveLate.active.some((v)=>v.kind==="plane"&&/fighter/i.test(v.name||"")&&v.pilot&&v.y>0.5)) failures.push("fighter did not taxi/take off as an occupied base airframe");
  if (!arrest.setup || !arrest.arrested || !arrest.cuffed || !arrest.realCop) failures.push("busted did not show a real officer cuffing the player");
  if (browserErrors.length) failures.push(`browser runtime exceptions: ${browserErrors.slice(0,4).join(" | ")}`);

  console.log(JSON.stringify({ baseline, aimCards: { human: { shown: aimCards.human.shown, text: aimCards.human.text.slice(0,280) }, animal: { shown: aimCards.animal.shown, text: aimCards.animal.text.slice(0,280) } }, controller, fourEarly, fourLate, fiveEarly, fiveLate, arrest, screenshot: shotPath, browserErrors, failures }, null, 2));
  if (failures.length) process.exitCode = 1;
} finally {
  try { if (ws && ws.readyState === WebSocket.OPEN) await send("Browser.close"); } catch (_) {}
  if (!chrome.killed) chrome.kill("SIGTERM");
  if (!server.killed) server.kill("SIGTERM");
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}
