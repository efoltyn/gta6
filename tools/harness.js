/* ============================================================
   tools/harness.js — headless smoke harness for CITY mode.
   Stubs THREE + DOM + the shared engine, loads the real config and all
   city/* files in index.html order, then exercises build/spawn/frames.
   Run: node tools/harness.js
============================================================ */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const PROFILE = process.env.CBZ_PROFILE === "1";

// ---------- THREE stub ----------
function V3(x, y, z) { this.x = x || 0; this.y = y || 0; this.z = z || 0; }
V3.prototype.set = function (x, y, z) { this.x = x; this.y = y; this.z = z; return this; };
V3.prototype.copy = function (v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; };
V3.prototype.clone = function () { return new V3(this.x, this.y, this.z); };
V3.prototype.add = function (v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; };
V3.prototype.sub = function (v) { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; };
V3.prototype.multiplyScalar = function (s) { this.x *= s; this.y *= s; this.z *= s; return this; };
V3.prototype.length = function () { return Math.hypot(this.x, this.y, this.z); };
V3.prototype.lengthSq = function () { return this.x * this.x + this.y * this.y + this.z * this.z; };
V3.prototype.normalize = function () { const l = this.length() || 1; this.x /= l; this.y /= l; this.z /= l; return this; };
V3.prototype.distanceTo = function (v) { return Math.hypot(this.x - v.x, this.y - v.y, this.z - v.z); };

function Euler() { this.x = 0; this.y = 0; this.z = 0; }
Euler.prototype.set = function (x, y, z) { this.x = x; this.y = y; this.z = z; return this; };
function Scale() { this.x = 1; this.y = 1; this.z = 1; }
Scale.prototype.set = function (x, y, z) { this.x = x; this.y = y; this.z = z; return this; };
Scale.prototype.setScalar = function (s) { this.x = this.y = this.z = s; return this; };
Scale.prototype.copy = function (v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; };
Scale.prototype.multiplyScalar = function (s) { this.x *= s; this.y *= s; this.z *= s; return this; };
function Quat() {}
Quat.prototype.setFromUnitVectors = function () { return this; };
Quat.prototype.copy = function () { return this; };

function Color(h) { this.r = 1; this.g = 1; this.b = 1; this._h = h || 0; if (h != null) { this.r = ((h >> 16) & 255) / 255; this.g = ((h >> 8) & 255) / 255; this.b = (h & 255) / 255; } }
Color.prototype.setHex = function (h) { this._h = h; this.r = ((h >> 16) & 255) / 255; this.g = ((h >> 8) & 255) / 255; this.b = (h & 255) / 255; return this; };
Color.prototype.getHex = function () { return this._h; };
Color.prototype.setRGB = function (r, g, b) { this.r = r; this.g = g; this.b = b; this._h = ((Math.round(r * 255) << 16) | (Math.round(g * 255) << 8) | Math.round(b * 255)) >>> 0; return this; };
Color.prototype.clone = function () { return new Color(this._h); };
// HSL round-trip (matches three r128 semantics closely enough for the harness:
// districtWallColor jitters hue/sat/light then reads back a hex).
Color.prototype.getHSL = function (t) {
  const r = this.r, g = this.g, b = this.b;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0; const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  t = t || {}; t.h = h; t.s = s; t.l = l; return t;
};
Color.prototype.setHSL = function (h, s, l) {
  h = ((h % 1) + 1) % 1;
  function f(p, q, t) {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  }
  if (s === 0) return this.setRGB(l, l, l);
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  return this.setRGB(f(p, q, h + 1 / 3), f(p, q, h), f(p, q, h - 1 / 3));
};
Color.prototype.copy = function (c) { return this.setRGB(c.r || 0, c.g || 0, c.b || 0); };
Color.prototype.lerp = function (c, k) { return this.setRGB(this.r + (c.r - this.r) * k, this.g + (c.g - this.g) * k, this.b + (c.b - this.b) * k); };
Color.prototype.lerpColors = function (a, b, k) { return this.setRGB(a.r + (b.r - a.r) * k, a.g + (b.g - a.g) * k, a.b + (b.b - a.b) * k); };
Color.prototype.set = function (v) { return typeof v === "number" ? this.setHex(v) : (v && v.r != null ? this.copy(v) : this); };
Color.prototype.multiplyScalar = function (s) {
  this.r *= s; this.g *= s; this.b *= s;
  this._h = ((Math.max(0, Math.min(255, Math.round(this.r * 255))) << 16) |
    (Math.max(0, Math.min(255, Math.round(this.g * 255))) << 8) |
    Math.max(0, Math.min(255, Math.round(this.b * 255)))) >>> 0;
  return this;
};

function Obj3D() {
  this.position = new V3(); this.rotation = new Euler(); this.scale = new Scale();
  this.quaternion = new Quat(); this.userData = {}; this.visible = true;
  this.parent = null; this.children = []; this.castShadow = false; this.receiveShadow = false;
}
Obj3D.prototype.add = function () { for (const o of arguments) { if (o) { o.parent = this; this.children.push(o); } } return this; };
Obj3D.prototype.remove = function (o) { const i = this.children.indexOf(o); if (i >= 0) { this.children.splice(i, 1); o.parent = null; } return this; };
Obj3D.prototype.traverse = function (fn) { fn(this); for (const c of this.children.slice()) c.traverse(fn); };
Obj3D.prototype.lookAt = function () {};
// real THREE.Object3D has rotateX/Y/Z (rotate about a local axis); the stub
// lacked them (only Geo.prototype had them) even though real Mesh/Group/Sprite
// objects support this -- approximate by accumulating onto the plain Euler
// stub's fields, which is exact for a single axis and good enough for tests
// that only care that the mesh visibly picked a random-ish orientation.
Obj3D.prototype.rotateX = function (a) { this.rotation.x = (this.rotation.x || 0) + a; return this; };
Obj3D.prototype.rotateY = function (a) { this.rotation.y = (this.rotation.y || 0) + a; return this; };
Obj3D.prototype.rotateZ = function (a) { this.rotation.z = (this.rotation.z || 0) + a; return this; };
Obj3D.prototype.updateMatrix = function () { if (!this.matrix) this.matrix = new Matrix4(); return this.matrix; };
Obj3D.prototype.updateMatrixWorld = function () {};
Obj3D.prototype.getWorldPosition = function (v) { if (v && v.copy) v.copy(this.position); return v; };
Obj3D.prototype.clone = function () {
  const o = new Obj3D();
  o.position.copy(this.position); o.rotation.set(this.rotation.x, this.rotation.y, this.rotation.z); o.scale.copy(this.scale);
  o.userData = Object.assign({}, this.userData); o.visible = this.visible; o.castShadow = this.castShadow; o.receiveShadow = this.receiveShadow;
  return o;
};

function Group() { Obj3D.call(this); }
Group.prototype = Object.create(Obj3D.prototype);
function Mesh(geo, mtl) { Obj3D.call(this); this.geometry = geo; this.material = mtl; }
Mesh.prototype = Object.create(Obj3D.prototype);
Mesh.prototype.clone = function () { const m = new Mesh(this.geometry, this.material); m.position.copy(this.position); m.rotation.set(this.rotation.x, this.rotation.y, this.rotation.z); m.scale.copy(this.scale); m.userData = Object.assign({}, this.userData); m.visible = this.visible; return m; };
function Sprite(mtl) { Obj3D.call(this); this.material = mtl; }
Sprite.prototype = Object.create(Obj3D.prototype);

function Geo() { this.attributes = { position: new BufferAttribute(new Float32Array(0), 3), normal: new BufferAttribute(new Float32Array(0), 3), uv: new BufferAttribute(new Float32Array(0), 2) }; }
Geo.prototype.dispose = function () {};
Geo.prototype.setAttribute = function (name, attr) { this.attributes[name] = attr; return this; };
Geo.prototype.translate = function () { return this; };
Geo.prototype.scale = function () { return this; };
Geo.prototype.rotateX = function () { return this; };
Geo.prototype.rotateY = function () { return this; };
Geo.prototype.rotateZ = function () { return this; };
Geo.prototype.computeVertexNormals = function () {};
function BufferGeometry() { Geo.call(this); this.attributes = {}; }
BufferGeometry.prototype = Object.create(Geo.prototype);
BufferGeometry.prototype.setAttribute = function (name, attr) { this.attributes[name] = attr; return this; };
BufferGeometry.prototype.computeVertexNormals = function () {};
function Float32BufferAttribute(array, itemSize) { this.array = array; this.itemSize = itemSize; this.count = Math.floor(array.length / itemSize); }
function BufferAttribute(array, itemSize) { this.array = array; this.itemSize = itemSize; this.count = Math.floor((array && array.length || 0) / (itemSize || 1)); this.needsUpdate = false; }
BufferAttribute.prototype.setUsage = function () { return this; };
BufferAttribute.prototype.setXYZ = function () { return this; };
BufferAttribute.prototype.setX = function () { return this; };
BufferAttribute.prototype.getX = function (i) { return this.array[i * this.itemSize] || 0; };
BufferAttribute.prototype.getY = function (i) { return this.array[i * this.itemSize + 1] || 0; };
BufferAttribute.prototype.getZ = function (i) { return this.array[i * this.itemSize + 2] || 0; };
function BoxGeometry() { Geo.call(this); } BoxGeometry.prototype = Object.create(Geo.prototype);
function PlaneGeometry() { Geo.call(this); } PlaneGeometry.prototype = Object.create(Geo.prototype);
function CylinderGeometry() { Geo.call(this); } CylinderGeometry.prototype = Object.create(Geo.prototype);
function SphereGeometry() { Geo.call(this); } SphereGeometry.prototype = Object.create(Geo.prototype);
function IcosahedronGeometry() { Geo.call(this); } IcosahedronGeometry.prototype = Object.create(Geo.prototype);
function ConeGeometry() { Geo.call(this); } ConeGeometry.prototype = Object.create(Geo.prototype);
function CircleGeometry() { Geo.call(this); } CircleGeometry.prototype = Object.create(Geo.prototype);
function TorusGeometry() { Geo.call(this); } TorusGeometry.prototype = Object.create(Geo.prototype);

