#!/usr/bin/env node
/* tools/car-dyn-sim.mjs — scripted manoeuvres against src/city/cardyn.js.
   Pure node, no browser. Prints per class:
     0-60 mph (s), 60-0 mph braking distance (m), steady-state skid-pad
     (50 m radius-ish, full lock at 20 m/s) lateral g + body roll (deg),
     brake dive (deg), launch squat (deg), handbrake drift at 40 mph
     (peak yaw rate, peak body slip, time to straighten with countersteer),
     top speed reached.
   Usage: node tools/car-dyn-sim.mjs [--trace]                               */
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const CD = require("../src/city/cardyn.js");

// carDynamics() base numbers x playercars FEEL (rarity 0.35) — mirrors vehicles.js
const R = 0.35, topR = 0.88 + R * 0.28, accR = 0.9 + R * 0.22;
function D(base, feel, extra) {
  const f = feel || {};
  const o = {
    accel: base.accel * accR * (f.accel || 1), top: base.top * topR * (f.top || 1),
    turn: base.turn * (f.turn || 1), grip: base.grip * (f.grip || 1), brake: base.brake * (f.brake || 1),
    wheelbase: base.wb, steerLock: base.lock, roll: f.roll != null ? f.roll : base.roll,
    drift: f.drift != null ? f.drift : base.drift, surfMul: 1,
  };
  return Object.assign(o, extra || {});
}
const B = {
  sedan: { accel: 32, top: 35, turn: 2.6, grip: 7.4, brake: 32, wb: 2.62, lock: 0.56, roll: 0.6, drift: 1 },
  coupe: { accel: 42, top: 44, turn: 3.0, grip: 9.4, brake: 38, wb: 2.48, lock: 0.58, roll: 0.4, drift: 0.9 },
  muscle: { accel: 40, top: 41, turn: 2.45, grip: 6.6, brake: 30, wb: 2.78, lock: 0.52, roll: 0.7, drift: 1.35 },
  suv: { accel: 26, top: 31, turn: 2.1, grip: 5.6, brake: 27, wb: 2.9, lock: 0.48, roll: 1.1, drift: 1.05 },
  van: { accel: 23, top: 29, turn: 1.85, grip: 4.8, brake: 24, wb: 3.18, lock: 0.44, roll: 1.3, drift: 1.1 },
  hatch: { accel: 29, top: 31, turn: 2.85, grip: 7.2, brake: 31, wb: 2.42, lock: 0.6, roll: 0.6, drift: 1 },
  semi: { accel: 14, top: 25, turn: 1.05, grip: 3.6, brake: 15, wb: 8.6, lock: 0.30, roll: 1.5, drift: 1.25 },
};
const CARS = [
  ["super (ferrari on coupe)", "super", D(B.coupe, { accel: 1.18, top: 1.2, turn: 1.12, grip: 1.16, brake: 1.12, drift: 0.9, roll: 0.4 })],
  ["sports (porsche)", "sports", D(B.coupe, { accel: 1.12, top: 1.12, turn: 1.16, grip: 1.14, brake: 1.1, drift: 0.95, roll: 0.45 })],
  ["muscle", "muscle", D(B.muscle, { accel: 1.14, top: 1.1, turn: 0.92, grip: 0.88, brake: 0.95, drift: 1.35, roll: 0.7 })],
  ["sedan (tesla-3)", "sedan", D(B.sedan, { accel: 1.1, top: 1, turn: 1.02, grip: 1.04, brake: 1, drift: 0.95, roll: 0.6 })],
  ["hatch", "compact", D(B.hatch, { accel: 1, top: 0.94, turn: 1.1, grip: 1, brake: 1, drift: 1, roll: 0.6 })],
  ["suv", "suv", D(B.suv, { accel: 0.96, top: 0.94, turn: 0.84, grip: 0.86, brake: 0.92, drift: 1.05, roll: 1.15 })],
  ["van", "van", D(B.van, { accel: 0.86, top: 0.88, turn: 0.78, grip: 0.82, brake: 0.86, drift: 1.1, roll: 1.3 })],
  ["semi", "semi", D(B.semi, { accel: 0.58, top: 0.74, turn: 0.52, grip: 0.7, brake: 0.62, drift: 1.25, roll: 1.5 })],
];
const DT = 1 / 60, MPH = 2.23694, deg = (r) => (r * 180 / Math.PI);
const f1 = (x) => (Number.isFinite(x) ? x.toFixed(1) : "—"), f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : "—");

function run(P, S, sp, input, secs, each) {
  const n = Math.round(secs / DT);
  for (let i = 0; i < n; i++) {
    const inp = typeof input === "function" ? input(S, i * DT) : input;
    CD.step(S, inp, P, DT);
    CD.suspStep(sp, S.ax, S.ay, P, DT);
    if (each && each(S, sp, i * DT) === false) return i * DT;
  }
  return secs;
}
function fresh(v) { const S = CD.newState(); S.vx = v || 0; S.rpm = 0.5; return S; }

