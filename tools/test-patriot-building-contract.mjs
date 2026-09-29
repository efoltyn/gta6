#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (p) => readFile(path.join(root, p), "utf8");
const [config, crash, island, aircraft, armor, map, touch, html, bld, glow] = await Promise.all([
  read("src/config.js"), read("src/city/crashfx.js"), read("src/city/island_military.js"),
  read("src/city/aircraft.js"), read("src/city/militaryvehicles.js"),
  read("src/systems/fullmap.js"), read("src/systems/touch_vehicle.js"), read("index.html"),
  read("src/city/buildings.js"), read("src/city/interiorlight.js"),
]);
const crashfx = crash;

function section(source, start, end) {
  const a = source.indexOf(start); assert.notEqual(a, -1, `missing ${start}`);
  const b = source.indexOf(end, a + start.length); assert.notEqual(b, -1, `missing ${end}`);
  return source.slice(a, b);
}

assert.match(config, /PATRIOT_V1[^\n]*= true/);

// The invented ruin frame (jagged slab teeth over a machined rectangle) is gone:
// the ragged rim is the wall's own surviving pieces (CBZ.debris keepEdge).
assert.doesNotMatch(crash, /function reinforcedRuinFrame|jaggedSlabGeo/,
  "no invented concrete teeth around an opening");
assert.match(crash, /CBZ\.cityRuinAudit/);

