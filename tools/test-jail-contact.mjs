/* Regression test: sprinting into a jail inmate is movement contact, not an
   attack. It must block the player without knocking the inmate down. */
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

function makeGrid(cell) {
  const buckets = new Map();
  const cellIndex = (value) => Math.floor(value / cell);
  const key = (x, z) => `${x}:${z}`;
  return {
    cellIndex,
    rebuild(list, posOf) {
      buckets.clear();
      for (const actor of list) {
        const pos = posOf(actor);
        const k = key(cellIndex(pos.x), cellIndex(pos.z));
        if (!buckets.has(k)) buckets.set(k, []);
        buckets.get(k).push(actor);
      }
    },
    bucket(x, z) { return buckets.get(key(x, z)); },
  };
}

const playerGroup = { rotation: { y: 0 } };
const CBZ = {
  game: { mode: "escape" },
  player: { pos: { x: 0, y: 0, z: 0 }, radius: 0.55, speed: 6.4, sprint: true, dead: false },
  playerChar: { group: playerGroup },
  makeGrid,
  onUpdate() {},
};
globalThis.window = { CBZ };

const source = fs.readFileSync(new URL("../src/systems/humancontact.js", import.meta.url), "utf8");
vm.runInThisContext(source, { filename: "src/systems/humancontact.js" });

const named = { pos: { x: 0, y: 0, z: 0.4 }, r: 0.36, ko: 0, dead: false };
const playerActor = { isPlayer: true, pos: CBZ.player.pos, group: playerGroup, r: 0.55, dead: false };
CBZ.humanContact.resolve([playerActor, named], 1 / 60, { mode: "escape" });
assert.equal(named.ko, 0, "named inmate was knocked down by ordinary sprint contact");
assert.ok(CBZ.player.speed <= 1.5, "named-inmate contact did not block the player");

Object.assign(CBZ.player.pos, { x: 0, y: 0, z: 0 });
CBZ.player.speed = 6.4;
const ambient = {
  dead: new Uint8Array(1), downT: new Float32Array(1),
  posX: new Float32Array([0]), posZ: new Float32Array([0.4]),
  velX: new Float32Array(1), velZ: new Float32Array(1),
  contactCD: new Float32Array(1), grudge: new Uint8Array(1),
  panic: new Float32Array(1), reactivity: new Uint8Array([255]),
};
CBZ.humanContact.resolveAmbientPlayer(ambient, 0, 1 / 60);
assert.equal(ambient.downT[0], 0, "ambient inmate was knocked down by ordinary sprint contact");
assert.ok(CBZ.player.speed <= 1.5, "ambient-inmate contact did not block the player");

console.log("jail contact regression ok");
