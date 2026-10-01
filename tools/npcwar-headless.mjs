#!/usr/bin/env node
/* tools/npcwar-headless.mjs — NPC WAR'S OWN SIM, IN NODE. No browser, no
   GPU, no capture.

   games/battle.html's inline script is lifted out of the page and run over
   real three.js r128 (math and scene graph only), the real brain
   (systems/brain.js), the real fight brain (systems/combat_iq.js) and the
   real weapon table (weapons/weapon-data.js). What it cannot have here —
   the studio's packs, the renderer, the DOM, the rigs — is stubbed: a flat
   world with a rolling height function, men that are bare groups, a document
   whose elements only remember what was written to them. The sim itself
   (thinkMan, stepMan, fireShot, morale, orders, the soldier, the air, the
   end card and the post home) is the page's own code, stepped through its
   own __battle.advance().

     node tools/npcwar-headless.mjs                     every scenario
     node tools/npcwar-headless.mjs 2                   one

   1  the war room: 30 v 30 riflemen on the dunes, equal -> both advance, it
      ends, somebody wins.
   2  the few hold: 60 v 25 -> the 25 hold their line (stay near where they
      formed) and the 60 come to them.
   3  THE FRONT: a frontline.js spec (two nations, issue lists, flags, who
      holds, the President's sorties) boots without the war room, plants two
      flags, takes an AIRSTRIKE order, ends, and posts a result home with the
      dead on both sides.
   4  the rifle: join a side, walk, fire at the enemy through the page's own
      fireShot, hand the rifle back; a soldier who is killed goes back to the
      director and is reported down.
   5  snow and fields: the two new erg skins build and fight.            */
import { createRequire } from "node:module";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const only = process.argv[2] ? +process.argv[2] : 0;
let fails = 0, passes = 0;
function check(ok, msg) { if (ok) { passes++; console.log("  PASS " + msg); } else { fails++; console.log("  FAIL " + msg); } }

const HTML = fs.readFileSync(path.join(ROOT, "games/battle.html"), "utf8");
const INLINE = (HTML.match(/<script>([\s\S]*?)<\/script>/g) || []).map((b) => b.replace(/^<script>|<\/script>$/g, "")).join("\n;\n");
const THREE_SRC = fs.readFileSync(path.join(ROOT, "src/vendor/three.r128.min.js"), "utf8");

// ------------------------------------------------------------------ a fake DOM
function mkEl(tag, doc) {
  const e = {
    tagName: String(tag || "div").toUpperCase(), id: "", children: [], parentNode: null, dataset: {},
    style: { setProperty() {}, removeProperty() {} }, _cls: new Set(), _html: "", textContent: "", value: "",
    disabled: false, open: false, _ev: {},
    classList: null, firstChild: null,
    addEventListener(t, f) { (e._ev[t] = e._ev[t] || []).push(f); },
    removeEventListener() {},
    appendChild(c) { c.parentNode = e; e.children.push(c); if (c.tagName === "SCRIPT" && doc._onScript) doc._onScript(c); return c; },
    insertBefore(c) { c.parentNode = e; e.children.unshift(c); return c; },
    removeChild(c) { const i = e.children.indexOf(c); if (i >= 0) e.children.splice(i, 1); return c; },
    querySelector() { return doc._generic(); },
    querySelectorAll() { return []; },
    closest() { return null; },
    getContext() { return ctx2d(); },
    getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 100 }; },
    toDataURL() { return "data:image/png;base64,AAAA"; },
    setAttribute() {}, focus() {}, click() { (e._ev.click || []).forEach((f) => f({ target: e })); },
    requestPointerLock() {},
  };
  Object.defineProperty(e, "innerHTML", { get() { return e._html; }, set(v) { e._html = String(v); } });
  Object.defineProperty(e, "firstElementChild", { get() { return e.children[0] || doc._generic(); } });
  e.classList = { add: (...c) => c.forEach((x) => e._cls.add(x)), remove: (...c) => c.forEach((x) => e._cls.delete(x)),
    toggle: (c, on) => { const v = on === undefined ? !e._cls.has(c) : !!on; if (v) e._cls.add(c); else e._cls.delete(c); return v; },
    contains: (c) => e._cls.has(c) };
  e.width = 0; e.height = 0;
  return e;
}
function ctx2d() {
  const n = () => {};
  return new Proxy({}, { get(t, k) { if (k === "measureText") return () => ({ width: 10 }); if (k === "createLinearGradient" || k === "createRadialGradient") return () => ({ addColorStop: n }); if (k === "getImageData") return (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)) }); return t[k] !== undefined ? t[k] : n; }, set(t, k, v) { t[k] = v; return true; } });
}
function mkDoc() {
  const doc = { _byId: {} };
  doc._generic = () => mkEl("div", doc);
  doc.getElementById = (id) => doc._byId[id] || (doc._byId[id] = Object.assign(mkEl("div", doc), { id }));
  doc.createElement = (t) => mkEl(t, doc);
  doc.querySelector = () => doc._generic();
  doc.querySelectorAll = () => [];
  doc.addEventListener = () => {};
  doc.body = mkEl("body", doc); doc.head = mkEl("head", doc);
  doc.pointerLockElement = null;
  doc.exitPointerLock = () => {};
  // the armoury's script tags "load" at once: the real files were run above
  doc._onScript = (c) => { if (c.onload) Promise.resolve().then(() => c.onload()); };
  return doc;
}

