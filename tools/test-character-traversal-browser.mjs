#!/usr/bin/env node
// Focused real-Chrome regression for Gang City vault/mantle traversal. It loads
// the full game, poses the real player rig, lets the real peds updater commit an
// NPC run, and verifies parked-car traversal against live vehicle records.

import { spawn } from "node:child_process";
import { rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const serverPort = 9260 + Math.floor(Math.random() * 80);
const debugPort = 10260 + Math.floor(Math.random() * 80);
const profile = `/tmp/cbz-character-traversal-${debugPort}`;
const shotPath = `/tmp/cbz-character-traversal-${debugPort}.png`;
const mantleShotPath = `/tmp/cbz-character-mantle-${debugPort}.png`;
const chromePath = process.env.CBZ_CHROME || (process.platform === "darwin"
  ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  : "/opt/pw-browsers/chromium");

await rm(profile, { recursive: true, force: true });
const server = spawn("python3", [path.join(ROOT, "tools/devserver.py")], {
  env: { ...process.env, PORT: String(serverPort) },
  stdio: "ignore",
});
const base = `http://127.0.0.1:${serverPort}/`;
const chrome = spawn(chromePath, [
  "--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
  "--enable-unsafe-swiftshader", "--enable-webgl", "--mute-audio",
  "--window-size=1280,800", `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${profile}`, base,
], { stdio: "ignore" });

let ws = null, nextId = 1;
const pending = new Map();
const browserErrors = [];

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
    const timeout = setTimeout(() => {
      if (!pending.has(id)) return;
      pending.delete(id);
      reject(new Error(`${method} timed out`));
    }, 45000);
    if (timeout.unref) timeout.unref();
  });
}