let nextMaterialId = 1;
function Mtl(opts) { opts = opts || {}; this.id = nextMaterialId++; this.color = new Color(opts.color); this.emissive = new Color(opts.emissive); this.emissiveIntensity = opts.emissiveIntensity != null ? opts.emissiveIntensity : 1; this.map = opts.map || null; this.opacity = opts.opacity != null ? opts.opacity : 1; this.transparent = !!opts.transparent; }
Mtl.prototype.dispose = function () {};
Mtl.prototype.clone = function () { return new Mtl({ color: this.color.getHex(), emissive: this.emissive.getHex(), emissiveIntensity: this.emissiveIntensity, map: this.map, opacity: this.opacity, transparent: this.transparent }); };
function Tex() { this.wrapS = 0; this.wrapT = 0; this.repeat = new V3(1, 1, 0); this.magFilter = 0; this.transparent = false; }
Tex.prototype.dispose = function () {};
function Raycaster() {}
Raycaster.prototype.set = function () { return this; };
Raycaster.prototype.intersectObjects = function () { return []; };

// Matrix4 + InstancedMesh stubs (city buildings/crowd pool instanced parts)
function Matrix4() { this.elements = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; }
Matrix4.prototype.identity = function () { return this; };
Matrix4.prototype.compose = function () { return this; };
Matrix4.prototype.decompose = function () { return this; };
Matrix4.prototype.copy = function () { return this; };
Matrix4.prototype.clone = function () { return new Matrix4(); };
Matrix4.prototype.multiply = function () { return this; };
Matrix4.prototype.makeRotationY = function () { return this; };
Matrix4.prototype.makeRotationX = function () { return this; };
Matrix4.prototype.makeRotationZ = function () { return this; };
Matrix4.prototype.makeTranslation = function () { return this; };
Matrix4.prototype.makeScale = function () { return this; };
Matrix4.prototype.setPosition = function () { return this; };
Matrix4.prototype.scale = function () { return this; };
Matrix4.prototype.multiplyMatrices = function () { return this; };
Matrix4.prototype.premultiply = function () { return this; };
Matrix4.prototype.invert = function () { return this; };
Matrix4.prototype.extractRotation = function () { return this; };
Matrix4.prototype.lookAt = function () { return this; };
function InstancedMesh(geo, mtl, count) {
  Mesh.call(this, geo, mtl);
  this.count = count;
  this.instanceMatrix = { needsUpdate: false, setUsage() {} };
  this.instanceColor = { needsUpdate: false };
}
InstancedMesh.prototype = Object.create(Mesh.prototype);
InstancedMesh.prototype.setMatrixAt = function () {};
InstancedMesh.prototype.getMatrixAt = function () {};
InstancedMesh.prototype.setColorAt = function () { this.instanceColor = this.instanceColor || { needsUpdate: false }; };

const THREE = {
  Group, Mesh, Sprite, Object3D: Obj3D,
  BoxGeometry, PlaneGeometry, CylinderGeometry, SphereGeometry, IcosahedronGeometry, ConeGeometry, CircleGeometry, TorusGeometry,
  BufferGeometry, Float32BufferAttribute, BufferAttribute, InstancedBufferAttribute: BufferAttribute, Raycaster, Matrix4, InstancedMesh,
  DynamicDrawUsage: 35048, StaticDrawUsage: 35044,
  MeshLambertMaterial: Mtl, MeshBasicMaterial: Mtl, MeshStandardMaterial: Mtl, SpriteMaterial: Mtl,
  CanvasTexture: Tex, Texture: Tex, Vector3: V3, Color, Quaternion: Quat, Euler,
  DoubleSide: 2, FrontSide: 0, BackSide: 1, RepeatWrapping: 1000, NearestFilter: 1003, LinearFilter: 1006,
  AdditiveBlending: 2, Math: { degToRad: (d) => d * Math.PI / 180 },
};

// ---------- DOM stub ----------
function fakeCanvas() {
  return {
    width: 256, height: 64,
    getContext: () => ({
      fillRect() {}, strokeRect() {}, clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, closePath() {},
      fillText() {}, strokeText() {}, arc() {}, ellipse() {}, fill() {}, save() {}, restore() {}, translate() {}, rect() {}, clip() {},
      rotate() {}, scale() {}, drawImage() {}, createLinearGradient: () => ({ addColorStop() {} }), createRadialGradient: () => ({ addColorStop() {} }),
      set fillStyle(v) {}, get fillStyle() { return ""; }, set strokeStyle(v) {}, get strokeStyle() { return ""; },
      set font(v) {}, set lineWidth(v) {}, set lineCap(v) {}, set textAlign(v) {}, set textBaseline(v) {},
      set globalAlpha(v) {}, get globalAlpha() { return 1; }, measureText: () => ({ width: 40 }),
    }),
  };
}
function fakeEl(tag) {
  const style = {}; const ds = {};
  return {
    tagName: tag, style, dataset: ds, children: [], _html: "",
    set innerHTML(v) { this._html = v; }, get innerHTML() { return this._html; },
    set textContent(v) { this._text = v; }, get textContent() { return this._text || ""; },
    classList: { add() {}, remove() {}, toggle() {} },
    appendChild(c) { this.children.push(c); return c; }, removeChild() {},
    addEventListener() {}, removeEventListener() {}, querySelector: () => fakeEl("div"),
    querySelectorAll: () => [], getContext: fakeCanvas().getContext, setAttribute() {}, getAttribute() { return null; },
    focus() {}, click() {}, remove() {}, offsetWidth: 100,
  };
}
const elements = {};
const documentStub = {
  body: fakeEl("body"), documentElement: fakeEl("html"),
  createElement: (t) => (t === "canvas" ? fakeCanvas() : fakeEl(t)),
  getElementById: (id) => (elements[id] || (elements[id] = fakeEl("div"))),
  querySelector: () => fakeEl("div"), querySelectorAll: () => [],
  addEventListener() {}, removeEventListener() {}, exitPointerLock() {}, pointerLockElement: { id: "lock" },
};

// ---------- window / global wiring ----------
const sandbox = {};
sandbox.window = sandbox;
sandbox.document = documentStub;
sandbox.location = { search: PROFILE ? "?profile=1" : "" };
sandbox.THREE = THREE;
sandbox.console = console;
sandbox.Math = Math; sandbox.JSON = JSON; sandbox.Date = Date; sandbox.Array = Array;
sandbox.Object = Object; sandbox.Map = Map; sandbox.Set = Set; sandbox.parseInt = parseInt;
sandbox.parseFloat = parseFloat; sandbox.isNaN = isNaN; sandbox.String = String; sandbox.Number = Number;
sandbox.requestAnimationFrame = () => 0; sandbox.cancelAnimationFrame = () => {};
sandbox.setTimeout = (fn) => 0; sandbox.clearTimeout = () => {};
sandbox.setInterval = () => 0; sandbox.clearInterval = () => {};
sandbox.addEventListener = () => {}; sandbox.removeEventListener = () => {};
sandbox.performance = { now: () => Date.now() };
sandbox.navigator = { userAgent: "node" };
sandbox.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
vm.createContext(sandbox);

function load(rel) {
  const p = path.join(__dirname, "..", rel);
  const src = fs.readFileSync(p, "utf8");
  try { vm.runInContext(src, sandbox, { filename: rel }); }
  catch (e) { console.error("LOAD FAIL", rel, "\n", e && e.stack || e); process.exit(1); }
}