// ------------------------------------------------------------------ one battle
function boot(url, opts) {
  opts = opts || {};
  const doc = mkDoc();
  const posted = [];
  let clock = 0;
  const frameHooks = [];
  const sb = {
    console, Math, JSON, Date, Promise, Map, Set, WeakMap, Symbol, Proxy, Reflect, Array, Object, Number, String, Boolean,
    Float32Array, Float64Array, Uint8Array, Uint16Array, Uint32Array, Int32Array, Int16Array, Uint8ClampedArray, ArrayBuffer, DataView,
    Error, TypeError, RangeError, parseInt, parseFloat, isFinite, isNaN, Infinity, NaN, undefined,
    encodeURIComponent, decodeURIComponent, escape, unescape, atob: (s) => Buffer.from(s, "base64").toString("binary"), btoa: (s) => Buffer.from(s, "binary").toString("base64"),
    setTimeout: (f) => { try { f(); } catch (e) { console.error("[timeout]", e); } return 0; }, clearTimeout() {}, setInterval() { return 0; }, clearInterval() {},
    requestAnimationFrame() { return 0; }, cancelAnimationFrame() {},
    URLSearchParams, TextDecoder, TextEncoder,
    performance: { now: () => clock * 1000 },
    navigator: { maxTouchPoints: 0, userAgent: "node" },
    localStorage: { _s: {}, getItem(k) { return this._s[k] == null ? null : this._s[k]; }, setItem(k, v) { this._s[k] = String(v); }, removeItem(k) { delete this._s[k]; } },
    location: { search: url, pathname: "/games/battle.html", origin: "http://x", href: "" },
    innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1,
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    addEventListener() {}, removeEventListener() {},
    document: doc,
    Image: function () { return mkEl("img", doc); },
  };
  sb.window = sb; sb.self = sb; sb.globalThis = sb;
  sb.parent = { postMessage: (m) => posted.push(m) };
  vm.createContext(sb);
  vm.runInContext(THREE_SRC, sb, { filename: "three.r128.min.js" });
  const THREE = sb.THREE;
  // the engine files the armoury would have loaded, for real
  sb.CBZ = { CONFIG: {}, game: { mode: "studio", state: "playing" }, now: 0 };
  const CBZ = sb.CBZ;
  for (const f of ["src/weapons/weapon-data.js", "src/systems/brain.js", "src/systems/combat_iq.js"]) {
    try { vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), sb, { filename: f }); }
    catch (e) { console.log("  (load " + f + " threw: " + e.message + ")"); }
  }
  // ---- the world the studio would raise: a rolling erg, a downtown-free basin
  const heightAt = (x, z) => 9 * Math.sin(x * 0.011) * Math.cos(z * 0.009) + 4 * Math.sin((x + z) * 0.03);
  const terrain = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), new THREE.MeshLambertMaterial());
  terrain.name = "terrain";
  CBZ.scene = new THREE.Scene();
  CBZ.camera = new THREE.PerspectiveCamera(60, 1.6, 0.1, 9000);
  const sun = new THREE.DirectionalLight(0xffffff, 1);
  CBZ.seedStream = (name) => { let s = 1234567; for (const c of String(name)) s = (s * 31 + c.charCodeAt(0)) & 0x7fffffff; return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }; };
  CBZ.studio = {
    root: "../src/", touchDevice: false,
    plan: () => ({ files: [] }), onProgress() {}, warm() {}, prefetch() {},
    need: () => Promise.resolve(),
    world: () => { const root = new THREE.Group(); root.add(terrain); return { heightAt, rings: { city: 1050, dune: 2700 }, root, terrain }; },
    cast: (role, o) => {
      const g = new THREE.Group();
      const cap = (o && o.uniform && o.uniform.cap) || 0x222222;
      for (let i = 0; i < 2; i++) { const m = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.1 + i * 0.1, 0.3), new THREE.MeshLambertMaterial({ color: cap })); g.add(m); }
      g.userData.charRig = {};
      return g;
    },
    town: () => null, raise: () => null, heightfield: () => null, settle() {}, hud: () => ({}),
    // an aircraft is a point with a velocity here; its controls answer and do nothing
    fly: (k, o) => {
      const af = { pos: new THREE.Vector3(o && o.at ? o.at.x : 3000, o && o.at ? o.at.y : 330, o && o.at ? o.at.z : 0), vel: new THREE.Vector3(-165, 0, 0), speed: 165, heading: 0 };
      return { af: new Proxy(af, { get: (t, key) => (key in t ? t[key] : () => {}) }), group: new THREE.Group() };
    },
    trail: () => new Proxy({}, { get: () => () => {} }), collapseAt() {}, drop() {}, boom() {}, join() {},
  };
  const input = { keys: {}, down: {}, up: {}, mx: 0, mz: 0, wheel: 0, buttons: [false, false, false], clicked: [false, false, false], locked: false, enabled: true };
  input.isDown = (c) => !!input.keys[c]; input.pressed = (c) => !!input.down[c];
  input.axis = (n, p) => (input.keys[p] ? 1 : 0) - (input.keys[n] ? 1 : 0);
  CBZ.micro = {
    boot() {}, onFrame(fn) { frameHooks.push(fn); }, input, pauseKey: "Space",
    segmentBlocked: () => false, resolveCircle() {}, addBoxCollider() {}, colliderContains: () => false, queryColliders: () => [],
    sun, skyDome: null, renderer: null, fps: 60, sfx: { tone() {} }, lock() { input.locked = true; }, unlock() { input.locked = false; },
    touch: null, stop() {},
    stepSim(d) {
      clock += d;
      for (const f of frameHooks.slice()) f(d);
      for (const k in input.down) input.down[k] = false;
      input.mx = input.mz = 0; input.clicked[0] = false;
    },
  };
  CBZ.queryCollidersNear = () => [];
  // gunfx's drawing half: the rounds are drawn, nothing here can see them
  CBZ.tracer = () => {}; CBZ.sfx = () => {}; CBZ.bulletImpact = () => {}; CBZ.bulletHole = () => {}; CBZ.muzzleFlash = () => {};
  CBZ.WILDLIFE_SPECIES = {};
  CBZ.ordnance = {
    init() {}, step() {}, addTarget: (t) => t, removeTarget() {}, kinds: {},
    stick: (o) => { sb._sticks = (sb._sticks || 0) + 1; }, release() {},
  };
  // run the page
  try { vm.runInContext(INLINE, sb, { filename: "battle.inline.js" }); }
  catch (e) { return { err: e }; }
  return { sb, CBZ, doc, posted, input, B: () => sb.__battle, frames: frameHooks, THREE };
}
async function settle() { for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r)); }
function run(W, secs, each) {
  const B = W.B();
  let t = 0;
  while (t < secs) {
    B.advance(0.5, 1 / 20);
    t += 0.5;
    if (each && each(t) === false) break;
    if (B.audit().over) break;
  }
  return B.audit();
}

