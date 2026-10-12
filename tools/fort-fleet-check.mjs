#!/usr/bin/env node
/* tools/fort-fleet-check.mjs — FORT BRANDT PARKS NPC WAR'S UNITS, AND YOU
   CAN STEAL THEM. Plain node, no browser (replaces mil-armor-check.mjs: the
   generic hulls it measured are deleted; the units have their own checks in
   units-kit-check / npcwar-check, this is the city's half).

     STANDS   every basekit stand kind maps to a real unit; the fleet does NOT
              load while the player is far from the wire, loads through
              CBZ.army.loadUnits when he comes within 900 m, then parks one
              hull a frame; every non-scenery stand becomes a registered,
              stealable record (rec.stand, the militaryvehicles taxonomy)
     HOLD     the A400M's ramp rides a pivot whose closed angle is exactly the
              unit's own closed ramp, and the hold is declared
     DRIVE    city/militaryvehicles.js drives the parked M1A2 on its own
              numbers and animate, lays its turret, fires the 120 mm from the
              rig's muzzle down the bore; a Bradley bursts its 25 mm; the
              HIMARS lays and ripples onto a map point; the Patriot emplaces
              and launches over its tail from the next loaded cell
   Usage: node tools/fort-fleet-check.mjs        Exit 0 = all pass. */
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { sandbox, ROOT } from "./lib/units-sandbox.mjs";

const { G, CBZ, THREE, errors } = sandbox();
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log("FAIL " + m); } else console.log("ok   " + m); };
for (const f in errors) console.log("     (load) " + f + ": " + errors[f]);

// ---- a city that is just enough for the base and the theft path ----------
const landmasses = [];
CBZ.addLandmass = (fn) => landmasses.push(fn);
CBZ.registerCityRegion = () => {};
CBZ.game = { mode: "city", state: "playing", wanted: 0 };
CBZ.player = { pos: new THREE.Vector3(5000, 0, 5000), vy: 0, dead: false };
CBZ.keys = {};
CBZ.cam = { yaw: Math.PI, pitch: 0.46 };
CBZ.CAM_DEFAULT_PITCH = 0.46;
const asked = [];
CBZ.army = { loadUnits: (ids) => { asked.push(ids.slice()); return Promise.resolve(ids.filter((id) => CBZ.unitKit.has(id))); } };
let holdSpec = null;
CBZ.vehicleHold = (rec, spec) => { holdSpec = spec; return { inert: false }; };
const fired = { missile: [], at: [] };
CBZ.cityFireMissile = (x, y, z, dx, dy, dz) => { fired.missile.push({ x, y, z, dx, dy, dz }); return true; };
CBZ.cityFireMissileAt = (x, y, z, t) => { fired.at.push({ x, y, z, t }); return true; };
let waypoint = null;
CBZ.fullMap = { waypoint: () => waypoint, open() {} };
CBZ.detonate = () => {}; CBZ.tracer = () => {}; CBZ.rayColliders = () => null;
// the island first (it loads before militaryvehicles.js on index.html), then the bridge
vm.runInContext(readFileSync(path.join(ROOT, "src/city/island_military.js"), "utf8"), G, { filename: "island_military.js" });
vm.runInContext(readFileSync(path.join(ROOT, "src/city/militaryvehicles.js"), "utf8"), G, { filename: "militaryvehicles.js" });
const root = new THREE.Group();
let built = false;
try { for (const fn of landmasses) fn({ root: root, roads: [] }); built = true; } catch (e) { console.log("     " + String(e.stack).split("\n").slice(0, 3).join(" | ")); }
ok(built, "the base's landmass builds in node");
const tick = (order, dt) => { for (const u of CBZ.updaters) if (u.order === order) u.fn(dt); };
const flush = () => new Promise((r) => setTimeout(r, 0));

// ---- STANDS ---------------------------------------------------------------
const B = CBZ._militaryBase, F = CBZ.fortBrandtFleet;
ok(!!B && !!F, "CBZ._militaryBase and CBZ.fortBrandtFleet published");
for (let i = 0; i < 20; i++) tick(55.1, 0.1);
await flush();
ok(asked.length === 0 && F.state() === "idle" && CBZ.cityMilitaryVehicles.length === 0, "far from the wire: nothing loads, nothing is built");
// walk to 600 m off the east wire
CBZ.player.pos.set(B.maxX + 600, 0, (B.minZ + B.maxZ) / 2);
for (let i = 0; i < 3; i++) tick(55.1, 0.6);
await flush();
ok(asked.length === 1, "inside 900 m: the fleet's units are asked for once (" + (asked[0] || []).join(" ") + ")");
for (let i = 0; i < 80 && F.state() !== "ready"; i++) { tick(55.1, 1 / 60); await flush(); }
ok(F.state() === "ready", "every hull parked (one a frame)");
const recs = CBZ.cityMilitaryVehicles;
const plan = B.plan, stands = plan.stands.filter((s) => s.kind !== "b2");
const want = stands.filter((s) => !s.scenery).length;
ok(recs.length === want && B.boardable === want, `every non-scenery stand is a stealable record (${recs.length}/${want})`);
const byKind = {};
for (const r of recs) (byKind[r.stand.kind] = byKind[r.stand.kind] || new Set()).add(r.unitId);
const EXPECT = { tank: ["m1_abrams"], ifv: ["bradley_ifv"], apc: ["stryker_apc"], luv: ["hmmwv", "jltv", "maxxpro_mrap"], truck: ["fmtv", "m35_truck"],
  mlrs: ["m270_mlrs"], patriot: ["patriot_launcher"], fighter: ["f35"], attackHeli: ["ah64_apache"], heli: ["uh60_black_hawk"], bomber: ["b52"], cargo: ["a400m"] };