// ---------- engine stubs (what city/* expects from the rest of CBZ) ----------
load("src/config.js");
const CBZ = sandbox.CBZ;
CBZ.scene = new Group();
CBZ.scene.fog = { near: 1, far: 100 };
CBZ.camera = new Group(); CBZ.camera.position.set(0, 20, -700);
CBZ.mat = (c, o) => new Mtl({ color: c, emissive: o && o.emissive, emissiveIntensity: o && o.ei });
const harnessMatCache = new Map();
CBZ.cmat = (c, o) => {
  o = o || {};
  const key = [c, o.emissive || 0, o.ei != null ? o.ei : 1].join("|");
  let m = harnessMatCache.get(key);
  if (!m) { m = CBZ.mat(c, o); m._shared = true; harnessMatCache.set(key, m); }
  return m;
};
CBZ.boxGeom = () => new BoxGeometry();
CBZ.addBox = function (x, y, z, w, h, d, color, opts) { opts = opts || {}; const m = new Mesh(new BoxGeometry(), CBZ.mat(color, opts)); m.position.set(x, y, z); CBZ.scene.add(m); if (opts.solid) { const c = { minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, ref: m }; if (opts.y0 != null) c.y0 = opts.y0; if (opts.y1 != null) c.y1 = opts.y1; CBZ.colliders.push(c); } return m; };
CBZ.checkerTex = () => new Tex(); CBZ.concreteTex = () => new Tex();
CBZ.markCollidersDirty = () => {};
CBZ.lerpAngle = (a, b, t) => a + (b - a) * t;
CBZ.damp = (a, b, l, dt) => a + (b - a) * (1 - Math.exp(-l * dt));
CBZ.collide = (pos, r) => false;
CBZ.floorAt = () => 0; CBZ.groundAt = (x, z) => 0;
CBZ.makeCharacter = function (cfg) {
  const g = new Group(); const body = new Group(); g.add(body);
  return { group: g, body, neck: new Group(), head: new Mesh(new BoxGeometry(), CBZ.mat(cfg && cfg.skin)), parts: {}, sockets: {}, skinSlots: {}, cfg };
};
CBZ.animChar = () => {};
CBZ.makeLabelSprite = (t) => { const s = new Sprite(new Mtl({})); s.scale = new Scale(); return s; };
CBZ.body = { hit() {}, busy() { return false; } };
CBZ.gore = () => {}; CBZ.clearGore = () => {};
CBZ.tracer = () => {}; CBZ.muzzleFlash = () => {};
CBZ.sfx = () => {}; CBZ.tone = () => {}; CBZ.noise = () => {};
CBZ.shake = () => {}; CBZ.hitFlash = () => {}; CBZ.doSlowmo = () => {};
CBZ.flashHint = () => {}; CBZ.flashToast = () => {}; CBZ.setObjective = () => {};
CBZ.pushKill = () => {}; CBZ.killFeedReset = () => {};
CBZ.fpsPunchAnim = () => {};
CBZ.requestLock = () => {}; CBZ.resetZoom = () => {};
CBZ.setMode = () => {}; CBZ.setRole = () => {}; CBZ.startRun = () => {};
CBZ.cam = { yaw: 0, pitch: 0.4 };
CBZ.sun = { position: new V3(), color: new Color(), intensity: 1, shadow: { camera: { left: 0, right: 0, top: 0, bottom: 0, far: 0, updateProjectionMatrix() {} } } };
CBZ.hemi = { intensity: 1 }; CBZ.sunTarget = new Group();
CBZ.fx = { clear() {}, particleCloud() {}, groundMarker() {}, blast() {}, flash() {} };
CBZ.fpsActive = () => false;
CBZ.onWeaponInventoryChanged = () => {}; CBZ.fpsResetWeapons = () => {}; CBZ.fpsAddAmmo = () => {};
CBZ.keys = {};
CBZ.bots = [];   // survival bots — empty in the city harness, but grapple iterates it
// player + playerChar
const pchar = CBZ.makeCharacter({ skin: 0xffccaa });
CBZ.playerChar = pchar;
CBZ.player = {
  pos: new V3(0, 0, -700), vy: 0, grounded: true, hp: 100, maxHp: 100, dead: false,
  ko: 0, stun: 0, sprint: false, crouch: false, speed: 0, driving: false, _vehicle: null,
  stamina: 100, _armor: 0, _boost: 0, _phys: { air: false, down: 0, kx: 0, kz: 0 }, _death: null,
  captureState: "normal", captureT: 0,
};
CBZ.registerMode = CBZ.registerMode || function (id, def) { CBZ.modes[id] = def; };

// ---------- load city files (index.html order) ----------
// Use the engine's real collider broadphase so navigation profiles reflect the
// browser runtime instead of the old no-op collision stub.
// deterministic seed architecture (CBZ.WORLD_SEED / seedStream / hash01) —
// index.html loads it right after config.js; buildings/expansion now call
// CBZ.hash01 at build time, so the harness must load it too or the island
// annex/facade-kit paths throw and silently vanish.
load("src/core/seed.js");
load("src/systems/physics.js");
// the shared body-physics layer (knockback/flinch/fling/HEAD-FLASH + order-24
// step that integrates cityPeds/cityCops). Provides the REAL CBZ.body (the stub
// above is replaced), needed to frame-test the gunfire/crash hit-flash.
load("src/systems/grapple.js");
// citynav/cityevents/crowd use the shared alloc-free spatial hash in the live
// game. Load it here too so focused profiles measure the real code path.
load("src/systems/spatialgrid.js");
// the ONE engine gun system's inventory layer (unlockWeapon/hasWeapon/reset)
if (fs.existsSync(path.join(__dirname, "..", "src/weapons/weapon-data.js"))) load("src/weapons/weapon-data.js");

const cityFiles = [
  "world", "buildings", "citynav", "expansion", "props", "mode", "economy", "hunger", "wanted",
  "gangs", "social", "realestate", "view", "peds", "level", "sizeup", "crowd", "police", "traffic", "vehicles",
  "shops", "careers", "interactions", "interact", "combat", "death", "leaderboard", "zillow", "empire", "hud",
  // aigoals: the crowd PURPOSE / needs layer (onUpdate 33) + the lone-wolf rampage
  // director (onUpdate 35). Loaded so the headless sim exercises both.
  "aigoals",
  // phone (action hub) + playerair (personal chopper/airstrike tick @42.5) — load
  // them so the headless loop exercises their per-frame ticks for crashes.
  "phone", "playerair",
  // family: pools + households + the kidnap director (onUpdate 36.2)
  "family",
  // swim: open water past the seawall (onUpdate 45.8)
  "swim",
];
for (const f of cityFiles) {
  const rel = "src/city/" + f + ".js";
  if (fs.existsSync(path.join(__dirname, "..", rel))) load(rel);
}

// sort updaters like loop.js does
CBZ.updaters.sort((a, b) => a.order - b.order);
CBZ.always.sort((a, b) => a.order - b.order);

// ---------- drive a city session ----------
const g = CBZ.game;
const profileStats = new Map();
let profileFrames = 0, profileStepMs = 0;
function profileCall(kind, entry, index, fn, dt) {
  if (!PROFILE) return fn(dt);
  const key = kind + "|" + index + "|" + entry.order + "|" + (entry.source || "");
  let s = profileStats.get(key);
  if (!s) { s = { kind, order: entry.order, source: entry.source || "", calls: 0, total: 0, peak: 0 }; profileStats.set(key, s); }
  const t0 = performance.now();
  try { return fn(dt); }
  finally {
    const ms = performance.now() - t0;
    s.calls++; s.total += ms; if (ms > s.peak) s.peak = ms;
  }
}
function step(dt) {
  const t0 = PROFILE ? performance.now() : 0;
  CBZ.now += dt;
  for (let i = 0; i < CBZ.updaters.length; i++) {
    const u = CBZ.updaters[i];
    if (g.state === "playing") profileCall("update", u, i, u.fn, dt);
  }
  for (let i = 0; i < CBZ.always.length; i++) {
    const a = CBZ.always[i];
    profileCall("always", a, i, a.fn, dt);
  }
  if (PROFILE) { profileFrames++; profileStepMs += performance.now() - t0; }
}

function printProfile() {
  if (!PROFILE || !profileFrames) return;
  console.log("== HEADLESS CPU PROFILE ==");
  console.log(`frames=${profileFrames} totalStepMs=${profileStepMs.toFixed(1)} avgStepMs=${(profileStepMs / profileFrames).toFixed(3)}`);
  const ranked = Array.from(profileStats.values()).sort((a, b) => b.total - a.total).slice(0, 30);
  for (const s of ranked) {
    console.log(`${s.total.toFixed(1).padStart(9)} ms total | ${(s.total / s.calls).toFixed(4).padStart(8)} avg | ${s.peak.toFixed(3).padStart(8)} peak | ${String(s.calls).padStart(6)} calls | ${s.kind}@${s.order} ${s.source}`);
  }
  if (CBZ.perfDetail) {
    console.log("== CITY SUBSYSTEM DETAIL ==");
    const detail = Object.entries(CBZ.perfDetail).sort((a, b) => b[1].total - a[1].total);
    for (const [name, s] of detail) {
      console.log(`${s.total.toFixed(1).padStart(9)} ms total | ${(s.total / s.calls).toFixed(4).padStart(8)} avg | ${String(s.calls).padStart(7)} calls | ${name}`);
    }
  }
}

function resetProfile() {
  profileStats.clear();
  profileFrames = 0;
  profileStepMs = 0;
  if (CBZ.perfDetail) CBZ.perfDetail = {};
}

