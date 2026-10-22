#!/usr/bin/env node
// tools/mil-air-check.mjs — plain-node check of what city/mil_air.js still
// is (the airframe KIT and the runtime calls the city makes on a flying
// military airframe) and of the airframes Gang City flies: NPC War's units
// (src/units/vehicles/*.js) as city/island_military.js builds them
// (CBZ.milModels / unitBuild), plus strategic.js's B-2. No browser.
//   · every kit primitive winds OUTWARD (positive signed volume), mirrored too
//   · each airframe: the record contract (footW = span, footL = length,
//     colliderW/L the body, aircraftDims, rig, the battle-shaped hull record),
//     measured size against its published dims, wheels on y = 0
//   · milAirDrive runs the unit's own animate (a rotorcraft's rotors turn),
//     milAirAim / milAirPoint / milAirFire on the Apache's chin gun and rails
//   · a second placement shares geometry
// Run: node tools/mil-air-check.mjs
import { sandbox, census } from "./lib/units-sandbox.mjs";

const { CBZ, THREE, errors } = sandbox({ strategic: true });
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log("FAIL " + m); } else console.log("ok   " + m); };
for (const f in errors) console.log("     (load) " + f + ": " + errors[f]);
ok(!errors["src/city/mil_air.js"] && !errors["src/city/island_military.js"], "mil_air.js and island_military.js load");

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
ok(!CBZ.milAir.make && !CBZ.milAir.define, "no generic airframe templates left in mil_air.js (the units are the airframes)");

// ---- 2. the airframes: the units, as the city builds them ----------------
// the drawn size, visible meshes only (a stowed rope or a hidden crewman is not the airframe)
function seen(g) {
  g.updateMatrixWorld(true);
  const b = new THREE.Box3();
  g.traverseVisible((o) => {
    if (!o.isMesh || o.isInstancedMesh || !o.geometry || !o.geometry.attributes.position) return;
    o.geometry.computeBoundingBox();
    b.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld));
  });
  return b;
}
function pose(g) { const out = []; g.traverse((o) => out.push(o.quaternion.x, o.quaternion.y, o.quaternion.z, o.quaternion.w)); return out; }
const MM = CBZ.milModels;
ok(MM && Object.keys(MM).length === 13 && typeof MM.load === "function" && Object.keys(MM).indexOf("load") < 0,
  "CBZ.milModels: 13 model kinds, load() off the enumeration");