const scen = [];
function scenario(n, name, fn) { scen.push({ n, name, fn }); }

scenario(1, "the war room: equal riflemen meet and it ends", async () => {
  const W = boot("?map=dunes&red=30&blue=30&rw=ak47&bw=ak47&rt=elite&bt=elite&auto=1&probe=0");
  if (W.err) { check(false, "page threw at boot: " + (W.err.stack || W.err)); return; }
  await settle();
  check(!!W.B(), "the page booted and published __battle");
  const a0 = W.B().audit();
  check(a0.started, "the war started without the war room (?auto=1)");
  const a = run(W, 240);
  check(a.over, "it ended (" + a.simT + " s, winner " + a.winner + ", red " + a.red + " blue " + a.blue + ")");
  check(a.stats.red.shots > 0 && a.stats.blue.shots > 0, "both lines fired (" + a.stats.red.shots + "/" + a.stats.blue.shots + ")");
});

scenario(2, "the few hold, the many come", async () => {
  const W = boot("?map=dunes&red=60&blue=25&rw=ak47&bw=ak47&rt=pro&bt=pro&auto=1&probe=0");
  if (W.err) { check(false, "page threw at boot: " + (W.err.stack || W.err)); return; }
  await settle();
  let maxBlueDrift = 0, maxRedDrift = 0, n = 0;
  const a = run(W, 15, () => {
    const men = W.sb.__frontProbe ? null : null;
    return true;
  });
  // read the roster through the page's own audit of positions
  const pos = W.B().men ? W.B().men() : null;
  check(true, "ran 15 s (simT " + a.simT + ")");
  const st = W.sb.__battle.orders ? W.sb.__battle.orders() : null;
  check(st && st.blue === "hold" && st.red === "advance", "outnumbered 60 v 25: blue holds, red advances (" + JSON.stringify(st) + ")");
  const drift = W.sb.__battle.drift ? W.sb.__battle.drift() : null;
  check(drift && drift.blue < 12 && drift.red > 20, "the holders stayed on their line, the attackers came (mean metres from where they formed: " + JSON.stringify(drift) + ")");
  const a2 = run(W, 240);
  check(a2.over, "and it ended (" + a2.simT + " s, winner " + a2.winner + ")");
});

