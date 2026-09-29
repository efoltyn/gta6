#!/usr/bin/env node
/* ============================================================
   tools/key-map-check.mjs — ONE KEY, ONE MEANING (Gang City).

   OWNER (2026-09-29): "E does too many things in game life on the keyboard.
   It's very stupid." The key map since then:
     E       the one obvious verb on the thing you are LOOKING at
     hold E  that thing's heavier verb, where one is authored
     F       get in / get out (every ride, every seat)
     Q       the verb wheel: everything you can do to it
   This walks every E / F / Q claimant in the city and asserts that no press
   can mean two things at once.

   PART A — static: the claims that used to collide are gone for good
     (polled E, "[E] Pay" notes, a second Q handler, an E seat exit, an E
     lift button beside a Q one, the help card).
   PART B — live, in plain node: loads the real systems/interactions.js
     (bound pins), city/interactions.js (the card + E/F keys),
     city/verbwheel.js (Q) and systems/seat_exit.js (F out) into one stubbed
     page, stages every context, presses the key through the real listeners
     in capture-then-bubble order, and counts what ACTED. Every press must
     fire at most one thing, and the right one.

   Usage: node tools/key-map-check.mjs      Exit 0 = ok. No browser.
============================================================ */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (p) => readFileSync(path.join(ROOT, p), "utf8");
let fails = 0, passes = 0;
function ok(cond, msg) { if (cond) passes++; else { fails++; console.log("  FAIL " + msg); } }
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'\\])\/\/.*$/gm, "$1");

