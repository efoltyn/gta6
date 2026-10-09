// node tools/heli-flight-check.mjs — flies the player helicopter's pure step
// (CBZ.aeroPhysics.heliStep, src/city/aircraftphysics.js) headless:
//   1. hands off for 10 s from a hover: no yaw, no drift
//   2. pure pedal: the nose turns, the airframe stays put
//   3. pedal LEFT turns left (heading increases, the planes' convention)
//   4. a sideways push at cruise banks AND turns that way
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ctx = { window: { CBZ: {} }, Math };
vm.runInNewContext(fs.readFileSync(path.join(root, "src/city/aircraftphysics.js"), "utf8"), ctx);
const A = ctx.window.CBZ.aeroPhysics;
if (!A || !A.heliStep) { console.error("FAIL heliStep missing"); process.exit(1); }

const env = { top: 50, vlift: 16, authority: 1, onGround: false, autorotating: false, sink: 0 };
const DT = 1 / 60;
function fly(st, inp, secs) {
  const p = { x: 0, y: 0, z: 0 };
  for (let i = 0; i < secs / DT; i++) {
    A.heliStep(st, inp, DT, env);
    p.x += st.vx * DT; p.y += st.vy * DT; p.z += st.vz * DT;
  }
  return p;
}
const hover = () => ({ vx: 0, vy: 0, vz: 0, heading: 0.7, yawRate: 0, bank: 0, pitch: 0, roll: 0 });
let fail = 0;
const check = (ok, msg) => { console.log((ok ? "ok   " : "FAIL ") + msg); if (!ok) fail++; };

{
  const st = hover();
  const p = fly(st, { cycF: 0, cycR: 0, pedal: 0, coll: 0 }, 10);
  const drift = Math.hypot(p.x, p.y, p.z);
  check(Math.abs(st.yawRate) < 0.02, "hands off 10 s: |yaw rate| " + Math.abs(st.yawRate).toFixed(4) + " < 0.02");
  check(drift < 0.5, "hands off 10 s: drift " + drift.toFixed(3) + " m < 0.5");
  check(Math.abs(st.heading - 0.7) < 1e-6, "hands off 10 s: heading unchanged");
}
{
  // a hands-off hover that starts MOVING settles, not spins
  const st = hover(); st.vx = 12; st.vz = -6; st.yawRate = 0.8;
  fly(st, { cycF: 0, cycR: 0, pedal: 0, coll: 0 }, 10);
  check(Math.abs(st.yawRate) < 0.02 && Math.hypot(st.vx, st.vz) < 0.1, "release from a turning slide: settles to a still hover");
}
{
  const st = hover();
  const p = fly(st, { cycF: 0, cycR: 0, pedal: 1, coll: 0 }, 3);
  const moved = Math.hypot(p.x, p.y, p.z);
  check(st.heading - 0.7 > 2.5, "pedal left 3 s: heading +" + (st.heading - 0.7).toFixed(2) + " rad (turns left)");
  check(moved < 0.05, "pedal left 3 s: translated " + moved.toFixed(4) + " m (turns in place)");
}
{
  const st = hover();
  fly(st, { cycF: 1, cycR: 0, pedal: 0, coll: 0 }, 8);
  const h0 = st.heading, v = Math.hypot(st.vx, st.vz);
  check(v > 30 && Math.abs(st.heading - 0.7) < 1e-6, "full forward 8 s: " + v.toFixed(1) + " m/s, no heading change");
  check(st.pitch < -0.05, "full forward: nose down (pitch " + st.pitch.toFixed(3) + ")");
  fly(st, { cycF: 1, cycR: 1, pedal: 0, coll: 0 }, 2);
  check(st.heading < h0 - 0.3 && st.roll > 0.1, "cruise + stick right: banks right (" + st.roll.toFixed(2) + ") and turns right (" + (st.heading - h0).toFixed(2) + " rad)");
  const fwd = st.vx * Math.sin(st.heading) + st.vz * Math.cos(st.heading);
  check(fwd / Math.hypot(st.vx, st.vz) > 0.97, "banked turn: the flight path follows the nose");
}
if (fail) { console.error(fail + " heli check(s) failed"); process.exit(1); }
console.log("heli flight check: all good");
