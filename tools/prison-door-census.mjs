// tools/prison-door-census.mjs — plain-node door census (no browser):
// loads the prison door files into a stub world (real three r128, stubbed
// CBZ/prisonKit/document) and reports every door
// spec, collider, breach row and leaf style (steel / bars), cycles every
// door open->clear, shut->solid, and tests the sally-port interlock.
// Usage: MORE=src/world/gunroom.js,src/world/adminwing.js,src/world/prisonwings.js,src/world/cellblock.js node tools/prison-door-census.mjs .
import fs from "fs";
import vm from "vm";
import path from "path";

const ROOT = process.argv[2];
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const noop = () => {};
function deep() {
  const f = function () { return P; };
  const P = new Proxy(f, {
    get(t, k) {
      if (k === Symbol.toPrimitive) return () => 0;
      if (k === "then") return undefined;
      if (k === "length") return 0;
      return P;
    },
    apply() { return P; },
    set() { return true; },
  });
  return P;
}
const ctx2d = deep();
const canvas = () => ({ width: 0, height: 0, getContext: () => ctx2d, style: {} });
const sandbox = {
  console, Math, Date, JSON, Object, Array, Float32Array, Uint8Array, Uint16Array, Uint32Array, Int32Array, Map, Set, WeakMap, Symbol, Number, String, Boolean, Error, Promise,
  document: { createElement: (t) => (t === "canvas" ? canvas() : deep()), getElementById: () => null, body: deep(), querySelector: () => null, addEventListener: noop },
  navigator: { userAgent: "node" },
  performance: { now: () => 0 },
  requestAnimationFrame: noop, setTimeout: noop, clearTimeout: noop, addEventListener: noop,
  location: { search: "", href: "" },
  URLSearchParams,
};
sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(read("src/vendor/three.r128.min.js"), sandbox, { filename: "three" });
vm.runInContext(read("src/vendor/BufferGeometryUtils.js"), sandbox, { filename: "bgu" });
const THREE = sandbox.THREE;

// ---- the stub world
const updates = [];
const scene = new THREE.Scene();
const CBZ = {
  scene, prisonRoot: scene, colliders: [], losBlockers: [], platforms: [],
  CONFIG: {}, COL: { WALL: 0x9aa0a8 }, DIM: { YH: 11 },
  WORLD: { exit: { x: 0, z: 128 }, cellBlock: { x0: -16, x1: 16, z0: -44, z1: -8 }, northYard: { x0: -30, x1: 30, z0: -8, z1: 52 }, southBlock: { x0: -44, x1: 44, z0: 52, z1: 128 } },
  onUpdate: (o, fn) => updates.push(fn), onAlways: noop,
  markCollidersDirty: noop, markPlatformsDirty: noop,
  cmat: (c) => new THREE.MeshLambertMaterial({ color: c }),
  mat: (c) => new THREE.MeshLambertMaterial({ color: c }),
  breach: [],
  registerBreachTarget(t) { CBZ.breach.push(t); },
  game: { mode: "escape", role: "inmate", state: "playing" },
  player: { pos: new THREE.Vector3(0, 0, 500) },
  guards: [], npcs: [],
};
CBZ.addBox = function (x, y, z, w, h, d, color, opts) {
  opts = opts || {};
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color }));
  m.position.set(x, y, z);
  scene.add(m);
  if (opts.solid) {
    const col = { minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, ref: m };
    if (opts.y0 != null) col.y0 = opts.y0;
    if (opts.y1 != null) col.y1 = opts.y1;
    CBZ.colliders.push(col); m.userData.collider = col;
  }
  if (opts.blockLOS) CBZ.losBlockers.push(m);
  return m;
};
const matCache = new Map();
CBZ.prisonKit = {
  skin: (k, t) => { const key = k + t; if (!matCache.has(key)) matCache.set(key, new THREE.MeshStandardMaterial({ color: t == null ? 0xffffff : t })); return matCache.get(key); },
  skinBox: (m) => m, toneUp: (c) => c, sign: noop, program: noop, combi: noop,
  stat(geo, mat, x, y, z, o) { o = o || {}; if (o.rz) geo.rotateZ(o.rz); if (o.rx) geo.rotateX(o.rx); if (o.ry) geo.rotateY(o.ry); geo.translate(x, y, z); scene.add(new THREE.Mesh(geo, mat)); return geo; },
};
CBZ.prisonKit = new Proxy(CBZ.prisonKit, { get: (t, k) => (k in t ? t[k] : () => new THREE.BoxGeometry(0.1, 0.1, 0.1)) });
CBZ.roomShell = noop; CBZ.sfx = noop;
sandbox.CBZ = CBZ;

function run(file) {
  try { vm.runInContext(read(file), sandbox, { filename: file }); return null; }
  catch (e) { return file + ": " + e.message.split("\n")[0]; }
}
const errs = [];
for (const f of ["src/world/corridorkit.js", "src/world/door.js"]) { const e = run(f); if (e) errs.push(e); }
// corridors.js needs buildSallyPort + roof/fence stubs
CBZ.prisonRoof = noop; CBZ.prisonFence = noop; CBZ.prisonBunk = noop;
{ const e = run("src/world/corridors.js"); if (e) errs.push(e); }
for (const f of (process.env.MORE || "").split(",").filter(Boolean)) { const e = run(f); if (e) errs.push(e); }