async function evaluate(expression) {
  const out = await send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (out && out.exceptionDetails) {
    throw new Error(out.exceptionDetails.exception?.description ||
      out.exceptionDetails.text || "browser evaluation failed");
  }
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
      browserErrors.push(msg.params.exceptionDetails?.exception?.description ||
        msg.params.exceptionDetails?.text || "uncaught browser exception");
      return;
    }
    if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
      browserErrors.push((msg.params.args || []).map((a) => a.value || a.description || "").join(" "));
      return;
    }
    if (!msg.id || !pending.has(msg.id)) return;
    const p = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) p.reject(new Error(msg.error.message));
    else p.resolve(msg.result);
  });
  await send("Runtime.enable");
  await send("Page.enable");

  for (let i = 0; i < 120; i++) {
    const ready = await evaluate(
      "document.readyState==='complete' && !!(window.CBZ && CBZ.game && " +
      "document.getElementById('playBtn') && CBZ.characterTraversal)");
    if (ready) break;
    await sleep(250);
  }
  await evaluate("(() => { if (CBZ.CONFIG) CBZ.CONFIG.CITY_HITMAN_CAMPAIGN=false; return true; })()");
  let playing = false;
  for (let i = 0; i < 120 && !playing; i++) {
    await evaluate("(() => { const b=document.getElementById('playBtn'); if(b)b.click(); return true; })()");
    await sleep(500);
    playing = !!(await evaluate("CBZ.game && CBZ.game.state === 'playing'"));
  }
  if (!playing) throw new Error("Gang City did not enter playing state");
  await sleep(5500);

  const playerMid = JSON.parse(await evaluate(`JSON.stringify((() => {
    const P = CBZ.player, ch = CBZ.playerChar;
    if (!P || !ch || !ch.parts || !CBZ.characterTraversal) return { ok:false, error:"player traversal owner missing" };
    // Render the REAL live rig in a clean QA bay. The city remains fully loaded
    // behind it; isolating presentation keeps an airport wall or first-person
    // camera rule from hiding the exact hand/leg silhouette being audited.
    const x = 0, z = 0, y = 0;
    window.__traversalFloorAt = CBZ.floorAt;
    window.__traversalWaterAt = CBZ.cityWaterAt;
    CBZ.floorAt = () => 0;
    CBZ.cityWaterAt = () => false;
    window.__traversalCars = CBZ.cityCars;
    window.__traversalPeds = CBZ.cityPeds;
    CBZ.game.state = "traversal-qa";
    const qaScene = window.__traversalScene = new THREE.Scene();
    qaScene.background = new THREE.Color(0x9fb4ca);
    qaScene.add(new THREE.HemisphereLight(0xffffff,0x405064,0.72));
    const sun = new THREE.DirectionalLight(0xffffff,0.86);
    sun.position.set(-4,8,-5); qaScene.add(sun);
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(30,30),
      new THREE.MeshLambertMaterial({color:0xb7c0c9})
    );
    floor.rotation.x=-Math.PI/2;floor.position.y=-0.02;floor.receiveShadow=true;qaScene.add(floor);
    qaScene.add(ch.group);
    const c = window.__traversalFixture = {
      minX:x-1.2, maxX:x+1.2, minZ:z+1.15, maxZ:z+2.05,
      y0:y, y1:y+0.92, _city:true
    };
    CBZ.colliders = [c]; CBZ.cityCars = []; CBZ.platforms = [];
    if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
    const mesh = window.__traversalMesh = new THREE.Mesh(
      new THREE.BoxGeometry(2.4, 0.92, 0.9),
      new THREE.MeshBasicMaterial({ color:0x475569 })
    );
    mesh.position.set(x, y+0.46, z+1.60); mesh.castShadow=true; mesh.receiveShadow=true;
    c.ref=mesh;
    qaScene.add(mesh);
    P.pos.set(x, y, z); P.vy=0; P.grounded=true; P.dead=false; P.ko=0;
    P.driving=null; P._doorArc=null; P._traversal=null; P._traverseSurface=null;
    ch.group.visible=true; ch.group.position.copy(P.pos); ch.group.rotation.set(0,0,0);
    if (ch.model) ch.model.rotation.set(0,0,0);
    P._traverseStyle=1; // the next low-solid vocabulary slot is the spy spin
    const s=CBZ.characterTraversal.start(P,ch,0,1,{
      speed:8,radius:P.radius,height:ch.metric&&ch.metric.height,
      running:true,sprinting:true,allowTop:false,cars:false
    });
    if (!s) return { ok:false, error:"player could not start low vault" };
    // Sample the real animator, not a copied easing formula. The first/last
    // beats should barely rotate; the middle carries the readable revolution.
    const curve=[0,0.08,0.18,0.34,0.50,0.72,0.88,1].map(u=>{
      s.t=u;ch.traversePose=s;CBZ.animChar(ch,s.speed,1/60);
      return {u,roll:ch.model?ch.model.rotation.z:0};
    });
    s.t=0;s.elapsed=0;if(ch.model)ch.model.rotation.set(0,0,0);
    // One-third through the roll keeps the one-hand plant and tucked legs
    // readable in the film frame; halfway is exactly upside-down and flattens
    // this blocky rig into a much less useful silhouette.
    CBZ.characterTraversal.step(P,ch,s.duration*0.34,true);
    if (!CBZ.renderer.__traversalCamera) {
      const render=CBZ.renderer.render.bind(CBZ.renderer);
      CBZ.renderer.render=function(scene,camera) {
        const q=window.__traversalCamera;
        if(q){
          camera.position.set(q[0],q[1],q[2]);camera.lookAt(q[3],q[4],q[5]);camera.updateMatrixWorld(true);
          if(CBZ.playerChar&&CBZ.playerChar.group)CBZ.playerChar.group.visible=true;
        }
        return render(window.__traversalScene||scene,camera);
      };
      CBZ.renderer.__traversalCamera=true;
    }
    window.__traversalCamera=[x-2.15,y+2.05,z-2.75,x,y+1.10,z+1.35];
    return {
      ok:true, kind:s.kind, style:s.style, t:s.t,
      duration:s.duration, curve,
      airborne:P.pos.y>y+0.4,
      roll:ch.model ? ch.model.rotation.z : 0,
      handPlant:ch.parts.la ? ch.parts.la.rotation.x : 0,
      kneeTuck:ch.low&&ch.low.rl ? ch.low.rl.rotation.x : 0
    };
  })())`));

  await sleep(150);
  const shot = await send("Page.captureScreenshot", { format: "png" });
  await writeFile(shotPath, Buffer.from(shot.data, "base64"));

  // A second film frame is devoted to the tall move. Measure the real wrist
  // sockets against the physics-provided lip, so "arms bent" cannot pass while
  // the hands are visibly floating above or behind the obstacle.
  const mantleVisual = JSON.parse(await evaluate(`JSON.stringify((() => {
    const P=CBZ.player,ch=CBZ.playerChar,api=CBZ.characterTraversal;
    while(P._traversal)api.step(P,ch,0.05,true);
    const c=window.__traversalFixture,x=(c.minX+c.maxX)*0.5,z=c.minZ-1.15,y=0;
    c.y0=y;c.y1=y+2.10;c.maxZ=c.minZ+0.58;
    window.__traversalMesh.geometry.dispose();
    window.__traversalMesh.geometry=new THREE.BoxGeometry(2.4,2.10,0.58);
    window.__traversalMesh.position.set(x,y+1.05,(c.minZ+c.maxZ)*0.5);
    if(CBZ.markCollidersDirty)CBZ.markCollidersDirty();
    P.pos.set(x,y,z);P.grounded=true;P.vy=0;P._traversal=null;
    ch.group.position.copy(P.pos);ch.group.rotation.set(0,0,0);
    if(ch.model)ch.model.rotation.set(0,0,0);
    const s=api.start(P,ch,0,1,{
      speed:8,radius:P.radius,height:ch.metric&&ch.metric.height,
      running:true,sprinting:false,allowTop:false,cars:false
    });
    if(!s)return {ok:false,error:"player could not start tall mantle"};
    api.step(P,ch,s.duration*0.38,true);
    ch.group.updateMatrixWorld(true);
    const lp=ch.sockets.leftHand.getWorldPosition(new THREE.Vector3());
    const rp=ch.sockets.rightHand.getWorldPosition(new THREE.Vector3());
    const gripHalf=Math.min(0.43,((ch.metric&&ch.metric.width)||0.9)*0.40);
    const lt=new THREE.Vector3(s.ledgeX+s.dirZ*gripHalf,s.top+0.018,s.ledgeZ-s.dirX*gripHalf);
    const rt=new THREE.Vector3(s.ledgeX-s.dirZ*gripHalf,s.top+0.018,s.ledgeZ+s.dirX*gripHalf);
    window.__traversalCamera=[x-3.70,y+2.05,z+1.02,x,y+1.32,z+1.13];
    return {
      ok:true,t:s.t,duration:s.duration,root:[P.pos.x,P.pos.y,P.pos.z],
      leftShoulder:ch.parts.la.rotation.x,rightShoulder:ch.parts.ra.rotation.x,
      leftElbow:ch.low.la.rotation.x,rightElbow:ch.low.ra.rotation.x,
      leftWrist:[lp.x,lp.y,lp.z],rightWrist:[rp.x,rp.y,rp.z],
      leftTarget:[lt.x,lt.y,lt.z],rightTarget:[rt.x,rt.y,rt.z],
      leftDistance:lp.distanceTo(lt),rightDistance:rp.distanceTo(rt)
    };
  })())`));
  await sleep(150);
  const mantleShot = await send("Page.captureScreenshot", { format: "png" });
  await writeFile(mantleShotPath, Buffer.from(mantleShot.data, "base64"));

  // Restore the low fixture expected by the remaining integration checks.
  await evaluate(`(() => {
    const P=CBZ.player,ch=CBZ.playerChar,api=CBZ.characterTraversal,c=window.__traversalFixture;
    while(P._traversal)api.step(P,ch,0.05,true);
    c.y0=0;c.y1=0.92;c.maxZ=c.minZ+0.90;
    window.__traversalMesh.geometry.dispose();
    window.__traversalMesh.geometry=new THREE.BoxGeometry(2.4,0.92,0.90);
    window.__traversalMesh.position.set(0,0.46,(c.minZ+c.maxZ)*0.5);
    if(CBZ.markCollidersDirty)CBZ.markCollidersDirty();
    return true;
  })()`);

  const rest = JSON.parse(await evaluate(`JSON.stringify((() => {
    const failures=[], P=CBZ.player, ch=CBZ.playerChar, api=CBZ.characterTraversal;
    while(P._traversal) api.step(P,ch,0.05,true);
    const c=window.__traversalFixture, x=(c.minX+c.maxX)*0.5, z=c.minZ-1.15;
    const y=CBZ.floorAt ? (+CBZ.floorAt(x,z)||0) : 0;

    // Older solid props sometimes carry only XZ + their real mesh. Confirm the
    // browser THREE.Box3 path reads that existing mesh without needing the prop
    // owner to invent a second height record.
    delete c.y0;delete c.y1;if(CBZ.markCollidersDirty)CBZ.markCollidersDirty();
    P.pos.set(x,y,z);P.grounded=true;P._traversal=null;ch.group.position.copy(P.pos);
    const legacyMesh=api.probe(P,ch,0,1,{
      speed:8,radius:P.radius,height:ch.metric&&ch.metric.height,
      running:true,allowTop:false,cars:false
    });
    if(!legacyMesh||legacyMesh.kind!=="vault")failures.push("legacy registered solid mesh did not supply its visual height");

    // High, hand-reachable obstacle: both arms must own the ledge and the
    // trajectory must enter a distinct hang/pull phase.
    c.y0=y; c.y1=y+2.10; c.maxZ=c.minZ+0.58;
    window.__traversalMesh.geometry.dispose();
    window.__traversalMesh.geometry=new THREE.BoxGeometry(2.4,2.10,0.58);
    window.__traversalMesh.position.set(x,y+1.05,(c.minZ+c.maxZ)*0.5);
    if(CBZ.markCollidersDirty)CBZ.markCollidersDirty();
    P.pos.set(x,y,z); P.grounded=true; P.vy=0; P._traversal=null;
    ch.group.position.copy(P.pos); if(ch.model)ch.model.rotation.set(0,0,0);
    const mantle=api.start(P,ch,0,1,{
      speed:8,radius:P.radius,height:ch.metric&&ch.metric.height,
      running:true,allowTop:false,cars:false
    });
    if(mantle) api.step(P,ch,mantle.duration*0.46,true);
    const mantlePose={
      started:!!mantle,kind:mantle&&mantle.kind,
      left:ch.parts.la&&ch.parts.la.rotation.x,
      right:ch.parts.ra&&ch.parts.ra.rotation.x,
      leftElbow:ch.low&&ch.low.la&&ch.low.la.rotation.x,
      rightElbow:ch.low&&ch.low.ra&&ch.low.ra.rotation.x,
      raised:P.pos.y>y+0.4,
      gate:mantle?{
        now:CBZ.now,wallStart:mantle.wallStart,duration:mantle.duration,
        dead:!!P.dead,driving:!!P.driving,inCar:!!P.inCar,ko:P.ko||0
      }:null
    };
    if(!mantle||mantle.kind!=="mantle")failures.push("real player rig did not enter mantle");
    if(!(mantlePose.left>-2.0&&mantlePose.right>-2.0&&
         mantlePose.leftElbow<-0.25&&mantlePose.rightElbow<-0.25&&mantlePose.raised)){
      failures.push("mantle did not replace overhead arms with a bent pull chain");
    }
    while(P._traversal)api.step(P,ch,0.05,true);

    // The actual Gang City peds updater must be the caller that commits a
    // running NPC, not a second test-only movement path.
    c.y0=y;c.y1=y+0.90;c.maxZ=c.minZ+0.86;
    window.__traversalMesh.geometry.dispose();
    window.__traversalMesh.geometry=new THREE.BoxGeometry(2.4,0.90,0.86);
    window.__traversalMesh.position.set(x,y+0.45,(c.minZ+c.maxZ)*0.5);
    if(CBZ.markCollidersDirty)CBZ.markCollidersDirty();
    const ped=(window.__traversalPeds||[]).find(p=>p&&!p.dead&&p.char&&p.group&&!p.vendor&&!p.staffPost&&!p.inCar&&!p.controlled&&!p._npcAttached&&!p._bumHunt);
    const pedUpdater=(CBZ.updaters||[]).find(u=>u.order===34&&String(u.fn).includes('cityCampaignObservationGate'));
    let npc={available:!!(ped&&pedUpdater),started:false,kind:null,landed:false};
    if(ped&&pedUpdater){
      CBZ.cityPeds=[ped];
      ped._parked=false;ped._spawnHidden=false;ped.culled=false;ped.dead=false;ped.ko=0;
      ped.controlled=false;ped.inCar=null;ped.vendor=false;ped.staffPost=null;ped.pause=0;
      ped.state="flee";ped.surrender=false;ped.surrenderT=0;ped.baseSpeed=Math.max(2.2,ped.baseSpeed||0);
      ped._phys=null;ped._traversal=null;ped._traverseProbeT=0;ped.enterT=0;ped.chatT=0;
      ped.callT=0;ped._faceT=0;ped._bumHunt=false;ped._npcAttached=null;
      ped.armed=false;ped.posePoint=1;
      ped.pos.set(x,y,z);ped.group.position.copy(ped.pos);ped.target.set(x,y,z+8);
      ped.group.visible=true;ped.slice=0;CBZ.camera.position.set(x+3,y+2,z-3);
      const before=api.stats().starts;
      for(let i=0;i<8&&!ped._traversal;i++){
        // think() is deliberately time-sliced and may choose a fresh refuge on
        // one of these ticks. Restore the controlled QA run immediately before
        // every call; one of the other three ticks exercises move() directly.
        ped.state="flee";ped.pause=0;ped._traverseProbeT=0;
        ped.target.set(x,y,z+8);
        pedUpdater.fn(0.05);
      }
      npc.started=!!ped._traversal&&api.stats().starts>before;
      npc.kind=ped._traversal&&ped._traversal.kind;
      const reactionUpdater=(CBZ.updaters||[]).find(u=>u.order===89&&String(u.fn).includes("cityPeds"));
      const weaponUpdater=(CBZ.updaters||[]).find(u=>u.order===36&&String(u.fn).includes("poseList"));
      const poseBefore=[ped.char.parts.la.rotation.x,ped.char.parts.ra.rotation.x];
      npc.witnessPoseHeld=Math.abs(poseBefore[1]+1.52)>0.05;
      if(reactionUpdater)reactionUpdater.fn(0.05); // fleeing would otherwise throw both hands up
      const poseAfterReaction=[ped.char.parts.la.rotation.x,ped.char.parts.ra.rotation.x];
      ped.armed=true;ped.weapon=ped.weapon||"Pistol";
      if(weaponUpdater)weaponUpdater.fn(0.05);     // armed would otherwise force gun-ready
      const poseAfterWeapon=[ped.char.parts.la.rotation.x,ped.char.parts.ra.rotation.x];
      npc.latePoseOwners={
        reactions:!!reactionUpdater&&Math.max(
          Math.abs(poseAfterReaction[0]-poseBefore[0]),
          Math.abs(poseAfterReaction[1]-poseBefore[1]))<0.08,
        weapons:!!weaponUpdater&&Math.max(
          Math.abs(poseAfterWeapon[0]-poseAfterReaction[0]),
          Math.abs(poseAfterWeapon[1]-poseAfterReaction[1]))<0.08
      };
      npc.gate={
        before,after:api.stats(),dead:!!ped.dead,driving:!!ped.driving,
        inCar:!!ped.inCar,controlled:!!ped.controlled,ko:ped.ko||0,
        state:ped.state,pos:[ped.pos.x,ped.pos.y,ped.pos.z],
        baseSpeed:ped.baseSpeed,radius:ped.radius||0.5,
        collider:{minZ:c.minZ,maxZ:c.maxZ,y0:c.y0,y1:c.y1},
        nearby:CBZ.queryCollidersNear?CBZ.queryCollidersNear(0,0,3,[]).length:-1,
        manual:(() => {
          const q=api.probe(ped,ped.char,0,1,{
            speed:ped.baseSpeed*2.2,radius:ped.radius||0.5,
            height:(ped.char.metric&&ped.char.metric.height)||1.7,
            running:true,sprinting:true,allowTop:false,cars:false
          });
          return q?{kind:q.kind,style:q.style,enter:q.enter,endZ:q.endZ}:null;
        })()
      };
      while(ped._traversal)api.step(ped,ped.char,0.05,true);
      npc.landed=ped.pos.z>c.maxZ+(ped.radius||0.5);
    }
    if(!npc.available||!npc.started||npc.kind!=="vault"||!npc.landed)failures.push("Gang City running NPC did not use shared vault path");
    if(!npc.witnessPoseHeld||!npc.latePoseOwners||!npc.latePoseOwners.reactions||!npc.latePoseOwners.weapons)failures.push("late NPC pose owners overwrote traversal limbs");

    // Probe live parked-vehicle records from the side. The same car must accept
    // a controlled non-sprint vault and reserve the spy spin for sprint input.
    CBZ.colliders=[];CBZ.cityCars=window.__traversalCars||[];
    if(CBZ.markCollidersDirty)CBZ.markCollidersDirty();
    let carProbe=null, carName="", carCandidates=[];
    for(const car of CBZ.cityCars){
      const body=String(car&&((car.model&&car.model.body)||car._bk||(car.group&&car.group.userData&&car.group.userData.bodyKind))||"").toLowerCase();
      if(!car||!car.pos||car.player||!car.dims||car._boatKey||car._boatRec||body==="boat"||
          Math.max(Math.abs(car.v||0),Math.hypot(car.vx||0,car.vz||0))>1.15)continue;
      const h=car.heading||(car.group&&car.group.rotation.y)||0,c0=Math.cos(h),s0=Math.sin(h);
      const radius=P.radius||0.55,side=car.dims.width*0.5+radius+0.72;
      const fake={pos:new THREE.Vector3(car.pos.x+c0*side,car.group?car.group.position.y:(car.pos.y||0),car.pos.z-s0*side),radius,grounded:true};
      const normal=api.probe(fake,ch,-c0,s0,{speed:8,radius,height:ch.metric&&ch.metric.height,running:true,sprinting:false,allowTop:false,cars:true});
      const q=api.probe(fake,ch,-c0,s0,{speed:8,radius,height:ch.metric&&ch.metric.height,running:true,sprinting:true,allowTop:false,cars:true});
      if(q&&q.car===car){
        const rawName=car.displayName||car.kind||car.model||"city car";
        carCandidates.push({
          name:typeof rawName==="string"?rawName:(rawName.name||rawName.body||"city car"),
          height:car.dims.height,kind:q.kind,style:q.style,
          normalStyle:normal&&normal.style,duration:q.duration
        });
        if(q.kind==="vault"&&q.style==="spin"&&normal&&normal.kind==="vault"&&normal.style!=="spin"){
          carProbe=q;carName=typeof rawName==="string"?rawName:(rawName.name||rawName.body||"city car");break;
        }
      }
    }
    const parkedCar={found:!!carProbe,name:carName,kind:carProbe&&carProbe.kind,style:carProbe&&carProbe.style,candidates:carCandidates.slice(0,12)};
    if(!carProbe||carProbe.kind!=="vault"||carProbe.style!=="spin")failures.push("no live parked city car accepted the side-on spy vault");

    return {
      failures,
      legacyMesh:legacyMesh&&{kind:legacyMesh.kind,top:legacyMesh.top},
      mantle:mantlePose,npc,parkedCar,stats:api.stats()
    };
  })())`));

  const relevantErrors = browserErrors.filter((e) =>
    /characterTraversal|traversePose|smooth01|test-character-traversal/i.test(e));
  if (relevantErrors.length) rest.failures.push(...relevantErrors.map((e) => `browser error: ${e}`));
  const curve = playerMid.curve || [];
  const curveMonotonic = curve.length === 8 && curve.every((p,i) =>
    i === 0 || p.roll <= curve[i-1].roll + 0.001);
  const easedEnds = curve.length === 8 &&
    Math.abs(curve[1].roll-curve[0].roll) < 0.03 &&
    Math.abs(curve[7].roll-curve[6].roll) < 0.03;
  if (!playerMid.ok || playerMid.kind !== "vault" || playerMid.style !== "spin" ||
      playerMid.duration < 1.15 || !curveMonotonic || !easedEnds ||
      !playerMid.airborne || Math.abs(playerMid.roll) < 1.0 ||
      playerMid.handPlant > -0.6 || playerMid.kneeTuck < 0.25) {
    rest.failures.push(`player spy-vault pose failed: ${JSON.stringify(playerMid)}`);
  }
  if (!mantleVisual.ok || mantleVisual.leftDistance > 0.10 ||
      mantleVisual.rightDistance > 0.10 ||
      mantleVisual.leftShoulder < -1.45 || mantleVisual.leftShoulder > 0.15 ||
      mantleVisual.rightShoulder < -1.45 || mantleVisual.rightShoulder > 0.15 ||
      mantleVisual.leftElbow < -2.20 || mantleVisual.leftElbow > -0.65 ||
      mantleVisual.rightElbow < -2.20 || mantleVisual.rightElbow > -0.65) {
    rest.failures.push(`mantle wrist contact failed: ${JSON.stringify(mantleVisual)}`);
  }

  const report = {
    playerMid, mantleVisual, ...rest,
    screenshots:{spin:shotPath,mantle:mantleShotPath}
  };
  console.log(JSON.stringify(report, null, 2));
  if (report.failures.length) process.exitCode = 1;
} finally {
  if (chrome) chrome.kill("SIGTERM");
  if (server) server.kill("SIGTERM");
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}
