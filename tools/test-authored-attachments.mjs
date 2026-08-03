#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { performance } from "node:perf_hooks";
import * as THREE from "three";
import { auditObject, belongsTo } from "./lib/attachment-audit.mjs";

// Cross-system assembly inventory: the same support graph that found detached
// wildlife parts now inspects the canonical human rig and every legal
// human+mount composite in idle, travel, and airborne poses.
const materialCache = new Map();
function material(color) {
  const key = Number(color == null ? 0x888888 : color);
  if (!materialCache.has(key)) materialCache.set(key, new THREE.MeshBasicMaterial({ color: key }));
  return materialCache.get(key);
}

const updates = [];
const CBZ = {
  CONFIG: {
    ANIMALS_ALL_CONTROLLABLE: true,
    CHAR_SCALE_REAL: true,
    CHAR_RIG_DYNAMIC: true,
  },
  HUMAN_SCALE: 0.70,
  TUNE: { walkSpeed: 6.4, jumpVel: 8.2 },
  game: { level: 20, cityInv: {} },
  boxGeom: (w, h, d) => new THREE.BoxGeometry(w, h, d),
  mat: material,
  cmat: material,
  onUpdate: (order, fn) => updates.push({ order, fn }),
  addLandmass: () => {},
};
const windowObject = { CBZ, THREE };
windowObject.window = windowObject;
const context = vm.createContext({
  window: windowObject,
  THREE,
  performance,
  console,
  Math,
});

function load(relativePath) {
  const url = new URL(relativePath, import.meta.url);
  vm.runInContext(fs.readFileSync(url, "utf8"), context, { filename: url.pathname });
}

load("../src/systems/reality.js");
load("../src/entities/character.js");
load("../src/city/wildlife_species.js");
const wildlifeDir = new URL("../src/city/wildlife/", import.meta.url);
for (const file of fs.readdirSync(wildlifeDir).filter((name) => name.endsWith(".js")).sort()) {
  load(`../src/city/wildlife/${file}`);
}
load("../src/city/wildlife_tame.js");

function makeRider(options = {}) {
  return CBZ.makeCharacter({
    skin: 0xb87955,
    torso: 0x315f94,
    collar: 0x315f94,
    arms: 0x315f94,
    legs: 0x202c3c,
    shoes: 0x201a18,
    hair: 0x2b1b12,
    ...options,
  });
}

function animate(rig, frames, speed = 0) {
  for (let i = 0; i < frames; i++) CBZ.animChar(rig, speed, 1 / 60);
}

const findings = [];
let assemblies = 0;
let inspectedParts = 0;

// Characters are used throughout the game, so prove the shared rig itself is
// one connected physical assembly across its body profiles before composing it
// with an animal.
for (const profile of [
  { id: "adult-male", build: "m" },
  { id: "adult-female", build: "f", longHair: true },
  { id: "child", build: "f", age: 8, longHair: true },
]) {
  const rig = makeRider(profile);
  animate(rig, 30, 0);
  const result = auditObject(CBZ.reality, rig.group, {
    kind: `character:${profile.id}`,
    prefix: `character:${profile.id}`,
    contactEps: 0.018,
  });
  assemblies++;
  inspectedParts += result.total;
  if (result.unsupportedCount) findings.push({
    assembly: `character:${profile.id}`,
    floating: result.unsupportedCount,
    components: result.unsupportedComponents,
    samples: result.samples,
  });
}

const rideable = Object.values(CBZ.WILDLIFE_SPECIES)
  .filter((species) => !species.aquatic && CBZ.cityRideDefinition(species))
  .sort((a, b) => a.id.localeCompare(b.id));
const states = [
  { id: "idle", moving: false, airborne: false, phase: 0, speed: 0 },
  { id: "travel", moving: true, airborne: false, phase: 1.1, speed: 8 },
  { id: "airborne", moving: true, airborne: true, phase: 2.2, speed: 8 },
];

function mountedAssembly(species, state, lift = 0) {
  const animal = species.build({ THREE, mat: material, rng: () => 0.25 });
  animal.name = `${species.id}:mount`;
  animal.scale.setScalar(species.scale || 1);
  const visual = CBZ.cityRideVisualSpec(species, animal);
  assert.ok(visual, `${species.id} should publish a mount visual spec`);

  const rider = makeRider();
  rider.group.name = `${species.id}:rider`;
  rider.riding = { width: visual.width, ...state };
  animate(rider, 90, state.speed);
  const hs = rider.group.userData.humanScale || 1;
  rider.group.position.set(visual.x, visual.y - rider.hipY * hs + lift, 0);
  rider.group.rotation.y = Math.PI / 2; // human +Z faces animal +X

  const assembly = new THREE.Group();
  assembly.name = `${species.id}:${state.id}`;
  assembly.add(animal, rider.group);
  assembly.updateMatrixWorld(true);
  return { assembly, animal, rider, visual };
}

for (const species of rideable) {
  for (const state of states) {
    const built = mountedAssembly(species, state);
    const result = auditObject(CBZ.reality, built.assembly, {
      kind: `mounted:${species.id}:${state.id}`,
      prefix: `mounted:${species.id}:${state.id}`,
      contactEps: 0.024,
      // The animal core is the physical carrier. The entire rider must reach
      // that subtree through real solid contact; being nearby is not mounted.
      anchorWhere: (part) => belongsTo(part.object, built.animal),
    });
    assemblies++;
    inspectedParts += result.total;
    if (result.unsupportedCount) findings.push({
      assembly: `mounted:${species.id}:${state.id}`,
      floating: result.unsupportedCount,
      components: result.unsupportedComponents,
      samples: result.samples,
    });
  }
}

assert.deepEqual(findings, [],
  `authored attachment inventory found floating geometry:\n${JSON.stringify(findings, null, 2)}`);

// Sensitivity control: a rider lifted clear of the saddle must become a whole
// unsupported component. This proves the test does not pass merely because
// human and animal share a parent Group or are close in world space.
const controlSpecies = CBZ.WILDLIFE_SPECIES.lion;
const control = mountedAssembly(controlSpecies, states[0], 2.2);
const detached = auditObject(CBZ.reality, control.assembly, {
  kind: "mounted:lion:detached-control",
  prefix: "mounted:lion:detached-control",
  contactEps: 0.024,
  anchorWhere: (part) => belongsTo(part.object, control.animal),
});
assert.ok(detached.unsupportedCount > 10, "lifted rider should be detected as a floating component");
assert.equal(detached.unsupportedComponents, 1, "the detached rider should remain internally connected");

console.log(JSON.stringify({
  ok: true,
  characterProfiles: 3,
  rideableSpecies: rideable.length,
  mountStates: states.length,
  assemblies,
  parts: inspectedParts,
  floating: 0,
  detachedRiderControl: {
    floating: detached.unsupportedCount,
    components: detached.unsupportedComponents,
  },
}, null, 2));
