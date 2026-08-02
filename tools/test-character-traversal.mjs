#!/usr/bin/env node
// Deterministic regression gate for the shared Gang City character traversal.
// This executes physics.js in a tiny VM world, so obstacle geometry, reach,
// landing safety, car orientation, and trajectory completion are tested without
// relying on a particular city spawn or camera angle.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const physicsPath = path.join(root, "src/systems/physics.js");
const physicsSource = await readFile(physicsPath, "utf8");

function vec3(x = 0, y = 0, z = 0) {
  return {
    x, y, z,
    set(nx, ny, nz) { this.x = nx; this.y = ny; this.z = nz; return this; },
    copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; },
  };
}

function rotation() {
  return {
    x: 0, y: 0, z: 0,
    set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; },
  };
}

function rig(height = 1.82) {
  return {
    metric: { height },
    group: { position: vec3(), rotation: rotation() },
    model: { rotation: rotation() },
  };
}

function actor(x = 0, z = 0) {
  return {
    pos: vec3(x, 0, z),
    radius: 0.5,
    grounded: true,
    speed: 0,
    vy: 0,
  };
}

class TestBox3 {
  constructor() {
    this.min = { x: 0, y: 0, z: 0 };
    this.max = { x: 0, y: 0, z: 0 };
  }
  setFromObject(ref) {
    const b = ref._testBounds;
    this.min = { ...b.min };
    this.max = { ...b.max };
    return this;
  }
  isEmpty() {
    return this.max.x < this.min.x || this.max.y < this.min.y || this.max.z < this.min.z;
  }
}

const updates = [];
const playerRig = rig();
const CBZ = {
  now: 0,
  game: { mode: "city" },
  CONFIG: { PLAYER_SLIDE: false, PLAYER_PRONE: false },
  TUNE: {
    walkSpeed: 6.4,
    crouchSpeed: 2.4,
    jumpVel: 8.2,
    gravity: 22,
  },
  player: {
    pos: vec3(),
    radius: 0.55,
    grounded: true,
    speed: 0,
    vy: 0,
    stamina: 100,
  },
  playerChar: playerRig,
  keys: {},
  cam: { yaw: Math.PI },
  feelDt: 0.016,
  colliders: [],
  platforms: [],
  cityCars: [],
  animChar() {},
  lerpAngle(a, b, t) { return a + (b - a) * t; },
  damp(a, b, rate, dt) { return a + (b - a) * (1 - Math.exp(-rate * dt)); },
  floorAt() { return 0; },
  onUpdate(order, fn) { updates.push({ order, fn }); },
  sfx() {},
};

const context = vm.createContext({
  window: { CBZ, THREE: { Box3: TestBox3 } },
  performance: { now: () => CBZ.now },
});
vm.runInContext(physicsSource, context, { filename: physicsPath });

assert.ok(CBZ.characterTraversal, "physics.js must publish the shared traversal capability");
assert.ok(updates.some((u) => u.order === 10), "player physics update must still register");

function world(colliders, cars = []) {
  CBZ.colliders.splice(0, CBZ.colliders.length, ...colliders);
  CBZ.cityCars.splice(0, CBZ.cityCars.length, ...cars);
  CBZ.markCollidersDirty();
}

function box(y1, minZ = 1.15, maxZ = 2.05, extra = {}) {
  return {
    minX: -1.2, maxX: 1.2,
    minZ, maxZ,
    y0: 0, y1,
    _city: true,
    ...extra,
  };
}

function finish(a, r) {
  let frames = 0;
  while (a._traversal && frames++ < 80) {
    CBZ.now += 50;
    CBZ.characterTraversal.step(a, r, 0.05, false);
  }
  assert.ok(frames < 80, "traversal must finish in a bounded time");
  assert.equal(a._traversal, null, "trajectory must release transform ownership");
  assert.equal(r.traversePose, null, "animation ownership must clear on landing");
}

// A running body clears a waist-high solid instead of performing the old
// vertical-only jump into its near face.
{
  const obstacle = box(0.92);
  world([obstacle]);
  const a = actor(), r = rig();
  const state = CBZ.characterTraversal.start(a, r, 0, 1, {
    speed: 7, radius: a.radius, running: true, allowTop: false, cars: false,
  });
  assert.equal(state && state.kind, "vault");
  assert.ok(["speed", "kong"].includes(state.style),
    "ordinary forward Jump must traverse without spending a spy spin");
  finish(a, r);
  assert.ok(a.pos.z > obstacle.maxZ + a.radius,
    "vault landing must clear the obstacle's far collision face");
  assert.equal(a.pos.y, 0);
}

