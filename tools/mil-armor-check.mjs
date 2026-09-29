#!/usr/bin/env node
/* tools/mil-armor-check.mjs — IS THE ARMOR THE SIZE OF THE REAL THING?

   Plain node, no browser. Loads the vendored THREE r128 and city/mil_armor.js
   into a vm with a stub CBZ, builds every ground vehicle, and measures the
   geometry that was actually built (bounding boxes of the drawn meshes, not the
   numbers the builder claims) against reference numbers:

     MBT      M1A2 / Leopard 2 class: hull 7.93 x 3.66 m, turret roof 2.44,
              120 mm L/44 tube 5.28 m, 0.635 m track, 7 road wheels a side,
              gun-forward length ≈ 9.8 m, fits the cargo hold (≤ 3.0 m tall)
     IFV      Bradley / CV90: 6.55 x 3.28 m, ≤ 3.0 m, 6 road wheels
     APC      8x8: 6.95 x 2.72 m, ≤ 2.7 m, 8 wheels
     TRUCK    6x6: 7.95 x 2.50 m, canvas 3.22 m, 6 wheels of 1.14 m
     LUV      HMMWV: 4.57 x 2.16 m, roof 1.83, 3.30 m wheelbase, 1.81 m track
     MLRS     6x6 + one 6-round pod        PATRIOT  6x6 + 4 canisters

   Also: everything stands on y=0 (tyres / track shoes touch the ground), no
   NaN anywhere, templates are shared by clones (geometry identity), a driven
   rig moves its tracks and wheels without moving a parked sibling's, clone()
   of a placed vehicle does not throw, and the mesh count per vehicle.

   Usage: node tools/mil-armor-check.mjs [--json]     Exit 0 = all pass. */
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ctx = { console, Math, Float32Array, Uint16Array, Uint32Array, Map, Set, Object, Array, JSON };
ctx.window = ctx; ctx.self = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, "src/vendor/three.r128.min.js"), "utf8"), ctx);
const T = ctx.THREE;
const updaters = [];
ctx.CBZ = {
  cmat: (hex) => new T.MeshLambertMaterial({ color: hex }),
  onUpdate: (o, fn) => updaters.push(fn),
};
vm.runInContext(fs.readFileSync(path.join(ROOT, "src/city/mil_armor.js"), "utf8"), ctx);
const A = ctx.CBZ.milArmor;
if (!A) { console.error("CBZ.milArmor not published"); process.exit(1); }

let fails = 0;
const rows = [];
function check(name, ok, got, want) {
  rows.push({ name, ok, got, want });
  if (!ok) fails++;
}
const near = (v, ref, tol) => Math.abs(v - ref) <= tol;
const r2 = (v) => Math.round(v * 100) / 100;

function boxOf(root, filter) {
  root.updateMatrixWorld(true);
  const b = new T.Box3(), tmp = new T.Box3(), m = new T.Matrix4(), mw = new T.Matrix4();
  root.traverse((o) => {
    if (!o.isMesh || (filter && !filter(o))) return;
    const g = o.geometry;
    const pos = g.attributes.position;
    const per = new T.Box3().setFromBufferAttribute(pos);
    if (o.isInstancedMesh) {
      for (let i = 0; i < o.count; i++) {
        o.getMatrixAt(i, m);
        if (m.elements[0] === 0 && m.elements[5] === 0) continue;
        mw.multiplyMatrices(o.matrixWorld, m);
        tmp.copy(per).applyMatrix4(mw); b.union(tmp);
      }
    } else { tmp.copy(per).applyMatrix4(o.matrixWorld); b.union(tmp); }
  });
  return b;
}
function nanFree(root) {
  let ok = true;
  root.traverse((o) => {
    if (!o.isMesh) return;
    const a = o.geometry.attributes.position.array;
    for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) { ok = false; break; }
    if (o.isInstancedMesh) { const m = o.instanceMatrix.array; for (let i = 0; i < m.length; i++) if (!Number.isFinite(m[i])) { ok = false; break; } }
  });
  return ok;
}
function meshCount(root) { let n = 0; root.traverse((o) => { if (o.isMesh) n++; }); return n; }
const notGun = (o) => { let p = o; while (p) { if (p.name === "gun" || p.name === "launchYaw") return false; p = p.parent; } return true; };

