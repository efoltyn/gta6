// node tools/plane-flight-check.mjs — flies the player fixed-wing's pure step
// (CBZ.aeroPhysics.planeStep, src/city/aircraftphysics.js) headless, per class:
//   1. hands off for 10 s at cruise: straight and level
//   2. full right stick: banks right (roll +) and turns right (heading falls)
//   3. pull back: the nose comes up and it climbs
//   4. a released bank fades back to wings level
//   5. runway: no lift-off below rotate speed, rotates and climbs above it
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ctx = { window: { CBZ: {} }, Math };
vm.runInNewContext(fs.readFileSync(path.join(root, "src/city/aircraftphysics.js"), "utf8"), ctx);
const A = ctx.window.CBZ.aeroPhysics;
if (!A || !A.planeStep) { console.error("FAIL planeStep missing"); process.exit(1); }

// the class rows, read out of playeraircraft.js so the check flies the real tuning
const src = fs.readFileSync(path.join(root, "src/city/playeraircraft.js"), "utf8");
const rows = {};
for (const cls of ["prop", "jet", "airliner"]) {
  const m = src.match(new RegExp("\\n\\s*" + cls + ":\\s*(\\{[^}]*\\})"));
  if (!m) { console.error("FAIL no WING_V2 row " + cls); process.exit(1); }
  rows[cls] = Function("return " + m[1])();
}

const DT = 1 / 60;
let fail = 0;
const check = (ok, msg) => { console.log((ok ? "ok   " : "FAIL ") + msg); if (!ok) fail++; };
function fly(st, inp, secs, C, ground) {
  const p = { y: 0 };
  for (let i = 0; i < secs / DT; i++) {
    const env = { onGround: ground && p.y <= 0.3, agl: 200 + p.y, authority: 1, groundMul: 1 };
    if (ground) env.agl = Math.max(0, p.y);
    A.planeStep(st, inp, DT, env, C);
    p.y += st.vy * DT;
    if (ground && p.y < 0) { p.y = 0; if (st.vy < 0) st.vy = 0; }
  }
  return p;
}
const NONE = { pitch: 0, roll: 0, yaw: 0, thr: 0 };
for (const cls of Object.keys(rows)) {
  const C = rows[cls];
  const cruise = Math.max(C.vstall * 1.6, C.vr * 1.3);
  const trim = Math.min(1, C.dragK * cruise * cruise / C.thrust);
  const air = () => ({ airspeed: cruise, thr: trim, heading: 0.7, pitch: 0, roll: 0, sag: 0 });
  {
    const st = air();
    const p = fly(st, NONE, 10, C);
    check(Math.abs(st.heading - 0.7) < 1e-6 && Math.abs(p.y) < 1 && Math.abs(st.roll) < 1e-6,
      cls + " hands off 10 s: heading " + (st.heading - 0.7).toFixed(4) + ", alt " + p.y.toFixed(2) + " m");
  }
  {
    const st = air();
    fly(st, { pitch: 0, roll: 1, yaw: 0, thr: 0 }, 3, C);
    check(st.roll > 0.3 && st.heading < 0.7 - 0.2, cls + " full right stick 3 s: roll " + st.roll.toFixed(2) + ", heading " + (st.heading - 0.7).toFixed(2));
    fly(st, NONE, 10, C);
    check(Math.abs(st.roll) < 0.05, cls + " bank released 10 s: roll " + st.roll.toFixed(3));
  }
  {
    const st = air(); st.thr = 1;
    const p = fly(st, { pitch: 1, roll: 0, yaw: 0, thr: 0 }, 1.5, C);
    check(st.pitch > 0.2 && st.vy > 5 && p.y > 2, cls + " pull up 1.5 s: pitch " + st.pitch.toFixed(2) + ", vy " + st.vy.toFixed(1));
  }
  {
    const st = air();
    fly(st, { pitch: 0, roll: 0, yaw: 1, thr: 0 }, 2, C);
    check(st.heading < 0.7 - 0.2, cls + " right rudder 2 s: heading " + (st.heading - 0.7).toFixed(2));
  }
  {
    const st = { airspeed: 0, thr: 0, heading: 0, pitch: 0, roll: 0, sag: 0 };
    let p = fly(st, { pitch: 1, roll: 0, yaw: 0, thr: 1 }, 1, C, true);
    check(p.y < 0.01 && st.pitch === 0, cls + " runway, slow, pulling: stays down");
    let t = 0;
    while (st.airspeed < C.vr && t < 120) { fly(st, { pitch: 0, roll: 0, yaw: 0, thr: 1 }, 0.5, C, true); t += 0.5; }
    p = fly(st, { pitch: 1, roll: 0, yaw: 0, thr: 1 }, 6, C, true);
    check(p.y > 10, cls + " rolls to Vr in " + t.toFixed(1) + " s, rotates, climbs " + p.y.toFixed(0) + " m");
  }
}
if (fail) { console.error(fail + " plane check(s) failed"); process.exit(1); }
console.log("plane flight check: all good");
