#!/usr/bin/env node
/* tools/shark-mouth-paint.mjs — WHICH MESH IS THE BLACK BIT?

   Bounding-box arithmetic kept giving me different answers depending on how I
   did the frame conversion, and a measurement you cannot reproduce is not a
   measurement. This settles it the way it should have been settled first: PAINT
   the candidates in primary colours, photograph the mouth from the prey's eye,
   and look at which one is the shape in question.

   Every dark mesh in the head gets a colour and the mapping is printed, so the
   screenshot answers "what is that" directly instead of by inference.

     node tools/shark-mouth-paint.mjs
     node tools/shark-mouth-paint.mjs --species great_white_shark
*/
import { launch, sleep } from "./lib/cdp.mjs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const argv = process.argv.slice(2);
const arg = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d; };
const SPECIES = arg("--species", "megalodon");
const OUT = arg("--out", "artifacts/shark-mouth");
/* --plain: same animal, same gape, same lens, NO paint. The paint identifies
   which mesh a shape belongs to; the plain shot is what the player actually
   sees, and it is the one to compare across a change. --tag names the file so
   two runs can sit side by side. */
const PLAIN = argv.includes("--plain");
const TAG = arg("--tag", PLAIN ? "plain" : "paint");
/* --below: how far under the mouth axis the lens sits, as a fraction of the
   stand-off. 0.30 is the drone-ish look up from beneath; 0.08 is the owner's
   actual complaint — a diver head-on with the gape, looking straight in. */
const BELOW = +arg("--below", "0.30");
const DIST = +arg("--dist", "0.42");
// --maw-off: build the pre-trim buccal sack (the shipped shape), for the A/B.
const MAW_OFF = argv.includes("--maw-off");

const rig = await launch({ rafBudget: 0 });
await rig.open("index.html", "seed=90210&cfg_BOOT_METER=0" + (MAW_OFF ? "&sharkmaw=off" : ""));
if (!await rig.wait("window.CBZ && window.THREE && CBZ.game && CBZ.stepSim", 240000)) {
  console.error("no CBZ"); await rig.close(); process.exit(1);
}
await rig.wait("CBZ.game && (CBZ.bootComplete || CBZ.game.state==='title') && document.getElementById('playBtn')", 300000);
await rig.evl(`(()=>{ if (CBZ.CONFIG) CBZ.CONFIG.CITY_HITMAN_CAMPAIGN = false; return 1 })()`);
await rig.wait(`(()=>{ if (CBZ.game.state==='playing') return true; const b=document.getElementById('playBtn'); if(b)b.click(); return CBZ.game.state==='playing'; })()`, 180000);
await rig.evl(`(()=>{ try{ if(CBZ.setQualityLevel) CBZ.setQualityLevel(3); }catch(e){}
                      try{ if(CBZ.dayPhase) CBZ.dayPhase(0.25); }catch(e){}
                      const st=document.createElement("style");
                      st.textContent="body > *{display:none !important}body > #game{display:block !important}";
                      document.head.appendChild(st);
                      window.requestAnimationFrame=function(){return 0;}; return 1 })()`);
await sleep(600);
await rig.evl(`(() => { for (let i=0;i<60;i++) CBZ.stepSim(1/30); return 1 })()`);