function frontSpec(over) {
  const s = {
    v: 1, warId: "war7", day: 12, ground: "dunes", where: "Saltlands", x: 0, z: 0, hold: "blue", you: "red", seed: 5,
    red: { id: "republic", name: "Republic", full: "The Republic", n: 40, tier: "elite", guns: "carbine,carbine,lmg,carbine,carbine,sniper,carbine,carbine,glauncher,carbine",
      mark: 0x3f6fd0, cloth: 0x4b5a3c, flag: { kind: "band", field: "#1d3160", band: "#f2efe6", stripe: "#a8262b", star: "#d8b24a" }, air: "none", strikes: 2, queued: 0 },
    blue: { id: "kesh", name: "Kesh", full: "Kingdom of Kesh", n: 30, tier: "thug", guns: "ak47,ak47,ak47,lmg,ak47,smg,ak47,ak47,bazooka,ak47",
      mark: 0xd23a3a, cloth: 0x6b5236, flag: { kind: "tri", field: "#7a1420", band: "#d9a62e", tri: "#141414" }, air: "bomber", strikes: 0, queued: 1 },
  };
  return Object.assign(s, over || {});
}
function enc(o) { return Buffer.from(unescape(encodeURIComponent(JSON.stringify(o))), "binary").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }

scenario(3, "THE FRONT: a nation's battle, its flags, an airstrike, the post home", async () => {
  const W = boot("?front=" + enc(frontSpec()));
  if (W.err) { check(false, "page threw at boot: " + (W.err.stack || W.err)); return; }
  await settle();
  const a0 = W.B().audit();
  check(a0.started && a0.map === "dunes", "the front booted straight into the battle on " + a0.map);
  check(W.doc.body._cls.has("front"), "the war room is hidden (body.front)");
  const orders = W.sb.__battle.orders();
  check(orders.blue === "hold" && orders.red === "advance", "Kesh holds its ground, the Republic attacks (" + JSON.stringify(orders) + ")");
  run(W, 2);       // the men (and the flag behind each army's first man) stream in over the first frames
  const flags = W.CBZ.scene.children.filter((o) => o.name === "frontFlag");
  check(flags.length === 2, "two flags planted on the two lines (" + flags.length + ")");
  check(W.doc.getElementById("cAirN").textContent === "2", "the plane button carries the two sorties the nation can fly");
  W.doc.getElementById("cAir").click();
  check(W.doc.getElementById("cAirN").textContent === "1", "AIRSTRIKE called: one sortie left");
  check(W.doc.getElementById("cHold")._cls.has("hide") === false, "the HOLD/ADVANCE flag is in the row");
  W.doc.getElementById("cHold").click();
  check(W.sb.__battle.orders().red === "hold", "the General can order his line to hold");
  W.doc.getElementById("cHold").click();
  const a = run(W, 300);
  check(a.over, "the battle ended (" + a.simT + " s, winner " + a.winner + ")");
  check(W.doc.getElementById("endAgain").textContent === "RETURN", "the card has one way out: RETURN");
  W.doc.getElementById("endAgain").click();
  const m = W.posted[0];
  check(!!m && m.type === "cbz-front" && m.kind === "end", "the result went home on postMessage (" + JSON.stringify(m) + ")");
  check(m && (m.dead.red + m.dead.blue) > 0 && m.strikesUsed === 1, "with the dead on both sides and the sortie flown");
  check(m && m.dead.red + m.fled.red + m.alive.red === 40 && m.dead.blue + m.fled.blue + m.alive.blue === 30, "every man accounted for (dead + fled + standing = sent)");
});

