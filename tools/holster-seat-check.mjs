#!/usr/bin/env node
/* tools/holster-seat-check.mjs — THE HOLSTERED PISTOL SITS ON THE HIP.

   Owner (iPad): "the holster on the side of the player's hip is like a foot
   away from the hip. It's floating."

   Plain node, no browser. Loads the real rig (entities/character.js) and the
   real gun models, builds every body (m / f, every physique, adult / teen /
   child), hangs the sidearm (and the taser, the revolver) on the hip mount
   exactly as systems/holsterprops.js does (CBZ.charMounts().hip +
   CBZ.charMountSeat), and measures the closest distance from the gun's
   surface to the body's surface (pelvis, thighs, torso), in world metres.
   FAIL if any body leaves more than MAX_GAP of air, or if the gun is not on
   the semantic right hip (local -X) at belt height.

     node tools/holster-seat-check.mjs     exit 0 = every holster is on the hip */
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { fakeDocument } from "./lib/fake-canvas.mjs";

const MAX_GAP = 0.03;   // m: "within 3 cm of the body surface at the hip"
const ROOT = new URL("../", import.meta.url);
const read = (f) => readFileSync(new URL(f, ROOT), "utf8");
const ctx = vm.createContext({ console: { log() {}, warn() {}, error: console.error }, Math, setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {}, performance, Date });
ctx.window = ctx; ctx.self = ctx; ctx.globalThis = ctx; ctx.document = fakeDocument();
ctx.navigator = { userAgent: "node" }; ctx.location = { search: "", href: "" };
ctx.localStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };
ctx.addEventListener = () => {}; ctx.requestAnimationFrame = () => 0;
ctx.CBZ = { CONFIG: {}, game: { mode: "city" }, npcs: [], onUpdate() {}, onAlways() {}, onReset() {}, onModeEnter() {}, on() {} };
const GUNS = ["sidearm", "taser", "revolver"];
const FILES = ["src/vendor/three.r128.min.js", "src/config.js", "src/core/matrixskip.js", "src/world/materials.js", "src/systems/fphands.js",
  "src/entities/footwear.js", "src/entities/character.js", "src/weapons/weapon-data.js", "src/weapons/weapon-scale.js",
  ...GUNS.map((n) => `src/weapons/appearances/${n}.js`), "src/systems/actorweapons.js"];
for (const f of FILES) vm.runInContext(read(f), ctx, { filename: f });
const { THREE: T, CBZ } = ctx;
for (const need of ["makeCharacter", "charMounts", "charMountSeat", "buildActorWeapon", "bodySection"]) {
  if (!CBZ[need]) { console.error("FAIL harness: CBZ." + need + " missing"); process.exit(2); }
}

function worldVerts(root) {
  const out = [];
  root.traverse((o) => {
    if (!o.isMesh || !o.visible || !o.geometry || !o.geometry.attributes.position) return;
    const p = o.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) out.push(new T.Vector3().fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld));
  });
  return out;
}
function worldTris(mesh) {
  const g = mesh.geometry, p = g.attributes.position, idx = g.index ? g.index.array : null, n = idx ? idx.length : p.count, out = [];
  for (let i = 0; i < n; i += 3) {
    const v = [0, 1, 2].map((k) => new T.Vector3().fromBufferAttribute(p, idx ? idx[i + k] : i + k).applyMatrix4(mesh.matrixWorld));
    out.push(new T.Triangle(v[0], v[1], v[2]));
  }
  return out;
}

const BODIES = [];
for (const build of ["m", "f"]) for (const physique of ["average", "slim", "heavy", "muscular"]) for (const age of [null, 15]) BODIES.push({ build, physique, age });
BODIES.push({ build: "m", physique: "average", age: 10 }, { build: "m", physique: "heavy", age: 70 });

let fails = 0, worst = 0;
const q = new T.Vector3(), c = new T.Vector3();
for (const B of BODIES) {
  for (const id of GUNS) {
    const rig = CBZ.makeCharacter({ skin: 0xcf9a72, torso: 0x334455, collar: 0x334455, arms: 0x334455, legs: 0x222222, shoes: 0x222222, hair: 0x222222, build: B.build, physique: B.physique, age: B.age });
    const hip = CBZ.charMounts(rig).hip;
    const prop = CBZ.buildActorWeapon(id);
    prop.position.set(0, 0, 0); prop.rotation.set(0, 0, 0);
    prop.scale.setScalar((CBZ.weaponHeldScale && CBZ.weaponHeldScale(id)) || 0.92);
    hip.add(prop);
    CBZ.charMountSeat(hip, prop, prop.position);
    rig.group.updateMatrixWorld(true);
    const S = rig.skinSlots;
    const tris = [].concat(...[S.pelvis[0], ...S.legs, ...S.torso].map(worldTris));
    let gap = Infinity;
    const verts = worldVerts(prop);
    for (const v of verts) for (const t of tris) { t.closestPointToPoint(v, q); const d = q.distanceToSquared(v); if (d < gap) gap = d; }
    gap = Math.sqrt(gap);
    c.set(0, 0, 0); for (const v of verts) c.add(v); c.multiplyScalar(1 / verts.length);
    const hipY = rig.hipY * (rig.group.userData.humanScale || 0.7);
    const side = c.x < 0;                                    // semantic right = local -X
    const atBelt = c.y > hipY - 0.2 && c.y < hipY + 0.15;
    const ok = gap <= MAX_GAP && side && atBelt;
    worst = Math.max(worst, gap);
    if (!ok) fails++;
    if (!ok || process.argv.includes("--verbose")) {
      console.log((ok ? "  ok   " : "  FAIL ") + [B.build, B.physique, B.age == null ? "adult" : B.age, id].join(" ").padEnd(28) +
        " gap " + (gap * 100).toFixed(1) + " cm  centre " + c.toArray().map((x) => x.toFixed(3)).join(",") + (side ? "" : "  WRONG SIDE") + (atBelt ? "" : "  NOT AT BELT"));
    }
  }
}
console.log((fails ? "FAIL" : "PASS") + " holster seat: " + BODIES.length * GUNS.length + " body x gun, worst gap " + (worst * 100).toFixed(1) + " cm (max " + MAX_GAP * 100 + ")");
process.exit(fails ? 1 : 0);
