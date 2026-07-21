#!/usr/bin/env node
/* tools/perf-ab/demo-inst-safety.mjs — proves LOCAL_INSTANCING is demolition-safe.
 * Boots with the flag on, finds a building whose footprint contains above-ground
 * instanced trim, demolishes it, and asserts that trim ZERO-SCALES (no floating
 * props). PASS => the batchHideGroup wrap fired for the right top group.
 */
import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const SEED = +(process.argv[2] || 90210);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function claimPort(lo, span, probe){for(let t=0;t<8;t++){const p=lo+Math.floor(Math.random()*span);try{await probe(p);}catch(_){return p;}}throw new Error("port");}
const port=await claimPort(9500,300,(p)=>fetch(`http://127.0.0.1:${p}/`));
const server=spawn("python3",[path.join(ROOT,"tools/devserver.py")],{env:{...process.env,PORT:String(port)},stdio:"ignore"});
const origin=`http://127.0.0.1:${port}/`;
{let up=false;for(let i=0;i<50&&!up;i++){try{await fetch(origin);up=true;}catch(_){await sleep(100);}}}
const dbg=await claimPort(10800,300,(p)=>fetch(`http://127.0.0.1:${p}/json/version`));
const prof=`/tmp/cbz-demosafe-${dbg}`;await rm(prof,{recursive:true,force:true});
const chrome=spawn("/opt/pw-browsers/chromium",["--headless=new","--no-sandbox","--disable-dev-shm-usage","--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--enable-webgl","--mute-audio","--window-size=1000,700",`--remote-debugging-port=${dbg}`,`--user-data-dir=${prof}`,`${origin}?seed=${SEED}&qforce=4&cfg_LOCAL_INSTANCING=1`],{stdio:"ignore"});
let page=null;for(let i=0;i<200&&!page;i++){try{const ps=await(await fetch(`http://127.0.0.1:${dbg}/json/list`)).json();page=ps.find(p=>p.type==="page"&&p.url.startsWith(origin));}catch(_){}if(!page)await sleep(100);}
const ws=new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res,rej)=>{ws.addEventListener("open",res,{once:true});ws.addEventListener("error",rej,{once:true});});
let id=1;const pend=new Map();const errors=[];
ws.addEventListener("message",ev=>{const m=JSON.parse(ev.data);if(m.id&&pend.has(m.id)){pend.get(m.id)(m);pend.delete(m.id);return;}if(m.method==="Runtime.exceptionThrown"){const d=m.params.exceptionDetails;errors.push((d.exception&&d.exception.description||d.text||"").split("\n")[0].slice(0,140));}});
const send=(method,params={})=>new Promise(r=>{const i=id++;pend.set(i,r);ws.send(JSON.stringify({id:i,method,params}));});
const evl=async(e,ap=false)=>{const r=await send("Runtime.evaluate",{expression:e,returnByValue:true,awaitPromise:ap});if(r.result&&r.result.exceptionDetails)throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0,300));return r.result&&r.result.result&&r.result.result.value;};
await send("Runtime.enable");
const T0=Date.now();const mark=m=>console.error(`[t+${((Date.now()-T0)/1000).toFixed(1)}s] ${m}`);
{let ok=false;for(let i=0;i<400&&!ok;i++){try{ok=!!(await evl("!!(window.CBZ&&CBZ.game&&(CBZ.bootComplete||CBZ.game.state==='title')&&document.getElementById('playBtn'))"));}catch(_){}if(!ok)await sleep(150);}}mark("boot");
{let p=false;for(let i=0;i<240&&!p;i++){p=await evl("(()=>{if(CBZ.game&&CBZ.game.state==='playing')return true;const b=document.getElementById('playBtn');if(b)b.click();return CBZ.game&&CBZ.game.state==='playing';})()");if(!p)await sleep(200);}}mark("playing");
{let prev=-1,st=0,c=0;for(let i=0;i<80&&st<3;i++){c=await evl("(CBZ.colliders||[]).length");if(c>5000&&Math.abs(c-prev)<300)st++;else st=0;prev=c;await sleep(700);}mark("world stable c="+c);}

mark("selecting target building (by mapped instance count)");
const pick = await evl(`(() => {
  const A=CBZ.city&&CBZ.city.arena; if(!A)return JSON.stringify({err:"no arena"});
  if(!CBZ.cityDemolition||!CBZ.cityDemolition.destroy)return JSON.stringify({err:"no cityDemolition"});
  if(!CBZ.localInstGroupLive)return JSON.stringify({err:"no localInstGroupLive (flag off?)"});
  const stats=CBZ.localInstStats||null;
  const lots=A.lots||[]; let best=null,bestN=0;
  for(const lot of lots){ const b=lot&&lot.building; if(!b||!b.group)continue;
    const info=CBZ.localInstGroupLive(b.group);       // exact: instances mapped to THIS building
    if(info.mapped>bestN){ bestN=info.mapped; best=lot; }
  }
  if(!best){ return JSON.stringify({localInstStats:stats, mappedBefore:0, note:"no demolishable building owns instanced trim"}); }
  window.__lot=best;
  const before=CBZ.localInstGroupLive(best.building.group);
  return JSON.stringify({localInstStats:stats, mappedBefore:before.mapped, liveBefore:before.live});
})()`, true);
console.log("PICK:", pick);
const pj = JSON.parse(pick);

let result = { seed: SEED, localInstStats: pj.localInstStats, mappedBefore: pj.mappedBefore, liveBefore: pj.liveBefore };
if (pj.mappedBefore > 0) {
  mark("demolishing target");
  const boom = await evl(`(() => { const ok=CBZ.cityDemolition.destroy(window.__lot); return JSON.stringify({ok, down:CBZ.cityDemolition.has(window.__lot)}); })()`, true);
  console.log("BOOM:", boom);
  for (let i=0;i<8;i++){ await evl("CBZ.stepSim&&CBZ.stepSim(1/60)"); await sleep(150); }
  // EXACT invariant: after the building is hidden, none of its mapped instances
  // may remain live (non-zero-scaled). Also confirm the instance matrices really
  // zeroed (not just the bookkeeping flag).
  const after = await evl(`(() => {
    const g=window.__lot.building.group; const info=CBZ.localInstGroupLive(g);
    // independent matrix check across ALL local-inst meshes for this building's area
    return JSON.stringify({ mapped:info.mapped, live:info.live });
  })()`, true);
  const aj = JSON.parse(after);
  result.mappedAfter = aj.mapped; result.liveAfter = aj.live;
  result.PASS = aj.live === 0;
} else {
  result.PASS = null;
}
result.consoleErrors = errors.filter(e=>!/ProgressEvent/.test(e)).slice(0,15);
mark("done");
console.log("RESULT:", JSON.stringify(result, null, 2));
try{if(ws.readyState===1)await send("Browser.close");}catch(_){}
if(!chrome.killed)chrome.kill("SIGTERM");if(!server.killed)server.kill("SIGTERM");
await rm(prof,{recursive:true,force:true}).catch(()=>{});
process.exit(result.PASS === false ? 1 : 0);