// The canonical player owner must translate an actual W+Space input frame into
// that same shared traversal state. Shift is an acrobatic modifier, never a
// requirement for getting past a solid.
{
  const obstacle = box(0.96);
  world([obstacle]);
  CBZ.player.pos.set(0, 0, 0);
  CBZ.player.grounded = true;
  CBZ.player.dead = false;
  CBZ.player.driving = false;
  CBZ.player.ko = 0;
  CBZ.player.vy = 0;
  CBZ.player.stamina = 100;
  playerRig.group.position.copy(CBZ.player.pos);
  CBZ.keys.w = true;
  CBZ.keys.shift = false;
  CBZ.keys[" "] = true;
  updates.find((u) => u.order === 10).fn(0.016);
  assert.equal(CBZ.player._traversal && CBZ.player._traversal.kind, "vault",
    "W+Space without Shift must enter traversal instead of a vertical-only jump");
  assert.notEqual(CBZ.player._traversal && CBZ.player._traversal.style, "spin",
    "walking/running Jump without Shift must use a controlled vault");
  CBZ.keys.w = false;
  CBZ.keys.shift = false;
  CBZ.keys[" "] = false;
  finish(CBZ.player, playerRig);
  assert.ok(CBZ.player.pos.z > obstacle.maxZ + CBZ.player.radius);
}

// NPC run gait is an explicit input. Their human-scale speed is lower than the
// player tune, but a fleeing/running NPC must still choose a flowing vault.
{
  world([box(0.86)]);
  const slowA = actor(), slowR = rig();
  const withoutRunGait = CBZ.characterTraversal.probe(slowA, slowR, 0, 1, {
    speed: 3, radius: slowA.radius, allowTop: false, cars: false,
  });
  assert.equal(withoutRunGait && withoutRunGait.kind, "mantle");
  const runA = actor(), runR = rig();
  const withRunGait = CBZ.characterTraversal.probe(runA, runR, 0, 1, {
    speed: 3, radius: runA.radius, running: true, allowTop: false, cars: false,
  });
  assert.equal(withRunGait && withRunGait.kind, "vault");
  assert.notEqual(withRunGait && withRunGait.style, "spin");
}

// A ledge above jump height but within hand reach becomes a two-hand mantle.
{
  const obstacle = box(2.12, 1.15, 1.72);
  world([obstacle]);
  const a = actor(), r = rig();
  const state = CBZ.characterTraversal.start(a, r, 0, 1, {
    speed: 7, radius: a.radius, running: true, allowTop: false, cars: false,
  });
  assert.equal(state && state.kind, "mantle");
  assert.ok(state.hangY > 0, "mantle must include a raised hang/contact phase");
  assert.ok(Number.isFinite(state.ledgeX) && Number.isFinite(state.ledgeZ),
    "mantle animation must receive the actual near-edge hand target");
  CBZ.characterTraversal.step(a, r, state.duration * 0.32, false);
  assert.ok(Number.isFinite(state.rootY), "mantle pose must receive the live root height");
  finish(a, r);
  assert.ok(a.pos.z > obstacle.maxZ + a.radius);
}

// A wall above the rig's believable reach is rejected; traversal must not grant
// a superhero climb.
{
  world([box(2.52)]);
  const a = actor(), r = rig();
  const state = CBZ.characterTraversal.probe(a, r, 0, 1, {
    speed: 8, radius: a.radius, running: true, allowTop: true, cars: false,
  });
  assert.equal(state, null);
}

// A broad climbable solid receives the player on top. The temporary support
// record keeps ordinary ground following stable until the player steps off.
{
  const obstacle = box(1.08, 1.15, 6.0);
  world([obstacle]);
  const a = actor(), r = rig();
  const state = CBZ.characterTraversal.start(a, r, 0, 1, {
    speed: 7, radius: a.radius, running: true, allowTop: true, cars: false,
  });
  assert.equal(state && state.kind, "mantle");
  assert.equal(state.landOnTop, true);
  finish(a, r);
  assert.equal(a.pos.y, obstacle.y1);
  assert.equal(CBZ.characterTraversal.surfaceY(a, a.pos.x, a.pos.z, 0), obstacle.y1);
  assert.equal(CBZ.characterTraversal.surfaceY(a, 9, 9, 0), 0,
    "support must release when the actor leaves the top");
}

