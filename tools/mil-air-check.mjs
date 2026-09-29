#!/usr/bin/env node
// tools/mil-air-check.mjs — plain-node check of the military airframes
// (src/city/mil_air.js + island_military.js's CBZ.milModels) on the game's
// own r128 build. No browser.
//   · every kit primitive winds OUTWARD (positive signed volume), mirrored too
//   · each airframe's bounding box matches its real reference class
//   · wheels on y = 0, nose toward +Z, draw calls per airframe
//   · the contracts other files read: rotor / tailRotor / gear / canopy /
//     plume / muzzle / crewSeats / cabin.seats / launchLocal / cargoRamp
//   · two placements share geometry (template + clone), plumes do not
// Run: node tools/mil-air-check.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const G = { console, Math, Date, JSON, Float32Array, Uint16Array, Uint32Array, Uint8Array, Int32Array, Array, Object, Map, Set, WeakMap };
G.window = G; G.self = G;
G.document = { createElement: () => ({ getContext: () => ({ createRadialGradient: () => ({ addColorStop() {} }), fillRect() {} }) }) };
vm.createContext(G);
vm.runInContext(readFileSync(path.join(root, "src/vendor/three.r128.min.js"), "utf8"), G);
const THREE = G.THREE;
const mats = new Map();
G.CBZ = {
  CONFIG: {}, colliders: [], onUpdate() {},
  cmat: (hex, o) => { const k = hex + JSON.stringify(o || {}); if (!mats.has(k)) mats.set(k, new THREE.MeshLambertMaterial({ color: hex })); return mats.get(k); },
};
G.CBZ.mat = G.CBZ.cmat;
for (const f of ["src/world/carfx.js", "src/weapons/munitions.js", "src/city/mil_air.js", "src/city/island_military.js", "src/city/strategic.js"]) {
  try { vm.runInContext(readFileSync(path.join(root, f), "utf8"), G, { filename: f }); }
  catch (e) { if (!/strategic|munitions/.test(f)) throw e; }
}
const CBZ = G.CBZ;
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log("FAIL " + m); } else console.log("ok   " + m); };

// ---- 1. winding ----------------------------------------------------------
function vol(g) {
  const p = g.attributes.position.array, ix = g.index.array; let v = 0;
  for (let i = 0; i < ix.length; i += 3) {
    const a = ix[i] * 3, b = ix[i + 1] * 3, c = ix[i + 2] * 3;
    v += (p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c])) / 6;
  }
  return v;
}
const Kt = CBZ.milAir.kit;
const body = Kt.loft([{ z: 3, w: 0.1, t: 0.1, b: 0.1 }, { z: 1, w: 1, t: 1.2, b: 0.8, p: 3 }, { z: -2, w: 0.7, t: 0.6, b: 0.6 }]);
ok(vol(body) > 0, `loft winds outward (vol ${vol(body).toFixed(2)})`);
const wg = Kt.wing([{ x: 0.5, le: 1, c: 3, tc: 0.1 }, { x: 4, le: -1, c: 1, tc: 0.08, y: 0.3 }]);
ok(vol(wg) > 0, `wing winds outward (vol ${vol(wg).toFixed(3)})`);
ok(vol(Kt.mir(wg)) > 0, "mirrored wing still winds outward");
ok(vol(Kt.xf(wg.clone(), 0, 2, 0, 0, 0, Math.PI / 2 - 0.4)) > 0, "fin (rotated wing) winds outward");
const st = Kt.missile(3.6, 0.09).reduce((s, g) => s + vol(g), 0);
ok(st > 0, "missile store winds outward");

