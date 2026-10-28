/* tools/lib/npcwar-node.mjs — NPC WAR'S PAGE, IN NODE: the one boot every
   node tool shares (tools/npcwar-headless.mjs, npcwar-fidelity.mjs, npcwar-scale-bench.mjs,
   npcwar-arena.mjs, npcwar-balance-check.mjs). Lifted out of npcwar-headless.mjs so the
   arena does not grow a second copy of the fake DOM and the studio stub.

   games/battle.html's src/battle/* and src/units/* scripts run in one vm
   context over real three.js r128 (math and scene graph only), the real
   brain, combat_iq, ballistics and weapon table. The studio is stubbed.

   boot(url, { packs }) — `packs` names studio packs (src/core/studio.js
   PACKS) whose files are run FOR REAL when the page calls studio.need(),
   in the studio's own plan order. The headless scenarios pass none (bare
   men, no bestiary: the old behaviour). The arena passes the bestiary and
   the beasts pack, so an animal is the bestiary's own build, measured box,
   gait rig, traits and creature_combat strike driver: the same numbers the
   browser fights with. Files the node world cannot or must not run (three,
   microboot: they are the stubs) are skipped. */
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

// NPCWAR_ROOT=<dir> runs the game files of another tree (a before/after: an
// extracted origin/main) under these tools
const ROOT = process.env.NPCWAR_ROOT ? path.resolve(process.env.NPCWAR_ROOT)
  : path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
export { ROOT };
export const G = (W, expr) => vm.runInContext(expr, W.sb);

/* THE STUDIO'S PACK TABLE, read off src/core/studio.js itself (run once in a
   throwaway context: PACKS is data), so a pack's file list is never copied. */
let PLANNER = null;
export function packPlan(names) {
  if (!PLANNER) {
    const doc = { currentScript: { src: "http://x/src/core/studio.js", getAttribute() { return "../src/core/studio.js"; } },
      getElementsByTagName: () => [], createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }),
      head: { appendChild() {} }, body: { appendChild() {} }, addEventListener() {}, querySelector: () => null };
    const sb = { document: doc, location: { href: "http://x/games/battle.html", search: "", pathname: "/games/battle.html" },
      navigator: { maxTouchPoints: 0, userAgent: "node" }, console, setTimeout, clearTimeout,
      matchMedia: () => ({ matches: false }), addEventListener() {}, innerWidth: 1, innerHeight: 1 };
    sb.window = sb;
    vm.createContext(sb);
    vm.runInContext(fs.readFileSync(path.join(ROOT, "src/core/studio.js"), "utf8"), sb, { filename: "src/core/studio.js" });
    PLANNER = sb.CBZ.studio;
  }
  return PLANNER.plan(names).files;
}
// the studio stub IS three + microboot (running the real ones would replace
// it); `look` (materials, carfx) is the browser's paint and wants the frame
// loop: microboot's own cmat/boxGeom fallbacks stand in for it (boot below)
const PACK_SKIP = new Set(["vendor/three.r128.min.js", "core/microboot.js", "world/materials.js", "world/carfx.js"]);
// the bestiary needs `look` (materials, carfx) only for the browser's paint
export const BEAST_PACKS = ["caps", "bestiary", "beasts"];
/* ...and the single files of the `people` pack the FIGHT reads (the rest of
   that pack is the drawn body, which the stub's cast stands in for):
   bodymass.js is meleeScale / meleeAbsorb, the mass ratio every fist and
   every bite is multiplied by. Without it a civilian's punch takes the same
   bite out of a tiger as out of a man. */
export const FIGHT_FILES = ["systems/bodymass.js"];
const SRC_CACHE = new Map();
function srcOf(rel) {
  let s = SRC_CACHE.get(rel);
  if (s == null) { s = fs.readFileSync(path.join(ROOT, "src", rel), "utf8"); SRC_CACHE.set(rel, s); }
  return s;
}

/* The page is src/battle/*.js, loaded in the order games/battle.html lists
   them (one shared script scope, exactly like the browser: each file runs as
   its own script in the same context). Any inline <script> blocks still on
   the page run where they sit. */
