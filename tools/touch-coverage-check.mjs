#!/usr/bin/env node
/* ============================================================
   tools/touch-coverage-check.mjs — EVERY KEY VERB HAS A FINGER (Gang City).

   OWNER (2026-09-29): "in touch you can't interact with enough things. A lot
   of things are only interactable with the keyboard, with E, and nothing pops
   up. When I touch something, I should see interaction options with it when I
   tap it. Most things."

   The rule since then: a verb lives in ONE place, the interaction registry
   (city/interactions.js), and a tap asks that registry what is under the
   finger (CBZ.interactions.tapPick, systems/touch.js tapWorld). So a verb the
   keyboard can reach is a verb a finger can reach, by construction. This
   check holds both halves:

   PART A, static census (every file of the city runtime):
     1. every read of an interaction key (E, F, G, H) is accounted for: the
        registry's own keys, a modal panel's own close key, a vehicle/flight
        control with its touch button, or a mission key with its touch path.
        An unlisted reader FAILS (that is how the store counters' private E
        listeners, the [G] property key and the [H] front door hid for months).
     2. the systems that used to keep a private look-pick + prompt div + E
        listener (gun wall, racks, cases, bank, pawn desks, shelves, chests,
        FX counters, properties, the front door, the hitman's hand verbs, the
        parked aircraft) are registry candidates now, and their private
        prompt code is gone.
     3. every verb pinned on a thing in the city (CBZ.prisonPrompt, city:true)
        names an @fn act, so its pill is a tappable button.
     4. systems/touch.js's world tap goes through tapPick and walks to what it
        picked when it is out of reach.
   PART B, live in plain node: the real systems/interactions.js,
     city/verbword.js, city/interactions.js and city/verbwheel.js in one
     stubbed page with a real pinhole camera. Every kind of candidate is
     staged (a person, a car, a horse, a counter wall of fixtures, a zone on a
     place, a positionless zone, a far ATM). For each: the verbs the keyboard
     reaches (E, hold E, F, and the Q wheel) must ALL be reachable by tapping
     the thing, with the camera looking the other way. Coverage must be 100%.

   Usage: node tools/touch-coverage-check.mjs      Exit 0 = ok. No browser.
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
console.log("A. static: every key verb in the city has a touch path");
const CITY = readdirSync(path.join(ROOT, "src/city")).filter((f) => f.endsWith(".js")).map((f) => "src/city/" + f).concat(["src/sim/forex.js"]);
/* Every file allowed to read E / F / G / H, what it reads them for, and the
   touch path of that verb. `guard` must appear in the file: the proof that a
   modal reader only reads while its own panel is up. */