// ===================================================================== A
console.log("A. static: the old collisions stay gone");
{
  const cityFiles = readdirSync(path.join(ROOT, "src/city")).filter((f) => f.endsWith(".js"));
  const polled = [], qHandlers = [], eNotes = [];
  for (const f of cityFiles) {
    const code = strip(read("src/city/" + f));
    if (/CBZ\.keys\s*&&\s*\(?\s*CBZ\.keys(\.e\b|\[\s*"e"\s*\])|keys\.e\s*\|\||\(keys\.e\b/.test(code)) polled.push(f);
    if (f !== "verbwheel.js" && /\.key[^\n]{0,40}===\s*"q"|k\s*===\s*"q"/.test(code)) qHandlers.push(f);
    if (/note\([^;\n]*"\[(E|Q)\] (Pay|out|draw)/.test(code)) eNotes.push(f);
  }
  ok(!polled.length, "no city file polls the E key (a polled E fires beside whatever else E means): " + polled.join(", "));
  ok(!qHandlers.length, "only city/verbwheel.js reads Q in the city: " + qHandlers.join(", "));
  ok(!eNotes.length, "no key-hint notes for verbs that moved ([E] Pay / [E] out / [Q] draw): " + eNotes.join(", "));
  const seat = strip(read("src/systems/seat_exit.js"));
  const keys = [...seat.matchAll(/kind:\s*"(\w+)",\s*key:\s*("\w"|OUT\(\))/g)].map((m) => m[1] + ":" + m[2]);
  ok(/function OUT\(\)\s*\{\s*return G\(\)\.mode === "city" \? "f"/.test(seat), "seat_exit.js: in the city the way out is F");
  ok(keys.length >= 6 && keys.every((k) => k.endsWith(':"f"') || k.endsWith(":OUT()")), "every seat's way out is F (aircraft) or OUT(): " + keys.join(" "));
  const lift = read("src/city/elevators.js").match(/const ROW_KEYS = \[([^\]]*)\]/);
  ok(lift && !/"q"|"f"/.test(lift[1]) && /"e"/.test(lift[1]), "lift buttons never sit on Q or F: " + (lift && lift[1]));
  const ctl = read("src/systems/controls.js");
  const foot = ctl.slice(ctl.indexOf('C.declare("foot"'), ctl.indexOf('C.declare("plane"'));
  for (const k of ['["E",', '["Hold E",', '["F",', '["Q",']) ok(foot.split(k).length === 2, "the On foot card names " + k + " exactly once");
  const want = { "src/city/interact.js": ["car-get-in", "car-boost", "car-jack"], "src/city/militaryvehicles.js": ["milveh-take"],
    "src/city/wildlife_tame.js": ["animal-mount", "animal-break", "animal-dismount"], "src/city/motorcade.js": ["motorcade-ride"] };
  for (const f in want) {
    const src = read(f);
    for (const id of want[f]) ok(new RegExp('id: "' + id + '"[^\\n]{0,40}ride: true|id: "' + id + '", ride: true').test(src), id + " is an F verb (ride:true)");
  }
  const fps = strip(read("src/systems/fpsmode.js"));
  ok(/k === "f"[^\n]*mode !== "city"/.test(fps), "F is not a trigger in the city (fpsmode.js)");
  ok(/qNow[^\n]*mode !== "city"/.test(fps), "Q is not a weapon swap in the city (fpsmode.js)");
  const pol = strip(read("src/city/police.js"));
  ok(!/toLowerCase\(\) !== "q"/.test(pol), "police.js has no Q draw/holster handler");
}

// ===================================================================== B
console.log("B. live: every context, every key, at most one action");

class El {
  constructor(tag) {
    this.tagName = (tag || "div").toUpperCase(); this.children = []; this.style = {}; this.attrs = {}; this.dataset = {};
    this.parentNode = null; this.textContent = ""; this._html = ""; this.listeners = {};
    const cl = new Set(); this.classList = { add: (c) => cl.add(c), remove: (c) => cl.delete(c), contains: (c) => cl.has(c), toggle: (c, on) => { if (on === undefined) on = !cl.has(c); on ? cl.add(c) : cl.delete(c); } };
  }
  // the verb column's markup (CBZ.cityVerbCluster) becomes real child pills,
  // so city/verbwheel.js can measure and wire them like the page does
  set innerHTML(v) {
    this._html = v; this.children = [];
    const m = /^<div class="([^"]*)">/.exec(String(v || ""));
    if (m) {
      const box = new El("div"); box.classList.add(m[1]);
      const re = /<button type="button" class="([^"]*)"[^>]*>/g; let b;
      while ((b = re.exec(v))) { const pill = new El("button"); pill.className = b[1]; pill.offsetWidth = 96; pill.offsetHeight = 44; box.children.push(pill); }
      box.querySelectorAll = () => box.children.slice();
      this.children.push(box);
    }
  }
  get innerHTML() { return this._html; }
  get firstElementChild() { return this.children[0] || null; }
  appendChild(c) { c.parentNode = this; this.children.push(c); return c; }
  removeChild(c) { this.children = this.children.filter((x) => x !== c); c.parentNode = null; }
  setAttribute(k, v) { this.attrs[k] = v; }
  addEventListener(t, fn) { (this.listeners[t] || (this.listeners[t] = [])).push(fn); }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  closest() { return null; }
}

