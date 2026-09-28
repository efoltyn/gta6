#!/usr/bin/env node
/* tools/bipod-check.mjs — DOES THE M249'S BIPOD ACTUALLY UNFOLD?

   The legs were modelled folded (weapons/appearances/lmg.js) with a
   setDeployed(k) nobody called, while the ballistics (fpsmode bipodActive)
   already braced on them. Plain node, no browser: the REAL three r128 +
   character + weapon kit + actorweapons + holsterprops in a vm.

   Asserts:
     model   folded legs lie forward along the barrel; deployed legs end
             exactly on userData.bipod.feet, splayed down; deployed, the feet
             are the model's lowest point (so they are what rests); every leg
             move drops the ground-rest bounds cache;
     drive   drive(on, dt) eases 0 -> 1 monotonically over ~0.35 s with no
             jump, and folds back the same way;
     npc     CBZ.actorReadyPose on a PRONE, still holder unfolds the legs;
             crawling, or standing up, folds them; an upright holder never
             deploys;
     player  the third-person drawn gun (holsterprops onAlways 54) follows
             CBZ.fpsBipodActive(), and prone the rest solve
             (character.js gunGroundRest) puts the FEET on the ground plane.

     node tools/bipod-check.mjs        exit 0 = ok */
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { fakeDocument } from "./lib/fake-canvas.mjs";

const ROOT = new URL("../", import.meta.url);
const read = (f) => readFileSync(new URL(f, ROOT), "utf8");
const ctx = vm.createContext({ console, Math, performance, setTimeout });
ctx.window = ctx; ctx.self = ctx; ctx.document = fakeDocument();
ctx.navigator = { userAgent: "node" }; ctx.location = { search: "", href: "" };
ctx.localStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };
const hooks = { always: [], update: [] };
ctx.CBZ = { CONFIG: {}, onAlways(o, f) { hooks.always.push([o, f]); }, onUpdate(o, f) { hooks.update.push([o, f]); }, on() {} };
const APPEAR = ["sidearm", "carbine", "lmg"];
for (const f of ["src/vendor/three.r128.min.js", "src/world/materials.js", "src/systems/fphands.js", "src/entities/footwear.js", "src/entities/character.js",
  "src/weapons/weapon-data.js", "src/weapons/weapon-scale.js", ...APPEAR.map((n) => `src/weapons/appearances/${n}.js`),
  "src/systems/actorweapons.js", "src/systems/holsterprops.js", "src/systems/gunhands.js"]) {
  vm.runInContext(read(f), ctx, { filename: f });
}
const { THREE: T, CBZ } = ctx;
const always = hooks.always.slice().sort((a, b) => a[0] - b[0]);
const updates = hooks.update.slice().sort((a, b) => a[0] - b[0]);
let fails = 0, checks = 0;
function check(ok, msg) { checks++; if (!ok) { fails++; console.log("  FAIL " + msg); } else if (process.argv.includes("--verbose")) console.log("  ok   " + msg); }
const DEG = 180 / Math.PI;

