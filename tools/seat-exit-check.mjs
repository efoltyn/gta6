#!/usr/bin/env node
/* tools/seat-exit-check.mjs — EVERY SEAT HAS A WAY OUT, AND IT SAYS SO.

   OWNER: "It should be more clear how to exit the seat you're in; there's no
   button."

   Plain node, no browser. Loads src/systems/seat_exit.js (and
   src/city/passengerseat.js for the car/boat verb) into a stubbed CBZ and, for
   every kind of seat, asserts:
     1. CBZ.seatState() reports the right kind, KEY and VERB
     2. the capture-phase keydown for that key fires the owning system's exit
        and CONSUMES the press (a bench's E must never reach the ride router)
     3. the wrong key does nothing (E in a cockpit is the rudder)
     4. the per-frame tick pins "[KEY] verb" through CBZ.prisonPrompt on a
        desktop, and shows ONE #tExit wearing the verb on touch, whose tap
        fires the same exit
   plus the car verb ladder (Get out / Jump / Pull over / boat Get up) and
   the static fact that no second exit button survives in touch_vehicle.js.

   Usage: node tools/seat-exit-check.mjs     Exit 0 = ok.                  */
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (p) => readFileSync(path.join(ROOT, p), "utf8");
let fails = 0, passes = 0;
function ok(cond, msg) { if (cond) passes++; else { fails++; console.log("  FAIL " + msg); } }

