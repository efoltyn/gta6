#!/usr/bin/env node
/* tools/traverse-hands-check.mjs — DO THE HANDS GO ON THE THING YOU VAULT?

   Owner: "vaulting things, just like use of hands in physical world and code
   behind that." Plain node, no browser, no captures: the REAL three.js r128 +
   materials + fphands + character + physics.js in one vm, a real rig, a real
   box collider (or a parked car), and the real traversal:
   CBZ.characterTraversal.start() then step(..., animate) every frame, which
   runs animChar's traversal branch exactly as the game does.

   Per move (mantle / speed / kong / spin / car vault) and body (man, woman,
   teen) it measures, every frame:
     · plant   while a hand is planted (weight > 0.95): the palm's contact
               point (fphands PLANT_CONTACT on the live hand) is within 3 cm of
               the obstacle's top, inside its footprint (not in the air, not
               through it), the palm faces down (its back within 25 deg of up)
               and the planted point does not slide in the world (< 2 cm);
     · carry   every move plants its hands at all (a vault whose hands never
               touch the obstacle fails), and for long enough to read;
     · bodies  the pelvis and the feet stay out of the obstacle (a lowered
               body skims it, never passes through it);
     · rigid   no arm segment stretched;
     · release after the move the hands are back to their relaxed pose.

     node tools/traverse-hands-check.mjs [--verbose]     exit 0 = ok */
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { fakeDocument } from "./lib/fake-canvas.mjs";

const ROOT = new URL("../", import.meta.url);
const read = (f) => readFileSync(new URL(f, ROOT), "utf8");
const verbose = process.argv.includes("--verbose");
let seed = 20260928 >>> 0;
const M = Object.create(Math);
M.random = function () {
  seed = (seed + 0x6D2B79F5) >>> 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
let now = 0;
const ctx = vm.createContext({ console, Math: M, performance: { now: () => now }, setTimeout });
ctx.window = ctx; ctx.self = ctx; ctx.document = fakeDocument();
ctx.navigator = { userAgent: "node" }; ctx.location = { search: "", href: "" };
ctx.localStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };
const updates = [];
ctx.CBZ = { CONFIG: {}, onAlways() {}, onUpdate(o, f) { updates.push([o, f]); }, on() {} };
for (const f of ["src/vendor/three.r128.min.js", "src/world/materials.js", "src/systems/fphands.js",
  "src/entities/footwear.js", "src/entities/character.js"]) {
  vm.runInContext(read(f), ctx, { filename: f });
}
const { THREE: T, CBZ } = ctx;
// the world physics.js reads at load (the same shape tools/test-character-traversal.mjs gives it)
const V3 = () => new T.Vector3();
Object.assign(CBZ, {
  game: { mode: "city" },
  TUNE: { walkSpeed: 6.4, crouchSpeed: 2.4, jumpVel: 8.2, gravity: 22 },
  player: { pos: V3(), radius: 0.55, grounded: true, speed: 0, vy: 0, stamina: 100 },
  keys: {}, cam: { yaw: 0 }, feelDt: 0.016,
  colliders: [], platforms: [], cityCars: [],
  lerpAngle(a, b, t) { return a + (b - a) * t; },
  damp(a, b, rate, dt) { return a + (b - a) * (1 - Math.exp(-rate * dt)); },
  floorAt() { return 0; },
  sfx() {},
});
CBZ.playerChar = CBZ.makeCharacter({ skin: 0xb87955 });
vm.runInContext(read("src/systems/physics.js"), ctx, { filename: "src/systems/physics.js" });
const TR = CBZ.characterTraversal, H = CBZ.fpHands;
let fails = 0, checks = 0;
const failList = [];
function check(ok, msg) { checks++; if (!ok) { fails++; failList.push(msg); } }
if (!TR || !CBZ.charArmTo || !CBZ.charArmTo.plant) {
  console.log("FAIL traversal or charArmTo.plant missing");
  process.exit(1);
}

// ---------------------------------------------------------------- world
function box(y1, minZ, maxZ, ref) {
  const c = { minX: -1.2, maxX: 1.2, minZ, maxZ, y0: 0, y1, _city: true };
  if (ref) { c.ref = ref; }
  return c;
}
function world(colliders, cars) {
  CBZ.colliders.splice(0, CBZ.colliders.length, ...colliders);
  CBZ.cityCars.splice(0, CBZ.cityCars.length, ...(cars || []));
  if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
}
function parkedCar(z) {
  // a 4.4 x 1.8 x 1.45 m sedan parked ACROSS the run (x is its long axis)
  const g = new T.Group();
  g.position.set(0, 0, z);
  g.rotation.y = Math.PI / 2;
  g.userData.vehicleDims = { width: 1.8, length: 4.4, height: 1.45 };
  return { pos: g.position, group: g, dims: g.userData.vehicleDims, heading: Math.PI / 2, rot: Math.PI / 2, v: 0, vx: 0, vz: 0, model: { name: "sedan", body: "sedan" } };
}

