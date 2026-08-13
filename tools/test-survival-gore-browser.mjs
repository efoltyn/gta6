#!/usr/bin/env node
/* Focused real-Chrome regression for NATURAL DISASTER blood.
   Owner report: "The blood is dumb. On the mountain it shows FLATS that FLOAT.
   And it shows for NOTHING… it should show if you get pushed hard into
   something, if you fall from far, if you get punched a bunch of times."

   Four claims, each measured against the real engine (real arena, real
   floorAt, real gore pools), never asserted by eye:

     1. BLOODLESS CAUSES DRAW NOTHING. Frozen / drowned / choked / fallout /
        incinerated / vaporized deaths emit zero blood particles and zero pools.
     2. TRAUMATIC CAUSES DRAW A LOT, and the gore follows the death's physics
        (tornado > crushed > fell > beaten in volume).
     3. A BEATING RAMPS. Two punches leave no blood; five do.
     4. DECALS LIE ON THE GROUND. CBZ.goreAudit().float — the worst gap between
        any pool's rim and the terrain under it — stays small on the island's
        36-degree refuge mountain, where the pre-fix horizontal disc floated
        over a metre. Asserted with the fix ON, and shown to REGRESS with
        CBZ.CONFIG.GORE_SLOPE_DECALS=false, so the number is proven to be
        measuring the thing it claims to measure.

   Run: node tools/test-survival-gore-browser.mjs
*/

import { spawn } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(ROOT, "tools", "shots", "gore-qa");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const serverPort = 9460 + Math.floor(Math.random() * 120);
const debugPort = 10960 + Math.floor(Math.random() * 120);
const profile = `/tmp/cbz-gore-${debugPort}`;
const chromePath = process.env.CBZ_CHROME || (process.platform === "darwin"
  ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  : "/opt/pw-browsers/chromium");