// ---- 2. airframes --------------------------------------------------------
const REF = {
  fighter:     { L: [15.0, 16.4], W: [10.2, 11.2], H: [4.1, 4.8], name: "F-35-class 15.7 x 10.7 x 4.4" },
  attackHeli:  { L: [15.6, 18.2], W: [14.0, 15.0], H: [4.4, 5.2], R: [7.1, 7.5], name: "AH-64-class rotor 14.6, 17.7 overall, 4.9 to tail-rotor tip" },
  utilityHeli: { L: [18.0, 20.2], W: [15.4, 16.8], H: [4.8, 5.4], R: [8.0, 8.4], name: "UH-60-class rotor 16.4, 19.8 overall, 5.13 tall" },
  drone:       { L: [10.5, 11.8], W: [19.6, 20.6], H: [2.8, 4.0], name: "MQ-9-class 11 x 20.1" },
  bomber:      { L: [43.5, 45.5], W: [41.0, 42.4], H: [9.8, 11.0], name: "B-1-class 44.5 x 41.7 x 10.4" },
};
const bb = (o) => { o.updateMatrixWorld(true); return new THREE.Box3().setFromObject(o); };
function census(g) {
  let meshes = 0, tris = 0; const geos = new Set();
  g.traverse((o) => { if (o.isMesh || o.isSprite) { meshes++; if (o.geometry && o.geometry.index) { tris += o.geometry.index.count / 3; geos.add(o.geometry); } } });
  return { meshes, tris: Math.round(tris), geos };
}
for (const t of Object.keys(REF)) {
  const r = CBZ.milAir.make(t), g = r.group, R = REF[t];
  // measure without the invisible plume sprites/cones
  const plumes = g.userData.plume || []; plumes.forEach((p) => g.remove(p));
  const b = bb(g), s = b.getSize(new THREE.Vector3());
  plumes.forEach((p) => g.add(p));
  const c = census(g);
  console.log(`---- ${t} (${R.name}): L ${s.z.toFixed(2)} W ${s.x.toFixed(2)} H ${s.y.toFixed(2)} · ${c.meshes} draws · ${c.tris} tris`);
  ok(s.z >= R.L[0] && s.z <= R.L[1], `${t} length ${s.z.toFixed(2)} in ${R.L}`);
  ok(s.x >= R.W[0] && s.x <= R.W[1], `${t} span ${s.x.toFixed(2)} in ${R.W}`);
  ok(s.y >= R.H[0] && s.y <= R.H[1], `${t} height ${s.y.toFixed(2)} in ${R.H}`);
  ok(Math.abs(b.min.y) < 0.03, `${t} stands on y=0 (min ${b.min.y.toFixed(3)})`);
  ok(c.meshes <= 40, `${t} draw calls ${c.meshes} <= 40`);
  ok(r.footW > 0 && r.footL > 0 && r.height > 0 && r.aircraftDims, `${t} record {footW, footL, height, aircraftDims}`);
  ok(g.scale.x === 1, `${t} authored in metres (scale 1)`);
  const mz = g.userData.muzzle;
  if (t !== "drone") ok(mz && mz.isObject3D && mz.position.z > s.z * 0.3, `${t} muzzle on the nose (+Z)`);
  const r2 = CBZ.milAir.make(t);
  const c2 = census(r2.group);
  let shared = 0; c2.geos.forEach((x) => { if (c.geos.has(x)) shared++; });
  ok(shared >= c2.geos.size - 2, `${t} second placement shares ${shared}/${c2.geos.size} geometries`);
  if (t === "fighter") {
    ok(g.userData.plume && g.userData.plume.length === 1 && g.userData.plume[0] !== r2.group.userData.plume[0], "fighter: own afterburner plume per instance");
    ok(g.userData.canopy && g.userData.canopy.isObject3D, "fighter: canopy node (aircraft_doors lifts it)");
    ok(g.userData.gear && g.userData.gear.isObject3D, "fighter: gear node (hidden above 9 m AGL)");
    ok(g._milRt.surf.length === 6, `fighter: 6 control-surface pivots (${g._milRt.surf.length})`);
    ok(g.userData.cabin.seats[0].cockpit, "fighter: cockpit seat published");
    // drive: a roll-right step deflects the ailerons opposite ways
    g.rotation.z = 0; CBZ.milAirDrive(g, { thr: 1 }, 1 / 60); g.rotation.z = 0.05; CBZ.milAirDrive(g, { thr: 1 }, 1 / 60);
    const ail = g._milRt.surf.filter((q) => q.role === "ail");
    ok(ail.length === 2 && Math.abs(ail[0].node.rotation.x) > 0.01, `fighter: roll moves the flaperons (${ail[0].node.rotation.x.toFixed(3)})`);
    ok(g._milRt.glow.color.r > 0.8, "fighter: nozzle glows at full throttle");
  }
  if (/Heli/.test(t)) {
    ok(g.userData.rotor && g.userData.rotor.isObject3D, `${t}: userData.rotor`);
    ok(g.userData.tailRotor && g.userData.tailRotor.isObject3D && g.userData.trotor === g.userData.tailRotor, `${t}: userData.tailRotor (+trotor)`);
    ok(Array.isArray(g.userData.crewSeats) && g.userData.crewSeats[0].job === "Pilot", `${t}: crewSeats with a Pilot`);
    let rad = 0; const rot = g.userData.rotor, P = new THREE.Vector3();
    rot.traverse((o) => { if (!o.isMesh) return; const a = o.geometry.attributes.position; for (let i = 0; i < a.count; i++) { P.fromBufferAttribute(a, i); rad = Math.max(rad, Math.hypot(P.x, P.z)); } });
    ok(rad >= R.R[0] && rad <= R.R[1], `${t}: rotor radius ${rad.toFixed(2)} in ${R.R}`);
  }
  if (t === "attackHeli") {
    const p = CBZ.milAirPoint(g, "gun", 0);
    ok(p && p.z > 5.5 && p.y < 1.1, `attackHeli: chin-gun muzzle under the nose (${p && p.toArray().map((v) => v.toFixed(2))})`);
    ok(CBZ.milAirAim(g, 0, 0, 40), "attackHeli: chin turret slews");
    ok(g.userData.launchLocal.length >= 4, "attackHeli: pod/rail launch points");
  }
}

// ---- 3. the published base models --------------------------------------
const MM = CBZ.milModels;
for (const k of ["jet", "bomber", "cargo", "heli", "attackHeli", "drone"]) {
  const r = MM[k] && MM[k]();
  ok(r && r.group && r.footW > 0, `milModels.${k} returns a record`);
  if (r) { const c = census(r.group); console.log(`     milModels.${k}: ${c.meshes} draws · ${c.tris} tris`); }
}
{
  const r = MM.cargo(), g = r.group;
  ok(g.userData.cargoRamp && g.userData.cargoRamp.isObject3D && r.ramp === g.userData.cargoRamp, "cargo: ramp node contract");
  ok(g.userData.cabin && g.userData.cabin.seats.length === 2, "cargo: two flight-deck seats");
  ok(g.userData.milAir && g.userData.milAir.props.length === 4, "cargo: four spinning propellers");
  const b = bb(g), s = b.getSize(new THREE.Vector3());
  console.log(`     cargo: L ${s.z.toFixed(2)} W ${s.x.toFixed(2)} H ${s.y.toFixed(2)}`);
  ok(s.x > 40 && s.x < 44 && s.z > 40 && s.z < 46 && s.y > 13 && s.y < 15.5, "cargo: A400M-class 45 x 42.4 x 14.7 envelope");
}
console.log(fails ? `\n${fails} FAIL` : "\nall ok");
process.exit(fails ? 1 : 0);