// Real, nearly-stationary city cars can be crossed side-on. A normal Jump uses
// a controlled vault; a committed sprint unlocks the slower spy barrel roll.
// Their long axis and moving traffic remain non-traversable.
{
  const parkedCar = {
    pos: vec3(0, 0, 2),
    heading: Math.PI / 2,
    v: 0, vx: 0, vz: 0,
    dims: { width: 2.0, length: 4.4, height: 1.42 },
    group: { position: vec3(0, 0, 2), rotation: rotation() },
  };
  world([], [parkedCar]);
  const normalA = actor(), normalR = rig();
  const normal = CBZ.characterTraversal.start(normalA, normalR, 0, 1, {
    speed: 8, radius: normalA.radius, running: true, allowTop: false, cars: true,
  });
  assert.equal(normal && normal.kind, "vault");
  assert.notEqual(normal.style, "spin",
    "a parked car must not force a 360 when the actor was not sprinting");
  finish(normalA, normalR);

  const a = actor(), r = rig();
  const state = CBZ.characterTraversal.start(a, r, 0, 1, {
    speed: 8, radius: a.radius, running: true, sprinting: true,
    allowTop: false, cars: true,
  });
  assert.equal(state && state.kind, "vault");
  assert.equal(state.style, "spin");
  assert.equal(state.car, parkedCar);
  assert.ok(state.duration >= 1.15,
    "a full spy spin needs a readable one-second-plus motion window");
  finish(a, r);
  assert.ok(a.pos.z > parkedCar.pos.z + parkedCar.dims.width * 0.5 + a.radius);

  const longA = actor(-3.4, 2), longR = rig();
  assert.equal(CBZ.characterTraversal.probe(longA, longR, 1, 0, {
    speed: 8, radius: longA.radius, running: true, allowTop: false, cars: true,
  }), null, "approaching along a car's long axis must route around");

  parkedCar.v = 2.5;
  const movingA = actor(), movingR = rig();
  assert.equal(CBZ.characterTraversal.probe(movingA, movingR, 0, 1, {
    speed: 8, radius: movingA.radius, running: true, allowTop: false, cars: true,
  }), null, "moving traffic must never become parkour geometry");

  parkedCar.v = 0;
  parkedCar.model = { name: "Speedboat", body: "boat" };
  const marineA = actor(), marineR = rig();
  assert.equal(CBZ.characterTraversal.probe(marineA, marineR, 0, 1, {
    speed: 8, radius: marineA.radius, running: true, allowTop: false, cars: true,
  }), null, "the shared vehicle bus must not turn marine hulls into road-car vaults");
}

// Legacy solid props may lack y0/y1 but retain the real mesh they registered.
// Character physics may read that mesh's bounds without changing prop solidity.
{
  const ref = {
    visible: true,
    _testBounds: {
      min: { x: -1.2, y: 0, z: 1.15 },
      max: { x: 1.2, y: 0.88, z: 2.05 },
    },
  };
  const obstacle = { minX: -1.2, maxX: 1.2, minZ: 1.15, maxZ: 2.05, ref, _city: true };
  world([obstacle]);
  const a = actor(), r = rig();
  const state = CBZ.characterTraversal.start(a, r, 0, 1, {
    speed: 8, radius: a.radius, running: true, allowTop: false, cars: false,
  });
  assert.equal(state && state.kind, "vault");
  finish(a, r);
  assert.ok(a.pos.z > obstacle.maxZ + a.radius);
}

// Heightless/full-height boxes with no visual height are not invented into
// climbable props. Another system may make decorative props solid; this
// controller only consumes an explicit band or an existing registered mesh.
{
  world([{ minX: -1.2, maxX: 1.2, minZ: 1.15, maxZ: 2.05, _city: true }]);
  const a = actor(), r = rig();
  assert.equal(CBZ.characterTraversal.probe(a, r, 0, 1, {
    speed: 8, radius: a.radius, running: true, allowTop: true, cars: false,
  }), null);
}

const stats = CBZ.characterTraversal.stats();
assert.ok(stats.vaults >= 2 && stats.mantles >= 2 && stats.cars >= 1);
assert.equal(stats.completed, stats.vaults + stats.mantles);

console.log("PASS character traversal: vault, mantle, top support, reach, and parked-car rules");
