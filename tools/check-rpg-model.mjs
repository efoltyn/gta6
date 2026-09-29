#!/usr/bin/env node
// tools/check-rpg-model.mjs — plain-node check of the RPG-7 appearance
// (weapons/appearances/bazooka.js) against the game's own r128 build.
//   · the tube is a real RPG-7: 0.85-1.05 m muzzle-to-venturi, slim bore
//   · the muzzle socket IS the fuze tip of the seated PG-7V
//   · the PG-7V bulb is wider than the tube, the warhead is its own group
//   · every grip point lies on (within 1.5 cm real of) an actual grip mesh
//   · the firing-hand grip spec (userData.fireGrip) sits on the pistol grip
//   · the shoulder point is ahead of the venturi (the rig seats THAT)
//   · every lathe faces outward (a wrong winding draws inside-out)
// Model units are the gun kit's: 2 units per real metre (userData.unitsPerMetre).
// Run: node tools/check-rpg-model.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ctxG = { console, Math, Date, Float32Array, Uint16Array, Uint32Array, Uint8Array, Int32Array, Array, Object, Map, Set, WeakMap };
ctxG.window = ctxG; ctxG.self = ctxG;
vm.createContext(ctxG);
vm.runInContext(readFileSync(path.join(root, "src/vendor/three.r128.min.js"), "utf8"), ctxG);
const THREE = ctxG.THREE;
ctxG.CBZ = { CONFIG: {} };
for (const f of ["src/weapons/appearances/sidearm.js", "src/weapons/appearances/bazooka.js", "src/weapons/munitions.js"])
  vm.runInContext(readFileSync(path.join(root, f), "utf8"), ctxG, { filename: f });
const CBZ = ctxG.CBZ;

let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log("FAIL " + m); } else console.log("ok   " + m); };

const mat = {};
for (const k of ["dark", "black", "bore", "steel", "worn", "tan", "polymer", "brass", "redShell", "skin"]) mat[k] = new THREE.MeshLambertMaterial();
function box(p, sx, sy, sz, m, x, y, z, rx, ry, rz) {
  const o = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), m);
  o.position.set(x || 0, y || 0, z || 0); o.rotation.set(rx || 0, ry || 0, rz || 0); p.add(o); return o;
}
function cyl(p, r, len, m, x, y, z, rx, ry, rz) {
  const o = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 12), m);
  o.position.set(x || 0, y || 0, z || 0); o.rotation.set(rx || 0, ry || 0, rz || 0); p.add(o); return o;
}

const g = CBZ.weaponAppearance.bazooka({ THREE, box, cyl, mat });
g.updateMatrixWorld(true);
const S = g.userData.unitsPerMetre;
ok(S > 0, `unitsPerMetre published (${S})`);
const bb = (o) => new THREE.Box3().setFromObject(o);
const named = (n) => { let r = null; g.traverse((o) => { if (!r && o.name === n) r = o; }); return r; };
const cm = (units) => (units / S * 100).toFixed(1) + " cm";

// ---- the tube ----
const tube = named("rpg:tube"), bell = named("rpg:venturi");
ok(!!tube && !!bell, "tube + venturi meshes exist");
const tb = bb(tube), vb = bb(bell);
const tubeLenM = (vb.max.z - tb.min.z) / S;
ok(tubeLenM >= 0.85 && tubeLenM <= 1.05, `tube muzzle-to-venturi length ${tubeLenM.toFixed(3)} m in 0.85-1.05`);
const tubeDiaM = (tb.max.x - tb.min.x) / S;
ok(tubeDiaM > 0.040 && tubeDiaM < 0.065, `tube outer diameter ${(tubeDiaM * 1000).toFixed(0)} mm (40 mm bore, slim)`);
ok((vb.max.x - vb.min.x) > (tb.max.x - tb.min.x) * 1.5, "venturi flares wider than the tube");

// ---- the warhead ----
const wh = g.userData.warhead;
ok(!!(wh && wh.isObject3D && wh.children.length), "userData.warhead group present");
const wb = bb(wh);
const bulbM = (wb.max.x - wb.min.x) / S;
ok(Math.abs(bulbM - 0.085) < 0.004, `PG-7V bulb ${(bulbM * 1000).toFixed(0)} mm (85 mm), wider than the tube`);
const mz = g.userData.muzzle;
ok(Math.abs(mz.z - wb.min.z) < 0.006 && Math.abs(mz.y - (wb.min.y + wb.max.y) / 2) < 0.006 && Math.abs(mz.x) < 1e-6,
  `muzzle socket at the fuze tip (muzzle z ${mz.z.toFixed(3)}, warhead tip z ${wb.min.z.toFixed(3)})`);
