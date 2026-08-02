#!/usr/bin/env node
// Regression gate for the owner-cut flat soot marks from explosions.
// Explosion damage must read through chunks, cracks, broken glass and real
// openings instead of generated soot quads on either the ground or a wall.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const source = await readFile(path.join(root, "src/city/buildings.js"), "utf8");

function section(start, end) {
  const a = source.indexOf(start);
  assert.notEqual(a, -1, `missing start marker: ${start}`);
  const b = source.indexOf(end, a + start.length);
  assert.notEqual(b, -1, `missing end marker: ${end}`);
  return source.slice(a, b);
}

const cityScorch = section(
  "CBZ.cityScorch = function",
  "// PUBLIC: knock physical concrete CHUNKS",
);
const buildingDamage = section(
  "CBZ.cityDamageBuilding = function",
  "// ---- ESCALATING WALL WOUNDS",
);
const wallWounds = section(
  "CBZ._cityWoundWallRec = function",
  "// PUBLIC: wound the nearest wall",
);

assert.match(cityScorch, /return null/,
  "cityScorch must remain a compatibility no-op");
assert.doesNotMatch(cityScorch, /THREE\.Mesh|CanvasTexture|PlaneGeometry|CBZ\.colliders/,
  "cityScorch must not create a printed mark on any surface");

assert.doesNotMatch(buildingDamage, /cityScorch\(|scorchMat\(|scorchPool|cityBulletHole\(/,
  "building hits must not stamp soot or fake bullet-pit decals on the facade");

assert.doesNotMatch(wallWounds, /placeWoundScorch|scorchMat\(/,
  "accumulated wall wounds must not reintroduce a soot decal");
assert.match(wallWounds, /placeCrack\(/,
  "wall wounds must retain physical damage escalation");

assert.doesNotMatch(source, /scorchMat|_scorchMat|scorchPool|SCORCH_CAP/,
  "the generated soot material and its decal pool must stay deleted");

console.log("PASS building scorch contract: generated soot decals are fully removed");