const AIR = { jet: "f35", attackHeli: "ah64_apache", heli: "uh60_black_hawk", drone: "mq9_reaper", bomber: "b52", cargo: "a400m" };
for (const k of Object.keys(AIR)) {
  ok(MM.unitOf(k) === AIR[k], `milModels.${k} is the ${AIR[k]} unit`);
  const r = MM[k](), g = r && r.group;
  ok(!!g, `milModels.${k} builds`);
  if (!g) continue;
  const D = r.aircraftDims, b = seen(g), s = b.getSize(new THREE.Vector3()), c = census(THREE, g);
  console.log(`---- ${k} = ${r.name} (${D ? D.family : "?"} ${D ? D.length + " x " + D.span : ""}): drawn L ${s.z.toFixed(2)} W ${s.x.toFixed(2)} H ${s.y.toFixed(2)} · ${c.meshes} draws · ${c.tris} tris`);
  ok(D && r.footW === D.span && r.footL === D.length && r.height > 0, `${k}: boards by its span and length (${r.footW} x ${r.footL})`);
  ok(r.colliderW > 0 && r.colliderL > 0 && r.colliderW <= r.footW, `${k}: its solid is the body (${r.colliderW} x ${r.colliderL})`);
  ok(Math.abs(s.z - D.length) / D.length < 0.1 && Math.abs(s.x - D.span) / D.span < 0.12, `${k}: drawn size within 10% of ${D.length} x ${D.span}`);
  ok(b.min.y > -0.3 && b.min.y < 0.3, `${k}: stands on y = 0 (min ${b.min.y.toFixed(2)})`);
  ok(g.userData.unitId === AIR[k] && typeof g.userData.unitDrive === "function" && r.veh && r.veh.seats.length > 0 || AIR[k] === "mq9_reaper",
    `${k}: userData.unitId + unitDrive + the battle-shaped hull record`);
  ok(Array.isArray(g.userData.crewSeats), `${k}: crewSeats (the air response seats its crew in them)`);
  // fly it a second: the unit's own animate, off what the flight is doing
  const p0 = pose(g);
  let drove = true;
  for (let i = 0; i < 30; i++) { g.rotation.y += 0.004; drove = CBZ.milAirDrive(g, { thr: 1, agl: 140, speed: 60, vy: 0 }, 1 / 30) && drove; }
  const p1 = pose(g);
  let moved = 0; for (let i = 0; i < p0.length; i++) if (Math.abs(p0[i] - p1[i]) > 1e-4) moved++;
  ok(drove && !r.veh._animErr, `${k}: milAirDrive runs the unit's animate (${moved} pose values moved)`);
  if (g.userData.rotorcraft) ok(moved > 0, `${k}: the rotors turn in flight`);
  const r2 = MM[k](), c2 = census(THREE, r2.group);
  let shared = 0; c2.geos.forEach((x) => { if (c.geos.has(x)) shared++; });
  ok(shared >= c2.geos.size * 0.5, `${k}: a second placement shares ${shared}/${c2.geos.size} geometries`);
  if (k === "attackHeli") {
    g.position.set(0, 0, 0); g.rotation.set(0, 0, 0); g.updateMatrixWorld(true);
    const p = CBZ.milAirPoint(g, "gun", 0);
    ok(p && p.z > 4 && p.y < 2.2, `attackHeli: chin-gun muzzle under the nose (${p && p.toArray().map((v) => v.toFixed(2))})`);
    ok(CBZ.milAirAim(g, 0, 0, 40, 1 / 30), "attackHeli: chin turret slews (milAirAim)");
    const rail = CBZ.milAirPoint(g, "rail", 0);
    ok(rail && Math.abs(rail.x) > 1, `attackHeli: a Hellfire rail out on a stub wing (${rail && rail.toArray().map((v) => v.toFixed(2))})`);
    const S = r.rig && r.rig.state, n0 = S ? S.hfShot : -1;
    ok(CBZ.milAirFire(g, "rail", 0) && S && S.hfShot === n0 + 1, "attackHeli: milAirFire takes the round off its rail");
  }
}

// ---- 3. THE B-2 (city/strategic.js CBZ.strategicModels.b2: the b2_spirit
// unit, adapted to the handles strategic.js and its sorties drive) ---------
if (CBZ.strategicModels && CBZ.strategicModels.b2) {
  const m = CBZ.strategicModels.b2(), g = m && m.group;
  ok(!!g && g.userData.unitId === "b2_spirit", "b2 is the units/vehicles B-2A (b2_spirit)");
  if (g) {
    g.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(g), sz = bb.getSize(new THREE.Vector3());
    ok(sz.x > 52.0 && sz.x < 53.0, `b2 span ${sz.x.toFixed(2)} in 52,53`);
    ok(Math.abs(bb.min.y) < 0.05, `b2 stands on its wheels (min ${bb.min.y.toFixed(3)})`);
    ok(m.dims && m.dims.span > 52 && m.dims.length > 20, "b2 dims {span, length, height} for the pad and the war room");
    const ud = g.userData;
    ok(typeof ud.setGear === "function" && typeof ud.setBay === "function", "b2 setGear / setBay handles");
    ud.setBay(1); ok(ud.bayOpen === 1, "b2 setBay records bayOpen");
    ud.setBay(0); ud.setGear(0); ok(ud.gearDown === 0, "b2 setGear records gearDown"); ud.setGear(1);
    ok(ud.bayLocal && ud.bayLocal.y > 0.3 && ud.bayLocal.y < 2.5, `b2 release point under the launcher (${ud.bayLocal && ud.bayLocal.toArray().map((v) => v.toFixed(2))})`);
    const S = ud.rig && ud.rig.state, n0 = S ? S.bays[0].next + S.bays[1].next : -1;
    ud.b2Spend();
    ok(S && S.bays[0].next + S.bays[1].next === n0 + 1, "b2Spend takes one weapon off a launcher");
    ok(ud.cockpitClass === "bomber" && ud.bombBay === true, "b2 bomber cockpit class + bomb bay flag");
  }
} else {
  ok(false, "strategic.js publishes CBZ.strategicModels.b2" + (errors["src/city/strategic.js"] ? " — " + errors["src/city/strategic.js"] : ""));
}
console.log(fails ? `\n${fails} FAIL` : "\nall ok");
process.exit(fails ? 1 : 0);