// The launcher truck is city/mil_armor.js's: the canonical 6x6 chassis, a
// yaw → elevation launcher rig, one muzzle node per canister.
const armorKit = await read("src/city/mil_armor.js");
const patriot = section(armorKit, "function buildPatriot", "// ============================================================ THE LUV");
assert.match(patriot, /truckChassis\(K, \{\}\)/, "Patriot must ride the canonical truck chassis");
assert.match(patriot, /launcherRig\(S,/, "canisters sit on the shared yaw/elevation launcher rig");
assert.match(patriot, /m\.name = "lm" \+ i/, "one authored muzzle node per canister");
assert.match(armorKit, /hide\(ud, "patriotMuzzles", rig\.muzzles\)/);
assert.match(island, /patriot: makePatriot/);
assert.match(island, /\[makePatriot, "patriot", /);

const pointFire = section(aircraft, "CBZ.cityFireMissileAt = function", "CBZ.cityPatriotMissileAudit");
assert.match(pointFire, /launchMissile\(/,
  "map-targeted round must use the shared pooled launcher");
assert.match(pointFire, /m\.route =/);
assert.doesNotMatch(pointFire, /new THREE\.(Group|Mesh)/,
  "point-targeting API must not create a parallel projectile model");
const update = section(aircraft, "function updateMissiles", "// cheap building check");
assert.match(update, /if \(m\.route\)/);
assert.match(update, /detonate\(hx, hy, hz, m\.byPlayer, m\.fx, m\.type\)/,
  "Patriot route must terminate in the canonical pooled detonation, carrying its own warhead identity");
// THE OWNER NAMED THE CLOUD. A Patriot spends the bus's rpg row, not the heavy
// missile row whose additive fireball whites out the building it just hit.
assert.match(pointFire, /m\.fx = \{ kind: opts\.fxKind \|\| "rpg"/,
  "the map-targeted round must carry the rpg warhead identity");
assert.match(aircraft, /const row = ROUND_ROW\[type\] \|\| "missile";[\s\S]*?CBZ\.detonate\(x, y, z, row, o\)/,
  "each round spends its own warhead row (charge), fx names only the look");

const fire = section(armor, "function firePatriot", "CBZ.cityPatriotAudit");
assert.match(fire, /fullMap/);
assert.match(fire, /rig\.launcherMuzzle\(slot, _patriotMuzzle\)/,
  "launch must leave the authored tube transform");
assert.match(fire, /cityFireMissileAt/);
assert.match(armor, /CBZ\.cityArmorCanFire/);

const setWp = section(map, "function setWaypoint", "map.setWaypoint = setWaypoint");
assert.match(setWp, /fireControl \? \{ x: x, z: z/,
  "fire-control crosshair must not snap to a POI door");
assert.match(map, /PATRIOT FIRE CONTROL/);
assert.match(map, /CBZ\.cityArmorFire/);
assert.match(html, /id="fullMapLaunch"/);
assert.match(touch, /isArmedArmor/);
assert.match(touch, /r\.kind === "patriot"/);

// Curve contract: it starts/ends exactly on authored transforms and climbs
// above both. This mirrors the zero-allocation scalar math in aircraft.js.
const p0 = { x: -20, y: 4, z: 10 }, p3 = { x: 180, y: 18, z: -90 };
const dx = p3.x - p0.x, dz = p3.z - p0.z, d = Math.hypot(dx, dz), ux = dx / d, uz = dz / d;
const rise = Math.max(34, Math.min(105, 22 + d * 0.16)), apex = Math.max(p0.y, p3.y) + rise;
const approach = Math.min(48, Math.max(14, d * 0.22));
const p1 = { x: p0.x + ux * Math.min(10, d * 0.06), y: apex, z: p0.z + uz * Math.min(10, d * 0.06) };
const p2 = { x: p3.x - ux * approach, y: apex - rise * 0.08, z: p3.z - uz * approach };
function cubic(a, b, c, d0, u, key) {
  const v = 1 - u; return v * v * v * a[key] + 3 * v * v * u * b[key] + 3 * v * u * u * c[key] + u * u * u * d0[key];
}
for (const key of ["x", "y", "z"]) {
  assert.equal(cubic(p0, p1, p2, p3, 0, key), p0[key]);
  assert.equal(cubic(p0, p1, p2, p3, 1, key), p3[key]);
}
assert.ok(cubic(p0, p1, p2, p3, 0.5, "y") > Math.max(p0.y, p3.y) + 20);

// ---- A CURTAIN WALL IS AN ASSEMBLY, NOT A BOX ----------------------------
// The whole reason a missile could not scratch a glass office: carveHole's
// eligibility loop. Guard the three moving parts of the fix so a future tidy-up
// cannot quietly restore the refusal.
const carve = section(bld, "function carveHole(x, y, z, r, opts)", "CBZ.cityCarveWall = carveHole;");
assert.doesNotMatch(carve, /curtainBreachOn/,
  "a short facade course of a real shell is always admitted (the revert flag is gone)");
assert.match(carve, /CBZ\.blastLaw\.isProp\(c, !band\.derived\)/,
  "a prop-sized band-less collider is never a wall (the one law, systems/breach.js)");
assert.match(carve, /lawHole = L\.hole\(charge\.W,/,
  "a charged carve is priced by the charge law, not a per-caller radius");
assert.match(carve, /const shell = shellOf\(c\);/,
  "a course is only a course if it belongs to a real shell");
assert.match(carve, /const vy0 = curtain \? sy0 : y0, vy1 = curtain \? sy1 : y1;/,
  "the opening must span the STOREY, not the 0.55m course the rocket struck");
assert.match(carve, /cutCourseMesh\(o, oU0, oU1, keepL, keepR\);/,
  "a clipped full-width course must lose its picture across the hole too");
assert.match(carve, /CBZ\.cityInteriorGlowClearBox/,
  "the fake-interior panel must not be left standing in the breach");
assert.match(bld, /bgroup\.userData\.bld = built;/,
  "a collider must be able to name its shell in one hop");
assert.match(bld, /CBZ\.cityFacadeBreachAudit = function/);
assert.match(glow, /CBZ\.cityInteriorGlowClearBox = function/);
// A hit that lands mid-glass must still height-test against the storey.
assert.match(carve, /if \(cy1 - cy0 >= 1\.6 && \(y < cy0 - 0\.3 \|\| y > cy1 \+ 0\.3\)\) continue;/,
  "the full-height containment test must not veto a course before the storey band exists");

// ---- ALL DEBRIS COMES OFF SOMETHING --------------------------------------
// The law: a fragment is a cell of a solid the carve is removing, carrying that
// solid's own material. These guard the three ways it could quietly rot back
// into a spawner: the primitive losing its source material, the carve stopping
// feeding it, or the invented spawners being let back onto the conserved path.
assert.match(config, /DEBRIS_CONSERVED_V1[^\n]*= true/);
assert.match(crashfx, /CBZ\.cityShedSolid = function \(box, mat, o\)/,
  "the shed primitive takes the SOURCE MATERIAL, not a debris palette");
assert.doesNotMatch(crashfx, /BoxGeometry\(0\.28|cubeGeo\(|rubbleGeo|chunks\.push/,
  "crashfx keeps no box-debris pool: every piece comes from CBZ.debris");
assert.match(crashfx, /CBZ\.debris\.shatterBox\(box, mat, \{/,
  "the shed primitive is a shim onto the one fracture path, with the source material");
assert.match(crashfx, /CBZ\.cityDebrisAudit = function/);
const shed = section(bld, "if (CBZ.debris && rec.shed.length)", "if (CBZ.cityInteriorGlowClearBox)");
assert.match(shed, /CBZ\.debris\.shatterBox\(b, skinMat \|\| b\.mat, \{/,
  "the carve must hand over each removed solid with its own material");
assert.match(shed, /keepEdge:/, "the rim of surviving wall stays welded (a broken edge, not a saw cut)");
assert.match(bld, /shedBox\(Math\.max\(minU, u0\), Math\.min\(maxU, u1\)/,
  "the struck course sheds the part of itself inside the opening");
assert.match(bld, /mat: gm, glass: true,/,
  "a removed pane sheds as its own glass, not as more masonry");
assert.match(bld, /if \(b\.debrisKey && CBZ\.debris\) CBZ\.debris\.clear\(b\.debrisKey\);/,
  "a reset hole takes its own welded rim and rubble with it");
console.log("PASS building/Patriot contract: curtain-wall breach, storey-tall opening, cut courses, no fake interior in the hole, conserved debris (nothing invented), rpg-row warhead, shared missile pool, exact map target, tube transforms, touch launch");