const REF = {
  tank: { L: 7.93, W: 3.66, H: [2.40, 2.98], tolL: 0.08, tolW: 0.08, wheels: 14 },
  ifv: { L: 6.55, W: 3.28, H: [2.60, 3.0], tolL: 0.1, tolW: 0.08, wheels: 12 },
  apc: { L: 6.95, W: 2.72, H: [2.40, 2.72], tolL: 0.1, tolW: 0.12 },
  truck: { L: 7.95, W: 2.50, H: [3.10, 3.30], tolL: 0.25, tolW: 0.1 },
  luv: { L: 4.57, W: 2.16, H: [1.80, 2.50], tolL: 0.1, tolW: 0.05 },
  mlrs: { L: 7.95, W: 2.50, H: [2.80, 3.30], tolL: 0.25, tolW: 0.1 },
  patriot: { L: 7.95, W: 2.50, H: [3.6, 4.0], tolL: 1.2, tolW: 0.1 },
};

const made = {
  tank: A.tank(), ifv: A.ifv(), apc: A.apc(), truck: A.truck({}), luv: A.luv(), mlrs: A.mlrs(), patriot: A.patriot(),
};
for (const k of Object.keys(made)) {
  const rec = made[k], g = rec.group, R = REF[k];
  // body length/width: the main paint + the running gear (no whips, mirrors,
  // shackles or muzzle — the reference numbers exclude them too)
  const bb = boxOf(g, (o) => notGun(o) && (o.isInstancedMesh || (o.material && o.material.color && [0x4a5238, 0x646b4b].includes(o.material.color.getHex()))));
  const L = bb.max.z - bb.min.z, W = bb.max.x - bb.min.x, H = boxOf(g).max.y;
  check(`${k} length`, near(L, R.L, R.tolL), r2(L), R.L);
  check(`${k} width`, near(W, R.W, R.tolW), r2(W), R.W);
  check(`${k} height`, H >= R.H[0] && H <= R.H[1], r2(H), R.H.join("..."));
  check(`${k} stands on y=0`, near(boxOf(g).min.y, 0, 0.03), r2(boxOf(g).min.y), 0);
  check(`${k} no NaN`, nanFree(g), true, true);
  check(`${k} record`, rec.footW > 0 && rec.footL > 0 && rec.height > 0, `${rec.footW}x${rec.footL}x${rec.height}`, "footW/footL/height");
  check(`${k} rig`, !!(g.userData.rig), !!g.userData.rig, true);
  rows.push({ name: `${k} meshes`, ok: true, got: meshCount(g), want: "(draw calls)" });
}

