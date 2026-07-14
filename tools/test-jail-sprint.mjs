/* Regression test: Shift+W must sprint in jail even when persisted hunger and
   stamina are both zero. Jail has no stamina updater, so stamina cannot gate
   its movement; city/survival keep their existing stamina gate. */
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

function vector(x = 0, y = 0, z = 0) {
  return {
    x, y, z,
    copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; },
    set(nx, ny, nz) { this.x = nx; this.y = ny; this.z = nz; return this; },
  };
}

const player = {
  pos: vector(), radius: 0.55, vy: 0, grounded: true,
  hp: 100, dead: false, ko: 0, stun: 0, stamina: 0,
};
const playerChar = {
  group: {
    position: vector(), rotation: { x: 0, y: 0, z: 0 },
    scale: { y: 1 },
  },
};
const updaters = [];
const CBZ = {
  game: { mode: "escape", _oocHunger: 0, invuln: 1 },
  player, playerChar,
  keys: { w: true, shift: true },
  TUNE: { walkSpeed: 2, crouchSpeed: 1.2, jumpVel: 8.2, gravity: 22 },
  SURV: { sprintMul: 3.2, staminaMax: 100 },
  cam: { yaw: 0 },
  colliders: [], platforms: [],
  floorAt() { return 0; },
  lerpAngle(_a, b) { return b; },
  damp(_a, b) { return b; },
  animChar() {}, sfx() {},
  onUpdate(order, fn) { updaters.push({ order, fn }); },
};
globalThis.window = { CBZ };

const physics = fs.readFileSync(new URL("../src/systems/physics.js", import.meta.url), "utf8");
vm.runInThisContext(physics, { filename: "src/systems/physics.js" });

CBZ.updatePlayer(1 / 60);
assert.equal(player.sprint, true, "zero persisted stamina disabled jail sprint");
assert.equal(player.speed, 6.4, "jail sprint did not use the configured 3.2x multiplier");
assert.ok(Math.abs(player.pos.z + 6.4 / 60) < 1e-9, "jail sprint did not move at 6.4m/s");

// The hunger tick must not write stamina back to zero in escape mode.
player.stamina = 73;
const hunger = fs.readFileSync(new URL("../src/systems/hunger.js", import.meta.url), "utf8");
vm.runInThisContext(hunger, { filename: "src/systems/hunger.js" });
const hungerTick = updaters.find((u) => u.order === 32.05);
assert.ok(hungerTick, "player hunger updater was not registered");
hungerTick.fn(1 / 60);
assert.equal(player.stamina, 73, "jail hunger zeroed stamina after sprint was enabled");

// Stamina remains meaningful in modes that actually drain/regenerate it.
CBZ.game.mode = "survival";
player.stamina = 0;
player.pos.set(0, 0, 0);
CBZ.updatePlayer(1 / 60);
assert.equal(player.sprint, false, "survival ignored its stamina gate");
assert.equal(player.speed, 2, "survival zero-stamina movement was not normal walking speed");

console.log("jail sprint regression ok (zero hunger/stamina -> 6.4m/s)");
