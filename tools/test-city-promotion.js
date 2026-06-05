// Headless test of city/crowd.js on-demand promotion. Stubs THREE + CBZ enough
// to run the real module, then drives the 23.7 update and asserts promote/
// demote/kill behavior. Run: node tools/test-city-promotion.js
"use strict";
const fs = require("fs");

// ---- minimal THREE stub ----
function V3(x, y, z) { this.x = x || 0; this.y = y || 0; this.z = z || 0; }
V3.prototype.set = function (x, y, z) { this.x = x; this.y = y; this.z = z; return this; };
function Obj3D() { this.position = new V3(); this.rotation = new V3(); this.scale = new V3(1, 1, 1); this.matrix = {}; this.visible = true; this.children = []; this.parent = null; }
Obj3D.prototype.add = function (o) { this.children.push(o); if (o) o.parent = this; return this; };
Obj3D.prototype.remove = function (o) { const i = this.children.indexOf(o); if (i >= 0) this.children.splice(i, 1); if (o) o.parent = null; };
Obj3D.prototype.updateMatrix = function () {};
function Mat4() {} Mat4.prototype.multiplyMatrices = function () { return this; }; Mat4.prototype.makeScale = function () { return this; }; Mat4.prototype.setPosition = function () { return this; };
function Color() {} Color.prototype.setHex = function () { return this; };
function Geo() { this.attributes = { position: { count: 24 } }; } Geo.prototype.translate = function () { return this; }; Geo.prototype.setAttribute = function () {};
function InstMesh(geo, mat, cap) { this.geometry = geo; this.material = mat; this.count = cap; this.visible = true; this.instanceMatrix = { setUsage: function () {}, needsUpdate: false }; this.instanceColor = { needsUpdate: false }; }
InstMesh.prototype.setMatrixAt = function () {}; InstMesh.prototype.setColorAt = function () {};
const THREE = {
  Object3D: Obj3D, Group: Obj3D, Matrix4: Mat4, Color: Color, BoxGeometry: Geo,
  BufferAttribute: function () {}, MeshLambertMaterial: function (o) { this.color = new Color(); this._o = o; },
  Mesh: function () { this.position = new V3(); this.material = { color: new Color() }; },
  InstancedMesh: InstMesh, DynamicDrawUsage: 1,
};

// ---- minimal CBZ stub ----
let updaters = [];
const cityPeds = [];
function makeMat() { return { color: new Color(), clone: function () { return makeMat(); } }; }
function meshWithMat() { return { material: makeMat() }; }
function makeChar() {
  return { group: new Obj3D(), head: { material: makeMat() }, skinSlots: { hands: [meshWithMat()], arms: [meshWithMat()], hair: [meshWithMat()], torso: [meshWithMat()], collar: [meshWithMat()] } };
}
const arenaRoot = new Obj3D();
const CBZ = {
  scene: new Obj3D(),
  game: { mode: "city", state: "playing" },
  player: { pos: new V3(0, 0, 0), dead: false, driving: false },
  cityPeds: cityPeds,
  CITY: { crowd: 40 },
  mat: function () { return new THREE.MeshLambertMaterial({}); },
  lerpAngle: function (a, b) { return b; },
  onUpdate: function (order, fn) { updaters.push({ order, fn }); },
  city: { arena: { root: arenaRoot, randomSidewalkPoint: function () { return { x: (Math.random() - 0.5) * 60, z: (Math.random() - 0.5) * 60 }; }, clampToCity: function () {} } },
  cityMakePed: function (x, z) {
    const ch = makeChar(); ch.group.position.set(x, 0, z);
    const p = { char: ch, group: ch.group, pos: ch.group.position, target: new V3(x, 0, z), name: "Test Ped", kind: "civilian", dead: false, deadT: 0, ko: 0, culled: false, collected: false, needsPickup: false, _parked: false, state: "walk", path: null, finalGoal: null, pause: 0, rage: null, mem: null, cash: 50, wealth: 0.3, armed: false };
    return p;
  },
  clearCityPeds: function () { cityPeds.length = 0; },
};
global.window = { CBZ: CBZ, THREE: THREE };

// ---- load the real module ----
const src = fs.readFileSync(__dirname + "/../src/city/crowd.js", "utf8");
eval(src);

const tick = updaters.find((u) => u.order === 23.7).fn;

// ---- drive + assert ----
let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; } else { fail++; console.log("  FAIL:", msg); } }

CBZ.spawnCityCrowd(40);
ok(CBZ.cityCrowdCount() === 40, "spawned 40 ambient agents");

// player far from everyone first: move all agents far, player at origin
const agents = [];
for (let i = 0; i < 40; i++) agents.push(CBZ.cityCrowdAgent(i));

// run a few ticks; pool should build (14 parked peds added to cityPeds)
for (let t = 0; t < 3; t++) tick(0.05);
const pooled = cityPeds.filter((p) => p._crowd);
ok(pooled.length === 18, "pool of 18 interactive peds created (got " + pooled.length + ")");
const promotedNow = cityPeds.filter((p) => p._crowd && !p._parked).length;
ok(promotedNow > 0, "agents near origin got promoted to real peds (got " + promotedNow + " active)");

// walk the player far away → everyone should demote (park)
CBZ.player.pos.set(100000, 0, 100000);
for (let t = 0; t < 3; t++) tick(0.05);
const stillActive = cityPeds.filter((p) => p._crowd && !p._parked).length;
ok(stillActive === 0, "walking away demotes all promoted peds (got " + stillActive + " still active)");

// walk back, promote again, then KILL one promoted ped → it should recycle
CBZ.player.pos.set(0, 0, 0);
for (let t = 0; t < 3; t++) tick(0.05);
const active2 = cityPeds.filter((p) => p._crowd && !p._parked);
ok(active2.length > 0, "re-promotes after returning (got " + active2.length + ")");
const poolBefore = cityPeds.filter((p) => p._crowd).length;
active2[0].dead = true;                          // simulate the player killing it
tick(0.05);
const poolAfter = cityPeds.filter((p) => p._crowd).length;
ok(poolAfter === poolBefore + 1, "killed promoted ped recycled (fresh pool ped added: " + poolBefore + "->" + poolAfter + ")");

// reset wipes pool
CBZ.clearCityPeds();
ok(cityPeds.length === 0, "clearCityPeds drops pool peds too");
CBZ.spawnCityCrowd(40);
for (let t = 0; t < 2; t++) tick(0.05);
ok(cityPeds.filter((p) => p._crowd).length === 18, "pool rebuilt cleanly after reset");

console.log("\n" + (fail === 0 ? "ALL " + pass + " CHECKS PASSED ✓" : pass + " passed, " + fail + " FAILED"));
process.exit(fail === 0 ? 0 : 1);
