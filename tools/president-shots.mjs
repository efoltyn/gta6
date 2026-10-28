#!/usr/bin/env node
/* tools/president-shots.mjs — one headless look at the President game, in
   the real engine.

   Opens index.html?slice=estate&president=<c> (city/president_game.js: the
   Executive Mansion slice, The President origin, the real-world model on a
   clock) and photographs, in order:
     1-desk      from the chair: the Resolute desk and the room
     2-book      the briefing book open on the blotter (the camera over it)
     3-turned    after one page turn
     4-country   a country picked on the world page
     5-standing  out of the chair, third person: the President's own body
     6-coup      the General and his soldiers in the office, the question up
     7-fight     after "Arrest him": the shooting
   and prints the game, book and storm audits and every page error. One
   Chrome, then gone.

   ON A LOADED MAC the page draws a frame every second or two, so two things
   are done the slow way on purpose: the world is stepped with CBZ.stepSim
   (the coup's walk in is a minute of game time), and every photograph first
   waits for fresh frames (a screenshot is the last frame PRESENTED, which can
   be half a minute old).

   node tools/president-shots.mjs [--out artifacts/president] [--c usa] [--w 1100 --h 700] [--no-storm]
*/
import { launch, sleep, ROOT } from "./lib/cdp.mjs";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i < 0 ? d : args[i + 1]; };
const OUT = path.resolve(ROOT, arg("--out", "artifacts/president"));
const C = arg("--c", "usa"), Wd = +arg("--w", 1100), Ht = +arg("--h", 700);
const STORM = !args.includes("--no-storm");
mkdirSync(OUT, { recursive: true });

const rig = await launch({ rafBudget: 0, quiet: true });
const T0 = Date.now(); const t = () => ((Date.now() - T0) / 1000).toFixed(0) + "s";
const J = async (e) => { try { return await rig.evl(e, true); } catch (er) { return "ERR " + er.message; } };
// wait until n more frames have been drawn (the screenshot is the last one presented)
const frames = async (n) => {
  const f0 = await J("CBZ.renderer.info.render.frame");
  await rig.wait(`CBZ.renderer.info.render.frame >= ${(+f0 || 0) + n}`, 120000, 500);
};
const shot = async (name) => {
  await frames(3);
  const r = await rig.send("Page.captureScreenshot", { format: "jpeg", quality: 72 });
  const f = path.join(OUT, name + ".jpg");
  writeFileSync(f, Buffer.from(r.result.data, "base64"));
  console.log("  wrote", path.relative(ROOT, f), t());
};
const step = (n) => J(`(function(){ for (var i = 0; i < ${n}; i++) CBZ.stepSim(1/30); return CBZ.presStorm ? CBZ.presStorm.audit().phase : null; })()`);
try {
  await rig.send("Emulation.setDeviceMetricsOverride", { width: Wd, height: Ht, deviceScaleFactor: 1, mobile: false });
  await rig.open("index.html", `slice=estate&president=${C}&pseed=7&daysecs=30`);
  console.log("boot", await rig.wait("window.CBZ && CBZ.bootComplete", 300000, 1000), t());
  let ok = false;
  for (let i = 0; i < 200 && !ok; i++) {
    ok = await rig.wait("CBZ.presGame && CBZ.presGame.audit().started && CBZ.player && CBZ.player._propSeat", 5000, 1000);
    // HARNESS TRAP: a frame that takes seconds on SwiftShader can read as an
    // app switch and pause the city; resume it (a real browser never sees this)
    await J("(CBZ.game && CBZ.game.mode === 'city' && CBZ.game.state === 'paused' && CBZ.setState) ? (CBZ.setState('playing'), 1) : 0");
  }
  console.log("in office", ok, t());
  await step(120);
  console.log("game", JSON.stringify(await J("CBZ.presGame.audit()")));
  await shot("1-desk");
  console.log("open", await J("CBZ.presBook.open()"));
  await step(20); await shot("2-book");
  console.log("book", JSON.stringify(await J("CBZ.presBook.audit()")));
  await J("CBZ.presBook.turn(1)"); await step(30); await shot("3-turned");
  await J("CBZ.presBook.goTo(5)"); await step(30);
  await J("(function(){ var a = CBZ.presBook.audit(); CBZ.presBook._tapPage(a.left === 'world' ? 'L' : 'R', 200, 560); return 1; })()");
  await step(30); await shot("4-country");
  console.log("book", JSON.stringify(await J("CBZ.presBook.audit()")));
  await J("CBZ.presBook.close()"); await step(20);
  console.log("still seated after reading:", await J("!!CBZ.player._propSeat"));
  await J("(function(){ var s = CBZ.seatState && CBZ.seatState(); if (s) s.exit(); return !!s; })()");
  await step(60);
  await J("(function(){ if (CBZ.setFPS) CBZ.setFPS(false); CBZ.cam.pitch = 0.25; return 1; })()");
  await step(30); await shot("5-standing");
  console.log("player", JSON.stringify(await J("({ pos: CBZ.player.pos, seat: !!CBZ.player._propSeat, fps: CBZ.fpsActive && CBZ.fpsActive() })")));
  if (STORM) {
    await J("(function(){ CBZ.presidentOffice._relocate(); if (CBZ.setFPS) CBZ.setFPS(true); var dp = CBZ.presidentOffice.deskPoint(); CBZ.cam.yaw = dp.heading + Math.PI; CBZ.cam.pitch = 0.05; return 1; })()");
    await J(`(function(){ var G = CBZ.presGame, S = G.state(), c = S.c[G.me()];
      CBZ.presWorld._matter(S, c, "coup", "general", { name: c.cab.general.name }, [{ label: "Step down", act: { type: "resign" } }, { label: "Arrest him", act: { type: "arrest", role: "general" } }], 3, true);
      G._step(1); return 1; })()`);
    for (let i = 0; i < 12; i++) { const ph = await step(150); if (ph && ph !== "enter") break; }
    await shot("6-coup");
    console.log("storm", JSON.stringify(await J("CBZ.presStorm.audit()")));
    await J("CBZ.padPrompt && CBZ.padPrompt.pick('right')");
    await step(150); await shot("7-fight");
    console.log("storm", JSON.stringify(await J("CBZ.presStorm.audit()")));
    console.log("game", JSON.stringify(await J("CBZ.presGame.audit()")));
  }
  console.log("errors", rig.errors.slice(0, 12));
} catch (e) { console.error("FAILED:", e.message); }
finally { await rig.close(); }
