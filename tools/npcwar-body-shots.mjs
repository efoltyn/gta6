#!/usr/bin/env node
/* tools/npcwar-body-shots.mjs — CLOSE-UPS OF THE BODIES ON THE GROUND.

   Runs a rifle fight, then puts a low lens beside the dead, the prone and the
   wounded in turn and takes a frame of each, with the gap between each
   body's origin and the ground under it. For looking at whether a man lies
   ON the ground: the companion to tools/npcwar-ground-contact.mjs, which
   measures it.

     node tools/npcwar-body-shots.mjs --out <dir> [--secs 110] [--q "a=men*40&b=men*40&arena=dunes"] */
import { launch } from "./lib/cdp.mjs";
import { writeFileSync, mkdirSync } from "node:fs";
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const OUT = arg("--out", "/tmp/npcwar-body-shots"), SECS = +arg("--secs", 110), Q = arg("--q", "a=men*40&b=men*40&arena=dunes");
mkdirSync(OUT, { recursive: true });
const rig = await launch({ rafBudget: 0 });
try {
  await rig.send("Emulation.setDeviceMetricsOverride", { width: 960, height: 540, deviceScaleFactor: 1, mobile: false });
  await rig.open("games/battle.html", `auto=1&probe=1&feel=0&${Q}`);
  await rig.wait("window.__battle && __battle.audit().started", 240000, 400);
  await rig.evl("__battle.freeze()");
  await rig.evl(`__battle.advance(${SECS}, 1/60)`);
  // the end card, if the war ended, is not what this is a picture of
  await rig.evl("(() => { const e = document.getElementById('end'); if (e) e.style.display = 'none'; document.body.classList.remove('over'); })()");
  let n = 0;
  const WHO = { dead: "m.dead", prone: "!m.dead&&!m.downed&&m.stance==='prone'", down: "!m.dead&&m.downed", melee: "!m.dead&&m._cqbT>0" };
  for (const sel of (arg("--who", "dead,dead,dead,dead,dead,dead,prone,prone,down,down")).split(",")) {
    const r = await rig.evl(`(() => { window._seen = window._seen || new Set();
      const L = men.concat(corpses.filter(c => men.indexOf(c) < 0)).filter(m => !m.vehicle && !m.beast && m.group && m.group.visible && !_seen.has(m) && (${WHO[sel]}));
      const m = L[0]; if (!m) return null; _seen.add(m); setCamMode('free');
      const gx = m.group.position.x, gz = m.group.position.z;
      cam.wFocus.set(gx, MAP.groundAt(gx, gz) - 0.9, gz); cam.wDist = 4.2; cam.wPitch = 0.16; cam.wYaw = (m.group.rotation.y || 0) + 1.6; cam.snap = true;
      __battle.advance(0.001, 1/60);
      return { ragdoll: !!m.ragdoll, originOverGround: +(m.group.position.y - MAP.groundAt(gx, gz)).toFixed(2) }; })()`, false);
    if (!r) continue;
    await rig.evl("__battle.render()");
    const p = await rig.send("Page.captureScreenshot", { format: "jpeg", quality: 82 });
    writeFileSync(`${OUT}/${String(n++).padStart(2, "0")}-${sel}.jpg`, Buffer.from(p.result.data, "base64"));
    console.log(sel, JSON.stringify(r));
  }
  console.log("errors", JSON.stringify(rig.errors.slice(0, 3)));
} finally { await rig.close(); }