// ---------------------------------------------------------------- measures
const _v = new T.Vector3(), _q = new T.Quaternion();
function palmPoint(hand) {
  const pc = H.PLANT_CONTACT, s = hand.userData.side < 0 ? -1 : 1;
  hand.updateMatrixWorld(true);
  return hand.localToWorld(new T.Vector3(pc[0] * s, pc[1], pc[2]));
}
function armLens(rig, side) {
  const part = side < 0 ? rig.parts.la : rig.parts.ra, low = part.userData.low, hand = part.userData.cap;
  part.updateMatrixWorld(true);
  const sh = part.getWorldPosition(new T.Vector3()), el = low.getWorldPosition(new T.Vector3());
  const wr = low.localToWorld(new T.Vector3(0, hand.userData.fit.wristY, 0));
  return [sh.distanceTo(el), el.distanceTo(wr)];
}

const BODIES = [{ label: "man", c: {} }, { label: "woman", c: { build: "f" } }, { label: "teen", c: { age: 13 } }];
const MOVES = [
  // name, obstacle, opts, expected kind/style, planted arms
  { name: "mantle", mk: () => ({ cols: [box(1.55, 1.15, 1.85)] }), opts: { speed: 3, running: false, allowTop: false }, kind: "mantle", arms: ["l", "r"] },
  { name: "speed", mk: () => ({ cols: [box(0.95, 1.3, 1.62)] }), opts: { speed: 7, running: true, allowTop: false }, kind: "vault", style: "speed", prev: -1, arms: ["l"] },
  { name: "kong", mk: () => ({ cols: [box(0.95, 1.3, 1.9)] }), opts: { speed: 7, running: true, allowTop: false }, kind: "vault", style: "kong", prev: 0, arms: ["l", "r"] },
  { name: "spin", mk: () => ({ cols: [box(1.0, 1.3, 2.25)] }), opts: { speed: 8, running: true, sprinting: true, allowTop: false }, kind: "vault", style: "spin", prev: 1, arms: ["l"] },
  { name: "car", mk: () => ({ cols: [], cars: [parkedCar(2.25)] }), opts: { speed: 7, running: true, sprinting: false, allowTop: false }, kind: "vault", prev: -1, arms: null },
];