// ---------------------------------------------------------------- model
const prop = CBZ.buildActorWeapon("lmg");
const B = prop.userData.bipod;
check(!!(B && B.setDeployed && B.drive), "lmg carries userData.bipod with setDeployed + drive");
// the two leg groups are the children positioned exactly on the hinges
const legs = prop.children.filter((c) => B.hinges.some((h) => h.distanceToSquared(c.position) < 1e-10));
check(legs.length === 2, `two leg pivots on the hinges (${legs.length})`);
const tipOf = (leg) => {                       // the leg's far end, in the model's frame
  const len = B.feet[legs.indexOf(leg)].distanceTo(B.hinges[legs.indexOf(leg)]);
  return new T.Vector3(0, len, 0).applyQuaternion(leg.quaternion).add(leg.position);
};
const lowestY = (skipLegs) => {
  prop.updateMatrixWorld(true);
  const inv = new T.Matrix4().copy(prop.matrixWorld).invert(), v = new T.Vector3();
  let lo = Infinity;
  prop.traverse((o) => {
    if (!o.isMesh) return;
    if (skipLegs && legs.some((l) => { for (let n = o; n; n = n.parent) if (n === l) return true; return false; })) return;
    const p = o.geometry.attributes.position, m = new T.Matrix4().multiplyMatrices(inv, o.matrixWorld);
    for (let i = 0; i < p.count; i++) lo = Math.min(lo, v.fromBufferAttribute(p, i).applyMatrix4(m).y);
  });
  return lo;
};
B.setDeployed(0);
for (const leg of legs) {
  const i = legs.indexOf(leg), axis = tipOf(leg).sub(leg.position).normalize();
  const ang = Math.acos(Math.max(-1, Math.min(1, axis.dot(new T.Vector3(0, 0, -1))))) * DEG;
  check(ang < 6, `folded leg ${i} lies forward along the barrel (${ang.toFixed(1)} deg off -Z)`);
  check(tipOf(leg).y < B.hinges[i].y + 0.001 && tipOf(leg).y > B.hinges[i].y - 0.08, `folded leg ${i} stays tucked under the barrel (tip y ${tipOf(leg).y.toFixed(3)})`);
}
prop.userData._restBounds = { stale: true };
B.setDeployed(1);
check(!prop.userData._restBounds, "a leg move drops the ground-rest bounds cache");
for (const leg of legs) {
  const i = legs.indexOf(leg), tip = tipOf(leg);
  check(tip.distanceTo(B.feet[i]) < 0.001, `deployed leg ${i} ends on its foot (${(tip.distanceTo(B.feet[i]) * 1000).toFixed(2)} mm)`);
  const axis = tip.clone().sub(leg.position).normalize();
  const down = Math.acos(-axis.y) * DEG;
  check(down > 20 && down < 60, `deployed leg ${i} splays down-forward (${down.toFixed(1)} deg off vertical)`);
  check(Math.sign(axis.x) === Math.sign(B.hinges[i].x), `deployed leg ${i} splays outward`);
}
const feetLow = lowestY(false), bodyLow = lowestY(true);
check(feetLow < bodyLow - 0.02, `deployed, the feet are the lowest point (${feetLow.toFixed(3)} vs the rest ${bodyLow.toFixed(3)})`);
B.setDeployed(0);
check(lowestY(false) >= bodyLow - 0.02, "folded, the legs hang no lower than the gun");

// ---------------------------------------------------------------- drive
{
  const dt = 1 / 60;
  let prev = B.deployed, mono = true, maxStep = 0, f = 0;
  for (; f < 120 && B.deployed < 1; f++) {
    B.drive(true, dt);
    if (B.deployed < prev - 1e-9) mono = false;
    maxStep = Math.max(maxStep, B.deployed - prev); prev = B.deployed;
  }
  check(B.deployed === 1, "drive(true) reaches fully deployed");
  check(mono, "deploy is monotonic");
  check(f * dt > 0.25 && f * dt < 0.5, `deploy takes a visible moment, not a snap (${(f * dt).toFixed(2)} s)`);
  check(maxStep < 0.09, `no frame jumps (largest step ${maxStep.toFixed(3)})`);
  for (f = 0; f < 120 && B.deployed > 0; f++) B.drive(false, dt);
  check(B.deployed === 0 && f * dt > 0.25, `drive(false) folds back (${(f * dt).toFixed(2)} s)`);
}

// ---------------------------------------------------------------- npc
{
  const rig = CBZ.makeCharacter({ legs: 0x39414f, torso: 0x8a939c, arms: 0x8a939c, skin: 0xc68642, hair: 0x222222, shoes: 0x222222, build: "m" });
  const scene = new T.Scene(); scene.add(rig.group); CBZ.scene = scene; CBZ.game = { mode: "none" };
  const actor = { char: rig, armed: true, weapon: "lmg", group: rig.group, pos: rig.group.position, speed: 0 };
  const run = (n) => { for (let i = 0; i < n; i++) { CBZ.animChar(rig, actor.speed, 1 / 30); CBZ.actorReadyPose(actor, 1 / 30); } return actor._weaponProp.userData.bipod.deployed; };
  check(run(30) === 0, "an upright NPC holding the M249 keeps the legs folded");
  rig.pronePose = true;
  check(run(30) === 1, "a PRONE, still NPC deploys the bipod (actorReadyPose hook)");
  actor.speed = 1.5;
  check(run(30) === 0, "crawling folds it");
  actor.speed = 0; run(30);
  rig.pronePose = false;
  check(run(30) === 0, "standing up folds it");
  // the per-frame city pass takes the same hook
  rig.pronePose = true; actor.speed = 0;
  CBZ.cityPeds = [actor]; CBZ.cityCops = []; CBZ.game = { mode: "city" };
  const pass = updates.find(([o]) => o === 36);
  for (let i = 0; i < 30; i++) { CBZ.animChar(rig, 0, 1 / 30); pass[1](1 / 30); }
  check(actor._weaponProp.userData.bipod.deployed === 1, "the city armed-ped pass (onUpdate 36) deploys it too");
}