// faithful reimplementation of physics.collide + groundAt to test geometry
const STEP_UP = 0.9;
function realCollide(pos, radius, feetY, headY) {
  for (const c of CBZ.colliders) {
    if (c.y0 != null && (headY <= c.y0 || feetY >= c.y1)) continue;
    const cx = Math.max(c.minX, Math.min(pos.x, c.maxX));
    const cz = Math.max(c.minZ, Math.min(pos.z, c.maxZ));
    let dx = pos.x - cx, dz = pos.z - cz; const d2 = dx * dx + dz * dz;
    if (d2 < radius * radius) {
      const d = Math.sqrt(d2);
      if (d < 0.0001) { const pX = Math.min(pos.x - c.minX, c.maxX - pos.x), pZ = Math.min(pos.z - c.minZ, c.maxZ - pos.z); if (pX < pZ) pos.x += (pos.x < (c.minX + c.maxX) / 2 ? -1 : 1) * (pX + radius); else pos.z += (pos.z < (c.minZ + c.maxZ) / 2 ? -1 : 1) * (pZ + radius); }
      else { const push = (radius - d) / d; pos.x += dx * push; pos.z += dz * push; }
    }
  }
}
function realGroundAt(x, z, fromY) {
  let best = 0; const reach = (fromY != null ? fromY : best) + STEP_UP;
  for (const p of CBZ.platforms) {
    if (x < p.minX || x > p.maxX || z < p.minZ || z > p.maxZ) continue;
    let top = p.top;
    if (p.ramp) { const r = p.ramp; let t = (z - r.z0) / (r.z1 - r.z0); if (t < 0) t = 0; else if (t > 1) t = 1; top = r.y0 + t * (r.y1 - r.y0); }
    if (top <= reach && top > best) best = top;
  }
  return best;
}
function testBuildings(city) {
  console.log("== building tests ==");
  // hard-mesh: try to walk straight through a wall of a shop; should be blocked
  const shop = city.lots.find((l) => l.building && l.building.shop && l.building.side === 0);
  let blocked = "n/a";
  if (shop) {
    const b = shop.building, ox = b.ox, oz = b.oz;
    // start inside, push toward the back (+z) wall; collide should stop us short
    const pos = { x: ox, y: 0, z: oz };
    for (let i = 0; i < 60; i++) { pos.z += 0.2; realCollide(pos, 0.5, 0.25, 1.7); }
    const backWall = oz + b.d / 2;
    blocked = pos.z < backWall - 0.2 ? "BLOCKED ok (z=" + pos.z.toFixed(1) + " < " + backWall.toFixed(1) + ")" : "PHASED z=" + pos.z.toFixed(1);
  }
  console.log("hard-mesh wall:", blocked);

  // stairs: walk a tall building's switchback up, checking support continuity
  const tall = city.lots.find((l) => l.building && l.building.storeys >= 3);
  if (tall) {
    const b = tall.building, ox = b.ox, oz = b.oz, w = b.w, d = b.d, storeys = b.storeys;
    const WT = 0.4, SW = 4.2, LD = 1.1, laneW = SW / 2;
    const ixMin = -w / 2 + WT, izMin = -d / 2 + WT, izMax = d / 2 - WT;
    let y = 0, worst = 0, ok = true; const roof = storeys * 4;
    for (let k = 0; k < storeys; k++) {
      const dir = (k % 2 === 0) ? 1 : -1;
      const startZ = dir > 0 ? izMin + 0.3 : izMax - 0.3, endZ = dir > 0 ? izMax - 0.3 : izMin + 0.3;
      const rampEndZ = endZ - dir * LD;
      const lx0 = (k % 2 === 0) ? ixMin : ixMin + laneW, lxc = ox + lx0 + laneW / 2;
      const N = 40;
      for (let i = 0; i <= N; i++) {
        const z = oz + startZ + (rampEndZ - startZ) * (i / N);
        const s = realGroundAt(lxc, z, y);
        const step = s - y; if (step > STEP_UP + 0.001) { ok = false; worst = Math.max(worst, step); }
        if (s > y) y = s;
      }
      // cross the landing to the next lane
      const lzc = oz + (rampEndZ + endZ) / 2;
      const s2 = realGroundAt(ox + ixMin + SW / 2, lzc, y); if (s2 - y > STEP_UP + 0.001) { ok = false; worst = Math.max(worst, s2 - y); } if (s2 > y) y = s2;
    }
    console.log("stairs: climbed to y=" + y.toFixed(2) + " / roof " + roof + "  continuous=" + ok + (worst ? " worstStep=" + worst.toFixed(2) : ""));
  }
}

function testNoWindowlessClutter(city) {
  console.log("== windowless-clutter tests ==");
  const lots = city.lots.concat(city.annex && city.annex.lots || []);
  const bad = lots.filter((l) => l.building &&
    (l.building.boarded || l.building.facade === "fortified" || l.building.facade === "residential" || l.building.name === "Abandoned Building"));
  if (bad.length) {
    const sample = bad.slice(0, 4).map((l) => (l.building.name || l.kind) + "@" + Math.round(l.cx) + "," + Math.round(l.cz)).join("; ");
    throw new Error("bad solid/sideways clutter shells still generated: " + sample);
  }
  for (const kind of ["food", "drugs"]) {
    const lot = lots.find((l) => l.kind === kind);
    if (!lot || !lot.building || !lot.building.windows || !lot.building.windows.length) {
      throw new Error(kind + " lot has no visible window records");
    }
  }
  console.log("windowless clutter: none; food/drug shops have windows");
}

function testIsland(city) {
  console.log("== island expansion tests ==");
  const X = city.annex, B = city.bridge;
  if (!X || !B) throw new Error("island expansion or bridge missing");
  const bridgeMid = { x: (B.minX + B.maxX) / 2, z: (B.minZ + B.maxZ) / 2 };
  const before = { ...bridgeMid };
  city.clampToCity(bridgeMid, 0.6);
  const bridgeOpen = Math.hypot(bridgeMid.x - before.x, bridgeMid.z - before.z) < 0.001;
  const gateX = city.maxX + 26;
  const gateBlocked = CBZ.colliders.some((c) => c.minX <= gateX && c.maxX >= gateX && c.minZ <= city.center.z && c.maxZ >= city.center.z);
  const shore = { x: X.cx + X.radius + 30, z: X.cz };
  city.clampToCity(shore, 0.6);
  const shoreClamp = Math.abs(Math.hypot(shore.x - X.cx, shore.z - X.cz) - (X.radius - 0.6)) < 0.001;
  const twins = X.towers.filter((l) => l.building && l.building.storeys >= 15);
  console.log(`bridgeOpen=${bridgeOpen} gateBlocked=${gateBlocked} shoreClamp=${shoreClamp} twinTowers=${twins.length}`);
  if (!bridgeOpen || gateBlocked || !shoreClamp || twins.length < 2) throw new Error("island expansion geometry failed");
}

function run() {
  console.log("== building city ==");
  const city = CBZ.buildCity();
  const lots = city.lots;
  const shops = lots.filter((l) => l.building && l.building.shop).length;
  const aband = (city.abandonedLots || []).length;
  const homes = (city.homeLots || []).length;
  const parks = lots.filter((l) => l.kind === "park").length;
  console.log(`lots=${lots.length} shops=${shops} abandoned=${aband} homes=${homes} parks=${parks}`);
  console.log(`colliders=${CBZ.colliders.length} platforms=${CBZ.platforms.length}`);
  console.log(`chopShop=${!!city.chopShop} realtor=${!!city.realtor} luxury=${!!city.luxuryLot}`);
  console.log(`island=${!!city.annex} islandLots=${city.annex ? city.annex.lots.length : 0} islandTowers=${city.annex ? city.annex.towers.length : 0} bridge=${!!city.bridge}`);

  testIsland(city);
  testBuildings(city);
  testNoWindowlessClutter(city);


  console.log("== entering city mode ==");
  g.mode = "city";
  const mode = CBZ.modes.city;
  g.state = "playing";
  mode.reset(g);
  console.log(`peds=${CBZ.cityPeds.length} cops=${CBZ.cityCops.length} cars=${CBZ.cityCars.length} gangs=${(CBZ.cityGangs || []).length}`);

  if (PROFILE && process.env.CBZ_PROFILE_ONLY === "1") {
    if (process.env.CBZ_PROFILE_SCENARIO === "wanted5") { g.wanted = 5; g.heat = 12000; }
    // RAMPAGE smoke: force a lone-wolf spree on a living ped and let it run, so the
    // active-shooter brain (peds.js rampageThink) + director (aigoals.js) are
    // exercised under the collision/grounding STUBS (logic-only — no physics claim).
    if (process.env.CBZ_PROFILE_SCENARIO === "rampage") {
      const victimPed = (CBZ.cityPeds || []).find((p) => p && !p.dead && !p.vendor && !p.gang);
      if (CBZ.cityStartRampage && victimPed) {
        const ok = CBZ.cityStartRampage(victimPed);
        console.log("== forced rampage on " + (victimPed.name || "?") + " ok=" + ok + " ==");
      } else console.log("== rampage hook missing — cannot force ==");
    }
    const frames = Math.max(60, Number(process.env.CBZ_PROFILE_FRAMES) || 1200);
    const warmup = Math.max(0, Number(process.env.CBZ_PROFILE_WARMUP_FRAMES) || 300);
    if (warmup) {
      console.log(`== profile warmup: ${warmup} frames ==`);
      for (let i = 0; i < warmup; i++) step(1 / 60);
      resetProfile();
    }
    console.log(`== focused ${process.env.CBZ_PROFILE_SCENARIO || "calm"} CPU profile: ${frames} frames ==`);
    for (let i = 0; i < frames; i++) step(1 / 60);
    if (process.env.CBZ_PROFILE_SCENARIO === "rampage") {
      const r = (CBZ.cityPeds || []).filter((p) => p && p.rampage).length;
      const dead = (CBZ.cityPeds || []).filter((p) => p && p.dead).length;
      console.log("== after rampage: activeRampagers=" + r + " deadPeds=" + dead + " ==");
    }
    printProfile();
    console.log("RESULT: OK");
    return;
  }
  if (process.env.CBZ_VEHICLES_ONLY === "1") {
    testVehicleModels();
    testCrash();
    console.log("RESULT: OK");
    return;
  }

  testZillow();
  testEmpire();
  testGlassRay();
  testVehicleModels();

  console.log("== 1200 frames ==");
  let thrown = 0;
  for (let i = 0; i < 1200; i++) {
    try { step(1 / 60); } catch (e) { thrown++; if (thrown <= 3) console.error("FRAME THROW @", i, e && e.message); }
  }
  console.log(`frames done, throws=${thrown}`);
  console.log(`cash=${g.cash} wanted=${g.wanted} kills=${g.kills} respect=${g.respect} peds=${CBZ.cityPeds.length} cops=${CBZ.cityCops.length}`);

  if (thrown > 0) { console.log("RESULT: FAIL (frame throws)"); process.exit(1); }

  testLevels();
  stressTest();
  if (!process.env.CBZ_SKIP_CRASH) testCrash();   // crash sim can hang amid concurrent tree edits; skippable for crowd/flee checks
  testCrowd();

  printProfile();
  console.log("RESULT: OK");
}