const rows = [];
for (const B of BODIES) {
  for (const mv of MOVES) {
    const tag = `${B.label}/${mv.name}`;
    const scene = new T.Scene();
    const rig = CBZ.makeCharacter(Object.assign({ skin: 0xb87955, torso: 0x315f94, legs: 0x202c3c }, B.c));
    scene.add(rig.group);
    const W = mv.mk();
    world(W.cols, W.cars);
    if (W.cars) for (const c of W.cars) { scene.add(c.group); c.group.updateMatrixWorld(true); }
    const a = { pos: rig.group.position, radius: 0.5, grounded: true, speed: 0, vy: 0 };
    a.pos.set(0, 0, 0);
    if (mv.prev != null) a._traverseStyle = mv.prev;
    // settle the rig standing
    for (let i = 0; i < 10; i++) CBZ.animChar(rig, 0, 1 / 60);
    const rest = [armLens(rig, -1), armLens(rig, 1)];
    const st = TR.start(a, rig, 0, 1, Object.assign({ radius: 0.5, cars: !!W.cars }, mv.opts));
    check(!!st, `${tag}: the traversal starts`);
    if (!st) continue;
    check(st.kind === mv.kind && (!mv.style || st.style === mv.style), `${tag}: ${mv.kind}${mv.style ? "/" + mv.style : ""} (got ${st.kind}/${st.style})`);
    const arms = mv.arms || (st.style === "kong" ? ["l", "r"] : ["l"]);
    const topY = st.top;
    const r = { tag, frames: 0, planted: {}, maxRes: {}, maxResSoft: {}, slide: {}, maxTilt: {}, footIn: 0, pelvisIn: 0, stretch: 0, drop: 0 };
    const first = {};
    const dt = 1 / 60;
    let frames = 0;
    while (a._traversal && frames++ < 400) {
      now += dt * 1000;
      TR.step(a, rig, dt, true);
      if (!a._traversal) break;
      rig.group.updateMatrixWorld(true);
      r.frames++;
      const tp = rig.traversePose;
      if (tp && tp._drop > r.drop) r.drop = tp._drop;
      const plants = tp && tp._plants;
      if (process.env.THC_DBG && tag.includes(process.env.THC_DBG) && tp) {
        const pl = plants && plants[0];
        const sh = rig.parts.la.getWorldPosition(new T.Vector3());
        console.log("DBG", tag, "u", (tp.t || 0).toFixed(2), "root", a.pos.y.toFixed(2), a.pos.z.toFixed(2), "need", (tp._dropNeed || 0).toFixed(2), "allow", (tp._dropAllow || 0).toFixed(2), "drop", (tp._drop || 0).toFixed(2),
          "w", pl && pl.w != null ? pl.w.toFixed(2) : "-", "res", pl && pl.res != null ? pl.res.toFixed(3) : "-", "share", pl ? CBZ.charArmTo.reachShare(rig, pl.p, pl.arm).toFixed(2) : "-", "sh", sh.y.toFixed(2), sh.z.toFixed(2), "P", pl ? pl.p.y.toFixed(2) + "," + pl.p.z.toFixed(2) : "", "hip", rig.model.localToWorld(new T.Vector3(0, rig.hipY || 0.95, 0)).toArray().map((v) => v.toFixed(2)).slice(1).join(","), "pitch", rig.body.rotation.x.toFixed(2), "roll", rig.body.rotation.z.toFixed(2));
      }
      if (plants) {
        for (const pl of plants) {
          const hand = (pl.arm === "l" ? rig.parts.la : rig.parts.ra).userData.cap;
          if (!(pl.w > 0.95)) continue;
          r.planted[pl.arm] = (r.planted[pl.arm] || 0) + 1;
          const pp = palmPoint(hand);
          const res = pp.distanceTo(pl.p);
          r.maxRes[pl.arm] = Math.max(r.maxRes[pl.arm] || 0, res);
          // the palm faces down: the back of the hand (+Y) points up
          hand.getWorldQuaternion(_q);
          const up = _v.set(0, 1, 0).applyQuaternion(_q).y;
          r.maxTilt[pl.arm] = Math.max(r.maxTilt[pl.arm] || 0, Math.acos(Math.max(-1, Math.min(1, up))) * 180 / Math.PI);
          if (!first[pl.arm]) first[pl.arm] = pl.p.clone();
          r.slide[pl.arm] = Math.max(r.slide[pl.arm] || 0, pl.p.distanceTo(first[pl.arm]));
          // on the top, inside the footprint along the move
          const t = (pp.x - tp.ledgeX) * tp.dirX + (pp.z - tp.ledgeZ) * tp.dirZ;
          check(t > -0.02 && t < (tp.span || 0) + 0.02, `${tag}: ${pl.arm} palm is over the obstacle (${t.toFixed(3)} m along, span ${(tp.span || 0).toFixed(2)})`);
        }
      }
      // pelvis and feet out of the obstacle
      if (tp) {
        const inside = (p) => {
          const t = (p.x - tp.ledgeX) * tp.dirX + (p.z - tp.ledgeZ) * tp.dirZ;
          return t > 0.03 && t < (tp.span || 0) - 0.03;
        };
        for (const f of [rig.feet.ll, rig.feet.rl]) {
          const p = f.getWorldPosition(new T.Vector3());
          if (inside(p)) r.footIn = Math.max(r.footIn, topY - (p.y - 0.07));
        }
        const hp = rig.model.localToWorld(new T.Vector3(0, rig.hipY || 0.95, 0));
        if (inside(hp)) r.pelvisIn = Math.max(r.pelvisIn, topY - (hp.y - 0.10));
      }
      const L = [armLens(rig, -1), armLens(rig, 1)];
      for (let s = 0; s < 2; s++) for (let k = 0; k < 2; k++) r.stretch = Math.max(r.stretch, Math.abs(L[s][k] - rest[s][k]));
    }
    check(!a._traversal, `${tag}: the move finishes`);
    // a mantle hauls on its hands for most of a second; a run-speed vault is
    // over its hand in a tenth of one (60 fps: 3+ frames is a touch you see)
    const minFrames = mv.kind === "mantle" ? 10 : 3;
    for (const arm of arms) {
      const n = r.planted[arm] || 0;
      check(n >= minFrames, `${tag}: the ${arm} hand is planted on the obstacle (${n} frames, want ${minFrames})`);
      if (n) {
        check((r.maxRes[arm] || 0) < 0.03, `${tag}: ${arm} palm on the contact point (worst ${((r.maxRes[arm] || 0) * 100).toFixed(1)} cm)`);
        check(r.maxTilt[arm] < 25, `${tag}: ${arm} palm flat on the top (worst ${r.maxTilt[arm].toFixed(0)} deg off)`);
        check(r.slide[arm] < 0.02, `${tag}: ${arm} plant does not slide (${(r.slide[arm] * 100).toFixed(1)} cm)`);
      }
    }
    check(r.footIn < 0.04, `${tag}: feet stay out of the obstacle (${(r.footIn * 100).toFixed(1)} cm in)`);
    check(r.pelvisIn < 0.04, `${tag}: pelvis stays out of the obstacle (${(r.pelvisIn * 100).toFixed(1)} cm in)`);
    check(r.stretch < 1e-4, `${tag}: no arm segment stretched (${(r.stretch * 1000).toFixed(2)} mm)`);
    // after the move the hands let go
    for (let i = 0; i < 20; i++) { now += dt * 1000; CBZ.animChar(rig, 0, dt); }
    const hl = rig.parts.la.userData.cap, hr = rig.parts.ra.userData.cap;
    check(hl.userData.handPose !== "plant" && hr.userData.handPose !== "plant", `${tag}: the palms come off after the move (${hl.userData.handPose}/${hr.userData.handPose})`);
    check(Math.abs(rig.model.position.y) < 0.01, `${tag}: the body is back on its feet (${rig.model.position.y.toFixed(3)})`);
    rows.push(r);
  }
}

