#!/usr/bin/env node
/* tools/president-repl.mjs — BOOT THE PRESIDENT GAME ONCE, THEN POKE IT.

   A Gang City boot on a loaded Mac is minutes; a question about the game is
   seconds. This boots index.html?slice=estate&president=usa (or the query you
   pass) once, keeps the headless page alive, and runs commands dropped into
   <dir>/cmd.jsonl, one JSON per line, answering in <dir>/out.jsonl:
     {"id":1,"eval":"JSON.stringify(CBZ.presGame.audit())"}   (promises awaited)
     {"id":2,"shot":"name"}                                    -> <dir>/name.jpg
     {"id":3,"sleep":5000}
     {"id":4,"tap":[x,y]}            a real touch (CSS px): touchstart/end, the
                                     pointer events and the compat click
     {"id":5,"hold":[x,y,ms]}        a finger held down
     {"id":6,"drag":[x0,y0,x1,y1,ms]} a finger dragged (a swipe, the stick)
     {"id":7,"key":"KeyE"}           a key press (desktop)
     {"quit":true}
   The first line of out.jsonl is {"id":0,"ready":true|false}. Step the world
   with CBZ.stepSim(1/30) inside an eval: the page draws a frame every second
   or two on SwiftShader, and a screenshot is the last frame presented.

   node tools/president-repl.mjs <dir> ["slice=estate&president=chn&pseed=3"]
     --phone       an iPhone held upright (393x852, touch, pointer: coarse);
                   --land for the same phone on its side
     --door        start at games/president.html as the portal links it and
                   stop there (ready once the door page is up): tap TAKE OFFICE
                   yourself, the engine page then loads in the same tab */
import { launch, sleep } from "./lib/cdp.mjs";
import { writeFileSync, readFileSync, appendFileSync } from "node:fs";
const ARGS = process.argv.slice(2);
const flags = new Set(ARGS.filter((a) => a.startsWith("--")));
const pos = ARGS.filter((a) => !a.startsWith("--"));
const DIR = pos[0];
const PHONE = flags.has("--phone") || flags.has("--land"), LAND = flags.has("--land"), DOOR = flags.has("--door");
const CMD = DIR + "/cmd.jsonl", OUTF = DIR + "/out.jsonl";
writeFileSync(CMD, ""); writeFileSync(OUTF, "");
const rig = await launch({ rafBudget: 0, quiet: true, preload: PHONE ? "tools/preload/ipad.js" : null });
const W = PHONE ? (LAND ? 852 : 393) : 1100, H = PHONE ? (LAND ? 393 : 852) : 700;
await rig.send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: PHONE ? 2 : 1, mobile: PHONE,
  screenOrientation: PHONE ? { type: LAND ? "landscapePrimary" : "portraitPrimary", angle: LAND ? 90 : 0 } : undefined });
if (PHONE) {
  await rig.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await rig.send("Emulation.setUserAgentOverride", { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1", platform: "iPhone" });
}
if (DOOR) await rig.open("games/president.html", pos[1] || "");
else await rig.open("index.html", pos[1] || "slice=estate&president=usa&pseed=7&daysecs=30");
let ok = false;
if (DOOR) ok = await rig.wait("document.getElementById('solo')", 60000, 500);
else for (let i = 0; i < 400 && !ok; i++) {
  ok = await rig.wait("CBZ.presGame && CBZ.presGame.audit().started && CBZ.player && CBZ.player._propSeat", 5000, 1000);
  try { await rig.evl("(CBZ.game && CBZ.game.mode === 'city' && CBZ.game.state === 'paused' && CBZ.setState) ? (CBZ.setState('playing'), 1) : 0"); } catch (e) {}
}
appendFileSync(OUTF, JSON.stringify({ id: 0, ready: ok, w: W, h: H, phone: PHONE }) + "\n");
const touch = (type, pts) => rig.send("Input.dispatchTouchEvent", { type, touchPoints: pts.map(([x, y]) => ({ x, y, radiusX: 8, radiusY: 8, force: 1, id: 1 })) });
let done = 0;
for (;;) {
  const lines = readFileSync(CMD, "utf8").split("\n").filter(Boolean);
  for (; done < lines.length; done++) {
    let c; try { c = JSON.parse(lines[done]); } catch (e) { continue; }
    if (c.quit) { await rig.close(); process.exit(0); }
    let res;
    try {
      if (c.eval) res = await rig.evl(c.eval, true);
      if (c.tap) { await touch("touchStart", [c.tap]); await sleep(70); await touch("touchEnd", []); res = "tap " + c.tap; }
      if (c.hold) { await touch("touchStart", [c.hold]); await sleep(c.hold[2] || 900); await touch("touchEnd", []); res = "hold " + c.hold; }
      if (c.drag) {
        const [x0, y0, x1, y1, ms] = c.drag, n = 16;
        await touch("touchStart", [[x0, y0]]);
        for (let i = 1; i <= n; i++) { await sleep((ms || 400) / n); await touch("touchMove", [[x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n]]); }
        if (c.keep) await sleep(c.keep);
        await touch("touchEnd", []); res = "drag " + c.drag;
      }
      if (c.key) {
        await rig.send("Input.dispatchKeyEvent", { type: "keyDown", code: c.key, key: c.keyName || c.key.replace(/^Key/, "").toLowerCase() });
        await sleep(c.ms || 80);
        await rig.send("Input.dispatchKeyEvent", { type: "keyUp", code: c.key, key: c.keyName || c.key.replace(/^Key/, "").toLowerCase() });
        res = "key " + c.key;
      }
      if (c.shot) { const r = await rig.send("Page.captureScreenshot", { format: "jpeg", quality: 72 }); writeFileSync(DIR + "/" + c.shot + ".jpg", Buffer.from(r.result.data, "base64")); res = (res ? res + "; " : "") + "shot " + c.shot; }
      if (c.sleep) { await sleep(c.sleep); res = res || "slept"; }
    } catch (e) { res = "ERR " + e.message; }
    appendFileSync(OUTF, JSON.stringify({ id: c.id, res, errors: rig.errors.splice(0) }) + "\n");
  }
  await sleep(300);
}