function testVehicleModels() {
  console.log("== named vehicle model audit ==");
  if (!CBZ.cityVehicleBodyKind || !CBZ.cityBuildAmbientCarVisual) throw new Error("vehicle audit hooks missing");
  const models = CBZ.cityEcon && CBZ.cityEcon.CARS || [];
  const allowed = new Set(["hatch", "sedan", "van", "pickup", "coupe", "suv", "muscle"]);
  let minParts = Infinity, maxDrawMeshes = 0;
  for (const model of models) {
    const bodyA = CBZ.cityVehicleBodyKind(model), bodyB = CBZ.cityVehicleBodyKind(model);
    if (!model.body || bodyA !== model.body || bodyB !== bodyA || !allowed.has(bodyA)) {
      throw new Error("unstable/wrong body mapping for " + model.name + ": " + bodyA + " / expected " + model.body);
    }
    const root = CBZ.cityBuildAmbientCarVisual(model.name);
    const dims = root.userData && root.userData.vehicleDims;
    const designStyle = root.userData && root.userData.designStyle;
    const sourceParts = root.userData && root.userData.sourceParts;
    const drawMeshes = root.userData && root.userData.drawMeshes;
    let meshes = 0;
    root.traverse((o) => { if (o.geometry) meshes++; });
    minParts = Math.min(minParts, sourceParts);
    maxDrawMeshes = Math.max(maxDrawMeshes, drawMeshes);
    if (!model.designStyle || designStyle !== model.designStyle || !dims || !(dims.width > 1.5) || !(dims.length > 3.5) ||
        sourceParts < 24 || meshes !== drawMeshes || drawMeshes > 12) {
      throw new Error("incomplete/expensive visual for " + model.name + ": dims=" + JSON.stringify(dims) +
        " designStyle=" + designStyle + " sourceParts=" + sourceParts + " drawMeshes=" + drawMeshes + " traversed=" + meshes);
    }
  }
  console.log("  ✓ " + models.length + " named models have stable body classes and detailed, batched visuals (min parts=" +
    minParts + ", max draw meshes=" + maxDrawMeshes + ")");
  console.log("  named vehicle audit OK");
}

// ---- city mass-crowd: agents spawn on sidewalks, stroll, stay in the city ----
function testCrowd() {
  console.log("== city mass-crowd test ==");
  if (!CBZ.spawnCityCrowd) { console.log("  (no crowd module — skipped)"); return; }
  const A = CBZ.city.arena;
  const n = CBZ.spawnCityCrowd(150);
  let fails = 0;
  const ok = (label, cond, info) => { if (cond) console.log("  ✓ " + label + (info ? " — " + info : "")); else { fails++; console.error("  ✗ FAIL " + label + (info ? " — " + info : "")); } };
  ok("spawns the requested agents", CBZ.cityCrowdCount() === 150, "count=" + CBZ.cityCrowdCount());
  // sample a handful, remember where they start
  const idx = [0, 20, 50, 90, 130], start = idx.map((i) => CBZ.cityCrowdAgent(i));
  for (let f = 0; f < 240; f++) step(1 / 60);       // ~4s of strolling (sim runs via onUpdate 23.7)
  let moved = 0, inBounds = 0;
  const padX = 30, x0 = A.minX - padX, x1 = A.maxX + padX, z0 = A.minZ - padX, z1 = A.maxZ + padX;
  idx.forEach((i, k) => {
    const a = CBZ.cityCrowdAgent(i);
    if (Math.hypot(a.x - start[k].x, a.z - start[k].z) > 1.5) moved++;
    // inside the mainland clamp OR the connected island/bridge (just assert finite + roughly local)
    const near = a.x > x0 - 200 && a.x < x1 + 200 && a.z > z0 - 200 && a.z < z1 + 200 && isFinite(a.x) && isFinite(a.z);
    if (near) inBounds++;
  });
  ok("agents walk (most moved)", moved >= 4, moved + "/5 moved");
  ok("agents stay in the city", inBounds === 5, inBounds + "/5 in bounds");

  // ---- MASS FLEE (#8): a gunshot EVENT must scatter the instanced crowd AWAY ----
  if (CBZ.cityCrowdFlee) {
    CBZ.crowdMassFlee = true;
    const threat = CBZ.cityCrowdAgent(0), tpx = threat.x, tpz = threat.z, R = 50;
    const near = [], nd0 = [];
    for (let i = 0; i < CBZ.cityCrowdCount(); i++) {
      const a = CBZ.cityCrowdAgent(i), d = Math.hypot(a.x - tpx, a.z - tpz);
      if (d < R) { near.push(i); nd0.push(d); }
    }
    // trigger via the real event bus when it's loaded (tests the full wiring), else
    // call the crowd hook directly (cityevents.js isn't in the harness load set).
    if (CBZ.cityPostEvent) CBZ.cityPostEvent({ type: "gunshot", pos: { x: tpx, z: tpz }, radius: R, intensity: 1 });
    else CBZ.cityCrowdFlee(tpx, tpz, R, 1);
    for (let f = 0; f < 90; f++) step(1 / 60);                       // ~1.5s of panic
    let aBefore = 0, aAfter = 0;
    near.forEach((i, k) => { aBefore += nd0[k]; const a = CBZ.cityCrowdAgent(i); aAfter += Math.hypot(a.x - tpx, a.z - tpz); });
    const avgB = aBefore / (near.length || 1), avgA = aAfter / (near.length || 1);
    ok("crowd flees a gunshot (mass flee #8)", near.length >= 3 && avgA > avgB + 2,
      near.length + " near, avg dist " + avgB.toFixed(1) + "→" + avgA.toFixed(1) + "m");
    CBZ.crowdMassFlee = false;                                       // restore default for later tests
  }

  if (fails > 0) { console.log("RESULT: FAIL (crowd tests, " + fails + ")"); process.exit(1); }
  console.log("  city mass-crowd OK");
}

// ---- Zillow property/business market ----
function testZillow() {
  console.log("== zillow market tests ==");
  const Z = CBZ.cityZillow;
  if (!Z) throw new Error("CBZ.cityZillow missing");
  const all = Z.listings() || [];
  const legal = all.filter((x) => x.legal), illegal = all.filter((x) => !x.legal);
  const mainland = CBZ.city.arena.lots.length;
  const islandN = CBZ.city.arena.annex ? CBZ.city.arena.annex.lots.length : 0;
  console.log(`  listings=${all.length} (expect ${mainland + islandN}) legal=${legal.length} illegal=${illegal.length}`);
  if (all.length !== mainland + islandN) throw new Error("every lot must be listed");
  if (!illegal.length) throw new Error("expected some illegal (gang) listings for the rankings");
  if (all.some((x) => !(x.value > 0))) throw new Error("every property must carry a value");

  // buy the cheapest legal BUSINESS (commercial) so the rent path is exercised
  const buyable = legal.filter((x) => x.ownerId !== "player");
  const target = buyable.filter((x) => x.category === "commercial").sort((a, b) => a.value - b.value)[0]
    || buyable.sort((a, b) => a.value - b.value)[0];
  g.cash = target.value + 5000; g.cityBank = 0;
  Z.buy(target.id);
  const owned = Z.playerEmpire();
  console.log(`  bought "${target.name}" (${target.business ? "business" : "property"}) for ${target.value}: ownedCount=${owned.count} ownedValue=${owned.value} cashLeft=${g.cash}`);
  if (owned.count !== 1) throw new Error("buy did not register ownership");

  // illegal can't be bought
  const ill = illegal[0]; const cashWas = g.cash;
  Z.buy(ill.id);
  if (Z.playerEmpire().count !== 1 || g.cash !== cashWas) throw new Error("illegal property was wrongly purchasable");
  console.log(`  illegal buy correctly rejected ("${ill.name}")`);

  // rankings include the player and the gangs
  const ranks = Z.rankings();
  const me = ranks.find((r) => r.you);
  console.log(`  rankings=${ranks.length} top="${ranks[0].name}" yourRank=#${ranks.findIndex((r) => r.you) + 1} yourValue=${me.value}`);
  if (!me || me.value <= 0) throw new Error("player should appear on the rankings after buying");

  // Owned non-home property must settle a real cashflow cycle. A commercial
  // unit can legitimately go vacant on this tick, in which case tax/upkeep is
  // negative instead of rent being positive; either result proves settlement.
  const cashBeforeIncome = g.cash;
  for (let i = 0; i < 50 * 60; i++) step(1 / 60);
  const dInc = g.cash - cashBeforeIncome;
  console.log(`  income tick: cash ${cashBeforeIncome} -> ${g.cash} (Δ ${dInc}, rent ${target.rent})`);
  if (target.category === "commercial" && dInc === 0) throw new Error("owned business produced no cashflow settlement");

  // sell it back
  Z.sell(target.id);
  console.log(`  sold back: ownedCount=${Z.playerEmpire().count} cash=${g.cash}`);
  if (Z.playerEmpire().count !== 0) throw new Error("sell did not release ownership");

  // open/close UI shouldn't throw under the DOM stub
  Z.open(); Z.close();
  console.log("  open/close OK");
}

