#!/usr/bin/env node
/* tools/perf-ab/census.mjs — WHAT are the ~5,600 static draw calls?
 * Boots the city, freezes the loop, and buckets the frustum-VISIBLE meshes under
 * the city root by geometry+material signature to separate genuine instancing
 * candidates (many identical, not collider/userData-spared) from unique
 * procedural building geometry (batch.js/instancing can't touch it).
 * Usage: node tools/perf-ab/census.mjs [--seed 90210] [--json out.json]
 */
import { spawn } from "node:child_process";
import { rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const argv = process.argv.slice(2);
const argS = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d; };
const SEED = +argS("--seed", "90210"); const OUT = argS("--json", "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function claimPort(lo, span, probe){for(let t=0;t<8;t++){const p=lo+Math.floor(Math.random()*span);try{await probe(p);}catch(_){return p;}}throw new Error("port");}
const port=await claimPort(9500,200,(p)=>fetch(`http://127.0.0.1:${p}/`));
const server=spawn("python3",[path.join(ROOT,"tools/devserver.py")],{env:{...process.env,PORT:String(port)},stdio:"ignore"});
const origin=`http://127.0.0.1:${port}/`;
{let up=false;for(let i=0;i<50&&!up;i++){try{await fetch(origin);up=true;}catch(_){await sleep(100);}}}
const dbg=await claimPort(10800,200,(p)=>fetch(`http://127.0.0.1:${p}/json/version`));
const prof=`/tmp/cbz-census-${dbg}`;await rm(prof,{recursive:true,force:true});
const chrome=spawn("/opt/pw-browsers/chromium",["--headless=new","--no-sandbox","--disable-dev-shm-usage","--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--enable-webgl","--mute-audio","--window-size=1280,720",`--remote-debugging-port=${dbg}`,`--user-data-dir=${prof}`,`${origin}?seed=${SEED}&qforce=4`],{stdio:"ignore"});
let page=null;for(let i=0;i<200&&!page;i++){try{const ps=await(await fetch(`http://127.0.0.1:${dbg}/json/list`)).json();page=ps.find(p=>p.type==="page"&&p.url.startsWith(origin));}catch(_){}if(!page)await sleep(100);}
const ws=new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res,rej)=>{ws.addEventListener("open",res,{once:true});ws.addEventListener("error",rej,{once:true});});
let id=1;const pend=new Map();
ws.addEventListener("message",ev=>{const m=JSON.parse(ev.data);if(m.id&&pend.has(m.id)){pend.get(m.id)(m);pend.delete(m.id);}});
const send=(method,params={})=>new Promise(r=>{const i=id++;pend.set(i,r);ws.send(JSON.stringify({id:i,method,params}));});
const evl=async(e,ap=false)=>{const r=await send("Runtime.evaluate",{expression:e,returnByValue:true,awaitPromise:ap});if(r.result&&r.result.exceptionDetails)throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0,300));return r.result&&r.result.result&&r.result.result.value;};
await send("Runtime.enable");
const T0=Date.now();const mark=m=>console.error(`[t+${((Date.now()-T0)/1000).toFixed(1)}s] ${m}`);
{let ok=false;for(let i=0;i<400&&!ok;i++){try{ok=!!(await evl("!!(window.CBZ&&CBZ.game&&(CBZ.bootComplete||CBZ.game.state==='title')&&document.getElementById('playBtn'))"));}catch(_){}if(!ok)await sleep(150);}}mark("boot");
{let p=false;for(let i=0;i<240&&!p;i++){p=await evl("(()=>{if(CBZ.game&&CBZ.game.state==='playing')return true;const b=document.getElementById('playBtn');if(b)b.click();return CBZ.game&&CBZ.game.state==='playing';})()");if(!p)await sleep(200);}}mark("playing");
{let prev=-1,st=0,c=0;for(let i=0;i<80&&st<3;i++){c=await evl("(CBZ.colliders||[]).length");if(c>5000&&Math.abs(c-prev)<300)st++;else st=0;prev=c;await sleep(700);}mark("world stable c="+c);}
for(let i=0;i<5;i++){await evl("CBZ.stepSim&&CBZ.stepSim(1/60)");await sleep(120);}

