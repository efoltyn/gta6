#!/usr/bin/env node
/* tools/shark-water-shots.mjs — THE PICTURE, BOTH WAYS.

   The clarity gain in world/water_underwater.js is a number, and a number is
   not what the owner asked about ("rn I see like 5 feet ahead of me"). So this
   photographs the SAME frame twice out of ONE build: once with
   ?cfg_WATER_SIGHT_GAIN=0 (the pure Jerlov water this game shipped with, level
   ~33 m) and once at the default 1 (~100 m). Same seed, same island, same
   staged dive, same lens — the only thing that differs is the medium.

   No worktree and no second server: the flag IS the before/after, which is
   the point of building the concession as a dial instead of an edit.

     node tools/shark-water-shots.mjs
     node tools/shark-water-shots.mjs --seed 90210 --out artifacts/shark-water
*/
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { launch, ROOT } from "./lib/cdp.mjs";

const argv = process.argv.slice(2);
const arg = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d; };
const SEED = arg("--seed", "90210");
const OUT = path.isAbsolute(arg("--out", "")) ? arg("--out", "")
  : path.join(ROOT, arg("--out", "artifacts/shark-water"));

/* THE STAGING IS IDENTICAL ON BOTH SIDES OR THE PAIR IS WORTHLESS. The ride is
   stood in the deepest water on its own bearing, dives on its own DIVE key
   until the CAMERA reports the wanted depth (world/water_underwater.js's own
   seam, not a guess), and the sea is given the same number of game seconds to
   stock itself — so what differs between the two frames is the water and
   nothing else. Math.random is seeded here for the same reason. */
const DRIVER = `window.__WS = (() => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  Math.random = (function (s) { return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; })(20260830);
  const S = {
    step(n) { for (let i = 0; i < n; i++) CBZ.stepSim(1 / 30); },
    sec(s) { S.step(Math.max(1, Math.round(s * 30))); },
    async boot() {
      for (let t = 0; t < 500 && !(CBZ.game.state === "playing" && CBZ.game.mode === "sharksim"); t++) {
        const mb = document.querySelector('.mode-btn[data-mode="sharksim"]'); if (mb) mb.click();
        const pb = document.getElementById("playBtn"); if (pb) pb.click();
        await sleep(140);
      }
      if (CBZ.game.state !== "playing") return "never played";
      for (let t = 0; t < 90 && !(CBZ.sharkSim && CBZ.sharkSim.on && CBZ.sharkSim.shark); t++) { S.step(15); await sleep(20); }
      if (!CBZ.sharkSim.shark) return "never armed";
      S._raf = window.requestAnimationFrame;
      window.requestAnimationFrame = function () { return 0; };
      await new Promise((res) => S._raf.call(window, () => res()));
      return "";
    },
    offshore(want) {
      const A = CBZ.surv.arena, P = CBZ.player;
      const ang = 0.7, wl = (CBZ.sharkSim && CBZ.sharkSim.waterline) || A.radius;
      let best = null, bestD = -1;
      for (let r = wl + 30; r < wl + 900; r += 8) {
        const x = A.center.x + Math.cos(ang) * r, z = A.center.z + Math.sin(ang) * r;
        const d = CBZ.survFloodDepthMeanAt ? CBZ.survFloodDepthMeanAt(x, z) : 0;
        if (d > bestD) { bestD = d; best = { x: x, z: z }; }
        if (d >= want) { P.pos.x = x; P.pos.z = z; S.step(4); return d; }
      }
      if (best) { P.pos.x = best.x; P.pos.z = best.z; S.step(6); }
      return bestD;
    },
    diveTo(m) {
      const k = CBZ.keys;
      k.control = true; k.w = true;
      for (let i = 0; i < 26 * 30; i++) { S.step(1); if ((CBZ.cityCameraDepth ? CBZ.cityCameraDepth() : 0) >= m) break; }
      k.control = false; k.w = false;
      S.step(3);
      return +(CBZ.cityCameraDepth ? CBZ.cityCameraDepth() : 0).toFixed(2);
    },
    // level the lens: the complaint is about looking STRAIGHT AHEAD
    aim() {
      const cam = CBZ.camera; if (!cam) return 0;
      cam.rotation.x = 0; cam.updateMatrixWorld(true);
      CBZ.renderer.render(CBZ.scene, CBZ.camera);
      return 1;
    },
    read() {
      const f = CBZ.scene && CBZ.scene.fog, ws = CBZ.waterSight;
      const me = CBZ.sharkSim.shark, list = CBZ.cityWildlife || [];
      let inSight = 0, teeth = 0;
      for (const a of list) {
        if (!a || a.dead || a === me || !a.species || !a.species.aquatic) continue;
        const dx = a.pos.x - me.pos.x, dy = a.pos.y - me.pos.y, dz = a.pos.z - me.pos.z;
        const d = Math.hypot(dx, dy, dz) || 1;
        if (d <= ws.rangeAt(dy / d)) { inSight++; if ((a.species.bite || 0) > 0) teeth++; }
      }
      return {
        gain: CBZ.CONFIG.WATER_SIGHT_GAIN,
        level: +ws.rangeAt(0).toFixed(1), up: +ws.rangeAt(1).toFixed(1), down: +ws.rangeAt(-1).toFixed(1),
        fogNear: +f.near.toFixed(1), fogFar: +f.far.toFixed(1),
        c: +ws.c.toFixed(4), kd: +ws.kd.toFixed(4),
        depth: +(CBZ.cityCameraDepth ? CBZ.cityCameraDepth() : 0).toFixed(1),
        seaBodies: list.filter(function (a) { return a && !a.dead && a.species && a.species.aquatic; }).length,
        inSight: inSight, sharksInSight: teeth,
      };
    },
  };
  return S;
})();`;