// ---- car-resale empire (rent yard → stock stolen cars → resell → raids) ----
function testEmpire() {
  console.log("== car-resale empire tests ==");
  const E = CBZ.cityEmpire;
  if (!E) throw new Error("CBZ.cityEmpire missing");
  g.cash = 5000; g.wanted = 0; g.heat = 0;
  E.open();
  const b = E.state();
  if (!b.open) throw new Error("yard did not open");
  console.log(`  yard open: cap=${b.cap} owned=${b.owned} cashLeft=${g.cash}`);

  function fakeCar(name, value, hot) {
    const grp = new Group(); grp.position.set(0, 0, -700); CBZ.scene.add(grp);
    const car = { model: { name, value }, value, group: grp, pos: grp.position, v: 0, owned: !hot };
    CBZ.cityCars.push(car); return car;
  }
  E.intake(fakeCar("Dodge Charger", 17000, true));
  E.intake(fakeCar("Honda Civic", 2800, true));
  E.intake(fakeCar("Ferrari 488", 72000, true));
  let stock = b.cars.reduce((s, c) => s + E.resaleOf(c), 0);
  console.log(`  stocked=${b.cars.length} notoriety=${Math.round(b.notoriety)} stockResale=${stock}`);
  if (b.cars.length !== 3) throw new Error("intake failed");

  const c0 = g.cash; E.sell(0);
  console.log(`  sold one: +${g.cash - c0}, remaining=${b.cars.length}`);
  const c1 = g.cash; E.sellAll();
  console.log(`  sold rest: +${g.cash - c1}, remaining=${b.cars.length}`);
  if (b.cars.length !== 0) throw new Error("sellAll failed");

  // RAID: stock hot cars, force a raid, kill the squad, expect it to resolve
  E.intake(fakeCar("Chevy Corvette", 26000, true));
  E.intake(fakeCar("Mercedes S-Class", 44000, true));
  b.notoriety = 120;
  const before = CBZ.cityCops.length;
  E.forceRaid();
  console.log(`  raid: cops+=${CBZ.cityCops.length - before} wanted=${g.wanted} raidActive=${!!b.raid}`);
  if (!b.raid) throw new Error("raid did not start");
  for (const c of b.raid.cops) { c.hp = 0; c.dead = true; }
  for (let i = 0; i < 90; i++) step(1 / 60);
  console.log(`  after squad down: raidActive=${!!b.raid} notoriety=${Math.round(b.notoriety)} carsKept=${b.cars.length}`);
  if (b.raid) throw new Error("raid did not resolve after the squad died");
  console.log("  empire OK");
}

// drive the player-action verbs that the passive sim never triggers
function stressTest() {
  console.log("== stress: player verbs ==");
  const P = CBZ.player; let fails = 0;
  const tryStep = (n) => { for (let i = 0; i < n; i++) { try { step(1 / 60); } catch (e) { fails++; if (fails <= 4) console.error("STRESS FRAME THROW:", e && e.stack || e); } } };
  const T = (label, fn) => { try { fn(); } catch (e) { fails++; console.error("STRESS THROW [" + label + "]:", e && e.message); } };

  const peds = CBZ.cityPeds.filter((p) => !p.dead && !p.vendor && !p.gang);
  const gangers = CBZ.cityPeds.filter((p) => p.gang && !p.dead);
  T("buy gun → unlock engine weapon", () => { CBZ.cityGiveWeapon("Pistol"); });
  T("buy second gun → same engine inventory", () => { CBZ.cityGiveWeapon("Shotgun"); });
  T("select sidearm through canonical API", () => {
    if (!CBZ.setCurrentWeapon("sidearm")) throw new Error("sidearm selection rejected");
    if (CBZ.cityCurrentWeaponName() !== "Pistol") throw new Error("city did not follow sidearm selection");
  });
  T("ammo tops up selected canonical gun", () => {
    if (!CBZ.fps || !CBZ.fpsAddAmmo) return;   // the lightweight harness does not load fpsmode.js
    const sidearm = CBZ.FPS_WEAPONS.findIndex((w) => w.id === "sidearm");
    const before = CBZ.fps.reserves[sidearm];
    CBZ.cityAddAmmo(17);
    if (CBZ.fps.reserves[sidearm] !== before + 17) throw new Error("ammo did not reach selected engine gun");
  });
  T("select shotgun through canonical API", () => {
    if (!CBZ.setCurrentWeapon("shotgun")) throw new Error("shotgun selection rejected");
    if (CBZ.cityCurrentWeaponName() !== "Shotgun") throw new Error("city did not follow shotgun selection");
  });
  T("city melee temporarily overrides canonical gun selection", () => {
    CBZ.cityGiveWeapon("Bat");
    if (CBZ.cityCurrentWeaponName() !== "Bat" || CBZ.cityHasGun()) throw new Error("city melee did not become active");
    if (!CBZ.cityDrawGun() || CBZ.cityCurrentWeaponName() !== "Shotgun" || !CBZ.cityHasGun()) throw new Error("city did not draw canonical gun after melee");
  });
  console.log("  shared gun state: inventory=" + CBZ.weaponInventory.join(",") + " selected=" + CBZ.currentWeaponId + " cityName=" + CBZ.cityCurrentWeaponName() + " cityHasGun=" + CBZ.cityHasGun());
  P.pos.set(CBZ.city.arena.center.x, 0, CBZ.city.arena.center.z);

  T("crime/report", () => { CBZ.cityCrime(60, { x: P.pos.x, z: P.pos.z, type: "robbery" }); });
  T("tagWitnesses", () => { CBZ.cityTagWitnesses(P.pos.x, P.pos.z, 250); });
  tryStep(120);
  console.log("  after witnessed crime: wanted=" + g.wanted + " heat=" + Math.round(g.heat));
  T("rob ped", () => { if (peds[0]) CBZ.cityRobPed(peds[0]); });
  T("KO ped", () => { if (peds[1]) CBZ.cityKOPed(peds[1], P.pos.x, P.pos.z); });
  T("kill ped", () => { if (peds[2]) CBZ.cityKillPed(peds[2], { fromX: P.pos.x, fromZ: P.pos.z, byPlayer: true }, "shot"); });
  T("loot corpse", () => { if (peds[2]) CBZ.cityLootCorpse(peds[2]); });
  T("npc offense", () => { if (peds[3]) CBZ.cityNpcOffense(peds[3], 140, "rampage"); });
  T("cop killed→5★", () => { CBZ.cityCopKilled(); });
  console.log("  cop-kill stars=" + g.wanted);
  tryStep(200);
  console.log("  cops now=" + CBZ.cityCops.filter((c) => !c.dead).length);
  T("rob stash", () => { const lot = (CBZ.cityGangs[0] && CBZ.cityGangs[0].turf[0]); if (lot) CBZ.cityRobStash(lot); });
  T("flirt→partner", () => { const r = peds.find((p) => CBZ.cityIsRomance && CBZ.cityIsRomance(p)); if (r) { g.cash = 9999; for (let i = 0; i < 5; i++) CBZ.cityFlirt(r); } });
  console.log("  partner=" + (g.cityPartner ? g.cityPartner.name : "none"));
  T("take hostage", () => { const h = peds.find((p) => !p.dead && p !== g.cityPartner); if (h) CBZ.cityTakeHostage(h); });
  T("release hostage", () => { CBZ.cityReleaseHostage(true); });
  tryStep(60);
  T("enter car", () => { const car = CBZ.cityCars.find((c) => !c.dead); if (car) { P.pos.set(car.pos.x, 0, car.pos.z); CBZ.cityEnterVehicle(car); } });
  CBZ.keys["w"] = true; tryStep(120); CBZ.keys["w"] = false;
  T("exit car", () => { if (P.driving) CBZ.cityExitVehicle(); });
  T("carjack by npc", () => { const v = gangers[0]; if (v) { v.aggr = 0.95; CBZ.cityNpcCarjack(v); } });
  tryStep(120);
  T("hurt+die", () => { for (let i = 0; i < 30 && !P.dead; i++) CBZ.cityHurtPlayer(40, P.pos.x + 5, P.pos.z, "test"); });
  console.log("  player dead=" + P.dead + " cityCam.death=" + !!(CBZ.cityCam && CBZ.cityCam.death));
  tryStep(420);  // death.js waits 6.4s through WASTED; if an NPC killed us, a kill-cam
  // spectate can hold for up to ~10 more seconds before auto-respawn — ride it out.
  for (let i = 0; i < 14 && P.dead; i++) tryStep(60);
  console.log("  after respawn: dead=" + P.dead + " hp=" + Math.round(P.hp) + "/" + P.maxHp);
  if (P.dead || P.hp <= 0) { fails++; console.error("STRESS FAIL [respawn]: player remained dead after WASTED + kill-cam window (~21s)"); }
  T("home menu", () => { if (CBZ.cityHomeMenu) CBZ.cityHomeMenu(); });
  T("realtor service", () => { /* exercised via home menu */ });
  tryStep(60);
  console.log("  stress throws=" + fails);
  if (fails > 0) { console.log("RESULT: FAIL (stress)"); process.exit(1); }
}

