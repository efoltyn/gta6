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
const ctx = vm.createContext({ window: { CBZ, THREE }, THREE, CBZ, Float32Array, Math, Map, WeakMap, String, Array });
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
ok(!mover._proxy && mover.group.visible === true, "released inside 142 m and drawn itself");
mover.pos.set(0, 0, -600); tick();
got = CI.acquire(mover, true); ok(!got, "no proxy past the fog ring");
// parked path unchanged
const parked = makeCar(20, -100, false);
got = false; for (let i = 0; i < 12 && !got; i++) { got = CI.acquire(parked); tick(); }
ok(got && parked._proxy, "parked car proxied at 100 m");
parked.pos.x += 0.5; tick();
ok(!parked._proxy, "a parked proxy that moves is released");
console.log(fails ? `FAIL ${fails}` : "OK carinstances: parked + moving proxies", JSON.stringify(CBZ.carInstanceAudit()));
process.exit(fails ? 1 : 0);
