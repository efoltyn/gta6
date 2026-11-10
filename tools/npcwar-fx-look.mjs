#!/usr/bin/env node
/* tools/npcwar-fx-look.mjs — one close look at a burning wreck and a crater.
     node tools/npcwar-fx-look.mjs --out <dir> [--roster "a=...&b=..."] */
import { launch, sleep } from "./lib/cdp.mjs";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const OUT = arg("--out", "/tmp/npcwar-fx-look");
const ROSTER = arg("--roster", "a=m1_abrams*4,m142_himars*2,men*30&b=m1_abrams*4,men*60&arena=dunes");
mkdirSync(OUT, { recursive: true });
const rig = await launch({ rafBudget: 0 });
let n = 0;
async function shot(tag) {
  await rig.evl("__battle.render()");
  const png = await rig.send("Page.captureScreenshot", { format: "jpeg", quality: 80 });
  writeFileSync(path.join(OUT, `${String(n++).padStart(2, "0")}-${tag}.jpg`), Buffer.from(png.result.data, "base64"));
}
const look = async (x, y, z, yaw, pitch, dist) => { await rig.evl(`(() => { cam.mode = "free"; cam.wFocus.set(${x}, ${y}, ${z}); cam.wYaw = ${yaw}; cam.wPitch = ${pitch}; cam.wDist = ${dist}; cam.snap = true; })()`, false); await rig.evl("__battle.advance(0.03, 1/60)"); };
try {
  await rig.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  await rig.open("games/battle.html", `auto=1&probe=0&slowmo=0&${ROSTER}`);
  await sleep(500);
  if (!(await rig.wait("window.__battle && __battle.audit().started", 240000, 400))) { console.log("never started", rig.errors.slice(0, 3)); process.exit(1); }
  await rig.evl("__battle.freeze()");
  let w = null, c = null;
  for (let k = 0; k < 90 && !(w && c && c[2] > 3); k++) {
    await rig.evl("__battle.advance(2, 1/30)");
    w = await rig.evl(`(() => { const u = men.find(m => m.vehicle && m.dead && m.burnT > 10 && !m.air); return u ? [u.pos.x, u.pos.y, u.pos.z, u.vlen || 6] : null; })()`, false);
    c = await rig.evl(`(() => { const a = CBZ.battleGround.craters(); let b = null; a.forEach(q => { if (!b || q.r > b.r) b = q; }); return b ? [b.x, b.z, b.r, MAP.groundAt(b.x, b.z)] : null; })()`, false);
  }
  console.log("wreck", JSON.stringify(w), "crater", JSON.stringify(c));
  if (w) {
    for (const [tag, d, p, t] of [["wreck-near", 18, 0.14, 2], ["wreck-mid", 45, 0.1, 6], ["wreck-far", 90, 0.08, 8]]) {
      await look(w[0], w[1] + 3, w[2], 0.8, p, d);
      if (t) await rig.evl(`__battle.advance(${t}, 1/30)`);
      await shot(tag);
    }
  }
  if (c) {
    await rig.evl("__battle.advance(14, 1/30)");      // let the dust settle: this is the hole, not the blast
    await look(c[0], c[3], c[1], 0.6, 0.5, Math.max(8, c[2] * 4)); await shot("crater");
    await look(c[0], c[3], c[1], 2.4, 0.16, Math.max(8, c[2] * 4)); await shot("crater-low");
    await look(c[0], c[3], c[1], 2.4, 1.2, Math.max(8, c[2] * 6)); await shot("crater-top");
    await look(c[0], c[3] + 1, c[1], 4.0, 0.3, 70); await shot("crater-wide");
  }
  console.log("errors", JSON.stringify(rig.errors.slice(0, 5)));
} finally { await rig.close(); }
