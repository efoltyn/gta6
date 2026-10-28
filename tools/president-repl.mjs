#!/usr/bin/env node
/* tools/president-repl.mjs — BOOT THE PRESIDENT GAME ONCE, THEN POKE IT.

   A Gang City boot on a loaded Mac is minutes; a question about the game is
   seconds. This boots index.html?slice=estate&president=usa (or the query you
   pass) once, keeps the headless page alive, and runs commands dropped into
   <dir>/cmd.jsonl, one JSON per line, answering in <dir>/out.jsonl:
     {"id":1,"eval":"JSON.stringify(CBZ.presGame.audit())"}   (promises awaited)
     {"id":2,"shot":"name"}                                    -> <dir>/name.jpg
     {"id":3,"sleep":5000}
     {"quit":true}
   The first line of out.jsonl is {"id":0,"ready":true|false}. Step the world
   with CBZ.stepSim(1/30) inside an eval: the page draws a frame every second
   or two on SwiftShader, and a screenshot is the last frame presented.

   node tools/president-repl.mjs <dir> ["slice=estate&president=chn&pseed=3"] */
import { launch, sleep } from "./lib/cdp.mjs";
import { writeFileSync, readFileSync, existsSync, appendFileSync } from "node:fs";
const DIR = process.argv[2];
const CMD = DIR + "/cmd.jsonl", OUTF = DIR + "/out.jsonl";
writeFileSync(CMD, ""); writeFileSync(OUTF, "");
const rig = await launch({ rafBudget: 0, quiet: true });
await rig.send("Emulation.setDeviceMetricsOverride", { width: 1100, height: 700, deviceScaleFactor: 1, mobile: false });
await rig.open("index.html", process.argv[3] || "slice=estate&president=usa&pseed=7&daysecs=30");
let ok = false;
for (let i = 0; i < 400 && !ok; i++) {
  ok = await rig.wait("CBZ.presGame && CBZ.presGame.audit().started && CBZ.player && CBZ.player._propSeat", 5000, 1000);
  try { await rig.evl("(CBZ.game && CBZ.game.mode === 'city' && CBZ.game.state === 'paused' && CBZ.setState) ? (CBZ.setState('playing'), 1) : 0"); } catch (e) {}
}
appendFileSync(OUTF, JSON.stringify({ id: 0, ready: ok }) + "\n");
let done = 0;
for (;;) {
  const lines = readFileSync(CMD, "utf8").split("\n").filter(Boolean);
  for (; done < lines.length; done++) {
    let c; try { c = JSON.parse(lines[done]); } catch (e) { continue; }
    if (c.quit) { await rig.close(); process.exit(0); }
    let res;
    try {
      if (c.eval) res = await rig.evl(c.eval, true);
      if (c.shot) { const r = await rig.send("Page.captureScreenshot", { format: "jpeg", quality: 72 }); writeFileSync(DIR + "/" + c.shot + ".jpg", Buffer.from(r.result.data, "base64")); res = "shot " + c.shot; }
      if (c.sleep) { await sleep(c.sleep); res = res || "slept"; }
    } catch (e) { res = "ERR " + e.message; }
    appendFileSync(OUTF, JSON.stringify({ id: c.id, res, errors: rig.errors.splice(0) }) + "\n");
  }
  await sleep(300);
}
