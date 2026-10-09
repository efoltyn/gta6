#!/usr/bin/env node
/* tools/test-car-strike.mjs — A CAR HITS A PERSON (city/carstrike.js).

   Plain node: the real three r128, the real character rig, city/ragdoll.js
   and city/carstrike.js in the verbs vm. A saloon (the table outline for a
   sedan, 4.6 x 2.0 x 1.45) drives at a man crossing the road at 15, 40 and
   70 km/h; the driver brakes 0.25 s after the hit, as a driver does.

     · the body is never more than 2 cm into the car's shape at any substep
     · 15 km/h: knocked down forward, away from the car (no roof, no screen)
     · 40 km/h: legs at the bumper, the body wraps onto the bonnet / screen,
                then is thrown forward as the car brakes
     · 70 km/h: wraps and goes over the car or far forward
     · the rest pose is on the ground: lying, no point under the street,
       nothing in the car; the car lost a little speed (momentum)
     · a living man struck at 15 km/h is handed back to his rig to get up

     node tools/test-car-strike.mjs        exit 0 = ok */
import { loadVerbsVM } from "./lib/verbs-vm.mjs";
import { readFileSync } from "node:fs";
import vm from "node:vm";

let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log("FAIL " + m); } else console.log("ok   " + m); };
const read = (f) => readFileSync(new URL("../" + f, import.meta.url), "utf8");

const v = loadVerbsVM({ mode: "city" });
const { CBZ, THREE } = v;
CBZ.scene = new THREE.Scene();
for (const f of ["src/city/ragdoll.js", "src/city/carstrike.js"]) vm.runInContext(read(f), v.ctx, { filename: f });
v.updaters.sort((a, b) => a.order - b.order);
const CS = CBZ.carStrike, C = CS.core; CS.debug = !!process.env.CSDBG;
CBZ.camera.position.set(0, 3, 0);

function makeCar(kmh) {
  const g = new THREE.Group();
  CBZ.scene.add(g);
  const v0 = kmh / 3.6;
  const car = { pos: g.position, group: g, heading: 0, v: v0, vx: 0, vz: v0, mass: 1.05, _bk: "sedan", player: true,
    dims: { width: 2, length: 4.6, height: 1.45, wheelbase: 2.7 } };
  g.position.set(0, 0, -7);
  return car;
}

function run(kmh, alive) {
  v.clearActors();
  v.world({});
  CS.audit.maxDepth = 0;
  const a = v.actor({ x: 0.25, z: 0, yaw: Math.PI / 2, name: "walker" });   // crossing the road, side-on to the car
  a.radius = 0.3;
  CBZ.scene.add(a.group);
  CBZ.cityPeds = [a];
  for (let i = 0; i < 3; i++) v.frame(1 / 60);
  const car = makeCar(kmh);
  CBZ.cityCars = [car];
  const dt = 1 / 60;
  let struck = false, tHit = 0, t = 0, touched = 0, headHit = false, peakY = 0, hitZ = 0, maxDepth = 0;
  let vAtHit = 0, vAfter = 0, overRoof = false;
  for (let f = 0; f < 60 * 9; f++, t += dt) {
    // the driven car moves first (order 11 in the city)
    if (struck && t - tHit > 0.25) car.v = Math.max(0, car.v - 8.5 * dt);
    car.vz = car.v; car.vx = 0;
    car.pos.z += car.v * dt;
    if (!struck) {
      const info = CS.hit(car, a, car.v);
      if (info) {
        struck = true; tHit = t; hitZ = car.pos.z; vAtHit = car.v;
        if (!alive) a.dead = true;
        if (!CS.strike(a, car, info, car.v)) { ok(false, `${kmh} km/h: the strike did not take the body`); return null; }
      }
    }
    v.frame(dt);
    if (struck) {
      const s = a._ragSlot != null ? true : false;
      const P = CBZ.ragdollPoints(a);
      const S = CS.shapeOf(car);
      if (P) {
        for (let i = 1; i < 39; i += 3) peakY = Math.max(peakY, P[i]);
        // anything of him behind the car's tail while above the roof = over it
        const L = {};
        for (let i = 0; i < 39; i += 3) {
          C.toLocal(C.setPose({}, car.pos.x, 0, car.pos.z, 0, 0, 0), P[i], P[i + 1], P[i + 2], L);
          if (L.y > S.top - 0.1 && L.z < S.roofF) overRoof = true;
        }
      }
      if (t - tHit < 0.1) vAfter = car.v;
      maxDepth = Math.max(maxDepth, CS.audit.maxDepth);
      if (!P && !alive) break;
      if (t - tHit > 1 && CBZ.ragdollAudit().solving === 0 && car.v === 0) break;
    }
  }
  if (!struck) { ok(false, `${kmh} km/h: the car never met him`); return null; }
  const st = a._csLast || {};
  return { a, car, maxDepth, peakY, hitZ, overRoof, vAtHit, vAfter, P: CBZ.ragdollPoints(a) };
}

