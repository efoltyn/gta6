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

/* ---- GOING THROUGH A HOLE, not over it ------------------------------------
   The owner's airport window: city/buildings.js's carveHole leaves a SILL
   course under the opening and a HEADER course above it, with the wall's own
   collider spliced out between them. Every one of those was refused before
   the `through` kind existed, because the only trajectory this file had went
   UP — straight into the header — and the clearance sweep then threw the whole
   traversal away. These cases pin the fix AND its limits: a hole a body fits
   through is passable, and masonry is still masonry. */
// DELIBERATELY NOT `_city`-stamped, unlike box() above. physics.js filters
// city-stamped colliders out of every query outside city mode (the airport and
// military rects overlap the prison's coordinate space), so a `_city` fixture
// would be invisible in escape/survival and the mode-portability assertions
// further down would be testing the harness instead of the engine.
function aperture(sillTop, headerBottom, opts) {
  opts = opts || {};
  const w = opts.halfWidth != null ? opts.halfWidth : 4;
  const cols = [];
  if (sillTop > 0) {
    cols.push({ minX: -w, maxX: w, minZ: 1.2, maxZ: 1.2 + (opts.thick || 0.4),
      y0: 0, y1: sillTop, ref: {} });
  }
  cols.push({ minX: -w, maxX: w, minZ: 1.2, maxZ: 1.2 + (opts.thick || 0.4),
    y0: headerBottom, y1: 6.0, ref: {} });
  return cols;
}
function probeGap(sillTop, headerBottom, opts, probeOpts) {
  world(aperture(sillTop, headerBottom, opts));
  const a = actor(), r = rig();
  return {
    state: CBZ.characterTraversal.probe(a, r, 0, 1, Object.assign({
      speed: 7, radius: a.radius, running: true, allowTop: true, cars: false,
    }, probeOpts || {})),
    a, r,
  };
}
{
  // THE REPORTED BUG. A shot-out window over a waist-high sill: the body must
  // commit and dive, because the header is exactly where a vault's head goes.
  const win = probeGap(0.90, 2.30);
  assert.equal(win.state && win.state.kind, "through",
    "a broken window with a sill below and a header above must be passable");
  assert.equal(win.state.gapStyle, "dive",
    "an opening shorter than the body is a committed dive, not a stride");
  // The root must actually THREAD the hole: sampled inside the wall its feet
  // clear the sill and its diving profile clears the header, which is the one
  // thing an arcing vault could never do.
  const s = CBZ.characterTraversal.start(win.a, win.r, 0, 1, {
    speed: 7, radius: win.a.radius, running: true, allowTop: true, cars: false,
  });
  assert.ok(s && s.kind === "through");
  assert.ok(s.passY >= 0.90 && s.passY <= 1.05,
    "the pass height must sit just above the sill, not arc over it");
  assert.ok(s.passY + 0.58 <= 2.30 + 0.02,
    "a diving body's profile must fit under the header");
  finish(win.a, win.r);
  assert.ok(win.a.pos.z > 1.6, "the body must end up on the far side of the wall");
  assert.equal(win.a.pos.y, 0, "and back down on the floor");
  assert.ok(win.r.landPose && win.r.landPose.roll,
    "coming out of a committed dive rolls; bodies do not land a dive on their feet");
}
{
  // ROOM TO STRIDE. Headroom that nearly clears the standing body is stepped
  // through with a ducked head, not dived. (Note the boundary above it: give
  // the same low lip enough headroom to carry a body OVER the top — 2.90 here
  // — and it stops being an aperture at all and goes back to being an ordinary
  // vault, which is the correct answer and the reason the headroom test is
  // measured against the vault's arc rather than against the hole.)
  const tall = probeGap(0.55, 2.05);
  assert.equal(tall.state && tall.state.kind, "through");
  assert.equal(tall.state.gapStyle, "step",
    "an ankle-high lip under a duckable header is a stride, not a dive");
  const overTheTop = probeGap(0.55, 2.35);
  assert.equal(overTheTop.state && overTheTop.state.kind, "vault",
    "give the same low lip room to fold a body over the top and it is a vault again");
  // SAME headroom, higher sill: the legs can no longer do the work, so the
  // only way through is horizontal. This pair is the whole step/dive rule.
  const sill = probeGap(0.95, 2.45);
  assert.equal(sill.state && sill.state.kind, "through");
  assert.equal(sill.state.gapStyle, "dive",
    "a waist-high sill takes the legs out of it — that is what makes it a dive");
}
{
  // FM 3-06.11's 2 lb mousehole: crawl-sized, and still a passage.
  const mouse = probeGap(0.55, 1.55);
  assert.equal(mouse.state && mouse.state.kind, "through");
  assert.equal(mouse.state.gapStyle, "dive");
}
{
  // AND THE LIMITS. None of these may open a path.
  assert.equal(probeGap(0.90, 1.30).state, null,
    "a 0.4 m crack is not a hole a body threads");
  assert.equal(probeGap(2.40, 3.90).state, null,
    "an opening above hand reach needs a wall run, not a dive");
  assert.equal(probeGap(0.90, 2.30, { thick: 3.2 }).state, null,
    "a 3.2 m tunnel is not one traversal move");
  // A SEALED WALL. The 'header' starts at the floor, so there is no aperture at
  // all — the body must not dive into masonry just because the near face is
  // shaped like a sill.
  world([{ minX: -4, maxX: 4, minZ: 1.2, maxZ: 1.6, y0: 0, y1: 6.0, ref: {} }]);
  const sealedA = actor(), sealedR = rig();
  assert.equal(CBZ.characterTraversal.probe(sealedA, sealedR, 0, 1, {
    speed: 7, radius: sealedA.radius, running: true, allowTop: true, cars: false,
  }), null, "a solid full-height wall must stay solid");
  // A SECOND WALL a short step behind the opening still vetoes: the exemption
  // is the aperture's own two boxes, never "anything near a hole".
  const blocked = aperture(0.90, 2.30);
  blocked.push({ minX: -4, maxX: 4, minZ: 2.0, maxZ: 2.4, y0: 0, y1: 6.0, ref: {} });
  world(blocked);
  const wallA = actor(), wallR = rig();
  assert.equal(CBZ.characterTraversal.probe(wallA, wallR, 0, 1, {
    speed: 7, radius: wallA.radius, running: true, allowTop: true, cars: false,
  }), null, "an opening that leads into a second solid wall must be refused");
}