const rows = [];
for (const [name, kind, d] of CARS) {
  const P = CD.params(d, kind, {});
  const r = { name };
  // 0-60 + squat + top speed
  let S = fresh(0), sp = CD.newSusp(), t50 = NaN, t60 = NaN, squat = 0, burnMax = 0, shifts = 0;
  run(P, S, sp, { throttle: 1 }, 60, (S, sp, t) => {
    if (t < 1.5) squat = Math.min(squat, sp.p);
    if (t < 1.5) burnMax = Math.max(burnMax, S.skid);
    if (S.shifted) shifts++;
    if (isNaN(t60) && S.vx * MPH >= 60) t60 = t;
    if (isNaN(t50) && S.vx * MPH >= 50) t50 = t;
  });
  r.t60 = t60; r.t50 = t50; r.squat = -deg(squat); r.top = S.vx * MPH; r.burn = burnMax; r.shifts = shifts;
  // 60-0
  S = fresh(60 / MPH); S.gear = 3; sp = CD.newSusp(); let dist = 0, dive = 0;
  run(P, S, sp, { brake: 1 }, 20, (S, sp) => { dist += S.vx * DT; dive = Math.max(dive, sp.p); if (S.vx <= 0.05) return false; });
  r.brake = dist; r.dive = deg(dive);
  // skid-pad: hold 18 m/s, full left lock, measure steady lateral g + roll
  S = fresh(18); S.gear = 2; sp = CD.newSusp(); let ay = 0, roll = 0, yr = 0, rollPeak = 0;
  run(P, S, sp, (S) => ({ throttle: Math.max(0, Math.min(1, (18 - S.vx) * 0.25)), steer: 1 }), 6, (S, sp, t) => {
    rollPeak = Math.max(rollPeak, sp.r);
    if (t > 5) { ay = S.ay; roll = sp.r; yr = S.r; }
  });
  r.latg = ay / 9.81; r.roll = deg(roll); r.rollPeak = deg(rollPeak); r.padR = Math.hypot(S.vx, S.vy) / Math.max(1e-3, Math.abs(yr));
  // turning circle at walking pace (kerb radius ≈ path radius of CG)
  S = fresh(3); sp = CD.newSusp();
  run(P, S, sp, (S) => ({ throttle: S.vx < 3 ? 0.3 : 0, steer: 1 }), 4);
  r.circle = 2 * S.vx / Math.max(1e-3, Math.abs(S.r));
  // handbrake drift at 40 mph: steer in + handbrake 0.6 s, then countersteer
  // proportional to body slip with throttle, measure catch.
  S = fresh(40 / MPH); S.gear = 3; sp = CD.newSusp();
  let peakYaw = 0, peakBeta = 0, caught = NaN, spun = false, hdg0 = 0;
  run(P, S, sp, (S, t) => {
    if (t < 0.7) return { steer: 1, handbrake: t < 0.6, throttle: 0 };
    // driver: countersteer by body slip, hold some throttle
    const cs = Math.max(-1, Math.min(1, -S.beta * 2.2 - S.r * 0.25));
    return { steer: -cs * -1 < 0 ? cs : cs, throttle: 0.35 };
  }, 6, (S, sp, t) => {
    peakYaw = Math.max(peakYaw, Math.abs(S.r)); peakBeta = Math.max(peakBeta, Math.abs(S.beta));
    if (Math.abs(S.heading - hdg0) > Math.PI * 0.95) spun = true;
    if (t > 0.8 && isNaN(caught) && Math.abs(S.beta) < 0.05 && Math.abs(S.r) < 0.25) caught = t;
  });
  r.hbYaw = deg(peakYaw); r.hbBeta = deg(peakBeta); r.hbCatch = caught; r.hbSpun = spun; r.hbExit = S.vx * MPH;
  // hands-off after handbrake (no countersteer): does it spin?
  S = fresh(40 / MPH); S.gear = 3; sp = CD.newSusp(); let hdg = 0;
  run(P, S, sp, (S, t) => (t < 0.7 ? { steer: 1, handbrake: t < 0.6 } : { steer: 0 }), 4);
  r.hbHandsOff = deg(S.heading);
  // power-on in a corner (oversteer check): skid-pad then full throttle
  S = fresh(15); S.gear = 1; sp = CD.newSusp(); let betaPow = 0;
  run(P, S, sp, (S, t) => ({ throttle: t < 2 ? 0.3 : 1, steer: 1 }), 3.5, (S) => { betaPow = Math.max(betaPow, Math.abs(S.beta)); });
  r.powBeta = deg(betaPow);
  rows.push(r);
}
const hdr = ["car", "0-50 s", "0-60 s", "top mph", "60-0 m", "dive°", "squat°", "burn", "lat g", "roll°", "rollPk°", "circle m", "HB yaw°/s", "HB β°", "catch s", "spun", "exit mph", "handsoff°", "powβ°"];
console.log(hdr.join(" | "));
for (const r of rows) console.log([r.name, f1(r.t50), f1(r.t60), f1(r.top), f1(r.brake), f2(r.dive), f2(r.squat), f2(r.burn), f2(r.latg), f2(r.roll), f2(r.rollPeak), f1(r.circle), f1(r.hbYaw), f1(r.hbBeta), f2(r.hbCatch), r.hbSpun ? "Y" : "n", f1(r.hbExit), f1(r.hbHandsOff), f1(r.powBeta)].join(" | "));

// ---- traffic at a red light: a gentle 3 m/s^2 stop, then release (the AI
//      path feeds suspStep its measured accel) — dive, then the rebound past
//      level when the car stops (the overshoot a real car nods with). ----
console.log("\ntraffic stop (3 m/s^2 for 3 s, then stopped): dive° | rebound° (nose-up past level) | settle s");
for (const [name, kind, d] of CARS) {
  const P = CD.params(d, kind, {}), sp = CD.newSusp();
  let dive = 0, reb = 0, settle = NaN;
  for (let i = 0; i < 6 / DT; i++) {
    const t = i * DT, ax = t < 3 ? -3 : 0;
    CD.suspStep(sp, ax, 0, P, DT);
    if (t < 3) dive = Math.max(dive, sp.p); else { reb = Math.min(reb, sp.p); if (isNaN(settle) && Math.abs(sp.p) < 0.0015 && Math.abs(sp.pv) < 0.01) settle = t - 3; }
  }
  console.log(name, "|", f2(deg(dive)), "|", f2(-deg(reb)), "|", f2(settle));
}