for (const k in EXPECT) ok(byKind[k] && [...byKind[k]].every((id) => EXPECT[k].indexOf(id) >= 0), `${k} stands carry ${[...(byKind[k] || [])].join(", ")}`);
const TAX = { m1_abrams: "tank", patriot_launcher: "patriot", m270_mlrs: "mlrs", f35: "plane", b52: "plane", a400m: "plane", ah64_apache: "heli", uh60_black_hawk: "heli" };
ok(recs.every((r) => r.kind === (TAX[r.unitId] || "ground")), "records carry the militaryvehicles taxonomy (tank / ground / patriot / mlrs / heli / plane)");
ok(recs.every((r) => r.group.parent === root && Math.abs(r.pos.x - (plan.stands.find((s) => s === r.stand) ? B.center.x + r.stand.x : 0)) < 0.01),
  "each hull stands on its stand");
ok(recs.every((r) => r.model.name === CBZ.unitKit.meta(r.unitId).name), "each is called by its real name (" + [...new Set(recs.map((r) => r.model.name))].join(", ") + ")");
ok(recs.filter((r) => r.unitId !== "a400m").every((r) => r.collider && CBZ.colliders.indexOf(r.collider) >= 0), "every parked hull but the Atlas is solid");
ok(recs.filter((r) => r.kind === "heli").every((r) => r.group.userData.rotorcraft), "helicopters fly on the stolen-aircraft path (rotorcraft)");
ok(recs.some((r) => r.attackHeli), "the attack helicopter stands are flagged for the gunship response");

// ---- HOLD -----------------------------------------------------------------
const atlas = recs.find((r) => r.unitId === "a400m");
ok(!!(atlas && atlas.cargoLifter && atlas.armed === false && atlas.airClass === "airliner" && holdSpec), "the A400M is the cargo lifter, its hold declared");
if (atlas && holdSpec && holdSpec.ramp) {
  const R = holdSpec.ramp, ramp = atlas.unit.rig.state.nodes.ramp;
  // closed: the ramp's world pose is the unit's own (the pivot only re-zeroes it)
  const fresh = CBZ.milModels.build("a400m"), r0 = fresh.rig.state.nodes.ramp;
  fresh.group.updateMatrixWorld(true); atlas.group.updateMatrixWorld(true);
  const a = new THREE.Vector3(0, 0, -5).applyMatrix4(r0.matrixWorld).sub(fresh.group.position);
  R.node.rotation.x = R.closedRx; atlas.group.updateMatrixWorld(true);
  const b = new THREE.Vector3(0, 0, -5).applyMatrix4(ramp.matrixWorld).sub(atlas.group.position);
  ok(a.distanceTo(b) < 0.02, `the ramp's closed angle is the unit's closed ramp (${a.distanceTo(b).toFixed(3)} m apart)`);
  R.node.rotation.x = R.openRx; atlas.group.updateMatrixWorld(true);
  const toe = new THREE.Vector3(0, 0, -R.len).applyMatrix4(R.node.matrixWorld);
  ok(toe.y > -0.4 && toe.y < 0.5, `open, its toe is on the tarmac (${toe.y.toFixed(2)} m)`);
  R.node.rotation.x = R.closedRx;
  ok(holdSpec.floor.w === 4 && Math.abs(holdSpec.floor.top - 1.55) < 0.01, "the hold floor is the Atlas's (4.0 m wide, 1.55 m up)");
}