const HTML = fs.readFileSync(path.join(ROOT, "games/battle.html"), "utf8");
const PAGE_SCRIPTS = [];
for (const m of HTML.matchAll(/<script(?:\s+src="([^"]+)")?\s*>([\s\S]*?)<\/script>/g)) {
  const src = m[1];
  if (src) {
    const rel = src.replace(/\?.*$/, "").replace(/^\.\.\//, "");
    // the page's own files, plus the shared systems it lists by name (the road
    // graph, the convoy); the studio is stubbed below
    if (!/^src\/(battle|units)\//.test(rel) && !/^src\/systems\/(roadgraph|convoy)\.js$/.test(rel)) continue;
    PAGE_SCRIPTS.push({ name: rel, code: fs.readFileSync(path.join(ROOT, rel), "utf8") });
  } else if (m[2].trim()) PAGE_SCRIPTS.push({ name: "battle.inline.js", code: m[2] });
}
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
  // ...except a UNIT file (units/unitkit.js tags it data-unit): those are the
  // species/vehicle files a roster asked for, and they run for real
  doc._onScript = (c) => {
    if (c.dataset && c.dataset.unit && doc._runUnit) {
      try { doc._runUnit(String(c.src).replace(/\?.*$/, "").replace(/^(\.\.\/)?src\//, "")); }
      catch (e) { console.log("  (unit file " + c.src + " threw: " + e.message + ")"); }
    }
    if (c.onload) Promise.resolve().then(() => c.onload());
  };
  return doc;
}

// ------------------------------------------------------------------ one battle
export function boot(url, opts) {
  opts = opts || {};
  const doc = mkDoc();
  const posted = [];
  let clock = 0;
  const frameHooks = [];
  // a seeded Math.random for the engine files that roll their own
  // (creature_combat's seize, ape_combat's slam-or-throw)
  let MathX = Math;
  if (opts.seed != null) {
    let r = ((opts.seed >>> 0) ^ 0x9e3779b9) >>> 0 || 1;
    MathX = Object.create(Math);
    MathX.random = () => { r ^= r << 13; r >>>= 0; r ^= r >>> 17; r ^= r << 5; r >>>= 0; return r / 4294967296; };
  }
  const sb = {
    console, Math: MathX, JSON, Date, Promise, Map, Set, WeakMap, Symbol, Proxy, Reflect, Array, Object, Number, String, Boolean,
    Float32Array, Float64Array, Uint8Array, Uint16Array, Uint32Array, Int32Array, Int16Array, Uint8ClampedArray, ArrayBuffer, DataView,
    Error, TypeError, RangeError, parseInt, parseFloat, isFinite, isNaN, Infinity, NaN, undefined,
    encodeURIComponent, decodeURIComponent, escape, unescape, atob: (s) => Buffer.from(s, "base64").toString("binary"), btoa: (s) => Buffer.from(s, "binary").toString("base64"),
    setTimeout: (f) => { try { f(); } catch (e) { console.error("[timeout]", e); } return 0; }, clearTimeout() {}, setInterval() { return 0; }, clearInterval() {},
    requestAnimationFrame() { return 0; }, cancelAnimationFrame() {},
    URLSearchParams, TextDecoder, TextEncoder,
    // the sim clock; opts.realClock hands the page a real one (the bench times the tiers with it)
    performance: { now: opts.realClock ? () => Number(process.hrtime.bigint()) / 1e6 : () => clock * 1000 },
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
  // a tool may hand the page more of a browser (a Worker, crossOriginIsolated ...)
  if (opts.sandbox) Object.assign(sb, opts.sandbox);
  sb.parent = { postMessage: (m) => posted.push(m) };
  vm.createContext(sb);
  doc._runUnit = (rel) => {
    const f = path.join(ROOT, "src", rel);
    if (fs.existsSync(f)) vm.runInContext(fs.readFileSync(f, "utf8"), sb, { filename: "src/" + rel });
  };
  vm.runInContext(THREE_SRC, sb, { filename: "three.r128.min.js" });
  const THREE = sb.THREE;
  // the engine files the armoury would have loaded, for real
  sb.CBZ = { CONFIG: {}, game: { mode: "studio", state: "playing" }, now: 0 };
  const CBZ = sb.CBZ;
  // the munition table, the charge law and the impact resolver are the `damage`
  // pack's pure half: the rounds, rockets and bombs land through them here too
  for (const f of ["src/weapons/weapon-data.js", "src/weapons/ballistics.js", "src/systems/armour.js", "src/weapons/munitiontable.js", "src/systems/breach.js",
    "src/systems/strike.js", "src/systems/brain.js", "src/systems/combat_iq.js"]) {
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
  CBZ.seedStream = (name) => { let s = 1234567 + (opts.seed != null ? (opts.seed >>> 0) * 7919 : 0); for (const c of String(name)) s = (s * 31 + c.charCodeAt(0)) & 0x7fffffff; return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }; };
  CBZ.studio = {
    root: "../src/", touchDevice: false,
    plan: () => ({ files: [] }), onProgress() {}, warm() {}, prefetch() {},
    /* the page's studio.need(NEED): with opts.packs, those packs' files run
       for real here, in the studio's plan order, once each. */
    need: () => {
      if (opts.packs && opts.packs.length && !sb.__packsIn) {
        sb.__packsIn = [];
        // microboot's slice-page helpers (what the bestiary builds with)
        const mc = new Map(), gc = new Map();
        CBZ.onUpdate = CBZ.onUpdate || (() => {}); CBZ.onAlways = CBZ.onAlways || (() => {});
        CBZ.mat = CBZ.mat || ((c, o) => new THREE.MeshLambertMaterial({ color: c, emissive: (o && o.emissive) || 0 }));
        CBZ.cmat = CBZ.cmat || ((c, o) => { const k = c + "|" + ((o && o.emissive) || 0); let m = mc.get(k); if (!m) { m = new THREE.MeshLambertMaterial({ color: c }); m._shared = true; mc.set(k, m); } return m; });
        CBZ.boxGeom = CBZ.boxGeom || ((w, h, d) => { const k = w + "," + h + "," + d; let g = gc.get(k); if (!g) { g = new THREE.BoxGeometry(w, h, d); g._shared = true; gc.set(k, g); } return g; });
        for (const rel of packPlan(opts.packs).concat(opts.files || [])) {
          if (PACK_SKIP.has(rel)) continue;
          try { vm.runInContext(srcOf(rel), sb, { filename: "src/" + rel }); sb.__packsIn.push(rel); }
          catch (e) { (sb.__packErr = sb.__packErr || []).push(rel + ": " + e.message); }
        }
      }
      return Promise.resolve();
    },
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
    trail: () => new Proxy({}, { get: () => () => {} }), collapseAt() {}, drop() {}, boom() {},
    // the real join (src/core/studio.js): become the mode, register its cast
    // with modecaps when that pack is in (ape_combat reaches men through it)
    join(spec) {
      spec = spec || {}; const id = spec.id || "slice";
      if (CBZ.game && spec.mode !== false) CBZ.game.mode = id;
      if (!CBZ.registerMode) return null;
      CBZ.registerMode(id, { id, label: spec.label || id, caps: spec.caps || {}, actors: spec.actors || null, hurt: spec.hurt || null,
        hurtPlayer: spec.hurtPlayer || null, blast: spec.blast || null, route: spec.route || id });
      return id;
    },
  };
  const input = { keys: {}, down: {}, up: {}, mx: 0, mz: 0, wheel: 0, buttons: [false, false, false], clicked: [false, false, false], locked: false, enabled: true };
  input.isDown = (c) => !!input.keys[c]; input.pressed = (c) => !!input.down[c];
  input.axis = (n, p) => (input.keys[p] ? 1 : 0) - (input.keys[n] ? 1 : 0);
  /* opts.boxes: a field of axis-aligned colliders ({minX,maxX,minZ,maxZ,y0,y1})
     laid out RELATIVE to the ground's centre (MAP.cx/cz) with y0/y1 over the
     ground under each box, so cover, sight and the walls can be measured in
     node (tools/npcwar-ai-metrics.mjs). They become world records — world x/z,
     world heights, exactly microboot's colliders — the first time anything
     asks, once the ground is raised. None by default. */
  const BOXR = ((opts && opts.boxes) || []).map((b) => Object.assign({}, b));
  const BOX = [];
  function boxesNow() {
    if (BOX.length || !BOXR.length) return BOX;
    let M = null;
    try { M = vm.runInContext("typeof MAP !== 'undefined' ? MAP : null", sb); } catch (e) { M = null; }
    if (!M || !M.groundAt) return BOX;
    for (const r of BOXR) {
      const b = Object.assign({}, r);
      b.minX += M.cx || 0; b.maxX += M.cx || 0; b.minZ += M.cz || 0; b.maxZ += M.cz || 0;
      const g = M.groundAt((b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2);
      b.y0 = (b.y0 || 0) + g; b.y1 = (b.y1 == null ? 50 : b.y1) + g;
      BOX.push(b);
    }
    return BOX;
  }
  function segBox3(ax, ay, az, bx, by, bz, b) {
    let t0 = 0, t1 = 1;
    const lo = [b.minX, b.y0, b.minZ], hi = [b.maxX, b.y1, b.maxZ];
    const a = [ax, ay, az], d = [bx - ax, by - ay, bz - az];
    for (let k = 0; k < 3; k++) {
      if (Math.abs(d[k]) < 1e-9) { if (a[k] < lo[k] || a[k] > hi[k]) return false; continue; }
      let u = (lo[k] - a[k]) / d[k], v = (hi[k] - a[k]) / d[k];
      if (u > v) { const t = u; u = v; v = t; }
      if (u > t0) t0 = u; if (v < t1) t1 = v; if (t0 > t1) return false;
    }
    return true;
  }
  const boxQuery = (x, z, r, out) => {
    out = out || []; out.length = 0;
    for (const b of boxesNow()) if (x + r > b.minX && x - r < b.maxX && z + r > b.minZ && z - r < b.maxZ) out.push(b);
    return out;
  };
  CBZ.micro = {
    boot() {}, onFrame(fn) { frameHooks.push(fn); }, input, pauseKey: "Space",
    segmentBlocked: BOXR.length ? (ax, ay, az, bx, by, bz) => { for (const b of boxesNow()) if (segBox3(ax, ay, az, bx, by, bz, b)) return true; return false; } : () => false,
    resolveCircle: BOXR.length ? (p, r, y) => {
      for (const b of boxesNow()) {
        if (y != null && b.y1 < y + 0.35) continue;          // a kerb is stepped over
        const cx = Math.max(b.minX, Math.min(p.x, b.maxX)), cz = Math.max(b.minZ, Math.min(p.z, b.maxZ));
        let dx = p.x - cx, dz = p.z - cz, d = Math.hypot(dx, dz);
        if (d >= r) continue;
        if (d < 1e-6) {
          const ex = [p.x - b.minX, b.maxX - p.x, p.z - b.minZ, b.maxZ - p.z], k = ex.indexOf(Math.min(...ex));
          if (k === 0) p.x = b.minX - r; else if (k === 1) p.x = b.maxX + r; else if (k === 2) p.z = b.minZ - r; else p.z = b.maxZ + r;
        } else { p.x = cx + dx / d * r; p.z = cz + dz / d * r; }
      }
    } : () => {},
    addBoxCollider() {},
    colliderContains: (c, x, z, pad) => { pad = pad || 0; return x >= c.minX - pad && x <= c.maxX + pad && z >= c.minZ - pad && z <= c.maxZ + pad; },
    queryColliders: boxQuery,
    sun, skyDome: null, renderer: null, fps: 60, sfx: { tone() {} }, lock() { input.locked = true; }, unlock() { input.locked = false; },
    touch: null, stop() {},
    stepSim(d) {
      clock += d;
      for (const f of frameHooks.slice()) f(d);
      for (const k in input.down) input.down[k] = false;
      input.mx = input.mz = 0; input.clicked[0] = false;
    },
  };
  CBZ.queryCollidersNear = boxQuery;
  // gunfx's drawing half: the rounds are drawn, nothing here can see them
  CBZ.tracer = () => {}; CBZ.sfx = () => {}; CBZ.bulletImpact = () => {}; CBZ.bulletHole = () => {}; CBZ.muzzleFlash = () => {};
  CBZ.WILDLIFE_SPECIES = {};
  CBZ.ordnance = {
    init() {}, step() {}, addTarget: (t) => t, removeTarget() {}, kinds: {},
    stick: (o) => { sb._sticks = (sb._sticks || 0) + 1; }, release() {},
  };
  // run the page
  try { for (const s of PAGE_SCRIPTS) vm.runInContext(s.code, sb, { filename: s.name }); }
  catch (e) { return { err: e }; }
  // the combat dice: the page's own lcg, reseeded so a tool can run N seeds
  if (opts.seed != null) vm.runInContext("_s = " + ((opts.seed | 0) & 0x7fffffff), sb);
  return { sb, CBZ, doc, posted, input, B: () => sb.__battle, frames: frameHooks, THREE, boxes: boxesNow };
}
export async function settle() { for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r)); }
export function run(W, secs, each) {
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
/* The node world's studio.boom is a stub; this gives it the shape of the
   real one (modecaps blastWorldActors: everyone inside 0.55 R takes the
   blast, with `by` and `fromX/Z`) so a high-explosive round can kill. */
export function realBoom(W) {
  W.CBZ.studio.boom = function (p, o) {
    // with the `caps` pack in, this IS the real sweep (studio.js boom ->
    // modecaps blastWorldActors -> the page's joined hurt funnel)
    if (W.CBZ.blastWorldActors && W.CBZ.modes && W.CBZ.modes.npcwar) {
      o = o || {};
      const R0 = o.radius > 0 ? o.radius : 18;
      return { hit: W.CBZ.blastWorldActors(p.x, p.y || 1, p.z, R0, o.power > 0 ? o.power : 1, o) || 0 };
    }
    const R = (o && o.radius) || 6, LR = R * 0.55;
    const list = W.sb.__battle.roster().slice();
    for (const a of list) {
      if (a.dead || a.fled || (a.group && a.group.visible === false)) continue;
      if (Math.hypot(a.pos.x - p.x, a.pos.z - p.z) > LR || Math.abs(a.pos.y - p.y) > LR + 3) continue;
      W.sb.hurtMan(a, 1e6, { fromX: p.x, fromZ: p.z, by: (o && o.by) || null, cause: "explosion" });
    }
  };
}
