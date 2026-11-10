#!/usr/bin/env node
/* tools/npcwar-camera-seq.mjs — SHORT FRAME SEQUENCES OF THE NPC WAR CAMERA.

   Boots games/battle.html on a mixed war (tanks, a helicopter, men), freezes
   the page's rAF, drives its frame with __battle.advance() and shoots:
     director   one frame every 1.6 s of battle under the auto director
     touch      a real two-finger pinch + a one-finger drag, sent as touch
                events through CDP (the phone path), a frame after each
     free       the wheel and a mouse drag (the desktop path)
     lock/fp    camRide(): a tank, a soldier, a helicopter, from outside
                and from inside (only where the build has them)
   Also prints the lens numbers per phase (eye height, fov, nan).

     node tools/npcwar-camera-seq.mjs --out <dir> [--view desktop|phone]  */
import { launch, sleep } from "./lib/cdp.mjs";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const OUT = arg("--out", "/tmp/npcwar-camera-seq");
const VIEWS = arg("--view", "desktop,phone").split(",");
const ROSTER = arg("--roster", "a=m1_abrams*2,men*140,ah64_apache*1&b=men*260&arena=dunes");
const VIEW = {
  desktop: { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false, touch: false },
  phone: { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, touch: true },
};
mkdirSync(OUT, { recursive: true });
const rig = await launch({ rafBudget: 0 });
let n = 0;
async function shot(view, tag) {
  await rig.evl("__battle.render()");
  const png = await rig.send("Page.captureScreenshot", { format: "jpeg", quality: 72 });
  const f = path.join(OUT, `${view}-${String(n++).padStart(2, "0")}-${tag}.jpg`);
  writeFileSync(f, Buffer.from(png.result.data, "base64"));
  const L = await rig.evl(`(() => { const c = CBZ.camera; return { y: +c.position.y.toFixed(1), fov: +c.fov.toFixed(1), mode: cam.mode, ok: [c.position.x, c.position.y, c.fov].every(Number.isFinite) }; })()`, false);
  console.log(view, tag, JSON.stringify(L));
}
const touch = (type, pts) => rig.send("Input.dispatchTouchEvent", { type, touchPoints: pts.map((p, i) => ({ x: p[0], y: p[1], id: i + 1 })) });
try {
  for (const view of VIEWS) {
    const V = VIEW[view];
    n = 0;
    await rig.send("Emulation.setDeviceMetricsOverride", { width: V.width, height: V.height, deviceScaleFactor: V.deviceScaleFactor, mobile: V.mobile });
    await rig.send("Emulation.setTouchEmulationEnabled", { enabled: V.touch, maxTouchPoints: V.touch ? 5 : 0 });
    rig.clearErrors();
    await rig.open("games/battle.html", `auto=1&probe=0&${ROSTER}`);
    await sleep(500);
    const up = await rig.wait("window.__battle && __battle.audit().started", 240000, 400);
    if (!up) { console.log(view, "never started", rig.errors.slice(0, 3)); continue; }
    await rig.evl("__battle.freeze()");
    await rig.evl("__battle.advance(5, 1/30)");
    // ---- the director
    for (let k = 0; k < 6; k++) { await rig.evl("__battle.advance(1.6, 1/60)"); await shot(view, "director"); }
    // ---- the hands
    await rig.evl("setCamMode('free'); const t = men.find(m => m.vehicle && !m.air && !m.dead) || men[0]; const w = t.pos; cam.wFocus.set(w.x, MAP.groundAt(w.x, w.z), w.z); cam.wPitch = 0.6; cam.wDist = 110; cam.snap = true; __battle.advance(0.5, 1/60)");
    await shot(view, "free-start");
    const W = V.width, H = V.height, cx = W / 2, cy = H / 2;
    if (V.touch) {
      // a pinch in (fingers apart = closer) over a third of a second, then a drag
      await touch("touchStart", [[cx - 40, cy], [cx + 40, cy]]);
      for (let i = 1; i <= 10; i++) { await touch("touchMove", [[cx - 40 - i * 9, cy], [cx + 40 + i * 9, cy]]); await rig.evl("__battle.advance(0.03, 1/60)"); }
      await touch("touchEnd", []);
      await rig.evl("__battle.advance(0.6, 1/60)");
      await shot(view, "pinch-in");
      await touch("touchStart", [[cx, cy]]);
      for (let i = 1; i <= 10; i++) { await touch("touchMove", [[cx + i * 12, cy - i * 5]]); await rig.evl("__battle.advance(0.016, 1/60)"); }
      await touch("touchEnd", []);
      await rig.evl("__battle.advance(0.8, 1/60)");
      await shot(view, "orbit-drag");
      await touch("touchStart", [[cx - 30, cy + 60], [cx + 30, cy + 60]]);
      for (let i = 1; i <= 10; i++) { await touch("touchMove", [[cx - 30, cy + 60 + i * 14], [cx + 30, cy + 60 + i * 14]]); await rig.evl("__battle.advance(0.03, 1/60)"); }
      await touch("touchEnd", []);
      await rig.evl("__battle.advance(0.8, 1/60)");
      await shot(view, "two-finger-pan");
    } else {
      for (let i = 0; i < 6; i++) { await rig.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: cx, y: cy, deltaX: 0, deltaY: -100 }); await rig.evl("__battle.advance(0.05, 1/60)"); }
      await rig.evl("__battle.advance(0.6, 1/60)");
      await shot(view, "wheel-in");
      await rig.send("Input.dispatchMouseEvent", { type: "mousePressed", x: cx, y: cy, button: "left", clickCount: 1 });
      for (let i = 1; i <= 12; i++) { await rig.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: cx + i * 14, y: cy - i * 5, button: "left", buttons: 1 }); await rig.evl("__battle.advance(0.016, 1/60)"); }
      await rig.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: cx + 168, y: cy - 60, button: "left", clickCount: 1 });
      await rig.evl("__battle.advance(0.8, 1/60)");
      await shot(view, "orbit-drag");
    }
    // ---- zoom right out: the whole field
    await rig.evl("cam.wPitch = 1.0; camZoom(14); __battle.advance(2.5, 1/60)");
    await shot(view, "overview");
    await rig.evl("cam.wPitch = 0.2; camZoom(1/100); __battle.advance(2.5, 1/60)");
    await shot(view, "shoulder");
    // ---- lock + first person (this build only)
    const has = await rig.evl("typeof __battle.camRide === 'function'");
    if (has) {
      for (const [sel, nm] of [["m1_abrams", "tank"], ["men", "man"], ["ah64_apache", "heli"]]) {
        const r = await rig.evl(`__battle.camRide('lock', ${JSON.stringify(sel)})`, false);
        if (!r) { console.log(view, nm, "none on the field"); continue; }
        await rig.evl("__battle.advance(1.2, 1/60)");
        await shot(view, nm + "-lock");
        await rig.evl("__battle.advance(2, 1/60)");
        await shot(view, nm + "-lock-later");
        await rig.evl(`__battle.camRide('fp', ${JSON.stringify(sel)})`, false);
        await rig.evl("__battle.advance(1.2, 1/60)");
        await shot(view, nm + "-fp");
      }
    }
    console.log(view, "errors", rig.errors.slice(0, 4));
  }
} finally {
  await rig.close();
}