// ---- DRIVE ----------------------------------------------------------------
const tank = recs.find((r) => r.unitId === "m1_abrams");
const P = CBZ.player;
P.pos.copy(tank.pos);
ok(CBZ.cityDriveArmor(tank) && CBZ.cityArmorActive(), "the M1A2 takes a driver");
ok(!CBZ.colliders.includes(tank.collider), "its parked solid leaves with it");
const x0 = tank.pos.z;
CBZ.keys.w = true;
for (let i = 0; i < 180; i++) tick(11.6, 1 / 60);
CBZ.keys.w = false;
const S = CBZ.unitKit.get("m1_abrams").stats;
ok(tank.pos.z - x0 > 1 && tank.v > 0.5 && tank.v <= S.speed, `three seconds of throttle: ${(tank.pos.z - x0).toFixed(1)} m, ${tank.v.toFixed(1)} m/s (top ${S.speed})`);
ok(!tank.unit.veh._animErr, "its own animate ran every frame");
const crew = tank.unit.veh.seats.filter((s) => s.crew && s.implicit).length;
ok(crew > 0, `the crew are at their posts while you drive (${crew})`);
// lay the gun 90 degrees right of the hull and fire
CBZ.cam.yaw = tank.heading + Math.PI - Math.PI / 2;
for (let i = 0; i < 240; i++) tick(11.6, 1 / 60);
const n0 = fired.missile.length;
ok(CBZ.cityArmorFire() && fired.missile.length === n0 + 1, "the 120 mm fires through cityFireMissile");
const shot = fired.missile[fired.missile.length - 1];
const side = Math.sin(tank.heading - Math.PI / 2) * shot.dx + Math.cos(tank.heading - Math.PI / 2) * shot.dz;
ok(side > 0.9, `down the bore, where the turret is laid (${side.toFixed(2)})`);
ok(Math.hypot(shot.x - tank.pos.x, shot.z - tank.pos.z) > 3.5 && shot.y > 1.5, `from the muzzle (${Math.hypot(shot.x - tank.pos.x, shot.z - tank.pos.z).toFixed(1)} m out, ${shot.y.toFixed(1)} m up)`);
ok(!CBZ.cityArmorFire(), "the loader's rate holds the next round (" + (1 / CBZ.unitKit.get("m1_abrams").weapons[0].rof).toFixed(1) + " s)");
CBZ.cityExitArmor();
ok(!CBZ.cityArmorActive() && CBZ.colliders.includes(tank.collider), "out: the hull is solid again where it stands");

const ifv = recs.find((r) => r.unitId === "bradley_ifv");
P.pos.copy(ifv.pos);
CBZ.cityDriveArmor(ifv);
CBZ.cam.yaw = ifv.heading + Math.PI;
for (let i = 0; i < 60; i++) tick(11.6, 1 / 60);
let tracers = 0; CBZ.tracer = () => { tracers++; };
ok(CBZ.cityArmorFire(), "the Bradley's 25 mm takes a burst");
for (let i = 0; i < 90; i++) tick(11.6, 1 / 60);
const m242 = CBZ.unitKit.get("bradley_ifv").weapons.find((w) => w.kind === "autocannon");
ok(tracers === Math.min(m242.burst || 6, 6) || tracers === (m242.burst || 6), `one burst of the M242's own length (${tracers} rounds)`);
CBZ.cityExitArmor();

const himars = recs.find((r) => r.unitId === "m270_mlrs");
P.pos.copy(himars.pos);
CBZ.cityDriveArmor(himars);
waypoint = { x: himars.pos.x + Math.sin(himars.heading) * 900, z: himars.pos.z + Math.cos(himars.heading) * 900 };
let laid = false;
for (let i = 0; i < 1200 && !laid; i++) { tick(11.6, 1 / 30); laid = himars.unit.rig.laid; }
ok(laid, "the HIMARS lays its pod on the map point");
const a0 = fired.at.length;
ok(CBZ.cityArmorFire(), "the ripple starts");
for (let i = 0; i < 60 * 40; i++) tick(11.6, 1 / 30);
ok(fired.at.length - a0 === 6 && himars.unit.rig.left === 0, `the pod rippled its six GMLRS (${fired.at.length - a0}), the tubes are empty`);
ok(fired.at.slice(a0).every((s) => Math.hypot(s.t.x - waypoint.x, s.t.z - waypoint.z) < 40), "every round onto the point");
CBZ.cityExitArmor();

const pat = recs.find((r) => r.unitId === "patriot_launcher");
P.pos.copy(pat.pos);
CBZ.cityDriveArmor(pat);
// the mark behind the launcher: it fires over its tail
waypoint = { x: pat.pos.x - Math.sin(pat.heading) * 3000, z: pat.pos.z - Math.cos(pat.heading) * 3000 };
let up = false;
for (let i = 0; i < 60 * 60 && !up; i++) { tick(11.6, 1 / 30); up = pat.unit.rig.ready && pat.unit.rig.ready(); }
ok(up, "standing still, the crew emplaces it and raises the launcher onto the mark");
const p0 = fired.at.length, left0 = pat.unit.rig.left;
ok(CBZ.cityArmorFire() && fired.at.length === p0 + 1 && pat.unit.rig.left === left0 - 1, `a PAC-3 MSE leaves its cell (${left0} -> ${pat.unit.rig.left})`);
CBZ.cityExitArmor();
const audit = CBZ.cityPatriotAudit();
ok(audit.trucks === 2 && audit.tubes === 24 && audit.visibleRounds === 23, `the Patriot audit counts the units' cells (${JSON.stringify({ trucks: audit.trucks, tubes: audit.tubes, rounds: audit.visibleRounds })})`);

console.log(fails ? `\n${fails} FAIL` : "\nall pass");
process.exit(fails ? 1 : 0);
