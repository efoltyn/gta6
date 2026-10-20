// tools/carinstances-check.js — plain node, no browser: city/carinstances.js
// bookkeeping for PARKED proxies and MOVING (traffic) proxies.
//   node tools/carinstances-check.js
const fs = require("fs"), path = require("path"), vm = require("vm");
const ROOT = path.resolve(__dirname, "..");
const THREE = require(ROOT + "/src/vendor/three.r128.min.js");
const always = [];
const CBZ = { CONFIG: {}, game: { mode: "city" }, cityFogFar: 380, onAlways: (o, fn) => always.push(fn) };
CBZ.scene = new THREE.Scene();
CBZ.camera = new THREE.PerspectiveCamera(60, 1, 0.1, 5000); CBZ.camera.position.set(0, 2, 0); CBZ.camera.lookAt(0, 2, -1); CBZ.camera.updateMatrixWorld();
CBZ.carSleepD2 = () => { const f = Math.max(150, CBZ.cityFogFar + 30); return f * f; };
CBZ.cityCarSleepable = (c) => !c.ai;
const ctx = vm.createContext({ window: { CBZ, THREE }, THREE, CBZ, Float32Array, Math, Map, WeakMap, String, Array, performance });
vm.runInContext("var window = this.window;" + fs.readFileSync(ROOT + "/src/city/carinstances.js", "utf8"), ctx);
const CI = CBZ.carInstances;
const root = new THREE.Group(); CBZ.scene.add(root);
function makeCar(x, z, ai) {
  const grp = new THREE.Group(); grp.position.set(x, 0, z);
  const body = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 4), new THREE.MeshLambertMaterial({ color: 0x3355aa }));
  body.position.y = 0.8; grp.add(body);
  const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.2), new THREE.MeshLambertMaterial({ color: 0x111111 }));
  wheel.position.set(1, 0.3, 1.2); grp.add(wheel);
  const drv = new THREE.Group(); drv.userData.occupant = true; drv.add(new THREE.Mesh(new THREE.SphereGeometry(0.3), new THREE.MeshLambertMaterial())); grp.add(drv);
  root.add(grp); grp.updateMatrixWorld(true);
  return { group: grp, pos: grp.position, heading: 0, ai: !!ai, dead: false };
}
const tick = () => always.forEach((f) => f(1 / 60));
let fails = 0; const ok = (cond, what) => { if (!cond) { fails++; console.log("FAIL", what); } };
function poolT(c) { const e = c._proxyRec.entries[0]; return [e.m[12], e.m[13], e.m[14]]; }
// warm pools: first acquires only create pools (2 per frame, 3 frames warm)
const mover = makeCar(0, -200, true);
let got = false; for (let i = 0; i < 12 && !got; i++) { got = CI.acquire(mover, true); tick(); }
ok(got && mover._proxy, "mover proxied at 200 m");
ok(mover.group.visible === false, "mover's own group hidden");
ok(mover._proxyRec.entries.length === 2, "occupant left out, body + wheel pooled (" + (mover._proxyRec && mover._proxyRec.entries.length) + ")");
const t0 = poolT(mover);
mover.pos.x = 5; mover.pos.z = -210; mover.heading = 0.3; mover.group.rotation.y = 0.3; tick();
const t1 = poolT(mover);
ok(Math.abs(t1[0] - t0[0]) > 1 && mover._proxy, "instance followed the car (" + t0[0].toFixed(2) + " -> " + t1[0].toFixed(2) + ")");
mover.pos.set(0, 0, -100); tick();
ok(mover._proxy, "still pooled at 100 m (near radius is 45 m from the eye)");
mover.pos.set(0, 0, -30); tick();
ok(!mover._proxy && mover.group.visible === true, "released inside 41 m and drawn itself");
mover.pos.set(0, 0, -600); tick();
got = CI.acquire(mover, true); ok(!got, "no proxy past the fog ring");
// parked path unchanged
const parked = makeCar(20, -100, false);
got = false; for (let i = 0; i < 12 && !got; i++) { got = CI.acquire(parked); tick(); }
ok(got && parked._proxy, "parked car proxied at 100 m");
parked.pos.x += 0.5; tick();
ok(!parked._proxy, "a parked proxy that moves is released");