const info = await rig.evl(`(() => {
  const T = window.THREE, CBZ = window.CBZ, P = CBZ.player;
  let a = null;
  for (const w of CBZ.cityWildlife || []) if (w && !w.dead && w.species && w.species.id === ${JSON.stringify(SPECIES)}) { a = w; break; }
  /* PUT THE PLAYER — AND THEREFORE THE SHARK, AND THEREFORE THE LENS — IN
     DEEP WATER FIRST. Free play starts in the city, so spawning the animal at
     player+30 puts it on land and drops the camera (which sits below the mouth
     for a prey's-eye angle) UNDER THE TERRAIN. The frame came back solid black
     twice before I noticed the coordinates were a city block, not a sea. Same
     shore bisection tools/megalodon-below-probe.mjs uses. */
  const Z = -300, wf = CBZ.waterField;
  if (wf && wf.shoreAt) {
    let inner = null, outer = null;
    for (let x = 0; x < 16000; x += 40) {
      const sv = wf.shoreAt(x, Z);
      if (sv > 0) inner = x; else if (inner != null) { outer = x; break; }
    }
    if (outer != null) {
      let lo = inner, hi = outer;
      for (let i = 0; i < 26; i++) { const m = (lo + hi) / 2; if (wf.shoreAt(m, Z) > 0) lo = m; else hi = m; }
      let bx = hi + 600, bd = -1;
      for (let off = 300; off < 4000; off += 60) {
        const d = CBZ.cityWaterDepthAt ? CBZ.cityWaterDepthAt(hi + off, Z) : 0;
        if (d > bd) { bd = d; bx = hi + off; }
        if (d >= 60) { bx = hi + off; break; }
      }
      const surf = CBZ.citySeaHeightAt ? CBZ.citySeaHeightAt(bx, Z) : 0;
      P.pos.set(bx, surf - 12, Z);
      if (CBZ.citySwimBegin) CBZ.citySwimBegin({ y: surf - 12 });
      for (let i = 0; i < 30; i++) CBZ.stepSim(1/30);
    }
  }
  if (!a && CBZ.cityWildlifeSpawnAt) a = CBZ.cityWildlifeSpawnAt(${JSON.stringify(SPECIES)}, P.pos.x + 30, P.pos.z + 30);
  if (!a) return { __err: "no animal" };
  for (let t = 0; t < 60 && a.group && !a.group.children.length; t++) { for (let i=0;i<4;i++) CBZ.stepSim(1/30); }
  const g = a.group; if (!g || !g.children.length) return { __err: "no body" };
  window.__mp = { a: a, g: g };

  {
    const surf = CBZ.citySeaHeightAt ? CBZ.citySeaHeightAt(P.pos.x, P.pos.z) : 0;
    a.pos.x = P.pos.x + 26; a.pos.z = P.pos.z; a.pos.y = surf - 14;
    g.position.set(a.pos.x, a.pos.y, a.pos.z);
    a.heading = Math.PI;                       // nose back at the lens
    if (CBZ.faceAnimalHeading) CBZ.faceAnimalHeading(g, a.heading);
    if (a._shark) a._shark.dive = surf - a.pos.y;
  }
  if (CBZ.swimJaw) { try { CBZ.swimJaw(a, 1); } catch (e) {} }
  for (let i=0;i<3;i++) CBZ.stepSim(1/30);

  /* PAINT. One colour per named dark part, cloned so nothing else in the ocean
     that shares a cached material turns pink too. */
  const PALETTE = {
    sharkThroat:        0xff0000,   // red
    sharkBuccalSack:    0x00ff00,   // green
    sharkMandibleLiner: 0x0000ff,   // blue
    sharkHull:          0xffff00,   // yellow
    sharkChin:          0xff00ff,   // magenta
    sharkRostrum:       0x00ffff,   // cyan
  };
  const painted = {};
  g.traverse(function (o) {
    if (!o.isMesh) return;
    if (${JSON.stringify(PLAIN)}) return;
    const c = PALETTE[o.name];
    if (c == null) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const next = mats.map(function (m) {
      const n = m.clone(); if (n.color) n.color.setHex(c); n.fog = false; return n;
    });
    o.material = Array.isArray(o.material) ? next : next[0];
    painted[o.name] = "#" + c.toString(16).padStart(6, "0");
  });

  /* PUT THE LENS WHERE THE PREY IS: just in front of the teeth, on the mouth
     axis, looking back down the throat. That is the owner's photograph. */
  /* THE LENS GOES OUTSIDE THE ANIMAL, IN FRONT OF AND BELOW THE MOUTH — the
     prey's eye. The first cut put it a fraction of a body length in FRONT of
     the box centre and looked backwards, which is a point inside the head: the
     whole frame came back black because we were looking at the inside of a
     back-face-culled hull. Anchor on the mouth hinge the contract publishes,
     stand off by a real multiple of the body length, and look AT it. */
  const M = g.userData && g.userData.aquaticMouth;
  const cam = CBZ.camera;
  g.updateMatrixWorld(true);
  const box = new T.Box3().setFromObject(g);
  const len = Math.max(box.max.x - box.min.x, box.max.z - box.min.z);
  const hinge = M && M.hinge
    ? new T.Vector3(M.hinge.x, M.hinge.y, M.hinge.z).applyMatrix4(g.matrixWorld)
    : box.getCenter(new T.Vector3());
  const nose = new T.Vector3(1, 0, 0).transformDirection(g.matrixWorld).normalize();
  const d = len * ${DIST};
  cam.position.copy(hinge).addScaledVector(nose, d);
  cam.position.y -= d * ${BELOW};
  cam.up.set(0, 1, 0);
  cam.lookAt(hinge);
  cam.updateMatrixWorld(true);
  /* HOLD THE GAPE OPEN AT RENDER TIME. CBZ.swimJaw sets a target the shark's
     own brain zeroes again on any frame it is not committed, so a jaw opened
     and then stepped is a jaw that shuts before the shutter. The mouth
     contract's applyGape is the direct handle. */
  const AM = g._aquaticMouth;
  if (AM && AM.applyGape) { try { AM.applyGape(1); } catch (e) {} }
  g.updateMatrixWorld(true);
  window.__mp.gapeApplied = !!(AM && AM.applyGape);
  window.__mp.camAt = [+cam.position.x.toFixed(1), +cam.position.y.toFixed(1), +cam.position.z.toFixed(1)];
  window.__mp.hinge = [+hinge.x.toFixed(1), +hinge.y.toFixed(1), +hinge.z.toFixed(1)];
  window.__mp.len = +len.toFixed(1);
  CBZ.renderer.render(CBZ.scene, cam);
  return { species: a.species.id, painted: painted, camAt: window.__mp.camAt,
           hingeWorld: window.__mp.hinge, bodyLen: window.__mp.len,
           gapeApplied: window.__mp.gapeApplied };
})()`);

