#!/usr/bin/env node
/* tools/elevator-machine-test.mjs — the lift, proven without a browser.

     node tools/elevator-machine-test.mjs

   Three layers, each with plain-node stubs (no THREE renderer, no DOM):

   1. systems/liftcore.js, the machine itself: call -> (car comes) -> doors
      open -> step in -> floor button -> doors close -> ride -> arrive ->
      doors open -> step out -> doors close; the doorway hold, the cancelled
      trip, the mashed call, a call queued while the car is busy, and the
      island car's Stop (retarget mid-ride).

   2. city/elevators.js, the real file, loaded with a stub THREE and a stub
      building: the lift builds, the call is a pinned "Call" pill over the
      button (NOT a registry card), pressing it opens the ground doors and
      their collider goes passable, the car's panel offers "Roof", the ride
      relocates the rider to the roof cab and opens those doors, stepping
      out closes them and the collider is solid again. With a floor landing
      of its own (the Executive walnut core) the car's panel offers every
      stop, the ride lands in THAT cab's frame, and the view turns with it.
      And the shaft between landings is solid (it was a 160 m pit).

   3. systems/interactions.js, the real file, with a DOM stub: a BOUND pill's
      key fires its act in the capture phase and stops the press, so the
      city's [E] ride router (a bubble-phase listener that boards any car
      within 4.8 m) never sees an [E] pressed at a lift call panel.
*/
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
let pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log("  ok   " + msg); }
  else { fail++; console.log("  FAIL " + msg); }
}
const approx = (a, b, e = 1e-3) => Math.abs(a - b) <= e;