// ---- LEVEL + SIZE-UP: the street-read layer (level.js / sizeup.js) ----
// Levels are DERIVED from live state; this verifies the read is sane (civilians
// low, ranked gangers/cops high), the tag sweep actually swapped tags, the
// player's read moves with worth, the outclassed fold, and respect pays by gap.
function testLevels() {
  console.log("== level / size-up tests ==");
  let fails = 0;
  const ok = (name, cond, detail) => { if (cond) console.log("  ✓ " + name + (detail ? " — " + detail : "")); else { fails++; console.error("  ✗ " + name + (detail ? " — " + detail : "")); } };
  const g = CBZ.game, peds = CBZ.cityPeds;
  ok("cityLevel exists", typeof CBZ.cityLevel === "function");
  const civ = peds.find((p) => !p.dead && !p.gang && !p.armed && !p.weapon && !p.recruited && !p.companion &&
                               (p.wealth || 0) < 0.5 && !(p.bounty > 0) && (p.aggr || 0) < 0.85);
  const ganger = peds.find((p) => !p.dead && p.gang && (p.rank === "enforcer" || p.rank === "lt" || p.rank === "boss"));
  if (civ) ok("ordinary civilian reads low", CBZ.cityLevel(civ) <= 8, "lvl=" + CBZ.cityLevel(civ));
  if (ganger) ok("ranked gang member reads high", CBZ.cityLevel(ganger) >= 40, ganger.rank + " lvl=" + CBZ.cityLevel(ganger));
  const cop = CBZ.cityCops.find((c) => !c.dead);
  if (cop) ok("cop reads trained", CBZ.cityLevel(cop) >= 20, "lvl=" + CBZ.cityLevel(cop));
  // the slow sweep ran during the 1200 frames — tags should read LEVEL N now
  const tagged = peds.filter((p) => p.tag && !p.dead);
  const swept = tagged.filter((p) => p._lvlShown > 0);
  ok("tags swept to LEVEL N", tagged.length === 0 || swept.length >= tagged.length * 0.9, swept.length + "/" + tagged.length);
  // your own read rises with worth
  const pa = CBZ.city.playerActor;
  const cash0 = g.cash, kills0 = g.kills, crew0 = g.cityCrew;
  g.cash = 0; const broke = CBZ.cityLevel(pa);
  g.cash = 6e6; const rich = CBZ.cityLevel(pa);
  ok("player read rises with worth", rich > broke, broke + "→" + rich);
  // size-up: a level-1 civilian against a kingpin-read player FOLDS, and
  // stomping them earns nothing — respect only pays UP the ladder.
  if (civ && CBZ.citySizeUp) {
    g.cash = 6e6; g.kills = 40; g.cityCrew = 8;
    ok("outclassed civilian won't dare", CBZ.citySizeUp(civ, pa) === false, "civLvl=" + CBZ.cityLevel(civ) + " plLvl=" + CBZ.cityLevel(pa));
    CBZ.citySizeUpFold(civ, pa);
    ok("outclassed civilian folds", civ.surrender === true || civ.state === "flee", "state=" + civ.state + " surrender=" + !!civ.surrender);
    if (CBZ.cityLevel(civ) <= 5) ok("no respect for stomping a nobody", CBZ.cityKillRespect(civ) === 0, "resp=" + CBZ.cityKillRespect(civ));
    if (ganger) ok("respect paid for a real one", CBZ.cityKillRespect(ganger) >= 3, "resp=" + CBZ.cityKillRespect(ganger));
  }
  const violent = peds.find((p) => !p.dead && (p.aggr || 0) >= 0.88);
  if (violent && CBZ.citySizeUp) { g.cash = 6e6; ok("the violent fear nothing", CBZ.citySizeUp(violent, pa) === true); }
  g.cash = cash0; g.kills = kills0; g.cityCrew = crew0;
  if (fails > 0) { console.log("RESULT: FAIL (levels)"); process.exit(1); }
  console.log("  level/size-up OK");
}

// ---- gunfire → glass: a ray fired through a window pane shatters THAT pane ----
function testGlassRay() {
  console.log("== gunfire-shatters-glass test ==");
  if (!CBZ.cityShatterRay) throw new Error("CBZ.cityShatterRay missing");
  const lot = CBZ.city.arena.lots.find((l) => l.building && l.building.windows && l.building.windows.length);
  if (!lot) { console.log("  (no building windows found — skipped)"); return; }
  const pane = lot.building.windows.find((p) => !p.shattered);
  if (!pane) { console.log("  (all panes already shattered — skipped)"); return; }
  // fire from just outside the pane's -x face, straight through its center: this
  // pane is guaranteed the nearest glass along +x, so it must be the one that breaks
  const ox = pane.x - pane.hw - 1.0;
  const hitRec = CBZ.cityShatterRay(ox, pane.y, pane.z, 1, 0, 0, pane.hw * 2 + 2);
  if (!hitRec) throw new Error("ray through a pane center hit no glass");
  if (hitRec !== pane) throw new Error("ray hit a different pane than aimed");
  if (!pane.shattered) {
    const second = CBZ.cityShatterRay(ox, pane.y, pane.z, 1, 0, 0, pane.hw * 2 + 2);
    if (second !== pane) throw new Error("second shot did not hit the cracked pane");
  }
  if (!pane.shattered) throw new Error("targeted pane did not shatter after repeated hit");
  console.log("  ✓ ray through a window shattered exactly that pane @ " + pane.x.toFixed(1) + "," + pane.z.toFixed(1));
  // Re-firing the same ray must never target the same shattered pane. Dense
  // window bands may legitimately let the ray continue into the next intact pane.
  const again = CBZ.cityShatterRay(ox, pane.y, pane.z, 1, 0, 0, pane.hw * 2 + 2);
  if (again === pane) throw new Error("same shattered pane was hit again");
  // a ray pointing away from the pane hits nothing
  const away = CBZ.cityShatterRay(ox, pane.y, pane.z, -1, 0, 0, 2);
  if (away) throw new Error("ray fired away from glass still hit it");
  console.log("  ✓ shattered pane is inert to a second shot; away-ray misses" + (again ? " (follow-through hit another pane)" : ""));
  console.log("  gunfire-glass OK");
}