if (!info || info.__err) { console.error("failed: " + (info && info.__err)); await rig.close(); process.exit(1); }
console.log("\npainted:");
for (const k of Object.keys(info.painted)) console.log(`  ${info.painted[k]}  ${k}`);

console.log(`camera ${JSON.stringify(info.camAt)} -> hinge ${JSON.stringify(info.hingeWorld)}  (body ${info.bodyLen} m)`);
console.log("gape applied via contract: " + info.gapeApplied);
/* OPEN THE JAW ON THE LAST LINE BEFORE THE SHUTTER, and open BOTH halves.
   applyGape only drives the upper jaw — its own comment says it "leaves the
   mandible to whoever owns the hinge" — so a shot posed with it alone
   photographs a shark with its chin shut, which is what the first two paint
   runs produced. CBZ.swimJaw owns the hinge; it also early-outs when the
   openness it is handed matches the one it last applied, so jawK is cleared
   first to make the call take. And it goes here, after every stepSim, because
   the shark's own brain re-zeroes the gape on any frame it is not committed. */
await rig.evl(`(()=>{ const M = window.__mp; const a = M && M.a, g = M && M.g;
  if (a && a.swim) a.swim.jawK = -1;
  if (a && CBZ.swimJaw) { try { CBZ.swimJaw(a, 1); } catch(e){} }
  const AM = g && g._aquaticMouth;
  if (AM && AM.applyGape) { try { AM.applyGape(1); } catch(e){} }
  if (g) g.updateMatrixWorld(true);
  CBZ.renderer && CBZ.renderer.render(CBZ.scene, CBZ.camera); return 1 })()`);
await sleep(1800);
const shot = await rig.send("Page.captureScreenshot", { format: "png" });
const data = shot && shot.result && shot.result.data;
if (data) {
  await mkdir(OUT, { recursive: true });
  const f = path.join(OUT, `${TAG}-${info.species}.png`);
  await writeFile(f, Buffer.from(data, "base64"));
  console.log("\n" + f);
}
await rig.close();