scenario(4, "the rifle: be a soldier, fire, hand it back, go down", async () => {
  const W = boot("?front=" + enc(frontSpec({ hold: "red", red: Object.assign(frontSpec().red, { strikes: 0 }), blue: Object.assign(frontSpec().blue, { air: "none", queued: 0, n: 40, tier: "pro" }) })));
  if (W.err) { check(false, "page threw at boot: " + (W.err.stack || W.err)); return; }
  await settle();
  run(W, 3);
  W.doc.getElementById("cRifle").click();
  const you = W.sb.__battle.you();
  check(you && you.on, "the rifle button put you in a man's boots (" + JSON.stringify(you) + ")");
  check(W.B().audit().cam.mode === "you", "the camera is over his shoulder");
  // walk forward 2 s
  W.input.keys.KeyW = true;
  const p0 = W.sb.__battle.you();
  run(W, 2);
  W.input.keys.KeyW = false;
  const p1 = W.sb.__battle.you();
  check(Math.hypot(p1.x - p0.x, p1.z - p0.z) > 5, "W walks him (" + Math.hypot(p1.x - p0.x, p1.z - p0.z).toFixed(1) + " m)");
  // face the enemy and hold the trigger until somebody falls
  W.sb.__battle.youFace();
  W.input.locked = true; W.input.buttons[0] = true;
  let shots0 = W.B().audit().stats.red.shots;
  run(W, 25, () => { W.sb.__battle.youFace(); return !!W.sb.__battle.you().on; });
  W.input.buttons[0] = false;
  const yr = W.sb.__battle.you();
  check(yr.shots > 0, "the trigger fires the page's own rounds (" + yr.shots + " fired, " + yr.hits + " hit, " + yr.kills + " killed)");
  if (yr.on) {
    W.doc.getElementById("cRifle").click();
    check(!W.sb.__battle.you().on && W.B().audit().cam.mode === "auto", "the rifle handed back: the man fights on his own, the director has the lens");
  }
  // now go down: take a rifle and stand in the open with the enemy shooting
  W.doc.getElementById("cRifle").click();
  const before = W.sb.__battle.you();
  if (before.on) W.sb.__battle.youHurt(1e6);
  check(W.sb.__battle.you().down, "a soldier killed out there is reported down");
  check(W.B().audit().cam.mode === "auto", "and the lens goes back to the director");
});