/* ---- ROOT MOTION IS CONTINUOUS THROUGH THE MOVE ---------------------------
   The measured cause of "the vault looks glitchy": smooth01 has zero
   derivative at both ends, so a body running at 8 m/s dropped to 0.2 m/s the
   moment it reached the obstacle and left the far side at 1.0 m/s, with the
   gait resuming instantly at 8. Two velocity discontinuities per vault. This
   pins the Hermite carry-through so the regression cannot come back. */
{
  world([box(0.92)]);
  const a = actor(), r = rig();
  const approach = 8;
  const s = CBZ.characterTraversal.start(a, r, 0, 1, {
    speed: approach, radius: a.radius, running: true, allowTop: false, cars: false,
  });
  assert.equal(s && s.kind, "vault");
  assert.ok(s.duration <= 0.55,
    "a sprint vault must be timed off the approach speed, not a fixed float window");
  const dt = 1 / 120;
  const speeds = [];
  let prevX = a.pos.x, prevZ = a.pos.z, guard = 0;
  while (a._traversal && guard++ < 500) {
    CBZ.now += dt * 1000;
    CBZ.characterTraversal.step(a, r, dt, false);
    speeds.push(Math.hypot(a.pos.x - prevX, a.pos.z - prevZ) / dt);
    prevX = a.pos.x; prevZ = a.pos.z;
  }
  // The last sample is the snap onto the exact endpoint, which is a sub-frame
  // remainder rather than a velocity; every sample before it is real motion.
  const moving = speeds.slice(0, -1);
  const slowest = Math.min(...moving);
  assert.ok(slowest > approach * 0.7,
    `root motion must carry the run through the vault (slowest ${slowest.toFixed(2)} m/s of ${approach})`);
  assert.ok(moving[0] > approach * 0.7, "and must not stall on entry");
  assert.ok(moving[moving.length - 1] > approach * 0.7, "and must not stall on exit");
  finish(a, r);
}