// ---- MBT specifics
{
  const g = made.tank.group, rig = g.userData.rig, sp = rig.spec;
  check("tank barrel length (5.28 m L/44)", near(sp.dims.barrel, 5.28, 0.01), sp.dims.barrel, 5.28);
  const tubeBox = boxOf(g, (o) => o.name === "tube-steel");
  check("tank drawn tube length", near(tubeBox.max.z - tubeBox.min.z, 5.28, 0.12), r2(tubeBox.max.z - tubeBox.min.z), 5.28);
  const full = boxOf(g);
  check("tank gun-forward length (≈9.8 m)", near(full.max.z - full.min.z, 9.8, 0.25), r2(full.max.z - full.min.z), 9.8);
  check("tank track width 0.635", near(sp.trackWidth, 0.635, 0.001), sp.trackWidth, 0.635);
  const shoeBox = new T.Box3().setFromBufferAttribute(g.getObjectByName("track").geometry.attributes.position);
  check("tank drawn shoe width", near(shoeBox.max.x - shoeBox.min.x, 0.635 + 0.07, 0.03), r2(shoeBox.max.x - shoeBox.min.x), "0.635 + connectors");
  check("tank road wheels 7/side", sp.dims.roadWheels === 7, sp.dims.roadWheels, 7);
  check("tank shoes per side 75-90 (real: 78)", sp.shoes >= 75 && sp.shoes <= 90, sp.shoes, "75..90");
  const roof = boxOf(g, (o) => o.name === "turret-plate" && o.material && o.material.color && o.material.color.getHex() === 0x4a5238);
  rows.push({ name: "tank turret plate top", ok: true, got: r2(roof.max.y), want: "~2.4-2.9 incl. sights" });
  check("tank fits the cargo hold (≤3.0 m, ≤4.4 m wide)", full.max.y <= 3.0 && made.tank.footW <= 4.4, r2(full.max.y), "≤3.0");

  // shoes sit on the ground under the road wheels
  const tr = g.getObjectByName("track"), m = new T.Matrix4(), p = new T.Vector3();
  let low = 0;
  for (let i = 0; i < tr.count; i++) { tr.getMatrixAt(i, m); p.setFromMatrixPosition(m); if (p.y < 0.1) low++; }
  check("tank ground run has shoes", low > 30, low, ">30");

  // drive: tracks + wheels move, the sibling's do not, turret + gun follow
  const sib = A.tank().group;
  const before = Array.from(tr.instanceMatrix.array.slice(0, 16));
  const sibBefore = Array.from(sib.getObjectByName("track").instanceMatrix.array.slice(0, 16));
  for (let i = 0; i < 30; i++) rig.update(1 / 30, 6, 0.2, 0);
  const after = Array.from(tr.instanceMatrix.array.slice(0, 16));
  check("tank tracks move when driven", before.some((v, i) => Math.abs(v - after[i]) > 1e-4), true, true);
  check("sibling tank untouched", sibBefore.every((v, i) => v === sib.getObjectByName("track").instanceMatrix.array[i]), true, true);
  check("shared geometry across clones", g.getObjectByName("track").geometry === sib.getObjectByName("track").geometry, true, true);
  for (let i = 0; i < 90; i++) rig.aimTurret(1.2, 0.3, 1 / 30);
  check("turret traverses", near(rig.turret.rotation.y, 1.2, 0.05), r2(rig.turret.rotation.y), 1.2);
  check("gun elevates (+20° cap)", near(-rig.gun.rotation.x, 0.3, 0.02), r2(-rig.gun.rotation.x), 0.3);
  for (let i = 0; i < 90; i++) rig.aimTurret(0, 1.0, 1 / 30);
  check("gun elevation clamps at +20°", near(-rig.gun.rotation.x, 0.35, 0.01), r2(-rig.gun.rotation.x), 0.35);
  rig.fired(1);
  for (let i = 0; i < 2; i++) rig.update(1 / 30, 0, 0, 0);
  check("recoil slides the tube back", rig.tube.position.z < -0.2, r2(rig.tube.position.z), "< -0.2");
  check("hull rocks on firing", Math.abs(rig.body.rotation.x) > 0.005, r2(rig.body.rotation.x * 1000) / 1000, "≠0");
  for (let i = 0; i < 60; i++) rig.update(1 / 30, 0, 0, 0);
  check("tube returns to battery", near(rig.tube.position.z, 0, 0.005), r2(rig.tube.position.z), 0);
  check("muzzle ahead of the hull", rig.muzzleWorld().length() > 3, r2(rig.muzzleWorld().z), ">3");
  let threw = null; try { g.clone(); } catch (e) { threw = e.message; }
  check("placed vehicle clone() does not throw", !threw, threw || "ok", "ok");
}
// ---- launchers
for (const k of ["mlrs", "patriot"]) {
  const g = made[k].group, rig = g.userData.rig;
  check(`${k} muzzles`, rig.muzzles.length === rig.spec.launcher.n && rig.muzzles.every(Boolean), rig.muzzles.length, rig.spec.launcher.n);
  for (let i = 0; i < 200; i++) rig.aimLauncher(0.3, 2, 1 / 30);
  check(`${k} launcher elevates to max`, near(rig.launcherElev(), rig.spec.launcher.elevMax, 0.01), r2(rig.launcherElev()), r2(rig.spec.launcher.elevMax));
  const mz = rig.launcherMuzzle(0);
  check(`${k} raised muzzle above the cab`, mz.y > 2.8, r2(mz.y), ">2.8");
  rig.spend(0);
  check(`${k} spend hides round 0`, !rig.roundLoaded(0) && rig.roundLoaded(1) && rig.loaded === rig.spec.launcher.n - 1, rig.loaded, rig.spec.launcher.n - 1);
  rig.reload();
  check(`${k} reload restores`, rig.roundLoaded(0) && rig.loaded === rig.spec.launcher.n, rig.loaded, rig.spec.launcher.n);
  const ram = g.getObjectByName("ram");
  check(`${k} ram stretches with elevation`, ram.scale.y > 0.8, r2(ram.scale.y), ">0.8");
}
// ---- wheeled steering
{
  const rig = made.luv.group.userData.rig;
  for (let i = 0; i < 30; i++) rig.update(1 / 30, 5, 0.3, 1);
  check("luv front wheels steer", rig.steer > 0.3, r2(rig.steer), ">0.3");
  check("luv wheelbase 3.30", near(rig.spec.dims.wheelbase, 3.30, 0.01), rig.spec.dims.wheelbase, 3.30);
}

