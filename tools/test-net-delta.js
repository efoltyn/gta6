"use strict";
// Validates the host-side DELTA snapshotter (networld.js, CBZ.netDelta): an
// unchanged entity is re-sent only at the HEAL cadence (≤2s), a changed entity
// every tick, and NO entity is ever silent longer than the guest's 4000ms
// absence-drop (so deltas can never make a puppet wrongly despawn). Loads the
// real networld.js with minimal stubs and drives the real CBZ._netDeltaRows.
const fs = require("fs");
const path = require("path");

let pass = 0, fail = 0;
const ok = (c, label, info) => { if (c) { pass++; console.log("  ✓ " + label + (info ? " — " + info : "")); } else { fail++; console.error("  ✗ FAIL " + label + (info ? " — " + info : "")); } };

// --- minimal stubs so networld.js loads past its `!window.CBZ.net` guard ---
global.performance = { now: () => Date.now() };
const CBZ = {
  net: { on: () => {}, onEv: () => {}, isHost: () => true, guest: () => false, hasFeat: () => true, players: new Map(), sendTo: () => {}, send: () => {}, sendEv: () => {} },
  game: { mode: "city", state: "playing", wanted: 0 },
  onAlways: () => {},
  lerpAngle: (a, b) => b,
};
global.window = { CBZ, addEventListener: () => {}, performance: global.performance };
function Chainable() {}
["set", "copy", "add", "sub", "subVectors", "addVectors", "applyQuaternion", "normalize",
 "crossVectors", "multiplyScalar", "setFromUnitVectors", "lerp", "clone", "copyFrom"].forEach((m) => { Chainable.prototype[m] = function () { return this; }; });
const Ctor = function () { return new Chainable(); };
Ctor.prototype = Chainable.prototype;
global.THREE = { Vector3: Ctor, Quaternion: Ctor, Euler: Ctor, Object3D: Ctor, Group: Ctor, Mesh: Ctor, Color: Ctor, MeshBasicMaterial: Ctor, BoxGeometry: Ctor };
global.document = { addEventListener: () => {}, createElement: () => ({ getContext: () => ({}) }) };
global.addEventListener = () => {};
global.requestAnimationFrame = () => 0;
global.location = { protocol: "http:", host: "localhost", search: "" };

const src = fs.readFileSync(path.join(__dirname, "..", "src", "net", "networld.js"), "utf8");
try { (0, eval)(src); } catch (e) { console.error("LOAD FAILED:", e && (e.stack || e)); process.exit(1); }

ok(typeof CBZ._netDeltaRows === "function", "delta hook exposed (networld.js loaded clean)");
const deltaRows = CBZ._netDeltaRows;
if (typeof deltaRows !== "function") { console.log("RESULT: 1 FAILED / 0 passed"); process.exit(1); }

// --- drive the real delta over 60 ticks (6s @ 10Hz): ped 1 STILL, ped 2 MOVING ---
CBZ.netDelta = true;
const sm = new Map();
const sends = { 1: [], 2: [] };
let t = 0;
for (let tick = 0; tick < 60; tick++) {
  t += 100;
  const still  = [1, 5, 5, 0, 0, 0, 100];                           // never changes
  const moving = [2, Math.round(tick * 5) / 10, 0, 0, 1.2, 0, 100]; // x changes every tick
  const out = deltaRows([still, moving], sm, t);
  for (const r of out) sends[r[0]].push(t);
}
ok(sends[2].length >= 58, "MOVING entity sent every tick", sends[2].length + "/60");
ok(sends[1].length >= 2 && sends[1].length <= 8, "STATIONARY entity sent only at heal cadence (~20x less)", sends[1].length + "/60");

let maxGap = sends[1][0] || 9e9;                       // first send = gap from t0
for (let i = 1; i < sends[1].length; i++) maxGap = Math.max(maxGap, sends[1][i] - sends[1][i - 1]);
ok(maxGap < 4000, "SAFETY: no entity silent >= the guest's 4000ms drop", "maxGap=" + maxGap + "ms");

// bandwidth proxy: total rows sent with delta vs a full 10Hz dump of 2 entities
const totalSent = sends[1].length + sends[2].length;
ok(totalSent < 120 * 0.6, "delta cuts rows-on-wire vs full dump", totalSent + " vs 120 full");

// scope re-entry: baseline dropped (as on scope-exit) -> next send is a full row
sm.delete(1);
ok(deltaRows([[1, 5, 5, 0, 0, 0, 100]], sm, t + 100).length === 1, "scope re-entry re-sends a full row");

// flag OFF -> full rows (revert == today)
CBZ.netDelta = false;
ok(deltaRows([[1, 5, 5, 0, 0, 0, 100], [2, 9, 9, 0, 0, 0, 100]], new Map(), t).length === 2, "CBZ.netDelta=false -> full rows (revert)");

console.log(fail === 0 ? `RESULT: OK (${pass} checks)` : `RESULT: ${fail} FAILED / ${pass} passed`);
process.exit(fail === 0 ? 0 : 1);