// ---- near traffic (45-85 m): EXACT matrices, brake-lamp rekey, seat blob, hidden parts ----
const near = makeCar(0, -60, true);
const nvis = new THREE.Group(); near.group.add(nvis); near.group.userData.carVisual = nvis;
const lamp = new THREE.Mesh(new THREE.BoxGeometry(1, 0.2, 0.1), new THREE.MeshLambertMaterial({ color: 0x220000 }));
lamp.position.set(0, 0.8, -2); nvis.add(lamp);
const brake = new THREE.MeshLambertMaterial({ color: 0xff0000 });
const blob = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.9, 0.5), new THREE.MeshLambertMaterial({ vertexColors: true }));
blob.userData.occupant = true; blob.position.set(0.4, 0.5, 0.2); nvis.add(blob);
const bar = new THREE.Mesh(new THREE.BoxGeometry(1, 0.1, 0.3), new THREE.MeshLambertMaterial({ color: 0x0000ff }));
bar.visible = false; nvis.add(bar);
// a wheel mesh that spins in place (the exact path must see it)
const spin = near.group.children[1];
near.v = 5;
got = false; for (let i = 0; i < 12 && !got; i++) { got = CI.acquire(near, true); tick(); }
ok(got && near._proxy && near._proxyRec.exact, "near mover pooled in EXACT mode at 60 m");
ok(near._proxyRec.entries.some((e) => e.src === blob), "the seat blob is pooled with the car");
spin.rotation.x = 1.0; near.pos.z = -61; near.group.position.z = -61; tick();
{
  const e = near._proxyRec.entries.find((q) => q.src === spin);
  spin.updateWorldMatrix(true, false);
  let d = 0; for (let k = 0; k < 16; k++) d = Math.max(d, Math.abs(e.m[k] - spin.matrixWorld.elements[k]));
  ok(d < 1e-5, "exact entry = the wheel's own spun world matrix (max diff " + d + ")");
}
// brake lamps: the pool for the brake material is made, warms, and the entry MOVES to it
for (let i = 0; i < 12; i++) { lamp.material = (i & 1) ? lamp.material : brake; near.pos.z -= 0.01; near.group.position.z = near.pos.z; tick(); if (!near._proxy) CI.acquire(near, true); }
lamp.material = brake; near.pos.z -= 0.01; near.group.position.z = near.pos.z; tick(); if (!near._proxy) { for (let i = 0; i < 8 && !near._proxy; i++) { tick(); CI.acquire(near, true); } }
ok(near._proxy, "car still pooled with its brake lamps on");
{
  const e = near._proxy && near._proxyRec.entries.find((q) => q.src === lamp);
  ok(e && e.pool.mat === brake, "lamp entry drawn with the brake material");
  const lampOff = lamp.material = new THREE.MeshLambertMaterial({ color: 0x220001 });   // unknown material: no pool yet
  tick();
  ok(!near._proxy || (near._proxyRec.entries.find((q) => q.src === lamp) || {}).mat === lampOff, "an unpooled material never draws stale");
}
for (let i = 0; i < 12 && !near._proxy; i++) { tick(); CI.acquire(near, true); }
ok(near._proxy, "re-pooled after the new material's pool warmed");
bar.visible = true; tick();
ok(!near._proxy, "a hidden part that comes on (a lightbar) releases the proxy");
bar.visible = false;
// a promoted rig at the wheel: never pooled near
near.npcDriver = { pos: new THREE.Vector3() }; near._proxyRetry = 0;
ok(!CI.acquire(near, true), "near mover with a rigged driver is refused");
near.npcDriver = null; near._proxyRetry = 0;
// EXACT -> RELATIVE past 85 m and back
for (let i = 0; i < 12 && !near._proxy; i++) { tick(); CI.acquire(near, true); }
near.pos.z = -120; near.group.position.z = -120; tick();
ok(near._proxy && !near._proxyRec.exact, "past 85 m the proxy follows by relative matrices");
near.pos.z = -70; near.group.position.z = -70; tick();
ok(near._proxy && near._proxyRec.exact, "back inside 75 m it is exact again");
// 3D distance: a car right under a camera 120 m up is pooled
CBZ.camera.position.set(0, 120, -70); CBZ.camera.updateMatrixWorld();
const under = makeCar(3, -70, false);
got = false; for (let i = 0; i < 12 && !got; i++) { got = CI.acquire(under); tick(); }
ok(got, "a parked car 120 m below the eye is pooled (3D distance)");
console.log(fails ? `FAIL ${fails}` : "OK carinstances: parked + moving proxies", JSON.stringify(CBZ.carInstanceAudit()));
process.exit(fails ? 1 : 0);