/* ---- CATCHING THE EDGE ----------------------------------------------------
   A body in the air with a lip in front of it at hand height. Nothing ever
   looked up from a falling body before, because the obstacle band is measured
   against the FEET and a falling body's feet are already below the ledge it
   just missed. */
{
  // A roof lip the jump came up short of: caught, and hauled onto the top.
  const roof = { minX: -3, maxX: 3, minZ: 1.4, maxZ: 6, y0: 0, y1: 3.0, _city: true };
  world([roof]);
  const a = actor(), r = rig();
  a.pos.set(0, 2.35, 0.35);          // airborne, chest just under the lip
  a.grounded = false;
  a.vy = -3.2;                        // and falling
  const caught = CBZ.characterTraversal.catchLedge(a, r, 0, 1, { radius: a.radius });
  assert.ok(caught, "a falling body must catch a lip within hand reach");
  assert.equal(caught.kind, "mantle");
  assert.equal(caught.landOnTop, true, "a catch resolves onto the surface it grabbed");
  assert.equal(a.vy, 0, "the catch arrests the fall");
  finish(a, r);
  assert.ok(Math.abs(a.pos.y - roof.y1) < 0.02, "and finishes standing on the roof");
  assert.ok(CBZ.characterTraversal.surfaceY(a, a.pos.x, a.pos.z, 0) >= roof.y1 - 0.02,
    "the arrival surface must be one the ground resolver keeps holding");
}
{
  const roof = { minX: -3, maxX: 3, minZ: 1.4, maxZ: 6, y0: 0, y1: 3.0, _city: true };
  world([roof]);
  // RISING past the same lip is not a missed jump — do not grab on the way up.
  const up = actor(); up.pos.set(0, 2.35, 0.35); up.grounded = false; up.vy = 4.0;
  assert.equal(CBZ.characterTraversal.catchLedge(up, rig(), 0, 1, { radius: up.radius }), null,
    "a rising body has not come up short yet");
  // A body ON THE GROUND is not catching anything; that is the vault's job.
  const down = actor(); down.pos.set(0, 0, 0.35); down.grounded = true; down.vy = 0;
  assert.equal(CBZ.characterTraversal.catchLedge(down, rig(), 0, 1, { radius: down.radius }), null,
    "a grounded body must route through the ordinary probe");
  // No committed direction = no reach. An auto-grab that fires on a straight
  // drop past a wall is a magnet, not a save.
  const idle = actor(); idle.pos.set(0, 2.35, 0.35); idle.grounded = false; idle.vy = -3.2;
  assert.equal(CBZ.characterTraversal.catchLedge(idle, rig(), 0, 0, { radius: idle.radius }), null,
    "catching an edge requires holding a direction into it");
  // A lip far above the hands is out of reach.
  const high = actor(); high.pos.set(0, 0.2, 0.35); high.grounded = false; high.vy = -3.2;
  assert.equal(CBZ.characterTraversal.catchLedge(high, rig(), 0, 1, { radius: high.radius }), null,
    "a ledge above the head is not a handhold");
}

/* ---- THE LANDING ---------------------------------------------------------- */
{
  const r = rig();
  assert.equal(CBZ.characterTraversal.land(r, 4.4, 6, null), null,
    "a step off a kerb is absorbed by the ankles and needs no pose");
  const soft = CBZ.characterTraversal.land(r, 8.2, 6, null);
  assert.ok(soft && !soft.roll, "an ordinary jump lands on its feet with a small settle");
  assert.ok(soft.hard > 0 && soft.hard < 0.5, "and does not spend the whole budget");
  const rolled = CBZ.characterTraversal.land(r, 13.0, 6, null);
  assert.ok(rolled && rolled.roll, "a drop past FALL_SAFE with forward line rolls out");
  const stuck = CBZ.characterTraversal.land(r, 13.0, 0.4, null);
  assert.ok(stuck && !stuck.roll,
    "a body that lands stationary has nowhere to roll and takes it standing");
}

/* ---- THE THREE MODES THE OWNER NAMED --------------------------------------
   "parkour animation added to gang city and jail game and natural disaster."
   Those are `city`, `escape` and `survival`. Nothing in this file's traversal
   reads a city record, so the capability table (systems/modecaps.js) is what
   decides whether the whole mechanic exists in a mode — assert it here rather
   than in prose, so a future row edit that quietly drops one shows up as a
   failing test instead of as a mode where jump silently stops working. */
{
  const capsSrc = await readFile(path.join(root, "src/systems/modecaps.js"), "utf8");
  for (const mode of ["city", "escape", "survival", "gungame"]) {
    const row = new RegExp(`\\n\\s*${mode}:\\s*\\{[^}]*\\}`).exec(capsSrc);
    assert.ok(row, `systems/modecaps.js must carry a capability row for "${mode}"`);
    assert.match(row[0], /traverse:\s*1/,
      `${mode} must grant the traverse capability — that is what makes parkour exist there`);
  }
  // And the probe itself must gate on the CAPABILITY, never on a mode name.
  assert.match(physicsSource, /modeHas\s*\(\s*"traverse"\s*\)/,
    "the traversal probe must ask for the capability, not test a mode enum");

  /* BEHAVIOURALLY, not just in the table. Run the SAME window opening in each
     mode with the capability granted, and require the same answer — this is
     what catches a city-shaped dependency hiding inside the move (the water
     check in landingClear is exactly that shape: it asks the CITY's water
     field, and asking it inside the prison would refuse every aperture in the
     block). A mode name must change nothing about the geometry. */
  const realMode = CBZ.game.mode;
  CBZ.modeHas = (cap) => cap === "traverse";
  for (const mode of ["city", "escape", "survival", "gungame"]) {
    CBZ.game.mode = mode;
    world(aperture(0.90, 2.30));
    const a = actor(), r = rig();
    const s = CBZ.characterTraversal.probe(a, r, 0, 1, {
      speed: 7, radius: a.radius, running: true, allowTop: true, cars: false,
    });
    assert.equal(s && s.kind, "through",
      `the aperture move must resolve identically in "${mode}" — the geometry is engine, not a scenario`);
    assert.equal(s.gapStyle, "dive", `and pick the same silhouette in "${mode}"`);
  }
  // With the capability withheld, the whole mechanic must be absent.
  CBZ.modeHas = () => false;
  world(aperture(0.90, 2.30));
  const denied = actor(), deniedRig = rig();
  assert.equal(CBZ.characterTraversal.probe(denied, deniedRig, 0, 1, {
    speed: 7, radius: denied.radius, running: true, allowTop: true, cars: false,
  }), null, "a mode without the traverse capability must get no traversal at all");
  assert.equal(CBZ.characterTraversal.catchLedge(
    Object.assign(actor(), { grounded: false, vy: -3 }), rig(), 0, 1, {}), null,
    "and no edge catch either");
  delete CBZ.modeHas;
  CBZ.game.mode = realMode;
}