// ===================================================================== 1
console.log("1. liftcore: the machine");
const LiftCore = require(path.join(ROOT, "src/systems/liftcore.js"));
{
  // a 3-stop lift with a scripted world: where the player is, how far the
  // doors are open (they move at 2.4/s like the real rigs), a timed travel
  const W = { inside: -1, doorway: -1, open: [0, 0, 0], target: [0, 0, 0], lit: false, log: [] };
  const io = {
    inside: (i) => W.inside === i,
    doorway: (i) => W.doorway === i,
    doorOpen: (i) => W.open[i],
    door: (i, o) => { W.target[i] = o ? 1 : 0; W.log.push((o ? "open" : "close") + i); },
    seal: (i) => W.log.push("seal" + i),
    travel: (m) => m.t >= 2.0,
    arrive: (i, rode) => W.log.push("arrive" + i + (rode ? "R" : "")),
    lit: (on) => { W.lit = on; },
  };
  const m = LiftCore.create(3, 0);
  const tick = (sec) => {
    for (let t = 0; t < sec; t += 0.05) {
      for (let i = 0; i < 3; i++) {
        W.open[i] = W.open[i] < W.target[i] ? Math.min(W.target[i], W.open[i] + 0.12) : Math.max(W.target[i], W.open[i] - 0.12);
      }
      LiftCore.step(m, 0.05, io);
    }
  };
  ok(LiftCore.call(m, 2, io) && m.st === "come" && W.lit, "Call at stop 2 with the car at 0: the button lights and the car comes");
  tick(2.2);
  ok(m.st === "open" && m.at === 2 && W.target[2] === 1, "the car arrives at 2 and its doors OPEN (the owner's complaint)");
  ok(W.log.includes("arrive2"), "arrival reported for the empty car");
  tick(0.6);
  ok(W.open[2] === 1, "the doors are fully open");
  ok(!LiftCore.go(m, 0, io), "a floor button does nothing unless you are IN the car");
  W.inside = 2; tick(6);
  ok(m.st === "open", "a rider standing in the car holds the doors open (no auto-close on him, no ride without a press)");
  ok(LiftCore.go(m, 0, io) && m.st === "close" && W.target[2] === 0, "floor button 0 in the car: the doors close");
  tick(0.3);
  W.inside = -1; W.doorway = 2; tick(0.1);
  ok(m.st === "open" && W.target[2] === 1 && m.dest === -1, "stepping into the doorway while they close reopens them and cancels the trip");
  W.doorway = -1; W.inside = 2;
  ok(LiftCore.go(m, 0, io), "press again from inside");
  tick(1.0);
  ok(m.st === "ride" && W.log.includes("seal2"), "doors sealed, the car rides");
  tick(2.2);
  ok(m.st === "open" && m.at === 0 && m.arrived && W.target[0] === 1 && W.log.includes("arrive0R"),
    "arrive at 0 with the rider: the doors open there");
  W.inside = 0; tick(3);
  ok(m.st === "open", "the arrival doors hold while the rider is still in the car");
  W.inside = -1;
  for (let i = 0; i < 100 && m.st !== "idle"; i++) tick(0.05);
  ok(m.st === "idle" && W.target[0] === 0 && !W.lit, "rider steps out: the doors close, the car idles, the lights go out");
  ok(!LiftCore.call(m, 0, io), "a call mashed in the beat after the doors shut is refused (no flapping)");
  tick(1.0);
  ok(LiftCore.call(m, 0, io) && m.st === "open", "after the beat, Call at the car's own stop opens it at once");
  // a call from elsewhere while the doors are open and nobody is aboard
  ok(LiftCore.call(m, 1, io) && m.queued === 1, "a call from stop 1 while the car stands open at 0 is queued");
  tick(1.5);
  tick(2.5);
  ok(m.st === "open" && m.at === 1, "the empty car shuts its doors, comes to 1 and opens there");
  // stepping out while closing cancels the ride
  W.inside = 1; LiftCore.go(m, 2, io); W.inside = -1; tick(1.2);
  ok(m.st === "idle" && m.at === 1, "a rider who steps back out before the doors shut is not taken anywhere");
}
{
  // the island car: a real travel with position, retargeted by Stop
  const stops = [0, 3.2, 6.4, 9.6, 12.8];
  const car = { y: 0, v: 0 };
  const m = LiftCore.create(stops.length, 0);
  const W = { inside: true, open: stops.map(() => 0), target: stops.map(() => 0) };
  const io = {
    inside: (i) => W.inside && m.at === i && car.y === stops[i],
    doorOpen: (i) => W.open[i],
    door: (i, o) => { W.target[i] = o ? 1 : 0; },
    travel: (mm, dt) => {
      const goal = stops[mm.dest], dir = goal > car.y ? 1 : -1, rem = (goal - car.y) * dir;
      car.v = Math.min(5.5, car.v + 3.2 * dt, Math.sqrt(Math.max(0, 2 * 3.2 * rem)));
      if (car.v * dt >= rem || rem < 0.004) { car.y = goal; car.v = 0; return true; }
      car.y += dir * car.v * dt; return false;
    },
  };
  const tick = (sec) => {
    for (let t = 0; t < sec; t += 0.05) {
      for (let i = 0; i < stops.length; i++) W.open[i] = W.open[i] < W.target[i] ? Math.min(1, W.open[i] + 0.12) : Math.max(0, W.open[i] - 0.12);
      LiftCore.step(m, 0.05, io);
    }
  };
  LiftCore.call(m, 0, io); tick(0.6);
  ok(LiftCore.go(m, 4, io), "island: Up from the lobby (express to the top)");
  tick(1.0);
  // Stop: the next floor it can still brake for
  const brake = car.v * car.v / (2 * 3.2) + 0.05;
  let k = -1;
  for (let i = 0; i < stops.length; i++) { const a = stops[i] - car.y; if (a >= brake && (k < 0 || a < stops[k] - car.y)) k = i; }
  ok(m.st === "ride" && k > 0 && k < 4, "island: riding, a brakeable floor ahead (" + k + ")");
  m.dest = k; tick(4);
  ok(m.st === "open" && m.at === k && car.y === stops[k] && W.target[k] === 1, "island: Stop lands the car on that floor and opens its doors");
}

