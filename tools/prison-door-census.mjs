// tools/prison-door-census.mjs — plain-node door census (no browser):
// loads the prison door files into a stub world (real three r128, stubbed
// CBZ/prisonKit/document) and reports every door
// spec, collider, breach row and leaf style (steel / bars), cycles every
// door open->clear, shut->solid, and tests the sally-port interlock.
//
// THE PLAYER PATH (2026-09-29, owner: "a lot of them don't open. Make sure all
// doors are openable" + "the button works too far ... shows through shit"):
// systems/interactions.js is loaded too, and for EVERY door record the player
// is stood in front of it, facing it, with empty pockets: the pill the real
// targeting code shows is read (Open / Close / Locked + what it needs); when
// locked, the named item is handed over and the verb must turn into Swipe /
// Unlock / Open; the real [E] function (CBZ.prisonDoorVerbNearest) is fired
// and the leaf must MOVE, its slab must leave CBZ.colliders and a probe point
// in the doorway must be walkable; then Close must shut it solid again.
// Negative cases: a player on the tier over a cell, a cell under the tier,
// and a player behind a wall must NOT get that door's pill.
// DOOR_PLAYER_GATE=1 exits 1 on any failure.
// Usage: node tools/prison-door-census.mjs .   (MORE defaults to the full door set below)
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
// the real world extents / dims / config (config.js), not hand-typed stubs:
// a stubbed WORLD left yard.js building a NaN-wide wall across the exit
try {
  vm.runInContext(read("src/config.js"), sandbox, { filename: "config" });
  const real = sandbox.CBZ;
  if (real) {
    if (real.WORLD) CBZ.WORLD = real.WORLD;
    if (real.DIM) CBZ.DIM = real.DIM;
    if (real.COL) CBZ.COL = Object.assign({}, real.COL, CBZ.COL);
    if (real.CONFIG) CBZ.CONFIG = real.CONFIG;
  }
} catch (e) { console.log("config.js: " + e.message); }
CBZ.checkerTex = () => new THREE.Texture();
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
// the REAL prisonkit.js for one thing: CBZ.guardTower, whose foot door is a
// kit door on the Corridor Key (the tower doors are doors too). The census's
// own stub kit stays the one every other file draws with.
{
  const stubKit = CBZ.prisonKit;
  CBZ.prisonKit = undefined;
  const e = run("src/world/prisonkit.js");
  if (e) errs.push(e);
  CBZ.prisonKit = stubKit;
}
{ const e = run("src/world/ladderkit.js"); if (e && process.env.DBG) console.log(e); }
for (const f of ["src/world/corridorkit.js", "src/world/door.js"]) { const e = run(f); if (e) errs.push(e); }
// corridors.js needs buildSallyPort + roof/fence stubs
CBZ.prisonRoof = noop; CBZ.prisonFence = noop; CBZ.prisonBunk = noop;
{ const e = run("src/world/corridors.js"); if (e) errs.push(e); }
const MORE_DEFAULT = "src/world/cafeteria.js,src/world/lounge.js,src/world/southblock.js,src/world/yard.js,src/world/towers.js,src/world/gunroom.js,src/world/adminwing.js,src/world/prisonwings.js,src/world/cellblock.js";
for (const f of (process.env.MORE != null ? process.env.MORE : MORE_DEFAULT).split(",").filter(Boolean)) { const e = run(f); if (e) errs.push(e); }
// the one door verb, the real targeting code (systems/interactions.js)
const econItems = new Set();
CBZ.econ = { hasItem: (k) => econItems.has(k), takeItem: (k) => econItems.delete(k) };
CBZ.cam = { yaw: 0 };
CBZ.keys = {};
CBZ.el = new Proxy({}, { get: () => deep() });
CBZ.keycard = deep();
CBZ.worldSfx = noop; CBZ.flashHint = noop; CBZ.setObjective = noop; CBZ.addHeat = noop;
CBZ.player.crouch = false; CBZ.player.radius = 0.4;
{ const e = run("src/systems/interactions.js"); if (e) errs.push(e); }
// (a build older than the targeting rewrite has no CBZ.prisonDoorTarget: the
// census reads its doorVerbPrompt's own rule, verbatim, so before/after compare)
if (!CBZ.prisonDoorTarget) {
  CBZ.prisonDoorTarget = function () {
    const P = CBZ.player.pos, yaw = CBZ.cam.yaw, fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    let best = null, bd = 2.6 * 2.6;
    for (const s of CBZ._prisonDoorSpecs) {
      let o, gone, cred; try { o = !!s.isOpen(); gone = !!(s.permanent && s.permanent()); cred = !!s.canUse(); } catch (e) { continue; }
      if (gone || !cred || (!o && s.openByTap === false)) continue;
      const a = s.at(), dx = a.x - P.x, dz = a.z - P.z, d2 = dx * dx + dz * dz;
      if (d2 >= bd) continue;
      const len = Math.hypot(dx, dz) || 1;
      if ((dx / len) * fx + (dz / len) * fz < 0.35) continue;
      bd = d2; best = { id: s.id, verb: o ? "Close" : "Open", sub: "" };
    }
    return best;
  };
}