// ---- the drive sim (city/militaryvehicles.js) against stub engine hooks:
// board, drive, aim, and fire every weapon kind through the real code paths.
{
  const C = ctx.CBZ, calls = { missile: 0, missileAt: 0, det: [], tracer: 0 };
  ctx.addEventListener = () => {};
  ctx.document = { pointerLockElement: null };
  Object.assign(C, {
    game: { mode: "city", state: "playing" }, keys: {}, colliders: [],
    player: { pos: new T.Vector3(), vy: 0 }, cam: { yaw: Math.PI, pitch: 0.46 }, CAM_DEFAULT_PITCH: 0.46,
    cityFireMissile: () => { calls.missile++; return true; },
    cityFireMissileAt: (x, y, z, t) => { calls.missileAt++; return Number.isFinite(x + y + z + t.x + t.z); },
    detonate: (x, y, z, kind) => { calls.det.push(kind); return {}; },
    rayColliders: () => null, tracer: () => { calls.tracer++; },
    floorAt: () => 0, fullMap: { waypoint: () => ({ x: 400, z: 300 }) },
  });
  vm.runInContext(fs.readFileSync(path.join(ROOT, "src/city/militaryvehicles.js"), "utf8"), ctx);
  const tick = (n, dt) => { for (let i = 0; i < n; i++) for (const f of updaters) f(dt); };
  const board = (made, kind) => {
    const rec = C.cityRegisterMilitaryVehicle({ group: made.group, kind, footW: made.footW, footL: made.footL, model: { name: kind } });
    return C.cityDriveArmor(rec) ? rec : null;
  };
  // tank: drive forward, aim up, fire
  let rec = board(A.tank(), "tank");
  C.keys.w = true; tick(60, 1 / 30); C.keys.w = false;
  check("sim: tank drives forward", rec.pos.z > 3, r2(rec.pos.z), ">3");
  C.cam.pitch = 0.2; tick(40, 1 / 30);
  const rg = rec.group.userData.rig;
  check("sim: looking up elevates the gun", -rg.gun.rotation.x > 0.15, r2(-rg.gun.rotation.x), ">0.15");
  check("sim: tank fires a shell", C.cityArmorFire() && calls.missile === 1, calls.missile, 1);
  tick(3, 1 / 30);
  check("sim: tube recoils in the sim", rg.tube.position.z < -0.1, r2(rg.tube.position.z), "<-0.1");
  C.cityExitArmor();
  check("sim: exit settles the hull", rg.body.rotation.x === 0 && rg.tube.position.z === 0, true, true);
  // IFV: a 3-round burst of HE
  rec = board(A.ifv(), "ground");
  C.cam.pitch = 0.62; tick(30, 1 / 30);          // look down the road: rounds meet the ground
  C.cityArmorFire(); tick(20, 1 / 30);
  check("sim: IFV autocannon bursts 3 HE", calls.det.filter((k) => k === "grenade").length === 3 && calls.tracer === 3, calls.det.join(","), "grenade x3");
  C.cityExitArmor();
  // MLRS: elevate, ripple all six
  rec = board(A.mlrs(), "mlrs");
  tick(90, 1 / 30);
  const mr = rec.group.userData.rig;
  check("sim: MLRS pod elevates toward the target", mr.launcherElev() > 0.3, r2(mr.launcherElev()), ">0.3");
  check("sim: MLRS ripple starts", C.cityArmorFire() === true, true, true);
  tick(90, 1 / 30);
  check("sim: MLRS rippled 6 rockets", calls.missileAt === 6 && mr.loaded === 0, `${calls.missileAt} fired, ${mr.loaded} left`, "6, 0");
  tick(30 * 26, 1 / 30);
  check("sim: MLRS pod reloads", mr.loaded === 6, mr.loaded, 6);
  C.cityExitArmor();
  // Patriot: stands the rack up to the designated point, then launches
  rec = board(A.patriot(), "patriot");
  tick(100, 1 / 30);
  const pr = rec.group.userData.rig;
  check("sim: Patriot rack stands up to 38°", pr.launcherReady(), r2(pr.launcherElev()), ">=0.6");
  const before = calls.missileAt;
  check("sim: Patriot launches", C.cityArmorFire() && calls.missileAt === before + 1 && pr.loaded === 3, pr.loaded, 3);
  C.cityExitArmor();
  // a cargo truck has no gun
  rec = board(A.truck({}), "ground");
  check("sim: cargo truck is unarmed", C.cityArmorCanFire() === false, false, false);
  C.cityExitArmor();
}

const audit = A.audit();
if (process.argv.includes("--json")) console.log(JSON.stringify({ rows, audit }, null, 1));
else {
  for (const r of rows) console.log(`${r.ok ? "ok  " : "FAIL"}  ${r.name.padEnd(46)} ${String(r.got).padEnd(14)} ${r.want}`);
  console.log("\ntemplates:");
  for (const k of Object.keys(audit)) console.log(`  ${k.padEnd(11)} meshes ${String(audit[k].meshes).padStart(3)}  tris ${String(audit[k].tris).padStart(7)}  instances ${audit[k].instances}`);
}
console.log(fails ? `\n${fails} FAIL` : "\nall pass");
process.exit(fails ? 1 : 0);