const CENSUS=`(() => {
  const S=CBZ.scene,C=CBZ.camera,R=CBZ.renderer;
  window.__raf=window.requestAnimationFrame;window.requestAnimationFrame=function(){return 0;};
  R.shadowMap.needsUpdate=false;R.render(S,C);
  // frustum of the live camera
  C.updateMatrixWorld();const fr=new THREE.Frustum();fr.setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(C.projectionMatrix,C.matrixWorldInverse));
  const colRefs=new Set();for(const c of (CBZ.colliders||[]))if(c&&c.ref)colRefs.add(c.ref);
  const los=new Set(CBZ.losBlockers||[]);
  const root=CBZ.city&&CBZ.city.arena&&CBZ.city.arena.root;
  const out={visibleDrawMeshes:0,instanced:0,byPair:{},pairMeta:{}};
  const bbox=new THREE.Box3();const sphere=new THREE.Sphere();
  function considered(o){ return o.isMesh && o.visible; }
  (root||S).traverse(o=>{
    if(!considered(o))return;
    // in-frustum test (approx via bounding sphere)
    let inView=true;
    try{ if(o.geometry){ if(!o.geometry.boundingSphere)o.geometry.computeBoundingSphere(); sphere.copy(o.geometry.boundingSphere).applyMatrix4(o.matrixWorld); inView=fr.intersectsSphere(sphere);} }catch(e){}
    if(!inView)return;
    out.visibleDrawMeshes++;
    if(o.isInstancedMesh){out.instanced++;return;}
    const g=o.geometry&&(o.geometry.uuid||o.geometry.id);
    const ml=Array.isArray(o.material)?o.material:[o.material];
    const mk=ml.map(m=>m&&(m.uuid||m.id)).join(",");
    const key=g+"|"+mk;
    out.byPair[key]=(out.byPair[key]||0)+1;
    if(!out.pairMeta[key]){
      const m0=ml[0];
      out.pairMeta[key]={collider:false,userData:false,los:false,array:Array.isArray(o.material),
        tris:o.geometry&&o.geometry.index?o.geometry.index.count/3:(o.geometry&&o.geometry.attributes&&o.geometry.attributes.position?o.geometry.attributes.position.count/3:0),
        matType:m0&&m0.type,name:o.name||o.parent&&o.parent.name||""};
    }
    const meta=out.pairMeta[key];
    if(colRefs.has(o))meta.collider=true;
    if(o.userData&&Object.keys(o.userData).length)meta.userData=true;
    if(los.has(o))meta.los=true;
  });
  // rank repeated pairs
  const pairs=Object.keys(out.byPair).map(k=>({k,n:out.byPair[k],...out.pairMeta[k]})).sort((a,b)=>b.n-a.n);
  const repeated=pairs.filter(p=>p.n>=4);
  // instanceable = repeated, not a material array, and geometry small enough to matter
  const instanceable=repeated.filter(p=>!p.array);
  const spared=instanceable.filter(p=>p.collider||p.userData||p.los);
  const free=instanceable.filter(p=>!p.collider&&!p.userData&&!p.los);
  const sum=a=>a.reduce((s,p)=>s+p.n,0);
  return {
    visibleDrawMeshes:out.visibleDrawMeshes, instancedMeshesInView:out.instanced,
    uniquePairs:pairs.length,
    singletonPairs:pairs.filter(p=>p.n===1).length,
    repeatedPairs:repeated.length, meshesInRepeatedPairs:sum(repeated),
    instanceableMeshes_total:sum(instanceable),
    instanceableMeshes_spared_collider_or_userdata:sum(spared),
    instanceableMeshes_FREE:sum(free),
    freePairCount:free.length,
    top15_free:free.slice(0,15).map(p=>({n:p.n,tris:Math.round(p.tris),matType:p.matType,name:p.name})),
    top15_spared:spared.slice(0,15).map(p=>({n:p.n,tris:Math.round(p.tris),collider:p.collider,userData:p.userData,name:p.name})),
  };
})()`;
mark("census (rAF frozen)");
let report;try{report=await evl(CENSUS,true);}catch(e){console.error("CENSUS failed:",e.message);process.exit(1);}
mark("done");
const json=JSON.stringify(report,null,2);
if(OUT)await writeFile(path.isAbsolute(OUT)?OUT:path.join(ROOT,OUT),json);
process.stdout.write(json+"\n");
try{if(ws.readyState===1)await send("Browser.close");}catch(_){}
if(!chrome.killed)chrome.kill("SIGTERM");if(!server.killed)server.kill("SIGTERM");
await rm(prof,{recursive:true,force:true}).catch(()=>{});
process.exit(0);