// ---------------------------------------------------------------- the solver alone
{
  const rig = CBZ.makeCharacter({});
  const scene = new T.Scene(); scene.add(rig.group);
  for (let i = 0; i < 5; i++) CBZ.animChar(rig, 0, 1 / 60);
  rig.group.updateMatrixWorld(true);
  let worst = 0;
  // reachable points: out from each shoulder, 55-85% of the arm, below it and ahead
  const offs = [[0.05, -0.30, 0.35], [-0.10, -0.40, 0.25], [0.12, -0.20, 0.40], [0.0, -0.45, 0.10]];
  for (const [x, y, z] of offs) {
    for (const arm of ["l", "r"]) {
      const sh = (arm === "l" ? rig.parts.la : rig.parts.ra).getWorldPosition(new T.Vector3());
      const p = sh.clone().add(new T.Vector3(arm === "l" ? x : -x, y, z));
      const res = CBZ.charArmTo.plant(rig, p, arm, new T.Vector3(0, 1, 0), new T.Vector3(0, 0, 1), 1);
      worst = Math.max(worst, res);
      const hand = (arm === "l" ? rig.parts.la : rig.parts.ra).userData.cap;
      hand.getWorldQuaternion(_q);
      const up = _v.set(0, 1, 0).applyQuaternion(_q), fwd = new T.Vector3(0, 0, -1).applyQuaternion(_q);
      check(up.y > 0.999 && fwd.z > 0.999, `plant: ${arm} palm down, fingers forward at ${[x, y, z]}`);
    }
  }
  check(worst < 0.002, `plant: reachable points land exactly (worst ${(worst * 1000).toFixed(2)} mm)`);
  CBZ.charArmTo.plantRelease(rig, "both");
  check(rig.parts.la.userData.cap.userData.handPose === "relaxed", "plantRelease hands the pose back");
  // the plant pose: the heel of the palm and the finger pads on ONE plane,
  // and that plane is PLANT_CONTACT (the solver lays it on the surface)
  for (const lod of [0, 1]) {
    const g = lod ? H.bodyHandGeometry(1, "plant", lod) : H.handGeometry(1, "plant");
    const p = g.attributes.position;
    let palm = 0, fing = 0;
    for (let i = 0; i < p.count; i++) { const z = p.getZ(i), y = p.getY(i); if (z > -0.09) palm = Math.min(palm, y); else fing = Math.min(fing, y); }
    check(Math.abs(palm - H.PLANT_CONTACT[1]) < 0.003 && Math.abs(fing - H.PLANT_CONTACT[1]) < 0.003,
      `plant pose lod${lod}: heel ${(palm * 1000).toFixed(1)} mm and finger pads ${(fing * 1000).toFixed(1)} mm on the contact plane ${(H.PLANT_CONTACT[1] * 1000).toFixed(1)} mm`);
  }
}

console.log("move            frames  planted(l/r)   palm cm(l/r)   tilt(l/r)  slide cm  drop m  foot/pelvis in cm");
for (const r of rows) {
  const f = (o, k, m) => (o[k] == null ? "  -" : (o[k] * (m || 1)).toFixed(1).padStart(4));
  console.log(r.tag.padEnd(16) + String(r.frames).padStart(5) + "   " + String(r.planted.l || 0).padStart(4) + "/" + String(r.planted.r || 0).padEnd(4) +
    "   " + f(r.maxRes, "l", 100) + "/" + f(r.maxRes, "r", 100) + "    " + f(r.maxTilt, "l") + "/" + f(r.maxTilt, "r") +
    "   " + f(r.slide, "l", 100) + "   " + r.drop.toFixed(2) + "   " + (r.footIn * 100).toFixed(1) + "/" + (r.pelvisIn * 100).toFixed(1));
}
if (fails) console.log("\nFAIL\n  - " + failList.slice(0, 40).join("\n  - ") + (failList.length > 40 ? `\n  ... ${failList.length - 40} more` : ""));
console.log(`\n${checks - fails}/${checks} checks passed`);
process.exit(fails ? 1 : 0);
