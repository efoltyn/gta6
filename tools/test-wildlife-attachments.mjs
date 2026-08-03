#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { performance } from "node:perf_hooks";
import * as THREE from "three";
import { objectParts, touchingObbs } from "./lib/attachment-audit.mjs";

// Every authored wildlife build is exercised in cheap Node geometry: no
// server, renderer, world spawn, or browser. reality.js supplies the shared
// support graph; OBBs supply the precise narrow phase its AABB broad phase
// cannot infer for rotated tails, antlers, fins, ears, and legs.
const CBZ = {
  boxGeom: (w, h, d) => new THREE.BoxGeometry(w, h, d)
};
const context = vm.createContext({ window: { CBZ, THREE }, performance });
const speciesSource = {};

function load(relativePath) {
  const before = new Set(Object.keys(CBZ.WILDLIFE_SPECIES || {}));
  const url = new URL(relativePath, import.meta.url);
  vm.runInContext(fs.readFileSync(url, "utf8"), context, { filename: url.pathname });
  for (const id of Object.keys(CBZ.WILDLIFE_SPECIES || {})) {
    if (!before.has(id)) speciesSource[id] = relativePath.replace("../", "");
  }
}

load("../src/systems/reality.js");
load("../src/city/wildlife_species.js");
const wildlifeDir = new URL("../src/city/wildlife/", import.meta.url);
for (const file of fs.readdirSync(wildlifeDir).filter((name) => name.endsWith(".js")).sort()) {
  load(`../src/city/wildlife/${file}`);
}

const material = new THREE.MeshBasicMaterial();
function buildSpecies(species, rngValue) {
  assert.ok(species && typeof species.build === "function", "species needs a build function");
  return species.build({ THREE, mat: () => material, rng: () => rngValue });
}

function physicsParts(group, speciesId) {
  return objectParts(group, { kind: speciesId, prefix: speciesId });
}

function auditSpecies(species, rngValue) {
  return CBZ.reality.supportAudit(physicsParts(buildSpecies(species, rngValue), species.id), {
    cell: 0.5,
    contactEps: 0.015,
    touches: touchingObbs
  });
}

// Constant low/high RNG passes cover optional anatomy such as deer antlers as
// well as the alternate unadorned builds without turning this into a big test.
const species = Object.values(CBZ.WILDLIFE_SPECIES).sort((a, b) => a.id.localeCompare(b.id));
const rngPasses = [0.25, 0.75];
const findings = [];
let builds = 0;
let parts = 0;
for (const animal of species) {
  for (const rngValue of rngPasses) {
    const result = auditSpecies(animal, rngValue);
    builds++;
    parts += result.total;
    if (result.unsupportedCount) {
      findings.push({
        species: animal.id,
        source: speciesSource[animal.id],
        rng: rngValue,
        floating: result.unsupportedCount,
        components: result.unsupportedComponents,
        samples: result.samples
      });
    }
  }
}
assert.deepEqual(findings, [],
  `wildlife attachment inventory found floating geometry:\n${JSON.stringify(findings, null, 2)}`);

// Sensitivity control: restore the old lion sign mistake. Its transformed AABB
// still overlaps the tuft's AABB, so an AABB-only check would miss the exact
// regression. The oriented narrow phase must isolate the tuft.
const lionSpecies = CBZ.WILDLIFE_SPECIES.lion;
const brokenLion = buildSpecies(lionSpecies, 0.5);
const brokenTail = brokenLion.getObjectByName("lion:tail");
assert.ok(brokenTail, "lion tail should be named for attachment diagnostics");
brokenTail.rotation.z = 0.5;
const detached = CBZ.reality.supportAudit(physicsParts(brokenLion, lionSpecies.id), {
  cell: 0.5,
  contactEps: 0.015,
  touches: touchingObbs
});
assert.equal(detached.unsupportedCount, 1,
  "attachment inventory should catch the old detached lion-tail tuft");
assert.equal(detached.unsupportedComponents, 1);
assert.equal(detached.samples[0] && detached.samples[0].id, "lion:tail-tuft");

console.log(JSON.stringify({
  ok: true,
  species: species.length,
  builds,
  parts,
  floating: 0,
  oldBugControl: {
    floating: detached.unsupportedCount,
    caught: detached.samples[0] && detached.samples[0].id
  }
}, null, 2));