const specs = CBZ._prisonDoorSpecs || [];
const kinds = {}; const styleCount = {};
let bad = [];
for (const s of specs) {
  const id = s.id;
  const col = s.col && s.col();
  const inCols = col && CBZ.colliders.indexOf(col) >= 0;
  const pick = s.pick && s.pick();
  // leaf style: scan the pick objects for a barred or a steel leaf
  let style = "?";
  const objs = Array.isArray(pick) ? pick : [];
  let cyl = 0, box = 0;
  for (const o of objs) o.traverse && o.traverse((q) => { if (q.geometry) { const n = q.geometry.attributes.position.count; if (q.geometry.type === "BoxGeometry") box++; else cyl++; } });
  const styles = new Set();
  for (const o of objs) o.traverse && o.traverse((q) => { if (q.userData && q.userData.doorLeaf) styles.add(q.userData.doorLeaf); });
  // legacy leaves carry no tag: a barred one is a grille/bars group
  if (!styles.size) styles.add(/grille|corridor|sally|crib|knife|property|segreg|armory|cell-/.test(id) ? "legacy-bars?" : "legacy");
  style = [...styles].join("+");
  styleCount[style] = (styleCount[style] || 0) + 1;
  const k = /corridor-/.test(id) ? "corridor" : /-inner$/.test(id) ? "port-inner" : /-grille$/.test(id) ? "port-grille" : /-entry/.test(id) ? "port-entry" : /-out$/.test(id) ? "port-out" : /-booth$/.test(id) ? "booth" : id;
  kinds[k] = (kinds[k] || 0) + 1;
  const hooks = ["at", "pick", "col", "isOpen", "permanent", "canUse", "set"].filter((h) => typeof s[h] !== "function");
  if (!col) bad.push(id + " no collider");
  else if (!inCols) bad.push(id + " collider not live while shut");
  if (hooks.length) bad.push(id + " missing " + hooks.join(","));
}
// the unit door's own contract
const D = CBZ.door;
const unit = D ? {
  open: D.open, hasCollider: CBZ.colliders.indexOf(D.collider) >= 0, reader: !!D.readerLight, pad: !!D.padPos,
  openDoor: typeof CBZ.openDoor, closeDoor: typeof CBZ.closeDoor, drive: typeof D.drive,
} : null;
if (D && CBZ.openDoor) {
  CBZ.openDoor();
  unit.openDropsCollider = CBZ.colliders.indexOf(D.collider) < 0;
  CBZ.closeDoor();
  unit.closeRestoresCollider = CBZ.colliders.indexOf(D.collider) >= 0;
}
// a kit door: open it, tick until swung, shut it
let kitCycle = null;
const kd = CBZ.corridorKit && CBZ.corridorKit.doors && CBZ.corridorKit.doors[0];
if (kd) {
  kd.setOpen(true, true);
  for (let i = 0; i < 60; i++) for (const u of updates) { try { u(1 / 30); } catch (e) {} }
  const opened = CBZ.colliders.indexOf(kd.collider) < 0 && kd.t === 1;
  kd.setOpen(false, true);
  for (let i = 0; i < 60; i++) for (const u of updates) { try { u(1 / 30); } catch (e) {} }
  kitCycle = { id: kd.id, opened, shutSolid: CBZ.colliders.indexOf(kd.collider) >= 0 && kd.t === 0, pivots: kd.pivots ? kd.pivots.length : 1 };
}
const breach = CBZ.breach.map((b) => b.id);
console.log(JSON.stringify({ errs, specs: specs.length, styleCount, kinds, bad, unit, kitCycle, breachRows: breach.length,
  kitApi: CBZ.corridorKit ? Object.keys(CBZ.corridorKit).sort() : null }, null, 1));
// ---- every door through its own registry verb: open -> clear, shut -> solid
const tick = (n) => { for (let i = 0; i < n; i++) for (const u of updates) { try { u(1 / 30); } catch (e) {} } };
const cycle = { ok: 0, fail: [] };
for (const s of specs) {
  const col = s.col && s.col();
  if (!col) continue;
  try {
    const a = s.at(); CBZ.player.pos.set(a.x + 1.6, 0, a.z + 1.6);
    s.set(true); tick(20);
    const openClear = CBZ.colliders.indexOf(col) < 0 && s.isOpen();
    if (!openClear && process.env.DBG) console.log("DBG", s.id, "open", s.isOpen(), "colIn", CBZ.colliders.indexOf(col) >= 0);
    CBZ.player.pos.set(0, 0, 500);
    s.set(false); tick(90);
    const shutSolid = CBZ.colliders.indexOf(col) >= 0 && !s.isOpen();
    if (openClear && shutSolid) cycle.ok++; else cycle.fail.push(s.id + (openClear ? "" : " (open not clear)") + (shutSolid ? "" : " (shut not solid)"));
  } catch (e) { cycle.fail.push(s.id + " threw " + e.message); }
}
// the sally-port interlock: the out door refuses while the inner door is open
let interlock = null;
{
  const inner = specs.find((s) => /prison-exit-(inner|grille)$/.test(s.id));
  const out = specs.find((s) => s.id === "prison-exit-out");
  if (inner && out) {
    inner.set(true); tick(90);
    CBZ.player.pos.set(out.at().x, 0, out.at().z - 1.5);
    out.set(true); tick(2);
    const refusedWhileInnerOpen = !out.isOpen();
    tick(120);
    interlock = { refusedWhileInnerOpen, innerCycledShut: !inner.isOpen(), outReleased: out.isOpen() };
    out.set(false); tick(90);
  }
}
console.log(JSON.stringify({ cycle, interlock }));