mkdirSync(OUT, { recursive: true });
const rows = [];
for (const [tag, gain] of [["before-gain0", "0"], ["after-gain1", "1"]]) {
  const rig = await launch({ rafBudget: 0 });
  try {
    await rig.open("index.html",
      `mode=sharksim&seed=${SEED}&bots=24&cfg_BOOT_METER=0&cfg_WATER_SIGHT_GAIN=${gain}`);
    if (!await rig.wait("window.CBZ && CBZ.stepSim && document.getElementById('playBtn')", 120000)) {
      throw new Error("page never became ready");
    }
    await rig.evl(DRIVER);
    const why = await rig.evl("__WS.boot()", true);
    if (why) throw new Error(why);
    const col = await rig.evl("__WS.offshore(40)", true);
    await rig.evl("__WS.sec(40)", true);        // let the sea stock itself
    const eye = await rig.evl("__WS.diveTo(14)", true);
    await rig.evl("__WS.sec(2); __WS.aim()", true);
    const r = await rig.evl("JSON.stringify(__WS.read())", true).then(JSON.parse);
    r.tag = tag; r.columnM = +(+col).toFixed(1); r.eyeM = eye;
    rows.push(r);
    const png = await rig.send("Page.captureScreenshot", { format: "png" });
    const f = path.join(OUT, tag + ".png");
    writeFileSync(f, Buffer.from((png.result || png).data, "base64"));
    console.log(`${tag}: level ${r.level} m · up ${r.up} m · down ${r.down} m · ` +
      `fog ${r.fogNear}–${r.fogFar} · c ${r.c} · eye ${r.depth} m in ${r.columnM} m · ` +
      `${r.inSight}/${r.seaBodies} sea bodies in sight (${r.sharksInSight} with teeth) → ${f}`);
  } finally { await rig.close(); }
}
writeFileSync(path.join(OUT, "readings.json"), JSON.stringify(rows, null, 2));
console.log("readings → " + path.join(OUT, "readings.json"));