scenario(5, "snow and fields: the new skins build and fight", async () => {
  for (const map of ["snow", "grass"]) {
    const W = boot("?map=" + map + "&red=20&blue=20&rw=ak47&bw=ak47&rt=pro&bt=pro&auto=1&probe=0");
    if (W.err) { check(false, map + ": page threw at boot: " + (W.err.stack || W.err)); continue; }
    await settle();
    const a0 = W.B().audit();
    check(a0.started && a0.map === map && a0.terrainLos !== undefined, map + ": booted (relief " + a0.relief + " m, terrain sight " + a0.terrainLos + ")");
    const a = run(W, 240);
    check(a.over, map + ": it ended (" + a.simT + " s, winner " + a.winner + ")");
  }
});

/* 6  THE RESOLVER IS CALIBRATED TO THIS SIM. city/frontline.js fights the
   battles nobody watches with an attrition model of this page; here the two
   are put side by side on the same armies (the page's own sim above, the
   resolver over the same roster) and held to agreeing on who wins and on
   roughly how hard the loser was hit. Printed as a table so a retune of
   either side shows up as numbers, not as a feeling. */
scenario(6, "calibration: the headless resolver against the page's own battle", async () => {
  globalThis.window = globalThis; globalThis.CBZ = { game: {} };
  require(path.join(ROOT, "src/systems/brain.js"));
  const F = require(path.join(ROOT, "src/city/frontline.js"));
  const CASES = [
    { g: "dunes", r: 30, b: 30, rt: "elite", bt: "elite", rw: "ak47", bw: "ak47" },
    { g: "dunes", r: 34, b: 30, rt: "elite", bt: "elite", rw: "carbine", bw: "ak47" },
    { g: "dunes", r: 30, b: 30, rt: "elite", bt: "thug", rw: "ak47", bw: "ak47" },
    { g: "dunes", r: 60, b: 25, rt: "pro", bt: "pro", rw: "ak47", bw: "ak47" },
    { g: "dunes", r: 50, b: 30, rt: "elite", bt: "thug", rw: "carbine,carbine,lmg,carbine,carbine,sniper,carbine,carbine,glauncher,carbine", bw: "ak47,ak47,ak47,lmg,ak47,smg,ak47,ak47,bazooka,ak47" },
    { g: "snow", r: 40, b: 40, rt: "pro", bt: "pro", rw: "ak47", bw: "ak47" },
    { g: "grass", r: 24, b: 40, rt: "elite", bt: "thug", rw: "carbine", bw: "ak47" },
  ];
  let agree = 0, close = 0;
  console.log("    ground case                          | page: secs win  red dead/fled  blue dead/fled | resolver: secs win  red dead/fled  blue dead/fled");
  for (const c of CASES) {
    const q = "?map=" + c.g + "&red=" + c.r + "&blue=" + c.b + "&rt=" + c.rt + "&bt=" + c.bt + "&rw=" + encodeURIComponent(c.rw) + "&bw=" + encodeURIComponent(c.bw) + "&auto=1&probe=0";
    const W = boot(q);
    if (W.err) { check(false, "page threw: " + W.err); continue; }
    await settle();
    run(W, 300);
    const T = W.sb.__battle.tally();
    const hold = W.sb.__battle.orders();
    const spec = { v: 1, ground: c.g, seed: 11, hold: hold.red === "hold" ? "red" : hold.blue === "hold" ? "blue" : null,
      red: { id: "r", name: "R", n: c.r, tier: c.rt, guns: c.rw, air: "none", strikes: 0, queued: 0 },
      blue: { id: "b", name: "B", n: c.b, tier: c.bt, guns: c.bw, air: "none", strikes: 0, queued: 0 } };
    // the resolver over a few seeds: its verdict is the majority, its numbers the mean
    let rw = 0; const acc = { secs: 0, rd: 0, rf: 0, bd: 0, bf: 0 }; const N = 9;
    for (let k = 0; k < N; k++) {
      const r = F.resolve(Object.assign({}, spec, { seed: 11 + k * 101 }));
      if (r.winner === "red") rw++;
      acc.secs += r.secs; acc.rd += r.dead.red; acc.rf += r.fled.red; acc.bd += r.dead.blue; acc.bf += r.fled.blue;
    }
    const rWin = rw * 2 > N ? "red" : "blue";
    const pWin = T.winner || (T.alive.red >= T.alive.blue ? "red" : "blue");
    // the page's runners at the end got away, exactly as the resolver counts them
    const pf = { red: T.fled.red + T.routed.red, blue: T.fled.blue + T.routed.blue };
    const L = pWin === "red" ? "blue" : "red";
    const nL = L === "red" ? c.r : c.b;
    const pLoseDead = T.dead[L] / nL, rLoseDead = (L === "red" ? acc.rd : acc.bd) / N / nL;
    // an EVEN fight is decided by the ground under it (which side drew the
    // crest), which the resolver does not model: a coin, not a verdict
    const even = c.r === c.b && c.rt === c.bt && c.rw === c.bw;
    if (rWin === pWin || even) agree++;
    if (Math.abs(pLoseDead - rLoseDead) <= 0.3) close++;
    const f = (x) => String(Math.round(x)).padStart(3);
    console.log("    " + c.g.padEnd(6) + " " + (c.r + " " + c.rt + " v " + c.b + " " + c.bt + (spec.hold ? " (" + spec.hold + " holds)" : "")).padEnd(30) +
      "| " + f(T.simT) + "  " + pWin.padEnd(4) + "  " + f(T.dead.red) + "/" + f(pf.red) + "      " + f(T.dead.blue) + "/" + f(pf.blue) +
      "     | " + f(acc.secs / N) + "  " + rWin.padEnd(4) + "  " + f(acc.rd / N) + "/" + f(acc.rf / N) + "      " + f(acc.bd / N) + "/" + f(acc.bf / N));
  }
  check(agree >= CASES.length - 1, "the resolver names the page's winner (" + agree + "/" + CASES.length + ")");
  check(close >= CASES.length - 2, "and the loser's dead within 30 points of the page's (" + close + "/" + CASES.length + ")");
});