function makePage() {
  const listeners = [];              // window: { type, fn, cap }
  const upd = [], alw = [];
  const byId = {};
  const doc = {
    body: new El("body"), head: new El("head"),
    getElementById: (id) => byId[id] || (["interact", "interactName", "interactNote", "interactOpts"].includes(id) ? (byId[id] = new El("div")) : null),
    createElement: (t) => new El(t),
    addEventListener: () => {},
    pointerLockElement: null,
  };
  class V3 { constructor() { this.x = 0; this.y = 0; this.z = 0; } set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } project() { this.x = 0; this.y = 0; this.z = 0.5; return this; } }
  const P = { pos: { x: 0, y: 0, z: 0 }, dead: false };
  const CBZ = {
    CONFIG: {}, game: { mode: "city", state: "playing" }, player: P, keys: {},
    cam: { yaw: 0 },                  // forward = (-sin yaw, -cos yaw) = (0, -1): looking toward -z
    camera: { updateMatrixWorld() {} },
    onUpdate: (o, fn) => upd.push({ o, fn }), onAlways: (o, fn) => alw.push({ o, fn }),
    now: 0,
  };
  const sb = {
    window: null, CBZ, document: doc, console, Math, Object, Array, Set, Map, JSON, isFinite, Number, String, Date, RegExp, Error, Promise,
    THREE: { Vector3: V3 }, performance: { now: () => T * 1000 }, setTimeout: () => 0, clearInterval: () => {}, setInterval: () => 0,
    innerWidth: 1280, innerHeight: 800,
    addEventListener: (type, fn, cap) => listeners.push({ type, fn, cap: !!(cap && (cap === true || cap.capture)) }),
  };
  sb.window = sb; sb.window.CBZ = CBZ;
  let T = 0;
  vm.createContext(sb);
  for (const f of ["src/systems/touch_layout.js", "src/systems/interactions.js", "src/systems/seat_exit.js", "src/city/interactions.js", "src/city/verbwheel.js"]) {
    vm.runInContext(read(f), sb, { filename: f });
  }
  const I = CBZ.interactions;
  const acts = [];
  const act = (what) => acts.push(what);
  function step(dt) {
    T += dt; CBZ.now = T * 1000;
    for (const u of upd.slice().sort((a, b) => a.o - b.o)) u.fn(dt);
    for (const a of alw.slice().sort((a, b) => a.o - b.o)) a.fn(dt);
  }
  function key(type, k) {
    const ev = { type, key: k, repeat: false, metaKey: false, ctrlKey: false, altKey: false, target: doc.body, defaultPrevented: false, _stop: false,
      preventDefault() { this.defaultPrevented = true; }, stopImmediatePropagation() { this._stop = true; }, stopPropagation() { this._stop = true; } };
    for (const l of listeners) if (l.type === type && l.cap && !ev._stop) l.fn(ev);
    for (const l of listeners) if (l.type === type && !l.cap && !ev._stop) l.fn(ev);
    return ev;
  }
  function press(k) { acts.length = 0; key("keydown", k); key("keyup", k); return acts.slice(); }
  return { CBZ, I, P, act, acts, step, key, press, sb };
}

// ---- the world for the checks: one person, one car, one horse, a lift pin
function stage(W, opts) {
  const { CBZ, I, act } = W;
  const man = { name: "Ray Cole", pos: { x: 0, y: 0, z: -3 }, group: {}, kind: "civilian" };
  const car = { pos: { x: 3, y: 0, z: 0 }, group: {} };
  const horse = { pos: { x: -3, y: 0, z: 0 }, group: {}, animal: true };
  W.man = man; W.car = car; W.horse = horse;
  I.registerSource({ id: "t-ped", kind: "ped", layers: ["ped:civ", "ped"], prio: 6, driving: false,
    find(px, pz, ctx, push) { if (opts.man) push(man, Math.hypot(man.pos.x - px, man.pos.z - pz)); } });
  I.registerSource({ id: "t-car", kind: "vehicle", layers: ["vehicle"], prio: 3, driving: false,
    find(px, pz, ctx, push) { if (opts.car) push(car, Math.hypot(car.pos.x - px, car.pos.z - pz)); } });
  I.registerSource({ id: "t-horse", kind: "animal", layers: ["animal"], prio: 6, driving: false,
    find(px, pz, ctx, push) { if (opts.horse) push(horse, Math.hypot(horse.pos.x - px, horse.pos.z - pz)); } });
  I.register("ped:civ", { id: "ped-talk", slot: "k", prio: 5, label: "Talk", onSelect: () => act("talk") });
  I.register("ped:civ", { id: "ped-hire", slot: "k", prio: 37, label: "Hire", onSelect: () => act("hire") });
  I.register("ped:civ", { id: "ped-mug", slot: "i", prio: 10, bad: true, label: "Mug", onSelect: () => act("mug") });
  I.register("ped", { id: "order-attack", prio: 30, pick: "person", label: "Attack", onSelect: (a, c, t) => act("order:" + (t && t.name)) });
  I.register("vehicle", { id: "car-get-in", slot: "e", ride: true, label: "Get in", onSelect: () => act("get-in") });
  I.register("animal", { id: "animal-pet", slot: "e", prio: 18, label: "Pet", onSelect: () => act("pet") });
  I.register("animal", { id: "animal-tame", slot: "e", hold: true, prio: 20, label: "Feed & tame", onSelect: () => act("tame") });
  I.register("animal", { id: "animal-mount", ride: true, slot: "i", prio: 22, label: "Ride", onSelect: () => act("mount") });
  CBZ.cityTryNearestRide = () => { if (!opts.car && !opts.router) return false; act("router"); return true; };
  if (opts.pin) {
    CBZ.cityLiftCall = () => act("lift");
    W.armPin = () => CBZ.prisonPrompt("lift-call", "@cityLiftCall", "Call", { at: opts.pin, key: "e", bind: true, d2: 1, city: true });
    W.CBZ.onAlways(40, () => W.armPin());          // the owner re-arms every frame, as elevators.js does
  }
  for (let i = 0; i < 6; i++) W.step(1 / 12);
}
function look(W, x, z) { const P = W.P.pos; W.CBZ.cam.yaw = Math.atan2(-(x - P.x), -(z - P.z)); for (let i = 0; i < 6; i++) W.step(1 / 12); }