// ---- a tiny DOM: enough for one button and the key listener ---------------
function makeWorld(opts) {
  opts = opts || {};
  const listeners = [];
  const els = [];
  function el(tag) {
    const e = {
      tagName: tag.toUpperCase(), style: {}, id: "", type: "", textContent: "",
      _h: {}, children: [],
      classList: {
        _s: new Set(),
        add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
        contains(c) { return this._s.has(c); },
        toggle(c, on) { if (on === undefined ? !this._s.has(c) : on) this._s.add(c); else this._s.delete(c); },
      },
      addEventListener(t, fn) { (this._h[t] || (this._h[t] = [])).push(fn); },
      fire(t) {
        const ev = { preventDefault() {}, stopPropagation() {} };
        (this._h[t] || []).forEach((fn) => fn(ev));
      },
      appendChild(c) { this.children.push(c); els.push(c); return c; },
    };
    return e;
  }
  const body = el("body");
  if (opts.touch) body.classList.add("touch");
  const document = { body, createElement: el, getElementById: (id) => els.find((x) => x.id === id) || null };
  const always = [];
  const prompts = [];
  const CBZ = {
    CONFIG: {}, game: { state: "playing", mode: "city" }, touchMode: !!opts.touch,
    player: { pos: { x: 0, y: 0, z: 0, set() {} }, dead: false },
    onAlways(order, fn) { always.push({ order, fn }); },
    onUpdate() {},
    prisonPrompt(id, act, verb, o) { prompts.push({ id, act, verb, key: o.key, at: o.at, d2: o.d2, city: o.city }); return true; },
    camera: null,
  };
  const window = { CBZ, THREE: null };
  const sandbox = {
    window, CBZ, document, console, Date, Math,
    addEventListener(type, fn, capture) { listeners.push({ type, fn, capture: !!capture }); },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(read("src/systems/seat_exit.js"), sandbox, { filename: "seat_exit.js" });
  function press(key) {
    let stopped = false, prevented = false;
    const ev = { key, repeat: false, target: body, preventDefault() { prevented = true; }, stopImmediatePropagation() { stopped = true; } };
    for (const l of listeners) if (l.type === "keydown") l.fn(ev);
    return { stopped, prevented };
  }
  function tick() { prompts.length = 0; always.sort((a, b) => a.order - b.order).forEach((a) => a.fn(0.016)); }
  const captureKeydown = listeners.some((l) => l.type === "keydown" && l.capture);
  return { CBZ, document, press, tick, prompts, els, captureKeydown };
}

// ---- the seat table ------------------------------------------------------
const CASES = [
  { name: "aircraft on the apron", kind: "aircraft", key: "f", verb: "Get out", wrong: "e",
    set(C, hit) { C.player._aircraft = { pos: { x: 5, y: 0, z: 5 }, onGround: true }; C.player.driving = true; C.cityPlayerAircraftExit = () => hit("aircraft"); } },
  { name: "aircraft in the air", kind: "aircraft", key: "f", verb: "Jump", wrong: "e",
    set(C, hit) { C.player._aircraft = { pos: { x: 5, y: 400, z: 5 }, onGround: false, vy: -2, speed: 80 }; C.player.driving = true; C.cityPlayerAircraftExit = () => hit("aircraft"); } },
  { name: "tank", kind: "armor", key: "e", verb: "Climb out", wrong: "f",
    set(C, hit) { C.player.driving = true; C.cityArmorActive = () => true; C.cityArmorRec = () => ({ kind: "tank", pos: { x: 1, y: 0, z: 1 } }); C.cityExitArmor = () => hit("armor"); } },
  { name: "armored truck", kind: "armor", key: "e", verb: "Get out", wrong: "f",
    set(C, hit) { C.player.driving = true; C.cityArmorActive = () => true; C.cityArmorRec = () => ({ kind: "truck", pos: { x: 1, y: 0, z: 1 } }); C.cityExitArmor = () => hit("armor"); } },
  { name: "car, driver, parked", kind: "vehicle", key: "e", verb: "Get out", wrong: "f",
    set(C, hit) { C.player.driving = true; C.player._vehicle = { pos: { x: 2, y: 0, z: 2 }, v: 0 }; C.cityVehicleGetOutVerb = () => "Get out"; C.cityVehicleGetOut = () => { hit("vehicle"); return true; }; } },
  { name: "car, passenger, moving", kind: "vehicle", key: "e", verb: "Jump", wrong: "f",
    set(C, hit) { C.player.driving = true; C.player._vehicle = { pos: { x: 2, y: 0, z: 2 }, v: 14 }; C.cityVehicleGetOutVerb = () => "Jump"; C.cityVehicleGetOut = () => { hit("vehicle"); return true; }; } },
  { name: "motorcade state car (chauffeured shotgun)", kind: "vehicle", key: "e", verb: "Get out", wrong: "f",
    set(C, hit) { C.player.driving = true; C.player._vehicle = { pos: { x: 2, y: 0, z: 2 }, v: 0, npcDriver: {} }; C.cityVehicleGetOutVerb = () => "Get out"; C.cityVehicleGetOut = () => { hit("vehicle"); return true; }; } },
  { name: "boat at the helm", kind: "vehicle", key: "e", verb: "Get up", wrong: "f",
    set(C, hit) { C.player.driving = true; C.player._vehicle = { pos: { x: 2, y: 0, z: 2 }, v: 0, _hullSpec: {} }; C.cityVehicleGetOutVerb = () => "Get up"; C.cityVehicleGetOut = () => { hit("vehicle"); return true; }; } },
  { name: "car without passengerseat.js (fallback verb + exit)", kind: "vehicle", key: "e", verb: "Get out", wrong: "f",
    set(C, hit) { C.player.driving = true; C.player._vehicle = { pos: { x: 2, y: 0, z: 2 }, v: 0 }; C.cityExitVehicle = () => hit("vehicle"); } },
  { name: "horse", kind: "mount", key: "e", verb: "Get off", wrong: "f",
    set(C, hit) { C.player._mountedAnimal = { pos: { x: 3, y: 0, z: 3 } }; C.cityDismount = () => hit("mount"); } },
  { name: "bench (city seat / exec chair / prop seat)", kind: "seat", key: "e", verb: "Stand up", wrong: "f",
    set(C, hit) { C.player._propSeat = { x: 4, y: 0.45, z: 4 }; C.propArcActive = () => false; C.propStand = (a) => { if (a === C.player) hit("seat"); }; } },
  { name: "bunk / bed", kind: "bed", key: "e", verb: "Get up", wrong: "f",
    set(C, hit) { C.player._propBed = { x: 4, y: 0.6, z: 4 }; C.propArcActive = () => false; C.propWake = (a) => { if (a === C.player) hit("bed"); }; C.propStand = () => hit("WRONG"); } },
];

for (const touch of [false, true]) {
  for (const c of CASES) {
    const tag = (touch ? "[touch] " : "[desk]  ") + c.name;
    const W = makeWorld({ touch });
    const hits = [];
    c.set(W.CBZ, (k) => hits.push(k));
    ok(W.captureKeydown, tag + ": the exit key listener is capture-phase");
    const st = W.CBZ.seatState();
    ok(st && st.kind === c.kind, tag + ": kind " + (st && st.kind) + " want " + c.kind);
    ok(st && st.key === c.key, tag + ": key " + (st && st.key) + " want " + c.key);
    ok(st && st.verb === c.verb, tag + ": verb " + (st && st.verb) + " want " + c.verb);
    ok(st && !/[—·]/.test(st.verb), tag + ": no em dash / middle dot in the verb");

    W.tick();
    if (!touch) {
      const p = W.prompts.find((x) => x.id === "seat-exit");
      ok(!!p, tag + ": desktop pins a seat-exit prompt");
      ok(p && p.verb === c.verb && p.key === c.key.toUpperCase() && p.act === "@seatExit", tag + ": prompt reads [" + (p && p.key) + "] " + (p && p.verb));
      ok(p && p.city === true && p.d2 === 0, tag + ": prompt is city-safe and wins the one-pill arbitration");
      ok(!W.document.getElementById("tExit") || W.document.getElementById("tExit").style.display === "none", tag + ": no touch button on a desktop");
    } else {
      ok(!W.prompts.some((x) => x.id === "seat-exit"), tag + ": touch never also arms the pinned pill (one button)");
      const b = W.document.getElementById("tExit");
      ok(!!b && b.style.display !== "none", tag + ": #tExit shown");
      ok(b && b.textContent === c.verb.toUpperCase(), tag + ": #tExit wears " + (b && b.textContent));
      hits.length = 0;
      b && b.fire("touchend");
      ok(hits.length === 1 && hits[0] === c.kind, tag + ": #tExit tap fired " + hits.join(","));
    }

    // wrong key does nothing and is not swallowed
    hits.length = 0;
    const r0 = W.press(c.wrong);
    ok(hits.length === 0 && !r0.stopped, tag + ": [" + c.wrong.toUpperCase() + "] is left alone");
    // right key exits and is consumed
    const r1 = W.press(c.key);
    ok(hits.length === 1 && hits[0] === c.kind, tag + ": [" + c.key.toUpperCase() + "] fired " + hits.join(","));
    ok(r1.stopped && r1.prevented, tag + ": the press is consumed (never reaches the ride router)");
  }
}

// ---- not seated / not playing / mid-transition: nothing shows ------------
{
  const W = makeWorld({ touch: true });
  ok(W.CBZ.seatState() === null, "on foot: seatState is null");
  W.tick();
  const b = W.document.getElementById("tExit");
  ok(!b || b.style.display === "none", "on foot: no #tExit");
  const hits = [];
  CASES[10].set(W.CBZ, (k) => hits.push(k));
  W.CBZ.propArcActive = () => true;
  ok(W.CBZ.seatState() === null, "sitting-down transition: no verb (the body is committed)");
  W.CBZ.propArcActive = () => false;
  W.CBZ.game.state = "paused";
  W.tick();
  ok(W.document.getElementById("tExit") == null || W.document.getElementById("tExit").style.display === "none", "paused: #tExit hidden");
  const r = W.press("e");
  ok(hits.length === 0 && !r.stopped, "paused: E does nothing");
  W.CBZ.game.state = "playing";
  W.CBZ.game.mode = "sharksim";
  delete W.CBZ.player._propSeat;
  CASES[9].set(W.CBZ, (k) => hits.push(k));
  ok(W.CBZ.seatState() === null, "shark sim: the forced mount offers no Get off");
}

// ---- priority: a cockpit outranks the car flags it also sets -------------
{
  const W = makeWorld({});
  const hits = [];
  CASES[4].set(W.CBZ, (k) => hits.push(k));
  CASES[0].set(W.CBZ, (k) => hits.push(k));
  ok(W.CBZ.seatState().kind === "aircraft", "aircraft outranks vehicle");
  ok(W.CBZ.seatExit() === true && hits[0] === "aircraft", "seatExit() dispatches to the aircraft");
}

// ---- passengerseat.js: the verb ladder walks cityVehicleGetOut's branches --
{
  const listeners = [];
  const exits = [];
  const P = { pos: { x: 0, y: 0, z: 0 }, dead: false, driving: true };
  const CBZ = {
    CONFIG: {}, game: { state: "playing", mode: "city" }, player: P,
    onUpdate() {}, onAlways() {},
    city: { note() {} },
    cityExitVehicle() { exits.push("exit"); P.driving = false; P._vehicle = null; },
    boatStandUp(car) { exits.push("deck"); P.driving = false; P._vehicle = null; return true; },
    cityCarPullover() {},
  };
  const sb = { window: { CBZ }, CBZ, console, Math, addEventListener(t, fn) { listeners.push(fn); } };
  sb.globalThis = sb;
  vm.createContext(sb);
  vm.runInContext(read("src/city/passengerseat.js"), sb, { filename: "passengerseat.js" });
  ok(typeof CBZ.cityVehicleGetOutVerb === "function", "passengerseat publishes cityVehicleGetOutVerb");
  const car = { pos: { x: 0, z: 0 }, v: 0, vx: 0, vz: 0, heading: 0 };
  P._vehicle = car;
  ok(CBZ.cityVehicleGetOutVerb() === "Get out", "parked car verb: " + CBZ.cityVehicleGetOutVerb());
  car.vx = 12;
  ok(CBZ.cityVehicleGetOutVerb() === "Jump", "moving car verb: " + CBZ.cityVehicleGetOutVerb());
  const boat = { pos: { x: 0, z: 0 }, v: 0, vx: 0, vz: 0, heading: 0, _hullSpec: {} };
  P._vehicle = boat; P.driving = true;
  ok(CBZ.cityVehicleGetOutVerb() === "Get up", "moored boat verb: " + CBZ.cityVehicleGetOutVerb());
  exits.length = 0;
  CBZ.cityVehicleGetOut();
  ok(exits.join() === "deck", "moored boat exit stands you on the deck, not in the sea: " + exits.join());
  const car2 = { pos: { x: 0, z: 0 }, v: 0, vx: 0, vz: 0, heading: 0 };
  P._vehicle = car2; P.driving = true; exits.length = 0;
  CBZ.cityVehicleGetOut();
  ok(exits.join() === "exit", "parked car exit is the plain step-out: " + exits.join());
  P._vehicle = null; P.driving = false;
  ok(CBZ.cityVehicleGetOutVerb() === null, "on foot: no vehicle verb");
}

// ---- static: exactly one exit button, no duplicate key paths -------------
{
  const tv = read("src/systems/touch_vehicle.js");
  ok(!/"tvExit"|"tvGetUp"|"tvDismount"|function doExit/.test(tv), "touch_vehicle.js draws no EXIT / GET UP / DISMOUNT pill of its own");
  const mv = read("src/city/militaryvehicles.js");
  ok(!/if \(k === "e"\) \{ e\.preventDefault\(\); exitArmor\(\); \}/.test(mv), "militaryvehicles.js has no second armor [E] listener");
  ok(/CBZ\.seatExit && CBZ\.seatExit\(\)/.test(mv), "the ride router exits through CBZ.seatExit");
  const ia = read("src/city/interact.js");
  ok(!/id: "src-propself"|id: "car-out"/.test(ia), "interact.js keeps no silent stand-up / step-out rows");
  const idx = read("index.html");
  ok(/src\/systems\/seat_exit\.js/.test(idx), "index.html loads seat_exit.js");
}

console.log((fails ? "SEAT-EXIT: FAIL " : "SEAT-EXIT: OK ") + passes + " passed, " + fails + " failed");
process.exit(fails ? 1 : 0);
