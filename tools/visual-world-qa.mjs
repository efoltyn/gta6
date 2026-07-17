#!/usr/bin/env node
/* Render-only visual acceptance loop for the live city world. Boots the real
   browser build once, keeps gameplay rendering intact, hides only HTML UI, and
   photographs the major authored zones from useful oblique views. Also records
   exact runtime facts for aircraft picking, official assets and skyline shape. */
import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(ROOT, "tools", "shots", "world-qa");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const webPort = 9060 + Math.floor(Math.random() * 80);
const debugPort = 11060 + Math.floor(Math.random() * 80);
const profile = `/tmp/cbz-visual-world-${debugPort}`;
const chromeBin = process.env.CBZ_CHROME || (process.platform === "darwin"
  ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  : "/opt/pw-browsers/chromium");
const base = `http://127.0.0.1:${webPort}/?seed=90210`;
const only = new Set(String(process.env.CBZ_VISUAL_ONLY || "").split(",").map((s) => s.trim()).filter(Boolean));

await mkdir(OUT, { recursive: true });
await rm(profile, { recursive: true, force: true });
const server = spawn("python3", [path.join(ROOT, "tools", "devserver.py")], {
  cwd: ROOT, env: { ...process.env, PORT: String(webPort) }, stdio: "ignore",
});
const chrome = spawn(chromeBin, [
  "--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
  "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
  "--enable-webgl", "--disable-background-timer-throttling",
  "--disable-renderer-backgrounding", "--mute-audio", "--window-size=1600,1000",
  `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, base,
], { cwd: ROOT, stdio: "ignore" });

let ws = null, seq = 1;
const pending = new Map(), browserErrors = [];
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = seq++;
    const timer = setTimeout(() => {
      if (!pending.has(id)) return;
      pending.delete(id); reject(new Error(`${method} timed out`));
    }, 90000);
    pending.set(id, { resolve, reject, timer });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const m = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  const r = m && m.result;
  if (r && r.exceptionDetails) throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text || "browser evaluation failed");
  return r && r.result && r.result.value;
}
async function screenshot(name) {
  const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  const file = path.join(OUT, `${name}.png`);
  await writeFile(file, Buffer.from(shot.result.data, "base64"));
  console.log(path.relative(ROOT, file));
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
      const d = msg.params && msg.params.exceptionDetails;
      browserErrors.push((d && d.exception && d.exception.description) || (d && d.text) || "runtime exception");
      return;
    }
    if (msg.method === "Runtime.consoleAPICalled" && msg.params && msg.params.type === "error") {
      browserErrors.push(msg.params.args.map((a) => a.value || a.description || "").join(" "));
      return;
    }
    if (!msg.id || !pending.has(msg.id)) return;
    const p = pending.get(msg.id); pending.delete(msg.id); clearTimeout(p.timer);
    if (msg.error) p.reject(new Error(msg.error.message)); else p.resolve(msg);
  });
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });

  for (let i = 0; i < 160; i++) {
    if (await evaluate("document.readyState==='complete' && !!(window.CBZ && CBZ.resetGame && CBZ.setMode && CBZ.renderer && CBZ._landmassBuilders && CBZ._landmassBuilders.length>15)")) break;
    await sleep(300);
  }
  await evaluate(`(function(){
    if(CBZ.CONFIG){CBZ.CONFIG.CITY_HITMAN_CAMPAIGN=false;CBZ.CONFIG.CITY_SCENE_DIRECTOR=false;}
    CBZ.setMode("city");CBZ.resetGame();CBZ.setState("playing");
    if(CBZ.disarmFPSAfterIntro)CBZ.disarmFPSAfterIntro();
    if(CBZ.setFPS)CBZ.setFPS(false);
  })()`);
  for (let i = 0; i < 180; i++) {
    const ready = await evaluate("!!(CBZ.city && CBZ.city.arena && CBZ.city.arena.regions && CBZ.city.arena.regions.length >= 45 && !CBZ.citySpawnDraining)");
    if (ready) break;
    await sleep(500);
  }
  // The IFC is a large local model. Give it time to finish without making it a
  // precondition for the rest of the world screenshots.
  if (!only.size) for (let i = 0; i < 80; i++) {
    const s = await evaluate("CBZ.officialAssetState && CBZ.officialAssetState.ifc");
    if (s === "ready" || s === "error") break;
    await sleep(500);
  }

  const runtime = JSON.parse(await evaluate(`JSON.stringify((function(){
    const A=CBZ.city.arena,regs=A.regions||[],lots=A.lots||[],machines=CBZ.cityMilitaryVehicles||[];
    const towers=lots.filter(l=>l&&l.building&&(l.building.storeys||0)>=7);
    const districts={};towers.forEach(l=>{const k=l.district||"unknown";districts[k]=(districts[k]||0)+1;});
    const mountainBuildings=lots.filter(l=>l&&l.building).map(l=>{
      const x=Number.isFinite(l.cx)?l.cx:(Number.isFinite(l.x)?l.x:NaN);
      const z=Number.isFinite(l.cz)?l.cz:(Number.isFinite(l.z)?l.z:NaN);
      const local=Number.isFinite(x)&&Number.isFinite(z)&&CBZ.snowTerrainHeightAt?CBZ.snowTerrainHeightAt(x,z):0;
      const greater=Number.isFinite(x)&&Number.isFinite(z)&&CBZ.greaterSnowTerrainHeightAt?CBZ.greaterSnowTerrainHeightAt(x,z):0;
      return {name:l.building.name||l.name||"",district:l.district||l.building.district||"",x:x,z:z,
        storeys:l.building.storeys||0,height:Math.max(local||0,greater||0)};
    }).filter(b=>Number.isFinite(b.x)&&Number.isFinite(b.z)&&(b.height>1||b.district==="snow"))
      .sort((a,b)=>b.storeys-a.storeys||b.height-a.height);
    let aircraftProbe=null;
    const plane=machines.find(v=>v&&v.civilian&&v.kind==="plane"&&v.group);
    if(plane&&CBZ.cityCivilAircraftRayTest){
      plane.group.updateMatrixWorld(true);
      const box=new THREE.Box3().setFromObject(plane.group),center=box.getCenter(new THREE.Vector3());
      const origin=center.clone().add(new THREE.Vector3(0,1,Math.max(22,box.getSize(new THREE.Vector3()).z+12)));
      const dir=center.clone().sub(origin).normalize();
      const hit=CBZ.cityCivilAircraftRayTest(origin.x,origin.y,origin.z,dir.x,dir.y,dir.z,120);
      aircraftProbe={name:plane.model&&plane.model.name,box:[box.min.toArray(),box.max.toArray()],hit:hit&&[hit.x,hit.y,hit.z],distance:hit&&hit.dist,collider:!!plane.collider};
    }
    let oceanCount=0;CBZ.scene.traverse(o=>{if(o.name==="world-sea")oceanCount++;});
    return {regions:regs.map(r=>r.name),lots:lots.length,towers:towers.length,towersByDistrict:districts,
      mountainBuildings:mountainBuildings.slice(0,40),
      official:CBZ.officialAssetState,truck:!!CBZ.scene.getObjectByName("official-threejs-farm-truck"),
      ifc:!!CBZ.scene.getObjectByName("official-ifc-civic-campus"),aircraftProbe:aircraftProbe,
      stuntJumps:(CBZ.cityStuntJumps||[]).length,oneOcean:oceanCount,
      worldScale:CBZ.city&&CBZ.city.arena&&CBZ.city.arena.worldScale};
  })())`));
  await writeFile(path.join(OUT, "runtime.json"), JSON.stringify({ runtime, browserErrors }, null, 2));
  console.log(JSON.stringify(runtime, null, 2));

  // Geometry ownership probe for the exact failure that looked like a second
  // blue water material. A downward ray around the speedway rim must always
  // find authored track or country earth; the ocean shader may exist below it
  // but no coordinate classified as land may be an empty clear-colour hole.
  const terrainAudit = JSON.parse(await evaluate(`JSON.stringify((function(){
    const A=CBZ.city.arena,wf=CBZ.waterField,ray=new THREE.Raycaster();
    function shown(o){for(let p=o;p;p=p.parent)if(p.visible===false)return false;return true;}
    function materialName(m){if(Array.isArray(m))m=m[0];return m?{type:m.type,name:m.name||"",color:m.color&&"#"+m.color.getHexString(),fog:m.fog!==false}:null;}
    function surfaceClaims(x,z){
      const claims=[],box=new THREE.Box3();
      A.root.traverse(o=>{
        if(!o.isMesh||!(o.userData&&o.userData.worldSurface))return;
        try{
          o.updateMatrixWorld(true);box.setFromObject(o);
          if(x<box.min.x||x>box.max.x||z<box.min.z||z>box.max.z)return;
          claims.push({name:o.name||"(unnamed)",geometry:o.geometry&&o.geometry.type,
            visible:shown(o),nonRect:!!o.userData.nonRectSurface,sparse:!!o.userData.sparseTerrain,
            bounds:[+box.min.x.toFixed(1),+box.max.x.toFixed(1),+box.min.z.toFixed(1),+box.max.z.toFixed(1)]});
        }catch(_){}
      });
      return claims;
    }
    function sample(x,z){
      ray.set(new THREE.Vector3(x,1800,z),new THREE.Vector3(0,-1,0));
      const raw=[];
      // Some asynchronously-loaded/removed assets retain a mesh shell while
      // their renderable internals are being replaced. Raycast each candidate
      // independently so that unrelated asset cannot suppress terrain proof.
      A.root.traverse(o=>{if(!o.isMesh||!shown(o)||!o.geometry||!o.material)return;try{o.updateMatrixWorld(true);ray.intersectObject(o,false,raw);}catch(_){}});
      raw.sort((a,b)=>a.distance-b.distance);
      const hits=raw.slice(0,8).map(h=>({
        name:h.object.name||"(unnamed)",y:+h.point.y.toFixed(3),owner:h.object.userData&&h.object.userData.surfaceOwner,
        terrain:!!(h.object.userData&&h.object.userData.terrain),underlay:!!(h.object.userData&&h.object.userData.underlay),mat:materialName(h.object.material)
      }));
      return {x,z,shore:wf&&+wf.shoreAt(x,z).toFixed(2),water:!!(wf&&wf.isSurfaceWater(x,z,0)),claims:surfaceClaims(x,z),hits};
    }
    const cx=490,cz=-350,r=210,points=[
      sample(cx,cz),sample(cx+r-2,cz),sample(cx+r+2,cz),sample(cx+r+10,cz),sample(cx+r+28,cz),
      sample(cx-r+2,cz),sample(cx-r-2,cz),sample(cx-r-18,cz),
      sample(cx,cz+r-2),sample(cx,cz+r+6),sample(cx,cz-r+2),sample(cx,cz-r-6),sample(cx,cz-r-30)
    ];
    const mountains=[];
    A.root.traverse(o=>{if(!o.isMesh||!shown(o))return;const u=o.userData||{};if(!u.distantLandmark&&!/mercy|mountain|relief/i.test(o.name||""))return;
      const b=new THREE.Box3().setFromObject(o);if(!isFinite(b.max.y)||b.max.y<35)return;
      mountains.push({name:o.name||"(unnamed)",min:[+b.min.x.toFixed(1),+b.min.y.toFixed(1),+b.min.z.toFixed(1)],max:[+b.max.x.toFixed(1),+b.max.y.toFixed(1),+b.max.z.toFixed(1)],mat:materialName(o.material)});
    });
    const under=A.root.getObjectByName("continent-underlay"),buildClaims={};
    for(const p of points){const key=p.x+","+p.z;buildClaims[key]=((under&&under.userData.authoredSurfaceBounds)||[]).filter(b=>
      p.x>=b.minX&&p.x<=b.maxX&&p.z>=b.minZ&&p.z<=b.maxZ);}
    return {speedway:points,buildClaims,carveSeamInset:under&&under.userData.carveSeamInset,mountains:mountains.slice(0,24)};
  })())`));
  await writeFile(path.join(OUT, "terrain-audit.json"), JSON.stringify(terrainAudit, null, 2));
  console.log(`terrain-audit: ${JSON.stringify(terrainAudit)}`);
  if (!only.size || only.has("speedway") || only.has("speedway-top")) {
    const surfaceData = await evaluate(`(function(){
      const m=CBZ.city.arena.root.getObjectByName("speedway-island-surface");
      const c=m&&m.material&&m.material.map&&m.material.map.image;
      return c&&c.toDataURL?c.toDataURL("image/png"):null;
    })()`);
    if (surfaceData) {
      await writeFile(path.join(OUT, "speedway-surface.png"), Buffer.from(surfaceData.split(",")[1], "base64"));
    }
  }

  // Player-height airport proof: keep the real HUD/viewmodel on and frame a
  // gate airliner from the same close range as the reported screenshot. This
  // catches reticle scale/parallax regressions that the aerial zone shot cannot.
  if (!only.size || only.has("aircraft-crosshair")) {
    const closeAircraft = await evaluate(`(function(){
    const rec=(CBZ.cityMilitaryVehicles||[]).find(v=>v&&v.civilian&&v.kind==="plane"&&!v.destroyed&&!v.taken&&v.group&&v.group.parent);
    const w=(CBZ.FPS_WEAPONS||[]).find(x=>x&&!x.melee&&!x.explosive)||CBZ.FPS_WEAPONS[0];
    if(!rec||!w)return null;
    const idx=CBZ.FPS_WEAPONS.indexOf(w),g=rec.group;g.updateMatrixWorld(true);
    const eye=new THREE.Vector3(7.8,2.15,-6.5).applyMatrix4(g.matrixWorld);
    const look=new THREE.Vector3(7.8,3.25,0).applyMatrix4(g.matrixWorld);
    CBZ.player.dead=false;CBZ.player.driving=false;CBZ.player.pos.set(eye.x,CBZ.floorAt(eye.x,eye.z)||0,eye.z);
    if((CBZ.weaponInventory||[]).indexOf(w.id)<0)CBZ.weaponInventory.push(w.id);
    CBZ.currentWeaponId=w.id;CBZ.game.cityHolstered=false;CBZ.fps.weapon=idx;CBZ.fps.rounds[idx]=Math.max(1,CBZ.fps.rounds[idx]||0);
    CBZ.renderer.__visualCloseOriginal=CBZ.renderer.render;
    const original=CBZ.renderer.render.bind(CBZ.renderer);
    CBZ.renderer.render=function(scene,camera){camera.position.copy(eye);camera.lookAt(look);camera.updateMatrixWorld(true);return original(scene,camera);};
    if(CBZ.setFPS)CBZ.setFPS(true);if(CBZ.requestShadowUpdate)CBZ.requestShadowUpdate(true);
    return {name:rec.model&&rec.model.name,eye:eye.toArray(),look:look.toArray()};
  })()`);
    console.log(`aircraft-crosshair: ${JSON.stringify(closeAircraft)}`);
    await sleep(1300);
    await screenshot("aircraft-crosshair");
    await evaluate(`(function(){
      if(CBZ.renderer.__visualCloseOriginal){CBZ.renderer.render=CBZ.renderer.__visualCloseOriginal;delete CBZ.renderer.__visualCloseOriginal;}
      if(CBZ.setFPS)CBZ.setFPS(false);
    })()`);
  }

  // Exact HUD regression probe: third person must render the same engine
  // reticle element and style as first person. Keep the real player/camera and
  // HUD alive; only move the player to open country so geometry cannot mask it.
  if (!only.size || only.has("third-person-crosshair")) {
    const thirdPersonCrosshair = await evaluate(`(function(){
      if(CBZ.setFPS)CBZ.setFPS(false);
      if(CBZ.game)CBZ.game.cityHolstered=false;
      if(CBZ.player&&CBZ.player.pos)CBZ.player.pos.set(20,CBZ.floorAt?CBZ.floorAt(20,20)||0:0,20);
      if(CBZ.cityHotbarSelect)CBZ.cityHotbarSelect(2);
      if(CBZ.fpsSetAim)CBZ.fpsSetAim(true);
      return true;
    })()`);
    await sleep(900);
    const thirdPersonReticleState = await evaluate(`(function(){
      const e=document.getElementById("crosshair"),s=e&&getComputedStyle(e);
      return {armed:!!(CBZ.playerArmed&&CBZ.playerArmed()),third:!!(CBZ.weaponThirdPersonActive&&CBZ.weaponThirdPersonActive()),
        fps:!!(CBZ.fpsActive&&CBZ.fpsActive()),display:s&&s.display,visibility:s&&s.visibility,opacity:s&&s.opacity,
        rect:e&&[e.getBoundingClientRect().x,e.getBoundingClientRect().y,e.getBoundingClientRect().width,e.getBoundingClientRect().height]};
    })()`);
    console.log(`third-person-crosshair: ${JSON.stringify(thirdPersonReticleState)}`);
    await screenshot("third-person-crosshair");
    await evaluate(`if(CBZ.fpsSetAim)CBZ.fpsSetAim(false)`);
  }

  await evaluate(`(function(){
    const st=document.createElement("style");st.id="visualQaHide";
    st.textContent="body > :not(#game){display:none!important}#game{position:fixed!important;inset:0!important}";
    document.head.appendChild(st);
    if(CBZ.dayPhase)CBZ.dayPhase(0.42);
    if(CBZ.setFPS)CBZ.setFPS(false);
    CBZ.camera.near=0.25;CBZ.camera.far=9000;CBZ.camera.updateProjectionMatrix();
    window.__visualQaFogFar=1800;window.__visualQaBaseFov=CBZ.camera.fov;
    const original=CBZ.renderer.render.bind(CBZ.renderer);
    CBZ.renderer.render=function(scene,camera){const p=window.__visualQaPose;if(p&&camera){camera.position.set(p[0],p[1],p[2]);camera.fov=p[6]||window.__visualQaBaseFov;camera.updateProjectionMatrix();camera.lookAt(p[3],p[4],p[5]);camera.updateMatrixWorld(true);if(scene&&scene.fog&&window.__visualQaFogFar){scene.fog.near=Math.max(90,window.__visualQaFogFar*.10);scene.fog.far=window.__visualQaFogFar;}const rig=CBZ.skyDome&&CBZ.skyDome.parent;if(rig){rig.position.copy(camera.position);rig.updateMatrixWorld(true);}}return original(scene,camera);};
  })()`);

  async function pose(name, expression) {
    if (only.size && !only.has(name)) return;
    const info = await evaluate(`(function(){${expression}})()`);
    console.log(`${name}: ${JSON.stringify(info)}`);
    await sleep(1100);
    await screenshot(name);
  }

  await pose("airport", `
    const r=CBZ.city.arena.regions.find(x=>x.name==="Halloran Field"),cx=(r.minX+r.maxX)/2,cz=(r.minZ+r.maxZ)/2;
    window.__visualQaPose=[-230,52,122,-220,2,-86];CBZ.player.pos.set(-40,0,7);if(CBZ.requestShadowUpdate)CBZ.requestShadowUpdate(true);
    return {region:r.name,aircraft:(CBZ.cityMilitaryVehicles||[]).filter(v=>v.civilian).length};`);

  await pose("airport-top", `
    const r=CBZ.city.arena.regions.find(x=>x.name==="Halloran Field"),cx=(r.minX+r.maxX)/2,cz=(r.minZ+r.maxZ)/2;
    window.__visualQaFogFar=3600;window.__visualQaPose=[cx+.5,640,cz+.5,cx,0,cz,46];
    return {region:r.name,bounds:[r.minX,r.maxX,r.minZ,r.maxZ]};`);

  await pose("farm", `
    const r=CBZ.city.arena.regions.find(x=>x.name==="Coyle Valley"),truck=CBZ.scene.getObjectByName("official-threejs-farm-truck");
    const t=truck?truck.getWorldPosition(new THREE.Vector3()):new THREE.Vector3((r.minX+r.maxX)/2,0,(r.minZ+r.maxZ)/2);
    window.__visualQaPose=[t.x+105,34,t.z+115,t.x,3,t.z];CBZ.player.pos.set(t.x,CBZ.floorAt(t.x,t.z)||0,t.z);if(CBZ.requestShadowUpdate)CBZ.requestShadowUpdate(true);
    return {region:r.name,truck:!!truck,at:t.toArray()};`);

  await pose("farm-top", `
    const r=CBZ.city.arena.regions.find(x=>x.name==="Coyle Valley"),cx=(r.minX+r.maxX)/2,cz=(r.minZ+r.maxZ)/2;
    window.__visualQaFogFar=3600;window.__visualQaPose=[cx+.5,660,cz+.5,cx,0,cz,46];
    return {region:r.name,bounds:[r.minX,r.maxX,r.minZ,r.maxZ]};`);

  await pose("forest-lake", `
    const x=-710,z=-1260,wf=CBZ.waterField;
    window.__visualQaPose=[x+128,42,z+145,x,-.45,z];CBZ.player.pos.set(x+104,CBZ.floorAt(x+104,z)||0,z);if(CBZ.requestShadowUpdate)CBZ.requestShadowUpdate(true);
    return {sharedWater:!!(wf&&wf.isSurfaceWater(x,z,0)),bankLand:!!(wf&&!wf.isSurfaceWater(x+112,z,0)),shore:wf&&wf.shoreAt(x,z),localSlab:CBZ.scene.children.some(o=>o&&o.name==="redhollow-lake-water")};`);

  await pose("forest-top", `
    const r=CBZ.city.arena.regions.find(x=>x.name==="Redhollow Woods"),cx=(r.minX+r.maxX)/2,cz=(r.minZ+r.maxZ)/2;
    window.__visualQaFogFar=3600;window.__visualQaPose=[cx+.5,650,cz+.5,cx,0,cz,46];
    return {region:r.name,bounds:[r.minX,r.maxX,r.minZ,r.maxZ]};`);

  await pose("forest-horizon", `
    const r=CBZ.city.arena.regions.find(x=>x.name==="Redhollow Woods"),cx=(r.minX+r.maxX)/2,cz=(r.minZ+r.maxZ)/2;
    window.__visualQaFogFar=4200;window.__visualQaPose=[cx+40,150,cz+430,cx+360,88,cz-980,57];
    CBZ.player.pos.set(cx+40,145,cz+430);if(CBZ.requestShadowUpdate)CBZ.requestShadowUpdate(true);
    return {region:r.name,view:"flight-height toward Mercy range",oneOcean:CBZ.scene.getObjectByName("world-sea")?1:0};`);

  await pose("ocean-coast", `
    const b=CBZ.city.arena.mapTerrain.bounds,x=b.minX+26,z=(b.minZ+b.maxZ)*.5;
    window.__visualQaPose=[x+150,46,z+155,x-90,-.45,z-45];CBZ.player.pos.set(x+28,CBZ.floorAt(x+28,z)||0,z);if(CBZ.requestShadowUpdate)CBZ.requestShadowUpdate(true);
    return {ocean:CBZ.citySea&&CBZ.citySea.name,bounds:[b.minX,b.maxX,b.minZ,b.maxZ],shore:CBZ.waterField&&CBZ.waterField.shoreAt(x,z)};`);

  await pose("speedway", `
    const r=CBZ.city.arena.regions.find(x=>x.name==="Diamond Speedway");
    window.__visualQaFogFar=1800;window.__visualQaPose=[r.cx+245,78,r.cz+225,r.cx,3,r.cz,55];CBZ.player.pos.set(r.cx,0,r.cz);if(CBZ.requestShadowUpdate)CBZ.requestShadowUpdate(true);
    return {region:r.name,center:[r.cx,r.cz],radius:r.r};`);

  await pose("speedway-top", `
    const r=CBZ.city.arena.regions.find(x=>x.name==="Diamond Speedway");
    window.__visualQaFogFar=4200;window.__visualQaPose=[r.cx,520,r.cz,r.cx,0,r.cz,48];CBZ.player.pos.set(r.cx,0,r.cz);if(CBZ.requestShadowUpdate)CBZ.requestShadowUpdate(true);
    return {region:r.name,center:[r.cx,r.cz],radius:r.r,shore:CBZ.waterField&&CBZ.waterField.shoreAt(r.cx+r.r+8,r.cz)};`);

  await pose("military", `
    const r=CBZ.city.arena.regions.find(x=>x.name==="Fort Brandt"),cx=(r.minX+r.maxX)/2,cz=(r.minZ+r.maxZ)/2;
    window.__visualQaPose=[cx+250,92,cz+225,cx,4,cz];CBZ.player.pos.set(cx,0,cz);if(CBZ.requestShadowUpdate)CBZ.requestShadowUpdate(true);
    return {region:r.name,personnel:(CBZ.cityMilitaryPersonnel||[]).length,boardable:(CBZ.cityMilitaryVehicles||[]).filter(v=>!v.civilian).length};`);

  await pose("military-top", `
    const r=CBZ.city.arena.regions.find(x=>x.name==="Fort Brandt"),cx=(r.minX+r.maxX)/2,cz=(r.minZ+r.maxZ)/2;
    window.__visualQaFogFar=3600;window.__visualQaPose=[cx+.5,620,cz+.5,cx,0,cz,46];
    return {region:r.name,bounds:[r.minX,r.maxX,r.minZ,r.maxZ]};`);

  await pose("propulsion", `
    const root=CBZ.city.arena.root;
    // Halloran's central apron is a known open, level inspection patch. Using
    // a fixed pad here prevents a generated hangar/wall from swallowing the QA
    // camera when the Fort layout changes with the seed.
    const x=-220,z=-86,y=1.25;
    if(window.__visualQaJet&&window.__visualQaJet.parent)window.__visualQaJet.parent.remove(window.__visualQaJet);
    const jet=CBZ.debugBuildAircraft.jet();jet.name="visual-qa-player-jet";jet.position.set(x,y,z);root.add(jet);window.__visualQaJet=jet;
    const jp=jet.userData.plume||[];jp.forEach((p,i)=>CBZ.setRocketPlume(p,1,3.2+i*.13,1.8,1));
    const car=(CBZ.cityCars||[]).find(c=>c&&!c.dead&&c.group);
    let cp=[];
    if(car){car.ai=false;car.player=true;car.v=0;car.pos.set(x+7,.04,z+1);car.heading=0;car.group.rotation.y=0;
      car.mods=car.mods||{};car.mods.booster=true;CBZ.cityApplyCarModsRebuild(car);cp=(car._modFx&&car._modFx.booster&&car._modFx.booster.userData.flames)||[];
      cp.forEach((p,i)=>CBZ.setRocketPlume(p,1,4.1+i*.17,1.2,.8));car.mods.booster=false;
    }
    window.__visualQaPose=[x+12,y+7,z-23,x+2,y+.35,z-3.7];CBZ.player.pos.set(x,y,z);if(CBZ.requestShadowUpdate)CBZ.requestShadowUpdate(true);
    return {at:[x,y,z],sameComponent:jp.concat(cp).every(p=>p.userData&&p.userData.rocketPlume),jetPlumes:jp.length,carPlumes:cp.length,shockDiamonds:jp.reduce((n,p)=>n+((p.userData.diamonds||[]).length),0)};`);

  await pose("skyline", `
    const lots=(CBZ.city.arena.lots||[]).filter(l=>l&&l.building&&(l.building.storeys||0)>=7);let best=lots[0],bn=-1;
    lots.forEach(a=>{let n=0;lots.forEach(b=>{const dx=a.cx-b.cx,dz=a.cz-b.cz;if(dx*dx+dz*dz<240*240)n++;});if(n>bn){bn=n;best=a;}});
    const x=best?best.cx:0,z=best?best.cz:0,h=best&&best.building.h||50;
    window.__visualQaPose=[x+165,Math.max(50,h*.72),z+180,x,Math.min(22,h*.35),z];CBZ.player.pos.set(x,0,z);if(CBZ.requestShadowUpdate)CBZ.requestShadowUpdate(true);
    return {cluster:bn,at:[x,z],district:best&&best.district,storeys:best&&best.building.storeys};`);

  await pose("ifc-campus", `
    const o=CBZ.scene.getObjectByName("official-ifc-civic-campus"),b=o?new THREE.Box3().setFromObject(o):null,c=b?b.getCenter(new THREE.Vector3()):new THREE.Vector3(-100,0,470),s=b?b.getSize(new THREE.Vector3()):new THREE.Vector3(238,18,114);
    window.__visualQaPose=[c.x+s.x*.64,c.y+Math.max(34,s.y*1.6),c.z+s.z*.82,c.x,c.y+s.y*.25,c.z];CBZ.player.pos.set(c.x,0,c.z);if(CBZ.requestShadowUpdate)CBZ.requestShadowUpdate(true);
    return {loaded:!!(o&&o.children.length>1),center:c.toArray(),size:s.toArray()};`);

  await pose("desert-ground", `
    let best={x:1040,z:420,h:0,relief:-1};
    if(CBZ.desertTerrainHeightAt)for(let z=-240;z<=560;z+=32)for(let x=720;x<=1520;x+=32){
      if(CBZ.desertMesaHeightAt&&CBZ.desertMesaHeightAt(x,z)>0.8)continue;
      const hs=[CBZ.desertTerrainHeightAt(x,z),CBZ.desertTerrainHeightAt(x+18,z),CBZ.desertTerrainHeightAt(x-18,z),CBZ.desertTerrainHeightAt(x,z+18),CBZ.desertTerrainHeightAt(x,z-18)];
      const mx=Math.max.apply(Math,hs),mn=Math.min.apply(Math,hs),relief=mx-mn;
      if(mx<38&&hs[0]>5&&relief>best.relief)best={x:x,z:z,h:hs[0],relief:relief};
    }
    window.__visualQaPose=[best.x+74,best.h+11,best.z+68,best.x,best.h+3,best.z];CBZ.player.pos.set(best.x,best.h,best.z);if(CBZ.requestShadowUpdate)CBZ.requestShadowUpdate(true);
    return {sample:best,dune:CBZ.desertDuneHeightAt&&CBZ.desertDuneHeightAt(best.x,best.z),mesa:CBZ.desertMesaHeightAt&&CBZ.desertMesaHeightAt(best.x,best.z),mesh:!!CBZ.scene.getObjectByName("saltlands-desert-surface")};`);

  await pose("desert-top", `
    const r=CBZ.city.arena.regions.find(x=>x.name==="The Saltlands"),cx=(r.minX+r.maxX)/2,cz=(r.minZ+r.maxZ)/2;
    window.__visualQaFogFar=3800;window.__visualQaPose=[cx+.5,720,cz+.5,cx,0,cz,46];
    return {region:r.name,bounds:[r.minX,r.maxX,r.minZ,r.maxZ]};`);

  await pose("mountain", `
    window.__visualQaFogFar=2600;window.__visualQaPose=[350,55,-1050,350,72,-1590,55];CBZ.player.pos.set(470,CBZ.floorAt(470,-1300)||0,-1300);if(CBZ.requestShadowUpdate)CBZ.requestShadowUpdate(true);
    return {summit:CBZ.snowTerrainHeightAt&&CBZ.snowTerrainHeightAt(470,-1585),ranges:(CBZ.city.arena.regions||[]).filter(r=>r.biome==="snow").map(r=>r.name)};`);

  await pose("mountain-top", `
    const r=CBZ.city.arena.regions.find(x=>x.name==="Mount Mercy"),cx=(r.minX+r.maxX)/2,cz=(r.minZ+r.maxZ)/2;
    window.__visualQaFogFar=4200;window.__visualQaPose=[cx+.5,900,cz+.5,cx,35,cz,47];
    return {region:r.name,bounds:[r.minX,r.maxX,r.minZ,r.maxZ]};`);

  await pose("mountain-east", `
    window.__visualQaFogFar=3400;window.__visualQaPose=[1120,330,-1250,280,105,-2050,52];CBZ.player.pos.set(470,CBZ.floorAt(470,-1300)||0,-1300);if(CBZ.requestShadowUpdate)CBZ.requestShadowUpdate(true);
    return {families:CBZ.greaterSnowMountainCount,lobes:CBZ.greaterSnowLobeCount};`);

  await pose("mountain-west", `
    window.__visualQaFogFar=3400;window.__visualQaPose=[-500,310,-1260,360,105,-2070,52];CBZ.player.pos.set(470,CBZ.floorAt(470,-1300)||0,-1300);if(CBZ.requestShadowUpdate)CBZ.requestShadowUpdate(true);
    return {families:CBZ.greaterSnowMountainCount,lobes:CBZ.greaterSnowLobeCount};`);

  // Survey renders intentionally extend fog without changing production. They
  // expose land ownership, biome seams and material drift from several compass
  // directions instead of accepting a single flattering gameplay angle.
  await pose("world-top", `
    const b=CBZ.city.arena.mapTerrain.bounds,cx=(b.minX+b.maxX)/2,cz=(b.minZ+b.maxZ)/2;
    window.__visualQaFogFar=9000;window.__visualQaPose=[cx,5550,cz,cx,0,cz,58];CBZ.player.pos.set(cx,0,cz);return {bounds:b,angle:"top"};`);

  await pose("world-north", `
    const b=CBZ.city.arena.mapTerrain.bounds,cx=(b.minX+b.maxX)/2,cz=(b.minZ+b.maxZ)/2;
    window.__visualQaFogFar=9000;window.__visualQaPose=[cx,2650,b.maxZ+1700,cx,0,cz-650,58];CBZ.player.pos.set(cx,0,cz);return {bounds:b,angle:"north"};`);

  await pose("world-east", `
    const b=CBZ.city.arena.mapTerrain.bounds,cx=(b.minX+b.maxX)/2,cz=(b.minZ+b.maxZ)/2;
    window.__visualQaFogFar=9000;window.__visualQaPose=[b.maxX+1900,2450,cz,cx,0,cz,58];CBZ.player.pos.set(cx,0,cz);return {bounds:b,angle:"east"};`);

  await pose("world-west", `
    const b=CBZ.city.arena.mapTerrain.bounds,cx=(b.minX+b.maxX)/2,cz=(b.minZ+b.maxZ)/2;
    window.__visualQaFogFar=9000;window.__visualQaPose=[b.minX-1900,2450,cz,cx,0,cz,58];CBZ.player.pos.set(cx,0,cz);return {bounds:b,angle:"west"};`);

  const uniqueErrors = [...new Set(browserErrors)].filter((x) => x && !/ProgressEvent/.test(x));
  console.log(uniqueErrors.length ? `browser errors: ${uniqueErrors.slice(0, 8).join(" | ")}` : "browser errors: none");
  if (uniqueErrors.length) process.exitCode = 2;
} finally {
  try { if (ws && ws.readyState === WebSocket.OPEN) await send("Browser.close"); } catch (_) {}
  if (!chrome.killed) chrome.kill("SIGTERM");
  if (!server.killed) server.kill("SIGTERM");
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}