// ---- the shape off a real mesh: a lower body box, a raked glass-house
{
  const g = new THREE.Group(); CBZ.scene.add(g);
  const vis = new THREE.Group(); g.add(vis); g.userData.carVisual = vis;
  const lower = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.6, 4.5), new THREE.MeshBasicMaterial());
  lower.position.set(0, 0.55, 0); vis.add(lower);
  // cabin: a prism, screen raked from z 0.9 (y 0.85) up to z 0 (y 1.42)
  const cab = new THREE.BufferGeometry();
  const P = [], prof = [[0.85, 0.9], [1.42, 0.0], [1.42, -1.0], [0.85, -1.7]];
  for (let k = 0; k < 3; k++) {                       // three quads across the car: screen, roof, back glass
    const [ya, za] = prof[k], [yb, zb] = prof[k + 1];
    P.push(-0.8, ya, za, 0.8, ya, za, 0.8, yb, zb, -0.8, ya, za, 0.8, yb, zb, -0.8, yb, zb);
  }
  cab.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
  vis.add(new THREE.Mesh(cab, new THREE.MeshBasicMaterial()));
  const car = { pos: g.position, group: g, heading: 0, v: 0, mass: 1.05, _bk: "sedan", dims: { width: 2, length: 4.5, height: 1.42, wheelbase: 2.7 } };
  const S = CS.shapeOf(car);
  const labs = new Set(Array.from(S.lab).map((l) => C.LAB_NAME[l]));
  ok(S.kind === "sedan" && Math.abs(S.zf - 2.25) < 0.05 && Math.abs(S.top - 1.42) < 0.03 && Math.abs(S.bonnetY - 0.85) < 0.05 && labs.has("screen") && labs.has("roof") && labs.has("bumper"),
    `outline sampled off the mesh: nose ${S.zf.toFixed(2)} m, bonnet ${S.bonnetY.toFixed(2)} m, roof ${S.top.toFixed(2)} m, ${S.n} vertices [${[...labs].join(", ")}]`);
  CBZ.scene.remove(g);
}

// the audit is per run: carstrike records what each strike touched
const runs = {};
for (const kmh of [15, 40, 70]) {
  CS.audit.touched = 0; CS.audit.headPanel = 0;
  const r = run(kmh, false);
  if (!r) continue;
  r.touched = CS.audit.touched; r.headPanel = CS.audit.headPanel;
  runs[kmh] = r;
  const P = r.P;
  ok(r.maxDepth <= 0.02, `${kmh} km/h: never more than 2 cm into the car at any substep (worst ${(r.maxDepth * 100).toFixed(2)} cm)`);
  if (P) {
    let lo = Infinity, hi = -Infinity, cz = 0;
    for (let i = 0; i < 39; i += 3) { lo = Math.min(lo, P[i + 1]); hi = Math.max(hi, P[i + 1]); cz += P[i + 2] / 13; }
    const S = CS.shapeOf(r.car);
    const st = CBZ.ragdollStrikeOf(r.a);               // a car resting on him rides on him
    const P1 = C.setPose({}, r.car.pos.x, st ? st.ride : 0, r.car.pos.z, 0, 0, 0);
    const restDepth = C.depth(S, P1, P, CS.audit.rad, CS.audit.k);   // the solver's own radii and body scale
    ok(lo > 0 && hi < 0.75, `${kmh} km/h: rests on the ground, lying (lowest point ${lo.toFixed(3)} m, highest ${hi.toFixed(3)} m)`);
    ok(restDepth <= 0.005, `${kmh} km/h: rests clear of the car (depth ${(restDepth * 100).toFixed(2)} cm)`);
    r.restZ = cz; r.carZ = r.car.pos.z;
    console.log(`     ${kmh} km/h: peak ${r.peakY.toFixed(2)} m, body rests ${(cz - r.hitZ).toFixed(2)} m down the road from the hit, ${(cz - r.carZ).toFixed(2)} m from the stopped car's centre; touched [${C.LAB_NAME.filter((_, i) => r.touched & (1 << i)).join(", ")}]${r.headPanel ? " head on " + C.LAB_NAME.filter((_, i) => r.headPanel & (1 << i)).join("/") : ""}; car ${r.vAtHit.toFixed(2)} -> ${r.vAfter.toFixed(2)} m/s at the hit`);
  }
  ok(r.vAfter < r.vAtHit && r.vAfter > r.vAtHit * 0.85, `${kmh} km/h: the car lost a little speed to the body (${(100 * (1 - r.vAfter / r.vAtHit)).toFixed(1)} %)`);
}
const LAB = C.LAB;
if (runs[15]) ok(!(runs[15].touched & ((1 << LAB.SCREEN) | (1 << LAB.ROOF))) && runs[15].restZ > runs[15].carZ + 2.3,
  `15 km/h: knocked down forward and away (ahead of the nose, no screen/roof)`);
