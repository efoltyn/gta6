#!/usr/bin/env node
/* tools/perf-ab/abinst.mjs — paired A/B for LOCAL_INSTANCING (build-time flag).
 * Boots once with whatever ?cfg_ you pass, freezes the rAF loop, and reports the
 * EXACT main-pass draw calls / triangles / visible meshes + the instancer's own
 * pools/collapsed stats + console errors. Run twice (off vs on) and diff.
 * Usage: node tools/perf-ab/abinst.mjs [--seed 90210] [--cfg LOCAL_INSTANCING=1] [--json out.json]
 */
import { spawn } from "node:child_process";
import { rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const argv = process.argv.slice(2);
const argS = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d; };
const SEED = +argS("--seed", "90210"); const CFG = argS("--cfg", ""); const OUT = argS("--json", "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function claimPort(lo, span, probe){for(let t=0;t<8;t++){const p=lo+Math.floor(Math.random()*span);try{await probe(p);}catch(_){return p;}}throw new Error("port");}
const port=await claimPort(9500,300,(p)=>fetch(`http://127.0.0.1:${p}/`));
const server=spawn("python3",[path.join(ROOT,"tools/devserver.py")],{env:{...process.env,PORT:String(port)},stdio:"ignore"});
const origin=`http://127.0.0.1:${port}/`;
{let up=false;for(let i=0;i<50&&!up;i++){try{await fetch(origin);up=true;}catch(_){await sleep(100);}}}
const dbg=await claimPort(10800,300,(p)=>fetch(`http://127.0.0.1:${p}/json/version`));
const prof=`/tmp/cbz-abinst-${dbg}`;await rm(prof,{recursive:true,force:true});
const cfgQuery=CFG?"&"+CFG.split(",").filter(Boolean).map(kv=>{const[k,v]=kv.split("=");return`cfg_${k}=${v}`;}).join("&"):"";
const chrome=spawn("/opt/pw-browsers/chromium",["--headless=new","--no-sandbox","--disable-dev-shm-usage","--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--enable-webgl","--mute-audio","--window-size=1280,720",`--remote-debugging-port=${dbg}`,`--user-data-dir=${prof}`,`${origin}?seed=${SEED}&qforce=4${cfgQuery}`],{stdio:"ignore"});
let page=null;for(let i=0;i<200&&!page;i++){try{const ps=await(await fetch(`http://127.0.0.1:${dbg}/json/list`)).json();page=ps.find(p=>p.type==="page"&&p.url.startsWith(origin));}catch(_){}if(!page)await sleep(100);}
const ws=new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res,rej)=>{ws.addEventListener("open",res,{once:true});ws.addEventListener("error",rej,{once:true});});
let id=1;const pend=new Map();const errors=[];
ws.addEventListener("message",ev=>{const m=JSON.parse(ev.data);if(m.id&&pend.has(m.id)){pend.get(m.id)(m);pend.delete(m.id);return;}
  if(m.method==="Runtime.exceptionThrown"){const d=m.params.exceptionDetails;errors.push((d.exception&&d.exception.description||d.text||"").split("\n")[0].slice(0,160));}
  else if(m.method==="Runtime.consoleAPICalled"&&m.params.type==="error")errors.push(m.params.args.map(a=>a.value||a.description||"").join(" ").slice(0,160));});
const send=(method,params={})=>new Promise(r=>{const i=id++;pend.set(i,r);ws.send(JSON.stringify({id:i,method,params}));});
const evl=async(e,ap=false)=>{const r=await send("Runtime.evaluate",{expression:e,returnByValue:true,awaitPromise:ap});if(r.result&&r.result.exceptionDetails)throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0,300));return r.result&&r.result.result&&r.result.result.value;};
await send("Runtime.enable");
const T0=Date.now();const mark=m=>console.error(`[t+${((Date.now()-T0)/1000).toFixed(1)}s] ${m}`);
{let ok=false;for(let i=0;i<400&&!ok;i++){try{ok=!!(await evl("!!(window.CBZ&&CBZ.game&&(CBZ.bootComplete||CBZ.game.state==='title')&&document.getElementById('playBtn'))"));}catch(_){}if(!ok)await sleep(150);}}mark("boot");
{let p=false;for(let i=0;i<240&&!p;i++){p=await evl("(()=>{if(CBZ.game&&CBZ.game.state==='playing')return true;const b=document.getElementById('playBtn');if(b)b.click();return CBZ.game&&CBZ.game.state==='playing';})()");if(!p)await sleep(200);}}mark("playing");
{let prev=-1,st=0,c=0;for(let i=0;i<80&&st<3;i++){c=await evl("(CBZ.colliders||[]).length");if(c>5000&&Math.abs(c-prev)<300)st++;else st=0;prev=c;await sleep(700);}mark("world stable c="+c);}
for(let i=0;i<5;i++){await evl("CBZ.stepSim&&CBZ.stepSim(1/60)");await sleep(120);}
mark("measuring");
const M=`(() => {
  const R=CBZ.renderer,S=CBZ.scene,C=CBZ.camera,info=R.info;
  window.__raf=window.requestAnimationFrame;window.requestAnimationFrame=function(){return 0;};
  R.shadowMap.enabled=true;R.shadowMap.autoUpdate=false;R.shadowMap.needsUpdate=false;
  for(let i=0;i<4;i++)R.render(S,C);
  const c=info.render;
  let meshes=0,vis=0,inst=0;S.traverse(o=>{if(o.isMesh){meshes++;if(o.visible)vis++;}if(o.isInstancedMesh)inst++;});
  const out={mainCalls:c.calls,mainTris:c.triangles,meshes,visibleMeshes:vis,instancedMeshes:inst,
    localInstStats:CBZ.localInstStats||null,flag:CBZ.CONFIG&&CBZ.CONFIG.LOCAL_INSTANCING,
    heapMB:performance.memory?+(performance.memory.usedJSHeapSize/1048576).toFixed(1):null,
    programs:(info.programs||[]).length,geometries:info.memory.geometries};
  window.requestAnimationFrame=window.__raf;return out;
})()`;
let report={seed:SEED,cfg:CFG};
try{Object.assign(report,await evl(M,true));}catch(e){console.error("measure failed:",e.message);process.exit(1);}
mark("done calls="+report.mainCalls+" pools="+(report.localInstStats&&report.localInstStats.pools));
report.consoleErrors=errors.filter(e=>!/ProgressEvent/.test(e)).slice(0,20);
const json=JSON.stringify(report,null,2);
if(OUT)await writeFile(path.isAbsolute(OUT)?OUT:path.join(ROOT,OUT),json);
process.stdout.write(json+"\n");
try{if(ws.readyState===1)await send("Browser.close");}catch(_){}
if(!chrome.killed)chrome.kill("SIGTERM");if(!server.killed)server.kill("SIGTERM");
await rm(prof,{recursive:true,force:true}).catch(()=>{});
process.exit(0);