ok(wb.max.z <= tb.min.z + 0.02 && wb.max.z >= tb.min.z - 0.02, "warhead neck seats at the tube's mouth");
const loadedM = (vb.max.z - wb.min.z) / S;
ok(Math.abs(loadedM - 1.35) < 0.05, `loaded length ${loadedM.toFixed(3)} m (weapon-data real.len 1.35)`);
ok(!!g.userData.reloadWarhead && g.userData.reloadWarhead.visible === false, "first-person reload round built, hidden");
const gNpc = CBZ.weaponAppearance.bazooka({ THREE, box, cyl, mat, noHand: true });
ok(!gNpc.userData.reloadWarhead && !!gNpc.userData.warhead, "NPC prop: warhead yes, spare reload round no");

// ---- the grips ----
const tol = 0.015 * S;
function near(pt, mesh, label) {
  if (!mesh) return ok(false, label + ": mesh missing");
  const b = bb(mesh).expandByScalar(tol);
  ok(b.containsPoint(pt), `${label} (${pt.x.toFixed(3)}, ${pt.y.toFixed(3)}, ${pt.z.toFixed(3)}) within 1.5 cm of ${mesh.name}`);
}
const gr = g.userData.grips;
ok(gr && gr.style === "rocket", "grips.style rocket");
near(gr.support, named("rpg:frontWood"), "grips.support");
near(new THREE.Vector3(0, gr.hold.y, gr.hold.z), named("rpg:frontWood"), "grips.hold centre");
const fwb = bb(named("rpg:frontWood"));
ok(Math.abs(gr.hold.len - (fwb.max.z - fwb.min.z)) < 0.01 && Math.abs(gr.hold.w - (fwb.max.x - fwb.min.x)) < 0.01, "grips.hold prism = the front heat shield's size");
near(gr.mag, wh, "grips.mag (under the bulb)");
near(g.userData.rearGrip, named("rpg:rearGrip"), "rear grip point");
const fg = g.userData.fireGrip;
ok(!!fg, "firing-hand grip spec (gunKit.hand) recorded");
if (fg) near(new THREE.Vector3(0, fg.at[0], fg.at[1]), named("rpg:pistolGrip"), "firing grip top");

// ---- shoulder ----
ok(g.userData.shoulderZ > 0.26 && g.userData.shoulderZ < vb.min.z, `shoulder point z ${g.userData.shoulderZ.toFixed(2)} ahead of the venturi (${vb.min.z.toFixed(2)})`);

// ---- lathe winding: outward normals ----
let inward = 0, checked = 0;
g.traverse((o) => {
  if (!o.isMesh || o.geometry.type !== "LatheGeometry" && o.geometry.type !== "LatheBufferGeometry") return;
  const pos = o.geometry.attributes.position, nor = o.geometry.attributes.normal;
  let dot = 0;
  for (let i = 0; i < pos.count; i++) dot += pos.getX(i) * nor.getX(i) + pos.getZ(i) * nor.getZ(i);
  checked++; if (dot <= 0) inward++;
});
ok(checked >= 3 && inward === 0, `${checked} lathes, ${inward} facing inward`);

// ---- the flight profile ----
const fp = CBZ.rpgRound.flightProfile();
let asc = true; for (let i = 1; i < fp.length; i++) if (fp[i][1] < fp[i - 1][1] - 1e-9) asc = false;
ok(asc && Math.abs(fp[fp.length - 1][1]) < 1e-9 && fp[0][1] <= -0.85, `flight round profile ascending, nose at 0, tail at ${fp[0][1]} m`);

