#!/usr/bin/env node
/* tools/president-shots.mjs — one headless look at the President game, in
   the real engine.

   Opens index.html?slice=estate&president=<c> (city/president_game.js: the
   Executive Mansion slice, The President origin, the real-world model on a
   clock) and photographs, in order:
     1-desk      from the chair, looking down at the Resolute desk
     2-book      the briefing book open on the blotter (the camera over it)
     3-turned    after one page turn
     4-country   a country picked on the world page
     5-standing  out of the chair, third person: the President's own body
     6-coup      the General and his soldiers in the office, the question up
     7-fight     after "Arrest him": the shooting
   and prints the game, book and storm audits and every page error. One
   Chrome, then gone. Slow on a loaded Mac (a Gang City boot dominates).

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
const shot = async (name) => {
  const r = await rig.send("Page.captureScreenshot", { format: "jpeg", quality: 72 });
  const f = path.join(OUT, name + ".jpg");
  writeFileSync(f, Buffer.from(r.result.data, "base64"));
  console.log("  wrote", path.relative(ROOT, f), t());
};
const J = async (e) => { try { return await rig.evl(e); } catch (er) { return "ERR " + er.message; } };
try {
  await rig.send("Emulation.setDeviceMetricsOverride", { width: Wd, height: Ht, deviceScaleFactor: 1, mobile: false });
  await rig.open("index.html", `slice=estate&president=${C}&pseed=7&daysecs=3`);
  console.log("boot", await rig.wait("window.CBZ && CBZ.bootComplete", 300000, 1000), t());
  console.log("in office", await rig.wait("CBZ.presGame && CBZ.presGame.audit().started && CBZ.player && CBZ.player._propSeat", 600000, 1000), t());
  await sleep(4000);
  console.log("game", JSON.stringify(await J("CBZ.presGame.audit()")));
  // 1: from the chair, the desk
  await J("(function(){ if (CBZ.setFPS) CBZ.setFPS(true); if (CBZ.fps) CBZ.fps.fp = -0.62; CBZ.cam.pitch = 0.62; return 1; })()");
  await sleep(1500); await shot("1-desk");
  // 2: the briefing book
  console.log("open", await J("CBZ.presBook.open()"));
  await sleep(2500); await shot("2-book");
  console.log("book", JSON.stringify(await J("CBZ.presBook.audit()")));
  await J("CBZ.presBook.turn(1)"); await sleep(1600); await shot("3-turned");
  // 4: the world page, a country picked
  await J("CBZ.presBook.goTo(5)"); await sleep(1600);
  await J("(function(){ var a = CBZ.presBook.audit(); var side = a.left === 'world' ? 'L' : 'R'; CBZ.presBook._tapPage(side, 140, 520); return side; })()");
  await sleep(2400); await shot("4-country");
  console.log("book", JSON.stringify(await J("CBZ.presBook.audit()")));
  await J("CBZ.presBook.close()"); await sleep(800);
  // 5: up out of the chair, the body, third person
  await J("(function(){ var s = CBZ.seatState && CBZ.seatState(); if (s) s.exit(); return !!s; })()");
  await sleep(2500);
  await J("(function(){ if (CBZ.setFPS) CBZ.setFPS(false); CBZ.cam.pitch = 0.25; return 1; })()");
  await sleep(2000); await shot("5-standing");
  console.log("player", JSON.stringify(await J("({ pos: CBZ.player.pos, seat: !!CBZ.player._propSeat, fps: CBZ.fpsActive && CBZ.fpsActive() })")));
  if (STORM) {
    // 6: a coup comes through the door
    await J("(function(){ if (CBZ.setFPS) CBZ.setFPS(true); CBZ.cam.pitch = 0.05; return 1; })()");
    await J(`(function(){ var G = CBZ.presGame, S = G.state(), c = S.c[G.me()];
      CBZ.presWorld._matter(S, c, "coup", "general", { name: c.cab.general.name }, [{ label: "Step down", act: { type: "resign" } }, { label: "Arrest him", act: { type: "arrest", role: "general" } }], 3, true);
      G._step(1); return CBZ.presStorm.audit(); })()`);
    for (let i = 0; i < 40; i++) { const a = await J("CBZ.presStorm.audit()"); if (a && a.phase !== "enter") break; await sleep(1000); }
    await sleep(2500); await shot("6-coup");
    console.log("storm", JSON.stringify(await J("CBZ.presStorm.audit()")));
    await J("CBZ.padPrompt && CBZ.padPrompt.pick('right')");
    await sleep(9000); await shot("7-fight");
    console.log("storm", JSON.stringify(await J("CBZ.presStorm.audit()")));
    console.log("game", JSON.stringify(await J("CBZ.presGame.audit()")));
  }
  console.log("errors", rig.errors.slice(0, 12));
} catch (e) { console.error("FAILED:", e.message); }
finally { await rig.close(); }
