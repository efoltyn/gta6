#!/usr/bin/env node
/* tools/fire/perf.mjs — what the fire engines cost, on the real GPU.

     node tools/fire/perf.mjs [--lanes webgl,webgpu,webgpu-off] [--out file.json]

   Per lane: one boot of disaster.html (one Chrome at a time, killed between
   lanes), the frozen-clock staging of tools/fire/shot.mjs, then at each
   scene (an eruption at t+8 s seen from the flank, a wildfire at t+10 s):
     tick   CBZ.stepSim(1/60) averaged over 120 ticks (the whole game sim,
            plus the engines' CPU side: emission staging, compute submits)
     frame  render + GPU, SYNCED: WebGPU awaits queue.onSubmittedWorkDone()
            after each render, WebGL reads one pixel back (gl.finish), so the
            number is the GPU's real cost of the frame, not the CPU submit
   webgpu-off = the WebGPU renderer with ?cfg_GPU_PARTICLES=0&cfg_CLUSTER_LIGHTS=0
   (the engines' own cost, though that lane also draws less). */
import { launch, sleep } from "../lib/cdp.mjs";
import { writeFileSync } from "node:fs";

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf("--" + k); return i >= 0 ? argv[i + 1] : d; };
const lanes = arg("lanes", "webgl,webgpu,webgpu-off").split(",");
const out = {};
for (const lane of lanes) {
  const gpu = lane === "webgl" ? "webgl" : "webgpu";
  const q = "gpu=" + gpu + (lane === "webgpu-off" ? "&cfg_GPU_PARTICLES=0&cfg_CLUSTER_LIGHTS=0" : "");
  const rig = await launch({ gpu: "real", rafBudget: 0, window: "1280,800" });
  try {
    await rig.open("disaster.html", q);
    if (!(await rig.wait(`window.CBZ && CBZ.game && CBZ.stepSim && document.getElementById("playBtn")`, 400000, 500))) throw new Error("never booted");
    if (!(await rig.wait(`(function(){ if (CBZ.game.state === "playing" && CBZ.surv && CBZ.surv.arena) return true;
      const b = document.getElementById("playBtn"); if (b) b.click(); return false; })()`, 300000, 700))) throw new Error("never reached the island");
    if (gpu === "webgpu") await rig.evl(`CBZ.renderer.cbzReady`, true);
    const res = await rig.evl(`(async function(){
      try { CBZ.setQualityLevel && CBZ.setQualityLevel(3); } catch (e) {}
      window.requestAnimationFrame = function () { return 0; };
      const R = CBZ.renderer, cam = CBZ.camera;
      const step = (s) => { for (let i = 0; i < Math.round(s * 60); i++) { CBZ.hitstop = 0; CBZ.slowmo = 0; CBZ.stepSim(1 / 60);
        if (CBZ.player) { CBZ.player.hp = 100; CBZ.player.dead = false; } if (CBZ.game.state !== "playing") CBZ.game.state = "playing"; } };
      let gl = null; try { gl = R.getContext && R.isWebGLRenderer ? R.getContext() : null; } catch (e) {}
      const px = new Uint8Array(4);
      async function sync() {
        if (R.isWebGPURenderer && R.backend && R.backend.device) await R.backend.device.queue.onSubmittedWorkDone();
        else if (gl) gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      }
      async function measure(tag) {
        let t0 = performance.now(); step(2); const tick = (performance.now() - t0) / 120;
        for (let i = 0; i < 5; i++) { R.render(CBZ.scene, cam); await sync(); }
        const fr = [];
        for (let i = 0; i < 30; i++) { const a = performance.now(); R.render(CBZ.scene, cam); await sync(); fr.push(performance.now() - a); }
        fr.sort((a, b) => a - b);
        const info = R.info && R.info.render ? R.info.render : {};
        return { tag, tickMs: +tick.toFixed(2), frameMs: +(fr.reduce((a, b) => a + b, 0) / fr.length).toFixed(2), frameP50: +fr[15].toFixed(2), frameP90: +fr[27].toFixed(2),
          calls: info.calls != null ? info.calls : info.drawCalls,
          gpu: CBZ.gpuParticles && CBZ.gpuParticles.on ? CBZ.gpuParticles.stats() : null,
          lights: CBZ.clusterLights ? CBZ.clusterLights.stats() : null };
      }
      function aim(px_, py_, pz_, ax, ay, az) { cam.fov = 62; cam.aspect = innerWidth / innerHeight; cam.updateProjectionMatrix();
        cam.position.set(px_, py_, pz_); cam.lookAt(ax, ay, az); cam.updateMatrixWorld(true);
        try { if (CBZ.skyDome && CBZ.skyDome.parent) CBZ.skyDome.parent.position.set(px_, 0, pz_); } catch (e) {} }
      const out = [];
      step(1.5);
      window.__volcanoMagPin = 0.7;
      CBZ.disasters.force("volcano"); step(0.1);
      let g = 400; while (g-- > 0 && CBZ.disasters.state() !== "active") step(0.1);
      step(6);
      const E = CBZ.eruption.last, S = E.site, gAt = CBZ.surv.arena.groundHeightAt, a = E.collapseBearing + 0.85;
      const tx = S.x + Math.cos(a) * S.r * 1.9, tz = S.z + Math.sin(a) * S.r * 1.9;
      aim(tx, Math.max(gAt(tx, tz), 0.5) + 16, tz, S.x + Math.cos(E.collapseBearing) * S.r * 0.45, S.peak * 0.6, S.z + Math.sin(E.collapseBearing) * S.r * 0.45);
      out.push(await measure("volcano t+8"));
      CBZ.disasters.force("wildfire"); step(0.1);
      g = 400; while (g-- > 0 && CBZ.disasters.state() !== "active") step(0.1);
      step(8);
      const hz = CBZ.wildfire.hazards(64); let sx = 0, sz = 0, sw = 0; for (const h of hz) { sx += h.x * h.r; sz += h.z * h.r; sw += h.r; }
      const f = sw ? { x: sx / sw, z: sz / sw } : { x: 0, z: 600 };
      aim(f.x + 30, gAt(f.x + 30, f.z + 24) + 14, f.z + 24, f.x, gAt(f.x, f.z) + 4, f.z);
      out.push(await measure("wildfire t+10"));
      return { backend: R.cbzBackend || "webgl", scenes: out };
    })()`, true);
    out[lane] = res;
    console.log(lane, JSON.stringify(res));
  } catch (e) { console.error(lane, "FAILED", e.message); out[lane] = { error: e.message }; }
  finally { await rig.close(); }
  await sleep(1500);
}
if (arg("out")) writeFileSync(arg("out"), JSON.stringify(out, null, 1));