// ---- 2. the flight FX block of systems/fpsmode.js, run in isolation ----
// The region from "THE ROUND IN FLIGHT IS A PG-7V" to CBZ.rpgFxStats is
// lifted out and run against stubs: a round flown at 114 m/s for 1.2 s must
// lay a trail with no gap wider than its spacing, stay under the pool cap,
// light its motor ~10 m out, open its fins in 0.1 s, and the warhead sync
// must follow the ammo and the reload clock.
{
  const src = readFileSync(path.join(root, "src/systems/fpsmode.js"), "utf8");
  const a0 = src.indexOf("  // ---- THE ROUND IN FLIGHT IS A PG-7V");
  const a1 = src.indexOf("\n", src.indexOf("  CBZ.rpgFxStats = function"));
  ok(a0 > 0 && a1 > a0, "flight FX region found in fpsmode.js");
  const scene = new THREE.Scene();
  const fake2d = { createRadialGradient: () => ({ addColorStop() {} }), fillRect() {}, set fillStyle(v) {} };
  ctxG.document = { createElement: () => ({ width: 0, height: 0, getContext: () => fake2d }) };
  ctxG.__T = { THREE, scene };
  const harness = `(function(){
    const THREE = __T.THREE; const CBZ = window.CBZ; CBZ.scene = __T.scene;
    CBZ.camera = { fov: 70 }; CBZ.renderer = { domElement: { height: 900 } };
    const WEAPONS = [{ reload: 1.4 }]; const fps = { reloading: 0, rounds: [1], weapon: 0 }; let reloadWeapon = 0;
    const weaponModels = [CBZ.weaponAppearance.bazooka({ THREE, box: __T.box, cyl: __T.cyl, mat: __T.mat })];
    const carriedModels = [CBZ.weaponAppearance.bazooka({ THREE, box: __T.box, cyl: __T.cyl, mat: __T.mat })];
    let walls = null; function wallDistance() { return walls; }
    function shoulderActive() { return false; }
    ${src.slice(a0, a1)}
    const C = CBZ.munitions._clouds();
    return { rockets, smokeCloud: C.smoke, fireCloud: C.fire, launchFx, dressRocket, updateRocketSmoke, syncWarheads, fps, WEAPONS, weaponModels, carriedModels,
      setWall(w) { walls = w; }, setReload(v) { fps.reloading = v; } };
  })()`;
  ctxG.__T.box = box; ctxG.__T.cyl = cyl; ctxG.__T.mat = mat;
  const H = vm.runInContext(harness, ctxG, { filename: "fpsmode-rocket-region" });
  const r = H.rockets[0];
  const from = new THREE.Vector3(0, 1.6, 0), dir = new THREE.Vector3(0, 0, -1);
  r.active = true; r.plain = false; r.age = 0; r.flown = 0; r.lit = false; r.spinA = 0;
  r.dir.copy(dir); r.mesh.position.copy(from); r.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  r.lastEmit.copy(from).addScaledVector(dir, -1.17);
  H.setWall({ distance: 1.2, point: new THREE.Vector3(0, 1.6, 2.6) });
  const before = H.smokeCloud.next;
  H.launchFx(from, dir, new THREE.Vector3(0, 1.6, 1.4));
  const bb0 = H.smokeCloud.next - before;
  ok(bb0 >= 30, `launch: muzzle cloud + backblast + wall billow = ${bb0} smoke puffs`);
  // backblast puffs must be BEHIND the shooter (+z), never through the wall at z=2.6
  let behind = 0, through = 0;
  for (let i = before + 9; i < H.smokeCloud.next; i++) { const z = H.smokeCloud.A.pos[i * 3 + 2]; if (z > 1.3) behind++; if (z > 2.62) through++; }
  ok(behind > 20 && through === 0, `backblast: ${behind} puffs behind the shooter, ${through} through the wall`);
  const dt = 1 / 60, v = 114;
  let litAt = -1, finsAt = -1, maxLive = 0;
  const trailStart = H.smokeCloud.next;
  for (let f = 0; f < 72; f++) {
    const prev = r.mesh.position.clone();
    r.mesh.position.addScaledVector(dir, v * dt);
    r.mesh.updateMatrixWorld(true);
    H.dressRocket(r, dt, prev.distanceTo(r.mesh.position));
    if (r.lit && litAt < 0) litAt = r.flown;
    if (finsAt < 0 && Math.abs(r.fins[0].rotation.z + 1.5708) < 1e-3) finsAt = r.age;
    H.updateRocketSmoke(dt); CBZ.munitions.step(dt);
    maxLive = Math.max(maxLive, H.smokeCloud.live);
  }
  ok(litAt >= 10 && litAt < 12, `sustainer lights at ${litAt.toFixed(1)} m`);
  ok(finsAt > 0 && finsAt <= 0.1 + 1e-6, `fins fully open at ${finsAt.toFixed(3)} s`);
  ok(maxLive <= H.smokeCloud.n, `smoke live ${maxLive} <= cap ${H.smokeCloud.n}`);
  // trail gap along the path: consecutive trail puffs' z (birth positions drift, so read the spacing rule)
  const n = H.smokeCloud.next >= trailStart ? H.smokeCloud.next - trailStart : H.smokeCloud.n - trailStart + H.smokeCloud.next;
  const flown = r.flown;
  ok(n > 60, `trail: ${n} puffs over ${flown.toFixed(0)} m (by distance, not per frame: ${(flown / n).toFixed(2)} m apart)`);
  ok(flown / n < 2.3, "no trail gap wider than the 2.2 m spacing cap");
  // warhead sync
  H.fps.rounds[0] = 0; H.syncWarheads();
  ok(H.weaponModels[0].userData.warhead.visible === false && H.carriedModels[0].userData.warhead.visible === false, "fired: warhead gone from both launchers");
  H.setReload(1.4 * (1 - 0.5)); H.syncWarheads();
  ok(H.weaponModels[0].userData.warhead.visible === false, "reload at 50%: round still in the hand, tube empty");
  H.setReload(1.4 * (1 - 0.9)); H.syncWarheads();
  ok(H.weaponModels[0].userData.warhead.visible === true, "reload at 90%: round seated");
  H.setReload(0); H.fps.rounds[0] = 1; H.syncWarheads();
  ok(H.weaponModels[0].userData.warhead.visible === true, "loaded: round on the launcher");
}

console.log(`\ntube ${tubeLenM.toFixed(3)} m, loaded ${loadedM.toFixed(3)} m, bulb ${(bulbM * 1000).toFixed(0)} mm, tube ${(tubeDiaM * 1000).toFixed(0)} mm`);
console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
