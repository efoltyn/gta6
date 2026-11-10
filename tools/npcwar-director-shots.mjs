#!/usr/bin/env node
/* tools/npcwar-director-shots.mjs — WHAT DOES THE DIRECTOR SHOOT?

   Boots games/battle.html as a player gets it (probe=0: the operator's hand,
   the slow-motion beats and the delayed concussion are all in), freezes the
   rAF, drives the page's own frame and takes one frame a second of battle
   under the auto director, naming each by the shot the director was on. Then
   the tripod, forced onto a tank and a helicopter (__battle.camShot).
   Prints the shot each second, how many DIFFERENT subjects had the lens, and
   whether a round was ridden.

     node tools/npcwar-director-shots.mjs --out <dir> [--secs 45] [--roster "a=...&b=..."] */
import { launch, sleep } from "./lib/cdp.mjs";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const OUT = arg("--out", "/tmp/npcwar-director-shots");
const SECS = +arg("--secs", 45);
const ROSTER = arg("--roster", "a=m1_abrams*3,men*120,ah64_apache*1,m142_himars*1&b=men*240,m1_abrams*1&arena=dunes");
mkdirSync(OUT, { recursive: true });
const rig = await launch({ rafBudget: 0 });
let n = 0;
async function shot(tag) {
  await rig.evl("__battle.render()");
  const png = await rig.send("Page.captureScreenshot", { format: "jpeg", quality: 74 });
  const f = path.join(OUT, `${String(n++).padStart(2, "0")}-${tag}.jpg`);
  writeFileSync(f, Buffer.from(png.result.data, "base64"));
  return f;
}
let bad = 0;
try {
  await rig.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  rig.clearErrors();
  await rig.open("games/battle.html", `auto=1&probe=0&${ROSTER}`);
  await sleep(500);
  const up = await rig.wait("window.__battle && __battle.audit().started", 240000, 400);
  if (!up) { console.log("never started", rig.errors.slice(0, 3)); process.exit(1); }
  await rig.evl("__battle.freeze()");
  await rig.evl("__battle.advance(3, 1/30)");
  const shots = {}, subjects = new Set();
  let rode = 0, lastRound = null;
  for (let k = 0; k < SECS; k++) {
    await rig.evl("__battle.advance(1, 1/60)");
    const s = await rig.evl(`(() => { const c = CBZ.camera, st = __battle.camState(); st.subj = cam.followM ? cam.followM.id : null;
      st.ok = [c.position.x, c.position.y, c.position.z, c.fov, c.quaternion.x, c.quaternion.w].every(Number.isFinite); st.y = +c.position.y.toFixed(1); return st; })()`, false);
    if (!s.ok) bad++;
    shots[s.shot] = (shots[s.shot] || 0) + 1;
    if (s.subj != null) subjects.add(s.subj);
    if (s.roundAt != null && s.roundAt !== lastRound) { lastRound = s.roundAt; rode++; }
    await shot(s.shot);
    console.log(String(k).padStart(2), s.shot.padEnd(10), "subj", String(s.subj).padEnd(6), "fov", s.fov, "eyeY", s.y, s.ok ? "" : "NaN!");
  }
  console.log("shots", JSON.stringify(shots), "| subjects on the lens:", subjects.size, "| rounds ridden:", rode, "| feel:", (await rig.evl("__battle.camState().feel", false)));
  for (const [sel, nm] of [["m1_abrams", "tank"], ["ah64_apache", "heli"]]) {
    const r = await rig.evl(`__battle.camShot('tripod', ${JSON.stringify(sel)})`, false);
    if (!r) { console.log("tripod", nm, "no clear place to stand"); continue; }
    for (let k = 0; k < 3; k++) { await rig.evl("__battle.advance(1.3, 1/60)"); await shot("tripod-" + nm); }
    console.log("tripod", nm, JSON.stringify(r));
  }
  console.log("errors", JSON.stringify(rig.errors.slice(0, 5)));
  if (rig.errors.length) bad++;
} finally {
  await rig.close();
}
process.exit(bad ? 1 : 0);