const specs = CBZ._prisonDoorSpecs || [];
// a collider with a NaN edge is invisible to every test that compares it (and
// a hit to a naive one): name any, they are bugs in the file that built them
const nanCols = CBZ.colliders.filter((c) => [c.minX, c.maxX, c.minZ, c.maxZ].some((v) => typeof v !== "number" || v !== v));
if (nanCols.length) errs.push("NaN colliders: " + nanCols.length + " " + JSON.stringify(nanCols.slice(0, 3).map((c) => [c.minX, c.maxX, c.minZ, c.maxZ, c.y0, c.y1, c.ref && c.ref.geometry && c.ref.geometry.parameters])));
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

/* ---- THE PLAYER PATH: every door, opened and shut by the player's own verb */
const playerPath = { doors: 0, ok: 0, verbs: {}, fail: [], negatives: { tierAbove: 0, underTier: 0, behindWall: 0, fail: [] } };
{
  const G = CBZ.game;
  const P = CBZ.player.pos;
  const colIn = (c) => CBZ.colliders.indexOf(c) >= 0;
  const inSolid = (x, y, z, pad, skip) => {
    for (const c of CBZ.colliders) {
      if (skip && skip.indexOf(c) >= 0) continue;
      if (x < c.minX - pad || x > c.maxX + pad || z < c.minZ - pad || z > c.maxZ + pad) continue;
      if (c.y0 != null && (y < c.y0 || y > c.y1)) continue;
      return c;
    }
    return null;
  };
  const boxesOf = (s) => (s.cols ? s.cols() : [s.col()]).filter(Boolean);
  const floorOf = (s, c) => (s.floor ? s.floor() : (c.y0 != null ? c.y0 : Math.max(0, s.at().y - 1.4)));
  const face = (x, z) => { CBZ.cam.yaw = Math.atan2(-(x - P.x), -(z - P.z)); };
  // every leaf's pose (a pair's two leaves swing opposite ways: never summed)
  const leafSig = (s) => (s.pick() || []).filter(Boolean).map((o) => [o.rotation ? o.rotation.y : 0, o.position ? o.position.x : 0, o.position ? o.position.z : 0]);
  const poseDiff = (a, b) => { let m = 0; for (let i = 0; i < Math.min(a.length, b.length); i++) for (let k = 0; k < 3; k++) m = Math.max(m, Math.abs(a[i][k] - b[i][k])); return m; };
  const pockets = (items, card) => { econItems.clear(); for (const k of items || []) econItems.add(k); G.hasKey = !!card; };
  const settle = (n) => tick(n || 45);
  // stand in front of the slab (0.95 m off its face, on its floor), facing it,
  // on the first side that is open floor with a clear line to the leaf
  function standAt(s) {
    for (const c of boxesOf(s)) {
      const fy = floorOf(s, c);
      const cx = (c.minX + c.maxX) / 2, cz = (c.minZ + c.maxZ) / 2;
      const alongX = (c.maxX - c.minX) >= (c.maxZ - c.minZ);
      for (const side of [-1, 1]) {
        const x = alongX ? cx : cx + side * ((c.maxX - c.minX) / 2 + 0.95);
        const z = alongX ? cz + side * ((c.maxZ - c.minZ) / 2 + 0.95) : cz;
        if (inSolid(x, fy + 1.0, z, 0.3, [c])) continue;
        P.set(x, fy, z); face(cx, cz);
        const t = CBZ.prisonDoorTarget && CBZ.prisonDoorTarget();
        if (t && t.id === s.id) return { c, fy, cx, cz, t };
      }
    }
    return null;
  }
  const doorwayClear = (st) => !inSolid(st.cx, st.fy + 1.0, st.cz, 0.05, null);
  for (const s of specs) {
    if (s.permanent && s.permanent()) continue;
    playerPath.doors++;
    const why = [];
    G.role = "inmate"; pockets([], false);
    let st = standAt(s);
    if (!st) { playerPath.fail.push(s.id + ": no pill from in front of it (reach/floor/sight/facing)"); continue; }
    // an open door first shuts by hand ("Close"), so the open half is tested from shut
    if (s.isOpen()) {
      if (st.t.verb !== "Close") why.push("open door says " + st.t.verb);
      CBZ.prisonDoorVerbNearest(); settle(90);
      if (s.isOpen() || !colIn(boxesOf(s)[0])) why.push("Close did not shut it solid");
      st = standAt(s) || st;
    }
    const shutSig = leafSig(s);
    let t = CBZ.prisonDoorTarget();
    let verb = t ? t.verb : null;
    const key = verb === "Locked" ? t.sub : "";
    playerPath.verbs[verb + (key ? " (" + key + ")" : "")] = (playerPath.verbs[verb + (key ? " (" + key + ")" : "")] || 0) + 1;
    if (verb === "Locked") {
      if (!key) why.push("Locked with no key named");
      pockets(key && key !== "Keycard" ? [key] : [], key === "Keycard");
      t = CBZ.prisonDoorTarget(); verb = t ? t.verb : null;
      if (!/^(Open|Swipe|Unlock)$/.test(verb || "")) why.push("with the " + key + " it says " + verb);
    } else if (verb !== "Open") why.push("shut door says " + verb);
    CBZ.prisonDoorVerbNearest(); settle(150);
    const opened = s.isOpen(), cleared = !colIn(st.c), moved = poseDiff(leafSig(s), shutSig) > 0.05, walk = doorwayClear(st);
    if (!opened) why.push("E did not open it");
    else {
      if (!cleared) why.push("open but its slab is still solid");
      if (!moved) why.push("open but the leaf never moved");
      if (!walk) { const c = inSolid(st.cx, st.fy + 1.0, st.cz, 0.05, null); why.push("doorway not walkable (" + (c && c.ref && c.ref.name || "box " + (c.maxX - c.minX).toFixed(2) + "x" + (c.maxZ - c.minZ).toFixed(2)) + ")"); }
      // and shut again, by hand
      const t2 = CBZ.prisonDoorTarget();
      if (!t2 || t2.id !== s.id || t2.verb !== "Close") why.push("open door offers " + (t2 ? t2.id + ":" + t2.verb : "nothing"));
      CBZ.prisonDoorVerbNearest(); settle(120);
      if (s.isOpen() || !colIn(st.c)) why.push("Close did not shut it solid");
      else if (poseDiff(leafSig(s), shutSig) > 0.02) why.push("shut but the leaf is not home");
    }
    pockets([], false);
    if (why.length) playerPath.fail.push(s.id + ": " + why.join("; ")); else playerPath.ok++;
    // doors that stand open by day go back open
    try { if (s.id && CBZ.corridorKit && CBZ.corridorKit.doors) for (const d of CBZ.corridorKit.doors) if (d.id === s.id && d.home && !d.open) d.setOpen(true, true); } catch (e) {}
  }
  settle(60);
  // ---- NEGATIVES: another floor, a wall between -------------------------
  // every key in the pockets, so no credential can hide a pill that the
  // targeting itself should have refused
  G.role = "cop"; pockets(["Cell Key", "Corridor Key", "Gate Key", "Gun-Room Key", "Lockpick"], true);
  const cb = CBZ.cellblock;
  const cellCells = cb && cb.cells ? cb.cells : [];
  const cellSpecs = specs.filter((s) => /^prison-cell-/.test(s.id));
  const FY = cb && cb.tierFloor ? cb.tierFloor : 3.9;
  for (const s of cellSpecs) {
    const c = s.col(); const fy = floorOf(s, c);
    const cx = (c.minX + c.maxX) / 2, cz = (c.minZ + c.maxZ) / 2;
    const alongX = (c.maxX - c.minX) >= (c.maxZ - c.minZ);
    for (const side of [-1, 1]) {
      const x = alongX ? cx : cx + side * 1.1, z = alongX ? cz + side * 1.1 : cz;
      // the other floor, straight over / under the same spot, looking at it
      const oy = fy > 1 ? 0 : FY;
      P.set(x, oy, z); face(cx, cz);
      const t = CBZ.prisonDoorTarget();
      if (fy > 1) playerPath.negatives.underTier++; else playerPath.negatives.tierAbove++;
      if (t && t.id === s.id) playerPath.negatives.fail.push(s.id + " offered '" + t.verb + "' from " + (fy > 1 ? "the floor under it" : "the tier over it"));
    }
  }
  // behind a wall: every door, sampled around it within arm's reach, on its
  // floor, where the census's own slab test says something solid stands
  // between the eyes and the leaf
  const segHits = (ax, ay, az, bx, by, bz, skip) => {
    const d = [bx - ax, by - ay, bz - az], o = [ax, ay, az];
    for (const c of CBZ.colliders) {
      if (skip.indexOf(c) >= 0) continue;
      if (bx >= c.minX && bx <= c.maxX && bz >= c.minZ && bz <= c.maxZ && (c.y0 == null || (by >= c.y0 && by <= c.y1))) continue;   // the thing's own box
      const lo = [c.minX, c.y0 != null ? c.y0 : -1e9, c.minZ], hi = [c.maxX, c.y1 != null ? c.y1 : 1e9, c.maxZ];
      let t0 = 0, t1 = 1, ok = true;
      for (let k = 0; k < 3 && ok; k++) {
        if (Math.abs(d[k]) < 1e-12) { if (o[k] < lo[k] || o[k] > hi[k]) ok = false; continue; }
        let ta = (lo[k] - o[k]) / d[k], tb = (hi[k] - o[k]) / d[k];
        if (ta > tb) { const q = ta; ta = tb; tb = q; }
        t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
        if (t0 > t1) ok = false;
      }
      if (ok) return c;
    }
    return null;
  };
  for (const s of specs) {
    if (s.permanent && s.permanent()) continue;
    const boxes = boxesOf(s);
    const c = boxes[0]; const fy = floorOf(s, c);
    const cx = (c.minX + c.maxX) / 2, cz = (c.minZ + c.maxZ) / 2;
    const halfSpan = Math.max(c.maxX - c.minX, c.maxZ - c.minZ) / 2;
    for (let a = 0; a < 32 * 5; a++) {
      const ang = (a % 32) / 32 * Math.PI * 2, r = 0.8 + Math.floor(a / 32) * 0.45 + halfSpan * 0.5;
      const x = cx + Math.cos(ang) * r, z = cz + Math.sin(ang) * r;
      if (inSolid(x, fy + 1.0, z, 0.35, null)) continue;
      // aim where the real code aims: the slab's nearest point, 0.25 m in from its ends
      const w = c.maxX - c.minX, dd = c.maxZ - c.minZ, ix = w > dd ? Math.min(0.25, w / 2) : 0, iz = dd >= w ? Math.min(0.25, dd / 2) : 0;
      const tx = Math.max(c.minX + ix, Math.min(c.maxX - ix, x)), tz = Math.max(c.minZ + iz, Math.min(c.maxZ - iz, z));
      if (Math.hypot(Math.max(c.minX - x, 0, x - c.maxX), Math.max(c.minZ - z, 0, z - c.maxZ)) > 1.8) continue;   // out of reach anyway
      const L = Math.hypot(tx - x, fy + 1.35 - (fy + 1.55), tz - z) || 1, k = Math.max(0, (L - 0.3) / L);
      const blk = segHits(x, fy + 1.55, z, x + (tx - x) * k, fy + 1.55 + (fy + 1.35 - fy - 1.55) * k, z + (tz - z) * k, boxes);
      if (!blk) continue;
      // only a wall that is not part of this door's own frame (the piers of
      // its infill touch the slab's ends): a box whose nearest face is > 0.3 m
      // from the slab
      const gap = Math.max(blk.minX - c.maxX, c.minX - blk.maxX, blk.minZ - c.maxZ, c.minZ - blk.maxZ);
      if (gap < 0.3) continue;
      P.set(x, fy, z); face(tx, tz);
      playerPath.negatives.behindWall++;
      const t = CBZ.prisonDoorTarget();
      if (t && t.id === s.id) playerPath.negatives.fail.push(s.id + " offered '" + t.verb + "' through a wall from (" + x.toFixed(1) + "," + z.toFixed(1) + ")" + (process.env.DBG ? " blk " + JSON.stringify([blk.minX, blk.maxX, blk.minZ, blk.maxZ, blk.y0, blk.y1].map((v) => v == null ? v : +v.toFixed(2))) + " slab " + JSON.stringify([c.minX, c.maxX, c.minZ, c.maxZ].map((v) => +v.toFixed(2))) : ""));
    }
  }
  P.set(0, 0, 500);
  G.role = "inmate"; pockets([], false);
}
console.log(JSON.stringify({ playerPath }, null, 1));
if (process.env.DOOR_PLAYER_GATE && (playerPath.fail.length || playerPath.negatives.fail.length)) process.exitCode = 1;

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
