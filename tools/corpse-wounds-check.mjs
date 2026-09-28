#!/usr/bin/env node
/* tools/corpse-wounds-check.mjs — A DEAD MAN KEEPS TAKING IT; A PUNCH LEAVES NO HOLE.

   Owner (2026-09-28): "once someone's dead, you can't stab them or shoot them
   anymore. That's dumb. You should be able to add unlimited bullet holes or
   stab holes and more blood should appear." And: a punch left "a hole in his
   back as if he got shot".

   The REAL rig, the REAL collapse (systems/bodyfall.js), the REAL decals
   (systems/wounds.js) and the REAL injury model (systems/vitals.js) in plain
   node (tools/lib/verbs-vm.mjs):
     1. a man is killed and lies in his collapse;
     2. 100 rounds through CBZ.corpseHit and 30 stabs through CBZ.corpseStab:
        every one is taken, nothing throws, the decals on HIM grow well past
        the living cap (>= 60), stay bounded (<= 96 per corpse), and every
        decal is a child of his rig;
     3. the pool under him grows (CBZ.gorePool layers) and stops at its cap;
     4. a blunt bodyWound (a fist, a boot) stamps NOTHING on a living man.

     node tools/corpse-wounds-check.mjs      exit 0 = ok */
import { loadVerbsVM } from "./lib/verbs-vm.mjs";
import { readFileSync } from "node:fs";
import vm from "node:vm";

let fails = 0;
const ok = (c, m, d) => { if (!c) fails++; console.log((c ? "ok   " : "FAIL ") + m + (d ? "  (" + d + ")" : "")); };

const v = loadVerbsVM({ mode: "escape" });
const { CBZ, THREE, ctx } = v;
// a clock the burst window (90 ms per body) can see move
let now = 1000;
ctx.performance = { now: () => now };
CBZ.scene = new THREE.Scene();
const pools = [], sprays = [];
CBZ.gorePool = (x, z, g) => pools.push(g);
CBZ.goreDrip = () => {};
CBZ.gore = function () {};
CBZ.gore.spray = (p) => sprays.push(p);
for (const f of ["src/systems/wounds.js", "src/systems/vitals.js"]) {
  vm.runInContext(readFileSync(new URL("../" + f, import.meta.url), "utf8"), ctx, { filename: f });
}
ok(!!CBZ.bodyWound && !!CBZ.vitals && !!CBZ.corpseHit && !!CBZ.corpseStab, "wounds.js, vitals.js, corpseHit, corpseStab loaded");

const DT = 1 / 60;
function childDecals(a) {
  // every live wound record's mesh must hang off this rig
  let n = 0;
  a.group.traverse((o) => { if (o.isMesh && o.geometry && o.geometry.type === "CircleGeometry") n++; });
  return n;
}

v.clearActors();
v.world({});
const a = v.actor({ build: "m", x: 0, z: 0, yaw: 0, bot: true, name: "corpse" });
CBZ.scene.add(a.group);
CBZ.camera.position.set(0, 2, -3);
for (let i = 0; i < 8; i++) v.frame(DT);

// 4 first: a living man punched stamps nothing
{
  const before = a._woundN || 0;
  for (let i = 0; i < 12; i++) { now += 200; CBZ.bodyWound(a, { x: 0, y: 1.3, z: -0.1 }, { melee: "blunt", fromX: 0, fromZ: -1 }); }
  for (let i = 0; i < 4; i++) { now += 200; CBZ.bodyWound(a, { x: 0, y: 1.3, z: -0.1 }, { melee: true }); }
  ok((a._woundN || 0) === before, "a punch (melee blunt) leaves no mark on a living man", `${(a._woundN || 0) - before} decals`);
}

// 1: dead, lying in his collapse
a.dead = true; a.hp = 0;
CBZ.body.hit(a, { dir: { x: 0, z: 1 }, force: 6, knockdown: 9999 });
for (let i = 0; i < 180; i++) v.frame(DT);
ok(CBZ.bodyFall.active(a), "the body lies in its collapse");

// 2: 100 rounds + 30 stabs
const P = new THREE.Vector3();
let took = 0, stabs = 0, threw = null, maxN = 0;
const parts = [a.char.body, a.char.head, a.char.parts.ll, a.char.parts.rl, a.char.parts.la, a.char.parts.ra].filter(Boolean);
try {
  for (let i = 0; i < 130; i++) {
    now += 150;
    const part = parts[i % parts.length];
    part.getWorldPosition(P);
    P.x += Math.sin(i * 1.7) * 0.03; P.z += Math.cos(i * 2.3) * 0.03; P.y += 0.05;
    if (i < 100) { if (CBZ.corpseHit(a, { x: P.x, y: P.y, z: P.z }, { x: 0, y: -0.4, z: 1 }, 6, { cal: 1 })) took++; }
    else { if (CBZ.corpseStab(a, { x: P.x, y: P.y, z: P.z }, { x: 0, y: -0.3, z: 1 })) stabs++; }
    maxN = Math.max(maxN, a._woundN || 0);
    if (i % 5 === 0) v.frame(DT);
  }
} catch (e) { threw = e; }
ok(!threw, "130 hits into one corpse: no throw", threw && (threw.stack || threw.message));
ok(took === 100, "every round is taken by the corpse", `${took}/100`);
ok(stabs === 30, "every stab is taken by the corpse", `${stabs}/30`);
const n = a._woundN || 0;
ok(n >= 60, "decals keep growing past the living cap", `${n} on him (peak ${maxN})`);
ok(maxN <= 96, "bounded per corpse", `peak ${maxN}`);
const kids = childDecals(a);
ok(kids >= 30, "the holes are on HIS rig (children of his parts)", `${kids} disc meshes under his group`);
ok(sprays.length >= 30, "a stab lets a little blood out", `${sprays.length} sprays`);
const audit = CBZ.woundDecalAudit ? CBZ.woundDecalAudit() : null;
if (audit) ok(!audit.oversized, "no oversized decal", JSON.stringify({ decals: audit.decals, oversized: audit.oversized }));

// 3: the pool grows, then stops
for (let i = 0; i < 60 * 40; i++) { now += 16; CBZ.vitals.tick(DT); }
const R = CBZ.vitals.peek(a);
ok(pools.length >= 3, "the pool under him grows with the holes", `${pools.length} layers`);
ok(pools.length <= CBZ.vitals.K.POOL_CAP, "and stops at its cap", `${pools.length} <= ${CBZ.vitals.K.POOL_CAP}`);
ok(!!R && R.bleeds.length <= 24, "the ooze list stays bounded", R ? `${R.bleeds.length} bleeds` : "no record");

if (v.errors.length) { console.log(v.errors.slice(0, 3).join("\n")); }
console.log(fails ? `corpse-wounds check: ${fails} failure(s)` : "corpse-wounds check: OK");
process.exit(fails ? 1 : 0);
