/* tools/shark-launch-strip.mjs — LAUNCH TO FIRST CONTROL, as a frame strip.

   CrazyGames rejected Shark Sim: "when you launch the shark game it shows a
   quick shot of another game at the start". That moment happens before any
   ba preset can stage anything (ba waits for the engine to be ready), so this
   tool records the page from the instant of navigation with
   Page.startScreencast and keeps EVERY frame the compositor presents, stamped
   with milliseconds since navigation. Then it picks evenly spaced frames plus
   every frame in the first 3 s, and writes them to --out as numbered PNGs
   plus a timeline.json. tools/shark-launch-sheet.py stitches before/after.

     node tools/shark-launch-strip.mjs --url http://127.0.0.1:8732/?mode=sharksim \
          --out DIR [--secs 25] [--width 1280 --height 720] [--play]

   --play clicks PLAY as soon as it exists (what a player does), so the strip
   covers launch -> first control. Without it, the strip is the title only.
   Uncapped rAF: this is a visual recording, not a test. */
import { launch, sleep } from "./lib/cdp.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => {
  if (v.startsWith("--")) a.push([v.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : true]);
  return a;
}, []));
const url = args.url;
const out = path.resolve(args.out || "launch-strip");
const secs = +(args.secs || 25);
const W = +(args.width || 1280), H = +(args.height || 720);
if (!url) { console.error("--url required"); process.exit(1); }
mkdirSync(out, { recursive: true });

const rig = await launch({ rafBudget: 0 });
try {
  await rig.send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  const frames = [];
  let t0 = 0;
  // screencast frames arrive as events; the cdp helper only surfaces replies,
  // so listen on the page socket directly through a second connection
  const ws = new WebSocket(rig.page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  let id = 1;
  const send = (method, params = {}) => ws.send(JSON.stringify({ id: id++, method, params }));
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data);
    if (m.method === "Page.screencastFrame") {
      const t = Date.now() - t0;
      frames.push({ t, data: m.params.data });
      send("Page.screencastFrameAck", { sessionId: m.params.sessionId });
    }
  });
  send("Page.enable");
  await rig.send("Page.navigate", { url: "about:blank" });
  await sleep(300);
  send("Page.startScreencast", { format: "jpeg", quality: 82, maxWidth: W, maxHeight: H, everyNthFrame: 1 });
  t0 = Date.now();
  await rig.send("Page.navigate", { url });
  let played = -1;
  const end = Date.now() + secs * 1000;
  while (Date.now() < end) {
    if (args.play && played < 0) {
      try {
        const ok = await rig.evl("(()=>{try{const b=document.getElementById('playBtn');if(!b||!window.CBZ||!CBZ.bootComplete)return false;b.click();return CBZ.game.state==='playing'}catch(e){return false}})()");
        if (ok) played = Date.now() - t0;
      } catch (_) {}
    }
    await sleep(250);
  }
  let endState = null;
  try {
    endState = await rig.evl("(()=>{try{return {state:CBZ.game.state,mode:CBZ.game.mode,boot:!!document.getElementById('sharkBoot'),launch:CBZ.sharkTitle&&CBZ.sharkTitle.launch&&{started:CBZ.sharkTitle.launch.started,gone:CBZ.sharkTitle.launch.bootGone,live:CBZ.sharkTitle.launch.live}}}catch(e){return String(e)}})()");
  } catch (_) {}
  console.log("end state", JSON.stringify(endState));
  send("Page.stopScreencast");
  await sleep(300);
  // keep: every frame in the first 3 s (the flash lives there), then one per second
  const keep = [];
  let nextT = 3000;
  for (const f of frames) {
    if (f.t < 3000) keep.push(f);
    else if (f.t >= nextT) { keep.push(f); nextT += 1000; }
  }
  const timeline = keep.map((f, i) => {
    const name = String(i).padStart(3, "0") + "-" + String(f.t).padStart(6, "0") + "ms.jpg";
    writeFileSync(path.join(out, name), Buffer.from(f.data, "base64"));
    return { file: name, t: f.t };
  });
  writeFileSync(path.join(out, "timeline.json"), JSON.stringify({ url, playedAtMs: played, frames: timeline, totalFrames: frames.length, errors: rig.errors.slice(0, 20) }, null, 2));
  console.log(`${timeline.length} frames kept of ${frames.length}; play at ${played} ms -> ${out}`);
  ws.close();
} finally {
  await rig.close();
}
