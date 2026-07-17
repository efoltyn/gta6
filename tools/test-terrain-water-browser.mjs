#!/usr/bin/env node
// Focused real-Chrome contract for continuous terrain, water navigation and
// the Mount Mercy snowboard controller. Runs the actual game update loop with
// SwiftShader drawing disabled after boot so long movement probes stay cheap.

import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const serverPort = 9440 + Math.floor(Math.random() * 120);
const debugPort = 10600 + Math.floor(Math.random() * 120);
const profile = `/tmp/cbz-terrain-water-${debugPort}`;
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
  `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, base,
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
  for (let i = 0; i < 180; i++) {
    if (await evaluate("document.readyState==='complete' && !!(window.CBZ && CBZ.resetGame && CBZ.setMode && CBZ.waterField && CBZ._landmassBuilders && CBZ._landmassBuilders.length>15)")) break;
    await sleep(250);
  }
  await evaluate(`(function(){
    if(CBZ.CONFIG){CBZ.CONFIG.CITY_HITMAN_CAMPAIGN=false;CBZ.CONFIG.CITY_SCENE_DIRECTOR=false;}
    if(CBZ.renderer&&CBZ.renderer.render&&!CBZ.renderer.__terrainWaterNoDraw){CBZ.renderer.render=function(){};CBZ.renderer.__terrainWaterNoDraw=true;}
    CBZ.setMode("city");CBZ.resetGame();CBZ.setState("playing");
  })()`);
  await sleep(8500);

  const initial = JSON.parse(await evaluate(`JSON.stringify((function(){
    const wf=CBZ.waterField,A=CBZ.city&&CBZ.city.arena,animals=CBZ.cityWildlife||[];
    const aquatic=animals.filter(function(a){return a&&!a.dead&&a.species&&a.species.aquatic&&a.group;});
    const bad=aquatic.filter(function(a){return !wf.isNavigableWater(a.pos.x,a.pos.z,(a.waterClearance||12)*0.4);});
    let worst=Infinity,minDepth=Infinity,maxDepth=0;
    aquatic.forEach(function(a){const s=wf.shoreAt(a.pos.x,a.pos.z);worst=Math.min(worst,s);const d=wf.depthAt(a.pos.x,a.pos.z);minDepth=Math.min(minDepth,d);maxDepth=Math.max(maxDepth,d);});
    function stats(fn,x0,x1,z0,z1,n){let min=Infinity,max=-Infinity,sum=0,sum2=0,c=0;for(let iz=0;iz<=n;iz++)for(let ix=0;ix<=n;ix++){const x=x0+(x1-x0)*ix/n,z=z0+(z1-z0)*iz/n,h=fn(x,z);min=Math.min(min,h);max=Math.max(max,h);sum+=h;sum2+=h*h;c++;}const mean=sum/c;return {min:min,max:max,mean:mean,std:Math.sqrt(Math.max(0,sum2/c-mean*mean))};}
    const snow=stats(CBZ.snowTerrainHeightAt,-60,760,-1770,-1130,34);
    const desert=stats(CBZ.desertTerrainHeightAt,690,1550,-310,610,34);
    // Integrate copies of real actors through thousands of mask-constrained
    // moves. Any dry result is a shoreline tunnelling regression.
    let routeFailures=0,routeSteps=0;
    for(let i=0;i<Math.min(28,aquatic.length);i++){
      const a=aquatic[i],p={x:a.pos.x,z:a.pos.z,h:a.heading},o={};
      for(let k=0;k<180;k++){const m=wf.moveInWater(p.x,p.z,p.h,2.7,a.waterClearance||12,k*0.08,o);p.x=m.x;p.z=m.z;p.h=m.heading;routeSteps++;if(!wf.isNavigableWater(p.x,p.z,(a.waterClearance||12)*0.45)){routeFailures++;break;}}
    }
    const probe=aquatic[0]||null;
    if(probe){window.__waterAnimalProbe={actor:probe,x:probe.pos.x,z:probe.pos.z};CBZ.player.pos.set(probe.pos.x+4,wf.surfaceY(probe.pos.x+4,probe.pos.z),probe.pos.z+4);probe.group.visible=true;}
    let seaFieldProbe=null;
    if(CBZ.citySea&&CBZ.citySea.material&&CBZ.citySea.material.uniforms){
      const U=CBZ.citySea.material.uniforms,T=U.uSeaLandMask&&U.uSeaLandMask.value,B=U.uSeaLandBounds&&U.uSeaLandBounds.value;
      let x=A.maxX+42,z=(A.minZ+A.maxZ)*0.5;
      for(let dz=-180;dz<=180;dz+=20)if(wf.isSurfaceWater(x,z+dz,0)){z+=dz;break;}
      if(T&&T.image&&T.image.data&&B){const W=T.image.width,H=T.image.height,u=(x-B.x)/(B.z-B.x),v=(z-B.y)/(B.w-B.y),ix=Math.max(0,Math.min(W-1,Math.floor(u*W))),iy=Math.max(0,Math.min(H-1,Math.floor(v*H)));const read=function(row){const q=(row*W+ix)*4,d=T.image.data;return [d[q],d[q+1],d[q+2],d[q+3]];};seaFieldProbe={x:x,z:z,shore:wf.shoreAt(x,z),uv:[u,v],direct:read(iy),flipped:read(H-1-iy),material:CBZ.citySea.material.type,mode:CBZ.citySea.material.userData&&CBZ.citySea.material.userData.waterMode};}
    }
    // Rendered-surface audit: broad, almost-flat meshes are exactly the class
    // that z-fights from aircraft altitude.  Audit world bounds rather than
    // names so an unnamed runway/apron or legacy water slab cannot escape.
    const surfaceMeshes=[],surfaceObjects=[],waterMeshes=[],box=new THREE.Box3();
    function rendered(o){for(let p=o;p;p=p.parent)if(!p.visible)return false;return true;}
    CBZ.scene.updateMatrixWorld(true);
    CBZ.scene.traverse(function(o){
      // A visible child under a hidden mode root is not rendered. Raycaster
      // does not enforce ancestor visibility, so including prisonRoot children
      // here produced a fake airport overlap at the old prison-yard plane.
      if(!o||!o.isMesh||!rendered(o)||!o.geometry||!o.material)return;
      try{box.setFromObject(o);}catch(e){return;}
      const w=box.max.x-box.min.x,d=box.max.z-box.min.z,h=box.max.y-box.min.y,area=w*d;
      const mats=Array.isArray(o.material)?o.material:[o.material];
      const water=!!(o===CBZ.citySea||o.userData&&o.userData.waterSurface||mats.some(function(m){return m&&((m.userData&&m.userData.waterMode)||/water|ocean|sea/i.test((m.name||'')+' '+(m.type||'')));}));
      if(water)waterMeshes.push({name:o.name||'(unnamed)',w:+w.toFixed(1),d:+d.toFixed(1),y:[+box.min.y.toFixed(3),+box.max.y.toFixed(3)],material:mats.map(function(m){return m&&((m.name||'')||m.type);}).join('|')});
      if((area>2800&&h<0.75)||(o.userData&&o.userData.worldSurface)){
        surfaceObjects.push(o);surfaceMeshes.push({
        id:o.id,name:o.name||'(unnamed)',geometry:o.geometry.type||'',w:+w.toFixed(1),d:+d.toFixed(1),h:+h.toFixed(3),
        x0:box.min.x,x1:box.max.x,z0:box.min.z,z1:box.max.z,y0:box.min.y,y1:box.max.y,
        worldSurface:!!(o.userData&&o.userData.worldSurface),underlay:!!(o.userData&&o.userData.underlay),
        owner:o.userData&&o.userData.surfaceOwner||'',unified:!!(o.userData&&o.userData.unifiedSurface),water:water,
        material:mats.map(function(m){return m&&((m.name||'')||m.type);}).join('|')
        });
      }
    });
    const overlaps=[];
    for(let i=0;i<surfaceMeshes.length;i++)for(let j=i+1;j<surfaceMeshes.length;j++){
      const a=surfaceMeshes[i],b=surfaceMeshes[j];
      // Only compare complete authored land skins. Sparse merged paint meshes,
      // interiors and underlays have intentionally broad AABBs and made the old
      // audit mostly false positives. RingGeometry owns no centre triangles.
      if(!a.worldSurface||!b.worldSurface||a.water||b.water||a.underlay||b.underlay||a.geometry==='RingGeometry'||b.geometry==='RingGeometry')continue;
      const iw=Math.min(a.x1,b.x1)-Math.max(a.x0,b.x0),id=Math.min(a.z1,b.z1)-Math.max(a.z0,b.z0);
      if(iw<=0||id<=0)continue;
      const ia=iw*id,small=Math.min(a.w*a.d,b.w*b.d),dy=Math.max(0,Math.max(a.y0,b.y0)-Math.min(a.y1,b.y1));
      if(ia>1200&&ia/Math.max(1,small)>0.08&&dy<0.18)overlaps.push({a:a.name,b:b.name,area:Math.round(ia),coverage:+(ia/Math.max(1,small)).toFixed(3),gap:+dy.toFixed(4)});
    }
    const lakeX=-710,lakeZ=-1260;
    const localLakeSlabs=surfaceMeshes.filter(function(s){return s.name!=='world-sea'&&Math.hypot((s.x0+s.x1)/2-lakeX,(s.z0+s.z1)/2-lakeZ)<8&&s.w>150&&s.d>150&&s.h<0.5;});
    const snowIceSlabs=surfaceMeshes.filter(function(s){return s.name!=='mount-mercy-earth-terrain'&&Math.hypot((s.x0+s.x1)/2-180,(s.z0+s.z1)/2+1380)<8&&s.w>50&&s.d>50&&s.h<0.5;});
    const ownerSurfaces=surfaceMeshes.filter(function(s){return s.owner;}).map(function(s){return {name:s.name,owner:s.owner,unified:s.unified,geometry:s.geometry,x:+((s.x0+s.x1)/2).toFixed(1),z:+((s.z0+s.z1)/2).toFixed(1),w:s.w,d:s.d};});
    // Sample the real triangles from above instead of trusting bounding boxes.
    // Two distinct broad surfaces less than 12mm apart at the same map point
    // are a genuine z-fight risk; sparse paint meshes only count where their
    // triangles actually exist.
    const ray=new THREE.Raycaster(),origin=new THREE.Vector3(),down=new THREE.Vector3(0,-1,0),nearCoplanar=[];
    const zones=[
      {n:'airport',x0:-885,x1:275,z0:-265,z1:25,nx:14,nz:7},
      {n:'military',x0:-845,x1:-395,z0:-935,z1:-465,nx:9,nz:9},
      {n:'farmland',x0:790,x1:1570,z0:-1270,z1:-490,nx:10,nz:10},
      {n:'speedway',x0:310,x1:670,z0:-530,z1:-170,nx:10,nz:10,cx:490,cz:-350,r:174},
      {n:'forest',x0:-930,x1:-190,z0:-1660,z1:-1040,nx:9,nz:8},
      {n:'snow',x0:-40,x1:740,z0:-1750,z1:-1160,nx:9,nz:8},
      {n:'desert',x0:710,x1:1530,z0:-290,z1:590,nx:9,nz:9},
    ];
    outer:for(let zi=0;zi<zones.length;zi++){
      const q=zones[zi];
      for(let iz=0;iz<q.nz;iz++)for(let ix=0;ix<q.nx;ix++){
        const x=q.x0+(q.x1-q.x0)*(ix+.5)/q.nx,z=q.z0+(q.z1-q.z0)*(iz+.5)/q.nz;
        if(q.r&&Math.hypot(x-q.cx,z-q.cz)>q.r)continue;
        origin.set(x,600,z);ray.set(origin,down);ray.near=0;ray.far=620;
        const hits=ray.intersectObjects(surfaceObjects,false),seen={},at=[];
        for(let h=0;h<hits.length;h++){
          const hit=hits[h],o=hit.object;if(seen[o.id]||o===CBZ.citySea||o.userData&&o.userData.underlay)continue;
          seen[o.id]=1;if(hit.point.y<-.12||hit.point.y>.22)continue;
          at.push({id:o.id,n:o.name||'(unnamed)',y:hit.point.y});
        }
        at.sort(function(a,b){return a.y-b.y;});
        for(let a=0;a<at.length;a++)for(let b=a+1;b<at.length;b++){
          const dy=Math.abs(at[a].y-at[b].y);if(dy>=.012)continue;
          nearCoplanar.push({zone:q.n,x:+x.toFixed(1),z:+z.toFixed(1),a:at[a].n,b:at[b].n,gap:+dy.toFixed(4)});
          if(nearCoplanar.length>=36)break outer;
        }
      }
    }
    const airportReg=(A.regions||[]).find(function(r){return r.name==='Halloran Field';});
    const speedwayReg=(A.regions||[]).find(function(r){return r.name==='Diamond Speedway';});
    let airportSpeedwayClear=null;
    if(airportReg&&speedwayReg){const qx=Math.max(airportReg.minX,Math.min(speedwayReg.cx,airportReg.maxX)),qz=Math.max(airportReg.minZ,Math.min(speedwayReg.cz,airportReg.maxZ));airportSpeedwayClear=Math.hypot(speedwayReg.cx-qx,speedwayReg.cz-qz)-speedwayReg.r;}
    const surfaceAudit={waterMeshes:waterMeshes,ownerSurfaces:ownerSurfaces,localLakeSlabs:localLakeSlabs.map(function(s){return s.name;}),snowIceSlabs:snowIceSlabs.map(function(s){return s.name;}),airportSpeedwayClear:airportSpeedwayClear,nearCoplanar:nearCoplanar,surfaces:surfaceMeshes.map(function(s){return {name:s.name,geometry:s.geometry,x:+((s.x0+s.x1)/2).toFixed(1),z:+((s.z0+s.z1)/2).toFixed(1),w:s.w,d:s.d,h:s.h,y:[+s.y0.toFixed(3),+s.y1.toFixed(3)],worldSurface:s.worldSurface,owner:s.owner,unified:s.unified,material:s.material};}),overlaps:overlaps};
    const inlandLake={centerWater:wf.isSurfaceWater(lakeX,lakeZ,0),bankLand:!wf.isSurfaceWater(lakeX+112,lakeZ,0),registered:!!(A.mapTerrain&&A.mapTerrain.inlandWaterAt&&A.mapTerrain.inlandWaterAt(lakeX,lakeZ)),shore:wf.shoreAt(lakeX,lakeZ)};
    return {api:!!wf,map:!!(A&&A.mapTerrain),seaMesh:!!CBZ.citySea,seaFieldProbe:seaFieldProbe,surfaceAudit:surfaceAudit,aquatic:aquatic.length,badInitial:bad.length,
      badActors:bad.slice(0,6).map(function(a){return {species:a.species.id,x:a.pos.x,z:a.pos.z,shore:wf.shoreAt(a.pos.x,a.pos.z),clearance:a.waterClearance};}),
      worstShore:worst,minDepth:minDepth,maxDepth:maxDepth,routeSteps:routeSteps,routeFailures:routeFailures,snow:snow,desert:desert,inlandLake:inlandLake,probe:!!probe};
  })())`));

  await sleep(3200);
  const aquaticMotion = JSON.parse(await evaluate(`JSON.stringify((function(){
    const q=window.__waterAnimalProbe,a=q&&q.actor,wf=CBZ.waterField;if(!a)return null;
    return {species:a.species.id,distance:Math.hypot(a.pos.x-q.x,a.pos.z-q.z),shore:wf.shoreAt(a.pos.x,a.pos.z),valid:wf.isNavigableWater(a.pos.x,a.pos.z,(a.waterClearance||12)*0.4),surfaceError:Math.abs((a.pos.y+(a.swimDepth||1))-wf.surfaceY(a.pos.x,a.pos.z))};
  })())`));

  const snowboardStart = JSON.parse(await evaluate(`JSON.stringify((function(){
    const ok=CBZ.startSnowboardRun&&CBZ.startSnowboardRun(),s=CBZ.snowboardState;
    window.__boardProbe={x:CBZ.player.pos.x,y:CBZ.player.pos.y,z:CBZ.player.pos.z};
    return {ok:!!ok,mounted:!!(s&&s.mounted),x:CBZ.player.pos.x,y:CBZ.player.pos.y,z:CBZ.player.pos.z};
  })())`));
  await sleep(10500);
  const snowboardEnd = JSON.parse(await evaluate(`JSON.stringify((function(){
    const s=CBZ.snowboardState,q=window.__boardProbe,P=CBZ.player;
    return {mounted:!!(s&&s.mounted),x:P.pos.x,y:P.pos.y,z:P.pos.z,distance:q?Math.hypot(P.pos.x-q.x,P.pos.z-q.z):0,downhill:q?P.pos.z-q.z:0,speed:s?Math.hypot(s.vx,s.vz):0,air:s?s.airT:0,bestAir:s?s.bestAir:0,points:s?s.points:0};
  })())`));

  const failures = [];
  if (!initial.api || !initial.map || !initial.seaMesh) failures.push("shared water/terrain rendering API was unavailable");
  if (!initial.surfaceAudit || initial.surfaceAudit.waterMeshes.length !== 1) failures.push(`${initial.surfaceAudit ? initial.surfaceAudit.waterMeshes.length : 0} rendered ocean surfaces found instead of one`);
  if (initial.surfaceAudit && !(initial.surfaceAudit.waterMeshes[0].w >= 15000 && initial.surfaceAudit.waterMeshes[0].d >= 15000)) failures.push("world ocean did not extend beyond the camera horizon");
  if (!initial.inlandLake || !initial.inlandLake.centerWater || !initial.inlandLake.bankLand || !initial.inlandLake.registered) failures.push("Redhollow lake was not routed through the shared water field");
  if (initial.surfaceAudit && initial.surfaceAudit.localLakeSlabs.length) failures.push("a separate Redhollow lake slab still rendered over the shared ocean");
  if (initial.surfaceAudit && initial.surfaceAudit.snowIceSlabs.length) failures.push("frozen lake still used stacked terrain slabs");
  if (initial.surfaceAudit && !(initial.surfaceAudit.airportSpeedwayClear > 0)) failures.push("speedway ground still intersected Halloran Field");
  if (initial.surfaceAudit) {
    // Speedway is no longer a symmetric circle: its unified organic campus
    // includes a deliberately extended south paddock (SITE_DZ=-23). Validate
    // that authored surface's real AABB centre/coverage instead of requiring
    // the obsolete circular-island centroid.
    const expected={
      airport:{at:[-305,-120],tol:2},
      speedway:{at:[490,-373],tol:5,minW:400,minD:350},
      military:{at:[-620,-700],tol:2},
      farmland:{at:[1180,-880],tol:2}
    };
    for (const owner of Object.keys(expected)) {
      const ss=initial.surfaceAudit.ownerSurfaces.filter(function(s){return s.owner===owner;});
      const e=expected[owner],s=ss[0];
      if(ss.length!==1||!s||!s.unified||Math.hypot(s.x-e.at[0],s.z-e.at[1])>e.tol||
          (e.minW&&s.w<e.minW)||(e.minD&&s.d<e.minD))failures.push(owner+" did not have one correctly placed unified surface");
    }
    if(initial.surfaceAudit.overlaps.length)failures.push(initial.surfaceAudit.overlaps.length+" authored world-surface overlaps remained");
    if(initial.surfaceAudit.nearCoplanar.length)failures.push(initial.surfaceAudit.nearCoplanar.length+" rendered near-coplanar surface pairs remained");
  }
  if (initial.aquatic < 20 || initial.badInitial) failures.push(`${initial.badInitial}/${initial.aquatic} aquatic actors spawned on land`);
  if (initial.routeFailures) failures.push(`${initial.routeFailures} simulated aquatic routes crossed the shoreline`);
  if (!(initial.snow.max > 120 && initial.snow.std > 20)) failures.push("snow terrain remained flat or undersized");
  if (!(initial.desert.max > 35 && initial.desert.std > 5)) failures.push("desert terrain remained a flat prop field");
  if (!aquaticMotion || !aquaticMotion.valid || aquaticMotion.distance < 0.2 || aquaticMotion.surfaceError > 0.2) failures.push("live aquatic actor did not move in valid wave-synced water");
  if (!snowboardStart.ok || !snowboardStart.mounted || snowboardEnd.distance < 8 || snowboardEnd.downhill < 5) failures.push("snowboard did not physically descend the mountain");
  if (browserErrors.length) failures.push(`browser runtime exceptions: ${browserErrors.slice(0,3).join(" | ")}`);
  console.log(JSON.stringify({ initial, aquaticMotion, snowboardStart, snowboardEnd, browserErrors, failures }, null, 2));
  if (failures.length) process.exitCode = 1;
} finally {
  try { if (ws && ws.readyState === WebSocket.OPEN) await send("Browser.close"); } catch (_) {}
  if (!chrome.killed) chrome.kill("SIGTERM");
  if (!server.killed) server.kill("SIGTERM");
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}