// 1. a person ahead, a car to the side
{
  const W = makePage(); stage(W, { man: true, car: true });
  look(W, 0, -3);
  let a = W.press("e");
  ok(a.length === 1 && a[0] === "talk", "on foot facing a stranger: E talks (not Hire, not the car): " + a);
  a = W.press("f");
  ok(a.length === 1 && (a[0] === "router" || a[0] === "get-in"), "same spot: F takes the car, never a verb on the man: " + a);
  a = W.press("i");
  ok(a.length === 0, "I is not an interaction key any more: " + a);
  W.press("q");
  ok(W.CBZ.verbWheel.isOpen(), "Q opens the wheel on the man");
  const few = W.CBZ.verbWheel.audit().verbs;
  ok(few.length <= 5 && few[0] === "Talk", "a few verbs first, the likely one on top: " + few.join(", "));
  if (few.includes("More")) W.press(String(few.indexOf("More") + 1));
  ok(W.CBZ.verbWheel.isOpen(), "More opens the rest in place");
  const verbs = W.CBZ.verbWheel.audit().verbs;
  ok(verbs.includes("Hire") && verbs.includes("Talk") && verbs.includes("Mug") && verbs.includes("Attack"), "the wheel holds every verb he has: " + verbs.join(", "));
  const hireAt = verbs.indexOf("Hire") + 1;
  a = W.press(String(hireAt));
  ok(a.length === 1 && a[0] === "hire" && !W.CBZ.verbWheel.isOpen(), "a number on the wheel fires that one verb and closes it: " + a);
  W.press("q");
  a = W.press("e");
  ok(a.length === 1 && a[0] === "talk", "E with the wheel up fires the wheel's first verb once (the card does not also fire): " + a);
  W.press("q"); W.press("q");
  ok(!W.CBZ.verbWheel.isOpen(), "Q again closes the wheel");
}
// 2. looking at the car, the man at your shoulder
{
  const W = makePage(); stage(W, { man: true, car: true });
  W.car.pos = { x: 0, y: 0, z: -3.5 }; W.man.pos = { x: 3, y: 0, z: 0.5 };
  look(W, 0, -3.5);
  let a = W.press("e");
  ok(a.length === 0, "facing a car: E does nothing (a car's verb is F), the man beside you is not talked to: " + a);
  a = W.press("f");
  ok(a.length === 1 && a[0] === "get-in", "facing a car: F gets in that car: " + a);
}
// 3. two people's worth of priority: the one you look at wins
{
  const W = makePage(); stage(W, { man: true, horse: true });
  W.man.pos = { x: 0, y: 0, z: -3 }; W.horse.pos = { x: 1.6, y: 0, z: 1.2 };   // the horse is CLOSER
  look(W, 0, -3);
  let a = W.press("e");
  ok(a.length === 1 && a[0] === "talk", "the man you face beats the closer horse behind you: " + a);
  look(W, 1.6, 1.2);
  a = W.press("e");
  ok(a.length === 1 && a[0] === "pet", "turn to the horse: E pets it: " + a);
  a = W.press("f");
  ok(a.length === 1 && a[0] === "mount", "F mounts it: " + a);
  W.acts.length = 0; W.key("keydown", "e"); for (let i = 0; i < 8; i++) W.step(0.06); W.key("keyup", "e");
  ok(W.acts.length === 1 && W.acts[0] === "tame", "hold E feeds and tames it (the tap does not also fire): " + W.acts);
}
// 4. a pinned verb (a lift button) vs the card: whichever you face owns E
{
  const W = makePage(); stage(W, { man: true, pin: { x: 0, y: 1, z: 3 } });
  look(W, 0, -3);                                        // facing the man, the button behind you
  let a = W.press("e");
  ok(a.length === 1 && a[0] === "talk", "the man ahead owns E over a lift button behind you: " + a);
  look(W, 0, 3);
  a = W.press("e");
  ok(a.length === 1 && a[0] === "lift", "face the button: E calls the lift, the man is not also talked to: " + a);
}
// 5. seated in a car: E is never the way out, F is, and F boards nothing else
{
  const W = makePage(); stage(W, { car: true, router: true });
  W.P.driving = true; W.P._vehicle = { pos: { x: 0, y: 0, z: 0 }, v: 0 };
  W.CBZ.cityVehicleGetOut = () => { W.act("exit"); return true; };
  for (let i = 0; i < 3; i++) W.step(1 / 12);
  let a = W.press("e");
  ok(!a.includes("exit"), "in a car: E does not throw you out: " + a);
  a = W.press("f");
  ok(a.length === 1 && a[0] === "exit", "in a car: F gets you out and nothing else: " + a);
}
// 6. at the controls of an aircraft: E and Q are the rudder, F is the only exit
{
  const W = makePage(); stage(W, { man: true, car: true });
  W.P._aircraft = { pos: { x: 0, y: 0, z: 0 }, onGround: true }; W.P.driving = true;
  W.CBZ.cityPlayerAircraftExit = () => W.act("exit-air");
  for (let i = 0; i < 3; i++) W.step(1 / 12);
  let a = W.press("e"); ok(a.length === 0, "piloting: E fires nothing (rudder): " + a);
  a = W.press("q"); ok(a.length === 0 && !W.CBZ.verbWheel.isOpen(), "piloting: Q opens nothing (rudder): " + a);
  a = W.press("f"); ok(a.length === 1 && a[0] === "exit-air", "piloting: F is the one exit: " + a);
}
// 7. an order about somebody else: agent first, then the mark, then E
{
  const W = makePage(); stage(W, { man: true });
  const mark = { name: "Vic Lane", pos: { x: 0, y: 0, z: -20 }, group: {}, kind: "civilian" };
  W.CBZ.cityPeds = [W.man, mark];
  look(W, 0, -3);
  W.press("q");
  let verbs = W.CBZ.verbWheel.audit().verbs;
  if (!verbs.includes("Attack") && verbs.includes("More")) { W.press(String(verbs.indexOf("More") + 1)); verbs = W.CBZ.verbWheel.audit().verbs; }
  const n = verbs.indexOf("Attack") + 1;
  let a = W.press(String(n));
  ok(a.length === 0 && W.CBZ.verbWheel.ordering(), "choosing an order does not fire yet: it waits for who: " + a);
  look(W, 0, -20);                                     // the verb is pinned over whoever you look at
  let e0 = W.press("e");
  ok(e0.length === 1 && e0[0] === "order:Vic Lane", "E on the man you point at gives the order about HIM (nothing else fires): " + e0);
  ok(!W.CBZ.verbWheel.ordering(), "and the order is spent");
}
// 8. the E row, per candidate, is unique: no two E taps, no pick on a key
{
  const W = makePage(); stage(W, { man: true, car: true, horse: true });
  for (const [x, z] of [[0, -3], [3, 0], [-3, 0]]) {
    look(W, x, z);
    const rows = W.I.rowsFor();
    const sig = rows.map((r) => r.key + (r.hold ? "H" : ""));
    ok(new Set(sig).size === sig.length, "one row per key at (" + x + "," + z + "): " + sig.join(" "));
    ok(rows.every((r) => r.id !== "order-attack"), "an order about someone else is never on a key");
    ok(rows.every((r) => r.key === "e" || r.key === "f"), "only E and F are keys: " + sig.join(" "));
  }
}

console.log((fails ? "KEY-MAP: FAIL " : "KEY-MAP: OK ") + passes + " passed, " + fails + " failed");
process.exit(fails ? 1 : 0);
