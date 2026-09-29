// tools/prison-door-census.mjs — plain-node door census (no browser):
// loads the prison door files into a stub world (real three r128, stubbed
// CBZ/prisonKit/document) and reports every door
// spec, collider, breach row and leaf style (steel / bars), cycles every
// door open->clear, shut->solid, and tests the sally-port interlock.
// Usage: MORE=src/world/cafeteria.js,src/world/yard.js,src/world/gunroom.js,src/world/adminwing.js,src/world/prisonwings.js,src/world/cellblock.js node tools/prison-door-census.mjs .
//   (yard.js draws the coping over the four yard gates' heads; cafeteria.js paints the admin wing's wood leaves)
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

// WHO BUILT IT: every collider pushed and every object added while the door
// kit (world/corridorkit.js) is on the stack is the kit's, and the sweep at
// the foot of this file holds exactly those to drawn == solid
const KIT_RE = /src\/world\/corridorkit\.js/;
{
  const cols = CBZ.colliders, push0 = cols.push;
  cols.push = function () { if (KIT_RE.test(new Error().stack)) for (const c of arguments) if (c) c._kit = true; return push0.apply(this, arguments); };
  const add0 = THREE.Object3D.prototype.add;
  THREE.Object3D.prototype.add = function () {
    if (KIT_RE.test(new Error().stack)) for (const o of arguments) if (o && o.userData) o.userData._kit = true;
    return add0.apply(this, arguments);
  };
}
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
const cycle = { ok: 0, fail: [], sealed: [] };
for (const s of specs) {
  const col = s.col && s.col();
  if (!col) continue;
  // the upper tier is the lockdown tier (world/cellblock.js): its fronts are
  // shut by design and never take a hand, so they are not a cycle failure
  if (/^prison-cell-/.test(s.id) && s.canUse && !s.canUse() && s.permanent && s.permanent()) {
    const shut = CBZ.colliders.indexOf(col) >= 0 && !s.isOpen();
    if (shut) { cycle.sealed.push(s.id); continue; }
  }
  try {
    // stand at it, on its own floor (a room door is proximity-held: from
    // 2.3 m away a free door's own tick shuts it again; an upper-tier cell
    // is on the tier, 3.9 m up)
    const a = s.at(); CBZ.player.pos.set(a.x + 0.7, Math.max(0, a.y - 1.4), a.z + 0.7);
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

/* ---- DRAWN == SOLID for every piece of the door kit (2026-09-29) --------
   Every door shut, then a 3-D sweep (10 cm across, 20 cm up):
     GHOST   inside a KIT collider (the door kit's leaves, piers, heads and
             buildings, the yard gates' heads) with nothing drawn within
             10 cm: an invisible wall. Swept from the floor to the top of
             the collider, or to 14 m when it has no top (a wall to the sky).
     PHANTOM inside a piece the kit DREW with no collider within 10 cm and
             no floor under it. Hinges, readers, lamps and the architrave sit
             inside the 10 cm.
   The drawn oracle is point-in-hull on every convex piece (box / cylinder)
   and the local box of a merged one (a leaf). DOOR_GHOST_GATE=1 exits 1 on
   any ghost. */
{
  for (const s of specs) { try { if (s.isOpen()) s.set(false); } catch (e) {} }
  tick(120);
  scene.updateMatrixWorld(true);
  const HULLS = [];
  const _v = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
  const kitOf = (m) => { for (let o = m; o; o = o.parent) if (o.userData && (o.userData._kit || o.userData.doorHead)) return true; return false; };
  scene.traverse((m) => {
    if (!m.isMesh || !m.geometry || !m.geometry.attributes.position) return;
    // (glass counts: a glazed leaf is drawn, you just see through it)
    const g = m.geometry, t = g.type, W = m.matrixWorld;
    const planes = [];
    if (/^(Box|Cylinder)(Buffer)?Geometry$/.test(t)) {
      const pos = g.attributes.position, idx = g.index, pts = [];
      for (let i = 0; i < pos.count; i++) pts.push(_v.fromBufferAttribute(pos, i).applyMatrix4(W).clone());
      const n = idx ? idx.count : pos.count;
      for (let i = 0; i < n; i += 3) {
        const i0 = idx ? idx.getX(i) : i, i1 = idx ? idx.getX(i + 1) : i + 1, i2 = idx ? idx.getX(i + 2) : i + 2;
        _a.copy(pts[i1]).sub(pts[i0]); _b.copy(pts[i2]).sub(pts[i0]);
        const nn = _c.copy(_a).cross(_b), L = nn.length();
        if (L < 1e-9) continue;
        nn.multiplyScalar(1 / L);
        const d = nn.dot(pts[i0]);
        if (!planes.some((p) => p.n.distanceTo(nn) < 1e-4 && Math.abs(p.d - d) < 1e-4)) planes.push({ n: nn.clone(), d });
      }
    } else {
      // a merged piece: only a LEAF (it hangs on a mover pivot) is one slab;
      // anything else merged is many shapes and its box is not its volume
      let leaf = false;
      for (let o = m; o; o = o.parent) if (o.userData && (o.userData.mover || o.userData.doorLeaf)) { leaf = true; break; }
      if (!leaf) return;
      g.computeBoundingBox();
      const bb = g.boundingBox, N = new THREE.Matrix3().getNormalMatrix(W);
      for (const f of [[1, 0, 0, bb.max.x], [-1, 0, 0, -bb.min.x], [0, 1, 0, bb.max.y], [0, -1, 0, -bb.min.y], [0, 0, 1, bb.max.z], [0, 0, -1, -bb.min.z]]) {
        const n = new THREE.Vector3(f[0], f[1], f[2]);
        const p = n.clone().multiplyScalar(f[3]).applyMatrix4(W);
        n.applyMatrix3(N).normalize();
        planes.push({ n, d: n.dot(p) });
      }
    }
    if (planes.length < 4) return;
    HULLS.push({ planes, bb: new THREE.Box3().setFromObject(m), kit: kitOf(m) });
  });
  let NH = HULLS, NC = CBZ.colliders;
  const near = (x0, x1, z0, z1) => {
    NH = HULLS.filter((H) => H.bb.max.x > x0 - 0.2 && H.bb.min.x < x1 + 0.2 && H.bb.max.z > z0 - 0.2 && H.bb.min.z < z1 + 0.2);
    NC = CBZ.colliders.filter((c) => c.maxX > x0 - 0.2 && c.minX < x1 + 0.2 && c.maxZ > z0 - 0.2 && c.minZ < z1 + 0.2);
  };
  const inHull = (H, x, y, z, tol) => {
    const bb = H.bb;
    if (x < bb.min.x - tol || x > bb.max.x + tol || y < bb.min.y - tol || y > bb.max.y + tol || z < bb.min.z - tol || z > bb.max.z + tol) return false;
    for (const p of H.planes) if (p.n.x * x + p.n.y * y + p.n.z * z - p.d > tol) return false;
    return true;
  };
  const drawn = (x, y, z, tol) => { for (const H of NH) if (inHull(H, x, y, z, tol)) return true; return false; };
  const solid = (x, y, z, pad) => {
    for (const c of NC) {
      if (x < c.minX - pad || x > c.maxX + pad || z < c.minZ - pad || z > c.maxZ + pad) continue;
      if (c.y0 != null && (y < c.y0 - pad || y > c.y1 + pad)) continue;
      return c;
    }
    return null;
  };
  const underFloor = (x, y, z) => {
    for (const p of CBZ.platforms || []) if (x >= p.minX - 0.1 && x <= p.maxX + 0.1 && z >= p.minZ - 0.1 && z <= p.maxZ + 0.1 && y <= p.top + 0.1) return true;
    return false;
  };
  const ST = 0.1, SY = 0.2, CV = ST * ST * SY;
  const doorCols = new Map(specs.map((s) => [s.col && s.col(), s.id]).filter((e) => e[0]));
  const KC = CBZ.colliders.filter((c) => c._kit || c.doorHead || doorCols.has(c));
  const bad = new Map();
  let ghost = 0, phantom = 0, cellGhost = 0;
  const note = (k, n) => bad.set(k, (bad.get(k) || 0) + n);
  for (const c of KC) {
    near(c.minX, c.maxX, c.minZ, c.maxZ);
    const y0 = c.y0 != null ? c.y0 : 0, y1 = c.y1 != null ? c.y1 : 14;
    let n = 0;
    for (let x = c.minX + ST / 2; x < c.maxX; x += ST) for (let z = c.minZ + ST / 2; z < c.maxZ; z += ST) for (let y = y0 + 0.1; y < y1; y += SY) {
      if (!drawn(x, y, z, 0.1)) n++;
    }
    if (n && process.env.DBGHEAD && c.doorHead) { const ys = []; for (let y = y0 + 0.1; y < y1; y += SY) if (!drawn((c.minX + c.maxX) / 2, y, (c.minZ + c.maxZ) / 2, 0.1)) ys.push(y.toFixed(1)); console.log("HEAD", ys.join(",")); }
    if (n && /^prison-cell-/.test(doorCols.get(c) || "")) { cellGhost += n; continue; }
    if (n) { ghost += n; note("ghost " + (c.y0 == null ? "no band" : "band " + c.y0.toFixed(2) + "-" + c.y1.toFixed(2)) + " " + (c.maxX - c.minX).toFixed(2) + "x" + (c.maxZ - c.minZ).toFixed(2) + (c.doorHead ? " gate head" : doorCols.has(c) ? " leaf " + doorCols.get(c) : ""), n); }
  }
  for (const H of HULLS) {
    if (!H.kit) continue;
    const bb = H.bb;
    if (bb.max.x - bb.min.x < 0.15 && bb.max.z - bb.min.z < 0.15) continue;      // a lamp, a hinge, a reader
    if (bb.max.y - bb.min.y < 0.25) continue;                                      // a floor slab you walk on, a roof overhead
    near(bb.min.x, bb.max.x, bb.min.z, bb.max.z);
    let n = 0;
    for (let x = bb.min.x + ST / 2; x < bb.max.x; x += ST) for (let z = bb.min.z + ST / 2; z < bb.max.z; z += ST) for (let y = Math.max(0.05, bb.min.y + 0.05); y < bb.max.y; y += SY) {
      if (inHull(H, x, y, z, 0) && !solid(x, y, z, 0.1) && !underFloor(x, y, z)) n++;
    }
    if (n) { phantom += n; note("phantom " + (bb.max.x - bb.min.x).toFixed(2) + "x" + (bb.max.y - bb.min.y).toFixed(2) + "x" + (bb.max.z - bb.min.z).toFixed(2) + " at y " + bb.min.y.toFixed(1), n); }
  }
  const rowsOut = [...bad.entries()].sort((a, b) => b[1] - a[1]).slice(0, +(process.env.ROWS || 14)).map((e) => e[0] + ": " + (e[1] * CV).toFixed(3) + " m3");
  console.log(JSON.stringify({ drawnEqualsSolid: { kitColliders: KC.length, ghostM3: +(ghost * CV).toFixed(3),
    // world/cellblock.js's barred fronts (not the kit): the front's collider is
    // the face's 0.24 m, the sliding leaf runs 13 cm in front of it
    cellFrontRevealM3: +(cellGhost * CV).toFixed(3), phantomM3: +(phantom * CV).toFixed(3), worst: rowsOut } }, null, 1));
  if (process.env.DOOR_GHOST_GATE && ghost * CV > 0.01) process.exitCode = 1;
}