if (runs[40]) ok((runs[40].touched & (1 << LAB.FRONT)) && (runs[40].touched & ((1 << LAB.BONNET) | (1 << LAB.SCREEN))) && runs[40].restZ > runs[40].carZ + 2.3,
  `40 km/h: legs at the bumper, wraps onto the bonnet/screen, thrown forward as the car brakes`);
if (runs[70]) ok((runs[70].touched & ((1 << LAB.BONNET) | (1 << LAB.SCREEN))) && (runs[70].overRoof || runs[70].restZ - runs[70].hitZ > 8),
  `70 km/h: wraps and goes over the car or far forward`);

// ---- a living man at 15 km/h gets his rig back
{
  const r = run(15, true);
  if (r) {
    for (let i = 0; i < 240 && r.a._ragSlot != null; i++) v.frame(1 / 60);
    ok(r.a._ragSlot == null && r.a._bf && r.a._bf.on && !r.a.dead, `15 km/h, alive: handed back to his rig on the ground (bodyfall ${r.a._bf && r.a._bf.on ? "on" : "off"})`);
    ok(Math.abs(r.a.group.position.y) < 0.05, `...lying at street level (y ${r.a.group.position.y.toFixed(3)})`);
  }
}
// ---- under the wheels: a body lying across the lane, a car at 11 km/h
//      drives over it — the tyres climb it (both axles), it is never in the
//      car, and it is still on the street afterwards
{
  v.clearActors();
  CS.audit.maxDepth = 0; CS.audit.bumps = 0;
  const a = v.actor({ x: 0.9, z: 0, yaw: Math.PI / 2, name: "lying" });
  CBZ.scene.add(a.group); CBZ.cityPeds = [a];
  for (let i = 0; i < 3; i++) v.frame(1 / 60);
  a.dead = true;
  CBZ.cityRagdoll(a, null, { x: -1, y: 0, z: 0 }, 2);
  for (let i = 0; i < 180; i++) v.frame(1 / 60);
  const car = makeCar(11);
  car.pos.z = -6; car.pos.x = 0;
  car._susp = { p: 0, pv: 0, r: 0, rv: 0, h: 0, hv: 0 };
  CBZ.carDyn = { suspKick(sp, dv) { sp.hv += dv; return sp; } };
  CBZ.cityCars = [car];
  let maxHv = 0;
  for (let f = 0; f < 60 * 4; f++) {
    car.vz = car.v; car.pos.z += car.v * (1 / 60);
    v.frame(1 / 60);
    maxHv = Math.max(maxHv, car._susp.hv);
    car._susp.hv *= 0.8;
  }
  const P = CBZ.ragdollPoints(a);
  let lo = Infinity, front = -Infinity;
  if (P) for (let i = 0; i < 39; i += 3) { lo = Math.min(lo, P[i + 1]); front = Math.max(front, P[i + 2]); }
  const tail = car.pos.z + CS.shapeOf(car).zr;
  ok(CS.audit.bumps >= 2 && maxHv > 0.3, `11 km/h over a body lying in the road: the tyres climb it, the springs take it (${CS.audit.bumps} axle bumps, heave kick ${maxHv.toFixed(2)} m/s)`);
  ok(CS.audit.maxDepth <= 0.02, `...never more than 2 cm into the car (worst ${(CS.audit.maxDepth * 100).toFixed(2)} cm)`);
  ok(P && tail > front && lo > 0, `...the car went over it (tail at z ${tail.toFixed(2)}, body up to ${front.toFixed(2)}, car ${car.v.toFixed(2)} m/s), the body is on the street (lowest ${lo.toFixed(3)} m)`);
}
if (v.errors.length) { console.log(v.errors.slice(0, 4).join("\n")); }
ok(v.errors.length === 0, `no updater threw (${v.errors.length})`);
console.log(fails ? `\n${fails} FAILED` : "\nall ok");
process.exit(fails ? 1 : 0);