// ---- crash5: crumple, speed-scaled crash damage, head flash, cop-shot driver ----
function testCrash() {
  console.log("== crash / crumple / flash / driver-death tests ==");
  const P = CBZ.player, arena = CBZ.city.arena;
  const realClamp = arena.clampToCity, noColl = CBZ.collide;
  CBZ.collide = realCollide;                       // walls must actually stop cars
  arena.clampToCity = function () {};              // isolate test cars outside city bounds
  let fails = 0;
  const ok = (label, cond, info) => { if (cond) console.log("  ✓ " + label + (info ? " — " + info : "")); else { fails++; console.error("  ✗ FAIL " + label + (info ? " — " + info : "")); } };
  const freshCar = (x, z, name) => { const c = CBZ.citySpawnOwnedCar(x, z, name); c.crumple = 0; c.group.scale.set(1, 1, 1); c.v = 0; c.heading = 0; c.pos.set(x, 0, z); c.group.position.set(x, 0, z); return c; };
  const resetPlayer = () => { P.dead = false; P.hp = P.maxHp = 200; P.driving = false; P._vehicle = null; P._death = null; P._armor = 0; P._hurtT = 0; g.invuln = 0; g._cityKiller = null; if (P._phys) { P._phys.air = false; P._phys.down = 0; } };
  const wall = (x, z) => CBZ.addBox(x, 0, z, 6, 3, 1, 0x999999, { solid: true });

  // (A) DRIVING FEEL — steering builds/recenters instead of snapping and a
  // throttle lift coasts rather than applying an invisible brake.
  resetPlayer();
  let c = freshCar(620, 620, "Chevy Malibu");
  P.pos.set(620, 0, 620); CBZ.cityEnterVehicle(c);
  CBZ.keys["w"] = CBZ.keys["a"] = true;
  for (let i = 0; i < 36; i++) step(1 / 60);
  CBZ.keys["w"] = CBZ.keys["a"] = false;
  const steerPeak = c._steerInput || 0, headingAfterTurn = c.heading, speedBeforeCoast = Math.abs(c.v);
  step(1 / 60);
  ok("steering input builds smoothly and turns the car", steerPeak > 0.65 && Math.abs(headingAfterTurn) > 0.03,
    "steer=" + steerPeak.toFixed(2) + " heading=" + headingAfterTurn.toFixed(2));
  ok("steering recenters progressively", (c._steerInput || 0) > 0 && (c._steerInput || 0) < steerPeak,
    "steer " + steerPeak.toFixed(2) + "→" + (c._steerInput || 0).toFixed(2));
  ok("lifting throttle preserves a real coast", Math.abs(c.v) > speedBeforeCoast * 0.96,
    "speed " + speedBeforeCoast.toFixed(2) + "→" + Math.abs(c.v).toFixed(2));
  if (P.driving) CBZ.cityExitVehicle();

  // (B) CRUMPLE — drive into a wall; the mesh deforms, accumulates, clamps ≤1.
  resetPlayer(); P.hp = P.maxHp = 1e6;              // huge HP: isolate the mesh deform from death
  c = freshCar(490, 490); wall(490, 500);           // ~10 units ahead → crashes within ~50 frames
  P.pos.set(490, 0, 490); CBZ.cityEnterVehicle(c);
  CBZ.keys["w"] = true; for (let i = 0; i < 70; i++) step(1 / 60); CBZ.keys["w"] = false;
  const cr1 = c.crumple || 0, sc = c.group.scale, bd = c.group.userData.body, cb = c.group.userData.cabin;
  ok("crash crumples the car", cr1 > 0, "crumple=" + cr1.toFixed(2));
  ok("scale.y squashed by crumple", sc.y < 0.999 && Math.abs(sc.y - (1 - cr1 * 0.32)) < 0.01, "scale.y=" + sc.y.toFixed(3));
  ok("body + cabin meshes deformed", Math.abs(bd.rotation.z) > 1e-3 && Math.abs(cb.rotation.x) > 1e-3, "body.z=" + bd.rotation.z.toFixed(2) + " cabin.x=" + cb.rotation.x.toFixed(2));
  CBZ.keys["w"] = true; for (let i = 0; i < 70; i++) step(1 / 60); CBZ.keys["w"] = false;
  const cr2 = c.crumple || 0;
  ok("crumple accumulates and clamps ≤1", cr2 >= cr1 && cr2 <= 1.0001, "crumple " + cr1.toFixed(2) + "→" + cr2.toFixed(2));
  if (P.driving) CBZ.cityExitVehicle();

  // (C) DAMAGE — crashes hurt the driver hard, but current gameplay avoids
  // one-impact auto-death except in genuinely extreme cases.
  resetPlayer();
  c = freshCar(520, 490, "Chevy Malibu"); wall(520, 500);          // ~8 units → moderate impact
  P.pos.set(520, 0, 490); CBZ.cityEnterVehicle(c);
  const hp0 = P.hp;
  CBZ.keys["w"] = true; for (let i = 0; i < 60; i++) step(1 / 60); CBZ.keys["w"] = false;
  ok("a moderate crash does not auto-kill the driver", !P.dead && P.hp > 0, "hp " + hp0 + "→" + Math.round(P.hp) + " dead=" + P.dead);
  if (P.driving) CBZ.cityExitVehicle();

  resetPlayer();
  c = freshCar(540, 450, "Ferrari Enzo"); wall(540, 500);          // long runway → high-speed impact
  P.pos.set(540, 0, 450); CBZ.cityEnterVehicle(c);
  const hpFast0 = P.hp;
  CBZ.keys["w"] = true; for (let fr = 0; fr < 220; fr++) step(1 / 60); CBZ.keys["w"] = false;
  ok("a fast crash badly hurts but does not auto-kill", P.hp < hpFast0 * 0.6 && !P.dead, "hp " + hpFast0 + "→" + Math.round(P.hp) + " dead=" + P.dead);
  resetPlayer();

  // (D) CAR-TO-CAR — dimensions and mass drive contact + momentum. A pickup
  // striking a light hatch should shove the hatch hard without an instant boom.
  // Keep fixtures far outside the expanded mainland/island traffic. The old
  // 700,700 location can contain a live ambient car, contaminating crashCD.
  const truck = CBZ.citySpawnOwnedCar(7000, 7000, "Ford F-150");
  const hatch = CBZ.citySpawnOwnedCar(7000, 7004.2, "Toyota Prius");
  truck.ai = hatch.ai = false; truck.heading = 0; hatch.heading = 0;
  truck.v = 13; truck.vx = 0; truck.vz = 13; hatch.v = 0; hatch.vx = hatch.vz = 0;
  truck.group.position.copy(truck.pos); hatch.group.position.copy(hatch.pos);
  step(1 / 60);
  ok("vehicle-length contact catches a close nose-to-tail collision", (truck.crumple || 0) > 0 && (hatch.crumple || 0) > 0,
    "truck=" + (truck.crumple || 0).toFixed(2) + " hatch=" + (hatch.crumple || 0).toFixed(2));
  ok("heavy pickup transfers momentum into the light hatch", Math.hypot(hatch.vx || 0, hatch.vz || 0) > Math.hypot(truck.vx || 0, truck.vz || 0),
    "truckV=" + Math.hypot(truck.vx || 0, truck.vz || 0).toFixed(1) + " hatchV=" + Math.hypot(hatch.vx || 0, hatch.vz || 0).toFixed(1));
  ok("hard car-to-car wreck damages instead of instantly exploding", !truck.dead && !hatch.dead && truck.engineHp < 100 && hatch.engineHp < 100,
    "truckHP=" + Math.round(truck.engineHp) + " hatchHP=" + Math.round(hatch.engineHp));

  const longA = CBZ.citySpawnOwnedCar(7090, 7000, "Chevy Malibu");
  const longB = CBZ.citySpawnOwnedCar(7090, 7007, "Chevy Malibu");
  longA.ai = longB.ai = false; longA.heading = longB.heading = 0;
  longA._visualDims = longB._visualDims = { width: 2.1, length: 8, wheelbase: 4.8 };
  const longGap = Math.hypot(longA.pos.x - longB.pos.x, longA.pos.z - longB.pos.z);
  step(1 / 60);
  ok("dimension-aware broadphase catches promoted long vehicles", Math.hypot(longA.pos.x - longB.pos.x, longA.pos.z - longB.pos.z) > longGap,
    "gap " + longGap.toFixed(2) + "→" + Math.hypot(longA.pos.x - longB.pos.x, longA.pos.z - longB.pos.z).toFixed(2));

  const probeVan = freshCar(7120, 7096.9, "Dodge Caravan");
  wall(7120, 7100); probeVan.heading = 0; probeVan.v = 4;
  const probeMoved = CBZ.cityCollideVehicle(probeVan);
  ok("long vehicle nose contacts a wall before its center circle", probeMoved > 0.02 && probeVan.pos.z < 7096.9,
    "push=" + probeMoved.toFixed(2) + " z=" + probeVan.pos.z.toFixed(2));

  const van = CBZ.citySpawnOwnedCar(7030, 7000, "Dodge Caravan");
  const coupe = CBZ.citySpawnOwnedCar(7030, 7004.4, "Nissan 370Z");
  van.ai = coupe.ai = false; van.heading = 0; coupe.heading = Math.PI;
  van.v = 22; van.vx = 0; van.vz = 22; coupe.v = 10; coupe.vx = 0; coupe.vz = -10;
  step(1 / 60);
  ok("one catastrophic wreck does not instantly detonate healthy cars", !van.dead && !coupe.dead && van.engineHp <= 70 && coupe.engineHp <= 70,
    "vanHP=" + Math.round(van.engineHp) + " coupeHP=" + Math.round(coupe.engineHp));

  resetPlayer();
  const struck = freshCar(7060, 7004.2, "Toyota Prius");
  const hitter = CBZ.citySpawnOwnedCar(7060, 7000, "Ford F-150");
  hitter.ai = false; hitter.heading = 0; hitter.v = 13; hitter.vx = 0; hitter.vz = 13;
  P.pos.set(struck.pos.x, 0, struck.pos.z); CBZ.cityEnterVehicle(struck);
  const carCrashHp = P.hp;
  step(1 / 60);
  ok("car-to-car delta-v injures the player occupant", P.hp < carCrashHp && !P.dead,
    "hp " + carCrashHp + "→" + Math.round(P.hp));
  if (P.driving) CBZ.cityExitVehicle();
  resetPlayer();

  // (E) HEAD FLASH — body.flash pops the head emissive, order-24 step fades it back.
  const fp = CBZ.cityPeds.find((p) => !p.dead && p.char && p.char.head && p.char.head.material);
  if (fp) {
    const m = fp.char.head.material, restHex = m.emissive.getHex(), restEi = m.emissiveIntensity;
    CBZ.body.flash(fp);
    ok("flash sets head emissive hot", m.emissive.getHex() === 0xff6644 && Math.abs(m.emissiveIntensity - 1.7) < 0.01, "hex=0x" + m.emissive.getHex().toString(16) + " ei=" + m.emissiveIntensity.toFixed(2));
    const peak = fp._phys.flash, eiPeak = m.emissiveIntensity;
    for (let i = 0; i < 8; i++) step(1 / 60);
    ok("flash decays over frames", fp._phys.flash < peak && m.emissiveIntensity < eiPeak, "flash " + peak.toFixed(2) + "→" + fp._phys.flash.toFixed(2));
    for (let i = 0; i < 40 && fp._phys.flash > 0; i++) step(1 / 60);
    ok("flash fully restores to rest", fp._phys.flash <= 0 && m.emissive.getHex() === restHex && Math.abs(m.emissiveIntensity - restEi) < 0.01, "ei back to " + m.emissiveIntensity.toFixed(2));
  } else console.log("  (no living ped with a head material — flash sub-test skipped)");

  // (F) COP-SHOT DRIVER — a dead driver ejects, the car careens then settles abandoned.
  const dc = CBZ.cityCars.find((x) => x.ai && !x.player && !x.dead && x.road && !x.npcDriver);
  const dp = CBZ.cityPeds.find((p) => !p.dead && !p.vendor && !p.inCar);
  if (dc && dp) {
    dc.npcDriver = dp; dp.inCar = dc; dp.controlled = true; dc.v = 18; dc.wreckT = 0; dc.abandoned = false;
    dp.dead = true;                                  // the cop's bullet kills the driver
    step(1 / 60);                                    // AI loop (order 37) reacts this frame
    ok("dead driver is ejected from the car", dc.npcDriver === null, "npcDriver=" + dc.npcDriver);
    ok("driverless car is abandoned + wrecking", dc.abandoned === true && dc.wreckT > 0, "abandoned=" + dc.abandoned + " wreckT=" + (dc.wreckT || 0).toFixed(2));
    for (let i = 0; i < 220 && dc.wreckT > 0; i++) step(1 / 60);
    ok("car settles as an inert wreck (ai off)", dc.ai === false, "wreckT=" + (dc.wreckT || 0).toFixed(2) + " ai=" + dc.ai);
  } else console.log("  (no ambient car + free ped pair — driver-death sub-test skipped)");

  CBZ.collide = noColl; arena.clampToCity = realClamp; resetPlayer();
  if (fails > 0) { console.log("RESULT: FAIL (crash tests, " + fails + " failed)"); process.exit(1); }
  console.log("  crash/crumple/flash/driver-death OK");
}
run();