// ---------------------------------------------------------------- player
{
  const rig = CBZ.makeCharacter({ legs: 0x39414f, torso: 0x8a939c, arms: 0x8a939c, skin: 0xc68642, hair: 0x222222, shoes: 0x222222, build: "m" });
  const scene = new T.Scene(); scene.add(rig.group);
  CBZ.scene = scene; CBZ.game = { mode: "city" };
  CBZ.player = { dead: false, pos: rig.group.position };
  CBZ.playerChar = rig;
  CBZ.camera = new T.PerspectiveCamera(60, 1.6, 0.1, 500);
  CBZ.camera.position.set(0.5, 1.2, -3.2); CBZ.camera.lookAt(0, 0.3, 10);
  scene.add(CBZ.camera);
  CBZ.cam = { pitch: 0 };
  CBZ.playerArmed = () => true; CBZ.currentWeaponId = "lmg"; CBZ.weaponInventory = ["lmg"];
  CBZ.tpPresenting = () => false;
  CBZ.playerAimDir = (o) => o.set(0, 0, 1);
  CBZ.fps = { active: false, reloading: 0 };
  CBZ.cityPeds = []; CBZ.cityCops = [];
  CBZ.floorAt = () => 0;
  let braced = false;
  CBZ.fpsBipodActive = () => braced;             // fpsmode's bipodActive(), stood in
  const frame = () => {
    const dt = 1 / 60;
    rig.aimBipod = braced;                        // fpsmode onAlways(51.5) publishes the same bit
    rig.carryPose = true; rig.aimLong = true;
    const sink = rig.pronePose && CBZ.charProneSink ? CBZ.charProneSink(rig) * (rig._proneB || 0) : 0;
    rig.group.position.y = -sink;                 // physics.js's prone sink
    for (const [o, fn] of updates) if (o < 10) fn(dt);
    CBZ.animChar(rig, 0, dt);
    for (const [o, fn] of updates) if (o >= 10) fn(dt);
    for (const [, fn] of always) fn(dt);
    scene.updateMatrixWorld(true);
  };
  for (let i = 0; i < 60; i++) frame();
  const gun = () => CBZ.tpHandWeapon();
  check(!!gun(), "a gun is in the third-person hand");
  check(gun() && gun().userData.bipod.deployed === 0, "standing, the drawn M249's legs stay folded");
  rig.pronePose = true; braced = true;
  for (let i = 0; i < 150; i++) frame();
  const g = gun();
  check(g && g.userData.bipod.deployed === 1, "prone + braced, the drawn M249 deploys (holsterprops hook)");
  if (g) {
    const feet = g.userData.bipod.feet.map((p) => g.localToWorld(p.clone()));
    // the foot pad is a 20 mm box centred on the foot point: its sole is 10 mm under it at scale
    const pad = 0.010 * g.getWorldScale(new T.Vector3()).y;
    const soles = feet.map((p) => p.y - pad);
    const lo = Math.min(...soles), hi = Math.max(...soles);
    check(lo > -0.005 && lo < 0.01, `the lower foot stands on the ground plane (sole at ${(lo * 1000).toFixed(1)} mm)`);
    check(hi - lo < 0.02, `both feet are down, the gun is not tipped onto one leg (other sole ${(hi * 1000).toFixed(1)} mm)`);
  }
  rig.pronePose = false; braced = false;
  for (let i = 0; i < 90; i++) frame();
  check(gun() && gun().userData.bipod.deployed === 0, "back on the feet, the legs fold");
}

console.log((fails ? "FAIL " : "PASS ") + checks + " checks, " + fails + " failing");
process.exit(fails ? 1 : 0);