const base = `http://127.0.0.1:${serverPort}/?seed=90210`;

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
const json = async (expr) => JSON.parse(await evaluate(`JSON.stringify((function(){${expr}})())`));

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
    if (await evaluate("document.readyState==='complete' && !!(window.CBZ && CBZ.setMode && CBZ.stepSim && CBZ.trauma && CBZ.goreAudit)")) break;
    await sleep(250);
  }

  const boot = await json(`
    CBZ.setMode("survival");CBZ.resetGame();CBZ.setState("playing");
    window.requestAnimationFrame=function(){return 0;};
    return {mode:CBZ.game.mode,arena:!!(CBZ.surv&&CBZ.surv.arena),bots:CBZ.bots.length,
      trauma:!!CBZ.trauma,impact:!!CBZ.goreImpact,audit:CBZ.goreAudit()};
  `);

  // ---- 1 + 2: what each CAUSE OF DEATH actually draws ----------------------
  // One fresh bot per cause, killed right in front of the camera (gore is
  // distance-gated at 70 u, so a kill across the island legitimately draws
  // nothing and would make this test lie).
  const CAUSES = [
    "frozen solid in the blizzard", "drowned in the floodwater", "choked by volcanic ash",
    "killed by nuclear fallout", "incinerated by lava", "vaporized by the nuclear blast",
    "starved", "burned alive in the wildfire", "struck by lightning", "eliminated",
    "torn apart by the tornado", "crushed under collapsing rubble", "swallowed by a sinkhole",
    "killed by hurricane debris", "beaten to death",
  ];
  // Gore is distance-gated at 70 u and systems/camera.js re-aims the lens at the
  // PLAYER on every stepSim, so a probe that only moves the camera measures a
  // culled scene after its first frame. Park the player at the probe spot and
  // re-seat the lens immediately before each measured call.
  const STAGE = `
    const A=CBZ.surv.arena,C=A.center;
    const kx=C.x+40,kz=C.z+40,ky=A.groundHeightAt(kx,kz);
    function stage(){
      CBZ.player.pos.set(kx+5,A.groundHeightAt(kx+5,kz+5),kz+5);
      if(CBZ.playerChar&&CBZ.playerChar.group)CBZ.playerChar.group.position.copy(CBZ.player.pos);
      CBZ.camera.position.set(kx+6,ky+3,kz+6);CBZ.camera.updateMatrixWorld(true);
    }`;

  const causes = await json(`
    ${STAGE}
    const out={};
    for (const cause of ${JSON.stringify(CAUSES)}) {
      CBZ.clearGore();
      const b=CBZ.bots.find(function(x){return !x.dead;});
      if(!b){out[cause]={err:"no live bot"};continue;}
      b.pos.set(kx,ky,kz); if(b.group) b.group.position.set(kx,ky,kz);
      b._trauma=null; b._noBlood=false;
      stage();
      CBZ.surv.killBot(b,{fromX:kx-1,fromZ:kz},cause);
      const a0=CBZ.goreAudit();
      out[cause]={bits:a0.bits,pools:a0.pools,puffs:a0.puffs,walls:a0.walls};
      CBZ.stepSim(1/60);
    }
    CBZ.clearGore();
    return out;
  `);

  // ---- 3: a beating has to RAMP ------------------------------------------
  const beating = await json(`
    ${STAGE}
    function beat(n){
      CBZ.clearGore();
      const b=CBZ.bots.find(function(x){return !x.dead;});
      if(!b)return {err:"no live bot"};
      b.pos.set(kx,ky,kz); if(b.group)b.group.position.set(kx,ky,kz);
      b._trauma=null;b._noBlood=false;b.hp=1e6;          // survive the beating: we want the BLEED, not the kill
      const per=[];
      for(let i=0;i<n;i++){
        stage();
        b.pos.set(kx,ky,kz); if(b.group)b.group.position.set(kx,ky,kz);
        CBZ.trauma.strike(b,6,{dir:{x:1,y:0.35,z:0},fromX:kx-1,fromZ:kz,y:1.5});
        per.push(CBZ.goreAudit().bits);
        // real punching cadence: the ledger's per-body emission cooldown is
        // 0.22 s (one spray per BLOW, not per frame), so a burst fired inside
        // one cooldown window would measure the cooldown, not the ramp.
        for(let k=0;k<24;k++)CBZ.stepSim(1/60);
      }
      const a=CBZ.goreAudit();
      return {bits:a.bits,pools:a.pools,per:per,ledger:+CBZ.trauma.of(b).toFixed(2)};
    }
    const r={two:beat(2),five:beat(5)};
    CBZ.clearGore();
    return r;
  `);

  // ---- 3b: a long FALL, and a body driven into a WALL ---------------------
  const impacts = await json(`
    ${STAGE}
    function probe(fn){
      CBZ.clearGore();
      const b=CBZ.bots.find(function(x){return !x.dead;});
      if(!b)return {err:"no live bot"};
      b.pos.set(kx,ky,kz);if(b.group)b.group.position.set(kx,ky,kz);
      b._trauma=null;b._noBlood=false;b.hp=1e6;
      stage();
      fn(b);
      const a=CBZ.goreAudit();
      CBZ.stepSim(1/60);
      return {bits:a.bits,pools:a.pools};
    }
    const r={
      // a 1 m step-down: nothing, ever
      hop:      probe(function(b){CBZ.trauma.slam(b,8,{dir:{x:0,y:1,z:0}});}),
      // ~3 m: a stumble, still under the bar
      shortFall:probe(function(b){CBZ.trauma.slam(b,11,{dir:{x:0,y:1,z:0}});}),
      // off the refuge mountain (26 m at g=22 → ~34 m/s): the top of the scale
      longFall: probe(function(b){CBZ.trauma.slam(b,34,{dir:{x:0,y:1,z:0}});}),
      // shoved into a building at 13 m/s
      wallSlam: probe(function(b){CBZ.trauma.slam(b,13,{wall:true,dir:{x:1,y:0,z:0}});}),
    };
    CBZ.clearGore();
    return r;
  `);

  // ---- 4: decals must LIE ON the mountain, not float over it --------------
  // The island's central refuge cone is peak 26 over radius 36 (~36 degrees).
  // Stamp a ring of full-size kill pools across its flank and measure the worst
  // rim-to-ground gap, with the fit ON and then deliberately OFF.
  //
  // The pools are stamped through CBZ.goreImpact({pool:true}) rather than full
  // kills on purpose: one deterministic pool per call instead of one pool plus
  // twenty droplet marks, so the ring can be grown to full size without the
  // droplet splats pushing the population past the recycle cap and quietly
  // evicting the very decals being measured. Same spawnSplat path either way.
  const slope = await json(`
    const A=CBZ.surv.arena,C=A.center;
    function stampRing(){
      CBZ.clearGore();
      // sit the player AND the lens on the flank so nothing is distance-culled
      CBZ.player.pos.set(C.x+18,A.groundHeightAt(C.x+18,C.z),C.z+18);
      if(CBZ.playerChar&&CBZ.playerChar.group)CBZ.playerChar.group.position.copy(CBZ.player.pos);
      CBZ.camera.position.set(C.x+18,A.groundHeightAt(C.x+18,C.z)+8,C.z+18);
      CBZ.camera.updateMatrixWorld(true);
      const pts=[];
      for(let k=0;k<10;k++){
        const th=k/10*Math.PI*2, r=16+ (k%3)*4;
        const x=C.x+Math.cos(th)*r, z=C.z+Math.sin(th)*r;
        pts.push([x,z,+A.groundHeightAt(x,z).toFixed(2)]);
        CBZ.goreImpact(x,A.groundHeightAt(x,z)+0.9,z,{amount:1.6,pool:true,
          dir:{x:Math.cos(th),y:0.3,z:Math.sin(th)}});
      }
      // pools GROW from 0.1 over ~3.4 s; a rim measured at spawn radius is not
      // measuring anything, so run the ring out to most of its final size first.
      for(let i=0;i<75;i++)CBZ.stepSim(1/60);
      const a=CBZ.goreAudit();
      return {float:a.float,floatAt:a.floatAt,pools:a.pools,streaks:a.streaks,pts:pts};
    }
    // the slope the pools are being asked to sit on, measured the same way the
    // decal fitter measures it — so a shallow hill can't quietly pass the test
    const h0=A.groundHeightAt(C.x+18,C.z), h1=A.groundHeightAt(C.x+19.1,C.z);
    const grade=+Math.abs((h1-h0)/1.1).toFixed(2);
    CBZ.CONFIG.GORE_SLOPE_DECALS=true;  const on=stampRing();
    CBZ.CONFIG.GORE_SLOPE_DECALS=false; const off=stampRing();
    CBZ.CONFIG.GORE_SLOPE_DECALS=true;  CBZ.clearGore();
    return {grade:grade,on:on,off:off};
  `);

  // ---- 4b: THE CORPSE TELLS YOU HOW IT DIED ------------------------------
  // Every bloodless cause must leave its own readable mark on the body, and
  // the marks must be visually DISTINCT from each other and from the living
  // rig — otherwise "no blood" has just made five deaths identical.
  const marks = await json(`
    ${STAGE}
    function hexOf(b){
      const ch=b.char,S=ch&&ch.skinSlots;
      if(!S)return null;
      const t=S.torso&&S.torso[0], h=S.head&&S.head[0];
      return [t&&t.material.color.getHex(), h&&h.material.color.getHex()];
    }
    const out={};
    for (const [cause,want] of ${JSON.stringify([
      ["frozen solid in the blizzard", "frost"],
      ["incinerated by lava", "char"],
      ["choked by volcanic ash", "ash"],
      ["drowned in the floodwater", "soak"],
      ["killed by nuclear fallout", "pallor"],
      ["starved", "pallor"],
      ["torn apart by the tornado", null],
    ])}) {
      const b=CBZ.bots.find(function(x){return !x.dead;});
      if(!b){out[cause]={err:"no live bot"};continue;}
      b.pos.set(kx,ky,kz); if(b.group) b.group.position.set(kx,ky,kz);
      b._trauma=null;b._noBlood=false;
      const before=hexOf(b);
      stage();
      CBZ.surv.killBot(b,{fromX:kx-1,fromZ:kz},cause);
      out[cause]={want:want,mark:CBZ.corpseMark(b),before:before,after:hexOf(b)};
      CBZ.stepSim(1/60);
    }
    CBZ.clearGore();
    return out;
  `);

  // ---- 4c: WATER TAKES THE BLOOD BACK ------------------------------------
  // Stamp pools on low ground, raise the sea over them (the same
  // CBZ.waterSurgeSet every flood on this island uses), and they must go.
  const wash = await json(`
    const A=CBZ.surv.arena,C=A.center;
    // a low, flat spot near the shore — ground under a metre, so a modest
    // surge actually covers it
    let sx=null,sz=null;
    for(let r=A.radius*0.55;r<A.radius*0.95&&sx===null;r+=6){
      for(let k=0;k<24;k++){
        const th=k/24*Math.PI*2, x=C.x+Math.cos(th)*r, z=C.z+Math.sin(th)*r;
        if(A.groundHeightAt(x,z)>=0 && A.groundHeightAt(x,z)<0.4){sx=x;sz=z;break;}
      }
    }
    if(sx===null)return {err:"no low ground found"};
    CBZ.player.pos.set(sx+4,A.groundHeightAt(sx+4,sz),sz);
    if(CBZ.playerChar&&CBZ.playerChar.group)CBZ.playerChar.group.position.copy(CBZ.player.pos);
    CBZ.clearGore();
    CBZ.camera.position.set(sx+5,A.groundHeightAt(sx,sz)+3,sz+5);CBZ.camera.updateMatrixWorld(true);
    for(let k=0;k<6;k++)CBZ.goreImpact(sx+(k-3)*1.5,A.groundHeightAt(sx,sz)+0.9,sz,{amount:1.5,pool:true});
    for(let i=0;i<40;i++)CBZ.stepSim(1/60);
    const dry=CBZ.goreAudit().pools;
    const depthDry=+CBZ.survFloodDepthMeanAt(sx,sz).toFixed(2);
    // flood it: raise mean sea level over the spot, exactly as a flood does
    CBZ.waterSurgeSet(4.5);
    for(let i=0;i<70;i++)CBZ.stepSim(1/60);
    const depthWet=+CBZ.survFloodDepthMeanAt(sx,sz).toFixed(2);
    const flooded=CBZ.goreAudit().pools;
    for(let i=0;i<130;i++)CBZ.stepSim(1/60);
    const after=CBZ.goreAudit().pools;
    CBZ.waterSurgeSet(0);CBZ.clearGore();
    return {at:[+sx.toFixed(1),+sz.toFixed(1)],dry:dry,flooded:flooded,after:after,
      depthDry:depthDry,depthWet:depthWet};
  `);

  // ---- 4d: AN OPEN WOUND FOLLOWS YOU -------------------------------------
  const trail = await json(`
    ${STAGE}
    CBZ.clearGore();
    const b=CBZ.bots.find(function(x){return !x.dead;});
    b.pos.set(kx,ky,kz);if(b.group)b.group.position.set(kx,ky,kz);
    b._trauma=null;b._noBlood=false;b.hp=1e6;
    stage();
    // a hard landing opens them up
    CBZ.trauma.slam(b,26,{dir:{x:0,y:1,z:0}});
    const openedAt=CBZ.goreAudit().pools;
    const trailing=CBZ.trauma.bleeding(b);
    // now walk them 12 m past the lens
    for(let i=0;i<70;i++){
      b.pos.x+=0.18; if(b.group)b.group.position.x=b.pos.x;
      CBZ.player.pos.set(b.pos.x-3,A.groundHeightAt(b.pos.x-3,kz+4),kz+4);
      CBZ.camera.position.set(b.pos.x-3,ky+3,kz+5);CBZ.camera.updateMatrixWorld(true);
      CBZ.stepSim(1/60);
    }
    const walked=CBZ.goreAudit().pools;
    // AND IT MUST CLOSE, or the trail is a permanent paint roller. Park the
    // sim out of "playing" for this stretch: stepSim still runs the always
    // chain (where the trail lives) but skips the updaters, so the disaster
    // director cannot land a fresh hit and re-open the wound we are timing.
    const st=CBZ.game.state; CBZ.game.state="probe";
    for(let i=0;i<20*60;i++){
      b.pos.x+=0.05; if(b.group)b.group.position.x=b.pos.x;
      CBZ.stepSim(1/60);
    }
    CBZ.game.state=st;
    const stillBleeding=CBZ.trauma.bleeding(b);
    const closed=!stillBleeding;
    CBZ.clearGore();
    return {openedAt:openedAt,trailing:trailing,walked:walked,closed:closed};
  `);

  // ---- 4e: corpses stop popping at arm's length --------------------------
  const corpses = await json(`
    ${STAGE}
    stage();
    const near=[],far=[];
    for(let k=0;k<3;k++){
      const b=CBZ.bots.find(function(x){return !x.dead;});
      b.pos.set(kx+k*1.5,ky,kz);if(b.group)b.group.position.set(kx+k*1.5,ky,kz);
      CBZ.surv.killBot(b,{fromX:kx,fromZ:kz},"frozen solid in the blizzard");
      near.push(b);
    }
    for(let k=0;k<3;k++){
      const b=CBZ.bots.find(function(x){return !x.dead && near.indexOf(x)<0;});
      b.pos.set(kx+300,ky,kz+300);if(b.group)b.group.position.set(kx+300,ky,kz+300);
      CBZ.surv.killBot(b,{fromX:kx,fromZ:kz},"frozen solid in the blizzard");
      far.push(b);
    }
    function culled(l){let n=0;for(const b of l)if(b.culled)n++;return n;}
    const out={};
    for(let i=0;i<9*60;i++){stage();CBZ.stepSim(1/60);}       // ~9 s: past the old flat 6 s
    out.at9={near:culled(near),far:culled(far)};
    for(let i=0;i<20*60;i++){stage();CBZ.stepSim(1/60);}      // ~29 s: past the near window too
    out.at29={near:culled(near),far:culled(far)};
    return out;
  `);

  // ---- 5: the master switch still reverts to the old behaviour ------------
  const revert = await json(`
    ${STAGE}
    CBZ.CONFIG.SURV_TRAUMA=false;
    CBZ.clearGore();
    const b=CBZ.bots.find(function(x){return !x.dead;});
    b.pos.set(kx,ky,kz);if(b.group)b.group.position.set(kx,ky,kz);
    b._trauma=null;b._noBlood=false;
    stage();
    CBZ.surv.killBot(b,{fromX:kx-1,fromZ:kz},"frozen solid in the blizzard");
    const a=CBZ.goreAudit();
    CBZ.CONFIG.SURV_TRAUMA=true;CBZ.clearGore();
    return {bits:a.bits,pools:a.pools};
  `);

  // ================= assertions =================
  const failures = [];
  const sum = (c) => (causes[c] ? causes[c].bits + causes[c].pools + causes[c].puffs : -1);

  if (boot.mode !== "survival" || !boot.arena) failures.push("survival did not boot");
  if (!boot.trauma || !boot.impact) failures.push("CBZ.trauma / CBZ.goreImpact missing");

  const BLOODLESS = ["frozen solid in the blizzard", "drowned in the floodwater", "choked by volcanic ash",
    "killed by nuclear fallout", "incinerated by lava", "vaporized by the nuclear blast", "starved",
    "burned alive in the wildfire", "struck by lightning", "eliminated"];
  for (const c of BLOODLESS) {
    if (sum(c) !== 0) failures.push(`"${c}" drew blood (${JSON.stringify(causes[c])}) — it must draw none`);
  }
  const BLOODY = ["torn apart by the tornado", "crushed under collapsing rubble",
    "swallowed by a sinkhole", "killed by hurricane debris", "beaten to death"];
  for (const c of BLOODY) {
    if (!(causes[c] && causes[c].bits > 10 && causes[c].pools > 0)) {
      failures.push(`"${c}" drew too little (${JSON.stringify(causes[c])})`);
    }
  }
  if (!(causes["torn apart by the tornado"].bits > causes["beaten to death"].bits)) {
    failures.push("a tornado dismemberment did not outdraw a beating");
  }

  if (beating.two.bits !== 0 || beating.two.pools !== 0) failures.push(`two punches drew blood (${JSON.stringify(beating.two)}) — they must only bruise`);
  if (!(beating.five.pools > 0)) failures.push(`five punches left no blood on the ground (${JSON.stringify(beating.five)})`);
  const per = beating.five.per;
  if (!(per[0] === 0 && per[1] === 0 && per[2] > 0)) {
    failures.push(`the beating did not RAMP — first blood should land on the third punch, per-punch bits ${JSON.stringify(per)}`);
  }

  if (impacts.hop.bits !== 0 || impacts.hop.pools !== 0) failures.push("a 1 m step-down drew blood");
  if (impacts.shortFall.bits !== 0) failures.push("a ~3 m drop drew blood");
  if (!(impacts.longFall.bits > 10 && impacts.longFall.pools > 0)) failures.push(`a 26 m fall drew too little (${JSON.stringify(impacts.longFall)})`);
  if (!(impacts.longFall.bits > impacts.wallSlam.bits)) failures.push("a mountain fall did not outdraw a wall slam");
  if (!(impacts.wallSlam.bits > 0)) failures.push(`being driven into a wall at 13 m/s drew nothing (${JSON.stringify(impacts.wallSlam)})`);

  if (!(slope.grade > 0.5)) failures.push(`the test ring is not on a real slope (grade ${slope.grade})`);
  if (!(slope.on.pools > 0)) failures.push("no pools were stamped on the mountain");
  if (!(slope.on.float < 0.45)) failures.push(`pools still float on the mountain: worst rim gap ${slope.on.float} m at ${JSON.stringify(slope.on.floatAt)}`);
  if (!(slope.off.float > slope.on.float * 2)) {
    failures.push(`the slope fit is not what's holding decals down (on ${slope.on.float} vs off ${slope.off.float}) — the audit may be measuring nothing`);
  }
  if (!(slope.on.streaks > 0)) failures.push("no downhill run-off was drawn on a 36-degree slope");

  // the corpse must be MARKED, and the marks must not all look the same
  const seenTorso = new Map();
  for (const [cause, m] of Object.entries(marks)) {
    if (m.want === null) continue;                    // a bloody death: no mark expected
    if (m.mark !== m.want) failures.push(`"${cause}" left mark ${m.mark}, expected ${m.want}`);
    if (!m.after || m.after[0] === m.before[0]) failures.push(`"${cause}" left the body unchanged (torso ${m.before && m.before[0]})`);
    if (!m.after || m.after[1] === m.before[1]) failures.push(`"${cause}" left the head unchanged`);
    if (m.after) {
      const prior = seenTorso.get(m.after[0]);
      if (prior && marks[prior].want !== m.want) failures.push(`"${cause}" and "${prior}" produced the same body colour — the marks must be distinguishable`);
      seenTorso.set(m.after[0], cause);
    }
  }
  if (marks["torn apart by the tornado"].mark !== null) failures.push("a bloody death should not also tint the corpse");

  if (wash.err) failures.push(`wash probe: ${wash.err}`);
  else {
    if (!(wash.dry > 0)) failures.push("no pools were stamped for the wash test");
    if (!(wash.depthWet > 0.09)) failures.push(`the surge did not actually cover the pools (depth ${wash.depthWet})`);
    if (!(wash.after < wash.dry * 0.35)) failures.push(`floodwater did not wash the blood away (${wash.dry} pools → ${wash.after} after the surge)`);
  }

  if (!trail.trailing) failures.push("a hard landing did not open a bleeding wound");
  if (!(trail.walked > trail.openedAt + 2)) failures.push(`a bleeding survivor left no trail (${trail.openedAt} → ${trail.walked} marks over 12 m)`);
  if (!trail.closed) failures.push("the wound never closed — the trail would be a permanent paint roller behind every bot");

  if (!(corpses.at9.near === 0)) failures.push(`a corpse at arm's length still vanished at 6 s (${corpses.at9.near}/3 culled by 9 s)`);
  if (!(corpses.at9.far === 3)) failures.push(`far corpses did not clear on the original 6 s budget (${corpses.at9.far}/3 culled by 9 s)`);
  if (!(corpses.at29.near === 3)) failures.push(`near corpses never cleared (${corpses.at29.near}/3 culled by 29 s) — that is a leak`);

  if (!(revert.bits > 0)) failures.push("SURV_TRAUMA=false did not restore the original unconditional gore");

  if (browserErrors.length) failures.push(`browser errors: ${browserErrors.slice(0, 4).join(" | ")}`);

  console.log("boot            ", JSON.stringify(boot));
  console.log("causes          ", JSON.stringify(causes, null, 1));
  console.log("beating         ", JSON.stringify(beating));
  console.log("impacts         ", JSON.stringify(impacts));
  console.log("slope           ", JSON.stringify({ grade: slope.grade, on: { float: slope.on.float, pools: slope.on.pools, streaks: slope.on.streaks }, off: { float: slope.off.float, pools: slope.off.pools } }));
  console.log("marks           ", JSON.stringify(marks, null, 1));
  console.log("wash            ", JSON.stringify(wash));
  console.log("trail           ", JSON.stringify(trail));
  console.log("corpses         ", JSON.stringify(corpses));
  console.log("revert          ", JSON.stringify(revert));

  if (failures.length) {
    console.error("\nFAIL");
    for (const f of failures) console.error("  ✗ " + f);
    process.exitCode = 1;
  } else {
    console.log("\nPASS — blood is earned: bloodless causes stay clean, trauma bleeds, decals lie on the mountain.");
  }
} finally {
  try { ws && ws.close(); } catch (_) {}
  chrome.kill("SIGKILL");
  server.kill("SIGKILL");
  await rm(profile, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
}
