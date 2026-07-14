import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.set(x, y, z); }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  copy(v) { return this.set(v.x, v.y, v.z); }
}
class Euler extends Vector3 {}
class Group {
  constructor() {
    this.position = new Vector3(); this.rotation = new Euler(); this.scale = new Vector3(1, 1, 1);
    this.children = []; this.parent = null; this.visible = true;
  }
  add(child) {
    if (child.parent) child.parent.children = child.parent.children.filter((v) => v !== child);
    child.parent = this; this.children.push(child); return this;
  }
  remove(child) {
    this.children = this.children.filter((v) => v !== child);
    if (child.parent === this) child.parent = null;
    return this;
  }
  updateMatrixWorld() {}
  getWorldPosition(out) {
    out.set(this.position.x, this.position.y, this.position.z);
    for (let p = this.parent; p; p = p.parent) { out.x += p.position.x; out.y += p.position.y; out.z += p.position.z; }
    return out;
  }
}

const updates = [];
const scene = new Group();
const root = new Group(); scene.add(root);
const CBZ = {
  game: { mode: "city" }, scene, city: { arena: { root } }, cityPeds: [],
  onUpdate(order, fn) { updates.push({ order, fn }); },
  animChar() {}, syncActorWeapon() {},
};
function actor(x = 0, z = 0) {
  const group = new Group(); group.position.set(x, 0, z); root.add(group);
  return {
    group, pos: group.position, target: new Vector3(x, 0, z), char: { sitting: false },
    kind: "civilian", archetype: "resident", state: "walk", pause: 0, speed: 1,
    dead: false, aggr: 0.2, armed: false, weapon: null,
  };
}
CBZ.cityMakePed = (x, z) => actor(x, z);
CBZ.cityPeds.push(actor(-4, 0), actor(-2, 0));

globalThis.window = { CBZ, THREE: { Vector3 } };
globalThis.THREE = window.THREE;
vm.runInThisContext(fs.readFileSync(new URL("../src/entities/npclife.js", import.meta.url), "utf8"), { filename: "npclife.js" });

assert.equal(CBZ.npcLife.resolve("hitman").actor.job, "contract killer");
const plane = new Group(); root.add(plane);
const seats = [0, 1, 2].map((i) => ({ x: i, y: 2, z: 1, heading: 0, occupant: null, reservedForNpc: true }));
const cabin = { id: "test", group: plane, active: true, state: "parked", passengerSeats: seats };
CBZ.aircraftPassengerCabins = [cabin];

assert.equal(CBZ.npcLife.populateAircraftCabins(), 1);
assert.equal(CBZ.npcLife.populateAircraftCabins(), 1);
assert.equal(CBZ.npcLife.populateAircraftCabins(), 1);
assert.ok(seats.every((s) => s.occupant && s.occupant.group.parent === plane), "all anchors contain real actors");
assert.equal(CBZ.npcLife.stats().aircraftOccupants, 3);
assert.equal(CBZ.cityPeds.length, 3, "existing actors are claimed before one shared-factory fallback is built");

plane.position.x = 25;
for (const seat of seats) CBZ.npcLife.syncAttached(seat.occupant, 1 / 60);
assert.equal(seats[0].occupant.pos.x, 25, "world interaction position follows the moving cabin");
assert.equal(seats[2].occupant.pos.x, 27);

cabin.state = "destroyed"; cabin.active = false;
CBZ.npcLife.populateAircraftCabins();
assert.ok(seats.every((s) => s.occupant === null), "destroyed cabin releases and clears every anchor");
assert.equal(CBZ.npcLife.stats().attached, 0);
assert.equal(CBZ.cityPeds.length, 2, "destroyed cabin removes its one spawned fallback instead of growing the roster");

// A visible/near pedestrian must not vanish into a newly registered cabin.
// With every pooled actor beside the player, population uses the same real
// factory fallback instead of drafting one of those bodies.
CBZ.player = { pos: new Vector3(26, 0, 1) }; CBZ.cam = { yaw: 0 };
const before = CBZ.cityPeds.slice();
const plane2 = new Group(); plane2.position.x = 300; root.add(plane2);
const seat2 = { x: 0, y: 2, z: 0, heading: 0, occupant: null, reservedForNpc: true };
CBZ.aircraftPassengerCabins = [{ id: "visible-draft-test", group: plane2, active: true, state: "parked", passengerSeats: [seat2] }];
CBZ.npcLife.populateAircraftCabins();
assert.ok(seat2.occupant && !before.includes(seat2.occupant), "visible street actors are never teleported into cabins");
CBZ.npcLife.resetCity();
assert.equal(CBZ.cityPeds.length, before.length, "city reset destroys cabin-owned fallback actors but preserves claimed citizens");

// A close homeless scare must preserve an already-homeless citizen's identity
// when it disbands, and a factory fallback must be fully owned/removed.
CBZ.game.cityHour = 2;
CBZ.city.playerActor = { pos: new Vector3(0, 0, 0), dead: false };
CBZ.player = CBZ.city.playerActor;
CBZ.camera = { position: new Vector3(0, 2, 0) };
CBZ.cam = { yaw: 0 };
CBZ.CONFIG = {};
CBZ.city.arena.weightedSidewalkPoint = () => ({ x: 0, z: 20 });
const vagrant = actor(0, 20);
Object.assign(vagrant, {
  vagrant: true, archetype: "vagrant", job: "panhandling", aggr: 0.41,
  _role: "street-resident", _beg: { x: 1, z: 2 }, npcWanted: 1, fear: 0.3,
});
CBZ.cityPeds.push(vagrant);
vm.runInThisContext(fs.readFileSync(new URL("../src/city/scenedirector.js", import.meta.url), "utf8"), { filename: "scenedirector.js" });
assert.equal(CBZ.citySceneDirector.stage("hobo"), true, "existing behind-camera vagrant did not stage the scare");
assert.equal(CBZ.citySceneDirector.status().actorProfiles[0], "homelessScare");
CBZ.citySceneDirector.clear();
assert.equal(vagrant.vagrant, true, "scene cleanup erased a claimed real vagrant identity");
assert.equal(vagrant._role, "street-resident");
assert.deepEqual(vagrant._beg, { x: 1, z: 2 });
assert.equal(vagrant.npcWanted, 1);
assert.equal(vagrant.aggr, 0.41);

vagrant.controlled = true; // force the standard-factory fallback path
const rosterBeforeFallback = CBZ.cityPeds.length;
assert.equal(CBZ.citySceneDirector.stage("hobo"), true, "homeless fallback did not stage behind the camera");
assert.equal(CBZ.cityPeds.length, rosterBeforeFallback + 1);
CBZ.citySceneDirector.clear();
assert.equal(CBZ.cityPeds.length, rosterBeforeFallback, "surviving scene-owned fallback leaked into the city roster");

console.log("npc-life: profiles, offscreen casting, real cabin actors, moving attachment, scene identity, and owned cleanup OK");
