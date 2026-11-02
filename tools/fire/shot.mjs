#!/usr/bin/env node
/* tools/fire/shot.mjs — photograph fire, smoke, ash and the volcano on the
   REAL GPU, in either renderer, from one frozen, seeded sim.

     node tools/fire/shot.mjs --out ~/harness/out/gta6/r187-fire/before [--gpu webgl|webgpu]
          [--beats slope-warn,slope-active,...] [--page disaster.html] [--size 1280,800]

   disaster.html opens on the island (index.html builds the city around it:
   see the volcano-real memory). The page boots, the rAF loop is frozen,
   CBZ.stepSim(1/60) is the only clock, the director is forced onto the
   disaster each beat names, and the camera stands on a tripod placed off the
   volcano's own site (CBZ.eruption.site), so the frames land on the same
   simulated seconds whichever renderer is on and however slow the box is.

   --gpu webgpu loads ?gpu=webgpu (THREE.createRenderer -> WebGPURenderer;
   Chrome here is started with --enable-unsafe-webgpu on ANGLE/Dawn Metal,
   so it is the real WebGPU backend, not the WebGL2 fallback: the run prints
   renderer.cbzBackend to prove it).

   Per beat it writes <beat>.png and a line of numbers (draw calls, the
   particle engine's live count, the clustered light count, ms per sim tick,
   ms per rendered frame) to shots.json. ONE Chrome, killed at the end. */
import { launch, sleep } from "../lib/cdp.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf("--" + k); return i >= 0 ? argv[i + 1] : d; };
const OUT = path.resolve((arg("out", path.join(os.homedir(), "harness/out/gta6/r187-fire/shots"))).replace(/^~/, os.homedir()));
const GPU = arg("gpu", "webgl");
const PAGE = arg("page", "disaster.html");
const SIZE = arg("size", "1280,800");
const SEED = arg("seed", "4242");

/* A beat: which disaster, how long into it, where the tripod stands.
   cam.az is the bearing (rad) round the vent measured FROM the collapse lane
   when lane:true (so "the slope the rocks come down" is always in frame),
   dist in vent radii, alt metres over the ground there, look = where on the
   mountain the lens points (0 = vent, 1 = foot of the cone). */
const BEATS = {
  "slope-warn":   { label: "warning: rockfall down the lane", force: "volcano", state: "warn", extra: 4.5, mag: 0.6,
    cam: { lane: true, az: 1.15, dist: 1.25, alt: 10, look: 0.45, lookY: 0.35, fov: 62 } },
  "slope-active": { label: "eruption t+6 s: the flank", force: "volcano", state: "active", extra: 6, mag: 0.6,
    cam: { lane: true, az: 0.9, dist: 1.35, alt: 14, look: 0.4, lookY: 0.4, fov: 62 } },
  "slope-pyro":   { label: "density current on the flank", force: "volcano", state: "active", extra: 9, mag: 1.0,
    cam: { lane: true, az: 0.75, dist: 1.6, alt: 22, look: 0.6, lookY: 0.25, fov: 64 } },
  "column":       { label: "the column, wide", force: "volcano", state: "active", extra: 9, mag: 0.6,
    cam: { lane: true, az: 2.3, dist: 3.4, alt: 20, look: 0, lookY: 1.6, fov: 64 } },
  "night-flank":  { label: "night: the flank lit by its own fire", force: "volcano", state: "active", extra: 8, mag: 0.6, night: true,
    cam: { lane: true, az: 0.9, dist: 1.5, alt: 14, look: 0.35, lookY: 0.5, fov: 64 } },
  "flank-film":   { label: "the flank, every 0.75 s from the blast", force: "volcano", state: "active", extra: 1, mag: 0.7, strip: { n: 10, step: 0.75 },
    cam: { lane: true, az: 0.85, dist: 1.9, alt: 16, look: 0.45, lookY: 0.3, fov: 50 } },
  "warn-film":    { label: "the warning's rockfall, every 0.6 s", force: "volcano", state: "warn", extra: 2, mag: 0.7, strip: { n: 6, step: 0.6 },
    cam: { lane: true, az: 0.9, dist: 1.7, alt: 12, look: 0.5, lookY: 0.2, fov: 46 } },
  "close-warn":   { label: "on the flank beside the lane: the warning", force: "volcano", state: "warn", extra: 2, mag: 0.7, strip: { n: 6, step: 0.5 },
    cam: { lane: true, az: 0.45, dist: 0.8, alt: 3, look: 0.3, lookY: 0.1, fov: 60 } },
  "close-active": { label: "on the flank beside the lane: the eruption", force: "volcano", state: "active", extra: 2, mag: 0.7, strip: { n: 8, step: 0.6 },
    cam: { lane: true, az: 0.45, dist: 0.8, alt: 3, look: 0.3, lookY: 0.1, fov: 60 } },
  "rocks-close":  { label: "the blast's rock coming down the cone, close", force: "volcano", state: "active", extra: 2.2, mag: 0.8, strip: { n: 4, step: 0.7 },
    cam: { lane: true, az: 0.0, dist: 1.25, alt: 7, look: 0.45, lookY: 0.25, fov: 48 } },
  "wildfire":     { label: "wildfire front", force: "wildfire", state: "active", extra: 10,
    cam: { fire: true, dist: 34, alt: 12, fov: 64 } },
  "wildfire-night": { label: "wildfire at night: the ground lit by the fire", force: "wildfire", state: "active", extra: 10, night: true,
    cam: { fire: true, dist: 34, alt: 12, fov: 64 } },
};
const beats = (arg("beats", "slope-warn,slope-active,slope-pyro,column,night-flank")).split(",").filter(Boolean);
for (const b of beats) if (!BEATS[b]) { console.error("unknown beat " + b + "; known: " + Object.keys(BEATS).join(", ")); process.exit(2); }
mkdirSync(OUT, { recursive: true });