const ALLOW = {
  "src/city/interactions.js": { keys: "ef", why: "the registry's own E / hold E / F", touch: "tapPick -> verbWheel" },
  "src/city/verbwheel.js": { keys: "e", why: "the wheel is modal: E fires its highlighted verb", touch: "the wheel's own pills", guard: "if (!W.open) return;" },
  "src/city/bank.js": { keys: "e", why: "the loan panel closes on E", touch: "its close button", guard: "if (!S.panelOpen) return;" },
  "src/city/clothingstore.js": { keys: "e", why: "the wardrobe panel's keys", touch: "its rows", guard: "if (!S.panelOpen) return;" },
  "src/city/gunmods.js": { keys: "e", why: "the gunsmith bench closes on E", touch: "its rows", guard: "if (!panel || panel.style.display !== \"block\") return;" },
  "src/city/inventory.js": { keys: "e", why: "the chest panel closes on E", touch: "its close button", guard: "if (!openChestRef) return;" },
  "src/city/modshop.js": { keys: "e", why: "the mod garage panel closes on E", touch: "its rows", guard: "if (!S.open) return;" },
  "src/city/shops.js": { keys: "e", why: "the counter menu closes on E", touch: "its rows", guard: "if (!openLot) return;" },
  "src/sim/forex.js": { keys: "e", why: "the FX panel closes on E", touch: "its close button", guard: "if (!V.panelOpen) return;" },
  "src/city/boatyard.js": { keys: "f", why: "the boatyard panel's Fleet tab", touch: "its tab", guard: "if (!open_) return;" },
  "src/city/empire.js": { keys: "f", why: "the car lot menu's recondition", touch: "its rows", guard: "if (!menuOpen || !k) return false;" },
  "src/city/wealth.js": { keys: "gh", why: "the wealth panel's own keys", touch: "its rows", guard: "if (open_) { if (pressKey(k)) e.preventDefault(); return; }" },
  "src/city/hitman_hands.js": { keys: "e", why: "the inspect view and the held paper are modal (their E); world verbs are registry zones", touch: "the inspect caption pill", guard: "if (I.active) {" },
  "src/city/combat.js": { keys: "g", why: "G throws a grenade (a weapon, not a verb on a thing)", touch: "the hotbar grenade cell + fire" },
  "src/city/passengerseat.js": { keys: "g", why: "G slides seats while riding (a vehicle control)", touch: "the SEAT pill (touch_vehicle.js)", guard: "if (!P.driving && !P._aircraft) return;" },
  "src/city/bailout.js": { keys: "f", why: "F cuts the canopy away mid-fall (a flight control)", touch: "the parachute's touch control", guard: "if (F.active && F.phase === \"canopy\") cutAway();" },
  "src/city/heists.js": { keys: "h", why: "H is the heist board and the job's beats (a mission key)", touch: "zone-heist: go loud / grab and go on the target (tap it)" },
};
const KEYRE = /(?:\bk|\bkey|\bkk|\bch|\blk|e\.key|toLowerCase\(\))\s*[!=]==?\s*"([a-z])"|e\.code\s*[!=]==\s*"Key([A-Z])"/g;
{
  let readers = 0;
  for (const f of CITY) {
    const raw = read(f), code = strip(raw);
    const got = new Set();
    let m; KEYRE.lastIndex = 0;
    while ((m = KEYRE.exec(code))) { const k = (m[1] || m[2]).toLowerCase(); if ("efgh".includes(k)) got.add(k); }
    if (!got.size) continue;
    readers++;
    const a = ALLOW[f];
    ok(!!a, f + " reads " + [...got].join("/").toUpperCase() + " and is not in the census: a key verb with no touch path? Register it (CBZ.interactions) or list it here with its touch path");
    if (!a) continue;
    for (const k of got) ok(a.keys.includes(k), f + " reads " + k.toUpperCase() + " but the census only allows " + a.keys.toUpperCase() + " (" + a.why + ")");
    if (a.guard) ok(raw.includes(a.guard), f + ": the modal guard is still there (" + a.guard + ")");
  }
  console.log("  " + readers + " files read E/F/G/H; every one has a touch path");

  // 2. the private look-picks are gone, the registry has them
  const FIXTURES = {
    "src/city/gunstore.js": ["registerFixtures", "gunwall"],
    "src/city/bank.js": ["registerFixtures", "bank-station"],
    "src/city/clothingstore.js": ["registerFixtures", "clothes-rack"],
    "src/city/jewelry.js": ["registerFixtures", "jewel-case"],
    "src/city/pawnshop.js": ["registerFixtures", "pawn-desk"],
    "src/city/buildings.js": ["registerFixtures", "shop-shelf"],
    "src/city/inventory.js": ["registerFixtures", "chest", "ground-item"],
    "src/sim/forex.js": ["registerFixtures", "fx-counter"],
    "src/city/storage.js": ["registerZone", "zone-property"],
    "src/city/realestate.js": ["registerZone", "zone-home-door"],
    "src/city/heists.js": ["registerZone", "zone-heist"],
    "src/city/hitman_hands.js": ["registerZone", "\"hm-\""],
    "src/city/playeraircraft.js": ["registerSource", "src-owned-aircraft"],
  };
  for (const f in FIXTURES) {
    const code = strip(read(f));
    for (const needle of FIXTURES[f]) ok(code.includes(needle), f + " is in the registry (" + needle + ")");
    ok(!/function (pickSlot|pickStation|pickDesk|pickCase)\b/.test(code), f + ": no private look-pick left");
    ok(!/touchPromptHTML|touchActionPrompt/.test(code), f + ": no private prompt pill left");
    ok(!/\.id = "(gunstorePrompt|bankPrompt|clothingPrompt|jewelryPrompt|pawnPrompt|shopliftPrompt|fxPrompt|cityStoragePrompt|cityAircraftPrompt|ci2Chip)"/.test(code), f + ": its prompt div is gone");
  }
  const heist = strip(read("src/city/heists.js"));
  ok(!/cityHomeNear/.test(heist), "heists.js no longer steps around a private [H] front door");
  const re = strip(read("src/city/realestate.js"));
  ok(!/toLowerCase\(\) === "h"/.test(re), "realestate.js: the front door is not a private [H] any more");
  const st = strip(read("src/city/storage.js"));
  ok(!/k === "g"/.test(st), "storage.js: the property menu is not on G (G is the grenade)");

  // 3. every verb pinned on a thing in the city is a tappable @fn pill
  let pins = 0;
  for (const f of CITY.concat(["src/systems/seat_exit.js", "src/systems/climb.js", "src/entities/towerwatch.js", "src/world/disaster_arena.js"])) {
    const code = strip(read(f));
    const reP = /CBZ\.prisonPrompt\(\s*([^,]+),\s*([^,]+),/g;
    let m;
    while ((m = reP.exec(code))) {
      pins++;
      const act = m[2].trim();
      ok(/^"@|^\("@|"@/.test(act) || /^[A-Za-z_.]+$/.test(act), f + ": pin " + m[1].trim() + " names an @fn act (a tappable pill): " + act);
    }
  }
  console.log("  " + pins + " pinned verbs, each a tappable pill");

  // 4. the world tap is the registry's
  const touch = strip(read("src/systems/touch.js"));
  ok(/CBZ\.interactions\.tapPick\(x, y,/.test(touch), "systems/touch.js tapWorld asks CBZ.interactions.tapPick what is under the finger");
  ok(/startWalk\("cand", pk\.cand\)/.test(touch), "a tapped thing out of reach is walked to, then opened");
  ok(!/interactions\.pickAt/.test(touch), "the old screen-radius pick over in-reach candidates only is gone");
  ok(/#verbWheel/.test(touch), "a tap on the verb column never becomes a world tap or a look drag");
}

// ===================================================================== B
console.log("B. live: every verb the keys reach, a finger reaches");

class El {
  constructor(tag) {
    this.tagName = (tag || "div").toUpperCase(); this.children = []; this.style = {}; this.attrs = {}; this.dataset = {};
    this.parentNode = null; this.textContent = ""; this._html = ""; this.listeners = {};
    const cl = new Set(); this.classList = { add: (c) => cl.add(c), remove: (c) => cl.delete(c), contains: (c) => cl.has(c), toggle: (c, on) => { if (on === undefined) on = !cl.has(c); on ? cl.add(c) : cl.delete(c); } };
  }
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
  getBoundingClientRect() { return { left: 0, top: 0, width: 0, height: 0 }; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  closest() { return null; }
}

const W = 1180, H = 820, FOV = 60 * Math.PI / 180, EYE = 1.7, PITCH = -0.12;
function makePage() {
  const listeners = [], upd = [], alw = [], byId = {};
  const doc = {
    body: new El("body"), head: new El("head"),
    getElementById: (id) => byId[id] || (["interact", "interactName", "interactNote", "interactOpts"].includes(id) ? (byId[id] = new El("div")) : null),
    createElement: (t) => new El(t), addEventListener: () => {}, querySelectorAll: () => [], pointerLockElement: null,
  };
  const P = { pos: { x: 0, y: 0, z: 0 }, dead: false };
  const CBZ = {
    CONFIG: {}, game: { mode: "city", state: "playing" }, player: P, keys: {}, touchMode: true,
    cam: { yaw: 0 }, onUpdate: (o, fn) => upd.push({ o, fn }), onAlways: (o, fn) => alw.push({ o, fn }), now: 0,
  };
  // a real pinhole camera at the player's eye, looking along cam.yaw
  const F = (H / 2) / Math.tan(FOV / 2);
  function basis() {
    const y = CBZ.cam.yaw, cp = Math.cos(PITCH), sp = Math.sin(PITCH);
    const fwd = { x: -Math.sin(y) * cp, y: sp, z: -Math.cos(y) * cp };
    const right = { x: Math.cos(y), y: 0, z: -Math.sin(y) };
    const up = { x: right.y * fwd.z - right.z * fwd.y, y: right.z * fwd.x - right.x * fwd.z, z: right.x * fwd.y - right.y * fwd.x };
    return { o: { x: P.pos.x, y: P.pos.y + EYE, z: P.pos.z }, fwd, right, up };
  }
  CBZ.camera = { updateMatrixWorld() {} };
  class V3 {
    constructor(x, y, z) { this.x = x || 0; this.y = y || 0; this.z = z || 0; }
    set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
    project() {
      const b = basis(), d = { x: this.x - b.o.x, y: this.y - b.o.y, z: this.z - b.o.z };
      const zf = d.x * b.fwd.x + d.y * b.fwd.y + d.z * b.fwd.z;
      const xr = d.x * b.right.x + d.y * b.right.y + d.z * b.right.z;
      const yu = d.x * b.up.x + d.y * b.up.y + d.z * b.up.z;
      if (zf <= 0.05) { this.x = 0; this.y = 0; this.z = 2; return this; }
      this.x = (xr / zf) * F / (W / 2); this.y = (yu / zf) * F / (H / 2); this.z = 0.5;
      return this;
    }
  }
  function screenOf(p) { const v = new V3(p.x, p.y, p.z).project(); return v.z > 1 ? null : { x: (v.x * 0.5 + 0.5) * W, y: (-v.y * 0.5 + 0.5) * H }; }
  function rayAt(sx, sy) {
    const b = basis(), nx = (sx - W / 2) / F, ny = -(sy - H / 2) / F;
    const d = { x: b.fwd.x + b.right.x * nx + b.up.x * ny, y: b.fwd.y + b.right.y * nx + b.up.y * ny, z: b.fwd.z + b.right.z * nx + b.up.z * ny };
    const L = Math.hypot(d.x, d.y, d.z);
    return { origin: b.o, direction: { x: d.x / L, y: d.y / L, z: d.z / L } };
  }
  let T = 0;
  const sb = {
    window: null, CBZ, document: doc, console, Math, Object, Array, Set, Map, JSON, isFinite, Number, String, Date, RegExp, Error, Promise,
    THREE: { Vector3: V3 }, performance: { now: () => T * 1000 }, setTimeout: () => 0, clearInterval: () => {}, setInterval: () => 0,
    innerWidth: W, innerHeight: H,
    addEventListener: (type, fn, cap) => listeners.push({ type, fn, cap: !!(cap && (cap === true || cap.capture)) }),
  };
  sb.window = sb; sb.window.CBZ = CBZ;
  vm.createContext(sb);
  for (const f of ["src/systems/touch_layout.js", "src/systems/interactions.js", "src/city/verbword.js", "src/city/interactions.js", "src/city/verbwheel.js"]) {
    vm.runInContext(read(f), sb, { filename: f });
  }
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
  }
  const acts = [];
  return { CBZ, I: CBZ.interactions, P, step, key, acts, act: (w) => acts.push(w), screenOf, rayAt,
    settle() { for (let i = 0; i < 4; i++) step(1 / 12); } };
}
function look(Pg, x, z) { const P = Pg.P.pos; Pg.CBZ.cam.yaw = Math.atan2(-(x - P.x), -(z - P.z)); Pg.settle(); }

// ---- the world: one of everything the registry can hold --------------------------------
function stage(Pg) {
  const { I, act } = Pg;
  const things = {};
  const man = things.man = { name: "Ray Cole", pos: { x: 0, y: 0, z: -3 }, group: {}, kind: "civilian" };
  const car = things.car = { pos: { x: 3.5, y: 0, z: -1 }, group: {} };
  const horse = things.horse = { pos: { x: -3.5, y: 0, z: -1 }, group: {}, animal: true };
  I.registerSource({ id: "t-ped", kind: "ped", layers: ["ped:civ", "ped"], prio: 6, driving: false,
    find(px, pz, ctx, push) { const d = Math.hypot(man.pos.x - px, man.pos.z - pz); if (d <= 5.2) push(man, d); } });
  I.registerSource({ id: "t-car", kind: "vehicle", layers: ["vehicle"], prio: 3, driving: false,
    find(px, pz, ctx, push) { const d = Math.hypot(car.pos.x - px, car.pos.z - pz); if (d <= 5.2) push(car, d); } });
  I.registerSource({ id: "t-horse", kind: "animal", layers: ["animal"], prio: 6, driving: false,
    find(px, pz, ctx, push) { const d = Math.hypot(horse.pos.x - px, horse.pos.z - pz); if (d <= 5.2) push(horse, d); } });
  I.register("ped:civ", { id: "ped-threaten", prio: 5, bad: true, label: "Threaten", onSelect: () => act("threaten") });
  I.register("ped:civ", { id: "ped-hire", prio: 37, label: "Hire", onSelect: () => act("hire") });
  I.register("ped:civ", { id: "ped-mug", prio: 10, bad: true, label: "Mug", onSelect: () => act("mug") });
  I.register("ped:civ", { id: "ped-recruit", prio: 8, label: "Recruit", onSelect: () => act("recruit") });
  I.register("ped:civ", { id: "ped-swing", prio: 7, bad: true, label: "Punch", onSelect: () => act("punch") });
  I.register("ped:civ", { id: "ped-pickpocket", prio: 6, bad: true, label: "Pickpocket", onSelect: () => act("pickpocket") });
  I.register("vehicle", { id: "car-get-in", slot: "e", ride: true, label: "Get in", onSelect: () => act("get-in") });
  I.register("vehicle", { id: "car-lock", prio: 3, label: "Break in", bad: true, onSelect: () => act("break-in") });
  I.register("animal", { id: "animal-pet", slot: "e", prio: 18, label: "Pet", onSelect: () => act("pet") });
  I.register("animal", { id: "animal-tame", slot: "e", hold: true, prio: 20, label: "Feed", onSelect: () => act("tame") });
  I.register("animal", { id: "animal-mount", ride: true, prio: 22, label: "Ride", onSelect: () => act("mount") });
  // a wall of fixtures (the gun wall's grammar): three guns side by side
  const wall = things.wall = [
    { name: "Pistol", x: -1.2, z: 2.6 }, { name: "Shotgun", x: 0, z: 2.6 }, { name: "Rifle", x: 1.2, z: 2.6, sold: true },
  ];
  I.registerFixtures({
    id: "t-wall", kind: "t-wall", prio: 9, list: () => wall, reach: () => 3, dot: () => 0.82, name: (s) => s.name,
    verbs: [
      { id: "wall-buy", slot: "e", prio: 5, label: (s) => "Buy $" + (s.name.length * 100), canShow: (s) => !s.sold, onSelect: (s) => act("buy:" + s.name) },
      { id: "wall-inspect", prio: 2, label: "Look", onSelect: (s) => act("look:" + s.name) },
    ],
  });
  // a zone on a place (a mailbox): one verb, a tap just does it
  const mailbox = things.mailbox = { x: -3.6, z: 1.6 };
  I.registerZone({ id: "t-mailbox", kind: "mailbox", radius: 5.2, find: (px, pz) => Math.hypot(px - mailbox.x, pz - mailbox.z) <= 5.2 ? mailbox : null,
    options: [{ id: "mail-rob", slot: "e", label: "Rob", onSelect: () => act("mail") }] });
  // a positionless zone (a thing that is "where you stand"): live only
  const spot = things.spot = { kind: "spot" };
  I.registerZone({ id: "t-spot", kind: "spot", find: (px, pz) => (Math.hypot(px - Pg.P.pos.x, pz - Pg.P.pos.z) < 0.5 ? spot : null),
    options: [{ id: "spot-rest", slot: "e", label: "Rest", onSelect: () => act("rest") }] });
  // a far ATM (across the street): E finds it only standing there; a tap finds it now
  const atm = things.atm = { x: 12, z: -9 };
  I.registerZone({ id: "t-atm", kind: "atm", radius: 3, find: (px, pz) => Math.hypot(px - atm.x, pz - atm.z) <= 3 ? atm : null,
    options: [{ id: "atm-take", slot: "e", label: "Withdraw $500", onSelect: () => act("atm") }, { id: "atm-small", label: "Withdraw $100", onSelect: () => act("atm100") }] });
  Pg.settle();
  return things;
}
const anchor = (Pg, cand) => Pg.I.anchorOf(cand);
function wheelWords(Pg) {
  const VW = Pg.CBZ.verbWheel;
  let a = VW.audit();
  if (a.verbs.includes("More")) { Pg.key("keydown", String(a.verbs.indexOf("More") + 1)); a = VW.audit(); }
  return a.verbs.filter((v) => v !== "More");
}
const word = (Pg, label) => Pg.CBZ.cityVerbWord(label);

let kbVerbs = 0, tapVerbs = 0;
function coverage(label, Pg, thing, at, tapOpts) {
  const { I, CBZ } = Pg;
  // KEYBOARD: look at it; everything E / hold E / F / Q reach
  CBZ.touchMode = false;
  look(Pg, -at.x * 9, -at.z * 9);          // away first: the card's hysteresis keeps a neighbour otherwise
  look(Pg, at.x, at.z);
  const cand = I.currentCand();
  ok(cand && cand.t === thing, label + ": the keys target it when you look at it");
  if (!cand || cand.t !== thing) return;
  const keys = new Set(I.wheelOf(cand).map((it) => word(Pg, it.label)));
  kbVerbs += keys.size;
  // TOUCH: the camera turned half away (the thumb, not the look, chooses)
  CBZ.touchMode = true;
  const P = Pg.P.pos, yaw0 = Math.atan2(-(at.x - P.x), -(at.z - P.z));
  CBZ.cam.yaw = yaw0 + 0.45; Pg.settle();
  const a = anchor(Pg, cand), sp = Pg.screenOf(a);
  ok(!!sp, label + ": on screen with the camera turned away");
  if (!sp) return;
  const pk = I.tapPick(sp.x + 9, sp.y - 7, Object.assign({ ray: Pg.rayAt(sp.x + 9, sp.y - 7) }, tapOpts || {}));
  ok(pk && pk.cand.t === thing, label + ": a tap a thumb's width off its anchor picks it (" + (pk && pk.cand.kind) + ")");
  if (!pk || pk.cand.t !== thing) return;
  ok(pk.live, label + ": in reach, so the tap opens it here");
  Pg.acts.length = 0;
  const opened = CBZ.verbWheel.openFor(pk.cand);
  ok(opened, label + ": the tap opens its verbs");
  let got;
  if (CBZ.verbWheel.isOpen()) { got = new Set(wheelWords(Pg)); CBZ.verbWheel.close(); }
  else got = new Set(keys.size === 1 && Pg.acts.length === 1 ? [...keys] : []);   // one verb: it just happened
  let missing = [];
  for (const k of keys) { if (got.has(k)) tapVerbs++; else missing.push(k); }
  ok(!missing.length, label + ": every key verb is on the tap (" + [...keys].join(", ") + "), missing: " + missing.join(", "));
}

{
  const Pg = makePage(); const T = stage(Pg);
  coverage("a person", Pg, T.man, T.man.pos);
  coverage("a car", Pg, T.car, T.car.pos);
  coverage("a horse", Pg, T.horse, T.horse.pos);
  for (const s of T.wall) coverage("the " + s.name + " on the wall", Pg, s, s);
  coverage("a mailbox", Pg, T.mailbox, T.mailbox);

  // one verb, one tap: the mailbox just gets robbed
  Pg.CBZ.touchMode = true; look(Pg, T.mailbox.x, T.mailbox.z);
  const mb = Pg.screenOf(anchor(Pg, { t: T.mailbox, layers: [] }));
  Pg.acts.length = 0;
  const pm = Pg.I.tapPick(mb.x, mb.y, { ray: Pg.rayAt(mb.x, mb.y) });
  Pg.CBZ.verbWheel.openFor(pm.cand);
  ok(Pg.acts.length === 1 && Pg.acts[0] === "mail" && !Pg.CBZ.verbWheel.isOpen(), "a one-verb thing just does it on the tap: " + Pg.acts);

  // the keyboard's look gate is untouched: facing away from the wall, E is not on a gun
  Pg.CBZ.touchMode = false;
  look(Pg, 0, -3);
  ok(!Pg.I.currentCand() || Pg.I.currentCand().kind !== "t-wall", "keyboard: a fixture behind you is not the E target (the look cone still holds)");

  // the far ATM: out of reach, a tap still finds it and says so (touch.js walks there)
  Pg.CBZ.touchMode = true;
  look(Pg, T.atm.x, T.atm.z);
  const as = Pg.screenOf({ x: T.atm.x, y: 0.9, z: T.atm.z });
  const pa = Pg.I.tapPick(as.x, as.y, { ray: Pg.rayAt(as.x, as.y) });
  ok(pa && pa.cand.t === T.atm && !pa.live && pa.dist > 10, "a thing across the street: the tap finds it, not in reach (walk there): " + (pa && pa.cand.kind));
  // ...and on arrival it is the live candidate, with both of its verbs
  Pg.P.pos.x = T.atm.x - 1.5; Pg.P.pos.z = T.atm.z + 1.2; look(Pg, T.atm.x, T.atm.z);
  const lv = Pg.I.liveLike(pa.cand);
  ok(!!lv, "after the walk the tapped thing is the live candidate");
  if (lv) {
    Pg.CBZ.verbWheel.openFor(lv);
    const w = wheelWords(Pg); Pg.CBZ.verbWheel.close();
    ok(w.includes("Withdraw $500") && w.includes("Withdraw $100"), "and its verbs open: " + w.join(", "));
    kbVerbs += 2; tapVerbs += (w.includes("Withdraw $500") ? 1 : 0) + (w.includes("Withdraw $100") ? 1 : 0);
  }
  Pg.P.pos.x = 0; Pg.P.pos.z = 0;

  // the positionless spot: never picked from across the room, tappable on you
  look(Pg, 0, -3);
  const far = Pg.screenOf({ x: 0, y: 0.2, z: -9 });
  const pf = Pg.I.tapPick(far.x, far.y, { ray: Pg.rayAt(far.x, far.y) });
  ok(!pf || pf.cand.t !== T.spot, "a thing with no place of its own is never picked off the ground in front of you");
  // the sky: nothing
  const sky = Pg.I.tapPick(W / 2, 20, { ray: Pg.rayAt(W / 2, 20) });
  ok(!sky, "a tap on the sky picks nothing: " + (sky && sky.cand.kind));
  // the body under the finger wins over a nearer anchor
  look(Pg, 0, -3);
  const ms = Pg.screenOf({ x: 0, y: 1.2, z: -3 });
  const pu = Pg.I.tapPick(ms.x, ms.y + 120, { ray: Pg.rayAt(ms.x, ms.y + 120), under: T.man });
  ok(pu && pu.cand.t === T.man, "the body the finger's ray hit wins (his legs, far from his anchor)");
}

const pct = kbVerbs ? Math.round(100 * tapVerbs / kbVerbs) : 0;
console.log("  " + tapVerbs + " / " + kbVerbs + " keyboard verbs reachable by tap (" + pct + "%)");
ok(pct === 100, "touch coverage is 100%");
console.log((fails ? "TOUCH-COVERAGE: FAIL " : "TOUCH-COVERAGE: OK ") + passes + " passed, " + fails + " failed");
process.exit(fails ? 1 : 0);
