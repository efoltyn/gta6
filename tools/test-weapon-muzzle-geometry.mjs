#!/usr/bin/env node
// Geometry-level regression: every authored gun must expose a finite muzzle
// socket at its actual front tip. fpsmode uses this exact socket for bullets,
// tracers, flashes and casings in both first and third person.

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import * as THREE from "three";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sandbox = { window: {} };
sandbox.window.window = sandbox.window;
sandbox.window.THREE = THREE;
sandbox.window.CBZ = {};
vm.createContext(sandbox);
const run = async (file) => vm.runInContext(await readFile(file, "utf8"), sandbox, { filename: file });

await run(path.join(ROOT, "src/weapons/weapon-data.js"));
const appearanceDir = path.join(ROOT, "src/weapons/appearances");
for (const file of (await readdir(appearanceDir)).filter((f) => f.endsWith(".js")).sort()) {
  await run(path.join(appearanceDir, file));
}

const mat = {};
for (const [name, color] of Object.entries({
  dark: 0x161a20, black: 0x080a0c, steel: 0x48515c, worn: 0x747f8c,
  tan: 0x8b6a42, polymer: 0x232a24, brass: 0xd6a33b,
  redShell: 0x9d2523, skin: 0xf0c39a,
})) mat[name] = new THREE.MeshLambertMaterial({ color });
function box(parent, sx, sy, sz, material, x, y, z, rx, ry, rz) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), material);
  mesh.position.set(x || 0, y || 0, z || 0);
  mesh.rotation.set(rx || 0, ry || 0, rz || 0);
  parent.add(mesh); return mesh;
}
function cyl(parent, r, len, material, x, y, z, rx, ry, rz) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 12), material);
  mesh.position.set(x || 0, y || 0, z || 0);
  mesh.rotation.set(rx || 0, ry || 0, rz || 0);
  parent.add(mesh); return mesh;
}

const ctx = { THREE, box, cyl, mat };
const rows = [], failures = [];
for (const weapon of sandbox.window.CBZ.FPS_WEAPONS || []) {
  const key = weapon.appearanceFactory || weapon.key;
  const build = sandbox.window.CBZ.weaponAppearance && sandbox.window.CBZ.weaponAppearance[key];
  if (!build) { failures.push(`${weapon.id}: missing appearance factory ${key}`); continue; }
  const group = build(ctx);
  group.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(group);
  const muzzle = group.userData.muzzle;
  const finite = !!(muzzle && Number.isFinite(muzzle.x) && Number.isFinite(muzzle.y) && Number.isFinite(muzzle.z));
  const tipGap = finite ? muzzle.z - bounds.min.z : null;
  rows.push({ id: weapon.id, frontZ: +bounds.min.z.toFixed(3), muzzleZ: finite ? +muzzle.z.toFixed(3) : null, tipGap: tipGap == null ? null : +tipGap.toFixed(3) });
  if (!finite) failures.push(`${weapon.id}: missing/invalid muzzle socket`);
  else if (Math.abs(tipGap) > 0.18) failures.push(`${weapon.id}: muzzle is ${tipGap.toFixed(3)}u from the authored front tip`);
}

console.log(JSON.stringify({ weapons: rows, failures }, null, 2));
if (failures.length) process.exitCode = 1;