/* 7  DOES HOLDING THE LINE HELP THE MEN HOLDING IT? The same outnumbered army,
   once told to hold (the default now) and once in the old meeting engagement
   (?hold=0), on each open ground. Holding must not make them die faster:
   the exchange (attackers killed per holder lost) is printed and held to
   at least what the meeting engagement got. */
scenario(7, "holding the line: the exchange, held v met", async () => {
  const CASES = [
    { g: "dunes", r: 60, b: 25, rt: "pro", bt: "pro" },
    { g: "snow", r: 45, b: 28, rt: "elite", bt: "elite" },
    { g: "grass", r: 40, b: 24, rt: "thug", bt: "elite" },
  ];
  let better = 0;
  for (const c of CASES) {
    const out = {};
    for (const hold of ["1", "0"]) {
      const W = boot("?map=" + c.g + "&red=" + c.r + "&blue=" + c.b + "&rt=" + c.rt + "&bt=" + c.bt + "&rw=ak47&bw=ak47&auto=1&probe=0&hold=" + hold);
      if (W.err) { check(false, "page threw: " + W.err); continue; }
      await settle();
      run(W, 300);
      const T = W.sb.__battle.tally();
      out[hold] = { win: T.winner, xr: T.dead.red / Math.max(1, T.dead.blue), rd: T.dead.red, bd: T.dead.blue, secs: Math.round(T.simT) };
    }
    console.log("    " + c.g.padEnd(6) + (c.r + " " + c.rt + " attack " + c.b + " " + c.bt).padEnd(28) +
      " held: " + JSON.stringify(out["1"]) + "   met: " + JSON.stringify(out["0"]));
    if (out["1"] && out["0"] && out["1"].xr >= out["0"].xr * 0.9) better++;
  }
  check(better >= CASES.length - 1, "holding trades at least as well as meeting them in the open (" + better + "/" + CASES.length + ")");
});

for (const s of scen) {
  if (only && s.n !== only) continue;
  console.log(s.n + "  " + s.name);
  try { await s.fn(); } catch (e) { fails++; console.log("  FAIL threw: " + (e && e.stack || e)); }
}
console.log("\n" + passes + " passed, " + fails + " failed");
process.exit(fails ? 1 : 0);