const [W, H] = SIZE.split(",").map(Number);
const rig = await launch({ gpu: "real", rafBudget: 0, window: `${W},${H}` });
const shots = [];
const done = async (code) => { try { await rig.close(); } catch (_) {} process.exit(code); };
process.on("SIGINT", () => done(130));
try {
  const q = `seed=${SEED}` + (GPU === "webgpu" ? "&gpu=webgpu" : "&gpu=webgl");
  await rig.open(PAGE, q);
  const booted = await rig.wait(`window.CBZ && CBZ.game && CBZ.stepSim && document.getElementById("playBtn")`, 400000, 500);
  if (!booted) throw new Error("never booted");
  const playing = await rig.wait(`(function(){ if (CBZ.game.state === "playing" && CBZ.surv && CBZ.surv.arena) return true;
    const s = document.querySelector('[data-mode="survival"]'); if (s && CBZ.game.mode !== "survival") s.click();
    const b = document.getElementById("playBtn"); if (b) b.click(); return false; })()`, 300000, 700);
  if (!playing) throw new Error("never reached the island");
  if (GPU === "webgpu") await rig.evl(`CBZ.renderer.cbzReady`, true);
  const backend = await rig.evl(`CBZ.renderer.cbzBackend || (CBZ.renderer.isWebGPURenderer ? "webgpu?" : "webgl")`);
  console.log("backend:", backend);
  await rig.evl(`(function(){
    try { CBZ.setQualityLevel && CBZ.setQualityLevel(3); } catch (e) {}
    window.requestAnimationFrame = function () { return 0; };
    const canvas = CBZ.renderer.domElement;
    for (const c of Array.from(document.body.children)) if (!(c === canvas || (c.contains && c.contains(canvas)))) c.style.visibility = "hidden";
    window.__fire = {
      step(secs) { const n = Math.max(0, Math.round(secs * 60)); let ms = 0;
        for (let i = 0; i < n; i++) { CBZ.hitstop = 0; CBZ.slowmo = 0; const t0 = performance.now(); CBZ.stepSim(1 / 60); ms += performance.now() - t0;
          if (CBZ.player) { CBZ.player.hp = 100; CBZ.player.dead = false; }
          if (CBZ.game.state !== "playing") CBZ.game.state = "playing"; }
        return n ? ms / n : 0; },
    };
    return true; })()`);
  await sleep(500);
  await rig.evl(`__fire.step(1.5)`);

  for (const id of beats) {
    const B = BEATS[id];
    const t0 = Date.now();
    // STAGE: force the event, run it to the beat's second, stand the tripod
    const staged = await rig.evl(`(function(B){
      const F = window.__fire, D = CBZ.disasters;
      window.__volcanoMagPin = B.mag != null ? B.mag : 0.6;
      if (CBZ.dayPhase) CBZ.dayPhase(B.night ? 0.93 : 0.42);
      D.force(B.force); F.step(0.1);
      let g = 400; while (g-- > 0 && D.state() !== B.state) F.step(0.1);
      const tick = F.step(B.extra);
      if (B.night && CBZ.dayPhase) { CBZ.dayPhase(0.93); F.step(2); }
      const ar = CBZ.surv.arena, S = CBZ.eruption ? CBZ.eruption.site(ar) : null, gAt = ar.groundHeightAt;
      const c = B.cam; let px, py, pz, ax, ay, az;
      if (c.fire) {
        // the fire's centre of mass, framed from downwind-side so the smoke leans across
        const hz = CBZ.wildfire && CBZ.wildfire.hazards ? CBZ.wildfire.hazards(64) : [];
        let sx = 0, sz = 0, sw = 0;
        for (const h of hz) { sx += h.x * h.r; sz += h.z * h.r; sw += h.r; }
        const seed = CBZ.wildfire && CBZ.wildfire.seedPos ? CBZ.wildfire.seedPos() : null;
        const f = sw > 0 ? { x: sx / sw, z: sz / sw } : (seed || { x: ar.center ? ar.center.x : 0, z: ar.center ? ar.center.z : 600 });
        const w = CBZ.wildfire && CBZ.wildfire.wind ? CBZ.wildfire.wind() : { x: 1, z: 0 };
        ax = f.x; az = f.z; ay = gAt(ax, az) + 4;
        px = ax - w.z * c.dist - w.x * c.dist * 0.4; pz = az + w.x * c.dist - w.z * c.dist * 0.4; py = Math.max(gAt(px, pz), 0.5) + c.alt;
      } else {
        let base = 0;
        // the collapse lane's bearing: the slope the warning's rockfall and the density current come down
        const E = CBZ.eruption && CBZ.eruption.last;
        if (c.lane && E && E.collapseBearing != null) base = E.collapseBearing;
        const a = base + (c.az || 0), R = S.r;
        ax = S.x + Math.cos(base) * R * c.look; az = S.z + Math.sin(base) * R * c.look;
        ay = gAt(ax, az) + (c.lookY || 0) * S.peak * 0.5;
        px = S.x + Math.cos(a) * R * c.dist; pz = S.z + Math.sin(a) * R * c.dist; py = Math.max(gAt(px, pz), 0.5) + c.alt;
      }
      F.tripod = { px, py, pz, ax, ay, az, fov: c.fov || 62 };
      return { tick: +tick.toFixed(2), site: S ? [S.x, S.peak, S.z, S.r].map((v) => +(+v).toFixed(1)) : null };
    })(${JSON.stringify(B)})`);
    // SHOOT: one frame, or a film strip on the same tripod
    const frames = B.strip ? B.strip.n : 1;
    for (let k = 0; k < frames; k++) {
      if (k > 0) await rig.evl(`__fire.step(${B.strip.step})`);
      const res = await rig.evl(`(function(){
        const T = __fire.tripod, cam = CBZ.camera, R = CBZ.renderer;
        // (a HUD toast can appear mid-run: hide everything but the canvas again)
        const cv = R.domElement;
        for (const el of Array.from(document.body.children)) if (!(el === cv || (el.contains && el.contains(cv)))) el.style.visibility = "hidden";
        cam.fov = T.fov; cam.aspect = innerWidth / innerHeight; cam.updateProjectionMatrix();
        cam.position.set(T.px, T.py, T.pz); cam.lookAt(T.ax, T.ay, T.az); cam.updateMatrixWorld(true);
        try { if (CBZ.skyDome && CBZ.skyDome.parent) CBZ.skyDome.parent.position.set(T.px, 0, T.pz); } catch (e) {}
        try { CBZ.skySync && CBZ.skySync(); } catch (e) {}
        let fr = 0;
        for (let i = 0; i < 3; i++) { const t1 = performance.now(); R.render(CBZ.scene, cam); fr = performance.now() - t1; }
        const info = R.info || {}, rr = info.render || {};
        const P = CBZ.gpuParticles ? CBZ.gpuParticles.stats() : null;
        const L = CBZ.clusterLights ? CBZ.clusterLights.stats() : null;
        return { ok: true, state: CBZ.disasters.state(), frameMs: +fr.toFixed(2), calls: rr.calls != null ? rr.calls : rr.drawCalls,
          tris: rr.triangles, particles: P, lights: L, cam: [T.px, T.py, T.pz].map((v) => +v.toFixed(1)) };
      })()`);
      await sleep(250);
      const shot = await rig.send("Page.captureScreenshot", { format: "png" });
      const file = path.join(OUT, frames > 1 ? `${id}-${k}.png` : `${id}.png`);
      if (shot.result && shot.result.data) writeFileSync(file, Buffer.from(shot.result.data, "base64"));
      shots.push(Object.assign({ id, frame: k, label: B.label, gpu: GPU, backend, file, wallS: (Date.now() - t0) / 1000 }, staged || {}, res || {}));
      console.log(id + (frames > 1 ? "-" + k : ""), JSON.stringify(Object.assign({}, staged, res)), file);
    }
  }
  writeFileSync(path.join(OUT, "shots.json"), JSON.stringify({ gpu: GPU, backend, page: PAGE, errors: rig.errors.slice(0, 40), shots }, null, 1));
  if (rig.errors.length) console.log("page errors (" + rig.errors.length + "):\n  " + rig.errors.slice(0, 12).join("\n  "));
  await done(0);
} catch (e) {
  console.error("FAILED:", e && e.message);
  console.error(rig.errors.slice(0, 12).join("\n"));
  await done(1);
}
