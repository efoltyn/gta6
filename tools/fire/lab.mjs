#!/usr/bin/env node
/* tools/fire/lab.mjs — drive tools/fire/lab.html on the real GPU, headless.

     node tools/fire/lab.mjs [--scene all|volcano|fire|lights] [--night] [--secs 6]
          [--cam x,y,z,ax,ay,az[,fov]] [--out dir] [--gpu webgpu|webgl] [--frames n,stepSec]

   Boots the engines alone (a second, not the game's minutes), steps the
   frozen clock, poses the camera, renders and screenshots. Prints the
   engine's stats and every console error (TSL build errors land there). */
import { launch, sleep } from "../lib/cdp.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf("--" + k); return i >= 0 ? argv[i + 1] : d; };
const has = (k) => argv.includes("--" + k);
const scene = arg("scene", "all");
const OUT = path.resolve(arg("out", path.join(os.homedir(), "harness/out/gta6/r187-fire/lab")).replace(/^~/, os.homedir()));
const secs = +arg("secs", 6);
const cams = (arg("cam", "150,40,150,0,25,0")).split(";").map((c) => c.split(",").map(Number));
const frames = (arg("frames", "1,0")).split(",").map(Number);
const gpu = arg("gpu", "webgpu");
mkdirSync(OUT, { recursive: true });
const rig = await launch({ gpu: "real", rafBudget: 0, window: arg("size", "1280,800") });
try {
  await rig.open("tools/fire/lab.html", `gpu=${gpu}&scene=${scene}&freeze=1${has("night") ? "&night=1" : ""}${has("nocluster") ? "&cluster=0" : ""}`);
  const ok = await rig.wait("window.__lab && __lab.ready", 60000, 200);
  if (!ok) throw new Error("lab never ready: " + JSON.stringify(rig.errors.slice(0, 10)));
  await rig.evl(`__lab.freeze()`);
  const t0 = Date.now();
  await rig.evl(`__lab.step(${Math.round(secs * 60)})`);
  console.log("stepped", secs, "s in", Date.now() - t0, "ms");
  let k = 0;
  for (let f = 0; f < frames[0]; f++) {
    if (f) await rig.evl(`__lab.step(${Math.round(frames[1] * 60)})`);
    for (const c of cams) {
      const ms = await rig.evl(`(function(){ __lab.cam(${c.join(",")}); __lab.render(); __lab.render(); return __lab.render(); })()`);
      await sleep(200);
      const shot = await rig.send("Page.captureScreenshot", { format: "png" });
      const file = path.join(OUT, `${scene}${has("night") ? "-night" : ""}-${k++}.png`);
      writeFileSync(file, Buffer.from(shot.result.data, "base64"));
      console.log(file, "render", (+ms).toFixed(1), "ms");
    }
  }
  // a timing: frames per second of step+render, warm
  const perf = await rig.evl(`(function(){ const t0 = performance.now(); let n = 0; while (performance.now() - t0 < 1500) { __lab.step(1); __lab.render(); n++; } return { fps: n / ((performance.now() - t0) / 1000) }; })()`);
  const st = await rig.evl(`__lab.stats()`);
  console.log(JSON.stringify(Object.assign({ perf }, st), null, 1));
  if (rig.errors.length) console.log("page errors:\n  " + rig.errors.slice(0, 15).join("\n  "));
} catch (e) {
  console.error("FAILED", e.message);
  console.error(rig.errors.slice(0, 15).join("\n"));
} finally { await rig.close(); }
