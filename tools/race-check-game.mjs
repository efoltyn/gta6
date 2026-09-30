#!/usr/bin/env node
/* tools/race-check-game.mjs — THE WHOLE PAGE'S LOOP, IN NODE (no browser).

   Loads every src/race file the way games/race.html does, against a stub DOM
   and a stub renderer, and drives the real race_game.js loop frame by frame:
   ?auto=1 (you drive as an AI too), 2 laps. Asserts the race goes grid →
   green → laps → flag → results with no throw and no NaN, and that RACE
   AGAIN starts a fresh grid. Seconds, small memory.                        */
import { createRequire } from "module";
import path from "path";
import fs from "fs";
import vm from "vm";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
let fails = 0;
const check = (n, ok, got) => { if (!ok) fails++; console.log(`${ok ? "  ok  " : "  FAIL"} ${n}${got != null ? "  (" + got + ")" : ""}`); };

globalThis.window = globalThis;
const ctx = new Proxy(function () {}, { get(t, p) { return p === "width" ? 10 : function () { return ctx; }; }, set() { return true; } });
const els = new Map();
function el(id) {
  if (!els.has(id)) {
    const handlers = {};
    els.set(id, {
      id, style: {}, textContent: "", innerHTML: "", className: "", width: 0, height: 0, clientHeight: 800,
      classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
      addEventListener(t, f) { (handlers[t] = handlers[t] || []).push(f); },
      click() { for (const f of handlers.click || []) f({ preventDefault() {} }); },
      appendChild() {}, remove() {}, getContext() { return ctx; }, focus() {},
    });
  }
  return els.get(id);
}
globalThis.document = {
  getElementById: el, createElement: () => el("_c" + Math.random()), querySelectorAll: () => [el("l1"), el("l2"), el("l3"), el("l4"), el("l5")],
  body: el("body"), addEventListener() {},
};
globalThis.location = { search: "?auto=1&laps=2&q=low" + (process.env.CAM ? "&cam=" + process.env.CAM : ""), origin: "http://x", href: "" };
globalThis.screen = { width: 1600, height: 900 };
globalThis.innerWidth = 1600; globalThis.innerHeight = 900; globalThis.devicePixelRatio = 1;
Object.defineProperty(globalThis, "navigator", { value: { maxTouchPoints: 0, getGamepads: () => [] }, configurable: true });
globalThis.addEventListener = () => {};
globalThis.localStorage = { setItem() {}, getItem() { return null; } };
let rafCb = null;
globalThis.requestAnimationFrame = (f) => { rafCb = f; return 1; };
let now = 0;
globalThis.performance = { now: () => now };
globalThis.setTimeout = (f) => { f(); return 0; };

const THREE_ = require(path.join(ROOT, "src/vendor/three.r128.min.js"));
const THREE = globalThis.THREE = Object.assign({}, globalThis.THREE || THREE_);
let draws = 0;
THREE.WebGLRenderer = function () {
  return { domElement: el("canvas"), setPixelRatio() {}, setSize() {}, render() { draws++; }, capabilities: { getMaxAnisotropy: () => 1 } };
};
for (const f of ["race_core", "race_physics", "race_ai", "race_session", "race_car", "race_track", "race_venue", "race_audio", "race_game"]) {
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, "src/race", f + ".js"), "utf8"), { filename: f + ".js" });
}
const RG = window.__race;
check("the page boots and publishes __race", !!RG && !!window.__raceReady);

function run(sec) { const n = Math.round(sec * 60); for (let i = 0; i < n; i++) { now += 1000 / 60; const f = rafCb; rafCb = null; f(now); } }
el("go").click();
check("RACE puts the field on the grid", RG.SES.phase === "grid", RG.SES.phase);
run(8);
check("lights out: green", RG.SES.phase === "race", RG.SES.phase);
let nan = false, maxU = -1e9;
for (let k = 0; k < 80 && RG.SES.phase === "race"; k++) {
  run(1);
  for (const e of RG.entries) { const c = e.car; if (!isFinite(c.pos.x + c.pos.y + c.pos.z + c.yaw)) nan = true; maxU = Math.max(maxU, c.u); }
}
check("the race reaches the results board", RG.S.phase === "results" && RG.SES.phase === "done", RG.S.phase + " after " + RG.SES.raceT.toFixed(1) + " s");
check("no NaN in any car", !nan);
check("nobody through the wall", maxU < RG.core.DIMS.WALL_U + 0.5, maxU.toFixed(2));
const fin = RG.entries.filter((e) => e.finishT).length;
check("cars took the flag", fin >= 8, fin + "/10");
check("frames were drawn", draws > 1000, draws);
el("again").click();
check("RACE AGAIN lays a fresh grid", RG.SES.phase === "grid" && RG.entries.every((e) => e.car.lap === 0 && !e.finishT));
run(3);
console.log(fails ? `\n${fails} FAILED` : "\nall game-loop checks pass");
process.exit(fails ? 1 : 0);