// ===================================================================== 2
console.log("2. city/elevators.js: the real file on a stub building");
function makeEnv() {
  class V3 {
    constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
    set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
    copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
  }
  class Geo {
    constructor() { this.attributes = { position: { count: 24 } }; }
    translate() { return this; } rotateX() { return this; } rotateZ() { return this; }
    setAttribute(k, v) { this.attributes[k] = v; } dispose() {}
  }
  class Mesh {
    constructor(g, m) { this.geometry = g; this.material = m; this.position = new V3(); this.scale = new V3(1, 1, 1); this.rotation = new V3(); this.userData = {}; this.children = []; }
    add(c) { this.children.push(c); }
  }
  const THREE = {
    BoxGeometry: Geo, Mesh, Vector3: V3,
    MeshLambertMaterial: class { constructor(o) { Object.assign(this, o || {}); } },
    Color: class { constructor() { this.r = 1; this.g = 1; this.b = 1; } setHex() { return this; } },
    BufferAttribute: class { constructor(a) { this.array = a; } },
  };
  const ups = [];
  const prompts = [];
  const notes = [];
  const CBZ = {
    game: { mode: "city", state: "playing" },
    CONFIG: {},
    onUpdate: (o, fn) => ups.push({ o, fn }),
    onAlways: () => {},
    cmat: (hex, o) => ({ hex, o }),
    colliders: [], platforms: [],
    markCollidersDirty() {}, sfx() {}, shake() {},
    player: { pos: new V3(), vy: 0, dead: false, driving: false },
    cam: { yaw: 0 },
    prisonPrompt: (id, act, verb, opts) => { prompts.push({ id, act, verb, opts }); return true; },
  };
  const win = { CBZ, THREE };
  const ctx = vm.createContext({ window: win, console, Math, Object, Array, Set, Map, JSON, isFinite, Number, String });
  for (const f of ["src/systems/liftcore.js", "src/city/elevators.js"]) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), ctx, { filename: f });
  }
  ups.sort((a, b) => a.o - b.o);
  const frame = (dt = 1 / 60) => { prompts.length = 0; for (const u of ups) u.fn(dt); };
  return { CBZ, THREE, V3, frame, prompts, notes, Mesh };
}
function stubBuilding(env, h, extra) {
  const storeys = Math.round(h / 3.2);
  const floorTops = [0.14]; for (let L = 1; L <= storeys; L++) floorTops.push(L * 3.2);
  const b = Object.assign({
    w: 16, d: 14, h, ox: 100, oz: -40, storeys, floorTops, side: 0, wt: 0.4, hasStairs: false,
    door: { x: 100, z: -47, nx: 0, nz: 1 }, group: new env.Mesh(), clearFloorPoint: () => true,
  }, extra || {});
  const lot = { building: b, cx: b.ox, cz: b.oz };
  env.CBZ.city = { arena: { lots: [lot], elevatorLots: [lot], fireEscapeLots: [] }, note: (t) => env.notes.push(t) };
  return { b, lot };
}
{
  const env = makeEnv(), { CBZ } = env;
  const { b } = stubBuilding(env, 32);
  env.frame();
  const el = CBZ.cityElevators()[0];
  ok(!!el && el.stops.length === 2 && b.lift && b.lift.stops.length === 2, "the lift builds: two landings, ground and roof");
  const P = CBZ.player, g0 = el.stops[0], r0 = el.stops[1];
  ok(g0.rig.solid && g0.rig.col.y0 === 0, "ground doors start shut, collider solid");
  // walk to the ground call pad
  P.pos.set(g0.pad.x, 0.16, g0.pad.z);
  env.frame();
  const call = env.prompts.find((p) => p.id === "lift-call");
  ok(!!call && call.act === "@cityLiftCall" && call.verb === "Call" && call.opts.bind && call.opts.key === "e" && call.opts.city,
    "at the pad: ONE pinned prompt, the verb \"Call\", over the button, bound to [E]");
  ok(call && Math.abs(call.opts.at.x - g0.btnAt.x) < 1e-9 && Math.abs(call.opts.at.y - g0.btnAt.y) < 1e-9, "the prompt is pinned on the call button itself");
  ok(!env.prompts.some((p) => /lift-go/.test(p.id)), "no floor buttons outside the car");
  CBZ.cityLiftCall();
  ok(el.m.st === "open" && g0.rig.target === 1 && g0.btn.material.hex === 0xffc14a, "pressing Call OPENS the doors and lights the button");
  for (let i = 0; i < 40; i++) env.frame();
  ok(g0.rig.open === 1 && !g0.rig.solid && g0.rig.col.y0 >= 1e9, "the doors slide fully open and the door collider goes passable");
  ok(!env.prompts.some((p) => p.id === "lift-call"), "with the doors open the Call pill steps aside (walk in)");
  // walk in
  const inPt = g0.pt(0, 1.0);
  P.pos.set(inPt.x, 0.16, inPt.z);
  env.frame();
  const go = env.prompts.filter((p) => /^lift-go-/.test(p.id));
  ok(go.length === 1 && go[0].verb === "Roof" && go[0].act === "@cityLiftGo0" && go[0].opts.group === "lift-car", "in the car: the panel's button says where it goes (\"Roof\")");
  for (let i = 0; i < 300; i++) env.frame();
  ok(el.m.st === "open", "standing in the car does not ride you anywhere by itself");
  CBZ.cityLiftGo0();
  let rode = false;
  for (let i = 0; i < 600 && !(el.m.st === "open" && el.m.at === 1); i++) { env.frame(); if (el.m.st === "ride") rode = true; }
  ok(rode && el.m.st === "open" && el.m.at === 1, "the doors close, it rides, and it arrives at the roof");
  ok(approx(P.pos.y, r0.floor + 0.04) && approx(P.pos.x, inPt.x) && approx(P.pos.z, inPt.z), "the rider stands in the roof cab, same spot in the room");
  ok(g0.rig.target === 0 && g0.rig.solid, "the ground doors are shut and solid behind him");
  for (let i = 0; i < 40; i++) env.frame();
  ok(r0.rig.open === 1 && !r0.rig.solid, "the roof doors open at arrival");
  ok(env.notes.some((t) => /roof/.test(t)), "arrival note");
  // step out onto the roof
  P.pos.set(r0.pad.x, b.h, r0.pad.z);
  for (let i = 0; i < 120; i++) env.frame();
  ok(el.m.st === "idle" && r0.rig.open === 0 && r0.rig.solid, "stepping out: the roof doors close and seal");
  // THE PIT: the column between the ground head and the roof sill is solid
  const pitCols = CBZ.colliders.filter((c) => c.y0 >= 2.4 && c.y1 <= b.h + 0.01 && c.y1 - c.y0 > 10);
  ok(pitCols.length >= 3, "the shaft between landings carries solid walls (" + pitCols.length + " colliders), not paint over a pit");
  // the ride router is never consulted for the lift: it has no registry zone
  ok(!/registerZone\(/.test(fs.readFileSync(path.join(ROOT, "src/city/elevators.js"), "utf8")), "no registry card for the lift anymore (one control per verb)");
}
{
  // a tower with the Executive walnut core as its own landing (own frame)
  const env = makeEnv(), { CBZ, V3 } = env;
  const Y = 16, backZ = -40 + 3, fz = -40 + 0.5, CW = 0.12;
  const rig = { leaves: [{ m: new env.Mesh(), baseX: 0, baseZ: 0, sx: -1, sz: 0 }, { m: new env.Mesh(), baseX: 0, baseZ: 0, sx: 1, sz: 0 }],
    open: 0, target: 0, autoClose: null, trav: 0.5, col: { y0: Y, y1: Y + 2.2 }, cy0: Y, cy1: Y + 2.2, solid: true };
  const landing = {
    name: "Floor 5", base: Y, floor: Y + 0.02, rig, btn: new env.Mesh(), lamp: null,
    btnIdle: { hex: 1 }, btnLit: { hex: 2 },
    pad: { x: 104, z: fz - 0.9 }, btnAt: { x: 105, y: Y + 1.07, z: fz - 0.05 }, panelAt: { x: 105, y: Y + 1.2, z: fz + 0.2 },
    loc: (x, z) => ({ lat: x - 104, dep: backZ - z }), pt: (lat, dep) => ({ x: 104 + lat, z: backZ - dep }),
    door: backZ - (fz + CW / 2), half: 0.98, fwd: { x: 0, z: -1 },
  };
  const { b } = stubBuilding(env, 32, { execOffice: { floorY: Y, liftLanding: landing } });
  env.frame();
  const el = CBZ.cityElevators()[0];
  ok(el.stops.length === 3 && el.stops[1].own && el.stops[1].name === "Floor 5", "the exec core joins the tower's lift as a middle stop");
  const P = CBZ.player, g0 = el.stops[0];
  P.pos.set(landing.pad.x, Y + 0.02, landing.pad.z);
  env.frame();
  ok(env.prompts.some((p) => p.id === "lift-call"), "Call is offered at the exec core's button");
  CBZ.cityLiftCall();
  ok(el.m.st === "come", "the car is at the lobby: it comes up");
  for (let i = 0; i < 200 && el.m.st !== "open"; i++) env.frame();
  for (let i = 0; i < 40; i++) env.frame();
  ok(el.m.st === "open" && el.m.at === 1 && rig.open === 1 && rig.col.y0 >= 1e9, "...and the walnut core's doors OPEN, its collider passable");
  P.pos.set(104.2, Y + 0.02, backZ - 1.0);
  env.frame();
  const rows = env.prompts.filter((p) => /^lift-go-/.test(p.id)).map((p) => p.verb + ":" + p.opts.key);
  ok(rows.length === 2 && rows[0] === "Ground:e" && rows.includes("Roof:2"), "the car's panel offers every other stop, Ground on [E] (" + rows.join(", ") + ")");
  CBZ.cam.yaw = 0.3;
  CBZ.cityLiftGo0();
  for (let i = 0; i < 700 && !(el.m.st === "open" && el.m.at === 0); i++) env.frame();
  const Lg = g0.loc(P.pos.x, P.pos.z);
  ok(el.m.at === 0 && approx(P.pos.y, g0.floor + 0.04) && Lg.dep > 0.18 && Lg.dep < g0.door - 0.15 && Math.abs(Lg.lat) < 0.9,
    "the ride lands him INSIDE the lobby cab (a different frame, relocated through lat/dep)");
  const yawOf = (v) => Math.atan2(-v.x, -v.z);
  ok(approx(CBZ.cam.yaw, 0.3 + yawOf(g0.fwd) - yawOf(landing.fwd), 1e-6), "the view turns with the room");
}

// ===================================================================== 3
console.log("3. systems/interactions.js: a bound pill owns its key");
{
  class El {
    constructor(tag) { this.tag = tag; this.children = []; this.style = {}; this.attrs = {}; this.parentNode = null; this.textContent = "";
      const cl = new Set(); this.classList = { add: (c) => cl.add(c), remove: (c) => cl.delete(c), contains: (c) => cl.has(c), toggle: (c, on) => (on ? cl.add(c) : cl.delete(c)) }; }
    appendChild(c) { c.parentNode = this; this.children.push(c); return c; }
    removeChild(c) { this.children = this.children.filter((x) => x !== c); c.parentNode = null; }
    setAttribute(k, v) { this.attrs[k] = v; }
    addEventListener() {}
    querySelector() { return null; }
  }
  const doc = { body: new El("body"), getElementById: () => null, createElement: (t) => new El(t) };
  const listeners = [];
  const alw = [], ups = [];
  const CBZ = { game: { mode: "city", state: "playing" }, CONFIG: {}, onAlways: (o, fn) => alw.push({ o, fn }), onUpdate: (o, fn) => ups.push({ o, fn }) };
  const ctx = vm.createContext({
    window: { CBZ }, document: doc, console, Math, Object, Array, Set, Map, JSON, isFinite, Number, String,
    THREE: { Vector3: class { set() { return this; } project() { return this; } } },
    addEventListener: (type, fn, cap) => listeners.push({ type, fn, cap: !!cap }),
  });
  vm.runInContext(fs.readFileSync(path.join(ROOT, "src/systems/interactions.js"), "utf8"), ctx, { filename: "interactions.js" });
  // the city's [E] ride router, as city/interactions.js registers it (bubble)
  let rode = 0, called = 0;
  CBZ.cityLiftCall = () => { called++; };
  listeners.push({ type: "keydown", cap: false, fn: (e) => { if (e.key === "e") rode++; } });
  const cityInter = fs.readFileSync(path.join(ROOT, "src/city/interactions.js"), "utf8");
  ok(/addEventListener\("keydown", function \(e\) \{[\s\S]{0,1600}cityTryNearestRide/.test(cityInter) &&
    !/cityTryNearestRide[\s\S]{0,2400}\}, true\)/.test(cityInter.slice(cityInter.indexOf('addEventListener("keydown"'), cityInter.indexOf('addEventListener("keyup"'))),
    "city/interactions.js's ride router listens in the BUBBLE phase (so a capture listener runs first)");
  function press(key) {
    const ev = { key, repeat: false, metaKey: false, ctrlKey: false, altKey: false, _stop: false,
      preventDefault() {}, stopImmediatePropagation() { this._stop = true; }, stopPropagation() { this._stop = true; } };
    for (const l of listeners) if (l.type === "keydown" && l.cap && !ev._stop) l.fn(ev);
    for (const l of listeners) if (l.type === "keydown" && !l.cap && !ev._stop) l.fn(ev);
  }
  const frame = () => { for (const a of alw.sort((x, y) => x.o - y.o)) a.fn(1 / 60); };
  // no prompt: [E] is the ride router's
  press("e");
  ok(rode === 1 && called === 0, "away from a lift, [E] still reaches the ride router");
  // at the lift: the Call pill is armed and bound
  CBZ.prisonPrompt("lift-call", "@cityLiftCall", "Call", { at: { x: 0, y: 1, z: 0 }, key: "e", bind: true, d2: 0.1, city: true });
  frame();
  press("e");
  ok(called === 1 && rode === 1, "at the call panel, [E] calls the lift and the ride router never sees it (no parked car stolen)");
  // an unbound prompt (the car-door "Drive" pill) never steals a key
  frame(); frame(); frame();                       // the lift pill expires (not re-armed)
  CBZ.prisonPrompt("car-door", "@cityDoorEnter", "Drive", { at: { x: 0, y: 1, z: 0 }, d2: 1, city: true });
  frame();
  press("e");
  ok(rode === 2 && called === 1, "an unbound pill leaves [E] to its owner's router");
  // a group: two floor buttons show together, each on its own key
  CBZ.cityLiftGo0 = () => { called += 10; };
  CBZ.cityLiftGo1 = () => { called += 100; };
  CBZ.prisonPrompt("lift-go-0", "@cityLiftGo0", "Ground", { at: { x: 0, y: 1, z: 0 }, key: "e", bind: true, group: "lift-car", row: 0, d2: 0.01, city: true });
  CBZ.prisonPrompt("lift-go-1", "@cityLiftGo1", "Roof", { at: { x: 0, y: 1, z: 0 }, key: "2", bind: true, group: "lift-car", row: 1, d2: 0.01, city: true });
  frame();
  press("2");
  ok(called === 101, "a panel group shows both buttons and [2] presses the second one");
}

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