/* ---- THE ONE-LINE REVERT, PROVED RATHER THAN ASSERTED ---------------------
   doctrine's DEGRADE-SAFE point: `CBZ.CONFIG.PARKOUR_V2 = false` must restore
   the shipped traversal exactly. It is also the mechanism that makes
   tools/visual-presets/parkour-moves.mjs a true before/after — the "before"
   side is this same checkout with the flag off — so if the flag ever stopped
   reverting cleanly, that comparison would silently be showing two versions of
   the new code and claiming one was the old one. */
{
  CBZ.CONFIG.PARKOUR_V2 = false;
  // The window closes again: this is exactly the refusal the owner reported.
  assert.equal(probeGap(0.90, 2.30).state, null,
    "with the flag off the aperture must be refused, as it shipped");
  // The vault comes back on its fixed window and its zero-derivative fade.
  world([box(0.92)]);
  const oldA = actor(), oldR = rig();
  const old = CBZ.characterTraversal.start(oldA, oldR, 0, 1, {
    speed: 8, radius: oldA.radius, running: true, allowTop: false, cars: false,
  });
  assert.equal(old && old.kind, "vault");
  assert.equal(old.tangent, null, "flag off must leave the Hermite tangent unset");
  assert.ok(old.duration > 0.65,
    "flag off must restore the fixed duration window, not the speed-matched one");
  const dt = 1 / 120;
  let px = oldA.pos.x, pz = oldA.pos.z, slowest = Infinity, guard = 0;
  const samples = [];
  while (oldA._traversal && guard++ < 500) {
    CBZ.now += dt * 1000;
    CBZ.characterTraversal.step(oldA, oldR, dt, false);
    samples.push(Math.hypot(oldA.pos.x - px, oldA.pos.z - pz) / dt);
    px = oldA.pos.x; pz = oldA.pos.z;
  }
  slowest = Math.min(...samples.slice(0, -1));
  assert.ok(slowest < 8 * 0.2,
    `flag off must reproduce the old stall at the obstacle (got ${slowest.toFixed(2)} m/s)`);
  finish(oldA, oldR);
  // And the three new mechanics simply do not exist.
  const offRig = rig();
  assert.equal(CBZ.characterTraversal.land(offRig, 14, 6, null), null,
    "flag off must have no landing beat");
  assert.equal(offRig.landPose, undefined);
  world([{ minX: -3, maxX: 3, minZ: 1.4, maxZ: 6, y0: 0, y1: 3.0 }]);
  const offCatch = actor();
  offCatch.pos.set(0, 2.35, 0.35); offCatch.grounded = false; offCatch.vy = -3.2;
  assert.equal(CBZ.characterTraversal.catchLedge(offCatch, rig(), 0, 1, { radius: 0.5 }), null,
    "flag off must have no edge catch");
  CBZ.CONFIG.PARKOUR_V2 = true;
  // …and turning it back on restores the aperture, so the flag is a switch and
  // not a one-way door.
  assert.equal(probeGap(0.90, 2.30).state.kind, "through");
}

const stats = CBZ.characterTraversal.stats();
assert.ok(stats.vaults >= 2 && stats.mantles >= 2 && stats.cars >= 1);
assert.ok(stats.throughs >= 1 && stats.dives >= 1, "the aperture move must be counted");
assert.ok(stats.catches >= 1, "the edge catch must be counted");
assert.ok(stats.gapRefused >= 3, "and every refused aperture must be counted too");
assert.equal(stats.completed, stats.vaults + stats.mantles + stats.throughs);

console.log("PASS character traversal: vault, mantle, aperture dive, edge catch, " +
  "landing budget, continuous root motion, top support, reach, and parked-car rules");
